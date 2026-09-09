import { createHash } from "node:crypto";

import {
  AGENT_EDUCATION_UI_VERSION,
  validateAgentEducationUiResponse
} from "./agent-education-ui-contract.js";
import { normalizeInteractiveVisualArtifact } from "./public/interactive-visual-renderer.js";

export const LEARNING_AGENT_CONTRACT_VERSION = "ai-teacher-learning-loop@2.0";
export const LEARNING_AGENT_HYDRATE_VERSION = "learning-agent-hydrate@2.0";
export const INTERACTIVE_VISUAL_SPEC_VERSION = "interactive-visual@1.0";

export const LEARNING_AGENT_EVENT_TYPES = Object.freeze([
  "knowledge_question",
  "explanation_request",
  "assessment_request",
  "assessment_answer",
  "mistake_review",
  "student_self_report",
  "hint_request",
  "course_navigation",
  "other"
]);

export const LEARNING_AGENT_MAPPING_STATUSES = Object.freeze([
  "mapped",
  "partial_mapping",
  "no_match",
  "conflict"
]);

export const LEARNING_AGENT_VISUAL_VARIANTS = Object.freeze([
  "linear",
  "quadratic",
  "numberline",
  "triangle",
  "circle",
  "coordinate",
  "statistics",
  "probability",
  "algebra",
  "concept"
]);

export const LEARNING_AGENT_RESPONSE_SCHEMA = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:ai-teacher:learning-loop:2.0",
  title: "Agent → 系统学习闭环提案",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "request_id",
    "answer",
    "ui_plan",
    "event",
    "knowledge_proposals",
    "mastery_evidence_proposals",
    "assessment_proposals",
    "visual_proposals"
  ],
  properties: {
    schema_version: { const: LEARNING_AGENT_CONTRACT_VERSION },
    request_id: { type: "string", minLength: 1, maxLength: 160 },
    answer: { type: "string", minLength: 1, maxLength: 6000 },
    ui_plan: {
      description: `完整兼容 ${AGENT_EDUCATION_UI_VERSION}；只引用服务端登记卡片。`,
      type: "object"
    },
    event: { type: "object" },
    knowledge_proposals: { type: "array", maxItems: 8 },
    mastery_evidence_proposals: { type: "array", maxItems: 16 },
    assessment_proposals: { type: "array", maxItems: 4 },
    visual_proposals: { type: "array", maxItems: 4 }
  }
});

const PRIVATE_PLAN = Symbol("learning-agent-private-plan");
const MAX_RAW_RESPONSE_LENGTH = 256 * 1024;
const EVENT_TYPE_SET = new Set(LEARNING_AGENT_EVENT_TYPES);
const VISUAL_VARIANT_SET = new Set(LEARNING_AGENT_VISUAL_VARIANTS);
const KNOWLEDGE_ROLES = new Set(["primary", "supporting", "prerequisite", "related"]);
const EVIDENCE_MODES = new Set(["direct_assessment", "inferred", "self_report"]);
const EVIDENCE_STRENGTHS = new Set(["weak", "medium", "strong"]);
const DIRECT_SIGNALS = new Set([
  "answer_correct",
  "answer_incorrect",
  "partial_credit",
  "solution_step_correct",
  "solution_step_error"
]);
const INFERRED_SIGNALS = new Set([
  "hint_used",
  "repeated_error",
  "transfer_success",
  "teacher_observation"
]);
const SELF_REPORT_SIGNALS = new Set(["self_report_easy", "self_report_difficult"]);
const ALL_SIGNALS = new Set([...DIRECT_SIGNALS, ...INFERRED_SIGNALS, ...SELF_REPORT_SIGNALS]);
const ITEM_TYPES = new Set([
  "single_choice",
  "multiple_choice",
  "numeric",
  "short_answer",
  "worked_response"
]);
const COGNITIVE_LEVELS = new Set(["remember", "understand", "apply", "analyze", "synthesize"]);
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const VISUAL_PURPOSES = new Set(["explanation", "question_stimulus", "solution_explanation"]);
const VISUAL_VISIBILITIES = new Set(["immediate", "after_submit", "teacher_only"]);
const EVIDENCE_SPAN_SOURCES = new Set([
  "user_text",
  "student_answer",
  "assessment_prompt",
  "tool_result"
]);
const FORBIDDEN_VISUAL_KEYS = /^(?:code|script|html|css|url|src|href|renderer(?:_id)?|component(?:_id)?|action(?:_id)?|handler|callback|module|import|eval|function|on[a-z].*)$/iu;
const FORBIDDEN_VISUAL_TEXT = /(?:<\s*\/?\s*(?:script|iframe|object|embed|style)|javascript\s*:|data\s*:|file\s*:|\beval\s*\(|\bnew\s+Function\b|\bfetch\s*\(|XMLHttpRequest|\bdocument\s*\.|\bwindow\s*\.|=>)/iu;

const TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "request_id",
  "answer",
  "ui_plan",
  "event",
  "knowledge_proposals",
  "mastery_evidence_proposals",
  "assessment_proposals",
  "visual_proposals"
]);

export class LearningAgentContractError extends Error {
  constructor(message, { code = "learning_agent_contract_invalid", details = [] } = {}) {
    super(message);
    this.name = "LearningAgentContractError";
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
  }
}

/**
 * Build the complete proposal prompt. Candidate IDs and request_id are
 * server-minted opaque values. The Agent may select them, never invent them.
 */
export function buildLearningAgentContractPrompt({
  requestId,
  knowledgeCandidates = [],
  uiReferenceCatalog = {}
} = {}) {
  const safeRequestId = safeIdentifier(requestId);
  if (!safeRequestId) throw new TypeError("requestId is required");
  const candidateCatalog = normalizePromptKnowledgeCandidates(knowledgeCandidates);
  const uiCatalog = sanitizePromptUiCatalog(uiReferenceCatalog);

  return [
    "你是 AI 教师的学习闭环提案器，不是学生状态或前端的权威数据源。",
    "每轮只输出一个严格 JSON 对象；禁止 Markdown 代码块、注释、前后缀文字和思维链。",
    `schema_version 必须是 "${LEARNING_AGENT_CONTRACT_VERSION}"，request_id 必须原样回显 "${safeRequestId}"。`,
    `ui_plan 必须是完整的 ${AGENT_EDUCATION_UI_VERSION} 对象，且 ui_plan.answer 与顶层 answer 完全相同。`,
    "knowledge_proposals 只能从本轮 KNOWLEDGE_CANDIDATES 选 candidate_id。没有可靠候选时 candidate_id 必须为 null，保留 mention；不得自造知识点 ID。",
    "mastery_evidence_proposals 只是证据建议。严禁输出 mastery_probability、mastery_delta、mastery_state、修改后分数或‘已掌握’结论。",
    "direct_assessment 必须引用服务端已知 evidence_ref；inferred 只能候选入账；self_report 只能形成偏好/自述，不能直接提高掌握度。",
    "assessment_proposals 的 public_item 不得含答案、解析或评分密钥；private_key 必须单独提供，仅供服务端验证和私有存储。",
    `visual_proposals 只能输出 ${INTERACTIVE_VISUAL_SPEC_VERSION} 受控 visual_spec，variant 限于 ${LEARNING_AGENT_VISUAL_VARIANTS.join(", ")}。`,
    "visual_spec 不得包含任何 code/script/html/css/url/src/href/renderer/component/action/事件处理器；它是数据 DSL，不是可执行代码。",
    "如果互动图用于某道动态题，visual_proposals.assessment_proposal_id 必须指向该题；solution_explanation 的 visibility 必须是 after_submit 或 teacher_only。",
    `机器约束：${JSON.stringify(LEARNING_AGENT_RESPONSE_SCHEMA)}`,
    `[KNOWLEDGE_CANDIDATES]${JSON.stringify(candidateCatalog)}[/KNOWLEDGE_CANDIDATES]`,
    `[UI_REFERENCE_CATALOG]${JSON.stringify(uiCatalog)}[/UI_REFERENCE_CATALOG]`
  ].join("\n");
}

