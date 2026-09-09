import { createHash } from "node:crypto";

const DEFAULT_COLLECTION = "education_knowledge_v1";
const DEFAULT_DENSE_VECTOR_NAME = "dense";
const DEFAULT_SPARSE_VECTOR_NAME = "sparse";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_SIZE = 256;
const MAX_QUERY_LIMIT = 100;
const MAX_PREFETCH_LIMIT = 500;
const MAX_METADATA_BYTES = 64 * 1024;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PUBLISH_STATES = new Set([
  "staging",
  "draft",
  "review",
  "published",
  "archived",
  "withdrawn",
]);
const VISIBILITIES = new Set(["private", "course", "tenant", "shared", "public"]);

const PAYLOAD_INDEXES = Object.freeze([
  ["tenant_id", { type: "keyword", is_tenant: true }],
  ["course_id", "keyword"],
  ["corpus_id", "keyword"],
  ["release_id", "keyword"],
  ["record_id", "keyword"],
  ["revision_id", "keyword"],
  ["document_id", "keyword"],
  ["document_revision_id", "keyword"],
  ["publish_state", "keyword"],
  ["visibility", "keyword"],
  ["acl_principal_ids", "keyword"],
  ["entity_type", "keyword"],
  ["namespace", "keyword"],
  ["index_build_id", "keyword"],
  ["subject", "keyword"],
  ["grade_band", "keyword"],
  ["page_index", "integer"],
]);

/**
 * Error boundary for the Qdrant adapter. No response body or credential is
 * copied onto the error object because this error can cross an HTTP boundary.
 */
