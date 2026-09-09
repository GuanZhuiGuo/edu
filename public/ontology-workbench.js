const KIND_META = Object.freeze({
  domain: { label: "领域", color: "#7c8cff", size: 30 },
  theme: { label: "主题", color: "#44c4b3", size: 21 },
  knowledge_point: { label: "知识点", color: "#66a6ff", size: 13 },
  ontology_instance: { label: "实例", color: "#e7a85f", size: 12 },
  question: { label: "题目", color: "#f27d9b", size: 9 },
});

const FALLBACK_KIND_META = Object.freeze({ label: "其他", color: "#9aa7bd", size: 11 });

export function normalizeOntologyGraphPayload(payload) {
  if (!payload || typeof payload !== "object") throw new TypeError("ontology graph payload is required");
  const ontology = payload.ontology && typeof payload.ontology === "object" ? payload.ontology : {};
  const entities = Array.isArray(payload.entities) ? payload.entities : [];
  const relations = Array.isArray(payload.relations) ? payload.relations : [];
  const questions = Array.isArray(payload.question_nodes) ? payload.question_nodes : [];
  const questionRelations = Array.isArray(payload.question_relations) ? payload.question_relations : [];
  const nodeIds = new Set();
  const nodes = [];

  for (const entity of entities) {
    const id = safeId(entity?.id);
    if (!id || nodeIds.has(id)) continue;
    nodeIds.add(id);
    nodes.push({
      id,
      kind: safeText(entity.entity_kind, 80) || "ontology_instance",
      entityClass: safeText(entity.entity_class, 120),
      name: safeText(entity.name, 600) || id,
      description: safeText(entity.description, 4_000),
      aliases: stringList(entity.aliases, 20, 200),
      reviewStatus: safeText(entity.review_status, 80),
      sourceRef: plainObject(entity.source_ref),
      properties: plainObject(entity.properties),
      raw: entity,
    });
  }

  for (const question of questions) {
    const id = safeId(question?.id);
    if (!id || nodeIds.has(id)) continue;
    nodeIds.add(id);
    nodes.push({
      id,
      kind: "question",
      entityClass: safeText(question.question_type, 120) || "question",
      name: safeText(question.title, 600) || safeText(question.stem, 600) || id,
      description: safeText(question.stem, 4_000),
      aliases: [],
      reviewStatus: safeText(question.review_status, 80),
      sourceRef: plainObject(question.provenance),
      properties: {
        difficulty: question.difficulty_code || question.difficulty || "",
        proposition_method: question.proposition_method_code || question.proposition_method || "",
        ability_level: question.ability_level || "",
      },
      raw: question,
    });
  }

  const edges = [];
  const edgeIds = new Set();
  for (const relation of [...relations, ...questionRelations]) {
    const source = safeId(relation?.source);
    const target = safeId(relation?.target);
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    const type = safeText(relation?.type, 120) || "related_to";
    const id = safeId(relation?.id) || `${source}::${type}::${target}`;
    if (edgeIds.has(id)) continue;
    edgeIds.add(id);
    edges.push({
      id,
      source,
      target,
      type,
      directed: relation?.directed !== false,
      reviewStatus: safeText(relation?.review_status, 80),
      properties: plainObject(relation?.properties),
      weight: finiteNumber(relation?.weight, 1),
      raw: relation,
    });
  }

  return {
    ontology: {
      id: safeId(ontology.ontology_id),
      version: safeText(ontology.ontology_version, 160),
      name: safeText(ontology.name, 600) || safeId(ontology.ontology_id) || "未命名本体",
      description: safeText(ontology.description, 4_000),
      schemaVersion: safeText(ontology.schema_version, 160),
      reviewStatus: safeText(ontology.review_status, 80),
      sourceDocument: plainObject(ontology.source_document),
      createdAt: safeText(ontology.created_at, 100),
      updatedAt: safeText(ontology.updated_at, 100),
    },
    entityClasses: Array.isArray(payload.entity_classes) ? payload.entity_classes : [],
    relationTypes: Array.isArray(payload.relation_types) ? payload.relation_types : [],
    nodes,
    edges,
  };
}

