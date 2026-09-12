// Display server-owned retrieval health. This UI never decides retrieval policy.
const stores = new WeakMap();
const mountedViews = new WeakMap();

/** One polling owner feeds controls in both the host and its same-origin iframe. */
export function createKnowledgeConnectionStore({
  document: doc = globalThis.document,
  window: view = doc?.defaultView || globalThis.window,
  fetch: request = globalThis.fetch,
  setTimeout: setTimer = globalThis.setTimeout,
  clearTimeout: clearTimer = globalThis.clearTimeout
} = {}) {
  const listeners = new Set();
  let current = { overall: "checking", components: { neo4j: { status: "checking" }, qdrant: { status: "checking" } } };
  let pending = null;
  let timer;
  let controller;
  let started = false;
  let destroyed = false;
  const getSnapshot = () => ({ data: current, checking: Boolean(pending) });
  const publish = () => { if (!destroyed) for (const listener of listeners) listener(getSnapshot()); };
  const schedule = () => {
    clearTimer(timer);
    if (started && !destroyed && !doc?.hidden) timer = setTimer(() => check(), 30000);
  };
  function check(manual = false) {
    if (destroyed) return Promise.resolve();
    if (pending) return pending;
    clearTimer(timer);
    controller = new AbortController();
    const signal = controller.signal;
    const timeout = setTimer(() => controller?.abort(), 4500);
    pending = Promise.resolve().then(async () => {
      try {
        const response = await request(`/api/education/knowledge/connections${manual ? "?refresh=1" : ""}`, { cache: "no-store", signal });
        if (!response.ok) throw new Error("Connection status unavailable");
        const data = await response.json();
        if (!data.components || !data.retrieval) throw new Error("Invalid connection status");
        current = data;
      } catch { current = { overall: "unknown" }; }
      finally {
        clearTimer(timeout);
        pending = null;
        controller = null;
        publish();
        schedule();
      }
    });
    publish();
    return pending;
  }
  const onVisibility = () => { if (doc.hidden) clearTimer(timer); else check(); };
  const onOnline = () => check();
  return Object.freeze({
    getSnapshot,
    check,
    subscribe(listener) {
      if (destroyed) return () => {};
      listeners.add(listener);
      listener(getSnapshot());
      return () => listeners.delete(listener);
    },
    start() {
      if (started || destroyed) return pending || Promise.resolve();
      started = true;
      doc?.addEventListener("visibilitychange", onVisibility);
      view?.addEventListener("online", onOnline);
      return check();
    },
    destroy() {
      destroyed = true;
      clearTimer(timer);
      controller?.abort();
      doc?.removeEventListener("visibilitychange", onVisibility);
      view?.removeEventListener("online", onOnline);
      listeners.clear();
    }
  });
}

export function getKnowledgeConnectionStore(doc = document) {
  if (!stores.has(doc)) stores.set(doc, createKnowledgeConnectionStore({ document: doc }));
  return stores.get(doc);
}

