import {
  CONTRACT_VERSION,
  TEACHING_PACKAGE_VERSION,
  cloneContractValue,
  createId,
  deriveUIProjection,
  deriveVoiceProjection,
  normalizeMvpUserTurn,
  validateTeachingPackage,
  validateUIProjection,
  validateVoiceProjection
} from "./contracts.js";
import {
  getPrivateAssessmentItemById,
  listPrivateAssessmentIds,
  mockKnowledgeProvider
} from "./mock-knowledge-provider.js";
import {
  assembleEducationCards,
  createEducationA2UI
} from "./education-card-assembler.js";

const MAIN_SURFACE_ID = "lesson_surface_main";
const NEWTON2_TOPIC_ID = "physics.newton.second_law";
const MAX_RESPONSE_CACHE = 1000;
const MAX_LOGS_PER_SESSION = 500;
const MAX_CANCEL_MARKERS = 200;
const CONTEXT_TURN_LIMIT = 3;
const CONTEXT_AGE_MS = 10 * 60 * 1000;

const sessionStates = new Map();
const sessionQueues = new Map();
const responseCache = new Map();
const turnLogs = new Map();
const activeRuns = new Map();
const canceledTurns = new Map();

/**
 * This is the only model-visible education tool. Gateway-owned identifiers,
 * UI actions, attachments and state versions are deliberately not accepted
 * from the realtime model.
 */
export const TEACHER_TURN_TOOL = Object.freeze({
  type: "function",
  name: "teacher_turn",
  description:
    "处理一次教学回合。请原样传入用户最终话语；可附带非权威语义提示。工具会统一完成知识召回、教学状态、判题和卡片编排，并返回供你自然口语表达的 VoiceProjection。每个用户回合最多调用一次。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      raw_text: {
        type: "string",
        minLength: 1,
        maxLength: 12000,
        description: "用户本轮最终、未经改写的话语"
      },
      semantic_hint: {
        type: "object",
        additionalProperties: false,
        description: "可选的非权威语义提示；不得用它替代原始话语完成判题",
        properties: {
          intent: { type: "string", maxLength: 120 },
          topic_id: { type: "string", maxLength: 160 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          action: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", maxLength: 120 },
              value: {}
            },
            required: ["type"]
          }
        }
      }
    },
    required: ["raw_text"]
  }
});

/**
 * Runs one authoritative MVP teaching turn.
 *
 * Gateway should populate session_id / turn_id / idempotency_key / source and
 * UI events before calling this function. Calls for the same session are
 * serialized. A repeated idempotency key returns the first committed result.
 */
export async function runTeacherTurn(input = {}, options = {}) {
  const initialTurn = normalizeMvpUserTurn(input, options.authority || {});
  const queueStartedAt = Date.now();

  return enqueueSession(initialTurn.session_id, async () => {
    const cacheKey = responseCacheKey(
      initialTurn.session_id,
      initialTurn.idempotency_key
    );
    const cached = responseCache.get(cacheKey);
    if (cached) {
      appendReplayLog(cached.log, queueStartedAt);
      return clone(cached);
    }

    const state = getOrCreateSessionState(initialTurn.session_id);
    const stateVersionBefore = state.state_version;
    const turnSequence = allocateTurnSequence(
      state,
      options.forceTurnSequence
    );
    const turn = normalizeMvpUserTurn(initialTurn, {
      session_id: initialTurn.session_id,
      turn_id: initialTurn.turn_id,
      turn_sequence: turnSequence,
      idempotency_key: initialTurn.idempotency_key,
      source: initialTurn.source,
      state_version: initialTurn.state_version
    });
    const packageId = createId(`pkg_${turn.turn_id}`);
    const run = {
      sessionId: turn.session_id,
      turnId: turn.turn_id,
      turnSequence,
      packageId,
      canceled: isTurnCanceled(turn.session_id, turn.turn_id)
    };
    activeRuns.set(turn.session_id, run);

    const timings = {
      queue_ms: Math.max(0, Date.now() - queueStartedAt),
      provider_ms: 0,
      card_assembly_ms: 0,
      projection_ms: 0,
      total_ms: 0
    };
    const workStartedAt = Date.now();
    let outcome;

    try {
      outcome = await coordinateTurn(turn, state, timings);
    } catch (error) {
      outcome = internalToolErrorOutcome(error);
    }

    run.canceled =
      run.canceled || isTurnCanceled(turn.session_id, turn.turn_id);
    if (run.canceled) {
      outcome = suppressCanceledPresentation(outcome);
    }

    let result;
    try {
      result = await finalizeTurn({
        turn,
        state,
        stateVersionBefore,
        packageId,
        outcome,
        timings,
        run,
        workStartedAt
      });
    } catch (error) {
      const fallbackOutcome = {
        ...internalToolErrorOutcome(error),
        providerCalls: Number(outcome?.providerCalls || 0)
      };
      result = await finalizeTurn({
        turn,
        state,
        stateVersionBefore,
        packageId,
        outcome: fallbackOutcome,
        timings,
        run,
        workStartedAt,
        skipCardAssembly: true
      });
    } finally {
      if (activeRuns.get(turn.session_id) === run) {
        activeRuns.delete(turn.session_id);
      }
    }

    cacheResponse(cacheKey, result);
    appendTurnLog(result.log);
    return clone(result);
  });
}

export function getSessionSnapshot(sessionId = "session_default") {
  const state = sessionStates.get(safeId(sessionId));
  return state ? publicSessionSnapshot(state) : null;
}

export function getTurnLogs(sessionId, options = {}) {
  if (sessionId && typeof sessionId === "object") {
    options = sessionId;
    sessionId = options.session_id ?? options.sessionId;
  }
  const limit = clampInteger(options.limit, 100, 1, MAX_LOGS_PER_SESSION);
  if (sessionId) {
    const logs = turnLogs.get(safeId(sessionId)) || [];
    return clone(logs.slice(-limit));
  }
  return clone(
    [...turnLogs.values()]
      .flat()
      .sort((left, right) =>
        String(left.logged_at).localeCompare(String(right.logged_at))
      )
      .slice(-limit)
  );
}

export function cancelSessionTurn(
  sessionId,
  turnId = "",
  reason = "user_interruption"
) {
  const normalizedSessionId = safeId(sessionId) || "session_default";
  const active = activeRuns.get(normalizedSessionId);
  const normalizedTurnId = safeId(turnId) || active?.turnId || "";
  if (!normalizedTurnId) {
    return {
      canceled: false,
      session_id: normalizedSessionId,
      turn_id: "",
      turn_sequence: null,
      reason: safeReason(reason)
    };
  }

  const markers = canceledTurns.get(normalizedSessionId) || new Map();
  markers.set(normalizedTurnId, {
    canceled_at: new Date().toISOString(),
    reason: safeReason(reason)
  });
  while (markers.size > MAX_CANCEL_MARKERS) {
    markers.delete(markers.keys().next().value);
  }
  canceledTurns.set(normalizedSessionId, markers);

  if (active && active.turnId === normalizedTurnId) active.canceled = true;
  updateMatchingLogs(
    {
      sessionId: normalizedSessionId,
      turnId: normalizedTurnId
    },
    (log) => {
      log.canceled = true;
      log.cancel_reason = safeReason(reason);
    }
  );
  for (const cached of responseCache.values()) {
    if (
      cached.log?.session_id === normalizedSessionId &&
      cached.log?.turn_id === normalizedTurnId
    ) {
      cached.log.canceled = true;
      cached.log.cancel_reason = safeReason(reason);
    }
  }

  return {
    canceled: true,
    session_id: normalizedSessionId,
    turn_id: normalizedTurnId,
    turn_sequence:
      active?.turnId === normalizedTurnId ? active.turnSequence : null,
    reason: safeReason(reason)
  };
}

export function linkDuplexResponse({
  sessionId,
  session_id,
  turnId,
  turn_id,
  packageId,
  package_id,
  duplexResponseId,
  duplex_response_id
} = {}) {
  const match = {
    sessionId: safeId(sessionId ?? session_id),
    turnId: safeId(turnId ?? turn_id),
    packageId: safeId(packageId ?? package_id)
  };
  const responseId = safeId(duplexResponseId ?? duplex_response_id);
  if (!match.sessionId || !responseId) {
    return { linked: false, duplex_response_id: responseId };
  }

  let linked = false;
  updateMatchingLogs(match, (log) => {
    log.duplex_response_id = responseId;
    linked = true;
  });
  for (const cached of responseCache.values()) {
    if (!logMatches(cached.log, match)) continue;
    cached.log.duplex_response_id = responseId;
    linked = true;
  }

  return {
    linked,
    session_id: match.sessionId,
    turn_id: match.turnId,
    package_id: match.packageId,
    duplex_response_id: responseId
  };
}

export function setProviderFault(mode = null) {
  if (mode == null || mode === false || mode === "none") {
    mockKnowledgeProvider.clearFaultInjection();
    return { enabled: false, mode: null };
  }
  mockKnowledgeProvider.setFaultInjection(mode);
  return {
    enabled: true,
    mode: typeof mode === "string" ? mode : mode.mode || mode.code || "error"
  };
}

