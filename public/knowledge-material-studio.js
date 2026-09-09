import { mountKnowledgeSpatialViewer } from "./knowledge-spatial-viewer.js";

const TECHNIQUES = Object.freeze([
  {
    key: "deeptutor",
    name: "知识结构",
    technology: "DeepTutor",
    subtitle: "Book · Spine · Page · Block",
    icon: "network",
    empty: "运行 DeepTutor Book Engine，生成原生书籍、章节脊柱、页面与内容块。",
    note: "直接运行 DeepTutor 官方 Book Engine（Apache-2.0），保留 Book / Spine / Page / Block 原生结构；该官方流水线需要模型。",
    loading: "正在运行 DeepTutor 官方 Book Engine",
    native: true,
    license: "Apache-2.0"
  },
  {
    key: "koji",
    name: "渐进辅导",
    technology: "Koji-style",
    subtitle: "学习状态 · 分层提示 · 画面引导",
    icon: "route",
    empty: "根据学习状态逐层给提示，不直接泄露答案。",
    note: "使用本项目自研的确定性渐进辅导状态机；Koji 无可用开源源码，因此明确标注为 Koji-style。",
    loading: "正在构建 Koji-style 状态机"
  },
  {
    key: "openmaic",
    name: "互动课堂",
    technology: "OpenMAIC",
    subtitle: "Stage · Scene · Action",
    icon: "panels-top-left",
    empty: "运行 OpenMAIC Generation Pipeline，生成可播放的原生课堂舞台与场景。",
    note: "直接运行 OpenMAIC 官方 Generation Pipeline（MIT），保留 Stage / Scene / Action 与 Slide Canvas 原生结构；该官方流水线需要模型。",
    loading: "正在运行 OpenMAIC 官方生成流水线",
    native: true,
    license: "MIT"
  },
  {
    key: "cell_studio",
    name: "空间探索",
    technology: "Cell Studio",
    subtitle: "3D 结构 · 语义热点 · 聚焦观察",
    icon: "box",
    empty: "支持官方七类细胞标本主题；不把任意文本伪造成细胞模型。",
    note: "使用 Cell Architecture Studio 的细胞数据模型和程序几何逻辑，仅接受受支持的细胞主题。",
    loading: "正在构建 Cell Studio 细胞场景"
  }
]);

const TECHNIQUE_BY_KEY = new Map(
  TECHNIQUES.map((technique) => [technique.key, technique])
);

const TRIGGER_LABELS = Object.freeze({
  start: "开始",
  hesitation: "犹豫",
  incorrect: "答错",
  hint_request: "求助",
  progress: "进展",
  success: "掌握"
});

const ACTION_LABELS = Object.freeze({
  spotlight: "聚焦",
  laser: "激光笔",
  speech: "讲解",
  play_video: "播放视频",
  discussion: "讨论",
  wb_open: "打开白板",
  wb_close: "关闭白板",
  wb_clear: "清空白板",
  wb_draw_text: "白板文字",
  wb_draw_shape: "白板图形",
  wb_draw_chart: "白板图表",
  wb_draw_latex: "白板公式",
  wb_draw_table: "白板表格",
  wb_draw_line: "白板连线",
  wb_draw_code: "白板代码",
  wb_edit_code: "编辑代码",
  reveal: "揭示",
  annotate: "批注",
  set_state: "改变状态",
  widget_reveal: "组件揭示",
  widget_annotation: "组件批注",
  widget_highlight: "组件聚焦",
  widget_setState: "组件状态"
});

let materialDomIdSequence = 0;

const MATERIAL_TRACE_LIMITS = Object.freeze({
  maxEvents: 300,
  maxOutputPerCall: 120_000,
  maxTotalOutput: 360_000,
  maxCalls: 24,
  maxNdjsonLine: 16 * 1024 * 1024,
  maxWireMessages: 10_000
});

const MATERIAL_TRACE_STATUS = new Set([
  "pending",
  "running",
  "streaming",
  "retrying",
  "fallback",
  "warning",
  "info",
  "success",
  "completed",
  "error",
  "failed",
  "cancelled"
]);

export function normalizeOpenMaicTimelineAction(action = {}) {
  const local =
    action && typeof action === "object" && !Array.isArray(action)
      ? action
      : {};
  const dsl =
    local.dsl_action &&
    typeof local.dsl_action === "object" &&
    !Array.isArray(local.dsl_action)
      ? local.dsl_action
      : null;
  let type = local.type;
  let targetId = local.target_id;
  let narration = local.narration;
  let state = local.state;

  if (dsl?.type === "spotlight") {
    type = "spotlight";
    targetId = dsl.elementId;
  } else if (dsl?.type === "widget_reveal") {
    type = "reveal";
    targetId = dsl.target;
    narration = dsl.content || narration;
  } else if (dsl?.type === "widget_annotation") {
    type = "annotate";
    targetId = dsl.target;
    narration = dsl.content || narration;
  } else if (dsl?.type === "widget_setState") {
    type = "set_state";
    // OpenMAIC's compact widget_setState action does not carry a target.
    // The locally validated projection retains target_id for scene lookup.
    targetId = dsl.target || targetId;
    narration = dsl.content || narration;
    state = dsl.state ?? state;
  }

  return {
    ...local,
    type,
    target_id: targetId,
    narration,
    ...(state !== undefined ? { state } : {})
  };
}

export function initKnowledgeMaterialStudio(options = {}) {
  const root =
    options.root ||
    document.querySelector("#knowledgeMaterialsWorkspace");
  if (!root || root.dataset.materialStudioReady === "true") return null;

  const source = root.querySelector("#materialSourceText");
  const generateButton = root.querySelector("#materialGenerateBtn");
  const charCount = root.querySelector("#materialCharCount");
  const status = root.querySelector("#materialGenerationStatus");
  const grid = root.querySelector("#materialTechniqueGrid");
  const providerStatus = root.querySelector("#materialProviderStatus");
  const providerDialog = root.querySelector("#materialProviderDialog");
  const providerForm = root.querySelector("#materialProviderForm");
  const providerApiKey = root.querySelector("#materialProviderApiKey");
  const providerCancel = root.querySelector("#materialProviderCancel");
  const providerSave = root.querySelector("#materialProviderSave");
  const providerError = root.querySelector("#materialProviderError");
  const techniqueInputs = [
    ...root.querySelectorAll('input[name="materialTechnique"]')
  ];
  const techniqueNote = root.querySelector("#materialTechniqueNote");
  const resultsTitle = root.querySelector("#materialResultsTitle");
  const resultsDescription = root.querySelector(
    "#materialResultsDescription"
  );
  const tracePanel = root.querySelector("#materialTracePanel");
  const traceHeadline = root.querySelector("#materialTraceHeadline");
  const traceCount = root.querySelector("#materialTraceCount");
  const traceElapsed = root.querySelector("#materialTraceElapsed");
  const traceSteps = root.querySelector("#materialTraceSteps");
  const traceOutputs = root.querySelector("#materialTraceOutputs");
  const traceCopy = root.querySelector("#materialTraceCopy");
  const traceLive = root.querySelector("#materialTraceLive");
  const sampleButtons = [...root.querySelectorAll("[data-material-sample]")];

  if (
    !source ||
    !generateButton ||
    !charCount ||
    !status ||
    !grid ||
    !techniqueNote ||
    !resultsTitle ||
    !resultsDescription ||
    techniqueInputs.length === 0
  ) {
    return null;
  }

  root.dataset.materialStudioReady = "true";
  grid.removeAttribute("aria-live");
  const initiallySelectedTechnique =
    techniqueInputs.find((input) => input.checked)?.value || "deeptutor";
  const state = {
    busy: false,
    bundle: null,
    abortController: null,
    renderDisposers: [],
    materialInteraction: null,
    selectedTechnique: TECHNIQUE_BY_KEY.has(initiallySelectedTechnique)
      ? initiallySelectedTechnique
      : "deeptutor"
  };
  const traceController = createMaterialTraceController({
    panel: tracePanel,
    headline: traceHeadline,
    count: traceCount,
    elapsed: traceElapsed,
    steps: traceSteps,
    outputs: traceOutputs,
    copyButton: traceCopy,
    live: traceLive
  });
  const providerConfigController = initMaterialProviderConfig({
    trigger: providerStatus,
    dialog: providerDialog,
    form: providerForm,
    apiKeyInput: providerApiKey,
    cancelButton: providerCancel,
    saveButton: providerSave,
    errorTarget: providerError,
    generationStatus: status
  });

  const disposeRenderedExperiences = () => {
    state.materialInteraction?.destroy?.();
    state.materialInteraction = null;
    state.renderDisposers.splice(0).forEach((dispose) => {
      try {
        dispose?.();
      } catch {
        // Rendering cleanup must not block the next generation.
      }
    });
  };

  const updateCount = () => {
    charCount.textContent = `${source.value.length} / ${source.maxLength || 4000}`;
  };

  const selectedTechnique = () =>
    TECHNIQUE_BY_KEY.get(state.selectedTechnique) || TECHNIQUES[0];

  const renderGenerateButton = (technique = selectedTechnique()) => {
    const shortcut = element("kbd", "", "⌘ ↵");
    generateButton.replaceChildren(
      icon("play"),
      element("span", "", `使用 ${technique.technology} 生成`),
      shortcut
    );
    refreshIcons();
  };

  const updateTechniqueSelection = ({ announce = true } = {}) => {
    const nextKey =
      techniqueInputs.find((input) => input.checked)?.value || "deeptutor";
    state.selectedTechnique = TECHNIQUE_BY_KEY.has(nextKey)
      ? nextKey
      : "deeptutor";
    const technique = selectedTechnique();
    disposeRenderedExperiences();
    state.bundle = null;
    traceController.reset();
    techniqueNote.textContent = technique.note;
    resultsTitle.textContent = `${technique.technology} · ${technique.name}`;
    resultsDescription.textContent =
      technique.native
        ? "本次只运行当前官方源码流水线，并直接展示其原生程序结果。"
        : "本次只执行当前选中的一种技术，并输出兼容 A2UI 的单一素材包。";
    renderGenerateButton(technique);
    renderEmptyCards(grid, technique);
    if (announce) {
      setStatus(
        status,
        "idle",
        `已选择 ${technique.technology}，不会并行生成其他技术`
      );
    }
  };

  const generate = async () => {
    if (state.busy) return null;
    const technique = selectedTechnique();
    const sourceText = source.value.trim();
    if (sourceText.length < 20) {
      traceController.start({
        technique: technique.key,
        technology: technique.technology,
        inputLength: sourceText.length
      });
      traceController.recordClientEvent({
        stage: "client.validation",
        status: "error",
        title: "输入校验未通过",
        message: "请输入至少 20 个字符的完整知识内容"
      });
      traceController.fail("请输入至少 20 个字符的完整知识内容");
      setStatus(status, "error", "请输入至少 20 个字符的完整知识内容");
      source.focus();
      return null;
    }

    state.abortController?.abort();
    state.abortController = new AbortController();
    traceController.start({
      technique: technique.key,
      technology: technique.technology,
      inputLength: sourceText.length
    });
    traceController.recordClientEvent({
      stage: "client.validation",
      status: "success",
      title: "输入校验完成",
      message: `${sourceText.length} 个字符 · ${technique.technology}`
    });
    state.busy = true;
    generateButton.disabled = true;
    techniqueInputs.forEach((input) => {
      input.disabled = true;
    });
    replaceButtonLabel(generateButton, `${technique.technology} 生成中`);
    setStatus(status, "loading", `${technique.loading}…`);
    disposeRenderedExperiences();
    renderLoadingCards(grid, technique);

    try {
      traceController.recordClientEvent({
        stage: "client.request",
        status: "running",
        title: "连接本机生成服务",
        message: "等待 NDJSON Trace 流"
      });
      const response = await fetch("/api/knowledge/materials/generate/trace", {
        method: "POST",
        headers: {
          accept: "application/x-ndjson",
          "content-type": "application/json"
        },
        signal: state.abortController.signal,
        body: JSON.stringify({
          source_text: sourceText,
          title: buildTitle(sourceText),
          language: "zh-CN",
          technique: technique.key,
          model_policy: technique.native
            ? "upstream_required"
            : "source_first"
        })
      });
      traceController.recordClientEvent({
        stage: "client.request",
        status: "success",
        title: "Trace 流已连接",
        message: `HTTP ${response.status}`
      });
      const terminal = await readKnowledgeMaterialTraceStream(response, {
        signal: state.abortController.signal,
        onTrace(event) {
          traceController.ingest(event);
        }
      });
      if (!terminal) {
        throw createMaterialTraceTerminalError(
          {
            type: "error",
            status: response.status,
            error: "trace_ended_without_terminal",
            message: "生成 Trace 已结束，但未返回最终结果"
          },
          response.status
        );
      }
      if (terminal.type === "error" || !response.ok) {
        throw createMaterialTraceTerminalError(terminal, response.status);
      }
      if (terminal.type !== "result") {
        throw createMaterialTraceTerminalError(
          {
            type: "error",
            status: response.status,
            error: "invalid_trace_terminal",
            message: "生成 Trace 返回了无法识别的终态"
          },
          response.status
        );
      }

      const bundle =
        terminal.public_bundle ||
        terminal.material_bundle ||
        terminal.bundle;
      if (!bundle || typeof bundle !== "object") {
        throw new Error("源码生成服务未返回有效素材包");
      }

      state.bundle = bundle;
      traceController.recordClientEvent({
        stage: "client.render",
        status: "running",
        title: "渲染原生结果",
        message: bundle.execution?.native_schema || technique.name
      });
      state.materialInteraction = renderBundle(grid, bundle, {
        root,
        techniqueKey: technique.key,
        registerDisposer(dispose) {
          if (typeof dispose === "function") state.renderDisposers.push(dispose);
        }
      });
      traceController.recordClientEvent({
        stage: "client.render",
        status: "success",
        title: "原生结果已渲染",
        message: `${technique.technology} · ${
          bundle.topic?.title || "知识点素材"
        }`
      });
      traceController.complete(bundle, terminal.provider);
      setStatus(
        status,
        "success",
        `${technique.technology} 源码产物已生成 · ${
          bundle.topic?.title || "知识点素材"
        }`
      );
      root.dispatchEvent(
        new CustomEvent("knowledge-material:generated", {
          bubbles: true,
          detail: technique.native
            ? {
                bundle,
                source_result: bundle.source_result || null
              }
            : {
                bundle,
                card_materials: bundle.card_materials || [],
                a2ui: bundle.a2ui ?? null
              }
        })
      );
      return bundle;
    } catch (error) {
      if (error?.name === "AbortError") {
        traceController.cancel();
        return null;
      }
      traceController.fail(
        error?.message || "源码适配器生成失败",
        {
          code: error?.code,
          stage: error?.stage,
          status: error?.status
        }
      );
      disposeRenderedExperiences();
      renderEmptyCards(
        grid,
        technique,
        error?.message || "当前源码适配器生成失败，请检查输入后重试。"
      );
      setStatus(status, "error", error?.message || "源码适配器生成失败");
      return null;
    } finally {
      state.busy = false;
      generateButton.disabled = false;
      techniqueInputs.forEach((input) => {
        input.disabled = false;
      });
      renderGenerateButton(technique);
    }
  };

  source.addEventListener("input", updateCount);
  source.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void generate();
    }
  });
  generateButton.addEventListener("click", () => void generate());
  techniqueInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked && !state.busy) updateTechniqueSelection();
    });
  });
  sampleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      source.value = button.dataset.materialSample || "";
      updateCount();
      source.focus();
      setStatus(status, "idle", "示例已填入，可使用当前选中技术生成");
    });
  });

  root.addEventListener("material-focus-target", (event) => {
    if (state.materialInteraction) {
      state.materialInteraction.focusTarget(event.detail?.targetId);
    } else {
      focusMaterialTarget(root, event.detail?.targetId);
    }
  });

  updateCount();
  updateTechniqueSelection({ announce: false });
  refreshIcons();
  void loadProviderStatus(providerStatus, status);

  return {
    generate,
    getBundle: () => state.bundle,
    destroy() {
      state.abortController?.abort();
      providerConfigController?.destroy?.();
      traceController.destroy();
      disposeRenderedExperiences();
      delete root.dataset.materialStudioReady;
    }
  };
}

