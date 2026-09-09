const TRACE_STATUS = new Set(["running", "success", "error", "warning", "cancelled", "info"]);
const TRACE_KIND = new Set([
  "control",
  "agent",
  "retrieval",
  "model",
  "tool",
  "validation",
  "persistence",
  "projection",
  "stream",
  "lifecycle",
  "internal",
  "storage",
  "ui",
  "system"
]);
const TRACE_VIEWS = new WeakMap();
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const SPAN_LABELS = Object.freeze({
  root: "本轮学习 Agent",
  scope: "限定课程范围",
  cards: "解析知识卡片",
  agent: "Pi Agent 运行",
  model: "模型理解与生成",
  retrieval: "检索已加载教材",
  package: "校验受控教学包",
  result: "写入学习证据",
  ui: "组装回答与卡片"
});

const TOOL_LABELS = Object.freeze({
  retrieve_loaded_course_knowledge: "检索当前教材",
  search_reviewed_questions: "查找已审核题目",
  publish_grounded_teaching_package: "提交受控教学包"
});

// These names are persisted by the server as stable technical identifiers.
// Keep their presentation mapping here so the trace store remains language
// neutral while the student-facing drawer explains the fallback as one flow.
const NAMED_SPAN_PRESENTATION = Object.freeze({
  external_fallback_decision: Object.freeze({
    label: "教材未命中 → 豆包爱学补充回答",
    parentName: ""
  }),
  doubao_aixue_answer: Object.freeze({
    label: "豆包爱学补充回答",
    parentName: "external_fallback_decision"
  })
});

export function normalizeAgentTraceEvent(event, { index = 0 } = {}) {
  const source = event && typeof event === "object" ? event : {};
  const stage = safeIdentifier(source.stage, "agent.working", 120);
  const message = safeInlineText(source.message || "AI教师正在处理", 240);
  const status = normalizeTraceStatus(source.status, stage);
  const elapsedMs = safeMilliseconds(source.elapsedMs ?? source.elapsed_ms);
  const durationValue = source.durationMs ?? source.duration_ms;
  const durationMs = durationValue === undefined || durationValue === null
    ? null
    : safeMilliseconds(durationValue);
  return Object.freeze({
    id: safeIdentifier(source.id || `trace-event-${index + 1}`, `trace-event-${index + 1}`, 160),
    traceId: safeIdentifier(source.traceId ?? source.trace_id, "", 180),
    stage,
    name: safeInlineText(source.name ?? source.span_name, "", 160),
    message,
    status,
    kind: normalizeTraceKind(source.kind, stage),
    elapsedMs,
    durationMs,
    spanId: safeIdentifier(source.spanId ?? source.span_id, "", 180),
    parentSpanId: safeIdentifier(source.parentSpanId ?? source.parent_span_id, "", 180),
    startedAt: safeIsoTime(source.startedAt ?? source.started_at),
    endedAt: safeIsoTime(source.endedAt ?? source.ended_at),
    inputSummary: summarizeTraceValue(source.inputSummary ?? source.input_summary ?? source.input),
    outputSummary: summarizeTraceValue(source.outputSummary ?? source.output_summary ?? source.output),
    error: summarizeTraceError(source.error),
    attributes: normalizeTraceAttributes(source.attributes)
  });
}

