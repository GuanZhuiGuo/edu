import {
  A2UI_VERSION,
  CONTRACT_VERSION,
  EDUCATION_CATALOG_ID
} from "./contracts.js";
import {
  gradeCompiledKnowledgeAnswer,
  searchCompiledKnowledge
} from "./knowledge-compiler.js";

const SEARCH_TOOL_NAME = "search_compiled_knowledge";
const GRADE_TOOL_NAME = "grade_education_answer";
const DEFAULT_TOP_K = 3;
const DEFAULT_MIN_SCORE = 8;
const MAX_MODEL_CONTENT_LENGTH = 4000;
const MAX_CARD_MATERIALS_PER_MATCH = 6;
const SUPPORTED_CARD_TYPES = new Set([
  "compiler.status",
  "exam.progress",
  "exam.result",
  "knowledge.explanation",
  "knowledge.mindmap",
  "media.image",
  "media.video",
  "oral.practice",
  "quiz.single-choice"
]);
const PRIVATE_QUIZ_KEYS = new Set([
  "answer_key",
  "answerkey",
  "correct_answer",
  "correctanswer",
  "correct_value",
  "correctvalue",
  "solution",
  "solution_key",
  "solutionkey"
]);

export const SEARCH_COMPILED_KNOWLEDGE_TOOL = {
  type: "function",
  name: SEARCH_TOOL_NAME,
  description:
    "检索已编译的教学知识。status=matched 时基于 matches 中的正文自然回答；status=no_match 时直接使用模型自身知识回答。卡片由系统根据同源 card_materials 自动渲染，不要朗读 JSON。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        minLength: 1,
        maxLength: 2000,
        description: "保留用户原意的知识检索问题"
      },
      artifact_ids: {
        type: "array",
        maxItems: 20,
        items: { type: "string" },
        description: "可选，只在指定编译产物中检索"
      },
      top_k: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        default: DEFAULT_TOP_K
      },
      min_score: {
        type: "number",
        minimum: 0,
        default: DEFAULT_MIN_SCORE,
        description: "相关性阈值；默认 8"
      }
    },
    required: ["query"]
  }
};

export const GRADE_EDUCATION_ANSWER_TOOL = {
  type: "function",
  name: GRADE_TOOL_NAME,
  description:
    "对当前教育题卡的用户选择进行确定性判题。question_id 可省略并使用会话中的 activeQuestionId；判题结果可由实时语音模型自然反馈。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      question_id: {
        type: "string",
        description: "题目 ID；缺省时使用当前活动题目"
      },
      selected: {
        type: "string",
        minLength: 1,
        maxLength: 40,
        description: "用户选择的选项值，例如 A"
      }
    },
    required: ["selected"]
  }
};

export function isEducationToolName(name) {
  return name === SEARCH_TOOL_NAME || name === GRADE_TOOL_NAME;
}

export async function runEducationTool(
  name,
  args = {},
  { activeQuestionId } = {}
) {
  if (name === SEARCH_TOOL_NAME) {
    return runKnowledgeSearch(args, activeQuestionId);
  }
  if (name === GRADE_TOOL_NAME) {
    return runAnswerGrading(args, activeQuestionId);
  }
  throw new TypeError(`Unsupported education tool: ${String(name || "missing")}`);
}

function runKnowledgeSearch(args, activeQuestionId) {
  const query = String(args?.query ?? "").trim();
  if (!query) {
    throw new TypeError("search_compiled_knowledge requires a non-empty query");
  }

  const searchResult = searchCompiledKnowledge(query, {
    artifactIds: normalizeArtifactIds(args?.artifact_ids),
    topK: normalizeInteger(args?.top_k, DEFAULT_TOP_K, 1, 5),
    minScore: normalizeNumber(args?.min_score, DEFAULT_MIN_SCORE, 0, 100000)
  });
  const toolResult = compactSearchResult(searchResult);

  if (toolResult.status === "no_match") {
    return {
      toolResult,
      uiPayload: null,
      activeQuestionId: activeQuestionId || null
    };
  }

  const cards = createCardsFromMatches(toolResult.matches);
  const uiPayload = cards.length
    ? createUiPayload(cards, searchSurfaceId(toolResult.matches))
    : null;
  const questionCard = cards.find((card) => card.type === "quiz.single-choice");

  return {
    toolResult,
    uiPayload,
    activeQuestionId:
      questionCard?.props?.question_id || activeQuestionId || null
  };
}

