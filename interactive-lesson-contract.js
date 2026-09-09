import { createKnowledgeCardParameterization } from "./public/knowledge-card-parameter-contract.js";

const LESSON_VERSION = "1.0";

export const INTERACTIVE_LESSON_ARTIFACTS = Object.freeze([
  "function_graph",
  "projectile_lab",
  "physics_lab",
  "acid_base_lab",
  "mindmap",
  "concept_cards",
]);

export const INTERACTIVE_LESSON_PRESETS = Object.freeze([
  "quadratic",
  "linear",
  "sine",
  "projectile",
  "inclined_plane",
  "pendulum",
  "collision",
  "acid_base_titration",
  "concept_map",
  "flashcards",
]);

export const INTERACTIVE_LESSON_PHYSICS_ENGINES = Object.freeze(["matter", "planck"]);
export const INTERACTIVE_LESSON_PHYSICS_PRESETS = Object.freeze([
  "inclined_plane", "pendulum", "collision",
]);

const ARTIFACT_PRESETS = Object.freeze({
  function_graph: new Set(["quadratic", "linear", "sine"]),
  projectile_lab: new Set(["projectile"]),
  physics_lab: new Set(INTERACTIVE_LESSON_PHYSICS_PRESETS),
  acid_base_lab: new Set(["acid_base_titration"]),
  mindmap: new Set(["concept_map"]),
  concept_cards: new Set(["flashcards"]),
});

const DEFAULT_PARAMETERS = Object.freeze({
  quadratic: Object.freeze({ a: 1, b: 0, c: 0 }),
  linear: Object.freeze({ a: 1, b: 0 }),
  sine: Object.freeze({ amplitude: 1, frequency: 1, phase: 0 }),
  projectile: Object.freeze({ initial_speed: 20, angle: 45, gravity: 9.8 }),
  inclined_plane: Object.freeze({ angle: 30, friction: 0.1, gravity: 9.8, mass: 1 }),
  pendulum: Object.freeze({ length: 1.5, angle: 25, gravity: 9.8, mass: 1 }),
  collision: Object.freeze({ mass: 1, mass_b: 1, initial_speed: 3, restitution: 0.9 }),
  acid_base_titration: Object.freeze({
    acid_concentration: 0.1,
    acid_volume_ml: 20,
    base_concentration: 0.1,
    added_base_ml: 0,
  }),
  concept_map: Object.freeze({}),
  flashcards: Object.freeze({}),
});

const PHYSICS_PARAMETER_LIMITS = Object.freeze({
  inclined_plane: Object.freeze({ angle: [5, 60], friction: [0, 0.6], gravity: [1, 20], mass: [0.2, 5] }),
  pendulum: Object.freeze({ length: [0.5, 3], angle: [5, 60], gravity: [1, 20], mass: [0.2, 5] }),
  collision: Object.freeze({ mass: [0.2, 5], mass_b: [0.2, 5], initial_speed: [0.5, 8], restitution: [0, 1] }),
});

const PARAMETER_LIMITS = Object.freeze({
  a: [-8, 8],
  b: [-12, 12],
  c: [-12, 12],
  amplitude: [0.2, 6],
  frequency: [0.2, 4],
  phase: [-6.3, 6.3],
  initial_speed: [5, 60],
  angle: [5, 85],
  gravity: [1, 20],
  acid_concentration: [0.01, 1],
  acid_volume_ml: [5, 100],
  base_concentration: [0.01, 1],
  added_base_ml: [0, 120],
});

const PARAMETER_STEPS = Object.freeze({
  a: 0.1,
  b: 0.1,
  c: 0.1,
  amplitude: 0.1,
  frequency: 0.1,
  phase: 0.1,
  initial_speed: 1,
  angle: 1,
  gravity: 0.1,
  acid_concentration: 0.01,
  acid_volume_ml: 1,
  base_concentration: 0.01,
  added_base_ml: 1,
  friction: 0.01,
  length: 0.1,
  mass: 0.1,
  mass_b: 0.1,
  restitution: 0.01,
});

export class InteractiveLessonContractError extends Error {
  constructor(code, message, path = "") {
    super(message);
    this.name = "InteractiveLessonContractError";
    this.code = code;
    this.path = path;
  }
}

