const PORTAL_ROLE_KEY = "ai-teacher:portal-role:v1";
const PORTAL_VIEWS_KEY = "ai-teacher:portal-views:v1";
const TEACHER_CONTEXT_KEY = "ai-teacher:teacher-context:v1";
const MOBILE_SHELL_QUERY = "(max-width: 820px)";

const TEACHER_VIEW_ALIASES = Object.freeze({
  "video-explanation": "courseware-assistant", "lesson-lab": "courseware-assistant",
  materials: "courseware-assistant", "agent-skills": "skill-hub",
  "tech-landscape": "skill-hub", "teacher-plan": "teacher-dashboard",
});

const PORTAL_ROLES = Object.freeze({
  student: Object.freeze({
    defaultView: "agent",
    allowedViews: new Set(["agent", "course", "plan", "graph", "bank", "assessment", "records", "buddy", "voice-config"])
  }),
  teacher: Object.freeze({
    defaultView: "teacher-dashboard",
    allowedViews: new Set([
      "teacher-dashboard",
      "teacher-students",
      "teacher-courses",
      "courseware-assistant",
      "courseware-library",
      "skill-hub",
      "graph",
      "ontology",
      "bank",
      "assessment",
      "agent",
      "voice-config"
    ])
  })
});

const WORKSPACE_PRESENTATION = Object.freeze({
  student: Object.freeze({
    agent: { breadcrumb: "AI教师", title: "AI教师", chip: "" },
    course: { breadcrumb: "我的课程", title: "我的课程", chip: "按个人进度继续学习" },
    plan: { breadcrumb: "今日计划", title: "今日计划", chip: "本周目标 · 每日任务" },
    graph: { breadcrumb: "知识地图", title: "知识地图", chip: "知识关系 · 我的掌握情况" },
    bank: { breadcrumb: "练习与错题", title: "练习与错题", chip: "练习记录 · 错题复习" },
    assessment: { breadcrumb: "智能评测", title: "智能评测", chip: "评测方法 · 任务 · 证据复盘" },
    records: { breadcrumb: "学习记录", title: "学习记录", chip: "学习画像 · 学习动态" },
    buddy: { breadcrumb: "学习搭子", title: "学习搭子", chip: "专注学习 · 共同进步" },
    "voice-config": { breadcrumb: "学习偏好", title: "学习偏好", chip: "教师形象 · 声音 · 对话习惯" }
  }),
  teacher: Object.freeze({
    "teacher-dashboard": { breadcrumb: "教学总览", title: "教学总览", chip: "班级概览 · 教学提醒" },
    "teacher-students": { breadcrumb: "班级学情", title: "班级学情", chip: "学生状态 · 学习证据" },
    "teacher-courses": { breadcrumb: "课程管理", title: "课程管理", chip: "课程 · 章节 · 发布" },
    graph: { breadcrumb: "知识库", title: "知识库", chip: "知识结构 · 班级分布" },
    ontology: { breadcrumb: "本体图", title: "本体图", chip: "实体 · 关系 · 题目映射 · 发布版本" },
    bank: { breadcrumb: "题库", title: "题库", chip: "题目画像 · 审核 · 作业" },
    assessment: { breadcrumb: "智能评测", title: "智能评测", chip: "方法 · 任务 · 数据集 · 结果" },
    "courseware-assistant": { breadcrumb: "课件助手", title: "课件助手", chip: "" },
    "courseware-library": { breadcrumb: "课件库", title: "课件库", chip: "" },
    "skill-hub": { breadcrumb: "Skill hub", title: "Skill hub", chip: "" },
    "teacher-plan": { breadcrumb: "教学计划", title: "教学计划", chip: "课堂 · 作业 · 测验" },
    "video-explanation": { breadcrumb: "视频讲解", title: "视频讲解", chip: "教材 · 讲稿 · 分镜 · 成片" },
    agent: { breadcrumb: "课堂预览", title: "课堂预览", chip: "以学生视角体验AI教师" },
    "lesson-lab": { breadcrumb: "互动教材", title: "互动教材", chip: "Pi Agent · Lesson DSL · 可录制导出" },
    materials: { breadcrumb: "素材工坊", title: "素材工坊", chip: "图解 · 实验 · 思维导图" },
    "agent-skills": { breadcrumb: "Agent Skills", title: "Agent Skills", chip: "教学能力 · 工具 · 权限边界" },
    "tech-landscape": { breadcrumb: "技术地图", title: "技术地图", chip: "学科场景 · 引擎 · GitHub 项目" },
    "voice-config": { breadcrumb: "AI教师设置", title: "AI教师设置", chip: "讲解 · 知识 · 出题 · 声音" }
  })
});

