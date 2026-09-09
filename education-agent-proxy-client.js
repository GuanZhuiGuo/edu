import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

export const EDUCATION_AGENT_PROXY_EVENT_VERSION = "education-agent-proxy-event@1.0";
export const EDUCATION_AGENT_PROXY_FINAL_VERSION = "education-agent-proxy-final@1.0";

const DEFAULT_CHAT_PATH = "/marketing/agent-control/openapi/conversation/chat";
const DEFAULT_UPLOAD_PATH = "/marketing/ai_custom_agents/openapi/storage/upload";
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_SSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 512 * 1024;
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 128 * 1024;
const MAX_IMAGES = 4;
const MAX_PLATFORM_FILES = 8;
const MAX_TRACE_TEXT = 4_000;
const MAX_RICH_ITEMS = 24;
const SAFE_TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const SAFE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TRACE_CONTENT_TYPES = new Set(["thinking", "verbose", "tool", "retrieve"]);
const RICH_CONTENT_TYPES = new Set(["card", "image", "audio", "video", "file", "suggestion"]);
const SENSITIVE_QUERY_NAME_PARTS = new Set([
  "auth",
  "authorization",
  "bearer",
  "credential",
  "credentials",
  "key",
  "password",
  "passwd",
  "secret",
  "signature",
  "sig",
  "token",
]);

export class EducationAgentProxyError extends Error {
  constructor(code, message, {
    status = 502,
    retryable = false,
    traceId = "",
    cause,
  } = {}) {
    super(message, { cause });
    this.name = "EducationAgentProxyError";
    this.code = safeToken(code, 160) || "agent_proxy_error";
    this.status = Number.isInteger(status) ? status : 502;
    this.retryable = retryable === true;
    this.traceId = safeTraceId(traceId);
  }
}

/**
 * Server-only adapter for the configurable external Agent.
 *
 * Pass a dynamic getConfig function (normally
 * educationRuntimeSettings.getAgentProxyConfig) so a saved setting takes
 * effect on the next turn without restarting the process. Credential values
 * never appear in summaries, yielded events or provider errors.
 */
export function createEducationAgentProxyClient({
  getConfig,
  config,
  fetchImpl = globalThis.fetch,
  FormDataImpl = globalThis.FormData,
  BlobImpl = globalThis.Blob,
  idFactory = randomUUID,
  maxSseBytes = DEFAULT_MAX_SSE_BYTES,
  maxUploadResponseBytes = DEFAULT_MAX_UPLOAD_RESPONSE_BYTES,
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  maxTotalImageBytes = DEFAULT_MAX_TOTAL_IMAGE_BYTES,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const resolveConfig = typeof getConfig === "function"
    ? getConfig
    : () => config || {};
  const limits = Object.freeze({
    maxSseBytes: positiveLimit(maxSseBytes, DEFAULT_MAX_SSE_BYTES),
    maxUploadResponseBytes: positiveLimit(maxUploadResponseBytes, DEFAULT_MAX_UPLOAD_RESPONSE_BYTES),
    maxRequestBytes: positiveLimit(maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES),
    maxImageBytes: positiveLimit(maxImageBytes, DEFAULT_MAX_IMAGE_BYTES),
    maxTotalImageBytes: positiveLimit(maxTotalImageBytes, DEFAULT_MAX_TOTAL_IMAGE_BYTES),
  });

  function configSummary() {
    try {
      const resolved = normalizeConfig(resolveConfig(), { requireEnabled: false });
      return Object.freeze({
        schema_version: "education-agent-proxy-config@1.0",
        enabled: resolved.enabled,
        configured: Boolean(resolved.endpoint && resolved.apiKey),
        endpoint: resolved.endpoint ? resolveEducationAgentProxyEndpoints(resolved.endpoint).chatUrl : "",
        has_api_key: Boolean(resolved.apiKey),
        timeout_ms: resolved.timeoutMs,
      });
    } catch {
      return Object.freeze({
        schema_version: "education-agent-proxy-config@1.0",
        enabled: false,
        configured: false,
        endpoint: "",
        has_api_key: false,
        timeout_ms: DEFAULT_TIMEOUT_MS,
      });
    }
  }

  async function uploadImage(input, options = {}) {
    const resolved = normalizeConfig(resolveConfig(), { requireEnabled: true });
    const traceId = safeTraceId(options.traceId) || safeTraceId(idFactory()) || randomUUID();
    const requestContext = createAbortContext({
      callerSignal: options.signal,
      timeoutMs: normalizeTimeout(options.timeoutMs, resolved.timeoutMs),
    });
    try {
      return await uploadImageWithContext({
        input,
        config: resolved,
        traceId,
        signal: requestContext.signal,
        fetchImpl,
        FormDataImpl,
        BlobImpl,
        limits,
      });
    } catch (error) {
      throw normalizeProxyError(error, requestContext, traceId);
    } finally {
      requestContext.dispose();
    }
  }

  async function* streamConversation(input = {}) {
    const resolved = normalizeConfig(resolveConfig(), { requireEnabled: true });
    const traceId = safeTraceId(input.traceId ?? input.trace_id)
      || safeTraceId(idFactory())
      || randomUUID();
    const requestContext = createAbortContext({
      callerSignal: input.signal,
      timeoutMs: normalizeTimeout(input.timeoutMs ?? input.timeout_ms, resolved.timeoutMs),
    });
    const endpoints = resolveEducationAgentProxyEndpoints(resolved.endpoint);
    const aggregate = createAggregate(traceId, resolved.apiKey);
    aggregate.conversationId = safeOpaqueValue(input.conversationId ?? input.conversation_id, 240);

    try {
      const directFiles = normalizePlatformFiles(input.platformFiles ?? input.platform_files);
      const images = normalizeImageList(input);
      if (directFiles.length + images.length > MAX_PLATFORM_FILES) {
        throw invalidInput("agent_proxy_too_many_files", `单次最多上传 ${MAX_PLATFORM_FILES} 个文件`);
      }
      const content = normalizeQuestionContent(input.content ?? input.message ?? input.text, {
        allowEmpty: directFiles.length + images.length > 0,
      });
      const uploadedFiles = [];
      let totalImageBytes = 0;
      for (const image of images) {
        const normalized = normalizeImageUpload(image, { BlobImpl, maxImageBytes: limits.maxImageBytes });
        totalImageBytes += normalized.size;
        if (totalImageBytes > limits.maxTotalImageBytes) {
          throw invalidInput("agent_proxy_images_too_large", "本次图片总大小超过安全上限");
        }
        const uploaded = await uploadNormalizedImage({
          normalized,
          config: resolved,
          traceId,
          signal: requestContext.signal,
          fetchImpl,
          FormDataImpl,
          endpoints,
          maxResponseBytes: limits.maxUploadResponseBytes,
        });
        uploadedFiles.push(uploaded);
        yield freezeEvent({
          type: "status",
          stage: "agent_proxy.image_uploaded",
          message: "图片已上传，正在提交给 Agent",
          trace_id: traceId,
        });
      }

      const platformFiles = [
        ...directFiles,
        ...uploadedFiles.map((item) => toConversationPlatformFile(item)),
      ];
      const body = buildConversationRequest({
        content,
        conversationId: input.conversationId ?? input.conversation_id,
        userOneId: input.userOneId ?? input.user_one_id ?? input.userId ?? input.user_id
          ?? input.metadata?.user_one_id,
        customPassThroughMap: input.customPassThroughMap ?? input.custom_pass_through_map
          ?? input.metadata?.custom_pass_through_map,
        platformFiles,
      });
      const encodedBody = JSON.stringify(body);
      if (Buffer.byteLength(encodedBody, "utf8") > limits.maxRequestBytes) {
        throw invalidInput("agent_proxy_request_too_large", "Agent 请求内容超过安全上限");
      }

      let response;
      try {
        response = await fetchImpl(endpoints.chatUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
            "x-api-key": resolved.apiKey,
            "x-trace-id": traceId,
          },
          body: encodedBody,
          signal: requestContext.signal,
        });
      } catch (cause) {
        throw networkError(cause, traceId);
      }
      if (!response?.ok) {
        await discardResponseBody(response);
        throw providerHttpError(response?.status, traceId);
      }
      const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
      if (!contentType.includes("text/event-stream") || !response.body) {
        await discardResponseBody(response);
        throw new EducationAgentProxyError(
          "agent_proxy_invalid_stream",
          "Agent 代理没有返回有效的流式响应",
          { status: 502, retryable: true, traceId },
        );
      }

      let completedBy = "";
      for await (const frame of parseSseStream(response.body, {
        maxBytes: limits.maxSseBytes,
        traceId,
      })) {
        const eventName = safeEventName(frame.event || inferEventName(frame.data));
        if (eventName === "ping") continue;
        if (frame.done || eventName === "done") {
          completedBy = "done";
          break;
        }
        const payload = parseFramePayload(frame.data, traceId);
        if (!payload) continue;
        if (isUpstreamErrorFrame(eventName, payload)) {
          throw providerEventError(payload, traceId);
        }
        updateAggregateIds(aggregate, payload);

        if (eventName === "conversation.chat.created") {
          yield freezeEvent({
            type: "meta",
            stage: "agent_proxy.chat_created",
            conversation_id: aggregate.conversationId,
            chat_id: aggregate.chatId,
            trace_id: traceId,
          });
          continue;
        }

        if (eventName === "conversation.message.delta") {
          const normalized = normalizeMessageFrame(payload, {
            defaultContentType: "text",
            providerEventId: frame.id,
          });
          for (const event of consumeMessageFrame(aggregate, normalized, {
            phase: "delta",
            secret: resolved.apiKey,
          })) yield event;
          continue;
        }

        if (eventName === "conversation.message.completed") {
          const normalized = normalizeMessageFrame(payload, {
            defaultContentType: "text",
            providerEventId: frame.id,
          });
          if (normalized.contentType === "text") aggregate.textMessageCompleted = true;
          for (const event of consumeMessageFrame(aggregate, normalized, {
            phase: "completed",
            secret: resolved.apiKey,
          })) yield event;
          continue;
        }

        if (eventName === "conversation.chat.completed") {
          completedBy = "conversation.chat.completed";
          break;
        }

        const normalized = normalizeMessageFrame(payload, {
          defaultContentType: "",
          providerEventId: frame.id,
        });
        if (TRACE_CONTENT_TYPES.has(normalized.contentType)) {
          for (const event of consumeMessageFrame(aggregate, normalized, {
            phase: "event",
            secret: resolved.apiKey,
          })) yield event;
        }
      }

      if (!completedBy && !aggregate.textMessageCompleted) {
        throw new EducationAgentProxyError(
          "agent_proxy_incomplete_stream",
          "Agent 代理在回答完成前中断",
          { status: 502, retryable: true, traceId },
        );
      }
      const trailingAnswer = aggregate.answerRedactor.flush();
      if (trailingAnswer) {
        aggregate.answer += trailingAnswer;
        yield freezeEvent({
          type: "delta",
          delta: trailingAnswer,
          conversation_id: aggregate.conversationId,
          chat_id: aggregate.chatId,
          trace_id: aggregate.traceId,
        });
      }
      const answer = safeAnswerText(aggregate.answer);
      if (!answer) {
        throw new EducationAgentProxyError(
          "agent_proxy_empty_answer",
          "Agent 代理没有返回可展示的回答",
          { status: 502, retryable: true, traceId },
        );
      }
      yield buildFinalEvent(
        aggregate,
        answer,
        completedBy || "conversation.message.completed",
        resolved.apiKey,
      );
    } catch (error) {
      throw normalizeProxyError(error, requestContext, traceId);
    } finally {
      requestContext.dispose();
    }
  }

  async function chat(input = {}) {
    let final = null;
    for await (const event of streamConversation(input)) {
      if (event.type === "final") final = event;
    }
    if (!final) {
      throw new EducationAgentProxyError(
        "agent_proxy_incomplete_stream",
        "Agent 代理没有返回最终结果",
        { status: 502, retryable: true },
      );
    }
    return final;
  }

  return Object.freeze({
    configSummary,
    uploadImage,
    streamConversation,
    streamChat: streamConversation,
    chat,
  });
}

