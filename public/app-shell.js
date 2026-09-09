// One live application in a persistent, same-origin viewport. Switching only
// resizes that viewport; it never reboots conversations, forms, uploads or audio.
import { mountKnowledgeConnectionStatus } from "./knowledge-connection-status.js";
import { mountAppHome } from "./app-home.js";
import { mountAppCourseContext } from "./app-course-context.js";

const MODE_KEY = "ai-teacher:display-mode:v1";
const modes = { desktop: ["desktop", "桌面版"], app: ["phone", "手机版"], pad: ["pad", "Pad 版"] };
const icons = {
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  desktop: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  pad: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M18 11v2"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.phone}</svg>`;

function initialMode() {
  const query = new URLSearchParams(location.search).get("display");
  if (Object.hasOwn(modes, query)) return query;
  try { const stored = localStorage.getItem(MODE_KEY); return Object.hasOwn(modes, stored) ? stored : "desktop"; }
  catch { return "desktop"; }
}

export function mountAppShell() {
  if (document.documentElement.dataset.appHost === "false") {
    mountContentControls();
    return true;
  }
  const mode = initialMode();
  document.body.replaceChildren();
  document.body.className = "app-preview-host";
  const host = document.createElement("main");
  host.className = "app-preview-stage";
  host.innerHTML = `
    <header class="app-preview-toolbar" aria-label="显示模式">
      <a class="app-preview-brand" href="?display=desktop" aria-label="AI教师桌面版">${icon("phone")}<strong>AI教师</strong><span>App 版</span></a>
      <div class="app-preview-controls"><button class="app-pad-rotate" type="button" aria-label="切换 Pad 横竖屏">切换竖屏</button><div class="app-preview-modes" role="group" aria-label="设备模式">${Object.entries(modes).map(([mode,[symbol,label]]) => `<button type="button" data-preview-mode="${mode}" aria-label="${label}" aria-pressed="false">${icon(symbol)}<span>${label}</span></button>`).join("")}</div></div>
    </header>
    <div class="app-device-wrap">
      <section class="app-device" aria-label="AI教师 App 手机预览">
        <div class="app-device-status" aria-hidden="true"><time>9:41</time><span class="app-device-indicators"><svg viewBox="0 0 18 14" width="18" height="14"><path d="M1 13V10h3v3zm5 0V7h3v6zm5 0V4h3v9zm5 0V1h2v12z" fill="currentColor"/></svg><svg width="18" height="14" viewBox="0 0 20 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 5a12 12 0 0 1 16 0M5 8a8 8 0 0 1 10 0m-7 3a3 3 0 0 1 4 0"/><circle cx="10" cy="14" r=".7" fill="currentColor"/></svg><svg width="25" height="14" viewBox="0 0 27 14"><rect x="1" y="1" width="22" height="12" rx="3" fill="none" stroke="currentColor" opacity=".6"/><rect x="3" y="3" width="18" height="8" rx="1" fill="currentColor"/><path d="M25 5v4" stroke="currentColor" stroke-width="2"/></svg></span></div>
        <iframe id="teacherAppFrame" title="AI教师应用" allow="microphone; camera; autoplay; fullscreen; display-capture"></iframe>
        <div class="app-device-home" aria-hidden="true"><span></span></div>
      </section>
    </div>
    <p class="app-preview-caption">学生端与教师端 · 全功能 App 体验</p>`;
  document.body.append(host);
  const frame = host.querySelector("iframe");
  let activeMode = mode;
  let orientation = "landscape";
  const wrap = host.querySelector(".app-device-wrap");
  const fitDevice = () => {
    if (activeMode === "desktop") return;
    // The phone screen is always 390 × 844 logical pixels. Fit the whole
    // device, never squeeze its width independently from its height.
    const width = activeMode === "app" ? 402 : orientation === "landscape" ? 1064 : 798;
    const height = activeMode === "app" ? 856 : orientation === "landscape" ? 798 : 1064;
    const scale = Math.max(.1, Math.min(1, (wrap.clientWidth - 24) / width, (wrap.clientHeight - 12) / height));
    if (activeMode === "pad") {
      host.style.setProperty("--pad-width", `${width}px`);
      host.style.setProperty("--pad-height", `${height}px`);
    }
    host.style.setProperty("--device-scale", scale);
  };
  new ResizeObserver(fitDevice).observe(wrap);
  const applyMode = (requested) => {
    activeMode = Object.hasOwn(modes, requested) ? requested : "desktop";
    document.body.dataset.displayMode = activeMode;
    host.querySelector(".app-device").setAttribute("aria-label", `AI教师${modes[activeMode][1]}预览`);
    host.querySelector(".app-preview-brand span").textContent = modes[activeMode][1];
    host.querySelector(".app-preview-caption").textContent = `学生端与教师端 · ${modes[activeMode][1]}全功能体验`;
    host.querySelectorAll("[data-preview-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.previewMode === activeMode)));
    fitDevice();
    const url = new URL(location.href);
    url.searchParams.delete("app-content");
    url.searchParams.set("display", activeMode);
    history.replaceState(null, "", url);
    try { localStorage.setItem(MODE_KEY, activeMode); } catch { /* Optional preference. */ }
    frame.contentWindow?.AITeacherAppContent?.setMode(activeMode);
  };
  window.AITeacherAppShell = Object.freeze({
    setMode: applyMode,
    getMode: () => activeMode,
    setHomeVisible: visible => { document.body.dataset.appHomeVisible = String(visible); },
    getOrientation: () => orientation
  });
  host.querySelectorAll("[data-preview-mode]").forEach(button => button.addEventListener("click", () => applyMode(button.dataset.previewMode)));
  host.querySelector(".app-pad-rotate").addEventListener("click", (event) => {
    orientation = orientation === "landscape" ? "portrait" : "landscape";
    document.body.dataset.padOrientation = orientation;
    event.currentTarget.textContent = orientation === "landscape" ? "切换竖屏" : "切换横屏";
    event.currentTarget.setAttribute("aria-label", `当前 Pad ${orientation === "landscape" ? "横屏，切换竖屏" : "竖屏，切换横屏"}`);
    fitDevice();
  });
  host.querySelector(".app-preview-brand").addEventListener("click", (event) => {
    event.preventDefault();
    applyMode("desktop");
  });
  applyMode(mode);
  const contentURL = new URL(location.href);
  contentURL.searchParams.set("app-content", "1");
  frame.src = contentURL.href;
  frame.addEventListener("load", () => {
    frame.contentWindow?.AITeacherAppContent?.setMode(activeMode);
    // Keep in-page fragment links inside the single application viewport.
    frame.contentWindow?.addEventListener("hashchange", () => {
      const url = new URL(location.href);
      url.hash = frame.contentWindow.location.hash;
      history.replaceState(null, "", url);
    });
  });
  return false;
}

function mountContentControls() {
  const toggle = document.querySelector("#appViewToggle");
  mountKnowledgeConnectionStatus();
  const parentShell = window.parent.AITeacherAppShell;
  let activeMode = parentShell?.getMode() || initialMode();
  const question = document.querySelector("#textQuestion");
  const fitQuestion = () => {
    if (!question) return;
    if (activeMode !== "app") { question.style.removeProperty("height"); return; }
    if (!question.clientWidth) return;
    question.style.height = "auto";
    question.style.height = `${Math.min(112, Math.max(36, question.scrollHeight))}px`;
  };
  question?.addEventListener("input", fitQuestion);
  question?.addEventListener("focus", fitQuestion);
  if (question) {
    let inputWidth = 0;
    new ResizeObserver(() => {
      if (inputWidth === question.clientWidth) return;
      inputWidth = question.clientWidth;
      fitQuestion();
    }).observe(question);
    const sendButton = document.querySelector("#textQuestionBtn");
    if (sendButton) new MutationObserver(fitQuestion).observe(sendButton, {
      attributes: true, attributeFilter: ["data-request-active", "aria-busy"]
    });
  }
  const modeMenu = document.createElement("div");
  modeMenu.id = "appDeviceMenu";
  modeMenu.className = "app-device-menu";
  modeMenu.setAttribute("role", "menu");
  modeMenu.setAttribute("aria-label", "切换设备模式");
  modeMenu.hidden = true;
  modeMenu.innerHTML = `<p>设备显示</p>${Object.entries(modes).map(([mode,[symbol,label]]) => `<button type="button" role="menuitemradio" aria-checked="false" data-device-mode="${mode}">${icon(symbol)}<span>${label}</span><span class="app-mode-check" aria-hidden="true">✓</span></button>`).join("")}<small>切换时保留当前页面和草稿</small>`;
  document.body.append(modeMenu);
  toggle.removeAttribute("aria-pressed");
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-controls", modeMenu.id);
  toggle.setAttribute("aria-expanded", "false");
  const closeModeMenu = (focus = false) => { modeMenu.hidden = true; toggle.setAttribute("aria-expanded", "false"); if (focus) toggle.focus(); };
  const openModeMenu = () => {
    const rect = toggle.getBoundingClientRect();
    modeMenu.style.top = `${rect.bottom + 8}px`;
    modeMenu.style.right = `${Math.max(12, innerWidth - rect.right)}px`;
    modeMenu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    modeMenu.querySelector(`[data-device-mode="${activeMode}"]`).focus();
  };
  modeMenu.addEventListener("click", event => {
    const button = event.target.closest("[data-device-mode]");
    if (!button) return;
    closeModeMenu(true);
    parentShell?.setMode(button.dataset.deviceMode);
  });
  document.addEventListener("pointerdown", event => { if (!modeMenu.contains(event.target) && !toggle.contains(event.target)) closeModeMenu(); });
  document.addEventListener("keydown", event => {
    if (modeMenu.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); closeModeMenu(true); }
    if (event.key === "Tab") closeModeMenu();
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const buttons = [...modeMenu.querySelectorAll("button")];
      const i = buttons.indexOf(document.activeElement);
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (i + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
  });
  window.addEventListener("resize", () => closeModeMenu());
  const app = document.querySelector("#appMainContent");
  const teacherNav = document.createElement("nav");
  teacherNav.className = "app-teacher-nav";
  teacherNav.setAttribute("aria-label", "教师端主要功能");
  teacherNav.dataset.mobilePortalRole = "teacher";
  teacherNav.hidden = true;
  const teacherEntries = [
    ["teacher-dashboard", "总览"], ["teacher-students", "学情"],
    ["teacher-courses", "课程"], ["bank", "题库"]
  ];
  teacherNav.innerHTML = teacherEntries.map(([view, label]) => {
    const source = document.querySelector(`[data-portal-role="teacher"][data-workspace-view="${view}"]`);
    return `<button type="button" role="tab" aria-selected="false" aria-controls="${source.getAttribute("aria-controls")}" aria-label="${source.getAttribute("aria-label")}" data-mobile-workspace-view="${view}" data-mobile-portal-role-scope="teacher">${source.querySelector("i,svg").outerHTML}<span>${label}</span></button>`;
  }).join("") + `<button type="button" class="app-teacher-more" aria-label="更多教学工具" aria-haspopup="dialog" aria-controls="teacherMobileNavDialog" aria-expanded="false">${icon("more")}<span>更多</span></button>`;
  teacherNav.setAttribute("role", "tablist");
  app.append(teacherNav);
  const more = teacherNav.querySelector(".app-teacher-more");
  more.addEventListener("click", () => document.querySelector(".launcher-button")?.click());
  const teacherDialog = document.querySelector("#teacherMobileNavDialog");
  new MutationObserver(() => more.setAttribute("aria-expanded", String(teacherDialog.open))).observe(teacherDialog, { attributes: true, attributeFilter: ["open"] });
  teacherNav.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...teacherNav.querySelectorAll("button")];
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  });

  const back = document.createElement("button");
  back.className = "app-back-button";
  back.type = "button";
  back.setAttribute("aria-label", "返回上一页");
  back.innerHTML = icon("back");
  document.querySelector(".global-brand").prepend(back);
  const trail = [];
  let goingBack = false;
  let home = null;
  let homeWasVisible = activeMode === "app";
  let firstWorkspaceEvent = true;
  let modeApplied = false;
  const syncNavigation = () => {
    const role = document.body.dataset.portalRole || "student";
    const view = document.querySelector("[data-workspace-panel]:not([hidden])")?.dataset.workspacePanel || "agent";
    teacherNav.hidden = role !== "teacher";
    const primary = teacherEntries.some(([key]) => key === view);
    more.classList.toggle("is-active", !primary);
    more.toggleAttribute("data-current", !primary);
    const canReturnHome = role === "student" && activeMode === "app" && !home?.isVisible();
    back.disabled = !canReturnHome && trail.length < 2;
    back.hidden = home?.isVisible() || (!canReturnHome && trail.length < 2);
    back.setAttribute("aria-label", canReturnHome && trail.length < 2 ? "返回首页" : "返回上一页");
    document.body.dataset.appPage = view;
  };
  document.addEventListener("learning-workspace:change", (event) => {
    const openInitialHome = firstWorkspaceEvent && activeMode === "app";
    firstWorkspaceEvent = false;
    home?.hide();
    const next = { view: event.detail.view, role: event.detail.role || document.body.dataset.portalRole || "student" };
    if (trail.length && trail.at(-1).role !== next.role) trail.length = 0;
    if (!goingBack && trail.at(-1)?.view !== next.view) trail.push(next);
    goingBack = false;
    syncNavigation();
    if (openInitialHome && next.role === "student") home?.show({ focus: false });
  });
  document.addEventListener("portal-role:change", () => queueMicrotask(() => {
    if (activeMode === "app" && document.body.dataset.portalRole === "student") home?.show({ focus: false });
    syncNavigation();
  }));
  back.addEventListener("click", () => {
    if (trail.length < 2) { if (activeMode === "app") home?.show(); return; }
    trail.pop();
    const previous = trail.at(-1);
    const button = document.querySelector(`[data-portal-role="${previous.role}"][data-workspace-view="${previous.view}"]`);
    if (button) { goingBack = true; button.click(); }
  });
  const openAppWorkspace = (view) => {
    home?.hide();
    if (window.AITeacherPortalRuntime?.openWorkspace) window.AITeacherPortalRuntime.openWorkspace(view);
    else document.querySelector(`[data-portal-role="${document.body.dataset.portalRole || "student"}"][data-workspace-view="${view}"]`)?.click();
    syncNavigation();
  };
  home = mountAppHome({ openWorkspace: openAppWorkspace, showHomeChanged: visible => {
    if (visible) trail.length = 0;
    parentShell?.setHomeVisible?.(visible);
    syncNavigation();
  } });
  // The global launcher lives outside the inert home background.
  document.querySelector(".launcher-button")?.addEventListener("click", () => home.hide(), true);
  mountAppCourseContext({ openWorkspace: openAppWorkspace });
  const setMode = (mode) => {
    const enteringApp = mode === "app" && (activeMode !== "app" || !modeApplied);
    modeApplied = true;
    if (activeMode === "app" && mode !== "app") homeWasVisible = home.isVisible();
    activeMode = Object.hasOwn(modes, mode) ? mode : "desktop";
    document.body.dataset.displayMode = activeMode;
    if (activeMode !== "app") home.hide();
    else if (enteringApp && homeWasVisible) home.show({ focus: false });
    syncNavigation();
    const shelfHint = document.querySelector("#knowledgeShelfInteractionHint");
    if (shelfHint) shelfHint.textContent = activeMode === "app" ? "左右滑动浏览科目 · 点击打开知识图谱" : activeMode === "pad" ? "点击科目封面 · 打开知识图谱" : "悬停查看封面 · 点击打开";
    toggle.innerHTML = `${icon(modes[activeMode][0])}<span>${modes[activeMode][1]}</span>`;
    toggle.setAttribute("aria-label", `设备模式：${modes[activeMode][1]}，点击切换`);
    toggle.title = "切换桌面、手机或 Pad，保留当前页面";
    modeMenu.querySelectorAll("[data-device-mode]").forEach(button => button.setAttribute("aria-checked", String(button.dataset.deviceMode === activeMode)));
    closeModeMenu();
    // Resize observers and legacy graph renderers both receive the new viewport.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fitQuestion();
      window.dispatchEvent(new Event("resize"));
    }));
  };
  window.AITeacherAppContent = Object.freeze({ setMode, showHome: () => home.show() });
  toggle.addEventListener("click", () => modeMenu.hidden ? openModeMenu() : closeModeMenu(true));
  setMode(activeMode);
}
