export const CONTRACT_VERSION = "1.0";
export const A2UI_VERSION = "v0.9";
export const EDUCATION_CATALOG_ID = "urn:a2ui:catalog:education:1.0";
export const TEACHING_PACKAGE_VERSION = "1.0";
export const VOICE_PROJECTION_VERSION = "1.0";
export const UI_PROJECTION_VERSION = "1.0";

const USER_TURN_SOURCES = new Set(["voice", "text", "ui"]);
const ATTACHMENT_TYPES = new Set(["audio", "image", "text", "pdf"]);
const UI_OPERATIONS = new Set(["replace_surface", "update_surface", "delete_surface"]);
export const GROUNDING_MODES = Object.freeze([
  "retrieved",
  "state_authoritative",
  "model_prior",
  "clarify",
  "tool_error"
]);
export const RESPONSE_DIRECTIVE_BY_GROUNDING_MODE = Object.freeze({
  retrieved: "answer_from_brief",
  state_authoritative: "acknowledge_result",
  model_prior: "answer_from_model_prior",
  clarify: "ask_clarification",
  tool_error: "apologize_and_offer_retry"
});

const GROUNDING_MODE_SET = new Set(GROUNDING_MODES);
const SURFACE_POLICIES = new Set(["replace", "preserve"]);
const DELIVERY_MODES = new Set(["verbatim", "semantic"]);
const VOICE_PROJECTION_FIELDS = new Set([
  "projection_version",
  "session_id",
  "turn_id",
  "turn_sequence",
  "package_id",
  "state_version",
  "grounding_mode",
  "response_directive",
  "user_text",
  "answer_brief",
  "authoritative_result",
  "clarification",
  "public_error",
  "response_policy",
  "cards_present",
  "visible_card_types"
]);
const UI_PROJECTION_FIELDS = new Set([
  "projection_version",
  "session_id",
  "turn_id",
  "turn_sequence",
  "package_id",
  "state_version",
  "surface",
  "cards",
  "card_claim_bindings",
  "expected_actions",
  "evidence"
]);
const TEACHING_PACKAGE_FIELDS = new Set([
  "package_version",
  "package_id",
  "session_id",
  "turn_id",
  "turn_sequence",
  "idempotency_key",
  "artifact_version",
  "grounding",
  "answer_brief",
  "authoritative_result",
  "clarification",
  "public_error",
  "cards",
  "card_claim_bindings",
  "evidence",
  "expected_actions",
  "public_state_patch",
  "state_version",
  "presentation"
]);

