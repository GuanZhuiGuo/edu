import {
  CARD_LIBRARY_VERSION,
  getEducationCardDefinition,
  listEducationCards
} from "./public/card-library-data.js";
import {
  A2UI_VERSION,
  CONTRACT_VERSION,
  EDUCATION_CATALOG_ID
} from "./contracts.js";
import {
  NEWTON2_ARTIFACT_ID,
  getNewton2Claim,
  getNewton2Evidence,
  getPrivateAssessmentItem,
  getTeachingMaterial,
  getTeachingMaterialForCardType,
  listNewton2Claims
} from "./mvp-education-fixtures.js";
import { createStaticKnowledgeCardParameterization } from "./public/knowledge-card-parameter-contract.js";

const EXPECTED_MVP_CARD_TYPES = Object.freeze([
  "knowledge.explanation",
  "knowledge.mindmap",
  "language.vocabulary",
  "language.grammar",
  "media.image",
  "media.video",
  "quiz.single-choice",
  "oral.practice",
  "exam.progress",
  "exam.result",
  "compiler.status"
]);
const REGISTRY_CARD_DEFINITIONS = Object.freeze(listEducationCards());
const REGISTRY_CARD_TYPES = new Set(
  REGISTRY_CARD_DEFINITIONS.map((definition) => definition.type)
);
const CLAIM_BOUND_CARD_TYPES = new Set([
  "knowledge.explanation",
  "knowledge.mindmap",
  "language.vocabulary",
  "language.grammar",
  "media.image",
  "media.video",
  "quiz.single-choice",
  "oral.practice"
]);
const MEDIA_FIELDS = Object.freeze({
  "media.image": ["src"],
  "media.video": ["src", "poster", "caption_src"]
});
const MAX_CARDS_PER_TURN = 3;

const REGISTRY_STATUS = inspectCardRegistry();
if (!REGISTRY_STATUS.valid) {
  const error = new Error(`Education Card Registry 自检失败：${REGISTRY_STATUS.errors.join("；")}`);
  error.code = "EDUCATION_CARD_REGISTRY_INVALID";
  throw error;
}

export function getCardRegistryStatus() {
  return clone(REGISTRY_STATUS);
}