export function parseLearningAgentResponse(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LearningAgentContractError("Agent 未返回学习闭环提案", {
      code: "learning_agent_empty"
    });
  }
  if (raw.length > MAX_RAW_RESPONSE_LENGTH) {
    throw new LearningAgentContractError("Agent 学习闭环提案过长", {
      code: "learning_agent_too_large"
    });
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new LearningAgentContractError("Agent 未返回完整 JSON 对象", {
      code: "learning_agent_invalid_json",
      details: [{ path: "$", code: "INVALID_JSON", message: cause.message }]
    });
  }
  const validation = validateLearningAgentResponse(value);
  if (!validation.valid) {
    throw new LearningAgentContractError("Agent 学习闭环提案不符合协议", {
      details: validation.errors
    });
  }
  return clone(value);
}

export function validateLearningAgentResponse(value) {
  const errors = [];
  if (!isRecord(value)) return invalid("$", "TYPE", "必须是 JSON 对象");
  rejectExtraKeys(value, TOP_LEVEL_FIELDS, "$", errors);
  if (value.schema_version !== LEARNING_AGENT_CONTRACT_VERSION) {
    errors.push({ path: "$.schema_version", code: "CONST", message: `必须是 ${LEARNING_AGENT_CONTRACT_VERSION}` });
  }
  boundedString(value.request_id, "$.request_id", 1, 160, errors);
  boundedString(value.answer, "$.answer", 1, 6000, errors);
  validateUiPlan(value.ui_plan, value.answer, errors);
  validateEvent(value.event, errors);
  validateKnowledgeProposals(value.knowledge_proposals, errors);
  validateMasteryEvidenceProposals(value.mastery_evidence_proposals, value.knowledge_proposals, errors);
  validateAssessmentProposals(value.assessment_proposals, value.knowledge_proposals, errors);
  validateDynamicAssessmentAnswerLeak(value.answer, value.assessment_proposals, errors);
  validateVisualProposals(value.visual_proposals, value.knowledge_proposals, value.assessment_proposals, errors);
  return { valid: errors.length === 0, errors };
}

/**
 * Validate server nonce and hydrate opaque per-turn candidates into canonical
 * knowledge IDs. The returned receipt is safe to serialize: private answer
 * keys live in a non-enumerable server plan consumed by the runtime only.
 */
export function hydrateLearningAgentResponse(valueOrRaw, options = {}) {
  const value = typeof valueOrRaw === "string"
    ? parseLearningAgentResponse(valueOrRaw)
    : parseLearningAgentResponse(JSON.stringify(valueOrRaw));
  const authority = normalizeAuthority(options.authority);
  if (value.request_id !== authority.request_id) {
    throw new LearningAgentContractError("Agent 回显的 request_id 与服务端不一致", {
      code: "learning_agent_request_mismatch"
    });
  }

  const registry = normalizeKnowledgeRegistry(options.knowledgeRegistry);
  const candidateCatalog = normalizeCandidateCatalog(options.knowledgeCandidates, registry);
  const mapping = hydrateKnowledgeMapping(value.knowledge_proposals, candidateCatalog, registry);
  const eventDecision = hydrateEvent(value.event, authority);
  const verifiedEvidence = normalizeVerifiedEvidence(options.verifiedEvidence);
  const evidenceDecisions = value.mastery_evidence_proposals.map((proposal) =>
    hydrateEvidenceProposal(proposal, mapping, authority, verifiedEvidence)
  );
  const assessmentHydration = hydrateAssessments(value.assessment_proposals, mapping, authority);
  const visualHydration = hydrateVisuals(
    value.visual_proposals,
    mapping,
    assessmentHydration.publicReceipts,
    authority
  );

  const receipt = {
    contract_version: LEARNING_AGENT_HYDRATE_VERSION,
    source_contract_version: value.schema_version,
    request_id: value.request_id,
    authority: {
      tenant_id: authority.tenant_id,
      user_id: authority.user_id,
      session_id: authority.session_id,
      turn_id: authority.turn_id,
      idempotency_key: authority.idempotency_key,
      expected_state_version: authority.expected_state_version
    },
    answer: value.answer,
    ui_plan: clone(value.ui_plan),
    mapping,
    event_decision: eventDecision,
    evidence_decisions: evidenceDecisions,
    assessment_receipts: assessmentHydration.publicReceipts,
    visual_receipts: visualHydration.publicReceipts,
    diagnostics: buildDiagnostics(mapping, evidenceDecisions, assessmentHydration.publicReceipts, visualHydration.publicReceipts)
  };
  Object.defineProperty(receipt, PRIVATE_PLAN, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: deepFreeze({
      assessments: assessmentHydration.privateRecords,
      visuals: visualHydration.privateRecords
    })
  });
  return deepFreeze(receipt);
}

export function createPublicLearningAgentProjection(hydratedReceipt) {
  assertHydratedReceipt(hydratedReceipt);
  return deepFreeze({
    contract_version: hydratedReceipt.contract_version,
    request_id: hydratedReceipt.request_id,
    answer: hydratedReceipt.answer,
    ui_plan: clone(hydratedReceipt.ui_plan),
    mapping: clone(hydratedReceipt.mapping),
    event_decision: clone(hydratedReceipt.event_decision),
    evidence_decisions: clone(hydratedReceipt.evidence_decisions),
    assessment_receipts: clone(hydratedReceipt.assessment_receipts),
    visual_receipts: clone(hydratedReceipt.visual_receipts),
    diagnostics: clone(hydratedReceipt.diagnostics)
  });
}

/**
 * Small reference runtime for server integration. It persists evidence events,
 * not calculated mastery. A later deterministic mastery model consumes only
 * evidence decisions whose apply_to_mastery flag is true.
 */