export function resolveEducationAgentProxyEndpoints(endpoint) {
  const parsed = parseEndpoint(endpoint);
  if ((parsed.pathname === "" || parsed.pathname === "/") && !parsed.search) {
    parsed.pathname = DEFAULT_CHAT_PATH;
  }
  const chatUrl = parsed.toString();
  const upload = new URL(parsed.origin);
  upload.pathname = DEFAULT_UPLOAD_PATH;
  return Object.freeze({ chatUrl, uploadUrl: upload.toString() });
}

/** A narrow, standalone normalizer useful for persisted proxy results. */
export function normalizeEducationAgentProxyRichContent(value) {
  const aggregate = createAggregate("");
  const source = decodeStructured(value);
  if (source && typeof source === "object") {
    collectRichValue(aggregate, "card", source.cards ?? source.card);
    collectRichValue(aggregate, "image", source.images ?? source.image_infos ?? source.image);
    collectRichValue(aggregate, "video", source.videos ?? source.video_infos ?? source.video);
    collectRichValue(aggregate, "audio", source.audio ?? source.audios ?? source.audio_infos);
    collectRichValue(aggregate, "file", source.files ?? source.file_infos ?? source.file);
    collectRichValue(aggregate, "suggestion", source.suggestions ?? source.follow_ups);
  }
  return finalRichProjection(aggregate);
}

function normalizeConfig(value, { requireEnabled }) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const enabled = source.enabled === true;
  const endpoint = String(source.endpoint || source.url || "").trim();
  const apiKey = String(source.api_key || source.apiKey || "").trim();
  const timeoutMs = normalizeTimeout(source.timeout_ms ?? source.timeoutMs, DEFAULT_TIMEOUT_MS);
  if (requireEnabled && !enabled) {
    throw new EducationAgentProxyError(
      "agent_proxy_disabled",
      "Agent 代理尚未开启",
      { status: 409, retryable: false },
    );
  }
  if (endpoint) parseEndpoint(endpoint);
  if (requireEnabled && !endpoint) {
    throw new EducationAgentProxyError(
      "agent_proxy_endpoint_required",
      "Agent 代理地址尚未配置",
      { status: 503, retryable: false },
    );
  }
  if (requireEnabled && !apiKey) {
    throw new EducationAgentProxyError(
      "agent_proxy_api_key_required",
      "Agent 代理 Key 尚未配置",
      { status: 503, retryable: false },
    );
  }
  if (apiKey.length > 16 * 1024 || /[\u0000-\u001f\u007f]/u.test(apiKey)) {
    throw new EducationAgentProxyError(
      "agent_proxy_invalid_api_key",
      "Agent 代理 Key 格式无效",
      { status: 400, retryable: false },
    );
  }
  return Object.freeze({ enabled, endpoint, apiKey, timeoutMs });
}

function parseEndpoint(value) {
  let parsed;
  try { parsed = new URL(String(value || "").trim()); } catch {
    throw new EducationAgentProxyError(
      "agent_proxy_invalid_endpoint",
      "Agent 代理地址格式无效",
      { status: 400, retryable: false },
    );
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) {
    throw new EducationAgentProxyError(
      "agent_proxy_insecure_endpoint",
      "Agent 代理地址必须使用 HTTPS；仅本机调试允许 HTTP",
      { status: 400, retryable: false },
    );
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new EducationAgentProxyError(
      "agent_proxy_invalid_endpoint",
      "Agent 代理地址不能包含账号、密码或锚点",
      { status: 400, retryable: false },
    );
  }
  if (hasSensitiveCredentialQuery(parsed)) {
    throw new EducationAgentProxyError(
      "agent_proxy_credential_query_forbidden",
      "Agent 代理地址不能在查询参数中携带 Key、Token 或其他凭据",
      { status: 400, retryable: false },
    );
  }
  return parsed;
}

