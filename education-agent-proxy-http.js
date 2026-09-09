import { randomUUID } from "node:crypto";

const CHAT_PATHS = new Set(["/api/agent/chat", "/api/agent/chat/stream"]);
const MAX_REQUEST_BYTES = 14 * 1024 * 1024;
const MAX_ANSWER_CHARACTERS = 256 * 1024;
const MAX_DELTA_CHARACTERS = 16 * 1024;
const MAX_TRACE_MESSAGE_CHARACTERS = 240;
const ALLOWED_CARD_KINDS = new Set(["summary", "article", "reference", "image", "video"]);
const FORBIDDEN_PROVIDER_CARD_TYPES = new Set([
  "a2ui",
  "component",
  "html",
  "iframe",
  "script",
  "svg",
  "widget",
]);

/**
 * Optional HTTP router for the external education Agent.
 *
 * Put this handler before the Pi learning handler. When the proxy switch is
 * off it deliberately returns false, leaving the existing Pi route untouched.
 */
export function createEducationAgentProxyHttpHandler({
  client,
  proxyClient,
  authorizeRequest = () => false,
  resolveUserId,
  idFactory = randomUUID,
  clock = () => new Date().toISOString(),
  maxRequestBytes = MAX_REQUEST_BYTES,
} = {}) {
  const activeClient = client || proxyClient;
  if (!activeClient?.configSummary || !activeClient?.streamConversation) {
    throw new TypeError("education Agent proxy client is required");
  }

  return async function handleEducationAgentProxyHttp(req, res, requestUrl) {
    const pathname = requestUrl?.pathname || new URL(req.url || "/", "http://localhost").pathname;
    if (!CHAT_PATHS.has(pathname) || req.method !== "POST") return false;

    const summary = safeConfigSummary(activeClient);
    if (summary.enabled !== true) return false;

    if (!(await Promise.resolve(authorizeRequest(req)))) {
      sendJson(res, 403, {
        error: "education_agent_forbidden",
        message: "当前请求无权使用 Agent 代理",
      });
      return true;
    }

    if (summary.configured !== true) {
      sendJson(res, 503, {
        error: "agent_proxy_not_configured",
        message: "Agent 代理尚未完成地址与 Key 配置",
      });
      return true;
    }

    const stream = pathname.endsWith("/stream");
    const controller = new AbortController();
    const onDisconnect = () => {
      if (!res.writableEnded) controller.abort(new Error("client_disconnected"));
    };
    req.once("aborted", onDisconnect);
    res.once("close", onDisconnect);

    try {
      const body = await readJsonBody(req, maxRequestBytes);
      const requestId = safeIdentifier(`agent-proxy:${idFactory()}`, `agent-proxy:${randomUUID()}`, 200);
      const startedAt = Date.now();
      const userId = await resolveProxyUserId(resolveUserId, { req, body });
      const proxyInput = buildProxyInput(body, {
        requestId,
        signal: controller.signal,
        userId,
      });

      if (stream) {
        await handleStream(activeClient, proxyInput, req, res, {
          requestId,
          startedAt,
          clock,
          controller,
        });
      } else {
        await handleJson(activeClient, proxyInput, res, {
          body,
          requestId,
          clock,
        });
      }
    } catch (error) {
      if (res.writableEnded || res.destroyed) return true;
      const publicError = describeProxyHttpError(error);
      if (stream) {
        beginNdjson(res, publicError.status);
        writeNdjson(res, {
          type: "error",
          code: publicError.code,
          message: publicError.message,
          retryable: publicError.retryable,
        });
        res.end();
      } else {
        sendJson(res, publicError.status, {
          error: publicError.code,
          message: publicError.message,
          retryable: publicError.retryable,
        });
      }
    } finally {
      req.off("aborted", onDisconnect);
      res.off("close", onDisconnect);
    }
    return true;
  };
}

