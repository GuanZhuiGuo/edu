import { EducationDataStoreError } from "./education-data-store.js";

const BODY_LIMIT_BYTES = 64 * 1024;

export function createEducationDataHttpHandler({
  service,
  authorizeRequest = () => false,
  resolveIdentity = () => null
} = {}) {
  if (!service) throw new TypeError("service is required");

  return async function handleEducationDataHttp(req, res, requestUrl) {
    const path = requestUrl.pathname;
    if (!isEducationDataPath(path)) return false;
    if (!authorizeRequest(req)) {
      sendJson(res, 403, { error: "forbidden", message: "无权访问教育业务数据" });
      return true;
    }
    let identity;
    try {
      identity = normalizeIdentity(await resolveIdentity(req));
    } catch (error) {
      sendError(res, error);
      return true;
    }

    try {
      if (req.method === "GET" && path === "/api/education/data/summary") {
        sendJson(res, 200, service.summary({ tenantId: identity.tenant_id }));
        return true;
      }

      if (req.method === "GET" && path === "/api/education/students") {
        const accessibleStudentIds = identity.can_read_all_students ? null : identity.student_ids;
        sendJson(res, 200, {
          tenant_id: identity.tenant_id,
          data_source: "sqlite",
          items: service.listStudents({ tenantId: identity.tenant_id, accessibleStudentIds })
        });
        return true;
      }

      const studentRoute = matchStudentRoute(path);
      if (studentRoute) {
        assertStudentAccess(identity, studentRoute.studentId);
        if (req.method === "GET" && studentRoute.action === "profile") {
          sendJson(res, 200, service.getStudentProfile({
            tenantId: identity.tenant_id,
            studentId: studentRoute.studentId
          }));
          return true;
        }
        if (req.method === "GET" && studentRoute.action === "mastery") {
          sendJson(res, 200, service.getMastery({
            tenantId: identity.tenant_id,
            studentId: studentRoute.studentId,
            ontologyId: requestUrl.searchParams.get("ontology_id") || "junior-math-moe-2022",
            ontologyVersion: requestUrl.searchParams.get("ontology_version") || "",
            state: requestUrl.searchParams.get("state") || "",
            limit: requestUrl.searchParams.get("limit"),
            offset: requestUrl.searchParams.get("offset")
          }));
          return true;
        }
        if (req.method === "GET" && studentRoute.action === "mastery-history") {
          sendJson(res, 200, service.getMasteryHistory({
            tenantId: identity.tenant_id,
            studentId: studentRoute.studentId,
            ontologyId: requestUrl.searchParams.get("ontology_id") || "junior-math-moe-2022",
            ontologyVersion: requestUrl.searchParams.get("ontology_version") || "",
            knowledgePointId: requestUrl.searchParams.get("knowledge_point_id") || "",
            limit: requestUrl.searchParams.get("limit"),
            offset: requestUrl.searchParams.get("offset")
          }));
          return true;
        }
        if (req.method === "GET" && studentRoute.action === "learning-events") {
          sendJson(res, 200, service.getLearningEvents({
            tenantId: identity.tenant_id,
            studentId: studentRoute.studentId,
            limit: requestUrl.searchParams.get("limit"),
            offset: requestUrl.searchParams.get("offset")
          }));
          return true;
        }
        if (req.method === "POST" && studentRoute.action === "mastery-evidence") {
          if (!identity.can_write_mastery) throw forbidden("当前会话不能写入掌握证据");
          const body = await readJsonBody(req);
          sendJson(res, 201, service.recordMasteryEvidence({
            tenantId: identity.tenant_id,
            studentId: studentRoute.studentId,
            evidence: body
          }));
          return true;
        }
      }

      if (req.method === "GET" && path === "/api/education/ontologies") {
        sendJson(res, 200, { items: service.listOntologies({ tenantId: identity.tenant_id }) });
        return true;
      }

      const ontologyGraph = matchOntologyGraph(path);
      if (req.method === "GET" && ontologyGraph) {
        const graph = service.getOntologyGraph({
          tenantId: identity.tenant_id,
          ontologyId: ontologyGraph,
          ontologyVersion: requestUrl.searchParams.get("ontology_version") || "",
          includeQuestions: requestUrl.searchParams.get("include_questions") === "true",
          questionLimit: requestUrl.searchParams.get("question_limit")
        });
        if (!graph) throw notFound("本体不存在", "ontology_not_found");
        sendJson(res, 200, graph);
        return true;
      }

      if (req.method === "GET" && path === "/api/education/knowledge-points") {
        sendJson(res, 200, service.listKnowledgePoints({
          tenantId: identity.tenant_id,
          ontologyId: requestUrl.searchParams.get("ontology_id") || "junior-math-moe-2022",
          ontologyVersion: requestUrl.searchParams.get("ontology_version") || "",
          query: requestUrl.searchParams.get("query") || "",
          limit: requestUrl.searchParams.get("limit"),
          offset: requestUrl.searchParams.get("offset")
        }));
        return true;
      }

      if (req.method === "GET" && path === "/api/education/questions") {
        sendJson(res, 200, service.listQuestions({
          tenantId: identity.tenant_id,
          ontologyId: requestUrl.searchParams.get("ontology_id") || "",
          ontologyVersion: requestUrl.searchParams.get("ontology_version") || "",
          knowledgePointId: requestUrl.searchParams.get("knowledge_point_id") || "",
          questionType: requestUrl.searchParams.get("question_type") || "",
          difficulty: requestUrl.searchParams.get("difficulty") || "",
          propositionMethod: requestUrl.searchParams.get("proposition_method") || "",
          query: requestUrl.searchParams.get("query") || "",
          limit: requestUrl.searchParams.get("limit"),
          offset: requestUrl.searchParams.get("offset")
        }));
        return true;
      }

      const solutionQuestionId = matchQuestionSolution(path);
      if (req.method === "GET" && solutionQuestionId) {
        if (!identity.can_reveal_solutions) throw forbidden("当前会话不能读取私有答案和解题思路");
        const solution = service.getQuestionSolution({ tenantId: identity.tenant_id, questionId: solutionQuestionId });
        if (!solution) throw notFound("题目答案不存在", "question_solution_not_found");
        sendJson(res, 200, solution);
        return true;
      }

      const questionId = matchQuestion(path);
      if (req.method === "GET" && questionId) {
        const question = service.getQuestion({ tenantId: identity.tenant_id, questionId });
        if (!question) throw notFound("题目不存在", "question_not_found");
        sendJson(res, 200, question);
        return true;
      }

      sendJson(res, 404, { error: "education_data_route_not_found", message: "教育数据接口不存在" });
      return true;
    } catch (error) {
      sendError(res, error);
      return true;
    }
  };
}

