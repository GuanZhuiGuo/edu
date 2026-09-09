import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const STREAM_PATH = "/api/voice/tts/stream";
const DEFAULT_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue";
const DEFAULT_MODEL = "1.2.6.0";
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TEXT_LENGTH = 8_000;
const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_MAX_CONCURRENT = 8;
const OUTPUT_SAMPLE_RATE = 24_000;
const INPUT_SAMPLE_RATE = 16_000;

export const VOLCENGINE_TEXT_TTS_VOICES = Object.freeze([
  "zh_female_vv_jupiter_bigtts",
  "zh_female_xiaohe_jupiter_bigtts",
  "zh_male_yunzhou_jupiter_bigtts",
  "zh_male_xiaotian_jupiter_bigtts",
  "saturn_zh_female_chengshujiejie_tob",
  "saturn_zh_female_keainvsheng_tob",
  "saturn_zh_female_nuanxinxuejie_tob",
  "saturn_zh_female_wenrouwenya_tob",
  "saturn_zh_male_cixingnansang_tob",
  "saturn_zh_male_fengfashaonian_tob",
  "en_male_tim_uranus_bigtts",
  "en_female_dacey_uranus_bigtts",
  "en_female_stokie_uranus_bigtts",
]);

const VOICE_SET = new Set(VOLCENGINE_TEXT_TTS_VOICES);

