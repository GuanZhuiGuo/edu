import { PhysicsLessonRuntime, PHYSICS_PRESET_PARAMETERS, normalizePhysicsParameters } from "./physics-lesson-runtime.js";

export const PHYSICS_PLAYER_CSS = `
.physics-player{overflow:hidden;border:1px solid #dce5ef;border-radius:14px;background:#fff;color:#20364e;font-family:inherit}
.physics-player *{box-sizing:border-box}.physics-player [hidden]{display:none!important}
.physics-player-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid #e5ecf4}
.physics-player-head h3{margin:3px 0 6px;font-size:18px;line-height:1.4}.physics-player-head p{margin:0;color:#6a7b8f;font-size:12px;line-height:1.65}
.physics-engine-badge{flex-shrink:0;padding:6px 9px;border-radius:7px;background:#edf4ff;color:#3368b2;font-size:12px;font-weight:700}
.physics-canvas-wrap{position:relative;margin:14px 16px 0;overflow:hidden;border:1px solid #e4ebf4;border-radius:10px;background:#f6faff;aspect-ratio:45/26}
.physics-canvas{display:block;width:100%;height:100%;aspect-ratio:45/26}.physics-load-state{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;background:#f6faff;text-align:center;color:#62788e;font-size:13px}
.physics-player button{appearance:none;min-height:36px;padding:8px 15px;border:1px solid #d7e1ed;border-radius:8px;background:#fff;color:#36516f;font:inherit;font-size:12px;cursor:pointer}
.physics-player button:hover:not(:disabled){background:#f2f7ff;border-color:#9ab9e5}.physics-player button.physics-primary{border-color:#2f6feb;background:#2f6feb;color:#fff;min-width:100px;font-weight:700}.physics-player button.physics-primary:hover:not(:disabled){background:#255ed1}
.physics-player button:disabled,.physics-player input:disabled,.physics-player select:disabled{opacity:.45;cursor:not-allowed}.physics-player :is(button,input,select,summary):focus-visible{outline:3px solid #a5c4fa;outline-offset:3px}
.physics-toolbar{display:flex;align-items:center;gap:8px;padding:13px 16px 10px}.physics-time{margin-left:auto;color:#73849a;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.physics-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 24px;padding:10px 20px 16px}
.physics-range{display:grid;grid-template-columns:1fr auto;gap:10px 12px;min-width:0;color:#496078;font-size:12px}.physics-range>span{font-weight:650}.physics-range output{color:#1e5fb2;font-weight:750;font-variant-numeric:tabular-nums}.physics-range input{grid-column:1/-1;width:100%;min-width:0;accent-color:#2f6feb;cursor:pointer}
.physics-more{margin:0 20px 14px;border-top:1px solid #e6edf4;padding-top:11px}.physics-more summary{width:fit-content;cursor:pointer;color:#6d8096;font-size:12px;line-height:1.7}.physics-more[open] summary{margin-bottom:14px}.physics-more .physics-controls{padding:0 0 16px}.physics-engine-choice{display:flex;align-items:center;flex-wrap:wrap;gap:10px;color:#536a83;font-size:11px}.physics-engine-choice select{min-height:34px;max-width:100%;padding:5px 10px;border:1px solid #d6e0ec;border-radius:7px;background:#fff;color:#314e6d;font:inherit}.physics-engine-help{margin:8px 0 0;font-size:12px;line-height:1.6;color:#596b80}
.physics-assumption{margin:0;padding:10px 20px;border-top:1px solid #e6edf4;background:#fafbfd;color:#596b80;font-size:12px;line-height:1.7}
.physics-guide{padding:13px 20px;background:#f3f8ff;border-top:1px solid #e2ebf6;font-size:12px;line-height:1.75}.physics-guide p{margin:0;color:#59728d}.physics-guide p+p{margin-top:5px}.physics-guide b{color:#31587f;font-weight:700;margin-right:8px}
@media(max-width:600px){.physics-player-head{padding:14px;gap:10px}.physics-player-head h3{font-size:16px}.physics-player-head p{font-size:11px}.physics-engine-badge{font-size:10px}.physics-canvas-wrap{margin:10px 10px 0}.physics-toolbar{padding:12px 10px 8px}.physics-controls{padding:10px 14px 14px;gap:16px}.physics-more{margin-right:14px;margin-left:14px}.physics-time{font-size:10px}.physics-assumption,.physics-guide{padding-right:14px;padding-left:14px}}
@media(prefers-reduced-motion:reduce){.physics-player *{scroll-behavior:auto}}
`;

