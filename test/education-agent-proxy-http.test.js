import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  createEducationAgentProxyHttpHandler,
  normalizeExternalAgentProxyFinal,
} from "../education-agent-proxy-http.js";
import { createEducationAgentProxyClient } from "../education-agent-proxy-client.js";

const SECRET = "proxy-secret-must-not-leak";

function sseResponse(blocks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block));
      controller.close();
    },
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function proxyClient({
  enabled = true,
  configured = true,
  streamConversation,
  chat,
} = {}) {
  return {
    configSummary: () => ({ enabled, configured }),
    streamConversation: streamConversation || (async function* emptyStream() {}),
    ...(chat ? { chat } : {}),
  };
}

test("disabled proxy returns false so the existing Pi route remains authoritative", async (t) => {
  let proxyCalls = 0;
  const handler = createEducationAgentProxyHttpHandler({
    client: proxyClient({
      enabled: false,
      configured: false,
      streamConversation: async function* stream() { proxyCalls += 1; },
    }),
    authorizeRequest: () => true,
  });

  await withHttpServer(t, handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, { message: "一次函数" });
    assert.equal(response.status, 209);
    assert.deepEqual(await response.json(), { handled_by: "pi_fallback" });
  });
  assert.equal(proxyCalls, 0);
});

test("enabled proxy requires complete settings and the same request authorization as Pi", async (t) => {
  let calls = 0;
  const unavailable = createEducationAgentProxyHttpHandler({
    client: proxyClient({
      enabled: true,
      configured: false,
      streamConversation: async function* stream() { calls += 1; },
    }),
    authorizeRequest: () => true,
  });
  await withHttpServer(t, unavailable, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, { message: "一次函数" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "agent_proxy_not_configured");
  });

  const forbidden = createEducationAgentProxyHttpHandler({
    client: proxyClient({
      streamConversation: async function* stream() { calls += 1; },
    }),
    authorizeRequest: () => false,
  });
  await withHttpServer(t, forbidden, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, { message: "一次函数" });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "education_agent_forbidden");
  });
  assert.equal(calls, 0);
});

