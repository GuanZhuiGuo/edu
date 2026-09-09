import { createHash } from "node:crypto";

import {
  EDUCATION_IMPORT_SCHEMA_VERSION,
  assertCurriculumStandardCandidate,
  assertDocumentIR,
  assertEvidenceCandidate,
  assertQuestionIR,
  assertQuestionKnowledgeLink,
  assertSubmissionIR,
  assertTypedRelation
} from "./education-import-contracts.js";

const PIPELINE = Object.freeze({ name: "education_import_compiler", version: "1.0" });
const CURRICULUM_DOCUMENTS = new Set(["curriculum_standard", "exam_syllabus", "textbook", "courseware"]);
const QUESTION_DOCUMENTS = new Set([
  "question_collection",
  "homework_template",
  "student_homework",
  "exam_paper",
  "student_exam"
]);
const SUBMISSION_DOCUMENTS = new Set(["student_homework", "student_exam"]);
const OBJECTIVE_VERBS = [
  "了解",
  "理解",
  "掌握",
  "运用",
  "应用",
  "会",
  "能",
  "能够",
  "经历",
  "体验",
  "探索",
  "认识",
  "识别",
  "解释",
  "分析",
  "解决",
  "证明",
  "计算"
];

function stableId(prefix, ...values) {
  const digest = createHash("sha256")
    .update(values.map((value) => String(value ?? "")).join("\u001f"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

function blockText(block) {
  return String(block.normalized_text || block.text || "").trim();
}

function flattenBlocks(document) {
  return document.pages
    .flatMap((page) => page.blocks.map((block) => ({ ...block, printed_page: page.printed_page })))
    .sort((left, right) => left.page_index - right.page_index || left.reading_order - right.reading_order);
}

function anchorForPage(document, blocks) {
  const usable = blocks.filter(Boolean);
  const first = usable[0];
  if (!first) throw new TypeError("Cannot build a source anchor without blocks");
  const samePage = usable.filter((block) => block.page_index === first.page_index);
  const quote = samePage.map(blockText).filter(Boolean).join("\n").slice(0, 4000);
  return {
    document_id: document.id,
    document_revision_id: document.revision_id,
    page_index: first.page_index,
    ...(first.printed_page ? { printed_page: first.printed_page } : {}),
    block_ids: [...new Set(samePage.map((block) => block.id))],
    ...(quote ? { quote } : {}),
    content_hash: createHash("sha256").update(quote || samePage.map((block) => block.id).join("|")).digest("hex")
  };
}

function anchorsForBlocks(document, blocks) {
  const byPage = new Map();
  blocks.filter(Boolean).forEach((block) => {
    const pageBlocks = byPage.get(block.page_index) || [];
    pageBlocks.push(block);
    byPage.set(block.page_index, pageBlocks);
  });
  return [...byPage.values()].map((pageBlocks) => anchorForPage(document, pageBlocks));
}

function averageExtraction(blocks) {
  if (!blocks.length) return 0;
  return blocks.reduce((sum, block) => sum + Number(block.extraction?.confidence || 0), 0) / blocks.length;
}

function confidenceFor(blocks, overrides = {}) {
  const extraction = Number(averageExtraction(blocks).toFixed(4));
  const overall = overrides.overall ?? extraction;
  return {
    overall: Number(overall.toFixed(4)),
    extraction,
    source_alignment: overrides.source_alignment ?? 1,
    ...(overrides.identity_mapping !== undefined ? { identity_mapping: overrides.identity_mapping } : {}),
    ...(overrides.relation !== undefined ? { relation: overrides.relation } : {}),
    ...(overrides.grading !== undefined ? { grading: overrides.grading } : {})
  };
}

function provenanceFor(document, blocks, parentIds = []) {
  return {
    method: "deterministic_rule",
    pipeline: PIPELINE,
    source_anchors: anchorsForBlocks(document, blocks),
    parent_ids: [...new Set(parentIds)],
    recorded_at: document.provenance.recorded_at
  };
}

function envelope(document, id, revisionId, blocks, { parentIds = [], confidence = {} } = {}) {
  return {
    schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
    id,
    revision_id: revisionId,
    provenance: provenanceFor(document, blocks, parentIds),
    confidence: confidenceFor(blocks, confidence),
    review_status: "candidate"
  };
}

function shortName(text, fallback) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  const sentence = compact.split(/[。！？;；\n]/)[0];
  return (sentence || compact).slice(0, 80);
}

function firstObjectiveVerb(text) {
  const compact = String(text || "").replace(/^\s*[（(]?\d+[）).、]?\s*/, "");
  return OBJECTIVE_VERBS.find((verb) => compact.startsWith(verb)) || null;
}

function makeRelation(document, source, target, relationType, blocks) {
  const id = stableId("rel", document.revision_id, source.id, relationType, target.id);
  return assertTypedRelation({
    ...envelope(document, id, `${id}:r1`, blocks, {
      parentIds: [source.id, target.id],
      confidence: { relation: 1 }
    }),
    source_id: source.id,
    source_type: source.candidate_type,
    target_id: target.id,
    target_type: target.candidate_type,
    relation_type: relationType,
    scope: "same_framework"
  });
}

function compileCurriculum(document, blocks) {
  const curriculumCandidates = [];
  const relations = [];
  const headingStack = [];

  for (const block of blocks) {
    if (!["heading", "paragraph", "list_item"].includes(block.type)) continue;
    const statement = blockText(block);
    if (statement.length < 2) continue;

    const clauseId = stableId("clause", document.revision_id, block.id, statement);
    const parent = block.type === "heading" ? headingStack.at(-1) : headingStack.at(-1);
    const clause = assertCurriculumStandardCandidate({
      ...envelope(document, clauseId, `${clauseId}:r1`, [block]),
      candidate_type: "standard_clause",
      canonical_name: shortName(statement, `条款 ${block.id}`),
      statement,
      knowledge_form: "unspecified",
      ...(parent ? { parent_candidate_id: parent.id } : {}),
      aliases: [],
      source_anchor: anchorForPage(document, [block])
    });
    curriculumCandidates.push(clause);
    if (parent) relations.push(makeRelation(document, clause, parent, "part_of", [block]));

    if (block.type === "heading") {
      headingStack.splice(0, headingStack.length, clause);
      continue;
    }

    const actionVerb = firstObjectiveVerb(statement);
    if (!actionVerb) continue;
    const objectiveId = stableId("objective", document.revision_id, block.id, statement);
    const objective = assertCurriculumStandardCandidate({
      ...envelope(document, objectiveId, `${objectiveId}:r1`, [block], { parentIds: [clause.id] }),
      candidate_type: "learning_objective",
      canonical_name: shortName(statement, `学习目标 ${block.id}`),
      statement,
      action_verb: actionVerb,
      knowledge_form: "unspecified",
      parent_candidate_id: clause.id,
      aliases: [],
      source_anchor: anchorForPage(document, [block])
    });
    curriculumCandidates.push(objective);
    relations.push(makeRelation(document, objective, clause, "derived_from_clause", [block]));
  }

  return { curriculumCandidates, relations };
}

function inferQuestionType(group) {
  const explicit = group.stem.annotations?.question_type;
  if (explicit) return explicit;
  if (group.options.length >= 2) return "single_choice";
  const text = blockText(group.stem);
  if (/证明|求证/.test(text)) return "proof";
  if (/计算|求(?!证)|解方程|化简/.test(text)) return "calculation";
  if (/填空|____|_{3,}|（\s*）/.test(text)) return "fill_blank";
  return "unknown";
}

function inferResponseType(questionType, stem) {
  const explicit = stem.annotations?.response_type;
  if (explicit) return explicit;
  return ({
    single_choice: "single_select",
    multiple_choice: "multi_select",
    true_false: "boolean",
    fill_blank: "text",
    short_answer: "text",
    calculation: "workings",
    proof: "workings",
    essay: "essay",
    composite: "unknown",
    unknown: "unknown"
  })[questionType];
}

function parseOption(block, document, questionId, index) {
  const raw = blockText(block);
  const match = raw.match(/^\s*([A-HＡ-Ｈ])\s*[.．、:：)）]\s*(.*)$/s);
  const label = block.annotations?.option_label || match?.[1] || String.fromCharCode(65 + index);
  const text = (match?.[2] || raw).trim();
  return {
    id: stableId("option", document.revision_id, questionId, block.id, label),
    label,
    text
  };
}

function groupQuestions(blocks) {
  const groups = [];
  let current = null;
  for (const block of blocks) {
    if (block.type === "question_stem") {
      if (current) groups.push(current);
      current = { stem: block, options: [], assets: [], responses: [], marks: [], scores: [] };
      continue;
    }
    if (!current) continue;
    if (block.type === "question_option") current.options.push(block);
    else if (["image", "diagram", "formula"].includes(block.type)) current.assets.push(block);
    else if (block.type === "student_response") current.responses.push(block);
    else if (block.type === "teacher_mark") current.marks.push(block);
    else if (block.type === "score") current.scores.push(block);
  }
  if (current) groups.push(current);
  return groups;
}

function compileQuestion(document, group) {
  const blocks = [group.stem, ...group.options, ...group.assets];
  const explicitQuestionId = group.stem.annotations?.question_id;
  const id = explicitQuestionId || stableId("question", document.revision_id, group.stem.id, blockText(group.stem));
  const revisionId = stableId("questionrev", document.revision_id, id, ...blocks.map((block) => block.id));
  const questionType = inferQuestionType(group);
  const partId = group.stem.annotations?.part_id || stableId("part", revisionId, group.stem.id);
  const assetIds = group.assets.map((block) => block.asset_id).filter(Boolean);
  const partAnchor = anchorForPage(document, blocks);
  const question = assertQuestionIR({
    ...envelope(document, id, revisionId, blocks),
    privacy: "public_prompt",
    question_type: questionType,
    language: document.language,
    stem: blockText(group.stem),
    stimulus: null,
    parts: [{
      id: partId,
      ...(group.stem.annotations?.question_number ? { label: group.stem.annotations.question_number } : {}),
      stem: blockText(group.stem),
      response_type: inferResponseType(questionType, group.stem),
      options: group.options.map((block, index) => parseOption(block, document, id, index)),
      asset_ids: assetIds,
      source_anchor: partAnchor
    }],
    asset_ids: assetIds,
    task_features: { cognitive_process: "unspecified", proposition_angles: [] },
    source_anchor: partAnchor
  });
  return { question, partId, blocks };
}

function compileQuestionKnowledgeLinks(document, group, question, partId) {
  const hints = group.stem.annotations?.knowledge_links || [];
  return hints.map((hint) => {
    const id = stableId("qk", question.revision_id, partId, hint.knowledge_point_id, hint.relation, hint.role);
    return assertQuestionKnowledgeLink({
      ...envelope(document, id, `${id}:r1`, [group.stem], {
        parentIds: [question.id, hint.knowledge_point_id],
        confidence: { overall: hint.confidence, relation: hint.confidence }
      }),
      question_id: question.id,
      question_revision_id: question.revision_id,
      part_id: partId,
      knowledge_point_id: hint.knowledge_point_id,
      relation: hint.relation,
      role: hint.role,
      weight: hint.weight,
      observable_indicator: hint.observable_indicator,
      solution_step_ids: [],
      rubric_point_ids: [],
      mapping_method: "imported"
    });
  });
}

function resolvedIdentity(learnerContext = {}) {
  const tenantId = learnerContext.tenant_id || null;
  const learnerId = learnerContext.learner_id || null;
  return {
    tenant_id: tenantId,
    learner_id: learnerId,
    status: tenantId && learnerId ? "resolved" : "unresolved"
  };
}

function compileSubmission(document, compiledGroups, learnerContext = {}) {
  const withResponses = compiledGroups.filter(({ group }) => group.responses.length > 0);
  if (!withResponses.length) return null;
  const allBlocks = withResponses.flatMap(({ group }) => [
    ...group.responses,
    ...group.marks,
    ...group.scores
  ]);
  const id = stableId("submission", document.revision_id, ...allBlocks.map((block) => block.id));
  const revisionId = `${id}:r1`;
  const identity = resolvedIdentity(learnerContext);
  const opportunityId = learnerContext.opportunity_id || stableId("opportunity", document.revision_id);
  const attemptId = learnerContext.attempt_id || stableId("attempt", document.revision_id, id);
  const responses = withResponses.map(({ group, question, partId }) => {
    const responseBlocks = group.responses;
    return {
      question_id: question.id,
      question_revision_id: question.revision_id,
      part_id: partId,
      response_text: responseBlocks.map(blockText).filter(Boolean).join("\n") || null,
      selected_option_ids: [],
      asset_ids: responseBlocks.map((block) => block.asset_id).filter(Boolean),
      source_anchor: anchorForPage(document, responseBlocks)
    };
  });
  const gradingEvents = withResponses.flatMap(({ group, question, partId }) => {
    const feedback = group.marks.map(blockText).filter(Boolean).join("\n") || null;
    return group.scores
      .filter((scoreBlock) => Number.isFinite(scoreBlock.annotations?.score_value) && Number.isFinite(scoreBlock.annotations?.max_score))
      .map((scoreBlock) => ({
        question_id: question.id,
        part_id: partId,
        score: scoreBlock.annotations.score_value,
        max_score: scoreBlock.annotations.max_score,
        is_final: scoreBlock.annotations.is_final_grade === true,
        grader_type: "imported",
        feedback,
        source_anchor: anchorForPage(document, [scoreBlock, ...group.marks])
      }));
  });
  const assistanceLevel = learnerContext.assistance_level || allBlocks.find((block) => block.annotations?.assistance_level)?.annotations.assistance_level || "unknown";
  return assertSubmissionIR({
    ...envelope(document, id, revisionId, allBlocks, {
      confidence: { identity_mapping: identity.status === "resolved" ? 1 : 0 }
    }),
    document_id: document.id,
    identity,
    attempt: {
      id: attemptId,
      opportunity_id: opportunityId,
      session_id: learnerContext.session_id || null,
      submitted_at: learnerContext.submitted_at || null
    },
    responses,
    grading_events: gradingEvents,
    assistance_level: assistanceLevel,
    source_anchor: anchorForPage(document, allBlocks)
  });
}

function evidenceOutcome(score, maxScore) {
  const ratio = score / maxScore;
  if (ratio >= 0.999) return { outcome: "positive", strength: "strong" };
  if (ratio >= 0.6) return { outcome: "mixed", strength: "medium" };
  if (ratio > 0) return { outcome: "negative", strength: "medium" };
  return { outcome: "negative", strength: "strong" };
}

function compileEvidence(document, submission, authoritativeLinks, { duplicate_safe = false } = {}) {
  if (!submission) return [];
  const links = authoritativeLinks.filter((link) => link.review_status === "verified");
  return submission.grading_events.flatMap((grade) => links
    .filter((link) => link.question_id === grade.question_id && link.part_id === grade.part_id && link.relation === "assesses")
    .map((link) => {
      const requirements = {
        identity_confirmed: submission.identity.status === "resolved",
        question_version_confirmed: true,
        mapping_verified: true,
        grading_final: grade.is_final,
        answer_not_exposed: !["answer_exposed", "unknown"].includes(submission.assistance_level),
        duplicate_safe: duplicate_safe === true
      };
      const withheldReasons = Object.entries(requirements)
        .filter(([, passed]) => !passed)
        .map(([name]) => name);
      if (["strong_hint"].includes(submission.assistance_level)) withheldReasons.push("strong_hint");
      const canUpdate = withheldReasons.length === 0;
      const { outcome, strength } = evidenceOutcome(grade.score, grade.max_score);
      const sourceBlocks = flattenBlocks(document).filter((block) => grade.source_anchor.block_ids.includes(block.id));
      const id = stableId("evidence", submission.attempt.id, link.id, grade.question_id, grade.part_id);
      return assertEvidenceCandidate({
        ...envelope(document, id, `${id}:r1`, sourceBlocks, {
          parentIds: [submission.id, link.id],
          confidence: {
            overall: Math.min(link.confidence.overall, submission.confidence.overall),
            identity_mapping: submission.confidence.identity_mapping ?? 0,
            relation: link.confidence.relation ?? link.confidence.overall,
            grading: grade.grader_type === "human" ? 1 : 0.85
          }
        }),
        identity: submission.identity,
        opportunity_id: submission.attempt.opportunity_id,
        attempt_id: submission.attempt.id,
        question_id: grade.question_id,
        question_revision_id: link.question_revision_id,
        part_id: grade.part_id,
        question_knowledge_link_id: link.id,
        knowledge_point_id: link.knowledge_point_id,
        dimension: "knowledge_skill",
        outcome,
        strength,
        independence: submission.assistance_level,
        attribution_role: link.role,
        observed_step_ids: [],
        error_codes: [],
        misconception_candidate_ids: [],
        grading: {
          score: grade.score,
          max_score: grade.max_score,
          is_final: grade.is_final,
          grader_type: grade.grader_type
        },
        eligibility: {
          can_update_mastery: canUpdate,
          withheld_reasons: [...new Set(withheldReasons)],
          requirements
        },
        normalized_contribution_key: stableId("contribution", submission.attempt.id, link.knowledge_point_id),
        observed_at: submission.attempt.submitted_at || document.provenance.recorded_at
      });
    }));
}

/**
 * Compile deterministic candidates from a validated DocumentIR.
 *
 * The compiler never invents knowledge mappings. QuestionKnowledgeLink values
 * are emitted only from explicit, typed block annotations; mastery-eligible
 * evidence requires caller-supplied, already verified authoritative links.
 */
export function compileEducationImportCandidates(documentInput, options = {}) {
  const document = assertDocumentIR(documentInput);
  const blocks = flattenBlocks(document);
  const result = {
    schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
    document_id: document.id,
    document_revision_id: document.revision_id,
    curriculum_candidates: [],
    questions: [],
    submissions: [],
    relations: [],
    question_knowledge_links: [],
    evidence_candidates: [],
    issues: []
  };

  if (CURRICULUM_DOCUMENTS.has(document.document_type)) {
    const curriculum = compileCurriculum(document, blocks);
    result.curriculum_candidates.push(...curriculum.curriculumCandidates);
    result.relations.push(...curriculum.relations);
  }

  if (QUESTION_DOCUMENTS.has(document.document_type)) {
    const groups = groupQuestions(blocks);
    const compiledGroups = groups.map((group) => {
      const compiled = compileQuestion(document, group);
      result.questions.push(compiled.question);
      result.question_knowledge_links.push(
        ...compileQuestionKnowledgeLinks(document, group, compiled.question, compiled.partId)
      );
      return { group, ...compiled };
    });
    if (!groups.length) {
      result.issues.push({
        code: "NO_QUESTION_BOUNDARIES",
        severity: "warning",
        message: "No question_stem blocks were found; no questions were guessed from generic paragraphs."
      });
    }

    if (SUBMISSION_DOCUMENTS.has(document.document_type)) {
      const submission = compileSubmission(document, compiledGroups, options.learner_context || {});
      if (submission) result.submissions.push(submission);
      else {
        result.issues.push({
          code: "NO_STUDENT_RESPONSES",
          severity: "warning",
          message: "No student_response blocks were found; no submission was synthesized."
        });
      }
      const authoritativeLinks = Array.isArray(options.authoritative_question_knowledge_links)
        ? options.authoritative_question_knowledge_links.map(assertQuestionKnowledgeLink)
        : [];
      result.evidence_candidates.push(...compileEvidence(document, submission, authoritativeLinks, {
        duplicate_safe: options.duplicate_safe === true
      }));
    }
  }

  if (!CURRICULUM_DOCUMENTS.has(document.document_type) && !QUESTION_DOCUMENTS.has(document.document_type)) {
    result.issues.push({
      code: "UNSUPPORTED_DOCUMENT_COMPILER",
      severity: "info",
      message: `Document type ${document.document_type} is retained as DocumentIR but has no deterministic candidate compiler.`
    });
  }
  return result;
}

export const EDUCATION_IMPORT_COMPILER_PIPELINE = PIPELINE;
