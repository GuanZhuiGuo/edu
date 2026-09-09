import assert from "node:assert/strict";
import test from "node:test";

import {
  DEEPTUTOR_SOURCE_PROVENANCE,
  generateDeepTutorSourceMaterial,
  renderDeepTutorMermaid
} from "../source-techniques/deeptutor-adapter.js";
import { validateDeepTutorOutput } from "../knowledge-material-pipeline.js";

const SOURCE = {
  source_id: "newton_source",
  title: "牛顿第二定律",
  language: "zh-CN",
  source_text:
    "牛顿第二定律说明物体的加速度与所受合外力成正比。质量越大，在相同合外力作用下加速度越小。分析动力学问题时，应先选择研究对象、画受力图、求合外力，再列出 F=ma。"
};

test("generates one deterministic source-first DeepTutor material without a model client", () => {
  const first = generateDeepTutorSourceMaterial(SOURCE);
  const second = generateDeepTutorSourceMaterial(structuredClone(SOURCE));

  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first.material).sort(), [
    "a2ui_projection",
    "blocks",
    "concept_graph",
    "flashcards"
  ]);
  assert.equal(first.provenance.local_adaptation.llm_used, false);
  assert.equal(first.book.spine.chapters.length, 3);
  assert.equal(first.book.overview.blocks[1].type, "concept_graph");
  assert.equal(
    first.book.overview.blocks[1].payload.code.language,
    "mermaid"
  );

  const validated = validateDeepTutorOutput(first.material, {
    claimIds: first.claims.map((claim) => claim.id)
  });
  assert.deepEqual(validated, first.material);
});

test("keeps every generated claim anchored to an exact source excerpt", () => {
  const result = generateDeepTutorSourceMaterial(SOURCE);
  for (const claim of result.claims) {
    assert.ok(SOURCE.source_text.includes(claim.source_support));
    assert.ok(claim.source_support.length >= 4);
    assert.ok(claim.text.length >= 8);
  }
  for (const chapter of result.book.spine.chapters) {
    assert.equal(chapter.source_anchors[0].ref, SOURCE.source_id);
    assert.ok(SOURCE.source_text.includes(chapter.source_anchors[0].snippet));
  }
});

test("uses markdown headings as chapters and ports the DeepTutor concept block plan", () => {
  const result = generateDeepTutorSourceMaterial({
    source_text:
      "# 基础概念\n速度描述位置变化的快慢，并且具有方向。\n\n# 计算方法\n平均速度等于位移与时间间隔的比值。\n\n# 应用判断\n计算前要先选定参考系，并区分路程与位移。",
    language: "zh-CN"
  });

  assert.deepEqual(
    result.book.spine.chapters.map((chapter) => chapter.title),
    ["基础概念", "计算方法", "应用判断"]
  );
  assert.deepEqual(
    result.book.spine.chapters[0].blocks.map((block) => block.type),
    [
      "section",
      "figure",
      "section",
      "flash_cards",
      "callout",
      "figure",
      "quiz"
    ]
  );
  assert.equal(
    result.book.spine.chapters[0].blocks[1].metadata.transition_in,
    "Map the related concepts"
  );
});

test("faithfully renders chapter mode, relation arrows, safe ids, and duplicate ids", () => {
  const mermaid = renderDeepTutorMermaid({
    nodes: [
      { id: "book root", label: 'A "quoted" book', chapter_id: "" },
      { id: "重复 id", label: "第一章", chapter_id: "ch_1" },
      { id: "重复-id", label: "第二章", chapter_id: "ch_2" }
    ],
    edges: [
      { src: "book root", dst: "重复 id", relation: "related" },
      { src: "重复 id", dst: "重复-id", relation: "extends" },
      { src: "missing", dst: "重复-id", relation: "depends_on" }
    ]
  });

  assert.match(mermaid, /^graph TD/m);
  assert.match(mermaid, /\(\["A 'quoted' book"\]\)/);
  assert.match(mermaid, /\["01 · 第一章"\]/);
  assert.match(mermaid, /\["02 · 第二章"\]/);
  assert.match(mermaid, /-\.->/);
  assert.match(mermaid, /==>/);
  assert.doesNotMatch(mermaid, /missing/);
});

test("records the exact upstream revision, license, files, and local boundary", () => {
  assert.equal(
    DEEPTUTOR_SOURCE_PROVENANCE.source_revision,
    "47d05809ea5d19e8b1390d4b42402302c37709bb"
  );
  assert.equal(DEEPTUTOR_SOURCE_PROVENANCE.license, "Apache-2.0");
  assert.ok(
    DEEPTUTOR_SOURCE_PROVENANCE.source_files.some(
      (entry) => entry.path === "deeptutor/book/blocks/concept_graph.py"
    )
  );
  assert.match(
    DEEPTUTOR_SOURCE_PROVENANCE.local_adaptation.reason,
    /LLM-backed/
  );
});

test("rejects malformed or out-of-contract source input", () => {
  assert.throws(
    () => generateDeepTutorSourceMaterial({ source_text: "too short" }),
    /20-20000/
  );
  assert.throws(
    () =>
      generateDeepTutorSourceMaterial({
        source_text: SOURCE.source_text,
        title: ""
      }),
    /source\.title/
  );
  assert.throws(
    () => generateDeepTutorSourceMaterial(null),
    /plain object/
  );
});
