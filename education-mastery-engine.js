import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { EducationDataStoreError } from "./education-data-store.js";
import {
  DEFAULT_MASTERY_POLICY,
  MasteryPolicyError,
  normalizeMasteryPolicy,
} from "./education-mastery-policy.js";

const RECEIPT_SCHEMA_VERSION = "verified-grading-receipt@1.0";

/**
 * Authoritative mastery coordinator.
 *
 * Agent output is accepted only by recordProposal(), which never changes a
 * mastery projection. Real evidence enters through recordVerifiedAssessment()
 * after the injected server verifier validates a grading receipt.
 */
export function createEducationMasteryEngine({
  store,
  verifyGradingReceipt = () => false,
  clock = () => new Date().toISOString(),
} = {}) {
  if (!store) throw new TypeError("store is required");

  function getConfiguration({ tenantId } = {}) {
    const current = ensureConfiguration({ tenantId });
    return {
      schema_version: "education-mastery-settings@1.0",
      policy_key: current.policy_key,
      config_version: current.config_version,
      updated_at: current.updated_at,
      updated_by: current.updated_by,
      policy: current.config,
      evidence: store.masteryEvidenceSummary({ tenantId }),
      authority: {
        real_evidence: "server_verified_grading_receipt_only",
        agent_output: "proposal_only_never_applied",
        idempotency: "tenant_student_attempt_receipt_question_knowledge",
      },
    };
  }

  function updateConfiguration({ tenantId, policy, expectedVersion, updatedBy = "settings" } = {}) {
    const current = ensureConfiguration({ tenantId });
    const normalized = normalizePolicyOrThrow(policy, current.config);
    const updated = store.updateMasteryPolicy({
      tenantId,
      policyKey: current.policy_key,
      policy: normalized,
      expectedVersion,
      updatedBy,
    });
    const recompute = store.recomputeAllMastery({ tenantId });
    return {
      ...getConfiguration({ tenantId }),
      recompute: { projection_count: recompute.recomputed },
    };
  }

  function recordVerifiedAssessment({ tenantId, studentId, receipt } = {}) {
    const configuration = ensureConfiguration({ tenantId });
    if (configuration.config.enabled === false) {
      throw dataError("掌握度真实计算当前已停用", "mastery_calculation_disabled", 409);
    }
    const verification = verifyGradingReceipt(receipt, { tenantId, studentId });
    const verified = normalizeVerification(verification, receipt, { tenantId, studentId, now: clock() });
    const question = store.getQuestion({ tenantId, questionId: verified.question_id });
    if (!question) throw dataError("判题回执关联的题目不存在", "grading_receipt_question_not_found", 404);
    if (question.version !== verified.question_version) {
      throw dataError("判题回执与当前题目版本不一致", "grading_receipt_question_version_mismatch", 409);
    }
    const mappings = normalizeQuestionMappings(question.knowledge_point_mappings);
    const resultByKnowledgePoint = normalizeKnowledgePointResults(
      verified.knowledge_point_results,
      mappings,
      verified.score,
    );
    const occurredAt = verified.graded_at || verified.submitted_at || verified.verified_at;
    const evidenceItems = mappings.map((mapping) => {
      const score = resultByKnowledgePoint.get(mapping.knowledge_point_id) ?? verified.score;
      return {
        evidence_id: `verified:${verified.receipt_id}:${mapping.knowledge_point_id}`,
        ontology_id: mapping.ontology_id,
        ontology_version: mapping.ontology_version,
        knowledge_point_id: mapping.knowledge_point_id,
        evidence_type: "verified_question_attempt",
        outcome: score >= 0.999 ? "answer_correct" : score <= 0.001 ? "answer_incorrect" : "partially_correct",
        score,
        weight: mapping.weight,
        sample_count: 1,
        apply_to_mastery: true,
        source_type: verified.evidence_source,
        source_ref: verified.receipt_id,
        occurred_at: occurredAt,
        metadata: {
          title: "完成一次已验证作答",
          description: "由服务端判题回执产生的真实掌握证据。",
          mastery_factors: {
            evidence_class: "real",
            difficulty: canonicalDifficulty(question),
            hints_used: verified.hints_used,
            duration_ms: verified.duration_ms,
            source_type: verified.evidence_source,
            mapping_role: mapping.mapping_role,
          },
          grading_authority: verified.grading_authority,
          question_id: verified.question_id,
          attempt_id: verified.attempt_id,
        },
      };
    });
    return store.recordVerifiedAssessment({
      tenantId,
      studentId,
      receipt: {
        receipt_id: verified.receipt_id,
        tenant_id: verified.tenant_id,
        student_id: verified.student_id,
        attempt_id: verified.attempt_id,
        question_id: verified.question_id,
        question_version: verified.question_version,
        payload_hash: verified.payload_hash,
        payload: verified.payload,
        verifier_id: verified.verifier_id,
        verified_at: verified.verified_at,
      },
      evidenceItems,
    });
  }

  function recordProposal({ tenantId, studentId, proposal } = {}) {
    const item = proposal && typeof proposal === "object" ? proposal : {};
    const proposalId = safeId(item.proposal_id, "proposal_id");
    return store.recordMasteryEvidence({
      tenantId,
      studentId,
      evidence: {
        evidence_id: `proposal:${proposalId}`,
        ontology_id: safeId(item.ontology_id, "ontology_id"),
        ontology_version: safeId(item.ontology_version, "ontology_version"),
        knowledge_point_id: safeId(item.knowledge_point_id, "knowledge_point_id"),
        evidence_type: cleanProposalKey(item.evidence_type, "agent_mastery_proposal"),
        outcome: cleanText(item.outcome, 120) || "unverified_observation",
        score: null,
        weight: 0,
        apply_to_mastery: false,
        evidence_class: "proposal",
        source_type: cleanProposalKey(item.source_type, "agent_proposal"),
        source_ref: safeId(item.source_ref || proposalId, "source_ref"),
        occurred_at: validIso(item.occurred_at) || clock(),
        metadata: {
          title: cleanProposalText(item.title, 240) || "AI观察建议",
          description: cleanProposalText(item.description, 1_000)
            || "仅供后续判题或教师审核，不改变掌握度。",
          proposal: item.payload && typeof item.payload === "object" ? item.payload : {},
        },
      },
    });
  }

  function ensureConfiguration({ tenantId } = {}) {
    const existing = store.getMasteryPolicy({ tenantId });
    if (existing) return existing;
    return store.ensureMasteryPolicy({
      tenantId,
      policy: normalizeMasteryPolicy(DEFAULT_MASTERY_POLICY),
      updatedBy: "system_default",
    });
  }

  return Object.freeze({
    getConfiguration,
    updateConfiguration,
    recordVerifiedAssessment,
    recordProposal,
  });
}

