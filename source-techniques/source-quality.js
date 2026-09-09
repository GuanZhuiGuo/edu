const DEFAULT_OPTIONS = Object.freeze({
  near_duplicate_threshold: 0.86,
  hard_duplicate_ratio: 0.5,
  minimum_propositions_for_hard_failure: 3,
  minimum_repeated_unit_length: 6,
  maximum_propositions: 64
});

const SENTENCE_DELIMITERS = new Set([
  "。",
  "！",
  "？",
  "；",
  "!",
  "?",
  ";",
  "\n"
]);

const NEGATION_PATTERNS = Object.freeze([
  ["cannot", /\bcannot\b/giu],
  ["can't", /\bcan['’]t\b/giu],
  ["doesn't", /\bdoesn['’]t\b/giu],
  ["don't", /\bdon['’]t\b/giu],
  ["isn't", /\bisn['’]t\b/giu],
  ["aren't", /\baren['’]t\b/giu],
  ["never", /\bnever\b/giu],
  ["without", /\bwithout\b/giu],
  ["not", /\bnot\b/giu],
  ["no", /\bno\b/giu],
  ["并非", /并非/gu],
  ["不是", /不是/gu],
  ["没有", /没有/gu],
  ["不能", /不能/gu],
  ["不会", /不会/gu],
  ["不应", /不应/gu],
  ["不得", /不得/gu],
  ["未", /未/gu],
  ["无", /无/gu],
  ["禁止", /禁止/gu],
  ["避免", /避免/gu],
  ["否", /否/gu],
  ["不", /不/gu]
]);

const NUMBER_PATTERN =
  /[-+]?\d+(?:\.\d+)?%?|[零〇一二两三四五六七八九十百千万亿]+/gu;

export class SourceQualityError extends Error {
  constructor(code, message, report) {
    super(message);
    this.name = "SourceQualityError";
    this.code = code;
    this.report = report;
  }
}

/**
 * Normalize source text for quality analysis while keeping it readable.
 * Fingerprint-specific punctuation removal is intentionally separate.
 */
export function normalizeSourceTextForQuality(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t\f\v]+/gu, " ")
    .replace(/ *\n+ */gu, "\n")
    .replace(/([。！？；!?;,.，、：:])\1+/gu, "$1")
    .trim();
}

/**
 * Analyze one source string or a standard `{ source_text }` input object.
 * This function never throws for quality failures; callers can inspect the
 * report and decide whether to reject, warn, or request semantic assistance.
 */
export function analyzeSourceQuality(input, options = {}) {
  const sourceText = readSourceText(input);
  const normalizedText = normalizeSourceTextForQuality(sourceText);
  const settings = normalizeOptions(options);
  const rawPropositions = splitPropositions(normalizedText).slice(
    0,
    settings.maximum_propositions
  );
  const propositions = [];
  const representativeIndexes = [];
  const fingerprintToRepresentative = new Map();
  let exactDuplicateCount = 0;
  let nearDuplicateCount = 0;

  for (const [index, text] of rawPropositions.entries()) {
    const normalized = normalizeProposition(text);
    const fingerprint = propositionFingerprint(normalized);
    const numbers = extractNumberSignature(normalized);
    const negations = extractNegationSignature(normalized);
    let duplicateOf = null;
    let duplicateKind = null;
    let similarity = 1;

    const exactRepresentative = fingerprintToRepresentative.get(
      protectedFingerprint(fingerprint, numbers, negations)
    );
    if (Number.isInteger(exactRepresentative)) {
      duplicateOf = exactRepresentative;
      duplicateKind = "exact";
      exactDuplicateCount += 1;
    } else {
      let best = null;
      for (const representativeIndex of representativeIndexes) {
        const representative = propositions[representativeIndex];
        if (
          !sameSignature(numbers, representative.numbers) ||
          !sameSignature(negations, representative.negations)
        ) {
          continue;
        }
        const candidateSimilarity = propositionSimilarity(
          fingerprint,
          representative.fingerprint
        );
        if (
          candidateSimilarity >= settings.near_duplicate_threshold &&
          (!best || candidateSimilarity > best.similarity)
        ) {
          best = {
            index: representativeIndex,
            similarity: candidateSimilarity
          };
        }
      }
      if (best) {
        duplicateOf = best.index;
        duplicateKind = "near";
        similarity = best.similarity;
        nearDuplicateCount += 1;
      }
    }

    const proposition = {
      index,
      text,
      normalized,
      fingerprint,
      numbers,
      negations,
      duplicate_of: duplicateOf,
      duplicate_kind: duplicateKind,
      similarity: round(similarity, 4)
    };
    propositions.push(proposition);

    if (duplicateOf === null) {
      representativeIndexes.push(index);
      fingerprintToRepresentative.set(
        protectedFingerprint(fingerprint, numbers, negations),
        index
      );
    }
  }

  const repeatedUnit = detectWholeTextRepetition(
    normalizedText,
    settings.minimum_repeated_unit_length
  );
  const duplicateCount = exactDuplicateCount + nearDuplicateCount;
  const propositionCount = propositions.length;
  const uniquePropositionCount = representativeIndexes.length;
  const duplicateRatio =
    propositionCount > 0 ? duplicateCount / propositionCount : 0;
  const wholeTextHardFailure =
    repeatedUnit !== null && repeatedUnit.repetitions >= 3;
  const propositionHardFailure =
    propositionCount >= settings.minimum_propositions_for_hard_failure &&
    duplicateCount >= 2 &&
    duplicateRatio >= settings.hard_duplicate_ratio;
  const tooRepetitive = wholeTextHardFailure || propositionHardFailure;
  const warningCodes = [];
  if (!tooRepetitive && duplicateCount > 0) {
    warningCodes.push("SOURCE_HAS_DUPLICATES");
  }
  if (
    !tooRepetitive &&
    propositionCount >= 2 &&
    uniquePropositionCount === 1
  ) {
    warningCodes.push("SOURCE_LOW_INFORMATION_DENSITY");
  }

  return deepFreeze({
    version: "1.0",
    status: tooRepetitive
      ? "error"
      : warningCodes.length > 0
        ? "warning"
        : "ok",
    passed: !tooRepetitive,
    error_code: tooRepetitive ? "SOURCE_TOO_REPETITIVE" : null,
    warning_codes: warningCodes,
    normalized_text: normalizedText,
    metrics: {
      input_length: sourceText.length,
      normalized_length: normalizedText.length,
      effective_length: compactForRepetition(normalizedText).length,
      proposition_count: propositionCount,
      unique_proposition_count: uniquePropositionCount,
      exact_duplicate_count: exactDuplicateCount,
      near_duplicate_count: nearDuplicateCount,
      duplicate_count: duplicateCount,
      duplicate_ratio: round(duplicateRatio, 4),
      unique_ratio:
        propositionCount > 0
          ? round(uniquePropositionCount / propositionCount, 4)
          : 0
    },
    repeated_unit: repeatedUnit,
    propositions
  });
}

/**
 * Pipeline-friendly guard. Returns the same report as analyzeSourceQuality or
 * throws a stable SOURCE_TOO_REPETITIVE error before any adapter is executed.
 */
export function assertSourceQuality(input, options = {}) {
  const report = analyzeSourceQuality(input, options);
  if (!report.passed) {
    throw new SourceQualityError(
      "SOURCE_TOO_REPETITIVE",
      "输入内容重复度过高，请删除重复句并补充有效知识信息",
      report
    );
  }
  return report;
}

export function propositionSimilarity(left, right) {
  if (
    !sameSignature(
      extractNumberSignature(left),
      extractNumberSignature(right)
    ) ||
    !sameSignature(
      extractNegationSignature(left),
      extractNegationSignature(right)
    )
  ) {
    return 0;
  }
  const first = propositionFingerprint(left);
  const second = propositionFingerprint(right);
  if (!first || !second) return first === second ? 1 : 0;
  if (first === second) return 1;
  const lengthRatio =
    Math.min(first.length, second.length) /
    Math.max(first.length, second.length);
  if (lengthRatio < 0.7) return 0;

  const firstBigrams = characterNgrams(first, 2);
  const secondBigrams = characterNgrams(second, 2);
  if (firstBigrams.size === 0 || secondBigrams.size === 0) {
    return lengthRatio;
  }
  let intersection = 0;
  for (const gram of firstBigrams) {
    if (secondBigrams.has(gram)) intersection += 1;
  }
  return (2 * intersection) / (firstBigrams.size + secondBigrams.size);
}

function readSourceText(input) {
  if (typeof input === "string") return input;
  if (
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    typeof input.source_text === "string"
  ) {
    return input.source_text;
  }
  throw new SourceQualityError(
    "SOURCE_QUALITY_INVALID_INPUT",
    "source quality input must be a string or an object with source_text",
    null
  );
}

function normalizeOptions(options) {
  const source =
    options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
  return {
    near_duplicate_threshold: finiteWithin(
      source.near_duplicate_threshold,
      0.7,
      1,
      DEFAULT_OPTIONS.near_duplicate_threshold
    ),
    hard_duplicate_ratio: finiteWithin(
      source.hard_duplicate_ratio,
      0.34,
      1,
      DEFAULT_OPTIONS.hard_duplicate_ratio
    ),
    minimum_propositions_for_hard_failure: integerWithin(
      source.minimum_propositions_for_hard_failure,
      3,
      20,
      DEFAULT_OPTIONS.minimum_propositions_for_hard_failure
    ),
    minimum_repeated_unit_length: integerWithin(
      source.minimum_repeated_unit_length,
      4,
      200,
      DEFAULT_OPTIONS.minimum_repeated_unit_length
    ),
    maximum_propositions: integerWithin(
      source.maximum_propositions,
      3,
      256,
      DEFAULT_OPTIONS.maximum_propositions
    )
  };
}

function splitPropositions(text) {
  const propositions = [];
  let buffer = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const previous = text[index - 1] || "";
    const next = text[index + 1] || "";
    const decimalPoint =
      character === "." && /\d/u.test(previous) && /\d/u.test(next);
    if (
      !decimalPoint &&
      (SENTENCE_DELIMITERS.has(character) || character === ".")
    ) {
      pushProposition(propositions, buffer);
      buffer = "";
      continue;
    }
    buffer += character;
  }
  pushProposition(propositions, buffer);
  return propositions;
}

function pushProposition(target, value) {
  const normalized = normalizeProposition(value);
  if (normalized) target.push(normalized);
}

function normalizeProposition(value) {
  return normalizeSourceTextForQuality(value)
    .replace(/^[\s\-–—•·*#]+/gu, "")
    .replace(/[\s\-–—•·*#]+$/gu, "")
    .trim();
}

function propositionFingerprint(value) {
  return normalizeProposition(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function protectedFingerprint(fingerprint, numbers, negations) {
  return `${fingerprint}\u0000${numbers.join("|")}\u0000${negations.join("|")}`;
}

function extractNumberSignature(value) {
  return [...normalizeProposition(value).matchAll(NUMBER_PATTERN)].map(
    (match) => match[0].toLocaleLowerCase()
  );
}

function extractNegationSignature(value) {
  let remaining = normalizeProposition(value)
    .toLocaleLowerCase()
    .replace(/不但|不仅/gu, "");
  const signature = [];
  for (const [label, pattern] of NEGATION_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = [...remaining.matchAll(pattern)];
    if (matches.length === 0) continue;
    for (let index = 0; index < matches.length; index += 1) {
      signature.push(label);
    }
    remaining = remaining.replace(pattern, " ");
  }
  return signature.sort();
}

function sameSignature(left, right) {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function characterNgrams(value, size) {
  const characters = [...value];
  const grams = new Set();
  if (characters.length < size) {
    if (characters.length > 0) grams.add(characters.join(""));
    return grams;
  }
  for (let index = 0; index <= characters.length - size; index += 1) {
    grams.add(characters.slice(index, index + size).join(""));
  }
  return grams;
}

function detectWholeTextRepetition(text, minimumUnitLength) {
  const compact = compactForRepetition(text);
  if (compact.length < minimumUnitLength * 3) return null;
  const maximumRepetitions = Math.min(
    12,
    Math.floor(compact.length / minimumUnitLength)
  );
  for (
    let repetitions = maximumRepetitions;
    repetitions >= 3;
    repetitions -= 1
  ) {
    if (compact.length % repetitions !== 0) continue;
    const unitLength = compact.length / repetitions;
    if (unitLength < minimumUnitLength) continue;
    const unit = compact.slice(0, unitLength);
    if (unit.repeat(repetitions) === compact) {
      return {
        repetitions,
        unit_length: unitLength,
        unit
      };
    }
  }
  return null;
}

function compactForRepetition(value) {
  return normalizeSourceTextForQuality(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function finiteWithin(value, minimum, maximum, fallback) {
  return Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function integerWithin(value, minimum, maximum, fallback) {
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
