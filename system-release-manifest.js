const SYSTEM_RELEASE = Object.freeze({
  schema_version: "ai-teacher-system-release@1.0",
  product: "AI教师",
  display_version: "MVP 2.0",
  version: "2.0.0-dev.2",
  release_id: "local-2026-08-27",
  channel: "local_development",
  released_at: "2026-08-27",
  production_release: false,
});

const RELEASE_HISTORY = Object.freeze([
  Object.freeze({
    ...SYSTEM_RELEASE,
    title: "知识生产与学习闭环",
    summary: "文档导入、语义本体、教育数据库、混合检索、图数据库发布与双端工作台进入同一开发基线。",
    highlights: Object.freeze([
      "可恢复的文档导入任务与人工审核门",
      "SQLite 业务本体、Qdrant 向量索引、Neo4j 发布控制",
      "学生数据隔离、题库与掌握证据",
      "学生端与教师端分离",
      "教材讲稿、分镜审核与镜头级视频生产",
    ]),
  }),
  Object.freeze({
    schema_version: SYSTEM_RELEASE.schema_version,
    product: SYSTEM_RELEASE.product,
    display_version: "MVP 1.0",
    version: "1.0-baseline",
    release_id: "historical-mvp-1-baseline",
    channel: "historical_baseline",
    released_at: null,
    production_release: false,
    title: "AI教师交互基线",
    summary: "双工语音、文字 Agent、教育卡片与中考数学知识图谱原型。",
    highlights: Object.freeze([
      "双工语音和实时字幕",
      "AI教师文字会话与 A2UI 卡片",
      "中考数学知识图谱原型",
    ]),
  }),
]);

const ARCHITECTURE = Object.freeze({
  schema_version: "ai-teacher-system-architecture@1.0",
  title: "AI教师 MVP 2.0 技术架构",
  nodes: Object.freeze([
    { id: "sources", layer: "source", label: "学习资料", detail: "课标、大纲、教材、作业、试卷、题目、图片" },
    { id: "import", layer: "knowledge", label: "导入任务", detail: "持久化任务、文档解析、页面锚点、失败续跑" },
    { id: "models", layer: "ai", label: "模型能力", detail: "VLM 页面理解、文本语义编译、多模态 Embedding" },
    { id: "document-ir", layer: "knowledge", label: "DocumentIR", detail: "统一文档块、页码、题目结构与可追溯证据" },
    { id: "ontology", layer: "knowledge", label: "本体候选", detail: "实体、关系、知识点、题目映射与跨学科关系" },
    { id: "review", layer: "control", label: "质量与审核", detail: "Schema 校验、来源锚点、人工确认、发布门禁" },
    { id: "sqlite", layer: "storage", label: "业务数据库", detail: "学生、题目、知识点、掌握证据与学习事件" },
    { id: "qdrant", layer: "storage", label: "Qdrant", detail: "Dense + Sparse 向量与元数据过滤" },
    { id: "neo4j", layer: "storage", label: "Neo4j", detail: "本体关系、CorpusRelease 与 active release" },
    { id: "runtime", layer: "runtime", label: "Pi Agent 运行时", detail: "工具调用、检索、解题、出题与响应协议" },
    { id: "mastery", layer: "runtime", label: "学习记忆", detail: "证据校验、掌握度计算、学习记录与计划" },
    { id: "dsl", layer: "experience", label: "教学呈现", detail: "A2UI、Lesson DSL、函数图、几何图与思维导图" },
    { id: "video-studio", layer: "runtime", label: "视频讲解工作台", detail: "教材范围、讲稿、教学分镜、人工审核与版本" },
    { id: "media-models", layer: "ai", label: "媒体生成", detail: "Seedream 5.0 Lite 教学视觉与 Seedance 2.5 分镜视频" },
    { id: "video-assets", layer: "storage", label: "视频资产库", detail: "项目、镜头、任务、素材、字幕、成片与本地转存" },
    { id: "composer", layer: "runtime", label: "成片合成", detail: "镜头拼接、音轨、字幕、封面与可播放成片" },
    { id: "student", layer: "experience", label: "学生端", detail: "学习、练习、知识地图、计划与记录" },
    { id: "teacher", layer: "experience", label: "教师端", detail: "知识生产、审核、课程、题库与班级学情" },
  ]),
  edges: Object.freeze([
    ["sources", "import", "提交"],
    ["import", "models", "调用"],
    ["models", "document-ir", "结构化"],
    ["document-ir", "ontology", "抽取"],
    ["ontology", "review", "候选"],
    ["review", "sqlite", "固化业务数据"],
    ["review", "qdrant", "发布索引"],
    ["review", "neo4j", "发布关系"],
    ["qdrant", "runtime", "混合召回"],
    ["neo4j", "runtime", "图扩展"],
    ["sqlite", "runtime", "业务事实"],
    ["runtime", "mastery", "学习证据"],
    ["mastery", "sqlite", "校验后写入"],
    ["runtime", "dsl", "受控规格"],
    ["document-ir", "video-studio", "教材页与知识点溯源"],
    ["models", "video-studio", "讲稿与分镜编译"],
    ["video-studio", "media-models", "审核后生成"],
    ["media-models", "video-assets", "转存镜头资产"],
    ["video-assets", "composer", "合成素材"],
    ["composer", "video-assets", "固化成片"],
    ["dsl", "student", "渲染"],
    ["dsl", "teacher", "预览"],
    ["student", "runtime", "学习请求"],
    ["teacher", "review", "审核与配置"],
  ].map(([source, target, label]) => Object.freeze({ source, target, label }))),
});

export function getSystemReleaseManifest() {
  return {
    current_release: { ...SYSTEM_RELEASE },
    releases: RELEASE_HISTORY.map((release) => ({
      ...release,
      highlights: [...release.highlights],
    })),
    architecture: {
      ...ARCHITECTURE,
      nodes: ARCHITECTURE.nodes.map((node) => ({ ...node })),
      edges: ARCHITECTURE.edges.map((edge) => ({ ...edge })),
    },
  };
}

export function getCurrentSystemRelease() {
  return { ...SYSTEM_RELEASE };
}
