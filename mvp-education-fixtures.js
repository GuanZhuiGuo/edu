const clone = (value) =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

export const NEWTON2_TOPIC_ID = "physics.newton.second_law";
export const NEWTON2_ARTIFACT_ID = "artifact_physics_newton2_mvp1";
export const NEWTON2_ARTIFACT_VERSION = "physics_newton2_mock_mvp1";
export const ENGLISH_SPEAKING_TOPIC_ID = "english.classroom.speaking";
export const ENGLISH_SPEAKING_ARTIFACT_ID =
  "artifact_english_classroom_speaking_mvp1";
export const ENGLISH_SPEAKING_ARTIFACT_VERSION =
  "english_classroom_speaking_mock_mvp1";

export const MOCK_LEARNER_ASSESSMENT_HISTORY = deepFreeze({
  learner_id: "student_demo_001",
  learner_name: "演示学生",
  subject: "高中物理",
  assessments: [
    {
      assessment_id: "physics_midterm_2026",
      title: "高一物理期中考试",
      type: "midterm",
      score: 78,
      total_score: 100,
      knowledge_errors: [
        {
          topic_id: NEWTON2_TOPIC_ID,
          topic_name: "牛顿第二定律",
          wrong_count: 2,
          question_count: 4
        },
        {
          topic_id: "physics.kinematics.uniform_acceleration",
          topic_name: "匀变速直线运动",
          wrong_count: 1,
          question_count: 5
        },
        {
          topic_id: "physics.force.analysis",
          topic_name: "受力分析",
          wrong_count: 1,
          question_count: 4
        }
      ]
    },
    {
      assessment_id: "physics_final_2026",
      title: "高一物理期末考试",
      type: "final",
      score: 74,
      total_score: 100,
      knowledge_errors: [
        {
          topic_id: NEWTON2_TOPIC_ID,
          topic_name: "牛顿第二定律",
          wrong_count: 3,
          question_count: 5
        },
        {
          topic_id: "physics.momentum.basic",
          topic_name: "动量基础",
          wrong_count: 2,
          question_count: 4
        },
        {
          topic_id: "physics.work.energy",
          topic_name: "功和能",
          wrong_count: 1,
          question_count: 4
        }
      ]
    }
  ],
  weakest_topic: {
    topic_id: NEWTON2_TOPIC_ID,
    topic_name: "牛顿第二定律",
    midterm_wrong_count: 2,
    final_wrong_count: 3,
    total_wrong_count: 5,
    trend: "increased"
  }
});

const claims = deepFreeze([
  {
    claim_id: "claim_newton2_formula",
    text: "牛顿第二定律写作 F=ma，其中 F 是物体所受的合外力。"
  },
  {
    claim_id: "claim_newton2_direction",
    text: "物体的加速度方向与它所受合外力的方向一致。"
  },
  {
    claim_id: "claim_newton2_force_ratio",
    text: "质量不变时，加速度与合外力成正比。"
  },
  {
    claim_id: "claim_newton2_mass_ratio",
    text: "合外力不变时，加速度与质量成反比。"
  },
  {
    claim_id: "claim_newton2_double_force",
    text: "质量不变时，合外力变为原来的 2 倍，加速度也变为原来的 2 倍。"
  },
  {
    claim_id: "claim_newton2_steps",
    text: "应用牛顿第二定律时，依次选研究对象、画受力图、求合外力，再沿选定方向列方程。"
  }
]);

const evidence = deepFreeze([
  {
    evidence_id: "evidence_newton2_note_01",
    title: "牛顿第二定律 MVP 演示知识单元",
    source_type: "mock",
    locator: "mock://physics/newton-second-law",
    excerpt: "牛顿第二定律描述合外力、质量与加速度之间的关系：F=ma。"
  },
  {
    evidence_id: "evidence_newton2_ratio_02",
    title: "牛顿第二定律比例关系",
    source_type: "mock",
    locator: "mock://physics/newton-second-law/ratios",
    excerpt: "质量不变时 a 与 F 成正比；合外力不变时 a 与 m 成反比。"
  }
]);

