const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_VISION_MODEL = "doubao-seed-2-1-turbo-260628";
const DEFAULT_TEXT_MODEL = "deepseek-v4-flash-260425";
const DEFAULT_EMBEDDING_MODEL = "doubao-embedding-vision-250615";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRIES = 3;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_LENGTH = 2 * 1024 * 1024;
const MAX_DATA_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_URL_LENGTH = 16 * 1024;
const MAX_MESSAGES = 128;
const MAX_EMBEDDING_INPUTS = 32;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,191}$/u;

export class ArkEducationModelError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ArkEducationModelError";
    this.code = code;
    this.status = Number.isInteger(options.status) ? options.status : 502;
    this.retryable = options.retryable === true;
    this.requestId = safeIdentifier(options.requestId);
    this.providerCode = safeIdentifier(options.providerCode);
    this.attempts = Number.isInteger(options.attempts)
      ? options.attempts
      : undefined;
  }
}

export function createArkEducationModelClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep,
} = {}) {
  const config = readConfig(env);
  const endpointUrls = buildEndpointUrls(config.baseUrl);

  function configSummary() {
    const missing = config.apiKey ? [] : ["ARK_API_KEY"];
    return {
      configured: missing.length === 0,
      baseUrl: endpointUrls.baseUrl,
      visionModel: config.visionModel,
      textModel: config.textModel,
      embeddingModel: config.embeddingModel,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      missing,
    };
  }

  async function chatCompletion(input = {}) {
    ensureConfigured(config, fetchImpl);
    const messages = normalizeChatMessages(input.messages);
    const body = {
      model: normalizeModel(input.model, config.visionModel),
      messages,
      stream: false,
    };
    addOptionalNumber(body, "temperature", input.temperature, 0, 2);
    addOptionalInteger(body, "max_tokens", input.maxTokens, 1, 131_072);
    if (input.responseFormat !== undefined) {
      body.response_format = normalizeChatResponseFormat(input.responseFormat);
    }

    const result = await requestJson({
      url: endpointUrls.chatCompletions,
      body,
      signal: input.signal,
      timeoutMs: normalizeTimeout(input.timeoutMs, config.timeoutMs),
      maxRetries: normalizeRetries(input.maxRetries, config.maxRetries),
      apiKey: config.apiKey,
      fetchImpl,
      sleepImpl,
    });
    return parseChatCompletion(result.payload, result.requestId);
  }

  async function extractStructured(input = {}) {
    ensureConfigured(config, fetchImpl);
    const schema = normalizeJsonSchema(input.schema);
    const body = {
      model: normalizeModel(input.model, config.textModel),
      input: normalizeResponsesInput(input.input),
      text: {
        format: {
          type: "json_schema",
          name: normalizeSchemaName(input.schemaName),
          strict: input.strict !== false,
          schema,
        },
      },
      stream: false,
    };
    if (typeof input.instructions === "string" && input.instructions.trim()) {
      body.instructions = normalizeText(input.instructions, "instructions");
    }
    addOptionalNumber(body, "temperature", input.temperature, 0, 2);
    addOptionalInteger(body, "max_output_tokens", input.maxOutputTokens, 1, 131_072);

    const result = await requestJson({
      url: endpointUrls.responses,
      body,
      signal: input.signal,
      timeoutMs: normalizeTimeout(input.timeoutMs, config.timeoutMs),
      maxRetries: normalizeRetries(input.maxRetries, config.maxRetries),
      apiKey: config.apiKey,
      fetchImpl,
      sleepImpl,
    });
    return parseStructuredResponse(result.payload, result.requestId);
  }

  async function embedMultimodal(input = {}) {
    ensureConfigured(config, fetchImpl);
    const body = {
      model: normalizeModel(input.model, config.embeddingModel),
      input: normalizeEmbeddingInput(input.input),
    };
    if (input.encodingFormat !== undefined) {
      if (input.encodingFormat !== "float" && input.encodingFormat !== "base64") {
        throw invalidRequest("encodingFormat must be float or base64.");
      }
      body.encoding_format = input.encodingFormat;
    }

    const result = await requestJson({
      url: endpointUrls.multimodalEmbeddings,
      body,
      signal: input.signal,
      timeoutMs: normalizeTimeout(input.timeoutMs, config.timeoutMs),
      maxRetries: normalizeRetries(input.maxRetries, config.maxRetries),
      apiKey: config.apiKey,
      fetchImpl,
      sleepImpl,
    });
    return parseEmbeddingResponse(result.payload, result.requestId);
  }

  return Object.freeze({
    chatCompletion,
    extractStructured,
    embedMultimodal,
    configSummary,
  });
}

