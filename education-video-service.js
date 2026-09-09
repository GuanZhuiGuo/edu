import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import ffmpegStaticPath from "ffmpeg-static";

import { ArkMediaClientError } from "./ark-media-client.js";
import { EducationVideoRepositoryError } from "./education-video-repository.js";

const execFileAsync = promisify(execFile);
const STORYBOARD_SCHEMA_VERSION = "education-video-storyboard@1.0";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_EMBEDDING_PAGES = 32;
const DEFAULT_EMBEDDING_PAGES = 24;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const DEFAULT_REFERENCE_IMAGE_BYTES = 32 * 1024 * 1024;
const ACTIVE_TASK_STATUSES = ["queued", "submitting", "running", "cancel_requested"];
const TERMINAL_PROVIDER_SUCCESS = new Set(["succeeded", "success", "completed", "done"]);
const TERMINAL_PROVIDER_FAILURE = new Set(["failed", "error", "cancelled", "canceled", "expired"]);

const STORYBOARD_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    overview: { type: "string" },
    learning_objectives: { type: "array", maxItems: 20, items: { type: "string" } },
    scenes: {
      type: "array",
      minItems: 1,
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          narration_text: { type: "string" },
          subtitle_text: { type: "string" },
          visual_type: {
            type: "string",
            enum: ["slide_explanation", "concept_map", "diagram", "worked_example", "comparison", "summary"],
          },
          visual_prompt: { type: "string" },
          duration_seconds: { type: "integer", minimum: 4, maximum: 30 },
          key_points: { type: "array", maxItems: 20, items: { type: "string" } },
          source_page_indexes: { type: "array", minItems: 1, maxItems: 16, items: { type: "integer", minimum: 0 } },
        },
        required: [
          "title", "narration_text", "subtitle_text", "visual_type", "visual_prompt",
          "duration_seconds", "key_points", "source_page_indexes",
        ],
      },
    },
  },
  required: ["title", "overview", "learning_objectives", "scenes"],
});