let activeRole = readRole();
let activeViewByRole = readPortalViews();
let activateWorkspaceHandler = null;
let subjectStudentId = readTeacherSubject();

function readRole() {
  try {
    const stored = localStorage.getItem(PORTAL_ROLE_KEY);
    if (stored && Object.hasOwn(PORTAL_ROLES, stored)) return stored;
  } catch {
    // Storage is a convenience; the DOM remains the source of truth.
  }
  return "student";
}

function persistRole(role) {
  try {
    localStorage.setItem(PORTAL_ROLE_KEY, role);
    localStorage.setItem(PORTAL_VIEWS_KEY, JSON.stringify(activeViewByRole));
  } catch {
    // The selected role still works for the current page session.
  }
}

function readPortalViews() {
  const defaults = { student: PORTAL_ROLES.student.defaultView, teacher: PORTAL_ROLES.teacher.defaultView };
  try {
    const parsed = JSON.parse(localStorage.getItem(PORTAL_VIEWS_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return defaults;
    for (const role of Object.keys(defaults)) {
      const restored = role === "teacher" ? TEACHER_VIEW_ALIASES[parsed[role]] || parsed[role] : parsed[role];
      if (PORTAL_ROLES[role].allowedViews.has(restored)) defaults[role] = restored;
    }
  } catch {
    // Use the role defaults.
  }
  return defaults;
}

function readTeacherSubject() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(TEACHER_CONTEXT_KEY) || "null");
    if (parsed?.subjectStudentId) return String(parsed.subjectStudentId);
  } catch {
    // A fresh teacher context will be created for this tab.
  }
  return "";
}

