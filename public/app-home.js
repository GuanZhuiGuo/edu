// Student phone home is a presentation surface over the existing application.
// It never recreates the classroom, switches accounts or submits a question.
const mountedHomes = new WeakMap();

const HOME_TOOLS = Object.freeze([
  { action: "photo", icon: "camera", title: "拍题答疑", detail: "分步讲明白", tone: "blue" },
  { action: "grade", icon: "clipboard-check", title: "作业批改", detail: "检查已做作业", tone: "coral" },
  { action: "knowledge", icon: "sparkles", title: "知识点学习", detail: "选择课程知识", tone: "blue" },
  { action: "oral", icon: "mic", title: "口语练习", detail: "情境对话陪练", tone: "blue" },
  { action: "plan", icon: "route", title: "今日计划", detail: "安排学习节奏", tone: "blue" },
  { action: "course", icon: "book-open", title: "我的课程", detail: "查看课程章节", tone: "gold" },
  { action: "records", icon: "chart-no-axes-combined", title: "学习记录", detail: "回看学习证据", tone: "blue" },
  { action: "buddy", icon: "users-round", title: "学习搭子", detail: "一起专注自习", tone: "sage" }
]);

const EXISTING_ACTIONS = Object.freeze({
  photo: { selector: "#teacherMoreBtn", unavailable: "上传入口正在准备，请稍后再试。" },
  grade: { selector: '[data-teacher-photo-mode="grade"]', unavailable: "批改入口正在准备，请稍后再试。" },
  knowledge: { selector: "#teacherMentionBtn", unavailable: "知识点入口正在准备，请稍后再试。" },
  oral: { selector: '[data-teacher-shortcut="oral-practice"]', unavailable: "口语练习入口正在准备，请稍后再试。" },
  voice: { selector: "#teacherVoiceModeBtn", unavailable: "语音入口正在准备，请稍后再试。" }
});

const iconMarkup = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;

/**
 * Mount once after the existing workspace DOM exists. The caller decides when
 * to show the home surface (e.g. student + phone, or the Home navigation item).
 * openWorkspace must navigate synchronously: file-picker actions rely on the
 * original trusted click's activation and therefore cannot cross an await.
 */
