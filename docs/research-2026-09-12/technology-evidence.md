# 教学技术目录：当前调用证据与选型边界

核对日期：2026-09-12。范围：主应用 public/technology-landscape.js 的原 42 项、package.json、第三方源码与当前 HTTP/播放器调用链。本轮补入实际已有的 SVG 几何、Cell Architecture Studio、Seedream 图像生成和 Seedance 视频生成，共 46 项。

## 结论与证据口径

目录改为教学效果、能力职责、适用学科、知识主题四个独立的多值维度；接入状态独立筛选。二维/三维是效果维度，不能替代技术职责、学科或实际状态。一个技术可以同时产生多种效果，也可以适用于多个领域。这里的“教学效果”指呈现形式与可操作能力，不指经过实验证明的学习增益。

- 已接入：主应用存在可达调用及所需本地实现/依赖。模型服务、WebGL、浏览器录像或 FFmpeg 仍可能受当前运行条件影响；不宣称实时在线。
- 源码已纳入：第三方子项目已有代码或依赖，但没有足够证据证明教师主应用已开放该能力。
- 待接入：目录选型。Manim 虽存在 DeepTutor 的可选 requirements，主应用当前 Book Engine 桥不调用它，所以仍属待接入。
- 跨学科：文档、图、视频等通用载体/编排能力，不把基础工具强绑一个学科，也不意味着每个学科已有专门教学模型。

当前默认主目录只呈现 16 项已接入教学能力；26 项待接入或仅纳入源码的技术进入“备选方案”；4 项已接入协议和基础工具独立折叠。没有卸载依赖、删除运行时或声称其他项目不优秀。

## 明确纠正的状态与来源

| 项目 | 原目录 | 本轮结论 | 实际依据 |
| --- | --- | --- | --- |
| KaTeX | 候选 | 已接入公式渲染 | public/index.html 本地脚本；public/agent-answer-renderer.js 的 renderMathInto 调用 katex.render |
| Three.js | 项目已有 | 已接入三维查看器 | server.js 提供模块；public/knowledge-spatial-viewer.js 动态加载并创建 WebGLRenderer、场景与 Raycaster；素材工坊挂载 |
| G6 / ECharts | 项目已有 | 已接入 | public/knowledge-visualizations.js 的 renderStructure、renderDependency、renderMastery 分别创建 G6 图和 ECharts 实例 |
| FFmpeg | 候选 | 已接入服务端合成 | education-video-http.js 的 compose 路由 → education-video-service.js 的 composeProject → ffmpeg-static / 命令 |
| Seedream | 未收录 | 已接入镜头图片生成与转存；需要模型配置和上游可用 | image 路由 → generateSceneImage → 运行时 Ark 客户端 generateImage → images/generations；成功输出转存为镜头图片资产 |
| Seedance | 未收录 | 已接入逐镜头视频生成与转存；需要模型配置和上游可用 | video 路由 → generateSceneVideo → createVideoTask；pollTask → getVideoTask；成功输出转存为镜头视频资产 |
| OpenMAIC / DeepTutor | 项目已有 | 已接入官方源码生成桥；生成需模型 | server.js 注入 generateSourceTechniqueMaterial；source-technique-pipeline.js 分派到 source-bridges/ 中的官方执行桥 |
| SVG | 未收录 | 已接入受限几何预设 | public/courseware-geometry.js 调用 interactive-visual-renderer；不是 JSXGraph 的调用 |
| Cell Architecture Studio | 未收录 | 已接入受限细胞适配 | source-techniques/cell-studio-adapter.js → material studio → Three.js viewer |
| Mermaid / Playwright | 候选 | 源码已纳入，保留备选/验证边界 | third_party/deeptutor/web/package.json 与 third_party/openmaic/package.json；主应用没有 Mermaid 前端脚本入口 |
| JSON Schema | 候选 | 已用作协议，归基础能力 | TypeBox 工具 Schema 与 DeepTutor RPC 的 json_schema 输出格式；不等于安装完整通用验证器 |
| Planck.js | shakacode/planck.js | 修正为 piqnt/planck.js | 前链接本轮 HTTP 404；已安装 planck 1.4.2 的 package.json 指向 piqnt/planck.js，官方 README 可读取 |
| RDKit.js | rdkit/rdkit | 修正为 rdkit/rdkit-js | 官方 JS 项目提供 RDKit 化学信息学及分子绘制接口 |
| Revideo | redotvideo/revideo | 修正为 midrender/revideo | GitHub API 重定向到现名称，archived=false；不按历史 fork 印象判断 |