export function assembleEducationCards(input = {}) {
  const retrieval = input.retrieval ?? input.retrievalResult ?? null;
  const result = {
    cards: [],
    card_claim_bindings: [],
    errors: [],
    selected_card_types: []
  };
  const stateOnly = !retrieval && hasAuthoritativeStateCardInput(input);
  if (!stateOnly && (!retrieval || retrieval.status !== "matched")) return result;
  const effectiveRetrieval = retrieval || {
    status: "state_authoritative",
    artifact_id: input.artifactId ?? input.artifact_id ?? NEWTON2_ARTIFACT_ID,
    matches: [],
    evidence: []
  };

  const matches = Array.isArray(effectiveRetrieval.matches)
    ? effectiveRetrieval.matches
    : [];
  const retrievedCandidates = matches.flatMap((match) =>
    Array.isArray(match?.presentation_candidates) ? match.presentation_candidates : []
  );
  const retrievalClaims = matches.flatMap((match) =>
    Array.isArray(match?.claims) ? match.claims : []
  );
  const claimRegistry = new Map(
    retrievalClaims
      .filter((claim) => claim && typeof claim === "object" && claim.claim_id)
      .map((claim) => [String(claim.claim_id), clone(claim)])
  );
  const evidenceRegistry = new Map(
    (Array.isArray(effectiveRetrieval.evidence) ? effectiveRetrieval.evidence : [])
      .filter((item) => item && typeof item === "object" && item.evidence_id)
      .map((item) => [String(item.evidence_id), clone(item)])
  );
  if (stateOnly) {
    listNewton2Claims().forEach((claim) =>
      claimRegistry.set(String(claim.claim_id), clone(claim))
    );
  }
  const requestText = String(
    input.requestText ?? input.request_text ?? input.rawText ?? input.raw_text ?? ""
  );
  const selectedTypes = selectCardTypes({
    requestText,
    requestedCardTypes:
      input.requestedCardTypes ??
      input.requested_card_types ??
      input.intent?.requested_card_types ??
      input.semanticHint?.requested_card_types ??
      input.semantic_hint?.requested_card_types,
    stateCardTypes: stateOnly ? inferAuthoritativeStateCardTypes(input) : []
  });
  const candidates = stateOnly
    ? createAuthoritativeStateCandidates(input, selectedTypes)
    : retrievedCandidates;
  const mustIncludeClaimIds = extractMustIncludeClaimIds(
    input.answerBrief ?? input.answer_brief
  );
  const turnId = safeIdentifier(input.turnId ?? input.turn_id ?? "turn");
  const artifactId = safeIdentifier(
    input.artifactId ??
      input.artifact_id ??
      effectiveRetrieval.artifact_id ??
      NEWTON2_ARTIFACT_ID
  );
  const allowedMediaHosts = normalizeAllowedHosts(
    input.allowedMediaHosts ?? input.allowed_media_hosts
  );

  selectedTypes.slice(0, MAX_CARDS_PER_TURN).forEach((cardType, index) => {
    if (!REGISTRY_CARD_TYPES.has(cardType)) {
      result.errors.push(
        cardAssemblyError("UNKNOWN_CARD_TYPE", cardType, "卡型不在当前 Registry 中")
      );
      return;
    }

    const candidate = candidates.find(
      (item) => item?.recommended_type === cardType
    );
    if (!candidate) {
      result.errors.push(
        cardAssemblyError(
          "NO_STRONGLY_RELATED_CANDIDATE",
          cardType,
          "知识结果没有返回该卡型的强相关展示候选"
        )
      );
      return;
    }

    const built = buildCard({
      cardType,
      candidate,
      input,
      retrieval: effectiveRetrieval,
      claimRegistry,
      evidenceRegistry,
      turnId,
      artifactId,
      index
    });
    if (!built.card) {
      result.errors.push(
        cardAssemblyError(
          built.code || "CARD_BUILD_FAILED",
          cardType,
          built.message || "卡片素材不完整"
        )
      );
      return;
    }

    const claimIds = uniqueStrings(built.supports_claim_ids).filter((claimId) =>
      claimRegistry.has(claimId)
    );
    if (CLAIM_BOUND_CARD_TYPES.has(cardType) && claimIds.length === 0) {
      result.errors.push(
        cardAssemblyError(
          "CARD_CLAIMS_MISSING",
          cardType,
          "知识或练习卡没有可验证的 Claim 绑定"
        )
      );
      return;
    }
    if (
      CLAIM_BOUND_CARD_TYPES.has(cardType) &&
      mustIncludeClaimIds.length > 0 &&
      !claimIds.some((claimId) => mustIncludeClaimIds.includes(claimId))
    ) {
      result.errors.push(
        cardAssemblyError(
          "CARD_CLAIM_MISMATCH",
          cardType,
          "卡片 Claim 与本轮 answer_brief.must_include 没有交集"
        )
      );
      return;
    }

    const validation = validateEducationCard(built.card, { allowedMediaHosts });
    if (!validation.valid) {
      result.errors.push(
        cardAssemblyError(
          "CARD_SCHEMA_INVALID",
          cardType,
          validation.errors.map((item) => `${item.path}: ${item.message}`).join("；")
        )
      );
      return;
    }

    result.cards.push(built.card);
    result.selected_card_types.push(cardType);
    if (claimIds.length > 0) {
      result.card_claim_bindings.push({
        card_id: built.card.id,
        supports_claim_ids: claimIds
      });
    }
  });

  return result;
}

export function validateEducationCard(card, { allowedMediaHosts = [] } = {}) {
  const type = String(card?.type || "");
  const definition = getEducationCardDefinition(type);
  if (!definition) {
    return {
      valid: false,
      errors: [
        {
          path: "$.type",
          code: "UNKNOWN_CARD_TYPE",
          message: `未知卡型 ${type || "(empty)"}`
        }
      ]
    };
  }

  const errors = [];
  validateAgainstSchema(card, definition.schema, "$", errors);
  validateMediaFields(card, normalizeAllowedHosts(allowedMediaHosts), errors);
  return { valid: errors.length === 0, errors };
}

export function createEducationA2UI({
  surfaceId,
  surface_id,
  cards = [],
  operation = "replace",
  stateVersion,
  state_version,
  turnSequence,
  turn_sequence,
  packageId,
  package_id = ""
} = {}) {
  const normalizedSurfaceId =
    safeIdentifier(surfaceId ?? surface_id) || "lesson_surface_main";
  const normalizedOperation = normalizeSurfaceOperation(operation);
  if (normalizedOperation === "preserve") {
    return {
      surfaceId: normalizedSurfaceId,
      surface_id: normalizedSurfaceId,
      catalogId: EDUCATION_CATALOG_ID,
      operation: normalizedOperation,
      cards: [],
      messages: []
    };
  }
  if (normalizedOperation === "delete") {
    return {
      surfaceId: normalizedSurfaceId,
      surface_id: normalizedSurfaceId,
      catalogId: EDUCATION_CATALOG_ID,
      operation: normalizedOperation,
      cards: [],
      messages: [
        {
          version: A2UI_VERSION,
          deleteSurface: { surfaceId: normalizedSurfaceId }
        }
      ]
    };
  }

  const safeCards = Array.isArray(cards) ? cards.map(clone) : [];
  const componentIds = safeCards.map((card, index) =>
    safeIdentifier(`edu_card_component_${index + 1}_${card.id}`)
  );
  const components = [
    {
      id: "root",
      component: "Column",
      children: componentIds
    },
    ...safeCards.map((card, index) => ({
      id: componentIds[index],
      component: "EducationCard",
      card
    }))
  ];
  const messages = [];
  if (normalizedOperation === "replace") {
    messages.push({
      version: A2UI_VERSION,
      createSurface: {
        surfaceId: normalizedSurfaceId,
        catalogId: EDUCATION_CATALOG_ID,
        sendDataModel: true,
        theme: { primaryColor: "#165DFF" }
      }
    });
  }
  messages.push(
    {
      version: A2UI_VERSION,
      updateComponents: {
        surfaceId: normalizedSurfaceId,
        components
      }
    },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId: normalizedSurfaceId,
        path: "/",
        value: {
          package_id: safeIdentifier(packageId || package_id),
          turn_sequence: nonNegativeInteger(turnSequence ?? turn_sequence, 0),
          state_version: nonNegativeInteger(stateVersion ?? state_version, 0),
          card_ids: safeCards.map((card) => card.id)
        }
      }
    }
  );

  return {
    surfaceId: normalizedSurfaceId,
    surface_id: normalizedSurfaceId,
    catalogId: EDUCATION_CATALOG_ID,
    operation: normalizedOperation,
    cards: safeCards,
    messages
  };
}

