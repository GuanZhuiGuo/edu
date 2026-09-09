import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createEducationSettingsHttpHandler } from "../education-settings-http.js";
import { createEducationDataRuntime } from "../education-data-runtime.js";
import { createEducationDataService } from "../education-data-service.js";
import { createEducationRuntimeSettingsRepository } from "../education-runtime-settings.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function responseCapture() {
  return {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body += body; },
  };
}

test("settings summary exposes ontology, model, storage and card contracts without credentials", async () => {
  const handler = createEducationSettingsHttpHandler({
    authorizeRequest: () => true,
    importService: { configSummary: () => ({ limits: { maxPages: 300, maxFileBytes: 52_428_800 } }) },
    modelClient: { configSummary: () => ({ configured: true, visionModel: "vision-model", textModel: "text-model", embeddingModel: "embedding-model", apiKey: "must-not-leak" }) },
    mediaClient: { configSummary: () => ({ seedream: { configured: true, model: "seedream-model" }, seedance: { configured: true, model: "seedance-model" }, apiKey: "second-secret" }) },
    vectorStore: { configSummary: () => ({ provider: "qdrant", configured: true, collection: "education" }) },
    graphStore: { configSummary: () => ({ provider: "neo4j", configured: true, database: "neo4j" }) },
    dataService: { summary: ({ tenantId }) => ({ storage: "sqlite", tenant_id: tenantId, counts: { students: 3, questions: 420 } }) },
    dataTenantId: "local-demo",
    runtime: { voiceModel: "voice-model", voiceConfigured: true, semanticBatchPages: 24 },
  });
  const res = responseCapture();
  const handled = await handler({ method: "GET" }, res, new URL("http://localhost/api/education/settings/summary"));
  assert.equal(handled, true);
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.schema_version, "education-settings-summary@1.0");
  assert.ok(payload.ontology.entity_types.includes("knowledge_point"));
  assert.ok(payload.ontology.relation_types.includes("prerequisite_of"));
  assert.equal(payload.ontology.limits.semantic_batch_pages, 24);
  assert.equal(payload.models.find((item) => item.id === "multimodal_embedding").model, "embedding-model");
  assert.equal(payload.models.find((item) => item.id === "teaching_visual_generation").model, "seedream-model");
  assert.equal(payload.models.find((item) => item.id === "teaching_video_generation").model, "seedance-model");
  assert.equal(payload.storage.vector.configured, true);
  assert.deepEqual(payload.storage.application.counts, { students: 3, questions: 420 });
  assert.equal(payload.cards.envelope_protocol, "A2UI v0.9");
  assert.equal(res.body.includes("must-not-leak"), false);
  assert.equal(res.body.includes("second-secret"), false);
  assert.equal(res.body.toLowerCase().includes("apikey"), false);
});

test("settings summary is loopback-authorized and read-only", async () => {
  const forbidden = createEducationSettingsHttpHandler({ authorizeRequest: () => false });
  const forbiddenRes = responseCapture();
  await forbidden({ method: "GET" }, forbiddenRes, new URL("http://localhost/api/education/settings/summary"));
  assert.equal(forbiddenRes.status, 403);

  const allowed = createEducationSettingsHttpHandler({ authorizeRequest: () => true });
  const methodRes = responseCapture();
  await allowed({ method: "POST" }, methodRes, new URL("http://localhost/api/education/settings/summary"));
  assert.equal(methodRes.status, 405);
});

test("mastery policy endpoint persists validated edits and enforces mutation authorization", async () => {
  const runtime = createEducationDataRuntime({
    env: { EDUCATION_DATA_SEED_DEMO: "true" },
    storeOptions: { filename: ":memory:" },
  });
  try {
    const dataService = createEducationDataService({ store: runtime.store });
    const handler = createEducationSettingsHttpHandler({
      authorizeRequest: () => true,
      authorizeMutation: () => true,
      resolveActor: () => "teacher:test",
      dataService,
      dataTenantId: runtime.tenantId,
    });
    const firstRes = responseCapture();
    await handler({ method: "GET" }, firstRes, new URL("http://localhost/api/education/settings/mastery"));
    const first = JSON.parse(firstRes.body);
    assert.equal(firstRes.status, 200);
    assert.equal(first.policy.enabled, true);
    assert.ok(first.evidence.by_class.demo.count > 0);

    const policy = {
      ...first.policy,
      thresholds: { mastered: 0.92, secure: 0.73, learning: 0.41 },
    };
    const req = Readable.from([Buffer.from(JSON.stringify({
      expected_version: first.config_version,
      policy,
    }))]);
    req.method = "PUT";
    const updateRes = responseCapture();
    await handler(req, updateRes, new URL("http://localhost/api/education/settings/mastery"));
    const updated = JSON.parse(updateRes.body);
    assert.equal(updateRes.status, 200);
    assert.equal(updated.config_version, 2);
    assert.equal(updated.policy.thresholds.mastered, 0.92);
    assert.equal(updated.updated_by, "teacher:test");

    const forbiddenHandler = createEducationSettingsHttpHandler({
      authorizeRequest: () => true,
      authorizeMutation: () => false,
      dataService,
      dataTenantId: runtime.tenantId,
    });
    const deniedReq = Readable.from([Buffer.from("{}")]);
    deniedReq.method = "PUT";
    const deniedRes = responseCapture();
    await forbiddenHandler(deniedReq, deniedRes, new URL("http://localhost/api/education/settings/mastery"));
    assert.equal(deniedRes.status, 403);
  } finally {
    runtime.store.close();
  }
});

test("runtime settings endpoint persists partial edits and never returns secrets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "education-settings-http-"));
  try {
    const runtimeSettings = createEducationRuntimeSettingsRepository({
      filename: join(directory, "runtime-settings.json"),
      env: { ARK_API_KEY: "ark-secret-never-return" },
    });
    const handler = createEducationSettingsHttpHandler({
      authorizeRequest: () => true,
      authorizeMutation: () => true,
      resolveActor: () => "teacher:http-test",
      runtimeSettings,
    });
    const firstRes = responseCapture();
    await handler({ method: "GET" }, firstRes, new URL("http://localhost/api/education/settings/runtime"));
    const first = JSON.parse(firstRes.body);
    assert.equal(firstRes.status, 200);
    assert.equal(first.agent_proxy.enabled, false);
    assert.equal(first.models.chat.api_key.configured, true);
    assert.equal(firstRes.body.includes("ark-secret-never-return"), false);

    const req = Readable.from([Buffer.from(JSON.stringify({
      expected_version: first.config_version,
      agent_proxy: {
        enabled: true,
        endpoint: "https://agent.example.com/conversation/chat",
        api_key: "agent-secret-never-return",
      },
    }))]);
    req.method = "PUT";
    const updateRes = responseCapture();
    await handler(req, updateRes, new URL("http://localhost/api/education/settings/runtime"));
    const updated = JSON.parse(updateRes.body);
    assert.equal(updateRes.status, 200);
    assert.equal(updated.config_version, 2);
    assert.equal(updated.agent_proxy.enabled, true);
    assert.equal(updated.agent_proxy.api_key.has_key, true);
    assert.equal(updateRes.body.includes("agent-secret-never-return"), false);
    assert.equal(runtimeSettings.getAgentProxyConfig().api_key, "agent-secret-never-return");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
