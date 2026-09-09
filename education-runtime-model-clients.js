import { createArkClient } from "./ark-llm-client.js";
import { createArkEducationModelClient } from "./ark-education-model-client.js";
import { createArkMediaClient } from "./ark-media-client.js";
import { createVolcengineEducationBotClient } from "./volcengine-education-bot-client.js";
import { createVolcengineTextTtsService } from "./volcengine-text-tts.js";

/**
 * Stable, server-only model facades backed by the persisted runtime settings.
 *
 * Long-lived services keep the facade identity while a successful settings
 * save atomically replaces only the affected provider client. Credentials
 * never cross this module's server boundary or appear in config summaries.
 */
export function createRuntimeEducationModelClient({
  runtimeSettings,
  createClient = createArkEducationModelClient,
  fetchImpl = globalThis.fetch,
} = {}) {
  assertRuntimeSettings(runtimeSettings);
  let fingerprint = "";
  let active = null;

  const rebuild = () => {
    const settings = runtimeSettings.getPrivateSettings();
    const nextFingerprint = stableFingerprint([
      settings.models.chat,
      settings.models.vision,
      settings.models.embedding,
    ]);
    if (active && nextFingerprint === fingerprint) return;
    active = buildEducationModelBundle(settings.models, { createClient, fetchImpl });
    fingerprint = nextFingerprint;
  };
  rebuild();
  runtimeSettings.subscribe(rebuild);

  return Object.freeze({
    chatCompletion(...args) { return active.vision.chatCompletion(...args); },
    extractStructured(...args) { return active.chat.extractStructured(...args); },
    embedMultimodal(...args) { return active.embedding.embedMultimodal(...args); },
    configSummary() {
      const chat = active.chat.configSummary();
      const vision = active.vision.configSummary();
      const embedding = active.embedding.configSummary();
      const missing = [];
      if (!chat.configured) missing.push("chat.api_key");
      if (!vision.configured) missing.push("vision.api_key");
      if (!embedding.configured) missing.push("embedding.api_key");
      return Object.freeze({
        configured: missing.length === 0,
        baseUrl: vision.baseUrl,
        textBaseUrl: chat.baseUrl,
        embeddingBaseUrl: embedding.baseUrl,
        visionModel: vision.visionModel,
        textModel: chat.textModel,
        embeddingModel: embedding.embeddingModel,
        timeoutMs: Math.max(chat.timeoutMs, vision.timeoutMs, embedding.timeoutMs),
        maxRetries: Math.max(chat.maxRetries, vision.maxRetries, embedding.maxRetries),
        missing: Object.freeze(missing),
        dynamic: true,
      });
    },
  });
}

export function createRuntimeArkClient({
  runtimeSettings,
  createClient = createArkClient,
  fetchImpl = globalThis.fetch,
} = {}) {
  assertRuntimeSettings(runtimeSettings);
  let fingerprint = "";
  let active = null;
  const rebuild = () => {
    const config = runtimeSettings.getModelConfig("chat");
    const nextFingerprint = stableFingerprint(config);
    if (active && nextFingerprint === fingerprint) return;
    active = createClient({
      env: {
        ARK_API_KEY: config.api_key,
        ARK_BASE_URL: config.endpoint,
        ARK_MODEL: config.model,
        ARK_REQUEST_TIMEOUT_MS: String(config.timeout_ms),
      },
      fetchImpl,
    });
    fingerprint = nextFingerprint;
  };
  rebuild();
  runtimeSettings.subscribe(rebuild);
  return Object.freeze({
    complete(...args) { return active.complete(...args); },
    generateJson(...args) { return active.generateJson(...args); },
    configSummary(...args) { return active.configSummary(...args); },
  });
}

