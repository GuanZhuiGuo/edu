/**
 * Education document import contracts.
 *
 * This module deliberately contains no model, network, storage, or UI code. It
 * is the authority boundary between untrusted document parsing output and the
 * later curriculum, question-bank, and learner-evidence projections.
 */

export const EDUCATION_IMPORT_SCHEMA_VERSION = "1.0";

export const DOCUMENT_TYPES = Object.freeze([
  "curriculum_standard",
  "exam_syllabus",
  "textbook",
  "courseware",
  "question_collection",
  "homework_template",
  "student_homework",
  "exam_paper",
  "student_exam",
  "answer_key",
  "grading_sheet",
  "unknown"
]);

export const BLOCK_TYPES = Object.freeze([
  "heading",
  "paragraph",
  "list_item",
  "table",
  "formula",
  "image",
  "diagram",
  "question_stem",
  "question_option",
  "answer",
  "solution",
  "student_response",
  "teacher_mark",
  "score",
  "page_header",
  "page_footer"
]);

export const REVIEW_STATUSES = Object.freeze([
  "candidate",
  "needs_review",
  "verified",
  "rejected"
]);

export const CURRICULUM_CANDIDATE_TYPES = Object.freeze([
  "standard_clause",
  "learning_objective",
  "knowledge_point",
  "competency"
]);

export const KNOWLEDGE_FORMS = Object.freeze([
  "concept",
  "principle",
  "theorem",
  "procedure",
  "representation",
  "application",
  "reasoning_practice",
  "unspecified"
]);

export const QUESTION_TYPES = Object.freeze([
  "single_choice",
  "multiple_choice",
  "true_false",
  "fill_blank",
  "short_answer",
  "calculation",
  "proof",
  "essay",
  "composite",
  "unknown"
]);

export const RESPONSE_TYPES = Object.freeze([
  "single_select",
  "multi_select",
  "boolean",
  "text",
  "number",
  "expression",
  "workings",
  "essay",
  "unknown"
]);

export const QUESTION_KNOWLEDGE_RELATIONS = Object.freeze([
  "assesses",
  "requires_knowledge"
]);

export const QUESTION_KNOWLEDGE_ROLES = Object.freeze([
  "primary",
  "secondary",
  "prerequisite",
  "supporting"
]);

export const ENTITY_TYPES = Object.freeze([
  "curriculum_standard",
  "standard_clause",
  "learning_objective",
  "knowledge_point",
  "knowledge_component",
  "competency",
  "canonical_concept",
  "representation",
  "application_context",
  "question_blueprint",
  "question",
  "question_part",
  "solution_strategy",
  "solution",
  "solution_step",
  "misconception",
  "rubric",
  "rubric_point",
  "artifact",
  "submission",
  "observation",
  "evidence_claim"
]);

export const TYPED_RELATION_TYPES = Object.freeze([
  "part_of",
  "derived_from_clause",
  "aligned_to_objective",
  "develops_competency",
  "prerequisite_of",
  "builds_on",
  "derived_from",
  "generalizes",
  "specializes",
  "contrasts_with",
  "equivalent_view_of",
  "represented_by",
  "applied_with",
  "instantiates_blueprint",
  "assesses",
  "requires_knowledge",
  "solvable_by",
  "uses_strategy",
  "targets_misconception",
  "misconception_of",
  "addressed_by",
  "explains",
  "visualizes",
  "responds_to",
  "graded_by",
  "derived_from_observation",
  "supports_claim",
  "refutes_claim",
  "realizes_concept",
  "uses_representation",
  "applies_in_context",
  "transfers_strategy_to",
  "analogous_to",
  "exact_match",
  "close_match",
  "broader_than",
  "narrower_than"
]);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const CONTENT_HASH_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/i;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SETS = Object.freeze({
  documentTypes: new Set(DOCUMENT_TYPES),
  blockTypes: new Set(BLOCK_TYPES),
  reviewStatuses: new Set(REVIEW_STATUSES),
  curriculumCandidateTypes: new Set(CURRICULUM_CANDIDATE_TYPES),
  knowledgeForms: new Set(KNOWLEDGE_FORMS),
  questionTypes: new Set(QUESTION_TYPES),
  responseTypes: new Set(RESPONSE_TYPES),
  qkRelations: new Set(QUESTION_KNOWLEDGE_RELATIONS),
  qkRoles: new Set(QUESTION_KNOWLEDGE_ROLES),
  entityTypes: new Set(ENTITY_TYPES),
  relationTypes: new Set(TYPED_RELATION_TYPES)
});

const TEXT_BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "list_item",
  "formula",
  "question_stem",
  "question_option",
  "answer",
  "solution",
  "student_response",
  "teacher_mark",
  "score",
  "page_header",
  "page_footer"
]);

const CURRICULUM_ENTITY_TYPES = new Set([
  "curriculum_standard",
  "standard_clause",
  "learning_objective",
  "knowledge_point",
  "knowledge_component",
  "competency"
]);

const KNOWLEDGE_ENTITY_TYPES = new Set([
  "knowledge_point",
  "knowledge_component"
]);

