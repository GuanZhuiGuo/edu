import { renderAgentAnswer } from "./agent-answer-renderer.js";

export const HOMEWORK_MARK_SCHEMA_VERSION = "homework_mark@1.0";

const VERDICT_COPY = Object.freeze({
  correct: "正确",
  wrong: "需要修正",
  uncertain: "待确认",
  unanswered: "未作答",
});

/**
 * Render a server-normalized homework mark. Provider payloads must be mapped to
 * homework_mark@1.0 before reaching this boundary.
 */
export function mountHomeworkMark(root, value, options = {}) {
  if (!(root instanceof HTMLElement)) return null;
  const mark = normalizeHomeworkMark(value, options);
  root.replaceChildren();
  root.className = "homework-mark-mount";
  root.dataset.schemaVersion = HOMEWORK_MARK_SCHEMA_VERSION;
  root.dataset.coordinateStatus = mark.coordinateStatus;

  const shell = element("section", "homework-mark-view");
  shell.setAttribute("aria-label", "作业批改结果");
  const visual = element("section", "homework-mark-visual");
  const visualHead = element("header", "homework-mark-visual-head");
  visualHead.append(
    copyNode("b", "题目定位"),
    copyNode("span", `识别到 ${mark.questions.length} 道题`),
  );
  const stage = element("div", "homework-mark-image-stage");
  const image = document.createElement("img");
  image.alt = mark.sourceImage.alt || "已上传的作业图片";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.classList.add("homework-mark-overlay");
  if (mark.sourceImage.width && mark.sourceImage.height) {
    overlay.setAttribute("viewBox", `0 0 ${mark.sourceImage.width} ${mark.sourceImage.height}`);
  }
  overlay.setAttribute("preserveAspectRatio", "xMidYMid meet");
  overlay.setAttribute("role", "group");
  overlay.setAttribute("aria-label", "题目位置标记");
  overlay.hidden = !mark.sourceImage.coordinateCompatible;
  stage.append(image, overlay);
  let imageNotice = null;
  const showImageNotice = (title, detail) => {
    if (!imageNotice) {
      imageNotice = element("div", "homework-mark-image-missing");
      stage.append(imageNotice);
    }
    imageNotice.replaceChildren(copyNode("b", title), copyNode("span", detail));
  };
  if (mark.degradation) {
    showImageNotice(mark.degradation.title, mark.degradation.message);
  } else if (!mark.sourceImage.url) {
    showImageNotice("矫正图暂不可用", "题目结果仍可查看");
  }
  visual.append(visualHead, stage);

  const detail = element("section", "homework-mark-detail");
  const questionNav = element("div", "homework-mark-question-nav");
  questionNav.setAttribute("role", "tablist");
  questionNav.setAttribute("aria-label", "选择题目");
  const detailBody = element("div", "homework-mark-detail-body");
  detail.append(questionNav, detailBody);
  shell.append(visual, detail);
  root.append(shell);

  const shapes = [];
  const tabs = [];
  mark.questions.forEach((question, index) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `homework-question-tab is-${question.verdict}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.tabIndex = -1;
    tab.textContent = String(question.order || index + 1);
    tab.addEventListener("click", () => select(index, { focus: false }));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      select(next, { focus: true });
    });
    questionNav.append(tab);
    tabs.push(tab);

    if (question.polygon.points.length >= 3) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("homework-question-shape", `is-${question.verdict}`);
      group.setAttribute("role", "button");
      group.setAttribute("tabindex", "0");
      group.setAttribute("aria-label", `第 ${question.order || index + 1} 题，${VERDICT_COPY[question.verdict]}`);
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      const badge = makeSvgBadge(question, index);
      group.append(polygon, badge);
      group.addEventListener("click", () => select(index, { focus: false }));
      group.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        select(index, { focus: false });
      });
      overlay.append(group);
      const answerShapes = question.answers.map((answer) => {
        const answerGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        answerGroup.classList.add("homework-answer-shape", answer.correct ? "is-correct" : "is-wrong");
        answerGroup.setAttribute("aria-hidden", "true");
        const answerPolygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        answerGroup.append(answerPolygon);
        overlay.append(answerGroup);
        return { group: answerGroup, polygon: answerPolygon, answer };
      });
      shapes.push({ group, polygon, badge, question, answerShapes });
    } else {
      shapes.push(null);
    }
  });

  let coordinateWidth = mark.sourceImage.width;
  let coordinateHeight = mark.sourceImage.height;
  let coordinateCompatible = mark.sourceImage.coordinateCompatible;
  let attemptedFallback = mark.sourceImage.displayMode === "original_fallback";
  function syncOverlayGeometry() {
    const ready = Boolean(coordinateCompatible && coordinateWidth && coordinateHeight);
    overlay.hidden = !coordinateCompatible;
    overlay.classList.toggle("is-coordinate-ready", ready);
    if (!ready) return;
    overlay.setAttribute("viewBox", `0 0 ${coordinateWidth} ${coordinateHeight}`);
    shapes.forEach((shape) => {
      if (!shape) return;
      const points = resolvePolygon(shape.question.polygon, coordinateWidth, coordinateHeight);
      shape.polygon.setAttribute("points", serializePolygon(points));
      updateSvgBadge(shape.badge, shape.question, points, coordinateWidth, coordinateHeight);
      shape.answerShapes.forEach((entry) => {
        const answerPoints = resolvePolygon(entry.answer.polygon, coordinateWidth, coordinateHeight);
        entry.polygon.setAttribute("points", serializePolygon(answerPoints));
        entry.group.classList.toggle("is-empty", answerPoints.length < 3);
      });
    });
  }
  syncOverlayGeometry();
  image.addEventListener("load", () => {
    image.hidden = false;
    const naturalSize = resolveHomeworkImageSize(image, {
      width: coordinateWidth,
      height: coordinateHeight,
    });
    coordinateWidth = naturalSize.width;
    coordinateHeight = naturalSize.height;
    syncOverlayGeometry();
  });
  image.addEventListener("error", () => {
    coordinateCompatible = false;
    root.dataset.coordinateStatus = "preprocessed_image_load_failed";
    syncOverlayGeometry();
    showImageNotice(
      "矫正图加载失败",
      mark.sourceImage.fallbackUrl
        ? "已显示上传原图，坐标标注已隐藏以避免错位"
        : "坐标标注已隐藏，题目结果仍可查看",
    );
    if (!attemptedFallback && mark.sourceImage.fallbackUrl) {
      attemptedFallback = true;
      image.src = mark.sourceImage.fallbackUrl;
      return;
    }
    image.hidden = true;
  });
  if (mark.sourceImage.url) image.src = mark.sourceImage.url;

  let selectedIndex = -1;
  function select(index, { focus = false } = {}) {
    const next = Math.max(0, Math.min(mark.questions.length - 1, Number(index) || 0));
    if (!mark.questions[next]) return;
    selectedIndex = next;
    tabs.forEach((tab, tabIndex) => {
      const active = tabIndex === next;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    shapes.forEach((shape, shapeIndex) => {
      if (!shape) return;
      const active = shapeIndex === next;
      shape.group.classList.toggle("is-active", active);
      shape.answerShapes.forEach((entry) => entry.group.classList.toggle("is-active", active));
    });
    renderQuestionDetail(detailBody, mark.questions[next]);
    if (focus) tabs[next]?.focus({ preventScroll: true });
    options.onSelect?.(mark.questions[next], next);
  }

  if (mark.questions.length) {
    select(Number.isInteger(options.initialIndex) ? options.initialIndex : 0);
  } else {
    const empty = element("p", "homework-question-empty");
    empty.textContent = "暂未识别到可批改的题目。";
    detailBody.append(empty);
  }
  return Object.freeze({
    element: root,
    mark,
    get selectedIndex() { return selectedIndex; },
    select: (index) => select(index),
    destroy() { root.replaceChildren(); },
  });
}

export function normalizeHomeworkMark(value, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const image = source.source_image && typeof source.source_image === "object"
    ? source.source_image
    : typeof source.source_image === "string"
      ? { url: source.source_image }
      : {};
  const width = finitePositive(image.width) || finitePositive(source.image_width);
  const height = finitePositive(image.height) || finitePositive(source.image_height);
  const rawQuestions = Array.isArray(source.questions)
    ? source.questions
    : Array.isArray(source.items)
      ? source.items
      : Array.isArray(source.mark_results) ? source.mark_results : [];
  const questions = rawQuestions.slice(0, 100).map((question, index) => {
    const raw = question && typeof question === "object" ? question : {};
    const coordinateSpace = raw.coordinate_space || source.coordinate_space;
    const answers = normalizeAnswers(raw.answers ?? raw.answer_results, coordinateSpace);
    const finished = raw.finished ?? raw.finish;
    const explicitVerdict = normalizeExplicitVerdict(raw.verdict ?? raw.result ?? raw.status);
    const suppliedAnalysis = safeText(raw.analysis || raw.explanation, 6_000);
    const providerSolutionText = safeText(raw.solution_text, 6_000);
    return {
      id: safeText(raw.id || raw.question_id || raw.mark_id, 160) || `question-${index + 1}`,
      order: finitePositive(raw.order) || index + 1,
      verdict: explicitVerdict || inferVerdict(finished, answers),
      polygon: normalizePolygon(
        raw.polygon || raw.mark_points || raw.points || raw.bbox,
        coordinateSpace,
      ),
      answers,
      finished: finished === true,
      title: safeText(raw.title || raw.prompt || raw.question, 1_000) || `第 ${index + 1} 题`,
      studentAnswer: safeText(raw.student_answer || raw.user_answer, 2_000),
      correctAnswer: safeText(raw.correct_answer || raw.answer, 2_000),
      analysis: suppliedAnalysis || providerSolutionText,
      solutionText: suppliedAnalysis ? providerSolutionText : "",
      solution: normalizeSolution(raw.solution || raw.solution_steps),
    };
  });
  const hasCoordinates = questions.some((question) => (
    question.polygon.points.length >= 3
    || question.answers.some((answer) => answer.polygon.points.length >= 3)
  ));
  const coordinateImageCandidate = image.url
    || source.preprocessed_image_url
    || source.coordinate_image_url;
  const coordinateImageUrl = safeCoordinateImageUrl(coordinateImageCandidate);
  const fallbackImageUrl = safeImageUrl(source.image_url || options.fallbackImageUrl);
  const sourceImage = Object.freeze({
    url: coordinateImageUrl || fallbackImageUrl,
    coordinateUrl: coordinateImageUrl,
    fallbackUrl: fallbackImageUrl && fallbackImageUrl !== coordinateImageUrl ? fallbackImageUrl : "",
    coordinateCompatible: !hasCoordinates || Boolean(coordinateImageUrl),
    displayMode: coordinateImageUrl
      ? "preprocessed"
      : fallbackImageUrl ? "original_fallback" : "missing",
    width,
    height,
    alt: safeText(image.alt, 160),
  });
  const degradation = hasCoordinates && !coordinateImageUrl
    ? Object.freeze({
        code: coordinateImageCandidate
          ? "preprocessed_image_url_rejected"
          : "preprocessed_image_unavailable",
        title: "矫正图暂不可用",
        message: fallbackImageUrl
          ? "已显示上传原图，坐标标注已隐藏以避免错位"
          : "坐标标注已隐藏，题目结果仍可查看",
      })
    : null;
  return Object.freeze({
    schemaVersion: safeText(source.schema_version, 80) || HOMEWORK_MARK_SCHEMA_VERSION,
    sourceImage,
    coordinateStatus: degradation ? degradation.code : hasCoordinates ? "ready" : "not_required",
    degradation,
    questions: Object.freeze(questions),
  });
}

export function resolveHomeworkImageSize(image, fallback = {}) {
  return Object.freeze({
    width: finitePositive(image?.naturalWidth) || finitePositive(fallback.width) || null,
    height: finitePositive(image?.naturalHeight) || finitePositive(fallback.height) || null,
  });
}

function renderQuestionDetail(root, question) {
  root.replaceChildren();
  const head = element("header", "homework-question-head");
  const heading = copyNode("h3", question.title);
  const verdict = copyNode("span", VERDICT_COPY[question.verdict]);
  verdict.className = `homework-question-verdict is-${question.verdict}`;
  head.append(heading, verdict);
  root.append(head);
  if (question.studentAnswer) root.append(detailRow("你的作答", question.studentAnswer));
  if (question.correctAnswer) root.append(detailRow("参考答案", question.correctAnswer));
  if (question.solutionText) root.append(detailRow("正确答案与解析", question.solutionText, "is-analysis"));
  if (question.analysis) root.append(detailRow("解析", question.analysis, "is-analysis"));
  if (question.solution.length) {
    const solution = element("section", "homework-question-solution");
    solution.append(copyNode("b", "解题步骤"));
    const list = document.createElement("ol");
    question.solution.forEach((step) => {
      const item = document.createElement("li");
      const content = element("div", "homework-rich-text homework-solution-step");
      renderAgentAnswer(content, null, step);
      item.append(content);
      list.append(item);
    });
    solution.append(list);
    root.append(solution);
  }
  if (!question.studentAnswer && !question.correctAnswer && !question.solutionText && !question.analysis && !question.solution.length) {
    const empty = element("p", "homework-question-empty");
    empty.textContent = "这道题暂无可展示的批改细节。";
    root.append(empty);
  }
}

function detailRow(label, text, className = "") {
  const row = element("section", `homework-question-copy ${className}`.trim());
  const content = element("div", "homework-rich-text");
  renderAgentAnswer(content, null, text);
  row.append(copyNode("b", label), content);
  return row;
}

function makeSvgBadge(question, index) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("homework-question-badge");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.setAttribute("dy", ".34em");
  label.setAttribute("text-anchor", "middle");
  label.textContent = String(question.order || index + 1);
  group.append(circle, label);
  return group;
}

function updateSvgBadge(badge, question, points, width, height) {
  if (!badge || points.length < 3) return;
  const [x, y] = points[0];
  const radius = clamp(Math.min(width, height) * 0.026, 12, 42);
  const circle = badge.querySelector("circle");
  const label = badge.querySelector("text");
  [circle, label].forEach((node) => {
    node?.setAttribute("cx", String(x));
    node?.setAttribute("cy", String(y));
  });
  label?.setAttribute("x", String(x));
  label?.setAttribute("y", String(y));
  circle?.setAttribute("r", String(radius));
}

function normalizePolygon(value, coordinateSpace) {
  let points = [];
  if (Array.isArray(value)) {
    if (value.length === 4 && value.every((entry) => finiteNumber(entry) != null)) {
      const [x, y, boxWidth, boxHeight] = value.map(Number);
      points = [[x, y], [x + boxWidth, y], [x + boxWidth, y + boxHeight], [x, y + boxHeight]];
    } else {
      points = value.map(normalizePoint).filter(Boolean);
    }
  } else if (value && typeof value === "object") {
    if (Array.isArray(value.points)) points = value.points.map(normalizePoint).filter(Boolean);
    else {
      const x = finiteNumber(value.x ?? value.left ?? value.x1);
      const y = finiteNumber(value.y ?? value.top ?? value.y1);
      const right = finiteNumber(value.x2 ?? value.right);
      const bottom = finiteNumber(value.y2 ?? value.bottom);
      const boxWidth = finiteNumber(value.width);
      const boxHeight = finiteNumber(value.height);
      const x2 = right ?? (x != null && boxWidth != null ? x + boxWidth : null);
      const y2 = bottom ?? (y != null && boxHeight != null ? y + boxHeight : null);
      if ([x, y, x2, y2].every((entry) => entry != null)) {
        points = [[x, y], [x2, y], [x2, y2], [x, y2]];
      }
    }
  }
  if (points.length < 3) return Object.freeze({ points: [], normalized: false });
  const normalized = coordinateSpace === "normalized"
    || points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1);
  return Object.freeze({
    points: points.slice(0, 12).map(([x, y]) => Object.freeze([x, y])),
    normalized,
  });
}

function resolvePolygon(polygon, width, height) {
  if (!polygon?.points?.length || !width || !height) return [];
  return polygon.points.map(([x, y]) => [
    clamp(polygon.normalized ? x * width : x, 0, width),
    clamp(polygon.normalized ? y * height : y, 0, height),
  ]);
}

function serializePolygon(points) {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

function normalizeAnswers(value, coordinateSpace) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((answer, index) => {
    const raw = answer && typeof answer === "object" ? answer : {};
    const explicitVerdict = normalizeExplicitVerdict(raw.verdict ?? raw.result ?? raw.status);
    return Object.freeze({
      id: safeText(raw.answer_id || raw.id, 160) || `answer-${index + 1}`,
      correct: raw.correct === true || raw.is_correct === true || explicitVerdict === "correct",
      polygon: normalizePolygon(
        raw.polygon || raw.answer_points || raw.points || raw.bbox,
        raw.coordinate_space || coordinateSpace,
      ),
    });
  });
}

function inferVerdict(finished, answers) {
  if (finished === false) return "unanswered";
  if (!answers.length) return finished === true ? "unanswered" : "uncertain";
  return answers.every((answer) => answer.correct) ? "correct" : "wrong";
}

function normalizePoint(value) {
  const x = Array.isArray(value) ? finiteNumber(value[0]) : finiteNumber(value?.x);
  const y = Array.isArray(value) ? finiteNumber(value[1]) : finiteNumber(value?.y);
  return x == null || y == null ? null : [x, y];
}

function normalizeSolution(value) {
  const items = Array.isArray(value) ? value : Array.isArray(value?.steps) ? value.steps : [];
  return items.slice(0, 20).map((item) => safeText(
    typeof item === "string" ? item : item?.detail || item?.description || item?.text,
    1_000,
  )).filter(Boolean);
}

function normalizeVerdict(value) {
  const verdict = String(value || "").trim().toLowerCase();
  if (["correct", "right", "passed"].includes(verdict)) return "correct";
  if (["wrong", "incorrect", "failed"].includes(verdict)) return "wrong";
  if (["unanswered", "blank"].includes(verdict)) return "unanswered";
  return "uncertain";
}

function normalizeExplicitVerdict(value) {
  const verdict = String(value || "").trim().toLowerCase();
  if (!["correct", "right", "passed", "wrong", "incorrect", "failed", "unanswered", "blank", "uncertain"].includes(verdict)) {
    return "";
  }
  return normalizeVerdict(verdict);
}

function safeImageUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=\r\n]+$/iu.test(candidate)) return candidate;
  if (candidate.startsWith("blob:")) return candidate;
  try {
    const parsed = new URL(candidate, globalThis.location?.href || "http://localhost/");
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function safeCoordinateImageUrl(value) {
  const candidate = safeImageUrl(value);
  if (!candidate) return "";
  if (candidate.startsWith("blob:") || candidate.startsWith("data:image/")) return candidate;
  try {
    const parsed = new URL(candidate, globalThis.location?.href || "http://localhost/");
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function safeText(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ").trim().slice(0, maxLength)
    : value == null ? "" : String(value).trim().slice(0, maxLength);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finitePositive(value) {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function element(tagName, className) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  return node;
}

function copyNode(tagName, value) {
  const node = document.createElement(tagName);
  node.textContent = String(value || "");
  return node;
}