export class VolcengineTextTtsError extends Error {
  constructor(code, message, { status = 500, retryable = false } = {}) {
    super(message);
    this.name = "VolcengineTextTtsError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function createVolcengineTextTtsService({
  env = process.env,
  WebSocketImpl = WebSocket,
  requestTimeoutMs,
  maxConcurrent,
} = {}) {
  const config = normalizeServiceConfig({ env, requestTimeoutMs, maxConcurrent });
  const active = new Map();

  function configSummary() {
    return {
      provider: "volcengine_duplex_short_session",
      transport: "server_ndjson_stream",
      configured: Boolean(config.apiKey && isWebSocketEndpoint(config.endpoint) && config.model),
      credential_env: "DOUBAO_API_KEY",
      endpoint_host: safeEndpointHost(config.endpoint),
      model: config.model,
      output: {
        format: "pcm_s16le",
        sample_rate: OUTPUT_SAMPLE_RATE,
        channels: 1,
      },
      request_timeout_ms: config.requestTimeoutMs,
      max_text_characters: MAX_TEXT_LENGTH,
      max_concurrent: config.maxConcurrent,
      voices: [...config.voices],
      isolation: "one_upstream_session_per_playback",
    };
  }

  function prepareRequest(input) {
    return normalizeTtsRequest(input, config);
  }

  async function synthesize(input, { signal, onEvent } = {}) {
    const request = prepareRequest(input);
    if (!configSummary().configured) {
      throw new VolcengineTextTtsError(
        "tts_not_configured",
        "火山文字播报尚未配置",
        { status: 503, retryable: false },
      );
    }
    if (signal?.aborted) throw createAbortError();
    if (active.has(request.playback_id)) {
      throw new VolcengineTextTtsError(
        "tts_playback_conflict",
        "该播报任务正在进行中",
        { status: 409, retryable: false },
      );
    }
    if (active.size >= config.maxConcurrent) {
      throw new VolcengineTextTtsError(
        "tts_capacity_exceeded",
        "当前播报任务较多，请稍后重试",
        { status: 429, retryable: true },
      );
    }

    let socket;
    try {
      socket = new WebSocketImpl(config.endpoint, {
        headers: { "X-Api-Key": config.apiKey },
        handshakeTimeout: Math.min(config.requestTimeoutMs, 10_000),
      });
    } catch {
      throw new VolcengineTextTtsError(
        "tts_upstream_connect_failed",
        "语音合成服务连接失败",
        { status: 502, retryable: true },
      );
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let completing = false;
      let commitSent = false;
      let audioStarted = false;
      let audioDone = false;
      let audioChunkCount = 0;
      let audioByteCount = 0;
      let delivery = Promise.resolve();

      const removeListeners = [];
      const emit = (event) => {
        delivery = delivery.then(async () => {
          if (settled) return;
          if (typeof onEvent === "function") await onEvent(event);
        });
        delivery.catch((error) => fail(error?.code === "tts_aborted" ? error : createAbortError()));
        return delivery;
      };
      const timeout = setTimeout(() => {
        fail(new VolcengineTextTtsError(
          "tts_timeout",
          "语音合成等待超时，请重试",
          { status: 504, retryable: true },
        ));
      }, config.requestTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        for (const remove of removeListeners.splice(0)) remove();
        active.delete(request.playback_id);
      };
      const closeSocket = ({ graceful = false } = {}) => {
        if (!socket) return;
        // Closing a `ws` instance while it is still CONNECTING emits an
        // asynchronous error. Keep a terminal guard after business listeners
        // are removed so browser cancellation cannot crash the process.
        const removeTerminalGuard = addSocketTerminalErrorGuard(socket);
        try {
          if (graceful && socket.readyState === socketOpenState(WebSocketImpl)) {
            socket.send(JSON.stringify({
              event_id: makeEventId("tts_close"),
              type: "session.close",
            }));
          }
        } catch {
          // The result has already been settled; closing is best effort.
        }
        try {
          socket.close();
        } catch {
          try {
            socket.terminate?.();
          } catch {
            removeTerminalGuard();
          }
        }
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        closeSocket();
        reject(normalizeRuntimeError(error));
      };
      const complete = () => {
        if (settled || completing) return;
        completing = true;
        void (async () => {
          if (audioChunkCount === 0 || audioByteCount === 0) {
            fail(new VolcengineTextTtsError(
              "tts_no_audio",
              "语音合成未返回可播放音频，请重试",
              { status: 502, retryable: true },
            ));
            return;
          }
          if (!audioDone) {
            audioDone = true;
            await emit({
              type: "tts.audio.done",
              playback_id: request.playback_id,
              format: "pcm_s16le",
              sample_rate: OUTPUT_SAMPLE_RATE,
            });
          }
          await emit({
            type: "tts.done",
            playback_id: request.playback_id,
            status: "completed",
          });
          if (settled) return;
          settled = true;
          cleanup();
          closeSocket({ graceful: true });
          resolve({ playback_id: request.playback_id, status: "completed" });
        })().catch(fail);
      };
      const abort = () => fail(createAbortError());
      if (signal) {
        signal.addEventListener("abort", abort, { once: true });
        removeListeners.push(() => signal.removeEventListener("abort", abort));
      }

      const onOpen = () => {
        try {
          socket.send(JSON.stringify(buildVolcengineTextTtsSessionPayload(request, config)));
        } catch {
          fail(new VolcengineTextTtsError(
            "tts_upstream_write_failed",
            "语音合成请求发送失败",
            { status: 502, retryable: true },
          ));
        }
      };
      const onMessage = (raw) => {
        const event = parseUpstreamEvent(raw);
        if (!event?.type || settled) return;
        switch (event.type) {
          case "session.created":
            if (commitSent) break;
            commitSent = true;
            try {
              socket.send(JSON.stringify({
                event_id: makeEventId("tts_speech"),
                type: "speech_text_buffer.commit",
                text: request.text,
              }));
            } catch {
              fail(new VolcengineTextTtsError(
                "tts_upstream_write_failed",
                "播报文本发送失败",
                { status: 502, retryable: true },
              ));
            }
            break;
          case "response.output_audio.started":
            if (audioStarted) break;
            audioStarted = true;
            void emit({
              type: "tts.audio.started",
              playback_id: request.playback_id,
              format: "pcm_s16le",
              sample_rate: OUTPUT_SAMPLE_RATE,
            });
            break;
          case "response.output_audio.delta":
            {
              const byteLength = validBase64ByteLength(event.delta);
              if (byteLength === 0) break;
              audioChunkCount += 1;
              audioByteCount += byteLength;
            }
            if (!audioStarted) {
              audioStarted = true;
              void emit({
                type: "tts.audio.started",
                playback_id: request.playback_id,
                format: "pcm_s16le",
                sample_rate: OUTPUT_SAMPLE_RATE,
              });
            }
            if (typeof event.delta === "string" && event.delta) {
              void emit({
                type: "tts.audio.delta",
                playback_id: request.playback_id,
                delta: event.delta,
                format: "pcm_s16le",
                sample_rate: OUTPUT_SAMPLE_RATE,
              });
            }
            break;
          case "response.output_audio.done":
            if (audioDone || audioChunkCount === 0 || audioByteCount === 0) break;
            audioDone = true;
            void emit({
              type: "tts.audio.done",
              playback_id: request.playback_id,
              format: "pcm_s16le",
              sample_rate: OUTPUT_SAMPLE_RATE,
            });
            break;
          case "response.done":
            complete();
            break;
          case "response.canceled":
            fail(new VolcengineTextTtsError(
              "tts_upstream_canceled",
              "语音合成被上游取消",
              { status: 502, retryable: true },
            ));
            break;
          case "error":
            fail(new VolcengineTextTtsError(
              "tts_upstream_error",
              "火山语音合成失败，请稍后重试",
              { status: 502, retryable: true },
            ));
            break;
          default:
            break;
        }
      };
      const onError = () => fail(new VolcengineTextTtsError(
        "tts_upstream_connection_error",
        "语音合成服务连接异常",
        { status: 502, retryable: true },
      ));
      const onClose = () => {
        if (!settled) {
          fail(new VolcengineTextTtsError(
            "tts_upstream_closed",
            "语音合成连接提前关闭",
            { status: 502, retryable: true },
          ));
        }
      };

      removeListeners.push(addSocketListener(socket, "open", onOpen));
      removeListeners.push(addSocketListener(socket, "message", onMessage));
      removeListeners.push(addSocketListener(socket, "error", onError));
      removeListeners.push(addSocketListener(socket, "close", onClose));
      active.set(request.playback_id, { socket, abort });
    });
  }

  function close() {
    for (const item of [...active.values()]) item.abort();
    active.clear();
  }

  return {
    configSummary,
    prepareRequest,
    synthesize,
    close,
    get activeCount() {
      return active.size;
    },
  };
}