注意：knowledge-material-pipeline.js 已明确注释为旧的模型结构化生成/兼容校验链；server.js 当前导入 source-technique-pipeline.js。不能用旧文件中的 inspired 或本地重实现描述覆盖新的官方源码执行桥。OpenMAIC 当前桥固定 revision fcdb6d62b380c066de2a4733910669c9e697b83a；DeepTutor 固定 47d05809ea5d19e8b1390d4b42402302c37709bb。

## 全量多维矩阵

以下为代码核对时的能力目录，不是网络健康检查。知识主题复用 public/courseware-taxonomy.js。

| 技术 | 状态/分组 | 教学效果 | 能力职责 | 学科 | 主题 | 适用边界 |
| --- | --- | --- | --- | --- | --- | --- |
| SVG | 已接入／教学能力 | 二维图解、图表与数据 | 渲染、编辑、导出 | 数学 | 几何 | 当前支持直角三角形、圆与扇形预设；尚不支持任意几何作图与约束求解。 |
| Canvas 2D | 已接入／教学能力 | 二维图解、图表与数据 | 渲染 | 数学、物理、化学 | 函数、力与运动、化学反应 | 覆盖已有函数、抛体和酸碱等受控预设；画布绘制本身不负责科学求解。 |
| Matter.js | 已接入／教学能力 | 二维图解、图表与数据 | 仿真、渲染 | 物理 | 力与运动 | 本项目已接入三个力学预设和固定步长；不代表任意物理实验都已建模。 |
| Planck.js | 已接入／教学能力 | 二维图解、图表与数据 | 仿真、渲染 | 物理 | 力与运动 | 与 Matter.js 均有真实调用和显式切换；当前安装版本为 1.4.2。 |
| Three.js | 已接入／教学能力 | 三维空间 | 渲染 | 跨学科 | 跨学科探究 | 已有知识空间与细胞场景查看器；不提供通用文字生成 3D 或物理求解。 |
| Cell Architecture Studio | 已接入／教学能力 | 三维空间、结构化文档 | 生成、渲染 | 生物 | 生命与结构 | 确定性适配七类官方细胞标本的数据与程序化几何；不支持任意知识点生成 3D，不使用上游二进制素材。 |
| Apache ECharts | 已接入／教学能力 | 图表与数据、二维图解 | 渲染 | 跨学科 | 统计与概率、跨学科探究 | 已有知识掌握度图表调用；更多图表类型仍需教学数据和对应配置。 |
| AntV G6 | 已接入／教学能力 | 二维图解、图表与数据 | 渲染 | 跨学科 | 跨学科探究 | 已用于知识导图和依赖图；图布局不能证明知识关系本身正确。 |
| KaTeX | 已接入／教学能力 | 结构化文档、二维图解 | 渲染 | 数学、物理、化学 | 代数与方程、函数、力与运动、化学反应 | 负责公式排版，不提供公式编辑、代数求解或正确性判断。 |
| DeepTutor | 已接入／教学能力 | 结构化文档、二维图解、图表与数据 | 生成、编排、渲染 | 跨学科 | 跨学科探究 | 已连接固定版本官方 Book Engine；生成需配置模型。本目录不代表其全部 Agent、Manim 等能力均已接入。 |
| OpenMAIC | 已接入／教学能力 | 结构化文档、二维图解、图表与数据 | 生成、编排、渲染 | 跨学科 | 跨学科探究 | 已连接固定版本官方生成管线与场景渲染器；生成需配置模型，不代表所有上游媒体服务已配置。 |
| Koji-style | 已接入／教学能力 | 结构化文档 | 生成、编排、渲染 | 跨学科 | 跨学科探究 | 本项目原创状态与提示逻辑；未使用 Koji 源码，也不表示已验证教学效果。 |
| Seedream | 已接入／教学能力 | 二维图解 | 生成 | 跨学科 | 跨学科探究 | 已接入图片生成与转存；需要可用的图像模型配置、凭证与上游服务，教材文字和科学细节需核对。 |
| Seedance | 已接入／教学能力 | 音视频 | 生成 | 跨学科 | 跨学科探究 | 已接入镜头视频提交、轮询和转存；需要可用的视频模型配置、凭证与上游服务，完整长片由 FFmpeg 另行合成。 |
| MediaRecorder | 已接入／教学能力 | 音视频 | 导出 | 跨学科 | 跨学科探究 | 当前录制画布并导出 WebM；取决于浏览器 captureStream、编码与 MediaRecorder 支持。 |
| FFmpeg | 已接入／教学能力 | 音视频 | 编辑、导出 | 跨学科 | 跨学科探究 | 已连接服务端视频合成；实际可用由服务端合成器检测决定。它不替代数学动画或镜头生成。 |
| Pi Agent Core | 已接入／基础能力 | 基础能力 | 生成、编排 | 跨学科 | 通用协议/工具 | 已接入教学与学习 Agent；实际生成需要可用模型配置。 |
| TypeBox | 已接入／基础能力 | 基础能力 | 校验 | 跨学科 | 通用协议/工具 | 已用于工具参数；结构合法不等于教学结论正确。 |
| Lesson DSL | 已接入／基础能力 | 基础能力 | 编排、校验、导出 | 跨学科 | 通用协议/工具 | 只支持当前合同与播放器定义的课件族和预设。 |
| JSON Schema | 已接入／基础能力 | 基础能力 | 校验 | 跨学科 | 通用协议/工具 | 已作为 Schema 协议使用；这不等于单独安装了完整通用 JSON Schema 验证器。 |
| JSXGraph | 待接入／备选方案 | 二维图解、图表与数据 | 编辑、渲染 | 数学 | 几何、函数 | 当前应用尚未接入，需完成适配与验证后使用。 |
| GeoGebra Integration | 待接入／备选方案 | 二维图解、三维空间、图表与数据 | 编辑、渲染 | 数学 | 代数与方程、函数、几何 | 未接入；集成仓库不能代替 GeoGebra 应用与素材的商业使用授权。 |
| Mafs | 待接入／备选方案 | 二维图解、图表与数据 | 编辑、渲染 | 数学 | 函数、几何 | 当前应用尚未接入，需完成适配与验证后使用。 |
| MathLive | 待接入／备选方案 | 结构化文档 | 编辑、渲染 | 数学、物理、化学 | 代数与方程 | 当前应用尚未接入，需完成适配与验证后使用。 |
| Math.js | 待接入／基础能力 | 基础能力 | 校验 | 数学、物理、化学 | 数与运算、代数与方程 | 未接入；数值计算不等于通用符号证明或教学正确性验证。 |
| Rapier | 待接入／备选方案 | 二维图解、三维空间 | 仿真 | 物理 | 力与运动 | 当前应用尚未接入，需完成适配与验证后使用。 |
| CircuitJS1 | 待接入／备选方案 | 二维图解、图表与数据 | 编辑、仿真、渲染 | 物理 | 电与磁 | 当前应用尚未接入，需完成适配与验证后使用。 |
| PhET Simulations | 待接入／备选方案 | 二维图解、三维空间、图表与数据 | 仿真、渲染 | 数学、物理、化学、生物、科学 | 科学探究 | 未接入；组织内工具仓库的许可证不能代表所有仿真与素材。 |
| PixiJS | 待接入／备选方案 | 二维图解 | 渲染 | 跨学科 | 化学反应、科学探究 | 未接入；这是渲染器，化学与物理规律仍需单独建模。 |
| XState | 待接入／基础能力 | 基础能力 | 编排 | 跨学科 | 实验方法、科学探究 | 当前应用尚未接入，需完成适配与验证后使用。 |
| 3Dmol.js | 待接入／备选方案 | 三维空间 | 渲染 | 化学、生物 | 物质与结构、生命与结构 | 当前应用尚未接入，需完成适配与验证后使用。 |
| Mol* | 待接入／备选方案 | 三维空间、图表与数据 | 渲染 | 化学、生物 | 物质与结构、生命与结构 | 当前应用尚未接入，需完成适配与验证后使用。 |
| RDKit.js | 待接入／备选方案 | 二维图解、图表与数据 | 渲染、校验 | 化学 | 物质与结构、化学反应 | 当前应用尚未接入，需完成适配与验证后使用。 |
| Kekule.js | 待接入／备选方案 | 二维图解、三维空间 | 编辑、渲染 | 化学 | 物质与结构、化学反应 | 当前应用尚未接入，需完成适配与验证后使用。 |
| Manim | 待接入／备选方案 | 二维图解、三维空间、音视频 | 生成、渲染、导出 | 数学、物理 | 代数与方程、函数、几何 | DeepTutor 源码含可选 math-animator 依赖，但当前主应用 Book Engine 桥未接入该能力。 |
| Remotion | 待接入／备选方案 | 二维图解、音视频 | 编辑、渲染、导出 | 跨学科 | 跨学科探究 | 当前应用尚未接入，需完成适配与验证后使用。 |
| Motion Canvas | 待接入／备选方案 | 二维图解、音视频 | 编辑、渲染、导出 | 跨学科 | 跨学科探究 | 当前应用尚未接入，需完成适配与验证后使用。 |
| Revideo | 待接入／备选方案 | 二维图解、音视频 | 编辑、渲染、导出 | 跨学科 | 跨学科探究 | 未接入；上游已迁至 midrender/revideo，核对时未归档。 |
| Mermaid | 源码已纳入／备选方案 | 二维图解、图表与数据、结构化文档 | 渲染 | 跨学科 | 跨学科探究 | DeepTutor Web 子项目含依赖；主应用当前未加载 Mermaid 库，生成 Mermaid 文本不等于已渲染。 |
| Markmap | 待接入／备选方案 | 二维图解、结构化文档 | 渲染 | 跨学科 | 跨学科探究 | 当前应用尚未接入，需完成适配与验证后使用。 |
| React Flow | 待接入／备选方案 | 二维图解、图表与数据 | 编辑、渲染 | 跨学科 | 跨学科探究 | 当前应用尚未接入，需完成适配与验证后使用。 |
| Excalidraw | 待接入／备选方案 | 二维图解、结构化文档 | 编辑、渲染、导出 | 跨学科 | 跨学科探究 | 当前应用尚未接入，需完成适配与验证后使用。 |
| Tiptap | 待接入／备选方案 | 结构化文档 | 编辑、渲染 | 跨学科 | 跨学科探究 | 当前应用尚未接入，需完成适配与验证后使用。 |
| BlockNote | 待接入／备选方案 | 结构化文档 | 编辑、渲染 | 跨学科 | 跨学科探究 | 当前应用尚未接入，需完成适配与验证后使用。 |
| H5P | 待接入／备选方案 | 二维图解、结构化文档、音视频 | 编辑、渲染、导出 | 跨学科 | 跨学科探究 | 当前应用尚未接入，需完成适配与验证后使用。 |
| Playwright | 源码已纳入／基础能力 | 基础能力 | 校验 | 跨学科 | 通用协议/工具 | 上游子项目有测试依赖；不是向教师开放的内容生产功能。 |

