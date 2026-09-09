import assert from "node:assert/strict";
import test from "node:test";

import { createEducationHybridRetrievalService } from "../education-hybrid-retrieval-service.js";
import { createEducationKnowledgeConnectionMonitor } from "../education-knowledge-connections.js";

function payload(overrides = {}) {
  return {
    tenant_id: "tenant-a", course_id: "course-a", corpus_id: "course-a",
    release_id: "release-a", publish_state: "published", namespace: "organization_course",
    visibility: "tenant", record_id: "kp-1", entity_type: "knowledge_unit",
    document_id: "doc-1", document_revision_id: "doc-r1", title: "一次函数",
    content: "一次函数定义", source_anchor: { page_index: 1 }, ...overrides,
  };
}

function service({ point = { id: "p1", score: 0.9, payload: payload() }, sparse = null } = {}) {
  const calls = [];
  const modelClient = { embedMultimodal: async () => ({ embedding: [0.1, 0.2], sparseEmbedding: sparse, model: "embed-v1" }) };
  const vectorStore = { hybridSearch: async (input) => { calls.push(["search", input]); return { points: point ? [point] : [] }; } };
  const graphStore = {
    resolveActiveRelease: async (input) => { calls.push(["active", input]); return { release_id: "release-a", status: "active" }; },
    expand: async (input) => { calls.push(["expand", input]); return { nodes: [{ id: "kp-1" }], relationships: [] }; },
  };
  return { calls, instance: createEducationHybridRetrievalService({ modelClient, vectorStore, graphStore }) };
}

const input = {
  query: "什么是一次函数", tenantId: "tenant-a", principalId: "student-a",
  courseId: "course-a", corpusId: "course-a", namespaceId: "organization_course",
};

test("retrieval resolves active release then runs release-scoped hybrid RRF and one-hop graph", async () => {
  const fixture = service();
  const receipt = await fixture.instance.search(input);
  assert.equal(receipt.status, "retrieved");
  assert.equal(receipt.retrieval_mode, "hybrid_rrf");
  assert.equal(receipt.sparse_encoder_kind, "local_lexical");
  const query = fixture.calls.find(([name]) => name === "search")[1];
  assert.deepEqual(query.filter.releaseIds, ["release-a"]);
  assert.deepEqual(query.filter.publishStates, ["published"]);
  const expand = fixture.calls.find(([name]) => name === "expand")[1];
  assert.equal(expand.releaseId, "release-a");
  assert.equal(expand.hops, 1);
  assert.deepEqual(expand.seedIds, ["kp-1"]);
});

test("retrieval fails closed when backend returns a cross-tenant point", async () => {
  const fixture = service({ point: { id: "bad", score: 1, payload: payload({ tenant_id: "tenant-b" }) } });
  const receipt = await fixture.instance.search(input);
  assert.equal(receipt.status, "tool_error");
  assert.equal(receipt.code, "retrieval_scope_violation");
  assert.ok(!fixture.calls.some(([name]) => name === "expand"));
});

test("retrieval returns no_match without graph expansion", async () => {
  const fixture = service({ point: null, sparse: { indices: [2], values: [1] } });
  const receipt = await fixture.instance.search(input);
  assert.equal(receipt.status, "no_match");
  assert.equal(receipt.sparse_encoder_kind, "provider_sparse");
  assert.ok(!fixture.calls.some(([name]) => name === "expand"));
});

test("retrieval receipts do not expose backend error text", async () => {
  const instance = createEducationHybridRetrievalService({
    modelClient: { embedMultimodal: async () => { throw new Error("secret provider body"); } },
    vectorStore: { hybridSearch: async () => ({ points: [] }) },
    graphStore: {
      resolveActiveRelease: async () => ({ release_id: "release-a", status: "active" }),
      expand: async () => ({ nodes: [], relationships: [] }),
    },
  });
  const receipt = await instance.search(input);
  assert.equal(receipt.status, "tool_error");
  assert.ok(!JSON.stringify(receipt).includes("secret provider body"));
});

