import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ArkMediaClientError } from "../ark-media-client.js";
import { createEducationDataStore } from "../education-data-store.js";
import { createEducationVideoRepository } from "../education-video-repository.js";
import { EducationVideoServiceError, createEducationVideoService } from "../education-video-service.js";

function makeDocument(pageCount, { withAssets = false } = {}) {
  const pages = Array.from({ length: pageCount }, (_, index) => ({
    index,
    blocks: [{ type: index % 3 === 0 ? "heading" : "paragraph", text: `第 ${index + 1} 页教材内容` }],
  }));
  const assets = withAssets
    ? pages.map((page) => ({
      id: `source-page-${page.index}`,
      page_index: page.index,
      mime_type: "image/png",
      width: 800,
      height: 600,
    }))
    : [];
  return {
    document: {
      id: `doc:${pageCount}`,
      revision_id: `docrev:${pageCount}`,
      title: `测试教材 ${pageCount}`,
      document_type: "courseware",
      pages,
    },
    assets,
  };
}

function createFixture(t, {
  pageCount = 3,
  withAssets = false,
  generateImage,
  createVideoTask,
  getVideoTask,
  deleteVideoTask,
  fetchImpl,
  sourceAssetBytes,
  env = {},
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "education-video-service-"));
  const filename = join(directory, "education.sqlite");
  const store = createEducationDataStore({ filename });
  store.initialize();
  store.upsertTenant({ tenantId: "tenant-test", name: "Test" });
  store.close();
  const repository = createEducationVideoRepository({ filename });
  const source = makeDocument(pageCount, { withAssets });
  const importJob = {
    id: "import-aaaaaaaa",
    status: "succeeded",
    source: { file_name: "lesson.pdf", mime_type: "application/pdf" },
    request: { title: "测试教材", document_type: "courseware" },
    progress: { total_pages: pageCount },
    result: {
      document_id: source.document.id,
      document_revision_id: source.document.revision_id,
      document_type: "courseware",
      page_count: pageCount,
    },
    document_ir: source.document,
    candidate_pack: { assets: source.assets, curriculum_standards: [] },
  };
  const importService = {
    async create() { throw new Error("not used"); },
    async get() { return importJob; },
    async list() { return { jobs: [importJob] }; },
    async getPageAsset(jobId, assetId) {
      const asset = source.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error("missing asset");
      const bytes = typeof sourceAssetBytes === "function"
        ? Buffer.from(sourceAssetBytes(asset))
        : Buffer.from(sourceAssetBytes || "fake-png-content");
      return { asset: { ...asset, size_bytes: bytes.length, sha256: "test" }, bytes };
    },
  };
  let embeddingCalls = 0;
  let structuredCalls = 0;
  let lastPages = [];
  const modelClient = {
    configSummary() { return { configured: true, textModel: "text-test", embeddingModel: "embedding-test" }; },
    async embedMultimodal() {
      embeddingCalls += 1;
      return { embedding: [1, embeddingCalls / 100], model: "embedding-test" };
    },
    async extractStructured({ input }) {
      structuredCalls += 1;
      const parsed = JSON.parse(input);
      lastPages = parsed.pages.map((page) => page.page_index);
      return {
        data: {
          title: "测试讲解",
          overview: "概述",
          learning_objectives: ["理解概念"],
          scenes: [{
            title: "镜头一",
            narration_text: "讲解内容",
            subtitle_text: "讲解内容",
            visual_type: "slide_explanation",
            visual_prompt: "展示教材图示",
            duration_seconds: 8,
            key_points: ["概念"],
            source_page_indexes: lastPages,
          }],
        },
        id: "response-test",
        requestId: "request-test",
        model: "text-test",
        status: "completed",
        usage: {},
      };
    },
  };
  let mediaCalls = 0;
  let capturedImageRequest = null;
  const mediaClient = {
    configSummary() {
      return {
        configured: true,
        seedream: { model: "doubao-seedream-5-0-260128" },
        seedance: { model: "doubao-seedance-2-5-260628" },
      };
    },
    async generateImage(input) {
      mediaCalls += 1;
      capturedImageRequest = input;
      if (generateImage) return generateImage(input);
      return { payload: { id: "image-1", data: [{ url: "https://media.volces.com/output.png" }] }, requestId: "image-request" };
    },
    async createVideoTask(input) {
      mediaCalls += 1;
      return createVideoTask ? createVideoTask(input) : { payload: { id: "provider-task", status: "queued" } };
    },
    async getVideoTask(taskId) {
      return getVideoTask ? getVideoTask(taskId) : { payload: { id: taskId, status: "running" } };
    },
    async deleteVideoTask(taskId) {
      return deleteVideoTask ? deleteVideoTask(taskId) : { payload: {} };
    },
  };
  let sequence = 0;
  const services = [];
  const validPng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("test-image"),
  ]);
  function createService(overrides = {}) {
    const instance = createEducationVideoService({
      repository,
      importService,
      educationModelClient: modelClient,
      mediaClient: overrides.mediaClient || mediaClient,
      tenantId: "tenant-test",
      storageDir: join(directory, "media"),
      env: {
        EDUCATION_VIDEO_FFMPEG_COMMAND: "/definitely/missing/ffmpeg",
        ...env,
        ...(overrides.env || {}),
      },
      fetchImpl: overrides.fetchImpl || fetchImpl || (async () => new Response(validPng, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(validPng.length) },
      })),
      idFactory: () => `id-${++sequence}`,
    });
    services.push(instance);
    return instance;
  }
  const service = createService();
  t.after(async () => {
    await Promise.all(services.map((instance) => instance.close()));
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    service,
    createService,
    repository,
    counters: {
      get embeddingCalls() { return embeddingCalls; },
      get structuredCalls() { return structuredCalls; },
      get mediaCalls() { return mediaCalls; },
      get lastPages() { return lastPages; },
      get capturedImageRequest() { return capturedImageRequest; },
    },
  };
}