export function createLearningAgentRuntime({ now = () => new Date().toISOString() } = {}) {
  const scopes = new Map();

  function apply(valueOrRaw, options = {}) {
    const isHydrated = isRecord(valueOrRaw) &&
      valueOrRaw.contract_version === LEARNING_AGENT_HYDRATE_VERSION &&
      Boolean(valueOrRaw[PRIVATE_PLAN]);
    const hydrated = isHydrated
      ? valueOrRaw
      : hydrateLearningAgentResponse(valueOrRaw, options);
    const authority = hydrated.authority;
    const scopeKey = scopedKey(authority.tenant_id, authority.user_id);
    const state = scopes.get(scopeKey) || createScopeState(authority);
    const fingerprint = stableHash(stableSerialize({
      receipt: hydrated,
      private_plan: hydrated[PRIVATE_PLAN]
    }));
    const replay = state.idempotency.get(authority.idempotency_key);
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        return deepFreeze({
          ok: false,
          code: "IDEMPOTENCY_CONFLICT",
          message: "同一用户的幂等键已绑定其他请求",
          state_version: state.state_version
        });
      }
      return deepFreeze({ ...clone(replay.result), idempotent: true });
    }
    if (authority.expected_state_version !== state.state_version) {
      return deepFreeze({
        ok: false,
        code: "STALE_STATE_VERSION",
        message: "学习状态已变更，请用最新版本重试",
        expected_state_version: authority.expected_state_version,
        state_version: state.state_version
      });
    }

    const privatePlan = hydrated[PRIVATE_PLAN];
    const recordedAt = safeTimestamp(now());
    state.learning_events.push({
      event_id: serverId("event", authority.request_id, hydrated.event_decision.event_proposal_id),
      tenant_id: authority.tenant_id,
      user_id: authority.user_id,
      session_id: authority.session_id,
      turn_id: authority.turn_id,
      event_type: hydrated.event_decision.applied_type,
      mapping_status: hydrated.mapping.status,
      knowledge_point_ids: hydrated.mapping.items
        .filter((item) => item.status === "mapped")
        .map((item) => item.knowledge_point_id),
      recorded_at: recordedAt
    });
    hydrated.evidence_decisions
      .filter((decision) => decision.status !== "rejected")
      .forEach((decision) => state.evidence_events.push({ ...clone(decision), recorded_at: recordedAt }));
    privatePlan.assessments.forEach((record) => state.assessments.set(record.assessment_id, clone(record)));
    privatePlan.visuals.forEach((record) => state.visuals.set(record.visual_id, clone(record)));
    state.state_version += 1;
    scopes.set(scopeKey, state);

    const publicProjection = createPublicLearningAgentProjection(hydrated);
    const result = {
      ok: true,
      idempotent: false,
      state_version: state.state_version,
      public_projection: publicProjection,
      applied: {
        learning_event_count: 1,
        mastery_eligible_evidence_count: hydrated.evidence_decisions.filter(
          (item) => item.apply_to_mastery === true
        ).length,
        preference_event_count: hydrated.evidence_decisions.filter(
          (item) => item.status === "preference_only"
        ).length,
        assessment_draft_count: privatePlan.assessments.length,
        visual_draft_count: privatePlan.visuals.length
      }
    };
    state.idempotency.set(authority.idempotency_key, { fingerprint, result: clone(result) });
    return deepFreeze(result);
  }

  function inspect({ tenantId, tenant_id, userId, user_id } = {}) {
    const tenant = safeIdentifier(tenantId ?? tenant_id);
    const user = safeIdentifier(userId ?? user_id);
    if (!tenant || !user) throw new TypeError("tenantId and userId are required");
    const state = scopes.get(scopedKey(tenant, user));
    if (!state) {
      return deepFreeze({
        state_version: 0,
        learning_events: [],
        evidence_events: [],
        assessments: [],
        visuals: []
      });
    }
    return deepFreeze({
      state_version: state.state_version,
      learning_events: clone(state.learning_events),
      evidence_events: clone(state.evidence_events),
      assessments: [...state.assessments.values()].map(publicAssessmentRecord),
      visuals: [...state.visuals.values()].map(publicVisualRecord)
    });
  }

  function getPrivateAssessment({ tenantId, tenant_id, userId, user_id, assessmentId, assessment_id } = {}) {
    const tenant = safeIdentifier(tenantId ?? tenant_id);
    const user = safeIdentifier(userId ?? user_id);
    const id = safeIdentifier(assessmentId ?? assessment_id);
    if (!tenant || !user || !id) return null;
    const record = scopes.get(scopedKey(tenant, user))?.assessments.get(id);
    return record ? deepFreeze(clone(record)) : null;
  }

  return Object.freeze({ apply, inspect, getPrivateAssessment });
}

function validateUiPlan(plan, answer, errors) {
  if (!isRecord(plan)) {
    errors.push({ path: "$.ui_plan", code: "TYPE", message: "必须是对象" });
    return;
  }
  const validation = validateAgentEducationUiResponse(plan);
  validation.errors.forEach((error) => errors.push({
    ...error,
    path: `$.ui_plan${error.path === "$" ? "" : error.path.slice(1)}`,
    code: `UI_${error.code}`
  }));
  if (plan.schema_version !== AGENT_EDUCATION_UI_VERSION) {
    errors.push({ path: "$.ui_plan.schema_version", code: "UI_VERSION", message: `v2 必须使用 ${AGENT_EDUCATION_UI_VERSION}` });
  }
  if (typeof answer === "string" && plan.answer !== answer) {
    errors.push({ path: "$.ui_plan.answer", code: "ANSWER_MISMATCH", message: "必须与顶层 answer 完全相同" });
  }
}

function validateEvent(event, errors) {
  const path = "$.event";
  if (!isRecord(event)) {
    errors.push({ path, code: "TYPE", message: "必须是对象" });
    return;
  }
  rejectExtraKeys(event, new Set(["event_proposal_id", "type", "confidence", "evidence_spans"]), path, errors);
  proposalId(event.event_proposal_id, `${path}.event_proposal_id`, errors);
  enumValue(event.type, EVENT_TYPE_SET, `${path}.type`, errors);
  probability(event.confidence, `${path}.confidence`, errors);
  validateEvidenceSpans(event.evidence_spans, `${path}.evidence_spans`, errors);
}

function validateKnowledgeProposals(items, errors) {
  const path = "$.knowledge_proposals";
  if (!boundedArray(items, path, 0, 8, errors)) return;
  const ids = new Set();
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path: itemPath, code: "TYPE", message: "必须是对象" });
      return;
    }
    rejectExtraKeys(item, new Set(["proposal_id", "mention", "candidate_id", "role", "confidence", "evidence_spans"]), itemPath, errors);
    proposalId(item.proposal_id, `${itemPath}.proposal_id`, errors, ids);
    boundedString(item.mention, `${itemPath}.mention`, 1, 160, errors);
    if (item.candidate_id !== null) boundedString(item.candidate_id, `${itemPath}.candidate_id`, 1, 160, errors);
    enumValue(item.role, KNOWLEDGE_ROLES, `${itemPath}.role`, errors);
    probability(item.confidence, `${itemPath}.confidence`, errors);
    validateEvidenceSpans(item.evidence_spans, `${itemPath}.evidence_spans`, errors);
  });
}

