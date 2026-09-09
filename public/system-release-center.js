const LAYER_META = Object.freeze({
  source: { label: "内容来源", color: "#94a7c8", x: 70 },
  ai: { label: "模型能力", color: "#b990ff", x: 250 },
  knowledge: { label: "知识生产", color: "#5ca9ff", x: 440 },
  control: { label: "质量控制", color: "#ffb85c", x: 650 },
  storage: { label: "数据底座", color: "#58d0ba", x: 850 },
  runtime: { label: "运行时", color: "#7d8dff", x: 1060 },
  experience: { label: "产品体验", color: "#f07d9a", x: 1260 },
});
const LAYER_ORDER = Object.freeze(Object.keys(LAYER_META));

export function buildArchitectureGraphOption(architecture, { compact = false } = {}) {
  const nodes = Array.isArray(architecture?.nodes) ? architecture.nodes : [];
  const edges = Array.isArray(architecture?.edges) ? architecture.edges : [];
  const grouped = new Map();
  for (const node of nodes) {
    const list = grouped.get(node.layer) || [];
    list.push(node);
    grouped.set(node.layer, list);
  }
  const positioned = [];
  const visibleLayers = LAYER_ORDER.filter((layer) => grouped.has(layer));
  for (const [layer, list] of grouped) {
    const meta = LAYER_META[layer] || { label: layer, color: "#94a7c8", x: 560 };
    const compactLayerIndex = Math.max(0, visibleLayers.indexOf(layer));
    const compactXs = compactNodePositions(list.length);
    const startY = compact
      ? 104 + compactLayerIndex * 86
      : Math.max(76, 300 - ((list.length - 1) * 94) / 2);
    list.forEach((node, index) => {
      positioned.push({
        id: node.id,
        name: node.label,
        x: compact ? compactXs[index] : meta.x,
        y: compact ? startY : startY + index * 94,
        symbol: "roundRect",
        symbolSize: compact ? [list.length > 2 ? 96 : 124, 42] : [126, 48],
        value: node.detail,
        itemStyle: { color: meta.color, borderColor: "rgba(255,255,255,.75)", borderWidth: 1, shadowBlur: 14, shadowColor: `${meta.color}66` },
        label: { show: true, color: "#0c1830", fontSize: compact ? 10 : 12, fontWeight: 700 },
        emphasis: { scale: 1.08, itemStyle: { borderColor: "#fff", borderWidth: 2 } },
        __node: node,
      });
    });
  }
  return {
    backgroundColor: "transparent",
    animationDuration: 500,
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: "rgba(10,19,36,.97)",
      borderColor: "rgba(130,166,230,.3)",
      textStyle: { color: "#f4f7ff" },
      formatter(params) {
        if (params.dataType === "edge") return escapeHTML(params.data?.value || "数据流");
        const node = params.data?.__node;
        return node ? `<b>${escapeHTML(node.label)}</b><br>${escapeHTML(node.detail || "")}` : "";
      },
    },
    series: [{
      type: "graph",
      layout: "none",
      roam: true,
      data: positioned,
      links: edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        value: edge.label,
        symbol: ["none", "arrow"],
        symbolSize: 8,
        lineStyle: { color: "rgba(129,164,225,.5)", width: 1.35, curveness: 0.08 },
        emphasis: { lineStyle: { color: "#d9e7ff", width: 2.4, opacity: 1 } },
      })),
      edgeSymbol: ["none", "arrow"],
      edgeLabel: { show: false },
      emphasis: { focus: "adjacency" },
      scaleLimit: { min: 0.55, max: 2.5 },
    }],
    graphic: compact ? [] : Object.entries(LAYER_META).map(([layer, meta]) => ({
      type: "text",
      left: meta.x - 48,
      top: 12,
      silent: true,
      style: { text: meta.label, fill: "#8fa3c4", font: "600 11px sans-serif" },
      invisible: !grouped.has(layer),
    })),
  };
}

function compactNodePositions(count) {
  if (count <= 1) return [180];
  if (count === 2) return [96, 264];
  return Array.from({ length: count }, (_, index) => 58 + (index * 244) / (count - 1));
}

