import { createEducationKnowledgeConnectionMonitor } from "./education-knowledge-connections.js";

const MAX_JSON_BYTES = 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,191}$/u;
const PUBLICATION_NAMESPACES = new Set([
  "shared_curriculum",
  "organization_course",
]);

/**
 * HTTP boundary for reviewed knowledge publication and release-scoped search.
 * Tenant, principal and ACL values are always resolved by the server. The
 * browser may select an allowed course, but can never choose a release ID.
 */
export function createEducationKnowledgeHttpHandler({
  publicationService = null,
  retrievalService = null,
  vectorStore = null,
  graphStore = null,
  connectionMonitor = null,
  authorizeRequest = () => false,
  resolveIdentity = () => null,
} = {}) {
  const connections = connectionMonitor || createEducationKnowledgeConnectionMonitor({ vectorStore, graphStore });
  return async function handleEducationKnowledgeHttp(req, res, requestUrl) {
    const path = requestUrl.pathname;
    const isKnowledgePath = path.startsWith("/api/education/knowledge/")
      || path === "/api/education/retrieval/search"
      || /^\/api\/education\/imports\/import-[a-f0-9-]{8,80}\/publish$/u.test(path);
    if (!isKnowledgePath) return false;

    if (!authorizeRequest(req)) {
      sendJson(res, 403, {
        error: "education_knowledge_forbidden",
        message: "当前请求不能访问知识库服务",
      });
      return true;
    }

    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once?.("aborted", abort);
    res.once?.("close", abort);
    try {
      if (path === "/api/education/knowledge/config" && req.method === "GET") {
        sendJson(res, 200, configReceipt({ publicationService, retrievalService, vectorStore, graphStore }));
        return true;
      }

      if (path === "/api/education/knowledge/health" && req.method === "GET") {
        const status = await connections.getStatus({ signal: controller.signal });
        const health = storageHealth(status, vectorStore, graphStore);
        sendJson(res, health.ok ? 200 : 503, health);
        return true;
      }

      if (path === "/api/education/knowledge/connections" && req.method === "GET") {
        const status = await connections.getStatus({
          refresh: requestUrl.searchParams.get("refresh") === "1",
          signal: controller.signal,
        });
        res.setHeader?.("cache-control", "no-store");
        sendJson(res, 200, status);
        return true;
      }

      const publishMatch = path.match(
        /^\/api\/education\/imports\/(import-[a-f0-9-]{8,80})\/publish$/u,
      );
      if (publishMatch && req.method === "POST") {
        assertService(publicationService, "education_knowledge_publication_not_configured");
        const identity = normalizeIdentity(await resolveIdentity(req));
        const body = await readJsonBody(req);
        const namespace = normalizeNamespace(body.namespace);
        const courseId = namespace === "shared_curriculum"
          ? "shared_curriculum"
          : safeId(body.course_id, "course_id");
        assertCourseAccess(identity, courseId);
        const receipt = await publicationService.publishImport(publishMatch[1], {
          tenantId: identity.tenantId,
          principalId: identity.principalId,
          readPrincipals: identity.readPrincipals,
          writePrincipals: identity.writePrincipals,
          namespace,
          courseId,
        });
        sendJson(res, 200, receipt);
        return true;
      }

      if (path === "/api/education/retrieval/search" && req.method === "POST") {
        assertService(retrievalService, "education_knowledge_retrieval_not_configured");
        const identity = normalizeIdentity(await resolveIdentity(req));
        const body = await readJsonBody(req);
        const namespaceId = normalizeNamespace(body.namespace);
        const courseId = namespaceId === "shared_curriculum"
          ? "shared_curriculum"
          : safeId(body.course_id, "course_id");
        assertCourseAccess(identity, courseId);
        const receipt = await retrievalService.search({
          query: requiredText(body.query, "query", 8_000),
          tenantId: identity.tenantId,
          principalId: identity.principalId,
          principalIds: identity.readPrincipals,
          namespaceId,
          courseId,
          corpusId: courseId,
          entityTypes: optionalIdList(body.entity_types, "entity_types"),
          limit: body.limit,
          signal: controller.signal,
        });
        sendJson(res, receipt.status === "tool_error" ? 502 : 200, receipt);
        return true;
      }

      if (path === "/api/education/knowledge/active-release" && req.method === "GET") {
        assertService(graphStore, "education_knowledge_graph_not_configured");
        const identity = normalizeIdentity(await resolveIdentity(req));
        const namespaceId = normalizeNamespace(requestUrl.searchParams.get("namespace"));
        const courseId = namespaceId === "shared_curriculum"
          ? "shared_curriculum"
          : safeId(requestUrl.searchParams.get("course_id"), "course_id");
        assertCourseAccess(identity, courseId);
        const connection = await connections.getStatus({ signal: controller.signal });
        if (connection.components.neo4j.status !== "healthy") {
          throw httpError("education_knowledge_graph_unavailable", "知识图谱暂时不可用", 503);
        }
        const active = await graphStore.resolveActiveRelease({
          signal: controller.signal,
          tenantId: identity.tenantId,
          namespaceId,
          corpusId: courseId,
          principalId: identity.principalId,
          readPrincipals: identity.readPrincipals,
          visibility: namespaceId === "shared_curriculum" ? "public" : "tenant",
        });
        sendJson(res, 200, {
          schema_version: "education-active-release@1.0",
          corpus_id: courseId,
          active_release: active,
        });
        return true;
      }

      sendJson(res, 405, {
        error: "education_knowledge_method_not_allowed",
        message: "当前知识库操作不受支持",
      });
      return true;
    } catch (error) {
      if (controller.signal.aborted) return true;
      sendKnowledgeError(res, error);
      return true;
    } finally {
      req.removeListener?.("aborted", abort);
      res.removeListener?.("close", abort);
    }
  };
}

