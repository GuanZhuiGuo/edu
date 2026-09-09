const MASTERY_META = Object.freeze({
  mastered: { label: "熟练掌握", color: "#147d64" },
  secure: { label: "基本掌握", color: "#2563a9" },
  learning: { label: "学习中", color: "#a46514" },
  weak: { label: "待加强", color: "#b54747" },
  unassessed: { label: "未评估", color: "#8b919b" }
});

const RELATION_META = Object.freeze({
  prerequisite_of: { label: "必要先修", color: "#6b7fb9" },
  strongly_related_to: { label: "强关联", color: "#8c6b9e" },
  applied_with: { label: "联合应用", color: "#3f8a72" },
  equivalent_view_of: { label: "等价视角", color: "#7a6c45" },
  represented_by: { label: "表征", color: "#b06445" },
  supported_by: { label: "支撑", color: "#4d7f87" },
  applied_in: { label: "应用于", color: "#6f7750" },
  derived_from: { label: "推导依据", color: "#7b6ea8" },
  specializes: { label: "特化", color: "#6b778d" },
  equivalent_to: { label: "等价", color: "#7a6c45" },
  contrasts_with: { label: "对照辨析", color: "#a95f5f" }
});

const ROOT_ID = "catalog:junior-math";
const DEFAULT_NODE_LIMIT = 15;

/** Escape all user- or data-authored text before it is placed in an HTML tooltip. */
export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalizeVisualizationFilters(filters = {}) {
  return {
    search: String(filters.search || "").trim().toLowerCase(),
    domain: filters.domain || filters.domainId || "all",
    mastery: filters.mastery || filters.masteryFilter || filters.masteryState || "all"
  };
}

