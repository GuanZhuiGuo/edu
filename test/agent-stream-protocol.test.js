import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentStreamError,
  consumeAgentNdjsonResponse
} from "../public/agent-stream-protocol.js";

function fragmentedResponse(parts) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      parts.forEach((part) => controller.enqueue(encoder.encode(part)));
      controller.close();
    }
  }), {
    headers: { "content-type": "application/x-ndjson" }
  });
}

test("consumes split NDJSON trace, status and real deltas before the terminal projection", async () => {
  const deltas = [];
  const traces = [];
  const statuses = [];
  const response = fragmentedResponse([
    '{"type":"status","stage":"request.accepted","message":"已接收"}\n',
    '{"type":"trace","stage":"retrieval.started","message":"正在检索"}\n{"type":"del',
    'ta","delta":"勾股"}\n{"type":"delta","delta":"定理"}\n',
    '{"type":"final","display_answer":"勾股定理","ui_mode":"structured"}\n'
  ]);
  const result = await consumeAgentNdjsonResponse(response, {
    onDelta: (delta) => deltas.push(delta),
    onTrace: (event) => traces.push(event.stage),
    onStatus: (event) => statuses.push(event.stage)
  });
  assert.deepEqual(deltas, ["勾股", "定理"]);
  assert.deepEqual(traces, ["retrieval.started"]);
  assert.deepEqual(statuses, ["request.accepted"]);
  assert.equal(result.display_answer, "勾股定理");
  assert.equal(result.ui_mode, "structured");
});

test("reports a visible first-event timeout instead of waiting forever", async () => {
  const response = new Response(new ReadableStream({
    start() {},
    cancel() {}
  }), {
    headers: { "content-type": "application/x-ndjson" }
  });
  await assert.rejects(
    () => consumeAgentNdjsonResponse(response, {
      firstEventTimeoutMs: 10,
      totalTimeoutMs: 100
    }),
    (error) => error instanceof AgentStreamError
      && error.code === "agent_stream_first_event_timeout"
  );
});

test("surfaces a non-stream HTTP error with its server message", async () => {
  const response = new Response(JSON.stringify({
    error: "education_agent_forbidden",
    message: "当前请求无权使用学习 Agent"
  }), {
    status: 403,
    headers: { "content-type": "application/json" }
  });
  await assert.rejects(
    () => consumeAgentNdjsonResponse(response),
    (error) => error instanceof AgentStreamError
      && error.code === "education_agent_forbidden"
      && error.message === "当前请求无权使用学习 Agent"
  );
});

test("surfaces a safe terminal stream error", async () => {
  const response = fragmentedResponse([
    '{"type":"error","code":"agent_busy","message":"请稍后重试","retryable":true}\n'
  ]);
  await assert.rejects(
    () => consumeAgentNdjsonResponse(response),
    (error) => {
      assert.ok(error instanceof AgentStreamError);
      assert.equal(error.code, "agent_busy");
      assert.equal(error.message, "请稍后重试");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("rejects a stream that closes without a final event", async () => {
  const response = fragmentedResponse(['{"type":"delta","delta":"未完成"}\n']);
  await assert.rejects(
    () => consumeAgentNdjsonResponse(response),
    (error) => error instanceof AgentStreamError && error.code === "agent_stream_incomplete"
  );
});