const RELATION_ENDPOINT_RULES = Object.freeze({
  derived_from_clause: [
    new Set(["learning_objective", "knowledge_point", "knowledge_component", "competency"]),
    new Set(["standard_clause"])
  ],
  aligned_to_objective: [
    new Set(["knowledge_point", "knowledge_component", "question", "question_blueprint"]),
    new Set(["learning_objective"])
  ],
  develops_competency: [CURRICULUM_ENTITY_TYPES, new Set(["competency"])],
  prerequisite_of: [KNOWLEDGE_ENTITY_TYPES, KNOWLEDGE_ENTITY_TYPES],
  builds_on: [KNOWLEDGE_ENTITY_TYPES, KNOWLEDGE_ENTITY_TYPES],
  generalizes: [KNOWLEDGE_ENTITY_TYPES, KNOWLEDGE_ENTITY_TYPES],
  specializes: [KNOWLEDGE_ENTITY_TYPES, KNOWLEDGE_ENTITY_TYPES],
  contrasts_with: [KNOWLEDGE_ENTITY_TYPES, KNOWLEDGE_ENTITY_TYPES],
  equivalent_view_of: [KNOWLEDGE_ENTITY_TYPES, KNOWLEDGE_ENTITY_TYPES],
  represented_by: [KNOWLEDGE_ENTITY_TYPES, new Set(["representation", "artifact"])],
  instantiates_blueprint: [new Set(["question"]), new Set(["question_blueprint"])],
  assesses: [new Set(["question", "question_part"]), KNOWLEDGE_ENTITY_TYPES],
  requires_knowledge: [
    new Set(["question", "question_part", "solution", "solution_step", "solution_strategy"]),
    KNOWLEDGE_ENTITY_TYPES
  ],
  solvable_by: [new Set(["question", "question_part"]), new Set(["solution", "solution_strategy"])],
  uses_strategy: [new Set(["solution", "solution_step"]), new Set(["solution_strategy"])],
  targets_misconception: [new Set(["question", "question_part", "question_blueprint"]), new Set(["misconception"])],
  misconception_of: [new Set(["misconception"]), KNOWLEDGE_ENTITY_TYPES],
  responds_to: [new Set(["submission"]), new Set(["question", "question_part"])],
  derived_from_observation: [new Set(["evidence_claim"]), new Set(["observation"])],
  supports_claim: [new Set(["observation", "evidence_claim"]), new Set(["evidence_claim"])],
  refutes_claim: [new Set(["observation", "evidence_claim"]), new Set(["evidence_claim"])],
  realizes_concept: [
    new Set(["knowledge_point", "knowledge_component"]),
    new Set(["canonical_concept"])
  ],
  uses_representation: [
    new Set(["knowledge_point", "knowledge_component", "question", "solution"]),
    new Set(["representation"])
  ],
  applies_in_context: [
    new Set(["knowledge_point", "knowledge_component", "question", "solution_strategy"]),
    new Set(["application_context"])
  ],
  transfers_strategy_to: [new Set(["solution_strategy"]), new Set(["application_context", "knowledge_point", "knowledge_component"])],
  exact_match: [CURRICULUM_ENTITY_TYPES, CURRICULUM_ENTITY_TYPES],
  close_match: [CURRICULUM_ENTITY_TYPES, CURRICULUM_ENTITY_TYPES],
  broader_than: [CURRICULUM_ENTITY_TYPES, CURRICULUM_ENTITY_TYPES],
  narrower_than: [CURRICULUM_ENTITY_TYPES, CURRICULUM_ENTITY_TYPES]
});

export class EducationImportValidationError extends TypeError {
  constructor(contractName, errors) {
    super(`${contractName} validation failed: ${errors.join("; ")}`);
    this.name = "EducationImportValidationError";
    this.contract_name = contractName;
    this.errors = [...errors];
  }
}

class ValidationContext {
  constructor() {
    this.errors = [];
  }

  add(path, message) {
    this.errors.push(`${path}: ${message}`);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function checkObject(ctx, value, path, { required = [], allowed = [] } = {}) {
  if (!isObject(value)) {
    ctx.add(path, "must be an object");
    return false;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) ctx.add(`${path}.${key}`, "is not allowed");
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) ctx.add(`${path}.${key}`, "is required");
  }
  return true;
}

function checkString(ctx, value, path, { min = 1, max = 12000, pattern } = {}) {
  if (typeof value !== "string") {
    ctx.add(path, "must be a string");
    return false;
  }
  if (value.length < min) ctx.add(path, `must contain at least ${min} characters`);
  if (value.length > max) ctx.add(path, `must contain no more than ${max} characters`);
  if (pattern && !pattern.test(value)) ctx.add(path, "has an invalid format");
  return true;
}

function checkOptionalString(ctx, value, path, options) {
  if (value === undefined) return true;
  return checkString(ctx, value, path, options);
}

function checkIdentifier(ctx, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return true;
  return checkString(ctx, value, path, { min: 1, max: 128, pattern: IDENTIFIER_PATTERN });
}

function checkEnum(ctx, value, path, allowed) {
  if (typeof value !== "string" || !allowed.has(value)) {
    ctx.add(path, `must be one of: ${[...allowed].join(", ")}`);
    return false;
  }
  return true;
}

function checkNumber(ctx, value, path, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    ctx.add(path, "must be a finite number");
    return false;
  }
  if (integer && !Number.isInteger(value)) ctx.add(path, "must be an integer");
  if (value < min || value > max) ctx.add(path, `must be between ${min} and ${max}`);
  return true;
}

function checkBoolean(ctx, value, path) {
  if (typeof value !== "boolean") {
    ctx.add(path, "must be a boolean");
    return false;
  }
  return true;
}

function checkArray(ctx, value, path, { min = 0, max = 10000 } = {}) {
  if (!Array.isArray(value)) {
    ctx.add(path, "must be an array");
    return false;
  }
  if (value.length < min || value.length > max) {
    ctx.add(path, `must contain between ${min} and ${max} items`);
  }
  return true;
}

function checkUniqueStrings(ctx, values, path, { identifiers = false, max = 128 } = {}) {
  if (!checkArray(ctx, values, path, { max })) return;
  const seen = new Set();
  values.forEach((value, index) => {
    const itemPath = `${path}[${index}]`;
    if (identifiers) checkIdentifier(ctx, value, itemPath);
    else checkString(ctx, value, itemPath, { min: 1, max: 400 });
    if (seen.has(value)) ctx.add(itemPath, "must be unique");
    seen.add(value);
  });
}

function checkIsoDateTime(ctx, value, path, { optional = false } = {}) {
  if (optional && value === undefined) return;
  if (!checkString(ctx, value, path, { min: 20, max: 40, pattern: ISO_DATETIME_PATTERN })) return;
  if (Number.isNaN(Date.parse(value))) ctx.add(path, "must be a valid UTC ISO-8601 date-time");
}

function validateBboxInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["x", "y", "width", "height", "unit"],
    allowed: ["x", "y", "width", "height", "unit"]
  })) return;
  checkNumber(ctx, value.x, `${path}.x`, { min: 0 });
  checkNumber(ctx, value.y, `${path}.y`, { min: 0 });
  checkNumber(ctx, value.width, `${path}.width`, { min: 0.000001 });
  checkNumber(ctx, value.height, `${path}.height`, { min: 0.000001 });
  checkEnum(ctx, value.unit, `${path}.unit`, new Set(["pdf_points", "pixels", "normalized"]));
  if (value.unit === "normalized") {
    for (const key of ["x", "y", "width", "height"]) {
      if (typeof value[key] === "number" && value[key] > 1) {
        ctx.add(`${path}.${key}`, "must be at most 1 for normalized coordinates");
      }
    }
    if (typeof value.x === "number" && typeof value.width === "number" && value.x + value.width > 1.000001) {
      ctx.add(path, "normalized x + width must not exceed 1");
    }
    if (typeof value.y === "number" && typeof value.height === "number" && value.y + value.height > 1.000001) {
      ctx.add(path, "normalized y + height must not exceed 1");
    }
  }
}

function validateSourceAnchorInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["document_id", "document_revision_id", "page_index", "block_ids"],
    allowed: [
      "document_id",
      "document_revision_id",
      "page_index",
      "printed_page",
      "block_ids",
      "bbox",
      "quote",
      "content_hash"
    ]
  })) return;
  checkIdentifier(ctx, value.document_id, `${path}.document_id`);
  checkIdentifier(ctx, value.document_revision_id, `${path}.document_revision_id`);
  checkNumber(ctx, value.page_index, `${path}.page_index`, { min: 0, integer: true });
  checkOptionalString(ctx, value.printed_page, `${path}.printed_page`, { min: 1, max: 40 });
  checkUniqueStrings(ctx, value.block_ids, `${path}.block_ids`, { identifiers: true, max: 64 });
  if (Array.isArray(value.block_ids) && value.block_ids.length === 0) {
    ctx.add(`${path}.block_ids`, "must contain at least one block id");
  }
  if (value.bbox !== undefined) validateBboxInto(ctx, value.bbox, `${path}.bbox`);
  checkOptionalString(ctx, value.quote, `${path}.quote`, { min: 1, max: 4000 });
  if (value.content_hash !== undefined) {
    checkString(ctx, value.content_hash, `${path}.content_hash`, {
      min: 64,
      max: 71,
      pattern: CONTENT_HASH_PATTERN
    });
  }
}

function validateConfidenceInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["overall", "extraction", "source_alignment"],
    allowed: [
      "overall",
      "layout",
      "text",
      "extraction",
      "source_alignment",
      "identity_mapping",
      "relation",
      "grading"
    ]
  })) return;
  for (const key of [
    "overall",
    "layout",
    "text",
    "extraction",
    "source_alignment",
    "identity_mapping",
    "relation",
    "grading"
  ]) {
    if (value[key] !== undefined) checkNumber(ctx, value[key], `${path}.${key}`, { min: 0, max: 1 });
  }
}

function validateProvenanceInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["method", "pipeline", "source_anchors", "parent_ids", "recorded_at"],
    allowed: ["method", "pipeline", "source_anchors", "parent_ids", "recorded_at"]
  })) return;
  checkEnum(ctx, value.method, `${path}.method`, new Set([
    "native_pdf",
    "ocr",
    "vlm",
    "hybrid",
    "parsed_block",
    "deterministic_rule",
    "human",
    "imported"
  ]));
  if (checkObject(ctx, value.pipeline, `${path}.pipeline`, {
    required: ["name", "version"],
    allowed: ["name", "version"]
  })) {
    checkIdentifier(ctx, value.pipeline.name, `${path}.pipeline.name`);
    checkString(ctx, value.pipeline.version, `${path}.pipeline.version`, { min: 1, max: 40 });
  }
  if (checkArray(ctx, value.source_anchors, `${path}.source_anchors`, { min: 1, max: 64 })) {
    value.source_anchors.forEach((anchor, index) => validateSourceAnchorInto(ctx, anchor, `${path}.source_anchors[${index}]`));
  }
  checkUniqueStrings(ctx, value.parent_ids, `${path}.parent_ids`, { identifiers: true, max: 128 });
  checkIsoDateTime(ctx, value.recorded_at, `${path}.recorded_at`);
}

function validateCandidateEnvelopeInto(ctx, value, path) {
  if (value.schema_version !== EDUCATION_IMPORT_SCHEMA_VERSION) {
    ctx.add(`${path}.schema_version`, `must equal ${EDUCATION_IMPORT_SCHEMA_VERSION}`);
  }
  checkIdentifier(ctx, value.id, `${path}.id`);
  checkIdentifier(ctx, value.revision_id, `${path}.revision_id`);
  checkEnum(ctx, value.review_status, `${path}.review_status`, SETS.reviewStatuses);
  validateProvenanceInto(ctx, value.provenance, `${path}.provenance`);
  validateConfidenceInto(ctx, value.confidence, `${path}.confidence`);
}

function validateKnowledgeHintsInto(ctx, value, path) {
  if (!checkArray(ctx, value, path, { max: 32 })) return;
  value.forEach((hint, index) => {
    const hintPath = `${path}[${index}]`;
    if (!checkObject(ctx, hint, hintPath, {
      required: ["knowledge_point_id", "relation", "role", "weight", "observable_indicator", "confidence"],
      allowed: ["knowledge_point_id", "relation", "role", "weight", "observable_indicator", "confidence"]
    })) return;
    checkIdentifier(ctx, hint.knowledge_point_id, `${hintPath}.knowledge_point_id`);
    checkEnum(ctx, hint.relation, `${hintPath}.relation`, SETS.qkRelations);
    checkEnum(ctx, hint.role, `${hintPath}.role`, SETS.qkRoles);
    checkNumber(ctx, hint.weight, `${hintPath}.weight`, { min: 0.000001, max: 1 });
    checkString(ctx, hint.observable_indicator, `${hintPath}.observable_indicator`, { min: 1, max: 600 });
    checkNumber(ctx, hint.confidence, `${hintPath}.confidence`, { min: 0, max: 1 });
    if (hint.relation === "assesses" && !["primary", "secondary"].includes(hint.role)) {
      ctx.add(`${hintPath}.role`, "assesses links must use primary or secondary role");
    }
    if (hint.relation === "requires_knowledge" && !["prerequisite", "supporting"].includes(hint.role)) {
      ctx.add(`${hintPath}.role`, "requires_knowledge links must use prerequisite or supporting role");
    }
  });
}

function validateBlockAnnotationsInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    allowed: [
      "question_number",
      "question_id",
      "part_id",
      "question_type",
      "response_type",
      "knowledge_links",
      "option_label",
      "score_value",
      "max_score",
      "is_final_grade",
      "assistance_level"
    ]
  })) return;
  checkOptionalString(ctx, value.question_number, `${path}.question_number`, { min: 1, max: 40 });
  if (value.question_id !== undefined) checkIdentifier(ctx, value.question_id, `${path}.question_id`);
  if (value.part_id !== undefined) checkIdentifier(ctx, value.part_id, `${path}.part_id`);
  if (value.question_type !== undefined) checkEnum(ctx, value.question_type, `${path}.question_type`, SETS.questionTypes);
  if (value.response_type !== undefined) checkEnum(ctx, value.response_type, `${path}.response_type`, SETS.responseTypes);
  if (value.knowledge_links !== undefined) validateKnowledgeHintsInto(ctx, value.knowledge_links, `${path}.knowledge_links`);
  checkOptionalString(ctx, value.option_label, `${path}.option_label`, { min: 1, max: 12 });
  if (value.score_value !== undefined) checkNumber(ctx, value.score_value, `${path}.score_value`, { min: 0, max: 1000000 });
  if (value.max_score !== undefined) checkNumber(ctx, value.max_score, `${path}.max_score`, { min: 0.000001, max: 1000000 });
  if (value.is_final_grade !== undefined) checkBoolean(ctx, value.is_final_grade, `${path}.is_final_grade`);
  if (value.assistance_level !== undefined) {
    checkEnum(ctx, value.assistance_level, `${path}.assistance_level`, new Set([
      "independent",
      "light_hint",
      "strong_hint",
      "answer_exposed",
      "unknown"
    ]));
  }
}

function validateDocumentBlockInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["id", "type", "page_index", "reading_order", "layer", "extraction"],
    allowed: [
      "id",
      "type",
      "page_index",
      "reading_order",
      "text",
      "normalized_text",
      "layer",
      "extraction",
      "bbox",
      "parent_block_id",
      "asset_id",
      "annotations"
    ]
  })) return;
  checkIdentifier(ctx, value.id, `${path}.id`);
  checkEnum(ctx, value.type, `${path}.type`, SETS.blockTypes);
  checkNumber(ctx, value.page_index, `${path}.page_index`, { min: 0, integer: true });
  checkNumber(ctx, value.reading_order, `${path}.reading_order`, { min: 0, integer: true });
  checkEnum(ctx, value.layer, `${path}.layer`, new Set(["printed", "student", "teacher", "unknown"]));
  if (TEXT_BLOCK_TYPES.has(value.type)) {
    checkString(ctx, value.text, `${path}.text`, { min: 1, max: 50000 });
  } else {
    checkOptionalString(ctx, value.text, `${path}.text`, { min: 1, max: 50000 });
  }
  checkOptionalString(ctx, value.normalized_text, `${path}.normalized_text`, { min: 1, max: 50000 });
  if (checkObject(ctx, value.extraction, `${path}.extraction`, {
    required: ["method", "confidence"],
    allowed: ["method", "confidence"]
  })) {
    checkEnum(ctx, value.extraction.method, `${path}.extraction.method`, new Set([
      "native_pdf",
      "ocr",
      "vlm",
      "hybrid",
      "human"
    ]));
    checkNumber(ctx, value.extraction.confidence, `${path}.extraction.confidence`, { min: 0, max: 1 });
  }
  if (value.bbox !== undefined) validateBboxInto(ctx, value.bbox, `${path}.bbox`);
  if (value.parent_block_id !== undefined) checkIdentifier(ctx, value.parent_block_id, `${path}.parent_block_id`);
  if (value.asset_id !== undefined) checkIdentifier(ctx, value.asset_id, `${path}.asset_id`);
  if (["image", "diagram"].includes(value.type) && !value.asset_id) {
    ctx.add(`${path}.asset_id`, "is required for image and diagram blocks");
  }
  if (value.annotations !== undefined) validateBlockAnnotationsInto(ctx, value.annotations, `${path}.annotations`);
}

function validateDocumentPageInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["index", "width", "height", "unit", "blocks"],
    allowed: ["index", "printed_page", "width", "height", "unit", "blocks"]
  })) return;
  checkNumber(ctx, value.index, `${path}.index`, { min: 0, integer: true });
  checkOptionalString(ctx, value.printed_page, `${path}.printed_page`, { min: 1, max: 40 });
  checkNumber(ctx, value.width, `${path}.width`, { min: 0.000001 });
  checkNumber(ctx, value.height, `${path}.height`, { min: 0.000001 });
  checkEnum(ctx, value.unit, `${path}.unit`, new Set(["pdf_points", "pixels"]));
  if (checkArray(ctx, value.blocks, `${path}.blocks`, { max: 20000 })) {
    value.blocks.forEach((block, index) => validateDocumentBlockInto(ctx, block, `${path}.blocks[${index}]`));
  }
}

function validateSourceFileInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["file_name", "mime_type", "sha256", "size_bytes"],
    allowed: ["file_name", "mime_type", "sha256", "size_bytes"]
  })) return;
  checkString(ctx, value.file_name, `${path}.file_name`, { min: 1, max: 512 });
  checkString(ctx, value.mime_type, `${path}.mime_type`, { min: 3, max: 120 });
  checkString(ctx, value.sha256, `${path}.sha256`, { min: 64, max: 64, pattern: SHA256_PATTERN });
  checkNumber(ctx, value.size_bytes, `${path}.size_bytes`, { min: 1, integer: true });
}

function validateIdentityInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["tenant_id", "learner_id", "status"],
    allowed: ["tenant_id", "learner_id", "status"]
  })) return;
  checkIdentifier(ctx, value.tenant_id, `${path}.tenant_id`, { nullable: true });
  checkIdentifier(ctx, value.learner_id, `${path}.learner_id`, { nullable: true });
  checkEnum(ctx, value.status, `${path}.status`, new Set(["resolved", "unresolved", "conflicted"]));
  if (value.status === "resolved" && (!value.tenant_id || !value.learner_id)) {
    ctx.add(path, "resolved identity requires both tenant_id and learner_id");
  }
}

function finalizeValidation(ctx) {
  return { valid: ctx.errors.length === 0, errors: ctx.errors };
}

function assertContract(contractName, value, validator) {
  const result = validator(value);
  if (!result.valid) throw new EducationImportValidationError(contractName, result.errors);
  return value;
}

export function validateSourceAnchor(value) {
  const ctx = new ValidationContext();
  validateSourceAnchorInto(ctx, value, "$source_anchor");
  return finalizeValidation(ctx);
}

export function assertSourceAnchor(value) {
  return assertContract("SourceAnchor", value, validateSourceAnchor);
}