export function resetSessionState(sessionId = "") {
  const normalizedSessionId = safeId(sessionId);
  if (!normalizedSessionId) {
    sessionStates.clear();
    responseCache.clear();
    turnLogs.clear();
    activeRuns.clear();
    canceledTurns.clear();
    return { reset: true, scope: "all" };
  }

  sessionStates.delete(normalizedSessionId);
  turnLogs.delete(normalizedSessionId);
  activeRuns.delete(normalizedSessionId);
  canceledTurns.delete(normalizedSessionId);
  for (const key of [...responseCache.keys()]) {
    if (key.startsWith(`${normalizedSessionId}:`)) responseCache.delete(key);
  }
  return { reset: true, scope: "session", session_id: normalizedSessionId };
}

async function coordinateTurn(turn, state, timings) {
  const answerSignal = resolveAnswerSignal(turn);
  if (answerSignal.isAnswerTurn) {
    return coordinateAnswerTurn(turn, state, answerSignal);
  }

  const stateAction = classifyStateAction(turn, state);
  if (stateAction) {
    return coordinateStateAction(turn, state, stateAction);
  }

  const intent = classifyKnowledgeIntent(turn.raw_text);
  const providerStartedAt = Date.now();
  let retrieval;
  try {
    retrieval = await mockKnowledgeProvider.search({
      query: queryForProvider(turn, intent, state),
      semantic_hint: turn.semantic_hint,
      context: createRetrievalContext(state, turn.turn_sequence)
    });
  } catch (error) {
    retrieval = {
      retrieval_id: createId("retrieval_mock_fault"),
      status: "error",
      artifact_id: null,
      artifact_version: null,
      matches: [],
      evidence: [],
      error: {
        code: "PROVIDER_ERROR",
        retryable: true
      }
    };
  }
  timings.provider_ms += Math.max(0, Date.now() - providerStartedAt);

  if (retrieval?.status === "error") {
    return providerToolErrorOutcome(retrieval);
  }
  if (retrieval?.status !== "matched") {
    return modelPriorOutcome(retrieval);
  }

  const requestedCardTypes = inferRequestedCardTypes(turn.raw_text, intent);
  const claims = flattenClaims(retrieval);
  const claimIds = claims.map((claim) => claim.claim_id);
  const now = new Date().toISOString();
  const contextRecord = {
    accepted: true,
    topic_id: retrieval.topic_id || NEWTON2_TOPIC_ID,
    artifact_id: retrieval.artifact_id,
    claim_ids: claimIds,
    turn_sequence: turn.turn_sequence,
    occurred_at: now
  };
  const statePatch = {
    last_claim_ids: claimIds,
    last_match: contextRecord,
    recent_turns: [...state.recent_turns, contextRecord].slice(
      -CONTEXT_TURN_LIMIT
    ),
    context_cleared_at_sequence: null
  };
  const publicStatePatch = {
    active_claim_ids: claimIds
  };
  if (intent === "language_switch") {
    statePatch.preferred_language = "en-US";
    publicStatePatch.preferred_language = "en-US";
  }
  let assessmentItems = [];
  let assessmentState = null;
  let exam = state.exam;
  let oralPractice = state.oral_practice;
  let activeQuiz = state.active_quiz;
  let expectedActions = expectedActionsForTypes(requestedCardTypes);

  if (intent === "quiz" || requestedCardTypes.includes("quiz.single-choice")) {
    const item = selectQuizItem(retrieval, state, turn.raw_text);
    if (!item) return missingAssessmentOutcome(retrieval);
    activeQuiz = createAwaitingQuiz(item, "single");
    assessmentItems = [item];
    assessmentState = publicAssessmentState(activeQuiz);
    statePatch.active_quiz = activeQuiz;
    publicStatePatch.active_quiz = publicActiveQuiz(activeQuiz);
    expectedActions = [
      { type: "answer.select", question_id: item.question_id }
    ];
  }

  if (intent === "exam") {
    const items = listPrivateAssessmentIds()
      .map((questionId) => getPrivateAssessmentItemById(questionId))
      .filter(Boolean)
      .slice(0, 3);
    if (items.length !== 3) return missingAssessmentOutcome(retrieval);
    exam = createExam(items);
    activeQuiz = createAwaitingQuiz(items[0], "exam", exam.exam_id);
    assessmentItems = [items[0]];
    assessmentState = publicAssessmentState(activeQuiz);
    statePatch.exam = exam;
    statePatch.active_quiz = activeQuiz;
    publicStatePatch.exam = publicExam(exam);
    publicStatePatch.active_quiz = publicActiveQuiz(activeQuiz);
    expectedActions = [
      { type: "answer.select", question_id: activeQuiz.question_id }
    ];
  }

  if (intent === "oral") {
    oralPractice = {
      practice_id: "oral_newton2_mvp1",
      topic_id: NEWTON2_TOPIC_ID,
      status: "ready",
      created_at: now,
      started_at: null,
      completed_at: null
    };
    statePatch.oral_practice = oralPractice;
    publicStatePatch.oral_practice = publicOralPractice(oralPractice);
    expectedActions = [
      {
        type: "oral.record.start",
        practice_id: oralPractice.practice_id
      }
    ];
  }

  const answerBrief = buildRetrievedAnswerBrief({
    turn,
    retrieval,
    claims,
    intent,
    requestedCardTypes,
    activeQuiz
  });
  const presentationRetrieval =
    activeQuiz && requestedCardTypes.includes("quiz.single-choice")
      ? alignQuizPresentationCandidate(retrieval, activeQuiz.question_id)
      : retrieval;

  return {
    mode: "retrieved",
    retrieval: presentationRetrieval,
    artifactVersion: retrieval.artifact_version,
    answerBrief,
    authoritativeResult: null,
    clarification: null,
    publicError: null,
    requestedCardTypes,
    assessmentItems,
    assessmentState,
    exam,
    oralPractice,
    expectedActions,
    statePatch,
    publicStatePatch,
    claimIds,
    providerCalls: 1,
    stale: false,
    authoritativeCommit: false,
    forcePreserve:
      intent === "hint" || requestedCardTypes.length === 0,
    forceClearSurface: false
  };
}

function coordinateAnswerTurn(turn, state, answerSignal) {
  const activeQuiz = state.active_quiz;
  if (!activeQuiz) {
    return clarificationOutcome(
      "no_active_question",
      "当前没有待作答的题目。你可以先让我出一道题。"
    );
  }

  if (answerSignal.source === "ui") {
    const uiEvent = answerSignal.uiEvent;
    const observedVersion =
      uiEvent?.observed_state_version ??
      uiEvent?.payload?.observed_state_version ??
      null;
    const observedQuestionId =
      uiEvent?.question_id || uiEvent?.payload?.question_id || "";
    const staleVersion =
      observedVersion !== null &&
      observedVersion !== undefined &&
      observedVersion !== state.state_version;
    const staleQuestion =
      Boolean(observedQuestionId) &&
      observedQuestionId !== activeQuiz.question_id;
    if (staleVersion || staleQuestion) {
      return staleActionOutcome(state, activeQuiz, {
        observedVersion,
        staleQuestionId: observedQuestionId
      });
    }
  }

  if (answerSignal.conflict) {
    return clarificationOutcome(
      "semantic_conflict",
      `我听到你说选 ${answerSignal.rawChoice}，但识别提示是 ${answerSignal.hintChoice}。请再明确说一次选项。`
    );
  }

  if (!answerSignal.choice || answerSignal.hintOnly) {
    return clarificationOutcome(
      "ambiguous_answer",
      "我还不能确定你的选择。请明确说或点击 A、B、C、D 中的一项。"
    );
  }

  if (activeQuiz.status !== "awaiting_answer") {
    return alreadyAnsweredOutcome(activeQuiz);
  }

  const item = getPrivateAssessmentItemById(activeQuiz.question_id);
  if (!item) {
    return {
      ...internalToolErrorOutcome(new Error("ASSESSMENT_NOT_FOUND")),
      publicError: {
        code: "ASSESSMENT_NOT_FOUND",
        retryable: false,
        user_message: "当前题目暂时无法判定，请重新出题。"
      }
    };
  }

  const selectedOption = answerSignal.choice;
  const isCorrect = selectedOption === normalizeChoice(item.correct_answer);
  const answeredAt = new Date().toISOString();
  const answeredQuiz = {
    ...activeQuiz,
    status: "answered",
    selected_option: selectedOption,
    is_correct: isCorrect,
    correct_option: normalizeChoice(item.correct_answer),
    explanation: safeText(item.explanation, 4000),
    answered_at: answeredAt
  };
  const statePatch = { active_quiz: answeredQuiz };
  const publicStatePatch = {
    active_quiz: publicActiveQuiz(answeredQuiz)
  };
  const result = {
    status: "graded",
    question_id: item.question_id,
    selected_option: selectedOption,
    is_correct: isCorrect,
    correct_option: normalizeChoice(item.correct_answer),
    explanation: safeText(item.explanation, 4000)
  };
  let exam = state.exam;
  let requestedCardTypes = [
    "quiz.single-choice",
    "knowledge.mindmap",
    "knowledge.explanation"
  ];
  let expectedActions = [{ type: "quiz.next" }];

  if (
    activeQuiz.mode === "exam" &&
    exam?.status === "in_progress" &&
    exam.question_ids.includes(activeQuiz.question_id)
  ) {
    const existingAnswers = Array.isArray(exam.answers) ? exam.answers : [];
    const nextAnswers = [
      ...existingAnswers,
      {
        question_id: item.question_id,
        selected_option: selectedOption,
        is_correct: isCorrect,
        answered_at: answeredAt
      }
    ];
    const completed = nextAnswers.length >= exam.question_ids.length;
    exam = {
      ...exam,
      answers: nextAnswers,
      answered: nextAnswers.length,
      correct: nextAnswers.filter((entry) => entry.is_correct).length,
      status: completed ? "completed" : "in_progress",
      completed_at: completed ? answeredAt : null
    };
    statePatch.exam = exam;
    publicStatePatch.exam = publicExam(exam);
    requestedCardTypes = completed
      ? ["quiz.single-choice", "exam.result"]
      : ["quiz.single-choice", "exam.progress"];
    expectedActions = completed
      ? [{ type: "exam.retry", exam_id: exam.exam_id }]
      : [{ type: "exam.next", exam_id: exam.exam_id }];
    result.exam = publicExam(exam);
  }

  return {
    mode: "state_authoritative",
    retrieval: null,
    artifactVersion: null,
    answerBrief: null,
    authoritativeResult: result,
    clarification: null,
    publicError: null,
    requestedCardTypes,
    assessmentItems: [item],
    assessmentState: publicAssessmentState(answeredQuiz),
    exam,
    oralPractice: state.oral_practice,
    expectedActions,
    statePatch,
    publicStatePatch,
    claimIds: [],
    stale: false,
    authoritativeCommit: true,
    forcePreserve: false,
    forceClearSurface: false
  };
}