export function mountAppHome({ openWorkspace, showHomeChanged = () => {} } = {}) {
  if (typeof openWorkspace !== "function") throw new TypeError("mountAppHome requires openWorkspace(view)");
  if (mountedHomes.has(document)) return mountedHomes.get(document);
  const workspace = document.querySelector(".workspace");
  const appMain = document.querySelector("#appMainContent");
  if (!workspace || !appMain) throw new Error("Mount the phone home after the application workspace is ready");

  const home = document.createElement("section");
  home.id = "appStudentHome";
  home.className = "app-student-home";
  home.hidden = true;
  home.setAttribute("aria-labelledby", "appHomeTitle");
  home.innerHTML = `
    <div class="app-home-scroll">
      <header class="app-home-hero">
        <div class="app-home-welcome"><span data-app-home-user>你好，同学</span><span class="app-home-grade" data-app-home-grade hidden></span></div>
        <h1 id="appHomeTitle" tabindex="-1">把问题讲明白</h1>
        <p class="app-home-intro">拍题、提问、练习，陪你一步步学会。</p>
        <div class="app-home-context">
          <button class="app-home-current-course" type="button" data-app-home-action="course" aria-label="查看当前课程">
            ${iconMarkup("book-open")}<span><small>当前课程</small><b data-app-home-course>选择一门课程</b></span>${iconMarkup("chevron-right")}
          </button>
          <button class="app-home-voice" type="button" data-app-home-action="voice" aria-label="与AI教师语音交流">${iconMarkup("audio-lines")}<span>语音交流</span></button>
        </div>
      </header>
      <div class="app-home-content">
        <button class="app-home-photo" type="button" data-app-home-action="photo">
          <span class="app-home-photo-icon">${iconMarkup("camera")}</span>
          <span class="app-home-photo-copy"><b>拍一道不会的题</b><small>上传题目图片，开始分步讲解</small></span>
          ${iconMarkup("chevron-right")}
        </button>
        <section class="app-home-tools" aria-labelledby="appHomeToolsTitle">
          <h2 id="appHomeToolsTitle">我的学习工具</h2>
          <div class="app-home-tool-grid">${HOME_TOOLS.map(({ action, icon, title, detail, tone }) => `
            <button class="app-home-tool" type="button" data-app-home-action="${action}" data-tone="${tone}">
              <span class="app-home-tool-icon">${iconMarkup(icon)}</span><b>${title}</b><small>${detail}</small>
            </button>`).join("")}
          </div>
        </section>
        <p class="app-home-notice" data-app-home-notice role="status" aria-live="polite" hidden></p>
        <div class="app-home-learning-note">${iconMarkup("notebook-pen")}<p>想回顾学过的内容，可以到「学情」查看学习记录。</p></div>
      </div>
    </div>
    <nav class="app-home-bottom-nav" aria-label="学生端主要导航">
      <button type="button" data-app-home-action="home" aria-current="page">${iconMarkup("house")}<span>首页</span></button>
      <button type="button" data-app-home-action="agent">${iconMarkup("graduation-cap")}<span>学习</span></button>
      <button type="button" data-app-home-action="course">${iconMarkup("book-open")}<span>课程</span></button>
      <button type="button" data-app-home-action="records">${iconMarkup("chart-no-axes-combined")}<span>学情</span></button>
      <button type="button" data-app-home-action="more" aria-haspopup="dialog" aria-controls="studentMobileMoreDialog">${iconMarkup("ellipsis")}<span>更多</span></button>
    </nav>`;
  workspace.append(home);

  let visible = false;
  let previousMainInert = false;
  let previousMainAriaHidden = null;
  let previousFocus = null;

  const isStudentPhone = () => document.body.dataset.displayMode === "app" && document.body.dataset.portalRole !== "teacher";
  const notify = (isVisible) => { if (typeof showHomeChanged === "function") showHomeChanged(isVisible); };
  const setNotice = (message = "") => {
    const node = home.querySelector("[data-app-home-notice]");
    node.textContent = message;
    node.hidden = !message;
  };

  function sync() {
    if (visible && !isStudentPhone()) hide({ restoreFocus: false });
    const runtime = globalThis.AIClassroomUserRuntime;
    let user = null;
    let course = null;
    try { user = runtime?.getCurrentUser?.() || null; } catch { /* Existing account controls own retry. */ }
    try { course = runtime?.getCurrentCourse?.() || null; } catch { /* Course library remains available. */ }
    const name = typeof user?.name === "string" ? user.name.trim() : "";
    const grade = typeof user?.grade === "string" ? user.grade.trim() : "";
    const title = typeof course?.title === "string" ? course.title.trim() : "";
    home.querySelector("[data-app-home-user]").textContent = name ? `${name}，你好` : "你好，同学";
    const gradeNode = home.querySelector("[data-app-home-grade]");
    gradeNode.textContent = grade;
    gradeNode.hidden = !grade;
    home.querySelector("[data-app-home-course]").textContent = title || "选择一门课程";
    home.querySelector(".app-home-current-course").setAttribute("aria-label", title ? `当前课程：${title}，查看课程` : "选择一门课程");
    home.dataset.currentUserId = typeof user?.id === "string" ? user.id : "";
    home.dataset.currentCourseId = typeof course?.id === "string" ? course.id : "";
    return { visible, userId: home.dataset.currentUserId, courseId: home.dataset.currentCourseId };
  }

  function show({ focus = true } = {}) {
    if (!isStudentPhone()) return false;
    sync();
    setNotice();
    if (visible) return true;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousMainInert = appMain.inert;
    previousMainAriaHidden = appMain.getAttribute("aria-hidden");
    appMain.inert = true;
    appMain.setAttribute("aria-hidden", "true");
    home.hidden = false;
    visible = true;
    document.body.dataset.appHomeVisible = "true";
    if (focus) home.querySelector("#appHomeTitle").focus({ preventScroll: true });
    notify(true);
    return true;
  }

  function hide({ restoreFocus = false } = {}) {
    if (!visible) return false;
    visible = false;
    home.hidden = true;
    delete document.body.dataset.appHomeVisible;
    appMain.inert = previousMainInert;
    if (previousMainAriaHidden === null) appMain.removeAttribute("aria-hidden");
    else appMain.setAttribute("aria-hidden", previousMainAriaHidden);
    if (restoreFocus && previousFocus?.isConnected && !previousFocus.closest("[inert], [hidden]")) previousFocus.focus({ preventScroll: true });
    notify(false);
    return true;
  }

  function openExistingAction(action) {
    const spec = EXISTING_ACTIONS[action];
    const control = document.querySelector(spec.selector);
    if (!control || control.disabled || control.getAttribute("aria-disabled") === "true") {
      setNotice(spec.unavailable);
      return;
    }
    hide();
    openWorkspace("agent");
    // Synchronous forwarding retains the trusted user's file-picker activation.
    // Existing handlers own attachment selection, image mode and voice startup.
    control.click();
  }

  home.addEventListener("click", (event) => {
    const control = event.target.closest("[data-app-home-action]");
    if (!control || !home.contains(control) || !visible || !isStudentPhone()) return;
    const action = control.dataset.appHomeAction;
    if (action === "home") {
      home.querySelector(".app-home-scroll").scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    if (Object.hasOwn(EXISTING_ACTIONS, action)) {
      openExistingAction(action);
      return;
    }
    if (action === "more") {
      const more = document.querySelector("#studentMobileMoreButton");
      const dialog = document.querySelector("#studentMobileMoreDialog");
      if (!more || more.disabled || !dialog) { setNotice("更多学习工具正在准备，请稍后再试。"); return; }
      let navigated = false;
      // Feature and role handlers can close the dialog before its bubble phase.
      const markNavigation = (menuEvent) => {
        if (menuEvent.target.closest("[data-mobile-workspace-view], [data-mobile-switch-role]")) navigated = true;
      };
      const cleanup = () => {
        dialog.removeEventListener("click", markNavigation, true);
        dialog.removeEventListener("close", returnHome);
        control.setAttribute("aria-expanded", "false");
      };
      const returnHome = () => {
        cleanup();
        if (navigated || !isStudentPhone()) return;
        show({ focus: false });
        // Run after the existing dialog handler restores its underlying trigger.
        requestAnimationFrame(() => {
          if (visible && isStudentPhone()) control.focus({ preventScroll: true });
        });
      };
      dialog.addEventListener("click", markNavigation, true);
      dialog.addEventListener("close", returnHome, { once: true });
      control.setAttribute("aria-expanded", "true");
      hide();
      more.click();
      if (!dialog.open) {
        cleanup();
        show();
        setNotice("更多学习工具正在准备，请稍后再试。");
      }
      return;
    }
    if (["agent", "course", "plan", "records", "buddy"].includes(action)) {
      hide();
      openWorkspace(action);
    }
  });

  ["learning-user:change", "learning-user:data-change", "learning-course:change", "education-data:ready", "portal-role:change"]
    .forEach((eventName) => document.addEventListener(eventName, sync));
  // Mode switches and role changes must release the inert classroom even when
  // they originate outside the home navigation or precede a custom event.
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["data-display-mode", "data-portal-role"] });

  const api = Object.freeze({ show, hide, isVisible: () => visible, sync });
  mountedHomes.set(document, api);
  globalThis.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  sync();
  return api;
}