function validateMasteryEvidenceProposals(items, knowledgeItems, errors) {
  const path = "$.mastery_evidence_proposals";
  if (!boundedArray(items, path, 0, 16, errors)) return;
  const knowledgeIds = new Set((Array.isArray(knowledgeItems) ? knowledgeItems : []).map((item) => item?.proposal_id));
  const ids = new Set();
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path: itemPath, code: "TYPE", message: "必须是对象" });
      return;
    }
    rejectExtraKeys(item, new Set([
      "proposal_id",
      "knowledge_proposal_id",
      "evidence_mode",
      "signal_type",
      "evidence_ref",
      "strength",
      "confidence",
      "basis"
    ]), itemPath, errors);
    proposalId(item.proposal_id, `${itemPath}.proposal_id`, errors, ids);
    if (!knowledgeIds.has(item.knowledge_proposal_id)) {
      errors.push({ path: `${itemPath}.knowledge_proposal_id`, code: "UNKNOWN_PROPOSAL_REF", message: "必须引用 knowledge_proposals" });
    }
    enumValue(item.evidence_mode, EVIDENCE_MODES, `${itemPath}.evidence_mode`, errors);
    enumValue(item.signal_type, ALL_SIGNALS, `${itemPath}.signal_type`, errors);
    const expectedMode = signalMode(item.signal_type);
    if (expectedMode && item.evidence_mode !== expectedMode) {
      errors.push({ path: `${itemPath}.evidence_mode`, code: "SIGNAL_MODE_MISMATCH", message: `${item.signal_type} 必须使用 ${expectedMode}` });
    }
    if (item.evidence_ref !== null) boundedString(item.evidence_ref, `${itemPath}.evidence_ref`, 1, 160, errors);
    if (item.evidence_mode === "direct_assessment" && !safeIdentifier(item.evidence_ref)) {
      errors.push({ path: `${itemPath}.evidence_ref`, code: "DIRECT_EVIDENCE_REQUIRED", message: "直接测评必须引用服务端证据" });
    }
    enumValue(item.strength, EVIDENCE_STRENGTHS, `${itemPath}.strength`, errors);
    probability(item.confidence, `${itemPath}.confidence`, errors);
    boundedString(item.basis, `${itemPath}.basis`, 1, 240, errors);
  });
}

function validateAssessmentProposals(items, knowledgeItems, errors) {
  const path = "$.assessment_proposals";
  if (!boundedArray(items, path, 0, 4, errors)) return;
  const knowledgeIds = new Set((Array.isArray(knowledgeItems) ? knowledgeItems : []).map((item) => item?.proposal_id));
  const ids = new Set();
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path: itemPath, code: "TYPE", message: "必须是对象" });
      return;
    }
    rejectExtraKeys(item, new Set(["proposal_id", "knowledge_proposal_ids", "blueprint", "public_item", "private_key"]), itemPath, errors);
    proposalId(item.proposal_id, `${itemPath}.proposal_id`, errors, ids);
    validateProposalRefs(item.knowledge_proposal_ids, knowledgeIds, `${itemPath}.knowledge_proposal_ids`, 1, 4, errors);
    validateBlueprint(item.blueprint, `${itemPath}.blueprint`, errors);
    validatePublicItem(item.public_item, item.blueprint?.item_type, `${itemPath}.public_item`, errors);
    validatePrivateKey(item.private_key, item.blueprint?.item_type, item.public_item, `${itemPath}.private_key`, errors);
  });
}

function validateDynamicAssessmentAnswerLeak(answer, proposals, errors) {
  if (typeof answer !== "string" || !Array.isArray(proposals)) return;
  const normalizedAnswer = normalizeComparableText(answer);
  for (const proposal of proposals) {
    const privateKey = proposal?.private_key;
    const publicItem = proposal?.public_item;
    if (!isRecord(privateKey)) continue;
    const claims = [];
    (privateKey.correct_option_ids || []).forEach((optionId) => {
      const option = (publicItem?.options || []).find((item) => item?.id === optionId);
      claims.push(optionId, option?.label);
    });
    (privateKey.accepted_answers || []).forEach((value) => claims.push(value));
    const leaked = claims
      .map(normalizeComparableText)
      .filter((claim) => claim.length > 0)
      .some((claim) => [
        `正确答案是${claim}`,
        `正确答案为${claim}`,
        `答案是${claim}`,
        `答案为${claim}`,
        `应选${claim}`,
        `正确选项是${claim}`
      ].some((phrase) => normalizedAnswer.includes(phrase)));
    if (leaked) {
      errors.push({
        path: "$.answer",
        code: "DYNAMIC_ASSESSMENT_ANSWER_LEAK",
        message: `正文不得泄漏动态题 ${proposal.proposal_id || ""} 的私有答案`
      });
      return;
    }
  }
}

function validateBlueprint(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ path, code: "TYPE", message: "必须是对象" });
    return;
  }
  rejectExtraKeys(value, new Set(["item_type", "cognitive_level", "difficulty", "generation_method", "estimated_minutes"]), path, errors);
  enumValue(value.item_type, ITEM_TYPES, `${path}.item_type`, errors);
  enumValue(value.cognitive_level, COGNITIVE_LEVELS, `${path}.cognitive_level`, errors);
  enumValue(value.difficulty, DIFFICULTIES, `${path}.difficulty`, errors);
  boundedString(value.generation_method, `${path}.generation_method`, 1, 80, errors);
  boundedNumber(value.estimated_minutes, `${path}.estimated_minutes`, 0.5, 120, errors);
}

function validatePublicItem(value, itemType, path, errors) {
  if (!isRecord(value)) {
    errors.push({ path, code: "TYPE", message: "必须是对象" });
    return;
  }
  rejectExtraKeys(value, new Set(["title", "prompt", "instruction", "options"]), path, errors);
  boundedString(value.title, `${path}.title`, 1, 120, errors);
  boundedString(value.prompt, `${path}.prompt`, 1, 3000, errors);
  if (value.instruction !== undefined) boundedString(value.instruction, `${path}.instruction`, 0, 300, errors);
  const choice = itemType === "single_choice" || itemType === "multiple_choice";
  if (!choice) {
    if (value.options !== undefined && (!Array.isArray(value.options) || value.options.length)) {
      errors.push({ path: `${path}.options`, code: "OPTIONS_FORBIDDEN", message: "非选择题不得携带选项" });
    }
    return;
  }
  if (!boundedArray(value.options, `${path}.options`, 2, 8, errors)) return;
  const ids = new Set();
  value.options.forEach((option, index) => {
    const optionPath = `${path}.options[${index}]`;
    if (!isRecord(option)) {
      errors.push({ path: optionPath, code: "TYPE", message: "必须是对象" });
      return;
    }
    rejectExtraKeys(option, new Set(["id", "label"]), optionPath, errors);
    boundedString(option.id, `${optionPath}.id`, 1, 24, errors);
    boundedString(option.label, `${optionPath}.label`, 1, 500, errors);
    if (ids.has(option.id)) errors.push({ path: `${optionPath}.id`, code: "DUPLICATE_ID", message: "选项 ID 不得重复" });
    ids.add(option.id);
  });
}

