import { PHYSICS_PLAYER_CSS } from "./physics-lesson-player.js";

/** Package local engine distributions and the exact browser player into one offline file. */
export async function buildPhysicsLessonHtml(lesson, events = []) {
  const rootUrl = new URL("./", import.meta.url);
  const assets = ["vendor/matter.min.js", "vendor/planck.min.js", "physics-lesson-runtime.js", "physics-lesson-player.js"];
  const [matterSource, planckSource, runtimeSource, playerSource] = await Promise.all(assets.map(async (path) => {
    const response = await fetch(new URL(path, rootUrl));
    if (!response.ok) throw new Error(`离线导出缺少本地文件：${path}（${response.status}）`);
    const source = await response.text();
    if (/^\s*<!doctype html/iu.test(source)) throw new Error(`离线导出读取到无效文件：${path}`);
    return source.replace(/^\/\/[#@] sourceMappingURL=.*$/gmu, "");
  }));
  const runtime = stripPhysicsExports(runtimeSource, [
    "export const PHYSICS_PRESET_PARAMETERS", "export function normalizePhysicsParameters", "export class PhysicsLessonRuntime",
  ]);
  const playerImport = 'import { PhysicsLessonRuntime, PHYSICS_PRESET_PARAMETERS, normalizePhysicsParameters } from "./physics-lesson-runtime.js";';
  if (!playerSource.includes(playerImport)) throw new Error("物理播放器导入接口发生变化，请更新离线打包器后重试");
  const player = stripPhysicsExports(playerSource.replace(playerImport, ""), ["export const PHYSICS_PLAYER_CSS", "export function mountPhysicsPlayer"]);
  const payload = JSON.stringify({ lesson, events: Array.isArray(events) ? events : [] }).replace(/</gu, "\\u003c");
  const bootstrap = `const physicsRuntimeModule = (() => {\n${runtime}\nreturn { PhysicsLessonRuntime, PHYSICS_PRESET_PARAMETERS, normalizePhysicsParameters };\n})();\nconst mountPhysicsPlayer = (() => {\nconst { PhysicsLessonRuntime, PHYSICS_PRESET_PARAMETERS, normalizePhysicsParameters } = physicsRuntimeModule;\n${player}\nreturn mountPhysicsPlayer;\n})();\n(${offlinePhysicsBootstrap.toString()})(${payload});`;
  const title = escapePhysicsHtml(lesson?.title || "参数化物理实验");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${title}</title>
<style>html{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f2f6fb;color:#20364e;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC",sans-serif}main{width:min(1000px,calc(100% - 32px));margin:28px auto}.offline-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 14px}.offline-head b{font-size:15px}.offline-head p{margin:4px 0 0;color:#77879b;font-size:12px}.offline-replay{min-height:36px;padding:8px 14px;border:1px solid #c9d8eb;border-radius:8px;background:#fff;color:#2f6feb;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.offline-replay:disabled{opacity:.45;cursor:not-allowed}.offline-replay:focus-visible{outline:3px solid #a5c4fa;outline-offset:3px}.offline-status{min-height:20px;margin:12px 0 0;font-size:12px;line-height:1.6;color:#71849b}@media(max-width:600px){main{width:calc(100% - 20px);margin:16px auto}.offline-head{gap:8px}.offline-head b{font-size:13px}.offline-head p{font-size:10px}}</style>
<style id="physics-lesson-player-styles">${PHYSICS_PLAYER_CSS}</style></head>
<body><main><header class="offline-head"><div><b>互动教材 · 物理实验</b><p>引擎与教材已随文件保存，可断网使用</p></div><button class="offline-replay" id="physicsOfflineReplay" type="button" disabled>回放操作记录</button></header><div id="physicsOfflinePlayer"></div><p class="offline-status" id="physicsOfflineStatus" role="status">正在初始化本地实验…</p></main>
<script>${escapePhysicsScript(matterSource)}</script>
<script>${escapePhysicsScript(planckSource)}</script>
<script>${escapePhysicsScript(bootstrap)}</script></body></html>`;
}

function stripPhysicsExports(source, declarations) {
  let result = source;
  for (const declaration of declarations) {
    if (!result.includes(declaration)) throw new Error(`离线打包接口缺失：${declaration}`);
    result = result.replace(declaration, declaration.slice("export ".length));
  }
  if (/^\s*(?:import|export)\s/mu.test(result)) throw new Error("离线播放器出现未支持的模块依赖，请更新打包器后重试");
  return result;
}

function escapePhysicsScript(value) {
  return String(value).replace(/<\/script/giu, "<\\/script");
}

function escapePhysicsHtml(value) {
  return String(value).replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function offlinePhysicsBootstrap(payload) {
  const stage = document.querySelector("#physicsOfflinePlayer");
  const replayButton = document.querySelector("#physicsOfflineReplay");
  const status = document.querySelector("#physicsOfflineStatus");
  const eventTypes = new Set(["parameter", "physics_play", "physics_reset", "physics_engine"]);
  const events = (payload.events || []).filter((event) => event && eventTypes.has(event.type) && Number.isFinite(event.at_ms) && event.at_ms >= 0).map((event, index) => ({ ...event, index })).sort((a, b) => a.at_ms - b.at_ms || a.index - b.index);
  let player, replaying = false, replayVersion = 0, timer = null, completeWait = null;
  function cancelReplay(message = "已停止回放，可以继续操作实验。") {
    replayVersion += 1; replaying = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (completeWait) { completeWait(false); completeWait = null; }
    player?.setControlsDisabled(false);
    replayButton.textContent = "回放操作记录";
    replayButton.disabled = events.length === 0 || !player?.getRecordableCanvas();
    status.textContent = message;
  }
  function waitUntil(delay, version) {
    if (delay <= 0) return Promise.resolve(version === replayVersion);
    return new Promise((resolve) => {
      completeWait = resolve;
      timer = setTimeout(() => { timer = null; completeWait = null; resolve(version === replayVersion); }, delay);
    });
  }
  player = mountPhysicsPlayer(stage, payload.lesson, {
    onReady() {
      replayButton.disabled = events.length === 0;
      if (!replaying) status.textContent = events.length ? `离线实验已就绪 · 已保存 ${events.length} 个操作。` : "离线实验已就绪。调节参数后，点击“开始实验”。";
    },
    onError(error) { cancelReplay(`物理实验加载失败：${error?.message || "请重新打开文件"}`); },
    onEvent(event) {
      // Controls are disabled while replaying; runtime completion may still emit a pause.
      if (event.type === "physics_engine") status.textContent = "已切换本地物理引擎。";
    },
  });
  replayButton.addEventListener("click", async () => {
    if (replaying) { cancelReplay(); await player.applyEvent({ type: "physics_play", value: false }); return; }
    cancelReplay("");
    const version = ++replayVersion;
    replaying = true; player.setControlsDisabled(true);
    replayButton.disabled = false; replayButton.textContent = "停止回放";
    status.textContent = "正在按记录重放实验…";
    const ready = await player.reset();
    if (version !== replayVersion) return;
    if (!ready) { cancelReplay("实验未就绪，无法回放。"); return; }
    const started = performance.now();
    try {
      for (const event of events) {
        if (!await waitUntil(Math.max(0, event.at_ms - (performance.now() - started)), version)) return;
        if (version !== replayVersion) return;
        const applied = await player.applyEvent(event);
        if (version !== replayVersion) return;
        if (!applied) throw new Error("记录中有无法执行的实验操作");
      }
      if (version === replayVersion) cancelReplay("回放完成，可以继续调节参数实验。");
    } catch (error) {
      if (version === replayVersion) cancelReplay(`回放已停止：${error?.message || "操作执行失败"}`);
    }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && replaying) cancelReplay("页面切到后台，回放已暂停；点击回放可从头开始。"); });
  window.addEventListener("pagehide", () => { cancelReplay(""); player.destroy(); });
}