test("import/project and storyboard do not create paid media tasks; custom range is one-based", async (t) => {
  const { service, repository, counters } = createFixture(t, { pageCount: 5 });
  await service.initialize();
  const project = await service.createProjectFromImport({ importId: "import-aaaaaaaa", settings: { page_range_mode: "custom", page_start: 2, page_end: 3 } });
  assert.equal(repository.listTasks({ tenantId: "tenant-test" }).length, 0);
  const output = await service.createStoryboard(project.project_id, { page_range_mode: "custom", page_start: 2, page_end: 3, target_scene_count: 1 });
  assert.deepEqual(counters.lastPages, [1, 2]);
  assert.equal(counters.embeddingCalls, 2);
  assert.equal(counters.mediaCalls, 0);
  assert.equal(output.latest_version.generation_settings.page_selection.start_page, 2);
});

test("all mode over 32 pages rejects instead of silently truncating", async (t) => {
  const { service, counters } = createFixture(t, { pageCount: 33 });
  await service.initialize();
  const project = await service.createProjectFromImport({ importId: "import-aaaaaaaa" });
  await assert.rejects(
    service.createStoryboard(project.project_id, { page_range_mode: "all", start_page_index: 0, end_page_index: null }),
    (error) => error instanceof EducationVideoServiceError && error.code === "video_page_range_required",
  );
  assert.equal(counters.structuredCalls, 0);
  assert.equal(counters.embeddingCalls, 0);
});

test("Seedream receives source page data URL but SQLite/API never expose base64 or signed URL", async (t) => {
  const { service, repository, counters } = createFixture(t, { pageCount: 1, withAssets: true });
  await service.initialize();
  const project = await service.createProjectFromImport({ importId: "import-aaaaaaaa" });
  const storyboard = await service.createStoryboard(project.project_id, { page_range_mode: "all" });
  const scene = storyboard.latest_version.scenes[0];
  const task = await service.generateSceneImage(project.project_id, scene.scene_id, {});
  assert.equal(counters.capturedImageRequest.images[0].startsWith("data:image/png;base64,"), true);
  const rawTask = repository.getTask({ tenantId: "tenant-test", taskId: task.task_id });
  assert.equal(JSON.stringify(rawTask.request).includes("ZmFrZS1wbmctY29udGVudA"), false);
  assert.equal(task.output_url.startsWith("/api/education/videos/assets/"), true);
  assert.equal(JSON.stringify(task).includes("media.volces.com"), false);
});

test("submission timeout becomes unknown and blocks a second paid request", async (t) => {
  const { service, repository, counters } = createFixture(t, {
    pageCount: 1,
    generateImage: async () => {
      throw new ArkMediaClientError("ark_media_timeout", "timeout", { status: 504, retryable: true });
    },
  });
  await service.initialize();
  const project = await service.createProjectFromImport({ importId: "import-aaaaaaaa" });
  const storyboard = await service.createStoryboard(project.project_id, { page_range_mode: "all" });
  const scene = storyboard.latest_version.scenes[0];
  await assert.rejects(service.generateSceneImage(project.project_id, scene.scene_id, {}));
  const task = repository.listTasks({ tenantId: "tenant-test", projectId: project.project_id })[0];
  assert.equal(task.submission_state, "unknown");
  await assert.rejects(
    service.generateSceneImage(project.project_id, scene.scene_id, {}),
    (error) => error instanceof EducationVideoServiceError && error.code === "video_generation_submission_unknown",
  );
  assert.equal(counters.mediaCalls, 1);
});

