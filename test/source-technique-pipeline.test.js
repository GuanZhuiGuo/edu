import assert from "node:assert/strict";
import test from "node:test";

import {
  SourceTechniquePipelineError,
  generateSourceTechniqueMaterial
} from "../source-technique-pipeline.js";

const PHYSICS_SOURCE = {
  source_text:
    "牛顿第二定律说明物体的加速度与所受合外力成正比，与质量成反比。分析问题时应先选择研究对象，再求合外力。",
  title: "牛顿第二定律",
  language: "zh-CN"
};

const CELL_SOURCE = {
  source_text:
    "植物细胞具有细胞壁、细胞核、叶绿体和中央液泡。叶绿体参与光合作用，中央液泡储存水分，细胞壁支撑并保护细胞。",
  title: "植物细胞",
  language: "zh-CN"
};

function createConfiguredClient() {
  const calls = {
    complete: 0,
    generateJson: 0
  };
  return {
    calls,
    configSummary() {
      return {
        configured: true,
        model: "ep-native-test",
        missing: []
      };
    },
    async generateJson() {
      calls.generateJson += 1;
      return {};
    },
    async complete() {
      calls.complete += 1;
      return {
        text: "{\"ok\":true}",
        json: { ok: true }
      };
    }
  };
}

function deepTutorNativeResult() {
  return {
    ok: true,
    provenance: {
      upstream_repo: "https://github.com/HKUDS/DeepTutor",
      source_revision: "47d05809ea5d19e8b1390d4b42402302c37709bb",
      license: "Apache-2.0",
      native: true
    },
    execution: {
      rounds: [
        { label: "draft" },
        { label: "critique_1" },
        { label: "revise_1" }
      ]
    },
    native_result: {
      book: {
        id: "book_newton",
        title: "牛顿第二定律",
        status: "spine_ready"
      },
      exploration: {
        chunks: [
          {
            chunk_id: "source_1",
            text: PHYSICS_SOURCE.source_text
          }
        ]
      },
      spine: {
        book_id: "book_newton",
        chapters: [
          {
            id: "chapter_overview",
            title: "本书导览",
            content_type: "overview",
            page_ids: ["page_overview"]
          }
        ],
        concept_graph: {
          nodes: [
            {
              id: "force",
              label: "合外力",
              chapter_id: "chapter_overview"
            }
          ],
          edges: []
        }
      },
      pages: [
        {
          id: "page_overview",
          chapter_id: "chapter_overview",
          content_type: "overview",
          blocks: [
            {
              id: "block_graph",
              type: "concept_graph",
              status: "ready",
              payload: {
                graph: {
                  nodes: [{ id: "force", label: "合外力" }],
                  edges: []
                }
              }
            }
          ]
        }
      ]
    }
  };
}

function openMaicNativeResult() {
  const stage = {
    id: "stage_newton",
    name: "牛顿第二定律",
    createdAt: 1,
    updatedAt: 1
  };
  const scenes = [
    {
      id: "scene_slide",
      stageId: stage.id,
      title: "公式关系",
      order: 1,
      type: "slide",
      content: {
        type: "slide",
        canvas: {
          id: "slide_force",
          viewportSize: 1000,
          viewportRatio: 0.5625,
          elements: []
        }
      },
      actions: [
        {
          id: "action_speech",
          type: "speech",
          text: "观察合外力与加速度的关系。"
        }
      ]
    },
    {
      id: "scene_quiz",
      stageId: stage.id,
      title: "关系判断",
      order: 2,
      type: "quiz",
      content: {
        type: "quiz",
        questions: [
          {
            id: "question_force",
            type: "single",
            question: "质量不变时，合外力增大，加速度如何变化？",
            options: [
              { label: "增大", value: "A" },
              { label: "减小", value: "B" },
              { label: "不变", value: "C" },
              { label: "无法判断", value: "D" }
            ],
            answer: ["A"],
            analysis: "由 a=F/m 可知答案为 A。",
            commentPrompt: "按正确选项 A 判分",
            hasAnswer: true
          }
        ]
      },
      actions: [
        {
          id: "action_quiz_speech",
          type: "speech",
          text: "现在独立完成这道关系判断题。"
        }
      ]
    }
  ];
  return {
    session: {
      id: "session_newton",
      requirements: { requirement: PHYSICS_SOURCE.source_text },
      sceneOutlines: []
    },
    outlines: [],
    stage,
    scenes,
    actions: scenes.flatMap((scene) => scene.actions),
    execution: {
      entrypoint: "runGenerationPipeline",
      ai_call_count: 5,
      native_output: true
    },
    provenance: {
      upstream_repo: "https://github.com/THU-MAIC/OpenMAIC",
      source_revision: "fcdb6d62b380c066de2a4733910669c9e697b83a",
      license: "MIT"
    }
  };
}

