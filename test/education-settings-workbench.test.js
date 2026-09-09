import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildRuntimeSettingsPatch,
  normalizeRuntimeSettings,
} from "../public/education-settings-workbench.js";

const sourcePath = new URL("../public/education-settings-workbench.js", import.meta.url);

function runtimePayload() {
  const model = (overrides = {}) => ({
    endpoint: "https://ark.example.test/v3",
    model: "demo-model",
    timeout_ms: 60_000,
    api_key: {
      configured: true,
      masked_key: "•••• 1234",
      hint: "已配置 •••• 1234",
      raw: "must-never-render",
    },
    ...overrides,
  });
  return {
    schema_version: "education-runtime-settings@1.0",
    config_version: 7,
    updated_at: "2026-09-04T09:30:00.000Z",
    models: {
      chat: model(),
      embedding: model({ model: "embedding-model" }),
      vision: model({ model: "vision-model" }),
      image_generation: model({ model: "image-model" }),
      video_generation: model({ model: "video-model" }),
      realtime_voice: model({ model: "voice-model" }),
      online_answer: model({ model: "answer-model", bot_id: "bot-1", service_name: "ask_echo" }),
    },
    agent_proxy: {
      enabled: false,
      endpoint: "",
      timeout_ms: 120_000,
      api_key: { configured: false, masked_key: "should-not-survive" },
    },
  };
}

test("runtime settings normalization keeps only credential status", () => {
  const normalized = normalizeRuntimeSettings(runtimePayload());

  assert.deepEqual(normalized.models.chat.api_key, { configured: true });
  assert.deepEqual(normalized.agent_proxy.api_key, { configured: false });
  assert.equal(JSON.stringify(normalized).includes("must-never-render"), false);
  assert.equal(JSON.stringify(normalized).includes("•••• 1234"), false);
  assert.equal(normalized.models.online_answer.bot_id, "bot-1");
  assert.equal(normalized.config_version, 7);
});

test("runtime settings patch sends only changed fields and replacement keys", () => {
  const current = normalizeRuntimeSettings(runtimePayload());
  const models = Object.fromEntries(Object.entries(current.models).map(([id, model]) => [id, {
    endpoint: model.endpoint,
    model: model.model,
    timeout_ms: model.timeout_ms,
    bot_id: model.bot_id,
    service_name: model.service_name,
    api_key: "",
  }]));
  models.chat.model = "new-chat-model";
  models.chat.api_key = "replacement-secret";
  const patch = buildRuntimeSettingsPatch(current, {
    models,
    agent_proxy: {
      enabled: true,
      endpoint: "https://agent.example.test/conversation/chat",
      api_key: "agent-secret",
    },
  });

  assert.equal(patch.expected_version, 7);
  assert.deepEqual(patch.models, {
    chat: { model: "new-chat-model", api_key: "replacement-secret" },
  });
  assert.deepEqual(patch.agent_proxy, {
    enabled: true,
    endpoint: "https://agent.example.test/conversation/chat",
    api_key: "agent-secret",
  });
});

test("runtime settings patch can explicitly clear saved credentials", () => {
  const current = normalizeRuntimeSettings(runtimePayload());
  const models = Object.fromEntries(Object.entries(current.models).map(([id, model]) => [id, {
    endpoint: model.endpoint,
    model: model.model,
    timeout_ms: model.timeout_ms,
    bot_id: model.bot_id,
    service_name: model.service_name,
    api_key: "",
    clear_api_key: id === "chat",
  }]));
  const patch = buildRuntimeSettingsPatch(current, {
    models,
    agent_proxy: {
      enabled: false,
      endpoint: "",
      api_key: "",
      clear_api_key: true,
    },
  });

  assert.deepEqual(patch.models, { chat: { clear_api_key: true } });
  assert.deepEqual(patch.agent_proxy, { clear_api_key: true });
});

test("runtime settings UI uses password fields and never renders returned key hints", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /type="password" name="\$\{escapeHTML\(name\)\}"/u);
  assert.match(source, /autocomplete="new-password"/u);
  assert.match(source, /Agent \u4ee3\u7406/u);
  assert.match(source, /aria-label="Agent \u4ee3\u7406"/u);
  assert.match(source, /data-clear-api-key/u);
  assert.match(source, /response\.status === 409/u);
  assert.match(source, /aria-busy/u);
  assert.match(source, /data-summary-retry/u);
  assert.doesNotMatch(source, /timeoutSettingField\("agent_proxy\.timeout_ms"/u);
  assert.doesNotMatch(source, /masked_key/u);
  assert.doesNotMatch(source, /source\.api_key\?\.(?:hint|masked_key)/u);
});