export function buildOntologyGraphModel(graph, filters = {}) {
  const query = safeText(filters.query, 200).toLocaleLowerCase("zh-CN");
  const entityClass = safeText(filters.entityClass, 120) || "all";
  const relationType = safeText(filters.relationType, 120) || "all";
  const includeQuestions = filters.includeQuestions !== false;
  const matchingNodeIds = new Set();

  for (const node of graph.nodes) {
    const classMatch = entityClass === "all"
      || node.kind === entityClass
      || node.entityClass === entityClass;
    const queryText = [node.name, node.description, node.id, ...node.aliases].join(" ").toLocaleLowerCase("zh-CN");
    const queryMatch = !query || queryText.includes(query);
    if (classMatch && queryMatch && (includeQuestions || node.kind !== "question")) matchingNodeIds.add(node.id);
  }

  const visibleNodes = graph.nodes.filter((node) => includeQuestions || node.kind !== "question");
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => (
    visibleNodeIds.has(edge.source)
    && visibleNodeIds.has(edge.target)
    && (relationType === "all" || edge.type === relationType)
  ));
  const connectedBySelectedRelation = new Set(visibleEdges.flatMap((edge) => [edge.source, edge.target]));
  const categories = [...new Set(visibleNodes.map((node) => node.kind))].map((kind) => ({
    name: kindMeta(kind).label,
    itemStyle: { color: kindMeta(kind).color },
  }));
  const categoryIndex = new Map([...new Set(visibleNodes.map((node) => node.kind))]
    .map((kind, index) => [kind, index]));

  const nodes = visibleNodes.map((node) => {
    const matches = matchingNodeIds.has(node.id)
      && (relationType === "all" || connectedBySelectedRelation.has(node.id));
    const meta = kindMeta(node.kind);
    return {
      id: node.id,
      name: node.name,
      value: node.id,
      category: categoryIndex.get(node.kind) ?? 0,
      symbolSize: meta.size,
      itemStyle: {
        color: meta.color,
        opacity: matches ? 1 : 0.12,
        borderColor: matches ? "rgba(255,255,255,.9)" : "transparent",
        borderWidth: matches ? 1 : 0,
        shadowBlur: matches ? 12 : 0,
        shadowColor: meta.color,
      },
      label: {
        show: node.kind === "domain" || node.kind === "theme" || (Boolean(query) && matches),
        color: "#dce7ff",
        fontSize: node.kind === "domain" ? 13 : 10,
        formatter: truncate(node.name, node.kind === "domain" ? 14 : 10),
      },
      emphasis: {
        focus: "adjacency",
        scale: 1.7,
        label: { show: true, color: "#ffffff", fontSize: 12, formatter: truncate(node.name, 22) },
      },
      __node: node,
      __matches: matches,
    };
  });

  const edges = visibleEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    value: edge.type,
    symbol: edge.directed ? ["none", "arrow"] : ["none", "none"],
    symbolSize: edge.directed ? 6 : 0,
    lineStyle: {
      color: edge.type === "part_of" ? "rgba(115,154,218,.34)" : "rgba(144,198,255,.58)",
      opacity: relationType === "all" ? 0.52 : 0.86,
      width: edge.type === "part_of" ? 0.75 : 1.15,
      curveness: 0.05,
    },
    emphasis: { lineStyle: { color: "#ffffff", opacity: 1, width: 2.2 } },
    __edge: edge,
  }));

  return {
    nodes,
    edges,
    categories,
    totalNodeCount: visibleNodes.length,
    totalEdgeCount: visibleEdges.length,
    matchingNodeCount: nodes.filter((node) => node.__matches).length,
  };
}

export function buildOntologyEChartsOption(model) {
  return {
    backgroundColor: "transparent",
    animationDuration: 650,
    animationEasingUpdate: "quinticInOut",
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: "rgba(15,24,43,.96)",
      borderColor: "rgba(146,180,240,.25)",
      textStyle: { color: "#f5f8ff", fontSize: 12 },
      formatter(params) {
        if (params.dataType === "edge") {
          const edge = params.data?.__edge;
          return edge ? `<b>${escapeHTML(edge.type)}</b><br>${escapeHTML(edge.source)} → ${escapeHTML(edge.target)}` : "";
        }
        const node = params.data?.__node;
        if (!node) return "";
        return `<b>${escapeHTML(node.name)}</b><br><span style="color:#aebbd1">${escapeHTML(kindMeta(node.kind).label)} · ${escapeHTML(node.entityClass || node.kind)}</span>${node.description ? `<br>${escapeHTML(truncate(node.description, 90))}` : ""}`;
      },
    },
    legend: [{
      type: "scroll",
      orient: "horizontal",
      left: 18,
      top: 14,
      right: 18,
      textStyle: { color: "#b8c5dc", fontSize: 11 },
      data: model.categories.map((item) => item.name),
    }],
    series: [{
      type: "graph",
      layout: "force",
      data: model.nodes,
      links: model.edges,
      categories: model.categories,
      roam: true,
      draggable: true,
      edgeSymbol: ["none", "arrow"],
      force: {
        repulsion: 74,
        edgeLength: [28, 100],
        gravity: 0.075,
        friction: 0.62,
        layoutAnimation: !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
      },
      labelLayout: { hideOverlap: true },
      scaleLimit: { min: 0.22, max: 5 },
      emphasis: { focus: "adjacency" },
    }],
  };
}

