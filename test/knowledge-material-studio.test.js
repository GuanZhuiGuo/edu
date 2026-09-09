import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createKnowledgeMaterialNdjsonParser,
  describeNativeOpenMaicAction,
  normalizeDeepTutorNativeResult,
  normalizeOpenMaicNativeResult,
  normalizeOpenMaicTimelineAction,
  publicProviderConfigError,
  readKnowledgeMaterialTraceStream
} from "../public/knowledge-material-studio.js";

test("normalizes canonical OpenMAIC DSL actions for browser playback", () => {
  assert.deepEqual(
    normalizeOpenMaicTimelineAction({
      id: "action_reveal",
      scene_id: "scene_one",
      order: 1,
      type: "annotate",
      target_id: "legacy_target",
      narration: "legacy copy",
      duration_ms: 900,
      dsl_action: {
        id: "action_reveal",
        type: "widget_reveal",
        target: "canonical_target",
        content: "canonical copy"
      }
    }),
    {
      id: "action_reveal",
      scene_id: "scene_one",
      order: 1,
      type: "reveal",
      target_id: "canonical_target",
      narration: "canonical copy",
      duration_ms: 900,
      dsl_action: {
        id: "action_reveal",
        type: "widget_reveal",
        target: "canonical_target",
        content: "canonical copy"
      }
    }
  );
});

test("keeps the validated local target for widget_setState", () => {
  const state = { value: 42 };
  const normalized = normalizeOpenMaicTimelineAction({
    type: "set_state",
    target_id: "control_force",
    narration: "旧说明",
    state: { value: 1 },
    dsl_action: {
      type: "widget_setState",
      state,
      content: "调整参数"
    }
  });

  assert.equal(normalized.type, "set_state");
  assert.equal(normalized.target_id, "control_force");
  assert.equal(normalized.narration, "调整参数");
  assert.deepEqual(normalized.state, state);
});

test("provider configuration errors never expose an upstream message or key", () => {
  const sensitiveMarker = "ark-sensitive-value";
  const error = publicProviderConfigError(418, sensitiveMarker);

  assert.equal(error, "模型配置失败（HTTP 418）");
  assert.equal(error.includes(sensitiveMarker), false);
  assert.equal(
    publicProviderConfigError(403, sensitiveMarker),
    "仅允许在当前本机配置密钥"
  );
  assert.equal(
    publicProviderConfigError(500, sensitiveMarker),
    "本机服务暂时无法保存配置，请稍后重试"
  );
});

