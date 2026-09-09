import {
  DSL_VERSION,
  normalizeScene,
  normalizeStage,
  validateAction,
  validateScene,
  validateStage
} from "@openmaic/dsl";

import {
  compileSourceText,
  sourceTechniqueError,
  stableHash
} from "./source-text.js";

export const OPENMAIC_SOURCE_PROVENANCE = Object.freeze({
  upstream_repo: "https://github.com/THU-MAIC/OpenMAIC",
  source_revision: "ff95e6683db44ce7d4b362283e589c0a157f0364",
  package: "@openmaic/dsl",
  package_version: "0.3.0",
  dsl_version: DSL_VERSION,
  license: "MIT",
  integration: "official-package",
  source_files: Object.freeze([
    "packages/@openmaic/dsl/src/stage.ts",
    "packages/@openmaic/dsl/src/action.ts",
    "packages/@openmaic/dsl/src/normalize.ts",
    "packages/@openmaic/dsl/src/validate.ts"
  ]),
  reused_capabilities: Object.freeze([
    "Stage and Scene source-of-truth contracts",
    "official structural normalizers",
    "official Stage, Scene and Action validators",
    "official serialized DSL version"
  ]),
  model_required: false
});

export function generateOpenMaicSourceMaterial(source = {}) {
  const document = compileSourceText(source);
  const stageId = `maic_stage_${stableHash(document.source_text)}`;
  const createdAt = 0;
  const stage = normalizeStage({
    id: stageId,
    name: document.title,
    description: document.source_text.slice(0, 500),
    createdAt,
    updatedAt: createdAt,
    languageDirective: document.language,
    style: "source-first",
    interactiveMode: false
  });
  assertOfficial("stage", validateStage(stage));

  const correctClaim = document.claims[0];
  const quizId = `maic_quiz_${stableHash(correctClaim.text)}`;
  const options = createQuizOptions(correctClaim.text);
  const officialScenes = [
    createOfficialSlideScene({
      id: `${stageId}_explain`,
      stageId,
      order: 1,
      title: "核心讲解",
      text: document.sentences.slice(0, 2).join("。"),
      elementId: `${stageId}_explain_text`
    }),
    createOfficialSlideScene({
      id: `${stageId}_map`,
      stageId,
      order: 2,
      title: "关系梳理",
      text: document.claims
        .slice(0, 4)
        .map((claim, index) => `${index + 1}. ${claim.text}`)
        .join("\n"),
      elementId: `${stageId}_map_text`
    }),
    createOfficialQuizScene({
      id: `${stageId}_quiz`,
      stageId,
      order: 3,
      title: "课堂检查",
      quizId,
      prompt: "以下哪一项与输入原文直接一致？",
      options
    })
  ];
  officialScenes.forEach((scene) =>
    assertOfficial("scene", validateScene(scene))
  );

  const material = createHostProjection({
    document,
    stageId,
    quizId,
    options
  });

  return {
    material,
    claims: document.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      source_support: claim.source_support
    })),
    stage: {
      format: "openmaic.source-first.v1",
      dsl_version: DSL_VERSION,
      stage,
      scenes: officialScenes
    },
    provenance: structuredClone(OPENMAIC_SOURCE_PROVENANCE)
  };
}

function createOfficialSlideScene({
  id,
  stageId,
  order,
  title,
  text,
  elementId
}) {
  const actions = [
    {
      id: `${id}_speech`,
      type: "speech",
      text
    },
    {
      id: `${id}_spotlight`,
      type: "spotlight",
      elementId,
      dimOpacity: 0.35
    }
  ];
  actions.forEach((action) =>
    assertOfficial("action", validateAction(action))
  );
  const scene = normalizeScene({
    id,
    stageId,
    title,
    order,
    type: "slide",
    content: {
      type: "slide",
      schemaVersion: 1,
      canvas: {
        id: `${id}_canvas`,
        elements: [
          {
            id: elementId,
            type: "text",
            left: 80,
            top: 80,
            width: 840,
            height: 380,
            rotate: 0,
            content: text
          }
        ]
      }
    },
    actions
  });
  assertOfficial("scene", validateScene(scene));
  return scene;
}

function createOfficialQuizScene({
  id,
  stageId,
  order,
  title,
  quizId,
  prompt,
  options
}) {
  const actions = [
    {
      id: `${id}_speech`,
      type: "speech",
      text: prompt
    },
    {
      id: `${id}_discussion`,
      type: "discussion",
      topic: prompt,
      prompt: "请先回到原文寻找直接证据，再选择。"
    }
  ];
  actions.forEach((action) =>
    assertOfficial("action", validateAction(action))
  );
  const scene = normalizeScene({
    id,
    stageId,
    title,
    order,
    type: "quiz",
    content: {
      type: "quiz",
      questions: [
        {
          id: quizId,
          type: "single",
          question: prompt,
          options: options.map((option) => ({
            label: option.label,
            value: option.value
          })),
          hasAnswer: false,
          points: 1
        }
      ]
    },
    actions
  });
  assertOfficial("scene", validateScene(scene));
  return scene;
}

