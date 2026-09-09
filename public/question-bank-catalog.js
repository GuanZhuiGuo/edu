const DEFAULT_URL = "/api/education/questions?ontology_id=junior-math-moe-2022&limit=1000";
const EXPECTED_SCHEMA = "assessment-item-public-bank@1.0";

let catalogPromise = null;

export async function loadQuestionBankCatalog(url = DEFAULT_URL) {
  if (!catalogPromise) {
    catalogPromise = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`题库读取失败（${response.status}）`);
        return createQuestionBankCatalog(await response.json());
      })
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

export function createQuestionBankCatalog(payload = {}) {
  if (!Array.isArray(payload?.items)) {
    throw new TypeError("题库公开数据协议不兼容");
  }
  if (payload.schema_version && payload.schema_version !== EXPECTED_SCHEMA) {
    throw new TypeError("题库公开数据协议不兼容");
  }
  const items = payload.items.map(normalizeQuestionBankItem).filter(Boolean);
  const byId = new Map(items.map((item) => [item.id, item]));
  const byKnowledgePointId = new Map();
  items.forEach((item) => {
    item.knowledgePoints.forEach((point) => {
      if (!byKnowledgePointId.has(point.id)) byKnowledgePointId.set(point.id, []);
      byKnowledgePointId.get(point.id).push(item);
    });
  });
  return Object.freeze({
    schema_version: payload.schema_version || "education-question-list@1.0",
    bank_id: String(payload.bank_id || ""),
    version: String(payload.version || ""),
    items: Object.freeze(items),
    byId,
    byKnowledgePointId,
    statistics: payload.statistics || {}
  });
}

export function normalizeQuestionBankItem(item = {}) {
  const id = safeIdentifier(item.id);
  const stem = String(item.stem || "").trim();
  if (!id || !stem) return null;
  const mapping = Array.isArray(item.knowledge_point_mapping) && item.knowledge_point_mapping.length
    ? item.knowledge_point_mapping
    : Array.isArray(item.knowledge_point_mappings)
      ? item.knowledge_point_mappings.map((point) => ({
          id: point.knowledge_point_id,
          name: point.knowledge_point_name || point.knowledge_point_id,
          role: point.mapping_role,
          weight: point.weight
        }))
      : [];
  const knowledgePoints = mapping
    .map((point) => ({
      id: safeIdentifier(point?.id),
      name: String(point?.name || point?.id || "").trim(),
      role: String(point?.role || "primary"),
      weight: Number(point?.weight ?? 1)
    }))
    .filter((point) => point.id);
  return Object.freeze({
    id,
    stem,
    title: String(item.title || stem).trim(),
    knowledgePoints,
    result: "unattempted",
    source: "bank",
    type: String(item.question_type_label || questionTypeLabel(item.question_type)),
    date: "未作答",
    userAnswer: "",
    correctAnswer: "",
    analysis: String(item.solution_preview?.first_hint || "").trim(),
    options: Array.isArray(item.options)
      ? item.options.map((option) => ({
          id: String(option?.id || ""),
          text: String(option?.text || option?.label || "")
        }))
      : [],
    responseSpec: item.response_spec || {},
    solutionPreview: item.solution_preview || null,
    artifactRef: item.artifact_ref || null,
    curriculumRef: item.curriculum_ref || null,
    provenance: item.provenance || null,
    quality: item.quality || null,
    attributes: {
      schemaVersion: "question-attribute-profile@1.0",
      knowledgePoints,
      questionType: String(item.question_type_label || questionTypeLabel(item.question_type)),
      propositionMethod: displayValue(item.proposition_method),
      abilityLevel: displayValue(item.ability_level),
      context: displayValue(item.context),
      difficulty: displayValue(item.difficulty),
      strategies: Array.isArray(item.solution_preview?.strategy_labels)
        ? item.solution_preview.strategy_labels.map(String)
        : [],
      multipleSolutions: item.solution_preview?.has_full_solution
        ? "按题目查看"
        : "单一主路径",
      source: "bank",
      evidenceStatus: item.quality?.publishable === true ? "accepted" : "pending"
    },
    raw: item
  });
}

export async function revealQuestionSolution(questionId, { signal } = {}) {
  const safeId = safeIdentifier(questionId);
  if (!safeId) throw new Error("题目 ID 无效");
  const response = await fetch(`/api/education/questions/${encodeURIComponent(safeId)}/solution`, {
    method: "GET",
    headers: { accept: "application/json" },
    signal
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "解题思路读取失败");
  return payload.private_payload || payload;
}

function displayValue(value) {
  if (value && typeof value === "object") return String(value.label || value.code || "未标注");
  const abilityLabels = {
    understand: "理解辨析",
    apply: "迁移应用",
    reason: "推理论证",
    model: "模型建构"
  };
  return abilityLabels[String(value || "")] || String(value || "未标注");
}

function questionTypeLabel(type) {
  return ({
    single_choice: "单项选择题",
    numeric_response: "数值填空题",
    short_response: "简答题",
    extended_response: "解答题"
  })[type] || "练习题";
}

function safeIdentifier(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:@-]/gu, "")
    .slice(0, 200);
}
