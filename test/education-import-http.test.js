import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createEducationImportHttpHandler } from "../education-import-http.js";

function createFakeService() {
  const calls = [];
  const job = {
    id: "import-12345678",
    status: "queued",
    phase: "queued",
    source: { file_name: "paper.pdf" },
  };
  return {
    calls,
    configSummary() {
      return {
        model_configured: true,
        semantic_model_configured: true,
        supported_mime_types: ["application/pdf"],
        limits: { maxFileBytes: 1024 * 1024, maxPages: 30 },
      };
    },
    async create(input) {
      calls.push(["create", input]);
      return job;
    },
    async list(input) {
      calls.push(["list", input]);
      return { total: 1, jobs: [job] };
    },
    async get(id) {
      calls.push(["get", id]);
      return id === job.id ? { ...job, status: "succeeded" } : null;
    },
    async review(id, input) {
      calls.push(["review", id, input]);
      return { ...job, id, status: "succeeded", review: { status: input.status } };
    },
    async resolveSemanticReview(id, input) {
      calls.push(["resolveSemanticReview", id, input]);
      return {
        ...job,
        id,
        status: "succeeded",
        result: { semantic: { status: "succeeded", review_queue_count: 0 } },
      };
    },
  };
}

async function withHttpServer(handler, run) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (!(await handler(req, res, url))) {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("education import HTTP accepts one bounded multipart file and preserves UTF-8 filenames", async () => {
  const service = createFakeService();
  const handler = createEducationImportHttpHandler({
    service,
    authorizeRequest: () => true,
    resolveIdentity: () => ({ tenant_id: "trusted-tenant", learner_id: "trusted-student" }),
  });
  await withHttpServer(handler, async (baseUrl) => {
    const form = new FormData();
    form.set(
      "file",
      new Blob([Buffer.from("%PDF-1.4\n")], { type: "application/pdf" }),
      "政法类课程大纲.pdf",
    );
    form.set("document_type", "student_exam");
    form.set("subject", "初中数学");
    form.set("tenant_id", "spoofed-tenant");
    form.set("learner_id", "spoofed-student");
    const response = await fetch(`${baseUrl}/api/education/imports`, {
      method: "POST",
      body: form,
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).id, "import-12345678");
  });
  const input = service.calls.find(([name]) => name === "create")[1];
  assert.equal(input.file_name, "政法类课程大纲.pdf");
  assert.equal(input.document_type, "student_exam");
  assert.equal(input.subject, "初中数学");
  assert.equal(input.tenant_id, "trusted-tenant");
  assert.equal(input.learner_id, "trusted-student");
  assert.ok(Buffer.isBuffer(input.buffer));
});

test("education import HTTP exposes safe config, ontology schema, jobs and reviews", async () => {
  const service = createFakeService();
  const handler = createEducationImportHttpHandler({ service, authorizeRequest: () => true });
  await withHttpServer(handler, async (baseUrl) => {
    const config = await fetch(`${baseUrl}/api/education/imports/config`);
    assert.equal(config.status, 200);
    const configBody = await config.json();
    assert.equal(configBody.configured, true);
    assert.equal("api_key" in configBody, false);

    const schema = await fetch(`${baseUrl}/api/education/imports/ontology-schema`);
    assert.equal(schema.status, 200);
    const schemaBody = await schema.json();
    assert.equal(schemaBody.schema_version, "education-ontology-schema@1.0");
    assert.ok(schemaBody.entity_types.includes("knowledge_point"));
    assert.ok(schemaBody.relation_types.includes("prerequisite_of"));
    assert.ok(schemaBody.question_knowledge_relations.includes("assesses"));
    assert.deepEqual(schemaBody.publication_gate, [
      "document_ir_valid",
      "semantic_compilation_complete",
      "semantic_review_queue_empty",
      "candidate_pack_verified",
    ]);
    assert.equal(JSON.stringify(schemaBody).includes("api_key"), false);

    const list = await fetch(`${baseUrl}/api/education/imports?limit=12`);
    assert.equal((await list.json()).total, 1);

    const job = await fetch(`${baseUrl}/api/education/imports/import-12345678`);
    assert.equal((await job.json()).status, "succeeded");

    const review = await fetch(`${baseUrl}/api/education/imports/import-12345678/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "verified", target_type: "pack" }),
    });
    assert.equal(review.status, 200);
    assert.equal((await review.json()).review.status, "verified");

    const semanticReview = await fetch(`${baseUrl}/api/education/imports/import-12345678/semantic-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "已确认被拦截候选保持不发布" }),
    });
    assert.equal(semanticReview.status, 200);
    assert.equal((await semanticReview.json()).result.semantic.review_queue_count, 0);
  });
  const reviewInput = service.calls.find(([name]) => name === "review")[2];
  assert.equal(reviewInput.reviewer_id, "local-loopback-reviewer");
  const semanticReviewInput = service.calls.find(([name]) => name === "resolveSemanticReview")[2];
  assert.equal(semanticReviewInput.reviewer_id, "local-loopback-reviewer");
  assert.equal(semanticReviewInput.note, "已确认被拦截候选保持不发布");
});

test("education import HTTP rejects unauthorized callers", async () => {
  const handler = createEducationImportHttpHandler({
    service: createFakeService(),
    authorizeRequest: () => false,
  });
  await withHttpServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/education/imports`);
    assert.equal(response.status, 403);
  });
});

test("education import HTTP exposes human question review and publication routes", async () => {
  const calls = [];
  const questionReviewService = {
    async getReview(id, input) {
      calls.push(["getReview", id, input]);
      return { job_id: id, revision: 0, counts: { pending: 1 } };
    },
    async reviewBatch(id, input) {
      calls.push(["reviewBatch", id, input]);
      return { job_id: id, revision: 1, counts: { accept: 1 } };
    },
    async publish(id, input) {
      calls.push(["publish", id, input]);
      return { job_id: id, idempotent: false, question_count: 1 };
    },
  };
  const handler = createEducationImportHttpHandler({
    service: createFakeService(),
    questionReviewService,
    authorizeRequest: () => true,
    resolveIdentity: () => ({
      tenant_id: "tenant-1",
      reviewer_id: "teacher-1",
    }),
  });
  await withHttpServer(handler, async (baseUrl) => {
    const review = await fetch(
      `${baseUrl}/api/education/imports/import-12345678/questions/review?ontology_id=ontology-1`,
    );
    assert.equal(review.status, 200);
    assert.equal((await review.json()).counts.pending, 1);

    const decision = await fetch(
      `${baseUrl}/api/education/imports/import-12345678/questions/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_revision: 0,
          decisions: [{ candidate_id: "question-1", status: "reject" }],
        }),
      },
    );
    assert.equal(decision.status, 200);
    assert.equal((await decision.json()).counts.accept, 1);

    const publication = await fetch(
      `${baseUrl}/api/education/imports/import-12345678/questions/publish`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_revision: 1 }),
      },
    );
    assert.equal(publication.status, 200);
    assert.equal((await publication.json()).question_count, 1);
  });

  assert.deepEqual(calls[0], ["getReview", "import-12345678", {
    tenant_id: "tenant-1",
    ontology_id: "ontology-1",
    ontology_version: undefined,
  }]);
  assert.equal(calls[1][2].reviewer_id, "teacher-1");
  assert.equal(calls[1][2].tenant_id, "tenant-1");
  assert.equal(calls[2][2].reviewer_id, "teacher-1");
});
