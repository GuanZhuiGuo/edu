import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_EDUCATION_UI_SCHEMA,
  AGENT_EDUCATION_UI_VERSION,
  LEGACY_AGENT_EDUCATION_UI_VERSION,
  AgentEducationUiError,
  buildAgentEducationUiPrompt,
  convertAgentEducationUiResponse,
  parseAgentEducationUiResponse,
  validateAgentEducationUiResponse
} from "../agent-education-ui-contract.js";

function validResponse(cards = []) {
  return {
    schema_version: AGENT_EDUCATION_UI_VERSION,
    answer: "先回顾核心概念，再做一道练习。",
    cards
  };
}

test("prompt gives the Agent a strict compact contract and a bounded reference catalog", () => {
  const prompt = buildAgentEducationUiPrompt({
    assessments: [{ ref: "assessment.pythagoras.01", label: "勾股定理练习" }],
    knowledge_points: ["kp.pythagoras"],
    knowledge_graphs: ["graph.pythagoras.dependencies"],
    images: ["asset.right_triangle"],
    mindmaps: ["mindmap.pythagoras"]
  });

  assert.match(prompt, /必须只输出一个严格 JSON 对象/u);
  assert.match(prompt, /严禁输出题干、选项、选项正误、正确选项、答案/u);
  assert.match(prompt, /assessment\.pythagoras\.01/u);
  assert.match(prompt, /kp\.pythagoras/u);
  assert.match(prompt, /graph\.pythagoras\.dependencies/u);
  assert.match(prompt, /knowledge_summary/u);
  assert.match(prompt, /knowledge_graph/u);
  assert.match(prompt, /assessment_refs/u);
  assert.match(prompt, /前置知识、后续知识/u);
  assert.match(prompt, /小测用 2–3 个 assessment_refs/u);
  assert.equal(AGENT_EDUCATION_UI_SCHEMA.additionalProperties, false);
  assert.equal(AGENT_EDUCATION_UI_SCHEMA.properties.cards.maxItems, 4);
});

test("parser accepts only a complete JSON object and does not extract JSON from prose", () => {
  const payload = {
    ...validResponse([
    { type: "knowledge_point", knowledge_ref: "kp.pythagoras" }
    ]),
    schema_version: LEGACY_AGENT_EDUCATION_UI_VERSION
  };
  assert.deepEqual(parseAgentEducationUiResponse(JSON.stringify(payload)), payload);

  assert.throws(
    () => parseAgentEducationUiResponse(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``),
    (error) =>
      error instanceof AgentEducationUiError &&
      error.code === "agent_education_ui_invalid_json"
  );
  assert.throws(
    () => parseAgentEducationUiResponse(`${JSON.stringify(payload)}\n我还有一段说明`),
    /JSON 对象/u
  );
});

test("validator rejects unknown fields, duplicate types, unknown refs and obvious answer leakage", () => {
  const extraField = validResponse([
    {
      type: "quiz",
      assessment_ref: "assessment.01",
      correct_answer: "A"
    }
  ]);
  let validation = validateAgentEducationUiResponse(extraField);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((item) => item.code === "ADDITIONAL_PROPERTY"));

  const duplicate = validResponse([
    { type: "image", asset_ref: "asset.01" },
    { type: "image", asset_ref: "asset.02" }
  ]);
  validation = validateAgentEducationUiResponse(duplicate);
  assert.ok(validation.errors.some((item) => item.code === "DUPLICATE_CARD_TYPE"));

  const unknown = validResponse([{ type: "mindmap", mindmap_ref: "mindmap.unknown" }]);
  validation = validateAgentEducationUiResponse(unknown, {
    allowedRefs: { mindmaps: ["mindmap.allowed"] }
  });
  assert.ok(validation.errors.some((item) => item.code === "REFERENCE_NOT_ALLOWED"));

  const leaked = {
    ...validResponse([{ type: "quiz", assessment_ref: "assessment.01" }]),
    answer: "正确答案是 A。"
  };
  validation = validateAgentEducationUiResponse(leaked);
  assert.ok(validation.errors.some((item) => item.code === "POSSIBLE_QUIZ_ANSWER_LEAK"));
});