function hasSensitiveCredentialQuery(url) {
  for (const name of url.searchParams.keys()) {
    if (isSensitiveCredentialName(name)) return true;
  }
  return false;
}

function isSensitiveCredentialName(value) {
  const source = String(value || "").replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
  const compact = source.replace(/[^a-z0-9]/gu, "");
  if ([
    "apikey",
    "xapikey",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "clientsecret",
  ].includes(compact)) return true;
  return source.split(/[^a-z0-9]+/gu).filter(Boolean)
    .some((part) => SENSITIVE_QUERY_NAME_PARTS.has(part));
}

function createAbortContext({ callerSignal, timeoutMs }) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(new Error("caller_cancelled"));
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener?.("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("agent_proxy_timeout"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    callerSignal,
    get timedOut() { return timedOut; },
    dispose() {
      clearTimeout(timer);
      callerSignal?.removeEventListener?.("abort", abortFromCaller);
    },
  };
}

function normalizeProxyError(error, context, traceId) {
  if (error instanceof EducationAgentProxyError) return error;
  if (context?.callerSignal?.aborted) {
    return new EducationAgentProxyError(
      "agent_proxy_cancelled",
      "Agent 代理请求已取消",
      { status: 499, retryable: false, traceId },
    );
  }
  if (context?.timedOut || context?.signal?.aborted || error?.name === "AbortError") {
    return new EducationAgentProxyError(
      "agent_proxy_timeout",
      "Agent 代理响应超时，请稍后重试",
      { status: 504, retryable: true, traceId },
    );
  }
  return new EducationAgentProxyError(
    "agent_proxy_unavailable",
    "Agent 代理暂时不可用，请稍后重试",
    { status: 502, retryable: true, traceId, cause: error },
  );
}

function networkError(cause, traceId) {
  if (cause?.name === "AbortError") throw cause;
  return new EducationAgentProxyError(
    "agent_proxy_network_error",
    "无法连接 Agent 代理，请检查地址或稍后重试",
    { status: 502, retryable: true, traceId, cause },
  );
}

function providerHttpError(status, traceId) {
  const safeStatus = Number(status) || 502;
  if (safeStatus === 401 || safeStatus === 403) {
    return new EducationAgentProxyError(
      "agent_proxy_auth_failed",
      "Agent 代理鉴权失败，请检查地址与 Key",
      { status: 502, retryable: false, traceId },
    );
  }
  if (safeStatus === 413) {
    return new EducationAgentProxyError(
      "agent_proxy_payload_too_large",
      "Agent 代理拒绝了过大的图片或请求内容",
      { status: 413, retryable: false, traceId },
    );
  }
  if (safeStatus === 408 || safeStatus === 429 || safeStatus >= 500) {
    return new EducationAgentProxyError(
      safeStatus === 429 ? "agent_proxy_rate_limited" : "agent_proxy_upstream_unavailable",
      safeStatus === 429 ? "Agent 代理当前繁忙，请稍后重试" : "Agent 代理暂时不可用，请稍后重试",
      { status: safeStatus === 429 ? 429 : 502, retryable: true, traceId },
    );
  }
  return new EducationAgentProxyError(
    "agent_proxy_request_rejected",
    "Agent 代理拒绝了本次请求",
    { status: 502, retryable: false, traceId },
  );
}

function providerEventError(payload, traceId) {
  const code = safeToken(
    deepPick(payload, ["code", "error_code", "error.code", "data.code"]),
    100,
  ).toLowerCase();
  const authFailure = ["unauthorized", "invalid_api_key", "authentication_error", "forbidden"]
    .some((item) => code.includes(item));
  return new EducationAgentProxyError(
    authFailure ? "agent_proxy_auth_failed" : "agent_proxy_provider_error",
    authFailure
      ? "Agent 代理鉴权失败，请检查地址与 Key"
      : "Agent 代理返回错误，请稍后重试",
    { status: 502, retryable: !authFailure, traceId },
  );
}

async function uploadImageWithContext({
  input,
  config,
  traceId,
  signal,
  fetchImpl,
  FormDataImpl,
  BlobImpl,
  limits,
}) {
  const endpoints = resolveEducationAgentProxyEndpoints(config.endpoint);
  const normalized = normalizeImageUpload(input, { BlobImpl, maxImageBytes: limits.maxImageBytes });
  return uploadNormalizedImage({
    normalized,
    config,
    traceId,
    signal,
    fetchImpl,
    FormDataImpl,
    endpoints,
    maxResponseBytes: limits.maxUploadResponseBytes,
  });
}

async function uploadNormalizedImage({
  normalized,
  config,
  traceId,
  signal,
  fetchImpl,
  FormDataImpl,
  endpoints,
  maxResponseBytes,
}) {
  if (typeof FormDataImpl !== "function") {
    throw new EducationAgentProxyError(
      "agent_proxy_upload_unsupported",
      "当前服务环境不支持图片上传",
      { status: 500, retryable: false, traceId },
    );
  }
  const form = new FormDataImpl();
  form.append("file", normalized.blob, normalized.fileName);
  form.append("namespace", "openchat");
  form.append("visibility", "public");
  let response;
  try {
    response = await fetchImpl(endpoints.uploadUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-api-key": config.apiKey,
        "x-trace-id": traceId,
      },
      body: form,
      signal,
    });
  } catch (cause) {
    throw networkError(cause, traceId);
  }
  if (!response?.ok) {
    await discardResponseBody(response);
    throw providerHttpError(response?.status, traceId);
  }
  const text = await readBoundedText(response, maxResponseBytes, {
    code: "agent_proxy_upload_response_too_large",
    message: "Agent 图片上传响应超过安全上限",
    traceId,
  });
  let payload;
  try { payload = JSON.parse(text); } catch {
    throw new EducationAgentProxyError(
      "agent_proxy_invalid_upload_response",
      "Agent 图片上传没有返回有效结果",
      { status: 502, retryable: true, traceId },
    );
  }
  const providerCode = Number(payload?.code);
  if (Number.isFinite(providerCode) && providerCode !== 0) throw providerEventError(payload, traceId);
  const data = isPlainObject(payload?.data) ? payload.data : payload;
  const storageUrl = safeOpaqueValue(data?.storage_url, 8_192);
  if (!storageUrl) {
    throw new EducationAgentProxyError(
      "agent_proxy_upload_missing_url",
      "Agent 图片上传成功但未返回文件地址",
      { status: 502, retryable: true, traceId },
    );
  }
  return Object.freeze({
    file_name: safeFileName(data?.file_name || normalized.fileName),
    object_key: safeOpaqueValue(data?.object_key, 2_048),
    storage_url: storageUrl,
    file_size: boundedNumber(data?.file_size, 100 * 1024 * 1024) || normalized.size,
    content_type: SAFE_IMAGE_MIME_TYPES.has(String(data?.content_type || "").toLowerCase())
      ? String(data.content_type).toLowerCase()
      : normalized.mimeType,
  });
}

function normalizeImageList(input) {
  const candidates = input.images !== undefined
    ? input.images
    : input.image !== undefined && input.image !== null
      ? [input.image]
      : [];
  if (!Array.isArray(candidates)) throw invalidInput("agent_proxy_invalid_images", "images 必须是数组");
  if (candidates.length > MAX_IMAGES) {
    throw invalidInput("agent_proxy_too_many_images", `单次最多上传 ${MAX_IMAGES} 张图片`);
  }
  return candidates;
}