export function validateInteractiveLessonRequest(value) {
  const source = objectValue(value, "request");
  const subject = safeText(source.subject, 2, 40, "subject");
  const gradeBand = safeText(source.grade_band, 1, 40, "grade_band");
  const knowledgePoint = safeText(
    source.knowledge_point,
    2,
    160,
    "knowledge_point",
  );
  const learningGoal = safeText(
    source.learning_goal || `理解并应用${knowledgePoint}`,
    2,
    600,
    "learning_goal",
  );
  const preferredArtifact = optionalEnum(
    source.preferred_artifact,
    INTERACTIVE_LESSON_ARTIFACTS,
    "preferred_artifact",
  );
  const sourceText = optionalText(source.source_text, 4_000);
  const physicsEngine = optionalEnum(
    source.physics_engine,
    ["auto", ...INTERACTIVE_LESSON_PHYSICS_ENGINES],
    "physics_engine",
  ) || "auto";
  const physicsPreset = optionalEnum(
    source.physics_preset,
    INTERACTIVE_LESSON_PHYSICS_PRESETS,
    "physics_preset",
  );
  const image = normalizeImageInput(source.image);

  return Object.freeze({
    subject,
    grade_band: gradeBand,
    knowledge_point: knowledgePoint,
    learning_goal: learningGoal,
    preferred_artifact: preferredArtifact,
    physics_engine: physicsEngine,
    physics_preset: physicsPreset,
    source_text: sourceText,
    image,
  });
}

export function normalizeInteractiveLessonDsl(value, request = {}) {
  const root = objectValue(value, "lesson");
  const artifactType = enumValue(
    root.artifact_type,
    INTERACTIVE_LESSON_ARTIFACTS,
    "artifact_type",
  );
  const preset = enumValue(
    root.visualization?.preset,
    INTERACTIVE_LESSON_PRESETS,
    "visualization.preset",
  );
  if (!ARTIFACT_PRESETS[artifactType]?.has(preset)) {
    throw contractError(
      "lesson_preset_mismatch",
      `preset ${preset} cannot render artifact_type ${artifactType}`,
      "visualization.preset",
    );
  }
  if (request.preferred_artifact === "physics_lab" && artifactType !== "physics_lab") {
    throw contractError("lesson_artifact_mismatch", "requested physics_lab must use a physics experiment preset", "artifact_type");
  }
  if (artifactType === "physics_lab" && request.physics_preset && request.physics_preset !== preset) {
    throw contractError("lesson_preset_mismatch", "physics preset must match the requested experiment", "visualization.preset");
  }
  const physicsEngine = normalizePhysicsEngine(root.visualization?.engine, artifactType, preset, request);

  const learningObjectives = stringArray(
    root.learning_objectives,
    1,
    5,
    200,
    "learning_objectives",
  );
  const keyPoints = stringArray(root.key_points, 2, 6, 240, "key_points");
  const nodes = normalizeNodes(root.visualization?.nodes, artifactType);
  const cards = normalizeCards(root.visualization?.cards, artifactType);
  const parameters = normalizeParameters(root.visualization?.parameters, preset);

  return Object.freeze({
    version: LESSON_VERSION,
    lesson_id: createLessonId(),
    title: safeText(root.title, 2, 100, "title"),
    subtitle: safeText(root.subtitle, 2, 180, "subtitle"),
    subject: optionalText(request.subject, 40) || safeText(root.subject, 1, 40, "subject"),
    grade_band:
      optionalText(request.grade_band, 40) || safeText(root.grade_band, 1, 40, "grade_band"),
    knowledge_point:
      optionalText(request.knowledge_point, 160) || safeText(root.knowledge_point, 2, 160, "knowledge_point"),
    artifact_type: artifactType,
    explanation: safeText(root.explanation, 8, 1_000, "explanation"),
    learning_objectives: learningObjectives,
    key_points: keyPoints,
    misconception: optionalText(root.misconception, 400),
    guidance: Object.freeze({
      prediction_prompt: safeText(
        root.guidance?.prediction_prompt,
        4,
        300,
        "guidance.prediction_prompt",
      ),
      observation_prompt: safeText(
        root.guidance?.observation_prompt,
        4,
        300,
        "guidance.observation_prompt",
      ),
      transfer_question: safeText(
        root.guidance?.transfer_question,
        4,
        300,
        "guidance.transfer_question",
      ),
    }),
    visualization: Object.freeze({
      preset,
      ...(physicsEngine ? { engine: physicsEngine } : {}),
      parameters,
      nodes,
      cards,
    }),
    parameterization: createKnowledgeCardParameterization({
      parameters: parameterDefinitionsForPreset(preset),
      renderer: "deterministic-lesson-player",
      rendererVersion: "1.0",
      templateId: `${artifactType}:${preset}`,
      cardType: "knowledge.interactive_lesson",
      staticReason: artifactType === "mindmap"
        ? "model_compiled_mindmap_structure"
        : "model_compiled_concept_cards",
    }),
    runtime: Object.freeze({
      renderer: "deterministic-lesson-player",
      renderer_version: "1.0",
      executable_model_code: false,
      ...(physicsEngine ? { physics_engine: physicsEngine } : {}),
    }),
  });
}

