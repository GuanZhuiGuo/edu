import test from "node:test";
import assert from "node:assert/strict";
import {
  InteractiveLessonContractError,
  normalizeInteractiveLessonDsl,
  validateInteractiveLessonRequest,
} from "../interactive-lesson-contract.js";
import { createPiTeachingAgent } from "../pi-teaching-agent.js";

const request = {
  subject: "物理", grade_band: "八年级", knowledge_point: "斜面与摩擦",
  preferred_artifact: "physics_lab",
};

function fixture(preset = "inclined_plane", parameters) {
  return {
    title: "物理参数实验", subtitle: "改变参数并比较实验结果", subject: "物理",
    grade_band: "八年级", knowledge_point: "斜面与摩擦", artifact_type: "physics_lab",
    explanation: "通过控制变量，比较物体在不同实验条件下的运动。",
    learning_objectives: ["理解参数对运动的影响"],
    key_points: ["先预测结果再开始实验", "每次只改变一个实验参数"],
    guidance: {
      prediction_prompt: "预测改变参数后物体的运动。",
      observation_prompt: "改变参数并比较两次实验结果。",
      transfer_question: "如何设计一个实验验证你的解释？",
    },
    visualization: { preset, ...(parameters === undefined ? {} : { parameters }) },
  };
}

function contractFailure(code, path) {
  return (error) => error instanceof InteractiveLessonContractError
    && error.code === code && (!path || error.path === path);
}

test("physics requests default to auto and reject unsupported engines or presets", () => {
  assert.equal(validateInteractiveLessonRequest(request).physics_engine, "auto");
  assert.throws(() => validateInteractiveLessonRequest({ ...request, physics_engine: "javascript" }),
    contractFailure("lesson_enum_invalid", "physics_engine"));
  assert.throws(() => validateInteractiveLessonRequest({ ...request, physics_preset: "arbitrary_scene" }),
    contractFailure("lesson_enum_invalid", "physics_preset"));
});

test("each physics preset produces bounded parameters and the appropriate default engine", () => {
  const cases = [
    ["inclined_plane", "matter", { angle: 30, friction: 0.1, gravity: 9.8, mass: 1 }],
    ["pendulum", "matter", { length: 1.5, angle: 25, gravity: 9.8, mass: 1 }],
    ["collision", "planck", { mass: 1, mass_b: 1, initial_speed: 3, restitution: 0.9 }],
  ];
  for (const [preset, engine, parameters] of cases) {
    const lesson = normalizeInteractiveLessonDsl(fixture(preset), validateInteractiveLessonRequest(request));
    assert.equal(lesson.visualization.engine, engine);
    assert.deepEqual(lesson.visualization.parameters, parameters);
    assert.equal(lesson.parameterization.mode, "bounded");
    assert.deepEqual(Object.keys(lesson.parameterization.input_schema.properties), Object.keys(parameters));
    assert.equal(lesson.runtime.executable_model_code, false);
    assert.equal(lesson.runtime.physics_engine, engine);
  }
});

test("requested physics engine and preset remain authoritative over model output", () => {
  const input = fixture("pendulum");
  input.visualization.engine = "matter";
  const lesson = normalizeInteractiveLessonDsl(input, {
    ...request, physics_engine: "planck", physics_preset: "pendulum",
  });
  assert.equal(lesson.visualization.engine, "planck");
  assert.throws(() => normalizeInteractiveLessonDsl(input, { ...request, physics_preset: "collision" }),
    contractFailure("lesson_preset_mismatch", "visualization.preset"));
  input.visualization.engine = "custom_code";
  assert.throws(() => normalizeInteractiveLessonDsl(input, { ...request, physics_engine: "matter" }),
    contractFailure("lesson_enum_invalid", "visualization.engine"));
});

test("auto engine selection follows the experiment, even if the model suggests a different engine", () => {
  const input = fixture("collision");
  input.visualization.engine = "matter";
  assert.equal(normalizeInteractiveLessonDsl(input, validateInteractiveLessonRequest(request)).visualization.engine, "planck");
});

