import { createHash } from "node:crypto";

import { EducationDataStoreError } from "./education-data-store.js";
import { createEducationMasteryEngine } from "./education-mastery-engine.js";
import {
  calculateEvidenceContribution,
  calculateMasteryProjection,
} from "./education-mastery-policy.js";

export function createEducationDataService({
  store,
  masteryEngine = null,
  verifyGradingReceipt = () => false,
  // Legacy internal callers can keep a server verifier while migrating to
  // recordVerifiedAssessment(). Browser/Agent data is never a verifier.
  verifyMasteryEvidence = () => false,
  clock = () => new Date().toISOString(),
} = {}) {
  if (!store) throw new TypeError("store is required");
  const authoritativeMastery = masteryEngine || createEducationMasteryEngine({
    store,
    verifyGradingReceipt,
  });

  function listStudents({ tenantId, accessibleStudentIds = null } = {}) {
    const allowed = accessibleStudentIds ? new Set(accessibleStudentIds) : null;
    return store.listStudents({ tenantId })
      .filter((student) => !allowed || allowed.has(student.student_id))
      .map((student) => ({ ...student, mastery_summary: masterySummary({ tenantId, studentId: student.student_id }) }));
  }

  function getStudentProfile({ tenantId, studentId }) {
    const student = store.getStudent({ tenantId, studentId });
    if (!student) throw notFoundStudent();
    return {
      ...student,
      mastery_summary: masterySummary({ tenantId, studentId }),
      recent_learning_events: store.listLearningEvents({ tenantId, studentId, limit: 8 }).items
    };
  }

  function masterySummary({ tenantId, studentId }) {
    const ontology = store.listOntologies({ tenantId })[0];
    if (!ontology) return emptyMasterySummary();
    const snapshot = store.listMastery({
      tenantId,
      studentId,
      ontologyId: ontology.ontology_id,
      ontologyVersion: ontology.ontology_version,
      limit: 1_000
    });
    const byState = Object.fromEntries(["mastered", "secure", "learning", "weak", "unassessed"].map((state) => [state, 0]));
    let probabilityTotal = 0;
    let assessed = 0;
    for (const item of snapshot.items) {
      byState[item.mastery_state] += 1;
      if (item.mastery_probability != null) {
        probabilityTotal += item.mastery_probability;
        assessed += 1;
      }
    }
    return {
      ontology_id: snapshot.ontology_id,
      ontology_version: snapshot.ontology_version,
      knowledge_point_count: snapshot.total,
      assessed_count: assessed,
      coverage: snapshot.total ? round(assessed / snapshot.total) : 0,
      average_mastery_probability: assessed ? round(probabilityTotal / assessed) : null,
      by_state: byState
    };
  }

  function getMastery(input) {
    return store.listMastery(input);
  }

  function getMasteryHistory({
    tenantId,
    studentId,
    ontologyId,
    ontologyVersion = "",
    knowledgePointId = "",
    limit = 1_000,
    offset = 0,
  } = {}) {
    const selectedOntologyId = ontologyId
      || store.listOntologies({ tenantId })[0]?.ontology_id;
    const evidence = store.listMasteryEvidence({
      tenantId,
      studentId,
      ontologyId: selectedOntologyId,
      ontologyVersion,
      knowledgePointId,
      limit,
      offset,
      order: "desc",
    });
    const replayEvidence = evidence.total > evidence.items.length || evidence.offset > 0
      ? store.listMasteryEvidence({
        tenantId,
        studentId,
        ontologyId: evidence.ontology_id,
        ontologyVersion: evidence.ontology_version,
        knowledgePointId,
        limit: 1_000,
        offset: 0,
        order: "asc",
      })
      : { ...evidence, items: [...evidence.items].reverse() };
    const configuration = authoritativeMastery.getConfiguration({ tenantId });
    const policy = configuration.policy;
    const calculatedAt = validIso(clock()) || new Date().toISOString();
    const calculatedAtMs = Date.parse(calculatedAt);
    const appliedByKnowledgePoint = new Map();
    const replayedItems = replayEvidence.items.map((row) => {
      const applied = appliedByKnowledgePoint.get(row.knowledge_point_id) || [];
      const before = calculateMasteryProjection(applied, policy, { now: calculatedAt });
      const evidenceEligible = row.apply_to_mastery === true && row.score != null;
      if (evidenceEligible) applied.push(row);
      appliedByKnowledgePoint.set(row.knowledge_point_id, applied);
      const after = calculateMasteryProjection(applied, policy, { now: calculatedAt });
      const beforeSnapshot = projectionSnapshot(before);
      const afterSnapshot = projectionSnapshot(after);
      const change = projectionDelta(beforeSnapshot, afterSnapshot);
      const context = safeEvidenceContext(row.metadata);
      const contribution = evidenceEligible
        ? calculateEvidenceContribution(row, policy, calculatedAtMs)
        : null;
      return {
        evidence_id: row.evidence_id,
        knowledge_point_id: row.knowledge_point_id,
        knowledge_point_name: row.knowledge_point_name || "",
        knowledge_point: {
          id: row.knowledge_point_id,
          name: row.knowledge_point_name || "",
        },
        evidence_type: row.evidence_type,
        evidence_class: row.evidence_class,
        outcome: row.outcome,
        score: row.score,
        weight: row.weight,
        sample_count: row.sample_count,
        apply_to_mastery: row.apply_to_mastery === true,
        source_type: row.source_type,
        source_ref: row.source_ref,
        occurred_at: row.occurred_at,
        eligible_for_projection: evidenceEligible,
        included_in_current_projection: policy.enabled !== false
          && evidenceEligible
          && Number(contribution?.weight || 0) > 0,
        exclusion_reason: historyExclusionReason(row, policy),
        title: context.title,
        description: context.description,
        difficulty: context.difficulty,
        hints_used: context.hints_used,
        duration_ms: context.duration_ms,
        effective_score: contribution ? round(contribution.score) : null,
        effective_weight: contribution ? round(contribution.weight) : 0,
        before_probability: beforeSnapshot.mastery_probability,
        after_probability: afterSnapshot.mastery_probability,
        delta: probabilityDelta(beforeSnapshot.mastery_probability, afterSnapshot.mastery_probability),
        before_state: beforeSnapshot.mastery_state,
        after_state: afterSnapshot.mastery_state,
        context,
        before: beforeSnapshot,
        after: afterSnapshot,
        projection_delta: change,
      };
    });
    const replayById = new Map(replayedItems.map((item) => [item.evidence_id, item]));
    const items = evidence.items.map((item) => replayById.get(item.evidence_id)).filter(Boolean);
    const byKnowledgePoint = [...appliedByKnowledgePoint.entries()].map(([id, rows]) => {
      const item = replayEvidence.items.find((candidate) => candidate.knowledge_point_id === id);
      return {
        knowledge_point_id: id,
        knowledge_point_name: item?.knowledge_point_name || "",
        knowledge_point: { id, name: item?.knowledge_point_name || "" },
        ...projectionSnapshot(calculateMasteryProjection(rows, policy, { now: calculatedAt })),
        applied_evidence_count: rows.length,
      };
    });
    const byClass = summarizeBy(replayedItems, "evidence_class");
    const rules = safeCalculationRules(configuration);
    const current = knowledgePointId ? byKnowledgePoint[0] || null : null;
    return {
      schema_version: "education-mastery-history@1.0",
      student_id: evidence.student_id,
      ontology_id: evidence.ontology_id,
      ontology_version: evidence.ontology_version,
      knowledge_point_id: evidence.knowledge_point_id,
      calculated_at: calculatedAt,
      history_mode: "replayed_current_policy",
      policy: rules,
      calculation_rules: rules,
      total: evidence.total,
      summary: {
        total_evidence_count: evidence.total,
        returned_evidence_count: items.length,
        eligible_evidence_count: replayedItems.filter((item) => item.eligible_for_projection).length,
        applied_evidence_count: replayedItems.filter((item) => item.included_in_current_projection).length,
        proposal_evidence_count: replayedItems.filter((item) => item.evidence_class === "proposal").length,
        changed_step_count: replayedItems.filter((item) => item.projection_delta.state_changed
          || item.projection_delta.initialized
          || item.delta !== 0
          || item.projection_delta.evidence_count !== 0).length,
        knowledge_point_count: byKnowledgePoint.length,
        truncated: evidence.offset + evidence.items.length < evidence.total,
        replay_complete: replayEvidence.items.length === evidence.total,
        by_class: byClass,
        current,
        by_knowledge_point: byKnowledgePoint,
      },
      limit: evidence.limit,
      offset: evidence.offset,
      items,
    };
  }

  function getLearningEvents(input) {
    return store.listLearningEvents(input);
  }

  function recordMasteryEvidence(input) {
    if (input?.evidence?.apply_to_mastery === true && verifyMasteryEvidence(input) !== true) {
      throw new EducationDataStoreError("掌握证据尚未通过服务端作答/判题记录校验", {
        code: "mastery_evidence_not_verified",
        status: 422
      });
    }
    return store.recordMasteryEvidence(input);
  }

  function recordVerifiedAssessment(input) {
    return authoritativeMastery.recordVerifiedAssessment(input);
  }

  function recordMasteryProposal(input) {
    return authoritativeMastery.recordProposal(input);
  }

  function recordLearningInteraction({ tenantId, studentId, interaction } = {}) {
    const source = interaction && typeof interaction === "object" ? interaction : {};
    const interactionId = requiredServiceId(
      source.interaction_id ?? source.request_id ?? source.source_ref,
      "interaction_id",
    );
    const ontologyId = requiredServiceId(source.ontology_id, "ontology_id");
    const ontologyVersion = requiredServiceId(source.ontology_version, "ontology_version");
    const knowledgePointIds = [...new Set(
      (Array.isArray(source.knowledge_point_ids) ? source.knowledge_point_ids : [])
        .map((value) => requiredServiceId(value, "knowledge_point_id")),
    )].slice(0, 16);
    if (!knowledgePointIds.length) {
      throw new EducationDataStoreError("学习互动必须关联至少一个知识点", {
        code: "learning_interaction_knowledge_required",
        status: 422,
      });
    }
    const occurredAt = validIso(source.occurred_at) || validIso(clock()) || new Date().toISOString();
    const title = safeText(source.title, 240) || "完成一次知识问答";
    const description = safeText(source.description, 1_000) || "已记录本轮涉及的知识点；普通提问不作为掌握度得分。";
    const evidenceType = safeKey(source.evidence_type, "knowledge_interaction");
    const sourceType = safeKey(source.source_type, "learning_interaction");
    const outcome = safeKey(source.outcome, "knowledge_exposure");
    const records = knowledgePointIds.map((knowledgePointId) => {
      const digest = createHash("sha256")
        .update(`${tenantId}\u0000${studentId}\u0000${interactionId}\u0000${knowledgePointId}`)
        .digest("hex")
        .slice(0, 32);
      const proposalId = `learning-interaction:${digest}`;
      const write = authoritativeMastery.recordProposal({
        tenantId,
        studentId,
        proposal: {
          proposal_id: proposalId,
          ontology_id: ontologyId,
          ontology_version: ontologyVersion,
          knowledge_point_id: knowledgePointId,
          evidence_type: evidenceType,
          outcome,
          source_type: sourceType,
          source_ref: interactionId,
          occurred_at: occurredAt,
          title,
          description,
          payload: {
            interaction_id: interactionId,
            event_type: safeKey(source.event_type, "knowledge_question"),
            mastery_changed: false,
          },
        },
      });
      return {
        evidence_id: `proposal:${proposalId}`,
        knowledge_point_id: knowledgePointId,
        idempotent: write.idempotent === true,
        apply_to_mastery: false,
        mastery_changed: false,
      };
    });
    return {
      schema_version: "education-learning-interaction-receipt@1.0",
      interaction_id: interactionId,
      student_id: studentId,
      ontology_id: ontologyId,
      ontology_version: ontologyVersion,
      evidence_class: "proposal",
      apply_to_mastery: false,
      mastery_changed: false,
      idempotent: records.every((item) => item.idempotent),
      records,
    };
  }

  function getMasteryConfiguration(input) {
    return authoritativeMastery.getConfiguration(input);
  }

  function updateMasteryConfiguration(input) {
    return authoritativeMastery.updateConfiguration(input);
  }

  return Object.freeze({
    summary: (input) => store.summary(input),
    listStudents,
    getStudentProfile,
    getMastery,
    getMasteryHistory,
    getLearningEvents,
    recordMasteryEvidence,
    recordVerifiedAssessment,
    recordMasteryProposal,
    recordLearningInteraction,
    getMasteryConfiguration,
    updateMasteryConfiguration,
    listOntologies: (input) => store.listOntologies(input),
    getOntologyGraph: (input) => store.getOntologyGraph(input),
    listKnowledgePoints: (input) => store.listKnowledgePoints(input),
    listQuestions: (input) => store.listQuestions(input),
    getQuestion: (input) => store.getQuestion(input),
    getQuestionSolution: (input) => store.getQuestionSolution(input)
  });
}

