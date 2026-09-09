import { getCurrentEducationProfile, getEducationDataStatus } from "./education-data-client.js";

// A course selector can differ from the scope the server actually loaded.
// Never label another ontology's student score as this course's mastery.
export function courseContextModel({ snapshot, profile, status, role = "student", catalog = [] }) {
  const scope = snapshot?.status === "ready" ? snapshot.scope : null;
  const course = scope && catalog.find(item => item.agentScopeId === scope.scope_id
    || item.reference?.curriculumId === scope.ontology_id);
  const summary = profile?.mastery_summary;
  const matched = Boolean(scope?.ontology_id && summary?.ontology_id === scope.ontology_id
    && (!scope.ontology_version || !summary.ontology_version || scope.ontology_version === summary.ontology_version));
  const available = role === "student" && status === "ready" && matched;
  const value = available && summary.average_mastery_probability != null ? Number(summary.average_mastery_probability) : NaN;
  const percent = Number.isFinite(value) && value >= 0 && value <= 1 ? Math.round(value * 100) : null;
  const label = scope?.label || (snapshot?.status === "error" ? "课程加载失败" : "正在加载课程");
  const note = role === "teacher" ? "课堂预览不展示学生的个人掌握度。"
    : snapshot?.status === "error" ? "课程暂未加载成功，请稍后重新选择课程。"
    : !scope ? "正在确认本次对话使用的课程。"
    : status === "error" ? "掌握记录暂时不可用，请稍后重试。"
    : status !== "ready" ? "正在读取掌握记录。"
    : !matched ? "当前课程尚无匹配的掌握记录。"
    : percent == null ? "尚未形成有效的掌握评估。"
    : "根据有效作答计算的知识点平均掌握度。";
  const states = available ? summary.by_state || {} : {};
  const count = key => available && states[key] != null && Number.isFinite(Number(states[key])) ? Number(states[key]) : null;
  const mastered = count("mastered"), secure = count("secure");
  return { scope, course, label, percent, note,
    total: available ? summary.knowledge_point_count : null,
    assessed: available ? summary.assessed_count : null,
    counts: [mastered != null || secure != null ? (mastered ?? 0) + (secure ?? 0) : null,
      count("learning"), count("weak"), count("unassessed")] };
}

