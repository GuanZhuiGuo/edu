const SUMMARY_URL = "/api/education/settings/summary";
const MASTERY_SETTINGS_URL = "/api/education/settings/mastery";
const RUNTIME_SETTINGS_URL = "/api/education/settings/runtime";

const RUNTIME_SETTINGS_SCHEMA = "education-runtime-settings@1.0";

const MODEL_DEFINITIONS = Object.freeze([
  {
    id: "chat",
    label: "对话与推理",
    description: "教师问答、知识判断与结构化输出",
    icon: "messages-square",
    group: "understanding",
  },
  {
    id: "vision",
    label: "视觉理解",
    description: "图片题目、文档页面与手写内容理解",
    icon: "scan-eye",
    group: "understanding",
  },
  {
    id: "embedding",
    label: "向量检索",
    description: "教材、知识点与题目的语义召回",
    icon: "scan-search",
    group: "understanding",
  },
  {
    id: "image_generation",
    label: "图片生成",
    description: "教学插图、实验示意与分镜画面",
    icon: "image",
    group: "generation",
  },
  {
    id: "video_generation",
    label: "视频生成",
    description: "教学分镜视频与配套音频",
    icon: "clapperboard",
    group: "generation",
  },
  {
    id: "realtime_voice",
    label: "实时语音",
    description: "双工语音课堂与口语陪练",
    icon: "audio-waveform",
    group: "interaction",
  },
  {
    id: "online_answer",
    label: "联网问答",
    description: "所选教材未命中时的豆包爱学补充回答",
    icon: "globe-2",
    group: "interaction",
    extraFields: ["bot_id", "service_name"],
  },
]);

const MODEL_GROUPS = Object.freeze([
  { id: "understanding", label: "理解与检索", description: "负责识别、推理和知识召回" },
  { id: "generation", label: "内容生成", description: "负责图片与视频素材生成" },
  { id: "interaction", label: "语音与联网", description: "负责实时课堂和外部补充回答" },
]);

const TAB_COPY = Object.freeze({
  teaching: { label: "教学策略", icon: "book-open-check", advanced: false },
  voice: { label: "声音与形象", icon: "audio-lines", advanced: false },
  ontology: { label: "本体抽取", icon: "network", advanced: true },
  models: { label: "模型设置", icon: "cpu", advanced: true },
  cards: { label: "知识卡片", icon: "panels-top-left", advanced: true },
});

const BASIC_TAB_IDS = Object.freeze(["teaching", "voice"]);
const ADVANCED_TAB_IDS = Object.freeze(["ontology", "models", "cards"]);

function settingsTabToken(id) {
  return `${id.slice(0, 1).toUpperCase()}${id.slice(1)}`;
}

function renderSettingsTab(id) {
  const copy = TAB_COPY[id];
  const token = settingsTabToken(id);
  return `<button id="educationSettingsTab${token}" type="button" role="tab" data-settings-tab="${id}" aria-selected="false" aria-controls="educationSettingsPanel${token}"><i data-lucide="${copy.icon}" aria-hidden="true"></i><span>${copy.label}</span></button>`;
}

const ENTITY_LABELS = Object.freeze({
  curriculum_standard: "课程标准",
  standard_clause: "课标条款",
  learning_objective: "学习目标",
  knowledge_point: "知识点",
  knowledge_component: "知识成分",
  competency: "核心能力",
  canonical_concept: "规范概念",
  representation: "知识表征",
  application_context: "应用情境",
  question_blueprint: "题目蓝图",
  question: "题目",
  question_part: "题目小问",
  solution_strategy: "解题策略",
  solution: "解法",
  solution_step: "解题步骤",
  misconception: "常见误解",
  rubric: "评分规则",
  rubric_point: "评分点",
  artifact: "知识素材",
  submission: "学生作答",
  observation: "学习观察",
  evidence_claim: "掌握证据结论",
});

const RELATION_LABELS = Object.freeze({
  part_of: "属于",
  derived_from_clause: "来源于课标条款",
  aligned_to_objective: "对应学习目标",
  develops_competency: "发展能力",
  prerequisite_of: "前置于",
  builds_on: "递进于",
  derived_from: "推导自",
  generalizes: "概括",
  specializes: "具体化",
  contrasts_with: "对比",
  equivalent_view_of: "等价表征",
  represented_by: "由…表征",
  applied_with: "共同应用",
  assesses: "直接考查",
  requires_knowledge: "解题需要",
  solvable_by: "可用…求解",
  uses_strategy: "使用策略",
  targets_misconception: "针对误解",
  misconception_of: "属于误解",
  explains: "解释",
  visualizes: "可视化",
  exact_match: "完全匹配",
  close_match: "近似匹配",
  broader_than: "上位概念",
  narrower_than: "下位概念",
});