test("material provider is an in-workspace accessible dialog with no browser persistence", () => {
  const html = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8"
  );
  const studio = readFileSync(
    new URL("../public/knowledge-material-studio.js", import.meta.url),
    "utf8"
  );

  assert.match(
    html,
    /<button\s+[^>]*id="materialProviderStatus"[^>]*aria-haspopup="dialog"/s
  );
  assert.match(html, /<dialog\s+[^>]*id="materialProviderDialog"/s);
  assert.match(
    html,
    /id="materialProviderApiKey"[\s\S]*?type="password"/
  );
  assert.match(html, /仅保存在当前本机服务进程内存/);
  assert.match(html, /服务重启后失效/);
  assert.doesNotMatch(html, />服务启停<\/a>/);
  assert.match(html, /http:\/\/localhost:3042\//);

  assert.match(
    studio,
    /fetch\("\/api\/knowledge\/materials\/config",\s*\{\s*method:\s*"POST"/s
  );
  assert.doesNotMatch(studio, /localStorage|sessionStorage/);
});

test("material studio selects exactly one source technique per request", () => {
  const html = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8"
  );
  const studio = readFileSync(
    new URL("../public/knowledge-material-studio.js", import.meta.url),
    "utf8"
  );

  const techniqueValues = [
    ...html.matchAll(
      /name="materialTechnique"\s+value="([^"]+)"/g
    )
  ].map((match) => match[1]);
  assert.deepEqual(techniqueValues, [
    "deeptutor",
    "openmaic",
    "koji",
    "cell_studio"
  ]);
  assert.equal(
    (html.match(/name="materialTechnique"[^>]*checked/g) || []).length,
    1
  );
  assert.doesNotMatch(html, /四类技术产物/);
  assert.match(
    studio,
    /fetch\("\/api\/knowledge\/materials\/generate\/trace",\s*\{/
  );
  assert.match(studio, /accept:\s*"application\/x-ndjson"/);
  assert.match(
    studio,
    /body:\s*JSON\.stringify\(\{[\s\S]*?technique:\s*technique\.key[\s\S]*?model_policy:\s*technique\.native[\s\S]*?"upstream_required"[\s\S]*?"source_first"/
  );
  assert.match(
    studio,
    /grid\.replaceChildren\(card\);[\s\S]*?grid\.setAttribute\("aria-busy",\s*"true"\)/
  );
});

test("material Trace is placed before the native result grid and stays memory-only", () => {
  const html = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8"
  );
  const studio = readFileSync(
    new URL("../public/knowledge-material-studio.js", import.meta.url),
    "utf8"
  );
  const traceStart = studio.indexOf(
    "function createMaterialTraceController"
  );
  const traceEnd = studio.indexOf(
    "function materialTraceProtocolError",
    traceStart
  );
  const traceSource = studio.slice(traceStart, traceEnd);

  assert.ok(
    html.indexOf('id="materialTracePanel"') <
      html.indexOf('id="materialTechniqueGrid"')
  );
  assert.match(html, /本机调试输出，可能包含题目答案/);
  assert.match(html, /id="materialTraceCopy"/);
  assert.match(html, /id="materialTraceSteps"/);
  assert.match(html, /id="materialTraceOutputs"/);
  assert.match(traceSource, /maxEvents/);
  assert.match(traceSource, /maxOutputPerCall/);
  assert.match(traceSource, /type === "model\.delta"/);
  assert.match(traceSource, /normalized\.discarded/);
  assert.match(traceSource, /次尝试未被采用/);
  assert.match(traceSource, /createTextNode/);
  assert.match(traceSource, /\.textContent\s*=/);
  assert.doesNotMatch(traceSource, /innerHTML|localStorage|console\./);
});

test("incremental Trace parser accepts split CRLF NDJSON messages", () => {
  const parser = createKnowledgeMaterialNdjsonParser();
  const trace = {
    type: "trace",
    event: {
      sequence: 1,
      stage: "model.generate",
      status: "running",
      call_id: "call-1",
      delta: "洛必达"
    }
  };
  const terminal = {
    type: "result",
    public_bundle: { id: "bundle-1" },
    provider: { model: "model-1" }
  };
  const wire = `${JSON.stringify(trace)}\r\n\r\n${JSON.stringify(
    terminal
  )}\n`;
  const splitAt = wire.indexOf("洛");

  assert.deepEqual(parser.push(wire.slice(0, splitAt)), []);
  assert.deepEqual(parser.push(wire.slice(splitAt)), [trace, terminal]);
  assert.deepEqual(parser.finish(), []);
});

test("incremental Trace parser rejects unsafe lines without echoing payloads", () => {
  const sensitiveMarker = "ark-secret-marker";
  const parser = createKnowledgeMaterialNdjsonParser({
    maxLineLength: 24
  });

  assert.throws(
    () => parser.push(`{"type":"${sensitiveMarker}`),
    (error) => {
      assert.equal(error.name, "MaterialTraceProtocolError");
      assert.equal(error.code, "trace_line_too_large");
      assert.equal(error.message.includes(sensitiveMarker), false);
      return true;
    }
  );

  const invalid = createKnowledgeMaterialNdjsonParser();
  assert.throws(
    () => invalid.push(`{${sensitiveMarker}}\n`),
    (error) => {
      assert.equal(error.code, "invalid_trace_ndjson");
      assert.equal(error.message.includes(sensitiveMarker), false);
      return true;
    }
  );
});

test("Trace stream decodes split UTF-8 chunks and returns its terminal result", async () => {
  const encoder = new TextEncoder();
  const trace = {
    type: "trace",
    event: {
      sequence: 9,
      timestamp: "2026-07-27T10:00:00.000Z",
      elapsed_ms: 42,
      type: "model_delta",
      stage: "model.generate",
      status: "running",
      title: "模型生成",
      message: "流式返回",
      call_id: "call-native-1",
      delta: "中文增量",
      meta: { model: "native-model" }
    }
  };
  const terminal = {
    type: "result",
    public_bundle: { id: "native-result" },
    provider: { model: "native-model" }
  };
  const bytes = encoder.encode(
    `${JSON.stringify(trace)}\n${JSON.stringify(terminal)}\n`
  );
  const chineseBytes = encoder.encode("中");
  const chineseIndex = bytes.findIndex(
    (_, index) =>
      chineseBytes.every(
        (value, offset) => bytes[index + offset] === value
      )
  );
  const splitAt = chineseIndex + 1;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, splitAt));
      controller.enqueue(bytes.slice(splitAt));
      controller.close();
    }
  });
  const received = [];

  const result = await readKnowledgeMaterialTraceStream(
    {
      body,
      status: 200,
      text: async () => ""
    },
    {
      onTrace(event) {
        received.push(event);
      }
    }
  );

  assert.deepEqual(received, [trace.event]);
  assert.deepEqual(result, terminal);
});

