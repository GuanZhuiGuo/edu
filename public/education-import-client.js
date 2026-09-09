const POLL_INTERVAL_MS = 1_200;
const POLL_DEADLINE_MS = 15 * 60_000;
const TASK_CENTER_REFRESH_MS = 2_500;
const TASK_CENTER_RETRY_MS = 10_000;
const TASK_CENTER_LIMIT = 80;
const PUBLICATION_RECEIPT_STORAGE_KEY = "ai-teacher:education-import-publications:v1";

const PHASE_COPY = Object.freeze({
  queued: "等待解析",
  interrupted: "正在恢复任务",
  inspecting: "检查文件",
  native_metadata: "读取 PDF 结构",
  native_text: "提取原始文字",
  rendering_pages: "还原页面版式",
  visual_analysis: "识别题目、图形与手写内容",
  semantic_compilation: "编译知识点、题目映射与关系",
  assembling: "整理知识与题目候选",
  persisting: "保存可追溯结果",
  completed: "解析完成",
  failed: "解析失败",
});

let controllerInstance = null;

export function bindEducationImportWorkspace({
  activateWorkspace,
  setRecordTab,
  showToast,
} = {}) {
  if (controllerInstance) return controllerInstance;
  controllerInstance = createController({ activateWorkspace, setRecordTab, showToast });
  controllerInstance.bindLearningImport();
  controllerInstance.bindCatalogDialog();
  return controllerInstance;
}

