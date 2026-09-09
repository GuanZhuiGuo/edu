import assert from "node:assert/strict";
import test from "node:test";

import {
  A2UI_VERSION,
  CONTRACT_VERSION,
  EDUCATION_CATALOG_ID
} from "../contracts.js";
import {
  GRADE_EDUCATION_ANSWER_TOOL,
  SEARCH_COMPILED_KNOWLEDGE_TOOL,
  isEducationToolName,
  runEducationTool
} from "../education-tools.js";
import {
  getKnowledgeArtifact,
  searchCompiledKnowledge
} from "../knowledge-compiler.js";

test("exports the two deterministic education tool contracts", () => {
  assert.equal(
    SEARCH_COMPILED_KNOWLEDGE_TOOL.name,
    "search_compiled_knowledge"
  );
  assert.equal(
    SEARCH_COMPILED_KNOWLEDGE_TOOL.parameters.properties.min_score.default,
    8
  );
  assert.equal(
    GRADE_EDUCATION_ANSWER_TOOL.name,
    "grade_education_answer"
  );
  assert.equal(isEducationToolName("search_compiled_knowledge"), true);
  assert.equal(isEducationToolName("grade_education_answer"), true);
  assert.equal(isEducationToolName("teacher_turn"), false);
});

test("strict compiled search rejects an empty query", async () => {
  assert.throws(
    () => searchCompiledKnowledge("   "),
    /must not be empty/
  );
  await assert.rejects(
    runEducationTool("search_compiled_knowledge", { query: "\n\t" }),
    /non-empty query/
  );
});

test("matched knowledge returns compact model context and same-source A2UI", async () => {
  const result = await runEducationTool("search_compiled_knowledge", {
    query: "请讲讲牛顿第二定律",
    artifact_ids: ["artifact_newton_second_law"]
  });

  assert.equal(result.toolResult.status, "matched");
  assert.equal(result.toolResult.matches.length, 1);
  assert.match(result.toolResult.matches[0].content, /F=ma/);
  assert.ok(result.toolResult.matches[0].citations.length > 0);
  assert.ok(result.toolResult.matches[0].card_materials.length > 0);
  assert.equal(Object.hasOwn(result.toolResult, "speech_text"), false);

  assert.ok(result.uiPayload);
  assert.equal(result.uiPayload.surface_id, result.uiPayload.messages[0].createSurface.surfaceId);
  assert.equal(result.uiPayload.messages[0].version, A2UI_VERSION);
  assert.equal(
    result.uiPayload.messages[0].createSurface.catalogId,
    EDUCATION_CATALOG_ID
  );
  assert.ok(
    result.uiPayload.cards.every((card) => card.version === CONTRACT_VERSION)
  );
  assert.ok(
    result.uiPayload.cards.every((card) =>
      card.meta.artifact_ids.includes(
        result.toolResult.matches[0].artifact_id
      )
    )
  );
  assert.ok(
    result.uiPayload.cards.some(
      (card) => card.type === "knowledge.explanation"
    )
  );
  assert.ok(
    result.uiPayload.cards.some(
      (card) => card.type === "quiz.single-choice"
    )
  );
  assert.equal(result.activeQuestionId, "quiz_newton_force_mass_01");
});

test("unanswered knowledge cards never expose the server-side answer", async () => {
  const artifact = getKnowledgeArtifact("artifact_newton_second_law");
  const search = await runEducationTool("search_compiled_knowledge", {
    query: "牛顿第二定律"
  });
  const unansweredQuiz = search.uiPayload.cards.find(
    (card) => card.type === "quiz.single-choice"
  );
  const publicPayload = JSON.stringify({
    artifact,
    toolResult: search.toolResult,
    card: unansweredQuiz
  });

  assert.ok(unansweredQuiz);
  assert.equal(unansweredQuiz.state.status, "awaiting_answer");
  assert.equal(unansweredQuiz.state.locked, false);
  assert.equal(Object.hasOwn(unansweredQuiz.state, "correct_answer"), false);
  assert.equal(Object.hasOwn(unansweredQuiz.props, "explanation"), false);
  assert.equal(publicPayload.includes("answer_key"), false);
  assert.equal(publicPayload.includes("correct_answer"), false);
});