export function buildAgentTraceModel(record = {}, persistedPayload = null) {
  const persisted = normalizePersistedAgentTrace(persistedPayload, record);
  if (persisted) return persisted;
  const rawTrace = Array.isArray(record.trace) ? record.trace : [];
  const events = rawTrace.map((event, index) => normalizeAgentTraceEvent(event, { index }));
  const traceId = safeIdentifier(
    record.traceId ?? record.trace_id ?? events.find((event) => event.traceId)?.traceId,
    "",
    180
  );
  const turnId = safeIdentifier(record.id, "current-turn", 180);
  const totalMs = events.reduce((maximum, event) => Math.max(maximum, event.elapsedMs), 0);
  const rootStatus = normalizeRecordStatus(record.status);
  const root = {
    id: `turn:${turnId}`,
    parentId: "",
    key: "root",
    name: SPAN_LABELS.root,
    kind: "agent",
    status: rootStatus,
    startMs: 0,
    endMs: totalMs,
    durationMs: totalMs,
    startedAt: safeIsoTime(record.startedAt ?? record.started_at),
    endedAt: safeIsoTime(record.completedAt ?? record.completed_at),
    inputSummary: summarizeTraceValue(record.userText ?? record.inputSummary),
    outputSummary: summarizeTraceValue(record.assistantText ?? record.outputSummary),
    error: rootStatus === "error" ? summarizeTraceError(record.assistantText || record.error) : "",
    attributes: {},
    messages: [],
    children: []
  };
  const grouped = new Map();

  events.forEach((event, index) => {
    const descriptor = describeTraceEvent(event, index);
    const key = event.spanId ? `explicit:${event.spanId}` : descriptor.key;
    let span = grouped.get(key);
    if (!span) {
      span = {
        id: event.spanId || `span:${turnId}:${descriptor.key}`,
        parentId: event.parentSpanId || "",
        parentKey: event.parentSpanId ? "" : descriptor.parentKey,
        key: descriptor.key,
        name: event.name || descriptor.name,
        kind: event.kind || descriptor.kind,
        status: event.status,
        startMs: event.elapsedMs,
        endMs: event.elapsedMs,
        durationMs: event.durationMs,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        inputSummary: event.inputSummary,
        outputSummary: event.outputSummary,
        error: event.error,
        attributes: { ...event.attributes },
        messages: [],
        children: [],
        order: index
      };
      grouped.set(key, span);
    }
    span.startMs = Math.min(span.startMs, event.elapsedMs);
    span.endMs = Math.max(span.endMs, event.elapsedMs);
    if (event.durationMs !== null) span.durationMs = event.durationMs;
    if (event.startedAt) span.startedAt ||= event.startedAt;
    if (event.endedAt) span.endedAt = event.endedAt;
    if (event.inputSummary) span.inputSummary ||= event.inputSummary;
    if (event.outputSummary) span.outputSummary = event.outputSummary;
    if (event.error) span.error = event.error;
    span.attributes = { ...span.attributes, ...event.attributes };
    span.status = mergeTraceStatus(span.status, event.status);
    span.messages.push({ stage: event.stage, message: event.message, elapsedMs: event.elapsedMs });
  });

  const spans = [...grouped.values()].sort((left, right) => left.order - right.order);
  const byId = new Map(spans.map((span) => [span.id, span]));
  const byKey = new Map(spans.map((span) => [span.key, span]));
  spans.forEach((span) => {
    if (span.durationMs === null && span.messages.length > 1) {
      span.durationMs = Math.max(0, span.endMs - span.startMs);
    }
    if (!span.outputSummary) span.outputSummary = span.messages.at(-1)?.message || "";
    if (rootStatus === "running" && span === spans.at(-1) && !isTerminalSpan(span)) {
      span.status = "running";
    } else if (span.status === "running" && rootStatus !== "running") {
      span.status = rootStatus === "error" ? "error" : "success";
    }
    const parent = byId.get(span.parentId) || byKey.get(span.parentKey) || root;
    span.parentId = parent.id;
    parent.children.push(span);
  });
  sortTraceChildren(root);

  return Object.freeze({
    traceId,
    turnId,
    status: rootStatus,
    totalMs,
    eventCount: events.length,
    spanCount: spans.length + 1,
    startedAt: root.startedAt,
    endedAt: root.endedAt,
    root
  });
}