export function interactiveLessonSummary(lesson) {
  return {
    lesson_id: lesson.lesson_id,
    title: lesson.title,
    artifact_type: lesson.artifact_type,
    preset: lesson.visualization.preset,
    ...(lesson.visualization.engine ? { engine: lesson.visualization.engine } : {}),
    objective_count: lesson.learning_objectives.length,
  };
}

function normalizeImageInput(value) {
  if (value === undefined || value === null || value === "") return null;
  const image = objectValue(value, "image");
  const mimeType = String(image.mime_type || "").trim().toLowerCase();
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(mimeType)) {
    throw contractError(
      "lesson_image_type_invalid",
      "image must be PNG, JPEG, or WebP",
      "image.mime_type",
    );
  }
  const data = String(image.data || "").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) {
    throw contractError(
      "lesson_image_data_invalid",
      "image.data must be base64 without a data URL prefix",
      "image.data",
    );
  }
  const approximateBytes = Math.ceil((data.length * 3) / 4);
  if (approximateBytes > 8 * 1024 * 1024) {
    throw contractError(
      "lesson_image_too_large",
      "image must be at most 8 MB",
      "image.data",
    );
  }
  return Object.freeze({ mime_type: mimeType, data });
}

function normalizeParameters(value, preset) {
  const defaults = DEFAULT_PARAMETERS[preset] || {};
  if (PHYSICS_PARAMETER_LIMITS[preset]) {
    const source = value === undefined ? {} : objectValue(value, "visualization.parameters");
    for (const key of Object.keys(source)) {
      if (!Object.hasOwn(defaults, key)) {
        throw contractError("lesson_parameter_unknown", `parameter ${key} is not supported by ${preset}`, `visualization.parameters.${key}`);
      }
    }
    const result = {};
    for (const [key, fallback] of Object.entries(defaults)) {
      const candidate = source[key] === undefined ? fallback : source[key];
      const [minimum, maximum] = PHYSICS_PARAMETER_LIMITS[preset][key];
      if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < minimum || candidate > maximum) {
        throw contractError("lesson_parameter_invalid", `${key} must be a finite number between ${minimum} and ${maximum}`, `visualization.parameters.${key}`);
      }
      result[key] = candidate;
    }
    return Object.freeze(result);
  }
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const candidate = Number(source[key]);
    const [minimum, maximum] = PARAMETER_LIMITS[key];
    result[key] = Number.isFinite(candidate)
      ? clamp(candidate, minimum, maximum)
      : fallback;
  }
  return Object.freeze(result);
}

function parameterDefinitionsForPreset(preset) {
  const defaults = DEFAULT_PARAMETERS[preset] || {};
  return Object.entries(defaults).map(([key, fallback]) => {
    const [minimum, maximum] = PHYSICS_PARAMETER_LIMITS[preset]?.[key] || PARAMETER_LIMITS[key];
    return {
      key,
      label: key.replaceAll("_", " "),
      control: "range",
      min: minimum,
      max: maximum,
      step: preset === "collision" && key === "initial_speed" ? 0.1 : PARAMETER_STEPS[key] || 0.1,
      default: fallback,
    };
  });
}

function normalizePhysicsEngine(value, artifactType, preset, request) {
  if (artifactType !== "physics_lab") {
    if (value !== undefined && value !== null && value !== "") {
      throw contractError("lesson_engine_mismatch", "physics engines are only available for physics_lab", "visualization.engine");
    }
    return "";
  }
  const modelEngine = optionalEnum(value, INTERACTIVE_LESSON_PHYSICS_ENGINES, "visualization.engine");
  const requestedEngine = optionalEnum(request.physics_engine, ["auto", ...INTERACTIVE_LESSON_PHYSICS_ENGINES], "physics_engine");
  if (requestedEngine && requestedEngine !== "auto") return requestedEngine;
  if (requestedEngine === "auto") return preset === "collision" ? "planck" : "matter";
  return modelEngine || (preset === "collision" ? "planck" : "matter");
}