test("default minimum score 8 produces an explicit no_match", async () => {
  const weakOverlap = await runEducationTool("search_compiled_knowledge", {
    query: "质量是什么"
  });
  assert.equal(weakOverlap.toolResult.status, "no_match");
  assert.deepEqual(weakOverlap.toolResult.matches, []);
  assert.equal(weakOverlap.uiPayload, null);

  const unrelated = await runEducationTool("search_compiled_knowledge", {
    query: "莎士比亚十四行诗押韵格式"
  });
  assert.equal(unrelated.toolResult.status, "no_match");
  assert.equal(unrelated.uiPayload, null);
  assert.equal(Object.hasOwn(unrelated.toolResult, "speech_text"), false);
});

test("grade_education_answer uses activeQuestionId and reveals answer only after grading", async () => {
  const search = await runEducationTool("search_compiled_knowledge", {
    query: "牛顿第二定律"
  });
  const result = await runEducationTool(
    "grade_education_answer",
    { selected: "A" },
    { activeQuestionId: search.activeQuestionId }
  );

  assert.deepEqual(result.toolResult, {
    status: "graded",
    question_id: "quiz_newton_force_mass_01",
    selected: "A",
    correct: true,
    correct_answer: "A",
    explanation:
      "由 F=ma 可知，质量 m 不变时，加速度 a 与合外力 F 成正比。"
  });
  assert.equal(result.activeQuestionId, null);
  assert.ok(result.uiPayload);
  const gradedCard = result.uiPayload.cards[0];
  assert.equal(gradedCard.type, "quiz.single-choice");
  assert.equal(gradedCard.state.selected, "A");
  assert.equal(gradedCard.state.correct, true);
  assert.equal(gradedCard.state.correct_answer, "A");
  assert.equal(gradedCard.state.locked, true);
  const unansweredCard = search.uiPayload.cards.find(
    (card) => card.type === "quiz.single-choice"
  );
  assert.equal(gradedCard.id, unansweredCard.id);
  assert.equal(result.uiPayload.surface_id, search.uiPayload.surface_id);
  assert.equal(result.uiPayload.mode, "patch");
  assert.equal(
    result.uiPayload.messages.some((message) => message.createSurface),
    false
  );
  assert.ok(result.uiPayload.fallback_messages[0].createSurface);
  const originalQuizComponent =
    search.uiPayload.messages[1].updateComponents.components.find(
      (component) => component.card?.id === unansweredCard.id
    );
  const gradedQuizComponent =
    result.uiPayload.messages[0].updateComponents.components[0];
  assert.equal(gradedQuizComponent.id, originalQuizComponent.id);
});

test("grade_education_answer deterministically handles wrong and invalid selections", async () => {
  const wrong = await runEducationTool(
    "grade_education_answer",
    {
      question_id: "quiz_newton_force_mass_01",
      selected: "Ｂ"
    }
  );
  assert.equal(wrong.toolResult.status, "graded");
  assert.equal(wrong.toolResult.selected, "B");
  assert.equal(wrong.toolResult.correct, false);
  assert.equal(wrong.toolResult.correct_answer, "A");
  assert.equal(wrong.uiPayload.cards[0].state.status, "incorrect");

  const invalid = await runEducationTool(
    "grade_education_answer",
    { selected: "Z" },
    { activeQuestionId: "quiz_newton_force_mass_01" }
  );
  assert.equal(invalid.toolResult.status, "invalid_answer");
  assert.equal(invalid.uiPayload, null);
  assert.equal(invalid.activeQuestionId, "quiz_newton_force_mass_01");

  const missing = await runEducationTool(
    "grade_education_answer",
    { selected: "A" }
  );
  assert.equal(missing.toolResult.status, "no_active_question");
  assert.equal(missing.uiPayload, null);
});

test("unknown education tool names are rejected", async () => {
  await assert.rejects(
    runEducationTool("teacher_turn", {}),
    /Unsupported education tool/
  );
});
