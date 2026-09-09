import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  mountInteractiveVisual,
  normalizeInteractiveVisualArtifact
} from "../public/interactive-visual-renderer.js";

const VARIANTS = [
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
];

const P0_MODEL_SPECS = [
  {
    variant: "algebra",
    model: "expression_builder",
    parameters: [{ key: "coefficient_a", default: 3 }, { key: "coefficient_b", default: -4 }, { key: "variable_value", default: 2 }]
  },
  {
    variant: "algebra",
    model: "formula_builder",
    parameters: [{ key: "formula_kind", default: "triangle_area" }, { key: "length", default: 8 }, { key: "height", default: 5 }]
  },
  {
    variant: "algebra",
    model: "substitution_evaluator",
    parameters: [{ key: "coefficient_a", default: 2 }, { key: "coefficient_b", default: 1 }, { key: "variable_value", default: -3 }]
  },
  {
    variant: "algebra",
    model: "exponent_laws",
    parameters: [{ key: "base", default: 3 }, { key: "exponent_m", default: 4 }, { key: "exponent_n", default: 2 }, { key: "operation", default: "divide" }]
  },
  {
    variant: "algebra",
    model: "scientific_notation",
    parameters: [{ key: "coefficient", default: 6.25 }, { key: "exponent", default: -3 }]
  },
  {
    variant: "algebra",
    model: "power_operations",
    parameters: [{ key: "base", default: -3 }, { key: "exponent", default: 4 }]
  },
  {
    variant: "algebra",
    model: "mixed_operations",
    parameters: [{ key: "operand_a", default: 8 }, { key: "operand_b", default: 3 }, { key: "operand_c", default: 2 }, { key: "pattern", default: "parentheses_first" }]
  },
  {
    variant: "algebra",
    model: "operation_laws",
    parameters: [{ key: "operand_a", default: 2 }, { key: "operand_b", default: 5 }, { key: "operand_c", default: 4 }, { key: "law", default: "distributive" }]
  },
  {
    variant: "algebra",
    model: "word_problem",
    parameters: [{ key: "scenario", default: "change" }, { key: "quantity", default: 4 }, { key: "unit_price", default: 12 }, { key: "paid", default: 100 }]
  },
  {
    variant: "algebra",
    model: "square_root_inverse",
    parameters: [{ key: "radicand", default: 81 }]
  },
  {
    variant: "algebra",
    model: "radical_operations",
    parameters: [{ key: "radicand_a", default: 8 }, { key: "radicand_b", default: 2 }, { key: "operation", default: "divide" }]
  },
  {
    variant: "coordinate",
    model: "axis_reflection",
    parameters: [{ key: "point_x", default: 3 }, { key: "point_y", default: 2 }, { key: "axis", default: "y_axis" }]
  },
  {
    variant: "coordinate",
    model: "rotation",
    parameters: [{ key: "point_x", default: 3 }, { key: "point_y", default: 1 }, { key: "center_x", default: 0 }, { key: "center_y", default: 0 }, { key: "angle", default: 90 }]
  },
  {
    variant: "coordinate",
    model: "central_symmetry",
    parameters: [{ key: "point_x", default: 4 }, { key: "point_y", default: -2 }, { key: "center_x", default: 1 }, { key: "center_y", default: 1 }]
  },
  {
    variant: "coordinate",
    model: "transform_composition",
    parameters: [{ key: "point_x", default: 1 }, { key: "point_y", default: 2 }, { key: "delta_x", default: 2 }, { key: "delta_y", default: -1 }, { key: "axis", default: "x" }]
  },
  {
    variant: "coordinate",
    model: "dilation",
    parameters: [{ key: "point_x", default: 2 }, { key: "point_y", default: 1 }, { key: "center_x", default: 0 }, { key: "center_y", default: 0 }, { key: "scale_factor", default: 2 }]
  },
  {
    variant: "coordinate",
    model: "projection_rays",
    parameters: [{ key: "light_x", default: -4 }, { key: "light_y", default: 7 }, { key: "object_x", default: 1 }, { key: "object_height", default: 3 }, { key: "screen_x", default: 6 }]
  },
  {
    variant: "coordinate",
    model: "orthographic_views",
    data: { dimensions: { length: 7, width: 4, height: 5 } },
    parameters: [{ key: "active_view", default: "top" }]
  },
  {
    variant: "concept",
    model: "solid_net",
    parameters: [{ key: "solid", default: "triangular_prism" }, { key: "fold_progress", default: 0.35 }]
  }
];

