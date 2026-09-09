import { createId } from "./contracts.js";
import { parameterizeKnowledgeCardMaterials } from "./public/knowledge-card-parameter-contract.js";

const SUPPORTED_SOURCE_TYPES = new Set(["audio", "image", "text", "pdf"]);
const artifacts = new Map();
const DEFAULT_SEARCH_MIN_SCORE = 8;
const MAX_SEARCH_RESULTS = 5;

const NEWTON_QUESTION = {
  question_id: "quiz_newton_force_mass_01",
  artifact_id: "artifact_newton_second_law",
  knowledge_unit_id: "ku_newton_second_law",
  material_id: "material_newton_quiz",
  title: "力与加速度",
  prompt: "同一辆小车质量不变，所受合外力增大到原来的 2 倍，它的加速度会怎样变化？",
  options: [
    { id: "A", value: "A", label: "增大到原来的 2 倍" },
    { id: "B", value: "B", label: "减小到原来的一半" },
    { id: "C", value: "C", label: "保持不变" },
    { id: "D", value: "D", label: "无法判断" }
  ],
  hint: "从 F=ma 出发，先确定题目中保持不变的物理量。",
  answer_key: "A",
  explanation: "由 F=ma 可知，质量 m 不变时，加速度 a 与合外力 F 成正比。"
};

const educationQuestions = new Map([
  [NEWTON_QUESTION.question_id, structuredClone(NEWTON_QUESTION)]
]);

const NEWTON_ARTIFACT = {
  artifact_id: "artifact_newton_second_law",
  source_type: "text",
  status: "compiled",
  title: "牛顿第二定律",
  knowledge_units: [
    {
      id: "ku_newton_second_law",
      title: "牛顿第二定律：合外力决定加速度",
      summary: "物体的加速度与所受合外力成正比，与质量成反比，方向与合外力一致。",
      content:
        "牛顿第二定律写作 F=ma。这里的 F 是物体所受合外力，m 是质量，a 是加速度。分析题目时先选研究对象、画受力图、求合外力，再沿选定方向列方程。相同质量下合外力越大，加速度越大；相同合外力下质量越大，加速度越小。",
      keywords: ["牛顿第二定律", "F=ma", "合外力", "质量", "加速度", "受力分析"],
      citations: ["citation_newton_compiled_note"],
      question_ids: [NEWTON_QUESTION.question_id],
      card_materials: [
        {
          material_id: "material_newton_explanation",
          recommended_type: "knowledge.explanation",
          data: {
            formula: "F = ma",
            key_points: ["F 指合外力", "加速度方向与合外力一致", "先受力分析再列方程"]
          }
        },
        {
          material_id: "material_newton_mindmap",
          recommended_type: "knowledge.mindmap",
          data: {
            root: "牛顿第二定律",
            branches: [
              { title: "公式", children: ["F=ma", "矢量关系"] },
              { title: "变量", children: ["合外力 F", "质量 m", "加速度 a"] },
              { title: "解题", children: ["选对象", "画受力图", "列方程"] }
            ]
          }
        },
        {
          material_id: "material_newton_cart_image",
          recommended_type: "media.image",
          data: {
            src: "/assets/newton-cart-lesson.png",
            alt: "小车在水平面上受力并产生加速度的牛顿第二定律示意图",
            caption: "同一辆小车受到更大的合外力时，加速度更大。"
          }
        },
        {
          material_id: "material_newton_quiz",
          recommended_type: "quiz.single-choice",
          data: publicQuestion(NEWTON_QUESTION)
        }
      ]
    }
  ],
  citations: [
    {
      citation_id: "citation_newton_compiled_note",
      title: "牛顿第二定律演示知识单元",
      source_type: "text",
      locator: "mock://curriculum/physics/newton-second-law",
      excerpt: "物体加速度与合外力成正比，与质量成反比。"
    }
  ],
  card_materials: [
    {
      material_id: "material_newton_cart_image",
      recommended_type: "media.image",
      data: {
        src: "/assets/newton-cart-lesson.png",
        alt: "小车在水平面上受力并产生加速度的牛顿第二定律示意图",
        caption: "牛顿第二定律小车实验示意"
      }
    }
  ],
  created_at: "2026-07-25T00:00:00.000Z",
  compiler_version: "mock-1.0",
  metadata: { subject: "physics", grade_band: "middle-school" }
};

artifacts.set(NEWTON_ARTIFACT.artifact_id, parameterizeArtifactCardMaterials(NEWTON_ARTIFACT));

