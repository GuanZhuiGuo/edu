const METHODS = [
  { id: "oral", name: "口语评测", icon: "audio-lines", color: "blue", description: "发音、流利度、词汇与互动回应", dimensions: ["发音清晰度", "表达流利度", "词汇准确性", "互动回应"] },
  { id: "practical", name: "实操评测", icon: "wrench", color: "violet", description: "步骤规范、操作安全、结果解释", dimensions: ["步骤规范", "操作安全", "结果解释", "问题处理"] },
  { id: "homework", name: "作业批改", icon: "file-check-2", color: "green", description: "答案正确性、过程完整性与表达", dimensions: ["答案正确性", "过程完整性", "表达清晰度", "规范性"] },
  { id: "classroom", name: "课堂表现", icon: "presentation", color: "amber", description: "参与、协作、提问与迁移", dimensions: ["参与度", "协作表现", "提问质量", "迁移应用"] }
];

const TASKS = [
  { id: "task-oral-01", title: "英语观点表达 · 第 3 次练习", method: "oral", owner: "林知夏", status: "待提交", progress: 42, source: "课程：英语口语陪练", updated: "今天 09:30", dataset: "口语练习集·校园生活" },
  { id: "task-homework-01", title: "一次函数单元作业批改", method: "homework", owner: "八年级 2 班", status: "已完成", progress: 100, source: "作业：函数与图象", updated: "昨天 16:20", dataset: "作业照片·函数单元" },
  { id: "task-practical-01", title: "实验报告与操作复盘", method: "practical", owner: "陈晨", status: "评测中", progress: 76, source: "课程：酸碱滴定", updated: "昨天 14:05", dataset: "化学实验视频·第 2 组" }
];

const DATASETS = [
  { id: "set-oral", name: "口语练习集·校园生活", type: "音频", count: "38 条", updated: "今天 09:12", status: "已校验" },
  { id: "set-homework", name: "作业照片·函数单元", type: "图片", count: "126 张", updated: "昨天 15:48", status: "已校验" },
  { id: "set-lab", name: "化学实验视频·第 2 组", type: "视频", count: "12 段", updated: "9 月 10 日", status: "待检查" }
];

const RESULTS = {
  "task-homework-01": { score: 88, label: "一次函数单元作业批改", method: "homework", reviewer: "AI 初审 · 教师可复核", dimensions: [86, 92, 84, 90], evidence: [{ time: "第 2 题 · 00:18", text: "将斜率符号写反，导致函数增减性判断错误", tone: "warn" }, { time: "第 5 题 · 01:42", text: "待定系数法步骤完整，结论正确", tone: "good" }], advice: ["先标记坐标轴方向，再代入两点求斜率。", "保持过程书写，最后用一个点回代检查。"] },
  "task-practical-01": { score: 81, label: "实验报告与操作复盘", method: "practical", reviewer: "AI 初审 · 待教师确认", dimensions: [78, 90, 74, 82], evidence: [{ time: "视频 00:36", text: "滴定前未完成器具润洗，建议补充操作说明", tone: "warn" }, { time: "视频 01:18", text: "读数时视线与刻度线保持水平", tone: "good" }], advice: ["按‘准备—操作—读数—解释’四步复述实验。", "把异常现象和可能原因写在同一段证据旁。"] },
  "task-oral-01": { score: 84, label: "英语观点表达 · 第 3 次练习", method: "oral", reviewer: "语音模型 · 可复听", dimensions: [82, 79, 88, 87], evidence: [{ time: "音频 00:24", text: "‘environment’ 重音靠后，已标出复听片段", tone: "warn" }, { time: "音频 00:51", text: "观点—理由—例子结构完整", tone: "good" }], advice: ["先用一句话给观点，再用 because / for example 连接。", "复听标记片段，跟读 2 次后再录一遍。"] }
};

const state = { tab: "overview", selectedTaskId: "task-homework-01", methodDraftOpen: false, taskDraftOpen: false, datasetDraftOpen: false, filter: "all" };

