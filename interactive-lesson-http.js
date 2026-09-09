import { InteractiveLessonContractError } from "./interactive-lesson-contract.js";
import { PiTeachingAgentError } from "./pi-teaching-agent.js";

const CONFIG_PATH = "/api/interactive-lessons/config";
const GENERATE_PATH = "/api/interactive-lessons/generate";
const MAX_BODY_BYTES = 12 * 1024 * 1024;

export function createInteractiveLessonHttpHandler({ service, authorizeRequest } = {}) {
  if (!service || typeof service.generate !== "function") {
    throw new TypeError("interactive lesson service.generate is required");
  }

  return async function handleInteractiveLessonHttp(req, res, requestUrl) {
    const pathname = requestUrl?.pathname || new URL(req.url, "http://localhost").pathname;
    if (pathname !== CONFIG_PATH && pathname !== GENERATE_PATH) return false;

    if (typeof authorizeRequest === "function" && authorizeRequest(req) !== true) {
      sendJson(res, 403, {
        error: "interactive_lesson_forbidden",
        message: "互动教材实验室当前仅允许从本机访问",
      });
      return true;
    }

    if (pathname === CONFIG_PATH) {
      if (req.method !== "GET") {
        methodNotAllowed(res, "GET");
        return true;
      }
      sendJson(res, 200, service.configSummary());
      return true;
    }

    if (req.method !== "POST") {
      methodNotAllowed(res, "POST");
      return true;
    }

    const controller = new AbortController();
    const abort = () => {
      if (!controller.signal.aborted) controller.abort();
    };
    req.once("aborted", abort);
    res.once("close", abort);

    try {
      const input = await readJson(req);
      const result = await service.generate(input, { signal: controller.signal });
      if (!res.destroyed && !res.writableEnded) {
        sendJson(res, 200, result);
      }
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) {
        sendPublicError(res, error);
      }
    } finally {
      req.off("aborted", abort);
      res.off("close", abort);
    }
    return true;
  };
}

async function readJson(req) {
  const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new InteractiveLessonContractError(
      "lesson_content_type_invalid",
      "请求必须使用 application/json",
      "request",
    );
  }
  const declaredLength = Number(req.headers?.["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new InteractiveLessonContractError(
      "lesson_request_too_large",
      "图片与素材合计不能超过 12 MB",
      "request",
    );
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new InteractiveLessonContractError(
        "lesson_request_too_large",
        "图片与素材合计不能超过 12 MB",
        "request",
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InteractiveLessonContractError(
      "lesson_json_invalid",
      "请求内容不是合法 JSON",
      "request",
    );
  }
}

function sendPublicError(res, error) {
  if (error instanceof InteractiveLessonContractError) {
    sendJson(res, error.code === "lesson_request_too_large" ? 413 : 400, {
      error: error.code,
      message: error.message,
      path: error.path || undefined,
    });
    return;
  }
  if (error instanceof PiTeachingAgentError) {
    const status = error.status === 499 ? 499 : error.status;
    sendJson(res, status, { error: error.code, message: error.message });
    return;
  }
  sendJson(res, 500, {
    error: "interactive_lesson_failed",
    message: "互动教材生成失败，请稍后重试",
  });
}

function methodNotAllowed(res, allow) {
  res.setHeader("allow", allow);
  sendJson(res, 405, {
    error: "method_not_allowed",
    message: `仅支持 ${allow}`,
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
