import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOntologyEChartsOption,
  buildOntologyGraphModel,
  normalizeOntologyGraphPayload,
} from "../public/ontology-workbench.js";

const payload = {
  ontology: {
    ontology_id: "demo",
    ontology_version: "1.0",
    name: "演示本体",
    schema_version: "learning-ontology@1.0",
  },
  entities: [
    { id: "theme:1", entity_kind: "theme", entity_class: "theme", name: "函数" },
    { id: "kp:1", entity_kind: "knowledge_point", entity_class: "concept", name: "一次函数" },
  ],
  relations: [
    { id: "r:1", source: "kp:1", target: "theme:1", type: "part_of", directed: true },
  ],
  question_nodes: [
    { id: "q:1", title: "一次函数选择题", stem: "判断斜率", question_type: "single_choice" },
  ],
  question_relations: [
    { source: "q:1", target: "kp:1", type: "assesses", weight: 1 },
  ],
};

test("ontology workbench normalizes entities, questions and their relations", () => {
  const graph = normalizeOntologyGraphPayload(payload);
  assert.equal(graph.ontology.id, "demo");
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.nodes.find((node) => node.id === "q:1").kind, "question");
});

test("question toggle removes question nodes and dangling edges", () => {
  const graph = normalizeOntologyGraphPayload(payload);
  const model = buildOntologyGraphModel(graph, { includeQuestions: false });
  assert.equal(model.totalNodeCount, 2);
  assert.equal(model.totalEdgeCount, 1);
  assert.equal(model.nodes.some((node) => node.id === "q:1"), false);
});

test("search and relation filters preserve graph positions by dimming non matches", () => {
  const graph = normalizeOntologyGraphPayload(payload);
  const model = buildOntologyGraphModel(graph, {
    query: "一次函数",
    relationType: "assesses",
    includeQuestions: true,
  });
  assert.equal(model.totalNodeCount, 3);
  assert.equal(model.totalEdgeCount, 1);
  assert.equal(model.matchingNodeCount, 2);
  assert.equal(model.nodes.find((node) => node.id === "theme:1").itemStyle.opacity, 0.12);
});

test("echarts option uses a zoomable force graph", () => {
  const model = buildOntologyGraphModel(normalizeOntologyGraphPayload(payload));
  const option = buildOntologyEChartsOption(model);
  assert.equal(option.series[0].type, "graph");
  assert.equal(option.series[0].layout, "force");
  assert.equal(option.series[0].roam, true);
});
