import test from "node:test";
import assert from "node:assert/strict";

import {
  ArkClientError,
  createArkClient,
  createArkClientSlot,
  createArkLlmClient,
} from "../ark-llm-client.js";

const configuredEnv = Object.freeze({
  ARK_API_KEY: "test-secret-key",
  ARK_BASE_URL: "https://ark.example.test/api/v3/",
  ARK_MODEL: "ep-test-endpoint",
});

function jsonResponse(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] ?? null;
      },
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function completion(content, overrides = {}) {
  return {
    id: "chatcmpl-test",
    model: "ep-test-endpoint",
    choices: [
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content,
        },
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
    ...overrides,
  };
}

function streamChunk(content, {
  id = "chatcmpl-stream",
  model = "ep-test-endpoint",
  finishReason = null,
} = {}) {
  return `data: ${JSON.stringify({
    id,
    model,
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: content === undefined ? { role: "assistant" } : { content },
        finish_reason: finishReason,
      },
    ],
  })}\r\n\r\n`;
}

function usageChunk(usage) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-stream",
    model: "ep-test-endpoint",
    object: "chat.completion.chunk",
    choices: [],
    usage,
  })}\r\n\r\n`;
}

function splitUtf8(value, pattern = [1, 2, 5, 3, 8]) {
  const bytes = new TextEncoder().encode(value);
  const chunks = [];
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    const length = pattern[index % pattern.length];
    chunks.push(bytes.slice(offset, offset + length));
    offset += length;
    index += 1;
  }
  return chunks;
}

function sseResponse(chunks, status = 200) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : chunk,
        );
      }
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type"
          ? "text/event-stream; charset=utf-8"
          : null;
      },
    },
    body,
  };
}

test("reports ark_not_configured without exposing credentials", async () => {
  let fetchCalls = 0;
  const client = createArkClient({
    env: {},
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse(completion("{}"));
    },
  });

  assert.deepEqual(client.configSummary(), {
    configured: false,
    baseUrl: null,
    model: null,
    missing: ["ARK_API_KEY", "ARK_BASE_URL", "ARK_MODEL"],
    timeoutMs: 30_000,
    maxRetries: 1,
  });

  await assert.rejects(
    client.generateJson({ prompt: "生成素材" }),
    (error) => {
      assert.ok(error instanceof ArkClientError);
      assert.equal(error.code, "ark_not_configured");
      return true;
    },
  );
  assert.equal(fetchCalls, 0);
});

test("uses only injected environment configuration and parses JSON object output", async () => {
  const requests = [];
  const client = createArkClient({
    env: configuredEnv,
    apiKey: "must-not-be-used",
    model: "must-not-be-used",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse(completion("```json\n{\"title\":\"牛顿定律\"}\n```"));
    },
    maxRetries: 0,
  });

  const result = await client.generateJson({
    system: "你是教学素材设计师。",
    prompt: "生成一张知识卡。",
    temperature: 0.3,
  });

  assert.deepEqual(result, { title: "牛顿定律" });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://ark.example.test/api/v3/chat/completions",
  );
  assert.equal(
    requests[0].init.headers.authorization,
    `Bearer ${configuredEnv.ARK_API_KEY}`,
  );

  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, configuredEnv.ARK_MODEL);
  assert.equal(body.temperature, 0.3);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(body.messages, [
    { role: "system", content: "你是教学素材设计师。" },
    { role: "user", content: "生成一张知识卡。" },
  ]);

  const summaryText = JSON.stringify(client.configSummary());
  assert.equal(summaryText.includes(configuredEnv.ARK_API_KEY), false);
  assert.equal(summaryText.includes("must-not-be-used"), false);
});

test("supports raw text output without forcing JSON parsing", async () => {
  let requestBody;
  const html = "<!doctype html><html><body>互动实验</body></html>";
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return jsonResponse(completion(html));
    },
    maxRetries: 0,
  });

  const result = await client.complete({
    system: "Return only one complete HTML document.",
    prompt: "Create an interactive simulation.",
    responseFormat: "text",
  });

  assert.equal(result.text, html);
  assert.equal(result.json, null);
  assert.equal("response_format" in requestBody, false);
});