function coordinateStateAction(turn, state, action) {
  if (action.type === "surface.clear") {
    return {
      ...stateAuthoritativeBase({
        status: "surface_cleared",
        message: "当前教学卡片和临时学习活动已清空。"
      }),
      statePatch: {
        last_claim_ids: [],
        last_match: null,
        recent_turns: [],
        active_quiz: null,
        exam: null,
        oral_practice: null,
        context_cleared_at_sequence: turn.turn_sequence
      },
      publicStatePatch: {
        active_claim_ids: [],
        active_quiz: null,
        exam: null,
        oral_practice: null
      },
      forceClearSurface: true
    };
  }

  if (action.type === "quiz.start") {
    const item = getPrivateAssessmentItemById(listPrivateAssessmentIds()[0]);
    if (!item) return internalToolErrorOutcome(new Error("ASSESSMENT_NOT_FOUND"));
    const activeQuiz = createAwaitingQuiz(item, "single");
    return {
      ...stateAuthoritativeBase({
        status: "question_started",
        question_id: item.question_id,
        prompt: item.prompt
      }),
      requestedCardTypes: ["quiz.single-choice"],
      assessmentItems: [item],
      assessmentState: publicAssessmentState(activeQuiz),
      expectedActions: [
        { type: "answer.select", question_id: item.question_id }
      ],
      statePatch: { active_quiz: activeQuiz },
      publicStatePatch: { active_quiz: publicActiveQuiz(activeQuiz) }
    };
  }

  if (action.type === "quiz.next" || action.type === "exam.next") {
    return moveToNextQuestion(state);
  }

  if (action.type === "exam.retry") {
    const items = listPrivateAssessmentIds()
      .map((questionId) => getPrivateAssessmentItemById(questionId))
      .filter(Boolean)
      .slice(0, 3);
    if (items.length !== 3) {
      return internalToolErrorOutcome(new Error("ASSESSMENT_SET_INCOMPLETE"));
    }
    const exam = createExam(items);
    const activeQuiz = createAwaitingQuiz(items[0], "exam", exam.exam_id);
    return {
      ...stateAuthoritativeBase({
        status: "exam_started",
        exam_id: exam.exam_id,
        total: exam.question_ids.length,
        current: 1,
        question_id: activeQuiz.question_id,
        prompt: items[0].prompt
      }),
      requestedCardTypes: ["exam.progress", "quiz.single-choice"],
      assessmentItems: [items[0]],
      assessmentState: publicAssessmentState(activeQuiz),
      exam,
      expectedActions: [
        { type: "answer.select", question_id: activeQuiz.question_id }
      ],
      statePatch: { exam, active_quiz: activeQuiz },
      publicStatePatch: {
        exam: publicExam(exam),
        active_quiz: publicActiveQuiz(activeQuiz)
      }
    };
  }

  if (action.type === "oral.record.start") {
    if (!state.oral_practice) {
      return clarificationOutcome(
        "no_active_oral_practice",
        "当前没有口语练习任务。你可以先让我创建一个复述练习。"
      );
    }
    const oralPractice = {
      ...state.oral_practice,
      status: "recording",
      started_at: new Date().toISOString()
    };
    return {
      ...stateAuthoritativeBase({
        status: "oral_recording_started",
        practice_id: oralPractice.practice_id
      }),
      requestedCardTypes: ["oral.practice"],
      oralPractice,
      expectedActions: [
        {
          type: "oral.record.stop",
          practice_id: oralPractice.practice_id
        }
      ],
      statePatch: { oral_practice: oralPractice },
      publicStatePatch: {
        oral_practice: publicOralPractice(oralPractice)
      }
    };
  }

  if (
    action.type === "oral.record.stop" ||
    action.type === "oral.record.submit"
  ) {
    if (!state.oral_practice) {
      return clarificationOutcome(
        "no_active_oral_practice",
        "当前没有正在进行的口语练习。"
      );
    }
    const oralPractice = {
      ...state.oral_practice,
      status: "completed",
      completed_at: new Date().toISOString()
    };
    return {
      ...stateAuthoritativeBase({
        status: "oral_practice_completed",
        practice_id: oralPractice.practice_id,
        feedback:
          "复述已提交。可以继续围绕公式、合外力和比例关系检查表达是否完整。"
      }),
      requestedCardTypes: ["oral.practice"],
      oralPractice,
      expectedActions: [],
      statePatch: { oral_practice: oralPractice },
      publicStatePatch: {
        oral_practice: publicOralPractice(oralPractice)
      }
    };
  }

  return clarificationOutcome(
    "unsupported_state_action",
    "我还不能确定你要进行哪项学习操作，请再说明一次。"
  );
}

function moveToNextQuestion(state) {
  const activeQuiz = state.active_quiz;
  if (!activeQuiz) {
    return clarificationOutcome(
      "no_active_question",
      "当前没有可以继续的题目。"
    );
  }
  if (activeQuiz.status === "awaiting_answer") {
    const item = getPrivateAssessmentItemById(activeQuiz.question_id);
    return {
      ...stateAuthoritativeBase({
        status: "awaiting_answer",
        question_id: activeQuiz.question_id,
        message: "请先完成当前题，再进入下一题。"
      }),
      requestedCardTypes: item ? ["quiz.single-choice"] : [],
      assessmentItems: item ? [item] : [],
      assessmentState: publicAssessmentState(activeQuiz),
      expectedActions: [
        { type: "answer.select", question_id: activeQuiz.question_id }
      ],
      statePatch: {},
      publicStatePatch: {}
    };
  }

  if (activeQuiz.mode === "exam" && state.exam) {
    if (state.exam.status === "completed") {
      return {
        ...stateAuthoritativeBase({
          status: "exam_completed",
          exam: publicExam(state.exam)
        }),
        requestedCardTypes: ["exam.result"],
        exam: state.exam,
        expectedActions: [
          { type: "exam.retry", exam_id: state.exam.exam_id }
        ]
      };
    }
    const nextIndex = state.exam.current_index + 1;
    const questionId = state.exam.question_ids[nextIndex];
    const item = getPrivateAssessmentItemById(questionId);
    if (!item) return internalToolErrorOutcome(new Error("ASSESSMENT_NOT_FOUND"));
    const exam = {
      ...state.exam,
      current_index: nextIndex
    };
    const nextQuiz = createAwaitingQuiz(item, "exam", exam.exam_id);
    return {
      ...stateAuthoritativeBase({
        status: "next_question",
        exam_id: exam.exam_id,
        question_id: item.question_id,
        current: nextIndex + 1,
        total: exam.question_ids.length,
        prompt: item.prompt
      }),
      requestedCardTypes: ["exam.progress", "quiz.single-choice"],
      assessmentItems: [item],
      assessmentState: publicAssessmentState(nextQuiz),
      exam,
      expectedActions: [
        { type: "answer.select", question_id: item.question_id }
      ],
      statePatch: { exam, active_quiz: nextQuiz },
      publicStatePatch: {
        exam: publicExam(exam),
        active_quiz: publicActiveQuiz(nextQuiz)
      }
    };
  }

  const ids = listPrivateAssessmentIds();
  const currentIndex = Math.max(0, ids.indexOf(activeQuiz.question_id));
  const nextId = ids[(currentIndex + 1) % ids.length];
  const item = getPrivateAssessmentItemById(nextId);
  if (!item) return internalToolErrorOutcome(new Error("ASSESSMENT_NOT_FOUND"));
  const nextQuiz = createAwaitingQuiz(item, "single");
  return {
    ...stateAuthoritativeBase({
      status: "next_question",
      question_id: item.question_id,
      prompt: item.prompt
    }),
    requestedCardTypes: ["quiz.single-choice"],
    assessmentItems: [item],
    assessmentState: publicAssessmentState(nextQuiz),
    expectedActions: [
      { type: "answer.select", question_id: item.question_id }
    ],
    statePatch: { active_quiz: nextQuiz },
    publicStatePatch: { active_quiz: publicActiveQuiz(nextQuiz) }
  };
}

