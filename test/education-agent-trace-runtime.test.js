import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEducationAgentTraceRuntime } from "../education-agent-trace-runtime.js";
import { createEducationDataStore } from "../education-data-store.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "education-agent-trace-"));
  const store = createEducationDataStore({ filename: join(directory, "runtime.sqlite") });
  store.initialize();
  store.upsertTenant({ tenantId: "tenant-a", name: "A" });
  store.upsertStudent({ tenantId: "tenant-a", student: { id: "student-a", name: "陈同学" } });
  return store;
}

test("Agent Trace persists spans, stream metrics and redacts secrets", async () => {
  const store = fixture();
  let now = Date.parse("2026-08-24T00:00:00.000Z");
  const runtime = createEducationAgentTraceRuntime({
    store,
    tenantId: "tenant-a",
    traceId: "trace-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    studentId: "student-a",
    skillId: "knowledge_tutor",
    request: { message: "讲解勾股定理", authorization: "Bearer secret-token" },
    clock: () => new Date(now),
  });

  runtime.observe({ type: "trace", stage: "retrieval.started", message: "开始检索" });
  now += 120;
  runtime.observe({ type: "trace", stage: "retrieval.completed", message: "命中 2 条" });
  now += 80;
  runtime.observe({ type: "delta", source: "grounded_model_stream", delta: "勾股" });
  now += 30;
  runtime.observe({ type: "delta", source: "validated_teaching_package", delta: "定理" });
  now += 20;
  runtime.finish("success", { provider: "Ark", api_key: "ark-secret-value" });

  const trace = store.getAgentTrace({ tenantId: "tenant-a", traceId: "trace-1", studentId: "student-a" });
  assert.equal(trace.status, "success");
  assert.equal(trace.total_ms, 250);
  assert.equal(trace.summary.delta_count, 2);
  assert.equal(trace.summary.first_delta_ms, 200);
  assert.equal(trace.summary.api_key, "[REDACTED]");
  assert.equal(trace.request.authorization, "[REDACTED]");
  assert.ok(trace.spans.some((span) => span.name === "hybrid_knowledge_retrieval" && span.duration_ms === 120));
  assert.ok(trace.spans.some((span) => span.name === "response_stream"));
  store.close();
});

test("Agent Trace reads are student scoped", () => {
  const store = fixture();
  store.upsertStudent({ tenantId: "tenant-a", student: { id: "student-b", name: "周同学" } });
  const runtime = createEducationAgentTraceRuntime({
    store,
    tenantId: "tenant-a",
    traceId: "trace-private",
    conversationId: "conversation-private",
    messageId: "message-private",
    studentId: "student-a",
    skillId: "photo_solver",
  });
  runtime.finish();
  assert.equal(store.getAgentTrace({ tenantId: "tenant-a", traceId: "trace-private", studentId: "student-b" }), null);
  assert.equal(store.listAgentTraces({
    tenantId: "tenant-a",
    studentId: "student-a",
    conversationId: "conversation-private",
  }).length, 1);
  store.close();
});

test("external AskEcho deltas contribute first-output and stream metrics", () => {
  const store = fixture();
  let now = Date.parse("2026-08-24T00:00:00.000Z");
  const runtime = createEducationAgentTraceRuntime({
    store,
    tenantId: "tenant-a",
    traceId: "trace-external-fallback",
    conversationId: "conversation-external-fallback",
    messageId: "message-external-fallback",
    studentId: "student-a",
    skillId: "knowledge_tutor",
    clock: () => new Date(now),
  });

  now += 75;
  runtime.observe({ type: "delta", source: "external_web_stream", delta: "豆包爱学" });
  now += 25;
  runtime.finish("success", { provider: "Volcengine Education Bot" });

  const trace = store.getAgentTrace({
    tenantId: "tenant-a",
    traceId: "trace-external-fallback",
    studentId: "student-a",
  });
  assert.equal(trace.summary.first_delta_ms, 75);
  assert.equal(trace.summary.delta_count, 1);
  assert.equal(trace.summary.delta_characters, 4);
  const stream = trace.spans.find((span) => span.name === "response_stream");
  assert.equal(stream.output.first_delta_ms, 75);
  assert.equal(stream.output.delta_count, 1);
  assert.equal(stream.output.character_count, 4);
  store.close();
});

test("structured retrieval spans remain children of the Agent span and persist only safe metrics", async () => {
  const store = fixture();
  const runtime = createEducationAgentTraceRuntime({
    store,
    tenantId: "tenant-a",
    traceId: "trace-structured",
    conversationId: "conversation-structured",
    messageId: "message-structured",
    studentId: "student-a",
    skillId: "knowledge_tutor",
  });

  await runtime.withSpan("pi_agent_runtime", { kind: "agent" }, async () => {
    runtime.observe({
      type: "span_start",
      span_key: "retrieval.round1",
      name: "retrieval_round1",
      kind: "retrieval",
      input: { query_count: 1, candidate_count: 0 },
    });
    runtime.observe({
      type: "trace",
      stage: "retrieval.round1.started",
      message: "正在检索",
    });
    runtime.observe({
      type: "trace",
      stage: "retrieval.round1.completed",
      message: "找到 1 个候选",
    });
    runtime.observe({
      type: "span_end",
      span_key: "retrieval.round1",
      output: {
        status: "retrieved",
        query_count: 1,
        candidate_count: 1,
        top_candidates: [{ id: "M4-GE-TRI-10", title: "勾股定理", rank: 1, score: 0.01639344 }],
      },
    });
  });
  runtime.finish("success");

  const trace = store.getAgentTrace({
    tenantId: "tenant-a",
    traceId: "trace-structured",
    studentId: "student-a",
  });
  const parent = trace.spans.find((span) => span.name === "pi_agent_runtime");
  const child = trace.spans.find((span) => span.name === "retrieval_round1");
  assert.equal(child.parent_span_id, parent.span_id);
  assert.deepEqual(child.input, { query_count: 1, candidate_count: 0 });
  assert.equal(child.output.top_candidates[0].id, "M4-GE-TRI-10");
  assert.equal(child.output.status, "retrieved");
  assert.equal(child.output.stage, undefined);
  assert.equal(trace.spans.filter((span) => span.name === "retrieval_round1").length, 1);
  assert.doesNotMatch(JSON.stringify(child), /evidence_excerpt|SERVER_RETRIEVAL_CONTEXT|USER_INPUT/u);
  store.close();
});
