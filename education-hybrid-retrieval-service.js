import {
  EDUCATION_LEXICAL_SPARSE_VERSION,
  encodeEducationLexicalSparse,
} from "./education-lexical-sparse.js";
import { runWithEducationDeadline } from "./education-operation-deadline.js";

const MAX_QUERY_LENGTH = 8_000;
const MAX_LIMIT = 50;

export class EducationHybridRetrievalError extends Error {
  constructor(code, message, { status = 422, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "EducationHybridRetrievalError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Release-scoped retrieval boundary. The caller supplies an authenticated
 * server identity; tenant/corpus/release are never inferred from model text.
 */
export function createEducationHybridRetrievalService({
  modelClient,
  vectorStore,
  graphStore,
  connectionMonitor = null,
  requestTimeoutMs = 4_000,
  lexicalEncoder = encodeEducationLexicalSparse,
} = {}) {
  assertMethod(modelClient, "embedMultimodal");
  assertMethod(vectorStore, "hybridSearch");
  assertMethod(graphStore, "resolveActiveRelease");
  assertMethod(graphStore, "expand");

  async function search(input = {}) {
    const request = normalizeSearch(input);
    input.signal?.throwIfAborted();
    if (connectionMonitor) {
      const connection = await connectionMonitor.getStatus({ signal: input.signal });
      if (!connection.retrieval.remote_allowed) {
        return safeReceipt(request, {
          status: "tool_error", code: connection.retrieval.reason,
          retrievalDegraded: true,
        });
      }
    }
    let stage = "neo4j";
    try {
      return await runWithEducationDeadline((signal) => retrieve({ ...input, signal }, request,
        (name) => { stage = name; }), {
        signal: input.signal, timeoutMs: requestTimeoutMs, code: "retrieval_request_timeout",
      });
    } catch (error) {
      // User cancellation is neither a store outage nor permission to continue locally.
      input.signal?.throwIfAborted();
      const code = error?.code === "retrieval_request_timeout"
        ? "retrieval_request_timeout" : "retrieval_backend_failed";
      if (stage === "neo4j" || stage === "qdrant") connectionMonitor?.recordFailure(stage, code);
      return safeReceipt(request, { status: "tool_error", code, retrievalDegraded: true });
    }
  }

  async function retrieve(input, request, setStage) {
    const graphScope = {
      tenantId: request.tenantId,
      namespaceId: request.namespaceId,
      corpusId: request.corpusId,
      principalId: request.principalId,
      readPrincipals: request.principalIds,
      visibility: request.visibility,
    };
      const active = await graphStore.resolveActiveRelease({ ...graphScope, signal: input.signal });
      if (!active || active.status !== "active") {
        return safeReceipt(request, { status: "no_match", code: "active_release_not_found" });
      }
      setStage("embedding");
      const embedding = await modelClient.embedMultimodal({
        input: [{ type: "text", text: request.query }],
        encodingFormat: "float",
        signal: input.signal,
      });
      if (!Array.isArray(embedding.embedding) || !embedding.embedding.every(Number.isFinite)) {
        return safeReceipt(request, { status: "tool_error", code: "embedding_invalid" });
      }
      const providerSparse = normalizeProviderSparse(embedding.sparseEmbedding);
      let sparse = providerSparse;
      let sparseKind = "provider_sparse";
      let sparseVersion = embedding.model || "provider";
      let retrievalDegraded = false;
      if (!sparse) {
        try {
          const local = lexicalEncoder(request.query);
          sparse = { indices: [...local.indices], values: [...local.values] };
          sparseKind = "local_lexical";
          sparseVersion = local.version || EDUCATION_LEXICAL_SPARSE_VERSION;
        } catch {
          if (typeof vectorStore.denseSearch !== "function") {
            return safeReceipt(request, { status: "tool_error", code: "sparse_encoding_failed" });
          }
          retrievalDegraded = true;
          sparseKind = "none";
          sparseVersion = null;
        }
      }

      const filter = {
        tenantId: request.tenantId,
        courseIds: [request.courseId],
        corpusIds: [request.corpusId],
        releaseIds: [active.release_id],
        principalIds: request.principalIds,
        publishStates: ["published"],
        namespaces: [request.namespaceId],
        ...(request.entityTypes.length ? { entityTypes: request.entityTypes } : {}),
      };
      input.signal?.throwIfAborted();
      setStage("qdrant");
      const result = retrievalDegraded
        ? await vectorStore.denseSearch({
          dense: embedding.embedding, filter, limit: request.limit, signal: input.signal,
        })
        : await vectorStore.hybridSearch({
          dense: embedding.embedding, sparse, filter, limit: request.limit, signal: input.signal,
        });
      const points = Array.isArray(result?.points) ? result.points : null;
      if (!points || points.some((point) => !authorizedPoint(point, request, active.release_id))) {
        return safeReceipt(request, { status: "tool_error", code: "retrieval_scope_violation" });
      }
      if (!points.length) {
        return safeReceipt(request, {
          status: "no_match", code: "no_match", active, sparseKind, sparseVersion,
          retrievalDegraded,
        });
      }

      const seedIds = [...new Set(points.map((point) => point.payload.record_id))].slice(0, 50);
      input.signal?.throwIfAborted();
      setStage("neo4j");
      const expansion = await graphStore.expand({
        ...graphScope,
        signal: input.signal,
        releaseId: active.release_id,
        seedIds,
        hops: 1,
        limit: Math.min(200, Math.max(20, request.limit * 4)),
      });
      return safeReceipt(request, {
        status: "retrieved",
        code: "ok",
        active,
        sparseKind,
        sparseVersion,
        retrievalDegraded,
        hits: points.map(publicHit),
        graph: expansion,
      });
  }

  return Object.freeze({ search });
}

function normalizeSearch(input) {
  const query = text(input.query, "query").slice(0, MAX_QUERY_LENGTH);
  const principalId = text(input.principalId, "principalId");
  const principalIds = normalizeIds(input.principalIds || [principalId], "principalIds");
  if (!principalIds.includes(principalId)) {
    throw new EducationHybridRetrievalError(
      "education_retrieval_identity_invalid",
      "The authenticated principal must be included in principalIds.",
      { status: 403 },
    );
  }
  const limit = input.limit === undefined ? 10 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new EducationHybridRetrievalError(
      "education_retrieval_input_invalid", `limit must be between 1 and ${MAX_LIMIT}.`,
    );
  }
  return {
    query,
    tenantId: text(input.tenantId, "tenantId"),
    principalId,
    principalIds,
    namespaceId: text(input.namespaceId || "organization_course", "namespaceId"),
    courseId: text(input.courseId, "courseId"),
    corpusId: text(input.corpusId || input.courseId, "corpusId"),
    visibility: input.visibility === "public" ? "public" : "tenant",
    entityTypes: input.entityTypes === undefined ? [] : normalizeIds(input.entityTypes, "entityTypes"),
    limit,
  };
}

function authorizedPoint(point, request, releaseId) {
  const payload = point?.payload;
  if (!payload || typeof payload !== "object") return false;
  if (payload.tenant_id !== request.tenantId || payload.course_id !== request.courseId
    || payload.corpus_id !== request.corpusId || payload.release_id !== releaseId
    || payload.publish_state !== "published" || payload.namespace !== request.namespaceId) return false;
  if (["public", "shared", "tenant", "course"].includes(payload.visibility)) return true;
  return payload.visibility === "private" && Array.isArray(payload.acl_principal_ids)
    && payload.acl_principal_ids.some((id) => request.principalIds.includes(id));
}

function publicHit(point) {
  const payload = point.payload;
  return Object.freeze({
    id: point.id,
    score: Number.isFinite(point.score) ? point.score : null,
    record_id: payload.record_id,
    entity_type: payload.entity_type,
    title: payload.title || null,
    content: payload.content || null,
    source_anchor: payload.source_anchor || null,
    document_id: payload.document_id,
    document_revision_id: payload.document_revision_id,
  });
}

function safeReceipt(request, {
  status, code, active = null, sparseKind = null, sparseVersion = null,
  retrievalDegraded = false, hits = [], graph = null,
}) {
  return Object.freeze({
    schema_version: "education-hybrid-retrieval-receipt@1.0",
    status,
    code,
    retrieval_mode: retrievalDegraded ? "dense_degraded" : (sparseKind ? "hybrid_rrf" : null),
    retrieval_degraded: retrievalDegraded,
    tenant_id: request.tenantId,
    corpus_id: request.corpusId,
    active_release_id: active?.release_id || null,
    sparse_encoder_kind: sparseKind,
    sparse_encoder_version: sparseVersion,
    hits: Object.freeze(hits),
    graph: graph || { nodes: [], relationships: [] },
  });
}

function normalizeProviderSparse(value) {
  if (!value || !Array.isArray(value.indices) || !Array.isArray(value.values)
    || !value.indices.length || value.indices.length !== value.values.length) return null;
  const pairs = value.indices.map((index, offset) => ({ index, value: value.values[offset] }))
    .sort((left, right) => left.index - right.index);
  if (!pairs.every((entry) => Number.isSafeInteger(entry.index) && entry.index >= 0
    && Number.isFinite(entry.value) && entry.value !== 0)
    || pairs.some((entry, index) => index > 0 && entry.index === pairs[index - 1].index)) return null;
  return { indices: pairs.map((entry) => entry.index), values: pairs.map((entry) => entry.value) };
}

function normalizeIds(value, field) {
  if (!Array.isArray(value) || !value.length || value.length > 200) {
    throw new EducationHybridRetrievalError(
      "education_retrieval_input_invalid", `${field} must be a non-empty array.`,
    );
  }
  return [...new Set(value.map((item) => text(item, field)))];
}

function text(value, field) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) {
    throw new EducationHybridRetrievalError(
      "education_retrieval_input_invalid", `${field} is required.`,
    );
  }
  return result;
}

function assertMethod(value, method) {
  if (!value || typeof value[method] !== "function") throw new TypeError(`${method} dependency is required.`);
}