function monitoredFixture(overrides = {}) {
  const calls = { active: 0, embed: 0, vector: 0, expand: 0 };
  const graphStore = {
    configSummary: () => ({ configured: true }), health: async () => ({ ok: true }),
    resolveActiveRelease: async () => { calls.active++; return { release_id: "release-a", status: "active" }; },
    expand: async () => { calls.expand++; return { nodes: [], relationships: [] }; },
    ...overrides.graph,
  };
  const vectorStore = {
    configSummary: () => ({ configured: true }), health: async () => ({ ok: true }),
    hybridSearch: async () => { calls.vector++; return { points: [] }; },
    ...overrides.vector,
  };
  const modelClient = {
    embedMultimodal: async () => { calls.embed++; return { embedding: [0.1, 0.2] }; },
    ...overrides.model,
  };
  const monitor = createEducationKnowledgeConnectionMonitor({ graphStore, vectorStore, ...overrides.monitor });
  const instance = createEducationHybridRetrievalService({
    modelClient, graphStore, vectorStore, connectionMonitor: monitor,
    requestTimeoutMs: overrides.timeoutMs ?? 50,
  });
  return { instance, monitor, calls };
}

test("failed dependency health skips every remote retrieval stage including embedding", async () => {
  const fixture = monitoredFixture({ graph: { health: async () => ({ ok: false }) } });
  const receipt = await fixture.instance.search(input);
  assert.equal(receipt.code, "remote_unavailable");
  assert.equal(receipt.retrieval_degraded, true);
  assert.deepEqual(fixture.calls, { active: 0, embed: 0, vector: 0, expand: 0 });
  fixture.monitor.close();
});

test("a request deadline cancels Neo4j work and opens the circuit for the next request", async () => {
  let started = 0;
  let cancelled = false;
  const fixture = monitoredFixture({
    timeoutMs: 25,
    graph: { resolveActiveRelease: ({ signal }) => new Promise((_, reject) => {
      started++;
      signal.addEventListener("abort", () => { cancelled = true; reject(signal.reason); }, { once: true });
    }) },
  });
  assert.equal((await fixture.instance.search(input)).code, "retrieval_request_timeout");
  assert.equal(cancelled, true);
  assert.equal(fixture.monitor.snapshot().components.neo4j.status, "unavailable");
  assert.equal((await fixture.instance.search(input)).code, "remote_unavailable");
  assert.equal(started, 1);
  fixture.monitor.close();
});

test("Qdrant transport failures open only its circuit and recovery re-enables retrieval", async () => {
  let time = 100_000;
  let fail = true;
  const fixture = monitoredFixture({
    monitor: { now: () => time },
    vector: { hybridSearch: async () => {
      if (fail) throw new Error("private transport details");
      return { points: [] };
    } },
  });
  assert.equal((await fixture.instance.search(input)).code, "retrieval_backend_failed");
  assert.equal(fixture.monitor.snapshot().components.qdrant.status, "unavailable");
  assert.equal(fixture.monitor.snapshot().components.neo4j.status, "healthy");
  fail = false;
  time += 31_000;
  await fixture.monitor.refresh();
  assert.equal((await fixture.instance.search(input)).status, "no_match");
  assert.equal(fixture.monitor.snapshot().ok, true);
  fixture.monitor.close();
});

test("no matching points or no active release do not mark healthy stores as failed", async () => {
  for (const graph of [{}, { resolveActiveRelease: async () => null }]) {
    const fixture = monitoredFixture({ graph });
    assert.equal((await fixture.instance.search(input)).status, "no_match");
    assert.equal(fixture.monitor.snapshot().ok, true);
    assert.equal(fixture.monitor.snapshot().retrieval.remote_allowed, true);
    fixture.monitor.close();
  }
});

test("embedding provider errors cannot mark the database connections as failed", async () => {
  const fixture = monitoredFixture({ model: { embedMultimodal: async () => { throw new Error("model error"); } } });
  assert.equal((await fixture.instance.search(input)).status, "tool_error");
  assert.equal(fixture.monitor.snapshot().ok, true);
  fixture.monitor.close();
});

test("user cancellation aborts in-flight vector search without opening the circuit", async () => {
  const controller = new AbortController();
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  let operationSignal;
  const fixture = monitoredFixture({
    timeoutMs: 500,
    vector: { hybridSearch: ({ signal }) => new Promise((_, reject) => {
      operationSignal = signal;
      started();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }) },
  });
  const request = fixture.instance.search({ ...input, signal: controller.signal });
  await pending;
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(operationSignal.aborted, true);
  assert.equal(fixture.monitor.snapshot().ok, true);
  fixture.monitor.close();
});