export function initAssessmentWorkbench(root = document.querySelector("#assessmentWorkspace")) {
  if (!root || root.dataset.assessmentMounted === "true") return;
  root.dataset.assessmentMounted = "true";
  const shell = root.querySelector(".assessment-shell");
  const rootMount = root.querySelector("#assessmentRoot");
  if (!rootMount) return;
  const tabs = [...root.querySelectorAll("[data-assessment-tab]")];
  const setTab = (tab) => {
    state.tab = tab;
    tabs.forEach((button) => {
      const selected = button.dataset.assessmentTab === tab;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    render(rootMount);
    window.lucide?.createIcons?.();
  };
  tabs.forEach((button) => button.addEventListener("click", () => setTab(button.dataset.assessmentTab)));
  document.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-assessment-action]");
    if (!action || !shell?.contains(action) && !root.contains(action)) return;
    const name = action.dataset.assessmentAction;
    if (name === "new-task") { state.tab = "tasks"; state.taskDraftOpen = true; setTab("tasks"); }
    if (name === "new-method") { state.tab = "methods"; state.methodDraftOpen = true; setTab("methods"); }
    if (name === "new-dataset") { state.tab = "datasets"; state.datasetDraftOpen = true; setTab("datasets"); }
  });
  rootMount.addEventListener("click", (event) => {
    const tabButton = event.target.closest("[data-assessment-tab-local]");
    if (tabButton) return setTab(tabButton.dataset.assessmentTabLocal);
    const task = event.target.closest("[data-assessment-task]");
    if (task) { state.selectedTaskId = task.dataset.assessmentTask; state.tab = "results"; setTab("results"); return; }
    const filter = event.target.closest("[data-assessment-filter]");
    if (filter) { state.filter = filter.dataset.assessmentFilter; render(rootMount); window.lucide?.createIcons?.(); return; }
    const action = event.target.closest("[data-assessment-local-action]");
    if (action) {
      const name = action.dataset.assessmentLocalAction;
      if (name === "open-method-form") state.methodDraftOpen = true;
      if (name === "open-task-for-method") { state.taskDraftOpen = true; setTab("tasks"); return; }
      if (name === "open-task-form") state.taskDraftOpen = true;
      if (name === "open-dataset-form") state.datasetDraftOpen = true;
      if (name === "close-method") state.methodDraftOpen = false;
      if (name === "close-task") state.taskDraftOpen = false;
      if (name === "close-dataset") state.datasetDraftOpen = false;
      if (name === "open-result") { state.selectedTaskId = action.dataset.taskId || state.selectedTaskId; setTab("results"); return; }
      render(rootMount); window.lucide?.createIcons?.();
    }
  });
  rootMount.addEventListener("change", (event) => {
    const input = event.target.closest("input[type=file]");
    if (!input) return;
    const output = rootMount.querySelector(`[data-file-name="${input.dataset.fileTarget}"]`);
    const names = [...(input.files || [])].map((file) => file.name).filter(Boolean);
    if (output) output.textContent = names.length ? names.join("、") : "尚未选择文件";
  });
  rootMount.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.matches("[data-assessment-form=method]")) { state.methodDraftOpen = false; showAssessmentToast("评测方法已保存到当前工作区"); }
    if (form.matches("[data-assessment-form=task]")) { state.taskDraftOpen = false; showAssessmentToast("评测任务已创建，等待数据提交"); }
    if (form.matches("[data-assessment-form=dataset]")) { state.datasetDraftOpen = false; showAssessmentToast("数据集已加入本地演示目录"); }
    render(rootMount); window.lucide?.createIcons?.();
  });
  document.addEventListener("portal-role:change", () => { state.tab = "overview"; render(rootMount); });
  document.addEventListener("learning-workspace:change", (event) => { if (event.detail?.view === "assessment") render(rootMount); });
  render(rootMount);
}

function render(mount) {
  const role = document.body.dataset.portalRole || "student";
  const teacher = role === "teacher";
  if (state.tab === "methods") mount.innerHTML = renderMethods(teacher);
  else if (state.tab === "tasks") mount.innerHTML = renderTasks(teacher);
  else if (state.tab === "datasets") mount.innerHTML = renderDatasets(teacher);
  else if (state.tab === "results") mount.innerHTML = renderResults();
  else mount.innerHTML = renderOverview(teacher);
}