export function createId(prefix = "id") {
  const safePrefix = String(prefix || "id")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 32) || "id";
  const random =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "") ||
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${safePrefix}_${random}`;
}

export function normalizeUserTurn(input = {}) {
  if (!isPlainObject(input)) throw new TypeError("UserTurn must be an object");

  const rawEvents = Array.isArray(input.ui_events)
    ? input.ui_events
    : Array.isArray(input.uiEvents)
      ? input.uiEvents
      : [];
  const uiEvents = rawEvents.map(normalizeUIAction).filter(Boolean);
  const requestedSource = String(input.source || "").toLowerCase();
  const source = USER_TURN_SOURCES.has(requestedSource)
    ? requestedSource
    : uiEvents.length
      ? "ui"
      : "text";

  const sessionId = normalizeIdentifier(input.session_id ?? input.sessionId) || "session_default";
  const turnId = normalizeIdentifier(input.turn_id ?? input.turnId) || createId("turn");
  const idempotencyKey =
    normalizeIdentifier(input.idempotency_key ?? input.idempotencyKey) || turnId;

  return {
    contract_version: CONTRACT_VERSION,
    session_id: sessionId,
    turn_id: turnId,
    idempotency_key: idempotencyKey,
    source,
    text: safeText(input.text, 12000),
    ui_events: uiEvents,
    attachments: normalizeAttachments(input.attachments),
    state_version: nonNegativeInteger(input.state_version ?? input.stateVersion, 0)
  };
}

/**
 * Normalizes the internal MVP UserTurn contract.
 *
 * `authority` is optional, but Gateway callers should pass their server-created
 * identifiers there. Values in `authority` take precedence over untrusted
 * browser/model input.
 */
export function normalizeMvpUserTurn(input = {}, authority = {}) {
  if (!isPlainObject(input)) throw new TypeError("UserTurn must be an object");
  if (!isPlainObject(authority)) throw new TypeError("UserTurn authority must be an object");

  const authoritativeValue = (snakeKey, camelKey) =>
    authority[snakeKey] ??
    authority[camelKey] ??
    input[snakeKey] ??
    input[camelKey];

  const suppliedEvents =
    authority.ui_events ?? authority.uiEvents ?? input.ui_events ?? input.uiEvents;
  const rawEvents = Array.isArray(suppliedEvents)
    ? suppliedEvents
    : Array.isArray(input.uiEvents)
      ? input.uiEvents
      : [];
  const uiEvents = rawEvents
    .slice(0, 20)
    .map(normalizeMvpUIAction)
    .filter(Boolean);

  const requestedSource = safeText(authoritativeValue("source", "source"), 20).toLowerCase();
  const source = USER_TURN_SOURCES.has(requestedSource)
    ? requestedSource
    : uiEvents.length
      ? "ui"
      : "text";
  const sessionId =
    normalizeIdentifier(authoritativeValue("session_id", "sessionId")) || "session_default";
  const turnId =
    normalizeIdentifier(authoritativeValue("turn_id", "turnId")) || createId("turn");
  const idempotencyKey =
    normalizeIdentifier(authoritativeValue("idempotency_key", "idempotencyKey")) || turnId;

  return {
    contract_version: CONTRACT_VERSION,
    session_id: sessionId,
    turn_id: turnId,
    turn_sequence: nonNegativeInteger(
      authoritativeValue("turn_sequence", "turnSequence"),
      0
    ),
    idempotency_key: idempotencyKey,
    source,
    raw_text: safeText(
      authoritativeValue("raw_text", "rawText") ?? input.text,
      12000
    ),
    semantic_hint: normalizeSemanticHint(
      authority.semantic_hint ??
        authority.semanticHint ??
        input.semantic_hint ??
        input.semanticHint
    ),
    ui_events: uiEvents,
    attachments: normalizeAttachments(authority.attachments ?? input.attachments),
    state_version: nonNegativeInteger(
      authoritativeValue("state_version", "stateVersion"),
      0
    )
  };
}

export function normalizeUIAction(input = {}) {
  if (!isPlainObject(input)) return null;

  const nestedAction = isPlainObject(input.action) ? input.action : {};
  const context = isPlainObject(nestedAction.context)
    ? nestedAction.context
    : isPlainObject(input.context)
      ? input.context
      : {};
  const payload = isPlainObject(input.payload)
    ? input.payload
    : isPlainObject(context)
      ? context
      : {};

  const type = safeActionType(
    input.type ??
      input.action_type ??
      nestedAction.type ??
      nestedAction.name ??
      input.name
  );
  if (!type) return null;

  const value =
    input.value ??
    nestedAction.value ??
    payload.value ??
    context.value ??
    payload.answer ??
    context.answer ??
    payload.selected ??
    context.selected ??
    payload.selection ??
    context.selection ??
    payload.option ??
    context.option ??
    payload.choice ??
    context.choice ??
    null;

  return {
    contract_version: CONTRACT_VERSION,
    event_id:
      normalizeIdentifier(input.event_id ?? input.eventId ?? input.id) || createId("ui"),
    type,
    surface_id: normalizeIdentifier(
      input.surface_id ??
        input.surfaceId ??
        nestedAction.surface_id ??
        nestedAction.surfaceId ??
        payload.surface_id ??
        payload.surfaceId
    ),
    card_id: normalizeIdentifier(
      input.card_id ??
        input.cardId ??
        context.card_id ??
        context.cardId ??
        payload.card_id ??
        payload.cardId
    ),
    component_id: normalizeIdentifier(
      input.component_id ??
        input.componentId ??
        nestedAction.sourceComponentId ??
        nestedAction.source_component_id
    ),
    question_id: normalizeIdentifier(
      input.question_id ??
        input.questionId ??
        context.question_id ??
        context.questionId ??
        payload.question_id ??
        payload.questionId
    ),
    value: normalizeScalar(value),
    observed_state_version: nonNegativeIntegerOrNull(
      input.observed_state_version ??
        input.observedStateVersion ??
        context.observed_state_version ??
        context.observedStateVersion ??
        payload.observed_state_version ??
        payload.observedStateVersion
    ),
    payload: sanitizeJson(payload),
    occurred_at: safeTimestamp(
      input.occurred_at ?? input.timestamp ?? nestedAction.timestamp
    )
  };
}

function normalizeMvpUIAction(input = {}) {
  const normalized = normalizeUIAction(input);
  if (!normalized) return null;
  return {
    contract_version: CONTRACT_VERSION,
    event_id: normalized.event_id,
    type: normalized.type,
    surface_id: normalized.surface_id,
    card_id: normalized.card_id,
    component_id: normalized.component_id,
    question_id: normalized.question_id,
    value: normalized.value,
    observed_state_version: normalized.observed_state_version,
    payload: normalized.payload,
    occurred_at: normalized.occurred_at
  };
}

function normalizeSemanticHint(input) {
  if (!isPlainObject(input)) return null;
  const intent = safeActionType(input.intent);
  const topicId = normalizeIdentifier(input.topic_id ?? input.topicId);
  const rawAction = isPlainObject(input.action) ? input.action : null;
  const actionType = rawAction
    ? safeActionType(rawAction.type ?? rawAction.action_type ?? rawAction.name)
    : "";
  const action = actionType
    ? {
        type: actionType,
        value: normalizeScalar(
          rawAction.value ??
            rawAction.answer ??
            rawAction.selected ??
            rawAction.selection ??
            null
        )
      }
    : null;
  const confidenceValue =
    input.confidence === null || input.confidence === undefined
      ? Number.NaN
      : Number(input.confidence);
  const confidence = Number.isFinite(confidenceValue)
    ? Math.min(1, Math.max(0, confidenceValue))
    : null;

  if (!intent && !topicId && !action && confidence === null) return null;
  return {
    intent,
    topic_id: topicId,
    action,
    confidence
  };
}

export function validateTeachingPackage(input) {
  if (!isPlainObject(input) || !hasOnlyFields(input, TEACHING_PACKAGE_FIELDS)) return false;
  if (input.package_version !== TEACHING_PACKAGE_VERSION) return false;
  if (
    !isIdentifier(input.package_id) ||
    !isIdentifier(input.session_id) ||
    !isIdentifier(input.turn_id) ||
    !isIdentifier(input.idempotency_key)
  ) {
    return false;
  }
  if (!isNonNegativeInteger(input.turn_sequence) || !isNonNegativeInteger(input.state_version)) {
    return false;
  }
  if (input.artifact_version !== null && !isIdentifier(input.artifact_version)) return false;
  if (!validateGrounding(input.grounding)) return false;
  if (!isNullableValid(input.answer_brief, validateAnswerBrief)) return false;
  if (!isNullableValid(input.authoritative_result, validateAuthoritativeResult)) return false;
  if (!isNullableValid(input.clarification, validateClarification)) return false;
  if (
    input.public_error !== undefined &&
    !isNullableValid(input.public_error, validatePublicError)
  ) {
    return false;
  }
  if (!Array.isArray(input.cards) || !input.cards.every(validateMvpCard)) return false;
  if (
    !Array.isArray(input.card_claim_bindings) ||
    !input.card_claim_bindings.every(validateCardClaimBinding)
  ) {
    return false;
  }
  if (!Array.isArray(input.evidence) || !input.evidence.every(validateEvidence)) return false;
  if (
    !Array.isArray(input.expected_actions) ||
    !input.expected_actions.every(validateExpectedAction)
  ) {
    return false;
  }
  if (
    !isPlainObject(input.public_state_patch) ||
    !isSafeJsonValue(input.public_state_patch) ||
    containsForbiddenPrivateField(input.public_state_patch)
  ) {
    return false;
  }
  if (!validatePresentation(input.presentation)) return false;
  if (input.cards.length > input.presentation.max_cards) return false;
  if (input.presentation.surface_policy === "preserve" && input.cards.length > 0) return false;
  if (new Set(input.cards.map((card) => card.id)).size !== input.cards.length) return false;
  if (
    new Set(input.evidence.map((item) => item.evidence_id)).size !== input.evidence.length
  ) {
    return false;
  }
  if (!validateBindingReferences(input.cards, input.card_claim_bindings)) return false;
  return validatePackageModeSemantics(input);
}

export function validateVoiceProjection(input) {
  if (!isPlainObject(input) || !hasOnlyFields(input, VOICE_PROJECTION_FIELDS)) return false;
  if (containsVoiceForbiddenField(input)) return false;
  if (input.projection_version !== VOICE_PROJECTION_VERSION) return false;
  if (
    !isIdentifier(input.session_id) ||
    !isIdentifier(input.turn_id) ||
    !isIdentifier(input.package_id)
  ) {
    return false;
  }
  if (!isNonNegativeInteger(input.turn_sequence) || !isNonNegativeInteger(input.state_version)) {
    return false;
  }
  if (!GROUNDING_MODE_SET.has(input.grounding_mode)) return false;
  if (
    input.response_directive !==
    RESPONSE_DIRECTIVE_BY_GROUNDING_MODE[input.grounding_mode]
  ) {
    return false;
  }
  if (
    typeof input.user_text !== "string" ||
    input.user_text.length > 12000 ||
    safeText(input.user_text, 12000) !== input.user_text
  ) {
    return false;
  }
  if (!isNullableValid(input.answer_brief, validateAnswerBrief)) return false;
  if (!isNullableValid(input.authoritative_result, validateAuthoritativeResult)) return false;
  if (!isNullableValid(input.clarification, validateClarification)) return false;
  if (!isNullableValid(input.public_error, validatePublicError)) return false;
  if (!validateResponsePolicy(input.response_policy, input.grounding_mode)) return false;
  if (typeof input.cards_present !== "boolean") return false;
  if (
    !Array.isArray(input.visible_card_types) ||
    !input.visible_card_types.every(
      (type) => typeof type === "string" && type.length > 0 && type.length <= 160
    )
  ) {
    return false;
  }
  if (new Set(input.visible_card_types).size !== input.visible_card_types.length) return false;
  if (input.cards_present !== (input.visible_card_types.length > 0)) return false;
  return validateVoiceModeSemantics(input);
}

export function validateUIProjection(input) {
  if (!isPlainObject(input) || !hasOnlyFields(input, UI_PROJECTION_FIELDS)) return false;
  if (input.projection_version !== UI_PROJECTION_VERSION) return false;
  if (
    !isIdentifier(input.session_id) ||
    !isIdentifier(input.turn_id) ||
    !isIdentifier(input.package_id)
  ) {
    return false;
  }
  if (!isNonNegativeInteger(input.turn_sequence) || !isNonNegativeInteger(input.state_version)) {
    return false;
  }
  if (
    !isPlainObject(input.surface) ||
    !hasOnlyFields(input.surface, new Set(["surface_id", "operation"])) ||
    !isIdentifier(input.surface.surface_id) ||
    !SURFACE_POLICIES.has(input.surface.operation)
  ) {
    return false;
  }
  if (!Array.isArray(input.cards) || !input.cards.every(validateMvpCard)) return false;
  if (
    !Array.isArray(input.card_claim_bindings) ||
    !input.card_claim_bindings.every(validateCardClaimBinding)
  ) {
    return false;
  }
  if (
    !Array.isArray(input.expected_actions) ||
    !input.expected_actions.every(validateExpectedAction)
  ) {
    return false;
  }
  if (!Array.isArray(input.evidence) || !input.evidence.every(validateEvidence)) return false;
  if (input.cards.length > 3) return false;
  if (input.surface.operation === "preserve" && input.cards.length > 0) return false;
  if (new Set(input.cards.map((card) => card.id)).size !== input.cards.length) return false;
  if (
    new Set(input.evidence.map((item) => item.evidence_id)).size !== input.evidence.length
  ) {
    return false;
  }
  return validateBindingReferences(input.cards, input.card_claim_bindings);
}

export function deriveVoiceProjection(teachingPackage, userTurn = {}) {
  if (!validateTeachingPackage(teachingPackage)) {
    throw new TypeError("Cannot derive VoiceProjection from an invalid TeachingPackage");
  }

  const turn = normalizeMvpUserTurn(userTurn, {
    session_id: teachingPackage.session_id,
    turn_id: teachingPackage.turn_id,
    turn_sequence: teachingPackage.turn_sequence,
    idempotency_key: teachingPackage.idempotency_key,
    state_version: teachingPackage.state_version
  });
  const groundingMode = teachingPackage.grounding.mode;
  const visibleCardTypes = [
    ...new Set(teachingPackage.cards.map((card) => safeText(card.type, 160)).filter(Boolean))
  ];
  const projection = {
    projection_version: VOICE_PROJECTION_VERSION,
    session_id: teachingPackage.session_id,
    turn_id: teachingPackage.turn_id,
    turn_sequence: teachingPackage.turn_sequence,
    package_id: teachingPackage.package_id,
    state_version: teachingPackage.state_version,
    grounding_mode: groundingMode,
    response_directive: RESPONSE_DIRECTIVE_BY_GROUNDING_MODE[groundingMode],
    user_text: turn.raw_text,
    answer_brief: cloneContractValue(teachingPackage.answer_brief),
    authoritative_result: cloneContractValue(teachingPackage.authoritative_result),
    clarification: cloneContractValue(teachingPackage.clarification),
    public_error: cloneContractValue(teachingPackage.public_error ?? null),
    response_policy: responsePolicyForMode(groundingMode),
    cards_present: visibleCardTypes.length > 0,
    visible_card_types: visibleCardTypes
  };

  if (!validateVoiceProjection(projection)) {
    throw new TypeError("Derived VoiceProjection violates the MVP contract");
  }
  return projection;
}

export function deriveUIProjection(teachingPackage) {
  if (!validateTeachingPackage(teachingPackage)) {
    throw new TypeError("Cannot derive UIProjection from an invalid TeachingPackage");
  }

  const projection = {
    projection_version: UI_PROJECTION_VERSION,
    session_id: teachingPackage.session_id,
    turn_id: teachingPackage.turn_id,
    turn_sequence: teachingPackage.turn_sequence,
    package_id: teachingPackage.package_id,
    state_version: teachingPackage.state_version,
    surface: {
      surface_id: "lesson_surface_main",
      operation: teachingPackage.presentation.surface_policy
    },
    cards: cloneContractValue(teachingPackage.cards),
    card_claim_bindings: cloneContractValue(teachingPackage.card_claim_bindings),
    expected_actions: cloneContractValue(teachingPackage.expected_actions),
    evidence: cloneContractValue(teachingPackage.evidence)
  };

  if (!validateUIProjection(projection)) {
    throw new TypeError("Derived UIProjection violates the MVP contract");
  }
  return projection;
}

export function cloneContractValue(value) {
  if (value === undefined) return null;
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function deepFreezeContract(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeContract(child);
  return Object.freeze(value);
}

function validateGrounding(value) {
  if (
    !isPlainObject(value) ||
    !hasOnlyFields(value, new Set(["mode", "retrieval_id"])) ||
    !GROUNDING_MODE_SET.has(value.mode)
  ) {
    return false;
  }
  return value.retrieval_id === null || isIdentifier(value.retrieval_id);
}

function validateAnswerBrief(value) {
  const allowedFields = new Set([
    "direct_answer",
    "must_include",
    "exact_values",
    "supporting_facts",
    "must_not_claim",
    "target_duration_seconds",
    "next_move"
  ]);
  if (!isPlainObject(value) || !hasOnlyFields(value, allowedFields)) return false;
  if (!isNonEmptyText(value.direct_answer, 12000)) return false;
  if (
    !Array.isArray(value.must_include) ||
    value.must_include.length === 0 ||
    !value.must_include.every((claim) => {
      if (
        !isPlainObject(claim) ||
        !hasOnlyFields(claim, new Set(["claim_id", "text", "delivery"]))
      ) {
        return false;
      }
      return (
        isIdentifier(claim.claim_id) &&
        isNonEmptyText(claim.text, 12000) &&
        DELIVERY_MODES.has(claim.delivery)
      );
    })
  ) {
    return false;
  }
  if (
    !Array.isArray(value.exact_values) ||
    !value.exact_values.every((exactValue) => {
      if (
        !isPlainObject(exactValue) ||
        !hasOnlyFields(exactValue, new Set(["name", "value", "spoken_text"]))
      ) {
        return false;
      }
      return (
        isIdentifier(exactValue.name) &&
        isContractScalar(exactValue.value) &&
        isNonEmptyText(exactValue.spoken_text, 1000)
      );
    })
  ) {
    return false;
  }
  if (
    value.supporting_facts !== undefined &&
    (!Array.isArray(value.supporting_facts) ||
      !value.supporting_facts.every((item) => isNonEmptyText(item, 12000)))
  ) {
    return false;
  }
  if (
    !Array.isArray(value.must_not_claim) ||
    !value.must_not_claim.every((item) => isNonEmptyText(item, 12000))
  ) {
    return false;
  }
  if (
    !Number.isInteger(value.target_duration_seconds) ||
    value.target_duration_seconds < 1 ||
    value.target_duration_seconds > 300
  ) {
    return false;
  }
  if (value.next_move !== undefined && !isNonEmptyText(value.next_move, 2000)) return false;
  return true;
}

function validateAuthoritativeResult(value) {
  if (!isPlainObject(value) || !isNonEmptyText(value.status, 120)) return false;
  if (!isSafeJsonValue(value) || containsForbiddenPrivateField(value)) return false;
  if (["graded", "already_answered"].includes(value.status)) {
    if (
      !isIdentifier(value.question_id) ||
      !isNonEmptyText(value.selected_option, 120) ||
      typeof value.is_correct !== "boolean"
    ) {
      return false;
    }
  }
  const exposesCorrectAnswer =
    Object.prototype.hasOwnProperty.call(value, "correct_option") ||
    Object.prototype.hasOwnProperty.call(value, "correct_answer") ||
    Object.prototype.hasOwnProperty.call(value, "answer");
  if (
    exposesCorrectAnswer &&
    !["graded", "already_answered"].includes(value.status)
  ) {
    return false;
  }
  return true;
}

function validateClarification(value) {
  return Boolean(
    isPlainObject(value) &&
      hasOnlyFields(value, new Set(["reason", "prompt"])) &&
      isIdentifier(value.reason) &&
      isNonEmptyText(value.prompt, 2000)
  );
}

function validatePublicError(value) {
  return Boolean(
    isPlainObject(value) &&
      hasOnlyFields(value, new Set(["code", "retryable", "user_message"])) &&
      isIdentifier(value.code) &&
      typeof value.retryable === "boolean" &&
      isNonEmptyText(value.user_message, 2000)
  );
}

function validateCardClaimBinding(value) {
  return Boolean(
    isPlainObject(value) &&
      hasOnlyFields(value, new Set(["card_id", "supports_claim_ids"])) &&
      isIdentifier(value.card_id) &&
      Array.isArray(value.supports_claim_ids) &&
      value.supports_claim_ids.length > 0 &&
      value.supports_claim_ids.every(isIdentifier) &&
      new Set(value.supports_claim_ids).size === value.supports_claim_ids.length
  );
}

function validateEvidence(value) {
  if (
    !isPlainObject(value) ||
    !hasOnlyFields(value, new Set(["evidence_id", "title", "locator"])) ||
    !isIdentifier(value.evidence_id)
  ) {
    return false;
  }
  if (!isNonEmptyText(value.title, 1000)) return false;
  if (value.locator !== undefined && !isNonEmptyText(value.locator, 4000)) return false;
  return isSafeJsonValue(value) && !containsForbiddenPrivateField(value);
}

function validateExpectedAction(value) {
  return Boolean(
    isPlainObject(value) &&
      isNonEmptyText(value.type, 120) &&
      safeActionType(value.type) === value.type &&
      isSafeJsonValue(value) &&
      !containsForbiddenPrivateField(value)
  );
}

function validatePresentation(value) {
  return Boolean(
    isPlainObject(value) &&
      hasOnlyFields(value, new Set(["surface_policy", "max_cards"])) &&
      SURFACE_POLICIES.has(value.surface_policy) &&
      Number.isInteger(value.max_cards) &&
      value.max_cards >= 0 &&
      value.max_cards <= 3
  );
}

function validateBindingReferences(cards, bindings) {
  const cardIds = new Set(cards.map((card) => card.id));
  const boundCardIds = new Set();
  for (const binding of bindings) {
    if (!cardIds.has(binding.card_id) || boundCardIds.has(binding.card_id)) return false;
    boundCardIds.add(binding.card_id);
  }
  return true;
}

function validatePackageModeSemantics(value) {
  const mode = value.grounding.mode;
  const publicError = value.public_error ?? null;
  const emptyStatePatch = Object.keys(value.public_state_patch).length === 0;
  const noUiPayload =
    value.cards.length === 0 &&
    value.card_claim_bindings.length === 0 &&
    value.evidence.length === 0;

  if (mode === "retrieved") {
    const mustIncludeIds = new Set(
      value.answer_brief?.must_include?.map((claim) => claim.claim_id) ?? []
    );
    const cardBindingsSupported = value.card_claim_bindings.every((binding) =>
      binding.supports_claim_ids.some((claimId) => mustIncludeIds.has(claimId))
    );
    return Boolean(
      isIdentifier(value.artifact_version) &&
        isIdentifier(value.grounding.retrieval_id) &&
        value.answer_brief &&
        value.authoritative_result === null &&
        value.clarification === null &&
        publicError === null &&
        value.evidence.length > 0 &&
        cardBindingsSupported
    );
  }
  if (mode === "state_authoritative") {
    return Boolean(
      value.grounding.retrieval_id === null &&
        value.answer_brief === null &&
        value.authoritative_result &&
        value.clarification === null &&
        publicError === null
    );
  }
  if (mode === "model_prior") {
    return Boolean(
      value.artifact_version === null &&
        isIdentifier(value.grounding.retrieval_id) &&
        value.answer_brief === null &&
        value.authoritative_result === null &&
        value.clarification === null &&
        publicError === null &&
        noUiPayload &&
        value.expected_actions.length === 0 &&
        emptyStatePatch &&
        value.presentation.surface_policy === "preserve" &&
        value.presentation.max_cards === 0
    );
  }
  if (mode === "clarify") {
    return Boolean(
      value.artifact_version === null &&
        value.grounding.retrieval_id === null &&
        value.answer_brief === null &&
        value.authoritative_result === null &&
        value.clarification &&
        publicError === null &&
        noUiPayload &&
        value.expected_actions.length === 0 &&
        emptyStatePatch &&
        value.presentation.surface_policy === "preserve" &&
        value.presentation.max_cards === 0
    );
  }
  return Boolean(
    value.artifact_version === null &&
      isIdentifier(value.grounding.retrieval_id) &&
      value.answer_brief === null &&
      value.authoritative_result === null &&
      value.clarification === null &&
      publicError &&
      noUiPayload &&
      (!publicError.retryable ||
        value.expected_actions.some((action) => action.type === "turn.retry")) &&
      emptyStatePatch &&
      value.presentation.surface_policy === "preserve" &&
      value.presentation.max_cards === 0
  );
}

function validateResponsePolicy(value, mode) {
  if (
    !isPlainObject(value) ||
    !hasOnlyFields(
      value,
      new Set([
        "may_use_model_prior",
        "may_call_teacher_turn_again",
        "must_not_claim_retrieval"
      ])
    )
  ) {
    return false;
  }
  const expected = responsePolicyForMode(mode);
  return (
    value.may_use_model_prior === expected.may_use_model_prior &&
    value.may_call_teacher_turn_again === false &&
    value.must_not_claim_retrieval === expected.must_not_claim_retrieval
  );
}

function responsePolicyForMode(mode) {
  return {
    may_use_model_prior: mode === "model_prior",
    may_call_teacher_turn_again: false,
    must_not_claim_retrieval: mode !== "retrieved"
  };
}

function validateVoiceModeSemantics(value) {
  const mode = value.grounding_mode;
  if (mode === "retrieved") {
    return Boolean(
      value.user_text &&
        value.answer_brief &&
        value.authoritative_result === null &&
        value.clarification === null &&
        value.public_error === null
    );
  }
  if (mode === "state_authoritative") {
    return Boolean(
      value.answer_brief === null &&
        value.authoritative_result &&
        value.clarification === null &&
        value.public_error === null
    );
  }
  if (mode === "model_prior") {
    return Boolean(
      value.user_text &&
        value.answer_brief === null &&
        value.authoritative_result === null &&
        value.clarification === null &&
        value.public_error === null &&
        !value.cards_present
    );
  }
  if (mode === "clarify") {
    return Boolean(
      value.user_text &&
        value.answer_brief === null &&
        value.authoritative_result === null &&
        value.clarification &&
        value.public_error === null
    );
  }
  return Boolean(
    value.answer_brief === null &&
      value.authoritative_result === null &&
      value.clarification === null &&
      value.public_error &&
      !value.cards_present
  );
}

export function validateTeacherResponse(input) {
  if (!isPlainObject(input)) return false;
  if (input.contract_version !== CONTRACT_VERSION) return false;
  if (!normalizeIdentifier(input.session_id)) return false;
  if (!normalizeIdentifier(input.turn_id)) return false;
  if (!normalizeIdentifier(input.idempotency_key)) return false;
  if (!Number.isInteger(input.state_version) || input.state_version < 0) return false;

  if (
    !isPlainObject(input.speech) ||
    typeof input.speech.text !== "string" ||
    typeof input.speech.interruptible !== "boolean"
  ) {
    return false;
  }

  if (!Array.isArray(input.ui_operations) || !input.ui_operations.every(validateUIOperation)) {
    return false;
  }
  if (
    !Array.isArray(input.expected_actions) ||
    !input.expected_actions.every(
      (action) => isPlainObject(action) && typeof action.type === "string" && action.type.length > 0
    )
  ) {
    return false;
  }
  if (!isPlainObject(input.state_patch)) return false;
  if (!Array.isArray(input.citations) || !input.citations.every(validateCitation)) return false;
  return true;
}

function validateUIOperation(operation) {
  if (!isPlainObject(operation) || !UI_OPERATIONS.has(operation.op)) return false;
  if (!normalizeIdentifier(operation.surface_id)) return false;
  if (operation.op === "delete_surface") return true;
  if (!Array.isArray(operation.messages) || operation.messages.length === 0) return false;
  if (!operation.messages.every(validateA2UIMessage)) return false;
  if (!Array.isArray(operation.cards) || !operation.cards.every(validateCard)) return false;
  return true;
}

function validateA2UIMessage(message) {
  if (!isPlainObject(message) || message.version !== A2UI_VERSION) return false;
  return Boolean(
    isPlainObject(message.createSurface) ||
      isPlainObject(message.updateComponents) ||
      isPlainObject(message.updateDataModel) ||
      isPlainObject(message.deleteSurface)
  );
}

function validateMvpCard(card) {
  if (
    !isPlainObject(card) ||
    !isIdentifier(card.id) ||
    typeof card.type !== "string" ||
    card.type.length === 0 ||
    card.type.length > 160 ||
    safeActionType(card.type) !== card.type ||
    card.version !== CONTRACT_VERSION ||
    !isPlainObject(card.meta) ||
    !isPlainObject(card.props) ||
    !isPlainObject(card.state) ||
    !Array.isArray(card.actions)
  ) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(card.meta, "supports_claim_ids") ||
    containsForbiddenPrivateField(card)
  ) {
    return false;
  }
  if (
    card.type === "quiz.single-choice" &&
    card.state.status === "awaiting_answer" &&
    Boolean(
      card.state.correct_answer ||
        card.state.correct_option ||
        card.props.correct_answer ||
        card.props.correct_option
    )
  ) {
    return false;
  }
  return isSafeJsonValue(card);
}

function validateCard(card) {
  return Boolean(
    isPlainObject(card) &&
      normalizeIdentifier(card.id) &&
      typeof card.type === "string" &&
      card.type.length > 0 &&
      card.version === CONTRACT_VERSION &&
      isPlainObject(card.meta) &&
      isPlainObject(card.props) &&
      isPlainObject(card.state) &&
      Array.isArray(card.actions)
  );
}

function validateCitation(citation) {
  return Boolean(
    isPlainObject(citation) &&
      (typeof citation.citation_id === "string" || typeof citation.id === "string") &&
      typeof citation.title === "string"
  );
}

function normalizeAttachments(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 20)
    .map((attachment) => {
      if (!isPlainObject(attachment)) return null;
      const requestedType = String(
        attachment.type ?? attachment.source_type ?? attachment.sourceType ?? ""
      ).toLowerCase();
      if (!ATTACHMENT_TYPES.has(requestedType)) return null;
      return {
        attachment_id:
          normalizeIdentifier(
            attachment.attachment_id ?? attachment.attachmentId ?? attachment.id
          ) || createId("attachment"),
        type: requestedType,
        name: safeText(attachment.name ?? attachment.title, 240),
        mime_type: safeText(attachment.mime_type ?? attachment.mimeType, 120),
        uri: safeText(attachment.uri ?? attachment.url, 4000),
        content: safeText(attachment.content ?? attachment.text, 200000),
        metadata: isPlainObject(attachment.metadata)
          ? sanitizeJson(attachment.metadata)
          : {}
      };
    })
    .filter(Boolean);
}

function normalizeIdentifier(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 160);
}

function safeActionType(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 120);
}

function normalizeScalar(value) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return safeText(value, 1000);
}

function safeText(value, limit) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit);
}

function safeTimestamp(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function nonNegativeIntegerOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function sanitizeJson(value, depth = 0) {
  if (depth > 6) return null;
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return safeText(value, 12000);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeJson(item, depth + 1));
  }
  if (!isPlainObject(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([key, item]) => [safeText(key, 120), item])
      .filter(([key]) => isSafeJsonKey(key))
      .map(([key, item]) => [key, sanitizeJson(item, depth + 1)])
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeJsonKey(value) {
  const normalized = String(value).toLowerCase();
  return Boolean(value) && !["__proto__", "prototype", "constructor"].includes(normalized);
}

function hasOnlyFields(value, allowedFields) {
  return Object.keys(value).every((key) => allowedFields.has(key));
}

function isIdentifier(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    normalizeIdentifier(value) === value
  );
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isNullableValid(value, validator) {
  return value === null || (value !== undefined && validator(value));
}

function isNonEmptyText(value, limit) {
  return typeof value === "string" && value.length > 0 && value.length <= limit;
}

function isContractScalar(value) {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= 1000)
  );
}

function isSafeJsonValue(value, depth = 0) {
  if (depth > 8) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 200 && value.every((item) => isSafeJsonValue(item, depth + 1));
  }
  if (!isPlainObject(value) || Object.keys(value).length > 200) return false;
  return Object.values(value).every((item) => isSafeJsonValue(item, depth + 1));
}

function containsForbiddenPrivateField(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenPrivateField(item, depth + 1));
  }
  const forbidden = new Set([
    "raw_chunk",
    "raw_chunks",
    "chunks",
    "answer_key",
    "private_answer",
    "scoring_rule",
    "internal_state",
    "server_state",
    "stack",
    "secret",
    "api_key"
  ]);
  return Object.entries(value).some(
    ([key, item]) =>
      forbidden.has(String(key).toLowerCase()) ||
      containsForbiddenPrivateField(item, depth + 1)
  );
}

function containsVoiceForbiddenField(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsVoiceForbiddenField(item, depth + 1));
  }
  const forbidden = new Set([
    "card",
    "cards",
    "evidence",
    "raw_chunk",
    "raw_chunks",
    "chunks",
    "answer_key",
    "private_answer",
    "scoring_rule",
    "internal_state",
    "server_state"
  ]);
  return Object.entries(value).some(
    ([key, item]) =>
      forbidden.has(String(key).toLowerCase()) ||
      containsVoiceForbiddenField(item, depth + 1)
  );
}