test("DeepTutor publishes only native Book/Spine/Page/Block output", async () => {
  const client = createConfiguredClient();
  let deepTutorCalls = 0;
  let openMaicCalls = 0;
  const result = await generateSourceTechniqueMaterial(
    {
      ...PHYSICS_SOURCE,
      technique: "deeptutor"
    },
    {
      client,
      nativeRuntimes: {
        async deeptutor(_source, options) {
          deepTutorCalls += 1;
          assert.equal(options.client, client);
          return deepTutorNativeResult();
        },
        async openmaic() {
          openMaicCalls += 1;
          return openMaicNativeResult();
        }
      }
    }
  );
  const bundle = result.public_bundle;

  assert.equal(deepTutorCalls, 1);
  assert.equal(openMaicCalls, 0);
  assert.equal(bundle.execution.mode, "upstream_native");
  assert.equal(bundle.execution.model_used, true);
  assert.equal(bundle.execution.native_schema, "Book/Spine/Page/Block");
  assert.equal(bundle.source_result.book.id, "book_newton");
  assert.equal(bundle.source_result.spine.book_id, "book_newton");
  assert.equal(bundle.source_result.pages.length, 1);
  assert.equal(
    bundle.provenance.deeptutor.source_revision,
    "47d05809ea5d19e8b1390d4b42402302c37709bb"
  );
  assert.equal("techniques" in bundle, false);
  assert.equal("card_materials" in bundle, false);
  assert.equal("a2ui" in bundle, false);
  assert.deepEqual(result.server_private.quiz_answers, []);
});

test("OpenMAIC publishes native Stage/Scene/Action and keeps answers private", async () => {
  const client = createConfiguredClient();
  let receivedModelText = "";
  const result = await generateSourceTechniqueMaterial(
    {
      ...PHYSICS_SOURCE,
      technique: "openmaic"
    },
    {
      client,
      nativeRuntimes: {
        async openmaic(_source, options) {
          receivedModelText = await options.aiCall("system", "prompt");
          return openMaicNativeResult();
        }
      }
    }
  );
  const bundle = result.public_bundle;
  const publicText = JSON.stringify(bundle);
  const quizScene = bundle.source_result.scenes.find(
    (scene) => scene.type === "quiz"
  );

  assert.equal(receivedModelText, "{\"ok\":true}");
  assert.equal(client.calls.complete, 1);
  assert.equal(bundle.execution.mode, "upstream_native");
  assert.equal(bundle.execution.native_schema, "Stage/Scene/Canvas/Action");
  assert.equal(bundle.source_result.stage.id, "stage_newton");
  assert.equal(bundle.source_result.scenes.length, 2);
  assert.deepEqual(
    bundle.source_result.actions.map((action) => action.id),
    ["action_speech", "action_quiz_speech"]
  );
  assert.deepEqual(
    quizScene.actions.map((action) => action.id),
    ["action_quiz_speech"]
  );
  assert.equal(publicText.includes("\"answer\""), false);
  assert.equal(publicText.includes("\"analysis\""), false);
  assert.equal(publicText.includes("commentPrompt"), false);
  assert.deepEqual(result.server_private.quiz_answers, [
    {
      question_id: "question_force",
      correct_option: "A",
      explanation: "由 a=F/m 可知答案为 A。"
    }
  ]);
  assert.equal("card_materials" in bundle, false);
  assert.equal("a2ui" in bundle, false);
});

