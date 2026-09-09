const API_ROOT = "/api/education/videos";
const LEGACY_API_ROOT = "/api/education/video-explanations";

const TERMINAL_TASK_STATES = new Set(["completed", "succeeded", "success", "failed", "error", "cancelled", "canceled"]);
const ACTIVE_TASK_STATES = new Set(["queued", "pending", "submitting", "running", "processing", "generating", "composing", "cancel_requested"]);

const DEFAULT_OPTIONS = Object.freeze({
  courseTypes: [
    { value: "lesson", label: "同步课讲解" },
    { value: "concept", label: "知识点精讲" },
    { value: "paper_review", label: "试卷讲评" },
    { value: "review", label: "复习导学" }
  ],
  audiences: [
    { value: "junior", label: "初中" },
    { value: "senior", label: "高中" },
    { value: "college", label: "大学" },
    { value: "professional", label: "职业考试" }
  ],
  languages: [
    { value: "zh-CN", label: "简体中文" },
    { value: "en", label: "英语" },
    { value: "bilingual", label: "中英双语" }
  ],
  ratios: [
    { value: "16:9", label: "横屏 16:9" },
    { value: "9:16", label: "竖屏 9:16" },
    { value: "1:1", label: "方形 1:1" }
  ],
  durations: [
    { value: "3", label: "约 3 分钟" },
    { value: "5", label: "约 5 分钟" },
    { value: "8", label: "约 8 分钟" },
    { value: "12", label: "约 12 分钟" }
  ],
  presenters: [
    { value: "narration", label: "仅旁白" },
    { value: "digital_teacher", label: "数字教师" },
    { value: "none", label: "无人声" }
  ],
  voices: [
    { value: "teacher_male", label: "大学讲师男" },
    { value: "teacher_female", label: "温暖教师女" },
    { value: "youth_female", label: "清晰青年女" }
  ],
  styles: [
    { value: "classroom_light", label: "明亮课堂" },
    { value: "academic_blue", label: "学术蓝" },
    { value: "paper_notes", label: "纸张笔记" },
    { value: "science_dark", label: "深色理科" }
  ],
  resolutions: [
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" }
  ]
});

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function number(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, number(value)));
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) return payload.data;
  if (payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)) return payload.result;
  return payload;
}

