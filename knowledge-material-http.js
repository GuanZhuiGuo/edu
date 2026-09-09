const CONFIG_PATH = "/api/knowledge/materials/config";
const GENERATE_PATH = "/api/knowledge/materials/generate";
const GENERATE_TRACE_PATH = "/api/knowledge/materials/generate/trace";
const GRADE_PATH = "/api/knowledge/materials/grade";
const MAX_JSON_BODY_BYTES = 96 * 1024;
const MAX_CONFIG_BODY_BYTES = 2 * 1024;
const MAX_API_KEY_LENGTH = 512;
const DEFAULT_PRIVATE_BUNDLE_LIMIT = 30;
const DEFAULT_PRIVATE_BUNDLE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_QUIZ_ATTEMPTS = 2;
const SAFE_MISSING_KEYS = new Set([
  "ARK_API_KEY",
  "ARK_BASE_URL",
  "ARK_MODEL"
]);
const FORBIDDEN_PUBLIC_KEYS = new Set([
  "answer_key",
  "correct_answer",
  "correct_option",
  "material_bundle",
  "server_private"
]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const SAFE_TRACE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_TRACE_STATUSES = new Set([
  "pending",
  "started",
  "running",
  "streaming",
  "retrying",
  "fallback",
  "completed",
  "failed",
  "cancelled",
  "info",
  "warning"
]);
const SAFE_TRACE_META_KEYS = new Set([
  "attempt",
  "next_attempt",
  "max_attempts",
  "format",
  "response_format",
  "stream",
  "model",
  "timeout_ms",
  "max_tokens",
  "temperature",
  "http_status",
  "error_code",
  "code",
  "provider_code",
  "provider_type",
  "provider_param",
  "request_id",
  "retryable",
  "discarded",
  "from",
  "to",
  "finish_reason",
  "duration_ms",
  "characters",
  "sequence",
  "stage_number",
  "upstream_stage",
  "total",
  "current",
  "progress",
  "scene_count",
  "outline_count",
  "action_count",
  "page_count",
  "block_count",
  "chapter_count",
  "issue_count",
  "verdict",
  "kind",
  "event",
  "warning",
  "count",
  "usage",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens"
]);
const MAX_TRACE_EVENTS = 4_000;
const MAX_TRACE_BYTES = 8 * 1024 * 1024;

class KnowledgeMaterialHttpError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "KnowledgeMaterialHttpError";
    this.code = code;
    this.status = status;
  }
}