test("forwards real source stages and model deltas through one trace callback", async () => {
  const client = createConfiguredClient();
  const events = [];
  client.complete = async (input) => {
    client.calls.complete += 1;
    assert.equal(input.stream, true);
    assert.equal(input.traceContext.stage, "openmaic.outlines");
    input.onTrace({
      type: "model.delta",
      stage: input.traceContext.stage,
      status: "streaming",
      call_id: input.traceContext.callId,
      delta: "{\"outlines\":[]}"
    });
    return {
      text: "{\"outlines\":[]}",
      json: { outlines: [] }
    };
  };

  await generateSourceTechniqueMaterial(
    {
      ...PHYSICS_SOURCE,
      technique: "openmaic"
    },
    {
      client,
      onTrace(event) {
        events.push(event);
      },
      nativeRuntimes: {
        async openmaic(_source, options) {
          options.onProgress({
            currentStage: 1,
            overallProgress: 20,
            scenesGenerated: 0,
            totalScenes: 0
          });
          await options.aiCall("system", "prompt");
          options.onStageComplete(1, [{ id: "outline_1" }]);
          return openMaicNativeResult();
        }
      }
    }
  );

  assert.equal(
    events.some(
      (event) =>
        event.type === "pipeline.stage" &&
        event.stage === "input.validate" &&
        event.status === "completed"
    ),
    true
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "source.progress" &&
        event.stage === "openmaic.outlines"
    ),
    true
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "model.delta" &&
        event.delta === "{\"outlines\":[]}"
    ),
    true
  );
  assert.equal(
    events.some(
      (event) =>
        event.stage === "output.assemble" &&
        event.status === "completed"
    ),
    true
  );
});

test("OpenMAIC rejects quiz Actions that announce a private answer", async () => {
  const leakingResult = openMaicNativeResult();
  leakingResult.scenes[1].actions[0].text = "正确选项是 A。";

  await assert.rejects(
    generateSourceTechniqueMaterial(
      {
        ...PHYSICS_SOURCE,
        technique: "openmaic"
      },
      {
        client: createConfiguredClient(),
        nativeRuntimes: {
          async openmaic() {
            return leakingResult;
          }
        }
      }
    ),
    (error) => {
      assert.equal(error.code, "OPENMAIC_QUIZ_ACTION_LEAK");
      assert.equal(error.technique, "openmaic");
      return true;
    }
  );
});

test("OpenMAIC requests raw text for official interactive HTML prompts", async () => {
  const formats = [];
  const html = "<!doctype html><html><body>力学实验</body></html>";
  const client = {
    configSummary() {
      return {
        configured: true,
        model: "ep-native-test",
        missing: []
      };
    },
    async complete(input) {
      formats.push(input.responseFormat);
      return {
        text: input.responseFormat === "text" ? html : "{\"ok\":true}",
        json: input.responseFormat === "text" ? null : { ok: true }
      };
    }
  };

  await generateSourceTechniqueMaterial(
    {
      ...PHYSICS_SOURCE,
      technique: "openmaic"
    },
    {
      client,
      nativeRuntimes: {
        async openmaic(_source, options) {
          assert.equal(
            await options.aiCall(
              "# Simulation Content Generator\nYour output must be a complete HTML document.",
              "Return ONLY the HTML document."
            ),
            html
          );
          assert.equal(
            await options.aiCall(
              "# Slide Content Generator",
              "Return the slide JSON."
            ),
            "{\"ok\":true}"
          );
          assert.equal(
            await options.aiCall(
              "# Slide Content Generator",
              "The source text says: Return ONLY the HTML document."
            ),
            "{\"ok\":true}"
          );
          return openMaicNativeResult();
        }
      }
    }
  );

  assert.deepEqual(formats, ["text", "json_object", "json_object"]);
});