function persistTeacherSubject() {
  try {
    sessionStorage.setItem(TEACHER_CONTEXT_KEY, JSON.stringify({
      subjectStudentId,
      classId: null
    }));
  } catch {
    // The selection still applies to this page session.
  }
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function percent(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "—";
}

function renderTeacherDatabaseViews() {
  const users = globalThis.AIClassroomUserRuntime?.getUsers?.() || [];
  const summaries = users.map((user) => user.mastery_summary || {});
  const assessed = summaries.reduce((sum, item) => sum + Number(item.assessed_count || 0), 0);
  const weightedProbability = summaries.reduce((sum, item) => (
    sum + Number(item.average_mastery_probability || 0) * Number(item.assessed_count || 0)
  ), 0);
  const average = assessed ? weightedProbability / assessed : null;
  setText("#portalSyncTitle", users.length ? "学生数据已同步" : "暂无学生数据");
  setText("#portalSyncSubtitle", users.length ? `${users.length} 个学生档案` : "请检查教育数据库连接");
  const stateTotals = { mastered: 0, secure: 0, learning: 0, weak: 0, unassessed: 0 };
  summaries.forEach((summary) => Object.keys(stateTotals).forEach((key) => {
    stateTotals[key] += Number(summary.by_state?.[key] || 0);
  }));
  const totalStates = Object.values(stateTotals).reduce((sum, value) => sum + value, 0);
  const statePercent = (key) => totalStates ? Math.round((stateTotals[key] / totalStates) * 100) : 0;

  const metricCards = [...document.querySelectorAll("#teacherDashboardWorkspace .teacher-metric-grid article")];
  const metrics = [
    ["学生档案", String(users.length), "当前可查看学生"],
    ["已评估知识点", String(assessed), "按学生独立统计"],
    ["平均掌握度", average == null ? "—" : `${Math.round(average * 100)}%`, "由掌握证据投影计算"],
    ["待加强状态", String(stateTotals.weak), "不等同于学生人数"]
  ];
  metricCards.forEach((card, index) => {
    const [label, value, detail] = metrics[index] || ["暂无数据", "—", ""];
    const copy = card.querySelector("div");
    if (copy) copy.innerHTML = `<small>${escapeHTML(label)}</small><b>${escapeHTML(value)}</b><em>${escapeHTML(detail)}</em>`;
  });

  const stack = document.querySelector("#teacherDashboardWorkspace .teacher-mastery-stack");
  if (stack) stack.innerHTML = [
    ["mastered", "熟练", statePercent("mastered")],
    ["learning", "基本/学习中", statePercent("secure") + statePercent("learning")],
    ["weak", "待巩固", statePercent("weak")],
    ["unknown", "未评估", statePercent("unassessed")]
  ].map(([className, label, value]) => `<span class="${className}" style="--value:${value}%">${label} ${value}%</span>`).join("");

  const topics = document.querySelector("#teacherDashboardWorkspace .teacher-topic-list");
  if (topics) topics.innerHTML = `<div class="user-empty-learning-state"><b>当前为学生汇总视图</b><p>跨学生的逐知识点班级聚合尚未写入数据库，这里不生成虚构薄弱点。</p></div>`;

  const attention = document.querySelector("#teacherDashboardWorkspace .teacher-attention-panel");
  if (attention) {
    attention.querySelectorAll(":scope > button[data-teacher-student-id], :scope > .user-empty-learning-state").forEach((node) => node.remove());
    users.slice().sort((left, right) => {
      const leftValue = left.mastery_summary?.average_mastery_probability;
      const rightValue = right.mastery_summary?.average_mastery_probability;
      return (leftValue == null ? 1 : Number(leftValue)) - (rightValue == null ? 1 : Number(rightValue));
    }).forEach((user) => {
      attention.insertAdjacentHTML("beforeend", `<button type="button" data-teacher-student-id="${escapeHTML(user.id)}"><span class="teacher-student-avatar ${escapeHTML(user.color || "blue")}">${escapeHTML(user.avatar || user.name?.slice(0, 1) || "学")}</span><span><b>${escapeHTML(user.name)}</b><small>平均掌握度 ${escapeHTML(percent(user.mastery_summary?.average_mastery_probability))}</small></span><em>查看</em></button>`);
    });
  }

  const todayPanel = document.querySelector("#teacherDashboardWorkspace .teacher-today-panel");
  if (todayPanel) {
    todayPanel.querySelectorAll(":scope > article, :scope > .user-empty-learning-state").forEach((node) => node.remove());
    todayPanel.insertAdjacentHTML("beforeend", `<div class="user-empty-learning-state"><b>暂无教学安排</b><p>当前数据库尚未建立课堂和作业计划表。</p></div>`);
    todayPanel.querySelector("h3")?.replaceChildren(document.createTextNode("暂无安排"));
  }

  const summarySpans = [...document.querySelectorAll("#teacherStudentsWorkspace .teacher-student-summary > span")];
  const summaryValues = [
    [users.length, "学生档案"],
    [assessed, "已评估知识点"],
    [stateTotals.weak, "待加强状态"],
    [users.filter((user) => user.simulated).length, "演示账号"]
  ];
  summarySpans.forEach((node, index) => {
    const [value, label] = summaryValues[index] || [0, "暂无数据"];
    node.innerHTML = `<b>${escapeHTML(value)}</b><small>${escapeHTML(label)}</small>`;
  });

  const table = document.querySelector("#teacherStudentsWorkspace .teacher-student-table");
  if (table) {
    table.querySelectorAll(":scope > button[data-teacher-student-id]").forEach((node) => node.remove());
    users.forEach((user) => {
      const summary = user.mastery_summary || {};
      const averageValue = summary.average_mastery_probability == null
        ? null
        : Number(summary.average_mastery_probability);
      const hasAverage = Number.isFinite(averageValue);
      const attentionClass = hasAverage && averageValue < 0.6 ? "attention" : hasAverage ? "good" : "unknown";
      const attentionText = hasAverage && averageValue < 0.6 ? "待加强" : hasAverage ? "学习中" : "未评估";
      table.insertAdjacentHTML("beforeend", `<button class="teacher-student-row" type="button" role="row" data-teacher-student-id="${escapeHTML(user.id)}"><span><i class="teacher-student-avatar ${escapeHTML(user.color || "blue")}">${escapeHTML(user.avatar || user.name?.slice(0, 1) || "学")}</i><b>${escapeHTML(user.name)}<small>${escapeHTML(user.grade || "")}</small></b></span><span>${escapeHTML(user.goal || "自主学习")}</span><span>${escapeHTML(percent(summary.coverage))}</span><span>${escapeHTML(percent(summary.average_mastery_probability))}</span><span>—</span><em class="${attentionClass}">${attentionText}</em></button>`);
    });
  }

  const courseGrid = document.querySelector("#teacherCoursesWorkspace .teacher-course-grid");
  if (courseGrid) courseGrid.innerHTML = `<div class="user-empty-learning-state"><i data-lucide="database" aria-hidden="true"></i><b>课程数据库尚未接入</b><p>已保留课程模块入口，但不展示虚构的发布、进度和学习人数。</p></div>`;
  document.querySelectorAll("#teacherCoursesWorkspace .teacher-course-filter button b").forEach((node) => { node.textContent = "0"; });

  const teacherPlan = document.querySelector("#teacherPlanWorkspace .teacher-plan-layout");
  if (teacherPlan) teacherPlan.innerHTML = `<section class="teacher-panel user-empty-learning-state"><i data-lucide="calendar-x" aria-hidden="true"></i><b>暂无教学计划数据</b><p>课堂、作业和测验表尚未接入数据库，因此不显示预设时间线。</p></section>`;
}

function getVisibleWorkspaceView() {
  return document.querySelector("[data-workspace-panel]:not([hidden])")?.dataset.workspacePanel || "";
}

export function getPortalRole() {
  return activeRole;
}

export function resolvePortalWorkspace(view, role = activeRole) {
  const portal = PORTAL_ROLES[role] || PORTAL_ROLES.student;
  const target = role === "teacher" ? TEACHER_VIEW_ALIASES[view] || view : view;
  return portal.allowedViews.has(target) ? target : portal.defaultView;
}

export function getPortalWorkspacePresentation(view, role = activeRole) {
  return WORKSPACE_PRESENTATION[role]?.[view] || null;
}

export function getPortalWorkspaceButton(view, role = activeRole) {
  return document.querySelector(`[data-portal-role="${role}"][data-workspace-view="${view}"]`)
    || document.querySelector(`[data-workspace-view="${view}"]`);
}

function isMobileShell() {
  return globalThis.matchMedia?.(MOBILE_SHELL_QUERY).matches === true;
}

function getMobileDialogTrigger(dialog) {
  if (dialog?.id === "studentMobileMoreDialog") return document.querySelector("#studentMobileMoreButton");
  if (dialog?.id === "teacherMobileNavDialog") return document.querySelector(".launcher-button");
  return null;
}

function closeMobileNavDialog(dialog, { restoreFocus = false } = {}) {
  if (!dialog?.open) return;
  dialog.dataset.restoreFocus = String(restoreFocus);
  dialog.close();
}

function closeMobileNavDialogs(options = {}) {
  document.querySelectorAll(".mobile-nav-dialog[open]").forEach((dialog) => {
    closeMobileNavDialog(dialog, options);
  });
}

function openMobileNavDialog(dialog) {
  if (!dialog || !isMobileShell() || dialog.dataset.mobilePortalRole !== activeRole) return;
  dialog.hidden = false;
  const trigger = getMobileDialogTrigger(dialog);
  trigger?.setAttribute("aria-expanded", "true");
  dialog.dataset.restoreFocus = "true";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  const selected = dialog.querySelector('[role="tab"][aria-selected="true"]');
  const first = dialog.querySelector('[role="tab"], [data-mobile-nav-close]');
  requestAnimationFrame(() => (selected || first)?.focus({ preventScroll: true }));
}

function syncMobileLauncher() {
  const launcher = document.querySelector(".launcher-button");
  if (!launcher) return;
  const teacherDrawerTrigger = activeRole === "teacher" && isMobileShell();
  if (teacherDrawerTrigger) {
    launcher.setAttribute("aria-label", "打开教师端菜单");
    launcher.setAttribute("title", "教师端菜单");
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.setAttribute("aria-controls", "teacherMobileNavDialog");
    launcher.setAttribute("aria-expanded", String(document.querySelector("#teacherMobileNavDialog")?.open === true));
    return;
  }
  launcher.setAttribute("aria-label", "打开产品菜单");
  launcher.setAttribute("title", "产品菜单");
  launcher.removeAttribute("aria-haspopup");
  launcher.removeAttribute("aria-controls");
  launcher.removeAttribute("aria-expanded");
}

function syncMobileNavigation(view = getVisibleWorkspaceView(), role = activeRole) {
  document.querySelectorAll("[data-mobile-workspace-view]").forEach((button) => {
    const selected = button.dataset.mobilePortalRoleScope === role && button.dataset.mobileWorkspaceView === view;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
  });

  document.querySelectorAll(".mobile-student-primary-tabs, .mobile-nav-menu").forEach((tablist) => {
    const tabs = [...tablist.querySelectorAll(':scope > [role="tab"][data-mobile-workspace-view]')];
    const selected = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    const fallback = tabs.find((tab) => tab.dataset.mobilePortalRoleScope === role) || tabs[0];
    tabs.forEach((tab) => { tab.tabIndex = tab === (selected || fallback) ? 0 : -1; });
  });

  const primaryViews = new Set(["agent", "course", "plan", "bank"]);
  const moreButton = document.querySelector("#studentMobileMoreButton");
  const moreSelected = role === "student" && !primaryViews.has(view);
  moreButton?.classList.toggle("is-active", moreSelected);
  if (moreSelected) moreButton?.setAttribute("aria-current", "page");
  else moreButton?.removeAttribute("aria-current");
}

function bindMobileTablistKeyboard(tablist) {
  tablist.addEventListener("keydown", (event) => {
    const tabs = [...tablist.querySelectorAll(':scope > [role="tab"][data-mobile-workspace-view]')]
      .filter((tab) => !tab.disabled && !tab.hidden);
    const currentIndex = tabs.indexOf(event.target.closest?.('[role="tab"]'));
    if (currentIndex < 0 || !tabs.length) return;
    const vertical = tablist.getAttribute("aria-orientation") === "vertical";
    const nextKey = vertical ? "ArrowDown" : "ArrowRight";
    const previousKey = vertical ? "ArrowUp" : "ArrowLeft";
    let nextIndex = currentIndex;
    if (event.key === nextKey) nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === previousKey) nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs.forEach((tab, index) => { tab.tabIndex = index === nextIndex ? 0 : -1; });
    tabs[nextIndex]?.focus();
  });
}

