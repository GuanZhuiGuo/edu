import assert from "node:assert/strict";
import test from "node:test";

import { createEducationDataRuntime } from "../education-data-runtime.js";
import { createEducationDataService } from "../education-data-service.js";
import {
  createEducationMasteryEngine,
  createHmacGradingReceiptAuthority,
} from "../education-mastery-engine.js";
import { calculateMasteryProjection, DEFAULT_MASTERY_POLICY } from "../education-mastery-policy.js";

const NOW = "2026-08-24T08:00:00.000Z";
const SECRET = "mastery-test-secret-contains-more-than-thirty-two-bytes";

function fixture() {
  const runtime = createEducationDataRuntime({
    env: { EDUCATION_DATA_SEED_DEMO: "true" },
    storeOptions: { filename: ":memory:", clock: () => NOW },
  });
  runtime.store.upsertStudent({
    tenantId: runtime.tenantId,
    student: { student_id: "real-student-001", name: "真实学生", is_demo: false },
  });
  const authority = createHmacGradingReceiptAuthority({ secret: SECRET, clock: () => NOW });
  const engine = createEducationMasteryEngine({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
    clock: () => NOW,
  });
  const service = createEducationDataService({ store: runtime.store, masteryEngine: engine });
  const question = runtime.store.listQuestions({ tenantId: runtime.tenantId, limit: 1 }).items[0];
  return { runtime, authority, service, question };
}

function issueAttempt({ authority, runtime, question, id = "001", score = 1, hintsUsed = 0, durationMs = 90_000 }) {
  return authority.issue({
    receipt_id: `receipt:${id}`,
    tenant_id: runtime.tenantId,
    student_id: "real-student-001",
    attempt_id: `attempt:${id}`,
    question_id: question.id,
    question_version: question.version,
    score,
    hints_used: hintsUsed,
    duration_ms: durationMs,
    evidence_source: "deterministic_grader",
    graded_at: NOW,
  });
}

test("default policy is persisted, enabled and keeps demo evidence visibly separate", () => {
  const { runtime, service } = fixture();
  try {
    const first = service.getMasteryConfiguration({ tenantId: runtime.tenantId });
    const second = service.getMasteryConfiguration({ tenantId: runtime.tenantId });
    assert.equal(first.policy.enabled, true);
    assert.equal(first.policy.algorithm, "weighted_evidence_decay_v1");
    assert.equal(first.config_version, 1);
    assert.equal(second.config_version, 1);
    assert.ok(first.evidence.by_class.demo.count > 300);
    assert.equal(first.evidence.by_class.real.count, 0);
    assert.equal(first.authority.agent_output, "proposal_only_never_applied");
  } finally {
    runtime.store.close();
  }
});

test("signed grading receipt writes aligned real evidence once and rejects tampering", () => {
  const { runtime, authority, service, question } = fixture();
  try {
    const receipt = issueAttempt({ authority, runtime, question, hintsUsed: 2 });
    const first = service.recordVerifiedAssessment({
      tenantId: runtime.tenantId,
      studentId: "real-student-001",
      receipt,
    });
    const repeated = service.recordVerifiedAssessment({
      tenantId: runtime.tenantId,
      studentId: "real-student-001",
      receipt,
    });
    assert.equal(first.idempotent, false);
    assert.equal(repeated.idempotent, true);
    assert.equal(first.receipt.question_id, question.id);
    assert.ok(first.projections.every((projection) => projection.mastery_probability < 1));
    const summary = service.getMasteryConfiguration({ tenantId: runtime.tenantId }).evidence;
    assert.equal(summary.verified_receipts, 1);
    assert.equal(summary.by_class.real.count, question.knowledge_point_mappings.length);

    const tampered = { ...receipt, score: 0 };
    assert.throws(() => service.recordVerifiedAssessment({
      tenantId: runtime.tenantId,
      studentId: "real-student-001",
      receipt: tampered,
    }), (error) => error.code === "grading_receipt_not_verified");
  } finally {
    runtime.store.close();
  }
});

test("receipt knowledge mapping comes from the current question and conflicts fail closed", () => {
  const { runtime, authority, service, question } = fixture();
  try {
    const receipt = authority.issue({
      ...issueAttempt({ authority, runtime, question, id: "mapping" }),
      receipt_id: "receipt:mapping-override",
      attempt_id: "attempt:mapping-override",
      knowledge_point_results: [{ knowledge_point_id: "not-mapped", score: 1 }],
      signature: undefined,
    });
    assert.throws(() => service.recordVerifiedAssessment({
      tenantId: runtime.tenantId,
      studentId: "real-student-001",
      receipt,
    }), (error) => error.code === "grading_receipt_knowledge_mismatch");
  } finally {
    runtime.store.close();
  }
});