function validatePrivateKey(value, itemType, publicItem, path, errors) {
  if (!isRecord(value)) {
    errors.push({ path, code: "TYPE", message: "必须是对象" });
    return;
  }
  rejectExtraKeys(value, new Set([
    "correct_option_ids",
    "accepted_answers",
    "explanation",
    "solution_paths",
    "common_errors",
    "scoring_points"
  ]), path, errors);
  boundedString(value.explanation, `${path}.explanation`, 1, 4000, errors);
  validateStringArray(value.common_errors, `${path}.common_errors`, 0, 8, 300, errors);
  validateSolutionPaths(value.solution_paths, `${path}.solution_paths`, errors);
  validateScoringPoints(value.scoring_points, `${path}.scoring_points`, errors);
  const choice = itemType === "single_choice" || itemType === "multiple_choice";
  if (choice) {
    const min = itemType === "single_choice" ? 1 : 1;
    const max = itemType === "single_choice" ? 1 : 8;
    if (!validateStringArray(value.correct_option_ids, `${path}.correct_option_ids`, min, max, 24, errors)) return;
    const publicIds = new Set((publicItem?.options || []).map((item) => item?.id));
    value.correct_option_ids.forEach((id, index) => {
      if (!publicIds.has(id)) errors.push({ path: `${path}.correct_option_ids[${index}]`, code: "UNKNOWN_OPTION", message: "正确选项必须存在于公开题面" });
    });
  } else {
    validateStringArray(value.accepted_answers, `${path}.accepted_answers`, 1, 12, 500, errors);
  }
}

function validateSolutionPaths(items, path, errors) {
  if (!boundedArray(items, path, 1, 4, errors)) return;
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path: itemPath, code: "TYPE", message: "必须是对象" });
      return;
    }
    rejectExtraKeys(item, new Set(["title", "steps", "when_to_use"]), itemPath, errors);
    boundedString(item.title, `${itemPath}.title`, 1, 120, errors);
    validateStringArray(item.steps, `${itemPath}.steps`, 1, 16, 500, errors);
    if (item.when_to_use !== undefined) boundedString(item.when_to_use, `${itemPath}.when_to_use`, 0, 300, errors);
  });
}

function validateScoringPoints(items, path, errors) {
  if (!boundedArray(items, path, 0, 12, errors)) return;
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path: itemPath, code: "TYPE", message: "必须是对象" });
      return;
    }
    rejectExtraKeys(item, new Set(["criterion", "points"]), itemPath, errors);
    boundedString(item.criterion, `${itemPath}.criterion`, 1, 300, errors);
    boundedNumber(item.points, `${itemPath}.points`, 0, 100, errors);
  });
}

function validateVisualProposals(items, knowledgeItems, assessmentItems, errors) {
  const path = "$.visual_proposals";
  if (!boundedArray(items, path, 0, 4, errors)) return;
  const knowledgeIds = new Set((Array.isArray(knowledgeItems) ? knowledgeItems : []).map((item) => item?.proposal_id));
  const assessmentIds = new Set((Array.isArray(assessmentItems) ? assessmentItems : []).map((item) => item?.proposal_id));
  const ids = new Set();
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path: itemPath, code: "TYPE", message: "必须是对象" });
      return;
    }
    rejectExtraKeys(item, new Set([
      "proposal_id",
      "knowledge_proposal_ids",
      "assessment_proposal_id",
      "purpose",
      "visibility",
      "visual_spec"
    ]), itemPath, errors);
    proposalId(item.proposal_id, `${itemPath}.proposal_id`, errors, ids);
    validateProposalRefs(item.knowledge_proposal_ids, knowledgeIds, `${itemPath}.knowledge_proposal_ids`, 0, 4, errors);
    if (item.assessment_proposal_id !== null && !assessmentIds.has(item.assessment_proposal_id)) {
      errors.push({ path: `${itemPath}.assessment_proposal_id`, code: "UNKNOWN_PROPOSAL_REF", message: "必须引用 assessment_proposals" });
    }
    enumValue(item.purpose, VISUAL_PURPOSES, `${itemPath}.purpose`, errors);
    enumValue(item.visibility, VISUAL_VISIBILITIES, `${itemPath}.visibility`, errors);
    if (item.purpose === "question_stimulus" && !item.assessment_proposal_id) {
      errors.push({ path: `${itemPath}.assessment_proposal_id`, code: "ASSESSMENT_BINDING_REQUIRED", message: "题目配图必须绑定题目提案" });
    }
    if (item.purpose === "solution_explanation" && item.visibility === "immediate") {
      errors.push({ path: `${itemPath}.visibility`, code: "SOLUTION_VISIBILITY", message: "解题图不得在作答前直接展示" });
    }
    validateVisualSpec(item.visual_spec, `${itemPath}.visual_spec`, errors);
  });
}

function validateVisualSpec(spec, path, errors) {
  if (!isRecord(spec)) {
    errors.push({ path, code: "TYPE", message: "必须是对象" });
    return;
  }
  rejectExtraKeys(spec, new Set([
    "schema_version",
    "id",
    "variant",
    "title",
    "description",
    "aria_label",
    "accent",
    "model",
    "parameters",
    "data",
    "points",
    "values",
    "labels",
    "items",
    "center",
    "min",
    "max",
    "value",
    "favorable",
    "total"
  ]), path, errors);
  if (spec.schema_version !== INTERACTIVE_VISUAL_SPEC_VERSION) {
    errors.push({ path: `${path}.schema_version`, code: "CONST", message: `必须是 ${INTERACTIVE_VISUAL_SPEC_VERSION}` });
  }
  enumValue(spec.variant, VISUAL_VARIANT_SET, `${path}.variant`, errors);
  boundedString(spec.title, `${path}.title`, 1, 120, errors);
  if (spec.description !== undefined) boundedString(spec.description, `${path}.description`, 0, 360, errors);
  inspectVisualNode(spec, path, errors, 0, { count: 0 });
}

function inspectVisualNode(value, path, errors, depth, budget) {
  budget.count += 1;
  if (budget.count > 500) {
    errors.push({ path, code: "VISUAL_TOO_LARGE", message: "visual_spec 节点过多" });
    return;
  }
  if (depth > 8) {
    errors.push({ path, code: "VISUAL_TOO_DEEP", message: "visual_spec 嵌套过深" });
    return;
  }
  if (typeof value === "string") {
    if (value.length > 1000) errors.push({ path, code: "STRING_TOO_LONG", message: "visual_spec 文本过长" });
    if (FORBIDDEN_VISUAL_TEXT.test(value)) errors.push({ path, code: "EXECUTABLE_CONTENT", message: "visual_spec 不得包含可执行内容或 URL" });
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    errors.push({ path, code: "FINITE_NUMBER", message: "visual_spec 数值必须有限" });
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 64) errors.push({ path, code: "MAX_ITEMS", message: "visual_spec 数组过长" });
    value.slice(0, 65).forEach((item, index) => inspectVisualNode(item, `${path}[${index}]`, errors, depth + 1, budget));
    return;
  }
  Object.entries(value).forEach(([key, child]) => {
    if (FORBIDDEN_VISUAL_KEYS.test(key)) errors.push({ path: `${path}.${key}`, code: "EXECUTABLE_FIELD", message: `禁止 visual_spec 字段 ${key}` });
    inspectVisualNode(child, `${path}.${key}`, errors, depth + 1, budget);
  });
}