export function normalizePersistedAgentTrace(payload, fallbackRecord = {}) {
  if (!payload || typeof payload !== "object") return null;
  const trace = payload.trace && typeof payload.trace === "object" ? payload.trace : payload;
  const rawSpans = Array.isArray(payload.spans)
    ? payload.spans
    : Array.isArray(trace.spans) ? trace.spans : [];
  if (!trace.id && !trace.trace_id && !rawSpans.length) return null;
  const traceId = safeIdentifier(trace.trace_id ?? trace.id ?? fallbackRecord.traceId, "", 180);
  const turnId = safeIdentifier(fallbackRecord.id, traceId || "current-turn", 180);
  const traceStartedAt = safeIsoTime(trace.started_at ?? trace.startedAt ?? fallbackRecord.startedAt);
  const traceEndedAt = safeIsoTime(trace.ended_at ?? trace.endedAt ?? fallbackRecord.completedAt);
  const rootStatus = normalizeTraceStatus(trace.status || fallbackRecord.status, "trace.completed");
  const parsedRequest = parseTraceJson(trace.request ?? trace.request_json);
  const parsedSummary = parseTraceJson(trace.summary ?? trace.summary_json);
  const totalMs = safeMilliseconds(
    trace.total_ms ?? trace.totalMs ?? differenceInMilliseconds(traceStartedAt, traceEndedAt)
  );
  const root = {
    id: `turn:${turnId}`,
    parentId: "",
    key: "root",
    name: SPAN_LABELS.root,
    kind: "agent",
    status: rootStatus,
    startMs: 0,
    endMs: totalMs,
    durationMs: totalMs,
    startedAt: traceStartedAt,
    endedAt: traceEndedAt,
    inputSummary: summarizeTraceValue(
      parsedRequest.message ?? parsedRequest.input ?? fallbackRecord.userText
    ),
    outputSummary: summarizeTraceValue(
      parsedSummary.answer ?? parsedSummary.output ?? parsedSummary.result ?? fallbackRecord.assistantText
    ),
    error: rootStatus === "error"
      ? summarizeTraceError(parsedSummary.error ?? trace.error ?? fallbackRecord.assistantText)
      : "",
    attributes: {},
    messages: [],
    children: []
  };
  const startedAtMs = traceStartedAt ? Date.parse(traceStartedAt) : NaN;
  const spans = rawSpans.map((rawSpan, index) => {
    const startedAt = safeIsoTime(rawSpan.started_at ?? rawSpan.startedAt);
    const endedAt = safeIsoTime(rawSpan.ended_at ?? rawSpan.endedAt);
    const startMs = Number.isFinite(startedAtMs) && startedAt
      ? Math.max(0, Date.parse(startedAt) - startedAtMs)
      : Math.max(0, Number(rawSpan.start_ms ?? rawSpan.startMs) || 0);
    const durationMs = rawSpan.duration_ms === null || rawSpan.durationMs === null
      ? null
      : safeMilliseconds(
        rawSpan.duration_ms ?? rawSpan.durationMs ?? differenceInMilliseconds(startedAt, endedAt)
      );
    const spanId = safeIdentifier(rawSpan.span_id ?? rawSpan.id, `persisted-span-${index + 1}`, 180);
    const technicalName = safeInlineText(rawSpan.name, 160) || `Span ${index + 1}`;
    return {
      id: spanId,
      parentId: safeIdentifier(rawSpan.parent_span_id ?? rawSpan.parentSpanId, "", 180),
      parentKey: "",
      key: `persisted:${spanId}`,
      name: displaySpanName(technicalName),
      technicalName,
      kind: normalizeTraceKind(rawSpan.kind, "agent.completed"),
      status: normalizeTraceStatus(rawSpan.status, "agent.completed"),
      startMs,
      endMs: durationMs === null ? startMs : startMs + durationMs,
      durationMs,
      startedAt,
      endedAt,
      inputSummary: summarizeTraceValue(parseTraceJson(rawSpan.input ?? rawSpan.input_json)),
      outputSummary: summarizeTraceValue(parseTraceJson(rawSpan.output ?? rawSpan.output_json)),
      error: summarizeTraceError(parseTraceJson(rawSpan.error ?? rawSpan.error_json)),
      attributes: normalizeTraceAttributes(rawSpan.attributes),
      messages: [],
      children: [],
      order: Math.max(0, Number(rawSpan.sequence) || index)
    };
  }).sort((left, right) => left.order - right.order);
  const byId = new Map(spans.map((span) => [span.id, span]));
  const byTechnicalName = new Map(
    spans.map((span) => [span.technicalName, span])
  );
  spans.forEach((span) => {
    const presentationParentName = NAMED_SPAN_PRESENTATION[span.technicalName]?.parentName || "";
    const parent = byId.get(span.parentId)
      || byTechnicalName.get(presentationParentName)
      || root;
    span.parentId = parent.id;
    parent.children.push(span);
  });
  sortTraceChildren(root);
  return Object.freeze({
    traceId,
    turnId,
    status: rootStatus,
    totalMs,
    eventCount: rawSpans.length,
    spanCount: rawSpans.length + 1,
    startedAt: traceStartedAt,
    endedAt: traceEndedAt,
    root,
    persisted: true
  });
}

