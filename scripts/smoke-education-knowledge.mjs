import "dotenv/config";

import { createEducationHybridRetrievalService } from "../education-hybrid-retrieval-service.js";
import { encodeEducationLexicalSparse } from "../education-lexical-sparse.js";
import {
  createNeo4jEducationGraphStoreFromEnv,
} from "../neo4j-education-graph-store.js";
import { createEducationQdrantStore } from "../education-qdrant-store.js";

const collection = "education_knowledge_smoke_v1";
const scope = Object.freeze({
  tenantId: "smoke-tenant",
  namespaceId: "organization_course",
  principalId: "smoke-reviewer",
  readPrincipals: ["smoke-reviewer"],
  writePrincipals: ["smoke-reviewer"],
  visibility: "tenant",
  corpusId: "smoke-course",
  releaseId: "smoke-release-v1",
});
const dense = Object.freeze([0.9, 0.1, 0.2, 0.3]);
const content = "一次函数图像由斜率和截距决定";
const sparse = encodeEducationLexicalSparse(content);

const vectorStore = createEducationQdrantStore({
  env: { ...process.env, QDRANT_EDUCATION_COLLECTION: collection },
});
const graphStore = createNeo4jEducationGraphStoreFromEnv();
const modelClient = Object.freeze({
  embedMultimodal: async () => ({
    embedding: [...dense],
    sparseEmbedding: null,
    model: "smoke-deterministic-v1",
  }),
});

try {
  await vectorStore.ensureCollection({ denseSize: dense.length });
  const payload = {
    tenant_id: scope.tenantId,
    course_id: scope.corpusId,
    corpus_id: scope.corpusId,
    release_id: scope.releaseId,
    record_id: "smoke-kp-linear",
    revision_id: "smoke-revision-v1",
    document_id: "smoke-document",
    document_revision_id: "smoke-document-revision-v1",
    publish_state: "staging",
    visibility: "tenant",
    acl_principal_ids: scope.readPrincipals,
    entity_type: "knowledge_unit",
    namespace: scope.namespaceId,
    index_build_id: scope.releaseId,
    embedding_model: "smoke-deterministic-v1",
    sparse_encoder_kind: "local_lexical",
    sparse_encoder_version: sparse.version,
    content_hash: "a".repeat(64),
    title: "一次函数",
    content,
  };
  const vectorResult = await vectorStore.upsertPoints([{
    dense: [...dense],
    sparse,
    payload,
  }]);
  await vectorStore.setPublishState({
    tenantId: scope.tenantId,
    corpusId: scope.corpusId,
    releaseId: scope.releaseId,
    publishState: "published",
  });

  await graphStore.initializeSchema();
  const existing = await graphStore.resolveActiveRelease(scope);
  let graphCounts = null;
  if (existing?.release_id !== scope.releaseId || existing.status !== "active") {
    await graphStore.prepareRelease(scope);
    const graphResult = await graphStore.publishGraph({
      ...scope,
      document: {
        id: "smoke-document",
        title: "冒烟课标",
        document_type: "curriculum_standard",
        language: "zh-CN",
        subject: "数学",
        grade_band: "初中",
        source_sha256: "b".repeat(64),
      },
      revision: {
        id: "smoke-document-revision-v1",
        document_id: "smoke-document",
        review_status: "verified",
        confidence: 1,
      },
      chunks: [{
        id: "smoke-chunk-linear",
        page_index: 0,
        reading_order: 0,
        block_type: "paragraph",
        text: content,
        layer: "printed",
        extraction_method: "smoke",
        confidence: 1,
      }],
      knowledgeUnits: [{
        id: "smoke-kp-linear",
        entity_type: "knowledge_point",
        name: "一次函数",
        statement: content,
        knowledge_form: "concept",
        aliases: ["线性函数"],
        confidence: 1,
        review_status: "verified",
        source_anchor: { block_ids: ["smoke-chunk-linear"], page_index: 0 },
      }],
      questions: [],
      relations: [],
      questionLinks: [],
    });
    graphCounts = graphResult.counts;
    await graphStore.activateRelease(scope);
  }

  const retrieval = createEducationHybridRetrievalService({
    modelClient,
    vectorStore,
    graphStore,
  });
  const receipt = await retrieval.search({
    query: "一次函数的斜率和截距",
    tenantId: scope.tenantId,
    principalId: scope.principalId,
    principalIds: scope.readPrincipals,
    namespaceId: scope.namespaceId,
    courseId: scope.corpusId,
    corpusId: scope.corpusId,
    limit: 3,
  });
  if (receipt.status !== "retrieved" || !receipt.hits.length) {
    throw new Error(`Knowledge smoke retrieval failed: ${receipt.code}`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    collection,
    vector_count: vectorResult.count,
    graph_counts: graphCounts,
    active_release_id: receipt.active_release_id,
    retrieval_mode: receipt.retrieval_mode,
    hit_ids: receipt.hits.map((hit) => hit.record_id),
    graph_node_count: receipt.graph.nodes.length,
  })}\n`);
} finally {
  await graphStore.close();
}
