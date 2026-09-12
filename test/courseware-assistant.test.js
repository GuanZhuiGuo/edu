import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { buildGeometryCourseware, GEOMETRY_SCOPE } from "../public/courseware-geometry.js";
import { resolveCoursewareConstraint, suggestCoursewareType } from "../public/courseware-assistant.js";

test("automatic suggestions respect an explicit request to avoid video", () => {
  assert.equal(suggestCoursewareType("制作牛顿第二定律互动实验，不要视频。 ").type, "physics_lab");
});

test("production constraints describe outcomes while internal executors stay automatic", () => {
  assert.equal(resolveCoursewareConstraint("interactive", "讲解斜面摩擦并让学生调节参数"), "physics_lab");
  assert.equal(resolveCoursewareConstraint("handout", "牛顿第二定律"), "deeptutor");
  assert.equal(resolveCoursewareConstraint("course", "牛顿第二定律"), "openmaic");
  assert.equal(resolveCoursewareConstraint("video", "牛顿第二定律"), "video");
  assert.equal(resolveCoursewareConstraint("auto", "[用户附件文本]\n一次函数课堂教案：让学生拖动斜率并观察图像变化"), "function_graph");
});

test("assistant submits geometry through its actual controller, enables save, and reuses current parameters", async () => {
  const source = await readFile(new URL("../public/courseware-assistant.js", import.meta.url), "utf8");
  const doc = new ContractDocument();
  const root = new ContractNode(doc);
  const saves = [];
  const mounts = [];
  let sequence = 0;
  // Execute the production controller in full. Only external engine/storage
  // dependencies and browser DOM are test seams; local helpers keep their real
  // lexical scope, so an undefined showGeometry fails the submitted task.
  const context = vm.createContext({
    document: doc, structuredClone, console,
    crypto: { randomUUID: () => `contract-${++sequence}` },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    getInteractiveLessonLab: () => null,
    getVideoExplanationWorkbench: () => null,
    buildGeometryCourseware, GEOMETRY_SCOPE,
    mountGeometryCourseware(container, item, { onChange }) {
      let current = structuredClone(item);
      const record = { container, item: current, destroyed: false,
        change(next) { current = next; onChange(next); } };
      mounts.push(record);
      return { getCourseware: () => structuredClone(current), destroy: () => { record.destroyed = true; } };
    },
    async saveCourseware(item) { saves.push(structuredClone(item)); return { ...item, id: "saved-geometry" }; },
  });
  const executable = source.replace(/^import[^\n]*\n/gmu, "").replace(/\bexport function /gu, "function ");
  vm.runInContext(`${executable}\n globalThis.mountController = mountCoursewareAssistant;`, context);
  const assistant = context.mountController({ root });
  root.querySelector("#coursewareAssistantPrompt").value = "直角三角形勾股关系：调节两条直角边，比较斜边平方与两个正方形面积，并完成迁移题";
  root.querySelector("#coursewareAssistantType").value = "auto";
  await assistant.submit();
  assert.equal(assistant.getTool(), "geometry");
  assert.equal(root.querySelector("#coursewareAssistantType").value, "auto");
  assert.equal(assistant.getTasks()[0].status, "completed", assistant.getTasks()[0].message);
  assert.equal(mounts.length, 1);
  assert.equal(mounts[0].item.visualArtifact.model.kind, "right_triangle");
  assert.equal(root.querySelector("[data-ca-save]").disabled, false);
  assert.match(root.querySelector("#coursewareAssistantResultTitle").textContent, /直角三角形/);

  const adjusted = structuredClone(mounts[0].item);
  adjusted.visualArtifact.model.a = 7.5;
  mounts[0].change(adjusted);
  root.querySelector("[data-ca-save]").dispatchEvent({ type: "click" });
  await Promise.resolve();
  assert.equal(saves[0].visualArtifact.model.a, 7.5);
  const stored = { ...saves[0], id: "saved-geometry" };
  doc.dispatchEvent({ type: "courseware:open-assistant", detail: { item: stored } });
  assert.equal(mounts.length, 2);
  assert.equal(mounts[0].destroyed, true);
  assert.equal(mounts[1].item.visualArtifact.model.a, 7.5);
  assert.equal(assistant.getTasks()[0].status, "completed");
});

