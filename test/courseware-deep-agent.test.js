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
  assert.equal(shouldUseDeepAgent({
    prompt: "请按照图片制作一个互动函数图。",
    requested_type: "function_graph",
    image: { mime_type: "image/png", data: Buffer.from("image-bytes").toString("base64") },
  }), true);
});

test("an attached image uses multimodal Deep Agent planning even with a fixed executor", async () => {
  let invocation;
  const agent = createCoursewareDeepAgent({
    runtimeSettings: runtimeSettings(),
    env: { COURSEWARE_DEEP_AGENT_MODE: "auto" },
    createModel: () => ({}),
    createDeepAgentImpl(args) {
      return {
        async invoke(input) {
          invocation = input;
          await args.tools[0].invoke({
            title: "函数图参考样式",
            recommended_type: "function_graph",
            subject: "数学",
            goal_summary: "理解参考图的函数与视觉结构后生成互动函数图。",
            rationale: "图片是必要的视觉参考。",
            steps: ["识别图片", "生成交互", "检查结果"],
          });
          return { messages: [] };
        },
      };
    },
  });

  const result = await agent.plan({
    prompt: "请参考这张图的结构制作互动函数图。",
    requested_type: "function_graph",
    image: { mime_type: "image/png", data: Buffer.from("image-bytes").toString("base64"), name: "参考图.png" },
  });

  assert.equal(result.engine, "langchain_deepagents_js");
  assert.equal(result.plan.recommended_type, "function_graph");
  assert.ok(Array.isArray(invocation.messages[0].content));
  assert.match(invocation.messages[0].content[1].image_url.url, /^data:image\/png;base64,/u);
});

test("fixed production constraints reject an Agent plan that changes the executor", async () => {
  const agent = createCoursewareDeepAgent({
    runtimeSettings: runtimeSettings(),
    env: { COURSEWARE_DEEP_AGENT_MODE: "auto" },
    createModel: () => ({}),
    createDeepAgentImpl(args) {
      return {
        async invoke() {
          await args.tools[0].invoke({
            title: "不符合约束的计划",
            recommended_type: "mindmap",
            subject: "数学",
            goal_summary: "试图改变教师选定的交付类型。",
            rationale: "测试约束校验。",
            steps: ["规划", "生成"],
          });
          return { messages: [] };
        },
      };
    },
  });

  await assert.rejects(
    agent.plan({
      prompt: "请按参考图制作互动函数图。",
      requested_type: "function_graph",
      image: { mime_type: "image/png", data: Buffer.from("image-bytes").toString("base64") },
    }),
    (error) => error instanceof CoursewareDeepAgentError
      && error.code === "courseware_plan_constraint_violated"
      && error.status === 502,
  );
});

test("image-only planning fails closed when multimodal planning is disabled", async () => {
  const agent = createCoursewareDeepAgent({
    runtimeSettings: runtimeSettings(),
    env: { COURSEWARE_DEEP_AGENT_MODE: "off" },
  });

  await assert.rejects(
    agent.plan({
      prompt: "请根据这张参考图制作课件。",
      requested_type: "auto",
      image: { mime_type: "image/png", data: Buffer.from("image-bytes").toString("base64") },
    }),
    (error) => error instanceof CoursewareDeepAgentError
      && error.code === "courseware_deep_agent_disabled_for_image"
      && error.status === 503,
  );
});
