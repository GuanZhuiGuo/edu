import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../public/client.js", import.meta.url), "utf8");
const stateStart = source.indexOf("let activeLearningScope = null;");
const stateEnd = source.indexOf("let voiceUserTranscriptBuffer", stateStart);
const helperStart = source.indexOf("function getLearningScopeSnapshot()");
const helperEnd = source.indexOf("function renderLoadedLearningMaterials(scope)", helperStart);
assert.ok(stateStart >= 0 && stateEnd > stateStart && helperStart >= 0 && helperEnd > helperStart);

function fixture() {
  const events = [];
  const requests = [];
  const rendered = [];
  const errors = [];
  let requestedScope = "selected-course";
  const window = {};
  const els = {
    loadedLearningMaterialsLabel: {}, classroomLearningScopeName: {}, classroomLearningScopeMeta: {},
  };
  const helpers = Function("window", "document", "fetch", "getRequestedLearningScopeId", "renderLoadedLearningMaterials", "els", "logEvent", "CustomEvent", `
    "use strict";
    ${source.slice(stateStart, stateEnd)}
    ${source.slice(helperStart, helperEnd)}
    return { load: loadLearningAgentScope };
  `)(window,
    { dispatchEvent: (event) => events.push(event) },
    (url) => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    () => requestedScope,
    (scope) => rendered.push(structuredClone(scope)), els,
    (name, payload) => errors.push({ name, payload }),
    class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  );
  return {
    ...helpers, events, requests, rendered, errors, els,
    setRequested(value) { requestedScope = value; },
    snapshot: () => window.AITeacherLearningScope.getSnapshot(),
    respond(index, scope, { status = 200, message } = {}) {
      requests[index].resolve({ ok: status === 200, status, json: async () => ({ current_scope: scope, message }) });
    },
  };
}

const math = { scope_id: "course-junior-math", label: "中考数学", loaded_materials: [{ title: "已审核课标" }] };

test("scope observation exposes idle/loading and only the actual server-selected course as ready", async () => {
  const f = fixture();
  assert.deepEqual(f.snapshot(), { status: "idle", scope: null, error: null });
  f.setRequested("selected-english");
  const pending = f.load();
  assert.match(f.requests[0].url, /scope_id=selected-english/u);
  assert.deepEqual(f.snapshot(), { status: "loading", scope: null, error: null });
  f.respond(0, math);
  await pending;
  assert.deepEqual(f.snapshot(), { status: "ready", scope: math, error: null });
  assert.deepEqual(f.events.map((event) => [event.type, event.detail.status]), [
    ["learning-scope:change", "loading"], ["learning-scope:change", "ready"],
  ]);
  assert.deepEqual(f.rendered, [math]);
});

test("getSnapshot and event details cannot mutate the active scope used by learning requests", async () => {
  const f = fixture();
  const pending = f.load();
  f.respond(0, math);
  await pending;
  const external = f.snapshot();
  external.status = "error";
  external.scope.loaded_materials[0].title = "forged";
  f.events.at(-1).detail.scope.scope_id = "forged-course";
  assert.deepEqual(f.snapshot(), { status: "ready", scope: math, error: null });
});

test("a late old success cannot replace the newest scope or repaint the legacy labels", async () => {
  const f = fixture();
  const first = f.load();
  f.setRequested("next-course");
  const second = f.load();
  const latest = { ...math, scope_id: "server-next-course" };
  f.respond(1, latest);
  await second;
  f.respond(0, math);
  await first;
  assert.deepEqual(f.snapshot(), { status: "ready", scope: latest, error: null });
  assert.deepEqual(f.rendered, [latest]);
  assert.equal(f.events.length, 3);
});

test("a late old failure cannot clear a successfully loaded newer scope", async () => {
  const f = fixture();
  const first = f.load();
  const second = f.load();
  f.respond(1, math);
  await second;
  f.requests[0].reject(new Error("old request failed"));
  await first;
  assert.equal(f.snapshot().status, "ready");
  assert.deepEqual(f.snapshot().scope, math);
  assert.equal(f.errors.length, 0);
  assert.equal(f.events.length, 3);
});

test("new loading and failure clear the old course authority, and a successful retry clears the error", async () => {
  const f = fixture();
  const first = f.load();
  f.respond(0, math);
  await first;
  const second = f.load();
  assert.deepEqual(f.snapshot(), { status: "loading", scope: null, error: null });
  f.respond(1, null, { status: 503, message: "当前没有已审核课程" });
  await second;
  assert.deepEqual(f.snapshot(), { status: "error", scope: null, error: "当前没有已审核课程" });
  assert.equal(f.els.loadedLearningMaterialsLabel.textContent, "暂无教材");
  assert.equal(f.els.classroomLearningScopeName.textContent, "未加载课程");
  const third = f.load();
  f.respond(2, math);
  await third;
  assert.deepEqual(f.snapshot(), { status: "ready", scope: math, error: null });
});

test("HTTP 200 without an actual server scope remains error instead of inventing a selected course", async () => {
  const f = fixture();
  const pending = f.load();
  f.respond(0, { label: "selection only" });
  await pending;
  assert.equal(f.snapshot().status, "error");
  assert.equal(f.snapshot().scope, null);
  assert.match(f.snapshot().error, /已加载课程范围/u);
  assert.equal(f.rendered.length, 0);
});
