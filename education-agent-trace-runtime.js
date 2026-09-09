import { randomUUID } from "node:crypto";

const COMPLETION_SUFFIX = /\.(?:completed|resolved|validated|no_match)$/u;
const START_SUFFIX = /\.(?:started|requested|resolving)$/u;

/**
 * Request-scoped Trace recorder for the education Agent.
 *
 * The HTTP layer owns identity and persistence. Model/runtime events are only
 * observations: they cannot choose the trace id, student or database scope.
 */
export function createEducationAgentTraceRuntime({
  store,
  tenantId,
  traceId,
  conversationId,
  messageId,
  studentId,
  skillId,
  request = {},
  clock = () => new Date(),
} = {}) {
  assertTraceStore(store);
  const started = asDate(clock());
  const safeTraceId = String(traceId || `agent-trace:${randomUUID()}`);
  let sequence = 0;
  let finished = false;
  let firstDeltaAt = null;
  let deltaCount = 0;
  let deltaCharacters = 0;
  const openByKey = new Map();
  const activeParents = [];
  const explicitSpanKeys = new Set();

  store.createAgentTrace({
    tenantId,
    trace: {
      trace_id: safeTraceId,
      conversation_id: conversationId,
      message_id: messageId,
      student_id: studentId,
      request_id: traceId,
      skill_id: skillId,
      status: "running",
      request,
      started_at: started.toISOString(),
    },
  });

  function startSpan(name, {
    kind = "internal",
    input = {},
    parentSpanId,
    key = name,
    startedAt = clock(),
  } = {}) {
    const spanId = `span:${randomUUID()}`;
    const span = {
      span_id: spanId,
      parent_span_id: parentSpanId === undefined
        ? activeParents.at(-1)?.span_id || null
        : parentSpanId,
      sequence: sequence++,
      name,
      kind,
      status: "running",
      input,
      output: {},
      started_at: asDate(startedAt).toISOString(),
    };
    store.upsertAgentTraceSpan({ tenantId, traceId: safeTraceId, span });
    if (key) openByKey.set(key, span);
    return span;
  }

  function endSpan(spanOrKey, {
    status = "success",
    output = {},
    error = {},
    endedAt = clock(),
  } = {}) {
    const span = typeof spanOrKey === "string"
      ? openByKey.get(spanOrKey)
      : spanOrKey;
    if (!span) return null;
    const ended = asDate(endedAt);
    const duration = Math.max(0, ended.getTime() - asDate(span.started_at).getTime());
    const completed = {
      ...span,
      status,
      duration_ms: duration,
      output,
      error,
      ended_at: ended.toISOString(),
    };
    store.upsertAgentTraceSpan({ tenantId, traceId: safeTraceId, span: completed });
    for (const [key, value] of openByKey.entries()) {
      if (value.span_id === span.span_id) openByKey.delete(key);
    }
    return completed;
  }

  async function withSpan(name, options, handler) {
    const settings = options && typeof options === "object" ? options : {};
    const span = startSpan(name, settings);
    activeParents.push(span);
    try {
      const result = await handler();
      endSpan(span, {
        status: "success",
        output: typeof settings.projectOutput === "function"
          ? settings.projectOutput(result)
          : result,
      });
      return result;
    } catch (error) {
      endSpan(span, {
        status: "error",
        error: projectError(error),
      });
      throw error;
    } finally {
      const index = activeParents.findLastIndex((item) => item.span_id === span.span_id);
      if (index >= 0) activeParents.splice(index, 1);
    }
  }

  function checkpoint(name, { kind = "lifecycle", input = {}, output = {}, at = clock() } = {}) {
    const span = startSpan(name, { kind, input, key: null, startedAt: at });
    return endSpan(span, { output, endedAt: at });
  }

  function observe(event) {
    if (!event || typeof event !== "object" || finished) return;
    if (event.type === "delta") {
      if (![
        "grounded_model_stream",
        "validated_teaching_package",
        "external_web_stream",
      ].includes(String(event.source || ""))) {
        return;
      }
      const now = asDate(clock());
      if (!firstDeltaAt) firstDeltaAt = now;
      deltaCount += 1;
      deltaCharacters += String(event.delta || "").length;
      return;
    }
    if (event.type === "span_start") {
      const explicitKey = String(
        event.span_key || event.span_id || event.name || event.stage || "runtime.span",
      );
      explicitSpanKeys.add(explicitKey);
      startSpan(String(event.name || event.stage || "runtime.span"), {
        key: explicitKey,
        kind: String(event.kind || "internal"),
        input: event.input || {},
        // Omit the parent when the runtime event does not name one so the
        // currently active HTTP/Agent span remains the authoritative parent.
        parentSpanId: event.parent_span_id || undefined,
      });
      return;
    }
    if (event.type === "span_end") {
      const explicitKey = String(
        event.span_key || event.span_id || event.name || event.stage || "runtime.span",
      );
      endSpan(explicitKey, {
        status: event.status || "success",
        output: event.output || {},
        error: event.error || {},
      });
      explicitSpanKeys.delete(explicitKey);
      return;
    }
    if (event.type !== "trace") return;
    const stage = String(event.stage || "agent.event");
    const key = spanKeyForStage(stage);
    // A structured runtime span owns this stage pair. Do not let the legacy
    // trace compatibility path close it early and replace its safe metrics
    // with only stage/message text.
    if (explicitSpanKeys.has(key)) return;
    if (START_SUFFIX.test(stage)) {
      if (!openByKey.has(key)) {
        startSpan(spanNameForStage(stage), {
          key,
          kind: spanKindForStage(stage),
          input: { stage, message: event.message || "" },
        });
      }
      return;
    }
    if (COMPLETION_SUFFIX.test(stage) && openByKey.has(key)) {
      endSpan(key, { output: { stage, message: event.message || "" } });
      return;
    }
    if (["package.validated", "agent.completed"].includes(stage)) {
      checkpoint(spanNameForStage(stage), {
        kind: spanKindForStage(stage),
        output: { stage, message: event.message || "" },
      });
    }
  }

  function finish(status = "success", summary = {}) {
    if (finished) return null;
    finished = true;
    const ended = asDate(clock());
    for (const span of [...new Set(openByKey.values())]) {
      endSpan(span, {
        status: status === "success" ? "success" : status,
        output: status === "success" ? { closed_by: "trace.finish" } : {},
        error: status === "success" ? {} : summary?.error || {},
        endedAt: ended,
      });
    }
    if (deltaCount) {
      checkpoint("response_stream", {
        kind: "stream",
        input: { source: "provider_incremental_output" },
        output: {
          first_delta_ms: Math.max(0, firstDeltaAt.getTime() - started.getTime()),
          delta_count: deltaCount,
          character_count: deltaCharacters,
        },
        at: ended,
      });
    }
    return store.finishAgentTrace({
      tenantId,
      traceId: safeTraceId,
      studentId,
      status,
      totalMs: Math.max(0, ended.getTime() - started.getTime()),
      summary: {
        ...summary,
        first_delta_ms: firstDeltaAt ? Math.max(0, firstDeltaAt.getTime() - started.getTime()) : null,
        delta_count: deltaCount,
        delta_characters: deltaCharacters,
      },
      endedAt: ended.toISOString(),
    });
  }

  return Object.freeze({
    traceId: safeTraceId,
    startSpan,
    endSpan,
    withSpan,
    checkpoint,
    observe,
    finish,
  });
}