function buildCard({
  cardType,
  candidate,
  input,
  retrieval,
  claimRegistry,
  evidenceRegistry,
  turnId,
  artifactId,
  index
}) {
  if (cardType === "quiz.single-choice") {
    return buildQuizCard({
      candidate,
      input,
      retrieval,
      turnId,
      artifactId,
      index
    });
  }

  const candidateContent =
    candidate?.data &&
    typeof candidate.data === "object" &&
    !Array.isArray(candidate.data)
      ? clone(candidate.data)
      : null;
  const material =
    getTeachingMaterial(candidate.material_id) ||
    getTeachingMaterialForCardType(cardType);
  if (
    !candidateContent &&
    (!material || !material.supported_card_types?.includes(cardType))
  ) {
    return {
      card: null,
      code: "MATERIAL_NOT_FOUND",
      message: `未找到 ${cardType} 对应的 TeachingMaterial`
    };
  }

  const sources = Array.isArray(candidateContent?.sources)
    ? clone(candidateContent.sources)
    : resolveSources(material?.evidence_refs, evidenceRegistry);
  const presentation =
    candidate?.presentation &&
    typeof candidate.presentation === "object" &&
    !Array.isArray(candidate.presentation)
      ? candidate.presentation
      : null;
  const common = {
    id: createCardId(cardType, turnId, index),
    type: cardType,
    version: CARD_LIBRARY_VERSION,
    meta: candidateContent
      ? {
          title: String(
            presentation?.title ||
              candidateContent.title ||
              material?.presentation?.title ||
              ""
          ),
          eyebrow: String(
            presentation?.eyebrow ||
              material?.presentation?.eyebrow ||
              ""
          ),
          badge: String(
            presentation?.badge ||
              material?.presentation?.badge ||
              "真实生成"
          ),
          tags: uniqueStrings(
            presentation?.tags ?? material?.presentation?.tags
          ).slice(0, 4),
          artifact_ids: artifactId ? [artifactId] : []
        }
      : buildMeta(material, artifactId),
    props: {},
    state: { status: "ready" },
    actions: clone(
      Array.isArray(candidate.actions)
        ? candidate.actions
        : Array.isArray(material?.actions)
          ? material.actions
          : []
    )
  };
  common.meta.parameterization = createStaticKnowledgeCardParameterization({
    cardType,
    staticReason: "education_card_instance_server_controlled"
  });
  const content =
    candidateContent ||
    (material?.content && typeof material.content === "object"
      ? clone(material.content)
      : {});

  switch (cardType) {
    case "knowledge.explanation": {
      const insight =
        retrieval.learning_insight &&
        typeof retrieval.learning_insight === "object"
          ? retrieval.learning_insight
          : null;
      const answerState =
        input.assessmentState ??
        input.assessment_state ??
        input.activeQuiz ??
        input.active_quiz ??
        null;
      const isPostAnswerFormula =
        retrieval.status === "state_authoritative" &&
        answerState &&
        ["answered", "graded", "correct", "incorrect"].includes(
          String(answerState.status || "").toLowerCase()
        );
      if (insight) {
        common.meta = {
          ...common.meta,
          title: "学情诊断",
          eyebrow: "期中 × 期末 · Mock 学情",
          badge: "错题最多"
        };
      } else if (isPostAnswerFormula) {
        common.meta = {
          ...common.meta,
          title: "公式速记",
          eyebrow: "答题解析 · 关联知识",
          badge: "F=ma"
        };
      }
      common.props = {
        title: insight
          ? `薄弱知识点：${insight.topic_name || "牛顿第二定律"}`
          : isPostAnswerFormula
            ? "牛顿第二定律公式"
            : content.title,
        summary: insight
          ? `期中错 ${Number(insight.midterm_wrong_count || 0)} 题，期末错 ${Number(
              insight.final_wrong_count || 0
            )} 题，合计错 ${Number(insight.total_wrong_count || 0)} 题。`
          : content.summary,
        body: insight
          ? "期末比期中多错 1 题，建议先复习合外力、质量与加速度的关系，再用一道题检验。"
          : content.body,
        formula: content.formula,
        key_points: Array.isArray(content.key_points)
          ? clone(content.key_points)
          : (content.key_point_claim_ids || [])
              .map(
                (claimId) =>
                  claimRegistry.get(claimId) || getNewton2Claim(claimId)
              )
              .filter(Boolean)
              .map((claim) => claim.text),
        callout: content.callout,
        sources
      };
      break;
    }
    case "knowledge.mindmap":
      common.props = {
        title: content.title,
        root: content.root,
        branches: content.branches,
        sources
      };
      break;
    case "language.vocabulary":
      common.props = {
        title: content.title,
        entries: Array.isArray(content.entries) ? content.entries : [],
        sources
      };
      break;
    case "language.grammar":
      common.props = {
        title: content.title,
        pattern: content.pattern,
        explanation: content.explanation,
        examples: Array.isArray(content.examples) ? content.examples : [],
        breakdown: Array.isArray(content.breakdown)
          ? content.breakdown
          : [],
        tip: content.tip,
        sources
      };
      break;
    case "media.image":
      common.props = pickDefined(content, [
        "title",
        "src",
        "alt",
        "caption",
        "decorative",
        "credit"
      ]);
      break;
    case "media.video":
      common.props = pickDefined(content, [
        "title",
        "src",
        "poster",
        "availability",
        "duration_seconds",
        "caption",
        "caption_src",
        "caption_language"
      ]);
      break;
    case "oral.practice": {
      const oral = {
        ...content,
        ...((input.oralPractice ?? input.oral_practice) &&
        typeof (input.oralPractice ?? input.oral_practice) === "object"
          ? input.oralPractice ?? input.oral_practice
          : {})
      };
      common.props = pickDefined(oral, [
        "title",
        "prompt",
        "reference_answer",
        "time_limit_seconds",
        "scoring_dimensions",
        "tips"
      ]);
      common.state = {
        status: String(oral.status || "ready"),
        recording_seconds: Number(oral.recording_seconds || 0)
      };
      break;
    }
    case "exam.progress": {
      const exam = mergeExamContent(content, input.exam);
      common.props = pickDefined(exam, [
        "title",
        "exam_id",
        "current",
        "total",
        "answered",
        "correct",
        "remaining_seconds",
        "progress",
        "message"
      ]);
      common.state = {
        status: String(exam.status || "in_progress"),
        state_version: nonNegativeInteger(
          input.stateVersion ?? input.state_version,
          0
        ),
        exam_id: String(exam.exam_id || "")
      };
      break;
    }
    case "exam.result": {
      const exam = mergeExamContent(content, input.exam);
      common.props = pickDefined(exam, [
        "title",
        "exam_id",
        "score",
        "total_score",
        "total",
        "correct",
        "incorrect",
        "answered",
        "duration_seconds",
        "grade",
        "feedback"
      ]);
      common.state = {
        status: String(exam.status || "completed"),
        state_version: nonNegativeInteger(
          input.stateVersion ?? input.state_version,
          0
        ),
        exam_id: String(exam.exam_id || "")
      };
      break;
    }
    case "compiler.status":
      common.props = {
        ...pickDefined(content, [
          "title",
          "artifact_id",
          "source_type",
          "status",
          "progress",
          "message",
          "knowledge_unit_count",
          "suggested_cards",
          "steps"
        ]),
        sources
      };
      common.state = {
        status: String(content.status || "compiled"),
        progress: Number(content.progress || 0),
        state_version: nonNegativeInteger(
          input.stateVersion ?? input.state_version,
          0
        ),
        artifact_id: String(content.artifact_id || artifactId)
      };
      break;
    default:
      return {
        card: null,
        code: "UNSUPPORTED_CARD_TYPE",
        message: `尚未实现 ${cardType} 的确定性映射`
      };
  }

  return {
    card: common,
    supports_claim_ids: uniqueStrings(
      candidate.supports_claim_ids ?? material?.supports_claim_ids
    )
  };
}