function initMaterialProviderConfig({
  trigger,
  dialog,
  form,
  apiKeyInput,
  cancelButton,
  saveButton,
  errorTarget,
  generationStatus
}) {
  if (
    !trigger ||
    !dialog ||
    !form ||
    !apiKeyInput ||
    !cancelButton ||
    !saveButton ||
    !errorTarget
  ) {
    return null;
  }

  let busy = false;
  let requestController = null;
  let returnFocus = null;
  const saveLabel = saveButton.querySelector("span");

  const clearError = () => {
    errorTarget.hidden = true;
    errorTarget.textContent = "";
    apiKeyInput.removeAttribute("aria-invalid");
  };

  const showError = (message) => {
    errorTarget.textContent = message;
    errorTarget.hidden = false;
    apiKeyInput.setAttribute("aria-invalid", "true");
  };

  const setBusy = (nextBusy) => {
    busy = nextBusy;
    apiKeyInput.disabled = nextBusy;
    cancelButton.disabled = false;
    saveButton.disabled = nextBusy;
    dialog.setAttribute("aria-busy", String(nextBusy));
    if (saveLabel) saveLabel.textContent = nextBusy ? "正在连接" : "保存并连接";
  };

  const closeDialog = (returnValue = "") => {
    if (typeof dialog.close === "function") {
      dialog.close(returnValue);
    } else {
      dialog.removeAttribute("open");
      handleDialogClose();
    }
  };

  const openDialog = () => {
    if (dialog.open) return;
    returnFocus = dialog.ownerDocument?.activeElement || trigger;
    apiKeyInput.value = "";
    clearError();
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    queueMicrotask(() => apiKeyInput.focus());
  };

  const cancel = () => {
    if (busy) requestController?.abort();
    closeDialog("cancel");
  };

  const handleDialogCancel = () => {
    if (busy) requestController?.abort();
  };

  const handleDialogClose = () => {
    apiKeyInput.value = "";
    clearError();
    setBusy(false);
    const focusTarget =
      returnFocus && typeof returnFocus.focus === "function"
        ? returnFocus
        : trigger;
    returnFocus = null;
    queueMicrotask(() => focusTarget.focus());
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;

    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showError("请输入 Ark API Key");
      apiKeyInput.focus();
      return;
    }

    clearError();
    setBusy(true);
    requestController = new AbortController();
    try {
      const response = await fetch("/api/knowledge/materials/config", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        signal: requestController.signal,
        body: JSON.stringify({ api_key: apiKey })
      });
      const payload = await readJsonResponse(response);
      if (!response.ok || payload?.configured !== true) {
        showError(publicProviderConfigError(response.status, payload?.error));
        return;
      }

      renderProviderStatus(trigger, payload);
      apiKeyInput.value = "";
      setStatus(
        generationStatus,
        "success",
        "Ark 模型已连接，可运行 DeepTutor / OpenMAIC 官方流水线"
      );
      closeDialog("saved");
      void loadProviderStatus(trigger, null, { preserveOnError: true });
    } catch (error) {
      if (error?.name !== "AbortError") {
        showError("无法连接本机服务，请确认服务已启动后重试");
      }
    } finally {
      requestController = null;
      if (dialog.open) setBusy(false);
    }
  };

  trigger.addEventListener("click", openDialog);
  cancelButton.addEventListener("click", cancel);
  form.addEventListener("submit", submit);
  dialog.addEventListener("cancel", handleDialogCancel);
  dialog.addEventListener("close", handleDialogClose);

  return {
    open: openDialog,
    destroy() {
      requestController?.abort();
      trigger.removeEventListener("click", openDialog);
      cancelButton.removeEventListener("click", cancel);
      form.removeEventListener("submit", submit);
      dialog.removeEventListener("cancel", handleDialogCancel);
      dialog.removeEventListener("close", handleDialogClose);
    }
  };
}