const englishClaims = deepFreeze([
  {
    claim_id: "claim_english_speak_spelling",
    text: "The correct spelling is “speak,” not “speek.”"
  },
  {
    claim_id: "claim_english_can_you_pattern",
    text: "Use “Can you + base verb ...?” to make a polite request or ask about ability."
  },
  {
    claim_id: "claim_english_language_phrase",
    text: "A natural sentence is: “Can you speak in English?”"
  }
]);

const englishEvidence = deepFreeze([
  {
    evidence_id: "evidence_english_classroom_01",
    title: "Classroom English · Polite requests",
    source_type: "mock",
    locator: "mock://english/classroom/polite-requests",
    excerpt:
      "Use Can you + base verb to ask politely. Say “Can you speak in English?”"
  }
]);

const teachingMaterials = deepFreeze([
  {
    material_version: "1.0",
    material_id: "material_newton2_explanation",
    material_type: "explanation",
    supported_card_types: ["knowledge.explanation"],
    supports_claim_ids: [
      "claim_newton2_formula",
      "claim_newton2_direction",
      "claim_newton2_force_ratio",
      "claim_newton2_mass_ratio",
      "claim_newton2_double_force",
      "claim_newton2_steps"
    ],
    evidence_refs: ["evidence_newton2_note_01", "evidence_newton2_ratio_02"],
    content: {
      title: "牛顿第二定律",
      summary: "物体的加速度由合外力和质量共同决定。",
      body: "先选研究对象并求它所受的合外力，再用 F=ma 分析加速度。F 指合外力，而不是任意一个力。",
      formula: "F = ma",
      key_point_claim_ids: [
        "claim_newton2_formula",
        "claim_newton2_direction",
        "claim_newton2_force_ratio",
        "claim_newton2_mass_ratio"
      ],
      callout: "判断比例关系前，先确认题目中哪个物理量保持不变。"
    },
    presentation: {
      title: "核心讲解",
      eyebrow: "高中物理 · 必修一",
      badge: "核心概念",
      tags: ["运动与力", "F=ma"]
    },
    actions: [{ type: "quiz.start", label: "用一道题检验" }]
  },
  {
    material_version: "1.0",
    material_id: "material_newton2_mindmap",
    material_type: "mindmap",
    supported_card_types: ["knowledge.mindmap"],
    supports_claim_ids: [
      "claim_newton2_formula",
      "claim_newton2_direction",
      "claim_newton2_force_ratio",
      "claim_newton2_mass_ratio",
      "claim_newton2_steps"
    ],
    evidence_refs: ["evidence_newton2_note_01"],
    content: {
      title: "牛顿第二定律知识结构",
      root: "牛顿第二定律",
      branches: [
        {
          id: "formula",
          title: "公式 F=ma",
          children: ["F：合外力", "m：质量", "a：加速度"]
        },
        {
          id: "relation",
          title: "比例与方向",
          children: ["m 不变：a 与 F 成正比", "F 不变：a 与 m 成反比", "a 与 F 同方向"]
        },
        {
          id: "steps",
          title: "解题步骤",
          children: ["选研究对象", "画受力图", "求合外力", "列方程"]
        },
        {
          id: "mistakes",
          title: "常见误区",
          children: ["F 不是任意一个力", "加速度方向不一定与速度方向相同"]
        }
      ]
    },
    presentation: {
      title: "知识结构",
      eyebrow: "高中物理 · 必修一",
      badge: "4 个分支",
      tags: ["概念关系", "解题步骤"]
    },
    actions: []
  },
  {
    material_version: "1.0",
    material_id: "material_newton2_image",
    material_type: "image",
    supported_card_types: ["media.image"],
    supports_claim_ids: [
      "claim_newton2_direction",
      "claim_newton2_force_ratio",
      "claim_newton2_double_force"
    ],
    evidence_refs: ["evidence_newton2_ratio_02"],
    content: {
      title: "小车受力实验",
      src: "/assets/newton-cart-lesson.png",
      alt: "水平轨道上的实验小车受到向右的合外力，并沿合外力方向向右加速",
      caption: "保持小车质量不变，增大向右的合外力，小车向右的加速度随之增大。",
      credit: "AI 教学素材"
    },
    presentation: {
      title: "图像材料",
      eyebrow: "实验观察",
      badge: "示意图",
      tags: ["小车实验"]
    },
    actions: []
  },
  {
    material_version: "1.0",
    material_id: "material_newton2_video",
    material_type: "video",
    supported_card_types: ["media.video"],
    supports_claim_ids: [
      "claim_newton2_direction",
      "claim_newton2_force_ratio",
      "claim_newton2_double_force"
    ],
    evidence_refs: ["evidence_newton2_ratio_02"],
    content: {
      title: "30 秒看懂 F=ma",
      src: "/assets/newton-second-law-demo.mp4",
      poster: "/assets/newton-cart-lesson.png",
      availability: "mock",
      duration_seconds: 30,
      caption: "Mock 动画位：观察相同质量的小车在不同合外力下加速度的变化。",
      caption_language: "zh-CN"
    },
    presentation: {
      title: "视频材料",
      eyebrow: "动画演示",
      badge: "Mock · 00:30",
      tags: ["动画", "F=ma"]
    },
    actions: [{ type: "media.video.open", label: "查看动画演示" }]
  },
  {
    material_version: "1.0",
    material_id: "material_newton2_oral",
    material_type: "oral_task",
    supported_card_types: ["oral.practice"],
    supports_claim_ids: [
      "claim_newton2_formula",
      "claim_newton2_force_ratio",
      "claim_newton2_mass_ratio"
    ],
    evidence_refs: ["evidence_newton2_note_01"],
    content: {
      title: "用自己的话解释",
      prompt: "请在 30 秒内说明合外力、质量和加速度之间的关系。",
      reference_answer: "根据 F=ma，加速度由合外力和质量共同决定；质量不变时，加速度与合外力成正比。",
      time_limit_seconds: 30,
      scoring_dimensions: [
        { id: "accuracy", label: "概念准确", weight: 0.5 },
        { id: "structure", label: "表达完整", weight: 0.3 },
        { id: "fluency", label: "表达流畅", weight: 0.2 }
      ],
      tips: ["先说公式", "说明 F 是合外力", "再说明一个比例关系"]
    },
    presentation: {
      title: "口语陪练",
      eyebrow: "概念复述",
      badge: "30 秒",
      tags: ["口语表达"]
    },
    actions: [
      {
        type: "oral.record.start",
        label: "开始复述",
        payload: { practice_id: "oral_newton2_mvp1" }
      }
    ]
  },
  {
    material_version: "1.0",
    material_id: "material_newton2_exam_progress",
    material_type: "exam_progress",
    supported_card_types: ["exam.progress"],
    supports_claim_ids: [],
    evidence_refs: [],
    content: {
      title: "牛顿第二定律模拟测验",
      exam_id: "exam_newton2_mvp1",
      current: 1,
      total: 3,
      answered: 0,
      correct: 0,
      remaining_seconds: 180,
      progress: 0,
      message: "共 3 题。请完成当前题，再继续下一题。"
    },
    presentation: {
      title: "考试进度",
      eyebrow: "高中物理 · 模拟测验",
      badge: "进行中",
      tags: ["3 题"]
    },
    actions: [{ type: "exam.overview.open", label: "查看答题进度" }]
  },
  {
    material_version: "1.0",
    material_id: "material_newton2_exam_result",
    material_type: "exam_result",
    supported_card_types: ["exam.result"],
    supports_claim_ids: [],
    evidence_refs: [],
    content: {
      title: "牛顿第二定律模拟测验结果",
      exam_id: "exam_newton2_mvp1",
      score: 0,
      total_score: 100,
      total: 3,
      correct: 0,
      incorrect: 0,
      duration_seconds: 0,
      grade: "待完成",
      feedback: "完成三道题后，这里会给出针对性的复习建议。"
    },
    presentation: {
      title: "考试结果",
      eyebrow: "高中物理 · 模拟测验",
      badge: "结果",
      tags: ["掌握度"]
    },
    actions: [
      {
        type: "exam.retry",
        label: "再测一次",
        payload: { exam_id: "exam_newton2_mvp1" }
      }
    ]
  },
  {
    material_version: "1.0",
    material_id: "material_newton2_compiler",
    material_type: "compiler_status",
    supported_card_types: ["compiler.status"],
    supports_claim_ids: [],
    evidence_refs: ["evidence_newton2_note_01"],
    content: {
      title: "牛顿第二定律演示资料",
      artifact_id: NEWTON2_ARTIFACT_ID,
      source_type: "pdf",
      status: "compiled",
      progress: 100,
      message: "知识内容已可用于召回、讲解、练习和模拟测验。",
      knowledge_unit_count: 6,
      suggested_cards: [
        "knowledge.explanation",
        "knowledge.mindmap",
        "media.image",
        "media.video",
        "quiz.single-choice",
        "oral.practice",
        "exam.progress",
        "exam.result"
      ],
      steps: [
        { label: "解析文件内容", status: "completed" },
        { label: "生成知识 Claim", status: "completed" },
        { label: "建立检索入口", status: "completed" },
        { label: "关联卡片素材与题库", status: "completed" }
      ]
    },
    presentation: {
      title: "知识编译状态",
      eyebrow: "PDF · 高中物理讲义",
      badge: "已完成",
      tags: ["Mock 编译"]
    },
    actions: [
      {
        type: "artifact.open",
        label: "查看知识产物",
        payload: { artifact_id: NEWTON2_ARTIFACT_ID }
      }
    ]
  },
  {
    material_version: "1.0",
    material_id: "material_english_speaking_vocabulary",
    material_type: "vocabulary",
    supported_card_types: ["language.vocabulary"],
    supports_claim_ids: [
      "claim_english_speak_spelling",
      "claim_english_language_phrase"
    ],
    evidence_refs: ["evidence_english_classroom_01"],
    content: {
      title: "Words from this answer",
      entries: [
        {
          word: "speak",
          phonetic: "/spiːk/",
          part_of_speech: "verb",
          meaning: "说；讲",
          example: "Can you speak in English?",
          translation: "你能用英语说吗？"
        },
        {
          word: "English",
          phonetic: "/ˈɪŋɡlɪʃ/",
          part_of_speech: "noun / adjective",
          meaning: "英语；英语的",
          example: "Please answer in English.",
          translation: "请用英语回答。"
        }
      ]
    },
    presentation: {
      title: "Key vocabulary",
      eyebrow: "English · Vocabulary",
      badge: "2 words",
      tags: ["classroom English", "pronunciation"]
    },
    actions: []
  },
  {
    material_version: "1.0",
    material_id: "material_english_speaking_grammar",
    material_type: "grammar",
    supported_card_types: ["language.grammar"],
    supports_claim_ids: [
      "claim_english_can_you_pattern",
      "claim_english_language_phrase"
    ],
    evidence_refs: ["evidence_english_classroom_01"],
    content: {
      title: "Can you + verb ...?",
      pattern: "Can you + base verb + ...?",
      explanation:
        "Use this pattern to make a polite request or ask whether someone can do something.",
      examples: [
        {
          sentence: "Can you speak in English?",
          translation: "你能用英语说吗？"
        },
        {
          sentence: "Can you explain it again?",
          translation: "你能再解释一次吗？"
        }
      ],
      breakdown: [
        { segment: "Can you", role: "modal verb + subject" },
        { segment: "speak", role: "base verb" },
        { segment: "in English", role: "language phrase" }
      ],
      tip: "Spelling: speak ✓ · speek ✗"
    },
    presentation: {
      title: "Sentence pattern",
      eyebrow: "English · Grammar",
      badge: "Can you…?",
      tags: ["polite request", "base verb"]
    },
    actions: []
  }
]);