test("streams fragmented OpenAI SSE JSON and emits safe trace events", async () => {
  const requests = [];
  const events = [];
  const prompt = "生成牛顿第二定律素材，完整提示不得进入 trace。";
  const jsonText = "{\"title\":\"牛顿第二定律\",\"ok\":true}";
  const streamText = [
    streamChunk(undefined),
    streamChunk("{\"title\":\"牛"),
    streamChunk("顿第二定律\",\"ok\":"),
    streamChunk("true}", { finishReason: "stop" }),
    usageChunk({
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
    }),
    "data: [DONE]\r\n\r\n",
  ].join("");
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return sseResponse(splitUtf8(streamText));
    },
    maxRetries: 0,
  });

  const result = await client.generateJson({
    prompt,
    stream: true,
    traceContext: {
      stage: "openmaic.slide",
      callId: "ai-call-1",
    },
    onTrace(event) {
      events.push(event);
    },
  });

  assert.deepEqual(result, {
    title: "牛顿第二定律",
    ok: true,
  });
  assert.equal(requests[0].stream, true);
  assert.deepEqual(requests[0].stream_options, { include_usage: true });
  assert.deepEqual(requests[0].response_format, { type: "json_object" });
  assert.deepEqual(
    events.map((event) => event.type),
    [
      "model.request",
      "model.delta",
      "model.delta",
      "model.delta",
      "model.response",
    ],
  );
  assert.equal(
    events
      .filter((event) => event.type === "model.delta")
      .map((event) => event.delta)
      .join(""),
    jsonText,
  );
  assert.equal(events.every((event) => event.stage === "openmaic.slide"), true);
  assert.equal(events.every((event) => event.call_id === "ai-call-1"), true);
  assert.deepEqual(events.at(-1).meta.usage, {
    prompt_tokens: 12,
    completion_tokens: 8,
    total_tokens: 20,
  });
  assert.equal(events.at(-1).meta.finish_reason, "stop");
  const traceText = JSON.stringify(events);
  assert.equal(traceText.includes(configuredEnv.ARK_API_KEY), false);
  assert.equal(traceText.includes(configuredEnv.ARK_BASE_URL), false);
  assert.equal(traceText.includes(prompt), false);
  for (const event of events) {
    assert.equal(
      Object.keys(event).every((key) =>
        ["type", "stage", "call_id", "status", "delta", "meta"].includes(key)
      ),
      true,
    );
  }
});

test("streams raw HTML text without running the JSON parser", async () => {
  const html = "<!doctype html><html><body>力与运动</body></html>";
  const streamText = [
    streamChunk("<!doctype html><html>"),
    streamChunk("<body>力与运动</body></html>", { finishReason: "stop" }),
    "data: [DONE]\n\n",
  ].join("");
  let requestBody;
  const events = [];
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return sseResponse(splitUtf8(streamText, [4, 1, 7]));
    },
    maxRetries: 0,
  });

  const result = await client.complete({
    prompt: "生成互动 HTML。",
    responseFormat: "text",
    stream: true,
    onTrace(event) {
      events.push(event);
    },
  });

  assert.equal(result.text, html);
  assert.equal(result.json, null);
  assert.equal(result.finishReason, "stop");
  assert.equal(requestBody.stream, true);
  assert.equal("response_format" in requestBody, false);
  assert.equal(
    events.filter((event) => event.type === "model.delta")
      .map((event) => event.delta)
      .join(""),
    html,
  );
  assert.equal(events.at(-1).type, "model.response");
  assert.equal(events.at(-1).meta.response_format, "text");
});

test("discards streamed invalid JSON and retries with an independent attempt", async () => {
  const responseBodies = [
    [
      streamChunk("not-json", { finishReason: "stop" }),
      "data: [DONE]\n\n",
    ].join(""),
    [
      streamChunk("{\"recovered\":true}", { finishReason: "stop" }),
      "data: [DONE]\n\n",
    ].join(""),
  ];
  const events = [];
  let calls = 0;
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () =>
      sseResponse(splitUtf8(responseBodies[calls++])),
  });

  assert.deepEqual(
    await client.generateJson({
      prompt: "生成 JSON。",
      stream: true,
      onTrace(event) {
        events.push(event);
      },
    }),
    { recovered: true },
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    events
      .filter((event) => event.type !== "model.delta")
      .map((event) => event.type),
    [
      "model.request",
      "model.retry",
      "model.request",
      "model.response",
    ],
  );
  const retryEvent = events.find((event) => event.type === "model.retry");
  assert.equal(retryEvent.meta.code, "ark_invalid_json");
  assert.equal(retryEvent.meta.attempt, 1);
  assert.equal(retryEvent.meta.next_attempt, 2);
  assert.equal(events.at(-1).meta.attempt, 2);
});