export function validateDocumentIR(value) {
  const ctx = new ValidationContext();
  const allowed = [
    "schema_version",
    "id",
    "revision_id",
    "document_type",
    "title",
    "language",
    "subject",
    "grade_band",
    "source_file",
    "pages",
    "provenance",
    "confidence",
    "review_status"
  ];
  if (!checkObject(ctx, value, "$document", {
    required: [
      "schema_version",
      "id",
      "revision_id",
      "document_type",
      "title",
      "language",
      "source_file",
      "pages",
      "provenance",
      "confidence",
      "review_status"
    ],
    allowed
  })) return finalizeValidation(ctx);
  validateCandidateEnvelopeInto(ctx, value, "$document");
  checkEnum(ctx, value.document_type, "$document.document_type", SETS.documentTypes);
  checkString(ctx, value.title, "$document.title", { min: 1, max: 500 });
  checkString(ctx, value.language, "$document.language", { min: 2, max: 40 });
  checkOptionalString(ctx, value.subject, "$document.subject", { min: 1, max: 120 });
  checkOptionalString(ctx, value.grade_band, "$document.grade_band", { min: 1, max: 120 });
  validateSourceFileInto(ctx, value.source_file, "$document.source_file");
  if (checkArray(ctx, value.pages, "$document.pages", { min: 1, max: 100000 })) {
    const pageIndexes = new Set();
    const blockIds = new Set();
    value.pages.forEach((page, index) => {
      validateDocumentPageInto(ctx, page, `$document.pages[${index}]`);
      if (isObject(page)) {
        if (pageIndexes.has(page.index)) ctx.add(`$document.pages[${index}].index`, "must be unique");
        pageIndexes.add(page.index);
        if (Array.isArray(page.blocks)) {
          page.blocks.forEach((block, blockIndex) => {
            if (!isObject(block)) return;
            if (block.page_index !== page.index) {
              ctx.add(`$document.pages[${index}].blocks[${blockIndex}].page_index`, "must equal its containing page index");
            }
            if (blockIds.has(block.id)) {
              ctx.add(`$document.pages[${index}].blocks[${blockIndex}].id`, "must be unique within the document");
            }
            blockIds.add(block.id);
          });
        }
      }
    });
  }
  return finalizeValidation(ctx);
}

export function assertDocumentIR(value) {
  return assertContract("DocumentIR", value, validateDocumentIR);
}

export function validateCurriculumStandardCandidate(value) {
  const ctx = new ValidationContext();
  if (!checkObject(ctx, value, "$curriculum_candidate", {
    required: [
      "schema_version",
      "id",
      "revision_id",
      "candidate_type",
      "canonical_name",
      "statement",
      "knowledge_form",
      "aliases",
      "source_anchor",
      "provenance",
      "confidence",
      "review_status"
    ],
    allowed: [
      "schema_version",
      "id",
      "revision_id",
      "candidate_type",
      "canonical_name",
      "statement",
      "action_verb",
      "knowledge_form",
      "parent_candidate_id",
      "aliases",
      "source_anchor",
      "provenance",
      "confidence",
      "review_status"
    ]
  })) return finalizeValidation(ctx);
  validateCandidateEnvelopeInto(ctx, value, "$curriculum_candidate");
  checkEnum(ctx, value.candidate_type, "$curriculum_candidate.candidate_type", SETS.curriculumCandidateTypes);
  checkString(ctx, value.canonical_name, "$curriculum_candidate.canonical_name", { min: 1, max: 240 });
  checkString(ctx, value.statement, "$curriculum_candidate.statement", { min: 2, max: 12000 });
  checkOptionalString(ctx, value.action_verb, "$curriculum_candidate.action_verb", { min: 1, max: 40 });
  checkEnum(ctx, value.knowledge_form, "$curriculum_candidate.knowledge_form", SETS.knowledgeForms);
  if (value.parent_candidate_id !== undefined) checkIdentifier(ctx, value.parent_candidate_id, "$curriculum_candidate.parent_candidate_id");
  checkUniqueStrings(ctx, value.aliases, "$curriculum_candidate.aliases", { max: 64 });
  validateSourceAnchorInto(ctx, value.source_anchor, "$curriculum_candidate.source_anchor");
  return finalizeValidation(ctx);
}

export function assertCurriculumStandardCandidate(value) {
  return assertContract("CurriculumStandardCandidate", value, validateCurriculumStandardCandidate);
}

function validateQuestionOptionInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["id", "label", "text"],
    allowed: ["id", "label", "text"]
  })) return;
  checkIdentifier(ctx, value.id, `${path}.id`);
  checkString(ctx, value.label, `${path}.label`, { min: 1, max: 12 });
  checkString(ctx, value.text, `${path}.text`, { min: 1, max: 6000 });
}

function validateQuestionPartInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["id", "stem", "response_type", "options", "asset_ids", "source_anchor"],
    allowed: ["id", "label", "stem", "response_type", "options", "asset_ids", "source_anchor"]
  })) return;
  checkIdentifier(ctx, value.id, `${path}.id`);
  checkOptionalString(ctx, value.label, `${path}.label`, { min: 1, max: 40 });
  checkString(ctx, value.stem, `${path}.stem`, { min: 1, max: 30000 });
  checkEnum(ctx, value.response_type, `${path}.response_type`, SETS.responseTypes);
  if (checkArray(ctx, value.options, `${path}.options`, { max: 40 })) {
    value.options.forEach((option, index) => validateQuestionOptionInto(ctx, option, `${path}.options[${index}]`));
  }
  checkUniqueStrings(ctx, value.asset_ids, `${path}.asset_ids`, { identifiers: true, max: 64 });
  validateSourceAnchorInto(ctx, value.source_anchor, `${path}.source_anchor`);
  if (["single_select", "multi_select"].includes(value.response_type) && (!Array.isArray(value.options) || value.options.length < 2)) {
    ctx.add(`${path}.options`, "selection response types require at least two options");
  }
}

function validateTaskFeaturesInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["cognitive_process", "proposition_angles"],
    allowed: ["cognitive_process", "proposition_angles"]
  })) return;
  checkEnum(ctx, value.cognitive_process, `${path}.cognitive_process`, new Set([
    "remember",
    "understand",
    "apply",
    "analyze",
    "evaluate",
    "create",
    "unspecified"
  ]));
  checkUniqueStrings(ctx, value.proposition_angles, `${path}.proposition_angles`, { max: 24 });
}

