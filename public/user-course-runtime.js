(function bootstrapUserCourseRuntime() {
  "use strict";


  const COURSE_CATALOG = Object.freeze([
    {
      id: "course-junior-math",
      agentScopeId: "course-junior-math",
      title: "中考数学系统课",
      shortTitle: "中考数学",
      category: "数学",
      teacher: "AI教师 · 课标同步",
      description: "从基础概念到综合迁移，串联知识图谱、题库与学习计划。",
      icon: "sigma",
      tone: "copper",
      reference: { curriculumId: "junior-math-moe-2022", knowledgeCatalogId: "junior-math", questionBankScope: "junior-math", planId: "junior-math-review" },
      chapters: [
        { id: "math-number", title: "数与式", subtitle: "有理数、实数与代数式", duration: 80, knowledgePointId: "M4-NA-RAT-03", knowledgePointName: "有理数运算与法则" },
        { id: "math-equation", title: "方程与不等式", subtitle: "方程建模、解集与数轴表征", duration: 95, knowledgePointId: "M4-NA-INEQ-03", knowledgePointName: "一元一次不等式与数轴" },
        { id: "math-function", title: "函数与图象", subtitle: "一次函数、反比例函数与数形结合", duration: 120, knowledgePointId: "M4-NA-FUN-07", knowledgePointName: "用待定系数法确定一次函数表达式并画图象" },
        { id: "math-geometry", title: "图形与证明", subtitle: "三角形、四边形与证明链", duration: 135, knowledgePointId: "M4-GE-SIM-05", knowledgePointName: "相似三角形对应关系" },
        { id: "math-statistics", title: "统计与概率", subtitle: "数据分析、概率模型与决策", duration: 75, knowledgePointId: "M4-ST-DATA-04", knowledgePointName: "平均数、中位数与众数" },
        { id: "math-mock", title: "综合迁移与模考", subtitle: "跨知识点题组与阶段评估", duration: 150, knowledgePointId: "M4-GE-TRI-10", knowledgePointName: "勾股定理及其应用" }
      ]
    },
    {
      id: "course-english-speaking",
      title: "英语口语陪练",
      shortTitle: "英语口语",
      category: "听说",
      teacher: "AI教师 · 双工语音",
      description: "围绕校园、日常与观点表达进行实时对话，同步显示双方字幕。",
      icon: "audio-lines",
      tone: "blue",
      practiceLevel: "junior-high",
      reference: { practiceSceneId: "junior-high", curriculumId: "junior-english-moe-2022", planId: "english-speaking-weekly" },
      chapters: [
        { id: "speaking-warmup", title: "开口热身", subtitle: "自我介绍与日常问候", duration: 35, scene: "self-introduction" },
        { id: "speaking-campus", title: "校园情境", subtitle: "课堂、社团与同学交流", duration: 45, scene: "campus-life" },
        { id: "speaking-opinion", title: "观点表达", subtitle: "给出理由并连贯表达", duration: 55, scene: "opinion" },
        { id: "speaking-picture", title: "看图表达", subtitle: "描述场景、动作与因果", duration: 50, scene: "picture-description" },
        { id: "speaking-exam", title: "中考听说模拟", subtitle: "限时问答与发音反馈", duration: 65, scene: "exam-simulation" }
      ]
    }
  ]);

  let educationClient = globalThis.EducationDataClient || null;
  let selectedCourseId = "course-junior-math";
  let courseFilter = "all";
  let masteryRecordStudentId = "";
  let selectedMasteryPointId = "";

  const MASTERY_STATE_LABELS = Object.freeze({
    mastered: "熟练掌握",
    secure: "基本掌握",
    learning: "学习中",
    weak: "待加强",
    unassessed: "未评估"
  });

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function ensureSeedData() {
    // Authoritative student and learning data are loaded from the education API.
  }

  function getUsers() {
    const users = educationClient?.getStudents?.() || [];
    return Array.isArray(users) ? users.filter((user) => user && user.id) : [];
  }

  function getCurrentUserId() {
    return educationClient?.getCurrentStudentId?.() || "";
  }

  function getCurrentUser() {
    return educationClient?.getCurrentStudent?.() || null;
  }

  function createEmptyUserData(user) {
    return {
      dataSource: "education-api",
      metrics: { streak: null, knowledgeStateCount: null, unassessedCount: null, monthlyEvents: null, weeklyImprovement: null, historyQuestionCount: null, wrongQuestionCount: null, pendingWrongCount: null, accuracy: null, accuracyTrend: null, knowledgeCoverage: null, planProgress: null },
      plan: null,
      mastery: { total: 0, records: [] },
      masteryHistory: { total: 0, summary: null, policy: null, items: [] },
      events: [],
      courseProgress: null
    };
  }

  function getUserData(userId = getCurrentUserId()) {
    if (!userId || userId !== getCurrentUserId()) return createEmptyUserData({ id: userId || "", grade: "", goal: "" });
    if (educationClient?.getStatus?.("student") !== "ready") {
      return createEmptyUserData(getCurrentUser() || { id: userId, grade: "", goal: "" });
    }
    const profile = educationClient?.getProfile?.();
    const mastery = educationClient?.getMastery?.() || { total: 0, records: [] };
    const masteryHistory = educationClient?.getMasteryHistory?.() || { total: 0, summary: null, policy: null, items: [] };
    const learningEvents = educationClient?.getLearningEvents?.() || { total: 0, items: [] };
    const summary = profile?.mastery_summary || {};
    const questionCatalog = educationClient?.getQuestions?.() || { total: 0, items: [] };
    const total = Number(summary.knowledge_point_count ?? mastery.total ?? 0);
    const assessed = Number(summary.assessed_count ?? (mastery.records || []).filter((item) => item.mastery_state !== "unassessed").length);
    return {
      dataSource: "education-api",
      metrics: {
        streak: null,
        knowledgeStateCount: total,
        unassessedCount: Math.max(0, total - assessed),
        monthlyEvents: Number(learningEvents.total || 0),
        weeklyImprovement: null,
        historyQuestionCount: Number(questionCatalog.total || questionCatalog.items?.length || 0),
        wrongQuestionCount: null,
        pendingWrongCount: null,
        accuracy: summary.average_mastery_probability == null ? null : Math.round(Number(summary.average_mastery_probability) * 100),
        accuracyTrend: null,
        knowledgeCoverage: Math.round(Number(summary.coverage || 0) * 100),
        planProgress: null
      },
      plan: null,
      mastery,
      masteryHistory,
      events: (learningEvents.items || []).map(presentLearningEvent),
      courseProgress: null
    };
  }

  function updateUserData(mutator, userId = getCurrentUserId()) {
    void mutator;
    return getUserData(userId);
  }

  function storageKey(baseKey, userId = getCurrentUserId()) {
    return `${String(baseKey || "ai-classroom")}:user:${userId}`;
  }

  function scopeMasterySnapshot(snapshot, requestedUserId = getCurrentUserId()) {
    if (requestedUserId && requestedUserId !== getCurrentUserId()) {
      return { ...clone(snapshot || {}), user_id: requestedUserId, records: [] };
    }
    return educationClient?.getMastery?.() || { ...clone(snapshot || {}), user_id: requestedUserId, records: [] };
  }

  function getCurrentQuestionIds(requestedUserId = getCurrentUserId()) {
    void requestedUserId;
    return [];
  }

  function getPlanCalendarSeed() {
    return null;
  }

  function userFieldValues(user, data) {
    const metrics = data.metrics || {};
    const plan = data.plan || {};
    const known = (value, suffix = "") => value == null ? "—" : `${value}${suffix}`;
    return {
      identityCompact: `${user.name || "学生"}${user.grade ? ` · ${user.grade}` : ""}`,
      avatar: user.avatar || user.name?.slice(0, 1) || "学",
      name: user.name || "学生",
      recordSubtitle: user.grade ? `${user.grade} · 数据来自学习记录` : "数据来自学习记录",
      knowledgeStateCount: known(metrics.knowledgeStateCount),
      unassessedCount: metrics.unassessedCount == null ? "暂无数据" : `${metrics.unassessedCount} 个未评估`,
      monthlyEvents: known(metrics.monthlyEvents),
      weeklyImprovement: known(metrics.weeklyImprovement),
      weeklyImprovementDetail: metrics.weeklyImprovement == null ? "暂无可比周期数据" : `${metrics.weeklyImprovement} 个知识点状态上升`,
      eventRange: `全部记录 · ${known(metrics.monthlyEvents, " 条")}`,
      historyQuestionCount: known(metrics.historyQuestionCount),
      knowledgeCoverage: metrics.knowledgeCoverage == null ? "暂无覆盖数据" : `已评估 ${metrics.knowledgeCoverage}%`,
      wrongQuestionCount: known(metrics.wrongQuestionCount),
      pendingWrongCount: metrics.pendingWrongCount == null ? "暂无错题统计" : `${metrics.pendingWrongCount} 道待复习`,
      accuracy: known(metrics.accuracy, "%"),
      accuracyTrend: metrics.accuracy == null ? "暂无掌握度数据" : "由已采纳的掌握证据计算",
      planDeadline: plan.deadline || "尚未建立计划",
      planTitle: plan.title || "暂无学习计划",
      planDescription: plan.description || "当前数据库中还没有该学生的学习计划。",
      planProgress: known(metrics.planProgress, "%"),
      planWrongBasis: metrics.wrongQuestionCount == null ? "暂无错题数据" : `${metrics.wrongQuestionCount} 道历史错题`,
      planEventBasis: `已记录 ${known(metrics.monthlyEvents, " 条学习事件")}`
    };
  }

  function applyUserFields(user, data) {
    const values = userFieldValues(user, data);
    for (const [key, value] of Object.entries(values)) {
      document.querySelectorAll(`[data-user-field="${key}"]`).forEach((element) => { element.textContent = value; });
    }
    const progress = Number(data.metrics?.planProgress || 0);
    document.querySelector("#userPlanProgressRing")?.style.setProperty("--progress", `${progress}%`);
  }

  function presentLearningEvent(event) {
    const payload = event?.payload || {};
    const source = event?.source_type ? ` · ${event.source_type}` : "";
    const occurred = formatEventTime(event?.occurred_at);
    return {
      kind: event?.event_type === "mastery_evidence" ? "correct" : "import",
      title: event?.title || "学习记录",
      description: event?.description || "已写入学习记录。",
      meta: `${occurred}${source}`,
      action: payload.knowledge_point_id ? "graph" : "",
      actionLabel: payload.knowledge_point_id ? "查看知识点" : "",
      audit: payload.apply_to_mastery === false ? "未计入掌握度" : "已记录"
    };
  }

  function formatEventTime(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "时间未记录";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function eventIcon(kind) {
    return { correct: "check", import: "file-scan", warning: "triangle-alert", preference: "message-circle" }[kind] || "activity";
  }

  function renderLearningEvents(data) {
    const root = document.querySelector("#learningEventList");
    if (!root) return;
    const events = Array.isArray(data.events) ? data.events : [];
    const status = educationClient?.getStatus?.("student") || "idle";
    const error = educationClient?.getError?.("student");
    if (status === "loading" || status === "idle") {
      root.innerHTML = `<div class="user-empty-learning-state"><i data-lucide="loader-circle" aria-hidden="true"></i><b>正在读取学习记录</b><p>正在从教育数据服务加载当前学生的数据。</p></div>`;
      return;
    }
    if (status === "error") {
      root.innerHTML = `<div class="user-empty-learning-state"><i data-lucide="circle-alert" aria-hidden="true"></i><b>学习记录读取失败</b><p>${escapeHTML(error?.message || "请稍后重试")}</p></div>`;
      return;
    }
    root.innerHTML = events.length ? events.map((event) => `<article>
      <span class="event-icon ${escapeHTML(event.kind || "correct")}"><i data-lucide="${eventIcon(event.kind)}" aria-hidden="true"></i></span>
      <div><b>${escapeHTML(event.title)}</b><p>${escapeHTML(event.description)}</p><small>${escapeHTML(event.meta)}</small></div>
      ${event.action ? `<button type="button" data-user-event-action="${escapeHTML(event.action)}">${escapeHTML(event.actionLabel || "查看")}</button>` : `<span class="event-audit-tag">${escapeHTML(event.audit || "已记录")}</span>`}
    </article>`).join("") : `<div class="user-empty-learning-state"><i data-lucide="notebook-tabs" aria-hidden="true"></i><b>还没有学习记录</b><p>当前数据库中没有该学生的学习事件。</p><button type="button" data-user-event-action="agent">问AI教师</button></div>`;
  }

  function renderMasteryRecord(data) {
    const view = document.querySelector("#masteryRecordView");
    const content = document.querySelector("#masteryRecordContent");
    const select = document.querySelector("#masteryRecordPointSelect");
    if (!view || !content || !select) return;

    const userId = getCurrentUserId();
    if (masteryRecordStudentId !== userId) {
      masteryRecordStudentId = userId;
      selectedMasteryPointId = "";
    }

    const studentStatus = educationClient?.getStatus?.("student") || "idle";
    const historyStatus = educationClient?.getStatus?.("masteryHistory") || "idle";
    const historyError = educationClient?.getError?.("masteryHistory");
    const mastery = data?.mastery || { records: [] };
    const history = data?.masteryHistory || { items: [], policy: null };
    const historyItems = Array.isArray(history.items) ? history.items : [];

    if (!userId || studentStatus === "loading" || studentStatus === "idle" || historyStatus === "loading" || historyStatus === "idle") {
      view.setAttribute("aria-busy", "true");
      select.disabled = true;
      select.innerHTML = `<option>正在读取…</option>`;
      content.innerHTML = masteryRecordState("loader-circle", "正在读取掌握记录", "正在加载当前学生的掌握快照、证据时间线和计算规则。");
      return;
    }

    if (studentStatus === "error" || historyStatus === "error") {
      view.setAttribute("aria-busy", "false");
      select.disabled = true;
      select.innerHTML = `<option>读取失败</option>`;
      content.innerHTML = masteryRecordState("circle-alert", "知识掌握读取失败", historyError?.message || educationClient?.getError?.("student")?.message || "请稍后重试。");
      return;
    }

    const points = collectMasteryRecordPoints(mastery.records, historyItems);
    if (!points.length) {
      view.setAttribute("aria-busy", "false");
      select.disabled = true;
      select.innerHTML = `<option>暂无可查看知识点</option>`;
      content.innerHTML = masteryRecordState("notebook-tabs", "还没有掌握记录", "完成一次有效作答或导入已审核试卷后，这里会显示可追溯的变化。");
      return;
    }

    if (!points.some((point) => point.id === selectedMasteryPointId)) {
      selectedMasteryPointId = points[0].id;
    }
    select.innerHTML = points.map((point) => `<option value="${escapeHTML(point.id)}">${escapeHTML(point.name)}</option>`).join("");
    select.value = selectedMasteryPointId;
    select.disabled = false;

    const selectedPoint = points.find((point) => point.id === selectedMasteryPointId) || points[0];
    const record = selectedPoint.record || masteryRecordFromSummary(history.summary, selectedPoint.id);
    const events = historyItems
      .filter((item) => item?.knowledge_point?.id === selectedPoint.id)
      .sort((left, right) => Date.parse(right.occurred_at || "") - Date.parse(left.occurred_at || ""));
    const currentProbability = numericOrNull(record?.mastery_probability ?? record?.after_probability);
    const currentState = String(record?.mastery_state || record?.after_state || "unassessed");
    const confidence = numericOrNull(record?.confidence);
    const evidenceCount = numericOrNull(record?.evidence_count);
    const lastEventAt = record?.last_event_at || events[0]?.occurred_at || null;
    const appliedEvents = events.filter((item) => item.apply_to_mastery === true);
    const demoOnly = appliedEvents.length > 0 && appliedEvents.every((item) => item.evidence_class === "demo");

    view.setAttribute("aria-busy", "false");
    content.innerHTML = `
      ${demoOnly ? `<div class="mastery-record-boundary"><i data-lucide="flask-conical" aria-hidden="true"></i><span><b>当前仅有演示基线</b><small>演示证据会以低权重参与投影，不代表学生真实测评结果。</small></span></div>` : ""}
      <section class="mastery-current-summary mastery-state-${escapeHTML(currentState)}" aria-label="${escapeHTML(selectedPoint.name)}当前掌握情况">
        <div class="mastery-current-score">
          <span>当前掌握度</span>
          <strong>${formatProbability(currentProbability)}</strong>
          <em>${escapeHTML(MASTERY_STATE_LABELS[currentState] || "未评估")}</em>
        </div>
        <dl>
          <div><dt>置信度</dt><dd>${formatProbability(confidence)}</dd></div>
          <div><dt>有效证据</dt><dd>${evidenceCount == null ? "—" : `${Math.round(evidenceCount)} 条`}</dd></div>
          <div><dt>最近更新</dt><dd>${escapeHTML(formatMasteryDate(lastEventAt))}</dd></div>
        </dl>
      </section>
      <div class="mastery-record-detail">
        <section class="mastery-evidence-section">
          <header><div><span>分数变化</span><h3>证据时间线</h3></div><small>${events.length ? `${events.length} 条记录` : "暂无明细"}</small></header>
          ${events.length ? `<ol class="mastery-evidence-timeline">${events.map(renderMasteryEvidenceItem).join("")}</ol>` : masteryRecordState("history", "暂无证据明细", "当前有掌握快照，但服务端尚未返回可展示的前后分数。")}
        </section>
        ${renderMasteryCalculation(history.policy, history.history_mode)}
      </div>`;
  }

  function masteryRecordState(icon, title, description) {
    return `<div class="user-empty-learning-state mastery-record-state"><i data-lucide="${escapeHTML(icon)}" aria-hidden="true"></i><b>${escapeHTML(title)}</b><p>${escapeHTML(description)}</p></div>`;
  }

  function collectMasteryRecordPoints(records, historyItems) {
    const pointMap = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record?.knowledge_point_id || record.mastery_probability == null) return;
      pointMap.set(String(record.knowledge_point_id), {
        id: String(record.knowledge_point_id),
        name: String(record.knowledge_point_name || "未命名知识点"),
        record,
        lastAt: record.last_event_at || ""
      });
    });
    (Array.isArray(historyItems) ? historyItems : []).forEach((item) => {
      const id = String(item?.knowledge_point?.id || "");
      if (!id) return;
      const current = pointMap.get(id) || { id, name: String(item.knowledge_point.name || "未命名知识点"), record: null, lastAt: "" };
      if (!current.name || current.name === "未命名知识点") current.name = String(item.knowledge_point.name || current.name);
      if ((item.occurred_at || "") > current.lastAt) current.lastAt = item.occurred_at || "";
      pointMap.set(id, current);
    });
    return [...pointMap.values()].sort((left, right) => String(right.lastAt).localeCompare(String(left.lastAt), "zh-CN") || left.name.localeCompare(right.name, "zh-CN"));
  }

  function masteryRecordFromSummary(summary, pointId) {
    if (!summary || typeof summary !== "object") return null;
    const byKnowledgePoint = Array.isArray(summary.by_knowledge_point) ? summary.by_knowledge_point : [];
    const matchingSummary = byKnowledgePoint.find((item) => {
      const itemId = String(item?.knowledge_point?.id || item?.knowledge_point_id || "");
      return itemId === pointId;
    });
    if (matchingSummary) return matchingSummary;
    const candidate = summary.current && typeof summary.current === "object" ? summary.current : summary;
    const candidatePointId = String(candidate.knowledge_point?.id || candidate.knowledge_point_id || "");
    return candidatePointId === pointId ? candidate : null;
  }

  function renderMasteryEvidenceItem(item) {
    const evidence = masteryEvidencePresentation(item);
    const before = numericOrNull(item.before_probability);
    const after = numericOrNull(item.after_probability);
    const delta = numericOrNull(item.delta);
    const hasTransition = before != null && after != null;
    const transition = hasTransition
      ? `${formatProbability(before)} <i data-lucide="arrow-right" aria-hidden="true"></i> ${formatProbability(after)}`
      : before == null && after != null
        ? `未评估 <i data-lucide="arrow-right" aria-hidden="true"></i> ${formatProbability(after)}`
        : before != null && after == null
          ? `${formatProbability(before)} <i data-lucide="arrow-right" aria-hidden="true"></i> 未评估`
        : item.apply_to_mastery
          ? "服务端未返回变化值"
          : "未改变掌握度";
    const details = [
      outcomeLabel(item.outcome),
      difficultyLabel(item.difficulty),
      item.hints_used == null ? "" : `使用提示 ${Math.max(0, Math.round(item.hints_used))} 次`,
      formatDuration(item.duration_ms),
      item.effective_score == null ? "" : `有效分 ${formatProbability(item.effective_score)}`,
      item.effective_weight == null ? "" : `证据权重 ${formatDecimal(item.effective_weight)}`
    ].filter(Boolean);
    return `<li class="mastery-evidence-item is-${escapeHTML(evidence.tone)}">
      <span class="mastery-evidence-marker" aria-hidden="true"></span>
      <article>
        <header><div><span class="mastery-evidence-kind">${escapeHTML(evidence.label)}</span><time>${escapeHTML(formatMasteryDate(item.occurred_at))}</time></div><small>${escapeHTML(sourceLabel(item.source_type))}</small></header>
        <h4>${escapeHTML(item.title || evidence.title)}</h4>
        <div class="mastery-score-change"><strong>${transition}</strong>${delta == null ? "" : `<em class="${delta > 0 ? "is-positive" : delta < 0 ? "is-negative" : "is-neutral"}">${escapeHTML(formatProbabilityDelta(delta))}</em>`}</div>
        ${details.length ? `<p>${details.map((detail) => `<span>${escapeHTML(detail)}</span>`).join("")}</p>` : ""}
      </article>
    </li>`;
  }

  function masteryEvidencePresentation(item) {
    if (item.apply_to_mastery !== true || item.evidence_class === "proposal") {
      return { label: "未计分", tone: "unscored", title: "未采纳的学习观察" };
    }
    if (item.evidence_class === "real") return { label: "真实证据", tone: "real", title: "完成一次已验证作答" };
    if (item.evidence_class === "demo") return { label: "演示基线", tone: "demo", title: "导入演示学情快照" };
    return { label: "历史证据", tone: "legacy", title: "历史学习记录" };
  }

  function renderMasteryCalculation(policy, historyMode) {
    if (!policy || typeof policy !== "object") {
      return `<aside class="mastery-calculation-panel"><header><span>计算逻辑</span><h3>服务端计算</h3></header>${masteryRecordState("shield-check", "暂无规则说明", "分数变化仍以服务端返回结果为准。")}</aside>`;
    }
    const thresholds = policy.thresholds || {};
    const outcomes = policy.outcome_scores || {};
    const classes = policy.evidence_class_weights || {};
    const forgetting = policy.forgetting || {};
    const version = policy.config_version == null ? "" : `v${Math.round(policy.config_version)}`;
    const replayNote = ["replayed_current_policy", "current_policy_replay"].includes(historyMode)
      ? "历史变化按当前规则回放"
      : "历史变化由服务端返回";
    return `<aside class="mastery-calculation-panel">
      <header><div><span>计算逻辑</span><h3>掌握度如何更新</h3></div>${version ? `<em>${escapeHTML(version)}</em>` : ""}</header>
      <p class="mastery-calculation-summary">服务端将作答分数按题目难度、证据来源、提示与作答时长加权，再合并为当前掌握度。</p>
      <dl class="mastery-calculation-rules">
        <div><dt>作答结果</dt><dd>${ruleTriplet(outcomes.correct, outcomes.partial, outcomes.incorrect, ["正确", "部分正确", "错误"])}</dd></div>
        <div><dt>状态阈值</dt><dd>${thresholdText(thresholds)}</dd></div>
        <div><dt>证据权限</dt><dd>${evidenceWeightText(classes)}</dd></div>
        <div><dt>遗忘修正</dt><dd>${forgettingText(forgetting)}</dd></div>
      </dl>
      <footer><i data-lucide="shield-check" aria-hidden="true"></i><span><b>前端不计算分数</b><small>${escapeHTML(replayNote)}；AI 观察未经验证不会改写掌握度。</small></span></footer>
    </aside>`;
  }

  function ruleTriplet(first, second, third, labels) {
    const values = [first, second, third];
    if (values.every((value) => numericOrNull(value) == null)) return "按服务端当前规则换算";
    return values.map((value, index) => `${labels[index]} ${formatProbability(numericOrNull(value))}`).join(" · ");
  }

  function thresholdText(thresholds) {
    const values = [thresholds.learning, thresholds.secure, thresholds.mastered].map(numericOrNull);
    if (values.every((value) => value == null)) return "由服务端判定学习中、基本掌握与熟练掌握";
    return `学习中 ${formatProbability(values[0])} · 基本掌握 ${formatProbability(values[1])} · 熟练掌握 ${formatProbability(values[2])}`;
  }

  function evidenceWeightText(classes) {
    const real = numericOrNull(classes.real);
    const demo = numericOrNull(classes.demo);
    const proposal = numericOrNull(classes.proposal);
    if ([real, demo, proposal].every((value) => value == null)) return "真实证据、演示基线与 AI 建议分类处理";
    return `真实 ${formatDecimal(real)} · 演示 ${formatDecimal(demo)} · AI 建议 ${formatDecimal(proposal)}`;
  }

  function forgettingText(forgetting) {
    if (forgetting.enabled === false) return "当前未启用遗忘修正";
    const grace = numericOrNull(forgetting.grace_period_days);
    const halfLife = numericOrNull(forgetting.half_life_days);
    if (grace == null && halfLife == null) return "长期无新证据时由服务端进行遗忘修正";
    return `${grace == null ? "" : `${Math.round(grace)} 天保护期`}${grace != null && halfLife != null ? " · " : ""}${halfLife == null ? "" : `${Math.round(halfLife)} 天半衰期`}`;
  }

  function sourceLabel(source) {
    return ({
      deterministic_grader: "系统判题",
      server_graded_question: "系统判题",
      teacher_review: "教师复核",
      validated_model: "受控模型判题",
      imported_verified_exam: "已审核试卷",
      rebuildable_demo_seed: "演示数据"
    })[String(source || "")] || "学习记录";
  }

  function outcomeLabel(outcome) {
    return ({
      correct: "正确",
      answer_correct: "正确",
      passed: "正确",
      partial: "部分正确",
      partially_correct: "部分正确",
      incorrect: "错误",
      answer_incorrect: "错误",
      failed: "错误",
      historical_demo_snapshot: "历史快照"
    })[String(outcome || "")] || "";
  }

  function difficultyLabel(difficulty) {
    return ({ foundation: "基础题", easy: "容易", medium: "中等", hard: "困难", challenge: "挑战" })[String(difficulty || "")] || "";
  }

  function formatDuration(value) {
    const milliseconds = numericOrNull(value);
    if (milliseconds == null || milliseconds <= 0) return "";
    const seconds = Math.round(milliseconds / 1000);
    return seconds < 60 ? `作答 ${seconds} 秒` : `作答 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  }

  function formatProbability(value) {
    const number = numericOrNull(value);
    return number == null ? "—" : `${Math.round(number * 100)}%`;
  }

  function formatProbabilityDelta(value) {
    const number = numericOrNull(value);
    if (number == null) return "";
    const points = number * 100;
    const rounded = Math.abs(points) < 1 ? points.toFixed(1) : String(Math.round(points));
    return `${points > 0 ? "+" : ""}${rounded} 个百分点`;
  }

  function formatDecimal(value) {
    const number = numericOrNull(value);
    return number == null ? "—" : Number(number.toFixed(2)).toString();
  }

  function numericOrNull(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatMasteryDate(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "暂无时间";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function applyWeeklyPlanTasks(data) {
    if (!data.plan) {
      const list = document.querySelector(".weekly-plan-card .plan-day-list");
      if (list) list.innerHTML = `<div class="user-empty-learning-state"><i data-lucide="calendar-plus" aria-hidden="true"></i><b>还没有学习计划</b><p>当前数据库中没有该学生的计划与任务记录。</p></div>`;
      const title = document.querySelector(".weekly-plan-card h3");
      if (title) title.textContent = "本周学习安排";
      const summary = document.querySelector("#weeklyPlanProgress");
      if (summary) summary.textContent = "暂无任务";
      const insight = document.querySelector(".plan-insight-column");
      if (insight) insight.innerHTML = `<article class="plan-insight-card boundary"><i data-lucide="database" aria-hidden="true"></i><div><b>等待计划数据</b><p>未经学生或教师确认的任务不会自动生成。</p></div></article>`;
      return;
    }
    const completed = new Set(data.plan?.completedWeeklyTaskIds || []);
    const tasks = [...document.querySelectorAll("[data-plan-task-id]")];
    for (const button of tasks) {
      const done = completed.has(button.dataset.planTaskId);
      button.classList.toggle("is-done", done);
      button.closest("article")?.classList.toggle("is-done", done);
      button.innerHTML = done ? '<i data-lucide="check" aria-hidden="true"></i>' : "";
      const status = button.closest("article")?.querySelector(":scope > strong");
      if (status) status.textContent = done ? "已完成" : "待开始";
    }
    const count = tasks.filter((button) => completed.has(button.dataset.planTaskId)).length;
    const summary = document.querySelector("#weeklyPlanProgress");
    if (summary) summary.textContent = `已完成 ${count} / ${tasks.length}`;
  }

  function updateWeeklyPlanTask(taskId, done) {
    updateUserData((data) => {
      const completed = new Set(data.plan?.completedWeeklyTaskIds || []);
      if (done) completed.add(taskId); else completed.delete(taskId);
      data.plan = { ...(data.plan || {}), completedWeeklyTaskIds: [...completed] };
      return data;
    });
  }

  function renderUserMenu() {
    const root = document.querySelector("#learningUserList");
    if (!root) return;
    const activeId = getCurrentUserId();
    const status = educationClient?.getStatus?.("students") || "loading";
    const error = educationClient?.getError?.("students");
    if (status === "loading" || status === "idle") {
      root.innerHTML = `<div class="user-empty-learning-state"><b>正在读取学生列表</b></div>`;
      return;
    }
    if (status === "error") {
      root.innerHTML = `<div class="user-empty-learning-state"><b>学生列表读取失败</b><p>${escapeHTML(error?.message || "请稍后重试")}</p></div>`;
      return;
    }
    root.innerHTML = getUsers().map((user) => `<button class="learning-user-option${user.id === activeId ? " is-active" : ""}" type="button" role="menuitemradio" aria-checked="${user.id === activeId}" data-learning-user-id="${escapeHTML(user.id)}">
      <span class="learning-user-avatar tone-${escapeHTML(user.color || "blue")}">${escapeHTML(user.avatar || user.name.slice(0, 1))}</span>
      <span><b>${escapeHTML(user.name)}</b><small>${escapeHTML(user.grade)} · ${escapeHTML(user.goal || "自主学习")}</small></span>
      <em>${user.simulated ? "模拟" : "学生"}</em><i data-lucide="check" aria-hidden="true"></i>
    </button>`).join("") || `<div class="user-empty-learning-state"><b>没有可访问的学生</b><p>请联系管理员配置学生访问范围。</p></div>`;
  }

  function syncUserTrigger(user) {
    const avatar = document.querySelector("#learningUserAvatar");
    const name = document.querySelector("#learningUserName");
    const grade = document.querySelector("#learningUserGrade");
    if (avatar) {
      avatar.textContent = user.avatar || user.name.slice(0, 1);
      avatar.className = `learning-user-avatar tone-${user.color || "blue"}`;
    }
    if (name) name.textContent = user.name;
    if (grade) grade.textContent = user.grade;
  }

  function getCourseProgress(course, data) {
    void course;
    void data;
    return null;
  }

  function coursePercent(course, progress) {
    void course;
    void progress;
    return null;
  }

  function renderCourses(data = getUserData()) {
    const list = document.querySelector("#courseList");
    const detail = document.querySelector("#courseDetail");
    if (!list || !detail) return;
    const available = courseFilter === "completed" ? [] : COURSE_CATALOG;
    if (!available.some((course) => course.id === selectedCourseId)) selectedCourseId = available[0]?.id || COURSE_CATALOG[0].id;
    list.innerHTML = available.length ? available.map((course) => {
      const current = course.id === selectedCourseId;
      return `<button class="course-list-item tone-${escapeHTML(course.tone)}${current ? " is-selected" : ""}" type="button" role="option" aria-selected="${current}" data-course-id="${escapeHTML(course.id)}">
        <span class="course-list-cover"><i data-lucide="${escapeHTML(course.icon)}" aria-hidden="true"></i></span>
        <span class="course-list-copy"><small>${escapeHTML(course.category)}</small><b>${escapeHTML(course.shortTitle)}</b><em>${course.chapters.length} 个章节</em></span>
        <strong>目录</strong>
      </button>`;
    }).join("") : `<div class="course-list-empty"><i data-lucide="book-dashed" aria-hidden="true"></i><b>暂无已完成课程</b><button type="button" data-course-filter-reset>查看全部</button></div>`;
    const course = COURSE_CATALOG.find((item) => item.id === selectedCourseId) || COURSE_CATALOG[0];
    renderCourseDetail(course, data);
    setText("#courseActiveCount", String(COURSE_CATALOG.length));
    setText("#courseWeeklyMinutes", "—");
    setText("#coursePageGreeting", `${getCurrentUser()?.name || "同学"}，选择一门课程开始学习。`);
  }

  function getCurrentCourse() {
    const course = COURSE_CATALOG.find((item) => item.id === selectedCourseId) || COURSE_CATALOG[0];
    return clone(course);
  }

  function selectCourse(courseId) {
    const next = COURSE_CATALOG.find((item) => item.id === String(courseId || ""));
    if (!next || next.id === selectedCourseId) return getCurrentCourse();
    selectedCourseId = next.id;
    document.dispatchEvent(new CustomEvent("learning-course:change", {
      detail: { course: clone(next), scopeId: next.agentScopeId || next.id }
    }));
    return clone(next);
  }

  function renderCourseDetail(course, data) {
    const root = document.querySelector("#courseDetail");
    if (!root) return;
    void data;
    const currentChapter = course.chapters[0];
    const referenceChips = course.id === "course-junior-math"
      ? `<button type="button" data-course-reference="graph" data-reference-value="${escapeHTML(currentChapter.knowledgePointId || "")}" data-reference-label="${escapeHTML(currentChapter.knowledgePointName || currentChapter.title)}"><i data-lucide="network" aria-hidden="true"></i>知识图谱</button><button type="button" data-course-reference="bank" data-reference-value="${escapeHTML(currentChapter.knowledgePointId || "")}"><i data-lucide="library" aria-hidden="true"></i>相关题目</button><button type="button" data-course-reference="plan"><i data-lucide="calendar-check" aria-hidden="true"></i>学习计划</button>`
      : `<button type="button" data-course-reference="speaking" data-reference-value="${escapeHTML(course.practiceLevel)}"><i data-lucide="audio-lines" aria-hidden="true"></i>中考口语场景</button><button type="button" data-course-reference="plan"><i data-lucide="calendar-check" aria-hidden="true"></i>陪练计划</button>`;
    root.innerHTML = `<article class="course-detail-hero tone-${escapeHTML(course.tone)}">
      <div class="course-detail-cover"><span>${escapeHTML(course.category)}</span><i data-lucide="${escapeHTML(course.icon)}" aria-hidden="true"></i><small>${escapeHTML(course.teacher)}</small></div>
      <div class="course-detail-copy"><span class="page-eyebrow">课程目录 · 尚无个人进度</span><h2>${escapeHTML(course.title)}</h2><p>${escapeHTML(course.description)}</p><div class="course-controlled-references"><span>课程关联</span>${referenceChips}</div></div>
      <div class="course-continue-card"><span class="course-progress-ring" style="--course-progress:0%"><b>目录</b></span><small>第一章</small><strong>${escapeHTML(currentChapter.title)}</strong><button type="button" class="primary-btn" data-course-action="continue" data-course-id="${escapeHTML(course.id)}"><i data-lucide="play" aria-hidden="true"></i>开始学习</button></div>
    </article>
    <section class="course-chapter-section"><header><div><span class="page-eyebrow">课程大纲</span><h3>${course.chapters.length} 个章节</h3></div><span>共 ${course.chapters.reduce((sum, chapter) => sum + chapter.duration, 0)} 分钟</span></header>
      <div class="course-chapter-list">${course.chapters.map((chapter, index) => {
        return `<article class="course-chapter-row is-pending"><span class="course-chapter-index">${String(index + 1).padStart(2, "0")}</span><div><b>${escapeHTML(chapter.title)}</b><p>${escapeHTML(chapter.subtitle)}</p></div><small>${chapter.duration} 分钟</small><em>可学习</em><button type="button" data-course-chapter-action="preview" data-course-id="${escapeHTML(course.id)}" data-course-chapter-id="${escapeHTML(chapter.id)}">开始</button></article>`;
      }).join("")}</div>
    </section>`;
  }

  function openWorkspace(view) {
    if (view === "course") {
      showCourseWorkspace();
      return;
    }
    if (globalThis.AITeacherPortalRuntime?.openWorkspace) {
      globalThis.AITeacherPortalRuntime.openWorkspace(view);
      return;
    }
    document.querySelector(`[data-workspace-view="${view}"]`)?.click();
  }

  function showCourseWorkspace() {
    document.querySelectorAll("[data-workspace-view]").forEach((button) => {
      const active = button.dataset.workspaceView === "course";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-workspace-panel]").forEach((panel) => { panel.hidden = panel.dataset.workspacePanel !== "course"; });
    document.querySelector(".app")?.classList.remove("is-agent-view", "is-graph-immersive");
    setText("#workspaceBreadcrumb", "课程");
    setText("#workspaceTitle", "我的课程");
    const chip = document.querySelector("#workspaceTypeChip");
    if (chip) {
      chip.textContent = "课程进度 · 继续学习";
      chip.hidden = false;
    }
    renderCourses();
    document.dispatchEvent(new CustomEvent("learning-workspace:change", { detail: { view: "course" } }));
    queueMicrotask(refreshIcons);
  }

  function openCourseReference(button) {
    const kind = button.dataset.courseReference;
    const value = button.dataset.referenceValue || "";
    if (kind === "plan") {
      openWorkspace("plan");
      return;
    }
    if (kind === "speaking") {
      startSpeakingCourse(value || "junior-high");
      return;
    }
    if (kind === "graph") {
      openWorkspace("graph");
      const shelf = document.querySelector("#knowledgeShelfView");
      const graph = document.querySelector("#knowledgeGraphView");
      if (shelf) shelf.hidden = true;
      if (graph) graph.hidden = false;
      window.setTimeout(() => {
        const input = document.querySelector("#knowledgeGraphSearch");
        if (input) {
          input.value = button.dataset.referenceLabel || value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }, 40);
      return;
    }
    if (kind === "bank") {
      openWorkspace("bank");
      window.setTimeout(() => {
        const select = document.querySelector("#questionKnowledgeFilter");
        if (select && [...select.options].some((option) => option.value === value)) {
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, 30);
    }
  }

  function continueCourse(courseId, chapterId = "") {
    const course = COURSE_CATALOG.find((item) => item.id === courseId);
    if (!course) return;
    const chapter = course.chapters.find((item) => item.id === chapterId) || course.chapters[0];
    if (course.practiceLevel) {
      startSpeakingCourse(course.practiceLevel);
      return;
    }
    openWorkspace("agent");
    window.setTimeout(() => {
      const input = document.querySelector("#textQuestion");
      if (input) {
        input.value = `继续课程《${course.title}》的“${chapter.title}”，请结合我的掌握情况开始本节学习。`;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }
    }, 40);
  }

  function startSpeakingCourse(level) {
    openWorkspace("agent");
    window.setTimeout(() => document.querySelector(`[data-speaking-practice-level="${level}"]`)?.click(), 80);
  }

  function markCourseChapterComplete(courseId, chapterId) {
    void courseId;
    void chapterId;
    return false;
  }

  function applyCurrentUser() {
    const user = getCurrentUser();
    if (!user) {
      document.documentElement.dataset.learningUserId = "";
      document.documentElement.dataset.learningUserMode = "unavailable";
      const emptyUser = { id: "", name: "学生", grade: "", goal: "", avatar: "学", color: "blue" };
      const emptyData = createEmptyUserData(emptyUser);
      renderUserMenu();
      syncUserTrigger(emptyUser);
      applyUserFields(emptyUser, emptyData);
      renderLearningEvents(emptyData);
      renderMasteryRecord(emptyData);
      applyWeeklyPlanTasks(emptyData);
      renderCourses(emptyData);
      setText("#learningUserName", educationClient?.getStatus?.("students") === "error" ? "读取失败" : "正在加载");
      setText("#learningUserGrade", "教育数据");
      refreshIcons();
      return null;
    }
    const data = getUserData(user.id);
    document.documentElement.dataset.learningUserId = user.id;
    document.documentElement.dataset.learningUserMode = user.simulated ? "simulated" : "student";
    syncUserTrigger(user);
    renderUserMenu();
    applyUserFields(user, data);
    renderLearningEvents(data);
    renderMasteryRecord(data);
    applyWeeklyPlanTasks(data);
    renderCourses(data);
    refreshIcons();
    return user;
  }

  function dispatchUserChange(previousUserId) {
    const user = getCurrentUser();
    if (!user) return;
    document.dispatchEvent(new CustomEvent("learning-user:change", {
      detail: { userId: user.id, user: clone(user), previousUserId: previousUserId || null, simulated: user.simulated, dataSource: "education-api" }
    }));
  }

  function switchUser(userId) {
    const users = getUsers();
    if (!users.some((user) => user.id === userId)) return false;
    const previousUserId = getCurrentUserId();
    educationClient?.selectStudent?.(userId).catch(() => applyCurrentUser());
    applyCurrentUser();
    closeUserMenu();
    if (!educationClient?.selectStudent) dispatchUserChange(previousUserId);
    return true;
  }

  function createSimulatedUser(form) {
    void form;
    return null;
  }

  function openUserMenu() {
    const menu = document.querySelector("#learningUserMenu");
    const trigger = document.querySelector("#learningUserSwitcherButton");
    if (!menu || !trigger) return;
    renderUserMenu();
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    menu.querySelector("[data-learning-user-id]")?.focus();
    refreshIcons();
  }

  function closeUserMenu() {
    const menu = document.querySelector("#learningUserMenu");
    const trigger = document.querySelector("#learningUserSwitcherButton");
    if (menu) menu.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
  }

  function toggleUserMenu() {
    const menu = document.querySelector("#learningUserMenu");
    if (menu?.hidden === false) closeUserMenu(); else openUserMenu();
  }

  function handleDocumentClick(event) {
    const courseNavigation = event.target.closest('[data-workspace-view="course"]');
    if (courseNavigation) {
      event.preventDefault();
      event.stopPropagation();
      showCourseWorkspace();
      return;
    }
    const userOption = event.target.closest("#learningUserMenu [data-learning-user-id]");
    if (userOption) {
      switchUser(userOption.dataset.learningUserId);
      return;
    }
    const eventAction = event.target.closest("[data-user-event-action]");
    if (eventAction) {
      const action = eventAction.dataset.userEventAction;
      if (action === "records-import") {
        openWorkspace("records");
        window.setTimeout(() => document.querySelector('[data-record-tab="import"]')?.click(), 30);
      } else openWorkspace(action);
      return;
    }
    const courseItem = event.target.closest("[data-course-id]");
    if (courseItem && courseItem.matches(".course-list-item")) {
      selectCourse(courseItem.dataset.courseId);
      renderCourses();
      return;
    }
    const courseContinue = event.target.closest('[data-course-action="continue"]');
    if (courseContinue) {
      continueCourse(courseContinue.dataset.courseId);
      return;
    }
    const chapterAction = event.target.closest("[data-course-chapter-action]");
    if (chapterAction) {
      if (chapterAction.dataset.courseChapterAction === "preview") {
        selectCourse(chapterAction.dataset.courseId);
        continueCourse(chapterAction.dataset.courseId, chapterAction.dataset.courseChapterId);
      } else if (chapterAction.dataset.courseChapterAction === "review" || chapterAction.dataset.courseChapterAction === "continue") {
        continueCourse(chapterAction.dataset.courseId, chapterAction.dataset.courseChapterId);
      }
      return;
    }
    const reference = event.target.closest("[data-course-reference]");
    if (reference) {
      openCourseReference(reference);
      return;
    }
    if (event.target.closest("[data-course-filter-reset]")) {
      courseFilter = "all";
      renderCourses();
      return;
    }
    const planTask = event.target.closest("[data-plan-task-id]");
    if (planTask) {
      window.setTimeout(() => updateWeeklyPlanTask(planTask.dataset.planTaskId, planTask.classList.contains("is-done")), 0);
    }
    const switcher = document.querySelector(".learning-user-switcher");
    if (switcher && !switcher.contains(event.target)) closeUserMenu();
  }

  function bindInteractions() {
    document.addEventListener("click", handleDocumentClick, true);
    document.querySelector("#learningUserSwitcherButton")?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleUserMenu();
    });
    const createButton = document.querySelector("#createSimulatedUserButton");
    if (createButton) createButton.hidden = true;
    document.querySelector("#cancelSimulatedUserButton")?.addEventListener("click", () => document.querySelector("#createSimulatedUserDialog")?.close?.());
    document.querySelector("#createSimulatedUserForm")?.addEventListener("submit", (event) => event.preventDefault());
    document.querySelector("#masteryRecordPointSelect")?.addEventListener("change", (event) => {
      selectedMasteryPointId = String(event.currentTarget.value || "");
      renderMasteryRecord(getUserData());
      refreshIcons();
    });
    document.querySelector("#courseFilterButton")?.addEventListener("click", (event) => {
      courseFilter = courseFilter === "all" ? "completed" : "all";
      event.currentTarget.classList.toggle("is-active", courseFilter === "completed");
      event.currentTarget.title = courseFilter === "completed" ? "显示全部课程" : "仅看已完成课程";
      renderCourses();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeUserMenu();
    });
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  }

  function refreshIcons() {
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  const api = Object.freeze({
    getUsers,
    getCurrentUserId,
    getCurrentUser,
    getCurrentData: getUserData,
    getUserDataById: (userId) => clone(getUserData(userId)),
    updateCurrentData: (mutator) => updateUserData(mutator),
    storageKey,
    scopeMasterySnapshot,
    getCurrentQuestionIds,
    getPlanCalendarSeed,
    switchUser,
    getCourseCatalog: () => clone(COURSE_CATALOG),
    getCurrentCourse,
    selectCourse,
    renderCourses,
    markCourseChapterComplete,
    openWorkspace
  });

  ensureSeedData();
  window.AIClassroomUserRuntime = api;
  applyCurrentUser();
  bindInteractions();

  document.addEventListener("learning-user:change", () => applyCurrentUser());
  document.addEventListener("learning-user:data-change", () => applyCurrentUser());
  document.addEventListener("education-data:ready", () => applyCurrentUser());

  import("./education-data-client.js")
    .then(async (module) => {
      educationClient = globalThis.EducationDataClient || {
        bootstrap: module.bootstrapEducationData,
        selectStudent: module.selectEducationStudent,
        getStudents: module.getEducationStudents,
        getCurrentStudentId: module.getCurrentEducationStudentId,
        getCurrentStudent: module.getCurrentEducationStudent,
        getProfile: module.getCurrentEducationProfile,
        getMastery: module.getCurrentEducationMastery,
        getMasteryHistory: module.getCurrentEducationMasteryHistory,
        getLearningEvents: module.getCurrentEducationEvents,
        getQuestions: module.getEducationQuestions,
        getStatus: module.getEducationDataStatus,
        getError: module.getEducationDataError
      };
      applyCurrentUser();
      await educationClient.bootstrap();
      applyCurrentUser();
    })
    .catch(() => applyCurrentUser());
})();