async function loadProviderStatus(
  target,
  status,
  { preserveOnError = false } = {}
) {
  if (!target) return null;
  try {
    const response = await fetch("/api/knowledge/materials/config", {
      headers: { accept: "application/json" }
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error("provider_config_unavailable");
    }
    const configured = Boolean(payload?.configured);
    renderProviderStatus(target, payload);
    if (!configured && status) {
      setStatus(
        status,
        "idle",
        "DeepTutor / OpenMAIC 官方流水线需要先配置模型"
      );
    }
    return payload;
  } catch {
    if (!preserveOnError) {
      renderProviderStatus(target, {
        configured: false,
        unavailable: true
      });
    }
    return null;
  }
}

function renderProviderStatus(target, payload = {}) {
  const configured = payload?.configured === true;
  const unavailable = payload?.unavailable === true;
  target.classList.toggle("is-ready", configured);
  target.classList.toggle("is-missing", !configured && !unavailable);
  target.classList.toggle("is-unavailable", unavailable);

  const copy =
    target.querySelector(".material-provider-copy") ||
    element("span", "material-provider-copy");
  const title = unavailable
    ? "模型状态未知"
    : configured
      ? "官方流水线模型已连接"
      : "官方流水线模型未配置";
  const detail = unavailable
    ? "点击检查或配置"
    : configured
      ? payload.model || "Ark endpoint"
      : "DeepTutor / OpenMAIC 生成必需";
  copy.replaceChildren(
    element("span", "", title),
    element("small", "", detail)
  );

  if (!copy.parentNode) {
    target.append(copy);
  }
  target.setAttribute(
    "aria-label",
    configured
      ? `Ark 模型已连接，当前模型 ${detail}；点击可重新配置密钥`
      : `${title}；DeepTutor 与 OpenMAIC 官方流水线需要模型，点击可配置`
  );
}

export function publicProviderConfigError(status, errorCode = "") {
  if (status === 400 || errorCode === "invalid_input") {
    return "密钥格式不正确，请检查后重试";
  }
  if (status === 403 || errorCode === "local_only") {
    return "仅允许在当前本机配置密钥";
  }
  if (status === 404 || status === 405) {
    return "当前服务不支持页内配置，请确认已启动最新服务";
  }
  if (status === 413 || errorCode === "payload_too_large") {
    return "密钥长度超出限制";
  }
  if (status === 429) {
    return "配置请求过于频繁，请稍后重试";
  }
  if (status >= 500) {
    return "本机服务暂时无法保存配置，请稍后重试";
  }
  return `模型配置失败（HTTP ${Number.isFinite(status) ? status : "未知"}）`;
}

function renderEmptyCards(
  grid,
  technique = TECHNIQUES[0],
  overrideMessage = ""
) {
  const { card, body } = createTechniqueCard(technique, "等待输入");
  const empty = element("div", "material-tech-empty");
  const content = element("div");
  content.append(
    icon(technique.icon),
    element("b", "", `等待 ${technique.technology} 生成`),
    element("p", "", overrideMessage || technique.empty)
  );
  empty.append(content);
  body.append(empty, createTechniqueFoot(technique, "单技术 · 尚未生成"));
  grid.replaceChildren(card);
  grid.removeAttribute("aria-busy");
  refreshIcons();
}

function renderLoadingCards(grid, technique = TECHNIQUES[0]) {
  const { card, body } = createTechniqueCard(technique, "源码执行中");
  const empty = element("div", "material-tech-empty");
  const content = element("div");
  const loader = icon("loader-circle");
  loader.classList.add("is-spinning");
  content.append(
    loader,
    element("b", "", `${technique.technology} 正在生成`),
    element(
      "p",
      "",
      technique.native
        ? "当前只运行这一项官方源码流水线；语义生成由已配置模型驱动。"
        : "当前只执行这一项源码适配器；无需并行调用其他技术。"
    )
  );
  empty.append(content);
  body.append(
    empty,
    createTechniqueFoot(
      technique,
      technique.native ? "官方源码流水线执行中" : "源码适配器执行中"
    )
  );
  grid.replaceChildren(card);
  grid.setAttribute("aria-busy", "true");
  refreshIcons();
}

function renderBundle(grid, bundle, context) {
  const interaction = createMaterialInteractionContext(context.root);
  const techniqueKey =
    bundle.selected_technique ||
    bundle.technique ||
    context.techniqueKey ||
    "deeptutor";
  const nativeResult =
    bundle.source_result ||
    bundle.native_result ||
    {};
  const isNativeTechnique =
    techniqueKey === "deeptutor" ||
    techniqueKey === "openmaic";
  const techniques = isNativeTechnique ? null : normalizeTechniques(bundle);
  let card;
  if (techniqueKey === "openmaic") {
    card = renderNativeOpenMAIC(
      nativeResult,
      bundle,
      context,
      interaction
    );
  } else if (techniqueKey === "deeptutor") {
    card = renderNativeDeepTutor(nativeResult, bundle);
  } else if (techniqueKey === "koji") {
    card = renderKoji(techniques.koji, bundle, interaction);
  } else if (techniqueKey === "cell_studio") {
    card = renderCellStudio(techniques.cell_studio, bundle, context);
  } else {
    card = renderDeepTutor(techniques.deeptutor, bundle);
  }
  grid.replaceChildren(card);
  grid.removeAttribute("aria-busy");
  interaction.markMounted();
  refreshIcons();
  return interaction;
}

export function normalizeDeepTutorNativeResult(value = {}) {
  const root = plainObject(value);
  const nested = plainObject(
    root.native_result ||
      root.result ||
      root.output
  );
  const source = Object.keys(nested).length ? nested : root;
  const book = plainObject(
    source.book ||
      source.manifest ||
      source.book_manifest
  );
  const spine = plainObject(
    source.spine ||
      book.spine
  );
  const chapters = arrayOfObjects(
    spine.chapters ||
      source.chapters ||
      book.chapters
  ).sort(sortByOrder);
  const pages = objectCollection(
    source.pages ||
      book.pages ||
      source.page_map
  ).sort(sortByOrder);
  const conceptGraph = plainObject(
    spine.concept_graph ||
      spine.conceptGraph ||
      source.concept_graph ||
      source.conceptGraph
  );
  const exploration = plainObject(
    source.exploration_report ||
      source.exploration ||
      source.report
  );
  const overview = plainObject(
    source.overview ||
      source.book_overview
  );

  return {
    source,
    book,
    spine,
    chapters,
    pages,
    conceptGraph,
    exploration,
    overview
  };
}

export function normalizeOpenMaicNativeResult(value = {}) {
  const root = plainObject(value);
  const nested = plainObject(
    root.native_result ||
      root.result ||
      root.output
  );
  const source = Object.keys(nested).length ? nested : root;
  const session = plainObject(source.session);
  const stage = plainObject(
    source.stage ||
      session.stage
  );
  const scenes = arrayOfObjects(
    source.scenes ||
      stage.scenes ||
      session.scenes
  ).sort(sortByOrder);
  const outlines = arrayOfObjects(
    source.outlines ||
      session.sceneOutlines ||
      session.scene_outlines
  ).sort(sortByOrder);
  const actions = Array.isArray(source.actions)
    ? source.actions.filter((item) => item && typeof item === "object")
    : scenes.flatMap((scene) =>
        arrayOfObjects(scene.actions).map((action, index) => ({
          ...action,
          sceneId: action.sceneId || action.scene_id || scene.id,
          _sceneOrder: index
        }))
      );

  return {
    source,
    session,
    stage,
    scenes,
    outlines,
    actions
  };
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function arrayOfObjects(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object")
    : [];
}

function objectCollection(value) {
  if (Array.isArray(value)) return arrayOfObjects(value);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .filter(([, item]) => item && typeof item === "object")
    .map(([id, item]) => ({ ...item, id: item.id || id }));
}

function sortByOrder(left, right) {
  return finiteOr(left?.order, 0) - finiteOr(right?.order, 0);
}

function normalizeTechniques(bundle) {
  if (bundle.techniques) {
    return {
      deeptutor: bundle.techniques.deeptutor || {},
      koji: bundle.techniques.koji || {},
      openmaic: bundle.techniques.openmaic || {},
      cell_studio:
        bundle.techniques.cell_studio ||
        bundle.techniques["cell-studio"] ||
        {}
    };
  }
  const outputs = bundle.outputs || {};
  return {
    deeptutor: {
      concept_graph: outputs.concept_graph,
      blocks: outputs.learning_blocks,
      flashcards: outputs.flashcards
    },
    koji: outputs.guided_experience,
    openmaic: {
      outlines: outputs.lesson_outlines,
      scenes: outputs.scenes,
      presentation_timeline: outputs.presentation_timeline,
      quiz: outputs.quiz
    },
    cell_studio: {
      spatial_scene: outputs.spatial_scene
    }
  };
}

function createMaterialInteractionContext(root) {
  let mounted = false;
  let openMaicController = null;
  let postMountTasks = [];

  return {
    setOpenMaicController(controller) {
      openMaicController = controller;
    },
    afterMount(task) {
      if (typeof task !== "function") return;
      if (mounted) {
        task();
        return;
      }
      postMountTasks.push(task);
    },
    markMounted() {
      if (mounted) return;
      mounted = true;
      const tasks = postMountTasks;
      postMountTasks = [];
      tasks.forEach((task) => task());
    },
    focusTarget(targetId) {
      const normalizedTarget = String(targetId || "").trim();
      if (!normalizedTarget) return false;
      if (openMaicController?.focusTarget?.(normalizedTarget)) {
        return true;
      }
      return focusMaterialTarget(root, normalizedTarget);
    },
    destroy() {
      mounted = false;
      postMountTasks = [];
      openMaicController = null;
    }
  };
}

function renderNativeDeepTutor(rawResult = {}, bundle) {
  const native = normalizeDeepTutorNativeResult(rawResult);
  const { book, spine, chapters, pages, conceptGraph, exploration } = native;
  const { card, body } = createTechniqueCard(
    TECHNIQUES[0],
    "官方原生结果"
  );
  card.classList.add("is-native-result", "is-deeptutor-native");

  const title =
    book.title ||
    native.overview.title ||
    bundle.topic?.title ||
    "DeepTutor Book";
  const description =
    book.description ||
    native.overview.description ||
    spine.exploration_summary ||
    exploration.summary ||
    "";
  const manifest = element("section", "material-native-manifest");
  const manifestCopy = element("div", "material-native-manifest-copy");
  const titleRow = element("div", "material-native-title-row");
  titleRow.append(
    element("span", "material-native-kind", "BOOK"),
    element("span", "material-native-status", nativeStatusLabel(book.status))
  );
  manifestCopy.append(
    titleRow,
    element("h5", "", title),
    element(
      "p",
      "",
      description || "由 DeepTutor 官方 Book Engine 生成的原生知识书籍。"
    )
  );
  const metrics = element("dl", "material-native-metrics");
  appendMetric(metrics, "Chapter", chapters.length);
  appendMetric(metrics, "Page", pages.length || book.page_count || 0);
  appendMetric(
    metrics,
    "Concept",
    arrayOfObjects(conceptGraph.nodes).length
  );
  appendMetric(
    metrics,
    "Block",
    pages.reduce(
      (count, page) => count + arrayOfObjects(page.blocks).length,
      0
    )
  );
  manifest.append(manifestCopy, metrics);

  const tabs = createLocalTabs([
    {
      id: "book",
      label: `Book ${chapters.length}`,
      render: () => renderDeepTutorBook(native)
    },
    {
      id: "spine",
      label: `Spine ${arrayOfObjects(conceptGraph.nodes).length}`,
      render: () => renderDeepTutorSpine(native)
    },
    {
      id: "sources",
      label: `Sources ${arrayOfObjects(exploration.chunks).length}`,
      render: () => renderDeepTutorExploration(native)
    }
  ]);

  body.append(
    manifest,
    tabs,
    createNativeSourceFoot(
      nativeProvenanceLabel(bundle, "deeptutor", {
        name: "DeepTutor",
        license: "Apache-2.0"
      }),
      `${chapters.length} Chapter · ${pages.length} Page · 原生 Book Engine`
    )
  );
  return card;
}

function renderDeepTutorBook(native) {
  const { book, chapters, pages } = native;
  const workspace = element("section", "material-book-workspace");
  const chapterNav = element("nav", "material-book-chapters");
  chapterNav.setAttribute("aria-label", "DeepTutor 章节");
  const pageArea = element("section", "material-book-reader");
  const chapterButtons = [];

  if (!chapters.length && !pages.length) {
    workspace.append(
      element(
        "p",
        "material-inline-empty",
        "DeepTutor 原生结果中暂未生成 Chapter 或 Page。"
      )
    );
    return workspace;
  }

  const assignedPageIds = new Set(
    chapters.flatMap((chapter) => [
      ...arrayOfStrings(chapter.page_ids),
      ...pages
        .filter(
          (page) =>
            page.chapter_id === chapter.id ||
            page.chapterId === chapter.id
        )
        .map((page) => page.id)
    ])
  );
  const overviewPages = pages.filter(
    (page) => !assignedPageIds.has(page.id)
  );
  const bookOverviewChapter = {
    id: "__book_overview__",
    title: book.title || "Book Overview",
    summary:
      book.description ||
      "DeepTutor Book Engine 生成的全书概览页面。",
    content_type: "overview",
    learning_objectives: []
  };

  const renderChapter = (chapter, explicitPages = null) => {
    chapterButtons.forEach((button) => {
      const active = button.dataset.chapterId === chapter.id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    const chapterPages =
      explicitPages || pagesForChapter(chapter, pages);
    pageArea.replaceChildren(
      renderDeepTutorChapterHeader(chapter, chapterPages)
    );
    if (!chapterPages.length) {
      const empty = element("div", "material-native-empty-state");
      empty.append(
        icon("file-clock"),
        element("b", "", "Spine 已建立，Page 尚未生成"),
        element(
          "p",
          "",
          "这是官方流水线当前阶段的真实状态；界面不会伪造页面内容。"
        )
      );
      pageArea.append(empty);
      refreshIcons();
      return;
    }

    const pageTabs = element("div", "material-page-tabs");
    pageTabs.setAttribute("role", "tablist");
    pageTabs.setAttribute("aria-label", `${chapter.title || "章节"}页面`);
    const pageContent = element("div", "material-page-content");
    const pageButtons = [];
    const showPage = (page) => {
      pageButtons.forEach((button) => {
        const active = button.dataset.pageId === page.id;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
      pageContent.replaceChildren(renderDeepTutorPage(page));
      refreshIcons();
    };
    chapterPages.forEach((page, index) => {
      const button = element(
        "button",
        `material-page-tab${index === 0 ? " is-active" : ""}`,
        page.title || `Page ${index + 1}`
      );
      button.type = "button";
      button.dataset.pageId = page.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(index === 0));
      button.addEventListener("click", () => showPage(page));
      pageButtons.push(button);
      pageTabs.append(button);
    });
    showPage(chapterPages[0]);
    pageArea.append(pageTabs, pageContent);
  };

  if (overviewPages.length) {
    const overviewButton = element(
      "button",
      "material-book-chapter is-active"
    );
    overviewButton.type = "button";
    overviewButton.dataset.chapterId = bookOverviewChapter.id;
    const iconNode = element(
      "span",
      "material-book-chapter-index",
      "B"
    );
    const copy = element("span");
    copy.append(
      element("b", "", bookOverviewChapter.title),
      element("small", "", `${overviewPages.length} Page · overview`)
    );
    overviewButton.append(iconNode, copy);
    overviewButton.addEventListener("click", () =>
      renderChapter(bookOverviewChapter, overviewPages)
    );
    chapterButtons.push(overviewButton);
    chapterNav.append(overviewButton);
  }

  chapters.forEach((chapter, index) => {
    const button = element(
      "button",
      `material-book-chapter${index === 0 ? " is-active" : ""}`
    );
    button.type = "button";
    button.dataset.chapterId = chapter.id;
    const indexNode = element(
      "span",
      "material-book-chapter-index",
      String(index + 1).padStart(2, "0")
    );
    const copy = element("span");
    copy.append(
      element("b", "", chapter.title || `Chapter ${index + 1}`),
      element(
        "small",
        "",
        `${pagesForChapter(chapter, pages).length} Page · ${
          chapter.content_type || "theory"
        }`
      )
    );
    button.append(indexNode, copy);
    button.addEventListener("click", () => renderChapter(chapter));
    chapterButtons.push(button);
    chapterNav.append(button);
  });
  if (overviewPages.length) {
    renderChapter(bookOverviewChapter, overviewPages);
  } else {
    renderChapter(chapters[0]);
  }
  workspace.append(chapterNav, pageArea);
  return workspace;
}

function pagesForChapter(chapter, pages) {
  const pageIds = new Set(
    Array.isArray(chapter.page_ids) ? chapter.page_ids : []
  );
  return pages
    .filter(
      (page) =>
        page.chapter_id === chapter.id ||
        page.chapterId === chapter.id ||
        pageIds.has(page.id)
    )
    .sort(sortByOrder);
}

function renderDeepTutorChapterHeader(chapter, pages) {
  const header = element("header", "material-book-chapter-head");
  const copy = element("div");
  copy.append(
    element(
      "small",
      "",
      `SPINE · ${chapter.content_type || "theory"} · ${pages.length} PAGE`
    ),
    element("h5", "", chapter.title || "Untitled chapter"),
    element(
      "p",
      "",
      chapter.summary || "该 Chapter 未提供独立摘要。"
    )
  );
  const objectives = element("ul", "material-objective-list");
  arrayOfStrings(chapter.learning_objectives).forEach((objective) => {
    objectives.append(element("li", "", objective));
  });
  header.append(copy);
  if (objectives.childElementCount) header.append(objectives);
  return header;
}

function renderDeepTutorPage(page) {
  const article = element("article", "material-native-page");
  const head = element("header", "material-native-page-head");
  const copy = element("div");
  copy.append(
    element(
      "small",
      "",
      `PAGE · ${page.content_type || "theory"} · ${nativeStatusLabel(page.status)}`
    ),
    element("h6", "", page.title || "Untitled page")
  );
  const blockCount = arrayOfObjects(page.blocks).length;
  const count = element(
    "span",
    "material-native-count",
    `${blockCount} Block`
  );
  head.append(copy, count);
  article.append(head);

  const objectives = arrayOfStrings(page.learning_objectives);
  if (objectives.length) {
    const strip = element("div", "material-page-objectives");
    strip.append(element("b", "", "学习目标"));
    objectives.forEach((objective) =>
      strip.append(element("span", "", objective))
    );
    article.append(strip);
  }

  const blocks = element("div", "material-native-blocks");
  if (!blockCount) {
    blocks.append(
      element(
        "p",
        "material-inline-empty",
        "该 Page 尚未返回 Block。"
      )
    );
  } else {
    arrayOfObjects(page.blocks).forEach((block, index) => {
      blocks.append(renderDeepTutorBlock(block, index));
    });
  }
  article.append(blocks);
  return article;
}

function renderDeepTutorBlock(block, index) {
  const item = element("details", "material-native-block");
  if (index === 0) item.open = true;
  item.dataset.materialTarget = block.id || `block-${index + 1}`;
  const summary = element("summary");
  const type = String(block.type || "block");
  summary.append(
    element("span", "material-native-block-icon", blockTypeGlyph(type)),
    element("b", "", block.title || humanizeKey(type)),
    element("small", "", nativeStatusLabel(block.status))
  );
  const content = element("div", "material-native-block-content");
  const payload = plainObject(block.payload);
  if (Object.keys(payload).length) {
    const payloadGraph = plainObject(payload.graph);
    if (arrayOfObjects(payloadGraph.nodes).length) {
      content.append(renderConceptGraph(payloadGraph));
    }
    const payloadDetails = Object.fromEntries(
      Object.entries(payload).filter(([key]) => key !== "graph")
    );
    if (Object.keys(payloadDetails).length) {
      content.append(renderNativePayload(payloadDetails));
    }
  } else if (block.error) {
    content.append(
      element("p", "material-native-error-copy", block.error)
    );
  } else {
    content.append(
      element(
        "p",
        "material-inline-empty",
        "该 Block 的原生 payload 为空。"
      )
    );
  }
  const anchors = arrayOfObjects(block.source_anchors);
  if (anchors.length) content.append(renderSourceAnchors(anchors));
  item.append(summary, content);
  return item;
}

function renderNativePayload(payload, depth = 0) {
  const root = element("dl", "material-native-payload");
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    const row = element("div", "material-native-payload-row");
    row.append(
      element("dt", "", humanizeKey(key)),
      renderNativeValue(value, depth)
    );
    root.append(row);
  });
  return root;
}

function renderNativeValue(value, depth) {
  const dd = element("dd");
  if (typeof value === "string") {
    dd.className = "material-native-text-value";
    dd.textContent = value;
    return dd;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    dd.className = "material-native-scalar";
    dd.textContent = String(value);
    return dd;
  }
  if (Array.isArray(value)) {
    dd.className = "material-native-value-list";
    value.slice(0, 24).forEach((item) => {
      const child = element("div", "material-native-value-item");
      if (item && typeof item === "object" && depth < 2) {
        child.append(renderNativePayload(item, depth + 1));
      } else {
        child.textContent =
          typeof item === "string" ? item : JSON.stringify(item);
      }
      dd.append(child);
    });
    return dd;
  }
  if (value && typeof value === "object" && depth < 2) {
    dd.append(renderNativePayload(value, depth + 1));
    return dd;
  }
  dd.className = "material-native-code-value";
  dd.textContent = JSON.stringify(value, null, 2);
  return dd;
}

function renderSourceAnchors(anchors) {
  const root = element("details", "material-source-anchors");
  const summary = element(
    "summary",
    "",
    `${anchors.length} 个 Source Anchor`
  );
  const list = element("div");
  anchors.forEach((anchor) => {
    const item = element("article");
    item.append(
      element(
        "small",
        "",
        [anchor.kind, anchor.ref].filter(Boolean).join(" · ") ||
          "source"
      ),
      element("p", "", anchor.snippet || "未提供引用片段")
    );
    list.append(item);
  });
  root.append(summary, list);
  return root;
}

function renderDeepTutorSpine(native) {
  const root = element("section", "material-spine-view");
  const { spine, chapters, conceptGraph } = native;
  const summary = element("section", "material-spine-summary");
  summary.append(
    element("span", "material-native-kind", "SPINE"),
    element(
      "p",
      "",
      spine.exploration_summary ||
        native.exploration.summary ||
        "DeepTutor 官方 Spine 结构"
    )
  );
  const chapterStrip = element("div", "material-spine-chapter-strip");
  chapters.forEach((chapter, index) => {
    const item = element("article");
    item.append(
      element("span", "", String(index + 1).padStart(2, "0")),
      element("b", "", chapter.title || `Chapter ${index + 1}`),
      element(
        "small",
        "",
        `${arrayOfStrings(chapter.prerequisites).length} prerequisites`
      )
    );
    chapterStrip.append(item);
  });
  root.append(summary);
  if (chapterStrip.childElementCount) root.append(chapterStrip);
  root.append(renderConceptGraph(conceptGraph));
  return root;
}

function renderDeepTutorExploration(native) {
  const { exploration, chapters } = native;
  const root = element("section", "material-exploration-view");
  const report = element("section", "material-exploration-report");
  report.append(
    element("span", "material-native-kind", "SOURCE EXPLORER"),
    element(
      "p",
      "",
      exploration.summary ||
        native.spine.exploration_summary ||
        "原生结果未附带 SourceExplorer 摘要。"
    )
  );
  const concepts = arrayOfStrings(exploration.candidate_concepts);
  if (concepts.length) {
    const chips = element("div", "material-native-chip-list");
    concepts.forEach((concept) =>
      chips.append(element("span", "", concept))
    );
    report.append(chips);
  }
  root.append(report);

  const anchors = chapters.flatMap((chapter) =>
    arrayOfObjects(chapter.source_anchors)
  );
  const chunks = arrayOfObjects(exploration.chunks);
  const evidence = element("div", "material-evidence-grid");
  (chunks.length ? chunks : anchors).slice(0, 24).forEach((item) => {
    const card = element("article", "material-evidence-card");
    card.append(
      element(
        "small",
        "",
        [item.source || item.kind, item.kb_name, item.ref]
          .filter(Boolean)
          .join(" · ") || "source"
      ),
      element("p", "", item.text || item.snippet || "未提供引用片段")
    );
    if (Number.isFinite(Number(item.score))) {
      card.append(
        element(
          "span",
          "",
          `score ${Number(item.score).toFixed(2)}`
        )
      );
    }
    evidence.append(card);
  });
  if (evidence.childElementCount) root.append(evidence);
  else {
    root.append(
      element(
        "p",
        "material-inline-empty",
        "本次原生结果没有 Source Chunk 或 Source Anchor。"
      )
    );
  }
  return root;
}

function renderNativeOpenMAIC(
  rawResult = {},
  bundle,
  context,
  interaction
) {
  const native = normalizeOpenMaicNativeResult(rawResult);
  const { stage, scenes, outlines } = native;
  const { card, body } = createTechniqueCard(
    TECHNIQUES[2],
    "官方原生结果"
  );
  card.classList.add("is-native-result", "is-openmaic-native");
  const manifest = element("section", "material-native-manifest is-openmaic");
  const manifestCopy = element("div", "material-native-manifest-copy");
  const titleRow = element("div", "material-native-title-row");
  titleRow.append(
    element("span", "material-native-kind", "STAGE"),
    element(
      "span",
      "material-native-status",
      stage.interactiveMode ? "Interactive" : "Playback"
    )
  );
  manifestCopy.append(
    titleRow,
    element(
      "h5",
      "",
      stage.name || bundle.topic?.title || "OpenMAIC Stage"
    ),
    element(
      "p",
      "",
      stage.description ||
        "由 OpenMAIC 官方 Generation Pipeline 生成的原生课堂。"
    )
  );
  const metrics = element("dl", "material-native-metrics");
  appendMetric(metrics, "Scene", scenes.length);
  appendMetric(
    metrics,
    "Slide",
    scenes.filter((scene) => scene.type === "slide").length
  );
  appendMetric(
    metrics,
    "Quiz",
    scenes.filter((scene) => scene.type === "quiz").length
  );
  appendMetric(
    metrics,
    "Action",
    scenes.reduce(
      (count, scene) => count + arrayOfObjects(scene.actions).length,
      0
    )
  );
  manifest.append(manifestCopy, metrics);

  const tabs = element("div", "material-scene-tabs is-native");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "OpenMAIC 原生场景");
  const preview = element("section", "material-scene-player is-native");
  const tabGroupId = nextMaterialDomId("native-openmaic-scene");
  preview.id = `${tabGroupId}-panel`;
  preview.setAttribute("role", "tabpanel");
  preview.tabIndex = 0;
  const sceneButtons = [];
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  const targetToScene = new Map();
  scenes.forEach((scene) => {
    const canvas = plainObject(scene.content?.canvas);
    arrayOfObjects(canvas.elements).forEach((sceneElement) => {
      if (!targetToScene.has(sceneElement.id)) {
        targetToScene.set(sceneElement.id, scene.id);
      }
    });
  });
  let stopPlayback = () => {};
  let currentSceneId = "";

  const renderScene = (scene) => {
    stopPlayback();
    currentSceneId = scene.id;
    sceneButtons.forEach((button) => {
      const active = button.dataset.sceneId === scene.id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active) preview.setAttribute("aria-labelledby", button.id);
    });
    const outline = outlines.find(
      (item) =>
        item.id === scene.outlineId ||
        item.id === scene.outline_id ||
        item.order === scene.order
    );
    const head = element("header", "material-scene-player-head is-native");
    const title = element("div");
    title.append(
      element(
        "small",
        "",
        `${String(scene.type || "scene").toUpperCase()} · SCENE ${
          Math.max(1, finiteOr(scene.order, 1))
        }`
      ),
      element("h5", "", scene.title || "Untitled scene"),
      element(
        "p",
        "",
        outline?.learningObjective ||
          outline?.learning_objective ||
          outline?.description ||
          ""
      )
    );
    const sceneMeta = element("div", "material-native-scene-meta");
    sceneMeta.append(
      element(
        "span",
        "",
        `${arrayOfObjects(scene.actions).length} Action`
      ),
      element("span", "", scene.content?.type || scene.type || "unknown")
    );
    head.append(title, sceneMeta);

    const content = renderNativeOpenMaicScene(scene, bundle);
    const actions = arrayOfObjects(scene.actions);
    const actionPlayer = renderNativeOpenMaicActions(
      scene,
      actions,
      content
    );
    stopPlayback = actionPlayer.stop;
    preview.replaceChildren(head, content, actionPlayer.root);
    refreshIcons();
  };

  scenes.forEach((scene, index) => {
    const button = element(
      "button",
      `material-scene-tab${index === 0 ? " is-active" : ""}`
    );
    button.type = "button";
    button.dataset.sceneId = scene.id;
    button.id = `${tabGroupId}-tab-${index + 1}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === 0));
    button.setAttribute("aria-controls", preview.id);
    button.tabIndex = index === 0 ? 0 : -1;
    button.append(
      element(
        "span",
        "material-scene-tab-index",
        String(index + 1).padStart(2, "0")
      ),
      element("span", "", scene.title || `Scene ${index + 1}`)
    );
    button.addEventListener("click", () => renderScene(scene));
    button.addEventListener("keydown", (event) => {
      handleRovingTabKeydown(event, sceneButtons);
    });
    tabs.append(button);
    sceneButtons.push(button);
  });
  if (scenes[0]) {
    renderScene(scenes[0]);
  } else {
    preview.append(
      element(
        "p",
        "material-inline-empty",
        "OpenMAIC 原生结果中暂未生成 Scene。"
      )
    );
  }

  interaction.setOpenMaicController({
    focusTarget(targetId) {
      const sceneId = targetToScene.get(targetId);
      const scene = scenesById.get(sceneId);
      if (!scene) return false;
      if (currentSceneId !== sceneId) renderScene(scene);
      return focusMaterialTarget(preview, targetId);
    }
  });
  context.registerDisposer(() => stopPlayback());
  body.append(
    manifest,
    tabs,
    preview,
    createNativeSourceFoot(
      nativeProvenanceLabel(bundle, "openmaic", {
        name: "OpenMAIC",
        license: "MIT"
      }),
      `${scenes.length} Scene · 原生 Stage / Scene / Action`
    )
  );
  return card;
}

function renderNativeOpenMaicScene(scene, bundle) {
  const content = plainObject(scene.content);
  if (content.type === "slide" || scene.type === "slide") {
    return renderNativeSlideCanvas(
      plainObject(content.canvas),
      scene.id
    );
  }
  if (content.type === "quiz" || scene.type === "quiz") {
    return renderNativeQuizScene(content, bundle?.bundle_id);
  }
  if (content.type === "interactive" || scene.type === "interactive") {
    return renderNativeInteractiveScene(content, scene.title);
  }
  if (content.type === "pbl" || scene.type === "pbl") {
    return renderNativePblScene(content);
  }
  const fallback = element("section", "material-native-scene-fallback");
  fallback.append(
    element("b", "", "原生 Scene Content"),
    renderNativePayload(content)
  );
  return fallback;
}

function renderNativeSlideCanvas(canvas = {}, sceneId = "") {
  const shell = element("section", "material-openmaic-slide-shell");
  const toolbar = element("div", "material-openmaic-canvas-toolbar");
  const viewport = Math.max(1, finiteOr(canvas.viewportSize, 1000));
  const ratio = Math.max(0.2, finiteOr(canvas.viewportRatio, 0.5625));
  toolbar.append(
    element("span", "", "SLIDE CANVAS"),
    element(
      "span",
      "",
      `${viewport} × ${Math.round(viewport * ratio)} · ${
        arrayOfObjects(canvas.elements).length
      } elements`
    )
  );
  const frame = element("div", "material-openmaic-canvas-frame");
  frame.style.aspectRatio = `1 / ${ratio}`;
  frame.dataset.sceneId = sceneId;
  applySlideBackground(frame, canvas.background, canvas.theme);
  arrayOfObjects(canvas.elements).forEach((slideElement, index) => {
    frame.append(
      renderNativeSlideElement(slideElement, {
        viewport,
        ratio,
        index,
        theme: plainObject(canvas.theme)
      })
    );
  });
  if (!frame.childElementCount) {
    frame.append(
      element(
        "p",
        "material-inline-empty",
        "该 Slide Canvas 没有元素。"
      )
    );
  }
  shell.append(toolbar, frame);
  return shell;
}

function renderNativeSlideElement(
  slideElement,
  { viewport, ratio, index, theme }
) {
  const type = String(slideElement.type || "unknown");
  const wrapper = element(
    "div",
    `material-openmaic-element is-${type}`
  );
  wrapper.dataset.materialTarget =
    slideElement.id || `slide-element-${index + 1}`;
  wrapper.style.zIndex = String(index + 1);
  const canvasHeight = viewport * ratio;

  if (type === "line") {
    return renderNativeSlideLine(
      slideElement,
      wrapper,
      viewport,
      canvasHeight
    );
  }

  const left = finiteOr(slideElement.left, 0);
  const top = finiteOr(slideElement.top, 0);
  const width = Math.max(1, finiteOr(slideElement.width, 100));
  const height = Math.max(1, finiteOr(slideElement.height, 60));
  wrapper.style.left = `${(left / viewport) * 100}%`;
  wrapper.style.top = `${(top / canvasHeight) * 100}%`;
  wrapper.style.width = `${(width / viewport) * 100}%`;
  wrapper.style.height = `${(height / canvasHeight) * 100}%`;
  wrapper.style.transform = `rotate(${finiteOr(slideElement.rotate, 0)}deg)`;
  wrapper.style.opacity = String(
    Math.min(1, Math.max(0, finiteOr(slideElement.opacity, 1)))
  );
  wrapper.style.animationDelay = `${Math.min(index * 45, 360)}ms`;

  if (type === "text") {
    wrapper.style.color =
      safeCssColor(slideElement.defaultColor) ||
      safeCssColor(theme.fontColor) ||
      "#263348";
    wrapper.style.fontFamily =
      safeFontFamily(slideElement.defaultFontName) ||
      safeFontFamily(theme.fontName) ||
      "sans-serif";
    wrapper.style.lineHeight = String(
      Math.max(0.8, finiteOr(slideElement.lineHeight, 1.35))
    );
    wrapper.classList.add(`is-v-${slideElement.vAlign || "top"}`);
    wrapper.append(renderSafeRichText(slideElement.content));
  } else if (type === "image") {
    const src = safeMediaUrl(slideElement.src, "image");
    if (src) {
      const image = document.createElement("img");
      image.src = src;
      image.alt = slideElement.name || "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.style.objectFit = slideElement.fixedRatio === false
        ? "fill"
        : "contain";
      if (Number.isFinite(Number(slideElement.radius))) {
        image.style.borderRadius = `${Math.max(
          0,
          Number(slideElement.radius)
        )}px`;
      }
      wrapper.append(image);
    } else {
      wrapper.append(
        element("span", "material-native-media-missing", "IMAGE")
      );
    }
  } else if (type === "shape") {
    wrapper.append(renderNativeShape(slideElement));
  } else if (type === "chart") {
    wrapper.append(renderNativeChart(slideElement));
  } else if (type === "table") {
    wrapper.append(renderNativeTable(slideElement));
  } else if (type === "latex") {
    const latex = element(
      "div",
      "material-native-latex",
      slideElement.latex || ""
    );
    if (slideElement.html) {
      latex.replaceChildren(renderSafeRichText(slideElement.html));
    }
    wrapper.append(latex);
  } else if (type === "code") {
    const pre = element("pre", "material-native-code");
    const lines = Array.isArray(slideElement.lines)
      ? slideElement.lines.map((line) => line?.content || "").join("\n")
      : slideElement.code || "";
    pre.textContent = lines;
    wrapper.append(pre);
  } else if (type === "video") {
    const src = safeMediaUrl(slideElement.src, "video");
    if (src) {
      const video = document.createElement("video");
      video.src = src;
      video.controls = true;
      video.preload = "metadata";
      if (safeMediaUrl(slideElement.poster, "image")) {
        video.poster = slideElement.poster;
      }
      wrapper.append(video);
    } else {
      wrapper.append(
        element("span", "material-native-media-missing", "VIDEO")
      );
    }
  } else if (type === "audio") {
    const src = safeMediaUrl(slideElement.src, "audio");
    if (src) {
      const audio = document.createElement("audio");
      audio.src = src;
      audio.controls = true;
      wrapper.append(audio);
    }
  } else {
    wrapper.append(
      element(
        "span",
        "material-native-media-missing",
        type.toUpperCase()
      )
    );
  }
  return wrapper;
}

function renderNativeSlideLine(
  line,
  wrapper,
  viewport,
  canvasHeight
) {
  const start = Array.isArray(line.start) ? line.start : [0, 0];
  const end = Array.isArray(line.end) ? line.end : [100, 0];
  const left = finiteOr(line.left, 0);
  const top = finiteOr(line.top, 0);
  const width = Math.max(24, Math.abs(finiteOr(start[0], 0) - finiteOr(end[0], 100)));
  const height = Math.max(24, Math.abs(finiteOr(start[1], 0) - finiteOr(end[1], 0)));
  wrapper.style.left = `${(left / viewport) * 100}%`;
  wrapper.style.top = `${(top / canvasHeight) * 100}%`;
  wrapper.style.width = `${(width / viewport) * 100}%`;
  wrapper.style.height = `${(height / canvasHeight) * 100}%`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const rising = finiteOr(end[1], 0) < finiteOr(start[1], 0);
  path.setAttribute(
    "d",
    `M 1 ${rising ? height - 1 : 1} L ${width - 1} ${
      rising ? 1 : height - 1
    }`
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", safeCssColor(line.color) || "#335fe8");
  path.setAttribute("stroke-width", String(Math.max(1, finiteOr(line.width, 2))));
  if (line.style === "dashed") path.setAttribute("stroke-dasharray", "10 6");
  if (line.style === "dotted") path.setAttribute("stroke-dasharray", "2 5");
  svg.append(path);
  wrapper.append(svg);
  return wrapper;
}

function renderNativeShape(shape) {
  const root = element("div", "material-native-shape");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const viewBox = Array.isArray(shape.viewBox)
    ? shape.viewBox
    : [100, 100];
  svg.setAttribute("viewBox", `0 0 ${viewBox[0]} ${viewBox[1]}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    String(shape.path || `M 0 0 H ${viewBox[0]} V ${viewBox[1]} H 0 Z`)
  );
  path.setAttribute("fill", safeCssColor(shape.fill) || "#e8efff");
  const outline = plainObject(shape.outline);
  path.setAttribute("stroke", safeCssColor(outline.color) || "transparent");
  path.setAttribute("stroke-width", String(Math.max(0, finiteOr(outline.width, 0))));
  svg.append(path);
  root.append(svg);
  if (shape.text?.content) {
    const text = element("div", "material-native-shape-text");
    text.style.color =
      safeCssColor(shape.text.defaultColor) || "#263348";
    text.append(renderSafeRichText(shape.text.content));
    root.append(text);
  }
  return root;
}

function renderNativeChart(chart) {
  const root = element("div", "material-native-chart");
  const data = plainObject(chart.data);
  const labels = Array.isArray(data.labels) ? data.labels : [];
  const values = Array.isArray(data.series?.[0])
    ? data.series[0].map((value) => finiteOr(value, 0))
    : [];
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const colors = Array.isArray(chart.themeColors)
    ? chart.themeColors
    : ["#356fe0", "#20a868", "#f59e0b"];
  const plot = element("div", "material-native-chart-plot");
  values.slice(0, 10).forEach((value, index) => {
    const item = element("div", "material-native-chart-item");
    const bar = element("span");
    bar.style.height = `${Math.max(4, (Math.abs(value) / max) * 100)}%`;
    bar.style.background =
      safeCssColor(colors[index % colors.length]) || "#356fe0";
    item.append(
      element("small", "", String(value)),
      bar,
      element("em", "", labels[index] || String(index + 1))
    );
    plot.append(item);
  });
  root.append(plot);
  return root;
}

function renderNativeTable(tableData) {
  const wrap = element("div", "material-native-table-wrap");
  const table = element("table", "material-native-table");
  arrayOfObjects(tableData.data).forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    (Array.isArray(row) ? row : []).forEach((cell) => {
      const tag = rowIndex === 0 ? "th" : "td";
      const node = document.createElement(tag);
      node.colSpan = Math.max(1, finiteOr(cell.colspan, 1));
      node.rowSpan = Math.max(1, finiteOr(cell.rowspan, 1));
      node.append(renderSafeRichText(cell.text || ""));
      tr.append(node);
    });
    table.append(tr);
  });
  wrap.append(table);
  return wrap;
}