function renderOverview(teacher) {
  const recent = TASKS.slice(0, 3).map(renderTaskRow).join("");
  return `<div class="assessment-overview-grid">
    <section class="assessment-panel assessment-recent-panel"><header class="assessment-panel-head"><div><span class="page-eyebrow">最近任务</span><h3>继续你的评测工作</h3></div><button type="button" class="btn btn-ghost" data-assessment-tab-local="tasks">查看全部</button></header><div class="assessment-task-list">${recent}</div></section>
    <section class="assessment-panel assessment-result-panel"><header class="assessment-panel-head"><div><span class="page-eyebrow">最近结果</span><h3>${RESULTS["task-homework-01"].label}</h3></div><button type="button" class="btn btn-ghost" data-assessment-local-action="open-result" data-task-id="task-homework-01">打开复盘</button></header>${renderResultCompact(RESULTS["task-homework-01"])}</section>
    <section class="assessment-panel assessment-methods-panel"><header class="assessment-panel-head"><div><span class="page-eyebrow">方法模板</span><h3>按证据类型开始</h3></div>${teacher ? '<button type="button" class="btn btn-ghost" data-assessment-tab-local="methods">管理方法</button>' : ""}</header><div class="assessment-method-grid">${METHODS.map((method) => `<button type="button" class="assessment-method-chip" data-assessment-tab-local="${teacher ? "methods" : "tasks"}"><span class="assessment-kpi-icon ${method.color}"><i data-lucide="${method.icon}" aria-hidden="true"></i></span><span><b>${method.name}</b><small>${method.description}</small></span><i data-lucide="chevron-right" aria-hidden="true"></i></button>`).join("")}</div></section>
    <aside class="assessment-panel assessment-boundary-panel"><i data-lucide="route" aria-hidden="true"></i><div><b>评测结果以证据为准</b><p>演示结果会展示总分、维度分、原文或原帧定位和建议。生产接入需绑定对象存储、异步任务和审核权限。</p></div></aside>
  </div>`;
}

function renderMethods(teacher) {
  if (!teacher) return `<section class="assessment-panel assessment-empty-panel"><i data-lucide="lock-keyhole" aria-hidden="true"></i><h3>评测方法由教师端统一配置</h3><p>你可以直接选择已发布的方法提交音频、视频或图片。</p><button type="button" class="btn btn-primary" data-assessment-tab-local="tasks">去看我的任务</button></section>`;
  return `<div class="assessment-two-column"><section class="assessment-panel"><header class="assessment-panel-head"><div><span class="page-eyebrow">METHOD BUILDER</span><h3>评测方法</h3><p>方法定义“评什么、怎么打分、需要哪些证据”。</p></div><button type="button" class="btn btn-primary" data-assessment-local-action="open-method-form">新建方法</button></header><div class="assessment-method-list">${METHODS.map((method) => `<article class="assessment-method-card"><span class="assessment-kpi-icon ${method.color}"><i data-lucide="${method.icon}" aria-hidden="true"></i></span><div><h4>${method.name}</h4><p>${method.description}</p><div class="assessment-tag-row">${method.dimensions.map((item) => `<span>${item}</span>`).join("")}</div></div><button type="button" class="btn btn-ghost" data-assessment-local-action="open-task-for-method" data-method-id="${method.id}">用于建任务</button></article>`).join("")}</div></section>${state.methodDraftOpen ? renderMethodForm() : renderMethodAside()}</div>`;
}

