import assert from "node:assert/strict";
import test from "node:test";

import {
  EducationAgentProxyError,
  createEducationAgentProxyClient,
  normalizeEducationAgentProxyRichContent,
  resolveEducationAgentProxyEndpoints,
} from "../education-agent-proxy-client.js";

const SECRET = "agent-private-key-that-must-never-leak";

function configuration(overrides = {}) {
  return {
    enabled: true,
    endpoint: "https://agent.example.test",
    api_key: SECRET,
    timeout_ms: 5_000,
    ...overrides,
  };
}

function sseResponse(blocks, { status = 200, contentType = "text/event-stream; charset=utf-8" } = {}) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block));
      controller.close();
    },
  }), {
    status,
    headers: { "content-type": contentType },
  });
}

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

test("resolves an origin to the gateway chat path and keeps an explicitly configured URL", () => {
  assert.deepEqual(resolveEducationAgentProxyEndpoints("https://agent.example.test"), {
    chatUrl: "https://agent.example.test/marketing/agent-control/openapi/conversation/chat",
    uploadUrl: "https://agent.example.test/marketing/ai_custom_agents/openapi/storage/upload",
  });
  assert.deepEqual(
    resolveEducationAgentProxyEndpoints("https://agent.example.test/custom/conversation/chat?tenant=1"),
    {
      chatUrl: "https://agent.example.test/custom/conversation/chat?tenant=1",
      uploadUrl: "https://agent.example.test/marketing/ai_custom_agents/openapi/storage/upload",
    },
  );
  assert.throws(
    () => resolveEducationAgentProxyEndpoints("http://agent.example.test"),
    (error) => error instanceof EducationAgentProxyError
      && error.code === "agent_proxy_insecure_endpoint",
  );
  assert.throws(
    () => resolveEducationAgentProxyEndpoints("https://user:password@agent.example.test"),
    (error) => error.code === "agent_proxy_invalid_endpoint",
  );
  for (const parameter of ["api_key", "apiKey", "key", "token", "access_token", "client-secret", "authorization"]) {
    assert.throws(
      () => resolveEducationAgentProxyEndpoints(`https://agent.example.test/chat?${parameter}=must-not-appear`),
      (error) => error instanceof EducationAgentProxyError
        && error.code === "agent_proxy_credential_query_forbidden",
    );
  }
});

test("streams real deltas, sends the documented body and never projects the key", async () => {
  const calls = [];
  const client = createEducationAgentProxyClient({
    getConfig: () => configuration(),
    idFactory: () => "trace-123",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return sseResponse([
        sseEvent("conversation.chat.created", {
          conversation_id: "conversation-1",
          chat_id: "chat-1",
        }),
        sseEvent("conversation.message.delta", { message_type: "answer", content_type: "text", content: "你" }),
        // The documented delta is incremental and is appended by message id.
        sseEvent("conversation.message.delta", { message_type: "answer", content_type: "text", content: "好" }),
        sseEvent("conversation.message.delta", { message_type: "answer", content_type: "text", content: "好" }),
        sseEvent("conversation.message.completed", { message_type: "answer", content_type: "text", content: "你好好" }),
        sseEvent("conversation.chat.completed", { status: "completed" }),
      ]);
    },
  });

  const events = await collect(client.streamConversation({
    content: "请讲解一次函数",
    conversationId: "previous-conversation",
    userId: "student-001",
    customPassThroughMap: { scene: "knowledge_tutor", privatePrototype: { __proto__: "drop" } },
  }));
  const deltas = events.filter((item) => item.type === "delta").map((item) => item.delta);
  const final = events.find((item) => item.type === "final");
  assert.deepEqual(deltas, ["你", "好", "好"]);
  assert.equal(final.answer, "你好好");
  assert.equal(final.conversation_id, "conversation-1");
  assert.equal(final.chat_id, "chat-1");
  assert.equal(final.mastery_write_authorized, false);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://agent.example.test/marketing/agent-control/openapi/conversation/chat",
  );
  assert.equal(calls[0].init.headers["x-api-key"], SECRET);
  assert.equal(calls[0].init.headers["x-trace-id"], "trace-123");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  const request = JSON.parse(calls[0].init.body);
  assert.deepEqual(request, {
    stream: true,
    enable_continue_event: false,
    continue_chat_id: "",
    continue_event_id: -1,
    custom_context: {},
    de_identification_replacement_fields: {},
    message: {
      content: "请讲解一次函数",
      content_type: "text",
      conversation_id: "previous-conversation",
    },
    metadata: {
      user_one_id: "student-001",
      custom_pass_through_map: {
        scene: "knowledge_tutor",
        privatePrototype: "{}",
      },
    },
  });
  assert.equal(JSON.stringify(events).includes(SECRET), false);
  assert.equal(JSON.stringify(client.configSummary()).includes(SECRET), false);
  assert.equal(client.configSummary().has_api_key, true);
});

