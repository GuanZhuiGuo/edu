const REQUIRED_ENV_KEYS = Object.freeze([
  "ARK_API_KEY",
  "ARK_BASE_URL",
  "ARK_MODEL",
]);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;
const MAX_STREAM_TEXT_LENGTH = 16 * 1024 * 1024;
const MAX_SSE_BUFFER_LENGTH = 2 * 1024 * 1024;
const TRACE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,96}$/;
const PROVIDER_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;

export class ArkClientError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ArkClientError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable === true;
    this.providerCode = safeProviderIdentifier(options.providerCode);
    this.providerType = safeProviderIdentifier(options.providerType);
    this.providerParam = safeProviderIdentifier(options.providerParam);
    this.requestId = safeProviderIdentifier(options.requestId);
    this.schemaUnsupported = options.schemaUnsupported === true;
  }
}

function readEnvironment(env) {
  const source = env && typeof env === "object" ? env : {};
  return {
    apiKey: typeof source.ARK_API_KEY === "string"
      ? source.ARK_API_KEY.trim()
      : "",
    baseUrl: typeof source.ARK_BASE_URL === "string"
      ? source.ARK_BASE_URL.trim()
      : "",
    model: typeof source.ARK_MODEL === "string"
      ? source.ARK_MODEL.trim()
      : "",
    requestTimeoutMs: typeof source.ARK_REQUEST_TIMEOUT_MS === "string"
      ? Number(source.ARK_REQUEST_TIMEOUT_MS.trim())
      : Number(source.ARK_REQUEST_TIMEOUT_MS),
  };
}

function missingEnvironmentKeys(config) {
  return REQUIRED_ENV_KEYS.filter((key) => {
    if (key === "ARK_API_KEY") return !config.apiKey;
    if (key === "ARK_BASE_URL") return !config.baseUrl;
    return !config.model;
  });
}

function buildCompletionUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ArkClientError(
      "ark_invalid_configuration",
      "ARK_BASE_URL must be a valid HTTP(S) URL.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ArkClientError(
      "ark_invalid_configuration",
      "ARK_BASE_URL must use HTTP or HTTPS.",
    );
  }

  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  if (!parsed.pathname.endsWith("/chat/completions")) {
    parsed.pathname += "/chat/completions";
  }
  return parsed.toString();
}

function normalizePositiveInteger(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function normalizeMaxRetries(value) {
  if (value === undefined) return DEFAULT_MAX_RETRIES;
  return Number(value) >= 1 ? 1 : 0;
}

function normalizeMessages({ messages, system, prompt }) {
  if (Array.isArray(messages) && messages.length > 0) {
    return messages.map((message) => {
      if (
        !message
        || typeof message !== "object"
        || typeof message.role !== "string"
        || typeof message.content !== "string"
      ) {
        throw new ArkClientError(
          "ark_invalid_request",
          "Each message must have string role and content fields.",
        );
      }
      return {
        role: message.role,
        content: message.content,
      };
    });
  }

  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new ArkClientError(
      "ark_invalid_request",
      "A non-empty prompt or messages array is required.",
    );
  }

  const normalized = [];
  if (typeof system === "string" && system.trim()) {
    normalized.push({ role: "system", content: system.trim() });
  }
  normalized.push({ role: "user", content: prompt.trim() });
  return normalized;
}

function normalizeSchemaName(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const safeName = candidate
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return safeName || "generated_payload";
}

function buildResponseFormat({
  responseFormat,
  schema: directSchema,
  jsonSchema,
  schemaName,
  strict,
}) {
  const schema = directSchema ?? jsonSchema;
  if (schema && typeof schema === "object") {
    return {
      type: "json_schema",
      json_schema: {
        name: normalizeSchemaName(schemaName),
        strict: strict !== false,
        schema,
      },
    };
  }

  if (
    responseFormat === "json_object"
    || responseFormat === undefined
    || responseFormat === null
  ) {
    return { type: "json_object" };
  }
  if (responseFormat === "text") {
    return null;
  }

  if (
    responseFormat
    && typeof responseFormat === "object"
    && (responseFormat.type === "json_object"
      || responseFormat.type === "json_schema")
  ) {
    return responseFormat;
  }

  throw new ArkClientError(
    "ark_invalid_request",
    "responseFormat must be text, json_object or a supported response-format object.",
  );
}

