import {
  createEducationA2UI,
  validateEducationCard
} from "./education-card-assembler.js";
import { CONTRACT_VERSION } from "./contracts.js";
import {
  assertKnowledgeCardParameterization,
  createStaticKnowledgeCardParameterization
} from "./public/knowledge-card-parameter-contract.js";

const SUPPORTED_MATERIAL_CARD_TYPES = new Set([
  "knowledge.explanation",
  "knowledge.mindmap",
  "quiz.single-choice"
]);

/**
 * Convert a generated public material bundle into the same trusted
 * EducationCard@1.0 + A2UI v0.9 surface used by the rest of the application.
 * Model output never selects components: it can only fill the three catalog
 * card contracts below.
 */
export function createKnowledgeMaterialA2UI(publicBundle) {
  if (!isPlainObject(publicBundle)) {
    throw new TypeError("publicBundle must be an object");
  }

  const bundleId = safeIdentifier(publicBundle.bundle_id, 96);
  if (!bundleId) throw new TypeError("publicBundle.bundle_id is required");

  const topic = isPlainObject(publicBundle.topic) ? publicBundle.topic : {};
  const claims = normalizeClaims(publicBundle.claims);
  const knownClaimIds = new Set(claims.map((claim) => claim.claim_id));
  const materials = Array.isArray(publicBundle.card_materials)
    ? publicBundle.card_materials
    : [];
  const generationBadge =
    publicBundle.execution?.mode === "source_first"
      ? "源码生成"
      : "真实生成";
  const cards = [];
  const cardClaimBindings = [];

  for (const material of materials) {
    if (!isPlainObject(material)) continue;
    const type = String(material.recommended_type || "");
    if (!SUPPORTED_MATERIAL_CARD_TYPES.has(type)) continue;

    const claimIds = uniqueStrings(material.supports_claim_ids).filter(
      (claimId) => knownClaimIds.has(claimId)
    );
    if (claimIds.length === 0) {
      throw new TypeError(`${type} requires a verified claim binding`);
    }

    const card = buildMaterialCard({
      bundleId,
      topic,
      material,
      type,
      generationBadge
    });
    const validation = validateEducationCard(card);
    if (!validation.valid) {
      throw new TypeError(
        `${type} failed EducationCard validation: ${validation.errors
          .map((issue) => `${issue.path} ${issue.message}`)
          .join("; ")}`
      );
    }

    cards.push(card);
    cardClaimBindings.push({
      card_id: card.id,
      supports_claim_ids: claimIds
    });
  }

  if (cards.length === 0) {
    throw new TypeError("publicBundle has no supported card materials");
  }

  const surface = createEducationA2UI({
    surfaceId: safeIdentifier(`knowledge_material_${bundleId}`, 96),
    cards,
    operation: "replace",
    packageId: bundleId
  });

  return {
    ...surface,
    contract_version: CONTRACT_VERSION,
    bundle_id: bundleId,
    card_claim_bindings: cardClaimBindings
  };
}

function buildMaterialCard({
  bundleId,
  topic,
  material,
  type,
  generationBadge
}) {
  const data = isPlainObject(material.data)
    ? structuredClone(material.data)
    : {};
  const materialId =
    safeIdentifier(material.material_id, 96) ||
    safeIdentifier(`${bundleId}_${type}`, 96);
  const topicTitle = safeText(topic.title, 120) || "知识点";
  const subject = safeText(topic.subject, 40);
  const gradeBand = safeText(topic.grade_band, 40);
  const eyebrow = [subject, gradeBand].filter(Boolean).join(" · ");
  const common = {
    id: safeIdentifier(`card_${materialId}`, 96),
    type,
    version: CONTRACT_VERSION,
    meta: {
      title: topicTitle,
      eyebrow,
      badge: generationBadge || "真实生成",
      tags: [topicTitle].filter(Boolean),
      artifact_ids: [bundleId],
      parameterization: normalizedMaterialParameterization(material, type)
    },
    props: {},
    state: { status: "ready" },
    actions: []
  };

  if (type === "knowledge.explanation") {
    common.props = pickDefined(data, [
      "title",
      "summary",
      "body",
      "formula",
      "key_points",
      "callout",
      "sources"
    ]);
    common.actions = [
      {
        type: "knowledge.followup",
        label: "继续追问",
        payload: {
          bundle_id: bundleId,
          material_id: materialId
        }
      }
    ];
    return common;
  }

  if (type === "knowledge.mindmap") {
    common.props = pickDefined(data, [
      "title",
      "root",
      "branches",
      "sources"
    ]);
    common.actions = [
      {
        type: "knowledge.branch.expand",
        label: "展开知识结构",
        payload: {
          bundle_id: bundleId,
          material_id: materialId
        }
      }
    ];
    return common;
  }

  const questionId = safeIdentifier(data.question_id, 96);
  const options = Array.isArray(data.options)
    ? data.options.map((option) =>
        pickDefined(option, ["id", "value", "label", "description"])
      )
    : [];
  common.meta = {
    ...common.meta,
    title: safeText(data.title, 120) || "单项选择题",
    badge: "待作答"
  };
  common.props = pickDefined(
    {
      title: data.title,
      question_id: questionId,
      prompt: data.prompt,
      options,
      hint: data.hint
    },
    ["title", "question_id", "prompt", "options", "hint"]
  );
  common.state = {
    status: "awaiting_answer",
    selected: "",
    correct: null,
    locked: false
  };
  common.actions = options.map((option) => ({
    type: "answer.select",
    label: `选择 ${safeText(option.id, 8)}`,
    payload: {
      bundle_id: bundleId,
      question_id: questionId,
      value: option.value,
      grading_source: "knowledge.materials",
      grade_endpoint: "/api/knowledge/materials/grade"
    }
  }));
  return common;
}

function normalizedMaterialParameterization(material, type) {
  const contract = material?.parameterization || createStaticKnowledgeCardParameterization({
    cardType: type,
    staticReason: "generated_material_has_no_trusted_parameter_template"
  });
  assertKnowledgeCardParameterization(contract);
  return structuredClone(contract);
}

function normalizeClaims(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isPlainObject)
    .map((claim) => ({
      claim_id: safeIdentifier(claim.claim_id ?? claim.id, 96),
      text: safeText(claim.text, 600),
      source_support: safeText(claim.source_support, 500)
    }))
    .filter((claim) => claim.claim_id && claim.text);
}

function pickDefined(value, keys) {
  const source = isPlainObject(value) ? value : {};
  return Object.fromEntries(
    keys
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, structuredClone(source[key])])
  );
}

function uniqueStrings(value) {
  const values = Array.isArray(value) ? value : [];
  return [
    ...new Set(
      values
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

function safeIdentifier(value, maxLength = 96) {
  const candidate = String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(candidate)
    ? candidate
    : "";
}

function safeText(value, maxLength) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