function validateEvidenceSpans(items, path, errors) {
  if (!boundedArray(items, path, 0, 6, errors)) return;
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push({ path: itemPath, code: "TYPE", message: "必须是对象" });
      return;
    }
    rejectExtraKeys(item, new Set(["source", "quote"]), itemPath, errors);
    enumValue(item.source, EVIDENCE_SPAN_SOURCES, `${itemPath}.source`, errors);
    boundedString(item.quote, `${itemPath}.quote`, 1, 300, errors);
  });
}

function hydrateKnowledgeMapping(proposals, catalog, registry) {
  const items = proposals.map((proposal) => {
    if (proposal.candidate_id === null) {
      return {
        proposal_id: proposal.proposal_id,
        mention: proposal.mention,
        role: proposal.role,
        status: "unmapped",
        candidate_id: null,
        knowledge_point_id: null,
        canonical_name: null,
        code: "AGENT_DECLARED_UNMAPPED"
      };
    }
    const candidates = catalog.byCandidateId.get(proposal.candidate_id) || [];
    if (candidates.length === 0) {
      return {
        proposal_id: proposal.proposal_id,
        mention: proposal.mention,
        role: proposal.role,
        status: "unmapped",
        candidate_id: proposal.candidate_id,
        knowledge_point_id: null,
        canonical_name: null,
        code: "CANDIDATE_NOT_IN_TURN"
      };
    }
    if (candidates.length > 1) {
      return {
        proposal_id: proposal.proposal_id,
        mention: proposal.mention,
        role: proposal.role,
        status: "conflict",
        candidate_id: proposal.candidate_id,
        knowledge_point_id: null,
        canonical_name: null,
        code: "AMBIGUOUS_SERVER_CANDIDATE"
      };
    }
    const candidate = candidates[0];
    const knowledge = registry.get(candidate.knowledge_point_id);
    if (!knowledge) {
      return {
        proposal_id: proposal.proposal_id,
        mention: proposal.mention,
        role: proposal.role,
        status: "conflict",
        candidate_id: proposal.candidate_id,
        knowledge_point_id: null,
        canonical_name: null,
        code: "CANDIDATE_TARGET_MISSING"
      };
    }
    return {
      proposal_id: proposal.proposal_id,
      mention: proposal.mention,
      role: proposal.role,
      status: "mapped",
      candidate_id: proposal.candidate_id,
      knowledge_point_id: knowledge.id,
      canonical_name: knowledge.name,
      server_candidate_score: candidate.score,
      code: "SERVER_CANDIDATE_CONFIRMED"
    };
  });
  const mapped = items.filter((item) => item.status === "mapped").length;
  const conflicts = items.filter((item) => item.status === "conflict").length;
  let status = "no_match";
  if (conflicts) status = "conflict";
  else if (mapped === items.length && mapped > 0) status = "mapped";
  else if (mapped > 0) status = "partial_mapping";
  return deepFreeze({ status, mapped_count: mapped, proposed_count: items.length, items });
}

function hydrateEvent(event, authority) {
  const appliedType = EVENT_TYPE_SET.has(authority.event_type) ? authority.event_type : event.type;
  return deepFreeze({
    event_proposal_id: event.event_proposal_id,
    proposed_type: event.type,
    applied_type: appliedType,
    status: appliedType === event.type ? "accepted_as_classification" : "overridden_by_server",
    confidence: event.confidence
  });
}

function hydrateEvidenceProposal(proposal, mapping, authority, verifiedEvidence) {
  const mappingItem = mapping.items.find((item) => item.proposal_id === proposal.knowledge_proposal_id);
  const base = {
    proposal_id: proposal.proposal_id,
    knowledge_proposal_id: proposal.knowledge_proposal_id,
    knowledge_point_id: mappingItem?.status === "mapped" ? mappingItem.knowledge_point_id : null,
    evidence_mode: proposal.evidence_mode,
    signal_type: proposal.signal_type,
    evidence_ref: proposal.evidence_ref,
    proposed_strength: proposal.strength,
    confidence: proposal.confidence,
    basis: proposal.basis,
    apply_to_mastery: false
  };
  if (!base.knowledge_point_id) {
    return deepFreeze({ ...base, status: "rejected", code: "KNOWLEDGE_NOT_MAPPED" });
  }
  if (proposal.evidence_mode === "self_report") {
    return deepFreeze({ ...base, status: "preference_only", code: "SELF_REPORT_IS_NOT_MASTERY" });
  }
  const verified = verifiedEvidence.get(proposal.evidence_ref);
  if (proposal.evidence_mode === "inferred") {
    if (!verified || !evidenceBelongsToAuthority(verified, authority, base.knowledge_point_id)) {
      return deepFreeze({ ...base, status: "pending_review", code: "INFERRED_EVIDENCE_NOT_SERVER_VERIFIED" });
    }
    return deepFreeze({ ...base, status: "accepted_inferred", code: "SERVER_VERIFIED_INFERRED_SIGNAL" });
  }
  if (!verified) {
    return deepFreeze({ ...base, status: "rejected", code: "DIRECT_EVIDENCE_NOT_FOUND" });
  }
  if (!evidenceBelongsToAuthority(verified, authority, base.knowledge_point_id)) {
    return deepFreeze({ ...base, status: "rejected", code: "DIRECT_EVIDENCE_SCOPE_MISMATCH" });
  }
  if (!directSignalMatches(proposal.signal_type, verified)) {
    return deepFreeze({ ...base, status: "rejected", code: "DIRECT_EVIDENCE_OUTCOME_CONFLICT" });
  }
  return deepFreeze({
    ...base,
    status: "accepted_direct",
    code: "SERVER_VERIFIED_DIRECT_ASSESSMENT",
    apply_to_mastery: true
  });
}

