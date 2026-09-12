import { getCoursewareMetadata, RESOURCE_FORMS, EDUCATION_LEVELS, PRESENTATION_MODES, INTERACTION_MODES, SUBJECTS, TOPICS, getTopicLabel } from './courseware-taxonomy.js';
import { BUILTIN_COURSEWARE, COURSEWARE_TYPES, saveCourseware, listCourseware, deleteCourseware, filterCourseware } from './courseware-store.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const text = (x, y, label, size = 13, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escapeHtml(label)}</text>`;
const line = (x1, y1, x2, y2, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}/>`;
const colors = { '数学': ['#eaf0fc', '#4266a1', '#d0ddf5'], '物理': ['#edf4ed', '#426d58', '#d4e3d5'], '化学': ['#f6edf1', '#995979', '#e9d2de'] };

/** Knowledge figures use actual presets and coefficients, never arbitrary HTML. */
export function coursewareCoverSvg(item) {
  const [background, ink, subtle] = colors[item.subject] || ['#f1eff8', '#726293', '#dfd8ee'];
  const visual = item.lesson?.visualization || {};
  const p = visual.parameters || {};
  const preset = visual.preset;
  let diagram = '';
  if (item.type === 'geometry' && item.visualArtifact?.model?.kind === 'right_triangle') {
    const model = item.visualArtifact.model;
    const a = Number(model.a) || 3; const b = Number(model.b) || 4;
    const scale = Math.min(160 / b, 122 / a);
    const left = 90; const bottom = 173; const top = bottom - a * scale; const right = left + b * scale;
    diagram = `<path d="M${left} ${bottom} V${top} L${right} ${bottom} Z" fill="${subtle}" stroke="${ink}" stroke-width="2.5"/>
      <path d="M${left} ${bottom - 14} H${left + 14} V${bottom}" fill="none" stroke="${ink}" stroke-width="1.5"/>
      ${text(82, (bottom + top) / 2, `a = ${a}`, 13, 'text-anchor="end"')}${text((left + right) / 2, 195, `b = ${b}`, 13, 'text-anchor="middle"')}
      ${text((left + right) / 2 + 8, (top + bottom) / 2 - 9, `c ≈ ${Math.hypot(a, b).toFixed(2)}`, 13)}${text(38, 26, 'a² + b² = c²', 15)}`;
  } else if (item.type === 'geometry' && item.visualArtifact?.model?.kind === 'circle_elements') {
    const model = item.visualArtifact.model;
    const radius = Math.max(1, Math.min(12, Number(model.radius) || 3));
    const angle = Math.max(15, Math.min(360, Number(model.angle) || 90));
    const r = 48 + (radius - 1) / 11 * 26; const x = 156; const y = 116;
    const endX = x + r * Math.cos(-angle * Math.PI / 180); const endY = y + r * Math.sin(-angle * Math.PI / 180);
    const sector = angle === 360 ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${subtle}"/>`
      : `<path d="M${x} ${y} L${x + r} ${y} A${r} ${r} 0 ${angle > 180 ? 1 : 0} 0 ${endX} ${endY} Z" fill="${subtle}" stroke="${ink}" stroke-width="1.5"/>`;
    diagram = `${sector}<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${ink}" stroke-width="2.5"/>
      ${line(x, y, x + r, y, `stroke="${ink}" stroke-width="2"`)}<circle cx="${x}" cy="${y}" r="3" fill="${ink}"/>
      ${text(x + 8, y + 20, `r = ${radius}`, 13)}${text(35, 28, `圆心角 ${angle}°`, 14)}${text(97, 206, `扇形占比 ${(angle / 360 * 100).toFixed(1)}%`, 12)}`;
  } else if (item.type === 'function_graph') {
    let path = '';
    let active = false;
    for (let i = 0; i <= 240; i += 2) {
      const x = (i - 120) / 25;
      const y = preset === 'linear' ? (Number(p.a) || 0) * x + (Number(p.b) || 0)
        : preset === 'sine' ? (Number(p.amplitude) || 1) * Math.sin((Number(p.frequency) || 1) * x + (Number(p.phase) || 0))
          : (Number(p.a) || 0) * x * x + (Number(p.b) || 0) * x + (Number(p.c) || 0);
      const py = 125 - y * 18;
      if (!Number.isFinite(py) || py < 30 || py > 184) { active = false; continue; }
      path += `${active ? 'L' : 'M'}${i + 40},${py.toFixed(2)} `; active = true;
    }
    const formula = preset === 'linear' ? `y = ${p.a ?? 1}x + ${p.b ?? 0}` : preset === 'sine' ? 'y = A sin(ωx + φ)' : 'y = ax² + bx + c';
    diagram = `<g stroke="${subtle}" stroke-width="1">${[60, 85, 110, 135, 160, 185, 210, 235, 260].map(x => line(x, 36, x, 184)).join('')}${[45, 70, 95, 120, 145, 170].map(y => line(40, y, 280, y)).join('')}</g>
      <g stroke="${ink}" stroke-opacity=".45">${line(40, 125, 283, 125)}${line(160, 33, 160, 184)}</g>
      <path d="${path}" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>
      ${text(42, 24, formula, 14)}${text(284, 129, 'x', 11)}${text(165, 38, 'y', 11)}`;
  } else if (preset === 'inclined_plane') {
    diagram = `<path d="M45 169 L270 169 L270 54 Z" fill="${subtle}" stroke="${ink}" stroke-width="2"/>
      <g transform="translate(173 88) rotate(-27)"><rect x="-21" y="-16" width="42" height="32" rx="5" fill="${ink}"/></g>
      <g stroke="${ink}" stroke-width="2.5">${line(173, 88, 173, 150)}${line(173, 88, 122, 112)}${line(173, 150, 168, 142)}${line(173, 150, 178, 142)}</g>
      <path d="M78 169 A35 35 0 0 0 74 154" fill="none" stroke="${ink}"/>
      ${text(91, 159, `${p.angle ?? 30}°`, 13)}${text(182, 142, 'mg', 14)}${text(83, 102, '摩擦', 12)}${text(43, 32, `μ = ${p.friction ?? 0.1}`, 14)}`;
  } else if (preset === 'pendulum') {
    diagram = `<path d="M65 127 A110 110 0 0 0 255 127" fill="none" stroke="${ink}" stroke-dasharray="4 6" stroke-opacity=".35"/>
      <g stroke="${ink}" stroke-width="2">${line(120, 37, 200, 37)}${line(160, 37, 160, 171, 'stroke-dasharray="4 4" stroke-opacity=".3"')}${line(160, 37, 222, 147)}</g>
      <circle cx="160" cy="37" r="4" fill="${ink}"/><circle cx="222" cy="147" r="14" fill="${ink}"/>
      <path d="M160 68 A31 31 0 0 1 176 64" fill="none" stroke="${ink}"/>
      ${text(181, 88, `L = ${p.length ?? 1.5} m`, 13)}${text(54, 195, 'T ≈ 2π√(L/g) · 小角度近似', 13)}`;
  } else if (preset === 'collision') {
    diagram = `<path d="M34 159 H286" fill="none" stroke="${ink}" stroke-width="2"/>
      <rect x="58" y="115" width="76" height="31" rx="6" fill="${ink}"/><rect x="196" y="115" width="66" height="31" rx="6" fill="${subtle}" stroke="${ink}"/>
      <g fill="${ink}">${[73, 119, 208, 250].map(x => `<circle cx="${x}" cy="151" r="7"/>`).join('')}</g>
      <path d="M77 95 H150 L142 89 M150 95 L142 101" fill="none" stroke="${ink}" stroke-width="2"/>
      ${text(66, 76, `v = ${p.initial_speed ?? 3} m/s`, 13)}${text(68, 136, 'm₁', 15, 'fill="white"')}${text(219, 136, 'm₂', 15)}${text(63, 194, 'p前 ≈ p后 · 水平无外力', 13)}`;
  } else if (item.type === 'projectile_lab') {
    diagram = `<path d="M40 167 H286 M40 167 V40" fill="none" stroke="${ink}" stroke-opacity=".4"/>
      <path d="M40 167 Q155 -40 270 167" fill="none" stroke="${ink}" stroke-width="3" stroke-dasharray="5 5"/>
      <circle cx="126" cy="70" r="10" fill="${ink}"/><path d="M126 86 V127 L121 120 M126 127 L131 120" fill="none" stroke="${ink}" stroke-width="2"/>
      ${text(139, 115, 'g', 16)}${text(53, 195, `v₀ = ${p.initial_speed ?? 20} m/s`, 13)}${text(207, 195, `θ = ${p.angle ?? 45}°`, 13)}`;
  } else if (item.type === 'acid_base_lab') {
    diagram = `<rect x="66" y="28" width="18" height="100" rx="3" fill="white" stroke="${ink}" stroke-width="2"/><rect x="70" y="56" width="10" height="67" fill="${subtle}"/>
      <path d="M75 128 V151 M64 138 H86 M43 163 H107 L98 191 H52 Z" fill="${subtle}" stroke="${ink}" stroke-width="2"/>
      <path d="M75 152 Q68 162 75 164 Q82 162 75 152" fill="${ink}"/>
      <path d="M154 167 V50 M154 167 H280" fill="none" stroke="${ink}" stroke-opacity=".4"/>
      <path d="M157 153 C204 153 210 143 213 110 S216 72 276 65" fill="none" stroke="${ink}" stroke-width="3"/>
      ${text(165, 40, 'pH', 13)}${text(180, 192, '等当点附近', 12)}${text(197, 116, '7', 10)}`;
  } else if (item.type === 'mindmap') {
    const labels = (visual.nodes || []).filter(node => node.parent_id).slice(0, 3).map(node => node.label);
    diagram = `<g fill="none" stroke="${ink}" stroke-opacity=".5" stroke-width="2"><path d="M120 105 H155 V50 H176 M155 105 H176 M155 105 V160 H176"/></g>
      <rect x="26" y="82" width="94" height="46" rx="10" fill="${ink}"/>
      ${text(73, 110, (visual.nodes || [])[0]?.label || '知识结构', 13, 'text-anchor="middle" fill="white"')}
      ${[50, 105, 160].map((y, i) => `<rect x="176" y="${y - 19}" width="118" height="38" rx="8" fill="white" stroke="${subtle}"/>${text(235, y + 5, labels[i] || '概念联系', 12, 'text-anchor="middle"')}`).join('')}`;
  } else {
    const title = visual.cards?.[0]?.front || item.lesson?.knowledge_point || item.title;
    diagram = `<rect x="78" y="38" width="171" height="134" rx="12" fill="${subtle}" transform="rotate(8 164 105)"/>
      <rect x="67" y="36" width="171" height="134" rx="12" fill="white" stroke="${ink}" stroke-opacity=".3"/>
      ${text(86, 67, item.type === 'video' ? '教学视频' : '知识与理解', 12)}
      ${text(86, 105, String(title).slice(0, 10), 16)}${text(86, 129, String(title).slice(10, 20), 14)}
      <path d="M86 148 H145" stroke="${ink}" stroke-opacity=".3" stroke-width="3"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" aria-hidden="true" focusable="false"><rect width="320" height="220" fill="${background}"/><g fill="${ink}" font-family="system-ui, PingFang SC, sans-serif">${diagram}</g></svg>`;
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
}
function button(label, className = 'btn') { const node = element('button', className, label); node.type = 'button'; return node; }

