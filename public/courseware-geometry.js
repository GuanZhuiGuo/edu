import { mountInteractiveVisual, normalizeInteractiveVisualArtifact } from "./interactive-visual-renderer.js";

export const GEOMETRY_SCOPE = "当前平面几何支持直角三角形的边长、勾股关系与面积，以及圆的半径、圆心角、周长、面积与扇形占比。";

export function buildGeometryCourseware(prompt = "") {
  const text = String(prompt).trim();
  const triangle = /直角三角形|勾股|毕达哥拉斯/.test(text);
  const circle = /圆|扇形/.test(text);
  const unsupportedShape = /非直角|不是直角|不限定直角|等边|等腰|锐角三角形|钝角三角形|任意三角形|一般三角形|相似|全等|外接|内切|切线|圆周角|椭圆|四边形|多边形|矩形|长方形|平行四边形|菱形|梯形|立体|圆柱|圆锥|球体|尺规|证明/.test(text);
  // A square is often an explanatory area model for a² + b² = c². Treat it
  // as an unsupported primary shape only when the prompt is not about the
  // right-triangle/Pythagorean template.
  const unsupportedSquare = /正方形/.test(text) && !(triangle && /面积|平方|勾股|毕达哥拉斯/.test(text));
  const unsupported = unsupportedShape || unsupportedSquare;
  if (unsupported || triangle === circle) {
    throw new Error(`${GEOMETRY_SCOPE}请明确选择其中一种，例如“直角三角形勾股关系”或“圆与扇形”，其他几何模型尚未接入。`);
  }
  const title = triangle ? "直角三角形：勾股关系与面积" : "圆与扇形：半径和圆心角";
  const description = triangle
    ? "本地交互模板：两直角边以 3、4 起步，调节边长，比较斜边与面积；直角始终固定为 90°。"
    : "本地交互模板：半径以 3、圆心角以 90° 起步，调节参数，比较圆的周长、面积与扇形占比。";
  const visualArtifact = normalizeInteractiveVisualArtifact({
    id: triangle ? "courseware-right-triangle" : "courseware-circle-sector",
    variant: triangle ? "triangle" : "circle",
    model: triangle ? "right_triangle" : "circle_elements",
    title, description,
    parameters: triangle ? { a: 3, b: 4 } : { radius: 3, central_angle: 90 },
  });
  return { title, description, subject: "数学", type: "geometry", technology: "SVG", interactive: true,
    tags: ["平面几何", triangle ? "直角三角形" : "圆与扇形", "本地模板"],
    visualArtifact, source: "saved", creationMethod: "local-template", originalPrompt: text };
}

export const BUILTIN_GEOMETRY_COURSEWARE = Object.freeze([
  ["geometry_right_triangle", "直角三角形勾股关系"],
  ["geometry_circle_sector", "圆与扇形"],
].map(([id, prompt]) => Object.freeze({ ...buildGeometryCourseware(prompt), id: `builtin:${id}`, source: "builtin", createdAt: "2026-09-09T00:00:00.000Z" })));

function renderSpec(artifact) {
  const spec = normalizeInteractiveVisualArtifact(artifact);
  const triangle = spec.variant === "triangle" && spec.model.kind === "right_triangle";
  const circle = spec.variant === "circle" && spec.model.kind === "circle_elements";
  if (!triangle && !circle) throw new Error(GEOMETRY_SCOPE);
  // The renderer normalizes its input again. Omit the derived right angle so
  // it cannot be mistaken for a user-adjustable angle control on that pass.
  return { id: spec.id, variant: spec.variant, model: spec.model.kind, title: spec.title,
    description: spec.description, aria_label: spec.aria_label, accent: spec.accent,
    parameters: triangle ? { a: spec.model.a, b: spec.model.b } : { radius: spec.model.radius, central_angle: spec.model.angle } };
}

export function mountGeometryCourseware(container, item, { onChange } = {}) {
  if (!item?.visualArtifact) throw new Error("缺少可交互的几何课件数据。");
  const input = renderSpec(item.visualArtifact);
  const destroyVisual = mountInteractiveVisual(container, input, { compact: true });
  const root = container.firstElementChild;
  root.classList.add("courseware-geometry-player");
  root.style.fontFamily = "var(--ds-font-family, system-ui, sans-serif)";
  root.style.borderRadius = "var(--ds-radius-panel, 12px)";
  root.style.padding = "var(--ds-space-3, 12px)";
  root.style.gap = "var(--ds-space-3, 12px)";
  root.style.containerType = "inline-size";
  root.style.containerName = "courseware-geometry";
  const layout = root.children[1];
  layout.classList.add("courseware-geometry-layout");
  layout.style.gridTemplateColumns = "";
  root.querySelectorAll("header > span, [data-visual-status]").forEach((node) => { node.style.fontSize = "var(--ds-font-xs, 12px)"; });
  root.querySelectorAll("label").forEach((node) => { node.style.fontSize = "var(--ds-font-body, 14px)"; });
  const bindings = input.variant === "triangle" ? [["边 a", "a"], ["边 b", "b"]] : [["半径 r", "radius"], ["圆心角", "central_angle"]];
  const controls = bindings.map(([label, key]) => {
    const control = root.querySelector(`input[aria-label="${label}"]`);
    if (!control) throw new Error("几何参数控件未正确加载。");
    control.style.minHeight = "var(--ds-control-height, 36px)";
    return [control, key];
  });
  const getCourseware = () => ({ ...structuredClone(item), visualArtifact: normalizeInteractiveVisualArtifact({
    ...input, parameters: Object.fromEntries(controls.map(([control, key]) => [key, Number(control.value)])),
  }) });
  const update = () => onChange?.(getCourseware());
  controls.forEach(([control]) => control.addEventListener("input", update));
  let destroyed = false;
  return Object.freeze({ getCourseware, destroy() {
    if (destroyed) return;
    destroyed = true;
    controls.forEach(([control]) => control.removeEventListener("input", update));
    destroyVisual();
  } });
}