function hydrateAssessments(proposals, mapping, authority) {
  const publicReceipts = [];
  const privateRecords = [];
  proposals.forEach((proposal) => {
    const mappedIds = proposal.knowledge_proposal_ids
      .map((id) => mapping.items.find((item) => item.proposal_id === id))
      .filter((item) => item?.status === "mapped")
      .map((item) => item.knowledge_point_id);
    if (!mappedIds.length) {
      publicReceipts.push({
        proposal_id: proposal.proposal_id,
        status: "rejected",
        code: "ASSESSMENT_KNOWLEDGE_NOT_MAPPED",
        assessment_id: null,
        public_item: null,
        verification_status: "not_started"
      });
      return;
    }
    const assessmentId = serverId("assessment", authority.request_id, proposal.proposal_id);
    publicReceipts.push({
      proposal_id: proposal.proposal_id,
      status: "drafted",
      code: "PRIVATE_KEY_SEPARATED",
      assessment_id: assessmentId,
      knowledge_point_ids: mappedIds,
      blueprint: clone(proposal.blueprint),
      public_item: clone(proposal.public_item),
      verification_status: "pending_server_verification",
      publishable: false
    });
    privateRecords.push({
      assessment_id: assessmentId,
      tenant_id: authority.tenant_id,
      user_id: authority.user_id,
      proposal_id: proposal.proposal_id,
      knowledge_point_ids: mappedIds,
      blueprint: clone(proposal.blueprint),
      public_item: clone(proposal.public_item),
      private_key: clone(proposal.private_key),
      verification_status: "pending_server_verification",
      publishable: false
    });
  });
  return { publicReceipts: deepFreeze(publicReceipts), privateRecords: deepFreeze(privateRecords) };
}

function hydrateVisuals(proposals, mapping, assessmentReceipts, authority) {
  const publicReceipts = [];
  const privateRecords = [];
  proposals.forEach((proposal) => {
    const assessment = proposal.assessment_proposal_id
      ? assessmentReceipts.find((item) => item.proposal_id === proposal.assessment_proposal_id)
      : null;
    const mappedIds = proposal.knowledge_proposal_ids
      .map((id) => mapping.items.find((item) => item.proposal_id === id))
      .filter((item) => item?.status === "mapped")
      .map((item) => item.knowledge_point_id);
    if ((proposal.assessment_proposal_id && assessment?.status !== "drafted") || (!assessment && !mappedIds.length)) {
      publicReceipts.push({
        proposal_id: proposal.proposal_id,
        status: "rejected",
        code: "VISUAL_BINDING_NOT_HYDRATED",
        visual_id: null
      });
      return;
    }
    const visualId = serverId("visual", authority.request_id, proposal.proposal_id);
    const normalized = normalizeInteractiveVisualArtifact({
      ...clone(proposal.visual_spec),
      id: visualId
    });
    const record = {
      visual_id: visualId,
      tenant_id: authority.tenant_id,
      user_id: authority.user_id,
      proposal_id: proposal.proposal_id,
      assessment_id: assessment?.assessment_id || null,
      knowledge_point_ids: mappedIds.length ? mappedIds : assessment?.knowledge_point_ids || [],
      purpose: proposal.purpose,
      visibility: proposal.visibility,
      visual_spec: normalized
    };
    privateRecords.push(record);
    publicReceipts.push({
      proposal_id: proposal.proposal_id,
      status: "hydrated",
      code: "CONTROLLED_VISUAL_DSL",
      visual_id: visualId,
      assessment_id: record.assessment_id,
      knowledge_point_ids: record.knowledge_point_ids,
      purpose: record.purpose,
      visibility: record.visibility,
      visual_spec: record.visibility === "immediate" ? normalized : null
    });
  });
  return { publicReceipts: deepFreeze(publicReceipts), privateRecords: deepFreeze(privateRecords) };
}

function buildDiagnostics(mapping, evidence, assessments, visuals) {
  const codes = [];
  if (mapping.status !== "mapped") codes.push(`KNOWLEDGE_${mapping.status.toUpperCase()}`);
  evidence.filter((item) => item.status !== "accepted_direct").forEach((item) => codes.push(item.code));
  assessments.filter((item) => item.status === "rejected").forEach((item) => codes.push(item.code));
  visuals.filter((item) => item.status === "rejected").forEach((item) => codes.push(item.code));
  return deepFreeze({
    has_partial_result: codes.length > 0,
    codes: [...new Set(codes)]
  });
}

function normalizeAuthority(input) {
  if (!isRecord(input)) throw new TypeError("authority is required");
  const rawStateVersion = input.expected_state_version ?? input.state_version ?? input.stateVersion;
  if (!Number.isInteger(Number(rawStateVersion)) || Number(rawStateVersion) < 0) {
    throw new TypeError("authority.expected_state_version is required");
  }
  const authority = {
    tenant_id: safeIdentifier(input.tenant_id ?? input.tenantId),
    user_id: safeIdentifier(input.user_id ?? input.userId),
    session_id: safeIdentifier(input.session_id ?? input.sessionId),
    turn_id: safeIdentifier(input.turn_id ?? input.turnId),
    request_id: safeIdentifier(input.request_id ?? input.requestId),
    idempotency_key: safeIdentifier(input.idempotency_key ?? input.idempotencyKey),
    expected_state_version: Number(rawStateVersion),
    event_type: String(input.event_type ?? input.eventType ?? "")
  };
  for (const field of ["tenant_id", "user_id", "session_id", "turn_id", "request_id", "idempotency_key"]) {
    if (!authority[field]) throw new TypeError(`authority.${field} is required`);
  }
  return authority;
}

function normalizeKnowledgeRegistry(input) {
  const records = Array.isArray(input)
    ? input
    : isRecord(input)
      ? Object.entries(input).map(([id, value]) => ({ id, ...(isRecord(value) ? value : {}) }))
      : [];
  const registry = new Map();
  records.forEach((record) => {
    const id = safeIdentifier(record.id ?? record.knowledge_point_id ?? record.knowledgePointId);
    const name = safeText(record.name ?? record.label ?? record.title, 240);
    if (id && name) registry.set(id, { id, name });
  });
  return registry;
}

function normalizeCandidateCatalog(input, registry) {
  const byCandidateId = new Map();
  (Array.isArray(input) ? input : []).slice(0, 64).forEach((record) => {
    const candidateId = safeIdentifier(record?.candidate_id ?? record?.candidateId ?? record?.id);
    const knowledgePointId = safeIdentifier(record?.knowledge_point_id ?? record?.knowledgePointId ?? record?.ontology_id);
    if (!candidateId || !knowledgePointId) return;
    const item = {
      candidate_id: candidateId,
      knowledge_point_id: knowledgePointId,
      label: safeText(record?.label ?? record?.name ?? registry.get(knowledgePointId)?.name, 240),
      score: finiteNumber(record?.score, null)
    };
    const list = byCandidateId.get(candidateId) || [];
    list.push(item);
    byCandidateId.set(candidateId, list);
  });
  return { byCandidateId };
}

function normalizeVerifiedEvidence(input) {
  const records = input instanceof Map
    ? [...input.values()]
    : Array.isArray(input)
      ? input
      : isRecord(input)
        ? Object.entries(input).map(([id, value]) => ({ evidence_ref: id, ...(isRecord(value) ? value : {}) }))
        : [];
  const map = new Map();
  records.forEach((record) => {
    const ref = safeIdentifier(record.evidence_ref ?? record.evidenceRef ?? record.attempt_id ?? record.id);
    if (!ref) return;
    map.set(ref, {
      evidence_ref: ref,
      tenant_id: safeIdentifier(record.tenant_id ?? record.tenantId),
      user_id: safeIdentifier(record.user_id ?? record.userId),
      knowledge_point_ids: (Array.isArray(record.knowledge_point_ids) ? record.knowledge_point_ids : [])
        .map(safeIdentifier)
        .filter(Boolean),
      outcome: String(record.outcome ?? ""),
      kind: String(record.kind ?? "assessment_attempt")
    });
  });
  return map;
}