export function createVolcengineTextTtsHttpHandler({
  service,
  authorizeRequest,
} = {}) {
  if (!service || typeof service.synthesize !== "function") {
    throw new TypeError("volcengine text tts service is required");
  }

  return async function handleVolcengineTextTtsHttp(req, res, requestUrl) {
    const pathname = requestUrl?.pathname || new URL(req.url, "http://localhost").pathname;
    if (pathname !== STREAM_PATH) return false;
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      sendJson(res, 405, { error: "method_not_allowed", message: "仅支持 POST" });
      return true;
    }
    if (!await safelyAuthorizeRequest(authorizeRequest, req)) {
      sendJson(res, 403, { error: "tts_forbidden", message: "当前请求不能使用文字播报" });
      return true;
    }

    let request;
    try {
      request = service.prepareRequest(await readJson(req));
      if (service.configSummary().configured !== true) {
        throw new VolcengineTextTtsError(
          "tts_not_configured",
          "火山文字播报尚未配置",
          { status: 503 },
        );
      }
    } catch (error) {
      sendPublicJsonError(res, error);
      return true;
    }

    const controller = new AbortController();
    const abort = () => {
      if (!controller.signal.aborted) controller.abort();
    };
    req.once("aborted", abort);
    res.once("close", abort);
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-content-type-options": "nosniff",
      "x-accel-buffering": "no",
    });
    res.flushHeaders?.();

    try {
      await service.synthesize(request, {
        signal: controller.signal,
        onEvent: (event) => writeNdjson(res, event, controller.signal),
      });
      if (!res.destroyed && !res.writableEnded) res.end();
    } catch (error) {
      if (!controller.signal.aborted && !res.destroyed && !res.writableEnded) {
        await writeNdjson(res, createPublicErrorEvent(request.playback_id, error), controller.signal)
          .catch(() => {});
        if (!res.destroyed && !res.writableEnded) res.end();
      }
    } finally {
      req.off("aborted", abort);
      res.off("close", abort);
    }
    return true;
  };
}