export class EducationVideoServiceError extends Error {
  constructor(code, message, { status = 500, retryable = false, cause, details } = {}) {
    super(message, { cause });
    this.name = "EducationVideoServiceError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function createEducationVideoService({
  repository,
  importService,
  educationModelClient,
  mediaClient,
  tenantId,
  storageDir = join(new URL(".", import.meta.url).pathname, "data", "education-video-media"),
  env = process.env,
  fetchImpl = globalThis.fetch,
  idFactory = randomUUID,
  clock = () => new Date().toISOString(),
} = {}) {
  assertMethod(repository, "createProject");
  assertMethod(importService, "create");
  assertMethod(educationModelClient, "extractStructured");
  assertMethod(educationModelClient, "embedMultimodal");
  assertMethod(mediaClient, "createVideoTask");
  const safeTenantId = requiredId(tenantId, "tenant_id");
  const mediaRoot = resolve(decodeURIComponent(storageDir));
  const pollIntervalMs = boundedInteger(env.EDUCATION_VIDEO_POLL_INTERVAL_MS ?? env.POLL_INTERVAL_MS, 1_000, 60_000, 5_000);
  const maxPollErrors = boundedInteger(env.EDUCATION_VIDEO_MAX_POLL_ERRORS ?? env.MAX_POLL_ERRORS, 1, 100, 12);
  const sofficeCommand = cleanText(env.EDUCATION_VIDEO_SOFFICE_COMMAND || env.SOFFICE_COMMAND, 2_000) || "soffice";
  const ffmpegCommand = cleanText(env.EDUCATION_VIDEO_FFMPEG_COMMAND || env.FFMPEG_COMMAND, 2_000)
    || cleanText(ffmpegStaticPath, 2_000)
    || "ffmpeg";
  const outputHosts = normalizeAllowedOutputHosts(env.ARK_MEDIA_OUTPUT_HOSTS);
  const referenceImageBytesLimit = boundedInteger(
    env.EDUCATION_VIDEO_REFERENCE_IMAGE_BYTES,
    1_024,
    128 * 1024 * 1024,
    DEFAULT_REFERENCE_IMAGE_BYTES,
  );
  const timers = new Map();
  const importTimers = new Map();
  let closed = false;
  let composerState = { status: "unknown", command: ffmpegCommand, checked_at: null };

  async function initialize() {
    await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
    composerState = await detectComposer(ffmpegCommand, clock);
    for (const task of repository.listTasks({ tenantId: safeTenantId, statuses: ACTIVE_TASK_STATUSES, limit: 500 })) {
      if (
        ["seedream_image", "seedance_video"].includes(task.task_type)
        && task.status === "submitting"
        && !task.provider_task_id
      ) {
        repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: {
          status: "failed",
          submission_state: "unknown",
          completed_at: clock(),
          next_poll_at: null,
          error: {
            code: "provider_submission_interrupted",
            message: "服务重启时上游提交结果不确定",
            reconciliation_required: true,
            requires_manual_confirmation: true,
          },
        }});
        continue;
      }
      if (
        task.task_type === "seedream_image"
        && task.status === "running"
        && task.submission_state === "confirmed"
        && task.output_url
      ) {
        schedulePoll(task.task_id, 100);
      } else if (task.task_type === "seedance_video" && task.provider_task_id && task.submission_state === "confirmed") {
        schedulePoll(task.task_id, 100);
      }
    }
    const importing = repository.listProjects({ tenantId: safeTenantId, status: "importing", limit: 200 }).projects;
    importing.forEach((project) => project.source_import_id && scheduleImportSync(project.project_id, 100));
    return configSummary();
  }

  function configSummary() {
    const media = mediaClient.configSummary();
    const model = educationModelClient.configSummary?.() || {};
    return {
      schema_version: "education-video-service-config@1.0",
      configured: Boolean(model.configured && media.configured),
      source_formats: ["pdf", "ppt", "pptx", "doc", "docx"],
      planning: {
        structured_model: model.textModel || null,
        embedding_model: model.embeddingModel || null,
        embedding_page_default: DEFAULT_EMBEDDING_PAGES,
        embedding_page_limit: MAX_EMBEDDING_PAGES,
      },
      seedream: media.seedream,
      seedance: media.seedance,
      composer: { ...composerState },
      credential_storage: "server_env_only",
      paid_generation_policy: "explicit_generate_route_only",
      reference_image_bytes_limit: referenceImageBytesLimit,
    };
  }

  async function getConfig() {
    const config = configSummary();
    const available = await importService.list({ status: "succeeded", limit: 200, offset: 0 });
    return {
      ...config,
      imports: (available.jobs || []).map((job) => ({
        import_id: job.id,
        title: cleanText(job.request?.title, 500) || titleFromFileName(job.source?.file_name || "教材"),
        file_name: cleanText(job.source?.file_name, 500),
        document_type: cleanText(job.result?.document_type, 120) || cleanText(job.request?.document_type, 120),
        page_count: Number(job.result?.page_count || job.progress?.total_pages || 0),
        status: job.status,
        completed_at: job.completed_at || null,
      })),
    };
  }

  function listProjects(input = {}) {
    return repository.listProjects({ tenantId: safeTenantId, ...input });
  }

  function loadProject(projectId) {
    const project = repository.getProject({ tenantId: safeTenantId, projectId });
    if (!project) throw notFound("video project");
    return project;
  }

  function getProject(projectId) {
    return projectPublicView(loadProject(projectId));
  }

  async function createProjectFromUpload({ file, fields = {}, actorId = "" } = {}) {
    const safeFile = normalizeUpload(file);
    const projectId = allocateId("video-project", idFactory);
    const title = cleanText(fields.title, 500) || titleFromFileName(safeFile.fileName);
    repository.createProject({
      tenantId: safeTenantId,
      project: {
        project_id: projectId,
        title,
        description: cleanText(fields.description, 4_000),
        status: "importing",
        source_file_name: safeFile.fileName,
        source_mime_type: safeFile.mimeType,
        audience: cleanText(fields.audience, 500),
        language: cleanText(fields.language, 40) || "zh-CN",
        aspect_ratio: fields.aspect_ratio || "16:9",
        visual_style: cleanText(fields.visual_style, 160) || "education-clean",
        presenter_mode: cleanText(fields.presenter_mode, 80) || "voice_over",
        voice_id: cleanText(fields.voice_id, 240),
        settings: {
          requested_duration_minutes: nullableNumber(fields.duration_minutes, 1, 240),
          subject: cleanText(fields.subject, 160),
          grade_band: cleanText(fields.grade_band, 160),
          course_type: cleanText(fields.course_type, 160),
          page_range_mode: cleanText(fields.page_range_mode, 80) || "auto",
          page_start: nullableNumber(fields.page_start, 0, 10_000),
          page_end: nullableNumber(fields.page_end, 0, 10_000),
          target_scene_count: nullableNumber(fields.target_scene_count, 1, 200),
          resolution: cleanText(fields.resolution, 80) || "1080p",
        },
        created_by: cleanText(actorId, 160),
      },
    });

    try {
      const source = await convertToPdfIfNeeded(safeFile, { sofficeCommand });
      const importJob = await importService.create({
        buffer: source.bytes,
        file_name: source.fileName,
        mime_type: "application/pdf",
        document_type: "courseware",
        title,
        language: cleanText(fields.language, 40) || "zh-CN",
        subject: cleanText(fields.subject, 160),
        grade_band: cleanText(fields.grade_band, 160),
      });
      repository.updateProject({
        tenantId: safeTenantId,
        projectId,
        patch: {
          source_import_id: importJob.id,
          settings: {
            ...loadProject(projectId).settings,
            conversion: source.conversion,
          },
        },
      });
      scheduleImportSync(projectId, 1_000);
      return getProject(projectId);
    } catch (error) {
      repository.updateProject({
        tenantId: safeTenantId,
        projectId,
        patch: { status: "failed", error: publicError(error) },
      });
      throw normalizeServiceError(error);
    }
  }

  async function createProjectFromImport({ importId, title = "", settings = {}, actorId = "" } = {}) {
    const job = await importService.get(requiredId(importId, "import_id"), { includeArtifacts: false });
    if (!job) throw notFound("education import");
    const projectId = allocateId("video-project", idFactory);
    repository.createProject({
      tenantId: safeTenantId,
      project: {
        project_id: projectId,
        title: cleanText(title, 500) || cleanText(job.request?.title, 500) || titleFromFileName(job.source?.file_name || "教材"),
        status: job.status === "succeeded" ? "source_ready" : job.status === "failed" ? "failed" : "importing",
        source_import_id: job.id,
        source_file_name: job.source?.file_name || "",
        source_mime_type: job.source?.mime_type || "",
        source_document_id: job.result?.document_id || null,
        source_document_revision_id: job.result?.document_revision_id || null,
        audience: cleanText(settings.audience, 500),
        language: cleanText(settings.language, 40) || "zh-CN",
        aspect_ratio: settings.aspect_ratio || "16:9",
        visual_style: cleanText(settings.visual_style, 160) || "education-clean",
        presenter_mode: cleanText(settings.presenter_mode, 80) || "voice_over",
        voice_id: cleanText(settings.voice_id, 240),
        settings,
        error: job.error || {},
        created_by: cleanText(actorId, 160),
      },
    });
    if (job.status !== "succeeded" && job.status !== "failed") scheduleImportSync(projectId, 1_000);
    return getProject(projectId);
  }

  async function syncImport(projectId, { includeArtifacts = false } = {}) {
    const project = loadProject(projectId);
    if (!project.source_import_id) return project;
    const job = await importService.get(project.source_import_id, { includeArtifacts });
    if (!job) {
      return repository.updateProject({ tenantId: safeTenantId, projectId, patch: {
        status: "failed", error: { code: "source_import_not_found", message: "关联的教材解析任务不存在" },
      }});
    }
    if (job.status === "succeeded") {
      repository.updateProject({ tenantId: safeTenantId, projectId, patch: {
        status: project.latest_version ? project.status : "source_ready",
        source_document_id: job.result?.document_id,
        source_document_revision_id: job.result?.document_revision_id,
        error: {},
      }});
    } else if (job.status === "failed") {
      repository.updateProject({ tenantId: safeTenantId, projectId, patch: {
        status: "failed", error: job.error || { code: "source_import_failed", message: "教材解析失败" },
      }});
    }
    return includeArtifacts ? { project: getProject(projectId), import_job: job } : getProject(projectId);
  }

  async function createStoryboard(projectId, input = {}) {
    const project = loadProject(projectId);
    if (!project.source_import_id) throw conflict("项目尚未关联教材导入任务", "video_source_missing");
    repository.updateProject({ tenantId: safeTenantId, projectId, patch: { status: "storyboarding", error: {} } });
    let job;
    try {
      job = await importService.get(project.source_import_id, { includeArtifacts: true });
      if (!job || job.status !== "succeeded" || !job.document_ir) {
        throw conflict("教材尚未解析完成", "video_source_not_ready");
      }
      const selection = selectPages(job.document_ir, input, project.settings || {});
      const pages = selection.pages;
      const segmentation = await buildSegmentationHints(pages, {
        modelClient: educationModelClient,
        signal: input.signal,
      });
      const planningInput = buildStoryboardInput({ project, document: job.document_ir, candidatePack: job.candidate_pack, pages, segmentation, input });
      const response = await educationModelClient.extractStructured({
        schema: STORYBOARD_SCHEMA,
        schemaName: "education_video_storyboard",
        strict: true,
        instructions: storyboardInstructions(project, input),
        input: planningInput,
        temperature: 0.2,
        maxOutputTokens: 32_000,
        signal: input.signal,
      });
      const storyboard = normalizeStoryboard(response.data, pages);
      const versionId = allocateId("video-version", idFactory);
      const sceneDrafts = storyboard.scenes.map((scene) => ({
        scene_id: allocateId("video-scene", idFactory),
        title: scene.title,
        narration_text: scene.narration_text,
        subtitle_text: scene.subtitle_text,
        visual_type: scene.visual_type,
        visual_prompt: scene.visual_prompt,
        duration_seconds: scene.duration_seconds,
        key_points: scene.key_points,
        source_refs: scene.source_page_indexes.map((pageIndex) => ({
          document_id: job.document_ir.id,
          document_revision_id: job.document_ir.revision_id,
          page_index: pageIndex,
        })),
        reference_assets: sourceAssetMetadata(job.candidate_pack, scene.source_page_indexes),
        status: "ready",
      }));
      repository.createVersionWithScenes({
        tenantId: safeTenantId,
        projectId,
        version: {
          version_id: versionId,
          status: "ready",
          title: storyboard.title,
          overview: storyboard.overview,
          learning_objectives: storyboard.learning_objectives,
          script: { schema_version: STORYBOARD_SCHEMA_VERSION, scenes: storyboard.scenes },
          subtitle: { format: "scene_text", language: project.language },
          generation_settings: {
            page_range: [pages[0].index, pages.at(-1).index],
            page_selection: selection.receipt,
            requested_duration_minutes: requestedDuration(input, project.settings),
            requested_scene_count: requestedSceneCount(input, project.settings),
            segmentation: segmentation.receipt,
            source_visual_grounding: "local_preview_archived; provider_generation_text_grounded_until_public_asset_transport",
          },
          model_receipt: {
            response_id: response.id || null,
            request_id: response.requestId || null,
            model: response.model || null,
            status: response.status || null,
            usage: response.usage || null,
            embedding_segmentation: segmentation.receipt,
          },
        },
        scenes: sceneDrafts,
      });
      const archiveReceipt = await archiveSceneSourcePages({
        importId: job.id,
        projectId,
        versionId,
        sceneDrafts,
        candidatePack: job.candidate_pack,
      });
      const latestProject = loadProject(projectId);
      const latestVersion = latestProject.versions.find((item) => item.version_id === versionId);
      repository.updateVersion({ tenantId: safeTenantId, versionId, patch: {
        generation_settings: {
          ...latestVersion.generation_settings,
          source_asset_archive: archiveReceipt,
        },
      }});
      return getProject(projectId);
    } catch (error) {
      repository.updateProject({ tenantId: safeTenantId, projectId, patch: { status: "source_ready", error: publicError(error) } });
      throw normalizeServiceError(error);
    }
  }

  function updateProject(projectId, patch) {
    loadProject(projectId);
    repository.updateProject({ tenantId: safeTenantId, projectId, patch: normalizeProjectPatch(patch) });
    return getProject(projectId);
  }

  function updateScene(projectId, sceneId, patch) {
    const scene = repository.getScene({ tenantId: safeTenantId, sceneId });
    if (!scene || scene.project_id !== projectId) throw notFound("video scene");
    return repository.updateScene({ tenantId: safeTenantId, sceneId, patch: normalizeScenePatch(patch) });
  }

  async function generateSceneImage(projectId, sceneId, input = {}) {
    const { project, scene } = requireScene(projectId, sceneId);
    assertNoUnsafeDuplicate(scene, "seedream_image");
    const references = await resolveSeedreamReferences(scene, input.reference_images);
    const prompt = cleanText(input.prompt, 120_000) || buildImagePrompt(project, scene);
    const request = {
      prompt,
      size: cleanText(input.size, 80) || ratioToImageSize(project.aspect_ratio),
      watermark: input.watermark === true,
      images: references.accepted.map((item) => item.url),
      reference_filter_receipt: references.receipt,
    };
    const task = createGenerationTask({ project, scene, type: "seedream_image", model: mediaClient.configSummary().seedream.model, request });
    repository.updateScene({ tenantId: safeTenantId, sceneId, patch: { status: "image_queued", error: {} } });
    repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: {
      status: "submitting", submission_state: "submitting", started_at: clock(), attempt_count: 1,
    }});
    let providerSucceeded = false;
    let providerOutput = null;
    try {
      const result = await mediaClient.generateImage(request);
      const output = extractMediaOutput(result.payload, "image");
      if (!output) throw new EducationVideoServiceError("seedream_output_missing", "Seedream 未返回可用图片", { status: 502 });
      providerSucceeded = true;
      providerOutput = output;
      repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: {
        status: "running", submission_state: "confirmed", response: sanitizeProviderPayload(result.payload),
        output_url: output.url || null,
        error: { code: "media_transfer_pending", message: "正在转存生成结果", provider_succeeded: true },
      }});
      const stored = await persistProviderOutput({ output, taskId: task.task_id, kind: "image" });
      const asset = repository.createAsset({ tenantId: safeTenantId, asset: {
        asset_id: allocateId("video-asset", idFactory), project_id: projectId,
        version_id: scene.version_id, scene_id: sceneId, asset_type: "image", provider: "ark",
        provider_ref: result.payload?.id || null, source_url: output.url || null,
        local_path: stored.relativePath, mime_type: stored.mimeType,
        metadata: { request_id: result.requestId, reference_filter_receipt: references.receipt },
      }});
      repository.updateScene({ tenantId: safeTenantId, sceneId, patch: {
        status: "image_ready", image_output: { asset_id: asset.asset_id, output_url: output.url || null, local_path: stored.relativePath }, error: {},
      }});
      repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: {
        status: "succeeded", submission_state: "confirmed", response: sanitizeProviderPayload(result.payload),
        output_url: output.url || null, local_output_path: stored.relativePath, completed_at: clock(), error: {},
      }});
      return getTask(task.task_id);
    } catch (error) {
      const normalized = normalizeServiceError(error);
      const uncertain = isSubmissionUncertain(error);
      repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: {
        status: providerSucceeded ? "running" : "failed",
        submission_state: providerSucceeded ? "confirmed" : uncertain ? "unknown" : "confirmed",
        output_url: providerOutput?.url || undefined,
        error: providerSucceeded
          ? { ...publicError(normalized), provider_succeeded: true, transfer_recovery_required: true }
          : { ...publicError(normalized), requires_manual_confirmation: uncertain },
        ...(providerSucceeded ? {} : { completed_at: clock() }),
      }});
      repository.updateScene({ tenantId: safeTenantId, sceneId, patch: {
        status: providerSucceeded ? "image_generating" : "failed",
        error: providerSucceeded
          ? { ...publicError(normalized), transfer_recovery_required: true }
          : publicError(normalized),
      }});
      throw normalized;
    }
  }

  async function retryTaskTransfer(taskId) {
    const task = repository.getTask({ tenantId: safeTenantId, taskId });
    if (!task) throw notFound("generation task");
    if (task.task_type !== "seedream_image" || task.submission_state !== "confirmed" || !task.output_url) {
      throw conflict("该任务没有可恢复转存的图片结果", "video_transfer_not_recoverable");
    }
    const scene = repository.getScene({ tenantId: safeTenantId, sceneId: task.scene_id });
    if (!scene) throw notFound("video scene");
    try {
      const stored = await persistProviderOutput({ output: { url: task.output_url }, taskId, kind: "image" });
      const current = repository.getTask({ tenantId: safeTenantId, taskId });
      if (!current || current.status !== "running") {
        await rm(resolveMediaPath(stored.relativePath), { force: true }).catch(() => {});
        return current ? getTask(taskId) : null;
      }
      const asset = repository.createAsset({ tenantId: safeTenantId, asset: {
        asset_id: allocateId("video-asset", idFactory), project_id: task.project_id,
        version_id: task.version_id, scene_id: task.scene_id, asset_type: "image", provider: "ark",
        provider_ref: task.provider_task_id, source_url: task.output_url,
        local_path: stored.relativePath, mime_type: stored.mimeType,
        metadata: { recovered_transfer: true },
      }});
      repository.updateScene({ tenantId: safeTenantId, sceneId: task.scene_id, patch: {
        status: "image_ready", image_output: { asset_id: asset.asset_id, output_url: task.output_url, local_path: stored.relativePath }, error: {},
      }});
      repository.updateTask({ tenantId: safeTenantId, taskId, patch: {
        status: "succeeded", local_output_path: stored.relativePath, error: {}, completed_at: clock(),
      }});
      return getTask(taskId);
    } catch (error) {
      const current = repository.getTask({ tenantId: safeTenantId, taskId });
      if (!current || ["cancel_requested", "cancelled"].includes(current.status)) {
        return current ? getTask(taskId) : null;
      }
      repository.updateTask({ tenantId: safeTenantId, taskId, patch: {
        status: "running", error: { ...publicError(error), provider_succeeded: true, transfer_recovery_required: true },
      }});
      throw normalizeServiceError(error);
    }
  }

  async function generateSceneVideo(projectId, sceneId, input = {}) {
    const { project, scene } = requireScene(projectId, sceneId);
    assertNoUnsafeDuplicate(scene, "seedance_video");
    const references = filterReferenceMedia(input, scene);
    const content = [{ type: "text", text: cleanText(input.prompt, 120_000) || buildVideoPrompt(project, scene) }];
    content.push(...references.content);
    const request = {
      content,
      generate_audio: input.generate_audio !== false && project.presenter_mode !== "none",
      ratio: input.ratio || project.aspect_ratio,
      resolution: cleanText(input.resolution, 20) || cleanText(project.settings?.resolution, 20) || "720p",
      duration: boundedInteger(input.duration ?? scene.duration_seconds, 4, 30, scene.duration_seconds),
      watermark: input.watermark === true,
      reference_filter_receipt: references.receipt,
    };
    const task = createGenerationTask({ project, scene, type: "seedance_video", model: mediaClient.configSummary().seedance.model, request });
    repository.updateScene({ tenantId: safeTenantId, sceneId, patch: { status: "video_queued", error: {} } });
    repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: {
      status: "submitting", submission_state: "submitting", started_at: clock(), attempt_count: 1,
    }});
    try {
      const result = await mediaClient.createVideoTask(request);
      const providerTaskId = extractProviderTaskId(result.payload);
      if (!providerTaskId) throw new EducationVideoServiceError("seedance_task_id_missing", "Seedance 未返回任务 ID", { status: 502 });
      repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: {
        provider_task_id: providerTaskId, submission_state: "confirmed", status: "running",
        response: sanitizeProviderPayload(result.payload), next_poll_at: new Date(Date.now() + pollIntervalMs).toISOString(), error: {},
      }});
      repository.updateScene({ tenantId: safeTenantId, sceneId, patch: { status: "video_generating" } });
      repository.updateProject({ tenantId: safeTenantId, projectId, patch: { status: "generating" } });
      schedulePoll(task.task_id, pollIntervalMs);
      return getTask(task.task_id);
    } catch (error) {
      const normalized = normalizeServiceError(error);
      const uncertain = isSubmissionUncertain(error);
      repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: {
        status: "failed", submission_state: uncertain ? "unknown" : "confirmed",
        error: { ...publicError(normalized), requires_manual_confirmation: uncertain }, completed_at: clock(),
      }});
      repository.updateScene({ tenantId: safeTenantId, sceneId, patch: { status: "failed", error: publicError(normalized) } });
      throw normalized;
    }
  }

  async function pollTask(taskId) {
    const task = repository.getTask({ tenantId: safeTenantId, taskId });
    if (!task) return null;
    if (
      task.task_type === "seedream_image"
      && task.status === "running"
      && task.submission_state === "confirmed"
      && task.output_url
      && (
        task.error?.transfer_recovery_required === true
        || task.error?.provider_succeeded === true
        || task.error?.code === "media_transfer_pending"
      )
    ) {
      return retryTaskTransfer(taskId);
    }
    if (task.task_type !== "seedance_video" || task.status !== "running") return taskPublicView(task, loadProject(task.project_id).assets);
    if (!task.provider_task_id || task.submission_state !== "confirmed") return task;
    try {
      const result = await mediaClient.getVideoTask(task.provider_task_id);
      const currentAfterProvider = repository.getTask({ tenantId: safeTenantId, taskId });
      if (!currentAfterProvider || currentAfterProvider.status !== "running") {
        return currentAfterProvider ? getTask(taskId) : null;
      }
      const providerStatus = extractProviderStatus(result.payload);
      if (TERMINAL_PROVIDER_SUCCESS.has(providerStatus)) {
        const output = extractMediaOutput(result.payload, "video");
        if (!output) throw new EducationVideoServiceError("seedance_output_missing", "Seedance 任务完成但未返回视频", { status: 502 });
        const stored = await persistProviderOutput({ output, taskId, kind: "video" });
        const currentAfterTransfer = repository.getTask({ tenantId: safeTenantId, taskId });
        if (!currentAfterTransfer || currentAfterTransfer.status !== "running") {
          await rm(resolveMediaPath(stored.relativePath), { force: true }).catch(() => {});
          return currentAfterTransfer ? getTask(taskId) : null;
        }
        const asset = repository.createAsset({ tenantId: safeTenantId, asset: {
          asset_id: allocateId("video-asset", idFactory), project_id: task.project_id,
          version_id: task.version_id, scene_id: task.scene_id, asset_type: "video", provider: "ark",
          provider_ref: task.provider_task_id, source_url: output.url || null,
          local_path: stored.relativePath, mime_type: stored.mimeType,
          metadata: { request_id: result.requestId },
        }});
        repository.updateTask({ tenantId: safeTenantId, taskId, patch: {
          status: "succeeded", response: sanitizeProviderPayload(result.payload), output_url: output.url || null,
          local_output_path: stored.relativePath, next_poll_at: null, completed_at: clock(), error: {},
        }});
        repository.updateScene({ tenantId: safeTenantId, sceneId: task.scene_id, patch: {
          status: "completed", video_output: { asset_id: asset.asset_id, output_url: output.url || null, local_path: stored.relativePath }, error: {},
        }});
        refreshProjectMediaStatus(task.project_id, task.version_id);
      } else if (TERMINAL_PROVIDER_FAILURE.has(providerStatus)) {
        repository.updateTask({ tenantId: safeTenantId, taskId, patch: {
          status: providerStatus.startsWith("cancel") ? "cancelled" : "failed",
          response: sanitizeProviderPayload(result.payload), next_poll_at: null,
          completed_at: clock(), error: providerErrorPayload(result.payload),
        }});
        repository.updateScene({ tenantId: safeTenantId, sceneId: task.scene_id, patch: {
          status: "failed", error: providerErrorPayload(result.payload),
        }});
        if (providerStatus.startsWith("cancel")) restoreEditableMediaState(task);
      } else {
        repository.updateTask({ tenantId: safeTenantId, taskId, patch: {
          status: "running", response: sanitizeProviderPayload(result.payload),
          attempt_count: task.attempt_count + 1, next_poll_at: new Date(Date.now() + pollIntervalMs).toISOString(),
        }});
        schedulePoll(taskId, pollIntervalMs);
      }
    } catch (error) {
      const current = repository.getTask({ tenantId: safeTenantId, taskId });
      if (!current || ["cancel_requested", "cancelled"].includes(current.status)) {
        return current ? getTask(taskId) : null;
      }
      const attempts = (current?.attempt_count || 0) + 1;
      const pauseAutomaticPolling = attempts >= maxPollErrors;
      repository.updateTask({ tenantId: safeTenantId, taskId, patch: {
        status: "running", attempt_count: attempts,
        next_poll_at: pauseAutomaticPolling ? null : new Date(Date.now() + pollIntervalMs * Math.min(attempts, 6)).toISOString(),
        error: {
          ...publicError(error),
          provider_submission_confirmed: true,
          reconciliation_required: pauseAutomaticPolling,
          automatic_polling_paused: pauseAutomaticPolling,
          can_resume_polling: true,
        },
      }});
      if (!pauseAutomaticPolling) schedulePoll(taskId, pollIntervalMs * Math.min(attempts, 6));
    }
    return getTask(taskId);
  }

  async function cancelTask(taskId) {
    const task = repository.getTask({ tenantId: safeTenantId, taskId });
    if (!task) throw notFound("generation task");
    if (["succeeded", "failed", "cancelled", "unavailable"].includes(task.status)) return getTask(taskId);
    repository.updateTask({ tenantId: safeTenantId, taskId, patch: { status: "cancel_requested" } });
    clearTaskTimer(taskId);
    if (task.task_type === "seedance_video" && task.provider_task_id && task.submission_state === "confirmed") {
      try {
        const result = await mediaClient.deleteVideoTask(task.provider_task_id);
        repository.updateTask({ tenantId: safeTenantId, taskId, patch: {
          status: "cancelled", response: sanitizeProviderPayload(result.payload), next_poll_at: null, completed_at: clock(), error: {},
        }});
        restoreEditableMediaState(task);
      } catch (error) {
        repository.updateTask({ tenantId: safeTenantId, taskId, patch: {
          status: "running",
          error: { ...publicError(error), cancel_not_confirmed: true, provider_submission_confirmed: true },
          next_poll_at: new Date(Date.now() + pollIntervalMs).toISOString(),
        }});
        schedulePoll(taskId, pollIntervalMs);
      }
    } else {
      repository.updateTask({ tenantId: safeTenantId, taskId, patch: { status: "cancelled", completed_at: clock(), next_poll_at: null } });
      restoreEditableMediaState(task);
    }
    return getTask(taskId);
  }

  async function resolveUnknownSubmission(taskId, input = {}) {
    const task = repository.getTask({ tenantId: safeTenantId, taskId });
    if (!task) throw notFound("generation task");
    if (task.submission_state !== "unknown") {
      throw conflict("该任务不在提交未知状态", "video_submission_not_unknown");
    }
    const resolution = cleanText(input.resolution, 80);
    const note = cleanText(input.note, 2_000);
    if (!note) throw invalid("人工确认必须填写备注");
    if (["not_created", "provider_task_not_created"].includes(resolution)) {
      repository.updateTask({ tenantId: safeTenantId, taskId, patch: {
        status: "failed",
        submission_state: "confirmed",
        completed_at: clock(),
        error: {
          code: "provider_task_confirmed_not_created",
          message: "已人工确认上游任务未创建",
          manual_resolution: true,
          note,
        },
      }});
      return getTask(taskId);
    }
    if (resolution === "provider_task_created" && task.task_type === "seedance_video") {
      const providerTaskId = cleanText(input.provider_task_id, 240);
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/u.test(providerTaskId)) {
        throw invalid("请提供已确认的 Seedance 任务 ID");
      }
      repository.updateTask({ tenantId: safeTenantId, taskId, patch: {
        status: "running",
        submission_state: "confirmed",
        provider_task_id: providerTaskId,
        next_poll_at: new Date(Date.now() + pollIntervalMs).toISOString(),
        error: { code: "provider_task_manually_reconciled", message: "已人工绑定上游任务", note },
      }});
      schedulePoll(taskId, 100);
      return getTask(taskId);
    }
    throw invalid("无效的提交状态确认结果");
  }

  async function composeProject(projectId, input = {}) {
    const project = loadProject(projectId);
    const version = findVersion(project, input.version_id) || project.latest_version;
    if (!version) throw conflict("请先生成讲稿与分镜", "video_storyboard_missing");
    if (composerState.status !== "available") {
      throw new EducationVideoServiceError(
        "video_composer_unavailable",
        "FFmpeg 不可用，已保留逐镜头视频",
        { status: 503 },
      );
    }
    const sceneVideos = version.scenes
      .sort((a, b) => a.scene_index - b.scene_index)
      .map((scene) => ({ scene, path: scene.video_output?.local_path }))
      .filter((entry) => entry.path);
    if (sceneVideos.length !== version.scenes.length) throw conflict("请先完成所有镜头的视频生成", "video_scenes_incomplete");
    const task = createGenerationTask({ project, scene: null, versionId: version.version_id, type: "compose_video", model: "ffmpeg", request: { mode: "scene_order" } });
    repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: {
      status: "running", submission_state: "confirmed", started_at: clock(), attempt_count: 1,
    }});
    repository.updateProject({ tenantId: safeTenantId, projectId, patch: { status: "composing" } });
    repository.updateVersion({ tenantId: safeTenantId, versionId: version.version_id, patch: { status: "composing" } });
    try {
      const outputDir = await taskOutputDir(task.task_id);
      const manifestPath = join(outputDir, "concat.txt");
      const absoluteInputs = sceneVideos.map(({ path }) => resolveMediaPath(path));
      await Promise.all(absoluteInputs.map((path) => access(path)));
      const manifest = absoluteInputs.map((path) => `file '${path.replace(/'/gu, "'\\''")}'`).join("\n");
      await writeFile(manifestPath, manifest, { mode: 0o600 });
      const joinedPath = join(outputDir, "joined.mp4");
      try {
        await execFileAsync(ffmpegCommand, ["-y", "-f", "concat", "-safe", "0", "-i", manifestPath, "-c", "copy", joinedPath], { timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 });
      } catch {
        await execFileAsync(ffmpegCommand, ["-y", "-f", "concat", "-safe", "0", "-i", manifestPath, "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", joinedPath], { timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 });
      }
      const subtitlesPath = join(outputDir, "subtitles.srt");
      await writeFile(subtitlesPath, buildSrt(version.scenes), { mode: 0o600 });
      const outputPath = join(outputDir, "lesson.mp4");
      await execFileAsync(ffmpegCommand, [
        "-y", "-i", joinedPath, "-i", subtitlesPath,
        "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text",
        "-metadata:s:s:0", `language=${project.language || "zh-CN"}`,
        "-movflags", "+faststart", outputPath,
      ], { timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 });
      const subtitleAsset = repository.createAsset({ tenantId: safeTenantId, asset: {
        asset_id: allocateId("video-asset", idFactory), project_id: projectId,
        version_id: version.version_id, asset_type: "subtitle", provider: "local_srt",
        local_path: relativeMediaPath(subtitlesPath), mime_type: "application/x-subrip",
        metadata: { scene_count: sceneVideos.length, timeline_source: "scene_duration_seconds" },
      }});
      const relativePath = relativeMediaPath(outputPath);
      const asset = repository.createAsset({ tenantId: safeTenantId, asset: {
        asset_id: allocateId("video-asset", idFactory), project_id: projectId,
        version_id: version.version_id, asset_type: "composed_video", provider: "local_ffmpeg",
        local_path: relativePath, mime_type: "video/mp4", metadata: {
          scene_count: sceneVideos.length,
          subtitle_asset_id: subtitleAsset.asset_id,
          subtitle_codec: "mov_text",
        },
      }});
      repository.updateVersion({ tenantId: safeTenantId, versionId: version.version_id, patch: {
        status: "completed", composed_output: {
          asset_id: asset.asset_id,
          local_path: relativePath,
          scene_count: sceneVideos.length,
          subtitle_asset_id: subtitleAsset.asset_id,
          subtitle_embedded: true,
          subtitle_codec: "mov_text",
        },
      }});
      repository.updateProject({ tenantId: safeTenantId, projectId, patch: { status: "completed", error: {} } });
      repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: {
        status: "succeeded", local_output_path: relativePath, completed_at: clock(), error: {},
      }});
      return getTask(task.task_id);
    } catch (error) {
      repository.updateTask({ tenantId: safeTenantId, taskId: task.task_id, patch: { status: "failed", error: publicError(error), completed_at: clock() } });
      repository.updateVersion({ tenantId: safeTenantId, versionId: version.version_id, patch: { status: "ready" } });
      repository.updateProject({ tenantId: safeTenantId, projectId, patch: { status: "ready", error: publicError(error) } });
      throw normalizeServiceError(error);
    }
  }

  function getTask(taskId) {
    const task = repository.getTask({ tenantId: safeTenantId, taskId });
    if (!task) throw notFound("generation task");
    const project = loadProject(task.project_id);
    return taskPublicView(task, project.assets);
  }

  function listTasks(input = {}) {
    const projects = new Map();
    const tasks = repository.listTasks({ tenantId: safeTenantId, ...input }).map((task) => {
      let project = projects.get(task.project_id);
      if (!project) {
        project = loadProject(task.project_id);
        projects.set(task.project_id, project);
      }
      return taskPublicView(task, project.assets);
    });
    return { schema_version: "education-video-task-list@1.0", tasks };
  }

  function getAsset(assetId) {
    const asset = repository.getAsset({ tenantId: safeTenantId, assetId });
    if (!asset?.local_path) throw notFound("video asset");
    return { asset, absolutePath: resolveMediaPath(asset.local_path) };
  }

  async function close() {
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    for (const timer of importTimers.values()) clearTimeout(timer);
    timers.clear();
    importTimers.clear();
  }

  function schedulePoll(taskId, delayMs) {
    if (closed || timers.has(taskId)) return;
    const timer = setTimeout(() => {
      timers.delete(taskId);
      void pollTask(taskId);
    }, Math.max(100, delayMs));
    timer.unref?.();
    timers.set(taskId, timer);
  }

  function clearTaskTimer(taskId) {
    const timer = timers.get(taskId);
    if (timer) clearTimeout(timer);
    timers.delete(taskId);
  }

  function scheduleImportSync(projectId, delayMs) {
    if (closed || importTimers.has(projectId)) return;
    const timer = setTimeout(async () => {
      importTimers.delete(projectId);
      try {
        const project = await syncImport(projectId);
        if (project.status === "importing") scheduleImportSync(projectId, 3_000);
      } catch {
        scheduleImportSync(projectId, 5_000);
      }
    }, Math.max(100, delayMs));
    timer.unref?.();
    importTimers.set(projectId, timer);
  }

  async function persistProviderOutput({ output, taskId, kind }) {
    const outputDir = await taskOutputDir(taskId);
    if (output.base64) {
      const temporaryPath = join(outputDir, `output-${randomUUID()}.partial`);
      const bytes = Buffer.from(output.base64, "base64");
      if (!bytes.length || bytes.length > MAX_DOWNLOAD_BYTES) throw invalid("provider output is too large");
      try {
        await writeFile(temporaryPath, bytes, { mode: 0o600 });
        const mimeType = await detectMediaMimeFromSignature(temporaryPath, kind);
        const finalPath = join(outputDir, `output${extensionForMime(mimeType, kind)}`);
        await rename(temporaryPath, finalPath);
        return { relativePath: relativeMediaPath(finalPath), mimeType };
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }
    }
    if (!output.url) throw new EducationVideoServiceError("media_output_missing", "生成结果没有可转存的地址", { status: 502 });
    const temporaryPath = join(outputDir, `output-${randomUUID()}.partial`);
    try {
      await downloadProviderOutput(output.url, temporaryPath, kind);
      const mimeType = await detectMediaMimeFromSignature(temporaryPath, kind);
      const finalPath = join(outputDir, `output${extensionForMime(mimeType, kind)}`);
      await rename(temporaryPath, finalPath);
      return { relativePath: relativeMediaPath(finalPath), mimeType };
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function downloadProviderOutput(initialUrl, targetPath, kind) {
    let currentUrl = initialUrl;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      assertProviderOutputUrl(currentUrl, outputHosts);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5 * 60_000);
      let response;
      try {
        response = await fetchImpl(currentUrl, { redirect: "manual", signal: controller.signal });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel?.().catch?.(() => {});
          clearTimeout(timeout);
          if (!location || redirectCount >= 5) {
            throw new EducationVideoServiceError("media_output_redirect_invalid", "生成结果跳转地址无效", { status: 502 });
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
        if (!response.ok || !response.body) {
          throw new EducationVideoServiceError("media_output_download_failed", "生成结果转存失败", { status: 502, retryable: true });
        }
        assertProviderOutputUrl(response.url || currentUrl, outputHosts);
        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength > MAX_DOWNLOAD_BYTES) throw invalid("provider output is too large");
        const mimeType = cleanText(response.headers.get("content-type"), 240)
          || (kind === "image" ? "image/png" : "video/mp4");
        let received = 0;
        const limiter = new Transform({
          transform(chunk, encoding, callback) {
            received += chunk.length;
            if (received > MAX_DOWNLOAD_BYTES) {
              callback(new EducationVideoServiceError("media_output_too_large", "生成结果超过转存大小限制", { status: 413 }));
              return;
            }
            callback(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(targetPath, { flags: "w", mode: 0o600 }));
        if (!received) throw new EducationVideoServiceError("media_output_empty", "生成结果为空", { status: 502 });
        clearTimeout(timeout);
        return { mimeType, sizeBytes: received };
      } catch (error) {
        clearTimeout(timeout);
        await rm(targetPath, { force: true }).catch(() => {});
        if (controller.signal.aborted) {
          throw new EducationVideoServiceError("media_output_download_timeout", "生成结果转存超时", { status: 504, retryable: true, cause: error });
        }
        throw error;
      }
    }
    throw new EducationVideoServiceError("media_output_redirect_invalid", "生成结果跳转次数过多", { status: 502 });
  }

  async function taskOutputDir(taskId) {
    const path = join(mediaRoot, requiredId(taskId, "task_id"));
    await mkdir(path, { recursive: true, mode: 0o700 });
    return path;
  }

  function relativeMediaPath(path) {
    const absolute = resolve(path);
    if (!absolute.startsWith(`${mediaRoot}${sep}`)) throw invalid("media path is outside storage root");
    return absolute.slice(mediaRoot.length + 1);
  }

  function resolveMediaPath(relativePath) {
    const absolute = resolve(mediaRoot, String(relativePath || ""));
    if (!absolute.startsWith(`${mediaRoot}${sep}`)) throw invalid("media path is outside storage root");
    return absolute;
  }

  function createGenerationTask({ project, scene, versionId = scene?.version_id, type, model, request }) {
    return repository.createTask({ tenantId: safeTenantId, task: {
      task_id: allocateId("video-task", idFactory), project_id: project.project_id,
      version_id: versionId, scene_id: scene?.scene_id || null, task_type: type,
      provider: type === "compose_video" ? "local" : "ark", model, status: "queued",
      submission_state: "not_submitted", request: sanitizeGenerationRequest(request), user_initiated: true,
    }});
  }

  function requireScene(projectId, sceneId) {
    const project = loadProject(projectId);
    const scene = repository.getScene({ tenantId: safeTenantId, sceneId });
    if (!scene || scene.project_id !== project.project_id) throw notFound("video scene");
    return { project, scene };
  }

  function assertNoUnsafeDuplicate(scene, taskType) {
    const conflicting = repository.listTasks({ tenantId: safeTenantId, projectId: scene.project_id, limit: 500 })
      .find((task) => task.scene_id === scene.scene_id && task.task_type === taskType && (
        ["queued", "submitting", "running", "cancel_requested"].includes(task.status)
        || task.submission_state === "unknown"
      ));
    if (!conflicting) return;
    if (conflicting.submission_state === "unknown") {
      throw new EducationVideoServiceError(
        "video_generation_submission_unknown",
        "上一次提交结果不确定，请先人工确认任务状态，不要重复生成",
        { status: 409, details: { task_id: conflicting.task_id, submission_state: "unknown" } },
      );
    }
    throw new EducationVideoServiceError(
      "video_generation_already_active",
      "该镜头已有生成任务进行中",
      { status: 409, details: { task_id: conflicting.task_id, status: conflicting.status } },
    );
  }

  async function resolveSeedreamReferences(scene, explicitReferences) {
    const explicit = filterReferenceImages(explicitReferences);
    const accepted = [...explicit.accepted];
    let localCandidateCount = 0;
    let localAcceptedCount = 0;
    let localTotalBytes = 0;
    let rejectedByTotalBytes = 0;
    for (const reference of scene.reference_assets || []) {
      if (accepted.length >= 8) break;
      if (!reference?.asset_id || accepted.some((item) => item.asset_id === reference.asset_id)) continue;
      localCandidateCount += 1;
      const asset = repository.getAsset({ tenantId: safeTenantId, assetId: reference.asset_id });
      if (!asset?.local_path || !["image/png", "image/jpeg", "image/webp"].includes(asset.mime_type)) continue;
      if (Number(reference.width) < 300 || Number(reference.height) < 300) continue;
      const localPath = resolveMediaPath(asset.local_path);
      const localStat = await stat(localPath);
      if (!localStat.isFile() || !localStat.size || localStat.size > 20 * 1024 * 1024) continue;
      if (localTotalBytes + localStat.size > referenceImageBytesLimit) {
        rejectedByTotalBytes += 1;
        continue;
      }
      const bytes = await readFile(localPath);
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) continue;
      if (localTotalBytes + bytes.length > referenceImageBytesLimit) {
        rejectedByTotalBytes += 1;
        continue;
      }
      accepted.push({
        asset_id: asset.asset_id,
        url: `data:${asset.mime_type};base64,${bytes.toString("base64")}`,
        width: Number(reference.width),
        height: Number(reference.height),
        mime_type: asset.mime_type,
        transport: "server_data_url",
      });
      localAcceptedCount += 1;
      localTotalBytes += bytes.length;
    }
    return {
      accepted,
      receipt: {
        ...explicit.receipt,
        local_candidate_count: localCandidateCount,
        local_accepted_count: localAcceptedCount,
        local_total_bytes: localTotalBytes,
        local_bytes_limit: referenceImageBytesLimit,
        rejected_by_total_bytes: rejectedByTotalBytes,
        accepted_count: accepted.length,
        provider_transport: localAcceptedCount ? "server_data_url" : explicit.accepted.length ? "https" : "none",
      },
    };
  }

  function refreshProjectMediaStatus(projectId, versionId) {
    const project = loadProject(projectId);
    const version = findVersion(project, versionId);
    if (!version) return;
    const complete = version.scenes.length > 0 && version.scenes.every((scene) => scene.status === "completed");
    repository.updateVersion({ tenantId: safeTenantId, versionId, patch: { status: complete ? "ready" : "generating" } });
    repository.updateProject({ tenantId: safeTenantId, projectId, patch: { status: complete ? "ready" : "generating" } });
  }

  function restoreEditableMediaState(task) {
    if (task.scene_id) {
      const scene = repository.getScene({ tenantId: safeTenantId, sceneId: task.scene_id });
      if (scene) {
        const status = scene.video_output?.asset_id
          ? "completed"
          : scene.image_output?.asset_id
            ? "image_ready"
            : "ready";
        repository.updateScene({ tenantId: safeTenantId, sceneId: task.scene_id, patch: { status, error: {} } });
      }
    }
    const active = repository.listTasks({
      tenantId: safeTenantId,
      projectId: task.project_id,
      statuses: ACTIVE_TASK_STATUSES,
      limit: 500,
    }).filter((candidate) => candidate.task_id !== task.task_id);
    const versionHasActiveTask = active.some((candidate) => candidate.version_id === task.version_id);
    repository.updateVersion({
      tenantId: safeTenantId,
      versionId: task.version_id,
      patch: { status: versionHasActiveTask ? "generating" : "ready" },
    });
    repository.updateProject({
      tenantId: safeTenantId,
      projectId: task.project_id,
      patch: { status: active.length ? "generating" : "ready", error: {} },
    });
  }

  async function archiveSceneSourcePages({ importId, projectId, versionId, sceneDrafts, candidatePack }) {
    const candidateAssets = Array.isArray(candidatePack?.assets) ? candidatePack.assets : [];
    if (typeof importService.getPageAsset !== "function" || !candidateAssets.length) {
      return { status: "unavailable", archived_count: 0, reason: "import_page_asset_reader_unavailable" };
    }
    const sourceDir = join(mediaRoot, "sources", requiredId(projectId, "project_id"), requiredId(versionId, "version_id"));
    await mkdir(sourceDir, { recursive: true, mode: 0o700 });
    const fileByCandidateId = new Map();
    let archivedCount = 0;
    let failedCount = 0;
    for (const scene of sceneDrafts) {
      const references = [];
      for (const metadata of scene.reference_assets) {
        try {
          let stored = fileByCandidateId.get(metadata.source_asset_id);
          if (!stored) {
            const source = await importService.getPageAsset(importId, metadata.source_asset_id);
            const extension = extensionForMime(source.asset.mime_type, "image");
            const path = join(sourceDir, `page-${String(source.asset.page_index + 1).padStart(4, "0")}-${source.asset.id.slice(-12)}${extension}`);
            await writeFile(path, source.bytes, { mode: 0o600 });
            stored = { relativePath: relativeMediaPath(path), source };
            fileByCandidateId.set(metadata.source_asset_id, stored);
          }
          const asset = repository.createAsset({ tenantId: safeTenantId, asset: {
            asset_id: allocateId("video-asset", idFactory), project_id: projectId,
            version_id: versionId, scene_id: scene.scene_id, asset_type: "source_page",
            provider: "education_import", provider_ref: metadata.source_asset_id,
            local_path: stored.relativePath, mime_type: stored.source.asset.mime_type,
            metadata: {
              page_index: stored.source.asset.page_index,
              width: stored.source.asset.width,
              height: stored.source.asset.height,
              source_document_asset_id: metadata.source_asset_id,
              transport: "local_preview_only",
            },
          }});
          references.push({
            asset_id: asset.asset_id,
            source_asset_id: metadata.source_asset_id,
            page_index: metadata.page_index,
            width: metadata.width,
            height: metadata.height,
            mime_type: metadata.mime_type,
            preview_url: `/api/education/videos/assets/${encodeURIComponent(asset.asset_id)}/content`,
            provider_transport: "local_preview_only",
          });
          archivedCount += 1;
        } catch {
          failedCount += 1;
        }
      }
      repository.updateScene({ tenantId: safeTenantId, sceneId: scene.scene_id, patch: { reference_assets: references } });
    }
    return {
      status: failedCount ? archivedCount ? "partial" : "failed" : "ready",
      archived_count: archivedCount,
      failed_count: failedCount,
      provider_transport: "local_preview_only",
      provider_generation_grounding: "text_grounded_until_public_asset_transport",
    };
  }

  return Object.freeze({
    initialize,
    configSummary,
    getConfig,
    listProjects,
    getProject,
    createProjectFromUpload,
    createProjectFromImport,
    syncImport,
    createStoryboard,
    updateProject,
    updateScene,
    generateSceneImage,
    generateSceneVideo,
    pollTask,
    cancelTask,
    resolveUnknownSubmission,
    retryTaskTransfer,
    composeProject,
    getTask,
    listTasks,
    getAsset,
    close,
  });
}

async function buildSegmentationHints(pages, { modelClient, signal }) {
  const texts = pages.map((page) => page.text.slice(0, 12_000));
  try {
    const embeddings = await mapConcurrent(texts, 4, async (text) => {
      const response = await modelClient.embedMultimodal({
        input: [{ type: "text", text: text || "空白课件页" }],
        encodingFormat: "float",
        signal,
      });
      if (!Array.isArray(response.embedding) || !response.embedding.every(Number.isFinite)) {
        throw new Error("invalid embedding");
      }
      return { vector: response.embedding, model: response.model || null, requestId: response.requestId || null };
    });
    const adjacent = [];
    for (let index = 1; index < embeddings.length; index += 1) {
      adjacent.push({
        after_page_index: pages[index - 1].index,
        before_page_index: pages[index].index,
        similarity: round(cosine(embeddings[index - 1].vector, embeddings[index].vector), 4),
      });
    }
    const scores = adjacent.map((item) => item.similarity).sort((a, b) => a - b);
    const threshold = scores.length ? Math.min(0.78, scores[Math.floor(scores.length * 0.35)]) : 0.7;
    const boundaries = adjacent.filter((item) => item.similarity <= threshold);
    return {
      boundaries,
      receipt: {
        mode: "embedding_adjacent_similarity",
        degraded: false,
        page_count: pages.length,
        model: embeddings.find((item) => item.model)?.model || null,
        threshold: round(threshold, 4),
        adjacent_similarities: adjacent,
        boundary_page_indexes: boundaries.map((item) => item.before_page_index),
      },
    };
  } catch (error) {
    const boundaries = pages.slice(1).filter((page, index) => page.headings.length > 0 || (index + 1) % 3 === 0)
      .map((page) => ({ before_page_index: page.index, reason: page.headings.length ? "heading" : "page_group" }));
    return {
      boundaries,
      receipt: {
        mode: "heading_and_page_grouping",
        degraded: true,
        degradation_code: "embedding_segmentation_unavailable",
        page_count: pages.length,
        boundary_page_indexes: boundaries.map((item) => item.before_page_index),
        error: { code: cleanText(error?.code, 160) || "embedding_failed", message: "Embedding 分段不可用，已按标题和页码分组" },
      },
    };
  }
}

function selectPages(document, input, projectSettings = {}) {
  const all = Array.isArray(document?.pages) ? document.pages : [];
  if (!all.length) throw conflict("教材没有可规划的页面", "video_source_pages_empty");
  const mode = cleanText(input.page_range_mode, 40) || cleanText(projectSettings.page_range_mode, 40) || "auto";
  const oneBasedStart = input.page_start ?? projectSettings.page_start;
  const oneBasedEnd = input.page_end ?? projectSettings.page_end;
  let start;
  let end;
  const hasLegacyStart = input.start_page_index !== undefined && input.start_page_index !== null && input.start_page_index !== "";
  const hasLegacyEnd = input.end_page_index !== undefined && input.end_page_index !== null && input.end_page_index !== "";
  if (mode === "all") {
    start = 0;
    end = all.length - 1;
  } else if (hasLegacyStart || hasLegacyEnd) {
    start = boundedInteger(input.start_page_index, 0, all.length - 1, 0);
    end = hasLegacyEnd
      ? boundedInteger(input.end_page_index, start, all.length - 1, start)
      : Math.min(all.length - 1, start + MAX_EMBEDDING_PAGES - 1);
  } else if (mode === "custom" || oneBasedStart != null || oneBasedEnd != null) {
    const startPage = boundedInteger(oneBasedStart, 1, all.length, 1);
    const endPage = boundedInteger(oneBasedEnd, startPage, all.length, startPage);
    start = startPage - 1;
    end = endPage - 1;
  } else {
    start = 0;
    end = all.length - 1;
  }
  const count = end - start + 1;
  if (count > MAX_EMBEDDING_PAGES) {
    throw new EducationVideoServiceError(
      "video_page_range_required",
      `一次最多规划 ${MAX_EMBEDDING_PAGES} 页，请选择具体页码范围`,
      { status: 422, details: { total_pages: all.length, selected_page_count: count, page_limit: MAX_EMBEDDING_PAGES } },
    );
  }
  const pages = all.slice(start, end + 1).map((page) => {
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    const textBlocks = blocks.filter((block) => typeof block?.text === "string" && block.text.trim());
    return {
      index: Number(page.index),
      text: textBlocks.map((block) => block.normalized_text || block.text).join("\n").slice(0, 40_000),
      headings: textBlocks.filter((block) => block.type === "heading").map((block) => block.text).slice(0, 12),
    };
  });
  return {
    pages,
    receipt: {
      mode,
      page_numbering: "one_based_api_zero_based_document_ir",
      start_page: start + 1,
      end_page: end + 1,
      selected_page_count: pages.length,
      page_limit: MAX_EMBEDDING_PAGES,
      truncated: false,
    },
  };
}

function buildStoryboardInput({ project, document, candidatePack, pages, segmentation, input }) {
  const knowledge = (candidatePack?.curriculum_standards || []).slice(0, 80).map((item) => item.name || item.title || item.description).filter(Boolean);
  const payload = {
    source: {
      title: document.title,
      document_type: document.document_type,
      subject: document.subject || "",
      grade_band: document.grade_band || "",
      selected_page_indexes: pages.map((page) => page.index),
    },
    teaching: {
      audience: cleanText(input.audience, 500) || project.audience,
      duration_minutes: nullableNumber(input.duration_minutes, 1, 240) || project.settings?.requested_duration_minutes || null,
      target_scene_count: requestedSceneCount(input, project.settings),
      language: project.language,
      visual_style: project.visual_style,
      presenter_mode: project.presenter_mode,
      focus: cleanText(input.focus, 2_000),
    },
    segmentation_hints: segmentation.receipt,
    known_curriculum_items: knowledge,
    pages: pages.map((page) => ({ page_index: page.index, headings: page.headings, excerpt: page.text.slice(0, 12_000) })),
  };
  return JSON.stringify(payload);
}

function storyboardInstructions(project, input) {
  return [
    "你是教育视频编导。仅使用输入教材中的可见事实，不得编造课标条款、公式、数据或页码。",
    "将连续内容组成可单独生成的 4–30 秒短镜头；先建立课程逻辑，再分镜。",
    "参考 embedding 相邻页分段提示，但标题结构和教学完整性优先。",
    "旁白要像真实教师讲解：先目标，再概念/步骤，必要时给例子，最后小结。字幕比旁白简短。",
    "visual_prompt 要描述可执行的教学画面，包含关键文字、图示、镜头运动和禁止事项，避免幻灯片堆字。",
    `输出语言：${project.language || "zh-CN"}。目标受众：${cleanText(input.audience, 500) || project.audience || "学生"}。`,
    `目标时长：${requestedDuration(input, project.settings) || "按内容合理设定"}分钟；目标镜头数：${requestedSceneCount(input, project.settings) || "按教学结构合理设定"}。`,
  ].join("\n");
}

function sourceAssetMetadata(candidatePack, pageIndexes) {
  const wanted = new Set(pageIndexes);
  return (Array.isArray(candidatePack?.assets) ? candidatePack.assets : [])
    .filter((asset) => wanted.has(Number(asset?.page_index)))
    .map((asset) => ({
      source_asset_id: cleanText(asset.id, 128),
      page_index: Number(asset.page_index),
      mime_type: cleanText(asset.mime_type, 120),
      width: Number(asset.width) || null,
      height: Number(asset.height) || null,
      provider_transport: "pending_local_archive",
    }))
    .filter((asset) => asset.source_asset_id);
}

function requestedDuration(input, settings = {}) {
  return nullableNumber(input.target_duration_minutes ?? input.duration_minutes, 1, 240)
    || nullableNumber(settings.requested_duration_minutes ?? settings.target_duration_minutes, 1, 240);
}

function requestedSceneCount(input, settings = {}) {
  return nullableNumber(input.target_scene_count, 1, 200)
    || nullableNumber(settings.target_scene_count, 1, 200);
}

function normalizeStoryboard(value, selectedPages) {
  if (!value || typeof value !== "object" || !Array.isArray(value.scenes) || !value.scenes.length) {
    throw new EducationVideoServiceError("video_storyboard_invalid", "模型未返回可用分镜", { status: 502 });
  }
  const allowedPages = new Set(selectedPages.map((page) => page.index));
  return {
    title: requiredText(value.title, "storyboard.title", 500),
    overview: cleanText(value.overview, 8_000),
    learning_objectives: stringList(value.learning_objectives, 20, 1_000),
    scenes: value.scenes.slice(0, 80).map((scene) => {
      const pageIndexes = [...new Set((scene.source_page_indexes || []).map(Number).filter((page) => allowedPages.has(page)))];
      if (!pageIndexes.length) throw new EducationVideoServiceError("video_storyboard_source_unbound", "分镜未绑定教材页", { status: 502 });
      return {
        title: requiredText(scene.title, "scene.title", 500),
        narration_text: requiredText(scene.narration_text, "scene.narration_text", 30_000),
        subtitle_text: cleanText(scene.subtitle_text, 30_000),
        visual_type: ["slide_explanation", "concept_map", "diagram", "worked_example", "comparison", "summary"].includes(scene.visual_type)
          ? scene.visual_type : "slide_explanation",
        visual_prompt: requiredText(scene.visual_prompt, "scene.visual_prompt", 30_000),
        duration_seconds: boundedInteger(scene.duration_seconds, 4, 30, 8),
        key_points: stringList(scene.key_points, 20, 1_000),
        source_page_indexes: pageIndexes,
      };
    }),
  };
}

async function convertToPdfIfNeeded(file, { sofficeCommand }) {
  if (file.extension === ".pdf") {
    if (file.bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw invalid("PDF file signature is invalid");
    return { bytes: file.bytes, fileName: file.fileName, conversion: { mode: "none", source_format: "pdf" } };
  }
  const isOoxml = [".pptx", ".docx"].includes(file.extension);
  const isLegacy = [".ppt", ".doc"].includes(file.extension);
  if (isOoxml && file.bytes.subarray(0, 2).toString("ascii") !== "PK") throw invalid("Office Open XML file signature is invalid");
  if (isLegacy && !file.bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) throw invalid("Legacy Office file signature is invalid");
  const temporaryDir = await mkdtemp(join(tmpdir(), "education-video-office-"));
  try {
    const inputPath = join(temporaryDir, `source${file.extension}`);
    await writeFile(inputPath, file.bytes, { mode: 0o600 });
    try {
      await execFileAsync(sofficeCommand, ["--headless", "--convert-to", "pdf", "--outdir", temporaryDir, inputPath], {
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (cause) {
      const unavailable = cause?.code === "ENOENT";
      throw new EducationVideoServiceError(
        unavailable ? "office_converter_unavailable" : "office_conversion_failed",
        unavailable ? "服务端未安装 LibreOffice，暂时无法转换该文件" : "Office 文件转 PDF 失败",
        { status: 503, cause },
      );
    }
    const outputName = (await readdir(temporaryDir)).find((name) => extname(name).toLowerCase() === ".pdf");
    if (!outputName) throw new EducationVideoServiceError("office_conversion_output_missing", "Office 转换未产生 PDF", { status: 502 });
    const bytes = await readFile(join(temporaryDir, outputName));
    if (!bytes.length || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new EducationVideoServiceError("office_conversion_output_invalid", "Office 转换结果无效", { status: 502 });
    return {
      bytes,
      fileName: `${basename(file.fileName, file.extension)}.pdf`,
      conversion: { mode: "libreoffice_to_pdf", source_format: file.extension.slice(1), converter: "soffice" },
    };
  } finally {
    await rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
  }
}

function normalizeUpload(file) {
  const bytes = Buffer.isBuffer(file?.bytes) ? file.bytes : Buffer.from(file?.bytes || []);
  if (!bytes.length) throw invalid("请上传教材文件");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new EducationVideoServiceError("video_source_too_large", `文件不能超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`, { status: 413 });
  const fileName = sanitizeFileName(file.fileName || "source.pdf");
  const extension = extname(fileName).toLowerCase();
  if (![".pdf", ".ppt", ".pptx", ".doc", ".docx"].includes(extension)) throw new EducationVideoServiceError("video_source_type_unsupported", "仅支持 PDF、PPT、PPTX、DOC 和 DOCX", { status: 415 });
  return { bytes, fileName, extension, mimeType: cleanText(file.mimeType, 240) || mimeForExtension(extension) };
}

function filterReferenceImages(value) {
  const candidates = Array.isArray(value) ? value : [];
  const accepted = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeReferenceImage(candidate);
    if (!normalized || seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    if (accepted.length < 8) accepted.push(normalized);
  }
  return {
    accepted,
    receipt: {
      candidate_count: candidates.length,
      deduplicated_count: seen.size,
      accepted_count: accepted.length,
      rejected_count: candidates.length - accepted.length,
      rules: ["png_jpeg_webp", "minimum_dimension_300", "maximum_8", "https_only"],
    },
  };
}

function normalizeReferenceImage(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const url = normalizeHttpsUrl(candidate.url);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  const mime = cleanText(candidate.mime_type || candidate.mimeType, 120).toLowerCase();
  if (!url || !Number.isFinite(width) || !Number.isFinite(height) || width < 300 || height < 300) return null;
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) return null;
  return { url, width, height, mime_type: mime };
}

function filterReferenceMedia(input, scene) {
  const images = filterReferenceImages(input.reference_images || scene.reference_assets);
  const content = images.accepted.map((item) => ({ type: "image_url", image_url: { url: item.url }, role: "reference_image" }));
  for (const entry of [
    ["reference_video_url", "video_url", "reference_video"],
    ["reference_audio_url", "audio_url", "reference_audio"],
  ]) {
    const url = normalizeHttpsUrl(input[entry[0]]);
    if (url) content.push({ type: entry[1], [entry[1]]: { url }, role: entry[2] });
  }
  if (!images.accepted.length && scene.image_output?.output_url) {
    const url = normalizeHttpsUrl(scene.image_output.output_url);
    if (url) content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
  }
  return { content, receipt: { ...images.receipt, total_reference_media: content.length } };
}

function buildImagePrompt(project, scene) {
  return [
    `为教育讲解视频生成一幅 ${project.aspect_ratio} 教学画面。`,
    `视觉风格：${project.visual_style}。`,
    `镜头主题：${scene.title}。`,
    `画面要求：${scene.visual_prompt}。`,
    `必须支持的讲解要点：${scene.key_points.join("、")}。`,
    "不生成与教材无关的事实；避免密集小字、水印、品牌标识和无意义装饰。",
  ].join("\n");
}

function buildVideoPrompt(project, scene) {
  const presenterDirective = project.presenter_mode === "digital_teacher"
    ? `画面中包含稳定的数字教师形象，讲解音色标识为 ${project.voice_id || "系统默认教师音色"}。`
    : project.presenter_mode === "none"
      ? "画面不出现教师人物，不生成旁白，仅保留教学画面与字幕。"
      : `画面以教学内容为主，使用画外教师旁白，音色标识为 ${project.voice_id || "系统默认教师音色"}。`;
  return [
    `创作一个 ${scene.duration_seconds} 秒的 ${project.aspect_ratio} 教育讲解镜头。`,
    `镜头：${scene.title}。画面：${scene.visual_prompt}。`,
    `旁白：${scene.narration_text}`,
    `字幕：${scene.subtitle_text}`,
    `风格：${project.visual_style}；保持教学图示准确、运镜克制、文字清晰。`,
    `出镜方式：${project.presenter_mode}。${presenterDirective}`,
    "不添加教材外的结论，不生成水印或品牌标识。",
  ].join("\n");
}

function extractProviderTaskId(payload) {
  const candidates = [payload?.id, payload?.task_id, payload?.task?.id, payload?.data?.id, payload?.data?.task_id];
  return candidates.map((item) => cleanText(item, 240)).find(Boolean) || null;
}

function extractProviderStatus(payload) {
  const status = payload?.status || payload?.task?.status || payload?.data?.status || payload?.state;
  return cleanText(status, 120).toLowerCase() || "running";
}

function extractMediaOutput(payload, kind) {
  const urls = [];
  let base64 = null;
  walkObject(payload, (key, value) => {
    if (typeof value !== "string") return;
    if (["url", "video_url", "image_url", "output_url", "file_url"].includes(key) && /^https:\/\//u.test(value)) urls.push(value);
    if (!base64 && ["b64_json", "base64"].includes(key) && /^[A-Za-z0-9+/=\r\n]+$/u.test(value)) base64 = value.replace(/\s+/gu, "");
  });
  const matcher = kind === "video" ? /(?:\.mp4|video|output)/iu : /(?:\.png|\.jpe?g|\.webp|image|output)/iu;
  const url = urls.find((item) => matcher.test(item)) || urls[0] || null;
  return url || base64 ? { url, base64 } : null;
}

function walkObject(value, visitor, depth = 0) {
  if (depth > 8 || value == null) return;
  if (Array.isArray(value)) return value.slice(0, 200).forEach((item) => walkObject(item, visitor, depth + 1));
  if (typeof value !== "object") return;
  Object.entries(value).slice(0, 300).forEach(([key, item]) => {
    visitor(key, item);
    walkObject(item, visitor, depth + 1);
  });
}

function sanitizeGenerationRequest(request) {
  const clone = JSON.parse(JSON.stringify(request || {}));
  if (Array.isArray(clone.content)) {
    clone.content = clone.content.map((item) => {
      if (item.type === "audio_url" || item.type === "video_url" || item.type === "image_url") {
        return { ...item, [item.type]: { url: redactSignedUrl(item[item.type]?.url) } };
      }
      return item;
    });
  }
  if (Array.isArray(clone.images)) {
    clone.images = clone.images.map((value) => String(value || "").startsWith("data:")
      ? "[server-local-image-redacted]"
      : redactSignedUrl(value));
  }
  return clone;
}

function sanitizeProviderPayload(payload) {
  const clone = JSON.parse(JSON.stringify(payload || {}));
  walkMutate(clone, (key, value) => {
    if (["b64_json", "base64"].includes(key) && typeof value === "string") return "[binary-redacted]";
    if (typeof value === "string" && /url$/iu.test(key) && /^https:\/\//u.test(value)) return "[provider-url-redacted]";
    return value;
  });
  return clone;
}

function walkMutate(value, mapper, depth = 0) {
  if (depth > 8 || value == null || typeof value !== "object") return;
  if (Array.isArray(value)) return value.slice(0, 500).forEach((item) => walkMutate(item, mapper, depth + 1));
  for (const key of Object.keys(value).slice(0, 500)) {
    value[key] = mapper(key, value[key]);
    walkMutate(value[key], mapper, depth + 1);
  }
}

function redactSignedUrl(value) {
  if (typeof value === "string" && value.startsWith("data:")) {
    const mime = value.match(/^data:([^;,]+)/u)?.[1] || "application/octet-stream";
    return `data:${mime};base64,[redacted]`;
  }
  try {
    const url = new URL(value);
    if (url.search) url.search = "?redacted=1";
    return url.toString();
  } catch { return "[invalid-url]"; }
}

function providerErrorPayload(payload) {
  return {
    code: cleanText(payload?.error?.code || payload?.code, 160) || "provider_task_failed",
    message: cleanText(payload?.error?.message || payload?.message, 1_000) || "媒体生成任务失败",
  };
}

function isSubmissionUncertain(error) {
  return error instanceof ArkMediaClientError && ["ark_media_timeout", "ark_media_network_error"].includes(error.code);
}

function normalizeServiceError(error) {
  if (error instanceof EducationVideoServiceError) return error;
  if (error instanceof EducationVideoRepositoryError || error instanceof ArkMediaClientError) {
    return new EducationVideoServiceError(error.code, error.message, { status: error.status, retryable: error.retryable, cause: error });
  }
  return new EducationVideoServiceError("education_video_internal_error", "视频讲解处理失败", { status: 500, cause: error });
}

function projectPublicView(project) {
  const clone = JSON.parse(JSON.stringify(project));
  const assets = Array.isArray(clone.assets) ? clone.assets : [];
  const assetById = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const contentUrl = (assetId) => assetById.has(assetId)
    ? `/api/education/videos/assets/${encodeURIComponent(assetId)}/content`
    : null;
  clone.assets = assets.map((asset) => ({
    ...asset,
    source_url: undefined,
    local_path: undefined,
    content_url: asset.local_path ? contentUrl(asset.asset_id) : null,
  }));
  clone.versions = (clone.versions || []).map((version) => ({
    ...version,
    composed_output: projectOutputView(version.composed_output, contentUrl),
    scenes: (version.scenes || []).map((scene) => ({
      ...scene,
      image_output: projectOutputView(scene.image_output, contentUrl),
      video_output: projectOutputView(scene.video_output, contentUrl),
    })),
  }));
  clone.latest_version = clone.versions[0] || null;
  clone.tasks = (clone.tasks || []).map((task) => taskPublicView(task, assets));
  return clone;
}

function projectOutputView(output, contentUrl) {
  if (!output || typeof output !== "object") return {};
  const localUrl = output.asset_id ? contentUrl(output.asset_id) : null;
  return {
    ...output,
    output_url: localUrl,
    content_url: localUrl,
    local_path: undefined,
    provider_output_archived: Boolean(localUrl),
  };
}

function taskPublicView(task, assets = []) {
  const matchingAsset = task.local_output_path
    ? assets.find((asset) => asset.local_path === task.local_output_path)
    : null;
  const contentUrl = matchingAsset
    ? `/api/education/videos/assets/${encodeURIComponent(matchingAsset.asset_id)}/content`
    : null;
  return {
    ...task,
    output_url: contentUrl,
    content_url: contentUrl,
    local_output_path: undefined,
    provider_output_archived: Boolean(contentUrl),
  };
}

function publicError(error) {
  const normalized = normalizeServiceError(error);
  return { code: normalized.code, message: normalized.message, retryable: normalized.retryable === true };
}

function normalizeProjectPatch(patch = {}) {
  const allowed = ["title", "description", "audience", "language", "aspect_ratio", "visual_style", "presenter_mode", "voice_id", "settings"];
  return Object.fromEntries(allowed.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]));
}

function normalizeScenePatch(patch = {}) {
  const allowed = ["title", "narration_text", "subtitle_text", "visual_type", "visual_prompt", "duration_seconds", "key_points", "reference_assets"];
  return Object.fromEntries(allowed.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]]));
}

async function detectComposer(command, clock) {
  try {
    await execFileAsync(command, ["-version"], { timeout: 5_000, maxBuffer: 256 * 1024 });
    return { status: "available", adapter: "ffmpeg_concat", command: basename(command), checked_at: clock() };
  } catch {
    return { status: "unavailable", adapter: "ffmpeg_concat", command: basename(command), checked_at: clock(), reason: "command_not_available" };
  }
}

function normalizeAllowedOutputHosts(value) {
  const configured = cleanText(value, 4_000).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return configured.length ? configured : ["volces.com", "ivolces.com", "volccdn.com"];
}

function assertProviderOutputUrl(value, allowedHosts) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw invalid("provider output URL is invalid");
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw new EducationVideoServiceError("media_output_host_forbidden", "生成结果地址不在允许的媒体域名内", { status: 502 });
  }
}

