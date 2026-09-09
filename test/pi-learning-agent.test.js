import assert from "node:assert/strict";
import test from "node:test";

import {
  PI_LEARNING_TEACHING_PACKAGE_VERSION,
  PiLearningAgentError,
  createPiLearningAgent,
} from "../pi-learning-agent.js";
import { createKnowledgeCardParameterization } from "../public/knowledge-card-parameter-contract.js";

function turn(overrides = {}) {
  return {
    skill: "knowledge_tutor",
    message: "一次函数的图象和性质有什么特点？",
    authority: {
      tenant_id: "tenant-school-1",
      user_id: "student-1",
      principal_id: "student-1",
      principal_ids: ["student-1", "course-members"],
      session_id: "session-1",
      turn_id: "turn-1",
      request_id: "request-1",
      idempotency_key: "idem-1",
    },
    courseScope: {
      course_id: "course-junior-math",
      corpus_id: "corpus-junior-math",
      namespace_id: "organization_course",
      loaded_materials: [{
        material_id: "MOE-MATH-2022",
        title: "义务教育数学课程标准（2022年版）",
        publisher: "北京师范大学出版社",
      }],
      allowed_card_refs: [],
    },
    ...overrides,
  };
}

function retrievedReceipt() {
  return {
    schema_version: "education-hybrid-retrieval-receipt@1.0",
    status: "retrieved",
    code: "ok",
    retrieval_mode: "hybrid_rrf",
    retrieval_degraded: false,
    active_release_id: "release-1",
    hits: [{
      id: "vector-1",
      record_id: "M4-NA-FUN-02",
      entity_type: "knowledge_unit",
      title: "一次函数的图象和性质",
      content: "一次函数 y=kx+b（k≠0）的图象是一条直线。",
      score: 0.95,
      source_anchor: { document_id: "MOE-MATH-2022", printed_page: "57" },
    }],
    graph: { nodes: [], relationships: [] },
  };
}

test("local fallback reason survives into grounding, round receipts and persisted runtime spans", async () => {
  const events = [];
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => ({
      ...retrievedReceipt(),
      code: "reviewed_local_ontology",
      retrieval_mode: "reviewed_local_ontology_fallback",
      retrieval_degraded: true,
      fallback: { from: "hybrid_rrf", reason_code: "remote_unavailable" },
    }) },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async () => [],
    AgentClass: fakeAgentClass(async (agent) => {
      for (const listener of agent.listeners) await listener({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: basePublished().answer },
      });
    }),
    stream: () => { throw new Error("must not call a real provider"); },
  });
  const result = await service.runTurn(turn(), { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "answered");
  assert.equal(result.grounding.fallback.reason_code, "remote_unavailable");
  assert.deepEqual(result.grounding.retrieval_rounds[0].fallback_reason_codes, ["remote_unavailable"]);
  const span = events.find((event) => event.type === "span_end" && event.span_key === "retrieval.round1");
  assert.equal(span.status, "success", "the reviewed local result remains successful");
  assert.equal(span.output.retrieval_degraded, true);
  assert.deepEqual(span.output.fallback_reason_codes, ["remote_unavailable"]);
  assert.deepEqual(span.output.retrieval_modes, ["reviewed_local_ontology_fallback"]);
});

function fakeAgentClass(handler) {
  return class FakeAgent {
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
      await handler(this, { text, images });
    }
  };
}

function basePublished(overrides = {}) {
  return {
    status: "answered",
    answer: "一次函数的图象是一条直线，k 决定倾斜方向和程度，b 决定与 y 轴的交点。",
    knowledge_selections: [{ candidate_id: "candidate.kp.1", role: "primary", confidence: 0.97 }],
    solution_steps: [],
    card_refs: ["visual:M4-NA-FUN-02"],
    mastery_evidence_proposals: [],
    ...overrides,
  };
}

function findTool(agent, name) {
  const tool = agent.state.tools.find((item) => item.name === name);
  assert.ok(tool, `expected ${name} to be exposed`);
  return tool;
}

function linearCardParameterization() {
  return createKnowledgeCardParameterization({
    renderer: "junior-math-controlled",
    templateId: "linear:linear_slope_intercept",
    cardType: "interactive_visual",
    parameters: [
      { key: "slope", label: "斜率", control: "range", min: -4, max: 4, step: 0.5, default: 1.5 },
      { key: "intercept", label: "截距", control: "range", min: -5, max: 5, step: 0.5, default: 1 },
    ],
  });
}