function normalizeImageUpload(value, { BlobImpl, maxImageBytes }) {
  if (!value || typeof value !== "object") {
    throw invalidInput("agent_proxy_invalid_image", "图片数据格式无效");
  }
  let mimeType = String(value.mime_type || value.mimeType || value.type || "").trim().toLowerCase();
  let encoded = typeof value.data === "string" ? value.data.trim() : "";
  const dataUrl = String(value.data_url || value.dataUrl || "").trim();
  if (dataUrl) {
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/u);
    if (!match) throw invalidInput("agent_proxy_invalid_image", "图片 Data URL 格式无效");
    mimeType = match[1].toLowerCase();
    encoded = match[2].replace(/[\r\n]/gu, "");
  }
  if (!SAFE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw invalidInput("agent_proxy_invalid_image_type", "仅支持 JPEG、PNG 或 WebP 图片");
  }
  let bytes;
  if (encoded) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
      throw invalidInput("agent_proxy_invalid_image", "图片 Base64 数据无效");
    }
    bytes = Buffer.from(encoded, "base64");
  } else if (Buffer.isBuffer(value.buffer) || value.buffer instanceof Uint8Array) {
    bytes = Buffer.from(value.buffer);
  } else if (value instanceof Uint8Array) {
    bytes = Buffer.from(value);
  } else {
    throw invalidInput("agent_proxy_invalid_image", "图片数据为空");
  }
  if (!bytes.length || bytes.length > maxImageBytes) {
    throw invalidInput("agent_proxy_image_too_large", "图片为空或超过单图大小上限");
  }
  if (typeof BlobImpl !== "function") {
    throw new EducationAgentProxyError(
      "agent_proxy_upload_unsupported",
      "当前服务环境不支持图片上传",
      { status: 500, retryable: false },
    );
  }
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[mimeType];
  const fileName = safeFileName(value.name || value.file_name || `question.${extension}`);
  return Object.freeze({
    blob: new BlobImpl([bytes], { type: mimeType }),
    fileName,
    mimeType,
    size: bytes.length,
  });
}

function normalizePlatformFiles(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidInput("agent_proxy_invalid_platform_files", "platform_files 必须是数组");
  return value.slice(0, MAX_PLATFORM_FILES).map((item) => {
    if (!isPlainObject(item)) throw invalidInput("agent_proxy_invalid_platform_file", "平台文件格式无效");
    const url = safeOpaqueValue(item.url || item.storage_url, 8_192);
    if (!url) throw invalidInput("agent_proxy_invalid_platform_file", "平台文件缺少 url");
    return Object.freeze({
      url,
      name: safeFileName(item.name || item.file_name || "attachment"),
    });
  });
}

function toConversationPlatformFile(value) {
  return Object.freeze({
    url: safeOpaqueValue(value?.storage_url || value?.url, 8_192),
    name: safeFileName(value?.file_name || value?.name || "attachment"),
  });
}

function buildConversationRequest({
  content,
  conversationId,
  userOneId,
  customPassThroughMap,
  platformFiles,
}) {
  const safeConversationId = safeOpaqueValue(conversationId, 240);
  const safeUserOneId = safeOpaqueValue(userOneId, 240);
  if (!safeUserOneId) {
    throw invalidInput("agent_proxy_user_required", "Agent 代理请求缺少学生标识");
  }
  const customMap = normalizeCustomPassThroughMap(customPassThroughMap);
  return {
    stream: true,
    enable_continue_event: false,
    continue_chat_id: "",
    continue_event_id: -1,
    custom_context: {},
    de_identification_replacement_fields: {},
    message: {
      content,
      content_type: "text",
      // The gateway contract requires this field even for a new conversation;
      // an empty string asks the provider to create the conversation.
      conversation_id: safeConversationId,
      ...(platformFiles.length ? { platform_files: platformFiles } : {}),
    },
    metadata: {
      user_one_id: safeUserOneId,
      custom_pass_through_map: customMap || {},
    },
  };
}

function normalizeCustomPassThroughMap(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw invalidInput("agent_proxy_invalid_custom_context", "custom_pass_through_map 必须是对象");
  }
  const output = Object.create(null);
  const state = { nodes: 0 };
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 100)) {
    if (["__proto__", "prototype", "constructor"].includes(rawKey)) continue;
    const key = safePlainText(rawKey, 200);
    if (!key) continue;
    const cloned = cloneSafeJson(rawValue, state, 0);
    const stringValue = typeof cloned === "string" ? cloned : JSON.stringify(cloned);
    output[key] = String(stringValue ?? "").slice(0, 8_000);
  }
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > 32 * 1024) {
    throw invalidInput("agent_proxy_custom_context_too_large", "Agent 业务上下文超过安全上限");
  }
  return output;
}

function cloneSafeJson(value, state, depth) {
  state.nodes += 1;
  if (state.nodes > 1_000 || depth > 8) {
    throw invalidInput("agent_proxy_invalid_custom_context", "Agent 业务上下文层级过深");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 8_000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => cloneSafeJson(item, state, depth + 1));
  if (!isPlainObject(value)) return null;
  const output = Object.create(null);
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    const safeKey = safePlainText(key, 200);
    if (!safeKey) continue;
    output[safeKey] = cloneSafeJson(child, state, depth + 1);
  }
  return output;
}

async function* parseSseStream(stream, { maxBytes, traceId }) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value?.byteLength || 0;
      if (receivedBytes > maxBytes) {
        throw new EducationAgentProxyError(
          "agent_proxy_response_too_large",
          "Agent 代理响应超过安全上限",
          { status: 502, retryable: false, traceId },
        );
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = findSseBoundary(buffer);
      while (boundary) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const frame = parseSseBlock(block);
        if (frame) yield frame;
        boundary = findSseBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    const frame = parseSseBlock(buffer);
    if (frame) yield frame;
  } finally {
    try { await reader.cancel(); } catch { /* best effort */ }
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
}

function findSseBoundary(value) {
  const match = /\r?\n\r?\n/u.exec(value);
  return match ? { index: match.index, length: match[0].length } : null;
}

function parseSseBlock(block) {
  if (!String(block || "").trim()) return null;
  const lines = String(block).split(/\r?\n/u);
  let event = "";
  let id = "";
  const data = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "id") id = value;
    if (field === "data") data.push(value);
  }
  const dataText = data.join("\n");
  return {
    event,
    id,
    data: dataText,
    done: dataText.trim() === "[DONE]",
  };
}

function parseFramePayload(data, traceId) {
  const text = String(data || "").trim();
  if (!text || text === "[DONE]") return null;
  try {
    const parsed = JSON.parse(text);
    if (isPlainObject(parsed)) return parsed;
    if (typeof parsed === "string") return { content: parsed };
    return { content: parsed };
  } catch (cause) {
    throw new EducationAgentProxyError(
      "agent_proxy_invalid_sse",
      "Agent 代理返回了无法解析的流式事件",
      { status: 502, retryable: true, traceId, cause },
    );
  }
}

