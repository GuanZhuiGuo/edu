import assert from "node:assert/strict";
import test from "node:test";

import {
  EducationQdrantError,
  buildQdrantAccessFilter,
  createEducationQdrantStore,
  educationQdrantPointId,
} from "../education-qdrant-store.js";

const ENV = Object.freeze({
  QDRANT_URL: "https://qdrant.example.test",
  QDRANT_API_KEY: "qdrant-test-token",
  QDRANT_EDUCATION_COLLECTION: "education_test",
});

const INDEX_FIELDS = [
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
  "acl_principal_ids",
  "entity_type",
  "namespace",
  "index_build_id",
  "subject",
  "grade_band",
  "page_index",
];

function collectionResult({
  denseSize = 3,
  sparseModifier = "idf",
  payloadSchema = Object.fromEntries(INDEX_FIELDS.map((field) => [field, {
    data_type: field === "page_index" ? "integer" : "keyword",
  }])),
} = {}) {
  return {
    status: "green",
    optimizer_status: "ok",
    config: {
      params: {
        vectors: { dense: { size: denseSize, distance: "Cosine" } },
        sparse_vectors: { sparse: { modifier: sparseModifier, index: { on_disk: true } } },
      },
    },
    payload_schema: payloadSchema,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function qdrantOk(result = { status: "completed", operation_id: 7 }) {
  return jsonResponse({ status: "ok", result });
}

function pointPayload(overrides = {}) {
  return {
    tenant_id: "tenant_1",
    course_id: "course_math",
    corpus_id: "corpus_math",
    release_id: "release_2026_08",
    record_id: "record_1",
    revision_id: "record_1:r1",
    document_id: "document_1",
    document_revision_id: "document_1:r1",
    publish_state: "staging",
    visibility: "tenant",
    entity_type: "source_chunk",
    namespace: "organization_course",
    index_build_id: "build_1",
    subject: "math",
    grade_band: "junior_secondary",
    title: "一次函数",
    content: "一次函数的一般形式是 y=kx+b。",
    page_index: 2,
    block_ids: ["block_1"],
    acl_principal_ids: [],
    ...overrides,
  };
}

async function readyStore(fetchImpl, options = {}) {
  const store = createEducationQdrantStore({
    env: { ...ENV, ...options.env },
    fetchImpl,
  });
  await store.ensureCollection({ denseSize: options.denseSize || 3 });
  return store;
}

test("fails closed when Qdrant is not configured", async () => {
  let calls = 0;
  const store = createEducationQdrantStore({
    env: {},
    fetchImpl: async () => {
      calls += 1;
      return qdrantOk();
    },
  });

  assert.deepEqual(store.configSummary().missing, ["QDRANT_URL"]);
  assert.equal(store.configSummary().configured, false);
  assert.equal((await store.health()).ok, false);
  await assert.rejects(
    store.ensureCollection({ denseSize: 3 }),
    (error) => error instanceof EducationQdrantError
      && error.code === "education_qdrant_not_configured",
  );
  assert.equal(calls, 0);
});

test("bootstraps a named dense+sparse collection and all filter indexes", async () => {
  const calls = [];
  let getCount = 0;
  const store = createEducationQdrantStore({
    env: ENV,
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: parsed, init, body });
      if (init.method === "GET" && parsed.pathname.endsWith("/collections/education_test")) {
        getCount += 1;
        return getCount === 1
          ? jsonResponse({ status: "error" }, 404)
          : jsonResponse({ status: "ok", result: collectionResult({ payloadSchema: {} }) });
      }
      return qdrantOk(init.method === "PUT" && parsed.pathname.endsWith("/education_test")
        ? true
        : undefined);
    },
  });

  const result = await store.ensureCollection({ denseSize: 3 });
  assert.equal(result.created, true);
  const create = calls.find((call) =>
    call.init.method === "PUT" && call.url.pathname.endsWith("/collections/education_test")
  );
  assert.deepEqual(create.body.vectors, {
    dense: { size: 3, distance: "Cosine" },
  });
  assert.equal(create.body.sparse_vectors.sparse.modifier, "idf");
  assert.equal(create.body.sparse_vectors.sparse.index.on_disk, true);
  assert.equal(create.body.on_disk_payload, true);
  assert.equal(Object.hasOwn(create.body, "payload"), false);
  const indexCalls = calls.filter((call) => call.url.pathname.endsWith("/index"));
  assert.equal(indexCalls.length, INDEX_FIELDS.length);
  assert.deepEqual(
    indexCalls.map((call) => call.body.field_name),
    INDEX_FIELDS,
  );
  assert.deepEqual(indexCalls[0].body.field_schema, { type: "keyword", is_tenant: true });
  assert.ok(calls.every((call) => call.init.headers["api-key"] === ENV.QDRANT_API_KEY));
  assert.equal(store.configSummary().authenticated, true);
  assert.equal(Object.hasOwn(store.configSummary(), "apiKey"), false);
});

