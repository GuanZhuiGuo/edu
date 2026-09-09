import assert from "node:assert/strict";
import test from "node:test";

import {
  EDUCATION_IMPORT_SCHEMA_VERSION,
  EducationImportValidationError,
  assertDocumentIR,
  assertEvidenceCandidate,
  assertQuestionKnowledgeLink,
  validateDocumentIR,
  validateQuestionKnowledgeLink,
  validateTypedRelation
} from "../education-import-contracts.js";
import { compileEducationImportCandidates } from "../education-import-compiler.js";

const RECORDED_AT = "2026-08-16T12:00:00.000Z";
const FILE_HASH = "a".repeat(64);

function sourceAnchor(documentId, revisionId, blockId, pageIndex = 0) {
  return {
    document_id: documentId,
    document_revision_id: revisionId,
    page_index: pageIndex,
    block_ids: [blockId],
    quote: "source",
    content_hash: FILE_HASH
  };
}

function block(id, type, text, readingOrder, extra = {}) {
  return {
    id,
    type,
    page_index: 0,
    reading_order: readingOrder,
    text,
    layer: extra.layer || "printed",
    extraction: { method: "native_pdf", confidence: 0.98 },
    ...(extra.annotations ? { annotations: extra.annotations } : {})
  };
}

function makeDocument(documentType, blocks, suffix = documentType) {
  const id = `document_${suffix}`;
  const revisionId = `document_revision_${suffix}`;
  return {
    schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
    id,
    revision_id: revisionId,
    document_type: documentType,
    title: `测试文档 ${suffix}`,
    language: "zh-CN",
    subject: "math",
    grade_band: "junior_secondary",
    source_file: {
      file_name: `${suffix}.pdf`,
      mime_type: "application/pdf",
      sha256: FILE_HASH,
      size_bytes: 1024
    },
    pages: [{
      index: 0,
      printed_page: "1",
      width: 595,
      height: 842,
      unit: "pdf_points",
      blocks
    }],
    provenance: {
      method: "parsed_block",
      pipeline: { name: "fixture_parser", version: "1.0" },
      source_anchors: [sourceAnchor(id, revisionId, blocks[0].id)],
      parent_ids: [],
      recorded_at: RECORDED_AT
    },
    confidence: { overall: 0.98, extraction: 0.98, source_alignment: 1 },
    review_status: "candidate"
  };
}

test("DocumentIR rejects unknown fields and inconsistent page ownership", () => {
  const document = makeDocument("curriculum_standard", [
    block("heading_1", "heading", "数与代数", 0)
  ], "strict");
  document.untrusted_payload = true;
  document.pages[0].blocks[0].page_index = 2;

  const result = validateDocumentIR(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /untrusted_payload.*not allowed/);
  assert.match(result.errors.join("\n"), /must equal its containing page index/);
  assert.throws(() => assertDocumentIR(document), EducationImportValidationError);
});

test("typed relation and QuestionKnowledgeLink enforce educational semantics", () => {
  const invalidRelation = {
    schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
    id: "relation_1",
    revision_id: "relation_1:r1",
    source_id: "question_1",
    source_type: "question",
    target_id: "knowledge_1",
    target_type: "knowledge_point",
    relation_type: "prerequisite_of",
    scope: "same_framework",
    provenance: {
      method: "human",
      pipeline: { name: "fixture", version: "1" },
      source_anchors: [sourceAnchor("document_x", "revision_x", "block_x")],
      parent_ids: [],
      recorded_at: RECORDED_AT
    },
    confidence: { overall: 1, extraction: 1, source_alignment: 1, relation: 1 },
    review_status: "candidate"
  };
  assert.match(validateTypedRelation(invalidRelation).errors.join("\n"), /source_type.*not allowed/);

  const invalidLink = {
    schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
    id: "qk_1",
    revision_id: "qk_1:r1",
    question_id: "question_1",
    question_revision_id: "question_revision_1",
    part_id: "part_1",
    knowledge_point_id: "knowledge_1",
    relation: "assesses",
    role: "prerequisite",
    weight: 1,
    observable_indicator: "学生能够求出函数值",
    solution_step_ids: [],
    rubric_point_ids: [],
    mapping_method: "model",
    provenance: invalidRelation.provenance,
    confidence: invalidRelation.confidence,
    review_status: "verified"
  };
  const result = validateQuestionKnowledgeLink(invalidLink);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /assesses links must use primary or secondary/);
  assert.match(result.errors.join("\n"), /cannot self-declare verified/);
});

test("curriculum compiler preserves clauses and emits reviewable objective relations", () => {
  const document = makeDocument("curriculum_standard", [
    block("heading_algebra", "heading", "数与代数", 0),
    block("clause_function", "paragraph", "能够结合具体情境理解一次函数的意义。", 1),
    block("clause_equation", "list_item", "掌握一元一次方程的基本解法。", 2)
  ], "curriculum");

  const result = compileEducationImportCandidates(document);
  assert.equal(result.curriculum_candidates.length, 5);
  assert.equal(result.curriculum_candidates.filter((item) => item.candidate_type === "learning_objective").length, 2);
  assert.equal(result.relations.filter((relation) => relation.relation_type === "derived_from_clause").length, 2);
  assert.ok(result.curriculum_candidates.every((item) => item.review_status === "candidate"));
  assert.ok(result.curriculum_candidates.every((item) => item.provenance.source_anchors.length >= 1));
  assert.deepEqual(result, compileEducationImportCandidates(document), "compiler must be deterministic");
});