function emptyMasterySummary() {
  return {
    ontology_id: null,
    ontology_version: null,
    knowledge_point_count: 0,
    assessed_count: 0,
    coverage: 0,
    average_mastery_probability: null,
    by_state: { mastered: 0, secure: 0, learning: 0, weak: 0, unassessed: 0 }
  };
}

function notFoundStudent() {
  return new EducationDataStoreError("学生不存在或不属于当前租户", {
    code: "student_not_found",
    status: 404
  });
}

function round(value) {
  return Number(Number(value).toFixed(4));
}

function projectionSnapshot(value = {}) {
  return {
    mastery_state: value.mastery_state || "unassessed",
    mastery_probability: value.mastery_probability == null ? null : round(value.mastery_probability),
    confidence: round(value.confidence || 0),
    evidence_count: Math.max(0, Number(value.evidence_count) || 0),
    total_weight: round(value.total_weight || 0),
    latest_source: value.latest_source || null,
    last_event_at: value.last_event_at || null,
  };
}

function projectionDelta(before = {}, after = {}) {
  const beforeProbability = before.mastery_probability;
  const afterProbability = after.mastery_probability;
  return {
    mastery_probability: beforeProbability == null || afterProbability == null
      ? null
      : round(afterProbability - beforeProbability),
    confidence: round((after.confidence || 0) - (before.confidence || 0)),
    evidence_count: Math.max(0, Number(after.evidence_count) || 0)
      - Math.max(0, Number(before.evidence_count) || 0),
    total_weight: round((after.total_weight || 0) - (before.total_weight || 0)),
    state_changed: (before.mastery_state || "unassessed") !== (after.mastery_state || "unassessed"),
    initialized: beforeProbability == null && afterProbability != null,
  };
}

