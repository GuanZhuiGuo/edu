import assert from "node:assert/strict";
import test from "node:test";

import {
  VolcengineEducationBotError,
  createVolcengineEducationBotClient,
  normalizeHomeworkMark,
} from "../volcengine-education-bot-client.js";

const configuredEnv = Object.freeze({
  VOLC_EDUCATION_BOT_BASE_URL: "https://education-bot.example.test/agent",
  VOLC_EDUCATION_BOT_ID: "bot-test-1",
  VOLC_EDUCATION_BOT_API_KEY: "server-only-test-key",
  VOLC_EDUCATION_BOT_SERVICE_NAME: "ask_echo",
  VOLC_EDUCATION_BOT_TIMEOUT_MS: "5000",
  VOLC_EDUCATION_BOT_MARK_POLL_INTERVAL_MS: "2300",
  VOLC_EDUCATION_BOT_MARK_TIMEOUT_MS: "150000",
});

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-request-id": "req-stream-1" },
  });
}

function points(x, y, width = 10, height = 10) {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

test("present credentials remain unverified, server-only, and make no eager request", () => {
  let calls = 0;
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });

  const summary = client.configSummary();
  assert.equal(summary.configured, false);
  assert.equal(summary.configuration_status, "unverified");
  assert.equal(summary.has_required_config, true);
  assert.equal(summary.can_attempt, true);
  assert.equal(summary.verification.reason_code, "not_checked");
  assert.equal(summary.bot_id, configuredEnv.VOLC_EDUCATION_BOT_ID);
  assert.equal(summary.credential_env, "VOLC_EDUCATION_BOT_API_KEY");
  assert.equal(summary.homework_poll_interval_ms, 2300);
  assert.equal(summary.homework_poll_timeout_ms, 150000);
  assert.equal(JSON.stringify(summary).includes(configuredEnv.VOLC_EDUCATION_BOT_API_KEY), false);
  assert.equal(calls, 0);
});

test("legacy API_TOKEN remains a server-only fallback when API_KEY is absent", () => {
  const legacySecret = "legacy-server-only-token";
  const client = createVolcengineEducationBotClient({
    env: {
      ...configuredEnv,
      VOLC_EDUCATION_BOT_API_KEY: "",
      VOLC_EDUCATION_BOT_API_TOKEN: legacySecret,
    },
    fetchImpl: async () => jsonResponse({}),
  });
  const summary = client.configSummary();
  assert.equal(summary.configured, false);
  assert.equal(summary.configuration_status, "unverified");
  assert.equal(summary.credential_env, "VOLC_EDUCATION_BOT_API_TOKEN");
  assert.equal(JSON.stringify(summary).includes(legacySecret), false);
});

test("missing configuration is explicit and probe makes no provider request", async () => {
  let calls = 0;
  const client = createVolcengineEducationBotClient({
    env: {
      VOLC_EDUCATION_BOT_BASE_URL: configuredEnv.VOLC_EDUCATION_BOT_BASE_URL,
      VOLC_EDUCATION_BOT_ID: configuredEnv.VOLC_EDUCATION_BOT_ID,
    },
    fetchImpl: async () => {
      calls += 1;
      return sseResponse(["data:[DONE]\n\n"]);
    },
  });

  const summary = await client.probeConfiguration();
  assert.equal(summary.configuration_status, "missing");
  assert.equal(summary.configured, false);
  assert.equal(summary.can_attempt, false);
  assert.deepEqual(summary.missing, ["VOLC_EDUCATION_BOT_BEARER_TOKEN"]);
  assert.equal(calls, 0);
});

test("probe verifies AskEcho once and returns the cached redacted status", async () => {
  let calls = 0;
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    fetchImpl: async () => {
      calls += 1;
      return sseResponse([
        'data:{"id":"probe-1","choices":[{"delta":{"content":"连接正常"},"finish_reason":"stop"}]}\n\n',
        "data:[DONE]\n\n",
      ]);
    },
  });

  const first = await client.probeConfiguration();
  const second = await client.probeConfiguration();
  assert.equal(first.configuration_status, "verified");
  assert.equal(first.configured, true);
  assert.equal(first.verification.source, "probe");
  assert.equal(second.configuration_status, "verified");
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(first).includes(configuredEnv.VOLC_EDUCATION_BOT_API_KEY), false);
});