export function buildVolcengineTextTtsSessionPayload(request, configInput = {}) {
  const model = String(configInput.model || DEFAULT_MODEL);
  return {
    event_id: makeEventId("tts_session"),
    type: "session.create",
    session: {
      type: "realtime",
      model,
      instructions: "你只负责按输入文本原样、自然地播报，不补充、不改写内容。",
      audio: {
        input: {
          format: { type: "pcm", rate: INPUT_SAMPLE_RATE },
        },
        output: {
          format: { type: "pcm_s16le", rate: OUTPUT_SAMPLE_RATE },
          voice: request.voice,
          speed: request.speed,
          loudness: request.loudness,
        },
      },
    },
    extension: { asr: {}, tts: {}, dialog: {} },
  };
}

function normalizeServiceConfig({ env, requestTimeoutMs, maxConcurrent }) {
  const configuredVoices = String(env.DOUBAO_TEXT_TTS_VOICES || "")
    .split(",")
    .map((voice) => voice.trim())
    .filter((voice) => VOICE_SET.has(voice));
  const voices = configuredVoices.length
    ? [...new Set(configuredVoices)]
    : [...VOLCENGINE_TEXT_TTS_VOICES];
  return {
    apiKey: String(env.DOUBAO_API_KEY || "").trim(),
    endpoint: String(env.DOUBAO_TEXT_TTS_ENDPOINT || env.DOUBAO_REALTIME_ENDPOINT || DEFAULT_ENDPOINT).trim(),
    model: String(env.DOUBAO_TEXT_TTS_MODEL || env.DOUBAO_REALTIME_MODEL || DEFAULT_MODEL).trim(),
    requestTimeoutMs: boundedInteger(
      requestTimeoutMs ?? env.DOUBAO_TEXT_TTS_TIMEOUT_MS,
      1_000,
      120_000,
      DEFAULT_TIMEOUT_MS,
    ),
    maxConcurrent: boundedInteger(
      maxConcurrent ?? env.DOUBAO_TEXT_TTS_MAX_CONCURRENT,
      1,
      64,
      DEFAULT_MAX_CONCURRENT,
    ),
    voices,
  };
}

function normalizeTtsRequest(input, config) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidRequest("tts_request_invalid", "请求内容必须是 JSON 对象");
  }
  const playbackId = String(input.playback_id || `tts_${randomUUID()}`).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(playbackId)) {
    throw invalidRequest("tts_playback_id_invalid", "playback_id 格式无效");
  }
  const text = cleanSpeechText(input.text);
  if (!text) throw invalidRequest("tts_text_required", "播报文字不能为空");
  if (text.length > MAX_TEXT_LENGTH) {
    throw new VolcengineTextTtsError(
      "tts_text_too_long",
      `播报文字不能超过 ${MAX_TEXT_LENGTH} 个字符`,
      { status: 413 },
    );
  }
  const voice = String(input.voice || config.voices[0] || "").trim();
  if (!config.voices.includes(voice)) {
    throw invalidRequest("tts_voice_invalid", "当前音色不可用");
  }
  const speed = input.speed == null || input.speed === "" ? 0 : Number(input.speed);
  if (!Number.isInteger(speed) || speed < -50 || speed > 100) {
    throw invalidRequest("tts_speed_invalid", "speed 必须是 -50 到 100 的整数");
  }
  const loudness = input.loudness == null || input.loudness === "" ? 0 : Number(input.loudness);
  if (!Number.isInteger(loudness) || loudness < -50 || loudness > 100) {
    throw invalidRequest("tts_loudness_invalid", "loudness 必须是 -50 到 100 的整数");
  }
  return { playback_id: playbackId, text, voice, speed, loudness };
}

