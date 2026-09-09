export const QUESTION_GENERATOR_SKILL = Object.freeze({
  id: "question_generator",
  label: "知识点出题",
  requires_image: false,
  event_type: "assessment_request",
  retrieval_entity_types: Object.freeze([
    "knowledge_unit",
    "knowledge_point",
    "knowledge_chunk",
  ]),
  instructions: Object.freeze([
    "必须使用本轮由服务端提供的知识检索结果，且出题知识点只能选命中候选 candidate_id。",
    "若本轮暴露 retrieve_loaded_course_knowledge，最多调用一次；若服务端提示已预检索，则禁止再次调用。",
    "可以调用 search_reviewed_questions 查看同知识点已审核题型，但不得复制原题或泄露私有答案。",
    "按服务端给定的难度、题型、认知层级和出题角度生成一道题；条件必须充分、答案唯一或评分规则可执行。",
    "题面和私有答案必须分离；面向学生的 answer 不得透露正确选项、标准答案或解析。",
    "视觉或知识卡只能引用工具返回的白名单 ref，不得生成可执行代码。",
    "生成题目只是待作答草稿，不是学生掌握证据。",
  ]),
});
