const DEFAULT_BASE_PATH = "/api/education/agent/skills";

/**
 * Read-only HTTP boundary for the public Skill page. Prompt instructions,
 * executable tool objects and runtime course authority never cross this API.
 */
export function createEducationAgentSkillHttpHandler({
  registry,
  authorizeRequest = () => false,
  basePath = DEFAULT_BASE_PATH,
} = {}) {
  if (!registry?.listPublicManifests || !registry?.getPublicManifest || !registry?.configSummary) {
    throw new TypeError("education Agent Skill registry is required");
  }
  const normalizedBasePath = normalizeBasePath(basePath);

  return function handleEducationAgentSkillHttp(req, res, requestUrl) {
    const pathname = requestUrl?.pathname || new URL(req.url || "/", "http://localhost").pathname;
    const skillId = parseSkillId(pathname, normalizedBasePath);
    const supported = pathname === normalizedBasePath || skillId !== null;
    if (!supported || req.method !== "GET") return false;
    if (!authorizeRequest(req)) {
      sendJson(res, 403, {
        error: "education_skill_forbidden",
        message: "当前请求无权查看 Agent Skill",
      });
      return true;
    }

    if (pathname === normalizedBasePath) {
      const skills = registry.listPublicManifests();
      sendJson(res, 200, {
        ...registry.configSummary(),
        skills,
      });
      return true;
    }

    if (!skillId) {
      sendJson(res, 404, {
        error: "education_skill_not_found",
        message: "未找到该 Agent Skill",
      });
      return true;
    }
    const skill = registry.getPublicManifest(skillId);
    if (!skill) {
      sendJson(res, 404, {
        error: "education_skill_not_found",
        message: "未找到该 Agent Skill",
      });
      return true;
    }
    sendJson(res, 200, { skill });
    return true;
  };
}

function parseSkillId(pathname, basePath) {
  if (!pathname.startsWith(`${basePath}/`)) return null;
  const suffix = pathname.slice(basePath.length + 1);
  if (!suffix || suffix.includes("/")) return "";
  try {
    const decoded = decodeURIComponent(suffix);
    return /^[a-z][a-z0-9_]{1,63}$/u.test(decoded) ? decoded : "";
  } catch {
    return "";
  }
}

function normalizeBasePath(value) {
  const path = String(value || DEFAULT_BASE_PATH).trim().replace(/\/+$/u, "");
  if (!/^\/[a-z0-9/_-]+$/iu.test(path)) throw new TypeError("invalid Skill API base path");
  return path;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "private, max-age=0, must-revalidate");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

