import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_SETTINGS_PATH = join(moduleDir, "data", "education-runtime", "runtime-settings.json");
const SCHEMA_VERSION = "education-runtime-settings@1.0";
const STORAGE_SCHEMA_VERSION = "education-runtime-settings-private@1.0";
const MAX_KEY_LENGTH = 16 * 1024;
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_MODEL_LENGTH = 240;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MIN_TIMEOUT_MS = 1_000;
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

export const EDUCATION_MODEL_SETTING_IDS = Object.freeze([
  "chat",
  "embedding",
  "vision",
  "image_generation",
  "video_generation",
  "realtime_voice",
  "online_answer",
]);

const MODEL_SETTING_ID_SET = new Set(EDUCATION_MODEL_SETTING_IDS);

const MODEL_PUBLIC_FIELDS = Object.freeze({
  chat: ["provider", "endpoint", "model", "timeout_ms"],
  embedding: ["provider", "endpoint", "model", "timeout_ms"],
  vision: ["provider", "endpoint", "model", "timeout_ms"],
  image_generation: ["provider", "endpoint", "model", "timeout_ms"],
  video_generation: ["provider", "endpoint", "model", "timeout_ms"],
  realtime_voice: ["provider", "endpoint", "model", "timeout_ms"],
  online_answer: ["provider", "endpoint", "model", "bot_id", "service_name", "timeout_ms"],
});