test("redacts the key across arbitrary delta boundaries and all public trace fields", async () => {
  const answerChunks = ["重复文本 重复文本 ", ...SECRET, " 收尾"];
  const client = createEducationAgentProxyClient({
    config: configuration(),
    fetchImpl: async () => sseResponse([
      sseEvent("conversation.message.completed", {
        message_type: "tool_message",
        content_type: "tool_call",
        content: JSON.stringify({
          message: `工具执行 ${SECRET}`,
          tool_name: `probe-${SECRET}`,
          span_id: SECRET,
          parent_span_id: `parent-${SECRET}`,
          attributes: {
            [SECRET]: "credential-in-key",
            api_key: "credential-shaped-field",
            authorization: `Bearer ${SECRET}`,
            result_count: `2 ${SECRET}`,
            repeated_text: "重复文本 重复文本",
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

  const events = await collect(client.streamConversation({ content: "安全探针", userId: "student-safe" }));
  const trace = events.find((item) => item.type === "trace");
  const deltas = events.filter((item) => item.type === "delta").map((item) => item.delta);
  const final = events.find((item) => item.type === "final");

  assert.equal(deltas.join(""), "重复文本 重复文本 [已脱敏] 收尾");
  assert.equal(trace.span.span_id, null);
  assert.equal(trace.span.parent_span_id, null);
  assert.deepEqual(trace.span.attributes, {
    result_count: "2 [已脱敏]",
    repeated_text: "重复文本 重复文本",
  });
  assert.equal(final.answer, "重复文本 重复文本 [已脱敏] 收尾");
  assert.equal(JSON.stringify(events).includes(SECRET), false);
});

test("de-duplicates a replayed secret-prefix event before advancing the rolling redactor", async () => {
  const prefix = SECRET.slice(0, 14);
  const suffix = SECRET.slice(14);
  const delta = (eventId, content) => sseEvent("conversation.message.delta", {
    event_id: eventId,
    id: "message-secret-replay",
    message_type: "answer",
    content_type: "text",
    content,
  });
  const client = createEducationAgentProxyClient({
    config: configuration(),
    fetchImpl: async () => sseResponse([
      delta(1, prefix),
      delta(1, prefix),
      delta(2, `${suffix} 完成`),
      sseEvent("conversation.chat.completed", { status: "completed" }),
    ]),
  });

  const events = await collect(client.streamConversation({
    content: "测试重放分片",
    userId: "student-secret-replay",
  }));
  const publicText = events
    .filter((item) => item.type === "delta")
    .map((item) => item.delta)
    .join("");
  assert.equal(publicText, "[已脱敏] 完成");
  assert.equal(JSON.stringify(events).includes(SECRET), false);
});

test("uses JSON event_id for replay detection while all deltas retain the same message id", async () => {
  const answerEvent = (eventId) => JSON.stringify({
    event_id: eventId,
    id: "message-1",
    message_type: "answer",
    content_type: "text",
    content: "哈",
  });
  const client = createEducationAgentProxyClient({
    config: configuration(),
    fetchImpl: async () => sseResponse([
      // Some SSE implementations mirror the message id in native `id:`. It
      // must not override the JSON event_id, which uniquely identifies frames.
      `id: message-1\nevent: conversation.message.delta\ndata: ${answerEvent(1)}\n\n`,
      `id: message-1\nevent: conversation.message.delta\ndata: ${answerEvent(2)}\n\n`,
      `id: message-1\nevent: conversation.message.delta\ndata: ${answerEvent(2)}\n\n`,
      sseEvent("conversation.message.completed", {
        event_id: 3,
        id: "message-1",
        message_type: "answer",
        content_type: "text",
        content: "哈哈",
      }),
      sseEvent("conversation.chat.completed", { status: "completed" }),
    ]),
  });
  const events = await collect(client.streamConversation({
    content: "测试连续重复字",
    userId: "student-repeat",
  }));
  assert.deepEqual(
    events.filter((item) => item.type === "delta").map((item) => item.delta),
    ["哈", "哈"],
  );
  assert.equal(events.at(-1).answer, "哈哈");
});

test("uploads an image to the same origin before adding its platform_files entry", async () => {
  const calls = [];
  const client = createEducationAgentProxyClient({
    config: configuration({ endpoint: "https://agent.example.test/custom/chat" }),
    idFactory: () => "trace-image",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (String(url).endsWith("/storage/upload")) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            file_name: "题目.png",
            object_key: "openchat/object-1",
            storage_url: "tos://private-bucket/object-1",
            file_size: 3,
            content_type: "image/png",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return sseResponse([
        sseEvent("conversation.message.completed", {
          message_type: "answer",
          content_type: "text",
          content: "这是一道一次函数题。",
          conversation_id: "conversation-image",
        }),
        sseEvent("done", "[DONE]"),
      ]);
    },
  });

  const events = await collect(client.streamChat({
    content: "请解答图片题",
    userOneId: "student-image",
    image: {
      name: "题目.png",
      mime_type: "image/png",
      data: Buffer.from([1, 2, 3]).toString("base64"),
    },
  }));
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].url,
    "https://agent.example.test/marketing/ai_custom_agents/openapi/storage/upload",
  );
  assert.equal(calls[0].init.headers["content-type"], undefined);
  assert.equal(calls[0].init.headers["x-api-key"], SECRET);
  assert.equal(calls[0].init.body.get("namespace"), "openchat");
  assert.equal(calls[0].init.body.get("visibility"), "public");
  assert.equal(calls[0].init.body.get("file").name, "题目.png");
  assert.equal(calls[1].url, "https://agent.example.test/custom/chat");
  const request = JSON.parse(calls[1].init.body);
  assert.equal(request.message.conversation_id, "");
  assert.deepEqual(request.message.platform_files, [{
    url: "tos://private-bucket/object-1",
    name: "题目.png",
  }]);
  assert.equal(events[0].type, "status");
  assert.equal(events.at(-1).answer, "这是一道一次函数题。");
});

test("routes thinking/tool/retrieve/verbose to trace and double parses verbose references", async () => {
  const client = createEducationAgentProxyClient({
    config: configuration(),
    fetchImpl: async () => sseResponse([
      sseEvent("conversation.chat.created", { conversation_id: "c-rich", chat_id: "h-rich" }),
      sseEvent("conversation.message.delta", {
        message_type: "thinking",
        content_type: "text",
        content: `分析角度 ${SECRET}`,
        span_id: "span-thinking",
      }),
      sseEvent("conversation.message.completed", {
        message_type: "verbose",
        content_type: "text",
        content: JSON.stringify({
          message: "知识库召回完成",
          references: JSON.stringify([{
            id: "ref-1",
            title: "一次函数课标",
            url: "https://sources.example.test/linear",
          }, {
            title: "不安全来源",
            url: "javascript:alert(1)",
          }]),
        }),
      }),
      sseEvent("conversation.message.completed", {
        message_type: "tool_message",
        content_type: "tool_call",
        content: JSON.stringify({
          tool_name: "search_knowledge",
          status: "completed",
          duration_ms: 38,
          started_at: "2026-09-04T00:00:00.000Z",
          ended_at: "2026-09-04T00:00:00.038Z",
          input_summary: "检索一次函数",
          output_summary: "命中 2 条",
          attributes: { result_count: 2 },
        }),
      }),
      sseEvent("conversation.message.completed", {
        message_type: "knowledge_retrieve",
        content_type: "references",
        content: JSON.stringify({ message: "命中一次函数" }),
      }),
      sseEvent("conversation.message.delta", { message_type: "answer", content_type: "text", content: "一次函数" }),
      sseEvent("conversation.message.completed", { message_type: "answer", content_type: "text", content: "一次函数的图像是一条直线。" }),
      sseEvent("conversation.chat.completed", { status: "completed" }),
    ]),
  });

  const events = await collect(client.streamConversation({ content: "什么是一次函数", userId: "student-rich" }));
  const traces = events.filter((item) => item.type === "trace");
  const final = events.at(-1);
  assert.deepEqual(traces.map((item) => item.span.channel), [
    "thinking", "verbose", "tool", "retrieve",
  ]);
  assert.equal(traces[0].message.includes(SECRET), false);
  assert.equal(traces[0].message.includes("[已脱敏]"), true);
  assert.equal(traces[1].references.length, 2);
  assert.equal(traces[1].references[0].url, "https://sources.example.test/linear");
  assert.equal(traces[1].references[1].url, null);
  assert.equal(traces[2].span.name, "search_knowledge");
  assert.equal(traces[2].span.duration_ms, 38);
  assert.equal(traces[2].span.input_summary, "检索一次函数");
  assert.deepEqual(traces[2].span.attributes, { result_count: "2" });
  assert.equal(final.references.length, 2);
  assert.equal(final.answer, "一次函数的图像是一条直线。");
});

test("ignores non-JSON ping frames and treats completed answer content as authoritative", async () => {
  const client = createEducationAgentProxyClient({
    config: configuration(),
    fetchImpl: async () => sseResponse([
      sseEvent("ping", "keep-alive"),
      sseEvent("conversation.message.delta", {
        message_type: "thinking",
        content_type: "text",
        content: "这句话不能进入正文",
      }),
      sseEvent("conversation.message.delta", {
        message_type: "answer",
        content_type: "text",
        content: "一次函数是 y=ax",
      }),
      sseEvent("conversation.message.completed", {
        message_type: "answer",
        content_type: "text",
        content: "一次函数是 y=kx+b。",
      }),
      sseEvent("conversation.chat.completed", { status: "completed" }),
    ]),
  });
  const events = await collect(client.streamConversation({ content: "测试校准", userId: "student-calibrate" }));
  const final = events.at(-1);
  assert.equal(final.answer, "一次函数是 y=kx+b。");
  assert.equal(final.answer.includes("不能进入正文"), false);
  assert.equal(events.some((item) => item.type === "trace" && item.span.channel === "thinking"), true);
});

test("normalizes rich media and suggestions while rejecting provider markup and unsafe URLs", async () => {
  const client = createEducationAgentProxyClient({
    config: configuration(),
    fetchImpl: async () => sseResponse([
      sseEvent("conversation.message.completed", {
        message_type: "answer",
        content_type: "card",
        content: JSON.stringify({
          card_type: "article",
          article_card: {
            id: "card-1",
            title: `<script>alert(1)</script> 一次函数资料 ${SECRET}`,
            description: "<b>重点</b>：斜率与截距",
            url: "https://learn.example.test/linear",
            html: "<iframe src=javascript:alert(1)></iframe>",
            action: { type: "mastery.write", score: 100 },
          },
        }),
      }),
      sseEvent("conversation.message.completed", {
        message_type: "answer",
        content_type: "image",
        content: JSON.stringify({ image_url: "javascript:alert(1)", alt: "bad" }),
      }),
      sseEvent("conversation.message.completed", {
        message_type: "answer",
        content_type: "video",
        content: JSON.stringify({
          id: "video-1",
          title: "函数视频",
          video_url: "https://media.example.test/linear.mp4",
          cover_image: { image_url: "https://media.example.test/cover.png" },
        }),
      }),
      sseEvent("conversation.message.completed", {
        message_type: "answer",
        content_type: "audio",
        content: JSON.stringify({ id: "audio-1", audio_url: "https://media.example.test/read.mp3" }),
      }),
      sseEvent("conversation.message.completed", {
        message_type: "answer",
        content_type: "file",
        content: JSON.stringify({ id: "file-1", file_name: "讲义.pdf", file_url: "https://files.example.test/lesson.pdf" }),
      }),
      sseEvent("conversation.message.completed", {
        message_type: "suggestion",
        content_type: "suggestion",
        content: JSON.stringify({ suggestions: ["做一道练习", "<b>查看答案</b>"] }),
      }),
      sseEvent("conversation.message.completed", { message_type: "answer", content_type: "text", content: "先看图像的斜率。" }),
      sseEvent("done", "[DONE]"),
    ]),
  });

  const events = await collect(client.streamConversation({ content: "讲解一次函数", userId: "student-media" }));
  const final = events.at(-1);
  assert.equal(final.rich_results.cards.length, 1);
  assert.equal(final.rich_results.cards[0].title, "alert(1) 一次函数资料 [已脱敏]");
  assert.equal(final.rich_results.cards[0].summary, "重点 ：斜率与截距");
  assert.equal(Object.hasOwn(final.rich_results.cards[0], "html"), false);
  assert.equal(Object.hasOwn(final.rich_results.cards[0], "action"), false);
  assert.equal(final.rich_results.images.length, 0);
  assert.equal(final.rich_results.videos[0].url, "https://media.example.test/linear.mp4");
  assert.equal(final.attachments.audio[0].url, "https://media.example.test/read.mp3");
  assert.equal(final.attachments.files[0].name, "讲义.pdf");
  assert.deepEqual(final.suggestions, ["做一道练习", "查看答案"]);
  assert.equal(JSON.stringify(events).includes(SECRET), false);
});

test("standalone rich normalizer never accepts raw A2UI code or local media URLs", () => {
  const result = normalizeEducationAgentProxyRichContent({
    cards: [{
      type: "a2ui",
      html: "<script>alert(1)</script>",
      action: { type: "mastery.write" },
    }],
    images: [{ image_url: "https://127.0.0.1/private.png" }],
    videos: [{ id: "video-only-id", arbitrary: { secret: true } }],
    follow_ups: ["继续学习"],
  });
  assert.equal(result.rich_results.cards.length, 0);
  assert.equal(result.rich_results.images.length, 0);
  assert.deepEqual(result.rich_results.videos, [{
    id: "video-only-id",
    url: null,
    title: "",
    site_name: "",
    source_type: "",
    author_name: "",
    width: null,
    height: null,
    duration_ms: null,
    cover_image: null,
  }]);
  assert.deepEqual(result.suggestions, ["继续学习"]);
});

test("maps HTTP failures to controlled errors without returning the provider body or key", async () => {
  const client = createEducationAgentProxyClient({
    config: configuration(),
    fetchImpl: async () => new Response(
      JSON.stringify({ message: `invalid credential ${SECRET}`, debug: "internal stack" }),
      { status: 401, headers: { "content-type": "application/json" } },
    ),
  });
  await assert.rejects(
    () => collect(client.streamConversation({ content: "测试", userId: "student-error" })),
    (error) => {
      assert.ok(error instanceof EducationAgentProxyError);
      assert.equal(error.code, "agent_proxy_auth_failed");
      assert.equal(error.retryable, false);
      assert.equal(error.message.includes(SECRET), false);
      assert.equal(error.message.includes("internal stack"), false);
      return true;
    },
  );
});

test("enforces total timeout and caller cancellation", async () => {
  const waitForAbort = (_url, init) => new Promise((_resolve, reject) => {
    const rejectAbort = () => reject(new DOMException("aborted", "AbortError"));
    if (init.signal.aborted) rejectAbort();
    else init.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const timeoutClient = createEducationAgentProxyClient({
    config: configuration({ timeout_ms: 20 }),
    fetchImpl: waitForAbort,
  });
  await assert.rejects(
    () => collect(timeoutClient.streamConversation({ content: "慢请求", userId: "student-timeout" })),
    (error) => error.code === "agent_proxy_timeout" && error.retryable === true,
  );

  const controller = new AbortController();
  const cancelled = collect(timeoutClient.streamConversation({
    content: "取消请求",
    userId: "student-cancelled",
    signal: controller.signal,
    timeoutMs: 2_000,
  }));
  controller.abort();
  await assert.rejects(
    () => cancelled,
    (error) => error.code === "agent_proxy_cancelled" && error.status === 499,
  );
});

test("rejects oversized and incomplete SSE streams", async () => {
  const oversized = createEducationAgentProxyClient({
    config: configuration(),
    maxSseBytes: 32,
    fetchImpl: async () => sseResponse([sseEvent("conversation.message.delta", {
      message_type: "answer",
      content_type: "text",
      content: "x".repeat(100),
    })]),
  });
  await assert.rejects(
    () => collect(oversized.streamConversation({ content: "测试", userId: "student-large" })),
    (error) => error.code === "agent_proxy_response_too_large",
  );

  const incomplete = createEducationAgentProxyClient({
    config: configuration(),
    fetchImpl: async () => sseResponse([
      sseEvent("conversation.message.delta", { content_type: "text", content: "未完成" }),
    ]),
  });
  await assert.rejects(
    () => collect(incomplete.streamConversation({ content: "测试", userId: "student-incomplete" })),
    (error) => error.code === "agent_proxy_incomplete_stream" && error.retryable === true,
  );
});