function applySlideBackground(frame, backgroundValue, themeValue) {
  const background = plainObject(backgroundValue);
  const theme = plainObject(themeValue);
  const fallback =
    safeCssColor(theme.backgroundColor) ||
    "#f8fafc";
  if (background.type === "gradient" && background.gradient) {
    const gradient = plainObject(background.gradient);
    const colors = arrayOfObjects(gradient.colors);
    const stops = colors
      .map(
        (stop) =>
          `${safeCssColor(stop.color) || fallback} ${Math.min(
            100,
            Math.max(0, finiteOr(stop.pos, 0))
          )}%`
      )
      .join(", ");
    frame.style.background = gradient.type === "radial"
      ? `radial-gradient(circle, ${stops || fallback})`
      : `linear-gradient(${finiteOr(gradient.rotate, 0)}deg, ${
          stops || fallback
        })`;
  } else if (background.type === "image") {
    const src = safeMediaUrl(background.image?.src, "image");
    frame.style.backgroundColor = fallback;
    if (src) {
      frame.style.backgroundImage = `url("${src.replaceAll('"', "%22")}")`;
      frame.style.backgroundSize =
        background.image?.size === "contain" ? "contain" : "cover";
      frame.style.backgroundPosition = "center";
    }
  } else {
    frame.style.backgroundColor =
      safeCssColor(background.color) || fallback;
  }
}

function renderSafeRichText(htmlValue) {
  const root = element("div", "material-safe-rich-text");
  const template = document.createElement("template");
  template.innerHTML = String(htmlValue || "");
  const allowedTags = new Set([
    "P",
    "SPAN",
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "S",
    "BR",
    "UL",
    "OL",
    "LI",
    "SUB",
    "SUP",
    "SMALL"
  ]);
  const appendSanitized = (source, target) => {
    source.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        target.append(document.createTextNode(child.textContent || ""));
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = allowedTags.has(child.tagName) ? child.tagName.toLowerCase() : "span";
      const clean = document.createElement(tag);
      const safeStyle = sanitizeInlineTextStyle(
        child.getAttribute("style") || ""
      );
      if (safeStyle) clean.setAttribute("style", safeStyle);
      appendSanitized(child, clean);
      target.append(clean);
    });
  };
  appendSanitized(template.content, root);
  return root;
}

function sanitizeInlineTextStyle(styleText) {
  const allowed = new Set([
    "color",
    "font-size",
    "font-weight",
    "font-style",
    "text-decoration",
    "text-align",
    "line-height",
    "letter-spacing"
  ]);
  return String(styleText)
    .split(";")
    .map((declaration) => declaration.split(":"))
    .filter(([property, value]) => {
      const key = property?.trim().toLowerCase();
      const normalized = value?.trim().toLowerCase() || "";
      return (
        allowed.has(key) &&
        !normalized.includes("url(") &&
        !normalized.includes("expression") &&
        !normalized.includes("javascript:")
      );
    })
    .map(([property, ...value]) => `${property.trim()}:${value.join(":").trim()}`)
    .join(";");
}

function renderNativeQuizScene(content, bundleId) {
  const root = element("section", "material-native-quiz-scene");
  const questions = arrayOfObjects(content.questions);
  if (!questions.length) {
    root.append(
      element("p", "material-inline-empty", "该 Quiz Scene 没有 Question。")
    );
    return root;
  }
  questions.forEach((question, index) => {
    root.append(renderNativeQuizQuestion(question, index, bundleId));
  });
  return root;
}