export function createKnowledgeMaterialHttpHandler({
  client,
  generateKnowledgeMaterials,
  authorizeConfigRequest,
  authorizeTraceRequest,
  configureApiKey,
  privateBundles = new Map(),
  privateBundleLimit = DEFAULT_PRIVATE_BUNDLE_LIMIT,
  privateBundleTtlMs,
  ttlMs,
  now = Date.now
} = {}) {
  if (typeof generateKnowledgeMaterials !== "function") {
    throw new TypeError("generateKnowledgeMaterials must be a function");
  }
  if (!(privateBundles instanceof Map)) {
    throw new TypeError("privateBundles must be a Map");
  }

  const bundleLimit = Math.max(
    1,
    Math.min(
      DEFAULT_PRIVATE_BUNDLE_LIMIT,
      Number.isInteger(privateBundleLimit)
        ? privateBundleLimit
        : DEFAULT_PRIVATE_BUNDLE_LIMIT
    )
  );
  const bundleTtlMs = normalizePositiveNumber(
    privateBundleTtlMs ?? ttlMs,
    DEFAULT_PRIVATE_BUNDLE_TTL_MS
  );
  const nowImpl = typeof now === "function" ? now : Date.now;
  const privateBundleExpirations = new Map();
  const quizAttemptStates = new Map();

  return async function handleKnowledgeMaterialHttp(
    req,
    res,
    requestUrl
  ) {
    const pathname = resolvePathname(req, requestUrl);
    if (
      pathname !== CONFIG_PATH &&
      pathname !== GENERATE_PATH &&
      pathname !== GENERATE_TRACE_PATH &&
      pathname !== GRADE_PATH
    ) {
      return false;
    }

    if (pathname === CONFIG_PATH) {
      if (req.method === "GET") {
        sendJson(res, 200, publicConfigSummary(client));
        return true;
      }
      if (req.method === "POST") {
        await handleConfigUpdate(
          req,
          res,
          client,
          authorizeConfigRequest,
          configureApiKey
        );
        return true;
      }
      sendMethodNotAllowed(res, "GET, POST");
      return true;
    }

    if (req.method !== "POST") {
      sendMethodNotAllowed(res, "POST");
      return true;
    }

    if (pathname === GRADE_PATH) {
      await handleGrade(
        req,
        res,
        privateBundles,
        privateBundleExpirations,
        quizAttemptStates,
        nowImpl
      );
      return true;
    }

    if (pathname === GENERATE_TRACE_PATH) {
      await handleTraceGenerate({
        req,
        res,
        client,
        generateKnowledgeMaterials,
        authorizeTraceRequest,
        privateBundles,
        privateBundleExpirations,
        quizAttemptStates,
        bundleLimit,
        bundleTtlMs,
        nowImpl
      });
      return true;
    }

    const controller = new AbortController();
    const abort = () => {
      if (!controller.signal.aborted) controller.abort();
    };
    req.once("aborted", abort);
    res.once("close", abort);

    try {
      const input = await readStrictJsonBody(req);
      const result = await generateKnowledgeMaterials(input, {
        client,
        signal: controller.signal
      });
      const generation = normalizeGenerationResult(result);
      rememberPrivateBundle(
        privateBundles,
        privateBundleExpirations,
        quizAttemptStates,
        generation.serverPrivate,
        bundleLimit,
        bundleTtlMs,
        readNow(nowImpl)
      );

      if (canWriteResponse(res)) {
        sendJson(res, 200, {
          public_bundle: generation.publicBundle,
          provider: publicProviderForGeneration(
            client,
            generation.publicBundle
          )
        });
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        canWriteResponse(res)
      ) {
        sendGenerationError(res, error);
      }
    } finally {
      req.removeListener("aborted", abort);
      res.removeListener("close", abort);
    }
    return true;
  };
}

async function handleTraceGenerate({
  req,
  res,
  client,
  generateKnowledgeMaterials,
  authorizeTraceRequest,
  privateBundles,
  privateBundleExpirations,
  quizAttemptStates,
  bundleLimit,
  bundleTtlMs,
  nowImpl
}) {
  if (
    typeof authorizeTraceRequest !== "function" ||
    await safelyAuthorizeRequest(authorizeTraceRequest, req) !== true
  ) {
    sendJson(res, 403, {
      error: "trace_forbidden",
      message: "实时生成 Trace 仅允许在运行服务的本机查看"
    });
    return;
  }

  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  req.once("aborted", abort);
  res.once("close", abort);

  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff"
  });
  res.flushHeaders?.();
  const traceWriter = createTraceStreamWriter(res);

  try {
    traceWriter.trace({
      type: "pipeline.stage",
      stage: "request.received",
      status: "started",
      title: "请求已接收",
      message: "正在校验输入并准备所选源码流水线"
    });
    const input = await readStrictJsonBody(req);
    const result = await generateKnowledgeMaterials(input, {
      client,
      signal: controller.signal,
      onTrace: (event) => traceWriter.trace(event)
    });

    traceWriter.trace({
      type: "pipeline.stage",
      stage: "server.validate",
      status: "started",
      title: "服务端结果校验",
      message: "检查公开产物结构与私密字段边界"
    });
    const generation = normalizeGenerationResult(result);
    rememberPrivateBundle(
      privateBundles,
      privateBundleExpirations,
      quizAttemptStates,
      generation.serverPrivate,
      bundleLimit,
      bundleTtlMs,
      readNow(nowImpl)
    );
    traceWriter.trace({
      type: "pipeline.stage",
      stage: "server.validate",
      status: "completed",
      title: "服务端结果校验完成",
      message: "公开产物与服务端私密判题数据已安全分离"
    });

    traceWriter.end({
      type: "result",
      public_bundle: generation.publicBundle,
      provider: publicProviderForGeneration(
        client,
        generation.publicBundle
      )
    });
  } catch (error) {
    if (!controller.signal.aborted && canWriteResponse(res)) {
      const failure = generationErrorResponse(error);
      traceWriter.trace({
        type: "pipeline.error",
        stage: "pipeline.failed",
        status: "failed",
        title: "生成失败",
        message: failure.body.message,
        meta: {
          error_code: deepestPublicErrorCode(error) || failure.body.error,
          http_status: failure.status
        }
      });
      traceWriter.end({
        type: "error",
        status: failure.status,
        ...failure.body
      });
    }
  } finally {
    traceWriter.dispose();
    req.removeListener("aborted", abort);
    res.removeListener("close", abort);
  }
}

