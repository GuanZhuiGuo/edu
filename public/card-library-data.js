import { createStaticKnowledgeCardParameterization } from "./knowledge-card-parameter-contract.js";

const CONTRACT_VERSION = "1.0";
const JSON_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";

const META_SCHEMA = {
  type: "object",
  description: "卡片展示元数据，不承载教学业务状态。",
  properties: {
    title: { type: "string", description: "卡片标题的后备值。" },
    eyebrow: { type: "string", description: "标题上方的学科或栏目名。" },
    badge: { type: "string", description: "难度、状态等短标签。" },
    tags: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
      description: "卡片标签，最多展示 4 个。"
    },
    artifact_ids: {
      type: "array",
      items: { type: "string" },
      description: "生成本卡片的知识编译产物 ID。"
    }
  },
  additionalProperties: true
};

const STATE_SCHEMA = {
  type: "object",
  description: "可变的交互与渲染状态。",
  properties: {
    status: { type: "string" },
    disabled: { type: "boolean" },
    locked: { type: "boolean" },
    loading: { type: "boolean" }
  },
  additionalProperties: true
};

const ACTIONS_SCHEMA = {
  type: "array",
  description: "卡片可触发的语义事件，前端统一回传到当前双工教学会话。",
  items: {
    type: "object",
    required: ["type"],
    properties: {
      type: {
        type: "string",
        pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$"
      },
      label: { type: "string" },
      payload: { type: "object", additionalProperties: true },
      disabled: { type: "boolean" },
      loading: { type: "boolean" }
    },
    additionalProperties: true
  }
};

function cardSchema(type, displayName, props, requiredProps = []) {
  return {
    $schema: JSON_SCHEMA_DRAFT,
    title: `${displayName} · EducationCard`,
    type: "object",
    required: ["id", "type", "version", "meta", "props", "state", "actions"],
    properties: {
      id: {
        type: "string",
        pattern: "^[a-zA-Z0-9_.:-]+$",
        description: "一次渲染中的卡片实例 ID，必须在当前会话内唯一。"
      },
      type: { const: type },
      version: { const: CONTRACT_VERSION },
      meta: META_SCHEMA,
      props: {
        type: "object",
        required: requiredProps,
        properties: props,
        additionalProperties: true
      },
      state: STATE_SCHEMA,
      actions: ACTIONS_SCHEMA
    },
    additionalProperties: false
  };
}

function card(type, id, displayName, category, description, exampleDescription, visualNotes, schema, mockData) {
  const normalizedMockData = {
    ...mockData,
    meta: {
      ...(mockData?.meta || {}),
      parameterization: createStaticKnowledgeCardParameterization({
        cardType: type,
        staticReason: "education_card_instance_server_controlled",
      }),
    },
  };
  return {
    type,
    version: CONTRACT_VERSION,
    displayName,
    id,
    category,
    description,
    exampleDescription,
    visualNotes,
    schema,
    mockData: normalizedMockData
  };
}