export function initEducationSettingsWorkbench() {
  const shell = document.querySelector("#voiceConfigWorkspace .voice-config-shell");
  const voiceMount = document.querySelector("#voiceConfigMount");
  if (!shell || !voiceMount || document.querySelector("#educationSettingsWorkbench")) return null;

  const root = document.createElement("section");
  root.id = "educationSettingsWorkbench";
  root.className = "education-settings-workbench";
  root.innerHTML = `
    <nav class="education-settings-tabs" aria-label="AI教师设置分类">
      <span class="education-settings-group-label">教学设置</span>
      ${BASIC_TAB_IDS.map((id) => renderSettingsTab(id)).join("")}
      <details class="education-settings-advanced">
        <summary><i data-lucide="settings-2" aria-hidden="true"></i><span><b>系统高级设置</b><small>本体、模型与卡片底座</small></span><i class="education-settings-chevron" data-lucide="chevron-down" aria-hidden="true"></i></summary>
        <div>${ADVANCED_TAB_IDS.map((id) => renderSettingsTab(id)).join("")}</div>
      </details>
    </nav>
    <div class="education-settings-panels">
      <section id="educationSettingsPanelTeaching" class="education-settings-panel" role="tabpanel" data-settings-panel="teaching" aria-labelledby="educationSettingsTabTeaching">
        <header class="settings-section-head"><div><span>教学设置</span><h3>讲解、出题与学习证据</h3><p>设置AI教师的课堂策略、知识范围和掌握度计算规则。</p></div></header>
        <div id="masteryPolicyMount" class="settings-loading">正在读取掌握度计算规则…</div>
      </section>
      <section id="educationSettingsPanelVoice" class="education-settings-panel" role="tabpanel" data-settings-panel="voice" aria-labelledby="educationSettingsTabVoice"></section>
      <section id="educationSettingsPanelOntology" class="education-settings-panel" role="tabpanel" data-settings-panel="ontology" aria-labelledby="educationSettingsTabOntology"><div class="settings-loading">正在读取本体抽取配置…</div></section>
      <section id="educationSettingsPanelModels" class="education-settings-panel" role="tabpanel" data-settings-panel="models" aria-labelledby="educationSettingsTabModels"><div class="settings-loading">正在读取模型配置…</div></section>
      <section id="educationSettingsPanelCards" class="education-settings-panel" role="tabpanel" data-settings-panel="cards" aria-labelledby="educationSettingsTabCards"><div class="settings-loading">正在读取知识卡片配置…</div></section>
    </div>`;
  shell.insertBefore(root, voiceMount);
  root.querySelector('[data-settings-panel="voice"]')?.append(voiceMount);

  const legacyToolkit = shell.querySelector(".teacher-config-toolkit");
  if (legacyToolkit) {
    legacyToolkit.classList.add("settings-teaching-policy");
    root.querySelector('[data-settings-panel="teaching"]')?.append(legacyToolkit);
  }

  const initialRole = document.body.dataset.portalRole === "teacher" ? "teacher" : "student";
  const state = {
    activeTab: initialRole === "teacher" ? "teaching" : "voice",
    teacherTab: "teaching",
    role: initialRole,
    summary: null,
    runtime: null,
  };
  const advancedDisclosure = root.querySelector(".education-settings-advanced");
  advancedDisclosure?.addEventListener("toggle", () => {
    if (advancedDisclosure.open || !ADVANCED_TAB_IDS.includes(state.activeTab)) return;
    state.activeTab = "teaching";
    state.teacherTab = "teaching";
    syncRoleAndTab(root, state);
  });
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-settings-tab]");
    if (!button || button.hidden) return;
    state.activeTab = button.dataset.settingsTab;
    if (document.body.dataset.portalRole === "teacher") state.teacherTab = state.activeTab;
    syncRoleAndTab(root, state);
  });
  root.addEventListener("keydown", (event) => handleSettingsTabKeydown(event, root));
  root.addEventListener("submit", (event) => {
    if (event.target.matches("#masteryPolicyForm")) {
      event.preventDefault();
      saveMasteryPolicy(root, state, event.target);
      return;
    }
    if (event.target.matches("#runtimeSettingsForm")) {
      event.preventDefault();
      saveRuntimeSettings(root, state, event.target);
    }
  });
  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-clear-api-key]")) {
      syncSecretClearControl(event.target);
      if (event.target.name === "agent_proxy.clear_api_key") syncAgentProxyFields(event.target.form);
      return;
    }
    if (event.target.matches('[name="agent_proxy.enabled"]')) syncAgentProxyFields(event.target.form);
  });
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-mastery-reset]")) {
      renderMasteryPolicy(root, state.summary?.mastery);
      return;
    }
    if (event.target.closest("[data-runtime-reset]")) {
      renderRuntimeSettings(root, state.runtime, { status: "已恢复为上次保存的设置" });
      return;
    }
    if (event.target.closest("[data-runtime-retry]")) {
      refreshRuntimeSettings(root, state);
      return;
    }
    if (event.target.closest("[data-summary-retry]")) {
      refreshSettingsSummary(root, state);
    }
  });
  document.addEventListener("portal-role:change", () => syncRoleAndTab(root, state));
  document.addEventListener("learning-workspace:change", () => syncRoleAndTab(root, state));
  bindTeacherToolDisclosure();

  refreshSettingsSummary(root, state);

  syncRoleAndTab(root, state);
  refreshIcons();
  return Object.freeze({ refresh: () => refreshSettingsSummary(root, state) });
}

async function refreshSettingsSummary(root, state) {
  root.querySelectorAll("[data-summary-load-error]").forEach((node) => {
    node.className = "settings-loading";
    node.removeAttribute("data-summary-load-error");
    node.textContent = "正在重新读取配置…";
  });
  try {
    const summary = await loadSummary();
    state.summary = summary;
    renderMasteryPolicy(root, summary.mastery);
    renderOntology(root, summary.ontology);
    renderModels(root, summary.models, summary.storage);
    renderCards(root, summary.cards);
    syncRoleAndTab(root, state);
    refreshIcons();
    await refreshRuntimeSettings(root, state);
    return summary;
  } catch (error) {
    root.querySelectorAll(".settings-loading").forEach((node) => {
      node.className = "settings-load-error settings-summary-load-error";
      node.dataset.summaryLoadError = "true";
      node.innerHTML = `<span>${escapeHTML(error?.message || "配置读取失败")}</span><button type="button" data-summary-retry>重新读取</button>`;
    });
    return null;
  }
}