test("Agent proposal is stored for review but never changes mastery", () => {
  const { runtime, service, question } = fixture();
  try {
    const mapping = question.knowledge_point_mappings[0];
    const before = runtime.store.getMasteryRecord({
      tenantId: runtime.tenantId,
      studentId: "real-student-001",
      ontologyId: mapping.ontology_id,
      ontologyVersion: mapping.ontology_version,
      knowledgePointId: mapping.knowledge_point_id,
    });
    const result = service.recordMasteryProposal({
      tenantId: runtime.tenantId,
      studentId: "real-student-001",
      proposal: {
        proposal_id: "agent:proposal:001",
        ontology_id: mapping.ontology_id,
        ontology_version: mapping.ontology_version,
        knowledge_point_id: mapping.knowledge_point_id,
        evidence_type: "knowledge interaction\u0000unsafe",
        outcome: "looks_mastered",
        source_type: "pi learning interaction",
        source_ref: "conversation:turn:001",
        occurred_at: NOW,
        title: "  完成\n一次知识问答  ",
        description: "只记录学习互动\u0000，不改变掌握度。",
      },
    });
    const after = runtime.store.getMasteryRecord({
      tenantId: runtime.tenantId,
      studentId: "real-student-001",
      ontologyId: mapping.ontology_id,
      ontologyVersion: mapping.ontology_version,
      knowledgePointId: mapping.knowledge_point_id,
    });
    assert.equal(result.projection.mastery_state, "unassessed");
    assert.deepEqual(after, before);
    assert.equal(service.getMasteryConfiguration({ tenantId: runtime.tenantId }).evidence.by_class.proposal.count, 1);
    const history = service.getMasteryHistory({
      tenantId: runtime.tenantId,
      studentId: "real-student-001",
      ontologyId: mapping.ontology_id,
      ontologyVersion: mapping.ontology_version,
      limit: 20,
    });
    const proposal = history.items.find((item) => item.evidence_id === "proposal:agent:proposal:001");
    assert.ok(proposal, "ordinary interaction proposal must remain visible in mastery history");
    assert.equal(proposal.evidence_class, "proposal");
    assert.equal(proposal.eligible_for_projection, false);
    assert.equal(proposal.included_in_current_projection, false);
    assert.equal(proposal.score, null);
    assert.equal(proposal.evidence_type, "knowledge_interaction_unsafe");
    assert.equal(proposal.source_type, "pi_learning_interaction");
    assert.equal(proposal.title, "完成 一次知识问答");
    assert.equal(proposal.description, "只记录学习互动 ，不改变掌握度。");
    assert.equal(proposal.source_ref, "conversation:turn:001");
    assert.equal(history.policy.algorithm, "weighted_evidence_decay_v1");
    assert.equal(history.summary.proposal_evidence_count, 1);
    assert.equal(history.summary.applied_evidence_count, 0);
    assert.equal(proposal.delta, 0);
    assert.equal(proposal.projection_delta.mastery_probability, null);
  } finally {
    runtime.store.close();
  }
});

test("policy updates are optimistic, persisted and trigger deterministic recomputation", () => {
  const { runtime, service } = fixture();
  try {
    const current = service.getMasteryConfiguration({ tenantId: runtime.tenantId });
    const updated = service.updateMasteryConfiguration({
      tenantId: runtime.tenantId,
      expectedVersion: current.config_version,
      updatedBy: "teacher:test",
      policy: {
        ...current.policy,
        thresholds: { mastered: 0.9, secure: 0.72, learning: 0.4 },
        forgetting: { ...current.policy.forgetting, half_life_days: 60 },
      },
    });
    assert.equal(updated.config_version, 2);
    assert.equal(updated.policy.thresholds.mastered, 0.9);
    assert.equal(updated.policy.forgetting.half_life_days, 60);
    assert.ok(updated.recompute.projection_count > 300);
    assert.equal(runtime.store.getMasteryPolicy({ tenantId: runtime.tenantId }).config_version, 2);
    assert.throws(() => service.updateMasteryConfiguration({
      tenantId: runtime.tenantId,
      expectedVersion: 1,
      policy: updated.policy,
    }), (error) => error.code === "mastery_policy_version_conflict");
  } finally {
    runtime.store.close();
  }
});

test("forgetting decays old evidence toward the configured baseline", () => {
  const fresh = calculateMasteryProjection([{
    score: 1,
    weight: 1,
    sample_count: 1,
    apply_to_mastery: 1,
    evidence_class: "real",
    source_type: "deterministic_grader",
    occurred_at: NOW,
    metadata_json: "{}",
  }], DEFAULT_MASTERY_POLICY, { now: NOW });
  const old = calculateMasteryProjection([{
    score: 1,
    weight: 1,
    sample_count: 1,
    apply_to_mastery: 1,
    evidence_class: "real",
    source_type: "deterministic_grader",
    occurred_at: "2025-08-24T08:00:00.000Z",
    metadata_json: "{}",
  }], DEFAULT_MASTERY_POLICY, { now: NOW });
  assert.equal(fresh.mastery_probability, 1);
  assert.ok(old.mastery_probability < fresh.mastery_probability);
  assert.ok(old.confidence < fresh.confidence);
});