function readConfig(env) {
  const source = env && typeof env === "object" ? env : {};
  return {
    apiKey: readEnvString(source, "ARK_API_KEY"),
    baseUrl: readEnvString(source, "ARK_BASE_URL") || DEFAULT_BASE_URL,
    visionModel:
      readEnvString(source, "ARK_VISION_MODEL") || DEFAULT_VISION_MODEL,
    textModel: readEnvString(source, "ARK_TEXT_MODEL") || DEFAULT_TEXT_MODEL,
    embeddingModel:
      readEnvString(source, "ARK_MULTIMODAL_EMBEDDING_MODEL")
      || DEFAULT_EMBEDDING_MODEL,
    timeoutMs: normalizeTimeout(
      source.ARK_MODEL_REQUEST_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    ),
    maxRetries: normalizeRetries(
      source.ARK_MODEL_MAX_RETRIES,
      DEFAULT_MAX_RETRIES,
    ),
  };
}

function readEnvString(env, key) {
  return typeof env[key] === "string" ? env[key].trim() : "";
}

function buildEndpointUrls(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ArkEducationModelError(
      "ark_model_invalid_configuration",
      "ARK_BASE_URL must be a valid HTTP(S) URL.",
      { status: 500 },
    );
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    || parsed.username
    || parsed.password
  ) {
    throw new ArkEducationModelError(
      "ark_model_invalid_configuration",
      "ARK_BASE_URL must be an HTTP(S) URL without embedded credentials.",
      { status: 500 },
    );
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  const normalizedBaseUrl = parsed.toString().replace(/\/$/u, "");
  return Object.freeze({
    baseUrl: normalizedBaseUrl,
    chatCompletions: `${normalizedBaseUrl}/chat/completions`,
    responses: `${normalizedBaseUrl}/responses`,
    multimodalEmbeddings: `${normalizedBaseUrl}/embeddings/multimodal`,
  });
}

function ensureConfigured(config, fetchImpl) {
  if (!config.apiKey) {
    throw new ArkEducationModelError(
      "ark_model_not_configured",
      "The Ark education model service is not configured.",
      { status: 503 },
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new ArkEducationModelError(
      "ark_model_fetch_unavailable",
      "The server cannot send Ark model requests.",
      { status: 503 },
    );
  }
}

function normalizeModel(value, fallback) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const result = candidate || fallback;
  if (!SAFE_IDENTIFIER.test(result)) {
    throw invalidRequest("The model identifier is invalid.");
  }
  return result;
}

function normalizeChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw invalidRequest("messages must be a non-empty array.");
  }
  if (messages.length > MAX_MESSAGES) {
    throw invalidRequest(`messages must contain at most ${MAX_MESSAGES} entries.`);
  }
  return messages.map((message, index) => {
    if (!message || typeof message !== "object") {
      throw invalidRequest(`messages[${index}] must be an object.`);
    }
    const role = normalizeRole(message.role, `messages[${index}].role`);
    if (typeof message.content === "string") {
      return {
        role,
        content: normalizeText(message.content, `messages[${index}].content`),
      };
    }
    if (!Array.isArray(message.content) || message.content.length === 0) {
      throw invalidRequest(
        `messages[${index}].content must be text or a non-empty part array.`,
      );
    }
    return {
      role,
      content: message.content.map((part, partIndex) =>
        normalizeChatPart(part, `messages[${index}].content[${partIndex}]`)
      ),
    };
  });
}

