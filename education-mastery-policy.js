const DAY_MS = 86_400_000;

export const MASTERY_POLICY_SCHEMA_VERSION = "education-mastery-policy@1.0";

export const DEFAULT_MASTERY_POLICY = deepFreeze({
  schema_version: MASTERY_POLICY_SCHEMA_VERSION,
  enabled: true,
  algorithm: "weighted_evidence_decay_v1",
  thresholds: {
    mastered: 0.85,
    secure: 0.7,
    learning: 0.45,
  },
  outcome_scores: {
    correct: 1,
    partial: 0.5,
    incorrect: 0,
  },
  difficulty_weights: {
    foundation: 0.82,
    easy: 0.9,
    medium: 1,
    hard: 1.18,
    challenge: 1.32,
    default: 1,
  },
  hint_adjustment: {
    score_penalty_per_hint: 0.08,
    maximum_score_penalty: 0.36,
    weight_penalty_per_hint: 0.06,
    minimum_weight_multiplier: 0.55,
  },
  duration_adjustment: {
    expected_ms: {
      foundation: 45_000,
      easy: 60_000,
      medium: 90_000,
      hard: 150_000,
      challenge: 240_000,
      default: 90_000,
    },
    too_fast_ratio: 0.12,
    too_slow_ratio: 3,
    minimum_weight_multiplier: 0.68,
  },
  source_weights: {
    deterministic_grader: 1,
    teacher_review: 1.15,
    validated_model: 0.78,
    imported_verified_exam: 1.05,
    server_graded_question: 1,
    default: 0.75,
  },
  evidence_class_weights: {
    real: 1,
    demo: 0.08,
    legacy: 0.65,
    proposal: 0,
  },
  forgetting: {
    enabled: true,
    grace_period_days: 14,
    half_life_days: 120,
    minimum_retention: 0.18,
    baseline_probability: 0.5,
  },
  confidence: {
    weight_scale: 6,
  },
});

export class MasteryPolicyError extends Error {
  constructor(message, { code = "invalid_mastery_policy" } = {}) {
    super(message);
    this.name = "MasteryPolicyError";
    this.code = code;
  }
}

export function normalizeMasteryPolicy(value = {}, { base = DEFAULT_MASTERY_POLICY } = {}) {
  const patch = isPlainObject(value) ? value : fail("掌握度策略必须是 JSON 对象");
  const merged = mergeKnown(base, patch);
  const normalized = {
    schema_version: MASTERY_POLICY_SCHEMA_VERSION,
    enabled: merged.enabled !== false,
    algorithm: "weighted_evidence_decay_v1",
    thresholds: {
      mastered: finiteNumber(merged.thresholds.mastered, "thresholds.mastered", 0, 1),
      secure: finiteNumber(merged.thresholds.secure, "thresholds.secure", 0, 1),
      learning: finiteNumber(merged.thresholds.learning, "thresholds.learning", 0, 1),
    },
    outcome_scores: mapNumbers(merged.outcome_scores, DEFAULT_MASTERY_POLICY.outcome_scores, {
      minimum: 0, maximum: 1, path: "outcome_scores",
    }),
    difficulty_weights: mapNumbers(merged.difficulty_weights, DEFAULT_MASTERY_POLICY.difficulty_weights, {
      minimum: 0.05, maximum: 5, path: "difficulty_weights",
    }),
    hint_adjustment: {
      score_penalty_per_hint: finiteNumber(merged.hint_adjustment.score_penalty_per_hint, "hint_adjustment.score_penalty_per_hint", 0, 1),
      maximum_score_penalty: finiteNumber(merged.hint_adjustment.maximum_score_penalty, "hint_adjustment.maximum_score_penalty", 0, 1),
      weight_penalty_per_hint: finiteNumber(merged.hint_adjustment.weight_penalty_per_hint, "hint_adjustment.weight_penalty_per_hint", 0, 1),
      minimum_weight_multiplier: finiteNumber(merged.hint_adjustment.minimum_weight_multiplier, "hint_adjustment.minimum_weight_multiplier", 0, 1),
    },
    duration_adjustment: {
      expected_ms: mapNumbers(merged.duration_adjustment.expected_ms, DEFAULT_MASTERY_POLICY.duration_adjustment.expected_ms, {
        minimum: 1_000, maximum: 7_200_000, path: "duration_adjustment.expected_ms",
      }),
      too_fast_ratio: finiteNumber(merged.duration_adjustment.too_fast_ratio, "duration_adjustment.too_fast_ratio", 0.01, 1),
      too_slow_ratio: finiteNumber(merged.duration_adjustment.too_slow_ratio, "duration_adjustment.too_slow_ratio", 1, 20),
      minimum_weight_multiplier: finiteNumber(merged.duration_adjustment.minimum_weight_multiplier, "duration_adjustment.minimum_weight_multiplier", 0.05, 1),
    },
    source_weights: mapNumbers(merged.source_weights, DEFAULT_MASTERY_POLICY.source_weights, {
      minimum: 0, maximum: 5, path: "source_weights", allowAdditional: true,
    }),
    evidence_class_weights: mapNumbers(merged.evidence_class_weights, DEFAULT_MASTERY_POLICY.evidence_class_weights, {
      minimum: 0, maximum: 2, path: "evidence_class_weights",
    }),
    forgetting: {
      enabled: merged.forgetting.enabled !== false,
      grace_period_days: finiteNumber(merged.forgetting.grace_period_days, "forgetting.grace_period_days", 0, 3650),
      half_life_days: finiteNumber(merged.forgetting.half_life_days, "forgetting.half_life_days", 1, 3650),
      minimum_retention: finiteNumber(merged.forgetting.minimum_retention, "forgetting.minimum_retention", 0, 1),
      baseline_probability: finiteNumber(merged.forgetting.baseline_probability, "forgetting.baseline_probability", 0, 1),
    },
    confidence: {
      weight_scale: finiteNumber(merged.confidence.weight_scale, "confidence.weight_scale", 0.1, 100),
    },
  };
  if (!(normalized.thresholds.mastered > normalized.thresholds.secure
    && normalized.thresholds.secure > normalized.thresholds.learning)) {
    fail("掌握度阈值必须满足 mastered > secure > learning");
  }
  if (normalized.hint_adjustment.maximum_score_penalty
    < normalized.hint_adjustment.score_penalty_per_hint) {
    fail("最大提示扣分不能小于单次提示扣分");
  }
  if (normalized.duration_adjustment.too_slow_ratio
    <= normalized.duration_adjustment.too_fast_ratio) {
    fail("慢速阈值必须大于快速阈值");
  }
  return normalized;
}