async function handleStream(client, input, req, res, {
  requestId,
  startedAt,
  clock,
  controller,
}) {
  beginNdjson(res, 200);
  writeNdjson(res, {
    type: "status",
    stage: "agent_proxy.request.accepted",
    message: "Agent 代理已接收问题",
    trace_id: requestId,
    elapsed_ms: 0,
  });

  const deltaProjector = createSafeDeltaProjector();
  let finalWritten = false;
  try {
    for await (const event of client.streamConversation(input)) {
      if (controller.signal.aborted || req.aborted || res.destroyed || res.writableEnded) break;
      if (event?.type === "error") {
        const error = new Error("external Agent returned an error event");
        error.code = safeIdentifier(event.code, "agent_proxy_provider_error", 120);
        throw error;
      }
      if (event?.type === "delta") {
        const delta = deltaProjector.push(event.delta);
        if (delta) {
          writeNdjson(res, {
            type: "delta",
            delta,
            source: "external_agent_proxy",
            trace_id: requestId,
            elapsed_ms: elapsedSince(startedAt),
          });
        }
        continue;
      }
      if (event?.type === "trace") {
        const trace = normalizeProxyTraceEvent(event, requestId, elapsedSince(startedAt));
        if (trace) writeNdjson(res, trace);
        continue;
      }
      if (event?.type === "status") {
        const status = normalizeProxyStatusEvent(event, requestId, elapsedSince(startedAt));
        if (status) writeNdjson(res, status);
        continue;
      }
      // Artifact/meta events are never sent directly to the browser. Rich
      // content is accepted only after final-result whitelist projection.
      if (event?.type !== "final") continue;
      const pendingText = deltaProjector.flush();
      if (pendingText) {
        writeNdjson(res, {
          type: "delta",
          delta: pendingText,
          source: "external_agent_proxy",
          trace_id: requestId,
          elapsed_ms: elapsedSince(startedAt),
        });
      }
      const final = normalizeExternalAgentProxyFinal(event, {
        requestId,
        sessionId: input.sessionId,
        clock,
      });
      writeNdjson(res, final);
      finalWritten = true;
      break;
    }
    if (!controller.signal.aborted && !finalWritten) {
      const error = new Error("external Agent stream ended without a final event");
      error.code = "agent_proxy_incomplete_stream";
      throw error;
    }
    if (!res.writableEnded) res.end();
  } catch (error) {
    if (controller.signal.aborted || req.aborted || res.destroyed || res.writableEnded) return;
    const publicError = describeProxyHttpError(error);
    writeNdjson(res, {
      type: "error",
      code: publicError.code,
      message: publicError.message,
      retryable: publicError.retryable,
      trace_id: requestId,
      elapsed_ms: elapsedSince(startedAt),
    });
    res.end();
  }
}

async function handleJson(client, input, res, { body, requestId, clock }) {
  let result;
  if (typeof client.chat === "function") {
    result = await client.chat(input);
  } else {
    for await (const event of client.streamConversation(input)) {
      if (event?.type === "final") result = event;
    }
  }
  if (!result) {
    const error = new Error("external Agent did not return a final event");
    error.code = "agent_proxy_incomplete_stream";
    throw error;
  }
  const final = normalizeExternalAgentProxyFinal(result, {
    requestId,
    sessionId: body.session_id ?? body.sessionId,
    clock,
  });
  const { type: _type, ...payload } = final;
  sendJson(res, 200, payload);
}