test("model card slots are validated and projected as a trusted visual instance", async () => {
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async ({ candidates }) => [{
      ref: "visual:M4-NA-FUN-02",
      type: "interactive_visual",
      knowledge_point_id: candidates[0].knowledge_point_id,
      parameterization: linearCardParameterization(),
    }],
    AgentClass: fakeAgentClass(async (agent) => {
      await findTool(agent, "retrieve_loaded_course_knowledge").execute("call-r", { query: "斜率为2截距为-1的一次函数" });
      await findTool(agent, "publish_grounded_teaching_package").execute("call-p", basePublished({
        card_inputs: [{
          ref: "visual:M4-NA-FUN-02",
          values: { slope: 2, intercept: -1 },
        }],
        solution_steps: ["把斜率和截距代入一次函数模板。"],
      }));
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({
    skill: "photo_solver",
    image: { mime_type: "image/png", data: "aGVsbG8=" },
  }));

  assert.deepEqual(result.cards[0].input_values, { slope: 2, intercept: -1 });
  assert.equal(result.cards[0].parameterization.mode, "bounded");
  assert.equal(result.cards[0].source, "trusted_registry");
});

test("knowledge tutor preloads one scoped retrieval and streams a server-bound grounded answer", async () => {
  const retrievalCalls = [];
  const streamEvents = [];
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: {
      search: async (input) => {
        retrievalCalls.push(input);
        return retrievedReceipt();
      },
    },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async ({ candidates }) => [{
      ref: "visual:M4-NA-FUN-02",
      type: "interactive_visual",
      knowledge_point_id: candidates[0].knowledge_point_id,
    }],
    AgentClass: fakeAgentClass(async (agent) => {
      assert.equal(agent.options.initialState.model.reasoning, true);
      assert.equal(agent.options.initialState.model.compat.thinkingFormat, "deepseek");
      assert.match(agent.options.initialState.systemPrompt, /只能执行服务端已发布的 Skill/u);
      assert.match(agent.options.initialState.systemPrompt, /当前 Skill：knowledge_tutor/u);
      assert.match(agent.options.initialState.systemPrompt, /服务端已在模型调用前执行：retrieve_loaded_course_knowledge/u);
      assert.match(agent.options.initialState.systemPrompt, /本轮输出模式：受控知识正文/u);
      assert.doesNotMatch(agent.options.initialState.systemPrompt, /search_reviewed_questions/u);
      assert.doesNotMatch(agent.options.initialState.systemPrompt, /最后必须且只能调用 publish_grounded_teaching_package/u);
      assert.deepEqual(agent.state.tools, []);
      assert.match(agent.promptText || "", /SERVER_RETRIEVAL_CONTEXT/u);
      for (const listener of agent.listeners) {
        await listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: basePublished().answer,
          },
        });
      }
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn(), {
    onEvent: (event) => streamEvents.push(event),
  });

  assert.equal(result.schema_version, PI_LEARNING_TEACHING_PACKAGE_VERSION);
  assert.equal(result.status, "answered");
  assert.deepEqual(result.knowledge_point_ids, ["M4-NA-FUN-02"]);
  assert.equal(result.cards[0].ref, "visual:M4-NA-FUN-02");
  assert.equal(result.loaded_materials[0].material_id, "MOE-MATH-2022");
  assert.equal(result.agent.external_agent_used, false);
  assert.equal(result.agent.mastery_written, false);
  assert.deepEqual(result.agent.retrieval, {
    preloaded: true,
    execution_count: 1,
    round_count: 1,
    secondary_retrieval_count: 0,
    secondary_query_count: 0,
    candidate_count: 1,
    initial_route: "grounded_text",
    final_decision: "exact_match",
  });
  assert.deepEqual(result.agent.model_tools, []);
  assert.equal(result.agent.model_token_budget, 800);
  assert.equal(retrievalCalls[0].courseId, "course-junior-math");
  assert.equal(retrievalCalls[0].corpusId, "corpus-junior-math");
  assert.equal(retrievalCalls[0].tenantId, "tenant-school-1");
  assert.equal(retrievalCalls.length, 1);
  assert.ok(streamEvents.some((event) => event.type === "trace" && event.stage === "retrieval.round1.started"));
  const preloadCompletedIndex = streamEvents.findIndex(
    (event) => event.type === "trace" && event.stage === "retrieval.round1.completed",
  );
  const modelRequestedIndex = streamEvents.findIndex(
    (event) => event.type === "trace" && event.stage === "model.requested",
  );
  assert.ok(preloadCompletedIndex >= 0 && preloadCompletedIndex < modelRequestedIndex);
  assert.equal(
    streamEvents.some((event) => event.type === "trace" && event.stage.startsWith("tool.retrieve_loaded_course_knowledge")),
    false,
  );
  const validatedDeltas = streamEvents
    .filter((event) => event.type === "delta")
    .map((event) => event.delta);
  assert.equal(validatedDeltas.join(""), result.answer);
  assert.equal(validatedDeltas.length, 1);
  assert.equal(streamEvents.find((event) => event.type === "delta")?.source, "grounded_model_stream");
  assert.ok(result.agent.display_stream.text_delta_events >= 1);
});

test("grounded text emits a safe prefix before the first full sentence finishes", async () => {
  const streamEvents = [];
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    AgentClass: fakeAgentClass(async (agent) => {
      const chunks = ["一次函数图象是", "一条直线", "，斜率决定增减方向", "。"];
      for (const chunk of chunks) {
        for (const listener of agent.listeners) {
          await listener({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: chunk },
          });
        }
        if (chunk === chunks[1]) {
          assert.equal(streamEvents.some((event) => event.type === "delta"), true);
        }
      }
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn(), {
    onEvent: (event) => streamEvents.push(event),
  });
  assert.equal(streamEvents.filter((event) => event.type === "delta").length > 1, true);
  assert.equal(streamEvents.filter((event) => event.type === "delta").map((event) => event.delta).join(""), result.answer);
  assert.ok(streamEvents.some((event) => event.type === "trace" && event.stage === "model.text.started"));
});