const definitions = [
  card(
    "knowledge.explanation",
    "edu.knowledge-explanation.v1",
    "知识讲解",
    "知识呈现",
    "将检索到的核心知识组织成可扫读的结论、公式、要点和引用。",
    "示例用牛顿第二定律展示正文、公式、要点与来源。适合教师语音讲解时同步出现。",
    ["学科眉题与难度标签建立层级", "公式使用独立强调区", "关键点控制在 3–5 条"],
    cardSchema(
      "knowledge.explanation",
      "知识讲解",
      {
        title: { type: "string" },
        summary: { type: "string" },
        body: { type: "string" },
        formula: { type: "string" },
        key_points: { type: "array", items: { type: "string" } },
        callout: { type: "string" },
        sources: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  title: { type: "string" },
                  citation_id: { type: "string" }
                },
                additionalProperties: true
              }
            ]
          }
        }
      },
      ["title", "body"]
    ),
    {
      id: "card_demo_explanation_01",
      type: "knowledge.explanation",
      version: CONTRACT_VERSION,
      meta: {
        title: "核心讲解",
        eyebrow: "高中物理 · 必修一",
        badge: "核心概念",
        tags: ["运动与力", "F=ma"],
        artifact_ids: ["artifact_newton_001"]
      },
      props: {
        title: "牛顿第二定律",
        summary: "物体的加速度与所受合外力成正比，与质量成反比。",
        body: "先选择研究对象并画受力图，再求合外力，最后沿选定方向列出运动方程。",
        formula: "F = ma",
        key_points: ["F 表示合外力", "a 与 F 的方向相同", "质量不变时，合外力越大，加速度越大"],
        callout: "判断比例关系前，先确认题目中保持不变的物理量。",
        sources: [{ title: "牛顿运动定律知识单元", citation_id: "citation_newton_01" }]
      },
      state: { status: "ready" },
      actions: [{ type: "quiz.start", label: "用一道题检验" }]
    }
  ),
  card(
    "knowledge.mindmap",
    "edu.knowledge-mindmap.v1",
    "知识结构",
    "知识呈现",
    "以一至四层树结构展示概念关系、解题步骤与知识分支。",
    "示例以牛顿第二定律为中心，展开公式、物理量和解题步骤三条分支。",
    ["根节点使用高对比色块", "分支通过留白和连接关系表达层级", "单卡建议不超过 16 个节点"],
    cardSchema(
      "knowledge.mindmap",
      "知识结构",
      {
        title: { type: "string" },
        root: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                children: { type: "array" }
              },
              additionalProperties: true
            }
          ]
        },
        branches: {
          type: "array",
          items: {
            type: "object",
            required: ["title"],
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              children: { type: "array" }
            },
            additionalProperties: true
          }
        },
        sources: { type: "array" }
      },
      ["root", "branches"]
    ),
    {
      id: "card_demo_mindmap_01",
      type: "knowledge.mindmap",
      version: CONTRACT_VERSION,
      meta: {
        title: "知识结构",
        eyebrow: "概念关系",
        badge: "3 个分支",
        artifact_ids: ["artifact_newton_001"]
      },
      props: {
        title: "牛顿第二定律知识结构",
        root: "牛顿第二定律",
        branches: [
          { id: "formula", title: "公式", children: ["F=ma", "矢量关系"] },
          { id: "quantity", title: "物理量", children: ["合外力 F", "质量 m", "加速度 a"] },
          { id: "steps", title: "解题步骤", children: ["选对象", "画受力图", "求合力", "列方程"] }
        ],
        sources: ["牛顿运动定律知识单元"]
      },
      state: { status: "ready" },
      actions: [{ type: "knowledge.branch.expand", label: "展开完整知识图谱" }]
    }
  ),
  card(
    "media.image",
    "edu.media-image.v1",
    "图片学习",
    "多媒体",
    "展示带有无障碍文本、图注和知识来源的教学图片。",
    "示例使用小车受力实验图，图注解释质量不变时力与加速度的关系。",
    ["图片使用固定圆角并保持原始比例", "图注与正文弱化分层", "alt 必须描述图片承担的教学信息"],
    cardSchema(
      "media.image",
      "图片学习",
      {
        title: { type: "string" },
        src: { type: "string", description: "站内 /assets/ 路径或 http(s) URL。" },
        alt: { type: "string" },
        caption: { type: "string" },
        decorative: { type: "boolean" },
        credit: { type: "string" }
      },
      ["src", "alt"]
    ),
    {
      id: "card_demo_image_01",
      type: "media.image",
      version: CONTRACT_VERSION,
      meta: {
        title: "图像材料",
        eyebrow: "实验观察",
        badge: "示意图",
        artifact_ids: ["artifact_newton_001"]
      },
      props: {
        title: "小车受力实验",
        src: "/assets/newton-cart-lesson.png",
        alt: "水平轨道上的实验小车受到向右的合外力并向右加速",
        caption: "保持质量不变，增大合外力，小车的加速度随之增大。",
        credit: "AI 教学素材"
      },
      state: { status: "ready" },
      actions: []
    }
  ),
  card(
    "media.video",
    "edu.media-video.v1",
    "视频学习",
    "多媒体",
    "展示教学视频、封面、字幕轨道和时长；素材未接入时支持 Mock 占位。",
    "示例展示 30 秒牛顿第二定律动画的 Mock 封面，避免请求不存在的视频资源。",
    ["封面延续图片卡的视觉比例", "播放按钮只表达视频语义", "Mock 状态必须明确标注，避免误导用户"],
    cardSchema(
      "media.video",
      "视频学习",
      {
        title: { type: "string" },
        src: { type: "string" },
        poster: { type: "string" },
        availability: { enum: ["ready", "mock", "unavailable"] },
        duration_seconds: { type: "number", minimum: 0 },
        caption: { type: "string" },
        caption_src: { type: "string" },
        caption_language: { type: "string" }
      },
      ["src"]
    ),
    {
      id: "card_demo_video_01",
      type: "media.video",
      version: CONTRACT_VERSION,
      meta: {
        title: "视频材料",
        eyebrow: "动画演示",
        badge: "00:30",
        artifact_ids: ["artifact_newton_001"]
      },
      props: {
        title: "30 秒看懂 F=ma",
        src: "/assets/newton-second-law-demo.mp4",
        poster: "/assets/newton-cart-lesson.png",
        availability: "mock",
        duration_seconds: 30,
        caption: "观察相同质量的小车在不同拉力下加速度的变化。"
      },
      state: { status: "ready" },
      actions: [{ type: "media.video.open", label: "查看完整演示" }]
    }
  ),
  card(
    "quiz.single-choice",
    "edu.quiz-single-choice.v1",
    "单项选择题",
    "练习与评测",
    "呈现一个题干与若干互斥选项，选中后立即发送 answer.select 语义事件。",
    "示例处于待作答状态。点击任一选项可在卡片库事件面板中查看标准回传数据。",
    ["选项使用整行触控区域", "选中字母与文案同步反馈", "正确与错误状态由确定性判题工具回写"],
    cardSchema(
      "quiz.single-choice",
      "单项选择题",
      {
        title: { type: "string" },
        question_id: { type: "string" },
        prompt: { type: "string" },
        options: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            required: ["id", "label"],
            properties: {
              id: { type: "string" },
              value: {},
              label: { type: "string" },
              description: { type: "string" }
            },
            additionalProperties: true
          }
        },
        hint: { type: "string" },
        explanation: { type: "string" }
      },
      ["question_id", "prompt", "options"]
    ),
    {
      id: "card_demo_quiz_01",
      type: "quiz.single-choice",
      version: CONTRACT_VERSION,
      meta: {
        title: "单选题",
        eyebrow: "课堂练习 · 第 1 题",
        badge: "2 分",
        tags: ["牛顿第二定律"]
      },
      props: {
        title: "力与加速度",
        question_id: "quiz_newton_001",
        prompt: "同一辆小车质量不变，合外力增大到原来的 2 倍，加速度怎样变化？",
        options: [
          { id: "A", value: "A", label: "增大到原来的 2 倍" },
          { id: "B", value: "B", label: "减小到原来的 1/2" },
          { id: "C", value: "C", label: "保持不变" },
          { id: "D", value: "D", label: "无法判断" }
        ],
        hint: "从 F=ma 出发，先确定不变量。"
      },
      state: {
        status: "awaiting_answer",
        selected: "",
        correct: null,
        correct_answer: "",
        locked: false
      },
      actions: [
        { type: "answer.select", label: "选择 A", payload: { question_id: "quiz_newton_001", value: "A" } },
        { type: "answer.select", label: "选择 B", payload: { question_id: "quiz_newton_001", value: "B" } },
        { type: "answer.select", label: "选择 C", payload: { question_id: "quiz_newton_001", value: "C" } },
        { type: "answer.select", label: "选择 D", payload: { question_id: "quiz_newton_001", value: "D" } }
      ]
    }
  ),
  card(
    "oral.practice",
    "edu.oral-practice.v1",
    "口语陪练",
    "练习与评测",
    "给出口语任务、参考表达、时限和评分维度，并触发录音或提交事件。",
    "示例要求学生在 30 秒内解释力与加速度的关系，可点击按钮查看录音事件格式。",
    ["任务句使用引用块突出", "参考表达与任务保持明确区隔", "时长和评分维度使用轻量标签"],
    cardSchema(
      "oral.practice",
      "口语陪练",
      {
        title: { type: "string" },
        prompt: { type: "string" },
        reference_answer: { type: "string" },
        time_limit_seconds: { type: "number", minimum: 1 },
        scoring_dimensions: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "label", "weight"],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              weight: { type: "number", minimum: 0, maximum: 1 }
            }
          }
        },
        tips: { type: "array", items: { type: "string" } }
      },
      ["prompt"]
    ),
    {
      id: "card_demo_oral_01",
      type: "oral.practice",
      version: CONTRACT_VERSION,
      meta: {
        title: "口语陪练",
        eyebrow: "概念复述",
        badge: "30 秒"
      },
      props: {
        title: "用自己的话解释",
        prompt: "为什么同一物体受到更大的合外力时，加速度会更大？",
        reference_answer: "根据 F=ma，质量不变时，加速度与合外力成正比，所以合外力越大，加速度越大。",
        time_limit_seconds: 30,
        scoring_dimensions: [
          { id: "accuracy", label: "概念准确", weight: 0.5 },
          { id: "structure", label: "表达完整", weight: 0.3 },
          { id: "fluency", label: "表达流畅", weight: 0.2 }
        ],
        tips: ["先说公式", "指出不变量", "最后给出结论"]
      },
      state: { status: "ready", recording_seconds: 0 },
      actions: [
        {
          type: "oral.record.start",
          label: "开始复述",
          payload: { practice_id: "oral_newton_001" }
        }
      ]
    }
  ),
  card(
    "exam.progress",
    "edu.exam-progress.v1",
    "考试进度",
    "练习与评测",
    "在模拟考试中同步展示题目位置、作答数量、正确数和剩余时间。",
    "示例展示一套 10 题测验进行到第 4 题、已完成 3 题的状态。",
    ["主进度条承载整体完成度", "当前题、已作答、答对和时间保持同级", "信息只读，不在本卡中判题"],
    cardSchema(
      "exam.progress",
      "考试进度",
      {
        title: { type: "string" },
        current: { type: "integer", minimum: 0 },
        total: { type: "integer", minimum: 1 },
        answered: { type: "integer", minimum: 0 },
        correct: { type: "integer", minimum: 0 },
        remaining_seconds: { type: "number", minimum: 0 },
        progress: { type: "number", minimum: 0, maximum: 100 },
        message: { type: "string" }
      },
      ["current", "total", "answered"]
    ),
    {
      id: "card_demo_exam_progress_01",
      type: "exam.progress",
      version: CONTRACT_VERSION,
      meta: {
        title: "考试进度",
        eyebrow: "牛顿运动定律 · 模拟测验",
        badge: "进行中"
      },
      props: {
        title: "牛顿运动定律模拟测验",
        current: 4,
        total: 10,
        answered: 3,
        correct: 2,
        remaining_seconds: 482,
        message: "完成当前题后可返回检查已作答题目。"
      },
      state: { status: "in_progress" },
      actions: [{ type: "exam.overview.open", label: "查看答题卡" }]
    }
  ),
  card(
    "exam.result",
    "edu.exam-result.v1",
    "考试结果",
    "练习与评测",
    "汇总分数、正确率、答题统计、用时和教师反馈。",
    "示例展示 10 道题答对 8 道、得分 80 分，并提供重新测验动作。",
    ["分数是首要视觉焦点", "正确率进度条辅助解释成绩", "反馈提供明确的下一步学习建议"],
    cardSchema(
      "exam.result",
      "考试结果",
      {
        title: { type: "string" },
        score: { type: "number", minimum: 0 },
        total_score: { type: "number", minimum: 1 },
        total: { type: "integer", minimum: 1 },
        correct: { type: "integer", minimum: 0 },
        incorrect: { type: "integer", minimum: 0 },
        duration_seconds: { type: "number", minimum: 0 },
        grade: { type: "string" },
        feedback: { type: "string" }
      },
      ["score", "total", "correct"]
    ),
    {
      id: "card_demo_exam_result_01",
      type: "exam.result",
      version: CONTRACT_VERSION,
      meta: {
        title: "考试结果",
        eyebrow: "牛顿运动定律 · 模拟测验",
        badge: "已完成"
      },
      props: {
        title: "模拟考试结果",
        score: 80,
        total_score: 100,
        total: 10,
        correct: 8,
        incorrect: 2,
        answered: 10,
        duration_seconds: 536,
        grade: "掌握良好",
        feedback: "概念关系掌握准确，建议继续练习斜面与连接体的综合受力分析。"
      },
      state: { status: "completed" },
      actions: [{ type: "exam.retry", label: "再测一次", payload: { exam_id: "exam_newton_001" } }]
    }
  ),
  card(
    "language.vocabulary",
    "edu.language-vocabulary.v1",
    "英语单词",
    "语言学习",
    "把本轮英语回答中的重点词汇整理为发音、词性、释义与例句。",
    "示例纠正 speak 的拼写，并补充 English 的常见课堂表达。",
    ["单词是第一视觉层级", "音标与词性弱化呈现", "例句和翻译成对展示"],
    cardSchema(
      "language.vocabulary",
      "英语单词",
      {
        title: { type: "string" },
        entries: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            required: ["word", "meaning"],
            properties: {
              word: { type: "string" },
              phonetic: { type: "string" },
              part_of_speech: { type: "string" },
              meaning: { type: "string" },
              example: { type: "string" },
              translation: { type: "string" }
            },
            additionalProperties: true
          }
        },
        sources: { type: "array" }
      },
      ["title", "entries"]
    ),
    {
      id: "card_demo_vocabulary_01",
      type: "language.vocabulary",
      version: CONTRACT_VERSION,
      meta: {
        title: "Key vocabulary",
        eyebrow: "English · Vocabulary",
        badge: "2 words",
        tags: ["classroom English", "pronunciation"],
        artifact_ids: ["artifact_english_classroom_speaking_mvp1"]
      },
      props: {
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
        ],
        sources: ["Classroom English · Polite requests"]
      },
      state: { status: "ready" },
      actions: []
    }
  ),
  card(
    "language.grammar",
    "edu.language-grammar.v1",
    "英语语法句型",
    "语言学习",
    "用句型结构、示例和成分拆解呈现本轮英语表达中的语法重点。",
    "示例讲解 Can you + base verb，并纠正 can you speek in English。",
    ["句型公式使用高对比强调区", "例句与译文紧邻", "语法成分使用轻量标签"],
    cardSchema(
      "language.grammar",
      "英语语法句型",
      {
        title: { type: "string" },
        pattern: { type: "string" },
        explanation: { type: "string" },
        examples: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["sentence"],
            properties: {
              sentence: { type: "string" },
              translation: { type: "string" }
            },
            additionalProperties: true
          }
        },
        breakdown: {
          type: "array",
          items: {
            type: "object",
            required: ["segment", "role"],
            properties: {
              segment: { type: "string" },
              role: { type: "string" }
            },
            additionalProperties: true
          }
        },
        tip: { type: "string" },
        sources: { type: "array" }
      },
      ["title", "pattern", "examples"]
    ),
    {
      id: "card_demo_grammar_01",
      type: "language.grammar",
      version: CONTRACT_VERSION,
      meta: {
        title: "Sentence pattern",
        eyebrow: "English · Grammar",
        badge: "Can you…?",
        tags: ["polite request", "base verb"],
        artifact_ids: ["artifact_english_classroom_speaking_mvp1"]
      },
      props: {
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
        tip: "Spelling: speak ✓ · speek ✗",
        sources: ["Classroom English · Polite requests"]
      },
      state: { status: "ready" },
      actions: []
    }
  ),
  card(
    "compiler.status",
    "edu.compiler-status.v1",
    "知识编译状态",
    "知识编译",
    "呈现文本、图片、语音或 PDF 从接入到知识单元和卡片素材的编译进度。",
    "示例为一个 PDF 编译完成状态，包含处理步骤、知识单元数量和可生成卡片类型。",
    ["状态和百分比位于首行", "步骤列表同时表达阶段和结果", "产物数量帮助用户预判可用内容"],
    cardSchema(
      "compiler.status",
      "知识编译状态",
      {
        title: { type: "string" },
        artifact_id: { type: "string" },
        source_type: { enum: ["audio", "image", "text", "pdf"] },
        status: { enum: ["pending", "processing", "compiled", "failed"] },
        progress: { type: "number", minimum: 0, maximum: 100 },
        message: { type: "string" },
        knowledge_unit_count: { type: "integer", minimum: 0 },
        suggested_cards: { type: "array", items: { type: "string" } },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["label", "status"],
            properties: {
              label: { type: "string" },
              status: { type: "string" }
            }
          }
        },
        sources: { type: "array" }
      },
      ["artifact_id", "source_type", "status"]
    ),
    {
      id: "card_demo_compiler_01",
      type: "compiler.status",
      version: CONTRACT_VERSION,
      meta: {
        title: "知识编译状态",
        eyebrow: "PDF · 高中物理讲义",
        badge: "已完成",
        artifact_ids: ["artifact_physics_pdf_001"]
      },
      props: {
        title: "牛顿运动定律讲义",
        artifact_id: "artifact_physics_pdf_001",
        source_type: "pdf",
        status: "compiled",
        progress: 100,
        message: "知识内容已可用于召回、讲解和出题。",
        knowledge_unit_count: 12,
        suggested_cards: ["knowledge.explanation", "knowledge.mindmap", "quiz.single-choice"],
        steps: [
          { label: "解析文件内容", status: "completed" },
          { label: "生成知识单元", status: "completed" },
          { label: "建立检索索引", status: "completed" },
          { label: "生成卡片素材", status: "completed" }
        ],
        sources: ["牛顿运动定律讲义.pdf"]
      },
      state: { status: "compiled", progress: 100 },
      actions: [{ type: "artifact.open", label: "查看知识产物", payload: { artifact_id: "artifact_physics_pdf_001" } }]
    }
  )
];

export const CARD_LIBRARY_VERSION = "1.0";
export const EDUCATION_CARD_CATALOG = deepFreeze(definitions);
export const EDUCATION_CARD_DEFINITIONS = EDUCATION_CARD_CATALOG;
export const EDUCATION_CARD_TYPES = Object.freeze(definitions.map((item) => item.type));
export const CARD_LIBRARY_BY_TYPE = new Map(
  definitions.map((item) => [item.type, item])
);

export function listEducationCards() {
  return EDUCATION_CARD_CATALOG.map(cloneValue);
}

export function getEducationCardDefinition(typeOrId) {
  const key = String(typeOrId || "");
  const definition =
    CARD_LIBRARY_BY_TYPE.get(key) ||
    EDUCATION_CARD_CATALOG.find((item) => item.id === key);
  return definition ? cloneValue(definition) : null;
}

export function getEducationCardMock(typeOrId) {
  return getEducationCardDefinition(typeOrId)?.mockData || null;
}

function cloneValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