async function safelyAuthorizeRequest(authorize, req) {
  try {
    return await authorize(req) === true;
  } catch {
    return false;
  }
}

function createTraceStreamWriter(res) {
  const startedAt = Date.now();
  const pendingDeltas = new Map();
  let sequence = 0;
  let traceEventCount = 0;
  let traceBytes = 0;
  let deltaTruncated = false;
  let ended = false;

  const writeRecord = (record) => {
    if (ended || !canWriteResponse(res)) return false;
    const line = `${JSON.stringify(record)}\n`;
    try {
      res.write(line);
      return true;
    } catch {
      return false;
    }
  };

  const writeTraceNow = (event) => {
    const normalized = normalizeTraceEvent(event);
    if (!normalized) return;
    const envelope = {
      type: "trace",
      event: {
        sequence: ++sequence,
        timestamp: new Date().toISOString(),
        elapsed_ms: Math.max(0, Date.now() - startedAt),
        ...normalized
      }
    };
    const encodedLength = Buffer.byteLength(JSON.stringify(envelope), "utf8");
    const isDelta = normalized.type === "model.delta";
    if (
      isDelta &&
      (
        traceEventCount >= MAX_TRACE_EVENTS ||
        traceBytes + encodedLength > MAX_TRACE_BYTES
      )
    ) {
      if (!deltaTruncated) {
        deltaTruncated = true;
        writeTraceNow({
          type: "trace.warning",
          stage: normalized.stage || "model.stream",
          status: "warning",
          title: "模型流式输出过长",
          message: "页面 Trace 已停止追加更多模型片段，模型调用仍会继续"
        });
      }
      return;
    }
    traceEventCount += 1;
    traceBytes += encodedLength;
    writeRecord(envelope);
  };

  const flushDelta = (callId) => {
    const pending = pendingDeltas.get(callId);
    if (!pending) return;
    pendingDeltas.delete(callId);
    clearTimeout(pending.timer);
    let remaining = pending.delta;
    while (remaining) {
      const chunk = remaining.slice(0, 4_096);
      remaining = remaining.slice(chunk.length);
      writeTraceNow({
        ...pending.event,
        delta: chunk
      });
    }
  };

  const flushAllDeltas = () => {
    for (const callId of [...pendingDeltas.keys()]) {
      flushDelta(callId);
    }
  };

  return {
    trace(event) {
      if (ended || !event || typeof event !== "object") return;
      if (event.type === "model.delta" && typeof event.delta === "string") {
        const callId =
          safeTraceToken(event.call_id) ||
          safeTraceToken(event.stage) ||
          "model";
        const existing = pendingDeltas.get(callId);
        if (existing) {
          existing.delta += event.delta;
          if (existing.delta.length >= 2_048) flushDelta(callId);
          return;
        }
        const pending = {
          event: { ...event, call_id: callId },
          delta: event.delta,
          timer: null
        };
        pending.timer = setTimeout(() => flushDelta(callId), 40);
        pending.timer.unref?.();
        pendingDeltas.set(callId, pending);
        return;
      }
      flushAllDeltas();
      writeTraceNow(event);
    },
    end(record) {
      if (ended) return;
      flushAllDeltas();
      writeRecord(record);
      ended = true;
      if (!res.writableEnded) res.end();
    },
    dispose() {
      for (const pending of pendingDeltas.values()) {
        clearTimeout(pending.timer);
      }
      pendingDeltas.clear();
    }
  };
}