export class EducationRuntimeSettingsError extends Error {
  constructor(code, message, { status = 400, cause } = {}) {
    super(message, { cause });
    this.name = "EducationRuntimeSettingsError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Server-private, durable runtime settings.
 *
 * Only explicit user overrides are written to disk. Environment defaults stay
 * in the process environment, so saving one field never copies unrelated
 * credentials into the settings file. The public projection never contains a
 * credential value.
 */
export function createEducationRuntimeSettingsRepository({
  env = process.env,
  filename = env.EDUCATION_RUNTIME_SETTINGS_PATH || DEFAULT_SETTINGS_PATH,
  clock = () => new Date().toISOString(),
} = {}) {
  const environmentDefaults = defaultsFromEnvironment(env);
  let stored = readStoredSettings(filename);
  const listeners = new Set();

  function getPrivateSettings() {
    const effective = mergeSettings(environmentDefaults, stored.overrides);
    return deepFreeze({
      schema_version: SCHEMA_VERSION,
      config_version: stored.config_version,
      updated_at: stored.updated_at,
      updated_by: stored.updated_by,
      models: effective.models,
      agent_proxy: effective.agent_proxy,
    });
  }

  function getPublicSettings() {
    const privateSettings = getPrivateSettings();
    return deepFreeze({
      schema_version: SCHEMA_VERSION,
      config_version: privateSettings.config_version,
      updated_at: privateSettings.updated_at,
      updated_by: privateSettings.updated_by,
      persistence: {
        configured: true,
        storage_classification: "server_private",
        credentials_returned: false,
      },
      models: Object.fromEntries(EDUCATION_MODEL_SETTING_IDS.map((id) => [
        id,
        publicModelSettings(id, privateSettings.models[id], sourceForModel(id)),
      ])),
      agent_proxy: publicAgentProxySettings(
        privateSettings.agent_proxy,
        sourceForAgentProxy(),
      ),
    });
  }

  function update(patch, { expectedVersion, updatedBy = "settings-admin" } = {}) {
    const safeExpectedVersion = Number(expectedVersion ?? patch?.expected_version);
    if (!Number.isInteger(safeExpectedVersion) || safeExpectedVersion < 1) {
      throw invalid("expected_version 必须是正整数", "invalid_settings_version");
    }
    if (safeExpectedVersion !== stored.config_version) {
      throw new EducationRuntimeSettingsError(
        "runtime_settings_version_conflict",
        "配置已被其他会话修改，请刷新后重试。",
        { status: 409 },
      );
    }
    const normalizedPatch = normalizeUpdatePatch(patch, getPrivateSettings());
    if (!Object.keys(normalizedPatch).length) {
      throw invalid("没有可更新的配置", "empty_runtime_settings_patch");
    }
    const nextOverrides = mergeOverrides(stored.overrides, normalizedPatch);
    const nextEffective = mergeSettings(environmentDefaults, nextOverrides);
    assertAgentProxyReady(nextEffective.agent_proxy);
    const nextStored = {
      storage_schema_version: STORAGE_SCHEMA_VERSION,
      config_version: stored.config_version + 1,
      updated_at: clock(),
      updated_by: normalizeActor(updatedBy),
      overrides: nextOverrides,
    };
    writeStoredSettings(filename, nextStored);
    stored = nextStored;
    const publicSettings = getPublicSettings();
    for (const listener of listeners) {
      try { listener(getPrivateSettings(), publicSettings); } catch { /* observers cannot roll back a durable write */ }
    }
    return publicSettings;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** Internal-only accessor used by the non-voice request router. */
  function getAgentProxyConfig() {
    return getPrivateSettings().agent_proxy;
  }

  /** Internal convenience wrapper; the public HTTP API still uses update(). */
  function updateAgentProxyConfig(patch, options = {}) {
    return update(
      { agent_proxy: patch },
      {
        ...options,
        expectedVersion: options.expectedVersion ?? options.expected_version,
      },
    );
  }

  /** Internal-only model accessor; credentials must never cross an HTTP boundary. */
  function getModelConfig(id) {
    if (!MODEL_SETTING_ID_SET.has(id)) {
      throw invalid(`不支持的模型配置：${id}`, "unknown_model_setting");
    }
    return getPrivateSettings().models[id];
  }

  function sourceForModel(id) {
    const saved = stored.overrides?.models?.[id] || {};
    if (Object.keys(saved).length) return "saved_override";
    return hasConfiguredModel(environmentDefaults.models[id]) ? "environment" : "default";
  }

  function sourceForAgentProxy() {
    if (Object.keys(stored.overrides?.agent_proxy || {}).length) return "saved_override";
    return environmentDefaults.agent_proxy.endpoint || environmentDefaults.agent_proxy.api_key
      ? "environment"
      : "default";
  }

  return Object.freeze({
    getPrivateSettings,
    getPublicSettings,
    getAgentProxyConfig,
    updateAgentProxyConfig,
    getModelConfig,
    update,
    subscribe,
  });
}

function defaultsFromEnvironment(env = {}) {
  const arkKey = firstString(env.ARK_API_KEY);
  const arkEducationEndpoint = normalizeEnvironmentEndpoint(firstString(
    env.ARK_EDUCATION_BASE_URL,
    env.ARK_BASE_URL,
    "https://ark.cn-beijing.volces.com/api/v3",
  ));
  const arkMediaEndpoint = normalizeEnvironmentEndpoint(firstString(env.ARK_MEDIA_BASE_URL, arkEducationEndpoint));
  const arkTimeout = envTimeout(env.ARK_MODEL_REQUEST_TIMEOUT_MS, 120_000);
  const mediaTimeout = envTimeout(env.ARK_MEDIA_REQUEST_TIMEOUT_MS, 120_000);
  const educationBotKey = firstString(
    env.VOLC_EDUCATION_BOT_BEARER_TOKEN,
    selectedEducationBotCredential(env),
  );
  return {
    models: {
      chat: {
        provider: "volcengine_ark",
        endpoint: normalizeEnvironmentEndpoint(firstString(env.ARK_PI_LEARNING_BASE_URL, arkEducationEndpoint)),
        model: firstString(
          env.ARK_PI_LEARNING_MODEL,
          env.ARK_EDUCATION_TEXT_MODEL,
          env.ARK_TEXT_MODEL,
          env.ARK_MODEL,
          env.ARK_EDUCATION_VISION_MODEL,
          "doubao-seed-2-1-turbo-260628",
        ),
        timeout_ms: envTimeout(
          env.ARK_PI_LEARNING_TIMEOUT_MS || env.ARK_REQUEST_TIMEOUT_MS,
          300_000,
        ),
        api_key: firstString(env.ARK_PI_LEARNING_API_KEY, arkKey),
      },
      embedding: {
        provider: "volcengine_ark",
        endpoint: arkEducationEndpoint,
        model: firstString(env.ARK_EDUCATION_EMBEDDING_MODEL, env.ARK_MULTIMODAL_EMBEDDING_MODEL, "doubao-embedding-vision-250615"),
        timeout_ms: arkTimeout,
        api_key: firstString(env.ARK_EDUCATION_EMBEDDING_API_KEY, arkKey),
      },
      vision: {
        provider: "volcengine_ark",
        endpoint: arkEducationEndpoint,
        model: firstString(env.ARK_EDUCATION_VISION_MODEL, env.ARK_VISION_MODEL, "doubao-seed-2-1-turbo-260628"),
        timeout_ms: arkTimeout,
        api_key: firstString(env.ARK_EDUCATION_VISION_API_KEY, arkKey),
      },
      image_generation: {
        provider: "volcengine_ark",
        endpoint: arkMediaEndpoint,
        model: firstString(env.ARK_SEEDREAM_MODEL, "doubao-seedream-5-0-260128"),
        timeout_ms: mediaTimeout,
        api_key: firstString(env.ARK_SEEDREAM_API_KEY, arkKey),
      },
      video_generation: {
        provider: "volcengine_ark",
        endpoint: arkMediaEndpoint,
        model: firstString(env.ARK_SEEDANCE_MODEL, "doubao-seedance-2-5-260628"),
        timeout_ms: mediaTimeout,
        api_key: firstString(env.ARK_SEEDANCE_API_KEY, arkKey),
      },
      realtime_voice: {
        provider: "doubao_realtime",
        endpoint: normalizeEnvironmentEndpoint(
          firstString(env.DOUBAO_REALTIME_ENDPOINT, "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue"),
          { allowWebSocket: true },
        ),
        model: firstString(env.DOUBAO_REALTIME_MODEL, "1.2.6.0"),
        timeout_ms: envTimeout(env.DOUBAO_REALTIME_TIMEOUT_MS, 120_000),
        api_key: firstString(env.DOUBAO_API_KEY),
      },
      online_answer: {
        provider: "volcengine_ask_echo",
        endpoint: normalizeEnvironmentEndpoint(firstString(env.VOLC_EDUCATION_BOT_BASE_URL, "https://open.feedcoopapi.com/agent_api/agent")),
        model: firstString(env.VOLC_EDUCATION_BOT_MODEL),
        bot_id: firstString(env.VOLC_EDUCATION_BOT_ID),
        service_name: firstString(env.VOLC_EDUCATION_BOT_SERVICE_NAME, "ask_echo"),
        timeout_ms: envTimeout(env.VOLC_EDUCATION_BOT_TIMEOUT_MS, 120_000),
        api_key: educationBotKey,
      },
    },
    agent_proxy: {
      enabled: envBoolean(env.EDUCATION_AGENT_PROXY_ENABLED, false),
      endpoint: normalizeEnvironmentEndpoint(firstString(env.EDUCATION_AGENT_PROXY_ENDPOINT)),
      timeout_ms: envTimeout(env.EDUCATION_AGENT_PROXY_TIMEOUT_MS, 300_000),
      api_key: firstString(env.EDUCATION_AGENT_PROXY_API_KEY),
    },
  };
}

function selectedEducationBotCredential(env) {
  const source = firstString(env.VOLC_EDUCATION_BOT_BEARER_SOURCE).toLowerCase();
  if (source === "api_key") return firstString(env.VOLC_EDUCATION_BOT_API_KEY);
  if (source === "api_token") return firstString(env.VOLC_EDUCATION_BOT_API_TOKEN);
  return firstString(env.VOLC_EDUCATION_BOT_API_KEY, env.VOLC_EDUCATION_BOT_API_TOKEN);
}

function normalizeUpdatePatch(input, current) {
  if (!isPlainObject(input)) throw invalid("请求体必须是 JSON 对象", "invalid_runtime_settings");
  const result = {};
  if (input.models !== undefined) {
    if (!isPlainObject(input.models)) throw invalid("models 必须是对象", "invalid_model_settings");
    const models = {};
    for (const [id, value] of Object.entries(input.models)) {
      if (!MODEL_SETTING_ID_SET.has(id)) {
        throw invalid(`不支持的模型配置：${id}`, "unknown_model_setting");
      }
      models[id] = normalizeModelPatch(id, value);
    }
    if (Object.keys(models).length) result.models = models;
  }
  if (input.agent_proxy !== undefined) {
    result.agent_proxy = normalizeAgentProxyPatch(input.agent_proxy, current.agent_proxy);
  }
  return result;
}

function normalizeModelPatch(id, input) {
  if (!isPlainObject(input)) throw invalid(`${id} 配置必须是对象`, "invalid_model_setting");
  const allowed = new Set([...MODEL_PUBLIC_FIELDS[id], "api_key", "clear_api_key"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw invalid(`${id} 包含未知字段：${unknown.join(", ")}`, "unknown_model_setting_field");
  const result = {};
  if (input.endpoint !== undefined) result.endpoint = normalizeEndpoint(input.endpoint, { allowWebSocket: id === "realtime_voice" });
  if (input.model !== undefined) result.model = normalizeText(input.model, "model", MAX_MODEL_LENGTH, { allowEmpty: id === "online_answer" });
  if (input.timeout_ms !== undefined) result.timeout_ms = normalizeTimeout(input.timeout_ms);
  if (id === "online_answer") {
    if (input.bot_id !== undefined) result.bot_id = normalizeText(input.bot_id, "bot_id", 240, { allowEmpty: true });
    if (input.service_name !== undefined) result.service_name = normalizeText(input.service_name, "service_name", 240);
  }
  addCredentialPatch(result, input);
  if (!Object.keys(result).length) throw invalid(`${id} 没有可更新字段`, "empty_model_setting_patch");
  return result;
}

function normalizeAgentProxyPatch(input, current) {
  if (!isPlainObject(input)) throw invalid("agent_proxy 必须是对象", "invalid_agent_proxy_settings");
  const allowed = new Set(["enabled", "endpoint", "timeout_ms", "api_key", "clear_api_key"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw invalid(`agent_proxy 包含未知字段：${unknown.join(", ")}`, "unknown_agent_proxy_field");
  const result = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw invalid("agent_proxy.enabled 必须是布尔值", "invalid_agent_proxy_enabled");
    result.enabled = input.enabled;
  }
  if (input.endpoint !== undefined) result.endpoint = normalizeEndpoint(input.endpoint);
  if (input.timeout_ms !== undefined) result.timeout_ms = normalizeTimeout(input.timeout_ms);
  addCredentialPatch(result, input);
  if (!Object.keys(result).length) throw invalid("agent_proxy 没有可更新字段", "empty_agent_proxy_patch");
  const prospective = { ...current, ...result };
  assertAgentProxyReady(prospective);
  return result;
}

function addCredentialPatch(result, input) {
  if (input.clear_api_key === true && typeof input.api_key === "string" && input.api_key.trim()) {
    throw invalid("api_key 与 clear_api_key 不能同时设置", "ambiguous_api_key_update");
  }
  if (input.clear_api_key === true) {
    result.api_key = "";
    return;
  }
  if (input.api_key === undefined || input.api_key === null || input.api_key === "") return;
  if (typeof input.api_key !== "string") throw invalid("api_key 必须是字符串", "invalid_api_key");
  const key = input.api_key.trim();
  if (!key || key.length > MAX_KEY_LENGTH || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw invalid("api_key 格式无效", "invalid_api_key");
  }
  result.api_key = key;
}

function assertAgentProxyReady(config) {
  if (config?.enabled !== true) return;
  if (!config.endpoint) {
    throw invalid("开启 Agent 代理前必须填写 Agent 地址", "agent_proxy_endpoint_required");
  }
  if (!config.api_key) {
    throw invalid("开启 Agent 代理前必须配置 Key", "agent_proxy_api_key_required");
  }
}

function publicModelSettings(id, model, source) {
  const output = {};
  for (const field of MODEL_PUBLIC_FIELDS[id] || []) {
    output[field] = field === "endpoint" ? publicEndpoint(model[field]) : model[field];
  }
  // If a future provider adds fields, only the explicit allowlist above can
  // expose them. Credentials always use the fixed redacted projection below.
  output.api_key = publicCredential(model.api_key);
  output.source = source;
  return output;
}

function publicAgentProxySettings(config, source) {
  return {
    enabled: config.enabled === true,
    endpoint: publicEndpoint(config.endpoint),
    timeout_ms: config.timeout_ms,
    api_key: publicCredential(config.api_key),
    source,
    routing_scope: "all_non_voice_teacher_conversations",
  };
}

function publicCredential(value) {
  const key = String(value || "");
  return {
    configured: Boolean(key),
    has_key: Boolean(key),
  };
}

function readStoredSettings(filename) {
  if (!existsSync(filename)) return emptyStoredSettings();
  try {
    const raw = JSON.parse(readFileSync(filename, "utf8"));
    if (!isPlainObject(raw) || raw.storage_schema_version !== STORAGE_SCHEMA_VERSION) {
      throw new Error("schema mismatch");
    }
    const version = Number(raw.config_version);
    if (!Number.isInteger(version) || version < 1 || !isPlainObject(raw.overrides)) {
      throw new Error("invalid persisted settings");
    }
    return {
      storage_schema_version: STORAGE_SCHEMA_VERSION,
      config_version: version,
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
      updated_by: typeof raw.updated_by === "string" ? raw.updated_by : null,
      overrides: sanitizeStoredOverrides(raw.overrides),
    };
  } catch (cause) {
    throw new EducationRuntimeSettingsError(
      "runtime_settings_corrupt",
      "服务端模型配置文件无法读取。",
      { status: 500, cause },
    );
  }
}

function emptyStoredSettings() {
  return {
    storage_schema_version: STORAGE_SCHEMA_VERSION,
    config_version: 1,
    updated_at: null,
    updated_by: null,
    overrides: {},
  };
}

function sanitizeStoredOverrides(overrides) {
  const result = {};
  if (isPlainObject(overrides.models)) {
    const models = {};
    for (const id of EDUCATION_MODEL_SETTING_IDS) {
      if (isPlainObject(overrides.models[id])) {
        models[id] = { ...overrides.models[id] };
        if (models[id].endpoint !== undefined) {
          models[id].endpoint = normalizeEndpoint(models[id].endpoint, { allowWebSocket: id === "realtime_voice" });
        }
      }
    }
    if (Object.keys(models).length) result.models = models;
  }
  if (isPlainObject(overrides.agent_proxy)) {
    result.agent_proxy = { ...overrides.agent_proxy };
    if (result.agent_proxy.endpoint !== undefined) {
      result.agent_proxy.endpoint = normalizeEndpoint(result.agent_proxy.endpoint);
    }
  }
  return result;
}

function writeStoredSettings(filename, value) {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(temporary, 0o600);
    renameSync(temporary, filename);
    chmodSync(filename, 0o600);
  } catch (error) {
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* best effort */ }
    throw new EducationRuntimeSettingsError(
      "runtime_settings_write_failed",
      "服务端模型配置保存失败。",
      { status: 500, cause: error },
    );
  }
}

function mergeSettings(defaults, overrides) {
  const models = {};
  for (const id of EDUCATION_MODEL_SETTING_IDS) {
    models[id] = { ...defaults.models[id], ...(overrides?.models?.[id] || {}) };
  }
  return {
    models,
    agent_proxy: { ...defaults.agent_proxy, ...(overrides?.agent_proxy || {}) },
  };
}

function mergeOverrides(previous, patch) {
  const result = { ...previous };
  if (patch.models) {
    result.models = { ...(previous.models || {}) };
    for (const [id, value] of Object.entries(patch.models)) {
      result.models[id] = { ...(previous.models?.[id] || {}), ...value };
    }
  }
  if (patch.agent_proxy) {
    result.agent_proxy = { ...(previous.agent_proxy || {}), ...patch.agent_proxy };
  }
  return result;
}

function normalizeEndpoint(value, { allowWebSocket = false } = {}) {
  const text = normalizeText(value, "endpoint", MAX_ENDPOINT_LENGTH);
  let parsed;
  try { parsed = new URL(text); } catch { throw invalid("endpoint 不是合法 URL", "invalid_model_endpoint"); }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
  const allowedProtocols = allowWebSocket ? ["https:", "wss:"] : ["https:"];
  if (loopback) allowedProtocols.push("http:", "ws:");
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw invalid("endpoint 必须使用 HTTPS/WSS；仅本机允许 HTTP/WS", "insecure_model_endpoint");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw invalid("endpoint 不能包含账号、密码或锚点", "invalid_model_endpoint");
  }
  if (hasSensitiveCredentialQuery(parsed)) {
    throw invalid(
      "endpoint 查询参数不能包含 Key、Token 或其他凭据",
      "credential_query_parameter_forbidden",
    );
  }
  return parsed.toString().replace(/\/$/u, "");
}

function normalizeEnvironmentEndpoint(value, options = {}) {
  const endpoint = firstString(value);
  return endpoint ? normalizeEndpoint(endpoint, options) : "";
}

function publicEndpoint(value) {
  const endpoint = String(value || "").trim();
  if (!endpoint) return "";
  try {
    const parsed = new URL(endpoint);
    return hasSensitiveCredentialQuery(parsed) ? "" : endpoint;
  } catch {
    return "";
  }
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

function normalizeTimeout(value) {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) {
    throw invalid(`timeout_ms 必须在 ${MIN_TIMEOUT_MS} 到 ${MAX_TIMEOUT_MS} 之间`, "invalid_model_timeout");
  }
  return timeout;
}

function normalizeText(value, field, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== "string") throw invalid(`${field} 必须是字符串`, `invalid_${field}`);
  const text = value.trim();
  if ((!text && !allowEmpty) || text.length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw invalid(`${field} 格式无效`, `invalid_${field}`);
  }
  return text;
}

function normalizeActor(value) {
  const actor = String(value || "settings-admin").trim().replace(/[\u0000-\u001f\u007f]/gu, "");
  return actor.slice(0, 200) || "settings-admin";
}

function firstString(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function envBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function envTimeout(value, fallback) {
  const timeout = Number(value);
  return Number.isInteger(timeout) && timeout >= MIN_TIMEOUT_MS && timeout <= MAX_TIMEOUT_MS
    ? timeout
    : fallback;
}

function hasConfiguredModel(value) {
  return Boolean(value?.endpoint || value?.model || value?.api_key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function invalid(message, code) {
  return new EducationRuntimeSettingsError(code, message, { status: 400 });
}