export function flattenAgentTraceTree(root) {
  const output = [];
  const visit = (span, depth) => {
    output.push({ span, depth });
    (span.children || []).forEach((child) => visit(child, depth + 1));
  };
  if (root) visit(root, 0);
  return output;
}

export function syncAgentTraceView(runtime) {
  const assistantElement = runtime?.assistantElement;
  const record = runtime?.record;
  if (!assistantElement || !record) return null;
  assistantElement.querySelectorAll("[data-agent-turn-trace]").forEach((node) => node.remove());
  const toolbar = assistantElement.querySelector(".teacher-turn-actions");
  if (!toolbar) return null;
  const doc = assistantElement.ownerDocument || globalThis.document;
  const controller = getTraceViewController(doc);
  let trigger = toolbar.querySelector("[data-agent-trace-trigger]");
  if (!trigger) {
    trigger = createTraceTrigger(doc);
    toolbar.append(trigger);
    trigger.addEventListener("click", () => controller.open(record, assistantElement, trigger));
  }
  const model = buildAgentTraceModel(record);
  trigger.dataset.traceStatus = model.status;
  trigger.setAttribute("aria-label", `执行轨迹，${formatTraceStatus(model.status)}，${model.eventCount} 个事件`);
  trigger.title = `执行轨迹 · ${model.eventCount} 个事件 · ${formatDuration(model.totalMs)}`;
  controller.refresh(record, assistantElement);
  return model;
}

function getTraceViewController(doc) {
  if (!TRACE_VIEWS.has(doc)) TRACE_VIEWS.set(doc, createTraceViewController(doc));
  return TRACE_VIEWS.get(doc);
}

function createTraceViewController(doc) {
  const dialog = doc.createElement("dialog");
  dialog.id = "agentTraceDrawer";
  dialog.className = "agent-trace-drawer";
  dialog.setAttribute("aria-labelledby", "agentTraceDrawerTitle");
  const shell = doc.createElement("section");
  shell.className = "agent-trace-drawer-shell";
  const head = doc.createElement("header");
  head.className = "agent-trace-drawer-head";
  const heading = doc.createElement("div");
  const mark = doc.createElement("span");
  mark.className = "agent-trace-drawer-mark";
  mark.append(createWorkflowIcon(doc));
  const copy = doc.createElement("span");
  const eyebrow = doc.createElement("small");
  const title = doc.createElement("h2");
  eyebrow.textContent = "AGENT TRACE";
  title.id = "agentTraceDrawerTitle";
  title.textContent = "执行轨迹";
  copy.append(eyebrow, title);
  heading.append(mark, copy);
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "agent-trace-drawer-close";
  close.setAttribute("aria-label", "关闭执行轨迹");
  close.append(createCloseIcon(doc));
  head.append(heading, close);
  const body = doc.createElement("div");
  body.className = "agent-trace-drawer-body";
  shell.append(head, body);
  dialog.append(shell);
  doc.body.append(dialog);

  let activeRecord = null;
  let activeElement = null;
  let activeTrigger = null;
  let activePersistedTrace = null;
  let loadState = { status: "idle", message: "" };
  let requestSequence = 0;
  const render = () => {
    if (!activeRecord) return;
    renderTraceDrawerBody(
      doc,
      body,
      buildAgentTraceModel(activeRecord, activePersistedTrace),
      loadState
    );
  };
  const closeDrawer = () => {
    if (dialog.open) dialog.close();
  };
  close.addEventListener("click", closeDrawer);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDrawer();
  });
  dialog.addEventListener("close", () => {
    activeTrigger?.setAttribute("aria-expanded", "false");
    activeTrigger?.classList.remove("is-active");
    activeTrigger?.focus?.();
    activeRecord = null;
    activeElement = null;
    activeTrigger = null;
    activePersistedTrace = null;
    requestSequence += 1;
  });

  return {
    open(record, element, trigger) {
      activeTrigger?.setAttribute("aria-expanded", "false");
      activeTrigger?.classList.remove("is-active");
      activeRecord = record;
      activeElement = element;
      activeTrigger = trigger;
      activePersistedTrace = null;
      loadState = { status: "idle", message: "" };
      trigger.setAttribute("aria-expanded", "true");
      trigger.classList.add("is-active");
      render();
      if (!dialog.open) dialog.showModal();
      close.focus();
      const traceId = buildAgentTraceModel(record).traceId;
      if (traceId) {
        const currentRequest = ++requestSequence;
        loadState = { status: "loading", message: "正在读取完整 Span 记录" };
        render();
        void loadPersistedAgentTrace(record, traceId)
          .then((payload) => {
            if (currentRequest !== requestSequence || activeRecord !== record) return;
            activePersistedTrace = payload;
            loadState = { status: "success", message: "已加载服务端持久化 Trace" };
            render();
          })
          .catch((error) => {
            if (currentRequest !== requestSequence || activeRecord !== record) return;
            loadState = {
              status: "warning",
              message: error?.message || "完整 Span 尚未写入，当前展示流式事件"
            };
            render();
          });
      }
    },
    refresh(record, element) {
      if (!dialog.open || activeRecord !== record || activeElement !== element) return;
      render();
    }
  };
}