const compiledArtifactsUrl = new URL("../public/data/junior-math-visual-artifacts.json", import.meta.url);

test("normalizer creates a frozen, bounded model and discards executable fields", () => {
  const normalized = normalizeInteractiveVisualArtifact({
    interactive_visual: {
      id: "lesson visual 01",
      variant: "linear_function",
      title: "<img src=x onerror=alert(1)>",
      accent: "url(javascript:alert(1))",
      expression: "fetch('/private')",
      html: "<script>alert(1)</script>",
      onChange: "alert(1)",
      parameters: {
        k: 999,
        b: -999,
        xMin: -999,
        xMax: 999
      }
    }
  });

  assert.equal(normalized.schema_version, "interactive-visual@1.0");
  assert.equal(normalized.id, "lesson-visual-01");
  assert.equal(normalized.variant, "linear");
  assert.equal(normalized.accent, "#3569b8");
  assert.equal(normalized.model.slope, 5);
  assert.equal(normalized.model.intercept, -6);
  assert.equal(normalized.model.x_min, -100);
  assert.equal(normalized.model.x_max, 100);
  assert.equal("expression" in normalized.model, false);
  assert.equal("html" in normalized, false);
  assert.equal("onChange" in normalized, false);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.model), true);
});

test("normalizer reads compiler parameter arrays by key and default", () => {
  const canonical = normalizeInteractiveVisualArtifact({
    artifact: {
      interactive: {
        variant: "linear",
        parameters: [
          { key: "slope", label: "斜率", default: -2, min: -4, max: 4 },
          { key: "intercept", label: "截距", default: 3, min: -5, max: 5 }
        ]
      }
    }
  });
  const aliases = normalizeInteractiveVisualArtifact({
    variant: "linear",
    parameters: [
      { key: "k", default: 2.5 },
      { key: "b", value: -1.5 }
    ]
  });

  assert.equal(canonical.model.slope, -2);
  assert.equal(canonical.model.intercept, 3);
  assert.equal(aliases.model.slope, 2.5);
  assert.equal(aliases.model.intercept, -1.5);
});

test("trusted card input values instantiate the compiled visual without changing its renderer model", async () => {
  const collection = JSON.parse(await readFile(compiledArtifactsUrl, "utf8"));
  const artifact = collection.artifacts.find((item) => item.knowledge_point_id === "M4-GE-TRI-10");
  const normalized = normalizeInteractiveVisualArtifact({
    ...artifact.interactive,
    input_values: { leg_a: 5, leg_b: 12 },
  });

  assert.equal(normalized.variant, "triangle");
  assert.equal(normalized.model.kind, "right_triangle");
  assert.deepEqual(pick(normalized.model, ["a", "b"]), { a: 5, b: 12 });
});

