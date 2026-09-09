const TECHNOLOGIES = Object.freeze([
  tech("Pi Agent Core", "Agent 编排", "有状态 Agent、工具调用、事件轨迹", "https://github.com/earendil-works/pi", "MIT", "implemented"),
  tech("TypeBox", "Agent 编排", "工具参数 Schema 与运行时约束", "https://github.com/sinclairzx81/typebox", "MIT", "implemented"),
  tech("Lesson DSL", "Agent 编排", "知识点到受控教学产物的中间协议", "", "自研", "implemented"),
  tech("Canvas 2D", "运行时与导出", "函数图、抛体轨迹、滴定现象绘制", "https://github.com/whatwg/html", "Web Standard", "implemented"),
  tech("MediaRecorder", "运行时与导出", "画布演示录像与 WebM 下载", "https://github.com/w3c/mediacapture-record", "Web Standard", "implemented"),
  tech("Mafs", "数学", "React 函数图、向量、可拖拽点", "https://github.com/stevenpetryk/mafs", "MIT", "candidate"),
  tech("JSXGraph", "数学", "动态几何、函数图、轨迹与测量", "https://github.com/jsxgraph/jsxgraph", "MIT/LGPL", "candidate"),
  tech("GeoGebra Integration", "数学", "高级几何、CAS、3D 与教师编辑", "https://github.com/geogebra/integration", "需单独核查", "candidate"),
  tech("KaTeX", "数学", "高性能 LaTeX 公式排版", "https://github.com/KaTeX/KaTeX", "MIT", "candidate"),
  tech("MathLive", "数学", "可编辑公式、虚拟键盘与 MathJSON", "https://github.com/arnog/mathlive", "MIT", "candidate"),
  tech("Math.js", "数学", "表达式解析、单位与数值计算", "https://github.com/josdejong/mathjs", "Apache-2.0", "candidate"),
  tech("Matter.js", "物理", "已接入：斜面、单摆、碰撞参数实验", "https://github.com/liabru/matter-js", "MIT", "implemented"),
  tech("Planck.js", "物理", "已接入：Box2D 风格斜面、单摆与碰撞", "https://github.com/shakacode/planck.js", "MIT", "implemented"),
  tech("Rapier", "物理", "Rust/WASM 高性能 2D/3D 物理", "https://github.com/dimforge/rapier", "Apache-2.0", "candidate"),
  tech("Three.js", "物理", "3D 场景、光学、空间实验显示", "https://github.com/mrdoob/three.js", "MIT", "existing"),
  tech("CircuitJS1", "物理", "电路、示波器、器件参数仿真", "https://github.com/sharpie7/circuitjs1", "GPL-2.0", "candidate"),
  tech("PhET Simulations", "物理", "学科建模与交互教学仿真参考", "https://github.com/phetsims", "逐项核查", "candidate"),
  tech("PixiJS", "化学与生物", "粒子、气泡、沉淀、溶液现象动画", "https://github.com/pixijs/pixijs", "MIT", "candidate"),
  tech("XState", "化学与生物", "实验步骤、装置状态与错误边界", "https://github.com/statelyai/xstate", "MIT", "candidate"),
  tech("3Dmol.js", "化学与生物", "WebGL 分子结构、表面与选择", "https://github.com/3dmol/3Dmol.js", "BSD-3-Clause", "candidate"),
  tech("Mol*", "化学与生物", "蛋白质、晶体与大型分子结构", "https://github.com/molstar/molstar", "MIT", "candidate"),
  tech("RDKit.js", "化学与生物", "化学结构规则、指纹与子结构", "https://github.com/rdkit/rdkit", "BSD-3-Clause", "candidate"),
  tech("Kekule.js", "化学与生物", "化学结构编辑与可视化", "https://github.com/partridgejiang/Kekule.js", "MIT", "candidate"),
  tech("Manim", "视频", "公式推导、几何证明与精确数学动画", "https://github.com/ManimCommunity/manim", "MIT", "candidate"),
  tech("Remotion", "视频", "React 时间轴、字幕、卡片与批量视频", "https://github.com/remotion-dev/remotion", "特殊许可", "candidate"),
  tech("Motion Canvas", "视频", "TypeScript 程序化动画与可视化", "https://github.com/motion-canvas/motion-canvas", "MIT", "candidate"),
  tech("Revideo", "视频", "TypeScript 视频模板、API 渲染与预览", "https://github.com/redotvideo/revideo", "MIT", "candidate"),
  tech("FFmpeg", "视频", "音视频合成、转码、字幕与封装", "https://github.com/FFmpeg/FFmpeg", "LGPL/GPL", "candidate"),
  tech("Mermaid", "结构图与知识网络", "流程、因果、状态、时间线", "https://github.com/mermaid-js/mermaid", "MIT", "candidate"),
  tech("Markmap", "结构图与知识网络", "Markdown 层级到思维导图", "https://github.com/markmap/markmap", "MIT", "candidate"),
  tech("React Flow", "结构图与知识网络", "可编辑知识图谱、学习路径与依赖图", "https://github.com/xyflow/xyflow", "MIT", "candidate"),
  tech("Excalidraw", "结构图与知识网络", "手绘风教学图、批注与师生共创", "https://github.com/excalidraw/excalidraw", "MIT", "candidate"),
  tech("AntV G6", "结构图与知识网络", "大规模关系图、布局与交互", "https://github.com/antvis/G6", "MIT", "existing"),
  tech("Apache ECharts", "数据图表", "统计图、趋势图、学习数据与科学曲线", "https://github.com/apache/echarts", "Apache-2.0", "existing"),
  tech("Tiptap", "卡片与创作", "可扩展富文本、结构化内容块", "https://github.com/ueberdosis/tiptap", "MIT", "candidate"),
  tech("BlockNote", "卡片与创作", "Notion 式块编辑、拖拽与协作", "https://github.com/TypeCellOS/BlockNote", "MPL-2.0", "candidate"),
  tech("H5P", "卡片与创作", "成熟交互题型、LMS 集成与内容包", "https://github.com/h5p", "MIT/GPL 逐项核查", "candidate"),
  tech("OpenMAIC", "卡片与创作", "Stage / Scene / Action 互动课堂管线", "https://github.com/THU-MAIC/OpenMAIC", "MIT", "existing"),
  tech("DeepTutor", "卡片与创作", "Book / Spine / Page / Block 教材结构", "https://github.com/HKUDS/DeepTutor", "Apache-2.0", "existing"),
  tech("Koji-style", "卡片与创作", "渐进提示、学习状态与逐步减少支架", "", "自研，未使用 Koji 源码", "existing"),
  tech("Playwright", "校验与治理", "执行、视觉截图、交互流与导出校验", "https://github.com/microsoft/playwright", "Apache-2.0", "candidate"),
  tech("JSON Schema", "校验与治理", "DSL 字段、范围、版本与可迁移性", "https://github.com/json-schema-org/json-schema-spec", "Specification", "candidate"),
]);

