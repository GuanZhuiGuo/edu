import { randomUUID } from "node:crypto";

import { createKnowledgeMaterialA2UI } from "./knowledge-material-a2ui.js";
import { parameterizeKnowledgeCardMaterials } from "./public/knowledge-card-parameter-contract.js";
import { runDeepTutorNative } from "./source-bridges/deeptutor/index.js";
import { runOpenMaicOfficialPipeline } from "./source-bridges/openmaic/index.js";
import {
  CELL_STUDIO_SOURCE_PROVENANCE,
  createCellStudioMaterial,
  extractCellStudioSourceClaims
} from "./source-techniques/cell-studio-adapter.js";
import {
  generateKojiSourceMaterial
} from "./source-techniques/koji-adapter.js";
import { assertSourceQuality } from "./source-techniques/source-quality.js";
import { compileSourceText } from "./source-techniques/source-text.js";

export const SOURCE_TECHNIQUES = Object.freeze([
  "deeptutor",
  "openmaic",
  "koji",
  "cell_studio"
]);

export class SourceTechniquePipelineError extends Error {
  constructor(code, message, { technique = "", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SourceTechniquePipelineError";
    this.code = code;
    this.technique = technique;
  }
}

/**
 * Generate exactly one selected technique.
 *
 * DeepTutor and OpenMAIC execute their pinned upstream runtimes and return
 * native source-program data. Koji-style and Cell Studio retain the existing
 * deterministic material/A2UI contract for backward compatibility.
 */
export async function generateSourceTechniqueMaterial(
  input,
  { client, signal, nativeRuntimes, onTrace } = {}
) {
  const startedAt = Date.now();
  const trace = createTraceEmitter(onTrace);
  let technique = "";
  let source;
  let quality;

  trace({
    type: "pipeline.stage",
    stage: "input.validate",
    status: "started",
    title: "校验输入",
    message: "检查技术选择、内容长度与重复度"
  });
  try {
    throwIfAborted(signal);
    technique = normalizeTechnique(input?.technique);
    source = normalizeSourceInput(input);
    quality = assertSourceQuality(source);
    trace({
      type: "pipeline.stage",
      stage: "input.validate",
      status: "completed",
      title: "输入校验通过",
      message: `已选择 ${technique}，只运行这一条生成链路`
    });
  } catch (error) {
    trace({
      type: "pipeline.error",
      stage: "input.validate",
      status: signal?.aborted ? "cancelled" : "failed",
      title: signal?.aborted ? "生成已取消" : "输入校验失败",
      message: signal?.aborted ? "请求已取消" : "输入未通过生成前校验",
      meta: {
        error_code:
          typeof error?.code === "string" ? error.code : "INVALID_SOURCE_INPUT"
      }
    });
    throw error;
  }

  try {
    trace({
      type: "source.stage",
      stage: `${technique}.runtime`,
      status: "started",
      title: `${technique} 源码运行时已启动`,
      message: isUpstreamNativeTechnique(technique)
        ? "正在执行官方源码生成流程"
        : "正在执行确定性源码适配器"
    });
    const generated = await runSelectedAdapter(technique, source, {
      client,
      signal,
      nativeRuntimes,
      onTrace: trace
    });
    throwIfAborted(signal);
    trace({
      type: "source.stage",
      stage: `${technique}.runtime`,
      status: "completed",
      title: `${technique} 源码运行完成`,
      message: "开始校验并组装公开产物"
    });
    trace({
      type: "pipeline.stage",
      stage: "output.assemble",
      status: "started",
      title: "组装生成结果",
      message: "保留原生结构并执行私密字段分离"
    });
    let result;
    if (isUpstreamNativeTechnique(technique)) {
      result = assembleNativeSourceBundle({
        technique,
        source,
        generated,
        quality,
        durationMs: Math.max(0, Date.now() - startedAt)
      });
    } else {
      result = assembleSourceBundle({
        technique,
        source,
        generated,
        quality,
        durationMs: Math.max(0, Date.now() - startedAt)
      });
    }
    trace({
      type: "pipeline.stage",
      stage: "output.assemble",
      status: "completed",
      title: "生成结果组装完成",
      message: "素材包已通过当前流水线校验",
      meta: {
        duration_ms: Math.max(0, Date.now() - startedAt)
      }
    });
    return result;
  } catch (error) {
    if (signal?.aborted) {
      trace({
        type: "pipeline.error",
        stage: `${technique || "source"}.runtime`,
        status: "cancelled",
        title: "生成已取消",
        message: "源码流水线和在途模型请求已停止"
      });
      throw new SourceTechniquePipelineError(
        "SOURCE_GENERATION_ABORTED",
        "素材生成已取消",
        { technique, cause: error }
      );
    }
    trace({
      type: "pipeline.error",
      stage: `${technique || "source"}.runtime`,
      status: "failed",
      title: `${technique || "源码"} 流水线失败`,
      message: "已停止后续组装，请查看上方最后一个失败阶段",
      meta: {
        error_code:
          typeof error?.code === "string"
            ? error.code
            : "SOURCE_ADAPTER_FAILED",
        duration_ms: Math.max(0, Date.now() - startedAt)
      }
    });
    if (error instanceof SourceTechniquePipelineError) throw error;
    const code =
      typeof error?.code === "string"
        ? error.code
        : "SOURCE_ADAPTER_FAILED";
    throw new SourceTechniquePipelineError(
      code,
      publicAdapterMessage(code, technique),
      { technique, cause: error }
    );
  }
}

async function runSelectedAdapter(
  technique,
  source,
  { client, signal, nativeRuntimes, onTrace } = {}
) {
  if (technique === "deeptutor") {
    assertNativeModelClient(client, "generateJson");
    const runtime =
      nativeRuntimes?.deeptutor || runDeepTutorNative;
    return runtime(source, { client, signal, onTrace });
  }
  if (technique === "openmaic") {
    assertNativeModelClient(client, "complete");
    const runtime =
      nativeRuntimes?.openmaic || runOpenMaicOfficialPipeline;
    return runtime(source, {
      signal,
      aiCall: createOpenMaicAiCall(client, signal, onTrace),
      onTrace,
      onProgress(progress) {
        emitOpenMaicProgress(onTrace, progress);
      },
      onStageComplete(stage, result) {
        emitOpenMaicStageComplete(onTrace, stage, result);
      }
    });
  }
  if (technique === "koji") {
    onTrace?.({
      type: "source.stage",
      stage: "koji.state_machine",
      status: "running",
      title: "构建渐进辅导状态机",
      message: "按源码规则生成学习状态与分层提示"
    });
    return generateKojiSourceMaterial(source);
  }
  if (technique === "cell_studio") {
    onTrace?.({
      type: "source.stage",
      stage: "cell_studio.specimen",
      status: "running",
      title: "匹配官方细胞标本",
      message: "校验主题并生成确定性程序几何"
    });
    const material = createCellStudioMaterial(source);
    const claims = extractCellStudioSourceClaims(source);
    return {
      material,
      claims,
      provenance: CELL_STUDIO_SOURCE_PROVENANCE
    };
  }
  throw new SourceTechniquePipelineError(
    "UNSUPPORTED_SOURCE_TECHNIQUE",
    "不支持所选素材技术",
    { technique }
  );
}

function isUpstreamNativeTechnique(technique) {
  return technique === "deeptutor" || technique === "openmaic";
}

function assertNativeModelClient(client, method) {
  if (!client || typeof client[method] !== "function") {
    throw Object.assign(
      new Error("The selected upstream source pipeline requires Ark."),
      { code: "ark_not_configured" }
    );
  }
  if (typeof client.configSummary !== "function") return;

  let summary;
  try {
    summary = client.configSummary();
  } catch {
    summary = null;
  }
  if (summary?.configured !== true) {
    throw Object.assign(
      new Error("The selected upstream source pipeline requires Ark."),
      { code: "ark_not_configured" }
    );
  }
}

function createOpenMaicAiCall(client, signal, onTrace) {
  let callIndex = 0;
  return async (systemPrompt, userPrompt, images, context = {}) => {
    const currentCallIndex = ++callIndex;
    if (Array.isArray(images) && images.length > 0) {
      throw Object.assign(
        new Error("The current text-source bridge does not accept images."),
        { code: "OPENMAIC_VISION_INPUT_UNSUPPORTED" }
      );
    }
    const system = String(systemPrompt || "");
    const prompt = String(userPrompt || "");
    const stage =
      currentCallIndex === 1
        ? "openmaic.outlines"
        : "openmaic.scene_generation";
    const callId =
      typeof context?.callId === "string" && context.callId
        ? context.callId
        : `openmaic_${currentCallIndex}`;
    const effectiveSignal = combineAbortSignals(signal, context?.signal);
    const startedAt = Date.now();
    onTrace?.({
      type: "source.stage",
      stage,
      status: "started",
      title:
        currentCallIndex === 1
          ? "OpenMAIC 生成课堂大纲"
          : `OpenMAIC 生成场景内容 · 调用 ${currentCallIndex}`,
      message:
        currentCallIndex === 1
          ? "调用模型生成官方 Scene Outline"
          : "官方场景流水线正在生成内容或 Action",
      call_id: callId
    });
    try {
      const completion = await client.complete({
        system,
        prompt,
        responseFormat: openMaicExpectsHtml(system)
          ? "text"
          : "json_object",
        temperature: 0.2,
        maxTokens: 16_000,
        signal: effectiveSignal,
        stream: true,
        onTrace,
        traceContext: {
          stage,
          callId
        }
      });
      onTrace?.({
        type: "source.stage",
        stage,
        status: "completed",
        title:
          currentCallIndex === 1
            ? "OpenMAIC 课堂大纲生成完成"
            : `OpenMAIC 模型调用 ${currentCallIndex} 完成`,
        message: "完整模型响应已交回官方源码流水线解析",
        call_id: callId,
        meta: {
          duration_ms: Math.max(0, Date.now() - startedAt)
        }
      });
      if (typeof completion?.text === "string" && completion.text.trim()) {
        return completion.text;
      }
      if (completion?.json && typeof completion.json === "object") {
        return JSON.stringify(completion.json);
      }
      throw Object.assign(
        new Error("Ark returned no OpenMAIC generation payload."),
        { code: "OPENMAIC_EMPTY_MODEL_OUTPUT" }
      );
    } catch (error) {
      onTrace?.({
        type: "source.stage",
        stage,
        status: "failed",
        title: `OpenMAIC 模型调用 ${currentCallIndex} 失败`,
        message: "官方源码流水线未收到可解析的完整模型结果",
        call_id: callId,
        meta: {
          error_code:
            typeof error?.code === "string"
              ? error.code
              : "OPENMAIC_MODEL_CALL_FAILED",
          duration_ms: Math.max(0, Date.now() - startedAt)
        }
      });
      throw error;
    }
  };
}

function combineAbortSignals(...signals) {
  const active = signals.filter(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      typeof candidate.addEventListener === "function"
  );
  if (active.length <= 1) return active[0];
  if (typeof globalThis.AbortSignal?.any === "function") {
    return globalThis.AbortSignal.any(active);
  }
  return active.find((candidate) => candidate.aborted) || active[0];
}

function emitOpenMaicProgress(onTrace, progress) {
  if (typeof onTrace !== "function" || !progress || typeof progress !== "object") {
    return;
  }
  const upstreamStage = Number(progress.currentStage);
  const stage =
    upstreamStage === 1 ? "openmaic.outlines" : "openmaic.scenes";
  onTrace({
    type: "source.progress",
    stage,
    status: "running",
    title:
      upstreamStage === 1
        ? "OpenMAIC 正在生成课堂大纲"
        : "OpenMAIC 正在生成原生场景",
    message:
      upstreamStage === 1
        ? "官方 Generation Pipeline · Stage 1"
        : `场景进度 ${Number(progress.scenesGenerated) || 0}/${
            Number(progress.totalScenes) || 0
          }`,
    meta: {
      upstream_stage: Number.isFinite(upstreamStage) ? upstreamStage : 0,
      progress: Number(progress.overallProgress) || 0,
      current: Number(progress.scenesGenerated) || 0,
      total: Number(progress.totalScenes) || 0
    }
  });
}

function emitOpenMaicStageComplete(onTrace, stageNumber, result) {
  if (typeof onTrace !== "function") return;
  const numericStage = Number(stageNumber);
  const stage = numericStage === 1 ? "openmaic.outlines" : "openmaic.scenes";
  onTrace({
    type: "source.stage",
    stage,
    status: "completed",
    title:
      numericStage === 1
        ? "OpenMAIC 课堂大纲阶段完成"
        : "OpenMAIC 场景生成阶段完成",
    message: "官方 Generation Pipeline 已提交本阶段结果",
    meta: {
      stage_number: Number.isFinite(numericStage) ? numericStage : 0,
      count: Array.isArray(result) ? result.length : 0
    }
  });
}

function createTraceEmitter(onTrace) {
  if (typeof onTrace !== "function") return () => {};
  return (event) => {
    try {
      const pending = onTrace(event);
      if (pending && typeof pending.catch === "function") {
        pending.catch(() => {});
      }
    } catch {
      // Trace observers must never affect source generation.
    }
  };
}

function openMaicExpectsHtml(systemPrompt) {
  return (
    /<!doctype\s+html\b/iu.test(systemPrompt) ||
    /(?:complete|full|one|only)\s+html\s+document/iu.test(systemPrompt) ||
    /return\s+(?:exactly\s+one|only\s+the)\s+(?:complete\s+)?html/iu.test(
      systemPrompt
    )
  );
}

function assembleNativeSourceBundle({
  technique,
  source,
  generated,
  quality,
  durationMs
}) {
  if (!isPlainObject(generated)) {
    throw new SourceTechniquePipelineError(
      "SOURCE_ADAPTER_INVALID_OUTPUT",
      "官方源码流水线未返回有效结果",
      { technique }
    );
  }

  let sourceResult;
  let quizAnswers = [];
  let privateFieldsRemoved = 0;
  if (technique === "deeptutor") {
    sourceResult = normalizeDeepTutorNativeResult(generated.native_result);
  } else {
    const sanitized = normalizeOpenMaicNativeResult(generated);
    sourceResult = sanitized.publicResult;
    quizAnswers = sanitized.quizAnswers;
    privateFieldsRemoved = sanitized.privateFieldsRemoved;
  }

  const bundleId = `source_${technique}_${randomUUID()
    .replaceAll("-", "")
    .slice(0, 20)}`;
  const publicBundle = {
    bundle_id: bundleId,
    pipeline_version: "3.0-upstream-native",
    selected_technique: technique,
    source_id:
      typeof source.source_id === "string" && source.source_id
        ? source.source_id
        : null,
    provenance: {
      [technique]: structuredClone(generated.provenance || {})
    },
    execution: {
      mode: "upstream_native",
      selected_technique: technique,
      adapters_executed: 1,
      parallel_generation: false,
      model_used: true,
      duration_ms: durationMs,
      native_schema:
        technique === "deeptutor"
          ? "Book/Spine/Page/Block"
          : "Stage/Scene/Canvas/Action",
      private_fields_removed: privateFieldsRemoved,
      upstream: structuredClone(generated.execution || {})
    },
    quality: publicQualitySummary(quality),
    topic: {
      title:
        safeText(
          source.title ||
            sourceResult.book?.title ||
            sourceResult.stage?.name,
          120
        ) || "知识点素材",
      subject: safeText(source.subject, 40) || "通用",
      grade_band: safeText(source.grade_band, 40) || "自适应",
      language: safeText(source.language, 20) || "zh-CN"
    },
    source_result: sourceResult
  };

  return {
    public_bundle: publicBundle,
    server_private: {
      bundle_id: bundleId,
      quiz_answers: quizAnswers
    }
  };
}

function normalizeDeepTutorNativeResult(value) {
  if (!isPlainObject(value)) {
    throw new SourceTechniquePipelineError(
      "SOURCE_ADAPTER_INVALID_OUTPUT",
      "DeepTutor 未返回原生 Book 结果",
      { technique: "deeptutor" }
    );
  }
  const result = structuredClone(value);
  if (
    !isPlainObject(result.book) ||
    !isPlainObject(result.spine) ||
    !Array.isArray(result.pages)
  ) {
    throw new SourceTechniquePipelineError(
      "SOURCE_ADAPTER_INVALID_OUTPUT",
      "DeepTutor 原生 Book/Spine/Page 结构无效",
      { technique: "deeptutor" }
    );
  }
  return result;
}

function normalizeOpenMaicNativeResult(value) {
  if (
    !isPlainObject(value.stage) ||
    !Array.isArray(value.scenes) ||
    value.scenes.length === 0
  ) {
    throw new SourceTechniquePipelineError(
      "SOURCE_ADAPTER_INVALID_OUTPUT",
      "OpenMAIC 原生 Stage/Scene 结构无效",
      { technique: "openmaic" }
    );
  }

  const publicResult = {
    session: structuredClone(value.session || {}),
    outlines: structuredClone(
      Array.isArray(value.outlines) ? value.outlines : []
    ),
    stage: structuredClone(value.stage),
    scenes: structuredClone(value.scenes),
    actions: []
  };
  const quizAnswers = [];
  const privateQuestionDetails = [];
  let privateFieldsRemoved = 0;

  for (const scene of publicResult.scenes) {
    const content = isPlainObject(scene?.content) ? scene.content : {};
    if (scene?.type !== "quiz" && content.type !== "quiz") continue;
    const questions = Array.isArray(content.questions)
      ? content.questions
      : [];
    for (const question of questions) {
      if (!isPlainObject(question)) continue;
      const answers = Array.isArray(question.answer)
        ? question.answer.map((answer) => safeText(answer, 8))
        : [];
      const questionId = safeIdentifier(question.id);
      const answer = answers.length === 1 ? answers[0] : "";
      const answerLabel =
        Array.isArray(question.options) && answer
          ? safeText(
              question.options.find(
                (option) =>
                  isPlainObject(option) &&
                  safeText(option.value, 8) === answer
              )?.label,
              240
            )
          : "";
      if (answer) {
        privateQuestionDetails.push({
          answer,
          answerLabel,
          analysis: safeText(question.analysis, 1200)
        });
      }
      if (
        question.type === "single" &&
        questionId &&
        answers.length === 1 &&
        ["A", "B", "C", "D"].includes(answers[0])
      ) {
        quizAnswers.push({
          question_id: questionId,
          correct_option: answers[0],
          explanation:
            safeText(question.analysis, 1200) ||
            "答案由 OpenMAIC 官方生成流水线给出。"
        });
      }
      if (Object.hasOwn(question, "answer")) {
        delete question.answer;
        privateFieldsRemoved += 1;
      }
      if (Object.hasOwn(question, "analysis")) {
        delete question.analysis;
        privateFieldsRemoved += 1;
      }
      if (Object.hasOwn(question, "commentPrompt")) {
        delete question.commentPrompt;
        privateFieldsRemoved += 1;
      }
    }
  }

  publicResult.actions = publicResult.scenes.flatMap(
    (scene) => (Array.isArray(scene.actions) ? scene.actions : [])
  );
  assertQuizActionsDoNotRevealAnswers(
    publicResult.actions,
    privateQuestionDetails
  );
  return {
    publicResult,
    quizAnswers,
    privateFieldsRemoved
  };
}

function assertQuizActionsDoNotRevealAnswers(actions, questionDetails) {
  if (
    !Array.isArray(actions) ||
    actions.length === 0 ||
    !Array.isArray(questionDetails) ||
    questionDetails.length === 0
  ) {
    return;
  }
  const actionText = collectNestedStrings(actions)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!actionText) return;