test("automatic planning reports a Deep Agents failure and completes through the existing executor", async () => {
  const source = await readFile(new URL("../public/courseware-assistant.js", import.meta.url), "utf8");
  const doc = new ContractDocument();
  const requests = [];
  doc.defaultView.fetch = async (url) => {
    requests.push(url);
    if (url.endsWith("/config")) return { ok: true, json: async () => ({ mode: "auto", configured: true }) };
    return {
      ok: false,
      status: 502,
      json: async () => ({ message: "规划服务暂时不可用" }),
    };
  };
  const root = new ContractNode(doc);
  const context = vm.createContext({
    document: doc, structuredClone, console,
    crypto: { randomUUID: () => "fallback-contract" },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    getInteractiveLessonLab: () => null,
    getVideoExplanationWorkbench: () => null,
    buildGeometryCourseware, GEOMETRY_SCOPE,
    mountGeometryCourseware(_container, item) { return { getCourseware: () => item, destroy() {} }; },
    async saveCourseware(item) { return item; },
  });
  const executable = source.replace(/^import[^\n]*\n/gmu, "").replace(/\bexport function /gu, "function ");
  vm.runInContext(`${executable}\n globalThis.mountController = mountCoursewareAssistant;`, context);
  const assistant = context.mountController({ root });
  root.querySelector("#coursewareAssistantPrompt").value = "制作一整套直角三角形勾股关系互动课堂，包含讲解、可调实验、课堂练习和迁移活动。";
  root.querySelector("#coursewareAssistantType").value = "auto";

  await assistant.submit();

  const task = assistant.getTasks()[0];
  assert.equal(task.status, "completed");
  assert.equal(task.type, "geometry");
  assert.equal(task.plannerEngine, "deterministic_domain_router");
  assert.match(task.fallbackNotice, /已回退/u);
  assert.ok(requests.some((url) => url.endsWith("/api/courseware-agent/plan")));
  assert.match(root.querySelector("[data-ca-status]").textContent, /已回退/u);
});

test("a failed Agent-selected source pipeline falls back to the matching local executor", async () => {
  const source = await readFile(new URL("../public/courseware-assistant.js", import.meta.url), "utf8");
  const doc = new ContractDocument();
  const interactivePanel = new ContractNode(doc);
  const materialPanel = new ContractNode(doc);
  interactivePanel.querySelector = () => null;
  materialPanel.querySelector = () => null;
  doc.querySelector = (selector) => selector === "#interactiveLessonWorkspace" ? interactivePanel
    : selector === "#knowledgeMaterialsWorkspace" ? materialPanel : null;
  doc.defaultView.fetch = async (url) => ({
    ok: true,
    json: async () => url.endsWith("/config")
      ? ({ mode: "auto", configured: true })
      : ({
          engine: "langchain_deepagents_js",
          plan: {
            title: "牛顿第二定律互动课堂",
            recommended_type: "openmaic",
            subject: "物理",
            goal_summary: "通过实验理解牛顿第二定律，并完成练习与迁移。",
            rationale: "完整课堂优先使用分场景课件。",
          },
        }),
  });
  const root = new ContractNode(doc);
  let currentLesson = null;
  const interactive = {
    async generateCourseware({ type }) {
      assert.equal(type, "physics_lab");
      currentLesson = { title: "牛顿第二定律参数实验" };
      return currentLesson;
    },
    getLesson() { return currentLesson; },
    getCourseware() { return currentLesson; },
  };
  const context = vm.createContext({
    document: doc, structuredClone, console,
    crypto: { randomUUID: () => "source-fallback-contract" },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    getInteractiveLessonLab: () => interactive,
    getVideoExplanationWorkbench: () => null,
    buildGeometryCourseware, GEOMETRY_SCOPE,
    mountGeometryCourseware(_container, item) { return { getCourseware: () => item, destroy() {} }; },
    async saveCourseware(item) { return item; },
  });
  const executable = source.replace(/^import[^\n]*\n/gmu, "").replace(/\bexport function /gu, "function ");
  vm.runInContext(`${executable}\n globalThis.mountController = mountCoursewareAssistant;`, context);
  const assistant = context.mountController({ root, materials: {} });
  root.querySelector("#coursewareAssistantPrompt").value = "制作一整套牛顿第二定律互动课堂，包含讲解、可调参数实验、课堂练习和迁移活动。";
  root.querySelector("#coursewareAssistantType").value = "auto";

  await assistant.submit();

  const task = assistant.getTasks()[0];
  assert.equal(task.status, "completed");
  assert.equal(task.type, "physics_lab");
  assert.equal(assistant.getTool(), "interactive");
  assert.equal(root.querySelector("#coursewareAssistantType").value, "auto");
  assert.match(task.message, /自动回退/u);
});