function renderMethodForm() {
  return `<section class="assessment-panel assessment-form-panel"><header class="assessment-panel-head"><div><span class="page-eyebrow">新建方法</span><h3>定义评测标准</h3></div><button type="button" class="btn btn-ghost" data-assessment-local-action="close-method">关闭</button></header><form data-assessment-form="method" class="assessment-form"><label><span>方法名称</span><input name="name" required value="课堂表现·小组讨论" /></label><label><span>评测类型</span><select name="type"><option>口语评测</option><option>实操评测</option><option>作业批改</option><option selected>课堂表现</option></select></label><label class="is-wide"><span>评分说明</span><textarea name="rubric" rows="4">根据参与度、协作表现、提问质量和迁移应用评分；每项 25 分，支持证据片段定位。</textarea></label><fieldset class="assessment-dimension-picker"><legend>评分维度</legend><label><input type="checkbox" checked />参与度</label><label><input type="checkbox" checked />协作表现</label><label><input type="checkbox" checked />提问质量</label><label><input type="checkbox" checked />迁移应用</label></fieldset><footer><button type="button" class="btn" data-assessment-local-action="close-method">取消</button><button class="btn btn-primary" type="submit">保存方法</button></footer></form></section>`;
}

function renderMethodAside() {
  return `<aside class="assessment-panel assessment-guide-panel"><span class="assessment-guide-number">01</span><h3>先定义评分标准</h3><p>同一方法可复用于不同课程、班级和企业培训项目。维度、权重与证据要求由方法统一管理。</p><div class="assessment-guide-flow"><span>方法</span><i data-lucide="arrow-right" aria-hidden="true"></i><span>任务</span><i data-lucide="arrow-right" aria-hidden="true"></i><span>结果</span></div></aside>`;
}

function renderTasks(teacher) {
  return `<div class="assessment-two-column"><section class="assessment-panel"><header class="assessment-panel-head"><div><span class="page-eyebrow">TASK QUEUE</span><h3>${teacher ? "评测任务" : "我的评测任务"}</h3><p>选择方法后，接收音频、视频或图片作为任务证据。</p></div><div class="assessment-head-inline"><select class="form-select" aria-label="筛选任务"><option>全部状态</option><option>待提交</option><option>评测中</option><option>已完成</option></select>${teacher ? '<button type="button" class="btn btn-primary" data-assessment-local-action="open-task-form">新建任务</button>' : ""}</div></header><div class="assessment-task-list">${TASKS.map(renderTaskRow).join("")}</div></section>${state.taskDraftOpen ? renderTaskForm() : renderTaskAside()}</div>`;
}

function renderTaskRow(task) {
  const method = METHODS.find((item) => item.id === task.method) || METHODS[0];
  return `<button type="button" class="assessment-task-row" data-assessment-task="${task.id}"><span class="assessment-task-icon ${method.color}"><i data-lucide="${method.icon}" aria-hidden="true"></i></span><span class="assessment-task-copy"><b>${task.title}</b><small>${task.source} · ${task.dataset}</small><span class="assessment-progress"><i style="width:${task.progress}%"></i></span></span><span class="assessment-task-state"><em class="is-${task.status === "已完成" ? "done" : task.status === "评测中" ? "running" : "pending"}">${task.status}</em><time>${task.updated}</time></span><i data-lucide="chevron-right" aria-hidden="true"></i></button>`;
}

function renderTaskForm() {
  return `<section class="assessment-panel assessment-form-panel"><header class="assessment-panel-head"><div><span class="page-eyebrow">新建任务</span><h3>选择方法并添加证据</h3></div><button type="button" class="btn btn-ghost" data-assessment-local-action="close-task">关闭</button></header><form data-assessment-form="task" class="assessment-form"><label><span>任务名称</span><input name="name" required value="八年级数学 · 单元评测" /></label><label><span>评测方法</span><select name="method"><option>作业批改</option><option>口语评测</option><option>实操评测</option><option>课堂表现</option></select></label><label class="is-wide"><span>上传证据</span><div class="assessment-upload-drop"><i data-lucide="upload-cloud" aria-hidden="true"></i><b data-file-name="task">点击选择音频、视频或图片</b><small>支持多文件；演示环境只记录文件名，不上传至服务端</small><input type="file" multiple accept="audio/*,video/*,image/*" data-file-target="task" /></div></label><label class="is-wide"><span>任务说明</span><textarea name="note" rows="3" placeholder="例如：请重点关注步骤规范和异常处理"></textarea></label><footer><button type="button" class="btn" data-assessment-local-action="close-task">取消</button><button class="btn btn-primary" type="submit">创建评测任务</button></footer></form></section>`;
}

