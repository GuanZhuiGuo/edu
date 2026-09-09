import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_DB_PATH = join(moduleDir, "data", "education-runtime", "education.sqlite");
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

export class EducationVideoRepositoryError extends Error {
  constructor(code, message, { status = 500, cause } = {}) {
    super(message, { cause });
    this.name = "EducationVideoRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export function createEducationVideoRepository({
  filename = process.env.EDUCATION_DATA_DB_PATH || DEFAULT_DB_PATH,
  clock = () => new Date().toISOString(),
} = {}) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (filename !== ":memory:") db.pragma("journal_mode = WAL");

  assertSchema();

  function assertSchema() {
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'education_video_projects'").get();
    if (!table) {
      throw new EducationVideoRepositoryError(
        "education_video_schema_missing",
        "Education video schema is not initialized. Run education data migrations first.",
        { status: 503 },
      );
    }
  }

  function createProject({ tenantId, project }) {
    const tenant = requiredId(tenantId, "tenant_id");
    const projectId = requiredId(project?.project_id ?? project?.projectId, "project_id");
    const now = clock();
    try {
      db.prepare(`INSERT INTO education_video_projects(
        tenant_id, project_id, title, description, status, source_import_id,
        source_file_name, source_mime_type, source_document_id, source_document_revision_id,
        audience, language, aspect_ratio, visual_style, presenter_mode, voice_id,
        settings_json, error_json, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          tenant,
          projectId,
          requiredText(project?.title, "title", 500),
          cleanText(project?.description, 4_000),
          normalizeProjectStatus(project?.status || "draft"),
          optionalId(project?.source_import_id, "source_import_id"),
          cleanText(project?.source_file_name, 1_000),
          cleanText(project?.source_mime_type, 240),
          optionalId(project?.source_document_id, "source_document_id"),
          optionalId(project?.source_document_revision_id, "source_document_revision_id"),
          cleanText(project?.audience, 500),
          cleanText(project?.language, 40) || "zh-CN",
          normalizeRatio(project?.aspect_ratio || "16:9"),
          cleanText(project?.visual_style, 160) || "education-clean",
          cleanText(project?.presenter_mode, 80) || "voice_over",
          cleanText(project?.voice_id, 240),
          stringifyJson(project?.settings || {}),
          stringifyJson(project?.error || {}),
          cleanText(project?.created_by, 160),
          now,
          now,
        );
    } catch (cause) {
      throw translateDbError(cause, "create project");
    }
    return getProject({ tenantId: tenant, projectId });
  }

  function updateProject({ tenantId, projectId, patch = {} }) {
    const tenant = requiredId(tenantId, "tenant_id");
    const id = requiredId(projectId, "project_id");
    const allowed = {
      title: patch.title === undefined ? undefined : requiredText(patch.title, "title", 500),
      description: patch.description === undefined ? undefined : cleanText(patch.description, 4_000),
      status: patch.status === undefined ? undefined : normalizeProjectStatus(patch.status),
      source_import_id: patch.source_import_id === undefined ? undefined : optionalId(patch.source_import_id, "source_import_id"),
      source_file_name: patch.source_file_name === undefined ? undefined : cleanText(patch.source_file_name, 1_000),
      source_mime_type: patch.source_mime_type === undefined ? undefined : cleanText(patch.source_mime_type, 240),
      source_document_id: patch.source_document_id === undefined ? undefined : optionalId(patch.source_document_id, "source_document_id"),
      source_document_revision_id: patch.source_document_revision_id === undefined ? undefined : optionalId(patch.source_document_revision_id, "source_document_revision_id"),
      audience: patch.audience === undefined ? undefined : cleanText(patch.audience, 500),
      language: patch.language === undefined ? undefined : cleanText(patch.language, 40),
      aspect_ratio: patch.aspect_ratio === undefined ? undefined : normalizeRatio(patch.aspect_ratio),
      visual_style: patch.visual_style === undefined ? undefined : cleanText(patch.visual_style, 160),
      presenter_mode: patch.presenter_mode === undefined ? undefined : cleanText(patch.presenter_mode, 80),
      voice_id: patch.voice_id === undefined ? undefined : cleanText(patch.voice_id, 240),
      settings_json: patch.settings === undefined ? undefined : stringifyJson(patch.settings),
      error_json: patch.error === undefined ? undefined : stringifyJson(patch.error),
    };
    const entries = Object.entries(allowed).filter(([, value]) => value !== undefined);
    if (!entries.length) return getProject({ tenantId: tenant, projectId: id });
    const result = db.prepare(`UPDATE education_video_projects SET ${entries.map(([key]) => `${key} = ?`).join(", ")}, updated_at = ?
      WHERE tenant_id = ? AND project_id = ?`)
      .run(...entries.map(([, value]) => value), clock(), tenant, id);
    if (!result.changes) throw notFound("project");
    return getProject({ tenantId: tenant, projectId: id });
  }

  function listProjects({ tenantId, status = "", query = "", limit = 50, offset = 0 } = {}) {
    const tenant = requiredId(tenantId, "tenant_id");
    const safeLimit = boundedInteger(limit, 1, 200, 50);
    const safeOffset = boundedInteger(offset, 0, 1_000_000, 0);
    const clauses = ["p.tenant_id = ?"];
    const args = [tenant];
    if (status) {
      clauses.push("p.status = ?");
      args.push(normalizeProjectStatus(status));
    }
    if (query) {
      clauses.push("(p.title LIKE ? ESCAPE '\\' OR p.source_file_name LIKE ? ESCAPE '\\')");
      const pattern = `%${escapeLike(cleanText(query, 500))}%`;
      args.push(pattern, pattern);
    }
    const where = clauses.join(" AND ");
    const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM education_video_projects p WHERE ${where}`).get(...args)?.count || 0);
    const rows = db.prepare(`SELECT p.*,
        (SELECT COUNT(*) FROM education_video_versions v WHERE v.tenant_id = p.tenant_id AND v.project_id = p.project_id) AS version_count,
        (SELECT COUNT(*) FROM education_video_scenes s WHERE s.tenant_id = p.tenant_id AND s.project_id = p.project_id) AS scene_count
      FROM education_video_projects p WHERE ${where}
      ORDER BY p.updated_at DESC, p.project_id DESC LIMIT ? OFFSET ?`)
      .all(...args, safeLimit, safeOffset);
    return {
      schema_version: "education-video-project-list@1.0",
      total,
      limit: safeLimit,
      offset: safeOffset,
      projects: rows.map(projectRow),
    };
  }

  function getProject({ tenantId, projectId, includeDetails = true }) {
    const tenant = requiredId(tenantId, "tenant_id");
    const id = requiredId(projectId, "project_id");
    const row = db.prepare("SELECT * FROM education_video_projects WHERE tenant_id = ? AND project_id = ?").get(tenant, id);
    if (!row) return null;
    const project = projectRow(row);
    if (!includeDetails) return project;
    const versions = db.prepare(`SELECT * FROM education_video_versions
      WHERE tenant_id = ? AND project_id = ? ORDER BY version_number DESC`).all(tenant, id).map(versionRow);
    const scenesByVersion = new Map();
    for (const scene of db.prepare(`SELECT * FROM education_video_scenes
      WHERE tenant_id = ? AND project_id = ? ORDER BY version_id, scene_index`).all(tenant, id).map(sceneRow)) {
      const bucket = scenesByVersion.get(scene.version_id) || [];
      bucket.push(scene);
      scenesByVersion.set(scene.version_id, bucket);
    }
    project.versions = versions.map((version) => ({
      ...version,
      scenes: scenesByVersion.get(version.version_id) || [],
    }));
    project.latest_version = project.versions[0] || null;
    project.assets = db.prepare(`SELECT * FROM education_video_assets
      WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC`).all(tenant, id).map(assetRow);
    project.tasks = db.prepare(`SELECT * FROM education_video_generation_tasks
      WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 200`).all(tenant, id).map(taskRow);
    project.stage = deriveProjectStage(project);
    return project;
  }

  function createVersionWithScenes({ tenantId, projectId, version, scenes }) {
    const tenant = requiredId(tenantId, "tenant_id");
    const project = requiredId(projectId, "project_id");
    const versionId = requiredId(version?.version_id, "version_id");
    if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 200) {
      throw invalid("scenes must contain 1 to 200 entries");
    }
    const now = clock();
    const transaction = db.transaction(() => {
      const nextNumber = version?.version_number == null
        ? Number(db.prepare(`SELECT COALESCE(MAX(version_number), 0) + 1 AS next_number
          FROM education_video_versions WHERE tenant_id = ? AND project_id = ?`).get(tenant, project)?.next_number || 1)
        : boundedInteger(version.version_number, 1, 1_000_000, 1);
      db.prepare(`INSERT INTO education_video_versions(
        tenant_id, project_id, version_id, version_number, status, title, overview,
        learning_objectives_json, script_json, subtitle_json, generation_settings_json,
        composed_output_json, model_receipt_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          tenant, project, versionId, nextNumber, normalizeVersionStatus(version?.status || "ready"),
          cleanText(version?.title, 500), cleanText(version?.overview, 8_000),
          stringifyJson(version?.learning_objectives || []), stringifyJson(version?.script || {}),
          stringifyJson(version?.subtitle || {}), stringifyJson(version?.generation_settings || {}),
          stringifyJson(version?.composed_output || {}), stringifyJson(version?.model_receipt || {}), now, now,
        );
      const insertScene = db.prepare(`INSERT INTO education_video_scenes(
        tenant_id, project_id, version_id, scene_id, scene_index, title, narration_text,
        subtitle_text, visual_type, visual_prompt, duration_seconds, key_points_json,
        source_refs_json, reference_assets_json, image_output_json, video_output_json,
        status, error_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      scenes.forEach((scene, index) => {
        insertScene.run(
          tenant, project, versionId, requiredId(scene?.scene_id, "scene_id"), index,
          requiredText(scene?.title, "scene.title", 500), cleanText(scene?.narration_text, 30_000),
          cleanText(scene?.subtitle_text, 30_000), cleanText(scene?.visual_type, 120) || "slide_explanation",
          cleanText(scene?.visual_prompt, 30_000), boundedInteger(scene?.duration_seconds, 4, 30, 8),
          stringifyJson(scene?.key_points || []), stringifyJson(scene?.source_refs || []),
          stringifyJson(scene?.reference_assets || []), stringifyJson(scene?.image_output || {}),
          stringifyJson(scene?.video_output || {}), normalizeSceneStatus(scene?.status || "ready"),
          stringifyJson(scene?.error || {}), now, now,
        );
      });
      db.prepare("UPDATE education_video_projects SET status = 'ready', error_json = '{}', updated_at = ? WHERE tenant_id = ? AND project_id = ?")
        .run(now, tenant, project);
      return nextNumber;
    });
    try { transaction(); } catch (cause) { throw translateDbError(cause, "create video version"); }
    return getProject({ tenantId: tenant, projectId: project });
  }

  function updateVersion({ tenantId, versionId, patch = {} }) {
    const tenant = requiredId(tenantId, "tenant_id");
    const id = requiredId(versionId, "version_id");
    const allowed = {
      status: patch.status === undefined ? undefined : normalizeVersionStatus(patch.status),
      title: patch.title === undefined ? undefined : cleanText(patch.title, 500),
      overview: patch.overview === undefined ? undefined : cleanText(patch.overview, 8_000),
      learning_objectives_json: patch.learning_objectives === undefined ? undefined : stringifyJson(patch.learning_objectives),
      script_json: patch.script === undefined ? undefined : stringifyJson(patch.script),
      subtitle_json: patch.subtitle === undefined ? undefined : stringifyJson(patch.subtitle),
      generation_settings_json: patch.generation_settings === undefined ? undefined : stringifyJson(patch.generation_settings),
      composed_output_json: patch.composed_output === undefined ? undefined : stringifyJson(patch.composed_output),
      model_receipt_json: patch.model_receipt === undefined ? undefined : stringifyJson(patch.model_receipt),
    };
    updateRow("education_video_versions", "version_id", tenant, id, allowed);
    return versionRow(db.prepare("SELECT * FROM education_video_versions WHERE tenant_id = ? AND version_id = ?").get(tenant, id));
  }

  function getScene({ tenantId, sceneId }) {
    const row = db.prepare("SELECT * FROM education_video_scenes WHERE tenant_id = ? AND scene_id = ?")
      .get(requiredId(tenantId, "tenant_id"), requiredId(sceneId, "scene_id"));
    return row ? sceneRow(row) : null;
  }

  function updateScene({ tenantId, sceneId, patch = {} }) {
    const tenant = requiredId(tenantId, "tenant_id");
    const id = requiredId(sceneId, "scene_id");
    const allowed = {
      title: patch.title === undefined ? undefined : requiredText(patch.title, "title", 500),
      narration_text: patch.narration_text === undefined ? undefined : cleanText(patch.narration_text, 30_000),
      subtitle_text: patch.subtitle_text === undefined ? undefined : cleanText(patch.subtitle_text, 30_000),
      visual_type: patch.visual_type === undefined ? undefined : cleanText(patch.visual_type, 120),
      visual_prompt: patch.visual_prompt === undefined ? undefined : cleanText(patch.visual_prompt, 30_000),
      duration_seconds: patch.duration_seconds === undefined ? undefined : boundedInteger(patch.duration_seconds, 4, 30, 8),
      key_points_json: patch.key_points === undefined ? undefined : stringifyJson(patch.key_points),
      source_refs_json: patch.source_refs === undefined ? undefined : stringifyJson(patch.source_refs),
      reference_assets_json: patch.reference_assets === undefined ? undefined : stringifyJson(patch.reference_assets),
      image_output_json: patch.image_output === undefined ? undefined : stringifyJson(patch.image_output),
      video_output_json: patch.video_output === undefined ? undefined : stringifyJson(patch.video_output),
      status: patch.status === undefined ? undefined : normalizeSceneStatus(patch.status),
      error_json: patch.error === undefined ? undefined : stringifyJson(patch.error),
    };
    updateRow("education_video_scenes", "scene_id", tenant, id, allowed);
    return getScene({ tenantId: tenant, sceneId: id });
  }

  function createTask({ tenantId, task }) {
    const tenant = requiredId(tenantId, "tenant_id");
    const now = clock();
    try {
      db.prepare(`INSERT INTO education_video_generation_tasks(
        tenant_id, task_id, project_id, version_id, scene_id, task_type, provider,
        model, provider_task_id, submission_state, status, request_json, response_json,
        output_url, local_output_path, error_json, attempt_count, next_poll_at,
        user_initiated, started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          tenant, requiredId(task?.task_id, "task_id"), requiredId(task?.project_id, "project_id"),
          requiredId(task?.version_id, "version_id"), optionalId(task?.scene_id, "scene_id"),
          normalizeTaskType(task?.task_type), cleanText(task?.provider, 80) || "ark",
          cleanText(task?.model, 240), optionalProviderTaskId(task?.provider_task_id),
          normalizeSubmissionState(task?.submission_state || "not_submitted"), normalizeTaskStatus(task?.status || "queued"),
          stringifyJson(task?.request || {}), stringifyJson(task?.response || {}),
          nullableText(task?.output_url, 16_000), nullableText(task?.local_output_path, 4_000),
          stringifyJson(task?.error || {}), boundedInteger(task?.attempt_count, 0, 1_000, 0),
          nullableIso(task?.next_poll_at), task?.user_initiated === false ? 0 : 1,
          nullableIso(task?.started_at), nullableIso(task?.completed_at), now, now,
        );
    } catch (cause) { throw translateDbError(cause, "create generation task"); }
    return getTask({ tenantId: tenant, taskId: task.task_id });
  }

  function createAsset({ tenantId, asset }) {
    const tenant = requiredId(tenantId, "tenant_id");
    const now = clock();
    try {
      db.prepare(`INSERT INTO education_video_assets(
        tenant_id, asset_id, project_id, version_id, scene_id, asset_type, status,
        provider, provider_ref, source_url, local_path, mime_type, metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          tenant, requiredId(asset?.asset_id, "asset_id"), requiredId(asset?.project_id, "project_id"),
          requiredId(asset?.version_id, "version_id"), optionalId(asset?.scene_id, "scene_id"),
          enumValue(asset?.asset_type, new Set(["source_page", "image", "video", "narration", "subtitle", "music", "composed_video"]), "asset type"),
          enumValue(asset?.status || "ready", new Set(["draft", "ready", "failed", "superseded"]), "asset status"),
          cleanText(asset?.provider, 80), nullableText(asset?.provider_ref, 500),
          nullableText(asset?.source_url, 16_000), nullableText(asset?.local_path, 4_000),
          cleanText(asset?.mime_type, 240), stringifyJson(asset?.metadata || {}), now, now,
        );
    } catch (cause) { throw translateDbError(cause, "create video asset"); }
    return getAsset({ tenantId: tenant, assetId: asset.asset_id });
  }

  function getAsset({ tenantId, assetId }) {
    const row = db.prepare("SELECT * FROM education_video_assets WHERE tenant_id = ? AND asset_id = ?")
      .get(requiredId(tenantId, "tenant_id"), requiredId(assetId, "asset_id"));
    return row ? assetRow(row) : null;
  }

  function listAssets({ tenantId, projectId, versionId = "", sceneId = "" }) {
    const tenant = requiredId(tenantId, "tenant_id");
    const clauses = ["tenant_id = ?", "project_id = ?"];
    const args = [tenant, requiredId(projectId, "project_id")];
    if (versionId) { clauses.push("version_id = ?"); args.push(requiredId(versionId, "version_id")); }
    if (sceneId) { clauses.push("scene_id = ?"); args.push(requiredId(sceneId, "scene_id")); }
    return db.prepare(`SELECT * FROM education_video_assets WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`)
      .all(...args).map(assetRow);
  }

  function updateTask({ tenantId, taskId, patch = {} }) {
    const tenant = requiredId(tenantId, "tenant_id");
    const id = requiredId(taskId, "task_id");
    const allowed = {
      provider_task_id: patch.provider_task_id === undefined ? undefined : optionalProviderTaskId(patch.provider_task_id),
      submission_state: patch.submission_state === undefined ? undefined : normalizeSubmissionState(patch.submission_state),
      status: patch.status === undefined ? undefined : normalizeTaskStatus(patch.status),
      request_json: patch.request === undefined ? undefined : stringifyJson(patch.request),
      response_json: patch.response === undefined ? undefined : stringifyJson(patch.response),
      output_url: patch.output_url === undefined ? undefined : nullableText(patch.output_url, 16_000),
      local_output_path: patch.local_output_path === undefined ? undefined : nullableText(patch.local_output_path, 4_000),
      error_json: patch.error === undefined ? undefined : stringifyJson(patch.error),
      attempt_count: patch.attempt_count === undefined ? undefined : boundedInteger(patch.attempt_count, 0, 1_000, 0),
      next_poll_at: patch.next_poll_at === undefined ? undefined : nullableIso(patch.next_poll_at),
      started_at: patch.started_at === undefined ? undefined : nullableIso(patch.started_at),
      completed_at: patch.completed_at === undefined ? undefined : nullableIso(patch.completed_at),
    };
    updateRow("education_video_generation_tasks", "task_id", tenant, id, allowed);
    return getTask({ tenantId: tenant, taskId: id });
  }

  function getTask({ tenantId, taskId }) {
    const row = db.prepare("SELECT * FROM education_video_generation_tasks WHERE tenant_id = ? AND task_id = ?")
      .get(requiredId(tenantId, "tenant_id"), requiredId(taskId, "task_id"));
    return row ? taskRow(row) : null;
  }

  function listTasks({ tenantId, projectId = "", statuses = [], limit = 100 } = {}) {
    const tenant = requiredId(tenantId, "tenant_id");
    const clauses = ["tenant_id = ?"];
    const args = [tenant];
    if (projectId) {
      clauses.push("project_id = ?");
      args.push(requiredId(projectId, "project_id"));
    }
    if (statuses.length) {
      const normalized = statuses.map(normalizeTaskStatus);
      clauses.push(`status IN (${normalized.map(() => "?").join(",")})`);
      args.push(...normalized);
    }
    return db.prepare(`SELECT * FROM education_video_generation_tasks
      WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
      .all(...args, boundedInteger(limit, 1, 500, 100)).map(taskRow);
  }

  function updateRow(table, idColumn, tenant, id, allowed) {
    const entries = Object.entries(allowed).filter(([, value]) => value !== undefined);
    if (!entries.length) return;
    const result = db.prepare(`UPDATE ${table} SET ${entries.map(([key]) => `${key} = ?`).join(", ")}, updated_at = ?
      WHERE tenant_id = ? AND ${idColumn} = ?`)
      .run(...entries.map(([, value]) => value), clock(), tenant, id);
    if (!result.changes) throw notFound(table);
  }

  function close() { db.close(); }

  return Object.freeze({
    createProject,
    updateProject,
    listProjects,
    getProject,
    createVersionWithScenes,
    updateVersion,
    getScene,
    updateScene,
    createAsset,
    getAsset,
    listAssets,
    createTask,
    updateTask,
    getTask,
    listTasks,
    close,
  });
}

const PROJECT_STATUSES = new Set(["draft", "importing", "source_ready", "storyboarding", "ready", "generating", "composing", "completed", "failed", "archived"]);
const VERSION_STATUSES = new Set(["draft", "storyboarding", "ready", "generating", "composing", "completed", "failed", "superseded"]);
const SCENE_STATUSES = new Set(["draft", "ready", "image_queued", "image_generating", "image_ready", "video_queued", "video_generating", "completed", "failed"]);
const TASK_STATUSES = new Set(["queued", "submitting", "running", "succeeded", "failed", "cancel_requested", "cancelled", "unavailable"]);
const TASK_TYPES = new Set(["seedream_image", "seedance_video", "compose_video"]);
const SUBMISSION_STATES = new Set(["not_submitted", "submitting", "confirmed", "unknown"]);

function projectRow(row) {
  return {
    schema_version: "education-video-project@1.0",
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    source_import_id: row.source_import_id || null,
    source_file_name: row.source_file_name,
    source_mime_type: row.source_mime_type,
    source_document_id: row.source_document_id || null,
    source_document_revision_id: row.source_document_revision_id || null,
    audience: row.audience,
    language: row.language,
    aspect_ratio: row.aspect_ratio,
    visual_style: row.visual_style,
    presenter_mode: row.presenter_mode,
    voice_id: row.voice_id,
    settings: parseJson(row.settings_json, {}),
    error: parseJson(row.error_json, {}),
    created_by: row.created_by,
    version_count: Number(row.version_count || 0),
    scene_count: Number(row.scene_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function versionRow(row) {
  if (!row) return null;
  return {
    version_id: row.version_id,
    project_id: row.project_id,
    version_number: Number(row.version_number),
    status: row.status,
    title: row.title,
    overview: row.overview,
    learning_objectives: parseJson(row.learning_objectives_json, []),
    script: parseJson(row.script_json, {}),
    subtitle: parseJson(row.subtitle_json, {}),
    generation_settings: parseJson(row.generation_settings_json, {}),
    composed_output: parseJson(row.composed_output_json, {}),
    model_receipt: parseJson(row.model_receipt_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function sceneRow(row) {
  return {
    scene_id: row.scene_id,
    project_id: row.project_id,
    version_id: row.version_id,
    scene_index: Number(row.scene_index),
    title: row.title,
    narration_text: row.narration_text,
    subtitle_text: row.subtitle_text,
    visual_type: row.visual_type,
    visual_prompt: row.visual_prompt,
    duration_seconds: Number(row.duration_seconds),
    key_points: parseJson(row.key_points_json, []),
    source_refs: parseJson(row.source_refs_json, []),
    reference_assets: parseJson(row.reference_assets_json, []),
    image_output: parseJson(row.image_output_json, {}),
    video_output: parseJson(row.video_output_json, {}),
    status: row.status,
    error: parseJson(row.error_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function taskRow(row) {
  return {
    schema_version: "education-video-generation-task@1.0",
    task_id: row.task_id,
    project_id: row.project_id,
    version_id: row.version_id,
    scene_id: row.scene_id || null,
    task_type: row.task_type,
    provider: row.provider,
    model: row.model,
    provider_task_id: row.provider_task_id || null,
    submission_state: row.submission_state,
    status: row.status,
    request: parseJson(row.request_json, {}),
    response: parseJson(row.response_json, {}),
    output_url: row.output_url || null,
    local_output_path: row.local_output_path || null,
    error: parseJson(row.error_json, {}),
    attempt_count: Number(row.attempt_count),
    next_poll_at: row.next_poll_at || null,
    user_initiated: Boolean(row.user_initiated),
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function deriveProjectStage(project) {
  const latest = project.latest_version;
  const activeTasks = project.tasks.filter((task) => ["queued", "submitting", "running", "cancel_requested"].includes(task.status));
  return {
    source: project.source_import_id
      ? project.source_document_id ? "ready" : project.status === "failed" ? "failed" : "processing"
      : "missing",
    storyboard: latest
      ? latest.status === "failed" ? "failed" : "ready"
      : project.status === "storyboarding" ? "processing" : "pending",
    media: activeTasks.length
      ? "processing"
      : project.tasks.some((task) => task.status === "failed" || task.submission_state === "unknown")
        ? "attention"
        : project.tasks.some((task) => task.status === "succeeded") ? "partial_or_ready" : "pending",
    composition: latest?.composed_output?.local_path ? "ready" : latest?.status === "composing" ? "processing" : "pending",
    active_task_count: activeTasks.length,
  };
}

function assetRow(row) {
  return {
    asset_id: row.asset_id,
    project_id: row.project_id,
    version_id: row.version_id,
    scene_id: row.scene_id || null,
    asset_type: row.asset_type,
    status: row.status,
    provider: row.provider,
    provider_ref: row.provider_ref || null,
    source_url: row.source_url || null,
    local_path: row.local_path || null,
    mime_type: row.mime_type,
    metadata: parseJson(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeProjectStatus(value) { return enumValue(value, PROJECT_STATUSES, "project status"); }
function normalizeVersionStatus(value) { return enumValue(value, VERSION_STATUSES, "version status"); }
function normalizeSceneStatus(value) { return enumValue(value, SCENE_STATUSES, "scene status"); }
function normalizeTaskStatus(value) { return enumValue(value, TASK_STATUSES, "task status"); }
function normalizeTaskType(value) { return enumValue(value, TASK_TYPES, "task type"); }
function normalizeSubmissionState(value) { return enumValue(value, SUBMISSION_STATES, "submission state"); }

function enumValue(value, allowed, field) {
  const normalized = cleanText(value, 120);
  if (!allowed.has(normalized)) throw invalid(`${field} is invalid`);
  return normalized;
}

function requiredId(value, field) {
  const id = cleanText(value, 128);
  if (!ID_PATTERN.test(id)) throw invalid(`${field} is invalid`);
  return id;
}

function optionalId(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return requiredId(value, field);
}

function optionalProviderTaskId(value) {
  if (value === undefined || value === null || value === "") return null;
  const id = cleanText(value, 240);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/u.test(id)) throw invalid("provider_task_id is invalid");
  return id;
}

function requiredText(value, field, maxLength) {
  const text = cleanText(value, maxLength);
  if (!text) throw invalid(`${field} is required`);
  return text;
}

function cleanText(value, maxLength) { return typeof value === "string" ? value.trim().slice(0, maxLength) : ""; }
function nullableText(value, maxLength) { return value === null || value === "" ? null : cleanText(value, maxLength) || null; }
function nullableIso(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw invalid("timestamp is invalid");
  return date.toISOString();
}
function normalizeRatio(value) {
  const ratio = cleanText(value, 20);
  if (!["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(ratio)) throw invalid("aspect_ratio is invalid");
  return ratio;
}
function boundedInteger(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw invalid(`integer must be between ${min} and ${max}`);
  return number;
}
function stringifyJson(value) {
  try { return JSON.stringify(value ?? {}); } catch { throw invalid("value must be JSON serializable"); }
}
function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function escapeLike(value) { return value.replace(/[\\%_]/gu, (match) => `\\${match}`); }
function invalid(message) { return new EducationVideoRepositoryError("education_video_invalid_input", message, { status: 400 }); }
function notFound(resource) { return new EducationVideoRepositoryError("education_video_not_found", `${resource} was not found`, { status: 404 }); }
function translateDbError(cause, operation) {
  if (cause instanceof EducationVideoRepositoryError) return cause;
  if (String(cause?.code || "").startsWith("SQLITE_CONSTRAINT")) {
    return new EducationVideoRepositoryError("education_video_conflict", `Cannot ${operation} because related data conflicts`, { status: 409, cause });
  }
  return new EducationVideoRepositoryError("education_video_storage_error", `Cannot ${operation}`, { status: 503, cause });
}
