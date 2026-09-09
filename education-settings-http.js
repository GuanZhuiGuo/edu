import {
  BLOCK_TYPES,
  DOCUMENT_TYPES,
  ENTITY_TYPES,
  REVIEW_STATUSES,
  TYPED_RELATION_TYPES,
} from "./education-import-contracts.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EducationDataStoreError } from "./education-data-store.js";
import { EducationRuntimeSettingsError } from "./education-runtime-settings.js";

const SETTINGS_BODY_LIMIT_BYTES = 64 * 1024;

const CARD_TYPES = Object.freeze([
  "knowledge.explanation",
  "knowledge.mindmap",
  "knowledge.dependency-graph",
  "interactive.diagram",
  "media.image",
  "quiz.single-choice",
  "quiz.multiple-choice",
  "quiz.true-false",
  "quiz.fill-blank",
  "learning.summary",
  "oral-practice",
]);

const VISUAL_VARIANTS = Object.freeze([
  "linear",
  "quadratic",
  "numberline",
  "triangle",
  "circle",
  "coordinate",
  "statistics",
  "probability",
  "algebra",
  "concept",
]);

const PIPELINE_STEPS = Object.freeze([
  { id: "parse", label: "版面解析", authority: "system", output: "DocumentIR" },
  { id: "propose_schema", label: "本体 Schema 选择", authority: "system", output: "Entity/Relation allowlist" },
  { id: "extract", label: "实体与关系抽取", authority: "model_proposal", output: "CandidatePack" },
  { id: "review", label: "来源锚点与人工审核", authority: "reviewer", output: "Verified CandidatePack" },
  { id: "publish", label: "向量与图谱发布", authority: "system", output: "CorpusRelease" },
]);

const DEEPTUTOR_SOURCE_AVAILABLE = existsSync(fileURLToPath(new URL("./third_party/deeptutor/", import.meta.url)));

