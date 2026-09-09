import { A2UIRenderer } from "./a2ui-renderer.js";
import {
  CARD_LIBRARY_VERSION,
  EDUCATION_CARD_CATALOG,
  getEducationCardDefinition
} from "./card-library-data.js";

const A2UI_VERSION = "v0.9";
const EDUCATION_CATALOG_ID = "urn:a2ui:catalog:education:1.0";

export class CardLibrary {
  constructor(root, options = {}) {
    this.root = resolveRoot(root);
    this.catalog = normalizeCatalog(options.catalog || EDUCATION_CARD_CATALOG);
    this.initialType = String(options.initialType || this.catalog[0]?.type || "");
    this.onAction = typeof options.onAction === "function" ? options.onAction : () => {};
    this.onError = typeof options.onError === "function" ? options.onError : () => {};
    this.Renderer = options.rendererClass || A2UIRenderer;
    this.selectedType = "";
    this.filterQuery = "";
    this.renderer = null;
    this.elements = {};
    this.abortController = null;
  }

  mount() {
    if (!this.root) throw new TypeError("CardLibrary requires a valid root element");
    this.destroy();
    this.abortController = new AbortController();
    this.root.replaceChildren(this.createShell());
    this.bindEvents();
    this.renderCatalog();
    this.select(this.initialType || this.catalog[0]?.type);
    return this;
  }

  destroy() {
    this.abortController?.abort();
    this.abortController = null;
    this.renderer?.clear?.();
    this.renderer = null;
    if (this.root) this.root.replaceChildren();
    this.elements = {};
  }

  select(typeOrId) {
    const definition = this.findDefinition(typeOrId);
    if (!definition) return false;
    this.selectedType = definition.type;
    this.renderCatalog();
    this.renderDetail(definition);
    return true;
  }

  getSelectedDefinition() {
    return this.findDefinition(this.selectedType);
  }

  setFilter(query) {
    this.filterQuery = String(query || "").trim().toLocaleLowerCase("zh-CN");
    this.renderCatalog();
  }

  setCatalog(catalog, { preserveSelection = true } = {}) {
    this.catalog = normalizeCatalog(catalog);
    const nextType =
      preserveSelection && this.findDefinition(this.selectedType)
        ? this.selectedType
        : this.catalog[0]?.type || "";
    this.selectedType = "";
    this.renderCatalog();
    if (nextType) this.select(nextType);
  }

  createShell() {
    const shell = element("section", "card-library");
    shell.dataset.cardLibraryVersion = CARD_LIBRARY_VERSION;
    shell.setAttribute("aria-label", "A2UI 教育卡片库");

    const aside = element("aside", "card-library__sidebar");
    const sidebarHeader = element("header", "card-library__sidebar-header");
    sidebarHeader.append(
      element("p", "card-library__eyebrow", "A2UI COMPONENTS"),
      element("h2", "card-library__title", "教育卡片库")
    );
    const count = element("span", "card-library__count");
    sidebarHeader.append(count);

    const searchLabel = element("label", "card-library__search");
    const searchText = element("span", "card-library__sr-only", "筛选卡片");
    const search = document.createElement("input");
    search.type = "search";
    search.className = "card-library__search-input";
    search.placeholder = "搜索名称、类型或用途";
    search.autocomplete = "off";
    searchLabel.append(searchText, search);

    const navigation = element("nav", "card-library__navigation");
    navigation.setAttribute("aria-label", "卡片类型");
    const menu = element("div", "card-library__menu");
    navigation.append(menu);
    aside.append(sidebarHeader, searchLabel, navigation);

    const detail = element("main", "card-library__detail");
    detail.setAttribute("aria-live", "polite");
    shell.append(aside, detail);

    this.elements = { shell, aside, count, search, navigation, menu, detail };
    return shell;
  }