function spanKeyForStage(stage) {
  return String(stage)
    .replace(/\.(?:started|requested|resolving|completed|resolved|validated|no_match)$/u, "")
    .replace(/^tool\.(.+)$/u, "tool.$1");
}

function spanNameForStage(stage) {
  const key = spanKeyForStage(stage);
  const names = {
    "model": "model_response",
    "retrieval": "hybrid_knowledge_retrieval",
    "package": "teaching_package_validation",
    "agent": "pi_agent_runtime",
  };
  if (key.startsWith("tool.")) return key.replace(/\./gu, "_");
  return names[key] || key.replace(/\./gu, "_");
}

function spanKindForStage(stage) {
  if (stage.startsWith("tool.")) return "tool";
  if (stage.startsWith("retrieval.")) return "retrieval";
  if (stage.startsWith("model.")) return "model";
  if (stage.startsWith("package.")) return "validation";
  return "lifecycle";
}

function projectError(error) {
  return {
    name: String(error?.name || "Error").slice(0, 120),
    code: String(error?.code || "").slice(0, 160),
    message: String(error?.message || "Agent Trace span failed").slice(0, 1_000),
  };
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function assertTraceStore(store) {
  const required = ["createAgentTrace", "upsertAgentTraceSpan", "finishAgentTrace"];
  if (!store || required.some((name) => typeof store[name] !== "function")) {
    throw new TypeError("Education Agent Trace store is required");
  }
}
