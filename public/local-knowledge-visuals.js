import { mountInteractiveVisual } from "./interactive-visual-renderer.js";

const DEFAULT_CATALOG_URL = "./data/junior-math-visual-artifacts.json";
const VISUAL_SCHEMA = "junior-math-visual-artifacts@1.0";
const MODE_LABELS = Object.freeze({ mindmap: "知识网络", interactive: "互动图解" });
const QUERY_NOISE = /(?:请|给我|帮我|老师|一下|一个|一份|一张|查看|打开|展示|生成|画|做|讲解|说明|关于|对应的|知识点|思维导图|知识网络|知识图谱|关系图|互动图解|交互图|可视化)/gu;
const KNOWLEDGE_ANCHORS = Object.freeze([
  "一元一次不等式组", "一元一次不等式", "二元一次方程组", "一元二次方程", "一元一次方程",
  "反比例函数", "正比例函数", "一次函数", "二次函数", "勾股定理", "全等三角形", "相似三角形", "直角三角形",
  "算术平方根", "平方根", "立方根", "有理数", "无理数", "中位数", "平均数", "圆周角", "圆心角", "弧长", "扇形", "概率", "频率"
]);
const CONTEXT_FOLLOW_UP_PATTERN = /^(?:请)?(?:再|继续)?(?:解释|分析|判断|讲|说|说明|展开|举例|演示|画|看看|为什么|怎么算|怎么做)(?:一下|一下子|这个|它|该知识点|呢|吧|吗|？|\?|。)*$/u;

let catalogRequest = null;

export async function loadLocalKnowledgeVisualCatalog(url = DEFAULT_CATALOG_URL) {
  if (!catalogRequest) {
    catalogRequest = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`本地知识图解加载失败（${response.status}）`);
        return createLocalKnowledgeVisualIndex(await response.json());
      })
      .catch((error) => {
        catalogRequest = null;
        throw error;
      });
  }
  return catalogRequest;
}

export function createLocalKnowledgeVisualIndex(catalog = {}) {
  if (catalog?.schema_version !== VISUAL_SCHEMA || !Array.isArray(catalog.artifacts)) {
    throw new TypeError("本地知识图解协议不兼容");
  }
  const artifacts = catalog.artifacts.filter(isUsableArtifact);
  const byArtifactId = new Map();
  const byKnowledgePointId = new Map();
  for (const artifact of artifacts) {
    byArtifactId.set(String(artifact.artifact_id), artifact);
    byKnowledgePointId.set(String(artifact.knowledge_point_id), artifact);
  }
  return Object.freeze({
    schema_version: catalog.schema_version,
    artifact_set_id: String(catalog.artifact_set_id || ""),
    artifacts,
    byArtifactId,
    byKnowledgePointId,
    statistics: catalog.statistics || {}
  });
}

export function resolveLocalKnowledgeVisual(index, query, { knowledgePointId = "" } = {}) {
  if (!index?.artifacts?.length) return null;
  const directId = String(knowledgePointId || "").trim();
  if (directId && index.byKnowledgePointId.has(directId)) {
    return index.byKnowledgePointId.get(directId);
  }
  const rawQuery = String(query || "").slice(0, 800);
  for (const artifact of index.artifacts) {
    if (rawQuery.includes(artifact.knowledge_point_id)) return artifact;
  }
  if (isLocalKnowledgeFollowUpQuery(rawQuery)) return null;
  const normalizedQuery = normalizeSearchText(rawQuery.replace(QUERY_NOISE, ""));
  const fallbackQuery = normalizeSearchText(rawQuery);
  if (fallbackQuery.length < 2) return null;

  let best = null;
  let bestScore = 0;
  let bestRun = 0;
  let bestHasAnchor = false;
  for (const artifact of index.artifacts) {
    const title = normalizeSearchText(artifact.title);
    const description = normalizeSearchText(artifact.source?.outline_description);
    const primary = normalizedQuery.length >= 2 ? normalizedQuery : fallbackQuery;
    const titleRun = longestCommonRun(primary, title);
    const fallbackRun = longestCommonRun(fallbackQuery, title);
    const descriptionRun = longestCommonRun(primary, description);
    let score = Math.max(titleRun ** 3, fallbackRun ** 3 * 0.92, descriptionRun ** 3 * 0.78);
    score += scoreKnowledgeAnchors(fallbackQuery, title);
    if (primary && title.includes(primary)) score += 240 + primary.length * 12;
    if (title && primary.includes(title)) score += 320 + title.length * 9;
    if (/\b(?:@)?M4-[A-Z-]+\d+\b/iu.test(rawQuery) && rawQuery.includes(artifact.knowledge_point_id)) score += 1000;
    if (/(?:图象|图像|坐标)/u.test(rawQuery) && /(?:图象|图像|坐标)/u.test(artifact.title)) score += 34;
    if (/(?:定义|概念|理解|解释|讲解|思维导图)/u.test(rawQuery) && /(?:理解|识别|认识)/u.test(artifact.title)) score += 42;
    score -= Math.min(title.length, 80) * 0.08;
    if (score > bestScore) {
      best = artifact;
      bestScore = score;
      bestRun = Math.max(titleRun, fallbackRun, descriptionRun);
      bestHasAnchor = hasMatchingKnowledgeAnchor(fallbackQuery, title);
    }
  }
  // Two-character overlaps such as “分析” and “判断” occur in many knowledge
  // point names.  They are not sufficient evidence for choosing a new point.
  return bestScore >= 20 && (bestRun >= 3 || bestHasAnchor) ? best : null;
}