function configReceipt({ publicationService, retrievalService, vectorStore, graphStore }) {
  const vector = vectorStore?.configSummary?.() || { configured: false };
  const graph = graphStore?.configSummary?.() || { configured: false };
  return {
    schema_version: "education-knowledge-config@1.0",
    configured: Boolean(publicationService && retrievalService && vector.configured && graph.configured),
    publication_configured: Boolean(publicationService),
    retrieval_configured: Boolean(retrievalService),
    vector: {
      provider: "qdrant",
      configured: vector.configured === true,
      collection: vector.collection || null,
      dense_vector: vector.denseVectorName || null,
      sparse_vector: vector.sparseVectorName || null,
    },
    graph: {
      provider: "neo4j",
      configured: graph.configured === true,
      database: graph.database || null,
    },
    release_control: "neo4j_active_release",
  };
}

function storageHealth(connection, vectorStore, graphStore) {
  const componentHealth = (item) => ({
    ...item,
    ok: item.status === "healthy",
    configured: item.status !== "unconfigured",
  });
  const vector = {
    ...componentHealth(connection.components.qdrant), provider: "qdrant",
    collection: vectorStore?.configSummary?.().collection || null,
  };
  const graph = {
    ...componentHealth(connection.components.neo4j), provider: "neo4j",
    database: graphStore?.configSummary?.().database || null,
  };
  return {
    schema_version: "education-knowledge-health@1.0",
    ok: vector.ok === true && graph.ok === true,
    vector,
    graph,
  };
}

function normalizeIdentity(value) {
  if (!value || typeof value !== "object") {
    throw httpError("education_knowledge_identity_missing", "缺少服务端身份", 403);
  }
  const principalId = safeId(value.principal_id, "principal_id");
  return {
    tenantId: safeId(value.tenant_id, "tenant_id"),
    principalId,
    readPrincipals: normalizedPrincipalList(value.read_principal_ids, principalId),
    writePrincipals: normalizedPrincipalList(value.write_principal_ids, principalId),
    allowedCourseIds: optionalIdList(value.allowed_course_ids, "allowed_course_ids"),
  };
}

function normalizedPrincipalList(value, principalId) {
  const list = value === undefined ? [principalId] : optionalIdList(value, "principal_ids");
  if (!list.includes(principalId)) {
    throw httpError("education_knowledge_identity_invalid", "服务端身份权限不完整", 403);
  }
  return list;
}

function assertCourseAccess(identity, courseId) {
  if (identity.allowedCourseIds.length && !identity.allowedCourseIds.includes(courseId)) {
    throw httpError("education_knowledge_course_forbidden", "当前用户无权访问该课程知识库", 403);
  }
}

function normalizeNamespace(value) {
  const namespace = typeof value === "string" && value.trim()
    ? value.trim()
    : "organization_course";
  if (!PUBLICATION_NAMESPACES.has(namespace)) {
    throw httpError("education_knowledge_namespace_invalid", "知识库命名空间不受支持", 422);
  }
  return namespace;
}

function optionalIdList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 200) {
    throw httpError("education_knowledge_input_invalid", `${field} must be an array.`, 422);
  }
  return [...new Set(value.map((item) => safeId(item, field)))];
}

function safeId(value, field) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!SAFE_ID.test(result)) {
    throw httpError("education_knowledge_input_invalid", `${field} is invalid.`, 422);
  }
  return result;
}

function requiredText(value, field, max) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > max) {
    throw httpError("education_knowledge_input_invalid", `${field} is required.`, 422);
  }
  return result;
}

async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_JSON_BYTES) {
      throw httpError("education_knowledge_body_too_large", "请求内容过大", 413);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw httpError("education_knowledge_json_invalid", "请求内容不是有效 JSON", 400);
  }
}

function assertService(service, code) {
  if (!service) throw httpError(code, "知识库服务尚未完成配置", 503);
}

function httpError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function sendKnowledgeError(res, error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 500;
  sendJson(res, status, {
    error: typeof error?.code === "string" ? error.code : "education_knowledge_internal_error",
    message: status >= 500 ? "知识库服务暂时不可用" : String(error?.message || "请求无效"),
    retryable: error?.retryable === true,
  });
}

function sendJson(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
