import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(
  projectRoot,
  "../../../教材数据/初中数学知识系统/03-初中数学知识点清单与关系.md"
);
const dataDir = join(projectRoot, "public/data");
const ontologyPath = join(dataDir, "junior-math-ontology.json");
const masteryPath = join(dataDir, "demo-student-mastery.json");

const DOMAIN_META = new Map([
  ["数与代数", { id: "domain-number-algebra", order: 1, color: "#315ea8" }],
  ["图形与几何", { id: "domain-geometry", order: 2, color: "#8a4932" }],
  ["统计与概率", { id: "domain-statistics", order: 3, color: "#33745a" }],
  ["综合与实践", { id: "domain-practice", order: 4, color: "#72528c" }]
]);

const DEFAULT_THEMES = {
  "M4-ST-DATA": { key: "4.1", name: "抽样与数据分析" },
  "M4-ST-PROB": { key: "4.2", name: "随机事件的概率" },
  "M4-PR": { key: "5.1", name: "综合与实践" }
};

const ENTITY_CLASSES = [
  ["standard_clause", "课标条款", "可追溯到课程标准原文的内容要求、学业要求或教学提示"],
  ["domain", "课程领域", "课程内容的最高业务分区"],
  ["theme", "课程主题", "领域下稳定、可复用的内容组织单元"],
  ["concept", "数学概念", "能够被定义、识别、举例或区分的数学对象"],
  ["measurable_skill", "可测知识点", "能够通过题目或学习行为形成掌握证据的能力单元"],
  ["theorem", "定理与结论", "具有明确条件和结论的基本事实、定理、推论或公式"],
  ["method", "数学方法", "可重复执行的运算、证明、表示、建模或数据处理方法"],
  ["misconception", "典型误区", "可观察、可诊断的错误理解或错误操作模式"],
  ["assessment_item", "测评题目", "具有作答要求和评分依据、可产生学习证据的题目"],
  ["learning_evidence", "学习证据", "经校验的作答、步骤、提示和交互事件"],
  ["core_competency", "核心素养", "课标明确提出的跨主题能力取向"]
].map(([key, name, definition]) => ({ key, name, definition }));

const RELATION_TYPES = [
  ["part_of", "隶属于", true, "子节点指向直接上级课程结构"],
  ["aligned_to", "对齐课标条款", true, "知识实体指向直接支持它的课标条款"],
  ["prerequisite_of", "是……的先修", true, "起点能力会实质影响终点能力的学习或作答"],
  ["requires_knowledge", "完成时需要", true, "题目或技能指向标准路径中必须调用的知识"],
  ["assesses", "考查", true, "题目指向能够被其作答结果测量的知识点"],
  ["illustrates", "举例说明", true, "例题或题目指向它所呈现的知识"],
  ["applies", "运用", true, "技能或题目指向实际采用的方法或定理"],
  ["derived_from", "推导自", true, "结论或方法指向其推导依据"],
  ["specializes", "是……的特化", true, "较窄实体指向继承其含义的较宽实体"],
  ["equivalent_to", "等价于", false, "当前课程语境下可互换的知识实体"],
  ["contrasts_with", "对照区别", false, "教学中需要明确辨析的知识实体"],
  ["misconception_of", "是……的典型误区", true, "误区指向被错误理解的知识"],
  ["addresses_misconception", "针对误区", true, "题目指向它用于暴露或纠正的误区"],
  ["develops_competency", "发展核心素养", true, "学习活动指向其明确发展的核心素养"],
  ["strongly_related_to", "强关联", false, "适合联合教学、检索或组成综合题"],
  ["applied_with", "联合应用", false, "两个知识点经常在同一解题链中配合"],
  ["equivalent_view_of", "等价视角", false, "同一数学对象的不同领域表达"],
  ["represented_by", "可表示为", true, "起点概念可以用终点表征方式表达"],
  ["supported_by", "由……支撑", true, "起点结论需要终点提供方法或证据"],
  ["applied_in", "应用于", true, "领域知识指向实际应用场景或综合任务"]
].map(([key, name, directed, definition]) => ({ key, name, directed, definition }));