function cleanSpeechText(value) {
  return String(value || "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/gu, " ")
    .trim();
}

async function readJson(req) {
  const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new VolcengineTextTtsError(
      "tts_content_type_invalid",
      "请求必须使用 application/json",
      { status: 415 },
    );
  }
  const declaredLength = Number(req.headers?.["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new VolcengineTextTtsError(
      "tts_request_too_large",
      "文字播报请求过大",
      { status: 413 },
    );
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new VolcengineTextTtsError(
        "tts_request_too_large",
        "文字播报请求过大",
        { status: 413 },
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw invalidRequest("tts_json_invalid", "请求内容不是合法 JSON");
  }
}

async function writeNdjson(res, event, signal) {
  if (signal?.aborted || res.destroyed || res.writableEnded) throw createAbortError();
  const accepted = res.write(`${JSON.stringify(event)}\n`);
  if (accepted) return;
  await waitForDrain(res, signal);
}

function waitForDrain(res, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", drained);
      signal?.removeEventListener("abort", aborted);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const aborted = () => {
      cleanup();
      reject(createAbortError());
    };
    res.once("drain", drained);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted || res.destroyed || res.writableEnded) aborted();
  });
}

function createPublicErrorEvent(playbackId, error) {
  const normalized = normalizeRuntimeError(error);
  return {
    type: "tts.error",
    playback_id: String(playbackId || ""),
    code: normalized.code,
    message: normalized.message,
    retryable: Boolean(normalized.retryable),
  };
}

function normalizeRuntimeError(error) {
  if (error instanceof VolcengineTextTtsError) return error;
  if (error?.name === "AbortError" || error?.code === "tts_aborted") return createAbortError();
  return new VolcengineTextTtsError(
    "tts_failed",
    "文字播报失败，请稍后重试",
    { status: 500, retryable: true },
  );
}

function createAbortError() {
  const error = new VolcengineTextTtsError(
    "tts_aborted",
    "文字播报已取消",
    { status: 499, retryable: false },
  );
  error.name = "AbortError";
  return error;
}

function invalidRequest(code, message) {
  return new VolcengineTextTtsError(code, message, { status: 400, retryable: false });
}

function parseUpstreamEvent(raw) {
  try {
    const data = raw?.data ?? raw;
    return JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
  } catch {
    return null;
  }
}

function validBase64ByteLength(value) {
  if (typeof value !== "string" || !value) return 0;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    return 0;
  }
  try {
    return Buffer.from(value, "base64").length;
  } catch {
    return 0;
  }
}

async function safelyAuthorizeRequest(authorizeRequest, req) {
  if (typeof authorizeRequest !== "function") return false;
  try {
    return await authorizeRequest(req) === true;
  } catch {
    return false;
  }
}

function addSocketListener(socket, type, listener) {
  if (typeof socket.on === "function") {
    socket.on(type, listener);
    return () => socket.off?.(type, listener);
  }
  socket.addEventListener(type, listener);
  return () => socket.removeEventListener?.(type, listener);
}

function addSocketTerminalErrorGuard(socket) {
  const ignoreTerminalError = () => {};
  const removeError = addSocketListener(socket, "error", ignoreTerminalError);
  let removed = false;
  let removeClose = () => {};
  const remove = () => {
    if (removed) return;
    removed = true;
    removeError();
    removeClose();
  };
  removeClose = addSocketListener(socket, "close", remove);
  return remove;
}

function socketOpenState(WebSocketImpl) {
  return Number.isInteger(WebSocketImpl?.OPEN) ? WebSocketImpl.OPEN : 1;
}

function makeEventId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function safeEndpointHost(endpoint) {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "invalid";
  }
}

function isWebSocketEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return (url.protocol === "wss:" || url.protocol === "ws:") && Boolean(url.host);
  } catch {
    return false;
  }
}

function sendPublicJsonError(res, error) {
  const normalized = normalizeRuntimeError(error);
  sendJson(res, normalized.status, {
    error: normalized.code,
    message: normalized.message,
    retryable: Boolean(normalized.retryable),
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