function normalizeRole(value, field) {
  if (!["system", "user", "assistant"].includes(value)) {
    throw invalidRequest(`${field} must be system, user or assistant.`);
  }
  return value;
}

function normalizeChatPart(part, field) {
  if (!part || typeof part !== "object") {
    throw invalidRequest(`${field} must be an object.`);
  }
  if (part.type === "text") {
    return {
      type: "text",
      text: normalizeText(part.text, `${field}.text`),
    };
  }
  if (part.type === "image_url") {
    const source = typeof part.image_url === "string"
      ? { url: part.image_url }
      : part.image_url;
    if (!source || typeof source !== "object") {
      throw invalidRequest(`${field}.image_url must contain a URL.`);
    }
    const imageUrl = {
      url: normalizeImageUrl(source.url, `${field}.image_url.url`),
    };
    if (source.detail !== undefined) {
      if (!["auto", "low", "high"].includes(source.detail)) {
        throw invalidRequest(`${field}.image_url.detail is invalid.`);
      }
      imageUrl.detail = source.detail;
    }
    return { type: "image_url", image_url: imageUrl };
  }
  throw invalidRequest(`${field}.type must be text or image_url.`);
}

function normalizeResponsesInput(input) {
  if (typeof input === "string") {
    return [{
      role: "user",
      content: [{ type: "input_text", text: normalizeText(input, "input") }],
    }];
  }
  if (!Array.isArray(input) || input.length === 0) {
    throw invalidRequest("input must be non-empty text or a Responses input array.");
  }
  if (input.length > MAX_MESSAGES) {
    throw invalidRequest(`input must contain at most ${MAX_MESSAGES} entries.`);
  }
  return input.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw invalidRequest(`input[${index}] must be an object.`);
    }
    const role = normalizeRole(item.role, `input[${index}].role`);
    const rawParts = typeof item.content === "string"
      ? [{ type: "input_text", text: item.content }]
      : item.content;
    if (!Array.isArray(rawParts) || rawParts.length === 0) {
      throw invalidRequest(`input[${index}].content must not be empty.`);
    }
    return {
      role,
      content: rawParts.map((part, partIndex) => {
        if (!part || typeof part !== "object") {
          throw invalidRequest(
            `input[${index}].content[${partIndex}] must be an object.`,
          );
        }
        if (part.type !== "input_text" && part.type !== "text") {
          throw invalidRequest(
            `input[${index}].content[${partIndex}] must be input_text.`,
          );
        }
        return {
          type: "input_text",
          text: normalizeText(
            part.text,
            `input[${index}].content[${partIndex}].text`,
          ),
        };
      }),
    };
  });
}

function normalizeEmbeddingInput(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw invalidRequest("input must be a non-empty multimodal input array.");
  }
  if (input.length > MAX_EMBEDDING_INPUTS) {
    throw invalidRequest(
      `input must contain at most ${MAX_EMBEDDING_INPUTS} parts.`,
    );
  }
  const typeCounts = { text: 0, image_url: 0 };
  return input.map((part, index) => {
    const field = `input[${index}]`;
    if (!part || typeof part !== "object") {
      throw invalidRequest(`${field} must be an object.`);
    }
    if (part.type === "text") {
      typeCounts.text += 1;
      if (typeCounts.text > 1) {
        throw invalidRequest("input may contain at most one text part.");
      }
      return {
        type: "text",
        text: normalizeText(part.text, `${field}.text`),
      };
    }
    if (part.type === "image_url") {
      typeCounts.image_url += 1;
      if (typeCounts.image_url > 1) {
        throw invalidRequest("input may contain at most one image_url part.");
      }
      const source = typeof part.image_url === "string"
        ? { url: part.image_url }
        : part.image_url;
      if (!source || typeof source !== "object") {
        throw invalidRequest(`${field}.image_url must contain a URL.`);
      }
      return {
        type: "image_url",
        image_url: {
          url: normalizeImageUrl(source.url, `${field}.image_url.url`),
        },
      };
    }
    throw invalidRequest(`${field}.type must be text or image_url.`);
  });
}

