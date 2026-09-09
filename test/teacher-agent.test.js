import assert from "node:assert/strict";
import test from "node:test";

import {
  A2UI_VERSION,
  CONTRACT_VERSION,
  EDUCATION_CATALOG_ID,
  normalizeUserTurn
} from "../contracts.js";
import {
  compileKnowledgeSource,
  getKnowledgeArtifact,
  listKnowledgeArtifacts,
  searchKnowledge
} from "../knowledge-compiler.js";
import { resetSessionState, runTeacherTurn } from "../teacher-agent.js";

delete process.env.TEACHER_AGENT_ENDPOINT;
delete process.env.TEACHER_AGENT_API_KEY;

test("text question about Newton returns one grounded voice projection and card surface", async () => {
  const response = await runTeacherTurn({
    session_id: "teacher_text_newton",
    turn_id: "turn_explain",
    idempotency_key: "turn_explain",
    source: "text",
    text: "请给我讲讲牛顿第二定律",
    state_version: 0
  });

  assert.equal(response.teachingPackage.package_version, CONTRACT_VERSION);
  assert.equal(response.voiceProjection.grounding_mode, "retrieved");
  assert.match(response.voiceProjection.answer_brief.direct_answer, /F=ma/);
  assert.equal(response.teachingPackage.state_version, 1);

  const operation = response.a2ui;
  assert.equal(operation.operation, "replace");
  assert.deepEqual(
    operation.cards.map((card) => card.type),
    ["knowledge.explanation"]
  );
  assert.ok(operation.cards.every((card) => card.version === CONTRACT_VERSION));

  const createSurface = operation.messages.find(
    (message) => message.createSurface
  );
  assert.equal(createSurface.version, A2UI_VERSION);
  assert.equal(createSurface.createSurface.catalogId, EDUCATION_CATALOG_ID);
  const components = operation.messages.find((message) => message.updateComponents)
    .updateComponents.components;
  assert.ok(components.some((component) => component.component === "EducationCard"));
  assert.ok(
    response.teachingPackage.evidence.some((citation) =>
      citation.title.includes("牛顿")
    )
  );
});

test("UI answer.select grades the active quiz", async () => {
  const question = await runTeacherTurn({
    session_id: "teacher_ui_answer",
    turn_id: "turn_question",
    idempotency_key: "turn_question",
    source: "text",
    text: "请给我出一道牛顿第二定律选择题",
    state_version: 0
  });
  const quiz = question.uiProjection.cards.find(
    (card) => card.type === "quiz.single-choice"
  );
  assert.ok(quiz);

  const response = await runTeacherTurn({
    session_id: "teacher_ui_answer",
    turn_id: "turn_ui_answer",
    idempotency_key: "ui_answer_a",
    source: "ui",
    text: "",
    ui_events: [
      {
        event_id: "ui_answer_a",
        type: "answer.select",
        card_id: quiz.id,
        question_id: quiz.props.question_id,
        value: "A"
      }
    ],
    state_version: question.teachingPackage.state_version
  });

  assert.equal(response.voiceProjection.grounding_mode, "state_authoritative");
  assert.deepEqual(
    {
      question_id: response.teachingPackage.authoritative_result.question_id,
      selected: response.teachingPackage.authoritative_result.selected_option,
      correct_answer:
        response.teachingPackage.authoritative_result.correct_option,
      correct: response.teachingPackage.authoritative_result.is_correct
    },
    {
      question_id: "quiz_newton_force_mass_01",
      selected: "A",
      correct_answer: "A",
      correct: true
    }
  );
  const gradedCard = response.uiProjection.cards.find(
    (card) => card.type === "quiz.single-choice"
  );
  assert.equal(gradedCard.state.selected, "A");
  assert.equal(gradedCard.state.correct, true);
  assert.equal(gradedCard.state.locked, true);
});

test("voice '我选A' and UI answer.select have the same grading semantics", async () => {
  const question = await runTeacherTurn({
    session_id: "teacher_voice_answer",
    turn_id: "turn_voice_question",
    idempotency_key: "turn_voice_question",
    source: "voice",
    text: "考我一道牛顿第二定律的选择题",
    state_version: 0
  });
  const response = await runTeacherTurn({
    session_id: "teacher_voice_answer",
    turn_id: "turn_voice_answer",
    idempotency_key: "voice_answer_a",
    source: "voice",
    text: "我选 A",
    state_version: question.teachingPackage.state_version
  });

  assert.equal(response.voiceProjection.grounding_mode, "state_authoritative");
  assert.equal(response.teachingPackage.authoritative_result.question_id,
    "quiz_newton_force_mass_01");
  assert.equal(response.teachingPackage.authoritative_result.selected_option, "A");
  assert.equal(response.teachingPackage.authoritative_result.correct_option, "A");
  assert.equal(response.teachingPackage.authoritative_result.is_correct, true);
  assert.match(
    response.teachingPackage.authoritative_result.explanation,
    /加速度也变为 2 倍/
  );
  assert.deepEqual(
    response.uiProjection.cards.map((card) => card.type),
    [
      "quiz.single-choice",
      "knowledge.mindmap",
      "knowledge.explanation"
    ]
  );
});