export function pointMatchesFilters(point, masteryById, filters = {}) {
  const normalized = normalizeVisualizationFilters(filters);
  const record = getMasteryRecord(masteryById, point?.id);
  if (normalized.domain !== "all" && point?.domain_id !== normalized.domain) return false;
  if (normalized.mastery !== "all" && record.mastery_state !== normalized.mastery) return false;
  if (!normalized.search) return true;
  const searchable = [point?.name, point?.measurable_behavior, ...(point?.aliases || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return searchable.includes(normalized.search);
}

export function buildMasteryGraphData({ ontology = {}, masteryById, filters = {}, selectedId = null } = {}) {
  const points = ontology.knowledge_points || [];
  const domains = ontology.domains || [];
  const themes = ontology.themes || [];
  const pointIds = new Set(points.map((point) => point.id));
  const pointById = new Map(points.map((point) => [point.id, point]));
  const pointsByTheme = groupBy(points, (point) => point.theme_id);
  const themesByDomain = groupBy(themes, (theme) => theme.domain_id);
  const degreeByPoint = new Map(points.map((point) => [point.id, 0]));
  const links = [];
  for (const edge of ontology.edges || []) {
    if (edge.type === "part_of" || !pointIds.has(edge.source) || !pointIds.has(edge.target)) continue;
    degreeByPoint.set(edge.source, (degreeByPoint.get(edge.source) || 0) + 1);
    degreeByPoint.set(edge.target, (degreeByPoint.get(edge.target) || 0) + 1);
    const sourceMatched = pointMatchesFilters(pointById.get(edge.source), masteryById, filters);
    const targetMatched = pointMatchesFilters(pointById.get(edge.target), masteryById, filters);
    const selectedEdge = edge.source === selectedId || edge.target === selectedId;
    links.push({
      id: edge.id || `${edge.type}:${edge.source}:${edge.target}`,
      source: edge.source,
      target: edge.target,
      dataKind: "relation",
      relationType: edge.type,
      relationLabel: getRelationMeta(edge.type).label,
      lineStyle: {
        color: selectedEdge ? "#3f638f" : "#8293aa",
        opacity: selectedEdge ? 0.96 : sourceMatched && targetMatched ? 0.58 : 0.12,
        width: selectedEdge ? 2.2 : 1.15,
        curveness: edge.type === "strongly_related_to" ? 0.08 : 0.035
      }
    });
  }

  const centers = [
    { x: -380, y: -235 },
    { x: 360, y: -235 },
    { x: -350, y: 265 },
    { x: 345, y: 265 }
  ];
  const nodes = [];
  const domainSummaries = [];

  domains.forEach((domain, domainIndex) => {
    const center = centers[domainIndex] || { x: 0, y: 0 };
    const domainThemes = themesByDomain.get(domain.id) || [];
    const domainPoints = domainThemes.flatMap((theme) => pointsByTheme.get(theme.id) || []);
    domainSummaries.push({ id: domain.id, name: domain.name, pointCount: domainPoints.length, color: domain.color || "#8ca0bd", center });
    nodes.push({
      id: `domain-title:${domain.id}`,
      name: domain.name,
      x: center.x,
      y: center.y - 190,
      symbolSize: 1,
      dataKind: "domain-title",
      itemStyle: { opacity: 0 },
      label: {
        show: true,
        formatter: `${domain.name}  ${domainPoints.length}`,
        position: "inside",
        color: "#566579",
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: 1
      },
      tooltip: { show: false }
    });

    const themeDistance = domainThemes.length <= 3 ? 78 : 114;
    domainThemes.forEach((theme, themeIndex) => {
      const themeAngle = -Math.PI / 2 + (Math.PI * 2 * themeIndex) / Math.max(1, domainThemes.length);
      const themeCenter = {
        x: center.x + Math.cos(themeAngle) * themeDistance,
        y: center.y + Math.sin(themeAngle) * themeDistance * 0.76
      };
      const themePoints = pointsByTheme.get(theme.id) || [];
      themePoints.forEach((point, pointIndex) => {
        const record = getMasteryRecord(masteryById, point.id);
        const mastery = getMasteryMeta(record.mastery_state);
        const matched = pointMatchesFilters(point, masteryById, filters);
        const degree = degreeByPoint.get(point.id) || 0;
        const angle = pointIndex * 2.399963 + themeIndex * 0.64 + domainIndex * 0.37;
        const radius = pointIndex === 0 ? 0 : 13 + Math.sqrt(pointIndex) * 15;
        const selected = point.id === selectedId;
        nodes.push({
          id: point.id,
          name: point.name,
          x: themeCenter.x + Math.cos(angle) * radius * 1.12,
          y: themeCenter.y + Math.sin(angle) * radius,
          value: [degree, record.mastery_probability],
          symbolSize: selected ? 25 : Math.min(20, 7 + Math.sqrt(Math.max(1, degree)) * 3.1),
          category: domainIndex,
          dataKind: "point",
          matched,
          selected,
          masteryState: record.mastery_state,
          masteryLabel: mastery.label,
          masteryProbability: record.mastery_probability,
          evidenceCount: record.evidence_count || 0,
          degree,
          domainId: point.domain_id,
          domainName: domain.name,
          themeId: point.theme_id,
          themeName: theme.name,
          itemStyle: {
            color: mastery.color,
            opacity: matched ? 0.94 : 0.1,
            borderColor: selected ? "#274f7d" : "rgba(73, 91, 117, 0.52)",
            borderWidth: selected ? 2.8 : 0.9,
            shadowBlur: selected ? 20 : matched ? 8 : 0,
            shadowColor: selected ? "rgba(55, 91, 134, 0.34)" : toRgba(mastery.color, 0.28)
          },
          label: {
            show: selected || degree >= 9,
            formatter: shortenLabel(point.name, selected ? 18 : 10),
            position: "right",
            distance: 5,
            color: selected ? "#1f3046" : matched ? "rgba(61, 75, 95, 0.72)" : "rgba(61, 75, 95, 0.18)",
            fontSize: selected ? 11 : 9,
            fontWeight: selected ? 700 : 500
          }
        });
      });
    });
  });

  return {
    nodes,
    links,
    domains: domainSummaries,
    pointCount: points.length
  };
}

export function buildStructureTree({ ontology = {}, masteryById, filters = {}, selectedId = null, expandedThemeIds = [] } = {}) {
  const expanded = expandedThemeIds instanceof Set ? expandedThemeIds : new Set(expandedThemeIds || []);
  const domains = ontology.domains || [];
  const themes = ontology.themes || [];
  const points = ontology.knowledge_points || [];
  const themesByDomain = groupBy(themes, (theme) => theme.domain_id);
  const pointsByTheme = groupBy(points, (point) => point.theme_id);

  return {
    id: ROOT_ID,
    data: {
      kind: "root",
      label: "中考数学",
      matched: true,
      color: "#243049"
    },
    children: domains.map((domain) => ({
      id: domain.id,
      data: {
        kind: "domain",
        label: domain.name,
        matched: true,
        color: domain.color || "#5f6f89"
      },
      children: (themesByDomain.get(domain.id) || []).map((theme) => {
        const themePoints = pointsByTheme.get(theme.id) || [];
        const themeMatched = themePoints.some((point) => pointMatchesFilters(point, masteryById, filters));
        return {
          id: theme.id,
          data: {
            kind: "theme",
            label: theme.name,
            matched: themeMatched,
            expanded: expanded.has(theme.id),
            pointCount: themePoints.length,
            color: theme.color || domain.color || "#72809a"
          },
          children: expanded.has(theme.id)
            ? themePoints.map((point) => structurePointNode(point, masteryById, filters, selectedId))
            : []
        };
      })
    }))
  };
}

export function buildDependencyGraphData({ ontology = {}, masteryById, selectedId, relationFilter = "all", limit = DEFAULT_NODE_LIMIT } = {}) {
  const points = ontology.knowledge_points || [];
  const pointById = new Map(points.map((point) => [point.id, point]));
  const selected = pointById.get(selectedId);
  if (!selected) return { nodes: [], edges: [], neighborIds: [] };

  const candidates = [];
  for (const edge of ontology.edges || []) {
    if (edge.type === "part_of") continue;
    if (relationFilter !== "all" && edge.type !== relationFilter) continue;
    if (edge.source !== selectedId && edge.target !== selectedId) continue;
    const otherId = edge.source === selectedId ? edge.target : edge.source;
    if (!pointById.has(otherId)) continue;
    candidates.push({
      edge,
      otherId,
      role: dependencyRole(edge, selectedId),
      priority: dependencyPriority(edge, selectedId)
    });
  }

  candidates.sort((a, b) => a.priority - b.priority || String(a.edge.id || "").localeCompare(String(b.edge.id || "")));
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.otherId)) continue;
    seen.add(candidate.otherId);
    unique.push(candidate);
    if (unique.length >= Math.max(0, limit - 1)) break;
  }

  const nodes = [dependencyNode(selected, masteryById, "selected")];
  for (const candidate of unique) {
    nodes.push(dependencyNode(pointById.get(candidate.otherId), masteryById, candidate.role));
  }
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = unique.map(({ edge }) => ({
    id: edge.id || `${edge.type}:${edge.source}:${edge.target}`,
    source: edge.source,
    target: edge.target,
    data: {
      relationType: edge.type,
      relationLabel: getRelationMeta(edge.type).label,
      directed: edge.directed !== false
    }
  })).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));

  return { nodes, edges, neighborIds: unique.map((item) => item.otherId) };
}