export function mountKnowledgeConnectionStatus({
  container = document.querySelector(".global-actions"),
  store,
  placement = "content",
  restoreFocus
} = {}) {
  if (!container) return null;
  if (mountedViews.has(container)) return mountedViews.get(container);
  const doc = container.ownerDocument;
  store ||= getKnowledgeConnectionStore(doc);
  const prefix = placement === "host" ? "hostKnowledgeConnection" : "knowledgeConnection";
  const trigger = doc.createElement("button");
  trigger.id = `${prefix}Button`;
  trigger.className = "knowledge-connection-button";
  trigger.type = "button";
  trigger.dataset.connectionPlacement = placement;
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", `${prefix}Dialog`);
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = '<span class="knowledge-connection-dot" aria-hidden="true"></span><span class="knowledge-connection-label">检查连接</span>';
  container.prepend(trigger);
  const dialog = doc.createElement("dialog");
  dialog.id = `${prefix}Dialog`;
  dialog.className = "knowledge-connection-dialog";
  dialog.setAttribute("aria-labelledby", `${prefix}Title`);
  dialog.innerHTML = `<header><div><h2 id="${prefix}Title">知识库连接</h2><p>连接不可用时，继续检索已审核的本地知识。</p></div><button type="button" class="knowledge-connection-close" aria-label="关闭连接详情">×</button></header><div class="knowledge-connection-summary" role="status" aria-live="polite"></div><dl><div><dt><strong>Neo4j</strong><span>知识关系图谱</span></dt><dd data-connection="neo4j">检查中</dd></div><div><dt><strong>Qdrant</strong><span>知识向量检索</span></dt><dd data-connection="qdrant">检查中</dd></div></dl><p class="knowledge-connection-note">后台会定期检查，恢复后自动使用远程检索。</p><footer><time></time><button type="button" class="knowledge-connection-refresh">重新检查</button></footer>`;
  doc.body.append(dialog);
  const refresh = dialog.querySelector(".knowledge-connection-refresh");
  const summary = dialog.querySelector(".knowledge-connection-summary");
  const labels = { healthy: "已连接", unavailable: "不可用", checking: "检查中", unconfigured: "未配置", unknown: "状态未知" };
  let destroyed = false;
  const unsubscribe = store.subscribe(({ data, checking }) => {
    const state = data.overall || "unknown";
    const label = state === "healthy" ? "知识连接正常" : state === "checking" ? "检查连接" : state === "unknown" ? "连接状态未知" : "本地知识";
    trigger.dataset.state = state;
    trigger.querySelector(".knowledge-connection-label").textContent = label;
    trigger.setAttribute("aria-label", `${label}，查看 Neo4j 与 Qdrant 连接详情`);
    trigger.title = `${label} · Neo4j / Qdrant`;
    summary.textContent = state === "healthy" ? "远程知识库可用，使用图谱与向量联合检索。" : state === "unknown" ? "暂时无法读取连接状态，请重新检查。实际检索策略由服务端判断。" : state === "checking" ? "正在检查知识库连接…" : "当前使用已审核的本地知识，自动跳过不可用的远程检索。";
    for (const name of ["neo4j", "qdrant"]) {
      const component = data.components?.[name];
      const node = dialog.querySelector(`[data-connection="${name}"]`);
      node.dataset.state = component?.status || "unknown";
      node.textContent = component?.code === "education_qdrant_collection_missing" ? "索引未就绪" : labels[component?.status] || "状态未知";
    }
    const checked = new Date(data.checked_at || NaN);
    dialog.querySelector("time").textContent = Number.isFinite(checked.getTime()) ? `检查于 ${checked.toLocaleTimeString("zh-CN", {hour12:false})}` : "尚无检查结果";
    refresh.disabled = checking;
    refresh.textContent = checking ? "检查中…" : "重新检查";
  });
  const focus = () => {
    if (destroyed || trigger.hidden || !trigger.isConnected) return false;
    trigger.focus({ preventScroll: true });
    return true;
  };
  trigger.addEventListener("click", () => { if (!dialog.open) { dialog.showModal(); trigger.setAttribute("aria-expanded", "true"); } });
  dialog.querySelector(".knowledge-connection-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { trigger.setAttribute("aria-expanded", "false"); if (!destroyed && !focus()) restoreFocus?.(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  refresh.addEventListener("click", () => store.check(true));
  const api = Object.freeze({
    trigger, dialog, store, focus,
    setVisible(visible) {
      trigger.hidden = !visible;
      if (!visible && dialog.open) dialog.close();
    },
    destroy() {
      destroyed = true;
      unsubscribe();
      if (dialog.open) dialog.close();
      trigger.remove();
      dialog.remove();
      mountedViews.delete(container);
    }
  });
  mountedViews.set(container, api);
  store.start();
  return api;
}
