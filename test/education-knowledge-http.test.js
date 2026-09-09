import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createEducationKnowledgeHttpHandler } from "../education-knowledge-http.js";
import { createEducationKnowledgeConnectionMonitor } from "../education-knowledge-connections.js";

const identity = {
  tenant_id: "tenant-server",
  principal_id: "reviewer-server",
  read_principal_ids: ["reviewer-server", "student-a"],
  write_principal_ids: ["reviewer-server"],
  allowed_course_ids: ["course-a", "shared_curriculum"],
};

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
    json() { return JSON.parse(this.body); },
  };
}

function fixture() {
  const calls = [];
  const vectorStore = {
    configSummary: () => ({ configured: true, collection: "edu", denseVectorName: "dense", sparseVectorName: "sparse" }),
    health: async () => ({ ok: true, configured: true, collection: "edu" }),
  };
  const graphStore = {
    configSummary: () => ({ configured: true, database: "neo4j" }),
    health: async () => ({ ok: true, configured: true, database: "neo4j" }),
    resolveActiveRelease: async (input) => { calls.push(["active", input]); return { release_id: "release-a", status: "active" }; },
  };
  const publicationService = {
    publishImport: async (jobId, input) => { calls.push(["publish", jobId, input]); return { status: "active", release_id: "release-a" }; },
  };
  const retrievalService = {
    search: async (input) => { calls.push(["search", input]); return { status: "retrieved", hits: [] }; },
  };
  const handler = createEducationKnowledgeHttpHandler({
    publicationService,
    retrievalService,
    vectorStore,
    graphStore,
    authorizeRequest: () => true,
    resolveIdentity: () => identity,
  });
  return { calls, handler };
}

test("publishes with server identity and ignores browser tenant/release fields", async () => {
  const { calls, handler } = fixture();
  const req = request("POST", "/api/education/imports/import-12345678/publish", {
    namespace: "organization_course",
    course_id: "course-a",
    tenant_id: "attacker",
    release_id: "attacker-release",
  });
  const res = response();
  assert.equal(await handler(req, res, new URL(req.url, "http://127.0.0.1:3042")), true);
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0][2].tenantId, "tenant-server");
  assert.equal(calls[0][2].principalId, "reviewer-server");
  assert.equal(Object.hasOwn(calls[0][2], "releaseId"), false);
});

test("search is scoped to the authenticated tenant and selected allowed course", async () => {
  const { calls, handler } = fixture();
  const req = request("POST", "/api/education/retrieval/search", {
    query: "什么是一次函数",
    course_id: "course-a",
    namespace: "organization_course",
    tenant_id: "attacker",
    release_id: "attacker-release",
  });
  const res = response();
  await handler(req, res, new URL(req.url, "http://127.0.0.1:3042"));
  assert.equal(res.statusCode, 200);
  const input = calls.find(([name]) => name === "search")[1];
  assert.equal(input.tenantId, "tenant-server");
  assert.equal(input.corpusId, "course-a");
  assert.equal(Object.hasOwn(input, "releaseId"), false);
});

test("rejects a course outside the server-side allowlist", async () => {
  const { calls, handler } = fixture();
  const req = request("POST", "/api/education/retrieval/search", {
    query: "勾股定理",
    course_id: "course-b",
  });
  const res = response();
  await handler(req, res, new URL(req.url, "http://127.0.0.1:3042"));
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, "education_knowledge_course_forbidden");
  assert.equal(calls.length, 0);
});

test("config and health expose capability state without credentials", async () => {
  const { handler } = fixture();
  for (const path of ["/api/education/knowledge/config", "/api/education/knowledge/health"]) {
    const req = request("GET", path);
    const res = response();
    await handler(req, res, new URL(req.url, "http://127.0.0.1:3042"));
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.stringify(res.json()).includes("password"), false);
    assert.equal(JSON.stringify(res.json()).includes("apiKey"), false);
  }
});

test("health checks the configured collection and reports a missing collection", async () => {
  const calls = [];
  const vectorStore = {
    configSummary: () => ({ configured: true, collection: "edu" }),
    health: async (options) => {
      calls.push(["vector-health", options]);
      return {
        ok: false,
        configured: true,
        code: "education_qdrant_collection_missing",
        collection: "edu",
      };
    },
  };
  const graphStore = {
    configSummary: () => ({ configured: true, database: "neo4j" }),
    health: async () => ({ ok: true, configured: true, database: "neo4j" }),
  };
  const handler = createEducationKnowledgeHttpHandler({
    publicationService: { publishImport: async () => ({ status: "active" }) },
    retrievalService: { search: async () => ({ status: "retrieved", hits: [] }) },
    vectorStore,
    graphStore,
    authorizeRequest: () => true,
    resolveIdentity: () => identity,
  });
  const req = request("GET", "/api/education/knowledge/health");
  const res = response();

  await handler(req, res, new URL(req.url, "http://127.0.0.1:3042"));

  assert.equal(res.statusCode, 503);
  assert.equal(res.json().ok, false);
  assert.equal(res.json().vector.code, "education_qdrant_collection_missing");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].includeCollection, true);
  assert.ok(calls[0][1].signal instanceof AbortSignal);
});

test("connections returns a safe degraded receipt with HTTP 200 and forwards refresh to the shared monitor", async () => {
  let checks = 0;
  let time = 100_000;
  const graphStore = {
    configSummary: () => ({ configured: true, uri: "bolt://private-host", password: "secret" }),
    health: async () => { checks++; throw new Error("secret"); },
  };
  const vectorStore = { configSummary: () => ({ configured: true }), health: async () => ({ ok: true }) };
  const monitor = createEducationKnowledgeConnectionMonitor({ graphStore, vectorStore, now: () => time });
  const handler = createEducationKnowledgeHttpHandler({
    connectionMonitor: monitor, authorizeRequest: () => true,
  });
  for (const suffix of ["", "?refresh=1"]) {
    const req = request("GET", `/api/education/knowledge/connections${suffix}`);
    const res = response();
    await handler(req, res, new URL(req.url, "http://127.0.0.1:3042"));
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().overall, "degraded");
    assert.equal(res.json().retrieval.mode, "local_reviewed");
    assert.equal(res.json().components.qdrant.status, "healthy");
    assert.ok(!res.body.includes("private-host") && !res.body.includes("secret"));
    time += 5_001;
  }
  assert.equal(checks, 2);
  monitor.close();
});

test("connection status remains behind the existing authorization boundary", async () => {
  let checked = false;
  const handler = createEducationKnowledgeHttpHandler({
    authorizeRequest: () => false,
    connectionMonitor: { getStatus: () => { checked = true; } },
  });
  const req = request("GET", "/api/education/knowledge/connections?refresh=1");
  const res = response();
  await handler(req, res, new URL(req.url, "http://127.0.0.1:3042"));
  assert.equal(res.statusCode, 403);
  assert.equal(checked, false);
});
