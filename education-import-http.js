import Busboy from "busboy";
import { EducationImportServiceError } from "./education-import-service.js";
import { QuestionImportReviewError } from "./question-import-review-service.js";
import {
  ENTITY_TYPES,
  TYPED_RELATION_TYPES,
  CURRICULUM_CANDIDATE_TYPES,
  QUESTION_KNOWLEDGE_RELATIONS,
  QUESTION_KNOWLEDGE_ROLES,
} from "./education-import-contracts.js";

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_QUESTION_REVIEW_JSON_BYTES = 512 * 1024;
const ALLOWED_FIELDS = new Set([
  "document_type",
  "title",
  "language",
  "subject",
  "grade_band",
]);

export function createEducationImportHttpHandler({
  service,
  questionReviewService = null,
  authorizeRequest = () => true,
  resolveIdentity = () => null,
  maxFileBytes = service?.configSummary?.().limits?.maxFileBytes
    || DEFAULT_MAX_FILE_BYTES,
} = {}) {
  if (!service || typeof service.create !== "function") {
    throw new TypeError("education import service is required");
  }

  return async function handleEducationImportHttp(req, res, requestUrl) {
    if (!requestUrl.pathname.startsWith("/api/education/imports")) return false;
    if (!authorizeRequest(req)) {
      sendJson(res, 403, {
        error: "education_import_forbidden",
        message: "当前请求不能访问导入服务",
      });
      return true;
    }

    try {
      if (requestUrl.pathname === "/api/education/imports/config" && req.method === "GET") {
        const config = service.configSummary();
        sendJson(res, 200, {
          schema_version: "education-import-http-config@1.0",
          configured: config.model_configured,
          semantic_compiler_configured: config.semantic_model_configured,
          supported_mime_types: config.supported_mime_types,
          limits: {
            max_file_bytes: config.limits.maxFileBytes,
            max_pages: config.limits.maxPages,
          },
        });
        return true;
      }

      if (
        requestUrl.pathname === "/api/education/imports/ontology-schema"
        && req.method === "GET"
      ) {
        sendJson(res, 200, ontologySchemaReceipt());
        return true;
      }

      if (requestUrl.pathname === "/api/education/imports" && req.method === "GET") {
        const result = await service.list({
          status: requestUrl.searchParams.get("status") || undefined,
          limit: requestUrl.searchParams.get("limit") || 30,
          offset: requestUrl.searchParams.get("offset") || 0,
        });
        sendJson(res, 200, result);
        return true;
      }

      if (requestUrl.pathname === "/api/education/imports" && req.method === "POST") {
        const upload = await readMultipartUpload(req, { maxFileBytes });
        const identity = await resolveIdentity(req);
        const job = await service.create({
          buffer: upload.file.bytes,
          file_name: upload.file.fileName,
          mime_type: upload.file.mimeType,
          ...upload.fields,
          ...(identity?.tenant_id && identity?.learner_id ? {
            tenant_id: identity.tenant_id,
            learner_id: identity.learner_id,
          } : {}),
        });
        sendJson(res, 202, job);
        return true;
      }

      const questionReviewMatch = requestUrl.pathname.match(
        /^\/api\/education\/imports\/(import-[a-f0-9-]{8,80})\/questions\/review$/u,
      );
      if (questionReviewMatch && req.method === "GET") {
        assertQuestionReviewService(questionReviewService);
        const actor = await resolveIdentity(req);
        const receipt = await questionReviewService.getReview(questionReviewMatch[1], {
          tenant_id: actor?.tenant_id,
          ontology_id: requestUrl.searchParams.get("ontology_id") || undefined,
          ontology_version: requestUrl.searchParams.get("ontology_version") || undefined,
        });
        sendJson(res, 200, receipt);
        return true;
      }
      if (questionReviewMatch && req.method === "POST") {
        assertQuestionReviewService(questionReviewService);
        const body = await readJsonBody(req, MAX_QUESTION_REVIEW_JSON_BYTES);
        const actor = await resolveIdentity(req);
        const receipt = await questionReviewService.reviewBatch(questionReviewMatch[1], {
          ...body,
          tenant_id: actor?.tenant_id,
          reviewer_id: actor?.reviewer_id || "local-loopback-reviewer",
        });
        sendJson(res, 200, receipt);
        return true;
      }

      const questionPublishMatch = requestUrl.pathname.match(
        /^\/api\/education\/imports\/(import-[a-f0-9-]{8,80})\/questions\/publish$/u,
      );
      if (questionPublishMatch && req.method === "POST") {
        assertQuestionReviewService(questionReviewService);
        const body = await readJsonBody(req, MAX_JSON_BYTES);
        const actor = await resolveIdentity(req);
        const receipt = await questionReviewService.publish(questionPublishMatch[1], {
          ...body,
          tenant_id: actor?.tenant_id,
          reviewer_id: actor?.reviewer_id || "local-loopback-reviewer",
        });
        sendJson(res, 200, receipt);
        return true;
      }

      const reviewMatch = requestUrl.pathname.match(
        /^\/api\/education\/imports\/(import-[a-f0-9-]{8,80})\/review$/u,
      );
      if (reviewMatch && req.method === "POST") {
        const body = await readJsonBody(req, MAX_JSON_BYTES);
        const actor = await resolveIdentity(req);
        const job = await service.review(reviewMatch[1], {
          ...body,
          reviewer_id: actor?.reviewer_id || "local-loopback-reviewer",
        });
        sendJson(res, 200, job);
        return true;
      }

      const semanticReviewMatch = requestUrl.pathname.match(
        /^\/api\/education\/imports\/(import-[a-f0-9-]{8,80})\/semantic-review$/u,
      );
      if (semanticReviewMatch && req.method === "POST") {
        if (typeof service.resolveSemanticReview !== "function") {
          throw new EducationImportServiceError(
            "education_import_semantic_review_unavailable",
            "Semantic review is unavailable.",
            { status: 503 },
          );
        }
        const body = await readJsonBody(req, MAX_JSON_BYTES);
        const actor = await resolveIdentity(req);
        const job = await service.resolveSemanticReview(semanticReviewMatch[1], {
          ...body,
          reviewer_id: actor?.reviewer_id || "local-loopback-reviewer",
        });
        sendJson(res, 200, job);
        return true;
      }

      const jobMatch = requestUrl.pathname.match(
        /^\/api\/education\/imports\/(import-[a-f0-9-]{8,80})(?:\/result)?$/u,
      );
      if (jobMatch && req.method === "GET") {
        const job = await service.get(jobMatch[1]);
        if (!job) {
          sendJson(res, 404, {
            error: "education_import_not_found",
            message: "未找到这次导入任务",
          });
          return true;
        }
        sendJson(res, 200, job);
        return true;
      }

      sendJson(res, 405, {
        error: "education_import_method_not_allowed",
        message: "当前导入操作不受支持",
      });
      return true;
    } catch (error) {
      sendEducationImportError(res, error);
      return true;
    }
  };
}