test("normalizer preserves every compiler variant's actual controlled semantics", async () => {
  const collection = JSON.parse(await readFile(compiledArtifactsUrl, "utf8"));
  const byModel = (model) => collection.artifacts.find((artifact) => artifact.interactive.model === model).interactive;

  const numberline = normalizeInteractiveVisualArtifact(byModel("ordered_points"));
  assert.equal(numberline.description, byModel("ordered_points").instruction);
  assert.deepEqual(
    pick(numberline.model, ["kind", "min", "max", "step", "point_a", "point_b"]),
    { kind: "ordered_points", min: -10, max: 10, step: 1, point_a: -2, point_b: 3 }
  );

  const interval = normalizeInteractiveVisualArtifact(byModel("inequality_interval"));
  assert.deepEqual(
    pick(interval.model, ["kind", "boundary", "direction", "closed"]),
    { kind: "inequality_interval", boundary: 2, direction: "greater", closed: false }
  );

  const algebra = normalizeInteractiveVisualArtifact(byModel("linear_equation_steps"));
  assert.deepEqual(
    pick(algebra.model, ["coefficient_a", "coefficient_b", "constant", "solution", "step_index"]),
    { coefficient_a: 2, coefficient_b: -3, constant: 5, solution: 4, step_index: 0 }
  );

  const coordinate = normalizeInteractiveVisualArtifact(byModel("cartesian_relation"));
  assert.deepEqual(coordinate.model.points[0], { x: 2, y: 1, label: "A" });
  const transformed = normalizeInteractiveVisualArtifact(byModel("coordinate_transformation"));
  assert.deepEqual(transformed.model.points, [{ x: 2, y: 1, label: "A" }, { x: 4, y: 0, label: "A′" }]);

  const quadratic = normalizeInteractiveVisualArtifact(byModel("quadratic_vertex_form"));
  assert.deepEqual(
    pick(quadratic.model, ["magnitude", "opening", "a", "h", "k"]),
    { magnitude: 0.5, opening: "up", a: 0.5, h: 0, k: -1 }
  );

  const triangle = normalizeInteractiveVisualArtifact(byModel("general_triangle"));
  assert.deepEqual(pick(triangle.model, ["a", "b", "angle"]), { a: 5, b: 6, angle: 60 });
  const circle = normalizeInteractiveVisualArtifact(byModel("inscribed_angle"));
  assert.deepEqual(pick(circle.model, ["radius", "angle"]), { radius: 5, angle: 120 });

  const statistics = normalizeInteractiveVisualArtifact(byModel("sampling_comparison"));
  assert.deepEqual(statistics.model.values, [30, 34, 37, 37, 41, 44, 48, 51]);
  const probability = normalizeInteractiveVisualArtifact(byModel("equally_likely_outcomes"));
  assert.deepEqual(
    pick(probability.model, ["mode", "total", "favorable", "trials", "event"]),
    { mode: "experiment", total: 6, favorable: 3, trials: 60, event: "even" }
  );
  const concept = normalizeInteractiveVisualArtifact(byModel("relationship_explorer"));
  assert.equal(concept.model.center, byModel("relationship_explorer").data.focus);
  assert.deepEqual(concept.model.items, byModel("relationship_explorer").data.steps);
});

test("unknown variants safely fall back to a text-only concept model", () => {
  const normalized = normalizeInteractiveVisualArtifact({
    variant: "<img src=x onerror=alert(1)>",
    title: "函数关系 <script>bad()</script>",
    nodes: [
      { label: "定义 <b>不会执行</b>" },
      { name: "图像" },
      { title: "应用" }
    ]
  });

  assert.equal(normalized.variant, "concept");
  assert.equal(normalized.fallback, true);
  assert.match(normalized.requested_variant, /^[a-z0-9]{1,32}$/u);
  assert.equal(normalized.model.center, "函数关系 <script>bad()</script>");
  assert.deepEqual(normalized.model.items, ["定义 <b>不会执行</b>", "图像", "应用"]);
});

test("all controlled variants mount with pure DOM/SVG in normal and compact containers", () => {
  const doc = new FakeDocument();
  for (const compact of [false, true]) {
    for (const variant of VARIANTS) {
      const container = doc.createElement("div");
      const destroy = mountInteractiveVisual(container, exampleSpec(variant), { compact });
      assert.equal(typeof destroy, "function", variant);
      assert.equal(container.children.length, 1, variant);
      const root = container.children[0];
      assert.equal(root.getAttribute("data-interactive-visual"), variant);
      assert.equal(findAll(root, "svg").length, 1, variant);
      assert.ok(findAll(root, "output").some((node) => node.textContent.length > 0), variant);
      destroy();
      destroy();
      assert.equal(container.children.length, 0, variant);
    }
  }
});