function normalizeTraceEvent(event) {
  const type = safeTraceToken(event?.type) || "pipeline.stage";
  const stage = safeTraceToken(event?.stage) || "pipeline";
  const status = SAFE_TRACE_STATUSES.has(event?.status)
    ? event.status
    : "info";
  const normalized = {
    type,
    stage,
    status,
    title: safeTraceText(event?.title, 160) || stage
  };
  const message = safeTraceText(event?.message, 800);
  const callId = safeTraceToken(event?.call_id);
  const delta =
    type === "model.delta" && typeof event?.delta === "string"
      ? event.delta.slice(0, 4_096)
      : "";
  const meta = sanitizeTraceMeta(event?.meta);
  if (message) normalized.message = message;
  if (callId) normalized.call_id = callId;
  if (delta) normalized.delta = delta;
  if (meta && Object.keys(meta).length > 0) normalized.meta = meta;
  return normalized;
}

function sanitizeTraceMeta(value, depth = 0) {
  if (
    depth > 3 ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_TRACE_META_KEYS.has(key)) continue;
    if (typeof item === "boolean") {
      result[key] = item;
    } else if (typeof item === "number" && Number.isFinite(item)) {
      result[key] = item;
    } else if (typeof item === "string") {
      result[key] = item.slice(0, 200);
    } else if (Array.isArray(item)) {
      result[key] = item
        .filter((entry) =>
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean"
        )
        .slice(0, 20)
        .map((entry) =>
          typeof entry === "string" ? entry.slice(0, 200) : entry
        );
    } else {
      const nested = sanitizeTraceMeta(item, depth + 1);
      if (nested && Object.keys(nested).length > 0) result[key] = nested;
    }
  }
  return result;
}

function safeTraceToken(value) {
  return typeof value === "string" && SAFE_TRACE_TOKEN_PATTERN.test(value)
    ? value
    : "";
}

function safeTraceText(value, limit) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "").slice(0, limit)
    : "";
}

function deepestPublicErrorCode(error) {
  const visited = new Set();
  let current = error;
  let code = "";
  while (
    current &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    if (typeof current.code === "string" && current.code.length <= 128) {
      code = current.code;
    }
    visited.add(current);
    current = current.cause;
  }
  return safeTraceToken(code);
}