function parameterizeArtifactCardMaterials(value) {
  const artifact = structuredClone(value);
  artifact.card_materials = parameterizeKnowledgeCardMaterials(artifact.card_materials, {
    staticReason: "seeded_compiled_material_has_no_trusted_parameter_template"
  });
  artifact.knowledge_units = Array.isArray(artifact.knowledge_units)
    ? artifact.knowledge_units.map((unit) => ({
      ...unit,
      card_materials: parameterizeKnowledgeCardMaterials(unit.card_materials, {
        staticReason: "seeded_compiled_material_has_no_trusted_parameter_template"
      })
    }))
    : [];
  return artifact;
}

export function listKnowledgeArtifacts() {
  return [...artifacts.values()]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map((artifact) => structuredClone(artifact));
}

export function getKnowledgeArtifact(id) {
  const artifact = artifacts.get(String(id || ""));
  return artifact ? structuredClone(artifact) : null;
}

export function compileKnowledgeSource(input = {}) {
  if (!isPlainObject(input)) throw new TypeError("Knowledge source must be an object");

  const sourceType = String(input.source_type ?? input.sourceType ?? input.type ?? "").toLowerCase();
  if (!SUPPORTED_SOURCE_TYPES.has(sourceType)) {
    throw new TypeError(`Unsupported knowledge source type: ${sourceType || "missing"}`);
  }

  const artifactId =
    normalizeIdentifier(input.artifact_id ?? input.artifactId) || createId("artifact");
  const title =
    safeText(input.title ?? input.name, 240) ||
    `${sourceType.toUpperCase()} Mock 编译产物`;
  const sourceText = safeText(input.content ?? input.text ?? input.transcript, 200000);
  const summary = buildSummary(sourceType, sourceText, title);
  const citationId = createId("citation");
  const unitId = createId("ku");
  const createdAt = new Date().toISOString();
  const mediaUri = safeText(input.uri ?? input.url, 4000);

  const cardMaterials = parameterizeKnowledgeCardMaterials(buildCardMaterials({
    sourceType,
    title,
    summary,
    mediaUri,
    artifactId
  }), { staticReason: "compiled_upload_has_no_trusted_parameter_template" });
  const artifact = {
    artifact_id: artifactId,
    source_type: sourceType,
    status: "compiled",
    title,
    knowledge_units: [
      {
        id: unitId,
        title,
        summary,
        content:
          sourceText ||
          `这是由 Mock 编译器从 ${sourceType} 来源生成的知识单元。接入真实编译服务后，此处替换为转写、OCR、解析和切片结果。`,
        keywords: extractKeywords(`${title} ${sourceText}`),
        citations: [citationId],
        card_materials: structuredClone(cardMaterials)
      }
    ],
    citations: [
      {
        citation_id: citationId,
        title,
        source_type: sourceType,
        locator: mediaUri || `mock://compiled/${artifactId}`,
        excerpt: summary
      }
    ],
    card_materials: cardMaterials,
    created_at: createdAt,
    compiler_version: "mock-1.0",
    metadata: sanitizeMetadata(input.metadata)
  };

  artifacts.set(artifactId, structuredClone(artifact));
  return structuredClone(artifact);
}

export function searchKnowledge(query, { artifactIds, topK = 5 } = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const allowedIds =
    Array.isArray(artifactIds) && artifactIds.length
      ? new Set(artifactIds.map((id) => String(id)))
      : null;
  const limit = Math.max(1, Math.min(20, Number.isFinite(Number(topK)) ? Number(topK) : 5));
  const results = [];

  for (const artifact of artifacts.values()) {
    if (artifact.status !== "compiled" || (allowedIds && !allowedIds.has(artifact.artifact_id))) {
      continue;
    }
    for (const unit of artifact.knowledge_units) {
      const haystack = normalizeSearchText(
        `${artifact.title} ${unit.title} ${unit.summary} ${unit.content} ${(unit.keywords || []).join(" ")}`
      );
      const score = relevanceScore(normalizedQuery, haystack);
      if (normalizedQuery && score <= 0) continue;
      results.push({
        artifact_id: artifact.artifact_id,
        source_type: artifact.source_type,
        knowledge_unit_id: unit.id,
        title: unit.title,
        summary: unit.summary,
        content: unit.content,
        score,
        citations: artifact.citations.filter((citation) =>
          (unit.citations || []).includes(citation.citation_id)
        ),
        card_materials: structuredClone(unit.card_materials || artifact.card_materials || [])
      });
    }
  }

  return results
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit)
    .map((result) => structuredClone(result));
}