export class EducationQdrantError extends Error {
  constructor(code, message, { status = 502, retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = "EducationQdrantError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * Qdrant REST adapter for published education retrieval records.
 *
 * It deliberately accepts precomputed dense and sparse vectors. Ark embedding
 * calls remain in the model boundary; this adapter never reads ARK_API_KEY and
 * never performs an implicit provider request.
 */
export function createEducationQdrantStore({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = readConfig(env);
  let readyDenseSize = null;
  let writeReady = false;

  function configSummary() {
    return {
      configured: Boolean(config.baseUrl),
      baseUrl: config.baseUrl || null,
      collection: config.collection,
      denseVectorName: config.denseVectorName,
      sparseVectorName: config.sparseVectorName,
      sparseModifier: config.sparseModifier,
      timeoutMs: config.timeoutMs,
      authenticated: Boolean(config.apiKey),
      denseSize: readyDenseSize,
      missing: config.baseUrl ? [] : ["QDRANT_URL"],
    };
  }

  async function health({ includeCollection = true, signal } = {}) {
    if (!config.baseUrl) {
      return {
        ok: false,
        configured: false,
        code: "education_qdrant_not_configured",
        collection: config.collection,
      };
    }
    try {
      await request({ path: "/healthz", method: "GET", signal, expectJson: false });
      let collection = null;
      if (includeCollection) {
        const response = await request({
          path: collectionPath(config.collection),
          method: "GET",
          signal,
          allowStatuses: [404],
        });
        if (response.status === 404) {
          return {
            ok: false,
            configured: true,
            code: "education_qdrant_collection_missing",
            collection: config.collection,
          };
        }
        collection = collectionHealth(response.payload?.result);
        if (!collection.ok) {
          return {
            ok: false,
            configured: true,
            code: "education_qdrant_collection_unhealthy",
            collection: config.collection,
            collectionStatus: collection.status,
          };
        }
      }
      return {
        ok: true,
        configured: true,
        collection: config.collection,
        ...(collection ? { collectionStatus: collection.status } : {}),
      };
    } catch (error) {
      const normalized = normalizeError(error);
      return {
        ok: false,
        configured: true,
        code: normalized.code,
        collection: config.collection,
      };
    }
  }

  async function ensureCollection({ denseSize, signal } = {}) {
    ensureConfigured(config, fetchImpl);
    const expectedDenseSize = positiveInteger(denseSize, "denseSize", { max: 65_536 });
    const path = collectionPath(config.collection);
    let response = await request({
      path,
      method: "GET",
      signal,
      allowStatuses: [404],
    });
    let created = false;
    if (response.status === 404) {
      await request({
        path,
        method: "PUT",
        signal,
        body: {
          vectors: {
            [config.denseVectorName]: {
              size: expectedDenseSize,
              distance: "Cosine",
            },
          },
          sparse_vectors: {
            [config.sparseVectorName]: {
              ...(config.sparseModifier ? { modifier: config.sparseModifier } : {}),
              index: { on_disk: true },
            },
          },
          on_disk_payload: true,
          strict_mode_config: { enabled: true },
          metadata: {
            owner: "education-qdrant-store",
            schema_version: "1.0",
          },
        },
      });
      created = true;
      response = await request({ path, method: "GET", signal });
    }

    assertCollectionConfiguration(response.payload?.result, {
      denseVectorName: config.denseVectorName,
      sparseVectorName: config.sparseVectorName,
      sparseModifier: config.sparseModifier,
      denseSize: expectedDenseSize,
    });
    await ensurePayloadIndexes(response.payload?.result?.payload_schema, signal);
    readyDenseSize = expectedDenseSize;
    writeReady = true;
    return {
      ok: true,
      created,
      collection: config.collection,
      denseSize: expectedDenseSize,
      denseVectorName: config.denseVectorName,
      sparseVectorName: config.sparseVectorName,
      sparseModifier: config.sparseModifier,
      payloadIndexes: PAYLOAD_INDEXES.map(([fieldName]) => fieldName),
    };
  }

  /**
   * Open an already-published collection for retrieval after a process restart.
   *
   * This path is deliberately read-only: it never creates the collection or
   * payload indexes. Publication must still call ensureCollection() before any
   * mutation, while retrieval can safely recover the persisted vector shape.
   */
  async function openExistingCollection({ denseSize, signal } = {}) {
    ensureConfigured(config, fetchImpl);
    const expectedDenseSize = positiveInteger(denseSize, "denseSize", { max: 65_536 });
    const response = await request({
      path: collectionPath(config.collection),
      method: "GET",
      signal,
      allowStatuses: [404],
    });
    if (response.status === 404) {
      throw new EducationQdrantError(
        "education_qdrant_collection_missing",
        "The configured Qdrant collection does not exist.",
        { status: 503 },
      );
    }
    assertCollectionConfiguration(response.payload?.result, {
      denseVectorName: config.denseVectorName,
      sparseVectorName: config.sparseVectorName,
      sparseModifier: config.sparseModifier,
      denseSize: expectedDenseSize,
    });
    readyDenseSize = expectedDenseSize;
    return {
      ok: true,
      collection: config.collection,
      denseSize: expectedDenseSize,
      denseVectorName: config.denseVectorName,
      sparseVectorName: config.sparseVectorName,
      sparseModifier: config.sparseModifier,
      readOnly: true,
    };
  }

  async function upsertPoints(points, { signal } = {}) {
    ensureReady();
    if (!Array.isArray(points) || points.length === 0 || points.length > MAX_BATCH_SIZE) {
      throw invalidInput(`points must contain between 1 and ${MAX_BATCH_SIZE} entries.`);
    }
    const normalizedPoints = points.map((point, index) => normalizePoint(
      point,
      index,
      readyDenseSize,
      config,
    ));
    const response = await request({
      path: `${collectionPath(config.collection)}/points?wait=true&ordering=medium`,
      method: "PUT",
      signal,
      body: { points: normalizedPoints },
    });
    assertCompletedUpdate(response.payload, "upsert");
    return {
      ok: true,
      count: normalizedPoints.length,
      operationId: operationId(response.payload),
      pointIds: normalizedPoints.map((point) => point.id),
    };
  }

  async function deleteByRevision({
    tenantId,
    documentRevisionId,
    corpusId,
    releaseId,
    publishState,
    signal,
  } = {}) {
    ensureReady();
    const must = [
      matchValue("tenant_id", safeId(tenantId, "tenantId")),
      matchValue(
        "document_revision_id",
        safeId(documentRevisionId, "documentRevisionId"),
      ),
    ];
    if (publishState !== undefined) {
      must.push(matchValue("publish_state", normalizePublishState(publishState)));
    }
    if (corpusId !== undefined) {
      must.push(matchValue("corpus_id", safeId(corpusId, "corpusId")));
    }
    if (releaseId !== undefined) {
      must.push(matchValue("release_id", safeId(releaseId, "releaseId")));
    }
    const response = await request({
      path: `${collectionPath(config.collection)}/points/delete?wait=true&ordering=medium`,
      method: "POST",
      signal,
      body: { filter: { must } },
    });
    assertCompletedUpdate(response.payload, "delete");
    return { ok: true, operationId: operationId(response.payload) };
  }

  async function setPublishState({
    tenantId,
    corpusId,
    releaseId,
    publishState,
    fromPublishState,
    signal,
  } = {}) {
    ensureReady();
    const nextState = normalizePublishState(publishState);
    const must = [
      matchValue("tenant_id", safeId(tenantId, "tenantId")),
      matchValue(
        "corpus_id",
        safeId(corpusId, "corpusId"),
      ),
      matchValue("release_id", safeId(releaseId, "releaseId")),
    ];
    if (fromPublishState !== undefined) {
      must.push(matchValue("publish_state", normalizePublishState(fromPublishState)));
    }
    const response = await request({
      path: `${collectionPath(config.collection)}/points/payload?wait=true&ordering=medium`,
      method: "POST",
      signal,
      body: {
        payload: { publish_state: nextState },
        filter: { must },
      },
    });
    assertCompletedUpdate(response.payload, "set payload");
    return {
      ok: true,
      publishState: nextState,
      operationId: operationId(response.payload),
    };
  }

  async function hybridSearch({
    dense,
    sparse,
    filter,
    limit = 10,
    signal,
  } = {}) {
    const queryDenseSize = denseVectorSize(dense, "dense");
    const sparseVector = normalizeSparseVector(sparse, "sparse");
    const access = normalizeAccessFilter(filter);
    const queryLimit = positiveInteger(limit, "limit", { max: MAX_QUERY_LIMIT });
    if (!readyDenseSize) {
      await openExistingCollection({ denseSize: queryDenseSize, signal });
    }
    const denseVector = normalizeDenseVector(dense, readyDenseSize, "dense");
    const prefetchLimit = Math.min(
      MAX_PREFETCH_LIMIT,
      Math.max(40, queryLimit * 4),
    );
    const qdrantFilter = buildQdrantAccessFilter(access);
    const response = await request({
      path: `${collectionPath(config.collection)}/points/query`,
      method: "POST",
      signal,
      body: {
        prefetch: [
          {
            query: sparseVector,
            using: config.sparseVectorName,
            filter: qdrantFilter,
            ...(config.sparseModifier === "idf"
              ? { params: { idf: { corpus: qdrantFilter } } }
              : {}),
            limit: prefetchLimit,
          },
          {
            query: denseVector,
            using: config.denseVectorName,
            filter: qdrantFilter,
            limit: prefetchLimit,
          },
        ],
        query: { rrf: {} },
        filter: qdrantFilter,
        limit: queryLimit,
        with_payload: true,
        with_vector: false,
      },
    });
    const points = response.payload?.result?.points;
    if (!Array.isArray(points)) {
      throw invalidResponse("Qdrant returned an invalid query response.");
    }
    for (const point of points) {
      if (!isAuthorizedPayload(point?.payload, access)) {
        throw new EducationQdrantError(
          "education_qdrant_acl_response_violation",
          "Qdrant returned a point outside the required access filter.",
          { status: 502 },
        );
      }
    }
    return {
      ok: true,
      fusion: "rrf",
      points: points.map((point) => ({
        id: point.id,
        score: Number.isFinite(point.score) ? point.score : null,
        payload: point.payload,
      })),
    };
  }

  async function ensurePayloadIndexes(payloadSchema, signal) {
    const schema = isObject(payloadSchema) ? payloadSchema : {};
    for (const [fieldName, fieldSchema] of PAYLOAD_INDEXES) {
      if (Object.hasOwn(schema, fieldName)) {
        assertPayloadIndexType(fieldName, schema[fieldName], fieldSchema);
        continue;
      }
      const response = await request({
        path: `${collectionPath(config.collection)}/index?wait=true`,
        method: "PUT",
        signal,
        body: { field_name: fieldName, field_schema: fieldSchema },
      });
      assertCompletedUpdate(response.payload, `create ${fieldName} payload index`);
    }
  }

  async function request({
    path,
    method,
    body,
    signal,
    allowStatuses = [],
    expectJson = true,
  }) {
    ensureConfigured(config, fetchImpl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const response = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(config.apiKey ? { "api-key": config.apiKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const text = await readBoundedText(response);
      const allowed = response.ok || allowStatuses.includes(response.status);
      if (!allowed) {
        throw new EducationQdrantError(
          response.status === 401 || response.status === 403
            ? "education_qdrant_auth_failed"
            : "education_qdrant_request_failed",
          `Qdrant request failed with HTTP ${response.status}.`,
          {
            status: response.status === 401 || response.status === 403 ? 503 : 502,
            retryable: response.status === 429 || response.status >= 500,
          },
        );
      }
      let payload = null;
      if (expectJson && text) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw invalidResponse("Qdrant returned invalid JSON.");
        }
      }
      return { status: response.status, payload, text };
    } catch (error) {
      if (error instanceof EducationQdrantError) throw error;
      if (controller.signal.aborted) {
        throw new EducationQdrantError(
          signal?.aborted
            ? "education_qdrant_aborted"
            : "education_qdrant_timeout",
          signal?.aborted
            ? "The Qdrant request was cancelled."
            : "The Qdrant request timed out.",
          { status: signal?.aborted ? 499 : 504, retryable: !signal?.aborted },
        );
      }
      throw new EducationQdrantError(
        "education_qdrant_unavailable",
        "Qdrant is unavailable.",
        { status: 503, retryable: true, cause: error },
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  function ensureReady() {
    ensureConfigured(config, fetchImpl);
    if (!readyDenseSize || !writeReady) {
      throw new EducationQdrantError(
        "education_qdrant_collection_not_ready",
        "ensureCollection({ denseSize }) must succeed before data operations.",
        { status: 503 },
      );
    }
  }

  return Object.freeze({
    configSummary,
    health,
    ensureCollection,
    openExistingCollection,
    upsertPoints,
    deleteByRevision,
    setPublishState,
    hybridSearch,
  });
}

export function buildQdrantAccessFilter(input) {
  const access = input?.tenantId && input?.courseIds
    ? normalizeAccessFilter(input)
    : input;
  if (!access || !Array.isArray(access.courseIds)) {
    throw invalidInput("A normalized access filter is required.");
  }
  const must = [
    matchValue("tenant_id", access.tenantId),
    matchAny("course_id", access.courseIds),
    matchAny("corpus_id", access.corpusIds),
    matchAny("release_id", access.releaseIds),
    matchAny("publish_state", access.publishStates),
  ];
  addAnyCondition(must, "subject", access.subjects);
  addAnyCondition(must, "grade_band", access.gradeBands);
  addAnyCondition(must, "entity_type", access.entityTypes);
  addAnyCondition(must, "namespace", access.namespaces);
  addAnyCondition(must, "index_build_id", access.indexBuildIds);
  addAnyCondition(must, "document_id", access.documentIds);
  addAnyCondition(must, "document_revision_id", access.documentRevisionIds);
  addAnyCondition(must, "record_id", access.recordIds);

  const visibilityShould = [
    matchAny("visibility", ["public", "shared", "tenant", "course"]),
  ];
  if (access.principalIds.length) {
    visibilityShould.push({
      must: [
        matchValue("visibility", "private"),
        matchAny("acl_principal_ids", access.principalIds),
      ],
    });
  }
  must.push({ should: visibilityShould });
  return { must };
}

export function educationQdrantPointId(payload) {
  const value = [
    safeId(payload?.tenant_id, "payload.tenant_id"),
    safeId(payload?.course_id, "payload.course_id"),
    safeId(payload?.corpus_id, "payload.corpus_id"),
    safeId(payload?.release_id, "payload.release_id"),
    safeId(payload?.record_id, "payload.record_id"),
    safeId(payload?.revision_id, "payload.revision_id"),
  ].join("\u001f");
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function readConfig(env) {
  const source = isObject(env) ? env : {};
  const baseUrl = normalizeBaseUrl(readString(source.QDRANT_URL), source);
  return {
    baseUrl,
    apiKey: readString(source.QDRANT_API_KEY),
    collection: safeName(
      readString(source.QDRANT_EDUCATION_COLLECTION) || DEFAULT_COLLECTION,
      "QDRANT_EDUCATION_COLLECTION",
    ),
    denseVectorName: safeName(
      readString(source.QDRANT_DENSE_VECTOR_NAME) || DEFAULT_DENSE_VECTOR_NAME,
      "QDRANT_DENSE_VECTOR_NAME",
    ),
    sparseVectorName: safeName(
      readString(source.QDRANT_SPARSE_VECTOR_NAME) || DEFAULT_SPARSE_VECTOR_NAME,
      "QDRANT_SPARSE_VECTOR_NAME",
    ),
    sparseModifier: normalizeSparseModifier(source.QDRANT_SPARSE_MODIFIER),
    timeoutMs: normalizeTimeout(source.QDRANT_REQUEST_TIMEOUT_MS),
  };
}

function normalizeBaseUrl(value, env) {
  if (!value) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError("QDRANT_URL must be a valid HTTP(S) URL.");
  }
  if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password) {
    throw configurationError(
      "QDRANT_URL must be an HTTP(S) URL without embedded credentials.",
    );
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol === "http:" && !loopback && readString(env.QDRANT_ALLOW_INSECURE_HTTP) !== "true") {
    throw configurationError(
      "Non-loopback QDRANT_URL must use HTTPS unless QDRANT_ALLOW_INSECURE_HTTP=true.",
    );
  }
  if (parsed.search || parsed.hash) {
    throw configurationError("QDRANT_URL must not include query parameters or a fragment.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed.toString().replace(/\/$/u, "");
}

function normalizeTimeout(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_TIMEOUT_MS;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 250 || number > MAX_TIMEOUT_MS) {
    throw configurationError(
      `QDRANT_REQUEST_TIMEOUT_MS must be an integer between 250 and ${MAX_TIMEOUT_MS}.`,
    );
  }
  return number;
}

function normalizeSparseModifier(value) {
  const normalized = readString(value).toLowerCase();
  if (!normalized || normalized === "idf") return "idf";
  if (normalized === "none") return null;
  throw configurationError("QDRANT_SPARSE_MODIFIER must be idf or none.");
}

function ensureConfigured(config, fetchImpl) {
  if (!config.baseUrl) {
    throw new EducationQdrantError(
      "education_qdrant_not_configured",
      "Qdrant is not configured.",
      { status: 503 },
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new EducationQdrantError(
      "education_qdrant_fetch_unavailable",
      "The server cannot send Qdrant requests.",
      { status: 503 },
    );
  }
}

function assertCollectionConfiguration(result, expected) {
  if (!isObject(result)) throw invalidResponse("Qdrant returned invalid collection details.");
  const health = collectionHealth(result);
  if (!health.ok) {
    throw new EducationQdrantError(
      "education_qdrant_collection_unhealthy",
      `The Qdrant collection status is ${health.status || "unknown"}.`,
      { status: 503, retryable: true },
    );
  }
  const params = result.config?.params;
  const dense = params?.vectors?.[expected.denseVectorName];
  const sparse = params?.sparse_vectors?.[expected.sparseVectorName];
  if (!dense || dense.size !== expected.denseSize || String(dense.distance).toLowerCase() !== "cosine") {
    throw new EducationQdrantError(
      "education_qdrant_collection_incompatible",
      "The existing Qdrant dense vector configuration is incompatible.",
      { status: 409 },
    );
  }
  if (!sparse) {
    throw new EducationQdrantError(
      "education_qdrant_collection_incompatible",
      "The existing Qdrant collection has no compatible named sparse vector.",
      { status: 409 },
    );
  }
  if (expected.sparseModifier) {
    const modifier = String(sparse.modifier || "").toLowerCase();
    if (modifier !== expected.sparseModifier) {
      throw new EducationQdrantError(
        "education_qdrant_collection_incompatible",
        "The existing Qdrant sparse vector modifier is incompatible.",
        { status: 409 },
      );
    }
  }
}

function collectionHealth(result) {
  const status = typeof result?.status === "string" ? result.status.toLowerCase() : "unknown";
  const optimizer = result?.optimizer_status;
  const optimizerOk = optimizer === undefined || optimizer === "ok";
  return {
    ok: ["green", "yellow"].includes(status) && optimizerOk,
    status,
  };
}

function assertPayloadIndexType(fieldName, actual, expected) {
  const expectedType = typeof expected === "string" ? expected : expected.type;
  const actualType = typeof actual === "string"
    ? actual
    : actual?.data_type || actual?.type || actual?.params?.type;
  if (actualType && String(actualType).toLowerCase() !== expectedType) {
    throw new EducationQdrantError(
      "education_qdrant_payload_index_incompatible",
      `The Qdrant payload index for ${fieldName} is incompatible.`,
      { status: 409 },
    );
  }
}

function normalizePoint(point, index, denseSize, config) {
  if (!isObject(point)) throw invalidInput(`points[${index}] must be an object.`);
  const payload = normalizePayload(point.payload, `points[${index}].payload`);
  const id = point.id === undefined ? educationQdrantPointId(payload) : normalizePointId(point.id);
  return {
    id,
    vector: {
      [config.denseVectorName]: normalizeDenseVector(
        point.dense,
        denseSize,
        `points[${index}].dense`,
      ),
      [config.sparseVectorName]: normalizeSparseVector(
        point.sparse,
        `points[${index}].sparse`,
      ),
    },
    payload,
  };
}

function normalizePayload(value, path) {
  if (!isObject(value)) throw invalidInput(`${path} must be an object.`);
  const required = [
    "tenant_id",
    "course_id",
    "corpus_id",
    "release_id",
    "record_id",
    "revision_id",
    "document_id",
    "document_revision_id",
    "publish_state",
    "visibility",
    "entity_type",
    "namespace",
    "index_build_id",
  ];
  const result = {};
  for (const key of required) {
    if (value[key] === undefined) throw invalidInput(`${path}.${key} is required.`);
  }
  for (const key of [
    "tenant_id", "course_id", "corpus_id", "release_id", "record_id", "revision_id", "document_id",
    "document_revision_id", "entity_type", "namespace", "index_build_id",
  ]) {
    result[key] = safeId(value[key], `${path}.${key}`);
  }
  result.publish_state = normalizePublishState(value.publish_state, `${path}.publish_state`);
  result.visibility = enumValue(value.visibility, VISIBILITIES, `${path}.visibility`);
  result.acl_principal_ids = normalizeIdList(
    value.acl_principal_ids,
    `${path}.acl_principal_ids`,
    { required: result.visibility === "private" },
  );
  for (const key of [
    "subject", "grade_band", "document_type", "language", "embedding_model",
    "sparse_encoder_kind", "sparse_encoder_version", "content_hash",
  ]) {
    if (value[key] !== undefined) result[key] = safeId(value[key], `${path}.${key}`);
  }
  for (const key of ["title", "content"]) {
    if (value[key] !== undefined) result[key] = safeText(value[key], `${path}.${key}`, 50_000);
  }
  if (value.page_index !== undefined) {
    result.page_index = nonNegativeInteger(value.page_index, `${path}.page_index`);
  }
  for (const key of ["block_ids", "knowledge_point_ids", "tags"]) {
    if (value[key] !== undefined) {
      result[key] = normalizeIdList(value[key], `${path}.${key}`, { max: 256 });
    }
  }
  if (value.source_anchor !== undefined) {
    result.source_anchor = safeJsonObject(value.source_anchor, `${path}.source_anchor`);
  }
  if (value.metadata !== undefined) {
    result.metadata = safeJsonObject(value.metadata, `${path}.metadata`);
  }
  if (value.created_at !== undefined) {
    const date = safeText(value.created_at, `${path}.created_at`, 64);
    if (Number.isNaN(Date.parse(date))) throw invalidInput(`${path}.created_at must be ISO-8601.`);
    result.created_at = date;
  }
  return result;
}

function normalizeDenseVector(value, size, path) {
  const actualSize = denseVectorSize(value, path);
  if (actualSize !== size) {
    throw invalidInput(`${path} must contain exactly ${size} values.`);
  }
  return [...value];
}

function denseVectorSize(value, path) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 65_536) {
    throw invalidInput(`${path} must contain between 1 and 65536 values.`);
  }
  if (!value.every(Number.isFinite)) throw invalidInput(`${path} must contain finite numbers.`);
  return value.length;
}

function normalizeSparseVector(value, path) {
  if (!isObject(value) || !Array.isArray(value.indices) || !Array.isArray(value.values)) {
    throw invalidInput(`${path} must contain indices and values arrays.`);
  }
  if (value.indices.length === 0 || value.indices.length !== value.values.length) {
    throw invalidInput(`${path} indices and values must have the same non-zero length.`);
  }
  const pairs = value.indices.map((item, index) => ({
    index: item,
    value: value.values[index],
  }));
  if (!pairs.every((pair) =>
    Number.isSafeInteger(pair.index)
    && pair.index >= 0
    && Number.isFinite(pair.value)
    && pair.value !== 0
  )) {
    throw invalidInput(`${path} contains an invalid sparse vector entry.`);
  }
  pairs.sort((a, b) => a.index - b.index);
  if (pairs.some((pair, index) => index > 0 && pair.index === pairs[index - 1].index)) {
    throw invalidInput(`${path}.indices must be unique.`);
  }
  return {
    indices: pairs.map((pair) => pair.index),
    values: pairs.map((pair) => pair.value),
  };
}

function normalizeAccessFilter(value) {
  if (!isObject(value)) throw invalidInput("filter must be an object.");
  return {
    tenantId: safeId(value.tenantId, "filter.tenantId"),
    courseIds: normalizeIdList(value.courseIds, "filter.courseIds", { required: true }),
    corpusIds: normalizeIdList(value.corpusIds, "filter.corpusIds", { required: true }),
    releaseIds: normalizeIdList(value.releaseIds, "filter.releaseIds", { required: true }),
    principalIds: normalizeIdList(value.principalIds, "filter.principalIds"),
    publishStates: normalizePublishStates(value.publishStates),
    subjects: normalizeIdList(value.subjects, "filter.subjects"),
    gradeBands: normalizeIdList(value.gradeBands, "filter.gradeBands"),
    entityTypes: normalizeIdList(value.entityTypes, "filter.entityTypes"),
    namespaces: normalizeIdList(value.namespaces, "filter.namespaces"),
    indexBuildIds: normalizeIdList(value.indexBuildIds, "filter.indexBuildIds"),
    documentIds: normalizeIdList(value.documentIds, "filter.documentIds"),
    documentRevisionIds: normalizeIdList(
      value.documentRevisionIds,
      "filter.documentRevisionIds",
    ),
    recordIds: normalizeIdList(value.recordIds, "filter.recordIds"),
  };
}

function normalizePublishStates(value) {
  if (value === undefined) return ["published"];
  if (!Array.isArray(value) || value.length === 0 || value.length > PUBLISH_STATES.size) {
    throw invalidInput("filter.publishStates must be a non-empty array.");
  }
  return [...new Set(value.map((item) => normalizePublishState(item, "filter.publishStates")))];
}

function isAuthorizedPayload(payload, access) {
  if (!isObject(payload)) return false;
  if (payload.tenant_id !== access.tenantId) return false;
  if (!access.courseIds.includes(payload.course_id)) return false;
  if (!access.corpusIds.includes(payload.corpus_id)) return false;
  if (!access.releaseIds.includes(payload.release_id)) return false;
  if (!access.publishStates.includes(payload.publish_state)) return false;
  if (!optionalListMatch(access.subjects, payload.subject)) return false;
  if (!optionalListMatch(access.gradeBands, payload.grade_band)) return false;
  if (!optionalListMatch(access.entityTypes, payload.entity_type)) return false;
  if (!optionalListMatch(access.namespaces, payload.namespace)) return false;
  if (!optionalListMatch(access.indexBuildIds, payload.index_build_id)) return false;
  if (!optionalListMatch(access.documentIds, payload.document_id)) return false;
  if (!optionalListMatch(access.documentRevisionIds, payload.document_revision_id)) return false;
  if (!optionalListMatch(access.recordIds, payload.record_id)) return false;
  if (["public", "shared", "tenant", "course"].includes(payload.visibility)) return true;
  if (payload.visibility !== "private" || !Array.isArray(payload.acl_principal_ids)) return false;
  return payload.acl_principal_ids.some((id) => access.principalIds.includes(id));
}

function optionalListMatch(allowed, actual) {
  return allowed.length === 0 || allowed.includes(actual);
}

function addAnyCondition(must, key, values) {
  if (values.length) must.push(matchAny(key, values));
}

function matchValue(key, value) {
  return { key, match: { value } };
}

function matchAny(key, any) {
  return { key, match: { any } };
}

function assertCompletedUpdate(payload, operation) {
  const status = payload?.result?.status;
  if (!(["completed", "acknowledged"].includes(status))) {
    throw invalidResponse(`Qdrant did not acknowledge the ${operation} operation.`);
  }
}

function operationId(payload) {
  const value = payload?.result?.operation_id;
  return Number.isInteger(value) ? value : null;
}

async function readBoundedText(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw invalidResponse("Qdrant response exceeded the maximum allowed size.");
  }
  return text;
}

function safeJsonObject(value, path) {
  if (!isObject(value)) throw invalidInput(`${path} must be an object.`);
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidInput(`${path} must be JSON serializable.`);
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    throw invalidInput(`${path} exceeds ${MAX_METADATA_BYTES} bytes.`);
  }
  return JSON.parse(serialized);
}

function normalizeIdList(value, path, { required = false, max = 128 } = {}) {
  if (value === undefined) {
    if (required) throw invalidInput(`${path} is required.`);
    return [];
  }
  if (!Array.isArray(value) || value.length > max || (required && value.length === 0)) {
    throw invalidInput(`${path} must be ${required ? "a non-empty" : "an"} array of identifiers.`);
  }
  return [...new Set(value.map((item) => safeId(item, path)))];
}

function normalizePointId(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && UUID.test(value)) return value.toLowerCase();
  throw invalidInput("point.id must be a non-negative integer or UUID.");
}

function normalizePublishState(value, path = "publishState") {
  return enumValue(value, PUBLISH_STATES, path);
}

function enumValue(value, allowed, path) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw invalidInput(`${path} is invalid.`);
  }
  return value;
}

function safeName(value, path) {
  if (!SAFE_NAME.test(value)) throw configurationError(`${path} is invalid.`);
  return value;
}

function safeId(value, path) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw invalidInput(`${path} must be a safe identifier.`);
  }
  return value;
}

function safeText(value, path, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw invalidInput(`${path} must be a non-empty string of at most ${max} characters.`);
  }
  return value;
}

function positiveInteger(value, path, { max }) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw invalidInput(`${path} must be an integer between 1 and ${max}.`);
  }
  return value;
}

function nonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${path} must be a non-negative integer.`);
  }
  return value;
}

function collectionPath(collection) {
  return `/collections/${encodeURIComponent(collection)}`;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeError(error) {
  return error instanceof EducationQdrantError
    ? error
    : new EducationQdrantError(
      "education_qdrant_unavailable",
      "Qdrant is unavailable.",
      { status: 503, retryable: true },
    );
}

function invalidInput(message) {
  return new EducationQdrantError(
    "education_qdrant_invalid_input",
    message,
    { status: 400 },
  );
}

function configurationError(message) {
  return new EducationQdrantError(
    "education_qdrant_invalid_configuration",
    message,
    { status: 500 },
  );
}

function invalidResponse(message) {
  return new EducationQdrantError(
    "education_qdrant_invalid_response",
    message,
    { status: 502 },
  );
}