async function finalizeTurn({
  turn,
  state,
  stateVersionBefore,
  packageId,
  outcome,
  timings,
  run,
  workStartedAt,
  skipCardAssembly = false
}) {
  const hasStatePatch = hasKeys(outcome.statePatch);
  const stateVersionAfter = hasStatePatch
    ? stateVersionBefore + 1
    : stateVersionBefore;
  const previewState = previewPatchedState(
    state,
    outcome.statePatch,
    stateVersionAfter
  );
  let assembly = {
    cards: [],
    card_claim_bindings: [],
    errors: [],
    selected_card_types: []
  };

  if (
    !skipCardAssembly &&
    !outcome.forcePreserve &&
    Array.isArray(outcome.requestedCardTypes) &&
    outcome.requestedCardTypes.length
  ) {
    const assemblyStartedAt = Date.now();
    try {
      assembly = await assembleEducationCards({
        retrieval: outcome.retrieval,
        requestedCardTypes: outcome.requestedCardTypes,
        assessmentItems: outcome.assessmentItems || [],
        assessmentState: outcome.assessmentState || null,
        exam: publicExam(outcome.exam || previewState.exam),
        oralPractice: outcome.oralPractice || previewState.oral_practice,
        turnId: turn.turn_id,
        artifactId: outcome.retrieval?.artifact_id || null,
        requestText: turn.raw_text,
        answerBrief: outcome.answerBrief,
        stateVersion: stateVersionAfter
      });
    } catch (error) {
      assembly = {
        cards: [],
        card_claim_bindings: [],
        errors: [
          {
            code: "CARD_ASSEMBLY_FAILED",
            message: safeErrorMessage(error)
          }
        ],
        selected_card_types: []
      };
    }
    timings.card_assembly_ms += Math.max(
      0,
      Date.now() - assemblyStartedAt
    );
  }

  const maxCards = maximumCardsForOutcome(outcome);
  const cards = Array.isArray(assembly.cards)
    ? assembly.cards.slice(0, maxCards)
    : [];
  const cardIds = new Set(cards.map((card) => card.id));
  const cardClaimBindings = (
    Array.isArray(assembly.card_claim_bindings)
      ? assembly.card_claim_bindings
      : []
  ).filter((binding) => cardIds.has(binding.card_id));
  const replaceSurface =
    outcome.forceClearSurface || (!outcome.forcePreserve && cards.length > 0);
  const surfacePolicy = replaceSurface ? "replace" : "preserve";
  const evidence =
    outcome.mode === "retrieved"
      ? sanitizeEvidence(outcome.retrieval?.evidence)
      : [];
  const packageCandidate = createTeachingPackage({
    packageId,
    turn,
    stateVersion: stateVersionAfter,
    outcome,
    cards,
    cardClaimBindings,
    evidence,
    surfacePolicy
  });

  if (!validateTeachingPackage(packageCandidate)) {
    throw new TypeError("TeachingPackage violates the MVP 1.0 contract");
  }

  const projectionStartedAt = Date.now();
  const projectionTurn = {
    ...turn,
    raw_text: projectionUserText(turn)
  };
  const voiceProjection = deriveVoiceProjection(
    packageCandidate,
    projectionTurn
  );
  const uiProjection = deriveUIProjection(packageCandidate);
  if (
    !validateVoiceProjection(voiceProjection) ||
    !validateUIProjection(uiProjection)
  ) {
    throw new TypeError("Derived projection violates the MVP 1.0 contract");
  }
  let a2ui;
  try {
    a2ui =
      surfacePolicy === "preserve"
        ? {
            surfaceId: MAIN_SURFACE_ID,
            surface_id: MAIN_SURFACE_ID,
            operation: "preserve",
            cards: [],
            messages: []
          }
        : createEducationA2UI({
            surfaceId: MAIN_SURFACE_ID,
            cards,
            operation: surfacePolicy,
            stateVersion: stateVersionAfter,
            turnSequence: turn.turn_sequence,
            packageId
          });
  } catch (error) {
    a2ui = {
      surface_id: MAIN_SURFACE_ID,
      operation: "preserve",
      cards: [],
      messages: [],
      errors: [
        {
          code: "A2UI_MAPPING_FAILED",
          message: safeErrorMessage(error)
        }
      ]
    };
  }
  if (hasStatePatch) {
    applyStatePatch(state, outcome.statePatch);
    state.state_version = stateVersionAfter;
  }
  state.last_package_id = packageId;
  state.last_surface_id = MAIN_SURFACE_ID;
  state.updated_at = new Date().toISOString();
  if (
    outcome.mode === "model_prior" &&
    explicitlySwitchesTopic(turn.raw_text)
  ) {
    state.context_cleared_at_sequence = turn.turn_sequence;
  }
  timings.projection_ms += Math.max(
    0,
    Date.now() - projectionStartedAt
  );
  timings.total_ms = Math.max(0, Date.now() - workStartedAt);

  const log = {
    logged_at: new Date().toISOString(),
    session_id: turn.session_id,
    turn_id: turn.turn_id,
    turn_sequence: turn.turn_sequence,
    idempotency_key: turn.idempotency_key,
    package_id: packageId,
    input_source: turn.source,
    input_text_length: turn.raw_text.length,
    retrieval_id: packageCandidate.grounding.retrieval_id,
    retrieval_status: outcome.retrieval?.status || null,
    provider_calls: Number(outcome.providerCalls || 0),
    grounding_mode: packageCandidate.grounding.mode,
    artifact_version: packageCandidate.artifact_version,
    claim_ids: clone(outcome.claimIds || []),
    state_version_before: stateVersionBefore,
    state_version_after: stateVersionAfter,
    duplex_response_id: "",
    surface_id: MAIN_SURFACE_ID,
    card_ids: cards.map((card) => card.id),
    canceled: Boolean(run.canceled),
    cancel_reason:
      canceledTurns.get(turn.session_id)?.get(turn.turn_id)?.reason || "",
    stale: Boolean(outcome.stale),
    duplicate: false,
    card_errors: sanitizeAssemblyErrors(assembly.errors),
    timings: { ...timings }
  };

  return {
    teachingPackage: packageCandidate,
    voiceProjection,
    uiProjection,
    a2ui,
    log
  };
}

function createTeachingPackage({
  packageId,
  turn,
  stateVersion,
  outcome,
  cards,
  cardClaimBindings,
  evidence,
  surfacePolicy
}) {
  return {
    package_version: TEACHING_PACKAGE_VERSION,
    package_id: packageId,
    session_id: turn.session_id,
    turn_id: turn.turn_id,
    turn_sequence: turn.turn_sequence,
    idempotency_key: turn.idempotency_key,
    artifact_version:
      outcome.mode === "retrieved" ? outcome.artifactVersion : null,
    grounding: {
      mode: outcome.mode,
      retrieval_id:
        outcome.mode === "retrieved" ||
        outcome.mode === "model_prior" ||
        outcome.mode === "tool_error"
          ? safeId(outcome.retrieval?.retrieval_id) ||
            createId(`retrieval_${outcome.mode}`)
          : null
    },
    answer_brief:
      outcome.mode === "retrieved" ? clone(outcome.answerBrief) : null,
    authoritative_result:
      outcome.mode === "state_authoritative"
        ? clone(outcome.authoritativeResult)
        : null,
    clarification:
      outcome.mode === "clarify" ? clone(outcome.clarification) : null,
    public_error:
      outcome.mode === "tool_error" ? clone(outcome.publicError) : null,
    cards,
    card_claim_bindings: cardClaimBindings,
    evidence,
    expected_actions: clone(outcome.expectedActions || []),
    public_state_patch: hasKeys(outcome.statePatch)
      ? clone(outcome.publicStatePatch || {})
      : {},
    state_version: stateVersion,
    presentation: {
      surface_policy: surfacePolicy,
      max_cards: surfacePolicy === "replace" ? cards.length : 0
    }
  };
}