function normalizeMessageFrame(payload, { defaultContentType, providerEventId = "" }) {
  const envelope = findMessageEnvelope(payload);
  const sourceContentType = safeToken(firstValue(
    envelope?.content_type,
    envelope?.contentType,
    payload?.content_type,
    payload?.contentType,
  ), 80).toLowerCase();
  const messageType = safeToken(firstValue(
    envelope?.message_type,
    envelope?.messageType,
    payload?.message_type,
    payload?.messageType,
  ), 80).toLowerCase();
  const contentType = resolveMessageChannel(
    sourceContentType,
    messageType,
    defaultContentType,
  );
  const content = firstDefined(
    envelope?.content,
    envelope?.delta?.content,
    envelope?.delta,
    payload?.content,
    payload?.delta?.content,
    payload?.delta,
  );
  const reasoningContent = firstDefined(
    envelope?.reasoning_content,
    envelope?.reasoningContent,
    payload?.reasoning_content,
    payload?.reasoningContent,
  );
  return {
    contentType,
    sourceContentType,
    messageType,
    content,
    reasoningContent,
    eventId: safeOpaqueValue(firstValue(
      envelope?.event_id,
      envelope?.eventId,
      payload?.event_id,
      payload?.eventId,
      // Native SSE `id:` is optional and is only a last-resort event replay
      // key. The JSON `event_id` above is authoritative in the gateway spec.
      providerEventId,
    ), 240),
    messageId: safeOpaqueValue(firstValue(
      envelope?.message_id,
      envelope?.messageId,
      envelope?.id,
      payload?.message_id,
      payload?.messageId,
      payload?.id,
    ), 240),
    envelope,
    payload,
  };
}

function findMessageEnvelope(payload) {
  const candidates = [
    payload?.message,
    payload?.data?.message,
    payload?.data,
    payload,
  ];
  return candidates.find((item) => isPlainObject(item)) || payload;
}

function* consumeMessageFrame(aggregate, frame, { phase, secret }) {
  const type = frame.contentType;
  if (frame.reasoningContent && type !== "thinking") {
    const trace = normalizeTraceContent({
      ...frame,
      contentType: "thinking",
      content: frame.reasoningContent,
    }, { phase, secret });
    if (trace) {
      yield freezeEvent({
        type: "trace",
        stage: "agent_proxy.thinking",
        message: trace.message,
        span: trace.span,
        references: trace.references,
        conversation_id: aggregate.conversationId,
        chat_id: aggregate.chatId,
        trace_id: aggregate.traceId,
      });
    }
  }
  if (type === "text") {
    const rawText = contentAsText(frame.content);
    const normalizedText = frame.sourceContentType === "html" ? htmlToPlainText(rawText) : rawText;
    if (phase === "completed") {
      const next = redactSecret(normalizedText, secret);
      aggregate.answerRedactor.reset();
      if (!next) return;
      const previous = aggregate.answer;
      aggregate.answer = next;
      const missingSuffix = next.startsWith(previous) ? next.slice(previous.length) : "";
      if (missingSuffix) {
        yield freezeEvent({
          type: "delta",
          delta: missingSuffix,
          conversation_id: aggregate.conversationId,
          chat_id: aggregate.chatId,
          trace_id: aggregate.traceId,
        });
      }
      return;
    }
    const eventKey = frame.eventId
      ? `${frame.messageId || "answer"}:${frame.eventId}`
      : "";
    if (eventKey && aggregate.seenDeltaEvents.has(eventKey)) return;
    if (eventKey) aggregate.seenDeltaEvents.add(eventKey);
    // De-duplicate before mutating the stateful rolling redactor. A replayed
    // event may contain only a prefix of the secret and must not alter the
    // prefix match carried into the next genuine delta.
    const next = aggregate.answerRedactor.push(normalizedText);
    if (!next) return;
    // conversation.message.delta.content is an incremental fragment. Only a
    // stable provider event id can identify a replay; text overlap is not a
    // valid de-duplication key because repeated characters are meaningful.
    aggregate.answer += next;
    if (next) {
      yield freezeEvent({
        type: "delta",
        delta: next,
        conversation_id: aggregate.conversationId,
        chat_id: aggregate.chatId,
        trace_id: aggregate.traceId,
      });
    }
    return;
  }
  if (TRACE_CONTENT_TYPES.has(type)) {
    const trace = normalizeTraceContent(frame, { phase, secret });
    if (!trace) return;
    for (const reference of trace.references) appendUnique(aggregate.references, reference, referenceIdentity);
    yield freezeEvent({
      type: "trace",
      stage: `agent_proxy.${type}`,
      message: trace.message,
      span: trace.span,
      references: trace.references,
      conversation_id: aggregate.conversationId,
      chat_id: aggregate.chatId,
      trace_id: aggregate.traceId,
    });
    return;
  }
  if (RICH_CONTENT_TYPES.has(type)) {
    const additions = collectRichValue(aggregate, type, frame.content);
    for (const item of additions) {
      yield freezeEvent({
        type: "artifact",
        artifact_type: type,
        artifact: redactOutputValue(item, secret),
        conversation_id: aggregate.conversationId,
        chat_id: aggregate.chatId,
        trace_id: aggregate.traceId,
      });
    }
  }
}

function normalizeTraceContent(frame, { phase, secret }) {
  const decoded = decodeStructured(frame.content);
  const references = redactOutputValue(extractReferences(decoded), secret);
  const envelope = frame.envelope || {};
  const decodedObject = isPlainObject(decoded) ? decoded : {};
  const rawMessage = typeof decoded === "string"
    ? decoded
    : firstValue(
        decodedObject.description,
        decodedObject.message,
        decodedObject.text,
        decodedObject.content,
        envelope.description,
        envelope.message,
        envelope.name,
      );
  const fallback = references.length
    ? `已获得 ${references.length} 条参考资料`
    : traceTypeLabel(frame.contentType);
  const message = redactSecret(safePlainText(rawMessage || fallback, MAX_TRACE_TEXT), secret);
  const spanId = safeTraceIdentifier(firstValue(
    decodedObject.span_id,
    envelope.span_id,
    frame.payload?.span_id,
    frame.payload?.id,
  ), secret, 200);
  const parentSpanId = safeTraceIdentifier(firstValue(
    decodedObject.parent_span_id,
    envelope.parent_span_id,
    frame.payload?.parent_span_id,
  ), secret, 200);
  const name = redactSecret(safePlainText(firstValue(
    decodedObject.tool_name,
    decodedObject.name,
    decodedObject.action,
    envelope.tool_name,
    envelope.name,
    traceTypeLabel(frame.contentType),
  ), 300), secret);
  const durationMs = boundedNonNegativeNumber(firstValue(
    decodedObject.duration_ms,
    decodedObject.durationMs,
    envelope.duration_ms,
    envelope.durationMs,
  ), 600_000);
  const startedAt = safeIsoTimestamp(firstValue(
    decodedObject.started_at,
    decodedObject.startedAt,
    envelope.started_at,
    envelope.startedAt,
  ));
  const endedAt = safeIsoTimestamp(firstValue(
    decodedObject.ended_at,
    decodedObject.endedAt,
    envelope.ended_at,
    envelope.endedAt,
  ));
  return Object.freeze({
    message,
    references: Object.freeze(references),
    span: Object.freeze({
      span_id: spanId || null,
      parent_span_id: parentSpanId || null,
      span_type: traceSpanType(frame.contentType),
      name,
      channel: frame.contentType,
      status: normalizeSpanStatus(firstValue(decodedObject.status, envelope.status), phase),
      duration_ms: durationMs,
      started_at: startedAt || null,
      ended_at: endedAt || null,
      input_summary: safeTraceSummary(
        firstDefined(decodedObject.input_summary, decodedObject.input, envelope.input_summary, envelope.input),
        secret,
      ),
      output_summary: safeTraceSummary(
        firstDefined(decodedObject.output_summary, decodedObject.output, envelope.output_summary, envelope.output),
        secret,
      ),
      attributes: normalizeTraceAttributes(
        firstDefined(decodedObject.attributes, envelope.attributes),
        secret,
      ),
    }),
  });
}