export function initOntologyWorkbench({ fetchImpl = globalThis.fetch } = {}) {
  const root = document.querySelector("#ontologyWorkbenchWorkspace");
  if (!root) return { refresh() {}, destroy() {} };
  const els = {
    catalog: root.querySelector("#ontologyCatalogSelect"),
    entityClass: root.querySelector("#ontologyEntityClassFilter"),
    relationType: root.querySelector("#ontologyRelationTypeFilter"),
    entityPicker: root.querySelector("#ontologyEntityPicker"),
    query: root.querySelector("#ontologyGraphSearch"),
    questions: root.querySelector("#ontologyQuestionToggle"),
    canvas: root.querySelector("#ontologyWorkbenchCanvas"),
    stats: root.querySelector("#ontologyWorkbenchStats"),
    detail: root.querySelector("#ontologyWorkbenchDetail"),
    release: root.querySelector("#ontologyActiveReleaseState"),
    refresh: root.querySelector("#ontologyWorkbenchRefresh"),
    fit: root.querySelector("#ontologyWorkbenchFit"),
    empty: root.querySelector("#ontologyWorkbenchEmpty"),
  };
  const state = { ontologies: [], graph: null, chart: null, loaded: false, loadPromise: null };

  const render = () => {
    if (!state.graph || !els.canvas || !globalThis.echarts?.init) return;
    const model = buildOntologyGraphModel(state.graph, {
      query: els.query?.value,
      entityClass: els.entityClass?.value,
      relationType: els.relationType?.value,
      includeQuestions: els.questions?.checked !== false,
    });
    state.chart ||= globalThis.echarts.init(els.canvas, null, { renderer: "canvas" });
    state.chart.setOption(buildOntologyEChartsOption(model), true);
    populateEntityPicker(els.entityPicker, model.nodes);
    state.chart.off("click");
    state.chart.on("click", (params) => {
      if (params.dataType === "node" && params.data?.__node) {
        if (els.entityPicker) els.entityPicker.value = params.data.__node.id;
        renderDetail(els.detail, params.data.__node, state.graph);
      }
      if (params.dataType === "edge" && params.data?.__edge) renderEdgeDetail(els.detail, params.data.__edge, state.graph);
    });
    if (els.stats) {
      els.stats.textContent = `${model.totalNodeCount} 个实体 · ${model.totalEdgeCount} 条关系 · 当前匹配 ${model.matchingNodeCount} 个`;
    }
    els.empty?.toggleAttribute("hidden", model.nodes.length > 0);
  };

  const loadGraph = async () => {
    const selected = decodeOntologySelection(els.catalog?.value);
    if (!selected.id) return;
    setLoading(root, true, "正在读取本体与题目关系…");
    try {
      const query = new URLSearchParams({ ontology_version: selected.version, include_questions: "true", question_limit: "120" });
      const payload = await fetchJSON(fetchImpl, `/api/education/ontologies/${encodeURIComponent(selected.id)}/graph?${query}`);
      state.graph = normalizeOntologyGraphPayload(payload);
      populateFilters(els.entityClass, els.relationType, state.graph);
      render();
      renderOntologyOverview(els.detail, state.graph);
      root.dataset.loadState = "ready";
    } catch (error) {
      root.dataset.loadState = "error";
      showError(els.detail, error?.message || "本体读取失败");
    } finally {
      setLoading(root, false);
    }
  };

  const refresh = async ({ force = false } = {}) => {
    if (state.loadPromise && !force) return state.loadPromise;
    state.loadPromise = (async () => {
      setLoading(root, true, "正在读取本体版本…");
      try {
        const [catalogPayload, releasePayload] = await Promise.all([
          fetchJSON(fetchImpl, "/api/education/ontologies"),
          fetchJSON(fetchImpl, "/api/education/knowledge/active-release?namespace=shared_curriculum").catch(() => null),
        ]);
        state.ontologies = Array.isArray(catalogPayload?.items) ? catalogPayload.items : [];
        populateCatalog(els.catalog, state.ontologies);
        renderActiveRelease(els.release, releasePayload);
        if (state.ontologies.length) await loadGraph();
        else showError(els.detail, "教育数据库中还没有已固化本体。请先完成导入、审核与入库。");
        state.loaded = true;
      } finally {
        state.loadPromise = null;
        setLoading(root, false);
      }
    })();
    return state.loadPromise;
  };

  els.catalog?.addEventListener("change", () => void loadGraph());
  els.entityClass?.addEventListener("change", render);
  els.relationType?.addEventListener("change", render);
  els.entityPicker?.addEventListener("change", () => {
    const node = state.graph?.nodes.find((item) => item.id === els.entityPicker.value);
    if (node) renderDetail(els.detail, node, state.graph);
  });
  els.questions?.addEventListener("change", render);
  els.query?.addEventListener("input", debounce(render, 120));
  els.refresh?.addEventListener("click", () => void refresh({ force: true }));
  els.fit?.addEventListener("click", () => {
    state.chart?.dispatchAction?.({ type: "restore" });
    state.chart?.resize?.();
  });
  const onWorkspaceChange = (event) => {
    if (event.detail?.view !== "ontology") return;
    requestAnimationFrame(() => {
      void refresh();
      state.chart?.resize?.();
    });
  };
  document.addEventListener("learning-workspace:change", onWorkspaceChange);
  const resizeObserver = new ResizeObserver(() => state.chart?.resize?.());
  if (els.canvas) resizeObserver.observe(els.canvas);
  if (!root.hidden) queueMicrotask(() => void refresh());

  return {
    refresh,
    destroy() {
      document.removeEventListener("learning-workspace:change", onWorkspaceChange);
      resizeObserver.disconnect();
      state.chart?.dispose?.();
      state.chart = null;
    },
  };
}