export function validateQuestionIR(value) {
  const ctx = new ValidationContext();
  if (!checkObject(ctx, value, "$question", {
    required: [
      "schema_version",
      "id",
      "revision_id",
      "privacy",
      "question_type",
      "language",
      "stem",
      "stimulus",
      "parts",
      "asset_ids",
      "task_features",
      "source_anchor",
      "provenance",
      "confidence",
      "review_status"
    ],
    allowed: [
      "schema_version",
      "id",
      "revision_id",
      "privacy",
      "question_type",
      "language",
      "stem",
      "stimulus",
      "parts",
      "asset_ids",
      "task_features",
      "source_anchor",
      "provenance",
      "confidence",
      "review_status"
    ]
  })) return finalizeValidation(ctx);
  validateCandidateEnvelopeInto(ctx, value, "$question");
  if (value.privacy !== "public_prompt") ctx.add("$question.privacy", "must equal public_prompt");
  checkEnum(ctx, value.question_type, "$question.question_type", SETS.questionTypes);
  checkString(ctx, value.language, "$question.language", { min: 2, max: 40 });
  checkString(ctx, value.stem, "$question.stem", { min: 1, max: 30000 });
  if (value.stimulus !== null) {
    checkString(ctx, value.stimulus, "$question.stimulus", { min: 1, max: 50000 });
  }
  if (checkArray(ctx, value.parts, "$question.parts", { min: 1, max: 100 })) {
    const partIds = new Set();
    value.parts.forEach((part, index) => {
      validateQuestionPartInto(ctx, part, `$question.parts[${index}]`);
      if (isObject(part)) {
        if (partIds.has(part.id)) ctx.add(`$question.parts[${index}].id`, "must be unique");
        partIds.add(part.id);
      }
    });
  }
  checkUniqueStrings(ctx, value.asset_ids, "$question.asset_ids", { identifiers: true, max: 128 });
  validateTaskFeaturesInto(ctx, value.task_features, "$question.task_features");
  validateSourceAnchorInto(ctx, value.source_anchor, "$question.source_anchor");
  return finalizeValidation(ctx);
}

export function assertQuestionIR(value) {
  return assertContract("QuestionIR", value, validateQuestionIR);
}

function validateSubmissionResponseInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: [
      "question_id",
      "question_revision_id",
      "part_id",
      "response_text",
      "selected_option_ids",
      "asset_ids",
      "source_anchor"
    ],
    allowed: [
      "question_id",
      "question_revision_id",
      "part_id",
      "response_text",
      "selected_option_ids",
      "asset_ids",
      "source_anchor"
    ]
  })) return;
  checkIdentifier(ctx, value.question_id, `${path}.question_id`);
  checkIdentifier(ctx, value.question_revision_id, `${path}.question_revision_id`);
  checkIdentifier(ctx, value.part_id, `${path}.part_id`);
  if (value.response_text !== null) checkString(ctx, value.response_text, `${path}.response_text`, { min: 1, max: 30000 });
  checkUniqueStrings(ctx, value.selected_option_ids, `${path}.selected_option_ids`, { identifiers: true, max: 40 });
  checkUniqueStrings(ctx, value.asset_ids, `${path}.asset_ids`, { identifiers: true, max: 64 });
  validateSourceAnchorInto(ctx, value.source_anchor, `${path}.source_anchor`);
  if (!value.response_text && (!Array.isArray(value.selected_option_ids) || value.selected_option_ids.length === 0) && (!Array.isArray(value.asset_ids) || value.asset_ids.length === 0)) {
    ctx.add(path, "must contain text, a selected option, or an answer asset");
  }
}

function validateGradingEventInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: [
      "question_id",
      "part_id",
      "score",
      "max_score",
      "is_final",
      "grader_type",
      "feedback",
      "source_anchor"
    ],
    allowed: [
      "question_id",
      "part_id",
      "score",
      "max_score",
      "is_final",
      "grader_type",
      "feedback",
      "source_anchor"
    ]
  })) return;
  checkIdentifier(ctx, value.question_id, `${path}.question_id`);
  checkIdentifier(ctx, value.part_id, `${path}.part_id`);
  checkNumber(ctx, value.score, `${path}.score`, { min: 0, max: 1000000 });
  checkNumber(ctx, value.max_score, `${path}.max_score`, { min: 0.000001, max: 1000000 });
  if (typeof value.score === "number" && typeof value.max_score === "number" && value.score > value.max_score) {
    ctx.add(`${path}.score`, "must not exceed max_score");
  }
  checkBoolean(ctx, value.is_final, `${path}.is_final`);
  checkEnum(ctx, value.grader_type, `${path}.grader_type`, new Set(["human", "rule", "model", "imported"]));
  if (value.feedback !== null) checkString(ctx, value.feedback, `${path}.feedback`, { min: 1, max: 10000 });
  validateSourceAnchorInto(ctx, value.source_anchor, `${path}.source_anchor`);
}

export function validateSubmissionIR(value) {
  const ctx = new ValidationContext();
  if (!checkObject(ctx, value, "$submission", {
    required: [
      "schema_version",
      "id",
      "revision_id",
      "document_id",
      "identity",
      "attempt",
      "responses",
      "grading_events",
      "assistance_level",
      "source_anchor",
      "provenance",
      "confidence",
      "review_status"
    ],
    allowed: [
      "schema_version",
      "id",
      "revision_id",
      "document_id",
      "identity",
      "attempt",
      "responses",
      "grading_events",
      "assistance_level",
      "source_anchor",
      "provenance",
      "confidence",
      "review_status"
    ]
  })) return finalizeValidation(ctx);
  validateCandidateEnvelopeInto(ctx, value, "$submission");
  checkIdentifier(ctx, value.document_id, "$submission.document_id");
  validateIdentityInto(ctx, value.identity, "$submission.identity");
  if (checkObject(ctx, value.attempt, "$submission.attempt", {
    required: ["id", "opportunity_id", "session_id", "submitted_at"],
    allowed: ["id", "opportunity_id", "session_id", "submitted_at"]
  })) {
    checkIdentifier(ctx, value.attempt.id, "$submission.attempt.id");
    checkIdentifier(ctx, value.attempt.opportunity_id, "$submission.attempt.opportunity_id");
    checkIdentifier(ctx, value.attempt.session_id, "$submission.attempt.session_id", { nullable: true });
    if (value.attempt.submitted_at !== null) checkIsoDateTime(ctx, value.attempt.submitted_at, "$submission.attempt.submitted_at");
  }
  if (checkArray(ctx, value.responses, "$submission.responses", { min: 1, max: 1000 })) {
    value.responses.forEach((response, index) => validateSubmissionResponseInto(ctx, response, `$submission.responses[${index}]`));
  }
  if (checkArray(ctx, value.grading_events, "$submission.grading_events", { max: 2000 })) {
    value.grading_events.forEach((event, index) => validateGradingEventInto(ctx, event, `$submission.grading_events[${index}]`));
  }
  checkEnum(ctx, value.assistance_level, "$submission.assistance_level", new Set([
    "independent",
    "light_hint",
    "strong_hint",
    "answer_exposed",
    "unknown"
  ]));
  validateSourceAnchorInto(ctx, value.source_anchor, "$submission.source_anchor");
  return finalizeValidation(ctx);
}