function collectRichValue(aggregate, type, value) {
  const decoded = decodeStructured(value);
  const additions = [];
  if (type === "suggestion") {
    for (const candidate of unwrapCandidates(decoded, ["suggestions", "follow_ups", "items", "data"])) {
      const normalized = normalizeSuggestion(candidate);
      if (normalized && appendUnique(aggregate.suggestions, normalized, (item) => item)) additions.push(normalized);
    }
    return additions;
  }
  const keyMap = {
    card: ["cards", "card", "items", "data"],
    image: ["images", "image_infos", "image_info", "image", "items", "data"],
    video: ["videos", "video_infos", "video_info", "video", "items", "data"],
    audio: ["audios", "audio_infos", "audio_info", "audio", "items", "data"],
    file: ["files", "file_infos", "file_info", "file", "items", "data"],
  };
  const normalizer = {
    card: normalizeExternalCard,
    image: normalizeExternalImage,
    video: normalizeExternalVideo,
    audio: normalizeExternalAudio,
    file: normalizeExternalFile,
  }[type];
  const destination = {
    card: aggregate.cards,
    image: aggregate.images,
    video: aggregate.videos,
    audio: aggregate.audio,
    file: aggregate.files,
  }[type];
  const identity = {
    card: cardIdentity,
    image: (item) => item.image_url,
    video: (item) => item.id || item.url || item.cover_image?.image_url,
    audio: (item) => item.id || item.url,
    file: (item) => item.id || item.url || item.name,
  }[type];
  for (const candidate of unwrapCandidates(decoded, keyMap[type])) {
    const normalized = normalizer(candidate);
    if (normalized && appendUnique(destination, normalized, identity)) additions.push(normalized);
  }
  return additions;
}

function unwrapCandidates(value, wrapperKeys) {
  const decoded = decodeStructured(value);
  if (Array.isArray(decoded)) return decoded.slice(0, MAX_RICH_ITEMS);
  if (!isPlainObject(decoded)) return decoded == null ? [] : [decoded];
  for (const key of wrapperKeys) {
    if (!Object.hasOwn(decoded, key)) continue;
    const nested = decodeStructured(decoded[key]);
    if (Array.isArray(nested)) return nested.slice(0, MAX_RICH_ITEMS);
    if (nested !== undefined && nested !== null) return [nested];
  }
  return [decoded];
}

function normalizeExternalCard(value) {
  const decoded = decodeStructured(value);
  if (!isPlainObject(decoded)) return null;
  const providerType = safeToken(decoded.card_type || decoded.type || decoded.kind, 80).toLowerCase();
  // Executable UI payloads need a separate, server-owned registry and input
  // Schema. This transport adapter deliberately cannot grant that authority.
  if (["a2ui", "widget", "html", "script", "component"].includes(providerType)) return null;
  const body = resolveCardBody(decoded, providerType);
  const kind = normalizeCardKind(providerType);
  const image = normalizeExternalImage(body.cover_image || body.image || body.image_info || decoded.cover_image);
  const video = kind === "video" ? normalizeExternalVideo(body.video || body) : null;
  const url = safePublicHttpsUrl(body.url || body.link || body.source_url || decoded.url || decoded.link);
  const id = safePlainText(body.id || decoded.id || decoded.card_id, 240);
  const rawTitle = safePlainText(body.title || body.name || decoded.title || decoded.name, 600);
  const summary = safePlainText(
    body.summary || body.description || body.subtitle || body.text
      || decoded.summary || decoded.description || decoded.subtitle,
    2_000,
  );
  if (!id && !url && !image && !video && !summary && !rawTitle) return null;
  return Object.freeze({
    id,
    kind,
    provider_type: providerType || "unknown",
    title: rawTitle || cardFallbackTitle(kind),
    summary,
    site_name: safePlainText(body.site_name || decoded.site_name, 240),
    source_type: safeToken(body.source_type || decoded.source_type, 120),
    author_name: safePlainText(body.author_name || decoded.author_name, 240),
    url: url || video?.url || null,
    image,
    video,
  });
}

function resolveCardBody(value, providerType) {
  const keys = providerType
    ? [`${providerType}_card`, "card_data", "data"]
    : ["video_card", "image_card", "article_card", "web_card", "card_data", "data"];
  for (const key of keys) {
    const candidate = decodeStructured(value[key]);
    if (isPlainObject(candidate)) return candidate;
  }
  return value;
}

function normalizeCardKind(value) {
  if (value === "video") return "video";
  if (["image", "image_group", "gallery"].includes(value)) return "image";
  if (["article", "web", "news"].includes(value)) return "article";
  if (["reference", "product", "poi", "travel", "weather"].includes(value)) return "reference";
  return "summary";
}

function cardFallbackTitle(kind) {
  return ({
    video: "视频内容",
    image: "图片内容",
    article: "参考资料",
    reference: "参考信息",
    summary: "Agent 卡片",
  })[kind] || "Agent 卡片";
}

function normalizeExternalImage(value) {
  const decoded = decodeStructured(value);
  if (typeof decoded === "string") {
    const imageUrl = safePublicHttpsUrl(decoded);
    return imageUrl ? Object.freeze({
      image_url: imageUrl,
      source_url: null,
      width: null,
      height: null,
      alt: "",
    }) : null;
  }
  if (!isPlainObject(decoded)) return null;
  const imageUrl = safePublicHttpsUrl(decoded.image_url || decoded.imageUrl || decoded.url || decoded.src);
  if (!imageUrl) return null;
  return Object.freeze({
    image_url: imageUrl,
    source_url: safePublicHttpsUrl(decoded.source_url || decoded.sourceUrl || decoded.link) || null,
    width: boundedNumber(decoded.width, 100_000),
    height: boundedNumber(decoded.height, 100_000),
    alt: safePlainText(decoded.alt || decoded.title || decoded.caption, 300),
  });
}

function normalizeExternalVideo(value) {
  const decoded = decodeStructured(value);
  if (typeof decoded === "string") {
    const url = safePublicHttpsUrl(decoded);
    return url ? Object.freeze({
      id: "",
      url,
      title: "",
      site_name: "",
      source_type: "",
      author_name: "",
      width: null,
      height: null,
      duration_ms: null,
      cover_image: null,
    }) : null;
  }
  if (!isPlainObject(decoded)) return null;
  const url = safePublicHttpsUrl(decoded.url || decoded.video_url || decoded.videoUrl || decoded.play_url);
  const coverImage = normalizeExternalImage(decoded.cover_image || decoded.coverImage || decoded.poster || decoded.image_info);
  const id = safePlainText(decoded.id || decoded.video_id || decoded.videoId, 240);
  if (!url && !coverImage && !id) return null;
  return Object.freeze({
    id,
    url: url || null,
    title: safePlainText(decoded.title || decoded.name, 600),
    site_name: safePlainText(decoded.site_name || decoded.siteName, 240),
    source_type: safeToken(decoded.source_type || decoded.sourceType, 120),
    author_name: safePlainText(decoded.author_name || decoded.authorName, 240),
    width: boundedNumber(decoded.width, 100_000),
    height: boundedNumber(decoded.height, 100_000),
    duration_ms: boundedNumber(decoded.duration_ms ?? decoded.durationMs ?? decoded.duration, 86_400_000),
    cover_image: coverImage,
  });
}

function normalizeExternalAudio(value) {
  const decoded = decodeStructured(value);
  if (typeof decoded === "string") {
    const url = safePublicHttpsUrl(decoded);
    return url ? Object.freeze({ id: "", url, title: "", mime_type: "", duration_ms: null }) : null;
  }
  if (!isPlainObject(decoded)) return null;
  const url = safePublicHttpsUrl(decoded.url || decoded.audio_url || decoded.audioUrl || decoded.play_url);
  const id = safePlainText(decoded.id || decoded.audio_id || decoded.audioId, 240);
  if (!url && !id) return null;
  return Object.freeze({
    id,
    url: url || null,
    title: safePlainText(decoded.title || decoded.name, 600),
    mime_type: safeToken(decoded.mime_type || decoded.content_type, 120).toLowerCase(),
    duration_ms: boundedNumber(decoded.duration_ms ?? decoded.durationMs ?? decoded.duration, 86_400_000),
  });
}