function evidenceBelongsToAuthority(evidence, authority, knowledgePointId) {
  return evidence.tenant_id === authority.tenant_id &&
    evidence.user_id === authority.user_id &&
    evidence.knowledge_point_ids.includes(knowledgePointId);
}

function directSignalMatches(signal, evidence) {
  if (signal === "answer_correct") return evidence.outcome === "correct";
  if (signal === "answer_incorrect") return evidence.outcome === "incorrect";
  if (signal === "partial_credit") return evidence.outcome === "partial";
  if (signal === "solution_step_correct") return evidence.kind === "scored_step" && evidence.outcome === "correct";
  if (signal === "solution_step_error") return evidence.kind === "scored_step" && evidence.outcome === "incorrect";
  return false;
}

function normalizePromptKnowledgeCandidates(items) {
  return (Array.isArray(items) ? items : []).slice(0, 20).map((item) => ({
    candidate_id: safeIdentifier(item?.candidate_id ?? item?.candidateId ?? item?.id),
    label: safeText(item?.label ?? item?.name, 240),
    context: safeText(item?.context ?? item?.summary, 500),
    score: finiteNumber(item?.score, null)
  })).filter((item) => item.candidate_id && item.label);
}

function sanitizePromptUiCatalog(input) {
  const output = {};
  for (const key of ["assessments", "knowledge_points", "knowledge_graphs", "images", "mindmaps"]) {
    output[key] = (Array.isArray(input?.[key]) ? input[key] : []).slice(0, 20).map((item) => ({
      ref: safeIdentifier(typeof item === "string" ? item : item?.ref ?? item?.id),
      label: safeText(typeof item === "string" ? item : item?.label ?? item?.name, 240)
    })).filter((item) => item.ref);
  }
  return output;
}

function validateProposalRefs(items, allowed, path, min, max, errors) {
  if (!boundedArray(items, path, min, max, errors)) return;
  const seen = new Set();
  items.forEach((id, index) => {
    boundedString(id, `${path}[${index}]`, 1, 64, errors);
    if (!allowed.has(id)) errors.push({ path: `${path}[${index}]`, code: "UNKNOWN_PROPOSAL_REF", message: "未找到被引用的提案" });
    if (seen.has(id)) errors.push({ path: `${path}[${index}]`, code: "DUPLICATE_REF", message: "引用不得重复" });
    seen.add(id);
  });
}

function signalMode(signal) {
  if (DIRECT_SIGNALS.has(signal)) return "direct_assessment";
  if (INFERRED_SIGNALS.has(signal)) return "inferred";
  if (SELF_REPORT_SIGNALS.has(signal)) return "self_report";
  return "";
}

function createScopeState(authority) {
  return {
    tenant_id: authority.tenant_id,
    user_id: authority.user_id,
    state_version: 0,
    learning_events: [],
    evidence_events: [],
    assessments: new Map(),
    visuals: new Map(),
    idempotency: new Map()
  };
}

function publicAssessmentRecord(record) {
  return deepFreeze({
    assessment_id: record.assessment_id,
    proposal_id: record.proposal_id,
    knowledge_point_ids: clone(record.knowledge_point_ids),
    blueprint: clone(record.blueprint),
    public_item: clone(record.public_item),
    verification_status: record.verification_status,
    publishable: record.publishable
  });
}

function publicVisualRecord(record) {
  return deepFreeze({
    visual_id: record.visual_id,
    proposal_id: record.proposal_id,
    assessment_id: record.assessment_id,
    knowledge_point_ids: clone(record.knowledge_point_ids),
    purpose: record.purpose,
    visibility: record.visibility,
    visual_spec: record.visibility === "immediate" ? clone(record.visual_spec) : null
  });
}

function assertHydratedReceipt(receipt) {
  if (!isRecord(receipt) || receipt.contract_version !== LEARNING_AGENT_HYDRATE_VERSION) {
    throw new TypeError("hydrated learning-agent receipt is required");
  }
}

function proposalId(value, path, errors, seen) {
  const valid = typeof value === "string" && /^[a-z][a-z0-9_.:-]{0,63}$/iu.test(value);
  if (!valid) errors.push({ path, code: "PROPOSAL_ID", message: "必须是以字母开头的受控提案 ID" });
  if (seen && seen.has(value)) errors.push({ path, code: "DUPLICATE_ID", message: "提案 ID 不得重复" });
  if (seen) seen.add(value);
}

function boundedArray(value, path, min, max, errors) {
  if (!Array.isArray(value)) {
    errors.push({ path, code: "TYPE", message: "必须是数组" });
    return false;
  }
  if (value.length < min) errors.push({ path, code: "MIN_ITEMS", message: `至少 ${min} 项` });
  if (value.length > max) errors.push({ path, code: "MAX_ITEMS", message: `最多 ${max} 项` });
  return true;
}

function validateStringArray(value, path, min, max, maxLength, errors) {
  if (!boundedArray(value, path, min, max, errors)) return false;
  const seen = new Set();
  value.forEach((item, index) => {
    boundedString(item, `${path}[${index}]`, 1, maxLength, errors);
    if (seen.has(item)) errors.push({ path: `${path}[${index}]`, code: "DUPLICATE_VALUE", message: "值不得重复" });
    seen.add(item);
  });
  return true;
}

function boundedString(value, path, min, max, errors) {
  if (typeof value !== "string" || value.length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    errors.push({ path, code: "STRING_BOUNDS", message: `必须是 ${min}–${max} 字符的文本` });
  }
}

function boundedNumber(value, path, min, max, errors) {
  if (!Number.isFinite(value) || value < min || value > max) {
    errors.push({ path, code: "NUMBER_BOUNDS", message: `必须是 ${min}–${max} 的有限数` });
  }
}

function probability(value, path, errors) {
  boundedNumber(value, path, 0, 1, errors);
}

function enumValue(value, allowed, path, errors) {
  if (!allowed.has(value)) errors.push({ path, code: "ENUM", message: `不允许的值 ${String(value)}` });
}

function rejectExtraKeys(value, allowed, path, errors) {
  if (!isRecord(value)) return;
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) errors.push({ path: `${path}.${key}`, code: "ADDITIONAL_PROPERTY", message: `不允许字段 ${key}` });
  });
}

function invalid(path, code, message) {
  return { valid: false, errors: [{ path, code, message }] };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function safeIdentifier(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/u.test(text)) return "";
  return text;
}

function safeText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function safeTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function stableHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function normalizeComparableText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, "")
    .replace(/[，。！？、；：,.!?;:()（）\[\]【】]/gu, "");
}

function serverId(prefix, requestId, proposalId) {
  return `${prefix}.${stableHash(`${requestId}:${proposalId}`).slice(0, 20)}`;
}

function scopedKey(tenantId, userId) {
  return `${tenantId}\u0000${userId}`;
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}
