import test from "node:test";
import assert from "node:assert/strict";

import {
  ArkEducationModelError,
  createArkEducationModelClient,
} from "../ark-education-model-client.js";

const configuredEnv = Object.freeze({
  ARK_API_KEY: "test-server-secret",
  ARK_BASE_URL: "https://ark.example.test/api/v3/",
  ARK_VISION_MODEL: "vision-test-model",
  ARK_TEXT_MODEL: "text-test-model",
  ARK_MULTIMODAL_EMBEDDING_MODEL: "embedding-test-model",
  ARK_MODEL_REQUEST_TIMEOUT_MS: "90000",
  ARK_MODEL_MAX_RETRIES: "1",
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

test("reports a safe unconfigured state without sending a request", async () => {
  let calls = 0;
  const client = createArkEducationModelClient({
    env: {},
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });

  assert.deepEqual(client.configSummary(), {
    configured: false,
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    visionModel: "doubao-seed-2-1-turbo-260628",
    textModel: "deepseek-v4-flash-260425",
    embeddingModel: "doubao-embedding-vision-250615",
    timeoutMs: 120_000,
    maxRetries: 2,
    missing: ["ARK_API_KEY"],
  });

  await assert.rejects(
    client.chatCompletion({
      messages: [{ role: "user", content: "test" }],
    }),
    (error) => {
      assert.ok(error instanceof ArkEducationModelError);
      assert.equal(error.code, "ark_model_not_configured");
      assert.equal(JSON.stringify(error).includes("secret"), false);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("sends multimodal chat content only to chat/completions", async () => {
  const requests = [];
  const sourceMessages = [
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {
            url: "https://files.example.test/student-page.png?signature=private",
            detail: "high",
          },
        },
        { type: "text", text: "请识别这道题的结构" },
      ],
    },
  ];
  const client = createArkEducationModelClient({
    env: configuredEnv,
    maxRetries: 0,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        id: "chatcmpl-education",
        model: "vision-test-model",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "这是一道几何题。" },
        }],
        usage: { prompt_tokens: 25, completion_tokens: 8, total_tokens: 33 },
      }, 200, { "x-request-id": "request-chat-1" });
    },
  });

  const result = await client.chatCompletion({
    messages: sourceMessages,
    temperature: 0.2,
    maxTokens: 2048,
    maxRetries: 0,
  });

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
  assert.equal(body.model, "vision-test-model");
  assert.deepEqual(body.messages, sourceMessages);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 2048);
  assert.equal(result.text, "这是一道几何题。");
  assert.equal(result.requestId, "request-chat-1");
  assert.equal(sourceMessages[0].content[0].image_url.detail, "high");
  assert.equal(
    JSON.stringify(client.configSummary()).includes(configuredEnv.ARK_API_KEY),
    false,
  );
});

test("uses Responses JSON Schema extraction and parses output_text", async () => {
  let request;
  const schema = {
    type: "object",
    properties: {
      document_type: { type: "string" },
      title: { type: "string" },
    },
    required: ["document_type", "title"],
    additionalProperties: false,
  };
  const client = createArkEducationModelClient({
    env: configuredEnv,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse({
        id: "resp-education-1",
        model: "text-test-model",
        status: "completed",
        output_text: "{\"document_type\":\"exam_paper\",\"title\":\"\u671f\u4e2d\u8bd5\u5377\"}",
        usage: { input_tokens: 10, output_tokens: 12, total_tokens: 22 },
      });
    },
  });

  const result = await client.extractStructured({
    instructions: "仅从输入文本抽取，不要补全。",
    input: "初中数学期中试卷",
    schema,
    schemaName: "document classification",
    maxOutputTokens: 1000,
  });

  assert.equal(request.url, "https://ark.example.test/api/v3/responses");
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, "text-test-model");
  assert.equal(body.instructions, "仅从输入文本抽取，不要补全。");
  assert.deepEqual(body.input, [{
    role: "user",
    content: [{ type: "input_text", text: "初中数学期中试卷" }],
  }]);
  assert.deepEqual(body.text.format, {
    type: "json_schema",
    name: "document_classification",
    strict: true,
    schema,
  });
  assert.deepEqual(result.data, {
    document_type: "exam_paper",
    title: "期中试卷",
  });
  assert.equal(result.status, "completed");
});