function bindMobileNavigation() {
  const studentMoreButton = document.querySelector("#studentMobileMoreButton");
  const studentDialog = document.querySelector("#studentMobileMoreDialog");
  const teacherDialog = document.querySelector("#teacherMobileNavDialog");
  const launcher = document.querySelector(".launcher-button");

  studentMoreButton?.addEventListener("click", () => openMobileNavDialog(studentDialog));
  document.querySelectorAll("[data-mobile-workspace-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const role = button.dataset.mobilePortalRoleScope || activeRole;
      if (role !== activeRole) return;
      activateWorkspaceHandler?.(resolvePortalWorkspace(button.dataset.mobileWorkspaceView, role));
    });
  });
  launcher?.addEventListener("click", (event) => {
    if (activeRole !== "teacher" || !isMobileShell()) return;
    event.preventDefault();
    openMobileNavDialog(teacherDialog);
  });

  document.querySelectorAll(".mobile-nav-dialog").forEach((dialog) => {
    dialog.addEventListener("close", () => {
      const trigger = getMobileDialogTrigger(dialog);
      trigger?.setAttribute("aria-expanded", "false");
      const restoreFocus = dialog.dataset.restoreFocus !== "false";
      delete dialog.dataset.restoreFocus;
      if (restoreFocus && trigger && !trigger.hidden) requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
      syncMobileLauncher();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-mobile-nav-close]")) {
        closeMobileNavDialog(dialog, { restoreFocus: true });
        return;
      }
      if (event.target.closest("[data-mobile-workspace-view]")) {
        closeMobileNavDialog(dialog, { restoreFocus: false });
      }
    });
  });

  document.querySelectorAll("[data-mobile-switch-role]").forEach((button) => {
    button.addEventListener("click", () => {
      closeMobileNavDialogs({ restoreFocus: false });
      switchPortalRole(button.dataset.mobileSwitchRole);
    });
  });

  document.querySelectorAll(".mobile-student-primary-tabs, .mobile-nav-menu").forEach(bindMobileTablistKeyboard);
  const mobileMedia = globalThis.matchMedia?.(MOBILE_SHELL_QUERY);
  mobileMedia?.addEventListener?.("change", () => {
    if (!mobileMedia.matches) closeMobileNavDialogs({ restoreFocus: false });
    syncMobileLauncher();
  });
}

