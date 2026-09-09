const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_SEEDREAM_MODEL = "doubao-seedream-5-0-260128";
const DEFAULT_SEEDANCE_MODEL = "doubao-seedance-2-5-260628";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,191}$/u;

export class ArkMediaClientError extends Error {
  constructor(code, message, { status = 502, retryable = false, providerCode = "", requestId = "", cause } = {}) {
    super(message, { cause });
    this.name = "ArkMediaClientError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.providerCode = safeText(providerCode, 160);
    this.requestId = safeText(requestId, 240);
  }
}

/**
 * Server-only Ark media client. Credentials never appear in returned config,
 * request receipts or errors. Calling methods is intentionally explicit: the
 * client performs no eager health check and creates no paid task at startup.
 */
export function createArkMediaClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = readConfig(env);
  const endpoints = buildEndpoints(config.baseUrl);

  function configSummary() {
    return Object.freeze({
      schema_version: "ark-media-config@1.0",
      configured: Boolean(config.apiKey),
      missing: config.apiKey ? [] : ["ARK_API_KEY"],
      base_url: endpoints.baseUrl,
      seedream: {
        configured: Boolean(config.apiKey),
        model: config.seedreamModel,
        endpoint: "/images/generations",
      },
      seedance: {
        configured: Boolean(config.apiKey),
        model: config.seedanceModel,
        endpoint: "/contents/generations/tasks",
      },
      timeout_ms: config.timeoutMs,
    });
  }

  async function generateImage(input = {}) {
    ensureConfigured(config, fetchImpl);
    const body = {
      model: normalizeModel(input.model, config.seedreamModel),
      prompt: requiredText(input.prompt, "prompt", 120_000),
    };
    optionalString(body, "size", input.size, 80);
    optionalString(body, "response_format", input.response_format ?? input.responseFormat, 40);
    optionalBoolean(body, "watermark", input.watermark);
    if (input.seed !== undefined && input.seed !== null && input.seed !== "") {
      const seed = Number(input.seed);
      if (!Number.isInteger(seed) || seed < -1 || seed > 2_147_483_647) {
        throw invalidRequest("seed must be an integer between -1 and 2147483647");
      }
      body.seed = seed;
    }
    optionalString(
      body,
      "sequential_image_generation",
      normalizeSequentialImageGeneration(input.sequential_image_generation ?? input.sequentialImageGeneration),
      16,
    );
    if (Array.isArray(input.images) && input.images.length) {
      if (input.images.length > 14) throw invalidRequest("at most 14 Seedream reference images are allowed");
      body.image = input.images.map((url, index) =>
        normalizeMediaUrl(url, `images[${index}]`, { allowDataImage: true })
      );
    }
    const receipt = await requestJson({
      method: "POST",
      url: endpoints.seedream,
      body,
      apiKey: config.apiKey,
      timeoutMs: normalizeTimeout(input.timeoutMs, config.timeoutMs),
      signal: input.signal,
      fetchImpl,
    });
    assertSeedreamItems(receipt.payload, receipt.requestId);
    return receipt;
  }

  async function createVideoTask(input = {}) {
    ensureConfigured(config, fetchImpl);
    const content = normalizeVideoContent(input.content);
    const body = {
      model: normalizeModel(input.model, config.seedanceModel),
      content,
      generate_audio: input.generate_audio !== false && input.generateAudio !== false,
      ratio: normalizeRatio(input.ratio || "16:9"),
      resolution: normalizeResolution(input.resolution || "720p"),
      duration: normalizeDuration(input.duration ?? 8),
      watermark: input.watermark === true,
      omni_reference_task_type: "reference",
    };
    return requestJson({
      method: "POST",
      url: endpoints.seedanceTasks,
      body,
      apiKey: config.apiKey,
      timeoutMs: normalizeTimeout(input.timeoutMs, config.timeoutMs),
      signal: input.signal,
      fetchImpl,
    });
  }

  async function getVideoTask(taskId, input = {}) {
    ensureConfigured(config, fetchImpl);
    return requestJson({
      method: "GET",
      url: `${endpoints.seedanceTasks}/${encodeURIComponent(normalizeTaskId(taskId))}`,
      apiKey: config.apiKey,
      timeoutMs: normalizeTimeout(input.timeoutMs, config.timeoutMs),
      signal: input.signal,
      fetchImpl,
    });
  }

  async function deleteVideoTask(taskId, input = {}) {
    ensureConfigured(config, fetchImpl);
    return requestJson({
      method: "DELETE",
      url: `${endpoints.seedanceTasks}/${encodeURIComponent(normalizeTaskId(taskId))}`,
      apiKey: config.apiKey,
      timeoutMs: normalizeTimeout(input.timeoutMs, config.timeoutMs),
      signal: input.signal,
      fetchImpl,
      allowEmpty: true,
    });
  }

  return Object.freeze({
    configSummary,
    generateImage,
    createVideoTask,
    getVideoTask,
    deleteVideoTask,
  });
}

