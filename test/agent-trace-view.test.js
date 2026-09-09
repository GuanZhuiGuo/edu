import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentTraceModel,
  flattenAgentTraceTree,
  normalizeAgentTraceEvent,
  normalizePersistedAgentTrace
} from "../public/agent-trace-view.js";

test("normalizes the current flat stream and infers an honest span hierarchy", () => {
  const record = {
    id: "turn-1",
    status: "completed",
    startedAt: "2026-08-24T08:00:00.000Z",
    completedAt: "2026-08-24T08:00:01.200Z",
    userText: "请讲解勾股定理",
    assistantText: "勾股定理适用于直角三角形。",
    trace: [
      { stage: "scope.resolved", message: "已限定到 1 份教材", elapsed_ms: 8, trace_id: "pi-request:trace-1" },
      { stage: "cards.resolving", message: "正在确认知识卡片", elapsed_ms: 12 },
      { stage: "cards.resolved", message: "已确认 1 张卡片", elapsed_ms: 18 },
      { stage: "agent.started", message: "Pi Agent 已启动", elapsed_ms: 20 },
      { stage: "model.reasoning", message: "正在理解学习任务", elapsed_ms: 24 },
      { stage: "tool.retrieve_loaded_course_knowledge.started", message: "正在查询当前教材", elapsed_ms: 30 },
      { stage: "retrieval.started", message: "正在检索当前已加载教材", elapsed_ms: 32 },
      { stage: "retrieval.completed", message: "找到 2 个可引用知识候选", elapsed_ms: 70 },
      { stage: "tool.retrieve_loaded_course_knowledge.completed", message: "当前教材检索已返回", elapsed_ms: 72 },
      { stage: "agent.completed", message: "已生成有据可查的教学回答", elapsed_ms: 110 }
    ]
  };

  const model = buildAgentTraceModel(record);
  const flat = flattenAgentTraceTree(model.root);
  const byKey = new Map(flat.map(({ span, depth }) => [span.key, { span, depth }]));

  assert.equal(model.traceId, "pi-request:trace-1");
  assert.equal(model.status, "success");
  assert.equal(model.totalMs, 110);
  assert.equal(model.root.inputSummary, "请讲解勾股定理");
  assert.equal(model.root.outputSummary, "勾股定理适用于直角三角形。");
  assert.equal(byKey.get("agent").depth, 1);
  assert.equal(byKey.get("model").span.parentId, byKey.get("agent").span.id);
  assert.equal(byKey.get("tool:retrieve_loaded_course_knowledge").span.parentId, byKey.get("agent").span.id);
  assert.equal(byKey.get("retrieval").span.parentId, byKey.get("tool:retrieve_loaded_course_knowledge").span.id);
  assert.equal(byKey.get("retrieval").span.durationMs, 38);
  assert.equal(byKey.get("retrieval").span.status, "success");
  assert.equal(byKey.get("cards").span.durationMs, 6);
});

test("preserves optional span fields while limiting unsafe trace text", () => {
  const event = normalizeAgentTraceEvent({
    stage: "tool.search_reviewed_questions.completed<script>",
    message: "检索完成\n已找到题目",
    elapsed_ms: 52,
    duration_ms: 18,
    span_id: "span:questions",
    parent_span_id: "span:agent",
    kind: "lifecycle",
    input: { query: "勾股定理" },
    output: { count: 3 },
    error: { message: "" }
  });

  assert.equal(event.stage, "tool.search_reviewed_questions.completedscript");
  assert.equal(event.message, "检索完成 已找到题目");
  assert.equal(event.spanId, "span:questions");
  assert.equal(event.parentSpanId, "span:agent");
  assert.equal(event.kind, "lifecycle");
  assert.equal(event.durationMs, 18);
  assert.equal(event.inputSummary, '{"query":"勾股定理"}');
  assert.equal(event.outputSummary, '{"count":3}');
});