function createHostProjection({
  document,
  stageId,
  quizId,
  options
}) {
  const explanationSceneId = `${stageId}_explain`;
  const mapSceneId = `${stageId}_map`;
  const quizSceneId = `${stageId}_quiz`;
  const explanationElements = document.claims.slice(0, 2).map((claim, index) => ({
    id: `${stageId}_claim_${index + 1}`,
    kind: "text",
    label: index === 0 ? "核心陈述" : "补充信息",
    content: claim.text
  }));
  const mapElements = document.claims.slice(0, 4).map((claim, index) => ({
    id: `${stageId}_node_${index + 1}`,
    kind: "diagram_node",
    label: `知识节点 ${index + 1}`,
    content: claim.text
  }));
  const quizElements = [
    {
      id: `${stageId}_quiz_prompt`,
      kind: "text",
      label: "课堂检查",
      content: "以下哪一项与输入原文直接一致？"
    }
  ];

  const actions = [
    hostAction({
      id: `${stageId}_action_1`,
      order: 1,
      sceneId: explanationSceneId,
      type: "spotlight",
      targetId: explanationElements[0].id,
      narration: "先聚焦原文中的第一条核心陈述。",
      durationMs: 900
    }),
    hostAction({
      id: `${stageId}_action_2`,
      order: 2,
      sceneId: mapSceneId,
      type: "reveal",
      targetId: mapElements[0].id,
      narration: "再把原文陈述转换成可逐项检查的关系节点。",
      durationMs: 900
    }),
    hostAction({
      id: `${stageId}_action_3`,
      order: 3,
      sceneId: quizSceneId,
      type: "annotate",
      targetId: quizElements[0].id,
      narration: "最后回到原文证据完成课堂检查。",
      durationMs: 900
    })
  ];

  return {
    outlines: [
      {
        id: `${stageId}_outline_1`,
        order: 1,
        type: "explanation",
        title: "核心讲解",
        objective: "识别输入原文中的核心陈述。",
        claim_ids: document.claims.slice(0, 2).map((claim) => claim.id)
      },
      {
        id: `${stageId}_outline_2`,
        order: 2,
        type: "diagram",
        title: "关系梳理",
        objective: "将原文陈述组织为可检查的知识关系。",
        claim_ids: document.claims.slice(0, 4).map((claim) => claim.id)
      },
      {
        id: `${stageId}_outline_3`,
        order: 3,
        type: "quiz",
        title: "课堂检查",
        objective: "根据原文证据选择直接成立的陈述。",
        claim_ids: [document.claims[0].id]
      }
    ],
    scenes: [
      {
        id: explanationSceneId,
        outline_id: `${stageId}_outline_1`,
        type: "explanation",
        title: "核心讲解",
        summary: document.sentences.slice(0, 2).join("。"),
        elements: explanationElements
      },
      {
        id: mapSceneId,
        outline_id: `${stageId}_outline_2`,
        type: "diagram",
        title: "关系梳理",
        summary: "按照原文顺序呈现知识节点。",
        elements: mapElements
      },
      {
        id: quizSceneId,
        outline_id: `${stageId}_outline_3`,
        type: "quiz",
        title: "课堂检查",
        summary: "依据原文直接证据完成单项选择。",
        elements: quizElements
      }
    ],
    presentation_timeline: actions,
    quiz: {
      title: `${document.title} · 课堂检查`,
      question_id: quizId,
      prompt: "以下哪一项与输入原文直接一致？",
      options,
      hint: "回到原文的第一条核心陈述寻找直接证据。",
      correct_option: "A",
      explanation: `原文直接陈述：“${document.claims[0].text}”`,
      claim_ids: [document.claims[0].id]
    }
  };
}

function hostAction({
  id,
  order,
  sceneId,
  type,
  targetId,
  narration,
  durationMs
}) {
  let dslAction;
  if (type === "spotlight") {
    dslAction = {
      id: `${id}_dsl`,
      type: "spotlight",
      elementId: targetId,
      dimOpacity: 0.35
    };
  } else if (type === "reveal") {
    dslAction = {
      id: `${id}_dsl`,
      type: "widget_reveal",
      target: targetId,
      content: narration
    };
  } else {
    dslAction = {
      id: `${id}_dsl`,
      type: "widget_annotation",
      target: targetId,
      content: narration
    };
  }
  assertOfficial("action", validateAction(dslAction));
  return {
    id,
    order,
    scene_id: sceneId,
    type,
    target_id: targetId,
    narration,
    duration_ms: durationMs,
    dsl_action: dslAction
  };
}

function createQuizOptions(correctText) {
  return [
    { id: "A", value: "A", label: correctText.slice(0, 180) },
    {
      id: "B",
      value: "B",
      label: "原文说明所有条件变化都不会影响结论。"
    },
    {
      id: "C",
      value: "C",
      label: "原文给出的关系与该陈述完全相反。"
    },
    {
      id: "D",
      value: "D",
      label: "原文没有提供任何可以判断的信息。"
    }
  ];
}

function assertOfficial(kind, result) {
  if (result?.valid === true) return;
  const details = Array.isArray(result?.errors)
    ? result.errors.map((error) => `${error.path}: ${error.message}`).join("; ")
    : "unknown validation error";
  throw sourceTechniqueError(
    "OPENMAIC_DSL_VALIDATION_FAILED",
    `OpenMAIC ${kind} validation failed`,
    { details }
  );
}
