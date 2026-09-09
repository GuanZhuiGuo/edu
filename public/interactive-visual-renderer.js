import { applyKnowledgeCardInputValues } from "./knowledge-card-parameter-contract.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SCHEMA_VERSION = "interactive-visual@1.0";
const SUPPORTED_VARIANTS = new Set([
  "linear",
  "quadratic",
  "numberline",
  "triangle",
  "circle",
  "coordinate",
  "statistics",
  "probability",
  "algebra",
  "concept"
]);

const DEDICATED_MODEL_KINDS = new Set([
  "expression_builder",
  "formula_builder",
  "substitution_evaluator",
  "exponent_laws",
  "scientific_notation",
  "power_operations",
  "mixed_operations",
  "operation_laws",
  "word_problem",
  "square_root_inverse",
  "radical_operations",
  "axis_reflection",
  "rotation",
  "central_symmetry",
  "transform_composition",
  "dilation",
  "projection_rays",
  "orthographic_views",
  "solid_net"
]);

const ALGEBRA_MODEL_KINDS = new Set([
  "expression_builder",
  "formula_builder",
  "substitution_evaluator",
  "exponent_laws",
  "scientific_notation",
  "power_operations",
  "mixed_operations",
  "operation_laws",
  "word_problem",
  "square_root_inverse",
  "radical_operations"
]);

const TRANSFORM_MODEL_KINDS = new Set([
  "axis_reflection",
  "rotation",
  "central_symmetry",
  "transform_composition",
  "dilation"
]);

const SPATIAL_MODEL_KINDS = new Set([
  "projection_rays",
  "orthographic_views",
  "solid_net"
]);

const DEFAULT_TITLES = Object.freeze({
  linear: "一次函数",
  quadratic: "二次函数",
  numberline: "数轴",
  triangle: "直角三角形",
  circle: "圆与扇形",
  coordinate: "平面直角坐标系",
  statistics: "数据统计",
  probability: "概率模型",
  algebra: "代数等式",
  concept: "知识关系"
});

const COLORS = Object.freeze({
  ink: "#24324a",
  muted: "#6b7890",
  grid: "#dbe3ef",
  panel: "#f7f9fc",
  paper: "#ffffff",
  secondary: "#e39a4a",
  success: "#16856c",
  weak: "#b8c3d2"
});

/**
 * Convert a local artifact interactive spec into a bounded, executable-free model.
 * Raw expressions, HTML, URLs and event handlers are deliberately not retained.
 */
export function normalizeInteractiveVisualArtifact(input = {}) {
  const trustedSpec = unwrapSpec(input);
  const directInputValues = objectRecord(input?.input_values);
  const nestedInputValues = objectRecord(trustedSpec?.input_values);
  const inputValues = Object.keys(directInputValues).length
    ? directInputValues
    : nestedInputValues;
  const source = trustedSpec?.parameterization
    ? applyKnowledgeCardInputValues(trustedSpec, inputValues)
    : trustedSpec;
  const requestedVariant = normalizeVariantToken(source.variant ?? source.type ?? source.kind);
  const variant = SUPPORTED_VARIANTS.has(requestedVariant) ? requestedVariant : "concept";
  const title = safeText(source.title ?? source.name, 120) || DEFAULT_TITLES[variant];
  const description = safeText(source.description ?? source.instruction ?? source.summary ?? source.caption, 360);
  const ariaLabel = safeText(source.aria_label, 180) || `${title}互动图解`;
  const accent = safeColor(source.accent ?? source.color);
  const id = safeId(source.id ?? input?.id) || `interactive-${variant}`;

  return deepFreeze({
    schema_version: SCHEMA_VERSION,
    id,
    variant,
    requested_variant: requestedVariant || variant,
    fallback: variant !== requestedVariant && Boolean(requestedVariant),
    title,
    description,
    aria_label: ariaLabel,
    accent,
    model: normalizeModel(variant, source)
  });
}

/**
 * Mount a trusted, normalized interactive visual. Returns an idempotent destroy function.
 */
export function mountInteractiveVisual(container, input, { compact = false } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("interactive visual requires a DOM container");
  }
  const doc = container.ownerDocument || globalThis.document;
  if (!doc?.createElement || !doc?.createElementNS) {
    throw new TypeError("interactive visual requires a browser-like document");
  }

  const spec = normalizeInteractiveVisualArtifact(input);
  const listeners = [];
  const root = element(doc, "section", {
    role: "group",
    "aria-label": spec.aria_label,
    "data-interactive-visual": spec.variant,
    "data-interactive-visual-id": spec.id,
    "data-interactive-model": spec.model.kind
  });
  style(root, {
    width: "100%",
    minWidth: "0",
    boxSizing: "border-box",
    display: "grid",
    gap: compact ? "8px" : "12px",
    padding: compact ? "10px" : "16px",
    border: "1px solid #dce4ef",
    borderRadius: compact ? "12px" : "16px",
    background: COLORS.paper,
    color: COLORS.ink,
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    boxShadow: compact ? "none" : "0 12px 32px rgba(46, 65, 92, 0.08)"
  });

  const header = element(doc, "header");
  style(header, { display: "grid", gap: "3px", minWidth: "0" });
  const eyebrow = element(doc, "span", {}, variantLabel(spec.variant));
  style(eyebrow, {
    color: spec.accent,
    fontSize: compact ? "10px" : "11px",
    fontWeight: "700",
    letterSpacing: "0.08em"
  });
  const heading = element(doc, compact ? "h4" : "h3", {}, spec.title);
  style(heading, {
    margin: "0",
    fontSize: compact ? "15px" : "19px",
    lineHeight: "1.35",
    fontWeight: "750"
  });
  header.append(eyebrow, heading);
  if (spec.description && !compact) {
    const description = element(doc, "p", {}, spec.description);
    style(description, {
      margin: "0",
      color: COLORS.muted,
      fontSize: "13px",
      lineHeight: "1.55"
    });
    header.append(description);
  }

  const body = element(doc, "div");
  style(body, {
    display: "grid",
    gridTemplateColumns: compact ? "minmax(0, 1fr)" : "minmax(0, 1.65fr) minmax(190px, 0.72fr)",
    gap: compact ? "8px" : "14px",
    minWidth: "0",
    alignItems: "stretch"
  });
  const stage = element(doc, "div", { "data-visual-stage": spec.variant });
  style(stage, {
    position: "relative",
    minWidth: "0",
    minHeight: compact ? "178px" : "260px",
    overflow: "hidden",
    borderRadius: compact ? "10px" : "13px",
    border: "1px solid #e1e7f0",
    background: COLORS.panel
  });
  const side = element(doc, "div");
  style(side, {
    display: "grid",
    alignContent: "start",
    gap: compact ? "6px" : "10px",
    minWidth: "0"
  });
  const controls = element(doc, "div", { "data-visual-controls": spec.variant });
  style(controls, {
    display: "grid",
    gap: compact ? "6px" : "9px",
    minWidth: "0"
  });
  const status = element(doc, "output", {
    "aria-live": "polite",
    "data-visual-status": spec.variant
  });
  style(status, {
    display: "block",
    minHeight: compact ? "18px" : "38px",
    padding: compact ? "6px 8px" : "9px 10px",
    borderRadius: "9px",
    background: "#eef3f9",
    color: COLORS.ink,
    fontSize: compact ? "11px" : "12px",
    lineHeight: "1.5",
    overflowWrap: "anywhere"
  });
  side.append(controls, status);
  body.append(stage, side);
  root.append(header, body);

  const context = {
    doc,
    root,
    stage,
    controls,
    status,
    compact: Boolean(compact),
    accent: spec.accent,
    listen(target, type, handler) {
      target.addEventListener(type, handler);
      listeners.push([target, type, handler]);
    }
  };
  renderVariant(context, spec);
  container.replaceChildren(root);

  let destroyed = false;
  return function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const [target, type, handler] of listeners.splice(0)) {
      target.removeEventListener(type, handler);
    }
    if (root.parentNode === container) root.remove();
  };
}

function renderVariant(context, spec) {
  if (ALGEBRA_MODEL_KINDS.has(spec.model.kind)) {
    renderDedicatedAlgebra(context, spec.model);
    return;
  }
  if (TRANSFORM_MODEL_KINDS.has(spec.model.kind)) {
    renderDedicatedTransform(context, spec.model);
    return;
  }
  if (SPATIAL_MODEL_KINDS.has(spec.model.kind)) {
    renderDedicatedSpatial(context, spec.model);
    return;
  }
  const renderers = {
    linear: renderLinear,
    quadratic: renderQuadratic,
    numberline: renderNumberLine,
    triangle: renderTriangle,
    circle: renderCircle,
    coordinate: renderCoordinate,
    statistics: renderStatistics,
    probability: renderProbability,
    algebra: renderAlgebra,
    concept: renderConcept
  };
  (renderers[spec.variant] || renderConcept)(context, spec.model);
}