export function assertSubmissionIR(value) {
  return assertContract("SubmissionIR", value, validateSubmissionIR);
}

export function validateTypedRelation(value) {
  const ctx = new ValidationContext();
  if (!checkObject(ctx, value, "$relation", {
    required: [
      "schema_version",
      "id",
      "revision_id",
      "source_id",
      "source_type",
      "target_id",
      "target_type",
      "relation_type",
      "scope",
      "provenance",
      "confidence",
      "review_status"
    ],
    allowed: [
      "schema_version",
      "id",
      "revision_id",
      "source_id",
      "source_type",
      "target_id",
      "target_type",
      "relation_type",
      "scope",
      "provenance",
      "confidence",
      "review_status"
    ]
  })) return finalizeValidation(ctx);
  validateCandidateEnvelopeInto(ctx, value, "$relation");
  checkIdentifier(ctx, value.source_id, "$relation.source_id");
  checkEnum(ctx, value.source_type, "$relation.source_type", SETS.entityTypes);
  checkIdentifier(ctx, value.target_id, "$relation.target_id");
  checkEnum(ctx, value.target_type, "$relation.target_type", SETS.entityTypes);
  checkEnum(ctx, value.relation_type, "$relation.relation_type", SETS.relationTypes);
  checkEnum(ctx, value.scope, "$relation.scope", new Set(["same_framework", "cross_framework", "cross_discipline"]));
  if (value.source_id === value.target_id) ctx.add("$relation", "self-relations are not allowed");
  const endpointRule = RELATION_ENDPOINT_RULES[value.relation_type];
  if (endpointRule && !endpointRule[0].has(value.source_type)) {
    ctx.add("$relation.source_type", `is not allowed for ${value.relation_type}`);
  }
  if (endpointRule && !endpointRule[1].has(value.target_type)) {
    ctx.add("$relation.target_type", `is not allowed for ${value.relation_type}`);
  }
  if (value.scope === "cross_discipline" && ![
    "realizes_concept",
    "uses_representation",
    "applies_in_context",
    "transfers_strategy_to",
    "analogous_to",
    "exact_match",
    "close_match",
    "broader_than",
    "narrower_than"
  ].includes(value.relation_type)) {
    ctx.add("$relation.relation_type", "is not an approved cross-discipline bridge relation");
  }
  return finalizeValidation(ctx);
}

export function assertTypedRelation(value) {
  return assertContract("TypedRelation", value, validateTypedRelation);
}

export function validateQuestionKnowledgeLink(value) {
  const ctx = new ValidationContext();
  if (!checkObject(ctx, value, "$question_knowledge_link", {
    required: [
      "schema_version",
      "id",
      "revision_id",
      "question_id",
      "question_revision_id",
      "part_id",
      "knowledge_point_id",
      "relation",
      "role",
      "weight",
      "observable_indicator",
      "solution_step_ids",
      "rubric_point_ids",
      "mapping_method",
      "provenance",
      "confidence",
      "review_status"
    ],
    allowed: [
      "schema_version",
      "id",
      "revision_id",
      "question_id",
      "question_revision_id",
      "part_id",
      "knowledge_point_id",
      "relation",
      "role",
      "weight",
      "observable_indicator",
      "solution_step_ids",
      "rubric_point_ids",
      "mapping_method",
      "provenance",
      "confidence",
      "review_status"
    ]
  })) return finalizeValidation(ctx);
  validateCandidateEnvelopeInto(ctx, value, "$question_knowledge_link");
  checkIdentifier(ctx, value.question_id, "$question_knowledge_link.question_id");
  checkIdentifier(ctx, value.question_revision_id, "$question_knowledge_link.question_revision_id");
  checkIdentifier(ctx, value.part_id, "$question_knowledge_link.part_id");
  checkIdentifier(ctx, value.knowledge_point_id, "$question_knowledge_link.knowledge_point_id");
  checkEnum(ctx, value.relation, "$question_knowledge_link.relation", SETS.qkRelations);
  checkEnum(ctx, value.role, "$question_knowledge_link.role", SETS.qkRoles);
  checkNumber(ctx, value.weight, "$question_knowledge_link.weight", { min: 0.000001, max: 1 });
  checkString(ctx, value.observable_indicator, "$question_knowledge_link.observable_indicator", { min: 1, max: 600 });
  checkUniqueStrings(ctx, value.solution_step_ids, "$question_knowledge_link.solution_step_ids", { identifiers: true, max: 128 });
  checkUniqueStrings(ctx, value.rubric_point_ids, "$question_knowledge_link.rubric_point_ids", { identifiers: true, max: 128 });
  checkEnum(ctx, value.mapping_method, "$question_knowledge_link.mapping_method", new Set(["human", "rule", "model", "imported"]));
  if (value.relation === "assesses" && !["primary", "secondary"].includes(value.role)) {
    ctx.add("$question_knowledge_link.role", "assesses links must use primary or secondary role");
  }
  if (value.relation === "requires_knowledge" && !["prerequisite", "supporting"].includes(value.role)) {
    ctx.add("$question_knowledge_link.role", "requires_knowledge links must use prerequisite or supporting role");
  }
  if (["rule", "model"].includes(value.mapping_method) && value.review_status === "verified") {
    ctx.add("$question_knowledge_link.review_status", "rule or model mappings cannot self-declare verified status");
  }
  return finalizeValidation(ctx);
}

export function assertQuestionKnowledgeLink(value) {
  return assertContract("QuestionKnowledgeLink", value, validateQuestionKnowledgeLink);
}