function createController({ activateWorkspace, setRecordTab, showToast }) {
  const state = {
    selectedFile: null,
    activeJobId: null,
    pollToken: 0,
    config: null,
    ontologySchema: null,
    catalogJob: null,
    publicationReceipt: null,
    publishedOntology: null,
    catalogTab: "document",
    catalogDetailsOpen: false,
    catalogImportKind: "knowledge",
    catalogJobs: [],
    catalogTaskFilter: "all",
    catalogTaskExpanded: false,
    catalogTaskTimer: null,
    catalogTaskRequestId: 0,
    publicationReceipts: loadPublicationReceipts(),
    questionReviews: new Map(),
    questionReviewRequests: new Map(),
  };
  const notify = (message) => typeof showToast === "function"
    ? showToast(message)
    : undefined;

  function bindLearningImport() {
    const picker = document.querySelector("#learningImportPickerBtn");
    const fileInput = document.querySelector("#learningImportFile");
    const fileName = document.querySelector("#learningImportFileName");
    const start = document.querySelector("#startLearningImportBtn");
    const result = document.querySelector("#learningImportResult");
    if (!picker || !fileInput || !start || !result || picker.dataset.importBound === "true") return;
    picker.dataset.importBound = "true";

    picker.addEventListener("click", () => fileInput.click());
    picker.addEventListener("dragover", (event) => {
      event.preventDefault();
      picker.classList.add("is-dragging");
    });
    picker.addEventListener("dragleave", () => picker.classList.remove("is-dragging"));
    picker.addEventListener("drop", (event) => {
      event.preventDefault();
      picker.classList.remove("is-dragging");
      selectFile(event.dataTransfer?.files?.[0] || null, { fileName, start });
    });
    fileInput.addEventListener("change", () => {
      selectFile(fileInput.files?.[0] || null, { fileName, start });
    });
    start.addEventListener("click", async () => {
      if (!state.selectedFile || start.disabled) return;
      const documentType = document.querySelector("#learningImportDocumentType")?.value || "unknown";
      const subject = document.querySelector("#learningImportSubject")?.value.trim() || "";
      await startUpload({
        file: state.selectedFile,
        documentType,
        subject,
        title: state.selectedFile.name,
        result,
        startButton: start,
      });
    });
    document.querySelector("#loadImportDemoBtn")?.addEventListener("click", () => {
      void loadRecentImports(result);
    });
    result.addEventListener("click", (event) => {
      const reviewButton = event.target.closest("[data-review-import]");
      if (reviewButton) {
        void reviewImport(reviewButton.dataset.reviewImport, result, reviewButton);
        return;
      }
      const jobButton = event.target.closest("[data-open-import-job]");
      if (jobButton) void openExistingJob(jobButton.dataset.openImportJob, result);
    });
    void loadConfig();
  }

  function bindCatalogDialog() {
    const dialog = document.querySelector("#createKnowledgeCatalogDialog");
    const form = document.querySelector("#createKnowledgeCatalogForm");
    const nameInput = document.querySelector("#catalogNameInput");
    const fileInput = document.querySelector("#catalogSourceFile");
    const uploadTitle = document.querySelector("#catalogUploadTitle");
    const workbench = document.querySelector("#catalogImportWorkbench");
    const result = document.querySelector("#catalogImportResult");
    const taskCenter = document.querySelector("#catalogImportTaskCenter");
    const taskList = document.querySelector("#catalogImportTaskList");
    const taskFilter = document.querySelector("#catalogImportTaskFilter");
    const taskCenterButton = document.querySelector("#openCatalogImportTasksBtn");
    const taskExpandButton = document.querySelector("#catalogImportTaskExpandBtn");
    const shelfView = document.querySelector("#knowledgeShelfView");
    const knowledgeField = form.querySelector("[data-catalog-knowledge-field]");
    if (!dialog || !form || form.dataset.importBound === "true") return;
    form.dataset.importBound = "true";

    const selectImportKind = (kind = "knowledge") => {
      const safeKind = ["knowledge", "question_collection", "student_homework", "student_exam"]
        .includes(kind) ? kind : "knowledge";
      const input = form.querySelector(`[name="catalogKind"][value="${safeKind}"]`);
      if (input) input.checked = true;
      state.catalogImportKind = safeKind;
      if (knowledgeField) knowledgeField.hidden = safeKind !== "knowledge";
      const titleInput = form.querySelector("#catalogNameInput");
      if (titleInput) titleInput.placeholder = importTitlePlaceholder(safeKind);
    };

    const openImportDialog = (kind = "knowledge") => {
      selectImportKind(kind);
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      window.setTimeout(() => nameInput?.focus(), 40);
    };

    const setTaskCenterOpen = (open, { focusTrigger = false, scroll = false } = {}) => {
      if (!taskCenter) return;
      state.catalogTaskExpanded = Boolean(open);
      taskCenter.hidden = !open;
      taskCenterButton?.setAttribute("aria-expanded", String(open));
      taskCenterButton?.setAttribute("aria-label", open ? "收起导入任务" : "查看导入任务");
      taskCenterButton?.setAttribute("title", open ? "收起导入任务" : "导入任务");
      shelfView?.classList.toggle("is-task-center-open", open);
      if (open && state.catalogJobs.length) renderCatalogTaskCenter(state);
      if (open && scroll) {
        window.setTimeout(() => taskCenter.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0);
      } else if (!open && focusTrigger) {
        taskCenterButton?.focus({ preventScroll: true });
      }
    };

    setTaskCenterOpen(false);

    document.querySelectorAll("[data-open-education-import]").forEach((button) => {
      button.addEventListener("click", () => openImportDialog(button.dataset.openEducationImport));
    });
    form.querySelector(".catalog-kind-picker")?.addEventListener("change", (event) => {
      if (event.target.matches("[name='catalogKind']")) selectImportKind(event.target.value);
    });
    taskCenterButton?.addEventListener("click", () => {
      const open = Boolean(taskCenter?.hidden);
      setTaskCenterOpen(open, { focusTrigger: !open });
      if (open) void loadCatalogTasks({ announce: false });
    });
    taskCenter?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setTaskCenterOpen(false, { focusTrigger: true });
    });
    document.querySelector("#refreshCatalogImportTasksBtn")?.addEventListener("click", () => {
      void loadCatalogTasks({ announce: true });
    });
    taskFilter?.addEventListener("change", () => {
      state.catalogTaskFilter = taskFilter.value || "all";
      state.catalogTaskExpanded = true;
      renderCatalogTaskCenter(state);
    });
    taskExpandButton?.addEventListener("click", () => {
      state.catalogTaskExpanded = !state.catalogTaskExpanded;
      renderCatalogTaskCenter(state);
    });
    taskList?.addEventListener("click", (event) => {
      const taskButton = event.target.closest("[data-open-catalog-import-job]");
      if (!taskButton) return;
      const jobId = taskButton.dataset.openCatalogImportJob;
      const summary = state.catalogJobs.find((job) => job.id === jobId);
      showCatalogWorkbench(
        workbench,
        result,
        summary?.request?.title || summary?.source?.file_name || "导入任务",
        summary?.request?.document_type,
      );
      state.publicationReceipt = state.publicationReceipts.get(jobId) || null;
      void openExistingJob(jobId, result, { catalogMode: true });
    });
    document.querySelectorAll("[data-close-catalog-dialog]").forEach((button) => {
      button.addEventListener("click", () => dialog.close?.());
    });
    document.querySelector("#closeCatalogImportWorkbench")?.addEventListener("click", () => {
      if (workbench) workbench.hidden = true;
      state.pollToken += 1;
      void loadCatalogTasks({ announce: false });
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close?.();
    });
    fileInput?.addEventListener("change", () => {
      if (uploadTitle) {
        uploadTitle.textContent = fileInput.files?.[0]?.name || "选择大纲或课标文件";
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const file = fileInput?.files?.[0];
      if (!file) return;
      const data = new FormData(form);
      const selectedKind = String(data.get("catalogKind") || "knowledge");
      const kind = selectedKind === "knowledge"
        ? String(data.get("catalogKnowledgeSubtype") || "curriculum_standard")
        : selectedKind;
      dialog.close?.();
      setTaskCenterOpen(true, { scroll: true });
      showCatalogWorkbench(workbench, result, nameInput?.value.trim() || file.name, kind);
      notify(`正在导入“${nameInput?.value.trim() || file.name}”`);
      await startUpload({
        file,
        documentType: kind,
        title: nameInput?.value.trim() || file.name,
        subject: String(data.get("catalogShelf") || ""),
        gradeBand: String(data.get("catalogEdition") || ""),
        result,
        catalogMode: true,
      });
      form.reset();
      selectImportKind("knowledge");
      if (uploadTitle) uploadTitle.textContent = "选择 PDF 或图片";
    });
    result?.addEventListener("click", (event) => {
      const retryImportButton = event.target.closest("[data-reopen-import]");
      if (retryImportButton) {
        openImportDialog(retryImportButton.dataset.reopenImport);
        return;
      }
      const tab = event.target.closest("[data-ontology-tab]");
      if (tab) {
        state.catalogTab = tab.dataset.ontologyTab;
        state.catalogDetailsOpen = true;
        renderCatalogCompleted(result, state.catalogJob, state);
        if (state.catalogTab === "questions" && state.catalogJob?.id) {
          void loadQuestionReview(state.catalogJob.id, result, state, notify);
        }
        return;
      }
      const openButton = event.target.closest("[data-open-import-job]");
      if (openButton) {
        void openExistingJob(openButton.dataset.openImportJob, result, { catalogMode: true });
        return;
      }
      const semanticButton = event.target.closest("[data-resolve-semantic-review]");
      if (semanticButton) {
        void resolveSemanticReview(semanticButton.dataset.resolveSemanticReview, result, semanticButton);
        return;
      }
      const reviewButton = event.target.closest("[data-review-import]");
      if (reviewButton) {
        void reviewImport(reviewButton.dataset.reviewImport, result, reviewButton, { catalogMode: true });
        return;
      }
      const publishButton = event.target.closest("[data-publish-import]");
      if (publishButton) {
        void publishImport(publishButton.dataset.publishImport, result, publishButton);
        return;
      }
      const loadQuestionReviewButton = event.target.closest("[data-load-question-review]");
      if (loadQuestionReviewButton) {
        void loadQuestionReview(
          loadQuestionReviewButton.dataset.loadQuestionReview,
          result,
          state,
          notify,
          { force: true },
        );
        return;
      }
      const reviewBatchButton = event.target.closest("[data-question-review-batch]");
      if (reviewBatchButton) {
        void submitQuestionReviewBatch({
          jobId: reviewBatchButton.dataset.questionReviewJob,
          status: reviewBatchButton.dataset.questionReviewBatch,
          result,
          state,
          notify,
          button: reviewBatchButton,
        });
        return;
      }
      const publishQuestionsButton = event.target.closest("[data-publish-reviewed-questions]");
      if (publishQuestionsButton) {
        void publishReviewedQuestions({
          jobId: publishQuestionsButton.dataset.publishReviewedQuestions,
          result,
          state,
          notify,
          button: publishQuestionsButton,
        });
      }
    });
    result?.addEventListener("toggle", (event) => {
      if (event.target.matches("[data-import-technical-details]")) {
        state.catalogDetailsOpen = event.target.open;
      }
    }, true);
    result?.addEventListener("change", (event) => {
      const selectAll = event.target.closest("[data-question-review-select-all]");
      if (selectAll) {
        result.querySelectorAll("[data-question-review-select]").forEach((checkbox) => {
          checkbox.checked = selectAll.checked;
        });
        updateQuestionReviewSelection(result);
        return;
      }
      const itemSelect = event.target.closest("[data-question-review-select]");
      if (itemSelect) {
        updateQuestionReviewSelection(result);
        return;
      }
      const knowledgeSelect = event.target.closest("[data-question-review-field='canonical_knowledge_point_id']");
      if (knowledgeSelect) {
        updateQuestionReviewCardOptions(knowledgeSelect.closest("[data-question-review-row]"), state);
      }
    });

    document.addEventListener("learning-workspace:change", (event) => {
      if (event.detail?.view === "graph") void loadCatalogTasks({ announce: false });
    });
    document.addEventListener("portal-role:change", (event) => {
      setTaskCenterOpen(false);
      if (event.detail?.role === "teacher") void loadCatalogTasks({ announce: false });
    });
    void loadCatalogTasks({ announce: false });
  }

  function showCatalogWorkbench(workbench, result, title, documentType = "") {
    if (!workbench || !result) return;
    workbench.hidden = false;
    const heading = document.querySelector("#catalogImportWorkbenchTitle");
    const subtitle = document.querySelector("#catalogImportWorkbenchSubtitle");
    if (heading) heading.textContent = title || "导入资料";
    if (subtitle) subtitle.textContent = `${importTargetLabel(documentType)}；任务已保存，可以离开后再回来。`;
    state.catalogJob = null;
    state.publicationReceipt = null;
    state.publishedOntology = null;
    state.catalogTab = "document";
    state.catalogDetailsOpen = false;
    updateCatalogStages("queued");
    window.setTimeout(() => workbench.scrollIntoView?.({ block: "nearest" }), 0);
  }

  async function loadCatalogTasks({ announce = false } = {}) {
    const host = document.querySelector("#catalogImportTaskList");
    if (!host) return;
    const requestId = ++state.catalogTaskRequestId;
    if (!state.catalogJobs.length) {
      host.innerHTML = `<div class="catalog-task-center-message"><i data-lucide="loader-circle"></i><span>正在读取导入任务…</span></div>`;
      refreshIcons();
    }
    try {
      const list = await apiJson(`/api/education/imports?limit=${TASK_CENTER_LIMIT}`);
      if (requestId !== state.catalogTaskRequestId) return;
      state.catalogJobs = Array.isArray(list.jobs) ? list.jobs : [];
      renderCatalogTaskCenter(state, { total: Number(list.total) || state.catalogJobs.length });
      scheduleCatalogTaskRefresh(state.catalogJobs.some(isRunningJob)
        ? TASK_CENTER_REFRESH_MS
        : null);
      if (announce) notify("导入任务已刷新");
    } catch (error) {
      if (requestId !== state.catalogTaskRequestId) return;
      renderCatalogTaskCenterError(error);
      scheduleCatalogTaskRefresh(TASK_CENTER_RETRY_MS);
      if (announce) notify(error.message);
    }
  }

  function scheduleCatalogTaskRefresh(delayMs) {
    if (state.catalogTaskTimer) window.clearTimeout(state.catalogTaskTimer);
    state.catalogTaskTimer = null;
    if (!delayMs) return;
    state.catalogTaskTimer = window.setTimeout(() => {
      state.catalogTaskTimer = null;
      void loadCatalogTasks({ announce: false });
    }, delayMs);
  }

  function upsertCatalogJob(job) {
    if (!job?.id) return;
    const current = state.catalogJobs.findIndex((item) => item.id === job.id);
    if (current >= 0) state.catalogJobs.splice(current, 1, job);
    else state.catalogJobs.unshift(job);
    state.catalogJobs.sort((left, right) => String(right.created_at || "")
      .localeCompare(String(left.created_at || "")));
    renderCatalogTaskCenter(state);
    scheduleCatalogTaskRefresh(state.catalogJobs.some(isRunningJob)
      ? TASK_CENTER_REFRESH_MS
      : null);
  }

  async function loadConfig() {
    try {
      const [config, ontologySchema] = await Promise.all([
        apiJson("/api/education/imports/config"),
        apiJson("/api/education/imports/ontology-schema"),
      ]);
      state.config = config;
      state.ontologySchema = ontologySchema;
      const note = document.querySelector(".import-service-note");
      if (note && state.config.configured !== true) {
        note.classList.add("is-warning");
        note.innerHTML = `<i data-lucide="triangle-alert" aria-hidden="true"></i><span>PDF 原文可以解析；扫描图片需先在服务端配置视觉模型。</span>`;
        refreshIcons();
      }
    } catch {
      // The upload action will surface a concrete error if the service is down.
    }
  }

  function selectFile(file, { fileName, start }) {
    state.selectedFile = file;
    if (fileName) fileName.textContent = file?.name || "选择或拖入文件";
    if (start) start.disabled = !file;
  }

  async function startUpload({
    file,
    documentType,
    title,
    subject,
    gradeBand = "",
    result,
    startButton,
    catalogMode = false,
  }) {
    if (!file || !result) return;
    const formData = new FormData();
    formData.set("file", file, file.name);
    formData.set("document_type", documentType || "unknown");
    formData.set("title", title || file.name);
    formData.set("language", "zh-CN");
    if (subject) formData.set("subject", subject);
    if (gradeBand) formData.set("grade_band", gradeBand);
    // Learner identity must come from the authenticated server session. The
    // browser never asserts tenant_id or learner_id, including in demo mode.
    if (startButton) startButton.disabled = true;
    renderProgress(result, {
      phase: "queued",
      progress: { current_page: 0, total_pages: null, vision_pages: 0 },
      source: { file_name: file.name },
    }, { catalogMode });
    try {
      const job = await apiJson("/api/education/imports", {
        method: "POST",
        body: formData,
      });
      state.activeJobId = job.id;
      if (catalogMode) state.catalogJob = job;
      upsertCatalogJob(job);
      await pollJob(job.id, result, { catalogMode });
    } catch (error) {
      renderError(result, error);
    } finally {
      if (startButton) startButton.disabled = !state.selectedFile;
    }
  }

  async function pollJob(jobId, result, { catalogMode = false } = {}) {
    const token = ++state.pollToken;
    const deadline = Date.now() + POLL_DEADLINE_MS;
    while (token === state.pollToken && Date.now() < deadline) {
      const job = await apiJson(`/api/education/imports/${encodeURIComponent(jobId)}`);
      if (catalogMode) state.catalogJob = job;
      upsertCatalogJob(job);
      if (job.status === "succeeded") {
        if (catalogMode) renderCatalogCompleted(result, job, state);
        else renderCompleted(result, job);
        const semanticStatus = getSemanticStatus(job);
        notify(["partial", "failed", "unconfigured"].includes(semanticStatus)
          ? "原文已解析，语义编译仍需完成"
          : "材料解析完成，候选内容等待确认");
        return job;
      }
      if (job.status === "failed") {
        if (catalogMode) renderCatalogFailed(result, job);
        else renderError(result, new Error(job.error?.message || "材料解析失败"));
        return job;
      }
      renderProgress(result, job, { catalogMode });
      await delay(POLL_INTERVAL_MS);
    }
    if (token === state.pollToken) {
      renderError(result, new Error("任务仍在服务端处理，可稍后从“最近导入”继续查看"));
    }
    return null;
  }

  async function loadRecentImports(result) {
    if (!result) return;
    result.innerHTML = `<div class="import-progress-state"><i data-lucide="loader-circle"></i><b>正在读取最近导入</b></div>`;
    refreshIcons();
    try {
      const list = await apiJson("/api/education/imports?limit=12");
      if (!list.jobs?.length) {
        result.innerHTML = `<div class="import-empty-state"><i data-lucide="folder-open"></i><b>还没有导入记录</b><p>选择一份 PDF 或图片开始建立可追溯内容。</p></div>`;
      } else {
        result.innerHTML = `<div class="import-history-state"><header><b>最近导入</b><span>${list.total} 次</span></header><div class="import-history-list">${list.jobs.map((job) => `
          <button type="button" data-open-import-job="${escapeHTML(job.id)}">
            <span><b>${escapeHTML(job.request?.title || job.source?.file_name || "未命名材料")}</b><small>${escapeHTML(documentTypeLabel(job.request?.document_type))} · ${escapeHTML(formatDateTime(job.created_at))}</small></span>
            <em class="status-${escapeHTML(job.status)}">${escapeHTML(jobStatusLabel(job))}</em>
          </button>`).join("")}</div></div>`;
      }
      refreshIcons();
    } catch (error) {
      renderError(result, error);
    }
  }

  async function openExistingJob(jobId, result, { catalogMode = false } = {}) {
    try {
      const job = await apiJson(`/api/education/imports/${encodeURIComponent(jobId)}`);
      state.activeJobId = job.id;
      if (catalogMode) {
        state.catalogJob = job;
        state.publicationReceipt = state.publicationReceipts.get(job.id) || null;
      }
      upsertCatalogJob(job);
      if (job.status === "succeeded") {
        if (catalogMode) renderCatalogCompleted(result, job, state);
        else renderCompleted(result, job);
      }
      else if (job.status === "failed") {
        if (catalogMode) renderCatalogFailed(result, job);
        else renderError(result, new Error(job.error?.message || "材料解析失败"));
      }
      else await pollJob(job.id, result, { catalogMode });
    } catch (error) {
      renderError(result, error);
    }
  }

  async function reviewImport(jobId, result, button, { catalogMode = false } = {}) {
    if (!jobId || button.disabled) return;
    button.disabled = true;
    button.textContent = "正在保存…";
    try {
      const job = await apiJson(`/api/education/imports/${encodeURIComponent(jobId)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "verified",
          target_type: "pack",
          note: "由导入审核界面确认候选内容",
        }),
      });
      if (catalogMode) {
        state.catalogJob = job;
        renderCatalogCompleted(result, job, state);
      } else renderCompleted(result, job);
      upsertCatalogJob(job);
      notify("候选内容已确认保存；尚未自动改写掌握度");
    } catch (error) {
      button.disabled = false;
      button.textContent = "确认候选";
      notify(error.message);
    }
  }

  async function resolveSemanticReview(jobId, result, button) {
    if (!jobId || button.disabled) return;
    button.disabled = true;
    button.textContent = "正在记录审核…";
    try {
      const job = await apiJson(`/api/education/imports/${encodeURIComponent(jobId)}/semantic-review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          note: "已复核被合同层拦截或跨批次待处理的语义候选，确认它们不作为本次发布事实。",
        }),
      });
      state.catalogJob = job;
      renderCatalogCompleted(result, job, state);
      upsertCatalogJob(job);
      notify("语义待审项已记录，未通过候选不会入图");
    } catch (error) {
      button.disabled = false;
      button.textContent = "确认复核结果";
      notify(error.message);
    }
  }

  async function publishImport(jobId, result, button) {
    if (!jobId || button.disabled) return;
    button.disabled = true;
    button.textContent = "正在写入双库…";
    updateCatalogStages("publishing");
    try {
      state.publicationReceipt = await apiJson(
        `/api/education/imports/${encodeURIComponent(jobId)}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ namespace: "shared_curriculum" }),
        },
      );
      state.publicationReceipts.set(jobId, {
        ...state.publicationReceipt,
        job_id: jobId,
        published_at: new Date().toISOString(),
      });
      persistPublicationReceipts(state.publicationReceipts);
      state.catalogTab = "graph";
      renderCatalogCompleted(result, state.catalogJob, state);
      renderCatalogTaskCenter(state);
      notify("课标本体已发布到向量库与图数据库");
    } catch (error) {
      updateCatalogStages("completed");
      button.disabled = false;
      button.textContent = "发布到知识图谱";
      notify(error.message);
    }
  }

  return { bindLearningImport, bindCatalogDialog, loadRecentImports, openExistingJob };
}

function renderCatalogTaskCenter(state, { total = state.catalogJobs.length } = {}) {
  const host = document.querySelector("#catalogImportTaskList");
  if (!host) return;
  const focusedJobId = document.activeElement
    ?.closest?.("[data-open-catalog-import-job]")
    ?.dataset.openCatalogImportJob || "";
  const jobs = state.catalogJobs.map((job) => ({
    job,
    presentation: deriveEducationImportTaskState(job, {
      published: state.publicationReceipts.has(job.id)
        || Number(state.questionReviews.get(job.id)?.counts?.published || 0) > 0,
    }),
  }));
  const running = jobs.filter(({ job }) => isRunningJob(job)).length;
  const attention = jobs.filter(({ presentation }) => ["review", "partial", "ready", "failed"]
    .includes(presentation.key)).length;
  const published = jobs.filter(({ presentation }) => presentation.key === "published").length;
  const visible = jobs.filter(({ presentation }) => state.catalogTaskFilter === "all"
    || presentation.key === state.catalogTaskFilter);
  const visibleLimit = 3;
  const displayed = state.catalogTaskExpanded ? visible : visible.slice(0, visibleLimit);

  setTextContent("#catalogImportTaskTotal", String(total));
  setTextContent("#catalogImportTaskRunning", String(running));
  setTextContent("#catalogImportTaskAttention", String(attention));
  setTextContent("#catalogImportTaskPublished", String(published));
  const badge = document.querySelector("#catalogImportTaskBadge");
  if (badge) {
    badge.textContent = String(running || total);
    badge.hidden = total === 0;
    badge.classList.toggle("is-live", running > 0);
  }
  const taskCenter = document.querySelector("#catalogImportTaskCenter");
  const expandButton = document.querySelector("#catalogImportTaskExpandBtn");
  taskCenter?.classList.toggle("is-expanded", state.catalogTaskExpanded);
  if (expandButton) {
    const remaining = Math.max(visible.length - visibleLimit, 0);
    expandButton.hidden = visible.length <= visibleLimit;
    expandButton.setAttribute("aria-expanded", String(state.catalogTaskExpanded));
    expandButton.setAttribute(
      "aria-label",
      state.catalogTaskExpanded ? "仅显示最近 3 条导入任务" : `查看其余 ${remaining} 条导入任务`,
    );
    const label = expandButton.querySelector("span");
    if (label) label.textContent = state.catalogTaskExpanded ? "仅看最近 3 条" : `查看全部 ${visible.length}`;
    const icon = expandButton.querySelector("i");
    if (icon) icon.setAttribute("data-lucide", state.catalogTaskExpanded ? "chevrons-up" : "chevrons-down");
  }

  if (!jobs.length) {
    host.innerHTML = `<div class="catalog-task-center-message is-empty"><i data-lucide="inbox"></i><span><b>还没有导入任务</b><small>新建课标或考试大纲后，任务会持续保存在这里。</small></span></div>`;
    refreshIcons();
    return;
  }
  if (!visible.length) {
    host.innerHTML = `<div class="catalog-task-center-message is-empty"><i data-lucide="list-filter"></i><span><b>没有符合当前状态的任务</b><small>可切换为“全部任务”查看历史记录。</small></span></div>`;
    refreshIcons();
    return;
  }

  host.innerHTML = displayed.map(({ job, presentation }) => {
    const progress = calculateEducationImportProgress(job);
    const type = documentTypeLabel(job.request?.document_type);
    const subject = job.request?.subject || job.request?.grade_band || "未设置学科";
    const file = job.source?.file_name || "未命名文件";
    const semanticCompleted = Number(job.progress?.semantic_batches_completed) || 0;
    const semanticTotal = Number(job.progress?.semantic_batches_total) || 0;
    const pageCopy = job.phase === "semantic_compilation" && semanticTotal
      ? `语义批次 ${semanticCompleted}/${semanticTotal}`
      : progress.totalPages
      ? `${progress.currentPage}/${progress.totalPages} 页`
      : presentation.key === "failed"
        ? `停在“${PHASE_COPY[job.phase] || job.phase || "解析"}”`
        : PHASE_COPY[job.phase] || presentation.description;
    return `<button type="button" class="catalog-import-task is-${escapeHTML(presentation.key)}" data-open-catalog-import-job="${escapeHTML(job.id)}" aria-label="查看${escapeHTML(job.request?.title || file)}，${escapeHTML(presentation.label)}">
      <span class="catalog-import-task-top"><em>${escapeHTML(type)}</em><strong>${escapeHTML(presentation.label)}</strong></span>
      <b>${escapeHTML(job.request?.title || file)}</b>
      <small title="${escapeHTML(file)}">${escapeHTML(subject)} · ${escapeHTML(file)} · ${escapeHTML(formatDateTime(job.created_at))}</small>
      <span class="catalog-import-task-progress" aria-label="${escapeHTML(presentation.label)} ${progress.percent}%"><i style="width:${progress.percent}%"></i></span>
      <span class="catalog-import-task-foot"><span>${escapeHTML(pageCopy)}</span><span>查看产物 <i data-lucide="arrow-up-right"></i></span></span>
    </button>`;
  }).join("");
  refreshIcons();
  if (focusedJobId) {
    const focusedTask = [...host.querySelectorAll("[data-open-catalog-import-job]")]
      .find((button) => button.dataset.openCatalogImportJob === focusedJobId);
    focusedTask?.focus({ preventScroll: true });
  }
}

function renderCatalogTaskCenterError(error) {
  const host = document.querySelector("#catalogImportTaskList");
  if (!host) return;
  host.innerHTML = `<div class="catalog-task-center-message is-error"><i data-lucide="cloud-off"></i><span><b>暂时无法读取导入任务</b><small>${escapeHTML(error?.message || "导入服务不可用")}；系统会自动重试。</small></span></div>`;
  refreshIcons();
}

export function deriveEducationImportTaskState(job, { published = false } = {}) {
  if (published || job?.publication?.status === "active"
    || job?.result?.publication?.status === "active") {
    return { key: "published", label: "已发布", description: "已生成活动知识库版本" };
  }
  if (job?.status === "failed") {
    return { key: "failed", label: "失败", description: job.error?.message || "解析未完成" };
  }
  if (isRunningJob(job)) {
    return {
      key: "running",
      label: PHASE_COPY[job?.phase] || "处理中",
      description: "服务端任务正在运行",
    };
  }
  const semanticStatus = getSemanticStatus(job);
  if (["partial", "failed", "unconfigured"].includes(semanticStatus)) {
    return { key: "partial", label: "部分成功", description: "原文已保存，语义结果仍需处理" };
  }
  if (job?.review?.status === "verified") {
    return { key: "ready", label: "待发布", description: "已通过人工审核" };
  }
  return { key: "review", label: "待审核", description: "解析完成，等待人工确认" };
}

export function calculateEducationImportProgress(job) {
  if (job?.status === "succeeded") {
    return {
      percent: 100,
      currentPage: Number(job?.progress?.total_pages) || Number(job?.progress?.current_page) || 0,
      totalPages: Number(job?.progress?.total_pages) || 0,
    };
  }
  const currentPage = Math.max(0, Number(job?.progress?.current_page) || 0);
  const totalPages = Math.max(0, Number(job?.progress?.total_pages) || 0);
  const pageRatio = totalPages ? Math.min(1, currentPage / totalPages) : 0;
  const semanticTotal = Math.max(0, Number(job?.progress?.semantic_batches_total) || 0);
  const semanticCompleted = Math.max(0, Number(job?.progress?.semantic_batches_completed) || 0);
  const semanticRatio = semanticTotal ? Math.min(1, semanticCompleted / semanticTotal) : 0;
  if (job?.status === "failed") {
    return {
      percent: totalPages ? Math.max(3, Math.min(96, Math.round(pageRatio * 100))) : 3,
      currentPage,
      totalPages,
    };
  }
  const bases = {
    queued: 3,
    interrupted: 5,
    inspecting: 7,
    native_metadata: 12,
    native_text: 20,
    rendering_pages: 28 + Math.round(pageRatio * 24),
    visual_analysis: 52 + Math.round(pageRatio * 25),
    assembling: 80,
    semantic_compilation: semanticTotal ? 86 + Math.round(semanticRatio * 9) : 87,
    persisting: 96,
    completed: 100,
  };
  return {
    percent: Math.max(3, Math.min(100, Number(bases[job?.phase]) || 8)),
    currentPage,
    totalPages,
  };
}

function isRunningJob(job) {
  return Boolean(job) && !["succeeded", "failed"].includes(job.status);
}

function loadPublicationReceipts() {
  if (typeof localStorage === "undefined") return new Map();
  try {
    const values = JSON.parse(localStorage.getItem(PUBLICATION_RECEIPT_STORAGE_KEY) || "[]");
    return new Map((Array.isArray(values) ? values : [])
      .filter((receipt) => receipt?.job_id && receipt?.status === "active")
      .map((receipt) => [receipt.job_id, receipt]));
  } catch {
    return new Map();
  }
}

function persistPublicationReceipts(receipts) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PUBLICATION_RECEIPT_STORAGE_KEY, JSON.stringify([...receipts.values()]));
  } catch {
    // The task list remains server-backed even if the optional local release receipt cannot be cached.
  }
}

function setTextContent(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function renderProgress(result, job, { catalogMode = false } = {}) {
  if (catalogMode) updateCatalogStages(job.phase || "queued");
  const progress = job.progress || {};
  const total = Number(progress.total_pages) || 0;
  const current = Math.min(total || Number(progress.current_page) || 0, Number(progress.current_page) || 0);
  const semanticCompleted = Number(progress.semantic_batches_completed) || 0;
  const semanticTotal = Number(progress.semantic_batches_total) || 0;
  const percent = total ? Math.max(5, Math.min(96, Math.round(current / total * 100))) : 12;
  result.innerHTML = `<div class="import-progress-state is-live">
    <header><i data-lucide="loader-circle"></i><div><b>${escapeHTML(PHASE_COPY[job.phase] || "正在解析材料")}</b><p>${escapeHTML(job.source?.file_name || "导入文件")}</p></div></header>
    <div class="import-progress-bar" aria-label="解析进度"><span style="width:${percent}%"></span></div>
    <span>${job.phase === "semantic_compilation" && semanticTotal
      ? `正在整理内容 ${semanticCompleted + 1 > semanticTotal ? semanticTotal : semanticCompleted + 1} / ${semanticTotal}`
      : total ? `第 ${current || 1} / ${total} 页` : "正在读取页数"}${progress.vision_pages ? ` · 已理解 ${progress.vision_pages} 页图像` : ""}</span>
    <small>可以离开本页，任务会在后台继续。</small>
  </div>`;
  refreshIcons();
}

function renderCatalogFailed(result, job) {
  updateCatalogStages("failed");
  const progress = calculateEducationImportProgress(job);
  const errorMessage = job.error?.message || "该任务未完成解析";
  const retryKind = importKindForDocumentType(job.request?.document_type);
  result.innerHTML = `<div class="catalog-failed-job">
    <header><span><i data-lucide="circle-x"></i></span><div><b>导入任务失败</b><p>${escapeHTML(job.request?.title || job.source?.file_name || "导入材料")}</p></div><em>失败</em></header>
    <dl>
      <div><dt>来源文件</dt><dd>${escapeHTML(job.source?.file_name || "-")}</dd></div>
      <div><dt>材料类型</dt><dd>${escapeHTML(documentTypeLabel(job.request?.document_type))}</dd></div>
      <div><dt>停止阶段</dt><dd>${escapeHTML(PHASE_COPY[job.phase] || job.phase || "解析")}</dd></div>
      <div><dt>页面进度</dt><dd>${progress.totalPages ? `${progress.currentPage} / ${progress.totalPages} 页` : "未读取完整页数"}</dd></div>
      <div><dt>提交时间</dt><dd>${escapeHTML(formatDateTime(job.created_at))}</dd></div>
      <div><dt>任务 ID</dt><dd>${escapeHTML(job.id)}</dd></div>
    </dl>
    <section><b>没有完成解析</b><p>${escapeHTML(friendlyImportMessage(errorMessage))}</p><small>原任务已保留，可以换一份文件重新提交。</small></section>
    <footer><button type="button" class="primary-btn" data-reopen-import="${escapeHTML(retryKind)}"><i data-lucide="rotate-ccw"></i>重新选择文件</button></footer>
  </div>`;
  refreshIcons();
}

function renderCatalogCompleted(result, job, state) {
  if (!result || !job) return;
  const documentIR = job.document_ir || {};
  const pack = job.candidate_pack || {};
  const candidates = pack.candidates || {};
  const semantic = job.semantic_artifact || null;
  const curriculum = candidates.curriculum_standards || [];
  const questions = candidates.questions || [];
  const relations = candidates.typed_relations || [];
  const links = candidates.question_knowledge_links || [];
  const extensions = semantic?.extensions || {};
  const queue = semantic?.review_queue || [];
  const failedBatches = semantic?.failed_batches || [];
  const semanticIncomplete = ["partial", "failed", "unconfigured"].includes(getSemanticStatus(job));
  const verified = pack.review_status === "verified" && documentIR.review_status === "verified";
  const documentType = documentIR.document_type || job.request?.document_type || "unknown";
  const importTarget = classifyImportTarget(documentType);
  const questionReview = state.questionReviews.get(job.id) || null;
  const publishedQuestionCount = Number(questionReview?.counts?.published || 0);
  const published = importTarget === "knowledge"
    ? state.publicationReceipt?.status === "active" || Boolean(state.publishedOntology?.active_release)
    : importTarget === "question_bank"
      ? publishedQuestionCount > 0
      : verified;
  updateCatalogStages(published ? "active" : verified ? "verified" : "completed");

  const tabs = [
    ["document", "原文与版面"],
    ["schema", "字段与关系规则"],
    ["instances", `候选内容 ${curriculum.length + questions.length}`],
    ["review", `质量检查 ${queue.length || ""}`.trim()],
    ["graph", published ? "已发布关系" : "候选关系"],
  ];
  const selectedTab = tabs.some(([id]) => id === state.catalogTab)
    ? state.catalogTab
    : "document";
  const title = documentIR.title || job.request?.title || job.source?.file_name || "导入材料";
  const status = published ? "active" : semanticIncomplete ? "partial" : verified ? "verified" : "review";
  const statusLabel = published
    ? importTarget === "learner_evidence" ? "审核已保存" : "已发布"
    : semanticIncomplete
      ? "需要处理"
      : verified
        ? importTarget === "knowledge" ? "等待发布" : "已通过审核"
        : "等待审核";
  const stagePanel = importTarget === "question_bank"
    ? renderQuestionReviewPanel({
      questionReview,
      questionReviewLoading: state.questionReviewRequests.has(job.id),
      jobId: job.id,
    })
    : importTarget === "learner_evidence"
      ? renderLearningRecordReviewGate({ job, semantic, queue, failedBatches, verified })
      : renderOntologyReviewGate({
        job,
        pack,
        semantic,
        queue,
        failedBatches,
        verified,
        published,
      });
  result.innerHTML = `<div class="ontology-review-workbench">
    <header class="ontology-review-summary">
      <div><h4>${escapeHTML(title)}</h4><p>${escapeHTML(documentTypeLabel(documentType))} · ${Number(job.result?.page_count || documentIR.pages?.length || 0)} 页 · ${escapeHTML(importTargetLabel(documentType))}</p></div>
      <span class="ontology-status-chip is-${status}">${statusLabel}</span>
    </header>
    <section class="import-current-stage" aria-label="当前处理阶段">
      ${stagePanel}
    </section>
    <details class="import-technical-disclosure" data-import-technical-details ${state.catalogDetailsOpen ? "open" : ""}>
      <summary><span><i data-lucide="sliders-horizontal"></i><b>解析详情</b><small>原文、抽取规则、候选内容与关系</small></span><i data-lucide="chevron-down"></i></summary>
      <nav class="ontology-view-tabs" aria-label="解析产物">
        ${tabs.map(([id, label]) => `<button type="button" class="${selectedTab === id ? "is-active" : ""}" data-ontology-tab="${id}">${escapeHTML(label)}</button>`).join("")}
      </nav>
      <section class="ontology-view-panel" data-ontology-panel="${escapeHTML(selectedTab)}">
        ${renderOntologyPanel(selectedTab, {
          documentIR,
          pack,
          semantic,
          schema: state.ontologySchema,
          publicationReceipt: state.publicationReceipt,
          publishedOntology: state.publishedOntology,
          jobId: job.id,
        })}
      </section>
    </details>
  </div>`;
  refreshIcons();
}

function renderOntologyPanel(tab, context) {
  if (tab === "schema") return renderOntologySchema(context.schema);
  if (tab === "instances") return renderOntologyInstances(context.pack, context.semantic);
  if (tab === "questions") return renderQuestionReviewPanel(context);
  if (tab === "review") return renderOntologyReview(context.pack, context.semantic);
  if (tab === "graph") return renderOntologyGraph(context.pack, context.publishedOntology, context.publicationReceipt);
  return renderDocumentIR(context.documentIR, context.pack, context.semantic);
}

function renderDocumentIR(documentIR, pack, semantic) {
  const pages = documentIR.pages || [];
  const blockCount = pages.reduce((sum, page) => sum + (page.blocks?.length || 0), 0);
  const modelBatches = semantic?.batch_count || 0;
  const pageCards = pages.slice(0, 10).map((page) => {
    const blocks = page.blocks || [];
    const excerpt = blocks.map((block) => block.normalized_text || block.text || "")
      .filter(Boolean).join(" ");
    return `<article><b>第 ${page.index + 1} 页${page.printed_page ? ` · 原页码 ${escapeHTML(page.printed_page)}` : ""}</b><p>${escapeHTML(truncate(excerpt || "本页只包含图像或版面元素", 220))}</p></article>`;
  }).join("");
  return `<div class="ontology-metrics">
      <article><b>${pages.length}</b><span>页面</span></article>
      <article><b>${blockCount}</b><span>DocumentIR 块</span></article>
      <article><b>${Number(pack.assets?.length || 0)}</b><span>页面与图像资产</span></article>
      <article><b>${modelBatches}</b><span>语义批次</span></article>
      <article><b>${escapeHTML(documentIR.language || "-")}</b><span>语言</span></article>
    </div>
    <div class="ontology-document-pages">${pageCards || `<article><b>原文结构待生成</b><p>任务完成后会在这里展示带页码和块 ID 的 DocumentIR。</p></article>`}</div>`;
}

function renderOntologySchema(schema) {
  const entityTypes = schema?.entity_types || [];
  const relationTypes = schema?.relation_types || [];
  const curriculumTypes = schema?.curriculum_candidate_types || [];
  const questionRelations = schema?.question_knowledge_relations || [];
  const chipList = (values) => `<div class="ontology-chip-list">${values.map((value) => `<span>${escapeHTML(value)}</span>`).join("")}</div>`;
  return `<div class="ontology-schema-grid">
    <section><h5>实体类型 · ${entityTypes.length}</h5>${chipList(entityTypes)}</section>
    <section><h5>关系类型 · ${relationTypes.length}</h5>${chipList(relationTypes)}</section>
    <section><h5>课标候选层级</h5>${chipList(curriculumTypes)}</section>
    <section><h5>题目—知识点映射</h5>${chipList(questionRelations)}</section>
  </div>`;
}

function renderOntologyInstances(pack, semantic) {
  const candidates = pack.candidates || {};
  const entities = [
    ...(candidates.curriculum_standards || []).map((item) => ({
      type: item.candidate_type,
      title: item.canonical_name,
      body: item.statement,
      page: item.source_anchor?.page_index,
      status: item.review_status,
    })),
    ...(candidates.questions || []).map((item) => ({
      type: "question",
      title: item.stem,
      body: `${questionTypeLabel(item.question_type)} · ${item.task_features?.cognitive_process || "待分析"}`,
      page: item.source_anchor?.page_index,
      status: item.review_status,
    })),
    ...(semantic?.extensions?.solution_strategies || []).map((item) => ({
      type: "solution_strategy",
      title: item.name,
      body: item.description,
      page: item.source_anchors?.[0]?.page_index,
      status: item.review_status,
    })),
  ];
  return `<div class="ontology-instance-list">${entities.slice(0, 200).map((item) => `<article>
    <b>${escapeHTML(item.title || "未命名实例")}</b><em>${escapeHTML(item.type)} · ${escapeHTML(item.status || "candidate")}${Number.isInteger(item.page) ? ` · P${item.page + 1}` : ""}</em>
    <p>${escapeHTML(truncate(item.body || "", 260))}</p>
  </article>`).join("") || `<div class="ontology-graph-empty"><i data-lucide="scan-search"></i><span>尚未抽取出本体实例</span></div>`}</div>`;
}

function renderQuestionReviewPanel({ questionReview, questionReviewLoading, jobId }) {
  if (questionReviewLoading && !questionReview) {
    return `<div class="question-import-review-empty"><i data-lucide="loader-circle"></i><b>正在读取题目审核队列…</b></div>`;
  }
  if (questionReview?.error) {
    return `<div class="question-import-review-empty is-error"><i data-lucide="circle-alert"></i><b>${escapeHTML(questionReview.error)}</b><button type="button" data-load-question-review="${escapeHTML(jobId)}">重试</button></div>`;
  }
  if (!questionReview) {
    return `<div class="question-import-review-empty"><i data-lucide="list-checks"></i><b>题目候选已保留原文锚点</b><p>进入审核后，需逐题确认知识点、题型、难度、解题思路与卡片。</p><button type="button" class="primary-btn" data-load-question-review="${escapeHTML(jobId)}">开始审核</button></div>`;
  }
  const counts = questionReview.counts || {};
  const cards = questionReview.trusted_cards || [];
  const knowledgePoints = questionReview.knowledge_points || [];
  const rows = (questionReview.items || []).map((item, index) => {
    const candidate = item.candidate || {};
    const anchor = item.source_anchor || candidate.source_anchor || {};
    const selectedKnowledgeId = item.canonical_knowledge_point_id || "";
    const status = item.publication?.status === "published" ? "published" : item.status || "pending";
    const locked = status === "published";
    return `<article class="question-import-review-row is-${escapeHTML(status)}" data-question-review-row data-question-review-job="${escapeHTML(jobId)}" data-candidate-id="${escapeHTML(item.candidate_id)}">
      <header>
        <label class="question-import-check"><input type="checkbox" data-question-review-select ${locked ? "disabled" : ""}><span>${index + 1}</span></label>
        <div><b>${escapeHTML(truncate(item.edited_stem || candidate.stem || "未识别题干", 120))}</b><small>${Number.isInteger(anchor.page_index) ? `第 ${anchor.page_index + 1} 页` : "页码待核对"} · ${escapeHTML((anchor.block_ids || []).join("、") || "无块 ID")}</small></div>
        <span class="question-review-status is-${escapeHTML(status)}">${escapeHTML(questionReviewStatusLabel(status))}</span>
      </header>
      <div class="question-import-review-fields">
        <label class="is-wide"><span>题干</span><textarea rows="2" data-question-review-field="stem" ${locked ? "disabled" : ""}>${escapeHTML(item.edited_stem || candidate.stem || "")}</textarea></label>
        <label><span>正式知识点</span><select data-question-review-field="canonical_knowledge_point_id" ${locked ? "disabled" : ""}>
          <option value="">请人工选择…</option>
          ${knowledgePoints.map((point) => `<option value="${escapeHTML(point.id)}" ${point.id === selectedKnowledgeId ? "selected" : ""}>${escapeHTML(point.name)} · ${escapeHTML(point.id)}</option>`).join("")}
        </select></label>
        <label><span>题型</span><select data-question-review-field="question_type" ${locked ? "disabled" : ""}>
          <option value="">请确认…</option>
          ${(questionReview.question_types || []).map((type) => `<option value="${escapeHTML(type)}" ${type === item.question_type ? "selected" : ""}>${escapeHTML(questionTypeLabel(type))}</option>`).join("")}
        </select></label>
        <label><span>难度</span><select data-question-review-field="difficulty" ${locked ? "disabled" : ""}>
          <option value="">请确认…</option>
          ${(questionReview.difficulties || []).map((difficulty) => `<option value="${escapeHTML(difficulty)}" ${difficulty === item.difficulty ? "selected" : ""}>${escapeHTML(questionReviewDifficultyLabel(difficulty))}</option>`).join("")}
        </select></label>
        <label><span>卡片关联</span><select data-question-review-field="artifact_ref" ${locked ? "disabled" : ""}>
          ${renderQuestionReviewCardOptions(cards, selectedKnowledgeId, item.artifact_ref, item.card_pending)}
        </select></label>
        <label class="is-wide"><span>解题思路</span><textarea rows="3" data-question-review-field="solution_strategy" placeholder="说明关键判断、主要步骤和检验方法" ${locked ? "disabled" : ""}>${escapeHTML(item.solution_strategy || "")}</textarea></label>
        <label><span>参考答案（可选，仅服务端）</span><input data-question-review-field="answer_key" value="${escapeHTML(item.answer_key || "")}" ${locked ? "disabled" : ""}></label>
        <label><span>审核备注</span><input data-question-review-field="note" value="${escapeHTML(item.note || "")}" placeholder="退回修改时必填" ${locked ? "disabled" : ""}></label>
      </div>
      <details class="question-import-source"><summary>查看原文锚点</summary><q>${escapeHTML(anchor.quote || candidate.stem || "")}</q><code>${escapeHTML(anchor.content_hash || "无内容哈希")}</code></details>
      ${locked ? `<footer><i data-lucide="badge-check"></i>已发布为 ${escapeHTML(item.publication.question_id)}，审核记录已锁定。</footer>` : ""}
    </article>`;
  }).join("");
  const acceptedUnpublished = Math.max(0, Number(counts.accept || 0) - Number(counts.published || 0));
  return `<div class="question-import-review-shell">
    <header class="question-import-review-summary">
      <div><h5>逐题审核</h5><p>确认题干、知识点、难度和解题思路后再发布。</p></div>
      <dl><div><dt>待处理</dt><dd>${Number(counts.pending || 0)}</dd></div><div><dt>已接受</dt><dd>${Number(counts.accept || 0)}</dd></div><div><dt>待修改</dt><dd>${Number(counts.needs_edit || 0)}</dd></div><div><dt>已发布</dt><dd>${Number(counts.published || 0)}</dd></div></dl>
    </header>
    <div class="question-import-review-toolbar">
      <label><input type="checkbox" data-question-review-select-all><span>全选本页</span></label>
      <span>已选 <b data-question-review-selected-count>0</b> 道</span>
      <div><button type="button" data-question-review-batch="accept" data-question-review-job="${escapeHTML(jobId)}" disabled><i data-lucide="check"></i>批量接受</button><button type="button" data-question-review-batch="needs_edit" data-question-review-job="${escapeHTML(jobId)}" disabled><i data-lucide="undo-2"></i>退回修改</button><button type="button" data-question-review-batch="reject" data-question-review-job="${escapeHTML(jobId)}" disabled><i data-lucide="x"></i>批量拒绝</button></div>
    </div>
    <div class="question-import-review-list">${rows || `<div class="question-import-review-empty">没有题目候选。</div>`}</div>
    <footer class="question-import-publish-bar"><span><b>${acceptedUnpublished}</b> 道已通过但尚未发布<small>发布后题面与解题思路分库存储，重复发布同一修订不会重复写入。</small></span><button type="button" class="primary-btn" data-publish-reviewed-questions="${escapeHTML(jobId)}" ${acceptedUnpublished ? "" : "disabled"}><i data-lucide="database-zap"></i>发布到正式题库</button></footer>
  </div>`;
}

function renderQuestionReviewCardOptions(cards, knowledgePointId, artifactRef, cardPending) {
  const available = cards.filter((card) => card.knowledge_point_id === knowledgePointId);
  return `<option value="" ${!artifactRef && !cardPending ? "selected" : ""}>请确认…</option>${available.map((card) => `<option value="${escapeHTML(card.artifact_id)}" ${card.artifact_id === artifactRef ? "selected" : ""}>${escapeHTML(card.title)} · ${escapeHTML(card.variant || "知识卡片")}</option>`).join("")}<option value="__card_pending__" ${cardPending ? "selected" : ""}>暂无受信卡片，标记待生成</option>`;
}

async function loadQuestionReview(jobId, result, state, notify, { force = false } = {}) {
  if (!jobId || (!force && state.questionReviews.has(jobId))) return;
  if (state.questionReviewRequests.has(jobId)) return state.questionReviewRequests.get(jobId);
  const request = apiJson(`/api/education/imports/${encodeURIComponent(jobId)}/questions/review`)
    .then((receipt) => {
      state.questionReviews.set(jobId, receipt);
      return receipt;
    })
    .catch((error) => {
      state.questionReviews.set(jobId, { error: error.message });
      notify?.(error.message);
      return null;
    })
    .finally(() => {
      state.questionReviewRequests.delete(jobId);
      if (state.catalogJob?.id === jobId && state.catalogTab === "questions") {
        renderCatalogCompleted(result, state.catalogJob, state);
      }
    });
  state.questionReviewRequests.set(jobId, request);
  if (state.catalogJob?.id === jobId && state.catalogTab === "questions") {
    renderCatalogCompleted(result, state.catalogJob, state);
  }
  return request;
}

async function submitQuestionReviewBatch({ jobId, status, result, state, notify, button }) {
  const receipt = state.questionReviews.get(jobId);
  if (!receipt || receipt.error) return;
  const rows = [...result.querySelectorAll("[data-question-review-row]")]
    .filter((row) => row.querySelector("[data-question-review-select]")?.checked);
  if (!rows.length) return;
  const decisions = rows.map((row) => {
    const field = (name) => row.querySelector(`[data-question-review-field='${name}']`)?.value?.trim() || "";
    const artifactChoice = field("artifact_ref");
    return {
      candidate_id: row.dataset.candidateId,
      status,
      stem: field("stem"),
      canonical_knowledge_point_id: field("canonical_knowledge_point_id"),
      question_type: field("question_type"),
      difficulty: field("difficulty"),
      solution_strategy: field("solution_strategy"),
      answer_key: field("answer_key"),
      note: field("note"),
      artifact_ref: artifactChoice === "__card_pending__" ? "" : artifactChoice,
      card_pending: artifactChoice === "__card_pending__",
    };
  });
  button.disabled = true;
  try {
    const next = await apiJson(`/api/education/imports/${encodeURIComponent(jobId)}/questions/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_revision: receipt.revision, decisions }),
    });
    state.questionReviews.set(jobId, next);
    notify?.(`${decisions.length} 道题已更新为“${questionReviewStatusLabel(status)}”`);
    renderCatalogCompleted(result, state.catalogJob, state);
  } catch (error) {
    button.disabled = false;
    notify?.(error.message);
  }
}