test("grounded text preserves Markdown structure while local cards remain server selected", async () => {
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async ({ candidates }) => [{
      ref: "visual:M4-NA-FUN-02",
      type: "interactive_visual",
      knowledge_point_id: candidates[0].knowledge_point_id,
    }],
    AgentClass: fakeAgentClass(async (agent) => {
      const answer = [
          "## 一次函数的图象",
          "",
          "- **结论**：图象是一条直线。",
          "- 当 \\(k>0\\) 时，\\(y\\) 随 \\(x\\) 增大而增大。",
          "\\[y=kx+b\\]",
          "",
          "<details><summary>点击查看答案与解析</summary>",
          "**答案**：图象是一条直线。",
          "</details>",
        ].join("\n");
      for (const listener of agent.listeners) {
        await listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: answer },
        });
      }
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn());

  assert.match(result.answer, /^## 一次函数的图象\n\n- \*\*结论\*\*/u);
  assert.match(result.answer, /\$k>0\$/u);
  assert.match(result.answer, /\$\$y=kx\+b\$\$/u);
  assert.doesNotMatch(result.answer, /\\(?:\(|\[)/u);
  assert.doesNotMatch(result.answer, /\[visual:/u);
  assert.doesNotMatch(result.answer, /<\/?(?:details|summary)>/u);
  assert.match(result.answer, /### 点击查看答案与解析/u);
  assert.deepEqual(result.cards.map((card) => card.ref), ["visual:M4-NA-FUN-02"]);
});

test("tool-package Skills never expose provider free-form text before grounding validation", async () => {
  const streamEvents = [];
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    AgentClass: fakeAgentClass(async (agent) => {
      for (const listener of agent.listeners) {
        await listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "UNTRUSTED_PROVIDER_TEXT",
          },
        });
      }
      await findTool(agent, "retrieve_loaded_course_knowledge").execute("call-r", { query: "一次函数" });
      await findTool(agent, "publish_grounded_teaching_package").execute("call-p", basePublished({
        solution_steps: ["根据检索证据完成求解。"],
      }));
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({
    skill: "photo_solver",
    image: { mime_type: "image/png", data: "aGVsbG8=" },
  }), {
    onEvent: (event) => streamEvents.push(event),
  });
  assert.ok(streamEvents.some((event) => event.type === "trace" && event.stage === "model.streaming"));
  assert.equal(
    streamEvents.filter((event) => event.type === "delta").map((event) => event.delta).join(""),
    result.answer,
  );
  assert.doesNotMatch(JSON.stringify(streamEvents), /UNTRUSTED_PROVIDER_TEXT/u);
});

test("streams only the grounded publish answer from Pi toolcall deltas before tool completion", async () => {
  const streamEvents = [];
  const answer = "## 一次函数\n\n一次函数的图象是一条直线。\n当 $k>0$ 时，$y$ 随 $x$ 增大而增大。请观察图像";
  let published = false;
  let searchCount = 0;
  let promptCount = 0;
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => { searchCount += 1; return retrievedReceipt(); } },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async ({ candidates }) => [{
      ref: "visual:M4-NA-FUN-02",
      type: "interactive_visual",
      knowledge_point_id: candidates[0].knowledge_point_id,
    }],
    AgentClass: fakeAgentClass(async (agent) => {
      promptCount += 1;
      assert.equal(searchCount, 0, "photo retrieval must wait for visual understanding");
      await findTool(agent, "retrieve_loaded_course_knowledge").execute("call-r", { query: "一次函数图像" });
      assert.equal(searchCount, 1);
      const partials = [
        "",
        "## 一次函数\n",
        "## 一次函数\n\n一次函数的图象是一条直线。",
        answer,
      ];
      for (const partialAnswer of partials) {
        for (const listener of agent.listeners) {
          await listener({
            type: "message_update",
            message: { role: "assistant", content: [] },
            assistantMessageEvent: {
              type: "toolcall_delta",
              contentIndex: 0,
              partial: {
                content: [{
                  type: "toolCall",
                  name: "publish_grounded_teaching_package",
                  arguments: {
                    status: "answered",
                    knowledge_selections: [{
                      candidate_id: "candidate.kp.1",
                      role: "primary",
                      confidence: 0.97,
                    }],
                    card_refs: ["visual:M4-NA-FUN-02"],
                    answer: partialAnswer,
                  },
                }],
              },
            },
          });
        }
      }
      assert.equal(published, false);
      const publish = findTool(agent, "publish_grounded_teaching_package");
      await publish.execute("call-p", basePublished({
        answer,
        solution_steps: ["识别图像条件。", "依据一次函数性质求解。"],
      }));
      published = true;
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({
    skill: "photo_solver",
    image: { mime_type: "image/png", data: "aGVsbG8=" },
  }), {
    onEvent: (event) => streamEvents.push({ ...event, published }),
  });
  const deltas = streamEvents.filter((event) => event.type === "delta");
  assert.equal(deltas.map((event) => event.delta).join(""), result.answer);
  assert.ok(deltas.some((event) => event.source === "grounded_model_stream" && event.published === false));
  assert.equal(deltas.at(-1).source, "validated_teaching_package");
  assert.doesNotMatch(JSON.stringify(deltas), /candidate_id|card_refs|visual:/u);
  assert.equal(result.agent.display_stream.blocked, false);
  assert.ok(result.agent.display_stream.committed_events >= 1);
  assert.equal(searchCount, 1);
  assert.equal(promptCount, 1);
});

test("rejects a final package that changes the streamed knowledge authorization", async () => {
  const streamEvents = [];
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    AgentClass: fakeAgentClass(async (agent) => {
      await findTool(agent, "retrieve_loaded_course_knowledge").execute("call-r", { query: "一次函数" });
      for (const listener of agent.listeners) {
        await listener({
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: {
            type: "toolcall_delta",
            contentIndex: 0,
            partial: { content: [{
              type: "toolCall",
              name: "publish_grounded_teaching_package",
              arguments: {
                status: "answered",
                knowledge_selections: [{ candidate_id: "candidate.kp.1", role: "primary", confidence: 0.9 }],
                card_refs: [],
                answer: "已通过授权的流式前缀。",
              },
            }] },
          },
        });
      }
      await findTool(agent, "publish_grounded_teaching_package").execute("call-p", basePublished({
        answer: "已通过授权的流式前缀。",
        knowledge_selections: [{ candidate_id: "candidate.kp.1", role: "supporting", confidence: 0.9 }],
        solution_steps: ["依据检索证据完成求解。"],
        card_refs: [],
      }));
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  await assert.rejects(
    service.runTurn(turn({
      skill: "photo_solver",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    }), { onEvent: (event) => streamEvents.push(event) }),
    (error) => error instanceof PiLearningAgentError && error.code === "pi_learning_stream_commit_mismatch",
  );
  assert.equal(streamEvents.some((event) => event.type === "delta"), true);
});

test("rejects a final answer that rewrites an already streamed safe prefix", async () => {
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    AgentClass: fakeAgentClass(async (agent) => {
      await findTool(agent, "retrieve_loaded_course_knowledge").execute("call-r", { query: "一次函数" });
      for (const listener of agent.listeners) {
        await listener({
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: {
            type: "toolcall_delta",
            contentIndex: 0,
            partial: { content: [{
              type: "toolCall",
              name: "publish_grounded_teaching_package",
              arguments: {
                status: "answered",
                knowledge_selections: [{ candidate_id: "candidate.kp.1", role: "primary", confidence: 0.9 }],
                card_refs: [],
                answer: "已经展示给学生的前缀。",
              },
            }] },
          },
        });
      }
      await findTool(agent, "publish_grounded_teaching_package").execute("call-p", basePublished({
        answer: "模型后来改写了完整回答。",
        solution_steps: ["依据检索证据完成求解。"],
        card_refs: [],
      }));
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  await assert.rejects(
    service.runTurn(turn({
      skill: "photo_solver",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    }), { onEvent: () => {} }),
    (error) => error instanceof PiLearningAgentError && error.code === "pi_learning_stream_commit_mismatch",
  );
});

test("photo solver does not stream publish arguments before retrieval grounding or with invented references", async () => {
  const streamEvents = [];
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    AgentClass: fakeAgentClass(async (agent) => {
      const notify = async (candidateId, answer) => {
        for (const listener of agent.listeners) {
          await listener({
            type: "message_update",
            message: { role: "assistant", content: [] },
            assistantMessageEvent: {
              type: "toolcall_delta",
              contentIndex: 0,
              partial: { content: [{
                type: "toolCall",
                name: "publish_grounded_teaching_package",
                arguments: {
                  status: "answered",
                  knowledge_selections: [{ candidate_id: candidateId, role: "primary", confidence: 0.9 }],
                  card_refs: [],
                  answer,
                },
              }] },
            },
          });
        }
      };
      await notify("candidate.kp.1", "检索前不应显示。");
      await findTool(agent, "retrieve_loaded_course_knowledge").execute("call-r", { query: "一次函数" });
      await notify("candidate.invented", "伪造知识不应显示。");
      await findTool(agent, "publish_grounded_teaching_package").execute(
        "call-p",
        basePublished({ answer: "只能显示最终校验回答。", solution_steps: ["依据检索证据完成求解。"] }),
      );
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  await service.runTurn(turn({
    skill: "photo_solver",
    image: { mime_type: "image/png", data: "aGVsbG8=" },
  }), { onEvent: (event) => streamEvents.push(event) });
  const body = streamEvents.filter((event) => event.type === "delta").map((event) => event.delta).join("");
  assert.equal(body, "只能显示最终校验回答。");
  assert.doesNotMatch(body, /检索前|伪造知识/u);
});

test("grounded tutor context exposes only the top human-readable evidence and no internal IDs", async () => {
  let requestedLimit = null;
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: {
      search: async ({ limit }) => {
        requestedLimit = limit;
        return {
          ...retrievedReceipt(),
          hits: Array.from({ length: 12 }, (_, index) => ({
            id: `vector-${index + 1}`,
            record_id: `M4-NA-FUN-${String(index + 1).padStart(2, "0")}`,
            entity_type: "knowledge_unit",
            title: `函数知识点 ${index + 1}`,
            content: "知识证据".repeat(800),
            score: 1 - index * 0.01,
            source_anchor: { document_id: "MOE-MATH-2022", printed_page: String(index + 1) },
          })),
        };
      },
    },
    questionBankRepository: { list: async () => ({ items: [] }) },
    AgentClass: fakeAgentClass(async (agent) => {
      assert.equal(agent.state.tools.some((tool) => tool.name === "retrieve_loaded_course_knowledge"), false);
      const contextMatch = agent.promptText.match(/\[SERVER_RETRIEVAL_CONTEXT\]([\s\S]+?)\[\/SERVER_RETRIEVAL_CONTEXT\]/u);
      assert.ok(contextMatch);
      const context = JSON.parse(contextMatch[1]);
      assert.equal(context.evidence.length, 1);
      assert.equal(context.evidence[0].title, "函数知识点 1");
      assert.equal(context.evidence[0].excerpt.length <= 1_000, true);
      assert.doesNotMatch(JSON.stringify(context), /candidate_id|knowledge_point_id|card_refs|document_id|M4-NA-FUN/u);
      for (const listener of agent.listeners) {
        await listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "一次函数的核心结论。" },
        });
      }
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({ message: "函数知识点 1 是什么？" }));
  assert.equal(requestedLimit, 4);
  assert.deepEqual(result.knowledge_point_ids, ["M4-NA-FUN-01"]);
});

test("no-match answer is replaced by a server boundary message naming the loaded material", async () => {
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: {
      search: async () => ({
        schema_version: "education-hybrid-retrieval-receipt@1.0",
        status: "no_match",
        code: "no_match",
        hits: [],
        graph: { nodes: [], relationships: [] },
      }),
    },
    questionBankRepository: { list: async () => ({ items: [] }) },
    AgentClass: fakeAgentClass(async (agent) => {
      await findTool(agent, "publish_grounded_teaching_package").execute("call-p", {
        status: "no_match",
        answer: "模型试图硬猜的答案",
        knowledge_selections: [],
        solution_steps: [],
        card_refs: [],
        mastery_evidence_proposals: [],
        match_resolution: {
          decision: "no_match",
          confidence: 0.98,
          basis: "当前候选为空且问题不属于已加载课程",
          derived_concepts: [],
        },
      });
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({ message: "量子色动力学怎么计算？" }));
  assert.equal(result.status, "no_match");
  assert.match(result.answer, /义务教育数学课程标准/u);
  assert.doesNotMatch(result.answer, /硬猜/u);
  assert.deepEqual(result.knowledge_point_ids, []);
  assert.deepEqual(result.cards, []);
});

test("uncertain tutor match lets the model request one scoped secondary retrieval", async () => {
  const retrievalCalls = [];
  const streamEvents = [];
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: {
      search: async (input) => {
        retrievalCalls.push(input);
        if (retrievalCalls.length === 1) {
          return {
            ...retrievedReceipt(),
            hits: [{
              id: "vector-related",
              record_id: "M4-GE-SIM-05",
              entity_type: "knowledge_point",
              title: "运用相似三角形对应线段比和面积比性质",
              content: "相似三角形的面积比等于相似比的平方。",
              score: 0.81,
              source_anchor: { document_id: "MOE-MATH-2022", printed_page: "87" },
            }],
          };
        }
        return {
          ...retrievedReceipt(),
          hits: [{
            id: "vector-exact",
            record_id: "M4-GE-TRI-AREA",
            entity_type: "knowledge_point",
            title: "三角形面积公式",
            content: "三角形面积等于底乘高除以二。",
            score: 0.97,
            source_anchor: { document_id: "MOE-MATH-2022", printed_page: "49" },
          }],
        };
      },
    },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async () => [],
    AgentClass: fakeAgentClass(async (agent) => {
      assert.deepEqual(agent.state.tools.map((tool) => tool.name), [
        "request_secondary_retrieval",
        "publish_grounded_teaching_package",
      ]);
      assert.match(agent.options.initialState.systemPrompt, /补充检索/u);
      const secondary = findTool(agent, "request_secondary_retrieval");
      for (const listener of agent.listeners) {
        await listener({ type: "tool_execution_start", toolName: "request_secondary_retrieval" });
      }
      const receipt = await secondary.execute("call-secondary", {
        queries: ["三角形面积公式 底 高"],
        derived_concepts: ["三角形面积"],
        reason_code: "candidate_mismatch",
        basis: "首轮候选只讨论相似三角形面积比，不能支持一般三角形面积计算。",
      });
      for (const listener of agent.listeners) {
        await listener({ type: "tool_execution_end", toolName: "request_secondary_retrieval" });
      }
      assert.equal(receipt.details.status, "retrieved");
      assert.deepEqual(receipt.details.new_candidate_ids, ["candidate.kp.2"]);
      await findTool(agent, "publish_grounded_teaching_package").execute("call-publish", {
        status: "answered",
        knowledge_selections: [{ candidate_id: "candidate.kp.2", role: "primary", confidence: 0.98 }],
        card_refs: [],
        answer: "三角形面积等于底乘高再除以 2。",
        match_resolution: {
          decision: "exact_match",
          confidence: 0.98,
          basis: "补充检索候选直接给出一般三角形面积公式。",
          derived_concepts: ["三角形面积"],
        },
      });
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({ message: "一块三角形地面底 5 米、高 3 米，面积怎么算？" }), {
    onEvent: (event) => streamEvents.push(event),
  });

  assert.equal(result.status, "answered");
  assert.deepEqual(result.knowledge_point_ids, ["M4-GE-TRI-AREA"]);
  assert.equal(result.agent.retrieval.round_count, 2);
  assert.equal(result.agent.retrieval.execution_count, 2);
  assert.equal(result.agent.retrieval.secondary_retrieval_count, 1);
  assert.equal(result.agent.retrieval.secondary_query_count, 1);
  assert.equal(result.agent.retrieval.final_decision, "exact_match");
  assert.equal(retrievalCalls.length, 2);
  assert.equal(retrievalCalls[1].tenantId, "tenant-school-1");
  assert.equal(retrievalCalls[1].courseId, "course-junior-math");
  assert.ok(streamEvents.some((event) => event.stage === "retrieval.round2.started"));
  assert.ok(streamEvents.some((event) => event.stage === "match.final.completed"));
  assert.ok(streamEvents.some((event) => event.stage === "tool.request_secondary_retrieval.started"));
  assert.ok(streamEvents.some((event) => event.stage === "tool.request_secondary_retrieval.completed"));
  assert.deepEqual(
    streamEvents.filter((event) => event.type === "span_start").map((event) => event.name),
    ["retrieval_round1", "match_planning", "retrieval_round2", "final_match"],
  );
  const spanEnds = new Map(
    streamEvents.filter((event) => event.type === "span_end")
      .map((event) => [event.span_key, event.output]),
  );
  assert.deepEqual(spanEnds.get("retrieval.round1"), {
    status: "retrieved",
    query_count: 1,
    candidate_count: 1,
    top_candidates: [{
      id: "M4-GE-SIM-05",
      title: "运用相似三角形对应线段比和面积比性质",
      rank: 1,
      score: 0.01639344,
    }],
  });
  assert.equal(spanEnds.get("match.planning").decision, "retrieve_round2");
  assert.equal(spanEnds.get("retrieval.round2").status, "retrieved");
  assert.equal(spanEnds.get("match.final").decision, "exact_match");
  assert.doesNotMatch(JSON.stringify([...spanEnds.values()]), /content|evidence_excerpt|USER_INPUT|SERVER_RETRIEVAL_CONTEXT/u);
});

test("planner treats curriculum capability coverage as exact without requiring a same-title micro point", async () => {
  let retrievalCount = 0;
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: {
      search: async () => {
        retrievalCount += 1;
        return {
          ...retrievedReceipt(),
          hits: [{
            id: "vector-quadratic-expression",
            record_id: "M4-NA-FUN-10",
            entity_type: "knowledge_point",
            title: "从实际问题建立二次函数表达式并画图象",
            content: "通过对实际问题的分析建立二次函数表达式，并结合图象理解其性质。",
            score: 0.96,
            source_anchor: { document_id: "MOE-MATH-2022", printed_page: "57" },
          }],
        };
      },
    },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async () => [],
    AgentClass: fakeAgentClass(async (agent) => {
      assert.deepEqual(agent.state.tools.map((tool) => tool.name), [
        "request_secondary_retrieval",
        "publish_grounded_teaching_package",
      ]);
      assert.match(agent.options.initialState.systemPrompt, /不要求每道题都存在一个同名的独立微知识点/u);
      assert.match(agent.options.initialState.systemPrompt, /建立二次函数表达式.*应直接 answered/u);
      assert.match(agent.promptText, /不要求知识点标题与题目逐字一致/u);
      assert.match(agent.promptText, /可基于 USER_INPUT 给定条件完成可验证推导/u);
      await findTool(agent, "publish_grounded_teaching_package").execute("call-publish", {
        status: "answered",
        knowledge_selections: [{ candidate_id: "candidate.kp.1", role: "primary", confidence: 0.98 }],
        card_refs: [],
        answer: "由零点 1、3 可设 $y=a(x-1)(x-3)$。代入 $(0,-3)$ 得 $a=-1$，所以 $y=-x^2+4x-3$。",
        match_resolution: {
          decision: "exact_match",
          confidence: 0.98,
          basis: "候选能力覆盖建立二次函数表达式，题干条件足以完成列式、求系数和回代校验。",
          derived_concepts: ["根据已知点确定二次函数表达式"],
        },
      });
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({
    message: "已知抛物线 y=ax^2+bx+c 经过点 (1,0)、(3,0) 和 (0,-3)，求二次函数的解析式。",
  }));

  assert.equal(result.status, "answered");
  assert.deepEqual(result.knowledge_point_ids, ["M4-NA-FUN-10"]);
  assert.match(result.answer, /y=-x\^2\+4x-3/u);
  assert.equal(retrievalCount, 1);
  assert.equal(result.agent.retrieval.secondary_retrieval_count, 0);
  assert.equal(result.agent.retrieval.final_decision, "exact_match");
});

test("secondary multi-query retrieval fuses ranks and keeps per-query provenance", async () => {
  let callIndex = 0;
  const roundOne = {
    id: "vector-a",
    record_id: "KP-A",
    entity_type: "knowledge_point",
    title: "综合三角形关系",
    content: "三角形关系的综合说明。",
    score: 0.7,
  };
  const secondaryHits = [
    [
      { id: "vector-e", record_id: "KP-E", title: "候选 E", content: "E", score: 0.9 },
      { ...roundOne, score: 0.69 },
    ],
    [
      { id: "vector-i", record_id: "KP-I", title: "候选 I", content: "I", score: 0.9 },
      { ...roundOne, score: 0.68 },
    ],
    [
      { id: "vector-j", record_id: "KP-J", title: "候选 J", content: "J", score: 0.9 },
      { ...roundOne, score: 0.67 },
    ],
  ];
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: {
      search: async () => {
        const hits = callIndex === 0 ? [roundOne] : secondaryHits[callIndex - 1];
        callIndex += 1;
        return { ...retrievedReceipt(), hits };
      },
    },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async () => [],
    AgentClass: fakeAgentClass(async (agent) => {
      const secondary = await findTool(agent, "request_secondary_retrieval").execute("call-secondary", {
        queries: ["概念 E", "概念 I", "概念 J"],
        derived_concepts: ["概念 E", "概念 I", "概念 J"],
        reason_code: "cross_concept",
        basis: "需要用三个补充概念交叉校验首轮候选。",
      });
      assert.equal(secondary.details.status, "retrieved");
      assert.equal(secondary.details.returned_count, 6);
      assert.equal(secondary.details.unique_count, 4);
      assert.equal(secondary.details.corroborated_count, 1);
      assert.deepEqual(secondary.details.new_candidate_ids, [
        "candidate.kp.2",
        "candidate.kp.3",
        "candidate.kp.4",
      ]);
      const corroborated = secondary.details.candidates.find((candidate) => candidate.knowledge_point_id === "KP-A");
      assert.equal(corroborated.corroborated, true);
      assert.deepEqual(
        corroborated.provenance.filter((entry) => entry.round === 2).map((entry) => entry.query_index),
        [0, 1, 2],
      );
      assert.deepEqual(
        secondary.details.candidates.slice(0, 4).map((candidate) => candidate.knowledge_point_id),
        ["KP-A", "KP-E", "KP-I", "KP-J"],
      );
      await findTool(agent, "publish_grounded_teaching_package").execute("call-publish", {
        status: "answered",
        knowledge_selections: [{ candidate_id: "candidate.kp.1", role: "primary", confidence: 0.92 }],
        card_refs: [],
        answer: "多路检索共同支持这个综合三角形关系。",
        match_resolution: {
          decision: "exact_match",
          confidence: 0.92,
          basis: "三条补充检索都再次命中同一知识点。",
          derived_concepts: ["概念 E", "概念 I", "概念 J"],
        },
      });
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({ message: "这道题需要哪个综合关系？" }));
  assert.equal(callIndex, 4);
  assert.equal(result.grounding.retrieval_rounds[1].returned_count, 6);
  assert.equal(result.grounding.retrieval_rounds[1].unique_count, 4);
  assert.equal(result.grounding.retrieval_rounds[1].corroborated_count, 1);
});

test("secondary retrieval treats repeat-only hits as retrieved corroboration", async () => {
  let callIndex = 0;
  const repeatedHit = {
    id: "vector-repeat",
    record_id: "KP-REPEAT",
    entity_type: "knowledge_point",
    title: "反复命中的关联知识",
    content: "同一知识点被多路查询反复命中。",
    score: 0.8,
  };
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: {
      search: async () => {
        callIndex += 1;
        return { ...retrievedReceipt(), hits: [repeatedHit] };
      },
    },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async () => [],
    AgentClass: fakeAgentClass(async (agent) => {
      const secondary = await findTool(agent, "request_secondary_retrieval").execute("call-secondary", {
        queries: ["补充概念一", "补充概念二"],
        derived_concepts: ["概念一", "概念二"],
        reason_code: "insufficient_specificity",
        basis: "使用两个更具体的表达验证首轮候选。",
      });
      assert.equal(secondary.details.status, "retrieved");
      assert.deepEqual(secondary.details.new_candidate_ids, []);
      assert.deepEqual(secondary.details.corroborated_candidate_ids, ["candidate.kp.1"]);
      assert.equal(secondary.details.returned_count, 2);
      assert.equal(secondary.details.unique_count, 1);
      assert.equal(secondary.details.corroborated_count, 1);
      await findTool(agent, "publish_grounded_teaching_package").execute("call-publish", {
        status: "related_only",
        knowledge_selections: [{ candidate_id: "candidate.kp.1", role: "related", confidence: 0.7 }],
        card_refs: [],
        answer: "只找到相关知识。",
        match_resolution: {
          decision: "related_only",
          confidence: 0.7,
          basis: "反复命中仍只能确认相关性。",
          derived_concepts: ["概念一", "概念二"],
        },
      });
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({ message: "请帮我找更精确的知识概念。" }));
  assert.equal(callIndex, 3);
  assert.equal(result.grounding.retrieval_rounds[1].status, "retrieved");
  assert.equal(result.grounding.retrieval_rounds[1].corroborated_count, 1);
});

test("related-only result recommends nearby knowledge without mapping cards or mastery", async () => {
  let retrievalCount = 0;
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: {
      search: async () => {
        retrievalCount += 1;
        if (retrievalCount === 1) {
          return {
            ...retrievedReceipt(),
            hits: [{
              id: "vector-related",
              record_id: "M4-GE-SIM-05",
              entity_type: "knowledge_point",
              title: "运用相似三角形对应线段比和面积比性质",
              content: "相似三角形的面积比等于相似比的平方。",
              score: 0.8,
            }],
          };
        }
        return {
          schema_version: "education-hybrid-retrieval-receipt@1.0",
          status: "no_match",
          code: "no_match",
          hits: [],
          graph: { nodes: [], relationships: [] },
        };
      },
    },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async () => [{
      ref: "visual:M4-GE-SIM-05",
      type: "interactive_visual",
      knowledge_point_id: "M4-GE-SIM-05",
    }],
    AgentClass: fakeAgentClass(async (agent) => {
      await findTool(agent, "request_secondary_retrieval").execute("call-secondary", {
        queries: ["三角形面积公式"],
        derived_concepts: ["三角形面积"],
        reason_code: "candidate_mismatch",
        basis: "首轮只命中面积比，未命中一般面积公式。",
      });
      await findTool(agent, "publish_grounded_teaching_package").execute("call-publish", {
        status: "related_only",
        knowledge_selections: [{ candidate_id: "candidate.kp.1", role: "related", confidence: 0.84 }],
        card_refs: [],
        answer: "只找到相关知识点。",
        match_resolution: {
          decision: "related_only",
          confidence: 0.84,
          basis: "两轮均未找到一般三角形面积公式，首轮候选仅为邻近内容。",
          derived_concepts: ["三角形面积"],
        },
      });
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({ message: "三角形面积怎么算？" }));

  assert.equal(result.status, "related_only");
  assert.deepEqual(result.knowledge_point_ids, []);
  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.mastery_evidence_proposals, []);
  assert.equal(result.learning_receipt.mapping.status, "no_match");
  assert.deepEqual(result.related_knowledge_points, [{
    knowledge_point_id: "M4-GE-SIM-05",
    title: "运用相似三角形对应线段比和面积比性质",
  }]);
  assert.match(result.answer, /未收录.*三角形面积/u);
  assert.match(result.answer, /相似三角形.*面积比/u);
});

test("photo solver sends the image to the vision model and publishes grounded solution steps", async () => {
  let observedImages = null;
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key", ARK_EDUCATION_VISION_MODEL: "vision-test" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    artifactResolver: async () => [{
      ref: "visual:M4-NA-FUN-02",
      type: "interactive_visual",
      knowledge_point_id: "M4-NA-FUN-02",
    }],
    AgentClass: fakeAgentClass(async (agent, { images }) => {
      observedImages = images;
      await findTool(agent, "retrieve_loaded_course_knowledge").execute("call-r", { query: "一次函数图像求交点" });
      await findTool(agent, "publish_grounded_teaching_package").execute("call-p", basePublished({
        answer: "图中直线与 y 轴交于（0，2）。",
        solution_steps: ["识别直线表达式", "令 x=0", "得到 y=2 并回代检验"],
      }));
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  const result = await service.runTurn(turn({
    skill: "photo_solver",
    message: "请解这道题",
    image: { mime_type: "image/png", data: "aGVsbG8=" },
    authority: { ...turn().authority, turn_id: "turn-photo", request_id: "request-photo", idempotency_key: "idem-photo" },
  }));

  assert.equal(observedImages.length, 1);
  assert.equal(observedImages[0].mimeType, "image/png");
  assert.equal(result.agent.multimodal_input_used, true);
  assert.equal(result.agent.image_task_mode, "solve");
  assert.equal(result.solution_steps.length, 3);
});

test("photo solver rejects a non-solve image-task mode before model execution", async () => {
  let modelCalls = 0;
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    AgentClass: fakeAgentClass(async () => { modelCalls += 1; }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  await assert.rejects(
    service.runTurn(turn({
      skill: "photo_solver",
      imageTaskMode: "grade",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    })),
    (error) => error instanceof PiLearningAgentError
      && error.code === "pi_learning_image_task_mode_invalid",
  );
  assert.equal(modelCalls, 0);
});

test("question generator keeps the answer key private and grades through an opaque assessment instance", async () => {
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    AgentClass: fakeAgentClass(async (agent) => {
      assert.equal(agent.state.tools.some((tool) => tool.name === "retrieve_loaded_course_knowledge"), false);
      await findTool(agent, "search_reviewed_questions").execute("call-q", {
        candidate_id: "candidate.kp.1",
        limit: 4,
      });
      await findTool(agent, "publish_grounded_teaching_package").execute("call-p", basePublished({
        answer: "我按中等难度准备了一道一次函数练习，请先独立作答。",
        card_refs: [],
        question_draft: {
          title: "一次函数基础练习",
          prompt: "已知 y=2x+5，它与 y 轴的交点纵坐标是多少？",
          instruction: "选择一个答案",
          item_type: "single_choice",
          cognitive_level: "apply",
          difficulty: "medium",
          generation_method: "条件变式",
          estimated_minutes: 2,
          options: [
            { id: "A", label: "2" },
            { id: "B", label: "5" },
            { id: "C", label: "7" },
          ],
          correct_option_ids: ["B"],
          explanation: "令 x=0，得 y=5。",
          solution_paths: [{
            title: "代入特殊值",
            steps: ["令 x=0", "计算 y=5", "得出纵坐标"],
            when_to_use: "求 y 轴交点",
          }],
          common_errors: ["把斜率当成纵截距"],
          scoring_points: [{ criterion: "正确得出纵坐标", points: 1 }],
        },
      }));
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
    now: () => "2026-08-24T12:00:00+08:00",
  });

  const input = turn({
    skill: "question_generator",
    message: "给我出一道一次函数题",
    questionPreferences: {
      item_type: "single_choice",
      difficulty: "medium",
      cognitive_level: "apply",
      generation_method: "条件变式",
    },
    authority: { ...turn().authority, turn_id: "turn-question", request_id: "request-question", idempotency_key: "idem-question" },
  });
  const result = await service.runTurn(input);
  const draft = result.question_drafts[0];
  const serialized = JSON.stringify(result);

  assert.match(draft.assessment_instance_id, /^assessment_instance:/u);
  assert.equal(draft.public_item.prompt.includes("y=2x+5"), true);
  assert.doesNotMatch(serialized, /correct_option_ids|accepted_answers|private_key|令 x=0，得 y=5/u);
  const registered = service.registerTeachingPackage(result, {
    studentId: "student-1",
    sessionId: "session-1",
  });
  assert.equal(registered[0].assessment_instance_id, draft.assessment_instance_id);

  const receipt = service.grade({
    assessment_instance_id: draft.assessment_instance_id,
    selected: "B",
    student_id: "student-1",
    session_id: "session-1",
    hint_usage: 0,
  });
  assert.equal(receipt.verified, true);
  assert.equal(receipt.outcome, "correct");
  assert.deepEqual(receipt.knowledge_point_ids, ["M4-NA-FUN-02"]);
  assert.equal(receipt.score, 1);
  assert.doesNotMatch(JSON.stringify(receipt), /correct_option|explanation|private_key/u);
});

test("publishing an invented knowledge candidate fails closed", async () => {
  const service = createPiLearningAgent({
    env: { ARK_API_KEY: "test-key" },
    retrievalService: { search: async () => retrievedReceipt() },
    questionBankRepository: { list: async () => ({ items: [] }) },
    AgentClass: fakeAgentClass(async (agent) => {
      await findTool(agent, "retrieve_loaded_course_knowledge").execute("call-r", { query: "一次函数" });
      await assert.rejects(
        findTool(agent, "publish_grounded_teaching_package").execute("call-p", basePublished({
          knowledge_selections: [{ candidate_id: "candidate.agent.invented", role: "primary", confidence: 1 }],
          solution_steps: ["依据检索证据完成求解。"],
        })),
        (error) => error instanceof PiLearningAgentError && error.code === "pi_learning_candidate_invented",
      );
      throw new PiLearningAgentError("pi_learning_candidate_invented", "blocked");
    }),
    stream: () => { throw new Error("fake agent must not call provider"); },
  });

  await assert.rejects(
    service.runTurn(turn({
      skill: "photo_solver",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    })),
    (error) => error instanceof PiLearningAgentError,
  );
});
