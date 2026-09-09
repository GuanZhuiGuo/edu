import {
  ENGLISH_SPEAKING_ARTIFACT_ID,
  ENGLISH_SPEAKING_ARTIFACT_VERSION,
  ENGLISH_SPEAKING_TOPIC_ID,
  MOCK_LEARNER_ASSESSMENT_HISTORY,
  NEWTON2_ARTIFACT_ID,
  NEWTON2_ARTIFACT_VERSION,
  NEWTON2_TOPIC_ID,
  getPrivateAssessmentItem,
  getTeachingMaterial,
  getTeachingMaterialForCardType,
  listEnglishSpeakingClaims,
  listEnglishSpeakingEvidence,
  listNewton2Claims,
  listNewton2Evidence,
  listPrivateAssessmentItemIds
} from "./mvp-education-fixtures.js";

const CONTEXT_MAX_ACCEPTED_TURNS = 3;
const CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;
const NEWTON2_EXCLUSION =
  /(?:牛顿)?(?:第[一1]定律|第[三3]定律)|牛[一1]|牛[三3]|惯性定律|作用力.{0,4}反作用力/u;
const EXPLICIT_OTHER_TOPIC =
  /光合作用|细胞|遗传|化学反应|元素周期|电磁感应|欧姆定律|万有引力|相对论|英语|语法|历史|地理/u;
const EXPLICIT_TOPIC =
  /牛顿第?二(?:运动)?定律|牛[二2]|newton'?s second law|f=ma/iu;
const FORCE_ACCELERATION = /合外力/u;
const ACCELERATION = /加速度/u;
const MASS = /质量/u;
const FORCE = /(?:合外力|受力|作用力|力)/u;
const PHYSICS_WEAK_CUE =
  /物理|牛顿|运动|小车|受力|合外力|质量|加速度|公式|力|f=ma|ma/iu;
const FOLLOW_UP =
  /^(?:那|那么|所以|再|还)?(?:为什么|什么意思|怎么理解|如何理解|能展开吗|能再解释一下吗|继续|再讲讲|举个例子|这个呢|它呢|这个公式什么意思|为什么会这样|怎么做)(?:呢|呀|啊|吗)?$/u;
const QUIZ_CONTEXT_ACTION =
  /^(?:我选|选|答案|第[一二三四1234]个|选项[一二三四abcdABCD]|提示|给点提示|下一题|继续答题|复习|再看一遍)/u;
const CLEAR_OR_SWITCH_CONTEXT = /清空|结束(?:本次)?学习|开始新会话|换个话题|不聊这个/u;
const LEARNING_ANALYSIS_REQUEST =
  /(?=.*(?:期中|期末))(?=.*(?:错|薄弱|失分|知识点|掌握)).*(?:期中|期末)|(?=.*(?:期中|期末))(?=.*(?:哪个|最多|比较)).*/u;
const GENERIC_QUIZ_REQUEST = /出题|考考我|来一道|练习题|做道题/u;
const ENGLISH_SPEAKING_REQUEST =
  /can\s+you\s+sp(?:ea|ee)k(?:\s+to\s+me)?\s+in\s+english|(?:please\s+)?(?:speak|answer)\s+in\s+english|用英语|英语回答|说英语/iu;
const TRAILING_PUNCTUATION = /[。．.!！?？,，;；:：…\s]+$/u;

const TYPE_TO_MATERIAL = Object.freeze({
  "knowledge.explanation": "material_newton2_explanation",
  "knowledge.mindmap": "material_newton2_mindmap",
  "media.image": "material_newton2_image",
  "media.video": "material_newton2_video",
  "oral.practice": "material_newton2_oral",
  "exam.progress": "material_newton2_exam_progress",
  "exam.result": "material_newton2_exam_result",
  "compiler.status": "material_newton2_compiler",
  "language.vocabulary": "material_english_speaking_vocabulary",
  "language.grammar": "material_english_speaking_grammar"
});

const MISCONCEPTIONS = Object.freeze([
  "任意一个力都等于 ma",
  "加速度方向一定与速度方向相同",
  "未说明保持不变的物理量时直接断言加速度与力或质量的比例关系"
]);

