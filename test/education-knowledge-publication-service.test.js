import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicationManifest,
  createEducationKnowledgePublicationService,
} from "../education-knowledge-publication-service.js";

function plan() {
  const metadata = {
    tenant_id: "tenant-a", course_id: "course-a", corpus_id: "course-a",
    release_id: "release-a", record_id: "kp-1", revision_id: "kp-r1",
    document_id: "doc-1", document_revision_id: "doc-r1", publish_state: "staging",
    visibility: "tenant", entity_type: "knowledge_unit", namespace: "organization_course",
    index_build_id: "release-a", embedding_model: "embed-test",
  };
  return {
    publication_id: "publication-a", tenant_id: "tenant-a", namespace: "organization_course",
    course_id: "course-a", corpus_id: "course-a", release_id: "release-a", visibility: "tenant",
    document: { id: "doc-1", title: "课标", document_type: "curriculum_standard", language: "zh-CN" },
    revision: { id: "doc-r1", document_id: "doc-1", review_status: "verified" },
    vector_records: [{
      record_id: "kp-1", record_type: "knowledge_unit", title: "一次函数",
      content: "一次函数 y=2x+1", content_hash: "a".repeat(64), lexical_terms: ["function"],
      source_anchor: { document_id: "doc-1", document_revision_id: "doc-r1", page_index: 1, block_ids: ["b1"] },
      payload: metadata,
    }],
    graph: {
      chunks: [],
      knowledge_units: [{ id: "kp-1", revision_id: "kp-r1", knowledge_type: "knowledge_point", title: "一次函数", statement: "定义", source_anchor: null }],
      questions: [], relations: [], question_links: [],
    },
    statistics: { vector_record_count: 1, chunk_count: 0, knowledge_unit_count: 1, question_count: 0, relation_count: 0, question_link_count: 0 },
  };
}

function fixtures({ active = null, graphCounts, failActivate = false } = {}) {
  const calls = [];
  const importService = { get: async () => ({ document_ir: {}, candidate_pack: {} }) };
  const modelClient = {
    configSummary: () => ({ embeddingModel: "embed-test" }),
    embedMultimodal: async () => ({ embedding: [0.1, 0.2], sparseEmbedding: null, model: "embed-test" }),
  };
  const vectorStore = {
    ensureCollection: async (input) => { calls.push(["ensure", input]); return { ok: true }; },
    upsertPoints: async (points) => { calls.push(["upsert", points]); return { count: points.length }; },
    setPublishState: async (input) => { calls.push(["publish", input]); return { ok: true }; },
  };
  const graphStore = {
    initializeSchema: async () => calls.push(["schema"]),
    resolveActiveRelease: async () => active,
    prepareRelease: async (input) => calls.push(["prepare", input]),
    publishGraph: async (input) => {
      calls.push(["graph", input]);
      return { counts: graphCounts || { chunks: 0, knowledge_units: 1, questions: 0, relations: 0, question_links: 0 } };
    },
    activateRelease: async (input) => {
      calls.push(["activate", input]);
      if (failActivate) throw new Error("activation unavailable");
    },
    setReleaseStatus: async (input) => calls.push(["status", input]),
  };
  return { calls, importService, modelClient, vectorStore, graphStore };
}

test("publication stages vectors and graph before atomic release activation", async () => {
  const deps = fixtures();
  const service = createEducationKnowledgePublicationService({
    ...deps,
    compilePlan: () => plan(),
    now: () => new Date("2026-08-19T00:00:00.000Z"),
  });
  const receipt = await service.publishImport("job-1", {
    tenantId: "tenant-a", courseId: "course-a", principalId: "reviewer-a",
  });
  assert.equal(receipt.status, "active");
  assert.deepEqual(receipt.sparse_encoder_kinds, ["local_lexical"]);
  assert.deepEqual(deps.calls.map(([name]) => name), [
    "schema", "prepare", "ensure", "upsert", "graph", "publish", "activate",
  ]);
  const point = deps.calls.find(([name]) => name === "upsert")[1][0];
  assert.equal(point.payload.publish_state, "staging");
  assert.equal(point.payload.sparse_encoder_version, "lexical_sparse_v1");
  assert.equal(deps.calls.find(([name]) => name === "publish")[1].publishState, "published");
});

test("publication is idempotent when the same release is already active", async () => {
  const deps = fixtures({ active: { release_id: "release-a", status: "active" } });
  const service = createEducationKnowledgePublicationService({ ...deps, compilePlan: () => plan() });
  const receipt = await service.publishImport("job-1", {
    tenantId: "tenant-a", courseId: "course-a", principalId: "reviewer-a",
  });
  assert.equal(receipt.idempotent, true);
  assert.deepEqual(deps.calls, []);
});

test("activation failure leaves release unreachable and marks it failed", async () => {
  const deps = fixtures({ failActivate: true });
  const service = createEducationKnowledgePublicationService({ ...deps, compilePlan: () => plan() });
  await assert.rejects(() => service.publishImport("job-1", {
    tenantId: "tenant-a", courseId: "course-a", principalId: "reviewer-a",
  }), (error) => error.code === "education_knowledge_publication_failed");
  const failure = deps.calls.find(([name]) => name === "status")[1];
  assert.equal(failure.status, "failed");
  assert.equal(deps.calls.filter(([name]) => name === "activate").length, 1);
});

test("manifest digest is stable", () => {
  assert.deepEqual(buildPublicationManifest(plan()), buildPublicationManifest(plan()));
});