function probabilityDelta(before, after) {
  if (before == null && after == null) return 0;
  if (before == null) return round(after || 0);
  if (after == null) return round(-before);
  return round(after - before);
}

function summarizeBy(items, field) {
  const result = {};
  for (const item of items) {
    const key = safeKey(item?.[field], "unknown");
    const current = result[key] || { count: 0, applied_count: 0 };
    current.count += 1;
    if (item.included_in_current_projection) current.applied_count += 1;
    result[key] = current;
  }
  return result;
}

function historyExclusionReason(row, policy) {
  if (row.evidence_class === "proposal") return "agent_proposal_never_scored";
  if (row.apply_to_mastery !== true) return "not_marked_for_mastery";
  if (row.score == null) return "missing_score";
  if (policy.enabled === false) return "mastery_policy_disabled";
  return null;
}

function safeEvidenceContext(value) {
  const metadata = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const factors = metadata.mastery_factors && typeof metadata.mastery_factors === "object"
    ? metadata.mastery_factors
    : {};
  return {
    title: safeText(metadata.title, 240) || null,
    description: safeText(metadata.description, 1_000) || null,
    difficulty: safeKey(factors.difficulty ?? metadata.difficulty, "default"),
    hints_used: Math.max(0, Number(factors.hints_used ?? metadata.hints_used) || 0),
    duration_ms: Math.max(0, Number(factors.duration_ms ?? metadata.duration_ms) || 0),
    question_id: safeOptionalId(metadata.question_id),
    attempt_id: safeOptionalId(metadata.attempt_id),
  };
}