export function normalizeExternalAgentProxyFinal(value, {
  requestId = `agent-proxy:${randomUUID()}`,
  sessionId = "",
  clock = () => new Date().toISOString(),
} = {}) {
  const source = isPlainObject(value) ? value : {};
  const answer = sanitizeMarkdownText(source.display_answer ?? source.answer);
  if (!answer) {
    const error = new Error("external Agent returned an empty answer");
    error.code = "agent_proxy_empty_answer";
    throw error;
  }

  const richResults = normalizeRichResults(
    source.rich_results ?? source.external_grounding?.rich_results,
  );
  const attachments = normalizeAttachments(
    source.attachments ?? source.external_grounding?.attachments,
  );
  const suggestions = normalizeSuggestions(
    source.suggestions ?? source.external_grounding?.suggestions,
  );
  const references = normalizeReferences([
    ...(Array.isArray(source.references) ? source.references : []),
    ...(Array.isArray(source.external_grounding?.references)
      ? source.external_grounding.references
      : []),
  ]);
  const safeRequestId = safeIdentifier(requestId, `agent-proxy:${randomUUID()}`, 200);
  const conversationId = safeOpaqueId(source.conversation_id ?? source.conversationId, 240);
  const chatId = safeOpaqueId(source.chat_id ?? source.chatId, 240);
  const messageId = safeOpaqueId(source.message_id ?? source.messageId ?? source.id, 240)
    || safeRequestId;

  return deepFreeze({
    schema_version: "education-agent-proxy-http-final@1.0",
    type: "final",
    answer,
    display_answer: answer,
    conversation_id: conversationId,
    chat_id: chatId,
    message_id: messageId,
    trace_id: safeRequestId,
    grading_session_id: safeOpaqueId(sessionId, 240),
    provider: "external_agent_proxy",
    grounding_status: "external_agent_answered",
    ui_mode: "external_agent_proxy",
    teaching_package: null,
    ui_projection: null,
    ui_skipped_cards: [],
    references,
    rich_results: richResults,
    attachments,
    suggestions,
    external_grounding: {
      schema_version: "external-learning-grounding@1.0",
      mode: "external_agent_proxy",
      provider: "external_agent_proxy",
      references,
      rich_results: richResults,
      attachments,
      suggestions,
      retrieved_at: safeIsoTime(clock()),
    },
    // The external Agent is a presentation source, never a mastery or local
    // knowledge-binding authority.
    mastery_write_authorized: false,
  });
}

function buildProxyInput(body, { requestId, signal, userId }) {
  if (!isPlainObject(body)) throw requestError("invalid_json", "提问内容格式无效", 400, false);
  const image = normalizeTransportImage(body.image);
  const content = String(body.message ?? body.content ?? body.text ?? "")
    .replace(/\u0000/gu, "")
    .trim()
    .slice(0, 128 * 1024);
  if (!content && !image) {
    throw requestError("agent_proxy_content_required", "请输入问题内容或上传图片", 422, false);
  }
  const sessionId = safeOpaqueId(body.session_id ?? body.sessionId, 240);
  const questionPreferences = normalizeProxyQuestionPreferences(
    body.question_preferences ?? body.questionPreferences,
  );
  const shortcutContext = normalizeProxyShortcut(body.shortcut);
  const continuationContext = normalizeProxyContinuationContext(
    body.continuation_context ?? body.continuationContext,
  );
  const context = compactStringMap({
    scene: "education_ai_teacher",
    response_schema_version: "education-agent-render-contract@1.0",
    response_channels: "answer,trace,card,image,video,suggestion",
    card_policy: "declarative_only_no_html_no_javascript",
    skill: body.skill,
    session_id: sessionId,
    course_scope_id: body.course_scope_id ?? body.courseScopeId,
    knowledge_point_id: body.knowledge_point_id ?? body.knowledgePointId,
    image_task_mode: body.image_task_mode ?? body.imageTaskMode,
    portal_role: body.portal_role ?? body.portalRole,
    require_structured_response: body.require_structured_response === true ? "true" : "false",
    question_preferences: questionPreferences ? JSON.stringify(questionPreferences) : undefined,
    shortcut_context: shortcutContext ? JSON.stringify(shortcutContext) : undefined,
    continuation_context: continuationContext ? JSON.stringify(continuationContext) : undefined,
  });
  return {
    content,
    conversationId: safeOpaqueId(body.conversation_id ?? body.conversationId, 240),
    userId: safeOpaqueId(userId ?? body.user_id ?? body.userId, 240),
    sessionId,
    ...(image ? { image } : {}),
    customPassThroughMap: context,
    traceId: requestId,
    signal,
  };
}