function buildQuizCard({
  candidate,
  input,
  retrieval,
  turnId,
  artifactId,
  index
}) {
  const candidateQuestionId =
    candidate.assessment_item_id ??
    input.assessmentItemId ??
    input.assessment_item_id ??
    input.assessmentState?.question_id ??
    input.assessment_state?.question_id ??
    input.activeQuiz?.question_id ??
    input.active_quiz?.question_id ??
    input.exam?.active_question_id ??
    retrieval.matches
      ?.flatMap((match) => match?.assessment_item_ids || [])
      .find(Boolean);
  const privateItem =
    findAssessmentItem(input.assessmentItems ?? input.assessment_items, candidateQuestionId) ||
    getPrivateAssessmentItem(candidateQuestionId);
  if (!privateItem) {
    return {
      card: null,
      code: "ASSESSMENT_ITEM_NOT_FOUND",
      message: "题卡候选没有对应的服务端私有题目"
    };
  }

  const assessmentState = resolveAssessmentState(
    input.assessmentState ??
      input.assessment_state ??
      input.activeQuiz ??
      input.active_quiz,
    privateItem.question_id
  );
  const assessmentStatus = String(
    assessmentState.status ?? assessmentState.result ?? ""
  ).toLowerCase();
  const revealed =
    assessmentState.reveal_answer === true ||
    assessmentState.answered === true ||
    assessmentState.graded === true ||
    typeof assessmentState.correct === "boolean" ||
    ["correct", "incorrect", "answered", "graded", "completed"].includes(
      assessmentStatus
    );
  const selected = revealed
    ? String(
        assessmentState.selected ??
          assessmentState.selected_answer ??
          assessmentState.answer ??
          assessmentState.value ??
          ""
      )
    : "";
  const correct = revealed
    ? typeof assessmentState.correct === "boolean"
      ? assessmentState.correct
      : assessmentStatus === "correct"
    : null;
  const locked = revealed || assessmentState.locked === true;
  const props = {
    title: privateItem.title,
    question_id: privateItem.question_id,
    prompt: privateItem.prompt,
    options: (privateItem.options || []).map((option) =>
      pickDefined(option, ["id", "value", "label", "description"])
    ),
    hint: privateItem.hint
  };
  if (revealed) props.explanation = privateItem.explanation;

  const state = {
    status: revealed ? (correct ? "correct" : "incorrect") : "awaiting_answer",
    selected,
    correct,
    locked,
    state_version: nonNegativeInteger(
      input.stateVersion ?? input.state_version,
      0
    )
  };
  if (revealed) state.correct_answer = privateItem.correct_answer;

  return {
    card: {
      id: createCardId("quiz.single-choice", turnId, index),
      type: "quiz.single-choice",
      version: CARD_LIBRARY_VERSION,
      meta: {
        title: "单项选择题",
        eyebrow: "高中物理 · 牛顿第二定律",
        badge: revealed ? "已判题" : "待作答",
        tags: ["牛顿第二定律"],
        artifact_ids: artifactId ? [artifactId] : [],
        parameterization: createStaticKnowledgeCardParameterization({
          cardType: "quiz.single-choice",
          staticReason: "assessment_state_server_controlled"
        })
      },
      props,
      state,
      actions: revealed
        ? [{ type: "learning.continue", label: "继续学习" }]
        : (privateItem.options || []).map((option) => ({
            type: "answer.select",
            label: `选择 ${option.id}`,
            payload: {
              question_id: privateItem.question_id,
              value: option.value ?? option.id,
              observed_state_version: nonNegativeInteger(
                input.stateVersion ?? input.state_version,
                0
              )
            }
          }))
    },
    supports_claim_ids: uniqueStrings(
      candidate.supports_claim_ids ?? privateItem.supports_claim_ids
    )
  };
}