function normalizeExternalFile(value) {
  const decoded = decodeStructured(value);
  if (typeof decoded === "string") {
    const url = safePublicHttpsUrl(decoded);
    return url ? Object.freeze({ id: "", url, name: "attachment", mime_type: "", size: null }) : null;
  }
  if (!isPlainObject(decoded)) return null;
  const url = safePublicHttpsUrl(decoded.url || decoded.file_url || decoded.download_url || decoded.storage_url);
  const id = safePlainText(decoded.id || decoded.file_id || decoded.object_key, 240);
  const name = safeFileName(decoded.name || decoded.file_name || decoded.title || "");
  if (!url && !id) return null;
  return Object.freeze({
    id,
    url: url || null,
    name,
    mime_type: safeToken(decoded.mime_type || decoded.content_type, 120).toLowerCase(),
    size: boundedNumber(decoded.size ?? decoded.file_size, 1024 * 1024 * 1024),
  });
}

function normalizeSuggestion(value) {
  const decoded = decodeStructured(value);
  return safePlainText(
    typeof decoded === "string"
      ? decoded
      : decoded?.text || decoded?.content || decoded?.item || decoded?.title,
    500,
  );
}

function extractReferences(value) {
  const output = [];
  const visit = (candidate, depth, isReferenceContext = false) => {
    if (depth > 4 || candidate === undefined || candidate === null) return;
    const decoded = decodeStructured(candidate);
    if (Array.isArray(decoded)) {
      for (const item of decoded.slice(0, 30)) visit(item, depth + 1, isReferenceContext);
      return;
    }
    if (!isPlainObject(decoded)) return;
    if (isReferenceContext) {
      const normalized = normalizeReference(decoded);
      if (normalized) appendUnique(output, normalized, referenceIdentity);
    }
    for (const key of [
      "references", "reference", "reference_list", "reference_infos",
      "retrievals", "retrieve_list", "sources", "citations",
    ]) {
      if (Object.hasOwn(decoded, key)) visit(decoded[key], depth + 1, true);
    }
    for (const key of ["data", "payload", "result", "extra"]) {
      if (Object.hasOwn(decoded, key)) visit(decoded[key], depth + 1, false);
    }
  };
  visit(value, 0, false);
  return output.slice(0, 30);
}

function normalizeReference(value) {
  if (!isPlainObject(value)) return null;
  const url = safePublicHttpsUrl(value.url || value.link || value.source_url);
  const id = safePlainText(value.id || value.reference_id || value.doc_id, 240);
  const title = safePlainText(value.title || value.name || value.document_name || value.doc_name, 600);
  const siteName = safePlainText(value.site_name || value.siteName || value.site, 240);
  const snippet = safePlainText(
    value.snippet || value.summary || value.description || value.quote || value.content || value.text,
    1_000,
  );
  if (!url && !id && !title && !snippet) return null;
  return Object.freeze({
    id,
    title,
    site_name: siteName,
    reference_type: safeToken(value.type || value.reference_type || value.source_type, 120),
    url: url || null,
    snippet,
  });
}

function createAggregate(traceId, secret = "") {
  return {
    traceId,
    conversationId: "",
    chatId: "",
    answer: "",
    textMessageCompleted: false,
    references: [],
    cards: [],
    images: [],
    videos: [],
    audio: [],
    files: [],
    suggestions: [],
    seenDeltaEvents: new Set(),
    answerRedactor: createStreamingSecretRedactor(secret),
  };
}

function updateAggregateIds(aggregate, payload) {
  const conversationId = safeOpaqueValue(deepPick(payload, [
    "conversation_id", "message.conversation_id", "data.conversation_id", "data.message.conversation_id",
  ]), 240);
  const chatId = safeOpaqueValue(deepPick(payload, [
    "chat_id", "message.chat_id", "data.chat_id", "data.message.chat_id",
  ]), 240);
  if (conversationId) aggregate.conversationId = conversationId;
  if (chatId) aggregate.chatId = chatId;
}

function buildFinalEvent(aggregate, answer, completedBy, secret = "") {
  const projection = finalRichProjection(aggregate);
  return freezeEvent(redactOutputValue({
    schema_version: EDUCATION_AGENT_PROXY_FINAL_VERSION,
    type: "final",
    answer,
    display_answer: answer,
    conversation_id: aggregate.conversationId,
    chat_id: aggregate.chatId,
    trace_id: aggregate.traceId,
    provider: "external_agent_proxy",
    completed_by: completedBy,
    references: Object.freeze([...aggregate.references]),
    rich_results: projection.rich_results,
    attachments: projection.attachments,
    suggestions: projection.suggestions,
    mastery_write_authorized: false,
  }, secret));
}

function finalRichProjection(aggregate) {
  return deepFreeze({
    rich_results: {
      schema_version: "external-rich-results@1.0",
      cards: aggregate.cards.slice(0, 12),
      images: aggregate.images.slice(0, 16),
      videos: aggregate.videos.slice(0, 8),
    },
    attachments: {
      schema_version: "agent-proxy-attachments@1.0",
      audio: aggregate.audio.slice(0, 8),
      files: aggregate.files.slice(0, 12),
    },
    suggestions: aggregate.suggestions.slice(0, 8),
  });
}

function inferEventName(data) {
  try {
    const parsed = JSON.parse(String(data || ""));
    return parsed?.event || parsed?.event_type || parsed?.type || "";
  } catch {
    return "";
  }
}

function isUpstreamErrorFrame(eventName, payload) {
  if (/(?:^|\.)(?:error|failed|failure|canceled|cancelled)$/iu.test(eventName)) return true;
  const messageType = String(deepPick(payload, [
    "message_type", "message.message_type", "data.message_type", "data.message.message_type",
  ]) || "").toLowerCase();
  if (messageType === "error") return true;
  const status = String(deepPick(payload, ["status", "data.status", "error.status"]) || "").toLowerCase();
  if (["error", "failed", "failure", "canceled", "cancelled"].includes(status)) return true;
  const code = Number(payload?.code);
  return Number.isFinite(code) && code !== 0;
}

function contentAsText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => contentAsText(item?.text ?? item?.content ?? item)).join("");
  }
  if (isPlainObject(value)) return contentAsText(value.text ?? value.content ?? value.delta ?? "");
  return "";
}

function decodeStructured(value, depth = 0) {
  if (depth > 3 || typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("[") && !text.startsWith('"'))) return value;
  try { return decodeStructured(JSON.parse(text), depth + 1); } catch { return value; }
}

function resolveMessageChannel(contentTypeValue, messageTypeValue, fallback) {
  const type = safeToken(contentTypeValue, 80).toLowerCase();
  const messageType = safeToken(messageTypeValue, 80).toLowerCase();
  if (messageType === "thinking") return "thinking";
  if (["verbose", "system", "intent"].includes(messageType)) return "verbose";
  if (["tool_message", "run_workflow", "run_node"].includes(messageType)) return "tool";
  if (["qa_retrieve", "knowledge_retrieve", "terminology_retrieve"].includes(messageType)) return "retrieve";
  if (messageType === "suggestion") return "suggestion";
  if (["thinking", "reasoning", "thought"].includes(type)) return "thinking";
  if (["verbose", "process", "processing", "cost", "intent"].includes(type)) return "verbose";
  if (["tool", "tool_call", "tool_resp", "tool_result", "function"].includes(type)) return "tool";
  if ([
    "retrieve", "retrieval", "knowledge", "reference", "references",
    "knowledge_retrieve_call", "knowledge_retrieve_result",
  ].includes(type)) return "retrieve";
  if (["card", "a2ui", "widget"].includes(type)) return "card";
  if (["image", "image_url", "picture"].includes(type)) return "image";
  if (["audio", "audio_url", "voice"].includes(type)) return "audio";
  if (["video", "video_url"].includes(type)) return "video";
  if (["file", "attachment", "document"].includes(type)) return "file";
  if (["suggestion", "suggestions", "follow_up", "follow_ups"].includes(type)) return "suggestion";
  // Only an answer message may become learner-visible prose. A thinking or
  // system message that happens to use content_type=text must never leak into
  // the answer buffer.
  if (messageType === "answer" && ["text", "html", "json", "markdown", ""].includes(type)) {
    return "text";
  }
  return messageType ? "" : (fallback === "text" ? "" : fallback || "");
}

