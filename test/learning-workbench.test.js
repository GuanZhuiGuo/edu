import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  QUESTION_ATTRIBUTE_SCHEMA,
  QUESTION_HISTORY,
  buildGraphState,
  calculateQuestionAttributeStrengths,
  filterQuestionHistory,
  getQuestionAttributes,
  getQuestionHistory,
  getQuestionsForKnowledgePoint,
  insertKnowledgeMention
} from "../public/learning-workbench.js";
import {
  buildDependencyGraphData,
  buildMasteryGraphData,
  buildStructureTree
} from "../public/knowledge-visualizations.js";
import { buildKnowledgeStrategyGuide } from "../public/knowledge-detail-workbench.js";
import {
  calculateEducationImportProgress,
  deriveEducationImportTaskState,
} from "../public/education-import-client.js";

const ontologyPath = new URL("../public/data/junior-math-ontology.json", import.meta.url);
const masteryPath = new URL("../public/data/demo-student-mastery.json", import.meta.url);
const indexPath = new URL("../public/index.html", import.meta.url);
const userCourseRuntimePath = new URL("../public/user-course-runtime.js", import.meta.url);
const educationImportClientPath = new URL("../public/education-import-client.js", import.meta.url);
const clientPath = new URL("../public/client.js", import.meta.url);
const portalRuntimePath = new URL("../public/portal-runtime.js", import.meta.url);

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("junior math ontology is visualization-ready and internally consistent", async () => {
  const ontology = await loadJson(ontologyPath);
  assert.equal(ontology.schema_version, "learning-ontology@1.0");
  assert.equal(ontology.ontology_id, "junior-math-moe-2022");
  assert.equal(ontology.domains.length, 4);
  assert.equal(ontology.themes.length, 19);
  assert.equal(ontology.knowledge_points.length, 140);
  assert.equal(ontology.edges.length, 519);

  const nodes = [...ontology.domains, ...ontology.themes, ...ontology.knowledge_points];
  const nodeIds = new Set(nodes.map((node) => node.id));
  assert.equal(nodeIds.size, nodes.length, "ontology node ids must be unique");

  const edgeIds = new Set();
  const relationTypes = new Set(ontology.relation_types.map((relation) => relation.key));
  for (const edge of ontology.edges) {
    assert.equal(edgeIds.has(edge.id), false, `duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    assert.equal(nodeIds.has(edge.source), true, `missing source: ${edge.source}`);
    assert.equal(nodeIds.has(edge.target), true, `missing target: ${edge.target}`);
    assert.equal(relationTypes.has(edge.type), true, `unknown relation type: ${edge.type}`);
  }

  for (const point of ontology.knowledge_points) {
    assert.equal(nodeIds.has(point.theme_id), true, `missing theme: ${point.theme_id}`);
    assert.equal(nodeIds.has(point.domain_id), true, `missing domain: ${point.domain_id}`);
    assert.ok(point.visualization?.cluster_id, `${point.id} needs a visualization cluster`);
    assert.ok(point.source_ref?.printed_page, `${point.id} needs a source locator`);
  }
});

test("student mastery is a separate complete projection and self-report does not mutate it", async () => {
  const [ontology, mastery] = await Promise.all([loadJson(ontologyPath), loadJson(masteryPath)]);
  const pointIds = new Set(ontology.knowledge_points.map((point) => point.id));
  const masteryIds = mastery.records.map((record) => record.knowledge_point_id);

  assert.equal(mastery.schema_version, "student-knowledge-state@1.0");
  assert.equal(mastery.records.length, ontology.knowledge_points.length);
  assert.equal(new Set(masteryIds).size, masteryIds.length);
  assert.ok(masteryIds.every((id) => pointIds.has(id)));
  assert.ok(mastery.direct_assessment_preferences.length > 0);
  assert.ok(mastery.direct_assessment_preferences.every((preference) => preference.mastery_changed === false));

  const graph = buildGraphState(ontology, mastery);
  assert.equal(graph.pointById.size, 140);
  assert.equal(graph.masteryById.size, 140);
  assert.equal(graph.themeById.size, 19);
  assert.equal(graph.domainById.size, 4);
});

test("question history supports knowledge point, wrong-result and source filters", () => {
  const wrongQuestions = filterQuestionHistory(QUESTION_HISTORY, {
    search: "",
    knowledge: "all",
    result: "wrong",
    source: "all"
  });
  assert.ok(wrongQuestions.length > 0);
  assert.ok(wrongQuestions.every((question) => question.result === "wrong"));

  const similarTriangle = filterQuestionHistory(QUESTION_HISTORY, {
    search: "",
    knowledge: "M4-GE-SIM-05",
    result: "all",
    source: "exam"
  });
  assert.equal(similarTriangle.length, 1);
  assert.match(similarTriangle[0].stem, /相似/);
});

test("question attributes cover the blueprint dimensions and join knowledge points to attempts", () => {
  assert.equal(QUESTION_ATTRIBUTE_SCHEMA.schemaVersion, "question-attribute-profile@1.0");
  assert.deepEqual(
    QUESTION_ATTRIBUTE_SCHEMA.fields.map((field) => field.key),
    [
      "knowledgePoints",
      "questionType",
      "propositionMethod",
      "abilityLevel",
      "context",
      "difficulty",
      "strategies",
      "multipleSolutions",
      "source",
      "evidenceStatus"
    ]
  );
  const question = QUESTION_HISTORY.find((item) => item.id === "QH-20260806-001");
  const attributes = getQuestionAttributes(question);
  assert.equal(attributes.knowledgePoints[0].id, "M4-GE-TRI-10");
  assert.equal(attributes.questionType, "计算题");
  assert.ok(attributes.strategies.length > 0);
  assert.equal(filterQuestionHistory([question], {
    search: "",
    knowledge: "M4-GE-TRI-10",
    result: "all",
    source: "all"
  }).some((item) => item.id === question.id), true);
});

test("strong question attributes require repeated non-pending attempt evidence", () => {
  const strengths = calculateQuestionAttributeStrengths(QUESTION_HISTORY);
  assert.ok(strengths.length > 0);
  assert.ok(strengths.every((item) => item.count >= 2 && item.rate >= 0.68));

  const pendingOnly = [0, 1].map((index) => ({
    id: `pending-${index}`,
    type: "选择题",
    source: "teacher",
    result: "correct",
    knowledgePoints: [{ id: "M4-TEST", name: "测试知识点" }],
    attributes: {
      questionType: "选择题",
      propositionMethod: "直接考查",
      abilityLevel: "运算求解",
      context: "纯数学",
      difficulty: "基础",
      strategies: ["数量关系建模"],
      multipleSolutions: "单一主路径",
      source: "teacher",
      evidenceStatus: "pending"
    }
  }));
  assert.deepEqual(calculateQuestionAttributeStrengths(pendingOnly), []);
});

test("question runtime does not fall back to local conversation or static mock data", () => {
  const previousStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem(key) {
      if (key !== "ai-classroom:wrong-question-notes") return null;
      return JSON.stringify([{
        session_id: "session-test",
        turn_id: "turn-test",
        knowledge_point_id: "M4-NA-FUN-06",
        knowledge_point_name: "理解一次函数和正比例函数，依据条件确定表达式",
        question: "一次函数为什么是直线？",
        answer: "一次函数的图象是一条直线。",
        created_at: "2026-08-10T10:00:00.000Z"
      }]);
    }
  };
  try {
    const history = getQuestionHistory();
    assert.deepEqual(history, []);
    assert.deepEqual(getQuestionsForKnowledgePoint("M4-NA-FUN-06"), []);
  } finally {
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousStorage;
  }
});

test("user switching only reacts to options inside the user menu", async () => {
  const source = await readFile(userCourseRuntimePath, "utf8");
  assert.match(source, /closest\("#learningUserMenu \[data-learning-user-id\]"\)/u);
  assert.doesNotMatch(source, /closest\("\[data-learning-user-id\]"\)/u);
});

test("the composer inserts a canonical knowledge mention and replaces a typed @ trigger", () => {
  assert.deepEqual(insertKnowledgeMention("请讲讲", 3, 3, "勾股定理"), {
    value: "请讲讲 @勾股定理 ",
    caret: 10
  });
  assert.deepEqual(insertKnowledgeMention("请讲 @", 4, 4, "一次函数"), {
    value: "请讲 @一次函数 ",
    caret: 9
  });
  assert.deepEqual(insertKnowledgeMention("请讲 @一次", 6, 6, "一次函数"), {
    value: "请讲 @一次函数 ",
    caret: 9
  });
});

test("the @ control reuses the real curriculum tree and consumes its canonical id per turn", async () => {
  const [html, workbenchSource, clientSource] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(new URL("../public/learning-workbench.js", import.meta.url), "utf8"),
    readFile(clientPath, "utf8")
  ]);
  assert.match(html, /id="teacherMentionBtn"[^>]*aria-controls="curriculumPicker"/u);
  assert.doesNotMatch(html, /id="teacherMentionPopover"|data-mention-knowledge/u);
  assert.match(workbenchSource, /mentionTrigger\?\.addEventListener\("click"[\s\S]*?sourceTrigger: mentionTrigger/u);
  assert.match(workbenchSource, /textQuestion\.value\[caret - 1\] !== "@"/u);
  assert.match(workbenchSource, /selectClassroomCurriculumPoint\(point\)[\s\S]*?nodeId: point\.id/u);
  assert.match(clientSource, /getSelectedCurriculumKnowledgePointIdForText\(text\)/u);
  assert.match(clientSource, /knowledge_point_id: knowledgePointIdOverride \|\| undefined/u);
  assert.match(clientSource, /clearSelectedCurriculumKnowledgePoint\(\);[\s\S]*?sendEducationAgentQuestion/u);
  assert.doesNotMatch(clientSource, /knowledge_point_id: selectedCurriculumKnowledgePointId \|\| undefined/u);
});

test("knowledge detail derives a safe strategy guide without private answers", () => {
  const guide = buildKnowledgeStrategyGuide([{
    type: "单项选择题",
    attributes: { strategies: ["数轴表征", "位置与距离比较"], propositionMethod: "方法辨析" },
    raw: { solution_preview: { strategy_labels: ["数轴表征"], first_hint: "先把数转换为数轴上的位置关系。" } }
  }]);
  assert.deepEqual(guide.strategies, ["数轴表征", "位置与距离比较"]);
  assert.deepEqual(guide.hints, ["先把数转换为数轴上的位置关系。"]);
  assert.deepEqual(guide.questionTypes, ["单项选择题"]);
  assert.deepEqual(guide.propositionMethods, ["方法辨析"]);
  assert.equal("answer" in guide, false);
});

test("learning workbench exposes one unique panel and one role-scoped menu entry for every navigation entry", async () => {
  const html = await readFile(indexPath, "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML ids must be unique");

  const roleViews = {
    student: ["agent", "course", "plan", "graph", "bank", "records", "buddy", "voice-config"],
    teacher: ["teacher-dashboard", "teacher-students", "teacher-courses", "graph", "bank", "teacher-plan", "agent", "materials", "agent-skills", "voice-config"]
  };
  for (const [role, views] of Object.entries(roleViews)) {
    for (const view of views) {
      const roleScopedEntry = new RegExp(`data-workspace-view="${view}"[^>]*data-portal-role="${role}"|data-portal-role="${role}"[^>]*data-workspace-view="${view}"`, "g");
      assert.equal((html.match(roleScopedEntry) || []).length, 1, `${role}/${view} needs one role-scoped menu entry`);
    }
  }
  const allPanels = [...new Set(Object.values(roleViews).flat()), "materials", "library"];
  for (const view of allPanels) {
    assert.equal((html.match(new RegExp(`data-workspace-panel="${view}"`, "g")) || []).length, 1, `${view} needs one panel`);
  }
});

test("Agent Skills is a teacher-only workspace initialized from the public server manifest", async () => {
  const [html, clientSource, portalSource] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(clientPath, "utf8"),
    readFile(portalRuntimePath, "utf8"),
  ]);
  assert.match(html, /href="\.\/education-skill-workbench\.css"/u);
  assert.match(html, /id="educationSkillsWorkspace"[\s\S]*?data-workspace-panel="agent-skills"/u);
  assert.match(html, /id="educationSkillWorkbench"/u);
  assert.match(html, /data-workspace-view="agent-skills"[^>]*data-portal-role="teacher"/u);
  assert.doesNotMatch(html, /data-workspace-view="agent-skills"[^>]*data-portal-role="student"/u);
  assert.match(clientSource, /initEducationSkillWorkbench\(document\.querySelector\("#educationSkillWorkbench"\)\)/u);
  assert.match(portalSource, /"agent-skills"/u);
});

test("teacher curriculum import stays in the knowledge workspace and exposes the ontology review chain", async () => {
  const [html, source] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(educationImportClientPath, "utf8"),
  ]);
  for (const id of [
    "catalogImportWorkbench",
    "catalogImportResult",
    "catalogImportWorkbenchTitle",
    "catalogImportWorkbenchSubtitle",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const stage of ["upload", "processing", "review", "publish"]) {
    assert.match(html, new RegExp(`data-catalog-stage="${stage}"`));
  }
  for (const tab of ["document", "schema", "instances", "review", "graph"]) {
    assert.match(source, new RegExp(`\\["${tab}",`));
  }
  assert.doesNotMatch(source, /activateWorkspace\?\.\("records"\)/u);
  assert.match(source, /\/api\/education\/imports\/ontology-schema/u);
  assert.match(source, /\/semantic-review/u);
  assert.match(source, /\/api\/education\/imports\/\$\{encodeURIComponent\(jobId\)\}\/publish/u);
});

test("teacher import task center is server-backed, resumable and exposes operational states", async () => {
  const [html, source] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(educationImportClientPath, "utf8"),
  ]);
  for (const id of [
    "openCatalogImportTasksBtn",
    "catalogImportTaskCenter",
    "catalogImportTaskList",
    "catalogImportTaskFilter",
    "refreshCatalogImportTasksBtn",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  for (const status of ["running", "review", "partial", "ready", "published", "failed"]) {
    assert.match(html, new RegExp(`option value="${status}"`));
  }
  assert.match(source, /\/api\/education\/imports\?limit=\$\{TASK_CENTER_LIMIT\}/u);
  assert.match(source, /TASK_CENTER_REFRESH_MS = 2_500/u);
  assert.match(source, /data-open-catalog-import-job/u);

  const base = {
    phase: "semantic_compilation",
    progress: { current_page: 3, total_pages: 10 },
    result: null,
    review: { status: "candidate" },
  };
  assert.equal(deriveEducationImportTaskState({ ...base, status: "processing" }).key, "running");
  assert.equal(deriveEducationImportTaskState({
    ...base,
    status: "succeeded",
    result: { semantic: { status: "partial" } },
  }).key, "partial");
  assert.equal(deriveEducationImportTaskState({ ...base, status: "succeeded" }).key, "review");
  assert.equal(deriveEducationImportTaskState({
    ...base,
    status: "succeeded",
    review: { status: "verified" },
  }).key, "ready");
  assert.equal(deriveEducationImportTaskState({ ...base, status: "succeeded" }, { published: true }).key, "published");
  assert.equal(deriveEducationImportTaskState({ ...base, status: "failed" }).key, "failed");
  assert.deepEqual(calculateEducationImportProgress({ ...base, status: "processing" }), {
    percent: 87,
    currentPage: 3,
    totalPages: 10,
  });
  assert.deepEqual(calculateEducationImportProgress({
    ...base,
    status: "processing",
    progress: {
      ...base.progress,
      semantic_batches_completed: 2,
      semantic_batches_total: 4,
    },
  }), {
    percent: 91,
    currentPage: 3,
    totalPages: 10,
  });
  assert.deepEqual(calculateEducationImportProgress({
    ...base,
    status: "failed",
    phase: "failed",
  }), {
    percent: 30,
    currentPage: 3,
    totalPages: 10,
  });
});

test("mastery overview keeps all 140 knowledge points in stable domain clusters while filters only dim", async () => {
  const [ontology, mastery] = await Promise.all([loadJson(ontologyPath), loadJson(masteryPath)]);
  const masteryById = new Map(mastery.records.map((record) => [record.knowledge_point_id, record]));
  const data = buildMasteryGraphData({
    ontology,
    masteryById,
    filters: { search: "勾股定理", domain: "all", mastery: "all" }
  });
  const pointNodes = data.nodes.filter((node) => node.dataKind === "point");
  assert.equal(data.domains.length, 4);
  assert.equal(pointNodes.length, 140);
  assert.ok(data.links.length > 300);
  assert.ok(pointNodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.ok(pointNodes.some((node) => node.matched));
  assert.ok(pointNodes.some((node) => !node.matched && node.itemStyle.opacity < 0.2));
});

test("knowledge structure expands a theme without changing the curriculum hierarchy", async () => {
  const [ontology, mastery] = await Promise.all([loadJson(ontologyPath), loadJson(masteryPath)]);
  const masteryById = new Map(mastery.records.map((record) => [record.knowledge_point_id, record]));
  const firstTheme = ontology.themes[0];
  const tree = buildStructureTree({ ontology, masteryById, expandedThemeIds: new Set([firstTheme.id]) });
  const themeNodes = tree.children.flatMap((domain) => domain.children);
  const expanded = themeNodes.find((theme) => theme.id === firstTheme.id);
  assert.equal(tree.children.length, 4);
  assert.equal(themeNodes.length, 19);
  assert.equal(expanded.children.length, ontology.knowledge_points.filter((point) => point.theme_id === firstTheme.id).length);
  assert.ok(themeNodes.filter((theme) => theme.id !== firstTheme.id).every((theme) => theme.children.length === 0));
});

test("knowledge point focus graph is one-hop, directional, and bounded", async () => {
  const [ontology, mastery] = await Promise.all([loadJson(ontologyPath), loadJson(masteryPath)]);
  const masteryById = new Map(mastery.records.map((record) => [record.knowledge_point_id, record]));
  const selectedId = "M4-GE-TRI-10";
  const data = buildDependencyGraphData({ ontology, masteryById, selectedId });
  assert.ok(data.nodes.length > 1);
  assert.ok(data.nodes.length <= 15);
  assert.equal(data.nodes.filter((node) => node.id === selectedId).length, 1);
  for (const edge of data.edges) {
    const source = ontology.edges.find((item) => item.id === edge.id);
    assert.equal(edge.source, source.source);
    assert.equal(edge.target, source.target);
  }
});
