import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import Busboy from "busboy";

import { ArkMediaClientError } from "./ark-media-client.js";
import { EducationVideoRepositoryError } from "./education-video-repository.js";
import { EducationVideoServiceError } from "./education-video-service.js";

const BASE_PATH = "/api/education/videos";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const PROJECT_FIELDS = new Set([
  "title", "description", "audience", "language", "aspect_ratio", "visual_style",
  "presenter_mode", "voice_id", "duration_minutes", "subject", "grade_band",
  "settings", "course_type", "ratio", "target_duration_minutes", "page_range_mode",
  "page_start", "page_end", "target_scene_count", "resolution",
]);

export function createEducationVideoHttpHandler({
  service,
  authorizeRequest = () => true,
  resolveIdentity = () => ({ actor_id: "local-video-editor" }),
  maxUploadBytes = MAX_UPLOAD_BYTES,
} = {}) {
  if (!service || typeof service.listProjects !== "function") throw new TypeError("education video service is required");

  return async function handleEducationVideoHttp(req, res, requestUrl) {
    if (!requestUrl.pathname.startsWith(BASE_PATH)) return false;
    if (!authorizeRequest(req)) {
      sendJson(res, 403, { error: "education_video_forbidden", message: "当前请求不能访问视频讲解" });
      return true;
    }
    try {
      if (requestUrl.pathname === `${BASE_PATH}/config` && req.method === "GET") {
        sendJson(res, 200, typeof service.getConfig === "function" ? await service.getConfig() : service.configSummary());
        return true;
      }

      if (requestUrl.pathname === `${BASE_PATH}/projects` && req.method === "GET") {
        sendJson(res, 200, service.listProjects({
          status: requestUrl.searchParams.get("status") || "",
          query: requestUrl.searchParams.get("q") || "",
          limit: requestUrl.searchParams.get("limit") || 50,
          offset: requestUrl.searchParams.get("offset") || 0,
        }));
        return true;
      }

      if (requestUrl.pathname === `${BASE_PATH}/projects` && req.method === "POST") {
        const identity = await resolveIdentity(req);
        if (String(req.headers["content-type"] || "").toLowerCase().startsWith("multipart/form-data")) {
          const upload = await readMultipart(req, { maxUploadBytes });
          const project = await service.createProjectFromUpload({
            file: upload.file,
            fields: normalizeUploadFields(upload.fields),
            actorId: identity?.actor_id || "local-video-editor",
          });
          sendJson(res, 202, project);
        } else {
          const body = await readJson(req, MAX_JSON_BYTES);
          const project = await service.createProjectFromImport({
            importId: body.source_import_id,
            title: body.title,
            settings: body.settings || body,
            actorId: identity?.actor_id || "local-video-editor",
          });
          sendJson(res, 201, project);
        }
        return true;
      }

      if (requestUrl.pathname === `${BASE_PATH}/tasks` && req.method === "GET") {
        sendJson(res, 200, service.listTasks({
          projectId: requestUrl.searchParams.get("project_id") || "",
          statuses: requestUrl.searchParams.getAll("status"),
          limit: requestUrl.searchParams.get("limit") || 100,
        }));
        return true;
      }

      const assetMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/assets\/([A-Za-z0-9_.:-]{1,128})\/content$/u);
      if (assetMatch && req.method === "GET") {
        await streamAsset(req, res, service.getAsset(assetMatch[1]));
        return true;
      }

      const taskMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/tasks\/([A-Za-z0-9_.:-]{1,128})$/u);
      if (taskMatch && req.method === "GET") {
        sendJson(res, 200, service.getTask(taskMatch[1]));
        return true;
      }
      if (taskMatch && req.method === "DELETE") {
        sendJson(res, 200, await service.cancelTask(taskMatch[1]));
        return true;
      }

      const taskPollMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/tasks\/([A-Za-z0-9_.:-]{1,128})\/poll$/u);
      if (taskPollMatch && req.method === "POST") {
        sendJson(res, 200, await service.pollTask(taskPollMatch[1]));
        return true;
      }

      const taskTransferMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/tasks\/([A-Za-z0-9_.:-]{1,128})\/transfer$/u);
      if (taskTransferMatch && req.method === "POST") {
        sendJson(res, 200, await service.retryTaskTransfer(taskTransferMatch[1]));
        return true;
      }

      const taskResolutionMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/tasks\/([A-Za-z0-9_.:-]{1,128})\/submission-resolution$/u);
      if (taskResolutionMatch && req.method === "POST") {
        sendJson(res, 200, await service.resolveUnknownSubmission(taskResolutionMatch[1], await readJson(req, MAX_JSON_BYTES)));
        return true;
      }

      const sceneMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/projects\/([A-Za-z0-9_.:-]{1,128})\/scenes\/([A-Za-z0-9_.:-]{1,128})$/u);
      if (sceneMatch && req.method === "PATCH") {
        sendJson(res, 200, service.updateScene(sceneMatch[1], sceneMatch[2], await readJson(req, MAX_JSON_BYTES)));
        return true;
      }

      const sceneGenerateMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/projects\/([A-Za-z0-9_.:-]{1,128})\/scenes\/([A-Za-z0-9_.:-]{1,128})\/(image|video)(?:\/(?:generate|regenerate))?$/u);
      if (sceneGenerateMatch && req.method === "POST") {
        const body = await readJson(req, MAX_JSON_BYTES);
        const task = sceneGenerateMatch[3] === "image"
          ? await service.generateSceneImage(sceneGenerateMatch[1], sceneGenerateMatch[2], body)
          : await service.generateSceneVideo(sceneGenerateMatch[1], sceneGenerateMatch[2], body);
        sendJson(res, sceneGenerateMatch[3] === "image" ? 200 : 202, task);
        return true;
      }

      const syncMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/projects\/([A-Za-z0-9_.:-]{1,128})\/sync-import$/u);
      if (syncMatch && req.method === "POST") {
        sendJson(res, 200, await service.syncImport(syncMatch[1]));
        return true;
      }

      const storyboardMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/projects\/([A-Za-z0-9_.:-]{1,128})\/storyboard$/u);
      if (storyboardMatch && req.method === "POST") {
        sendJson(res, 201, await service.createStoryboard(storyboardMatch[1], await readJson(req, MAX_JSON_BYTES)));
        return true;
      }

      const composeMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/projects\/([A-Za-z0-9_.:-]{1,128})\/compose$/u);
      if (composeMatch && req.method === "POST") {
        sendJson(res, 202, await service.composeProject(composeMatch[1], await readJson(req, MAX_JSON_BYTES)));
        return true;
      }

      const projectMatch = requestUrl.pathname.match(/^\/api\/education\/videos\/projects\/([A-Za-z0-9_.:-]{1,128})$/u);
      if (projectMatch && req.method === "GET") {
        sendJson(res, 200, service.getProject(projectMatch[1]));
        return true;
      }
      if (projectMatch && req.method === "PATCH") {
        sendJson(res, 200, service.updateProject(projectMatch[1], await readJson(req, MAX_JSON_BYTES)));
        return true;
      }

      sendJson(res, 405, { error: "education_video_method_not_allowed", message: "当前视频讲解操作不受支持" });
      return true;
    } catch (error) {
      sendError(res, error);
      return true;
    }
  };
}

