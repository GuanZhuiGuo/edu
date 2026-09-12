import { getTopicLabel } from "./courseware-taxonomy.js";

// Audited against the host application's callers on 2026-09-12.
// These are integration facts, not a live health check or learning-effect claim.
export const TECHNOLOGY_AUDIT_DATE = "2026-09-12";
export const EFFECTS = Object.freeze(["二维图解", "三维空间", "图表与数据", "结构化文档", "音视频", "基础能力"]);
export const CAPABILITIES = Object.freeze(["生成", "编辑", "渲染", "仿真", "编排", "校验", "导出"]);
export const STATUS_LABELS = Object.freeze({ implemented: "已接入", existing: "源码已纳入", candidate: "待接入" });

const M = "数学", P = "物理", C = "化学", B = "生物";
const graph = "图表与数据", flat = "二维图解", space = "三维空间", doc = "结构化文档", av = "音视频", base = "基础能力";

function technology(name, title, scenario, effects, capabilities, subjects, topics, options = {}) {
  return Object.freeze({
    name, title, scenario,
    id: name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, ""),
    effects: Object.freeze(effects), capabilities: Object.freeze(capabilities),
    subjects: Object.freeze(subjects), topics: Object.freeze(topics),
    status: "candidate", group: "teaching", license: "MIT", url: "",
    boundary: "当前应用尚未接入，需完成适配与验证后使用。",
    evidence: "主应用无依赖及可达调用链；候选研究。",
    keywords: Object.freeze([]), ...options
  });
}