function normalizeProxyQuestionPreferences(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw requestError("agent_proxy_invalid_question_preferences", "出题参数格式无效", 422, false);
  }
  const itemType = safeToken(value.item_type ?? value.question_type, 60).toLowerCase();
  const allowedItemTypes = new Set([
    "single_choice", "multiple_choice", "numeric", "short_answer", "worked_response",
  ]);
  const difficulty = safeToken(value.difficulty, 40).toLowerCase();
  const cognitiveLevel = safeToken(value.cognitive_level, 40).toLowerCase();
  const count = Number(value.count);
  return {
    ...(itemType && allowedItemTypes.has(itemType) ? { item_type: itemType } : {}),
    ...(difficulty && ["easy", "medium", "hard"].includes(difficulty) ? { difficulty } : {}),
    ...(cognitiveLevel && ["remember", "understand", "apply", "analyze", "synthesize"].includes(cognitiveLevel)
      ? { cognitive_level: cognitiveLevel }
      : {}),
    ...(Number.isInteger(count) && count >= 1 && count <= 20 ? { count } : {}),
    ...(typeof value.adaptive === "boolean" ? { adaptive: value.adaptive } : {}),
    ...(safeOpaqueId(value.knowledge_point_id, 180)
      ? { knowledge_point_id: safeOpaqueId(value.knowledge_point_id, 180) }
      : {}),
    ...(safePlainText(value.generation_method, 120)
      ? { generation_method: safePlainText(value.generation_method, 120) }
      : {}),
  };
}

function normalizeProxyShortcut(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw requestError("agent_proxy_invalid_shortcut", "快捷入口参数格式无效", 422, false);
  }
  const id = safeOpaqueId(value.id, 120);
  const artifactIds = normalizeIdentifierList(value.artifact_ids, 12);
  const knowledgePointIds = normalizeIdentifierList(value.knowledge_point_ids, 12);
  return id || artifactIds.length || knowledgePointIds.length
    ? { id, artifact_ids: artifactIds, knowledge_point_ids: knowledgePointIds }
    : null;
}

function normalizeProxyContinuationContext(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw requestError("agent_proxy_invalid_continuation_context", "学习延续上下文格式无效", 422, false);
  }
  const context = {
    source_kind: safeToken(value.source_kind, 40),
    source_id: safeOpaqueId(value.source_id, 160),
    source_date: safePlainText(value.source_date, 20),
    course_id: safeOpaqueId(value.course_id, 160),
    course_name: safePlainText(value.course_name, 160),
    title: safePlainText(value.title, 200),
    summary: safePlainText(value.summary, 2_000),
    last_user_message: safePlainText(value.last_user_message, 1_200),
    last_teacher_message: safePlainText(value.last_teacher_message, 2_000),
    knowledge_point_ids: normalizeIdentifierList(value.knowledge_point_ids, 12),
  };
  return Object.values(context).some((item) => Array.isArray(item) ? item.length : Boolean(item))
    ? context
    : null;
}

function normalizeIdentifierList(value, limit) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  return dedupe(
    value.map((item) => safeOpaqueId(item, 180)).filter(Boolean),
    (item) => item,
    limit,
  );
}

function normalizeTransportImage(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw requestError("agent_proxy_invalid_image", "图片数据格式无效", 422, false);
  const data = typeof value.data === "string" ? value.data.slice(0, 12 * 1024 * 1024) : "";
  const dataUrl = typeof value.data_url === "string"
    ? value.data_url.slice(0, 12 * 1024 * 1024)
    : typeof value.dataUrl === "string" ? value.dataUrl.slice(0, 12 * 1024 * 1024) : "";
  return {
    name: safeFileName(value.name ?? value.file_name ?? "question-image"),
    mime_type: safeToken(value.mime_type ?? value.mimeType ?? value.type, 100).toLowerCase(),
    ...(data ? { data } : {}),
    ...(dataUrl ? { data_url: dataUrl } : {}),
  };
}