function renderTaskAside() {
  return `<aside class="assessment-panel assessment-guide-panel"><span class="assessment-guide-number">02</span><h3>再创建评测任务</h3><p>一个任务绑定一个方法和一组证据。系统会保留原文、原帧、时间戳与评分维度，方便复盘。</p><div class="assessment-evidence-pills"><span><i data-lucide="mic" aria-hidden="true"></i>音频</span><span><i data-lucide="video" aria-hidden="true"></i>视频</span><span><i data-lucide="image" aria-hidden="true"></i>图片</span></div></aside>`;
}

function renderDatasets(teacher) {
  return `<div class="assessment-two-column"><section class="assessment-panel"><header class="assessment-panel-head"><div><span class="page-eyebrow">DATASET CATALOG</span><h3>数据集</h3><p>为批量评测准备可追溯的数据来源。</p></div>${teacher ? '<button type="button" class="btn btn-primary" data-assessment-local-action="open-dataset-form">导入数据集</button>' : ""}</header><div class="assessment-dataset-list">${DATASETS.map((dataset) => `<article class="assessment-dataset-row"><span class="assessment-dataset-icon"><i data-lucide="${dataset.type === "音频" ? "audio-lines" : dataset.type === "视频" ? "video" : "image"}" aria-hidden="true"></i></span><div><b>${dataset.name}</b><small>${dataset.type} · ${dataset.count} · 更新于 ${dataset.updated}</small></div><em class="assessment-dataset-status ${dataset.status === "待检查" ? "is-pending" : ""}">${dataset.status}</em><button type="button" class="btn btn-ghost">查看</button></article>`).join("")}</div></section>${state.datasetDraftOpen ? renderDatasetForm() : `<aside class="assessment-panel assessment-guide-panel"><span class="assessment-guide-number">03</span><h3>数据集可以持续积累</h3><p>教育场景按课程与学段组织，企业培训按岗位与能力项组织。底层都只需要“样本—方法—结果”的统一关系。</p><button type="button" class="btn btn-ghost" data-assessment-local-action="open-dataset-form">导入一批数据</button></aside>`}</div>`;
}

function renderDatasetForm() {
  return `<section class="assessment-panel assessment-form-panel"><header class="assessment-panel-head"><div><span class="page-eyebrow">导入数据集</span><h3>选择文件或导入清单</h3></div><button type="button" class="btn btn-ghost" data-assessment-local-action="close-dataset">关闭</button></header><form data-assessment-form="dataset" class="assessment-form"><label class="is-wide"><span>数据集名称</span><input name="name" value="课堂互动样本集" required /></label><label class="is-wide"><span>文件</span><div class="assessment-upload-drop"><i data-lucide="database" aria-hidden="true"></i><b data-file-name="dataset">点击选择 CSV、JSON、音频、视频或图片</b><small>演示环境仅展示文件名与数量，不触发真实上传</small><input type="file" multiple accept=".csv,.json,audio/*,video/*,image/*" data-file-target="dataset" /></div></label><footer><button type="button" class="btn" data-assessment-local-action="close-dataset">取消</button><button class="btn btn-primary" type="submit">加入数据集目录</button></footer></form></section>`;
}

