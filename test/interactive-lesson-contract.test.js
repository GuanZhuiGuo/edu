import test from "node:test";
import assert from "node:assert/strict";
import {
  InteractiveLessonContractError,
  normalizeInteractiveLessonDsl,
  validateInteractiveLessonRequest,
} from "../interactive-lesson-contract.js";

test("normalizes a controlled quadratic lesson without executable code", () => {
  const request = validateInteractiveLessonRequest({
    subject: "数学",
    grade_band: "九年级",
    knowledge_point: "二次函数",
    learning_goal: "理解参数对图像的影响",
  });
  const lesson = normalizeInteractiveLessonDsl({
    title: "二次函数参数实验",
    subtitle: "拖动参数并观察抛物线的变化",
    subject: "数学",
    grade_band: "九年级",
    knowledge_point: "二次函数",
    artifact_type: "function_graph",
    explanation: "二次函数的系数共同决定抛物线的形状和位置。",
    learning_objectives: ["理解开口方向", "理解对称轴"],
    key_points: ["a 决定开口", "c 决定 y 轴交点"],
    guidance: {
      prediction_prompt: "预测 a 变为负数后的图像。",
      observation_prompt: "拖动参数并观察图像。",
      transfer_question: "经过原点时哪个参数为零？",
    },
    visualization: {
      preset: "quadratic",
      parameters: { a: 99, b: 1, c: -1 },
    },
  }, request);

  assert.equal(lesson.subject, "数学");
  assert.equal(lesson.visualization.parameters.a, 8);
  assert.equal(lesson.runtime.executable_model_code, false);
  assert.equal(lesson.parameterization.mode, "bounded");
  assert.deepEqual(
    Object.keys(lesson.parameterization.input_schema.properties),
    ["a", "b", "c"],
  );
  assert.equal(
    lesson.parameterization.runtime.renderer,
    "deterministic-lesson-player",
  );
  assert.deepEqual(lesson.visualization.nodes, []);
});

test("rejects an artifact and preset mismatch", () => {
  assert.throws(
    () => normalizeInteractiveLessonDsl({
      title: "错误示例",
      subtitle: "这个示例的预设与载体不匹配",
      subject: "物理",
      grade_band: "八年级",
      knowledge_point: "抛体运动",
      artifact_type: "projectile_lab",
      explanation: "抛体运动同时包含水平与竖直方向的运动。",
      learning_objectives: ["理解轨迹"],
      key_points: ["水平速度不变", "竖直方向受重力"],
      guidance: {
        prediction_prompt: "预测角度增大后的轨迹。",
        observation_prompt: "改变角度并观察射程。",
        transfer_question: "什么角度的射程最大？",
      },
      visualization: { preset: "concept_map" },
    }),
    (error) => error instanceof InteractiveLessonContractError
      && error.code === "lesson_preset_mismatch",
  );
});

test("validates multimodal image boundaries", () => {
  const request = validateInteractiveLessonRequest({
    subject: "物理",
    grade_band: "八年级",
    knowledge_point: "运动轨迹",
    learning_goal: "从图片中识别轨迹特征",
    image: { mime_type: "image/png", data: "aGVsbG8=" },
  });
  assert.equal(request.image.mime_type, "image/png");
  assert.equal(request.image.data, "aGVsbG8=");
});
