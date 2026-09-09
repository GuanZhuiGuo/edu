// Display server-owned retrieval health. This UI never decides retrieval policy.
export function mountKnowledgeConnectionStatus() {
  const actions = document.querySelector(".global-actions");
  if (!actions || document.querySelector("#knowledgeConnectionButton")) return;
  const trigger = document.createElement("button");
  trigger.id = "knowledgeConnectionButton";
  trigger.className = "knowledge-connection-button";
  trigger.type = "button";
  trigger.dataset.state = "checking";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", "knowledgeConnectionDialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = '<span class="knowledge-connection-dot" aria-hidden="true"></span><span class="knowledge-connection-label">检查连接</span>';
  actions.prepend(trigger);
  const dialog = document.createElement("dialog");
  dialog.id = "knowledgeConnectionDialog";
  dialog.className = "knowledge-connection-dialog";
  dialog.setAttribute("aria-labelledby", "knowledgeConnectionTitle");
  dialog.innerHTML = `<header><div><h2 id="knowledgeConnectionTitle">知识库连接</h2><p>连接不可用时，继续检索已审核的本地知识。</p></div><button type="button" class="knowledge-connection-close" aria-label="关闭连接详情">×</button></header><div class="knowledge-connection-summary" role="status" aria-live="polite"></div><dl><div><dt><strong>Neo4j</strong><span>知识关系图谱</span></dt><dd data-connection="neo4j">检查中</dd></div><div><dt><strong>Qdrant</strong><span>知识向量检索</span></dt><dd data-connection="qdrant">检查中</dd></div></dl><p class="knowledge-connection-note">后台会定期检查，恢复后自动使用远程检索。</p><footer><time></time><button type="button" class="knowledge-connection-refresh">重新检查</button></footer>`;
  document.body.append(dialog);
  const refresh = dialog.querySelector(".knowledge-connection-refresh");
  const summary = dialog.querySelector(".knowledge-connection-summary");
  const labels = { healthy: "已连接", unavailable: "不可用", checking: "检查中", unconfigured: "未配置", unknown: "状态未知" };
  let pending;
  let current;
  let timer;
  const render = (data) => {
    current = data;
    const state = data.overall || "unknown";
    const label = state === "healthy" ? "知识连接正常" : state === "checking" ? "检查连接" : state === "unknown" ? "连接状态未知" : "本地知识";
    trigger.dataset.state = state;
    trigger.querySelector(".knowledge-connection-label").textContent = label;
    trigger.setAttribute("aria-label", `${label}，查看知识库连接详情`);
    trigger.title = label;
    summary.textContent = state === "healthy" ? "远程知识库可用，使用图谱与向量联合检索。" : state === "unknown" ? "暂时无法读取连接状态，请重新检查。实际检索策略由服务端判断。" : state === "checking" ? "正在检查知识库连接…" : "当前使用已审核的本地知识，自动跳过不可用的远程检索。";
    for (const name of ["neo4j", "qdrant"]) {
      const component = data.components?.[name];
      const node = dialog.querySelector(`[data-connection="${name}"]`);
      node.dataset.state = component?.status || "unknown";
      node.textContent = component?.code === "education_qdrant_collection_missing" ? "索引未就绪" : labels[component?.status] || "状态未知";
    }
    const checked = new Date(data.checked_at || NaN);
    dialog.querySelector("time").textContent = Number.isFinite(checked.getTime()) ? `检查于 ${checked.toLocaleTimeString("zh-CN", {hour12:false})}` : "尚无检查结果";
  };
  const schedule = () => { clearTimeout(timer); if (!document.hidden) timer = setTimeout(() => check(), 30000); };
  const check = (manual = false) => {
    if (pending) return pending;
    refresh.disabled = true;
    refresh.textContent = "检查中…";
    if (!current) render({overall:"checking",components:{neo4j:{status:"checking"},qdrant:{status:"checking"}}});
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    pending = (async () => {
      try {
        const response = await fetch(`/api/education/knowledge/connections${manual ? "?refresh=1" : ""}`, {cache:"no-store",signal:controller.signal});
        if (!response.ok) throw new Error("Connection status unavailable");
        const data = await response.json();
        if (!data.components || !data.retrieval) throw new Error("Invalid connection status");
        render(data);
      } catch { render({overall:"unknown"}); }
      finally { clearTimeout(timeout); pending = null; refresh.disabled = false; refresh.textContent = "重新检查"; schedule(); }
    })();
    return pending;
  };
  trigger.addEventListener("click", () => { dialog.showModal(); trigger.setAttribute("aria-expanded", "true"); if (!current) check(); });
  dialog.querySelector(".knowledge-connection-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { trigger.setAttribute("aria-expanded", "false"); trigger.focus(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  refresh.addEventListener("click", () => check(true));
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(timer); else check(); });
  window.addEventListener("online", () => check());
  check();
}
