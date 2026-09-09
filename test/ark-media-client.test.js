import assert from "node:assert/strict";
import test from "node:test";

import { ArkMediaClientError, createArkMediaClient } from "../ark-media-client.js";

const configuredEnv = Object.freeze({
  ARK_API_KEY: "server-only-test-secret",
  ARK_MEDIA_BASE_URL: "https://ark.example.test/api/v3/",
  ARK_SEEDREAM_MODEL: "doubao-seedream-5-0-260128",
  ARK_SEEDANCE_MODEL: "doubao-seedance-2-5-260628",
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async text() { return JSON.stringify(payload); },
  };
}

test("media configuration is safe and never performs an eager paid request", async () => {
  let calls = 0;
  const client = createArkMediaClient({
    env: configuredEnv,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });

  const summary = client.configSummary();
  assert.equal(summary.seedream.model, "doubao-seedream-5-0-260128");
  assert.equal(summary.seedance.model, "doubao-seedance-2-5-260628");
  assert.equal(JSON.stringify(summary).includes(configuredEnv.ARK_API_KEY), false);
  assert.equal(calls, 0);
});

test("Seedream request supports reviewed reference images and checks item errors", async () => {
  let request;
  const client = createArkMediaClient({
    env: configuredEnv,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse({ data: [{ url: "https://assets.example.test/scene.png" }] });
    },
  });

  const result = await client.generateImage({
    prompt: "生成一张可追溯到教材页的函数教学示意图",
    size: "2K",
    images: ["https://assets.example.test/page-1.png"],
    sequentialImageGeneration: "disabled",
    watermark: false,
  });

  assert.equal(request.url, "https://ark.example.test/api/v3/images/generations");
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, "doubao-seedream-5-0-260128");
  assert.equal(body.sequential_image_generation, "disabled");
  assert.deepEqual(body.image, ["https://assets.example.test/page-1.png"]);
  assert.equal(request.init.headers.Authorization, `Bearer ${configuredEnv.ARK_API_KEY}`);
  assert.equal(result.payload.data[0].url, "https://assets.example.test/scene.png");

  const failing = createArkMediaClient({
    env: configuredEnv,
    fetchImpl: async () => jsonResponse({ data: [{ error: { code: "BadPrompt", message: "rejected" } }] }),
  });
  await assert.rejects(
    failing.generateImage({ prompt: "test" }),
    (error) => error instanceof ArkMediaClientError && error.code === "ark_media_provider_error",
  );
});

test("Seedance request uses the 2.5 reference contract and education scene bounds", async () => {
  let request;
  const client = createArkMediaClient({
    env: configuredEnv,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse({ id: "task-1", status: "queued" });
    },
  });

  await client.createVideoTask({
    content: [
      { type: "text", text: "讲解一元二次函数的图像变化" },
      { type: "image_url", image_url: { url: "https://assets.example.test/storyboard.png" }, role: "reference_image" },
    ],
    duration: 12,
    ratio: "16:9",
    resolution: "720p",
    generateAudio: true,
  });

  assert.equal(request.url, "https://ark.example.test/api/v3/contents/generations/tasks");
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, "doubao-seedance-2-5-260628");
  assert.equal(body.duration, 12);
  assert.equal(body.resolution, "720p");
  assert.equal(body.omni_reference_task_type, "reference");
  assert.equal(body.content[1].role, "reference_image");
  await assert.rejects(
    client.createVideoTask({ content: [{ type: "text", text: "too long" }], duration: 31 }),
    (error) => error instanceof ArkMediaClientError && error.status === 400,
  );
});