const PHYSICS_CONTROL_LABELS = Object.freeze({
  angle: ["倾角", 1, "°"], friction: ["摩擦系数", 0.01, ""], gravity: ["重力加速度", 0.1, "m/s²"],
  mass: ["物体质量", 0.1, "kg"], mass_b: ["右侧物体质量", 0.1, "kg"],
  length: ["摆长", 0.1, "m"], initial_speed: ["左侧物体初速度", 0.1, "m/s"], restitution: ["恢复系数", 0.01, ""],
});
const PHYSICS_PRIMARY_CONTROLS = Object.freeze({ inclined_plane: ["angle", "friction"], pendulum: ["length", "angle"], collision: ["initial_speed", "restitution"] });
const PHYSICS_ENGINE_LABELS = Object.freeze({ matter: "Matter.js", planck: "Planck.js" });
const PHYSICS_ASSUMPTIONS = Object.freeze({
  inclined_plane: "二维刚体、固定斜面，忽略空气阻力；摩擦采用干摩擦近似。参数变化后从初始位置重新实验。",
  pendulum: "理想约束单摆，忽略空气阻力；两种引擎的约束求解存在数值差异。参数变化后重新释放。",
  collision: "水平无摩擦的一维正碰，忽略外力；恢复系数描述碰撞弹性。参数变化后从初始位置重新实验。",
});