function validateEvidenceEligibilityInto(ctx, value, path) {
  if (!checkObject(ctx, value, path, {
    required: ["can_update_mastery", "withheld_reasons", "requirements"],
    allowed: ["can_update_mastery", "withheld_reasons", "requirements"]
  })) return;
  checkBoolean(ctx, value.can_update_mastery, `${path}.can_update_mastery`);
  checkUniqueStrings(ctx, value.withheld_reasons, `${path}.withheld_reasons`, { max: 32 });
  const requirementKeys = [
    "identity_confirmed",
    "question_version_confirmed",
    "mapping_verified",
    "grading_final",
    "answer_not_exposed",
    "duplicate_safe"
  ];
  if (checkObject(ctx, value.requirements, `${path}.requirements`, {
    required: requirementKeys,
    allowed: requirementKeys
  })) {
    requirementKeys.forEach((key) => checkBoolean(ctx, value.requirements[key], `${path}.requirements.${key}`));
    if (value.can_update_mastery) {
      const failed = requirementKeys.filter((key) => value.requirements[key] !== true);
      if (failed.length) ctx.add(`${path}.can_update_mastery`, `cannot be true while requirements fail: ${failed.join(", ")}`);
      if (Array.isArray(value.withheld_reasons) && value.withheld_reasons.length) {
        ctx.add(`${path}.withheld_reasons`, "must be empty when mastery update is allowed");
      }
    } else if (Array.isArray(value.withheld_reasons) && value.withheld_reasons.length === 0) {
      ctx.add(`${path}.withheld_reasons`, "must explain why mastery update is withheld");
    }
  }
}

export function validateEvidenceCandidate(value) {
  const ctx = new ValidationContext();
  if (!checkObject(ctx, value, "$evidence", {
    required: [
      "schema_version",
      "id",
      "revision_id",
      "identity",
      "opportunity_id",
      "attempt_id",
      "question_id",
      "question_revision_id",
      "part_id",
      "question_knowledge_link_id",
      "knowledge_point_id",
      "dimension",
      "outcome",
      "strength",
      "independence",
      "attribution_role",
      "observed_step_ids",
      "error_codes",
      "misconception_candidate_ids",
      "grading",
      "eligibility",
      "normalized_contribution_key",
      "observed_at",
      "provenance",
      "confidence",
      "review_status"
    ],
    allowed: [
      "schema_version",
      "id",
      "revision_id",
      "identity",
      "opportunity_id",
      "attempt_id",
      "question_id",
      "question_revision_id",
      "part_id",
      "question_knowledge_link_id",
      "knowledge_point_id",
      "dimension",
      "outcome",
      "strength",
      "independence",
      "attribution_role",
      "observed_step_ids",
      "error_codes",
      "misconception_candidate_ids",
      "grading",
      "eligibility",
      "normalized_contribution_key",
      "observed_at",
      "provenance",
      "confidence",
      "review_status"
    ]
  })) return finalizeValidation(ctx);
  validateCandidateEnvelopeInto(ctx, value, "$evidence");
  validateIdentityInto(ctx, value.identity, "$evidence.identity");
  for (const key of [
    "opportunity_id",
    "attempt_id",
    "question_id",
    "question_revision_id",
    "part_id",
    "question_knowledge_link_id",
    "knowledge_point_id",
    "normalized_contribution_key"
  ]) checkIdentifier(ctx, value[key], `$evidence.${key}`);
  checkEnum(ctx, value.dimension, "$evidence.dimension", new Set([
    "knowledge_skill",
    "reasoning",
    "expression",
    "application_modeling",
    "learning_process"
  ]));
  checkEnum(ctx, value.outcome, "$evidence.outcome", new Set(["positive", "negative", "mixed", "neutral"]));
  checkEnum(ctx, value.strength, "$evidence.strength", new Set(["strong", "medium", "weak", "none"]));
  checkEnum(ctx, value.independence, "$evidence.independence", new Set([
    "independent",
    "light_hint",
    "strong_hint",
    "answer_exposed",
    "unknown"
  ]));
  checkEnum(ctx, value.attribution_role, "$evidence.attribution_role", SETS.qkRoles);
  checkUniqueStrings(ctx, value.observed_step_ids, "$evidence.observed_step_ids", { identifiers: true, max: 128 });
  checkUniqueStrings(ctx, value.error_codes, "$evidence.error_codes", { identifiers: true, max: 64 });
  checkUniqueStrings(ctx, value.misconception_candidate_ids, "$evidence.misconception_candidate_ids", { identifiers: true, max: 64 });
  if (checkObject(ctx, value.grading, "$evidence.grading", {
    required: ["score", "max_score", "is_final", "grader_type"],
    allowed: ["score", "max_score", "is_final", "grader_type"]
  })) {
    checkNumber(ctx, value.grading.score, "$evidence.grading.score", { min: 0, max: 1000000 });
    checkNumber(ctx, value.grading.max_score, "$evidence.grading.max_score", { min: 0.000001, max: 1000000 });
    if (typeof value.grading.score === "number" && typeof value.grading.max_score === "number" && value.grading.score > value.grading.max_score) {
      ctx.add("$evidence.grading.score", "must not exceed max_score");
    }
    checkBoolean(ctx, value.grading.is_final, "$evidence.grading.is_final");
    checkEnum(ctx, value.grading.grader_type, "$evidence.grading.grader_type", new Set(["human", "rule", "model", "imported"]));
  }
  validateEvidenceEligibilityInto(ctx, value.eligibility, "$evidence.eligibility");
  checkIsoDateTime(ctx, value.observed_at, "$evidence.observed_at");
  if (value.eligibility?.can_update_mastery && ["strong_hint", "answer_exposed", "unknown"].includes(value.independence)) {
    ctx.add("$evidence.independence", "cannot update mastery from strong hints, exposed answers, or unknown independence");
  }
  return finalizeValidation(ctx);
}

export function assertEvidenceCandidate(value) {
  return assertContract("EvidenceCandidate", value, validateEvidenceCandidate);
}

export const EDUCATION_IMPORT_VALIDATORS = Object.freeze({
  SourceAnchor: validateSourceAnchor,
  DocumentIR: validateDocumentIR,
  CurriculumStandardCandidate: validateCurriculumStandardCandidate,
  QuestionIR: validateQuestionIR,
  SubmissionIR: validateSubmissionIR,
  TypedRelation: validateTypedRelation,
  QuestionKnowledgeLink: validateQuestionKnowledgeLink,
  EvidenceCandidate: validateEvidenceCandidate
});

export function validateEducationImportContract(contractName, value) {
  const validator = EDUCATION_IMPORT_VALIDATORS[contractName];
  if (!validator) {
    return {
      valid: false,
      errors: [`$contract: unknown education import contract ${String(contractName)}`]
    };
  }
  return validator(value);
}

export function assertEducationImportContract(contractName, value) {
  const result = validateEducationImportContract(contractName, value);
  if (!result.valid) throw new EducationImportValidationError(contractName, result.errors);
  return value;
}