function readConfig(env) {
  const source = env && typeof env === "object" ? env : {};
  return Object.freeze({
    apiKey: safeText(source.ARK_API_KEY, 8_192),
    baseUrl: safeText(source.ARK_MEDIA_BASE_URL || source.ARK_EDUCATION_BASE_URL || source.ARK_BASE_URL, 2_048)
      || DEFAULT_BASE_URL,
    seedreamModel: normalizeModel(source.ARK_SEEDREAM_MODEL, DEFAULT_SEEDREAM_MODEL),
    seedanceModel: normalizeModel(source.ARK_SEEDANCE_MODEL, DEFAULT_SEEDANCE_MODEL),
    timeoutMs: normalizeTimeout(source.ARK_MEDIA_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  });
}

function buildEndpoints(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ArkMediaClientError("ark_media_invalid_configuration", "ARK_MEDIA_BASE_URL is invalid", { status: 500 });
  }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ArkMediaClientError("ark_media_invalid_configuration", "ARK_MEDIA_BASE_URL must be an HTTP(S) URL without credentials", { status: 500 });
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  const normalized = parsed.toString().replace(/\/$/u, "");
  return Object.freeze({
    baseUrl: normalized,
    seedream: `${normalized}/images/generations`,
    seedanceTasks: `${normalized}/contents/generations/tasks`,
  });
}

function normalizeVideoContent(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 13) {
    throw invalidRequest("content must contain 1 to 13 entries");
  }
  let textCount = 0;
  let imageCount = 0;
  let videoCount = 0;
  let audioCount = 0;
  const normalized = value.map((item, index) => {
    if (!item || typeof item !== "object") throw invalidRequest(`content[${index}] is invalid`);
    if (item.type === "text") {
      textCount += 1;
      return { type: "text", text: requiredText(item.text, `content[${index}].text`, 120_000) };
    }
    const role = normalizeReferenceRole(item.role);
    if (item.type === "image_url") {
      imageCount += 1;
      if (imageCount > 8) throw invalidRequest("at most 8 reference images are allowed");
      return {
        type: "image_url",
        image_url: { url: normalizeMediaUrl(item.image_url?.url ?? item.image_url, `content[${index}].image_url`) },
        role,
      };
    }
    if (item.type === "video_url") {
      videoCount += 1;
      if (videoCount > 3) throw invalidRequest("at most 3 reference videos are allowed");
      return {
        type: "video_url",
        video_url: { url: normalizeMediaUrl(item.video_url?.url ?? item.video_url, `content[${index}].video_url`) },
        role,
      };
    }
    if (item.type === "audio_url") {
      audioCount += 1;
      if (audioCount > 1) throw invalidRequest("at most 1 reference audio is allowed");
      return {
        type: "audio_url",
        audio_url: { url: normalizeMediaUrl(item.audio_url?.url ?? item.audio_url, `content[${index}].audio_url`) },
        role,
      };
    }
    throw invalidRequest(`content[${index}].type is unsupported`);
  });
  if (textCount !== 1) throw invalidRequest("content must contain exactly one text prompt");
  return normalized;
}

function normalizeReferenceRole(value) {
  const role = safeText(value, 80) || "reference_image";
  if (!["reference_image", "reference_video", "reference_audio", "first_frame", "last_frame"].includes(role)) {
    throw invalidRequest("reference media role is invalid");
  }
  return role;
}