function renderNativeQuizQuestion(question, index, bundleId) {
  const item = element("article", "material-native-quiz-question");
  item.dataset.materialTarget = question.id || `question-${index + 1}`;
  const head = element("header");
  head.append(
    element(
      "span",
      "material-native-kind",
      `QUESTION ${String(index + 1).padStart(2, "0")}`
    ),
    element(
      "span",
      "material-native-status",
      question.type || "single"
    )
  );
  item.append(head, element("h6", "", question.question || "Untitled question"));

  const options = Array.isArray(question.options)
    ? question.options
    : [];
  const selected = new Set();
  const optionButtons = [];
  const feedback = element("div", "material-quiz-feedback");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  feedback.hidden = true;
  if (question.type === "short_answer") {
    const input = document.createElement("textarea");
    input.className = "material-native-short-answer";
    input.rows = 3;
    input.placeholder = "输入你的回答";
    input.setAttribute("aria-label", question.question || "简答题");
    item.append(input);
  } else {
    const grid = element("div", "material-quiz-options");
    grid.setAttribute("role", "group");
    options.forEach((option, optionIndex) => {
      const value = String(
        option.value ?? option.id ?? String.fromCharCode(65 + optionIndex)
      );
      const button = element("button", "material-quiz-option");
      button.type = "button";
      button.dataset.value = value;
      button.dataset.materialTarget = `${question.id || "question"}:${value}`;
      button.setAttribute("aria-pressed", "false");
      button.append(
        element("b", "", value),
        element("span", "", option.label || option.text || value)
      );
      button.addEventListener("click", () => {
        if (question.type === "multiple") {
          if (selected.has(value)) selected.delete(value);
          else selected.add(value);
        } else {
          selected.clear();
          selected.add(value);
        }
        optionButtons.forEach((optionButton) => {
          const active = selected.has(optionButton.dataset.value);
          optionButton.classList.toggle("is-selected", active);
          optionButton.setAttribute("aria-pressed", String(active));
        });
        feedback.hidden = false;
        feedback.className = "material-quiz-feedback";
        feedback.textContent = `已选择：${[...selected].join("、")}`;
      });
      optionButtons.push(button);
      grid.append(button);
    });
    item.append(grid);
  }

  const answers = Array.isArray(question.answer)
    ? question.answer.map(String)
    : [];
  const canUseTrustedGrade =
    question.type === "single" &&
    typeof bundleId === "string" &&
    Boolean(bundleId) &&
    typeof question.id === "string" &&
    Boolean(question.id);
  const actionRow = element("div", "material-native-quiz-actions");
  const check = element(
    "button",
    "",
    answers.length || canUseTrustedGrade ? "检查答案" : "确认作答"
  );
  check.type = "button";
  check.addEventListener("click", async () => {
    feedback.hidden = false;
    if (question.type === "short_answer") {
      feedback.className = "material-quiz-feedback";
      feedback.textContent =
        question.analysis || "回答已记录；本题需要教师或模型进一步评价。";
      return;
    }
    if (!selected.size) {
      feedback.className = "material-quiz-feedback is-error";
      feedback.textContent = "请先选择一个答案。";
      return;
    }
    if (canUseTrustedGrade && !answers.length) {
      const selectedValue = [...selected][0];
      if (!["A", "B", "C", "D"].includes(selectedValue)) {
        feedback.className = "material-quiz-feedback";
        feedback.textContent = "作答已记录；该原生题目不使用 A–D 可信判题格式。";
        return;
      }
      check.disabled = true;
      optionButtons.forEach((optionButton) => {
        optionButton.disabled = true;
      });
      feedback.className = "material-quiz-feedback is-loading";
      feedback.textContent = "正在由服务端可信判题…";
      try {
        const response = await fetch("/api/knowledge/materials/grade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bundle_id: bundleId,
            question_id: question.id,
            selected: selectedValue
          })
        });
        const result = await readJsonResponse(response);
        if (!response.ok) {
          const gradeError = new Error(result.message || "判题失败");
          gradeError.code = result.error;
          throw gradeError;
        }
        const canRetry =
          !result.correct && Number(result.attempts_remaining) > 0;
        const selectedButton = optionButtons.find(
          (optionButton) => optionButton.dataset.value === selectedValue
        );
        selectedButton?.classList.add(
          result.correct ? "is-correct" : "is-incorrect"
        );
        feedback.className = `material-quiz-feedback ${
          result.correct ? "is-correct" : "is-incorrect"
        }`;
        feedback.replaceChildren(
          element(
            "b",
            "",
            result.correct
              ? "回答正确"
              : canRetry
                ? "再想一想"
                : "本题作答结束"
          ),
          element(
            "span",
            "",
            result.correct
              ? result.explanation || "你已掌握这个知识点。"
              : canRetry
                ? "回到场景内容寻找线索后再试一次。"
                : "本题尝试次数已用完。"
          )
        );
        if (canRetry) {
          check.disabled = false;
          optionButtons.forEach((optionButton) => {
            optionButton.disabled = false;
          });
        }
      } catch (error) {
        feedback.className = "material-quiz-feedback is-error";
        feedback.textContent = error?.message || "判题服务暂不可用";
        if (error?.code !== "question_closed") {
          check.disabled = false;
          optionButtons.forEach((optionButton) => {
            optionButton.disabled = false;
          });
        }
      }
      return;
    }
    if (!answers.length) {
      feedback.className = "material-quiz-feedback";
      feedback.textContent = "作答已记录；公开原生结果未携带答案。";
      return;
    }
    const selectedValues = [...selected].sort();
    const correct =
      selectedValues.length === answers.length &&
      selectedValues.every((value, answerIndex) => value === [...answers].sort()[answerIndex]);
    feedback.className = `material-quiz-feedback ${
      correct ? "is-correct" : "is-incorrect"
    }`;
    feedback.replaceChildren(
      element("b", "", correct ? "回答正确" : "再想一想"),
      element(
        "span",
        "",
        question.analysis ||
          (correct ? "你已掌握这个知识点。" : "回到场景内容寻找线索。")
      )
    );
  });
  actionRow.append(check);
  item.append(actionRow, feedback);
  return item;
}

function renderNativeInteractiveScene(content, title) {
  const root = element("section", "material-native-interactive");
  const bar = element("header");
  bar.append(
    element("span", "material-native-kind", "SANDBOXED INTERACTIVE"),
    element("span", "", "脚本可运行 · 宿主数据隔离")
  );
  const iframe = document.createElement("iframe");
  iframe.className = "material-native-interactive-frame";
  iframe.title = title || "OpenMAIC 互动场景";
  iframe.setAttribute(
    "sandbox",
    "allow-scripts allow-forms allow-pointer-lock"
  );
  iframe.setAttribute("referrerpolicy", "no-referrer");
  if (typeof content.html === "string" && content.html.trim()) {
    iframe.srcdoc = content.html;
  } else {
    const url = safeFrameUrl(content.url);
    if (url) iframe.src = url;
    else {
      iframe.srcdoc =
        "<!doctype html><html><body style='font-family:sans-serif;color:#667085;display:grid;place-items:center;height:100vh;margin:0'>互动内容为空</body></html>";
    }
  }
  root.append(bar, iframe);
  return root;
}

function renderNativePblScene(content) {
  const root = element("section", "material-native-pbl");
  root.append(
    element("span", "material-native-kind", "PROJECT BASED LEARNING"),
    renderNativePayload(
      plainObject(content.projectV2 || content.projectConfig || content)
    )
  );
  return root;
}

export function describeNativeOpenMaicAction(action = {}, index = 0) {
  const type = String(action.type || "action");
  const targetId =
    action.elementId ||
    action.target ||
    action.target_id ||
    "";
  const narration =
    action.text ||
    action.content ||
    action.description ||
    action.prompt ||
    action.topic ||
    action.title ||
    ACTION_LABELS[type] ||
    type;
  const explicitDuration =
    action.durationMs ??
    action.duration_ms ??
    action.duration;
  const duration = Number.isFinite(Number(explicitDuration))
    ? Math.min(5000, Math.max(500, Number(explicitDuration)))
    : type === "speech"
      ? Math.min(3600, Math.max(1200, String(narration).length * 72))
      : 1100;
  return {
    index,
    type,
    targetId: String(targetId),
    narration: String(narration),
    duration
  };
}

function renderNativeOpenMaicActions(scene, actions, sceneContent) {
  const root = element("section", "material-native-action-player");
  const controls = element("header", "material-native-action-controls");
  const copy = element("div");
  copy.append(
    element("span", "material-native-kind", "ACTION TIMELINE"),
    element(
      "b",
      "",
      actions.length
        ? `${actions.length} 个官方 Action`
        : "当前 Scene 没有 Action"
    )
  );
  const buttons = element("div");
  const previous = element("button");
  previous.type = "button";
  previous.setAttribute("aria-label", "上一个 Action");
  previous.append(icon("skip-back"));
  const play = element("button", "is-primary");
  play.type = "button";
  play.append(icon("play"), document.createTextNode("播放"));
  const next = element("button");
  next.type = "button";
  next.setAttribute("aria-label", "下一个 Action");
  next.append(icon("skip-forward"));
  buttons.append(previous, play, next);
  controls.append(copy, buttons);

  const timeline = element("ol", "material-native-action-list");
  const actionButtons = [];
  const narration = element("div", "material-playback-narration is-native");
  narration.setAttribute("role", "status");
  narration.setAttribute("aria-live", "polite");
  narration.textContent =
    "选择一个 Action，或播放完整教学动作序列。";
  let current = -1;
  let running = false;
  let timer = 0;

  const clearEffects = () => {
    sceneContent.classList.remove("has-native-spotlight");
    sceneContent
      .querySelectorAll(".is-native-action-target")
      .forEach((node) => node.classList.remove("is-native-action-target"));
  };
  const sendWidgetAction = (action) => {
    const iframe = sceneContent.querySelector("iframe");
    if (!iframe?.contentWindow) return;
    const messageTypes = {
      widget_highlight: "HIGHLIGHT_ELEMENT",
      widget_setState: "SET_WIDGET_STATE",
      widget_annotation: "ANNOTATE_ELEMENT",
      widget_reveal: "REVEAL_ELEMENT"
    };
    const messageType = messageTypes[action.type];
    if (!messageType) return;
    iframe.contentWindow.postMessage(
      {
        type: messageType,
        target: action.target,
        state: action.state,
        content: action.content
      },
      "*"
    );
  };
  const run = (index, { autoAdvance = false } = {}) => {
    window.clearTimeout(timer);
    clearEffects();
    if (!actions.length) return;
    current = Math.min(actions.length - 1, Math.max(0, index));
    const action = actions[current];
    const view = describeNativeOpenMaicAction(action, current);
    actionButtons.forEach((button, buttonIndex) => {
      button.classList.toggle("is-active", buttonIndex === current);
      button.setAttribute(
        "aria-current",
        buttonIndex === current ? "step" : "false"
      );
    });
    const targets = [
      ...sceneContent.querySelectorAll("[data-material-target]")
    ];
    const target = targets.find(
      (node) => node.dataset.materialTarget === view.targetId
    );
    if (target) target.classList.add("is-native-action-target");
    if (view.type === "spotlight") {
      sceneContent.classList.add("has-native-spotlight");
    }
    sendWidgetAction(action);
    narration.replaceChildren(
      element(
        "small",
        "",
        `${ACTION_LABELS[view.type] || humanizeKey(view.type)} · ${
          current + 1
        }/${actions.length}`
      ),
      element("span", "", view.narration)
    );
    previous.disabled = current <= 0;
    next.disabled = current >= actions.length - 1;
    if (autoAdvance && running) {
      timer = window.setTimeout(() => {
        if (current >= actions.length - 1) {
          running = false;
          play.replaceChildren(
            icon("rotate-ccw"),
            document.createTextNode("重播")
          );
          refreshIcons();
          return;
        }
        run(current + 1, { autoAdvance: true });
      }, view.duration);
    }
  };

  actions.forEach((action, index) => {
    const view = describeNativeOpenMaicAction(action, index);
    const button = element("button");
    button.type = "button";
    button.append(
      element("span", "", String(index + 1).padStart(2, "0")),
      element("b", "", ACTION_LABELS[view.type] || humanizeKey(view.type)),
      element("small", "", view.narration)
    );
    button.addEventListener("click", () => {
      running = false;
      play.replaceChildren(icon("play"), document.createTextNode("播放"));
      run(index);
      refreshIcons();
    });
    actionButtons.push(button);
    const item = document.createElement("li");
    item.append(button);
    timeline.append(item);
  });

  play.disabled = actions.length === 0;
  previous.disabled = true;
  next.disabled = actions.length < 2;
  play.addEventListener("click", () => {
    if (running) {
      running = false;
      window.clearTimeout(timer);
      play.replaceChildren(icon("play"), document.createTextNode("继续"));
    } else {
      running = true;
      play.replaceChildren(icon("pause"), document.createTextNode("暂停"));
      run(current >= actions.length - 1 ? 0 : Math.max(0, current), {
        autoAdvance: true
      });
    }
    refreshIcons();
  });
  previous.addEventListener("click", () => {
    running = false;
    run(current - 1);
  });
  next.addEventListener("click", () => {
    running = false;
    run(current + 1);
  });

  root.append(controls);
  if (timeline.childElementCount) root.append(timeline);
  root.append(narration);
  return {
    root,
    stop() {
      running = false;
      window.clearTimeout(timer);
      clearEffects();
    }
  };
}

function appendMetric(list, label, value) {
  const item = element("div");
  item.append(
    element("dt", "", label),
    element("dd", "", String(value ?? 0))
  );
  list.append(item);
}

function nativeProvenanceLabel(bundle, technique, fallback) {
  const provenance = plainObject(bundle?.provenance?.[technique]);
  const revision = String(
    provenance.tag ||
      provenance.repository_version ||
      provenance.version ||
      provenance.source_revision ||
      ""
  ).trim();
  const conciseRevision =
    revision.length > 14 && /^[a-f0-9]+$/i.test(revision)
      ? revision.slice(0, 8)
      : revision;
  return [
    fallback.name,
    conciseRevision,
    provenance.license || fallback.license
  ]
    .filter(Boolean)
    .join(" · ");
}

function nativeStatusLabel(value) {
  const normalized = String(value || "ready")
    .replace(/^.*\./, "")
    .toLowerCase();
  const labels = {
    draft: "Draft",
    pending: "Pending",
    generating: "Generating",
    ready: "Ready",
    complete: "Complete",
    completed: "Complete",
    failed: "Failed"
  };
  return labels[normalized] || humanizeKey(normalized);
}

function blockTypeGlyph(type) {
  const glyphs = {
    concept: "C",
    explanation: "E",
    example: "X",
    quiz: "Q",
    summary: "S",
    flashcard: "F",
    formula: "ƒ",
    diagram: "D"
  };
  return glyphs[String(type).toLowerCase()] || "B";
}