test("stream route maps only status, delta, trace and a whitelisted final projection", async (t) => {
  const calls = [];
  const client = proxyClient({
    streamConversation: async function* stream(input) {
      calls.push(input);
      yield { type: "meta", conversation_id: "provider-meta" };
      yield {
        type: "status",
        stage: "agent_proxy.upstream",
        message: "<b>正在调用外部 Agent</b>",
      };
      yield { type: "delta", delta: "<b>一次" };
      yield { type: "delta", delta: "函数</b>" };
      yield {
        type: "trace",
        stage: "agent_proxy.tool",
        message: "<script>ignore()</script>检索知识",
        span: {
          span_id: "span-1",
          parent_span_id: "root-1",
          span_type: "function",
          name: "search_knowledge",
          status: "success",
          channel: "tool",
          duration_ms: 38,
          started_at: "2026-09-04T00:00:00.000Z",
          ended_at: "2026-09-04T00:00:00.038Z",
          input_summary: "检索一次函数",
          output_summary: "命中 2 条",
          attributes: { result_count: 2 },
        },
        references: [{ id: "trace-ref", title: "课标", url: "https://sources.example.test/trace" }],
      };
      yield {
        type: "artifact",
        artifact_type: "card",
        artifact: { html: "<img src=x onerror=alert(1)>" },
      };
      yield {
        type: "final",
        answer: "<strong>一次函数</strong>的图像是一条直线。",
        conversation_id: "conversation-external-1",
        chat_id: "chat-external-1",
        mastery_write_authorized: true,
        mastery_evidence_proposals: [{ outcome: "correct" }],
        homework_mark: { correct: true },
        rich_results: {
          cards: [{
            id: "card-safe",
            kind: "article",
            provider_type: "article",
            title: "<img src=x onerror=alert(1)>一次函数资料",
            summary: "<b>斜率</b>与截距",
            url: "https://sources.example.test/linear#section",
            executable: "alert(1)",
          }, {
            id: "card-executable",
            kind: "summary",
            provider_type: "a2ui",
            title: "不应出现",
            html: "<script>alert(1)</script>",
          }],
          images: [{ image_url: "https://media.example.test/line.png", alt: "函数图" },
            { image_url: "javascript:alert(1)" },
            { image_url: "https://127.0.0.1/private.png" }],
          videos: [{ id: "video-1", url: "https://media.example.test/line.mp4", title: "直线演示" }],
        },
        attachments: {
          audio: [{ id: "audio-1", url: "https://media.example.test/explanation.mp3" }],
          files: [{ id: "file-1", url: "file:///etc/passwd", name: "答案.html" }],
        },
        suggestions: ["继续练习", "<script>坏建议</script>换一道题"],
        references: [{
          id: "reference-1",
          title: "<b>课程资料</b>",
          url: "https://sources.example.test/linear#reference",
          site_name: "示例站点",
        }],
      };
    },
  });
  const handler = createEducationAgentProxyHttpHandler({
    client,
    authorizeRequest: () => true,
    idFactory: () => "request-1",
    clock: () => "2026-09-04T00:00:00.000Z",
  });

  await withHttpServer(t, handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, {
      message: "请解答图片题",
      conversation_id: "conversation-previous",
      user_id: "student-1",
      session_id: "session-1",
      skill: "photo_solver",
      image_task_mode: "solve",
      course_scope_id: "course-junior-math",
      knowledge_point_id: "M4-NA-FUN-02",
      question_preferences: {
        knowledge_point_id: "M4-NA-FUN-02",
        count: 3,
        question_type: "single_choice",
        adaptive: true,
      },
      shortcut: {
        id: "mock-exam",
        artifact_ids: ["visual:M4-NA-FUN-02"],
        knowledge_point_ids: ["M4-NA-FUN-02"],
      },
      continuation_context: {
        source_kind: "learning-calendar",
        source_id: "history-1",
        summary: "上次学习了一次函数",
        knowledge_point_ids: ["M4-NA-FUN-02"],
      },
      image: {
        name: "题目.png",
        mime_type: "image/png",
        data: Buffer.from([1, 2, 3]).toString("base64"),
      },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/x-ndjson/u);
    const events = await readNdjson(response);
    assert.deepEqual(events.map((event) => event.type), [
      "status",
      "status",
      "delta",
      "delta",
      "trace",
      "final",
    ]);
    assert.equal(events.filter((event) => event.type === "delta").map((event) => event.delta).join(""), "一次函数");
    assert.equal(events[4].kind, "tool");
    assert.equal(events[4].span_id, "span-1");
    assert.equal(events[4].duration_ms, 38);
    assert.equal(events[4].input_summary, "检索一次函数");
    assert.equal(events[4].attributes.result_count, "2");
    assert.equal(events[4].references[0].title, "课标");
    assert.doesNotMatch(events[4].message, /<script/u);

    const final = events.at(-1);
    assert.equal(final.answer, "一次函数的图像是一条直线。");
    assert.equal(final.conversation_id, "conversation-external-1");
    assert.equal(final.mastery_write_authorized, false);
    assert.equal(final.teaching_package, null);
    assert.equal(final.ui_projection, null);
    assert.equal(final.rich_results.cards.length, 1);
    assert.equal(final.rich_results.cards[0].title, "一次函数资料");
    assert.equal(final.rich_results.cards[0].summary, "斜率 与截距");
    assert.deepEqual(Object.keys(final.rich_results.cards[0]).sort(), [
      "author_name", "id", "image", "kind", "provider_type", "site_name",
      "source_type", "summary", "title", "url", "video",
    ]);
    assert.equal(final.rich_results.images.length, 1);
    assert.equal(final.rich_results.videos.length, 1);
    assert.equal(final.attachments.audio.length, 1);
    assert.equal(final.attachments.files.length, 0);
    assert.deepEqual(final.suggestions, ["继续练习", "坏建议 换一道题"]);
    assert.deepEqual(final.external_grounding.rich_results, final.rich_results);
    assert.equal(JSON.stringify(final).includes("mastery_evidence_proposals"), false);
    assert.equal(JSON.stringify(final).includes("homework_mark"), false);
    assert.doesNotMatch(JSON.stringify(final), /<script|javascript:|onerror=/iu);
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].content, "请解答图片题");
  assert.equal(calls[0].conversationId, "conversation-previous");
  assert.equal(calls[0].userId, "student-1");
  assert.equal(calls[0].customPassThroughMap.skill, "photo_solver");
  assert.equal(calls[0].customPassThroughMap.image_task_mode, "solve");
  assert.equal(
    calls[0].customPassThroughMap.response_schema_version,
    "education-agent-render-contract@1.0",
  );
  assert.deepEqual(JSON.parse(calls[0].customPassThroughMap.question_preferences), {
    item_type: "single_choice",
    count: 3,
    adaptive: true,
    knowledge_point_id: "M4-NA-FUN-02",
  });
  assert.deepEqual(JSON.parse(calls[0].customPassThroughMap.shortcut_context), {
    id: "mock-exam",
    artifact_ids: ["visual:M4-NA-FUN-02"],
    knowledge_point_ids: ["M4-NA-FUN-02"],
  });
  assert.equal(
    JSON.parse(calls[0].customPassThroughMap.continuation_context).summary,
    "上次学习了一次函数",
  );
  assert.equal(calls[0].image.name, "题目.png");
  assert.equal(calls[0].image.data, Buffer.from([1, 2, 3]).toString("base64"));
});