test("student exam compiler builds QuestionIR and SubmissionIR without guessing mastery", () => {
  const document = makeDocument("student_exam", [
    block("question_1", "question_stem", "若 y=2x+1，当 x=3 时，y 的值为（ ）", 0, {
      annotations: {
        question_number: "1",
        question_type: "single_choice",
        knowledge_links: [{
          knowledge_point_id: "kp_linear_function_value",
          relation: "assesses",
          role: "primary",
          weight: 1,
          observable_indicator: "能代入自变量并计算函数值",
          confidence: 0.93
        }]
      }
    }),
    block("option_a", "question_option", "A. 5", 1),
    block("option_b", "question_option", "B. 7", 2),
    block("option_c", "question_option", "C. 8", 3),
    block("response_1", "student_response", "B", 4, { layer: "student" }),
    block("mark_1", "teacher_mark", "正确", 5, { layer: "teacher" }),
    block("score_1", "score", "2/2", 6, {
      layer: "teacher",
      annotations: { score_value: 2, max_score: 2, is_final_grade: true }
    })
  ], "student_exam");

  const first = compileEducationImportCandidates(document, {
    learner_context: {
      tenant_id: "tenant_demo",
      learner_id: "learner_demo",
      session_id: "session_demo",
      assistance_level: "independent",
      submitted_at: RECORDED_AT
    }
  });
  assert.equal(first.questions.length, 1);
  assert.equal(first.questions[0].parts[0].options.length, 3);
  assert.equal(first.question_knowledge_links.length, 1);
  assert.equal(first.submissions.length, 1);
  assert.equal(first.submissions[0].grading_events[0].is_final, true);
  assert.deepEqual(first.evidence_candidates, [], "candidate mappings cannot create mastery evidence");

  const authoritativeLink = {
    ...first.question_knowledge_links[0],
    review_status: "verified",
    mapping_method: "human"
  };
  assertQuestionKnowledgeLink(authoritativeLink);
  const second = compileEducationImportCandidates(document, {
    learner_context: {
      tenant_id: "tenant_demo",
      learner_id: "learner_demo",
      session_id: "session_demo",
      assistance_level: "independent",
      submitted_at: RECORDED_AT
    },
    authoritative_question_knowledge_links: [authoritativeLink],
    duplicate_safe: true
  });
  assert.equal(second.evidence_candidates.length, 1);
  assert.equal(second.evidence_candidates[0].eligibility.can_update_mastery, true);
  assert.equal(second.evidence_candidates[0].outcome, "positive");
});

test("EvidenceCandidate forbids a model-proposed mastery delta and unsafe eligibility", () => {
  const document = makeDocument("student_exam", [
    block("question_safe", "question_stem", "1+1=?", 0),
    block("response_safe", "student_response", "2", 1, { layer: "student" })
  ], "evidence_guard");
  const compiled = compileEducationImportCandidates(document, {
    learner_context: { tenant_id: "tenant_x", learner_id: "learner_x" }
  });
  assert.equal(compiled.evidence_candidates.length, 0);

  const invalidEvidence = {
    schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
    id: "evidence_unsafe",
    revision_id: "evidence_unsafe:r1",
    identity: { tenant_id: "tenant_x", learner_id: "learner_x", status: "resolved" },
    opportunity_id: "opportunity_x",
    attempt_id: "attempt_x",
    question_id: "question_x",
    question_revision_id: "question_revision_x",
    part_id: "part_x",
    question_knowledge_link_id: "qk_x",
    knowledge_point_id: "knowledge_x",
    dimension: "knowledge_skill",
    outcome: "positive",
    strength: "strong",
    independence: "answer_exposed",
    attribution_role: "primary",
    observed_step_ids: [],
    error_codes: [],
    misconception_candidate_ids: [],
    grading: { score: 1, max_score: 1, is_final: true, grader_type: "model" },
    eligibility: {
      can_update_mastery: true,
      withheld_reasons: [],
      requirements: {
        identity_confirmed: true,
        question_version_confirmed: true,
        mapping_verified: false,
        grading_final: true,
        answer_not_exposed: false,
        duplicate_safe: true
      }
    },
    normalized_contribution_key: "contribution_x",
    observed_at: RECORDED_AT,
    provenance: document.provenance,
    confidence: { overall: 0.8, extraction: 0.9, source_alignment: 1, grading: 0.7 },
    review_status: "candidate",
    mastery_delta: 0.25
  };
  assert.throws(() => assertEvidenceCandidate(invalidEvidence), (error) => {
    assert.ok(error instanceof EducationImportValidationError);
    assert.match(error.errors.join("\n"), /mastery_delta.*not allowed/);
    assert.match(error.errors.join("\n"), /requirements fail/);
    assert.match(error.errors.join("\n"), /exposed answers/);
    return true;
  });
});