export function createRuntimeArkMediaClient({
  runtimeSettings,
  createClient = createArkMediaClient,
  fetchImpl = globalThis.fetch,
} = {}) {
  assertRuntimeSettings(runtimeSettings);
  let fingerprint = "";
  let active = null;
  const rebuild = () => {
    const settings = runtimeSettings.getPrivateSettings();
    const nextFingerprint = stableFingerprint([
      settings.models.image_generation,
      settings.models.video_generation,
    ]);
    if (active && nextFingerprint === fingerprint) return;
    active = buildMediaBundle(settings.models, { createClient, fetchImpl });
    fingerprint = nextFingerprint;
  };
  rebuild();
  runtimeSettings.subscribe(rebuild);
  return Object.freeze({
    generateImage(...args) { return active.image.generateImage(...args); },
    createVideoTask(...args) { return active.video.createVideoTask(...args); },
    getVideoTask(...args) { return active.video.getVideoTask(...args); },
    deleteVideoTask(...args) { return active.video.deleteVideoTask(...args); },
    configSummary() {
      const image = active.image.configSummary();
      const video = active.video.configSummary();
      return Object.freeze({
        schema_version: "ark-media-config@1.0",
        configured: image.configured && video.configured,
        missing: Object.freeze([
          ...(!image.configured ? ["image_generation.api_key"] : []),
          ...(!video.configured ? ["video_generation.api_key"] : []),
        ]),
        base_url: image.base_url,
        video_base_url: video.base_url,
        seedream: image.seedream,
        seedance: video.seedance,
        timeout_ms: Math.max(image.timeout_ms, video.timeout_ms),
        dynamic: true,
      });
    },
  });
}

export function createRuntimeEducationBotClient({
  runtimeSettings,
  createClient = createVolcengineEducationBotClient,
  fetchImpl = globalThis.fetch,
  sleepImpl,
  nowImpl,
} = {}) {
  assertRuntimeSettings(runtimeSettings);
  let fingerprint = "";
  let active = null;
  const rebuild = () => {
    const config = runtimeSettings.getModelConfig("online_answer");
    const nextFingerprint = stableFingerprint(config);
    if (active && nextFingerprint === fingerprint) return;
    active = createClient({
      env: {
        VOLC_EDUCATION_BOT_BASE_URL: config.endpoint,
        VOLC_EDUCATION_BOT_ID: config.bot_id,
        VOLC_EDUCATION_BOT_SERVICE_NAME: config.service_name,
        VOLC_EDUCATION_BOT_TIMEOUT_MS: String(config.timeout_ms),
        VOLC_EDUCATION_BOT_BEARER_TOKEN: config.api_key,
        VOLC_EDUCATION_BOT_BEARER_SOURCE: "bearer_token",
      },
      fetchImpl,
      ...(sleepImpl ? { sleepImpl } : {}),
      ...(nowImpl ? { nowImpl } : {}),
    });
    fingerprint = nextFingerprint;
  };
  rebuild();
  runtimeSettings.subscribe(rebuild);
  return Object.freeze({
    configSummary(...args) { return active.configSummary(...args); },
    probeConfiguration(...args) { return active.probeConfiguration(...args); },
    streamChatCompletion(...args) { return active.streamChatCompletion(...args); },
    chatCompletion(...args) { return active.chatCompletion(...args); },
    submitHomeworkMark(...args) { return active.submitHomeworkMark(...args); },
    queryHomeworkMark(...args) { return active.queryHomeworkMark(...args); },
    pollHomeworkMark(...args) { return active.pollHomeworkMark(...args); },
  });
}

export function createRuntimeTextTtsService({
  runtimeSettings,
  createService = createVolcengineTextTtsService,
  WebSocketImpl,
} = {}) {
  assertRuntimeSettings(runtimeSettings);
  let fingerprint = "";
  let active = null;
  const rebuild = () => {
    const config = runtimeSettings.getModelConfig("realtime_voice");
    const nextFingerprint = stableFingerprint(config);
    if (active && nextFingerprint === fingerprint) return;
    active = createService({
      env: {
        DOUBAO_API_KEY: config.api_key,
        DOUBAO_TEXT_TTS_ENDPOINT: config.endpoint,
        DOUBAO_TEXT_TTS_MODEL: config.model,
        DOUBAO_TEXT_TTS_TIMEOUT_MS: String(Math.min(config.timeout_ms, 120_000)),
      },
      ...(WebSocketImpl ? { WebSocketImpl } : {}),
    });
    fingerprint = nextFingerprint;
  };
  rebuild();
  runtimeSettings.subscribe(rebuild);
  return Object.freeze({
    configSummary(...args) { return active.configSummary(...args); },
    prepareRequest(...args) { return active.prepareRequest(...args); },
    synthesize(...args) { return active.synthesize(...args); },
  });
}