test("all P0 dedicated models normalize and mount in normal and compact modes", () => {
  const doc = new FakeDocument();
  for (const compact of [false, true]) {
    for (const input of P0_MODEL_SPECS) {
      const normalized = normalizeInteractiveVisualArtifact(input);
      assert.equal(normalized.model.kind, input.model, input.model);
      const container = doc.createElement("div");
      const destroy = mountInteractiveVisual(container, {
        ...input,
        expression: "fetch('/private')",
        html: "<script>window.pwned=true</script>"
      }, { compact });
      const root = container.children[0];
      assert.equal(root.getAttribute("data-interactive-model"), input.model, input.model);
      const svgs = findAll(root, "svg");
      assert.equal(svgs.length, 1, input.model);
      assert.equal(svgs[0].getAttribute("data-dedicated-model"), input.model, input.model);
      assert.ok(findAll(root, "input").length + findAll(root, "select").length >= 1, input.model);
      assert.ok(findAll(root, "output").some((node) => node.textContent.length > 0), input.model);
      const serialized = serializeFakeDom(root);
      assert.equal(serialized.includes("NaN"), false, input.model);
      assert.equal(serialized.includes("Infinity"), false, input.model);
      assert.equal(serialized.includes("fetch"), false, input.model);
      assert.equal(findAll(root, "script").length, 0, input.model);
      destroy();
      assert.equal(container.children.length, 0, input.model);
    }
  }
});

test("dedicated model inputs are clamped and controlled enums safely fall back", () => {
  const scientific = normalizeInteractiveVisualArtifact({
    variant: "algebra",
    model: "scientific_notation",
    parameters: { coefficient: 999, exponent: 999 }
  });
  assert.equal(scientific.model.coefficient, 9.99);
  assert.equal(scientific.model.exponent, 8);

  const transform = normalizeInteractiveVisualArtifact({
    variant: "coordinate",
    model: "rotation",
    parameters: { point_x: 999, point_y: -999, angle: 137 }
  });
  assert.equal(transform.model.point_x, 6);
  assert.equal(transform.model.point_y, -6);
  assert.equal(transform.model.angle, 180);

  const spatial = normalizeInteractiveVisualArtifact({
    variant: "concept",
    model: "solid_net",
    parameters: { solid: "<script>", fold_progress: 12 }
  });
  assert.equal(spatial.model.solid, "cube");
  assert.equal(spatial.model.fold_progress, 1);
  assert.equal("expression" in spatial.model, false);
});

test("all 140 compiled interactive specs mount in normal and compact modes without fallback geometry", async () => {
  const collection = JSON.parse(await readFile(compiledArtifactsUrl, "utf8"));
  const doc = new FakeDocument();
  let dedicatedMounts = 0;
  for (const compact of [false, true]) {
    for (const artifact of collection.artifacts) {
      const normalized = normalizeInteractiveVisualArtifact(artifact.interactive);
      const container = doc.createElement("div");
      const destroy = mountInteractiveVisual(container, artifact.interactive, { compact });
      const root = container.children[0];
      const serialized = serializeFakeDom(container);
      assert.equal(serialized.includes("NaN"), false, artifact.artifact_id);
      assert.equal(serialized.includes("Infinity"), false, artifact.artifact_id);
      assert.equal(findAll(container, "svg").length, 1, artifact.artifact_id);
      if (artifact.interactive.visual_profile?.status === "supported") {
        dedicatedMounts += 1;
        assert.equal(normalized.model.kind, artifact.interactive.model, artifact.artifact_id);
        assert.equal(root.getAttribute("data-interactive-model"), artifact.interactive.model, artifact.artifact_id);
        assert.equal(findAll(root, "svg")[0].getAttribute("data-dedicated-model"), artifact.interactive.model, artifact.artifact_id);
      }
      destroy();
    }
  }
  assert.equal(dedicatedMounts, 44);
});

test("range interaction updates a linear plot and destroy removes listeners", () => {
  const doc = new FakeDocument();
  const container = doc.createElement("div");
  const destroy = mountInteractiveVisual(container, {
    variant: "linear",
    parameters: { slope: 1, intercept: 0 }
  });
  const root = container.children[0];
  const curve = findAll(root, "path")[0];
  const slope = findAll(root, "input")[0];
  const before = curve.getAttribute("d");
  slope.value = "-3";
  slope.dispatchEvent({ type: "input" });
  assert.notEqual(curve.getAttribute("d"), before);
  assert.match(textContent(root), /y = -3x/u);
  assert.equal(slope.listenerCount("input"), 1);

  destroy();
  assert.equal(slope.listenerCount("input"), 0);
});