test("non-stream route returns the same safe final contract without the NDJSON type marker", async (t) => {
  let chatInput = null;
  const handler = createEducationAgentProxyHttpHandler({
    client: proxyClient({
      chat: async (input) => {
        chatInput = input;
        return {
          type: "final",
          answer: "二次函数 $y=x^2$。",
          conversation_id: "conversation-json",
          references: [{ title: "函数资料", url: "https://sources.example.test/quadratic" }],
        };
      },
    }),
    authorizeRequest: () => true,
    idFactory: () => "request-json",
  });

  await withHttpServer(t, handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, {
      message: "什么是二次函数",
      user_id: "student-json",
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/u);
    const payload = await response.json();
    assert.equal(Object.hasOwn(payload, "type"), false);
    assert.equal(payload.answer, "二次函数 $y=x^2$。");
    assert.equal(payload.external_grounding.mode, "external_agent_proxy");
    assert.equal(payload.external_grounding.references.length, 1);
    assert.equal(payload.mastery_write_authorized, false);
  });
  assert.equal(chatInput.userId, "student-json");
});

test("authentication and timeout failures use fixed public errors and never expose provider secrets", async (t) => {
  const authError = new Error(`provider rejected ${SECRET}`);
  authError.code = "agent_proxy_auth_failed";
  const authHandler = createEducationAgentProxyHttpHandler({
    client: proxyClient({ chat: async () => { throw authError; } }),
    authorizeRequest: () => true,
  });
  await withHttpServer(t, authHandler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, { message: "测试鉴权" });
    const text = await response.text();
    assert.equal(response.status, 502);
    assert.match(text, /agent_proxy_auth_failed/u);
    assert.match(text, /检查地址与 Key/u);
    assert.equal(text.includes(SECRET), false);
  });

  const timeoutError = new Error(`timeout with ${SECRET}`);
  timeoutError.code = "agent_proxy_timeout";
  const timeoutHandler = createEducationAgentProxyHttpHandler({
    client: proxyClient({
      streamConversation: async function* stream() { throw timeoutError; },
    }),
    authorizeRequest: () => true,
  });
  await withHttpServer(t, timeoutHandler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, { message: "测试超时" });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /agent_proxy_timeout/u);
    assert.match(text, /响应超时/u);
    assert.equal(text.includes(SECRET), false);
  });
});

test("real proxy client never exposes a split key or credential-shaped trace fields over public NDJSON", async (t) => {
  const answerChunks = ["普通重复 普通重复 ", ...SECRET, " 完成"];
  const client = createEducationAgentProxyClient({
    config: {
      enabled: true,
      endpoint: "https://agent.example.test",
      api_key: SECRET,
      timeout_ms: 5_000,
    },
    fetchImpl: async () => sseResponse([
      sseEvent("conversation.message.completed", {
        message_type: "tool_message",
        content_type: "tool_call",
        content: JSON.stringify({
          message: `trace ${SECRET}`,
          span_id: SECRET,
          parent_span_id: `parent-${SECRET}`,
          attributes: {
            [SECRET]: "drop-key",
            api_key: "drop-sensitive-field",
            result_count: `2 ${SECRET}`,
            repeated_text: "普通重复 普通重复",
          },
        }),
      }),
      ...answerChunks.map((content) => sseEvent("conversation.message.delta", {
        message_type: "answer",
        content_type: "text",
        content,
      })),
      sseEvent("conversation.chat.completed", { status: "completed" }),
    ]),
  });
  const handler = createEducationAgentProxyHttpHandler({
    client,
    authorizeRequest: () => true,
  });

  await withHttpServer(t, handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, {
      message: "安全探针",
      user_id: "student-security",
    });
    const events = await readNdjson(response);
    const trace = events.find((item) => item.type === "trace");
    const deltas = events.filter((item) => item.type === "delta").map((item) => item.delta);
    const final = events.find((item) => item.type === "final");

    assert.equal(response.status, 200);
    assert.equal(deltas.join(""), "普通重复 普通重复 [已脱敏] 完成");
    assert.equal(trace.span_id, "");
    assert.equal(trace.parent_span_id, "");
    assert.deepEqual(trace.attributes, {
      result_count: "2 [已脱敏]",
      repeated_text: "普通重复 普通重复",
    });
    assert.equal(final.answer, "普通重复 普通重复 [已脱敏] 完成");
    assert.equal(JSON.stringify(events).includes(SECRET), false);
  });
});

test("standalone final normalizer drops executable cards and all mastery authority fields", () => {
  const output = normalizeExternalAgentProxyFinal({
    answer: "有效回答",
    cards: [{ html: "<script>alert(1)</script>" }],
    mastery_write_authorized: true,
    knowledge_point_ids: ["fake-id"],
  }, { requestId: "request-normalizer" });
  assert.equal(output.answer, "有效回答");
  assert.equal(output.mastery_write_authorized, false);
  assert.deepEqual(output.rich_results.cards, []);
  assert.equal(JSON.stringify(output).includes("fake-id"), false);
});

async function withHttpServer(t, handler, run) {
  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    if (await handler(req, res, requestUrl)) return;
    res.writeHead(209, { "content-type": "application/json" });
    res.end(JSON.stringify({ handled_by: "pi_fallback" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  await run(`http://127.0.0.1:${address.port}`);
}

function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readNdjson(response) {
  return (await response.text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