function renderResults() {
  const result = RESULTS[state.selectedTaskId] || RESULTS["task-homework-01"];
  return `<div class="assessment-result-layout"><section class="assessment-panel assessment-result-detail"><header class="assessment-panel-head"><div><span class="page-eyebrow">RESULT REVIEW</span><h3>${result.label}</h3><p>${methodName(result.method)} · ${result.reviewer}</p></div><button type="button" class="btn btn-ghost" data-assessment-tab-local="tasks">返回任务</button></header><div class="assessment-score-row"><div class="assessment-score-ring" style="--score:${result.score}"><span><b>${result.score}</b><small>/ 100</small></span></div><div><b class="assessment-result-verdict">已完成 · 建议复盘 2 个证据片段</b><p>总分只反映当前方法下的这一次任务，不直接替代掌握度或晋级判断。</p><div class="assessment-tag-row"><span>方法：${methodName(result.method)}</span><span>证据：${result.evidence.length} 段</span><span>可复核</span></div></div></div><div class="assessment-result-main"><div><h4>维度雷达</h4>${radarSvg(result.dimensions, METHODS.find((item) => item.id === result.method)?.dimensions || ["维度 1", "维度 2", "维度 3", "维度 4"])}<div class="assessment-dimension-list">${(METHODS.find((item) => item.id === result.method)?.dimensions || []).map((label, index) => `<div><span>${label}</span><b>${result.dimensions[index]}</b><i><em style="width:${result.dimensions[index]}%"></em></i></div>`).join("")}</div></div><div><h4>原文 / 原帧高亮</h4><div class="assessment-evidence-list">${result.evidence.map((item) => `<button type="button" class="assessment-evidence-item ${item.tone}"><span>${item.time}</span><b>${item.text}</b><i data-lucide="play-circle" aria-hidden="true"></i></button>`).join("")}</div><h4 class="assessment-advice-title">下一步建议</h4><ul class="assessment-advice-list">${result.advice.map((item) => `<li>${item}</li>`).join("")}</ul></div></div></section><aside class="assessment-panel assessment-result-list"><header class="assessment-panel-head"><div><span class="page-eyebrow">HISTORY</span><h3>历史结果</h3></div></header>${TASKS.map((task) => `<button type="button" class="assessment-history-row ${task.id === state.selectedTaskId ? "is-selected" : ""}" data-assessment-task="${task.id}"><span><b>${task.title}</b><small>${methodName(task.method)} · ${task.updated}</small></span><strong>${RESULTS[task.id]?.score ?? "—"}</strong></button>`).join("")}</aside></div>`;
}

function renderResultCompact(result) {
  return `<div class="assessment-compact-score"><div class="assessment-score-ring small" style="--score:${result.score}"><span><b>${result.score}</b><small>分</small></span></div><div><b>${methodName(result.method)} · ${result.reviewer}</b><p>包含 ${result.evidence.length} 个原文 / 原帧定位</p><button type="button" class="assessment-inline-link" data-assessment-local-action="open-result" data-task-id="task-homework-01">查看完整复盘 <i data-lucide="arrow-up-right" aria-hidden="true"></i></button></div></div>`;
}

function radarSvg(values, labels) {
  const points = values.map((value, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length; const radius = 54 * value / 100; return `${70 + Math.cos(angle) * radius},${70 + Math.sin(angle) * radius}`; }).join(" ");
  const outer = values.map((_, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length; return `${70 + Math.cos(angle) * 54},${70 + Math.sin(angle) * 54}`; }).join(" ");
  return `<svg class="assessment-radar" viewBox="0 0 140 140" role="img" aria-label="评测维度雷达图"><polygon points="${outer}" class="radar-grid" />${values.map((_, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / values.length; return `<line x1="70" y1="70" x2="${70 + Math.cos(angle) * 54}" y2="${70 + Math.sin(angle) * 54}" class="radar-axis" />`; }).join("")}<polygon points="${points}" class="radar-value" />${labels.map((label, index) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / labels.length; return `<text x="${70 + Math.cos(angle) * 66}" y="${74 + Math.sin(angle) * 66}" text-anchor="middle">${label.slice(0, 5)}</text>`; }).join("")}</svg>`;
}

function methodName(id) { return METHODS.find((method) => method.id === id)?.name || "评测方法"; }

function showAssessmentToast(message) {
  let toast = document.querySelector("#learningWorkbenchToast");
  if (!toast) { toast = document.createElement("div"); toast.id = "learningWorkbenchToast"; toast.className = "learning-workbench-toast"; document.body.append(toast); }
  toast.textContent = message; toast.classList.add("is-visible"); window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
}