test("physics validation rejects unsafe values and parameters outside the selected preset", () => {
  for (const [preset, key, value] of [
    ["inclined_plane", "angle", 61], ["inclined_plane", "friction", -0.1],
    ["pendulum", "length", 0.4], ["pendulum", "gravity", 21],
    ["collision", "initial_speed", 8.1], ["collision", "mass_b", 0.1],
    ["collision", "restitution", 1.1], ["pendulum", "mass", Infinity],
    ["inclined_plane", "mass", null], ["pendulum", "angle", "30"],
  ]) {
    assert.throws(() => normalizeInteractiveLessonDsl(fixture(preset, { [key]: value }), request),
      contractFailure("lesson_parameter_invalid", `visualization.parameters.${key}`));
  }
  for (const parameter of [{ code: "alert(1)" }, { initial_speed: 3 }]) {
    assert.throws(() => normalizeInteractiveLessonDsl(fixture("pendulum", parameter), request),
      contractFailure("lesson_parameter_unknown"));
  }
});

test("physics accepts legal endpoints and exposes preset-specific bounds without changing projectile limits", () => {
  const lesson = normalizeInteractiveLessonDsl(fixture("collision", {
    initial_speed: 0.5, restitution: 0, mass: 0.2, mass_b: 5,
  }), request);
  assert.equal(lesson.visualization.parameters.initial_speed, 0.5);
  const properties = lesson.parameterization.input_schema.properties;
  assert.equal(properties.initial_speed.minimum, 0.5);
  assert.equal(properties.initial_speed.maximum, 8);
  const projectile = fixture("projectile", { initial_speed: 100, angle: 85, gravity: 9.8 });
  projectile.artifact_type = "projectile_lab";
  assert.equal(normalizeInteractiveLessonDsl(projectile).visualization.parameters.initial_speed, 60);
  assert.throws(() => normalizeInteractiveLessonDsl(projectile, request),
    contractFailure("lesson_artifact_mismatch", "artifact_type"));
});

test("Pi publish tool and prompts support physics while enforcing the requested engine", async () => {
  let options;
  let prompt;
  class PhysicsAgent {
    constructor(input) { options = input; this.state = { errorMessage: "" }; }
    subscribe() { return () => {}; }
    abort() {}
    async prompt(text) {
      prompt = text;
      const lesson = fixture("collision", { initial_speed: 2 });
      lesson.visualization.engine = "matter";
      await options.initialState.tools[0].execute("physics_1", lesson);
    }
  }
  const service = createPiTeachingAgent({ env: { ARK_API_KEY: "test-only" }, AgentClass: PhysicsAgent,
    stream: () => { throw new Error("Test must never call a paid provider"); } });
  const result = await service.generate({ ...request, physics_engine: "planck", physics_preset: "collision" });
  assert.equal(result.lesson.visualization.engine, "planck");
  assert.equal(result.lesson.visualization.parameters.initial_speed, 2);
  assert.ok(result.trace.some((item) => item.stage === "dsl.validated"));
  assert.match(prompt, /<physics_engine>planck<\/physics_engine>/u);
  assert.match(prompt, /<physics_preset>collision<\/physics_preset>/u);
  assert.match(options.initialState.systemPrompt, /禁止代码、表达式和未知参数/u);
  const schema = options.initialState.tools[0].parameters;
  assert.ok(schema.properties.artifact_type.anyOf.some((item) => item.const === "physics_lab"));
  assert.deepEqual(schema.properties.visualization.properties.engine.anyOf.map((item) => item.const), ["matter", "planck"]);
  assert.deepEqual(service.configSummary().supportedPhysicsPresets, ["inclined_plane", "pendulum", "collision"]);
  assert.ok(!JSON.stringify(service.configSummary()).includes("test-only"));
});
