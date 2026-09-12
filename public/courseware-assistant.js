import { getInteractiveLessonLab } from "./interactive-lesson-lab.js";
import { getVideoExplanationWorkbench } from "./video-explanation-workbench.js";
import { saveCourseware } from "./courseware-store.js";
import { buildGeometryCourseware, mountGeometryCourseware, GEOMETRY_SCOPE } from "./courseware-geometry.js";

const mounts = new WeakMap();
const TYPES = [
  ["auto", "自动规划（推荐）", "interactive"],
  ["function_graph", "互动函数图", "interactive"],
  ["physics_lab", "物理参数实验", "interactive"],
  ["projectile_lab", "抛体运动实验", "interactive"],
  ["acid_base_lab", "酸碱滴定实验", "interactive"],
  ["mindmap", "互动思维导图", "interactive"],
  ["concept_cards", "概念翻转卡", "interactive"],
  ["geometry", "平面几何（直角三角形 / 圆）", "geometry"],
  ["video", "讲解视频", "video"],
  ["deeptutor", "DeepTutor 教材", "materials"],
  ["openmaic", "OpenMAIC 课件", "materials"],
  ["koji", "渐进辅导素材", "materials"],
  ["cell_studio", "细胞空间探索", "materials"],
];
const LABELS = Object.fromEntries(TYPES.map(([key, title]) => [key, title]));
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const COURSEWARE_AGENT_CONFIG_URL = "/api/courseware-agent/config";
const COURSEWARE_AGENT_PLAN_URL = "/api/courseware-agent/plan";

export function suggestCoursewareType(prompt = "") {
  const value = String(prompt);
  if (/视频|讲解片|旁白|分镜/.test(value) && !/(?:不|无需|不要|避免|取消)[^。；，,]{0,10}(?:视频|讲解片|旁白|分镜)/.test(value)) return { type: "video", subject: "通用", reason: "适合连续讲解；需要上传教材，再审阅分镜和合成成片。" };
  if (/抛体|抛物运动|投掷|射程/.test(value)) return { type: "projectile_lab", subject: "物理", reason: "改变发射参数，观察运动轨迹与射程。" };
  if (/滴定|酸碱|pH|ph值/.test(value)) return { type: "acid_base_lab", subject: "化学", reason: "适合调节滴加量，观察酸碱变化。" };
  if (/斜面|摩擦|单摆|摆长|碰撞|动量|力学|牛顿|合外力|加速度|F\s*=\s*ma/i.test(value)) return { type: "physics_lab", subject: "物理", reason: "适合控制变量，观察确定性物理实验。" };
  if (/几何|三角形|勾股|毕达哥拉斯|圆|扇形|矩形|正方形|多边形|全等|相似/.test(value)) return { type: "geometry", subject: "数学", reason: `${GEOMETRY_SCOPE}使用本地模板搭建。` };
  if (/函数|抛物线|二次|一次|正弦|余弦|斜率/.test(value)) return { type: "function_graph", subject: "数学", reason: "拖动参数可以直接比较函数图像变化。" };
  if (/记忆|单词|词汇|辨析|翻转|概念卡/.test(value)) return { type: "concept_cards", subject: /英语|单词|词汇/.test(value) ? "英语" : "通用", reason: "适合先回忆，再翻卡核对概念和例子。" };
  return { type: "mindmap", subject: "通用", reason: "可先用知识结构组织概念，也可手动选择其他已有类型。" };
}