const privateAssessmentItems = deepFreeze([
  {
    assessment_version: "1.0",
    question_id: "quiz_newton_force_mass_01",
    topic_id: NEWTON2_TOPIC_ID,
    title: "力与加速度",
    prompt: "同一辆小车质量不变，合外力变为原来的 2 倍，加速度怎样变化？",
    options: [
      { id: "A", value: "A", label: "变为原来的 2 倍" },
      { id: "B", value: "B", label: "变为原来的 1/2" },
      { id: "C", value: "C", label: "保持不变" },
      { id: "D", value: "D", label: "无法判断" }
    ],
    hint: "从 F=ma 出发，先确认质量是否变化。",
    correct_answer: "A",
    explanation: "由 a=F/m 可知，质量不变时 a 与 F 成正比，所以合外力变为 2 倍，加速度也变为 2 倍。",
    supports_claim_ids: [
      "claim_newton2_formula",
      "claim_newton2_force_ratio",
      "claim_newton2_double_force"
    ]
  },
  {
    assessment_version: "1.0",
    question_id: "quiz_newton_mass_force_02",
    topic_id: NEWTON2_TOPIC_ID,
    title: "质量与加速度",
    prompt: "合外力保持不变，物体质量变为原来的 2 倍，加速度怎样变化？",
    options: [
      { id: "A", value: "A", label: "变为原来的 2 倍" },
      { id: "B", value: "B", label: "变为原来的 1/2" },
      { id: "C", value: "C", label: "保持不变" },
      { id: "D", value: "D", label: "方向反转" }
    ],
    hint: "把 F 保持不变，观察 a=F/m 中分母的变化。",
    correct_answer: "B",
    explanation: "由 a=F/m 可知，合外力不变时 a 与 m 成反比，所以质量变为 2 倍，加速度变为原来的 1/2。",
    supports_claim_ids: [
      "claim_newton2_formula",
      "claim_newton2_mass_ratio"
    ]
  },
  {
    assessment_version: "1.0",
    question_id: "quiz_newton_direction_03",
    topic_id: NEWTON2_TOPIC_ID,
    title: "加速度方向",
    prompt: "根据牛顿第二定律，物体的加速度方向与下列哪个方向一致？",
    options: [
      { id: "A", value: "A", label: "速度方向" },
      { id: "B", value: "B", label: "位移方向" },
      { id: "C", value: "C", label: "合外力方向" },
      { id: "D", value: "D", label: "任意一个分力方向" }
    ],
    hint: "F=ma 是矢量关系。",
    correct_answer: "C",
    explanation: "F=ma 是矢量关系，质量为正，因此加速度方向与物体所受合外力方向一致。",
    supports_claim_ids: [
      "claim_newton2_formula",
      "claim_newton2_direction"
    ]
  }
]);