function buildRetrievedAnswerBrief({
  turn,
  retrieval,
  claims,
  intent,
  requestedCardTypes,
  activeQuiz
}) {
  const normalized = normalizeText(turn.raw_text);
  const mustNotClaim = [
    ...new Set(
      (retrieval.matches || [])
        .flatMap((match) =>
          Array.isArray(match.must_not_claim) ? match.must_not_claim : []
        )
        .map((item) => safeText(item, 12000))
        .filter(Boolean)
    )
  ];
  let directAnswer =
    "牛顿第二定律写作 F=ma，其中 F 是合外力；物体的加速度由合外力和质量共同决定。";
  let selectedClaims = claims.slice(0, 5);
  let exactValues = [];
  let supportingFacts = [];
  let targetDurationSeconds = 25;
  let nextMove = "可以询问学生是否想结合一道题继续练习。";

  if (intent === "learning_analysis") {
    directAnswer =
      "在当前 Mock 学情记录中，牛顿第二定律是期中和期末考试错题最多的知识点：期中错了 2 题，期末错了 3 题，两次合计错了 5 题。";
    selectedClaims = claims.filter((claim) =>
      [
        "claim_performance_newton2_most_wrong",
        "claim_newton2_formula",
        "claim_newton2_steps"
      ].includes(claim.claim_id)
    );
    if (!selectedClaims.length) selectedClaims = claims.slice(0, 3);
    exactValues = [
      {
        name: "midterm_wrong_count",
        value: 2,
        spoken_text: "期中错了 2 题"
      },
      {
        name: "final_wrong_count",
        value: 3,
        spoken_text: "期末错了 3 题"
      },
      {
        name: "total_wrong_count",
        value: 5,
        spoken_text: "两次考试合计错了 5 题"
      }
    ];
    mustNotClaim.push("不要把当前 Mock 学情记录描述成学生的真实正式成绩");
    targetDurationSeconds = 24;
    nextMove = "邀请学生针对牛顿第二定律完成一道选择题。";
  } else if (intent === "language_switch") {
    directAnswer =
      "Of course! I can speak English with you. A natural correction is: “Can you speak in English?” The word is spelled s-p-e-a-k: speak.";
    selectedClaims = claims.filter((claim) =>
      [
        "claim_english_speak_spelling",
        "claim_english_can_you_pattern",
        "claim_english_language_phrase"
      ].includes(claim.claim_id)
    );
    if (!selectedClaims.length) selectedClaims = claims.slice(0, 3);
    mustNotClaim.push(
      "Do not continue the main response in Chinese.",
      "Do not say that “Can you speak in English?” is ungrammatical."
    );
    targetDurationSeconds = 22;
    nextMove =
      "Continue naturally in English and invite the learner to ask the next question.";
  } else if (intent === "hint" && activeQuiz) {
    const item = getPrivateAssessmentItemById(activeQuiz.question_id);
    directAnswer =
      safeText(item?.hint, 2000) ||
      "先从 F=ma 出发，明确题目中保持不变的物理量。";
    selectedClaims = claims.filter(
      (claim) => claim.claim_id === "claim_newton2_formula"
    );
    mustNotClaim.push("不要直接说出当前题的正确选项");
    targetDurationSeconds = 12;
    nextMove = "请学生依据提示自行选择答案。";
  } else if (
    requestedCardTypes.includes("knowledge.explanation") &&
    requestedCardTypes.includes("quiz.single-choice")
  ) {
    directAnswer = activeQuiz
      ? `牛顿第二定律写作 F=ma，其中 F 是合外力。理解这个关系后，请完成题目：${activeQuiz.prompt}`
      : "牛顿第二定律写作 F=ma，其中 F 是合外力。接下来请完成题卡。";
    selectedClaims = claims.filter((claim) =>
      [
        "claim_newton2_formula",
        "claim_newton2_force_ratio"
      ].includes(claim.claim_id)
    );
    if (!selectedClaims.length && claims[0]) selectedClaims = [claims[0]];
    exactValues = [];
    mustNotClaim.push("不要在学生作答前说出正确选项或解析");
    targetDurationSeconds = 25;
    nextMove = "等待学生用语音或点击选择一个选项。";
  } else if (intent === "exam") {
    directAnswer = activeQuiz
      ? `三题模拟测验现在开始。第一题：${activeQuiz.prompt}`
      : "三题模拟测验现在开始，请完成当前题。";
    selectedClaims = [
      claims.find((claim) => claim.claim_id === "claim_newton2_formula") ||
        claims[0]
    ].filter(Boolean);
    exactValues = [];
    mustNotClaim.push("不要在学生作答前说出任何题目的正确选项或解析");
    targetDurationSeconds = 15;
    nextMove = "等待学生完成当前题。";
  } else if (
    intent === "quiz" ||
    requestedCardTypes.includes("quiz.single-choice")
  ) {
    directAnswer = activeQuiz
      ? `请完成这道选择题：${activeQuiz.prompt}`
      : "请查看当前选择题并作答。";
    const includesVisualMaterial = requestedCardTypes.some((cardType) =>
      ["media.image", "media.video"].includes(cardType)
    );
    selectedClaims = includesVisualMaterial
      ? claims.filter((claim) =>
          [
            "claim_newton2_formula",
            "claim_newton2_direction",
            "claim_newton2_force_ratio"
          ].includes(claim.claim_id)
        )
      : [
          claims.find(
            (claim) => claim.claim_id === "claim_newton2_formula"
          ) || claims[0]
        ].filter(Boolean);
    if (!selectedClaims.length && claims[0]) selectedClaims = [claims[0]];
    exactValues = [];
    mustNotClaim.push("不要在学生作答前说出正确选项或解析");
    targetDurationSeconds = 12;
    nextMove = "等待学生用语音或点击选择一个选项。";
  } else if (intent === "oral") {
    directAnswer =
      "请用自己的话说明 F=ma，并解释合外力、质量和加速度之间的关系。";
    targetDurationSeconds = 15;
    nextMove = "邀请学生开始 30 秒复述。";
  } else if (intent === "compiler") {
    directAnswer =
      "牛顿第二定律演示资料已完成 Mock 编译，可以用于讲解、出题和卡片展示。";
    targetDurationSeconds = 12;
    nextMove = "可以询问学生想查看哪种教学卡片。";
  } else if (
    /质量不变/u.test(normalized) &&
    /(?:合外力|力).{0,10}(?:2倍|两倍)|(?:2倍|两倍).{0,10}(?:合外力|力)/u.test(
      normalized
    )
  ) {
    directAnswer = "质量不变时，合外力变为 2 倍，加速度也变为 2 倍。";
    selectedClaims = claims.filter((claim) =>
      [
        "claim_newton2_force_ratio",
        "claim_newton2_double_force"
      ].includes(claim.claim_id)
    );
    exactValues = [
      {
        name: "force_multiplier",
        value: 2,
        spoken_text: "合外力变为 2 倍"
      },
      {
        name: "acceleration_multiplier",
        value: 2,
        spoken_text: "加速度变为 2 倍"
      }
    ];
    targetDurationSeconds = 20;
  } else if (
    /质量.{0,10}(?:2倍|两倍)|(?:2倍|两倍).{0,10}质量/u.test(normalized) &&
    /合外力不变|力不变/u.test(normalized)
  ) {
    directAnswer =
      "合外力不变时，质量变为 2 倍，加速度变为原来的 1/2。";
    selectedClaims = claims.filter(
      (claim) => claim.claim_id === "claim_newton2_mass_ratio"
    );
    exactValues = [
      {
        name: "mass_multiplier",
        value: 2,
        spoken_text: "质量变为 2 倍"
      },
      {
        name: "acceleration_multiplier",
        value: 0.5,
        spoken_text: "加速度变为原来的二分之一"
      }
    ];
    targetDurationSeconds = 20;
  } else if (/任意一个力|某一个力.*ma/u.test(normalized)) {
    directAnswer =
      "不是任意一个力都等于 ma；F=ma 中的 F 必须是物体所受的合外力。";
    selectedClaims = claims.filter(
      (claim) => claim.claim_id === "claim_newton2_formula"
    );
    targetDurationSeconds = 18;
  } else if (/方向|矢量/u.test(normalized)) {
    directAnswer = "加速度方向与物体所受合外力方向一致。";
    selectedClaims = claims.filter((claim) =>
      ["claim_newton2_formula", "claim_newton2_direction"].includes(
        claim.claim_id
      )
    );
    targetDurationSeconds = 18;
  } else if (requestedCardTypes.includes("knowledge.mindmap")) {
    directAnswer =
      "已按公式、物理量关系和解题步骤整理牛顿第二定律知识结构。";
  } else if (requestedCardTypes.includes("media.image")) {
    directAnswer =
      "可以结合小车示意图观察：加速度方向与合外力一致，质量不变时合外力越大，加速度越大。";
  } else if (requestedCardTypes.includes("media.video")) {
    directAnswer =
      "可以通过 Mock 动画观察相同质量的小车在不同合外力下的加速度变化。";
  }

  if (/小车|类比|直观/u.test(normalized)) {
    supportingFacts = [
      "可把同一辆小车在不同推力下的运动作为直观类比。"
    ];
  }

  return {
    direct_answer: directAnswer,
    must_include: selectedClaims.map((claim) => ({
      claim_id: claim.claim_id,
      text: claim.text,
      delivery:
        claim.claim_id === "claim_newton2_formula" ? "verbatim" : "semantic"
    })),
    exact_values: exactValues,
    supporting_facts: supportingFacts,
    must_not_claim: [...new Set(mustNotClaim)].filter(Boolean),
    target_duration_seconds: targetDurationSeconds,
    next_move: nextMove
  };
}

function inferRequestedCardTypes(rawText, intent) {
  if (intent === "hint") return [];
  if (intent === "exam") return ["exam.progress", "quiz.single-choice"];
  if (intent === "oral") return ["oral.practice"];
  if (intent === "compiler") return ["compiler.status"];
  if (intent === "learning_analysis") {
    return ["knowledge.explanation", "knowledge.mindmap"];
  }
  if (intent === "language_switch") {
    return ["language.vocabulary", "language.grammar"];
  }

  const text = normalizeText(rawText);
  const explainThenQuiz =
    /(?:先|讲完|解释完).{0,18}(?:讲|解释|牛顿|定律).{0,18}(?:再|然后).{0,12}(?:出题|考我|选择题)|先.{0,20}(?:讲|解释).{0,20}(?:出题|考我)/u.test(
      text
    );
  if (explainThenQuiz) {
    return ["knowledge.explanation", "quiz.single-choice"];
  }

  const explicit = [];
  if (/思维导图|知识结构|脑图/u.test(text)) {
    explicit.push("knowledge.mindmap");
  }
  if (/图片|示意图|小车图|图像/u.test(text)) {
    explicit.push("media.image");
  }
  if (/视频|动画/u.test(text)) explicit.push("media.video");
  if (/出题|选择题|练习题|考考我|做题/u.test(text)) {
    explicit.push("quiz.single-choice");
  }
  if (
    /讲解卡|知识卡/u.test(text) ||
    ((/讲讲|解释|怎么理解/u.test(text) || intent === "explain") &&
      explicit.length === 0)
  ) {
    explicit.unshift("knowledge.explanation");
  }
  if (!explicit.length) return ["knowledge.explanation"];
  return [...new Set(explicit)].slice(0, 3);
}

