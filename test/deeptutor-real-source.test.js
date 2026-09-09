import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DeepTutorNativeBridgeError,
  runDeepTutorNative
} from "../source-bridges/deeptutor/index.js";

const SOURCE = {
  source_id: "source_newton",
  title: "牛顿第二定律",
  language: "zh-CN",
  estimated_chapters: 3,
  source_text:
    "牛顿第二定律说明物体的加速度与所受合外力成正比，与质量成反比。分析动力学问题时，应先选择研究对象、画受力图、求合外力，再列出 F=ma。"
};

const DRAFT = {
  concept_graph: {
    nodes: [
      {
        id: "force",
        label: "合外力",
        description: "全部外力的矢量和",
        weight: 1
      },
      {
        id: "acceleration",
        label: "加速度",
        description: "速度的变化率",
        weight: 1
      }
    ],
    edges: [
      {
        src: "force",
        dst: "acceleration",
        relation: "depends_on",
        rationale: "合外力决定加速度"
      }
    ]
  },
  chapters: [
    {
      title: "合外力",
      learning_objectives: ["理解合外力"],
      content_type: "concept",
      covers: ["force"],
      source_anchors: [
        {
          kind: "manual",
          ref: "source_newton",
          snippet: "所受合外力成正比"
        }
      ],
      prerequisites: [],
      summary: "先识别研究对象受到的全部外力。"
    },
    {
      title: "加速度关系",
      learning_objectives: ["解释 F=ma"],
      content_type: "theory",
      covers: ["acceleration"],
      source_anchors: [
        {
          kind: "manual",
          ref: "source_newton",
          snippet: "加速度与所受合外力成正比"
        }
      ],
      prerequisites: ["合外力"],
      summary: "用 F=ma 连接合外力、质量和加速度。"
    }
  ]
};

function sectionOutline() {
  return {
    intro: "从受力分析进入牛顿第二定律的核心关系。",
    subsections: [
      {
        heading: "识别合外力",
        role: "core",
        focus: "选择研究对象并求全部外力的矢量和",
        target_words: 260
      },
      {
        heading: "列式并解释",
        role: "application",
        focus: "用 F=ma 解释质量、合外力和加速度的关系",
        target_words: 280
      }
    ],
    key_takeaway: "先画受力图求合外力，再用 F=ma 建立动力学关系。"
  };
}

function sectionBody() {
  return {
    content:
      "先明确研究对象，再把每一个外力按方向分解并进行矢量求和。得到合外力后，将它代入 F=ma，就能判断加速度的大小和方向。"
  };
}

