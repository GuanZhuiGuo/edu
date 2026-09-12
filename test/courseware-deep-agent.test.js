import test from "node:test";
import assert from "node:assert/strict";
import {
  CoursewareDeepAgentError,
  createCoursewareDeepAgent,
  shouldUseDeepAgent,
} from "../courseware-deep-agent.js";

function runtimeSettings(config = {}) {
  return {
    getModelConfig() {
      return {
        api_key: "test-secret",
        endpoint: "https://example.test/api/v3",
        model: "test-model",
        timeout_ms: 20_000,
        ...config,
      };
    },
  };
}

test("simple courseware requests stay on the deterministic domain router", async () => {
  let modelCalls = 0;
  let agentCalls = 0;
  const agent = createCoursewareDeepAgent({
    runtimeSettings: runtimeSettings(),
    env: { COURSEWARE_DEEP_AGENT_MODE: "auto" },
    createModel() { modelCalls++; return {}; },
    createDeepAgentImpl() { agentCalls++; return { invoke: async () => ({}) }; },
  });

  const result = await agent.plan({
    prompt: "直角三角形勾股关系：调节两条直角边并比较三个正方形面积。",
    requested_type: "auto",
  });

  assert.equal(result.engine, "deterministic_domain_router");
  assert.equal(result.plan.recommended_type, null);
  assert.equal(modelCalls, 0);
  assert.equal(agentCalls, 0);
});

test("a complex request is planned by Deep Agents JS through the controlled commit tool", async () => {
  let createArgs;
  const agent = createCoursewareDeepAgent({
    runtimeSettings: runtimeSettings(),
    env: { COURSEWARE_DEEP_AGENT_MODE: "auto" },
    createModel(config) { assert.equal(config.api_key, "test-secret"); return { kind: "fake-model" }; },
    createDeepAgentImpl(args) {
      createArgs = args;
      return {
        async invoke(_input, options) {
          assert.match(options.configurable.thread_id, /^[a-f0-9-]{20,}$/u);
          await args.tools[0].invoke({
            title: "牛顿运动定律互动课堂",
            recommended_type: "openmaic",
            subject: "物理",
            goal_summary: "生成包含概念讲解、参数实验和迁移练习的完整互动课堂。",
            rationale: "需求包含多种载体与连续课堂结构，适合按场景组织。",
            steps: ["拆分课堂目标", "规划讲解与实验", "生成场景", "检查交付"],
          });
          return { messages: [] };
        },
      };
    },
  });

  const result = await agent.plan({
    prompt: "制作一整套牛顿运动定律互动课堂，包含概念讲解、可调参数实验、课堂提问和迁移练习。",
    requested_type: "auto",
  });

  assert.equal(result.engine, "langchain_deepagents_js");
  assert.equal(result.plan.recommended_type, "openmaic");
  assert.equal(result.plan.subject, "物理");
  assert.equal(createArgs.tools.length, 1);
  assert.equal(createArgs.tools[0].name, "commit_courseware_plan");
  assert.equal(createArgs.checkpointer.constructor.name, "MemorySaver");
  assert.match(createArgs.systemPrompt, /不得调用 shell/u);
});

test("configuration, missing commit and provider failures are public and bounded", async () => {
  const unconfigured = createCoursewareDeepAgent({
    runtimeSettings: runtimeSettings({ api_key: "" }),
    env: { COURSEWARE_DEEP_AGENT_MODE: "always" },
  });
  await assert.rejects(
    unconfigured.plan({ prompt: "制作一整套跨载体课堂课件。", requested_type: "auto" }),
    (error) => error instanceof CoursewareDeepAgentError && error.code === "courseware_deep_agent_not_configured" && error.status === 503,
  );

  const noCommit = createCoursewareDeepAgent({
    runtimeSettings: runtimeSettings(),
    env: { COURSEWARE_DEEP_AGENT_MODE: "always" },
    createModel: () => ({}),
    createDeepAgentImpl: () => ({ invoke: async () => ({ messages: [] }) }),
  });
  await assert.rejects(
    noCommit.plan({ prompt: "制作一整套跨载体课堂课件。", requested_type: "auto" }),
    (error) => error.code === "courseware_deep_agent_no_plan" && error.status === 502,
  );

  const failed = createCoursewareDeepAgent({
    runtimeSettings: runtimeSettings(),
    env: { COURSEWARE_DEEP_AGENT_MODE: "always" },
    createModel: () => ({}),
    createDeepAgentImpl: () => ({ invoke: async () => { throw new Error("private provider detail"); } }),
  });
  await assert.rejects(
    failed.plan({ prompt: "制作一整套跨载体课堂课件。", requested_type: "auto" }),
    (error) => error.code === "courseware_deep_agent_failed" && !error.message.includes("private provider detail"),
  );
});

test("complexity routing requires automatic selection and multiple-task signals", () => {
  assert.equal(shouldUseDeepAgent({ prompt: "制作一整套物理互动课堂与讲解视频。", requested_type: "auto" }), true);
  assert.equal(shouldUseDeepAgent({ prompt: "制作一整套物理互动课堂与讲解视频。", requested_type: "video" }), false);
  assert.equal(shouldUseDeepAgent({ prompt: "制作一个可调参数的二次函数实验。", requested_type: "auto" }), false);
});