function normalizeUploadFields(fields) {
  let settings = {};
  if (fields.settings) {
    try {
      const parsed = JSON.parse(fields.settings);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed;
    } catch {
      throw new EducationVideoServiceError("education_video_settings_invalid", "settings 必须是 JSON 对象", { status: 400 });
    }
  }
  const merged = { ...settings, ...fields };
  delete merged.settings;
  return {
    ...merged,
    aspect_ratio: merged.aspect_ratio || merged.ratio || "16:9",
    duration_minutes: merged.duration_minutes || merged.target_duration_minutes || "",
  };
}

function readMultipart(req, { maxUploadBytes }) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        defParamCharset: "utf8",
        limits: { files: 1, fileSize: maxUploadBytes, fields: 30, fieldSize: 128 * 1024, parts: 40 },
      });
    } catch {
      reject(new EducationVideoServiceError("education_video_multipart_required", "请使用文件上传", { status: 415 }));
      return;
    }
    const fields = {};
    const chunks = [];
    let file = null;
    let tooLarge = false;
    let settled = false;
    const fail = (error) => { if (!settled) { settled = true; reject(error); } };
    parser.on("field", (name, value) => { if (PROJECT_FIELDS.has(name)) fields[name] = String(value || "").trim(); });
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || file) { stream.resume(); return; }
      file = { fileName: String(info.filename || "source.pdf"), mimeType: String(info.mimeType || "application/octet-stream") };
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.once("limit", () => { tooLarge = true; });
      stream.once("error", fail);
    });
    parser.once("error", () => fail(new EducationVideoServiceError("education_video_multipart_invalid", "上传数据无效", { status: 400 })));
    parser.once("finish", () => {
      if (settled) return;
      if (tooLarge) return fail(new EducationVideoServiceError("education_video_source_too_large", "上传文件过大", { status: 413 }));
      if (!file) return fail(new EducationVideoServiceError("education_video_source_missing", "请选择教材文件", { status: 400 }));
      settled = true;
      resolve({ file: { ...file, bytes: Buffer.concat(chunks) }, fields });
    });
    req.pipe(parser);
  });
}

async function readJson(req, maxBytes) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > maxBytes) throw new EducationVideoServiceError("education_video_json_too_large", "请求数据过大", { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new EducationVideoServiceError("education_video_json_too_large", "请求数据过大", { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new EducationVideoServiceError("education_video_json_invalid", "请求 JSON 无效", { status: 400 });
  }
}

async function streamAsset(req, res, { asset, absolutePath }) {
  const info = await stat(absolutePath);
  const range = parseRange(req.headers.range, info.size);
  res.setHeader("Content-Type", asset.mime_type || "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  if (range) {
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    createReadStream(absolutePath, { start: range.start, end: range.end }).pipe(res);
  } else {
    res.statusCode = 200;
    res.setHeader("Content-Length", String(info.size));
    createReadStream(absolutePath).pipe(res);
  }
}

function parseRange(value, size) {
  if (!value) return null;
  const match = String(value).match(/^bytes=(\d*)-(\d*)$/u);
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) { const length = Number(match[2]); start = Math.max(0, size - length); end = size - 1; }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function sendError(res, error) {
  const known = error instanceof EducationVideoServiceError
    || error instanceof EducationVideoRepositoryError
    || error instanceof ArkMediaClientError;
  sendJson(res, known && Number.isInteger(error.status) ? error.status : 500, {
    error: known ? error.code : "education_video_internal_error",
    message: known ? error.message : "视频讲解处理失败",
    retryable: known && error.retryable === true,
    ...(known && error.details ? { details: error.details } : {}),
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload), "Cache-Control": "no-store" });
  res.end(payload);
}