/** Capture live content without restoring the player's old builtin id after a
 * successful save. Both save and assistant reuse pass through this boundary. */
export function captureCoursewarePreview(item, { lessonPlayer, geometryPlayer, forReuse = false } = {}) {
  const captured = structuredClone(item);
  if (geometryPlayer) captured.visualArtifact = structuredClone(geometryPlayer.getCourseware().visualArtifact);
  else if (lessonPlayer) {
    captured.lesson = structuredClone(lessonPlayer.getExportLesson());
    if (forReuse) delete captured.html;
  }
  return captured;
}

export function mountCoursewareLibrary() {
  const root = document.querySelector('#coursewareLibraryWorkspace');
  if (!root || root.dataset.coursewareMounted) return;
  root.dataset.coursewareMounted = 'true';
  const state = { items: structuredClone(BUILTIN_COURSEWARE), filters: { tags: [] }, loadVersion: 0, previewVersion: 0, player: null, geometry: null, current: null, trigger: null, triggerItemId: '', restoreFocus: true };
  root.innerHTML = `<div class="cwl-shell">
    <header class="cwl-header"><div><h1>课件库</h1><p>按教学内容找资源，把合适的课件带进课堂。</p></div><button type="button" class="btn btn-primary" data-cwl-create>创建课件</button></header>
    <div class="cwl-resource-forms" role="group" aria-label="资源形态"><button type="button" data-resource-form="" aria-pressed="true">全部资源</button>${Object.entries(RESOURCE_FORMS).map(([value,label]) => `<button type="button" data-resource-form="${value}" aria-pressed="false">${label}</button>`).join('')}</div>
    <div class="cwl-browser">
      <details class="cwl-topic-browser" data-cwl-tree-disclosure open><summary>学科与主题 <span data-cwl-tree-summary>全部学科</span></summary><nav data-cwl-topic-tree aria-label="按学科和知识主题浏览"></nav></details>
      <section class="cwl-results" aria-label="课件查询与结果">
        <form class="cwl-filters" role="search" aria-label="筛选课件">
          <div class="cwl-search-row"><label class="cwl-search"><span>知识点关键词</span><input class="form-control" type="search" name="query" placeholder="搜索知识点、名称或标签，如：勾股定理" autocomplete="off"></label><label><span>适用学段</span><select class="form-select" name="educationLevel"><option value="">全部学段</option></select></label></div>
          <details class="cwl-advanced-filters" data-cwl-filter-disclosure>
            <summary>更多筛选 <span data-cwl-filter-count aria-live="polite" hidden></span></summary>
            <div class="cwl-filter-fields">
              <label><span>呈现方式</span><select class="form-select" name="presentationMode"><option value="">全部呈现</option></select></label>
              <label><span>交互方式</span><select class="form-select" name="interactionMode"><option value="">全部交互</option></select></label>
              <label><span>资源来源</span><select class="form-select" name="source"><option value="">全部来源</option><option value="builtin">内置示例</option><option value="saved">此设备保存</option></select></label>
              <label><span>制作技术</span><select class="form-select" name="technology"><option value="">不限技术</option></select></label>
            </div>
            <details class="cwl-tag-filter"><summary>知识标签 <span data-cwl-tag-count></span></summary><p class="cwl-filter-help">同组标签匹配任意一项，与其他筛选条件组合生效。</p><div class="cwl-tag-list" data-cwl-tags role="group" aria-label="知识标签，可多选"></div></details>
          </details>
        </form>
        <div class="cwl-active-filters" data-cwl-active-filters role="group" aria-label="已选筛选条件"></div>
        <div class="cwl-results-bar"><p data-cwl-count aria-live="polite"></p><button type="button" class="btn btn-ghost" data-cwl-clear hidden>清除筛选</button></div>
        <div class="cwl-message" data-cwl-status role="status" aria-live="polite"></div>
        <div class="cwl-grid" data-cwl-grid></div>
        <p class="cwl-storage-note">保存内容仅在当前浏览器中保留。</p>
      </section>
    </div>
  </div>`;
  const form = root.querySelector('form');
  const grid = root.querySelector('[data-cwl-grid]');
  const status = root.querySelector('[data-cwl-status]');
  const clear = root.querySelector('[data-cwl-clear]');
  const tree = root.querySelector('[data-cwl-topic-tree]');
  const filterDisclosure = root.querySelector('[data-cwl-filter-disclosure]');
  const treeDisclosure = root.querySelector('[data-cwl-tree-disclosure]');
  const narrowTree = window.matchMedia('(max-width: 1023px)');
  const syncTreeDisclosure = () => {
    const summary = treeDisclosure.querySelector('summary');
    const returnFocus = narrowTree.matches && treeDisclosure.contains(document.activeElement) && document.activeElement !== summary;
    treeDisclosure.open = !narrowTree.matches;
    if (returnFocus && !root.hidden && root.getClientRects().length) summary.focus({ preventScroll: true });
  };
  syncTreeDisclosure(); narrowTree.addEventListener('change', syncTreeDisclosure);
  const dialog = element('dialog', 'courseware-preview-dialog');
  dialog.setAttribute('aria-labelledby', 'coursewarePreviewTitle');
  dialog.innerHTML = `<div class="cwl-preview-shell"><header class="cwl-preview-header"><div><span data-cwl-preview-meta></span><h2 id="coursewarePreviewTitle"></h2></div><button type="button" class="btn btn-ghost btn-icon" data-cwl-close aria-label="关闭课件预览">×</button></header><div class="cwl-preview-scroll"><p class="cwl-preview-description" data-cwl-description></p><div data-cwl-preview-status role="status" aria-live="polite"></div><div class="cwl-preview-stage" data-cwl-preview-stage></div></div><footer class="cwl-preview-footer"><span data-cwl-save-note>保存到此设备后可继续复用</span><div><button type="button" class="btn btn-ghost" data-cwl-delete hidden>删除课件</button><button type="button" class="btn" data-cwl-save>保存到此设备</button><button type="button" class="btn btn-primary" data-cwl-reuse>在助手中复用</button></div></footer></div>`;
  document.body.append(dialog);
  const previewStage = dialog.querySelector('[data-cwl-preview-stage]');
  const previewStatus = dialog.querySelector('[data-cwl-preview-status]');
  const saveButton = dialog.querySelector('[data-cwl-save]');
  const deleteButton = dialog.querySelector('[data-cwl-delete]');
  const reuseButton = dialog.querySelector('[data-cwl-reuse]');

  function message(node, value = '', error = false) {
    node.textContent = value; node.classList.toggle('is-error', error); node.hidden = !value;
    node.setAttribute('role', error ? 'alert' : 'status');
  }
  function reuse(item) {
    closePreview(false);
    document.dispatchEvent(new CustomEvent('courseware:open-assistant', { detail: { item: item ? structuredClone(item) : null } }));
  }
  const controlKeys = ['query','educationLevel','presentationMode','interactionMode','source','technology'];
  const labelsFor = { resourceForm:RESOURCE_FORMS, educationLevel:EDUCATION_LEVELS, presentationMode:PRESENTATION_MODES, interactionMode:INTERACTION_MODES, source:{builtin:'内置示例',saved:'此设备保存'} };
  function filterLabel(key,value) {
    if(key==='topicId') return getTopicLabel(value);
    if(key==='query') return `关键词：${value}`;
    return labelsFor[key]?.[value] || value;
  }
  function renderOptions() {
    for (const [key, dictionary] of Object.entries({ educationLevel:EDUCATION_LEVELS, presentationMode:PRESENTATION_MODES, interactionMode:INTERACTION_MODES, technology:Object.fromEntries([...new Set(state.items.map(item=>item.technology).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh')).map(value=>[value,value])) })) {
      const select=form.elements.namedItem(key); const previous=state.filters[key]||'';
      while(select.options.length>1) select.remove(1);
      for(const [value,label] of Object.entries(dictionary)) { const option=element('option','',label);option.value=value;select.append(option); }
      select.value=previous;
    }
    const tags=[...new Set(state.items.flatMap(item=>item.tags||[]))].sort((a,b)=>a.localeCompare(b,'zh'));
    const tagRoot=root.querySelector('[data-cwl-tags]'); tagRoot.replaceChildren();
    for(const tag of tags){const tagButton=button(tag,'cwl-tag-button');tagButton.dataset.tag=tag;tagButton.setAttribute('aria-pressed',String(state.filters.tags.includes(tag)));tagRoot.append(tagButton);}
    const openSubjects=new Set([...tree.querySelectorAll('details[open]')].map(node=>node.dataset.subjectGroup));
    tree.replaceChildren();
    const all=button('全部学科','cwl-topic-button');all.dataset.subject='';tree.append(all);
    const subjects=[...new Set([...SUBJECTS,...state.items.flatMap(item=>getCoursewareMetadata(item).subjects)])];
    for(const subject of subjects){
      const group=element('details','cwl-subject-group');group.dataset.subjectGroup=subject;group.open=openSubjects.has(subject)||state.filters.subject===subject;
      const summary=element('summary','',subject);const count=element('span','');count.dataset.subjectCount=subject;summary.append(count);group.append(summary);
      const subjectButton=button(`全部${subject}`,'cwl-topic-button');subjectButton.dataset.subject=subject;group.append(subjectButton);
      for(const topic of TOPICS.filter(item=>item.subject===subject)) {const topicButton=button(topic.label,'cwl-topic-button');topicButton.dataset.subject=subject;topicButton.dataset.topic=topic.id;group.append(topicButton);}
      tree.append(group);
    }
  }
  function render() {
    const items=filterCourseware(state.items,state.filters);
    grid.replaceChildren();
    root.querySelector('[data-cwl-count]').textContent=`${items.length} 个资源${state.filters.source==='saved'?' · 此设备保存':''}`;
    root.querySelector('[data-cwl-tag-count]').textContent=state.filters.tags.length?`已选 ${state.filters.tags.length}`:'';
    const advancedCount=['presentationMode','interactionMode','source','technology'].filter(key=>Boolean(state.filters[key])).length+state.filters.tags.length;
    const countLabel=root.querySelector('[data-cwl-filter-count]');countLabel.textContent=advancedCount?`已选 ${advancedCount}`:'';countLabel.hidden=advancedCount===0;
    const active=root.querySelector('[data-cwl-active-filters]');active.replaceChildren();
    for(const [key,value] of Object.entries(state.filters)){
      for(const selected of Array.isArray(value)?value:value?[value]:[]) {const chip=button(`${filterLabel(key,selected)} ×`,'cwl-filter-chip');chip.dataset.filterKey=key;chip.dataset.filterValue=selected;chip.setAttribute('aria-label',`移除筛选：${filterLabel(key,selected)}`);active.append(chip);}
    }
    active.hidden=!active.children.length;clear.hidden=!active.children.length;
    root.querySelectorAll('[data-resource-form]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.resourceForm===(state.filters.resourceForm||''))));
    tree.querySelectorAll('[data-subject]').forEach(node=>node.setAttribute('aria-pressed',String((node.dataset.subject||'')===(state.filters.subject||'')&&(node.dataset.topic||'')===(state.filters.topicId||''))));
    const otherFilters={...state.filters,subject:'',topicId:''};
    tree.querySelectorAll('[data-subject-count]').forEach(node=>{node.textContent=filterCourseware(state.items,{...otherFilters,subject:node.dataset.subjectCount}).length;});
    root.querySelector('[data-cwl-tree-summary]').textContent=[state.filters.subject,state.filters.topicId&&getTopicLabel(state.filters.topicId)].filter(Boolean).join(' / ')||'全部学科';
    for(const item of items){
      const meta=getCoursewareMetadata(item);
      const card=element('article','cwl-card');
      const cover=button('','cwl-cover');cover.setAttribute('aria-label',`预览 ${item.title}`);cover.innerHTML=coursewareCoverSvg(item);
      const body=element('div','cwl-card-body');
      const heading=element('h2','',item.title);
      const details=element('div','cwl-card-meta');details.append(element('span','',meta.subjects.join(' / ')||'学科未标注'),element('span','',RESOURCE_FORMS[meta.resourceForm]));
      const levels=meta.educationLevels.map(value=>EDUCATION_LEVELS[value]).filter(Boolean).join(' / ')||'学段未标注';
      const formats=meta.presentationModes.map(value=>PRESENTATION_MODES[value]).filter(Boolean).join(' · ');
      const tags=element('div','cwl-card-tags');
      for(const tag of [...new Set([...meta.topicIds.map(getTopicLabel),...(item.tags||[])])].slice(0,3))tags.append(element('span','',tag));
      const affordance=element('p','cwl-card-technology',`${levels}${formats?' · '+formats:''} · ${item.interactive?'可交互':'观看 / 阅读'}`);
      const footer=element('div','cwl-card-footer');const preview=button('打开预览');preview.dataset.coursewareId=item.id;const use=button('复用','btn btn-ghost');
      footer.append(preview,use,element('span','cwl-origin',item.source==='builtin'?'内置':'已保存'));
      cover.addEventListener('click',()=>void openPreview(item,cover));preview.addEventListener('click',()=>void openPreview(item,preview));use.addEventListener('click',()=>reuse(item));
      body.append(heading,details,element('p','cwl-card-description',item.description),tags,affordance,footer);card.append(cover,body);grid.append(card);
    }
    if(!items.length){
      const empty=element('div','cwl-empty');empty.append(element('h2','',state.filters.source==='saved'&&!state.items.some(item=>item.source==='saved')?'还没有保存的资源':'没有符合条件的资源'));
      const emptyHelp = state.filters.resourceForm === 'lesson_package'
        ? '整套课件的完整结构保存尚未接入。当前素材支持保存内容快照，可在知识点资源中查看。'
        : state.filters.resourceForm === 'explainer_video'
          ? '当前没有此类已保存成果。可以在课件助手中制作视频，完成后保存到这里。'
          : '减少筛选条件，或换一个知识点关键词试试。';
      empty.append(element('p','',emptyHelp));
      const action=button('清除筛选','btn');action.addEventListener('click',resetFilters);const create=button('前往制作','btn btn-primary');create.addEventListener('click',()=>reuse(null));empty.append(action,create);grid.append(empty);
    }
  }
  function resetFilters(){state.filters={tags:[]};form.reset();renderOptions();render();form.elements.namedItem('query').focus({preventScroll:true});}
  async function refresh() {
    const version = ++state.loadVersion; root.setAttribute('aria-busy', 'true');
    try {
      const items = await listCourseware(); if (version !== state.loadVersion) return;
      state.items = items; message(status);
    } catch (error) {
      if (version !== state.loadVersion) return;
      message(status, `${error.message} 当前仍可打开内置示例；已保存课件将在存储恢复后重新读取。`, true);
      const retry = button('重新读取', 'btn'); retry.addEventListener('click', () => void refresh()); status.append(' ', retry);
    } finally {
      if (version === state.loadVersion) { root.setAttribute('aria-busy', 'false'); renderOptions(); render(); }
    }
  }
  function teardownPreview() {
    state.previewVersion += 1; state.player?.destroy(); state.player = null;
    state.geometry?.destroy(); state.geometry = null;
    previewStage.querySelector('video')?.pause(); previewStage.replaceChildren();
  }
  function closePreview(restoreFocus = true) {
    state.restoreFocus = restoreFocus;
    teardownPreview();
    if (dialog.open) dialog.close();
  }
  async function openPreview(item, trigger) {
    teardownPreview(); const version = state.previewVersion;
    state.current = structuredClone(item); state.trigger = trigger; state.triggerItemId = item.id; state.restoreFocus = true;
    dialog.querySelector('h2').textContent = item.title;
    const metadata=getCoursewareMetadata(item);
    dialog.querySelector('[data-cwl-preview-meta]').textContent = `${metadata.subjects.join(' / ')} / ${RESOURCE_FORMS[metadata.resourceForm]} / ${item.technology}`;
    dialog.querySelector('[data-cwl-description]').textContent = item.description;
    deleteButton.hidden = item.source !== 'saved'; deleteButton.dataset.confirm = ''; deleteButton.textContent = '删除课件';
    saveButton.disabled = deleteButton.disabled = reuseButton.disabled = false;
    saveButton.textContent = item.source === 'saved' ? '保存当前版本' : '保存到此设备';
    message(previewStatus, '正在打开课件…');
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[data-cwl-close]').focus();
    try {
      if (item.type === 'geometry' && item.visualArtifact) {
        const { mountGeometryCourseware } = await import('./courseware-geometry.js');
        if (version !== state.previewVersion || !dialog.open) return;
        state.geometry = mountGeometryCourseware(previewStage, structuredClone(item));
        message(previewStatus);
      } else if (item.lesson && ['physics_lab', 'function_graph', 'projectile_lab', 'acid_base_lab', 'mindmap', 'concept_cards'].includes(item.lesson.artifact_type)) {
        const { mountInteractiveLessonPlayer } = await import('./interactive-lesson-lab.js');
        if (version !== state.previewVersion || !dialog.open) return;
        state.player = mountInteractiveLessonPlayer(previewStage, structuredClone(item.lesson), {
          onReady: () => { if (version === state.previewVersion) message(previewStatus); },
          onError: error => { if (version === state.previewVersion) message(previewStatus, `课件加载失败：${error?.message || '请关闭后重试。'}`, true); },
        });
        if (item.type !== 'physics_lab') message(previewStatus);
      } else if (item.html) {
        const frame = element('iframe', 'cwl-html-preview'); frame.title = `${item.title}课件预览`;
        frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer'; frame.srcdoc = item.html;
        previewStage.append(frame); message(previewStatus);
      } else if (item.videoUrl && /^(?:https?:\/\/|\/(?!\/))/i.test(item.videoUrl)) {
        const video = element('video', 'cwl-video-preview'); video.controls = true; video.playsInline = true; video.preload = 'metadata';
        video.addEventListener('error', () => message(previewStatus, '视频加载失败。地址可能已失效，请在助手中更新后重新保存。', true));
        video.src = item.videoUrl; previewStage.append(video); message(previewStatus);
      } else throw new Error('此课件暂没有可播放的数据，请在助手中补充内容。');
    } catch (error) { if (version === state.previewVersion) message(previewStatus, error.message, true); }
  }
  saveButton.addEventListener('click', async () => {
    if (!state.current) return;
    const version = state.previewVersion; const original = state.current;
    saveButton.disabled = deleteButton.disabled = reuseButton.disabled = true; message(previewStatus, '正在保存到此设备…');
    try {
      const item = captureCoursewarePreview(original, { lessonPlayer: state.player, geometryPlayer: state.geometry });
      if (state.player) {
        if (item.html) { const { buildCoursewareLessonHtml } = await import('./interactive-lesson-lab.js'); item.html = await buildCoursewareLessonHtml(item.lesson); }
      }
      const saved = await saveCourseware(item);
      if (version !== state.previewVersion) return;
      state.current = saved; deleteButton.hidden = false; saveButton.textContent = '保存当前版本';
      message(previewStatus, '已保存到此设备。刷新页面后仍可从课件库打开。');
    } catch (error) { if (version === state.previewVersion) message(previewStatus, error.message, true); }
    finally { if (version === state.previewVersion) saveButton.disabled = deleteButton.disabled = reuseButton.disabled = false; }
  });
  deleteButton.addEventListener('click', async () => {
    if (!state.current || state.current.source !== 'saved') return;
    if (!deleteButton.dataset.confirm) {
      deleteButton.dataset.confirm = 'true'; deleteButton.textContent = '确认删除';
      message(previewStatus, '再次点击“确认删除”会移除此设备保存的课件。关闭预览可取消。'); return;
    }
    const version = state.previewVersion; const id = state.current.id;
    deleteButton.disabled = saveButton.disabled = reuseButton.disabled = true;
    try { await deleteCourseware(id); if (version === state.previewVersion) { closePreview(); message(status, '已从此设备删除课件。'); } }
    catch (error) { if (version === state.previewVersion) message(previewStatus, error.message, true); }
    finally { if (version === state.previewVersion) deleteButton.disabled = saveButton.disabled = reuseButton.disabled = false; }
  });
  reuseButton.addEventListener('click', () => {
    try { reuse(captureCoursewarePreview(state.current, { lessonPlayer: state.player, geometryPlayer: state.geometry, forReuse: true })); }
    catch (error) { message(previewStatus, `无法读取当前课件：${error.message}`, true); }
  });
  dialog.querySelector('[data-cwl-close]').addEventListener('click', () => closePreview());
  dialog.addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    teardownPreview();
    if (!state.restoreFocus || root.hidden || root.closest('[hidden], [inert]') || !root.getClientRects().length) return;
    const visible = node => node?.isConnected && !node.closest('[hidden], [inert]') && node.getClientRects().length > 0;
    const replacement = [...grid.querySelectorAll('[data-courseware-id]')].find(node => node.dataset.coursewareId === state.triggerItemId);
    const target = visible(state.trigger) ? state.trigger : visible(replacement) ? replacement : form.elements.namedItem('query');
    if (visible(target)) target.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePreview(); } });
  form.addEventListener('submit', event => event.preventDefault());
  const readFilters=()=>{for(const key of controlKeys)state.filters[key]=form.elements.namedItem(key).value;render();};
  form.addEventListener('input',readFilters);form.addEventListener('change',readFilters);
  root.querySelectorAll('[data-resource-form]').forEach(node=>node.addEventListener('click',()=>{state.filters.resourceForm=node.dataset.resourceForm;render();}));
  tree.addEventListener('click',event=>{
    const node=event.target.closest('[data-subject]');if(!node)return;
    state.filters.subject=node.dataset.subject;state.filters.topicId=node.dataset.topic||'';render();
    if(narrowTree.matches){treeDisclosure.open=false;treeDisclosure.querySelector('summary').focus({preventScroll:true});}
  });
  root.querySelector('[data-cwl-active-filters]').addEventListener('click',event=>{
    const node=event.target.closest('[data-filter-key]');if(!node)return;const key=node.dataset.filterKey;
    if(key==='tags')state.filters.tags=state.filters.tags.filter(value=>value!==node.dataset.filterValue);
    else {state.filters[key]='';if(key==='subject')state.filters.topicId='';if(form.elements.namedItem(key))form.elements.namedItem(key).value='';}
    root.querySelectorAll('[data-tag]').forEach(tag=>tag.setAttribute('aria-pressed',String(state.filters.tags.includes(tag.dataset.tag))));render();
    form.elements.namedItem('query').focus({preventScroll:true});
  });
  root.querySelector('[data-cwl-tags]').addEventListener('click', event => {
    const node = event.target.closest('[data-tag]'); if (!node) return;
    const tag = node.dataset.tag; state.filters.tags = state.filters.tags.includes(tag) ? state.filters.tags.filter(value => value !== tag) : [...state.filters.tags, tag];
    node.setAttribute('aria-pressed', String(state.filters.tags.includes(tag))); render();
  });
  root.querySelector('[data-cwl-create]').addEventListener('click', () => reuse(null));
  clear.addEventListener('click', resetFilters);
  document.addEventListener('courseware:changed', () => void refresh());
  document.addEventListener('learning-workspace:change', event => { if (event.detail?.view !== 'courseware-library' && dialog.open) closePreview(false); });
  document.addEventListener('portal-role:change', () => { if (dialog.open) closePreview(false); });
  renderOptions(); render(); void refresh();
  return { refresh };
}