function buildSchemaFallbackBody(body) {
  const schemaConfig = body.response_format?.json_schema;
  const serializedSchema = JSON.stringify(schemaConfig?.schema ?? {});
  const schemaName = schemaConfig?.name || "generated_payload";
  const schemaInstruction = [
    "Return exactly one valid JSON object and no Markdown or surrounding text.",
    `The object must conform to the JSON Schema named "${schemaName}":`,
    serializedSchema,
  ].join("\n");

  return {
    ...body,
    messages: [
      { role: "system", content: schemaInstruction },
      ...body.messages,
    ],
    response_format: { type: "json_object" },
  };
}

function extractMessageText(message) {
  if (!message || typeof message !== "object") return "";
  if (typeof message.content === "string") return message.content;
  if (message.content && typeof message.content === "object" && !Array.isArray(message.content)) {
    return JSON.stringify(message.content);
  }
  if (!Array.isArray(message.content)) return "";

  return message.content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .join("");
}

function stripJsonFence(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseGeneratedJson(message) {
  if (
    message
    && typeof message === "object"
    && message.parsed !== undefined
  ) {
    return message.parsed;
  }

  if (
    message
    && message.content
    && typeof message.content === "object"
    && !Array.isArray(message.content)
  ) {
    return message.content;
  }

  const text = extractMessageText(message);
  if (!text.trim()) {
    throw new ArkClientError(
      "ark_invalid_json",
      "Ark returned an empty structured response.",
      { retryable: true },
    );
  }

  try {
    return JSON.parse(stripJsonFence(text));
  } catch {
    throw new ArkClientError(
      "ark_invalid_json",
      "Ark returned invalid JSON.",
      { retryable: true },
    );
  }
}

async function readResponsePayload(response) {
  if (response && typeof response.text === "function") {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new ArkClientError(
        "ark_invalid_response",
        "Ark returned a non-JSON HTTP response.",
        { retryable: true },
      );
    }
  }

  if (response && typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      throw new ArkClientError(
        "ark_invalid_response",
        "Ark returned an unreadable JSON response.",
        { retryable: true },
      );
    }
  }

  throw new ArkClientError(
    "ark_invalid_response",
    "Ark returned an invalid HTTP response.",
    { retryable: true },
  );
}

function isEventStreamResponse(response) {
  const contentType = typeof response?.headers?.get === "function"
    ? String(response.headers.get("content-type") || "").toLowerCase()
    : "";
  if (contentType) return contentType.includes("text/event-stream");
  return Boolean(
    response?.body
    && (
      typeof response.body.getReader === "function"
      || typeof response.body[Symbol.asyncIterator] === "function"
    )
  );
}

function extractStreamDeltaContent(delta) {
  if (!delta || typeof delta !== "object") return "";
  if (typeof delta.content === "string") return delta.content;
  if (!Array.isArray(delta.content)) return "";
  return delta.content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .join("");
}

function invalidStreamError(code, message, options = {}) {
  return new ArkClientError(code, message, {
    retryable: options.retryable !== false,
    providerCode: options.providerCode,
    providerType: options.providerType,
    providerParam: options.providerParam,
    requestId: options.requestId,
  });
}

function safeProviderIdentifier(value) {
  return typeof value === "string"
    && PROVIDER_IDENTIFIER_PATTERN.test(value.trim())
    ? value.trim()
    : undefined;
}

function readProviderRequestId(response) {
  if (typeof response?.headers?.get !== "function") return undefined;
  for (const header of [
    "x-request-id",
    "x-tt-logid",
    "request-id",
  ]) {
    const value = safeProviderIdentifier(response.headers.get(header));
    if (value) return value;
  }
  return undefined;
}