export class MockKnowledgeProvider {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = typeof clock === "function" ? clock : () => Date.now();
    this.faultInjection = null;
  }

  /**
   * 仅供自动化验收或本地故障演练调用。用户文本不会触发此开关。
   */
  setFaultInjection(input = null) {
    if (input == null || input === false || input === "none") {
      this.faultInjection = null;
      return;
    }

    const requested =
      typeof input === "string"
        ? { mode: input }
        : input && typeof input === "object"
          ? input
          : {};
    const mode = String(requested.mode || requested.code || "").toLowerCase();
    if (!["timeout", "error", "unavailable", "provider_timeout", "provider_error"].includes(mode)) {
      throw new TypeError("Unsupported MockKnowledgeProvider fault injection mode");
    }

    this.faultInjection = {
      mode,
      retryable: requested.retryable !== false,
      once: requested.once !== false
    };
  }

  clearFaultInjection() {
    this.faultInjection = null;
  }

  async search(input = {}, contextOverride = {}) {
    const request =
      typeof input === "string"
        ? { query: input }
        : input && typeof input === "object"
          ? input
          : {};
    const query = safeText(request.query ?? request.raw_text ?? request.text, 12000);
    const normalizedQuery = normalizeKnowledgeQuery(query);
    const context = {
      ...request,
      ...(request.context && typeof request.context === "object" ? request.context : {}),
      ...(contextOverride && typeof contextOverride === "object" ? contextOverride : {})
    };

    const fault = this.consumeFaultInjection();
    if (fault) return createErrorResult(query, normalizedQuery, fault);

    if (ENGLISH_SPEAKING_REQUEST.test(normalizedQuery)) {
      return createEnglishSpeakingResult(query, normalizedQuery);
    }

    const semanticHint = normalizeSemanticHint(
      request.semantic_hint ?? request.semanticHint ?? context.semantic_hint
    );
    const decision = decideNewton2Match({
      normalizedQuery,
      semanticHint,
      context,
      now: this.clock()
    });

    if (!decision.matched) {
      return createNoMatchResult(query, normalizedQuery, decision.reason);
    }

    const selectedClaims = selectClaims(normalizedQuery);
    const selectedClaimIds = new Set(selectedClaims.map((claim) => claim.claim_id));
    const evidence = selectEvidence(selectedClaimIds);
    const presentationCandidates = selectPresentationCandidates(
      normalizedQuery,
      selectedClaimIds,
      decision.match_reason,
      context
    );
    const assessmentItemIds = selectAssessmentItemIds(normalizedQuery, context);

    const learningInsight =
      decision.match_reason === "learning_history_comparison"
        ? structuredClone(MOCK_LEARNER_ASSESSMENT_HISTORY.weakest_topic)
        : null;

    return {
      retrieval_id: `retrieval_mock_newton2_${stableHash(
        `${normalizedQuery}|${decision.match_reason}`
      )}`,
      provider: "mock",
      status: "matched",
      query,
      normalized_query: normalizedQuery,
      topic_id: NEWTON2_TOPIC_ID,
      artifact_id: NEWTON2_ARTIFACT_ID,
      artifact_version: NEWTON2_ARTIFACT_VERSION,
      ...(learningInsight ? { learning_insight: learningInsight } : {}),
      matches: [
        {
          knowledge_unit_id: "ku_physics_newton2_mvp1",
          score: 1,
          match_reason: decision.match_reason,
          claims: selectedClaims,
          must_not_claim: [...MISCONCEPTIONS],
          evidence_refs: evidence.map((item) => item.evidence_id),
          presentation_candidates: presentationCandidates,
          assessment_item_ids: assessmentItemIds
        }
      ],
      evidence
    };
  }

  consumeFaultInjection() {
    if (!this.faultInjection) return null;
    const fault = { ...this.faultInjection };
    if (fault.once) this.faultInjection = null;
    return fault;
  }
}

export const mockKnowledgeProvider = new MockKnowledgeProvider();

export { getPrivateAssessmentItem, getTeachingMaterial };