const STATUS_LABELS = Object.freeze({
  implemented: "本次已开发",
  existing: "项目已有",
  candidate: "候选技术",
});

export function initTechnologyLandscape(options = {}) {
  const root = options.root || document.querySelector("#technologyLandscapeWorkspace");
  if (!root || root.dataset.techLandscapeReady === "true") return null;
  root.dataset.techLandscapeReady = "true";
  const grid = root.querySelector("#technologyLandscapeGrid");
  const search = root.querySelector("#technologySearch");
  const category = root.querySelector("#technologyCategoryFilter");
  const status = root.querySelector("#technologyStatusFilter");
  const count = root.querySelector("#technologyResultCount");
  const categories = [...new Set(TECHNOLOGIES.map((item) => item.category))];
  category.insertAdjacentHTML(
    "beforeend",
    categories.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join(""),
  );

  const render = () => {
    const query = search.value.trim().toLowerCase();
    const selectedCategory = category.value;
    const selectedStatus = status.value;
    const visible = TECHNOLOGIES.filter((item) => {
      if (selectedCategory && item.category !== selectedCategory) return false;
      if (selectedStatus && item.status !== selectedStatus) return false;
      return !query || [item.name, item.category, item.scenario, item.license]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    count.textContent = `显示 ${visible.length} / ${TECHNOLOGIES.length} 项`;
    grid.innerHTML = visible.map((item) => `
      <article class="technology-card" data-status="${item.status}">
        <header><span>${escapeHtml(item.category)}</span><em>${STATUS_LABELS[item.status]}</em></header>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.scenario)}</p>
        <footer><span>${escapeHtml(item.license)}</span>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">GitHub <i data-lucide="arrow-up-right"></i></a>` : '<span>项目内部能力</span>'}</footer>
      </article>`).join("");
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  };
  search.addEventListener("input", render);
  category.addEventListener("change", render);
  status.addEventListener("change", render);
  render();
  return Object.freeze({ render, technologies: TECHNOLOGIES });
}

function tech(name, category, scenario, url, license, status) {
  return Object.freeze({ name, category, scenario, url, license, status });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/gu, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