test("runs the pinned upstream SpineSynthesizer and BookEngine through RPC", async () => {
  const calls = [];
  const traces = [];
  let traceCallbackCount = 0;
  const client = {
    async generateJson(request) {
      calls.push(request.schemaName);
      assert.equal(request.stream, true);
      assert.equal(typeof request.onTrace, "function");
      assert.equal(
        request.traceContext.stage,
        `deeptutor.${request.schemaName.replace("deeptutor_native_", "")}`
      );
      assert.match(request.traceContext.callId, /^llm_\d+$/);
      request.onTrace({
        type: "model.delta",
        stage: request.traceContext.stage,
        status: "streaming",
        call_id: request.traceContext.callId,
        delta: "模型流式片段",
        meta: { sequence: 1 }
      });
      if (request.schemaName.includes("section_outline")) {
        return sectionOutline();
      }
      if (request.schemaName.includes("section_subsection")) {
        assert.equal(request.schema.required[0], "content");
        return sectionBody();
      }
      if (request.schemaName.includes("critique")) {
        return {
          issues: [
            {
              category: "granularity",
              detail: "需要显式保留解题步骤。",
              fix_hint: "在第二章摘要中保留受力图步骤。"
            }
          ],
          verdict: "revise"
        };
      }
      return structuredClone(DRAFT);
    }
  };

  const result = await runDeepTutorNative(SOURCE, {
    client,
    environment: {
      ...process.env,
      ARK_API_KEY: "must-not-reach-python"
    },
    onTrace(event) {
      traceCallbackCount += 1;
      traces.push(event);
      if (traceCallbackCount === 1) {
        throw new Error("trace observer failure must be isolated");
      }
      if (traceCallbackCount === 2) {
        return Promise.reject(
          new Error("async trace observer failure must be isolated")
        );
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.provenance.native, true);
  assert.equal(
    result.provenance.source_revision,
    "47d05809ea5d19e8b1390d4b42402302c37709bb"
  );
  assert.deepEqual(
    result.execution.rounds.map((round) => round.label),
    ["draft", "critique_1", "revise_1"]
  );
  assert.equal(calls.filter((name) => name.includes("section_outline")).length, 2);
  assert.equal(calls.filter((name) => name.includes("section_subsection")).length, 4);
  assert.ok(
    result.execution.module_origins.spine_synthesizer.includes(
      "/third_party/deeptutor/deeptutor/book/agents/spine_synthesizer.py"
    )
  );
  assert.ok(
    result.execution.module_origins.book_compiler.includes(
      "/third_party/deeptutor/deeptutor/book/compiler.py"
    )
  );
  assert.ok(
    result.execution.module_origins.section_generator.includes(
      "/third_party/deeptutor/deeptutor/book/blocks/section.py"
    )
  );

  const { book, exploration, spine, pages } = result.native_result;
  assert.equal(book.id, spine.book_id);
  assert.equal(exploration.chunks[0].text, SOURCE.source_text);
  assert.equal(spine.chapters[0].content_type, "overview");
  assert.equal(pages.length, spine.chapters.length);

  const overviewPage = pages.find((page) => page.content_type === "overview");
  assert.deepEqual(
    overviewPage.blocks.map((block) => block.type),
    ["text", "concept_graph", "text"]
  );
  assert.equal(
    overviewPage.blocks[1].payload.render_type,
    "concept_graph"
  );
  const regularPage = pages.find((page) => page.content_type !== "overview");
  assert.equal(regularPage.status, "ready");
  assert.deepEqual(
    regularPage.blocks.map((block) => block.type),
    ["section"]
  );
  assert.ok(regularPage.blocks.every((block) => block.status === "ready"));
  assert.equal(regularPage.blocks[0].payload.subsections.length, 2);
  assert.match(
    regularPage.blocks[0].payload.subsections[0].body,
    /研究对象/
  );
  assert.equal(
    result.execution.compilation.profile,
    "official_primary_section"
  );
  assert.equal(result.execution.compilation.compiled_pages, 2);
  assert.ok(
    result.execution.upstream_symbols.includes("BookCompiler.compile_page")
  );
  assert.equal("material" in result.native_result, false);
  assert.equal("a2ui" in result.native_result, false);

  assert.ok(traceCallbackCount > 20);
  assert.ok(
    traces.some(
      (event) =>
        event.type === "process.start"
        && event.stage === "deeptutor.process"
        && event.status === "started"
    )
  );
  assert.ok(
    traces.some(
      (event) =>
        event.type === "process.complete"
        && event.stage === "deeptutor.process"
        && event.status === "completed"
    )
  );
  assert.ok(
    traces.some(
      (event) =>
        event.type === "phase.start"
        && event.stage === "deeptutor.spine_draft"
        && event.call_id === "llm_1"
    )
  );
  assert.ok(
    traces.some(
      (event) =>
        event.type === "model.success"
        && event.stage === "deeptutor.spine_draft"
        && event.status === "completed"
    )
  );
  assert.ok(
    traces.some(
      (event) =>
        event.type === "model.delta"
        && event.stage === "deeptutor.spine_draft"
        && event.delta === "模型流式片段"
    )
  );
  for (const stage of [
    "deeptutor.synthesis",
    "deeptutor.confirm_spine",
    "deeptutor.compilation"
  ]) {
    assert.ok(
      traces.some(
        (event) =>
          event.type === "phase.start"
          && event.stage === stage
          && event.status === "started"
      )
    );
    assert.ok(
      traces.some(
        (event) =>
          event.type === "phase.complete"
          && event.stage === stage
          && event.status === "completed"
      )
    );
  }
  assert.ok(
    traces.some(
      (event) =>
        event.type === "spine.round"
        && event.stage === "deeptutor.synthesis.critique_1"
    )
  );
  assert.equal(
    traces.filter(
      (event) =>
        event.type === "page.compile"
        && event.stage === "deeptutor.compilation.page"
        && event.status === "completed"
    ).length,
    2
  );
  assert.ok(
    traces.some(
      (event) =>
        event.type === "book.event"
        && event.meta?.kind === "block_ready"
        && event.status === "completed"
    )
  );
  const deepTutorLifecycleEvents = traces.filter(
    (event) => event.type !== "model.delta"
  );
  assert.ok(
    deepTutorLifecycleEvents.every(
      (event) =>
        typeof event.type === "string"
        && typeof event.stage === "string"
        && event.stage.startsWith("deeptutor.")
        && typeof event.status === "string"
        && typeof event.title === "string"
    )
  );
  const serializedTraces = JSON.stringify(traces);
  assert.doesNotMatch(serializedTraces, new RegExp(SOURCE.source_text));
  assert.doesNotMatch(
    serializedTraces,
    /must-not-reach-python|system_prompt|user_prompt|Traceback|third_party\//
  );
});

test("fails closed without a client or environment model configuration", async () => {
  const traces = [];
  await assert.rejects(
    runDeepTutorNative(SOURCE, {
      environment: {
        PATH: process.env.PATH || "",
        LANG: process.env.LANG || "en_US.UTF-8"
      },
      onTrace: (event) => traces.push(event)
    }),
    (error) => {
      assert.ok(error instanceof DeepTutorNativeBridgeError);
      assert.equal(error.code, "MISSING_LLM_CONFIGURATION");
      assert.doesNotMatch(error.message, /key-|Bearer|authorization/i);
      return true;
    }
  );
  assert.ok(traces.some((event) => event.type === "process.start"));
  const errorTrace = traces.find((event) => event.type === "process.error");
  assert.ok(errorTrace);
  assert.deepEqual(errorTrace.meta, {
    error_code: "MISSING_LLM_CONFIGURATION"
  });
  assert.equal("message" in errorTrace, false);
});

test("runs the upstream revise method even when critique initially says ok", async () => {
  const stages = [];
  const client = {
    async generateJson(request) {
      stages.push(request.schemaName);
      if (request.schemaName.includes("section_outline")) {
        return sectionOutline();
      }
      if (request.schemaName.includes("section_subsection")) {
        return sectionBody();
      }
      if (request.schemaName.includes("critique")) {
        return { issues: [], verdict: "ok" };
      }
      return structuredClone(DRAFT);
    }
  };

  const result = await runDeepTutorNative(SOURCE, { client });
  assert.deepEqual(
    result.execution.rounds.map((round) => round.label),
    ["draft", "critique_1", "revise_required"]
  );
  assert.equal(stages.filter((name) => name.includes("critique")).length, 1);
  assert.equal(stages.filter((name) => name.includes("section_outline")).length, 2);
  assert.ok(
    result.execution.upstream_symbols.includes("SpineSynthesizer._revise")
  );
});

test("emits a code-only model error trace when the parent model fails", async () => {
  const traces = [];
  const client = {
    async generateJson() {
      const error = new Error("provider detail must never enter DeepTutor traces");
      error.code = "ark_http_error";
      throw error;
    }
  };

  await assert.rejects(
    runDeepTutorNative(SOURCE, {
      client,
      onTrace: (event) => traces.push(event)
    }),
    (error) => {
      assert.ok(error instanceof DeepTutorNativeBridgeError);
      assert.equal(error.code, "RPC_LLM_FAILED");
      return true;
    }
  );

  const modelError = traces.find((event) => event.type === "model.error");
  assert.ok(modelError);
  assert.equal(modelError.stage, "deeptutor.spine_draft");
  assert.deepEqual(modelError.meta, { error_code: "ark_http_error" });
  assert.equal("message" in modelError, false);
  assert.doesNotMatch(
    JSON.stringify(traces),
    /provider detail must never enter DeepTutor traces/
  );
  assert.ok(traces.some((event) => event.type === "process.error"));
});

test("emits an isolated abort lifecycle event before spawning", async () => {
  const controller = new AbortController();
  controller.abort();
  let abortTrace;

  await assert.rejects(
    runDeepTutorNative(SOURCE, {
      signal: controller.signal,
      onTrace(event) {
        abortTrace = event;
        throw new Error("abort observer failure must be isolated");
      }
    }),
    (error) => {
      assert.ok(error instanceof DeepTutorNativeBridgeError);
      assert.equal(error.code, "DEEPTUTOR_ABORTED");
      return true;
    }
  );

  assert.deepEqual(abortTrace, {
    type: "process.abort",
    stage: "deeptutor.process",
    status: "cancelled",
    title: "DeepTutor 源码进程已取消",
    meta: { error_code: "DEEPTUTOR_ABORTED" }
  });
});

test("the vendored checkout is exactly the audited v1.5.5 commit", () => {
  const repo = fileURLToPath(
    new URL("../third_party/deeptutor/", import.meta.url)
  );
  const commit = execFileSync(
    "git",
    ["-C", repo, "rev-parse", "HEAD"],
    { encoding: "utf8" }
  ).trim();
  const tag = execFileSync(
    "git",
    ["-C", repo, "describe", "--tags", "--exact-match", "HEAD"],
    { encoding: "utf8" }
  ).trim();
  assert.equal(commit, "47d05809ea5d19e8b1390d4b42402302c37709bb");
  assert.equal(tag, "v1.5.5");
});