test("oral-practice intent renders the sixth initial education card type", async () => {
  const response = await runTeacherTurn({
    session_id: "teacher_oral",
    turn_id: "turn_oral",
    idempotency_key: "turn_oral",
    source: "text",
    text: "陪我做牛顿第二定律的口语复述练习",
    state_version: 0
  });

  assert.ok(
    response.uiProjection.cards.some((card) => card.type === "oral.practice")
  );
  assert.ok(
    response.uiProjection.expected_actions.some(
      (action) => action.type === "oral.record.start"
    )
  );
});

test("Mock learning analysis, generic quiz and English switch form one continuous flow", async () => {
  const sessionId = "teacher_mock_continuous_flow";
  resetSessionState(sessionId);
  const turn = (turnId, rawText) =>
    runTeacherTurn({
      session_id: sessionId,
      turn_id: turnId,
      idempotency_key: turnId,
      source: "text",
      raw_text: rawText
    });

  const analysis = await turn(
    "flow_analysis",
    "期末考试和期中考试我哪个知识点错的多？"
  );
  assert.match(
    analysis.voiceProjection.answer_brief.direct_answer,
    /牛顿第二定律.*期中错了 2 题.*期末错了 3 题.*合计错了 5 题/
  );
  assert.deepEqual(
    analysis.uiProjection.cards.map((card) => card.type),
    ["knowledge.explanation", "knowledge.mindmap"]
  );
  assert.equal(
    analysis.uiProjection.cards[0].props.formula,
    "F = ma"
  );

  const question = await turn("flow_quiz", "出题考考我");
  assert.deepEqual(
    question.uiProjection.cards.map((card) => card.type),
    ["quiz.single-choice"]
  );
  const concealedQuestion = JSON.stringify(question.uiProjection.cards);
  assert.doesNotMatch(
    concealedQuestion,
    /correct_answer|correct_option|explanation/
  );

  const grade = await turn("flow_grade", "我选A");
  assert.equal(grade.teachingPackage.authoritative_result.is_correct, true);
  assert.deepEqual(
    grade.uiProjection.cards.map((card) => card.type),
    [
      "quiz.single-choice",
      "knowledge.mindmap",
      "knowledge.explanation"
    ]
  );

  const english = await turn(
    "flow_english",
    "can you speek in English?"
  );
  assert.match(
    english.voiceProjection.answer_brief.direct_answer,
    /^Of course!/
  );
  assert.deepEqual(
    english.uiProjection.cards.map((card) => card.type),
    ["language.vocabulary", "language.grammar"]
  );
});

test("mock compiler accepts audio, image, text and pdf sources", () => {
  for (const sourceType of ["audio", "image", "text", "pdf"]) {
    const artifact = compileKnowledgeSource({
      artifact_id: `artifact_test_${sourceType}`,
      source_type: sourceType,
      title: `${sourceType} 测试资料`,
      content: "牛顿第二定律说明合外力、质量和加速度的关系。",
      uri: `mock://source/${sourceType}`
    });

    assert.equal(artifact.artifact_id, `artifact_test_${sourceType}`);
    assert.equal(artifact.source_type, sourceType);
    assert.equal(artifact.status, "compiled");
    assert.ok(artifact.knowledge_units.length > 0);
    assert.ok(artifact.citations.length > 0);
    assert.ok(artifact.card_materials.length > 0);
    assert.deepEqual(getKnowledgeArtifact(artifact.artifact_id), artifact);
  }

  const preset = getKnowledgeArtifact("artifact_newton_second_law");
  assert.ok(preset);
  assert.ok(
    JSON.stringify(preset.card_materials).includes("/assets/newton-cart-lesson.png")
  );
  assert.ok(listKnowledgeArtifacts().length >= 5);
  assert.equal(
    searchKnowledge("牛顿第二定律", {
      artifactIds: ["artifact_newton_second_law"],
      topK: 1
    })[0].artifact_id,
    "artifact_newton_second_law"
  );
});

test("UserTurn normalizer accepts the legacy A2UI v0.9 action envelope", () => {
  const turn = normalizeUserTurn({
    sessionId: "legacy_session",
    source: "ui",
    uiEvents: [
      {
        version: "v0.9",
        action: {
          name: "answer.select",
          surfaceId: "surface_01",
          sourceComponentId: "option_a",
          context: {
            question_id: "quiz_01",
            value: "A"
          }
        }
      }
    ]
  });

  assert.equal(turn.session_id, "legacy_session");
  assert.equal(turn.source, "ui");
  assert.equal(turn.ui_events[0].type, "answer.select");
  assert.equal(turn.ui_events[0].surface_id, "surface_01");
  assert.equal(turn.ui_events[0].component_id, "option_a");
  assert.equal(turn.ui_events[0].question_id, "quiz_01");
  assert.equal(turn.ui_events[0].value, "A");
});