function ontologySchemaReceipt() {
  return {
    schema_version: "education-ontology-schema@1.0",
    authority: "education-import-contracts",
    review_required: true,
    entity_types: ENTITY_TYPES,
    curriculum_candidate_types: CURRICULUM_CANDIDATE_TYPES,
    relation_types: TYPED_RELATION_TYPES,
    question_knowledge_relations: QUESTION_KNOWLEDGE_RELATIONS,
    question_knowledge_roles: QUESTION_KNOWLEDGE_ROLES,
    publication_gate: [
      "document_ir_valid",
      "semantic_compilation_complete",
      "semantic_review_queue_empty",
      "candidate_pack_verified",
    ],
  };
}

export function readMultipartUpload(req, { maxFileBytes = DEFAULT_MAX_FILE_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers?.["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxFileBytes + 256 * 1024) {
      reject(new EducationImportServiceError(
        "education_import_file_too_large",
        "The uploaded file is too large.",
        { status: 413 },
      ));
      return;
    }

    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        // Browsers encode non-ASCII multipart filenames as UTF-8 bytes. Busboy
        // otherwise decodes unlabelled parameters as latin1, which turns a
        // Chinese filename into mojibake in the persisted task history.
        defParamCharset: "utf8",
        limits: {
          files: 1,
          fileSize: maxFileBytes,
          fields: 16,
          fieldSize: 64 * 1024,
          parts: 20,
        },
      });
    } catch {
      reject(new EducationImportServiceError(
        "education_import_multipart_required",
        "A multipart file upload is required.",
        { status: 415 },
      ));
      return;
    }

    const fields = {};
    const fileChunks = [];
    let fileInfo = null;
    let fileTooLarge = false;
    let duplicateFile = false;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    parser.on("field", (name, value) => {
      if (!ALLOWED_FIELDS.has(name)) return;
      fields[name] = String(value || "").trim();
    });
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || fileInfo) {
        duplicateFile = Boolean(fileInfo);
        stream.resume();
        return;
      }
      fileInfo = {
        fileName: String(info.filename || "upload"),
        mimeType: String(info.mimeType || "application/octet-stream"),
      };
      stream.on("data", (chunk) => fileChunks.push(Buffer.from(chunk)));
      stream.once("limit", () => {
        fileTooLarge = true;
      });
      stream.once("error", fail);
    });
    parser.once("filesLimit", () => {
      duplicateFile = true;
    });
    parser.once("partsLimit", () => fail(new EducationImportServiceError(
      "education_import_too_many_parts",
      "The upload contains too many parts.",
      { status: 413 },
    )));
    parser.once("error", () => fail(new EducationImportServiceError(
      "education_import_multipart_invalid",
      "The multipart upload is invalid.",
      { status: 400 },
    )));
    parser.once("close", () => {
      if (settled) return;
      if (duplicateFile) {
        fail(new EducationImportServiceError(
          "education_import_multiple_files",
          "Upload exactly one file at a time.",
          { status: 400 },
        ));
        return;
      }
      if (fileTooLarge) {
        fail(new EducationImportServiceError(
          "education_import_file_too_large",
          "The uploaded file is too large.",
          { status: 413 },
        ));
        return;
      }
      if (!fileInfo || fileChunks.length === 0) {
        fail(new EducationImportServiceError(
          "education_import_file_required",
          "Upload a PDF or image file.",
          { status: 400 },
        ));
        return;
      }
      settled = true;
      resolve({
        fields,
        file: {
          ...fileInfo,
          bytes: Buffer.concat(fileChunks),
        },
      });
    });
    req.once("aborted", () => fail(new EducationImportServiceError(
      "education_import_upload_aborted",
      "The upload was interrupted.",
      { status: 499, retryable: true },
    )));
    req.pipe(parser);
  });
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new EducationImportServiceError(
        "education_import_request_too_large",
        "The request body is too large.",
        { status: 413 },
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new EducationImportServiceError(
      "education_import_json_invalid",
      "The request JSON is invalid.",
      { status: 400 },
    );
  }
}

