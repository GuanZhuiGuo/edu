import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateAction,
  validateScene,
  validateStage
} from "@openmaic/dsl";

import {
  OPENMAIC_OFFICIAL_PROVENANCE,
  OpenMaicOfficialBridgeError,
  runOpenMaicOfficialPipeline
} from "../source-bridges/openmaic/index.js";

const PINNED_REVISION = "fcdb6d62b380c066de2a4733910669c9e697b83a";
const SOURCE = {
  source_id: "physics.newton-2",
  title: "牛顿第二定律",
  language: "zh-CN",
  source_text:
    "牛顿第二定律说明物体的加速度与所受合外力成正比，与质量成反比，方向与合外力一致。解决动力学问题时，应先选择研究对象、画受力图、求合外力，再列出 F=ma。"
};

test(
  "executes the pinned official OpenMAIC generation pipeline and returns native output",
  { timeout: 60_000 },
  async () => {
    const promptKinds = [];
    const progress = [];
    const stages = [];
    const traces = [];
    const modelContexts = [];
    const previousCredential = process.env.OPENMAIC_TEST_API_KEY;
    process.env.OPENMAIC_TEST_API_KEY = "dummy-value-never-forwarded";

    try {
      const result = await runOpenMaicOfficialPipeline(SOURCE, {
        aiCall: async (systemPrompt, userPrompt, images, context) => {
          modelContexts.push(context);
          assert.equal(
            images === undefined || Array.isArray(images),
            true,
            "official AICallFn images argument must remain native"
          );
          if (systemPrompt.startsWith("# Scene Outline Generator")) {
            promptKinds.push("requirements-to-outlines");
            assert.match(userPrompt, /牛顿第二定律说明物体的加速度/);
            return JSON.stringify({
              languageDirective: "全程使用简体中文，保留 F=ma 的标准写法。",
              courseTitle: "力与加速度",
              outlines: [
                {
                  id: "outline_slide",
                  type: "slide",
                  title: "理解 F=ma",
                  description: "解释合外力、质量和加速度的关系。",
                  keyPoints: ["合外力决定加速度", "质量影响加速度大小"],
                  estimatedDuration: 90,
                  order: 99
                },
                {
                  id: "outline_quiz",
                  type: "quiz",
                  title: "关系判断",
                  description: "检查学习者是否掌握变量关系。",
                  keyPoints: ["相同质量下外力越大加速度越大"],
                  quizConfig: {
                    questionCount: 1,
                    difficulty: "easy",
                    questionTypes: ["single"]
                  },
                  order: 99
                }
              ]
            });
          }

          if (systemPrompt.startsWith("# Slide Content Generator")) {
            promptKinds.push("slide-content");
            return JSON.stringify({
              background: { type: "solid", color: "#F8FAFC" },
              elements: [
                {
                  id: "model_supplied_id_is_replaced",
                  type: "text",
                  left: 70,
                  top: 70,
                  width: 860,
                  height: 76,
                  content:
                    '<p style="font-size: 34px; color: #172033;">F = ma</p>',
                  defaultFontName: "Microsoft YaHei",
                  defaultColor: "#172033"
                }
              ],
              remark: "用公式联系合外力、质量和加速度。"
            });
          }

          if (systemPrompt.startsWith("# Quiz Content Generator")) {
            promptKinds.push("quiz-content");
            return JSON.stringify([
              {
                id: "q_force",
                type: "single",
                question: "质量不变时，合外力增大，加速度如何变化？",
                options: [
                  { label: "增大", value: "A" },
                  { label: "减小", value: "B" },
                  { label: "不变", value: "C" },
                  { label: "无法判断", value: "D" }
                ],
                answer: ["A"],
                analysis: "由 a=F/m 可知，质量不变时加速度随合外力增大。",
                points: 10
              }
            ]);
          }

          if (systemPrompt.startsWith("# Slide Action Generator")) {
            promptKinds.push("slide-actions");
            const elementId =
              userPrompt.match(/id: "([^"]+)"/)?.[1] || "missing";
            return JSON.stringify([
              {
                type: "action",
                name: "spotlight",
                params: { elementId }
              },
              {
                type: "text",
                content: "先看公式，合外力与加速度成正比。"
              }
            ]);
          }

          if (systemPrompt.startsWith("# Quiz Action Generator")) {
            promptKinds.push("quiz-actions");
            return JSON.stringify([
              {
                type: "text",
                content: "现在独立完成这道关系判断题。"
              }
            ]);
          }

          throw new Error(
            `Unexpected official prompt: ${systemPrompt.slice(0, 80)}`
          );
        },
        onProgress(event) {
          progress.push(event);
        },
        onStageComplete(stageNumber) {
          stages.push(stageNumber);
        },
        onTrace(event) {
          traces.push(event);
        }
      });

      assert.deepEqual(promptKinds.sort(), [
        "quiz-actions",
        "quiz-content",
        "requirements-to-outlines",
        "slide-actions",
        "slide-content"
      ]);
      assert.ok(progress.length >= 4);
      assert.deepEqual(stages, [1, 2]);
      assert.equal(modelContexts.length, 5);
      assert.equal(
        modelContexts.every(
          (context) =>
            typeof context?.callId === "string" &&
            context.callId.startsWith("ai_") &&
            context.signal instanceof AbortSignal
        ),
        true
      );
      assert.equal(
        new Set(modelContexts.map((context) => context.callId)).size,
        5
      );
      assert.equal(
        traces.some(
          (event) =>
            event.type === "process.start" &&
            event.stage === "openmaic.worker"
        ),
        true
      );
      assert.equal(
        traces.filter(
          (event) =>
            event.type === "model.bridge" &&
            event.status === "completed"
        ).length,
        5
      );
      assert.equal(
        traces.some(
          (event) =>
            event.type === "process.complete" &&
            event.meta?.scene_count === 2
        ),
        true
      );

      assert.equal(result.stage.name, "力与加速度");
      assert.equal(
        result.stage.languageDirective,
        "全程使用简体中文，保留 F=ma 的标准写法。"
      );
      assert.deepEqual(result.outlines, result.session.sceneOutlines);
      assert.deepEqual(
        result.outlines.map(({ id, order, type }) => ({ id, order, type })),
        [
          { id: "outline_slide", order: 1, type: "slide" },
          { id: "outline_quiz", order: 2, type: "quiz" }
        ]
      );
      assert.deepEqual(
        result.scenes.map(({ type, order }) => ({ type, order })),
        [
          { type: "slide", order: 1 },
          { type: "quiz", order: 2 }
        ]
      );

      const [slideScene, quizScene] = result.scenes;
      assert.equal(slideScene.content.type, "slide");
      assert.equal(slideScene.content.canvas.viewportSize, 1000);
      assert.equal(slideScene.content.canvas.viewportRatio, 0.5625);
      assert.equal(
        slideScene.content.canvas.theme.fontName,
        "Microsoft YaHei"
      );
      assert.equal(slideScene.content.canvas.elements.length, 1);
      assert.match(
        slideScene.content.canvas.elements[0].id,
        /^text_[A-Za-z0-9_-]{8}$/
      );
      assert.deepEqual(
        slideScene.actions.map(({ type }) => type),
        ["spotlight", "speech"]
      );
      assert.equal(
        slideScene.actions[0].elementId,
        slideScene.content.canvas.elements[0].id
      );

      assert.equal(quizScene.content.type, "quiz");
      assert.deepEqual(quizScene.content.questions[0].answer, ["A"]);
      assert.equal(quizScene.content.questions[0].hasAnswer, true);
      assert.deepEqual(
        quizScene.content.questions[0].options.map(({ value }) => value),
        ["A", "B", "C", "D"]
      );
      assert.deepEqual(
        quizScene.actions.map(({ type }) => type),
        ["speech"]
      );

      assert.deepEqual(
        result.actions,
        result.scenes.flatMap((scene) => scene.actions || [])
      );
      assert.equal("presentation_timeline" in result, false);
      assert.equal("a2ui_projection" in result, false);
      assert.equal("material" in result, false);

      assert.equal(validateStage(result.stage).valid, true);
      for (const scene of result.scenes) {
        assert.equal(
          validateScene(scene).valid,
          true,
          JSON.stringify(validateScene(scene).errors)
        );
        for (const action of scene.actions || []) {
          assert.equal(
            validateAction(action).valid,
            true,
            JSON.stringify(validateAction(action).errors)
          );
        }
      }

      assert.deepEqual(result.execution.direct_symbols, [
        "createGenerationSession",
        "runGenerationPipeline"
      ]);
      assert.deepEqual(result.execution.verified_pipeline_call_graph, [
        "generateSceneOutlinesFromRequirements",
        "generateFullScenes",
        "generateSceneContent",
        "generateSceneActions",
        "createSceneWithActions"
      ]);
      assert.equal(result.execution.ai_call_count, 5);
      assert.equal(result.execution.credentials_available_to_worker, false);
      assert.equal(result.execution.native_output, true);
      assert.deepEqual(result.execution.projections, []);

      assert.equal(result.provenance.source_revision, PINNED_REVISION);
      assert.equal(result.provenance.license, "MIT");
      assert.equal(result.provenance.upstream_modified, false);
    } finally {
      if (previousCredential === undefined) {
        delete process.env.OPENMAIC_TEST_API_KEY;
      } else {
        process.env.OPENMAIC_TEST_API_KEY = previousCredential;
      }
    }
  }
);