async function publishReviewedQuestions({ jobId, result, state, notify, button }) {
  const receipt = state.questionReviews.get(jobId);
  if (!receipt || receipt.error || button.disabled) return;
  button.disabled = true;
  try {
    const publication = await apiJson(`/api/education/imports/${encodeURIComponent(jobId)}/questions/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_revision: receipt.revision }),
    });
    state.questionReviews.set(jobId, publication.review);
    notify?.(publication.idempotent
      ? "这一修订已经发布，没有重复写入"
      : `已发布 ${publication.question_count} 道题到正式题库`);
    renderCatalogCompleted(result, state.catalogJob, state);
  } catch (error) {
    button.disabled = false;
    notify?.(error.message);
  }
}

function updateQuestionReviewSelection(result) {
  const checkboxes = [...result.querySelectorAll("[data-question-review-select]:not(:disabled)")];
  const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
  const selectAll = result.querySelector("[data-question-review-select-all]");
  if (selectAll) {
    selectAll.checked = Boolean(checkboxes.length && selected === checkboxes.length);
    selectAll.indeterminate = selected > 0 && selected < checkboxes.length;
  }
  const count = result.querySelector("[data-question-review-selected-count]");
  if (count) count.textContent = String(selected);
  result.querySelectorAll("[data-question-review-batch]").forEach((button) => {
    button.disabled = selected === 0;
  });
}

function updateQuestionReviewCardOptions(row, state) {
  if (!row) return;
  const receipt = state.questionReviews.get(row.dataset.questionReviewJob);
  if (!receipt || receipt.error) return;
  const knowledgePointId = row.querySelector("[data-question-review-field='canonical_knowledge_point_id']")?.value || "";
  const artifactSelect = row.querySelector("[data-question-review-field='artifact_ref']");
  if (!artifactSelect) return;
  artifactSelect.innerHTML = renderQuestionReviewCardOptions(
    receipt.trusted_cards || [],
    knowledgePointId,
    "",
    false,
  );
}

function questionReviewStatusLabel(status) {
  return ({
    pending: "待审核",
    accept: "已接受",
    reject: "已拒绝",
    needs_edit: "待修改",
    published: "已发布",
  })[status] || "待审核";
}

function questionReviewDifficultyLabel(value) {
  return ({ foundation: "基础", standard: "进阶", advanced: "挑战" })[value] || value;
}

function renderOntologyReview(pack, semantic) {
  const candidates = pack.candidates || {};
  const queue = semantic?.review_queue || [];
  const warnings = pack.warnings || [];
  const counts = Object.fromEntries(Object.entries(candidates).map(([key, values]) => [key, Array.isArray(values) ? values.length : 0]));
  return `<div class="ontology-schema-grid">
    <section><h5>候选集合</h5><div class="ontology-chip-list">${Object.entries(counts).map(([key, count]) => `<span>${escapeHTML(key)} · ${count}</span>`).join("")}</div></section>
    <section><h5>语义批次</h5><div class="ontology-chip-list"><span>状态 · ${escapeHTML(semantic?.status || "未运行")}</span><span>批次 · ${Number(semantic?.batch_count || 0)}</span><span>失败 · ${Number(semantic?.failed_batches?.length || 0)}</span></div></section>
    <section><h5>待审语义项 · ${queue.length}</h5><div class="ontology-instance-list">${queue.slice(0, 30).map((item) => `<article><b>${escapeHTML(item.proposal || "语义候选")}</b><em>withheld</em><p>${escapeHTML((item.reasons || []).join("；"))}</p></article>`).join("") || `<p class="import-no-candidates">没有未处理的语义待审项。</p>`}</div></section>
    <section><h5>处理警告 · ${warnings.length}</h5><div class="ontology-instance-list">${warnings.slice(0, 30).map((item) => `<article><b>${escapeHTML(item.code || "warning")}</b><p>${escapeHTML(item.message || "需要复核")}</p></article>`).join("") || `<p class="import-no-candidates">没有处理警告。</p>`}</div></section>
  </div>`;
}

function renderOntologyReviewGate({ job, semantic, queue, failedBatches, verified, published }) {
  if (published) {
    return `<div class="ontology-review-gate is-complete"><span><i data-lucide="badge-check"></i><span><b>知识已发布</b><small>这份资料已进入可检索的知识图谱。</small></span></span><div class="ontology-review-actions"><button type="button" data-open-import-job="${escapeHTML(job.id)}"><i data-lucide="refresh-cw"></i>刷新状态</button></div></div>`;
  }
  if (!semantic) {
    return `<div class="ontology-review-gate"><span><i data-lucide="clock-3"></i><span><b>正在准备审核内容</b><small>解析产物尚未完整，暂时不能审核。</small></span></span><div class="ontology-review-actions"><button type="button" data-open-import-job="${escapeHTML(job.id)}"><i data-lucide="refresh-cw"></i>刷新任务</button></div></div>`;
  }
  if (failedBatches.length) {
    return `<div class="ontology-review-gate is-error"><span><i data-lucide="circle-alert"></i><span><b>${failedBatches.length} 组内容未完成解析</b><small>检查模型配置后重新导入原文件。</small></span></span><div class="ontology-review-actions"><button type="button" data-open-import-job="${escapeHTML(job.id)}"><i data-lucide="refresh-cw"></i>刷新任务</button></div></div>`;
  }
  if (queue.length) {
    return `<div class="ontology-review-gate"><span><i data-lucide="list-checks"></i><span><b>需处理 ${queue.length} 项存疑内容</b><small>查看质量检查；确认后这些内容不会作为事实发布。</small></span></span><div class="ontology-review-actions"><button type="button" class="primary-btn" data-resolve-semantic-review="${escapeHTML(job.id)}">确认复核结果</button></div></div>`;
  }
  if (semantic.status !== "succeeded") {
    return `<div class="ontology-review-gate"><span><i data-lucide="clock-3"></i><span><b>解析尚未完整</b><small>等待全部内容处理完成后再审核。</small></span></span><div class="ontology-review-actions"><button type="button" data-open-import-job="${escapeHTML(job.id)}"><i data-lucide="refresh-cw"></i>刷新任务</button></div></div>`;
  }
  if (!verified) {
    return `<div class="ontology-review-gate"><span><i data-lucide="shield-check"></i><span><b>请确认知识候选</b><small>原文页码和来源会一同保留，审核后仍不会自动发布。</small></span></span><div class="ontology-review-actions"><button type="button" class="primary-btn" data-review-import="${escapeHTML(job.id)}">确认候选</button></div></div>`;
  }
  return `<div class="ontology-review-gate"><span><i data-lucide="database-zap"></i><span><b>审核已通过</b><small>发布成功后，AI 教师才能检索这份知识。</small></span></span><div class="ontology-review-actions"><button type="button" class="primary-btn" data-publish-import="${escapeHTML(job.id)}">发布到知识图谱</button></div></div>`;
}

function renderLearningRecordReviewGate({ job, semantic, queue, failedBatches, verified }) {
  if (verified) {
    return `<div class="ontology-review-gate is-complete"><span><i data-lucide="badge-check"></i><span><b>审核结果已保存</b><small>这类资料不会发布到共享知识图谱，也不会在未确认时改写掌握度。</small></span></span></div>`;
  }
  if (!semantic || failedBatches.length || semantic.status !== "succeeded") {
    return `<div class="ontology-review-gate ${failedBatches.length ? "is-error" : ""}"><span><i data-lucide="${failedBatches.length ? "circle-alert" : "clock-3"}"></i><span><b>${failedBatches.length ? "部分页未完成解析" : "正在准备审核内容"}</b><small>${failedBatches.length ? "检查模型配置后重新导入原文件。" : "解析完成后即可确认作答与知识点。"}</small></span></span><div class="ontology-review-actions"><button type="button" data-open-import-job="${escapeHTML(job.id)}"><i data-lucide="refresh-cw"></i>刷新任务</button></div></div>`;
  }
  if (queue.length) {
    return `<div class="ontology-review-gate"><span><i data-lucide="list-checks"></i><span><b>需处理 ${queue.length} 项存疑内容</b><small>确认后，未通过的内容不会进入学习记录。</small></span></span><div class="ontology-review-actions"><button type="button" class="primary-btn" data-resolve-semantic-review="${escapeHTML(job.id)}">确认复核结果</button></div></div>`;
  }
  return `<div class="ontology-review-gate"><span><i data-lucide="shield-check"></i><span><b>请确认作答与知识点</b><small>只有确认后的候选才会保存为可追溯记录。</small></span></span><div class="ontology-review-actions"><button type="button" class="primary-btn" data-review-import="${escapeHTML(job.id)}">确认候选</button></div></div>`;
}

function renderOntologyGraph(pack, publishedOntology, publicationReceipt) {
  const graph = graphViewModel(pack, publishedOntology);
  if (!graph.nodes.length) {
    return `<div class="ontology-graph-empty"><i data-lucide="share-2"></i><span>本体图暂无可展示节点</span></div>`;
  }
  const visibleNodes = graph.nodes.slice(0, 80);
  const nodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.relationships.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, 180);
  const positions = new Map(visibleNodes.map((node, index) => {
    const ring = Math.floor(index / 18);
    const ringStart = ring * 18;
    const ringSize = Math.min(18, visibleNodes.length - ringStart);
    const angle = (index - ringStart) / Math.max(1, ringSize) * Math.PI * 2 - Math.PI / 2;
    const radius = 78 + ring * 68;
    return [node.id, { x: 450 + Math.cos(angle) * radius, y: 210 + Math.sin(angle) * radius }];
  }));
  const edges = visibleEdges.map((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return "";
    return `<line x1="${source.x.toFixed(1)}" y1="${source.y.toFixed(1)}" x2="${target.x.toFixed(1)}" y2="${target.y.toFixed(1)}"><title>${escapeHTML(edge.type)}</title></line>`;
  }).join("");
  const nodes = visibleNodes.map((node) => {
    const point = positions.get(node.id);
    const isQuestion = node.kind === "question";
    return `<g><circle class="${isQuestion ? "is-question" : ""}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${isQuestion ? 7 : 8}"><title>${escapeHTML(node.label)}</title></circle><text x="${point.x.toFixed(1)}" y="${(point.y + 20).toFixed(1)}">${escapeHTML(truncate(node.label, 14))}</text></g>`;
  }).join("");
  const databaseLabel = publishedOntology?.source === "neo4j" && publishedOntology?.active_release
    ? `Neo4j 活动版本 ${publishedOntology.active_release.release_id}`
    : publicationReceipt?.release_id
      ? `发布版本 ${publicationReceipt.release_id}`
      : "CandidatePack 候选预览（尚未发布）";
  return `<div class="ontology-graph-canvas"><svg viewBox="0 0 900 420" role="img" aria-label="本体图"><g>${edges}</g><g>${nodes}</g></svg></div><p class="import-no-candidates">${escapeHTML(databaseLabel)} · 展示 ${visibleNodes.length}/${graph.nodes.length} 个节点、${visibleEdges.length}/${graph.relationships.length} 条关系</p>`;
}

function graphViewModel(pack, publishedOntology) {
  if (publishedOntology?.active_release && Array.isArray(publishedOntology.nodes)) {
    return {
      nodes: publishedOntology.nodes.map((node) => {
        const properties = node.properties || {};
        return {
          id: String(properties.resource_id || properties.question_id || properties.graph_key || ""),
          label: String(properties.name || properties.stem || properties.resource_id || "未命名节点"),
          kind: node.label === "EducationQuestion" ? "question" : "knowledge",
        };
      }).filter((node) => node.id),
      relationships: (publishedOntology.relationships || []).map((edge) => ({
        source: String(edge.source_id || ""),
        target: String(edge.target_id || ""),
        type: String(edge.properties?.contract_type || edge.type || "related_to"),
      })).filter((edge) => edge.source && edge.target),
    };
  }
  const candidates = pack.candidates || {};
  const knowledge = (candidates.curriculum_standards || []).map((item) => ({
    id: String(item.id),
    label: String(item.canonical_name || item.id),
    kind: item.candidate_type === "knowledge_point" ? "knowledge" : "standard",
  }));
  const questions = (candidates.questions || []).map((item) => ({
    id: String(item.id),
    label: String(item.stem || item.id),
    kind: "question",
  }));
  const typedRelations = (candidates.typed_relations || []).map((edge) => ({
    source: String(edge.source_id),
    target: String(edge.target_id),
    type: String(edge.relation_type),
  }));
  const questionLinks = (candidates.question_knowledge_links || []).map((edge) => ({
    source: String(edge.question_id),
    target: String(edge.knowledge_point_id),
    type: String(edge.relation),
  }));
  return { nodes: [...knowledge, ...questions], relationships: [...typedRelations, ...questionLinks] };
}

function updateCatalogStages(status) {
  const stages = [...document.querySelectorAll("[data-catalog-stage]")];
  if (!stages.length) return;
  const stageIndex = ({
    queued: 1,
    interrupted: 1,
    inspecting: 1,
    native_metadata: 1,
    native_text: 1,
    rendering_pages: 1,
    visual_analysis: 1,
    assembling: 1,
    semantic_compilation: 1,
    persisting: 1,
    completed: 2,
    verified: 3,
    publishing: 3,
    active: 4,
  })[status] ?? 0;
  stages.forEach((stage, index) => {
    stage.classList.toggle("is-done", index < stageIndex);
    stage.classList.toggle("is-active", index === stageIndex && stageIndex < stages.length);
  });
}

function renderCompleted(result, job) {
  const pack = job.candidate_pack || {};
  const candidates = pack.candidates || {};
  const curriculum = candidates.curriculum_standards || [];
  const questions = candidates.questions || [];
  const submissions = candidates.submissions || [];
  const relations = candidates.typed_relations || [];
  const links = candidates.question_knowledge_links || [];
  const semanticExtensions = job.semantic_artifact?.extensions || {};
  const strategies = semanticExtensions.solution_strategies || [];
  const propositionAngles = semanticExtensions.proposition_angles || [];
  const misconceptions = semanticExtensions.misconceptions || [];
  const warnings = pack.warnings || [];
  const semanticStatus = getSemanticStatus(job);
  const semanticIncomplete = ["partial", "failed", "unconfigured"].includes(semanticStatus);
  const cards = [
    ...curriculum.slice(0, 3).map((item) => ({
      kind: item.candidate_type === "knowledge_point" ? "知识点" : "课标候选",
      title: item.canonical_name,
      body: item.statement,
      page: item.source_anchor?.page_index,
    })),
    ...questions.slice(0, 3).map((item) => ({
      kind: "题目",
      title: item.stem,
      body: `${questionTypeLabel(item.question_type)} · ${item.task_features?.cognitive_process || "待分析"}`,
      page: item.source_anchor?.page_index,
    })),
    ...strategies.slice(0, 2).map((item) => ({
      kind: "解题策略",
      title: item.name,
      body: item.description,
      page: item.source_anchors?.[0]?.page_index,
    })),
  ].slice(0, 5);
  const verified = pack.review_status === "verified" || job.review?.status === "verified";
  result.innerHTML = `<div class="import-review-state">
    <header><span class="import-success-icon"><i data-lucide="${semanticIncomplete ? "triangle-alert" : "file-check-2"}"></i></span><div><b>${verified ? "候选内容已保存" : semanticIncomplete ? "原文已解析，语义编译待完成" : "解析完成，等待确认"}</b><p>${escapeHTML(job.document_ir?.title || job.request?.title || job.source?.file_name || "导入材料")} · ${Number(job.result?.page_count || 0)} 页</p></div></header>
    <div class="import-review-metrics"><span><b>${curriculum.length}</b>课标/知识点</span><span><b>${questions.length}</b>题目</span><span><b>${relations.length + links.length}</b>关系/映射</span><span><b>${strategies.length + propositionAngles.length + misconceptions.length}</b>策略/角度/易错</span></div>
    <div class="import-candidate-list">${cards.length ? cards.map((card) => `<article><span>${escapeHTML(card.kind)}${Number.isInteger(card.page) ? ` · 第 ${card.page + 1} 页` : ""}</span><b>${escapeHTML(card.title || "待命名候选")}</b><p>${escapeHTML(truncate(card.body || "", 180))}</p></article>`).join("") : `<p class="import-no-candidates">已保存原文与页面锚点，暂未形成结构化候选。</p>`}</div>
    ${warnings.length ? `<details class="import-warning-list"><summary>${warnings.length} 项需要注意</summary><ul>${warnings.slice(0, 8).map((warning) => `<li>${escapeHTML(warning.message || warning.code || "需要复核")}</li>`).join("")}</ul></details>` : ""}
    <div class="import-review-actions"><button type="button" data-open-import-job="${escapeHTML(job.id)}">刷新结果</button>${verified ? `<span class="import-verified-label"><i data-lucide="badge-check"></i>已确认，不自动写掌握度</span>` : semanticIncomplete ? `<span class="import-verified-label"><i data-lucide="clock-3"></i>语义编译完成后再确认</span>` : `<button type="button" class="primary-btn" data-review-import="${escapeHTML(job.id)}">确认候选并保存</button>`}</div>
    <p>所有候选保留原文页码和来源锚点；知识点映射、判题与学生证据仍需分别通过质量门。</p>
  </div>`;
  refreshIcons();
}

function getSemanticStatus(job) {
  const warnings = job?.candidate_pack?.warnings || [];
  return job?.semantic_artifact?.status
    || job?.result?.semantic?.status
    || (warnings.some((warning) => warning.code === "semantic_model_unconfigured")
      ? "unconfigured"
      : warnings.some((warning) => warning.code === "semantic_compilation_unavailable")
        ? "failed"
        : null);
}

function renderError(result, error) {
  result.innerHTML = `<div class="import-error-state"><i data-lucide="circle-alert"></i><b>没有完成当前操作</b><p>${escapeHTML(friendlyImportMessage(error?.message, error?.code, error?.status))}</p><small>已提交的任务不会丢失，可从“历史任务”继续查看。</small></div>`;
  refreshIcons();
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // A safe generic message is used below.
  }
  if (!response.ok) {
    const error = new Error(friendlyImportMessage(
      payload?.message || `导入请求失败（${response.status}）`,
      payload?.error,
      response.status,
    ));
    error.code = payload?.error || "education_import_failed";
    error.status = response.status;
    throw error;
  }
  return payload;
}

function classifyImportTarget(documentType) {
  if (["curriculum_standard", "exam_syllabus", "textbook"].includes(documentType)) {
    return "knowledge";
  }
  if (["question_collection", "exam_paper", "answer_key", "grading_sheet"].includes(documentType)) {
    return "question_bank";
  }
  if (["student_homework", "student_exam", "homework_template"].includes(documentType)) {
    return "learner_evidence";
  }
  return "review";
}

function importKindForDocumentType(documentType) {
  const target = classifyImportTarget(documentType);
  if (target === "knowledge") return "knowledge";
  if (target === "question_bank") return "question_collection";
  return documentType === "student_exam" ? "student_exam" : "student_homework";
}

function importTitlePlaceholder(kind) {
  return ({
    knowledge: "例如：义务教育数学课程标准",
    question_collection: "例如：九年级数学精选题集",
    student_homework: "例如：九年级一次函数作业",
    student_exam: "例如：九年级数学期中答卷",
  })[kind] || "输入资料名称";
}

function importTargetLabel(documentType) {
  return ({
    knowledge: "审核后发布到知识图谱",
    question_bank: "逐题审核后发布到题库",
    learner_evidence: "审核后保存为学习记录",
    review: "解析完成后进入人工审核",
  })[classifyImportTarget(documentType)];
}

function friendlyImportMessage(message = "", code = "", status = 0) {
  const source = String(message || "").trim();
  const normalized = source.toLowerCase();
  if (normalized.includes("only reviewed curriculum")
    || code === "education_knowledge_projection_document_type_forbidden") {
    return "这类资料不能发布到共享知识图谱。题库请进入“逐题审核”发布；知识图谱只接收已审核的课标、大纲或教材。";
  }
  if (code === "education_import_file_too_large" || status === 413) {
    return "文件超过单次上传限制。请压缩文件或拆分后重新导入。";
  }
  if (code === "education_import_multipart_required" || status === 415) {
    return "文件格式不受支持。请上传 PDF、JPG、PNG 或 WebP 文件。";
  }
  if (normalized.includes("semantic") && normalized.includes("unavailable")) {
    return "内容理解服务暂时不可用。请检查模型配置后重新导入原文件。";
  }
  if (normalized.includes("review") && normalized.includes("required")) {
    return "发布前需先完成人工审核。请回到当前任务，确认候选内容后再发布。";
  }
  if (status >= 500) {
    return "导入服务暂时不可用。已提交的任务不会丢失，可稍后从历史任务重试。";
  }
  return source || "导入服务暂时不可用，请稍后重试。";
}

function documentTypeLabel(value) {
  return ({
    curriculum_standard: "课程标准",
    exam_syllabus: "考试大纲",
    textbook: "教材",
    courseware: "课件",
    question_collection: "题集",
    homework_template: "作业模板",
    student_homework: "学生作业",
    exam_paper: "试卷",
    student_exam: "学生试卷",
    answer_key: "答案",
    grading_sheet: "评分表",
    unknown: "待判断材料",
  })[value] || "学习材料";
}

function jobStatusLabel(job) {
  if (job.status === "succeeded") return job.review?.status === "verified" ? "已确认" : "待确认";
  if (job.status === "failed") return "失败";
  return PHASE_COPY[job.phase] || "处理中";
}

function questionTypeLabel(value) {
  return ({
    single_choice: "单选题",
    multiple_choice: "多选题",
    true_false: "判断题",
    fill_blank: "填空题",
    short_answer: "简答题",
    calculation: "计算题",
    proof: "证明题",
    essay: "论述题",
    composite: "综合题",
  })[value] || "待识别题型";
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function truncate(value, maximum) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function refreshIcons() {
  globalThis.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