export function normalizeKnowledgeQuery(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/f\s*=\s*m\s*a/giu, "f=ma")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(TRAILING_PUNCTUATION, "");
}

export function getTeachingMaterialById(materialId) {
  return getTeachingMaterial(materialId);
}

export function getTeachingMaterialByCardType(cardType) {
  return getTeachingMaterialForCardType(cardType);
}

export function getPrivateAssessmentItemById(questionId) {
  return getPrivateAssessmentItem(questionId);
}

export function listPrivateAssessmentIds() {
  return listPrivateAssessmentItemIds();
}

function decideNewton2Match({ normalizedQuery, semanticHint, context, now }) {
  if (!normalizedQuery) return { matched: false, reason: "empty_query" };
  if (LEARNING_ANALYSIS_REQUEST.test(normalizedQuery)) {
    return { matched: true, match_reason: "learning_history_comparison" };
  }
  if (NEWTON2_EXCLUSION.test(normalizedQuery)) {
    return { matched: false, reason: "explicitly_excluded_newton_law" };
  }

  if (EXPLICIT_TOPIC.test(normalizedQuery)) {
    return { matched: true, match_reason: "supported_topic_exact_mock" };
  }
  if (FORCE_ACCELERATION.test(normalizedQuery) && ACCELERATION.test(normalizedQuery)) {
    return { matched: true, match_reason: "force_acceleration_relation" };
  }
  if (
    FORCE.test(normalizedQuery) &&
    MASS.test(normalizedQuery) &&
    ACCELERATION.test(normalizedQuery)
  ) {
    return { matched: true, match_reason: "force_mass_acceleration_relation" };
  }

  const hasConflict =
    EXPLICIT_OTHER_TOPIC.test(normalizedQuery) || CLEAR_OR_SWITCH_CONTEXT.test(normalizedQuery);
  if (!hasConflict && GENERIC_QUIZ_REQUEST.test(normalizedQuery)) {
    return {
      matched: true,
      match_reason: hasRecentNewton2Context(context, now)
        ? "recent_topic_learning_action"
        : "default_newton2_quiz_mock"
    };
  }
  if (
    !hasConflict &&
    semanticHint.topic_id === NEWTON2_TOPIC_ID &&
    semanticHint.confidence >= 0.85 &&
    PHYSICS_WEAK_CUE.test(normalizedQuery)
  ) {
    return { matched: true, match_reason: "qualified_semantic_hint" };
  }

  if (
    !hasConflict &&
    hasActiveNewton2Assessment(context) &&
    QUIZ_CONTEXT_ACTION.test(normalizedQuery)
  ) {
    return { matched: true, match_reason: "active_assessment_context" };
  }
  if (
    !hasConflict &&
    hasRecentNewton2Context(context, now) &&
    FOLLOW_UP.test(normalizedQuery)
  ) {
    return { matched: true, match_reason: "recent_supported_context" };
  }

  return { matched: false, reason: "unsupported_topic" };
}

function hasRecentNewton2Context(context, now) {
  if (!context || typeof context !== "object") return false;
  if (context.context_cleared || context.topic_cleared || context.new_session) return false;

  const currentSequence = toInteger(
    context.current_turn_sequence ?? context.turn_sequence ?? context.last_turn_sequence
  );
  const explicitLastMatch = context.last_match ?? context.lastMatch;
  if (explicitLastMatch && typeof explicitLastMatch === "object") {
    if (
      isNewton2TopicRecord(explicitLastMatch) &&
      isRecentRecord(explicitLastMatch, currentSequence, now)
    ) {
      return true;
    }
  }

  if (
    String(context.last_matched_topic_id ?? context.last_topic_id ?? "") ===
    NEWTON2_TOPIC_ID
  ) {
    const record = {
      turn_sequence:
        context.last_matched_turn_sequence ?? context.last_topic_turn_sequence,
      occurred_at: context.last_matched_at ?? context.last_topic_at
    };
    if (isRecentRecord(record, currentSequence, now)) return true;
  }
  if (
    Array.isArray(context.last_claim_ids) &&
    context.last_claim_ids.some((claimId) =>
      String(claimId).startsWith("claim_newton2_")
    )
  ) {
    const record = {
      claim_ids: context.last_claim_ids,
      turn_sequence:
        context.last_matched_turn_sequence ??
        context.last_knowledge_turn_sequence ??
        context.last_turn_sequence,
      occurred_at: context.last_matched_at ?? context.last_knowledge_at
    };
    if (isRecentRecord(record, currentSequence, now)) return true;
  }

  const recentTurns = Array.isArray(context.recent_turns)
    ? context.recent_turns
    : Array.isArray(context.accepted_turns)
      ? context.accepted_turns
      : [];
  const accepted = recentTurns
    .filter((turn) => turn && typeof turn === "object" && turn.accepted !== false)
    .slice(-CONTEXT_MAX_ACCEPTED_TURNS);
  return accepted.some(
    (turn) => isNewton2TopicRecord(turn) && isRecentRecord(turn, currentSequence, now)
  );
}

