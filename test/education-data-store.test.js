import assert from "node:assert/strict";
import test from "node:test";

import { createEducationDataRuntime } from "../education-data-runtime.js";
import { seedEducationDemoData } from "../education-data-seed.js";

function fixture() {
  return createEducationDataRuntime({
    env: { EDUCATION_DATA_SEED_DEMO: "true" },
    storeOptions: { filename: ":memory:" }
  });
}

test("SQLite migration and demo seed create real relational data idempotently", () => {
  const runtime = fixture();
  try {
    const summary = runtime.store.summary({ tenantId: runtime.tenantId });
    assert.equal(summary.storage, "sqlite");
    assert.equal(summary.counts.students, 3);
    assert.equal(summary.counts.knowledge_points, 140);
    assert.equal(summary.counts.ontology_entities, 163);
    assert.equal(summary.counts.ontology_relations, 519);
    assert.equal(summary.counts.questions, 420);
    assert.equal(summary.counts.private_solutions, 420);
    assert.ok(summary.counts.mastery_evidence > 300);
    assert.equal(summary.counts.mastery_evidence, summary.counts.mastery_projections);
    assert.equal(runtime.seed.demo_seed, true);
    assert.equal(runtime.seed.data_boundary, "rebuildable_demo_seed_not_real_student_measurement");
    const repeated = seedEducationDemoData({ store: runtime.store, tenantId: runtime.tenantId });
    assert.equal(repeated.ontology.idempotent, true);
    assert.equal(repeated.question_bank.idempotent, true);
    assert.equal(repeated.mastery_evidence.inserted, 0);
    assert.equal(runtime.store.summary({ tenantId: runtime.tenantId }).counts.questions, 420);
  } finally {
    runtime.store.close();
  }
});

test("student and mastery reads are tenant scoped and differ per student", () => {
  const runtime = fixture();
  try {
    const students = runtime.store.listStudents({ tenantId: runtime.tenantId });
    assert.deepEqual(students.map((item) => item.student_id).sort(), [
      "user-chen-yu", "user-lin-zhixia", "user-tang-guo"
    ]);
    const common = {
      tenantId: runtime.tenantId,
      ontologyId: "junior-math-moe-2022",
      ontologyVersion: "math-standard-2022-m4@1.0",
      limit: 1_000
    };
    const lin = runtime.store.listMastery({ ...common, studentId: "user-lin-zhixia" });
    const chen = runtime.store.listMastery({ ...common, studentId: "user-chen-yu" });
    assert.equal(lin.total, 140);
    assert.equal(chen.total, 140);
    const compared = lin.items.find((item) => item.mastery_probability != null
      && chen.items.find((candidate) => candidate.knowledge_point_id === item.knowledge_point_id)?.mastery_probability != null);
    const chenRecord = chen.items.find((item) => item.knowledge_point_id === compared.knowledge_point_id);
    assert.notEqual(compared.mastery_probability, chenRecord.mastery_probability);

    runtime.store.upsertTenant({ tenantId: "other-tenant", name: "Other" });
    runtime.store.upsertStudent({ tenantId: "other-tenant", student: { id: "user-lin-zhixia", name: "Same ID" } });
    assert.equal(runtime.store.listStudents({ tenantId: "other-tenant" }).length, 1);
    assert.equal(runtime.store.getStudent({ tenantId: runtime.tenantId, studentId: "user-lin-zhixia" }).name, "林知夏");
  } finally {
    runtime.store.close();
  }
});

test("public question reads never join private solutions", () => {
  const runtime = fixture();
  try {
    const result = runtime.store.listQuestions({
      tenantId: runtime.tenantId,
      ontologyId: "junior-math-moe-2022",
      knowledgePointId: "M4-NA-RAT-01",
      limit: 10
    });
    assert.equal(result.total, 3);
    const question = result.items[0];
    const serialized = JSON.stringify(question);
    assert.equal(serialized.includes("solution_plan"), false);
    assert.equal(serialized.includes("answer_key"), false);
    assert.equal(question.knowledge_point_mappings[0].knowledge_point_id, "M4-NA-RAT-01");
    const privateSolution = runtime.store.getQuestionSolution({
      tenantId: runtime.tenantId,
      questionId: question.id
    });
    assert.equal(privateSolution.storage_classification, "server_private");
    assert.ok(privateSolution.private_payload.solution_plan);
  } finally {
    runtime.store.close();
  }
});

