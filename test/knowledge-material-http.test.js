import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";

import {
  createArkClient,
  createArkClientSlot
} from "../ark-llm-client.js";
import { createKnowledgeMaterialHttpHandler } from "../knowledge-material-http.js";
import { generateKnowledgeMaterials } from "../knowledge-material-pipeline.js";

const SECRET = "server-secret-that-must-not-leak";

function createClient({
  configured = true,
  model = "ep-material-test",
  missing = []
} = {}) {
  return {
    configSummary() {
      return {
        configured,
        model,
        missing,
        baseUrl: "https://private-upstream.example/api/v3",
        apiKey: SECRET
      };
    }
  };
}

function generationResult(
  bundleId = "bundle_material_test",
  {
    questionId = "question_material_test",
    correctOption = "B",
    explanation = "质量不变时，合外力越大，加速度越大。"
  } = {}
) {
  return {
    material_bundle: {
      bundle_id: bundleId,
      analysis: { private_generation_trace: SECRET }
    },
    public_bundle: {
      bundle_id: bundleId,
      topic: {
        topic_id: "newton_second_law",
        title: "牛顿第二定律"
      },
      techniques: {
        openmaic: {
          quiz: {
            question_id: questionId,
            prompt: "质量不变时，合外力增大，加速度如何变化？",
            options: [
              { id: "A", value: "A", label: "减小" },
              { id: "B", value: "B", label: "增大" },
              { id: "C", value: "C", label: "不变" },
              { id: "D", value: "D", label: "无法判断" }
            ]
          }
        }
      },
      card_materials: [
        {
          material_id: "material_quiz",
          recommended_type: "quiz.single-choice",
          data: {
            question_id: questionId,
            prompt: "质量不变时，合外力增大，加速度如何变化？"
          }
        }
      ]
    },
    server_private: {
      bundle_id: bundleId,
      quiz_answers: [
        {
          question_id: questionId,
          correct_option: correctOption,
          explanation,
          claim_ids: ["claim_force"]
        }
      ]
    }
  };
}

async function startHttp(handler) {
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`
      );
      const handled = await handler(req, res, requestUrl);
      if (!handled && !res.writableEnded) {
        res.writeHead(404);
        res.end();
      }
    } catch {
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(500);
        res.end();
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`
  };
}