function classifyKnowledgeIntent(rawText) {
  const text = normalizeText(rawText);
  if (
    /(?:期中|期中考试).{0,24}(?:期末|期末考试)|(?:期末|期末考试).{0,24}(?:期中|期中考试)/u.test(
      text
    ) &&
    /错|错题|失分|薄弱|掌握|知识点/u.test(text)
  ) {
    return "learning_analysis";
  }
  if (
    /\b(?:can|could|would)\s+you\s+sp(?:ea|ee)k(?:\s+(?:to|with)\s+me)?\s+in\s+english\b/iu.test(
      text
    ) ||
    /(?:用|说|切换到?)英语(?:回答|交流|对话|讲解)?|英语(?:回答|交流|对话|讲解)/u.test(
      text
    )
  ) {
    return "language_switch";
  }
  if (
    /给点提示|提示一下|不要告诉答案.*提示|怎么想/u.test(text)
  ) {
    return "hint";
  }
  if (/模拟考试|模拟测验|开始考试|考试模式/u.test(text)) return "exam";
  if (/口语|复述|用自己的话|陪练|朗读/u.test(text)) return "oral";
  if (/编译|知识产物|资料状态/u.test(text)) return "compiler";
  if (/出题|选择题|练习题|考考我|做题/u.test(text)) return "quiz";
  return "explain";
}

function classifyStateAction(turn, state) {
  const event = firstSemanticUIEvent(turn.ui_events);
  if (event) {
    if (["learning.clear", "session.reset"].includes(event.type)) {
      return { type: "surface.clear", event };
    }
    if (event.type === "learning.continue" && state.active_quiz) {
      return {
        type: state.active_quiz.mode === "exam" ? "exam.next" : "quiz.next",
        event
      };
    }
    if (
      [
        "surface.clear",
        "quiz.start",
        "quiz.next",
        "exam.next",
        "exam.retry",
        "oral.record.start",
        "oral.record.stop",
        "oral.record.submit"
      ].includes(event.type)
    ) {
      return { type: event.type, event };
    }
  }

  const text = normalizeText(turn.raw_text);
  if (/清空(?:页面|卡片|学习内容)|重新开始学习|结束本次学习/u.test(text)) {
    return { type: "surface.clear" };
  }
  if (/^(?:下一题|继续下一题|下一道)$/u.test(text) && state.active_quiz) {
    return {
      type: state.active_quiz.mode === "exam" ? "exam.next" : "quiz.next"
    };
  }
  if (/^(?:再测一次|重新考试|重做测验)$/u.test(text) && state.exam) {
    return { type: "exam.retry" };
  }
  if (/^(?:开始录音|开始复述)$/u.test(text) && state.oral_practice) {
    return { type: "oral.record.start" };
  }
  if (/^(?:结束录音|提交复述|我说完了)$/u.test(text) && state.oral_practice) {
    return { type: "oral.record.submit" };
  }
  return null;
}

function resolveAnswerSignal(turn) {
  const uiEvent = (turn.ui_events || []).find((event) =>
    ["answer.select", "quiz.answer", "exam.answer"].includes(event.type)
  );
  if (uiEvent) {
    return {
      isAnswerTurn: true,
      source: "ui",
      uiEvent,
      choice: normalizeChoice(
        uiEvent.value ??
          uiEvent.payload?.value ??
          uiEvent.payload?.selected ??
          uiEvent.payload?.answer
      ),
      rawChoice: "",
      hintChoice: "",
      conflict: false,
      hintOnly: false
    };
  }

  const raw = extractRawChoice(turn.raw_text);
  const hintAction = turn.semantic_hint?.action;
  const hintLooksLikeAnswer =
    hintAction &&
    ["answer.select", "quiz.answer", "exam.answer"].includes(
      hintAction.type
    );
  const hintChoice = hintLooksLikeAnswer
    ? normalizeChoice(hintAction.value)
    : "";
  const isAnswerTurn = raw.attempted || Boolean(hintLooksLikeAnswer);
  const conflict =
    Boolean(raw.choice) &&
    Boolean(hintChoice) &&
    raw.choice !== hintChoice;
  return {
    isAnswerTurn,
    source: "voice",
    uiEvent: null,
    choice: raw.choice,
    rawChoice: raw.choice,
    hintChoice,
    conflict,
    hintOnly: !raw.choice && Boolean(hintChoice)
  };
}

function extractRawChoice(rawText) {
  const text = normalizeText(rawText);
  if (!text) return { attempted: false, choice: "" };

  const letter = text.match(
    /^(?:我)?(?:选|选择|答案(?:是|选)?|我的答案是|就选)\s*([a-d])(?:选项)?[。.!！?？]?$/iu
  );
  if (letter) return { attempted: true, choice: letter[1].toUpperCase() };
  if (/^[a-d][。.!！?？]?$/iu.test(text)) {
    return { attempted: true, choice: text[0].toUpperCase() };
  }

  const ordinalMap = [
    [/^(?:我)?(?:选|选择|答案(?:是|选)?|就选)?\s*(?:第一个|第一项|选项一|选项1|第1项)[。.!！?？]?$/u, "A"],
    [/^(?:我)?(?:选|选择|答案(?:是|选)?|就选)?\s*(?:第二个|第二项|选项二|选项2|第2项)[。.!！?？]?$/u, "B"],
    [/^(?:我)?(?:选|选择|答案(?:是|选)?|就选)?\s*(?:第三个|第三项|选项三|选项3|第3项)[。.!！?？]?$/u, "C"],
    [/^(?:我)?(?:选|选择|答案(?:是|选)?|就选)?\s*(?:第四个|第四项|选项四|选项4|第4项)[。.!！?？]?$/u, "D"]
  ];
  for (const [pattern, choice] of ordinalMap) {
    if (pattern.test(text)) return { attempted: true, choice };
  }

  const attempted =
    /^(?:我选|选|选择|答案|就选|第[一二三四1234](?:个|项)|选项)/u.test(
      text
    ) ||
    /^(?:就这个|选它|就选它|这个吧)$/u.test(text);
  return { attempted, choice: "" };
}

function staleActionOutcome(state, activeQuiz, staleInput) {
  const item = getPrivateAssessmentItemById(activeQuiz.question_id);
  return {
    ...stateAuthoritativeBase({
      status: "stale_action",
      question_id: activeQuiz.question_id,
      current_state_version: state.state_version,
      observed_state_version: staleInput.observedVersion ?? null,
      stale_question_id: staleInput.staleQuestionId || "",
      message: "这个操作来自旧题卡，已恢复当前题目，请在当前题卡上作答。"
    }),
    requestedCardTypes: item ? ["quiz.single-choice"] : [],
    assessmentItems: item ? [item] : [],
    assessmentState: publicAssessmentState(activeQuiz),
    exam: state.exam,
    expectedActions:
      activeQuiz.status === "awaiting_answer"
        ? [{ type: "answer.select", question_id: activeQuiz.question_id }]
        : [],
    stale: true
  };
}

function alreadyAnsweredOutcome(activeQuiz) {
  return {
    ...stateAuthoritativeBase({
      status: "already_answered",
      question_id: activeQuiz.question_id,
      selected_option: activeQuiz.selected_option,
      is_correct: Boolean(activeQuiz.is_correct),
      correct_option: activeQuiz.correct_option,
      explanation: activeQuiz.explanation || ""
    }),
    forcePreserve: true,
    requestedCardTypes: [],
    expectedActions: []
  };
}

function stateAuthoritativeBase(authoritativeResult) {
  return {
    mode: "state_authoritative",
    retrieval: null,
    artifactVersion: null,
    answerBrief: null,
    authoritativeResult,
    clarification: null,
    publicError: null,
    requestedCardTypes: [],
    assessmentItems: [],
    assessmentState: null,
    exam: null,
    oralPractice: null,
    expectedActions: [],
    statePatch: {},
    publicStatePatch: {},
    claimIds: [],
    providerCalls: 0,
    stale: false,
    authoritativeCommit: true,
    forcePreserve: false,
    forceClearSurface: false
  };
}

function clarificationOutcome(reason, prompt) {
  return {
    mode: "clarify",
    retrieval: null,
    artifactVersion: null,
    answerBrief: null,
    authoritativeResult: null,
    clarification: {
      reason: safeId(reason) || "ambiguous_request",
      prompt: safeText(prompt, 2000)
    },
    publicError: null,
    requestedCardTypes: [],
    assessmentItems: [],
    assessmentState: null,
    exam: null,
    oralPractice: null,
    expectedActions: [],
    statePatch: {},
    publicStatePatch: {},
    claimIds: [],
    providerCalls: 0,
    stale: false,
    authoritativeCommit: false,
    forcePreserve: true,
    forceClearSurface: false
  };
}

