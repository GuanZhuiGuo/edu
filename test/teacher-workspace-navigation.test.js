import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolvePortalWorkspace, getPortalWorkspacePresentation } from "../public/portal-runtime.js";

const readPublic = name => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
const teacherViews = [
  "agent", "teacher-dashboard", "teacher-students", "teacher-courses",
  "courseware-assistant", "courseware-library", "graph", "bank", "assessment", "ontology", "skill-hub", "voice-config"
];
const teacherLabels = ["课堂预览", "教学总览", "班级学情", "课程管理", "课件助手", "课件库", "知识库", "题库", "智能评测", "本体图", "Skill hub", "AI教师设置"];
const studentViews = ["agent", "course", "plan", "graph", "bank", "assessment", "records", "buddy", "voice-config"];
const aliases = {
  "video-explanation": "courseware-assistant", "lesson-lab": "courseware-assistant", materials: "courseware-assistant",
  "agent-skills": "skill-hub", "tech-landscape": "skill-hub", "teacher-plan": "teacher-dashboard"
};
const attributes = source => Object.fromEntries([...source.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));

test("desktop and mobile teacher navigation use the same flat destinations and valid panel targets", async () => {
  const html = await readPublic("index.html");
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, contents]) => ({ ...attributes(attrs), contents }));
  const desktop = buttons.filter(button => button["data-portal-role"] === "teacher" && button["data-workspace-view"]);
  const mobile = buttons.filter(button => button["data-mobile-portal-role-scope"] === "teacher" && button["data-mobile-workspace-view"]);
  assert.deepEqual(desktop.map(button => button["data-workspace-view"]), teacherViews);
  assert.deepEqual(mobile.map(button => button["data-mobile-workspace-view"]), teacherViews);
  assert.deepEqual(desktop.map(button => button["aria-label"]), teacherLabels);
  const panels = new Map([...html.matchAll(/<main\b([^>]*)>/g)].map(([, attrs]) => attributes(attrs)).map(panel => [panel.id, panel["data-workspace-panel"]]));
  for (const button of [...desktop, ...mobile]) {
    const view = button["data-workspace-view"] || button["data-mobile-workspace-view"];
    assert.equal(panels.get(button["aria-controls"]), view, `${view} must control its own workspace`);
    assert.equal(button.role, "tab");
  }
  const teacherMenu = html.match(/<nav\b[^>]*data-portal-menu="teacher"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(teacherMenu);
  assert.equal(/<details\b|teacher-toolbox|更多工具|教学计划/u.test(teacherMenu), false, "teacher destinations must not be hidden in the retired hierarchy");
});

test("new teacher destinations and legacy aliases stay outside the student navigation allowlist", () => {
  for (const view of teacherViews) {
    assert.equal(resolvePortalWorkspace(view, "teacher"), view);
    assert.ok(getPortalWorkspacePresentation(view, "teacher"), `${view} needs a current title`);
    if (!studentViews.includes(view)) {
      assert.equal(resolvePortalWorkspace(view, "student"), "agent", `student navigation must reject ${view}`);
      assert.equal(getPortalWorkspacePresentation(view, "student"), null);
    }
  }
  for (const view of studentViews) assert.equal(resolvePortalWorkspace(view, "student"), view);
  for (const [legacy, canonical] of Object.entries(aliases)) {
    assert.equal(resolvePortalWorkspace(legacy, "teacher"), canonical, `${legacy} must resolve to the replacement workspace`);
    assert.equal(resolvePortalWorkspace(legacy, "student"), "agent", `teacher alias ${legacy} must not expand student access`);
  }
  assert.equal(resolvePortalWorkspace("missing-view", "teacher"), "teacher-dashboard");
  assert.equal(resolvePortalWorkspace("courseware-library", "missing-role"), "agent");
});

test("reparented skill and courseware panels retain their original IDs and leave the global switcher", async () => {
  const [html, hub, assistant, client] = await Promise.all([
    readPublic("index.html"), readPublic("skill-hub.js"), readPublic("courseware-assistant.js"), readPublic("client.js")
  ]);
  for (const id of [
    "educationSkillsWorkspace", "educationSkillWorkbench", "technologyLandscapeWorkspace", "technologySearch", "technologyLandscapeGrid",
    "interactiveLessonWorkspace", "lessonPlayerStage", "videoExplanationWorkspace", "videoExplanationWorkbench", "knowledgeMaterialsWorkspace"
  ]) {
    assert.equal((html.match(new RegExp(`\\sid="${id}"`, "g")) || []).length, 1, `the original ${id} node must be preserved exactly once`);
  }
  for (const id of ["educationSkillsWorkspace", "technologyLandscapeWorkspace"]) assert.ok(hub.includes(id), `${id} must be housed by Skill hub`);
  assert.ok(/removeAttribute\(['"]data-workspace-panel['"]\)/u.test(hub), "nested skill panels must leave the global workspace selector");
  assert.ok(/removeAttribute\(['"]data-workspace-panel['"]\)/u.test(assistant), "nested courseware engines must leave the global workspace selector");
  const switcher = client.slice(client.indexOf("function switchWorkspace("), client.indexOf("function setTextInputSheet("));
  assert.ok(/document\.querySelectorAll\("\[data-workspace-panel\]"\)\.forEach/u.test(switcher), "workspace changes must query the current DOM after reparenting");
  assert.equal(/els\.workspacePanels\.forEach/u.test(switcher), false, "a stale panel snapshot would hide nested editors");
  assert.ok(switcher.includes('"courseware:select-tool"'), "legacy courseware navigation must select its original editor");
  assert.ok(switcher.includes('"skill-hub:select-tab"'), "legacy technology navigation must select its original tab");
});

test("the canonical shell loads every new workspace module and stylesheet from local assets", async () => {
  const [html, client, styles] = await Promise.all([readPublic("index.html"), readPublic("client.js"), readPublic("design-system.css")]);
  assert.equal((html.match(/href="\.\/design-system\.css"/g) || []).length, 1);
  for (const name of ["courseware-assistant", "courseware-library", "skill-hub"]) {
    assert.ok(client.includes(`from "./${name}.js"`), `${name} must be imported by the client`);
    assert.ok(styles.includes(`'./${name}.css'`), `${name} styles must join the shared design entry`);
    await access(new URL(`../public/${name}.js`, import.meta.url));
    await access(new URL(`../public/${name}.css`, import.meta.url));
  }
});