test("records the exact checkout, npm provenance, license and clean upstream source", async () => {
  const revision = execFileSync(
    "git",
    ["-C", "third_party/openmaic", "rev-parse", "HEAD"],
    { encoding: "utf8" }
  ).trim();
  const trackedDiff = execFileSync(
    "git",
    ["-C", "third_party/openmaic", "status", "--short", "--untracked-files=no"],
    { encoding: "utf8" }
  ).trim();
  const license = await readFile("third_party/openmaic/LICENSE", "utf8");
  const metadata = JSON.parse(
    await readFile(
      "source-bridges/openmaic/upstream-source.json",
      "utf8"
    )
  );
  const bundleMetadata = JSON.parse(
    await readFile(
      "source-bridges/openmaic/generated/official-worker.meta.json",
      "utf8"
    )
  );

  assert.equal(revision, PINNED_REVISION);
  assert.equal(trackedDiff, "");
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 THU-MAIC/);
  assert.equal(metadata.revision, PINNED_REVISION);
  assert.equal(metadata.npm_provenance.package, "@openmaic/dsl");
  assert.equal(metadata.npm_provenance.version, "0.3.0");
  assert.equal(metadata.license_at_revision, "MIT");
  assert.equal(metadata.upstream_source_modified, false);
  assert.equal(bundleMetadata.upstream_revision, PINNED_REVISION);
  assert.equal(bundleMetadata.upstream_source_modified, false);
  const bundledInputs = Object.keys(bundleMetadata.esbuild_metafile.inputs);
  for (const officialSource of [
    "lib/generation/pipeline-runner.ts",
    "lib/generation/outline-generator.ts",
    "lib/generation/scene-generator.ts",
    "lib/generation/action-parser.ts"
  ]) {
    assert.ok(
      bundledInputs.some((input) => input.endsWith(officialSource)),
      `${officialSource} must be present in the executable bundle metafile`
    );
  }

  assert.equal(OPENMAIC_OFFICIAL_PROVENANCE.source_revision, PINNED_REVISION);
  assert.equal(
    OPENMAIC_OFFICIAL_PROVENANCE.renderer.source_entry,
    "packages/@openmaic/renderer/src/index.ts#SlideCanvas"
  );
  assert.ok(Object.isFrozen(OPENMAIC_OFFICIAL_PROVENANCE));
});