export function isLocalKnowledgeFollowUpQuery(value) {
  const text = String(value || "").trim().replace(/\s+/gu, "");
  if (!text) return false;
  if (KNOWLEDGE_ANCHORS.some((anchor) => text.includes(anchor))) return false;
  if (/(?:@M4-|知识点|函数|方程|不等式|数轴|三角形|四边形|圆|概率|统计|坐标|对称|旋转|平移)/u.test(text)) return false;
  return CONTEXT_FOLLOW_UP_PATTERN.test(text);
}

export function inferLocalKnowledgeVisualMode(text, fallback = "") {
  const value = String(text || "");
  if (/(?:思维导图|知识网络|知识图谱|关系图|前置|前后置|后续知识|关联知识)/u.test(value)) return "mindmap";
  if (/(?:互动图|交互图|函数图|图象|图像|几何图|数轴|坐标图|动态演示|可视化)/u.test(value)) return "interactive";
  return fallback === "mindmap" || fallback === "interactive" ? fallback : "";
}

export function mountLocalKnowledgeVisual(container, artifact, {
  initialMode = "mindmap",
  compact = true,
  inputValues = {},
  onClose,
  onModeChange
} = {}) {
  if (!container || !isUsableArtifact(artifact)) return null;
  const doc = container.ownerDocument || globalThis.document;
  if (!doc?.createElement) return null;

  const card = doc.createElement("section");
  card.className = "local-knowledge-visual";
  card.dataset.artifactId = artifact.artifact_id;
  card.dataset.knowledgePointId = artifact.knowledge_point_id;

  const header = doc.createElement("header");
  header.className = "local-knowledge-visual-head";
  const titleBlock = doc.createElement("div");
  const eyebrow = doc.createElement("span");
  eyebrow.textContent = "本地知识素材";
  const title = doc.createElement("h4");
  title.textContent = artifact.title;
  titleBlock.append(eyebrow, title);

  const controls = doc.createElement("div");
  controls.className = "local-knowledge-visual-tabs";
  const modeButtons = new Map();
  for (const mode of ["mindmap", "interactive"]) {
    const button = doc.createElement("button");
    button.type = "button";
    button.dataset.localVisualMode = mode;
    button.textContent = MODE_LABELS[mode];
    button.setAttribute("aria-pressed", "false");
    controls.append(button);
    modeButtons.set(mode, button);
  }
  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "local-knowledge-visual-close";
  closeButton.setAttribute("aria-label", "关闭图解");
  closeButton.title = "关闭图解";
  closeButton.textContent = "×";
  controls.append(closeButton);
  header.append(titleBlock, controls);

  const stage = doc.createElement("div");
  stage.className = "local-knowledge-visual-stage";
  const source = doc.createElement("footer");
  const sourceLabel = doc.createElement("b");
  const sourceQuote = getSourceQuote(artifact.source);
  sourceLabel.textContent = sourceQuote.isVerbatim ? "课标原文" : "课标知识点表述";
  const quote = doc.createElement("q");
  quote.textContent = sourceQuote.text;
  const locator = doc.createElement("span");
  locator.textContent = `${artifact.source.document_title || "义务教育数学课程标准（2022年版）"} · 第 ${artifact.source.printed_page || "-"} 页`;
  source.append(sourceLabel, quote, locator);
  card.append(header, stage, source);
  container.replaceChildren(card);

  let activeMode = "";
  let destroyInteractive = null;
  let destroyed = false;
  const setMode = (nextMode) => {
    if (destroyed) return;
    const mode = nextMode === "interactive" ? "interactive" : "mindmap";
    destroyInteractive?.();
    destroyInteractive = null;
    stage.replaceChildren();
    if (mode === "interactive") {
      destroyInteractive = mountInteractiveVisual(stage, adaptInteractiveArtifact(artifact, inputValues), { compact });
    } else {
      renderLocalMindmap(stage, artifact.mindmap);
    }
    activeMode = mode;
    card.dataset.visualMode = mode;
    for (const [key, button] of modeButtons) button.setAttribute("aria-pressed", String(key === mode));
    onModeChange?.(mode);
  };
  for (const [mode, button] of modeButtons) button.addEventListener("click", () => setMode(mode));
  closeButton.addEventListener("click", () => onClose?.());
  setMode(initialMode);

  return {
    element: card,
    get mode() { return activeMode; },
    setMode,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      destroyInteractive?.();
      card.remove();
    }
  };
}