test("keeps streaming enabled through JSON Schema fallback", async () => {
  const requestBodies = [];
  const events = [];
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        return jsonResponse(
          { error: { type: "unsupported_format" } },
          422,
        );
      }
      return sseResponse(splitUtf8([
        streamChunk("{\"title\":\"能量守恒\"}", { finishReason: "stop" }),
        "data: [DONE]\n\n",
      ].join("")));
    },
    maxRetries: 0,
  });

  assert.deepEqual(
    await client.generateJson({
      prompt: "生成概念。",
      schema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      stream: true,
      onTrace(event) {
        events.push(event);
      },
    }),
    { title: "能量守恒" },
  );
  assert.equal(requestBodies[0].response_format.type, "json_schema");
  assert.equal(requestBodies[1].response_format.type, "json_object");
  assert.equal(requestBodies.every((body) => body.stream === true), true);
  assert.deepEqual(
    events
      .filter((event) => event.type !== "model.delta")
      .map((event) => event.type),
    [
      "model.request",
      "model.schema_fallback",
      "model.request",
      "model.response",
    ],
  );
  assert.equal(events[1].meta.http_status, 422);
  assert.equal(events.at(-1).meta.attempt, 2);
});

test("trace observer failures never affect a streaming completion", async () => {
  let traceCalls = 0;
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () =>
      sseResponse(splitUtf8([
        streamChunk("{\"ok\":true}", { finishReason: "stop" }),
        "data: [DONE]\n\n",
      ].join(""))),
    maxRetries: 0,
  });

  assert.deepEqual(
    await client.generateJson({
      prompt: "生成内容。",
      stream: true,
      onTrace() {
        traceCalls += 1;
        if (traceCalls === 1) throw new Error("observer failure");
        return Promise.reject(new Error("async observer failure"));
      },
    }),
    { ok: true },
  );
  assert.ok(traceCalls >= 3);
});

test("trace events redact a configured key from context and model deltas", async () => {
  const events = [];
  const secret = configuredEnv.ARK_API_KEY;
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () =>
      sseResponse(splitUtf8([
        streamChunk(secret.slice(0, 7)),
        streamChunk(secret.slice(7), { finishReason: "stop" }),
        "data: [DONE]\n\n",
      ].join(""))),
    maxRetries: 0,
  });

  const result = await client.complete({
    prompt: "Return plain text.",
    responseFormat: "text",
    stream: true,
    traceContext: {
      stage: secret,
      callId: `call-${secret}`,
    },
    onTrace(event) {
      events.push(event);
    },
  });

  assert.equal(result.text, secret);
  assert.equal(JSON.stringify(events).includes(secret), false);
  assert.equal(events[0].stage, "model");
  assert.match(events[0].call_id, /^ark-\d+$/);
  assert.equal(
    events.find((event) => event.type === "model.delta").delta,
    "[redacted]",
  );
});

test("reports incomplete SSE with a stable trace error", async () => {
  const events = [];
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () =>
      sseResponse(splitUtf8(streamChunk("{\"partial\":true}"))),
    maxRetries: 0,
  });

  await assert.rejects(
    client.generateJson({
      prompt: "生成内容。",
      stream: true,
      onTrace(event) {
        events.push(event);
      },
    }),
    (error) => {
      assert.equal(error.code, "ark_stream_incomplete");
      assert.equal(error.retryable, true);
      return true;
    },
  );
  assert.deepEqual(
    events
      .filter((event) => event.type !== "model.delta")
      .map((event) => event.type),
    ["model.request", "model.error"],
  );
  assert.deepEqual(events.at(-1).meta, {
    attempt: 1,
    code: "ark_stream_incomplete",
    retryable: true,
  });
});

test("aborts a stalled SSE body at the existing request timeout", async () => {
  let cancelCalls = 0;
  const events = [];
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(streamChunk("{\"partial\":")),
      );
    },
    cancel() {
      cancelCalls += 1;
    },
  });
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => "text/event-stream",
      },
      body,
    }),
    timeoutMs: 5,
    maxRetries: 0,
  });

  await assert.rejects(
    client.generateJson({
      prompt: "生成内容。",
      stream: true,
      onTrace(event) {
        events.push(event);
      },
    }),
    (error) => {
      assert.equal(error.code, "ark_timeout");
      return true;
    },
  );
  assert.equal(cancelCalls, 1);
  assert.equal(events.at(-1).type, "model.error");
  assert.equal(events.at(-1).meta.code, "ark_timeout");
});

