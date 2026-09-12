import { initGenerationGuidance } from "./generation-guidance.js";
import { PHYSICS_LESSON_SAMPLES } from "./physics-lesson-samples.js";
import { mountPhysicsPlayer } from "./physics-lesson-player.js";
import { buildPhysicsLessonHtml } from "./physics-lesson-export.js";

const CONFIG_URL = "/api/interactive-lessons/config";
const GENERATE_URL = "/api/interactive-lessons/generate";
const lessonLabInstances = new WeakMap();

export function getInteractiveLessonLab(root = document.querySelector("#interactiveLessonWorkspace")) {
  return root ? lessonLabInstances.get(root) || null : null;
}

export function mountInteractiveLessonPlayer(container, lesson, options = {}) {
  const player = new LessonPlayer(container, lesson, options);
  player.mount();
  return player;
}

export async function buildCoursewareLessonHtml(lesson, events = []) {
  return lesson.artifact_type === "physics_lab"
    ? buildPhysicsLessonHtml(lesson, events)
    : buildStandaloneLessonHtml(lesson, events);
}

const ARTIFACT_LABELS = Object.freeze({
  function_graph: "互动函数图",
  projectile_lab: "抛体运动实验",
  physics_lab: "物理参数实验",
  acid_base_lab: "酸碱滴定实验",
  mindmap: "互动思维导图",
  concept_cards: "概念翻转卡",
});

const SAMPLE_LESSON = Object.freeze({
  version: "1.0",
  lesson_id: "sample_quadratic",
  title: "二次函数参数实验",
  subtitle: "拖动 a、b、c，观察抛物线形状与位置怎样变化",
  subject: "数学",
  grade_band: "九年级",
  knowledge_point: "二次函数图像与参数",
  artifact_type: "function_graph",
  explanation: "二次函数 y=ax²+bx+c 的三个参数共同决定抛物线的开口、对称轴和纵向位置。",
  learning_objectives: ["理解参数 a 对开口方向和宽窄的影响", "观察 b、c 对图像位置的影响"],
  key_points: ["a 的正负决定开口方向", "|a| 越大，图像越窄", "c 是图像与 y 轴交点的纵坐标"],
  misconception: "a 越大，图像不一定越高；它首先改变的是开口方向和宽窄。",
  guidance: {
    prediction_prompt: "先预测：把 a 从 1 调到 -1，图像会发生什么变化？",
    observation_prompt: "拖动参数后，观察开口、对称轴和 y 轴交点。",
    transfer_question: "如果抛物线经过原点，可以立刻确定哪个参数？",
  },
  visualization: {
    preset: "quadratic",
    parameters: { a: 1, b: 0, c: 0 },
    nodes: [],
    cards: [],
  },
  runtime: { renderer: "deterministic-lesson-player", renderer_version: "1.0" },
});