function extensionForMime(mime, kind) {
  const type = mime.split(";")[0].trim().toLowerCase();
  return ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4" })[type]
    || (kind === "image" ? ".png" : ".mp4");
}

async function detectMediaMimeFromSignature(path, kind) {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    let mimeType = null;
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      mimeType = "image/png";
    } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      mimeType = "image/jpeg";
    } else if (
      bytes.length >= 12
      && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      mimeType = "image/webp";
    } else if (bytes.length >= 8 && bytes.subarray(0, Math.min(bytes.length, 32)).indexOf(Buffer.from("ftyp", "ascii")) >= 4) {
      mimeType = "video/mp4";
    }
    const valid = kind === "image" ? mimeType?.startsWith("image/") : mimeType === "video/mp4";
    if (!valid) {
      throw new EducationVideoServiceError(
        "media_output_signature_invalid",
        "生成结果的媒体文件签名无效",
        { status: 502 },
      );
    }
    return mimeType;
  } finally {
    await handle.close();
  }
}

function ratioToImageSize(ratio) {
  return ({ "16:9": "2560x1440", "9:16": "1440x2560", "1:1": "2048x2048", "4:3": "2048x1536", "3:4": "1536x2048", "21:9": "2560x1080" })[ratio] || "2560x1440";
}