function humanizeKey(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function safeCssColor(value) {
  const candidate = String(value || "").trim();
  if (
    /^#[0-9a-f]{3,8}$/i.test(candidate) ||
    /^rgba?\(\s*[\d.%\s,]+\)$/i.test(candidate) ||
    /^hsla?\(\s*[\d.%\s,]+\)$/i.test(candidate) ||
    /^[a-z]{3,20}$/i.test(candidate)
  ) {
    return candidate;
  }
  return "";
}

function safeFontFamily(value) {
  const candidate = String(value || "").trim();
  return /^[\w\u4e00-\u9fff\s,'"-]{1,100}$/u.test(candidate)
    ? candidate
    : "";
}

function safeMediaUrl(value, kind = "image") {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  if (/^(https?:\/\/|\/(?!\/)|\.\/|\.\.\/)/i.test(candidate)) {
    return candidate;
  }
  if (
    kind === "image" &&
    /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(
      candidate
    )
  ) {
    return candidate;
  }
  return "";
}

function safeFrameUrl(value) {
  const candidate = String(value || "").trim();
  return /^(https?:\/\/|\/(?!\/))/i.test(candidate) ? candidate : "";
}

function renderDeepTutor(data = {}, bundle) {
  const { card, body } = createTechniqueCard(TECHNIQUES[0], "源码适配");
  const graph = data.concept_graph || { nodes: [], edges: [] };
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const flashcards = Array.isArray(data.flashcards) ? data.flashcards : [];
  const tabs = createLocalTabs([
    {
      id: "graph",
      label: `概念图 ${graph.nodes?.length || 0}`,
      render: () => renderConceptGraph(graph)
    },
    {
      id: "blocks",
      label: `知识块 ${blocks.length}`,
      render: () => renderLearningBlocks(blocks)
    },
    {
      id: "flashcards",
      label: `记忆卡 ${flashcards.length}`,
      render: () => renderFlashcards(flashcards)
    }
  ]);

  const summaryBlock =
    blocks.find((block) => block.type === "summary") ||
    blocks[0];
  if (summaryBlock) {
    const summary = element("section", "material-summary");
    summary.append(
      element("b", "", summaryBlock.title || "核心摘要"),
      element("span", "", summaryBlock.content)
    );
    body.append(summary);
  }
  body.append(
    tabs,
    createProtocolFoot(
      `${bundle.card_materials?.length || 0} 个 A2UI 投影 · Apache 适配`
    )
  );
  return card;
}

function renderConceptGraph(graph = {}) {
  const panel = element("section", "material-graph-panel");
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges)
    ? graph.edges.map((edge, index) => ({
        ...edge,
        id: edge.id || `edge-${index + 1}`,
        from: edge.from || edge.src,
        to: edge.to || edge.dst
      }))
    : [];
  if (!nodes.length) {
    panel.append(
      element("p", "material-inline-empty", "源码适配器未返回概念节点")
    );
    return panel;
  }

  const positions = layoutConceptGraph(graph, nodes, edges);
  const canvas = element("div", "material-concept-graph");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 1000 520");
  svg.setAttribute("aria-hidden", "true");
  const edgeByPair = new Map(
    edges.map((edge) => [`${edge.from}→${edge.to}`, edge])
  );

  for (const edge of edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const startX = from.x * 10 + 58;
    const endX = to.x * 10 - 58;
    const startY = from.y * 5.2;
    const endY = to.y * 5.2;
    const control = Math.max(44, (endX - startX) * 0.45);
    path.setAttribute(
      "d",
      `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`
    );
    path.dataset.edgeId = edge.id;
    svg.append(path);
  }
  canvas.append(svg);

  const detail = element("section", "material-graph-detail");
  const buttons = [];
  const selectNode = (node) => {
    buttons.forEach((button) =>
      button.classList.toggle("is-active", button.dataset.nodeId === node.id)
    );
    const incoming = edges.find((edge) => edge.to === node.id);
    detail.replaceChildren(
      element(
        "small",
        "",
        incoming?.relation ? `关系 · ${incoming.relation}` : "核心概念"
      ),
      element("b", "", node.label || node.id),
      element(
        "p",
        "",
        node.summary ||
          node.description ||
          incoming?.rationale ||
          "该概念未提供独立说明。"
      )
    );
  };

  for (const node of nodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    const button = element(
      "button",
      `material-graph-node${
        node.id === (graph.root_id || graph.rootId || inferGraphRoot(nodes, edges))
          ? " is-root"
          : ""
      }`
    );
    button.type = "button";
    button.dataset.nodeId = node.id;
    button.dataset.materialTarget = node.id;
    button.style.left = `${position.x}%`;
    button.style.top = `${position.y}%`;
    button.textContent = node.label || node.id;
    button.addEventListener("click", () => selectNode(node));
    buttons.push(button);
    canvas.append(button);
  }
  const rootId =
    graph.root_id ||
    graph.rootId ||
    inferGraphRoot(nodes, edges);
  selectNode(nodes.find((node) => node.id === rootId) || nodes[0]);
  panel.append(canvas, detail);

  if (edgeByPair.size > 0) {
    const legend = element(
      "small",
      "material-graph-legend",
      "连线来自源码适配器生成的显式概念关系"
    );
    panel.append(legend);
  }
  return panel;
}

function layoutConceptGraph(graph, nodes, edges) {
  const rootId =
    graph.root_id ||
    graph.rootId ||
    inferGraphRoot(nodes, edges);
  const children = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => children.get(edge.from)?.push(edge.to));
  const depths = new Map([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    const depth = depths.get(id) || 0;
    for (const childId of children.get(id) || []) {
      if (!depths.has(childId)) {
        depths.set(childId, depth + 1);
        queue.push(childId);
      }
    }
  }
  const levels = new Map();
  nodes.forEach((node) => {
    const depth = depths.get(node.id) ?? 2;
    if (!levels.has(depth)) levels.set(depth, []);
    levels.get(depth).push(node);
  });
  const maxDepth = Math.max(1, ...levels.keys());
  const positions = new Map();
  [...levels.entries()].forEach(([depth, levelNodes]) => {
    levelNodes.forEach((node, index) => {
      positions.set(node.id, {
        x: 12 + (depth / maxDepth) * 76,
        y: ((index + 1) / (levelNodes.length + 1)) * 100
      });
    });
  });
  return positions;
}

function inferGraphRoot(nodes, edges) {
  const incoming = new Set(
    edges.map((edge) => edge.to || edge.dst).filter(Boolean)
  );
  return nodes.find((node) => !incoming.has(node.id))?.id || nodes[0]?.id;
}

function renderLearningBlocks(blocks) {
  const list = element("div", "material-block-list");
  blocks.forEach((block, index) => {
    const item = element("details", "material-block-item");
    if (index === 0) item.open = true;
    const summary = element("summary");
    summary.append(
      element("span", "material-block-index", String(index + 1)),
      element("b", "", block.title),
      element("small", "", block.type)
    );
    item.append(summary, element("p", "", block.content));
    list.append(item);
  });
  return list;
}

function renderFlashcards(cards) {
  const wrap = element("div", "material-flashcard-grid");
  cards.slice(0, 6).forEach((card, index) => {
    const button = element("button", "material-flashcard");
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    const front = element("span", "material-flashcard-face is-front");
    front.append(
      element("small", "", `记忆卡 ${index + 1}`),
      element("b", "", card.front),
      element("em", "", "点击翻面")
    );
    const back = element("span", "material-flashcard-face is-back");
    back.append(
      element("small", "", "答案"),
      element("b", "", card.back),
      element("em", "", "点击返回")
    );
    button.append(front, back);
    button.addEventListener("click", () => {
      const active = button.classList.toggle("is-flipped");
      button.setAttribute("aria-pressed", String(active));
    });
    wrap.append(button);
  });
  return wrap;
}

function renderKoji(data = {}, bundle, interaction) {
  const { card, body } = createTechniqueCard(TECHNIQUES[1], "状态驱动");
  const states = Array.isArray(data.guided_states)
    ? data.guided_states
    : [];
  const hints = Array.isArray(data.layered_hints)
    ? data.layered_hints
    : [];
  const cues = Array.isArray(data.attention_cues)
    ? data.attention_cues
    : [];
  const control = element("section", "material-koji-control");
  const triggerRow = element("div", "material-koji-triggers");
  triggerRow.setAttribute("role", "group");
  triggerRow.setAttribute("aria-label", "选择学习状态");
  const stage = element("section", "material-koji-stage");
  const buttons = [];
  let currentState = states[0];
  let hintLevel = 0;
  const questionId =
    bundle?.techniques?.openmaic?.quiz?.question_id ||
    bundle?.outputs?.quiz?.question_id ||
    "";
  const matchedHintSet = hints.find(
    (item) => item.question_id === questionId
  );
  const hintSet =
    matchedHintSet?.levels ||
    (!questionId ? hints[0]?.levels : null) ||
    [];

  const applyTarget = (targetId) => {
    interaction.focusTarget(targetId);
  };

  const renderState = (guidedState, { focusTarget = true } = {}) => {
    if (!guidedState) {
      stage.replaceChildren(
        element("p", "material-inline-empty", "状态机未返回辅导状态")
      );
      return;
    }
    currentState = guidedState;
    hintLevel = 0;
    buttons.forEach((button) => {
      const active = button.dataset.stateId === guidedState.id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const cue = cues.find(
      (item) => item.target_id === guidedState.focus_target
    );
    const top = element("header");
    const stateCopy = element("div");
    stateCopy.append(
      element("small", "", `学习状态 · ${TRIGGER_LABELS[guidedState.trigger] || guidedState.trigger}`),
      element("h5", "", guidedState.label)
    );
    const target = element(
      "button",
      "material-target-chip",
      cue ? `${cue.type} · ${guidedState.focus_target}` : guidedState.focus_target
    );
    target.type = "button";
    target.addEventListener("click", () =>
      applyTarget(guidedState.focus_target)
    );
    top.append(stateCopy, target);

    const teacher = element("div", "material-koji-message is-teacher");
    teacher.append(
      icon("sparkles"),
      element("span", "", guidedState.teacher_move)
    );
    const learner = element("div", "material-koji-message is-learner");
    learner.append(
      icon("message-circle-question"),
      element("span", "", guidedState.learner_prompt)
    );
    const actions = element("div", "material-koji-actions");
    const helpButton = element("button", "", "我还不懂");
    helpButton.type = "button";
    const understoodButton = element("button", "", "我明白了");
    understoodButton.type = "button";
    const hintPanel = element("div", "material-koji-hint");
    hintPanel.setAttribute("role", "status");
    hintPanel.setAttribute("aria-live", "polite");

    helpButton.addEventListener("click", () => {
      const nextHint = hintSet[Math.min(hintLevel, hintSet.length - 1)];
      if (!nextHint) {
        hintPanel.textContent = "当前素材没有更多提示。";
        return;
      }
      hintLevel += 1;
      hintPanel.replaceChildren(
        element("small", "", `第 ${nextHint.level} 层提示 · 不揭示答案`),
        element("p", "", nextHint.text)
      );
      hintPanel.hidden = false;
      applyTarget(nextHint.focus_target);
      helpButton.textContent =
        hintLevel < hintSet.length ? "再给一点提示" : "已到最深提示";
      helpButton.disabled = hintLevel >= hintSet.length;
    });
    understoodButton.addEventListener("click", () => {
      const next =
        states.find((item) => item.id === currentState.transition_to) ||
        states.find((item) => item.trigger === "progress") ||
        states.find((item) => item.trigger === "success");
      if (next && next !== currentState) renderState(next);
    });
    actions.append(helpButton, understoodButton);
    hintPanel.hidden = true;
    stage.replaceChildren(top, teacher, learner, hintPanel, actions);
    if (focusTarget) applyTarget(guidedState.focus_target);
    refreshIcons();
  };

  states.forEach((guidedState) => {
    const button = element(
      "button",
      "material-koji-trigger",
      TRIGGER_LABELS[guidedState.trigger] || guidedState.label
    );
    button.type = "button";
    button.dataset.stateId = guidedState.id;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => renderState(guidedState));
    buttons.push(button);
    triggerRow.append(button);
  });
  renderState(states[0], { focusTarget: false });
  if (states[0]) {
    interaction.afterMount(() => applyTarget(currentState?.focus_target));
  }
  control.append(triggerRow, stage);
  body.append(
    control,
    createProtocolFoot(
      `${states.length} 状态 · ${hintSet.length} 层提示 · 原创实现`
    )
  );
  return card;
}

function renderOpenMAIC(data = {}, bundle, context, interaction) {
  const { card, body } = createTechniqueCard(TECHNIQUES[2], "DSL 已校验");
  const scenes = Array.isArray(data.scenes) ? data.scenes : [];
  const outlines = Array.isArray(data.outlines) ? data.outlines : [];
  const timeline = Array.isArray(data.presentation_timeline)
    ? data.presentation_timeline
    : [];
  const quiz = data.quiz || {};
  const tabs = element("div", "material-scene-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "课堂场景");
  const preview = element("section", "material-scene-player");
  const tabGroupId = nextMaterialDomId("material-scene");
  preview.id = `${tabGroupId}-panel`;
  preview.setAttribute("role", "tabpanel");
  preview.tabIndex = 0;
  const sceneButtons = [];
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  const targetToScene = new Map();
  scenes.forEach((scene) => {
    (scene.elements || []).forEach((sceneElement) => {
      if (!targetToScene.has(sceneElement.id)) {
        targetToScene.set(sceneElement.id, scene.id);
      }
    });
    if (scene.type === "quiz" && quiz.question_id) {
      targetToScene.set(`quiz:${quiz.question_id}`, scene.id);
      (quiz.options || []).forEach((option) => {
        targetToScene.set(`option:${option.id}`, scene.id);
      });
    }
  });
  let stopPlayback = () => {};
  let currentSceneId = "";

  const renderScene = (scene) => {
    stopPlayback();
    currentSceneId = scene.id;
    sceneButtons.forEach((button) => {
      const active = button.dataset.sceneId === scene.id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active) preview.setAttribute("aria-labelledby", button.id);
    });
    const relatedOutline = outlines.find(
      (outline) => outline.id === scene.outline_id
    );
    const head = element("header", "material-scene-player-head");
    const title = element("div");
    title.append(
      element("small", "", relatedOutline?.objective || scene.type),
      element("h5", "", scene.title)
    );
    const playbackButton = element("button", "material-playback-button");
    playbackButton.type = "button";
    playbackButton.setAttribute("aria-pressed", "false");
    playbackButton.append(icon("play"), document.createTextNode("播放讲解"));
    head.append(title, playbackButton);

    const sceneCanvas = element("div", "material-scene-canvas");
    (scene.elements || []).forEach((sceneElement) => {
      sceneCanvas.append(renderSceneElement(sceneElement));
    });
    if (scene.type === "quiz" && quiz.question_id) {
      sceneCanvas.append(renderQuiz(quiz, bundle.bundle_id));
    }

    const narration = element(
      "div",
      "material-playback-narration",
      scene.summary
    );
    narration.setAttribute("role", "status");
    narration.setAttribute("aria-live", "polite");
    const sceneActions = timeline
      .map(normalizeOpenMaicTimelineAction)
      .filter((action) => action.scene_id === scene.id)
      .sort((left, right) => left.order - right.order);
    playbackButton.disabled = sceneActions.length === 0;
    let timer = 0;
    let running = false;
    let actionIndex = 0;

    const clearTarget = () => {
      sceneCanvas
        .querySelectorAll(".is-timeline-active")
        .forEach((node) => node.classList.remove("is-timeline-active"));
    };
    const finish = () => {
      running = false;
      window.clearTimeout(timer);
      clearTarget();
      playbackButton.setAttribute("aria-pressed", "false");
      playbackButton.replaceChildren(
        icon("rotate-ccw"),
        document.createTextNode("重新播放")
      );
      refreshIcons();
    };
    const playNext = () => {
      if (!running) return;
      const action = sceneActions[actionIndex];
      if (!action) {
        finish();
        return;
      }
      clearTarget();
      const target = [...sceneCanvas.querySelectorAll("[data-material-target]")]
        .find((node) => node.dataset.materialTarget === action.target_id);
      target?.classList.add("is-timeline-active");
      if (action.type === "set_state" && target) {
        applySceneState(target, action.state);
      }
      narration.replaceChildren(
        element(
          "small",
          "",
          `${ACTION_LABELS[action.type] || action.type} · ${actionIndex + 1}/${sceneActions.length}`
        ),
        element("span", "", action.narration)
      );
      actionIndex += 1;
      timer = window.setTimeout(
        playNext,
        Math.min(2400, Math.max(600, action.duration_ms || 1100))
      );
    };
    playbackButton.addEventListener("click", () => {
      if (running) {
        stopPlayback();
        return;
      }
      actionIndex = 0;
      running = true;
      playbackButton.setAttribute("aria-pressed", "true");
      playbackButton.replaceChildren(
        icon("pause"),
        document.createTextNode("暂停")
      );
      playNext();
      refreshIcons();
    });
    stopPlayback = () => {
      running = false;
      window.clearTimeout(timer);
      clearTarget();
      playbackButton.setAttribute("aria-pressed", "false");
      playbackButton.replaceChildren(
        icon("play"),
        document.createTextNode("播放讲解")
      );
      refreshIcons();
    };
    preview.replaceChildren(head, sceneCanvas, narration);
    refreshIcons();
  };

  scenes.forEach((scene, index) => {
    const button = element(
      "button",
      `material-scene-tab${index === 0 ? " is-active" : ""}`,
      scene.title
    );
    button.type = "button";
    button.dataset.sceneId = scene.id;
    button.id = `${tabGroupId}-tab-${index + 1}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === 0));
    button.setAttribute("aria-controls", preview.id);
    button.tabIndex = index === 0 ? 0 : -1;
    button.addEventListener("click", () => renderScene(scene));
    button.addEventListener("keydown", (event) => {
      handleRovingTabKeydown(event, sceneButtons);
    });
    tabs.append(button);
    sceneButtons.push(button);
  });
  if (scenes[0]) renderScene(scenes[0]);
  else {
    preview.append(
      element("p", "material-inline-empty", "OpenMAIC 适配器未返回课堂场景")
    );
  }

  const controller = {
    focusTarget(targetId) {
      const sceneId = targetToScene.get(targetId);
      const scene = scenesById.get(sceneId);
      if (!scene) return false;
      if (currentSceneId !== sceneId) renderScene(scene);
      return focusMaterialTarget(preview, targetId);
    }
  };
  interaction.setOpenMaicController(controller);
  context.registerDisposer(() => stopPlayback());
  body.append(
    tabs,
    preview,
    createProtocolFoot(
      `${scenes.length} Scene · ${timeline.length} Action · @openmaic/dsl`
    )
  );
  return card;
}

function renderSceneElement(sceneElement) {
  const item = element(
    "section",
    `material-scene-element is-${sceneElement.kind || "text"}`
  );
  item.dataset.materialTarget = sceneElement.id;
  const head = element("header");
  head.append(
    element("small", "", sceneElement.kind || "element"),
    element("b", "", sceneElement.label)
  );
  item.append(head, element("p", "", sceneElement.content));

  if (sceneElement.kind === "control") {
    const data = sceneElement.data || {};
    const min = finiteOr(data.min, 0);
    const max = finiteOr(data.max, 100);
    const value = Math.min(max, Math.max(min, finiteOr(data.value, (min + max) / 2)));
    const control = element("label", "material-simulation-control");
    const output = element("output", "", String(value));
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(Math.max(0.01, finiteOr(data.step, 1)));
    input.value = String(value);
    input.setAttribute("aria-label", sceneElement.label || "调整参数");
    input.addEventListener("input", () => {
      output.value = input.value;
      output.textContent = input.value;
    });
    control.append(input, output);
    item.append(control);
  }
  return item;
}

function applySceneState(target, state) {
  if (!state || typeof state !== "object") return;
  const input = target.querySelector('input[type="range"]');
  const nextValue = Number(state.value ?? state.current ?? state.level);
  if (input && Number.isFinite(nextValue)) {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function renderQuiz(quiz, bundleId) {
  const panel = element("section", "material-quiz");
  panel.dataset.materialTarget = `quiz:${quiz.question_id}`;
  panel.append(
    element("small", "", quiz.title || "随堂练习"),
    element("h5", "", quiz.prompt)
  );
  const options = element("div", "material-quiz-options");
  options.setAttribute("role", "group");
  options.setAttribute("aria-label", quiz.prompt || "单项选择题");
  const feedback = element("div", "material-quiz-feedback");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  feedback.hidden = true;
  const optionButtons = [];
  (quiz.options || []).forEach((option) => {
    const button = element("button", "material-quiz-option");
    button.type = "button";
    button.dataset.materialTarget = `option:${option.id}`;
    button.setAttribute("aria-pressed", "false");
    button.append(
      element("b", "", option.id),
      element("span", "", option.label)
    );
    button.addEventListener("click", async () => {
      optionButtons.forEach((item) => {
        item.disabled = true;
        item.classList.toggle("is-selected", item === button);
        item.classList.remove("is-correct", "is-incorrect");
        item.setAttribute("aria-pressed", String(item === button));
      });
      feedback.hidden = false;
      feedback.className = "material-quiz-feedback is-loading";
      feedback.textContent = "正在由服务端可信判题…";
      try {
        const response = await fetch("/api/knowledge/materials/grade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bundle_id: bundleId,
            question_id: quiz.question_id,
            selected: option.value
          })
        });
        const result = await readJsonResponse(response);
        if (!response.ok) {
          const gradeError = new Error(result.message || "判题失败");
          gradeError.code = result.error;
          throw gradeError;
        }
        const canRetry =
          !result.correct && Number(result.attempts_remaining) > 0;
        button.classList.add(result.correct ? "is-correct" : "is-incorrect");
        feedback.className = `material-quiz-feedback ${
          result.correct ? "is-correct" : "is-incorrect"
        }`;
        feedback.replaceChildren(
          element(
            "b",
            "",
            result.correct
              ? "回答正确"
              : canRetry
                ? "再想一想"
                : "本题作答结束"
          ),
          element(
            "span",
            "",
            result.correct
              ? result.explanation || quiz.hint || ""
              : quiz.hint || "换一个思路，再试一次。"
          )
        );
        if (canRetry) {
          optionButtons.forEach((item) => {
            item.disabled = false;
          });
        }
      } catch (error) {
        feedback.className = "material-quiz-feedback is-error";
        feedback.textContent = error?.message || "判题服务暂不可用";
        if (error?.code !== "question_closed") {
          optionButtons.forEach((item) => {
            item.disabled = false;
          });
        }
      }
    });
    optionButtons.push(button);
    options.append(button);
  });
  panel.append(options, feedback);
  return panel;
}

function renderCellStudio(data = {}, bundle, context) {
  const { card, body } = createTechniqueCard(TECHNIQUES[3], "WebGL 实景");
  const scene = data.spatial_scene || {};
  const nodes = Array.isArray(scene.nodes) ? scene.nodes : [];
  const explorer = element("section", "material-spatial-explorer");
  const viewport = element("div", "material-spatial-viewport");
  const viewerHost = element("div", "material-spatial-viewer-host");
  viewport.setAttribute("aria-label", scene.title || "3D 知识结构");
  viewport.append(viewerHost);

  const side = element("aside", "material-spatial-side");
  const nodeList = element("div", "material-spatial-node-list");
  const detail = element("section", "material-focus-panel");
  const nodeButtons = [];
  let viewer = null;
  let disposed = false;

  const selectNode = (node) => {
    if (!node) return;
    nodeButtons.forEach((button) =>
      button.classList.toggle("is-active", button.dataset.nodeId === node.id)
    );
    const header = element("header");
    header.append(
      icon("focus"),
      element("h5", "", node.label)
    );
    const kind = element("small", "", `${node.kind || "structure"} · ${node.claim_ids?.length || 0} 个事实绑定`);
    detail.replaceChildren(
      header,
      kind,
      element("p", "", node.description)
    );
    refreshIcons();
  };

  nodes.forEach((node) => {
    const button = element("button", "material-hotspot-button", node.label);
    button.type = "button";
    button.dataset.nodeId = node.id;
    button.dataset.materialTarget = node.id;
    button.addEventListener("click", () => {
      selectNode(node);
      viewer?.select?.(node.id);
    });
    nodeButtons.push(button);
    nodeList.append(button);
  });
  if (nodes[0]) selectNode(nodes[0]);
  side.append(
    element("small", "material-spatial-help", "拖拽旋转 · 滚轮缩放 · 点击结构聚焦"),
    nodeList,
    detail
  );
  explorer.append(viewport, side);
  body.append(
    explorer,
    createProtocolFoot(
      `${nodes.length} 个语义部件 · Three.js 0.181.2 · MIT 适配`
    )
  );

  context.registerDisposer(() => {
    disposed = true;
    viewer?.destroy?.();
  });
  queueMicrotask(async () => {
    try {
      viewer = await mountKnowledgeSpatialViewer(viewerHost, scene, {
        autoRotate: true,
        minHeight: 300,
        onSelect(node) {
          const selected =
            typeof node === "string"
              ? nodes.find((item) => item.id === node)
              : node;
          if (selected) selectNode(selected);
        }
      });
      if (disposed) {
        viewer?.destroy?.();
        return;
      }
    } catch (error) {
      if (disposed) return;
      viewport.classList.add("is-webgl-error");
      viewerHost.append(
        element(
          "p",
          "material-inline-empty",
          `3D 场景初始化失败：${error?.message || "浏览器不支持 WebGL"}`
        )
      );
    }
    refreshIcons();
  });
  return card;
}

function createLocalTabs(items) {
  const root = element("section", "material-local-tabs");
  const tablist = element("div", "material-local-tablist");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "素材视图");
  const content = element("div", "material-local-tab-content");
  const tabGroupId = nextMaterialDomId("material-local");
  content.id = `${tabGroupId}-panel`;
  content.setAttribute("role", "tabpanel");
  content.tabIndex = 0;
  const buttons = [];
  const select = (item) => {
    buttons.forEach((button) => {
      const active = button.dataset.tabId === item.id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active) content.setAttribute("aria-labelledby", button.id);
    });
    content.replaceChildren(item.render());
  };
  items.forEach((item, index) => {
    const button = element(
      "button",
      `material-local-tab${index === 0 ? " is-active" : ""}`,
      item.label
    );
    button.type = "button";
    button.dataset.tabId = item.id;
    button.id = `${tabGroupId}-tab-${index + 1}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === 0));
    button.setAttribute("aria-controls", content.id);
    button.tabIndex = index === 0 ? 0 : -1;
    button.addEventListener("click", () => select(item));
    button.addEventListener("keydown", (event) => {
      handleRovingTabKeydown(event, buttons);
    });
    buttons.push(button);
    tablist.append(button);
  });
  if (items[0]) select(items[0]);
  root.append(tablist, content);
  return root;
}