export function createEducationSettingsHttpHandler({
  importService,
  modelClient,
  mediaClient,
  vectorStore,
  graphStore,
  dataService,
  dataTenantId,
  runtimeSettings,
  authorizeRequest = () => false,
  authorizeMutation = authorizeRequest,
  resolveActor = () => "settings-admin",
  runtime = {},
} = {}) {
  return async function handleEducationSettingsHttp(req, res, requestUrl) {
    const path = requestUrl.pathname;
    if (!["/api/education/settings/summary", "/api/education/settings/mastery", "/api/education/settings/runtime"].includes(path)) return false;
    if (!authorizeRequest(req)) {
      sendJson(res, 403, { code: "forbidden", message: "无权读取教育配置。" });
      return true;
    }

    if (path === "/api/education/settings/runtime") {
      if (req.method === "GET") {
        if (!runtimeSettings?.getPublicSettings) {
          sendJson(res, 503, { code: "runtime_settings_unavailable", message: "模型配置服务不可用。" });
        } else {
          sendJson(res, 200, runtimeSettings.getPublicSettings());
        }
        return true;
      }
      if (req.method !== "PUT") {
        sendJson(res, 405, { code: "method_not_allowed", message: "模型配置仅支持 GET 和 PUT。" });
        return true;
      }
      if (!authorizeMutation(req)) {
        sendJson(res, 403, { code: "forbidden", message: "无权修改模型配置。" });
        return true;
      }
      try {
        if (!runtimeSettings?.update) {
          sendJson(res, 503, { code: "runtime_settings_unavailable", message: "模型配置服务不可用。" });
          return true;
        }
        const body = await readJsonBody(req);
        const updated = runtimeSettings.update(body, {
          expectedVersion: body.expected_version,
          updatedBy: String(await resolveActor(req) || "settings-admin").slice(0, 200),
        });
        sendJson(res, 200, updated);
      } catch (error) {
        sendSettingsError(res, error);
      }
      return true;
    }

    if (path === "/api/education/settings/mastery") {
      if (req.method === "GET") {
        const mastery = safeMasteryConfiguration(dataService, dataTenantId);
        if (!mastery) {
          sendJson(res, 503, { code: "mastery_configuration_unavailable", message: "掌握度配置服务不可用。" });
        } else {
          sendJson(res, 200, mastery);
        }
        return true;
      }
      if (req.method !== "PUT") {
        sendJson(res, 405, { code: "method_not_allowed", message: "掌握度配置仅支持 GET 和 PUT。" });
        return true;
      }
      if (!authorizeMutation(req)) {
        sendJson(res, 403, { code: "forbidden", message: "无权修改掌握度配置。" });
        return true;
      }
      try {
        if (!dataService?.updateMasteryConfiguration) {
          sendJson(res, 503, { code: "mastery_configuration_unavailable", message: "掌握度配置服务不可用。" });
          return true;
        }
        const body = await readJsonBody(req);
        const expectedVersion = Number(body.expected_version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !body.policy) {
          sendJson(res, 400, { code: "invalid_mastery_configuration", message: "缺少有效的 expected_version 或 policy。" });
          return true;
        }
        const updated = dataService.updateMasteryConfiguration({
          tenantId: dataTenantId,
          policy: body.policy,
          expectedVersion,
          updatedBy: String(await resolveActor(req) || "settings-admin").slice(0, 200),
        });
        sendJson(res, 200, updated);
      } catch (error) {
        sendSettingsError(res, error);
      }
      return true;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { code: "method_not_allowed", message: "配置摘要仅支持 GET。" });
      return true;
    }

    const importConfig = safeSummary(importService);
    const modelConfig = safeSummary(modelClient);
    const mediaConfig = safeSummary(mediaClient);
    const vectorConfig = safeSummary(vectorStore);
    const graphConfig = safeSummary(graphStore);
    const dataSummary = safeDataSummary(dataService, dataTenantId);
    const masteryConfig = safeMasteryConfiguration(dataService, dataTenantId);
    const configured = modelConfig.configured === true;
    sendJson(res, 200, {
      schema_version: "education-settings-summary@1.0",
      ontology: {
        schema_version: "education-import@1.0",
        extraction_policy: "proposal_review_publish",
        document_types: DOCUMENT_TYPES,
        block_types: BLOCK_TYPES,
        entity_types: ENTITY_TYPES,
        relation_types: TYPED_RELATION_TYPES,
        review_statuses: REVIEW_STATUSES,
        pipeline_steps: PIPELINE_STEPS,
        limits: {
          max_file_bytes: importConfig?.limits?.maxFileBytes ?? importConfig?.limits?.max_file_bytes ?? 52_428_800,
          max_pages: importConfig?.limits?.maxPages ?? importConfig?.limits?.max_pages ?? 300,
          semantic_batch_pages: Number(runtime.semanticBatchPages || 24),
        },
        gates: [
          "每个实体和关系必须带页码与原文块锚点",
          "模型只产生候选，不得生成正式业务 ID",
          "存在待审项或跨批次关系未对账时禁止发布",
          "审核通过后才可进入向量库和图数据库",
        ],
      },
      models: [
        {
          id: "vision_reasoning",
          capability: "PDF 页面、图形、手写与视觉推理",
          provider: "Volcengine Ark",
          model: modelConfig.visionModel || runtime.visionModel || "未配置",
          configured,
        },
        {
          id: "text_reasoning",
          capability: "文本语义与本体候选的严格结构化抽取",
          provider: "Volcengine Ark",
          model: modelConfig.textModel || runtime.textModel || "未配置",
          configured,
        },
        {
          id: "multimodal_embedding",
          capability: "多模态向量",
          provider: "Volcengine Ark",
          model: modelConfig.embeddingModel || modelConfig.multimodalEmbeddingModel || runtime.embeddingModel || "未配置",
          configured,
        },
        {
          id: "realtime_voice",
          capability: "实时语音对话",
          provider: "Doubao Realtime",
          model: runtime.voiceModel || "1.2.6.0",
          configured: Boolean(runtime.voiceConfigured),
        },
        {
          id: "teaching_visual_generation",
          capability: "教材页面、示意图与分镜视觉生成",
          provider: "Volcengine Ark",
          model: mediaConfig.seedream?.model || runtime.seedreamModel || "未配置",
          configured: mediaConfig.seedream?.configured === true,
        },
        {
          id: "teaching_video_generation",
          capability: "教学分镜视频与配套音频生成",
          provider: "Volcengine Ark",
          model: mediaConfig.seedance?.model || runtime.seedanceModel || "未配置",
          configured: mediaConfig.seedance?.configured === true,
        },
      ],
      storage: {
        application: {
          provider: "sqlite",
          configured: dataSummary.storage === "sqlite",
          database: "education-runtime",
          counts: dataSummary.counts || {},
        },
        vector: {
          provider: vectorConfig.provider || "qdrant",
          configured: vectorConfig.configured === true,
          collection: vectorConfig.collection || "education_knowledge_v1",
          fusion: "dense_sparse_rrf",
        },
        graph: {
          provider: graphConfig.provider || "neo4j",
          configured: graphConfig.configured === true,
          database: graphConfig.database || "neo4j",
          release_control: "ACTIVE_RELEASE",
        },
      },
      mastery: masteryConfig,
      cards: {
        envelope_protocol: "A2UI v0.9",
        card_protocol: "EducationCard@1.0",
        interactive_protocol: "junior-math-interactive@1.1",
        card_types: CARD_TYPES,
        visual_variants: VISUAL_VARIANTS,
        libraries: [
          { id: "controlled-svg", name: "受控 SVG 互动图", role: "函数、几何、数轴、实验小卡", status: "active" },
          { id: "g6-echarts", name: "G6 + ECharts", role: "知识图谱、思维导图与掌握总览", status: "active" },
          { id: "openmaic", name: "OpenMAIC", role: "课程场景与交互演示", status: "adapter_ready" },
          { id: "deeptutor", name: "DeepTutor", role: "Book/Spine/Page/Block 内容结构", status: DEEPTUTOR_SOURCE_AVAILABLE ? "adapter_ready" : "source_missing" },
        ],
        safety: [
          "Agent 只能引用受信素材 ID，不能输出 HTML、脚本或任意组件",
          "题目答案和完整解析保留在服务端私有题库",
          "互动图参数必须通过 variant 白名单和数值限幅",
        ],
      },
    });
    return true;
  };
}

function safeSummary(value) {
  try {
    return value?.configSummary?.() || {};
  } catch {
    return {};
  }
}

function safeDataSummary(service, tenantId) {
  try {
    return service?.summary?.({ tenantId }) || {};
  } catch {
    return {};
  }
}

function safeMasteryConfiguration(service, tenantId) {
  try {
    return service?.getMasteryConfiguration?.({ tenantId }) || null;
  } catch {
    return null;
  }
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > SETTINGS_BODY_LIMIT_BYTES) {
      throw new EducationDataStoreError("请求体超过 64KB", { code: "request_body_too_large", status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not_object");
    return value;
  } catch {
    throw new EducationDataStoreError("请求体不是合法 JSON 对象", { code: "invalid_json", status: 400 });
  }
}

function sendSettingsError(res, error) {
  const known = error instanceof EducationDataStoreError || error instanceof EducationRuntimeSettingsError;
  sendJson(res, known ? error.status : 500, {
    code: known ? error.code : "settings_update_failed",
    message: known ? error.message : "配置更新失败。",
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}
