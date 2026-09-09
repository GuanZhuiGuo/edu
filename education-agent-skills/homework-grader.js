/**
 * Server-routed Skill manifest for the authoritative homework-marking API.
 * It is published alongside Pi Skills so the product can describe both image
 * choices, but it is never exposed as a model-callable tool.
 */
export const HOMEWORK_GRADER_SKILL = Object.freeze({
  id: "homework_grader",
  label: "作业批改",
  requires_image: true,
  event_type: "assessment_answer",
  execution_mode: "server_only",
  retrieval_entity_types: Object.freeze([]),
  instructions: Object.freeze([
    "本 Skill 只能由服务端图片任务路由器选择并调用作业批改接口。",
    "不得与拍照答题链路并行执行，也不得由浏览器注入接口参数或凭证。",
  ]),
});