test("expired verification returns to unverified and can be probed again", async () => {
  let clock = Date.parse("2026-09-03T00:00:00.000Z");
  let calls = 0;
  const client = createVolcengineEducationBotClient({
    env: {
      ...configuredEnv,
      VOLC_EDUCATION_BOT_CONFIG_PROBE_CACHE_TTL_MS: "1000",
    },
    nowImpl: () => clock,
    fetchImpl: async () => {
      calls += 1;
      return sseResponse([
        'data:{"id":"probe-expiry","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
        "data:[DONE]\n\n",
      ]);
    },
  });

  assert.equal((await client.probeConfiguration()).configuration_status, "verified");
  clock += 1_001;
  const expired = client.configSummary();
  assert.equal(expired.configuration_status, "unverified");
  assert.equal(expired.verification.reason_code, "verification_expired");
  assert.equal((await client.probeConfiguration()).configuration_status, "verified");
  assert.equal(calls, 2);
});

test("invalid_api_key probe becomes rejected without exposing provider text", async () => {
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    fetchImpl: async () => jsonResponse({
      error: {
        type: "authentication_error",
        code: "invalid_api_key",
        message: `invalid ${configuredEnv.VOLC_EDUCATION_BOT_API_KEY}`,
      },
    }, 401),
  });

  const summary = await client.probeConfiguration();
  assert.equal(summary.configuration_status, "rejected");
  assert.equal(summary.configured, false);
  assert.equal(summary.can_attempt, false);
  assert.equal(summary.verification.reason_code, "credential_rejected");
  assert.equal(summary.verification.provider_code, "invalid_api_key");
  assert.equal(summary.verification.http_status, 401);
  assert.equal(JSON.stringify(summary).includes(configuredEnv.VOLC_EDUCATION_BOT_API_KEY), false);
});

test("transient network failures remain unverified instead of rejecting credentials", async () => {
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    fetchImpl: async () => {
      throw new Error(`network failed ${configuredEnv.VOLC_EDUCATION_BOT_API_KEY}`);
    },
  });

  const summary = await client.probeConfiguration();
  assert.equal(summary.configuration_status, "unverified");
  assert.equal(summary.can_attempt, true);
  assert.equal(summary.verification.reason_code, "network_unavailable");
  assert.equal(summary.verification.retryable, true);
  assert.equal(JSON.stringify(summary).includes(configuredEnv.VOLC_EDUCATION_BOT_API_KEY), false);
});

test("two compatibility credentials require an explicit Bearer source", async () => {
  const apiToken = "second-server-only-token";
  const ambiguous = createVolcengineEducationBotClient({
    env: {
      ...configuredEnv,
      VOLC_EDUCATION_BOT_API_TOKEN: apiToken,
    },
  });
  const ambiguousSummary = ambiguous.configSummary();
  assert.equal(ambiguousSummary.configuration_status, "missing");
  assert.equal(ambiguousSummary.credential_issue, "ambiguous_bearer_source");
  assert.equal(ambiguousSummary.verification.reason_code, "ambiguous_bearer_source");
  assert.deepEqual(ambiguousSummary.missing, ["VOLC_EDUCATION_BOT_BEARER_SOURCE"]);

  let authorization = "";
  const selected = createVolcengineEducationBotClient({
    env: {
      ...configuredEnv,
      VOLC_EDUCATION_BOT_API_TOKEN: apiToken,
      VOLC_EDUCATION_BOT_BEARER_SOURCE: "api_token",
    },
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization;
      return sseResponse([
        'data:{"id":"probe-selected","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
        "data:[DONE]\n\n",
      ]);
    },
  });
  const selectedSummary = await selected.probeConfiguration();
  assert.equal(selectedSummary.configuration_status, "verified");
  assert.equal(selectedSummary.credential_env, "VOLC_EDUCATION_BOT_API_TOKEN");
  assert.equal(selectedSummary.credential_source, "api_token");
  assert.equal(authorization, `Bearer ${apiToken}`);
  assert.equal(JSON.stringify(selectedSummary).includes(apiToken), false);
});