function safeCalculationRules(configuration) {
  const policy = configuration?.policy || {};
  return {
    schema_version: policy.schema_version || "education-mastery-policy@1.0",
    config_version: Number(configuration?.config_version || 0),
    enabled: policy.enabled !== false,
    algorithm: policy.algorithm || "weighted_evidence_decay_v1",
    contribution_gate: {
      required: ["apply_to_mastery=true", "score is not null"],
      agent_proposals: "recorded_but_never_scored",
      real_evidence: "server_verified_grading_receipt_only",
    },
    thresholds: { ...(policy.thresholds || {}) },
    outcome_scores: { ...(policy.outcome_scores || {}) },
    difficulty_weights: { ...(policy.difficulty_weights || {}) },
    source_weights: { ...(policy.source_weights || {}) },
    evidence_class_weights: { ...(policy.evidence_class_weights || {}) },
    hint_adjustment: { ...(policy.hint_adjustment || {}) },
    duration_adjustment: {
      ...(policy.duration_adjustment || {}),
      expected_ms: { ...(policy.duration_adjustment?.expected_ms || {}) },
    },
    forgetting: { ...(policy.forgetting || {}) },
    confidence: { ...(policy.confidence || {}) },
  };
}

function requiredServiceId(value, field) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 200 || !/^[\p{L}\p{N}_.:@/+~-]+$/u.test(id)) {
    throw new EducationDataStoreError(`${field} 不是合法标识符`, {
      code: "invalid_identifier",
      status: 400,
    });
  }
  return id;
}

function safeOptionalId(value) {
  const id = String(value ?? "").trim();
  return id && id.length <= 200 && /^[\p{L}\p{N}_.:@/+~-]+$/u.test(id) ? id : null;
}

function safeKey(value, fallback) {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 120);
  return key || fallback;
}

function safeText(value, maximum) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function validIso(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}