  bindEvents() {
    const signal = this.abortController.signal;
    this.elements.search.addEventListener(
      "input",
      (event) => this.setFilter(event.currentTarget.value),
      { signal }
    );
    this.elements.menu.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest("[data-card-library-type]");
        if (!button) return;
        this.select(button.dataset.cardLibraryType);
      },
      { signal }
    );
  }

  renderCatalog() {
    const menu = this.elements.menu;
    if (!menu) return;
    const visible = this.catalog.filter((definition) => {
      if (!this.filterQuery) return true;
      return [
        definition.displayName,
        definition.type,
        definition.category,
        definition.description
      ]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(this.filterQuery);
    });
    this.elements.count.textContent = `${visible.length} / ${this.catalog.length}`;
    menu.replaceChildren();

    if (!visible.length) {
      const empty = element("p", "card-library__empty", "没有匹配的卡片");
      menu.append(empty);
      return;
    }

    const grouped = groupByCategory(visible);
    grouped.forEach(({ category, items }) => {
      const group = element("section", "card-library__menu-group");
      const heading = element("h3", "card-library__menu-heading", category);
      const list = element("div", "card-library__menu-list");
      items.forEach((definition) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "card-library__menu-item";
        button.dataset.cardLibraryType = definition.type;
        button.classList.toggle("is-active", definition.type === this.selectedType);
        button.setAttribute(
          "aria-current",
          definition.type === this.selectedType ? "page" : "false"
        );
        const name = element("strong", "card-library__menu-name", definition.displayName);
        const type = element("code", "card-library__menu-type", definition.type);
        button.append(name, type);
        list.append(button);
      });
      group.append(heading, list);
      menu.append(group);
    });
  }

  renderDetail(definition) {
    this.renderer?.clear?.();
    this.renderer = null;
    const detail = this.elements.detail;
    detail.replaceChildren();

    const header = element("header", "card-library__detail-header");
    const headingGroup = element("div", "card-library__heading-group");
    headingGroup.append(
      element("p", "card-library__eyebrow", definition.category),
      element("h1", "card-library__detail-title", definition.displayName),
      element("p", "card-library__description", definition.description)
    );
    const badges = element("div", "card-library__badges");
    badges.append(
      badge(definition.type, "card-library__badge--type"),
      badge(`v${definition.version}`, "card-library__badge--version")
    );
    header.append(headingGroup, badges);

    const overview = element("div", "card-library__overview-grid");
    const previewPanel = this.createPreviewPanel(definition);
    const identityPanel = this.createIdentityPanel(definition);
    overview.append(previewPanel, identityPanel);

    const dataGrid = element("div", "card-library__data-grid");
    dataGrid.append(
      this.createCodePanel(
        "数据格式",
        "JSON Schema · Draft 2020-12",
        definition.schema,
        "schema"
      ),
      this.createCodePanel(
        "模拟数据",
        "可直接发送给 EducationCard 渲染器",
        definition.mockData,
        "mock"
      )
    );

    detail.append(header, overview, dataGrid);
    const previewRoot = previewPanel.querySelector("[data-card-library-preview]");
    this.renderPreview(previewRoot, definition);
  }

  createPreviewPanel(definition) {
    const panel = sectionPanel("样式预览", "使用当前项目的 A2UIRenderer 实时渲染");
    panel.classList.add("card-library__panel--preview");
    const canvas = element("div", "card-library__preview-canvas");
    canvas.dataset.cardLibraryPreview = definition.type;
    const eventPanel = element("div", "card-library__event-panel");
    const eventLabel = element("span", "card-library__event-label", "交互事件");
    const eventOutput = element("pre", "card-library__event-output");
    eventOutput.textContent = "点击卡片中的交互控件，可在这里查看标准 A2UI 事件。";
    eventPanel.append(eventLabel, eventOutput);
    panel.append(canvas, eventPanel);
    this.elements.eventOutput = eventOutput;
    return panel;
  }

  createIdentityPanel(definition) {
    const panel = sectionPanel("组件信息", definition.exampleDescription);
    panel.classList.add("card-library__panel--identity");
    const list = element("dl", "card-library__identity");
    appendDefinition(list, "目录 ID", definition.id, true);
    appendDefinition(list, "card.type", definition.type, true);
    appendDefinition(list, "card.version", definition.version, true);
    appendDefinition(list, "示例 card.id", definition.mockData.id, true);
    appendDefinition(list, "分类", definition.category, false);

    const notes = element("div", "card-library__visual-notes");
    notes.append(element("h3", "card-library__subheading", "视觉与使用说明"));
    const noteList = element("ul", "card-library__note-list");
    (definition.visualNotes || []).forEach((note) => {
      noteList.append(element("li", "card-library__note", note));
    });
    notes.append(noteList);
    panel.append(list, notes);
    return panel;
  }

  createCodePanel(title, subtitle, value, kind) {
    const panel = sectionPanel(title, subtitle);
    panel.classList.add("card-library__panel--code");
    panel.dataset.cardLibraryCode = kind;
    const toolbar = element("div", "card-library__code-toolbar");
    const label = element("span", "card-library__code-language", "JSON");
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "card-library__copy-button";
    copy.textContent = "复制";
    const code = element("code", "card-library__code");
    code.textContent = prettyJson(value);
    const pre = element("pre", "card-library__code-block");
    pre.tabIndex = 0;
    pre.append(code);
    copy.addEventListener(
      "click",
      async () => {
        const copied = await copyText(code.textContent);
        copy.textContent = copied ? "已复制" : "复制失败";
        window.setTimeout(() => {
          copy.textContent = "复制";
        }, 1400);
      },
      { signal: this.abortController.signal }
    );
    toolbar.append(label, copy);
    panel.append(toolbar, pre);
    return panel;
  }

  renderPreview(root, definition) {
    if (!root) return;
    const eventOutput = this.elements.eventOutput;
    this.renderer = new this.Renderer(root, {
      onEvent: (event) => {
        eventOutput.textContent = prettyJson(event);
        this.onAction(event, definition);
      },
      onError: (error) => {
        eventOutput.textContent = prettyJson(error);
        eventOutput.classList.add("is-error");
        this.onError(error, definition);
      }
    });
    const rendered = this.renderer.applyMessages(
      createEducationCardMessages(definition.mockData, {
        surfaceId: `card_library_${safeId(definition.type)}`
      })
    );
    if (!rendered) {
      eventOutput.textContent = "卡片渲染失败，请查看 onError 回调。";
      eventOutput.classList.add("is-error");
    }
  }

  findDefinition(typeOrId) {
    const key = String(typeOrId || "");
    return (
      this.catalog.find((item) => item.type === key || item.id === key) ||
      getEducationCardDefinition(key)
    );
  }
}