function runAnswerGrading(args, activeQuestionId) {
  const questionId = safeIdentifier(args?.question_id || activeQuestionId);
  if (!questionId) {
    return {
      toolResult: {
        status: "no_active_question",
        question_id: ""
      },
      uiPayload: null,
      activeQuestionId: null
    };
  }

  const selected = normalizeSelection(
    args?.selected ?? args?.answer ?? args?.value
  );
  if (!selected) {
    return {
      toolResult: {
        status: "invalid_answer",
        question_id: questionId,
        selected: ""
      },
      uiPayload: null,
      activeQuestionId: questionId
    };
  }

  let grading;
  try {
    grading = gradeCompiledKnowledgeAnswer(questionId, selected);
  } catch {
    return {
      toolResult: {
        status: "invalid_answer",
        question_id: questionId,
        selected
      },
      uiPayload: null,
      activeQuestionId: questionId
    };
  }

  if (!grading) {
    return {
      toolResult: {
        status: "question_not_found",
        question_id: questionId,
        selected
      },
      uiPayload: null,
      activeQuestionId: null
    };
  }

  const toolResult = {
    status: "graded",
    question_id: grading.question_id,
    selected: grading.selected,
    correct: grading.correct,
    correct_answer: grading.correct_answer,
    explanation: grading.explanation
  };
  const card = createGradedQuizCard(grading);

  return {
    toolResult,
    uiPayload: createGradingUiPayload(card, gradeSurfaceId(grading)),
    activeQuestionId: null
  };
}

function compactSearchResult(searchResult) {
  const matches = (searchResult.matches || []).map((match) => ({
    artifact_id: safeIdentifier(match.artifact_id),
    knowledge_unit_id: safeIdentifier(match.knowledge_unit_id),
    title: safeText(match.title, 240),
    content: safeText(match.content || match.summary, MAX_MODEL_CONTENT_LENGTH),
    score: finiteNumber(match.score, 0),
    citations: compactCitations(match.citations),
    card_materials: compactCardMaterials(match.card_materials)
  }));

  return {
    status: matches.length ? "matched" : "no_match",
    query: safeText(searchResult.query, 2000),
    matches
  };
}

function compactCitations(citations) {
  return (Array.isArray(citations) ? citations : [])
    .slice(0, 8)
    .map((citation) => ({
      citation_id: safeIdentifier(citation?.citation_id || citation?.id),
      title: safeText(citation?.title, 240),
      source_type: safeText(citation?.source_type, 40),
      locator: safeText(citation?.locator, 1000),
      excerpt: safeText(citation?.excerpt, 500)
    }))
    .filter((citation) => citation.citation_id && citation.title);
}

function compactCardMaterials(materials) {
  return (Array.isArray(materials) ? materials : [])
    .slice(0, MAX_CARD_MATERIALS_PER_MATCH)
    .map((material) => {
      const recommendedType = safeText(material?.recommended_type, 80);
      if (!SUPPORTED_CARD_TYPES.has(recommendedType)) return null;
      return {
        material_id:
          safeIdentifier(material?.material_id) ||
          safeIdentifier(`material_${recommendedType}`),
        recommended_type: recommendedType,
        data: sanitizeMaterialData(material?.data)
      };
    })
    .filter(Boolean);
}

function createCardsFromMatches(matches) {
  const cards = [];
  const seenMaterialIds = new Set();

  for (const match of matches) {
    for (const material of match.card_materials || []) {
      const dedupeKey = `${material.material_id}:${material.recommended_type}`;
      if (seenMaterialIds.has(dedupeKey)) continue;
      seenMaterialIds.add(dedupeKey);
      const card = createCardFromMaterial(match, material);
      if (card) cards.push(card);
    }
  }
  return cards;
}

function createCardFromMaterial(match, material) {
  const type = material.recommended_type;
  if (!SUPPORTED_CARD_TYPES.has(type)) return null;

  const data = sanitizeMaterialData(material.data);
  const sources = (match.citations || []).map((citation) => ({
    citation_id: citation.citation_id,
    title: citation.title
  }));
  const meta = {
    title: safeText(data.title || match.title || type, 240),
    source: "compiled-knowledge",
    artifact_ids: [match.artifact_id].filter(Boolean),
    knowledge_unit_ids: [match.knowledge_unit_id].filter(Boolean),
    citation_ids: sources.map((source) => source.citation_id)
  };
  const card = {
    id: cardId(material.material_id, type),
    type,
    version: CONTRACT_VERSION,
    meta,
    props: structuredClone(data),
    state: { status: "ready" },
    actions: []
  };

  if (type === "knowledge.explanation") {
    card.props = {
      ...data,
      title: safeText(data.title || match.title, 240),
      summary: safeText(data.summary, 500),
      body: safeText(data.body || data.content || match.content, 4000),
      sources
    };
  } else if (type === "knowledge.mindmap") {
    card.props = {
      ...data,
      title: safeText(data.title || `${match.title}知识结构`, 240),
      sources
    };
  } else if (type === "quiz.single-choice") {
    const questionId = safeIdentifier(data.question_id);
    const options = normalizeOptions(data.options);
    if (!questionId || options.length < 2 || !safeText(data.prompt, 2000)) {
      return null;
    }
    card.props = {
      title: safeText(data.title || "单选题", 240),
      question_id: questionId,
      prompt: safeText(data.prompt, 2000),
      options,
      hint: safeText(data.hint, 500),
      sources
    };
    card.state = {
      status: "awaiting_answer",
      selected: "",
      correct: null,
      locked: false
    };
    card.actions = options.map((option) => ({
      type: "answer.select",
      label: `选择 ${option.id}`,
      payload: {
        question_id: questionId,
        value: option.value
      }
    }));
  }

  return card;
}

