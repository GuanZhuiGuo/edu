import { createKnowledgeVisualizations } from "./knowledge-visualizations.js";
import { clearKnowledgeDetailWorkbench, renderKnowledgeDetailWorkbench } from "./knowledge-detail-workbench.js";
import { loadLocalKnowledgeVisualCatalog } from "./local-knowledge-visuals.js";
import { loadQuestionBankCatalog, revealQuestionSolution } from "./question-bank-catalog.js";
import { bindEducationImportWorkspace } from "./education-import-client.js";
import { getPortalRole } from "./portal-runtime.js";
import {
  bootstrapEducationData,
  getCurrentEducationEvents,
  getCurrentEducationMastery,
  getCurrentEducationProfile,
  getEducationDataError,
  getEducationDataStatus,
  getEducationOntology
} from "./education-data-client.js";

const MASTERY_META = Object.freeze({
  mastered: { label: "熟练掌握", color: "#147d64" },
  secure: { label: "基本掌握", color: "#2563a9" },
  learning: { label: "学习中", color: "#a46514" },
  weak: { label: "待加强", color: "#b54747" },
  unassessed: { label: "未评估", color: "#8b919b" }
});

const RELATION_META = Object.freeze({
  prerequisite_of: { label: "先修", color: "#6b7fb9" },
  strongly_related_to: { label: "强关联", color: "#8c6b9e" },
  applied_with: { label: "联合应用", color: "#3f8a72" },
  equivalent_view_of: { label: "等价视角", color: "#7a6c45" },
  represented_by: { label: "表征", color: "#b06445" },
  supported_by: { label: "支撑", color: "#4d7f87" },
  applied_in: { label: "应用于", color: "#6f7750" }
});

const SCHOOL_SUBJECTS = Object.freeze([
  { id: "math", name: "数学", subtitle: "函数 · 几何", icon: "sigma", color: "#9c4f3f", deep: "#4c221e" },
  { id: "chinese", name: "语文", subtitle: "阅读 · 写作", icon: "feather", color: "#755466", deep: "#3d2733" },
  { id: "english", name: "英语", subtitle: "听说 · 读写", icon: "languages", color: "#426d7c", deep: "#213e4a" },
  { id: "physics", name: "物理", subtitle: "力学 · 电磁", icon: "atom", color: "#4d6578", deep: "#273845" },
  { id: "chemistry", name: "化学", subtitle: "物质 · 反应", icon: "flask-conical", color: "#74633d", deep: "#40331f" },
  { id: "biology", name: "生物", subtitle: "生命 · 生态", icon: "sprout", color: "#4d7656", deep: "#294332" }
]);

const SHELF_SECTIONS = Object.freeze([
  {
    id: "school",
    compartments: [
      {
        id: "junior",
        title: "中考",
        note: "初中学科 · 2022年课程标准",
        books: SCHOOL_SUBJECTS.map((subject, index) => ({
          ...subject,
          id: `junior-${subject.id}`,
          title: `中考${subject.name}`,
          standard: `义务教育${subject.name === "生物" ? "生物学" : subject.name}课程标准`,
          edition: "2022年版",
          publisher: "中华人民共和国教育部制定 · 北京师范大学出版社",
          scope: index === 0 ? "第四学段 · 140个知识点" : "第四学段",
          available: index === 0
        }))
      },
      {
        id: "senior",
        title: "高考",
        note: "高中学科 · 2017年版2020年修订",
        books: SCHOOL_SUBJECTS.map((subject) => ({
          ...subject,
          id: `high-${subject.id}`,
          title: `高考${subject.name}`,
          icon: subject.id === "math" ? "triangle" : subject.icon,
          standard: `普通高中${subject.name === "生物" ? "生物学" : subject.name}课程标准`,
          edition: "2017年版2020年修订",
          publisher: "中华人民共和国教育部制定 · 人民教育出版社",
          scope: "普通高中"
        }))
      }
    ]
  },
  {
    id: "selection",
    compartments: [
      {
        id: "postgraduate",
        title: "考研",
        note: "全国硕士研究生招生考试 · 2026备考",
        books: [
          { id: "postgrad-politics", title: "考研政治", subtitle: "理论 · 时政", icon: "landmark", color: "#8b3f42", deep: "#442025" },
          { id: "postgrad-english", title: "考研英语", subtitle: "阅读 · 写作", icon: "languages", color: "#3f637d", deep: "#22384a" },
          { id: "postgrad-math-1", title: "考研数学一", subtitle: "高数 · 线代", icon: "radical", color: "#7b5338", deep: "#432b1d" },
          { id: "postgrad-math-2", title: "考研数学二", subtitle: "高数 · 线代", icon: "calculator", color: "#77523c", deep: "#402b20" },
          { id: "postgrad-cs408", title: "计算机408", subtitle: "数据 · 系统", icon: "binary", color: "#445e73", deep: "#243341" },
          { id: "postgrad-management", title: "管理类综合", subtitle: "逻辑 · 写作", icon: "briefcase-business", color: "#5f5978", deep: "#332f45" }
        ].map((book) => ({ ...book, standard: "全国硕士研究生招生考试科目体系", edition: "2026备考版", publisher: "考试内容准备中", scope: "全国统考" }))
      },
      {
        id: "public-service",
        title: "公务员考试",
        note: "国考 · 省考 · 事业单位",
        books: [
          { id: "civil-service-aptitude", title: "国考行测", subtitle: "判断 · 数量", icon: "gauge", color: "#5d5841", deep: "#353222" },
          { id: "civil-service-essay", title: "国考申论", subtitle: "归纳 · 写作", icon: "notebook-pen", color: "#6c4c44", deep: "#3a2824" },
          { id: "provincial-aptitude", title: "省考行测", subtitle: "常识 · 资料", icon: "map", color: "#4d6470", deep: "#293941" },
          { id: "public-institution-aptitude", title: "事业单位职测", subtitle: "职测 · 能力", icon: "building-2", color: "#526449", deep: "#2d3928" },
          { id: "public-institution-application", title: "综合应用能力", subtitle: "分析 · 表达", icon: "files", color: "#62516c", deep: "#372c3e" }
        ].map((book) => ({ ...book, standard: "公务员录用与事业单位公开招聘考试科目体系", edition: "2026备考版", publisher: "考试内容准备中", scope: "公共科目" }))
      }
    ]
  },
  {
    id: "certificates",
    compartments: [
      {
        id: "professional",
        title: "职业证书",
        note: "按职业方向整理考试知识体系",
        books: [
          { id: "cpa", title: "注册会计师", subtitle: "会计 · 审计", icon: "landmark", color: "#6d5040", deep: "#38271f", standard: "注册会计师全国统一考试大纲", scope: "专业阶段" },
          { id: "tax-agent", title: "税务师", subtitle: "税法 · 财会", icon: "receipt-text", color: "#5f6041", deep: "#333424", standard: "税务师职业资格考试大纲", scope: "职业资格" },
          { id: "law", title: "法律职业资格", subtitle: "客观 · 主观", icon: "scale", color: "#64465b", deep: "#352330", standard: "国家统一法律职业资格考试大纲", scope: "客观题 · 主观题" },
          { id: "constructor", title: "一级建造师", subtitle: "法规 · 实务", icon: "hard-hat", color: "#586049", deep: "#303427", standard: "一级建造师执业资格考试大纲", scope: "工程建设" },
          { id: "teacher-cert", title: "教师资格证", subtitle: "综合 · 教学", icon: "graduation-cap", color: "#496276", deep: "#273743", standard: "中小学教师资格考试大纲", scope: "笔试 · 面试" },
          { id: "physician", title: "执业医师", subtitle: "基础 · 临床", icon: "stethoscope", color: "#496a61", deep: "#273c38", standard: "医师资格考试大纲", scope: "医学综合" },
          { id: "pharmacist", title: "执业药师", subtitle: "药学 · 法规", icon: "pill", color: "#59627a", deep: "#303548", standard: "国家执业药师职业资格考试大纲", scope: "药学综合" }
        ].map((book) => ({ ...book, edition: "2026备考版", publisher: "考试内容准备中" }))
      }
    ]
  }
]);

export const QUESTION_HISTORY = Object.freeze([
  {
    id: "QH-20260806-001",
    stem: "在直角三角形中，两直角边分别为 6 和 8，求斜边长。",
    knowledgePoints: [{ id: "M4-GE-TRI-10", name: "探索并应用勾股定理及逆定理" }],
    result: "correct",
    source: "bank",
    type: "计算题",
    date: "今天 19:42",
    userAnswer: "10",
    correctAnswer: "10",
    analysis: "能独立识别斜边并建立勾股关系，本次形成中等正向证据。"
  },
  {
    id: "QH-20260806-002",
    stem: "已知一次函数图象经过点（1，3）和（2，5），求函数表达式。",
    knowledgePoints: [{ id: "M4-NA-FUN-07", name: "用待定系数法确定一次函数表达式并画图象" }],
    result: "correct",
    source: "teacher",
    type: "解答题",
    date: "今天 19:35",
    userAnswer: "y=2x+1",
    correctAnswer: "y=2x+1",
    analysis: "待定系数过程完整，代入和消元步骤均正确。"
  },
  {
    id: "QH-20260805-011",
    stem: "如图，已知两个三角形相似，请写出对应边并求未知边。",
    knowledgePoints: [{ id: "M4-GE-SIM-05", name: "运用相似三角形对应线段比和面积比性质" }],
    result: "wrong",
    source: "exam",
    type: "解答题",
    date: "昨天 20:18",
    userAnswer: "把 AB 对应为 DE",
    correctAnswer: "AB 对应 DF",
    analysis: "首次错误发生在确认对应关系，比例计算本身没有被有效观察。"
  },
  {
    id: "QH-20260805-010",
    stem: "化简：√12+√27。",
    knowledgePoints: [{ id: "M4-NA-REAL-08", name: "理解最简二次根式并完成数值二次根式的简单四则运算" }],
    result: "correct",
    source: "exam",
    type: "计算题",
    date: "昨天 20:18",
    userAnswer: "5√3",
    correctAnswer: "5√3",
    analysis: "能正确化为最简二次根式并合并同类二次根式。"
  },
  {
    id: "QH-20260804-023",
    stem: "证明平行四边形的两组对角分别相等。",
    knowledgePoints: [
      { id: "M4-GE-QUAD-03", name: "证明并应用平行四边形边、角、对角线性质" },
      { id: "M4-GE-PROOF-03", name: "理解证明必要性并用综合法规范书写证明" }
    ],
    result: "partial",
    source: "homework",
    type: "证明题",
    date: "8 月 4 日",
    userAnswer: "连接对角线后，两组三角形全等，所以角相等。",
    correctAnswer: "需要补充平行线内错角相等及全等判定依据。",
    analysis: "结论方向正确，但证明依据不完整；只对证明表达形成弱负向证据。"
  },
  {
    id: "QH-20260804-018",
    stem: "解不等式 3x-5＞7，并在数轴上表示解集。",
    knowledgePoints: [{ id: "M4-NA-INEQ-03", name: "解数字系数一元一次不等式并在数轴表示解集" }],
    result: "wrong",
    source: "bank",
    type: "计算题",
    date: "8 月 4 日",
    userAnswer: "x＞4，数轴画成空心点向左",
    correctAnswer: "x＞4，空心点向右",
    analysis: "不等式求解正确，错误发生在数轴方向；适合拆分表征能力验证。"
  },
  {
    id: "QH-20260803-016",
    stem: "某组数据为 3、5、5、7、10，求平均数、中位数和众数。",
    knowledgePoints: [{ id: "M4-ST-DATA-04", name: "理解并计算平均数、中位数、众数和加权平均数" }],
    result: "correct",
    source: "homework",
    type: "计算题",
    date: "8 月 3 日",
    userAnswer: "平均数6，中位数5，众数5",
    correctAnswer: "平均数6，中位数5，众数5",
    analysis: "三类集中趋势量均计算正确。"
  },
  {
    id: "QH-20260803-012",
    stem: "袋中有 3 个红球和 2 个蓝球，随机摸出一个球，求摸到红球的概率。",
    knowledgePoints: [{ id: "M4-ST-PROB-01", name: "用列表或树状图枚举等可能随机事件结果并计算概率" }],
    result: "correct",
    source: "bank",
    type: "填空题",
    date: "8 月 3 日",
    userAnswer: "3/5",
    correctAnswer: "3/5",
    analysis: "能够确认等可能性并计算简单概率。"
  },
  {
    id: "QH-20260802-009",
    stem: "判断命题“对角线相等的四边形是矩形”是否正确，并说明理由。",
    knowledgePoints: [{ id: "M4-GE-PROOF-04", name: "用反例否定命题并理解反证法" }],
    result: "wrong",
    source: "teacher",
    type: "判断题",
    date: "8 月 2 日",
    userAnswer: "正确",
    correctAnswer: "错误，例如等腰梯形。",
    analysis: "需要补充反例意识，并区分矩形判定的充分条件。"
  },
  {
    id: "QH-20260801-021",
    stem: "一个正方形边长扩大为原来的 3 倍，面积扩大为原来的多少倍？",
    knowledgePoints: [{ id: "M4-GE-SIM-02", name: "理解相似多边形和相似比" }],
    result: "correct",
    source: "bank",
    type: "选择题",
    date: "8 月 1 日",
    userAnswer: "9 倍",
    correctAnswer: "9 倍",
    analysis: "正确使用相似图形面积比等于相似比平方。"
  }
]);

export const QUESTION_ATTRIBUTE_SCHEMA = Object.freeze({
  schemaVersion: "question-attribute-profile@1.0",
  fields: Object.freeze([
    { key: "knowledgePoints", label: "知识点", kind: "reference-list" },
    { key: "questionType", label: "题型", kind: "enum" },
    { key: "propositionMethod", label: "命题方式", kind: "enum" },
    { key: "abilityLevel", label: "能力层级", kind: "enum" },
    { key: "context", label: "情境", kind: "enum" },
    { key: "difficulty", label: "难度", kind: "ordinal" },
    { key: "strategies", label: "解题策略", kind: "enum-list" },
    { key: "multipleSolutions", label: "多解法", kind: "enum" },
    { key: "source", label: "来源", kind: "enum" },
    { key: "evidenceStatus", label: "证据状态", kind: "enum" }
  ])
});

const QUESTION_PROFILE_OVERRIDES = Object.freeze({
  "QH-20260806-001": {
    propositionMethod: "直接考查",
    abilityLevel: "运算求解",
    context: "纯数学",
    difficulty: "基础",
    strategies: ["数量关系建模", "勾股关系"],
    multipleSolutions: "单一主路径",
    evidenceStatus: "accepted"
  },
  "QH-20260806-002": {
    propositionMethod: "条件重组",
    abilityLevel: "模型建构",
    context: "坐标与函数",
    difficulty: "中等",
    strategies: ["待定系数", "数形结合"],
    multipleSolutions: "鼓励一题多解",
    evidenceStatus: "accepted"
  },
  "QH-20260805-011": {
    propositionMethod: "图表信息",
    abilityLevel: "推理论证",
    context: "几何图形",
    difficulty: "中等",
    strategies: ["寻找对应关系", "比例方程"],
    multipleSolutions: "单一主路径",
    evidenceStatus: "accepted"
  },
  "QH-20260805-010": {
    propositionMethod: "直接考查",
    abilityLevel: "运算求解",
    context: "纯数学",
    difficulty: "基础",
    strategies: ["化为最简二次根式", "合并同类项"],
    multipleSolutions: "单一主路径",
    evidenceStatus: "accepted"
  },
  "QH-20260804-023": {
    propositionMethod: "证明推理",
    abilityLevel: "推理论证",
    context: "几何图形",
    difficulty: "较难",
    strategies: ["构造辅助线", "全等转化"],
    multipleSolutions: "鼓励一题多解",
    evidenceStatus: "supporting"
  },
  "QH-20260804-018": {
    propositionMethod: "图表信息",
    abilityLevel: "运算求解",
    context: "纯数学",
    difficulty: "中等",
    strategies: ["等价变形", "数轴表征"],
    multipleSolutions: "单一主路径",
    evidenceStatus: "accepted"
  },
  "QH-20260803-016": {
    propositionMethod: "直接考查",
    abilityLevel: "数据分析",
    context: "数据情境",
    difficulty: "基础",
    strategies: ["数据整理", "统计量比较"],
    multipleSolutions: "单一主路径",
    evidenceStatus: "accepted"
  },
  "QH-20260803-012": {
    propositionMethod: "情境建模",
    abilityLevel: "数据分析",
    context: "数据情境",
    difficulty: "基础",
    strategies: ["等可能性分析", "数量关系建模"],
    multipleSolutions: "单一主路径",
    evidenceStatus: "accepted"
  },
  "QH-20260802-009": {
    propositionMethod: "反例辨析",
    abilityLevel: "推理论证",
    context: "几何图形",
    difficulty: "中等",
    strategies: ["反例辨析", "充分必要条件"],
    multipleSolutions: "开放性答案",
    evidenceStatus: "accepted"
  },
  "QH-20260801-021": {
    propositionMethod: "变式迁移",
    abilityLevel: "运算求解",
    context: "几何图形",
    difficulty: "基础",
    strategies: ["相似比转化", "数量关系建模"],
    multipleSolutions: "单一主路径",
    evidenceStatus: "accepted"
  }
});

export function getQuestionAttributes(question = {}) {
  const override = {
    ...(QUESTION_PROFILE_OVERRIDES[question.id] || {}),
    ...(question.attributes || {})
  };
  return {
    schemaVersion: QUESTION_ATTRIBUTE_SCHEMA.schemaVersion,
    knowledgePoints: Array.isArray(question.knowledgePoints)
      ? question.knowledgePoints.map((point) => ({ id: String(point.id || ""), name: String(point.name || point.id || "") }))
      : [],
    questionType: String(override.questionType || question.type || "未分类"),
    propositionMethod: String(override.propositionMethod || inferPropositionMethod(question.type)),
    abilityLevel: String(override.abilityLevel || inferAbilityLevel(question.type)),
    context: String(override.context || "未标注"),
    difficulty: String(override.difficulty || "未标注"),
    strategies: normalizeQuestionAttributeList(override.strategies || ["待分析"]),
    multipleSolutions: String(override.multipleSolutions || "未标注"),
    source: String(override.source || question.source || "bank"),
    evidenceStatus: String(
      override.evidenceStatus || (question.result === "partial" ? "supporting" : question.source === "teacher" ? "supporting" : "accepted")
    )
  };
}

function normalizeQuestionAttributeList(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 6);
}

function inferPropositionMethod(questionType) {
  if (questionType === "证明题") return "证明推理";
  if (questionType === "判断题") return "反例辨析";
  return "直接考查";
}

function inferAbilityLevel(questionType) {
  if (questionType === "证明题" || questionType === "判断题") return "推理论证";
  return "运算求解";
}

const WRONG_QUESTION_STORAGE_KEY = "ai-classroom:wrong-question-notes";
const TOO_EASY_STORAGE_KEY = "ai-classroom:too-easy-points";
const QUESTION_DRAFT_STORAGE_KEY = "ai-classroom:question-authoring-drafts";
const CLASSROOM_SESSION_STORAGE_KEY = "ai-classroom:learning-sessions:v1";

function getEffectiveLearningSubjectId() {
  if (globalThis.AITeacherPortalRuntime?.getRole?.() === "teacher") {
    return globalThis.AITeacherPortalRuntime.getSubjectStudentId?.()
      || globalThis.AIClassroomUserRuntime?.getCurrentUserId?.();
  }
  return globalThis.AIClassroomUserRuntime?.getCurrentUserId?.();
}

function userScopedStorageKey(baseKey) {
  return globalThis.AIClassroomUserRuntime?.storageKey?.(baseKey, getEffectiveLearningSubjectId()) || baseKey;
}

export function getQuestionHistory() {
  return [...questionBankState.seedQuestions].map((question) => ({
    ...question,
    attributes: getQuestionAttributes(question)
  }));
}

export function getQuestionsForKnowledgePoint(knowledgePointId) {
  const pointId = String(knowledgePointId || "");
  if (!pointId) return [];
  return getQuestionHistory().filter((question) =>
    Array.isArray(question.knowledgePoints) && question.knowledgePoints.some((point) => String(point.id) === pointId)
  );
}

function formatLocalLearningDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function getLocalLearningPreference(knowledgePointId) {
  try {
    const parsed = JSON.parse(globalThis.sessionStorage?.getItem(userScopedStorageKey(TOO_EASY_STORAGE_KEY)) || "[]");
    const match = Array.isArray(parsed)
      ? parsed.find((item) => item?.knowledge_point_id === knowledgePointId && item.preference === "too_easy")
      : null;
    return match
      ? { ...match, note: "你已标记这个知识点太简单；该偏好不会直接改写掌握度。" }
      : null;
  } catch {
    return null;
  }
}

let graphState = null;
let knowledgeVisuals = null;
let knowledgeResizeObserver = null;
let knowledgePopoverHideTimer = null;
let buddyTimerId = null;
let buddyRemainingSeconds = 25 * 60;
const classroomCurriculumState = {
  catalogId: "junior-math-moe-2022",
  catalogLabel: "初中数学",
  expandedIds: new Set(),
  ontology: null,
  selectedNode: null
};
const questionTreeState = {
  ontology: null,
  expandedThemeIds: new Set(),
  selectedId: "all",
  search: "",
  mobileOpen: false
};
const questionBankState = {
  activeView: "history",
  portraitQuestionId: "",
  generatorDraft: null,
  seedQuestions: [],
  catalogStatus: "idle",
  catalogError: "",
  studentBrowserOpen: false
};
const QUESTION_GENERATION_STEMS = Object.freeze({
  "M4-GE-TRI-10": "一架长 13 m 的梯子斜靠在墙上，梯脚离墙 5 m。求梯子顶端离地面的高度。",
  "M4-NA-FUN-07": "已知一次函数图象经过点（2，5）和（4，9），求该函数的表达式，并说明图象的增减性。",
  "M4-GE-SIM-05": "两个相似三角形的相似比为 2:3，较小三角形的一条对应边长为 8 cm。求较大三角形的对应边长。",
  "M4-NA-REAL-08": "化简并说明每一步的依据：√18 + 2√8。",
  "M4-GE-QUAD-03": "已知四边形 ABCD 是平行四边形，请选择一种方法证明它的两条对角线互相平分。",
  "M4-NA-INEQ-03": "解不等式 4x-7≥9，并把解集准确表示在数轴上。",
  "M4-ST-DATA-04": "一个小组五次测验成绩为 72、78、78、84、93，求平均数、中位数和众数，并选择一个量描述典型水平。",
  "M4-ST-PROB-01": "一个不透明袋中有 4 个白球、3 个黑球和 1 个红球，随机摸出一球。求摸到非黑球的概率。",
  "M4-GE-PROOF-04": "判断命题‘两组对边分别相等的四边形是平行四边形’是否正确，并说明理由。",
  "M4-GE-SIM-02": "一个相似图形的长度放大为原来的 2.5 倍，它的面积会变为原来的多少倍？"
});
const planCalendarToday = startOfPlanDay(new Date());
const planCalendarState = {
  today: planCalendarToday,
  visibleMonth: new Date(planCalendarToday.getFullYear(), planCalendarToday.getMonth(), 1),
  selectedDate: planCalendarToday
};
const classroomCalendarToday = startOfPlanDay(new Date());
const classroomCalendarState = {
  today: classroomCalendarToday,
  visibleMonth: new Date(classroomCalendarToday.getFullYear(), classroomCalendarToday.getMonth(), 1),
  selectedDate: classroomCalendarToday
};
const PLAN_CALENDAR_TOPICS = [
  "一次函数图象与性质",
  "全等三角形判定",
  "二次根式运算",
  "相似三角形对应关系",
  "勾股定理综合应用",
  "整式乘法与因式分解",
  "数据分析与统计图",
  "错题复盘",
  "阶段小测"
];
const classroomSessionState = {
  activeId: "session-1",
  nextId: 2,
  sessions: [
    {
      id: "session-1",
      title: "新对话",
      timeLabel: "现在",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      courseId: "course-junior-math",
      courseName: "初中数学",
      userText: "",
      assistantText: "你好，今天想学什么？",
      userMuted: true,
      assistantMuted: false,
      contextSummary: ""
    }
  ]
};