export function createEducationCardMessages(card, { surfaceId } = {}) {
  const safeSurfaceId =
    safeId(surfaceId || `card_library_${card?.type || "preview"}`) ||
    "card_library_preview";
  const componentId = "card_library_component";
  return [
    {
      version: A2UI_VERSION,
      createSurface: {
        surfaceId: safeSurfaceId,
        catalogId: EDUCATION_CATALOG_ID,
        sendDataModel: true
      }
    },
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId: safeSurfaceId,
        components: [
          {
            id: "root",
            component: "Column",
            children: [componentId],
            justify: "start",
            align: "stretch"
          },
          {
            id: componentId,
            component: "EducationCard",
            card: cloneValue(card)
          }
        ]
      }
    },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId: safeSurfaceId,
        path: "/",
        value: {
          contract_version: String(card?.version || "1.0"),
          cards: card?.id ? { [card.id]: cloneValue(card.state || {}) } : {}
        }
      }
    }
  ];
}

export function initCardLibrary(root, options = {}) {
  return new CardLibrary(root, options).mount();
}

export const mountCardLibrary = initCardLibrary;

export function autoInitCardLibraries(selector = "[data-card-library]") {
  return [...document.querySelectorAll(selector)].map((root) =>
    initCardLibrary(root, {
      initialType: root.dataset.initialCardType || undefined
    })
  );
}

function resolveRoot(root) {
  if (typeof root === "string") return document.querySelector(root);
  return root && typeof root.replaceChildren === "function" ? root : null;
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog)) return [];
  return catalog
    .filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.type === "string" &&
        item.mockData
    )
    .map(cloneValue);
}

function groupByCategory(items) {
  const groups = new Map();
  items.forEach((item) => {
    const category = String(item.category || "其他");
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  });
  return [...groups].map(([category, groupItems]) => ({
    category,
    items: groupItems
  }));
}

function sectionPanel(title, subtitle) {
  const panel = element("section", "card-library__panel");
  const header = element("header", "card-library__panel-header");
  header.append(
    element("h2", "card-library__panel-title", title),
    element("p", "card-library__panel-subtitle", subtitle)
  );
  panel.append(header);
  return panel;
}

function appendDefinition(list, termText, value, useCode) {
  const row = element("div", "card-library__identity-row");
  const term = element("dt", "card-library__identity-term", termText);
  const description = element("dd", "card-library__identity-value");
  const content = element(
    useCode ? "code" : "span",
    useCode ? "card-library__inline-code" : "",
    value
  );
  description.append(content);
  row.append(term, description);
  list.append(row);
}

function badge(text, modifier) {
  const item = element("span", `card-library__badge ${modifier || ""}`.trim(), text);
  return item;
}

function element(tagName, className = "", text = "") {
  const item = document.createElement(tagName);
  if (className) item.className = className;
  if (text !== undefined && text !== null && text !== "") {
    item.textContent = String(text);
  }
  return item;
}

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // The document.execCommand fallback below also works in non-secure local previews.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function safeId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 96);
}

function cloneValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