function modelPriorOutcome(retrieval) {
  return {
    mode: "model_prior",
    retrieval: {
      retrieval_id:
        safeId(retrieval?.retrieval_id) || createId("retrieval_mock_no_match"),
      status: "no_match"
    },
    artifactVersion: null,
    answerBrief: null,
    authoritativeResult: null,
    clarification: null,
    publicError: null,
    requestedCardTypes: [],
    assessmentItems: [],
    assessmentState: null,
    exam: null,
    oralPractice: null,
    expectedActions: [],
    statePatch: {},
    publicStatePatch: {},
    claimIds: [],
    providerCalls: 1,
    stale: false,
    authoritativeCommit: false,
    forcePreserve: true,
    forceClearSurface: false
  };
}

function providerToolErrorOutcome(retrieval) {
  const providerCode = safeId(retrieval?.error?.code) || "PROVIDER_ERROR";
  return {
    mode: "tool_error",
    retrieval: {
      retrieval_id:
        safeId(retrieval?.retrieval_id) || createId("retrieval_mock_fault"),
      status: "error"
    },
    artifactVersion: null,
    answerBrief: null,
    authoritativeResult: null,
    clarification: null,
    publicError: {
      code: "KNOWLEDGE_PROVIDER_UNAVAILABLE",
      retryable: retrieval?.error?.retryable !== false,
      user_message:
        providerCode === "PROVIDER_TIMEOUT"
          ? "知识服务响应超时，请稍后重试。"
          : "知识服务暂时不可用，请稍后重试。"
    },
    requestedCardTypes: [],
    assessmentItems: [],
    assessmentState: null,
    exam: null,
    oralPractice: null,
    expectedActions: [{ type: "turn.retry" }],
    statePatch: {},
    publicStatePatch: {},
    claimIds: [],
    providerCalls: 1,
    stale: false,
    authoritativeCommit: false,
    forcePreserve: true,
    forceClearSurface: false
  };
}

function internalToolErrorOutcome(error) {
  return {
    ...providerToolErrorOutcome({
      retrieval_id: createId("retrieval_internal_error"),
      error: { code: "TEACHER_RUNTIME_ERROR", retryable: true }
    }),
    publicError: {
      code: "TEACHER_RUNTIME_ERROR",
      retryable: true,
      user_message: "教学服务暂时无法完成这次操作，请稍后重试。"
    },
    providerCalls: 0,
    internalErrorCode: safeErrorCode(error)
  };
}

function missingAssessmentOutcome(retrieval) {
  return {
    ...providerToolErrorOutcome({
      retrieval_id:
        retrieval?.retrieval_id || createId("retrieval_assessment_error"),
      error: { code: "ASSESSMENT_UNAVAILABLE", retryable: true }
    }),
    publicError: {
      code: "ASSESSMENT_UNAVAILABLE",
      retryable: true,
      user_message: "练习题暂时不可用，请稍后重试。"
    },
    providerCalls: 1
  };
}

function suppressCanceledPresentation(outcome) {
  return {
    ...outcome,
    requestedCardTypes: [],
    forcePreserve: true,
    forceClearSurface: false,
    statePatch: outcome.authoritativeCommit ? outcome.statePatch : {},
    publicStatePatch: outcome.authoritativeCommit
      ? outcome.publicStatePatch
      : {}
  };
}

function selectQuizItem(retrieval, state, rawText) {
  const candidateIds = (retrieval.matches || [])
    .flatMap((match) =>
      Array.isArray(match.assessment_item_ids)
        ? match.assessment_item_ids
        : []
    )
    .filter(Boolean);
  const ids = candidateIds.length ? candidateIds : listPrivateAssessmentIds();
  const wantsAnother = /换一题|再来一题|下一道题/u.test(normalizeText(rawText));
  let selectedId = ids[0];
  if (wantsAnother && state.active_quiz) {
    const current = ids.indexOf(state.active_quiz.question_id);
    selectedId = ids[(Math.max(current, -1) + 1) % ids.length];
  }
  return getPrivateAssessmentItemById(selectedId);
}

function alignQuizPresentationCandidate(retrieval, questionId) {
  const aligned = clone(retrieval);
  const assessment = getPrivateAssessmentItemById(questionId);
  aligned.matches = (aligned.matches || []).map((match) => ({
    ...match,
    assessment_item_ids: [
      questionId,
      ...(match.assessment_item_ids || []).filter(
        (candidateId) => candidateId !== questionId
      )
    ],
    presentation_candidates: (match.presentation_candidates || []).map(
      (candidate) =>
        candidate?.recommended_type === "quiz.single-choice"
          ? {
              ...candidate,
              assessment_item_id: questionId,
              supports_claim_ids: clone(
                assessment?.supports_claim_ids ||
                  candidate.supports_claim_ids ||
                  []
              )
            }
          : candidate
    )
  }));
  return aligned;
}

function createAwaitingQuiz(item, mode, examId = null) {
  return {
    question_id: item.question_id,
    topic_id: item.topic_id || NEWTON2_TOPIC_ID,
    title: item.title,
    prompt: item.prompt,
    status: "awaiting_answer",
    mode,
    exam_id: examId,
    selected_option: null,
    is_correct: null,
    correct_option: null,
    explanation: null,
    started_at: new Date().toISOString(),
    answered_at: null
  };
}

function createExam(items) {
  return {
    exam_id: "exam_newton2_mvp1",
    topic_id: NEWTON2_TOPIC_ID,
    status: "in_progress",
    question_ids: items.map((item) => item.question_id),
    current_index: 0,
    answered: 0,
    correct: 0,
    answers: [],
    started_at: new Date().toISOString(),
    completed_at: null,
    duration_limit_seconds: 180
  };
}

function publicAssessmentState(activeQuiz) {
  if (!activeQuiz) return null;
  const answered = activeQuiz.status === "answered";
  return {
    question_id: activeQuiz.question_id,
    status: activeQuiz.status,
    selected: answered ? activeQuiz.selected_option : "",
    correct: answered ? Boolean(activeQuiz.is_correct) : null,
    correct_answer: answered ? activeQuiz.correct_option : "",
    explanation: answered ? activeQuiz.explanation || "" : "",
    locked: answered
  };
}

function publicActiveQuiz(activeQuiz) {
  if (!activeQuiz) return null;
  const publicValue = {
    question_id: activeQuiz.question_id,
    topic_id: activeQuiz.topic_id,
    status: activeQuiz.status,
    mode: activeQuiz.mode,
    exam_id: activeQuiz.exam_id || null
  };
  if (activeQuiz.status === "answered") {
    publicValue.selected_option = activeQuiz.selected_option;
    publicValue.is_correct = Boolean(activeQuiz.is_correct);
    publicValue.correct_option = activeQuiz.correct_option;
  }
  return publicValue;
}

function publicExam(exam) {
  if (!exam) return null;
  const total = exam.question_ids.length;
  const durationSeconds = exam.completed_at
    ? Math.max(
        0,
        Math.round(
          (Date.parse(exam.completed_at) - Date.parse(exam.started_at)) / 1000
        )
      )
    : 0;
  return {
    exam_id: exam.exam_id,
    topic_id: exam.topic_id,
    status: exam.status,
    current: Math.min(total, exam.current_index + 1),
    total,
    answered: exam.answered,
    correct: exam.correct,
    incorrect: Math.max(0, exam.answered - exam.correct),
    progress: total ? Math.round((exam.answered / total) * 100) : 0,
    score: total ? Math.round((exam.correct / total) * 100) : 0,
    total_score: 100,
    duration_seconds: durationSeconds,
    remaining_seconds: exam.status === "completed" ? 0 : 180,
    grade:
      exam.status !== "completed"
        ? "进行中"
        : exam.correct === total
          ? "掌握优秀"
          : exam.correct >= 2
            ? "掌握良好"
            : "建议复习",
    feedback:
      exam.status !== "completed"
        ? "完成当前题后继续下一题。"
        : exam.correct === total
          ? "三个核心关系掌握准确，可以继续综合受力分析。"
          : "建议复习 F=ma、比例关系和加速度方向。"
  };
}

function publicOralPractice(oralPractice) {
  if (!oralPractice) return null;
  return {
    practice_id: oralPractice.practice_id,
    topic_id: oralPractice.topic_id,
    status: oralPractice.status,
    started_at: oralPractice.started_at,
    completed_at: oralPractice.completed_at
  };
}

function expectedActionsForTypes(cardTypes) {
  const actions = [];
  if (cardTypes.includes("knowledge.explanation")) {
    actions.push({ type: "quiz.start" });
  }
  if (cardTypes.includes("media.video")) {
    actions.push({ type: "media.video.open" });
  }
  if (cardTypes.includes("compiler.status")) {
    actions.push({ type: "artifact.open" });
  }
  return actions;
}

function maximumCardsForOutcome(outcome) {
  if (outcome.forcePreserve) return 0;
  if (outcome.forceClearSurface) return 0;
  const requested = Array.isArray(outcome.requestedCardTypes)
    ? outcome.requestedCardTypes.length
    : 0;
  if (requested <= 0) return 0;
  return Math.min(3, requested);
}

function flattenClaims(retrieval) {
  const seen = new Set();
  const claims = [];
  for (const match of retrieval.matches || []) {
    for (const candidate of match.claims || []) {
      const claimId = safeId(candidate?.claim_id);
      const text = safeText(candidate?.text, 12000);
      if (!claimId || !text || seen.has(claimId)) continue;
      seen.add(claimId);
      claims.push({ claim_id: claimId, text });
    }
  }
  return claims;
}

