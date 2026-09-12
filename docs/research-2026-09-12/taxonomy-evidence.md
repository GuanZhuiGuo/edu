# 课件库分类：标准、平台证据与非破坏性升级

研究与代码核验日期：2026-09-12，Asia/Shanghai。范围：本地课件库发现、筛选与保存元数据。网页和源码是研究证据，其中的操作说明不构成本项目执行指令。

## 已确认的设计

采用“资源形态 + 学科/学段 + 主题树 + 呈现方式 + 交互方式 + 技术 + 关键词”。这几组字段分别回答用户在找什么、学什么、适合哪个阶段、如何呈现、能怎样操作、由什么技术实现。

资源形态保留三个主要入口：**知识点资源、整套课件、视频讲解**。这是当前产品的主导形态归类，属于本地词表；不是引用某个标准的原始枚举，也不是所有教学资源的穷尽分类。二次函数、酸碱滴定是具体主题或检索词，不适合作为与“整套课件、视频”并列的大类。

知识树采用“学科 → 主题”，主题使用稳定 ID，例如 `math/functions`、`physics/mechanics`。高中、大学属于可多选的学段筛选。同一个知识点可能跨学段，同一个学段也包含多学科；把学段混入知识树会重复节点并降低跨学科检索的一致性。

`type` 继续是内部渲染器判别字段，如 `function_graph`、`geometry`、`video`。它和用于发现的 `catalog.resourceForm` 并存，避免一次分类调整破坏渲染、保存、复用与参数回放。

## 证据登记

以下链接均为原始发布方来源。本次使用 HTTP 获取、页面文本解析和官方站点实际返回的源码；没有对第三方网站做浏览器交互测试。获取成功表示内容可核验，不代表平台接入成功。