function renderMasteryPolicy(root, mastery = null) {
  const mount = root.querySelector("#masteryPolicyMount");
  if (!mount) return;
  if (!mastery?.policy) {
    mount.className = "settings-load-error";
    mount.textContent = "掌握度配置暂不可用";
    return;
  }
  const policy = mastery.policy;
  const evidence = mastery.evidence || {};
  const byClass = evidence.by_class || {};
  mount.className = "mastery-policy-workbench";
  mount.innerHTML = `
    <section class="mastery-authority-strip" aria-label="掌握度运行状态">
      <div><span class="mastery-live-dot" aria-hidden="true"></span><p><b>${policy.enabled ? "真实计算已启用" : "真实计算已停用"}</b><small>仅服务端验证的判题回执可以改变掌握度；AI 输出只作为观察建议。</small></p></div>
      <code>v${number(mastery.config_version)}</code>
    </section>
    <div class="mastery-evidence-ledger" aria-label="学习证据分类">
      ${evidenceLedgerItem("真实证据", byClass.real, "已验证作答", "real")}
      ${evidenceLedgerItem("演示基线", byClass.demo, "保留为低权重先验", "demo")}
      ${evidenceLedgerItem("AI 建议", byClass.proposal, "不参与计算", "proposal")}
      ${evidenceLedgerItem("历史证据", byClass.legacy, "按兼容权重处理", "legacy")}
    </div>
    <form id="masteryPolicyForm" class="mastery-policy-form">
      <div class="mastery-form-toolbar">
        <label class="mastery-enable-control"><input type="checkbox" name="enabled" ${policy.enabled ? "checked" : ""}><span><b>启用真实掌握度计算</b><small>停用后保留证据，但不再生成有效掌握投影</small></span></label>
        <span class="mastery-save-status" role="status" aria-live="polite"></span>
      </div>
      <div class="mastery-policy-groups">
        ${policyGroup("作答结果", "当判题回执只给出对、部分对或错时，换算为可计算分值", [
          numericField("正确", "outcome_scores.correct", policy.outcome_scores?.correct, 0, 1, 0.01),
          numericField("部分正确", "outcome_scores.partial", policy.outcome_scores?.partial, 0, 1, 0.01),
          numericField("错误", "outcome_scores.incorrect", policy.outcome_scores?.incorrect, 0, 1, 0.01),
        ])}
        ${policyGroup("掌握阈值", "从低到高划分学习中、稳固和掌握", [
          numericField("学习中", "thresholds.learning", policy.thresholds?.learning, 0, 1, 0.01),
          numericField("基本稳固", "thresholds.secure", policy.thresholds?.secure, 0, 1, 0.01),
          numericField("熟练掌握", "thresholds.mastered", policy.thresholds?.mastered, 0, 1, 0.01),
        ])}
        ${policyGroup("难度权重", "同样的作答结果，题目难度决定证据强度", [
          numericField("基础题", "difficulty_weights.foundation", policy.difficulty_weights?.foundation, 0.05, 5, 0.01),
          numericField("容易", "difficulty_weights.easy", policy.difficulty_weights?.easy, 0.05, 5, 0.01),
          numericField("中等", "difficulty_weights.medium", policy.difficulty_weights?.medium, 0.05, 5, 0.01),
          numericField("困难", "difficulty_weights.hard", policy.difficulty_weights?.hard, 0.05, 5, 0.01),
          numericField("挑战", "difficulty_weights.challenge", policy.difficulty_weights?.challenge, 0.05, 5, 0.01),
        ])}
        ${policyGroup("提示与作答时长", "使用提示或异常快慢的作答会降低证据强度", [
          numericField("每次提示扣分", "hint_adjustment.score_penalty_per_hint", policy.hint_adjustment?.score_penalty_per_hint, 0, 1, 0.01),
          numericField("提示最大扣分", "hint_adjustment.maximum_score_penalty", policy.hint_adjustment?.maximum_score_penalty, 0, 1, 0.01),
          numericField("每次提示权重扣减", "hint_adjustment.weight_penalty_per_hint", policy.hint_adjustment?.weight_penalty_per_hint, 0, 1, 0.01),
          numericField("提示最低权重", "hint_adjustment.minimum_weight_multiplier", policy.hint_adjustment?.minimum_weight_multiplier, 0, 1, 0.01),
          numericField("中等题预期秒数", "duration_adjustment.expected_ms.medium", Math.round((policy.duration_adjustment?.expected_ms?.medium || 90_000) / 1000), 1, 7200, 1, "seconds"),
          numericField("过快比例", "duration_adjustment.too_fast_ratio", policy.duration_adjustment?.too_fast_ratio, 0.01, 1, 0.01),
          numericField("过慢比例", "duration_adjustment.too_slow_ratio", policy.duration_adjustment?.too_slow_ratio, 1, 20, 0.1),
          numericField("时长最低权重", "duration_adjustment.minimum_weight_multiplier", policy.duration_adjustment?.minimum_weight_multiplier, 0.05, 1, 0.01),
        ])}
        ${policyGroup("遗忘与置信度", "长期没有新证据时，掌握判断逐步回归中性", [
          checkboxField("启用遗忘衰减", "forgetting.enabled", policy.forgetting?.enabled),
          numericField("保护期（天）", "forgetting.grace_period_days", policy.forgetting?.grace_period_days, 0, 3650, 1),
          numericField("半衰期（天）", "forgetting.half_life_days", policy.forgetting?.half_life_days, 1, 3650, 1),
          numericField("最低保留率", "forgetting.minimum_retention", policy.forgetting?.minimum_retention, 0, 1, 0.01),
          numericField("遗忘回归基线", "forgetting.baseline_probability", policy.forgetting?.baseline_probability, 0, 1, 0.01),
          numericField("置信度尺度", "confidence.weight_scale", policy.confidence?.weight_scale, 0.1, 100, 0.1),
        ])}
        ${policyGroup("证据来源", "教师审核、确定性判题与模型判题保持不同权重", [
          numericField("确定性判题", "source_weights.deterministic_grader", policy.source_weights?.deterministic_grader, 0, 5, 0.01),
          numericField("教师审核", "source_weights.teacher_review", policy.source_weights?.teacher_review, 0, 5, 0.01),
          numericField("受控模型判题", "source_weights.validated_model", policy.source_weights?.validated_model, 0, 5, 0.01),
          numericField("已审核试卷", "source_weights.imported_verified_exam", policy.source_weights?.imported_verified_exam, 0, 5, 0.01),
          numericField("真实证据权重", "evidence_class_weights.real", policy.evidence_class_weights?.real, 0, 2, 0.01),
          numericField("演示基线权重", "evidence_class_weights.demo", policy.evidence_class_weights?.demo, 0, 2, 0.01),
          numericField("历史证据权重", "evidence_class_weights.legacy", policy.evidence_class_weights?.legacy, 0, 2, 0.01),
        ])}
      </div>
      <footer class="mastery-form-actions">
        <p>保存后服务端会用新规则重算当前租户的掌握投影。</p>
        <button type="button" class="mastery-secondary-button" data-mastery-reset>撤销未保存修改</button>
        <button type="submit" class="mastery-primary-button"><i data-lucide="save" aria-hidden="true"></i>保存计算规则</button>
      </footer>
    </form>`;
  refreshIcons();
}