function sanitizeEvidence(input) {
  return (Array.isArray(input) ? input : [])
    .slice(0, 8)
    .map((item) => {
      const evidenceId = safeId(item?.evidence_id);
      const title = safeText(item?.title, 1000);
      if (!evidenceId || !title) return null;
      return {
        evidence_id: evidenceId,
        title,
        ...(item.locator
          ? { locator: safeText(item.locator, 4000) }
          : {})
      };
    })
    .filter(Boolean);
}

function createRetrievalContext(state, turnSequence) {
  const now = Date.now();
  const recentTurns = (state.recent_turns || []).filter((turn) => {
    const sequenceDistance = turnSequence - Number(turn.turn_sequence || 0);
    const age = now - Date.parse(turn.occurred_at || "");
    return (
      sequenceDistance >= 0 &&
      sequenceDistance <= CONTEXT_TURN_LIMIT &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= CONTEXT_AGE_MS
    );
  });
  const contextCleared =
    Number.isInteger(state.context_cleared_at_sequence) &&
    (!state.last_match ||
      state.context_cleared_at_sequence >= state.last_match.turn_sequence);
  return {
    current_turn_sequence: turnSequence,
    last_turn_sequence: state.last_turn_sequence,
    last_match: contextCleared ? null : clone(state.last_match),
    recent_turns: contextCleared ? [] : clone(recentTurns),
    active_quiz: clone(state.active_quiz),
    exam: clone(state.exam),
    context_cleared: contextCleared
  };
}

function queryForProvider(turn, intent, state) {
  if (turn.raw_text) {
    const rawText = normalizeText(turn.raw_text);
    if (
      intent === "quiz" &&
      isGenericQuizRequest(rawText) &&
      !explicitlyNamesSupportedQuizTopic(rawText)
    ) {
      const topicPrefix = hasNewton2LearningContext(state)
        ? "继续围绕牛顿第二定律，"
        : "围绕牛顿第二定律，";
      return `${topicPrefix}${turn.raw_text}`;
    }
    return turn.raw_text;
  }
  const event = firstSemanticUIEvent(turn.ui_events);
  if (event?.type === "quiz.start") return "给我出一道牛顿第二定律选择题";
  if (intent === "exam") return "开始牛顿第二定律模拟测验";
  return projectionUserText(turn);
}

function isGenericQuizRequest(rawText) {
  const text = normalizeText(rawText);
  return /出题|考考我|来一道|再来一题|练习题|选择题|做题/u.test(text);
}

function explicitlyNamesSupportedQuizTopic(rawText) {
  return /牛顿第?二(?:运动)?定律|牛[二2]|newton'?s second law|f\s*=\s*m\s*a/iu.test(
    normalizeText(rawText)
  );
}

function hasNewton2LearningContext(state) {
  if (!state || typeof state !== "object") return false;
  if (state.last_match?.topic_id === NEWTON2_TOPIC_ID) return true;
  if (
    Array.isArray(state.last_claim_ids) &&
    state.last_claim_ids.some((claimId) =>
      String(claimId).startsWith("claim_newton2_")
    )
  ) {
    return true;
  }
  return (Array.isArray(state.recent_turns) ? state.recent_turns : []).some(
    (turn) =>
      turn?.topic_id === NEWTON2_TOPIC_ID ||
      (Array.isArray(turn?.claim_ids) &&
        turn.claim_ids.some((claimId) =>
          String(claimId).startsWith("claim_newton2_")
        ))
  );
}

function projectionUserText(turn) {
  if (turn.raw_text) return turn.raw_text;
  const event = firstSemanticUIEvent(turn.ui_events);
  if (!event) return "继续当前教学操作";
  const value =
    event.value ??
    event.payload?.value ??
    event.payload?.selected ??
    "";
  return value
    ? `页面操作：${event.type}，选择 ${String(value)}`
    : `页面操作：${event.type}`;
}

function firstSemanticUIEvent(events) {
  return Array.isArray(events) && events.length ? events[0] : null;
}

function explicitlySwitchesTopic(rawText) {
  return /牛顿第[一三13]定律|光合作用|化学|英语|历史|地理|换个话题|不聊这个/u.test(
    normalizeText(rawText)
  );
}

function getOrCreateSessionState(sessionId) {
  let state = sessionStates.get(sessionId);
  if (state) return state;
  state = {
    session_id: sessionId,
    last_turn_sequence: 0,
    state_version: 0,
    last_claim_ids: [],
    last_match: null,
    recent_turns: [],
    context_cleared_at_sequence: null,
    active_quiz: null,
    exam: null,
    oral_practice: null,
    preferred_language: "zh-CN",
    last_surface_id: "",
    last_package_id: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  sessionStates.set(sessionId, state);
  return state;
}

function publicSessionSnapshot(state) {
  return {
    session_id: state.session_id,
    last_turn_sequence: state.last_turn_sequence,
    state_version: state.state_version,
    last_claim_ids: clone(state.last_claim_ids),
    active_quiz: publicActiveQuiz(state.active_quiz),
    exam: publicExam(state.exam),
    oral_practice: publicOralPractice(state.oral_practice),
    preferred_language: state.preferred_language || "zh-CN",
    last_surface_id: state.last_surface_id,
    last_package_id: state.last_package_id,
    updated_at: state.updated_at
  };
}

function allocateTurnSequence(state, forcedSequence) {
  const forced = Number(forcedSequence);
  const next =
    Number.isInteger(forced) && forced > state.last_turn_sequence
      ? forced
      : state.last_turn_sequence + 1;
  state.last_turn_sequence = next;
  return next;
}

function previewPatchedState(state, patch, stateVersion) {
  const preview = clone(state);
  for (const [key, value] of Object.entries(patch || {})) {
    preview[key] = clone(value);
  }
  preview.state_version = stateVersion;
  return preview;
}

function applyStatePatch(state, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    state[key] = clone(value);
  }
}

function enqueueSession(sessionId, work) {
  const previous = sessionQueues.get(sessionId) || Promise.resolve();
  const task = previous.then(work, work);
  const tail = task.then(
    () => undefined,
    () => undefined
  );
  sessionQueues.set(sessionId, tail);
  void tail.then(() => {
    if (sessionQueues.get(sessionId) === tail) sessionQueues.delete(sessionId);
  });
  return task;
}

function cacheResponse(key, result) {
  responseCache.set(key, clone(result));
  while (responseCache.size > MAX_RESPONSE_CACHE) {
    responseCache.delete(responseCache.keys().next().value);
  }
}

function appendTurnLog(log) {
  const logs = turnLogs.get(log.session_id) || [];
  logs.push(clone(log));
  if (logs.length > MAX_LOGS_PER_SESSION) {
    logs.splice(0, logs.length - MAX_LOGS_PER_SESSION);
  }
  turnLogs.set(log.session_id, logs);
}

function appendReplayLog(originalLog, queueStartedAt) {
  const replay = {
    ...clone(originalLog),
    logged_at: new Date().toISOString(),
    duplicate: true,
    timings: {
      queue_ms: Math.max(0, Date.now() - queueStartedAt),
      provider_ms: 0,
      card_assembly_ms: 0,
      projection_ms: 0,
      total_ms: Math.max(0, Date.now() - queueStartedAt)
    }
  };
  appendTurnLog(replay);
}

function updateMatchingLogs(match, mutate) {
  const logs = turnLogs.get(match.sessionId) || [];
  for (const log of logs) {
    if (logMatches(log, match)) mutate(log);
  }
}

function logMatches(log, match) {
  return Boolean(
    log &&
      log.session_id === match.sessionId &&
      (!match.turnId || log.turn_id === match.turnId) &&
      (!match.packageId || log.package_id === match.packageId)
  );
}

function isTurnCanceled(sessionId, turnId) {
  return Boolean(canceledTurns.get(sessionId)?.has(turnId));
}

function responseCacheKey(sessionId, idempotencyKey) {
  return `${sessionId}:${idempotencyKey}`;
}

function sanitizeAssemblyErrors(errors) {
  return (Array.isArray(errors) ? errors : [])
    .slice(0, 20)
    .map((error) => ({
      code: safeId(error?.code) || "CARD_ERROR",
      message: safeText(error?.message, 500)
    }));
}

function normalizeChoice(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase();
  if (/^[A-D]$/.test(normalized)) return normalized;
  const aliases = {
    "1": "A",
    一: "A",
    第一: "A",
    第一个: "A",
    第一项: "A",
    "2": "B",
    二: "B",
    第二: "B",
    第二个: "B",
    第二项: "B",
    "3": "C",
    三: "C",
    第三: "C",
    第三个: "C",
    第三项: "C",
    "4": "D",
    四: "D",
    第四: "D",
    第四个: "D",
    第四项: "D"
  };
  return aliases[normalized] || "";
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/f\s*=\s*m\s*a/giu, "F=ma")
    .replace(/\s+/gu, " ")
    .trim();
}

function safeId(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 160);
}

function safeText(value, limit) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit);
}

function safeReason(value) {
  return safeId(value) || "user_interruption";
}

function safeErrorCode(error) {
  return safeId(error?.code || error?.name || "TEACHER_RUNTIME_ERROR");
}

function safeErrorMessage(error) {
  return safeText(error?.message || "Card assembly failed", 500);
}

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function hasKeys(value) {
  return Boolean(
    value && typeof value === "object" && Object.keys(value).length > 0
  );
}

function clone(value) {
  return cloneContractValue(value);
}

export { CONTRACT_VERSION };