export function initLearningWorkbench() {
  moveExistingWorkspaces();
  renderKnowledgeShelf();
  bindCatalogCreation();
  bindWorkspaceLinks();
  initClassroomShell();
  bindTextClassroom();
  bindAiTeacherIconTooltips();
  bindRecordTabs();
  bindLearningImport();
  bindQuestionBank();
  bindLearningPlan();
  bindLearningBuddy();
  bindVoiceConfig();
  bindUserScopedWorkbench();
  initKnowledgeGraph();
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function bindUserScopedWorkbench() {
  const refreshUserSurfaces = () => {
    const graphLoading = document.querySelector("#knowledgeGraphLoading");
    const studentStatus = getEducationDataStatus("student");
    const teacherGraph = isTeacherKnowledgeGraph();
    if (graphLoading && !teacherGraph && studentStatus === "loading") {
      graphLoading.hidden = false;
      graphLoading.innerHTML = `<b>正在读取掌握度</b><span>正在加载当前学生的知识点状态。</span>`;
    } else if (graphLoading && !teacherGraph && studentStatus === "error") {
      graphLoading.hidden = false;
      graphLoading.innerHTML = `<b>掌握度读取失败</b><span>${escapeHTML(getEducationDataError("student")?.message || "请稍后重试")}</span>`;
    } else if (graphLoading && (teacherGraph || studentStatus === "ready")) {
      graphLoading.hidden = true;
    }
    if (graphState) {
      const mastery = teacherGraph ? emptyCourseMastery() : getCurrentEducationMastery();
      graphState.mastery = mastery;
      graphState.masteryById = new Map((mastery.records || []).map((record) => [record.knowledge_point_id, record]));
      graphState.selectedId = null;
      graphState.activeView = defaultKnowledgeView();
      graphState.previousView = graphState.activeView;
      syncKnowledgePortalContext();
      updateGraphOverview();
      renderKnowledgeGraph();
    }

    questionBankState.portraitQuestionId = "";
    questionBankState.generatorDraft = null;
    populateQuestionPortraitSelect();
    renderQuestionAttributeStrengths();
    renderQuestionKnowledgeTree();
    renderQuestionBank();
    renderStudentPracticeStart();
    const detail = document.querySelector("#questionDetailPanel");
    if (detail) detail.innerHTML = `<div class="question-detail-empty"><i data-lucide="list-checks" aria-hidden="true"></i><b>选择一道历史题目</b><p>查看当前用户的作答、解析和知识点映射。</p></div>`;
    const portrait = document.querySelector("#questionPortraitContent");
    if (portrait) portrait.replaceChildren();
    renderPlanCalendar();
    renderClassroomLearningContext();
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  };
  document.addEventListener("learning-user:change", refreshUserSurfaces);
  document.addEventListener("learning-user:data-change", refreshUserSurfaces);
  document.addEventListener("learning-subject:change", refreshUserSurfaces);
  document.addEventListener("portal-role:change", refreshUserSurfaces);
}

function renderKnowledgeShelf() {
  const host = document.querySelector("#knowledgeBookShelf");
  if (!host) return;
  document.querySelector("#knowledgeBookShelfLegacy")?.remove();
  let bookIndex = 0;
  const renderBook = (book) => {
    bookIndex += 1;
    const available = book.available === true;
    const status = available ? "学习中" : "即将上线";
    const kind = book.kind || (book.id.startsWith("junior-") || book.id.startsWith("high-") ? "课程标准" : "考试大纲");
    const aria = available
      ? `${book.title}，${book.edition}，已上线，按回车打开`
      : `${book.title}，${book.edition}，内容准备中`;
    return `<div class="knowledge-book-slot" role="listitem">
      <button class="knowledge-book${available ? " is-current" : ""}" type="button"
        style="--book-color:${escapeHTML(book.color)};--book-deep:${escapeHTML(book.deep)}"
        data-catalog-id="${escapeHTML(book.id)}" data-available="${available}"
        data-display-title="${escapeHTML(book.title)}" data-standard-title="${escapeHTML(book.standard)}"
        data-edition="${escapeHTML(book.edition)}" data-publisher="${escapeHTML(book.publisher)}"
        data-scope="${escapeHTML(book.scope)}" ${available ? "" : 'aria-disabled="true"'} aria-label="${escapeHTML(aria)}">
        <span class="book-model"><span class="book-top-edge"></span><span class="book-spine-index">${String(bookIndex).padStart(2, "0")}</span><span class="book-spine-title">${escapeHTML(book.title)}</span><span class="book-spine-subtitle">${escapeHTML(book.subtitle)}</span><span class="book-spine-mark"><i data-lucide="${escapeHTML(book.icon)}"></i></span><span class="book-status">${status}</span><span class="book-cover" aria-hidden="true"><small>${escapeHTML(kind)}</small><strong>${escapeHTML(book.title)}</strong><i data-lucide="${escapeHTML(book.icon)}"></i><span class="book-cover-standard">${escapeHTML(book.standard)}<br /><b>${escapeHTML(book.edition)}</b></span><span class="book-cover-publisher">${escapeHTML(book.publisher)}</span><span class="book-cover-status">${escapeHTML(book.scope)} · ${status}</span></span></span>
      </button>
    </div>`;
  };

  const renderCompartment = (compartment) => {
    const shelfContent = compartment.groups
      ? compartment.groups.map((group) => `<section class="shelf-book-group" aria-label="${escapeHTML(group.title)}"><span class="shelf-book-group-label">${escapeHTML(group.title)}</span><div class="shelf-book-group-volumes">${group.books.map(renderBook).join("")}</div></section>`).join("")
      : compartment.books.map(renderBook).join("");
    return `<section class="shelf-compartment" aria-label="${escapeHTML(compartment.title)}">
      <div class="knowledge-shelf-tier-label"><b>${escapeHTML(compartment.title)}</b><span>${escapeHTML(compartment.note)}</span></div>
      <div class="knowledge-book-shelf${compartment.groups ? " is-grouped" : ""}">${shelfContent}</div>
    </section>`;
  };

  host.innerHTML = SHELF_SECTIONS.map((section) => `<section class="knowledge-shelf-tier${section.compartments.length > 1 ? " is-split" : " is-full"}" aria-label="${escapeHTML(section.compartments.map((item) => item.title).join("与"))}">
    <div class="knowledge-shelf-compartments">${section.compartments.map(renderCompartment).join("")}</div>
    <div class="shelf-plank" aria-hidden="true"><span></span></div>
  </section>`).join("");
}

function bindCatalogCreation() {
  bindEducationImportWorkspace({ activateWorkspace, setRecordTab, showToast });
}

function moveExistingWorkspaces() {
  const settings = document.querySelector("#settings");
  const configMount = document.querySelector("#voiceConfigMount");
  if (settings && configMount && settings.parentElement !== configMount) {
    settings.classList.add("voice-config-form");
    configMount.append(settings);
  }

  const textSheet = document.querySelector("#textInputSheet");
  const textMount = document.querySelector("#textComposerMount");
  if (textSheet && textMount && textSheet.parentElement !== textMount) {
    textSheet.dataset.persistent = "true";
    textSheet.hidden = false;
    textMount.append(textSheet);
  }

  const conversation = document.querySelector("#conversationLog");
  const conversationMount = document.querySelector("#conversationMount");
  if (conversation && conversationMount && conversation.parentElement !== conversationMount) conversationMount.append(conversation);

  const learningContent = document.querySelector("#a2uiPanel");
  const learningContentMount = document.querySelector("#learningContentMount");
  if (learningContent && learningContentMount && learningContent.parentElement !== learningContentMount) learningContentMount.append(learningContent);

  const suggestions = document.querySelector(".teacher-suggestions");
  const suggestionMount = document.querySelector("#teacherSuggestionMount");
  if (suggestions && suggestionMount && suggestions.parentElement !== suggestionMount) suggestionMount.append(suggestions);
  const englishPracticePicker = document.querySelector("#englishPracticePicker");
  if (englishPracticePicker && suggestionMount && englishPracticePicker.parentElement !== suggestionMount) {
    suggestionMount.append(englishPracticePicker);
  }
}

function bindWorkspaceLinks() {
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open-workspace]");
    if (!trigger) return;
    activateWorkspace(trigger.dataset.openWorkspace);
  });
}

function activateWorkspace(view) {
  if (globalThis.AITeacherPortalRuntime?.openWorkspace) {
    globalThis.AITeacherPortalRuntime.openWorkspace(view);
    return;
  }
  document.querySelector(`[data-workspace-view="${view}"]`)?.click();
}

function initClassroomShell() {
  restoreClassroomSessions();
  bindStudentLearningStartActions();
  bindClassroomVoiceOverlay();
  bindClassroomMenus();
  bindClassroomCurriculumPicker();
  bindClassroomLearningCalendar();
  observeClassroomQuestionTitle();
  bindClassroomLearningContext();
  renderClassroomLearningContext();
  renderClassroomLearningCalendar();
  updateClassroomConversationHeader();
  notifyAiTeacherConversationChange(false);
}

function bindClassroomLearningContext() {
  document.querySelector("#classroomLearningFocusList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-classroom-focus-point-id]");
    if (!button) return;
    const ontology = classroomCurriculumState.ontology || getEducationOntology();
    const point = ontology?.knowledge_points?.find((item) => item.id === button.dataset.classroomFocusPointId);
    if (point) selectClassroomCurriculumPoint(point);
  });
}

function renderClassroomLearningContext() {
  const root = document.querySelector("#classroomLearningContext");
  if (!root) return;
  const compactMastery = document.querySelector("#classroomCompactMastery");
  const compactMasteryLabel = document.querySelector("#classroomCompactMasteryLabel");
  const coverage = root.querySelector("#classroomMasteryCoverage");
  const average = root.querySelector("#classroomMasteryAverage");
  const bar = root.querySelector("#classroomMasteryBar");
  const focusTitle = root.querySelector("#classroomLearningFocusTitle");
  const focusUpdated = root.querySelector("#classroomLearningUpdated");
  const focusList = root.querySelector("#classroomLearningFocusList");
  const countTargets = {
    mastered: root.querySelector("#classroomMasteredCount"),
    learning: root.querySelector("#classroomLearningCount"),
    weak: root.querySelector("#classroomWeakCount"),
    unassessed: root.querySelector("#classroomUnassessedCount")
  };

  const setEmpty = (description, { error = false } = {}) => {
    root.classList.toggle("is-error", error);
    root.classList.remove("has-mastery");
    if (coverage) coverage.textContent = description;
    if (average) average.textContent = "—";
    Object.values(countTargets).forEach((target) => {
      if (target) target.textContent = "—";
    });
    bar?.querySelectorAll("[data-mastery-segment]").forEach((segment) => {
      segment.style.flexGrow = "0";
    });
    if (bar) bar.setAttribute("aria-label", description);
    if (focusTitle) focusTitle.textContent = "建议先学";
    if (focusUpdated) focusUpdated.textContent = "等待有效学习记录";
    if (focusList) focusList.innerHTML = `<span>${escapeHTML(description)}</span>`;
    if (compactMasteryLabel) compactMasteryLabel.textContent = description;
    if (compactMastery) compactMastery.setAttribute("aria-label", description);
  };

  if (getPortalRole() === "teacher") {
    setEmpty("课堂预览不读取学生掌握度");
    if (focusList) focusList.innerHTML = "<span>切换到学生端查看个人建议</span>";
    return;
  }

  const studentStatus = getEducationDataStatus("student");
  if (studentStatus === "loading" || studentStatus === "idle") {
    setEmpty("正在读取掌握记录");
    return;
  }
  if (studentStatus === "error") {
    setEmpty(getEducationDataError("student")?.message || "掌握记录暂时不可用", { error: true });
    return;
  }

  const mastery = getCurrentEducationMastery();
  const profile = getCurrentEducationProfile();
  const ontology = classroomCurriculumState.ontology || getEducationOntology();
  const records = Array.isArray(mastery?.records) ? mastery.records : [];
  const summary = profile?.mastery_summary || {};
  const reduced = records.reduce((counts, record) => {
    const state = MASTERY_META[record.mastery_state] ? record.mastery_state : "unassessed";
    counts[state] += 1;
    return counts;
  }, { mastered: 0, secure: 0, learning: 0, weak: 0, unassessed: 0 });
  const summaryStates = summary.by_state || {};
  const states = {
    mastered: Number(summaryStates.mastered ?? reduced.mastered) + Number(summaryStates.secure ?? reduced.secure),
    learning: Number(summaryStates.learning ?? reduced.learning),
    weak: Number(summaryStates.weak ?? reduced.weak),
    unassessed: Number(summaryStates.unassessed ?? reduced.unassessed)
  };
  const total = Number(summary.knowledge_point_count ?? mastery?.total ?? records.length ?? 0);
  const assessed = Number(summary.assessed_count ?? Math.max(0, total - states.unassessed));
  const averageProbability = summary.average_mastery_probability == null
    ? null
    : Number(summary.average_mastery_probability);

  root.classList.remove("is-error");
  root.classList.toggle("has-mastery", total > 0);
  if (coverage) coverage.textContent = total > 0 ? `已评估 ${assessed}/${total} 个知识点` : "尚无知识点记录";
  if (average) average.textContent = Number.isFinite(averageProbability) ? `${Math.round(averageProbability * 100)}%` : "—";
  const compactAverage = Number.isFinite(averageProbability) ? `${Math.round(averageProbability * 100)}%` : "—";
  if (compactMasteryLabel) compactMasteryLabel.textContent = `掌握 ${compactAverage}`;
  if (compactMastery) {
    compactMastery.setAttribute(
      "aria-label",
      total > 0 ? `查看学习概况，平均掌握度 ${compactAverage}，已评估 ${assessed}/${total} 个知识点` : "查看学习概况"
    );
  }
  Object.entries(countTargets).forEach(([key, target]) => {
    if (target) target.textContent = total > 0 ? String(states[key]) : "—";
  });
  bar?.querySelectorAll("[data-mastery-segment]").forEach((segment) => {
    const count = Math.max(0, Number(states[segment.dataset.masterySegment] || 0));
    segment.style.flexGrow = String(count);
  });
  if (bar) {
    bar.setAttribute("aria-label", total > 0
      ? `共 ${total} 个知识点，已掌握 ${states.mastered} 个，学习中 ${states.learning} 个，待巩固 ${states.weak} 个，未评估 ${states.unassessed} 个`
      : "尚无知识点掌握记录");
  }

  const pointById = new Map((ontology?.knowledge_points || []).map((point) => [point.id, point]));
  const selectedPoint = classroomCurriculumState.selectedNode;
  const selectedRecord = selectedPoint
    ? records.find((record) => record.knowledge_point_id === selectedPoint.id)
    : null;
  const candidates = selectedPoint
    ? [{ point: selectedPoint, record: selectedRecord }]
    : records
      .filter((record) => ["weak", "learning"].includes(record.mastery_state) && pointById.has(record.knowledge_point_id))
      .sort((left, right) => {
        const stateDelta = Number(left.mastery_state !== "weak") - Number(right.mastery_state !== "weak");
        return stateDelta || Number(left.mastery_probability ?? 1) - Number(right.mastery_probability ?? 1);
      })
      .slice(0, 2)
      .map((record) => ({ point: pointById.get(record.knowledge_point_id), record }));

  if (focusTitle) focusTitle.textContent = selectedPoint ? "本轮关注" : "建议先学";
  const latestEvent = (getCurrentEducationEvents()?.items || [])
    .filter((item) => item.occurred_at || item.created_at)
    .sort((left, right) => new Date(right.occurred_at || right.created_at) - new Date(left.occurred_at || left.created_at))[0];
  if (focusUpdated) {
    focusUpdated.textContent = selectedPoint
      ? "已带入当前提问"
      : latestEvent ? `更新于 ${formatClassroomContextTime(latestEvent.occurred_at || latestEvent.created_at)}` : "按当前掌握记录推荐";
  }
  if (focusList) {
    focusList.innerHTML = candidates.length
      ? candidates.map(({ point, record }) => {
        const stateMeta = MASTERY_META[record?.mastery_state] || MASTERY_META.unassessed;
        const probability = Number.isFinite(Number(record?.mastery_probability))
          ? `${Math.round(Number(record.mastery_probability) * 100)}%`
          : "暂无评估";
        return `<button type="button" data-classroom-focus-point-id="${escapeHTML(point.id)}" title="带入提问：${escapeHTML(point.name)}"><span>${escapeHTML(point.name)}</span><small>${escapeHTML(stateMeta.label)} · ${escapeHTML(probability)}</small></button>`;
      }).join("")
      : "<span>当前没有需要优先巩固的知识点</span>";
  }
}

function formatClassroomContextTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "最近一次学习";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function classroomSessionStorageKey() {
  return userScopedStorageKey(CLASSROOM_SESSION_STORAGE_KEY);
}

function restoreClassroomSessions() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(classroomSessionStorageKey()) || "null");
    const sessions = Array.isArray(parsed?.sessions)
      ? parsed.sessions.map(normalizeStoredClassroomSession).filter(Boolean).slice(0, 120)
      : [];
    if (!sessions.length) return;
    classroomSessionState.sessions = sessions;
    classroomSessionState.activeId = sessions.some((item) => item.id === parsed.activeId)
      ? parsed.activeId
      : sessions[0].id;
    classroomSessionState.nextId = Math.max(
      Number(parsed.nextId) || 1,
      ...sessions.map((item) => Number(String(item.id).match(/(\d+)$/)?.[1]) + 1 || 1)
    );
  } catch {
    // The current in-memory session remains available when local persistence is unavailable.
  }
}

function normalizeStoredClassroomSession(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim();
  if (!id) return null;
  const now = new Date().toISOString();
  const userText = normalizeClassroomUserMessage(value.userText);
  return {
    id,
    title: String(value.title || "新对话").slice(0, 80),
    timeLabel: String(value.timeLabel || "").slice(0, 20),
    createdAt: normalizeClassroomTimestamp(value.createdAt, now),
    updatedAt: normalizeClassroomTimestamp(value.updatedAt, value.createdAt || now),
    courseId: String(value.courseId || "course-junior-math").slice(0, 120),
    courseName: String(value.courseName || "初中数学").slice(0, 80),
    userText,
    assistantText: String(value.assistantText || "你好，今天想学什么？").slice(0, 8_000),
    userMuted: userText ? false : value.userMuted !== false,
    assistantMuted: value.assistantMuted === true,
    contextSummary: String(value.contextSummary || "").slice(0, 4_000),
    continuedFrom: String(value.continuedFrom || "").slice(0, 160)
  };
}

function normalizeClassroomUserMessage(value) {
  const text = String(value || "").trim().slice(0, 4_000);
  return /^(等待用户输入|等待你提问|你的文字问题)(?:…|\.\.\.)?$/u.test(text) ? "" : text;
}

function normalizeClassroomTimestamp(value, fallback) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function persistClassroomSessions() {
  try {
    globalThis.localStorage?.setItem(classroomSessionStorageKey(), JSON.stringify({
      activeId: classroomSessionState.activeId,
      nextId: classroomSessionState.nextId,
      sessions: classroomSessionState.sessions.slice(0, 120)
    }));
  } catch {
    // Calendar rendering remains functional for the current page session.
  }
}

function syncStudentLearningStartActions() {
  const actions = document.querySelector("#studentLearningStartActions");
  if (!actions) return;
  const isStudent = globalThis.AITeacherPortalRuntime?.getRole?.() !== "teacher";
  const isFreshConversation = document.querySelector("#userMessageRow")?.classList.contains("is-muted") !== false;
  actions.style.display = isStudent && isFreshConversation ? "" : "none";
}

function bindStudentLearningStartActions() {
  const userRow = document.querySelector("#userMessageRow");
  const userText = document.querySelector("#liveUserMessage");
  if (userRow) new MutationObserver(syncStudentLearningStartActions).observe(userRow, { attributes: true, attributeFilter: ["class"] });
  if (userText) new MutationObserver(syncStudentLearningStartActions).observe(userText, { childList: true, subtree: true, characterData: true });
  document.addEventListener("portal-role:change", syncStudentLearningStartActions);
  syncStudentLearningStartActions();
}

function getActiveClassroomSession() {
  return classroomSessionState.sessions.find((session) => session.id === classroomSessionState.activeId) || null;
}

function captureActiveClassroomSession() {
  const session = getActiveClassroomSession();
  if (!session) return;
  const course = getCurrentClassroomCourse();
  const userMuted = document.querySelector("#userMessageRow")?.classList.contains("is-muted") !== false;
  const nextUserText = userMuted
    ? ""
    : normalizeClassroomUserMessage(document.querySelector("#liveUserMessage")?.textContent);
  const nextAssistantText = document.querySelector("#assistantText")?.textContent?.trim() || "你好，今天想学什么？";
  const assistantMuted = document.querySelector("#assistantMessageRow")?.classList.contains("is-muted") === true;
  const messageChanged = nextUserText !== session.userText
    || nextAssistantText !== session.assistantText
    || userMuted !== session.userMuted
    || assistantMuted !== session.assistantMuted;
  session.userText = nextUserText;
  session.assistantText = nextAssistantText;
  session.userMuted = userMuted;
  session.assistantMuted = assistantMuted;
  if (messageChanged && (nextUserText || session.contextSummary || session.title !== "新对话")) {
    session.updatedAt = new Date().toISOString();
  }
  session.courseId = session.courseId || course.id;
  session.courseName = session.courseName || course.name;
  persistClassroomSessions();
}