function handleRovingTabKeydown(event, buttons) {
  const currentIndex = buttons.indexOf(event.currentTarget);
  if (currentIndex < 0 || buttons.length < 2) return;
  let nextIndex = currentIndex;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % buttons.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = buttons.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  buttons[nextIndex].focus();
  buttons[nextIndex].click();
}

function nextMaterialDomId(prefix) {
  materialDomIdSequence += 1;
  return `${prefix}-${materialDomIdSequence}`;
}

function createTechniqueCard(technique, statusText) {
  const card = element("article", "material-tech-card");
  card.dataset.technique = technique.key;
  const head = element("header", "material-tech-card-head");
  const iconWrap = element("span", "material-tech-card-icon");
  iconWrap.append(icon(technique.icon));
  const copy = element("div", "material-tech-card-copy");
  copy.append(
    element("h4", "", technique.name),
    element("p", "", technique.subtitle)
  );
  const meta = element("div", "material-tech-card-meta");
  meta.append(
    element("span", "material-tech-tag", technique.technology),
    element("small", "", statusText)
  );
  head.append(iconWrap, copy, meta);
  const body = element("div", "material-tech-body");
  card.append(head, body);
  return { card, body };
}

function createProtocolFoot(statusText) {
  const foot = element("footer", "material-card-foot");
  const protocol = element("span");
  protocol.append(
    icon("badge-check"),
    document.createTextNode("A2UI v0.9")
  );
  foot.append(protocol, element("span", "", statusText));
  return foot;
}

function createNativeSourceFoot(sourceText, statusText) {
  const foot = element("footer", "material-card-foot is-native-source");
  const source = element("span");
  source.append(
    icon("cpu"),
    document.createTextNode(sourceText)
  );
  foot.append(source, element("span", "", statusText));
  return foot;
}

function createTechniqueFoot(technique, statusText) {
  return technique.native
    ? createNativeSourceFoot(
        `${technique.technology} · ${technique.license}`,
        statusText
      )
    : createProtocolFoot(statusText);
}

function focusMaterialTarget(root, targetId) {
  const targets = [...root.querySelectorAll("[data-material-target]")];
  targets.forEach((node) => {
    const active = Boolean(targetId) && node.dataset.materialTarget === targetId;
    node.classList.toggle("is-guidance-focus", active);
  });
  const target = targets.find(
    (node) => node.dataset.materialTarget === targetId
  );
  const view = root.ownerDocument?.defaultView || window;
  const reduceMotion = Boolean(
    view.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  );
  if (target && !reduceMotion) {
    target.animate?.(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.018)" },
        { transform: "scale(1)" }
      ],
      { duration: 520, easing: "ease-out" }
    );
  }
  return Boolean(target);
}

function setStatus(target, state, message) {
  target.classList.remove("is-loading", "is-success", "is-error");
  if (state !== "idle") target.classList.add(`is-${state}`);
  const dot = element("span");
  target.replaceChildren(dot, document.createTextNode(message));
}

function replaceButtonLabel(button, label) {
  const loadingIcon = icon("loader-circle");
  loadingIcon.classList.add("is-spinning");
  button.replaceChildren(loadingIcon, element("span", "", label));
  refreshIcons();
}

function buildTitle(content) {
  const candidate = String(content)
    .split(/(?<=[。！？.!?])/u)[0]
    .replace(/[。！？.!?]+$/g, "")
    .trim();
  return candidate.slice(0, 48) || "知识点素材";
}

export function createKnowledgeMaterialNdjsonParser(options = {}) {
  const maxLineLength = normalizePositiveInteger(
    options.maxLineLength,
    MATERIAL_TRACE_LIMITS.maxNdjsonLine
  );
  const maxMessages = normalizePositiveInteger(
    options.maxMessages,
    MATERIAL_TRACE_LIMITS.maxWireMessages
  );
  let buffer = "";
  let messageCount = 0;
  let finished = false;

  const parseLine = (line) => {
    const normalized = line.trim();
    if (!normalized) return null;
    if (normalized.length > maxLineLength) {
      throw materialTraceProtocolError(
        "trace_line_too_large",
        "生成 Trace 单条消息超过安全限制"
      );
    }
    messageCount += 1;
    if (messageCount > maxMessages) {
      throw materialTraceProtocolError(
        "trace_message_limit_exceeded",
        "生成 Trace 消息数量超过安全限制"
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(normalized);
    } catch {
      throw materialTraceProtocolError(
        "invalid_trace_ndjson",
        "生成 Trace 包含无法解析的 NDJSON"
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw materialTraceProtocolError(
        "invalid_trace_message",
        "生成 Trace 消息结构无效"
      );
    }
    return parsed;
  };

  const drain = ({ flush = false } = {}) => {
    if (finished) {
      throw materialTraceProtocolError(
        "trace_parser_closed",
        "生成 Trace 解析器已关闭"
      );
    }
    const messages = [];
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/u, "");
      buffer = buffer.slice(newlineIndex + 1);
      const parsed = parseLine(line);
      if (parsed) messages.push(parsed);
      newlineIndex = buffer.indexOf("\n");
    }
    if (buffer.length > maxLineLength) {
      throw materialTraceProtocolError(
        "trace_line_too_large",
        "生成 Trace 单条消息超过安全限制"
      );
    }
    if (flush) {
      const parsed = parseLine(buffer.replace(/\r$/u, ""));
      if (parsed) messages.push(parsed);
      buffer = "";
      finished = true;
    }
    return messages;
  };

  return {
    push(chunk) {
      if (finished) {
        throw materialTraceProtocolError(
          "trace_parser_closed",
          "生成 Trace 解析器已关闭"
        );
      }
      buffer += String(chunk ?? "");
      return drain();
    },
    finish() {
      return drain({ flush: true });
    }
  };
}

export async function readKnowledgeMaterialTraceStream(
  response,
  { onTrace, signal, parserOptions } = {}
) {
  const parser = createKnowledgeMaterialNdjsonParser(parserOptions);
  let terminal = null;

  const acceptMessage = (message) => {
    if (message.type === "trace") {
      if (!terminal && message.event && typeof message.event === "object") {
        try {
          onTrace?.(message.event);
        } catch {
          // Trace rendering is diagnostic and must never break generation.
        }
      }
      return;
    }
    if (message.type === "result" || message.type === "error") {
      if (terminal) {
        throw materialTraceProtocolError(
          "multiple_trace_terminals",
          "生成 Trace 返回了多个终态"
        );
      }
      terminal = message;
      return;
    }
    if (!terminal && typeof message.error === "string") {
      terminal = {
        type: "error",
        status: response?.status,
        error: message.error,
        message: message.message
      };
    }
  };

  const acceptMessages = (messages) => {
    messages.forEach(acceptMessage);
  };

  throwIfMaterialTraceAborted(signal);
  const reader = response?.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    acceptMessages(parser.push(text));
    acceptMessages(parser.finish());
    return terminal;
  }

  const decoder = new TextDecoder();
  try {
    while (true) {
      throwIfMaterialTraceAborted(signal);
      const { value, done } = await reader.read();
      if (done) break;
      acceptMessages(
        parser.push(decoder.decode(value, { stream: true }))
      );
    }
    acceptMessages(parser.push(decoder.decode()));
    acceptMessages(parser.finish());
    return terminal;
  } finally {
    reader.releaseLock?.();
  }
}