test("rejects an existing collection with the wrong dense dimension", async () => {
  const store = createEducationQdrantStore({
    env: ENV,
    fetchImpl: async () => jsonResponse({
      status: "ok",
      result: collectionResult({ denseSize: 4 }),
    }),
  });
  await assert.rejects(
    store.ensureCollection({ denseSize: 3 }),
    (error) => error.code === "education_qdrant_collection_incompatible"
      && error.status === 409,
  );
});

test("upserts named dense+sparse vectors with deterministic UUID and ACL payload", async () => {
  const calls = [];
  const store = await readyStore(async (url, init) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ parsed, init, body });
    if (init.method === "GET") {
      return jsonResponse({ status: "ok", result: collectionResult() });
    }
    return qdrantOk();
  });

  const payload = pointPayload();
  const result = await store.upsertPoints([{
    dense: [0.1, 0.2, 0.3],
    sparse: { indices: [42, 1], values: [0.8, 0.2] },
    payload,
  }]);
  const call = calls.find((item) => item.parsed.pathname.endsWith("/points"));
  assert.equal(call.parsed.searchParams.get("wait"), "true");
  assert.equal(call.parsed.searchParams.get("ordering"), "medium");
  assert.deepEqual(call.body.points[0].vector.dense, [0.1, 0.2, 0.3]);
  assert.deepEqual(call.body.points[0].vector.sparse, {
    indices: [1, 42],
    values: [0.2, 0.8],
  });
  assert.equal(call.body.points[0].id, educationQdrantPointId(payload));
  assert.equal(call.body.points[0].payload.publish_state, "staging");
  assert.deepEqual(result.pointIds, [educationQdrantPointId(payload)]);
});

test("hybrid search uses identical ACL filters in both prefetches and top-level RRF", async () => {
  const calls = [];
  const accessiblePayload = pointPayload({ publish_state: "published" });
  const store = await readyStore(async (url, init) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ parsed, init, body });
    if (init.method === "GET") {
      return jsonResponse({ status: "ok", result: collectionResult() });
    }
    if (parsed.pathname.endsWith("/points/query")) {
      return qdrantOk({ points: [{ id: 11, score: 0.75, payload: accessiblePayload }] });
    }
    return qdrantOk();
  });

  const result = await store.hybridSearch({
    dense: [0.1, 0.2, 0.3],
    sparse: { indices: [1, 2], values: [1, 0.5] },
    filter: {
      tenantId: "tenant_1",
      courseIds: ["course_math"],
      corpusIds: ["corpus_math"],
      releaseIds: ["release_2026_08"],
      subjects: ["math"],
      indexBuildIds: ["build_1"],
    },
    limit: 8,
  });
  const query = calls.find((item) => item.parsed.pathname.endsWith("/points/query")).body;
  assert.deepEqual(query.query, { rrf: {} });
  assert.deepEqual(query.prefetch[0].filter, query.filter);
  assert.deepEqual(query.prefetch[1].filter, query.filter);
  assert.deepEqual(query.prefetch[0].params.idf.corpus, query.filter);
  assert.equal(query.prefetch[0].limit, 40);
  assert.equal(query.prefetch[1].limit, 40);
  assert.deepEqual(query.filter.must.slice(0, 5), [
    { key: "tenant_id", match: { value: "tenant_1" } },
    { key: "course_id", match: { any: ["course_math"] } },
    { key: "corpus_id", match: { any: ["corpus_math"] } },
    { key: "release_id", match: { any: ["release_2026_08"] } },
    { key: "publish_state", match: { any: ["published"] } },
  ]);
  assert.equal(result.fusion, "rrf");
  assert.equal(result.points.length, 1);
});

test("hybrid search reopens an existing collection read-only after a process restart", async () => {
  const calls = [];
  const accessiblePayload = pointPayload({ publish_state: "published" });
  const store = createEducationQdrantStore({
    env: ENV,
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ parsed, init, body });
      if (init.method === "GET" && parsed.pathname.endsWith("/collections/education_test")) {
        return jsonResponse({ status: "ok", result: collectionResult() });
      }
      if (init.method === "POST" && parsed.pathname.endsWith("/points/query")) {
        return qdrantOk({ points: [{ id: 11, score: 0.75, payload: accessiblePayload }] });
      }
      throw new Error(`Unexpected Qdrant call: ${init.method} ${parsed.pathname}`);
    },
  });

  const result = await store.hybridSearch({
    dense: [0.1, 0.2, 0.3],
    sparse: { indices: [1, 2], values: [1, 0.5] },
    filter: {
      tenantId: "tenant_1",
      courseIds: ["course_math"],
      corpusIds: ["corpus_math"],
      releaseIds: ["release_2026_08"],
    },
  });

  assert.equal(result.points.length, 1);
  assert.deepEqual(calls.map((call) => [call.init.method, call.parsed.pathname]), [
    ["GET", "/collections/education_test"],
    ["POST", "/collections/education_test/points/query"],
  ]);
  assert.equal(calls.some((call) => call.init.method === "PUT"), false);
  assert.equal(store.configSummary().denseSize, 3);
  await assert.rejects(
    store.upsertPoints([{
      dense: [0.1, 0.2, 0.3],
      sparse: { indices: [1], values: [1] },
      payload: pointPayload(),
    }]),
    (error) => error.code === "education_qdrant_collection_not_ready",
  );
});

