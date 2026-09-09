import assert from "node:assert/strict";
import test from "node:test";

import { validateEducationCard } from "../education-card-assembler.js";
import {
  PI_LEARNING_UI_PROJECTION_VERSION,
  PiLearningUiError,
  projectPiLearningTeachingPackageToA2UI,
} from "../pi-learning-ui.js";

function packageFixture(questionDrafts = [singleChoiceDraft()]) {
  return {
    schema_version: "pi-learning-teaching-package@1.0",
    request_id: "request-ui-1",
    status: "answered",
    answer: "请先独立完成这道题。",
    loaded_materials: [{
      material_id: "MOE-MATH-2022",
      title: "义务教育数学课程标准（2022年版）",
    }],
    question_drafts: questionDrafts,
  };
}

function singleChoiceDraft(overrides = {}) {
  return {
    assessment_id: "assessment.001",
    assessment_instance_id: "assessment_instance:001",
    knowledge_point_ids: ["M4-NA-FUN-02"],
    blueprint: {
      item_type: "single_choice",
      difficulty: "medium",
      cognitive_level: "apply",
    },
    public_item: {
      title: "一次函数练习",
      prompt: "已知 y=2x+5，与 y 轴的交点纵坐标是多少？",
      instruction: "选择一个答案",
      options: [
        { id: "A", label: "2" },
        { id: "B", label: "5" },
        { id: "C", label: "7" },
      ],
    },
    publishable: false,
    ...overrides,
  };
}

test("projects Pi single-choice drafts into validated EducationCard and A2UI messages", () => {
  const result = projectPiLearningTeachingPackageToA2UI(packageFixture(), {
    surfaceId: "student_quiz_surface",
    stateVersion: 3,
    turnSequence: 8,
  });

  assert.equal(result.schema_version, PI_LEARNING_UI_PROJECTION_VERSION);
  assert.equal(result.cards.length, 1);
  assert.equal(result.skipped_cards.length, 0);
  assert.equal(result.a2ui.surfaceId, "student_quiz_surface");
  assert.equal(result.a2ui.messages.length, 3);
  const card = result.cards[0];
  assert.equal(card.type, "quiz.single-choice");
  assert.equal(card.meta.parameterization.mode, "none");
  assert.equal(validateEducationCard(card).valid, true);
  assert.equal(card.props.question_id, "assessment_instance:001");
  assert.equal(card.state.state_version, 3);
  card.actions.forEach((action) => {
    assert.equal(action.context.grading_source, "pi.learning");
    assert.equal(action.context.assessment_instance_id, "assessment_instance:001");
    assert.equal(action.payload.assessment_instance_id, "assessment_instance:001");
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /correct_option|answer_key|private_key|solution_plan/u);
});

test("skips unsupported, malformed and over-limit drafts without blocking valid cards", () => {
  const unsupported = singleChoiceDraft({
    assessment_instance_id: "assessment_instance:multiple",
    blueprint: { item_type: "multiple_choice", difficulty: "hard" },
  });
  const duplicateOptions = singleChoiceDraft({
    assessment_instance_id: "assessment_instance:duplicate",
    public_item: {
      title: "重复选项",
      prompt: "下列哪个选项正确？",
      options: [{ id: "A", label: "1" }, { id: "A", label: "2" }],
    },
  });
  const secondValid = singleChoiceDraft({ assessment_instance_id: "assessment_instance:002" });
  const thirdValid = singleChoiceDraft({ assessment_instance_id: "assessment_instance:003" });
  const result = projectPiLearningTeachingPackageToA2UI(
    packageFixture([unsupported, singleChoiceDraft(), duplicateOptions, secondValid, thirdValid]),
    { maxCards: 2 },
  );

  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[0].props.question_id, "assessment_instance:001");
  assert.deepEqual(result.skipped_cards.map((item) => item.code), [
    "UNSUPPORTED_ITEM_TYPE",
    "QUESTION_OPTION_INVALID",
    "CARD_LIMIT_EXCEEDED",
  ]);
});

test("rejects public drafts containing private answer or executable fields", () => {
  const leaked = singleChoiceDraft({ correct_option_ids: ["B"] });
  const executable = singleChoiceDraft({
    assessment_instance_id: "assessment_instance:unsafe",
    public_item: {
      title: "不安全题目",
      prompt: "<script>alert(1)</script>",
      options: [{ id: "A", label: "1" }, { id: "B", label: "2" }],
    },
  });
  const result = projectPiLearningTeachingPackageToA2UI(packageFixture([leaked, executable]));

  assert.equal(result.cards.length, 0);
  assert.deepEqual(result.skipped_cards.map((item) => item.code), [
    "PRIVATE_ANSWER_FIELD_REJECTED",
    "EXECUTABLE_CONTENT_REJECTED",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /alert\(1\)|correct_option_ids/u);
});

test("fails closed for an incompatible teaching package version", () => {
  assert.throws(
    () => projectPiLearningTeachingPackageToA2UI({
      schema_version: "other-package@1.0",
      request_id: "request-1",
      question_drafts: [],
    }),
    (error) => error instanceof PiLearningUiError
      && error.code === "pi_learning_teaching_package_invalid",
  );
});