async function handleGrade(
  req,
  res,
  privateBundles,
  privateBundleExpirations,
  quizAttemptStates,
  now
) {
  try {
    const input = await readStrictJsonBody(req);
    const gradeInput = validateGradeInput(input);
    removeExpiredBundles(
      privateBundles,
      privateBundleExpirations,
      quizAttemptStates,
      readNow(now)
    );
    const privateBundle = privateBundles.get(gradeInput.bundle_id);
    if (!privateBundle) {
      throw new KnowledgeMaterialHttpError(
        "bundle_not_found",
        "该素材包已失效，请重新生成",
        404
      );
    }
    const answer = privateBundle.quiz_answers.find(
      (item) => item.question_id === gradeInput.question_id
    );
    if (!answer) {
      throw new KnowledgeMaterialHttpError(
        "question_not_found",
        "未找到对应题目",
        404
      );
    }

    const bundleAttempts = getBundleAttemptStates(
      quizAttemptStates,
      gradeInput.bundle_id
    );
    const attemptState = bundleAttempts.get(gradeInput.question_id) || {
      attempts: 0,
      status: "active"
    };
    if (
      attemptState.status !== "active" ||
      attemptState.attempts >= MAX_QUIZ_ATTEMPTS
    ) {
      throw new KnowledgeMaterialHttpError(
        "question_closed",
        "该题作答已结束，请重新生成素材后再试",
        409
      );
    }

    attemptState.attempts += 1;
    const correct = gradeInput.selected === answer.correct_option;
    const attemptsRemaining = Math.max(
      0,
      MAX_QUIZ_ATTEMPTS - attemptState.attempts
    );
    if (correct) {
      attemptState.status = "correct";
    } else if (attemptsRemaining === 0) {
      attemptState.status = "exhausted";
    }
    bundleAttempts.set(gradeInput.question_id, attemptState);

    if (correct) {
      sendJson(res, 200, {
        correct: true,
        explanation: answer.explanation,
        attempts_remaining: attemptsRemaining
      });
      return;
    }
    sendJson(res, 200, {
      correct: false,
      attempts_remaining: attemptsRemaining
    });
  } catch (error) {
    if (!canWriteResponse(res)) return;
    if (error instanceof KnowledgeMaterialHttpError) {
      sendJson(res, error.status, {
        error: error.code,
        message: error.message
      });
      return;
    }
    sendJson(res, 400, {
      error: "invalid_input",
      message: "判题请求格式无效"
    });
  }
}

async function handleConfigUpdate(
  req,
  res,
  client,
  authorizeConfigRequest,
  configureApiKey
) {
  let authorized = false;
  try {
    authorized = typeof authorizeConfigRequest === "function" &&
      await authorizeConfigRequest(req) === true;
  } catch {
    authorized = false;
  }
  if (!authorized) {
    sendJson(res, 403, {
      error: "config_forbidden",
      message: "仅允许从运行服务的本机配置 Ark 密钥"
    });
    return;
  }
  if (typeof configureApiKey !== "function") {
    sendJson(res, 503, {
      error: "config_unavailable",
      message: "当前服务不支持在线配置 Ark 密钥"
    });
    return;
  }

  try {
    const input = await readStrictJsonBody(req, MAX_CONFIG_BODY_BYTES);
    const apiKey = validateConfigInput(input);
    await configureApiKey(apiKey);
    sendJson(res, 200, publicConfigSummary(client));
  } catch (error) {
    sendConfigUpdateError(res, error);
  }
}

function publicConfigSummary(client) {
  const summary = safeClientSummary(client);
  return {
    configured: summary.configured,
    model: summary.model,
    missing: summary.missing
  };
}

function publicProviderSummary(client) {
  const summary = safeClientSummary(client);
  return {
    type: "ark",
    model: summary.model
  };
}

function publicProviderForGeneration(client, publicBundle) {
  if (publicBundle?.execution?.mode === "upstream_native") {
    const summary = publicProviderSummary(client);
    return {
      ...summary,
      type: "upstream_source",
      source:
        typeof publicBundle?.selected_technique === "string"
          ? publicBundle.selected_technique
          : null,
      model_used: publicBundle?.execution?.model_used === true
    };
  }
  if (
    publicBundle?.execution?.mode === "source_first" &&
    publicBundle.execution.model_used !== true
  ) {
    return {
      type: "source_adapter",
      model: null,
      model_used: false
    };
  }
  return publicProviderSummary(client);
}

function safeClientSummary(client) {
  let summary = {};
  try {
    summary = typeof client?.configSummary === "function"
      ? client.configSummary()
      : {};
  } catch {
    summary = {};
  }
  const missing = Array.isArray(summary?.missing)
    ? summary.missing.filter(
      (key) => typeof key === "string" && SAFE_MISSING_KEYS.has(key)
    )
    : [];
  const model = typeof summary?.model === "string" && summary.model.trim()
    ? summary.model.trim().slice(0, 200)
    : null;

  return {
    configured: summary?.configured === true,
    model,
    missing
  };
}