test("accepts persisted Trace payload with separate trace and spans", () => {
  const model = normalizePersistedAgentTrace({
    trace: {
      trace_id: "trace:persisted-1",
      status: "success",
      total_ms: 420,
      request: { message: "请出一道选择题" },
      summary: { answer: "已生成一道题" },
      started_at: "2026-08-24T08:00:00.000Z",
      ended_at: "2026-08-24T08:00:00.420Z"
    },
    spans: [
      {
        span_id: "span:agent",
        name: "Pi Agent",
        kind: "agent",
        status: "success",
        duration_ms: 400,
        sequence: 1,
        started_at: "2026-08-24T08:00:00.010Z",
        ended_at: "2026-08-24T08:00:00.410Z"
      },
      {
        span_id: "span:tool",
        parent_span_id: "span:agent",
        name: "检索教材",
        kind: "tool",
        status: "success",
        duration_ms: 120,
        sequence: 2,
        input: { query: "一次函数" },
        output: { candidates: 4 },
        started_at: "2026-08-24T08:00:00.050Z",
        ended_at: "2026-08-24T08:00:00.170Z"
      }
    ]
  });

  const flat = flattenAgentTraceTree(model.root);
  const agent = flat.find(({ span }) => span.id === "span:agent");
  const tool = flat.find(({ span }) => span.id === "span:tool");
  assert.equal(model.persisted, true);
  assert.equal(model.traceId, "trace:persisted-1");
  assert.equal(model.totalMs, 420);
  assert.equal(model.root.inputSummary, "请出一道选择题");
  assert.equal(model.root.outputSummary, "已生成一道题");
  assert.equal(agent.depth, 1);
  assert.equal(tool.depth, 2);
  assert.equal(tool.span.parentId, "span:agent");
  assert.equal(tool.span.inputSummary, '{"query":"一次函数"}');
  assert.equal(tool.span.outputSummary, '{"candidates":4}');
});

test("also accepts a top-level persisted Trace payload", () => {
  const model = buildAgentTraceModel(
    { id: "fallback", status: "completed" },
    {
      id: "trace:top-level",
      status: "completed",
      total_ms: 90,
      request_json: '{"message":"图片题"}',
      summary_json: '{"answer":"解答完成"}',
      spans: []
    }
  );
  assert.equal(model.traceId, "trace:top-level");
  assert.equal(model.status, "success");
  assert.equal(model.root.inputSummary, "图片题");
  assert.equal(model.root.outputSummary, "解答完成");
});

test("presents the textbook miss and Doubao Aixue answer as one Chinese fallback group", () => {
  const model = normalizePersistedAgentTrace({
    trace: {
      trace_id: "trace:external-fallback",
      status: "success",
      total_ms: 360,
      started_at: "2026-08-24T08:00:00.000Z",
      ended_at: "2026-08-24T08:00:00.360Z"
    },
    spans: [
      {
        span_id: "span:fallback-decision",
        name: "external_fallback_decision",
        kind: "control",
        status: "success",
        duration_ms: 0,
        sequence: 1,
        output: { reason: "no_match" },
        started_at: "2026-08-24T08:00:00.080Z",
        ended_at: "2026-08-24T08:00:00.080Z"
      },
      {
        span_id: "span:aixue-answer",
        name: "doubao_aixue_answer",
        kind: "tool",
        status: "success",
        duration_ms: 250,
        sequence: 2,
        output: { status: "external_answered" },
        started_at: "2026-08-24T08:00:00.090Z",
        ended_at: "2026-08-24T08:00:00.340Z"
      }
    ]
  });

  const flat = flattenAgentTraceTree(model.root);
  const decision = flat.find(({ span }) => span.id === "span:fallback-decision");
  const answer = flat.find(({ span }) => span.id === "span:aixue-answer");
  assert.equal(decision.span.name, "教材未命中 → 豆包爱学补充回答");
  assert.equal(decision.span.kind, "control");
  assert.equal(decision.depth, 1);
  assert.equal(answer.span.name, "豆包爱学补充回答");
  assert.equal(answer.span.kind, "tool");
  assert.equal(answer.span.parentId, decision.span.id);
  assert.equal(answer.depth, 2);
});