## 官方能力对比与项目决策

| 对比 | 官方资料支持的区别 | 本项目决定 |
| --- | --- | --- |
| Three.js / Babylon.js | Three.js 是通用 3D library，README 描述 WebGL/WebGPU 及插件渲染；Babylon 官方仓库定位 game and rendering engine。两者都能做三维，不能推出全部引擎、编辑器与生态能力相同。 | Three.js 已承载当前空间/细胞查看器，暂不再引入另一套三维引擎。Babylon 不在原目录，仅记录对比，不评价其优劣。 |
| Matter.js / Planck.js | Matter 明确为 2D rigid body physics engine；Planck README 明确为 Box2D 的 JS/TS 重写。共同覆盖二维刚体，求解实现与 API 不同。 | 两者已有真实世界创建、切换和离线打包链；保留。仅因功能重叠不足以删除可用引擎。 |
| D3 / ECharts / Plotly | D3 是 SVG/Canvas/HTML 数据可视化工具集；ECharts 面向交互图表；Plotly 为科学/统计图表库。官方职责都不等于通用几何约束求解。 | 已有 ECharts/G6，当前统计与知识图采用现有栈。D3/Plotly 不新增主目录；新场景达到现有栈边界时再选型。 |
| JSXGraph / GeoGebra / 当前 SVG | JSXGraph README 包含交互几何、函数图和测量；GeoGebra Integration 是部署/嵌入应用的入口。当前主应用 SVG 仅有直角三角形、圆与扇形等受控预设。 | JSXGraph/GeoGebra 保留备选，不能因新几何预设已出现就标已接入，或声称 SVG 已完整替代高级作图/CAS。 |
| Manim / Remotion / FFmpeg | Manim 是 Python 数学动画框架；Remotion 用 React 编排可编程视频；FFmpeg 负责音视频处理和编码封装。 | FFmpeg 已接入镜头合成；Manim/Remotion 仍备选。FFmpeg 合成能力不能替代公式变换设计、数学对象动画或 React 时间轴。 |
| Seedream / Seedance / FFmpeg | 本地代码分别调用图像生成 API、视频生成任务 API 与本地音视频合成器；模型生成和片段合成的输入、返回及状态机不同。 | Seedream 负责教学画面，Seedance 负责短视频镜头，FFmpeg 合成完整长片。三者均有主应用可达调用，但模型凭证、权限和上游可用性需另行满足；本次未跑真实生成。 |
| Motion Canvas / Revideo | Motion Canvas README 是 TypeScript 的 generator-based 矢量动画及实时编辑器。当前 Revideo README 描述代码视频模板、React 预览和借鉴 Remotion/Rive，core zero-dep。两仓库 API 均 archived=false。 | 均放入备选方案；没有足够当前证据说明任一已归档或可被本项目已选运行时完整替代。未归档只表示仓库开关状态，不证明维护响应或商业 SLA。 |
| OpenMAIC / DeepTutor / Cell | OpenMAIC 官方源码桥运行 runGenerationPipeline 并返回 Stage/Scene/Slide/Quiz/Action；DeepTutor 桥执行 BookEngine/SpineSynthesizer/BookCompiler；Cell 官方项目是七种细胞标本画廊。 | 三种输出与学科边界不同，均保留。Cell 是数据与程序化几何适配而非运行其整个 React 应用；不宣称通用文本转 3D。 |
| G6 / Markmap / React Flow | G6 已用于知识关系布局；Markmap 针对 Markdown 层级转换；React Flow 侧重节点编辑交互。 | 没有核对到主应用完整覆盖 Markdown 转换和自定义编辑契约的证据，所以后两者留作备选。 |
| Tiptap / BlockNote | BlockNote 官方仓库说明其建立在 ProseMirror/Tiptap 之上，提供块式编辑体验；Tiptap 为无头富文本框架。 | 有架构层的重叠，但未选定主应用编辑器及完整需求，不断言任选一个都能无成本替代另一个。 |

