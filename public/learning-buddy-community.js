const SHARES = [
  { id: "share-1", type: "question", author: "周同学", avatar: "周", time: "12 分钟前", title: "这道相似三角形，我用面积比验证了一遍", body: "先找出两组对应边，再用面积比等于相似比的平方检查结果。最后把 2:3 代回去，答案就不容易写反。", tags: ["相似三角形", "一题多解"], likes: 18, comments: 4, saved: false },
  { id: "share-2", type: "knowledge", author: "陈老师", avatar: "陈", time: "1 小时前", title: "一次函数：先看变化率，再写表达式", body: "把‘每增加 1 个单位，y 怎么变’说成一句话，斜率的正负和大小就很直观了。适合在做题前先口头解释。", tags: ["一次函数", "知识点卡片"], likes: 26, comments: 7, saved: true },
  { id: "share-3", type: "question", author: "林知夏", avatar: "林", time: "昨天", title: "我把错题改成了一个三步检查清单", body: "①读清条件 ②写出关系式 ③用原条件回代。做完后再看单位和符号，能少丢很多分。", tags: ["错题复盘", "检查清单"], likes: 12, comments: 2, saved: false },
  { id: "share-4", type: "knowledge", author: "小组 · 理科实验", avatar: "理", time: "昨天", title: "实验读数的原帧标注，欢迎一起补充", body: "把视线与刻度线保持水平的那一帧标出来，再对照读数。大家可以在评论里补充自己实验中的易错点。", tags: ["实验操作", "原帧复盘"], likes: 9, comments: 5, saved: false }
];

const communityState = { filter: "all", selectedId: "share-1", shares: SHARES.map((share) => ({ ...share })) };