function restoreActiveClassroomSession() {
  const session = getActiveClassroomSession();
  if (!session) return;
  const textQuestion = document.querySelector("#textQuestion");
  if (textQuestion) textQuestion.value = "";
  setText("#liveUserMessage", session.userText || "");
  setText("#assistantText", session.assistantText || "你好，今天想学什么？");
  document.querySelector("#userMessageRow")?.classList.toggle("is-muted", session.userMuted !== false);
  document.querySelector("#assistantMessageRow")?.classList.toggle("is-muted", session.assistantMuted === true);
  document.querySelector("#a2uiClearBtn")?.click();
  updateClassroomConversationHeader();
  syncStudentLearningStartActions();
  textQuestion?.focus();
}

function resetVisibleClassroomConversation() {
  const textQuestion = document.querySelector("#textQuestion");
  if (textQuestion) textQuestion.value = "";
  setText("#liveUserMessage", "");
  setText("#assistantText", "你好，今天想学什么？");
  document.querySelector("#userMessageRow")?.classList.add("is-muted");
  document.querySelector("#assistantMessageRow")?.classList.remove("is-muted");
  document.querySelector("#a2uiClearBtn")?.click();
  syncStudentLearningStartActions();
  textQuestion?.focus();
}

function startNewClassroomSession() {
  notifyAiTeacherConversationWillChange();
  captureActiveClassroomSession();
  const id = `session-${classroomSessionState.nextId++}`;
  const now = new Date().toISOString();
  const course = getCurrentClassroomCourse();
  classroomSessionState.sessions.unshift({
    id,
    title: "新对话",
    timeLabel: formatClassroomTime(),
    createdAt: now,
    updatedAt: now,
    courseId: course.id,
    courseName: course.name,
    userText: "",
    assistantText: "你好，今天想学什么？",
    userMuted: true,
    assistantMuted: false,
    contextSummary: ""
  });
  classroomSessionState.activeId = id;
  persistClassroomSessions();
  resetVisibleClassroomConversation();
  updateClassroomConversationHeader();
  renderClassroomLearningCalendar();
  notifyAiTeacherConversationChange(true);
}

function clearActiveClassroomSession() {
  notifyAiTeacherConversationWillChange();
  const session = getActiveClassroomSession();
  if (session) {
    session.title = "新对话";
    session.userText = "";
    session.assistantText = "你好，今天想学什么？";
    session.userMuted = true;
    session.assistantMuted = false;
    session.contextSummary = "";
    session.updatedAt = new Date().toISOString();
  }
  persistClassroomSessions();
  resetVisibleClassroomConversation();
  updateClassroomConversationHeader();
  renderClassroomLearningCalendar();
  notifyAiTeacherConversationChange(true);
}

function notifyAiTeacherConversationChange(reset, extra = {}) {
  document.dispatchEvent(new CustomEvent("ai-teacher:conversation-change", {
    detail: {
      sessionId: classroomSessionState.activeId,
      reset: Boolean(reset),
      ...extra
    }
  }));
}

function notifyAiTeacherConversationWillChange() {
  document.dispatchEvent(new CustomEvent("ai-teacher:conversation-will-change", {
    detail: { sessionId: classroomSessionState.activeId }
  }));
}

function formatClassroomTime() {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

function updateClassroomConversationHeader() {
  const session = getActiveClassroomSession();
  const title = document.querySelector("#teacherConversationTitle");
  if (title) title.textContent = session?.title || "新对话";
  const context = document.querySelector("#teacherConversationContext");
  if (context && session?.continuedFrom) context.textContent = `${session.courseName || "当前课程"} · 延续学习`;
}

function observeClassroomQuestionTitle() {
  const source = document.querySelector("#liveUserMessage");
  if (!source) return;
  const update = () => {
    const value = source.textContent?.trim() || "";
    if (!value || /等待你提问|等待用户输入|你的文字问题/.test(value)) return;
    const session = getActiveClassroomSession();
    if (!session || session.title !== "新对话") return;
    session.title = value.length > 16 ? `${value.slice(0, 16)}…` : value;
    session.updatedAt = new Date().toISOString();
    persistClassroomSessions();
    updateClassroomConversationHeader();
    renderClassroomLearningCalendar();
  };
  new MutationObserver(update).observe(source, { subtree: true, characterData: true, childList: true });
}

function getCurrentClassroomCourse() {
  const course = globalThis.AIClassroomUserRuntime?.getCurrentCourse?.();
  return {
    id: String(course?.id || "course-junior-math"),
    name: String(course?.shortTitle || course?.title || classroomCurriculumState.catalogLabel || "当前课程")
  };
}

function resetClassroomSessionsForCurrentUser() {
  const now = new Date().toISOString();
  const course = getCurrentClassroomCourse();
  classroomSessionState.activeId = "session-1";
  classroomSessionState.nextId = 2;
  classroomSessionState.sessions = [{
    id: "session-1",
    title: "新对话",
    timeLabel: "现在",
    createdAt: now,
    updatedAt: now,
    courseId: course.id,
    courseName: course.name,
    userText: "",
    assistantText: "你好，今天想学什么？",
    userMuted: true,
    assistantMuted: false,
    contextSummary: ""
  }];
  restoreClassroomSessions();
  updateClassroomConversationHeader();
  renderClassroomLearningCalendar();
  notifyAiTeacherConversationChange(true);
}

function getClassroomLearningRecords() {
  const sessionRecords = classroomSessionState.sessions
    .filter((session) => session.title !== "新对话" || normalizeClassroomUserMessage(session.userText) || session.contextSummary || session.continuedFrom)
    .map((session) => ({
      id: `session:${session.id}`,
      kind: "session",
      sessionId: session.id,
      occurredAt: session.updatedAt || session.createdAt,
      dateKey: planDateKey(startOfPlanDay(session.updatedAt || session.createdAt)),
      title: session.title || "学习会话",
      summary: session.contextSummary || session.userText || session.assistantText || "继续本次学习",
      courseId: session.courseId || getCurrentClassroomCourse().id,
      courseName: session.courseName || getCurrentClassroomCourse().name,
      knowledgePointIds: [],
      continuationContext: {
        source_kind: "session",
        source_id: session.id,
        source_date: planDateKey(startOfPlanDay(session.updatedAt || session.createdAt)),
        course_id: session.courseId || getCurrentClassroomCourse().id,
        course_name: session.courseName || getCurrentClassroomCourse().name,
        title: session.title || "学习会话",
        summary: session.contextSummary || "",
        last_user_message: session.userText || "",
        last_teacher_message: session.assistantText || ""
      }
    }));
  const eventItems = Array.isArray(getCurrentEducationEvents()?.items)
    ? getCurrentEducationEvents().items
    : [];
  const eventRecords = collapseClassroomLearningEvents(
    eventItems
      .filter(shouldIncludeClassroomCalendarEvent)
      .map((event, index) => normalizeClassroomLearningEvent(event, index))
      .filter(Boolean)
  );
  return [...sessionRecords, ...eventRecords]
    .sort((left, right) => new Date(right.occurredAt) - new Date(left.occurredAt));
}

function shouldIncludeClassroomCalendarEvent(event) {
  const payload = normalizeClassroomEventPayload(event?.payload);
  const sourceType = String(event?.source_type || "").toLowerCase();
  const outcome = String(payload.outcome || "").toLowerCase();
  return sourceType !== "rebuildable_demo_seed"
    && outcome !== "historical_demo_snapshot";
}

function collapseClassroomLearningEvents(records) {
  const groups = new Map();
  records.forEach((record) => {
    const key = [record.dateKey, record.courseId, record.eventGroupKey || record.id].join("|");
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...record, rawSummary: record.summary, recordCount: 1 });
      return;
    }
    current.recordCount += 1;
    current.knowledgePointIds = [...new Set([
      ...(current.knowledgePointIds || []),
      ...(record.knowledgePointIds || [])
    ])].slice(0, 12);
    if (new Date(record.occurredAt) > new Date(current.occurredAt)) current.occurredAt = record.occurredAt;
  });
  return [...groups.values()].map((record) => {
    const knowledgeCount = record.knowledgePointIds?.length || 0;
    const suffix = record.recordCount > 1 && knowledgeCount > 1 ? ` · 关联 ${knowledgeCount} 个知识点` : "";
    const summary = `${record.rawSummary || record.summary || "已记录一次学习活动"}${suffix}`;
    const continuationContext = {
      ...record.continuationContext,
      summary,
      knowledge_point_ids: record.knowledgePointIds || []
    };
    const { rawSummary, recordCount, eventGroupKey, ...rest } = record;
    return { ...rest, summary, continuationContext };
  });
}

function normalizeClassroomLearningEvent(event, index) {
  const occurredAt = event?.occurred_at || event?.created_at;
  const date = new Date(occurredAt || "");
  if (!Number.isFinite(date.getTime())) return null;
  const payload = normalizeClassroomEventPayload(event?.payload);
  const course = getCurrentClassroomCourse();
  const courseName = String(
    payload.course_name || payload.course_label || payload.subject || payload.scope_label || course.name
  ).slice(0, 100);
  const courseId = String(payload.course_id || payload.course_scope_id || course.id).slice(0, 120);
  const type = String(event?.event_type || "learning_event");
  const title = String(event?.title || classroomLearningEventTypeLabel(type)).slice(0, 160);
  const summary = String(event?.description || payload.summary || payload.outcome || "已记录一次学习活动").slice(0, 1_200);
  const knowledgePointIds = [
    ...(Array.isArray(payload.knowledge_point_ids) ? payload.knowledge_point_ids : []),
    payload.knowledge_point_id
  ].map((item) => String(item || "")).filter(Boolean).slice(0, 12);
  const stableId = String(event?.event_id || event?.id || event?.source_ref || `${date.toISOString()}-${index}`);
  const eventGroupKey = String(payload.evidence_source_ref || event?.source_ref || stableId).slice(0, 240);
  return {
    id: `event:${stableId}:${index}`,
    kind: "event",
    eventType: type,
    occurredAt: date.toISOString(),
    dateKey: planDateKey(startOfPlanDay(date)),
    title,
    summary,
    courseId,
    courseName,
    knowledgePointIds,
    eventGroupKey,
    continuationContext: {
      source_kind: "learning_event",
      source_id: stableId,
      source_date: planDateKey(startOfPlanDay(date)),
      course_id: courseId,
      course_name: courseName,
      title,
      summary,
      knowledge_point_ids: knowledgePointIds
    }
  };
}