function sendEducationImportError(res, error) {
  const questionReviewError = error instanceof QuestionImportReviewError;
  const known = error instanceof EducationImportServiceError || questionReviewError;
  const status = known && Number.isInteger(error.status) ? error.status : 500;
  const messages = {
    education_import_file_too_large: "文件过大，请压缩或拆分后重试",
    education_import_page_limit_exceeded: "文件页数超过本次导入上限",
    education_import_model_unconfigured: "视觉理解服务尚未配置",
    education_import_unsupported_file: "仅支持 PDF、PNG、JPEG、WebP 或 GIF",
    education_import_queue_full: "当前导入任务较多，请稍后再试",
    education_import_not_found: "未找到这次导入任务",
    education_import_not_reviewable: "任务完成后才能确认候选内容",
  };
  sendJson(res, status, {
    error: known ? error.code : "education_import_unavailable",
    message: messages[error?.code] || (questionReviewError
      ? error.message
      : status >= 500
      ? "导入服务暂时不可用，请稍后重试"
      : "导入请求不符合要求，请检查文件后重试"),
    retryable: known ? error.retryable === true : true,
  });
}

function assertQuestionReviewService(service) {
  if (service
    && typeof service.getReview === "function"
    && typeof service.reviewBatch === "function"
    && typeof service.publish === "function") return;
  throw new QuestionImportReviewError(
    "question_review_service_unavailable",
    "题目审核与发布服务尚未启用",
    { status: 503 },
  );
}

function sendJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