/**
 * Browser renderer for the three coordinated learning-map views.
 * The factory itself performs all browser-global lookups so this module stays importable in Node.
 */
export function createKnowledgeVisualizations({
  masteryHost,
  treemapHost,
  mindmapHost,
  dependencyHost,
  onSelectPoint = () => {},
  onSelectTheme = () => {},
  onHoverPoint = () => {},
  onLeavePoint = () => {}
} = {}) {
  const overviewHost = masteryHost || treemapHost;
  let masteryChart = null;
  let mindmapGraph = null;
  let dependencyGraph = null;

  function renderMastery({ ontology, masteryById, filters, selectedId } = {}) {
    const echarts = getBrowserGlobal("echarts");
    if (!overviewHost || !echarts?.init) {
      renderUnavailable(overviewHost, "掌握全景暂时无法显示");
      return null;
    }
    if (!masteryChart) masteryChart = echarts.getInstanceByDom?.(overviewHost) || echarts.init(overviewHost, "light");
    const data = buildMasteryGraphData({ ontology, masteryById, filters, selectedId });
    const reducedMotion = getReducedMotion();
    overviewHost.setAttribute("role", "img");
    overviewHost.setAttribute("aria-label", "中考数学知识点掌握全景关系图");
    masteryChart.setOption({
      backgroundColor: "transparent",
      animation: !reducedMotion,
      animationDuration: reducedMotion ? 0 : 680,
      animationDurationUpdate: reducedMotion ? 0 : 360,
      animationEasing: "cubicOut",
      textStyle: { fontFamily: "Inter, PingFang SC, Microsoft YaHei, sans-serif" },
      aria: {
        enabled: true,
        description: "中考数学知识点掌握全景关系图，节点颜色表示掌握程度，节点大小表示关联程度。"
      },
      graphic: data.domains.map((domain, index) => ({
        type: "text",
        silent: true,
        left: index % 2 === 0 ? "14%" : undefined,
        right: index % 2 === 1 ? "14%" : undefined,
        top: index < 2 ? "13%" : "59%",
        style: {
          text: `${domain.name}  ${domain.pointCount}`,
          fill: toRgba(domain.color, 0.82),
          font: "600 13px Inter, PingFang SC, Microsoft YaHei, sans-serif",
          textAlign: index % 2 === 0 ? "left" : "right"
        }
      })),
      tooltip: {
        show: false
      },
      series: [{
        id: "mastery-network",
        type: "graph",
        layout: "none",
        data: data.nodes,
        links: data.links,
        categories: (ontology.domains || []).map((domain) => ({ name: domain.name })),
        roam: true,
        zoom: 0.94,
        center: ["50%", "51%"],
        scaleLimit: { min: 0.55, max: 4.5 },
        selectedMode: "single",
        cursor: "pointer",
        lineStyle: { color: "#8293aa", width: 1.15, opacity: 0.58, curveness: 0.035 },
        edgeSymbol: ["none", "none"],
        emphasis: {
          focus: "adjacency",
          scale: 1.7,
          itemStyle: { borderColor: "#274f7d", borderWidth: 2, shadowBlur: 20, shadowColor: "rgba(55,91,134,0.3)" },
          label: { show: true, color: "#1f3046", fontSize: 11, fontWeight: 700 },
          lineStyle: { color: "#3f638f", opacity: 0.96, width: 2.2 }
        },
        blur: {
          itemStyle: { opacity: 0.18 },
          lineStyle: { opacity: 0.1 },
          label: { opacity: 0.16 }
        }
      }]
    }, true);
    masteryChart.off("click");
    masteryChart.off("mouseover");
    masteryChart.off("mouseout");
    masteryChart.on("click", (event) => {
      if (isMasteryPointEvent(event)) onSelectPoint(event.data.id);
    });
    masteryChart.on("mouseover", (event) => {
      if (isMasteryPointEvent(event)) onHoverPoint(event.data.id, getEventPointer(event));
    });
    masteryChart.on("mouseout", (event) => {
      if (isMasteryPointEvent(event)) onLeavePoint();
    });
    return masteryChart;
  }

  function renderStructure({ ontology, masteryById, filters, selectedId, expandedThemeIds, focusId = null } = {}) {
    const G6 = getBrowserGlobal("G6");
    if (!mindmapHost || !G6?.Graph || !G6?.treeToGraphData) {
      renderUnavailable(mindmapHost, "知识脉络暂时无法显示");
      return null;
    }
    destroyGraph(mindmapGraph);
    const tree = buildStructureTree({ ontology, masteryById, filters, selectedId, expandedThemeIds });
    const data = G6.treeToGraphData(tree, {
      getEdgeData: (source, target) => ({
        id: `structure:${source.id}:${target.id}`,
        source: source.id,
        target: target.id
      })
    });
    mindmapHost.replaceChildren();
    mindmapHost.setAttribute("role", "img");
    mindmapHost.setAttribute("aria-label", "中考数学知识脉络图");
    mindmapGraph = new G6.Graph({
      container: mindmapHost,
      data,
      animation: false,
      padding: 36,
      layout: {
        type: "mindmap",
        direction: "H",
        getWidth: (datum) => structureNodeSize(datum)[0],
        getHeight: (datum) => structureNodeSize(datum)[1],
        getVGap: () => 8,
        getHGap: () => 48
      },
      node: {
        type: "rect",
        style: structureNodeStyle
      },
      edge: {
        type: "cubic-horizontal",
        style: { stroke: "#98a7ba", lineWidth: 1.45, opacity: 0.94 }
      },
      behaviors: ["drag-canvas", "zoom-canvas"]
    });
    bindGraphNodeClick(mindmapGraph, (id) => {
      const node = mindmapGraph?.getNodeData?.(id);
      if (node?.data?.kind === "point") onSelectPoint(id);
      if (node?.data?.kind === "theme") onSelectTheme(id);
    });
    bindGraphNodeHover(mindmapGraph, (id, event) => {
      const node = mindmapGraph?.getNodeData?.(id);
      if (node?.data?.kind === "point") onHoverPoint(id, getEventPointer(event));
    }, onLeavePoint);
    renderAndFit(mindmapGraph, 1, focusId);
    return mindmapGraph;
  }

  function renderDependency({ ontology, masteryById, selectedId, relationFilter = "all" } = {}) {
    const G6 = getBrowserGlobal("G6");
    if (!dependencyHost || !G6?.Graph) {
      renderUnavailable(dependencyHost, "知识点依赖暂时无法显示");
      return null;
    }
    destroyGraph(dependencyGraph);
    const data = buildDependencyGraphData({ ontology, masteryById, selectedId, relationFilter });
    dependencyHost.replaceChildren();
    if (!data.nodes.length) {
      dependencyHost.innerHTML = '<div class="knowledge-visual-empty" role="status">选择一个知识点查看直接依赖</div>';
      dependencyGraph = null;
      return null;
    }
    dependencyHost.setAttribute("role", "img");
    dependencyHost.setAttribute("aria-label", "所选知识点的一层依赖图");
    dependencyGraph = new G6.Graph({
      container: dependencyHost,
      data,
      animation: false,
      padding: 42,
      layout: {
        type: "antv-dagre",
        rankdir: "LR",
        ranksep: 78,
        nodesep: 28,
        align: "UL"
      },
      node: {
        type: "rect",
        style: dependencyNodeStyle
      },
      edge: {
        type: "polyline",
        style: dependencyEdgeStyle
      },
      behaviors: ["drag-canvas", "zoom-canvas"]
    });
    bindGraphNodeClick(dependencyGraph, (id) => {
      if (id && id !== selectedId) onSelectPoint(id);
    });
    bindGraphNodeHover(dependencyGraph, (id, event) => onHoverPoint(id, getEventPointer(event)), onLeavePoint);
    renderAndFit(dependencyGraph);
    return dependencyGraph;
  }

  function fit(view) {
    if (view === "mastery" || view === "treemap") {
      masteryChart?.resize?.();
      masteryChart?.dispatchAction?.({ type: "restore" });
      return;
    }
    const graph = view === "dependency" || view === "focus" ? dependencyGraph : mindmapGraph;
    graph?.fitView?.({ when: "always" }, { duration: 280 })?.catch?.(() => {});
  }

  function resize() {
    masteryChart?.resize?.();
    safeResizeGraph(mindmapGraph);
    safeResizeGraph(dependencyGraph);
  }

  function destroy() {
    masteryChart?.dispose?.();
    masteryChart = null;
    destroyGraph(mindmapGraph);
    destroyGraph(dependencyGraph);
    mindmapGraph = null;
    dependencyGraph = null;
  }

  return { renderMastery, renderStructure, renderDependency, fit, resize, destroy };
}