export function mountAppCourseContext({ openWorkspace }) {
  const voice = document.querySelector("#teacherVoiceModeBtn");
  if (!voice) return;
  const button = document.createElement("button");
  button.id = "appCourseContextButton";
  button.className = "app-course-context-button";
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", "appCourseContextDialog");
  button.innerHTML = '<span class="app-course-mini-icon"><i data-lucide="book-open"></i></span><strong>—</strong>';
  voice.before(button);
  const dialog = document.createElement("dialog");
  dialog.id = "appCourseContextDialog";
  dialog.className = "app-course-context-dialog";
  dialog.setAttribute("aria-labelledby", "appCourseDetailTitle");
  dialog.innerHTML = `<header><span>当前对话的课程</span><button type="button" data-course-close aria-label="关闭课程详情"><i data-lucide="x"></i></button></header>
    <div class="app-course-detail-identity"><span class="app-course-detail-icon"><i data-lucide="book-open"></i></span><div><h2 id="appCourseDetailTitle"></h2><p data-course-meta></p></div></div>
    <section class="app-course-mastery"><div><span>知识点平均掌握度</span><strong data-course-percent>—</strong></div><meter min="0" max="100" value="0" aria-label="知识点平均掌握度"></meter><p data-course-note></p></section>
    <dl class="app-course-counts">${["已掌握", "学习中", "待巩固", "未评估"].map((name,index) => `<div><dd data-course-count="${index}">—</dd><dt>${name}</dt></div>`).join("")}</dl>
    <p class="app-course-coverage" data-course-coverage></p>
    <section class="app-course-materials"><h3>已加载教材</h3><ul></ul></section>
    <footer><button type="button" data-course-records>查看掌握详情<i data-lucide="arrow-up-right"></i></button><button type="button" data-course-directory>查看课程目录<i data-lucide="chevron-right"></i></button></footer>`;
  document.body.append(dialog);
  let model;
  let activeIcon = "";
  const sync = () => {
    model = courseContextModel({
      snapshot: window.AITeacherLearningScope?.getSnapshot(), profile: getCurrentEducationProfile(),
      status: getEducationDataStatus("student"), role: document.body.dataset.portalRole,
      catalog: window.AIClassroomUserRuntime?.getCourseCatalog?.() || []
    });
    const percent = model.percent == null ? "—" : `${model.percent}%`;
    button.querySelector("strong").textContent = percent;
    button.setAttribute("aria-label", `${model.label}，${model.percent == null ? "暂无掌握度" : `掌握 ${percent}`}，查看课程详情`);
    button.title = `${model.label} · ${percent}`;
    dialog.querySelector("h2").textContent = model.label;
    dialog.querySelector("[data-course-meta]").textContent = [model.scope?.subject, model.scope?.grade_band].filter(Boolean).join(" · ");
    dialog.querySelector("[data-course-percent]").textContent = percent;
    dialog.querySelector("[data-course-note]").textContent = model.note;
    const meter = dialog.querySelector("meter");
    meter.hidden = model.percent == null;
    meter.value = model.percent ?? 0;
    model.counts.forEach((count,index) => { dialog.querySelector(`[data-course-count="${index}"]`).textContent = count == null ? "—" : String(count); });
    dialog.querySelector("[data-course-coverage]").textContent = model.total == null ? "" : `已评估 ${model.assessed ?? "—"} / ${model.total} 个知识点`;
    const list = dialog.querySelector(".app-course-materials ul");
    list.replaceChildren();
    const materials = model.scope?.loaded_materials || [];
    for (const item of materials) {
      const row = document.createElement("li");
      row.textContent = item.title || item.name || "课程材料";
      list.append(row);
    }
    if (!materials.length) { const empty = document.createElement("li"); empty.textContent = "暂无已加载教材"; list.append(empty); }
    dialog.querySelector("[data-course-records]").hidden = document.body.dataset.portalRole === "teacher";
    const icon = model.course?.icon || "book-open";
    if (activeIcon !== icon) {
      activeIcon = icon;
      for (const target of [button.querySelector(".app-course-mini-icon"), dialog.querySelector(".app-course-detail-icon")]) {
        const symbol = document.createElement("i"); symbol.setAttribute("data-lucide", icon); symbol.setAttribute("aria-hidden", "true"); target.replaceChildren(symbol);
      }
    }
    window.lucide?.createIcons?.();
  };
  const close = () => { dialog.close(); button.focus(); };
  button.addEventListener("click", () => { sync(); dialog.showModal(); });
  dialog.querySelector("[data-course-close]").addEventListener("click", close);
  dialog.addEventListener("close", () => {
    if (document.body.dataset.displayMode === "app" && document.body.dataset.appPage === "agent") button.focus();
  });
  dialog.querySelector("[data-course-records]").addEventListener("click", () => {
    dialog.close(); openWorkspace("records");
    document.querySelector('[data-record-tab="mastery"]')?.click();
  });
  dialog.querySelector("[data-course-directory]").addEventListener("click", () => {
    dialog.close();
    if (document.body.dataset.portalRole === "teacher") openWorkspace("teacher-courses");
    else {
      if (model.course) {
        window.AIClassroomUserRuntime?.selectCourse?.(model.course.id);
        window.AIClassroomUserRuntime?.renderCourses?.();
      }
      openWorkspace("course");
    }
  });
  // Keep voice reachable in the conversation's overflow menu, using its
  // existing handler and live connection state instead of a second runtime.
  const voiceMenu = document.createElement("button");
  voiceMenu.type = "button"; voiceMenu.className = "app-conversation-voice";
  voiceMenu.innerHTML = '<i data-lucide="audio-lines" aria-hidden="true"></i><span>语音交流</span>';
  document.querySelector("#teacherDialogueMenu")?.prepend(voiceMenu);
  voiceMenu.addEventListener("click", () => { document.querySelector("#teacherDialogueMoreBtn")?.click(); voice.click(); });
  document.querySelector("#teacherVoicePanelCloseBtn")?.addEventListener("click", () => {
    if (document.body.dataset.displayMode === "app") document.querySelector("#teacherDialogueMoreBtn")?.focus();
  });
  for (const event of ["learning-scope:change", "learning-user:change", "learning-user:data-change", "education-data:ready", "portal-role:change"]) document.addEventListener(event, sync);
  window.addEventListener("resize", () => { if (document.body.dataset.displayMode !== "app" && dialog.open) dialog.close(); });
  sync();
}