function normalizeClassroomEventPayload(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function classroomLearningEventTypeLabel(value) {
  const type = String(value || "").toLowerCase();
  if (/(question|answer|tutor|interaction)/u.test(type)) return "AI教师问答";
  if (/(grade|attempt|assessment|quiz|exam)/u.test(type)) return "练习与测验";
  if (/(import|material|document)/u.test(type)) return "学习资料";
  if (/(plan|task)/u.test(type)) return "学习计划";
  return "学习记录";
}

function classroomLearningEventIcon(record) {
  if (record.kind === "session") return "messages-square";
  const type = String(record.eventType || "").toLowerCase();
  if (/(grade|attempt|assessment|quiz|exam)/u.test(type)) return "list-checks";
  if (/(import|material|document)/u.test(type)) return "book-open-check";
  return "sparkles";
}

function renderClassroomLearningCalendar() {
  const grid = document.querySelector("#classroomCalendarGrid");
  if (!grid) return;
  const month = classroomCalendarState.visibleMonth;
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const leadingDays = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const calendarStart = new Date(year, monthIndex, 1 - leadingDays);
  const records = getClassroomLearningRecords();
  const recordsByDate = new Map();
  records.forEach((record) => {
    if (!recordsByDate.has(record.dateKey)) recordsByDate.set(record.dateKey, []);
    recordsByDate.get(record.dateKey).push(record);
  });
  setText("#classroomCalendarMonthLabel", `${year}年${monthIndex + 1}月`);
  grid.innerHTML = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart.getFullYear(), calendarStart.getMonth(), calendarStart.getDate() + index);
    const key = planDateKey(date);
    const dayRecords = recordsByDate.get(key) || [];
    const selected = samePlanDate(date, classroomCalendarState.selectedDate);
    const today = samePlanDate(date, classroomCalendarState.today);
    const outside = date.getMonth() !== monthIndex;
    const dotKinds = [...new Set(dayRecords.map((record) => record.kind))].slice(0, 3);
    const aria = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日${dayRecords.length ? `，有${dayRecords.length}条学习记录` : "，没有学习记录"}`;
    return `<button class="classroom-calendar-cell${selected ? " is-selected" : ""}${today ? " is-today" : ""}${outside ? " is-outside" : ""}${dayRecords.length ? " has-learning" : ""}" type="button" role="gridcell" data-classroom-calendar-date="${key}" aria-selected="${selected}" aria-label="${aria}">
      <time datetime="${key}">${date.getDate()}</time>
      <span class="classroom-calendar-dots" aria-hidden="true">${dotKinds.map((kind) => `<i class="is-${kind}"></i>`).join("")}</span>
    </button>`;
  }).join("");
  renderClassroomCalendarDay(records);
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function renderClassroomCalendarDay(records = getClassroomLearningRecords()) {
  const host = document.querySelector("#classroomCalendarDaySessions");
  if (!host) return;
  const selectedKey = planDateKey(classroomCalendarState.selectedDate);
  const dayRecords = records.filter((record) => record.dateKey === selectedKey);
  const today = samePlanDate(classroomCalendarState.selectedDate, classroomCalendarState.today);
  const title = classroomCalendarState.selectedDate.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  });
  const courseCount = new Set(dayRecords.map((record) => record.courseName).filter(Boolean)).size;
  setText("#classroomCalendarDayTitle", `${title}${today ? " · 今天" : ""}`);
  setText(
    "#classroomCalendarDaySummary",
    dayRecords.length ? `${dayRecords.length} 次学习 · ${courseCount} 门课程` : "这一天没有学习记录"
  );
  if (!dayRecords.length) {
    host.innerHTML = `<div class="classroom-calendar-empty"><i data-lucide="calendar-clock" aria-hidden="true"></i><b>这一天留给了别的事情</b><p>有问答、练习或课程学习后，这里会出现可继续的记录。</p></div>`;
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
    return;
  }
  host.innerHTML = dayRecords.map((record) => {
    const active = record.kind === "session" && record.sessionId === classroomSessionState.activeId;
    const actionLabel = active && today ? "回到会话" : "继续学习";
    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(record.occurredAt));
    return `<article class="classroom-calendar-session-card is-${record.kind}">
      <span class="classroom-calendar-session-icon" aria-hidden="true"><i data-lucide="${classroomLearningEventIcon(record)}"></i></span>
      <div class="classroom-calendar-session-copy">
        <span><b>${escapeHTML(record.title)}</b><em>${record.kind === "session" ? "会话" : classroomLearningEventTypeLabel(record.eventType)}</em></span>
        <p>${escapeHTML(record.summary)}</p>
        <small>${escapeHTML(record.courseName)} · ${escapeHTML(time)}</small>
      </div>
      <button type="button" data-classroom-continue-record="${escapeHTML(record.id)}">${actionLabel}<i data-lucide="arrow-right" aria-hidden="true"></i></button>
    </article>`;
  }).join("");
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function bindClassroomLearningCalendar() {
  const dialog = document.querySelector("#classroomLearningCalendarDialog");
  const trigger = document.querySelector("#teacherLearningCalendarBtn");
  const closeButton = document.querySelector("#classroomLearningCalendarCloseBtn");
  const grid = document.querySelector("#classroomCalendarGrid");
  const sessions = document.querySelector("#classroomCalendarDaySessions");
  const setOpen = (open) => {
    if (!dialog) return;
    if (open) {
      captureActiveClassroomSession();
      classroomCalendarState.today = startOfPlanDay(new Date());
      renderClassroomLearningCalendar();
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
    trigger?.setAttribute("aria-expanded", String(open));
  };
  trigger?.addEventListener("click", () => setOpen(!dialog?.open));
  closeButton?.addEventListener("click", () => setOpen(false));
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) setOpen(false);
  });
  dialog?.addEventListener("close", () => {
    trigger?.setAttribute("aria-expanded", "false");
    trigger?.focus();
  });
  document.querySelector("#classroomCalendarPrevBtn")?.addEventListener("click", () => moveClassroomCalendarMonth(-1));
  document.querySelector("#classroomCalendarNextBtn")?.addEventListener("click", () => moveClassroomCalendarMonth(1));
  document.querySelector("#classroomCalendarTodayBtn")?.addEventListener("click", () => {
    classroomCalendarState.today = startOfPlanDay(new Date());
    classroomCalendarState.visibleMonth = new Date(
      classroomCalendarState.today.getFullYear(),
      classroomCalendarState.today.getMonth(),
      1
    );
    classroomCalendarState.selectedDate = classroomCalendarState.today;
    renderClassroomLearningCalendar();
  });
  grid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-classroom-calendar-date]");
    if (!button) return;
    const date = parsePlanDateKey(button.dataset.classroomCalendarDate);
    if (!date) return;
    classroomCalendarState.selectedDate = date;
    if (date.getMonth() !== classroomCalendarState.visibleMonth.getMonth() || date.getFullYear() !== classroomCalendarState.visibleMonth.getFullYear()) {
      classroomCalendarState.visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    }
    renderClassroomLearningCalendar();
  });
  sessions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-classroom-continue-record]");
    if (!button) return;
    continueClassroomLearning(button.dataset.classroomContinueRecord);
    setOpen(false);
  });
  document.addEventListener("ai-teacher:turn-completed", updateClassroomSessionFromTurn);
  document.addEventListener("learning-records:change", renderClassroomLearningCalendar);
  document.addEventListener("learning-user:data-change", renderClassroomLearningCalendar);
  document.addEventListener("education-data:ready", renderClassroomLearningCalendar);
  document.addEventListener("learning-user:change", resetClassroomSessionsForCurrentUser);
}

function moveClassroomCalendarMonth(offset) {
  const current = classroomCalendarState.visibleMonth;
  const next = new Date(current.getFullYear(), current.getMonth() + offset, 1);
  const day = Math.min(classroomCalendarState.selectedDate.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate());
  classroomCalendarState.visibleMonth = next;
  classroomCalendarState.selectedDate = new Date(next.getFullYear(), next.getMonth(), day);
  renderClassroomLearningCalendar();
}

function updateClassroomSessionFromTurn(event) {
  const detail = event.detail || {};
  const session = classroomSessionState.sessions.find((item) => item.id === String(detail.sessionId || ""));
  if (!session) return;
  const completedAt = normalizeClassroomTimestamp(detail.completedAt, new Date().toISOString());
  const userText = String(detail.userText || "").trim();
  const assistantText = String(detail.assistantText || "").trim();
  if (session.title === "新对话" && userText) session.title = userText.length > 16 ? `${userText.slice(0, 16)}…` : userText;
  session.userText = userText || session.userText;
  session.assistantText = assistantText || session.assistantText;
  session.userMuted = false;
  session.assistantMuted = false;
  session.contextSummary = [userText, assistantText].filter(Boolean).join("\n").slice(0, 4_000);
  session.updatedAt = completedAt;
  const course = getCurrentClassroomCourse();
  session.courseId = course.id;
  session.courseName = course.name;
  persistClassroomSessions();
  updateClassroomConversationHeader();
  renderClassroomLearningCalendar();
}

function continueClassroomLearning(recordId) {
  captureActiveClassroomSession();
  const record = getClassroomLearningRecords().find((item) => item.id === recordId);
  if (!record) return;
  const isCurrentToday = record.kind === "session"
    && record.sessionId === classroomSessionState.activeId
    && record.dateKey === planDateKey(startOfPlanDay(new Date()));
  if (isCurrentToday) {
    document.querySelector("#textQuestion")?.focus();
    return;
  }
  notifyAiTeacherConversationWillChange();
  const runtime = globalThis.AIClassroomUserRuntime;
  if (record.courseId && runtime?.getCourseCatalog?.().some((course) => course.id === record.courseId)) {
    runtime.selectCourse?.(record.courseId);
  }
  const id = `session-${classroomSessionState.nextId++}`;
  const now = new Date().toISOString();
  const continuationContext = {
    ...record.continuationContext,
    source_date: record.dateKey,
    course_id: record.courseId,
    course_name: record.courseName,
    title: record.title,
    summary: record.summary,
    knowledge_point_ids: record.knowledgePointIds || []
  };
  classroomSessionState.sessions.unshift({
    id,
    title: record.title,
    timeLabel: formatClassroomTime(),
    createdAt: now,
    updatedAt: now,
    courseId: record.courseId,
    courseName: record.courseName,
    userText: "",
    assistantText: `已带入 ${record.dateKey} 的学习记录，可以接着学习。`,
    userMuted: true,
    assistantMuted: false,
    contextSummary: String(record.summary || "").slice(0, 4_000),
    continuedFrom: record.id
  });
  classroomSessionState.activeId = id;
  persistClassroomSessions();
  resetVisibleClassroomConversation();
  updateClassroomConversationHeader();
  const context = document.querySelector("#teacherConversationContext");
  if (context) context.textContent = `${record.courseName} · 已带入 ${formatClassroomContextTime(record.occurredAt)} 的学习`;
  notifyAiTeacherConversationChange(true, { continuationContext });
  renderClassroomLearningCalendar();
  document.querySelector("#textQuestion")?.focus();
}

function bindClassroomVoiceOverlay() {
  const overlay = document.querySelector("#teacherVoiceOverlay");
  const openButton = document.querySelector("#teacherVoiceModeBtn");
  const closeButton = document.querySelector("#teacherVoicePanelCloseBtn");
  const workspace = document.querySelector("#agentWorkspace");
  const setOpen = (open, { restoreFocus = true } = {}) => {
    if (!overlay) return;
    overlay.hidden = !open;
    workspace?.classList.toggle("is-voice-open", open);
    if (workspace) workspace.dataset.classroomMode = open ? "voice" : "text";
    openButton?.setAttribute("aria-expanded", String(open));
    if (open) window.setTimeout(() => document.querySelector("#voicePrimaryBtn")?.focus(), 30);
    else if (restoreFocus) openButton?.focus();
  };
  openButton?.addEventListener("click", () => setOpen(true, { restoreFocus: false }));
  closeButton?.addEventListener("click", () => {
    const endButton = document.querySelector("#closeBtn");
    if (endButton && !endButton.disabled) endButton.click();
    setOpen(false);
  });
  const status = document.querySelector("#status");
  if (status && openButton) {
    const sync = () => openButton.classList.toggle("has-live-voice", !/未连接|连接失败/.test(status.textContent || ""));
    new MutationObserver(sync).observe(status, { subtree: true, characterData: true, childList: true });
    sync();
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay?.hidden === false) {
      event.preventDefault();
      closeButton?.click();
    }
  });
  document.addEventListener("learning-workspace:change", (event) => {
    if (event.detail?.view !== "agent" && overlay?.hidden === false) closeButton?.click();
  });
}

function bindClassroomMenus() {
  const moreButton = document.querySelector("#teacherDialogueMoreBtn");
  const menu = document.querySelector("#teacherDialogueMenu");
  const setMenuOpen = (open) => {
    if (menu) menu.hidden = !open;
    moreButton?.setAttribute("aria-expanded", String(open));
  };
  moreButton?.addEventListener("click", () => setMenuOpen(menu?.hidden !== false));
  menu?.addEventListener("click", (event) => {
    if (event.target.closest('[data-classroom-action="new"]')) startNewClassroomSession();
    if (event.target.closest('[data-classroom-action="clear"]')) clearActiveClassroomSession();
    setMenuOpen(false);
  });
  document.addEventListener("click", (event) => {
    if (menu?.hidden === false && !menu.contains(event.target) && !moreButton?.contains(event.target)) setMenuOpen(false);
  });
}

function bindClassroomCurriculumPicker() {
  const picker = document.querySelector("#curriculumPicker");
  const trigger = document.querySelector("#curriculumPickerBtn");
  const mentionTrigger = document.querySelector("#teacherMentionBtn");
  const textQuestion = document.querySelector("#textQuestion");
  const closeButton = document.querySelector("#curriculumPickerCloseBtn");
  const courseList = document.querySelector("#curriculumCourseList");
  const tree = document.querySelector("#curriculumTree");
  const title = document.querySelector("#curriculumPickerTitle");
  const subtitle = picker?.querySelector(".curriculum-picker-head small");
  const footer = picker?.querySelector(".curriculum-picker-foot");
  let activeTrigger = trigger;

  const syncPickerCopy = (sourceTrigger) => {
    const fromComposer = sourceTrigger === mentionTrigger || sourceTrigger === textQuestion;
    if (title) title.textContent = fromComposer ? "选择知识点" : "选择课标或大纲";
    if (subtitle) {
      subtitle.textContent = fromComposer
        ? "按当前课纲的层级结构选择"
        : "切换已接入课纲，或从当前结构中选择知识点";
    }
    if (footer) {
      footer.textContent = fromComposer
        ? "选中后会将知识点名称与标准 ID 带入本次提问。"
        : "选择知识点后会显式带入输入框，你可以继续编辑再发送。";
    }
  };

  const setOpen = (open, { restoreFocus = true, sourceTrigger = activeTrigger } = {}) => {
    if (!picker) return;
    if (open) activeTrigger = sourceTrigger || trigger;
    picker.hidden = !open;
    trigger?.setAttribute("aria-expanded", String(open && activeTrigger === trigger));
    mentionTrigger?.setAttribute("aria-expanded", String(open && (activeTrigger === mentionTrigger || activeTrigger === textQuestion)));
    if (open) {
      syncPickerCopy(activeTrigger);
      renderClassroomCurriculumCourses();
      window.setTimeout(() => {
        const initialFocus = activeTrigger === trigger
          ? courseList?.querySelector('[aria-selected="true"]') || tree?.querySelector("[role=treeitem]")
          : tree?.querySelector('[aria-selected="true"]') || tree?.querySelector("[role=treeitem]");
        initialFocus?.focus();
      }, 30);
    }
    else if (restoreFocus) activeTrigger?.focus?.();
  };
  trigger?.addEventListener("click", () => setOpen(picker?.hidden !== false, { restoreFocus: false, sourceTrigger: trigger }));
  mentionTrigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(picker?.hidden !== false, { restoreFocus: false, sourceTrigger: mentionTrigger });
  });
  textQuestion?.addEventListener("input", () => {
    const caret = textQuestion.selectionStart ?? textQuestion.value.length;
    if (textQuestion.value[caret - 1] !== "@") return;
    const beforeTrigger = textQuestion.value[caret - 2] || "";
    if (caret > 1 && !/\s/u.test(beforeTrigger)) return;
    setOpen(true, { restoreFocus: false, sourceTrigger: textQuestion });
  });
  closeButton?.addEventListener("click", () => setOpen(false));
  courseList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-curriculum-course-id]");
    if (!button || button.disabled) return;
    const runtime = globalThis.AIClassroomUserRuntime;
    const selected = runtime?.selectCourse?.(button.dataset.curriculumCourseId) || runtime?.getCurrentCourse?.();
    if (selected) syncClassroomCurriculumCourse(selected);
    renderClassroomCurriculumCourses();
  });
  tree?.addEventListener("click", (event) => {
    event.stopPropagation();
    const toggle = event.target.closest("[data-curriculum-toggle]");
    if (toggle) {
      const id = toggle.dataset.curriculumToggle;
      if (classroomCurriculumState.expandedIds.has(id)) classroomCurriculumState.expandedIds.delete(id);
      else classroomCurriculumState.expandedIds.add(id);
      renderClassroomCurriculumTree();
      return;
    }
    const pointButton = event.target.closest("[data-curriculum-point-id]");
    if (!pointButton || !classroomCurriculumState.ontology) return;
    const point = classroomCurriculumState.ontology.knowledge_points.find((item) => item.id === pointButton.dataset.curriculumPointId);
    if (!point) return;
    selectClassroomCurriculumPoint(point);
    setOpen(false, { restoreFocus: false });
  });
  document.addEventListener("click", (event) => {
    if (
      picker?.hidden === false
      && !picker.contains(event.target)
      && !trigger?.contains(event.target)
      && !mentionTrigger?.contains(event.target)
    ) {
      setOpen(false, { restoreFocus: false });
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && picker?.hidden === false) {
      event.preventDefault();
      setOpen(false);
    }
  });
  document.addEventListener("learning-course:change", (event) => {
    const course = event.detail?.course || globalThis.AIClassroomUserRuntime?.getCurrentCourse?.();
    if (!course) return;
    classroomCurriculumState.selectedNode = null;
    classroomCurriculumState.expandedIds.clear();
    syncClassroomCurriculumCourse(course);
    renderClassroomCurriculumCourses();
    void loadClassroomCurriculum();
  });
  renderClassroomCurriculumCourses();
  loadClassroomCurriculum();
}

function renderClassroomCurriculumCourses() {
  const host = document.querySelector("#curriculumCourseList");
  const runtime = globalThis.AIClassroomUserRuntime;
  if (!host || !runtime) return;
  const current = runtime.getCurrentCourse?.();
  const available = (runtime.getCourseCatalog?.() || []).filter((course) => course?.agentScopeId);
  if (!available.length) return;
  host.innerHTML = available.map((course) => {
    const active = course.id === current?.id;
    const meta = course.reference?.curriculumId === "junior-math-moe-2022"
      ? "义务教育数学课程标准（2022年版）"
      : course.description || "已接入受控知识库";
    return `<button class="curriculum-picker-book${active ? " is-active" : ""}" type="button" role="option" aria-selected="${active}" data-curriculum-course-id="${escapeHTML(course.id)}">
      <span class="classroom-icon-surface" aria-hidden="true"><i data-lucide="${escapeHTML(course.icon || "book-open")}"></i></span>
      <span><small>${active ? "当前选择" : "可切换"}</small><b>${escapeHTML(course.shortTitle || course.title)}</b><em>${escapeHTML(meta)}</em></span>
      <i data-lucide="${active ? "check" : "chevron-right"}" aria-hidden="true"></i>
    </button>`;
  }).join("");
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function syncClassroomCurriculumCourse(course) {
  if (!course) return;
  classroomCurriculumState.catalogId = course.reference?.curriculumId || course.agentScopeId || course.id;
  classroomCurriculumState.catalogLabel = course.shortTitle || course.title || "当前课程";
  const name = document.querySelector("#activeCurriculumName");
  const meta = document.querySelector("#activeCurriculumMeta");
  const context = document.querySelector("#teacherConversationContext");
  if (name) name.textContent = classroomCurriculumState.catalogLabel;
  if (meta) {
    meta.textContent = course.reference?.curriculumId === "junior-math-moe-2022"
      ? "2022 课标 · 140 个知识点"
      : course.description || "受控知识库";
  }
  if (context && !classroomCurriculumState.selectedNode) context.textContent = `${classroomCurriculumState.catalogLabel} · 受控知识库`;
}

async function loadClassroomCurriculum() {
  const tree = document.querySelector("#curriculumTree");
  try {
    syncClassroomCurriculumCourse(globalThis.AIClassroomUserRuntime?.getCurrentCourse?.());
    await bootstrapEducationData();
    classroomCurriculumState.ontology = getEducationOntology();
    if (!classroomCurriculumState.ontology) {
      throw new Error(getEducationDataError("ontology")?.message || "知识本体暂时不可用");
    }
    const geometry = classroomCurriculumState.ontology.domains.find((domain) => domain.name === "图形与几何");
    const pythagorean = classroomCurriculumState.ontology.themes.find((theme) => theme.name.includes("勾股"));
    if (geometry) classroomCurriculumState.expandedIds.add(geometry.id);
    if (pythagorean) classroomCurriculumState.expandedIds.add(pythagorean.id);
    renderClassroomCurriculumTree();
    renderClassroomLearningContext();
  } catch (error) {
    if (tree) tree.innerHTML = `<div class="curriculum-tree-error" role="status"><i data-lucide="circle-alert" aria-hidden="true"></i><span>课标目录载入失败，请刷新重试</span></div>`;
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  }
}

function renderClassroomCurriculumTree() {
  const tree = document.querySelector("#curriculumTree");
  const ontology = classroomCurriculumState.ontology;
  if (!tree || !ontology) return;
  const themesByDomain = new Map(ontology.domains.map((domain) => [domain.id, ontology.themes.filter((theme) => theme.domain_id === domain.id).sort((a, b) => a.order - b.order)]));
  const pointsByTheme = new Map(ontology.themes.map((theme) => [theme.id, ontology.knowledge_points.filter((point) => point.theme_id === theme.id).sort((a, b) => (a.visualization?.order || 0) - (b.visualization?.order || 0))]));
  tree.innerHTML = ontology.domains.slice().sort((a, b) => a.order - b.order).map((domain) => {
    const domainOpen = classroomCurriculumState.expandedIds.has(domain.id);
    const themes = themesByDomain.get(domain.id) || [];
    const themeMarkup = domainOpen ? `<div class="curriculum-tree-group" role="group">${themes.map((theme) => {
      const themeOpen = classroomCurriculumState.expandedIds.has(theme.id);
      const points = pointsByTheme.get(theme.id) || [];
      const pointMarkup = themeOpen ? `<div class="curriculum-tree-group curriculum-tree-points" role="group">${points.map((point) => `<button class="curriculum-tree-row is-point${classroomCurriculumState.selectedNode?.id === point.id ? " is-selected" : ""}" type="button" role="treeitem" data-curriculum-point-id="${escapeHTML(point.id)}" aria-selected="${classroomCurriculumState.selectedNode?.id === point.id}" title="带入提问：${escapeHTML(point.name)}"><i data-lucide="file-text" aria-hidden="true"></i><span>${escapeHTML(point.name)}</span><small>P${escapeHTML(point.source_ref?.printed_page || "-")}</small></button>`).join("")}</div>` : "";
      return `<div class="curriculum-tree-branch"><button class="curriculum-tree-row is-theme" type="button" role="treeitem" data-curriculum-toggle="${escapeHTML(theme.id)}" aria-expanded="${themeOpen}"><i class="curriculum-tree-chevron" data-lucide="chevron-right" aria-hidden="true"></i><i data-lucide="book-open" aria-hidden="true"></i><span>${escapeHTML(theme.name)}</span><small>${points.length}</small></button>${pointMarkup}</div>`;
    }).join("")}</div>` : "";
    return `<div class="curriculum-tree-branch"><button class="curriculum-tree-row is-domain" type="button" role="treeitem" data-curriculum-toggle="${escapeHTML(domain.id)}" aria-expanded="${domainOpen}"><i class="curriculum-tree-chevron" data-lucide="chevron-right" aria-hidden="true"></i><i data-lucide="folder" aria-hidden="true"></i><span>${escapeHTML(domain.name)}</span><small>${themes.length} 个主题</small></button>${themeMarkup}</div>`;
  }).join("");
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

export function insertKnowledgeMention(value, selectionStart, selectionEnd, label) {
  const source = String(value || "");
  const normalizedLabel = String(label || "").trim();
  const rawStart = Number.isFinite(selectionStart) ? Number(selectionStart) : source.length;
  const rawEnd = Number.isFinite(selectionEnd) ? Number(selectionEnd) : rawStart;
  const start = Math.max(0, Math.min(source.length, rawStart));
  const end = Math.max(start, Math.min(source.length, rawEnd));
  if (!normalizedLabel) return { value: source, caret: start };

  const before = source.slice(0, start);
  const triggerMatch = before.match(/(^|\s)@[^@\s]*$/u);
  const replaceStart = triggerMatch
    ? start - triggerMatch[0].length + triggerMatch[1].length
    : start;
  const spacer = !triggerMatch && replaceStart > 0 && !/\s/u.test(source[replaceStart - 1] || "") ? " " : "";
  const mention = `${spacer}@${normalizedLabel} `;
  return {
    value: `${source.slice(0, replaceStart)}${mention}${source.slice(end)}`,
    caret: replaceStart + mention.length
  };
}

function selectClassroomCurriculumPoint(point) {
  classroomCurriculumState.selectedNode = point;
  const textQuestion = document.querySelector("#textQuestion");
  if (textQuestion) {
    const start = textQuestion.selectionStart ?? textQuestion.value.length;
    const end = textQuestion.selectionEnd ?? start;
    const insertion = insertKnowledgeMention(textQuestion.value, start, end, point.name);
    textQuestion.value = insertion.value;
    textQuestion.dispatchEvent(new Event("input", { bubbles: true }));
    textQuestion.focus();
    textQuestion.setSelectionRange(insertion.caret, insertion.caret);
  }
  const context = document.querySelector("#teacherConversationContext");
  if (context) context.textContent = `${classroomCurriculumState.catalogLabel} · ${point.name}`;
  document.dispatchEvent(new CustomEvent("classroom-curriculum:select", {
    detail: {
      catalogId: classroomCurriculumState.catalogId,
      nodeId: point.id,
      nodeKind: "knowledge_point",
      label: point.name,
      displayOnly: true
    }
  }));
  renderClassroomCurriculumTree();
  renderClassroomLearningContext();
}

function bindTextClassroom() {
  const textQuestion = document.querySelector("#textQuestion");
  document.querySelectorAll("[data-text-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!textQuestion) return;
      textQuestion.value = button.dataset.textPrompt || "";
      textQuestion.focus();
    });
  });

  mirrorText("#liveUserMessage", "#textChatUserMirror", "你的文字问题会显示在这里。");
  mirrorText("#assistantText", "#textChatAssistantMirror", "你可以直接输入题目，也可以让我按照薄弱知识点安排练习。");
  bindTeacherStageControls();
  bindTeacherComposer();
}

function bindAiTeacherIconTooltips() {
  const root = document.querySelector(".teacher-dual-workspace");
  if (!root || root.dataset.iconTooltipsBound === "true") return;
  root.dataset.iconTooltipsBound = "true";
  const iconButtonSelector = [
    ".classroom-icon-button",
    ".teacher-turn-actions button",
    ".teacher-suggestions button",
    ".ai-composer-tools button",
    ".ai-send-button",
    ".voice-dock .voice-utility-button",
    ".teacher-attachment-preview button",
    ".english-practice-picker header button"
  ].join(",");
  const syncButton = (button) => {
    if (!(button instanceof HTMLButtonElement) || !button.matches(iconButtonSelector)) return;
    const tooltip = String(button.title || button.getAttribute("aria-label") || "").trim();
    if (!tooltip) return;
    button.dataset.uiTooltip = tooltip;
    if (button.closest(".ai-dialogue-head, .teacher-stage-toolbar")) {
      button.dataset.uiTooltipPlacement = "bottom";
    }
  };
  const syncTree = (node) => {
    if (!(node instanceof Element)) return;
    syncButton(node);
    node.querySelectorAll?.(iconButtonSelector).forEach(syncButton);
  };
  syncTree(root);
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") syncButton(mutation.target);
      mutation.addedNodes.forEach(syncTree);
    });
  }).observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title", "aria-label"]
  });
}

function bindTeacherStageControls() {
  const avatarSelect = document.querySelector("#teacherAvatarSelect");
  const voiceSelect = document.querySelector("#teacherVoiceShortcut");
  const avatar = document.querySelector("#agentAvatar img");
  const avatarRoot = document.querySelector("#agentAvatar");
  const personaName = document.querySelector("#teacherPersonaName");
  const voiceTitle = document.querySelector("#teacherVoiceOverlayTitle");
  const avatarProfiles = {
    lin: {
      name: "林老师",
      src: "./assets/teachers/math-teacher-lin.jpg",
      tone: "",
      voice: "zh_female_vv_jupiter_bigtts"
    },
    zhou: {
      name: "周老师",
      src: "./assets/teachers/science-teacher-zhou.jpg",
      tone: "is-calm",
      voice: "zh_male_yunzhou_jupiter_bigtts"
    },
    su: {
      name: "苏老师",
      src: "./assets/teachers/humanities-teacher-su.jpg",
      tone: "is-warm",
      voice: "zh_female_xiaohe_jupiter_bigtts"
    }
  };

  function applyTeacherProfile(profileId, { syncVoice = true } = {}) {
    const resolvedProfileId = avatarProfiles[profileId] ? profileId : "lin";
    const profile = avatarProfiles[resolvedProfileId];
    if (avatarSelect && avatarSelect.value !== resolvedProfileId) {
      avatarSelect.value = resolvedProfileId;
    }
    if (avatar) {
      avatar.src = profile.src;
      avatar.alt = `${profile.name}形象`;
    }
    if (personaName) personaName.textContent = profile.name;
    if (voiceTitle) {
      voiceTitle.textContent = voiceTitle.dataset.practiceLabel || `与${profile.name}语音交流`;
    }
    avatarRoot?.classList.remove("is-lively", "is-calm", "is-warm");
    if (profile.tone) avatarRoot?.classList.add(profile.tone);
    if (syncVoice && voiceSelect && voiceSelect.value !== profile.voice) {
      voiceSelect.value = profile.voice;
      voiceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  avatarSelect?.addEventListener("change", () => {
    applyTeacherProfile(avatarSelect.value);
  });

  voiceSelect?.addEventListener("change", (event) => {
    const linkedProfileEntry = Object.entries(avatarProfiles).find(
      ([, profile]) => profile.voice === event.currentTarget.value
    );
    if (linkedProfileEntry && avatarSelect?.value !== linkedProfileEntry[0]) {
      applyTeacherProfile(linkedProfileEntry[0], { syncVoice: false });
    }
    const voice = document.querySelector("#voice");
    if (!voice) return;
    if (voice.value !== event.currentTarget.value) {
      voice.value = event.currentTarget.value;
      voice.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  document.querySelector("#teacherSpeedShortcut")?.addEventListener("change", (event) => {
    const value = event.currentTarget.value;
    const speed = document.querySelector("#speed");
    const speedNumber = document.querySelector("#speedNumber");
    if (speed) {
      speed.value = value;
      speed.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (speedNumber) {
      speedNumber.value = value;
      speedNumber.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function bindTeacherComposer() {
  const attachmentInput = document.querySelector("#teacherAttachmentInput");
  const attachmentPreview = document.querySelector("#teacherAttachmentPreview");
  const attachmentThumbnail = document.querySelector("#teacherAttachmentThumbnail");
  const attachmentName = document.querySelector("#teacherAttachmentName");
  const attachmentMode = document.querySelector("#teacherAttachmentMode");
  const photoModeButtons = [...document.querySelectorAll("[data-teacher-photo-mode]")];
  const imageTaskModes = Object.freeze({
    auto: {
      label: "上传图片（自动识别）",
      preview: "将由AI识别",
      alt: "待识别图片预览"
    },
    solve: {
      label: "拍题解答",
      preview: "将拍题解答",
      alt: "待解答题目图片预览"
    },
    grade: {
      label: "作业批改",
      preview: "将批改整页作业",
      alt: "待批改作业图片预览"
    }
  });
  let activeImageTaskMode = imageTaskModes[attachmentInput?.dataset.imageTaskMode]
    ? attachmentInput.dataset.imageTaskMode
    : "auto";
  let attachmentObjectUrl = "";

  const syncImageTaskMode = (mode, { choosing = false } = {}) => {
    activeImageTaskMode = imageTaskModes[mode] ? mode : "auto";
    if (attachmentInput) attachmentInput.dataset.imageTaskMode = activeImageTaskMode;
    const hasAttachment = Boolean(attachmentInput?.files?.[0]);
    const modeMeta = imageTaskModes[activeImageTaskMode];
    photoModeButtons.forEach((button) => {
      const selected = button.dataset.teacherPhotoMode === activeImageTaskMode && (choosing || hasAttachment);
      const buttonMeta = imageTaskModes[button.dataset.teacherPhotoMode] || imageTaskModes.auto;
      const stateLabel = selected && choosing
        ? `${buttonMeta.label}：请选择图片`
        : selected && hasAttachment
          ? `${buttonMeta.label}：已添加图片，点击可更换`
          : buttonMeta.label;
      button.classList.toggle("is-selected", selected);
      button.classList.toggle("is-awaiting-upload", selected && choosing);
      button.classList.toggle("has-attachment", selected && hasAttachment && !choosing);
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute("aria-label", stateLabel);
      button.title = stateLabel;
      button.dataset.uiTooltip = stateLabel;
    });
    if (attachmentMode) attachmentMode.textContent = modeMeta.preview;
    if (attachmentThumbnail) attachmentThumbnail.alt = modeMeta.alt;
  };

  const openAttachmentPicker = (mode) => {
    if (!attachmentInput) return;
    syncImageTaskMode(mode, { choosing: true });
    attachmentInput.click();
  };

  const clearAttachment = () => {
    if (attachmentObjectUrl) URL.revokeObjectURL(attachmentObjectUrl);
    attachmentObjectUrl = "";
    if (attachmentInput) attachmentInput.value = "";
    if (attachmentThumbnail) attachmentThumbnail.removeAttribute("src");
    if (attachmentThumbnail) attachmentThumbnail.hidden = true;
    if (attachmentName) attachmentName.textContent = "图片";
    if (attachmentPreview) attachmentPreview.hidden = true;
    syncImageTaskMode("auto");
  };
  photoModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = imageTaskModes[button.dataset.teacherPhotoMode]
        ? button.dataset.teacherPhotoMode
        : "auto";
      const hasAttachment = Boolean(attachmentInput?.files?.[0]);
      if (hasAttachment && mode !== activeImageTaskMode) {
        syncImageTaskMode(mode);
        showToast(`已切换为${imageTaskModes[mode].label}，点击发送继续`);
        return;
      }
      openAttachmentPicker(mode);
    });
  });
  attachmentInput?.addEventListener("change", () => {
    const file = attachmentInput.files?.[0];
    if (!file) return clearAttachment();
    if (!["image/png", "image/jpeg", "image/webp"].includes(String(file.type || "").toLowerCase())) {
      clearAttachment();
      showToast("仅支持 PNG、JPEG 或 WebP 图片");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      clearAttachment();
      showToast("图片请不要超过 8 MB");
      return;
    }
    if (attachmentObjectUrl) URL.revokeObjectURL(attachmentObjectUrl);
    attachmentObjectUrl = URL.createObjectURL(file);
    if (attachmentThumbnail) {
      attachmentThumbnail.src = attachmentObjectUrl;
      attachmentThumbnail.hidden = false;
    }
    if (attachmentName) attachmentName.textContent = file.name || "题目图片";
    if (attachmentPreview) attachmentPreview.hidden = false;
    syncImageTaskMode(activeImageTaskMode);
    const modeLabel = activeImageTaskMode === "auto" ? "自动识别" : imageTaskModes[activeImageTaskMode].label;
    showToast(`已添加 ${file.name || "图片"} · ${modeLabel}`);
  });
  attachmentInput?.addEventListener("cancel", () => {
    if (attachmentInput.files?.[0]) syncImageTaskMode(activeImageTaskMode);
    else syncImageTaskMode("auto");
  });
  document.querySelector("#teacherAttachmentRemoveBtn")?.addEventListener("click", clearAttachment);
  document.addEventListener("teacher-attachment:clear", clearAttachment);
  syncImageTaskMode(activeImageTaskMode);
  document.querySelector("#newTeacherConversationBtn")?.addEventListener("click", () => {
    startNewClassroomSession();
  });
}

function mirrorText(sourceSelector, targetSelector, fallback) {
  const source = document.querySelector(sourceSelector);
  const target = document.querySelector(targetSelector);
  if (!source || !target) return;
  const update = () => {
    const value = source.textContent?.trim();
    target.textContent = value || fallback;
    target.closest(".text-chat-message")?.classList.toggle("is-placeholder", !value);
  };
  new MutationObserver(update).observe(source, { subtree: true, characterData: true, childList: true });
  update();
}

async function initKnowledgeGraph() {
  const loading = document.querySelector("#knowledgeGraphLoading");
  try {
    await bootstrapEducationData();
    const ontology = getEducationOntology();
    if (!ontology) throw new Error(getEducationDataError("ontology")?.message || "知识本体读取失败");
    const teacherGraph = isTeacherKnowledgeGraph();
    const studentStatus = getEducationDataStatus("student");
    if (!teacherGraph && studentStatus !== "ready") {
      throw new Error(getEducationDataError("student")?.message || "没有可访问的学生掌握度数据");
    }
    const mastery = teacherGraph ? emptyCourseMastery() : getCurrentEducationMastery();
    const visualIndex = await loadLocalKnowledgeVisualCatalog().catch(() => null);
    const visualCatalog = visualIndex ? { artifacts: visualIndex.artifacts } : {};
    graphState = buildGraphState(ontology, mastery, visualCatalog);
    graphState.activeView = defaultKnowledgeView();
    graphState.previousView = graphState.activeView;
    initializeQuestionKnowledgeTree(ontology);
    populateGraphFilters();
    bindKnowledgeShelf();
    bindGraphControls();
    syncKnowledgePortalContext();
    updateGraphOverview();
    renderKnowledgeGraph();
    if (loading) loading.hidden = true;
  } catch (error) {
    if (loading) {
      loading.innerHTML = `<b>知识本体加载失败</b><span>${escapeHTML(error?.message || String(error))}</span>`;
    }
  }
}

function isTeacherKnowledgeGraph() {
  return getPortalRole() === "teacher";
}

function defaultKnowledgeView() {
  return isTeacherKnowledgeGraph() ? "structure" : "mastery";
}

function emptyCourseMastery() {
  return { records: [], direct_assessment_preferences: [] };
}

function syncKnowledgePortalContext() {
  const teacherGraph = isTeacherKnowledgeGraph();
  const masteryField = document.querySelector("#knowledgeMasteryField");
  if (masteryField) masteryField.hidden = teacherGraph;
  const masterySlideHint = document.querySelector('[data-graph-view="mastery"] small');
  if (masterySlideHint) masterySlideHint.textContent = teacherGraph ? "课程知识关系" : "掌握状态总览";
  const legend = document.querySelector(".mastery-legend-overlay");
  if (legend && teacherGraph) legend.hidden = true;
}

export function buildGraphState(ontology, mastery, visualCatalog = {}) {
  const pointById = new Map((ontology.knowledge_points || []).map((point) => [point.id, point]));
  const themeById = new Map((ontology.themes || []).map((theme) => [theme.id, theme]));
  const domainById = new Map((ontology.domains || []).map((domain) => [domain.id, domain]));
  const masteryById = new Map((mastery.records || []).map((record) => [record.knowledge_point_id, record]));
  const visualByPointId = new Map(
    (visualCatalog.artifacts || []).map((artifact) => [artifact.knowledge_point_id, artifact])
  );
  return {
    ontology,
    mastery,
    pointById,
    themeById,
    domainById,
    masteryById,
    visualCatalog,
    visualByPointId,
    selectedId: null,
    search: "",
    domain: "all",
    masteryFilter: "all",
    relation: "all",
    activeCatalog: "junior-math",
    activeView: "mastery",
    previousView: "mastery",
    expandedThemeIds: new Set(),
    focusedThemeId: null
  };
}

function bindKnowledgeShelf() {
  const shelfView = document.querySelector("#knowledgeShelfView");
  const shelf = document.querySelector("#knowledgeBookShelf");
  const graphView = document.querySelector("#knowledgeGraphView");
  const animation = document.querySelector("#bookOpeningAnimation");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  shelf?.querySelectorAll(".knowledge-book").forEach((book) => {
    book.addEventListener("click", () => {
      if (!graphState || shelfView?.classList.contains("is-opening")) return;
      const title = book.dataset.displayTitle || book.querySelector(".book-spine-title")?.textContent || "这门科目";
      if (book.dataset.available !== "true") {
        showToast(`${title}即将上线`);
        return;
      }
      graphState.activeCatalog = book.dataset.catalogId || "junior-math";
      graphState.activeView = defaultKnowledgeView();
      graphState.previousView = graphState.activeView;
      shelf.querySelectorAll(".knowledge-book").forEach((item) => item.classList.remove("is-selected"));
      book.classList.add("is-selected");
      syncOpeningBook(book);
      shelfView?.classList.add("is-opening");
      animation?.classList.remove("is-opening");
      animation?.classList.add("is-active", "is-pulling");
      animation?.setAttribute("aria-hidden", "false");
      setText("#openingStageText", "正在抽出");
      const openDelay = reducedMotion ? 0 : 430;
      const finishDelay = reducedMotion ? 0 : 1180;
      window.setTimeout(() => {
        animation?.classList.add("is-opening");
        setText("#openingStageText", "正在翻开");
      }, openDelay);
      window.setTimeout(() => {
        if (shelfView) shelfView.hidden = true;
        if (graphView) graphView.hidden = false;
        shelfView?.classList.remove("is-opening");
        animation?.classList.remove("is-active", "is-pulling", "is-opening");
        animation?.setAttribute("aria-hidden", "true");
        showCatalogGraph(book);
      }, finishDelay);
    });
  });

  document.querySelector("#backToKnowledgeShelfBtn")?.addEventListener("click", () => {
    if (graphView) graphView.hidden = true;
    if (shelfView) shelfView.hidden = false;
    shelf?.querySelectorAll(".knowledge-book").forEach((item) => item.classList.remove("is-selected"));
  });
  document.querySelector("#emptyOntologyBackBtn")?.addEventListener("click", () => {
    if (graphView) graphView.hidden = true;
    if (shelfView) shelfView.hidden = false;
  });
}

function syncOpeningBook(book) {
  setText("#openingCoverKind", book.querySelector(".book-cover small")?.textContent || "知识图谱");
  setText("#openingCoverTitle", book.dataset.displayTitle || "知识图谱");
  setText("#openingCoverStandard", book.dataset.standardTitle || "");
  setText("#openingCoverEdition", book.dataset.edition || "");
  const animation = document.querySelector("#bookOpeningAnimation");
  const color = window.getComputedStyle?.(book)?.getPropertyValue("--book-color")?.trim();
  if (animation && color) animation.style.setProperty("--opening-color", color);
}

function showCatalogGraph(book) {
  const content = document.querySelector("#knowledgeGraphContent");
  const empty = document.querySelector("#emptyOntologyState");
  const activeTitle = document.querySelector("#activeOntologyTitle");
  const activeMeta = document.querySelector("#activeOntologyMeta");
  const available = book?.dataset.available === "true";
  const title = book?.dataset.displayTitle || "中考数学";
  if (activeTitle) activeTitle.textContent = title;
  if (activeMeta) {
    activeMeta.textContent = available
      ? `依据《${book?.dataset.standardTitle || "义务教育数学课程标准"}（${book?.dataset.edition || "2022年版"}）》`
      : "内容准备中";
  }
  if (content) content.hidden = !available;
  if (empty) empty.hidden = available;
  const emptyTitle = document.querySelector("#emptyOntologyTitle");
  if (emptyTitle && !available) emptyTitle.textContent = `${title}内容准备中`;
  if (available) scheduleKnowledgeRender();
}

function populateGraphFilters() {
  const domainFilter = document.querySelector("#knowledgeDomainFilter");
  if (!domainFilter || !graphState) return;
  for (const domain of graphState.ontology.domains) {
    const option = document.createElement("option");
    option.value = domain.id;
    option.textContent = domain.name;
    domainFilter.append(option);
  }
}

function bindGraphControls() {
  const search = document.querySelector("#knowledgeGraphSearch");
  const domain = document.querySelector("#knowledgeDomainFilter");
  const mastery = document.querySelector("#knowledgeMasteryFilter");
  const relation = document.querySelector("#knowledgeRelationFilter");
  search?.addEventListener("input", () => {
    graphState.search = search.value.trim().toLowerCase();
    renderKnowledgeGraph();
  });
  domain?.addEventListener("change", () => {
    graphState.domain = domain.value;
    renderKnowledgeGraph();
  });
  mastery?.addEventListener("change", () => {
    graphState.masteryFilter = mastery.value;
    renderKnowledgeGraph();
  });
  relation?.addEventListener("change", () => {
    graphState.relation = relation.value;
    renderKnowledgeGraph();
  });
  document.querySelectorAll("[data-graph-view]").forEach((button) => {
    button.addEventListener("click", () => setKnowledgeView(button.dataset.graphView));
  });
  document.querySelector("#backToGraphOverviewBtn")?.addEventListener("click", () => {
    setKnowledgeView(graphState?.previousView || "mastery");
  });
  document.querySelector("#clearGraphFiltersBtn")?.addEventListener("click", clearGraphFilters);
  document.querySelectorAll("[data-mastery-quick-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      graphState.masteryFilter = button.dataset.masteryQuickFilter || "all";
      if (mastery) mastery.value = graphState.masteryFilter;
      renderKnowledgeGraph();
    });
  });
  document.querySelector("#fitGraphBtn")?.addEventListener("click", () => {
    knowledgeVisuals?.fit(graphState?.activeView || "mastery");
  });
  const actionPopover = document.querySelector("#knowledgeNodeActionPopover");
  actionPopover?.addEventListener("pointerenter", () => {
    if (knowledgePopoverHideTimer) window.clearTimeout(knowledgePopoverHideTimer);
  });
  actionPopover?.addEventListener("pointerleave", scheduleKnowledgeNodeActionsHide);
  actionPopover?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-node-action]")?.dataset.nodeAction;
    const pointId = actionPopover.dataset.pointId;
    const point = graphState?.pointById.get(pointId);
    if (!action || !point) return;
    hideKnowledgeNodeActions();
    if (action === "ask") {
      activateWorkspace("agent");
      const input = document.querySelector("#textQuestion");
      if (input) {
        input.value = `请结合我的掌握情况讲解“${point.name}”。`;
        input.focus();
      }
      return;
    }
    if (action === "practice") {
      openBankForKnowledgePoint(point.id);
      return;
    }
    graphState.selectedId = point.id;
    setKnowledgeView("detail");
  });
  document.querySelector("#knowledgeFocusQuestions")?.addEventListener("click", (event) => {
    const questionButton = event.target.closest("[data-focus-question]");
    if (questionButton) {
      openBankForQuestion(questionButton.dataset.focusQuestion, graphState?.selectedId);
      return;
    }
    if (event.target.closest("[data-focus-question-list]") && graphState?.selectedId) {
      openBankForKnowledgePoint(graphState.selectedId);
    }
  });
  const canvas = document.querySelector("#knowledgeGraphCanvas");
  if (canvas && window.ResizeObserver) {
    knowledgeResizeObserver?.disconnect?.();
    knowledgeResizeObserver = new ResizeObserver(() => knowledgeVisuals?.resize());
    knowledgeResizeObserver.observe(canvas);
  }
  window.addEventListener("resize", () => knowledgeVisuals?.resize());
  document.addEventListener("learning-workspace:change", (event) => {
    if (event.detail?.view === "graph") scheduleKnowledgeRender();
  });
  document.addEventListener("learning-records:change", (event) => {
    if (event.detail?.kind === "too-easy" && graphState?.activeView === "detail") {
      renderKnowledgeDetailView();
    } else if (event.detail?.kind === "wrong-question" && graphState?.activeView === "detail") {
      renderKnowledgeDetailView();
    } else if (event.detail?.kind === "wrong-question" && graphState?.activeView === "focus") {
      renderKnowledgeFocusQuestions();
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      activateWorkspace("graph");
      search?.focus();
    }
  });
}

function clearGraphFilters() {
  if (!graphState) return;
  graphState.search = "";
  graphState.domain = "all";
  graphState.masteryFilter = "all";
  graphState.relation = "all";
  const search = document.querySelector("#knowledgeGraphSearch");
  const domain = document.querySelector("#knowledgeDomainFilter");
  const mastery = document.querySelector("#knowledgeMasteryFilter");
  const relation = document.querySelector("#knowledgeRelationFilter");
  if (search) search.value = "";
  if (domain) domain.value = "all";
  if (mastery) mastery.value = "all";
  if (relation) relation.value = "all";
  renderKnowledgeGraph();
}

function updateGraphOverview() {
  if (!graphState) return;
  const records = [...graphState.masteryById.values()];
  const mastered = records.filter((record) => record.mastery_state === "mastered").length;
  const assessed = records.filter((record) => record.mastery_state !== "unassessed").length;
  const weak = records.filter((record) => record.mastery_state === "weak").length;
  setText("#graphMasteredCoverage", `${Math.round((mastered / records.length) * 100)}%`);
  setText("#graphAssessedCount", `${assessed} / ${records.length}`);
  setText("#graphWeakCount", String(weak));
}

function scheduleKnowledgeRender() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      renderKnowledgeGraph();
      knowledgeVisuals?.resize();
    });
  });
}

function ensureKnowledgeVisuals() {
  if (knowledgeVisuals) return knowledgeVisuals;
  knowledgeVisuals = createKnowledgeVisualizations({
    masteryHost: document.querySelector("#knowledgeMasteryGraph"),
    mindmapHost: document.querySelector("#knowledgeMindmap"),
    dependencyHost: document.querySelector("#knowledgeDependencyGraph"),
    onSelectPoint: (id) => selectKnowledgePoint(id),
    onSelectTheme: (id) => toggleKnowledgeTheme(id),
    onHoverPoint: (id, pointer) => showKnowledgeNodeActions(id, pointer),
    onLeavePoint: scheduleKnowledgeNodeActionsHide
  });
  return knowledgeVisuals;
}

function setKnowledgeView(view) {
  if (!graphState || !["mastery", "structure", "detail"].includes(view)) return;
  hideKnowledgeNodeActions();
  if (view !== "detail") clearKnowledgeDetailWorkbench(document.querySelector("#knowledgeDetailView"));
  graphState.activeView = view;
  if (view !== "detail") graphState.previousView = view;
  renderKnowledgeGraph();
}

function syncKnowledgeViewVisibility() {
  if (!graphState) return;
  const active = graphState.activeView;
  const masteryHost = document.querySelector("#knowledgeMasteryGraph");
  const structureHost = document.querySelector("#knowledgeMindmap");
  const dependencyHost = document.querySelector("#knowledgeDependencyGraph");
  const focusQuestionsHost = document.querySelector("#knowledgeFocusQuestions");
  const detailHost = document.querySelector("#knowledgeDetailView");
  if (masteryHost) masteryHost.hidden = active !== "mastery";
  if (structureHost) structureHost.hidden = active !== "structure";
  if (dependencyHost) dependencyHost.hidden = active !== "focus";
  if (focusQuestionsHost) focusQuestionsHost.hidden = active !== "focus";
  if (detailHost) detailHost.hidden = active !== "detail";
  const navigationView = active === "focus" ? "mastery" : active;
  document.querySelectorAll("[data-graph-view]").forEach((button) => {
    const selected = button.dataset.graphView === navigationView;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  const point = graphState.pointById.get(graphState.selectedId);
  setText("#knowledgeMapModeTitle", active === "focus" ? point?.name || "知识点关系" : active === "structure" ? "思维导图" : active === "detail" ? "知识点详解" : "知识图谱");
  const backButton = document.querySelector("#backToGraphOverviewBtn");
  if (backButton) backButton.hidden = active !== "focus";
  const relationField = document.querySelector("#knowledgeRelationField");
  if (relationField) relationField.hidden = active !== "focus";
  const legend = document.querySelector(".mastery-legend-overlay");
  if (legend) legend.hidden = active !== "mastery" || isTeacherKnowledgeGraph();
  const fitButton = document.querySelector("#fitGraphBtn");
  if (fitButton) fitButton.hidden = active === "detail";
  document.querySelector("#knowledgeGraphCanvas")?.classList.toggle("is-focus-view", active === "focus");
  document.querySelector("#knowledgeGraphCanvas")?.classList.toggle("is-mastery-view", active === "mastery");
  document.querySelector("#knowledgeGraphCanvas")?.classList.toggle("is-detail-view", active === "detail");
}

function renderKnowledgeGraph() {
  if (!graphState) return;
  syncKnowledgeViewVisibility();
  const matchedPoints = graphState.ontology.knowledge_points.filter(matchesGraphFilters);
  const total = graphState.ontology.knowledge_points.length;
  const resultText = graphState.activeView === "focus"
    ? `显示直接相关的知识点 · ${getQuestionsForKnowledgePoint(graphState.selectedId).length} 道关联题`
    : graphState.activeView === "detail"
      ? graphState.pointById.get(graphState.selectedId)?.name || "选择一个知识点"
    : graphState.search || graphState.domain !== "all" || graphState.masteryFilter !== "all"
      ? `找到 ${matchedPoints.length} 个知识点`
      : `${total} 个知识点 · ${graphState.ontology.themes.length} 个主题`;
  setText("#knowledgeGraphResultCount", resultText);
  setText("#knowledgeMapA11ySummary", `中考数学知识图谱，${resultText}`);

  const graphView = document.querySelector("#knowledgeGraphView");
  if (!graphView || graphView.hidden || graphView.offsetParent === null) return;
  const visuals = ensureKnowledgeVisuals();
  const filters = {
    search: graphState.search,
    domain: graphState.domain,
    mastery: graphState.masteryFilter
  };
  try {
    if (graphState.activeView === "mastery") {
      visuals.renderMastery({ ontology: graphState.ontology, masteryById: graphState.masteryById, filters, selectedId: graphState.selectedId });
    } else if (graphState.activeView === "structure") {
      const expandedThemeIds = new Set(graphState.expandedThemeIds);
      if (graphState.search) matchedPoints.forEach((point) => expandedThemeIds.add(point.theme_id));
      visuals.renderStructure({ ontology: graphState.ontology, masteryById: graphState.masteryById, filters, selectedId: graphState.selectedId, expandedThemeIds, focusId: graphState.focusedThemeId });
    } else if (graphState.activeView === "detail") {
      renderKnowledgeDetailView();
    } else if (graphState.selectedId) {
      visuals.renderDependency({ ontology: graphState.ontology, masteryById: graphState.masteryById, selectedId: graphState.selectedId, relationFilter: graphState.relation });
      renderKnowledgeFocusQuestions();
    }
    const loading = document.querySelector("#knowledgeGraphLoading");
    if (loading) loading.hidden = true;
  } catch (error) {
    const loading = document.querySelector("#knowledgeGraphLoading");
    if (loading) {
      loading.hidden = false;
      loading.innerHTML = `<b>知识地图暂时无法显示</b><span>请刷新后重试</span>`;
    }
    console.error("knowledge visualization render failed", error);
  }
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function matchesGraphFilters(point) {
  const mastery = graphState.masteryById.get(point.id) || { mastery_state: "unassessed" };
  if (graphState.domain !== "all" && point.domain_id !== graphState.domain) return false;
  if (graphState.masteryFilter !== "all" && mastery.mastery_state !== graphState.masteryFilter) return false;
  if (!graphState.search) return true;
  const searchable = `${point.name} ${point.measurable_behavior} ${(point.aliases || []).join(" ")}`.toLowerCase();
  return searchable.includes(graphState.search);
}

function toggleKnowledgeTheme(id) {
  if (!graphState?.themeById.has(id)) return;
  if (graphState.expandedThemeIds.has(id)) graphState.expandedThemeIds.delete(id);
  else graphState.expandedThemeIds.add(id);
  graphState.focusedThemeId = id;
  renderKnowledgeGraph();
}

function selectKnowledgePoint(id, { openFocus = true } = {}) {
  if (!graphState?.pointById.has(id)) return;
  hideKnowledgeNodeActions();
  graphState.selectedId = id;
  if (openFocus) {
    if (graphState.activeView !== "focus") graphState.previousView = graphState.activeView;
    graphState.activeView = "focus";
  }
  renderKnowledgeGraph();
}

function renderKnowledgeFocusQuestions() {
  const host = document.querySelector("#knowledgeFocusQuestions");
  const point = graphState?.pointById.get(graphState?.selectedId);
  if (!host || !point) return;
  const questions = getQuestionsForKnowledgePoint(point.id);
  const rows = questions.slice(0, 3).map((question) => `<button type="button" class="knowledge-focus-question-row result-${escapeHTML(question.result || "unknown")}" data-focus-question="${escapeHTML(question.id)}">
    <span class="knowledge-focus-question-result" aria-hidden="true">${question.result === "correct" ? "✓" : question.result === "wrong" ? "×" : "◐"}</span>
    <span><b>${escapeHTML(question.stem)}</b><small>${escapeHTML(question.type)} · ${escapeHTML(sourceLabel(question.source))} · ${escapeHTML(question.date)}</small></span>
    <i data-lucide="chevron-right" aria-hidden="true"></i>
  </button>`).join("");
  host.innerHTML = `<header><div><span>关联题目</span><b>${escapeHTML(point.name)}</b></div><button type="button" data-focus-question-list>${questions.length ? `查看全部 ${questions.length} 道` : "去题库"}</button></header>
    ${rows ? `<div class="knowledge-focus-question-list">${rows}</div>` : `<div class="knowledge-focus-question-empty"><i data-lucide="notebook-tabs" aria-hidden="true"></i><span><b>暂无历史题目</b><small>练习后会按知识点归档到这里</small></span></div>`}`;
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function renderKnowledgeDetailView() {
  const root = document.querySelector("#knowledgeDetailView");
  if (!root || !graphState) return;
  const point = graphState.pointById.get(graphState.selectedId);
  if (!point) {
    root.innerHTML = `<div class="knowledge-detail-empty-state"><i data-lucide="mouse-pointer-click"></i><h3>选择一个知识点</h3><p>从知识图谱进入知识点详解。</p><div class="knowledge-detail-preview-grid" aria-hidden="true"><span></span><span></span><span></span></div></div>`;
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
    return;
  }
  const record = graphState.masteryById.get(point.id) || { mastery_state: "unassessed", mastery_probability: null, confidence: 0, evidence_count: 0 };
  const mastery = MASTERY_META[record.mastery_state] || MASTERY_META.unassessed;
  const relations = getPointRelations(point.id);
  const preference = getLocalLearningPreference(point.id) ||
    graphState.mastery.direct_assessment_preferences?.find((item) => item.knowledge_point_id === point.id);
  const domainName = graphState.domainById.get(point.domain_id)?.name || "";
  const themeName = graphState.themeById.get(point.theme_id)?.name || "";
  renderKnowledgeDetailWorkbench(root, {
    point,
    visualArtifact: graphState.visualByPointId.get(point.id),
    domainName,
    themeName,
    record,
    masteryMeta: mastery,
    relations,
    masteryById: graphState.masteryById,
    preference,
    questions: getQuestionsForKnowledgePoint(point.id),
    onSelectPoint: (id) => {
      if (!graphState.pointById.has(id)) return;
      graphState.selectedId = id;
      graphState.activeView = "detail";
      renderKnowledgeGraph();
    },
    onAsk: (selectedPoint) => {
      activateWorkspace("agent");
      const input = document.querySelector("#textQuestion");
      if (input) {
        input.value = `请结合我的掌握情况讲解“${selectedPoint.name}”，先判断我缺哪一步。`;
        input.focus();
      }
    },
    onPractice: (selectedPoint) => openBankForKnowledgePoint(selectedPoint.id),
    onOpenQuestion: (questionId, selectedPoint) => openBankForQuestion(questionId, selectedPoint.id),
    onOpenQuestionList: (selectedPoint) => openBankForKnowledgePoint(selectedPoint.id)
  });
}

function showKnowledgeNodeActions(id, pointer = {}) {
  const popover = document.querySelector("#knowledgeNodeActionPopover");
  const canvas = document.querySelector("#knowledgeGraphCanvas");
  const point = graphState?.pointById.get(id);
  if (!popover || !canvas || !point) return;
  if (knowledgePopoverHideTimer) window.clearTimeout(knowledgePopoverHideTimer);
  popover.dataset.pointId = id;
  setText("#knowledgeNodeActionTitle", point.name);
  popover.hidden = false;
  const rect = canvas.getBoundingClientRect();
  const clientX = Number(pointer.clientX);
  const clientY = Number(pointer.clientY);
  const desiredLeft = Number.isFinite(clientX) ? clientX - rect.left + 14 : rect.width - 310;
  const desiredTop = Number.isFinite(clientY) ? clientY - rect.top + 14 : 70;
  popover.style.left = `${Math.max(12, Math.min(rect.width - 292, desiredLeft))}px`;
  popover.style.top = `${Math.max(54, Math.min(rect.height - 146, desiredTop))}px`;
}

function scheduleKnowledgeNodeActionsHide() {
  if (knowledgePopoverHideTimer) window.clearTimeout(knowledgePopoverHideTimer);
  knowledgePopoverHideTimer = window.setTimeout(hideKnowledgeNodeActions, 180);
}

function hideKnowledgeNodeActions() {
  const popover = document.querySelector("#knowledgeNodeActionPopover");
  if (popover) popover.hidden = true;
}

function getPointRelations(id) {
  const prerequisites = [];
  const successors = [];
  const related = [];
  for (const edge of graphState.ontology.edges) {
    if (edge.type === "part_of") continue;
    if (edge.type === "prerequisite_of") {
      if (edge.target === id && graphState.pointById.has(edge.source)) prerequisites.push(toRelation(edge.source, edge));
      if (edge.source === id && graphState.pointById.has(edge.target)) successors.push(toRelation(edge.target, edge));
      continue;
    }
    if (edge.source === id && graphState.pointById.has(edge.target)) related.push(toRelation(edge.target, edge));
    else if (edge.target === id && graphState.pointById.has(edge.source)) related.push(toRelation(edge.source, edge));
  }
  return { prerequisites: uniqueRelations(prerequisites), successors: uniqueRelations(successors), related: uniqueRelations(related) };
}

function toRelation(id, edge) {
  return { id, name: graphState.pointById.get(id)?.name || id, type: edge.type, label: RELATION_META[edge.type]?.label || edge.type };
}

function uniqueRelations(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()].slice(0, 8);
}

function renderRelationGroup(title, items) {
  if (!items.length) return `<section class="knowledge-relation-group is-empty"><span>${title}</span><p>暂无直接关联</p></section>`;
  return `<section class="knowledge-relation-group"><span>${title}</span><div>${items.map((item) => `<button type="button" data-select-related="${escapeHTML(item.id)}"><em>${escapeHTML(item.label)}</em>${escapeHTML(item.name)}</button>`).join("")}</div></section>`;
}

function bindRecordTabs() {
  document.querySelectorAll("[data-record-tab]").forEach((button) => {
    button.addEventListener("click", () => setRecordTab(button.dataset.recordTab));
  });
  document.querySelectorAll("[data-record-tab-link]").forEach((button) => {
    button.addEventListener("click", () => setRecordTab(button.dataset.recordTabLink));
  });
  renderQuestionAttributeStrengths();
}

function setRecordTab(tab) {
  document.querySelectorAll("[data-record-tab]").forEach((button) => {
    const active = button.dataset.recordTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-record-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.recordPanel !== tab;
  });
  if (tab === "strengths") renderQuestionAttributeStrengths();
}

function bindLearningImport() {
  bindEducationImportWorkspace({ activateWorkspace, setRecordTab, showToast });
}

function setQuestionBankView(view) {
  const target = ["history", "generator", "portrait"].includes(view) ? view : "history";
  questionBankState.activeView = target;
  document.querySelectorAll("[data-question-bank-view]").forEach((button) => {
    const active = button.dataset.questionBankView === target;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-question-bank-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.questionBankPanel !== target;
  });
  if (target === "portrait") renderQuestionPortrait();
  if (target === "generator") populateQuestionGeneratorKnowledge(questionTreeState.ontology?.knowledge_points);
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function populateQuestionGeneratorKnowledge(points = null) {
  const select = document.querySelector("#questionGeneratorKnowledge");
  if (!select) return;
  const current = select.value;
  const sourcePoints = Array.isArray(points) && points.length
    ? points.map((point) => ({ id: point.id, name: point.name }))
    : getQuestionHistory().flatMap((question) => question.knowledgePoints);
  const unique = [...new Map(sourcePoints.filter((point) => point?.id).map((point) => [point.id, point])).values()];
  unique.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  select.replaceChildren(...unique.map((point) => new Option(point.name, point.id)));
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  else if ([...select.options].some((option) => option.value === "M4-GE-TRI-10")) select.value = "M4-GE-TRI-10";
}

function resetQuestionGenerator() {
  const defaults = {
    questionGeneratorType: "解答题",
    questionGeneratorMethod: "变式迁移",
    questionGeneratorAbility: "运算求解",
    questionGeneratorContext: "生活情境",
    questionGeneratorDifficulty: "中等",
    questionGeneratorStrategy: "数量关系建模",
    questionGeneratorMulti: "鼓励一题多解",
    questionGeneratorSource: "teacher"
  };
  Object.entries(defaults).forEach(([id, value]) => {
    const element = document.querySelector(`#${id}`);
    if (element && [...element.options].some((option) => option.value === value)) element.value = value;
  });
  questionBankState.generatorDraft = null;
  const preview = document.querySelector("#questionGeneratorPreview");
  if (preview) preview.innerHTML = `<div class="question-generator-empty"><i data-lucide="file-pen-line" aria-hidden="true"></i><b>题目预览</b><p>设定属性后生成一道本地演示题。</p></div>`;
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function generateQuestionDraft() {
  const knowledgeSelect = document.querySelector("#questionGeneratorKnowledge");
  const knowledgePointId = knowledgeSelect?.value || "";
  const knowledgePointName = knowledgeSelect?.selectedOptions?.[0]?.textContent || "未选择知识点";
  const readValue = (selector) => document.querySelector(selector)?.value || "";
  const stem = QUESTION_GENERATION_STEMS[knowledgePointId]
    || `围绕“${knowledgePointName}”设计一道需要展示完整思考过程的题目。`;
  const attributes = {
    schemaVersion: QUESTION_ATTRIBUTE_SCHEMA.schemaVersion,
    knowledgePoints: [{ id: knowledgePointId, name: knowledgePointName }],
    questionType: readValue("#questionGeneratorType"),
    propositionMethod: readValue("#questionGeneratorMethod"),
    abilityLevel: readValue("#questionGeneratorAbility"),
    context: readValue("#questionGeneratorContext"),
    difficulty: readValue("#questionGeneratorDifficulty"),
    strategies: [readValue("#questionGeneratorStrategy")].filter(Boolean),
    multipleSolutions: readValue("#questionGeneratorMulti"),
    source: readValue("#questionGeneratorSource") || "teacher",
    evidenceStatus: "pending"
  };
  const draft = {
    id: `QD-${Date.now()}`,
    createdAt: new Date().toISOString(),
    selectedCandidateId: "candidate-a",
    attributes,
    candidates: [
      { id: "candidate-a", label: "候选 A", stem },
      {
        id: "candidate-b",
        label: "候选 B",
        stem: `${stem} 完成后，请再用另一种表征或方法验证结论。`
      }
    ]
  };
  draft.qualityGates = createQuestionQualityGates(draft);
  questionBankState.generatorDraft = draft;
  renderQuestionGeneratorDraft();
}