function hasAuthoritativeStateCardInput(input) {
  if (!input || typeof input !== "object") return false;
  const requested = uniqueStrings(
    input.requestedCardTypes ??
      input.requested_card_types ??
      input.intent?.requested_card_types
  );
  const requestsStateCard = requested.some((type) =>
    [
      "quiz.single-choice",
      "exam.progress",
      "exam.result",
      "oral.practice",
      "compiler.status",
      "knowledge.explanation",
      "knowledge.mindmap"
    ].includes(type)
  );
  return Boolean(
    requestsStateCard ||
      input.assessmentState ||
      input.assessment_state ||
      input.activeQuiz ||
      input.active_quiz ||
      input.exam ||
      input.oralPractice ||
      input.oral_practice ||
      input.compilerStatus ||
      input.compiler_status
  );
}

function inferAuthoritativeStateCardTypes(input) {
  const exam = input.exam && typeof input.exam === "object" ? input.exam : null;
  if (exam) {
    const completed =
      ["completed", "finished", "result"].includes(String(exam.status || "").toLowerCase()) ||
      exam.completed === true;
    if (completed) return ["exam.result"];
    const types = ["exam.progress"];
    if (exam.active_question_id || exam.question_id) types.push("quiz.single-choice");
    return types;
  }
  if (input.oralPractice || input.oral_practice) return ["oral.practice"];
  if (input.compilerStatus || input.compiler_status) return ["compiler.status"];
  if (
    input.assessmentState ||
    input.assessment_state ||
    input.activeQuiz ||
    input.active_quiz
  ) {
    return ["quiz.single-choice"];
  }
  return [];
}