/**
 * HMAC authority for the grading service. Keep `secret` server-side; browser
 * code receives signed receipts but can neither issue nor alter them.
 */
export function createHmacGradingReceiptAuthority({
  secret,
  issuerId = "education-grading-service",
  clock = () => new Date().toISOString(),
  maxAgeMs = 7 * 86_400_000,
} = {}) {
  const key = Buffer.from(String(secret || ""), "utf8");
  if (key.length < 32) throw new TypeError("grading receipt secret must contain at least 32 bytes");
  const safeIssuerId = safeId(issuerId, "issuer_id");

  function issue(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("receipt payload is required");
    const canonical = {
      ...structuredClone(payload),
      schema_version: RECEIPT_SCHEMA_VERSION,
      issuer_id: safeIssuerId,
      issued_at: validIso(payload.issued_at) || clock(),
    };
    delete canonical.signature;
    return Object.freeze({
      ...canonical,
      signature: `hmac-sha256:${signatureFor(canonical, key)}`,
    });
  }

  function verify(receipt, context = {}) {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
    const signature = String(receipt.signature || "");
    if (!signature.startsWith("hmac-sha256:")) return false;
    const canonical = structuredClone(receipt);
    delete canonical.signature;
    if (canonical.schema_version !== RECEIPT_SCHEMA_VERSION || canonical.issuer_id !== safeIssuerId) return false;
    const issuedMs = Date.parse(canonical.issued_at);
    const nowMs = Date.parse(clock());
    if (!Number.isFinite(issuedMs) || !Number.isFinite(nowMs)
      || issuedMs > nowMs + 60_000 || nowMs - issuedMs > maxAgeMs) return false;
    if (context.tenantId && canonical.tenant_id !== context.tenantId) return false;
    if (context.studentId && canonical.student_id !== context.studentId) return false;
    const actual = Buffer.from(signature.slice("hmac-sha256:".length), "base64url");
    const expected = Buffer.from(signatureFor(canonical, key), "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    return {
      verified: true,
      receipt: canonical,
      verifier_id: safeIssuerId,
      verified_at: clock(),
    };
  }

  return Object.freeze({ issue, verify, issuer_id: safeIssuerId, schema_version: RECEIPT_SCHEMA_VERSION });
}