function updatePortalCopy(role) {
  const teacher = role === "teacher";
  const sidebar = document.querySelector(".workspace-sidebar");
  sidebar?.setAttribute("aria-label", teacher ? "教师端导航" : "学生端导航");
  setText("#portalSidebarKicker", teacher ? "教师端" : "学生端");
  setText("#portalSidebarTitle", teacher ? "教学工作台" : "我的学习");
  setText("#portalSyncTitle", teacher ? "正在读取学生数据" : "学习记录已同步");
  setText("#portalSyncSubtitle", teacher ? "学生档案按权限隔离" : "刚刚更新");
  setText("#learningUserModeLabel", teacher ? "当前查看" : "演示学生");
  setText("#learningUserMenuTitle", teacher ? "选择查看学生" : "切换学习账号");
  setText("#learningUserMenuSubtitle", teacher ? "切换后查看对应学情与证据" : "学习数据按账号隔离");
  setText("#createSimulatedUserLabel", teacher ? "新建学生" : "新建学生");
  setText("#createSimulatedUserHint", teacher ? "添加一份独立的演示学情" : "创建一份独立的学习档案");
  setText("#voiceConfigPageTitle", teacher ? "AI教师设置" : "学习偏好");
  setText("#voiceConfigPageDescription", teacher
    ? "设置讲解方式、知识范围、出题策略和课堂声音。"
    : "选择喜欢的教师声音、语速和上课问候。");
  const learnerSwitcher = document.querySelector(".learning-user-switcher");
  const teacherAccount = document.querySelector("#teacherAccountIndicator");
  if (learnerSwitcher) learnerSwitcher.hidden = teacher;
  if (teacherAccount) teacherAccount.hidden = !teacher;
}