export function calculateMasteryProjection(rows, policyValue, { now = new Date().toISOString() } = {}) {
  const policy = normalizeMasteryPolicy(policyValue);
  const nowMs = Date.parse(now);
  const contributions = [];
  for (const row of rows || []) {
    const contribution = calculateEvidenceContribution(row, policy, nowMs);
    if (contribution.weight > 0 && Number.isFinite(contribution.score)) contributions.push(contribution);
  }
  if (!policy.enabled || !contributions.length) {
    return {
      mastery_probability: null,
      mastery_state: "unassessed",
      confidence: 0,
      evidence_count: 0,
      total_weight: 0,
      latest_source: null,
      last_event_at: null,
      contribution_count: 0,
    };
  }
  const totalWeight = contributions.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = contributions.reduce((sum, item) => sum + item.score * item.weight, 0);
  const probability = totalWeight > 0 ? weightedScore / totalWeight : null;
  const latest = contributions.reduce((current, item) => (
    !current || item.occurred_at > current.occurred_at ? item : current
  ), null);
  return {
    mastery_probability: round(probability),
    mastery_state: masteryState(probability, policy.thresholds),
    confidence: round(1 - Math.exp(-totalWeight / policy.confidence.weight_scale)),
    evidence_count: contributions.reduce((sum, item) => sum + item.sample_count, 0),
    total_weight: round(totalWeight),
    latest_source: latest?.source_type || null,
    last_event_at: latest?.occurred_at || null,
    contribution_count: contributions.length,
  };
}

export function calculateEvidenceContribution(row, policyValue, nowMs = Date.now()) {
  const policy = normalizeMasteryPolicy(policyValue);
  const metadata = parseJson(row?.metadata_json, row?.metadata || {});
  const factors = isPlainObject(metadata.mastery_factors) ? metadata.mastery_factors : {};
  const evidenceClass = cleanKey(row?.evidence_class || factors.evidence_class
    || (metadata.demo_seed === true ? "demo" : row?.apply_to_mastery ? "legacy" : "proposal"));
  const sourceType = cleanKey(row?.source_type || factors.source_type || "default");
  const difficulty = normalizeDifficulty(factors.difficulty || metadata.difficulty || "default");
  const hintsUsed = nonNegativeInteger(factors.hints_used ?? metadata.hints_used ?? 0);
  const durationMs = nonNegativeNumber(factors.duration_ms ?? metadata.duration_ms ?? 0);
  const sampleCount = Math.max(1, nonNegativeInteger(row?.sample_count || 1));
  const rawScore = normalizedScore(row, policy);
  const hintScorePenalty = Math.min(
    policy.hint_adjustment.maximum_score_penalty,
    hintsUsed * policy.hint_adjustment.score_penalty_per_hint,
  );
  const hintWeightMultiplier = Math.max(
    policy.hint_adjustment.minimum_weight_multiplier,
    1 - hintsUsed * policy.hint_adjustment.weight_penalty_per_hint,
  );
  const expectedDuration = policy.duration_adjustment.expected_ms[difficulty]
    || policy.duration_adjustment.expected_ms.default;
  const durationRatio = durationMs > 0 ? durationMs / expectedDuration : 1;
  const durationWeightMultiplier = durationRatio < policy.duration_adjustment.too_fast_ratio
    ? interpolateFloor(durationRatio / policy.duration_adjustment.too_fast_ratio,
      policy.duration_adjustment.minimum_weight_multiplier)
    : durationRatio > policy.duration_adjustment.too_slow_ratio
      ? Math.max(policy.duration_adjustment.minimum_weight_multiplier,
        policy.duration_adjustment.too_slow_ratio / durationRatio)
      : 1;
  const retention = retentionFactor(row?.occurred_at, nowMs, policy.forgetting);
  const baseline = policy.forgetting.baseline_probability;
  const retainedScore = baseline + ((Math.max(0, rawScore - hintScorePenalty) - baseline) * retention);
  const weight = nonNegativeNumber(row?.weight ?? 1)
    * (policy.difficulty_weights[difficulty] || policy.difficulty_weights.default)
    * (policy.source_weights[sourceType] ?? policy.source_weights.default)
    * (policy.evidence_class_weights[evidenceClass] ?? 0)
    * hintWeightMultiplier
    * durationWeightMultiplier
    * retention;
  return {
    score: clamp(retainedScore, 0, 1),
    weight: Math.max(0, weight),
    sample_count: sampleCount,
    source_type: sourceType,
    evidence_class: evidenceClass,
    difficulty,
    retention,
    occurred_at: validIso(row?.occurred_at) || new Date(nowMs).toISOString(),
  };
}