function firstArray(source, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((cursor, part) => cursor?.[part], source);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function optionList(source, keys, fallback) {
  const values = firstArray(source, keys);
  if (!values.length) return fallback;
  const normalized = values.map((item) => {
    if (typeof item === "string" || typeof item === "number") {
      return { value: String(item), label: String(item) };
    }
    const value = item?.value ?? item?.id ?? item?.code ?? item?.key ?? item?.name;
    const label = item?.label ?? item?.name ?? item?.title ?? value;
    return value == null ? null : { value: String(value), label: String(label) };
  }).filter(Boolean);
  return normalized.length ? normalized : fallback;
}

function normalizeStatus(value, fallback = "draft") {
  return text(value, fallback).toLowerCase().replaceAll("-", "_");
}

function normalizeTask(raw = {}) {
  const source = unwrapPayload(raw) || {};
  const rawError = source.error && typeof source.error === "object" ? source.error : {};
  const progressValue = source.progress_percent ?? source.progress ?? source.percent ?? source.percentage ?? 0;
  const normalizedProgress = number(progressValue) <= 1 ? number(progressValue) * 100 : number(progressValue);
  return {
    id: text(source.id ?? source.task_id ?? source.taskId ?? source.job_id ?? source.jobId),
    projectId: text(source.project_id ?? source.projectId),
    sceneId: text(source.scene_id ?? source.sceneId ?? source.shot_id ?? source.shotId),
    kind: text(source.kind ?? source.type ?? source.task_type ?? source.taskType, "generation"),
    provider: text(source.provider),
    providerTaskId: text(source.provider_task_id ?? source.providerTaskId),
    submissionState: normalizeStatus(source.submission_state ?? source.submissionState, "not_submitted"),
    status: normalizeStatus(source.status ?? source.state, "queued"),
    progress: clamp(normalizedProgress),
    message: text(source.message ?? source.detail ?? source.stage ?? source.status_text),
    error: text(source.error?.message ?? source.error ?? source.failure_reason ?? source.failureReason),
    transferRecoveryRequired: source.transfer_recovery_required === true
      || source.transferRecoveryRequired === true
      || rawError.transfer_recovery_required === true
      || rawError.transferRecoveryRequired === true,
    createdAt: text(source.created_at ?? source.createdAt),
    updatedAt: text(source.updated_at ?? source.updatedAt)
  };
}

function normalizeScene(raw = {}, index = 0) {
  const source = raw.scene || raw.shot || raw;
  const knowledge = source.knowledge_points ?? source.knowledgePoints ?? source.key_points ?? source.keyPoints ?? source.concepts ?? source.topic_ids ?? source.topicIds ?? [];
  const sourceRefs = Array.isArray(source.source_refs ?? source.sourceRefs) ? (source.source_refs ?? source.sourceRefs) : [];
  const sourcePages = sourceRefs.map((item) => item?.page_index ?? item?.pageIndex).filter((item) => Number.isInteger(Number(item)));
  const referenceAssets = Array.isArray(source.reference_assets ?? source.referenceAssets) ? (source.reference_assets ?? source.referenceAssets) : [];
  const firstReference = referenceAssets[0] || {};
  const imageOutput = source.image_output || source.imageOutput || {};
  const videoOutput = source.video_output || source.videoOutput || {};
  return {
    id: text(source.id ?? source.scene_id ?? source.sceneId ?? source.shot_id ?? source.shotId, `scene-${index + 1}`),
    order: source.scene_index != null || source.sceneIndex != null
      ? number(source.scene_index ?? source.sceneIndex, index) + 1
      : number(source.order ?? source.index ?? source.sequence ?? source.position, index + 1),
    title: text(source.title ?? source.name ?? source.heading, `镜头 ${index + 1}`),
    sourcePage: text(source.source_page ?? source.sourcePage ?? source.page ?? source.page_range ?? source.pageRange, sourcePages.length ? [...new Set(sourcePages)].map((page) => `第 ${Number(page) + 1} 页`).join("、") : ""),
    knowledgePoints: Array.isArray(knowledge) ? knowledge.map((item) => text(item?.name ?? item?.label ?? item)).filter(Boolean) : text(knowledge).split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
    script: text(source.script ?? source.narration ?? source.narration_text ?? source.narrationText ?? source.speaker_notes ?? source.speakerNotes ?? source.voiceover),
    subtitle: text(source.subtitle ?? source.captions ?? source.caption ?? source.subtitle_text ?? source.subtitleText),
    visualPrompt: text(source.visual_prompt ?? source.visualPrompt ?? source.image_prompt ?? source.imagePrompt ?? source.prompt),
    duration: number(source.duration ?? source.duration_seconds ?? source.durationSeconds, 0),
    status: normalizeStatus(source.status ?? source.state, "draft"),
    progress: clamp(number(source.progress) <= 1 ? number(source.progress) * 100 : number(source.progress)),
    imageUrl: text(imageOutput.content_url ?? imageOutput.contentUrl ?? imageOutput.public_url ?? imageOutput.publicUrl ?? source.image_url ?? source.imageUrl ?? source.generated_image_url ?? source.generatedImageUrl ?? source.preview_url ?? source.previewUrl ?? imageOutput.url ?? imageOutput.output_url ?? imageOutput.outputUrl ?? imageOutput.source_url ?? imageOutput.sourceUrl),
    referenceImageUrl: text(source.reference_image_url ?? source.referenceImageUrl ?? source.source_image_url ?? source.sourceImageUrl ?? source.page_image_url ?? source.pageImageUrl ?? firstReference.preview_url ?? firstReference.previewUrl ?? firstReference.content_url ?? firstReference.contentUrl ?? firstReference.public_url ?? firstReference.publicUrl),
    videoUrl: text(videoOutput.content_url ?? videoOutput.contentUrl ?? videoOutput.public_url ?? videoOutput.publicUrl ?? source.video_url ?? source.videoUrl ?? source.output_url ?? source.outputUrl ?? videoOutput.url ?? videoOutput.output_url ?? videoOutput.outputUrl ?? videoOutput.source_url ?? videoOutput.sourceUrl),
    error: text(source.error?.message ?? source.error ?? source.failure_reason ?? source.failureReason)
  };
}

function normalizeProject(raw = {}) {
  const envelope = unwrapPayload(raw) || {};
  const source = envelope.project
    ? {
        ...envelope.project,
        latest_version: envelope.latest_version ?? envelope.latestVersion ?? envelope.project.latest_version ?? envelope.project.latestVersion,
        tasks: envelope.tasks ?? envelope.jobs ?? envelope.project.tasks ?? envelope.project.jobs
      }
    : envelope;
  const latestVersion = source.latest_version || source.latestVersion || source.version || {};
  const storyboard = source.storyboard || source.plan || {};
  const sceneRows = firstArray(source, ["scenes", "shots", "latest_version.scenes", "latestVersion.scenes", "version.scenes", "storyboard.scenes", "storyboard.shots", "plan.scenes", "plan.shots"]);
  const taskRows = firstArray(source, ["tasks", "jobs", "generation_tasks", "generationTasks"]);
  const settings = source.settings || source.generation_settings || source.generationSettings || {};
  return {
    id: text(source.id ?? source.project_id ?? source.projectId),
    title: text(source.title ?? source.name ?? source.project_name ?? source.projectName, "未命名讲解"),
    status: normalizeStatus(source.status ?? source.state, "draft"),
    progress: clamp(number(source.progress) <= 1 ? number(source.progress) * 100 : number(source.progress)),
    versionCount: number(source.version_count ?? source.versionCount ?? source.versions?.length),
    sourceName: text(source.source_name ?? source.sourceName ?? source.source_file_name ?? source.sourceFileName ?? source.file_name ?? source.fileName ?? source.material?.name ?? source.import?.name),
    sourceId: text(source.source_id ?? source.sourceId ?? source.source_import_id ?? source.sourceImportId ?? source.import_id ?? source.importId ?? source.material_id ?? source.materialId),
    sourceType: text(source.source_type ?? source.sourceType ?? source.source_mime_type ?? source.sourceMimeType ?? source.file_type ?? source.fileType),
    sourcePages: number(source.source_pages ?? source.sourcePages ?? source.page_count ?? source.pageCount),
    summary: text(storyboard.summary ?? source.summary ?? source.description),
    settings,
    scenes: sceneRows.map(normalizeScene).sort((left, right) => left.order - right.order),
    tasks: taskRows.map(normalizeTask).filter((item) => item.id),
    outputUrl: text(
      source.output_url ?? source.outputUrl ?? source.video_url ?? source.videoUrl ?? source.composed_video_url ?? source.composedVideoUrl
      ?? latestVersion.composed_output?.content_url ?? latestVersion.composedOutput?.contentUrl
      ?? latestVersion.composed_output?.public_url ?? latestVersion.composedOutput?.publicUrl
      ?? latestVersion.composed_output?.url ?? latestVersion.composedOutput?.url
      ?? latestVersion.composed_output?.output_url ?? latestVersion.composedOutput?.outputUrl
    ),
    createdAt: text(source.created_at ?? source.createdAt),
    updatedAt: text(source.updated_at ?? source.updatedAt),
    error: text(source.error?.message ?? source.error ?? source.failure_reason ?? source.failureReason)
  };
}

function normalizeProjectList(payload) {
  if (Array.isArray(payload)) return payload.map(normalizeProject).filter((item) => item.id);
  const source = unwrapPayload(payload) || {};
  return firstArray(source, ["projects", "items", "rows", "results"]).map(normalizeProject).filter((item) => item.id);
}

function normalizeConfig(payload) {
  const source = unwrapPayload(payload) || {};
  const modelSource = source.models || source.model_config || source.modelConfig || {};
  const imports = firstArray(source, ["imports", "existing_imports", "existingImports", "sources", "materials", "available_imports", "availableImports"])
    .map((item) => ({
      id: text(item?.id ?? item?.import_id ?? item?.importId ?? item?.source_id ?? item?.sourceId),
      name: text(item?.name ?? item?.title ?? item?.file_name ?? item?.fileName),
      type: text(item?.type ?? item?.file_type ?? item?.fileType),
      status: normalizeStatus(item?.status, "ready"),
      pages: number(item?.pages ?? item?.page_count ?? item?.pageCount)
    }))
    .filter((item) => item.id && item.name);
  const configuredRaw = source.configured ?? source.provider_configured ?? source.providerConfigured ?? source.ark_configured ?? source.arkConfigured;
  return {
    raw: source,
    configured: configuredRaw == null ? null : Boolean(configuredRaw),
    videoModel: text(modelSource.video?.label ?? modelSource.video?.name ?? modelSource.video_model ?? modelSource.videoModel ?? source.video_model ?? source.videoModel),
    imageModel: text(modelSource.image?.label ?? modelSource.image?.name ?? modelSource.image_model ?? modelSource.imageModel ?? source.image_model ?? source.imageModel),
    understandingModel: text(modelSource.understanding?.label ?? modelSource.understanding?.name ?? modelSource.multimodal_model ?? modelSource.multimodalModel ?? source.multimodal_model ?? source.multimodalModel),
    imports,
    defaults: source.defaults || source.default_settings || source.defaultSettings || {},
    options: {
      courseTypes: optionList(source, ["options.course_types", "options.courseTypes", "course_types", "courseTypes"], DEFAULT_OPTIONS.courseTypes),
      audiences: optionList(source, ["options.audiences", "audiences"], DEFAULT_OPTIONS.audiences),
      languages: optionList(source, ["options.languages", "languages"], DEFAULT_OPTIONS.languages),
      ratios: optionList(source, ["options.ratios", "options.aspect_ratios", "options.aspectRatios", "ratios", "aspect_ratios", "aspectRatios"], DEFAULT_OPTIONS.ratios),
      durations: optionList(source, ["options.durations", "options.target_durations", "options.targetDurations", "durations"], DEFAULT_OPTIONS.durations),
      presenters: optionList(source, ["options.presenters", "options.presenter_modes", "options.presenterModes", "presenters", "presenter_modes", "presenterModes"], DEFAULT_OPTIONS.presenters),
      voices: optionList(source, ["options.voices", "voices"], DEFAULT_OPTIONS.voices),
      styles: optionList(source, ["options.styles", "options.visual_styles", "options.visualStyles", "styles", "visual_styles", "visualStyles"], DEFAULT_OPTIONS.styles),
      resolutions: optionList(source, ["options.resolutions", "resolutions"], DEFAULT_OPTIONS.resolutions)
    }
  };
}

class VideoAPIError extends Error {
  constructor(message, { status = 0, path = "", code = "" } = {}) {
    super(message);
    this.name = "VideoAPIError";
    this.status = status;
    this.path = path;
    this.code = code;
  }
}

async function parseResponse(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

async function requestCandidates(paths, options = {}) {
  const candidates = [...new Set(paths.filter(Boolean))];
  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const path = candidates[index];
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    const init = { method: options.method || "GET", headers, signal: options.signal };
    if (options.body instanceof FormData) {
      init.body = options.body;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    let response;
    try {
      response = await fetch(path, init);
    } catch (error) {
      throw new VideoAPIError(`无法连接视频讲解服务：${error?.message || "网络请求失败"}`, { path });
    }
    const payload = await parseResponse(response);
    if (response.ok) return payload;
    const message = text(payload?.error?.message ?? payload?.error ?? payload?.message ?? payload?.detail, `请求失败（HTTP ${response.status}）`);
    lastError = new VideoAPIError(message, {
      status: response.status,
      path,
      code: text(payload?.code ?? payload?.error?.code)
    });
    const canTryNext = index < candidates.length - 1 && (response.status === 404 || response.status === 405);
    if (!canTryNext) throw lastError;
  }
  throw lastError || new VideoAPIError("视频讲解服务尚未就绪");
}

function projectPaths(suffix = "") {
  return [`${API_ROOT}/projects${suffix}`, `${LEGACY_API_ROOT}/projects${suffix}`];
}

function statusLabel(status) {
  const labels = {
    draft: "草稿",
    importing: "解析教材中",
    source_ready: "教材已就绪",
    parsing: "解析中",
    planning: "生成分镜中",
    storyboarding: "生成分镜中",
    storyboard_ready: "分镜已就绪",
    ready: "可生成",
    queued: "排队中",
    pending: "等待中",
    submitting: "提交中",
    cancel_requested: "正在取消",
    running: "生成中",
    processing: "处理中",
    generating: "生成中",
    image_queued: "画面排队中",
    image_ready: "画面已就绪",
    video_queued: "视频排队中",
    video_generating: "视频生成中",
    composing: "合成中",
    completed: "已完成",
    succeeded: "已完成",
    success: "已完成",
    failed: "失败",
    error: "失败",
    cancelled: "已取消",
    canceled: "已取消"
  };
  return labels[status] || text(status, "未知状态");
}

function taskKindLabel(kind) {
  const labels = {
    import: "解析教材",
    storyboard: "讲稿与分镜",
    plan: "讲稿与分镜",
    image: "镜头画面",
    scene_image: "镜头画面",
    seedream_image: "镜头画面",
    video: "镜头视频",
    scene_video: "镜头视频",
    seedance_video: "镜头视频",
    compose: "合成成片",
    compose_video: "合成成片",
    generation: "生成任务"
  };
  return labels[kind] || text(kind, "生成任务");
}

function isSeedanceTask(task) {
  return task?.kind === "seedance_video" || task?.kind === "scene_video" || task?.kind === "video";
}

function taskNeedsRecovery(task) {
  return Boolean(task?.transferRecoveryRequired || task?.submissionState === "unknown");
}

function taskRecoveryCopy(task) {
  if (task?.transferRecoveryRequired) {
    return "上游画面已经生成，但保存到本地失败。恢复转存不会重新生成，也不会创建新的付费任务。";
  }
  if (task?.submissionState === "unknown") {
    return `上游是否已创建${isSeedanceTask(task) ? " Seedance" : " Seedream"} 任务尚不确定。请先到上游控制台核对，确认前不要重新生成。`;
  }
  return "";
}

function displayDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function icon(name) {
  return `<i data-lucide="${name}" aria-hidden="true"></i>`;
}

function selectedAttr(current, value) {
  return String(current ?? "") === String(value ?? "") ? " selected" : "";
}

function renderOptions(options, current) {
  return options.map((item) => `<option value="${escapeHTML(item.value)}"${selectedAttr(current, item.value)}>${escapeHTML(item.label)}</option>`).join("");
}

function settingValue(project, keys, fallback) {
  for (const key of keys) {
    const value = project?.settings?.[key] ?? project?.[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return fallback;
}

function buildSettingsFields(config, project = null) {
  const options = config?.options || DEFAULT_OPTIONS;
  const defaults = config?.defaults || {};
  const pick = (keys, fallback) => {
    const projectValue = settingValue(project, keys, "");
    if (projectValue) return projectValue;
    for (const key of keys) {
      if (defaults[key] !== undefined && defaults[key] !== null) return String(defaults[key]);
    }
    return fallback;
  };
  const courseType = pick(["course_type", "courseType", "content_type", "contentType"], options.courseTypes[0]?.value);
  const audience = pick(["audience", "audience_level", "audienceLevel"], options.audiences[0]?.value);
  const language = pick(["language", "locale"], options.languages[0]?.value);
  const ratio = pick(["ratio", "aspect_ratio", "aspectRatio"], "16:9");
  const duration = pick(["target_duration_minutes", "targetDurationMinutes", "duration_minutes", "durationMinutes"], "5");
  const pageRangeMode = pick(["page_range_mode", "pageRangeMode", "scope_mode", "scopeMode"], "all");
  const pageStart = pick(["page_start", "pageStart", "start_page", "startPage"], "1");
  const pageEnd = pick(["page_end", "pageEnd", "end_page", "endPage"], project?.sourcePages ? String(project.sourcePages) : "");
  const targetSceneCount = pick(["target_scene_count", "targetSceneCount", "scene_count", "sceneCount"], "8");
  const presenter = pick(["presenter_mode", "presenterMode", "presenter"], options.presenters[0]?.value);
  const voice = pick(["voice_id", "voiceId", "voice"], options.voices[0]?.value);
  const style = pick(["visual_style", "visualStyle", "style"], options.styles[0]?.value);
  const resolution = pick(["resolution", "quality"], "1080p");
  return `
    <label><span>课程类型</span><select name="course_type">${renderOptions(options.courseTypes, courseType)}</select></label>
    <label><span>面向人群</span><select name="audience">${renderOptions(options.audiences, audience)}</select></label>
    <label><span>讲解语言</span><select name="language">${renderOptions(options.languages, language)}</select></label>
    <label><span>画面比例</span><select name="ratio">${renderOptions(options.ratios, ratio)}</select></label>
    <label><span>目标时长</span><select name="target_duration_minutes">${renderOptions(options.durations, duration)}</select></label>
    <label><span>教材页范围</span><select name="page_range_mode"><option value="all"${selectedAttr(pageRangeMode, "all")}>全部可处理页</option><option value="range"${selectedAttr(pageRangeMode, "range")}>指定起止页</option></select></label>
    <label><span>起始页</span><input type="number" name="page_start" min="1" step="1" value="${escapeHTML(pageStart)}" ${pageRangeMode === "range" ? "" : "disabled"} /></label>
    <label><span>结束页</span><input type="number" name="page_end" min="1" step="1" ${project?.sourcePages ? `max="${project.sourcePages}"` : ""} value="${escapeHTML(pageEnd)}" placeholder="最后一页" ${pageRangeMode === "range" ? "" : "disabled"} /></label>
    <label><span>目标镜头数</span><input type="number" name="target_scene_count" min="1" max="60" step="1" value="${escapeHTML(targetSceneCount)}" /></label>
    <label><span>出镜方式</span><select name="presenter_mode">${renderOptions(options.presenters, presenter)}</select></label>
    <label><span>讲解音色</span><select name="voice_id">${renderOptions(options.voices, voice)}</select></label>
    <label><span>画面风格</span><select name="visual_style">${renderOptions(options.styles, style)}</select></label>
    <label><span>分辨率</span><select name="resolution">${renderOptions(options.resolutions, resolution)}</select></label>
  `;
}

function collectSettings(form) {
  const values = new FormData(form);
  const ratio = text(values.get("ratio"), "16:9");
  const durationMinutes = number(values.get("target_duration_minutes"), 5);
  return {
    course_type: text(values.get("course_type")),
    audience: text(values.get("audience")),
    language: text(values.get("language")),
    ratio,
    aspect_ratio: ratio,
    target_duration_minutes: durationMinutes,
    requested_duration_minutes: durationMinutes,
    page_range_mode: text(values.get("page_range_mode"), "all"),
    page_start: number(values.get("page_start"), 1),
    page_end: values.get("page_end") === "" ? null : number(values.get("page_end")),
    target_scene_count: number(values.get("target_scene_count"), 8),
    presenter_mode: text(values.get("presenter_mode")),
    voice_id: text(values.get("voice_id")),
    visual_style: text(values.get("visual_style")),
    resolution: text(values.get("resolution"), "1080p")
  };
}

export function initVideoExplanationWorkbench(root = document.querySelector("#videoExplanationWorkbench")) {
  if (!root || root.dataset.initialized === "true") return null;
  root.dataset.initialized = "true";

  const state = {
    config: null,
    configError: "",
    projects: [],
    projectsError: "",
    activeProject: null,
    selectedSceneId: "",
    inspectorTab: "scene",
    createMode: "upload",
    createFile: null,
    loadingProjects: true,
    loadingProject: false,
    creating: false,
    notice: null,
    confirmAction: null,
    recoveringTaskIds: new Set(),
    pollTimers: new Map()
  };

  root.innerHTML = `
    <header class="vex-head">
      <div class="vex-head-copy">
        <h2>从课件到可编辑讲解视频</h2>
        <p>先确认讲稿与分镜，再逐镜头生成画面和视频；失败的镜头可以单独重做。</p>
      </div>
      <div class="vex-head-actions">
        <span class="vex-service-pill" data-video-service-status>${icon("loader-circle")}<span>正在连接服务</span></span>
        <button type="button" class="vex-quiet-button" data-video-action="refresh">${icon("refresh-cw")}<span>刷新</span></button>
        <button type="button" class="vex-primary-button" data-video-action="new-project">${icon("plus")}<span>新建项目</span></button>
      </div>
    </header>
    <div class="vex-notice" data-video-notice hidden role="status" aria-live="polite"></div>
    <div class="vex-layout">
      <aside class="vex-project-rail" aria-label="视频讲解项目">
        <div class="vex-rail-head"><span>项目</span><small data-video-project-count>0</small></div>
        <div class="vex-project-list" data-video-project-list aria-live="polite"></div>
      </aside>
      <section class="vex-stage" data-video-stage aria-live="polite"></section>
    </div>
    <dialog class="vex-confirm-dialog" data-video-confirm-dialog aria-labelledby="videoConfirmTitle">
      <form method="dialog" class="vex-confirm-surface" data-video-confirm-form>
        <span class="vex-confirm-icon" data-video-confirm-icon>${icon("sparkles")}</span>
        <div><h3 id="videoConfirmTitle" data-video-confirm-title>确认生成</h3><p data-video-confirm-message></p></div>
        <div class="vex-confirm-fields" data-video-confirm-fields hidden></div>
        <footer><button value="cancel" type="submit" class="vex-quiet-button" formnovalidate>取消</button><button value="confirm" type="submit" class="vex-primary-button" data-video-confirm-submit>确认生成</button></footer>
      </form>
    </dialog>
  `;

  const nodes = {
    serviceStatus: root.querySelector("[data-video-service-status]"),
    notice: root.querySelector("[data-video-notice]"),
    projectList: root.querySelector("[data-video-project-list]"),
    projectCount: root.querySelector("[data-video-project-count]"),
    stage: root.querySelector("[data-video-stage]"),
    confirmDialog: root.querySelector("[data-video-confirm-dialog]"),
    confirmForm: root.querySelector("[data-video-confirm-form]"),
    confirmIcon: root.querySelector("[data-video-confirm-icon]"),
    confirmTitle: root.querySelector("[data-video-confirm-title]"),
    confirmMessage: root.querySelector("[data-video-confirm-message]"),
    confirmFields: root.querySelector("[data-video-confirm-fields]"),
    confirmSubmit: root.querySelector("[data-video-confirm-submit]")
  };

  function refreshIcons(container = root) {
    window.lucide?.createIcons?.({ root: container, attrs: { "stroke-width": 1.8 } });
  }

  function setNotice(message = "", type = "info") {
    state.notice = message ? { message, type } : null;
    if (!nodes.notice) return;
    nodes.notice.hidden = !message;
    nodes.notice.dataset.type = type;
    nodes.notice.innerHTML = message
      ? `${icon(type === "error" ? "circle-alert" : type === "success" ? "circle-check" : "info")}<span>${escapeHTML(message)}</span><button type="button" aria-label="关闭提示" data-video-action="dismiss-notice">${icon("x")}</button>`
      : "";
    refreshIcons(nodes.notice);
  }

  function renderServiceStatus() {
    if (!nodes.serviceStatus) return;
    const unavailable = Boolean(state.configError && state.projectsError);
    const modelMissing = state.config?.configured === false;
    const partial = Boolean(state.configError || state.projectsError);
    nodes.serviceStatus.dataset.state = unavailable ? "error" : modelMissing || partial ? "warning" : "ready";
    nodes.serviceStatus.innerHTML = unavailable
      ? `${icon("circle-off")}<span>服务未就绪</span>`
      : modelMissing
        ? `${icon("triangle-alert")}<span>生成模型未配置</span>`
        : partial
          ? `${icon("cloud-alert")}<span>部分服务不可用</span>`
          : `${icon("cloud-check")}<span>生产服务已连接</span>`;
    nodes.serviceStatus.title = state.configError || state.projectsError || "视频任务由服务端持久化";
    refreshIcons(nodes.serviceStatus);
  }

  function renderProjectList() {
    nodes.projectCount.textContent = state.loadingProjects ? "…" : String(state.projects.length);
    if (state.loadingProjects) {
      nodes.projectList.innerHTML = `<div class="vex-list-loading" aria-label="正在读取项目"><i></i><i></i><i></i></div>`;
      return;
    }
    if (state.projectsError && !state.projects.length) {
      nodes.projectList.innerHTML = `<div class="vex-rail-state is-error">${icon("database-zap")}<b>项目未加载</b><p>${escapeHTML(state.projectsError)}</p><button type="button" data-video-action="refresh">重试</button></div>`;
      refreshIcons(nodes.projectList);
      return;
    }
    if (!state.projects.length) {
      nodes.projectList.innerHTML = `<div class="vex-rail-state">${icon("clapperboard")}<b>还没有项目</b><p>上传一份教材开始制作。</p></div>`;
      refreshIcons(nodes.projectList);
      return;
    }
    nodes.projectList.innerHTML = state.projects.map((project) => {
      const selected = state.activeProject?.id === project.id;
      const meta = project.sourceName || displayDate(project.updatedAt || project.createdAt) || statusLabel(project.status);
      return `<button type="button" class="vex-project-item${selected ? " is-active" : ""}" data-video-project-id="${escapeHTML(project.id)}" aria-current="${selected ? "page" : "false"}">
        <span class="vex-project-thumb">${project.outputUrl ? icon("circle-play") : icon("presentation")}</span>
        <span><b>${escapeHTML(project.title)}</b><small>${escapeHTML(meta)}</small></span>
        <i class="vex-project-state" data-state="${escapeHTML(project.status)}" title="${escapeHTML(statusLabel(project.status))}"></i>
      </button>`;
    }).join("");
    refreshIcons(nodes.projectList);
  }

  function renderCreateStage() {
    const config = state.config || { options: DEFAULT_OPTIONS, imports: [], defaults: {} };
    const imports = config.imports || [];
    const providerNote = state.configError
      ? `服务配置尚未读取，提交时会由服务端校验：${state.configError}`
      : config.configured === false
        ? "Ark 生成模型尚未配置；可以建立项目，但暂不能生成画面或视频。"
        : "模型、音色和画面参数以服务端返回配置为准。";
    nodes.stage.innerHTML = `
      <div class="vex-create-scroll">
        <section class="vex-create-card">
          <header class="vex-create-head">
            <div><span class="vex-step">01</span><h3>选择教材</h3><p>支持 PPT、PPTX、Word 与 PDF；原文件会进入可追踪的解析任务。</p></div>
            <div class="vex-source-tabs" role="tablist" aria-label="教材来源">
              <button type="button" role="tab" aria-selected="${state.createMode === "upload"}" class="${state.createMode === "upload" ? "is-active" : ""}" data-video-source-mode="upload">上传文件</button>
              <button type="button" role="tab" aria-selected="${state.createMode === "existing"}" class="${state.createMode === "existing" ? "is-active" : ""}" data-video-source-mode="existing">已有导入</button>
            </div>
          </header>
          <form class="vex-create-form" data-video-create-form>
            <div class="vex-source-panel" data-source-mode="upload"${state.createMode === "upload" ? "" : " hidden"}>
              <label class="vex-source-drop" data-video-drop-zone>
                <input type="file" name="file" accept=".ppt,.pptx,.doc,.docx,.pdf,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
                <span class="vex-drop-icon">${icon("upload-cloud")}</span>
                <span><b>${escapeHTML(state.createFile?.name || "拖入课件，或点击选择")}</b><small>${state.createFile ? `${Math.max(1, Math.ceil(state.createFile.size / 1024 / 1024))} MB · 可在创建前更换` : "PPT / PPTX / DOC / DOCX / PDF"}</small></span>
              </label>
            </div>
            <div class="vex-source-panel" data-source-mode="existing"${state.createMode === "existing" ? "" : " hidden"}>
              ${imports.length ? `<label class="vex-existing-source"><span>已完成解析的资料</span><select name="source_import_id"><option value="">请选择</option>${imports.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}${item.pages ? ` · ${item.pages} 页` : ""}</option>`).join("")}</select><small>选择后会同步解析结果，不会重复上传原文件。</small></label>` : `<div class="vex-source-empty">${icon("folder-open")}<span><b>暂无可用导入</b><small>先在知识或题库导入中完成文件解析，或切换为上传文件。</small></span></div>`}
            </div>

            <section class="vex-create-section">
              <div class="vex-section-title"><span class="vex-step">02</span><div><h3>定义讲解</h3><p>这些设置将用于讲稿、字幕、画面和成片。</p></div></div>
              <label class="vex-project-name"><span>项目名称</span><input type="text" name="title" maxlength="80" placeholder="例如：一次函数图像与性质" /></label>
              <div class="vex-settings-grid">${buildSettingsFields(config)}</div>
            </section>

            <footer class="vex-create-footer">
              <span>${icon(state.configError ? "triangle-alert" : "shield-check")}<small>${escapeHTML(providerNote)}</small></span>
              <button type="submit" class="vex-primary-button" ${state.creating ? "disabled" : ""}>${icon(state.creating ? "loader-circle" : "arrow-right")}<span>${state.creating ? "正在创建项目" : "创建项目"}</span></button>
            </footer>
          </form>
        </section>
        <section class="vex-production-map" aria-label="视频生产流程">
          <span><i>1</i><b>解析教材</b><small>文字 · 图片 · 公式</small></span><em></em>
          <span><i>2</i><b>审阅分镜</b><small>讲稿 · 字幕 · 视觉</small></span><em></em>
          <span><i>3</i><b>逐镜生成</b><small>教学画面 · 镜头视频</small></span><em></em>
          <span><i>4</i><b>合成成片</b><small>进度 · 版本 · 导出</small></span>
        </section>
      </div>`;
    refreshIcons(nodes.stage);
  }

  function renderTaskDock(project) {
    const taskContainer = nodes.stage.querySelector("[data-video-task-dock]");
    if (!taskContainer) return;
    const tasks = (project.tasks || []).slice().sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
    const recoveryTask = tasks.find(taskNeedsRecovery);
    const activeTask = tasks.find((item) => ACTIVE_TASK_STATES.has(item.status));
    if (!tasks.length) {
      taskContainer.innerHTML = `<span class="vex-task-idle">${icon("circle-dashed")}<span><b>暂无媒体生成任务</b><small>画面、视频与成片任务会保存在服务端，离开页面后仍可回来查看。</small></span></span>`;
      refreshIcons(taskContainer);
      return;
    }
    const focusTask = recoveryTask || activeTask || tasks[0];
    const focusNeedsRecovery = taskNeedsRecovery(focusTask);
    const progress = TERMINAL_TASK_STATES.has(focusTask.status) && !focusTask.progress
      ? (focusTask.status === "completed" || focusTask.status === "succeeded" || focusTask.status === "success" ? 100 : 0)
      : focusTask.progress;
    taskContainer.innerHTML = `<div class="vex-task-current" data-state="${escapeHTML(focusTask.status)}" data-recovery="${focusNeedsRecovery ? "required" : "none"}">
      <span class="vex-task-icon">${icon(focusNeedsRecovery ? "triangle-alert" : ACTIVE_TASK_STATES.has(focusTask.status) ? "loader-circle" : focusTask.status === "failed" || focusTask.status === "error" ? "circle-alert" : "circle-check")}</span>
      <span><b>${escapeHTML(taskKindLabel(focusTask.kind))} · ${focusNeedsRecovery ? "待人工处理" : escapeHTML(statusLabel(focusTask.status))}</b><small>${escapeHTML(focusNeedsRecovery ? taskRecoveryCopy(focusTask) : focusTask.error || focusTask.message || displayDate(focusTask.updatedAt || focusTask.createdAt) || "等待状态更新")}</small></span>
      ${focusNeedsRecovery ? renderTaskRecoveryActions(focusTask, "current") : `<em>${Math.round(progress)}%</em>`}
      <i class="vex-task-progress" style="--progress:${progress}%"></i>
    </div>
    <details class="vex-task-history"><summary>任务记录 <b>${tasks.length}</b>${icon("chevron-down")}</summary><div>${tasks.slice(0, 8).map(renderTaskHistoryItem).join("")}</div></details>`;
    refreshIcons(taskContainer);
  }

  function renderTaskRecoveryActions(task, location) {
    if (!taskNeedsRecovery(task)) return "";
    const busy = state.recoveringTaskIds.has(task.id);
    const disabled = busy ? " disabled aria-busy=\"true\"" : "";
    if (task.transferRecoveryRequired) {
      return `<span class="vex-task-recovery-actions" data-location="${location}"><button type="button" class="vex-task-action is-primary" data-video-action="recover-task-transfer" data-video-task-id="${escapeHTML(task.id)}"${disabled}>${icon(busy ? "loader-circle" : "download")}<span>${busy ? "转存中" : "恢复转存"}</span></button></span>`;
    }
    const bindAction = isSeedanceTask(task)
      ? `<button type="button" class="vex-task-action" data-video-action="bind-provider-task" data-video-task-id="${escapeHTML(task.id)}"${disabled}>${icon("link")}<span>绑定上游任务</span></button>`
      : "";
    return `<span class="vex-task-recovery-actions" data-location="${location}"><button type="button" class="vex-task-action is-primary" data-video-action="confirm-provider-task-not-created" data-video-task-id="${escapeHTML(task.id)}"${disabled}>${icon("circle-x")}<span>确认未创建</span></button>${bindAction}</span>`;
  }

  function renderTaskHistoryItem(task) {
    const needsRecovery = taskNeedsRecovery(task);
    return `<div class="vex-task-history-item" data-recovery="${needsRecovery ? "required" : "none"}">
      <span class="vex-task-history-main"><i data-state="${escapeHTML(task.status)}"></i><b>${escapeHTML(taskKindLabel(task.kind))}</b><small>${needsRecovery ? "待人工处理" : escapeHTML(statusLabel(task.status))}</small><em>${escapeHTML(displayDate(task.updatedAt || task.createdAt))}</em></span>
      ${needsRecovery ? `<p>${escapeHTML(taskRecoveryCopy(task))}</p>${renderTaskRecoveryActions(task, "history")}` : ""}
    </div>`;
  }

  function renderPreview(project, scene) {
    if (project.outputUrl && !scene) {
      return `<video controls preload="metadata" src="${escapeHTML(project.outputUrl)}"><a href="${escapeHTML(project.outputUrl)}" target="_blank" rel="noreferrer">打开成片</a></video>`;
    }
    if (scene?.videoUrl) {
      return `<video controls preload="metadata" poster="${escapeHTML(scene.imageUrl || scene.referenceImageUrl)}" src="${escapeHTML(scene.videoUrl)}"><a href="${escapeHTML(scene.videoUrl)}" target="_blank" rel="noreferrer">打开镜头视频</a></video>`;
    }
    if (scene?.imageUrl || scene?.referenceImageUrl) {
      return `<img src="${escapeHTML(scene.imageUrl || scene.referenceImageUrl)}" alt="${escapeHTML(scene.title)}画面预览" />`;
    }
    return `<div class="vex-preview-empty">${icon("scan")}
      <span><b>${scene ? "这个镜头还没有画面" : "等待讲稿与分镜"}</b><small>${scene ? "先审阅右侧视觉提示，再生成镜头画面。" : "系统不会在分镜确认前直接生成整条视频。"}</small></span>
    </div>`;
  }

  function renderTimeline(project, selectedScene) {
    if (!project.scenes.length) {
      return `<div class="vex-timeline-empty">${icon("rows-3")}<span><b>尚未生成教学镜头</b><small>点击“生成讲稿与分镜”，完成后可逐镜审阅和修改。</small></span></div>`;
    }
    return project.scenes.map((scene, index) => {
      const active = selectedScene?.id === scene.id;
      const thumb = scene.imageUrl || scene.referenceImageUrl;
      return `<button type="button" class="vex-scene-card${active ? " is-active" : ""}" data-video-scene-id="${escapeHTML(scene.id)}" aria-current="${active ? "true" : "false"}">
        <span class="vex-scene-thumb">${thumb ? `<img src="${escapeHTML(thumb)}" alt="" />` : icon(scene.videoUrl ? "film" : "image")}
          <i class="vex-scene-status" data-state="${escapeHTML(scene.status)}"></i>
        </span>
        <span><b>${String(index + 1).padStart(2, "0")} · ${escapeHTML(scene.title)}</b><small>${escapeHTML([scene.sourcePage, scene.knowledgePoints[0], scene.duration ? `${scene.duration} 秒` : "时长待定"].filter(Boolean).join(" · "))}</small></span>
      </button>`;
    }).join("");
  }

  function renderSceneEditor(project, scene) {
    if (!scene) {
      return `<div class="vex-inspector-empty">${icon("panel-right")}<span><b>选择一个教学镜头</b><small>${project.scenes.length ? "从下方时间线选择镜头后，可以编辑讲稿、字幕和视觉提示。" : "生成讲稿与分镜后，这里会出现可编辑内容。"}</small></span><button type="button" class="vex-quiet-button" data-video-inspector-tab="settings">查看讲解设置</button></div>`;
    }
    const modelDisabled = state.config?.configured === false;
    const hasImage = Boolean(scene.imageUrl);
    const hasVideo = Boolean(scene.videoUrl);
    return `<form class="vex-scene-form" data-video-scene-form>
      <input type="hidden" name="scene_id" value="${escapeHTML(scene.id)}" />
      <div class="vex-inspector-summary"><span>镜头 ${escapeHTML(scene.order)}</span><small data-state="${escapeHTML(scene.status)}">${escapeHTML(statusLabel(scene.status))}</small></div>
      <label><span>镜头标题</span><input type="text" name="title" maxlength="100" value="${escapeHTML(scene.title)}" /></label>
      <div class="vex-field-pair">
        <label><span>教材页（溯源）</span><input type="text" readonly aria-readonly="true" value="${escapeHTML(scene.sourcePage || "未绑定")}" title="教材页由分镜来源确定；如需调整，请重做分镜" /><small>由分镜来源确定</small></label>
        <label><span>时长（秒）</span><input type="number" name="duration_seconds" min="4" max="30" step="1" value="${scene.duration || ""}" /></label>
      </div>
      <label><span>知识点</span><input type="text" name="knowledge_points" maxlength="500" placeholder="用逗号分隔" value="${escapeHTML(scene.knowledgePoints.join("，"))}" /></label>
      <label><span>讲稿</span><textarea name="script" rows="7" placeholder="教师在这个镜头中的完整讲解">${escapeHTML(scene.script)}</textarea></label>
      <label><span>字幕</span><textarea name="subtitle" rows="4" placeholder="与讲稿对齐的字幕文本">${escapeHTML(scene.subtitle)}</textarea></label>
      <label><span>视觉提示</span><textarea name="visual_prompt" rows="5" placeholder="描述构图、教学重点、图表或公式出现方式">${escapeHTML(scene.visualPrompt)}</textarea><small>参考图仅使用服务端确认的教材页与已审核素材。</small></label>
      ${scene.error ? `<div class="vex-field-error">${icon("circle-alert")}<span>${escapeHTML(scene.error)}</span></div>` : ""}
      <div class="vex-scene-actions">
        <button type="submit" class="vex-quiet-button">${icon("save")}<span>保存修改</span></button>
        <button type="button" class="vex-quiet-button" data-video-action="generate-scene-image" ${modelDisabled ? "disabled title=\"请先配置生成模型\"" : ""}>${icon("image-plus")}<span>${hasImage ? "重绘画面" : "生成画面"}</span></button>
        <button type="button" class="vex-primary-button" data-video-action="generate-scene-video" ${modelDisabled ? "disabled title=\"请先配置生成模型\"" : ""}>${icon(hasVideo ? "refresh-cw" : "clapperboard")}<span>${hasVideo ? "重生成视频" : "生成视频"}</span></button>
      </div>
    </form>`;
  }

  function renderProjectSettings(project) {
    const config = state.config || { options: DEFAULT_OPTIONS, defaults: {} };
    return `<form class="vex-project-settings-form" data-video-project-settings-form>
      <div class="vex-inspector-summary"><span>项目设置</span><small>影响后续新生成的镜头</small></div>
      ${state.config?.configured === false ? `<div class="vex-settings-boundary">${icon("triangle-alert")}<p>生成模型尚未完成服务端配置。请先在 AI教师设置中检查模型状态。</p><button type="button" class="vex-quiet-button" data-video-action="open-model-settings">前往设置</button></div>` : ""}
      <label><span>项目名称</span><input type="text" name="title" maxlength="80" value="${escapeHTML(project.title)}" /></label>
      <div class="vex-settings-stack">${buildSettingsFields(config, project)}</div>
      <div class="vex-settings-boundary">${icon("info")}<p>修改设置不会自动重做已有镜头。需要更新时，请在时间线选择镜头后单独生成。</p></div>
      <button type="submit" class="vex-primary-button">${icon("save")}<span>保存项目设置</span></button>
    </form>`;
  }

  function renderStudio() {
    const project = state.activeProject;
    if (!project) {
      renderCreateStage();
      return;
    }
    if (state.loadingProject) {
      nodes.stage.innerHTML = `<div class="vex-stage-loading"><span class="vex-spinner">${icon("loader-circle")}</span><b>正在读取项目</b><p>同步分镜、素材和任务状态…</p></div>`;
      refreshIcons(nodes.stage);
      return;
    }
    let selectedScene = project.scenes.find((item) => item.id === state.selectedSceneId) || project.scenes[0] || null;
    state.selectedSceneId = selectedScene?.id || "";
    if (!selectedScene && state.inspectorTab === "scene") state.inspectorTab = "settings";
    const modelDisabled = state.config?.configured === false;
    const previewLabel = selectedScene ? `镜头 ${selectedScene.order} / ${project.scenes.length}` : "成片预览";
    const sceneTrace = selectedScene
      ? [selectedScene.sourcePage && `教材 ${selectedScene.sourcePage}`, selectedScene.knowledgePoints.slice(0, 2).join(" · ")].filter(Boolean).join(" · ")
      : "完整讲解视频";
    const previewRatio = settingValue(project, ["ratio", "aspect_ratio", "aspectRatio"], "16:9");
    nodes.stage.innerHTML = `
      <div class="vex-studio">
        <header class="vex-studio-toolbar">
          <div class="vex-studio-title"><span class="vex-project-status" data-state="${escapeHTML(project.status)}">${escapeHTML(statusLabel(project.status))}</span><span><h3>${escapeHTML(project.title)}</h3><small>${escapeHTML(project.sourceName || "尚未关联教材")} ${project.sourcePages ? `· ${project.sourcePages} 页` : ""}${project.versionCount ? ` · ${project.versionCount} 个分镜版本` : ""}</small></span></div>
          <div class="vex-studio-actions">
            <button type="button" class="vex-quiet-button" data-video-action="generate-storyboard">${icon("list-video")}<span>${project.scenes.length ? "重做分镜" : "生成讲稿与分镜"}</span></button>
            <button type="button" class="vex-quiet-button" data-video-action="generate-batch" ${!project.scenes.length || modelDisabled ? "disabled" : ""}>${icon("layers-3")}<span>批量生成</span></button>
            <button type="button" class="vex-primary-button" data-video-action="compose" ${!project.scenes.length || !project.scenes.every((item) => item.videoUrl || item.status === "completed" || item.status === "succeeded") ? "disabled" : ""}>${icon("combine")}<span>合成成片</span></button>
          </div>
        </header>

        <div class="vex-production-grid">
          <section class="vex-preview-column">
            <div class="vex-preview-head"><span><b>${escapeHTML(previewLabel)}</b><small>${escapeHTML(sceneTrace || selectedScene?.title || "完整讲解视频")}</small></span>${project.outputUrl ? `<a href="${escapeHTML(project.outputUrl)}" target="_blank" rel="noreferrer">在新窗口打开${icon("external-link")}</a>` : ""}</div>
            <div class="vex-preview-frame" data-ratio="${escapeHTML(previewRatio)}">${renderPreview(project, selectedScene)}</div>
            <section class="vex-task-dock" data-video-task-dock aria-label="项目任务进度"></section>
          </section>

          <aside class="vex-inspector">
            <nav class="vex-inspector-tabs" role="tablist" aria-label="项目编辑">
              <button type="button" role="tab" aria-selected="${state.inspectorTab === "scene"}" class="${state.inspectorTab === "scene" ? "is-active" : ""}" data-video-inspector-tab="scene" ${!selectedScene ? "disabled" : ""}>镜头编辑</button>
              <button type="button" role="tab" aria-selected="${state.inspectorTab === "settings"}" class="${state.inspectorTab === "settings" ? "is-active" : ""}" data-video-inspector-tab="settings">讲解设置</button>
            </nav>
            <div class="vex-inspector-scroll">${state.inspectorTab === "settings" ? renderProjectSettings(project) : renderSceneEditor(project, selectedScene)}</div>
          </aside>
        </div>

        <section class="vex-timeline" aria-label="教学镜头时间线">
          <header><span><b>教学镜头</b><small>${project.scenes.length ? `${project.scenes.length} 个镜头 · ${project.scenes.reduce((sum, item) => sum + item.duration, 0) || "—"} 秒` : "等待生成"}</small></span><button type="button" class="vex-icon-button" data-video-action="refresh-project" aria-label="刷新项目" title="刷新项目">${icon("refresh-cw")}</button></header>
          <div class="vex-scene-track">${renderTimeline(project, selectedScene)}</div>
        </section>
      </div>`;
    renderTaskDock(project);
    refreshIcons(nodes.stage);
  }

  function mergeProject(project) {
    const index = state.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) state.projects[index] = { ...state.projects[index], ...project };
    else state.projects.unshift(project);
    state.activeProject = project;
    renderProjectList();
  }

  function upsertTask(task) {
    if (!task?.id || !state.activeProject) return;
    const tasks = [...(state.activeProject.tasks || [])];
    const index = tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) tasks[index] = { ...tasks[index], ...task };
    else tasks.unshift(task);
    state.activeProject.tasks = tasks;
    const projectIndex = state.projects.findIndex((item) => item.id === state.activeProject.id);
    if (projectIndex >= 0) state.projects[projectIndex] = { ...state.projects[projectIndex], tasks };
    renderTaskDock(state.activeProject);
  }

  function taskFromActionPayload(payload, defaults = {}) {
    const source = unwrapPayload(payload) || {};
    const rawTask = source.task || source.job || (source.task_id || source.taskId || source.id && source.status ? source : null);
    if (!rawTask) return null;
    const task = normalizeTask({ ...defaults, ...rawTask });
    return task.id ? task : null;
  }

  async function pollTask(task) {
    if (!task?.id || state.pollTimers.has(task.id) || TERMINAL_TASK_STATES.has(task.status)) return;
    const poll = async () => {
      state.pollTimers.delete(task.id);
      if (!root.isConnected) return;
      try {
        const payload = await requestCandidates([
          `${API_ROOT}/tasks/${encodeURIComponent(task.id)}`,
          `${LEGACY_API_ROOT}/tasks/${encodeURIComponent(task.id)}`
        ]);
        const next = normalizeTask(unwrapPayload(payload)?.task || unwrapPayload(payload));
        if (!next.id) next.id = task.id;
        upsertTask(next);
        if (TERMINAL_TASK_STATES.has(next.status)) {
          await loadProject(state.activeProject?.id, { quiet: true });
          if (next.status === "failed" || next.status === "error") setNotice(next.error || `${taskKindLabel(next.kind)}失败，请查看任务记录。`, "error");
          return;
        }
        state.pollTimers.set(task.id, window.setTimeout(poll, 2800));
      } catch (error) {
        setNotice(`任务状态暂时无法更新：${error.message}`, "error");
        state.pollTimers.set(task.id, window.setTimeout(poll, 8000));
      }
    };
    state.pollTimers.set(task.id, window.setTimeout(poll, 1200));
  }

  function trackAction(payload, defaults = {}) {
    const source = unwrapPayload(payload) || {};
    const projectRaw = source.project;
    if (projectRaw) mergeProject(normalizeProject(projectRaw));
    const task = taskFromActionPayload(payload, defaults);
    if (task) {
      upsertTask(task);
      if (TERMINAL_TASK_STATES.has(task.status)) {
        window.setTimeout(() => loadProject(state.activeProject?.id, { quiet: true }), 250);
      } else {
        pollTask(task);
      }
    } else if (state.activeProject?.id) {
      window.setTimeout(() => loadProject(state.activeProject.id, { quiet: true }), 800);
    }
    return task;
  }

  async function loadConfig() {
    try {
      const payload = await requestCandidates([`${API_ROOT}/config`, `${LEGACY_API_ROOT}/config`]);
      state.config = normalizeConfig(payload);
      state.configError = "";
    } catch (error) {
      state.config = null;
      state.configError = error.message;
    }
    try {
      const importPayload = await requestCandidates(["/api/education/imports?limit=80"]);
      const importSource = unwrapPayload(importPayload) || {};
      const imports = firstArray(importSource, ["jobs", "imports", "items", "results"]).map((item) => ({
        id: text(item?.id ?? item?.job_id ?? item?.jobId ?? item?.import_id ?? item?.importId),
        name: text(item?.request?.title ?? item?.source?.file_name ?? item?.source?.fileName ?? item?.title ?? item?.name),
        type: text(item?.request?.document_type ?? item?.request?.documentType ?? item?.source?.mime_type ?? item?.source?.mimeType),
        status: normalizeStatus(item?.status, "queued"),
        pages: number(item?.result?.page_count ?? item?.result?.pageCount ?? item?.page_count ?? item?.pageCount)
      })).filter((item) => item.id && item.name && ["succeeded", "completed", "success"].includes(item.status));
      if (!state.config) state.config = normalizeConfig({});
      state.config.imports = imports;
    } catch {
      // Existing imports are optional; direct upload remains available.
    }
  }

  async function loadProjects({ preserveSelection = true } = {}) {
    state.loadingProjects = true;
    renderProjectList();
    try {
      const payload = await requestCandidates(projectPaths());
      state.projects = normalizeProjectList(payload);
      state.projectsError = "";
      if (preserveSelection && state.activeProject?.id) {
        const summary = state.projects.find((item) => item.id === state.activeProject.id);
        if (summary) state.activeProject = { ...state.activeProject, ...summary, scenes: state.activeProject.scenes, tasks: state.activeProject.tasks };
      }
    } catch (error) {
      state.projectsError = error.message;
    } finally {
      state.loadingProjects = false;
      renderProjectList();
    }
  }

  async function loadProject(projectId, { quiet = false } = {}) {
    if (!projectId) return;
    if (!quiet) {
      state.loadingProject = true;
      const summary = state.projects.find((item) => item.id === projectId);
      if (summary) state.activeProject = summary;
      renderProjectList();
      renderStudio();
    }
    try {
      const payload = await requestCandidates(projectPaths(`/${encodeURIComponent(projectId)}`));
      const project = normalizeProject(payload);
      if (!project.id) project.id = projectId;
      const previousSceneId = state.selectedSceneId;
      mergeProject(project);
      state.selectedSceneId = project.scenes.some((item) => item.id === previousSceneId) ? previousSceneId : project.scenes[0]?.id || "";
      project.tasks.filter((task) => ACTIVE_TASK_STATES.has(task.status)).forEach(pollTask);
      if (!quiet) setNotice("");
    } catch (error) {
      setNotice(`项目读取失败：${error.message}`, "error");
    } finally {
      state.loadingProject = false;
      renderStudio();
    }
  }

  async function loadInitial() {
    state.loadingProjects = true;
    renderCreateStage();
    renderProjectList();
    await Promise.all([loadConfig(), loadProjects({ preserveSelection: false })]);
    renderServiceStatus();
    renderProjectList();
    renderStudio();
  }

  function setCreateMode(mode) {
    state.createMode = mode === "existing" ? "existing" : "upload";
    renderCreateStage();
  }

  async function createProject(form) {
    if (state.creating) return;
    const values = new FormData(form);
    const settings = collectSettings(form);
    const title = text(values.get("title"), state.createFile?.name?.replace(/\.[^.]+$/, "") || "未命名讲解");
    const importId = text(values.get("source_import_id"));
    if (state.createMode === "upload" && !state.createFile) {
      setNotice("请选择一份 PPT、Word 或 PDF 教材。", "error");
      form.querySelector('input[type="file"]')?.focus();
      return;
    }
    if (state.createMode === "existing" && !importId) {
      setNotice("请选择一份已经完成解析的资料。", "error");
      form.querySelector('select[name="source_import_id"]')?.focus();
      return;
    }
    state.creating = true;
    renderCreateStage();
    setNotice("正在创建项目并提交教材解析…", "info");
    try {
      let body;
      if (state.createMode === "upload") {
        body = new FormData();
        body.append("file", state.createFile);
        body.append("title", title);
        body.append("settings", JSON.stringify(settings));
        Object.entries(settings).forEach(([key, value]) => body.append(key, String(value)));
      } else {
        body = { title, source_import_id: importId, import_id: importId, settings, ...settings };
      }
      const payload = await requestCandidates(projectPaths(), { method: "POST", body });
      const source = unwrapPayload(payload) || {};
      let project = normalizeProject(source.project || source);
      if (!project.id) throw new VideoAPIError("服务端已响应，但没有返回项目 ID");
      mergeProject(project);
      state.selectedSceneId = project.scenes[0]?.id || "";
      state.inspectorTab = project.scenes.length ? "scene" : "settings";
      const createTask = trackAction(payload, { project_id: project.id, kind: "import" });
      if (state.createMode === "existing") {
        try {
          const syncPayload = await requestCandidates([
            `${API_ROOT}/projects/${encodeURIComponent(project.id)}/sync-import`,
            `${LEGACY_API_ROOT}/projects/${encodeURIComponent(project.id)}/import`
          ], { method: "POST", body: { import_id: importId, source_import_id: importId } });
          trackAction(syncPayload, { project_id: project.id, kind: "import" });
        } catch (syncError) {
          setNotice(`项目已创建，但资料同步失败：${syncError.message}`, "error");
        }
      }
      state.createFile = null;
      setNotice(createTask ? "项目已创建，教材解析任务已提交。" : "项目已创建，可继续生成讲稿与分镜。", "success");
      await loadProjects();
      await loadProject(project.id, { quiet: true });
    } catch (error) {
      setNotice(`项目创建失败：${error.message}`, "error");
    } finally {
      state.creating = false;
      renderProjectList();
      renderStudio();
    }
  }

  async function runAction(button, callback) {
    if (button?.disabled) return;
    button?.setAttribute("disabled", "");
    button?.classList.add("is-busy");
    try {
      await callback();
    } finally {
      button?.removeAttribute("disabled");
      button?.classList.remove("is-busy");
    }
  }

  async function generateStoryboard(button) {
    const project = state.activeProject;
    if (!project?.id) return;
    const rangeMode = settingValue(project, ["page_range_mode", "pageRangeMode", "scope_mode", "scopeMode"], "all");
    const pageStart = number(settingValue(project, ["page_start", "pageStart", "start_page", "startPage"], "1"), 1);
    const pageEndValue = settingValue(project, ["page_end", "pageEnd", "end_page", "endPage"], "");
    const pageEnd = pageEndValue ? number(pageEndValue) : project.sourcePages || null;
    const durationMinutes = number(settingValue(project, ["target_duration_minutes", "targetDurationMinutes", "requested_duration_minutes", "requestedDurationMinutes"], "5"), 5);
    const sceneCount = number(settingValue(project, ["target_scene_count", "targetSceneCount", "scene_count", "sceneCount"], "8"), 8);
    const pageSelection = rangeMode === "range"
      ? {
          page_start: pageStart,
          page_end: pageEnd,
          start_page_index: Math.max(0, pageStart - 1),
          end_page_index: pageEnd ? Math.max(0, pageEnd - 1) : undefined
        }
      : {};
    await runAction(button, async () => {
      setNotice("正在生成讲稿与分镜，请保持当前页面打开。", "info");
      try {
        await requestCandidates([
          `${API_ROOT}/projects/${encodeURIComponent(project.id)}/storyboard`,
          `${LEGACY_API_ROOT}/projects/${encodeURIComponent(project.id)}/plan`
        ], {
          method: "POST",
          body: {
            regenerate: project.scenes.length > 0,
            settings: project.settings || {},
            page_range_mode: rangeMode,
            ...pageSelection,
            target_scene_count: sceneCount,
            target_duration_minutes: durationMinutes,
            duration_minutes: durationMinutes
          }
        });
        await loadProject(project.id, { quiet: true });
        setNotice("讲稿与分镜已生成。", "success");
      } catch (error) {
        setNotice(`讲稿与分镜生成失败：${error.message}`, "error");
      }
    });
  }

  async function saveScene(form) {
    const project = state.activeProject;
    const scene = project?.scenes.find((item) => item.id === state.selectedSceneId);
    if (!project?.id || !scene) return;
    const values = new FormData(form);
    const payloadBody = {
      title: text(values.get("title"), scene.title),
      duration_seconds: number(values.get("duration_seconds"), scene.duration),
      knowledge_points: text(values.get("knowledge_points")).split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
      script: text(values.get("script")),
      subtitle: text(values.get("subtitle")),
      visual_prompt: text(values.get("visual_prompt"))
    };
    payloadBody.narration_text = payloadBody.script;
    payloadBody.subtitle_text = payloadBody.subtitle;
    payloadBody.key_points = payloadBody.knowledge_points;
    const submit = form.querySelector('button[type="submit"]');
    await runAction(submit, async () => {
      setNotice("正在保存镜头修改…", "info");
      try {
        const payload = await requestCandidates([
          `${API_ROOT}/projects/${encodeURIComponent(project.id)}/scenes/${encodeURIComponent(scene.id)}`,
          `${LEGACY_API_ROOT}/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(scene.id)}`
        ], { method: "PATCH", body: payloadBody });
        const source = unwrapPayload(payload) || {};
        const updated = normalizeScene(source.scene || source.shot || { ...scene, ...payloadBody }, scene.order - 1);
        project.scenes = project.scenes.map((item) => item.id === scene.id ? { ...item, ...updated, id: scene.id } : item);
        setNotice("镜头修改已保存。", "success");
        renderStudio();
      } catch (error) {
        setNotice(`镜头保存失败：${error.message}`, "error");
      }
    });
  }

  async function saveProjectSettings(form) {
    const project = state.activeProject;
    if (!project?.id) return;
    const values = new FormData(form);
    const settings = collectSettings(form);
    const title = text(values.get("title"), project.title);
    const submit = form.querySelector('button[type="submit"]');
    await runAction(submit, async () => {
      setNotice("正在保存项目设置…", "info");
      try {
        const payload = await requestCandidates(projectPaths(`/${encodeURIComponent(project.id)}`), {
          method: "PATCH",
          body: { title, settings, ...settings }
        });
        const source = unwrapPayload(payload) || {};
        const updated = source.project ? normalizeProject(source.project) : { ...project, title, settings: { ...project.settings, ...settings } };
        if (!updated.id) updated.id = project.id;
        mergeProject({ ...project, ...updated, scenes: updated.scenes?.length ? updated.scenes : project.scenes, tasks: updated.tasks?.length ? updated.tasks : project.tasks });
        setNotice("项目设置已保存，已有镜头不会自动重做。", "success");
        renderStudio();
      } catch (error) {
        setNotice(`项目设置保存失败：${error.message}`, "error");
      }
    });
  }

  function confirmOperation({ title, message, confirmLabel = "确认", iconName = "circle-help", fields = [], action }) {
    state.confirmAction = action;
    nodes.confirmForm.reset();
    nodes.confirmDialog.returnValue = "";
    nodes.confirmIcon.innerHTML = icon(iconName);
    nodes.confirmTitle.textContent = title;
    nodes.confirmMessage.textContent = message;
    nodes.confirmSubmit.textContent = confirmLabel;
    nodes.confirmFields.hidden = fields.length === 0;
    nodes.confirmFields.innerHTML = fields.map((field, index) => {
      const hintId = `videoConfirmFieldHint${index}`;
      const attributes = [
        `name="${escapeHTML(field.name)}"`,
        field.required ? "required" : "",
        field.minlength ? `minlength="${escapeHTML(field.minlength)}"` : "",
        field.maxlength ? `maxlength="${escapeHTML(field.maxlength)}"` : "",
        field.pattern ? `pattern="${escapeHTML(field.pattern)}"` : "",
        field.placeholder ? `placeholder="${escapeHTML(field.placeholder)}"` : "",
        `aria-describedby="${hintId}"`
      ].filter(Boolean).join(" ");
      const control = field.type === "textarea"
        ? `<textarea ${attributes} rows="3"></textarea>`
        : `<input type="text" ${attributes} autocomplete="off" />`;
      return `<label><span>${escapeHTML(field.label)}</span>${control}<small id="${hintId}">${escapeHTML(field.hint || "")}</small></label>`;
    }).join("");
    refreshIcons(nodes.confirmDialog);
    if (typeof nodes.confirmDialog.showModal === "function") nodes.confirmDialog.showModal();
    else nodes.confirmDialog.setAttribute("open", "");
  }

  function confirmGeneration({ title, message, confirmLabel = "确认生成", action }) {
    confirmOperation({ title, message, confirmLabel, iconName: "sparkles", action });
  }

  async function performTaskRecovery(taskId, { body, path, pendingMessage, successMessage }) {
    if (!taskId || state.recoveringTaskIds.has(taskId)) return;
    const task = state.activeProject?.tasks.find((item) => item.id === taskId);
    const projectId = task?.projectId || state.activeProject?.id;
    state.recoveringTaskIds.add(taskId);
    if (state.activeProject?.id === projectId) renderTaskDock(state.activeProject);
    setNotice(pendingMessage, "info");
    try {
      const payload = await requestCandidates([path], { method: "POST", body });
      const source = unwrapPayload(payload) || {};
      const next = normalizeTask(source.task || source);
      if (!next.id) next.id = taskId;
      if (state.activeProject?.id === projectId) {
        upsertTask(next);
        if (!TERMINAL_TASK_STATES.has(next.status)) pollTask(next);
        await loadProject(projectId, { quiet: true });
      }
      setNotice(successMessage, "success");
    } catch (error) {
      setNotice(`任务恢复失败：${error.message}`, "error");
    } finally {
      state.recoveringTaskIds.delete(taskId);
      if (state.activeProject?.id === projectId) renderTaskDock(state.activeProject);
    }
  }

  function confirmTransferRecovery(task) {
    confirmOperation({
      title: "恢复本地转存？",
      message: "这会重新下载并保存已经由 Seedream 生成成功的画面，不会重新调用图片模型，也不会创建新的付费生成任务。",
      confirmLabel: "恢复转存",
      iconName: "download",
      action: () => performTaskRecovery(task.id, {
        path: `${API_ROOT}/tasks/${encodeURIComponent(task.id)}/transfer`,
        pendingMessage: "正在恢复本地转存，不会重新生成画面…",
        successMessage: "画面已恢复转存并保存到本地。"
      })
    });
  }

  function confirmUnknownNotCreated(task) {
    confirmOperation({
      title: "确认上游任务未创建？",
      message: `请仅在已查看${isSeedanceTask(task) ? " Seedance" : " Seedream"} 控制台，确认没有与本次请求对应的任务后继续。提交后，本地任务会标记为已确认失败；本操作本身不会重新生成。`,
      confirmLabel: "确认未创建",
      iconName: "shield-alert",
      fields: [{
        name: "note",
        label: "核查备注",
        type: "textarea",
        required: true,
        minlength: 2,
        maxlength: 500,
        placeholder: "例如：已按提交时间与镜头标题核对 Seedance 控制台，未发现对应任务",
        hint: "必填，简述核查时间、范围或依据；请勿填写密钥。"
      }],
      action: (values) => performTaskRecovery(task.id, {
        path: `${API_ROOT}/tasks/${encodeURIComponent(task.id)}/submission-resolution`,
        body: { resolution: "provider_task_not_created", note: text(values.note) },
        pendingMessage: "正在记录人工核查结论…",
        successMessage: "已确认上游任务未创建，现在可以安全地重新发起生成。"
      })
    });
  }

  function confirmProviderTaskBinding(task) {
    confirmOperation({
      title: "绑定已存在的 Seedance 任务？",
      message: "仅粘贴已在 Seedance 控制台确认存在、且与本次镜头对应的任务 ID。绑定后系统会继续查询该任务，不会新建视频任务。",
      confirmLabel: "确认绑定",
      iconName: "link",
      fields: [
        {
          name: "provider_task_id",
          label: "Seedance 任务 ID",
          required: true,
          maxlength: 240,
          pattern: "[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}",
          placeholder: "从 Seedance 控制台完整复制",
          hint: "不要猜测或手工拼接 ID。"
        },
        {
          name: "note",
          label: "核查备注",
          type: "textarea",
          required: true,
          minlength: 2,
          maxlength: 500,
          placeholder: "例如：已核对提交时间、镜头内容与任务详情，确认属于本次请求",
          hint: "必填，留下人工绑定依据；请勿填写密钥。"
        }
      ],
      action: (values) => performTaskRecovery(task.id, {
        path: `${API_ROOT}/tasks/${encodeURIComponent(task.id)}/submission-resolution`,
        body: {
          resolution: "provider_task_created",
          provider_task_id: text(values.provider_task_id),
          note: text(values.note)
        },
        pendingMessage: "正在绑定已确认的 Seedance 任务…",
        successMessage: "已绑定 Seedance 任务，系统将继续查询其进度。"
      })
    });
  }

  async function submitSceneGeneration(kind, sceneId = state.selectedSceneId) {
    const project = state.activeProject;
    const scene = project?.scenes.find((item) => item.id === sceneId);
    if (!project?.id || !scene) return;
    const actionLabel = kind === "image" ? "镜头画面" : "镜头视频";
    setNotice(`正在提交${actionLabel}任务…`, "info");
    try {
      const primarySuffix = kind === "image" ? "image" : "video";
      const legacySuffix = "generate";
      const payload = await requestCandidates([
        `${API_ROOT}/projects/${encodeURIComponent(project.id)}/scenes/${encodeURIComponent(scene.id)}/${primarySuffix}`,
        `${LEGACY_API_ROOT}/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(scene.id)}/${legacySuffix}`
      ], { method: "POST", body: { kind, regenerate: true } });
      trackAction(payload, { project_id: project.id, scene_id: scene.id, kind: `scene_${kind}` });
      setNotice(`${actionLabel}任务已提交。生成期间可以继续编辑其他镜头。`, "success");
    } catch (error) {
      setNotice(`${actionLabel}任务提交失败：${error.message}`, "error");
    }
  }

  async function batchGenerateVideos() {
    const project = state.activeProject;
    if (!project?.id || !project.scenes.length) return;
    setNotice(`正在为 ${project.scenes.length} 个镜头提交视频任务…`, "info");
    let submitted = 0;
    const failures = [];
    for (const scene of project.scenes) {
      try {
        const payload = await requestCandidates([
          `${API_ROOT}/projects/${encodeURIComponent(project.id)}/scenes/${encodeURIComponent(scene.id)}/video`,
          `${LEGACY_API_ROOT}/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(scene.id)}/generate`
        ], { method: "POST", body: { kind: "video", regenerate: Boolean(scene.videoUrl) } });
        trackAction(payload, { project_id: project.id, scene_id: scene.id, kind: "scene_video" });
        submitted += 1;
      } catch (error) {
        failures.push(`${scene.title}：${error.message}`);
      }
    }
    if (failures.length) {
      setNotice(`已提交 ${submitted} 个镜头，${failures.length} 个失败。${failures[0]}`, "error");
    } else {
      setNotice(`已提交 ${submitted} 个镜头视频任务，可在任务记录中查看进度。`, "success");
    }
  }

  async function composeProject(button) {
    const project = state.activeProject;
    if (!project?.id) return;
    await runAction(button, async () => {
      setNotice("正在提交成片合成任务…", "info");
      try {
        const payload = await requestCandidates([
          `${API_ROOT}/projects/${encodeURIComponent(project.id)}/compose`,
          `${LEGACY_API_ROOT}/projects/${encodeURIComponent(project.id)}/compose`
        ], { method: "POST", body: {} });
        trackAction(payload, { project_id: project.id, kind: "compose" });
        setNotice("合成任务已提交，成片完成后会出现在中央预览区。", "success");
      } catch (error) {
        setNotice(`成片合成失败：${error.message}`, "error");
      }
    });
  }

  root.addEventListener("click", (event) => {
    const projectButton = event.target.closest("[data-video-project-id]");
    if (projectButton) {
      state.inspectorTab = "scene";
      loadProject(projectButton.dataset.videoProjectId);
      return;
    }
    const sceneButton = event.target.closest("[data-video-scene-id]");
    if (sceneButton) {
      state.selectedSceneId = sceneButton.dataset.videoSceneId;
      state.inspectorTab = "scene";
      renderStudio();
      return;
    }
    const modeButton = event.target.closest("[data-video-source-mode]");
    if (modeButton) {
      setCreateMode(modeButton.dataset.videoSourceMode);
      return;
    }
    const tabButton = event.target.closest("[data-video-inspector-tab]");
    if (tabButton && !tabButton.disabled) {
      state.inspectorTab = tabButton.dataset.videoInspectorTab === "settings" ? "settings" : "scene";
      renderStudio();
      return;
    }
    const actionButton = event.target.closest("[data-video-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.videoAction;
    if (action === "dismiss-notice") setNotice("");
    else if (action === "new-project") {
      state.activeProject = null;
      state.selectedSceneId = "";
      state.inspectorTab = "scene";
      setNotice("");
      renderProjectList();
      renderCreateStage();
    } else if (action === "refresh") {
      loadInitial();
    } else if (action === "refresh-project") {
      loadProject(state.activeProject?.id);
    } else if (action === "recover-task-transfer" || action === "confirm-provider-task-not-created" || action === "bind-provider-task") {
      const taskId = text(actionButton.dataset.videoTaskId);
      const task = state.activeProject?.tasks.find((item) => item.id === taskId);
      if (!task) {
        setNotice("任务状态已经变化，请刷新项目后再试。", "error");
      } else if (action === "recover-task-transfer" && task.transferRecoveryRequired) {
        confirmTransferRecovery(task);
      } else if (action === "confirm-provider-task-not-created" && task.submissionState === "unknown") {
        confirmUnknownNotCreated(task);
      } else if (action === "bind-provider-task" && task.submissionState === "unknown" && isSeedanceTask(task)) {
        confirmProviderTaskBinding(task);
      } else {
        setNotice("该任务已不需要这项恢复操作，请刷新查看最新状态。", "error");
      }
    } else if (action === "open-model-settings") {
      globalThis.AITeacherPortalRuntime?.openWorkspace?.("voice-config");
    } else if (action === "generate-storyboard") {
      generateStoryboard(actionButton);
    } else if (action === "generate-scene-image") {
      const scene = state.activeProject?.scenes.find((item) => item.id === state.selectedSceneId);
      const hasImage = Boolean(scene?.imageUrl);
      confirmGeneration({
        title: hasImage ? "重绘这个镜头？" : "生成这个镜头的画面？",
        message: `将使用服务端配置的图片模型生成“${scene?.title || "当前镜头"}”画面，可能消耗模型额度。${hasImage ? "原画面由服务端版本记录保留。" : "生成前请确认教材页与视觉提示。"}`,
        confirmLabel: hasImage ? "确认重绘" : "确认生成画面",
        action: () => submitSceneGeneration("image")
      });
    } else if (action === "generate-scene-video") {
      const scene = state.activeProject?.scenes.find((item) => item.id === state.selectedSceneId);
      const hasVideo = Boolean(scene?.videoUrl);
      confirmGeneration({
        title: hasVideo ? "重生成这个镜头？" : "生成这个镜头的视频？",
        message: `将使用视频生成模型为“${scene?.title || "当前镜头"}”创建视频，可能消耗模型额度。请先确认讲稿、字幕和视觉提示。`,
        confirmLabel: hasVideo ? "确认重生成" : "确认生成视频",
        action: () => submitSceneGeneration("video")
      });
    } else if (action === "generate-batch") {
      const count = state.activeProject?.scenes.length || 0;
      confirmGeneration({
        title: "批量生成全部镜头？",
        message: `将向视频模型提交 ${count} 个镜头任务，可能消耗较多额度。每个镜头会独立排队，失败后可以单独重做。`,
        confirmLabel: `生成 ${count} 个镜头`,
        action: batchGenerateVideos
      });
    } else if (action === "compose") {
      composeProject(actionButton);
    }
  });

  root.addEventListener("submit", (event) => {
    const createForm = event.target.closest("[data-video-create-form]");
    if (createForm) {
      event.preventDefault();
      createProject(createForm);
      return;
    }
    const sceneForm = event.target.closest("[data-video-scene-form]");
    if (sceneForm) {
      event.preventDefault();
      saveScene(sceneForm);
      return;
    }
    const projectForm = event.target.closest("[data-video-project-settings-form]");
    if (projectForm) {
      event.preventDefault();
      saveProjectSettings(projectForm);
    }
  });

  root.addEventListener("change", (event) => {
    const rangeMode = event.target.closest('select[name="page_range_mode"]');
    if (rangeMode) {
      const form = rangeMode.closest("form");
      const custom = rangeMode.value === "range";
      form?.querySelectorAll('[name="page_start"], [name="page_end"]').forEach((input) => { input.disabled = !custom; });
      if (custom) form?.querySelector('[name="page_start"]')?.focus();
      return;
    }
    const input = event.target.closest('[data-video-create-form] input[type="file"]');
    if (!input) return;
    state.createFile = input.files?.[0] || null;
    renderCreateStage();
  });

  root.addEventListener("dragover", (event) => {
    const zone = event.target.closest("[data-video-drop-zone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("is-dragging");
  });

  root.addEventListener("dragleave", (event) => {
    event.target.closest("[data-video-drop-zone]")?.classList.remove("is-dragging");
  });

  root.addEventListener("drop", (event) => {
    const zone = event.target.closest("[data-video-drop-zone]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-dragging");
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const supported = /\.(ppt|pptx|doc|docx|pdf)$/i.test(file.name);
    if (!supported) {
      setNotice("仅支持 PPT、PPTX、DOC、DOCX 和 PDF 文件。", "error");
      return;
    }
    state.createFile = file;
    renderCreateStage();
  });

  nodes.confirmDialog.addEventListener("close", async () => {
    const confirmed = nodes.confirmDialog.returnValue === "confirm";
    const action = state.confirmAction;
    const values = Object.fromEntries(new FormData(nodes.confirmForm).entries());
    state.confirmAction = null;
    nodes.confirmForm.reset();
    nodes.confirmFields.hidden = true;
    nodes.confirmFields.innerHTML = "";
    if (confirmed && typeof action === "function") await action(values);
  });

  document.addEventListener("learning-workspace:change", (event) => {
    if (event.detail?.view !== "video-explanation") return;
    if (!state.config && !state.loadingProjects && state.configError) loadInitial();
  });

  refreshIcons();
  loadInitial();

  return Object.freeze({
    refresh: loadInitial,
    openProject: loadProject,
    getState: () => ({
      projects: state.projects.length,
      activeProjectId: state.activeProject?.id || null,
      serviceReady: !(state.configError && state.projectsError)
    })
  });
}
