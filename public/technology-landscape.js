import { SUBJECTS, TOPICS, getTopicLabel } from "./courseware-taxonomy.js";
import {
  TECHNOLOGIES, TECHNOLOGY_AUDIT_DATE, EFFECTS, CAPABILITIES,
  STATUS_LABELS, filterTechnologies, groupTechnologies
} from "./technology-catalog-data.js";

const instances = new WeakMap();

export function initTechnologyLandscape(options = {}) {
  const root = options.root || document.querySelector("#technologyLandscapeWorkspace");
  if (!root) return null;
  if (instances.has(root)) return instances.get(root);
  if (root.dataset.techLandscapeReady === "true") return null;
  const state = { query: "", status: "", effects: [], capabilities: [], subjects: [], topics: [] };
  const subjects = SUBJECTS;
  root.innerHTML = [
    '<section class="technology-landscape-shell technology-catalog" aria-labelledby="technologyLandscapeTitle">',
    '<div class="technology-catalog-intro"><div><h2 id="technologyLandscapeTitle">教学技术</h2><p>从课堂效果出发，查看系统能怎样生成、渲染与运行课件。</p></div><span>46 项已核对能力</span></div>',
    '<div class="technology-catalog-toolbar"><label class="technology-catalog-search"><span class="technology-catalog-label">搜索技术或教学场景</span><div><i data-lucide="search" aria-hidden="true"></i><input class="form-control" id="technologySearch" type="search" placeholder="搜索技术、效果或知识主题" autocomplete="off" /></div></label>',
    '<label class="technology-catalog-status"><span class="technology-catalog-label">接入状态</span><select id="technologyStatusFilter" class="form-select" aria-label="按接入状态筛选"><option value="">全部状态</option>',
    ...Object.entries(STATUS_LABELS).map(([value, label]) => '<option value="' + value + '">' + label + '</option>'),
    '</select></label><details class="technology-filter-popover"><summary><i data-lucide="sliders-horizontal" aria-hidden="true"></i><span>筛选</span><b data-technology-filter-count hidden>0</b><i data-lucide="chevron-down" aria-hidden="true"></i></summary><div class="technology-facets" aria-label="技术筛选">',
    facet("effects", "教学效果", EFFECTS.map(label => [label, label]), "technologyCategoryFilter"),
    facet("capabilities", "能力职责", CAPABILITIES.map(label => [label, label])),
    facet("subjects", "适用学科", subjects.map(label => [label, label]), "", "未限定学科的通用能力也会保留。"),
    facet("topics", "知识主题", TOPICS.map(topic => [topic.id, topic.subject + " · " + topic.label])),
    '</div></details></div><div class="technology-catalog-results"><p id="technologyResultCount" role="status" aria-live="polite" aria-atomic="true"></p><button type="button" class="btn btn-ghost" data-technology-reset hidden><i data-lucide="filter-x" aria-hidden="true"></i>清除筛选</button></div>',
    '<div class="technology-selection" data-technology-selection hidden aria-label="当前筛选"></div><div id="technologyLandscapeGrid" class="technology-catalog-groups"></div>',
    '<p class="technology-catalog-audit">依据本项目调用链整理，核对日期 ' + TECHNOLOGY_AUDIT_DATE + '。接入状态不表示服务此刻在线；生成能力仍取决于对应配置。</p></section>'
  ].join("");
  root.dataset.techLandscapeReady = "true";
  const grid = root.querySelector("#technologyLandscapeGrid");
  const search = root.querySelector("#technologySearch");
  const status = root.querySelector("#technologyStatusFilter");
  const count = root.querySelector("#technologyResultCount");
  const reset = root.querySelector("[data-technology-reset]");
  const selection = root.querySelector("[data-technology-selection]");
  const filterCount = root.querySelector("[data-technology-filter-count]");
  let alternativesOpen = false, foundationOpen = false;
  const hasFilters = () => Boolean(state.query || state.status || [state.effects, state.capabilities, state.subjects, state.topics].some(values => values.length));
  const render = () => {
    const visible = filterTechnologies(TECHNOLOGIES, state);
    const groups = groupTechnologies(visible);
    const filtered = hasFilters();
    alternativesOpen = grid.querySelector("[data-technology-alternatives]")?.open ?? alternativesOpen;
    foundationOpen = grid.querySelector("[data-technology-foundation]")?.open ?? foundationOpen;
    const showAlternatives = alternativesOpen || Boolean(state.query || (state.status && state.status !== "implemented") || (filtered && !groups.teaching.length));
    const showFoundation = foundationOpen || state.effects.includes("基础能力") || Boolean(state.query && groups.foundation.length);
    count.textContent = "已接入教学能力 " + groups.teaching.length + " 项 · 备选方案 " + groups.alternatives.length + " 项 · 基础能力 " + groups.foundation.length + " 项";
    reset.hidden = !filtered;
    root.querySelectorAll("[data-facet-count]").forEach(node => {
      const length = state[node.dataset.facetCount].length;
      node.textContent = length ? length + " 项" : "全部";
    });
    const selectedFacetCount = state.effects.length + state.capabilities.length + state.subjects.length + state.topics.length;
    if (filterCount) {
      filterCount.textContent = String(selectedFacetCount);
      filterCount.hidden = selectedFacetCount === 0;
    }
    const selections = Object.entries(state).flatMap(([key, values]) => Array.isArray(values) ? values.map(value => [key, value]) : []);
    selection.hidden = !selections.length;
    selection.innerHTML = selections.map(([key, value]) => {
      const label = key === "topics" ? getTopicLabel(value) : value;
      return '<button type="button" class="technology-selection-item" data-remove-facet="' + key + '" data-remove-value="' + escapeHtml(value) + '" aria-label="移除' + escapeHtml(label) + '筛选">' + escapeHtml(label) + '<i data-lucide="x" aria-hidden="true"></i></button>';
    }).join("");
    grid.innerHTML = visible.length ? [
      groups.teaching.length ? '<section aria-label="已接入教学能力"><div class="technology-entry-list">' + groups.teaching.map(entry).join("") + '</div></section>' : '<p class="technology-catalog-no-current">当前没有匹配的已接入教学能力。</p>',
      group("alternatives", "备选方案", groups.alternatives, showAlternatives, "尚未接入主应用的教学流程，供后续选型；源码已纳入也不表示教师可以直接使用。"),
      group("foundation", "通用基础能力", groups.foundation, showFoundation, "支撑生成、编排与结构校验，本身没有直接教学画面。")
    ].join("") : '<div class="technology-catalog-empty"><i data-lucide="search" aria-hidden="true"></i><h3>没有匹配的技术</h3><p>减少筛选条件，或换一个教学主题试试。</p><button type="button" class="btn" data-technology-clear>清除全部筛选</button></div>';
    root.ownerDocument?.defaultView?.lucide?.createIcons?.({ root, attrs: { "stroke-width": 1.8 } });
    return visible;
  };
  const clear = () => {
    Object.assign(state, { query: "", status: "", effects: [], capabilities: [], subjects: [], topics: [] });
    search.value = ""; status.value = "";
    root.querySelectorAll("[data-technology-facet]").forEach(input => { input.checked = false; });
    root.querySelectorAll("[data-technology-alternatives], [data-technology-foundation]").forEach(details => { details.open = false; });
    alternativesOpen = false; foundationOpen = false;
    render();
  };
  search.addEventListener("input", () => { state.query = search.value.trim(); render(); });
  status.addEventListener("change", () => { state.status = status.value; render(); });
  root.addEventListener("change", event => {
    const input = event.target.closest("[data-technology-facet]");
    if (!input) return;
    const key = input.dataset.technologyFacet;
    state[key] = [...root.querySelectorAll('[data-technology-facet="' + key + '"]:checked')].map(node => node.value);
    render();
  });
  root.addEventListener("click", event => {
    if (event.target.closest("[data-technology-reset], [data-technology-clear]")) { clear(); search.focus(); }
    const remove = event.target.closest("[data-remove-facet]");
    if (remove) {
      const { removeFacet, removeValue } = remove.dataset;
      state[removeFacet] = state[removeFacet].filter(value => value !== removeValue);
      root.querySelectorAll('[data-technology-facet="' + removeFacet + '"]').forEach(input => { input.checked = state[removeFacet].includes(input.value); });
      render();
      root.querySelector('[data-facet-summary="' + removeFacet + '"]')?.focus();
    }
  });
  const api = Object.freeze({ render, clear, technologies: TECHNOLOGIES });
  instances.set(root, api);
  render();
  return api;
}