test("HTTP 200 JSON provider error is rejected instead of treated as an SSE stream", async () => {
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    fetchImpl: async () => jsonResponse({
      error: {
        type: "authentication_error",
        code: "invalid_api_key",
        message: `invalid ${configuredEnv.VOLC_EDUCATION_BOT_API_KEY}`,
      },
    }),
  });

  await assert.rejects(
    client.chatCompletion({ messages: [{ role: "user", content: "hello" }] }),
    (error) => {
      assert.equal(error instanceof VolcengineEducationBotError, true);
      assert.equal(error.code, "volc_education_provider_error");
      assert.equal(error.providerCode, "invalid_api_key");
      assert.equal(error.message.includes(configuredEnv.VOLC_EDUCATION_BOT_API_KEY), false);
      return true;
    },
  );
});

test("SSE chat forces web search, preserves first-frame sources, and aggregates until DONE", async () => {
  let request;
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return sseResponse([
        'data:{"id":"chat-1","choices":[{"delta":{"processing_state":{"action":"search_begin","description":"searching"}},"finish_reason":""}]}\n\n',
        'data:{"id":"chat-1","choices":[{"delta":{"content":"first"},"finish_reason":""}],"references":[{"id":"ref-1","source_type":"search_engine","site_name":"Example","title":"Source","publish_time":1,"url":"https://source.example.test/a"}]}\n',
        '\ndata:{"id":"chat-1","choices":[{"delta":{"content":" answer"},"finish_reason":"stop"}]}\n\n',
        'data:{"id":"chat-1","choices":[{"delta":{},"finish_reason":""}],"follow_ups":[{"item":"next"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
        'data:[DO',
        'NE]\n\n',
      ]);
    },
  });

  const result = await client.chatCompletion({
    messages: [{ role: "user", content: "latest fact" }],
  });

  assert.equal(request.url, "https://education-bot.example.test/agent/chat/completion");
  assert.equal(request.init.headers.Authorization, `Bearer ${configuredEnv.VOLC_EDUCATION_BOT_API_KEY}`);
  assert.equal(request.init.headers.ServiceName, "ask_echo");
  const body = JSON.parse(request.init.body);
  assert.equal(body.bot_id, configuredEnv.VOLC_EDUCATION_BOT_ID);
  assert.equal(body.stream, true);
  assert.equal(body.extension_options.browsing_mode, 2);
  assert.equal(body.extension_options.enable_processing_state, true);
  assert.equal(body.extension_options.card_position, "meta_frame");
  assert.equal(result.content, "first answer");
  assert.equal(result.processing[0].action, "search_begin");
  assert.equal(result.references[0].id, "ref-1");
  assert.deepEqual(result.follow_ups, ["next"]);
  assert.equal(result.usage.total_tokens, 5);
  assert.equal(client.configSummary().configuration_status, "verified");
});

test("chat prunes history to the system message plus the latest nine messages", async () => {
  let sent;
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return sseResponse([
        'data:{"id":"chat-2","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
        'data:[DONE]\n\n',
      ]);
    },
  });
  const messages = [
    { role: "system", content: "policy" },
    ...Array.from({ length: 15 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `m${index}` })),
  ];

  await client.chatCompletion({ messages });
  assert.equal(sent.messages.length, 10);
  assert.equal(sent.messages[0].role, "system");
  assert.equal(sent.messages[0].content, "policy");
  assert.equal(sent.messages.at(-1).content, "m14");
});

test("homework submit normalizes ResponseMetadata/Result into homework_mark@1.0", async () => {
  let request;
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse({
        ResponseMetadata: { RequestId: "request-submit-1" },
        Result: {
          task_id: "task-1",
          preprocessed_image_url: "https://images.example.test/corrected.jpg?signature=short-lived",
          mark_results: [{
            mark_id: "question-1",
            finish: false,
            mark_points: points(5, 10, 100, 80),
          }],
        },
      });
    },
  });

  const result = await client.submitHomeworkMark({
    imageBase64: "data:image/jpeg;base64,aGVsbG8=",
    imageUrl: "https://images.example.test/ignored.jpg",
  });

  assert.equal(request.url, "https://education-bot.example.test/agent/home_work/mark/submit");
  const body = JSON.parse(request.init.body);
  assert.equal(body.image_base64, "data:image/jpeg;base64,aGVsbG8=");
  assert.equal(Object.hasOwn(body, "image_url"), false);
  assert.equal(result.schema_version, "homework_mark@1.0");
  assert.equal(result.status, "running");
  assert.equal(result.provider_request_id, "request-submit-1");
  assert.equal(result.questions[0].polygon.length, 4);
  assert.equal(result.questions[0].has_handwritten_answer, null);
  assert.equal(result.image_reference.coordinate_unit, "pixel");
  assert.equal(JSON.stringify(result).includes("<img"), false);
});