function buildSrt(scenes) {
  let cursorMs = 0;
  return [...scenes]
    .sort((left, right) => left.scene_index - right.scene_index)
    .map((scene, index) => {
      const start = cursorMs;
      cursorMs += boundedInteger(scene.duration_seconds, 4, 30, 8) * 1_000;
      const text = (cleanText(scene.subtitle_text, 30_000) || cleanText(scene.narration_text, 30_000))
        .replace(/\r\n?/gu, "\n")
        .replace(/\n{3,}/gu, "\n\n");
      return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(cursorMs)}\n${text}\n`;
    })
    .join("\n");
}

function formatSrtTime(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function findVersion(project, versionId) {
  return versionId ? project.versions.find((item) => item.version_id === versionId) : null;
}

function normalizeHttpsUrl(value) {
  try {
    const url = new URL(cleanText(value, 16_000));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function normalizeRatio(value) {
  return ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(value) ? value : "16:9";
}

function normalizeTaskRatio(value) { return normalizeRatio(value); }

function mimeForExtension(extension) {
  return ({ ".pdf": "application/pdf", ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })[extension] || "application/octet-stream";
}

function titleFromFileName(fileName) { return basename(fileName, extname(fileName)).replace(/[_-]+/gu, " ").trim() || "教材讲解"; }
function sanitizeFileName(value) { return basename(String(value || "source.pdf")).replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 240) || "source.pdf"; }
function allocateId(prefix, idFactory) { return `${prefix}-${String(idFactory()).toLowerCase()}`; }
function requiredId(value, field) {
  const id = cleanText(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(id)) throw invalid(`${field} is invalid`);
  return id;
}
function requiredText(value, field, max) { const text = cleanText(value, max); if (!text) throw invalid(`${field} is required`); return text; }
function cleanText(value, max) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function boundedInteger(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw invalid(`integer must be between ${min} and ${max}`);
  return number;
}
function nullableNumber(value, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
function stringList(value, maxItems, maxLength) { return Array.isArray(value) ? value.slice(0, maxItems).map((item) => cleanText(item, maxLength)).filter(Boolean) : []; }
function round(value, digits) { return Number(value.toFixed(digits)); }
function cosine(left, right) {
  if (!Array.isArray(left) || left.length !== right.length || !left.length) return 0;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) { dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2; }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}
async function mapConcurrent(items, concurrency, mapper) {
  const output = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor; cursor += 1; output[index] = await mapper(items[index], index); }
  }));
  return output;
}
function assertMethod(value, name) { if (!value || typeof value[name] !== "function") throw new TypeError(`${name} is required`); }
function invalid(message) { return new EducationVideoServiceError("education_video_invalid_input", message, { status: 400 }); }
function conflict(message, code) { return new EducationVideoServiceError(code, message, { status: 409 }); }
function notFound(resource) { return new EducationVideoServiceError("education_video_not_found", `${resource} 不存在`, { status: 404 }); }
