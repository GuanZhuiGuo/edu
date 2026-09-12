import assert from "node:assert/strict";
import test from "node:test";
import { SUBJECTS, TOPICS, getTopicLabel } from "../public/courseware-taxonomy.js";
import { TECHNOLOGIES, EFFECTS, CAPABILITIES, filterTechnologies, groupTechnologies } from "../public/technology-catalog-data.js";

const find = name => TECHNOLOGIES.find(item => item.name === name);
const names = items => items.map(item => item.name);

test("catalog facets use shared subjects/topics and preserve multiple effects and responsibilities", () => {
  const topicIds = new Set(TOPICS.map(topic => topic.id));
  assert.equal(new Set(TECHNOLOGIES.map(item => item.id)).size, TECHNOLOGIES.length);
  for (const item of TECHNOLOGIES) {
    assert.ok(item.effects.length && item.capabilities.length, item.name);
    assert.ok(item.effects.every(effect => EFFECTS.includes(effect)), item.name);
    assert.ok(item.capabilities.every(capability => CAPABILITIES.includes(capability)), item.name);
    assert.ok(item.subjects.every(subject => SUBJECTS.includes(subject)), item.name);
    assert.ok(item.topics.every(topic => topicIds.has(topic)), item.name);
    assert.ok(item.boundary && item.evidence, item.name);
  }
  assert.ok(find("GeoGebra Integration").effects.includes("二维图解"));
  assert.ok(find("GeoGebra Integration").effects.includes("三维空间"));
  assert.deepEqual(find("KaTeX").capabilities, ["渲染"]);
  assert.ok(find("MathLive").capabilities.includes("编辑"));
});

test("default teaching supply excludes candidates and protocol infrastructure", () => {
  const groups = groupTechnologies(TECHNOLOGIES);
  assert.equal(TECHNOLOGIES.length, 46);
  assert.equal(groups.teaching.length, 16);
  assert.equal(groups.alternatives.length, 26);
  assert.equal(groups.foundation.length, 4);
  assert.ok(groups.teaching.every(item => item.status === "implemented" && item.group === "teaching"));
  assert.ok(groups.alternatives.every(item => item.status !== "implemented"));
  assert.ok(groups.foundation.every(item => item.group === "foundation"));
  assert.equal(groups.teaching.length + groups.alternatives.length + groups.foundation.length, TECHNOLOGIES.length);
  assert.ok(!names(groups.teaching).includes("JSON Schema"));
  assert.ok(!names(groups.teaching).includes("Manim"));
});

test("implemented callers stay distinct from optional source capabilities", () => {
  for (const name of ["KaTeX", "Three.js", "Apache ECharts", "AntV G6", "FFmpeg", "Seedream", "Seedance", "DeepTutor", "OpenMAIC", "Cell Architecture Studio", "SVG"]) {
    assert.equal(find(name).status, "implemented", name);
  }
  assert.equal(find("JSXGraph").status, "candidate");
  assert.equal(find("Manim").status, "candidate");
  assert.equal(find("Mermaid").status, "existing");
  assert.match(find("Planck.js").url, /github\.com\/piqnt\/planck\.js$/u);
  assert.match(find("Revideo").url, /github\.com\/midrender\/revideo$/u);
  assert.match(find("RDKit.js").url, /github\.com\/rdkit\/rdkit-js$/u);
});

test("Ark image and video generation are discoverable separately from recording and composition", () => {
  const images = names(filterTechnologies(TECHNOLOGIES, { effects: ["二维图解"], capabilities: ["生成"], status: "implemented" }));
  const videos = names(filterTechnologies(TECHNOLOGIES, { effects: ["音视频"], capabilities: ["生成"], status: "implemented" }));
  assert.ok(images.includes("Seedream")); assert.ok(!images.includes("Seedance"));
  assert.deepEqual(videos, ["Seedance"]);
  for (const name of ["Seedream", "Seedance"]) {
    assert.deepEqual(find(name).subjects, []);
    assert.deepEqual(find(name).topics, ["general/interdisciplinary"]);
    assert.deepEqual(find(name).capabilities, ["生成"]);
    assert.match(find(name).boundary, /配置.*凭证.*上游/u);
    assert.match(find(name).evidence, /education-video-service\.js.*ark-media-client\.js/u);
    assert.ok(names(filterTechnologies(TECHNOLOGIES, { subjects: ["语文"], query: name })).includes(name));
  }
  assert.equal(find("Seedream").url, "");
  assert.equal(find("Seedance").url, "https://www.volcengine.com/product/seedance");
  assert.deepEqual(find("FFmpeg").capabilities, ["编辑", "导出"]);
  assert.deepEqual(find("MediaRecorder").capabilities, ["导出"]);
});

test("facet selections use OR within a dimension and AND across dimensions", () => {
  const filtered = filterTechnologies(TECHNOLOGIES, {
    effects: ["三维空间", "音视频"], capabilities: ["导出"], status: "implemented"
  });
  assert.ok(names(filtered).includes("MediaRecorder"));
  assert.ok(names(filtered).includes("FFmpeg"));
  assert.ok(!names(filtered).includes("Three.js"));
  assert.ok(!names(filtered).includes("Manim"));
  assert.equal(filterTechnologies(TECHNOLOGIES, { effects: ["三维空间"], query: "not-a-technology" }).length, 0);
});

test("subject and topic filtering keeps cross-subject tools without inventing domain support", () => {
  const chemistry = names(filterTechnologies(TECHNOLOGIES, { subjects: ["化学"], topics: ["chemistry/reactions"] }));
  assert.ok(chemistry.includes("RDKit.js"));
  assert.ok(chemistry.includes("OpenMAIC"));
  assert.ok(!chemistry.includes("Cell Architecture Studio"));
  assert.ok(!chemistry.includes("Matter.js"));
  assert.ok(names(filterTechnologies(TECHNOLOGIES, { topics: ["biology/organisms"] })).includes("Cell Architecture Studio"));
});

test("teachers can search technical names and shared human-readable knowledge topics", () => {
  assert.deepEqual(names(filterTechnologies(TECHNOLOGIES, { query: "  THREE.JS " })), ["Three.js"]);
  assert.ok(names(filterTechnologies(TECHNOLOGIES, { query: getTopicLabel("math/geometry") })).includes("SVG"));
  assert.ok(names(filterTechnologies(TECHNOLOGIES, { query: "Cell Studio" })).includes("Cell Architecture Studio"));
  assert.equal(filterTechnologies(TECHNOLOGIES, {}).length, TECHNOLOGIES.length);
});