function hasActiveNewton2Assessment(context) {
  const activeQuiz = context?.active_quiz ?? context?.activeQuiz;
  const exam = context?.exam;
  return [activeQuiz, exam].some((value) => {
    if (!value || typeof value !== "object") return false;
    if (String(value.topic_id || "") === NEWTON2_TOPIC_ID) return true;
    const questionId = String(value.question_id ?? value.active_question_id ?? "");
    return questionId.startsWith("quiz_newton_");
  });
}

function isNewton2TopicRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (
    String(record.topic_id ?? record.matched_topic_id ?? record.semantic_topic_id ?? "") ===
    NEWTON2_TOPIC_ID
  ) {
    return true;
  }
  if (String(record.artifact_id ?? "") === NEWTON2_ARTIFACT_ID) return true;
  const claimIds = record.claim_ids ?? record.last_claim_ids;
  return (
    Array.isArray(claimIds) &&
    claimIds.some((claimId) => String(claimId).startsWith("claim_newton2_"))
  );
}

function isRecentRecord(record, currentSequence, now) {
  const sequence = toInteger(
    record.turn_sequence ?? record.sequence ?? record.accepted_turn_sequence
  );
  if (
    currentSequence != null &&
    sequence != null &&
    (currentSequence - sequence < 0 ||
      currentSequence - sequence > CONTEXT_MAX_ACCEPTED_TURNS)
  ) {
    return false;
  }

  const timestamp = Date.parse(
    record.occurred_at ??
      record.timestamp ??
      record.matched_at ??
      record.updated_at ??
      ""
  );
  if (Number.isFinite(timestamp) && (now - timestamp < 0 || now - timestamp > CONTEXT_MAX_AGE_MS)) {
    return false;
  }

  return sequence != null || Number.isFinite(timestamp);
}

function selectClaims(normalizedQuery) {
  const allClaims = listNewton2Claims();
  const byId = new Map(allClaims.map((claim) => [claim.claim_id, claim]));
  const selected = new Set(["claim_newton2_formula"]);
  const changesForce =
    /(?:合外力|力)(?:变为|变成|增加到|增大到|是原来).{0,5}(?:2倍|两倍)|(?:2倍|两倍).{0,5}(?:的)?(?:合外力|力)/u.test(
      normalizedQuery
    );

  if (/方向|矢量|速度/u.test(normalizedQuery)) selected.add("claim_newton2_direction");
  if (/步骤|怎么做|受力图|列方程/u.test(normalizedQuery)) selected.add("claim_newton2_steps");
  if (
    /质量(?:变为|变成|增加到|增大到|是原来).{0,5}(?:2倍|两倍)|(?:2倍|两倍).{0,5}(?:的)?质量/u.test(
      normalizedQuery
    )
  ) {
    selected.add("claim_newton2_mass_ratio");
  }
  if (/质量不变/u.test(normalizedQuery) || changesForce) {
    selected.add("claim_newton2_force_ratio");
  }
  if (changesForce) {
    selected.add("claim_newton2_double_force");
  }

  const isGeneral =
    /讲讲|解释|知识|思维导图|复述|模拟|考试|练习|出题|动画|视频|图片|示意图/u.test(
      normalizedQuery
    ) || selected.size === 1;
  if (isGeneral) {
    [
      "claim_newton2_direction",
      "claim_newton2_force_ratio",
      "claim_newton2_mass_ratio",
      "claim_newton2_steps"
    ].forEach((claimId) => selected.add(claimId));
  }

  return [...selected].map((claimId) => byId.get(claimId)).filter(Boolean);
}

