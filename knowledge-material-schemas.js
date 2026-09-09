export const KNOWLEDGE_MATERIAL_SCHEMA_NAMES = Object.freeze({
  shared: "knowledge_shared_analysis",
  deeptutor: "knowledge_deeptutor",
  openmaic: "knowledge_openmaic",
  cellStudio: "knowledge_cell_studio",
  koji: "knowledge_koji"
});

export const KNOWLEDGE_MATERIAL_LIMITS = Object.freeze({
  sourceText: 20000,
  shortText: 160,
  mediumText: 800,
  longText: 2400,
  claims: 12,
  conceptNodes: 16,
  blocks: 8,
  flashcards: 8,
  outlines: 8,
  sceneElements: 12,
  timelineActions: 24,
  spatialNodes: 20,
  spatialEdges: 30
});

const IDENTIFIER_PATTERN = "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$";

function objectSchema(properties, required = Object.keys(properties)) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}

function arraySchema(items, minItems, maxItems, { uniqueItems = false } = {}) {
  return {
    type: "array",
    items,
    minItems,
    maxItems,
    ...(uniqueItems ? { uniqueItems: true } : {})
  };
}

function stringSchema(minLength, maxLength, extra = {}) {
  return { type: "string", minLength, maxLength, ...extra };
}

function identifierSchema(maxLength = 96) {
  return stringSchema(1, maxLength, { pattern: IDENTIFIER_PATTERN });
}

function referenceArraySchema(minItems, maxItems) {
  return arraySchema(identifierSchema(), minItems, maxItems, {
    uniqueItems: true
  });
}

function integerSchema(minimum, maximum) {
  return { type: "integer", minimum, maximum };
}

function numberSchema(minimum, maximum) {
  return { type: "number", minimum, maximum };
}

function enumSchema(values) {
  return { type: "string", enum: values };
}

function vectorSchema(minimum = -1000, maximum = 1000) {
  return objectSchema({
    x: numberSchema(minimum, maximum),
    y: numberSchema(minimum, maximum),
    z: numberSchema(minimum, maximum)
  });
}

const claimSchema = objectSchema({
  id: identifierSchema(),
  text: stringSchema(8, 600),
  source_support: stringSchema(4, 500)
});

const objectiveSchema = objectSchema({
  id: identifierSchema(),
  text: stringSchema(4, 400),
  claim_ids: referenceArraySchema(1, 6)
});

const misconceptionSchema = objectSchema({
  id: identifierSchema(),
  incorrect: stringSchema(4, 400),
  correction: stringSchema(4, 500),
  claim_ids: referenceArraySchema(1, 6)
});

const visualOpportunitySchema = objectSchema({
  id: identifierSchema(),
  description: stringSchema(4, 500),
  preferred_form: enumSchema([
    "concept_graph",
    "guided_hint",
    "scene",
    "spatial"
  ]),
  claim_ids: referenceArraySchema(1, 6)
});

const vocabularySchema = objectSchema({
  term: stringSchema(1, 80),
  definition: stringSchema(4, 400),
  claim_ids: referenceArraySchema(1, 6)
});

const sharedSchema = objectSchema({
  topic_id: identifierSchema(48),
  title: stringSchema(2, 160),
  subject: stringSchema(2, 80),
  grade_band: stringSchema(2, 80),
  language: stringSchema(2, 40),
  core_claims: arraySchema(claimSchema, 2, KNOWLEDGE_MATERIAL_LIMITS.claims),
  learning_objectives: arraySchema(objectiveSchema, 1, 8),
  misconceptions: arraySchema(misconceptionSchema, 0, 8),
  visual_opportunities: arraySchema(visualOpportunitySchema, 1, 8),
  concept_vocabulary: arraySchema(vocabularySchema, 2, 16)
});

const conceptNodeSchema = objectSchema({
  id: identifierSchema(),
  label: stringSchema(1, 80),
  summary: stringSchema(4, 320),
  claim_ids: referenceArraySchema(1, 6)
});

const conceptEdgeSchema = objectSchema({
  id: identifierSchema(),
  from: identifierSchema(),
  to: identifierSchema(),
  relation: stringSchema(1, 80)
});

const learningBlockSchema = objectSchema({
  id: identifierSchema(),
  type: enumSchema([
    "summary",
    "explanation",
    "formula",
    "example",
    "callout",
    "timeline"
  ]),
  title: stringSchema(1, 120),
  content: stringSchema(4, 1200),
  claim_ids: referenceArraySchema(1, 8)
});

const flashcardSchema = objectSchema({
  id: identifierSchema(),
  front: stringSchema(2, 240),
  back: stringSchema(2, 600),
  claim_ids: referenceArraySchema(1, 6)
});

