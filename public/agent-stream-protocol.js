const MAX_LINE_CHARACTERS = 2 * 1024 * 1024;
const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 360_000;

export class AgentStreamError extends Error {
  constructor(message, { code = "agent_stream_error", retryable = true } = {}) {
    super(message);
    this.name = "AgentStreamError";
    this.code = code;
    this.retryable = Boolean(retryable);
  }
}

export async function consumeAgentNdjsonResponse(response, {
  onDelta,
  onTrace,
  onStatus,
  onEvent,
  firstEventTimeoutMs = DEFAULT_FIRST_EVENT_TIMEOUT_MS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS
} = {}) {
  const contentType = String(response?.headers?.get?.("content-type") || "").toLowerCase();
  if (!contentType.includes("application/x-ndjson")) {
    const payload = await readNonStreamError(response);
    throw new AgentStreamError(
      String(payload?.message || `AI教师请求失败（${Number(response?.status) || 0}）`),
      {
        code: String(payload?.error || payload?.code || "agent_stream_http_error"),
        retryable: Number(response?.status) >= 500
      }
    );
  }
  if (!response?.body || typeof response.body.getReader !== "function") {
    throw new AgentStreamError("无法读取AI教师的流式回复", {
      code: "agent_stream_unreadable"
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalEvent = null;
  let eventCount = 0;
  const startedAt = Date.now();

  const consumeLine = async (rawLine) => {
    const line = String(rawLine || "").trim();
    if (!line) return;
    if (line.length > MAX_LINE_CHARACTERS) {
      throw new AgentStreamError("AI教师回复内容过长", {
        code: "agent_stream_line_too_large",
        retryable: false
      });
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new AgentStreamError("AI教师返回了无法读取的流式数据", {
        code: "agent_stream_invalid_json"
      });
    }

    eventCount += 1;
    if (typeof onEvent === "function") await onEvent(event);

    if (event?.type === "delta") {
      const delta = String(event.delta || "");
      if (delta && typeof onDelta === "function") await onDelta(delta, event);
      return;
    }
    if (event?.type === "trace") {
      if (typeof onTrace === "function") await onTrace(event);
      return;
    }
    if (event?.type === "status") {
      if (typeof onStatus === "function") await onStatus(event);
      return;
    }
    if (event?.type === "final") {
      finalEvent = event;
      return;
    }
    if (event?.type === "error") {
      throw new AgentStreamError(
        String(event.message || "AI教师暂时无法回复，请稍后重试"),
        {
          code: String(event.code || "agent_stream_remote_error"),
          retryable: event.retryable !== false
        }
      );
    }
  };

  try {
    while (true) {
      const totalRemaining = normalizeTimeout(totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS)
        - (Date.now() - startedAt);
      const eventTimeout = eventCount === 0
        ? normalizeTimeout(firstEventTimeoutMs, DEFAULT_FIRST_EVENT_TIMEOUT_MS)
        : normalizeTimeout(idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
      const timeoutKind = totalRemaining <= eventTimeout
        ? "total"
        : eventCount === 0 ? "first" : "idle";
      const { value, done } = await readStreamChunk(
        reader,
        Math.max(1, Math.min(totalRemaining, eventTimeout)),
        timeoutKind
      );
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_LINE_CHARACTERS) {
        throw new AgentStreamError("AI教师回复内容过长", {
          code: "agent_stream_buffer_too_large",
          retryable: false
        });
      }
      let boundary = buffer.indexOf("\n");
      while (boundary >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        await consumeLine(line);
        boundary = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await consumeLine(buffer);
  } catch (error) {
    try {
      await reader.cancel(error?.message || "agent_stream_stopped");
    } catch {
      // The underlying fetch may already have been aborted by the caller.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!finalEvent) {
    throw new AgentStreamError("AI教师的回复未完成，请重试", {
      code: "agent_stream_incomplete"
    });
  }
  return finalEvent;
}

async function readStreamChunk(reader, timeoutMs, kind) {
  let timeoutId;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const definitions = {
            first: ["AI教师未开始响应，请重试", "agent_stream_first_event_timeout"],
            idle: ["AI教师较长时间没有新进展，请重试", "agent_stream_idle_timeout"],
            total: ["AI教师处理超时，请缩小问题范围后重试", "agent_stream_total_timeout"]
          };
          const [message, code] = definitions[kind] || definitions.idle;
          reject(new AgentStreamError(message, { code, retryable: true }));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readNonStreamError(response) {
  try {
    const text = String(await response?.text?.() || "").slice(0, 16_000);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeTimeout(value, fallback) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(1, Math.round(result)) : fallback;
}