test("hybrid search never creates a missing collection while reopening for reads", async () => {
  const calls = [];
  const store = createEducationQdrantStore({
    env: ENV,
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      calls.push({ parsed, init });
      return jsonResponse({ status: "error" }, 404);
    },
  });

  await assert.rejects(
    store.hybridSearch({
      dense: [0.1, 0.2, 0.3],
      sparse: { indices: [1], values: [1] },
      filter: {
        tenantId: "tenant_1",
        courseIds: ["course_math"],
        corpusIds: ["corpus_math"],
        releaseIds: ["release_2026_08"],
      },
    }),
    (error) => error.code === "education_qdrant_collection_missing"
      && error.status === 503,
  );
  assert.deepEqual(calls.map((call) => [call.init.method, call.parsed.pathname]), [
    ["GET", "/collections/education_test"],
  ]);
});

test("private records require principal ACL and returned payloads are checked again", async () => {
  const filter = buildQdrantAccessFilter({
    tenantId: "tenant_1",
    courseIds: ["course_math"],
    corpusIds: ["corpus_math"],
    releaseIds: ["release_2026_08"],
    principalIds: ["learner_1"],
  });
  const visibility = filter.must.at(-1);
  assert.deepEqual(visibility.should[1], {
    must: [
      { key: "visibility", match: { value: "private" } },
      { key: "acl_principal_ids", match: { any: ["learner_1"] } },
    ],
  });

  const store = await readyStore(async (url, init) => {
    const parsed = new URL(url);
    if (init.method === "GET") {
      return jsonResponse({ status: "ok", result: collectionResult() });
    }
    if (parsed.pathname.endsWith("/points/query")) {
      return qdrantOk({
        points: [{
          id: 9,
          score: 0.5,
          payload: pointPayload({
            publish_state: "published",
            visibility: "private",
            acl_principal_ids: ["another_learner"],
          }),
        }],
      });
    }
    return qdrantOk();
  });
  await assert.rejects(
    store.hybridSearch({
      dense: [0.1, 0.2, 0.3],
      sparse: { indices: [1], values: [1] },
      filter: {
        tenantId: "tenant_1",
        courseIds: ["course_math"],
        corpusIds: ["corpus_math"],
        releaseIds: ["release_2026_08"],
        principalIds: ["learner_1"],
      },
    }),
    (error) => error.code === "education_qdrant_acl_response_violation",
  );
});

test("access filters require an explicit corpus release and default to published", () => {
  assert.throws(
    () => buildQdrantAccessFilter({
      tenantId: "tenant_1",
      courseIds: ["course_math"],
      corpusIds: ["corpus_math"],
    }),
    (error) => error.code === "education_qdrant_invalid_input"
      && /releaseIds/u.test(error.message),
  );
  const filter = buildQdrantAccessFilter({
    tenantId: "tenant_1",
    courseIds: ["course_math"],
    corpusIds: ["corpus_math"],
    releaseIds: ["release_2026_08"],
  });
  assert.deepEqual(filter.must[4], {
    key: "publish_state",
    match: { any: ["published"] },
  });
});

test("deleteByRevision and setPublishState scope mutations by tenant and corpus release", async () => {
  const calls = [];
  const store = await readyStore(async (url, init) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ parsed, init, body });
    if (init.method === "GET") {
      return jsonResponse({ status: "ok", result: collectionResult() });
    }
    return qdrantOk();
  });

  await store.setPublishState({
    tenantId: "tenant_1",
    corpusId: "corpus_math",
    releaseId: "release_2026_08",
    fromPublishState: "staging",
    publishState: "published",
  });
  await store.deleteByRevision({
    tenantId: "tenant_1",
    documentRevisionId: "document_1:r1",
    publishState: "archived",
  });

  const publishCall = calls.find((item) => item.parsed.pathname.endsWith("/points/payload"));
  assert.equal(publishCall.parsed.searchParams.get("wait"), "true");
  assert.deepEqual(publishCall.body.payload, { publish_state: "published" });
  assert.deepEqual(publishCall.body.filter.must, [
    { key: "tenant_id", match: { value: "tenant_1" } },
    { key: "corpus_id", match: { value: "corpus_math" } },
    { key: "release_id", match: { value: "release_2026_08" } },
    { key: "publish_state", match: { value: "staging" } },
  ]);

  const deleteCall = calls.find((item) => item.parsed.pathname.endsWith("/points/delete"));
  assert.equal(deleteCall.parsed.searchParams.get("wait"), "true");
  assert.deepEqual(deleteCall.body.filter.must.at(-1), {
    key: "publish_state",
    match: { value: "archived" },
  });
});

test("health reports Qdrant and collection state without exposing credentials", async () => {
  const store = createEducationQdrantStore({
    env: ENV,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/healthz") return new Response("healthz check passed");
      return jsonResponse({ status: "ok", result: collectionResult() });
    },
  });
  const result = await store.health();
  assert.deepEqual(result, {
    ok: true,
    configured: true,
    collection: "education_test",
    collectionStatus: "green",
  });
});
