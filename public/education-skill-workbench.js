const ICONS = Object.freeze({
  knowledge_tutor: "book-open-check",
  photo_solver: "scan-line",
  question_generator: "list-plus",
});

const PERMISSION_LABELS = Object.freeze({
  loaded_course_knowledge: "已加载教材",
  trusted_card_registry: "可信知识卡片",
  uploaded_question_image: "本轮题目图片",
  reviewed_public_questions: "已审核公开题目",
  teaching_answer: "教学回答",
  low_authority_mastery_evidence: "掌握线索建议",
  grounded_solution: "有依据的解题方案",
  solution_steps: "解题步骤",
  assessment_draft: "题目草稿",
  private_answer_key: "服务端私有答案",
  open_web: "开放网络",
  unloaded_course_knowledge: "未加载课程知识",
  mastery_write: "直接修改掌握度",
  arbitrary_code: "任意代码",
  question_bank_publish: "直接发布题库",
  private_answer_disclosure: "公开私有答案",
});

export function initEducationSkillWorkbench(root, { fetchImpl = globalThis.fetch } = {}) {
  if (!root || root.dataset.skillWorkbenchReady === "true") return null;
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is required");
  root.dataset.skillWorkbenchReady = "true";

  const state = { skills: [], selectedId: "", status: "loading", error: "" };
  root.addEventListener("click", (event) => {
    const select = event.target.closest("[data-education-skill-id]");
    if (select) {
      const list = root.querySelector(".education-skills-list");
      const scroll = { left: list?.scrollLeft || 0, top: list?.scrollTop || 0 };
      const restoreFocus = select.contains(document.activeElement);
      state.selectedId = select.dataset.educationSkillId || "";
      render(root, state);
      globalThis.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
      const updatedList = root.querySelector(".education-skills-list");
      if (updatedList) {
        updatedList.scrollLeft = scroll.left;
        updatedList.scrollTop = scroll.top;
        if (restoreFocus) updatedList.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      }
      return;
    }
    if (event.target.closest("[data-education-skills-retry]")) void load(root, state, fetchImpl);
  });
  void load(root, state, fetchImpl);
  return Object.freeze({ refresh: () => load(root, state, fetchImpl) });
}