export function initInteractiveLessonLab(options = {}) {
  const root = options.root || document.querySelector("#interactiveLessonWorkspace");
  if (root && lessonLabInstances.has(root)) return lessonLabInstances.get(root);
  if (!root || root.dataset.lessonLabReady === "true") return null;
  root.dataset.lessonLabReady = "true";

  const elements = {
    form: root.querySelector("#interactiveLessonForm"),
    composerDetails: root.querySelector("#lessonComposerDetails"),
    composerSummary: root.querySelector("#lessonComposerSummary"),
    previewTitle: root.querySelector("#lessonPreviewTitle"),
    loadSample: root.querySelector("#lessonLoadSample"),
    quickExample: root.querySelector("#lessonQuickExample"),
    physicsEngine: root.querySelector("#lessonPhysicsEngine"),
    physicsEngineField: root.querySelector("#lessonPhysicsEngineField"),
    subject: root.querySelector("#lessonSubject"),
    gradeBand: root.querySelector("#lessonGradeBand"),
    knowledgePoint: root.querySelector("#lessonKnowledgePoint"),
    learningGoal: root.querySelector("#lessonLearningGoal"),
    preferredArtifact: root.querySelector("#lessonPreferredArtifact"),
    sourceText: root.querySelector("#lessonSourceText"),
    imageInput: root.querySelector("#lessonImageInput"),
    imageDrop: root.querySelector("#lessonImageDrop"),
    imagePreview: root.querySelector("#lessonImagePreview"),
    imageName: root.querySelector("#lessonImageName"),
    imageRemove: root.querySelector("#lessonImageRemove"),
    generate: root.querySelector("#lessonGenerateButton"),
    status: root.querySelector("#lessonGenerateStatus"),
    provider: root.querySelector("#lessonProviderStatus"),
    stage: root.querySelector("#lessonPlayerStage"),
    empty: root.querySelector("#lessonPlayerEmpty"),
    lessonMeta: root.querySelector("#lessonResultMeta"),
    record: root.querySelector("#lessonRecordButton"),
    replay: root.querySelector("#lessonReplayButton"),
    video: root.querySelector("#lessonVideoButton"),
    downloadHtml: root.querySelector("#lessonDownloadHtml"),
    downloadEvents: root.querySelector("#lessonDownloadEvents"),
    trace: root.querySelector("#lessonAgentTrace"),
    eventCount: root.querySelector("#lessonEventCount"),
  };
  if (!elements.form || !elements.stage || !elements.generate) return null;

  const wideLayout = window.matchMedia?.("(min-width: 1024px)");
  const syncComposerLayout = () => {
    if (root.dataset.coursewareEmbedded === "true") return;
    // Collapse only on a breakpoint transition, never during edits or generation.
    if (elements.composerDetails) elements.composerDetails.open = wideLayout?.matches !== false;
  };
  syncComposerLayout();
  wideLayout?.addEventListener?.("change", syncComposerLayout);
  const syncComposerSummary = () => {
    if (elements.composerSummary) elements.composerSummary.textContent = `${elements.subject.value} · ${elements.knowledgePoint.value.trim() || "自定义知识点"}`;
  };
  elements.form.addEventListener("input", syncComposerSummary);
  elements.form.addEventListener("change", syncComposerSummary);
  const revealPreview = () => {
    if (wideLayout?.matches !== false) return;
    if (elements.composerDetails) elements.composerDetails.open = false;
    elements.previewTitle?.focus({ preventScroll: true });
    elements.previewTitle?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  const state = {
    busy: false,
    configured: false,
    recordRevision: 0,
    replaying: false,
    replayRevision: 0,
    physicsPreset: "inclined_plane",
    image: null,
    lesson: null,
    player: null,
    recording: false,
    recordStartedAt: 0,
    events: [],
    replayTimers: [],
    mediaRecorder: null,
    mediaChunks: [],
  };

  const setStatus = (message, kind = "idle") => {
    elements.status.textContent = message;
    elements.status.dataset.state = kind;
  };

  const updateEventCount = () => {
    elements.eventCount.textContent = `${state.events.length} 个操作`;
    elements.replay.disabled = state.events.length === 0;
    elements.downloadEvents.disabled = state.events.length === 0;
  };

  const onPlayerEvent = (event) => {
    if (!state.recording || state.replaying) return;
    state.events.push({
      at_ms: Math.max(0, Math.round(performance.now() - state.recordStartedAt)),
      type: event.type,
      target: event.target,
      value: event.value,
    });
    updateEventCount();
  };

  const mountLesson = (lesson, { trace = [], agent = null, sample = false, preserveSource = false } = {}) => {
    state.recordRevision += 1;
    elements.record.disabled = false;
    if (state.mediaRecorder?.state === "recording") state.mediaRecorder.stop();
    state.player?.destroy();
    stopReplay(state);
    state.lesson = lesson;
    const selectLessonValue = (select, value) => {
      const text = String(value || "");
      if (text && ![...select.options].some((option) => option.value === text)) {
        const option = root.ownerDocument.createElement("option");
        option.value = text;
        option.textContent = text;
        select.append(option);
      }
      select.value = text;
    };
    selectLessonValue(elements.subject, lesson.subject);
    selectLessonValue(elements.gradeBand, lesson.grade_band);
    elements.knowledgePoint.value = String(lesson.knowledge_point || lesson.title || "").slice(0, 160);
    elements.learningGoal.value = (lesson.learning_objectives || []).join("；").slice(0, 600);
    elements.preferredArtifact.value = Object.hasOwn(ARTIFACT_LABELS, lesson.artifact_type) ? lesson.artifact_type : "";
    const sampleKey = Object.entries(PHYSICS_LESSON_SAMPLES).find(([, item]) => item.lesson_id === lesson.lesson_id)?.[0];
    elements.quickExample.value = sampleKey || (lesson.lesson_id === SAMPLE_LESSON.lesson_id ? "quadratic" : "");
    state.physicsPreset = lesson.artifact_type === "physics_lab" ? lesson.visualization?.preset : undefined;
    if (elements.physicsEngine) elements.physicsEngine.value = lesson.artifact_type === "physics_lab" ? lesson.visualization?.engine || "auto" : "auto";
    if (!preserveSource) {
      elements.sourceText.value = String(lesson.explanation || "").slice(0, 4000);
      clearSelectedImage(state, elements);
    }
    syncPhysicsField();
    state.events = [];
    state.recording = false;
    renderRecordButton(elements.record, false);
    elements.empty.hidden = true;
    elements.stage.hidden = false;
    elements.lessonMeta.textContent = `${ARTIFACT_LABELS[lesson.artifact_type] || "互动教材"} · ${lesson.subject} · ${lesson.grade_band}`;
    syncComposerSummary();
    state.player = new LessonPlayer(elements.stage, lesson, {
      onEvent: onPlayerEvent,
      onReady: () => {
        elements.video.disabled = !state.player?.getRecordableCanvas();
      },
      onError: (error) => {
        elements.video.disabled = true;
        setStatus(error?.message || "物理引擎加载失败，请重试", "error");
      },
    });
    state.player.mount();
    elements.video.disabled = !state.player.getRecordableCanvas();
    elements.downloadHtml.disabled = false;
    renderAgentTrace(elements.trace, trace, agent, sample);
    updateEventCount();
    if (!preserveSource) setStatus(`已加载${sample ? "内置示例" : "课件"}：${lesson.title}，可直接交互或继续生成。`, "success");
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  };

  const refreshConfig = async () => {
    try {
      const response = await fetch(CONFIG_URL, { cache: "no-store" });
      const config = await response.json();
      const configured = response.ok && config.configured === true;
      state.configured = configured;
      elements.provider.dataset.state = configured ? "ready" : "missing";
      elements.provider.querySelector("b").textContent = configured
        ? "AI 生成已就绪"
        : "模型密钥未配置";
      elements.provider.querySelector("small").textContent = configured
        ? "多模态理解已就绪"
        : "请在服务端设置 ARK_API_KEY";
      elements.generate.disabled = !configured;
      if (!configured) setStatus("AI 生成暂不可用，可先操作内置实验；在系统设置中配置模型后重试。", "error");
    } catch {
      state.configured = false;
      elements.generate.disabled = true;
      elements.provider.dataset.state = "error";
      elements.provider.querySelector("b").textContent = "模型状态不可用";
      elements.provider.querySelector("small").textContent = "请确认本机服务已启动";
    }
  };

  const generate = async () => {
    if (state.busy) return;
    const knowledgePoint = elements.knowledgePoint.value.trim();
    const learningGoal = elements.learningGoal.value.trim() || `理解并探索${knowledgePoint}`;
    if (!knowledgePoint) {
      setStatus("请先填写想探索的知识点", "error");
      elements.knowledgePoint.focus();
      return;
    }
    state.busy = true;
    const requestId = globalThis.crypto?.randomUUID?.() || `lesson-${Date.now()}`;
    root.dispatchEvent(new CustomEvent("interactive-lesson:generation", { bubbles: true, detail: { requestId, status: "running", title: knowledgePoint } }));
    elements.generate.disabled = true;
    elements.generate.classList.add("is-busy");
    setStatus("正在根据知识点设计互动教材…", "busy");
    elements.form.querySelectorAll("input, select, textarea").forEach((input) => { input.disabled = true; });
    renderWorkingTrace(elements.trace);
    try {
      const response = await fetch(GENERATE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: elements.subject.value,
          grade_band: elements.gradeBand.value,
          knowledge_point: knowledgePoint,
          learning_goal: learningGoal,
          preferred_artifact: elements.preferredArtifact.value,
          physics_engine: elements.physicsEngine?.value || "auto",
          physics_preset: elements.preferredArtifact.value === "physics_lab" ? state.physicsPreset : undefined,
          source_text: elements.sourceText.value.trim(),
          image: state.image,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "互动教材生成失败");
      mountLesson(payload.lesson, { trace: payload.trace, agent: payload.agent, preserveSource: true });
      setStatus("生成完成：教材可交互、可记录、可下载", "success");
      revealPreview();
      root.dispatchEvent(new CustomEvent("interactive-lesson:generation", { bubbles: true, detail: { requestId, status: "completed", lesson: payload.lesson } }));
      return payload.lesson;
    } catch (error) {
      setStatus(error?.message || "互动教材生成失败，请重试", "error");
      renderTraceError(elements.trace, error?.message || "生成失败");
      root.dispatchEvent(new CustomEvent("interactive-lesson:generation", { bubbles: true, detail: { requestId, status: "failed", error: error?.message || "生成失败" } }));
      return null;
    } finally {
      state.busy = false;
      elements.generate.disabled = !state.configured;
      elements.form.querySelectorAll("input, select, textarea").forEach((input) => { input.disabled = false; });
      elements.generate.classList.remove("is-busy");
    }
  };

  const syncPhysicsField = () => {
    if (elements.physicsEngineField) elements.physicsEngineField.hidden = elements.preferredArtifact.value !== "physics_lab";
  };
  elements.preferredArtifact.addEventListener("change", () => {
    state.physicsPreset = undefined;
    syncPhysicsField();
  });
  elements.knowledgePoint.addEventListener("input", () => {
    state.physicsPreset = undefined;
    if (elements.quickExample.value) {
      elements.learningGoal.value = "";
      elements.preferredArtifact.value = "";
    }
    elements.quickExample.value = "";
    syncPhysicsField();
  });
  elements.quickExample?.addEventListener("change", () => {
    const key = elements.quickExample.value;
    if (!key) {
      state.physicsPreset = undefined;
      elements.knowledgePoint.value = "";
      elements.learningGoal.value = "";
      elements.preferredArtifact.value = "";
      syncPhysicsField();
      elements.knowledgePoint.focus();
      return;
    }
    const lesson = PHYSICS_LESSON_SAMPLES[key] || SAMPLE_LESSON;
    elements.subject.value = lesson.subject;
    elements.gradeBand.value = lesson.grade_band;
    elements.knowledgePoint.value = lesson.knowledge_point;
    elements.learningGoal.value = lesson.learning_objectives.join("；");
    elements.preferredArtifact.value = lesson.artifact_type;
    elements.physicsEngine.value = "auto";
    elements.sourceText.value = "";
    clearSelectedImage(state, elements);
    state.physicsPreset = lesson.artifact_type === "physics_lab" ? key : undefined;
    syncPhysicsField();
    mountLesson(lesson, { sample: true });
    setStatus(`已加载内置示例：${lesson.title}，可直接交互或继续生成。`, "success");
  });
  syncPhysicsField();

  elements.loadSample?.addEventListener("click", () => {
    elements.quickExample.value = "inclined_plane";
    elements.quickExample.dispatchEvent(new Event("change", { bubbles: true }));
    elements.previewTitle?.focus({ preventScroll: true });
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void generate();
  });
  elements.imageDrop.addEventListener("click", () => elements.imageInput.click());
  elements.imageDrop.addEventListener("keydown", (event) => {
    if (event.target === elements.imageDrop && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      elements.imageInput.click();
    }
  });
  elements.imageInput.addEventListener("change", () => {
    void readSelectedImage(elements.imageInput.files?.[0], state, elements, setStatus);
  });
  for (const name of ["dragenter", "dragover"]) {
    elements.imageDrop.addEventListener(name, (event) => {
      event.preventDefault();
      elements.imageDrop.classList.add("is-dragging");
    });
  }
  for (const name of ["dragleave", "drop"]) {
    elements.imageDrop.addEventListener(name, (event) => {
      event.preventDefault();
      elements.imageDrop.classList.remove("is-dragging");
    });
  }
  elements.imageDrop.addEventListener("drop", (event) => {
    void readSelectedImage(event.dataTransfer?.files?.[0], state, elements, setStatus);
  });
  elements.imageRemove.addEventListener("click", (event) => {
    event.stopPropagation();
    clearSelectedImage(state, elements);
  });

  const finishRecording = async () => {
    if (!state.recording) return;
    if (state.lesson.artifact_type === "physics_lab") {
      const pause = { type: "physics_play", target: "play", value: false };
      onPlayerEvent(pause);
      await state.player.applyEvent(pause);
    }
    state.recording = false;
    renderRecordButton(elements.record, false);
    updateEventCount();
  };
  elements.record.addEventListener("click", async () => {
    if (!state.player) return;
    stopReplay(state);
    const player = state.player;
    const revision = ++state.recordRevision;
    elements.record.disabled = true;
    try {
      if (!state.recording) {
        const ready = await player.reset();
        if (revision !== state.recordRevision || player !== state.player) return;
        if (ready === false) { setStatus("物理引擎未就绪，请重新加载后再记录。", "error"); return; }
        state.events = [];
        state.recordStartedAt = performance.now();
        state.recording = true;
        setStatus("已从初始状态开始记录；可以调参和播放", "recording");
      } else {
        await finishRecording();
        if (revision !== state.recordRevision || player !== state.player) return;
        setStatus(`已记录 ${state.events.length} 个操作，可以回放或下载`, "success");
      }
      renderRecordButton(elements.record, state.recording);
      updateEventCount();
    } finally { if (revision === state.recordRevision) elements.record.disabled = false; }
  });
  elements.replay.addEventListener("click", async () => {
    await finishRecording();
    void replayEvents(state, setStatus);
  });
  elements.downloadEvents.addEventListener("click", () => {
    if (!state.lesson || state.events.length === 0) return;
    downloadBlob(
      `${safeFileName(state.lesson.title)}-操作记录.json`,
      new Blob([JSON.stringify({ lesson: state.lesson, events: state.events }, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
    );
  });
  elements.downloadHtml.addEventListener("click", async () => {
    if (!state.lesson) return;
    const lesson = state.events.length ? state.lesson : state.player.getExportLesson();
    elements.downloadHtml.disabled = true;
    try {
      setStatus("正在打包可离线使用的互动教材…", "busy");
      const html = lesson.artifact_type === "physics_lab"
        ? await buildPhysicsLessonHtml(lesson, state.events)
        : buildStandaloneLessonHtml(lesson, state.events);
      downloadBlob(`${safeFileName(lesson.title)}-互动教材.html`, new Blob([html], { type: "text/html;charset=utf-8" }));
      setStatus("已下载单文件互动教材，可离线打开", "success");
    } catch (error) {
      setStatus(`下载失败：${error.message}，请重试`, "error");
    } finally { elements.downloadHtml.disabled = false; }
  });
  elements.video.addEventListener("click", () => toggleCanvasRecording(state, elements.video, setStatus));

  initGenerationGuidance({
    root,
    onUseExample: (item, mode) => {
      const artifact = mode === "fallback" ? item.fallbackArtifact : item.artifact;
      elements.subject.value = item.subject;
      elements.gradeBand.value = item.grade;
      elements.knowledgePoint.value = item.knowledgePoint;
      elements.learningGoal.value = item.goal;
      elements.preferredArtifact.value = artifact || "";
      elements.quickExample.value = "";
      elements.physicsEngine.value = item.physicsEngine || "auto";
      state.physicsPreset = item.physicsPreset || undefined;
      syncPhysicsField();
      elements.sourceText.value = mode === "fallback"
        ? `原推荐载体为“${item.carrier}”，当前请用“${ARTIFACT_LABELS[artifact] || "现有载体"}”表达其可承载的层级、概念或辨析内容，不要伪装未实现的仿真。`
        : "";
      setStatus(
        mode === "fallback"
          ? `已套用替代方案：${item.knowledgePoint} → ${ARTIFACT_LABELS[artifact]}`
          : `已套用生成指导示例：${item.knowledgePoint}`,
        "success",
      );
      syncComposerSummary();
      if (elements.composerDetails) elements.composerDetails.open = true;
      window.setTimeout(() => {
        elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
        elements.generate.focus();
      }, 0);
    },
    onExploreTechnology: (item) => {
      if (globalThis.AITeacherPortalRuntime?.openWorkspace) globalThis.AITeacherPortalRuntime.openWorkspace("tech-landscape");
      else document.dispatchEvent(new CustomEvent("workspace:navigate", { detail: { view: "tech-landscape" } }));
      window.setTimeout(() => {
        const technologySearch = document.querySelector("#technologySearch");
        if (!technologySearch) return;
        technologySearch.value = item.technology || item.carrier;
        technologySearch.dispatchEvent(new Event("input", { bubbles: true }));
        technologySearch.focus();
      }, 0);
    },
  });

  mountLesson(PHYSICS_LESSON_SAMPLES.inclined_plane, { sample: true });
  void refreshConfig();
  const api = Object.freeze({
    generate,
    mountLesson,
    getLesson: () => state.lesson,
    isBusy: () => state.busy,
    async generateCourseware({ prompt, type = "", subject = "" } = {}) {
      if (state.busy) throw new Error("互动教材正在生成，请等待当前任务完成。");
      const description = String(prompt || "").trim();
      if (!description) throw new Error("请先描述想制作的课件。");
      elements.quickExample.value = "";
      elements.knowledgePoint.value = description.split(/\n/)[0].slice(0, 160);
      elements.learningGoal.value = description.slice(0, 600);
      elements.sourceText.value = description.slice(0, 4000);
      if (subject && [...elements.subject.options].some((option) => option.value === subject)) elements.subject.value = subject;
      elements.preferredArtifact.value = Object.hasOwn(ARTIFACT_LABELS, type) ? type : "";
      state.physicsPreset = undefined;
      syncPhysicsField();
      syncComposerSummary();
      const result = await generate();
      if (!result) throw new Error(elements.status.textContent || "互动教材生成失败。");
      return result;
    },
    async getCourseware() {
      if (!state.lesson || !state.player) return null;
      const lesson = state.events.length ? state.lesson : state.player.getExportLesson();
      const technology = lesson.artifact_type === "physics_lab"
        ? lesson.visualization?.engine === "planck" ? "Planck.js" : "Matter.js"
        : ["function_graph", "projectile_lab", "acid_base_lab"].includes(lesson.artifact_type) ? "Canvas 2D" : "原生 DOM";
      return { title: lesson.title, description: lesson.subtitle || lesson.explanation, subject: lesson.subject, type: lesson.artifact_type, technology, tags: [lesson.grade_band, lesson.knowledge_point].filter(Boolean), interactive: true, lesson: structuredClone(lesson), html: await buildCoursewareLessonHtml(lesson, state.events), source: "saved" };
    }
  });
  lessonLabInstances.set(root, api);
  return api;
}

class LessonPlayer {
  constructor(root, lesson, { onEvent, onReady, onError } = {}) {
    this.onReady = onReady;
    this.onError = onError;
    this.root = root;
    this.lesson = lesson;
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.initialParameters = structuredClone(lesson.visualization.parameters || {});
    this.parameters = structuredClone(this.initialParameters);
    this.cleanup = [];
    this.animationFrame = 0;
    this.runStartedAt = 0;
    this.projectileTime = 0;
    this.projectileRunning = false;
    this.cardIndex = 0;
    this.cardFlipped = false;
  }

  mount() {
    cancelAnimationFrame(this.animationFrame);
    this.physics?.destroy();
    this.root.replaceChildren();
    const shell = create("article", "lesson-player");
    shell.innerHTML = `
      <header class="lesson-player-head">
        <div><span>${escapeHtml(this.lesson.knowledge_point)}</span><h3>${escapeHtml(this.lesson.title)}</h3><p>${escapeHtml(this.lesson.subtitle)}</p></div>
        <em>${escapeHtml(ARTIFACT_LABELS[this.lesson.artifact_type] || "互动教材")}</em>
      </header>
      <div class="lesson-player-grid">
        <section class="lesson-player-canvas" data-lesson-visual></section>
        <details class="lesson-player-guidance">
          <summary>教学引导<span>预测、观察与迁移练习</span></summary>
          <div class="lesson-player-guide">
          <section class="lesson-guide-step is-prediction"><span>1</span><div><b>先预测</b><p>${escapeHtml(this.lesson.guidance.prediction_prompt)}</p></div></section>
          <section class="lesson-guide-step is-observation"><span>2</span><div><b>再观察</b><p>${escapeHtml(this.lesson.guidance.observation_prompt)}</p></div></section>
          <section class="lesson-guide-step is-transfer"><span>3</span><div><b>做迁移</b><p>${escapeHtml(this.lesson.guidance.transfer_question)}</p></div></section>
          <details class="lesson-key-points"><summary>关键结论</summary><ul>${this.lesson.key_points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul></details>
          </div>
        </details>
      </div>`;
    this.root.append(shell);
    this.visual = shell.querySelector("[data-lesson-visual]");
    if (this.lesson.artifact_type === "physics_lab") {
      this.physics = mountPhysicsPlayer(this.visual, { ...this.lesson, guidance: undefined }, { onEvent: this.onEvent, onReady: this.onReady, onError: this.onError });
      this.canvas = this.physics.canvas;
      this.ready = this.physics.ready;
    }
    else if (this.lesson.artifact_type === "function_graph") this.mountFunctionGraph();
    else if (this.lesson.artifact_type === "projectile_lab") this.mountProjectileLab();
    else if (this.lesson.artifact_type === "acid_base_lab") this.mountAcidBaseLab();
    else if (this.lesson.artifact_type === "mindmap") this.mountMindmap();
    else this.mountCards();
  }

  mountFunctionGraph() {
    const preset = this.lesson.visualization.preset;
    const controls = preset === "quadratic"
      ? [["a", "a", -3, 3, 0.1], ["b", "b", -6, 6, 0.1], ["c", "c", -6, 6, 0.1]]
      : preset === "linear"
        ? [["a", "斜率 a", -5, 5, 0.1], ["b", "截距 b", -8, 8, 0.1]]
        : [["amplitude", "振幅 A", 0.2, 4, 0.1], ["frequency", "频率 ω", 0.2, 3, 0.1], ["phase", "相位 φ", -3.14, 3.14, 0.05]];
    this.visual.innerHTML = `<div class="lesson-canvas-wrap"><canvas class="lesson-canvas" width="900" height="520"></canvas><div class="lesson-formula" data-formula></div></div><div class="lesson-controls">${controls.map(([key, label, min, max, step]) => rangeMarkup(key, label, min, max, step, this.parameters[key])).join("")}</div>`;
    this.canvas = this.visual.querySelector("canvas");
    this.formula = this.visual.querySelector("[data-formula]");
    this.bindRanges(() => this.drawFunction());
    this.drawFunction();
  }

  drawFunction() {
    const { canvas } = this;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const sx = width / 20;
    const sy = height / 20;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f8fbff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#e4ebf4";
    ctx.lineWidth = 1;
    for (let i = -10; i <= 10; i += 1) {
      const x = (i + 10) * sx;
      const y = (10 - i) * sy;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.strokeStyle = "#8795a8";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
    const f = this.functionEvaluator();
    ctx.strokeStyle = "#2f6feb";
    ctx.lineWidth = 4;
    ctx.beginPath();
    let started = false;
    for (let px = 0; px <= width; px += 2) {
      const x = px / sx - 10;
      const y = f(x);
      const py = (10 - y) * sy;
      if (!Number.isFinite(py) || py < -height || py > height * 2) { started = false; continue; }
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
    this.formula.textContent = this.functionFormula();
  }

  functionEvaluator() {
    const preset = this.lesson.visualization.preset;
    if (preset === "linear") return (x) => this.parameters.a * x + this.parameters.b;
    if (preset === "sine") return (x) => this.parameters.amplitude * Math.sin(this.parameters.frequency * x + this.parameters.phase);
    return (x) => this.parameters.a * x * x + this.parameters.b * x + this.parameters.c;
  }

  functionFormula() {
    const p = this.parameters;
    const preset = this.lesson.visualization.preset;
    if (preset === "linear") return `y = ${number(p.a)}x ${signed(p.b)}`;
    if (preset === "sine") return `y = ${number(p.amplitude)} sin(${number(p.frequency)}x ${signed(p.phase)})`;
    return `y = ${number(p.a)}x² ${signed(p.b)}x ${signed(p.c)}`;
  }

  mountProjectileLab() {
    const controls = [["initial_speed", "初速度", 5, 60, 1, "m/s"], ["angle", "发射角", 5, 85, 1, "°"], ["gravity", "重力加速度", 1, 20, 0.1, "m/s²"]];
    this.visual.innerHTML = `<div class="lesson-canvas-wrap"><canvas class="lesson-canvas" width="900" height="520"></canvas><div class="lesson-live-metrics" data-metrics></div></div><div class="lesson-controls">${controls.map(([key, label, min, max, step, unit]) => rangeMarkup(key, label, min, max, step, this.parameters[key], unit)).join("")}<div class="lesson-action-row"><button type="button" data-projectile="start">开始发射</button><button type="button" data-projectile="reset">重置</button></div></div>`;
    this.canvas = this.visual.querySelector("canvas");
    this.metrics = this.visual.querySelector("[data-metrics]");
    this.bindRanges(() => this.resetProjectile(false));
    this.visual.querySelector('[data-projectile="start"]').addEventListener("click", () => this.toggleProjectile(true));
    this.visual.querySelector('[data-projectile="reset"]').addEventListener("click", () => this.resetProjectile(true));
    this.drawProjectile(0);
  }

  toggleProjectile(emit = false) {
    this.projectileRunning = !this.projectileRunning;
    const button = this.visual.querySelector('[data-projectile="start"]');
    button.textContent = this.projectileRunning ? "暂停" : this.projectileTime > 0 ? "继续" : "开始发射";
    if (emit) this.emit("action", "projectile", this.projectileRunning ? "start" : "pause");
    if (this.projectileRunning) {
      this.runStartedAt = performance.now() - this.projectileTime * 1_000;
      this.animateProjectile();
    } else cancelAnimationFrame(this.animationFrame);
  }

  animateProjectile() {
    if (!this.projectileRunning) return;
    const flight = this.projectileFlight();
    this.projectileTime = Math.min(flight.totalTime, (performance.now() - this.runStartedAt) / 1_000);
    this.drawProjectile(this.projectileTime);
    if (this.projectileTime >= flight.totalTime) {
      this.projectileRunning = false;
      this.visual.querySelector('[data-projectile="start"]').textContent = "再次发射";
      this.emit("action", "projectile", "landed");
      return;
    }
    this.animationFrame = requestAnimationFrame(() => this.animateProjectile());
  }

  resetProjectile(emit = false) {
    cancelAnimationFrame(this.animationFrame);
    this.projectileRunning = false;
    this.projectileTime = 0;
    this.visual.querySelector('[data-projectile="start"]').textContent = "开始发射";
    this.drawProjectile(0);
    if (emit) this.emit("action", "projectile", "reset");
  }

  projectileFlight() {
    const angle = this.parameters.angle * Math.PI / 180;
    const speed = this.parameters.initial_speed;
    const gravity = this.parameters.gravity;
    return {
      vx: speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
      totalTime: (2 * speed * Math.sin(angle)) / gravity,
      range: (speed * speed * Math.sin(2 * angle)) / gravity,
      maxHeight: (speed * speed * Math.sin(angle) ** 2) / (2 * gravity),
    };
  }

  drawProjectile(time) {
    const ctx = this.canvas.getContext("2d");
    const { width, height } = this.canvas;
    const flight = this.projectileFlight();
    const pad = 56;
    const scaleX = (width - pad * 2) / Math.max(10, flight.range * 1.12);
    const scaleY = (height - pad * 2) / Math.max(6, flight.maxHeight * 1.35);
    const toCanvas = (x, y) => [pad + x * scaleX, height - pad - y * scaleY];
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#eef7ff"); gradient.addColorStop(1, "#ffffff");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#b9c7d8"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, height - pad); ctx.lineTo(width - pad, height - pad); ctx.stroke();
    ctx.strokeStyle = "#8ab3f5"; ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
    ctx.beginPath();
    for (let t = 0; t <= flight.totalTime; t += flight.totalTime / 80) {
      const x = flight.vx * t;
      const y = Math.max(0, flight.vy * t - 0.5 * this.parameters.gravity * t * t);
      const [px, py] = toCanvas(x, y);
      if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.setLineDash([]);
    const x = flight.vx * time;
    const y = Math.max(0, flight.vy * time - 0.5 * this.parameters.gravity * time * time);
    const [px, py] = toCanvas(x, y);
    ctx.fillStyle = "#ff7a45"; ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#17365f"; ctx.font = "600 20px system-ui"; ctx.fillText("发射点", pad, height - 20);
    this.metrics.innerHTML = `<span>射程 <b>${flight.range.toFixed(1)} m</b></span><span>最大高度 <b>${flight.maxHeight.toFixed(1)} m</b></span><span>飞行时间 <b>${flight.totalTime.toFixed(2)} s</b></span>`;
  }

  mountAcidBaseLab() {
    const p = this.parameters;
    const maxAdded = Math.max(40, p.acid_volume_ml * p.acid_concentration / p.base_concentration * 2.2);
    this.visual.innerHTML = `<div class="lesson-canvas-wrap"><canvas class="lesson-canvas" width="900" height="520"></canvas><div class="lesson-live-metrics" data-metrics></div></div><div class="lesson-controls">${rangeMarkup("added_base_ml", "已加 NaOH", 0, maxAdded, 0.2, p.added_base_ml, "mL")}<div class="lesson-action-row"><button type="button" data-titration="drop">+ 1 mL</button><button type="button" data-titration="equivalence">到等当点</button><button type="button" data-titration="reset">重置</button></div></div>`;
    this.canvas = this.visual.querySelector("canvas");
    this.metrics = this.visual.querySelector("[data-metrics]");
    this.bindRanges(() => this.drawTitration());
    this.visual.querySelector('[data-titration="drop"]').addEventListener("click", () => this.setTitrationVolume(this.parameters.added_base_ml + 1, true));
    this.visual.querySelector('[data-titration="equivalence"]').addEventListener("click", () => this.setTitrationVolume(this.equivalenceVolume(), true));
    this.visual.querySelector('[data-titration="reset"]').addEventListener("click", () => this.setTitrationVolume(0, true));
    this.drawTitration();
  }

  equivalenceVolume() {
    return this.parameters.acid_concentration * this.parameters.acid_volume_ml / this.parameters.base_concentration;
  }

  setTitrationVolume(value, emit = false) {
    const input = this.visual.querySelector('[data-parameter="added_base_ml"]');
    const next = Math.min(Number(input.max), Math.max(0, value));
    this.parameters.added_base_ml = next;
    input.value = String(next);
    input.closest("label").querySelector("output").textContent = `${number(next)} mL`;
    this.drawTitration();
    if (emit) this.emit("parameter", "added_base_ml", next);
  }

  titrationPh() {
    const p = this.parameters;
    const acidMoles = p.acid_concentration * p.acid_volume_ml / 1_000;
    const baseMoles = p.base_concentration * p.added_base_ml / 1_000;
    const totalLitres = (p.acid_volume_ml + p.added_base_ml) / 1_000;
    const difference = acidMoles - baseMoles;
    if (Math.abs(difference) < 1e-9) return 7;
    if (difference > 0) return -Math.log10(difference / totalLitres);
    return 14 + Math.log10(-difference / totalLitres);
  }

  drawTitration() {
    const ctx = this.canvas.getContext("2d");
    const { width, height } = this.canvas;
    const ph = Math.min(14, Math.max(0, this.titrationPh()));
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f7fbff"; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#6f7f92"; ctx.lineWidth = 7;
    ctx.strokeRect(380, 45, 70, 235);
    const max = Number(this.visual.querySelector('[data-parameter="added_base_ml"]').max);
    const liquidHeight = 220 * (1 - this.parameters.added_base_ml / max);
    ctx.fillStyle = "#7ac7ff"; ctx.fillRect(387, 52 + 220 - liquidHeight, 56, liquidHeight);
    ctx.fillStyle = "#6f7f92"; ctx.fillRect(411, 280, 8, 76);
    ctx.beginPath(); ctx.moveTo(415, 356); ctx.lineTo(409, 369); ctx.lineTo(421, 369); ctx.closePath(); ctx.fill();
    const pink = ph >= 8.2;
    ctx.beginPath(); ctx.moveTo(300, 382); ctx.lineTo(530, 382); ctx.lineTo(500, 490); ctx.lineTo(330, 490); ctx.closePath();
    ctx.fillStyle = pink ? `rgba(255, 118, 168, ${Math.min(0.78, 0.24 + (ph - 8.2) * 0.1)})` : "rgba(151, 215, 255, .68)";
    ctx.fill(); ctx.strokeStyle = "#6f7f92"; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = "#17365f"; ctx.font = "700 24px system-ui"; ctx.fillText(`pH ${ph.toFixed(2)}`, 600, 205);
    ctx.font = "500 18px system-ui"; ctx.fillText(pink ? "酸碱指示剂显粉色" : ph < 7 ? "酸性溶液" : "中性附近", 600, 242);
    const eq = this.equivalenceVolume();
    this.metrics.innerHTML = `<span>当前 pH <b>${ph.toFixed(2)}</b></span><span>等当体积 <b>${eq.toFixed(1)} mL</b></span><span>现象 <b>${pink ? "显粉色" : "无色"}</b></span>`;
  }

  mountMindmap() {
    const nodes = this.lesson.visualization.nodes;
    const rootNode = nodes.find((node) => !node.parent_id);
    const children = new Map();
    for (const node of nodes) {
      const key = node.parent_id || "__root__";
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(node);
    }
    const renderBranch = (node, depth = 0) => `<li><button type="button" data-node-id="${escapeHtml(node.id)}" style="--depth:${depth}"><span>${escapeHtml(node.label)}</span><small>${escapeHtml(node.detail)}</small></button>${children.has(node.id) ? `<ul>${children.get(node.id).map((child) => renderBranch(child, depth + 1)).join("")}</ul>` : ""}</li>`;
    this.visual.innerHTML = `<div class="lesson-mindmap"><div class="lesson-mindmap-tree"><ul>${renderBranch(rootNode)}</ul></div><aside class="lesson-node-detail"><span>点击节点查看</span><h4>${escapeHtml(rootNode.label)}</h4><p>${escapeHtml(rootNode.detail)}</p></aside></div>`;
    const detail = this.visual.querySelector(".lesson-node-detail");
    this.visual.querySelectorAll("[data-node-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const node = nodes.find((item) => item.id === button.dataset.nodeId);
        this.visual.querySelectorAll("[data-node-id]").forEach((item) => item.classList.toggle("is-active", item === button));
        detail.querySelector("h4").textContent = node.label;
        detail.querySelector("p").textContent = node.detail;
        this.emit("select", "node", node.id);
      });
    });
  }

  mountCards() {
    this.visual.innerHTML = `<div class="lesson-card-deck"><button class="lesson-flashcard" type="button" data-card><span class="lesson-card-face is-front"><small>概念 ${this.cardIndex + 1}</small><b></b><em>点击翻面</em></span><span class="lesson-card-face is-back"><small>解释</small><b></b><em>再点一次返回</em></span></button><div class="lesson-card-nav"><button type="button" data-card-nav="prev">上一张</button><span data-card-progress></span><button type="button" data-card-nav="next">下一张</button></div></div>`;
    this.cardElement = this.visual.querySelector("[data-card]");
    this.cardElement.addEventListener("click", () => this.flipCard(true));
    this.visual.querySelector('[data-card-nav="prev"]').addEventListener("click", () => this.navigateCard(-1, true));
    this.visual.querySelector('[data-card-nav="next"]').addEventListener("click", () => this.navigateCard(1, true));
    this.renderCard();
  }

  renderCard() {
    const cards = this.lesson.visualization.cards;
    const card = cards[this.cardIndex];
    this.cardElement.dataset.accent = card.accent;
    this.cardElement.classList.toggle("is-flipped", this.cardFlipped);
    this.cardElement.querySelector(".is-front small").textContent = `概念 ${this.cardIndex + 1}`;
    this.cardElement.querySelector(".is-front b").textContent = card.front;
    this.cardElement.querySelector(".is-back b").textContent = card.back;
    this.visual.querySelector("[data-card-progress]").textContent = `${this.cardIndex + 1} / ${cards.length}`;
  }

  flipCard(emit = false) {
    this.cardFlipped = !this.cardFlipped;
    this.renderCard();
    if (emit) this.emit("action", "card", this.cardFlipped ? "flip_back" : "flip_front");
  }

  navigateCard(delta, emit = false) {
    const cards = this.lesson.visualization.cards;
    this.cardIndex = (this.cardIndex + delta + cards.length) % cards.length;
    this.cardFlipped = false;
    this.renderCard();
    if (emit) this.emit("select", "card_index", this.cardIndex);
  }

  bindRanges(draw) {
    this.visual.querySelectorAll("[data-parameter]").forEach((input) => {
      input.addEventListener("input", () => {
        const value = Number(input.value);
        this.parameters[input.dataset.parameter] = value;
        const unit = input.dataset.unit || "";
        input.closest("label").querySelector("output").textContent = `${number(value)}${unit ? ` ${unit}` : ""}`;
        draw();
        this.emit("parameter", input.dataset.parameter, value);
      });
    });
  }

  applyEvent(event) {
    if (this.physics) return this.physics.applyEvent(event);
    if (event.type === "parameter") {
      const input = this.visual.querySelector(`[data-parameter="${CSS.escape(event.target)}"]`);
      if (!input) return;
      input.value = String(event.value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (event.type === "select" && event.target === "node") {
      this.visual.querySelector(`[data-node-id="${CSS.escape(String(event.value))}"]`)?.click();
    } else if (event.type === "select" && event.target === "card_index") {
      this.cardIndex = Number(event.value) || 0; this.cardFlipped = false; this.renderCard();
    } else if (event.type === "action" && event.target === "card") {
      this.flipCard(false);
    } else if (event.type === "action" && event.target === "projectile") {
      if (event.value === "reset") this.resetProjectile(false);
      else if (event.value === "start" && !this.projectileRunning) this.toggleProjectile(false);
      else if (event.value === "pause" && this.projectileRunning) this.toggleProjectile(false);
    }
  }

  reset() {
    if (this.physics) return this.physics.reset();
    this.parameters = structuredClone(this.initialParameters);
    this.mount();
  }

  getRecordableCanvas() { return this.physics ? this.physics.getRecordableCanvas() : this.canvas || null; }

  setControlsDisabled(value) { this.physics?.setControlsDisabled(value); }

  getExportLesson() {
    if (!this.physics) return { ...this.lesson, visualization: { ...this.lesson.visualization, parameters: { ...this.parameters } } };
    const snapshot = this.physics?.getSnapshot();
    if (!snapshot?.ready) return this.lesson;
    return { ...this.lesson, visualization: { ...this.lesson.visualization, engine: snapshot.engine, parameters: { ...snapshot.parameters } } };
  }

  emit(type, target, value) { this.onEvent({ type, target, value }); }

  destroy() {
    this.physics?.destroy();
    cancelAnimationFrame(this.animationFrame);
    this.cleanup.splice(0).forEach((dispose) => dispose());
    this.root.replaceChildren();
  }
}

async function readSelectedImage(file, state, elements, setStatus) {
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    setStatus("只支持 PNG、JPEG 或 WebP 图片", "error");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    setStatus("图片不能超过 8 MB", "error");
    return;
  }
  const dataUrl = await fileToDataUrl(file);
  state.image = { mime_type: file.type, data: dataUrl.split(",")[1] };
  elements.imagePreview.src = dataUrl;
  elements.imagePreview.hidden = false;
  elements.imageName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  elements.imageRemove.hidden = false;
  elements.imageDrop.classList.add("has-image");
  setStatus("已添加参考图片，多模态模型将一并理解", "idle");
}

function clearSelectedImage(state, elements) {
  state.image = null;
  elements.imageInput.value = "";
  elements.imagePreview.removeAttribute("src");
  elements.imagePreview.hidden = true;
  elements.imageName.textContent = "上传图片、习题截图或教材页";
  elements.imageRemove.hidden = true;
  elements.imageDrop.classList.remove("has-image");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function renderAgentTrace(container, trace = [], agent = null, sample = false) {
  if (sample) {
    container.innerHTML = `<div class="lesson-trace-empty"><i data-lucide="sparkles"></i><span><b>这是可交互的内置示例</b><small>填写左侧内容后，Pi Agent 会生成新的 Lesson DSL</small></span></div>`;
    return;
  }
  const model = agent?.model || "model";
  container.innerHTML = `<header><span><i data-lucide="workflow"></i><b>Pi Agent 执行轨迹</b></span><small>${escapeHtml(model)}</small></header><ol>${trace.map((item) => `<li><span></span><div><b>${escapeHtml(item.message)}</b><small>${escapeHtml(item.stage)} · ${(Number(item.elapsed_ms || 0) / 1000).toFixed(1)}s</small></div></li>`).join("")}</ol>`;
}

function renderWorkingTrace(container) {
  container.innerHTML = `<header><span><i data-lucide="workflow"></i><b>Pi Agent 执行轨迹</b></span><small>进行中</small></header><ol><li class="is-running"><span></span><div><b>读取教学目标与参考材料</b><small>选择载体→构建 DSL→安全校验</small></div></li></ol>`;
  window.lucide?.createIcons?.();
}

function renderTraceError(container, message) {
  container.innerHTML = `<div class="lesson-trace-empty is-error"><i data-lucide="circle-alert"></i><span><b>本次生成未完成</b><small>${escapeHtml(message)}</small></span></div>`;
  window.lucide?.createIcons?.();
}

function renderRecordButton(button, recording) {
  button.classList.toggle("is-recording", recording);
  button.innerHTML = recording
    ? '<i data-lucide="square"></i><span>停止记录</span>'
    : '<i data-lucide="circle-dot"></i><span>记录操作</span>';
  window.lucide?.createIcons?.();
}

async function replayEvents(state, setStatus) {
  if (!state.player || state.events.length === 0) return;
  stopReplay(state);
  const revision = state.replayRevision;
  const player = state.player;
  state.recording = false;
  state.replaying = true;
  try {
    const ready = await player.reset();
    if (revision !== state.replayRevision || player !== state.player) return;
    if (ready === false) throw new Error("物理引擎未就绪，请重新加载后再回放");
    player.setControlsDisabled(true);
    setStatus(`正在回放 ${state.events.length} 个教学操作…`, "busy");
    const startedAt = performance.now();
    for (const event of [...state.events]) {
      await new Promise((resolve) => {
        state.replayResolve = resolve;
        state.replayTimers.push(window.setTimeout(resolve, Math.max(0, event.at_ms - (performance.now() - startedAt))));
      });
      if (revision !== state.replayRevision || player !== state.player) return;
      const applied = await player.applyEvent(event);
      if (applied === false) throw new Error("记录中的操作未能执行");
    }
    if (revision === state.replayRevision) setStatus("操作回放完成", "success");
  } catch (error) {
    if (revision === state.replayRevision) setStatus(`回放已停止：${error.message}`, "error");
  } finally {
    if (revision === state.replayRevision) { state.replaying = false; player.setControlsDisabled(false); }
  }
}

function stopReplay(state) {
  state.replayRevision += 1;
  state.replaying = false;
  state.replayTimers.splice(0).forEach((timer) => window.clearTimeout(timer));
  state.replayResolve?.();
  state.replayResolve = null;
  state.player?.setControlsDisabled(false);
}

function toggleCanvasRecording(state, button, setStatus) {
  if (state.mediaRecorder?.state === "recording") {
    state.mediaRecorder.stop();
    return;
  }
  const canvas = state.player?.getRecordableCanvas();
  if (!canvas?.captureStream || typeof MediaRecorder === "undefined") {
    setStatus("当前浏览器不支持画布录像", "error");
    return;
  }
  const chunks = [];
  const recordingTitle = state.lesson.title;
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, {
    mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm",
  });
  state.mediaRecorder = recorder;
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    if (state.mediaRecorder === recorder) state.mediaRecorder = null;
    downloadBlob(
      `${safeFileName(recordingTitle)}-演示录像.webm`,
      new Blob(chunks, { type: recorder.mimeType || "video/webm" }),
    );
    button.classList.remove("is-recording");
    button.innerHTML = '<i data-lucide="video"></i><span>录制画面</span>';
    setStatus("演示录像已下载", "success");
    window.lucide?.createIcons?.();
  };
  recorder.start(250);
  button.classList.add("is-recording");
  button.innerHTML = '<i data-lucide="square"></i><span>停止录像</span>';
  setStatus("正在录制可视化画布，请开始操作", "recording");
  window.lucide?.createIcons?.();
}

function buildStandaloneLessonHtml(lesson, events) {
  const safePayload = JSON.stringify({ lesson, events }).replace(/</gu, "\\u003c");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"> <title>${escapeHtml(lesson.title)}</title><style>${standaloneStyles()}</style></head><body><main id="app"></main><script>const payload=${safePayload};(${standaloneBootstrap.toString()})(payload);<\/script></body></html>`;
}

function standaloneStyles() {
  return `*{box-sizing:border-box}body{margin:0;background:#f2f6fb;color:#172b4d;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}main{width:min(1120px,calc(100% - 32px));margin:32px auto}.head,.panel{background:#fff;border:1px solid #dce5f0;border-radius:18px;box-shadow:0 14px 40px #17365f12}.head{padding:24px 28px;margin-bottom:16px}.head span{color:#2f6feb;font-size:13px;font-weight:700}.head h1{margin:5px 0 6px;font-size:28px}.head p{margin:0;color:#66758a}.panel{padding:20px}.grid{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:18px}canvas{width:100%;height:auto;border-radius:14px;background:#f8fbff}.controls{display:grid;gap:12px;margin-top:14px}.controls label{display:grid;grid-template-columns:130px 1fr 78px;gap:10px;align-items:center;font-size:14px}.controls input{width:100%}.guide{display:grid;gap:10px}.guide section{padding:14px;border-radius:12px;background:#f5f8fc}.guide b{display:block;margin-bottom:4px}.guide p{margin:0;color:#5b6b80;font-size:13px;line-height:1.6}.actions{display:flex;gap:8px;margin-top:14px}button{border:1px solid #cfd9e7;background:#fff;border-radius:10px;padding:10px 14px;cursor:pointer}button.primary{background:#2f6feb;color:white;border-color:#2f6feb}.mind{display:grid;gap:10px}.mind button{text-align:left}.cards{display:grid;place-items:center;min-height:420px}.card{width:min(520px,90%);min-height:260px;padding:36px;font-size:22px}.card small{display:block;color:#2f6feb;margin-bottom:24px}.card p{font-size:16px;color:#56667a}.nav{display:flex;gap:10px;align-items:center;justify-content:center;margin-top:14px}@media(max-width:780px){.grid{grid-template-columns:1fr}.controls label{grid-template-columns:90px 1fr 64px}}`;
}

function standaloneBootstrap(payload) {
  const { lesson, events } = payload;
  const app = document.querySelector("#app");
  const p = { ...(lesson.visualization.parameters || {}) };
  const h = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  app.innerHTML = `<header class="head"><span>${h(lesson.subject)} · ${h(lesson.grade_band)}</span><h1>${h(lesson.title)}</h1><p>${h(lesson.subtitle)}</p></header><section class="panel"><div class="grid"><div id="visual"></div><aside class="guide"><section><b>先预测</b><p>${h(lesson.guidance.prediction_prompt)}</p></section><section><b>再观察</b><p>${h(lesson.guidance.observation_prompt)}</p></section><section><b>做迁移</b><p>${h(lesson.guidance.transfer_question)}</p></section></aside></div><div class="actions"><button id="replay">回放记录</button><button class="primary" onclick="window.print()">打印 / 导出 PDF</button></div></section>`;
  const visual = document.querySelector("#visual");
  let canvas, ctx, running = false, started = 0, time = 0, cardIndex = 0, flipped = false;
  const range = (key, label, min, max, step, unit = "") => `<label><span>${label}</span><input data-p="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${p[key]}"><output>${Number(p[key]).toFixed(1)} ${unit}</output></label>`;
  function bind(draw) { document.querySelectorAll("[data-p]").forEach((input) => input.oninput = () => { p[input.dataset.p] = Number(input.value); input.nextElementSibling.textContent = `${Number(input.value).toFixed(1)} ${input.dataset.unit || ""}`; draw(); }); }
  function graph() { const preset = lesson.visualization.preset; const controls = preset === "quadratic" ? range("a","a",-3,3,.1)+range("b","b",-6,6,.1)+range("c","c",-6,6,.1) : preset === "linear" ? range("a","斜率 a",-5,5,.1)+range("b","截距 b",-8,8,.1) : range("amplitude","振幅",.2,4,.1)+range("frequency","频率",.2,3,.1)+range("phase","相位",-3.14,3.14,.05); visual.innerHTML=`<canvas width="900" height="520"></canvas><div class="controls">${controls}</div>`; canvas=visual.querySelector("canvas");ctx=canvas.getContext("2d");bind(drawGraph);drawGraph(); }
  function drawGraph(){const w=canvas.width,hg=canvas.height,sx=w/20,sy=hg/20;ctx.fillStyle="#f8fbff";ctx.fillRect(0,0,w,hg);ctx.strokeStyle="#e3ebf4";ctx.lineWidth=1;for(let i=-10;i<=10;i++){ctx.beginPath();ctx.moveTo((i+10)*sx,0);ctx.lineTo((i+10)*sx,hg);ctx.stroke();ctx.beginPath();ctx.moveTo(0,(10-i)*sy);ctx.lineTo(w,(10-i)*sy);ctx.stroke()}ctx.strokeStyle="#7c8da3";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(w/2,0);ctx.lineTo(w/2,hg);ctx.moveTo(0,hg/2);ctx.lineTo(w,hg/2);ctx.stroke();const preset=lesson.visualization.preset;const f=(x)=>preset==="linear"?p.a*x+p.b:preset==="sine"?p.amplitude*Math.sin(p.frequency*x+p.phase):p.a*x*x+p.b*x+p.c;ctx.strokeStyle="#2f6feb";ctx.lineWidth=4;ctx.beginPath();let s=false;for(let px=0;px<=w;px+=2){const py=(10-f(px/sx-10))*sy;if(py<-hg||py>hg*2){s=false;continue}if(!s){ctx.moveTo(px,py);s=true}else ctx.lineTo(px,py)}ctx.stroke()}
  function projectile(){visual.innerHTML=`<canvas width="900" height="520"></canvas><div class="controls">${range("initial_speed","初速度",5,60,1,"m/s")}${range("angle","发射角",5,85,1,"°")}${range("gravity","重力加速度",1,20,.1,"m/s²")}</div><div class="actions"><button id="launch">开始 / 暂停</button></div>`;canvas=visual.querySelector("canvas");ctx=canvas.getContext("2d");bind(()=>{time=0;drawProjectile(0)});document.querySelector("#launch").onclick=()=>{running=!running;if(running){started=performance.now()-time*1000;requestAnimationFrame(tick)}};drawProjectile(0)}
  function flight(){const a=p.angle*Math.PI/180,v=p.initial_speed,g=p.gravity;return{vx:v*Math.cos(a),vy:v*Math.sin(a),total:2*v*Math.sin(a)/g,range:v*v*Math.sin(2*a)/g,height:v*v*Math.sin(a)**2/(2*g)}}
  function drawProjectile(t){const f=flight(),w=canvas.width,hg=canvas.height,pad=55,sx=(w-2*pad)/Math.max(10,f.range*1.12),sy=(hg-2*pad)/Math.max(6,f.height*1.35),xy=(x,y)=>[pad+x*sx,hg-pad-y*sy];ctx.fillStyle="#f4f9ff";ctx.fillRect(0,0,w,hg);ctx.strokeStyle="#93baf3";ctx.setLineDash([8,8]);ctx.beginPath();for(let q=0;q<=f.total;q+=f.total/70){const [x,y]=xy(f.vx*q,Math.max(0,f.vy*q-.5*p.gravity*q*q));q?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke();ctx.setLineDash([]);const[x,y]=xy(f.vx*t,Math.max(0,f.vy*t-.5*p.gravity*t*t));ctx.fillStyle="#ff7a45";ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.fill()}
  function tick(){if(!running)return;const f=flight();time=Math.min(f.total,(performance.now()-started)/1000);drawProjectile(time);if(time>=f.total){running=false;return}requestAnimationFrame(tick)}
  function titration(){const max=Math.max(40,p.acid_volume_ml*p.acid_concentration/p.base_concentration*2.2);visual.innerHTML=`<canvas width="900" height="520"></canvas><div class="controls">${range("added_base_ml","已加 NaOH",0,max,.2,"mL")}</div>`;canvas=visual.querySelector("canvas");ctx=canvas.getContext("2d");bind(drawTitration);drawTitration()}
  function drawTitration(){const acid=p.acid_concentration*p.acid_volume_ml/1000,base=p.base_concentration*p.added_base_ml/1000,total=(p.acid_volume_ml+p.added_base_ml)/1000,d=acid-base,ph=Math.abs(d)<1e-9?7:d>0?-Math.log10(d/total):14+Math.log10(-d/total);ctx.fillStyle="#f7fbff";ctx.fillRect(0,0,900,520);ctx.strokeStyle="#6f7f92";ctx.lineWidth=6;ctx.strokeRect(380,45,70,235);ctx.beginPath();ctx.moveTo(300,380);ctx.lineTo(530,380);ctx.lineTo(500,490);ctx.lineTo(330,490);ctx.closePath();ctx.fillStyle=ph>=8.2?"#f59abb":"#9bd6f5";ctx.fill();ctx.stroke();ctx.fillStyle="#17365f";ctx.font="700 28px system-ui";ctx.fillText(`pH ${Math.max(0,Math.min(14,ph)).toFixed(2)}`,600,220)}
  function mindmap(){const nodes=lesson.visualization.nodes;visual.innerHTML=`<div class="mind">${nodes.map(n=>`<button data-node="${h(n.id)}" style="margin-left:${n.parent_id?32:0}px"><b>${h(n.label)}</b><p>${h(n.detail)}</p></button>`).join("")}</div>`}
  function cards(){visual.innerHTML=`<div class="cards"><button class="card" id="card"></button><div class="nav"><button id="prev">上一张</button><span id="progress"></span><button id="next">下一张</button></div></div>`;document.querySelector("#card").onclick=()=>{flipped=!flipped;drawCard()};document.querySelector("#prev").onclick=()=>{cardIndex=(cardIndex-1+lesson.visualization.cards.length)%lesson.visualization.cards.length;flipped=false;drawCard()};document.querySelector("#next").onclick=()=>{cardIndex=(cardIndex+1)%lesson.visualization.cards.length;flipped=false;drawCard()};drawCard()}
  function drawCard(){const c=lesson.visualization.cards[cardIndex];document.querySelector("#card").innerHTML=flipped?`<small>解释</small><p>${h(c.back)}</p>`:`<small>概念</small><b>${h(c.front)}</b>`;document.querySelector("#progress").textContent=`${cardIndex+1} / ${lesson.visualization.cards.length}`}
  if(lesson.artifact_type==="function_graph")graph();else if(lesson.artifact_type==="projectile_lab")projectile();else if(lesson.artifact_type==="acid_base_lab")titration();else if(lesson.artifact_type==="mindmap")mindmap();else cards();
  document.querySelector("#replay").onclick=()=>{for(const e of events||[]){setTimeout(()=>{const input=document.querySelector(`[data-p="${e.target}"]`);if(e.type==="parameter"&&input){input.value=e.value;input.dispatchEvent(new Event("input"))}},e.at_ms)}};
}

function rangeMarkup(key, label, min, max, step, value, unit = "") {
  return `<label class="lesson-range"><span>${escapeHtml(label)}</span><input type="range" data-parameter="${key}" data-unit="${escapeHtml(unit)}" min="${min}" max="${max}" step="${step}" value="${value}"><output>${number(value)}${unit ? ` ${escapeHtml(unit)}` : ""}</output></label>`;
}

function create(tag, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function number(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}

function signed(value) { return Number(value) < 0 ? `- ${number(Math.abs(value))}` : `+ ${number(value)}`; }

function safeFileName(value) {
  return String(value || "互动教材").replace(/[\\/:*?"<>|]/gu, "-").slice(0, 60);
}

function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