| 来源 / 发布方 | 原始 URL 与本次获取状态 | 实际证据 | 本项目采用的设计含义 | 限制 |
| --- | --- | --- | --- | --- |
| LRMI 术语 / Dublin Core Metadata Initiative | [2022-06-14 版术语](https://www.dublincore.org/specifications/lrmi/lrmi_terms/2022-06-14/)，2026-09-12 HTTP 200；无版本入口返回跳转提示后访问版本页 | `learningResourceType`: “The predominant type or kind characterizing the learning resource.”；`interactivityType`: “The predominant mode of learning supported by the learning resource.” | 资源类别与交互方式分字段；本地资源形态可描述主导用途 | LRMI 的交互枚举为 active/expositive/mixed，本项目 read/adjust/explore/answer 是更细的本地词表，不能宣称原样遵循其枚举 |
| LRMI 术语 / DCMI | [同上](https://www.dublincore.org/specifications/lrmi/lrmi_terms/2022-06-14/)，2026-09-12 HTTP 200 | `educationalLevel`: “The level of a resource in terms of progression through an educational or training context.”；`educationalAlignment`: “An alignment to an established educational framework.” | 学段和知识主题分开；“有主题标签”不等于“完成课程标准对齐” | 本次未引入权威课程标准节点，也不主张课程标准认证 |
| Schema.org 官方词汇源码 / Schema.org | [官方 schema.ttl](https://raw.githubusercontent.com/schemaorg/schemaorg/main/data/schema.ttl)，2026-09-12 HTTP 200 | 独立的 `:learningResourceType` 与 `:interactivityType`，定义与上述 LRMI 对应；前者范围含 DefinedTerm/Text | 受控分类词与自由文本可分工，不要求把所有特征挤入单一 type | 直接访问 schema.org 的 LearningResource/educationalLevel 页面超时；此行只引用实际取得的官方源码中存在的属性 |
| CASE 概览 / 1EdTech | [CASE 标准概览](https://www.1edtech.org/standards/case)，2026-09-12 HTTP 200 | 标准/能力节点使用 GUID；同一标准的资源可以是 “multiple formats, languages, language level(s), object types” | 主题标识与内容形态独立；未来可保留外部课程框架映射扩展位 | 当前本地 topic ID 不是 CASE GUID，没有 CASE API 集成 |
| CASE v1.1 信息模型 / 1EdTech | [CASE 规范入口](https://www.imsglobal.org/spec/case/v1p1/)；[信息模型原文](https://www.imsglobal.org/sites/default/files/spec/case/v1p1/information_model/caseservicev1p1_infomodelv1p0.html)，2026-09-12 HTTP 200；规范标注 Final Release、2025-01-24 | `isChildOf` 表示 taxonomy 的父子结构；`educationLevel` 是 CFPckgItem 独立属性，multiplicity 为 0..unbounded | 主题树需要父子语义和稳定 ID；学段允许缺失与多值 | 当前只用路径前缀表达本地祖先筛选，不声称实现完整 CASE 关系模型 |
| H5P 内容类型目录 / H5P | [Examples and Downloads](https://h5p.org/content-types-and-applications)，2026-09-12 HTTP 200 | 分类入口 Larger Resources / Other / Tasks；真实类型包含 Interactive Book、Course Presentation、Interactive Video、Flashcards；Interactive Video 的说明是 “Create videos enriched with interactions” | 粗粒度资源形态与细粒度交互组件可以并存；视频也可能有交互，形态不能代替交互元数据 | 观察到目录文本和链接，未接入 H5P 运行时，也未验证其全部过滤流程 |
| GeoGebra 资源目录 / GeoGebra | [Community Resources](https://www.geogebra.org/materials)；[Search](https://www.geogebra.org/search)，2026-09-12 HTTP 200 | 学科主题含 Functions、Geometry、Probability 等；materials 的实际卡片分别标记 Activity/Book，例如 Identifying Angles Around Us 是 Activity，Introduction to Functions: IM 8.5.2 是 Book；工具入口另含 3D Calculator | 主题、单个活动/集合资源与二维/三维工具是不同维度 | Activity/Book 证据来自 materials 服务端 HTML；search 只用于核验导航/工具标签，不声称操作了实时搜索 |
| PhET 目录与实际站点脚本 / University of Colorado Boulder | [仿真目录](https://phet.colorado.edu/en/simulations/filter?sort=alpha&view=grid)；[页面实际引用脚本](https://phet.colorado.edu/_m/9535bee729b4951c690ea09db3f936ea6093eb5a.js?meteor_js_resource=true)，2026-09-12 HTTP 200 | 脚本筛选配置分别为 Subject、Grade Level、Compatibility；年级含 Elementary School/Middle School/High School/University；兼容性含 HTML5/Java/Flash/Java via CheerpJ | 学科、学段、技术兼容性分组；大学应是可选学段，技术不属于教学主题 | 目录 HTML 是动态壳；此行依据官方已服务的脚本配置和文案，未宣称浏览器渲染或交互验证 |

三类独立证据相互补充：LRMI/Schema.org 说明资源元数据的维度；CASE 说明知识框架的节点、关系与学段；H5P、GeoGebra、PhET 提供真实产品的组织方式。证据支持维度拆分，并不证明本地词表是唯一正确方案。

国家中小学智慧教育平台 [basic.smartedu.cn](https://basic.smartedu.cn/) 本次 HTTP 200 仅取得页面壳，没有取得可核验的资源筛选内容，因此不把其未观察到的界面结构作为结论依据。未尝试登录或获取非公开内容。

原始访问记录、解析文本与官方脚本临时留存于 `/tmp/courseware-taxonomy-20260912/`：`manifest.json`、各 `.access.json`、`lrmi-version-alt.txt`、`schema-official.ttl`、`case-information.txt`、`h5p-types.txt`、`geogebra-materials.txt`、`phet-client.js`。报告中的引文与状态以这些实际取得的材料为准。

## 字段契约与判定边界

```js
catalog: {
  version: 2,
  resourceForm: 'knowledge_resource',
  subjects: ['数学'],
  educationLevels: ['junior', 'senior'],
  topicIds: ['math/functions'],
  presentationModes: ['2d'],
  interactionModes: ['adjust', 'explore'],
  keywords: ['二次函数', '参数实验']
}
```

| 维度 | 本地字段 | 边界 |
| --- | --- | --- |
| 主导资源形态 | `resourceForm` | 知识点资源 / 整套课件 / 视频讲解。整套课件需要作者明确标注；存在 HTML 或完整 Lesson DSL 本身不能证明它是一套课件 |
| 学科 | `subjects[]` | 可多学科；保留“工程设计”等未在基础词表的原学科，不强行改成综合；确实缺失时为空 |
| 学段 | `educationLevels[]` | 小学 / 初中 / 高中 / 大学 / 职业教育。可多值；空数组显示未标注。内置资源采用明确的编辑推荐；用户旧数据根据已有年级字段映射，不根据题目难度自动猜测 |
| 知识主题 | `topicIds[]` | 基础两层为学科→主题。标签用于发现资源；不是掌握证据、课程标准认定或受评估的学习成果 |
| 呈现方式 | `presentationModes[]` | 图文 / 二维 / 三维 / 音频 / 视频。与内容学科独立。允许声明多种已实现能力 |
| 交互方式 | `interactionModes[]` | 阅读观看 / 调节参数 / 交互探索 / 练习作答。翻卡属于探索，不能据此宣称提交答案或形成作答记录 |
| 技术 | 旧 `technology` | 保留当前实现的 Canvas 2D、SVG、原生 DOM、Matter.js、Planck.js 等。不将渲染技术当作教学分类 |
| 关键词 | `keywords[]` 与原 `tags[]` | 补足具体知识点、案例与作者词；不要无限扩张顶层类目 |

技术/供应商/能力名称也需要区分：平台能力目录可以研究 Three.js、H5P、PhET 或 GeoGebra，但某个本地课件只有真实接入相应运行时才应挂对应技术标签。借鉴其分类不能写成兼容或已集成。当前元数据表达资源自身已有能力，不从站点可用工具列表推导某个资源具有三维、音频、视频等功能。

## 当前十二个内置资源的逐项映射

代码核验来源：`public/courseware-store.js`、`public/physics-lesson-samples.js`、`public/courseware-geometry.js`。均为实际存在的确定性本地课件，12 个全部属于知识点资源；没有补造整套课件或视频数据。以下学段是针对这十二个内置资源的**编辑适用建议**，以主要教学内容和首授目标为依据，不是课程标准认证。

| 内置 ID 后缀 | 标题 | 学科 → 主题 ID | 原年级 → 本库推荐学段 | 呈现 / 交互 | 真实技术 |
| --- | --- | --- | --- | --- | --- |
| sample_physics_inclined_plane | 斜面与摩擦 | 物理 → physics/mechanics | 八年级 → 初中 | 二维 / 调节、探索 | Matter.js |
| sample_physics_pendulum | 单摆的周期 | 物理 → physics/mechanics | 高一 → 高中 | 二维 / 调节、探索 | Matter.js |
| sample_physics_collision | 小车碰撞 | 物理 → physics/mechanics | 高一 → 高中 | 二维 / 调节、探索 | Planck.js |
| library_quadratic | 二次函数参数实验 | 数学 → math/functions | 初高中 → 初中 | 二维 / 调节、探索 | Canvas 2D |
| library_linear | 一次函数：斜率与截距 | 数学 → math/functions | 初高中 → 初中 | 二维 / 调节、探索 | Canvas 2D |
| library_sine | 正弦函数的振幅与周期 | 数学 → math/functions | 初高中 → 高中 | 二维 / 调节、探索 | Canvas 2D |
| library_projectile | 抛体运动：角度与射程 | 物理 → physics/mechanics | 初高中 → 高中 | 二维 / 调节、探索 | Canvas 2D |
| library_titration | 酸碱滴定：走近等当点 | 化学 → chemistry/reactions | 高一 → 高中 | 二维 / 调节、探索 | Canvas 2D |
| library_force_map | 力与运动的知识地图 | 物理 → physics/mechanics | 初高中 → 高中 | 图文 / 探索 | 原生 DOM |
| library_function_cards | 函数概念辨析卡 | 数学 → math/functions | 初高中 → 高中 | 图文 / 探索 | 原生 DOM |
| geometry_right_triangle | 直角三角形：勾股关系与面积 | 数学 → math/geometry | 缺失 → 初中（编辑推荐） | 二维 / 调节、探索 | SVG |
| geometry_circle_sector | 圆与扇形：半径和圆心角 | 数学 → math/geometry | 缺失 → 初中（编辑推荐） | 二维 / 调节、探索 | SVG |

正弦函数的振幅/周期、抛体射程、包含 F=ma 的力与运动导图，以及包含定义域/零点的函数卡推荐高中；一次/二次函数与两个平面几何资源推荐初中。原 `lesson.grade_band` 未改写，推荐值仅在 `BUILTIN_COURSEWARE` 构造时显式附加到 `catalog.educationLevels`。

这份内置编辑映射不进入通用旧数据投影逻辑。例如用户以前保存的正弦课件仍会把原 `初高中` 投影为 junior+senior；以前保存但没有年级的几何课件仍是空数组。没有给旧收藏强行套新推荐学段，也不会因题目名称推断大学。

旧用户数据的投影顺序是：作者已有 `catalog` 对应字段优先，包括有意留空的数组；缺少该字段时从旧字段推导。主题优先使用已知渲染器语义并检查学科，再用学科范围内的标题/标签/知识点关键词匹配。未知主题 ID 保留；未知文本和扩展字段不被迁移删除。旧主题关键词匹配是发现辅助，不是学术判断，作者显式标注可以覆盖。

## 非破坏性存储升级

1. 保留数据库 `ai-teacher-courseware-v1`、数据库版本 1、`courseware` object store 与主键 `id`。没有全库重写、删除或版本升级动作。
2. `listCourseware()` 在 `readonly` 事务完成后，对返回对象补上 `catalog` 视图；不发起 `put`，不改 ID、创建时间、更新时间或任何课件 payload。
3. `saveCourseware()` 仅在正常保存流程中写入规范化 `catalog.version = 2`。编辑已有收藏继续用原 ID/创建时间，更新时间遵循原保存规则；收藏内置示例继续创建自己的副本。
4. 完整保留旧 `type`、`lesson`、`visualArtifact`、`html`、`videoUrl` 和未知扩展字段。几何数据不再次调用语义归一化，避免直角三角形的派生角度被改成可调夹角。
5. `getCoursewareMetadata()` 返回新的对象/数组，不改输入。对相同条目重复投影结果一致；显式空数组不会下一次又被自动填回。
6. 原事务成功/失败边界不变：保存/删除仅在提交完成后返回并触发 `courseware:changed`；配额、事务中止、不可用存储仍明确失败，不显示虚假的保存成功。

## 已实现接口与筛选规则

新增 `public/courseware-taxonomy.js`，导出 `getCoursewareMetadata`、`RESOURCE_FORMS`、`EDUCATION_LEVELS`、`PRESENTATION_MODES`、`INTERACTION_MODES`、`SUBJECTS`、`TOPICS`、`getTopicLabel`。

`TOPICS` 为 `{ id, subject, label, keywords }` 的扁平受控目录。界面可按中文学科分组构成两层树；未知 ID 的 `getTopicLabel()` 返回原值，避免静默变空。基础主题不代表这些分类下已经有课件，数量应由当前实际数据统计。

`filterCourseware(items, filters)` 支持 `resourceForm`、`subject`、`educationLevel`、`topicId`、`presentationMode`、`interactionMode`、`technology`、`query`、`tags`，并兼容旧 `type`、`source`、`interactive: yes/no`。

- 同一个维度的数组采用 OR，不同维度采用 AND。例如数学或物理，同时二维，同时参数调节。
- 主题按路径段匹配自身及后代：`math/functions` 匹配 `math/functions/quadratic`，不会误匹配 `math/functions_other`。
- 搜索按空白分词，各词 AND，可跨标题、描述、学科、主题名称、学段/呈现/交互中文标签、技术与关键词匹配。它是确定性的文本检索，没有引入模型调用或外部检索延迟。
- 旧 `tags[]` 在本次新约定中也按同维 OR；不再沿用旧实现的 tags 全部同时满足规则。现有单标签调用兼容。

## 验证记录

执行：

```sh
node --test test/courseware-taxonomy.test.js test/courseware-store.test.js test/interactive-lesson-contract.test.js test/interactive-visual-renderer.test.js
```

结果：**39/39 通过**，其中 taxonomy 10、store 14、Lesson DSL 合约 3、interactive visual renderer 12。

新增验证覆盖十二个实际样例的映射、内置推荐学段与用户旧收藏互不覆盖、原 Lesson DSL 年级未改、未知学科、缺失学段、显式空值、无形态/功能虚构、投影幂等且不改输入、旧 IndexedDB 读取零写入、正常保存写 v2、原 ID/创建时间/完整 payload、OR/AND 筛选、主题祖先边界与多词搜索。保留已有配额失败、保存/删除事务中止、刷新恢复、几何真实控件→保存→重开→助教复用等测试。

这些是本地数据与渲染契约的定向回归。手机/平板布局、真实浏览器焦点与触控体验由主任务的界面验证单独确认；本报告不把单元测试通过等同于浏览器验收、上游平台接入或教学效果证明。