function createQuestionQualityGates(draft) {
  const attributes = draft.attributes || {};
  const hasControlledKnowledge = Boolean(
    attributes.knowledgePoints?.[0]?.id &&
    (questionTreeState.ontology?.knowledge_points || getQuestionHistory().flatMap((question) => question.knowledgePoints))
      .some((point) => point.id === attributes.knowledgePoints[0].id)
  );
  const requiredFields = ["questionType", "propositionMethod", "abilityLevel", "context", "difficulty", "multipleSolutions", "source"];
  const complete = requiredFields.every((key) => Boolean(attributes[key])) && attributes.strategies?.length > 0;
  const curatedStem = Boolean(QUESTION_GENERATION_STEMS[attributes.knowledgePoints?.[0]?.id]);
  return [
    { id: "knowledge", label: "知识点存在且可追溯", status: hasControlledKnowledge ? "passed" : "blocked" },
    { id: "blueprint", label: "出题蓝图属性完整", status: complete ? "passed" : "blocked" },
    { id: "stem", label: "题干来自受控候选模板", status: curatedStem ? "passed" : "review" },
    { id: "answer", label: "答案与解析需教师复核", status: "review" },
    { id: "evidence", label: "通过审核前不进入学习证据", status: "passed" }
  ];
}

function renderQuestionGeneratorDraft() {
  const root = document.querySelector("#questionGeneratorPreview");
  const draft = questionBankState.generatorDraft;
  if (!root || !draft) return;
  const selected = draft.candidates.find((candidate) => candidate.id === draft.selectedCandidateId) || draft.candidates[0];
  const passed = draft.qualityGates.filter((gate) => gate.status === "passed").length;
  const blocked = draft.qualityGates.some((gate) => gate.status === "blocked");
  root.innerHTML = `<div class="question-authoring-pipeline" aria-label="出题流程"><span class="is-done"><i data-lucide="list-checks"></i><b>出题蓝图</b><small>10 类属性</small></span><span class="is-done"><i data-lucide="files"></i><b>候选生成</b><small>${draft.candidates.length} 道候选</small></span><span class="${blocked ? "is-blocked" : "is-review"}"><i data-lucide="shield-check"></i><b>质量门禁</b><small>${passed} / ${draft.qualityGates.length} 已通过</small></span></div>
    <section class="question-blueprint-summary"><header><span>出题蓝图</span><em>question-attribute-profile@1.0</em></header><div>${renderQuestionAttributeChips(draft.attributes, { includeEvidence: false })}</div></section>
    <section class="question-candidate-section"><header><div><span>候选题目</span><small>选中后再进入审核</small></div><b>${escapeHTML(selected.label)}</b></header><div class="question-candidate-list">${draft.candidates.map((candidate) => `<button type="button" class="question-candidate${candidate.id === draft.selectedCandidateId ? " is-selected" : ""}" data-question-candidate="${escapeHTML(candidate.id)}"><span>${escapeHTML(candidate.label)}</span><p>${escapeHTML(candidate.stem)}</p></button>`).join("")}</div></section>
    <section class="question-quality-gates"><header><span>质量门禁</span><small>只有全部通过才能发布并产生学习证据</small></header><ul>${draft.qualityGates.map((gate) => `<li class="status-${gate.status}"><i data-lucide="${gate.status === "passed" ? "check" : gate.status === "blocked" ? "x" : "triangle-alert"}"></i><span>${escapeHTML(gate.label)}</span><em>${gate.status === "passed" ? "通过" : gate.status === "blocked" ? "阻断" : "待复核"}</em></li>`).join("")}</ul></section>
    <footer class="question-generator-actions"><button type="button" data-regenerate-question-draft><i data-lucide="refresh-cw"></i>换一组</button><button type="button" class="primary-btn" data-save-question-draft${blocked ? " disabled" : ""}><i data-lucide="save"></i>保存待审草稿</button></footer>`;
  root.querySelectorAll("[data-question-candidate]").forEach((button) => {
    button.addEventListener("click", () => {
      draft.selectedCandidateId = button.dataset.questionCandidate;
      renderQuestionGeneratorDraft();
    });
  });
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function saveQuestionDraft() {
  const draft = questionBankState.generatorDraft;
  if (!draft || draft.qualityGates.some((gate) => gate.status === "blocked")) return;
  let saved = [];
  try {
    const parsed = JSON.parse(globalThis.sessionStorage?.getItem(userScopedStorageKey(QUESTION_DRAFT_STORAGE_KEY)) || "[]");
    if (Array.isArray(parsed)) saved = parsed;
  } catch {
    saved = [];
  }
  const selected = draft.candidates.find((candidate) => candidate.id === draft.selectedCandidateId) || draft.candidates[0];
  const record = { ...draft, selectedCandidate: selected, status: "pending_review" };
  globalThis.sessionStorage?.setItem(userScopedStorageKey(QUESTION_DRAFT_STORAGE_KEY), JSON.stringify([record, ...saved].slice(0, 30)));
  showToast("已保存为待审草稿；审核前不会进入题库或学习证据");
}

function populateQuestionPortraitSelect() {
  const select = document.querySelector("#questionPortraitQuestionSelect");
  if (!select) return;
  const questions = getQuestionHistory();
  const current = questionBankState.portraitQuestionId || select.value;
  select.replaceChildren(...questions.map((question) => new Option(`${question.type} · ${question.stem.slice(0, 34)}`, question.id)));
  questionBankState.portraitQuestionId = questions.some((question) => question.id === current) ? current : questions[0]?.id || "";
  select.value = questionBankState.portraitQuestionId;
}

function renderQuestionPortrait() {
  const root = document.querySelector("#questionPortraitContent");
  if (!root) return;
  const questions = getQuestionHistory();
  if (!questionBankState.portraitQuestionId || !questions.some((question) => question.id === questionBankState.portraitQuestionId)) {
    populateQuestionPortraitSelect();
  }
  const question = questions.find((item) => item.id === questionBankState.portraitQuestionId) || questions[0];
  if (!question) {
    root.innerHTML = `<div class="question-generator-empty"><i data-lucide="scan-search" aria-hidden="true"></i><b>暂无可分析的历史题目</b><p>当前用户完成作答后，这里会形成独立的题目画像。</p></div>`;
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
    return;
  }
  const attributes = question.attributes || getQuestionAttributes(question);
  const acceptedCount = questions.filter((item) => item.attributes?.evidenceStatus === "accepted").length;
  const dimensions = ["questionType", "propositionMethod", "abilityLevel", "context", "difficulty", "multipleSolutions", "source", "evidenceStatus"];
  root.innerHTML = `<section class="question-portrait-overview"><div><span>属性维度</span><b>${QUESTION_ATTRIBUTE_SCHEMA.fields.length}</b><small>统一字段模型</small></div><div><span>可用证据</span><b>${acceptedCount}</b><small>共 ${questions.length} 道历史题</small></div><div><span>多解法题</span><b>${questions.filter((item) => item.attributes?.multipleSolutions !== "单一主路径" && item.attributes?.multipleSolutions !== "未标注").length}</b><small>包含开放或多路径</small></div></section>
    <div class="question-portrait-main"><article class="question-profile-sheet"><header><div><span>${escapeHTML(question.id)}</span><h3>${escapeHTML(question.stem)}</h3></div><em class="evidence-${escapeHTML(attributes.evidenceStatus)}">${escapeHTML(evidenceStatusLabel(attributes.evidenceStatus))}</em></header><div class="question-profile-knowledge"><span>知识点</span>${attributes.knowledgePoints.map((point) => `<button type="button" data-portrait-kp="${escapeHTML(point.id)}">${escapeHTML(point.name)}</button>`).join("")}</div><dl>${QUESTION_ATTRIBUTE_SCHEMA.fields.filter((field) => !["knowledgePoints"].includes(field.key)).map((field) => `<div><dt>${escapeHTML(field.label)}</dt><dd>${renderQuestionAttributeValue(attributes, field.key)}</dd></div>`).join("")}</dl><p><i data-lucide="info"></i>题目画像描述“这道题如何考”，不等于学生已掌握对应知识点。</p></article>
      <aside class="question-attribute-distribution"><header><span>当前题库分布</span><small>${questions.length} 道可见题目</small></header>${dimensions.map((key) => renderQuestionDistribution(key, questions)).join("")}</aside></div>`;
  root.querySelectorAll("[data-portrait-kp]").forEach((button) => button.addEventListener("click", () => openGraphForKnowledgePoint(button.dataset.portraitKp)));
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function renderQuestionDistribution(key, questions) {
  const field = QUESTION_ATTRIBUTE_SCHEMA.fields.find((item) => item.key === key);
  const counts = new Map();
  questions.forEach((question) => {
    const value = question.attributes?.[key];
    const values = Array.isArray(value) ? value : [value];
    values.filter(Boolean).forEach((item) => counts.set(item, (counts.get(item) || 0) + 1));
  });
  const entries = [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3);
  const maximum = Math.max(1, ...entries.map((entry) => entry[1]));
  return `<section><span>${escapeHTML(field?.label || key)}</span><div>${entries.map(([value, count]) => `<p><b>${escapeHTML(questionAttributeDisplayValue(key, value))}</b><i><em style="--attribute-width:${Math.round((count / maximum) * 100)}%"></em></i><small>${count}</small></p>`).join("")}</div></section>`;
}

function renderQuestionAttributeValue(attributes, key) {
  const value = attributes[key];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => `<span>${escapeHTML(questionAttributeDisplayValue(key, item))}</span>`).join("");
}

function renderQuestionAttributeChips(attributes, { includeEvidence = true } = {}) {
  const keys = ["questionType", "propositionMethod", "abilityLevel", "context", "difficulty", "strategies", "multipleSolutions", "source"];
  if (includeEvidence) keys.push("evidenceStatus");
  return keys.flatMap((key) => {
    const field = QUESTION_ATTRIBUTE_SCHEMA.fields.find((item) => item.key === key);
    const values = Array.isArray(attributes[key]) ? attributes[key] : [attributes[key]];
    return values.filter(Boolean).map((value) => `<span><small>${escapeHTML(field?.label || key)}</small>${escapeHTML(questionAttributeDisplayValue(key, value))}</span>`);
  }).join("");
}

function questionAttributeDisplayValue(key, value) {
  if (key === "source") return sourceLabel(value);
  if (key === "evidenceStatus") return evidenceStatusLabel(value);
  return String(value || "未标注");
}

function evidenceStatusLabel(status) {
  return ({ accepted: "已采用", supporting: "辅助证据", pending: "待复核" })[status] || "待复核";
}

export function calculateQuestionAttributeStrengths(questions = []) {
  const dimensions = ["questionType", "propositionMethod", "abilityLevel", "context", "difficulty", "strategies", "multipleSolutions", "source"];
  const groups = new Map();
  questions
    .map((question) => ({ ...question, attributes: question.attributes || getQuestionAttributes(question) }))
    .filter((question) => question.attributes.evidenceStatus !== "pending")
    .forEach((question) => {
      const score = question.result === "correct" ? 1 : question.result === "partial" ? 0.5 : 0;
      dimensions.forEach((dimension) => {
        const values = Array.isArray(question.attributes[dimension]) ? question.attributes[dimension] : [question.attributes[dimension]];
        values.filter((value) => value && value !== "未标注" && value !== "待分析").forEach((value) => {
          const key = `${dimension}:${value}`;
          const entry = groups.get(key) || { dimension, value, count: 0, scoreTotal: 0, correct: 0 };
          entry.count += 1;
          entry.scoreTotal += score;
          if (question.result === "correct") entry.correct += 1;
          groups.set(key, entry);
        });
      });
    });
  return [...groups.values()]
    .map((entry) => ({
      ...entry,
      rate: entry.scoreTotal / entry.count,
      label: questionAttributeDisplayValue(entry.dimension, entry.value),
      dimensionLabel: QUESTION_ATTRIBUTE_SCHEMA.fields.find((field) => field.key === entry.dimension)?.label || entry.dimension,
      confidence: entry.count >= 4 ? "high" : entry.count >= 2 ? "medium" : "low"
    }))
    .filter((entry) => entry.count >= 2 && entry.rate >= 0.68)
    .sort((left, right) => right.rate - left.rate || right.count - left.count);
}

function renderQuestionAttributeStrengths() {
  const root = document.querySelector("#questionAttributeStrengths");
  if (!root) return;
  const questions = getQuestionHistory();
  const strengths = calculateQuestionAttributeStrengths(questions).slice(0, 8);
  const accepted = questions.filter((question) => question.attributes?.evidenceStatus !== "pending");
  root.innerHTML = `<header class="attribute-strength-head"><div><span class="page-eyebrow">题目结构优势</span><h2>擅长的题目属性</h2><p>从已作答题目中聚合题型、命题方式、能力层级、情境和策略等表现。</p></div><div><b>${strengths.length}</b><span>项稳定优势</span><small>${accepted.length} 道可用证据</small></div></header>
    <div class="attribute-strength-layout"><section class="attribute-strength-list"><header><span>优势属性</span><small>至少 2 道证据 · 表现度≥68%</small></header>${strengths.length ? strengths.map((item, index) => `<article><span class="attribute-rank">${String(index + 1).padStart(2, "0")}</span><div><small>${escapeHTML(item.dimensionLabel)}</small><b>${escapeHTML(item.label)}</b><i><em style="--strength-width:${Math.round(item.rate * 100)}%"></em></i></div><strong>${Math.round(item.rate * 100)}%</strong><span class="confidence-${item.confidence}">${item.count} 道·${item.confidence === "high" ? "高" : "中"}置信</span></article>`).join("") : `<div class="attribute-strength-empty">还需要更多同类题目证据。</div>`}</section>
      <aside class="attribute-strength-boundary"><i data-lucide="shield-check" aria-hidden="true"></i><h3>如何使用这些优势</h3><ul><li>出题时可保留擅长属性，单独提升难度或变换情境。</li><li>待复核题目不参与优势计算，导入撤销后会重新聚合。</li><li>属性优势不会自动传播为知识点掌握。</li></ul><button type="button" data-open-question-portrait>查看题目画像</button></aside></div>`;
  root.querySelector("[data-open-question-portrait]")?.addEventListener("click", () => {
    activateWorkspace("bank");
    setQuestionBankView("portrait");
  });
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function isStudentPortal() {
  return globalThis.AITeacherPortalRuntime?.getRole?.() !== "teacher";
}

function getStudentPracticePriorityPoints() {
  const mastery = getCurrentEducationMastery();
  const ontology = getEducationOntology();
  const names = new Map((ontology?.knowledge_points || []).map((point) => [String(point.id), point.name]));
  return (mastery?.records || [])
    .filter((record) => ["weak", "learning"].includes(record.mastery_state))
    .map((record) => ({
      id: String(record.knowledge_point_id || ""),
      name: String(record.knowledge_point_name || names.get(String(record.knowledge_point_id)) || "待加强知识点"),
      state: record.mastery_state,
      probability: Number.isFinite(Number(record.mastery_probability)) ? Number(record.mastery_probability) : 1
    }))
    .filter((point) => point.id)
    .sort((left, right) => {
      const stateDiff = Number(left.state !== "weak") - Number(right.state !== "weak");
      return stateDiff || left.probability - right.probability;
    });
}

function setStudentQuestionBrowserOpen(open, { focus = false } = {}) {
  questionBankState.studentBrowserOpen = Boolean(open);
  const teacher = !isStudentPortal();
  const visible = teacher || questionBankState.studentBrowserOpen;
  const start = document.querySelector("#studentPracticeStart");
  const tabs = document.querySelector("#questionBankViewTabs");
  const browser = document.querySelector("#questionBankBrowser");
  const toggle = document.querySelector("#studentQuestionBrowserToggle");

  if (start) start.style.display = teacher ? "none" : "";
  if (tabs) tabs.style.display = visible ? "" : "none";
  if (browser) browser.style.display = visible ? "" : "none";
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(questionBankState.studentBrowserOpen));
    const title = toggle.querySelector("b");
    const meta = toggle.querySelector("small");
    if (title) title.textContent = questionBankState.studentBrowserOpen ? "收起全部题库" : "浏览全部题库";
    if (meta) meta.textContent = questionBankState.studentBrowserOpen ? "回到三个学习入口" : "查看全部题目与筛选器";
  }
  if (visible && focus) window.requestAnimationFrame(() => document.querySelector("#questionBankSearch")?.focus());
}