async function readStrictJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const contentType = String(req.headers["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new KnowledgeMaterialHttpError(
      "invalid_input",
      "请求必须使用 application/json"
    );
  }

  const declaredLength = Number(req.headers["content-length"]);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maxBytes
  ) {
    req.resume();
    throw new KnowledgeMaterialHttpError(
      "payload_too_large",
      "请求体过大",
      413
    );
  }

  const chunks = [];
  let byteLength = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    byteLength += chunk.length;
    if (byteLength > maxBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) {
    throw new KnowledgeMaterialHttpError(
      "payload_too_large",
      "请求体过大",
      413
    );
  }
  if (byteLength === 0) {
    throw new KnowledgeMaterialHttpError(
      "invalid_input",
      "请求体不能为空"
    );
  }

  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new KnowledgeMaterialHttpError(
      "invalid_input",
      "请求体不是合法 JSON"
    );
  }
  if (!isPlainObject(value)) {
    throw new KnowledgeMaterialHttpError(
      "invalid_input",
      "请求体必须是 JSON 对象"
    );
  }
  return value;
}

function validateConfigInput(input) {
  const keys = Object.keys(input);
  if (
    keys.length !== 1 ||
    keys[0] !== "api_key" ||
    typeof input.api_key !== "string"
  ) {
    throw new KnowledgeMaterialHttpError(
      "invalid_api_key",
      "请仅提交非空的 api_key"
    );
  }

  const apiKey = input.api_key.trim();
  if (
    apiKey.length === 0 ||
    apiKey.length > MAX_API_KEY_LENGTH ||
    /\s/u.test(apiKey)
  ) {
    throw new KnowledgeMaterialHttpError(
      "invalid_api_key",
      "api_key 格式无效"
    );
  }
  return apiKey;
}

function validateGradeInput(input) {
  const allowed = new Set(["bundle_id", "question_id", "selected"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new KnowledgeMaterialHttpError(
        "invalid_input",
        `不支持的判题字段：${key}`
      );
    }
  }
  for (const key of ["bundle_id", "question_id"]) {
    if (
      typeof input[key] !== "string" ||
      !SAFE_ID_PATTERN.test(input[key])
    ) {
      throw new KnowledgeMaterialHttpError(
        "invalid_input",
        `${key} 格式无效`
      );
    }
  }
  if (!["A", "B", "C", "D"].includes(input.selected)) {
    throw new KnowledgeMaterialHttpError(
      "invalid_input",
      "selected 必须是 A、B、C 或 D"
    );
  }
  return {
    bundle_id: input.bundle_id,
    question_id: input.question_id,
    selected: input.selected
  };
}

function normalizeGenerationResult(result) {
  if (
    !isPlainObject(result) ||
    !isPlainObject(result.public_bundle) ||
    !isPlainObject(result.server_private)
  ) {
    throw new KnowledgeMaterialHttpError(
      "upstream_validation_failed",
      "生成结果未通过服务端校验",
      502
    );
  }

  assertNoPrivatePublicFields(result.public_bundle);
  const publicBundle = structuredClone(result.public_bundle);
  const bundleId = publicBundle.bundle_id;
  if (
    typeof bundleId !== "string" ||
    !SAFE_ID_PATTERN.test(bundleId) ||
    result.server_private.bundle_id !== bundleId ||
    !Array.isArray(result.server_private.quiz_answers)
  ) {
    throw new KnowledgeMaterialHttpError(
      "upstream_validation_failed",
      "生成结果未通过服务端校验",
      502
    );
  }

  const seenQuestions = new Set();
  const quizAnswers = result.server_private.quiz_answers.map((item) => {
    if (
      !isPlainObject(item) ||
      typeof item.question_id !== "string" ||
      !SAFE_ID_PATTERN.test(item.question_id) ||
      seenQuestions.has(item.question_id) ||
      !["A", "B", "C", "D"].includes(item.correct_option) ||
      typeof item.explanation !== "string" ||
      !item.explanation.trim()
    ) {
      throw new KnowledgeMaterialHttpError(
        "upstream_validation_failed",
        "生成结果未通过服务端校验",
        502
      );
    }
    seenQuestions.add(item.question_id);
    return {
      question_id: item.question_id,
      correct_option: item.correct_option,
      explanation: item.explanation.trim()
    };
  });

  return {
    publicBundle,
    serverPrivate: {
      bundle_id: bundleId,
      quiz_answers: quizAnswers
    }
  };
}

