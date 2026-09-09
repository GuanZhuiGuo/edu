import assert from "node:assert/strict";
import test from "node:test";

import {
  EDUCATION_IMAGE_TASK_DECISION_VERSION,
  createEducationImageTaskIntentResolver,
  normalizeEducationImageTaskMode,
} from "../education-image-task-intent.js";

const IMAGE = Object.freeze({ mime_type: "image/png", data: "aGVsbG8=" });

test("explicit solve and grade modes are deterministic and never call the model", async () => {
  let calls = 0;
  const resolver = createEducationImageTaskIntentResolver({
    modelClient: {
      configSummary: () => ({ configured: true, visionModel: "vision-test" }),
      async chatCompletion() {
        calls += 1;
        throw new Error("must not be called");
      },
    },
  });

  const solve = await resolver.resolve({ requestedMode: "solve", image: IMAGE });
  const grade = await resolver.resolve({ requestedMode: "grade", image: IMAGE });

  assert.equal(solve.schema_version, EDUCATION_IMAGE_TASK_DECISION_VERSION);
  assert.equal(solve.status, "resolved");
  assert.equal(solve.resolved_mode, "solve");
  assert.equal(solve.decision_source, "user_explicit");
  assert.equal(grade.resolved_mode, "grade");
  assert.equal(calls, 0);
});

test("auto mode sends image and text through a strict multimodal intent schema", async () => {
  let request = null;
  const resolver = createEducationImageTaskIntentResolver({
    modelClient: {
      configSummary: () => ({ configured: true, visionModel: "vision-test" }),
      async chatCompletion(input) {
        request = input;
        return {
          text: JSON.stringify({
            intent: "grade",
            confidence: 0.94,
            basis: "图片中可见多道已完成的手写答案",
            observed_signals: ["completed_answers_visible", "multiple_answer_regions"],
          }),
        };
      },
    },
  });

  const decision = await resolver.resolve({
    requestedMode: "auto",
    message: "帮我看看做得对不对",
    image: IMAGE,
  });

  assert.equal(decision.status, "resolved");
  assert.equal(decision.resolved_mode, "grade");
  assert.equal(decision.decision_source, "vision_model");
  assert.equal(request.messages[1].content[1].type, "image_url");
  assert.equal(request.messages[1].content[1].image_url.url, "data:image/png;base64,aGVsbG8=");
  assert.equal(request.responseFormat.type, "json_schema");
  assert.deepEqual(
    request.responseFormat.json_schema.schema.properties.intent.enum,
    ["solve", "grade", "uncertain"],
  );
});

test("auto mode fails closed to clarification for uncertainty, low confidence, or model failure", async () => {
  const outputs = [
    {
      intent: "uncertain",
      confidence: 0.9,
      basis: "只看到一道题，无法确认是否需要批改",
      observed_signals: ["insufficient_context"],
    },
    {
      intent: "solve",
      confidence: 0.52,
      basis: "题目和手写答案均不清晰",
      observed_signals: ["unclear_image"],
    },
  ];
  const modelClient = {
    configSummary: () => ({ configured: true, visionModel: "vision-test" }),
    async chatCompletion() {
      const value = outputs.shift();
      if (!value) throw new Error("provider down");
      return { text: JSON.stringify(value) };
    },
  };
  const resolver = createEducationImageTaskIntentResolver({ modelClient });

  for (let index = 0; index < 3; index += 1) {
    const decision = await resolver.resolve({ requestedMode: "auto", image: IMAGE });
    assert.equal(decision.status, "clarify");
    assert.equal(decision.resolved_mode, null);
    assert.deepEqual(decision.clarification.options.map((item) => item.id), ["solve", "grade"]);
  }
});

test("invalid modes and unsafe image inputs are rejected before any model call", async () => {
  assert.throws(
    () => normalizeEducationImageTaskMode("both"),
    (error) => error.code === "image_task_mode_invalid" && error.status === 422,
  );
  const resolver = createEducationImageTaskIntentResolver({
    modelClient: {
      configSummary: () => ({ configured: true, visionModel: "vision-test" }),
      async chatCompletion() { throw new Error("must not be called"); },
    },
  });
  await assert.rejects(
    resolver.resolve({
      requestedMode: "auto",
      image: { mime_type: "text/html", data: "PHNjcmlwdD4=" },
    }),
    (error) => error.code === "image_task_image_type_invalid",
  );
});