async function saveMasteryPolicy(root, state, form) {
  const status = form.querySelector(".mastery-save-status");
  const submit = form.querySelector('[type="submit"]');
  const current = state.summary?.mastery;
  if (!current?.policy) return;
  const next = structuredClone(current.policy);
  const data = new FormData(form);
  next.enabled = data.has("enabled");
  for (const input of form.querySelectorAll("[data-policy-path]")) {
    const path = input.dataset.policyPath;
    const value = input.type === "checkbox" ? input.checked : Number(input.value);
    if (input.dataset.unit === "seconds") setNestedValue(next, path, value * 1000);
    else setNestedValue(next, path, value);
  }
  submit.disabled = true;
  status.className = "mastery-save-status is-saving";
  status.textContent = "正在保存并重算…";
  try {
    const response = await fetch(MASTERY_SETTINGS_URL, {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ expected_version: current.config_version, policy: next }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.schema_version !== "education-mastery-settings@1.0") {
      throw new Error(payload?.message || "计算规则保存失败");
    }
    state.summary.mastery = payload;
    renderMasteryPolicy(root, payload);
    const nextStatus = root.querySelector(".mastery-save-status");
    if (nextStatus) {
      nextStatus.className = "mastery-save-status is-saved";
      nextStatus.textContent = `已保存，重算 ${number(payload.recompute?.projection_count)} 个知识点投影`;
    }
  } catch (error) {
    status.className = "mastery-save-status is-error";
    status.textContent = error?.message || "计算规则保存失败";
    submit.disabled = false;
  }
}

function policyGroup(title, description, fields) {
  return `<fieldset class="mastery-policy-group"><legend>${escapeHTML(title)}</legend><p>${escapeHTML(description)}</p><div>${fields.join("")}</div></fieldset>`;
}

function numericField(label, path, value, min, max, step, unit = "") {
  return `<label class="mastery-number-field"><span>${escapeHTML(label)}</span><input type="number" data-policy-path="${escapeHTML(path)}" data-unit="${escapeHTML(unit)}" value="${escapeHTML(value)}" min="${min}" max="${max}" step="${step}" required></label>`;
}

function checkboxField(label, path, checked) {
  return `<label class="mastery-checkbox-field"><input type="checkbox" data-policy-path="${escapeHTML(path)}" ${checked ? "checked" : ""}><span>${escapeHTML(label)}</span></label>`;
}

function evidenceLedgerItem(label, value = {}, detail, kind) {
  return `<article data-evidence-kind="${kind}"><span>${escapeHTML(label)}</span><b>${number(value.count)}</b><small>${escapeHTML(detail)}</small></article>`;
}

function setNestedValue(target, path, value) {
  const parts = String(path).split(".");
  const last = parts.pop();
  const parent = parts.reduce((cursor, part) => cursor[part] ??= {}, target);
  parent[last] = value;
}

async function loadSummary() {
  const response = await fetch(SUMMARY_URL, { headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.schema_version !== "education-settings-summary@1.0") {
    throw new Error(payload?.message || "设置摘要协议不可用");
  }
  return payload;
}

function syncRoleAndTab(root, state) {
  const teacher = document.body.dataset.portalRole === "teacher";
  const nextRole = teacher ? "teacher" : "student";
  if (state.role !== nextRole) {
    if (teacher) state.activeTab = state.teacherTab || "teaching";
    else {
      if (TAB_COPY[state.activeTab]?.advanced === false) state.teacherTab = state.activeTab;
      state.activeTab = "voice";
    }
    state.role = nextRole;
  }
  if (!teacher) state.activeTab = "voice";
  if (teacher && !TAB_COPY[state.activeTab]) state.activeTab = "teaching";
  root.dataset.role = teacher ? "teacher" : "student";
  root.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.hidden = !teacher && button.dataset.settingsTab !== "voice";
    const selected = button.dataset.settingsTab === state.activeTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = button.hidden ? -1 : 0;
  });
  root.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== state.activeTab;
  });
  const tabs = root.querySelector(".education-settings-tabs");
  if (tabs) tabs.hidden = !teacher;
  const advancedDisclosure = root.querySelector(".education-settings-advanced");
  if (advancedDisclosure) {
    advancedDisclosure.hidden = !teacher;
    if (ADVANCED_TAB_IDS.includes(state.activeTab)) advancedDisclosure.open = true;
    advancedDisclosure.classList.toggle("has-active-tab", ADVANCED_TAB_IDS.includes(state.activeTab));
  }
  const saveButton = document.querySelector("#voiceConfigApplyBtn");
  const saveStatus = document.querySelector("#voiceConfigApplyStatus");
  const basicSettingsActive = BASIC_TAB_IDS.includes(state.activeTab);
  if (saveButton) saveButton.hidden = !basicSettingsActive;
  if (saveStatus) saveStatus.hidden = !basicSettingsActive;
}

