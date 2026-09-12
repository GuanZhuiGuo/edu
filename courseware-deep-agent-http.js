import { CoursewareDeepAgentError } from "./courseware-deep-agent.js";

const CONFIG_PATH = "/api/courseware-agent/config";
const PLAN_PATH = "/api/courseware-agent/plan";
const MAX_BODY_BYTES = 64 * 1024;

export function createCoursewareDeepAgentHttpHandler({ agent, authorizeRequest } = {}) {
  if (!agent || typeof agent.plan !== "function" || typeof agent.configSummary !== "function") {
    throw new TypeError("courseware deep agent is required");
  }
  return async function handleCoursewareDeepAgentHttp(req, res, requestUrl) {
    const pathname = requestUrl?.pathname || new URL(req.url, "http://localhost").pathname;
    if (pathname !== CONFIG_PATH && pathname !== PLAN_PATH) return false;
    if (typeof authorizeRequest === "function" && authorizeRequest(req) !== true) {
      sendJson(res, 403, { error: "courseware_agent_forbidden", message: "课件 Agent 当前仅允许从本机访问。" });
      return true;
    }
    if (pathname === CONFIG_PATH) {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      sendJson(res, 200, agent.configSummary());
      return true;
    }
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    const controller = new AbortController();
    const abort = () => { if (!controller.signal.aborted) controller.abort(); };
    req.once("aborted", abort);
    res.once("close", abort);
    try {
      const input = await readJson(req);
      const result = await agent.plan(input, { signal: controller.signal });
      if (!res.destroyed && !res.writableEnded) sendJson(res, 200, result);
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) sendPublicError(res, error);
    } finally {
      req.off("aborted", abort);
      res.off("close", abort);
    }
    return true;
  };
}

async function readJson(req) {
  if (!String(req.headers?.["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new CoursewareDeepAgentError("courseware_plan_content_type_invalid", "请求必须使用 application/json。", { status: 415 });
  }
  const declared = Number(req.headers?.["content-length"] || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new CoursewareDeepAgentError("courseware_plan_too_large", "课件规划请求过大。", { status: 413 });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new CoursewareDeepAgentError("courseware_plan_too_large", "课件规划请求过大。", { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CoursewareDeepAgentError("courseware_plan_json_invalid", "请求内容不是合法 JSON。", { status: 400 });
  }
}

function sendPublicError(res, error) {
  if (error instanceof CoursewareDeepAgentError) {
    sendJson(res, error.status, { error: error.code, message: error.message });
    return;
  }
  sendJson(res, 500, { error: "courseware_agent_failed", message: "课件 Agent 暂时不可用。" });
}

function methodNotAllowed(res, allow) {
  res.setHeader("allow", allow);
  sendJson(res, 405, { error: "method_not_allowed", message: `仅支持 ${allow}` });
  return true;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