export function searchCompiledKnowledge(
  query,
  { artifactIds, topK = 3, minScore = DEFAULT_SEARCH_MIN_SCORE } = {}
) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    throw new TypeError("Knowledge search query must not be empty");
  }

  const limit = Math.max(
    1,
    Math.min(
      MAX_SEARCH_RESULTS,
      Number.isFinite(Number(topK)) ? Math.trunc(Number(topK)) : 3
    )
  );
  const threshold = Math.max(
    0,
    Number.isFinite(Number(minScore))
      ? Number(minScore)
      : DEFAULT_SEARCH_MIN_SCORE
  );
  const matches = searchKnowledge(query, {
    artifactIds,
    topK: MAX_SEARCH_RESULTS
  })
    .filter((result) => result.score >= threshold)
    .slice(0, limit);

  return {
    status: matches.length ? "matched" : "no_match",
    query: safeText(query, 2000),
    matches: structuredClone(matches)
  };
}

export function gradeCompiledKnowledgeAnswer(questionId, selected) {
  const normalizedQuestionId = normalizeIdentifier(questionId);
  const question = educationQuestions.get(normalizedQuestionId);
  if (!question) return null;

  const normalizedSelection = normalizeAnswerSelection(selected);
  const allowedValues = new Set(
    question.options.map((option) =>
      normalizeAnswerSelection(option.value ?? option.id)
    )
  );
  if (!normalizedSelection || !allowedValues.has(normalizedSelection)) {
    throw new TypeError("Selected answer is not a valid option");
  }

  return {
    question: publicQuestion(question),
    question_id: question.question_id,
    artifact_id: question.artifact_id,
    knowledge_unit_id: question.knowledge_unit_id,
    material_id: question.material_id,
    selected: normalizedSelection,
    correct: normalizedSelection === question.answer_key,
    correct_answer: question.answer_key,
    explanation: question.explanation
  };
}

function buildSummary(sourceType, sourceText, title) {
  if (sourceText) {
    const firstSentence = sourceText.split(/(?<=[。！？.!?])\s*/)[0] || sourceText;
    return safeText(firstSentence, 280);
  }
  const capability = {
    audio: "语音转写与知识切片",
    image: "图片 OCR、视觉理解与知识切片",
    text: "文本清洗、结构化与知识切片",
    pdf: "PDF 解析、章节识别与知识切片"
  }[sourceType];
  return `${title} 已完成 Mock ${capability}。`;
}

function buildCardMaterials({ sourceType, title, summary, mediaUri, artifactId }) {
  const materials = [
    {
      material_id: createId("material"),
      recommended_type: "knowledge.explanation",
      data: { title, summary, artifact_id: artifactId }
    }
  ];

  if (sourceType === "image") {
    materials.push({
      material_id: createId("material"),
      recommended_type: "media.image",
      data: {
        src: mediaUri || "/assets/newton-cart-lesson.png",
        alt: title,
        caption: summary
      }
    });
  }
  if (sourceType === "audio") {
    materials.push({
      material_id: createId("material"),
      recommended_type: "oral.practice",
      data: { prompt: summary, source_uri: mediaUri }
    });
  }
  if (sourceType === "pdf" || sourceType === "text") {
    materials.push({
      material_id: createId("material"),
      recommended_type: "knowledge.mindmap",
      data: {
        root: title,
        branches: [{ title: "编译摘要", children: [summary] }]
      }
    });
  }
  return materials;
}

function relevanceScore(query, haystack) {
  if (!query) return 1;
  let score = haystack.includes(query) ? 100 + query.length : 0;
  for (const token of searchTokens(query)) {
    if (haystack.includes(token)) score += token.length >= 2 ? 4 : 1;
  }
  return score;
}

function searchTokens(value) {
  const compact = normalizeSearchText(value);
  const tokens = new Set(compact.split(/\s+/).filter(Boolean));
  const chinese = compact.replace(/[^\p{Script=Han}]/gu, "");
  for (let index = 0; index < chinese.length - 1; index += 1) {
    tokens.add(chinese.slice(index, index + 2));
  }
  return [...tokens];
}

function extractKeywords(value) {
  return searchTokens(value)
    .filter((token) => token.length >= 2)
    .slice(0, 12);
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}=]+/gu, " ")
    .trim();
}

function normalizeIdentifier(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 160);
}

function normalizeAnswerSelection(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[Ａ-Ｚ]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0)
    )
    .slice(0, 40);
}

function publicQuestion(question) {
  return {
    question_id: question.question_id,
    title: question.title,
    prompt: question.prompt,
    options: structuredClone(question.options),
    hint: question.hint
  };
}

function safeText(value, limit) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit);
}

function sanitizeMetadata(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, item]) => [safeText(key, 80), safeText(item, 500)])
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