function createAuthoritativeStateCandidates(input, selectedTypes) {
  return selectedTypes
    .map((cardType) => {
      if (cardType === "quiz.single-choice") {
        const assessmentState =
          input.assessmentState ??
          input.assessment_state ??
          input.activeQuiz ??
          input.active_quiz ??
          {};
        const assessmentItems = input.assessmentItems ?? input.assessment_items;
        const questionId =
          assessmentState.question_id ??
          input.exam?.active_question_id ??
          input.exam?.question_id ??
          firstAssessmentItemId(assessmentItems) ??
          "quiz_newton_force_mass_01";
        const item =
          findAssessmentItem(assessmentItems, questionId) ||
          getPrivateAssessmentItem(questionId);
        return item
          ? {
              assessment_item_id: item.question_id,
              recommended_type: cardType,
              supports_claim_ids: uniqueStrings(item.supports_claim_ids)
            }
          : null;
      }

      if (
        ![
          "exam.progress",
          "exam.result",
          "oral.practice",
          "compiler.status",
          "knowledge.explanation",
          "knowledge.mindmap"
        ].includes(cardType)
      ) {
        return null;
      }
      const material = getTeachingMaterialForCardType(cardType);
      return material
        ? {
            material_id: material.material_id,
            recommended_type: cardType,
            supports_claim_ids: uniqueStrings(material.supports_claim_ids)
          }
        : null;
    })
    .filter(Boolean);
}

function firstAssessmentItemId(input) {
  if (Array.isArray(input)) {
    return String(input.find((item) => item?.question_id)?.question_id || "") || null;
  }
  if (isPlainObject(input) && input.question_id) return String(input.question_id);
  if (isPlainObject(input)) {
    const first = Object.values(input).find((item) => item?.question_id);
    return first ? String(first.question_id) : null;
  }
  return null;
}

function selectCardTypes({ requestText, requestedCardTypes, stateCardTypes = [] }) {
  const explicit = uniqueStrings(requestedCardTypes);
  if (explicit.length > 0) return explicit.slice(0, MAX_CARDS_PER_TURN);
  const authoritative = uniqueStrings(stateCardTypes);
  if (authoritative.length > 0) return authoritative.slice(0, MAX_CARDS_PER_TURN);

  const text = String(requestText || "").normalize("NFKC").toLowerCase();
  if (/编译|知识产物|资料状态/u.test(text)) return ["compiler.status"];
  if (/考试结果|测验结果|成绩|得分/u.test(text)) return ["exam.result"];
  if (/模拟考试|模拟测验|开始考试/u.test(text)) {
    return ["exam.progress", "quiz.single-choice"];
  }
  if (/口语|复述|用自己的话/u.test(text)) return ["oral.practice"];
  if (
    /(?:先|讲完|解释完).{0,12}(?:出题|练习|考考)|(?:讲解|解释).{0,8}(?:再|然后).{0,8}(?:出题|练习)/u.test(
      text
    )
  ) {
    return ["knowledge.explanation", "quiz.single-choice"];
  }

  const visualTypes = [];
  if (/思维导图|知识结构|脑图/u.test(text)) {
    visualTypes.push("knowledge.mindmap");
  }
  if (/图片|示意图|小车图/u.test(text)) visualTypes.push("media.image");
  if (/视频|动画/u.test(text)) visualTypes.push("media.video");
  const wantsQuiz = /出题|选择题|练习|考考/u.test(text);
  const wantsExplicitExplanationCard = /讲解卡|知识卡|文字讲解/u.test(text);

  if (/多模态/u.test(text) && visualTypes.length === 0) {
    return ["knowledge.explanation", "media.image", "media.video"];
  }
  if (visualTypes.length > 0) {
    const selected = wantsExplicitExplanationCard
      ? ["knowledge.explanation", ...visualTypes]
      : [...visualTypes];
    if (wantsQuiz) selected.push("quiz.single-choice");
    return [...new Set(selected)].slice(0, MAX_CARDS_PER_TURN);
  }
  if (wantsQuiz) return ["quiz.single-choice"];
  return ["knowledge.explanation"];
}

