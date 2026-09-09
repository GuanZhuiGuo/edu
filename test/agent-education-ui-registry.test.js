import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_EDUCATION_UI_VERSION,
  createAgentEducationAssessmentRuntime,
  getAgentEducationUiPrompt,
  getAgentEducationUiReferenceCatalog,
  gradeAgentEducationAssessment,
  isAgentEducationUiError,
  projectMarketingAgentAnswer
} from "../agent-education-ui-registry.js";

test("registry exposes copyable prompt and a bounded trusted reference catalog", () => {
  const catalog = getAgentEducationUiReferenceCatalog();
  const prompt = getAgentEducationUiPrompt();
  assert.equal(catalog.assessments.length, 3);
  assert.equal(catalog.knowledge_graphs.length, 1);
  assert.match(prompt, /assessment\.pythagoras\.01/u);
  assert.match(prompt, /assessment\.pythagoras\.03/u);
  assert.match(prompt, /graph\.pythagoras\.dependencies/u);
  assert.match(prompt, /knowledge_summary/u);
  assert.match(prompt, /knowledge_graph/u);
  assert.match(prompt, /assessment_refs/u);
  assert.match(prompt, /只输出一个严格 JSON 对象/u);
});

test("plain Agent text remains a safe transition fallback", () => {
  const result = projectMarketingAgentAnswer("先确认它是直角三角形。\n再代入公式。");
  assert.equal(result.mode, "text_fallback");
  assert.equal(result.ui_projection, null);
  assert.match(result.answer, /直角三角形/u);
});

test("structured text without cards does not open an empty A2UI surface", () => {
  const result = projectMarketingAgentAnswer(JSON.stringify({
    schema_version: "ai-teacher-ui@1.0",
    answer: "这次只需要文字说明。",
    cards: []
  }));
  assert.equal(result.mode, "structured");
  assert.equal(result.ui_projection, null);
});

test("canonical Agent plan becomes trusted horizontal A2UI without answer leakage", () => {
  const raw = JSON.stringify({
    schema_version: AGENT_EDUCATION_UI_VERSION,
    answer: "先看知识关系和图示，再完成下面的练习。",
    cards: [
      { type: "knowledge_summary", knowledge_ref: "kp.pythagoras" },
      { type: "knowledge_graph", graph_ref: "graph.pythagoras.dependencies" },
      { type: "image", asset_ref: "asset.right_triangle" },
      { type: "quiz", assessment_ref: "assessment.pythagoras.01" }
    ]
  });
  const result = projectMarketingAgentAnswer(raw, { turnId: "turn_1" });
  const publicJson = JSON.stringify(result);
  assert.equal(result.mode, "structured");
  assert.equal(result.ui_projection.messages.length, 3);
  assert.match(publicJson, /agent\.registry/u);
  assert.doesNotMatch(publicJson, /correct_option_id/u);
  assert.doesNotMatch(publicJson, /6² \+ 8²/u);
  assert.match(publicJson, /前置知识/u);
});

test("unknown Agent references are skipped without losing the answer or valid cards", () => {
  const raw = JSON.stringify({
    schema_version: "ai-teacher-ui@1.0",
    answer: "请看卡片。",
    cards: [
      { type: "image", asset_ref: "asset.unknown" },
      { type: "knowledge_point", knowledge_ref: "kp.pythagoras" }
    ]
  });
  const result = projectMarketingAgentAnswer(raw);
  assert.equal(result.answer, "请看卡片。");
  assert.equal(result.ui_projection.cards.length, 1);
  assert.equal(result.ui_projection.cards[0].type, "knowledge.explanation");
  assert.equal(result.skipped_cards.length, 1);
  assert.equal(result.skipped_cards[0].code, "REFERENCE_NOT_FOUND");
});

test("quiz plans are rejected when the public answer contains the private correct option", () => {
  const raw = JSON.stringify({
    schema_version: "ai-teacher-ui@1.0",
    answer: "先想一想，斜边就是 10 cm。",
    cards: [{ type: "quiz", assessment_ref: "assessment.pythagoras.01" }]
  });
  assert.throws(
    () => projectMarketingAgentAnswer(raw),
    (error) => error?.code === "agent_education_ui_quiz_answer_leak"
  );
});

test("mini-test plans expand into independently bound private assessment instances", () => {
  const userId = "user_mini_test";
  const sessionId = "session_mini_test";
  const result = projectMarketingAgentAnswer(
    JSON.stringify({
      schema_version: AGENT_EDUCATION_UI_VERSION,
      answer: "用两道题检查你是否能正确识别斜边并使用定理。",
      cards: [
        {
          type: "quiz",
          assessment_refs: ["assessment.pythagoras.01", "assessment.pythagoras.02"]
        }
      ]
    }),
    { turnId: "mini_test_turn", userId, sessionId }
  );

  assert.equal(result.mode, "structured");
  assert.equal(result.ui_projection.cards.length, 2);
  assert.deepEqual(
    result.ui_projection.cards.map((card) => card.props.question_id),
    ["quiz.pythagoras.01", "quiz.pythagoras.02"]
  );
  const publicJson = JSON.stringify(result);
  assert.doesNotMatch(publicJson, /correct_option_id/u);
  assert.doesNotMatch(publicJson, /√169/u);

  result.ui_projection.cards.forEach((card) => {
    const graded = gradeAgentEducationAssessment({
      questionId: card.props.question_id,
      selected: "B",
      userId,
      sessionId,
      cardId: card.id
    });
    assert.equal(graded.ok, true);
    assert.equal(graded.correct, false);
  });
});