async function load(root, state, fetchImpl) {
  state.status = "loading";
  state.error = "";
  render(root, state);
  try {
    const response = await fetchImpl("/api/education/agent/skills", {
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || "Skill 清单暂时不可用");
    if (!Array.isArray(payload?.skills)) throw new Error("Skill 清单协议不兼容");
    state.skills = payload.skills.filter((skill) => skill?.id && skill?.status === "active");
    state.selectedId = state.skills.some((skill) => skill.id === state.selectedId)
      ? state.selectedId
      : state.skills[0]?.id || "";
    state.status = "ready";
  } catch (error) {
    state.status = "error";
    state.error = error?.message || "Skill 清单暂时不可用";
  }
  render(root, state);
  globalThis.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function render(root, state) {
  if (state.status === "loading") {
    root.innerHTML = `<div class="education-skills-state" role="status"><i data-lucide="loader-circle"></i><span><b>正在读取 Agent Skills</b><small>核对模型实际可用的能力与工具</small></span></div>`;
    return;
  }
  if (state.status === "error") {
    root.innerHTML = `<div class="education-skills-state is-error" role="alert"><i data-lucide="circle-alert"></i><span><b>${escapeHTML(state.error)}</b><small>没有读取到清单时，页面不会假装 Skill 已启用。</small></span><button type="button" data-education-skills-retry>重新读取</button></div>`;
    return;
  }
  const selected = state.skills.find((skill) => skill.id === state.selectedId) || state.skills[0];
  if (!selected) {
    root.innerHTML = `<div class="education-skills-state"><i data-lucide="package-open"></i><span><b>尚未发布 Skill</b><small>发布后才会出现在 Pi Agent 的受控工具环境中。</small></span></div>`;
    return;
  }
  root.innerHTML = `
    <div class="education-skills-summary">
      <span><i data-lucide="cpu"></i><b>Pi Agent</b><small>运行时</small></span>
      <span><i data-lucide="badge-check"></i><b>${state.skills.length} 项</b><small>已发布</small></span>
      <span><i data-lucide="shield-check"></i><b>服务端</b><small>控制权限</small></span>
    </div>
    <div class="education-skills-layout">
      <nav class="education-skills-list" aria-label="Agent Skill 列表">
        ${state.skills.map((skill) => skillListButton(skill, skill.id === selected.id)).join("")}
      </nav>
      <article class="education-skill-detail" aria-labelledby="activeEducationSkillTitle">
        <header>
          <span class="education-skill-detail-icon"><i data-lucide="${escapeHTML(ICONS[selected.id] || "sparkles")}"></i></span>
          <span><small>模型可用 Skill</small><h2 id="activeEducationSkillTitle">${escapeHTML(selected.name)}</h2><p>${escapeHTML(selected.purpose)}</p></span>
          <em><i data-lucide="circle-check"></i>已启用</em>
        </header>
        <div class="education-skill-facts">
          <section><h3>何时使用</h3><div class="education-skill-tags">${listTags(selected.triggers)}</div></section>
          <section><h3>输入</h3><dl><div><dt>必需</dt><dd>${fieldList(selected.input?.required)}</dd></div><div><dt>可选</dt><dd>${fieldList(selected.input?.optional)}</dd></div><div><dt>图片</dt><dd>${selected.input?.accepts_image ? "支持" : "不使用"}</dd></div></dl></section>
        </div>
        <section class="education-skill-tools"><h3>模型可调用工具</h3><div>${(selected.required_tools || []).map(toolRow).join("")}</div></section>
        <section class="education-skill-permissions"><h3>权限边界</h3><div class="education-skill-permission-grid"><span><b>可读取</b>${permissionList(selected.permissions?.read)}</span><span><b>可提交</b>${permissionList(selected.permissions?.propose)}</span><span class="is-denied"><b>不可执行</b>${permissionList(selected.permissions?.denied)}</span></div></section>
        <footer><i data-lucide="lock-keyhole"></i><span>浏览器只能查看公开清单；Skill 指令、课程权限和工具对象仅在服务端注入本轮 Agent。</span></footer>
      </article>
    </div>`;
}

function skillListButton(skill, selected) {
  return `<button type="button" class="education-skill-list-item${selected ? " is-active" : ""}" data-education-skill-id="${escapeHTML(skill.id)}" aria-pressed="${selected}"><span><i data-lucide="${escapeHTML(ICONS[skill.id] || "sparkles")}"></i></span><span><b>${escapeHTML(skill.name)}</b><small>${escapeHTML(skill.purpose)}</small></span><em>${escapeHTML(skill.version || "")}</em></button>`;
}

function toolRow(tool) {
  return `<div class="education-skill-tool"><span><i data-lucide="wrench"></i><b>${escapeHTML(tool?.label || tool?.name || "工具")}</b></span><p>${escapeHTML(tool?.purpose || "")}</p><em>${escapeHTML(authorityLabel(tool?.authority))}</em></div>`;
}

function authorityLabel(value) {
  return ({
    server_scoped_read: "受控读取",
    reviewed_public_question_read: "已审核读取",
    validated_proposal_write: "提交提案",
  })[value] || "服务端控制";
}

function listTags(values) {
  return (Array.isArray(values) ? values : []).map((value) => `<span>${escapeHTML(value)}</span>`).join("") || "<span>由服务端调度</span>";
}

function permissionList(values) {
  return (Array.isArray(values) ? values : []).map((value) => `<small>${escapeHTML(PERMISSION_LABELS[value] || value)}</small>`).join("") || "<small>无</small>";
}

function fieldList(values) {
  return (Array.isArray(values) && values.length) ? values.map(fieldLabel).join("、") : "无";
}

function fieldLabel(value) {
  return ({ message: "问题文字", image: "题目图片", knowledge_point_id: "知识点", question_preferences: "出题要求" })[value] || value;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
