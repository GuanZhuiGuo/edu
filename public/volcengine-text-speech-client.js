const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000;
const MAX_EVENT_CHARACTERS = 2 * 1024 * 1024;

export class TextSpeechStreamError extends Error {
  constructor(message, { code = "text_speech_stream_error", retryable = true } = {}) {
    super(message);
    this.name = "TextSpeechStreamError";
    this.code = code;
    this.retryable = Boolean(retryable);
  }
}

export async function consumeTextSpeechNdjson(response, {
  onStarted,
  onAudio,
  onAudioDone,
  onEvent,
  firstEventTimeoutMs = DEFAULT_FIRST_EVENT_TIMEOUT_MS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS
} = {}) {
  const contentType = String(response?.headers?.get?.("content-type") || "").toLowerCase();
  if (!contentType.includes("application/x-ndjson")) {
    const payload = await readErrorPayload(response);
    throw new TextSpeechStreamError(
      String(payload?.message || `火山语音请求失败（${Number(response?.status) || 0}）`),
      {
        code: String(payload?.error || payload?.code || "text_speech_http_error"),
        retryable: Number(response?.status) >= 500
      }
    );
  }
  if (!response?.body || typeof response.body.getReader !== "function") {
    throw new TextSpeechStreamError("无法读取火山语音流", {
      code: "text_speech_stream_unreadable"
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  let buffer = "";
  let eventCount = 0;
  let audioChunks = 0;
  let completed = false;

  const consumeLine = async (rawLine) => {
    const line = String(rawLine || "").trim();
    if (!line) return;
    if (line.length > MAX_EVENT_CHARACTERS) {
      throw new TextSpeechStreamError("火山语音分片过大", {
        code: "text_speech_event_too_large",
        retryable: false
      });
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new TextSpeechStreamError("火山语音返回了无法读取的流式数据", {
        code: "text_speech_invalid_json"
      });
    }
    eventCount += 1;
    if (typeof onEvent === "function") await onEvent(event);

    if (event?.type === "tts.audio.started") {
      if (typeof onStarted === "function") await onStarted(event);
      return;
    }
    if (event?.type === "tts.audio.delta") {
      const delta = String(event.delta || event.audio || "");
      if (delta) {
        audioChunks += 1;
        if (typeof onAudio === "function") await onAudio({ ...event, delta });
      }
      return;
    }
    if (event?.type === "tts.audio.done") {
      if (typeof onAudioDone === "function") await onAudioDone(event);
      return;
    }
    if (event?.type === "tts.done") {
      completed = true;
      return;
    }
    if (event?.type === "tts.error" || event?.type === "error") {
      throw new TextSpeechStreamError(
        String(event.message || "火山语音暂时无法播放"),
        {
          code: String(event.code || "text_speech_remote_error"),
          retryable: event.retryable !== false
        }
      );
    }
  };

  try {
    while (true) {
      const elapsed = Date.now() - startedAt;
      const remaining = normalizeTimeout(totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS) - elapsed;
      if (remaining <= 0) {
        throw new TextSpeechStreamError("火山语音合成超时", {
          code: "text_speech_total_timeout"
        });
      }
      const idleBudget = eventCount === 0
        ? normalizeTimeout(firstEventTimeoutMs, DEFAULT_FIRST_EVENT_TIMEOUT_MS)
        : normalizeTimeout(idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS);
      const { value, done } = await readWithTimeout(reader, Math.min(remaining, idleBudget));
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_EVENT_CHARACTERS) {
        throw new TextSpeechStreamError("火山语音流内容过大", {
          code: "text_speech_buffer_too_large",
          retryable: false
        });
      }
      let boundary = buffer.indexOf("\n");
      while (boundary >= 0) {
        await consumeLine(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
        boundary = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await consumeLine(buffer);
  } catch (error) {
    try {
      await reader.cancel(error?.message || "text_speech_stream_stopped");
    } catch {
      // Fetch aborts and upstream closes can settle the stream first.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!completed || audioChunks === 0) {
    throw new TextSpeechStreamError("火山语音流未完整结束，请重试", {
      code: "text_speech_stream_incomplete"
    });
  }
  return { completed, audioChunks };
}

async function readWithTimeout(reader, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new TextSpeechStreamError("火山语音较长时间没有新音频", {
            code: "text_speech_idle_timeout"
          }));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorPayload(response) {
  try {
    return JSON.parse(String(await response?.text?.() || "").slice(0, 16_000));
  } catch {
    return null;
  }
}

function normalizeTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : fallback;
}