function assertNoPrivatePublicFields(value) {
  const walk = (item) => {
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (!isPlainObject(item)) return;
    for (const [key, child] of Object.entries(item)) {
      if (FORBIDDEN_PUBLIC_KEYS.has(key.toLowerCase())) {
        throw new KnowledgeMaterialHttpError(
          "upstream_validation_failed",
          "生成结果未通过服务端校验",
          502
        );
      }
      walk(child);
    }
  };
  walk(value);
}

function rememberPrivateBundle(
  privateBundles,
  privateBundleExpirations,
  quizAttemptStates,
  bundle,
  limit,
  ttlMs,
  now
) {
  removeExpiredBundles(
    privateBundles,
    privateBundleExpirations,
    quizAttemptStates,
    now
  );
  if (privateBundles.has(bundle.bundle_id)) {
    privateBundles.delete(bundle.bundle_id);
    privateBundleExpirations.delete(bundle.bundle_id);
    quizAttemptStates.delete(bundle.bundle_id);
  }
  privateBundles.set(bundle.bundle_id, structuredClone(bundle));
  privateBundleExpirations.set(bundle.bundle_id, now + ttlMs);
  while (privateBundles.size > limit) {
    const oldest = privateBundles.keys().next().value;
    privateBundles.delete(oldest);
    privateBundleExpirations.delete(oldest);
    quizAttemptStates.delete(oldest);
  }
}

function removeExpiredBundles(
  privateBundles,
  privateBundleExpirations,
  quizAttemptStates,
  now
) {
  for (const bundleId of privateBundles.keys()) {
    const expiresAt = privateBundleExpirations.get(bundleId);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      privateBundles.delete(bundleId);
      privateBundleExpirations.delete(bundleId);
      quizAttemptStates.delete(bundleId);
    }
  }
}

function getBundleAttemptStates(quizAttemptStates, bundleId) {
  let bundleAttempts = quizAttemptStates.get(bundleId);
  if (!bundleAttempts) {
    bundleAttempts = new Map();
    quizAttemptStates.set(bundleId, bundleAttempts);
  }
  return bundleAttempts;
}

function readNow(now) {
  const value = Number(now());
  return Number.isFinite(value) ? value : Date.now();
}

function normalizePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric
    : fallback;
}

function sendGenerationError(res, error) {
  const failure = generationErrorResponse(error);
  sendJson(res, failure.status, failure.body);
}