function inspectCardRegistry() {
  const errors = [];
  if (CARD_LIBRARY_VERSION !== CONTRACT_VERSION) {
    errors.push(
      `CARD_LIBRARY_VERSION=${CARD_LIBRARY_VERSION} 与 CONTRACT_VERSION=${CONTRACT_VERSION} 不一致`
    );
  }
  if (A2UI_VERSION !== "v0.9") errors.push(`A2UI_VERSION 必须是 v0.9，当前为 ${A2UI_VERSION}`);
  if (EDUCATION_CATALOG_ID !== "urn:a2ui:catalog:education:1.0") {
    errors.push(`Education Catalog ID 不符合 MVP 1.0：${EDUCATION_CATALOG_ID}`);
  }

  const definitions = REGISTRY_CARD_DEFINITIONS;
  const definitionTypes = new Set(definitions.map((definition) => definition.type));
  EXPECTED_MVP_CARD_TYPES.forEach((type) => {
    if (!definitionTypes.has(type)) errors.push(`Registry 缺少卡型 ${type}`);
  });
  if (
    definitions.length !== EXPECTED_MVP_CARD_TYPES.length ||
    [...definitionTypes].some(
      (type) => !EXPECTED_MVP_CARD_TYPES.includes(type)
    )
  ) {
    errors.push(
      `Registry 必须恰好包含 MVP 的十一类卡型，当前为 ${[
        ...definitionTypes
      ].join(", ")}`
    );
  }
  definitions.forEach((definition) => {
    if (!definition?.schema || definition.schema.type !== "object") {
      errors.push(`${definition?.type || "unknown"} 缺少可执行 JSON Schema`);
      return;
    }
    if (definition.version !== CARD_LIBRARY_VERSION) {
      errors.push(`${definition.type} 的版本不是 ${CARD_LIBRARY_VERSION}`);
    }
    const mockErrors = [];
    validateAgainstSchema(definition.mockData, definition.schema, "$", mockErrors);
    validateMediaFields(definition.mockData, [], mockErrors);
    if (mockErrors.length > 0) {
      errors.push(
        `${definition.type} 的 Registry Mock 未通过自身 Schema：${mockErrors
          .map((item) => item.message)
          .join("，")}`
      );
    }
  });

  return {
    valid: errors.length === 0,
    card_library_version: CARD_LIBRARY_VERSION,
    contract_version: CONTRACT_VERSION,
    a2ui_version: A2UI_VERSION,
    catalog_id: EDUCATION_CATALOG_ID,
    supported_card_types: [...definitionTypes],
    errors
  };
}