function updatePortalVisibility(role) {
  closeMobileNavDialogs({ restoreFocus: false });
  document.body.dataset.portalRole = role;
  document.querySelectorAll("[data-portal-menu]").forEach((menu) => {
    menu.hidden = menu.dataset.portalMenu !== role;
  });
  document.querySelectorAll("[data-portal-only]").forEach((element) => {
    const matchesRole = element.dataset.portalOnly === role;
    if (!matchesRole) element.hidden = true;
    else if (element.dataset.portalDisclosure !== "manual") element.hidden = false;
  });
  document.querySelectorAll("[data-portal-switch]").forEach((button) => {
    const selected = button.dataset.portalSwitch === role;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll("[data-mobile-portal-role]").forEach((element) => {
    element.hidden = element.dataset.mobilePortalRole !== role;
  });
  syncMobileNavigation(getVisibleWorkspaceView(), role);
  syncMobileLauncher();
}

function renderTeacherStudentSelection(userId = subjectStudentId) {
  const users = globalThis.AIClassroomUserRuntime?.getUsers?.() || [];
  const user = users.find((item) => item.id === userId) || users[0];
  if (!user) return;
  subjectStudentId = user.id;
  persistTeacherSubject();
  document.querySelectorAll("[data-teacher-student-id]").forEach((button) => {
    const selected = button.dataset.teacherStudentId === subjectStudentId;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const summary = user.mastery_summary || {};
  const values = {
    avatar: user.avatar || user.name?.slice(0, 1) || "学",
    name: user.name || "学生",
    recordSubtitle: `${user.grade || ""} · ${user.simulated ? "演示学生" : "学生档案"}`,
    accuracy: percent(summary.average_mastery_probability),
    knowledgeCoverage: percent(summary.coverage),
    planProgress: "—"
  };
  for (const [field, value] of Object.entries(values)) {
    document.querySelectorAll(`[data-subject-field="${field}"]`).forEach((element) => {
      element.textContent = value;
    });
  }
  document.dispatchEvent(new CustomEvent("learning-subject:change", {
    detail: { studentId: subjectStudentId, student: user, classId: null }
  }));
}

function showPortalToast(message) {
  let toast = document.querySelector("#portalRuntimeToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "portalRuntimeToast";
    toast.className = "portal-runtime-toast";
    toast.setAttribute("role", "status");
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(Number(toast.dataset.timer || 0));
  const timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
  toast.dataset.timer = String(timer);
}

function switchPortalRole(role, { initial = false } = {}) {
  const nextRole = Object.hasOwn(PORTAL_ROLES, role) ? role : "student";
  const previousRole = activeRole;
  const changed = nextRole !== activeRole;
  activeRole = nextRole;
  persistRole(nextRole);
  updatePortalVisibility(nextRole);
  updatePortalCopy(nextRole);

  const currentView = getVisibleWorkspaceView();
  if (!initial && changed && previousRole && PORTAL_ROLES[previousRole]?.allowedViews.has(currentView)) {
    activeViewByRole[previousRole] = currentView;
  }
  const nextView = resolvePortalWorkspace(activeViewByRole[nextRole], nextRole);
  activateWorkspaceHandler?.(nextView);

  if (nextRole === "teacher") renderTeacherStudentSelection(subjectStudentId);
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  document.dispatchEvent(new CustomEvent("portal-role:change", {
    detail: { role: nextRole, previousRole, view: nextView, subjectStudentId: nextRole === "teacher" ? subjectStudentId : null }
  }));
  if (changed && !initial) showPortalToast(nextRole === "teacher" ? "已进入教师端" : "已返回学生端");
}

function bindPortalInteractions() {
  bindMobileNavigation();
  const portalSwitches = [...document.querySelectorAll("[data-portal-switch]")];
  portalSwitches.forEach((button, index) => {
    button.addEventListener("click", () => switchPortalRole(button.dataset.portalSwitch));
    button.addEventListener("keydown", (event) => {
      const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
      let nextIndex = index;
      if (direction) nextIndex = (index + direction + portalSwitches.length) % portalSwitches.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = portalSwitches.length - 1;
      if (!direction && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const next = portalSwitches[nextIndex];
      next?.focus();
      if (next?.dataset.portalSwitch) switchPortalRole(next.dataset.portalSwitch);
    });
  });

  document.addEventListener("click", (event) => {
    const studentButton = event.target.closest("[data-teacher-student-id]");
    if (studentButton) {
      const userId = studentButton.dataset.teacherStudentId;
      renderTeacherStudentSelection(userId);
      const userName = (globalThis.AIClassroomUserRuntime?.getUsers?.() || [])
        .find((item) => item.id === userId)?.name || "学生";
      showPortalToast(`已切换查看${userName}的学习档案`);
      return;
    }

    if (event.target.closest("[data-teacher-open-question-generator]")) {
      activateWorkspaceHandler?.("bank");
      window.setTimeout(() => document.querySelector('[data-question-bank-view="generator"]')?.click(), 30);
      return;
    }

    const courseCreate = event.target.closest("[data-teacher-create-course]");
    if (courseCreate) showPortalToast("已创建课程草稿，可继续编辑章节与资料");
  });

  document.querySelectorAll("[data-teacher-task]").forEach((input) => {
    input.addEventListener("change", () => {
      input.closest("label")?.classList.toggle("is-done", input.checked);
      showPortalToast(input.checked ? "教学事项已完成" : "已恢复为待处理");
    });
  });

  document.querySelectorAll("[data-teacher-config]").forEach((control) => {
    control.addEventListener("change", () => setText("#voiceConfigApplyStatus", "有未保存的教学配置"));
  });

  document.querySelector("#voiceConfigApplyBtn")?.addEventListener("click", () => {
    if (activeRole !== "teacher") return;
    const config = Object.fromEntries([...document.querySelectorAll("[data-teacher-config]")]
      .map((control) => [control.dataset.teacherConfig, control.value]));
    try {
      localStorage.setItem("ai-teacher:teacher-config:v1", JSON.stringify(config));
    } catch {
      // Keep the current form state if storage is not available.
    }
    setText("#voiceConfigApplyStatus", "教学配置已保存");
    showPortalToast("AI教师设置已保存");
  });

  document.addEventListener("learning-workspace:change", (event) => {
    const role = event.detail?.role || activeRole;
    const view = event.detail?.view;
    if (!PORTAL_ROLES[role]?.allowedViews.has(view)) return;
    activeViewByRole[role] = view;
    persistRole(activeRole);
    syncMobileNavigation(view, role);
  });

}

function restoreTeacherConfig() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem("ai-teacher:teacher-config:v1") || "null");
  } catch {
    stored = null;
  }
  if (!stored || typeof stored !== "object") return;
  document.querySelectorAll("[data-teacher-config]").forEach((control) => {
    if (typeof stored[control.dataset.teacherConfig] === "string") {
      control.value = stored[control.dataset.teacherConfig];
    }
  });
}

export function initPortalRuntime({ activateWorkspace } = {}) {
  activateWorkspaceHandler = typeof activateWorkspace === "function" ? activateWorkspace : null;
  restoreTeacherConfig();
  bindPortalInteractions();
  document.addEventListener("education-data:ready", () => {
    renderTeacherDatabaseViews();
    if (activeRole === "teacher") renderTeacherStudentSelection(subjectStudentId);
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  });
  document.addEventListener("learning-user:data-change", () => {
    renderTeacherDatabaseViews();
    if (activeRole === "teacher") renderTeacherStudentSelection(subjectStudentId);
  });
  const api = Object.freeze({
    getRole: getPortalRole,
    switchRole: (role) => switchPortalRole(role),
    resolveWorkspace: resolvePortalWorkspace,
    openWorkspace: (view) => activateWorkspaceHandler?.(view),
    getSubjectStudentId: () => subjectStudentId
  });
  globalThis.AITeacherPortalRuntime = api;
  switchPortalRole(activeRole, { initial: true });
  renderTeacherDatabaseViews();
  return api;
}