function renderTraceDrawerBody(doc, body, model, loadState = { status: "idle", message: "" }) {
  const fragment = doc.createDocumentFragment();
  fragment.append(createTraceOverview(doc, model));
  if (loadState.status !== "idle") fragment.append(createTraceLoadNotice(doc, loadState));
  if (model.root.error) fragment.append(createTraceError(doc, model.root.error));
  fragment.append(createTraceIoSummary(doc, model.root));
  const flatSpans = flattenAgentTraceTree(model.root);
  fragment.append(createTraceWaterfall(doc, model, flatSpans));
  fragment.append(createTraceTree(doc, flatSpans));
  body.replaceChildren(fragment);
}

function createTraceLoadNotice(doc, state) {
  const notice = doc.createElement("p");
  notice.className = "agent-trace-load-state";
  notice.dataset.status = state.status;
  notice.setAttribute("role", state.status === "warning" ? "status" : "status");
  const marker = doc.createElement("i");
  marker.setAttribute("aria-hidden", "true");
  const message = doc.createElement("span");
  message.textContent = state.message;
  notice.append(marker, message);
  return notice;
}

function createTraceOverview(doc, model) {
  const section = doc.createElement("section");
  section.className = "agent-trace-overview";
  const status = doc.createElement("span");
  status.className = "agent-trace-status";
  status.dataset.status = model.status;
  status.textContent = formatTraceStatus(model.status);
  const metrics = doc.createElement("dl");
  [
    ["总耗时", formatDuration(model.totalMs)],
    ["Span", String(model.spanCount)],
    ["事件", String(model.eventCount)]
  ].forEach(([label, value]) => {
    const metric = doc.createElement("div");
    const term = doc.createElement("dt");
    const description = doc.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    metric.append(term, description);
    metrics.append(metric);
  });
  const identity = doc.createElement("p");
  const identityLabel = doc.createElement("span");
  const identityValue = doc.createElement("code");
  identityLabel.textContent = "Trace ID";
  identityValue.textContent = model.traceId || "当前流未返回 Trace ID";
  identity.append(identityLabel, identityValue);
  section.append(status, metrics, identity);
  return section;
}

function createTraceError(doc, message) {
  const alert = doc.createElement("section");
  alert.className = "agent-trace-error";
  alert.setAttribute("role", "alert");
  const title = doc.createElement("b");
  const copy = doc.createElement("p");
  title.textContent = "执行失败";
  copy.textContent = message;
  alert.append(title, copy);
  return alert;
}

function createTraceIoSummary(doc, root) {
  const section = doc.createElement("section");
  section.className = "agent-trace-io";
  section.setAttribute("aria-label", "本轮输入输出摘要");
  section.append(
    createTraceCopyCard(doc, "输入摘要", root.inputSummary || "未记录输入摘要"),
    createTraceCopyCard(doc, "输出摘要", root.outputSummary || "回答尚未完成")
  );
  return section;
}