function handleSettingsTabKeydown(event, root) {
  const current = event.target.closest("[data-settings-tab]");
  if (!current) return;
  const tabs = [...root.querySelectorAll("[data-settings-tab]")].filter((button) => (
    !button.hidden && !button.closest("details:not([open])")
  ));
  const index = tabs.indexOf(current);
  if (index < 0) return;
  const direction = event.key === "ArrowDown" || event.key === "ArrowRight"
    ? 1
    : event.key === "ArrowUp" || event.key === "ArrowLeft"
      ? -1
      : 0;
  let nextIndex = index;
  if (direction) nextIndex = (index + direction + tabs.length) % tabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  if (!direction && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function bindTeacherToolDisclosure() {
  const disclosure = document.querySelector("#teacherToolsDisclosure");
  if (!disclosure || disclosure.dataset.settingsBound === "true") return;
  disclosure.dataset.settingsBound = "true";
  const summary = disclosure.querySelector(":scope > summary");
  const sync = () => {
    if (disclosure.querySelector(".workspace-menu-button.is-active")) disclosure.open = true;
    summary?.setAttribute("aria-label", disclosure.open ? "收起更多教学工具" : "展开更多教学工具");
  };
  disclosure.addEventListener("toggle", sync);
  document.addEventListener("learning-workspace:change", sync);
  sync();
}

function renderOntology(root, ontology = {}) {
  const panel = root.querySelector('[data-settings-panel="ontology"]');
  if (!panel) return;
  panel.innerHTML = `
    <header class="settings-section-head"><div><span>知识本体</span><h3>课标与大纲本体抽取</h3><p>系统先锁定结构规则，再让模型提出带原文锚点的候选，审核通过后才发布。</p></div><em>${escapeHTML(ontology.schema_version || "1.0")}</em></header>
    <div class="ontology-pipeline">${(ontology.pipeline_steps || []).map((step, index) => `<article><b>${index + 1}</b><span><strong>${escapeHTML(step.label)}</strong><small>${escapeHTML(authorityLabel(step.authority))}</small></span><em>${escapeHTML(step.output)}</em></article>`).join("")}</div>
    <div class="settings-summary-grid">
      <article><span>文档类型</span><b>${number(ontology.document_types?.length)}</b><small>课标、大纲、教材、题目、作业与试卷</small></article>
      <article><span>实体类型</span><b>${number(ontology.entity_types?.length)}</b><small>知识、题目、策略、误解与学习证据</small></article>
      <article><span>关系类型</span><b>${number(ontology.relation_types?.length)}</b><small>层级、前置、考查、解法与跨学科对齐</small></article>
      <article><span>语义批次</span><b>${number(ontology.limits?.semantic_batch_pages)} 页</b><small>跨批次关系必须再次审核</small></article>
    </div>
    <div class="settings-contract-grid">
      ${renderTagContract("实体规则", ontology.entity_types, ENTITY_LABELS)}
      ${renderTagContract("关系规则", ontology.relation_types, RELATION_LABELS)}
    </div>
    <section class="settings-gate-list"><header><h4>发布质量门</h4><span>模型无发布权限</span></header>${(ontology.gates || []).map((gate) => `<p><i data-lucide="shield-check" aria-hidden="true"></i>${escapeHTML(gate)}</p>`).join("")}</section>`;
}

function renderModels(root, models = [], storage = {}) {
  const panel = root.querySelector('[data-settings-panel="models"]');
  if (!panel) return;
  panel.innerHTML = `
    <header class="settings-section-head"><div><span>模型设置</span><h3>运行模型与 Agent 代理</h3><p>设置每项能力的接口、模型和访问凭证。已保存的 Key 不会返回浏览器。</p></div></header>
    <div id="runtimeSettingsMount" class="settings-loading" aria-live="polite">正在读取运行模型…</div>
    <section class="settings-storage-section" aria-labelledby="settingsStorageTitle">
      <header><div><h4 id="settingsStorageTitle">数据服务</h4><p>业务数据、向量检索与知识图谱的当前连接状态。</p></div><span>${MODEL_DEFINITIONS.length} 类模型可独立配置</span></header>
      <div class="settings-storage-grid">
        ${renderStorage("业务数据库", storage.application, storage.application?.counts ? `${storage.application.counts.students || 0} 名学生 · ${storage.application.counts.questions || 0} 道题` : "")}
        ${renderStorage("向量检索", storage.vector, `${storage.vector?.fusion || "dense_sparse_rrf"}`)}
        ${renderStorage("知识图谱", storage.graph, `${storage.graph?.release_control || "ACTIVE_RELEASE"}`)}
      </div>
    </section>`;
}

async function refreshRuntimeSettings(root, state) {
  const mount = root.querySelector("#runtimeSettingsMount");
  if (!mount) return null;
  mount.className = "settings-loading";
  mount.textContent = "正在读取运行模型…";
  try {
    const runtime = await loadRuntimeSettings();
    state.runtime = runtime;
    renderRuntimeSettings(root, runtime);
    return runtime;
  } catch (error) {
    mount.className = "settings-load-error settings-runtime-load-error";
    mount.innerHTML = `<span>${escapeHTML(error?.message || "运行模型读取失败")}</span><button type="button" data-runtime-retry>重新读取</button>`;
    return null;
  }
}

async function loadRuntimeSettings() {
  const response = await fetch(RUNTIME_SETTINGS_URL, { headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.schema_version !== RUNTIME_SETTINGS_SCHEMA) {
    throw new Error(payload?.message || "运行模型配置协议不可用");
  }
  return normalizeRuntimeSettings(payload);
}

export function normalizeRuntimeSettings(payload = {}) {
  const normalizedModels = {};
  for (const definition of MODEL_DEFINITIONS) {
    const source = payload?.models?.[definition.id] || {};
    normalizedModels[definition.id] = {
      endpoint: String(source.endpoint || ""),
      model: String(source.model || ""),
      timeout_ms: positiveInteger(source.timeout_ms, 60_000),
      bot_id: String(source.bot_id || ""),
      service_name: String(source.service_name || ""),
      api_key: { configured: source.api_key?.configured === true },
    };
  }
  const proxy = payload?.agent_proxy || {};
  return Object.freeze({
    schema_version: RUNTIME_SETTINGS_SCHEMA,
    config_version: positiveInteger(payload.config_version, 1),
    updated_at: String(payload.updated_at || ""),
    models: normalizedModels,
    agent_proxy: {
      enabled: proxy.enabled === true,
      endpoint: String(proxy.endpoint || ""),
      timeout_ms: positiveInteger(proxy.timeout_ms, 120_000),
      api_key: { configured: proxy.api_key?.configured === true },
    },
  });
}

function renderRuntimeSettings(root, runtime, { status = "", statusTone = "saved" } = {}) {
  const mount = root.querySelector("#runtimeSettingsMount");
  if (!mount || !runtime) return;
  const proxy = runtime.agent_proxy;
  mount.className = "runtime-settings-workbench";
  mount.innerHTML = `
    <form id="runtimeSettingsForm" class="runtime-settings-form">
      <section class="agent-proxy-settings" data-proxy-enabled="${proxy.enabled ? "true" : "false"}">
        <div class="agent-proxy-heading">
          <span class="runtime-section-icon"><i data-lucide="route" aria-hidden="true"></i></span>
          <div><h4>Agent 代理</h4><p>开启后，知识问答、图片解题和作业批改等非语音对话都交由代理 Agent 处理，本系统负责会话展示与卡片渲染。</p></div>
          <label class="settings-switch-control">
            <input type="checkbox" name="agent_proxy.enabled" ${proxy.enabled ? "checked" : ""} aria-label="Agent 代理" aria-describedby="agentProxyModeNote">
            <span class="settings-switch-track" aria-hidden="true"><span></span></span>
            <b>${proxy.enabled ? "已开启" : "已关闭"}</b>
          </label>
        </div>
        <p id="agentProxyModeNote" class="agent-proxy-mode-note"><i data-lucide="${proxy.enabled ? "circle-check" : "info"}" aria-hidden="true"></i><span>${proxy.enabled ? "除实时语音外，教师对话已切换为 Agent 代理模式。" : "当前由本系统直接调用模型、检索和教学工具。"}</span></p>
        <fieldset class="agent-proxy-fields" data-agent-proxy-fields ${proxy.enabled ? "" : "hidden"}>
          <legend class="sr-only">Agent 代理连接信息</legend>
          ${textSettingField({ label: "Agent 地址", name: "agent_proxy.endpoint", value: proxy.endpoint, type: "url", placeholder: "https://agent.example.com/marketing/…", required: proxy.enabled, wide: true })}
          ${secretSettingField({ name: "agent_proxy.api_key", configured: proxy.api_key.configured, label: "Agent Key", required: proxy.enabled && !proxy.api_key.configured })}
        </fieldset>
      </section>

      <div class="runtime-model-configurations">
        ${MODEL_GROUPS.map((group) => renderModelGroup(group, runtime.models)).join("")}
      </div>

      <footer class="runtime-settings-actions">
        <div><span class="runtime-save-status ${status ? `is-${escapeHTML(statusTone)}` : ""}" role="status" aria-live="polite">${escapeHTML(status)}</span><small>配置版本 v${number(runtime.config_version)}${runtime.updated_at ? ` · ${escapeHTML(formatSettingsTime(runtime.updated_at))}` : ""}</small></div>
        <button type="button" class="mastery-secondary-button" data-runtime-reset>撤销未保存修改</button>
        <button type="submit" class="mastery-primary-button"><i data-lucide="save" aria-hidden="true"></i>保存模型设置</button>
      </footer>
    </form>`;
  syncAgentProxyFields(mount.querySelector("#runtimeSettingsForm"));
  refreshIcons();
}

function renderModelGroup(group, models) {
  const definitions = MODEL_DEFINITIONS.filter((model) => model.group === group.id);
  return `<section class="runtime-model-group" aria-labelledby="runtimeModelGroup-${escapeHTML(group.id)}">
    <header><div><h4 id="runtimeModelGroup-${escapeHTML(group.id)}">${escapeHTML(group.label)}</h4><p>${escapeHTML(group.description)}</p></div><span>${definitions.filter((item) => models[item.id]?.api_key?.configured).length}/${definitions.length} 已配置</span></header>
    <div>${definitions.map((definition, index) => renderModelConfiguration(definition, models[definition.id], group.id === "understanding" && index === 0)).join("")}</div>
  </section>`;
}

function renderModelConfiguration(definition, model = {}, open = false) {
  const configured = model.api_key?.configured === true;
  return `<details class="runtime-model-item" ${open ? "open" : ""}>
    <summary>
      <span class="runtime-model-icon"><i data-lucide="${escapeHTML(definition.icon)}" aria-hidden="true"></i></span>
      <span class="runtime-model-title"><b>${escapeHTML(definition.label)}</b><small>${escapeHTML(definition.description)}</small></span>
      <code>${escapeHTML(model.model || "未设置模型")}</code>
      <em class="${configured ? "is-ready" : "is-off"}"><i data-lucide="${configured ? "check" : "minus"}" aria-hidden="true"></i>${configured ? "Key 已配置" : "Key 未配置"}</em>
      <i class="runtime-model-chevron" data-lucide="chevron-down" aria-hidden="true"></i>
    </summary>
    <fieldset class="runtime-model-fields">
      <legend class="sr-only">${escapeHTML(definition.label)}连接参数</legend>
      ${textSettingField({ label: "接口地址", name: `models.${definition.id}.endpoint`, value: model.endpoint, type: "url", placeholder: "https://…", wide: true })}
      ${textSettingField({ label: "模型 ID", name: `models.${definition.id}.model`, value: model.model, placeholder: "输入模型或接入点 ID" })}
      ${timeoutSettingField(`models.${definition.id}.timeout_ms`, model.timeout_ms)}
      ${(definition.extraFields || []).map((field) => textSettingField({
        label: field === "bot_id" ? "Bot ID" : "Service Name",
        name: `models.${definition.id}.${field}`,
        value: model[field],
        placeholder: field === "bot_id" ? "输入 Bot ID" : "输入服务名称",
      })).join("")}
      ${secretSettingField({ name: `models.${definition.id}.api_key`, configured, label: "API Key" })}
    </fieldset>
  </details>`;
}

function textSettingField({ label, name, value = "", type = "text", placeholder = "", required = false, wide = false }) {
  return `<label class="runtime-setting-field ${wide ? "is-wide" : ""}"><span>${escapeHTML(label)}</span><input type="${escapeHTML(type)}" name="${escapeHTML(name)}" value="${escapeHTML(value)}" placeholder="${escapeHTML(placeholder)}" ${required ? "required" : ""} spellcheck="false" autocomplete="off"></label>`;
}

function secretSettingField({ name, configured, label, required = false }) {
  const token = name.replace(/[^a-z0-9]+/giu, "-");
  const inputId = `runtime-secret-${token}`;
  const hintId = `${inputId}-hint`;
  const clearName = name.replace(/\.api_key$/u, ".clear_api_key");
  return `<div class="runtime-setting-field runtime-secret-field" data-secret-configured="${configured ? "true" : "false"}">
    <label class="runtime-setting-label" for="${escapeHTML(inputId)}">${escapeHTML(label)} <em class="${configured ? "is-ready" : "is-off"}">${configured ? "已配置" : "未配置"}</em></label>
    <input id="${escapeHTML(inputId)}" type="password" name="${escapeHTML(name)}" value="" placeholder="${configured ? "输入新 Key 可替换，留空则保留" : "输入 Key"}" ${required ? "required" : ""} autocomplete="new-password" spellcheck="false" aria-describedby="${escapeHTML(hintId)}" data-secret-input>
    <small id="${escapeHTML(hintId)}" data-secret-hint>${configured ? "已保存的 Key 不会在此页显示。" : "Key 只保存在服务端。"}</small>
    ${configured ? `<label class="runtime-secret-clear"><input type="checkbox" name="${escapeHTML(clearName)}" data-clear-api-key><span>清除已保存 Key</span></label>` : ""}
  </div>`;
}

function syncSecretClearControl(control) {
  const field = control?.closest(".runtime-secret-field");
  const secretInput = field?.querySelector("[data-secret-input]");
  const hint = field?.querySelector("[data-secret-hint]");
  if (!field || !secretInput) return;
  const clearing = control.checked === true;
  if (clearing) secretInput.value = "";
  secretInput.disabled = clearing;
  field.dataset.clearRequested = String(clearing);
  if (hint) hint.textContent = clearing
    ? "保存后将删除服务端中已存的 Key。"
    : "已保存的 Key 不会在此页显示。";
}

function timeoutSettingField(name, timeoutMs) {
  return `<label class="runtime-setting-field runtime-timeout-field"><span>超时时间</span><span class="runtime-input-suffix"><input type="number" name="${escapeHTML(name)}" value="${Math.max(1, Math.round(positiveInteger(timeoutMs, 60_000) / 1000))}" min="1" max="1800" step="1" required><b>秒</b></span></label>`;
}

function syncAgentProxyFields(form) {
  if (!form) return;
  const toggle = form.elements.namedItem("agent_proxy.enabled");
  const fields = form.querySelector("[data-agent-proxy-fields]");
  const section = form.querySelector(".agent-proxy-settings");
  const switchLabel = form.querySelector(".settings-switch-control b");
  const note = form.querySelector("#agentProxyModeNote");
  const enabled = toggle?.checked === true;
  if (fields) fields.hidden = !enabled;
  if (section) section.dataset.proxyEnabled = String(enabled);
  if (switchLabel) switchLabel.textContent = enabled ? "已开启" : "已关闭";
  const endpoint = form.elements.namedItem("agent_proxy.endpoint");
  const apiKey = form.elements.namedItem("agent_proxy.api_key");
  const clearApiKey = form.elements.namedItem("agent_proxy.clear_api_key");
  if (endpoint) endpoint.required = enabled;
  if (clearApiKey) {
    clearApiKey.disabled = enabled;
    clearApiKey.title = enabled ? "请先关闭 Agent 代理，再清除 Key" : "";
    if (enabled && clearApiKey.checked) {
      clearApiKey.checked = false;
      syncSecretClearControl(clearApiKey);
    }
  }
  if (apiKey) apiKey.required = enabled && apiKey.closest(".runtime-secret-field")?.dataset.secretConfigured !== "true";
  if (note) {
    note.classList.toggle("is-active", enabled);
    const text = note.querySelector("span");
    if (text) text.textContent = enabled
      ? "保存后，除实时语音外的教师对话将切换为 Agent 代理模式。"
      : "当前由本系统直接调用模型、检索和教学工具。";
  }
}

async function saveRuntimeSettings(root, state, form) {
  const status = form.querySelector(".runtime-save-status");
  const submit = form.querySelector('[type="submit"]');
  const reset = form.querySelector("[data-runtime-reset]");
  if (!state.runtime) return;
  if (form.dataset.saving === "true") return;
  if (!form.reportValidity()) return;
  const draft = readRuntimeSettingsDraft(form);
  const patch = buildRuntimeSettingsPatch(state.runtime, draft);
  if (!patch.models && !patch.agent_proxy) {
    status.className = "runtime-save-status is-saved";
    status.textContent = "没有需要保存的修改";
    return;
  }
  form.dataset.saving = "true";
  form.setAttribute("aria-busy", "true");
  submit.disabled = true;
  if (reset) reset.disabled = true;
  status.className = "runtime-save-status is-saving";
  status.textContent = "正在保存…";
  try {
    const response = await fetch(RUNTIME_SETTINGS_URL, {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409) {
      const latestRuntime = await loadRuntimeSettings();
      state.runtime = latestRuntime;
      renderRuntimeSettings(root, latestRuntime, {
        status: "配置已被其他页面更新，已载入最新版本，请重新修改",
        statusTone: "warning",
      });
      return;
    }
    if (!response.ok || payload?.schema_version !== RUNTIME_SETTINGS_SCHEMA) {
      throw new Error(payload?.message || "模型设置保存失败");
    }
    state.runtime = normalizeRuntimeSettings(payload);
    renderRuntimeSettings(root, state.runtime, { status: "设置已保存" });
  } catch (error) {
    form.dataset.saving = "false";
    form.removeAttribute("aria-busy");
    status.className = "runtime-save-status is-error";
    status.textContent = error?.message || "模型设置保存失败";
    submit.disabled = false;
    if (reset) reset.disabled = false;
  }
}

function readRuntimeSettingsDraft(form) {
  const value = (name) => String(form.elements.namedItem(name)?.value || "").trim();
  const models = {};
  for (const definition of MODEL_DEFINITIONS) {
    models[definition.id] = {
      endpoint: value(`models.${definition.id}.endpoint`),
      model: value(`models.${definition.id}.model`),
      timeout_ms: positiveInteger(value(`models.${definition.id}.timeout_ms`), 60) * 1000,
      api_key: value(`models.${definition.id}.api_key`),
      clear_api_key: form.elements.namedItem(`models.${definition.id}.clear_api_key`)?.checked === true,
    };
    for (const field of definition.extraFields || []) models[definition.id][field] = value(`models.${definition.id}.${field}`);
  }
  return {
    models,
    agent_proxy: {
      enabled: form.elements.namedItem("agent_proxy.enabled")?.checked === true,
      endpoint: value("agent_proxy.endpoint"),
      api_key: value("agent_proxy.api_key"),
      clear_api_key: form.elements.namedItem("agent_proxy.clear_api_key")?.checked === true,
    },
  };
}

export function buildRuntimeSettingsPatch(current, draft) {
  const patch = { expected_version: positiveInteger(current?.config_version, 1) };
  const modelPatch = {};
  for (const definition of MODEL_DEFINITIONS) {
    const before = current?.models?.[definition.id] || {};
    const after = draft?.models?.[definition.id] || {};
    const next = {};
    for (const field of ["endpoint", "model", "timeout_ms", ...(definition.extraFields || [])]) {
      const previousValue = field === "timeout_ms" ? positiveInteger(before[field], 60_000) : String(before[field] || "");
      const nextValue = field === "timeout_ms" ? positiveInteger(after[field], 60_000) : String(after[field] || "");
      if (previousValue !== nextValue) next[field] = nextValue;
    }
    if (after.clear_api_key === true) next.clear_api_key = true;
    else if (String(after.api_key || "").trim()) next.api_key = String(after.api_key).trim();
    if (Object.keys(next).length) modelPatch[definition.id] = next;
  }
  if (Object.keys(modelPatch).length) patch.models = modelPatch;

  const beforeProxy = current?.agent_proxy || {};
  const afterProxy = draft?.agent_proxy || {};
  const proxyPatch = {};
  for (const field of ["enabled", "endpoint"]) {
    const previousValue = field === "enabled"
      ? beforeProxy.enabled === true
      : String(beforeProxy.endpoint || "");
    const nextValue = field === "enabled"
      ? afterProxy.enabled === true
      : String(afterProxy.endpoint || "");
    if (previousValue !== nextValue) proxyPatch[field] = nextValue;
  }
  if (afterProxy.clear_api_key === true) proxyPatch.clear_api_key = true;
  else if (String(afterProxy.api_key || "").trim()) proxyPatch.api_key = String(afterProxy.api_key).trim();
  if (Object.keys(proxyPatch).length) patch.agent_proxy = proxyPatch;
  return patch;
}

function formatSettingsTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function renderCards(root, cards = {}) {
  const panel = root.querySelector('[data-settings-panel="cards"]');
  if (!panel) return;
  panel.innerHTML = `
    <header class="settings-section-head"><div><span>知识卡片</span><h3>知识卡片底座</h3><p>AI教师只选择受信引用，系统负责补全协议、校验数据并选择渲染方式。</p></div></header>
    <div class="settings-protocol-row">
      ${protocolCard("消息协议", cards.envelope_protocol)}
      ${protocolCard("教学卡片", cards.card_protocol)}
      ${protocolCard("互动图解", cards.interactive_protocol)}
    </div>
    <section class="settings-library-list"><header><h4>当前渲染技术</h4><span>${number(cards.libraries?.length)} 组</span></header>${(cards.libraries || []).map((library) => `<article><b>${escapeHTML(library.name)}</b><p>${escapeHTML(library.role)}</p><code>${escapeHTML(library.id)}</code><em class="${library.status === "source_missing" ? "is-off" : "is-ready"}">${escapeHTML(libraryStatus(library.status))}</em></article>`).join("")}</section>
    <div class="settings-contract-grid">
      ${renderTagContract("卡片类型", cards.card_types)}
      ${renderTagContract("互动图类型", cards.visual_variants)}
    </div>
    <section class="settings-gate-list"><header><h4>安全边界</h4><span>服务端控制</span></header>${(cards.safety || []).map((item) => `<p><i data-lucide="lock-keyhole" aria-hidden="true"></i>${escapeHTML(item)}</p>`).join("")}</section>`;
}

function renderTagContract(title, values = [], labels = {}) {
  return `<details class="settings-contract" open><summary><span>${escapeHTML(title)}</span><b>${number(values?.length)}</b></summary><div>${(values || []).map((value) => `<span title="${escapeHTML(value)}">${escapeHTML(labels[value] || value)}</span>`).join("")}</div></details>`;
}

function renderStorage(title, storage = {}, detail = "") {
  return `<article><span><i data-lucide="database" aria-hidden="true"></i></span><div><b>${escapeHTML(title)}</b><small>${escapeHTML(storage.provider || "未配置")} · ${escapeHTML(detail)}</small><code>${escapeHTML(storage.collection || storage.database || "-")}</code></div><em class="${storage.configured ? "is-ready" : "is-off"}">${storage.configured ? "已配置" : "未配置"}</em></article>`;
}

function protocolCard(label, value) {
  return `<article><span>${escapeHTML(label)}</span><b>${escapeHTML(value || "未配置")}</b></article>`;
}

function authorityLabel(value) {
  return ({ system: "系统控制", model_proposal: "模型提议", reviewer: "人工审核" })[value] || value || "系统控制";
}

function libraryStatus(value) {
  return ({ active: "已启用", adapter_ready: "适配就绪", source_missing: "缺少源码" })[value] || "未标注";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "0";
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
