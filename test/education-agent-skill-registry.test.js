import assert from "node:assert/strict";
import test from "node:test";

import {
  EDUCATION_SKILL_MANIFEST_VERSION,
  createEducationAgentSkillRegistry,
} from "../education-agent-skill-registry.js";

test("publishes Pi and server-routed education Skills without leaking private prompt instructions", () => {
  const registry = createEducationAgentSkillRegistry();
  const manifests = registry.listPublicManifests();

  assert.deepEqual(manifests.map((item) => item.id), [
    "knowledge_tutor",
    "photo_solver",
    "homework_grader",
    "question_generator",
  ]);
  assert.equal(manifests[0].schema_version, EDUCATION_SKILL_MANIFEST_VERSION);
  assert.equal(manifests[1].input.accepts_image, true);
  assert.deepEqual(
    manifests[3].required_tools.map((item) => item.name),
    [
      "retrieve_loaded_course_knowledge",
      "search_reviewed_questions",
      "publish_grounded_teaching_package",
    ],
  );
  assert.equal("instructions" in manifests[0], false);
  assert.equal("system_prompt" in manifests[0], false);
  assert.equal(JSON.stringify(manifests).includes("最后必须且只能调用"), false);
  assert.equal(Object.isFrozen(manifests), true);
  assert.equal(Object.isFrozen(manifests[0].permissions), true);
  assert.equal(manifests[2].execution, "server_only");
  assert.deepEqual(manifests[2].required_tools, []);
});

test("server-routed homework grading is never exposed as a Pi model tool", () => {
  const registry = createEducationAgentSkillRegistry();
  assert.throws(
    () => registry.createPiExposure({
      skillId: "homework_grader",
      serverTools: [],
      courseScope: {
        loaded_materials: [{ material_id: "MOE-MATH-2022", title: "义务教育数学课程标准" }],
      },
    }),
    (error) => error.code === "education_skill_server_routed" && error.status === 422,
  );
});

test("creates a Pi exposure from server tool objects and drops every unregistered tool", () => {
  const registry = createEducationAgentSkillRegistry();
  const retrieve = { name: "retrieve_loaded_course_knowledge", execute() {} };
  const search = { name: "search_reviewed_questions", execute() {} };
  const publish = { name: "publish_grounded_teaching_package", execute() {} };
  const browserInjected = { name: "browse_any_url", execute() {} };

  const exposure = registry.createPiExposure({
    skillId: "question_generator",
    serverTools: [browserInjected, publish, search, retrieve],
    courseScope: {
      loaded_materials: [{
        material_id: "MOE-MATH-2022",
        title: "义务教育数学课程标准（2022年版）",
        publisher: "中华人民共和国教育部",
      }],
    },
    protocol: {
      contract_version: "learning-agent-contract@1.0",
      final_tool_name: "retrieve_loaded_course_knowledge",
      system_prompt: "browser supplied prompt must be ignored",
      tools: [browserInjected],
    },
  });

  assert.deepEqual(exposure.tool_names, [
    "retrieve_loaded_course_knowledge",
    "search_reviewed_questions",
    "publish_grounded_teaching_package",
  ]);
  assert.deepEqual(exposure.tools, [retrieve, search, publish]);
  assert.equal(exposure.system_prompt.includes("browser supplied prompt"), false);
  assert.equal(exposure.system_prompt.includes("最后必须且只能调用 retrieve_loaded_course_knowledge"), false);
  assert.equal(exposure.system_prompt.includes("最后必须且只能调用 publish_grounded_teaching_package"), true);
  assert.equal(exposure.system_prompt.includes("当前已加载教材"), true);
  assert.equal(exposure.system_prompt.includes("模型记忆补齐"), true);
  assert.equal(exposure.system_prompt.includes("不得生成 HTML"), true);
  assert.equal(exposure.system_prompt.includes("mastery_probability"), true);
  assert.equal(exposure.system_prompt.includes("[visual:...]"), true);
  assert.equal(exposure.system_prompt.includes("card_refs 数组"), true);
  assert.equal(exposure.system_prompt.includes("系统会从该字段机器解析"), true);
});