function normalizeProxyStatusEvent(event, requestId, elapsedMs) {
  const message = safePlainText(event?.message || "Agent 代理正在处理", 160);
  if (!message) return null;
  return {
    type: "status",
    stage: safeStage(event?.stage, "agent_proxy.working"),
    message,
    trace_id: requestId,
    elapsed_ms: elapsedMs,
  };
}

function normalizeProxyTraceEvent(event, requestId, elapsedMs) {
  const span = isPlainObject(event?.span) ? event.span : {};
  const message = safePlainText(event?.message || "Agent 代理正在处理", MAX_TRACE_MESSAGE_CHARACTERS);
  if (!message) return null;
  const channel = safeToken(span.channel ?? event.channel, 80).toLowerCase();
  return {
    type: "trace",
    stage: safeStage(event?.stage, channel ? `agent_proxy.${channel}` : "agent_proxy.working"),
    name: safePlainText(span.name ?? event.name, 160),
    message,
    status: normalizeTraceStatus(span.status ?? event.status),
    kind: normalizeTraceKind(span.span_type ?? span.kind ?? event.kind, channel),
    span_id: safeIdentifier(span.span_id ?? event.span_id, "", 180),
    parent_span_id: safeIdentifier(span.parent_span_id ?? event.parent_span_id, "", 180),
    duration_ms: boundedNonNegativeNumber(span.duration_ms ?? event.duration_ms, 600_000),
    started_at: safeOptionalIsoTime(span.started_at ?? event.started_at),
    ended_at: safeOptionalIsoTime(span.ended_at ?? event.ended_at),
    input_summary: safePlainText(span.input_summary ?? event.input_summary, 2_000),
    output_summary: safePlainText(span.output_summary ?? event.output_summary, 2_000),
    attributes: normalizeProxyTraceAttributes(span.attributes ?? event.attributes),
    references: normalizeReferences(event.references),
    trace_id: requestId,
    elapsed_ms: elapsedMs,
  };
}

function normalizeRichResults(value) {
  const source = isPlainObject(value) ? value : {};
  return deepFreeze({
    schema_version: "external-rich-results@1.0",
    cards: dedupe(
      arrayOf(source.cards).map(normalizeCard).filter(Boolean),
      (item) => item.id || item.url || `${item.kind}:${item.title}`,
      12,
    ),
    images: dedupe(
      arrayOf(source.images ?? source.image_infos).map(normalizeImage).filter(Boolean),
      (item) => item.image_url,
      16,
    ),
    videos: dedupe(
      arrayOf(source.videos ?? source.video_infos).map(normalizeVideo).filter(Boolean),
      (item) => item.id || item.url || item.cover_image?.image_url,
      8,
    ),
  });
}

function normalizeCard(value) {
  if (!isPlainObject(value)) return null;
  const providerType = safeToken(value.provider_type ?? value.card_type ?? value.type, 80).toLowerCase();
  if (FORBIDDEN_PROVIDER_CARD_TYPES.has(providerType)) return null;
  const kind = safeToken(value.kind, 40).toLowerCase();
  if (!ALLOWED_CARD_KINDS.has(kind)) return null;
  const id = safePlainText(value.id, 240);
  const title = safePlainText(value.title, 600);
  const summary = safePlainText(value.summary, 2_000);
  const url = safePublicHttpsUrl(value.url);
  const image = normalizeImage(value.image);
  const video = kind === "video" ? normalizeVideo(value.video) : null;
  if (!id && !title && !summary && !url && !image && !video) return null;
  return {
    id,
    kind,
    provider_type: providerType || "unknown",
    title: title || cardFallbackTitle(kind),
    summary,
    site_name: safePlainText(value.site_name, 240),
    source_type: safeToken(value.source_type, 120),
    author_name: safePlainText(value.author_name, 240),
    url: url || video?.url || null,
    image,
    video,
  };
}

