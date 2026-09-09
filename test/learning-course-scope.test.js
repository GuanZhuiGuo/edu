import assert from "node:assert/strict";
import test from "node:test";

import { createLearningRetrievalAdapter } from "../learning-course-scope.js";
import { createEducationKnowledgeConnectionMonitor } from "../education-knowledge-connections.js";

function dataService() {
  return {
    listOntologies: () => [{ ontology_id: "junior-math-moe-2022" }],
    getOntologyGraph: () => ({
      entities: [{
        id: "M4-GE-SIM-05",
        entity_kind: "knowledge_point",
        name: "相似三角形面积比",
        description: "相似三角形面积比等于相似比的平方。",
        aliases: [],
        properties: {},
      }],
      relations: [],
    }),
  };
}

const searchInput = {
  query: "相似三角形面积比",
  tenantId: "local-demo",
  principalId: "local-reviewer",
  principalIds: ["local-reviewer"],
  courseId: "junior-math-moe-2022",
  limit: 4,
};

test("marks reviewed local ontology as a degraded fallback when hybrid retrieval is unavailable", async () => {
  const adapter = createLearningRetrievalAdapter({
    dataService: dataService(),
    tenantId: "local-demo",
    hybridRetrievalService: {
      search: async () => ({
        status: "no_match",
        code: "active_release_not_found",
        hits: [],
      }),
    },
  });

  const receipt = await adapter.search(searchInput);

  assert.equal(receipt.status, "retrieved");
  assert.equal(receipt.retrieval_mode, "reviewed_local_ontology_fallback");
  assert.equal(receipt.retrieval_degraded, true);
  assert.deepEqual(receipt.fallback, {
    from: "hybrid_rrf",
    reason_code: "active_release_not_found",
  });
});

test("keeps reviewed local ontology as the primary mode when no hybrid backend is configured", async () => {
  const adapter = createLearningRetrievalAdapter({
    dataService: dataService(),
    tenantId: "local-demo",
  });

  const receipt = await adapter.search(searchInput);

  assert.equal(receipt.status, "retrieved");
  assert.equal(receipt.retrieval_mode, "reviewed_local_ontology");
  assert.equal(receipt.retrieval_degraded, false);
  assert.equal(receipt.fallback, undefined);
});

test("keeps an authoritative local no-match when the optional vector backend fails", async () => {
  const adapter = createLearningRetrievalAdapter({
    dataService: dataService(),
    tenantId: "local-demo",
    hybridRetrievalService: {
      search: async () => ({
        status: "tool_error",
        code: "retrieval_backend_failed",
        hits: [],
      }),
    },
  });

  const receipt = await adapter.search({
    ...searchInput,
    query: "微积分",
  });

  assert.equal(receipt.status, "no_match");
  assert.equal(receipt.code, "reviewed_local_knowledge_no_match");
  assert.equal(receipt.retrieval_mode, "reviewed_local_ontology_fallback");
  assert.equal(receipt.retrieval_degraded, true);
  assert.deepEqual(receipt.fallback, {
    from: "hybrid_rrf",
    reason_code: "retrieval_backend_failed",
  });
});

test("does not disguise a reviewed local ontology read failure as no-match", async () => {
  const adapter = createLearningRetrievalAdapter({
    dataService: {
      listOntologies: () => [{ ontology_id: "junior-math-moe-2022" }],
      getOntologyGraph: () => {
        const error = new Error("sqlite unavailable");
        error.code = "local_ontology_unavailable";
        throw error;
      },
    },
    tenantId: "local-demo",
    hybridRetrievalService: {
      search: async () => ({
        status: "tool_error",
        code: "retrieval_backend_failed",
        hits: [],
      }),
    },
  });

  await assert.rejects(
    () => adapter.search({ ...searchInput, query: "微积分" }),
    (error) => error?.code === "local_ontology_unavailable",
  );
});

test("an open remote circuit skips remote work while retaining local tenant and loaded-course boundaries", async () => {
  const monitor = createEducationKnowledgeConnectionMonitor({
    graphStore: { configSummary: () => ({ configured: true }), health: async () => ({ ok: false }) },
    vectorStore: { configSummary: () => ({ configured: true }), health: async () => ({ ok: true }) },
  });
  await monitor.getStatus();
  let remoteCalls = 0;
  let localScope;
  const local = dataService();
  const adapter = createLearningRetrievalAdapter({
    dataService: { ...local, getOntologyGraph: (scope) => { localScope = scope; return local.getOntologyGraph(); } },
    tenantId: "local-demo",
    connectionMonitor: monitor,
    hybridRetrievalService: { search: async () => { remoteCalls++; throw new Error("must skip remote"); } },
  });
  const receipt = await adapter.search({ ...searchInput, courseId: "unloaded-course" });
  assert.equal(receipt.status, "retrieved");
  assert.equal(receipt.fallback.reason_code, "remote_unavailable");
  assert.equal(remoteCalls, 0);
  assert.equal(localScope.tenantId, "local-demo");
  assert.equal(localScope.ontologyId, "junior-math-moe-2022");
  monitor.close();
});

test("cancelled requests cannot continue as local retrieval after remote cancellation", async () => {
  const controller = new AbortController();
  let localReads = 0;
  const adapter = createLearningRetrievalAdapter({
    dataService: { ...dataService(), getOntologyGraph: () => { localReads++; return {}; } },
    tenantId: "local-demo",
    hybridRetrievalService: { search: async () => { controller.abort(); return { status: "tool_error" }; } },
  });
  await assert.rejects(adapter.search({ ...searchInput, signal: controller.signal }), { name: "AbortError" });
  assert.equal(localReads, 0);
});
