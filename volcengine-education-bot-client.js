const DEFAULT_BASE_URL = "https://open.feedcoopapi.com/agent_api/agent";
const DEFAULT_SERVICE_NAME = "ask_echo";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_500;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;
const DEFAULT_CONFIG_PROBE_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_PROBE_CACHE_TTL_MS = 5 * 60_000;
const MAX_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SSE_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_DATA_IMAGE_LENGTH = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u;
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|gif|webp|bmp|tiff|heic|heif);base64,[A-Za-z0-9+/=\r\n]+$/u;

export class VolcengineEducationBotError extends Error {
  constructor(code, message, {
    status = 502,
    retryable = false,
    providerCode = "",
    requestId = "",
    cause,
  } = {}) {
    super(message, { cause });
    this.name = "VolcengineEducationBotError";
    this.code = safeText(code, 160);
    this.status = Number.isInteger(status) ? status : 502;
    this.retryable = retryable === true;
    this.providerCode = safeText(providerCode, 240);
    this.requestId = safeText(requestId, 240);
  }
}

/**
 * Server-only client for Volcengine AskEcho education APIs.
 *
 * Authentication is read once from env and cannot be overridden per request.
 * No network request is made until an explicit client method is called.
 */
export function createVolcengineEducationBotClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
  nowImpl = Date.now,
} = {}) {
  const config = readConfig(env);
  const endpoints = buildEndpoints(config.baseUrl);
  const missing = Object.freeze(missingConfigurationFields(config));
  const now = typeof nowImpl === "function" ? nowImpl : Date.now;
  let verification = createInitialVerification(missing, config.credentialIssue);
  let probePromise = null;

  function configSummary() {
    verification = expireVerificationIfNeeded(verification, now());
    const configurationStatus = verification.status;
    return Object.freeze({
      schema_version: "volc_education_bot_config@1.1",
      configured: configurationStatus === "verified",
      configuration_status: configurationStatus,
      has_required_config: missing.length === 0,
      can_attempt: missing.length === 0 && configurationStatus !== "rejected",
      missing,
      base_url: endpoints.baseUrl,
      bot_id: config.botId || null,
      service_name: config.serviceName,
      credential_env: config.credentialEnv || null,
      credential_source: config.credentialSource || null,
      credential_issue: config.credentialIssue || null,
      timeout_ms: config.timeoutMs,
      homework_poll_interval_ms: config.pollIntervalMs,
      homework_poll_timeout_ms: config.pollTimeoutMs,
      verification: Object.freeze({
        status: configurationStatus,
        reason_code: verification.reasonCode,
        message: verification.message,
        checked_at: toIsoTimestamp(verification.checkedAtMs),
        expires_at: toIsoTimestamp(verification.expiresAtMs),
        last_verified_at: toIsoTimestamp(verification.lastVerifiedAtMs),
        source: verification.source,
        error_code: verification.errorCode || null,
        provider_code: verification.providerCode || null,
        http_status: verification.httpStatus || null,
        retryable: verification.retryable,
        cache_ttl_ms: config.probeCacheTtlMs,
      }),
      endpoints: Object.freeze({
        chat_completion: "/chat/completion",
        homework_submit: "/home_work/mark/submit",
        homework_query: "/home_work/mark/query",
      }),
    });
  }

  /**
   * Performs one bounded, real AskEcho request and caches only a redacted
   * verification outcome. Expected configuration failures are represented by
   * the returned status instead of being thrown to callers such as
   * /runtime-config.
   */
  async function probeConfiguration({ force = false, signal, timeoutMs } = {}) {
    verification = expireVerificationIfNeeded(verification, now());
    if (missing.length > 0) return configSummary();
    if (!force && hasFreshVerification(verification, now())) return configSummary();
    if (probePromise) return probePromise;

    probePromise = (async () => {
      try {
        await chatCompletion({
          messages: [{ role: "user", content: "请仅回复“连接正常”。" }],
          browsingMode: 1,
          enableProcessingState: false,
          timeoutMs: normalizeTimeout(timeoutMs, config.probeTimeoutMs),
          signal,
        });
        markVerified("probe");
      } catch (error) {
        if (!signal?.aborted) markVerificationFailure(error, "probe");
      }
      return configSummary();
    })().finally(() => {
      probePromise = null;
    });
    return probePromise;
  }

  function markVerified(source = "request") {
    const checkedAtMs = now();
    verification = Object.freeze({
      status: "verified",
      reasonCode: "verified",
      message: "AskEcho credential and bot access were verified.",
      checkedAtMs,
      expiresAtMs: checkedAtMs + config.probeCacheTtlMs,
      lastVerifiedAtMs: checkedAtMs,
      source,
      errorCode: "",
      providerCode: "",
      httpStatus: 0,
      retryable: false,
    });
  }

  function markVerificationFailure(error, source = "request") {
    const classification = classifyVerificationFailure(error);
    if (!classification) return;
    const checkedAtMs = now();
    verification = Object.freeze({
      status: classification.status,
      reasonCode: classification.reasonCode,
      message: classification.message,
      checkedAtMs,
      expiresAtMs: checkedAtMs + config.probeCacheTtlMs,
      lastVerifiedAtMs: verification.lastVerifiedAtMs || 0,
      source,
      errorCode: safeText(error?.code, 160),
      providerCode: redactSecret(error?.providerCode, config.apiToken),
      httpStatus: Number.isInteger(error?.status) ? error.status : 0,
      retryable: classification.retryable,
    });
  }

  async function* streamChatCompletion(input = {}) {
    ensureConfigured(config, fetchImpl);
    const body = normalizeChatRequest(input, config.botId);
    const timeoutMs = normalizeTimeout(input.timeoutMs, config.timeoutMs);
    const controller = new AbortController();
    const abort = () => controller.abort(input.signal?.reason);
    const timer = setTimeout(() => controller.abort(new Error("request timeout")), timeoutMs);
    input.signal?.addEventListener?.("abort", abort, { once: true });
    let receivedDone = false;

    try {
      let response;
      try {
        response = await fetchImpl(endpoints.chatCompletion, {
          method: "POST",
          headers: requestHeaders(config, true),
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (cause) {
        throw mapNetworkError(cause, controller.signal, config.apiToken);
      }

      if (!response?.ok) {
        throw await providerHttpError(response, config.apiToken);
      }
      const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
      if (!contentType.includes("text/event-stream")) {
        const text = await readBoundedText(response, MAX_JSON_RESPONSE_BYTES);
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }
        assertNoProviderError(payload, config.apiToken, responseRequestId(response));
        throw new VolcengineEducationBotError(
          "volc_education_invalid_sse_content_type",
          "Volcengine education bot did not return an SSE event stream.",
          { status: 502, retryable: true, requestId: responseRequestId(response) },
        );
      }
      if (!response.body) {
        throw new VolcengineEducationBotError(
          "volc_education_invalid_response",
          "Volcengine education bot returned an empty event stream.",
          { status: 502, retryable: true, requestId: responseRequestId(response) },
        );
      }

      for await (const data of parseSseData(response.body, MAX_SSE_RESPONSE_BYTES)) {
        if (data === "[DONE]") {
          receivedDone = true;
          yield Object.freeze({
            schema_version: "volc_education_chat_event@1.0",
            type: "done",
          });
          break;
        }

        let payload;
        try {
          payload = JSON.parse(data);
        } catch (cause) {
          throw new VolcengineEducationBotError(
            "volc_education_invalid_sse",
            "Volcengine education bot returned malformed SSE JSON.",
            { status: 502, retryable: true, requestId: responseRequestId(response), cause },
          );
        }
        const event = normalizeChatFrame(payload, config.apiToken);
        if (event.type === "error") {
          markVerificationFailure(providerEventError(event.error), "request");
        } else {
          markVerified("request");
        }
        yield event;
      }

      if (!receivedDone) {
        throw new VolcengineEducationBotError(
          "volc_education_incomplete_sse",
          "Volcengine education bot closed the stream before the DONE frame.",
          { status: 502, retryable: true, requestId: responseRequestId(response) },
        );
      }
    } catch (error) {
      const normalized = error instanceof VolcengineEducationBotError
        ? error
        : mapNetworkError(error, controller.signal, config.apiToken);
      if (!input.signal?.aborted) markVerificationFailure(normalized, "request");
      throw normalized;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener?.("abort", abort);
    }
  }

  async function chatCompletion(input = {}) {
    const aggregate = {
      schema_version: "volc_education_chat@1.0",
      response_id: null,
      content: "",
      reasoning_content: "",
      finish_reason: "",
      processing: [],
      references: [],
      search_results: [],
      cards: [],
      follow_ups: [],
      usage: null,
    };
    let streamError = null;

    for await (const event of streamChatCompletion(input)) {
      if (event.type === "error") {
        streamError = event.error;
        continue;
      }
      if (event.response_id) aggregate.response_id = event.response_id;
      if (event.content_delta) aggregate.content += event.content_delta;
      if (event.reasoning_delta) aggregate.reasoning_content += event.reasoning_delta;
      if (event.finish_reason) aggregate.finish_reason = event.finish_reason;
      if (event.processing_state) aggregate.processing.push(event.processing_state);
      replaceWhenArray(aggregate, "references", event.references);
      replaceWhenArray(aggregate, "search_results", event.search_results);
      replaceWhenArray(aggregate, "cards", event.cards);
      replaceWhenArray(aggregate, "follow_ups", event.follow_ups);
      if (event.usage) aggregate.usage = event.usage;
    }

    if (streamError) {
      throw new VolcengineEducationBotError(
        "volc_education_provider_error",
        streamError.message || "Volcengine education bot returned a stream error.",
        {
          status: providerErrorStatus(streamError.type),
          retryable: isRetryableProviderError(streamError.type),
          providerCode: streamError.code,
          requestId: streamError.log_id,
        },
      );
    }
    return Object.freeze(aggregate);
  }

  async function submitHomeworkMark(input = {}) {
    ensureConfigured(config, fetchImpl);
    const body = normalizeHomeworkSubmitRequest(input, config.botId);
    let receipt;
    try {
      receipt = await requestJson({
        url: endpoints.homeworkSubmit,
        body,
        signal: input.signal,
        timeoutMs: normalizeTimeout(input.timeoutMs, config.timeoutMs),
        config,
        fetchImpl,
      });
      markVerified("request");
    } catch (error) {
      if (!input.signal?.aborted) markVerificationFailure(error, "request");
      throw error;
    }
    return normalizeHomeworkMark(receipt.payload, {
      phase: "submit",
      fallbackRequestId: receipt.requestId,
    });
  }

  async function queryHomeworkMark(taskId, input = {}) {
    ensureConfigured(config, fetchImpl);
    const normalizedTaskId = normalizeId(taskId, "taskId");
    let receipt;
    try {
      receipt = await requestJson({
        url: endpoints.homeworkQuery,
        body: { bot_id: config.botId, task_id: normalizedTaskId },
        signal: input.signal,
        timeoutMs: normalizeTimeout(input.timeoutMs, config.timeoutMs),
        config,
        fetchImpl,
      });
      markVerified("request");
    } catch (error) {
      if (!input.signal?.aborted) markVerificationFailure(error, "request");
      throw error;
    }
    return normalizeHomeworkMark(receipt.payload, {
      phase: "query",
      fallbackRequestId: receipt.requestId,
    });
  }

  async function pollHomeworkMark(taskId, options = {}) {
    const normalizedTaskId = normalizeId(taskId, "taskId");
    const intervalMs = normalizePollInterval(options.intervalMs, config.pollIntervalMs);
    const pollTimeoutMs = normalizePollTimeout(options.pollTimeoutMs, config.pollTimeoutMs);
    const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
    const startedAt = Date.now();
    let attempts = 0;

    while (attempts < maxAttempts) {
      if (options.signal?.aborted) throw abortedError();
      attempts += 1;
      const result = await queryHomeworkMark(normalizedTaskId, {
        signal: options.signal,
        timeoutMs: options.requestTimeoutMs,
      });
      if (typeof options.onUpdate === "function") await options.onUpdate(result, attempts);
      if (result.status === "success" || result.status === "failed") return result;
      if (Date.now() - startedAt + intervalMs > pollTimeoutMs || attempts >= maxAttempts) {
        throw new VolcengineEducationBotError(
          "volc_education_homework_poll_timeout",
          "Homework marking did not reach a terminal state before the polling deadline.",
          { status: 504, retryable: true, requestId: result.provider_request_id || "" },
        );
      }
      await sleepWithSignal(intervalMs, options.signal, sleepImpl);
    }
    throw new VolcengineEducationBotError(
      "volc_education_homework_poll_timeout",
      "Homework marking did not reach a terminal state before the polling deadline.",
      { status: 504, retryable: true },
    );
  }

  return Object.freeze({
    configSummary,
    probeConfiguration,
    streamChatCompletion,
    chatCompletion,
    submitHomeworkMark,
    queryHomeworkMark,
    pollHomeworkMark,
  });
}

export function normalizeHomeworkMark(payload, {
  phase = "query",
  fallbackRequestId = "",
} = {}) {
  const { result, requestId } = unwrapProviderPayload(payload, fallbackRequestId);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw invalidProviderResponse("Homework marking result is missing.", requestId);
  }

  const taskId = normalizeProviderId(result.task_id, "task_id", requestId);
  const rawMarks = result.mark_results;
  if (rawMarks !== undefined && rawMarks !== null && !Array.isArray(rawMarks)) {
    throw invalidProviderResponse("mark_results must be an array.", requestId);
  }
  const questions = (rawMarks || []).map((mark, index) =>
    normalizeHomeworkQuestion(mark, index, requestId));
  const status = normalizeHomeworkStatus(result.status, phase, questions);
  const preprocessedImageUrl = safeHttpsUrl(result.preprocessed_image_url);

  return Object.freeze({
    schema_version: "homework_mark@1.0",
    task_id: taskId,
    status,
    phase: phase === "submit" ? "submit" : "query",
    preprocessed_image_url: preprocessedImageUrl || null,
    image_reference: Object.freeze({
      kind: "preprocessed_image",
      coordinate_unit: "pixel",
      origin: "top_left",
      polygon_order: "clockwise_from_top_left",
      url_expires_after_seconds: 7 * 24 * 60 * 60,
    }),
    questions: Object.freeze(questions),
    usage: normalizeUsage(result.usage),
    provider_request_id: safeText(requestId, 240) || null,
  });
}

function readConfig(env) {
  const source = env && typeof env === "object" ? env : {};
  const credential = resolveBearerCredential(source);
  return Object.freeze({
    baseUrl: readEnv(source, "VOLC_EDUCATION_BOT_BASE_URL") || DEFAULT_BASE_URL,
    botId: normalizeOptionalId(readEnv(source, "VOLC_EDUCATION_BOT_ID")),
    apiToken: credential.value,
    credentialEnv: credential.envName,
    credentialSource: credential.source,
    credentialIssue: credential.issue,
    requiredCredentialEnv: credential.requiredEnv,
    serviceName: normalizeServiceName(readEnv(source, "VOLC_EDUCATION_BOT_SERVICE_NAME") || DEFAULT_SERVICE_NAME),
    timeoutMs: normalizeTimeout(source.VOLC_EDUCATION_BOT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    probeTimeoutMs: normalizeTimeout(
      source.VOLC_EDUCATION_BOT_CONFIG_PROBE_TIMEOUT_MS,
      DEFAULT_CONFIG_PROBE_TIMEOUT_MS,
    ),
    probeCacheTtlMs: normalizeProbeCacheTtl(
      source.VOLC_EDUCATION_BOT_CONFIG_PROBE_CACHE_TTL_MS,
      DEFAULT_CONFIG_PROBE_CACHE_TTL_MS,
    ),
    pollIntervalMs: normalizePollInterval(
      source.VOLC_EDUCATION_BOT_MARK_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ),
    pollTimeoutMs: normalizePollTimeout(
      source.VOLC_EDUCATION_BOT_MARK_TIMEOUT_MS,
      DEFAULT_POLL_TIMEOUT_MS,
    ),
  });
}

function resolveBearerCredential(env) {
  const values = Object.freeze({
    bearer_token: readEnv(env, "VOLC_EDUCATION_BOT_BEARER_TOKEN"),
    api_key: readEnv(env, "VOLC_EDUCATION_BOT_API_KEY"),
    api_token: readEnv(env, "VOLC_EDUCATION_BOT_API_TOKEN"),
  });
  const envNames = Object.freeze({
    bearer_token: "VOLC_EDUCATION_BOT_BEARER_TOKEN",
    api_key: "VOLC_EDUCATION_BOT_API_KEY",
    api_token: "VOLC_EDUCATION_BOT_API_TOKEN",
  });
  const explicitSource = normalizeCredentialSource(
    readEnv(env, "VOLC_EDUCATION_BOT_BEARER_SOURCE"),
  );
  if (explicitSource) {
    return Object.freeze({
      value: values[explicitSource],
      envName: values[explicitSource] ? envNames[explicitSource] : "",
      source: explicitSource,
      issue: values[explicitSource] ? "" : "selected_bearer_missing",
      requiredEnv: envNames[explicitSource],
    });
  }
  if (values.bearer_token) {
    return Object.freeze({
      value: values.bearer_token,
      envName: envNames.bearer_token,
      source: "bearer_token",
      issue: "",
      requiredEnv: envNames.bearer_token,
    });
  }
  if (values.api_key && values.api_token) {
    return Object.freeze({
      value: "",
      envName: "",
      source: "",
      issue: "ambiguous_bearer_source",
      requiredEnv: "VOLC_EDUCATION_BOT_BEARER_SOURCE",
    });
  }
  if (values.api_key || values.api_token) {
    const selected = values.api_key ? "api_key" : "api_token";
    return Object.freeze({
      value: values[selected],
      envName: envNames[selected],
      source: selected,
      issue: "",
      requiredEnv: envNames[selected],
    });
  }
  return Object.freeze({
    value: "",
    envName: "",
    source: "",
    issue: "missing_bearer",
    requiredEnv: "VOLC_EDUCATION_BOT_BEARER_TOKEN",
  });
}

function normalizeCredentialSource(value) {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  const aliases = {
    bearer_token: "bearer_token",
    volc_education_bot_bearer_token: "bearer_token",
    api_key: "api_key",
    volc_education_bot_api_key: "api_key",
    api_token: "api_token",
    volc_education_bot_api_token: "api_token",
  };
  const source = aliases[normalized];
  if (!source) {
    throw invalidConfiguration(
      "VOLC_EDUCATION_BOT_BEARER_SOURCE must select bearer_token, api_key, or api_token.",
    );
  }
  return source;
}

function missingConfigurationFields(config) {
  const missing = [];
  if (!config.botId) missing.push("VOLC_EDUCATION_BOT_ID");
  if (!config.apiToken) missing.push(config.requiredCredentialEnv || "VOLC_EDUCATION_BOT_BEARER_TOKEN");
  return missing;
}

function createInitialVerification(missing, credentialIssue) {
  const isMissing = missing.length > 0;
  const ambiguous = credentialIssue === "ambiguous_bearer_source";
  const selectedMissing = credentialIssue === "selected_bearer_missing";
  return Object.freeze({
    status: isMissing ? "missing" : "unverified",
    reasonCode: ambiguous
      ? "ambiguous_bearer_source"
      : selectedMissing
        ? "selected_bearer_missing"
        : isMissing ? "missing_configuration" : "not_checked",
    message: ambiguous
      ? "AskEcho has multiple compatible credentials; select the Bearer source explicitly."
      : selectedMissing
        ? "The selected AskEcho Bearer credential is missing."
        : isMissing
          ? "AskEcho configuration is incomplete."
          : "AskEcho credentials are present but have not been verified.",
    checkedAtMs: 0,
    expiresAtMs: 0,
    lastVerifiedAtMs: 0,
    source: isMissing ? "configuration" : "none",
    errorCode: "",
    providerCode: "",
    httpStatus: 0,
    retryable: !isMissing,
  });
}

function hasFreshVerification(verification, nowMs) {
  return verification.checkedAtMs > 0
    && verification.expiresAtMs > Number(nowMs);
}

function expireVerificationIfNeeded(verification, nowMs) {
  if (!verification.checkedAtMs || verification.expiresAtMs > Number(nowMs)) return verification;
  if (verification.status === "missing") return verification;
  return Object.freeze({
    ...verification,
    status: "unverified",
    reasonCode: "verification_expired",
    message: "AskEcho verification has expired and must be checked again.",
    checkedAtMs: 0,
    expiresAtMs: 0,
    source: "cache",
    errorCode: "",
    providerCode: "",
    httpStatus: 0,
    retryable: true,
  });
}

function toIsoTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function buildEndpoints(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw invalidConfiguration("VOLC_EDUCATION_BOT_BASE_URL must be a valid URL.");
  }
  if (!isAllowedBaseUrl(parsed) || parsed.username || parsed.password) {
    throw invalidConfiguration(
      "VOLC_EDUCATION_BOT_BASE_URL must be HTTPS, or loopback HTTP for local tests, without embedded credentials.",
    );
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  const normalized = parsed.toString().replace(/\/$/u, "");
  return Object.freeze({
    baseUrl: normalized,
    chatCompletion: `${normalized}/chat/completion`,
    homeworkSubmit: `${normalized}/home_work/mark/submit`,
    homeworkQuery: `${normalized}/home_work/mark/query`,
  });
}

function isAllowedBaseUrl(parsed) {
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
}

function ensureConfigured(config, fetchImpl) {
  const missing = missingConfigurationFields(config);
  if (missing.length) {
    throw new VolcengineEducationBotError(
      "volc_education_not_configured",
      `Volcengine education bot is not configured: ${missing.join(", ")}.`,
      { status: 503 },
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new VolcengineEducationBotError(
      "volc_education_fetch_unavailable",
      "Server fetch is unavailable.",
      { status: 503 },
    );
  }
}

function normalizeChatRequest(input, botId) {
  const body = {
    bot_id: botId,
    stream: true,
    messages: normalizeMessages(input.messages),
    extension_options: {
      browsing_mode: normalizeBrowsingMode(input.browsingMode),
      enable_processing_state: input.enableProcessingState !== false,
      card_position: normalizeCardPosition(input.cardPosition),
    },
  };
  optionalText(body, "user_id", input.userId, 512);
  optionalText(body, "device_id", input.deviceId, 512);
  optionalText(body, "knowledge", input.knowledge, MAX_TEXT_LENGTH);
  optionalText(body, "memory", input.memory, MAX_TEXT_LENGTH);
  optionalText(body, "model", input.model, 128);
  if (input.learnMode !== undefined && input.learnMode !== null && input.learnMode !== "") {
    if (input.learnMode !== "auto_learning") throw invalidRequest("learnMode must be auto_learning.");
    body.extension_options.learn_mode = input.learnMode;
  }
  return body;
}

function normalizeMessages(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidRequest("messages must be a non-empty array.");
  }
  if (value.length > 128) throw invalidRequest("messages must contain at most 128 entries before pruning.");
  const normalized = value.map((message, index) => normalizeMessage(message, index));
  const imageCount = normalized.reduce((total, message) => {
    if (!Array.isArray(message.content)) return total;
    return total + message.content.filter((part) => part.type === "image_url").length;
  }, 0);
  if (imageCount > 10) throw invalidRequest("A chat request can contain at most 10 images.");
  if (normalized.length <= 10) return normalized;
  if (normalized[0].role === "system") return [normalized[0], ...normalized.slice(-9)];
  return normalized.slice(-10);
}

function normalizeMessage(message, index) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw invalidRequest(`messages[${index}] must be an object.`);
  }
  const role = safeText(message.role, 32).toLowerCase();
  if (!["system", "user", "assistant"].includes(role)) {
    throw invalidRequest(`messages[${index}].role is invalid.`);
  }
  if (typeof message.content === "string") {
    return { role, content: requiredText(message.content, `messages[${index}].content`, MAX_TEXT_LENGTH) };
  }
  if (!Array.isArray(message.content) || message.content.length === 0) {
    throw invalidRequest(`messages[${index}].content must be text or a non-empty part array.`);
  }
  let imageCount = 0;
  const content = message.content.map((part, partIndex) => {
    const field = `messages[${index}].content[${partIndex}]`;
    if (!part || typeof part !== "object" || Array.isArray(part)) throw invalidRequest(`${field} is invalid.`);
    if (part.type === "text") return { type: "text", text: requiredText(part.text, `${field}.text`, MAX_TEXT_LENGTH) };
    if (part.type === "image_url") {
      imageCount += 1;
      if (imageCount > 10) throw invalidRequest("A message can contain at most 10 images.");
      return { type: "image_url", image_url: { url: normalizeImageInput(part.image_url?.url ?? part.image_url, field) } };
    }
    if (part.type === "file_url") {
      return { type: "file_url", file_url: { url: normalizeHttpsInput(part.file_url?.url ?? part.file_url, field) } };
    }
    throw invalidRequest(`${field}.type is unsupported.`);
  });
  return { role, content };
}