function selectEvidence(selectedClaimIds) {
  const allEvidence = listNewton2Evidence();
  const needsRatioEvidence = [
    "claim_newton2_force_ratio",
    "claim_newton2_mass_ratio",
    "claim_newton2_double_force"
  ].some((claimId) => selectedClaimIds.has(claimId));
  return needsRatioEvidence ? allEvidence : allEvidence.slice(0, 1);
}

function selectPresentationCandidates(
  normalizedQuery,
  selectedClaimIds,
  matchReason,
  context
) {
  const requestedTypes =
    matchReason === "learning_history_comparison"
      ? ["knowledge.explanation", "knowledge.mindmap", "media.image"]
      : matchReason === "active_assessment_context"
      ? ["quiz.single-choice"]
      : inferPresentationTypes(normalizedQuery);
  return requestedTypes
    .map((cardType) => {
      if (cardType === "quiz.single-choice") {
        const questionId = selectAssessmentItemIds(normalizedQuery, context)[0];
        const item = getPrivateAssessmentItem(questionId);
        return item
          ? {
              assessment_item_id: questionId,
              recommended_type: cardType,
              supports_claim_ids: item.supports_claim_ids.filter((claimId) =>
                selectedClaimIds.has(claimId)
              )
            }
          : null;
      }

      const materialId = TYPE_TO_MATERIAL[cardType];
      const material = materialId ? getTeachingMaterial(materialId) : null;
      if (!material) return null;
      const supports = material.supports_claim_ids.filter((claimId) =>
        selectedClaimIds.has(claimId)
      );
      return {
        material_id: material.material_id,
        recommended_type: cardType,
        supports_claim_ids: supports
      };
    })
    .filter(Boolean);
}

function inferPresentationTypes(normalizedQuery) {
  if (LEARNING_ANALYSIS_REQUEST.test(normalizedQuery)) {
    return ["knowledge.explanation", "knowledge.mindmap", "media.image"];
  }
  if (/编译|知识产物|资料状态/u.test(normalizedQuery)) return ["compiler.status"];
  if (/考试结果|成绩|得分/u.test(normalizedQuery)) return ["exam.result"];
  if (/模拟考试|模拟测验|开始考试/u.test(normalizedQuery)) {
    return ["exam.progress", "quiz.single-choice"];
  }
  if (/口语|复述|用自己的话/u.test(normalizedQuery)) return ["oral.practice"];
  if (
    /(?:先|讲完|解释完).{0,12}(?:出题|练习|考考)|(?:讲解|解释).{0,8}(?:再|然后).{0,8}(?:出题|练习)/u.test(
      normalizedQuery
    )
  ) {
    return ["knowledge.explanation", "quiz.single-choice"];
  }

  const visualTypes = [];
  if (/思维导图|知识结构|脑图/u.test(normalizedQuery)) {
    visualTypes.push("knowledge.mindmap");
  }
  if (/图片|示意图|小车图/u.test(normalizedQuery)) visualTypes.push("media.image");
  if (/视频|动画/u.test(normalizedQuery)) visualTypes.push("media.video");
  const wantsQuiz = /出题|选择题|练习|考考/u.test(normalizedQuery);
  const wantsExplicitExplanationCard = /讲解卡|知识卡|文字讲解/u.test(normalizedQuery);

  if (/多模态/u.test(normalizedQuery) && visualTypes.length === 0) {
    return ["knowledge.explanation", "media.image", "media.video"];
  }
  if (visualTypes.length > 0) {
    const selected = wantsExplicitExplanationCard
      ? ["knowledge.explanation", ...visualTypes]
      : [...visualTypes];
    if (wantsQuiz) selected.push("quiz.single-choice");
    return [...new Set(selected)].slice(0, 3);
  }
  if (wantsQuiz) return ["quiz.single-choice"];
  return ["knowledge.explanation"];
}