export function initSystemReleaseCenter({ fetchImpl = globalThis.fetch } = {}) {
  const button = document.querySelector("#systemVersionButton");
  const dialog = document.querySelector("#systemReleaseDialog");
  if (!button || !dialog) return { refresh() {}, destroy() {} };
  const closeButton = dialog.querySelector("#systemReleaseDialogClose");
  const currentVersion = dialog.querySelector("#systemCurrentVersion");
  const currentMeta = dialog.querySelector("#systemCurrentReleaseMeta");
  const history = dialog.querySelector("#systemReleaseHistory");
  const components = dialog.querySelector("#systemComponentStatus");
  const architectureCanvas = dialog.querySelector("#systemArchitectureCanvas");
  const state = { manifest: null, chart: null, loadPromise: null, compactArchitecture: null };
  const tabs = [...dialog.querySelectorAll("[data-system-release-tab]")];

  const selectTab = (name) => {
    tabs.forEach((tab) => {
      const selected = tab.dataset.systemReleaseTab === name;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    dialog.querySelectorAll("[data-system-release-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.systemReleasePanel !== name;
    });
    if (name === "architecture") requestAnimationFrame(renderArchitecture);
  };

  const renderArchitecture = () => {
    if (!state.manifest?.architecture || !architectureCanvas || !globalThis.echarts?.init) return;
    const width = architectureCanvas.clientWidth;
    const height = architectureCanvas.clientHeight;
    if (!dialog.open || width < 20 || height < 20) return;
    state.chart ||= globalThis.echarts.init(architectureCanvas, null, { renderer: "canvas" });
    const compact = architectureCanvas.clientWidth < 640;
    state.chart.resize?.();
    if (state.compactArchitecture === compact) return;
    state.chart.setOption(buildArchitectureGraphOption(state.manifest.architecture, { compact }), true);
    state.compactArchitecture = compact;
  };

  const refresh = async () => {
    if (state.loadPromise) return state.loadPromise;
    state.loadPromise = (async () => {
      dialog.classList.add("is-loading");
      const [manifestResult, runtimeResult, settingsResult, healthResult, releaseResult] = await Promise.allSettled([
        fetchJSON(fetchImpl, "/api/system/releases"),
        fetchJSON(fetchImpl, "/runtime-config"),
        fetchJSON(fetchImpl, "/api/education/settings/summary"),
        fetchJSON(fetchImpl, "/api/education/knowledge/health"),
        fetchJSON(fetchImpl, "/api/education/knowledge/active-release?namespace=shared_curriculum"),
      ]);
      if (manifestResult.status !== "fulfilled") throw manifestResult.reason;
      state.manifest = manifestResult.value;
      renderReleaseManifest({ button, currentVersion, currentMeta, history }, state.manifest);
      renderComponentStatus(components, {
        runtime: resultValue(runtimeResult),
        settings: resultValue(settingsResult),
        health: resultValue(healthResult),
        activeRelease: resultValue(releaseResult),
      });
      state.compactArchitecture = null;
      renderArchitecture();
      dialog.classList.remove("is-loading");
    })().catch((error) => {
      dialog.classList.remove("is-loading");
      if (components) components.innerHTML = `<div class="system-release-error"><b>版本信息暂时无法读取</b><span>${escapeHTML(error?.message || "请求失败")}</span></div>`;
    }).finally(() => { state.loadPromise = null; });
    return state.loadPromise;
  };

  const open = () => {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    selectTab("release");
    void refresh();
  };
  const close = () => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };
  button.addEventListener("click", open);
  closeButton?.addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-system-release-tab]");
    if (tab) selectTab(tab.dataset.systemReleaseTab);
    if (event.target === dialog) close();
  });
  dialog.addEventListener("keydown", (event) => {
    const activeTab = event.target.closest?.("[data-system-release-tab]");
    if (!activeTab) return;
    const currentIndex = tabs.indexOf(activeTab);
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    let nextIndex = currentIndex;
    if (direction) nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = tabs[nextIndex];
    selectTab(next.dataset.systemReleaseTab);
    next.focus();
  });
  const resizeObserver = new ResizeObserver(renderArchitecture);
  if (architectureCanvas) resizeObserver.observe(architectureCanvas);

  return {
    refresh,
    destroy() {
      resizeObserver.disconnect();
      state.chart?.dispose?.();
      state.chart = null;
    },
  };
}

function renderReleaseManifest(els, manifest) {
  const current = manifest?.current_release || {};
  if (els.button) els.button.textContent = current.display_version || current.version || "版本";
  if (els.currentVersion) els.currentVersion.textContent = current.display_version || current.version || "—";
  if (els.currentMeta) {
    els.currentMeta.textContent = `${current.version || "—"} · ${current.release_id || "—"} · ${current.production_release ? "生产发布" : "本地开发版本"}`;
  }
  if (els.history) {
    const releases = Array.isArray(manifest?.releases) ? manifest.releases : [];
    els.history.innerHTML = releases.map((release, index) => `<article class="system-release-item${index === 0 ? " is-current" : ""}"><i></i><div><header><span>${escapeHTML(release.display_version || release.version)}</span><time>${escapeHTML(release.released_at || "历史基线")}</time></header><h4>${escapeHTML(release.title || "版本更新")}</h4><p>${escapeHTML(release.summary || "")}</p><ul>${(release.highlights || []).map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul><code>${escapeHTML(release.release_id || "")}</code></div></article>`).join("");
  }
}

function renderComponentStatus(host, payload) {
  if (!host) return;
  const runtime = payload.runtime || {};
  const settings = payload.settings || {};
  const storage = settings.storage || {};
  const health = payload.health || {};
  const active = payload.activeRelease?.active_release || null;
  const components = [
    { name: "文档与语义模型", ok: runtime.educationImport?.configured === true, detail: runtime.educationImport?.textModel || "未配置" },
    { name: "SQLite 业务数据", ok: storage.application?.configured === true, detail: countSummary(storage.application?.counts) },
    { name: "Qdrant 向量库", ok: health.vector?.ok === true, detail: storage.vector?.collection || health.vector?.code || "未连接" },
    { name: "Neo4j 图数据库", ok: health.graph?.ok === true, detail: active ? `Active ${active.release_id || active.id}` : "已连接但无 active release" },
  ];
  host.innerHTML = components.map((component) => `<article data-state="${component.ok ? "ready" : "attention"}"><i></i><span><b>${escapeHTML(component.name)}</b><small>${escapeHTML(component.detail || "—")}</small></span></article>`).join("");
}

function countSummary(counts) {
  if (!counts || typeof counts !== "object") return "未读取";
  const students = Number(counts.students || 0);
  const knowledge = Number(counts.knowledge_points || 0);
  const questions = Number(counts.questions || 0);
  return `${students} 学生 · ${knowledge} 知识点 · ${questions} 题`;
}

function resultValue(result) {
  return result?.status === "fulfilled" ? result.value : null;
}

async function fetchJSON(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.message || `请求失败（${response.status}）`);
  return payload;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
