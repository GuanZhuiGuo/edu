import test from "node:test";
import assert from "node:assert/strict";
import { createPiTeachingAgent } from "../pi-teaching-agent.js";

class FakeAgent {
  constructor(options) {
    this.options = options;
    this.state = { errorMessage: "", tools: options.initialState.tools };
    this.listeners = [];
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((item) => item !== listener); };
  }

  abort() {}

  async prompt(text, images) {
    this.promptText = text;
    this.promptImages = images;
    for (const listener of this.listeners) listener({ type: "agent_start" });
    for (const listener of this.listeners) listener({ type: "turn_start" });
    const tool = this.state.tools[0];
    for (const listener of this.listeners) {
      listener({ type: "tool_execution_start", toolName: tool.name, toolCallId: "call_1" });
    }
    await tool.execute("call_1", fixtureLesson());
    for (const listener of this.listeners) {
      listener({ type: "tool_execution_end", toolName: tool.name, toolCallId: "call_1", isError: false });
    }
  }
}

test("Pi teaching agent publishes a validated Lesson DSL through its only tool", async () => {
  const service = createPiTeachingAgent({
    env: {
      ARK_API_KEY: "test-key",
      ARK_EDUCATION_BASE_URL: "https://ark.example.test/api/v3",
      ARK_EDUCATION_VISION_MODEL: "test-vision-model",
    },
    AgentClass: FakeAgent,
    stream: () => { throw new Error("fake agent must not call the provider stream"); },
  });
  const result = await service.generate({
    subject: "物理",
    grade_band: "八年级",
    knowledge_point: "抛体运动",
    learning_goal: "理解发射角对射程和高度的影响",
  });

  assert.equal(result.lesson.artifact_type, "projectile_lab");
  assert.equal(result.lesson.visualization.preset, "projectile");
  assert.equal(result.agent.framework, "Pi Agent");
  assert.ok(result.trace.some((item) => item.stage === "dsl.validated"));
});

function fixtureLesson() {
  return {
    title: "抛体运动参数实验",
    subtitle: "改变初速度和发射角，观察运动轨迹",
    subject: "物理",
    grade_band: "八年级",
    knowledge_point: "抛体运动",
    artifact_type: "projectile_lab",
    explanation: "理想抛体运动可以分解为水平匀速运动与竖直匀变速运动。",
    learning_objectives: ["理解速度分解", "观察发射角对射程的影响"],
    key_points: ["水平方向速度保持不变", "竖直方向受重力加速度"],
    misconception: "轨迹变高不代表射程一定更远。",
    guidance: {
      prediction_prompt: "预测发射角从 30° 变为 45° 后的变化。",
      observation_prompt: "保持初速度不变，比较不同发射角的轨迹。",
      transfer_question: "在其他条件不变时，哪个角度射程最大？",
    },
    visualization: {
      preset: "projectile",
      parameters: { initial_speed: 20, angle: 45, gravity: 9.8 },
    },
  };
}
