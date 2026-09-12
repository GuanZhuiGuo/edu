import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createEducationDataHttpHandler } from "../education-data-http.js";
import { createEducationDataRuntime } from "../education-data-runtime.js";
import { createEducationDataService } from "../education-data-service.js";

function request(method, path, body) {
  const bytes = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(bytes);
  req.method = method;
  req.url = path;
  req.headers = { host: "127.0.0.1:3042", "content-type": "application/json" };
  return req;
}

function response() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(value = "") { this.body += value; },
    json() { return JSON.parse(this.body); }
  };
}

function fixture(identity = {}) {
  const runtime = createEducationDataRuntime({
    env: { EDUCATION_DATA_SEED_DEMO: "true" },
    storeOptions: {
      filename: ":memory:",
      clock: () => "2026-08-24T00:00:00.000Z",
    }
  });
  const service = createEducationDataService({
    store: runtime.store,
    verifyMasteryEvidence: () => identity.can_apply_verified_mastery === true
  });
  const handler = createEducationDataHttpHandler({
    service,
    authorizeRequest: () => true,
    resolveIdentity: () => ({
      tenant_id: runtime.tenantId,
      student_ids: ["user-lin-zhixia"],
      ...identity
    })
  });
  return { runtime, service, handler };
}

async function call(handler, method, path, body) {
  const req = request(method, path, body);
  const res = response();
  const handled = await handler(req, res, new URL(path, "http://127.0.0.1:3042"));
  return { handled, res, body: res.json() };
}

test("student list and profile are database-backed and access scoped", async () => {
  const { runtime, handler } = fixture();
  try {
    const list = await call(handler, "GET", "/api/education/students");
    assert.equal(list.res.statusCode, 200);
    assert.equal(list.body.data_source, "sqlite");
    assert.deepEqual(list.body.items.map((item) => item.student_id), ["user-lin-zhixia"]);
    const own = await call(handler, "GET", "/api/education/students/user-lin-zhixia");
    assert.equal(own.res.statusCode, 200);
    assert.ok(own.body.mastery_summary.assessed_count > 0);
    const other = await call(handler, "GET", "/api/education/students/user-chen-yu");
    assert.equal(other.res.statusCode, 403);
  } finally {
    runtime.store.close();
  }
});

test("teacher identity can list/switch students and read ontology graph with questions", async () => {
  const { runtime, handler } = fixture({ can_read_all_students: true });
  try {
    const students = await call(handler, "GET", "/api/education/students");
    assert.equal(students.body.items.length, 3);
    const graph = await call(handler, "GET", "/api/education/ontologies/junior-math-moe-2022/graph?include_questions=true&question_limit=5");
    assert.equal(graph.res.statusCode, 200);
    assert.equal(graph.body.ontology.ontology_id, "junior-math-moe-2022");
    assert.equal(graph.body.question_nodes.length, 5);
  } finally {
    runtime.store.close();
  }
});

test("public question API withholds solutions unless server identity grants reveal", async () => {
  const firstFixture = fixture({ can_read_all_students: true });
  try {
    const questions = await call(firstFixture.handler, "GET", "/api/education/questions?limit=1");
    assert.equal(questions.res.statusCode, 200);
    const question = questions.body.items[0];
    assert.equal(JSON.stringify(question).includes("solution_plan"), false);
    const denied = await call(firstFixture.handler, "GET", `/api/education/questions/${question.id}/solution`);
    assert.equal(denied.res.statusCode, 403);
  } finally {
    firstFixture.runtime.store.close();
  }

  const allowedFixture = fixture({ can_read_all_students: true, can_reveal_solutions: true });
  try {
    const questions = await call(allowedFixture.handler, "GET", "/api/education/questions?limit=1");
    const allowed = await call(allowedFixture.handler, "GET", `/api/education/questions/${questions.body.items[0].id}/solution`);
    assert.equal(allowed.res.statusCode, 200);
    assert.equal(allowed.body.storage_classification, "server_private");
  } finally {
    allowedFixture.runtime.store.close();
  }
});