  for (const detail of questionDetails) {
    const analysis = String(detail.analysis || "")
      .replace(/\s+/gu, " ")
      .trim();
    if (analysis.length >= 12 && actionText.includes(analysis)) {
      throwQuizActionLeak();
    }
    for (const candidate of [detail.answer, detail.answerLabel]) {
      const token = String(candidate || "").trim();
      if (!token) continue;
      const escaped = escapeRegularExpression(token);
      const answerAnnouncement = new RegExp(
        `(?:正确(?:答案|选项)?|答案|应选|应该选|选择|选)\\s*(?:是|为|[:：=])?\\s*(?:选项\\s*)?[“"'（(【]?${escaped}[”"'）)】]?(?=\\s|[，。！？、,.!?;；]|$)`,
        "iu"
      );
      const englishAnnouncement = new RegExp(
        `(?:correct\\s+(?:answer|option)|answer\\s+is|choose|select)\\s*(?:is|[:=])?\\s*(?:option\\s*)?[“"'(]?${escaped}[”"')]?\\b`,
        "iu"
      );
      if (
        answerAnnouncement.test(actionText) ||
        englishAnnouncement.test(actionText)
      ) {
        throwQuizActionLeak();
      }
    }
  }
}

function collectNestedStrings(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectNestedStrings(item, depth + 1));
  }
  if (!isPlainObject(value)) return [];
  return Object.values(value).flatMap((item) =>
    collectNestedStrings(item, depth + 1)
  );
}