function providerFailureFromPayload(payload, response) {
  const raw =
    payload?.error && typeof payload.error === "object"
      ? payload.error
      : {};
  const providerCode = safeProviderIdentifier(raw.code);
  const providerType = safeProviderIdentifier(raw.type);
  const providerParam = safeProviderIdentifier(raw.param);
  const requestId =
    readProviderRequestId(response)
    || safeProviderIdentifier(payload?.request_id)
    || safeProviderIdentifier(raw.request_id);
  const diagnostic = [
    raw.code,
    raw.type,
    raw.param,
    raw.message,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const knownUnsupportedFormat = new Set([
    "unsupported_format",
    "unsupported_response_format",
    "json_schema_unsupported",
    "response_format_unsupported",
  ]);
  const schemaUnsupported =
    knownUnsupportedFormat.has(String(providerCode || providerType || ""))
    || (
      /(?:response[_\s-]?format|json[_\s-]?schema)/u.test(diagnostic)
      && /(?:unsupported|not\s+support|unknown|invalid|unavailable)/u.test(
        diagnostic,
      )
    );
  return {
    providerCode,
    providerType,
    providerParam,
    requestId,
    schemaUnsupported,
  };
}

async function readProviderFailure(response) {
  let payload = null;
  try {
    const text = await response?.text?.();
    if (typeof text === "string" && text.length <= 1_048_576) {
      payload = JSON.parse(text);
    }
  } catch {
    // Provider diagnostics are optional and never replace the stable error.
  }
  return providerFailureFromPayload(payload, response);
}

function completionFinishError(finishReason) {
  if (
    finishReason === null
    || finishReason === undefined
    || finishReason === ""
    || finishReason === "stop"
  ) {
    return null;
  }
  if (finishReason === "length") {
    return new ArkClientError(
      "ark_output_truncated",
      "Ark stopped because the output token limit was reached.",
      { retryable: true },
    );
  }
  if (finishReason === "content_filter") {
    return new ArkClientError(
      "ark_content_filtered",
      "Ark stopped because the response was filtered.",
    );
  }
  return new ArkClientError(
    "ark_incomplete_response",
    "Ark stopped with an unsupported finish reason.",
  );
}

async function readReaderChunk(reader, signal) {
  if (!signal) return reader.read();
  if (signal.aborted) throw new Error("aborted");

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      try {
        const pending = reader.cancel();
        pending?.catch?.(() => {});
      } catch {
        // Cancelling is best-effort; the request abort remains authoritative.
      }
      finish(reject, new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(reader.read()).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

async function readSseCompletion(response, { signal, onDelta } = {}) {
  if (!response?.body) {
    throw invalidStreamError(
      "ark_invalid_stream",
      "Ark returned a streaming response without a readable body.",
    );
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let doneSeen = false;
  let sequence = 0;
  let responseId = null;
  let responseModel = null;
  let finishReason = null;
  let usage = null;

  const appendDelta = (delta) => {
    if (!delta) return;
    if (fullText.length + delta.length > MAX_STREAM_TEXT_LENGTH) {
      throw invalidStreamError(
        "ark_stream_too_large",
        "Ark streaming response exceeded the allowed size.",
        { retryable: false },
      );
    }
    fullText += delta;
    sequence += 1;
    onDelta?.(delta, sequence);
  };

  const consumeEvent = (eventBlock) => {
    const data = eventBlock
      .split(/\r\n|\r|\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /u, ""))
      .join("\n");
    if (!data) return;
    if (doneSeen) {
      throw invalidStreamError(
        "ark_invalid_stream",
        "Ark emitted data after the streaming completion marker.",
      );
    }
    if (data.trim() === "[DONE]") {
      doneSeen = true;
      return;
    }

    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      throw invalidStreamError(
        "ark_invalid_stream",
        "Ark emitted malformed streaming data.",
      );
    }
    if (!chunk || typeof chunk !== "object") {
      throw invalidStreamError(
        "ark_stream_error",
        "Ark reported a streaming generation error.",
        { retryable: false },
      );
    }
    if (chunk.error) {
      const provider = providerFailureFromPayload(chunk, response);
      throw invalidStreamError(
        "ark_stream_error",
        "Ark reported a streaming generation error.",
        {
          retryable: false,
          ...provider,
        },
      );
    }

    if (typeof chunk.id === "string" && chunk.id) responseId = chunk.id;
    if (typeof chunk.model === "string" && chunk.model) {
      responseModel = chunk.model;
    }
    if (chunk.usage && typeof chunk.usage === "object") {
      usage = chunk.usage;
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const choice =
      choices.find((candidate) => candidate?.index === 0)
      || choices[0];
    if (!choice || typeof choice !== "object") return;
    if (typeof choice.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }
    appendDelta(extractStreamDeltaContent(choice.delta));
  };

  const consumeBuffer = (final = false) => {
    const separator = /(?:\r\n|\r|\n)(?:\r\n|\r|\n)/u;
    let match = separator.exec(buffer);
    while (match) {
      const eventBlock = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      consumeEvent(eventBlock);
      if (doneSeen) return;
      match = separator.exec(buffer);
    }
    if (buffer.length > MAX_SSE_BUFFER_LENGTH) {
      throw invalidStreamError(
        "ark_stream_too_large",
        "Ark streaming event exceeded the allowed size.",
        { retryable: false },
      );
    }
    if (final && buffer.trim()) {
      const trailing = buffer;
      buffer = "";
      consumeEvent(trailing);
    }
  };

  if (typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    try {
      while (!doneSeen) {
        const { done, value } = await readReaderChunk(reader, signal);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        consumeBuffer();
      }
      if (!doneSeen) {
        buffer += decoder.decode();
        consumeBuffer(true);
      }
    } finally {
      if (doneSeen) {
        try {
          await reader.cancel();
        } catch {
          // The server may already have closed the stream.
        }
      }
      reader.releaseLock?.();
    }
  } else if (typeof response.body[Symbol.asyncIterator] === "function") {
    for await (const value of response.body) {
      if (signal?.aborted) throw new Error("aborted");
      buffer += decoder.decode(value, { stream: true });
      consumeBuffer();
      if (doneSeen) break;
    }
    if (!doneSeen) {
      buffer += decoder.decode();
      consumeBuffer(true);
    }
  } else {
    throw invalidStreamError(
      "ark_invalid_stream",
      "Ark returned an unreadable streaming response.",
    );
  }

  if (!doneSeen) {
    throw invalidStreamError(
      "ark_stream_incomplete",
      "Ark streaming response ended before completion.",
    );
  }

  const message = {
    role: "assistant",
    content: fullText,
  };
  const choice = {
    index: 0,
    finish_reason: finishReason,
    message,
  };
  return {
    payload: {
      id: responseId,
      model: responseModel,
      choices: [choice],
      usage,
    },
    choice,
    text: fullText,
  };
}

function safeTraceIdentifier(value, fallback, secret) {
  let candidate = "";
  try {
    candidate = typeof value === "string" ? value.trim() : "";
  } catch {
    return fallback;
  }
  if (
    !TRACE_IDENTIFIER_PATTERN.test(candidate)
    || (secret && candidate.includes(secret))
  ) {
    return fallback;
  }
  return candidate;
}

function safeTraceUsage(value) {
  if (!value || typeof value !== "object") return null;
  const usage = {};
  for (const key of [
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "cached_tokens",
  ]) {
    if (Number.isFinite(value[key]) && value[key] >= 0) {
      usage[key] = Math.floor(value[key]);
    }
  }
  return Object.keys(usage).length ? usage : null;
}

function createTraceEmitter(onTrace, traceContext, secret, fallbackCallId) {
  const callback = typeof onTrace === "function" ? onTrace : null;
  let stageValue;
  let callIdValue;
  try {
    stageValue = traceContext?.stage;
    callIdValue = traceContext?.callId;
  } catch {
    stageValue = undefined;
    callIdValue = undefined;
  }
  const stage = safeTraceIdentifier(stageValue, "model", secret);
  const callId = safeTraceIdentifier(callIdValue, fallbackCallId, secret);
  const redactor = createStreamingSecretRedactor(secret);
  let lastDeltaMeta = null;

  const notify = (type, status, { delta, meta } = {}) => {
    if (!callback) return;
    const event = {
      type,
      stage,
      call_id: callId,
      status,
      ...(typeof delta === "string" ? { delta } : {}),
      ...(meta && typeof meta === "object"
        ? { meta: Object.freeze({ ...meta }) }
        : {}),
    };
    try {
      const pending = callback(Object.freeze(event));
      pending?.catch?.(() => {});
    } catch {
      // Trace observers are diagnostic only and cannot affect generation.
    }
  };

  return (type, status, { delta, meta } = {}) => {
    if (!callback) return;
    if (type === "model.delta" && typeof delta === "string") {
      lastDeltaMeta = meta;
      const safeDelta = redactor.push(delta);
      if (safeDelta) {
        notify(type, status, { delta: safeDelta, meta });
      }
      return;
    }
    const trailing = redactor.flush();
    if (trailing) {
      notify("model.delta", "streaming", {
        delta: trailing,
        meta: lastDeltaMeta,
      });
    }
    notify(type, status, { meta });
  };
}

function createStreamingSecretRedactor(secret) {
  const protectedValue =
    typeof secret === "string" && secret ? secret : "";
  let buffer = "";

  return {
    push(value) {
      if (!protectedValue) return String(value ?? "");
      buffer += String(value ?? "");
      let output = "";
      let secretIndex = buffer.indexOf(protectedValue);
      while (secretIndex >= 0) {
        output += `${buffer.slice(0, secretIndex)}[redacted]`;
        buffer = buffer.slice(secretIndex + protectedValue.length);
        secretIndex = buffer.indexOf(protectedValue);
      }
      const safeLength = Math.max(
        0,
        buffer.length - (protectedValue.length - 1),
      );
      output += buffer.slice(0, safeLength);
      buffer = buffer.slice(safeLength);
      return output;
    },
    flush() {
      const output = protectedValue
        ? buffer.replaceAll(protectedValue, "[redacted]")
        : buffer;
      buffer = "";
      return output;
    },
  };
}

function responseFormatName(body) {
  return body.response_format?.type || "text";
}

function isRetryableStatus(status) {
  return status === 408
    || status === 409
    || status === 425
    || status === 429
    || status >= 500;
}

function providerTraceMeta(error) {
  return {
    ...(error?.providerCode
      ? { provider_code: error.providerCode }
      : {}),
    ...(error?.providerType
      ? { provider_type: error.providerType }
      : {}),
    ...(error?.providerParam
      ? { provider_param: error.providerParam }
      : {}),
    ...(error?.requestId
      ? { request_id: error.requestId }
      : {}),
  };
}

async function waitForRetryDelay(milliseconds, signal, sleepImpl) {
  if (milliseconds <= 0) return;
  if (signal?.aborted) {
    throw new ArkClientError(
      "ark_aborted",
      "Ark request was aborted.",
    );
  }
  if (!signal) {
    await sleepImpl(milliseconds);
    return;
  }

  let onAbort;
  try {
    await Promise.race([
      Promise.resolve().then(() => sleepImpl(milliseconds)),
      new Promise((_, reject) => {
        onAbort = () => {
          reject(new ArkClientError(
            "ark_aborted",
            "Ark request was aborted.",
          ));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function createAbortContext(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;

  const forwardAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      throw new ArkClientError(
        "ark_aborted",
        "Ark request was aborted.",
      );
    }
    externalSignal.addEventListener("abort", forwardAbort, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup() {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", forwardAbort);
      }
    },
  };
}

function normalizeFetchError(error, abortContext, externalSignal) {
  if (abortContext.didTimeOut()) {
    return new ArkClientError(
      "ark_timeout",
      "Ark request timed out.",
      { retryable: true },
    );
  }
  if (externalSignal?.aborted) {
    return new ArkClientError(
      "ark_aborted",
      "Ark request was aborted.",
    );
  }
  if (error instanceof ArkClientError) return error;
  return new ArkClientError(
    "ark_network_error",
    "Ark request failed because of a network error.",
    { retryable: true },
  );
}

function getDefaultEnvironment() {
  return typeof process !== "undefined" && process.env
    ? process.env
    : {};
}

/**
 * Creates an OpenAI-compatible Ark client.
 *
 * Credentials and endpoint configuration are intentionally accepted only from
 * the supplied environment object (process.env by default). The returned
 * object never exposes the API key.
 */
export function createArkClient(options = {}) {
  const config = readEnvironment(options.env ?? getDefaultEnvironment());
  const missing = missingEnvironmentKeys(config);
  const timeoutMs = normalizePositiveInteger(
    options.timeoutMs ?? config.requestTimeoutMs,
    DEFAULT_TIMEOUT_MS,
  );
  const maxRetries = normalizeMaxRetries(options.maxRetries);
  const retryDelayMs = Number.isFinite(options.retryDelayMs)
    ? Math.max(0, Math.floor(options.retryDelayMs))
    : 0;
  const fetchImpl = options.fetchImpl ?? options.fetch ?? globalThis.fetch;
  const sleepImpl = typeof options.sleepImpl === "function"
    ? options.sleepImpl
    : (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  let traceCallSequence = 0;

  function configSummary() {
    return {
      configured: missing.length === 0,
      baseUrl: config.baseUrl || null,
      model: config.model || null,
      missing: [...missing],
      timeoutMs,
      maxRetries,
    };
  }

  function assertConfigured() {
    if (missing.length > 0) {
      throw new ArkClientError(
        "ark_not_configured",
        `Ark is not configured. Missing: ${missing.join(", ")}.`,
      );
    }
    if (typeof fetchImpl !== "function") {
      throw new ArkClientError(
        "ark_fetch_unavailable",
        "No fetch implementation is available for Ark requests.",
      );
    }
  }

  async function performAttempt(body, externalSignal, onDelta) {
    const abortContext = createAbortContext(externalSignal, timeoutMs);

    try {
      const response = await fetchImpl(buildCompletionUrl(config.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          ...(body.stream === true
            ? { accept: "text/event-stream" }
            : {}),
        },
        body: JSON.stringify(body),
        signal: abortContext.signal,
      });

      const status = Number(response?.status) || 0;
      const responseOk = typeof response?.ok === "boolean"
        ? response.ok
        : status >= 200 && status < 300;
      if (!responseOk) {
        const provider = await readProviderFailure(response);
        throw new ArkClientError(
          "ark_http_error",
          status
            ? `Ark request failed with HTTP ${status}.`
            : "Ark request failed with an invalid HTTP status.",
          {
            status: status || undefined,
            retryable: isRetryableStatus(status),
            ...provider,
          },
        );
      }

      if (body.stream === true && isEventStreamResponse(response)) {
        return await readSseCompletion(response, {
          signal: abortContext.signal,
          onDelta,
        });
      }

      const payload = await readResponsePayload(response);
      const choice = payload?.choices?.[0];
      if (!choice?.message) {
        throw new ArkClientError(
          "ark_invalid_response",
          "Ark response did not contain an assistant message.",
          { retryable: true },
        );
      }

      return {
        payload,
        choice,
        text: extractMessageText(choice.message),
      };
    } catch (error) {
      throw normalizeFetchError(error, abortContext, externalSignal);
    } finally {
      abortContext.cleanup();
    }
  }

  async function complete(input = {}) {
    assertConfigured();
    const messages = normalizeMessages(input);
    const responseFormat = buildResponseFormat(input);
    const body = {
      model: config.model,
      messages,
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(input.stream === true
        ? {
            stream: true,
            stream_options: { include_usage: true },
          }
        : {}),
    };

    if (Number.isFinite(input.temperature)) {
      body.temperature = input.temperature;
    }
    if (Number.isFinite(input.maxTokens) && input.maxTokens > 0) {
      body.max_tokens = Math.floor(input.maxTokens);
    }

    let transientRetries = 0;
    let schemaFallbackUsed = false;
    let activeBody = body;
    let attempt = 1;
    const trace = createTraceEmitter(
      input.onTrace,
      input.traceContext,
      config.apiKey,
      `ark-${++traceCallSequence}`,
    );

    while (true) {
      trace("model.request", "started", {
        meta: {
          attempt,
          stream: activeBody.stream === true,
          response_format: responseFormatName(activeBody),
        },
      });
      try {
        const result = await performAttempt(
          activeBody,
          input.signal,
          (delta, sequence) => {
            trace("model.delta", "streaming", {
              delta,
              meta: { attempt, sequence },
            });
          },
        );
        const finishError = completionFinishError(
          result.choice?.finish_reason,
        );
        if (finishError) throw finishError;
        const parsedJson =
          input.responseFormat === "text"
            ? null
            : parseGeneratedJson(result.choice.message);
        const completion = {
          text: result.text,
          json: parsedJson,
          id: result.payload?.id ?? null,
          model: result.payload?.model ?? config.model,
          finishReason: result.choice?.finish_reason ?? null,
          usage: result.payload?.usage ?? null,
        };
        trace("model.response", "completed", {
          meta: {
            attempt,
            stream: activeBody.stream === true,
            response_format: responseFormatName(activeBody),
            finish_reason:
              typeof completion.finishReason === "string"
                ? completion.finishReason.slice(0, 80)
                : null,
            usage: safeTraceUsage(completion.usage),
          },
        });
        return completion;
      } catch (error) {
        const normalized = error instanceof ArkClientError
          ? error
          : new ArkClientError(
            "ark_request_failed",
            "Ark request failed.",
          );
        if (
          !schemaFallbackUsed
          && activeBody.response_format?.type === "json_schema"
          && normalized.code === "ark_http_error"
          && (normalized.status === 400 || normalized.status === 422)
          && normalized.schemaUnsupported === true
        ) {
          schemaFallbackUsed = true;
          trace("model.schema_fallback", "fallback", {
            meta: {
              attempt,
              from: "json_schema",
              to: "json_object",
              http_status: normalized.status,
              discarded: true,
              ...providerTraceMeta(normalized),
            },
          });
          activeBody = buildSchemaFallbackBody(activeBody);
          attempt += 1;
          continue;
        }

        if (
          transientRetries >= maxRetries
          || !normalized.retryable
          || input.signal?.aborted
        ) {
          trace("model.error", "failed", {
            meta: {
              attempt,
              code: normalized.code,
              retryable: normalized.retryable === true,
              ...(Number.isFinite(normalized.status)
                ? { http_status: normalized.status }
                : {}),
              ...providerTraceMeta(normalized),
            },
          });
          throw normalized;
        }
        transientRetries += 1;
        trace("model.retry", "retrying", {
          meta: {
            attempt,
            next_attempt: attempt + 1,
            code: normalized.code,
            discarded: true,
            ...(Number.isFinite(normalized.status)
              ? { http_status: normalized.status }
              : {}),
            ...providerTraceMeta(normalized),
          },
        });
        if (retryDelayMs > 0) {
          try {
            await waitForRetryDelay(
              retryDelayMs,
              input.signal,
              sleepImpl,
            );
          } catch (delayError) {
            const aborted = delayError instanceof ArkClientError
              ? delayError
              : new ArkClientError(
                "ark_aborted",
                "Ark request was aborted.",
              );
            trace("model.error", "failed", {
              meta: {
                attempt,
                code: aborted.code,
                retryable: false,
              },
            });
            throw aborted;
          }
        }
        attempt += 1;
      }
    }
  }

  async function generateJson(input = {}) {
    const schema = input.schema ?? input.jsonSchema;
    const result = await complete({
      ...input,
      schema,
      responseFormat: schema ? undefined : "json_object",
    });
    return result.json;
  }

  return Object.freeze({
    complete,
    generateJson,
    configSummary,
  });
}

/**
 * Keeps a stable client identity while allowing the server to replace the
 * underlying Ark client after an in-memory credential update. The active
 * client and its credentials are never exposed by the proxy.
 */
export function createArkClientSlot(initialClient) {
  assertArkClientShape(initialClient);
  let activeClient = initialClient;

  const client = Object.freeze({
    complete(...args) {
      return activeClient.complete(...args);
    },
    generateJson(...args) {
      return activeClient.generateJson(...args);
    },
    configSummary(...args) {
      return activeClient.configSummary(...args);
    },
  });

  return Object.freeze({
    client,
    replace(nextClient) {
      assertArkClientShape(nextClient);
      activeClient = nextClient;
    },
  });
}

function assertArkClientShape(client) {
  if (
    !client
    || typeof client !== "object"
    || typeof client.complete !== "function"
    || typeof client.generateJson !== "function"
    || typeof client.configSummary !== "function"
  ) {
    throw new TypeError(
      "Ark client must provide complete, generateJson and configSummary.",
    );
  }
}

export const createArkLlmClient = createArkClient;

export default createArkClient;