function normalizeImage(value) {
  if (!isPlainObject(value)) return null;
  const imageUrl = safePublicHttpsUrl(value.image_url ?? value.imageUrl ?? value.url ?? value.src);
  if (!imageUrl) return null;
  return {
    image_url: imageUrl,
    source_url: safePublicHttpsUrl(value.source_url ?? value.sourceUrl ?? value.link) || null,
    width: boundedNumber(value.width, 100_000),
    height: boundedNumber(value.height, 100_000),
    alt: safePlainText(value.alt ?? value.title ?? value.caption, 300),
  };
}

function normalizeVideo(value) {
  if (!isPlainObject(value)) return null;
  const id = safePlainText(value.id ?? value.video_id ?? value.videoId, 240);
  const url = safePublicHttpsUrl(value.url ?? value.video_url ?? value.videoUrl ?? value.play_url);
  const coverImage = normalizeImage(value.cover_image ?? value.coverImage ?? value.poster);
  if (!id && !url && !coverImage) return null;
  return {
    id,
    url: url || null,
    title: safePlainText(value.title ?? value.name, 600),
    site_name: safePlainText(value.site_name ?? value.siteName, 240),
    source_type: safeToken(value.source_type ?? value.sourceType, 120),
    author_name: safePlainText(value.author_name ?? value.authorName, 240),
    width: boundedNumber(value.width, 100_000),
    height: boundedNumber(value.height, 100_000),
    duration_ms: boundedNumber(value.duration_ms ?? value.durationMs ?? value.duration, 86_400_000),
    cover_image: coverImage,
  };
}

function normalizeAttachments(value) {
  const source = isPlainObject(value) ? value : {};
  return deepFreeze({
    schema_version: "agent-proxy-attachments@1.0",
    audio: dedupe(arrayOf(source.audio ?? source.audios).map(normalizeAudio).filter(Boolean), (item) => item.id || item.url, 8),
    files: dedupe(arrayOf(source.files).map(normalizeFile).filter(Boolean), (item) => item.id || item.url || item.name, 12),
  });
}

function normalizeAudio(value) {
  if (!isPlainObject(value)) return null;
  const id = safePlainText(value.id ?? value.audio_id, 240);
  const url = safePublicHttpsUrl(value.url ?? value.audio_url ?? value.play_url);
  if (!id && !url) return null;
  return {
    id,
    url: url || null,
    title: safePlainText(value.title ?? value.name, 600),
    mime_type: safeToken(value.mime_type ?? value.content_type, 120).toLowerCase(),
    duration_ms: boundedNumber(value.duration_ms ?? value.duration, 86_400_000),
  };
}

function normalizeFile(value) {
  if (!isPlainObject(value)) return null;
  const id = safePlainText(value.id ?? value.file_id ?? value.object_key, 240);
  const url = safePublicHttpsUrl(value.url ?? value.file_url ?? value.download_url ?? value.storage_url);
  // Provider-side ids are not browser-safe download targets. Only expose a
  // file after it resolves to a reviewed public HTTPS URL.
  if (!url) return null;
  return {
    id,
    url: url || null,
    name: safeFileName(value.name ?? value.file_name ?? value.title),
    mime_type: safeToken(value.mime_type ?? value.content_type, 120).toLowerCase(),
    size: boundedNumber(value.size ?? value.file_size, 1024 * 1024 * 1024),
  };
}

function normalizeSuggestions(value) {
  return deepFreeze(dedupe(
    arrayOf(value)
      .map((item) => safePlainText(isPlainObject(item) ? item.text ?? item.content ?? item.title : item, 500))
      .filter(Boolean),
    (item) => item,
    8,
  ));
}

function normalizeReferences(value) {
  return deepFreeze(dedupe(
    arrayOf(value).map((item) => {
      if (!isPlainObject(item)) return null;
      const id = safePlainText(item.id ?? item.reference_id ?? item.doc_id, 240);
      const title = safePlainText(item.title ?? item.name ?? item.document_name, 600);
      const url = safePublicHttpsUrl(item.url ?? item.link ?? item.source_url);
      if (!id && !title && !url) return null;
      return {
        id,
        title: title || "参考资料",
        site_name: safePlainText(item.site_name ?? item.siteName ?? item.site, 240),
        publish_time: safePlainText(item.publish_time ?? item.publishTime ?? item.published_at, 100),
        url: url || null,
        snippet: safePlainText(item.snippet ?? item.summary ?? item.description, 1_000),
      };
    }).filter(Boolean),
    (item) => item.url || item.id || `${item.site_name}:${item.title}`,
    30,
  ));
}