export function runtimePiLearningEnvironment(runtimeSettings) {
  assertRuntimeSettings(runtimeSettings);
  const config = runtimeSettings.getModelConfig("chat");
  return Object.freeze({
    ARK_API_KEY: config.api_key,
    ARK_PI_LEARNING_BASE_URL: config.endpoint,
    ARK_PI_LEARNING_MODEL: config.model,
    ARK_PI_LEARNING_TIMEOUT_MS: String(config.timeout_ms),
  });
}

export function createRuntimePiLearningAgent({
  runtimeSettings,
  createAgent,
  agentOptions = {},
} = {}) {
  assertRuntimeSettings(runtimeSettings);
  if (typeof createAgent !== "function") throw new TypeError("createAgent is required");
  let fingerprint = "";
  let active = null;
  const rebuild = () => {
    const config = runtimeSettings.getModelConfig("chat");
    const nextFingerprint = stableFingerprint(config);
    if (active && nextFingerprint === fingerprint) return;
    active = createAgent({
      ...agentOptions,
      env: runtimePiLearningEnvironment(runtimeSettings),
    });
    fingerprint = nextFingerprint;
  };
  rebuild();
  runtimeSettings.subscribe(rebuild);
  return Object.freeze({
    configSummary(...args) { return active.configSummary(...args); },
    runTurn(...args) { return active.runTurn(...args); },
    registerTeachingPackage(...args) { return active.registerTeachingPackage(...args); },
    grade(...args) { return active.grade(...args); },
  });
}

function buildEducationModelBundle(models, { createClient, fetchImpl }) {
  return Object.freeze({
    chat: createClient({ env: arkEducationEnv(models.chat, "chat"), fetchImpl }),
    vision: createClient({ env: arkEducationEnv(models.vision, "vision"), fetchImpl }),
    embedding: createClient({ env: arkEducationEnv(models.embedding, "embedding"), fetchImpl }),
  });
}

function arkEducationEnv(config, role) {
  const model = config.model;
  return {
    ARK_API_KEY: config.api_key,
    ARK_BASE_URL: config.endpoint,
    ARK_VISION_MODEL: model,
    ARK_TEXT_MODEL: model,
    ARK_MULTIMODAL_EMBEDDING_MODEL: model,
    ARK_MODEL_REQUEST_TIMEOUT_MS: String(config.timeout_ms),
    EDUCATION_RUNTIME_MODEL_ROLE: role,
  };
}

function buildMediaBundle(models, { createClient, fetchImpl }) {
  return Object.freeze({
    image: createClient({ env: arkMediaEnv(models.image_generation, "image"), fetchImpl }),
    video: createClient({ env: arkMediaEnv(models.video_generation, "video"), fetchImpl }),
  });
}

function arkMediaEnv(config, role) {
  return {
    ARK_API_KEY: config.api_key,
    ARK_MEDIA_BASE_URL: config.endpoint,
    ARK_SEEDREAM_MODEL: config.model,
    ARK_SEEDANCE_MODEL: config.model,
    ARK_MEDIA_REQUEST_TIMEOUT_MS: String(config.timeout_ms),
    EDUCATION_RUNTIME_MODEL_ROLE: role,
  };
}

function stableFingerprint(value) {
  return JSON.stringify(value);
}

function assertRuntimeSettings(value) {
  if (
    !value
    || typeof value.getPrivateSettings !== "function"
    || typeof value.getModelConfig !== "function"
    || typeof value.subscribe !== "function"
  ) {
    throw new TypeError("Education runtime settings repository is required");
  }
}
