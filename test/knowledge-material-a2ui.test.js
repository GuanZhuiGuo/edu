import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleEducationCards,
  validateEducationCard
} from "../education-card-assembler.js";
import { createKnowledgeMaterialA2UI } from "../knowledge-material-a2ui.js";

const MATERIALS = [
  {
    material_id: "generated_explanation",
    recommended_type: "knowledge.explanation",
    supports_claim_ids: ["claim_force"],
    data: {
      title: "动态讲解标题",
      summary: "动态摘要",
      body: "这是模型校验后的动态讲解正文。",
      formula: "F = ma",
      key_points: ["F 表示合外力", "a 与 F 同向"],
      callout: "先选择研究对象。"
    }
  },
  {
    material_id: "generated_mindmap",
    recommended_type: "knowledge.mindmap",
    supports_claim_ids: ["claim_force"],
    data: {
      title: "动态知识结构",
      root: "牛顿第二定律",
      branches: [
        {
          id: "force",
          title: "合外力",
          children: ["大小", "方向"]
        }
      ]
    }
  },
  {
    material_id: "generated_quiz",
    recommended_type: "quiz.single-choice",
    supports_claim_ids: ["claim_force"],
    data: {
      title: "变量练习",
      question_id: "quiz_dynamic_01",
      prompt: "质量不变，合外力增大时，加速度如何变化？",
      options: [
        { id: "A", value: "A", label: "增大" },
        { id: "B", value: "B", label: "减小" },
        { id: "C", value: "C", label: "不变" },
        { id: "D", value: "D", label: "无法判断" }
      ],
      hint: "固定质量后比较变量。"
    }
  }
];

function hasOwnKeyDeep(value, forbiddenKey) {
  if (Array.isArray(value)) {
    return value.some((item) => hasOwnKeyDeep(item, forbiddenKey));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) =>
      key === forbiddenKey || hasOwnKeyDeep(item, forbiddenKey)
  );
}

test("projects generated materials into trusted EducationCard A2UI messages", () => {
  const result = createKnowledgeMaterialA2UI({
    bundle_id: "bundle_dynamic_01",
    topic: {
      title: "牛顿第二定律",
      subject: "物理",
      grade_band: "初中"
    },
    claims: [
      {
        claim_id: "claim_force",
        text: "物体加速度与合外力成正比。",
        source_support: "加速度与合外力成正比"
      }
    ],
    card_materials: structuredClone(MATERIALS)
  });

  assert.equal(result.contract_version, "1.0");
  assert.equal(result.cards.length, 3);
  assert.deepEqual(
    result.cards.map((card) => card.type),
    [
      "knowledge.explanation",
      "knowledge.mindmap",
      "quiz.single-choice"
    ]
  );
  assert.ok(result.cards.every((card) => validateEducationCard(card).valid));
  assert.ok(result.cards.every((card) =>
    card.meta.parameterization?.mode === "none"
    && card.meta.parameterization?.input_schema?.additionalProperties === false));
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].version, "v0.9");
  assert.equal(
    result.messages[0].createSurface.catalogId,
    "urn:a2ui:catalog:education:1.0"
  );
  assert.equal(result.card_claim_bindings.length, 3);

  const quiz = result.cards.find(
    (card) => card.type === "quiz.single-choice"
  );
  assert.equal(
    quiz.actions[0].payload.grading_source,
    "knowledge.materials"
  );
  assert.equal(
    quiz.actions[0].payload.grade_endpoint,
    "/api/knowledge/materials/grade"
  );
  assert.equal(hasOwnKeyDeep(result, "correct_option"), false);
  assert.equal(hasOwnKeyDeep(result, "correct_answer"), false);
  assert.equal(hasOwnKeyDeep(result, "answer_key"), false);
});

test("the shared assembler uses dynamic candidate data instead of static fixtures", () => {
  const candidates = structuredClone(MATERIALS.slice(0, 2));
  const result = assembleEducationCards({
    retrieval: {
      status: "matched",
      artifact_id: "artifact_dynamic",
      evidence: [],
      matches: [
        {
          claims: [
            {
              claim_id: "claim_force",
              text: "物体加速度与合外力成正比。"
            }
          ],
          presentation_candidates: candidates
        }
      ]
    },
    requestedCardTypes: [
      "knowledge.explanation",
      "knowledge.mindmap"
    ],
    turnId: "turn_dynamic"
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[0].props.title, "动态讲解标题");
  assert.equal(result.cards[0].meta.parameterization.mode, "none");
  assert.deepEqual(result.cards[0].props.key_points, [
    "F 表示合外力",
    "a 与 F 同向"
  ]);
  assert.equal(result.cards[1].props.title, "动态知识结构");
  assert.equal(result.cards[1].props.branches[0].title, "合外力");
});