function createTraceCopyCard(doc, label, value) {
  const article = doc.createElement("article");
  const title = doc.createElement("b");
  const copy = doc.createElement("p");
  title.textContent = label;
  copy.textContent = value;
  article.append(title, copy);
  return article;
}

function createTraceWaterfall(doc, model, flatSpans) {
  const section = doc.createElement("section");
  section.className = "agent-trace-section agent-trace-waterfall";
  const title = doc.createElement("h3");
  title.textContent = "时间线";
  const list = doc.createElement("div");
  list.className = "agent-trace-waterfall-list";
  const total = Math.max(1, model.totalMs);
  const timelineSpans = flatSpans.slice(1).sort((left, right) => {
    return left.span.startMs - right.span.startMs || left.depth - right.depth;
  });
  timelineSpans.forEach(({ span, depth }) => {
    const row = doc.createElement("div");
    row.className = "agent-trace-waterfall-row";
    row.style.setProperty("--trace-depth", String(Math.max(0, depth - 1)));
    const label = doc.createElement("span");
    label.textContent = span.name;
    const track = doc.createElement("div");
    const bar = doc.createElement("i");
    const start = Math.max(0, Math.min(100, (span.startMs / total) * 100));
    const effectiveEnd = span.durationMs === null
      ? span.startMs + Math.max(8, total * 0.018)
      : span.startMs + span.durationMs;
    const width = Math.max(1.5, Math.min(100 - start, ((effectiveEnd - span.startMs) / total) * 100));
    bar.dataset.status = span.status;
    bar.style.setProperty("--trace-start", `${start}%`);
    bar.style.setProperty("--trace-width", `${width}%`);
    track.append(bar);
    const time = doc.createElement("small");
    time.textContent = `+${formatDuration(span.startMs)}`;
    row.append(label, track, time);
    list.append(row);
  });
  if (!timelineSpans.length) {
    const empty = doc.createElement("p");
    empty.className = "agent-trace-empty";
    empty.textContent = "等待第一个执行事件";
    list.append(empty);
  }
  section.append(title, list);
  return section;
}

function createTraceTree(doc, flatSpans) {
  const section = doc.createElement("section");
  section.className = "agent-trace-section agent-trace-tree";
  const title = doc.createElement("h3");
  title.textContent = "Span 树";
  const list = doc.createElement("div");
  list.className = "agent-trace-tree-list";
  flatSpans.forEach(({ span, depth }) => list.append(createTraceSpan(doc, span, depth)));
  section.append(title, list);
  return section;
}

function createTraceSpan(doc, span, depth) {
  const details = doc.createElement("details");
  details.className = "agent-trace-span";
  details.dataset.status = span.status;
  details.style.setProperty("--trace-depth", String(depth));
  details.open = depth === 0 || span.status === "error" || span.status === "running";
  const summary = doc.createElement("summary");
  const marker = doc.createElement("i");
  marker.className = "agent-trace-span-marker";
  const copy = doc.createElement("span");
  const name = doc.createElement("b");
  const meta = doc.createElement("small");
  name.textContent = span.name;
  meta.textContent = `${formatTraceKind(span.kind)} · ${formatTraceStatus(span.status)}`;
  copy.append(name, meta);
  const duration = doc.createElement("time");
  duration.textContent = span.durationMs === null ? `+${formatDuration(span.startMs)}` : formatDuration(span.durationMs);
  summary.append(marker, copy, duration);
  const body = doc.createElement("div");
  body.className = "agent-trace-span-body";
  const facts = doc.createElement("dl");
  [
    ["Span ID", span.id],
    ["父 Span", span.parentId || "根节点"],
    ["开始", span.startedAt || `+${formatDuration(span.startMs)}`],
    ["结束", span.endedAt || (span.status === "running"
      ? "运行中"
      : span.durationMs === null ? "未提供" : `+${formatDuration(span.endMs)}`)]
  ].forEach(([term, description]) => {
    const item = doc.createElement("div");
    const dt = doc.createElement("dt");
    const dd = doc.createElement("dd");
    dt.textContent = term;
    dd.textContent = description;
    item.append(dt, dd);
    facts.append(item);
  });
  body.append(facts);
  if (span.inputSummary) body.append(createTraceCopyCard(doc, "输入", span.inputSummary));
  if (span.outputSummary) body.append(createTraceCopyCard(doc, "输出", span.outputSummary));
  if (span.error) body.append(createTraceCopyCard(doc, "错误", span.error));
  if (span.messages.length > 1) {
    const events = doc.createElement("ol");
    events.className = "agent-trace-span-events";
    span.messages.forEach((event) => {
      const item = doc.createElement("li");
      const message = doc.createElement("span");
      const time = doc.createElement("time");
      message.textContent = event.message;
      time.textContent = `+${formatDuration(event.elapsedMs)}`;
      item.append(message, time);
      events.append(item);
    });
    body.append(events);
  }
  details.append(summary, body);
  return details;
}