test("mastery evidence is idempotent and deterministic projection is server calculated", () => {
  const runtime = fixture();
  try {
    const input = {
      tenantId: runtime.tenantId,
      studentId: "user-lin-zhixia",
      evidence: {
        evidence_id: "assessment:test:001",
        ontology_id: "junior-math-moe-2022",
        ontology_version: "math-standard-2022-m4@1.0",
        knowledge_point_id: "M4-NA-RAT-01",
        evidence_type: "direct_assessment",
        outcome: "answer_correct",
        score: 1,
        weight: 3,
        sample_count: 1,
        apply_to_mastery: true,
        source_type: "graded_question",
        source_ref: "attempt:test:001",
        occurred_at: "2026-08-19T10:00:00+08:00"
      }
    };
    const first = runtime.store.recordMasteryEvidence(input);
    const repeated = runtime.store.recordMasteryEvidence(input);
    assert.equal(first.idempotent, false);
    assert.equal(repeated.idempotent, true);
    assert.equal(first.projection.mastery_probability, 1);
    assert.equal(first.projection.mastery_state, "mastered");
    assert.equal(first.projection.state_version, 1);
    assert.equal(runtime.store.listLearningEvents({
      tenantId: runtime.tenantId, studentId: "user-lin-zhixia", limit: 1_000
    }).items.filter((item) => item.payload.evidence_source_ref === "attempt:test:001").length, 1);
  } finally {
    runtime.store.close();
  }
});

test("proposal history keeps same-request multi-knowledge events without changing mastery", () => {
  const runtime = fixture();
  try {
    const studentId = "student-proposal-history";
    runtime.store.upsertStudent({
      tenantId: runtime.tenantId,
      student: { student_id: studentId, name: "交互记录测试学生", is_demo: false },
    });
    const knowledgeSnapshot = runtime.store.listKnowledgePoints({
      tenantId: runtime.tenantId,
      ontologyId: "junior-math-moe-2022",
      ontologyVersion: "math-standard-2022-m4@1.0",
      limit: 2,
    });
    const knowledgePoints = knowledgeSnapshot.items;
    assert.equal(knowledgePoints.length, 2);

    for (const [index, knowledgePoint] of knowledgePoints.entries()) {
      const evidenceId = `proposal:shared-request:${index + 1}`;
      const result = runtime.store.recordMasteryEvidence({
        tenantId: runtime.tenantId,
        studentId,
        evidence: {
          evidence_id: evidenceId,
          ontology_id: knowledgeSnapshot.ontology_id,
          ontology_version: knowledgeSnapshot.ontology_version,
          knowledge_point_id: knowledgePoint.id,
          evidence_type: "agent_mastery_proposal",
          outcome: "learning_interaction",
          score: null,
          weight: 0,
          sample_count: 1,
          apply_to_mastery: false,
          evidence_class: "proposal",
          source_type: "agent_proposal",
          source_ref: "pi-request:shared-learning-turn",
          occurred_at: "2026-08-24T08:00:00.000Z",
          metadata: { title: "普通学习交互" },
        },
      });
      assert.equal(result.projection.mastery_state, "unassessed");
      assert.equal(result.projection.mastery_probability, null);
    }

    const history = runtime.store.listMasteryEvidence({
      tenantId: runtime.tenantId,
      studentId,
      ontologyId: knowledgeSnapshot.ontology_id,
      ontologyVersion: knowledgeSnapshot.ontology_version,
      limit: 20,
    });
    assert.equal(history.total, 2);
    assert.deepEqual(
      history.items.map((item) => item.source_ref),
      ["pi-request:shared-learning-turn", "pi-request:shared-learning-turn"],
    );
    assert.ok(history.items.every((item) => item.evidence_class === "proposal"));
    assert.ok(history.items.every((item) => item.apply_to_mastery === false));

    const events = runtime.store.listLearningEvents({
      tenantId: runtime.tenantId,
      studentId,
      limit: 20,
    });
    assert.equal(events.total, 2);
    assert.deepEqual(
      new Set(events.items.map((item) => item.event_id)),
      new Set([
        "event:proposal:shared-request:1",
        "event:proposal:shared-request:2",
      ]),
    );
  } finally {
    runtime.store.close();
  }
});

test("ontology graph can include database-backed question links", () => {
  const runtime = fixture();
  try {
    const graph = runtime.store.getOntologyGraph({
      tenantId: runtime.tenantId,
      ontologyId: "junior-math-moe-2022",
      includeQuestions: true,
      questionLimit: 20
    });
    assert.equal(graph.ontology.knowledge_point_count, 140);
    assert.equal(graph.ontology.relation_count, graph.relations.length);
    assert.equal(graph.entities.filter((item) => item.entity_kind === "knowledge_point").length, 140);
    assert.equal(graph.relations.length, 519);
    const semanticKeys = graph.relations.map((edge) => `${edge.source}\u0000${edge.target}\u0000${edge.type}`);
    assert.equal(new Set(semanticKeys).size, semanticKeys.length);
    assert.equal(graph.question_nodes.length, 20);
    assert.ok(graph.question_relations.length >= 20);
  } finally {
    runtime.store.close();
  }
});
