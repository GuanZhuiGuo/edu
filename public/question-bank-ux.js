const mounted = new WeakMap();
const FILTERS = Object.freeze([
  { key: "search", id: "questionBankSearch", label: "题目", empty: "" },
  { key: "treeSearch", id: "questionTreeSearch", label: "目录定位", empty: "" },
  { key: "knowledge", id: "questionKnowledgeFilter", label: "知识点", empty: "all" },
  { key: "result", id: "questionResultFilter", label: "作答结果", empty: "all" },
  { key: "source", id: "questionSourceFilter", label: "来源", empty: "all" }
]);

export function buildQuestionBankFilterChips(values = {}, labels = {}) {
  return FILTERS.flatMap(({ key, id, label, empty }) => {
    const value = String(values[key] ?? empty).trim();
    return value && value !== empty ? [{ key, id, label: `${label}：${labels[key] || value}` }] : [];
  });
}

/** Presentation only: existing inputs, values, handlers and data access remain authoritative. */
export function mountQuestionBankUX(root = document.querySelector("#questionBankWorkspace")) {
  if (!root) return null;
  if (mounted.has(root)) return mounted.get(root);
  const browser = root.querySelector("#questionBankBrowser");
  const filterBar = root.querySelector(".question-bank-filter-bar");
  const questionSearch = root.querySelector("#questionBankSearch");
  const treeSearch = root.querySelector("#questionTreeSearch");
  if (!browser || !filterBar || !questionSearch || !treeSearch) return null;
  root.classList.add("question-bank-ux");
  root.dataset.bankDetailOpen = "false";

  // One compact command row owns view switching and teacher actions. The old
  // context strip repeated the page title and consumed a full row.
  const viewTabs = root.querySelector("#questionBankViewTabs");
  const teacherStrip = root.querySelector(".teacher-bank-context");
  if (viewTabs) {
    const navigationRow = document.createElement("div");
    navigationRow.className = "question-bank-ux-navigation";
    viewTabs.before(navigationRow);
    navigationRow.append(viewTabs);
    const teacherActions = teacherStrip?.querySelector(":scope > div");
    if (teacherActions) {
      teacherActions.classList.add("question-bank-ux-teacher-actions");
      teacherActions.dataset.portalOnly = "teacher";
      teacherActions.hidden = teacherStrip.hidden;
      navigationRow.append(teacherActions);
    }
    teacherStrip?.remove();
  }

  // Keep both original controls in the DOM for existing query/reset integrations.
  for (const input of [questionSearch, treeSearch]) {
    const label = input.closest("label");
    label.hidden = true;
    label.dataset.questionUxSource = "true";
  }
  const form = document.createElement("form");
  form.className = "question-bank-ux-search";
  form.setAttribute("role", "search");
  form.setAttribute("aria-label", "搜索题目或定位课程知识点");
  form.innerHTML = `<label class="question-bank-ux-search-scope"><span class="question-bank-ux-visually-hidden">搜索范围</span><select id="questionBankSearchScope" class="form-select"><option value="questions">找题目</option><option value="directory">定位知识点</option></select></label>
    <label class="question-bank-ux-search-query" for="questionBankUnifiedSearch"><span class="question-bank-ux-visually-hidden" data-question-search-label>题干、知识点或题目属性</span><i data-lucide="search" aria-hidden="true"></i><input id="questionBankUnifiedSearch" class="form-control" type="search" autocomplete="off" placeholder="搜索题干、知识点或题目属性" aria-describedby="questionBankSearchHint" /></label>
    <button type="submit" class="btn btn-primary" data-question-search-submit><i data-lucide="search" aria-hidden="true"></i><span>搜索</span></button>
    <p id="questionBankSearchHint" class="question-bank-ux-search-hint">输入关键词后搜索，可与下方筛选条件组合。</p>`;
  browser.prepend(form);
  const scope = form.querySelector("select");
  const query = form.querySelector("input");
  const hint = form.querySelector("p");
  const submit = form.querySelector("button");
  let queryDirty = false;
  const sourceInput = () => scope.value === "directory" ? treeSearch : questionSearch;
  const syncSearch = ({ force = false } = {}) => {
    if (force || !queryDirty) query.value = sourceInput().value;
    const directory = scope.value === "directory";
    form.querySelector("[data-question-search-label]").textContent = directory ? "章节或知识点名称" : "题干、知识点或题目属性";
    query.placeholder = directory ? "例如：图形与几何、相似三角形" : "例如：勾股定理、证明题";
    submit.querySelector("span").textContent = directory ? "定位" : "搜索";
    const count = root.dataset.questionDirectoryCount;
    hint.textContent = directory
      ? treeSearch.value.trim() && count !== undefined && count !== ""
        ? `目录中找到 ${count} 个知识点；选择知识点后筛选题目。`
        : "在课程目录中定位知识点，选择后筛选题目。"
      : "输入关键词后搜索，可与下方筛选条件组合。";
  };
  query.addEventListener("input", () => { queryDirty = true; });
  scope.addEventListener("change", () => { queryDirty = false; syncSearch({ force: true }); query.focus(); });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    queryDirty = false;
    sourceInput().value = query.value.trim();
    sourceInput().dispatchEvent(new Event("input", { bubbles: true }));
    if (scope.value === "directory") {
      const treeToggle = root.querySelector("#questionTreeMobileToggle");
      if (treeToggle?.getAttribute("aria-expanded") !== "true") treeToggle?.click();
    }
    root.dataset.bankDetailOpen = "false";
    sync();
  });

  filterBar.setAttribute("aria-label", "题目筛选条件");
  const filterDetails = document.createElement("details");
  filterDetails.className = "question-bank-ux-filter-details";
  const filterDetailsSummary = document.createElement("summary");
  filterDetailsSummary.innerHTML = '<i data-lucide="sliders-horizontal" aria-hidden="true"></i><span>筛选</span><b data-question-filter-count hidden>0</b><i data-lucide="chevron-down" aria-hidden="true"></i>';
  const filterFields = document.createElement("div");
  filterFields.className = "question-bank-ux-filter-fields";
  while (filterBar.firstChild) filterFields.append(filterBar.firstChild);
  filterDetails.append(filterDetailsSummary, filterFields);
  filterBar.append(filterDetails);
  const reset = root.querySelector("#resetQuestionFiltersBtn");
  reset.textContent = "清空筛选";
  submit.before(filterDetails);
  filterBar.remove();
  const filterSummary = document.createElement("div");
  filterSummary.className = "question-bank-ux-filter-summary";
  filterSummary.innerHTML = '<p class="question-bank-ux-result-count" role="status" aria-live="polite"></p><div class="question-bank-ux-filter-chips" role="group" aria-label="已应用的搜索与筛选条件"></div>';
  form.after(filterSummary);
  const chipHost = filterSummary.querySelector("[role=group]");
  const resultCount = filterSummary.querySelector("p");
  const readFilters = () => Object.fromEntries(FILTERS.map(({ key, id, empty }) => [key, root.querySelector(`#${id}`)?.value || empty]));
  const readLabels = () => Object.fromEntries(FILTERS.map(({ key, id }) => [key, root.querySelector(`#${id}`)?.selectedOptions?.[0]?.textContent || ""]));
  const clearFilter = (id) => {
    const spec = FILTERS.find((item) => item.id === id);
    const input = spec && root.querySelector(`#${id}`);
    if (!input) return;
    queryDirty = false;
    input.value = spec.empty;
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    sync();
    syncSearch({ force: true });
    query.focus({ preventScroll: true });
  };
  chipHost.addEventListener("click", (event) => {
    const button = event.target.closest("[data-question-clear-filter]");
    if (button) clearFilter(button.dataset.questionClearFilter);
  });
  reset.addEventListener("click", () => {
    queryDirty = false;
    queueMicrotask(() => { sync(); syncSearch({ force: true }); });
  });

  // The generator already has its own teacher-only view; organize its existing
  // controls instead of creating another modal or duplicating form state.
  const generatorGrid = root.querySelector(".question-attribute-form-grid");
  const generatorGroups = [
    { title: "范围", ids: ["questionGeneratorKnowledge", "questionGeneratorSource"] },
    { title: "题目形态", ids: ["questionGeneratorType", "questionGeneratorDifficulty", "questionGeneratorContext"] },
    { title: "高级教学取向", ids: ["questionGeneratorMethod", "questionGeneratorAbility", "questionGeneratorStrategy", "questionGeneratorMulti"], advanced: true }
  ];
  if (generatorGrid) {
    generatorGrid.classList.add("question-bank-ux-generator-groups");
    for (const group of generatorGroups) {
      const section = document.createElement(group.advanced ? "details" : "fieldset");
      section.className = "question-bank-ux-generator-group";
      const title = document.createElement(group.advanced ? "summary" : "legend");
      title.textContent = group.title;
      section.append(title);
      const fields = document.createElement("div");
      fields.className = "question-bank-ux-generator-fields";
      for (const id of group.ids) {
        const label = root.querySelector(`#${id}`)?.closest("label");
        if (label) fields.append(label);
      }
      section.append(fields);
      generatorGrid.append(section);
    }
    const header = root.querySelector(".question-authoring-form > header");
    header?.querySelector(".page-eyebrow")?.remove();
    if (header?.querySelector("h2")) header.querySelector("h2").textContent = "创建题目草稿";
    if (header?.querySelector("p")) header.querySelector("p").textContent = "选择范围和题目形态，生成供教师复核的本地演示草稿。";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn question-bank-ux-authoring-back";
    back.textContent = "返回题目库";
    back.addEventListener("click", () => root.querySelector('#questionBankViewTabs [data-question-bank-view="history"]')?.click());
    header?.before(back);
  }

  const listPane = root.querySelector(".question-bank-layout > section");
  listPane?.classList.add("question-bank-ux-list-pane");
  const detail = root.querySelector("#questionDetailPanel");
  const detailFrame = document.createElement("section");
  detailFrame.className = "question-bank-ux-detail-frame";
  detailFrame.setAttribute("aria-label", "题目详情");
  const detailBack = document.createElement("button");
  detailBack.type = "button";
  detailBack.className = "btn question-bank-ux-detail-back";
  detailBack.textContent = "返回题目列表";
  detail.before(detailFrame);
  detailFrame.append(detailBack, detail);
  detailBack.addEventListener("click", () => {
    root.dataset.bankDetailOpen = "false";
    listPane?.querySelector(".question-history-row.is-selected")?.focus({ preventScroll: true });
  });

  // Retire layout-only legacy classes on this surface. Keeping them would make
  // the new container layout compete with old viewport-specific overrides.
  const ownedLayouts = [
    [".question-bank-card", "question-bank-ux-browser"],
    [".question-bank-filter-bar", "question-bank-ux-filters"],
    [".question-bank-layout", "question-bank-ux-layout"],
    [".question-knowledge-tree-pane", "question-bank-ux-tree-pane"],
    [".question-bank-list", "question-bank-ux-list"],
    [".question-detail-panel", "question-bank-ux-detail-panel"],
    [".question-authoring-card", "question-bank-ux-authoring"],
    [".question-authoring-form", "question-bank-ux-authoring-form"],
    [".question-generator-preview", "question-bank-ux-generator-preview"],
    [".student-practice-start", "question-bank-ux-practice-start"],
    [".student-practice-intro", "question-bank-ux-practice-intro"],
    [".student-practice-options", "question-bank-ux-practice-options"],
    [".student-question-browser-toggle", "question-bank-ux-browser-toggle"]
  ];
  for (const [selector, replacement] of ownedLayouts) {
    const node = root.querySelector(selector);
    if (node) { node.classList.remove(selector.slice(1)); node.classList.add(replacement); }
  }
  root.querySelector("#studentPracticeStart")?.classList.remove("question-bank-summary");
  root.querySelector(".question-bank-ux-practice-intro > span")?.remove();
  generatorGrid?.classList.remove("question-attribute-form-grid");
  const initialBrowserState = root.querySelector("#studentQuestionBrowserToggle")?.getAttribute("aria-expanded");
  if (root.dataset.bankBrowserOpen === undefined) root.dataset.bankBrowserOpen = String(initialBrowserState === "true");

  function decorateControls() {
    root.querySelectorAll("select").forEach((node) => node.classList.add("form-select"));
    root.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea').forEach((node) => node.classList.add("form-control"));
    root.querySelectorAll("button").forEach((node) => {
      node.classList.add("btn");
      if (node.classList.contains("primary-btn")) node.classList.add("btn-primary");
    });
  }
  function sync() {
    const chips = buildQuestionBankFilterChips(readFilters(), readLabels());
    chipHost.replaceChildren(...chips.map(({ id, label }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn question-bank-ux-filter-chip";
      button.dataset.questionClearFilter = id;
      button.setAttribute("aria-label", `清除${label}`);
      const copy = document.createElement("span");
      copy.textContent = label;
      button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>';
      button.prepend(copy);
      return button;
    }));
    chipHost.hidden = chips.length === 0;
    reset.disabled = chips.length === 0;
    const filterCount = filterDetails.querySelector("[data-question-filter-count]");
    const secondaryCount = chips.filter(({ key }) => !["search", "treeSearch"].includes(key)).length;
    if (filterCount) {
      filterCount.textContent = String(secondaryCount);
      filterCount.hidden = secondaryCount === 0;
    }
    const { questionBankStatus: status, questionBankMatches: matches, questionBankTotal: total } = root.dataset;
    resultCount.textContent = status === "loading" ? "正在读取题库…"
      : status === "error" ? "题库读取失败，可重试加载"
      : matches !== undefined && total !== undefined ? `找到 ${matches} 道 / 全部 ${total} 道题`
      : root.querySelector("#questionBankCount")?.textContent || "正在读取题库…";
    syncSearch();
    decorateControls();
  }
  root.addEventListener("question-bank:render", sync);
  root.addEventListener("question-bank:tree-render", sync);
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-clear-question-filters]")) {
      queryDirty = false;
      queueMicrotask(() => { sync(); syncSearch({ force: true }); });
    }
  });
  root.addEventListener("question-bank:detail", (event) => {
    root.dataset.bankDetailOpen = String(Boolean(event.detail?.id));
    decorateControls();
    if (event.detail?.id && root.getBoundingClientRect().width < 640) {
      const heading = detail.querySelector("h3");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus({ preventScroll: true });
      detailFrame.scrollIntoView({ block: "start", behavior: "auto" });
    }
  });
  for (const name of ["learning-user:change", "learning-user:data-change", "portal-role:change"]) {
    document.addEventListener(name, () => {
      root.dataset.bankDetailOpen = "false";
      queryDirty = false;
      sync();
    });
  }
  const preview = root.querySelector("#questionGeneratorPreview");
  if (preview) new MutationObserver(decorateControls).observe(preview, { childList: true, subtree: true });
  const api = Object.freeze({ sync });
  mounted.set(root, api);
  sync();
  return api;
}