function renderOntologyOverview(host, graph) {
  if (!host) return;
  const questionCount = graph.nodes.filter((node) => node.kind === "question").length;
  host.innerHTML = `<div class="ontology-detail-empty"><span>本体版本</span><h3>${escapeHTML(graph.ontology.name)}</h3><p>${escapeHTML(graph.ontology.description || "点击图中的实体或关系查看来源与属性。")}</p><dl><div><dt>本体 ID</dt><dd>${escapeHTML(graph.ontology.id)}</dd></div><div><dt>版本</dt><dd>${escapeHTML(graph.ontology.version || "未标记")}</dd></div><div><dt>Schema</dt><dd>${escapeHTML(graph.ontology.schemaVersion || "—")}</dd></div><div><dt>审核状态</dt><dd>${escapeHTML(graph.ontology.reviewStatus || "—")}</dd></div><div><dt>业务实体</dt><dd>${graph.nodes.length - questionCount}</dd></div><div><dt>关联题目</dt><dd>${questionCount}</dd></div></dl></div>`;
}

function renderDetail(host, node, graph) {
  if (!host) return;
  const incoming = graph.edges.filter((edge) => edge.target === node.id);
  const outgoing = graph.edges.filter((edge) => edge.source === node.id);
  const linkedQuestions = [...incoming, ...outgoing]
    .map((edge) => graph.nodes.find((candidate) => candidate.id === (edge.source === node.id ? edge.target : edge.source)))
    .filter((candidate) => candidate?.kind === "question");
  host.innerHTML = `<article class="ontology-entity-detail"><header><span>${escapeHTML(kindMeta(node.kind).label)}</span><h3>${escapeHTML(node.name)}</h3><code>${escapeHTML(node.id)}</code></header><p>${escapeHTML(node.description || "暂无描述")}</p><dl><div><dt>实体类</dt><dd>${escapeHTML(node.entityClass || node.kind)}</dd></div><div><dt>审核状态</dt><dd>${escapeHTML(node.reviewStatus || "—")}</dd></div><div><dt>入边 / 出边</dt><dd>${incoming.length} / ${outgoing.length}</dd></div><div><dt>关联题目</dt><dd>${linkedQuestions.length}</dd></div></dl>${renderObjectBlock("来源锚点", node.sourceRef)}${renderObjectBlock("属性", node.properties)}${linkedQuestions.length ? `<section><h4>关联题目</h4><ul>${linkedQuestions.slice(0, 8).map((item) => `<li>${escapeHTML(item.name)}</li>`).join("")}</ul></section>` : ""}</article>`;
}

function renderEdgeDetail(host, edge, graph) {
  if (!host) return;
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  host.innerHTML = `<article class="ontology-entity-detail"><header><span>关系</span><h3>${escapeHTML(edge.type)}</h3><code>${escapeHTML(edge.id)}</code></header><div class="ontology-edge-route"><b>${escapeHTML(source?.name || edge.source)}</b><i>→</i><b>${escapeHTML(target?.name || edge.target)}</b></div><dl><div><dt>方向</dt><dd>${edge.directed ? "有向" : "无向"}</dd></div><div><dt>审核状态</dt><dd>${escapeHTML(edge.reviewStatus || "—")}</dd></div><div><dt>权重</dt><dd>${escapeHTML(String(edge.weight))}</dd></div></dl>${renderObjectBlock("关系属性", edge.properties)}</article>`;
}