export function listNewton2Claims() {
  return clone(claims);
}

export function getNewton2Claim(claimId) {
  const claim = claims.find((item) => item.claim_id === String(claimId || ""));
  return claim ? clone(claim) : null;
}

export function listNewton2Evidence() {
  return clone(evidence);
}

export function getNewton2Evidence(evidenceId) {
  const item = evidence.find((entry) => entry.evidence_id === String(evidenceId || ""));
  return item ? clone(item) : null;
}

export function listEnglishSpeakingClaims() {
  return clone(englishClaims);
}

export function listEnglishSpeakingEvidence() {
  return clone(englishEvidence);
}

export function listTeachingMaterials() {
  return clone(teachingMaterials);
}

export function getTeachingMaterial(materialId) {
  const material = teachingMaterials.find(
    (item) => item.material_id === String(materialId || "")
  );
  return material ? clone(material) : null;
}

export function getTeachingMaterialForCardType(cardType) {
  const material = teachingMaterials.find((item) =>
    item.supported_card_types.includes(String(cardType || ""))
  );
  return material ? clone(material) : null;
}

export function listPrivateAssessmentItemIds() {
  return privateAssessmentItems.map((item) => item.question_id);
}

export function getPrivateAssessmentItem(questionId) {
  const item = privateAssessmentItems.find(
    (entry) => entry.question_id === String(questionId || "")
  );
  return item ? clone(item) : null;
}

export function getFirstPrivateAssessmentItem() {
  return clone(privateAssessmentItems[0]);
}