function renderStudentPracticeStart() {
  const root = document.querySelector("#studentPracticeStart");
  if (!root) return;
  const questions = getQuestionHistory();
  const unattempted = questions.filter((question) => question.result === "unattempted");
  const wrong = questions.filter((question) => question.result === "wrong");
  const priorityPoints = getStudentPracticePriorityPoints();
  const continueButton = root.querySelector('[data-student-practice-entry="continue"]');
  const weakButton = root.querySelector('[data-student-practice-entry="weak"]');
  const wrongButton = root.querySelector('[data-student-practice-entry="wrong"]');

  setText("#studentContinuePracticeMeta", unattempted.length ? `${unattempted.length} 道待练题目` : "暂无待练题目");
  setText("#studentWeakPracticeMeta", priorityPoints.length ? `优先：${priorityPoints[0].name}` : "尚无薄弱点证据");
  setText("#studentWrongPracticeMeta", wrong.length ? `${wrong.length} 道错题待复习` : "暂无错题记录");
  setText("#studentQuestionBrowserMeta", questionBankState.studentBrowserOpen ? "回到三个学习入口" : `${questions.length} 道题目可按知识点筛选`);
  if (continueButton) continueButton.disabled = questionBankState.catalogStatus === "ready" && unattempted.length === 0;
  if (weakButton) weakButton.disabled = priorityPoints.length === 0;
  if (wrongButton) wrongButton.disabled = questionBankState.catalogStatus === "ready" && wrong.length === 0;
  setStudentQuestionBrowserOpen(questionBankState.studentBrowserOpen);
}