function normalizeNodes(value, artifactType) {
  if (artifactType !== "mindmap") return Object.freeze([]);
  if (!Array.isArray(value) || value.length < 3 || value.length > 18) {
    throw contractError(
      "lesson_nodes_invalid",
      "mindmap must contain 3 to 18 nodes",
      "visualization.nodes",
    );
  }
  const seen = new Set();
  const nodes = value.map((item, index) => {
    const source = objectValue(item, `visualization.nodes[${index}]`);
    const id = identifier(source.id, `visualization.nodes[${index}].id`);
    if (seen.has(id)) {
      throw contractError(
        "lesson_node_duplicate",
        `duplicate node id ${id}`,
        `visualization.nodes[${index}].id`,
      );
    }
    seen.add(id);
    return {
      id,
      label: safeText(source.label, 1, 80, `visualization.nodes[${index}].label`),
      parent_id: optionalIdentifier(
        source.parent_id,
        `visualization.nodes[${index}].parent_id`,
      ),
      detail: safeText(
        source.detail,
        2,
        300,
        `visualization.nodes[${index}].detail`,
      ),
    };
  });
  const roots = nodes.filter((node) => !node.parent_id);
  if (roots.length !== 1) {
    throw contractError(
      "lesson_nodes_root_invalid",
      "mindmap must contain exactly one root node",
      "visualization.nodes",
    );
  }
  for (const node of nodes) {
    if (node.parent_id && !seen.has(node.parent_id)) {
      throw contractError(
        "lesson_node_parent_missing",
        `node ${node.id} references a missing parent`,
        "visualization.nodes",
      );
    }
  }
  return Object.freeze(nodes.map(Object.freeze));
}

function normalizeCards(value, artifactType) {
  if (artifactType !== "concept_cards") return Object.freeze([]);
  if (!Array.isArray(value) || value.length < 3 || value.length > 10) {
    throw contractError(
      "lesson_cards_invalid",
      "concept_cards must contain 3 to 10 cards",
      "visualization.cards",
    );
  }
  return Object.freeze(value.map((item, index) => {
    const source = objectValue(item, `visualization.cards[${index}]`);
    return Object.freeze({
      front: safeText(source.front, 1, 140, `visualization.cards[${index}].front`),
      back: safeText(source.back, 2, 500, `visualization.cards[${index}].back`),
      accent: optionalEnum(
        source.accent,
        ["blue", "teal", "violet", "amber", "rose"],
        `visualization.cards[${index}].accent`,
      ) || ["blue", "teal", "violet", "amber", "rose"][index % 5],
    });
  }));
}

function objectValue(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw contractError("lesson_object_expected", `${path} must be an object`, path);
  }
  return value;
}

function safeText(value, minimum, maximum, path) {
  const result = String(value || "").replace(/\s+/gu, " ").trim();
  if (result.length < minimum || result.length > maximum) {
    throw contractError(
      "lesson_text_invalid",
      `${path} must contain ${minimum} to ${maximum} characters`,
      path,
    );
  }
  return result;
}

function optionalText(value, maximum) {
  const result = String(value || "").replace(/\s+/gu, " ").trim();
  return result ? result.slice(0, maximum) : "";
}

function stringArray(value, minimum, maximum, maximumLength, path) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw contractError(
      "lesson_array_invalid",
      `${path} must contain ${minimum} to ${maximum} items`,
      path,
    );
  }
  return Object.freeze(value.map((item, index) =>
    safeText(item, 1, maximumLength, `${path}[${index}]`)));
}

function enumValue(value, allowed, path) {
  const result = String(value || "").trim();
  if (!allowed.includes(result)) {
    throw contractError(
      "lesson_enum_invalid",
      `${path} must be one of ${allowed.join(", ")}`,
      path,
    );
  }
  return result;
}

function optionalEnum(value, allowed, path) {
  if (value === undefined || value === null || value === "") return "";
  return enumValue(value, allowed, path);
}

function identifier(value, path) {
  const result = String(value || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/u.test(result)) {
    throw contractError(
      "lesson_identifier_invalid",
      `${path} must be a safe identifier`,
      path,
    );
  }
  return result;
}

function optionalIdentifier(value, path) {
  return value === undefined || value === null || value === ""
    ? ""
    : identifier(value, path);
}

function contractError(code, message, path) {
  return new InteractiveLessonContractError(code, message, path);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createLessonId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `lesson_${Date.now().toString(36)}_${random}`;
}