function createSafeDeltaProjector() {
  let tagBuffer = "";
  return {
    push(value) {
      const source = String(value ?? "").replace(/\u0000/gu, "").slice(0, MAX_DELTA_CHARACTERS);
      let output = "";
      for (const character of source) {
        if (tagBuffer) {
          tagBuffer += character;
          if (character === ">") {
            if (!isHtmlTag(tagBuffer)) output += tagBuffer;
            tagBuffer = "";
          } else if (tagBuffer.length > 512) {
            output += tagBuffer;
            tagBuffer = "";
          }
        } else if (character === "<") {
          tagBuffer = "<";
        } else {
          output += character;
        }
      }
      return output;
    },
    flush() {
      const output = tagBuffer;
      tagBuffer = "";
      return output;
    },
  };
}

function sanitizeMarkdownText(value) {
  return String(value ?? "")
    .replace(/\u0000/gu, "")
    .replace(/<\/?[A-Za-z][^>]{0,512}>/gu, "")
    .trim()
    .slice(0, MAX_ANSWER_CHARACTERS);
}

function isHtmlTag(value) {
  return /^<\/?[A-Za-z][^>]{0,510}>$/u.test(value);
}

function safeConfigSummary(client) {
  try {
    const value = client.configSummary();
    return isPlainObject(value) ? value : {};
  } catch {
    return {};
  }
}

async function resolveProxyUserId(resolver, { req, body }) {
  if (typeof resolver !== "function") return body.user_id ?? body.userId;
  return resolver({ req, body });
}

async function readJsonBody(req, maxBytes) {
  const configuredLimit = Number.isFinite(Number(maxBytes))
    ? Math.max(1_024, Math.round(Number(maxBytes)))
    : MAX_REQUEST_BYTES;
  const declaredLength = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > configuredLimit) {
    throw requestError("agent_proxy_request_too_large", "请求内容超过安全上限", 413, false);
  }
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > configuredLimit) {
      throw requestError("agent_proxy_request_too_large", "请求内容超过安全上限", 413, false);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) throw requestError("invalid_json", "提问内容格式无效", 400, false);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isPlainObject(parsed)) throw new Error("body is not an object");
    return parsed;
  } catch {
    throw requestError("invalid_json", "提问内容格式无效", 400, false);
  }
}

function describeProxyHttpError(error) {
  const code = safeIdentifier(error?.code, "", 120);
  const definitions = {
    invalid_json: [400, "invalid_json", "提问内容格式无效", false],
    agent_proxy_content_required: [422, code, "请输入问题内容或上传图片", false],
    agent_proxy_invalid_image: [422, code, "图片数据格式无效", false],
    agent_proxy_invalid_image_type: [422, code, "图片格式不受支持", false],
    agent_proxy_image_too_large: [413, code, "图片超过大小限制", false],
    agent_proxy_images_too_large: [413, code, "图片总大小超过限制", false],
    agent_proxy_request_too_large: [413, code, "请求内容超过安全上限", false],
    agent_proxy_payload_too_large: [413, code, "Agent 代理拒绝了过大的请求", false],
    agent_proxy_endpoint_required: [503, code, "Agent 代理地址尚未配置", false],
    agent_proxy_api_key_required: [503, code, "Agent 代理 Key 尚未配置", false],
    agent_proxy_auth_failed: [502, code, "Agent 代理鉴权失败，请在设置中检查地址与 Key", false],
    agent_proxy_timeout: [504, code, "Agent 代理响应超时，请稍后重试", true],
    agent_proxy_cancelled: [499, code, "Agent 代理请求已取消", false],
    agent_proxy_rate_limited: [429, code, "Agent 代理当前繁忙，请稍后重试", true],
    agent_proxy_incomplete_stream: [502, code, "Agent 代理的回复未完成，请重试", true],
    agent_proxy_empty_answer: [502, code, "Agent 代理没有返回可展示的回答", true],
    agent_proxy_network_error: [502, code, "无法连接 Agent 代理，请稍后重试", true],
    agent_proxy_provider_error: [502, code, "Agent 代理返回错误，请稍后重试", true],
    agent_proxy_upstream_unavailable: [502, code, "Agent 代理暂时不可用，请稍后重试", true],
  };
  const definition = definitions[code] || [502, "agent_proxy_unavailable", "Agent 代理暂时不可用，请稍后重试", true];
  return {
    status: definition[0],
    code: definition[1] || "agent_proxy_unavailable",
    message: definition[2],
    retryable: definition[3],
  };
}