test("markup-looking labels remain literal text and arbitrary algebra expressions are ignored", () => {
  const doc = new FakeDocument();
  const conceptContainer = doc.createElement("div");
  mountInteractiveVisual(conceptContainer, {
    variant: "concept",
    title: "<script>window.pwned=true</script>",
    items: ["<img src=x onerror=alert(1)>"]
  });
  assert.match(textContent(conceptContainer), /<script>window\.pwned=true<\/script>/u);
  assert.equal(findAll(conceptContainer, "script").length, 0);
  assert.equal(findAll(conceptContainer, "img").length, 0);

  const algebraContainer = doc.createElement("div");
  mountInteractiveVisual(algebraContainer, {
    variant: "algebra",
    expression: "fetch('/private')",
    parameters: { coefficient: 2, constant: 3, solution: 4, variable: "x;alert(1)" }
  });
  assert.equal(textContent(algebraContainer).includes("fetch"), false);
  assert.equal(textContent(algebraContainer).includes("alert"), false);
  assert.match(textContent(algebraContainer), /2x \+ 3 = 11/u);
});

test("mount rejects a non-DOM target without consulting browser globals", () => {
  assert.throws(
    () => mountInteractiveVisual({}, { variant: "linear" }),
    /DOM container/u
  );
});

function exampleSpec(variant) {
  const variants = {
    linear: { variant, parameters: { slope: 1.5, intercept: 1 } },
    quadratic: { variant, parameters: { a: 0.5, h: 1, k: -1 } },
    numberline: { variant, min: -5, max: 5, value: -2 },
    triangle: { variant, parameters: { a: 3, b: 4 } },
    circle: { variant, parameters: { radius: 4, angle: 120 } },
    coordinate: { variant, points: [{ x: 2, y: 3, label: "A" }, { x: -1, y: 1, label: "B" }] },
    statistics: { variant, values: [3, 5, 8, 4], labels: ["甲", "乙", "丙", "丁"] },
    probability: { variant, favorable: 3, total: 8 },
    algebra: { variant, parameters: { coefficient: 2, constant: 3, solution: 4 } },
    concept: { variant, center: "函数", items: ["定义", "图像", "性质", "应用"] }
  };
  return { id: `visual-${variant}`, title: `测试 ${variant}`, ...variants[variant] };
}

function pick(record, keys) {
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}

function findAll(root, tagName) {
  const target = String(tagName).toLowerCase();
  const matches = [];
  const visit = (node) => {
    if (String(node.localName || "").toLowerCase() === target) matches.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return matches;
}

function textContent(root) {
  return root.textContent;
}

function serializeFakeDom(root) {
  const attributes = [...root.attributes?.entries?.() || []].map(([key, value]) => `${key}=${value}`).join(" ");
  return `${root.localName || "root"} ${attributes} ${root.ownText || ""} ${[...root.children || []].map(serializeFakeDom).join(" ")}`;
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(this, tagName, null);
  }

  createElementNS(namespace, tagName) {
    return new FakeElement(this, tagName, namespace);
  }
}

class FakeElement {
  constructor(ownerDocument, tagName, namespaceURI) {
    this.ownerDocument = ownerDocument;
    this.localName = String(tagName).toLowerCase();
    this.tagName = String(tagName).toUpperCase();
    this.namespaceURI = namespaceURI;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.value = "";
    this.attributes = new Map();
    this.listeners = new Map();
    this.ownText = "";
  }

  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.replaceChildren();
    this.ownText = String(value ?? "");
  }

  set innerHTML(_value) {
    throw new Error("innerHTML must not be used by the interactive renderer");
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    if (node.parentNode) {
      const index = node.parentNode.children.indexOf(node);
      if (index >= 0) node.parentNode.children.splice(index, 1);
    }
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.ownText = "";
    this.append(...nodes);
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }

  addEventListener(type, listener) {
    const handlers = this.listeners.get(type) || new Set();
    handlers.add(listener);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return true;
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
}