/** Mount a local physics experiment. reset/applyEvent are awaitable for engine changes. */
export function mountPhysicsPlayer(container, lesson, { onEvent, onReady, onError } = {}) {
  if (!container || typeof container.replaceChildren !== "function") throw new Error("物理实验缺少有效的挂载容器");
  const doc = container.ownerDocument;
  const view = doc.defaultView || globalThis;
  const visualization = lesson?.visualization || lesson?.physics || lesson || {};
  const preset = PHYSICS_PRESET_PARAMETERS[visualization.preset] ? visualization.preset : "inclined_plane";
  const initialEngine = visualization.engine === "planck" ? "planck" : "matter";
  const initialParameters = normalizePhysicsParameters(preset, visualization.parameters || {});
  let parameters = { ...initialParameters }, engine = initialEngine;
  let runtime = null, destroyed = false, loaded = false, running = false, controlsDisabled = false;
  let animationFrame = 0, lastFrame = 0, accumulator = 0, lastStatus = 0, loadVersion = 0;
  let readyPromise = Promise.resolve(null), operations = Promise.resolve();
  const cleanup = [];
  const sliderElements = new Map();
  const step = 1 / 120;

  if (!doc.getElementById("physics-lesson-player-styles")) {
    const style = doc.createElement("style");
    style.id = "physics-lesson-player-styles";
    style.textContent = PHYSICS_PLAYER_CSS;
    doc.head.append(style);
  }
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const listen = (target, type, callback) => {
    target.addEventListener(type, callback);
    cleanup.push(() => target.removeEventListener(type, callback));
  };
  const shell = element("article", "physics-player");
  shell.dataset.physicsPreset = preset;
  const header = element("header", "physics-player-head");
  const heading = element("div");
  heading.append(element("h3", "", lesson?.title || "物理实验"));
  heading.append(element("p", "", lesson?.subtitle || "调节参数，再开始实验，观察运动怎样变化。"));
  const engineBadge = element("span", "physics-engine-badge", PHYSICS_ENGINE_LABELS[engine]);
  header.append(heading, engineBadge);
  const canvasWrap = element("div", "physics-canvas-wrap");
  const canvas = element("canvas", "physics-canvas");
  canvas.width = 900; canvas.height = 520;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${lesson?.title || "物理实验"}动画，可使用下方参数控件操作`);
  const loadState = element("div", "physics-load-state");
  loadState.setAttribute("role", "status");
  const loadMessage = element("span", "", "正在加载物理引擎…");
  const retryButton = element("button", "", "重新加载");
  retryButton.type = "button"; retryButton.hidden = true;
  loadState.append(loadMessage, retryButton);
  canvasWrap.append(canvas, loadState);
  const toolbar = element("div", "physics-toolbar");
  const playButton = element("button", "physics-primary", "开始实验");
  const resetButton = element("button", "", "重置实验");
  playButton.type = resetButton.type = "button";
  playButton.dataset.physicsAction = "play"; resetButton.dataset.physicsAction = "reset";
  playButton.setAttribute("aria-pressed", "false");
  const timeStatus = element("span", "physics-time", "已暂停 · 0.00 s");
  toolbar.append(playButton, resetButton, timeStatus);
  const mainControls = element("div", "physics-controls");
  const more = element("details", "physics-more");
  more.append(element("summary", "", "更多实验参数"));
  const extraControls = element("div", "physics-controls");
  const primaryKeys = PHYSICS_PRIMARY_CONTROLS[preset];
  const parameterKeys = [...primaryKeys, ...Object.keys(PHYSICS_PRESET_PARAMETERS[preset]).filter((key) => !primaryKeys.includes(key))];
  for (const key of parameterKeys) {
    let [labelText, increment, unit] = PHYSICS_CONTROL_LABELS[key];
    if (key === "angle" && preset === "pendulum") labelText = "释放角度";
    if (key === "mass" && preset === "collision") labelText = "左侧物体质量";
    const [minimum, maximum] = PHYSICS_PRESET_PARAMETERS[preset][key];
    const label = element("label", "physics-range");
    const input = element("input");
    input.type = "range"; input.min = String(minimum); input.max = String(maximum); input.step = String(increment);
    input.value = String(parameters[key]); input.dataset.physicsParameter = key;
    input.setAttribute("aria-label", labelText);
    const output = element("output", "", formatPhysicsValue(parameters[key], unit));
    label.append(element("span", "", labelText), output, input);
    sliderElements.set(key, { input, output, unit });
    (primaryKeys.includes(key) ? mainControls : extraControls).append(label);
    listen(input, "input", () => {
      const value = Number(input.value);
      void enqueue(() => changeParameter(key, value, true));
    });
  }
  const engineChoice = element("label", "physics-engine-choice");
  const engineSelect = element("select");
  engineSelect.dataset.physicsEngine = "true";
  engineSelect.setAttribute("aria-label", "物理引擎");
  for (const [value, label] of [["matter", "Matter.js · 轻量 2D"], ["planck", "Planck.js · Box2D 风格"]]) {
    const option = element("option", "", label); option.value = value; engineSelect.append(option);
  }
  engineSelect.value = engine;
  engineChoice.append(element("span", "", "物理引擎"), engineSelect);
  more.append(extraControls, engineChoice, element("p", "physics-engine-help", "Matter.js 适合中小学力学演示；Planck.js 提供 Box2D 风格的刚体与关节求解。"));
  const assumption = element("p", "physics-assumption", PHYSICS_ASSUMPTIONS[preset]);
  shell.append(header, canvasWrap, toolbar, mainControls, more, assumption);
  if (lesson?.guidance?.prediction_prompt || lesson?.guidance?.observation_prompt) {
    const guide = element("section", "physics-guide");
    for (const [label, value] of [["先预测", lesson.guidance.prediction_prompt], ["再观察", lesson.guidance.observation_prompt]]) {
      if (!value) continue;
      const paragraph = element("p"); paragraph.append(element("b", "", label), doc.createTextNode(String(value))); guide.append(paragraph);
    }
    shell.append(guide);
  }
  container.replaceChildren(shell);

  const emit = (type, target, value) => { if (!destroyed && typeof onEvent === "function") onEvent({ type, target, value }); };
  const updateControls = () => {
    const disabled = !loaded || controlsDisabled;
    playButton.disabled = resetButton.disabled = engineSelect.disabled = disabled;
    for (const { input } of sliderElements.values()) input.disabled = disabled;
    shell.setAttribute("aria-busy", String(!loaded));
    const snapshot = runtime?.getSnapshot();
    playButton.textContent = running ? "暂停实验" : snapshot?.completed ? "再次实验" : (snapshot?.elapsed > 0 ? "继续实验" : "开始实验");
    playButton.setAttribute("aria-pressed", String(running));
    engineBadge.textContent = PHYSICS_ENGINE_LABELS[engine];
    engineSelect.value = engine;
  };
  const updateSliders = () => {
    for (const [key, { input, output, unit }] of sliderElements) {
      input.value = String(parameters[key]); output.textContent = formatPhysicsValue(parameters[key], unit);
      input.setAttribute("aria-valuetext", output.textContent);
    }
  };
  const updateTime = () => {
    const elapsed = Number(runtime?.getSnapshot().elapsed || 0);
    timeStatus.textContent = `${running ? "实验中" : "已暂停"} · ${elapsed.toFixed(2)} s`;
  };
  function stopAnimation() {
    running = false;
    if (animationFrame) view.cancelAnimationFrame(animationFrame);
    animationFrame = 0; lastFrame = 0; accumulator = 0;
    updateControls(); updateTime();
  }
  function frame(timestamp) {
    animationFrame = 0;
    if (destroyed || !loaded || !running) return;
    if (doc.hidden) { stopAnimation(); emit("physics_play", "play", false); return; }
    if (lastFrame) accumulator += Math.min(0.1, Math.max(0, (timestamp - lastFrame) / 1000));
    lastFrame = timestamp;
    let iterations = 0;
    while (accumulator + 1e-10 >= step && iterations < 12) {
      runtime.step(step); accumulator = Math.max(0, accumulator - step); iterations += 1;
    }
    runtime.draw();
    if (runtime.getSnapshot().completed) { stopAnimation(); emit("physics_play", "play", false); return; }
    if (timestamp - lastStatus > 100) { updateTime(); lastStatus = timestamp; }
    animationFrame = view.requestAnimationFrame(frame);
  }
  function setPlaying(value, notify = false) {
    if (!loaded || destroyed) return false;
    const next = value === true && !doc.hidden;
    if (next === running) return true;
    if (!next) stopAnimation();
    else {
      if (runtime.getSnapshot().completed) { runtime.reset(parameters); runtime.draw(); }
      running = true; lastFrame = view.performance.now(); accumulator = 0;
      updateControls(); updateTime(); animationFrame = view.requestAnimationFrame(frame);
    }
    if (notify) emit("physics_play", "play", running);
    return true;
  }
  function enqueue(action) {
    const task = operations.then(async () => {
      await readyPromise;
      if (destroyed) return false;
      return action();
    });
    operations = task.catch((error) => { if (!destroyed && typeof onError === "function") onError(error); return false; });
    return operations;
  }
  async function loadRuntime() {
    const version = ++loadVersion;
    stopAnimation(); loaded = false;
    const previous = runtime; runtime = null; previous?.destroy();
    loadState.hidden = false; retryButton.hidden = true;
    loadMessage.textContent = `正在加载 ${PHYSICS_ENGINE_LABELS[engine]} 物理引擎…`;
    updateControls();
    const candidate = new PhysicsLessonRuntime({ canvas, engine, preset, parameters: { ...parameters } });
    try {
      await candidate.init();
      if (destroyed || version !== loadVersion) { candidate.destroy(); return null; }
      runtime = candidate; loaded = true; runtime.draw(); loadState.hidden = true;
      updateSliders(); updateControls(); updateTime();
      if (typeof onReady === "function") onReady(handle);
      return handle;
    } catch (error) {
      candidate.destroy();
      if (destroyed || version !== loadVersion) return null;
      loaded = false; retryButton.hidden = false;
      loadMessage.textContent = `物理引擎未能加载：${error?.message || "请重试"}`;
      updateControls();
      if (typeof onError === "function") onError(error);
      return null;
    }
  }
  function changeParameter(key, value, notify = false) {
    if (!loaded || !Object.hasOwn(PHYSICS_PRESET_PARAMETERS[preset], key) || typeof value !== "number" || !Number.isFinite(value)) return false;
    stopAnimation(); parameters = normalizePhysicsParameters(preset, { ...parameters, [key]: value });
    runtime.reset(parameters); runtime.draw(); updateSliders(); updateControls(); updateTime();
    if (notify) emit("parameter", key, parameters[key]);
    return true;
  }
  async function changeEngine(value, notify = false) {
    if (value !== "matter" && value !== "planck") return false;
    if (value === engine && loaded) return true;
    if (running) setPlaying(false, notify);
    engine = value; readyPromise = loadRuntime();
    const success = Boolean(await readyPromise);
    if (success && notify) emit("physics_engine", "engine", engine);
    return success;
  }
  async function resetInitial(notify = false) {
    if (running) setPlaying(false, notify);
    else stopAnimation();
    parameters = { ...initialParameters };
    if (!loaded || engine !== initialEngine) {
      engine = initialEngine; readyPromise = loadRuntime(); await readyPromise;
    } else {
      runtime.reset(parameters); runtime.draw(); updateSliders(); updateControls(); updateTime();
    }
    if (!loaded) return false;
    if (notify) emit("physics_reset", "experiment", true);
    return true;
  }
  const handle = {
    canvas,
    get ready() { return readyPromise; },
    getRecordableCanvas() { return !destroyed && loaded ? canvas : null; },
    getSnapshot() { return { ...(runtime?.getSnapshot() || {}), engine, preset, parameters: { ...parameters }, running, ready: loaded && !destroyed }; },
    applyEvent(event) {
      return enqueue(() => {
        if (event?.type === "parameter") return changeParameter(event.target, event.value);
        if (event?.type === "physics_play") return setPlaying(event.value);
        if (event?.type === "physics_reset") return resetInitial();
        if (event?.type === "physics_engine") return changeEngine(event.value);
        return false;
      });
    },
    reset() { return enqueue(() => resetInitial()); },
    setControlsDisabled(value) { controlsDisabled = Boolean(value); updateControls(); },
    destroy() {
      if (destroyed) return;
      destroyed = true; loadVersion += 1; stopAnimation();
      for (const dispose of cleanup.splice(0)) dispose();
      runtime?.destroy(); runtime = null; loaded = false;
      shell.remove();
    },
  };
  listen(playButton, "click", () => { void enqueue(() => setPlaying(!running, true)); });
  listen(resetButton, "click", () => { void enqueue(() => resetInitial(true)); });
  listen(engineSelect, "change", () => { const value = engineSelect.value; void enqueue(() => changeEngine(value, true)); });
  listen(retryButton, "click", () => { readyPromise = loadRuntime(); });
  listen(doc, "visibilitychange", () => { if (doc.hidden && running) { stopAnimation(); emit("physics_play", "play", false); } });
  updateSliders(); updateControls();
  readyPromise = loadRuntime();
  return handle;
}

function formatPhysicsValue(value, unit) {
  const result = Number(value).toFixed(2).replace(/\.00$/u, "").replace(/(\.\d)0$/u, "$1");
  return `${result}${unit ? ` ${unit}` : ""}`;
}