export function mountCoursewareAssistant({ root = document.querySelector("#coursewareAssistantWorkspace"), materials = null } = {}) {
  if (!root) return null;
  if (mounts.has(root)) return mounts.get(root);
  const doc = root.ownerDocument;
  const interactive = getInteractiveLessonLab();
  const video = getVideoExplanationWorkbench();
  const panels = {
    interactive: doc.querySelector("#interactiveLessonWorkspace"),
    video: doc.querySelector("#videoExplanationWorkspace"),
    materials: doc.querySelector("#knowledgeMaterialsWorkspace"),
    geometry: doc.createElement("section"),
  };
  panels.geometry.className = "ca-geometry-editor";
  panels.geometry.innerHTML = `<p class="ca-geometry-boundary">${GEOMETRY_SCOPE}使用本地模板搭建，可调整参数后保存。</p><div data-ca-geometry-player><p class="ca-geometry-empty">先选择“直角三角形勾股关系”示例，或描述圆与扇形的教学目标，再点击搭建模板。</p></div>`;
  root.classList.add("courseware-assistant-workspace");
  root.innerHTML = `
    <header class="ca-head"><div><h2>课件助手</h2><p>说清教学目标，系统按复杂度规划，并交给已接入的制作能力执行。</p></div><div class="ca-head-actions"><span class="ca-runtime-badge" data-ca-agent-badge data-state="checking" role="status"><i data-lucide="route" aria-hidden="true"></i><span>正在检查规划引擎</span></span><button class="btn" type="button" data-ca-library>${icon("library-big")}<span>课件库</span></button></div></header>
    <nav class="ca-mobile-tabs" role="tablist" aria-label="课件助手面板"><button class="btn" type="button" role="tab" data-ca-pane="history" aria-selected="false" aria-controls="coursewareAssistantHistory">任务</button><button class="btn" type="button" role="tab" data-ca-pane="compose" aria-selected="true" aria-controls="coursewareAssistantCompose">对话</button><button class="btn" type="button" role="tab" data-ca-pane="preview" aria-selected="false" aria-controls="coursewareAssistantResults">产物</button></nav>
    <div class="ca-layout">
      <aside id="coursewareAssistantHistory" class="ca-history" data-ca-surface="history">
        <header class="ca-history-head"><div><b>制作任务</b><span data-ca-task-count>0 项</span></div><button class="btn" type="button" data-ca-new aria-label="新建课件任务">${icon("square-pen")}<span>新建</span></button></header>
        <details class="ca-task-disclosure" open><summary>任务记录 <span data-ca-task-summary>0 项</span></summary><section class="ca-tasks" aria-labelledby="coursewareAssistantTasksTitle"><h3 id="coursewareAssistantTasksTitle" class="ca-visually-hidden">课件制作任务</h3><div data-ca-tasks><p class="ca-tasks-empty">新任务会保留在这里，方便继续修改和保存。</p></div></section></details>
        <footer class="ca-history-foot"><i data-lucide="shield-check" aria-hidden="true"></i><span>付费图片与视频仍需在对应编辑器中明确触发。</span></footer>
      </aside>
      <section id="coursewareAssistantCompose" class="ca-side" data-ca-surface="compose" aria-label="课件创作对话">
        <header class="ca-thread-head"><div><h3 data-ca-thread-title>新建课件</h3><p>目标、执行步骤和修改记录</p></div><span><i data-lucide="sparkles" aria-hidden="true"></i>自动选型</span></header>
        <div class="ca-thread" data-ca-thread aria-live="polite"></div>
        <form class="ca-composer" data-ca-form>
          <label class="ca-prompt-label" for="coursewareAssistantPrompt">告诉课件助手你的目标</label>
          <div class="ca-prompt-box"><textarea id="coursewareAssistantPrompt" rows="3" maxlength="4000" placeholder="例如：给八年级做一个斜面摩擦实验，让学生先预测，再调参数观察，最后完成一道迁移题。"></textarea><div class="ca-composer-tools"><button class="btn btn-ghost" type="button" data-ca-voice aria-pressed="false" title="语音输入">${icon("mic")}<span>语音</span></button><details class="ca-production-options"><summary>${icon("sliders-horizontal")}<span>制作约束</span></summary><div><label class="ca-type-field" for="coursewareAssistantType"><span>指定交付方式</span><select id="coursewareAssistantType" class="form-select">${TYPES.map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></label><p>自动规划会先匹配已接入能力；手动指定只在你有明确交付约束时使用。</p></div></details><button class="btn btn-primary ca-submit" type="submit" data-ca-submit>${icon("arrow-up")}<span>开始制作</span></button></div></div>
          <div class="ca-example-actions" aria-label="需求示例"><button class="btn btn-ghost" type="button" data-ca-example="制作二次函数参数实验，让学生拖动 a、b、c 观察图像开口和位置的变化。">函数实验</button><button class="btn btn-ghost" type="button" data-ca-example="给八年级学生制作斜面与摩擦实验，比较倾角和摩擦系数对运动的影响。">物理实验</button><button class="btn btn-ghost" type="button" data-ca-example="直角三角形勾股关系：调节两条直角边，比较斜边与面积。">几何探究</button><button class="btn btn-ghost" type="button" data-ca-example="制作英语一般过去时概念翻转卡，比较规则动词与不规则动词，并配上例句。">概念卡片</button></div>
          <p class="ca-suggestion" data-ca-suggestion></p>
          <p class="ca-form-status" data-ca-status role="status" aria-live="polite"></p>
        </form>
      </section>
      <section id="coursewareAssistantResults" class="ca-results" data-ca-surface="preview" aria-labelledby="coursewareAssistantResultTitle">
        <header class="ca-results-head"><div><span data-ca-result-kicker>示例产物</span><h3 id="coursewareAssistantResultTitle" tabindex="-1">互动课件</h3><p data-ca-result-note>先体验内置示例；任务完成后，这里会切换为本次生成结果。</p></div><button class="btn btn-primary" type="button" data-ca-save>${icon("bookmark-plus")}<span>保存到课件库</span></button></header>
        <p class="ca-save-status" data-ca-save-status role="status" aria-live="polite" hidden></p>
        <div class="ca-engine-mount" data-ca-engine-mount></div>
      </section>
    </div>`;
  const nodes = {
    prompt: root.querySelector("#coursewareAssistantPrompt"), type: root.querySelector("#coursewareAssistantType"),
    suggestion: root.querySelector("[data-ca-suggestion]"), submit: root.querySelector("[data-ca-submit]"), status: root.querySelector("[data-ca-status]"),
    tasks: root.querySelector("[data-ca-tasks]"), count: root.querySelector("[data-ca-task-count]"), note: root.querySelector("[data-ca-result-note]"),
    save: root.querySelector("[data-ca-save]"), saveStatus: root.querySelector("[data-ca-save-status]"), mount: root.querySelector("[data-ca-engine-mount]"),
    resultTitle: root.querySelector("#coursewareAssistantResultTitle"), resultKicker: root.querySelector("[data-ca-result-kicker]"), thread: root.querySelector("[data-ca-thread]"),
    threadTitle: root.querySelector("[data-ca-thread-title]"), voice: root.querySelector("[data-ca-voice]"), agentBadge: root.querySelector("[data-ca-agent-badge]"),
  };
  const fetchImpl = typeof doc.defaultView?.fetch === "function" ? doc.defaultView.fetch.bind(doc.defaultView) : null;
  const state = { tool: "interactive", tasks: [], selectedId: "", active: {}, saving: false, planning: false, listening: false, recognition: null, materialBundle: null, videoDraftId: "", geometryItem: null, geometryPlayer: null, agentConfig: null };
  Object.entries(panels).forEach(([tool, panel]) => {
    if (!panel) return;
    panel.dataset.coursewareEmbedded = "true";
    panel.removeAttribute("data-workspace-panel");
    panel.classList.add("courseware-engine");
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", { interactive: "互动教材编辑器", video: "视频编辑器", materials: "素材编辑器", geometry: "平面几何编辑器" }[tool]);
    panel.hidden = tool !== state.tool;
    nodes.mount.append(panel);
  });
  const lessonSettings = panels.interactive?.querySelector("#lessonComposerDetails");
  if (lessonSettings) lessonSettings.open = false;
  const guidanceTrigger = panels.interactive?.querySelector("#generationGuidanceOpen");
  const lessonForm = panels.interactive?.querySelector("#interactiveLessonForm");
  if (guidanceTrigger && lessonForm) {
    const guidanceRow = doc.createElement("div");
    guidanceRow.className = "ca-generation-guidance";
    guidanceRow.append(guidanceTrigger);
    lessonForm.prepend(guidanceRow);
  }
  panels.interactive?.querySelector("#lessonPreviewTitle")?.classList.add("ca-visually-hidden");
  const materialComposer = panels.materials?.querySelector(".material-composer");
  if (materialComposer) {
    const details = doc.createElement("details");
    details.className = "ca-native-settings";
    details.innerHTML = "<summary>素材参数与参考内容</summary>";
    materialComposer.before(details);
    details.append(materialComposer);
  }
  const videoRail = panels.video?.querySelector(".vex-project-rail");
  if (videoRail) {
    const details = doc.createElement("details");
    details.className = "ca-native-settings ca-video-projects";
    details.innerHTML = "<summary>视频项目记录</summary>";
    videoRail.closest(".vex-layout").before(details);
    details.append(videoRail);
  }
  const icons = () => doc.defaultView.lucide?.createIcons?.({ root, attrs: { "stroke-width": 1.8 } });
  const taskDisclosure = root.querySelector(".ca-task-disclosure");
  const savedPreview = doc.createElement("section");
  savedPreview.className = "ca-saved-preview";
  savedPreview.hidden = true;
  nodes.mount.prepend(savedPreview);
  const taskById = (id) => state.tasks.find((task) => task.id === id);
  const statusText = { running: "处理中", waiting: "待继续制作", completed: "已生成", failed: "失败" };
  const phaseText = { pending: "等待", running: "进行中", completed: "完成", failed: "失败", waiting: "待确认" };
  const chosenType = () => nodes.type.value === "auto" ? suggestCoursewareType(nodes.prompt.value).type : nodes.type.value;
  const toolForType = (type) => TYPES.find(([key]) => key === type)?.[2] || "interactive";
  const capabilityNote = (type, tool) => tool === "video" ? "视频项目、分镜与合成链路"
    : tool === "geometry" ? "本地 SVG 几何模板与参数播放器"
      : tool === "materials" ? `${LABELS[type] || "素材"}生成器与内容快照`
        : `${LABELS[type] || "互动课件"}与确定性浏览器运行时`;
  function buildPlan(type, tool, status = "running", agentPlan = null) {
    return [
      { id: "understand", label: "理解目标", detail: agentPlan?.goal_summary || "提取学科、知识主题、学习活动与交付要求", status: "completed" },
      { id: "route", label: "匹配能力", detail: agentPlan?.rationale ? `${capabilityNote(type, tool)}。${agentPlan.rationale}` : capabilityNote(type, tool), status: "completed" },
      { id: "produce", label: "生成产物", detail: tool === "video" ? "等待教师补充教材并确认分镜" : "调用项目内已接入的制作执行器", status: status === "completed" ? "completed" : status === "waiting" ? "waiting" : "running" },
      { id: "verify", label: "检查交付", detail: "检查结构、交互和保存条件", status: status === "completed" ? "completed" : "pending" },
    ];
  }
  function updatePlan(task, phase, status, detail = "") {
    const item = task?.plan?.find((step) => step.id === phase);
    if (!item) return;
    item.status = status;
    if (detail) item.detail = detail;
  }
  function appendTaskMessage(task, role, text) {
    const message = String(text || "").trim();
    if (!task || !message) return;
    task.messages ||= [];
    const previous = task.messages.at(-1);
    if (previous?.role === role && previous.text === message) return;
    task.messages.push({ role, text: message });
  }
  function setPane(pane) {
    root.dataset.caPane = pane;
    root.querySelectorAll("[data-ca-pane]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.caPane === pane)));
  }
  function setStatus(message = "", kind = "idle") {
    nodes.status.textContent = message;
    nodes.status.dataset.state = kind;
  }
  function updateAgentBadge(config = null, kind = "ready") {
    state.agentConfig = config;
    nodes.agentBadge.dataset.state = kind;
    const label = kind === "error" ? "规划服务不可用 · 自动回退"
      : config?.mode === "off" ? "本地领域执行器"
        : config?.configured ? "Deep Agents JS · 按需规划"
          : "领域执行器 · Agent 待配置";
    nodes.agentBadge.querySelector("span").textContent = label;
  }
  async function loadAgentConfig() {
    if (!fetchImpl) { updateAgentBadge({ mode: "off", configured: false }); return null; }
    try {
      const response = await fetchImpl(COURSEWARE_AGENT_CONFIG_URL, { cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json();
      updateAgentBadge(config);
      return config;
    } catch {
      updateAgentBadge(null, "error");
      return null;
    }
  }
  async function requestAgentPlan(prompt) {
    if (!fetchImpl) return null;
    const AbortControllerImpl = doc.defaultView?.AbortController;
    const controller = AbortControllerImpl ? new AbortControllerImpl() : null;
    const schedule = doc.defaultView?.setTimeout?.bind(doc.defaultView) || globalThis.setTimeout;
    const cancelSchedule = doc.defaultView?.clearTimeout?.bind(doc.defaultView) || globalThis.clearTimeout;
    const timeout = controller && schedule ? schedule(() => controller.abort(), 65_000) : null;
    try {
      const response = await fetchImpl(COURSEWARE_AGENT_PLAN_URL, {
        method: "POST",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ prompt, requested_type: "auto" }),
        signal: controller?.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `规划服务返回 HTTP ${response.status}`);
      return payload;
    } finally {
      if (timeout !== null) cancelSchedule?.(timeout);
    }
  }
  function renderThread() {
    const task = taskById(state.selectedId);
    nodes.threadTitle.textContent = task?.title || "新建课件";
    if (!task) {
      nodes.thread.innerHTML = `<div class="ca-thread-empty">${icon("sparkles")}<div><b>描述你想完成的教学任务</b><p>系统会拆解目标、匹配现有能力、执行制作，并把可操作的产物放在右侧。</p></div></div>`;
      icons();
      return;
    }
    const messages = task.messages || [];
    const deepPlanned = task.plannerEngine === "langchain_deepagents_js";
    nodes.thread.innerHTML = `<div class="ca-messages">${messages.map((message) => `<article class="ca-message" data-role="${esc(message.role)}"><span>${message.role === "user" ? "你" : icon("sparkles")}</span><div><b>${message.role === "user" ? "制作要求" : "课件助手"}</b><p>${esc(message.text)}</p></div></article>`).join("")}</div>
      <section class="ca-plan" aria-label="执行计划"><header><div><span>${deepPlanned ? "Deep Agents JS 规划" : "本地执行计划"}</span><b>${task.plan?.filter((item) => item.status === "completed").length || 0}/${task.plan?.length || 4}</b></div><small>${deepPlanned ? "Agent 负责受控选型，项目内执行器负责生成和校验" : "项目内确定性路由与领域执行器"}</small></header><ol>${(task.plan || []).map((step) => `<li data-state="${esc(step.status)}"><i>${step.status === "completed" ? icon("check") : step.status === "failed" ? icon("x") : step.status === "running" ? icon("loader-circle") : icon("circle")}</i><div><b>${esc(step.label)}</b><p>${esc(step.detail)}</p></div><em>${phaseText[step.status] || step.status}</em></li>`).join("")}</ol></section>
      <div class="ca-followups" aria-label="继续修改"><span>继续修改</span><button class="btn btn-ghost" type="button" data-ca-followup="保留当前结构，降低文字密度并增加课堂提问。">降低文字密度</button><button class="btn btn-ghost" type="button" data-ca-followup="基于当前主题再做一个难度更高的迁移活动。">增加迁移活动</button></div>`;
    nodes.thread.scrollTop = nodes.thread.scrollHeight;
    icons();
  }
  function renderTasks() {
    nodes.count.textContent = `${state.tasks.length} 项`;
    root.querySelector("[data-ca-task-summary]").textContent = `${state.tasks.length} 项`;
    nodes.tasks.innerHTML = state.tasks.length ? state.tasks.map((task) => `<button type="button" class="ca-task ${task.id === state.selectedId ? "is-selected" : ""}" data-ca-task="${esc(task.id)}" aria-pressed="${task.id === state.selectedId}"><span class="ca-task-top"><b>${esc(task.title)}</b><em data-state="${task.status}">${task.type === "geometry" && task.status === "completed" ? "已搭建" : statusText[task.status] || "待继续制作"}</em></span><small>${esc(task.message || LABELS[task.type] || "课件制作")}</small></button>`).join("") : '<p class="ca-tasks-empty">提交需求后，这里显示真实进度与生成结果。</p>';
    renderThread();
    syncSave();
  }
  function createTask({ id = globalThis.crypto?.randomUUID?.() || `courseware-${Date.now()}`, title, type, tool, status = "running", message = "", prompt = "", plannerEngine = "deterministic_domain_router", agentPlan = null, fallbackNotice = "", subject = "" }) {
    const existing = taskById(id);
    const task = Object.assign(existing || {}, { id, title, type, tool, status, message, plannerEngine, agentPlan, fallbackNotice, subject, createdAt: existing?.createdAt || new Date().toISOString() });
    task.plan ||= buildPlan(type, tool, status, agentPlan);
    task.messages ||= prompt ? [
      { role: "user", text: prompt },
      { role: "assistant", text: fallbackNotice || (plannerEngine === "langchain_deepagents_js" ? `Deep Agents JS 已完成受控规划，推荐“${LABELS[type] || type}”：${agentPlan?.rationale || "已匹配现有执行器。"}` : `已通过本地路由选择“${LABELS[type] || "自动规划"}”，将按理解目标、能力匹配、制作和检查四步推进。`) },
    ] : [];
    if (!existing) state.tasks.unshift(task);
    state.selectedId = id;
    renderTasks();
    return task;
  }
  function syncSave() {
    const selected = taskById(state.selectedId);
    nodes.resultKicker.textContent = selected ? "当前产物" : "示例产物";
    nodes.resultTitle.textContent = !savedPreview.hidden && selected?.courseware ? selected.courseware.title : state.tool === "interactive" ? interactive?.getLesson()?.title || "互动课件"
      : state.tool === "video" ? video?.getProject()?.title || "视频制作" : state.tool === "geometry" ? state.geometryItem?.title || "平面几何" : "素材制作";
    const pending = selected?.tool === state.tool && selected.status !== "completed";
    const hasResult = !savedPreview.hidden && Boolean(selected?.courseware) || (state.tool === "interactive" ? Boolean(interactive?.getLesson())
      : state.tool === "video" ? Boolean(video?.getCourseware()) : state.tool === "geometry" ? Boolean(state.geometryItem) : Boolean(state.materialBundle || materials?.getBundle?.()));
    nodes.save.disabled = state.saving || Boolean(state.active[state.tool]) || pending || !hasResult;
    nodes.submit.disabled = state.planning || Boolean(state.active[toolForType(chosenType())]);
  }
  function selectTool(tool, { type = "", showResults = false } = {}) {
    if (!Object.hasOwn(panels, tool) || !panels[tool]) return false;
    state.tool = tool;
    savedPreview.hidden = true;
    savedPreview.replaceChildren();
    Object.entries(panels).forEach(([name, panel]) => { if (panel) panel.hidden = name !== tool; });
    if (type && LABELS[type]) nodes.type.value = type;
    else if (toolForType(chosenType()) !== tool) nodes.type.value = tool === "video" ? "video" : tool === "geometry" ? "geometry" : tool === "materials" ? "deeptutor" : "auto";
    nodes.saveStatus.hidden = true;
    const selected = taskById(state.selectedId);
    nodes.note.textContent = selected?.tool === tool ? selected.message || statusText[selected.status]
      : tool === "video" ? "上传或选择教材，审阅分镜后逐步生成真实成片。" : tool === "geometry" ? "用本地 SVG 模板搭建，调整参数后保存。" : tool === "materials" ? "选择一项已有技术，查看其原生生成结果。" : "先操作内置实验，也可修改参数后保存。";
    if (showResults) setPane("preview");
    syncSuggestion();
    syncSave();
    return true;
  }
  function syncSuggestion() {
    const suggestion = suggestCoursewareType(nodes.prompt.value);
    const type = chosenType();
    nodes.suggestion.textContent = nodes.type.value === "auto" ? `关键词建议：${LABELS[suggestion.type]}。${suggestion.reason}`
      : type === "video" ? "先准备视频项目，再上传或选择教材；成片完成后可保存。"
        : type === "geometry" ? `${GEOMETRY_SCOPE}本地模板搭建，不调用模型。`
        : toolForType(type) === "materials" ? "使用现有素材流水线；请提供至少 20 个字符的知识内容。" : `将使用${LABELS[type]}制作，具体参数仍可在结果区调整。`;
    nodes.submit.querySelector("span").textContent = type === "video" ? "准备视频项目" : type === "geometry" ? "搭建几何模板" : "开始制作";
  }

  function showGeometry(item, task) {
    state.geometryPlayer?.destroy();
    state.geometryItem = structuredClone(item);
    state.geometryPlayer = mountGeometryCourseware(panels.geometry.querySelector("[data-ca-geometry-player]"), item, {
      onChange(current) {
        state.geometryItem = current;
        if (task) task.courseware = current;
      },
    });
    syncSave();
  }

  async function submit() {
    const prompt = nodes.prompt.value.trim();
    if (!prompt) { setStatus("请先描述课件主题与教学目标。", "error"); nodes.prompt.focus(); return; }
    const requestedType = nodes.type.value;
    const localSuggestion = suggestCoursewareType(prompt);
    let type = requestedType === "auto" ? localSuggestion.type : requestedType;
    let plannerEngine = "deterministic_domain_router";
    let agentPlan = null;
    let fallbackNotice = "";
    if (requestedType === "auto" && fetchImpl) {
      state.planning = true;
      root.setAttribute("aria-busy", "true");
      setStatus("正在判断任务复杂度并选择制作能力…", "busy");
      syncSave();
      try {
        const result = await requestAgentPlan(prompt);
        plannerEngine = result?.engine || plannerEngine;
        agentPlan = result?.plan || null;
        if (agentPlan?.recommended_type && LABELS[agentPlan.recommended_type]) type = agentPlan.recommended_type;
      } catch (error) {
        fallbackNotice = `Deep Agents JS 规划未完成，已回退到“${LABELS[type]}”执行器。${error?.message ? `原因：${error.message}` : ""}`;
        updateAgentBadge(state.agentConfig, "error");
      } finally {
        state.planning = false;
        root.removeAttribute("aria-busy");
      }
    }
    let tool = toolForType(type);
    if (state.active[tool]) { setStatus("当前类型还有任务在运行，请等待完成。", "error"); return; }
    if (tool === "materials" && prompt.length < 20) { setStatus("素材生成需要至少 20 个字符，请补充概念、规律或教学要求。", "error"); return; }
    selectTool(tool, { type, showResults: true });
    const task = createTask({
      title: agentPlan?.title || prompt.split(/\n/)[0].slice(0, 70),
      type,
      tool,
      prompt,
      plannerEngine,
      agentPlan,
      fallbackNotice,
      subject: agentPlan?.subject || localSuggestion.subject,
      status: tool === "video" ? "waiting" : "running",
      message: tool === "video" ? "请在结果区上传或选择教材，再创建项目。" : tool === "geometry" ? "正在搭建已有几何交互模板。" : "正在调用现有生成服务；下方可能仍显示上一次结果。",
    });
    state.active[tool] = tool === "video" ? null : task.id;
    nodes.note.textContent = task.message;
    setStatus(task.message, "busy");
    renderTasks();
    try {
      if (tool === "geometry") {
        task.courseware = buildGeometryCourseware(prompt);
        showGeometry(task.courseware, task);
        task.title = task.courseware.title;
        task.status = "completed";
        task.message = "本地几何模板已搭建，可调整参数并保存。";
      } else if (tool === "interactive") {
        if (!interactive) throw new Error("互动教材尚未初始化，请刷新后重试。");
        const lesson = await interactive.generateCourseware({ prompt: agentPlan?.goal_summary || prompt, type, subject: task.subject });
        task.lesson = structuredClone(lesson);
        task.status = "completed";
        task.title = lesson.title;
        task.message = "真实教材已生成，可以操作、调整参数并保存。";
      } else if (tool === "materials") {
        if (!materials?.generate) throw new Error("素材工坊尚未接入，请在参数区使用原有生成入口。");
        const input = panels.materials.querySelector("#materialSourceText");
        const choice = [...panels.materials.querySelectorAll('input[name="materialTechnique"]')].find((item) => item.value === type);
        if (!choice) throw new Error("当前素材技术不可用。");
        choice.checked = true;
        choice.dispatchEvent(new Event("change", { bubbles: true }));
        input.value = prompt;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const bundle = await materials.generate();
        if (!bundle) throw new Error(panels.materials.querySelector("#materialGenerationStatus")?.textContent?.trim() || "素材生成未完成。");
        state.materialBundle = bundle;
        task.bundle = bundle;
        task.status = "completed";
        task.title = bundle.topic?.title || task.title;
        task.message = "源码产物已生成；可保存为清晰标注的内容快照。";
        task.courseware = materialCourseware(bundle, panels.materials, type);
      } else {
        if (!video) throw new Error("视频工作台尚未初始化。");
        state.videoDraftId = task.id;
        video.prepareDraft(prompt);
      }
      if (task.status === "completed") {
        updatePlan(task, "produce", "completed", task.message);
        updatePlan(task, "verify", "completed", "产物已通过本地结构检查，可以预览和保存");
        appendTaskMessage(task, "assistant", task.message);
      } else if (task.status === "waiting") {
        updatePlan(task, "produce", "waiting", task.message);
        appendTaskMessage(task, "assistant", task.message);
      }
      setStatus([fallbackNotice, task.message].filter(Boolean).join(" "), task.status === "completed" ? "success" : "idle");
    } catch (error) {
      const fallbackType = requestedType === "auto" && tool === "materials" ? localSuggestion.type : "";
      const fallbackTool = toolForType(fallbackType);
      if (fallbackType && fallbackTool === "interactive" && interactive) {
        try {
          const failedType = type;
          const failedMessage = error?.message || "上游课件流水线未完成";
          if (state.active[tool] === task.id) delete state.active[tool];
          type = fallbackType;
          tool = fallbackTool;
          task.type = fallbackType;
          task.tool = fallbackTool;
          state.active[tool] = task.id;
          selectTool(tool, { type, showResults: true });
          appendTaskMessage(task, "assistant", `“${LABELS[failedType]}”未完成（${failedMessage}），已自动改用“${LABELS[fallbackType]}”继续制作。`);
          updatePlan(task, "route", "completed", `${LABELS[failedType]}不可用，已切换到${capabilityNote(fallbackType, fallbackTool)}`);
          updatePlan(task, "produce", "running", `正在通过“${LABELS[fallbackType]}”完成可交付产物`);
          const lesson = await interactive.generateCourseware({ prompt: agentPlan?.goal_summary || prompt, type, subject: task.subject });
          task.lesson = structuredClone(lesson);
          task.status = "completed";
          task.title = lesson.title;
          task.message = `“${LABELS[failedType]}”未完成，已自动回退并生成“${LABELS[fallbackType]}”。`;
          updatePlan(task, "produce", "completed", task.message);
          updatePlan(task, "verify", "completed", "回退产物已通过本地结构检查，可以预览和保存");
          appendTaskMessage(task, "assistant", task.message);
          setStatus(task.message, "success");
        } catch (fallbackError) {
          task.status = "failed";
          task.message = fallbackError?.message || error?.message || "制作失败，请重试。";
          updatePlan(task, "produce", "failed", task.message);
          updatePlan(task, "verify", "pending");
          appendTaskMessage(task, "assistant", `制作没有完成：${task.message}`);
          setStatus(task.message, "error");
        }
      } else {
      task.status = "failed";
      task.message = error?.message || "制作失败，请重试。";
      updatePlan(task, "produce", "failed", task.message);
      updatePlan(task, "verify", "pending");
      appendTaskMessage(task, "assistant", `制作没有完成：${task.message}`);
      if (tool === "geometry" && state.geometryItem) task.message = `此次未搭建；下方保留上次模板。${task.message}`;
      setStatus(task.message, "error");
      }
    } finally {
      if (state.active[tool] === task.id) delete state.active[tool];
      if (state.selectedId === task.id) nodes.note.textContent = task.message;
      renderTasks();
    }
  }

  async function saveCurrent() {
    if (nodes.save.disabled || state.saving) return;
    state.saving = true;
    syncSave();
    nodes.saveStatus.hidden = false;
    nodes.saveStatus.dataset.state = "busy";
    nodes.saveStatus.textContent = "正在打包并保存课件…";
    try {
      const selected = taskById(state.selectedId);
      const task = selected?.tool === state.tool ? selected : null;
      let item = !savedPreview.hidden && task?.courseware ? task.courseware : state.tool === "interactive" ? await interactive.getCourseware()
        : state.tool === "video" ? video.getCourseware()
          : state.tool === "geometry" ? state.geometryPlayer?.getCourseware()
          : task?.tool === "materials" && task.courseware ? task.courseware : materialCourseware(state.materialBundle || materials?.getBundle?.(), panels.materials, nodes.type.value);
      if (!item) throw new Error("尚无可保存的真实成果，请完成制作后重试。");
      if (task?.savedId) item = { ...item, id: task.savedId };
      const saved = await saveCourseware(item);
      if (task && saved?.id) task.savedId = saved.id;
      nodes.saveStatus.dataset.state = "success";
      nodes.saveStatus.textContent = "已保存到课件库，可在库中预览和复用。";
    } catch (error) {
      nodes.saveStatus.dataset.state = "error";
      nodes.saveStatus.textContent = `保存失败：${error?.message || "请重试"}`;
    } finally { state.saving = false; syncSave(); }
  }

  root.querySelector("[data-ca-form]").addEventListener("submit", (event) => { event.preventDefault(); void submit(); });
  nodes.prompt.addEventListener("input", () => { syncSuggestion(); syncSave(); });
  nodes.type.addEventListener("change", () => selectTool(toolForType(chosenType()), { type: nodes.type.value }));
  nodes.save.addEventListener("click", () => void saveCurrent());
  root.addEventListener("click", async (event) => {
    const pane = event.target.closest("[data-ca-pane]");
    if (pane) setPane(pane.dataset.caPane);
    const example = event.target.closest("[data-ca-example]");
    if (example) { nodes.prompt.value = example.dataset.caExample; nodes.type.value = "auto"; syncSuggestion(); nodes.prompt.focus({ preventScroll: true }); }
    const followup = event.target.closest("[data-ca-followup]");
    if (followup) {
      const task = taskById(state.selectedId);
      const context = task?.title ? `继续修改“${task.title}”：` : "";
      nodes.prompt.value = `${context}${followup.dataset.caFollowup}`;
      nodes.type.value = task?.type || "auto";
      setPane("compose");
      syncSuggestion();
      nodes.prompt.focus({ preventScroll: true });
    }
    if (event.target.closest("[data-ca-new]")) {
      state.selectedId = "";
      nodes.prompt.value = "";
      nodes.type.value = "auto";
      selectTool("interactive");
      setPane("compose");
      setStatus();
      renderTasks();
      nodes.prompt.focus({ preventScroll: true });
    }
    if (event.target.closest("[data-ca-voice]")) toggleVoice();
    if (event.target.closest("[data-ca-library]")) doc.dispatchEvent(new CustomEvent("workspace:navigate", { detail: { view: "courseware-library" } }));
    const entry = event.target.closest("[data-ca-task]");
    if (!entry) return;
    const task = taskById(entry.dataset.caTask);
    if (!task) return;
    if (state.active[task.tool] && state.active[task.tool] !== task.id) { setStatus("该类型正在制作新结果，完成后可切换历史结果。", "error"); return; }
    state.selectedId = task.id;
    selectTool(task.tool, { type: task.type, showResults: true });
    if (task.lesson) interactive?.mountLesson(task.lesson);
    if (task.tool === "geometry" && task.courseware?.visualArtifact) showGeometry(task.courseware, task);
    if (task.projectId) await video?.openProject(task.projectId);
    if (task.courseware && !task.lesson && !task.courseware.visualArtifact && (task.fromLibrary || (task.tool === "materials" && task.bundle !== state.materialBundle))) showStoredResult(task.courseware);
    renderTasks();
  });
  panels.interactive?.addEventListener("interactive-lesson:generation", (event) => {
    const detail = event.detail;
    let task = taskById(state.active.interactive);
    if (!task && detail.status === "running") {
      task = createTask({ id: detail.requestId, title: detail.title, type: "auto", tool: "interactive" });
      state.active.interactive = task.id;
    }
    if (!task) return;
    if (detail.status === "completed") {
      task.lesson = structuredClone(detail.lesson); task.title = detail.lesson.title; task.type = detail.lesson.artifact_type;
      task.status = "completed"; task.message = "真实教材已生成，可以调整并保存。"; delete state.active.interactive;
      updatePlan(task, "produce", "completed", task.message);
      updatePlan(task, "verify", "completed", "结构与交互数据已通过生成器校验");
      appendTaskMessage(task, "assistant", task.message);
    } else if (detail.status === "failed") {
      task.status = "failed"; task.message = detail.error; delete state.active.interactive;
      updatePlan(task, "produce", "failed", task.message);
      appendTaskMessage(task, "assistant", `制作没有完成：${task.message}`);
    }
    if (task.id === state.selectedId) nodes.note.textContent = task.message;
    renderTasks();
  });
  panels.materials?.addEventListener("knowledge-material:generated", (event) => {
    state.materialBundle = event.detail.bundle;
    const type = panels.materials.querySelector('input[name="materialTechnique"]:checked')?.value || "deeptutor";
    const task = taskById(state.active.materials) || createTask({ title: state.materialBundle.topic?.title || "知识点素材", type, tool: "materials", status: "completed" });
    task.bundle = state.materialBundle;
    task.status = "completed";
    task.message = "源码产物已生成，可保存内容快照。";
    updatePlan(task, "produce", "completed", task.message);
    updatePlan(task, "verify", "completed", "内容快照已生成，可以保存");
    appendTaskMessage(task, "assistant", task.message);
    try { task.courseware = materialCourseware(task.bundle, panels.materials, type); } catch { /* Save reports export errors explicitly. */ }
    delete state.active.materials;
    renderTasks();
    syncSave();
  });
  const trackNativeMaterial = () => {
    if (state.active.materials) return;
    const type = panels.materials.querySelector('input[name="materialTechnique"]:checked')?.value || "deeptutor";
    const task = createTask({ title: panels.materials.querySelector("#materialSourceText").value.trim().slice(0, 70) || "知识点素材", type, tool: "materials", message: "正在调用现有素材生成服务。" });
    state.active.materials = task.id;
    syncSave();
  };
  panels.materials?.addEventListener("click", (event) => {
    const button = event.target.closest("#materialGenerateBtn");
    if (button && !button.disabled) trackNativeMaterial();
  }, true);
  panels.materials?.addEventListener("keydown", (event) => {
    if (event.target.id === "materialSourceText" && event.key === "Enter" && (event.ctrlKey || event.metaKey)) trackNativeMaterial();
  }, true);
  const materialStatus = panels.materials?.querySelector("#materialGenerationStatus");
  if (materialStatus) new MutationObserver(() => {
    const task = taskById(state.active.materials);
    if (task && materialStatus.classList.contains("is-error")) {
      task.status = "failed"; task.message = materialStatus.textContent.trim(); delete state.active.materials;
      updatePlan(task, "produce", "failed", task.message);
      appendTaskMessage(task, "assistant", `制作没有完成：${task.message}`);
      if (task.id === state.selectedId) nodes.note.textContent = task.message;
      renderTasks();
    }
  }).observe(materialStatus, { attributes: true, attributeFilter: ["class"], childList: true });
  panels.video?.addEventListener("video-workbench:changed", (event) => {
    const { project, courseware, notice } = event.detail;
    if (!project?.id) return;
    let task = state.tasks.find((item) => item.projectId === project.id);
    if (!task && state.videoDraftId) { task = taskById(state.videoDraftId); state.videoDraftId = ""; }
    if (!task) {
      const title = project.title || "讲解视频";
      task = {
        id: `video:${project.id}`,
        title,
        type: "video",
        tool: "video",
        status: "waiting",
        message: "已载入视频项目，等待继续制作。",
        createdAt: project.createdAt || new Date().toISOString(),
        plan: buildPlan("video", "video", "waiting"),
        messages: [
          { role: "user", text: `制作讲解视频：${title}` },
          { role: "assistant", text: "已载入视频项目。我会继续按素材准备、分镜生成、镜头制作与交付检查推进。" },
        ],
      };
      state.tasks.unshift(task);
    }
    task.projectId = project.id;
    task.title = project.title;
    const running = project.tasks?.find((item) => ["queued", "running", "processing", "generating", "composing", "pending", "submitting", "cancel_requested"].includes(item.status));
    task.status = courseware ? "completed" : running ? "running" : notice?.type === "error" ? "failed" : "waiting";
    task.message = courseware ? "真实成片已生成，可预览并保存。" : running ? running.message || "服务端任务正在运行。" : notice?.type === "error" ? notice.message : "请在视频编辑器中继续审阅分镜或生成镜头。";
    updatePlan(task, "produce", task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : task.status === "running" ? "running" : "waiting", task.message);
    updatePlan(task, "verify", task.status === "completed" ? "completed" : "pending", task.status === "completed" ? "视频文件与项目数据已可保存" : "等待视频完成后检查");
    if (["completed", "failed", "waiting"].includes(task.status)) {
      appendTaskMessage(task, "assistant", task.status === "failed" ? `制作没有完成：${task.message}` : task.message);
    }
    if (state.tool === "video" && (!state.selectedId || taskById(state.selectedId)?.tool === "video")) { state.selectedId = task.id; nodes.note.textContent = task.message; }
    renderTasks();
  });
  doc.addEventListener("courseware:select-tool", (event) => selectTool(event.detail?.tool || "interactive", { showResults: true }));
  doc.addEventListener("courseware:open-assistant", (event) => {
    const item = event.detail?.item;
    if (!item) return;
    nodes.prompt.value = [item.title, item.description].filter(Boolean).join("\n");
    if (item.lesson) { interactive?.mountLesson(item.lesson); selectTool("interactive", { type: item.type, showResults: true }); }
    else if (item.visualArtifact && item.type === "geometry") selectTool("geometry", { type: "geometry", showResults: true });
    else selectTool(item.type === "video" ? "video" : "materials", { showResults: true });
    const task = createTask({ id: `library:${item.id || Date.now()}`, title: item.title, type: item.type, tool: state.tool, status: "completed", message: "已载入课件库成果，可调整需求后重新制作。" });
    task.courseware = item; task.savedId = item.id; task.fromLibrary = true;
    if (item.lesson) task.lesson = structuredClone(item.lesson);
    if (item.visualArtifact && item.type === "geometry") showGeometry(item, task);
    else if (!item.lesson) showStoredResult(item);
    setStatus("已带入课件内容，可调整目标后重新制作。", "idle");
    syncSave();
  });
  doc.addEventListener("learning-workspace:change", (event) => { if (event.detail?.view === "courseware-assistant") syncSave(); });
  let wideTasks = null;
  if (globalThis.ResizeObserver) new ResizeObserver(([entry]) => {
    if (!entry.contentRect.width) return;
    const wide = entry.contentRect.width >= 1000;
    if (wide !== wideTasks) { wideTasks = wide; taskDisclosure.open = wide; }
  }).observe(root);
  function showStoredResult(item) {
    if (!item.html && !item.videoUrl) return;
    savedPreview.replaceChildren();
    const heading = doc.createElement("h4"); heading.textContent = item.title || "已保存课件";
    const note = doc.createElement("p"); note.textContent = item.interactive ? "已保存的可交互课件。" : "已保存的生成成果。";
    savedPreview.append(heading, note);
    if (item.videoUrl) {
      const player = doc.createElement("video"); player.controls = true; player.preload = "metadata"; player.src = item.videoUrl; savedPreview.append(player);
    } else {
      const frame = doc.createElement("iframe"); frame.title = item.title || "课件预览"; frame.setAttribute("sandbox", "allow-scripts"); frame.srcdoc = item.html; savedPreview.append(frame);
    }
    const edit = doc.createElement("button"); edit.type = "button"; edit.className = "btn"; edit.textContent = "打开制作参数";
    edit.addEventListener("click", () => selectTool(state.tool));
    savedPreview.append(edit);
    Object.values(panels).forEach((panel) => { if (panel) panel.hidden = true; });
    savedPreview.hidden = false;
    nodes.note.textContent = "正在预览所选课件的保存成果。重新制作会使用新的任务。";
    nodes.save.disabled = state.saving;
  }
  function toggleVoice() {
    if (state.listening) {
      state.recognition?.stop?.();
      return;
    }
    const Recognition = doc.defaultView.SpeechRecognition || doc.defaultView.webkitSpeechRecognition;
    if (!Recognition) {
      setStatus("当前浏览器不支持语音转写，请使用键盘输入。", "error");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = false;
    const base = nodes.prompt.value.trim();
    recognition.onstart = () => {
      state.listening = true;
      nodes.voice.setAttribute("aria-pressed", "true");
      nodes.voice.querySelector("span").textContent = "正在听";
      setStatus("正在转写，可继续说；结束后仍可修改文字。", "busy");
    };
    recognition.onresult = (event) => {
      const transcript = [...event.results].map((result) => result[0]?.transcript || "").join("");
      nodes.prompt.value = [base, transcript].filter(Boolean).join(base ? "\n" : "");
      syncSuggestion();
    };
    recognition.onerror = (event) => setStatus(
      event.error === "not-allowed" ? "未获得麦克风权限，请在浏览器设置中允许后重试。" : "语音转写失败，请重试或改用键盘输入。",
      "error",
    );
    recognition.onend = () => {
      state.listening = false;
      nodes.voice.setAttribute("aria-pressed", "false");
      nodes.voice.querySelector("span").textContent = "语音";
      state.recognition = null;
      syncSave();
    };
    state.recognition = recognition;
    recognition.start();
  }
  setPane("compose");
  void loadAgentConfig();
  syncSuggestion();
  renderThread();
  syncSave();
  icons();
  const api = Object.freeze({ selectTool, submit, getTasks: () => state.tasks.map(({ bundle, courseware, lesson, ...task }) => ({ ...task })), getTool: () => state.tool });
  mounts.set(root, api);
  return api;
}

function materialCourseware(bundle, panel, technology) {
  if (!bundle) return null;
  const source = panel?.querySelector("#materialTechniqueGrid");
  if (!source || !source.textContent.trim()) throw new Error("素材尚未渲染，暂时无法保存内容快照。");
  const clone = source.cloneNode(true);
  clone.querySelectorAll("script, style, iframe, input, select, textarea").forEach((node) => node.remove());
  clone.querySelectorAll("button").forEach((button) => {
    const text = panel.ownerDocument.createElement("div"); text.innerHTML = button.innerHTML; button.replaceWith(text);
  });
  clone.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => { if (/^on/i.test(attribute.name) || /^(?:id|tabindex|contenteditable)$/.test(attribute.name)) node.removeAttribute(attribute.name); });
    for (const attribute of ["href", "src"]) {
      const value = node.getAttribute(attribute);
      if (!value) continue;
      try {
        const url = new URL(value, location.href);
        if (!["http:", "https:", "data:"].includes(url.protocol) || (url.protocol === "data:" && !value.startsWith("data:image/"))) node.removeAttribute(attribute);
        else node.setAttribute(attribute, url.href);
      } catch { node.removeAttribute(attribute); }
    }
  });
  const originalCanvases = [...source.querySelectorAll("canvas")];
  [...clone.querySelectorAll("canvas")].forEach((canvas, index) => {
    const image = panel.ownerDocument.createElement("img");
    try { image.src = originalCanvases[index].toDataURL("image/png"); image.alt = "生成素材画布快照"; canvas.replaceWith(image); }
    catch { canvas.remove(); }
  });
  const title = bundle.topic?.title || "知识点素材";
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;padding:24px;font:14px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#253249;background:#fff}main{max-width:960px;margin:auto}h1{font-size:22px}h2,h3,h4{font-size:18px;margin-top:24px}p,li{max-width:72ch}img,svg,video{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#263f6b}.snapshot-note{padding:12px 0;border-bottom:1px solid #d8dfe8;color:#5d6b7e}</style><main><h1>${esc(title)}</h1><p class="snapshot-note">生成内容快照。动态交互、参数调整与重新生成请使用课件助手。</p>${clone.innerHTML}</main></html>`;
  return { title, description: "原生生成内容快照；动态交互请在课件助手中继续。", subject: bundle.topic?.subject || "通用", type: "visual", technology: LABELS[technology] || technology || "素材工坊", tags: ["内容快照"], interactive: false, html, source: "saved" };
}