function structurePointNode(point, masteryById, filters, selectedId) {
  const record = getMasteryRecord(masteryById, point.id);
  const mastery = getMasteryMeta(record.mastery_state);
  return {
    id: point.id,
    data: {
      kind: "point",
      label: point.name,
      matched: pointMatchesFilters(point, masteryById, filters),
      selected: point.id === selectedId,
      masteryState: record.mastery_state,
      masteryLabel: mastery.label,
      masteryProbability: record.mastery_probability,
      color: mastery.color
    }
  };
}

function dependencyNode(point, masteryById, role) {
  const record = getMasteryRecord(masteryById, point.id);
  const mastery = getMasteryMeta(record.mastery_state);
  return {
    id: point.id,
    data: {
      kind: "point",
      label: point.name,
      role,
      masteryState: record.mastery_state,
      masteryLabel: mastery.label,
      masteryProbability: record.mastery_probability,
      color: mastery.color
    }
  };
}

function dependencyRole(edge, selectedId) {
  if (edge.type === "prerequisite_of") return edge.target === selectedId ? "prerequisite" : "successor";
  return "related";
}

function dependencyPriority(edge, selectedId) {
  if (edge.type === "prerequisite_of") return edge.target === selectedId ? 0 : 1;
  return 2;
}

function structureNodeSize(datum) {
  const kind = datum?.data?.kind || "point";
  if (kind === "root") return [136, 42];
  if (kind === "domain") return [132, 40];
  if (kind === "theme") return [174, 42];
  return [238, 46];
}