function createTraceTrigger(doc) {
  const button = doc.createElement("button");
  button.type = "button";
  button.dataset.agentTraceTrigger = "";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", "agentTraceDrawer");
  button.setAttribute("aria-expanded", "false");
  button.append(createWorkflowIcon(doc));
  const indicator = doc.createElement("span");
  indicator.className = "agent-trace-trigger-indicator";
  indicator.setAttribute("aria-hidden", "true");
  button.append(indicator);
  return button;
}

function createWorkflowIcon(doc) {
  const svg = doc.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const nodes = [[12, 5], [5, 18], [19, 18]].map(([cx, cy]) => {
    const circle = doc.createElementNS(SVG_NAMESPACE, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", "2.1");
    return circle;
  });
  const path = doc.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", "M11 6.8 6.2 16.2M13 6.8l4.8 9.4M7.2 18h9.6");
  svg.append(...nodes, path);
  return svg;
}

function createCloseIcon(doc) {
  const svg = doc.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", "m6 6 12 12M18 6 6 18");
  svg.append(path);
  return svg;
}

function describeTraceEvent(event, index) {
  const stage = event.stage;
  const namedSpan = NAMED_SPAN_PRESENTATION[event.name];
  if (namedSpan) {
    return {
      key: `named:${event.name}`,
      parentKey: namedSpan.parentName ? `named:${namedSpan.parentName}` : "root",
      name: namedSpan.label,
      kind: event.kind || (event.name === "doubao_aixue_answer" ? "tool" : "control")
    };
  }
  const toolMatch = stage.match(/^tool\.([a-zA-Z0-9_-]+)\.(?:started|completed)$/u);
  if (toolMatch) {
    const tool = toolMatch[1];
    return { key: `tool:${tool}`, parentKey: "agent", name: TOOL_LABELS[tool] || tool, kind: "tool" };
  }
  const family = stage.split(".")[0];
  const definitions = {
    scope: { parentKey: "root", name: SPAN_LABELS.scope, kind: "system" },
    cards: { parentKey: "root", name: SPAN_LABELS.cards, kind: "system" },
    agent: { parentKey: "root", name: SPAN_LABELS.agent, kind: "agent" },
    model: { parentKey: "agent", name: SPAN_LABELS.model, kind: "model" },
    retrieval: { parentKey: "tool:retrieve_loaded_course_knowledge", name: SPAN_LABELS.retrieval, kind: "retrieval" },
    package: { parentKey: "tool:publish_grounded_teaching_package", name: SPAN_LABELS.package, kind: "validation" },
    result: { parentKey: "root", name: SPAN_LABELS.result, kind: "storage" },
    ui: { parentKey: "root", name: SPAN_LABELS.ui, kind: "ui" }
  };
  const definition = definitions[family];
  if (definition) return { key: family, ...definition };
  return {
    key: `event:${stage}:${index}`,
    parentKey: "root",
    name: event.name || event.message || stage,
    kind: event.kind || "system"
  };
}

function displaySpanName(value) {
  const technicalName = safeInlineText(value, 160);
  return NAMED_SPAN_PRESENTATION[technicalName]?.label || technicalName;
}

function normalizeTraceStatus(value, stage) {
  const explicit = String(value || "").toLowerCase();
  if (["completed", "complete", "ok", "succeeded", "passed"].includes(explicit)) return "success";
  if (["failed", "failure"].includes(explicit)) return "error";
  if (["canceled", "aborted"].includes(explicit)) return "cancelled";
  if (TRACE_STATUS.has(explicit)) return explicit;
  if (/(?:failed|failure|error)$/u.test(stage)) return "error";
  if (/(?:no_match|warning)$/u.test(stage)) return "warning";
  if (/(?:cancelled|canceled)$/u.test(stage)) return "cancelled";
  if (/(?:started|requested|reasoning|streaming|resolving|working)$/u.test(stage)) return "running";
  return "success";
}

function normalizeRecordStatus(value) {
  const status = String(value || "pending").toLowerCase();
  if (status === "completed") return "success";
  if (status === "error") return "error";
  if (status === "canceled" || status === "cancelled") return "cancelled";
  return "running";
}

function normalizeTraceKind(value, stage) {
  const explicit = String(value || "").toLowerCase();
  if (TRACE_KIND.has(explicit)) return explicit;
  return describeTraceEvent({ stage, name: "", message: "", kind: "" }, 0).kind;
}

function mergeTraceStatus(current, next) {
  if (current === "error" || next === "error") return "error";
  if (current === "warning" || next === "warning") return "warning";
  if (current === "cancelled" || next === "cancelled") return "cancelled";
  if (next === "success") return "success";
  if (current === "success") return "success";
  return next || current || "info";
}

function isTerminalSpan(span) {
  const stage = span.messages.at(-1)?.stage || "";
  return /(?:completed|resolved|validated|no_match|failed|error)$/u.test(stage);
}

function sortTraceChildren(span) {
  span.children.sort((left, right) => left.startMs - right.startMs || left.order - right.order);
  span.children.forEach(sortTraceChildren);
}

function normalizeTraceAttributes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 16).map(([key, item]) => [
    safeIdentifier(key, "attribute", 80),
    summarizeTraceValue(item, 240)
  ]));
}