function renderLinear(context, model) {
  const { svg, plot } = createCoordinateStage(context, "可交互的一次函数图像", model);
  const path = svgNode(context.doc, "path", {
    fill: "none",
    stroke: context.accent,
    "stroke-width": context.compact ? 3 : 3.5,
    "stroke-linecap": "round"
  });
  const intercept = svgNode(context.doc, "circle", { r: 5, fill: COLORS.secondary, stroke: "#ffffff", "stroke-width": 2 });
  svg.append(path, intercept);
  let slope = model.slope;
  let offset = model.intercept;
  const update = () => {
    path.setAttribute("d", sampledPath(model.x_min, model.x_max, 96, (x) => slope * x + offset, plot));
    setPoint(intercept, plot.x(0), plot.y(offset));
    context.status.textContent = `y = ${formatCoefficient(slope, "x")}${formatSigned(offset)}　 y 轴交点 (0, ${formatNumber(offset)})`;
  };
  createRange(context, { label: "斜率 k", min: -5, max: 5, step: 0.25, value: slope, onInput(value, output) { slope = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "截距 b", min: -6, max: 6, step: 0.25, value: offset, onInput(value, output) { offset = value; output.textContent = formatNumber(value); update(); } });
  update();
}

function renderQuadratic(context, model) {
  const { svg, plot } = createCoordinateStage(context, "可交互的二次函数图像", model);
  const axis = svgNode(context.doc, "line", { stroke: COLORS.secondary, "stroke-width": 1.4, "stroke-dasharray": "5 5" });
  const path = svgNode(context.doc, "path", { fill: "none", stroke: context.accent, "stroke-width": context.compact ? 3 : 3.5, "stroke-linecap": "round" });
  const vertex = svgNode(context.doc, "circle", { r: 5.5, fill: COLORS.secondary, stroke: "#ffffff", "stroke-width": 2 });
  svg.append(axis, path, vertex);
  let magnitude = model.magnitude;
  let opening = model.opening;
  let h = model.h;
  let k = model.k;
  const update = () => {
    const a = opening === "down" ? -magnitude : magnitude;
    const curve = (x) => a * (x - h) ** 2 + k;
    path.setAttribute("d", sampledPath(model.x_min, model.x_max, 128, curve, plot));
    setLine(axis, plot.x(h), plot.top, plot.x(h), plot.bottom);
    setPoint(vertex, plot.x(h), plot.y(k));
    const relation = a > 0 ? "最小值" : "最大值";
    context.status.textContent = `y = ${formatNumber(a)}(x ${h >= 0 ? "-" : "+"} ${formatNumber(Math.abs(h))})² ${k >= 0 ? "+" : "-"} ${formatNumber(Math.abs(k))}　${relation} ${formatNumber(k)}`;
  };
  createRange(context, { label: "开口大小 |a|", min: 0.25, max: 2.5, step: 0.25, value: magnitude, onInput(value, output) { magnitude = value; output.textContent = formatNumber(value); update(); } });
  createSelect(context, {
    label: "开口方向",
    value: opening,
    options: [{ value: "up", label: "向上" }, { value: "down", label: "向下" }],
    onChange(value) { opening = value; update(); }
  });
  createRange(context, { label: "对称轴 h", min: -4, max: 4, step: 0.25, value: h, onInput(value, output) { h = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "顶点 k", min: -5, max: 5, step: 0.25, value: k, onInput(value, output) { k = value; output.textContent = formatNumber(value); update(); } });
  update();
}

function renderNumberLine(context, model) {
  const svg = createSvg(context, "可交互的数轴");
  const left = 48;
  const right = 592;
  const y = 178;
  const toX = (value) => left + ((value - model.min) / (model.max - model.min)) * (right - left);
  svg.append(svgNode(context.doc, "line", { x1: left, y1: y, x2: right, y2: y, stroke: COLORS.ink, "stroke-width": 2 }));
  const tickCount = Math.min(20, Math.max(2, Math.round((model.max - model.min) / model.step)));
  for (let index = 0; index <= tickCount; index += 1) {
    const value = model.min + ((model.max - model.min) * index) / tickCount;
    const x = toX(value);
    svg.append(svgNode(context.doc, "line", { x1: x, y1: y - 7, x2: x, y2: y + 7, stroke: COLORS.muted, "stroke-width": 1 }));
    if (!context.compact || index % 2 === 0) svg.append(svgText(context.doc, x, y + 27, formatNumber(value), { "text-anchor": "middle", fill: COLORS.muted, "font-size": 11 }));
  }
  if (model.kind === "inequality_interval") {
    const interval = svgNode(context.doc, "line", { y1: y, y2: y, stroke: context.accent, "stroke-width": 8, "stroke-linecap": "round" });
    const arrow = svgNode(context.doc, "polygon", { fill: context.accent });
    const marker = svgNode(context.doc, "circle", { cy: y, r: 9, fill: "#ffffff", stroke: context.accent, "stroke-width": 3 });
    const label = svgText(context.doc, 0, y - 22, "", { "text-anchor": "middle", fill: context.accent, "font-size": 14, "font-weight": 700 });
    svg.append(interval, arrow, marker, label);
    let boundary = model.boundary;
    let direction = model.direction;
    let closed = model.closed;
    const update = () => {
      const x = toX(boundary);
      marker.setAttribute("cx", x);
      marker.setAttribute("fill", closed ? context.accent : "#ffffff");
      label.setAttribute("x", x);
      label.textContent = formatNumber(boundary);
      if (direction === "less") {
        setLine(interval, left + 10, y, x, y);
        arrow.setAttribute("points", `${left},${y} ${left + 16},${y - 10} ${left + 16},${y + 10}`);
      } else {
        setLine(interval, x, y, right - 10, y);
        arrow.setAttribute("points", `${right},${y} ${right - 16},${y - 10} ${right - 16},${y + 10}`);
      }
      context.status.textContent = `x ${direction === "less" ? (closed ? "≤" : "<") : (closed ? "≥" : ">")} ${formatNumber(boundary)}，${closed ? "包含" : "不包含"}边界值`;
    };
    createRange(context, { label: "边界值", min: model.min, max: model.max, step: model.step, value: boundary, onInput(value, output) { boundary = value; output.textContent = formatNumber(value); update(); } });
    createSelect(context, { label: "解集方向", value: direction, options: [{ value: "less", label: "小于" }, { value: "greater", label: "大于" }], onChange(value) { direction = value; update(); } });
    createToggle(context, { label: "包含边界值", value: closed, onChange(value) { closed = value; update(); } });
    update();
    return;
  }

  const markerA = svgNode(context.doc, "circle", { cy: y, r: 9, fill: context.accent, stroke: "#ffffff", "stroke-width": 3 });
  const markerB = svgNode(context.doc, "circle", { cy: y, r: 9, fill: COLORS.secondary, stroke: "#ffffff", "stroke-width": 3 });
  const labelA = svgText(context.doc, 0, y - 24, "", { "text-anchor": "middle", fill: context.accent, "font-size": 13, "font-weight": 700 });
  const labelB = svgText(context.doc, 0, y + 48, "", { "text-anchor": "middle", fill: COLORS.secondary, "font-size": 13, "font-weight": 700 });
  svg.append(markerA, markerB, labelA, labelB);
  let pointA = model.point_a;
  let pointB = model.point_b;
  const update = () => {
    const xA = toX(pointA);
    const xB = toX(pointB);
    setPoint(markerA, xA, y);
    setPoint(markerB, xB, y);
    setSvgText(labelA, xA, y - 24, `A ${formatNumber(pointA)}`);
    setSvgText(labelB, xB, y + 48, `B ${formatNumber(pointB)}`);
    const relation = pointA === pointB ? "=" : pointA < pointB ? "<" : ">";
    context.status.textContent = `A ${relation} B　两点距离 ${formatNumber(Math.abs(pointA - pointB))}`;
  };
  createRange(context, { label: "数 A", min: model.min, max: model.max, step: model.step, value: pointA, onInput(value, output) { pointA = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "数 B", min: model.min, max: model.max, step: model.step, value: pointB, onInput(value, output) { pointB = value; output.textContent = formatNumber(value); update(); } });
  update();
}

function renderTriangle(context, model) {
  const svg = createSvg(context, "可交互的三角形");
  const polygon = svgNode(context.doc, "polygon", { fill: toRgba(context.accent, 0.16), stroke: context.accent, "stroke-width": 3, "stroke-linejoin": "round" });
  const rightAngle = svgNode(context.doc, "polyline", { fill: "none", stroke: COLORS.secondary, "stroke-width": 2 });
  const aLabel = svgText(context.doc, 0, 0, "", { fill: COLORS.ink, "font-size": 14, "text-anchor": "end" });
  const bLabel = svgText(context.doc, 0, 0, "", { fill: COLORS.ink, "font-size": 14, "text-anchor": "middle" });
  const cLabel = svgText(context.doc, 0, 0, "", { fill: context.accent, "font-size": 14, "text-anchor": "middle", "font-weight": 700 });
  svg.append(polygon, rightAngle, aLabel, bLabel, cLabel);
  let a = model.a;
  let b = model.b;
  let angle = model.angle;
  const update = () => {
    const radians = (angle * Math.PI) / 180;
    const extentX = Math.max(b, a * Math.cos(radians), 1);
    const extentY = Math.max(a * Math.sin(radians), 1);
    const visualScale = Math.min(340 / extentX, 210 / extentY);
    const left = 145;
    const bottom = 292;
    const topX = left + a * Math.cos(radians) * visualScale;
    const topY = bottom - a * Math.sin(radians) * visualScale;
    const right = left + b * visualScale;
    const c = Math.sqrt(Math.max(0, a * a + b * b - 2 * a * b * Math.cos(radians)));
    polygon.setAttribute("points", `${left},${bottom} ${topX},${topY} ${right},${bottom}`);
    if (Math.abs(angle - 90) < 0.01) {
      rightAngle.setAttribute("visibility", "visible");
      rightAngle.setAttribute("points", `${left},${bottom - 18} ${left + 18},${bottom - 18} ${left + 18},${bottom}`);
    } else {
      rightAngle.setAttribute("visibility", "hidden");
    }
    setSvgText(aLabel, (left + topX) / 2 - 10, (topY + bottom) / 2 - 8, `a=${formatNumber(a)}`);
    setSvgText(bLabel, (left + right) / 2, bottom + 25, `b=${formatNumber(b)}`);
    setSvgText(cLabel, (topX + right) / 2 + 10, (topY + bottom) / 2 - 10, `c=${formatNumber(c)}`);
    const area = (a * b * Math.sin(radians)) / 2;
    context.status.textContent = `夹角 ${formatNumber(angle)}°　第三边 ${formatNumber(c)}　面积 ${formatNumber(area)}`;
  };
  createRange(context, { label: "边 a", min: 1, max: 12, step: 0.5, value: a, onInput(value, output) { a = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "边 b", min: 1, max: 12, step: 0.5, value: b, onInput(value, output) { b = value; output.textContent = formatNumber(value); update(); } });
  if (model.angle_control) {
    createRange(context, { label: "夹角", min: 20, max: 140, step: 5, value: angle, onInput(value, output) { angle = value; output.textContent = `${formatNumber(value)}°`; update(); } });
  }
  update();
}

function renderCircle(context, model) {
  const svg = createSvg(context, "可交互的圆与扇形");
  const circle = svgNode(context.doc, "circle", { cx: 320, cy: 178, fill: toRgba(context.accent, 0.1), stroke: context.accent, "stroke-width": 3 });
  const radiusLine = svgNode(context.doc, "line", { x1: 320, y1: 178, stroke: COLORS.secondary, "stroke-width": 3, "stroke-linecap": "round" });
  const sector = svgNode(context.doc, "path", { fill: toRgba(COLORS.secondary, 0.28), stroke: COLORS.secondary, "stroke-width": 1.5 });
  const center = svgNode(context.doc, "circle", { cx: 320, cy: 178, r: 4, fill: COLORS.ink });
  svg.append(circle, sector, radiusLine, center);
  let radius = model.radius;
  let angle = model.angle;
  const update = () => {
    const visualRadius = 48 + ((radius - 1) / 11) * 78;
    circle.setAttribute("r", visualRadius);
    const endX = 320 + visualRadius * Math.cos((-angle * Math.PI) / 180);
    const endY = 178 + visualRadius * Math.sin((-angle * Math.PI) / 180);
    setLine(radiusLine, 320, 178, endX, endY);
    sector.setAttribute("d", sectorPath(320, 178, visualRadius, angle));
    context.status.textContent = `周长 ${formatNumber(2 * Math.PI * radius)}　面积 ${formatNumber(Math.PI * radius * radius)}　扇形占比 ${formatNumber(angle / 360 * 100)}%`;
  };
  createRange(context, { label: "半径 r", min: 1, max: 12, step: 0.5, value: radius, onInput(value, output) { radius = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "圆心角", min: 15, max: 360, step: 15, value: angle, onInput(value, output) { angle = value; output.textContent = `${formatNumber(value)}°`; update(); } });
  update();
}

function renderCoordinate(context, model) {
  const { svg, plot } = createCoordinateStage(context, "可交互的平面直角坐标系", model);
  const pointNodes = model.points.map((point, index) => {
    const node = svgNode(context.doc, "circle", {
      r: index === 0 ? 6.5 : 5,
      fill: index === 0 ? context.accent : COLORS.secondary,
      stroke: "#ffffff",
      "stroke-width": 2
    });
    const label = svgText(context.doc, 0, 0, point.label, { fill: COLORS.ink, "font-size": 12 });
    svg.append(node, label);
    return { node, label, point: { ...point } };
  });
  let x = pointNodes[0].point.x;
  let y = pointNodes[0].point.y;
  let coefficient = model.coefficient;
  let deltaX = model.delta_x;
  let deltaY = model.delta_y;
  const update = () => {
    if (model.kind === "inverse_proportion_samples") {
      pointNodes.forEach((entry) => {
        entry.point.y = clamp(coefficient / entry.point.x, model.y_min, model.y_max);
      });
    } else {
      pointNodes[0].point.x = x;
      pointNodes[0].point.y = y;
      if (model.kind === "coordinate_transformation" && pointNodes[1]) {
        pointNodes[1].point.x = clamp(x + deltaX, model.x_min, model.x_max);
        pointNodes[1].point.y = clamp(y + deltaY, model.y_min, model.y_max);
      }
    }
    for (const entry of pointNodes) {
      const px = plot.x(entry.point.x);
      const py = plot.y(entry.point.y);
      setPoint(entry.node, px, py);
      setSvgText(entry.label, px + 9, py - 9, entry.point.label);
    }
    if (model.kind === "inverse_proportion_samples") {
      context.status.textContent = `y = ${formatNumber(coefficient)}/x　样本点分布在${coefficient > 0 ? "第一、三" : "第二、四"}象限`;
    } else if (model.kind === "coordinate_transformation" && pointNodes[1]) {
      context.status.textContent = `A (${formatNumber(x)}, ${formatNumber(y)}) → A′ (${formatNumber(pointNodes[1].point.x)}, ${formatNumber(pointNodes[1].point.y)})`;
    } else {
      context.status.textContent = `${pointNodes[0].point.label} (${formatNumber(x)}, ${formatNumber(y)})　距离原点 ${formatNumber(Math.hypot(x, y))}`;
    }
  };
  if (model.kind === "inverse_proportion_samples") {
    createRange(context, { label: "比例系数 k", min: -8, max: 8, step: 1, value: coefficient, onInput(value, output) { coefficient = Math.abs(value) < 0.01 ? 1 : value; output.textContent = formatNumber(coefficient); update(); } });
  } else {
    createRange(context, { label: "横坐标 x", min: model.x_min, max: model.x_max, step: 0.5, value: x, onInput(value, output) { x = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "纵坐标 y", min: model.y_min, max: model.y_max, step: 0.5, value: y, onInput(value, output) { y = value; output.textContent = formatNumber(value); update(); } });
    if (model.kind === "coordinate_transformation") {
      createRange(context, { label: "水平变化", min: -4, max: 4, step: 0.5, value: deltaX, onInput(value, output) { deltaX = value; output.textContent = formatNumber(value); update(); } });
      createRange(context, { label: "竖直变化", min: -4, max: 4, step: 0.5, value: deltaY, onInput(value, output) { deltaY = value; output.textContent = formatNumber(value); update(); } });
    }
  }
  update();
}

function renderStatistics(context, model) {
  const svg = createSvg(context, "可交互的数据统计图");
  const bars = [];
  const baseline = 300;
  const maxValue = Math.max(1, ...model.values);
  const gap = 10;
  const barWidth = Math.min(62, (520 - gap * (model.values.length - 1)) / model.values.length);
  const totalWidth = model.values.length * barWidth + (model.values.length - 1) * gap;
  const startX = (640 - totalWidth) / 2;
  model.values.forEach((value, index) => {
    const height = (value / maxValue) * 210;
    const x = startX + index * (barWidth + gap);
    const rect = svgNode(context.doc, "rect", { x, y: baseline - height, width: barWidth, height, rx: 7, fill: context.accent });
    const label = svgText(context.doc, x + barWidth / 2, baseline + 22, model.labels[index], { "text-anchor": "middle", fill: COLORS.muted, "font-size": 11 });
    const valueLabel = svgText(context.doc, x + barWidth / 2, baseline - height - 8, formatNumber(value), { "text-anchor": "middle", fill: COLORS.ink, "font-size": 11, "font-weight": 700 });
    svg.append(rect, label, valueLabel);
    bars.push(rect);
  });
  let count = model.values.length;
  const update = () => {
    bars.forEach((bar, index) => bar.setAttribute("opacity", index < count ? 0.94 : 0.18));
    const visible = model.values.slice(0, count);
    const average = visible.reduce((sum, value) => sum + value, 0) / visible.length;
    context.status.textContent = `前 ${count} 项　平均数 ${formatNumber(average)}　最大值 ${formatNumber(Math.max(...visible))}`;
  };
  createRange(context, { label: "纳入统计", min: 1, max: model.values.length, step: 1, value: count, onInput(value, output) { count = Math.round(value); output.textContent = `${count} 项`; update(); } });
  update();
}

function renderProbability(context, model) {
  const svg = createSvg(context, "可交互的等可能事件模型");
  const cells = [];
  const columns = Math.min(10, model.total);
  const rows = Math.ceil(model.total / columns);
  const size = Math.min(42, 420 / columns, 180 / rows);
  const startX = (640 - columns * size) / 2;
  const startY = (360 - rows * size) / 2;
  for (let index = 0; index < model.total; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cell = svgNode(context.doc, "rect", {
      x: startX + column * size + 2,
      y: startY + row * size + 2,
      width: size - 4,
      height: size - 4,
      rx: 7,
      stroke: "#ffffff",
      "stroke-width": 2
    });
    const valueLabel = svgText(context.doc, startX + column * size + size / 2, startY + row * size + size / 2 + 4, formatNumber(model.outcomes[index]), {
      "text-anchor": "middle",
      fill: COLORS.ink,
      "font-size": 11,
      "font-weight": 700
    });
    svg.append(cell, valueLabel);
    cells.push(cell);
  }
  if (model.mode === "count") {
    let favorable = model.favorable;
    const updateCount = () => {
      cells.forEach((cell, index) => cell.setAttribute("fill", index < favorable ? context.accent : COLORS.weak));
      context.status.textContent = `P = ${favorable}/${model.total} = ${formatNumber((favorable / model.total) * 100)}%`;
    };
    createRange(context, { label: "有利结果", min: 0, max: model.total, step: 1, value: favorable, onInput(value, output) { favorable = Math.round(value); output.textContent = `${favorable}/${model.total}`; updateCount(); } });
    updateCount();
    return;
  }

  let event = model.event;
  let trials = model.trials;
  const update = () => {
    const favorable = model.outcomes.filter((value) => outcomeMatches(value, event)).length;
    cells.forEach((cell, index) => cell.setAttribute("fill", outcomeMatches(model.outcomes[index], event) ? context.accent : COLORS.weak));
    const observed = deterministicObservedFrequency(model.outcomes, event, trials, model.deterministic_seed);
    context.status.textContent = `理论概率 ${favorable}/${model.total} = ${formatNumber((favorable / model.total) * 100)}%　${trials} 次试验频率 ${formatNumber(observed * 100)}%`;
  };
  createRange(context, { label: "试验次数", min: 10, max: 200, step: 10, value: trials, onInput(value, output) { trials = Math.round(value); output.textContent = `${trials} 次`; update(); } });
  createSelect(context, {
    label: "关注事件",
    value: event,
    options: [
      { value: "even", label: "偶数" },
      { value: "greater_than_four", label: "大于 4" },
      { value: "prime", label: "质数" }
    ],
    onChange(value) { event = value; update(); }
  });
  update();
}

function renderAlgebra(context, model) {
  const svg = createSvg(context, "可交互的代数等式天平");
  const pivotX = 320;
  const pivotY = 220;
  const beam = svgNode(context.doc, "line", { stroke: context.accent, "stroke-width": 7, "stroke-linecap": "round" });
  const pivot = svgNode(context.doc, "polygon", { points: `${pivotX},${pivotY} ${pivotX - 34},${pivotY + 70} ${pivotX + 34},${pivotY + 70}`, fill: COLORS.weak });
  const leftPan = svgNode(context.doc, "path", { fill: "none", stroke: COLORS.secondary, "stroke-width": 3 });
  const rightPan = svgNode(context.doc, "path", { fill: "none", stroke: COLORS.secondary, "stroke-width": 3 });
  const leftText = svgText(context.doc, 180, 118, "", { "text-anchor": "middle", fill: COLORS.ink, "font-size": 18, "font-weight": 700 });
  const rightText = svgText(context.doc, 460, 118, "", { "text-anchor": "middle", fill: COLORS.ink, "font-size": 18, "font-weight": 700 });
  svg.append(pivot, beam, leftPan, rightPan, leftText, rightText);
  let coefficientA = model.coefficient_a;
  let coefficientB = model.coefficient_b;
  let constant = model.constant;
  let stepIndex = model.step_index;
  const update = () => {
    const solution = (constant - coefficientB) / coefficientA;
    setLine(beam, 145, pivotY, 495, pivotY);
    leftPan.setAttribute("d", `M 115 ${pivotY + 55} Q 180 ${pivotY + 90} 245 ${pivotY + 55}`);
    rightPan.setAttribute("d", `M 395 ${pivotY + 55} Q 460 ${pivotY + 90} 525 ${pivotY + 55}`);
    const original = `${formatCoefficient(coefficientA, model.variable)}${formatSigned(coefficientB)} = ${formatNumber(constant)}`;
    const steps = [
      original,
      `${formatCoefficient(coefficientA, model.variable)} = ${formatNumber(constant - coefficientB)}`,
      `${model.variable} = ${formatNumber(constant - coefficientB)} ÷ ${formatNumber(coefficientA)}`,
      `${model.variable} = ${formatNumber(solution)} ✓`
    ];
    leftText.textContent = stepIndex === 0 ? `${formatCoefficient(coefficientA, model.variable)}${formatSigned(coefficientB)}` : steps[stepIndex];
    rightText.textContent = stepIndex === 0 ? formatNumber(constant) : "等价变形";
    context.status.textContent = `${original}　第 ${stepIndex + 1} 步：${steps[stepIndex]}`;
    context.status.style.color = stepIndex === 3 ? COLORS.success : COLORS.ink;
  };
  createRange(context, { label: "系数 a", min: -6, max: 6, step: 1, value: coefficientA, onInput(value, output) { coefficientA = Math.abs(value) < 0.01 ? 1 : value; output.textContent = formatNumber(coefficientA); update(); } });
  createRange(context, { label: "系数 b", min: -8, max: 8, step: 1, value: coefficientB, onInput(value, output) { coefficientB = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "常数 c", min: -10, max: 10, step: 1, value: constant, onInput(value, output) { constant = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "变形步骤", min: 0, max: 3, step: 1, value: stepIndex, onInput(value, output) { stepIndex = Math.round(value); output.textContent = `${stepIndex + 1}/4`; update(); } });
  update();
}

function renderConcept(context, model) {
  const svg = createSvg(context, "可交互的知识概念关系图");
  const centerX = 320;
  const centerY = 176;
  const visibleItems = model.items.slice(0, context.compact ? 5 : 8);
  const nodes = [];
  visibleItems.forEach((item, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / visibleItems.length;
    const x = centerX + Math.cos(angle) * (context.compact ? 155 : 185);
    const y = centerY + Math.sin(angle) * (context.compact ? 105 : 120);
    svg.append(svgNode(context.doc, "line", { x1: centerX, y1: centerY, x2: x, y2: y, stroke: COLORS.grid, "stroke-width": 2 }));
    const circle = svgNode(context.doc, "circle", { cx: x, cy: y, r: context.compact ? 28 : 34, fill: "#ffffff", stroke: COLORS.weak, "stroke-width": 2 });
    const label = svgText(context.doc, x, y + 4, truncateText(item, context.compact ? 7 : 10), { "text-anchor": "middle", fill: COLORS.ink, "font-size": context.compact ? 10 : 11 });
    svg.append(circle, label);
    nodes.push({ circle, item });
  });
  svg.append(svgNode(context.doc, "circle", { cx: centerX, cy: centerY, r: context.compact ? 45 : 54, fill: toRgba(context.accent, 0.14), stroke: context.accent, "stroke-width": 3 }));
  svg.append(svgText(context.doc, centerX, centerY + 4, truncateText(model.center, context.compact ? 9 : 12), { "text-anchor": "middle", fill: context.accent, "font-size": context.compact ? 12 : 13, "font-weight": 700 }));
  nodes.forEach((entry) => {
    const { item } = entry;
    const button = element(context.doc, "button", { type: "button" }, item);
    styleButton(button, context.accent, context.compact);
    context.controls.append(button);
    context.listen(button, "click", () => {
      nodes.forEach((candidate) => candidate.circle.setAttribute("stroke", candidate === entry ? context.accent : COLORS.weak));
      context.status.textContent = `${model.center}　→　${item}`;
    });
  });
  context.status.textContent = model.items.length ? `${model.center}：${model.items.join("、")}` : model.center;
}

function renderDedicatedAlgebra(context, model) {
  const svg = createSvg(context, `可交互的${dedicatedModelLabel(model.kind)}`);
  svg.setAttribute("data-dedicated-model", model.kind);
  const bands = [76, 158, 240].map((y, index) => {
    const rect = svgNode(context.doc, "rect", {
      x: index === 1 ? 72 : 104,
      y,
      width: index === 1 ? 496 : 432,
      height: 58,
      rx: 14,
      fill: index === 1 ? toRgba(context.accent, 0.14) : "#ffffff",
      stroke: index === 1 ? context.accent : COLORS.grid,
      "stroke-width": index === 1 ? 2 : 1.5
    });
    const textNode = svgText(context.doc, 320, y + 36, "", {
      "text-anchor": "middle",
      fill: index === 1 ? context.accent : COLORS.ink,
      "font-size": context.compact ? 16 : 19,
      "font-weight": index === 1 ? 750 : 650
    });
    svg.append(rect, textNode);
    return textNode;
  });
  svg.append(
    svgText(context.doc, 320, 62, dedicatedModelLabel(model.kind), {
      "text-anchor": "middle",
      fill: COLORS.muted,
      "font-size": 12,
      "font-weight": 700
    })
  );

  const updateBoard = (top, middle, bottom, status) => {
    bands[0].textContent = truncateText(top, context.compact ? 34 : 48);
    bands[1].textContent = truncateText(middle, context.compact ? 34 : 48);
    bands[2].textContent = truncateText(bottom, context.compact ? 34 : 48);
    context.status.textContent = status;
  };

  if (model.kind === "expression_builder") {
    let a = model.coefficient_a;
    let b = model.coefficient_b;
    let x = model.variable_value;
    const update = () => {
      const expression = `${formatCoefficient(a, model.variable)}${formatSigned(b)}` || "0";
      const result = a * x + b;
      updateBoard("系数 × 字母 ＋ 常数", expression, `${model.variable} = ${formatNumber(x)} 时，值为 ${formatCalculated(result)}`, `已组成 ${expression}；代入后得 ${formatCalculated(result)}`);
    };
    createRange(context, { label: "字母系数", min: -9, max: 9, step: 1, value: a, onInput(value, output) { a = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "常数项", min: -20, max: 20, step: 1, value: b, onInput(value, output) { b = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: `${model.variable} 的值`, min: -10, max: 10, step: 1, value: x, onInput(value, output) { x = value; output.textContent = formatNumber(value); update(); } });
    update();
    return;
  }

  if (model.kind === "formula_builder") {
    let formulaKind = model.formula_kind;
    let length = model.length;
    let width = model.width;
    let height = model.height;
    const update = () => {
      if (formulaKind === "triangle_area") {
        const result = length * height / 2;
        updateBoard("三角形面积 = 底 × 高 ÷ 2", `S = ${formatNumber(length)} × ${formatNumber(height)} ÷ 2`, `S = ${formatCalculated(result)}`, `底 ${formatNumber(length)}、高 ${formatNumber(height)}，面积为 ${formatCalculated(result)}`);
      } else if (formulaKind === "distance") {
        const result = length * height;
        updateBoard("路程 = 速度 × 时间", `s = ${formatNumber(length)} × ${formatNumber(height)}`, `s = ${formatCalculated(result)}`, `速度 ${formatNumber(length)}、时间 ${formatNumber(height)}，路程为 ${formatCalculated(result)}`);
      } else {
        const result = length * width;
        updateBoard("长方形面积 = 长 × 宽", `S = ${formatNumber(length)} × ${formatNumber(width)}`, `S = ${formatCalculated(result)}`, `长 ${formatNumber(length)}、宽 ${formatNumber(width)}，面积为 ${formatCalculated(result)}`);
      }
    };
    createSelect(context, {
      label: "公式类型",
      value: formulaKind,
      options: [
        { value: "rectangle_area", label: "长方形面积" },
        { value: "triangle_area", label: "三角形面积" },
        { value: "distance", label: "路程公式" }
      ],
      onChange(value) { formulaKind = value; update(); }
    });
    createRange(context, { label: "长 / 底 / 速度", min: 0.5, max: 20, step: 0.5, value: length, onInput(value, output) { length = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "宽", min: 0.5, max: 20, step: 0.5, value: width, onInput(value, output) { width = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "高 / 时间", min: 0.5, max: 20, step: 0.5, value: height, onInput(value, output) { height = value; output.textContent = formatNumber(value); update(); } });
    update();
    return;
  }

  if (model.kind === "substitution_evaluator") {
    let a = model.coefficient_a;
    let b = model.coefficient_b;
    let x = model.variable_value;
    const update = () => {
      const expression = `${formatCoefficient(a, model.variable)}${formatSigned(b)}` || "0";
      const result = a * x + b;
      updateBoard(expression, `${formatNumber(a)} × ${formatParenthesized(x)}${formatSigned(b)}`, formatCalculated(result), `把 ${model.variable} = ${formatNumber(x)} 代入 ${expression}，得 ${formatCalculated(result)}`);
    };
    createRange(context, { label: "系数 a", min: -9, max: 9, step: 1, value: a, onInput(value, output) { a = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "常数 b", min: -20, max: 20, step: 1, value: b, onInput(value, output) { b = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: `${model.variable} 的值`, min: -10, max: 10, step: 1, value: x, onInput(value, output) { x = value; output.textContent = formatNumber(value); update(); } });
    update();
    return;
  }

  if (model.kind === "exponent_laws") {
    let base = model.base;
    let m = model.exponent_m;
    let n = model.exponent_n;
    let operation = model.operation;
    const update = () => {
      if (operation === "divide") {
        const exponent = m - n;
        const result = base ** exponent;
        updateBoard(`${formatNumber(base)}^${m} ÷ ${formatNumber(base)}^${n}`, `${formatNumber(base)}^(${m}−${n}) = ${formatNumber(base)}^${exponent}`, formatCalculated(result), `同底数幂相除，指数相减：${m} − ${n} = ${exponent}`);
      } else if (operation === "power") {
        const exponent = m * n;
        const result = base ** exponent;
        updateBoard(`(${formatNumber(base)}^${m})^${n}`, `${formatNumber(base)}^(${m}×${n}) = ${formatNumber(base)}^${exponent}`, formatCalculated(result), `幂的乘方，指数相乘：${m} × ${n} = ${exponent}`);
      } else {
        const exponent = m + n;
        const result = base ** exponent;
        updateBoard(`${formatNumber(base)}^${m} × ${formatNumber(base)}^${n}`, `${formatNumber(base)}^(${m}+${n}) = ${formatNumber(base)}^${exponent}`, formatCalculated(result), `同底数幂相乘，指数相加：${m} + ${n} = ${exponent}`);
      }
    };
    createSelect(context, { label: "运算规则", value: operation, options: [{ value: "multiply", label: "同底数幂相乘" }, { value: "divide", label: "同底数幂相除" }, { value: "power", label: "幂的乘方" }], onChange(value) { operation = value; update(); } });
    createRange(context, { label: "底数", min: 1, max: 9, step: 1, value: base, onInput(value, output) { base = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "指数 m", min: 0, max: 6, step: 1, value: m, onInput(value, output) { m = Math.round(value); output.textContent = String(m); update(); } });
    createRange(context, { label: "指数 n", min: 0, max: 6, step: 1, value: n, onInput(value, output) { n = Math.round(value); output.textContent = String(n); update(); } });
    update();
    return;
  }

  if (model.kind === "scientific_notation") {
    let coefficient = model.coefficient;
    let exponent = model.exponent;
    const update = () => {
      const value = coefficient * (10 ** exponent);
      updateBoard(`${formatNumber(coefficient)} × 10^${exponent}`, `小数点${exponent >= 0 ? "向右" : "向左"}移动 ${Math.abs(exponent)} 位`, formatCalculated(value), `标准形 ${formatNumber(coefficient)} × 10^${exponent} = ${formatCalculated(value)}`);
    };
    createRange(context, { label: "有效数", min: -9.9, max: 9.9, step: 0.1, value: coefficient, onInput(value, output) { coefficient = Math.abs(value) < 1 ? (value < 0 ? -1 : 1) : value; output.textContent = formatNumber(coefficient); update(); } });
    createRange(context, { label: "10 的指数", min: -8, max: 8, step: 1, value: exponent, onInput(value, output) { exponent = Math.round(value); output.textContent = String(exponent); update(); } });
    update();
    return;
  }

  if (model.kind === "power_operations") {
    let base = model.base;
    let exponent = model.exponent;
    const update = () => {
      if (base === 0 && exponent === 0) exponent = 1;
      const result = base ** exponent;
      const expanded = exponent === 0 ? "1" : Array.from({ length: exponent }, () => formatParenthesized(base)).join(" × ");
      updateBoard(`${formatParenthesized(base)}^${exponent}`, expanded, formatCalculated(result), `${formatParenthesized(base)} 的 ${exponent} 次幂为 ${formatCalculated(result)}`);
    };
    createRange(context, { label: "底数", min: -9, max: 9, step: 1, value: base, onInput(value, output) { base = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "指数", min: 0, max: 8, step: 1, value: exponent, onInput(value, output) { exponent = Math.round(value); output.textContent = String(exponent); update(); } });
    update();
    return;
  }

  if (model.kind === "mixed_operations") {
    let a = model.operand_a;
    let b = model.operand_b;
    let c = model.operand_c;
    let pattern = model.pattern;
    const update = () => {
      const multiplyFirst = a + b * c;
      const parenthesesFirst = (a + b) * c;
      if (pattern === "parentheses_first") {
        updateBoard(`(${formatNumber(a)} + ${formatNumber(b)}) × ${formatNumber(c)}`, `${formatNumber(a + b)} × ${formatNumber(c)}`, formatCalculated(parenthesesFirst), `有括号先算括号，结果为 ${formatCalculated(parenthesesFirst)}`);
      } else {
        updateBoard(`${formatNumber(a)} + ${formatNumber(b)} × ${formatNumber(c)}`, `${formatNumber(a)} + ${formatNumber(b * c)}`, formatCalculated(multiplyFirst), `没有括号时先乘后加，结果为 ${formatCalculated(multiplyFirst)}`);
      }
    };
    createSelect(context, { label: "运算结构", value: pattern, options: [{ value: "multiply_first", label: "先乘后加" }, { value: "parentheses_first", label: "括号优先" }], onChange(value) { pattern = value; update(); } });
    createRange(context, { label: "数 a", min: -20, max: 20, step: 1, value: a, onInput(value, output) { a = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "数 b", min: -20, max: 20, step: 1, value: b, onInput(value, output) { b = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "数 c", min: -20, max: 20, step: 1, value: c, onInput(value, output) { c = value; output.textContent = formatNumber(value); update(); } });
    update();
    return;
  }

  if (model.kind === "operation_laws") {
    let a = model.operand_a;
    let b = model.operand_b;
    let c = model.operand_c;
    let law = model.law;
    const update = () => {
      if (law === "commutative") {
        updateBoard(`${formatNumber(a)} + ${formatNumber(b)}`, `${formatNumber(b)} + ${formatNumber(a)}`, `${formatCalculated(a + b)} = ${formatCalculated(b + a)}`, `加法交换律：交换两数位置，和不变`);
      } else if (law === "associative") {
        updateBoard(`(${formatNumber(a)} + ${formatNumber(b)}) + ${formatNumber(c)}`, `${formatNumber(a)} + (${formatNumber(b)} + ${formatNumber(c)})`, `${formatCalculated(a + b + c)} = ${formatCalculated(a + b + c)}`, `加法结合律：改变分组，和不变`);
      } else {
        updateBoard(`${formatNumber(a)} × (${formatNumber(b)} + ${formatNumber(c)})`, `${formatNumber(a)}×${formatNumber(b)} + ${formatNumber(a)}×${formatNumber(c)}`, `${formatCalculated(a * (b + c))} = ${formatCalculated(a * b + a * c)}`, `乘法分配律：括号外的数分别相乘`);
      }
    };
    createSelect(context, { label: "运算律", value: law, options: [{ value: "commutative", label: "交换律" }, { value: "associative", label: "结合律" }, { value: "distributive", label: "分配律" }], onChange(value) { law = value; update(); } });
    createRange(context, { label: "数 a", min: -12, max: 12, step: 1, value: a, onInput(value, output) { a = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "数 b", min: -12, max: 12, step: 1, value: b, onInput(value, output) { b = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "数 c", min: -12, max: 12, step: 1, value: c, onInput(value, output) { c = value; output.textContent = formatNumber(value); update(); } });
    update();
    return;
  }

  if (model.kind === "word_problem") {
    let scenario = model.scenario;
    let quantity = model.quantity;
    let unitPrice = model.unit_price;
    let paid = model.paid;
    const update = () => {
      const total = quantity * unitPrice;
      if (scenario === "change") {
        const change = paid - total;
        updateBoard(`买 ${quantity} 件，每件 ${formatNumber(unitPrice)} 元`, `付 ${formatNumber(paid)} 元 − 总价 ${formatCalculated(total)} 元`, `找零 ${formatCalculated(change)} 元`, `先求总价，再用付款减总价`);
      } else if (scenario === "rate") {
        const average = paid / quantity;
        updateBoard(`总量 ${formatNumber(paid)} 平均分成 ${quantity} 份`, `${formatNumber(paid)} ÷ ${quantity}`, `每份 ${formatCalculated(average)}`, `平均量 = 总量 ÷ 份数`);
      } else {
        updateBoard(`${quantity} 件 × 每件 ${formatNumber(unitPrice)} 元`, `${quantity} × ${formatNumber(unitPrice)}`, `总价 ${formatCalculated(total)} 元`, `总价 = 数量 × 单价`);
      }
    };
    createSelect(context, { label: "问题类型", value: scenario, options: [{ value: "total", label: "求总价" }, { value: "change", label: "求找零" }, { value: "rate", label: "求平均量" }], onChange(value) { scenario = value; update(); } });
    createRange(context, { label: "数量 / 份数", min: 1, max: 20, step: 1, value: quantity, onInput(value, output) { quantity = Math.round(value); output.textContent = String(quantity); update(); } });
    createRange(context, { label: "单价", min: 0.5, max: 100, step: 0.5, value: unitPrice, onInput(value, output) { unitPrice = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "付款 / 总量", min: 1, max: 500, step: 1, value: paid, onInput(value, output) { paid = value; output.textContent = formatNumber(value); update(); } });
    update();
    return;
  }

  if (model.kind === "square_root_inverse") {
    let root = model.root;
    const update = () => {
      const radicand = root ** 2;
      updateBoard(`${formatNumber(root)}^2 = ${formatCalculated(radicand)}`, `√${formatCalculated(radicand)} = ${formatNumber(root)}`, `平方 ⇄ 算术平方根`, `在非负数范围内，平方与算术平方根互为逆运算`);
    };
    createRange(context, { label: "算术平方根", min: 0, max: 20, step: 0.5, value: root, onInput(value, output) { root = value; output.textContent = formatNumber(value); update(); } });
    update();
    return;
  }

  let radicandA = model.radicand_a;
  let radicandB = model.radicand_b;
  let radicalOperation = model.operation;
  const updateRadicals = () => {
    if (radicalOperation === "divide") {
      const quotient = radicandA / radicandB;
      updateBoard(`√${radicandA} ÷ √${radicandB}`, `√(${radicandA}/${radicandB})`, formatCalculated(Math.sqrt(quotient)), `被开方数均为非负数，且除数不为 0`);
    } else {
      const product = radicandA * radicandB;
      updateBoard(`√${radicandA} × √${radicandB}`, `√(${radicandA}×${radicandB}) = √${product}`, formatCalculated(Math.sqrt(product)), `积的算术平方根等于各因式算术平方根的积`);
    }
  };
  createSelect(context, { label: "根式运算", value: radicalOperation, options: [{ value: "multiply", label: "乘法" }, { value: "divide", label: "除法" }], onChange(value) { radicalOperation = value; updateRadicals(); } });
  createRange(context, { label: "被开方数 a", min: 1, max: 100, step: 1, value: radicandA, onInput(value, output) { radicandA = Math.round(value); output.textContent = String(radicandA); updateRadicals(); } });
  createRange(context, { label: "被开方数 b", min: 1, max: 100, step: 1, value: radicandB, onInput(value, output) { radicandB = Math.round(value); output.textContent = String(radicandB); updateRadicals(); } });
  updateRadicals();
}

function renderDedicatedTransform(context, model) {
  const { svg, plot } = createCoordinateStage(context, `可交互的${dedicatedModelLabel(model.kind)}`, model);
  svg.setAttribute("data-dedicated-model", model.kind);
  const axisGuide = svgNode(context.doc, "line", { stroke: context.accent, "stroke-width": 4, "stroke-dasharray": "8 7", opacity: 0.45 });
  const routeA = svgNode(context.doc, "line", { stroke: COLORS.secondary, "stroke-width": 2.5, "stroke-dasharray": "6 5" });
  const routeB = svgNode(context.doc, "line", { stroke: context.accent, "stroke-width": 2.5, "stroke-dasharray": "6 5" });
  const centerNode = svgNode(context.doc, "circle", { r: 5, fill: COLORS.ink, stroke: "#ffffff", "stroke-width": 2 });
  const centerLabel = svgText(context.doc, 0, 0, "C", { fill: COLORS.ink, "font-size": 12, "font-weight": 700 });
  const pointA = svgNode(context.doc, "circle", { r: 7, fill: COLORS.secondary, stroke: "#ffffff", "stroke-width": 2 });
  const pointB = svgNode(context.doc, "circle", { r: 6, fill: COLORS.weak, stroke: "#ffffff", "stroke-width": 2 });
  const pointPrime = svgNode(context.doc, "circle", { r: 8, fill: context.accent, stroke: "#ffffff", "stroke-width": 2 });
  const labelA = svgText(context.doc, 0, 0, "A", { fill: COLORS.secondary, "font-size": 13, "font-weight": 750 });
  const labelB = svgText(context.doc, 0, 0, "B", { fill: COLORS.muted, "font-size": 12, "font-weight": 700 });
  const labelPrime = svgText(context.doc, 0, 0, "A′", { fill: context.accent, "font-size": 13, "font-weight": 750 });
  svg.append(axisGuide, routeA, routeB, centerNode, centerLabel, pointA, pointB, pointPrime, labelA, labelB, labelPrime);

  let x = model.point_x;
  let y = model.point_y;
  let centerX = model.center_x;
  let centerY = model.center_y;
  let axis = model.axis || "x";
  let angle = model.angle || 90;
  let deltaX = model.delta_x || 0;
  let deltaY = model.delta_y || 0;
  let scale = model.scale || 1.5;

  const place = (node, label, point, text) => {
    const boundedX = clamp(point.x, model.x_min, model.x_max);
    const boundedY = clamp(point.y, model.y_min, model.y_max);
    const px = plot.x(boundedX);
    const py = plot.y(boundedY);
    setPoint(node, px, py);
    setSvgText(label, px + 10, py - 10, text);
    return { x: px, y: py };
  };

  const update = () => {
    const original = { x, y };
    let intermediate = { ...original };
    let transformed = { ...original };
    let explanation = "";
    if (model.kind === "axis_reflection") {
      transformed = axis === "x" ? { x, y: -y } : { x: -x, y };
      explanation = `关于 ${axis === "x" ? "x" : "y"} 轴对称`;
    } else if (model.kind === "rotation") {
      const radians = angle * Math.PI / 180;
      const dx = x - centerX;
      const dy = y - centerY;
      transformed = {
        x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
        y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians)
      };
      explanation = `绕 C 逆时针旋转 ${angle}°`;
    } else if (model.kind === "central_symmetry") {
      transformed = { x: 2 * centerX - x, y: 2 * centerY - y };
      explanation = "关于中心 C 中心对称";
    } else if (model.kind === "transform_composition") {
      intermediate = { x: x + deltaX, y: y + deltaY };
      transformed = axis === "x" ? { x: intermediate.x, y: -intermediate.y } : { x: -intermediate.x, y: intermediate.y };
      explanation = `先平移 (${formatNumber(deltaX)}, ${formatNumber(deltaY)})，再关于 ${axis} 轴对称`;
    } else {
      transformed = { x: centerX + scale * (x - centerX), y: centerY + scale * (y - centerY) };
      explanation = `以 C 为中心，按 ${formatNumber(scale)} 倍位似`;
    }

    const aPosition = place(pointA, labelA, original, "A");
    const primePosition = place(pointPrime, labelPrime, transformed, "A′");
    const bPosition = place(pointB, labelB, intermediate, "B");
    const centerPosition = place(centerNode, centerLabel, { x: centerX, y: centerY }, "C");
    setLine(routeA, aPosition.x, aPosition.y, model.kind === "transform_composition" ? bPosition.x : primePosition.x, model.kind === "transform_composition" ? bPosition.y : primePosition.y);
    setLine(routeB, bPosition.x, bPosition.y, primePosition.x, primePosition.y);
    pointB.setAttribute("visibility", model.kind === "transform_composition" ? "visible" : "hidden");
    labelB.setAttribute("visibility", model.kind === "transform_composition" ? "visible" : "hidden");
    routeB.setAttribute("visibility", model.kind === "transform_composition" ? "visible" : "hidden");
    const usesCenter = ["rotation", "central_symmetry", "dilation"].includes(model.kind);
    centerNode.setAttribute("visibility", usesCenter ? "visible" : "hidden");
    centerLabel.setAttribute("visibility", usesCenter ? "visible" : "hidden");
    if (model.kind === "axis_reflection" || model.kind === "transform_composition") {
      if (axis === "x") setLine(axisGuide, plot.left, plot.y(0), plot.right, plot.y(0));
      else setLine(axisGuide, plot.x(0), plot.top, plot.x(0), plot.bottom);
      axisGuide.setAttribute("visibility", "visible");
    } else {
      axisGuide.setAttribute("visibility", "hidden");
    }
    context.status.textContent = `${explanation}：A (${formatNumber(x)}, ${formatNumber(y)}) → A′ (${formatNumber(transformed.x)}, ${formatNumber(transformed.y)})`;
    void centerPosition;
  };

  createRange(context, { label: "A 的横坐标", min: Math.max(model.x_min, -6), max: Math.min(model.x_max, 6), step: 0.5, value: x, onInput(value, output) { x = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "A 的纵坐标", min: Math.max(model.y_min, -6), max: Math.min(model.y_max, 6), step: 0.5, value: y, onInput(value, output) { y = value; output.textContent = formatNumber(value); update(); } });
  if (model.kind === "axis_reflection") {
    createSelect(context, { label: "对称轴", value: axis, options: [{ value: "x", label: "x 轴" }, { value: "y", label: "y 轴" }], onChange(value) { axis = value; update(); } });
  } else if (model.kind === "rotation") {
    createRange(context, { label: "旋转中心 x", min: -4, max: 4, step: 0.5, value: centerX, onInput(value, output) { centerX = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "旋转中心 y", min: -4, max: 4, step: 0.5, value: centerY, onInput(value, output) { centerY = value; output.textContent = formatNumber(value); update(); } });
    createSelect(context, { label: "旋转角", value: String(angle), options: [{ value: "90", label: "90°" }, { value: "180", label: "180°" }, { value: "270", label: "270°" }], onChange(value) { angle = Number(value); update(); } });
  } else if (model.kind === "central_symmetry") {
    createRange(context, { label: "对称中心 x", min: -4, max: 4, step: 0.5, value: centerX, onInput(value, output) { centerX = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "对称中心 y", min: -4, max: 4, step: 0.5, value: centerY, onInput(value, output) { centerY = value; output.textContent = formatNumber(value); update(); } });
  } else if (model.kind === "transform_composition") {
    createRange(context, { label: "水平平移", min: -4, max: 4, step: 0.5, value: deltaX, onInput(value, output) { deltaX = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "竖直平移", min: -4, max: 4, step: 0.5, value: deltaY, onInput(value, output) { deltaY = value; output.textContent = formatNumber(value); update(); } });
    createSelect(context, { label: "第二步对称轴", value: axis, options: [{ value: "x", label: "x 轴" }, { value: "y", label: "y 轴" }], onChange(value) { axis = value; update(); } });
  } else {
    createRange(context, { label: "位似中心 x", min: -4, max: 4, step: 0.5, value: centerX, onInput(value, output) { centerX = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "位似中心 y", min: -4, max: 4, step: 0.5, value: centerY, onInput(value, output) { centerY = value; output.textContent = formatNumber(value); update(); } });
    createRange(context, { label: "位似比", min: 0.25, max: 3, step: 0.25, value: scale, onInput(value, output) { scale = value; output.textContent = formatNumber(value); update(); } });
  }
  update();
}

function renderDedicatedSpatial(context, model) {
  if (model.kind === "projection_rays") {
    renderProjectionRays(context, model);
    return;
  }
  if (model.kind === "orthographic_views") {
    renderOrthographicViews(context, model);
    return;
  }
  renderSolidNet(context, model);
}

function renderProjectionRays(context, model) {
  const svg = createSvg(context, "可交互的投影光线");
  svg.setAttribute("data-dedicated-model", model.kind);
  const plot = createPlot(-6, 9, -1, 9);
  const ground = svgNode(context.doc, "line", { stroke: COLORS.muted, "stroke-width": 2 });
  const screen = svgNode(context.doc, "line", { stroke: context.accent, "stroke-width": 5 });
  const object = svgNode(context.doc, "line", { stroke: COLORS.ink, "stroke-width": 8, "stroke-linecap": "round" });
  const rayTop = svgNode(context.doc, "line", { stroke: COLORS.secondary, "stroke-width": 2.5, "stroke-dasharray": "7 5" });
  const rayBottom = svgNode(context.doc, "line", { stroke: COLORS.secondary, "stroke-width": 2.5, "stroke-dasharray": "7 5" });
  const shadow = svgNode(context.doc, "line", { stroke: context.accent, "stroke-width": 10, "stroke-linecap": "round", opacity: 0.65 });
  const light = svgNode(context.doc, "circle", { r: 11, fill: "#f4b64f", stroke: "#ffffff", "stroke-width": 3 });
  const lightLabel = svgText(context.doc, 0, 0, "光源", { fill: COLORS.ink, "font-size": 12, "font-weight": 700 });
  const objectLabel = svgText(context.doc, 0, 0, "物体", { fill: COLORS.ink, "font-size": 12, "font-weight": 700 });
  const screenLabel = svgText(context.doc, 0, 0, "投影屏", { fill: context.accent, "font-size": 12, "font-weight": 700 });
  svg.append(ground, screen, shadow, rayTop, rayBottom, object, light, lightLabel, objectLabel, screenLabel);
  let lightY = model.light_y;
  let objectX = model.object_x;
  let objectHeight = model.object_height;
  const update = () => {
    const lightPoint = { x: model.light_x, y: lightY };
    const top = { x: objectX, y: objectHeight };
    const bottom = { x: objectX, y: 0 };
    const ratio = (model.screen_x - lightPoint.x) / Math.max(0.5, objectX - lightPoint.x);
    const shadowTop = lightPoint.y + (top.y - lightPoint.y) * ratio;
    const shadowBottom = lightPoint.y + (bottom.y - lightPoint.y) * ratio;
    const groundY = plot.y(0);
    setLine(ground, plot.left, groundY, plot.right, groundY);
    setLine(screen, plot.x(model.screen_x), plot.top, plot.x(model.screen_x), plot.bottom);
    setLine(object, plot.x(objectX), plot.y(0), plot.x(objectX), plot.y(objectHeight));
    setLine(rayTop, plot.x(lightPoint.x), plot.y(lightPoint.y), plot.x(model.screen_x), plot.y(clamp(shadowTop, -1, 9)));
    setLine(rayBottom, plot.x(lightPoint.x), plot.y(lightPoint.y), plot.x(model.screen_x), plot.y(clamp(shadowBottom, -1, 9)));
    setLine(shadow, plot.x(model.screen_x), plot.y(clamp(shadowBottom, -1, 9)), plot.x(model.screen_x), plot.y(clamp(shadowTop, -1, 9)));
    setPoint(light, plot.x(lightPoint.x), plot.y(lightPoint.y));
    setSvgText(lightLabel, plot.x(lightPoint.x) + 15, plot.y(lightPoint.y) - 12, "光源");
    setSvgText(objectLabel, plot.x(objectX), plot.y(objectHeight) - 12, "物体");
    setSvgText(screenLabel, plot.x(model.screen_x) - 8, plot.top + 18, "投影屏");
    context.status.textContent = `相似三角形确定投影：屏上高度约 ${formatNumber(Math.abs(shadowTop - shadowBottom))}`;
  };
  createRange(context, { label: "光源高度", min: 2, max: 9, step: 0.5, value: lightY, onInput(value, output) { lightY = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "物体位置", min: -0.5, max: 3, step: 0.5, value: objectX, onInput(value, output) { objectX = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "物体高度", min: 0.5, max: 6, step: 0.5, value: objectHeight, onInput(value, output) { objectHeight = value; output.textContent = formatNumber(value); update(); } });
  update();
}

function renderOrthographicViews(context, model) {
  const svg = createSvg(context, "可交互的三视图");
  svg.setAttribute("data-dedicated-model", model.kind);
  const cuboid = svgNode(context.doc, "g");
  const front = svgNode(context.doc, "rect", { rx: 4 });
  const top = svgNode(context.doc, "polygon");
  const side = svgNode(context.doc, "polygon");
  cuboid.append(top, side, front);
  const viewRects = ["front", "top", "side"].map((view, index) => {
    const box = svgNode(context.doc, "rect", { x: 358 + index * 88, y: 224, width: 72, height: 72, rx: 8, fill: "#ffffff", stroke: COLORS.grid, "stroke-width": 2 });
    const shape = svgNode(context.doc, "rect", { fill: toRgba(context.accent, 0.16), stroke: context.accent, "stroke-width": 2 });
    const label = svgText(context.doc, 394 + index * 88, 320, { front: "主视图", top: "俯视图", side: "左视图" }[view], { "text-anchor": "middle", fill: COLORS.muted, "font-size": 11 });
    svg.append(box, shape, label);
    return { view, box, shape };
  });
  svg.append(cuboid);
  let length = model.length;
  let width = model.width;
  let height = model.height;
  let activeView = model.active_view;
  const update = () => {
    const l = 80 + length * 9;
    const w = 28 + width * 5;
    const h = 70 + height * 8;
    const x = 88;
    const y = 252;
    setAttributes(front, { x, y: y - h, width: l, height: h, fill: toRgba(context.accent, 0.16), stroke: context.accent, "stroke-width": 3 });
    top.setAttribute("points", `${x},${y - h} ${x + w},${y - h - w * 0.55} ${x + l + w},${y - h - w * 0.55} ${x + l},${y - h}`);
    setAttributes(top, { fill: toRgba(COLORS.secondary, 0.2), stroke: COLORS.secondary, "stroke-width": 2.5 });
    side.setAttribute("points", `${x + l},${y - h} ${x + l + w},${y - h - w * 0.55} ${x + l + w},${y - w * 0.55} ${x + l},${y}`);
    setAttributes(side, { fill: toRgba(context.accent, 0.28), stroke: context.accent, "stroke-width": 2.5 });
    viewRects.forEach(({ view, box, shape }, index) => {
      const dimensions = view === "front" ? [length, height] : view === "top" ? [length, width] : [width, height];
      const maxDimension = Math.max(...dimensions, 1);
      const shapeWidth = 54 * dimensions[0] / maxDimension;
      const shapeHeight = 54 * dimensions[1] / maxDimension;
      const centerX = 394 + index * 88;
      setAttributes(shape, { x: centerX - shapeWidth / 2, y: 260 - shapeHeight / 2, width: shapeWidth, height: shapeHeight });
      box.setAttribute("stroke", view === activeView ? context.accent : COLORS.grid);
      box.setAttribute("stroke-width", view === activeView ? 4 : 2);
    });
    const dimensions = activeView === "front" ? `${formatNumber(length)} × ${formatNumber(height)}` : activeView === "top" ? `${formatNumber(length)} × ${formatNumber(width)}` : `${formatNumber(width)} × ${formatNumber(height)}`;
    context.status.textContent = `${{ front: "主视图", top: "俯视图", side: "左视图" }[activeView]}尺寸：${dimensions}`;
  };
  createSelect(context, { label: "观察方向", value: activeView, options: [{ value: "front", label: "主视图" }, { value: "top", label: "俯视图" }, { value: "side", label: "左视图" }], onChange(value) { activeView = value; update(); } });
  createRange(context, { label: "长", min: 1, max: 10, step: 1, value: length, onInput(value, output) { length = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "宽", min: 1, max: 10, step: 1, value: width, onInput(value, output) { width = value; output.textContent = formatNumber(value); update(); } });
  createRange(context, { label: "高", min: 1, max: 10, step: 1, value: height, onInput(value, output) { height = value; output.textContent = formatNumber(value); update(); } });
  update();
}

function renderSolidNet(context, model) {
  const svg = createSvg(context, "可交互的几何体展开图");
  svg.setAttribute("data-dedicated-model", model.kind);
  const group = svgNode(context.doc, "g");
  svg.append(group);
  let solid = model.solid;
  let progress = model.fold_progress;
  const update = () => {
    group.replaceChildren();
    const opacity = 1 - progress * 0.42;
    if (solid === "triangular_prism") {
      const size = 72;
      for (let index = 0; index < 3; index += 1) {
        group.append(svgNode(context.doc, "rect", { x: 178 + index * size, y: 140, width: size, height: 100 - progress * 20, fill: toRgba(context.accent, 0.16 + index * 0.05), stroke: context.accent, "stroke-width": 2.5, opacity }));
      }
      const lift = progress * 42;
      group.append(
        svgNode(context.doc, "polygon", { points: `178,140 214,${82 + lift} 250,140`, fill: toRgba(COLORS.secondary, 0.3), stroke: COLORS.secondary, "stroke-width": 2.5 }),
        svgNode(context.doc, "polygon", { points: `394,140 430,${82 + lift} 466,140`, fill: toRgba(COLORS.secondary, 0.3), stroke: COLORS.secondary, "stroke-width": 2.5 })
      );
    } else {
      const size = 66;
      const baseX = 221;
      const baseY = 130;
      const faces = [[1, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2]];
      faces.forEach(([column, row], index) => {
        const towardCenterX = (1 - column) * progress * 24;
        const towardCenterY = (1 - row) * progress * 24;
        group.append(svgNode(context.doc, "rect", {
          x: baseX + column * size + towardCenterX,
          y: baseY + row * size + towardCenterY,
          width: size * (1 - progress * (index % 2 ? 0.08 : 0.16)),
          height: size * (1 - progress * (index % 2 ? 0.16 : 0.08)),
          rx: 4,
          fill: index === 2 ? toRgba(COLORS.secondary, 0.3) : toRgba(context.accent, 0.16 + index * 0.025),
          stroke: index === 2 ? COLORS.secondary : context.accent,
          "stroke-width": 2.5,
          opacity
        }));
      });
    }
    context.status.textContent = `${solid === "cube" ? "正方体" : "三棱柱"}：${progress < 0.05 ? "完全展开" : progress > 0.95 ? "接近折叠成型" : `折叠进度 ${formatNumber(progress * 100)}%`}`;
  };
  createSelect(context, { label: "几何体", value: solid, options: [{ value: "cube", label: "正方体" }, { value: "triangular_prism", label: "三棱柱" }], onChange(value) { solid = value; update(); } });
  createRange(context, { label: "折叠进度", min: 0, max: 1, step: 0.05, value: progress, onInput(value, output) { progress = value; output.textContent = `${formatNumber(value * 100)}%`; update(); } });
  update();
}

function createCoordinateStage(context, ariaLabel, model) {
  const svg = createSvg(context, ariaLabel);
  const plot = createPlot(model.x_min, model.x_max, model.y_min, model.y_max);
  const gridGroup = svgNode(context.doc, "g", { "aria-hidden": "true" });
  for (let index = 0; index <= 10; index += 1) {
    const x = plot.left + ((plot.right - plot.left) * index) / 10;
    const y = plot.top + ((plot.bottom - plot.top) * index) / 10;
    gridGroup.append(
      svgNode(context.doc, "line", { x1: x, y1: plot.top, x2: x, y2: plot.bottom, stroke: COLORS.grid, "stroke-width": 1 }),
      svgNode(context.doc, "line", { x1: plot.left, y1: y, x2: plot.right, y2: y, stroke: COLORS.grid, "stroke-width": 1 })
    );
  }
  const xAxisY = clamp(plot.y(0), plot.top, plot.bottom);
  const yAxisX = clamp(plot.x(0), plot.left, plot.right);
  gridGroup.append(
    svgNode(context.doc, "line", { x1: plot.left, y1: xAxisY, x2: plot.right, y2: xAxisY, stroke: COLORS.muted, "stroke-width": 1.8 }),
    svgNode(context.doc, "line", { x1: yAxisX, y1: plot.top, x2: yAxisX, y2: plot.bottom, stroke: COLORS.muted, "stroke-width": 1.8 })
  );
  svg.append(gridGroup);
  return { svg, plot };
}

function createSvg(context, ariaLabel) {
  const svg = svgNode(context.doc, "svg", {
    viewBox: "0 0 640 360",
    role: "img",
    "aria-label": ariaLabel,
    preserveAspectRatio: "xMidYMid meet"
  });
  style(svg, { display: "block", width: "100%", height: "100%", minHeight: context.compact ? "178px" : "260px" });
  context.stage.append(svg);
  return svg;
}

function createRange(context, { label, min, max, step, value, onInput }) {
  const wrapper = element(context.doc, "label");
  style(wrapper, { display: "grid", gap: "4px", minWidth: "0", color: COLORS.muted, fontSize: context.compact ? "10px" : "11px" });
  const row = element(context.doc, "span");
  style(row, { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" });
  const name = element(context.doc, "span", {}, label);
  const output = element(context.doc, "output", {}, formatNumber(value));
  style(output, { color: context.accent, fontWeight: "700", fontVariantNumeric: "tabular-nums" });
  const input = element(context.doc, "input", { type: "range", min, max, step, value, "aria-label": label });
  input.value = String(value);
  style(input, { width: "100%", accentColor: context.accent });
  row.append(name, output);
  wrapper.append(row, input);
  context.controls.append(wrapper);
  const handler = () => onInput(clampNumber(input.value, value, Number(min), Number(max)), output);
  context.listen(input, "input", handler);
  onInput(Number(value), output);
  return input;
}

function createSelect(context, { label, value, options, onChange }) {
  const wrapper = element(context.doc, "label");
  style(wrapper, { display: "grid", gap: "4px", minWidth: "0", color: COLORS.muted, fontSize: context.compact ? "10px" : "11px" });
  wrapper.append(element(context.doc, "span", {}, label));
  const select = element(context.doc, "select", { "aria-label": label });
  style(select, {
    width: "100%",
    boxSizing: "border-box",
    padding: context.compact ? "5px 7px" : "7px 8px",
    border: "1px solid #dce4ef",
    borderRadius: "8px",
    background: "#ffffff",
    color: COLORS.ink,
    fontSize: context.compact ? "10px" : "11px"
  });
  for (const option of options) {
    const node = element(context.doc, "option", { value: option.value }, option.label);
    select.append(node);
  }
  select.value = String(value);
  wrapper.append(select);
  context.controls.append(wrapper);
  const allowed = new Set(options.map((option) => option.value));
  context.listen(select, "change", () => {
    if (allowed.has(select.value)) onChange(select.value);
  });
  return select;
}

function createToggle(context, { label, value, onChange }) {
  const wrapper = element(context.doc, "label");
  style(wrapper, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    color: COLORS.muted,
    fontSize: context.compact ? "10px" : "11px"
  });
  const input = element(context.doc, "input", { type: "checkbox", "aria-label": label });
  input.checked = Boolean(value);
  style(input, { accentColor: context.accent });
  wrapper.append(element(context.doc, "span", {}, label), input);
  context.controls.append(wrapper);
  context.listen(input, "change", () => onChange(Boolean(input.checked)));
  return input;
}

function normalizeModel(variant, source) {
  const ranges = normalizeRanges(source);
  const kind = safeModelKind(source.model);
  if (DEDICATED_MODEL_KINDS.has(kind)) return normalizeDedicatedModel(kind, source);
  if (variant === "linear") {
    return { kind: kind || "linear_slope_intercept", ...ranges, slope: numericParam(source, ["slope", "k"], 1.5, -5, 5), intercept: numericParam(source, ["intercept", "b"], 0, -6, 6) };
  }
  if (variant === "quadratic") {
    let magnitude = Math.abs(numericParam(source, ["a_magnitude", "a", "coefficient"], 0.5, -2.5, 2.5));
    if (magnitude < 0.01) magnitude = 0.5;
    const directA = Number(getParam(source, ["a", "coefficient"]));
    const opening = safeChoice(
      getParam(source, ["opening"]),
      ["up", "down"],
      Number.isFinite(directA) && directA < 0 ? "down" : "up"
    );
    return {
      kind: kind || "quadratic_vertex_form",
      ...ranges,
      magnitude,
      opening,
      a: opening === "down" ? -magnitude : magnitude,
      h: numericParam(source, ["vertex_x", "h", "axis"], 0, -4, 4),
      k: numericParam(source, ["vertex_y", "k"], 0, -5, 5)
    };
  }
  if (variant === "numberline") {
    const min = numericParam(source, ["min", "minimum"], -6, -100, 99);
    const max = Math.max(min + 1, numericParam(source, ["max", "maximum"], 6, min + 1, 100));
    const step = numericParam(source, ["step", "tick_step"], 1, 0.1, Math.max(0.1, (max - min) / 2));
    if (kind === "inequality_interval" || hasParam(source, ["boundary"])) {
      return {
        kind: "inequality_interval",
        min,
        max,
        step,
        boundary: numericParam(source, ["boundary", "value"], 2, min, max),
        direction: safeChoice(getParam(source, ["direction"]), ["less", "greater"], "greater"),
        closed: safeBoolean(getParam(source, ["closed"]), false)
      };
    }
    return {
      kind: "ordered_points",
      min,
      max,
      step,
      point_a: numericParam(source, ["point_a", "value", "initial"], -2, min, max),
      point_b: numericParam(source, ["point_b", "comparison_value"], 3, min, max)
    };
  }
  if (variant === "triangle") {
    const base = numericParam(source, ["base"], 4, 1, 12);
    const scale = numericParam(source, ["scale"], 1.5, 0.5, 3);
    const a = numericParam(source, ["side_a", "leg_a", "a", "base"], base, 1, 12);
    const bFallback = kind === "similar_triangles" ? base * scale : 4;
    const b = numericParam(source, ["side_b", "leg_b", "b", "height"], bFallback, 1, 12);
    const angle = kind === "right_triangle"
      ? 90
      : numericParam(source, ["included_angle", "angle"], 60, 20, 140);
    return {
      kind: kind || "general_triangle",
      a,
      b,
      angle,
      scale,
      angle_control: hasParam(source, ["included_angle", "angle"])
    };
  }
  if (variant === "circle") {
    return {
      kind: kind || "circle_elements",
      radius: numericParam(source, ["radius", "r"], 3, 1, 12),
      angle: numericParam(source, ["central_angle", "angle", "degrees"], 90, 15, 360),
      point_distance: numericParam(source, ["point_distance"], 3, 0, 12)
    };
  }
  if (variant === "coordinate") {
    return normalizeCoordinate(source, ranges, kind);
  }
  if (variant === "statistics") return normalizeStatistics(source);
  if (variant === "probability") return normalizeProbability(source, kind);
  if (variant === "algebra") return normalizeAlgebra(source, kind);
  return normalizeConcept(source);
}

function normalizeDedicatedModel(kind, source) {
  const variable = safeVariable(getParam(source, ["variable", "symbol"]));
  if (kind === "expression_builder") {
    return {
      kind,
      variable,
      coefficient_a: numericParam(source, ["coefficient_a", "coefficient", "a"], 2, -9, 9),
      coefficient_b: numericParam(source, ["coefficient_b", "constant", "b"], 3, -20, 20),
      variable_value: numericParam(source, ["variable_value", "x", "value"], 2, -10, 10)
    };
  }
  if (kind === "formula_builder") {
    return {
      kind,
      formula_kind: normalizeFormulaKind(getParam(source, ["formula_kind", "formula", "shape"])),
      length: numericParam(source, ["length", "base", "distance"], 6, 0.5, 20),
      width: numericParam(source, ["width"], 4, 0.5, 20),
      height: numericParam(source, ["height", "time"], 3, 0.5, 20)
    };
  }
  if (kind === "substitution_evaluator") {
    return {
      kind,
      variable,
      coefficient_a: numericParam(source, ["coefficient_a", "coefficient", "a"], 3, -9, 9),
      coefficient_b: numericParam(source, ["coefficient_b", "constant", "b"], -2, -20, 20),
      variable_value: numericParam(source, ["variable_value", "x", "value"], 4, -10, 10)
    };
  }
  if (kind === "exponent_laws") {
    return {
      kind,
      base: numericParam(source, ["base"], 2, 1, 9),
      exponent_m: Math.round(numericParam(source, ["exponent_m", "exponent_a", "m"], 3, 0, 6)),
      exponent_n: Math.round(numericParam(source, ["exponent_n", "exponent_b", "n"], 2, 0, 6)),
      operation: safeChoice(getParam(source, ["operation", "law"]), ["multiply", "divide", "power"], "multiply")
    };
  }
  if (kind === "scientific_notation") return normalizeScientificNotation(source, kind);
  if (kind === "power_operations") {
    let base = numericParam(source, ["base", "number", "value"], 3, -9, 9);
    let exponent = Math.round(numericParam(source, ["exponent", "power"], 2, 0, 8));
    if (base === 0 && exponent === 0) exponent = 1;
    if (Object.is(base, -0)) base = 0;
    return { kind, base, exponent };
  }
  if (kind === "mixed_operations") {
    return {
      kind,
      operand_a: numericParam(source, ["operand_a", "first", "a"], 8, -20, 20),
      operand_b: numericParam(source, ["operand_b", "second", "b"], 3, -20, 20),
      operand_c: numericParam(source, ["operand_c", "third", "c"], 2, -20, 20),
      pattern: safeChoice(getParam(source, ["pattern", "order"]), ["multiply_first", "parentheses_first"], "multiply_first")
    };
  }
  if (kind === "operation_laws") {
    return {
      kind,
      operand_a: numericParam(source, ["operand_a", "first", "a"], 2, -12, 12),
      operand_b: numericParam(source, ["operand_b", "second", "b"], 3, -12, 12),
      operand_c: numericParam(source, ["operand_c", "third", "c"], 4, -12, 12),
      law: safeChoice(getParam(source, ["law", "operation_law"]), ["commutative", "associative", "distributive"], "distributive")
    };
  }
  if (kind === "word_problem") {
    return {
      kind,
      scenario: safeChoice(getParam(source, ["scenario", "question_type", "problem_type"]), ["total", "change", "rate"], "total"),
      quantity: Math.round(numericParam(source, ["quantity", "count"], 4, 1, 20)),
      unit_price: numericParam(source, ["unit_price", "price", "rate"], 12, 0.5, 100),
      paid: numericParam(source, ["paid", "budget", "total"], 100, 1, 500)
    };
  }
  if (kind === "square_root_inverse") {
    const hasRadicand = hasParam(source, ["radicand", "square", "number"]);
    const radicand = hasRadicand
      ? numericParam(source, ["radicand", "square", "number"], 49, 0, 400)
      : Math.pow(numericParam(source, ["root", "root_value", "value"], 7, 0, 20), 2);
    return { kind, root: Math.sqrt(radicand), radicand };
  }
  if (kind === "radical_operations") {
    return {
      kind,
      radicand_a: Math.round(numericParam(source, ["radicand_a", "first", "a"], 4, 1, 100)),
      radicand_b: Math.round(numericParam(source, ["radicand_b", "second", "b"], 9, 1, 100)),
      operation: safeChoice(getParam(source, ["operation"]), ["multiply", "divide"], "multiply")
    };
  }
  if (TRANSFORM_MODEL_KINDS.has(kind)) return normalizeTransformModel(kind, source);
  return normalizeSpatialModel(kind, source);
}

function normalizeScientificNotation(source, kind) {
  const explicitCoefficient = getParam(source, ["coefficient", "mantissa"]);
  const explicitExponent = getParam(source, ["exponent", "power"]);
  const rawValue = Number(getParam(source, ["number", "value"]));
  let coefficient = clampNumber(explicitCoefficient, Number.NaN, -9.99, 9.99);
  let exponent = Math.round(clampNumber(explicitExponent, Number.NaN, -8, 8));
  if ((!Number.isFinite(coefficient) || Math.abs(coefficient) < 1) && Number.isFinite(rawValue) && rawValue !== 0) {
    exponent = clamp(Math.floor(Math.log10(Math.abs(rawValue))), -8, 8);
    coefficient = rawValue / (10 ** exponent);
  }
  if (!Number.isFinite(coefficient) || Math.abs(coefficient) < 1) coefficient = 3.2;
  coefficient = Math.sign(coefficient || 1) * clamp(Math.abs(coefficient), 1, 9.99);
  if (!Number.isFinite(exponent)) exponent = 4;
  return { kind, coefficient, exponent };
}

function normalizeTransformModel(kind, source) {
  const xMin = numericParam(source, ["x_min", "xMin"], -8, -20, -1);
  const xMax = Math.max(xMin + 2, numericParam(source, ["x_max", "xMax"], 8, 1, 20));
  const yMin = numericParam(source, ["y_min", "yMin"], -8, -20, -1);
  const yMax = Math.max(yMin + 2, numericParam(source, ["y_max", "yMax"], 8, 1, 20));
  const shared = {
    kind,
    x_min: xMin,
    x_max: xMax,
    y_min: yMin,
    y_max: yMax,
    point_x: numericParam(source, ["point_x", "x"], 3, Math.max(xMin, -6), Math.min(xMax, 6)),
    point_y: numericParam(source, ["point_y", "y"], 2, Math.max(yMin, -6), Math.min(yMax, 6)),
    center_x: numericParam(source, ["center_x", "origin_x"], 0, Math.max(xMin, -4), Math.min(xMax, 4)),
    center_y: numericParam(source, ["center_y", "origin_y"], 0, Math.max(yMin, -4), Math.min(yMax, 4))
  };
  if (kind === "axis_reflection") return { ...shared, axis: normalizeAxis(getParam(source, ["axis", "reflection_axis"])) };
  if (kind === "rotation") return { ...shared, angle: normalizeRightAngle(getParam(source, ["angle", "degrees"])) };
  if (kind === "central_symmetry") return shared;
  if (kind === "transform_composition") {
    return {
      ...shared,
      delta_x: numericParam(source, ["delta_x", "translate_x"], 2, -4, 4),
      delta_y: numericParam(source, ["delta_y", "translate_y"], -1, -4, 4),
      axis: normalizeAxis(getParam(source, ["axis", "reflection_axis"]))
    };
  }
  return { ...shared, scale: numericParam(source, ["scale", "scale_factor", "ratio"], 1.5, 0.25, 3) };
}

function normalizeSpatialModel(kind, source) {
  if (kind === "projection_rays") {
    return {
      kind,
      light_x: numericParam(source, ["light_x", "source_x"], -4, -6, -1),
      light_y: numericParam(source, ["light_y", "source_y"], 6, 2, 9),
      object_x: numericParam(source, ["object_x"], 1, -0.5, 3),
      object_height: numericParam(source, ["object_height", "height"], 3, 0.5, 6),
      screen_x: numericParam(source, ["screen_x", "projection_x"], 6, 4, 9)
    };
  }
  if (kind === "orthographic_views") {
    return {
      kind,
      length: numericParam(source, ["length"], 6, 1, 10),
      width: numericParam(source, ["width"], 4, 1, 10),
      height: numericParam(source, ["height"], 5, 1, 10),
      active_view: safeChoice(getParam(source, ["active_view", "view"]), ["front", "top", "side"], "front")
    };
  }
  return {
    kind: "solid_net",
    solid: safeChoice(getParam(source, ["solid", "shape"]), ["cube", "triangular_prism"], "cube"),
    fold_progress: numericParam(source, ["fold_progress", "progress"], 0, 0, 1)
  };
}

function normalizeFormulaKind(value) {
  const aliases = {
    rectangle: "rectangle_area",
    rectangle_area: "rectangle_area",
    triangle: "triangle_area",
    triangle_area: "triangle_area",
    distance: "distance",
    speed: "distance"
  };
  return aliases[String(value ?? "").trim()] || "rectangle_area";
}

function normalizeAxis(value) {
  const aliases = { x: "x", x_axis: "x", horizontal: "x", y: "y", y_axis: "y", vertical: "y" };
  return aliases[String(value ?? "").trim()] || "x";
}

function normalizeRightAngle(value) {
  const number = clampNumber(value, 90, -360, 360);
  const normalized = ((Math.round(number / 90) * 90) % 360 + 360) % 360;
  return normalized === 0 ? 180 : normalized;
}

function normalizeRanges(source) {
  const xMin = numericParam(source, ["x_min", "xMin"], -6, -100, 99);
  const xMax = Math.max(xMin + 1, numericParam(source, ["x_max", "xMax"], 6, xMin + 1, 100));
  const yMin = numericParam(source, ["y_min", "yMin"], -6, -100, 99);
  const yMax = Math.max(yMin + 1, numericParam(source, ["y_max", "yMax"], 6, yMin + 1, 100));
  return { x_min: xMin, x_max: xMax, y_min: yMin, y_max: yMax };
}

function normalizePoints(value, ranges) {
  const input = Array.isArray(value) ? value : [];
  const points = input.slice(0, 12).map((item, index) => {
    const record = objectRecord(item);
    return {
      x: clampNumber(record.x, index === 0 ? 2 : index - 2, ranges.x_min, ranges.x_max),
      y: clampNumber(record.y, index === 0 ? 2 : 1 - index, ranges.y_min, ranges.y_max),
      label: safeText(record.label ?? record.name, 24) || String.fromCharCode(65 + index)
    };
  });
  return points.length ? points : [{ x: 2, y: 2, label: "A" }, { x: -2, y: 1, label: "B" }];
}

function normalizeCoordinate(source, ranges, kind) {
  const explicit = Array.isArray(source.points) ? source.points : Array.isArray(source.data) ? source.data : null;
  if (explicit) return { kind: kind || "cartesian_relation", ...ranges, points: normalizePoints(explicit, ranges) };

  if (kind === "inverse_proportion_samples") {
    const coefficient = numericParam(source, ["coefficient"], 4, -8, 8) || 1;
    const points = [-4, -2, -1, 1, 2, 4].map((x, index) => ({
      x: clamp(x, ranges.x_min, ranges.x_max),
      y: clamp(coefficient / x, ranges.y_min, ranges.y_max),
      label: index === 0 ? "y=k/x" : ""
    }));
    return { kind, ...ranges, coefficient, points };
  }

  const pointX = numericParam(source, ["point_x"], 2, ranges.x_min, ranges.x_max);
  const pointY = numericParam(source, ["point_y"], 1, ranges.y_min, ranges.y_max);
  if (kind === "coordinate_transformation") {
    const deltaX = numericParam(source, ["delta_x"], 2, -4, 4);
    const deltaY = numericParam(source, ["delta_y"], -1, -4, 4);
    return {
      kind,
      ...ranges,
      delta_x: deltaX,
      delta_y: deltaY,
      points: [
        { x: pointX, y: pointY, label: "A" },
        { x: clamp(pointX + deltaX, ranges.x_min, ranges.x_max), y: clamp(pointY + deltaY, ranges.y_min, ranges.y_max), label: "A′" }
      ]
    };
  }
  return { kind: kind || "cartesian_relation", ...ranges, points: [{ x: pointX, y: pointY, label: "A" }] };
}

function normalizeStatistics(source) {
  const data = objectRecord(source.data);
  const raw = Array.isArray(source.values)
    ? source.values
    : Array.isArray(source.data)
      ? source.data
      : Array.isArray(data.sample)
        ? data.sample
        : [];
  const values = raw.slice(0, 12).map((item) => {
    const value = typeof item === "object" ? item?.value : item;
    return clampNumber(value, Number.NaN, 0, 100);
  }).filter(Number.isFinite);
  const normalizedValues = values.length ? values : [3, 5, 4, 7, 6];
  const rawLabels = Array.isArray(source.labels) ? source.labels : raw.map((item) => item?.label);
  return {
    kind: safeModelKind(source.model) || "descriptive_statistics",
    values: normalizedValues,
    labels: normalizedValues.map((_, index) => safeText(rawLabels[index], 16) || `第${index + 1}项`),
    series_label: safeText(data.series_label, 48)
  };
}

function normalizeProbability(source, kind) {
  const data = objectRecord(source.data);
  const rawOutcomes = Array.isArray(data.outcomes) ? data.outcomes : Array.isArray(source.outcomes) ? source.outcomes : [];
  const outcomes = rawOutcomes.slice(0, 50).map((value) => clampNumber(value, Number.NaN, -100, 100)).filter(Number.isFinite);
  const fallbackTotal = Math.round(numericParam(source, ["total", "denominator"], 10, 2, 50));
  const normalizedOutcomes = outcomes.length >= 2 ? outcomes : Array.from({ length: fallbackTotal }, (_, index) => index + 1);
  const total = normalizedOutcomes.length;
  const event = safeChoice(getParam(source, ["event"]), ["even", "greater_than_four", "prime"], "even");
  const probability = numericParam(source, ["probability", "p"], Number.NaN, 0, 1);
  const derivedFavorable = normalizedOutcomes.filter((value) => outcomeMatches(value, event)).length;
  const defaultFavorable = Number.isFinite(probability) ? Math.round(probability * total) : derivedFavorable;
  return {
    kind: kind || "equally_likely_outcomes",
    mode: outcomes.length >= 2 ? "experiment" : "count",
    outcomes: normalizedOutcomes,
    total,
    event,
    trials: Math.round(numericParam(source, ["trials"], 60, 10, 200)),
    favorable: Math.round(numericParam(source, ["favorable", "success", "numerator"], defaultFavorable, 0, total)),
    deterministic_seed: Math.round(clampNumber(data.deterministic_seed, 202, 0, 1_000_000))
  };
}

function normalizeAlgebra(source, kind) {
  const hasCompilerCoefficients = hasParam(source, ["coefficient_a", "coefficient_b"]);
  if (hasCompilerCoefficients) {
    const coefficientA = numericParam(source, ["coefficient_a"], 2, -6, 6) || 1;
    const coefficientB = numericParam(source, ["coefficient_b"], -3, -8, 8);
    const constant = numericParam(source, ["constant"], 5, -10, 10);
    return {
      kind: kind || "linear_equation_steps",
      coefficient_a: coefficientA,
      coefficient_b: coefficientB,
      constant,
      solution: (constant - coefficientB) / coefficientA,
      step_index: Math.round(numericParam(source, ["step_index"], 0, 0, 3)),
      variable: safeVariable(getParam(source, ["variable"]))
    };
  }
  const coefficientA = numericParam(source, ["coefficient", "a"], 2, -6, 6) || 1;
  const coefficientB = numericParam(source, ["constant", "b"], 3, -8, 8);
  const solution = numericParam(source, ["solution", "x"], 2, -10, 10);
  return {
    kind: kind || "linear_equation_steps",
    coefficient_a: coefficientA,
    coefficient_b: coefficientB,
    constant: coefficientA * solution + coefficientB,
    solution,
    step_index: 0,
    variable: safeVariable(getParam(source, ["variable"]))
  };
}

function normalizeConcept(source) {
  const data = objectRecord(source.data);
  const rawItems = Array.isArray(source.items)
    ? source.items
    : Array.isArray(source.nodes)
      ? source.nodes
      : Array.isArray(data.steps)
        ? data.steps
        : [];
  const items = rawItems.slice(0, 8).map((item) => safeText(typeof item === "object" ? item?.label ?? item?.name ?? item?.title : item, 40)).filter(Boolean);
  return {
    kind: safeModelKind(source.model) || "relationship_explorer",
    center: safeText(source.center ?? data.focus ?? source.title ?? source.name, 80) || "核心概念",
    items: items.length ? items : ["定义", "表示", "关系", "应用"]
  };
}

function unwrapSpec(input) {
  const root = objectRecord(input);
  const candidates = [
    root.interactive_visual,
    root.interactive,
    root.spec,
    root.artifact?.interactive_visual,
    root.artifact?.interactive
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  return root;
}

function getParam(source, keys) {
  const parameterArrays = [source.parameters, source.params].filter(Array.isArray);
  for (const parameters of parameterArrays) {
    for (const parameter of parameters.slice(0, 64)) {
      const record = objectRecord(parameter);
      const key = String(record.key ?? record.name ?? record.id ?? "").trim();
      if (!keys.includes(key)) continue;
      for (const field of ["value", "current", "default", "initial"]) {
        if (record[field] !== undefined && record[field] !== null && record[field] !== "") {
          return record[field];
        }
      }
    }
  }
  const parameterSources = [
    objectRecord(source.parameters),
    objectRecord(source.params),
    objectRecord(source.viewport),
    objectRecord(source.data),
    objectRecord(source.data?.dimensions),
    objectRecord(source.model),
    objectRecord(source)
  ];
  for (const record of parameterSources) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
    }
  }
  return undefined;
}

function hasParam(source, keys) {
  return getParam(source, keys) !== undefined;
}

function numericParam(source, keys, fallback, min, max) {
  return clampNumber(getParam(source, keys), fallback, min, max);
}

function createPlot(xMin, xMax, yMin, yMax) {
  const left = 42;
  const right = 610;
  const top = 24;
  const bottom = 332;
  return {
    left,
    right,
    top,
    bottom,
    x(value) { return left + ((value - xMin) / (xMax - xMin)) * (right - left); },
    y(value) { return bottom - ((value - yMin) / (yMax - yMin)) * (bottom - top); }
  };
}

function sampledPath(min, max, segments, evaluator, plot) {
  const commands = [];
  for (let index = 0; index <= segments; index += 1) {
    const x = min + ((max - min) * index) / segments;
    const y = evaluator(x);
    if (!Number.isFinite(y)) continue;
    commands.push(`${commands.length ? "L" : "M"} ${formatSvgNumber(plot.x(x))} ${formatSvgNumber(plot.y(y))}`);
  }
  return commands.join(" ");
}

function sectorPath(cx, cy, radius, angle) {
  const normalized = clamp(angle, 0, 360);
  if (normalized >= 359.999) {
    return `M ${cx} ${cy} m ${radius} 0 a ${radius} ${radius} 0 1 0 ${-2 * radius} 0 a ${radius} ${radius} 0 1 0 ${2 * radius} 0`;
  }
  const end = ((360 - normalized) * Math.PI) / 180;
  const x = cx + radius * Math.cos(end);
  const y = cy + radius * Math.sin(end);
  return `M ${cx} ${cy} L ${cx + radius} ${cy} A ${radius} ${radius} 0 ${normalized > 180 ? 1 : 0} 0 ${x} ${y} Z`;
}

function element(doc, tag, attributes = {}, text = null) {
  const node = doc.createElement(tag);
  setAttributes(node, attributes);
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

function svgNode(doc, tag, attributes = {}) {
  const node = doc.createElementNS(SVG_NS, tag);
  setAttributes(node, attributes);
  return node;
}

function svgText(doc, x, y, text, attributes = {}) {
  const node = svgNode(doc, "text", { x, y, ...attributes });
  node.textContent = String(text ?? "");
  return node;
}

function setAttributes(node, attributes) {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(name, String(value));
  }
}

function style(node, declarations) {
  Object.assign(node.style, declarations);
}

function styleButton(button, accent, compact) {
  style(button, {
    width: "100%",
    padding: compact ? "5px 7px" : "7px 9px",
    border: "1px solid #dce4ef",
    borderRadius: "8px",
    background: "#ffffff",
    color: COLORS.ink,
    fontSize: compact ? "10px" : "11px",
    textAlign: "left",
    cursor: "pointer",
    accentColor: accent
  });
}

function setLine(node, x1, y1, x2, y2) {
  setAttributes(node, { x1: formatSvgNumber(x1), y1: formatSvgNumber(y1), x2: formatSvgNumber(x2), y2: formatSvgNumber(y2) });
}

function setPoint(node, x, y) {
  setAttributes(node, { cx: formatSvgNumber(x), cy: formatSvgNumber(y) });
}

function setSvgText(node, x, y, text) {
  setAttributes(node, { x: formatSvgNumber(x), y: formatSvgNumber(y) });
  node.textContent = String(text);
}

function variantLabel(variant) {
  return {
    linear: "函数图像",
    quadratic: "函数图像",
    numberline: "数与代数",
    triangle: "几何探究",
    circle: "几何探究",
    coordinate: "坐标探究",
    statistics: "统计分析",
    probability: "随机事件",
    algebra: "等式探究",
    concept: "概念关系"
  }[variant] || "互动图解";
}

function normalizeVariantToken(value) {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, "")
    .replace(/[^a-z0-9]/gu, "");
  const aliases = { line: "linear", linearfunction: "linear", parabola: "quadratic", numberaxis: "numberline", numberline: "numberline", geometry: "triangle", coordinates: "coordinate", coordinateplane: "coordinate", stats: "statistics", chart: "statistics", equation: "algebra", mindmap: "concept" };
  return aliases[token] || token.slice(0, 32);
}

function safeText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function safeId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_.:-]/gu, "-").slice(0, 120);
}

function safeVariable(value) {
  const variable = String(value || "x").trim();
  return /^[a-zA-Z]$/u.test(variable) ? variable : "x";
}

function safeModelKind(value) {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value.kind ?? value.type ?? value.name ?? ""
    : value;
  return String(candidate || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/gu, "")
    .slice(0, 64);
}

function safeChoice(value, choices, fallback) {
  const normalized = String(value ?? "").trim();
  return choices.includes(normalized) ? normalized : fallback;
}

function safeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function safeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/iu.test(color) ? color.toLowerCase() : "#3569b8";
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    const fallbackNumber = Number(fallback);
    return Number.isFinite(fallbackNumber) ? clamp(fallbackNumber, min, max) : fallback;
  }
  return clamp(number, min, max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const rounded = Math.round(number * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function formatSvgNumber(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value) * 100) / 100) : "0";
}

function formatCoefficient(value, variable) {
  if (value === 1) return variable;
  if (value === -1) return `-${variable}`;
  return `${formatNumber(value)}${variable}`;
}

function formatSigned(value) {
  if (Math.abs(value) < 0.0001) return "";
  return value > 0 ? ` + ${formatNumber(value)}` : ` - ${formatNumber(Math.abs(value))}`;
}

function formatParenthesized(value) {
  const formatted = formatNumber(value);
  return Number(value) < 0 ? `(${formatted})` : formatted;
}

function formatCalculated(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  const absolute = Math.abs(number);
  if (absolute !== 0 && (absolute >= 10_000_000 || absolute < 0.001)) {
    return number.toExponential(3).replace("e+", "×10^").replace("e-", "×10^-");
  }
  return formatNumber(number);
}

function dedicatedModelLabel(kind) {
  return {
    expression_builder: "代数式组装",
    formula_builder: "公式建模",
    substitution_evaluator: "代入求值",
    exponent_laws: "幂的运算律",
    scientific_notation: "科学记数法",
    power_operations: "乘方运算",
    mixed_operations: "混合运算",
    operation_laws: "运算律",
    word_problem: "实际问题建模",
    square_root_inverse: "平方与平方根",
    radical_operations: "根式运算",
    axis_reflection: "轴对称",
    rotation: "旋转",
    central_symmetry: "中心对称",
    transform_composition: "复合变换",
    dilation: "位似",
    projection_rays: "投影光线",
    orthographic_views: "三视图",
    solid_net: "几何体展开图"
  }[kind] || "专项互动模型";
}

function outcomeMatches(value, event) {
  if (event === "greater_than_four") return value > 4;
  if (event === "prime") {
    if (!Number.isInteger(value) || value < 2) return false;
    for (let divisor = 2; divisor * divisor <= value; divisor += 1) {
      if (value % divisor === 0) return false;
    }
    return true;
  }
  return Number.isInteger(value) && Math.abs(value % 2) === 0;
}

function deterministicObservedFrequency(outcomes, event, trials, seed) {
  let state = (Math.round(seed) >>> 0) || 202;
  let successes = 0;
  const count = Math.max(1, Math.round(trials));
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const outcome = outcomes[state % outcomes.length];
    if (outcomeMatches(outcome, event)) successes += 1;
  }
  return successes / count;
}

function truncateText(value, maxLength) {
  const text = safeText(value, maxLength + 2);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function toRgba(hex, alpha) {
  const normalized = safeColor(hex).slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