function getSourceQuote(source = {}) {
  const verbatim = String(source.verbatim_text || "").trim();
  if (source.is_verbatim === true && verbatim) return { text: verbatim, isVerbatim: true };
  const quotes = Array.isArray(source.verbatim_quotes)
    ? source.verbatim_quotes.map((item) => String(item?.text || item || "").trim()).filter(Boolean)
    : [];
  if (source.is_verbatim === true && quotes.length) return { text: quotes.join("；"), isVerbatim: true };
  return { text: String(source.outline_description || ""), isVerbatim: false };
}

function renderLocalMindmap(container, mindmap = {}) {
  const doc = container.ownerDocument;
  const map = doc.createElement("div");
  map.className = "local-mindmap";
  map.setAttribute("role", "tree");
  const root = doc.createElement("div");
  root.className = "local-mindmap-root";
  root.setAttribute("role", "treeitem");
  root.textContent = String(mindmap.root || "当前知识点");
  const branches = doc.createElement("div");
  branches.className = "local-mindmap-branches";
  for (const branch of Array.isArray(mindmap.branches) ? mindmap.branches.slice(0, 5) : []) {
    const section = doc.createElement("section");
    section.className = `local-mindmap-branch is-${safeToken(branch.kind)}`;
    section.setAttribute("role", "group");
    const heading = doc.createElement("h5");
    heading.textContent = String(branch.title || "关联知识");
    const list = doc.createElement("ul");
    for (const child of Array.isArray(branch.children) ? branch.children : []) {
      const item = doc.createElement("li");
      item.setAttribute("role", "treeitem");
      const label = doc.createElement("span");
      label.textContent = String(child.label || "");
      item.append(label);
      const relationText = Array.isArray(child.relation_labels) && child.relation_labels.length
        ? child.relation_labels.join(" · ")
        : child.relation_label;
      if (relationText) {
        const relation = doc.createElement("small");
        relation.textContent = String(relationText);
        item.append(relation);
      }
      list.append(item);
    }
    section.append(heading, list);
    branches.append(section);
  }
  map.append(root, branches);
  container.append(map);
}

function adaptInteractiveArtifact(artifact, inputValues = {}) {
  const interactive = artifact.interactive || {};
  const data = interactive.data && typeof interactive.data === "object" ? interactive.data : {};
  return {
    ...interactive.viewport,
    ...interactive,
    id: artifact.artifact_id,
    title: artifact.title,
    description: interactive.instruction,
    input_values: inputValues,
    values: data.sample || data.values || interactive.values,
    labels: data.labels || interactive.labels,
    items: data.steps || interactive.items,
    center: data.focus || interactive.center,
    outcomes: data.outcomes || interactive.outcomes
  };
}

function isUsableArtifact(artifact) {
  return Boolean(
    artifact &&
    typeof artifact === "object" &&
    typeof artifact.artifact_id === "string" &&
    typeof artifact.knowledge_point_id === "string" &&
    typeof artifact.title === "string" &&
    artifact.source?.outline_description &&
    artifact.mindmap?.root &&
    artifact.interactive?.variant
  );
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/[^\p{Script=Han}a-z0-9]/gu, "").slice(0, 240);
}

function longestCommonRun(a, b) {
  if (!a || !b) return 0;
  const left = String(a).slice(0, 240);
  const right = String(b).slice(0, 240);
  let best = 0;
  let previous = new Uint16Array(right.length + 1);
  for (let index = 1; index <= left.length; index += 1) {
    const current = new Uint16Array(right.length + 1);
    for (let other = 1; other <= right.length; other += 1) {
      if (left[index - 1] === right[other - 1]) {
        current[other] = previous[other - 1] + 1;
        if (current[other] > best) best = current[other];
      }
    }
    previous = current;
  }
  return best;
}

function scoreKnowledgeAnchors(query, title) {
  let score = 0;
  for (const anchor of KNOWLEDGE_ANCHORS) {
    const normalized = normalizeSearchText(anchor);
    if (!query.includes(normalized)) continue;
    score += title.includes(normalized) ? 520 + normalized.length * 18 : -460;
  }
  return score;
}

function hasMatchingKnowledgeAnchor(query, title) {
  return KNOWLEDGE_ANCHORS.some((anchor) => {
    const normalized = normalizeSearchText(anchor);
    return query.includes(normalized) && title.includes(normalized);
  });
}

function safeToken(value) {
  return String(value || "branch").toLowerCase().replace(/[^a-z0-9_-]/gu, "").slice(0, 32) || "branch";
}