const a2uiProjectionSchema = objectSchema(
  {
    title: stringSchema(2, 120),
    summary: stringSchema(4, 320),
    body: stringSchema(8, 900),
    formula: stringSchema(1, 160),
    key_points: arraySchema(stringSchema(1, 180), 2, 5),
    callout: stringSchema(2, 260)
  },
  ["title", "summary", "body", "key_points"]
);

const deeptutorSchema = objectSchema({
  concept_graph: objectSchema({
    root_id: identifierSchema(),
    nodes: arraySchema(
      conceptNodeSchema,
      3,
      KNOWLEDGE_MATERIAL_LIMITS.conceptNodes
    ),
    edges: arraySchema(
      conceptEdgeSchema,
      2,
      KNOWLEDGE_MATERIAL_LIMITS.conceptNodes - 1
    )
  }),
  blocks: arraySchema(
    learningBlockSchema,
    2,
    KNOWLEDGE_MATERIAL_LIMITS.blocks
  ),
  flashcards: arraySchema(
    flashcardSchema,
    2,
    KNOWLEDGE_MATERIAL_LIMITS.flashcards
  ),
  a2ui_projection: a2uiProjectionSchema
});

const outlineTypeSchema = enumSchema([
  "explanation",
  "quiz",
  "diagram",
  "simulation"
]);

const lessonOutlineSchema = objectSchema({
  id: identifierSchema(),
  order: integerSchema(1, 20),
  type: outlineTypeSchema,
  title: stringSchema(2, 120),
  objective: stringSchema(4, 320),
  claim_ids: referenceArraySchema(1, 8)
});

// Compact element metadata is deliberately a small, trusted vocabulary. The
// local validator still enforces safe JSON depth and forbidden field names.
const elementDataSchema = objectSchema(
  {
    emphasis: enumSchema(["primary", "secondary", "muted"]),
    variant: stringSchema(0, 80),
    value: stringSchema(0, 500),
    unit: stringSchema(0, 40),
    visible: { type: "boolean" },
    progress: numberSchema(-1000000, 1000000),
    phase: stringSchema(0, 80)
  },
  []
);

const sceneElementSchema = objectSchema(
  {
    id: identifierSchema(),
    kind: enumSchema([
      "text",
      "formula",
      "diagram_node",
      "control",
      "choice",
      "media_placeholder"
    ]),
    label: stringSchema(1, 100),
    content: stringSchema(1, 600),
    data: elementDataSchema
  },
  ["id", "kind", "label", "content"]
);

const compactSceneSchema = objectSchema({
  id: identifierSchema(),
  outline_id: identifierSchema(),
  type: outlineTypeSchema,
  title: stringSchema(2, 120),
  summary: stringSchema(4, 500),
  elements: arraySchema(
    sceneElementSchema,
    1,
    KNOWLEDGE_MATERIAL_LIMITS.sceneElements
  )
});

const presentationStateSchema = objectSchema(
  {
    phase: stringSchema(0, 80),
    visible: { type: "boolean" },
    active: { type: "boolean" },
    progress: numberSchema(-1000000, 1000000),
    selected_id: identifierSchema(),
    value: stringSchema(0, 500)
  },
  []
);

const presentationActionSchema = objectSchema(
  {
    id: identifierSchema(),
    order: integerSchema(1, 100),
    scene_id: identifierSchema(),
    type: enumSchema(["spotlight", "reveal", "annotate", "set_state"]),
    target_id: identifierSchema(),
    narration: stringSchema(2, 500),
    duration_ms: integerSchema(0, 8000),
    state: presentationStateSchema
  },
  [
    "id",
    "order",
    "scene_id",
    "type",
    "target_id",
    "narration",
    "duration_ms"
  ]
);

const quizOptionSchema = objectSchema({
  id: enumSchema(["A", "B", "C", "D"]),
  value: enumSchema(["A", "B", "C", "D"]),
  label: stringSchema(1, 180)
});

const privateQuizSchema = objectSchema({
  question_id: identifierSchema(),
  title: stringSchema(2, 120),
  prompt: stringSchema(8, 600),
  options: arraySchema(quizOptionSchema, 4, 4),
  hint: stringSchema(4, 300),
  correct_option: enumSchema(["A", "B", "C", "D"]),
  explanation: stringSchema(8, 700),
  claim_ids: referenceArraySchema(1, 8)
});

const openmaicSchema = objectSchema({
  outlines: arraySchema(
    lessonOutlineSchema,
    2,
    KNOWLEDGE_MATERIAL_LIMITS.outlines
  ),
  scenes: arraySchema(
    compactSceneSchema,
    2,
    KNOWLEDGE_MATERIAL_LIMITS.outlines
  ),
  presentation_timeline: arraySchema(
    presentationActionSchema,
    1,
    KNOWLEDGE_MATERIAL_LIMITS.timelineActions
  ),
  quiz: privateQuizSchema
});