function structureNodeStyle(datum) {
  const data = datum?.data || {};
  const kind = data.kind || "point";
  const [width, height] = structureNodeSize(datum);
  const matchedOpacity = data.matched === false ? 0.24 : 1;
  const base = {
    size: [width, height],
    radius: kind === "root" ? 12 : 9,
    labelText: data.label || datum.id,
    labelFontFamily: "Inter, PingFang SC, Microsoft YaHei, sans-serif",
    labelFontSize: kind === "point" ? 11 : 12,
    labelFontWeight: kind === "root" || kind === "domain" ? 700 : 600,
    labelPlacement: "center",
    labelTextAlign: "center",
    labelTextBaseline: "middle",
    labelOffsetX: 0,
    labelOffsetY: 0,
    labelWordWrap: true,
    labelMaxWidth: width - 22,
    labelMaxLines: 2,
    labelOverflow: "ellipsis",
    cursor: kind === "theme" || kind === "point" ? "pointer" : "default",
    opacity: matchedOpacity,
    labelOpacity: matchedOpacity
  };
  if (kind === "root") return { ...base, fill: "#eef3fb", stroke: "#243049", labelFill: "#243049", lineWidth: 2.5 };
  if (kind === "domain") return { ...base, fill: toRgba(data.color || "#5f6f89", 0.14), stroke: data.color || "#5f6f89", labelFill: "#243049", lineWidth: 2 };
  if (kind === "theme") return {
    ...base,
    fill: "#fffdfa",
    stroke: data.color || "#72809a",
    labelFill: "#283247",
    lineWidth: data.expanded ? 2.5 : 1.5,
    shadowColor: data.expanded ? toRgba(data.color || "#72809a", 0.24) : "transparent",
    shadowBlur: data.expanded ? 12 : 0
  };
  return {
    ...base,
    fill: toRgba(data.color || "#8b919b", data.selected ? 0.2 : 0.1),
    stroke: data.selected ? "#1e293b" : data.color || "#8b919b",
    labelFill: "#30394c",
    lineWidth: data.selected ? 3 : 1.25
  };
}