test("mastery write ignores browser tenant and calculates projection only after server verification", async () => {
  const { runtime, handler } = fixture({ can_write_mastery: true, can_apply_verified_mastery: true });
  try {
    const result = await call(handler, "POST", "/api/education/students/user-lin-zhixia/mastery-evidence", {
      tenant_id: "attacker",
      evidence_id: "assessment:http:001",
      ontology_id: "junior-math-moe-2022",
      ontology_version: "math-standard-2022-m4@1.0",
      knowledge_point_id: "M4-NA-RAT-01",
      evidence_type: "direct_assessment",
      outcome: "answer_incorrect",
      score: 0,
      weight: 2,
      apply_to_mastery: true,
      source_type: "graded_question",
      source_ref: "attempt:http:001",
      occurred_at: "2026-08-19T12:00:00+08:00"
    });
    assert.equal(result.res.statusCode, 201);
    assert.equal(result.body.projection.mastery_probability, 0);
    assert.equal(result.body.projection.mastery_state, "weak");
    const snapshot = await call(handler, "GET", "/api/education/students/user-lin-zhixia/mastery?ontology_id=junior-math-moe-2022");
    assert.equal(snapshot.res.statusCode, 200);
    assert.equal(snapshot.body.student_id, "user-lin-zhixia");
  } finally {
    runtime.store.close();
  }
});

test("mastery-eligible evidence fails closed without a server-side verifier", async () => {
  const { runtime, handler } = fixture({ can_write_mastery: true });
  try {
    const result = await call(handler, "POST", "/api/education/students/user-lin-zhixia/mastery-evidence", {
      evidence_id: "assessment:unverified:001",
      ontology_id: "junior-math-moe-2022",
      ontology_version: "math-standard-2022-m4@1.0",
      knowledge_point_id: "M4-NA-RAT-01",
      score: 1,
      apply_to_mastery: true,
      source_type: "agent_proposal",
      source_ref: "proposal:unverified:001",
      occurred_at: "2026-08-19T12:00:00+08:00"
    });
    assert.equal(result.res.statusCode, 422);
    assert.equal(result.body.error, "mastery_evidence_not_verified");
  } finally {
    runtime.store.close();
  }
});

test("mastery history exposes policy, summary, and non-applied interaction proposals within student scope", async () => {
  const { runtime, service, handler } = fixture();
  try {
    service.recordMasteryProposal({
      tenantId: runtime.tenantId,
      studentId: "user-lin-zhixia",
      proposal: {
        proposal_id: "history-http-001",
        ontology_id: "junior-math-moe-2022",
        ontology_version: "math-standard-2022-m4@1.0",
        knowledge_point_id: "M4-NA-RAT-01",
        outcome: "learning_interaction",
        source_ref: "pi-request:history-http-001",
        occurred_at: "2026-08-24T08:00:00.000Z",
      },
    });

    const result = await call(
      handler,
      "GET",
      "/api/education/students/user-lin-zhixia/mastery-history?ontology_id=junior-math-moe-2022&ontology_version=math-standard-2022-m4%401.0&limit=20",
    );
    assert.equal(result.res.statusCode, 200);
    assert.equal(result.body.student_id, "user-lin-zhixia");
    assert.equal(result.body.policy.algorithm, "weighted_evidence_decay_v1");
    assert.ok(result.body.summary.proposal_evidence_count >= 1);
    const proposal = result.body.items.find((item) => item.evidence_id === "proposal:history-http-001");
    assert.ok(proposal);
    assert.equal(proposal.eligible_for_projection, false);
    assert.equal(proposal.included_in_current_projection, false);
    assert.equal(proposal.source_ref, "pi-request:history-http-001");

    const denied = await call(
      handler,
      "GET",
      "/api/education/students/user-chen-yu/mastery-history?ontology_id=junior-math-moe-2022",
    );
    assert.equal(denied.res.statusCode, 403);
  } finally {
    runtime.store.close();
  }
});
