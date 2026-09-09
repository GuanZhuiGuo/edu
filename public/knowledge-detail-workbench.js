import { mountInteractiveVisual } from "./interactive-visual-renderer.js";

const MATERIAL_META = Object.freeze({
  function: { label: "函数图", icon: "chart-spline" },
  geometry: { label: "几何图", icon: "triangle" },
  numberline: { label: "数轴", icon: "move-horizontal" },
  physics: { label: "物理实验", icon: "telescope" },
  chemistry: { label: "化学实验", icon: "flask-conical" }
});

const detailVisualDestroyers = new WeakMap();

export function clearKnowledgeDetailWorkbench(root) {
  if (!root) return;
  detailVisualDestroyers.get(root)?.();
  detailVisualDestroyers.delete(root);
}

export function inferKnowledgeMaterialType(point = {}, domainName = "") {
  const text = `${point.name || ""} ${point.measurable_behavior || ""} ${domainName}`;
  if (/函数|图象|图像|坐标|变量/.test(text)) return "function";
  if (/三角|四边|多边|圆|几何|勾股|相似|全等|平行|垂直|角/.test(text)) return "geometry";
  if (/数轴|不等|绝对值|有理数|实数|正负数|数与代数/.test(text)) return "numberline";
  return domainName.includes("图形") ? "geometry" : "numberline";
}