function dependencyNodeStyle(datum) {
  const data = datum?.data || {};
  const isSelected = data.role === "selected";
  const roleColor = data.role === "prerequisite"
    ? "#667bb4"
    : data.role === "successor"
      ? "#2f856d"
      : data.role === "related"
        ? "#8a6a9a"
        : "#243049";
  return {
    size: isSelected ? [250, 58] : [220, 48],
    radius: isSelected ? 12 : 9,
    fill: isSelected ? "#eef3fb" : "#fffdfa",
    stroke: isSelected ? "#243049" : roleColor,
    lineWidth: isSelected ? 2.5 : 1.5,
    labelText: data.label || datum.id,
    labelFill: "#30394c",
    labelFontFamily: "Inter, PingFang SC, Microsoft YaHei, sans-serif",
    labelFontSize: isSelected ? 12 : 11,
    labelFontWeight: isSelected ? 700 : 600,
    labelPlacement: "center",
    labelTextAlign: "center",
    labelTextBaseline: "middle",
    labelOffsetX: 0,
    labelOffsetY: 0,
    labelWordWrap: true,
    labelMaxWidth: isSelected ? 222 : 194,
    labelMaxLines: 2,
    labelOverflow: "ellipsis",
    cursor: "pointer",
    shadowColor: isSelected ? "rgba(21,31,52,0.2)" : "transparent",
    shadowBlur: isSelected ? 14 : 0
  };
}

function dependencyEdgeStyle(datum) {
  const data = datum?.data || {};
  const relation = getRelationMeta(data.relationType);
  return {
    stroke: relation.color,
    lineWidth: 1.7,
    opacity: 0.92,
    radius: 10,
    endArrow: data.directed !== false,
    labelText: relation.label,
    labelFill: "#526174",
    labelFontSize: 10,
    labelBackground: true,
    labelBackgroundFill: "rgba(255,255,255,0.96)",
    labelBackgroundStroke: "#d8dee7",
    labelPadding: [3, 6]
  };
}