test("replaceable client slot keeps one proxy while switching active clients", async () => {
  const calls = [];
  const firstClient = createArkClient({
    env: {
      ...configuredEnv,
      ARK_API_KEY: "first-runtime-key",
    },
    fetchImpl: async (_url, init) => {
      calls.push(init.headers.authorization);
      return jsonResponse(completion("{\"client\":\"first\"}"));
    },
    maxRetries: 0,
  });
  const slot = createArkClientSlot(firstClient);
  const stableProxy = slot.client;

  assert.deepEqual(
    await stableProxy.generateJson({ prompt: "第一次生成" }),
    { client: "first" },
  );

  const secondClient = createArkClient({
    env: {
      ...configuredEnv,
      ARK_API_KEY: "second-runtime-key",
    },
    fetchImpl: async (_url, init) => {
      calls.push(init.headers.authorization);
      return jsonResponse(completion("{\"client\":\"second\"}"));
    },
    maxRetries: 0,
  });
  slot.replace(secondClient);

  assert.equal(slot.client, stableProxy);
  assert.deepEqual(
    await stableProxy.generateJson({ prompt: "第二次生成" }),
    { client: "second" },
  );
  assert.deepEqual(calls, [
    "Bearer first-runtime-key",
    "Bearer second-runtime-key",
  ]);
  const publicState = JSON.stringify({
    slotKeys: Object.keys(slot),
    clientKeys: Object.keys(slot.client),
    summary: slot.client.configSummary(),
  });
  assert.equal(publicState.includes("first-runtime-key"), false);
  assert.equal(publicState.includes("second-runtime-key"), false);
});

test("sends an OpenAI-compatible JSON Schema response format", async () => {
  let requestBody;
  const client = createArkLlmClient({
    env: configuredEnv,
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return jsonResponse(completion({
        nodes: [{ id: "n1", label: "力" }],
        edges: [],
      }));
    },
    maxRetries: 0,
  });

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      nodes: { type: "array" },
      edges: { type: "array" },
    },
    required: ["nodes", "edges"],
  };
  const output = await client.generateJson({
    prompt: "生成思维导图。",
    schema,
    schemaName: "mind map/知识图谱",
  });

  assert.deepEqual(output, {
    nodes: [{ id: "n1", label: "力" }],
    edges: [],
  });
  assert.deepEqual(requestBody.response_format, {
    type: "json_schema",
    json_schema: {
      name: "mind_map",
      strict: true,
      schema,
    },
  });
});

test("uses ARK_REQUEST_TIMEOUT_MS as the default timeout", () => {
  const client = createArkClient({
    env: {
      ...configuredEnv,
      ARK_REQUEST_TIMEOUT_MS: "4321",
    },
    fetchImpl: async () => jsonResponse(completion("{}")),
  });

  assert.equal(client.configSummary().timeoutMs, 4321);
});

test("falls back once from unsupported JSON Schema to constrained JSON object", async () => {
  const requestBodies = [];
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        return jsonResponse({ error: { type: "unsupported_format" } }, 422);
      }
      return jsonResponse(completion("{\"title\":\"能量守恒\"}"));
    },
    maxRetries: 0,
  });
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
    },
    required: ["title"],
  };

  assert.deepEqual(
    await client.generateJson({
      prompt: "生成一张概念卡。",
      schema,
      schemaName: "concept_card",
    }),
    { title: "能量守恒" },
  );
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].response_format.type, "json_schema");
  assert.deepEqual(requestBodies[1].response_format, {
    type: "json_object",
  });
  assert.equal(
    requestBodies[1].messages.some(
      (message) => message.content.includes(JSON.stringify(schema)),
    ),
    true,
  );
});