test("preexecuted retrieval remains in the manifest but is hidden from the current Pi tool exposure", () => {
  const registry = createEducationAgentSkillRegistry();
  const retrieve = { name: "retrieve_loaded_course_knowledge", execute() {} };
  const publish = { name: "publish_grounded_teaching_package", execute() {} };
  const exposure = registry.createPiExposure({
    skillId: "knowledge_tutor",
    serverTools: [retrieve, publish],
    courseScope: {
      loaded_materials: [{ material_id: "MOE-MATH-2022", title: "义务教育数学课程标准" }],
    },
    preexecutedToolNames: ["retrieve_loaded_course_knowledge"],
  });

  assert.deepEqual(exposure.manifest.required_tools.map((item) => item.name), [
    "retrieve_loaded_course_knowledge",
    "request_secondary_retrieval",
    "publish_grounded_teaching_package",
  ]);
  assert.deepEqual(exposure.preexecuted_tool_names, ["retrieve_loaded_course_knowledge"]);
  assert.deepEqual(exposure.tool_names, ["publish_grounded_teaching_package"]);
  assert.deepEqual(exposure.tools, [publish]);
  assert.match(exposure.system_prompt, /已在模型调用前执行：retrieve_loaded_course_knowledge/u);
  assert.match(exposure.system_prompt, /禁止再次调用这些工具/u);
  assert.match(exposure.system_prompt, /不表示知识点标题与题目逐字一致/u);
  assert.match(exposure.system_prompt, /建立二次函数表达式.*应 answered/u);
  assert.match(exposure.system_prompt, /相似三角形面积比.*不能替代.*三角形面积公式/u);
});

test("knowledge tutor grounded text keeps the public tool contract but exposes no model tools", () => {
  const registry = createEducationAgentSkillRegistry();
  const retrieve = { name: "retrieve_loaded_course_knowledge", execute() {} };
  const publish = { name: "publish_grounded_teaching_package", execute() {} };
  const exposure = registry.createPiExposure({
    skillId: "knowledge_tutor",
    serverTools: [retrieve, publish],
    courseScope: {
      loaded_materials: [{ material_id: "MOE-MATH-2022", title: "义务教育数学课程标准" }],
    },
    preexecutedToolNames: ["retrieve_loaded_course_knowledge"],
    outputMode: "grounded_text",
  });

  assert.equal(exposure.output_mode, "grounded_text");
  assert.deepEqual(exposure.manifest.required_tools.map((item) => item.name), [
    "retrieve_loaded_course_knowledge",
    "request_secondary_retrieval",
    "publish_grounded_teaching_package",
  ]);
  assert.deepEqual(exposure.preexecuted_tool_names, ["retrieve_loaded_course_knowledge"]);
  assert.deepEqual(exposure.tool_names, []);
  assert.deepEqual(exposure.tools, []);
  assert.match(exposure.system_prompt, /已在模型调用前执行：retrieve_loaded_course_knowledge/u);
  assert.match(exposure.system_prompt, /禁止再次调用这些工具/u);
  assert.match(exposure.system_prompt, /不要调用工具，只输出学生可见的简化 Markdown 讲解/u);
  assert.doesNotMatch(exposure.system_prompt, /本轮允许工具：/u);
  assert.doesNotMatch(exposure.system_prompt, /最后必须且只能调用/u);
  assert.doesNotMatch(exposure.system_prompt, /(?:先|必须|请|应当)调用 retrieve_loaded_course_knowledge/u);
});

test("fails closed for unpublished Skills and unavailable required tools", () => {
  const registry = createEducationAgentSkillRegistry();
  const context = {
    serverTools: [{ name: "retrieve_loaded_course_knowledge", execute() {} }],
    courseScope: { loaded_materials: [{ material_id: "m1", title: "初中数学" }] },
  };

  assert.throws(
    () => registry.createPiExposure({ ...context, skillId: "browser_injected_skill" }),
    (error) => error.code === "education_skill_not_published" && error.status === 422,
  );
  assert.throws(
    () => registry.createPiExposure({ ...context, skillId: "knowledge_tutor" }),
    (error) => error.code === "education_skill_tool_unavailable" && error.status === 503,
  );
});

test("returns a compact LLM routing catalog without runtime permissions or prompts", () => {
  const registry = createEducationAgentSkillRegistry();
  const catalog = registry.getLlmSkillCatalog();

  assert.equal(catalog.selection_policy, "select_published_id_only");
  assert.equal(catalog.skills.length, 4);
  assert.equal(catalog.skills[1].accepts_image, true);
  assert.equal(catalog.skills[2].execution, "server_only");
  assert.equal("permissions" in catalog.skills[0], false);
  assert.equal("instructions" in catalog.skills[0], false);
});