function normalizeImageInput(value, field) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw invalidRequest(`${field}.image_url is required.`);
  if (raw.startsWith("data:")) {
    if (raw.length >= MAX_DATA_IMAGE_LENGTH || !IMAGE_DATA_URL.test(raw)) {
      throw invalidRequest(`${field}.image_url must be a supported image Data URL smaller than 20 MiB.`);
    }
    return raw;
  }
  return normalizeHttpsInput(raw, `${field}.image_url`);
}

function normalizeHttpsInput(value, field) {
  let parsed;
  try {
    parsed = new URL(typeof value === "string" ? value.trim() : "");
  } catch {
    throw invalidRequest(`${field} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw invalidRequest(`${field} must be a credential-free HTTPS URL.`);
  }
  return parsed.toString();
}

function normalizeHomeworkSubmitRequest(input, botId) {
  const imageBase64 = typeof input.imageBase64 === "string" ? input.imageBase64.trim() : "";
  const imageUrl = typeof input.imageUrl === "string" ? input.imageUrl.trim() : "";
  if (!imageBase64 && !imageUrl) throw invalidRequest("imageBase64 or imageUrl is required.");
  const body = { bot_id: botId };
  // The provider prioritizes image_base64 when both are sent; sending only the
  // selected source avoids transmitting an unnecessary second copy.
  if (imageBase64) body.image_base64 = normalizeImageInput(imageBase64, "imageBase64");
  else body.image_url = normalizeHttpsInput(imageUrl, "imageUrl");
  return body;
}

async function requestJson({ url, body, signal, timeoutMs, config, fetchImpl }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const timer = setTimeout(() => controller.abort(new Error("request timeout")), timeoutMs);
  signal?.addEventListener?.("abort", abort, { once: true });
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: requestHeaders(config, false),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw mapNetworkError(cause, controller.signal, config.apiToken);
    }
    if (!response?.ok) throw await providerHttpError(response, config.apiToken);
    const text = await readBoundedText(response, MAX_JSON_RESPONSE_BYTES);
    if (!text.trim()) throw invalidProviderResponse("Volcengine education bot returned an empty response.", responseRequestId(response));
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (cause) {
      throw new VolcengineEducationBotError(
        "volc_education_invalid_response",
        "Volcengine education bot returned invalid JSON.",
        { status: 502, retryable: true, requestId: responseRequestId(response), cause },
      );
    }
    assertNoProviderError(payload, config.apiToken, responseRequestId(response));
    return Object.freeze({ payload, requestId: responseRequestId(response) || null });
  } catch (error) {
    if (error instanceof VolcengineEducationBotError) throw error;
    throw mapNetworkError(error, controller.signal, config.apiToken);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", abort);
  }
}

function requestHeaders(config, sse) {
  return {
    Authorization: `Bearer ${config.apiToken}`,
    "Content-Type": "application/json",
    ServiceName: config.serviceName,
    ...(sse ? { Accept: "text/event-stream" } : {}),
  };
}

async function providerHttpError(response, apiToken) {
  const requestId = responseRequestId(response);
  const text = await readBoundedText(response, MAX_JSON_RESPONSE_BYTES).catch(() => "");
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* preserve generic error */ }
  const provider = extractProviderError(payload) || {};
  return new VolcengineEducationBotError(
    "volc_education_provider_error",
    redactSecret(provider.message, apiToken) || `Volcengine education bot request failed with HTTP ${response?.status || 502}.`,
    {
      status: response?.status >= 400 && response.status < 500 ? response.status : 502,
      retryable: response?.status === 429 || response?.status >= 500,
      providerCode: redactSecret(provider.code, apiToken),
      requestId: provider.log_id || requestId,
    },
  );
}

function assertNoProviderError(payload, apiToken, fallbackRequestId) {
  const provider = extractProviderError(payload);
  if (!provider) return;
  throw new VolcengineEducationBotError(
    "volc_education_provider_error",
    redactSecret(provider.message, apiToken) || "Volcengine education bot returned an error.",
    {
      status: providerErrorStatus(provider.type),
      retryable: isRetryableProviderError(provider.type),
      providerCode: redactSecret(provider.code, apiToken),
      requestId: provider.log_id || fallbackRequestId,
    },
  );
}

function providerEventError(error) {
  return new VolcengineEducationBotError(
    "volc_education_provider_error",
    "AskEcho returned an error event.",
    {
      status: providerErrorStatus(error?.type),
      retryable: isRetryableProviderError(error?.type),
      providerCode: error?.code,
      requestId: error?.log_id,
    },
  );
}

function classifyVerificationFailure(error) {
  if (!(error instanceof VolcengineEducationBotError)) {
    return Object.freeze({
      status: "unverified",
      reasonCode: "verification_failed",
      message: "AskEcho could not be verified.",
      retryable: true,
    });
  }
  if (["volc_education_invalid_request", "volc_education_aborted"].includes(error.code)) {
    return null;
  }

  const providerCode = safeText(error.providerCode, 240).toLowerCase();
  const credentialRejected = [401, 403].includes(error.status)
    || /(?:invalid|expired|missing|unknown).*(?:api[_-]?key|access[_-]?key|token|credential)/u.test(providerCode)
    || /(?:unauthori[sz]ed|authentication|permission_denied|access_denied|forbidden)/u.test(providerCode);
  if (credentialRejected) {
    const permissionRejected = error.status === 403
      || /(?:permission|access_denied|forbidden)/u.test(providerCode);
    return Object.freeze({
      status: "rejected",
      reasonCode: permissionRejected ? "permission_rejected" : "credential_rejected",
      message: permissionRejected
        ? "AskEcho denied access. Check the product permission and AskEchoFullAccess for subaccounts."
        : "AskEcho rejected the Bearer credential. Check the dedicated API key and its product permission.",
      retryable: false,
    });
  }

  if (/(?:invalid|unknown|missing).*(?:bot|agent)|(?:bot|agent).*(?:not_found|unavailable|forbidden)/u.test(providerCode)) {
    return Object.freeze({
      status: "rejected",
      reasonCode: "bot_access_rejected",
      message: "AskEcho rejected the configured bot. Check the bot ID and its access scope.",
      retryable: false,
    });
  }

  const reasonByCode = {
    volc_education_timeout: "verification_timeout",
    volc_education_network_error: "network_unavailable",
    volc_education_fetch_unavailable: "fetch_unavailable",
    volc_education_invalid_response: "provider_response_unverified",
    volc_education_invalid_sse: "provider_response_unverified",
    volc_education_invalid_sse_content_type: "provider_response_unverified",
    volc_education_incomplete_sse: "provider_response_unverified",
    volc_education_provider_error: "provider_unavailable",
  };
  return Object.freeze({
    status: "unverified",
    reasonCode: reasonByCode[error.code] || "verification_failed",
    message: "AskEcho could not be verified. The credential has not been marked invalid.",
    retryable: error.retryable !== false,
  });
}

function extractProviderError(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.error && typeof payload.error === "object") return payload.error;
  const topError = payload.ResponseMetadata?.Error;
  if (!topError || typeof topError !== "object") return null;
  return {
    code: topError.Code || topError.CodeN || "",
    message: topError.Message || "",
    type: "gateway_error",
    log_id: payload.ResponseMetadata?.RequestId || "",
  };
}

function unwrapProviderPayload(payload, fallbackRequestId) {
  assertNoProviderError(payload, "", fallbackRequestId);
  const requestId = safeText(
    payload?.ResponseMetadata?.RequestId || payload?.request_id || fallbackRequestId,
    240,
  );
  if (payload && typeof payload === "object" && Object.hasOwn(payload, "Result")) {
    return { result: payload.Result, requestId };
  }
  if (payload && typeof payload === "object" && Object.hasOwn(payload, "result")) {
    return { result: payload.result, requestId };
  }
  return { result: payload, requestId };
}

function normalizeHomeworkQuestion(mark, index, requestId) {
  if (!mark || typeof mark !== "object" || Array.isArray(mark)) {
    throw invalidProviderResponse(`mark_results[${index}] is invalid.`, requestId);
  }
  const finished = mark.finish === true;
  if (mark.finish !== true && mark.finish !== false) {
    throw invalidProviderResponse(`mark_results[${index}].finish must be boolean.`, requestId);
  }
  const rawAnswers = mark.answer_results;
  if (rawAnswers !== undefined && rawAnswers !== null && !Array.isArray(rawAnswers)) {
    throw invalidProviderResponse(`mark_results[${index}].answer_results must be an array.`, requestId);
  }
  const answers = (rawAnswers || []).map((answer, answerIndex) => {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      throw invalidProviderResponse(`answer_results[${answerIndex}] is invalid.`, requestId);
    }
    if (answer.correct !== true && answer.correct !== false) {
      throw invalidProviderResponse(`answer_results[${answerIndex}].correct must be boolean.`, requestId);
    }
    return Object.freeze({
      answer_id: normalizeProviderNumericId(answer.id, `answer_results[${answerIndex}].id`, requestId),
      polygon: normalizePolygon(answer.answer_points, `answer_results[${answerIndex}].answer_points`, requestId),
      correct: answer.correct,
    });
  });
  return Object.freeze({
    question_id: normalizeProviderId(mark.mark_id, `mark_results[${index}].mark_id`, requestId),
    finished,
    polygon: normalizePolygon(mark.mark_points, `mark_results[${index}].mark_points`, requestId),
    answers: Object.freeze(answers),
    has_handwritten_answer: finished ? answers.length > 0 : null,
    solution_text: typeof mark.solution === "string" ? normalizePlainText(mark.solution, MAX_TEXT_LENGTH) : null,
    solution_format: "plain_text",
  });
}

function normalizePolygon(value, field, requestId) {
  if (!Array.isArray(value) || value.length !== 4) {
    throw invalidProviderResponse(`${field} must contain four points.`, requestId);
  }
  return Object.freeze(value.map((point, index) => {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw invalidProviderResponse(`${field}[${index}] contains invalid coordinates.`, requestId);
    }
    return Object.freeze({ x, y });
  }));
}

function normalizeHomeworkStatus(value, phase, questions) {
  const status = safeText(value, 32).toLowerCase();
  if (["running", "success", "failed"].includes(status)) return status;
  if (status) throw invalidProviderResponse("Homework marking status is invalid.", "");
  if (phase === "submit") return "running";
  return questions.length > 0 && questions.every((question) => question.finished) ? "success" : "running";
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prompt = nonNegativeNumber(value.prompt_tokens);
  const completion = nonNegativeNumber(value.completion_tokens);
  const total = nonNegativeNumber(value.total_tokens);
  if (prompt === null && completion === null && total === null) return null;
  return Object.freeze({
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  });
}

function normalizeChatFrame(payload, apiToken) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalidProviderResponse("SSE frame must be a JSON object.", "");
  }
  if (payload.error) {
    const error = payload.error;
    return Object.freeze({
      schema_version: "volc_education_chat_event@1.0",
      type: "error",
      error: Object.freeze({
        type: safeText(error.type, 160),
        code: redactSecret(error.code, apiToken),
        message: redactSecret(error.message, apiToken),
        param: safeText(error.param, 240) || null,
        log_id: safeText(error.log_id, 240) || null,
      }),
    });
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const delta = choice?.delta && typeof choice.delta === "object" ? choice.delta : {};
  const processingState = normalizeProcessingState(delta.processing_state);
  const finishReason = safeText(choice?.finish_reason, 80);
  const hasDelta = typeof delta.content === "string" || typeof delta.reasoning_content === "string";
  const hasMetadata = [payload.references, payload.search_results, payload.cards, payload.follow_ups]
    .some((item) => Array.isArray(item)) || Boolean(payload.usage);
  const type = processingState
    ? "processing"
    : finishReason === "processing_finish"
      ? "processing_end"
      : hasDelta
        ? "delta"
        : hasMetadata
          ? "metadata"
          : "frame";
  return Object.freeze({
    schema_version: "volc_education_chat_event@1.0",
    type,
    response_id: safeText(payload.id, 240) || null,
    created: Number.isFinite(Number(payload.created)) ? Number(payload.created) : null,
    content_delta: typeof delta.content === "string" ? delta.content : "",
    reasoning_delta: typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
    finish_reason: finishReason || null,
    processing_state: processingState,
    references: normalizeReferences(payload.references),
    search_results: normalizeReferences(payload.search_results),
    cards: Array.isArray(payload.cards) ? payload.cards : null,
    follow_ups: normalizeFollowUps(payload.follow_ups),
    usage: normalizeUsage(payload.usage),
    image_info: normalizeImageInfo(delta.image_info),
    image_infos: Array.isArray(delta.image_infos)
      ? Object.freeze(delta.image_infos.map(normalizeImageInfo).filter(Boolean))
      : null,
    video_infos: Array.isArray(delta.video_infos) ? delta.video_infos : null,
  });
}

function normalizeProcessingState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const action = safeText(value.action, 80);
  const description = safeText(value.description, 1_000);
  if (!action && !description) return null;
  return Object.freeze({ action: action || "unknown", description });
}

function normalizeReferences(value) {
  if (!Array.isArray(value)) return null;
  return Object.freeze(value.slice(0, 30).map((reference) => Object.freeze({
    id: safeText(reference?.id, 240),
    source_type: safeText(reference?.source_type, 120),
    site_name: safeText(reference?.site_name, 240),
    title: safeText(reference?.title, 4_000),
    publish_time: Number.isFinite(Number(reference?.publish_time)) ? Number(reference.publish_time) : 0,
    url: safeHttpsUrl(reference?.url) || null,
    logo_url: safeHttpsUrl(reference?.logo_url) || null,
    cover_image: normalizeImageInfo(reference?.cover_image),
  })));
}

function normalizeImageInfo(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const imageUrl = safeHttpsUrl(value.image_url || value.url);
  if (!imageUrl) return null;
  return Object.freeze({
    image_url: imageUrl,
    source_url: safeHttpsUrl(value.source_url) || null,
    width: nonNegativeNumber(value.width),
    height: nonNegativeNumber(value.height),
  });
}

function normalizeFollowUps(value) {
  if (!Array.isArray(value)) return null;
  return Object.freeze(value.map((item) => safeText(item?.item, 2_000)).filter(Boolean));
}

async function* parseSseData(body, maxBytes) {
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  let totalBytes = 0;

  const flushEvent = () => {
    if (!dataLines.length) return null;
    const data = dataLines.join("\n");
    dataLines = [];
    return data;
  };

  for await (const chunk of iterateResponseBody(body)) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > maxBytes) {
      throw new VolcengineEducationBotError(
        "volc_education_response_too_large",
        "Volcengine education bot event stream exceeded the response limit.",
        { status: 502 },
      );
    }
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line === "") {
        const event = flushEvent();
        if (event !== null) yield event;
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /u, ""));
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).replace(/^ /u, ""));
  const finalEvent = flushEvent();
  if (finalEvent !== null) yield finalEvent;
}

async function* iterateResponseBody(body) {
  if (typeof body?.[Symbol.asyncIterator] === "function") {
    yield* body;
    return;
  }
  if (typeof body?.getReader !== "function") throw new Error("Response body is not readable.");
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock?.();
  }
}

async function readBoundedText(response, maxBytes) {
  const length = Number(response?.headers?.get?.("content-length") || 0);
  if (length > maxBytes) {
    throw new VolcengineEducationBotError(
      "volc_education_response_too_large",
      "Volcengine education bot response exceeded the response limit.",
      { status: 502 },
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new VolcengineEducationBotError(
      "volc_education_response_too_large",
      "Volcengine education bot response exceeded the response limit.",
      { status: 502 },
    );
  }
  return text;
}

function responseRequestId(response) {
  return safeText(
    response?.headers?.get?.("x-request-id") || response?.headers?.get?.("x-tt-logid"),
    240,
  );
}

function mapNetworkError(cause, abortSignal, apiToken) {
  if (abortSignal?.aborted) {
    return new VolcengineEducationBotError(
      "volc_education_timeout",
      "Volcengine education bot request timed out or was aborted.",
      { status: 504, retryable: true, cause: sanitizedCause(cause, apiToken) },
    );
  }
  return new VolcengineEducationBotError(
    "volc_education_network_error",
    redactSecret(cause?.message, apiToken) || "Volcengine education bot request failed.",
    { status: 502, retryable: true, cause: sanitizedCause(cause, apiToken) },
  );
}

function sanitizedCause(cause, apiToken) {
  const message = redactSecret(cause?.message, apiToken);
  return message ? new Error(message) : undefined;
}

function safeHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function redactSecret(value, apiToken) {
  let text = safeText(value, 2_000);
  if (apiToken && text.includes(apiToken)) text = text.split(apiToken).join("[REDACTED]");
  return text;
}

function providerErrorStatus(type) {
  if (type === "authentication_error") return 401;
  if (type === "permission_error") return 403;
  if (type === "validation_error") return 400;
  if (type === "bot_unavailable_error") return 503;
  return 502;
}

function isRetryableProviderError(type) {
  return ["server_error", "bot_unavailable_error", "gateway_error"].includes(type);
}

function normalizeBrowsingMode(value) {
  if (value === undefined || value === null || value === "") return 2;
  const mode = Number(value);
  if (![1, 2, 3].includes(mode)) throw invalidRequest("browsingMode must be 1, 2, or 3.");
  return mode;
}

function normalizeCardPosition(value) {
  const position = safeText(value, 32) || "meta_frame";
  if (!["first_frame", "meta_frame"].includes(position)) {
    throw invalidRequest("cardPosition must be first_frame or meta_frame.");
  }
  return position;
}

function normalizeServiceName(value) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(value)) {
    throw invalidConfiguration("VOLC_EDUCATION_BOT_SERVICE_NAME is invalid.");
  }
  return value;
}

function normalizeOptionalId(value) {
  if (!value) return "";
  if (!SAFE_ID.test(value)) throw invalidConfiguration("VOLC_EDUCATION_BOT_ID is invalid.");
  return value;
}

function normalizeId(value, field) {
  const id = safeText(value, 256);
  if (!SAFE_ID.test(id)) throw invalidRequest(`${field} is invalid.`);
  return id;
}

function normalizeProviderId(value, field, requestId) {
  const id = safeText(value, 256);
  if (!SAFE_ID.test(id)) throw invalidProviderResponse(`${field} is invalid.`, requestId);
  return id;
}

function normalizeProviderNumericId(value, field, requestId) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0) throw invalidProviderResponse(`${field} is invalid.`, requestId);
  return id;
}

function normalizeTimeout(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(50, Math.min(15 * 60_000, Math.round(number)));
}

function normalizeProbeCacheTtl(value, fallback = DEFAULT_CONFIG_PROBE_CACHE_TTL_MS) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw invalidConfiguration("VOLC_EDUCATION_BOT_CONFIG_PROBE_CACHE_TTL_MS must be a number.");
  }
  return Math.max(1_000, Math.min(60 * 60_000, Math.round(number)));
}

function normalizePollInterval(value, fallback = DEFAULT_POLL_INTERVAL_MS) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw invalidRequest("intervalMs must be a number.");
  return Math.max(2_100, Math.min(60_000, Math.round(number)));
}

function normalizePollTimeout(value, fallback = DEFAULT_POLL_TIMEOUT_MS) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 2_100) throw invalidRequest("pollTimeoutMs must be at least 2100.");
  return Math.min(24 * 60 * 60_000, Math.round(number));
}

function normalizeMaxAttempts(value) {
  if (value === undefined || value === null || value === "") return 120;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 10_000) {
    throw invalidRequest("maxAttempts must be an integer from 1 to 10000.");
  }
  return number;
}

function replaceWhenArray(target, key, value) {
  if (Array.isArray(value)) target[key] = value;
}

function optionalText(target, key, value, maxLength) {
  if (value === undefined || value === null || value === "") return;
  target[key] = requiredText(value, key, maxLength);
}

function requiredText(value, field, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) {
    throw invalidRequest(`${field} is required and must be at most ${maxLength} characters.`);
  }
  return text;
}

function normalizePlainText(value, maxLength) {
  return value.replace(/\u0000/gu, "").slice(0, maxLength);
}

function nonNegativeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function readEnv(env, key) {
  return typeof env[key] === "string" ? env[key].trim() : "";
}

function safeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function invalidConfiguration(message) {
  return new VolcengineEducationBotError(
    "volc_education_invalid_configuration",
    message,
    { status: 500 },
  );
}

function invalidRequest(message) {
  return new VolcengineEducationBotError(
    "volc_education_invalid_request",
    message,
    { status: 400 },
  );
}

function invalidProviderResponse(message, requestId) {
  return new VolcengineEducationBotError(
    "volc_education_invalid_response",
    message,
    { status: 502, retryable: true, requestId },
  );
}

function abortedError() {
  return new VolcengineEducationBotError(
    "volc_education_aborted",
    "Homework marking polling was aborted.",
    { status: 499, retryable: false },
  );
}

async function sleepWithSignal(ms, signal, sleepImpl) {
  if (signal?.aborted) throw abortedError();
  if (sleepImpl !== defaultSleep) {
    await sleepImpl(ms, signal);
    if (signal?.aborted) throw abortedError();
    return;
  }
  await new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener?.("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
      reject(abortedError());
    };
    signal?.addEventListener?.("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