test("validator accepts a bounded mini-test and rejects ambiguous or oversized quiz plans", () => {
  const allowedRefs = {
    knowledge_points: ["kp.pythagoras"],
    knowledge_graphs: ["graph.pythagoras.dependencies"],
    assessments: [
      "assessment.pythagoras.01",
      "assessment.pythagoras.02",
      "assessment.pythagoras.03"
    ]
  };
  let validation = validateAgentEducationUiResponse(
    validResponse([
      { type: "knowledge_summary", knowledge_ref: "kp.pythagoras" },
      {
        type: "quiz",
        assessment_refs: ["assessment.pythagoras.01", "assessment.pythagoras.02"]
      }
    ]),
    { allowedRefs }
  );
  assert.equal(validation.valid, true);

  validation = validateAgentEducationUiResponse(
    validResponse([
      {
        type: "quiz",
        assessment_ref: "assessment.pythagoras.01",
        assessment_refs: ["assessment.pythagoras.01", "assessment.pythagoras.02"]
      }
    ])
  );
  assert.ok(validation.errors.some((item) => item.code === "QUIZ_REFERENCE_SHAPE"));

  validation = validateAgentEducationUiResponse(
    validResponse([
      {
        type: "quiz",
        assessment_refs: ["assessment.pythagoras.01", "assessment.pythagoras.01"]
      }
    ])
  );
  assert.ok(validation.errors.some((item) => item.code === "DUPLICATE_REFERENCE"));

  validation = validateAgentEducationUiResponse(
    validResponse([
      { type: "knowledge_summary", knowledge_ref: "kp.pythagoras" },
      { type: "knowledge_graph", graph_ref: "graph.pythagoras.dependencies" },
      {
        type: "quiz",
        assessment_refs: [
          "assessment.pythagoras.01",
          "assessment.pythagoras.02",
          "assessment.pythagoras.03"
        ]
      }
    ])
  );
  assert.ok(validation.errors.some((item) => item.code === "MAX_RENDERED_CARDS"));

  validation = validateAgentEducationUiResponse(
    validResponse([
      { type: "knowledge_summary", knowledge_ref: "kp.pythagoras" },
      { type: "knowledge_point", knowledge_ref: "kp.pythagoras" }
    ])
  );
  assert.ok(validation.errors.some((item) => item.code === "DUPLICATE_CARD_TYPE"));
});