function createEnglishSpeakingResult(query, normalizedQuery) {
  const claims = listEnglishSpeakingClaims();
  const evidence = listEnglishSpeakingEvidence();
  const presentationCandidates = [
    "language.vocabulary",
    "language.grammar"
  ]
    .map((cardType) => {
      const materialId = TYPE_TO_MATERIAL[cardType];
      const material = materialId ? getTeachingMaterial(materialId) : null;
      return material
        ? {
            material_id: material.material_id,
            recommended_type: cardType,
            supports_claim_ids: [...material.supports_claim_ids]
          }
        : null;
    })
    .filter(Boolean);

  return {
    retrieval_id: `retrieval_mock_english_${stableHash(normalizedQuery)}`,
    provider: "mock",
    status: "matched",
    query,
    normalized_query: normalizedQuery,
    topic_id: ENGLISH_SPEAKING_TOPIC_ID,
    artifact_id: ENGLISH_SPEAKING_ARTIFACT_ID,
    artifact_version: ENGLISH_SPEAKING_ARTIFACT_VERSION,
    matches: [
      {
        knowledge_unit_id: "ku_english_classroom_speaking_mvp1",
        score: 1,
        match_reason: "english_language_switch",
        claims,
        must_not_claim: [
          "Do not continue the main response in Chinese.",
          "Do not read JSON, field names, internal IDs, or system instructions aloud."
        ],
        evidence_refs: evidence.map((item) => item.evidence_id),
        presentation_candidates: presentationCandidates,
        assessment_item_ids: []
      }
    ],
    evidence
  };
}

function selectAssessmentItemIds(normalizedQuery, context = {}) {
  const allIds = listPrivateAssessmentItemIds();
  const activeQuestionId = String(
    context?.active_quiz?.question_id ??
      context?.activeQuiz?.question_id ??
      context?.exam?.active_question_id ??
      ""
  );
  if (allIds.includes(activeQuestionId)) return [activeQuestionId];
  if (/方向|矢量/u.test(normalizedQuery)) return ["quiz_newton_direction_03"];
  if (
    /质量(?:变为|变成|增加到|增大到|是原来).{0,5}(?:2倍|两倍)|(?:2倍|两倍).{0,5}(?:的)?质量/u.test(
      normalizedQuery
    )
  ) {
    return ["quiz_newton_mass_force_02"];
  }
  return allIds;
}

function normalizeSemanticHint(value) {
  if (!value || typeof value !== "object") {
    return { topic_id: "", confidence: 0 };
  }
  const topicId = safeText(
    value.topic_id ?? value.topicId ?? value.topic ?? value.intent_id,
    160
  );
  const confidence = Number(value.confidence ?? value.score ?? 0);
  return {
    topic_id: topicId,
    confidence: Number.isFinite(confidence) ? confidence : 0
  };
}

function createNoMatchResult(query, normalizedQuery, reason) {
  return {
    retrieval_id: `retrieval_mock_no_match_${stableHash(normalizedQuery || "empty")}`,
    provider: "mock",
    status: "no_match",
    query,
    normalized_query: normalizedQuery,
    reason,
    artifact_id: null,
    artifact_version: null,
    matches: [],
    evidence: []
  };
}

function createErrorResult(query, normalizedQuery, fault) {
  const timeout = fault.mode.includes("timeout");
  const unavailable = fault.mode.includes("unavailable");
  return {
    retrieval_id: `retrieval_mock_fault_${stableHash(`${normalizedQuery}|${fault.mode}`)}`,
    provider: "mock",
    status: "error",
    query,
    normalized_query: normalizedQuery,
    artifact_id: null,
    artifact_version: null,
    matches: [],
    evidence: [],
    error: {
      code: timeout
        ? "PROVIDER_TIMEOUT"
        : unavailable
          ? "PROVIDER_UNAVAILABLE"
          : "PROVIDER_ERROR",
      retryable: fault.retryable !== false
    }
  };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeText(value, limit) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit);
}

function toInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