function createMaterialTraceController({
  panel,
  headline,
  count,
  elapsed,
  steps,
  outputs,
  copyButton,
  live
}) {
  const ready = Boolean(
    panel &&
      headline &&
      count &&
      elapsed &&
      steps &&
      outputs &&
      copyButton
  );
  if (!ready) {
    const noop = () => {};
    return {
      start: noop,
      reset: noop,
      ingest: noop,
      recordClientEvent: noop,
      complete: noop,
      fail: noop,
      cancel: noop,
      destroy: noop
    };
  }

  const stageRecords = new Map();
  const outputRecords = new Map();
  let startedAt = 0;
  let authoritativeElapsed = 0;
  let eventCount = 0;
  let lastServerSequence = -1;
  let totalOutputLength = 0;
  let traceTimer = 0;
  let copyResetTimer = 0;
  let currentTechnology = "";
  let traceTruncated = false;
  let destroyed = false;

  const view = panel.ownerDocument?.defaultView || window;
  const copyLabel =
    copyButton.querySelector("span") || copyButton;

  const nowElapsed = () =>
    startedAt > 0
      ? Math.max(
          authoritativeElapsed,
          Math.round(view.performance.now() - startedAt)
        )
      : authoritativeElapsed;

  const stopTimer = () => {
    view.clearInterval(traceTimer);
    traceTimer = 0;
  };

  const updateElapsed = () => {
    elapsed.textContent = formatTraceDuration(nowElapsed());
  };

  const announce = (message) => {
    if (live) live.textContent = safeTraceText(message, 220);
  };

  const updateCount = () => {
    const records = [...stageRecords.values()];
    const completed = records.filter((record) =>
      ["success", "error", "cancelled"].includes(record.status)
    ).length;
    count.textContent = traceTruncated
      ? `${completed} / ${records.length} · ${MATERIAL_TRACE_LIMITS.maxEvents}+`
      : `${completed} / ${records.length}`;
  };

  const createStageRecord = (key) => {
    const item = element("li", "material-trace-step");
    item.dataset.status = "pending";
    const marker = element("span", "material-trace-step-marker");
    marker.setAttribute("aria-hidden", "true");
    const copy = element("div", "material-trace-step-copy");
    const title = element("b", "", humanizeTraceStage(key));
    const message = element("p", "", "等待执行");
    copy.append(title, message);
    const time = element("time", "", "+00:00");
    item.append(marker, copy, time);
    steps.append(item);
    const record = {
      key,
      item,
      title,
      message,
      time,
      status: "pending",
      elapsedMs: 0
    };
    stageRecords.set(key, record);
    return record;
  };

  const normalizeEvent = (event) => {
    const sequence = Number(event?.sequence);
    const elapsedMs = normalizeTraceElapsed(event?.elapsed_ms);
    const callId = safeTraceIdentifier(event?.call_id, "");
    const type = safeTraceIdentifier(event?.type, "trace");
    const stage = safeTraceIdentifier(
      event?.stage,
      callId ? `model.${callId}` : type
    );
    const meta =
      event?.meta &&
      typeof event.meta === "object" &&
      !Array.isArray(event.meta)
        ? event.meta
        : {};
    const metaMessage = summarizeTraceMeta(event?.meta);
    return {
      sequence: Number.isSafeInteger(sequence) ? sequence : null,
      elapsedMs,
      callId,
      attempt: normalizePositiveInteger(meta.attempt, 0),
      nextAttempt: normalizePositiveInteger(meta.next_attempt, 0),
      discarded: meta.discarded === true,
      delta:
        typeof event?.delta === "string" ? event.delta : "",
      type,
      stage,
      status: normalizeTraceStatus(event?.status),
      hasStageSignal: Boolean(
        type !== "model.delta" &&
        (event?.title || event?.message || event?.status)
      ),
      title: safeTraceText(
        event?.title || humanizeTraceStage(stage),
        100
      ),
      message: safeTraceText(
        event?.message || metaMessage,
        320
      )
    };
  };

  const updateStage = (normalized) => {
    const key = normalized.stage || normalized.type;
    const record = stageRecords.get(key) || createStageRecord(key);
    record.status = normalized.status;
    record.elapsedMs = Math.max(
      record.elapsedMs,
      normalized.elapsedMs || nowElapsed()
    );
    record.item.dataset.status = record.status;
    record.item.toggleAttribute(
      "aria-current",
      ["running", "streaming", "retrying"].includes(record.status)
    );
    record.title.textContent = normalized.title;
    record.message.textContent =
      normalized.message ||
      traceStatusLabel(normalized.status);
    record.time.textContent = `+${formatTraceDuration(record.elapsedMs)}`;
    headline.textContent = normalized.title;
    panel.dataset.status = normalized.status;
    authoritativeElapsed = Math.max(
      authoritativeElapsed,
      normalized.elapsedMs
    );
    updateElapsed();
    updateCount();
    announce(
      `${normalized.title}：${
        normalized.message || traceStatusLabel(normalized.status)
      }`
    );
  };

  const markOutputTruncated = (record, reason) => {
    if (record.truncated) return;
    record.truncated = true;
    record.pre.append(
      panel.ownerDocument.createTextNode(
        `\n\n[${reason}，后续内容未显示]\n`
      )
    );
    record.count.textContent = `${record.length.toLocaleString()}+ 字符`;
  };

  const createOutputRecord = (callId) => {
    if (outputRecords.size >= MATERIAL_TRACE_LIMITS.maxCalls) {
      return null;
    }
    const group = element("details", "material-trace-call");
    group.open = true;
    const summary = document.createElement("summary");
    const name = element(
      "b",
      "",
      `模型调用 ${String(outputRecords.size + 1).padStart(2, "0")}`
    );
    const id = element("code", "", callId);
    const outputCount = element("small", "", "0 字符");
    summary.append(name, id, outputCount);
    const pre = document.createElement("pre");
    pre.setAttribute("aria-label", `模型调用 ${callId} 的流式输出`);
    group.append(summary, pre);
    outputs.append(group);
    const record = {
      callId,
      group,
      pre,
      count: outputCount,
      length: 0,
      attempt: 0,
      truncated: false
    };
    outputRecords.set(callId, record);
    return record;
  };

  const appendOutputText = (record, text) => {
    if (!record || record.truncated || !text) return;
    const callRemaining =
      MATERIAL_TRACE_LIMITS.maxOutputPerCall - record.length;
    const totalRemaining =
      MATERIAL_TRACE_LIMITS.maxTotalOutput - totalOutputLength;
    const allowed = Math.max(
      0,
      Math.min(callRemaining, totalRemaining, text.length)
    );
    if (allowed > 0) {
      const visibleText = text.slice(0, allowed);
      record.pre.append(
        panel.ownerDocument.createTextNode(visibleText)
      );
      record.length += visibleText.length;
      totalOutputLength += visibleText.length;
      record.count.textContent = `${record.length.toLocaleString()} 字符`;
      record.pre.scrollTop = record.pre.scrollHeight;
    }
    if (allowed < text.length || callRemaining <= allowed) {
      markOutputTruncated(
        record,
        totalRemaining <= allowed
          ? "Trace 模型输出达到总安全上限"
          : "单次模型输出达到 120k 字符上限"
      );
    }
  };

  const ensureOutputAttempt = (callId, attempt) => {
    if (!callId) return null;
    const record =
      outputRecords.get(callId) ||
      createOutputRecord(callId);
    if (!record) return null;
    if (attempt > 0 && record.attempt !== attempt) {
      appendOutputText(
        record,
        `${record.length ? "\n\n" : ""}──────── 第 ${attempt} 次尝试 ────────\n`
      );
      record.attempt = attempt;
    }
    return record;
  };

  const markDiscardedAttempt = (normalized) => {
    if (!normalized.callId || !normalized.discarded) return;
    const record = ensureOutputAttempt(
      normalized.callId,
      normalized.attempt
    );
    if (!record) return;
    const nextAttempt =
      normalized.nextAttempt ||
      (normalized.attempt > 0 ? normalized.attempt + 1 : 0);
    const reason =
      normalized.type === "model.schema_fallback"
        ? "结构化格式回退"
        : "请求重试";
    appendOutputText(
      record,
      `\n\n[第 ${normalized.attempt || "当前"} 次尝试未被采用 · ${reason}${
        nextAttempt ? ` · 下一次为第 ${nextAttempt} 次` : ""
      }]\n`
    );
  };

  const appendDelta = (callId, delta, attempt) => {
    if (!callId || !delta) return;
    const record = ensureOutputAttempt(callId, attempt);
    if (!record) return;
    appendOutputText(record, delta);
  };

  const applyEvent = (event, { server = false } = {}) => {
    if (destroyed) return;
    const normalized = normalizeEvent(event);
    const isModelDelta =
      normalized.type === "model.delta" &&
      Boolean(normalized.delta);
    if (server) {
      if (
        normalized.sequence !== null &&
        normalized.sequence <= lastServerSequence
      ) {
        return;
      }
      if (normalized.sequence !== null) {
        lastServerSequence = normalized.sequence;
      }
      if (
        !isModelDelta &&
        eventCount >= MATERIAL_TRACE_LIMITS.maxEvents
      ) {
        if (!traceTruncated) {
          traceTruncated = true;
          headline.textContent =
            `Trace 阶段事件已达到 ${MATERIAL_TRACE_LIMITS.maxEvents} 条，后续阶段已截断`;
          announce(headline.textContent);
          updateCount();
        }
        return;
      }
      if (!isModelDelta) eventCount += 1;
    }
    if (
      normalized.callId &&
      normalized.type === "model.request"
    ) {
      ensureOutputAttempt(normalized.callId, normalized.attempt);
    }
    if (
      normalized.type === "model.retry" ||
      normalized.type === "model.schema_fallback"
    ) {
      markDiscardedAttempt(normalized);
    }
    if (isModelDelta) {
      appendDelta(
        normalized.callId,
        normalized.delta,
        normalized.attempt
      );
    }
    if (
      normalized.hasStageSignal ||
      !isModelDelta ||
      !stageRecords.has(normalized.stage)
    ) {
      updateStage(normalized);
    }
  };

  const reset = () => {
    stopTimer();
    view.clearTimeout(copyResetTimer);
    copyResetTimer = 0;
    stageRecords.clear();
    outputRecords.clear();
    steps.replaceChildren();
    outputs.replaceChildren();
    eventCount = 0;
    totalOutputLength = 0;
    lastServerSequence = -1;
    authoritativeElapsed = 0;
    startedAt = 0;
    currentTechnology = "";
    traceTruncated = false;
    panel.hidden = true;
    panel.open = false;
    panel.dataset.status = "idle";
    headline.textContent = "准备生成";
    count.textContent = "0 / 0";
    elapsed.textContent = "00:00";
    copyLabel.textContent = "复制 Trace";
    if (live) live.textContent = "";
  };

  const start = ({ technology = "", inputLength = 0 } = {}) => {
    reset();
    currentTechnology = safeTraceText(technology, 60);
    panel.hidden = false;
    panel.open = true;
    panel.dataset.status = "running";
    headline.textContent = `${
      currentTechnology || "素材"
    } Trace 已启动`;
    startedAt = view.performance.now();
    traceTimer = view.setInterval(updateElapsed, 250);
    applyEvent({
      type: "client",
      stage: "client.start",
      status: "running",
      title: "开始生成",
      message: `${currentTechnology || "素材"} · ${Math.max(
        0,
        Number(inputLength) || 0
      )} 个字符`,
      elapsed_ms: 0
    });
  };

  const finish = (status, title, message) => {
    stopTimer();
    updateElapsed();
    panel.hidden = false;
    panel.open = true;
    panel.dataset.status = status;
    headline.textContent = title;
    announce(message || title);
  };

  const complete = (bundle, provider) => {
    const execution =
      bundle?.execution && typeof bundle.execution === "object"
        ? bundle.execution
        : {};
    const duration = normalizeTraceElapsed(execution.duration_ms);
    authoritativeElapsed = Math.max(authoritativeElapsed, duration);
    const facts = [
      safeTraceText(execution.native_schema, 80),
      execution.model_used === true ? "模型已调用" : "未调用模型",
      Number.isFinite(Number(execution.private_fields_removed))
        ? `已移除 ${Math.max(
            0,
            Number(execution.private_fields_removed)
          )} 个私密字段`
        : "",
      safeTraceText(provider?.model, 80)
    ].filter(Boolean);
    applyEvent({
      type: "complete",
      stage: "client.complete",
      status: "success",
      title: "生成完成",
      message: facts.join(" · ") || currentTechnology,
      elapsed_ms: nowElapsed()
    });
    finish(
      "success",
      `生成完成 · ${formatTraceDuration(nowElapsed())}`,
      `${currentTechnology || "素材"}生成完成`
    );
  };

  const fail = (message, details = {}) => {
    const safeMessage = safeTraceText(
      message || "生成失败",
      320
    );
    const fact = [
      safeTraceIdentifier(details.code, ""),
      safeTraceIdentifier(details.stage, ""),
      Number.isFinite(Number(details.status))
        ? `HTTP ${Number(details.status)}`
        : ""
    ]
      .filter(Boolean)
      .join(" · ");
    applyEvent({
      type: "error",
      stage: "client.error",
      status: "error",
      title: "生成失败",
      message: fact ? `${safeMessage} · ${fact}` : safeMessage,
      elapsed_ms: nowElapsed()
    });
    finish("error", "生成失败", safeMessage);
  };

  const cancel = () => {
    applyEvent({
      type: "cancelled",
      stage: "client.cancelled",
      status: "cancelled",
      title: "生成已取消",
      message: "请求已终止，未保存 Trace",
      elapsed_ms: nowElapsed()
    });
    finish("cancelled", "生成已取消", "生成已取消");
  };

  const buildCopyText = () => {
    const lines = [
      "知识点素材生成 Trace",
      "本机调试输出，可能包含题目答案",
      `技术：${currentTechnology || "未知"}`,
      `耗时：${formatTraceDuration(nowElapsed())}`,
      "",
      "阶段时间线"
    ];
    stageRecords.forEach((record) => {
      lines.push(
        `[${record.status}] +${formatTraceDuration(
          record.elapsedMs
        )} ${record.title.textContent}`
      );
      if (record.message.textContent) {
        lines.push(`  ${record.message.textContent}`);
      }
    });
    if (outputRecords.size) {
      lines.push("", "模型流式输出");
      outputRecords.forEach((record) => {
        lines.push(
          "",
          `--- call_id: ${record.callId} ---`,
          record.pre.textContent || ""
        );
      });
    }
    if (traceTruncated) {
      lines.push(
        "",
        `[Trace 阶段事件已达到 ${MATERIAL_TRACE_LIMITS.maxEvents} 条上限]`
      );
    }
    return lines.join("\n");
  };

  const handleCopy = async () => {
    const clipboard = view.navigator?.clipboard;
    if (!clipboard?.writeText) {
      copyLabel.textContent = "浏览器不支持复制";
      announce("当前浏览器不支持复制 Trace");
      return;
    }
    try {
      await clipboard.writeText(buildCopyText());
      copyLabel.textContent = "已复制";
      announce("Trace 已复制，内容可能包含题目答案");
      view.clearTimeout(copyResetTimer);
      copyResetTimer = view.setTimeout(() => {
        copyLabel.textContent = "复制 Trace";
      }, 1800);
    } catch {
      copyLabel.textContent = "复制失败";
      announce("复制 Trace 失败");
    }
  };

  copyButton.addEventListener("click", handleCopy);
  reset();

  return {
    start,
    reset,
    ingest(event) {
      applyEvent(event, { server: true });
    },
    recordClientEvent(event) {
      applyEvent(event);
    },
    complete,
    fail,
    cancel,
    destroy() {
      destroyed = true;
      stopTimer();
      view.clearTimeout(copyResetTimer);
      copyButton.removeEventListener("click", handleCopy);
    }
  };
}

function materialTraceProtocolError(code, message) {
  const error = new Error(message);
  error.name = "MaterialTraceProtocolError";
  error.code = code;
  return error;
}

function createMaterialTraceTerminalError(terminal, fallbackStatus) {
  const status = Number.isFinite(Number(terminal?.status))
    ? Number(terminal.status)
    : fallbackStatus;
  const payload = {
    error: safeTraceIdentifier(terminal?.error, ""),
    stage: safeTraceIdentifier(terminal?.stage, ""),
    message: safeTraceText(terminal?.message, 320)
  };
  const error = new Error(publicGenerationError(payload, status));
  error.name = "MaterialTraceTerminalError";
  error.code = payload.error;
  error.stage = payload.stage;
  error.status = status;
  return error;
}

function throwIfMaterialTraceAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("生成已取消");
  error.name = "AbortError";
  throw error;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? number
    : fallback;
}

function normalizeTraceElapsed(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(86_400_000, Math.max(0, Math.round(number)))
    : 0;
}

function normalizeTraceStatus(value) {
  const status = String(value || "")
    .trim()
    .toLowerCase();
  if (MATERIAL_TRACE_STATUS.has(status)) {
    if (status === "completed") return "success";
    if (status === "failed") return "error";
    if (status === "streaming") return "running";
    return status;
  }
  if (["start", "started", "in_progress", "streaming"].includes(status)) {
    return "running";
  }
  if (["done", "complete", "ok"].includes(status)) {
    return "success";
  }
  return "pending";
}

function safeTraceIdentifier(value, fallback = "") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^\p{L}\p{N}._:/-]+/gu, "_")
    .slice(0, 120);
  return normalized || fallback;
}

function safeTraceText(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .slice(0, maxLength);
}

function summarizeTraceMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const allowedKeys = [
    "current",
    "total",
    "index",
    "count",
    "scene_count",
    "chapter_count",
    "page_count",
    "action_count",
    "ai_call_count",
    "model",
    "native_schema",
    "http_status",
    "provider_code",
    "provider_type",
    "provider_param",
    "request_id",
    "duration_ms"
  ];
  return allowedKeys
    .filter((key) => Object.hasOwn(value, key))
    .slice(0, 8)
    .map((key) => `${humanizeTraceStage(key)} ${safeTraceText(value[key], 60)}`)
    .join(" · ");
}

function humanizeTraceStage(value) {
  return String(value || "trace")
    .replace(/[._:/-]+/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function traceStatusLabel(status) {
  const labels = {
    pending: "等待执行",
    running: "执行中",
    retrying: "正在重试",
    fallback: "格式回退",
    warning: "注意",
    info: "信息",
    success: "已完成",
    error: "执行失败",
    cancelled: "已取消"
  };
  return labels[status] || "等待执行";
}

function formatTraceDuration(milliseconds) {
  const totalSeconds = Math.max(
    0,
    Math.floor(normalizeTraceElapsed(milliseconds) / 1000)
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}`;
}

function publicGenerationError(payload, status) {
  if (payload?.error === "ark_not_configured") {
    return "Ark 模型未配置：点击右上角“模型待配置”录入密钥";
  }
  if (payload?.stage) {
    return `真实生成在 ${payload.stage} 阶段未通过：${payload.message || "请重试"}`;
  }
  return payload?.message || `真实生成请求失败（HTTP ${status}）`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: "服务返回了无法解析的响应" };
  }
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function icon(name) {
  const node = document.createElement("i");
  node.dataset.lucide = name;
  node.setAttribute("aria-hidden", "true");
  return node;
}

function refreshIcons() {
  queueMicrotask(() => {
    window.lucide?.createIcons?.({
      attrs: {
        "stroke-width": 1.8
      }
    });
  });
}