function generationErrorResponse(error) {
  if (error instanceof KnowledgeMaterialHttpError) {
    return {
      status: error.status,
      body: {
        error: error.code,
        message: error.message
      }
    };
  }
  if (
    errorChainHasCode(error, "UNSUPPORTED_SOURCE_TECHNIQUE") ||
    errorChainHasCode(error, "INVALID_SOURCE_INPUT") ||
    errorChainHasCode(error, "CELL_STUDIO_INVALID_INPUT")
  ) {
    return {
      status: 400,
      body: {
        error:
          typeof error?.code === "string"
            ? error.code
            : "invalid_source_input",
        message: error?.message || "素材生成请求格式无效"
      }
    };
  }
  if (errorChainHasCode(error, "CELL_STUDIO_UNSUPPORTED_SOURCE")) {
    return {
      status: 422,
      body: {
        error: "CELL_STUDIO_UNSUPPORTED_SOURCE",
        technique: "cell_studio",
        message:
          "Cell Studio 仅支持其官方细胞标本主题；请改用细胞结构内容或选择其他技术"
      }
    };
  }
  if (errorChainHasCode(error, "SOURCE_TOO_REPETITIVE")) {
    return {
      status: 422,
      body: {
        error: "SOURCE_TOO_REPETITIVE",
        message:
          "输入内容重复度过高，请保留一份完整知识说明后重新生成"
      }
    };
  }
  if (
    errorChainHasCode(error, "SOURCE_ADAPTER_FAILED") ||
    errorChainHasCode(error, "SOURCE_ADAPTER_INVALID_OUTPUT") ||
    errorChainHasCode(error, "OPENMAIC_DSL_VALIDATION_FAILED") ||
    errorChainHasCode(error, "DEEPTUTOR_SOURCE_FAILED") ||
    errorChainHasCode(error, "DEEPTUTOR_BRIDGE_FAILED") ||
    errorChainHasCode(error, "OPENMAIC_SOURCE_FAILED") ||
    errorChainHasCode(error, "OPENMAIC_BRIDGE_FAILED") ||
    errorChainHasCode(error, "UPSTREAM_SOURCE_FAILED") ||
    errorChainHasCodePrefix(error, "DEEPTUTOR_") ||
    errorChainHasCodePrefix(error, "OPENMAIC_") ||
    errorChainHasCodePrefix(error, "UPSTREAM_")
  ) {
    return {
      status: 502,
      body: {
        error: "source_adapter_failed",
        message: "所选官方源码流水线未能生成有效结果"
      }
    };
  }
  if (errorChainHasCode(error, "ark_not_configured")) {
    return {
      status: 503,
      body: {
        error: "ark_not_configured",
        message: "Ark 模型尚未配置，请先在本机录入 API Key"
      }
    };
  }
  if (errorChainHasCode(error, "INVALID_INPUT")) {
    return {
      status: 400,
      body: {
        error: "invalid_input",
        message: "知识点素材输入格式无效"
      }
    };
  }
  if (
    errorChainHasCode(error, "INVALID_STAGE_OUTPUT") ||
    errorChainHasCode(error, "PRIVATE_DATA_LEAK")
  ) {
    return {
      status: 502,
      body: {
        error: "upstream_validation_failed",
        message: "模型生成结果未通过结构校验"
      }
    };
  }
  return {
    status: 502,
    body: {
      error: "upstream_generation_failed",
      message: "知识点素材生成暂时失败，请稍后重试"
    }
  };
}

function sendConfigUpdateError(res, error) {
  if (error instanceof KnowledgeMaterialHttpError) {
    sendJson(res, error.status, {
      error: error.code,
      message: error.message
    });
    return;
  }
  sendJson(res, 500, {
    error: "config_update_failed",
    message: "Ark 密钥配置失败，请检查后重试"
  });
}

function errorChainHasCode(error, expectedCode) {
  const visited = new Set();
  let current = error;
  while (
    current &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    if (current.code === expectedCode) return true;
    visited.add(current);
    current = current.cause;
  }
  return false;
}

function errorChainHasCodePrefix(error, expectedPrefix) {
  const visited = new Set();
  let current = error;
  while (
    current &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    if (
      typeof current.code === "string" &&
      current.code.startsWith(expectedPrefix)
    ) {
      return true;
    }
    visited.add(current);
    current = current.cause;
  }
  return false;
}

function resolvePathname(req, requestUrl) {
  if (requestUrl instanceof URL) return requestUrl.pathname;
  return new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`
  ).pathname;
}

function sendMethodNotAllowed(res, allowedMethod) {
  res.setHeader("allow", allowedMethod);
  sendJson(res, 405, {
    error: "method_not_allowed",
    message: `请使用 ${allowedMethod} 请求`
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function canWriteResponse(res) {
  return (
    !res.destroyed &&
    !res.writableEnded &&
    !res.socket?.destroyed
  );
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