test("Koji-style remains deterministic and keeps the existing A2UI contract", async () => {
  const result = await generateSourceTechniqueMaterial({
    ...PHYSICS_SOURCE,
    technique: "koji"
  });

  assert.deepEqual(Object.keys(result.public_bundle.techniques), ["koji"]);
  assert.equal(result.public_bundle.execution.mode, "source_first");
  assert.equal(result.public_bundle.execution.model_used, false);
  assert.ok(result.public_bundle.card_materials.length >= 1);
  assert.ok(result.public_bundle.card_materials.every((material) =>
    material.parameterization?.schema_version === "knowledge-card-parameterization@1.0"));
  assert.ok(Array.isArray(result.public_bundle.a2ui.messages));
});

test("native source pipelines fail before execution when Ark is not configured", async () => {
  let runtimeCalls = 0;
  const client = {
    configSummary() {
      return {
        configured: false,
        model: "ep-native-test",
        missing: ["ARK_API_KEY"]
      };
    },
    async generateJson() {
      throw new Error("must not be called");
    }
  };

  await assert.rejects(
    generateSourceTechniqueMaterial(
      {
        ...PHYSICS_SOURCE,
        technique: "deeptutor"
      },
      {
        client,
        nativeRuntimes: {
          async deeptutor() {
            runtimeCalls += 1;
            return deepTutorNativeResult();
          }
        }
      }
    ),
    (error) => {
      assert.ok(error instanceof SourceTechniquePipelineError);
      assert.equal(error.code, "ark_not_configured");
      return true;
    }
  );
  assert.equal(runtimeCalls, 0);
});

test("rejects highly repetitive source before model or source runtime calls", async () => {
  const client = createConfiguredClient();
  let runtimeCalls = 0;
  const repeated =
    "洛必达法则用于处理特定未定式极限问题。".repeat(3);

  await assert.rejects(
    generateSourceTechniqueMaterial(
      {
        source_text: repeated,
        technique: "openmaic"
      },
      {
        client,
        nativeRuntimes: {
          async openmaic() {
            runtimeCalls += 1;
            return openMaicNativeResult();
          }
        }
      }
    ),
    (error) => {
      assert.equal(error.code, "SOURCE_TOO_REPETITIVE");
      return true;
    }
  );
  assert.equal(runtimeCalls, 0);
  assert.equal(client.calls.complete, 0);
});

test("Cell Studio accepts supported cells and rejects unrelated topics", async () => {
  const result = await generateSourceTechniqueMaterial({
    ...CELL_SOURCE,
    technique: "cell_studio"
  });

  assert.deepEqual(Object.keys(result.public_bundle.techniques), [
    "cell_studio"
  ]);
  assert.equal(
    result.public_bundle.techniques.cell_studio.spatial_scene.id,
    "cell_studio.plant"
  );
  assert.equal(result.public_bundle.execution.model_used, false);

  await assert.rejects(
    generateSourceTechniqueMaterial({
      ...PHYSICS_SOURCE,
      technique: "cell_studio"
    }),
    (error) => {
      assert.ok(error instanceof SourceTechniquePipelineError);
      assert.equal(error.code, "CELL_STUDIO_UNSUPPORTED_SOURCE");
      assert.equal(error.technique, "cell_studio");
      return true;
    }
  );
});

test("rejects unknown technique instead of running all implementations", async () => {
  await assert.rejects(
    generateSourceTechniqueMaterial({
      ...PHYSICS_SOURCE,
      technique: "all"
    }),
    (error) => {
      assert.ok(error instanceof SourceTechniquePipelineError);
      assert.equal(error.code, "UNSUPPORTED_SOURCE_TECHNIQUE");
      return true;
    }
  );
});