function isEducationDataPath(path) {
  return path === "/api/education/data/summary"
    || path === "/api/education/students"
    || path.startsWith("/api/education/students/")
    || path === "/api/education/ontologies"
    || path.startsWith("/api/education/ontologies/")
    || path === "/api/education/knowledge-points"
    || path === "/api/education/questions"
    || path.startsWith("/api/education/questions/");
}

function normalizeIdentity(value) {
  const tenantId = safeId(value?.tenant_id);
  if (!tenantId) throw forbidden("服务端未解析出租户身份");
  return {
    tenant_id: tenantId,
    student_ids: Array.isArray(value?.student_ids) ? value.student_ids.map(safeId).filter(Boolean) : [],
    can_read_all_students: value?.can_read_all_students === true,
    can_write_mastery: value?.can_write_mastery === true,
    can_reveal_solutions: value?.can_reveal_solutions === true
  };
}

function assertStudentAccess(identity, studentId) {
  if (identity.can_read_all_students || identity.student_ids.includes(studentId)) return;
  throw forbidden("无权访问该学生数据");
}

function matchStudentRoute(path) {
  const match = path.match(/^\/api\/education\/students\/([^/]+)(?:\/(mastery|mastery-history|learning-events|mastery-evidence))?$/u);
  if (!match) return null;
  return { studentId: decodeSegment(match[1]), action: match[2] || "profile" };
}

function matchOntologyGraph(path) {
  const match = path.match(/^\/api\/education\/ontologies\/([^/]+)\/graph$/u);
  return match ? decodeSegment(match[1]) : null;
}

function matchQuestion(path) {
  const match = path.match(/^\/api\/education\/questions\/([^/]+)$/u);
  return match ? decodeSegment(match[1]) : null;
}

function matchQuestionSolution(path) {
  const match = path.match(/^\/api\/education\/questions\/([^/]+)\/solution$/u);
  return match ? decodeSegment(match[1]) : null;
}

function decodeSegment(value) {
  try { return decodeURIComponent(value); } catch { throw new EducationDataStoreError("路径编码无效", { code: "invalid_path", status: 400 }); }
}

function safeId(value) {
  const text = String(value ?? "").trim();
  return /^[\p{L}\p{N}_.:@/+~-]{1,200}$/u.test(text) ? text : "";
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) {
      throw new EducationDataStoreError("请求体超过 64KB", { code: "request_body_too_large", status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not_object");
    return body;
  } catch {
    throw new EducationDataStoreError("请求体不是合法 JSON 对象", { code: "invalid_json", status: 400 });
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendError(res, error) {
  const known = error instanceof EducationDataStoreError;
  sendJson(res, known ? error.status : 500, {
    error: known ? error.code : "education_data_failed",
    message: known ? error.message : "教育数据服务处理失败"
  });
}

function forbidden(message) {
  return new EducationDataStoreError(message, { code: "forbidden", status: 403 });
}

function notFound(message, code) {
  return new EducationDataStoreError(message, { code, status: 404 });
}