const markdown = readFileSync(sourcePath, "utf8");
const lines = markdown.split(/\r?\n/u);
const domains = [];
const themes = [];
const knowledgePoints = [];
const rawPrerequisites = [];
const rawStrongRelations = [];
const rawCrossRelations = [];
const domainByName = new Map();
const themeByKey = new Map();
let currentDomain = null;
let currentTheme = null;
let readingCrossRelations = false;

for (const line of lines) {
  const domainMatch = line.match(/^## ([2-5])\.\s+(.+)$/u);
  if (domainMatch) {
    if (domainMatch[1] === "6") break;
    const name = domainMatch[2].trim();
    const meta = DOMAIN_META.get(name);
    if (!meta) continue;
    currentDomain = { ...meta, name };
    currentTheme = null;
    if (!domainByName.has(name)) {
      domainByName.set(name, currentDomain);
      domains.push(currentDomain);
    }
    continue;
  }

  const themeMatch = line.match(/^### ([2-5]\.\d+)\s+(.+)$/u);
  if (themeMatch && currentDomain) {
    currentTheme = ensureTheme(themeMatch[1], themeMatch[2].trim(), currentDomain);
    continue;
  }

  if (line.startsWith("## 6. 关键跨领域关联边")) {
    readingCrossRelations = true;
    currentDomain = null;
    currentTheme = null;
    continue;
  }
  if (line.startsWith("## 7.")) readingCrossRelations = false;

  if (readingCrossRelations) {
    const crossMatch = line.match(/^\| `(M4-[A-Z0-9-]+)` \| `([a-z_]+)` \| `(M4-[A-Z0-9-]+)` \| (.+) \|$/u);
    if (crossMatch) {
      rawCrossRelations.push({
        source: crossMatch[1],
        type: crossMatch[2],
        target: crossMatch[3],
        rationale: crossMatch[4].trim()
      });
    }
    continue;
  }

  const row = line.match(/^\| `(M4-[A-Z0-9-]+)` \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/u);
  if (!row || !currentDomain) continue;
  const [, id, name, prerequisiteCell, strongCell, sourcePage] = row;
  if (currentDomain.name === "统计与概率" || currentDomain.name === "综合与实践") {
    const fallback = resolveDefaultTheme(id);
    currentTheme = ensureTheme(fallback.key, fallback.name, currentDomain);
  } else if (!currentTheme) {
    const fallback = resolveDefaultTheme(id);
    currentTheme = ensureTheme(fallback.key, fallback.name, currentDomain);
  }
  const order = knowledgePoints.length + 1;
  const knowledgeForm = classifyKnowledgeForm(name);
  const optional = name.includes("选学") || prerequisiteCell.includes("选学");
  knowledgePoints.push({
    id,
    entity_class: "measurable_skill",
    name: name.trim(),
    measurable_behavior: name.trim(),
    knowledge_form: knowledgeForm,
    domain_id: currentDomain.id,
    theme_id: currentTheme.id,
    learning_stage: "第四学段",
    optional,
    source_ref: {
      document_id: "MOE-MATH-2022",
      printed_page: sourcePage.trim(),
      extraction_source: "03-初中数学知识点清单与关系.md"
    },
    visualization: {
      cluster_id: currentTheme.id,
      order,
      label_priority: knowledgeForm === "application_modeling" ? 2 : 1
    },
    review_status: "curated",
    aliases: []
  });
  for (const prerequisiteId of extractIds(prerequisiteCell)) {
    rawPrerequisites.push({ source: prerequisiteId, target: id });
  }
  for (const relatedId of extractIds(strongCell)) {
    rawStrongRelations.push({ source: id, target: relatedId });
  }
}

const nodeIds = new Set([
  ...domains.map((domain) => domain.id),
  ...themes.map((theme) => theme.id),
  ...knowledgePoints.map((point) => point.id)
]);
const edges = [];
const edgeKeys = new Set();

for (const theme of themes) {
  addEdge(theme.id, theme.domain_id, "part_of", "课程结构");
}
for (const point of knowledgePoints) {
  addEdge(point.id, point.theme_id, "part_of", "知识点所属主题");
}
for (const relation of rawPrerequisites) {
  addEdge(relation.source, relation.target, "prerequisite_of", "知识清单明确先修");
}
for (const relation of rawStrongRelations) {
  addEdge(relation.source, relation.target, "strongly_related_to", "知识清单明确强关联");
}
for (const relation of rawCrossRelations) {
  addEdge(relation.source, relation.target, relation.type, relation.rationale);
}

const ontology = {
  schema_version: "learning-ontology@1.0",
  ontology_id: "junior-math-moe-2022",
  ontology_version: "math-standard-2022-m4@1.0",
  name: "初中数学知识本体",
  description: "面向知识图谱呈现、题目标注、知识召回和掌握证据归因的第四学段数学本体。",
  generated_at: "2026-08-06T00:00:00+08:00",
  source_document: {
    document_id: "MOE-MATH-2022",
    title: "义务教育数学课程标准（2022年版）",
    scope: "第四学段（7～9年级）",
    printed_pages: "53～78",
    local_source: "教材数据/5.义务教育数学课程标准（2022年版）.20220428160938.pdf"
  },
  educational_boundaries: {
    ontology_is_mastery_state: false,
    self_report_can_set_mastery: false,
    graph_relation_can_directly_set_mastery: false,
    prerequisite_transfer_policy: "只有已验证题目的实际必需步骤，才能给直接先修点传递弱证据；禁止多跳直接判定掌握。"
  },
  entity_classes: ENTITY_CLASSES,
  relation_types: RELATION_TYPES,
  visualization_profile: {
    default_view: "clustered-knowledge-map",
    default_edge_policy: "selected-node-neighborhood",
    cluster_field: "theme_id",
    label_field: "name",
    node_id_field: "id",
    edge_source_field: "source",
    edge_target_field: "target",
    mastery_join_key: "knowledge_point_id",
    mastery_typography: true,
    layout_hints: {
      domain_order: domains.map((domain) => domain.id),
      theme_order: themes.map((theme) => theme.id)
    }
  },
  domains,
  themes,
  knowledge_points: knowledgePoints,
  edges,
  statistics: {
    domain_count: domains.length,
    theme_count: themes.length,
    knowledge_point_count: knowledgePoints.length,
    edge_count: edges.length
  }
};

const masteryRecords = knowledgePoints.map((point, index) => {
  if (index % 11 === 0) {
    return {
      knowledge_point_id: point.id,
      mastery_state: "unassessed",
      mastery_probability: null,
      confidence: 0,
      evidence_count: 0,
      last_event_at: null,
      latest_source: null
    };
  }
  const masteryProbability = Number((0.28 + ((index * 37) % 68) / 100).toFixed(2));
  const confidence = Number((0.46 + ((index * 17) % 48) / 100).toFixed(2));
  return {
    knowledge_point_id: point.id,
    mastery_state: classifyMastery(masteryProbability),
    mastery_probability: masteryProbability,
    confidence,
    evidence_count: 2 + ((index * 7) % 19),
    last_event_at: `2026-08-${String(1 + (index % 5)).padStart(2, "0")}T${String(9 + (index % 10)).padStart(2, "0")}:20:00+08:00`,
    latest_source: ["作业本导入", "试卷导入", "小A老师课堂", "题库练习"][index % 4]
  };
});

const mastery = {
  schema_version: "student-knowledge-state@1.0",
  state_version: "demo-state@2026-08-06",
  student_id: "demo-student-001",
  ontology_id: ontology.ontology_id,
  ontology_version: ontology.ontology_version,
  demo_data: true,
  mastery_scale: [
    { key: "mastered", name: "熟练掌握", min: 0.85, color: "#147d64" },
    { key: "secure", name: "基本掌握", min: 0.7, color: "#2563a9" },
    { key: "learning", name: "学习中", min: 0.45, color: "#a46514" },
    { key: "weak", name: "待加强", min: 0, color: "#b54747" },
    { key: "unassessed", name: "未评估", min: null, color: "#8b919b" }
  ],
  records: masteryRecords,
  direct_assessment_preferences: [
    {
      knowledge_point_id: "M4-NA-EQ-03",
      preference: "suppress_direct_questions",
      source: "student_self_report",
      note: "学生表示一元一次方程很简单，希望暂时不再直接考查。",
      mastery_changed: false,
      created_at: "2026-08-05T19:10:00+08:00",
      expires_at: "2026-08-19T23:59:59+08:00"
    }
  ],
  import_batches: [
    {
      batch_id: "IMPORT-20260805-001",
      source_type: "exam_paper",
      source_name: "八年级数学阶段测验.pdf",
      status: "applied",
      question_count: 18,
      accepted_event_count: 16,
      affected_knowledge_point_count: 7,
      applied_at: "2026-08-05T20:18:00+08:00"
    },
    {
      batch_id: "IMPORT-20260803-001",
      source_type: "homework_book",
      source_name: "一次函数作业本-第3次.jpg",
      status: "applied",
      question_count: 12,
      accepted_event_count: 10,
      affected_knowledge_point_count: 5,
      applied_at: "2026-08-03T21:08:00+08:00"
    }
  ]
};

mkdirSync(dataDir, { recursive: true });
writeFileSync(ontologyPath, `${JSON.stringify(ontology, null, 2)}\n`, "utf8");
writeFileSync(masteryPath, `${JSON.stringify(mastery, null, 2)}\n`, "utf8");
console.log(`Generated ${ontologyPath}`);
console.log(`Generated ${masteryPath}`);
console.log(JSON.stringify(ontology.statistics));

function ensureTheme(key, name, domain) {
  if (themeByKey.has(key)) return themeByKey.get(key);
  const theme = {
    id: `theme-${key.replace(".", "-")}`,
    name,
    domain_id: domain.id,
    order: themes.length + 1,
    color: domain.color
  };
  themeByKey.set(key, theme);
  themes.push(theme);
  return theme;
}

function resolveDefaultTheme(id) {
  for (const [prefix, theme] of Object.entries(DEFAULT_THEMES)) {
    if (id.startsWith(prefix)) return theme;
  }
  throw new Error(`No default theme for ${id}`);
}

function extractIds(cell) {
  return [...cell.matchAll(/`(M4-[A-Z0-9-]+)`/gu)].map((match) => match[1]);
}

function classifyKnowledgeForm(name) {
  if (/实际|现实|模型|建模|项目|研究/u.test(name)) return "application_modeling";
  if (/证明|命题|反例|反证|推导/u.test(name)) return "reasoning_proof";
  if (/图象|坐标|数轴|作图|画|表示|投影|视图/u.test(name)) return "representation";
  if (/计算|运算|求|解|换算|化简|分解|代入|消元/u.test(name)) return "procedure";
  return "concept_understanding";
}

function addEdge(source, target, type, rationale) {
  if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) return;
  const relation = RELATION_TYPES.find((item) => item.key === type);
  const directed = relation?.directed ?? true;
  const endpoints = directed || source < target ? [source, target] : [target, source];
  const key = `${endpoints[0]}|${type}|${endpoints[1]}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push({
    id: `edge-${String(edges.length + 1).padStart(4, "0")}`,
    source: endpoints[0],
    target: endpoints[1],
    type,
    directed,
    rationale,
    review_status: "curated"
  });
}

function classifyMastery(probability) {
  if (probability >= 0.85) return "mastered";
  if (probability >= 0.7) return "secure";
  if (probability >= 0.45) return "learning";
  return "weak";
}