test("normalizes dense and sparse multimodal embedding output", async () => {
  let request;
  const client = createArkEducationModelClient({
    env: configuredEnv,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse({
        model: "embedding-test-model",
        data: {
          embedding: [0.125, -0.75, 0.5],
          sparse_embedding: {
            indices: [2, 19],
            values: [0.9, 0.4],
          },
        },
        usage: { prompt_tokens: 9, total_tokens: 9 },
      });
    },
  });

  const result = await client.embedMultimodal({
    input: [
      { type: "text", text: "一次函数" },
      {
        type: "image_url",
        image_url: { url: "https://files.example.test/function.png" },
      },
    ],
  });

  assert.equal(
    request.url,
    "https://ark.example.test/api/v3/embeddings/multimodal",
  );
  assert.deepEqual(JSON.parse(request.init.body), {
    model: "embedding-test-model",
    input: [
      { type: "text", text: "一次函数" },
      {
        type: "image_url",
        image_url: { url: "https://files.example.test/function.png" },
      },
    ],
  });
  assert.deepEqual(result.embedding, [0.125, -0.75, 0.5]);
  assert.deepEqual(result.sparseEmbedding, {
    indices: [2, 19],
    values: [0.9, 0.4],
  });
});

test("rejects duplicate multimodal embedding part types before requesting Ark", async () => {
  let requests = 0;
  const client = createArkEducationModelClient({
    env: configuredEnv,
    fetchImpl: async () => {
      requests += 1;
      throw new Error("must not request Ark");
    },
  });

  await assert.rejects(
    client.embedMultimodal({
      input: [
        { type: "text", text: "一次函数" },
        { type: "text", text: "二次函数" },
      ],
    }),
    (error) => error.code === "ark_model_invalid_request",
  );
  assert.equal(requests, 0);
});

test("retries transient failures without exposing provider text or student image", async () => {
  const secretImage = "data:image/png;base64,c3R1ZGVudC1vcmlnaW5hbA==";
  const delays = [];
  let calls = 0;
  const client = createArkEducationModelClient({
    env: configuredEnv,
    sleepImpl: async (delayMs) => delays.push(delayMs),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          error: {
            code: "rate_limit_exceeded",
            message: `do not expose ${configuredEnv.ARK_API_KEY} ${secretImage}`,
          },
        }, 429, { "x-request-id": "request-retry-1" });
      }
      return jsonResponse({
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "识别完成" },
        }],
      });
    },
  });

  const result = await client.chatCompletion({
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: secretImage } },
        { type: "text", text: "识别作业" },
      ],
    }],
  });

  assert.equal(result.text, "识别完成");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);

  const alwaysFailing = createArkEducationModelClient({
    env: configuredEnv,
    sleepImpl: async () => {},
    fetchImpl: async () => jsonResponse({
      error: {
        code: "rate_limit_exceeded",
        message: `do not expose ${configuredEnv.ARK_API_KEY} ${secretImage}`,
      },
    }, 429),
  });
  await assert.rejects(
    alwaysFailing.chatCompletion({
      messages: [{
        role: "user",
        content: [{ type: "image_url", image_url: { url: secretImage } }],
      }],
      maxRetries: 0,
    }),
    (error) => {
      const serialized = `${error.message}\n${JSON.stringify(error)}`;
      assert.equal(error.code, "ark_model_rate_limited");
      assert.equal(serialized.includes(configuredEnv.ARK_API_KEY), false);
      assert.equal(serialized.includes(secretImage), false);
      assert.equal(serialized.includes("student-original"), false);
      return true;
    },
  );
});

test("caller AbortSignal cancels immediately and is never retried", async () => {
  let calls = 0;
  const controller = new AbortController();
  const client = createArkEducationModelClient({
    env: configuredEnv,
    fetchImpl: async (_url, init) => {
      calls += 1;
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
  });
  const pending = client.chatCompletion({
    messages: [{ role: "user", content: "cancel me" }],
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, "ark_model_aborted");
    assert.equal(error.status, 499);
    assert.equal(error.attempts, 1);
    return true;
  });
  assert.equal(calls, 1);
});

test("per-request timeout returns a stable error and respects retry override", async () => {
  let calls = 0;
  const client = createArkEducationModelClient({
    env: configuredEnv,
    fetchImpl: async (_url, init) => {
      calls += 1;
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("provider included a private request body");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
  });

  await assert.rejects(
    client.chatCompletion({
      messages: [{ role: "user", content: "timeout" }],
      timeoutMs: 100,
      maxRetries: 0,
    }),
    (error) => {
      assert.equal(error.code, "ark_model_timeout");
      assert.equal(error.status, 504);
      assert.equal(error.attempts, 1);
      assert.equal(error.message.includes("private request body"), false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("rejects local file URLs before any upstream request", async () => {
  let calls = 0;
  const client = createArkEducationModelClient({
    env: configuredEnv,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });

  await assert.rejects(
    client.chatCompletion({
      messages: [{
        role: "user",
        content: [{
          type: "image_url",
          image_url: { url: "file:///tmp/student-paper.png" },
        }],
      }],
    }),
    (error) => {
      assert.equal(error.code, "ark_model_invalid_request");
      return true;
    },
  );
  assert.equal(calls, 0);
});