function createGradedQuizCard(grading) {
  const question = grading.question;
  const options = normalizeOptions(question.options);
  return {
    id: cardId(grading.material_id || question.question_id, "quiz.single-choice"),
    type: "quiz.single-choice",
    version: CONTRACT_VERSION,
    meta: {
      title: safeText(question.title || "单选题", 240),
      source: "compiled-knowledge",
      question_id: question.question_id,
      artifact_ids: [safeIdentifier(grading.artifact_id)].filter(Boolean),
      knowledge_unit_ids: [
        safeIdentifier(grading.knowledge_unit_id)
      ].filter(Boolean)
    },
    props: {
      title: safeText(question.title || "单选题", 240),
      question_id: question.question_id,
      prompt: safeText(question.prompt, 2000),
      options,
      hint: safeText(question.hint, 500),
      explanation: safeText(grading.explanation, 1000)
    },
    state: {
      status: grading.correct ? "correct" : "incorrect",
      selected: grading.selected,
      correct: grading.correct,
      correct_answer: grading.correct_answer,
      locked: true
    },
    actions: []
  };
}

function createUiPayload(cards, surfaceId) {
  const componentIds = cards.map((card) => componentIdForCard(card));
  const messages = [
    {
      version: A2UI_VERSION,
      createSurface: {
        surfaceId,
        catalogId: EDUCATION_CATALOG_ID,
        sendDataModel: true
      }
    },
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId,
        components: [
          {
            id: "root",
            component: "Column",
            children: componentIds,
            justify: "start",
            align: "stretch"
          },
          ...cards.map((card, index) => ({
            id: componentIds[index],
            component: "EducationCard",
            card: structuredClone(card)
          }))
        ]
      }
    },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/",
        value: {
          contract_version: CONTRACT_VERSION,
          cards: Object.fromEntries(
            cards.map((card) => [card.id, structuredClone(card.state)])
          )
        }
      }
    }
  ];

  return {
    surface_id: surfaceId,
    cards: structuredClone(cards),
    messages
  };
}

function createGradingUiPayload(card, surfaceId) {
  const componentId = componentIdForCard(card);
  const fallback = createUiPayload([card], surfaceId);
  return {
    surface_id: surfaceId,
    mode: "patch",
    cards: [structuredClone(card)],
    messages: [
      {
        version: A2UI_VERSION,
        updateComponents: {
          surfaceId,
          components: [
            {
              id: componentId,
              component: "EducationCard",
              card: structuredClone(card)
            }
          ]
        }
      },
      {
        version: A2UI_VERSION,
        updateDataModel: {
          surfaceId,
          path: `/cards/${card.id}`,
          value: structuredClone(card.state)
        }
      }
    ],
    fallback_messages: fallback.messages
  };
}

function componentIdForCard(card) {
  return safeIdentifier(`education_${card?.id || "card"}`);
}

function normalizeOptions(options) {
  return (Array.isArray(options) ? options : [])
    .slice(0, 12)
    .map((option, index) => {
      const value = normalizeSelection(option?.value ?? option?.id);
      if (!value) return null;
      return {
        id: safeIdentifier(option?.id) || String.fromCharCode(65 + index),
        value,
        label: safeText(option?.label, 500),
        ...(safeText(option?.description, 500)
          ? { description: safeText(option.description, 500) }
          : {})
      };
    })
    .filter((option) => option?.label);
}

function sanitizeMaterialData(value, depth = 0) {
  if (depth > 8) return null;
  if (
    value == null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") return safeText(value, 12000);
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeMaterialData(item, depth + 1));
  }
  if (!isPlainObject(value)) return null;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_QUIZ_KEYS.has(normalizePrivateKey(key)))
      .slice(0, 100)
      .map(([key, item]) => [
        safeText(key, 120),
        sanitizeMaterialData(item, depth + 1)
      ])
  );
}

function normalizePrivateKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function normalizeArtifactIds(value) {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .slice(0, 20)
    .map(safeIdentifier)
    .filter(Boolean);
  return ids.length ? ids : undefined;
}

function normalizeSelection(value) {
  return safeText(value, 40)
    .toUpperCase()
    .replace(/[Ａ-Ｚ]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0)
    );
}

function searchSurfaceId(matches) {
  const first = matches[0] || {};
  return safeIdentifier(
    `education_knowledge_${first.artifact_id || "result"}_${first.knowledge_unit_id || "unit"}`
  );
}

function gradeSurfaceId(grading) {
  if (grading.artifact_id && grading.knowledge_unit_id) {
    return safeIdentifier(
      `education_knowledge_${grading.artifact_id}_${grading.knowledge_unit_id}`
    );
  }
  return safeIdentifier(`education_question_${grading.question_id}`);
}

function cardId(materialId, type) {
  return safeIdentifier(`card_${materialId || type}`);
}

function safeIdentifier(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 160);
}

function safeText(value, limit) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
}

function normalizeNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