function normalizeImageUrl(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidRequest(`${field} must be a non-empty URL.`);
  }
  const candidate = value.trim();
  if (candidate.length > MAX_IMAGE_URL_LENGTH && !candidate.startsWith("data:")) {
    throw invalidRequest(`${field} is too long.`);
  }
  if (candidate.startsWith("data:")) {
    const match = candidate.match(
      /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/u,
    );
    if (!match) {
      throw invalidRequest(`${field} must be a supported base64 image data URL.`);
    }
    const approximateBytes = Math.floor(match[1].replace(/[\r\n]/gu, "").length * 3 / 4);
    if (approximateBytes > MAX_DATA_IMAGE_BYTES) {
      throw invalidRequest(`${field} exceeds the image size limit.`);
    }
    return candidate;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw invalidRequest(`${field} must be a valid HTTP(S) URL.`);
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    || parsed.username
    || parsed.password
  ) {
    throw invalidRequest(`${field} must be an HTTP(S) URL without credentials.`);
  }
  return parsed.toString();
}

function normalizeText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidRequest(`${field} must be non-empty text.`);
  }
  if (Buffer.byteLength(value, "utf8") > MAX_TEXT_LENGTH) {
    throw invalidRequest(`${field} exceeds the text size limit.`);
  }
  return value;
}

function normalizeJsonSchema(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    throw invalidRequest("schema must be a JSON Schema object.");
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidRequest("schema must be JSON serializable.");
  }
  if (Buffer.byteLength(serialized, "utf8") > 512 * 1024) {
    throw invalidRequest("schema exceeds the size limit.");
  }
  return JSON.parse(serialized);
}

function normalizeSchemaName(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const normalized = candidate
    .replace(/[^A-Za-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64);
  return normalized || "education_extraction";
}

function normalizeChatResponseFormat(value) {
  if (value === "json_object") return { type: "json_object" };
  if (
    value
    && typeof value === "object"
    && (value.type === "json_object" || value.type === "json_schema")
  ) {
    return JSON.parse(JSON.stringify(value));
  }
  throw invalidRequest("responseFormat must be json_object or json_schema.");
}

function addOptionalNumber(target, key, value, minimum, maximum) {
  if (value === undefined || value === null) return;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw invalidRequest(`${key} must be between ${minimum} and ${maximum}.`);
  }
  target[key] = number;
}

function addOptionalInteger(target, key, value, minimum, maximum) {
  if (value === undefined || value === null) return;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw invalidRequest(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
  target[key] = number;
}

function normalizeTimeout(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 100 || number > 10 * 60_000) {
    return fallback;
  }
  return Math.floor(number);
}

function normalizeRetries(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > MAX_RETRIES) {
    return fallback;
  }
  return number;
}

async function requestJson({
  url,
  body,
  signal,
  timeoutMs,
  maxRetries,
  apiKey,
  fetchImpl,
  sleepImpl,
}) {
  if (signal?.aborted) throw abortedError();
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await requestJsonAttempt({
        url,
        body,
        externalSignal: signal,
        timeoutMs,
        apiKey,
        fetchImpl,
      });
    } catch (error) {
      const normalized = normalizeRequestError(error, signal);
      lastError = normalized;
      if (
        signal?.aborted
        || !normalized.retryable
        || attempt >= maxRetries
      ) {
        normalized.attempts = attempt + 1;
        throw normalized;
      }
      await waitForRetry({
        delayMs: Math.min(2_000, 250 * (2 ** attempt)),
        signal,
        sleepImpl,
      });
    }
  }
  throw lastError;
}