## 主推荐目录的收敛规则

本轮从默认主目录移出的 26 项属于尚未开放的供给，不按“优秀/不优秀”或 stars 排序，也不删除研究入口。搜索候选技术、选择候选状态或没有已接入匹配结果时，会展开对应备选内容。

完全移除候选的条件应同时满足：主应用未依赖它；本项目已选技术已覆盖其被推荐的完整需求；没有尚需保留的编辑/求解/许可证或交付差异。本轮没有足够证据支持把任何一项宣告为“完全冗余”后彻底删除。保留所有真实运行依赖。

## 许可证的必要边界

- JSXGraph：GitHub 自动识别为 LGPL，但官方 README 明确 MIT 或 LGPL 双许可；页面保留双许可，不能单靠 API 自动值下结论。
- GeoGebra：官方 license 页面明确区分非商业与商业用途；商业用途需要相应许可。Integration 仓库代码不能替代软件和素材授权。
- Remotion：当前 LICENSE.md 是按使用主体/规模等区分免费与公司许可的特殊条款，并提示版本变动；本页不将其标为 MIT 或普遍可商用。
- BlockNote：官方 README 说明大部分核心为 MPL-2.0，XL 包为 GPL-3.0 或商业许可；不能以核心许可证覆盖全部扩展。
- FFmpeg：官方 legal 页面说明 LGPL-2.1+，可选 GPL 组件改变整体许可；本地 ffmpeg-static 5.3.0 的包装包 metadata 为 GPL-3.0-or-later。实际分发仍需查看构建与所带编码器。
- Cell：上游应用代码 MIT，但 GLB、PNG 等素材保留独立来源；本地 adapter notice 明确不复制这些二进制资产。
- PhET / H5P：组织中仓库、内容类型和素材不同，必须按最终集成对象核查；PhET chipper 的 MIT 不能代表所有仿真。
- 其余备选条款保留项目公开目录标注，未在本轮对每个插件、传递依赖和资产做法律审计。

