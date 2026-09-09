import { KNOWLEDGE_TUTOR_SKILL } from "./knowledge-tutor.js";
import { HOMEWORK_GRADER_SKILL } from "./homework-grader.js";
import { PHOTO_SOLVER_SKILL } from "./photo-solver.js";
import { QUESTION_GENERATOR_SKILL } from "./question-generator.js";

export { createLocalKnowledgeArtifactResolver } from "./local-artifact-resolver.js";

export const EDUCATION_AGENT_SKILLS = Object.freeze({
  [KNOWLEDGE_TUTOR_SKILL.id]: KNOWLEDGE_TUTOR_SKILL,
  [PHOTO_SOLVER_SKILL.id]: PHOTO_SOLVER_SKILL,
  [HOMEWORK_GRADER_SKILL.id]: HOMEWORK_GRADER_SKILL,
  [QUESTION_GENERATOR_SKILL.id]: QUESTION_GENERATOR_SKILL,
});

export function resolveEducationAgentSkill(value) {
  const id = String(value || "knowledge_tutor").trim();
  return EDUCATION_AGENT_SKILLS[id] || null;
}