async function requestJsonAttempt({
  url,
  body,
  externalSignal,
  timeoutMs,
  apiKey,
  fetchImpl,
}) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener?.("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const requestId = readRequestId(response);
    const payload = await readLimitedJson(response, controller.signal);
    if (!response?.ok) {
      throw providerHttpError(response?.status, payload, requestId);
    }
    return { payload, requestId };
  } catch (error) {
    if (externalSignal?.aborted) throw abortedError();
    if (timedOut) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", abortFromCaller);
  }
}

async function readLimitedJson(response, signal) {
  if (!response || typeof response !== "object") {
    throw invalidResponse("Ark returned an invalid HTTP response.", true);
  }
  let text = "";
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value?.byteLength || 0;
        if (bytes > MAX_RESPONSE_BYTES) {
          throw invalidResponse("Ark returned an oversized response.");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock?.();
    }
  } else if (typeof response.text === "function") {
    text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw invalidResponse("Ark returned an oversized response.");
    }
  } else if (typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      throw invalidResponse("Ark returned unreadable JSON.", true);
    }
  } else {
    throw invalidResponse("Ark returned an unreadable response.", true);
  }
  if (!text.trim()) {
    throw invalidResponse("Ark returned an empty response.", true);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw invalidResponse("Ark returned invalid JSON.", true);
  }
}

function providerHttpError(status, payload, requestId) {
  const numericStatus = Number.isInteger(status) ? status : 502;
  const providerCode = safeIdentifier(payload?.error?.code);
  const meta = { requestId, providerCode };
  if (numericStatus === 401 || numericStatus === 403) {
    return new ArkEducationModelError(
      "ark_model_auth_failed",
      "Ark rejected the server credentials.",
      { ...meta, status: 502 },
    );
  }
  if (numericStatus === 429) {
    return new ArkEducationModelError(
      "ark_model_rate_limited",
      "Ark is temporarily rate limited.",
      { ...meta, status: 503, retryable: true },
    );
  }
  const retryable = numericStatus === 408
    || numericStatus === 425
    || numericStatus >= 500;
  return new ArkEducationModelError(
    retryable ? "ark_model_unavailable" : "ark_model_upstream_rejected",
    retryable
      ? "Ark is temporarily unavailable."
      : "Ark rejected the model request.",
    { ...meta, status: 502, retryable },
  );
}

function normalizeRequestError(error, signal) {
  if (signal?.aborted) return abortedError();
  if (error instanceof ArkEducationModelError) return error;
  if (error?.name === "AbortError") return timeoutError();
  return new ArkEducationModelError(
    "ark_model_network_error",
    "The Ark model request could not be completed.",
    { status: 502, retryable: true },
  );
}

async function waitForRetry({ delayMs, signal, sleepImpl }) {
  if (signal?.aborted) throw abortedError();
  let removeAbort = () => {};
  const abortPromise = new Promise((_, reject) => {
    if (!signal?.addEventListener) return;
    const onAbort = () => reject(abortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    if (signal?.addEventListener) {
      await Promise.race([
        Promise.resolve(sleepImpl(delayMs)),
        abortPromise,
      ]);
    } else {
      await sleepImpl(delayMs);
    }
  } finally {
    removeAbort();
  }
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseChatCompletion(payload, requestId) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const message = choice?.message;
  const text = extractChatText(message?.content);
  if (!message || !text.trim()) {
    throw invalidResponse("Ark returned an empty chat completion.", true);
  }
  return {
    id: safeIdentifier(payload?.id) || null,
    model: safeIdentifier(payload?.model) || null,
    text,
    message: {
      role: message.role === "assistant" ? "assistant" : "assistant",
      content: text,
    },
    finishReason: typeof choice.finish_reason === "string"
      ? choice.finish_reason
      : null,
    usage: normalizeUsage(payload?.usage),
    requestId: safeIdentifier(requestId) || null,
  };
}

function extractChatText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    return typeof part.text === "string" ? part.text : "";
  }).join("");
}