export function renderKnowledgeDetailWorkbench(root, options = {}) {
  if (!root) return;
  const {
    point,
    visualArtifact,
    domainName = "",
    themeName = "",
    record = {},
    masteryMeta = { label: "未评估" },
    relations = { prerequisites: [], successors: [], related: [] },
    masteryById = new Map(),
    sourceTitle = "《义务教育数学课程标准（2022年版）》",
    preference,
    questions = [],
    onSelectPoint,
    onAsk,
    onPractice,
    onOpenQuestion,
    onOpenQuestionList
  } = options;
  if (!point) return;

  clearKnowledgeDetailWorkbench(root);

  const inferredType = inferKnowledgeMaterialType(point, domainName);
  const source = visualArtifact?.source || {};
  const sourceDescription = source.outline_description || point.measurable_behavior || point.name;
  const sourceQuote = resolveSourceQuote(source, sourceDescription);
  const sourceDocumentTitle = source.document_title || sourceTitle;
  const sourcePage = source.printed_page || point.source_ref?.printed_page || "-";
  root.innerHTML = `<article class="knowledge-detail-workbench">
    <header class="knowledge-detail-workbench-head">
      <div class="knowledge-detail-title-block">
        <span>${escapeHTML(domainName)}${themeName ? ` / ${escapeHTML(themeName)}` : ""}</span>
        <h2>${escapeHTML(point.name)}</h2>
        <p>${escapeHTML(sourceDescription)}</p>
      </div>
      <div class="knowledge-detail-head-actions">
        <em class="mastery-${escapeHTML(record.mastery_state || "unassessed")}">${escapeHTML(masteryMeta.label)}${record.mastery_probability == null ? "" : ` · ${Math.round(record.mastery_probability * 100)}%`}</em>
        <button type="button" data-detail-ask><i data-lucide="message-circle" aria-hidden="true"></i>问AI教师</button>
        <button type="button" data-detail-practice><i data-lucide="pencil-line" aria-hidden="true"></i>练习</button>
      </div>
    </header>

    <section class="knowledge-relation-workspace" aria-labelledby="knowledgeRelationTitle">
      <header><div><span>知识关系</span><h3 id="knowledgeRelationTitle">前置、后续与关联知识</h3></div><div class="relation-legend"><span><i class="is-prerequisite"></i>前置</span><span><i class="is-successor"></i>后续</span><span><i class="is-related"></i>关联</span></div></header>
      ${renderRelationMap(point, relations, masteryById)}
    </section>

    <div class="knowledge-detail-content-grid">
      <section class="knowledge-material-workspace" aria-labelledby="knowledgeMaterialTitle">
        <header>
          <div><span>互动图解</span><h3 id="knowledgeMaterialTitle">${escapeHTML(MATERIAL_META[inferredType].label)}</h3></div>
          <label><span>切换图解</span><select data-material-select>
            <option value="auto">本知识点互动图</option>
            <option value="function">函数图</option>
            <option value="geometry">几何图</option>
            <option value="numberline">数轴</option>
          </select></label>
        </header>
        <div class="knowledge-material-stage" data-material-stage></div>
      </section>

      <aside class="knowledge-source-column">
        <section class="knowledge-source-card">
          <header><span>${sourceQuote.isVerbatim ? "课标原文" : "课标知识点表述"}</span><i data-lucide="quote" aria-hidden="true"></i></header>
          <blockquote>${escapeHTML(sourceQuote.text)}</blockquote>
          <footer><b>${escapeHTML(sourceDocumentTitle)}</b><span>第 ${escapeHTML(sourcePage)} 页</span></footer>
        </section>
        <section class="knowledge-state-card">
          <header><span>学习情况</span><b>${Number(record.evidence_count || 0)} 条证据</b></header>
          <div><span style="--mastery-progress:${record.mastery_probability == null ? 0 : Math.round(record.mastery_probability * 100)}%"></span></div>
          <p>${preference ? escapeHTML(preference.note) : "继续通过作答、错题和讲解记录更新掌握状态。"}</p>
        </section>
      </aside>
    </div>

    ${renderKnowledgeStrategyWorkspace(questions)}
    ${renderKnowledgeQuestionWorkspace(questions)}
  </article>`;

  root.querySelectorAll("[data-relation-point]").forEach((button) => {
    button.addEventListener("click", () => onSelectPoint?.(button.dataset.relationPoint));
  });
  root.querySelector("[data-detail-ask]")?.addEventListener("click", () => onAsk?.(point));
  root.querySelector("[data-detail-practice]")?.addEventListener("click", () => onPractice?.(point));
  root.querySelectorAll("[data-detail-question]").forEach((button) => {
    button.addEventListener("click", () => onOpenQuestion?.(button.dataset.detailQuestion, point));
  });
  root.querySelector("[data-detail-question-list]")?.addEventListener("click", () => onOpenQuestionList?.(point));

  const stage = root.querySelector("[data-material-stage]");
  const title = root.querySelector("#knowledgeMaterialTitle");
  const select = root.querySelector("[data-material-select]");
  let destroyInteractive = null;
  const renderSelectedMaterial = () => {
    destroyInteractive?.();
    destroyInteractive = null;
    const requested = select?.value || "auto";
    if (requested === "auto" && visualArtifact?.interactive) {
      if (title) title.textContent = visualArtifact.interactive.title || "互动图解";
      destroyInteractive = mountInteractiveVisual(stage, {
        ...visualArtifact.interactive.viewport,
        ...visualArtifact.interactive,
        id: visualArtifact.artifact_id,
        description: visualArtifact.interactive.instruction,
        values: visualArtifact.interactive.data?.sample,
        items: visualArtifact.interactive.data?.steps,
        center: visualArtifact.interactive.data?.focus,
        outcomes: visualArtifact.interactive.data?.outcomes
      });
      detailVisualDestroyers.set(root, () => destroyInteractive?.());
      return;
    }
    const selected = requested === "auto" ? inferredType : requested;
    if (title) title.textContent = MATERIAL_META[selected]?.label || MATERIAL_META[inferredType].label;
    renderMaterial(stage, selected, point);
  };
  select?.addEventListener("change", renderSelectedMaterial);
  renderSelectedMaterial();
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

export function buildKnowledgeStrategyGuide(questions = []) {
  const related = Array.isArray(questions) ? questions.filter(Boolean) : [];
  const strategies = uniqueText(related.flatMap((question) => [
    ...(Array.isArray(question.attributes?.strategies) ? question.attributes.strategies : []),
    ...(Array.isArray(question.raw?.solution_preview?.strategy_labels) ? question.raw.solution_preview.strategy_labels : [])
  ])).slice(0, 6);
  const hints = uniqueText(related.flatMap((question) => [
    question.raw?.solution_preview?.first_hint,
    question.solutionPreview?.first_hint,
    question.analysis
  ])).slice(0, 3);
  const questionTypes = uniqueText(related.map((question) => question.type)).slice(0, 5);
  const propositionMethods = uniqueText(related.map((question) => (
    question.raw?.proposition_method?.label
    || question.attributes?.propositionMethod
    || ""
  ))).slice(0, 5);
  return Object.freeze({
    strategies: Object.freeze(strategies),
    hints: Object.freeze(hints),
    questionTypes: Object.freeze(questionTypes),
    propositionMethods: Object.freeze(propositionMethods),
    questionCount: related.length
  });
}

function renderKnowledgeStrategyWorkspace(questions) {
  const guide = buildKnowledgeStrategyGuide(questions);
  const strategyText = guide.strategies.length
    ? guide.strategies.join(" · ")
    : "先识别对象和条件，再选择对应定义、关系或模型";
  const hintText = guide.hints[0]
    || "圈出已知与目标，确认条件满足后再开始计算或证明。";
  const coverage = uniqueText([...guide.propositionMethods, ...guide.questionTypes]);
  return `<section class="knowledge-strategy-workspace" aria-labelledby="knowledgeStrategyTitle">
    <header><div><span>解题思路</span><h3 id="knowledgeStrategyTitle">从条件到验证</h3></div><em>${guide.questionCount ? `基于 ${guide.questionCount} 道关联题` : "通用方法"}</em></header>
    <div class="knowledge-strategy-steps">
      <article><span>01</span><div><b>读题定位</b><p>${escapeHTML(hintText)}</p></div></article>
      <article><span>02</span><div><b>选择策略</b><p>${escapeHTML(strategyText)}</p></div></article>
      <article><span>03</span><div><b>执行与核验</b><p>写清关键中间步骤，回到原条件检查范围、符号、单位和结论是否成立。</p></div></article>
    </div>
    ${coverage.length ? `<footer><span>常见考法</span>${coverage.map((item) => `<em>${escapeHTML(item)}</em>`).join("")}</footer>` : ""}
  </section>`;
}

function renderKnowledgeQuestionWorkspace(questions) {
  const allQuestions = Array.isArray(questions) ? questions : [];
  const related = allQuestions.slice(0, 4);
  const questionMarkup = related.length
    ? `<div class="knowledge-detail-question-list">${related.map((question) => `<button type="button" class="knowledge-detail-question-row result-${escapeHTML(question.result || "unknown")}" data-detail-question="${escapeHTML(question.id)}">
        <span class="knowledge-question-result" aria-hidden="true">${questionResultMark(question.result)}</span>
        <span class="knowledge-question-copy"><b>${escapeHTML(question.stem)}</b><small>${escapeHTML(question.type || "题目")} · ${escapeHTML(questionSourceLabel(question.source))} · ${escapeHTML(question.date || "")}</small></span>
        <span class="knowledge-question-state">${escapeHTML(questionResultLabel(question.result))}</span>
        <i data-lucide="chevron-right" aria-hidden="true"></i>
      </button>`).join("")}</div>`
    : `<div class="knowledge-detail-question-empty"><i data-lucide="notebook-tabs" aria-hidden="true"></i><div><b>还没有直接关联的题目</b><p>题库内容会按知识点归到这里。</p></div></div>`;
  return `<section class="knowledge-question-workspace" aria-labelledby="knowledgeQuestionTitle">
    <header><div><span>题库与作答</span><h3 id="knowledgeQuestionTitle">关联题目</h3></div><button type="button" data-detail-question-list>${related.length ? `查看全部 ${allQuestions.length} 道` : "去题库练习"}<i data-lucide="arrow-right" aria-hidden="true"></i></button></header>
    ${questionMarkup}
  </section>`;
}

function uniqueText(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function questionResultMark(result) {
  return result === "correct" ? "✓" : result === "wrong" ? "×" : result === "partial" ? "◐" : "·";
}

function questionResultLabel(result) {
  return { correct: "答对", wrong: "答错", partial: "部分正确", unattempted: "待练习" }[result] || "未判定";
}

function questionSourceLabel(source) {
  return { bank: "题库练习", exam: "试卷导入", homework: "作业导入", teacher: "AI教师" }[source] || source || "历史记录";
}

function resolveSourceQuote(source, fallback) {
  const verbatim = String(source?.verbatim_text || "").trim();
  if (source?.is_verbatim === true && verbatim) return { text: verbatim, isVerbatim: true };
  const quotes = Array.isArray(source?.verbatim_quotes)
    ? source.verbatim_quotes.map((item) => String(item?.text || item || "").trim()).filter(Boolean)
    : [];
  if (source?.is_verbatim === true && quotes.length) return { text: quotes.join("；"), isVerbatim: true };
  return { text: String(fallback || ""), isVerbatim: false };
}

function renderRelationMap(point, relations, masteryById) {
  const prerequisites = (relations.prerequisites || []).slice(0, 3);
  const successors = (relations.successors || []).slice(0, 3);
  const related = (relations.related || []).slice(0, 3);
  const placements = [];
  placeVertical(prerequisites, 14, placements, "prerequisite");
  placeVertical(successors, 86, placements, "successor");
  placeHorizontal(related, 82, placements, "related");
  const paths = placements.map((entry) => {
    const [fromX, fromY, toX, toY] = relationEndpoints(entry);
    const x1 = fromX * 9;
    const y1 = fromY * 3.2;
    const x2 = toX * 9;
    const y2 = toY * 3.2;
    const bend = entry.role === "related" ? y1 + (y2 - y1) * 0.52 : x1 + (x2 - x1) * 0.5;
    const d = entry.role === "related"
      ? `M ${x1} ${y1} C ${x1} ${bend}, ${x2} ${bend}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`;
    return `<path class="relation-edge is-${entry.role}" d="${d}"${entry.role === "related" ? "" : ' marker-end="url(#knowledge-arrow)"'} />`;
  }).join("");
  const nodes = placements.map((entry) => {
    const state = masteryById.get(entry.item.id)?.mastery_state || "unassessed";
    return `<button type="button" class="relation-map-node is-${entry.role} mastery-${escapeHTML(state)}" style="--node-x:${entry.x}%;--node-y:${entry.y}%" data-relation-point="${escapeHTML(entry.item.id)}" title="${escapeHTML(entry.item.name)}"><small>${roleLabel(entry.role)}</small><span>${escapeHTML(entry.item.name)}</span></button>`;
  }).join("");
  const empty = placements.length === 0 ? `<p class="relation-map-empty">暂无直接关系，仍可通过章节结构查看上下文。</p>` : "";
  return `<div class="relation-map-canvas">
    <svg viewBox="0 0 900 320" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="knowledge-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>${paths}</svg>
    <div class="relation-map-center"><small>当前知识点</small><b>${escapeHTML(point.name)}</b></div>${nodes}${empty}
  </div>`;
}

function placeVertical(items, x, placements, role) {
  const ys = items.length === 1 ? [50] : items.length === 2 ? [34, 66] : [22, 50, 78];
  items.forEach((item, index) => placements.push({ item, role, x, y: ys[index] }));
}

function placeHorizontal(items, y, placements, role) {
  const xs = items.length === 1 ? [50] : items.length === 2 ? [38, 62] : [30, 50, 70];
  items.forEach((item, index) => placements.push({ item, role, x: xs[index], y }));
}

function relationEndpoints(entry) {
  if (entry.role === "prerequisite") return [entry.x + 9, entry.y, 41, 50];
  if (entry.role === "successor") return [59, 50, entry.x - 9, entry.y];
  return [50, 62, entry.x, entry.y - 8];
}

function roleLabel(role) {
  return { prerequisite: "前置", successor: "后续", related: "关联" }[role] || "关联";
}

function renderMaterial(host, type, point) {
  if (!host) return;
  if (type === "function") renderFunctionMaterial(host, point);
  else if (type === "geometry") renderGeometryMaterial(host, point);
  else if (type === "physics") renderPhysicsMaterial(host);
  else if (type === "chemistry") renderChemistryMaterial(host);
  else renderNumberLineMaterial(host, point);
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function renderFunctionMaterial(host, point) {
  const pointText = `${point?.name || ""} ${point?.measurable_behavior || ""}`;
  if (/二次函数|抛物线|顶点|最值/.test(pointText)) {
    renderQuadraticFunctionMaterial(host, point);
    return;
  }
  renderLinearFunctionMaterial(host, point);
}

function renderLinearFunctionMaterial(host, point) {
  host.innerHTML = `<div class="interactive-material interactive-function-material">
    <div class="material-visual-frame">
      <svg data-function-plot viewBox="0 0 640 360" role="img" aria-label="可交互的一次函数图象">
        ${coordinateGrid()}
        <line data-function-line class="material-primary-line" />
        <circle data-function-y-intercept r="5" class="material-point"></circle>
        <circle data-function-x-intercept r="5" class="material-point is-secondary"></circle>
      </svg>
      <div class="material-equation" data-function-equation>y = x</div>
    </div>
    <div class="material-control-panel">
      <span>拖动参数，观察图象的倾斜与平移</span>
      <label><b>斜率 k</b><input data-function-k type="range" min="-4" max="4" step="0.25" value="1.5" /><output data-function-k-output>1.5</output></label>
      <label><b>截距 b</b><input data-function-b type="range" min="-5" max="5" step="0.5" value="1" /><output data-function-b-output>1</output></label>
      <dl><div><dt>y 轴交点</dt><dd data-function-y-value>(0, 1)</dd></div><div><dt>x 轴交点</dt><dd data-function-x-value>(-0.67, 0)</dd></div></dl>
      <p>${escapeHTML(point.name)}</p>
    </div>
  </div>`;
  const svg = host.querySelector("[data-function-plot]");
  const kInput = host.querySelector("[data-function-k]");
  const bInput = host.querySelector("[data-function-b]");
  const update = () => {
    const k = Number(kInput.value);
    const b = Number(bInput.value);
    const x1 = -6;
    const x2 = 6;
    setLine(host.querySelector("[data-function-line]"), plotX(x1), plotY(k * x1 + b), plotX(x2), plotY(k * x2 + b));
    setPoint(host.querySelector("[data-function-y-intercept]"), plotX(0), plotY(b));
    const xIntercept = Math.abs(k) < 0.001 ? null : -b / k;
    const xPoint = host.querySelector("[data-function-x-intercept]");
    if (xIntercept == null || xIntercept < -6 || xIntercept > 6) xPoint.setAttribute("visibility", "hidden");
    else {
      xPoint.removeAttribute("visibility");
      setPoint(xPoint, plotX(xIntercept), plotY(0));
    }
    host.querySelector("[data-function-k-output]").textContent = formatNumber(k);
    host.querySelector("[data-function-b-output]").textContent = formatNumber(b);
    host.querySelector("[data-function-equation]").textContent = `y = ${equationTerm(k, "x")}${signedTerm(b)}`;
    host.querySelector("[data-function-y-value]").textContent = `(0, ${formatNumber(b)})`;
    host.querySelector("[data-function-x-value]").textContent = xIntercept == null ? "无" : `(${formatNumber(xIntercept)}, 0)`;
  };
  [kInput, bInput].forEach((input) => input.addEventListener("input", update));
  update();
}

function renderQuadraticFunctionMaterial(host, point) {
  host.innerHTML = `<div class="interactive-material interactive-function-material">
    <div class="material-visual-frame">
      <svg data-quadratic-plot viewBox="0 0 640 360" role="img" aria-label="可交互的二次函数图象">
        ${coordinateGrid()}
        <line data-quadratic-axis class="material-symmetry-axis" />
        <path data-quadratic-curve class="material-quadratic-curve" />
        <circle data-quadratic-vertex r="6" class="material-point"></circle>
      </svg>
      <div class="material-equation" data-quadratic-equation>y = (x - 0)²</div>
    </div>
    <div class="material-control-panel">
      <span>调整开口、对称轴和顶点，观察最值如何变化</span>
      <label><b>开口系数 a</b><input data-quadratic-a type="range" min="-2" max="2" step="0.25" value="0.5" /><output data-quadratic-a-output>0.5</output></label>
      <label><b>对称轴 h</b><input data-quadratic-h type="range" min="-3" max="3" step="0.5" value="0" /><output data-quadratic-h-output>0</output></label>
      <label><b>顶点纵坐标 k</b><input data-quadratic-k type="range" min="-3" max="3" step="0.5" value="-1" /><output data-quadratic-k-output>-1</output></label>
      <dl><div><dt>顶点</dt><dd data-quadratic-vertex-value>(0, -1)</dd></div><div><dt>最值</dt><dd data-quadratic-extreme>最小值 -1</dd></div></dl>
      <p>${escapeHTML(point.name)}</p>
    </div>
  </div>`;
  const aInput = host.querySelector("[data-quadratic-a]");
  const hInput = host.querySelector("[data-quadratic-h]");
  const kInput = host.querySelector("[data-quadratic-k]");
  const update = () => {
    const a = Number(aInput.value);
    const h = Number(hInput.value);
    const k = Number(kInput.value);
    const points = [];
    for (let index = 0; index <= 160; index += 1) {
      const x = -6 + (12 * index) / 160;
      const y = a * (x - h) ** 2 + k;
      points.push(`${index === 0 ? "M" : "L"} ${plotX(x)} ${plotY(y)}`);
    }
    host.querySelector("[data-quadratic-curve]").setAttribute("d", points.join(" "));
    setLine(host.querySelector("[data-quadratic-axis]"), plotX(h), 24, plotX(h), 336);
    setPoint(host.querySelector("[data-quadratic-vertex]"), plotX(h), plotY(k));
    host.querySelector("[data-quadratic-a-output]").textContent = formatNumber(a);
    host.querySelector("[data-quadratic-h-output]").textContent = formatNumber(h);
    host.querySelector("[data-quadratic-k-output]").textContent = formatNumber(k);
    host.querySelector("[data-quadratic-equation]").textContent =
      `y = ${formatNumber(a)}(x ${h >= 0 ? "-" : "+"} ${formatNumber(Math.abs(h))})² ${k >= 0 ? "+" : "-"} ${formatNumber(Math.abs(k))}`;
    host.querySelector("[data-quadratic-vertex-value]").textContent =
      `(${formatNumber(h)}, ${formatNumber(k)})`;
    host.querySelector("[data-quadratic-extreme]").textContent =
      Math.abs(a) < 0.001 ? `恒等于 ${formatNumber(k)}` : `${a > 0 ? "最小值" : "最大值"} ${formatNumber(k)}`;
  };
  [aInput, hInput, kInput].forEach((input) => input.addEventListener("input", update));
  update();
}

function renderGeometryMaterial(host, point) {
  host.innerHTML = `<div class="interactive-material interactive-geometry-material">
    <div class="material-visual-frame">
      <svg viewBox="0 0 640 360" role="img" aria-label="可交互的直角三角形">
        <defs><linearGradient id="triangle-fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dceaff"/><stop offset="1" stop-color="#f5dfcc"/></linearGradient></defs>
        <polygon data-triangle-shape class="geometry-shape" fill="url(#triangle-fill)"></polygon>
        <polyline data-right-angle class="geometry-right-angle"></polyline>
        <text data-side-a class="geometry-label"></text><text data-side-b class="geometry-label"></text><text data-side-c class="geometry-label"></text>
        <circle cx="130" cy="290" r="5" class="material-point"></circle>
      </svg>
      <div class="material-equation" data-pythagorean-equation>a² + b² = c²</div>
    </div>
    <div class="material-control-panel">
      <span>调整两条直角边，验证勾股关系</span>
      <label><b>直角边 a</b><input data-side-a-input type="range" min="3" max="10" step="1" value="6" /><output data-side-a-output>6</output></label>
      <label><b>直角边 b</b><input data-side-b-input type="range" min="3" max="10" step="1" value="8" /><output data-side-b-output>8</output></label>
      <dl><div><dt>斜边 c</dt><dd data-side-c-output>10</dd></div><div><dt>面积</dt><dd data-area-output>24</dd></div></dl>
      <p>${escapeHTML(point.name)}</p>
    </div>
  </div>`;
  const aInput = host.querySelector("[data-side-a-input]");
  const bInput = host.querySelector("[data-side-b-input]");
  const update = () => {
    const a = Number(aInput.value);
    const b = Number(bInput.value);
    const c = Math.sqrt(a * a + b * b);
    const scale = 17;
    const left = 130;
    const bottom = 290;
    const top = bottom - a * scale;
    const right = left + b * scale;
    host.querySelector("[data-triangle-shape]").setAttribute("points", `${left},${bottom} ${left},${top} ${right},${bottom}`);
    host.querySelector("[data-right-angle]").setAttribute("points", `${left},${bottom - 18} ${left + 18},${bottom - 18} ${left + 18},${bottom}`);
    setSvgText(host.querySelector("[data-side-a]"), left - 35, (bottom + top) / 2, `a = ${a}`);
    setSvgText(host.querySelector("[data-side-b]"), (left + right) / 2, bottom + 30, `b = ${b}`);
    setSvgText(host.querySelector("[data-side-c]"), (left + right) / 2 + 10, (bottom + top) / 2 - 10, `c = ${formatNumber(c)}`);
    host.querySelector("[data-side-a-output]").textContent = a;
    host.querySelector("[data-side-b-output]").textContent = b;
    host.querySelector("[data-side-c-output]").textContent = formatNumber(c);
    host.querySelector("[data-area-output]").textContent = formatNumber((a * b) / 2);
    host.querySelector("[data-pythagorean-equation]").textContent = `${a}² + ${b}² = ${formatNumber(c)}²`;
  };
  [aInput, bInput].forEach((input) => input.addEventListener("input", update));
  update();
}

function renderNumberLineMaterial(host, point) {
  const ticks = Array.from({ length: 13 }, (_, index) => {
    const value = index - 6;
    const x = plotX(value);
    return `<line x1="${x}" y1="168" x2="${x}" y2="184" class="numberline-tick"></line><text x="${x}" y="205" class="numberline-label">${value}</text>`;
  }).join("");
  host.innerHTML = `<div class="interactive-material interactive-numberline-material">
    <div class="material-visual-frame">
      <svg viewBox="0 0 640 360" role="img" aria-label="可交互的不等式数轴">
        <line x1="45" y1="176" x2="595" y2="176" class="numberline-axis"></line>${ticks}
        <line data-numberline-range class="numberline-range"></line>
        <circle data-numberline-boundary cy="176" r="8" class="numberline-boundary"></circle>
        <path data-numberline-arrow class="numberline-arrow"></path>
      </svg>
      <div class="material-equation" data-numberline-equation>x &gt; 4</div>
    </div>
    <div class="material-control-panel">
      <span>调整边界与方向，观察数轴表示</span>
      <label><b>边界值</b><input data-numberline-value type="range" min="-5" max="5" step="1" value="4" /><output data-numberline-output>4</output></label>
      <label class="material-segmented"><b>解集方向</b><select data-numberline-direction><option value="greater">大于，向右</option><option value="less">小于，向左</option></select></label>
      <label class="material-switch"><input data-numberline-closed type="checkbox" /><span></span><b>包含边界值</b></label>
      <p>${escapeHTML(point.name)}</p>
    </div>
  </div>`;
  const valueInput = host.querySelector("[data-numberline-value]");
  const directionInput = host.querySelector("[data-numberline-direction]");
  const closedInput = host.querySelector("[data-numberline-closed]");
  const update = () => {
    const value = Number(valueInput.value);
    const greater = directionInput.value === "greater";
    const boundaryX = plotX(value);
    const endX = greater ? 582 : 58;
    setLine(host.querySelector("[data-numberline-range]"), boundaryX, 176, endX, 176);
    const boundary = host.querySelector("[data-numberline-boundary]");
    boundary.setAttribute("cx", boundaryX);
    boundary.classList.toggle("is-closed", closedInput.checked);
    const arrow = host.querySelector("[data-numberline-arrow]");
    arrow.setAttribute("d", greater ? `M ${endX - 12} 168 L ${endX} 176 L ${endX - 12} 184` : `M ${endX + 12} 168 L ${endX} 176 L ${endX + 12} 184`);
    const symbol = greater ? (closedInput.checked ? "≥" : ">") : (closedInput.checked ? "≤" : "<");
    host.querySelector("[data-numberline-equation]").textContent = `x ${symbol} ${value}`;
    host.querySelector("[data-numberline-output]").textContent = value;
  };
  [valueInput, directionInput, closedInput].forEach((input) => input.addEventListener("input", update));
  directionInput.addEventListener("change", update);
  update();
}

function renderPhysicsMaterial(host) {
  host.innerHTML = `<div class="interactive-material interactive-physics-material">
    <div class="material-visual-frame">
      <svg viewBox="0 0 640 360" role="img" aria-label="凸透镜成像实验图">
        <line x1="30" y1="190" x2="610" y2="190" class="experiment-axis"></line>
        <path d="M320 58 Q294 190 320 322 Q346 190 320 58" class="lens-shape"></path>
        <line x1="260" y1="182" x2="260" y2="198" class="focus-mark"></line><text x="250" y="218" class="experiment-label">F</text>
        <line x1="380" y1="182" x2="380" y2="198" class="focus-mark"></line><text x="375" y="218" class="experiment-label">F</text>
        <line data-object-arrow class="object-arrow"></line><path data-object-head class="object-head"></path>
        <line data-image-arrow class="image-arrow"></line><path data-image-head class="image-head"></path>
        <polyline data-ray-center class="experiment-ray"></polyline><polyline data-ray-parallel class="experiment-ray is-secondary"></polyline>
        <text data-object-label class="experiment-label"></text><text data-image-label class="experiment-label"></text>
      </svg>
      <div class="material-equation" data-lens-equation>1/f = 1/u + 1/v</div>
    </div>
    <div class="material-control-panel">
      <span>移动蜂烛，观察像距与成像大小</span>
      <label><b>物距 u</b><input data-object-distance type="range" min="14" max="50" step="1" value="30" /><output data-object-distance-output>30 cm</output></label>
      <dl><div><dt>像距 v</dt><dd data-image-distance>15 cm</dd></div><div><dt>成像</dt><dd data-image-kind>倒立缩小实像</dd></div></dl>
      <p>凸透镜成像 · 焦距 10 cm</p>
    </div>
  </div>`;
  const input = host.querySelector("[data-object-distance]");
  const update = () => {
    const u = Number(input.value);
    const f = 10;
    const v = (f * u) / (u - f);
    const objectX = 320 - u * 5.2;
    const imageX = Math.min(600, 320 + v * 5.2);
    const objectTop = 105;
    const imageBottom = 190 + (190 - objectTop) * (v / u);
    setLine(host.querySelector("[data-object-arrow]"), objectX, 190, objectX, objectTop);
    host.querySelector("[data-object-head]").setAttribute("d", `M ${objectX - 7} ${objectTop + 12} L ${objectX} ${objectTop} L ${objectX + 7} ${objectTop + 12}`);
    setLine(host.querySelector("[data-image-arrow]"), imageX, 190, imageX, imageBottom);
    host.querySelector("[data-image-head]").setAttribute("d", `M ${imageX - 7} ${imageBottom - 12} L ${imageX} ${imageBottom} L ${imageX + 7} ${imageBottom - 12}`);
    host.querySelector("[data-ray-center]").setAttribute("points", `${objectX},${objectTop} 320,190 ${imageX},${imageBottom}`);
    host.querySelector("[data-ray-parallel]").setAttribute("points", `${objectX},${objectTop} 320,${objectTop} ${imageX},${imageBottom}`);
    setSvgText(host.querySelector("[data-object-label]"), objectX - 20, 90, "蜡烛");
    setSvgText(host.querySelector("[data-image-label]"), imageX - 12, Math.min(325, imageBottom + 28), "像");
    host.querySelector("[data-object-distance-output]").textContent = `${u} cm`;
    host.querySelector("[data-image-distance]").textContent = `${formatNumber(v)} cm`;
    host.querySelector("[data-image-kind]").textContent = u > 20 ? "倒立缩小实像" : u === 20 ? "倒立等大实像" : "倒立放大实像";
    host.querySelector("[data-lens-equation]").textContent = `1/10 = 1/${u} + 1/${formatNumber(v)}`;
  };
  input.addEventListener("input", update);
  update();
}

function renderChemistryMaterial(host) {
  host.innerHTML = `<div class="interactive-material interactive-chemistry-material">
    <div class="material-visual-frame chemistry-frame">
      <svg viewBox="0 0 640 360" role="img" aria-label="酸碱指示剂实验图">
        <path d="M224 70 L224 282 Q224 316 258 316 L382 316 Q416 316 416 282 L416 70" class="beaker-outline"></path>
        <path data-solution d="M230 175 L410 175 L410 282 Q410 308 382 308 L258 308 Q230 308 230 282 Z" class="beaker-solution"></path>
        <path d="M300 34 Q320 8 340 34 L320 70 Z" class="indicator-drop"></path>
        <circle cx="276" cy="222" r="7" class="solution-bubble"></circle><circle cx="361" cy="260" r="5" class="solution-bubble"></circle><circle cx="330" cy="200" r="4" class="solution-bubble"></circle>
        <text x="320" y="345" class="experiment-label chemistry-label" data-ph-label>pH = 7 · 中性</text>
      </svg>
      <div class="ph-scale" aria-hidden="true"><span>酸性</span><i></i><span>中性</span><i></i><span>碱性</span></div>
    </div>
    <div class="material-control-panel">
      <span>调整 pH，观察通用指示剂的颜色变化</span>
      <label><b>pH</b><input data-ph-value type="range" min="0" max="14" step="1" value="7" /><output data-ph-output>7</output></label>
      <dl><div><dt>性质</dt><dd data-ph-kind>中性</dd></div><div><dt>指示色</dt><dd data-ph-color>绿色</dd></div></dl>
      <p>通用指示剂 · 酸碱性观察</p>
    </div>
  </div>`;
  const input = host.querySelector("[data-ph-value]");
  const update = () => {
    const value = Number(input.value);
    const meta = phMeta(value);
    host.querySelector("[data-solution]").style.fill = meta.color;
    host.querySelector("[data-ph-label]").textContent = `pH = ${value} · ${meta.kind}`;
    host.querySelector("[data-ph-output]").textContent = value;
    host.querySelector("[data-ph-kind]").textContent = meta.kind;
    host.querySelector("[data-ph-color]").textContent = meta.label;
  };
  input.addEventListener("input", update);
  update();
}

function coordinateGrid() {
  const lines = [];
  for (let value = -6; value <= 6; value += 1) {
    const x = plotX(value);
    const y = plotY(value);
    lines.push(`<line x1="${x}" y1="24" x2="${x}" y2="336" class="plot-grid-line"></line>`);
    lines.push(`<line x1="44" y1="${y}" x2="596" y2="${y}" class="plot-grid-line"></line>`);
    if (value !== 0) {
      lines.push(`<text x="${x}" y="194" class="plot-label">${value}</text>`);
      lines.push(`<text x="309" y="${y + 4}" class="plot-label is-y">${value}</text>`);
    }
  }
  lines.push('<line x1="44" y1="180" x2="596" y2="180" class="plot-axis"></line><path d="M590 174 L600 180 L590 186" class="plot-axis-arrow"></path>');
  lines.push('<line x1="320" y1="24" x2="320" y2="336" class="plot-axis"></line><path d="M314 30 L320 20 L326 30" class="plot-axis-arrow"></path>');
  lines.push('<text x="602" y="183" class="plot-axis-label">x</text><text x="326" y="22" class="plot-axis-label">y</text>');
  return lines.join("");
}

function plotX(value) {
  return 320 + value * 46;
}

function plotY(value) {
  return 180 - value * 26;
}

function setLine(line, x1, y1, x2, y2) {
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
}

function setPoint(point, x, y) {
  point.setAttribute("cx", x);
  point.setAttribute("cy", y);
}

function setSvgText(target, x, y, value) {
  target.setAttribute("x", x);
  target.setAttribute("y", y);
  target.textContent = value;
}

function equationTerm(value, symbol) {
  if (value === 1) return symbol;
  if (value === -1) return `-${symbol}`;
  return `${formatNumber(value)}${symbol}`;
}

function signedTerm(value) {
  if (value === 0) return "";
  return value > 0 ? ` + ${formatNumber(value)}` : ` - ${formatNumber(Math.abs(value))}`;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function phMeta(value) {
  const palette = [
    ["#d43f3a", "红色"], ["#e05338", "红橙色"], ["#ea6a31", "橙色"], ["#ef862b", "橙色"],
    ["#e9a72a", "橙黄色"], ["#d5bd2e", "黄色"], ["#9fbd3a", "黄绿色"], ["#51a85b", "绿色"],
    ["#36a28a", "蓝绿色"], ["#358da9", "蓝色"], ["#426fae", "蓝色"], ["#585da8", "蓝紫色"],
    ["#704da0", "紫色"], ["#823f91", "紫色"], ["#913879", "紫红色"]
  ];
  const [color, label] = palette[Math.max(0, Math.min(14, value))];
  return { color, label, kind: value < 7 ? "酸性" : value > 7 ? "碱性" : "中性" };
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