function htmlToPlainText(value) {
  return String(value || "")
    .replace(/<\s*br\s*\/?>/giu, "\n")
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6])\s*>/giu, "\n")
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&");
}

function normalizeSpanStatus(value, phase) {
  const status = safeToken(value, 40).toLowerCase();
  if (["success", "completed", "done", "ok"].includes(status)) return "success";
  if (["error", "failed", "failure"].includes(status)) return "error";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  return phase === "completed" ? "success" : "running";
}

function traceSpanType(type) {
  return ({ thinking: "llm", verbose: "agent", tool: "function", retrieve: "retrieval" })[type] || "agent";
}

function traceTypeLabel(type) {
  return ({ thinking: "Agent 正在思考", verbose: "Agent 处理进度", tool: "Agent 工具调用", retrieve: "Agent 知识召回" })[type]
    || "Agent 运行事件";
}

function safeAnswerText(value) {
  return String(value || "").replace(/\u0000/gu, "").trim().slice(0, 256 * 1024);
}

function normalizeQuestionContent(value, { allowEmpty }) {
  const text = String(value ?? "").replace(/\u0000/gu, "").trim();
  if (!text && !allowEmpty) throw invalidInput("agent_proxy_content_required", "请输入问题内容");
  if (text.length > MAX_TEXT_LENGTH) throw invalidInput("agent_proxy_content_too_large", "问题内容超过安全上限");
  return text;
}

function safePublicHttpsUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > 8_192) return "";
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || isLocalOrPrivateHost(parsed.hostname)) {
      return "";
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isLocalOrPrivateHost(value) {
  const hostname = String(value || "").replace(/^\[|\]$/gu, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname.includes(":")) {
    return hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:");
  }
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return false;
  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function safePlainText(value, maxLength) {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/<[^>]*>/gu, " ")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function safeToken(value, maxLength) {
  return String(value || "").replace(/[^A-Za-z0-9._:-]/gu, "").slice(0, maxLength);
}

function safeTraceId(value) {
  const candidate = String(value || "").trim();
  return SAFE_TRACE_ID.test(candidate) ? candidate : "";
}

function safeEventName(value) {
  return safeToken(value, 200).toLowerCase();
}

function safeOpaqueValue(value, maxLength) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > maxLength || /[\u0000-\u001f\u007f]/u.test(candidate)) return "";
  return candidate;
}

function safeFileName(value) {
  return String(value || "")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240) || "attachment";
}

function redactSecret(value, secret) {
  const text = String(value || "");
  const token = String(secret || "");
  return token ? text.split(token).join(secretRedactionMarker(token)) : text;
}

function createStreamingSecretRedactor(secret) {
  const token = String(secret || "");
  const marker = secretRedactionMarker(token);
  const prefixTable = buildPrefixTable(token);
  let matched = 0;
  return {
    push(value) {
      const input = String(value || "");
      if (!token) return input;
      let output = "";
      for (const character of input) {
        while (matched > 0 && token[matched] !== character) {
          const fallback = prefixTable[matched - 1];
          output += token.slice(0, matched - fallback);
          matched = fallback;
        }
        if (token[matched] === character) {
          matched += 1;
          if (matched === token.length) {
            output += marker;
            matched = 0;
          }
        } else {
          output += character;
        }
      }
      return output;
    },
    flush() {
      const output = token.slice(0, matched);
      matched = 0;
      return output;
    },
    reset() {
      matched = 0;
    },
  };
}

function buildPrefixTable(value) {
  const table = new Array(value.length).fill(0);
  for (let index = 1, matched = 0; index < value.length; index += 1) {
    while (matched > 0 && value[index] !== value[matched]) matched = table[matched - 1];
    if (value[index] === value[matched]) matched += 1;
    table[index] = matched;
  }
  return table;
}

function secretRedactionMarker(secret) {
  const preferred = "[已脱敏]";
  if (!preferred.includes(secret) && !secret.includes(preferred[0]) && !secret.includes(preferred.at(-1))) {
    return preferred;
  }
  const boundary = ["¤", "§", "¶", "※", "◊", "�"].find((item) => !secret.includes(item));
  return boundary ? boundary.repeat(3) : "";
}

function safeTraceIdentifier(value, secret, maxLength) {
  const candidate = String(value || "");
  if (secret && candidate.includes(String(secret))) return "";
  return safeToken(candidate, maxLength);
}

function safeTraceSummary(value, secret) {
  if (value === undefined || value === null || value === "") return "";
  let serialized = value;
  if (typeof value === "object") {
    try { serialized = JSON.stringify(value); } catch { serialized = ""; }
  }
  return redactSecret(safePlainText(serialized, 2_000), secret);
}

function normalizeTraceAttributes(value, secret) {
  if (!isPlainObject(value)) return Object.freeze({});
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 24)) {
    const key = normalizeTraceAttributeKey(rawKey, secret);
    if (!key) continue;
    const summary = safeTraceSummary(rawValue, secret).slice(0, 400);
    if (summary) output[key] = summary;
  }
  return Object.freeze(output);
}

function normalizeTraceAttributeKey(value, secret) {
  const candidate = String(value || "");
  if (secret && candidate.includes(String(secret))) return "";
  const key = safeToken(candidate, 80);
  return key && !isSensitiveCredentialName(key) ? key : "";
}

function safeIsoTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function redactOutputValue(value, secret, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > 2_000 || depth > 12) return null;
  if (typeof value === "string") return redactSecret(value, secret);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactOutputValue(item, secret, depth + 1, budget));
  }
  if (!isPlainObject(value)) return null;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    redactOutputValue(child, secret, depth + 1, budget),
  ]));
}

function boundedNumber(value, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= maximum ? Math.round(number) : null;
}

function boundedNonNegativeNumber(value, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? Math.round(number) : null;
}

function normalizeTimeout(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 10 && number <= 30 * 60_000 ? number : fallback;
}

function positiveLimit(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function invalidInput(code, message) {
  return new EducationAgentProxyError(code, message, { status: 422, retryable: false });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function deepPick(value, paths) {
  for (const path of paths) {
    let cursor = value;
    for (const segment of path.split(".")) cursor = cursor?.[segment];
    if (cursor !== undefined && cursor !== null && cursor !== "") return cursor;
  }
  return undefined;
}

function appendUnique(array, value, identity) {
  const key = identity(value);
  if (!key || array.some((item) => identity(item) === key) || array.length >= MAX_RICH_ITEMS) return false;
  array.push(value);
  return true;
}

function referenceIdentity(value) {
  return value.url || value.id || `${value.site_name}:${value.title}`;
}

function cardIdentity(value) {
  return value.id || value.url || `${value.kind}:${value.title}`;
}

function freezeEvent(value) {
  return deepFreeze({ schema_version: EDUCATION_AGENT_PROXY_EVENT_VERSION, ...value });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

async function readBoundedText(response, maxBytes, { code, message, traceId }) {
  if (!response?.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength || 0;
      if (total > maxBytes) {
        throw new EducationAgentProxyError(code, message, {
          status: 502,
          retryable: false,
          traceId,
        });
      }
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    try { await reader.cancel(); } catch { /* best effort */ }
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
}

async function discardResponseBody(response) {
  try { await response?.body?.cancel?.(); } catch { /* never surface provider error bodies */ }
}