test("exposes the built official SlideCanvas renderer entry", async () => {
  const renderer = await import(
    "../source-bridges/openmaic/renderer-entry.js"
  );

  assert.equal(typeof renderer.SlideCanvas, "function");
  assert.equal(typeof renderer.SlideRendererProvider, "function");
  assert.equal(typeof renderer.SpotlightOverlay, "function");
});

test("requires valid source and a host-provided model callback", async () => {
  await assert.rejects(
    runOpenMaicOfficialPipeline({
      source_text: "too short"
    }),
    (error) => {
      assert.ok(error instanceof OpenMaicOfficialBridgeError);
      assert.equal(error.code, "OPENMAIC_INVALID_SOURCE");
      return true;
    }
  );

  await assert.rejects(
    runOpenMaicOfficialPipeline(SOURCE),
    (error) => {
      assert.ok(error instanceof OpenMaicOfficialBridgeError);
      assert.equal(error.code, "OPENMAIC_AI_CALL_REQUIRED");
      return true;
    }
  );
});

test(
  "surfaces host model failures without falling back to locally invented material",
  { timeout: 30_000 },
  async () => {
    await assert.rejects(
      runOpenMaicOfficialPipeline(SOURCE, {
        aiCall: async () => {
          throw new Error("synthetic upstream outage");
        }
      }),
      (error) => {
        assert.ok(error instanceof OpenMaicOfficialBridgeError);
        assert.equal(error.code, "OPENMAIC_PIPELINE_FAILED");
        assert.match(error.message, /synthetic upstream outage/);
        return true;
      }
    );
  }
);