function renderObjectBlock(title, value) {
  const entries = Object.entries(value || {}).filter(([, item]) => item !== "" && item !== null && item !== undefined);
  if (!entries.length) return "";
  return `<section><h4>${escapeHTML(title)}</h4><dl>${entries.slice(0, 16).map(([key, item]) => `<div><dt>${escapeHTML(key)}</dt><dd>${escapeHTML(typeof item === "object" ? JSON.stringify(item) : String(item))}</dd></div>`).join("")}</dl></section>`;
}

function populateCatalog(select, ontologies) {
  if (!select) return;
  const previous = select.value;
  select.replaceChildren(...ontologies.map((ontology) => {
    const option = document.createElement("option");
    option.value = encodeOntologySelection(ontology.ontology_id, ontology.ontology_version);
    option.textContent = `${ontology.name} · ${ontology.ontology_version}`;
    return option;
  }));
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function populateFilters(entitySelect, relationSelect, graph) {
  if (entitySelect) {
    const previous = entitySelect.value;
    const kinds = [...new Set(graph.nodes.map((node) => node.kind))];
    entitySelect.replaceChildren(option("all", "全部实体"), ...kinds.map((kind) => option(kind, kindMeta(kind).label)));
    if ([...entitySelect.options].some((item) => item.value === previous)) entitySelect.value = previous;
  }
  if (relationSelect) {
    const previous = relationSelect.value;
    const relationTypes = [...new Set(graph.edges.map((edge) => edge.type))].sort();
    relationSelect.replaceChildren(option("all", "全部关系"), ...relationTypes.map((type) => option(type, type)));
    if ([...relationSelect.options].some((item) => item.value === previous)) relationSelect.value = previous;
  }
}

function populateEntityPicker(select, renderedNodes) {
  if (!select) return;
  const previous = select.value;
  const nodes = renderedNodes
    .filter((node) => node.__matches)
    .map((node) => node.__node)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  select.replaceChildren(
    option("", nodes.length ? `选择实体（${nodes.length}）` : "当前无匹配实体"),
    ...nodes.map((node) => option(node.id, `${kindMeta(node.kind).label} · ${node.name}`)),
  );
  if (nodes.some((node) => node.id === previous)) select.value = previous;
}

function renderActiveRelease(host, payload) {
  if (!host) return;
  const active = payload?.active_release;
  if (!active) {
    host.dataset.state = "inactive";
    host.innerHTML = "<i></i><span><b>业务本体可查看</b><small>Neo4j 暂无 active release</small></span>";
    return;
  }
  host.dataset.state = "active";
  host.innerHTML = `<i></i><span><b>图数据库已激活</b><small>${escapeHTML(active.release_id || active.id || "active release")}</small></span>`;
}

function setLoading(root, loading, label = "") {
  root.classList.toggle("is-loading", loading);
  root.setAttribute("aria-busy", String(Boolean(loading)));
  if (label) {
    root.dataset.loadingLabel = label;
    if (loading) {
      const status = root.querySelector("#ontologyWorkbenchStats");
      if (status) status.textContent = label;
    }
  }
}

function showError(host, message) {
  if (!host) return;
  host.innerHTML = `<div class="ontology-detail-error"><b>暂时无法读取</b><p>${escapeHTML(message)}</p></div>`;
}

async function fetchJSON(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.message || `请求失败（${response.status}）`);
  return payload;
}

function encodeOntologySelection(id, version) {
  return `${encodeURIComponent(String(id || ""))}|${encodeURIComponent(String(version || ""))}`;
}

function decodeOntologySelection(value) {
  const [id = "", version = ""] = String(value || "").split("|");
  try { return { id: decodeURIComponent(id), version: decodeURIComponent(version) }; } catch { return { id: "", version: "" }; }
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function kindMeta(kind) {
  return KIND_META[kind] || FALLBACK_KIND_META;
}

function safeId(value) {
  const text = String(value ?? "").trim();
  return text && text.length <= 300 ? text : "";
}

function safeText(value, max) {
  const text = String(value ?? "").trim();
  return text.slice(0, max);
}

function stringList(value, maxItems, maxLength) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => safeText(item, maxLength)).filter(Boolean) : [];
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function debounce(callback, delay) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}