test("converter expands canonical summary, graph and mini-test plans into trusted horizontal cards", () => {
  const payload = validResponse([
    { type: "knowledge_summary", knowledge_ref: "kp.pythagoras" },
    { type: "knowledge_graph", graph_ref: "graph.pythagoras.dependencies" },
    {
      type: "quiz",
      assessment_refs: ["assessment.pythagoras.01", "assessment.pythagoras.02"]
    }
  ]);
  const result = convertAgentEducationUiResponse(payload, {
    turnId: "turn_42",
    surfaceId: "agent_text_cards",
    knowledgePoints: {
      "kp.pythagoras": {
        title: "勾股定理",
        summary: "直角三角形三边的数量关系。",
        body: "两条直角边的平方和等于斜边的平方。",
        formula: "a² + b² = c²",
        key_points: ["只适用于直角三角形", "c 是斜边"],
        meta: { eyebrow: "中考数学", badge: "核心定理" },
        sources: [{ title: "2022 年数学课标", citation_id: "curriculum.2022" }]
      }
    },
    assessments: {
      "assessment.pythagoras.01": {
        question_id: "quiz.pythagoras.01",
        title: "基础练习",
        prompt: "直角边为 6 cm 和 8 cm，斜边是多少？",
        options: [
          { id: "A", label: "10 cm" },
          { id: "B", label: "12 cm" },
          { id: "C", label: "14 cm" },
          { id: "D", label: "9 cm" }
        ],
        hint: "代入勾股定理。",
        correct_option_id: "A",
        explanation: "这两个私有字段绝不能进入浏览器。"
      },
      "assessment.pythagoras.02": {
        question_id: "quiz.pythagoras.02",
        title: "基础练习 2",
        prompt: "直角边为 5 cm 和 12 cm，斜边是多少？",
        options: [
          { id: "A", label: "13 cm" },
          { id: "B", label: "17 cm" },
          { id: "C", label: "7 cm" },
          { id: "D", label: "25 cm" }
        ],
        hint: "代入勾股定理。",
        correct_option_id: "A",
        explanation: "这个私有解析也不能进入浏览器。"
      }
    },
    knowledgeGraphs: {
      "graph.pythagoras.dependencies": {
        title: "勾股定理前后置与关联知识",
        root: "勾股定理",
        branches: [
          { id: "before", title: "前置知识", children: ["平方与平方根", "直角三角形"] },
          { id: "related", title: "直接关联", children: ["勾股定理逆定理"] },
          { id: "after", title: "后续应用", children: ["坐标距离", "最短路径"] }
        ],
        meta: { eyebrow: "知识图谱", badge: "关联图" }
      }
    }
  });

  assert.equal(result.answer, payload.answer);
  assert.equal(result.layout, "horizontal");
  assert.equal(result.cards.length, 4);
  assert.deepEqual(
    result.cards.map((card) => card.type),
    ["knowledge.explanation", "knowledge.mindmap", "quiz.single-choice", "quiz.single-choice"]
  );
  assert.equal(result.skipped_cards.length, 0);
  assert.equal(result.a2ui.messages.length, 3);

  const update = result.a2ui.messages.find((message) => message.updateComponents);
  assert.equal(
    update.updateComponents.components.find((component) => component.id === "root").component,
    "Row"
  );

  const publicJson = JSON.stringify(result);
  assert.equal(publicJson.includes("correct_option_id"), false);
  assert.equal(publicJson.includes("这两个私有字段"), false);
  assert.equal(publicJson.includes("这个私有解析"), false);
  const quizzes = result.cards.filter((card) => card.type === "quiz.single-choice");
  assert.deepEqual(quizzes.map((card) => card.props.question_id), [
    "quiz.pythagoras.01",
    "quiz.pythagoras.02"
  ]);
  quizzes.forEach((quiz) => {
    assert.equal("correct_answer" in quiz.props, false);
    assert.equal("correct_option" in quiz.props, false);
    assert.equal("explanation" in quiz.props, false);
    assert.equal(quiz.actions.length, 4);
  });
});

test("unknown or unsafe trusted references fail closed per card while preserving the text answer", () => {
  const result = convertAgentEducationUiResponse(
    validResponse([
      { type: "knowledge_point", knowledge_ref: "kp.missing" },
      { type: "image", asset_ref: "asset.unsafe" }
    ]),
    {
      images: {
        "asset.unsafe": {
          title: "不安全图片",
          src: "javascript:alert(1)",
          alt: "不应被展示"
        }
      }
    }
  );

  assert.equal(result.answer, "先回顾核心概念，再做一道练习。");
  assert.equal(result.cards.length, 0);
  assert.deepEqual(
    result.skipped_cards.map((item) => item.code),
    ["REFERENCE_NOT_FOUND", "EDUCATION_CARD_INVALID"]
  );
  const update = result.a2ui.messages.find((message) => message.updateComponents);
  assert.equal(update.updateComponents.components.length, 1);
});

test("an unknown item inside a mini-test is skipped without dropping valid questions", () => {
  const result = convertAgentEducationUiResponse(
    validResponse([
      {
        type: "quiz",
        assessment_refs: ["assessment.allowed", "assessment.missing"]
      }
    ]),
    {
      assessments: {
        "assessment.allowed": {
          question_id: "quiz.allowed",
          title: "可用练习",
          prompt: "请选出正确选项。",
          options: [
            { id: "A", label: "选项一" },
            { id: "B", label: "选项二" }
          ],
          correct_option_id: "A",
          explanation: "私有解析"
        }
      }
    }
  );

  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].props.question_id, "quiz.allowed");
  assert.equal(result.skipped_cards.length, 1);
  assert.equal(result.skipped_cards[0].index, 0);
  assert.equal(result.skipped_cards[0].sub_index, 1);
  assert.equal(result.skipped_cards[0].code, "REFERENCE_NOT_FOUND");
});