test("direct homework query payload preserves question and handwritten-answer polygons", async () => {
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    fetchImpl: async () => jsonResponse({
      task_id: "task-2",
      status: "success",
      preprocessed_image_url: "https://images.example.test/corrected-2.jpg",
      mark_results: [{
        mark_id: "question-2",
        finish: true,
        mark_points: points(10, 20, 200, 100),
        answer_results: [{
          id: 0,
          answer_points: points(80, 60, 20, 15),
          correct: false,
        }],
        solution: "Answer and explanation",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }),
  });

  const result = await client.queryHomeworkMark("task-2");
  assert.equal(result.status, "success");
  assert.equal(result.questions[0].answers[0].correct, false);
  assert.deepEqual(result.questions[0].answers[0].polygon[0], { x: 80, y: 60 });
  assert.equal(result.questions[0].has_handwritten_answer, true);
  assert.equal(result.questions[0].solution_text, "Answer and explanation");
  assert.equal(result.questions[0].solution_format, "plain_text");
  assert.equal(result.usage.total_tokens, 14);
});

test("poll helper waits at least the documented interval and stops on terminal state", async () => {
  let queryCount = 0;
  const sleeps = [];
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    sleepImpl: async (ms) => { sleeps.push(ms); },
    fetchImpl: async () => {
      queryCount += 1;
      return jsonResponse({
        Result: {
          task_id: "task-poll",
          status: queryCount === 1 ? "running" : "success",
          preprocessed_image_url: "https://images.example.test/poll.jpg",
          mark_results: [],
        },
      });
    },
  });

  const result = await client.pollHomeworkMark("task-poll", {
    intervalMs: 1,
    pollTimeoutMs: 10_000,
    maxAttempts: 3,
  });
  assert.equal(result.status, "success");
  assert.equal(queryCount, 2);
  assert.deepEqual(sleeps, [2_100]);
});

test("provider errors redact the bearer token", async () => {
  const client = createVolcengineEducationBotClient({
    env: configuredEnv,
    fetchImpl: async () => jsonResponse({
      error: {
        type: "authentication_error",
        code: "invalid_api_key",
        message: `bad token ${configuredEnv.VOLC_EDUCATION_BOT_API_KEY}`,
      },
    }, 401),
  });

  await assert.rejects(
    client.queryHomeworkMark("task-secret"),
    (error) => {
      assert.equal(error instanceof VolcengineEducationBotError, true);
      assert.equal(error.status, 401);
      assert.equal(error.message.includes(configuredEnv.VOLC_EDUCATION_BOT_API_KEY), false);
      assert.equal(client.configSummary().configuration_status, "rejected");
      return true;
    },
  );
});

test("request timeout aborts the provider call without exposing credentials", async () => {
  const timeoutEnv = {
    ...configuredEnv,
    VOLC_EDUCATION_BOT_TIMEOUT_MS: "50",
  };
  const client = createVolcengineEducationBotClient({
    env: timeoutEnv,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });

  await assert.rejects(
    client.queryHomeworkMark("task-timeout"),
    (error) => {
      assert.equal(error instanceof VolcengineEducationBotError, true);
      assert.equal(error.code, "volc_education_timeout");
      assert.equal(error.status, 504);
      assert.equal(error.message.includes(timeoutEnv.VOLC_EDUCATION_BOT_API_KEY), false);
      return true;
    },
  );
});

test("normalizer rejects malformed provider polygons instead of emitting unsafe geometry", () => {
  assert.throws(
    () => normalizeHomeworkMark({
      task_id: "task-bad",
      status: "success",
      mark_results: [{
        mark_id: "question-bad",
        finish: true,
        mark_points: [{ x: 1, y: 2 }],
      }],
    }),
    (error) => error instanceof VolcengineEducationBotError
      && error.code === "volc_education_invalid_response",
  );
});