test("document-only courseware requests route and generate from extracted attachment text", async () => {
  const source = await readFile(new URL("../public/courseware-assistant.js", import.meta.url), "utf8");
  const doc = new ContractDocument();
  const interactivePanel = new ContractNode(doc);
  interactivePanel.querySelector = () => null;
  doc.querySelector = (selector) => selector === "#interactiveLessonWorkspace" ? interactivePanel : null;
  const planBodies = [];
  doc.defaultView.fetch = async (url, options = {}) => {
    if (url.endsWith("/config")) return { ok: true, json: async () => ({ mode: "auto", configured: true }) };
    planBodies.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        engine: "deterministic_domain_router",
        plan: {
          title: "一次函数互动课",
          recommended_type: null,
          subject: "",
          goal_summary: planBodies.at(-1).prompt,
          rationale: "现有函数执行器可直接完成。",
        },
      }),
    };
  };
  const root = new ContractNode(doc);
  let generationInput = null;
  let clearCount = 0;
  let currentLesson = null;
  const interactive = {
    async generateCourseware(input) {
      generationInput = input;
      currentLesson = { title: "一次函数斜率实验" };
      return currentLesson;
    },
    getLesson() { return currentLesson; },
    getCourseware() { return currentLesson; },
  };
  const context = vm.createContext({
    document: doc, structuredClone, console,
    crypto: { randomUUID: () => "document-contract" },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    createComposerAttachmentController() {
      return {
        isProcessing: () => false,
        async prepare() {
          return {
            image: null,
            documents: [{ name: "函数教案.docx", text: "一次函数课堂教案" }],
            context: "[用户附件文本]\n文件：函数教案.docx\n一次函数课堂教案：让学生拖动斜率并观察图像变化\n[/用户附件文本]",
            summary: [{ name: "函数教案.docx", kind: "document", format: "docx" }],
          };
        },
        clear() { clearCount += 1; },
      };
    },
    getInteractiveLessonLab: () => interactive,
    getVideoExplanationWorkbench: () => null,
    buildGeometryCourseware, GEOMETRY_SCOPE,
    mountGeometryCourseware(_container, item) { return { getCourseware: () => item, destroy() {} }; },
    async saveCourseware(item) { return item; },
  });
  const executable = source.replace(/^import[^\n]*\n/gmu, "").replace(/\bexport function /gu, "function ");
  vm.runInContext(`${executable}\n globalThis.mountController = mountCoursewareAssistant;`, context);
  const assistant = context.mountController({ root });
  root.querySelector("#coursewareAssistantPrompt").value = "";
  root.querySelector("#coursewareAssistantType").value = "auto";

  await assistant.submit();

  assert.equal(assistant.getTasks()[0].type, "function_graph");
  assert.equal(assistant.getTasks()[0].attachments[0].name, "函数教案.docx");
  assert.equal(generationInput.type, "function_graph");
  assert.match(generationInput.prompt, /函数教案\.docx/u);
  assert.match(generationInput.prompt, /拖动斜率/u);
  assert.match(planBodies[0].prompt, /一次函数课堂教案/u);
  assert.equal(clearCount, 1);
});

class ContractNode {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
    this.queries = new Map();
    this.classList = { add() {}, contains() { return false; } };
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
  }
  querySelector(selector) {
    if (!this.queries.has(selector)) this.queries.set(selector, new ContractNode(this.ownerDocument));
    return this.queries.get(selector);
  }
  querySelectorAll(selector) {
    if (selector === "[data-ca-pane]") return ["compose", "preview"].map(pane => {
      const node = this.querySelector(`pane:${pane}`); node.dataset.caPane = pane; return node;
    });
    return [];
  }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler); this.listeners.set(type, handlers);
  }
  dispatchEvent(event) { for (const handler of this.listeners.get(event.type) || []) handler(event); }
  focus() {}
}

class ContractDocument extends ContractNode {
  constructor() { super(null); this.ownerDocument = this; this.defaultView = {}; }
  querySelector() { return null; }
  createElement() { return new ContractNode(this); }
}
