import { createHash } from "node:crypto";

import {
  assertKnowledgeCardParameterization,
  createStaticKnowledgeCardParameterization,
} from "./public/knowledge-card-parameter-contract.js";

export const EDUCATION_CARD_PROPOSAL_VERSION = "education-card-template-proposal@1.0";

export function validateEducationCardTemplateProposal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.schema_version !== EDUCATION_CARD_PROPOSAL_VERSION) return false;
  if (!value.proposal_id || !value.knowledge_point_candidate_id || !value.knowledge_point_name) return false;
  if (!["knowledge.explanation", "knowledge.mindmap", "interactive_visual"].includes(value.card_type)) return false;
  if (!["static", "bounded_template_match"].includes(value.renderability)) return false;
  if (!Array.isArray(value.source_refs) || typeof value.publishable !== "boolean") return false;
  if (!["needs_review", "approved", "rejected"].includes(value.review_status)) return false;
  try {
    assertKnowledgeCardParameterization(value.parameterization);
  } catch {
    return false;
  }
  if (value.renderability === "static") {
    return value.parameterization.mode === "none" && value.artifact_ref === null;
  }
  return value.card_type === "interactive_visual"
    && value.parameterization.mode === "bounded"
    && typeof value.artifact_ref === "string"
    && value.artifact_ref.length > 0
    && value.template_match?.method === "exact_title"
    && value.template_match?.confidence === 1;
}

/**
 * Compile reviewable card-template proposals from an import's canonical
 * candidate pack. Static source-bound cards are always safe to propose. An
 * interactive proposal is emitted only when the knowledge-point label exactly
 * matches a server-owned trusted artifact; fuzzy matching never grants a
 * renderer or input Schema.
 */
export function compileEducationCardTemplateProposals({
  candidatePack,
  trustedArtifacts = [],
  maxKnowledgePoints = 240,
} = {}) {
  const knowledgePoints = (candidatePack?.candidates?.curriculum_standards || [])
    .filter((item) => item?.candidate_type === "knowledge_point" && item?.id && pointTitle(item))
    .slice(0, maxKnowledgePoints);
  const trustedByExactTitle = trustedArtifactIndex(trustedArtifacts);
  const proposals = [];

  for (const point of knowledgePoints) {
    const sourceRefs = normalizedSourceRefs(point);
    proposals.push(staticProposal(point, "knowledge.explanation", "source_bound_text", sourceRefs));
    proposals.push(staticProposal(point, "knowledge.mindmap", "ontology_relation_structure", sourceRefs));

    const trusted = trustedByExactTitle.get(normalizeExactTitle(pointTitle(point)));
    if (!trusted) continue;
    const parameterization = trusted?.interactive?.parameterization;
    try {
      assertKnowledgeCardParameterization(parameterization);
      if (parameterization.mode !== "bounded") continue;
    } catch {
      continue;
    }
    proposals.push(Object.freeze({
      schema_version: EDUCATION_CARD_PROPOSAL_VERSION,
      proposal_id: stableId("cardproposal", point.id, "interactive", trusted.artifact_id),
      knowledge_point_candidate_id: String(point.id),
      knowledge_point_name: pointTitle(point),
      card_type: "interactive_visual",
      renderability: "bounded_template_match",
      artifact_ref: String(trusted.artifact_id),
      template_match: Object.freeze({ method: "exact_title", confidence: 1 }),
      parameterization: Object.freeze(clone(parameterization)),
      source_refs: Object.freeze(sourceRefs),
      review_status: "needs_review",
      publishable: false,
    }));
  }
  if (!proposals.every(validateEducationCardTemplateProposal)) {
    throw new TypeError("compiled card template proposal is invalid");
  }
  return Object.freeze(proposals);
}

function staticProposal(point, cardType, staticReason, sourceRefs) {
  return Object.freeze({
    schema_version: EDUCATION_CARD_PROPOSAL_VERSION,
    proposal_id: stableId("cardproposal", point.id, cardType),
    knowledge_point_candidate_id: String(point.id),
    knowledge_point_name: pointTitle(point),
    card_type: cardType,
    renderability: "static",
    artifact_ref: null,
    template_match: null,
    parameterization: createStaticKnowledgeCardParameterization({
      cardType,
      staticReason,
    }),
    source_refs: Object.freeze(sourceRefs),
    review_status: "needs_review",
    publishable: false,
  });
}

function trustedArtifactIndex(values) {
  const index = new Map();
  for (const artifact of Array.isArray(values) ? values : []) {
    const title = normalizeExactTitle(artifact?.title);
    if (!title || !artifact?.artifact_id || index.has(title)) continue;
    index.set(title, artifact);
  }
  return index;
}

function normalizedSourceRefs(point) {
  const candidates = [
    ...(Array.isArray(point?.provenance?.source_anchors) ? point.provenance.source_anchors : []),
    ...(point?.source_anchor ? [point.source_anchor] : []),
  ];
  return candidates.slice(0, 12).map((item) => ({
    page_index: Number.isInteger(item?.page_index) ? item.page_index : null,
    block_ids: [...new Set(Array.isArray(item?.block_ids)
      ? item.block_ids.map(String).filter(Boolean).slice(0, 24)
      : [])],
  }));
}

function normalizeExactTitle(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, "").trim();
}

function pointTitle(point) {
  return String(point?.canonical_name || point?.name || "").trim().slice(0, 240);
}

function stableId(...parts) {
  return `${parts[0]}:${createHash("sha256")
    .update(parts.slice(1).map((item) => String(item || "")).join("\u001f"))
    .digest("hex")
    .slice(0, 24)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