test("restart marks interrupted submission unknown, blocks duplicates, and accepts explicit reconciliation values", async (t) => {
  const { service, repository, counters } = createFixture(t, { pageCount: 1 });
  await service.initialize();
  const project = await service.createProjectFromImport({ importId: "import-aaaaaaaa" });
  const storyboard = await service.createStoryboard(project.project_id, { page_range_mode: "all" });
  const scene = storyboard.latest_version.scenes[0];
  const common = {
    project_id: project.project_id,
    version_id: storyboard.latest_version.version_id,
    scene_id: scene.scene_id,
    provider: "ark",
    model: "test-model",
    request: {},
  };
  repository.createTask({ tenantId: "tenant-test", task: {
    ...common,
    task_id: "video-task-interrupted-image",
    task_type: "seedream_image",
    status: "submitting",
    submission_state: "submitting",
  }});

  await service.initialize();
  const interrupted = repository.getTask({ tenantId: "tenant-test", taskId: "video-task-interrupted-image" });
  assert.equal(interrupted.status, "failed");
  assert.equal(interrupted.submission_state, "unknown");
  assert.equal(interrupted.error.reconciliation_required, true);
  await assert.rejects(
    service.generateSceneImage(project.project_id, scene.scene_id, {}),
    (error) => error instanceof EducationVideoServiceError && error.code === "video_generation_submission_unknown",
  );
  assert.equal(counters.mediaCalls, 0);

  const notCreated = await service.resolveUnknownSubmission(interrupted.task_id, {
    resolution: "provider_task_not_created",
    note: "已在 Ark 控制台确认未创建",
  });
  assert.equal(notCreated.submission_state, "confirmed");
  assert.equal(notCreated.error.code, "provider_task_confirmed_not_created");

  repository.createTask({ tenantId: "tenant-test", task: {
    ...common,
    task_id: "video-task-interrupted-video",
    task_type: "seedance_video",
    status: "failed",
    submission_state: "unknown",
  }});
  const created = await service.resolveUnknownSubmission("video-task-interrupted-video", {
    resolution: "provider_task_created",
    provider_task_id: "provider-reconciled-1",
    note: "已在 Ark 控制台找到任务",
  });
  assert.equal(created.status, "running");
  assert.equal(created.submission_state, "confirmed");
  assert.equal(created.provider_task_id, "provider-reconciled-1");
});

test("initialize resumes a provider-succeeded Seedream transfer", async (t) => {
  const { service, createService, repository } = createFixture(t, { pageCount: 1 });
  await service.initialize();
  const project = await service.createProjectFromImport({ importId: "import-aaaaaaaa" });
  const storyboard = await service.createStoryboard(project.project_id, { page_range_mode: "all" });
  const scene = storyboard.latest_version.scenes[0];
  repository.createTask({ tenantId: "tenant-test", task: {
    task_id: "video-task-transfer-recovery",
    project_id: project.project_id,
    version_id: storyboard.latest_version.version_id,
    scene_id: scene.scene_id,
    task_type: "seedream_image",
    provider: "ark",
    model: "seedream-test",
    status: "running",
    submission_state: "confirmed",
    output_url: "https://media.volces.com/recover.png",
    request: {},
    error: { code: "media_transfer_pending", provider_succeeded: true, transfer_recovery_required: true },
  }});
  repository.updateScene({ tenantId: "tenant-test", sceneId: scene.scene_id, patch: { status: "image_generating" } });
  await service.close();

  const restarted = createService();
  await restarted.initialize();
  await waitFor(() => repository.getTask({ tenantId: "tenant-test", taskId: "video-task-transfer-recovery" })?.status === "succeeded");
  const recovered = repository.getTask({ tenantId: "tenant-test", taskId: "video-task-transfer-recovery" });
  const recoveredScene = repository.getScene({ tenantId: "tenant-test", sceneId: scene.scene_id });
  assert.equal(recovered.status, "succeeded");
  assert.equal(recoveredScene.status, "image_ready");
  assert.ok(recoveredScene.image_output.asset_id);
});