function resetQuestionBankFilters() {
  const values = {
    "#questionBankSearch": "",
    "#questionKnowledgeFilter": "all",
    "#questionResultFilter": "all",
    "#questionSourceFilter": "all"
  };
  for (const [selector, value] of Object.entries(values)) {
    const element = document.querySelector(selector);
    if (element) element.value = value;
  }
  questionTreeState.selectedId = "all";
  questionTreeState.search = "";
  const treeSearch = document.querySelector("#questionTreeSearch");
  if (treeSearch) treeSearch.value = "";
}

function openStudentPracticeEntry(kind) {
  if (!isStudentPortal()) return;
  if (kind === "browse" && questionBankState.studentBrowserOpen) {
    setStudentQuestionBrowserOpen(false);
    return;
  }
  resetQuestionBankFilters();
  if (kind === "continue") {
    const result = document.querySelector("#questionResultFilter");
    if (result) result.value = "unattempted";
  } else if (kind === "wrong") {
    const result = document.querySelector("#questionResultFilter");
    if (result) result.value = "wrong";
  } else if (kind === "weak") {
    const point = getStudentPracticePriorityPoints()[0];
    const filter = document.querySelector("#questionKnowledgeFilter");
    const result = document.querySelector("#questionResultFilter");
    const canFilter = point && filter && [...filter.options].some((option) => option.value === point.id);
    if (canFilter) {
      filter.value = point.id;
      questionTreeState.selectedId = point.id;
    }
    if (result) result.value = "unattempted";
  }
  setQuestionBankView("history");
  setStudentQuestionBrowserOpen(true, { focus: kind === "browse" });
  renderQuestionKnowledgeTree();
  renderQuestionBank();
}

function bindQuestionBank() {
  document.querySelectorAll("[data-question-bank-view]").forEach((button) => {
    button.addEventListener("click", () => setQuestionBankView(button.dataset.questionBankView));
  });
  document.querySelector("#questionPortraitQuestionSelect")?.addEventListener("change", (event) => {
    questionBankState.portraitQuestionId = event.currentTarget.value;
    renderQuestionPortrait();
  });
  document.querySelector("#generateQuestionDraftBtn")?.addEventListener("click", generateQuestionDraft);
  document.querySelector("#resetQuestionGeneratorBtn")?.addEventListener("click", resetQuestionGenerator);
  document.querySelector("#questionGeneratorPreview")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-save-question-draft]")) saveQuestionDraft();
    if (event.target.closest("[data-regenerate-question-draft]")) generateQuestionDraft();
  });
  const knowledgeFilter = document.querySelector("#questionKnowledgeFilter");
  const uniqueKnowledgePoints = new Map();
  getQuestionHistory().flatMap((question) => question.knowledgePoints).forEach((point) => uniqueKnowledgePoints.set(point.id, point));
  if (knowledgeFilter) {
    [...uniqueKnowledgePoints.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).forEach((point) => {
      const option = document.createElement("option");
      option.value = point.id;
      option.textContent = point.name;
      knowledgeFilter.append(option);
    });
  }
  ["#questionBankSearch", "#questionResultFilter", "#questionSourceFilter"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener(selector.includes("Search") ? "input" : "change", renderQuestionBank);
  });
  knowledgeFilter?.addEventListener("change", () => {
    questionTreeState.selectedId = knowledgeFilter.value || "all";
    renderQuestionKnowledgeTree();
    renderQuestionBank();
  });
  document.querySelector("#questionTreeSearch")?.addEventListener("input", (event) => {
    questionTreeState.search = event.currentTarget.value.trim().toLowerCase();
    renderQuestionKnowledgeTree();
  });
  document.querySelector("#questionKnowledgeTree")?.addEventListener("click", (event) => {
    const themeButton = event.target.closest("[data-question-theme-toggle]");
    if (themeButton) {
      const id = themeButton.dataset.questionThemeToggle;
      if (questionTreeState.expandedThemeIds.has(id)) questionTreeState.expandedThemeIds.delete(id);
      else questionTreeState.expandedThemeIds.add(id);
      renderQuestionKnowledgeTree();
      return;
    }
    const pointButton = event.target.closest("[data-question-point-id]");
    if (pointButton) selectQuestionTreePoint(pointButton.dataset.questionPointId);
  });
  document.querySelector("#questionTreeAllBtn")?.addEventListener("click", () => selectQuestionTreePoint("all"));
  document.querySelector("#questionTreeCollapseAllBtn")?.addEventListener("click", () => {
    questionTreeState.expandedThemeIds.clear();
    renderQuestionKnowledgeTree();
  });
  document.querySelector("#questionTreeMobileToggle")?.addEventListener("click", () => {
    questionTreeState.mobileOpen = !questionTreeState.mobileOpen;
    syncQuestionTreeMobileState();
  });
  document.querySelector("#resetQuestionFiltersBtn")?.addEventListener("click", () => {
    resetQuestionBankFilters();
    renderQuestionKnowledgeTree();
    renderQuestionBank();
  });
  document.addEventListener("click", (event) => {
    const entry = event.target.closest("[data-student-practice-entry]");
    if (entry && !entry.disabled) openStudentPracticeEntry(entry.dataset.studentPracticeEntry);
  });
  document.addEventListener("learning-records:change", (event) => {
    if (event.detail?.kind !== "wrong-question") return;
    populateQuestionPortraitSelect();
    renderQuestionAttributeStrengths();
    renderQuestionKnowledgeTree();
    renderQuestionBank();
  });
  populateQuestionGeneratorKnowledge();
  populateQuestionPortraitSelect();
  setQuestionBankView("history");
  syncQuestionTreeMobileState();
  renderQuestionBank();
  renderStudentPracticeStart();
  void loadSeedQuestionCatalog();
}

async function loadSeedQuestionCatalog() {
  if (questionBankState.catalogStatus === "loading" || questionBankState.catalogStatus === "ready") return;
  questionBankState.catalogStatus = "loading";
  questionBankState.catalogError = "";
  renderQuestionBank();
  try {
    const catalog = await loadQuestionBankCatalog();
    questionBankState.seedQuestions = [...catalog.items];
    questionBankState.catalogStatus = "ready";
    populateQuestionPortraitSelect();
    renderQuestionKnowledgeTree();
    renderQuestionBank();
    renderStudentPracticeStart();
    if (graphState?.selectedId) renderKnowledgeGraph();
  } catch (error) {
    questionBankState.catalogStatus = "error";
    questionBankState.catalogError = String(error?.message || "题库读取失败");
    renderQuestionBank();
    renderStudentPracticeStart();
  }
}

function initializeQuestionKnowledgeTree(ontology) {
  questionTreeState.ontology = ontology;
  const questionHistory = getQuestionHistory();
  const historyPointIds = new Set(questionHistory.flatMap((question) => question.knowledgePoints.map((point) => point.id)));
  const wrongPointIds = new Set(questionHistory.filter((question) => question.result === "wrong").flatMap((question) => question.knowledgePoints.map((point) => point.id)));
  const historyThemes = ontology.themes.filter((theme) => ontology.knowledge_points.some((point) => point.theme_id === theme.id && (wrongPointIds.has(point.id) || historyPointIds.has(point.id))));
  historyThemes.slice(0, 4).forEach((theme) => questionTreeState.expandedThemeIds.add(theme.id));

  const filter = document.querySelector("#questionKnowledgeFilter");
  if (filter) {
    const current = filter.value || "all";
    filter.replaceChildren(new Option("全部知识点", "all"));
    const themeOrder = new Map(ontology.themes.map((theme, index) => [theme.id, index]));
    ontology.knowledge_points.slice().sort((left, right) => {
      const themeDiff = (themeOrder.get(left.theme_id) || 0) - (themeOrder.get(right.theme_id) || 0);
      return themeDiff || (left.visualization?.order || 0) - (right.visualization?.order || 0);
    }).forEach((point) => filter.append(new Option(point.name, point.id)));
    filter.value = [...filter.options].some((option) => option.value === current) ? current : "all";
  }
  populateQuestionGeneratorKnowledge(ontology.knowledge_points);
  renderQuestionKnowledgeTree();
}