function parseStructuredResponse(payload, requestId) {
  const outputText = extractResponsesText(payload);
  if (!outputText.trim()) {
    throw invalidResponse("Ark returned an empty structured response.", true);
  }
  let data;
  try {
    data = JSON.parse(stripJsonFence(outputText));
  } catch {
    throw invalidResponse("Ark returned invalid structured JSON.", true);
  }
  return {
    data,
    text: outputText,
    id: safeIdentifier(payload?.id) || null,
    model: safeIdentifier(payload?.model) || null,
    status: safeIdentifier(payload?.status) || null,
    usage: normalizeUsage(payload?.usage),
    requestId: safeIdentifier(requestId) || null,
  };
}

function extractResponsesText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload?.output)) return "";
  return payload.output.flatMap((item) =>
    Array.isArray(item?.content) ? item.content : []
  ).map((part) => {
    if (!part || typeof part !== "object") return "";
    if (
      (part.type === "output_text" || part.type === "text")
      && typeof part.text === "string"
    ) {
      return part.text;
    }
    return "";
  }).join("");
}

function parseEmbeddingResponse(payload, requestId) {
  const data = payload?.data;
  const first = Array.isArray(data) ? data[0] : data;
  const rawEmbedding = first?.embedding ?? payload?.embedding;
  let embedding;
  if (typeof rawEmbedding === "string") {
    embedding = rawEmbedding;
  } else if (
    Array.isArray(rawEmbedding)
    && rawEmbedding.length > 0
    && rawEmbedding.every((value) => Number.isFinite(value))
  ) {
    embedding = [...rawEmbedding];
  } else {
    throw invalidResponse("Ark returned an invalid multimodal embedding.", true);
  }
  return {
    embedding,
    sparseEmbedding: normalizeSparseEmbedding(
      first?.sparse_embedding ?? payload?.sparse_embedding,
    ),
    model: safeIdentifier(payload?.model) || null,
    usage: normalizeUsage(payload?.usage),
    requestId: safeIdentifier(requestId) || null,
  };
}

function normalizeSparseEmbedding(value) {
  if (!value || typeof value !== "object") return null;
  if (
    Array.isArray(value.indices)
    && Array.isArray(value.values)
    && value.indices.length === value.values.length
    && value.indices.every((item) => Number.isInteger(item) && item >= 0)
    && value.values.every((item) => Number.isFinite(item))
  ) {
    return {
      indices: [...value.indices],
      values: [...value.values],
    };
  }
  return null;
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") return null;
  const usage = {};
  for (const key of [
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "input_tokens",
    "output_tokens",
  ]) {
    if (Number.isInteger(value[key]) && value[key] >= 0) {
      usage[key] = value[key];
    }
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

function readRequestId(response) {
  if (typeof response?.headers?.get !== "function") return undefined;
  for (const name of ["x-request-id", "x-tt-logid", "request-id"]) {
    const value = safeIdentifier(response.headers.get(name));
    if (value) return value;
  }
  return undefined;
}

function safeIdentifier(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return SAFE_IDENTIFIER.test(trimmed) ? trimmed : undefined;
}

function stripJsonFence(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match ? match[1].trim() : trimmed;
}

function invalidRequest(message) {
  return new ArkEducationModelError(
    "ark_model_invalid_request",
    message,
    { status: 400 },
  );
}

function invalidResponse(message, retryable = false) {
  return new ArkEducationModelError(
    "ark_model_invalid_response",
    message,
    { status: 502, retryable },
  );
}

function abortedError() {
  return new ArkEducationModelError(
    "ark_model_aborted",
    "The Ark model request was cancelled.",
    { status: 499 },
  );
}

function timeoutError() {
  return new ArkEducationModelError(
    "ark_model_timeout",
    "The Ark model request timed out.",
    { status: 504, retryable: true },
  );
}
