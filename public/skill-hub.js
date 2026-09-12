// One navigation destination for runtime teaching skills and rendering tools.
// Reparent the existing workspaces so their listeners and data remain intact.
export function mountSkillHub() {
  const root = document.querySelector('#skillHubWorkspace');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = 'true';
  root.innerHTML = `<section class="skill-hub-shell">
    <header class="skill-hub-head"><div><h1>Skill hub</h1><p>查看 AI 教师可调用的技能，以及制作课件可用的技术。</p></div><button type="button" class="btn" data-hub-create><i data-lucide="wand-sparkles"></i>打开课件助手</button></header>
    <nav class="skill-hub-tabs" role="tablist" aria-label="能力目录">
      <button id="skillHubSkillsTab" type="button" role="tab" aria-selected="true" aria-controls="skillHubSkillsPanel" data-hub-tab="skills"><i data-lucide="blocks"></i>教学技能<span>能力与权限</span></button>
      <button id="skillHubTechnologyTab" type="button" role="tab" aria-selected="false" aria-controls="skillHubTechnologyPanel" tabindex="-1" data-hub-tab="technology"><i data-lucide="cpu"></i>技术栈<span>引擎与适用场景</span></button>
    </nav>
    <section id="skillHubSkillsPanel" class="skill-hub-panel" role="tabpanel" aria-labelledby="skillHubSkillsTab"></section>
    <section id="skillHubTechnologyPanel" class="skill-hub-panel" role="tabpanel" aria-labelledby="skillHubTechnologyTab" hidden></section>
  </section>`;
  for (const [id, target] of [['educationSkillsWorkspace','skillHubSkillsPanel'],['technologyLandscapeWorkspace','skillHubTechnologyPanel']]) {
    const node = document.getElementById(id);
    if (!node) continue;
    node.removeAttribute('data-workspace-panel');
    node.classList.remove('workspace-panel');
    node.classList.add('skill-hub-source');
    node.setAttribute('role', 'region');
    node.setAttribute('aria-label', id === 'educationSkillsWorkspace' ? '教学技能目录' : '技术能力目录');
    node.hidden = false;
    root.querySelector(`#${target}`).append(node);
  }
  const select = (name, focus = false) => {
    const selected = name === 'technology' ? 'technology' : 'skills';
    root.querySelectorAll('[data-hub-tab]').forEach(button => {
      const active = button.dataset.hubTab === selected;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      root.querySelector(`#${button.getAttribute('aria-controls')}`).hidden = !active;
      if (active && focus) button.focus();
    });
  };
  root.addEventListener('click', event => {
    const tab = event.target.closest('[data-hub-tab]');
    if (tab) select(tab.dataset.hubTab);
    if (event.target.closest('[data-hub-create]')) document.dispatchEvent(new CustomEvent('workspace:navigate',{detail:{view:'courseware-assistant'}}));
  });
  root.querySelector('[role="tablist"]').addEventListener('keydown', event => {
    if (!event.target.closest('[data-hub-tab]') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    select(event.key === 'Home' ? 'skills' : event.key === 'End' ? 'technology' : event.target.dataset.hubTab === 'skills' ? 'technology' : 'skills', true);
  });
  document.addEventListener('skill-hub:select-tab', event => select(event.detail?.tab));
  const search = document.getElementById('technologySearch');
  search?.setAttribute('aria-label', '搜索技术或适用场景');
}