function validateAgainstSchema(value, schema, path, errors) {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.oneOf)) {
    const successful = schema.oneOf.filter((candidate) => {
      const candidateErrors = [];
      validateAgainstSchema(value, candidate, path, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (successful.length !== 1) {
      errors.push({
        path,
        code: "ONE_OF",
        message: "值必须且只能匹配一个 oneOf 分支"
      });
    }
    return;
  }

  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    errors.push({
      path,
      code: "CONST",
      message: `必须等于 ${JSON.stringify(schema.const)}`
    });
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    errors.push({
      path,
      code: "ENUM",
      message: `必须是 ${schema.enum.join(" / ")}`
    });
    return;
  }
  if (schema.type && !matchesJsonType(value, schema.type)) {
    errors.push({
      path,
      code: "TYPE",
      message: `必须是 ${schema.type}`
    });
    return;
  }

  if (typeof value === "string") {
    if (schema.pattern) {
      let matches = false;
      try {
        matches = new RegExp(schema.pattern, "u").test(value);
      } catch {
        matches = false;
      }
      if (!matches) {
        errors.push({ path, code: "PATTERN", message: "字符串格式不符合 Schema" });
      }
    }
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) {
      errors.push({ path, code: "MIN_LENGTH", message: `长度不能小于 ${schema.minLength}` });
    }
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) {
      errors.push({ path, code: "MAX_LENGTH", message: `长度不能超过 ${schema.maxLength}` });
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) {
      errors.push({ path, code: "MINIMUM", message: `不能小于 ${schema.minimum}` });
    }
    if (Number.isFinite(schema.maximum) && value > schema.maximum) {
      errors.push({ path, code: "MAXIMUM", message: `不能大于 ${schema.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) {
      errors.push({ path, code: "MIN_ITEMS", message: `至少需要 ${schema.minItems} 项` });
    }
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
      errors.push({ path, code: "MAX_ITEMS", message: `最多允许 ${schema.maxItems} 项` });
    }
    if (schema.items) {
      value.forEach((item, index) =>
        validateAgainstSchema(item, schema.items, `${path}[${index}]`, errors)
      );
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    (Array.isArray(schema.required) ? schema.required : []).forEach((key) => {
      if (!Object.hasOwn(value, key)) {
        errors.push({
          path: `${path}.${key}`,
          code: "REQUIRED",
          message: "缺少必填字段"
        });
      }
    });
    Object.entries(properties).forEach(([key, propertySchema]) => {
      if (Object.hasOwn(value, key)) {
        validateAgainstSchema(value[key], propertySchema, `${path}.${key}`, errors);
      }
    });
    if (schema.additionalProperties === false) {
      Object.keys(value).forEach((key) => {
        if (!Object.hasOwn(properties, key)) {
          errors.push({
            path: `${path}.${key}`,
            code: "ADDITIONAL_PROPERTY",
            message: "Schema 不允许该字段"
          });
        }
      });
    }
  }
}

function validateMediaFields(card, allowedHosts, errors) {
  const fields = MEDIA_FIELDS[card?.type] || [];
  fields.forEach((field) => {
    const value = card?.props?.[field];
    if (value == null || value === "") return;
    if (!isSafeMediaUri(value, allowedHosts)) {
      errors.push({
        path: `$.props.${field}`,
        code: "UNSAFE_MEDIA_URI",
        message: "媒体地址必须是安全的 /assets/ 路径或命中白名单的 http(s) 地址"
      });
    }
  });
}

function isSafeMediaUri(value, allowedHosts) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\\") || /[\u0000-\u001f\u007f]/u.test(raw)) return false;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return false;
  }
  if (
    decoded.startsWith("/assets/") &&
    !decoded.includes("..") &&
    !decoded.startsWith("//") &&
    !decoded.includes("/./")
  ) {
    return true;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  return allowedHosts.some(
    (allowed) =>
      hostname === allowed ||
      (allowed.startsWith(".") && hostname.endsWith(allowed)) ||
      hostname.endsWith(`.${allowed}`)
  );
}

function buildMeta(material, artifactId) {
  const presentation =
    material.presentation && typeof material.presentation === "object"
      ? material.presentation
      : {};
  return {
    title: String(presentation.title || material.content?.title || ""),
    eyebrow: String(presentation.eyebrow || ""),
    badge: String(presentation.badge || ""),
    tags: uniqueStrings(presentation.tags).slice(0, 4),
    artifact_ids: artifactId ? [artifactId] : []
  };
}

function resolveSources(evidenceRefs, evidenceRegistry) {
  return uniqueStrings(evidenceRefs)
    .map(
      (evidenceId) =>
        evidenceRegistry.get(evidenceId) || getNewton2Evidence(evidenceId)
    )
    .filter(Boolean)
    .map((item) => ({
      title: item.title,
      citation_id: item.evidence_id
    }));
}

function findAssessmentItem(input, questionId) {
  if (!input) return null;
  if (Array.isArray(input)) {
    return (
      clone(
        input.find((item) => String(item?.question_id || "") === String(questionId || ""))
      ) || null
    );
  }
  if (isPlainObject(input) && input.question_id) {
    return String(input.question_id) === String(questionId || "") ? clone(input) : null;
  }
  if (isPlainObject(input) && isPlainObject(input[questionId])) {
    return clone(input[questionId]);
  }
  return null;
}

function resolveAssessmentState(input, questionId) {
  if (!input) return {};
  if (Array.isArray(input)) {
    return (
      clone(
        input.find((item) => String(item?.question_id || "") === String(questionId || ""))
      ) || {}
    );
  }
  if (isPlainObject(input) && input.question_id) {
    return String(input.question_id) === String(questionId || "") ? clone(input) : {};
  }
  if (isPlainObject(input) && isPlainObject(input[questionId])) {
    return clone(input[questionId]);
  }
  return isPlainObject(input) ? clone(input) : {};
}

function mergeExamContent(content, exam) {
  if (!exam || typeof exam !== "object") return clone(content);
  const source =
    exam.result && typeof exam.result === "object"
      ? { ...exam, ...exam.result }
      : exam.progress && typeof exam.progress === "object"
        ? { ...exam, ...exam.progress }
        : exam;
  return { ...clone(content), ...clone(source) };
}

function extractMustIncludeClaimIds(answerBrief) {
  if (!answerBrief || typeof answerBrief !== "object") return [];
  const value = answerBrief.must_include ?? answerBrief.mustInclude ?? [];
  if (Array.isArray(value)) {
    return uniqueStrings(
      value.map((item) =>
        typeof item === "string" ? item : item?.claim_id ?? item?.claimId
      )
    );
  }
  if (value && typeof value === "object") {
    return uniqueStrings(
      value.claim_ids ??
        value.claimIds ??
        [value.claim_id ?? value.claimId]
    );
  }
  return [];
}

function normalizeSurfaceOperation(value) {
  const normalized = String(value || "replace").toLowerCase();
  if (["preserve", "none", "no_op", "noop"].includes(normalized)) return "preserve";
  if (["delete", "delete_surface"].includes(normalized)) return "delete";
  if (["update", "update_surface", "patch"].includes(normalized)) return "update";
  return "replace";
}

function matchesJsonType(value, type) {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function normalizeAllowedHosts(value) {
  return uniqueStrings(value)
    .map((host) => host.toLowerCase().replace(/^\*\./, "."))
    .filter((host) => /^[a-z0-9.-]+$/u.test(host));
}

function createCardId(cardType, turnId, index) {
  return safeIdentifier(`card_${cardType.replace(/\./g, "_")}_${turnId}_${index + 1}`);
}

function cardAssemblyError(code, cardType, message) {
  return {
    code,
    card_type: cardType,
    message: String(message || "")
  };
}

function pickDefined(source, keys) {
  const result = {};
  keys.forEach((key) => {
    if (source && source[key] !== undefined) result[key] = clone(source[key]);
  });
  return result;
}

function uniqueStrings(value) {
  const values = Array.isArray(value)
    ? value
    : value == null
      ? []
      : [value];
  return [
    ...new Set(
      values
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  ];
}

function safeIdentifier(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 160);
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
