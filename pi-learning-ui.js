import {
  createEducationA2UI,
  validateEducationCard,
} from "./education-card-assembler.js";
import { CARD_LIBRARY_VERSION } from "./public/card-library-data.js";
import { PI_LEARNING_TEACHING_PACKAGE_VERSION } from "./pi-learning-agent.js";
import { createStaticKnowledgeCardParameterization } from "./public/knowledge-card-parameter-contract.js";

export const PI_LEARNING_UI_PROJECTION_VERSION = "pi-learning-ui-projection@1.0";

const MAX_QUIZ_CARDS = 3;
const PRIVATE_FIELDS = new Set([
  "answer",
  "answer_key",
  "accepted_answers",
  "correct_answer",
  "correct_option",
  "correct_option_id",
  "correct_option_ids",
  "explanation",
  "final_answer",
  "private_key",
  "solution",
  "solution_plan",
  "solution_paths",
]);
const EXECUTABLE_TEXT = /(?:<\s*\/?\s*(?:script|iframe|object|embed|style|svg)|javascript\s*:|data\s*:\s*text\/html|\beval\s*\(|\bnew\s+Function\b|XMLHttpRequest|\bdocument\s*\.|\bwindow\s*\.)/iu;

export class PiLearningUiError extends Error {
  constructor(code, message, { status = 422, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PiLearningUiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Projects only server-hydrated single-choice drafts. Answer keys and solution
 * material are never consumed, copied, or placed into the A2UI data model.
 */
export function projectPiLearningTeachingPackageToA2UI(teachingPackage, options = {}) {
  assertTeachingPackage(teachingPackage);
  const cards = [];
  const skippedCards = [];
  const drafts = Array.isArray(teachingPackage.question_drafts)
    ? teachingPackage.question_drafts
    : [];
  const cardLimit = normalizeCardLimit(options.maxCards ?? options.max_cards);

  drafts.forEach((draft, index) => {
    if (cards.length >= cardLimit) {
      skippedCards.push(skipReceipt(draft, index, "CARD_LIMIT_EXCEEDED", `每轮最多展示 ${cardLimit} 道单选题`));
      return;
    }
    const built = buildQuizCard(draft, {
      index,
      requestId: teachingPackage.request_id,
      stateVersion: options.stateVersion ?? options.state_version,
      loadedMaterials: teachingPackage.loaded_materials,
    });
    if (!built.card) {
      skippedCards.push(skipReceipt(draft, index, built.code, built.message));
      return;
    }
    const validation = validateEducationCard(built.card);
    if (!validation.valid) {
      skippedCards.push(skipReceipt(
        draft,
        index,
        "CARD_SCHEMA_INVALID",
        validation.errors.map((item) => `${item.path}: ${item.message}`).join("；"),
      ));
      return;
    }
    cards.push(built.card);
  });

  const a2ui = createEducationA2UI({
    surfaceId: options.surfaceId ?? options.surface_id ?? "pi_learning_quiz_surface",
    cards,
    operation: options.operation || "replace",
    stateVersion: options.stateVersion ?? options.state_version,
    turnSequence: options.turnSequence ?? options.turn_sequence,
    packageId: safeIdentifier(options.packageId ?? options.package_id ?? teachingPackage.request_id),
  });
  return deepFreeze({
    schema_version: PI_LEARNING_UI_PROJECTION_VERSION,
    source_schema_version: teachingPackage.schema_version,
    request_id: safeIdentifier(teachingPackage.request_id),
    answer: safeDisplayText(teachingPackage.answer, 6_000),
    cards,
    skipped_cards: skippedCards,
    a2ui,
  });
}

function buildQuizCard(draft, { index, requestId, stateVersion, loadedMaterials }) {
  if (!isPlainObject(draft)) {
    return failure("QUESTION_DRAFT_INVALID", "题目草稿必须是对象");
  }
  const safety = inspectDraftSafety(draft);
  if (safety === "private") {
    return failure("PRIVATE_ANSWER_FIELD_REJECTED", "公开题目草稿包含答案或解析字段");
  }
  if (safety === "executable") {
    return failure("EXECUTABLE_CONTENT_REJECTED", "公开题目草稿包含可执行内容");
  }
  if (draft.blueprint?.item_type !== "single_choice") {
    return failure("UNSUPPORTED_ITEM_TYPE", "当前 A2UI 仅支持单项选择题");
  }
  const assessmentInstanceId = safeIdentifier(draft.assessment_instance_id);
  if (!assessmentInstanceId) {
    return failure("ASSESSMENT_INSTANCE_REQUIRED", "题目缺少服务端题目实例 ID");
  }
  const publicItem = draft.public_item;
  if (!isPlainObject(publicItem)) {
    return failure("PUBLIC_ITEM_REQUIRED", "题目缺少公开题面");
  }
  const prompt = safeDisplayText(publicItem.prompt, 4_000);
  if (!prompt) return failure("QUESTION_PROMPT_REQUIRED", "题干不完整");
  const options = normalizeOptions(publicItem.options);
  if (!options.ok) return failure(options.code, options.message);

  const difficulty = difficultyLabel(draft.blueprint?.difficulty);
  const knowledgePointIds = normalizeIdentifiers(draft.knowledge_point_ids, 4);
  const materialTitle = Array.isArray(loadedMaterials)
    ? safeDisplayText(loadedMaterials[0]?.title, 120)
    : "";
  const observedStateVersion = nonNegativeInteger(stateVersion, 0);
  const questionId = assessmentInstanceId;
  const card = {
    id: safeIdentifier(`pi_quiz_${index + 1}_${assessmentInstanceId}`),
    type: "quiz.single-choice",
    version: CARD_LIBRARY_VERSION,
    meta: {
      title: "单项选择题",
      eyebrow: materialTitle || "AI教师 · 针对练习",
      badge: difficulty,
      tags: knowledgePointIds,
      artifact_ids: [],
      parameterization: createStaticKnowledgeCardParameterization({
        cardType: "quiz.single-choice",
        staticReason: "assessment_state_server_controlled",
      }),
    },
    props: {
      title: safeDisplayText(publicItem.title, 120) || "针对练习",
      question_id: questionId,
      prompt,
      options: options.items,
    },
    state: {
      status: "awaiting_answer",
      selected: "",
      correct: null,
      locked: false,
      state_version: observedStateVersion,
    },
    actions: options.items.map((option) => ({
      type: "answer.select",
      label: `选择 ${option.id}`,
      payload: {
        question_id: questionId,
        assessment_instance_id: assessmentInstanceId,
        value: option.value,
        observed_state_version: observedStateVersion,
      },
      context: {
        grading_source: "pi.learning",
        assessment_instance_id: assessmentInstanceId,
        request_id: safeIdentifier(requestId),
      },
    })),
  };
  return { card };
}

function normalizeOptions(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    return failure("QUESTION_OPTIONS_INVALID", "单选题必须包含 2–8 个选项");
  }
  const seen = new Set();
  const items = [];
  for (const option of value) {
    if (!isPlainObject(option) || inspectDraftSafety(option)) {
      return failure("QUESTION_OPTION_INVALID", "选项数据无效");
    }
    const id = safeIdentifier(option.id);
    const label = safeDisplayText(option.label, 500);
    if (!id || !label || seen.has(id)) {
      return failure("QUESTION_OPTION_INVALID", "选项 ID 或文案无效，且 ID 不得重复");
    }
    seen.add(id);
    items.push({ id, value: id, label });
  }
  return { ok: true, items };
}

function assertTeachingPackage(value) {
  if (!isPlainObject(value) || value.schema_version !== PI_LEARNING_TEACHING_PACKAGE_VERSION) {
    throw new PiLearningUiError(
      "pi_learning_teaching_package_invalid",
      `只支持 ${PI_LEARNING_TEACHING_PACKAGE_VERSION} 教学包`,
    );
  }
  if (!safeIdentifier(value.request_id)) {
    throw new PiLearningUiError("pi_learning_request_id_invalid", "教学包缺少合法 request_id");
  }
  if (!Array.isArray(value.question_drafts)) {
    throw new PiLearningUiError("pi_learning_question_drafts_invalid", "question_drafts 必须是数组");
  }
}

function inspectDraftSafety(value, depth = 0, budget = { count: 0 }) {
  budget.count += 1;
  if (depth > 8 || budget.count > 1_000) return "executable";
  if (typeof value === "string") return EXECUTABLE_TEXT.test(value) ? "executable" : "";
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = inspectDraftSafety(item, depth + 1, budget);
      if (result) return result;
    }
    return "";
  }
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_FIELDS.has(key)) return "private";
    const result = inspectDraftSafety(child, depth + 1, budget);
    if (result) return result;
  }
  return "";
}

function skipReceipt(draft, index, code, message) {
  return Object.freeze({
    index,
    assessment_instance_id: safeIdentifier(draft?.assessment_instance_id) || null,
    code: String(code || "QUESTION_DRAFT_SKIPPED"),
    message: String(message || "题目不可安全渲染"),
  });
}

function failure(code, message) {
  return { card: null, ok: false, code, message };
}

function difficultyLabel(value) {
  if (value === "easy") return "基础";
  if (value === "hard") return "挑战";
  return "进阶";
}

function normalizeCardLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(MAX_QUIZ_CARDS, Math.max(1, number)) : MAX_QUIZ_CARDS;
}

function normalizeIdentifiers(value, maximum) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(safeIdentifier).filter(Boolean))].slice(0, maximum);
}

function safeIdentifier(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/gu, "")
    .slice(0, 200);
}

function safeDisplayText(value, maximum) {
  const text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
  return EXECUTABLE_TEXT.test(text) ? "" : text;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