## 本地调用依据

| 技术 | 当前依据 | 官方入口 | 许可范围 |
| --- | --- | --- | --- |
| SVG | public/courseware-geometry.js → public/interactive-visual-renderer.js | <https://www.w3.org/TR/SVG2/> | Web 标准 |
| Canvas 2D | public/interactive-lesson-lab.js LessonPlayer；public/physics-lesson-runtime.js | <https://html.spec.whatwg.org/multipage/canvas.html> | Web 标准 |
| Matter.js | public/physics-lesson-runtime.js#createMatterWorld；public/physics-lesson-player.js | <https://github.com/liabru/matter-js> | MIT |
| Planck.js | public/physics-lesson-runtime.js#createPlanckWorld；package.json | <https://github.com/piqnt/planck.js> | MIT |
| Three.js | public/knowledge-spatial-viewer.js#mountKnowledgeSpatialViewer；server.js /vendor/three.module.js | <https://github.com/mrdoob/three.js> | MIT |
| Cell Architecture Studio | source-techniques/cell-studio-adapter.js → public/knowledge-material-studio.js#renderCellStudio → knowledge-spatial-viewer.js | <https://github.com/cclank/cell-architecture-studio> | MIT |
| Apache ECharts | public/knowledge-visualizations.js#renderMastery；public/index.html 本地 ECharts 脚本 | <https://github.com/apache/echarts> | Apache-2.0 |
| AntV G6 | public/knowledge-visualizations.js#renderStructure / renderDependency；new G6.Graph | <https://github.com/antvis/G6> | MIT |
| KaTeX | public/agent-answer-renderer.js#renderMathInto → katex.render；public/index.html 本地 KaTeX | <https://github.com/KaTeX/KaTeX> | MIT |
| DeepTutor | source-technique-pipeline.js → source-bridges/deeptutor/index.js → bridge.py → third_party/deeptutor/deeptutor/book | <https://github.com/HKUDS/DeepTutor> | Apache-2.0 |
| OpenMAIC | source-technique-pipeline.js → source-bridges/openmaic/official-worker.ts → runGenerationPipeline；public/knowledge-material-studio.js | <https://github.com/THU-MAIC/OpenMAIC> | MIT |
| Koji-style | source-techniques/koji-adapter.js；source-technique-pipeline.js；public/knowledge-material-studio.js | 项目内部 | 项目自研 |
| Seedream | education-video-http.js image 路由 → education-video-service.js#generateSceneImage → ark-media-client.js#generateImage；education-runtime-model-clients.js image_generation 配置 | 火山方舟 API 服务；本地 docs/教材视频讲解架构与协议-v1.md 和 ark-media-client.js 的 /images/generations 契约；无本轮取得的官方文档 URL，链接留空 | 云 API 服务，按账户与服务条款使用 |
| Seedance | education-video-http.js video 路由 → education-video-service.js#generateSceneVideo / pollTask → ark-media-client.js#createVideoTask / getVideoTask；education-runtime-model-clients.js video_generation 配置 | <https://www.volcengine.com/product/seedance>；仅作官方入口，能力依据为本地调用链 | 云 API 服务，按账户与服务条款使用 |
| MediaRecorder | public/interactive-lesson-lab.js#toggleCanvasRecording | <https://www.w3.org/TR/mediastream-recording/> | Web 标准 |
| FFmpeg | education-video-http.js POST compose → education-video-service.js#composeProject → ffmpeg-static | <https://ffmpeg.org/> | FFmpeg LGPL/GPL；本地 ffmpeg-static GPL-3.0-or-later |
| Pi Agent Core | pi-teaching-agent.js；pi-learning-agent.js | <https://github.com/earendil-works/pi> | MIT |
| TypeBox | pi-teaching-agent.js PUBLISH_LESSON_SCHEMA；pi-learning-agent.js | <https://github.com/sinclairzx81/typebox> | MIT |
| Lesson DSL | interactive-lesson-contract.js；pi-teaching-agent.js；public/interactive-lesson-lab.js | 项目内部 | 项目自研 |
| JSON Schema | pi-teaching-agent.js TypeBox 工具 Schema；source-bridges/deeptutor/bridge.py response_format | <https://json-schema.org/> | 开放规范 |
| JSXGraph | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/jsxgraph/jsxgraph> | MIT 或 LGPL-3.0+ |
| GeoGebra Integration | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/geogebra/integration> | 集成代码与应用条款分别核查 |
| Mafs | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/stevenpetryk/mafs> | MIT |
| MathLive | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/arnog/mathlive> | MIT |
| Math.js | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/josdejong/mathjs> | Apache-2.0 |
| Rapier | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/dimforge/rapier> | Apache-2.0 |
| CircuitJS1 | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/sharpie7/circuitjs1> | GPL-2.0 |
| PhET Simulations | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/phetsims> | 逐个仿真、代码与素材核查 |
| PixiJS | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/pixijs/pixijs> | MIT |
| XState | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/statelyai/xstate> | MIT |
| 3Dmol.js | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/3dmol/3Dmol.js> | BSD-3-Clause，含第三方声明 |
| Mol* | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/molstar/molstar> | MIT |
| RDKit.js | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/rdkit/rdkit-js> | BSD-3-Clause |
| Kekule.js | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/partridgejiang/Kekule.js> | MIT |
| Manim | third_party/deeptutor/requirements/math-animator.txt；主应用无该能力入口 | <https://github.com/ManimCommunity/manim> | MIT |
| Remotion | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/remotion-dev/remotion> | Remotion 专有许可，按主体和版本核查 |
| Motion Canvas | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/motion-canvas/motion-canvas> | MIT |
| Revideo | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/midrender/revideo> | MIT |
| Mermaid | third_party/deeptutor/web/package.json；source-techniques/deeptutor-adapter.js#renderDeepTutorMermaid | <https://github.com/mermaid-js/mermaid> | MIT |
| Markmap | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/markmap/markmap> | MIT |
| React Flow | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/xyflow/xyflow> | MIT |
| Excalidraw | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/excalidraw/excalidraw> | MIT |
| Tiptap | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/ueberdosis/tiptap> | 核心 MIT；扩展和服务分别核查 |
| BlockNote | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/TypeCellOS/BlockNote> | 核心 MPL-2.0；XL 为 GPL-3.0 或商业许可 |
| H5P | 主应用无依赖及可达调用链；候选研究。 | <https://github.com/h5p> | 按核心、内容类型和素材逐项核查 |
| Playwright | third_party/openmaic/package.json；third_party/deeptutor/web/package.json | <https://github.com/microsoft/playwright> | Apache-2.0 |