async function closeHttp(server) {
  if (!server.listening) return;
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function postJson(origin, path, body) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function createHandler(overrides = {}) {
  return createKnowledgeMaterialHttpHandler({
    client: overrides.client || createClient(),
    generateKnowledgeMaterials:
      overrides.generateKnowledgeMaterials ||
      (async () => generationResult()),
    authorizeConfigRequest: overrides.authorizeConfigRequest,
    authorizeTraceRequest: overrides.authorizeTraceRequest,
    configureApiKey: overrides.configureApiKey,
    privateBundles: overrides.privateBundles || new Map(),
    privateBundleLimit: overrides.privateBundleLimit,
    privateBundleTtlMs: overrides.privateBundleTtlMs,
    ttlMs: overrides.ttlMs,
    now: overrides.now
  });
}

async function readNdjson(response) {
  const text = await response.text();
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("streams sanitized generation trace and terminal result as NDJSON", async (t) => {
  const handler = createHandler({
    authorizeTraceRequest: () => true,
    generateKnowledgeMaterials: async (_input, { onTrace }) => {
      onTrace({
        type: "source.stage",
        stage: "deeptutor.spine_draft",
        status: "started",
        title: "生成 Spine 草案",
        message: "官方阶段已开始",
        meta: {
          api_key: SECRET,
          attempt: 1
        }
      });
      onTrace({
        type: "model.delta",
        stage: "deeptutor.spine_draft",
        status: "streaming",
        title: "模型流式输出",
        call_id: "llm_1",
        delta: "{\"chapters\":["
      });
      onTrace({
        type: "model.delta",
        stage: "deeptutor.spine_draft",
        status: "streaming",
        title: "模型流式输出",
        call_id: "llm_1",
        delta: "]}"
      });
      return generationResult("bundle_trace_success");
    }
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const response = await postJson(
    origin,
    "/api/knowledge/materials/generate/trace",
    {
      technique: "deeptutor",
      source_text:
        "用于验证服务端可以逐行返回源码阶段和模型流式增量，同时保留最终素材包。"
    }
  );
  const records = await readNdjson(response);

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") || "",
    /application\/x-ndjson/
  );
  assert.equal(records.at(-1).type, "result");
  assert.equal(
    records.at(-1).public_bundle.bundle_id,
    "bundle_trace_success"
  );
  const events = records
    .filter((record) => record.type === "trace")
    .map((record) => record.event);
  assert.equal(
    events.some(
      (event) =>
        event.stage === "deeptutor.spine_draft" &&
        event.status === "started"
    ),
    true
  );
  assert.equal(
    events
      .filter((event) => event.type === "model.delta")
      .map((event) => event.delta)
      .join(""),
    "{\"chapters\":[]}"
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [...events.keys()].map((index) => index + 1)
  );
  assert.equal(JSON.stringify(records).includes(SECRET), false);
});

test("trace endpoint keeps the exact failure code in its final stage", async (t) => {
  const handler = createHandler({
    authorizeTraceRequest: () => true,
    generateKnowledgeMaterials: async (_input, { onTrace }) => {
      onTrace({
        type: "model.request",
        stage: "openmaic.outlines",
        status: "started",
        title: "请求课堂大纲",
        call_id: "ai_1"
      });
      throw Object.assign(new Error("safe timeout"), {
        code: "ark_timeout",
        retryable: true
      });
    }
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const response = await postJson(
    origin,
    "/api/knowledge/materials/generate/trace",
    {
      technique: "openmaic",
      source_text:
        "用于验证模型失败时 Trace 能准确保留稳定错误码并返回公开错误说明。"
    }
  );
  const records = await readNdjson(response);
  const failureEvent = records
    .filter((record) => record.type === "trace")
    .map((record) => record.event)
    .find((event) => event.stage === "pipeline.failed");

  assert.equal(response.status, 200);
  assert.equal(failureEvent.status, "failed");
  assert.equal(failureEvent.meta.error_code, "ark_timeout");
  assert.deepEqual(records.at(-1), {
    type: "error",
    status: 502,
    error: "upstream_generation_failed",
    message: "知识点素材生成暂时失败，请稍后重试"
  });
});

test("trace endpoint can be restricted to the local workbench", async (t) => {
  const handler = createHandler({
    authorizeTraceRequest: () => false
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const response = await postJson(
    origin,
    "/api/knowledge/materials/generate/trace",
    {
      source_text:
        "用于验证实时生成 Trace 不会向未授权的远程请求公开内部阶段信息。"
    }
  );
  const payload = await readJson(response);

  assert.equal(response.status, 403);
  assert.equal(payload.error, "trace_forbidden");
});

test("trace endpoint fails closed when no authorizer is installed", async (t) => {
  const handler = createHandler();
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const response = await postJson(
    origin,
    "/api/knowledge/materials/generate/trace",
    {
      source_text:
        "用于验证未安装 Trace 授权器时，服务不会默认公开模型的原始流式输出。"
    }
  );
  const payload = await readJson(response);

  assert.equal(response.status, 403);
  assert.equal(payload.error, "trace_forbidden");
});

test("config exposes only configured, model and missing", async (t) => {
  const handler = createHandler({
    client: createClient({
      configured: false,
      missing: ["ARK_API_KEY"]
    })
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const response = await fetch(`${origin}/api/knowledge/materials/config`);
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(payload).sort(), [
    "configured",
    "missing",
    "model"
  ]);
  assert.deepEqual(payload, {
    configured: false,
    model: "ep-material-test",
    missing: ["ARK_API_KEY"]
  });
  assert.doesNotMatch(JSON.stringify(payload), /secret|baseUrl|upstream/i);
});

test("loopback runtime config updates the stable client used by generate", async (t) => {
  const runtimeKey = "ark-runtime-test-secret";
  const authorizationHeaders = [];
  const createRuntimeClient = (apiKey) => createArkClient({
    env: {
      ARK_API_KEY: apiKey,
      ARK_BASE_URL: "https://ark.example.test/api/v3",
      ARK_MODEL: "ep-runtime-material"
    },
    fetchImpl: async (_url, init) => {
      authorizationHeaders.push(init.headers.authorization);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "runtime-config-check",
            model: "ep-runtime-material",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "{\"ready\":true}"
                }
              }
            ]
          });
        }
      };
    },
    maxRetries: 0
  });
  const slot = createArkClientSlot(createRuntimeClient(""));
  let generatedWithConfiguredClient = false;
  const handler = createHandler({
    client: slot.client,
    authorizeConfigRequest: (req) =>
      req.socket.remoteAddress === "127.0.0.1",
    configureApiKey(apiKey) {
      slot.replace(createRuntimeClient(apiKey));
    },
    generateKnowledgeMaterials: async (_input, { client }) => {
      const probe = await client.generateJson({
        prompt: "验证运行时客户端已经切换"
      });
      generatedWithConfiguredClient = probe.ready === true;
      return generationResult();
    }
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const before = await readJson(
    await fetch(`${origin}/api/knowledge/materials/config`)
  );
  assert.deepEqual(before, {
    configured: false,
    model: "ep-runtime-material",
    missing: ["ARK_API_KEY"]
  });

  const configResponse = await postJson(
    origin,
    "/api/knowledge/materials/config",
    { api_key: runtimeKey }
  );
  const config = await readJson(configResponse);
  assert.equal(configResponse.status, 200);
  assert.deepEqual(config, {
    configured: true,
    model: "ep-runtime-material",
    missing: []
  });
  assert.deepEqual(Object.keys(config).sort(), [
    "configured",
    "missing",
    "model"
  ]);
  assert.equal(JSON.stringify(config).includes(runtimeKey), false);

  const generationResponse = await postJson(
    origin,
    "/api/knowledge/materials/generate",
    {
      source_text:
        "用于验证本机录入密钥后，素材生成会立即使用替换后的真实 Ark 客户端。"
    }
  );
  const generation = await readJson(generationResponse);
  assert.equal(generationResponse.status, 200);
  assert.equal(generatedWithConfiguredClient, true);
  assert.deepEqual(authorizationHeaders, [`Bearer ${runtimeKey}`]);
  assert.equal(JSON.stringify(generation).includes(runtimeKey), false);
});

test("runtime config rejects non-loopback requests before accepting a key", async (t) => {
  let configureCalls = 0;
  const handler = createHandler({
    authorizeConfigRequest: () => false,
    configureApiKey() {
      configureCalls += 1;
    }
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const response = await postJson(
    origin,
    "/api/knowledge/materials/config",
    { api_key: SECRET }
  );
  const payload = await readJson(response);

  assert.equal(response.status, 403);
  assert.equal(payload.error, "config_forbidden");
  assert.equal(configureCalls, 0);
  assert.equal(JSON.stringify(payload).includes(SECRET), false);
});

test("runtime config accepts only one bounded non-empty api_key", async (t) => {
  let configureCalls = 0;
  const handler = createHandler({
    authorizeConfigRequest: () => true,
    configureApiKey() {
      configureCalls += 1;
    }
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const invalidInputs = [
    {},
    { api_key: "" },
    { api_key: "   " },
    { api_key: "key with spaces" },
    { api_key: "k".repeat(513) },
    { api_key: "valid-looking-key", extra: true }
  ];
  for (const input of invalidInputs) {
    const response = await postJson(
      origin,
      "/api/knowledge/materials/config",
      input
    );
    const payload = await readJson(response);
    assert.equal(response.status, 400);
    assert.equal(payload.error, "invalid_api_key");
    const submittedKey = typeof input.api_key === "string"
      ? input.api_key.trim()
      : "";
    if (submittedKey) {
      assert.equal(JSON.stringify(payload).includes(submittedKey), false);
    }
  }

  const oversizedResponse = await postJson(
    origin,
    "/api/knowledge/materials/config",
    { api_key: "k".repeat(2500) }
  );
  const oversized = await readJson(oversizedResponse);
  assert.equal(oversizedResponse.status, 413);
  assert.equal(oversized.error, "payload_too_large");
  assert.equal(configureCalls, 0);
});

test("runtime config failure returns a stable response without the key", async (t) => {
  const runtimeKey = "ark-rejected-runtime-secret";
  const handler = createHandler({
    authorizeConfigRequest: () => true,
    configureApiKey(apiKey) {
      throw new Error(`upstream rejected ${apiKey}`);
    }
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const response = await postJson(
    origin,
    "/api/knowledge/materials/config",
    { api_key: runtimeKey }
  );
  const payload = await readJson(response);
  assert.equal(response.status, 500);
  assert.deepEqual(payload, {
    error: "config_update_failed",
    message: "Ark 密钥配置失败，请检查后重试"
  });
  assert.equal(JSON.stringify(payload).includes(runtimeKey), false);
});

test("real Ark and pipeline wiring maps missing configuration to 503", async (t) => {
  let fetchCalls = 0;
  const client = createArkClient({
    env: {
      ARK_API_KEY: "",
      ARK_BASE_URL: "https://ark.example.test/api/v3",
      ARK_MODEL: "ep-material-test"
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run without ARK_API_KEY");
    }
  });
  const handler = createKnowledgeMaterialHttpHandler({
    client,
    generateKnowledgeMaterials
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const response = await postJson(
    origin,
    "/api/knowledge/materials/generate",
    {
      source_text:
        "牛顿第二定律说明物体加速度与所受合外力成正比，与质量成反比。",
      language: "zh-CN"
    }
  );
  const payload = await readJson(response);

  assert.equal(response.status, 503);
  assert.deepEqual(payload, {
    error: "ark_not_configured",
    message: "Ark 模型尚未配置，请先在本机录入 API Key"
  });
  assert.equal(fetchCalls, 0);
});

test("generate returns only public data and grade uses server-private answers", async (t) => {
  const privateBundles = new Map();
  let receivedSignal;
  let receivedInput;
  const handler = createHandler({
    privateBundles,
    generateKnowledgeMaterials: async (input, options) => {
      receivedInput = input;
      receivedSignal = options.signal;
      return generationResult();
    }
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const generationResponse = await postJson(
    origin,
    "/api/knowledge/materials/generate",
    {
      source_text:
        "牛顿第二定律说明物体加速度与合外力成正比，与质量成反比。",
      language: "zh-CN"
    }
  );
  const generation = await readJson(generationResponse);

  assert.equal(generationResponse.status, 200);
  assert.deepEqual(Object.keys(generation).sort(), [
    "provider",
    "public_bundle"
  ]);
  assert.deepEqual(generation.provider, {
    type: "ark",
    model: "ep-material-test"
  });
  assert.equal(receivedInput.language, "zh-CN");
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(privateBundles.size, 1);
  assert.deepEqual(
    privateBundles.get("bundle_material_test"),
    {
      bundle_id: "bundle_material_test",
      quiz_answers: [
        {
          question_id: "question_material_test",
          correct_option: "B",
          explanation: "质量不变时，合外力越大，加速度越大。"
        }
      ]
    }
  );
  const publicText = JSON.stringify(generation);
  assert.doesNotMatch(
    publicText,
    /server_private|material_bundle|correct_option|correct_answer|answer_key/
  );
  assert.equal(publicText.includes(SECRET), false);

  const wrongResponse = await postJson(
    origin,
    "/api/knowledge/materials/grade",
    {
      bundle_id: "bundle_material_test",
      question_id: "question_material_test",
      selected: "A"
    }
  );
  const wrong = await readJson(wrongResponse);
  assert.equal(wrongResponse.status, 200);
  assert.deepEqual(wrong, {
    correct: false,
    attempts_remaining: 1
  });
  assert.equal(JSON.stringify(wrong).includes("增大"), false);
  assert.equal(Object.hasOwn(wrong, "explanation"), false);

  const correctResponse = await postJson(
    origin,
    "/api/knowledge/materials/grade",
    {
      bundle_id: "bundle_material_test",
      question_id: "question_material_test",
      selected: "B"
    }
  );
  const correct = await readJson(correctResponse);
  assert.deepEqual(correct, {
    correct: true,
    explanation: "质量不变时，合外力越大，加速度越大。",
    attempts_remaining: 0
  });
  assert.equal(Object.hasOwn(correct, "correct_option"), false);

  const closedResponse = await postJson(
    origin,
    "/api/knowledge/materials/grade",
    {
      bundle_id: "bundle_material_test",
      question_id: "question_material_test",
      selected: "C"
    }
  );
  const closed = await readJson(closedResponse);
  assert.equal(closedResponse.status, 409);
  assert.equal(closed.error, "question_closed");
  assert.equal(Object.hasOwn(closed, "explanation"), false);
  assert.equal(JSON.stringify(closed).includes("correct_option"), false);
});

test("grade permits one retry but blocks four-option enumeration", async (t) => {
  const handler = createHandler();
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const generationResponse = await postJson(
    origin,
    "/api/knowledge/materials/generate",
    {
      source_text:
        "用于验证服务端判题限制枚举攻击，同时保留一次合理重试机会的测试文本。"
    }
  );
  assert.equal(generationResponse.status, 200);
  await generationResponse.body?.cancel();

  const firstWrongResponse = await postJson(
    origin,
    "/api/knowledge/materials/grade",
    {
      bundle_id: "bundle_material_test",
      question_id: "question_material_test",
      selected: "A"
    }
  );
  const firstWrong = await readJson(firstWrongResponse);
  assert.deepEqual(firstWrong, {
    correct: false,
    attempts_remaining: 1
  });

  const secondWrongResponse = await postJson(
    origin,
    "/api/knowledge/materials/grade",
    {
      bundle_id: "bundle_material_test",
      question_id: "question_material_test",
      selected: "C"
    }
  );
  const secondWrong = await readJson(secondWrongResponse);
  assert.deepEqual(secondWrong, {
    correct: false,
    attempts_remaining: 0
  });

  for (const selected of ["B", "D"]) {
    const blockedResponse = await postJson(
      origin,
      "/api/knowledge/materials/grade",
      {
        bundle_id: "bundle_material_test",
        question_id: "question_material_test",
        selected
      }
    );
    const blocked = await readJson(blockedResponse);
    assert.equal(blockedResponse.status, 409);
    assert.deepEqual(blocked, {
      error: "question_closed",
      message: "该题作答已结束，请重新生成素材后再试"
    });
    const responseText = JSON.stringify(blocked);
    assert.equal(responseText.includes("增大"), false);
    assert.equal(responseText.includes("correct_option"), false);
    assert.equal(Object.hasOwn(blocked, "explanation"), false);
  }
});

test("grade rejects forged fields and unknown private records", async (t) => {
  const handler = createHandler();
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const forgedResponse = await postJson(
    origin,
    "/api/knowledge/materials/grade",
    {
      bundle_id: "bundle_material_test",
      question_id: "question_material_test",
      selected: "A",
      correct_option: "A"
    }
  );
  assert.equal(forgedResponse.status, 400);
  assert.equal((await readJson(forgedResponse)).error, "invalid_input");

  const missingResponse = await postJson(
    origin,
    "/api/knowledge/materials/grade",
    {
      bundle_id: "bundle_missing",
      question_id: "question_material_test",
      selected: "A"
    }
  );
  const missing = await readJson(missingResponse);
  assert.equal(missingResponse.status, 404);
  assert.equal(missing.error, "bundle_not_found");
  assert.equal(JSON.stringify(missing).includes("correct_option"), false);
});

test("private generation storage is capped at thirty bundles", async (t) => {
  const privateBundles = new Map();
  const handler = createHandler({
    privateBundles,
    generateKnowledgeMaterials: async (input) =>
      generationResult(`bundle_${input.source_id}`)
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  for (let index = 0; index < 31; index += 1) {
    const response = await postJson(
      origin,
      "/api/knowledge/materials/generate",
      {
        source_text:
          "用于验证服务端私有答案缓存上限的完整知识点素材测试文本。",
        source_id: String(index)
      }
    );
    assert.equal(response.status, 200);
    await response.body?.cancel();
  }

  assert.equal(privateBundles.size, 30);
  assert.equal(privateBundles.has("bundle_0"), false);
  assert.equal(privateBundles.has("bundle_30"), true);
});

test("private answers expire after the configured TTL", async (t) => {
  let clock = 10_000;
  const privateBundles = new Map();
  const handler = createHandler({
    privateBundles,
    ttlMs: 100,
    now: () => clock
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const generationResponse = await postJson(
    origin,
    "/api/knowledge/materials/generate",
    {
      source_text:
        "用于验证私有答案会在有效期结束后从服务端内存中清理的测试文本。"
    }
  );
  assert.equal(generationResponse.status, 200);
  await generationResponse.body?.cancel();
  assert.equal(privateBundles.size, 1);

  clock = 10_099;
  const activeResponse = await postJson(
    origin,
    "/api/knowledge/materials/grade",
    {
      bundle_id: "bundle_material_test",
      question_id: "question_material_test",
      selected: "B"
    }
  );
  assert.equal(activeResponse.status, 200);
  await activeResponse.body?.cancel();

  clock = 10_100;
  const expiredResponse = await postJson(
    origin,
    "/api/knowledge/materials/grade",
    {
      bundle_id: "bundle_material_test",
      question_id: "question_material_test",
      selected: "B"
    }
  );
  assert.equal(expiredResponse.status, 404);
  assert.equal((await readJson(expiredResponse)).error, "bundle_not_found");
  assert.equal(privateBundles.size, 0);
});

test("strict JSON input and pipeline failures use stable secret-free errors", async (t) => {
  const handler = createHandler({
    generateKnowledgeMaterials: async (input) => {
      if (input.source_id === "not_configured") {
        const cause = Object.assign(new Error(`bad key ${SECRET}`), {
          code: "ark_not_configured"
        });
        const error = Object.assign(new Error(`wrapper ${SECRET}`), {
          code: "ARK_GENERATION_FAILED",
          cause
        });
        throw error;
      }
      if (input.source_id === "invalid_input") {
        throw Object.assign(new Error(`invalid ${SECRET}`), {
          code: "INVALID_INPUT"
        });
      }
      if (input.source_id === "invalid_output") {
        throw Object.assign(new Error(`invalid stage ${SECRET}`), {
          code: "INVALID_STAGE_OUTPUT"
        });
      }
      if (input.source_id === "public_leak") {
        const result = generationResult();
        result.public_bundle.correct_option = SECRET;
        return result;
      }
      throw new Error(`upstream ${SECRET}`);
    }
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const invalidJsonResponse = await fetch(
    `${origin}/api/knowledge/materials/generate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    }
  );
  assert.equal(invalidJsonResponse.status, 400);
  assert.equal((await readJson(invalidJsonResponse)).error, "invalid_input");

  const wrongContentType = await fetch(
    `${origin}/api/knowledge/materials/generate`,
    {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}"
    }
  );
  assert.equal(wrongContentType.status, 400);

  const oversizedResponse = await postJson(
    origin,
    "/api/knowledge/materials/generate",
    {
      source_text: "大".repeat(100_000)
    }
  );
  assert.equal(oversizedResponse.status, 413);
  assert.equal(
    (await readJson(oversizedResponse)).error,
    "payload_too_large"
  );

  const expectations = [
    ["not_configured", 503, "ark_not_configured"],
    ["invalid_input", 400, "invalid_input"],
    ["invalid_output", 502, "upstream_validation_failed"],
    ["public_leak", 502, "upstream_validation_failed"],
    ["upstream", 502, "upstream_generation_failed"]
  ];
  for (const [sourceId, status, code] of expectations) {
    const response = await postJson(
      origin,
      "/api/knowledge/materials/generate",
      {
        source_text:
          "用于验证错误状态映射且不会泄露服务端密钥的完整素材文本。",
        source_id: sourceId
      }
    );
    const payload = await readJson(response);
    assert.equal(response.status, status);
    assert.equal(payload.error, code);
    assert.equal(JSON.stringify(payload).includes(SECRET), false);
    assert.equal(Object.hasOwn(payload, "cause"), false);
  }
});

test("native upstream results identify their source runtime and map repetitive input to 422", async (t) => {
  const handler = createHandler({
    generateKnowledgeMaterials: async (input) => {
      if (input.source_id === "repetitive") {
        const cause = Object.assign(new Error(`quality ${SECRET}`), {
          code: "SOURCE_TOO_REPETITIVE"
        });
        throw Object.assign(new Error(`wrapper ${SECRET}`), {
          code: "SOURCE_ADAPTER_FAILED",
          cause
        });
      }
      return {
        public_bundle: {
          bundle_id: "native_deeptutor_bundle",
          pipeline_version: "3.0-upstream-native",
          selected_technique: "deeptutor",
          execution: {
            mode: "upstream_native",
            model_used: true
          },
          source_result: {
            book: { id: "book_native", title: "牛顿第二定律" },
            spine: { book_id: "book_native", chapters: [] },
            pages: []
          }
        },
        server_private: {
          bundle_id: "native_deeptutor_bundle",
          quiz_answers: []
        }
      };
    }
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const nativeResponse = await postJson(
    origin,
    "/api/knowledge/materials/generate",
    {
      source_text:
        "牛顿第二定律说明加速度由物体受到的合外力和质量共同决定。"
    }
  );
  const nativePayload = await readJson(nativeResponse);
  assert.equal(nativeResponse.status, 200);
  assert.deepEqual(nativePayload.provider, {
    type: "upstream_source",
    model: "ep-material-test",
    source: "deeptutor",
    model_used: true
  });
  assert.equal("a2ui" in nativePayload.public_bundle, false);

  const repetitiveResponse = await postJson(
    origin,
    "/api/knowledge/materials/generate",
    {
      source_text:
        "牛顿第二定律说明加速度由物体受到的合外力和质量共同决定。",
      source_id: "repetitive"
    }
  );
  const repetitivePayload = await readJson(repetitiveResponse);
  assert.equal(repetitiveResponse.status, 422);
  assert.equal(repetitivePayload.error, "SOURCE_TOO_REPETITIVE");
  assert.equal(JSON.stringify(repetitivePayload).includes(SECRET), false);
});

test("disconnecting a generate request aborts the pipeline and stores nothing", async (t) => {
  const privateBundles = new Map();
  let markStarted;
  let markAborted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const aborted = new Promise((resolve) => {
    markAborted = resolve;
  });
  const handler = createHandler({
    privateBundles,
    generateKnowledgeMaterials: async (_input, { signal }) => {
      markStarted();
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          markAborted();
          reject(Object.assign(new Error("aborted"), {
            code: "GENERATION_ABORTED"
          }));
        };
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  });
  const { server, origin } = await startHttp(handler);
  t.after(() => closeHttp(server));

  const target = new URL("/api/knowledge/materials/generate", origin);
  const body = JSON.stringify({
    source_text:
      "用于验证浏览器断开连接时服务端会终止真实模型管线的完整测试文本。"
  });
  const clientRequest = httpRequest({
    hostname: target.hostname,
    port: target.port,
    path: target.pathname,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body)
    }
  });
  clientRequest.on("error", () => {});
  clientRequest.end(body);

  await started;
  clientRequest.destroy();
  await Promise.race([
    aborted,
    new Promise((_resolve, reject) => {
      setTimeout(
        () => reject(new Error("pipeline abort was not observed")),
        1000
      );
    })
  ]);
  assert.equal(privateBundles.size, 0);
});
