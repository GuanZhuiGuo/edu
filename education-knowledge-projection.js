import { createHash } from "node:crypto";

import {
  TYPED_RELATION_TYPES,
  assertDocumentIR,
} from "./education-import-contracts.js";
import { assertEducationImportCandidatePack } from "./education-import-service.js";

const PLAN_SCHEMA_VERSION = "education-knowledge-publication-plan@1.0";
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,191}$/u;
const PUBLICATION_NAMESPACES = new Set([
  "shared_curriculum",
  "organization_course",
]);
const PRIVATE_DOCUMENT_TYPES = new Set([
  "student_homework",
  "student_exam",
  "student_notebook",
]);
const SEARCHABLE_BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "list_item",
  "table",
  "formula",
  "question_stem",
  "question_option",
  "diagram",
]);
const GRAPH_RELATION_TYPES = new Set(TYPED_RELATION_TYPES);

export class EducationKnowledgeProjectionError extends Error {
  constructor(code, message, { status = 422 } = {}) {
    super(message);
    this.name = "EducationKnowledgeProjectionError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Convert a reviewed import artifact into the only payload that storage
 * adapters are allowed to publish. The projection deliberately excludes
 * submissions, grading events, student/teacher layers and private answers.
 */
export function compileEducationKnowledgePublicationPlan({
  documentIR,
  candidatePack,
  semanticArtifact = null,
  tenantId,
  namespace = "organization_course",
  courseId = null,
  indexBuildId = null,
  embeddingModel = "unknown",
  publishedAt = new Date().toISOString(),
} = {}) {
  const document = assertDocumentIR(structuredCloneSafe(documentIR));
  const pack = assertEducationImportCandidatePack(
    structuredCloneSafe(candidatePack),
    document,
    { jobId: candidatePack?.job_id },
  );
  const safeTenantId = requiredIdentifier(tenantId, "tenantId");
  const safeNamespace = normalizeNamespace(namespace);
  const requestedCourseId = optionalIdentifier(courseId, "courseId");
  const safeCourseId = requestedCourseId
    || (safeNamespace === "shared_curriculum" ? "shared_curriculum" : null);
  if (!safeCourseId) {
    throw new EducationKnowledgeProjectionError(
      "education_knowledge_course_required",
      "courseId is required for organization_course publication.",
    );
  }
  const safeEmbeddingModel = requiredIdentifier(embeddingModel, "embeddingModel");
  const safePublishedAt = isoDateTime(publishedAt, "publishedAt");

  assertPublishable(document, pack, semanticArtifact, safeNamespace);

  const buildId = indexBuildId
    ? requiredIdentifier(indexBuildId, "indexBuildId")
    : stableId(
      "index-build",
      safeTenantId,
      document.revision_id,
      pack.updated_at,
      safeEmbeddingModel,
    );
  const publicationId = stableId("publication", safeTenantId, buildId);
  const baseMetadata = Object.freeze({
    tenant_id: safeTenantId,
    namespace: safeNamespace,
    course_id: safeCourseId,
    corpus_id: safeCourseId,
    release_id: buildId,
    visibility: safeNamespace === "shared_curriculum" ? "shared" : "tenant",
    document_id: document.id,
    document_revision_id: document.revision_id,
    document_type: document.document_type,
    subject: document.subject || null,
    grade_band: document.grade_band || null,
    language: document.language,
    publish_state: "staging",
    index_build_id: buildId,
    embedding_model: safeEmbeddingModel,
  });

  const chunks = compileChunks(document, baseMetadata);
  const knowledgeUnits = compileKnowledgeUnits(pack, baseMetadata);
  const questions = compileQuestions(pack, baseMetadata);
  const typedRelations = compileTypedRelations(pack);
  const questionLinks = compileQuestionLinks(pack);
  const vectorRecords = [
    ...chunks.map((chunk) => vectorRecordFromChunk(chunk)),
    ...knowledgeUnits.map((unit) => vectorRecordFromKnowledgeUnit(unit)),
    ...questions.map((question) => vectorRecordFromQuestion(question)),
  ];

  if (!vectorRecords.length) {
    throw new EducationKnowledgeProjectionError(
      "education_knowledge_publication_empty",
      "The reviewed import contains no public searchable records.",
    );
  }

  return Object.freeze({
    schema_version: PLAN_SCHEMA_VERSION,
    publication_id: publicationId,
    index_build_id: buildId,
    generated_at: safePublishedAt,
    tenant_id: safeTenantId,
    namespace: safeNamespace,
    course_id: safeCourseId,
    corpus_id: safeCourseId,
    release_id: buildId,
    visibility: baseMetadata.visibility,
    embedding_model: safeEmbeddingModel,
    document: Object.freeze({
      id: document.id,
      title: document.title,
      document_type: document.document_type,
      language: document.language,
      subject: document.subject || null,
      grade_band: document.grade_band || null,
      source_sha256: document.source_file.sha256,
    }),
    revision: Object.freeze({
      id: document.revision_id,
      document_id: document.id,
      recorded_at: document.provenance.recorded_at,
      review_status: document.review_status,
      publish_state: "staging",
      index_build_id: buildId,
    }),
    vector_records: Object.freeze(vectorRecords),
    graph: Object.freeze({
      chunks: Object.freeze(chunks),
      knowledge_units: Object.freeze(knowledgeUnits),
      questions: Object.freeze(questions),
      relations: Object.freeze(typedRelations),
      question_links: Object.freeze(questionLinks),
    }),
    statistics: Object.freeze({
      vector_record_count: vectorRecords.length,
      chunk_count: chunks.length,
      knowledge_unit_count: knowledgeUnits.length,
      question_count: questions.length,
      relation_count: typedRelations.length,
      question_link_count: questionLinks.length,
    }),
  });
}

function assertPublishable(document, pack, semanticArtifact, namespace) {
  if (pack.processing_status !== "completed" || pack.review_status !== "verified") {
    throw new EducationKnowledgeProjectionError(
      "education_knowledge_review_required",
      "Only a completed and verified candidate pack can be published.",
      { status: 409 },
    );
  }
  if (document.review_status !== "verified") {
    throw new EducationKnowledgeProjectionError(
      "education_knowledge_document_unverified",
      "请先完成人工审核，再发布这份资料。",
      { status: 409 },
    );
  }
  if (semanticArtifact) {
    if (semanticArtifact.status !== "succeeded"
      || !Array.isArray(semanticArtifact.review_queue)
      || semanticArtifact.review_queue.length > 0) {
      throw new EducationKnowledgeProjectionError(
        "education_knowledge_semantic_review_required",
        "语义解析仍有待审核内容，请处理完成后再发布。",
        { status: 409 },
      );
    }
  }
  if (PRIVATE_DOCUMENT_TYPES.has(document.document_type)) {
    throw new EducationKnowledgeProjectionError(
      "education_knowledge_private_document_forbidden",
      "学生作业和答卷属于个人学习记录，不能发布到共享知识库。",
      { status: 403 },
    );
  }
  if (namespace === "shared_curriculum" && ![
    "curriculum_standard",
    "exam_syllabus",
    "textbook",
  ].includes(document.document_type)) {
    throw new EducationKnowledgeProjectionError(
      "education_knowledge_shared_namespace_forbidden",
      "共享知识库只接收已审核的课标、考试大纲和教材。题库、作业与试卷请使用对应的审核流程。",
      { status: 403 },
    );
  }
  for (const collection of Object.values(pack.candidates || {})) {
    if (!Array.isArray(collection)) continue;
    const unverified = collection.find((candidate) => candidate?.review_status !== "verified");
    if (unverified) {
      throw new EducationKnowledgeProjectionError(
        "education_knowledge_candidate_unverified",
        "仍有候选内容未审核，请逐项确认后再发布。",
        { status: 409 },
      );
    }
  }
}

function compileChunks(document, baseMetadata) {
  return document.pages.flatMap((page) => page.blocks.flatMap((block) => {
    if (block.layer !== "printed" || !SEARCHABLE_BLOCK_TYPES.has(block.type)) return [];
    const content = boundedText(block.normalized_text || block.text, 12_000);
    if (!content) return [];
    return [Object.freeze({
      id: block.id,
      record_type: "source_chunk",
      title: document.title,
      content,
      page_index: page.index,
      printed_page: page.printed_page || null,
      block_type: block.type,
      source_anchor: Object.freeze({
        document_id: document.id,
        document_revision_id: document.revision_id,
        page_index: page.index,
        printed_page: page.printed_page || null,
        block_ids: Object.freeze([block.id]),
      }),
      metadata: Object.freeze({
        ...baseMetadata,
        record_id: block.id,
        revision_id: document.revision_id,
        entity_type: "source_chunk",
      }),
    })];
  }));
}

function compileKnowledgeUnits(pack, baseMetadata) {
  return (pack.candidates?.curriculum_standards || []).map((candidate) => Object.freeze({
    id: candidate.id,
    revision_id: candidate.revision_id,
    record_type: "knowledge_unit",
    knowledge_type: candidate.candidate_type,
    title: candidate.canonical_name,
    statement: candidate.statement,
    action_verb: candidate.action_verb || null,
    knowledge_form: candidate.knowledge_form,
    aliases: Object.freeze([...(candidate.aliases || [])]),
    parent_id: candidate.parent_candidate_id || null,
    source_anchor: freezeAnchor(candidate.source_anchor),
    confidence: candidate.confidence.overall,
    metadata: Object.freeze({
      ...baseMetadata,
      record_id: candidate.id,
      revision_id: candidate.revision_id,
      entity_type: "knowledge_unit",
    }),
  }));
}

function compileQuestions(pack, baseMetadata) {
  return (pack.candidates?.questions || []).map((question) => Object.freeze({
    id: question.id,
    revision_id: question.revision_id,
    record_type: "assessment_item",
    question_type: question.question_type,
    title: `题目 ${question.id}`,
    stem: question.stem,
    stimulus: question.stimulus || null,
    parts: Object.freeze(question.parts.map((part) => Object.freeze({
      id: part.id,
      label: part.label || null,
      stem: part.stem,
      response_type: part.response_type,
      options: Object.freeze(part.options.map((option) => Object.freeze({
        id: option.id,
        label: option.label,
        text: option.text,
      }))),
      source_anchor: freezeAnchor(part.source_anchor),
    }))),
    cognitive_process: question.task_features.cognitive_process,
    proposition_angles: Object.freeze([...(question.task_features.proposition_angles || [])]),
    source_anchor: freezeAnchor(question.source_anchor),
    confidence: question.confidence.overall,
    metadata: Object.freeze({
      ...baseMetadata,
      record_id: question.id,
      revision_id: question.revision_id,
      entity_type: "assessment_item",
    }),
  }));
}

function compileTypedRelations(pack) {
  return (pack.candidates?.typed_relations || []).flatMap((relation) => {
    if (!GRAPH_RELATION_TYPES.has(relation.relation_type)) return [];
    return [Object.freeze({
      id: relation.id,
      source_id: relation.source_id,
      source_type: relation.source_type,
      target_id: relation.target_id,
      target_type: relation.target_type,
      relation_type: relation.relation_type,
      scope: relation.scope,
      confidence: relation.confidence.overall,
      source_anchors: Object.freeze(
        (relation.provenance.source_anchors || []).map(freezeAnchor),
      ),
    })];
  });
}

function compileQuestionLinks(pack) {
  return (pack.candidates?.question_knowledge_links || []).map((link) => Object.freeze({
    id: link.id,
    question_id: link.question_id,
    question_revision_id: link.question_revision_id,
    part_id: link.part_id,
    knowledge_point_id: link.knowledge_point_id,
    relation: link.relation,
    role: link.role,
    weight: link.weight,
    observable_indicator: link.observable_indicator,
    confidence: link.confidence.overall,
    source_anchors: Object.freeze(
      (link.provenance.source_anchors || []).map(freezeAnchor),
    ),
  }));
}

function vectorRecordFromChunk(chunk) {
  return freezeVectorRecord(chunk, chunk.content, [chunk.block_type]);
}

function vectorRecordFromKnowledgeUnit(unit) {
  const content = boundedText([
    unit.title,
    unit.statement,
    unit.action_verb,
    unit.aliases.join("；"),
  ].filter(Boolean).join("\n"), 16_000);
  return freezeVectorRecord(unit, content, [unit.knowledge_type, unit.knowledge_form]);
}

function vectorRecordFromQuestion(question) {
  const content = boundedText([
    question.stem,
    question.stimulus,
    ...question.parts.flatMap((part) => [
      part.stem,
      ...part.options.map((option) => `${option.label}. ${option.text}`),
    ]),
    ...question.proposition_angles,
  ].filter(Boolean).join("\n"), 20_000);
  return freezeVectorRecord(question, content, [
    question.question_type,
    question.cognitive_process,
    ...question.proposition_angles,
  ]);
}

function freezeVectorRecord(source, content, lexicalTerms) {
  return Object.freeze({
    record_id: source.id,
    record_type: source.record_type,
    title: source.title,
    content,
    content_hash: createHash("sha256").update(content).digest("hex"),
    lexical_terms: Object.freeze(uniqueStrings(lexicalTerms)),
    source_anchor: freezeAnchor(source.source_anchor),
    payload: source.metadata,
  });
}

function freezeAnchor(anchor) {
  if (!anchor) return null;
  return Object.freeze({
    document_id: anchor.document_id,
    document_revision_id: anchor.document_revision_id,
    page_index: anchor.page_index,
    printed_page: anchor.printed_page || null,
    block_ids: Object.freeze([...(anchor.block_ids || [])]),
    ...(anchor.quote ? { quote: anchor.quote } : {}),
    ...(anchor.content_hash ? { content_hash: anchor.content_hash } : {}),
  });
}

function normalizeNamespace(value) {
  if (!PUBLICATION_NAMESPACES.has(value)) {
    throw new EducationKnowledgeProjectionError(
      "education_knowledge_namespace_invalid",
      "namespace must be shared_curriculum or organization_course.",
    );
  }
  return value;
}

function requiredIdentifier(value, field) {
  const normalized = String(value || "").trim();
  if (!SAFE_IDENTIFIER.test(normalized)) {
    throw new EducationKnowledgeProjectionError(
      "education_knowledge_identifier_invalid",
      `${field} is invalid.`,
    );
  }
  return normalized;
}

function optionalIdentifier(value, field) {
  if (value === null || value === undefined || value === "") return null;
  return requiredIdentifier(value, field);
}

function isoDateTime(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    throw new EducationKnowledgeProjectionError(
      "education_knowledge_datetime_invalid",
      `${field} must be an ISO date-time.`,
    );
  }
  return new Date(normalized).toISOString();
}

function boundedText(value, maxLength) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function stableId(prefix, ...parts) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u001f"))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}:${digest}`;
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export const EDUCATION_KNOWLEDGE_PUBLICATION_PLAN_SCHEMA_VERSION = PLAN_SCHEMA_VERSION;