function requestError(code, message, status, retryable) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  return error;
}

function compactStringMap(input) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    output[key] = String(value).replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 1_000);
  }
  return output;
}

function safePublicHttpsUrl(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > 8_192) return "";
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || isPrivateHostname(parsed.hostname)) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isPrivateHostname(value) {
  const hostname = String(value || "").replace(/^\[|\]$/gu, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname.includes(":")) {
    return hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:");
  }
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return false;
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function safePlainText(value, maxLength) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function safeOpaqueId(value, maxLength) {
  const candidate = String(value ?? "").trim();
  if (!candidate || candidate.length > maxLength || /[\u0000-\u001f\u007f]/u.test(candidate)) return "";
  return candidate;
}

function safeIdentifier(value, fallback, maxLength) {
  const candidate = String(value ?? "").replace(/[^A-Za-z0-9._:-]/gu, "").slice(0, maxLength);
  return candidate || fallback;
}

function safeStage(value, fallback) {
  return safeIdentifier(value, fallback, 120);
}

function safeToken(value, maxLength) {
  return String(value ?? "").replace(/[^A-Za-z0-9._:+/-]/gu, "").slice(0, maxLength);
}

function safeFileName(value) {
  return String(value ?? "attachment")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240) || "attachment";
}

function safeIsoTime(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function normalizeTraceStatus(value) {
  const status = safeToken(value, 40).toLowerCase();
  return ["running", "success", "error", "warning", "cancelled", "info"].includes(status)
    ? status
    : "info";
}

function normalizeTraceKind(value, channel) {
  const candidate = safeToken(value, 40).toLowerCase();
  const mapped = {
    agent: "agent",
    llm: "model",
    model: "model",
    function: "tool",
    tool: "tool",
    retrieval: "retrieval",
  }[candidate];
  if (mapped) return mapped;
  if (channel === "thinking") return "model";
  if (channel === "tool") return "tool";
  if (channel === "retrieve") return "retrieval";
  return "agent";
}

function boundedNumber(value, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= maximum ? Math.round(number) : null;
}

function boundedNonNegativeNumber(value, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? Math.round(number) : null;
}

function safeOptionalIsoTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function normalizeProxyTraceAttributes(value) {
  if (!isPlainObject(value)) return {};
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 24)) {
    const key = safeToken(rawKey, 80);
    const summary = safePlainText(rawValue, 400);
    if (key && summary) output[key] = summary;
  }
  return output;
}

function cardFallbackTitle(kind) {
  return ({ summary: "Agent 内容", article: "参考资料", reference: "参考信息", image: "图片内容", video: "视频内容" })[kind]
    || "Agent 内容";
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function dedupe(values, identity, limit) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const key = identity(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function elapsedSince(startedAt) {
  return Math.max(0, Math.min(600_000, Date.now() - startedAt));
}

function beginNdjson(res, status) {
  if (res.headersSent) return;
  res.writeHead(status, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-content-type-options": "nosniff",
  });
  res.flushHeaders?.();
}

function writeNdjson(res, value) {
  if (res.destroyed || res.writableEnded) return false;
  return res.write(`${JSON.stringify(value)}\n`);
}

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