export function initLearningBuddyCommunity(root = document.querySelector("#learningBuddyWorkspace")) {
  if (!root || root.dataset.buddyCommunityMounted === "true") return;
  root.dataset.buddyCommunityMounted = "true";
  const feed = root.querySelector("#buddyCommunityFeed");
  const detail = root.querySelector("#buddyCommunityDetail");
  const composer = root.querySelector("#buddyCommunityComposer");
  if (!feed || !detail || !composer) return;
  const render = () => {
    const list = communityState.shares.filter((share) => communityState.filter === "all" || share.type === communityState.filter);
    feed.innerHTML = list.length ? list.map(renderShare).join("") : '<div class="buddy-community-empty"><i data-lucide="inbox" aria-hidden="true"></i><b>还没有这类分享</b><p>换个筛选或发布第一条内容。</p></div>';
    root.querySelector("#buddyCommunityCount").textContent = `${list.length} 条分享`;
    root.querySelectorAll("[data-buddy-filter]").forEach((button) => {
      const selected = button.dataset.buddyFilter === communityState.filter;
      button.classList.toggle("is-active", selected); button.setAttribute("aria-selected", String(selected));
    });
    renderDetail();
    window.lucide?.createIcons?.();
  };
  const renderDetail = () => {
    const share = communityState.shares.find((item) => item.id === communityState.selectedId);
    if (!share) { detail.innerHTML = '<div class="buddy-community-detail-empty"><i data-lucide="mouse-pointer-click" aria-hidden="true"></i><b>选择一条分享</b><p>查看完整思路，收藏后可在题库或知识地图继续学习。</p></div>'; return; }
    detail.innerHTML = `<header><span class="page-eyebrow">分享详情</span><button type="button" class="buddy-detail-close" data-buddy-detail-close aria-label="关闭详情"><i data-lucide="x" aria-hidden="true"></i></button></header><div class="buddy-detail-author"><span>${escapeHtml(share.avatar)}</span><div><b>${escapeHtml(share.author)}</b><small>${escapeHtml(share.time)} · ${share.type === "question" ? "题目分享" : "知识点卡片"}</small></div></div><h3>${escapeHtml(share.title)}</h3><p class="buddy-detail-body">${escapeHtml(share.body)}</p><div class="buddy-detail-tags">${share.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div><div class="buddy-detail-actions"><button type="button" data-buddy-share-action="like"><i data-lucide="heart" aria-hidden="true"></i>${share.likes}</button><button type="button" data-buddy-share-action="comment"><i data-lucide="message-circle" aria-hidden="true"></i>${share.comments}</button><button type="button" class="${share.saved ? "is-saved" : ""}" data-buddy-share-action="save"><i data-lucide="bookmark" aria-hidden="true"></i>${share.saved ? "已收藏" : "收藏"}</button></div><div class="buddy-detail-next"><b>继续学习</b><p>${share.type === "question" ? "把这道题带入练习，看看自己能否独立完成。" : "打开知识地图，查看它和已学内容的关系。"}</p><button type="button" class="btn btn-primary" data-buddy-share-action="continue">${share.type === "question" ? "带入练习" : "打开知识地图"}<i data-lucide="arrow-right" aria-hidden="true"></i></button></div>`;
    window.lucide?.createIcons?.();
  };
  root.addEventListener("click", (event) => {
    const filter = event.target.closest("[data-buddy-filter]");
    if (filter) { communityState.filter = filter.dataset.buddyFilter; render(); return; }
    const share = event.target.closest("[data-buddy-share]");
    if (share) { communityState.selectedId = share.dataset.buddyShare; renderDetail(); return; }
    const action = event.target.closest("[data-buddy-action]");
    if (action) {
      if (action.dataset.buddyAction === "compose") { composer.hidden = false; composer.querySelector("input")?.focus(); }
      if (action.dataset.buddyAction === "cancel-compose") composer.hidden = true;
      return;
    }
    const shareAction = event.target.closest("[data-buddy-share-action]");
    if (!shareAction) return;
    const current = communityState.shares.find((item) => item.id === communityState.selectedId);
    if (!current) return;
    if (shareAction.dataset.buddyShareAction === "like") current.likes += 1;
    if (shareAction.dataset.buddyShareAction === "comment") { current.comments += 1; showBuddyCommunityToast("评论入口已打开（演示）"); }
    if (shareAction.dataset.buddyShareAction === "save") { current.saved = !current.saved; showBuddyCommunityToast(current.saved ? "已收藏到学习记录" : "已取消收藏"); }
    if (shareAction.dataset.buddyShareAction === "continue") { document.dispatchEvent(new CustomEvent("workspace:navigate", { detail: { view: current.type === "question" ? "bank" : "graph" } })); }
    render();
  });
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(composer);
    const title = String(data.get("title") || "").trim(); const body = String(data.get("body") || "").trim();
    if (!title || !body) return;
    communityState.shares.unshift({ id: `share-local-${Date.now()}`, type: "knowledge", author: document.querySelector("#learningUserName")?.textContent?.trim() || "我", avatar: (document.querySelector("#learningUserAvatar")?.textContent || "我").slice(0, 1), time: "刚刚", title, body, tags: ["我的分享"], likes: 0, comments: 0, saved: false });
    composer.reset(); composer.hidden = true; communityState.filter = "all"; communityState.selectedId = communityState.shares[0].id; render(); showBuddyCommunityToast("已发布到学习搭子");
  });
  render();
}

function renderShare(share) {
  return `<button type="button" class="buddy-share-card ${share.id === communityState.selectedId ? "is-selected" : ""}" data-buddy-share="${share.id}"><div class="buddy-share-card-head"><span class="buddy-share-avatar">${escapeHtml(share.avatar)}</span><span><b>${escapeHtml(share.author)}</b><small>${escapeHtml(share.time)} · ${share.type === "question" ? "题目分享" : "知识点卡片"}</small></span><i data-lucide="chevron-right" aria-hidden="true"></i></div><h3>${escapeHtml(share.title)}</h3><p>${escapeHtml(share.body)}</p><div class="buddy-share-foot"><span>${share.tags.map((tag) => `<em>${escapeHtml(tag)}</em>`).join("")}</span><span><small><i data-lucide="heart" aria-hidden="true"></i>${share.likes}</small><small><i data-lucide="message-circle" aria-hidden="true"></i>${share.comments}</small>${share.saved ? '<small class="is-saved"><i data-lucide="bookmark" aria-hidden="true"></i>已收藏</small>' : ""}</span></div></button>`;
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function showBuddyCommunityToast(message) { let toast = document.querySelector("#learningWorkbenchToast"); if (!toast) { toast = document.createElement("div"); toast.id = "learningWorkbenchToast"; toast.className = "learning-workbench-toast"; document.body.append(toast); } toast.textContent = message; toast.classList.add("is-visible"); window.setTimeout(() => toast.classList.remove("is-visible"), 1600); }
