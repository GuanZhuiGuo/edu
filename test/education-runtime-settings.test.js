import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EducationRuntimeSettingsError,
  createEducationRuntimeSettingsRepository,
} from "../education-runtime-settings.js";

function fixture(env = {}) {
  const directory = mkdtempSync(join(tmpdir(), "education-runtime-settings-"));
  const filename = join(directory, "private", "runtime-settings.json");
  const repository = createEducationRuntimeSettingsRepository({
    filename,
    env,
    clock: () => "2026-09-04T10:00:00.000Z",
  });
  return {
    directory,
    filename,
    repository,
    close() { rmSync(directory, { recursive: true, force: true }); },
  };
}

test("runtime settings expose model parameters but never return credential values", () => {
  const item = fixture({
    ARK_API_KEY: "ark-super-secret-123456",
    ARK_PI_LEARNING_MODEL: "chat-ep",
    VOLC_EDUCATION_BOT_BEARER_TOKEN: "online-secret-9876",
    VOLC_EDUCATION_BOT_ID: "bot-1",
  });
  try {
    const output = item.repository.getPublicSettings();
    assert.equal(output.schema_version, "education-runtime-settings@1.0");
    assert.equal(output.config_version, 1);
    assert.equal(output.models.chat.model, "chat-ep");
    assert.equal(output.models.chat.api_key.configured, true);
    assert.equal(output.models.chat.api_key.has_key, true);
    assert.deepEqual(output.models.chat.api_key, { configured: true, has_key: true });
    assert.equal(output.models.online_answer.bot_id, "bot-1");
    assert.deepEqual(output.models.online_answer.api_key, { configured: true, has_key: true });
    assert.equal(output.agent_proxy.enabled, false);
    assert.equal(JSON.stringify(output).includes("super-secret"), false);
    assert.equal(JSON.stringify(output).includes("online-secret"), false);
  } finally {
    item.close();
  }
});

test("partial model updates persist only explicit overrides with mode 0600", () => {
  const item = fixture({ ARK_API_KEY: "environment-key-1111" });
  try {
    const updated = item.repository.update({
      expected_version: 1,
      models: {
        embedding: {
          endpoint: "https://ark.example.com/api/v3/",
          model: "embedding-ep-2",
          api_key: "embedding-private-2222",
          timeout_ms: 90_000,
        },
      },
    }, { updatedBy: "teacher:test" });
    assert.equal(updated.config_version, 2);
    assert.equal(updated.models.embedding.endpoint, "https://ark.example.com/api/v3");
    assert.equal(updated.models.embedding.model, "embedding-ep-2");
    assert.deepEqual(updated.models.embedding.api_key, { configured: true, has_key: true });
    assert.equal(statSync(item.filename).mode & 0o777, 0o600);

    const storedText = readFileSync(item.filename, "utf8");
    assert.equal(storedText.includes("embedding-private-2222"), true);
    assert.equal(storedText.includes("environment-key-1111"), false);

    const reloaded = createEducationRuntimeSettingsRepository({
      filename: item.filename,
      env: { ARK_API_KEY: "changed-environment-3333" },
    });
    assert.equal(reloaded.getModelConfig("embedding").api_key, "embedding-private-2222");
    assert.equal(reloaded.getModelConfig("chat").api_key, "changed-environment-3333");
  } finally {
    item.close();
  }
});

test("blank key preserves the prior credential and clear_api_key explicitly removes it", () => {
  const item = fixture({ ARK_API_KEY: "environment-key-1111" });
  try {
    item.repository.update({
      expected_version: 1,
      models: { chat: { api_key: "" , model: "new-chat-model" } },
    });
    assert.equal(item.repository.getModelConfig("chat").api_key, "environment-key-1111");
    item.repository.update({
      expected_version: 2,
      models: { chat: { clear_api_key: true } },
    });
    assert.equal(item.repository.getModelConfig("chat").api_key, "");
    assert.equal(item.repository.getPublicSettings().models.chat.api_key.configured, false);
  } finally {
    item.close();
  }
});

test("agent proxy is disabled by default and cannot be enabled without address and key", () => {
  const item = fixture();
  try {
    assert.equal(item.repository.getAgentProxyConfig().enabled, false);
    assert.throws(
      () => item.repository.updateAgentProxyConfig({ enabled: true }, { expectedVersion: 1 }),
      (error) => error instanceof EducationRuntimeSettingsError
        && error.code === "agent_proxy_endpoint_required",
    );
    const configured = item.repository.updateAgentProxyConfig({
      enabled: true,
      endpoint: "https://agent.example.com/conversation/chat",
      api_key: "agent-private-key-4444",
    }, { expectedVersion: 1, updatedBy: "teacher:test" });
    assert.equal(configured.agent_proxy.enabled, true);
    assert.deepEqual(configured.agent_proxy.api_key, { configured: true, has_key: true });
    assert.deepEqual(item.repository.getAgentProxyConfig(), {
      enabled: true,
      endpoint: "https://agent.example.com/conversation/chat",
      timeout_ms: 300_000,
      api_key: "agent-private-key-4444",
    });
    assert.equal(JSON.stringify(configured).includes("agent-private-key"), false);
  } finally {
    item.close();
  }
});

test("runtime settings reject insecure remote endpoints and stale versions", () => {
  const item = fixture();
  try {
    assert.throws(
      () => item.repository.update({
        expected_version: 1,
        models: { chat: { endpoint: "http://remote.example.com/api" } },
      }),
      (error) => error.code === "insecure_model_endpoint",
    );
    item.repository.update({
      expected_version: 1,
      models: { chat: { endpoint: "http://127.0.0.1:9000/api" } },
    });
    assert.throws(
      () => item.repository.update({
        expected_version: 1,
        models: { chat: { model: "stale" } },
      }),
      (error) => error.status === 409 && error.code === "runtime_settings_version_conflict",
    );
  } finally {
    item.close();
  }
});

test("runtime settings reject credential-bearing endpoint query parameters from updates and environment", () => {
  const item = fixture();
  try {
    for (const parameter of [
      "api_key",
      "apiKey",
      "x-api-key",
      "key",
      "token",
      "access_token",
      "client-secret",
      "authorization",
      "X-Amz-Credential",
    ]) {
      assert.throws(
        () => item.repository.update({
          expected_version: 1,
          models: { chat: { endpoint: `https://ark.example.test/api?${parameter}=must-not-appear` } },
        }),
        (error) => error instanceof EducationRuntimeSettingsError
          && error.code === "credential_query_parameter_forbidden",
      );
    }
  } finally {
    item.close();
  }

  const directory = mkdtempSync(join(tmpdir(), "education-runtime-settings-env-"));
  try {
    assert.throws(
      () => createEducationRuntimeSettingsRepository({
        filename: join(directory, "runtime-settings.json"),
        env: {
          EDUCATION_AGENT_PROXY_ENDPOINT: "https://agent.example.test/chat?access_token=must-not-appear",
        },
      }),
      (error) => error instanceof EducationRuntimeSettingsError
        && error.code === "credential_query_parameter_forbidden",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