test("native DeepTutor result keeps Book, Spine, Page and src/dst graph edges", () => {
  const normalized = normalizeDeepTutorNativeResult({
    ok: true,
    native_result: {
      book: { id: "book-1", title: "力学" },
      spine: {
        chapters: [
          { id: "chapter-2", order: 2, title: "应用" },
          { id: "chapter-1", order: 1, title: "基础" }
        ],
        concept_graph: {
          nodes: [
            { id: "force", label: "力" },
            { id: "acceleration", label: "加速度" }
          ],
          edges: [
            { src: "force", dst: "acceleration", relation: "depends_on" }
          ]
        }
      },
      pages: {
        page_2: { order: 2, title: "应用页" },
        page_1: { order: 1, title: "概览页" }
      }
    }
  });

  assert.equal(normalized.book.title, "力学");
  assert.deepEqual(
    normalized.chapters.map((chapter) => chapter.id),
    ["chapter-1", "chapter-2"]
  );
  assert.deepEqual(
    normalized.pages.map((page) => page.id),
    ["page_1", "page_2"]
  );
  assert.deepEqual(normalized.conceptGraph.edges[0], {
    src: "force",
    dst: "acceleration",
    relation: "depends_on"
  });
});

test("native OpenMAIC result keeps official Stage, Scene and Action contracts", () => {
  const normalized = normalizeOpenMaicNativeResult({
    stage: { id: "stage-1", name: "牛顿课堂" },
    session: {
      sceneOutlines: [{ id: "outline-1", order: 0 }]
    },
    scenes: [
      {
        id: "scene-2",
        order: 2,
        type: "quiz",
        content: { type: "quiz", questions: [] },
        actions: []
      },
      {
        id: "scene-1",
        order: 1,
        type: "slide",
        content: {
          type: "slide",
          canvas: { viewportSize: 1000, viewportRatio: 0.5625, elements: [] }
        },
        actions: [
          { id: "action-1", type: "spotlight", elementId: "title" }
        ]
      }
    ]
  });

  assert.equal(normalized.stage.id, "stage-1");
  assert.deepEqual(
    normalized.scenes.map((scene) => scene.id),
    ["scene-1", "scene-2"]
  );
  assert.equal(normalized.outlines[0].id, "outline-1");
  assert.equal(normalized.actions[0].type, "spotlight");
  assert.equal(normalized.actions[0].sceneId, "scene-1");
});

test("describes official OpenMAIC actions without requiring compact projection fields", () => {
  assert.deepEqual(
    describeNativeOpenMaicAction(
      {
        id: "speak-1",
        type: "speech",
        text: "先观察合外力方向。"
      },
      2
    ),
    {
      index: 2,
      type: "speech",
      targetId: "",
      narration: "先观察合外力方向。",
      duration: 1200
    }
  );
  assert.equal(
    describeNativeOpenMaicAction({
      type: "widget_highlight",
      target: "#force-vector",
      content: "聚焦力矢量"
    }).targetId,
    "#force-vector"
  );
});

test("native source event and footers do not publish A2UI projection fields", () => {
  const studio = readFileSync(
    new URL("../public/knowledge-material-studio.js", import.meta.url),
    "utf8"
  );

  assert.match(
    studio,
    /detail:\s*technique\.native\s*\?\s*\{\s*bundle,\s*source_result:/s
  );
  assert.doesNotMatch(
    studio,
    /detail:\s*technique\.native\s*\?\s*\{[^}]*a2ui:/s
  );
  assert.match(
    studio,
    /nativeProvenanceLabel\(bundle,\s*"deeptutor",\s*\{[\s\S]*?license:\s*"Apache-2\.0"/
  );
  assert.match(
    studio,
    /nativeProvenanceLabel\(bundle,\s*"openmaic",\s*\{[\s\S]*?license:\s*"MIT"/
  );
});

test("native OpenMAIC single-choice quiz uses the existing trusted grade route", () => {
  const studio = readFileSync(
    new URL("../public/knowledge-material-studio.js", import.meta.url),
    "utf8"
  );

  assert.match(
    studio,
    /function renderNativeQuizQuestion\(question,\s*index,\s*bundleId\)/
  );
  assert.match(
    studio,
    /canUseTrustedGrade[\s\S]*?fetch\("\/api\/knowledge\/materials\/grade",\s*\{[\s\S]*?bundle_id:\s*bundleId[\s\S]*?question_id:\s*question\.id[\s\S]*?selected:\s*selectedValue/
  );
  assert.match(studio, /正在由服务端可信判题/);
});