test("cancelling during an in-flight poll stays cancelled and restores editable media state", async (t) => {
  let providerStartedResolve;
  let providerResultResolve;
  const providerStarted = new Promise((resolve) => { providerStartedResolve = resolve; });
  const providerResult = new Promise((resolve) => { providerResultResolve = resolve; });
  const { service, repository } = createFixture(t, {
    pageCount: 1,
    env: { EDUCATION_VIDEO_POLL_INTERVAL_MS: "60000" },
    getVideoTask: async () => {
      providerStartedResolve();
      return providerResult;
    },
  });
  await service.initialize();
  const project = await service.createProjectFromImport({ importId: "import-aaaaaaaa" });
  const storyboard = await service.createStoryboard(project.project_id, { page_range_mode: "all" });
  const scene = storyboard.latest_version.scenes[0];
  const task = await service.generateSceneVideo(project.project_id, scene.scene_id, {});
  const polling = service.pollTask(task.task_id);
  await providerStarted;
  const cancelled = await service.cancelTask(task.task_id);
  assert.equal(cancelled.status, "cancelled");
  providerResultResolve({
    payload: { id: "provider-task", status: "succeeded", content: { video_url: "https://media.volces.com/late.mp4" } },
  });
  const pollResult = await polling;

  assert.equal(pollResult.status, "cancelled");
  assert.equal(repository.getTask({ tenantId: "tenant-test", taskId: task.task_id }).status, "cancelled");
  assert.equal(repository.getScene({ tenantId: "tenant-test", sceneId: scene.scene_id }).status, "ready");
  assert.equal(repository.getProject({ tenantId: "tenant-test", projectId: project.project_id }).latest_version.status, "ready");
  assert.equal(repository.getProject({ tenantId: "tenant-test", projectId: project.project_id }).status, "ready");
  assert.equal(repository.listAssets({ tenantId: "tenant-test", projectId: project.project_id }).some((asset) => asset.asset_type === "video"), false);
});

test("provider image and video outputs with invalid file signatures are rejected", async (t) => {
  const invalidFetch = async () => new Response(Buffer.from("not-a-real-media-file"), {
    status: 200,
    headers: { "content-type": "image/png", "content-length": "21" },
  });
  const imageFixture = createFixture(t, { pageCount: 1, fetchImpl: invalidFetch });
  await imageFixture.service.initialize();
  const imageProject = await imageFixture.service.createProjectFromImport({ importId: "import-aaaaaaaa" });
  const imageStoryboard = await imageFixture.service.createStoryboard(imageProject.project_id, { page_range_mode: "all" });
  const imageScene = imageStoryboard.latest_version.scenes[0];
  await assert.rejects(
    imageFixture.service.generateSceneImage(imageProject.project_id, imageScene.scene_id, {}),
    (error) => error instanceof EducationVideoServiceError && error.code === "media_output_signature_invalid",
  );
  assert.equal(
    imageFixture.repository.listAssets({ tenantId: "tenant-test", projectId: imageProject.project_id }).some((asset) => asset.asset_type === "image"),
    false,
  );

  const videoFixture = createFixture(t, {
    pageCount: 1,
    env: { EDUCATION_VIDEO_POLL_INTERVAL_MS: "60000" },
    fetchImpl: invalidFetch,
    getVideoTask: async (taskId) => ({
      payload: { id: taskId, status: "succeeded", content: { video_url: "https://media.volces.com/output.mp4" } },
    }),
  });
  await videoFixture.service.initialize();
  const videoProject = await videoFixture.service.createProjectFromImport({ importId: "import-aaaaaaaa" });
  const videoStoryboard = await videoFixture.service.createStoryboard(videoProject.project_id, { page_range_mode: "all" });
  const videoScene = videoStoryboard.latest_version.scenes[0];
  const videoTask = await videoFixture.service.generateSceneVideo(videoProject.project_id, videoScene.scene_id, {});
  const polled = await videoFixture.service.pollTask(videoTask.task_id);
  assert.equal(polled.status, "running");
  assert.equal(polled.error.code, "media_output_signature_invalid");
  assert.equal(
    videoFixture.repository.listAssets({ tenantId: "tenant-test", projectId: videoProject.project_id }).some((asset) => asset.asset_type === "video"),
    false,
  );
});

test("local Seedream references enforce one-request total byte limit", async (t) => {
  const { service, counters } = createFixture(t, {
    pageCount: 2,
    withAssets: true,
    sourceAssetBytes: () => Buffer.alloc(700, 1),
    env: { EDUCATION_VIDEO_REFERENCE_IMAGE_BYTES: "1024" },
  });
  await service.initialize();
  const project = await service.createProjectFromImport({ importId: "import-aaaaaaaa" });
  const storyboard = await service.createStoryboard(project.project_id, { page_range_mode: "all" });
  const scene = storyboard.latest_version.scenes[0];
  await service.generateSceneImage(project.project_id, scene.scene_id, {});
  assert.equal(counters.capturedImageRequest.images.length, 1);
  assert.equal(counters.capturedImageRequest.reference_filter_receipt.local_total_bytes, 700);
  assert.equal(counters.capturedImageRequest.reference_filter_receipt.local_bytes_limit, 1024);
  assert.equal(counters.capturedImageRequest.reference_filter_receipt.rejected_by_total_bytes, 1);
});

async function waitFor(predicate, { timeoutMs = 2_000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  assert.fail("timed out waiting for condition");
}
