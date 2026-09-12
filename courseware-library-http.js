import { CoursewareLibraryRepositoryError } from "./courseware-library-repository.js";

const ROOT_PATH = "/api/courseware-library";
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function createCoursewareLibraryHttpHandler({ repository, authorizeRequest } = {}) {
  if (!repository || typeof repository.list !== "function" || typeof repository.save !== "function" || typeof repository.delete !== "function") {
    throw new TypeError("courseware library repository is required");
  }
  return async function handleCoursewareLibraryHttp(req, res, requestUrl) {
    const pathname = requestUrl?.pathname || new URL(req.url, "http://localhost").pathname;
    if (pathname !== ROOT_PATH && !pathname.startsWith(`${ROOT_PATH}/`)) return false;
    if (typeof authorizeRequest === "function" && authorizeRequest(req) !== true) {
      sendJson(res, 403, { error: "courseware_library_forbidden", message: "课件库当前仅允许从本机访问。" });
      return true;
    }
    try {
      if (pathname === ROOT_PATH && req.method === "GET") {
        sendJson(res, 200, { items: await repository.list() });
        return true;
      }
      if (pathname === ROOT_PATH && req.method === "POST") {
        sendJson(res, 200, { item: await repository.save(await readJson(req)) });
        return true;
      }
      if (pathname.startsWith(`${ROOT_PATH}/`) && req.method === "DELETE") {
        let id;
        try { id = decodeURIComponent(pathname.slice(ROOT_PATH.length + 1)); }
        catch { throw new CoursewareLibraryRepositoryError("courseware_id_invalid", "课件 ID 无效。", { status: 400 }); }
        sendJson(res, 200, { id, deleted: await repository.delete(id) });
        return true;
      }
      res.setHeader("allow", pathname === ROOT_PATH ? "GET, POST" : "DELETE");
      sendJson(res, 405, { error: "method_not_allowed", message: "请求方法不受支持。" });
    } catch (error) {
      if (error instanceof CoursewareLibraryRepositoryError) {
        sendJson(res, error.status, { error: error.code, message: error.message });
      } else {
        sendJson(res, 500, { error: "courseware_library_failed", message: "课件库暂时不可用。" });
      }
    }
    return true;
  };
}

async function readJson(req) {
  if (!String(req.headers?.["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new CoursewareLibraryRepositoryError("courseware_content_type_invalid", "请求必须使用 application/json。", { status: 415 });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new CoursewareLibraryRepositoryError("courseware_content_too_large", "课件请求超过 4 MB。", { status: 413 });
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new CoursewareLibraryRepositoryError("courseware_json_invalid", "课件请求不是合法 JSON。", { status: 400 }); }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