## 本轮官方来源记录

下载原始快照位于 docs/research-2026-09-12/source-snapshots/technology/。API 仓库元数据用于核对现名称、archived 和许可证自动识别；能力与许可判断优先读取 README/许可证正文。默认分支资料仅作为核对日期的来源，不替代项目实际固定版本。

媒体模型补录说明：本轮已访问 Seedance 官方产品入口 <https://www.volcengine.com/product/seedance>，仅取得页面壳（source-snapshots/volc-seedance.txt），没有用它推导模型细节。Seedream 没有本轮实际取得的官方文档 URL，因此不补猜测链接。两项“已接入”均来自实际本地链路核对：server.js 注入 createRuntimeArkMediaClient，education-video-http.js 开放图片/视频生成路由，education-video-service.js 提交任务、轮询并转存资产；ark-media-client.js 定义真实 API 请求；education-runtime-settings.js 与 .env.example 提供模型配置。代码默认模型名不是当前账号授权或可用性证据。本次没有调用模型、创建付费任务或宣称真实生成成功。

| 来源 | 日期 | 结果/范围 |
| --- | --- | --- |
| <https://api.github.com/repos/3dmol/3Dmol.js> | 2026-09-12 | 元数据；许可证自动识别 NOASSERTION；archived=false |
| <https://api.github.com/repos/BabylonJS/Babylon.js> | 2026-09-12 | 元数据；许可证自动识别 Apache-2.0；archived=false |
| <https://api.github.com/repos/FFmpeg/FFmpeg> | 2026-09-12 | 元数据；许可证自动识别 NOASSERTION；archived=false |
| <https://api.github.com/repos/HKUDS/DeepTutor> | 2026-09-12 | 元数据；许可证自动识别 Apache-2.0；archived=false |
| <https://api.github.com/repos/ManimCommunity/manim> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/THU-MAIC/OpenMAIC> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/TypeCellOS/BlockNote> | 2026-09-12 | 元数据；许可证自动识别 NOASSERTION；archived=false |
| <https://api.github.com/repos/apache/echarts> | 2026-09-12 | 元数据；许可证自动识别 Apache-2.0；archived=false |
| <https://api.github.com/repos/cclank/cell-architecture-studio> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/d3/d3> | 2026-09-12 | 元数据；许可证自动识别 ISC；archived=false |
| <https://api.github.com/repos/geogebra/integration> | 2026-09-12 | 元数据；许可证自动识别 无结论；archived=false |
| <https://api.github.com/repos/jsxgraph/jsxgraph> | 2026-09-12 | 元数据；许可证自动识别 LGPL-3.0；archived=false |
| <https://api.github.com/repos/liabru/matter-js> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/molstar/molstar> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/motion-canvas/motion-canvas> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/mrdoob/three.js> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/partridgejiang/Kekule.js> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/phetsims/chipper> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/plotly/plotly.js> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/rdkit/rdkit-js> | 2026-09-12 | 元数据；许可证自动识别 BSD-3-Clause；archived=false |
| <https://api.github.com/repos/redotvideo/revideo> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/remotion-dev/remotion> | 2026-09-12 | 元数据；许可证自动识别 NOASSERTION；archived=false |
| <https://api.github.com/repos/shakacode/planck.js> | 2026-09-12 | HTTP Error 404: Not Found |
| <https://api.github.com/repos/sharpie7/circuitjs1> | 2026-09-12 | 元数据；许可证自动识别 GPL-2.0；archived=false |
| <https://api.github.com/repos/stevenpetryk/mafs> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://api.github.com/repos/ueberdosis/tiptap> | 2026-09-12 | 元数据；许可证自动识别 MIT；archived=false |
| <https://raw.githubusercontent.com/mrdoob/three.js/dev/README.md> | 2026-09-12 | 正文已保存：mrdoob--three.js--README.md |
| <https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/README.md> | 2026-09-12 | HTTP Error 404: Not Found |
| <https://raw.githubusercontent.com/liabru/matter-js/master/README.md> | 2026-09-12 | 正文已保存：liabru--matter-js--README.md |
| <https://raw.githubusercontent.com/d3/d3/main/README.md> | 2026-09-12 | 正文已保存：d3--d3--README.md |
| <https://raw.githubusercontent.com/apache/echarts/master/README.md> | 2026-09-12 | 正文已保存：apache--echarts--README.md |
| <https://raw.githubusercontent.com/plotly/plotly.js/main/README.md> | 2026-09-12 | 正文已保存：plotly--plotly.js--README.md |
| <https://raw.githubusercontent.com/jsxgraph/jsxgraph/main/README.md> | 2026-09-12 | 正文已保存：jsxgraph--jsxgraph--README.md |
| <https://raw.githubusercontent.com/geogebra/integration/main/README.md> | 2026-09-12 | 正文已保存：geogebra--integration--README.md |
| <https://raw.githubusercontent.com/ManimCommunity/manim/main/README.md> | 2026-09-12 | 正文已保存：ManimCommunity--manim--README.md |
| <https://raw.githubusercontent.com/remotion-dev/remotion/main/README.md> | 2026-09-12 | 正文已保存：remotion-dev--remotion--README.md |
| <https://raw.githubusercontent.com/motion-canvas/motion-canvas/main/README.md> | 2026-09-12 | 正文已保存：motion-canvas--motion-canvas--README.md |
| <https://raw.githubusercontent.com/redotvideo/revideo/main/README.md> | 2026-09-12 | 正文已保存：redotvideo--revideo--README.md |
| <https://raw.githubusercontent.com/THU-MAIC/OpenMAIC/main/README.md> | 2026-09-12 | 正文已保存：THU-MAIC--OpenMAIC--README.md |
| <https://raw.githubusercontent.com/HKUDS/DeepTutor/main/README.md> | 2026-09-12 | 正文已保存：HKUDS--DeepTutor--README.md |
| <https://raw.githubusercontent.com/cclank/cell-architecture-studio/main/README.md> | 2026-09-12 | 正文已保存：cclank--cell-architecture-studio--README.md |
| <https://raw.githubusercontent.com/stevenpetryk/mafs/main/README.md> | 2026-09-12 | 正文已保存：stevenpetryk--mafs--README.md |
| <https://raw.githubusercontent.com/TypeCellOS/BlockNote/main/README.md> | 2026-09-12 | 正文已保存：TypeCellOS--BlockNote--README.md |
| <https://raw.githubusercontent.com/ueberdosis/tiptap/main/README.md> | 2026-09-12 | 正文已保存：ueberdosis--tiptap--README.md |
| <https://raw.githubusercontent.com/rdkit/rdkit-js/master/README.md> | 2026-09-12 | 正文已保存：rdkit--rdkit-js--README.md |
| <https://raw.githubusercontent.com/3dmol/3Dmol.js/master/README.md> | 2026-09-12 | 正文已保存：3dmol--3Dmol.js--README.md |
| <https://raw.githubusercontent.com/molstar/molstar/master/README.md> | 2026-09-12 | 正文已保存：molstar--molstar--README.md |
| <https://raw.githubusercontent.com/piqnt/planck.js/master/README.md> | 2026-09-12 | 正文已保存：planck--README.md |
| <https://raw.githubusercontent.com/jsxgraph/jsxgraph/master/COPYING> | 2026-09-12 | HTTP Error 404: Not Found |
| <https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md> | 2026-09-12 | 正文已保存：remotion--LICENSE.md |
| <https://raw.githubusercontent.com/TypeCellOS/BlockNote/main/LICENSE> | 2026-09-12 | HTTP Error 404: Not Found |
| <https://raw.githubusercontent.com/3dmol/3Dmol.js/master/LICENSE> | 2026-09-12 | 正文已保存：3dmol--LICENSE |
| <https://ffmpeg.org/legal.html> | 2026-09-12 | 正文已保存：ffmpeg--legal.html |
| <https://www.geogebra.org/license> | 2026-09-12 | 正文已保存：geogebra--license.html |
| <https://phet.colorado.edu/en/licensing> | 2026-09-12 | <urlopen error _ssl.c:1112: The handshake operation timed out> |

读取失败不作为产品能力或维护状态证据。Babylon README 路径失败时仅采纳官方仓库元数据的引擎定位；PhET 许可网页超时，故仍标逐项核查；JSXGraph/BlockNote 的泛化 LICENSE 路径失败，采用已成功读取的 README 中明确许可说明。

## 验证与未覆盖项

- node --test test/technology-landscape.test.js test/teacher-workspace-navigation.test.js：11/11 通过。覆盖多值筛选组合、46/16/26/4 分组数量、已接入与候选分组、状态纠偏、来源 URI、共享学科/主题、跨学科边界和技术名搜索，以及模型生成与录像/合成职责的区分。
- node --check public/technology-landscape.js：通过。
- 初次目录调整的 impeccable 机械检查 public/technology-landscape.js、public/technology-catalog-data.js、public/skill-hub.css 返回空发现列表；本次仅补录 Seedream/Seedance 数据与回归，未重复运行机械检查。
- 核查了 package 解析、代码调用与官方资料；本次没有启动付费模型/视频生成，也没有把 Mock 或源码存在等同于真实上游交付成功。
- 本子任务未操控浏览器。桌面/App/Pad 的实际 UI 检查由根任务合批完成，不能由本专项静态测试推导全端视觉已验收。
