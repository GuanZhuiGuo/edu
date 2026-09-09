import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEducationRuntimeSettingsRepository } from "../education-runtime-settings.js";
import {
  createRuntimeArkMediaClient,
  createRuntimeEducationBotClient,
  createRuntimeEducationModelClient,
  createRuntimePiLearningAgent,
  createRuntimeTextTtsService,
} from "../education-runtime-model-clients.js";

function fixture(env = {}) {
  const directory = mkdtempSync(join(tmpdir(), "education-runtime-models-"));
  const runtimeSettings = createEducationRuntimeSettingsRepository({
    env: {
      ARK_API_KEY: "initial-key",
      ARK_MODEL: "initial-chat",
      ...env,
    },
    filename: join(directory, "runtime-settings.json"),
  });
  return {
    runtimeSettings,
    close() { rmSync(directory, { recursive: true, force: true }); },
  };
}

function fakeEducationModelClient({ env }) {
  const summary = {
    configured: Boolean(env.ARK_API_KEY),
    baseUrl: env.ARK_BASE_URL,
    visionModel: env.ARK_VISION_MODEL,
    textModel: env.ARK_TEXT_MODEL,
    embeddingModel: env.ARK_MULTIMODAL_EMBEDDING_MODEL,
    timeoutMs: Number(env.ARK_MODEL_REQUEST_TIMEOUT_MS),
    maxRetries: 0,
  };
  const result = (method) => ({ method, model: env.ARK_TEXT_MODEL, key: env.ARK_API_KEY });
  return {
    configSummary: () => summary,
    chatCompletion: () => result("chatCompletion"),
    extractStructured: () => result("extractStructured"),
    embedMultimodal: () => result("embedMultimodal"),
  };
}

test("runtime education model facade routes capabilities and applies saved changes immediately", () => {
  const item = fixture();
  try {
    const client = createRuntimeEducationModelClient({
      runtimeSettings: item.runtimeSettings,
      createClient: fakeEducationModelClient,
    });
    assert.equal(client.extractStructured().model, "initial-chat");
    assert.equal(client.chatCompletion().model, "doubao-seed-2-1-turbo-260628");
    assert.equal(client.embedMultimodal().model, "doubao-embedding-vision-250615");

    item.runtimeSettings.update({
      expected_version: 1,
      models: { chat: { model: "updated-chat", api_key: "updated-secret" } },
    });
    assert.deepEqual(client.extractStructured(), {
      method: "extractStructured",
      model: "updated-chat",
      key: "updated-secret",
    });
    assert.equal(JSON.stringify(client.configSummary()).includes("updated-secret"), false);
  } finally {
    item.close();
  }
});

test("runtime media facade uses separate image and video settings", () => {
  const item = fixture();
  try {
    const createClient = ({ env }) => ({
      configSummary: () => ({
        configured: Boolean(env.ARK_API_KEY),
        base_url: env.ARK_MEDIA_BASE_URL,
        seedream: { configured: true, model: env.ARK_SEEDREAM_MODEL },
        seedance: { configured: true, model: env.ARK_SEEDANCE_MODEL },
        timeout_ms: Number(env.ARK_MEDIA_REQUEST_TIMEOUT_MS),
      }),
      generateImage: () => env.EDUCATION_RUNTIME_MODEL_ROLE,
      createVideoTask: () => env.EDUCATION_RUNTIME_MODEL_ROLE,
      getVideoTask: () => env.EDUCATION_RUNTIME_MODEL_ROLE,
      deleteVideoTask: () => env.EDUCATION_RUNTIME_MODEL_ROLE,
    });
    const client = createRuntimeArkMediaClient({
      runtimeSettings: item.runtimeSettings,
      createClient,
    });
    assert.equal(client.generateImage(), "image");
    assert.equal(client.createVideoTask(), "video");
    assert.equal(client.configSummary().seedream.model, "doubao-seedream-5-0-260128");
    assert.equal(client.configSummary().seedance.model, "doubao-seedance-2-5-260628");
  } finally {
    item.close();
  }
});

test("runtime online-answer facade replaces the underlying credential without exposing it", () => {
  const item = fixture({
    VOLC_EDUCATION_BOT_ID: "bot-1",
    VOLC_EDUCATION_BOT_BEARER_TOKEN: "first-online-secret",
  });
  try {
    const createClient = ({ env }) => {
      const output = () => ({ key: env.VOLC_EDUCATION_BOT_BEARER_TOKEN, bot: env.VOLC_EDUCATION_BOT_ID });
      return {
        configSummary: () => ({ configured: true, bot_id: env.VOLC_EDUCATION_BOT_ID }),
        probeConfiguration: output,
        streamChatCompletion: output,
        chatCompletion: output,
        submitHomeworkMark: output,
        queryHomeworkMark: output,
        pollHomeworkMark: output,
      };
    };
    const client = createRuntimeEducationBotClient({
      runtimeSettings: item.runtimeSettings,
      createClient,
    });
    assert.equal(client.chatCompletion().key, "first-online-secret");
    item.runtimeSettings.update({
      expected_version: 1,
      models: { online_answer: { api_key: "second-online-secret", bot_id: "bot-2" } },
    });
    assert.deepEqual(client.submitHomeworkMark(), { key: "second-online-secret", bot: "bot-2" });
    assert.equal(JSON.stringify(client.configSummary()).includes("online-secret"), false);
  } finally {
    item.close();
  }
});

test("runtime Pi Agent facade follows chat model changes", () => {
  const item = fixture();
  try {
    const createAgent = ({ env }) => ({
      configSummary: () => ({ model: env.ARK_PI_LEARNING_MODEL, configured: Boolean(env.ARK_API_KEY) }),
      runTurn: () => env.ARK_PI_LEARNING_MODEL,
      registerTeachingPackage: () => env.ARK_PI_LEARNING_MODEL,
      grade: () => env.ARK_PI_LEARNING_MODEL,
    });
    const agent = createRuntimePiLearningAgent({
      runtimeSettings: item.runtimeSettings,
      createAgent,
    });
    assert.equal(agent.runTurn(), "initial-chat");
    item.runtimeSettings.update({
      expected_version: 1,
      models: { chat: { model: "chat-after-save" } },
    });
    assert.equal(agent.runTurn(), "chat-after-save");
  } finally {
    item.close();
  }
});

test("runtime text TTS facade follows realtime voice settings", () => {
  const item = fixture({ DOUBAO_API_KEY: "voice-secret-one" });
  try {
    const createService = ({ env }) => ({
      configSummary: () => ({
        configured: Boolean(env.DOUBAO_API_KEY),
        model: env.DOUBAO_TEXT_TTS_MODEL,
      }),
      prepareRequest: () => env.DOUBAO_TEXT_TTS_MODEL,
      synthesize: () => env.DOUBAO_API_KEY,
    });
    const service = createRuntimeTextTtsService({
      runtimeSettings: item.runtimeSettings,
      createService,
    });
    assert.equal(service.prepareRequest(), "1.2.6.0");
    item.runtimeSettings.update({
      expected_version: 1,
      models: { realtime_voice: { model: "voice-model-two", api_key: "voice-secret-two" } },
    });
    assert.equal(service.prepareRequest(), "voice-model-two");
    assert.equal(service.synthesize(), "voice-secret-two");
    assert.equal(JSON.stringify(service.configSummary()).includes("voice-secret"), false);
  } finally {
    item.close();
  }
});