function normalizeMediaUrl(value, field, { allowDataImage = false } = {}) {
  const raw = safeText(value, 4 * 1024 * 1024);
  if (!raw) throw invalidRequest(`${field} is required`);
  if (allowDataImage && /^data:image\/(?:png|jpeg|webp);base64,/u.test(raw)) return raw;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalidRequest(`${field} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw invalidRequest(`${field} must be a credential-free HTTPS URL`);
  }
  return parsed.toString();
}

async function requestJson({ method, url, body, apiKey, timeoutMs, signal, fetchImpl, allowEmpty = false }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new ArkMediaClientError("ark_media_timeout", "Ark media request timed out", { status: 504, retryable: true, cause });
      }
      throw new ArkMediaClientError("ark_media_network_error", "Ark media request failed", { status: 502, retryable: true, cause });
    }
    const requestId = response.headers?.get?.("x-request-id") || response.headers?.get?.("x-tt-logid") || "";
    const text = await readBoundedBody(response);
    let payload = null;
    if (text.trim()) {
      try { payload = JSON.parse(text); } catch {
        throw new ArkMediaClientError("ark_media_invalid_response", "Ark returned invalid JSON", { status: 502, retryable: true, requestId });
      }
    } else if (!allowEmpty) {
      throw new ArkMediaClientError("ark_media_empty_response", "Ark returned an empty response", { status: 502, retryable: true, requestId });
    }
    if (!response.ok) {
      const providerCode = payload?.error?.code || payload?.code || "";
      throw new ArkMediaClientError(
        "ark_media_provider_error",
        safeText(payload?.error?.message || payload?.message, 1_000) || `Ark media request failed with HTTP ${response.status}`,
        { status: response.status >= 400 && response.status < 500 ? response.status : 502, retryable: response.status === 429 || response.status >= 500, providerCode, requestId },
      );
    }
    return Object.freeze({ payload: payload || {}, requestId: safeText(requestId, 240) || null });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
}

async function readBoundedBody(response) {
  const length = Number(response.headers?.get?.("content-length") || 0);
  if (length > MAX_RESPONSE_BYTES) throw new ArkMediaClientError("ark_media_response_too_large", "Ark media response is too large", { status: 502 });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new ArkMediaClientError("ark_media_response_too_large", "Ark media response is too large", { status: 502 });
  return text;
}

function ensureConfigured(config, fetchImpl) {
  if (!config.apiKey) throw new ArkMediaClientError("ark_media_not_configured", "Ark media service is not configured", { status: 503 });
  if (typeof fetchImpl !== "function") throw new ArkMediaClientError("ark_media_fetch_unavailable", "Server fetch is unavailable", { status: 503 });
}

function normalizeModel(value, fallback) {
  const model = safeText(value, 192) || fallback;
  if (!SAFE_MODEL_ID.test(model)) throw invalidRequest("model is invalid");
  return model;
}

function normalizeTaskId(value) {
  const id = safeText(value, 240);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/u.test(id)) throw invalidRequest("task id is invalid");
  return id;
}

function normalizeRatio(value) {
  const ratio = safeText(value, 20);
  if (!["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(ratio)) throw invalidRequest("ratio is invalid");
  return ratio;
}

function normalizeDuration(value) {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 4 || duration > 30) throw invalidRequest("duration must be an integer from 4 to 30");
  return duration;
}

function normalizeResolution(value) {
  const resolution = safeText(value, 20);
  if (!["480p", "720p", "1080p"].includes(resolution)) throw invalidRequest("resolution is invalid");
  return resolution;
}

function normalizeSequentialImageGeneration(value) {
  const mode = safeText(value, 16) || "disabled";
  if (!["disabled", "auto"].includes(mode)) {
    throw invalidRequest("sequential_image_generation must be disabled or auto");
  }
  return mode;
}

function assertSeedreamItems(payload, requestId) {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  if (!items.length) {
    throw new ArkMediaClientError("ark_media_invalid_response", "Seedream returned no image result", {
      status: 502,
      retryable: true,
      requestId,
    });
  }
  const failed = items.find((item) => item?.error);
  if (failed) {
    throw new ArkMediaClientError("ark_media_provider_error", safeText(failed.error?.message, 1_000) || "Seedream image generation failed", {
      status: 502,
      retryable: false,
      providerCode: failed.error?.code,
      requestId,
    });
  }
  const hasOutput = items.some((item) => safeText(item?.url, 16_000) || safeText(item?.b64_json, 32));
  if (!hasOutput) {
    throw new ArkMediaClientError("ark_media_invalid_response", "Seedream returned an image result without content", {
      status: 502,
      retryable: true,
      requestId,
    });
  }
}

function normalizeTimeout(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(5_000, Math.min(15 * 60_000, Math.round(number)));
}

function optionalString(target, key, value, maxLength) {
  if (value === undefined || value === null || value === "") return;
  target[key] = requiredText(value, key, maxLength);
}

function optionalBoolean(target, key, value) {
  if (value === undefined || value === null) return;
  if (typeof value !== "boolean") throw invalidRequest(`${key} must be boolean`);
  target[key] = value;
}

function requiredText(value, field, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) throw invalidRequest(`${field} is required and must be at most ${maxLength} characters`);
  return text;
}

function safeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function invalidRequest(message) {
  return new ArkMediaClientError("ark_media_invalid_request", message, { status: 400 });
}
