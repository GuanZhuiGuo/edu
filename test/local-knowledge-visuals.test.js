import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createLocalKnowledgeVisualIndex,
  inferLocalKnowledgeVisualMode,
  isLocalKnowledgeFollowUpQuery,
  resolveLocalKnowledgeVisual
} from "../public/local-knowledge-visuals.js";

const catalogPath = new URL("../public/data/junior-math-visual-artifacts.json", import.meta.url);

async function loadIndex() {
  return createLocalKnowledgeVisualIndex(JSON.parse(await readFile(catalogPath, "utf8")));
}

test("local visual index joins all 140 knowledge points by stable id", async () => {
  const index = await loadIndex();
  assert.equal(index.artifacts.length, 140);
  assert.equal(index.byKnowledgePointId.size, 140);
  assert.equal(index.byArtifactId.size, 140);
  assert.equal(index.byKnowledgePointId.get("M4-GE-TRI-10")?.interactive?.variant, "triangle");
});

test("local retrieval resolves common Chinese knowledge requests", async () => {
  const index = await loadIndex();
  assert.equal(resolveLocalKnowledgeVisual(index, "给我一次函数的思维导图")?.knowledge_point_id, "M4-NA-FUN-06");
  assert.equal(resolveLocalKnowledgeVisual(index, "勾股定理的知识网络")?.knowledge_point_id, "M4-GE-TRI-10");
  assert.equal(resolveLocalKnowledgeVisual(index, "画一个二次函数图象")?.interactive?.variant, "quadratic");
  assert.equal(resolveLocalKnowledgeVisual(index, "画一个一次函数图象")?.knowledge_point_id, "M4-NA-FUN-07");
});

test("stable knowledge point id takes precedence over fuzzy text", async () => {
  const index = await loadIndex();
  const artifact = resolveLocalKnowledgeVisual(index, "请给我一张图", { knowledgePointId: "M4-ST-PROB-01" });
  assert.equal(artifact?.knowledge_point_id, "M4-ST-PROB-01");
  assert.equal(artifact?.interactive?.variant, "probability");
});

test("visual intent chooses network or interactive rendering without guessing", () => {
  assert.equal(inferLocalKnowledgeVisualMode("看勾股定理的前后置知识"), "mindmap");
  assert.equal(inferLocalKnowledgeVisualMode("用数轴演示不等式"), "interactive");
  assert.equal(inferLocalKnowledgeVisualMode("请讲一下一次函数"), "");
});

test("generic follow-up language does not steal a new knowledge point", async () => {
  const index = await loadIndex();
  for (const text of ["请解释一下", "分析一下", "判断一下", "继续讲这个"]) {
    assert.equal(isLocalKnowledgeFollowUpQuery(text), true, text);
    assert.equal(resolveLocalKnowledgeVisual(index, text), null, text);
  }
  assert.equal(isLocalKnowledgeFollowUpQuery("解释一次函数"), false);
  assert.equal(resolveLocalKnowledgeVisual(index, "解释一次函数")?.knowledge_point_id, "M4-NA-FUN-06");
});