const boundsSchema = objectSchema({
  min: vectorSchema(),
  max: vectorSchema(),
  unit: stringSchema(1, 32)
});

const cameraSchema = objectSchema({
  position: vectorSchema(-10000, 10000),
  target: vectorSchema(-10000, 10000),
  fov: numberSchema(20, 120)
});

const nodeGeometrySchema = objectSchema(
  {
    shape: enumSchema(["sphere", "box", "cylinder", "plane", "custom"]),
    position: vectorSchema(),
    size: vectorSchema(0.001, 10000),
    rotation: vectorSchema(-360, 360)
  },
  ["shape", "position", "size"]
);

const spatialNodeSchema = objectSchema({
  id: identifierSchema(),
  label: stringSchema(1, 100),
  kind: enumSchema(["concept", "structure", "process", "annotation"]),
  description: stringSchema(4, 500),
  geometry: nodeGeometrySchema,
  claim_ids: referenceArraySchema(1, 6)
});

const spatialEdgeSchema = objectSchema({
  id: identifierSchema(),
  from: identifierSchema(),
  to: identifierSchema(),
  relation: stringSchema(1, 100),
  geometry: objectSchema({
    path: arraySchema(vectorSchema(), 2, 12)
  })
});

const spatialLayerSchema = objectSchema({
  id: identifierSchema(),
  label: stringSchema(1, 100),
  node_ids: referenceArraySchema(1, KNOWLEDGE_MATERIAL_LIMITS.spatialNodes),
  default_visible: { type: "boolean" }
});

const cellStudioSchema = objectSchema({
  spatial_scene: objectSchema({
    id: identifierSchema(),
    title: stringSchema(2, 140),
    description: stringSchema(4, 600),
    coordinate_system: {
      type: "string",
      const: "cartesian-3d"
    },
    camera: cameraSchema,
    bounds: boundsSchema,
    nodes: arraySchema(
      spatialNodeSchema,
      3,
      KNOWLEDGE_MATERIAL_LIMITS.spatialNodes
    ),
    edges: arraySchema(
      spatialEdgeSchema,
      2,
      KNOWLEDGE_MATERIAL_LIMITS.spatialEdges
    ),
    layers: arraySchema(spatialLayerSchema, 1, 8)
  })
});

const guidedStateSchema = objectSchema(
  {
    id: identifierSchema(),
    order: integerSchema(1, 20),
    trigger: enumSchema([
      "start",
      "hesitation",
      "incorrect",
      "hint_request",
      "progress",
      "success"
    ]),
    label: stringSchema(1, 80),
    focus_target: stringSchema(1, 120),
    teacher_move: stringSchema(4, 400),
    learner_prompt: stringSchema(2, 320),
    transition_to: identifierSchema()
  },
  [
    "id",
    "order",
    "trigger",
    "label",
    "focus_target",
    "teacher_move",
    "learner_prompt"
  ]
);

const hintLevelSchema = objectSchema({
  level: integerSchema(1, 4),
  text: stringSchema(4, 360),
  focus_target: stringSchema(1, 120),
  reveals_answer: {
    type: "boolean",
    const: false
  }
});

const layeredHintSchema = objectSchema({
  id: identifierSchema(),
  question_id: identifierSchema(),
  levels: arraySchema(hintLevelSchema, 2, 4)
});

const attentionCueSchema = objectSchema({
  id: identifierSchema(),
  target_id: stringSchema(1, 120),
  type: enumSchema(["pulse", "spotlight", "path_trace", "annotation"]),
  duration_ms: integerSchema(80, 4000)
});

const kojiSchema = objectSchema({
  guided_states: arraySchema(guidedStateSchema, 3, 8),
  layered_hints: arraySchema(layeredHintSchema, 1, 3),
  attention_cues: arraySchema(attentionCueSchema, 1, 12)
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const KNOWLEDGE_MATERIAL_SCHEMAS = deepFreeze({
  [KNOWLEDGE_MATERIAL_SCHEMA_NAMES.shared]: sharedSchema,
  [KNOWLEDGE_MATERIAL_SCHEMA_NAMES.deeptutor]: deeptutorSchema,
  [KNOWLEDGE_MATERIAL_SCHEMA_NAMES.openmaic]: openmaicSchema,
  [KNOWLEDGE_MATERIAL_SCHEMA_NAMES.cellStudio]: cellStudioSchema,
  [KNOWLEDGE_MATERIAL_SCHEMA_NAMES.koji]: kojiSchema
});

export function getKnowledgeMaterialSchema(schemaName) {
  return KNOWLEDGE_MATERIAL_SCHEMAS[schemaName] || null;
}