function facet(key, title, choices, id = "", help = "") {
  return '<details class="technology-facet" ' + (id ? 'id="' + id + '"' : "") + '><summary data-facet-summary="' + key + '"><span>' + title + '</span><span data-facet-count="' + key + '">全部</span><i data-lucide="chevron-down" aria-hidden="true"></i></summary><fieldset><legend>' + title + '（可多选）</legend>' + (help ? '<p>' + help + '</p>' : "") + choices.map(([value, label]) => '<label><input type="checkbox" class="form-check-input" value="' + escapeHtml(value) + '" data-technology-facet="' + key + '" /><span>' + escapeHtml(label) + '</span></label>').join("") + '</fieldset></details>';
}

function group(key, label, items, open, note) {
  if (!items.length) return "";
  return '<details class="technology-group" data-technology-' + key + (open ? ' open' : '') + '><summary><span>' + label + '</span><span>' + items.length + ' 项</span><i data-lucide="chevron-down" aria-hidden="true"></i></summary><p>' + note + '</p><div class="technology-entry-list">' + items.map(entry).join("") + '</div></details>';
}

function entry(item) {
  const subjects = item.subjects.length ? item.subjects.join("、") : "跨学科";
  const topics = item.topics.map(getTopicLabel).join("、");
  return '<article class="technology-entry" data-technology="' + item.id + '" data-status="' + item.status + '"><header><h3>' + escapeHtml(item.title) + '</h3><span class="technology-entry-status">' + STATUS_LABELS[item.status] + '</span></header><p class="technology-entry-description">' + escapeHtml(item.scenario) + '</p><dl class="technology-entry-facts"><div><dt>效果</dt><dd>' + escapeHtml(item.effects.join(" · ")) + '</dd></div><div><dt>能力</dt><dd>' + escapeHtml(item.capabilities.join(" · ")) + '</dd></div><div><dt>学科</dt><dd>' + escapeHtml(subjects) + (topics ? '<span> · ' + escapeHtml(topics) + '</span>' : "") + '</dd></div></dl><details class="technology-entry-detail"><summary><span>技术说明 · ' + escapeHtml(item.name) + '</span><i data-lucide="chevron-down" aria-hidden="true"></i></summary><div><p>' + escapeHtml(item.boundary) + '</p><dl><dt>调用依据</dt><dd>' + escapeHtml(item.evidence) + '</dd><dt>许可范围</dt><dd>' + escapeHtml(item.license) + '</dd></dl>' + (item.url ? '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">查看官方项目<i data-lucide="arrow-up-right" aria-hidden="true"></i></a>' : "") + '</div></details></article>';
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