function masteryGraphTooltip(params) {
  const data = params?.data || {};
  if (data.dataKind === "relation") {
    return `<b>${escapeHTML(data.relationLabel || "知识关系")}</b>`;
  }
  if (data.dataKind !== "point") return `<b>${escapeHTML(data.name || "")}</b>`;
  const probability = data.masteryProbability == null ? "暂无评估" : `${Math.round(data.masteryProbability * 100)}%`;
  return [
    `<b style="display:block;max-width:280px;white-space:normal;line-height:1.55">${escapeHTML(data.name)}</b>`,
    `<span style="display:block;margin-top:6px;opacity:.82">${escapeHTML(data.domainName)} · ${escapeHTML(data.themeName)}</span>`,
    `<span style="display:block;margin-top:3px;opacity:.82">${escapeHTML(data.masteryLabel)} · ${escapeHTML(probability)} · ${Number(data.evidenceCount || 0)}条记录</span>`
  ].join("");
}

function shortenLabel(value, maxLength = 12) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function getReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getMasteryRecord(masteryById, id) {
  const record = masteryById instanceof Map ? masteryById.get(id) : masteryById?.[id];
  return record || {
    mastery_state: "unassessed",
    mastery_probability: null,
    confidence: 0,
    evidence_count: 0
  };
}

function getMasteryMeta(state) {
  return MASTERY_META[state] || MASTERY_META.unassessed;
}

function getRelationMeta(type) {
  return RELATION_META[type] || { label: type || "关联", color: "#7c8799" };
}

function groupBy(items, getKey) {
  const grouped = new Map();
  for (const item of items || []) {
    const key = getKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

function toRgba(color, alpha) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(color || ""));
  if (!match) return color;
  return `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, ${alpha})`;
}

function getBrowserGlobal(name) {
  if (typeof window === "undefined") return null;
  return window[name] || null;
}

function renderUnavailable(host, message) {
  if (!host) return;
  host.innerHTML = `<div class="knowledge-visual-empty" role="status">${escapeHTML(message)}</div>`;
}

function bindGraphNodeClick(graph, handler) {
  graph?.on?.("node:click", (event) => {
    const id = event?.target?.id || event?.target?.getAttribute?.("id") || event?.originalTarget?.id;
    if (id != null) handler(String(id));
  });
}

function bindGraphNodeHover(graph, onEnter, onLeave) {
  graph?.on?.("node:pointerenter", (event) => {
    const id = event?.target?.id || event?.target?.getAttribute?.("id") || event?.originalTarget?.id;
    if (id != null) onEnter(String(id), event);
  });
  graph?.on?.("node:pointerleave", () => onLeave());
}

function getEventPointer(event) {
  const nativeEvent = event?.event?.event || event?.originalEvent || event?.event || {};
  const client = nativeEvent?.client || event?.client || {};
  return {
    clientX: nativeEvent?.clientX ?? client?.x,
    clientY: nativeEvent?.clientY ?? client?.y
  };
}

function isMasteryPointEvent(event) {
  const data = event?.data;
  if (!data?.id || String(data.id).startsWith("domain-title:")) return false;
  return data.dataKind === "point" || event?.dataType === "node";
}

function renderAndFit(graph, zoomBoost = 1, focusId = null) {
  const rendered = graph?.render?.();
  if (rendered?.then) {
    rendered.then(async () => {
      await graph?.fitView?.({ when: "always" }, false);
      if (focusId) {
        await graph?.zoomTo?.(1.08, false);
        await graph?.focusElement?.(focusId, false);
      } else if (zoomBoost !== 1) {
        await graph?.zoomBy?.(zoomBoost, false);
      }
    }).catch(() => {});
  }
}

function safeResizeGraph(graph) {
  try {
    if (graph && !graph.destroyed) graph.resize();
  } catch {
    // Hidden workspaces can have a temporary zero-sized canvas; the next visible resize will recover it.
  }
}

function destroyGraph(graph) {
  try {
    if (graph && !graph.destroyed) graph.destroy();
  } catch {
    // A partially initialized canvas should not prevent the other coordinated view from rendering.
  }
}
