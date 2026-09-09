import test from "node:test";
import assert from "node:assert/strict";
import { GENERATION_GUIDANCE } from "../public/generation-guidance.js";

const REQUIRED_SUBJECTS = [
  "语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理",
  "道德与法治 / 思想政治", "信息科技", "通用技术", "科学（小学综合）",
  "音乐", "美术", "体育与健康", "劳动与综合实践",
];

const READY_ARTIFACTS = new Set([
  "function_graph", "projectile_lab", "physics_lab", "acid_base_lab", "mindmap", "concept_cards",
]);

test("generation guidance covers every mainstream school subject with concrete examples", () => {
  assert.deepEqual(GENERATION_GUIDANCE.map((item) => item.name), REQUIRED_SUBJECTS);
  assert.equal(GENERATION_GUIDANCE.length, 16);
  for (const subject of GENERATION_GUIDANCE) {
    assert.ok(subject.examples.length >= 3, `${subject.name} should include at least three examples`);
    assert.ok(subject.summary.length >= 8);
  }
});

test("physics guidance offers exactly the three supported experiments with explicit engine and preset choices", () => {
  const examples = GENERATION_GUIDANCE.find((subject) => subject.name === "物理")
    .examples.filter((item) => item.artifact === "physics_lab");
  assert.deepEqual(examples.map((item) => [item.physicsPreset, item.physicsEngine]), [
    ["inclined_plane", "matter"], ["pendulum", "matter"], ["collision", "planck"],
  ]);
  assert.ok(examples.every((item) => item.status === "ready"));
  assert.match(examples[1].reason, /小角度.*近似/u);
  assert.match(examples[2].reason, /无摩擦一维正碰预设/u);
});

test("ready examples only promise implemented Lesson DSL artifacts", () => {
  const examples = GENERATION_GUIDANCE.flatMap((subject) => subject.examples);
  const ready = examples.filter((item) => item.status === "ready");
  assert.ok(ready.length >= 25);
  for (const item of ready) {
    assert.ok(READY_ARTIFACTS.has(item.artifact), `${item.id} exposes an unsupported artifact`);
    assert.equal(item.fallbackArtifact, "");
  }
});

test("planned examples expose a technology route and a safe current fallback", () => {
  const examples = GENERATION_GUIDANCE.flatMap((subject) => subject.examples);
  const identifiers = examples.map((item) => item.id);
  assert.equal(new Set(identifiers).size, identifiers.length);
  for (const item of examples.filter((entry) => entry.status === "candidate")) {
    assert.ok(item.technology.length > 0, `${item.id} is missing a technology route`);
    assert.ok(READY_ARTIFACTS.has(item.fallbackArtifact), `${item.id} is missing a safe fallback`);
    assert.equal(item.artifact, "");
  }
});