function renderQuestionKnowledgeTree() {
  const root = document.querySelector("#questionKnowledgeTree");
  const ontology = questionTreeState.ontology;
  if (!root) return;
  const allButton = document.querySelector("#questionTreeAllBtn");
  allButton?.classList.toggle("is-selected", questionTreeState.selectedId === "all");
  allButton?.setAttribute("aria-pressed", String(questionTreeState.selectedId === "all"));
  if (!ontology) return;

  setText("#questionTreeAllCount", `${ontology.knowledge_points.length} 个知识点`);
  const questionHistory = getQuestionHistory();
  setText("#questionTreeQuestionCount", `${questionHistory.length} 道题`);
  const questionCounts = new Map();
  for (const question of questionHistory) {
    for (const point of question.knowledgePoints) {
      const count = questionCounts.get(point.id) || { total: 0, wrong: 0 };
      count.total += 1;
      if (question.result === "wrong") count.wrong += 1;
      questionCounts.set(point.id, count);
    }
  }
  const query = questionTreeState.search;
  const domains = ontology.domains.slice().sort((left, right) => left.order - right.order);
  const markup = domains.map((domain) => {
    const themes = ontology.themes.filter((theme) => theme.domain_id === domain.id).sort((left, right) => left.order - right.order);
    const themeMarkup = themes.map((theme) => {
      const allPoints = ontology.knowledge_points.filter((point) => point.theme_id === theme.id).sort((left, right) => (left.visualization?.order || 0) - (right.visualization?.order || 0));
      const themeMatches = !query || `${domain.name} ${theme.name}`.toLowerCase().includes(query);
      const matchedPoints = query && !themeMatches
        ? allPoints.filter((point) => `${point.name} ${point.measurable_behavior} ${(point.aliases || []).join(" ")}`.toLowerCase().includes(query))
        : allPoints;
      if (query && !themeMatches && matchedPoints.length === 0) return "";
      const expanded = Boolean(query) || questionTreeState.expandedThemeIds.has(theme.id);
      const pointMarkup = expanded ? `<div class="question-tree-point-list" role="group">${matchedPoints.map((point) => {
        const count = questionCounts.get(point.id) || { total: 0, wrong: 0 };
        const selected = questionTreeState.selectedId === point.id;
        return `<button type="button" class="question-tree-point${selected ? " is-selected" : ""}" role="treeitem" aria-selected="${selected}" data-question-point-id="${escapeHTML(point.id)}" title="${escapeHTML(point.name)}"><i data-lucide="circle-dot" aria-hidden="true"></i><span>${highlightTreeText(point.name, query)}</span>${count.wrong ? `<em>${count.wrong} 错</em>` : count.total ? `<small>${count.total} 题</small>` : ""}</button>`;
      }).join("")}</div>` : "";
      return `<section class="question-tree-theme"><button type="button" class="question-tree-theme-row" role="treeitem" aria-expanded="${expanded}" data-question-theme-toggle="${escapeHTML(theme.id)}"><i class="question-tree-chevron" data-lucide="chevron-right" aria-hidden="true"></i><span>${highlightTreeText(theme.name, query)}</span><small>${allPoints.length}</small></button>${pointMarkup}</section>`;
    }).join("");
    if (!themeMarkup) return "";
    return `<section class="question-tree-domain" aria-label="${escapeHTML(domain.name)}"><header><i style="--domain-color:${escapeHTML(domain.color || "#6f7f94")}"></i><span>${highlightTreeText(domain.name, query)}</span></header>${themeMarkup}</section>`;
  }).join("");
  root.innerHTML = markup || `<div class="question-tree-empty"><i data-lucide="search-x" aria-hidden="true"></i><b>没有找到相关知识点</b><button type="button" data-clear-question-tree-search>清除搜索</button></div>`;
  root.querySelector("[data-clear-question-tree-search]")?.addEventListener("click", () => {
    questionTreeState.search = "";
    const input = document.querySelector("#questionTreeSearch");
    if (input) input.value = "";
    renderQuestionKnowledgeTree();
  });
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function selectQuestionTreePoint(id) {
  questionTreeState.selectedId = id || "all";
  const filter = document.querySelector("#questionKnowledgeFilter");
  if (filter && [...filter.options].some((option) => option.value === questionTreeState.selectedId)) filter.value = questionTreeState.selectedId;
  if (window.matchMedia?.("(max-width: 820px)")?.matches) {
    questionTreeState.mobileOpen = false;
    syncQuestionTreeMobileState();
  }
  renderQuestionKnowledgeTree();
  renderQuestionBank();
}

function syncQuestionTreeMobileState() {
  const pane = document.querySelector("#questionKnowledgeTreePane");
  const button = document.querySelector("#questionTreeMobileToggle");
  pane?.classList.toggle("is-mobile-open", questionTreeState.mobileOpen);
  button?.setAttribute("aria-expanded", String(questionTreeState.mobileOpen));
  if (button) button.innerHTML = `<i data-lucide="${questionTreeState.mobileOpen ? "panel-left-close" : "panel-left-open"}" aria-hidden="true"></i><span>${questionTreeState.mobileOpen ? "收起课本目录" : "课本知识点"}</span>`;
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function highlightTreeText(value, query) {
  const text = String(value || "");
  if (!query) return escapeHTML(text);
  const index = text.toLowerCase().indexOf(query);
  if (index < 0) return escapeHTML(text);
  return `${escapeHTML(text.slice(0, index))}<mark>${escapeHTML(text.slice(index, index + query.length))}</mark>${escapeHTML(text.slice(index + query.length))}`;
}

export function filterQuestionHistory(questions, filters) {
  const search = String(filters.search || "").trim().toLowerCase();
  return questions.filter((question) => {
    if (filters.knowledge !== "all" && !question.knowledgePoints.some((point) => point.id === filters.knowledge)) return false;
    if (filters.result !== "all" && question.result !== filters.result) return false;
    if (filters.source !== "all" && question.source !== filters.source) return false;
    if (search) {
      const attributes = question.attributes || getQuestionAttributes(question);
      const searchable = `${question.stem} ${question.knowledgePoints.map((point) => point.name).join(" ")} ${attributes.questionType} ${attributes.propositionMethod} ${attributes.abilityLevel} ${attributes.context} ${attributes.difficulty} ${attributes.strategies.join(" ")}`.toLowerCase();
      if (!searchable.includes(search)) return false;
    }
    return true;
  });
}

function renderQuestionBank() {
  const filters = {
    search: document.querySelector("#questionBankSearch")?.value || "",
    knowledge: document.querySelector("#questionKnowledgeFilter")?.value || "all",
    result: document.querySelector("#questionResultFilter")?.value || "all",
    source: document.querySelector("#questionSourceFilter")?.value || "all"
  };
  const questions = filterQuestionHistory(getQuestionHistory(), filters);
  const root = document.querySelector("#questionBankList");
  setText("#questionBankCount", `共 ${questions.length} 道题`);
  if (!root) return;
  if (questionBankState.catalogStatus === "loading") {
    root.innerHTML = `<div class="question-list-empty"><i data-lucide="loader-circle"></i><b>正在读取题库</b><p>正在从教育数据服务加载题目。</p></div>`;
    window.lucide?.createIcons?.();
    return;
  }
  if (questionBankState.catalogStatus === "error") {
    root.innerHTML = `<div class="question-list-empty"><i data-lucide="circle-alert"></i><b>题库读取失败</b><p>${escapeHTML(questionBankState.catalogError || "请稍后重试")}</p></div>`;
    window.lucide?.createIcons?.();
    return;
  }
  root.innerHTML = questions.length ? questions.map((question) => `
    <button type="button" class="question-history-row result-${question.result}" data-question-id="${escapeHTML(question.id)}">
      <span class="question-result-icon">${question.result === "correct" ? "✓" : question.result === "wrong" ? "×" : question.result === "partial" ? "◐" : "·"}</span>
      <span class="question-history-main"><b>${escapeHTML(question.stem)}</b><small>${question.knowledgePoints.map((point) => escapeHTML(point.name)).join(" · ")}</small></span>
      <span class="question-type-tag">${escapeHTML(question.type)}</span>
      <span class="question-source-tag">${escapeHTML(sourceLabel(question.source))}</span>
      <time>${escapeHTML(question.date)}</time>
    </button>`).join("") : `<div class="question-list-empty"><i data-lucide="library"></i><b>题库暂无题目</b><p>当前数据库中没有符合条件的题目。</p></div>`;
  root.querySelectorAll("[data-question-id]").forEach((button) => button.addEventListener("click", () => {
    root.querySelectorAll("[data-question-id]").forEach((row) => row.classList.toggle("is-selected", row === button));
    renderQuestionDetail(button.dataset.questionId);
  }));
  window.lucide?.createIcons?.();
}

function renderQuestionDetail(id) {
  const question = getQuestionHistory().find((item) => item.id === id);
  const root = document.querySelector("#questionDetailPanel");
  if (!question || !root) return;
  const attributes = question.attributes || getQuestionAttributes(question);
  const attempted = question.result !== "unattempted";
  const options = Array.isArray(question.options) && question.options.length
    ? `<ol class="question-public-options">${question.options.map((option) => `<li><span>${escapeHTML(option.id)}</span><p>${escapeHTML(option.text)}</p></li>`).join("")}</ol>`
    : "";
  const reviewNotice = question.raw?.provenance?.review_status === "pending_teacher_review"
    ? `<p class="question-review-notice"><i data-lucide="shield-alert" aria-hidden="true"></i>本题是课标对齐的本地种子题，非官方真题，待教师审核。</p>`
    : "";
  root.innerHTML = `<header><span class="question-detail-result result-${question.result}">${resultLabel(question.result)}</span><small>${escapeHTML(question.date)} · ${escapeHTML(sourceLabel(question.source))}</small></header>
    <h3>${escapeHTML(question.stem)}</h3>
    ${options}
    ${reviewNotice}
    ${attempted ? `<section><span>你的作答</span><p>${escapeHTML(question.userAnswer || "未记录")}</p></section>` : `<section class="question-unattempted-note"><span>练习状态</span><p>这道题尚未作答，不会写入个人掌握证据。</p></section>`}
    <section class="question-solution-disclosure">
      <button type="button" data-reveal-question-solution aria-expanded="false"><i data-lucide="eye" aria-hidden="true"></i><span>查看解题思路</span></button>
      <div class="question-solution-content" data-question-solution-content hidden></div>
    </section>
    <section class="question-kp-list"><span>知识点映射</span>${question.knowledgePoints.map((point) => `<button type="button" data-question-kp="${escapeHTML(point.id)}">${escapeHTML(point.name)}</button>`).join("")}</section>
    <section class="question-detail-portrait"><span>题目画像</span><div>${renderQuestionAttributeChips(attributes, { includeEvidence: true })}</div><button type="button" data-show-question-portrait>查看完整画像</button></section>
    <div class="question-detail-actions">${attempted ? `<button type="button">加入错题本</button>` : ""}<button type="button" class="primary-btn" data-ask-similar>让AI教师出相似题</button></div>`;
  root.querySelectorAll("[data-question-kp]").forEach((button) => button.addEventListener("click", () => openGraphForKnowledgePoint(button.dataset.questionKp)));
  root.querySelector("[data-reveal-question-solution]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const content = root.querySelector("[data-question-solution-content]");
    if (!content) return;
    if (button.getAttribute("aria-expanded") === "true") {
      button.setAttribute("aria-expanded", "false");
      button.querySelector("span").textContent = "查看解题思路";
      content.hidden = true;
      return;
    }
    button.disabled = true;
    button.querySelector("span").textContent = "正在读取解题思路…";
    try {
      const solution = question.raw
        ? await revealQuestionSolution(question.id)
        : createLocalQuestionSolution(question);
      content.innerHTML = renderQuestionSolution(solution);
      content.hidden = false;
      button.setAttribute("aria-expanded", "true");
      button.querySelector("span").textContent = "收起解题思路";
      window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
    } catch (error) {
      content.innerHTML = `<p class="question-solution-error">${escapeHTML(error?.message || "解题思路暂时无法读取")}</p>`;
      content.hidden = false;
      button.setAttribute("aria-expanded", "true");
      button.querySelector("span").textContent = "重试查看";
    } finally {
      button.disabled = false;
    }
  });
  root.querySelector("[data-ask-similar]")?.addEventListener("click", () => {
    activateWorkspace("agent");
    const input = document.querySelector("#textQuestion");
    if (input) input.value = `参考我做过的题“${question.stem}”，生成一道结构相似但数值和情境不同的新题。`;
  });
  root.querySelector("[data-show-question-portrait]")?.addEventListener("click", () => {
    questionBankState.portraitQuestionId = question.id;
    populateQuestionPortraitSelect();
    setQuestionBankView("portrait");
  });
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function createLocalQuestionSolution(question) {
  return {
    answer_key: question.correctAnswer ? { kind: "reference_answer", value: question.correctAnswer } : null,
    solution_plan: {
      steps: question.analysis ? [{ order: 1, title: "证据分析", detail: question.analysis }] : [],
      key_turning_point: question.analysis || "先核对题目条件，再选择对应的数学关系。",
      common_errors: question.result === "wrong" ? [{ error: question.userAnswer || "原作答有误", feedback: question.analysis || "回到第一个出错步骤重新检查。" }] : [],
      alternative_solutions: [],
      explanation: question.analysis || ""
    }
  };
}

function renderQuestionSolution(solution = {}) {
  const plan = solution.solution_plan || {};
  const answer = formatQuestionAnswerKey(solution.answer_key);
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const errors = Array.isArray(plan.common_errors) ? plan.common_errors : [];
  const alternatives = Array.isArray(plan.alternative_solutions) ? plan.alternative_solutions : [];
  return `<div class="question-solution-head"><span><i data-lucide="route" aria-hidden="true"></i>解题思路</span>${solution.review?.review_status === "pending_teacher_review" ? `<em>待教师审核</em>` : ""}</div>
    ${steps.length ? `<ol class="question-solution-steps">${steps.map((step, index) => `<li><span>${escapeHTML(step.order || index + 1)}</span><div><b>${escapeHTML(step.title || `第 ${index + 1} 步`)}</b><p>${escapeHTML(step.detail || step.description || step)}</p></div></li>`).join("")}</ol>` : ""}
    ${plan.key_turning_point ? `<p class="question-solution-turning"><b>关键转折</b>${escapeHTML(plan.key_turning_point)}</p>` : ""}
    ${errors.length ? `<section class="question-solution-errors"><b>常见错误</b>${errors.map((item) => `<p><span>${escapeHTML(item.error || item.title || item)}</span>${item.cause ? `<small>原因：${escapeHTML(item.cause)}</small>` : ""}${item.feedback ? `<small>建议：${escapeHTML(item.feedback)}</small>` : ""}</p>`).join("")}</section>` : ""}
    ${alternatives.length ? `<section class="question-solution-alternatives"><b>其他解法</b>${alternatives.map((item, index) => `<p><span>${escapeHTML(item.title || `解法 ${index + 2}`)}</span><small>${escapeHTML(item.summary || item.description || item.steps?.map((step) => step.detail || step).join("；") || "")}</small></p>`).join("")}</section>` : ""}
    ${answer ? `<p class="question-solution-answer"><span>参考结果</span><b>${escapeHTML(answer)}</b></p>` : ""}`;
}

function formatQuestionAnswerKey(key) {
  if (key == null) return "";
  if (typeof key === "string" || typeof key === "number") return String(key);
  if (Array.isArray(key)) return key.map(formatQuestionAnswerKey).filter(Boolean).join("、");
  if (typeof key === "object") {
    if (key.value != null) return formatQuestionAnswerKey(key.value);
    if (key.accepted_answers) return formatQuestionAnswerKey(key.accepted_answers);
    return Object.values(key).map(formatQuestionAnswerKey).filter(Boolean).join("、");
  }
  return "";
}

function openBankForKnowledgePoint(id) {
  activateWorkspace("bank");
  setStudentQuestionBrowserOpen(true);
  setQuestionBankView("history");
  const filter = document.querySelector("#questionKnowledgeFilter");
  if (filter && [...filter.options].some((option) => option.value === id)) filter.value = id;
  questionTreeState.selectedId = id || "all";
  renderQuestionKnowledgeTree();
  renderQuestionBank();
}

function openBankForQuestion(questionId, knowledgePointId) {
  const question = getQuestionHistory().find((item) => item.id === questionId);
  if (!question) {
    openBankForKnowledgePoint(knowledgePointId);
    return;
  }
  activateWorkspace("bank");
  setStudentQuestionBrowserOpen(true);
  setQuestionBankView("history");
  const pointId = knowledgePointId || question.knowledgePoints?.[0]?.id || "all";
  const knowledgeFilter = document.querySelector("#questionKnowledgeFilter");
  const search = document.querySelector("#questionBankSearch");
  const result = document.querySelector("#questionResultFilter");
  const source = document.querySelector("#questionSourceFilter");
  if (search) search.value = "";
  if (result) result.value = "all";
  if (source) source.value = "all";
  const canFilterByPoint = knowledgeFilter && [...knowledgeFilter.options].some((option) => option.value === pointId);
  if (knowledgeFilter) knowledgeFilter.value = canFilterByPoint ? pointId : "all";
  questionTreeState.selectedId = canFilterByPoint ? pointId : "all";
  renderQuestionKnowledgeTree();
  renderQuestionBank();
  renderQuestionDetail(question.id);
  window.requestAnimationFrame(() => {
    const row = [...document.querySelectorAll("[data-question-id]")]
      .find((item) => item.dataset.questionId === question.id);
    row?.classList.add("is-selected");
    row?.scrollIntoView?.({ block: "nearest" });
  });
}

function openGraphForKnowledgePoint(id) {
  activateWorkspace("graph");
  const shelf = document.querySelector("#knowledgeShelfView");
  const graph = document.querySelector("#knowledgeGraphView");
  const book = document.querySelector('[data-catalog-id="junior-math"]');
  if (shelf) shelf.hidden = true;
  if (graph) graph.hidden = false;
  showCatalogGraph(book);
  clearGraphFilters();
  window.requestAnimationFrame(() => selectKnowledgePoint(id));
}

function startOfPlanDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function planDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function parsePlanDateKey(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function planDayOrdinal(date) {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function samePlanDate(left, right) {
  return planDateKey(left) === planDateKey(right);
}

function getPlanDayRecord(value) {
  const date = startOfPlanDay(value);
  const today = planCalendarState.today;
  const offset = planDayOrdinal(date) - planDayOrdinal(today);
  const rawUserSeed = globalThis.AIClassroomUserRuntime?.getPlanCalendarSeed?.();
  if (rawUserSeed == null || !Number.isFinite(Number(rawUserSeed))) {
    return {
      date,
      key: planDateKey(date),
      total: 0,
      completed: 0,
      status: "empty",
      progress: 0,
      tasks: []
    };
  }
  const userSeed = Number(rawUserSeed);
  const seed = date.getFullYear() * 372 + (date.getMonth() + 1) * 31 + date.getDate() + userSeed;
  let total = 0;
  let completed = 0;
  let status = "rest";

  if (date.getDay() !== 0) {
    total = 2 + (seed % 2);
    if (offset > 0) {
      status = "planned";
    } else if (offset === 0) {
      completed = 1;
      status = "partial";
    } else if (seed % 11 === 0) {
      status = "overdue";
    } else if (seed % 5 === 0) {
      completed = Math.max(1, total - 1);
      status = "partial";
    } else {
      completed = total;
      status = "completed";
    }
  }

  const tasks = Array.from({ length: total }, (_, index) => ({
    id: `${planDateKey(date)}-${index + 1}`,
    title: PLAN_CALENDAR_TOPICS[(seed + index * 2) % PLAN_CALENDAR_TOPICS.length],
    durationMinutes: 15 + ((seed + index) % 4) * 5,
    done: index < completed
  }));

  return {
    date,
    key: planDateKey(date),
    total,
    completed,
    status,
    progress: total ? Math.round((completed / total) * 100) : 0,
    tasks
  };
}

function hasPlanCalendarData() {
  const seed = globalThis.AIClassroomUserRuntime?.getPlanCalendarSeed?.();
  return seed != null && Number.isFinite(Number(seed));
}

function planStatusLabel(status) {
  return {
    completed: "已完成",
    partial: "部分完成",
    overdue: "未完成",
    planned: "待开始",
    rest: "休息日",
    empty: "暂无安排"
  }[status] || "暂无安排";
}

function renderPlanCalendar() {
  const grid = document.querySelector("#planCalendarGrid");
  if (!grid) return;
  const month = planCalendarState.visibleMonth;
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const calendarStart = new Date(year, monthIndex, 1 - leadingDays);
  const records = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(
      calendarStart.getFullYear(),
      calendarStart.getMonth(),
      calendarStart.getDate() + index
    );
    return getPlanDayRecord(date);
  });

  setText("#planCalendarMonthLabel", `${year}年${monthIndex + 1}月`);
  const hasPlan = hasPlanCalendarData();
  grid.innerHTML = records.map((record) => {
    const selected = samePlanDate(record.date, planCalendarState.selectedDate);
    const today = samePlanDate(record.date, planCalendarState.today);
    const outside = record.date.getMonth() !== monthIndex;
    const countLabel = record.total ? `${record.completed}/${record.total} 项` : record.status === "rest" ? "休息" : "";
    const aria = hasPlan
      ? `${record.date.getFullYear()}年${record.date.getMonth() + 1}月${record.date.getDate()}日，${planStatusLabel(record.status)}${record.total ? `，完成${record.completed}项，共${record.total}项` : ""}`
      : `${record.date.getFullYear()}年${record.date.getMonth() + 1}月${record.date.getDate()}日`;
    return `<button class="plan-calendar-day status-${record.status}${selected ? " is-selected" : ""}${today ? " is-today" : ""}${outside ? " is-outside" : ""}" type="button" role="gridcell" data-plan-calendar-date="${record.key}" aria-selected="${selected}" aria-label="${escapeHTML(aria)}">
      <span class="plan-calendar-day-head"><b class="plan-calendar-day-number">${record.date.getDate()}</b>${today ? "<em>今天</em>" : ""}</span>
      ${countLabel ? `<span class="plan-calendar-day-count">${countLabel}</span>` : ""}
      ${record.status !== "empty" ? `<span class="plan-calendar-day-meter" aria-hidden="true"><i style="--day-progress:${record.progress}%"></i></span>` : ""}
    </button>`;
  }).join("");

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthRecords = Array.from(
    { length: daysInMonth },
    (_, index) => getPlanDayRecord(new Date(year, monthIndex, index + 1))
  );
  const learnedDays = monthRecords.filter((record) => record.completed > 0).length;
  const completedTasks = monthRecords.reduce((sum, record) => sum + record.completed, 0);
  const learnedMinutes = monthRecords.reduce(
    (sum, record) => sum + record.tasks.filter((task) => task.done).reduce((total, task) => total + task.durationMinutes, 0),
    0
  );
  setText("#planCalendarMonthSummary", hasPlan
    ? `已学习 ${learnedDays} 天 · 完成 ${completedTasks} 项任务 · ${learnedMinutes} 分钟`
    : "本月尚未建立学习计划");
  syncPlanEmptyLayout(hasPlan);
  renderPlanCalendarDetail();
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function renderPlanCalendarDetail() {
  const host = document.querySelector("#planCalendarDetail");
  if (!host) return;
  if (!hasPlanCalendarData()) {
    host.innerHTML = `<div class="user-empty-learning-state"><i data-lucide="calendar-plus" aria-hidden="true"></i><b>从一个可完成的目标开始</b><p>告诉AI教师你的目标和每天可用时间，再生成个人计划。</p><button type="button" class="primary-btn" data-create-learning-plan>创建学习计划</button></div>`;
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
    return;
  }
  const record = getPlanDayRecord(planCalendarState.selectedDate);
  const todayLabel = samePlanDate(record.date, planCalendarState.today) ? " · 今天" : "";
  const dateLabel = `${record.date.getMonth() + 1}月${record.date.getDate()}日${todayLabel}`;
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(record.date);
  const taskMarkup = record.tasks.length
    ? `<ul class="plan-calendar-detail-list">${record.tasks.map((task) => `<li class="${task.done ? "is-done" : ""}"><span class="plan-calendar-task-check">${task.done ? '<i data-lucide="check" aria-hidden="true"></i>' : ""}</span><b>${escapeHTML(task.title)}</b><small>${task.durationMinutes} 分钟</small></li>`).join("")}</ul>`
    : record.status === "empty"
      ? "<p>数据库中还没有这一天的学习任务。</p>"
      : "<p>今天没有安排学习任务，适合休息或自由复习。</p>";
  const actionLabel = record.status === "completed"
    ? "复习当天内容"
    : record.status === "planned"
      ? "查看当天计划"
      : record.status === "rest" || record.status === "empty"
        ? "问AI教师"
        : "继续当天学习";
  host.innerHTML = `<header><span class="plan-calendar-detail-status status-${record.status}">${planStatusLabel(record.status)}</span><time>${escapeHTML(weekday)}</time></header>
    <div class="plan-calendar-detail-progress"><span class="plan-calendar-detail-ring" style="--day-detail-progress:${record.progress}%"><b>${record.total ? `${record.progress}%` : "—"}</b></span><div><h4>${escapeHTML(dateLabel)}</h4><p>${record.total ? `完成 ${record.completed} / ${record.total} 项学习任务` : "给大脑留一点整理和恢复的时间"}</p></div></div>
    ${taskMarkup}
    <button type="button" data-open-workspace="agent">${escapeHTML(actionLabel)}</button>`;
}

function syncPlanEmptyLayout(hasPlan) {
  const calendar = document.querySelector(".plan-calendar-card");
  const legend = document.querySelector("#planCalendarLegend");
  const weekly = document.querySelector("#weeklyPlanCard");
  const insights = document.querySelector("#planInsightColumn");
  const regenerate = document.querySelector("#regeneratePlanBtn");
  if (calendar) calendar.style.gridColumn = hasPlan ? "" : "1 / -1";
  if (legend) legend.style.display = hasPlan ? "" : "none";
  if (weekly) weekly.style.display = hasPlan ? "" : "none";
  if (insights) insights.style.display = hasPlan ? "" : "none";
  if (regenerate) regenerate.style.display = hasPlan ? "" : "none";
}

function openLearningPlanConversation() {
  activateWorkspace("agent");
  if (document.querySelector("#textInputSheet")?.hidden !== false) document.querySelector("#keyboardBtn")?.click();
  window.setTimeout(() => {
    const input = document.querySelector("#textQuestion");
    if (!input) return;
    input.value = "请根据我的知识掌握情况，先询问我的学习目标和每天可用时间，再帮我制定学习计划。";
    input.focus();
  }, 30);
}

function movePlanCalendarMonth(offset) {
  const current = planCalendarState.visibleMonth;
  const next = new Date(current.getFullYear(), current.getMonth() + offset, 1);
  const selectedDay = planCalendarState.selectedDate.getDate();
  const nextMonthDays = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  planCalendarState.visibleMonth = next;
  planCalendarState.selectedDate = new Date(
    next.getFullYear(),
    next.getMonth(),
    Math.min(selectedDay, nextMonthDays)
  );
  renderPlanCalendar();
}

function bindLearningPlan() {
  renderPlanCalendar();
  document.querySelector("#planCalendarDetail")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-create-learning-plan]")) openLearningPlanConversation();
  });
  document.querySelector("#planCalendarPrevBtn")?.addEventListener("click", () => movePlanCalendarMonth(-1));
  document.querySelector("#planCalendarNextBtn")?.addEventListener("click", () => movePlanCalendarMonth(1));
  document.querySelector("#planCalendarTodayBtn")?.addEventListener("click", () => {
    planCalendarState.visibleMonth = new Date(
      planCalendarState.today.getFullYear(),
      planCalendarState.today.getMonth(),
      1
    );
    planCalendarState.selectedDate = planCalendarState.today;
    renderPlanCalendar();
  });
  document.querySelector("#planCalendarGrid")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-plan-calendar-date]");
    if (!button) return;
    const date = parsePlanDateKey(button.dataset.planCalendarDate);
    if (!date) return;
    planCalendarState.selectedDate = date;
    if (
      date.getFullYear() !== planCalendarState.visibleMonth.getFullYear() ||
      date.getMonth() !== planCalendarState.visibleMonth.getMonth()
    ) {
      planCalendarState.visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    }
    renderPlanCalendar();
  });
  document.querySelectorAll("[data-plan-task]").forEach((button) => {
    button.addEventListener("click", () => {
      const active = button.classList.toggle("is-done");
      button.closest("article")?.classList.toggle("is-done", active);
      button.innerHTML = active ? '<i data-lucide="check"></i>' : "";
      const tasks = [...document.querySelectorAll("[data-plan-task]")];
      const completed = tasks.filter((task) => task.classList.contains("is-done")).length;
      setText("#weeklyPlanProgress", `已完成 ${completed} / ${tasks.length}`);
      window.lucide?.createIcons?.();
    });
  });
  document.querySelector("#regeneratePlanBtn")?.addEventListener("click", (event) => {
    event.currentTarget.classList.add("is-spinning");
    window.setTimeout(() => {
      event.currentTarget.classList.remove("is-spinning");
      showToast("已根据最新知识状态重排本周计划");
    }, 650);
  });
}

function bindLearningBuddy() {
  document.querySelector("#buddyTimerStartBtn")?.addEventListener("click", toggleBuddyTimer);
  document.querySelector("#buddyTimerResetBtn")?.addEventListener("click", resetBuddyTimer);
  document.querySelectorAll(".focus-ambient-row button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".focus-ambient-row button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      showToast(`${button.textContent.trim()}环境已选择（演示）`);
    });
  });
}

function toggleBuddyTimer() {
  const button = document.querySelector("#buddyTimerStartBtn");
  if (buddyTimerId) {
    window.clearInterval(buddyTimerId);
    buddyTimerId = null;
    if (button) button.innerHTML = '<i data-lucide="play"></i>继续共学';
    setText("#buddyTimerState", "已暂停");
  } else {
    buddyTimerId = window.setInterval(() => {
      buddyRemainingSeconds = Math.max(0, buddyRemainingSeconds - 1);
      renderBuddyTimer();
      if (!buddyRemainingSeconds) {
        window.clearInterval(buddyTimerId);
        buddyTimerId = null;
        showToast("完成 25 分钟共学，休息一下吧");
      }
    }, 1000);
    if (button) button.innerHTML = '<i data-lucide="pause"></i>暂停';
    setText("#buddyTimerState", "专注中");
  }
  window.lucide?.createIcons?.();
}

function resetBuddyTimer() {
  if (buddyTimerId) window.clearInterval(buddyTimerId);
  buddyTimerId = null;
  buddyRemainingSeconds = 25 * 60;
  renderBuddyTimer();
  const button = document.querySelector("#buddyTimerStartBtn");
  if (button) button.innerHTML = '<i data-lucide="play"></i>开始共学';
  setText("#buddyTimerState", "准备开始");
  window.lucide?.createIcons?.();
}

function renderBuddyTimer() {
  const minutes = Math.floor(buddyRemainingSeconds / 60);
  const seconds = buddyRemainingSeconds % 60;
  setText("#buddyTimer", `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`);
}

function bindVoiceConfig() {
  document.querySelector("#voiceConfigApplyBtn")?.addEventListener("click", () => {
    const updateButton = document.querySelector("#updateSessionBtn");
    if (updateButton && !updateButton.disabled) {
      updateButton.click();
      setText("#voiceConfigApplyStatus", "已提交到当前语音会话");
    } else {
      setText("#voiceConfigApplyStatus", "当前未连接；将在下次连接时使用此配置");
    }
  });
}

function showToast(message) {
  let toast = document.querySelector("#learningWorkbenchToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "learningWorkbenchToast";
    toast.className = "learning-workbench-toast";
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function sourceLabel(source) {
  return { bank: "题库练习", exam: "试卷导入", homework: "作业导入", teacher: "AI教师" }[source] || source;
}

function resultLabel(result) {
  return { correct: "回答正确", wrong: "回答错误", partial: "部分正确", unattempted: "待练习" }[result] || result;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