function escapeRegularExpression(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function throwQuizActionLeak() {
  throw new SourceTechniquePipelineError(
    "OPENMAIC_QUIZ_ACTION_LEAK",
    "OpenMAIC 原生 Action 暴露了测验答案，结果已拒绝发布",
    { technique: "openmaic" }
  );
}

function publicQualitySummary(report) {
  if (!isPlainObject(report)) return null;
  return {
    version: report.version,
    status: report.status,
    passed: report.passed,
    warning_codes: Array.isArray(report.warning_codes)
      ? [...report.warning_codes]
      : [],
    metrics: isPlainObject(report.metrics)
      ? structuredClone(report.metrics)
      : {}
  };
}

function assembleSourceBundle({
  technique,
  source,
  generated,
  quality,
  durationMs
}) {
  if (!isPlainObject(generated) || !isPlainObject(generated.material)) {
    throw new SourceTechniquePipelineError(
      "SOURCE_ADAPTER_INVALID_OUTPUT",
      "源码适配器未返回有效产物",
      { technique }
    );
  }

  const fallbackDocument = compileSourceText(source);
  const claims = normalizeClaims(generated.claims, fallbackDocument.claims);
  const topic = normalizeTopic(
    generated.topic,
    source,
    fallbackDocument,
    technique,
    generated.material
  );
  const { publicMaterial, quizAnswers } = splitPrivateQuiz(
    technique,
    generated.material
  );
  const cardMaterials = parameterizeKnowledgeCardMaterials(normalizeCardMaterials(
    generated.card_materials,
    technique,
    publicMaterial,
    claims,
    topic
  ), { staticReason: "generated_material_has_no_trusted_parameter_template" });
  const bundleId = `source_${technique}_${randomUUID()
    .replaceAll("-", "")
    .slice(0, 20)}`;
  const publicBundle = {
    bundle_id: bundleId,
    pipeline_version: "2.0-source-first",
    selected_technique: technique,
    source_id:
      typeof source.source_id === "string" && source.source_id
        ? source.source_id
        : null,
    provenance: {
      [technique]: structuredClone(generated.provenance || {})
    },
    execution: {
      mode: "source_first",
      selected_technique: technique,
      adapters_executed: 1,
      parallel_generation: false,
      model_used: false,
      duration_ms: durationMs
    },
    quality: publicQualitySummary(quality),
    topic,
    claims,
    techniques: {
      [technique]: publicMaterial
    },
    card_materials: cardMaterials
  };
  if (generated.book) {
    publicBundle.source_artifact = structuredClone(generated.book);
  }
  if (generated.stage) {
    publicBundle.source_artifact = structuredClone(generated.stage);
  }
  publicBundle.a2ui = createKnowledgeMaterialA2UI(publicBundle);

  return {
    public_bundle: publicBundle,
    server_private: {
      bundle_id: bundleId,
      quiz_answers: quizAnswers
    }
  };
}

function normalizeTechnique(value) {
  const candidate =
    typeof value === "string" && value.trim()
      ? value.trim().toLowerCase().replace("-", "_")
      : "deeptutor";
  if (!SOURCE_TECHNIQUES.includes(candidate)) {
    throw new SourceTechniquePipelineError(
      "UNSUPPORTED_SOURCE_TECHNIQUE",
      "请选择 DeepTutor、OpenMAIC、Koji-style 或 Cell Studio",
      { technique: candidate }
    );
  }
  return candidate;
}

function normalizeSourceInput(input) {
  if (!isPlainObject(input)) {
    throw new SourceTechniquePipelineError(
      "INVALID_SOURCE_INPUT",
      "素材生成请求必须是对象"
    );
  }
  const source = {
    source_text:
      typeof input.source_text === "string" ? input.source_text.trim() : ""
  };
  for (const field of [
    "source_id",
    "title",
    "subject",
    "grade_band",
    "language"
  ]) {
    if (typeof input[field] === "string" && input[field].trim()) {
      source[field] = input[field].trim();
    }
  }
  if (source.source_text.length < 20 || source.source_text.length > 4000) {
    throw new SourceTechniquePipelineError(
      "INVALID_SOURCE_INPUT",
      "知识内容需要在 20 到 4000 个字符之间"
    );
  }
  return source;
}

function normalizeClaims(primary, fallback) {
  const candidates =
    Array.isArray(primary) && primary.length > 0 ? primary : fallback;
  const seen = new Set();
  const claims = [];
  for (const [index, claim] of candidates.entries()) {
    if (!isPlainObject(claim)) continue;
    const id = safeIdentifier(
      claim.claim_id || claim.id || `claim_${index + 1}`
    );
    const text = safeText(claim.text, 600);
    const sourceSupport = safeText(
      claim.source_support || claim.sourceSupport || text,
      500
    );
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    claims.push({
      claim_id: id,
      text,
      source_support: sourceSupport
    });
  }
  if (claims.length === 0) {
    throw new SourceTechniquePipelineError(
      "SOURCE_ADAPTER_INVALID_OUTPUT",
      "源码适配器没有返回可追溯知识声明"
    );
  }
  return claims.slice(0, 12);
}

function normalizeTopic(
  candidate,
  source,
  fallbackDocument,
  technique,
  material
) {
  const topic = isPlainObject(candidate) ? candidate : {};
  const materialTitle =
    technique === "cell_studio"
      ? material.spatial_scene?.title
      : technique === "openmaic"
        ? material.outlines?.[0]?.title
        : "";
  return {
    topic_id:
      safeIdentifier(topic.topic_id || fallbackDocument.topic_id) ||
      fallbackDocument.topic_id,
    title:
      safeText(topic.title || source.title || materialTitle, 120) ||
      fallbackDocument.title,
    subject:
      safeText(
        topic.subject ||
          source.subject ||
          (technique === "cell_studio" ? "生物" : "通用"),
        40
      ) || "通用",
    grade_band:
      safeText(topic.grade_band || source.grade_band || "自适应", 40) ||
      "自适应",
    language:
      safeText(topic.language || source.language || "zh-CN", 20) || "zh-CN"
  };
}

function splitPrivateQuiz(technique, material) {
  const publicMaterial = structuredClone(material);
  const quiz = isPlainObject(publicMaterial.quiz)
    ? publicMaterial.quiz
    : null;
  if (!quiz) {
    return { publicMaterial, quizAnswers: [] };
  }
  const correctOption = safeText(quiz.correct_option, 8);
  const explanation = safeText(quiz.explanation, 1200);
  delete quiz.correct_option;
  delete quiz.explanation;
  if (
    technique !== "openmaic" ||
    !correctOption ||
    !["A", "B", "C", "D"].includes(correctOption)
  ) {
    return { publicMaterial, quizAnswers: [] };
  }
  return {
    publicMaterial,
    quizAnswers: [
      {
        question_id: safeIdentifier(quiz.question_id),
        correct_option: correctOption,
        explanation: explanation || "答案可由原文中的对应知识声明推出。"
      }
    ].filter((answer) => answer.question_id)
  };
}

function normalizeCardMaterials(
  candidate,
  technique,
  material,
  claims,
  topic
) {
  if (Array.isArray(candidate) && candidate.length > 0) {
    return structuredClone(candidate);
  }
  const claimIds = claims.map((claim) => claim.claim_id);
  if (technique === "deeptutor") {
    return buildDeepTutorCards(material, claimIds, topic);
  }
  if (technique === "openmaic") {
    return buildOpenMaicCards(material, claimIds, topic);
  }
  if (technique === "cell_studio") {
    return buildCellStudioCards(material, claimIds, topic);
  }
  return [
    explanationMaterial({
      id: `${topic.topic_id}_koji`,
      title: `${topic.title} · 渐进辅导`,
      summary: "确定性渐进辅导状态机",
      body: claims.map((claim) => claim.text).join("。"),
      points: claims.slice(0, 4).map((claim) => claim.text),
      claimIds
    })
  ];
}

function buildDeepTutorCards(material, claimIds, topic) {
  const projection = isPlainObject(material.a2ui_projection)
    ? material.a2ui_projection
    : {};
  const graph = isPlainObject(material.concept_graph)
    ? material.concept_graph
    : {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const root = nodes.find((node) => node.id === graph.root_id) || nodes[0];
  const childrenById = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    const child = nodes.find((node) => node.id === edge.to);
    if (child && childrenById.has(edge.from)) {
      childrenById.get(edge.from).push(child);
    }
  }
  const branches = (childrenById.get(root?.id) || []).map((node) => ({
    id: safeIdentifier(node.id),
    title: safeText(node.label, 100),
    children: (childrenById.get(node.id) || [])
      .map((child) => safeText(child.label, 100))
      .filter(Boolean)
  }));
  const explanation = explanationMaterial({
    id: `${topic.topic_id}_deeptutor_explanation`,
    title: projection.title || topic.title,
    summary: projection.summary || claims[0]?.text,
    body: projection.body || claims.map((claim) => claim.text).join("。"),
    points: projection.key_points || claims.slice(0, 5).map((claim) => claim.text),
    callout: projection.callout,
    formula: projection.formula,
    claimIds
  });
  if (!root || branches.length === 0) return [explanation];
  return [
    explanation,
    {
      material_id: `${topic.topic_id}_deeptutor_mindmap`,
      recommended_type: "knowledge.mindmap",
      supports_claim_ids: [...claimIds],
      data: {
        title: `${topic.title}知识结构`,
        root: safeText(root.label, 100) || topic.title,
        branches
      }
    }
  ];
}

function buildOpenMaicCards(material, claimIds, topic) {
  const outlines = Array.isArray(material.outlines) ? material.outlines : [];
  const scenes = Array.isArray(material.scenes) ? material.scenes : [];
  const points = outlines
    .map((outline) => safeText(outline.title || outline.summary, 180))
    .filter(Boolean);
  const cards = [
    explanationMaterial({
      id: `${topic.topic_id}_openmaic_lesson`,
      title: `${topic.title} · 互动课堂`,
      summary: points[0] || "OpenMAIC 官方 DSL 课堂",
      body:
        scenes
          .map((scene) => safeText(scene.title || scene.summary, 300))
          .filter(Boolean)
          .join("。") || "课堂已按 OpenMAIC Scene 与 Action 合约编排。",
      points: points.length > 0 ? points : claimIds.slice(0, 4),
      claimIds
    })
  ];
  const quiz = isPlainObject(material.quiz) ? material.quiz : null;
  if (
    quiz &&
    safeIdentifier(quiz.question_id) &&
    Array.isArray(quiz.options) &&
    quiz.options.length === 4
  ) {
    cards.push({
      material_id: `${topic.topic_id}_openmaic_quiz`,
      recommended_type: "quiz.single-choice",
      supports_claim_ids: Array.isArray(quiz.claim_ids)
        ? quiz.claim_ids.filter((id) => claimIds.includes(id))
        : [...claimIds],
      data: {
        title: safeText(quiz.title, 120) || "课堂检查",
        question_id: safeIdentifier(quiz.question_id),
        prompt: safeText(quiz.prompt, 600),
        options: structuredClone(quiz.options),
        hint: safeText(quiz.hint, 400)
      }
    });
  }
  return cards;
}

function buildCellStudioCards(material, claimIds, topic) {
  const scene = isPlainObject(material.spatial_scene)
    ? material.spatial_scene
    : {};
  const nodes = Array.isArray(scene.nodes) ? scene.nodes : [];
  return [
    explanationMaterial({
      id: `${topic.topic_id}_cell_studio`,
      title: scene.title || `${topic.title} · 空间探索`,
      summary: scene.description || "Cell Architecture Studio 源码场景",
      body: nodes
        .map((node) => `${safeText(node.label, 80)}：${safeText(node.description, 240)}`)
        .filter((line) => line !== "：")
        .join("；"),
      points: nodes.slice(0, 5).map((node) => safeText(node.label, 100)),
      claimIds
    })
  ];
}

function explanationMaterial({
  id,
  title,
  summary,
  body,
  points,
  callout,
  formula,
  claimIds
}) {
  return {
    material_id: safeIdentifier(id),
    recommended_type: "knowledge.explanation",
    supports_claim_ids: [...claimIds],
    data: compactObject({
      title: safeText(title, 120),
      summary: safeText(summary, 320),
      body: safeText(body, 1600),
      formula: safeText(formula, 160),
      key_points: Array.isArray(points)
        ? points.map((point) => safeText(point, 220)).filter(Boolean).slice(0, 6)
        : [],
      callout: safeText(callout, 400),
      sources: ["用户输入原文"]
    })
  };
}

function publicAdapterMessage(code, technique) {
  if (code === "SOURCE_TOO_REPETITIVE") {
    return "输入内容重复度过高，请保留一份完整知识说明后重新生成";
  }
  if (code === "ark_not_configured") {
    return "所选官方源码流水线需要模型，请先配置 Ark API Key";
  }
  if (code === "CELL_STUDIO_UNSUPPORTED_SOURCE") {
    return "Cell Studio 仅支持其官方细胞标本主题；请改用细胞结构内容或选择其他技术";
  }
  if (code === "CELL_STUDIO_INVALID_INPUT") {
    return "Cell Studio 输入格式无效";
  }
  return `${technique || "所选"}官方源码流水线生成失败`;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw new SourceTechniquePipelineError(
    "SOURCE_GENERATION_ABORTED",
    "素材生成已取消"
  );
}

function safeIdentifier(value) {
  const candidate = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return candidate && /^[A-Za-z0-9]/.test(candidate) ? candidate : "";
}

function safeText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === null || item === "") return false;
      return !Array.isArray(item) || item.length > 0;
    })
  );
}

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
  );
}