test("never repeats the JSON Schema compatibility fallback", async () => {
  let calls = 0;
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(
        { error: { type: "unsupported_format" } },
        422,
      );
    },
    maxRetries: 0,
  });

  await assert.rejects(
    client.generateJson({
      prompt: "生成内容",
      schema: { type: "object" },
      schemaName: "once_only",
    }),
    (error) => {
      assert.equal(error.code, "ark_http_error");
      assert.equal(error.status, 422);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("does not misclassify an unrelated 422 as JSON Schema incompatibility", async () => {
  const events = [];
  let calls = 0;
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(
        {
          error: {
            code: "context_length_exceeded",
            type: "invalid_request_error",
            param: "messages",
          },
        },
        422,
        { "x-request-id": "req-safe-422" },
      );
    },
    maxRetries: 0,
  });

  await assert.rejects(
    client.generateJson({
      prompt: "生成内容",
      schema: { type: "object" },
      onTrace(event) {
        events.push(event);
      },
    }),
    (error) => {
      assert.equal(error.code, "ark_http_error");
      assert.equal(error.providerCode, "context_length_exceeded");
      assert.equal(error.requestId, "req-safe-422");
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    events.map((event) => event.type),
    ["model.request", "model.error"],
  );
  assert.equal(events.at(-1).meta.provider_code, "context_length_exceeded");
  assert.equal(events.at(-1).meta.request_id, "req-safe-422");
});

test("retries finish_reason length instead of publishing partial text", async () => {
  const events = [];
  let calls = 0;
  const responses = [
    [
      streamChunk("partial", { finishReason: "length" }),
      "data: [DONE]\n\n",
    ].join(""),
    [
      streamChunk("complete", { finishReason: "stop" }),
      "data: [DONE]\n\n",
    ].join(""),
  ];
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () =>
      sseResponse(splitUtf8(responses[calls++])),
  });

  const result = await client.complete({
    prompt: "生成完整 HTML",
    responseFormat: "text",
    stream: true,
    onTrace(event) {
      events.push(event);
    },
  });

  assert.equal(result.text, "complete");
  assert.equal(calls, 2);
  assert.equal(
    events.some(
      (event) =>
        event.type === "model.retry"
        && event.meta.code === "ark_output_truncated"
    ),
    true,
  );
  assert.equal(events.at(-1).type, "model.response");
});

test("content-filtered output fails without a false completed response", async () => {
  const events = [];
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () =>
      sseResponse(splitUtf8([
        streamChunk("filtered", { finishReason: "content_filter" }),
        "data: [DONE]\n\n",
      ].join(""))),
  });

  await assert.rejects(
    client.complete({
      prompt: "生成内容",
      responseFormat: "text",
      stream: true,
      onTrace(event) {
        events.push(event);
      },
    }),
    (error) => {
      assert.equal(error.code, "ark_content_filtered");
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(
    events.some((event) => event.type === "model.response"),
    false,
  );
  assert.equal(events.at(-1).type, "model.error");
});

test("retries one transient HTTP failure and no more", async () => {
  let calls = 0;
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: {} }, 503);
      return jsonResponse(completion("{\"ok\":true}"));
    },
  });

  assert.deepEqual(
    await client.generateJson({ prompt: "生成内容" }),
    { ok: true },
  );
  assert.equal(calls, 2);
});

test("does not retry when retries are disabled", async () => {
  let calls = 0;
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ error: {} }, 503);
    },
    maxRetries: 0,
  });

  await assert.rejects(
    client.generateJson({ prompt: "生成内容" }),
    (error) => {
      assert.equal(error.code, "ark_http_error");
      assert.equal(error.status, 503);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("retries invalid structured output once", async () => {
  let calls = 0;
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(completion("not-json"))
        : jsonResponse(completion("{\"recovered\":true}"));
    },
  });

  assert.deepEqual(
    await client.generateJson({ prompt: "生成内容" }),
    { recovered: true },
  );
  assert.equal(calls, 2);
});

test("aborts a timed-out request with ark_timeout", async () => {
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(new Error("aborted"));
      }, { once: true });
    }),
    timeoutMs: 5,
    maxRetries: 0,
  });

  await assert.rejects(
    client.generateJson({ prompt: "生成内容" }),
    (error) => {
      assert.equal(error.code, "ark_timeout");
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("never copies a secret-bearing fetch error into the public error", async () => {
  const secret = configuredEnv.ARK_API_KEY;
  const client = createArkClient({
    env: configuredEnv,
    fetchImpl: async () => {
      throw new Error(`request failed for Bearer ${secret}`);
    },
    maxRetries: 0,
  });

  await assert.rejects(
    client.generateJson({ prompt: "生成内容" }),
    (error) => {
      assert.equal(error.code, "ark_network_error");
      assert.equal(String(error).includes(secret), false);
      assert.equal(JSON.stringify(error).includes(secret), false);
      return true;
    },
  );
});