function normalizeVerification(verification, suppliedReceipt, { tenantId, studentId, now }) {
  if (verification !== true && verification?.verified !== true) {
    throw dataError("掌握证据未通过服务端判题回执校验", "grading_receipt_not_verified", 422);
  }
  const source = verification === true ? suppliedReceipt : verification.receipt || suppliedReceipt;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw dataError("判题回执内容无效", "invalid_grading_receipt", 400);
  }
  const receipt = structuredClone(source);
  delete receipt.signature;
  const score = normalizeScore(receipt);
  const normalized = {
    receipt_id: safeId(receipt.receipt_id, "receipt_id"),
    tenant_id: safeId(receipt.tenant_id, "tenant_id"),
    student_id: safeId(receipt.student_id, "student_id"),
    attempt_id: safeId(receipt.attempt_id, "attempt_id"),
    question_id: safeId(receipt.question_id, "question_id"),
    question_version: safeId(receipt.question_version, "question_version"),
    score,
    hints_used: boundedInteger(receipt.hints_used, 0, 100, "hints_used"),
    duration_ms: boundedInteger(receipt.duration_ms, 0, 7_200_000, "duration_ms"),
    evidence_source: cleanKey(receipt.evidence_source || receipt.grader_type || "server_graded_question"),
    grading_authority: cleanText(receipt.grading_authority || receipt.issuer_id || "server", 200),
    submitted_at: validIso(receipt.submitted_at),
    graded_at: validIso(receipt.graded_at),
    knowledge_point_results: Array.isArray(receipt.knowledge_point_results) ? receipt.knowledge_point_results : [],
    verifier_id: safeId(verification?.verifier_id || receipt.issuer_id || "server-verifier", "verifier_id"),
    verified_at: validIso(verification?.verified_at) || now,
    payload: receipt,
  };
  if (normalized.tenant_id !== tenantId || normalized.student_id !== studentId) {
    throw dataError("判题回执与当前租户或学生不匹配", "grading_receipt_scope_mismatch", 409);
  }
  normalized.payload_hash = createHash("sha256").update(stableStringify(receipt)).digest("hex");
  return normalized;
}

function normalizeQuestionMappings(value) {
  const mappings = Array.isArray(value) ? value : [];
  if (!mappings.length) throw dataError("题目没有已审核的知识点映射", "question_without_knowledge_mapping", 409);
  return mappings.map((mapping) => ({
    ontology_id: safeId(mapping.ontology_id, "ontology_id"),
    ontology_version: safeId(mapping.ontology_version, "ontology_version"),
    knowledge_point_id: safeId(mapping.knowledge_point_id, "knowledge_point_id"),
    mapping_role: cleanKey(mapping.mapping_role || "primary"),
    weight: boundedNumber(mapping.weight ?? 1, 0.01, 1, "mapping.weight"),
  }));
}

function normalizeKnowledgePointResults(value, mappings, fallbackScore) {
  const allowed = new Set(mappings.map((mapping) => mapping.knowledge_point_id));
  const result = new Map();
  for (const item of value || []) {
    const id = safeId(item?.knowledge_point_id, "knowledge_point_results.knowledge_point_id");
    if (!allowed.has(id)) {
      throw dataError("判题回执包含题目未映射的知识点", "grading_receipt_knowledge_mismatch", 409);
    }
    if (result.has(id)) throw dataError("判题回执包含重复知识点", "duplicate_grading_knowledge_result", 400);
    result.set(id, boundedNumber(item.score ?? fallbackScore, 0, 1, "knowledge_point_results.score"));
  }
  return result;
}

function normalizeScore(receipt) {
  if (receipt.score != null) return boundedNumber(receipt.score, 0, 1, "score");
  const outcome = cleanKey(receipt.outcome || (receipt.correct === true ? "correct" : receipt.correct === false ? "incorrect" : ""));
  if (["correct", "answer_correct", "passed"].includes(outcome)) return 1;
  if (["incorrect", "answer_incorrect", "failed"].includes(outcome)) return 0;
  if (["partial", "partially_correct"].includes(outcome)) return 0.5;
  throw dataError("判题回执缺少可验证的 score/outcome", "grading_receipt_score_missing", 400);
}

function canonicalDifficulty(question) {
  return cleanKey(question.difficulty_code || question.difficulty?.code || question.difficulty || "default");
}

function normalizePolicyOrThrow(value, base) {
  try {
    return normalizeMasteryPolicy(value, { base });
  } catch (error) {
    if (error instanceof MasteryPolicyError) throw dataError(error.message, error.code, 400);
    throw error;
  }
}

function signatureFor(value, key) {
  return createHmac("sha256", key).update(stableStringify(value)).digest("base64url");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeId(value, field) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 200 || !/^[\p{L}\p{N}_.:@/+~-]+$/u.test(id)) {
    throw dataError(`${field} 不是合法标识符`, "invalid_identifier", 400);
  }
  return id;
}

function boundedNumber(value, minimum, maximum, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw dataError(`${field} 必须介于 ${minimum} 和 ${maximum} 之间`, "invalid_grading_receipt", 400);
  }
  return parsed;
}

function boundedInteger(value, minimum, maximum, field) {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw dataError(`${field} 必须是 ${minimum} 到 ${maximum} 的整数`, "invalid_grading_receipt", 400);
  }
  return parsed;
}

function validIso(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function cleanText(value, maximum) {
  return String(value ?? "").trim().slice(0, maximum);
}

function cleanProposalText(value, maximum) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function cleanProposalKey(value, fallback) {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 120);
  return key || fallback;
}

function cleanKey(value) {
  return String(value ?? "").trim().toLowerCase().slice(0, 120) || "default";
}

function dataError(message, code, status) {
  return new EducationDataStoreError(message, { code, status });
}