function summarizeTraceValue(value, maximum = 800) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) return "";
  let text;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return safeInlineText(text, maximum);
}

function summarizeTraceError(value) {
  if (!value) return "";
  if (typeof value === "string") return safeInlineText(value, 800);
  return safeInlineText(value.message || value.code || summarizeTraceValue(value), 800);
}

function safeIdentifier(value, fallback = "", maximum = 180) {
  const result = String(value || "").trim().replace(/[^a-zA-Z0-9._:@/-]/gu, "").slice(0, maximum);
  return result || fallback;
}

function safeInlineText(value, maximum = 800) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function safeMilliseconds(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, Math.min(600_000, Math.round(result))) : 0;
}

function safeIsoTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function loadPersistedAgentTrace(record, traceId) {
  const query = new URLSearchParams();
  const userId = safeIdentifier(record.requestUserId ?? record.userId, "", 180);
  const sessionId = safeIdentifier(record.requestSessionId ?? record.sessionId, "", 180);
  if (userId) query.set("user_id", userId);
  if (sessionId) {
    query.set("session_id", sessionId);
    query.set("conversation_id", sessionId);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await fetch(
    `/api/education/agent/traces/${encodeURIComponent(traceId)}${suffix}`,
    { headers: { accept: "application/json" } }
  );
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(safeInlineText(payload?.message, 240) || "完整 Span 尚未写入，当前展示流式事件");
  }
  if (!normalizePersistedAgentTrace(payload, record)) {
    throw new Error("Trace 详情协议不完整，当前展示流式事件");
  }
  return payload;
}

function parseTraceJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : { value: parsed };
  } catch {
    return { value: String(value) };
  }
}

function differenceInMilliseconds(startedAt, endedAt) {
  if (!startedAt || !endedAt) return 0;
  const result = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

function formatDuration(value) {
  const milliseconds = safeMilliseconds(value);
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function formatTraceStatus(status) {
  return ({ running: "运行中", success: "已完成", error: "失败", warning: "需注意", cancelled: "已取消", info: "信息" })[status] || "信息";
}

function formatTraceKind(kind) {
  return ({
    control: "控制",
    agent: "Agent",
    retrieval: "检索",
    model: "模型",
    tool: "工具",
    validation: "校验",
    persistence: "持久化",
    projection: "投影",
    stream: "流式输出",
    lifecycle: "生命周期",
    internal: "内部",
    storage: "存储",
    ui: "界面",
    system: "系统"
  })[kind] || "系统";
}
