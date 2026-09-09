import {
  compileSourceText,
  stableHash
} from "./source-text.js";

export const KOJI_SOURCE_PROVENANCE = Object.freeze({
  upstream_repo: null,
  source_revision: null,
  license: "project-source",
  integration: "original deterministic guided-learning state machine",
  model_required: false,
  disclosure:
    "Koji has no reusable open-source implementation in scope; this adapter is explicitly Koji-style and does not claim to execute Koji source code."
});

export function generateKojiSourceMaterial(source = {}) {
  const document = compileSourceText(source);
  const firstClaim = document.claims[0];
  const secondClaim = document.claims[1] || firstClaim;
  const experienceId = `koji_${stableHash(document.source_text)}`;
  const questionId = `${experienceId}_reflection`;
  const focusTarget = `source:${firstClaim.claim_id}`;

  const material = {
    guided_states: [
      {
        id: `${experienceId}_start`,
        order: 1,
        trigger: "start",
        label: "建立目标",
        focus_target: focusTarget,
        teacher_move: `先明确本轮只理解“${document.title}”的核心关系。`,
        learner_prompt: `请用自己的话复述：${firstClaim.text}`,
        transition_to: `${experienceId}_hesitation`
      },
      {
        id: `${experienceId}_hesitation`,
        order: 2,
        trigger: "hesitation",
        label: "拆分信息",
        focus_target: focusTarget,
        teacher_move: "把原句拆成对象、条件和结论，再逐项核对。",
        learner_prompt: `原文中的条件是什么？结论又是什么？`,
        transition_to: `${experienceId}_hint`
      },
      {
        id: `${experienceId}_hint`,
        order: 3,
        trigger: "hint_request",
        label: "逐层提示",
        focus_target: `hint:${questionId}`,
        teacher_move: "只提供当前所需的一层提示，不直接替学习者完成复述。",
        learner_prompt: `比较这两条信息的关系：${firstClaim.text} / ${secondClaim.text}`,
        transition_to: `${experienceId}_success`
      },
      {
        id: `${experienceId}_success`,
        order: 4,
        trigger: "success",
        label: "迁移总结",
        focus_target: focusTarget,
        teacher_move: "让学习者把结论迁移到一个新的例子，并说明依据。",
        learner_prompt: `请为“${document.title}”举一个新例子，并指出它对应原文哪条信息。`
      }
    ],
    layered_hints: [
      {
        id: `${experienceId}_hints`,
        question_id: questionId,
        levels: [
          {
            level: 1,
            text: `先圈出主题词“${document.title}”。`,
            focus_target: focusTarget,
            reveals_answer: false
          },
          {
            level: 2,
            text: `再区分条件与结论：${firstClaim.text}`,
            focus_target: focusTarget,
            reveals_answer: false
          },
          {
            level: 3,
            text: "最后用“因为……所以……”重新组织，而不是照抄原句。",
            focus_target: `hint:${questionId}`,
            reveals_answer: false
          }
        ]
      }
    ],
    attention_cues: [
      {
        id: `${experienceId}_cue`,
        target_id: focusTarget,
        type: "pulse",
        duration_ms: 600
      }
    ]
  };

  const cardMaterial = {
    material_id: `${experienceId}_explanation`,
    recommended_type: "knowledge.explanation",
    supports_claim_ids: document.claims.map((claim) => claim.claim_id),
    data: {
      title: `${document.title} · 渐进辅导`,
      summary: "按建立目标、拆分信息、逐层提示和迁移总结推进学习。",
      body: document.sentences.join("。"),
      key_points: document.claims.slice(0, 4).map((claim) => claim.text),
      callout: "提示只推进一步，不直接给出学习者应完成的表达。",
      sources: ["用户输入原文"]
    }
  };

  return {
    material,
    claims: document.claims.map((claim) => ({ ...claim })),
    card_materials: [cardMaterial],
    topic: {
      topic_id: document.topic_id,
      title: document.title,
      subject: "通用",
      grade_band: "自适应",
      language: document.language
    },
    provenance: KOJI_SOURCE_PROVENANCE
  };
}