export const TECHNOLOGIES = Object.freeze([
  technology("SVG", "可调节的平面几何", "改变直角三角形边长、圆的半径与扇形角度，观察面积与比例。", [flat, graph], ["渲染", "编辑", "导出"], [M], ["math/geometry"], {
    status: "implemented", url: "https://www.w3.org/TR/SVG2/", license: "Web 标准",
    boundary: "当前支持直角三角形、圆与扇形预设；尚不支持任意几何作图与约束求解。",
    evidence: "public/courseware-geometry.js → public/interactive-visual-renderer.js", keywords: ["2D", "勾股定理", "圆", "扇形"]
  }),
  technology("Canvas 2D", "函数与实验现象图解", "通过图像、轨迹和溶液现象解释变量关系。", [flat, graph], ["渲染"], [M, P, C], ["math/functions", "physics/mechanics", "chemistry/reactions"], {
    status: "implemented", url: "https://html.spec.whatwg.org/multipage/canvas.html", license: "Web 标准",
    boundary: "覆盖已有函数、抛体和酸碱等受控预设；画布绘制本身不负责科学求解。",
    evidence: "public/interactive-lesson-lab.js LessonPlayer；public/physics-lesson-runtime.js", keywords: ["2D", "函数", "抛体", "滴定"]
  }),
  technology("Matter.js", "二维力学实验", "调节斜面、单摆与碰撞参数，观察受力和运动变化。", [flat, graph], ["仿真", "渲染"], [P], ["physics/mechanics"], {
    status: "implemented", url: "https://github.com/liabru/matter-js",
    boundary: "本项目已接入三个力学预设和固定步长；不代表任意物理实验都已建模。",
    evidence: "public/physics-lesson-runtime.js#createMatterWorld；public/physics-lesson-player.js", keywords: ["2D", "斜面", "单摆", "碰撞"]
  }),
  technology("Planck.js", "刚体与关节实验", "用 Box2D 风格的求解器演示碰撞、斜面和单摆。", [flat, graph], ["仿真", "渲染"], [P], ["physics/mechanics"], {
    status: "implemented", url: "https://github.com/piqnt/planck.js",
    boundary: "与 Matter.js 均有真实调用和显式切换；当前安装版本为 1.4.2。",
    evidence: "public/physics-lesson-runtime.js#createPlanckWorld；package.json", keywords: ["2D", "Box2D", "碰撞", "关节"]
  }),
  technology("Three.js", "三维场景浏览", "旋转、缩放、选择和查看空间对象，理解部件之间的关系。", [space], ["渲染"], [], ["general/interdisciplinary"], {
    status: "implemented", url: "https://github.com/mrdoob/three.js",
    boundary: "已有知识空间与细胞场景查看器；不提供通用文字生成 3D 或物理求解。",
    evidence: "public/knowledge-spatial-viewer.js#mountKnowledgeSpatialViewer；server.js /vendor/three.module.js", keywords: ["3D", "WebGL", "空间", "细胞"]
  }),
  technology("Cell Architecture Studio", "细胞结构探索", "在三维细胞中查看细胞器与局部结构。", [space, doc], ["生成", "渲染"], [B], ["biology/organisms"], {
    status: "implemented", url: "https://github.com/cclank/cell-architecture-studio",
    boundary: "确定性适配七类官方细胞标本的数据与程序化几何；不支持任意知识点生成 3D，不使用上游二进制素材。",
    evidence: "source-techniques/cell-studio-adapter.js → public/knowledge-material-studio.js#renderCellStudio → knowledge-spatial-viewer.js", keywords: ["3D", "Cell Studio", "细胞器", "细胞"]
  }),
  technology("Apache ECharts", "数据与掌握度图表", "比较学习数据、展示趋势和观察变量关系。", [graph, flat], ["渲染"], [], ["math/statistics", "general/interdisciplinary"], {
    status: "implemented", url: "https://github.com/apache/echarts", license: "Apache-2.0",
    boundary: "已有知识掌握度图表调用；更多图表类型仍需教学数据和对应配置。",
    evidence: "public/knowledge-visualizations.js#renderMastery；public/index.html 本地 ECharts 脚本", keywords: ["统计", "数据", "趋势", "图表"]
  }),
  technology("AntV G6", "知识关系与依赖图", "把概念、先修关系和知识层级连成可交互的图。", [flat, graph], ["渲染"], [], ["general/interdisciplinary"], {
    status: "implemented", url: "https://github.com/antvis/G6",
    boundary: "已用于知识导图和依赖图；图布局不能证明知识关系本身正确。",
    evidence: "public/knowledge-visualizations.js#renderStructure / renderDependency；new G6.Graph", keywords: ["知识图谱", "网络", "思维导图"]
  }),
  technology("KaTeX", "清晰的数学公式", "将回答中的 LaTeX 公式排成可读的行内公式和独立公式。", [doc, flat], ["渲染"], [M, P, C], ["math/algebra", "math/functions", "physics/mechanics", "chemistry/reactions"], {
    status: "implemented", url: "https://github.com/KaTeX/KaTeX",
    boundary: "负责公式排版，不提供公式编辑、代数求解或正确性判断。",
    evidence: "public/agent-answer-renderer.js#renderMathInto → katex.render；public/index.html 本地 KaTeX", keywords: ["LaTeX", "公式", "排版"]
  }),
  technology("DeepTutor", "按章节组织的教材", "从来源材料生成书脊、章节、页面和内容块。", [doc, flat, graph], ["生成", "编排", "渲染"], [], ["general/interdisciplinary"], {
    status: "implemented", url: "https://github.com/HKUDS/DeepTutor", license: "Apache-2.0",
    boundary: "已连接固定版本官方 Book Engine；生成需配置模型。本目录不代表其全部 Agent、Manim 等能力均已接入。",
    evidence: "source-technique-pipeline.js → source-bridges/deeptutor/index.js → bridge.py → third_party/deeptutor/deeptutor/book", keywords: ["Book", "Spine", "教材", "章节"]
  }),
  technology("OpenMAIC", "分场景的互动课堂", "把材料组织成幻灯片、测验和课堂动作。", [doc, flat, graph], ["生成", "编排", "渲染"], [], ["general/interdisciplinary"], {
    status: "implemented", url: "https://github.com/THU-MAIC/OpenMAIC",
    boundary: "已连接固定版本官方生成管线与场景渲染器；生成需配置模型，不代表所有上游媒体服务已配置。",
    evidence: "source-technique-pipeline.js → source-bridges/openmaic/official-worker.ts → runGenerationPipeline；public/knowledge-material-studio.js", keywords: ["Stage", "Scene", "Action", "课堂", "幻灯片"]
  }),
  technology("Koji-style", "逐步提示与学习支架", "按学习状态提供分层提示，让学生逐步独立作答。", [doc], ["生成", "编排", "渲染"], [], ["general/interdisciplinary"], {
    status: "implemented", license: "项目自研",
    boundary: "本项目原创状态与提示逻辑；未使用 Koji 源码，也不表示已验证教学效果。",
    evidence: "source-techniques/koji-adapter.js；source-technique-pipeline.js；public/knowledge-material-studio.js", keywords: ["提示", "支架", "辅导", "状态"]
  }),
  technology("Seedream", "生成教学镜头画面", "根据分镜提示和可用参考图生成教学画面，保存为镜头图片素材。", [flat], ["生成"], [], ["general/interdisciplinary"], {
    status: "implemented", license: "火山方舟 API 服务，按账户与服务条款使用",
    boundary: "已接入图片生成与转存；需要可用的图像模型配置、凭证与上游服务，教材文字和科学细节需核对。",
    evidence: "education-video-http.js image 路由 → education-video-service.js#generateSceneImage → ark-media-client.js#generateImage；education-runtime-model-clients.js image_generation 配置", keywords: ["图像生成", "文生图", "参考图", "教学视觉", "火山方舟"]
  }),
  technology("Seedance", "生成教学视频镜头", "根据分镜提示及可用参考素材生成短视频镜头，可按设置请求生成音频。", [av], ["生成"], [], ["general/interdisciplinary"], {
    status: "implemented", url: "https://www.volcengine.com/product/seedance", license: "火山方舟 API 服务，按账户与服务条款使用",
    boundary: "已接入镜头视频提交、轮询和转存；需要可用的视频模型配置、凭证与上游服务，完整长片由 FFmpeg 另行合成。",
    evidence: "education-video-http.js video 路由 → education-video-service.js#generateSceneVideo / pollTask → ark-media-client.js#createVideoTask / getVideoTask；education-runtime-model-clients.js video_generation 配置", keywords: ["视频生成", "文生视频", "图生视频", "分镜", "火山方舟"]
  }),
  technology("MediaRecorder", "录下画布演示", "把交互演示录制为可下载的视频。", [av], ["导出"], [], ["general/interdisciplinary"], {
    status: "implemented", url: "https://www.w3.org/TR/mediastream-recording/", license: "Web 标准",
    boundary: "当前录制画布并导出 WebM；取决于浏览器 captureStream、编码与 MediaRecorder 支持。",
    evidence: "public/interactive-lesson-lab.js#toggleCanvasRecording", keywords: ["录像", "WebM", "录制"]
  }),
  technology("FFmpeg", "合成与导出教学视频", "把教学镜头及音轨合成完整的视频文件。", [av], ["编辑", "导出"], [], ["general/interdisciplinary"], {
    status: "implemented", url: "https://ffmpeg.org/", license: "FFmpeg LGPL/GPL；本地 ffmpeg-static GPL-3.0-or-later",
    boundary: "已连接服务端视频合成；实际可用由服务端合成器检测决定。它不替代数学动画或镜头生成。",
    evidence: "education-video-http.js POST compose → education-video-service.js#composeProject → ffmpeg-static", keywords: ["视频", "转码", "合成", "字幕"]
  }),
  technology("Pi Agent Core", "教学任务编排", "管理 Agent 状态、工具调用与事件轨迹。", [base], ["生成", "编排"], [], [], {
    status: "implemented", group: "foundation", url: "https://github.com/earendil-works/pi", boundary: "已接入教学与学习 Agent；实际生成需要可用模型配置。", evidence: "pi-teaching-agent.js；pi-learning-agent.js", keywords: ["Agent", "工具调用"]
  }),
  technology("TypeBox", "工具参数约束", "为工具参数建立 Schema，约束字段与类型。", [base], ["校验"], [], [], {
    status: "implemented", group: "foundation", url: "https://github.com/sinclairzx81/typebox", boundary: "已用于工具参数；结构合法不等于教学结论正确。", evidence: "pi-teaching-agent.js PUBLISH_LESSON_SCHEMA；pi-learning-agent.js", keywords: ["Schema", "校验"]
  }),
  technology("Lesson DSL", "受控课件协议", "在生成内容和确定性播放器之间传递结构化教学参数。", [base], ["编排", "校验", "导出"], [], [], {
    status: "implemented", group: "foundation", license: "项目自研", boundary: "只支持当前合同与播放器定义的课件族和预设。", evidence: "interactive-lesson-contract.js；pi-teaching-agent.js；public/interactive-lesson-lab.js", keywords: ["DSL", "协议"]
  }),
  technology("JSON Schema", "结构化输出协议", "声明字段、范围和嵌套结构，供工具与模型接口使用。", [base], ["校验"], [], [], {
    status: "implemented", group: "foundation", url: "https://json-schema.org/", license: "开放规范", boundary: "已作为 Schema 协议使用；这不等于单独安装了完整通用 JSON Schema 验证器。", evidence: "pi-teaching-agent.js TypeBox 工具 Schema；source-bridges/deeptutor/bridge.py response_format", keywords: ["Schema", "协议", "约束"]
  }),
  technology("JSXGraph", "可拖拽的动态几何", "构造几何对象、轨迹与测量，保持对象之间的约束关系。", [flat, graph], ["编辑", "渲染"], [M], ["math/geometry", "math/functions"], { url: "https://github.com/jsxgraph/jsxgraph", license: "MIT 或 LGPL-3.0+", keywords: ["2D", "几何", "轨迹", "约束"] }),
  technology("GeoGebra Integration", "高级作图与代数探索", "嵌入几何、代数、CAS 与三维数学应用。", [flat, space, graph], ["编辑", "渲染"], [M], ["math/algebra", "math/functions", "math/geometry"], { url: "https://github.com/geogebra/integration", license: "集成代码与应用条款分别核查", boundary: "未接入；集成仓库不能代替 GeoGebra 应用与素材的商业使用授权。", keywords: ["2D", "3D", "CAS", "几何"] }),
  technology("Mafs", "交互数学组件", "用 React 组织函数图、向量与可拖拽的点。", [flat, graph], ["编辑", "渲染"], [M], ["math/functions", "math/geometry"], { url: "https://github.com/stevenpetryk/mafs", keywords: ["React", "函数"] }),
  technology("MathLive", "可输入的数学公式", "提供数学输入框、虚拟键盘和结构化公式。", [doc], ["编辑", "渲染"], [M, P, C], ["math/algebra"], { url: "https://github.com/arnog/mathlive", keywords: ["公式", "MathJSON", "键盘"] }),
  technology("Math.js", "表达式与单位计算", "解析表达式，处理单位和数值运算。", [base], ["校验"], [M, P, C], ["math/numbers", "math/algebra"], { group: "foundation", url: "https://github.com/josdejong/mathjs", license: "Apache-2.0", boundary: "未接入；数值计算不等于通用符号证明或教学正确性验证。" }),
  technology("Rapier", "二维与三维物理求解", "为更复杂的刚体场景提供 Rust/WASM 物理计算。", [flat, space], ["仿真"], [P], ["physics/mechanics"], { url: "https://github.com/dimforge/rapier", license: "Apache-2.0", keywords: ["2D", "3D", "WASM", "刚体"] }),
  technology("CircuitJS1", "交互电路仿真", "调整器件参数，观察电流、电压与示波器波形。", [flat, graph], ["编辑", "仿真", "渲染"], [P], ["physics/electricity"], { url: "https://github.com/sharpie7/circuitjs1", license: "GPL-2.0", keywords: ["电路", "电学"] }),
  technology("PhET Simulations", "学科交互仿真", "参考或集成已有的数学与科学交互实验。", [flat, space, graph], ["仿真", "渲染"], [M, P, C, B, "科学"], ["science/inquiry"], { url: "https://github.com/phetsims", license: "逐个仿真、代码与素材核查", boundary: "未接入；组织内工具仓库的许可证不能代表所有仿真与素材。", keywords: ["实验", "仿真"] }),
  technology("PixiJS", "复杂二维现象动画", "用高性能二维渲染组织粒子、气泡和动画对象。", [flat], ["渲染"], [], ["chemistry/reactions", "science/inquiry"], { url: "https://github.com/pixijs/pixijs", boundary: "未接入；这是渲染器，化学与物理规律仍需单独建模。", keywords: ["2D", "粒子", "动画"] }),
  technology("XState", "实验流程与状态控制", "描述实验步骤、状态转换及异常分支。", [base], ["编排"], [], ["chemistry/experiments", "science/inquiry"], { group: "foundation", url: "https://github.com/statelyai/xstate", keywords: ["状态机", "流程"] }),
  technology("3Dmol.js", "分子结构浏览", "显示分子、表面和原子选择。", [space], ["渲染"], [C, B], ["chemistry/substances", "biology/organisms"], { url: "https://github.com/3dmol/3Dmol.js", license: "BSD-3-Clause，含第三方声明", keywords: ["3D", "分子"] }),
  technology("Mol*", "大分子与蛋白质结构", "浏览大型分子结构、蛋白质和实验结构数据。", [space, graph], ["渲染"], [C, B], ["chemistry/substances", "biology/organisms"], { url: "https://github.com/molstar/molstar", keywords: ["3D", "蛋白质", "晶体"] }),
  technology("RDKit.js", "化学结构分析", "计算分子指纹、匹配子结构并绘制化学结构。", [flat, graph], ["渲染", "校验"], [C], ["chemistry/substances", "chemistry/reactions"], { url: "https://github.com/rdkit/rdkit-js", license: "BSD-3-Clause", keywords: ["分子", "指纹", "子结构"] }),
  technology("Kekule.js", "化学结构编辑", "编辑化学结构，并以二维或三维方式呈现。", [flat, space], ["编辑", "渲染"], [C], ["chemistry/substances", "chemistry/reactions"], { url: "https://github.com/partridgejiang/Kekule.js", keywords: ["2D", "3D", "结构式"] }),
  technology("Manim", "数学推导动画", "将公式变换、几何证明和数学对象组织成精确动画。", [flat, space, av], ["生成", "渲染", "导出"], [M, P], ["math/algebra", "math/functions", "math/geometry"], { url: "https://github.com/ManimCommunity/manim", boundary: "DeepTutor 源码含可选 math-animator 依赖，但当前主应用 Book Engine 桥未接入该能力。", evidence: "third_party/deeptutor/requirements/math-animator.txt；主应用无该能力入口", keywords: ["2D", "3D", "Python", "数学视频"] }),
  technology("Remotion", "可编程教学视频", "用 React 时间轴组织画面、字幕与模板化视频。", [flat, av], ["编辑", "渲染", "导出"], [], ["general/interdisciplinary"], { url: "https://github.com/remotion-dev/remotion", license: "Remotion 专有许可，按主体和版本核查", keywords: ["React", "时间轴", "字幕"] }),
  technology("Motion Canvas", "程序化讲解动画", "用 TypeScript 生成同步解说的二维矢量动画。", [flat, av], ["编辑", "渲染", "导出"], [], ["general/interdisciplinary"], { url: "https://github.com/motion-canvas/motion-canvas", keywords: ["TypeScript", "动画", "时间轴"] }),
  technology("Revideo", "代码驱动视频模板", "通过 TypeScript 场景与预览组件制作可复用视频。", [flat, av], ["编辑", "渲染", "导出"], [], ["general/interdisciplinary"], { url: "https://github.com/midrender/revideo", boundary: "未接入；上游已迁至 midrender/revideo，核对时未归档。", keywords: ["TypeScript", "视频", "模板"] }),
  technology("Mermaid", "文字描述的结构图", "用文本描述流程、关系、状态与时间线。", [flat, graph, doc], ["渲染"], [], ["general/interdisciplinary"], { status: "existing", url: "https://github.com/mermaid-js/mermaid", boundary: "DeepTutor Web 子项目含依赖；主应用当前未加载 Mermaid 库，生成 Mermaid 文本不等于已渲染。", evidence: "third_party/deeptutor/web/package.json；source-techniques/deeptutor-adapter.js#renderDeepTutorMermaid", keywords: ["流程图", "因果", "时间线"] }),
  technology("Markmap", "Markdown 思维导图", "把 Markdown 层级转换成交互式思维导图。", [flat, doc], ["渲染"], [], ["general/interdisciplinary"], { url: "https://github.com/markmap/markmap", keywords: ["Markdown", "思维导图"] }),
  technology("React Flow", "可编辑的节点与连线", "搭建节点编辑、连接和自定义图编辑交互。", [flat, graph], ["编辑", "渲染"], [], ["general/interdisciplinary"], { url: "https://github.com/xyflow/xyflow", keywords: ["React", "节点", "流程编辑"] }),
  technology("Excalidraw", "教学白板与批注", "制作手绘风图解，支持编辑与师生共创。", [flat, doc], ["编辑", "渲染", "导出"], [], ["general/interdisciplinary"], { url: "https://github.com/excalidraw/excalidraw", keywords: ["白板", "批注"] }),
  technology("Tiptap", "结构化富文本创作", "在文档中组织文本、公式与可扩展内容块。", [doc], ["编辑", "渲染"], [], ["general/interdisciplinary"], { url: "https://github.com/ueberdosis/tiptap", license: "核心 MIT；扩展和服务分别核查", keywords: ["编辑器", "文档"] }),
  technology("BlockNote", "块式教材编辑", "拖拽和组织文档块，构建 Notion 式内容编辑体验。", [doc], ["编辑", "渲染"], [], ["general/interdisciplinary"], { url: "https://github.com/TypeCellOS/BlockNote", license: "核心 MPL-2.0；XL 为 GPL-3.0 或商业许可", keywords: ["块编辑", "文档"] }),
  technology("H5P", "可打包的互动内容", "采用交互题型、内容包与 LMS 集成方式。", [flat, doc, av], ["编辑", "渲染", "导出"], [], ["general/interdisciplinary"], { url: "https://github.com/h5p", license: "按核心、内容类型和素材逐项核查", keywords: ["LMS", "题型", "互动视频"] }),
  technology("Playwright", "交互与页面验证", "自动检查页面操作、截图与导出流程。", [base], ["校验"], [], [], { status: "existing", group: "foundation", url: "https://github.com/microsoft/playwright", license: "Apache-2.0", boundary: "上游子项目有测试依赖；不是向教师开放的内容生产功能。", evidence: "third_party/openmaic/package.json；third_party/deeptutor/web/package.json", keywords: ["测试", "截图", "浏览器"] })
]);

export function filterTechnologies(items, filters = {}) {
  const query = String(filters.query || "").trim().toLocaleLowerCase();
  const any = (selected, values) => !selected?.length || selected.some(value => values.includes(value));
  return items.filter(item => {
    if (filters.status && item.status !== filters.status) return false;
    if (!any(filters.effects, item.effects) || !any(filters.capabilities, item.capabilities)) return false;
    if (filters.subjects?.length && item.subjects.length && !any(filters.subjects, item.subjects)) return false;
    if (filters.topics?.length && !item.topics.includes("general/interdisciplinary") && !any(filters.topics, item.topics)) return false;
    if (!query) return true;
    return [item.name, item.title, item.scenario, item.license, ...item.effects, ...item.capabilities,
      ...item.subjects, ...item.topics, ...item.topics.map(getTopicLabel), ...item.keywords].join(" ").toLocaleLowerCase().includes(query);
  });
}

export function groupTechnologies(items) {
  return {
    teaching: items.filter(item => item.status === "implemented" && item.group === "teaching"),
    alternatives: items.filter(item => item.status !== "implemented"),
    foundation: items.filter(item => item.status === "implemented" && item.group === "foundation")
  };
}
