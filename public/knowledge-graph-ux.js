// Rehouse the existing filters; the graph runtime remains their state owner.
const mountedGraphs = new WeakMap();

export function mountKnowledgeGraphUX({ root = document } = {}) {
  const content = root.matches?.("#knowledgeGraphContent") ? root : root.querySelector("#knowledgeGraphContent");
  if (!content) return null;
  if (mountedGraphs.has(content)) return mountedGraphs.get(content);
  const bar = content.querySelector(".graph-filter-bar");
  const panel = content.querySelector(".knowledge-map-panel");
  const toolbar = panel?.querySelector(".knowledge-canvas-toolbar");
  const clear = bar?.querySelector("#clearGraphFiltersBtn");
  const search = bar?.querySelector("#knowledgeGraphSearch");
  if (!bar || !panel || !toolbar || !clear || !search) return null;

  const doc = content.ownerDocument;
  const view = doc.defaultView;
  const cleanup = [];
  const placeholder = doc.createComment("knowledge graph filters original position");
  bar.before(placeholder);
  const details = doc.createElement("details");
  details.className = "kg-filter-disclosure";
  details.innerHTML = `
    <summary class="kg-filter-toggle" aria-controls="knowledgeGraphFilterPanel" aria-expanded="false">
      <i data-lucide="sliders-horizontal" aria-hidden="true"></i><span>筛选</span><b class="kg-filter-count" hidden>0</b>
    </summary>
    <section id="knowledgeGraphFilterPanel" class="kg-filter-panel" aria-label="知识点筛选条件">
      <header><b>筛选知识点</b><button class="kg-filter-close btn" type="button" aria-label="关闭筛选"><i data-lucide="x" aria-hidden="true"></i></button></header>
      <p class="kg-filter-feedback" role="status" aria-live="polite"></p>
    </section>`;
  const toggle = details.querySelector("summary");
  const filterPanel = details.querySelector(".kg-filter-panel");
  const closeButton = details.querySelector(".kg-filter-close");
  const count = details.querySelector(".kg-filter-count");
  const feedback = details.querySelector(".kg-filter-feedback");
  filterPanel.insertBefore(bar, feedback);
  toolbar.prepend(details);
  panel.classList.add("kg-map-panel");
  toolbar.classList.add("kg-canvas-toolbar");
  content.dataset.graphUx = "ready";

  const fieldSpecs = [
    ["knowledgeGraphSearch", "知识点名称", "form-control"],
    ["knowledgeDomainFilter", "知识领域", "form-select"],
    ["knowledgeMasteryFilter", "掌握程度", "form-select"],
    ["knowledgeRelationFilter", "知识关系", "form-select"],
  ];
  const fields = fieldSpecs.map(([id, labelText, controlClass]) => {
    const input = bar.querySelector(`#${id}`);
    if (!input) return null;
    const label = input.closest("label");
    const title = doc.createElement("span");
    title.className = "kg-filter-label";
    title.textContent = labelText;
    label?.prepend(title);
    const hadClass = input.classList.contains(controlClass);
    input.classList.add(controlClass);
    cleanup.push(() => {
      title.remove();
      if (!hadClass) input.classList.remove(controlClass);
    });
    return input;
  }).filter(Boolean);
  const originalClearLabel = clear.getAttribute("aria-label");
  const originalClearTitle = clear.getAttribute("title");
  const clearText = doc.createElement("span");
  clearText.textContent = "清除全部筛选";
  clear.append(clearText);
  clear.setAttribute("aria-label", "清除全部筛选条件");
  clear.setAttribute("title", "清除全部筛选条件");
  const originalClearDisabled = clear.disabled;
  let destroyed = false;

  const isVisible = () => content.isConnected && !content.closest('[hidden], [inert], [aria-hidden="true"]');
  const activeCount = () => fields.filter((input) => {
    const value = input.value.trim();
    return value !== "" && (input === search || value !== "all");
  }).length;
  function sync() {
    if (destroyed) return 0;
    const total = activeCount();
    count.textContent = String(total);
    count.hidden = total === 0;
    toggle.setAttribute("aria-label", total ? `筛选，已设置 ${total} 项条件` : "筛选知识点");
    toggle.setAttribute("aria-expanded", String(details.open));
    const message = total ? `已设置 ${total} 项筛选条件，结果实时更新。` : "选择条件后，图谱会实时更新。";
    if (feedback.textContent !== message) feedback.textContent = message;
    clear.disabled = total === 0;
    if (!isVisible()) details.open = false;
    return total;
  }
  function open({ focus = false } = {}) {
    if (destroyed || !isVisible()) return false;
    details.open = true;
    sync();
    if (focus) search.focus({ preventScroll: true });
    return true;
  }
  function close({ restoreFocus = false } = {}) {
    if (destroyed || !details.open) return false;
    details.open = false;
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus && isVisible()) toggle.focus({ preventScroll: true });
    return true;
  }
  const listen = (target, name, handler, options) => {
    target?.addEventListener(name, handler, options);
    cleanup.push(() => target?.removeEventListener(name, handler, options));
  };
  listen(details, "toggle", sync);
  listen(bar, "input", sync);
  listen(bar, "change", sync);
  // This bubbles after the original clear and legend handlers have changed state.
  listen(content, "click", () => queueMicrotask(sync));
  listen(closeButton, "click", () => close({ restoreFocus: true }));
  listen(doc, "pointerdown", (event) => {
    if (details.open && !details.contains(event.target)) close();
  });
  listen(doc, "focusin", (event) => {
    if (details.open && !details.contains(event.target)) close();
  });
  listen(doc, "keydown", (event) => {
    if (event.key === "Escape" && details.open && details.contains(event.target) && !event.defaultPrevented) {
      event.preventDefault();
      close({ restoreFocus: true });
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      // The existing shortcut owns navigation. Reveal its input after it runs;
      // regular page switches and background updates never request focus.
      queueMicrotask(() => { if (!destroyed && isVisible()) open({ focus: true }); });
    }
  });
  listen(doc, "learning-workspace:change", (event) => {
    if (event.detail?.view !== "graph") close();
    sync();
  });
  listen(doc, "portal-role:change", () => { close(); sync(); });

  const observer = new view.MutationObserver(sync);
  const result = content.querySelector("#knowledgeGraphResultCount");
  if (result) observer.observe(result, { childList: true, characterData: true, subtree: true });
  // Hidden fields retain their values and original role/view rules. The badge
  // counts stored conditions, including ones that the original clear resets.
  fields.forEach((input) => observer.observe(input.closest("label") || input, { attributes: true, attributeFilter: ["hidden"] }));
  for (let ancestor = content; ancestor; ancestor = ancestor.parentElement) {
    observer.observe(ancestor, { attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden"] });
  }
  cleanup.push(() => observer.disconnect());

  function destroy() {
    if (destroyed) return;
    close();
    destroyed = true;
    cleanup.forEach((remove) => remove());
    placeholder.replaceWith(bar);
    details.remove();
    panel.classList.remove("kg-map-panel");
    toolbar.classList.remove("kg-canvas-toolbar");
    delete content.dataset.graphUx;
    clearText.remove();
    clear.disabled = originalClearDisabled;
    if (originalClearLabel === null) clear.removeAttribute("aria-label");
    else clear.setAttribute("aria-label", originalClearLabel);
    if (originalClearTitle === null) clear.removeAttribute("title");
    else clear.setAttribute("title", originalClearTitle);
    mountedGraphs.delete(content);
  }
  const api = Object.freeze({ open, close, sync, destroy, getActiveCount: activeCount });
  mountedGraphs.set(content, api);
  sync();
  view.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  return api;
}