function normalizedScore(row, policy) {
  const score = Number(row?.score);
  if (Number.isFinite(score) && score >= 0 && score <= 1) return score;
  const outcome = cleanKey(row?.outcome);
  if (["correct", "answer_correct", "passed"].includes(outcome)) return policy.outcome_scores.correct;
  if (["partial", "partially_correct"].includes(outcome)) return policy.outcome_scores.partial;
  if (["incorrect", "answer_incorrect", "failed"].includes(outcome)) return policy.outcome_scores.incorrect;
  return policy.outcome_scores.partial;
}

function retentionFactor(occurredAt, nowMs, policy) {
  if (!policy.enabled) return 1;
  const occurredMs = Date.parse(occurredAt);
  if (!Number.isFinite(occurredMs) || !Number.isFinite(nowMs)) return 1;
  const ageDays = Math.max(0, (nowMs - occurredMs) / DAY_MS);
  const decayingDays = Math.max(0, ageDays - policy.grace_period_days);
  if (decayingDays <= 0) return 1;
  return Math.max(policy.minimum_retention, 0.5 ** (decayingDays / policy.half_life_days));
}

function masteryState(probability, thresholds) {
  if (probability == null) return "unassessed";
  if (probability >= thresholds.mastered) return "mastered";
  if (probability >= thresholds.secure) return "secure";
  if (probability >= thresholds.learning) return "learning";
  return "weak";
}

function mergeKnown(base, patch) {
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in output)) continue;
    if (isPlainObject(value) && isPlainObject(output[key])) output[key] = mergeKnown(output[key], value);
    else output[key] = value;
  }
  return output;
}

function mapNumbers(value, defaults, { minimum, maximum, path, allowAdditional = false }) {
  const source = isPlainObject(value) ? value : {};
  const keys = allowAdditional ? new Set([...Object.keys(defaults), ...Object.keys(source)]) : new Set(Object.keys(defaults));
  const result = {};
  for (const key of keys) {
    if (!/^[a-z][a-z0-9_-]{0,79}$/u.test(key)) fail(`${path} 包含无效键`);
    result[key] = finiteNumber(source[key] ?? defaults[key] ?? defaults.default, `${path}.${key}`, minimum, maximum);
  }
  return result;
}

function finiteNumber(value, path, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${path} 必须介于 ${minimum} 和 ${maximum} 之间`);
  }
  return parsed;
}

function normalizeDifficulty(value) {
  const key = cleanKey(value);
  if (["foundation", "starter", "basic", "basic_memory"].includes(key)) return "foundation";
  if (["easy", "low"].includes(key)) return "easy";
  if (["hard", "high"].includes(key)) return "hard";
  if (["challenge", "advanced", "very_hard"].includes(key)) return "challenge";
  if (["medium", "normal", "mid", "medium_understanding", "medium_transfer"].includes(key)) return "medium";
  return "default";
}

function interpolateFloor(ratio, floor) {
  return floor + ((1 - floor) * clamp(ratio, 0, 1));
}

function validIso(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function parseJson(value, fallback) {
  if (isPlainObject(value)) return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cleanKey(value) {
  return String(value ?? "").trim().toLowerCase().slice(0, 120) || "default";
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function nonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function round(value) {
  return value == null ? null : Number(Number(value).toFixed(4));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new MasteryPolicyError(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