test("answer-leak protection checks every private item in a mini-test", () => {
  const raw = JSON.stringify({
    schema_version: AGENT_EDUCATION_UI_VERSION,
    answer: "第二道题的结果是 13 cm，再做做看。",
    cards: [
      {
        type: "quiz",
        assessment_refs: ["assessment.pythagoras.01", "assessment.pythagoras.02"]
      }
    ]
  });
  assert.throws(
    () => projectMarketingAgentAnswer(raw),
    (error) => error?.code === "agent_education_ui_quiz_answer_leak"
  );
});

test("answer-leak protection rejects equivalent numeric and Chinese answer claims", () => {
  const leakedAnswers = ["计算可得 c=10。", "斜边长度为十厘米。", "结果是 10，再做做看。"];
  for (const answer of leakedAnswers) {
    const raw = JSON.stringify({
      schema_version: AGENT_EDUCATION_UI_VERSION,
      answer,
      cards: [{ type: "quiz", assessment_ref: "assessment.pythagoras.01" }]
    });
    assert.throws(
      () => projectMarketingAgentAnswer(raw),
      (error) => error?.code === "agent_education_ui_quiz_answer_leak"
    );
  }
});

test("registry binds grading to one card, user and session with idempotent replay", () => {
  const userId = "user_grade_1";
  const sessionId = "session_grade_1";
  const projected = projectMarketingAgentAnswer(
    JSON.stringify({
      schema_version: "ai-teacher-ui@1.0",
      answer: "请完成下面的练习。",
      cards: [{ type: "quiz", assessment_ref: "assessment.pythagoras.01" }]
    }),
    { turnId: "grade_turn_1", userId, sessionId }
  );
  const cardId = projected.ui_projection.cards[0].id;
  const graded = gradeAgentEducationAssessment({
    questionId: "quiz.pythagoras.01",
    selected: "D",
    userId,
    sessionId,
    cardId
  });
  assert.equal(graded.ok, true);
  assert.equal(graded.correct, false);
  assert.equal(graded.correct_option_id, "A");
  assert.match(graded.explanation, /10 cm/u);
  assert.equal(graded.idempotent, false);

  const replay = gradeAgentEducationAssessment({
    questionId: "quiz.pythagoras.01",
    selected: "D",
    userId,
    sessionId,
    cardId
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);

  const changed = gradeAgentEducationAssessment({
    questionId: "quiz.pythagoras.01",
    selected: "A",
    userId,
    sessionId,
    cardId
  });
  assert.equal(changed.ok, false);
  assert.equal(changed.code, "ASSESSMENT_ALREADY_SUBMITTED");

  const invalid = gradeAgentEducationAssessment({
    questionId: "quiz.pythagoras.01",
    selected: "D",
    userId: "another_user",
    sessionId,
    cardId
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "ASSESSMENT_INSTANCE_NOT_FOUND");
});

test("assessment runtime caps entries and expires private attempt state", () => {
  let currentTime = 1_000;
  const runtime = createAgentEducationAssessmentRuntime({
    maxEntries: 2,
    ttlMs: 100,
    now: () => currentTime
  });
  const quizCard = (id) => ({
    id,
    type: "quiz.single-choice",
    props: { question_id: "quiz.pythagoras.01" }
  });

  runtime.registerCards([quizCard("card_1")], { userId: "u", sessionId: "s" });
  runtime.registerCards([quizCard("card_2")], { userId: "u", sessionId: "s" });
  runtime.registerCards([quizCard("card_3")], { userId: "u", sessionId: "s" });
  assert.deepEqual(runtime.inspect(), { size: 2, maxEntries: 2, ttlMs: 100 });
  assert.equal(
    runtime.grade({
      questionId: "quiz.pythagoras.01",
      selected: "A",
      userId: "u",
      sessionId: "s",
      cardId: "card_1"
    }).code,
    "ASSESSMENT_INSTANCE_NOT_FOUND"
  );

  currentTime = 1_101;
  assert.equal(runtime.inspect().size, 0);
  assert.equal(
    runtime.grade({
      questionId: "quiz.pythagoras.01",
      selected: "A",
      userId: "u",
      sessionId: "s",
      cardId: "card_3"
    }).code,
    "ASSESSMENT_INSTANCE_NOT_FOUND"
  );
});
