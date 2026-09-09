import "dotenv/config";
import { performance } from "node:perf_hooks";
import { createEducationDataStore } from "../education-data-store.js";
import { createEducationDataService } from "../education-data-service.js";
import { createEducationQdrantStore } from "../education-qdrant-store.js";
import {
  createNeo4jEducationGraphStore, neo4jEducationGraphConfigFromEnv,
  neo4jEducationGraphConfigSummary,
} from "../neo4j-education-graph-store.js";
import { createEducationKnowledgeConnectionMonitor } from "../education-knowledge-connections.js";
import { createLearningRetrievalAdapter } from "../learning-course-scope.js";

// Read-only diagnostic: never runs migrations, seeds, embeddings or publication.
const graphConfig = neo4jEducationGraphConfigFromEnv();
const graphStore = neo4jEducationGraphConfigSummary(graphConfig).configured
  ? createNeo4jEducationGraphStore(graphConfig) : null;
const vectorStore = createEducationQdrantStore();
const connections = createEducationKnowledgeConnectionMonitor({ graphStore, vectorStore });
const store = createEducationDataStore({ readonly: true });
let remoteCalls = 0;
const tenantId = process.env.EDUCATION_DATA_TENANT_ID || "local-demo";
const principalId = process.env.EDUCATION_KNOWLEDGE_PRINCIPAL_ID || "local-reviewer";

try {
  const probeAt = performance.now();
  const status = await connections.getStatus();
  const report = {
    checked_at: new Date().toISOString(),
    probe_ms: rounded(performance.now() - probeAt),
    connections: status,
    expected_collection: vectorStore.configSummary().collection,
    retrieval: null,
    model_calls: 0,
  };
  if (!status.retrieval.remote_allowed) {
    const adapter = createLearningRetrievalAdapter({
      connectionMonitor: connections,
      dataService: createEducationDataService({ store }), tenantId,
      hybridRetrievalService: { search() { remoteCalls++; throw new Error("Remote work must be skipped."); } },
    });
    const started = performance.now();
    const receipt = await adapter.search({
      query: "二次函数怎么求解", tenantId, principalId, principalIds: [principalId],
      courseId: "junior-math-moe-2022", limit: 8,
    });
    report.retrieval = {
      query: "二次函数怎么求解", elapsed_ms: rounded(performance.now() - started),
      status: receipt.status, mode: receipt.retrieval_mode,
      degraded: receipt.retrieval_degraded, reason: receipt.fallback?.reason_code || null,
      hit_count: receipt.hits.length, scope_id: receipt.scope_id,
      remote_calls: remoteCalls,
    };
  } else {
    report.retrieval = { skipped: "remote_is_healthy_no_model_calls_in_readonly_check" };
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  connections.close();
  store.close();
  await graphStore?.close();
}

function rounded(value) { return Math.round(value * 100) / 100; }
