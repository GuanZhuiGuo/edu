import { createHash } from "node:crypto";

export const EDUCATION_LEXICAL_SPARSE_VERSION = "lexical_sparse_v1";

const MAX_TEXT_LENGTH = 100_000;
const MAX_TOKENS = 20_000;

export class EducationLexicalSparseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EducationLexicalSparseError";
    this.code = code;
    this.status = 422;
  }
}

/**
 * Deterministic local lexical encoder used when the embedding provider does
 * not return a sparse vector. It intentionally returns only hashed dimensions;
 * raw tokens are never persisted in the vector store or receipts.
 */
export function encodeEducationLexicalSparse(text) {
  const normalized = normalizeEducationLexicalText(text);
  if (!normalized) {
    throw new EducationLexicalSparseError(
      "education_lexical_sparse_empty",
      "Text must contain at least one searchable token.",
    );
  }
  const frequencies = new Map();
  for (const token of tokenize(normalized)) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
    if (frequencies.size >= MAX_TOKENS) break;
  }
  if (!frequencies.size) {
    throw new EducationLexicalSparseError(
      "education_lexical_sparse_empty",
      "Text must contain at least one searchable token.",
    );
  }

  const dimensions = new Map();
  for (const [token, frequency] of frequencies) {
    const index = stableDimension(token);
    const weight = 1 + Math.log(frequency);
    dimensions.set(index, (dimensions.get(index) || 0) + weight);
  }
  const pairs = [...dimensions.entries()].sort((left, right) => left[0] - right[0]);
  return Object.freeze({
    indices: Object.freeze(pairs.map(([index]) => index)),
    values: Object.freeze(pairs.map(([, value]) => Number(value.toFixed(8)))),
    kind: "local_lexical",
    version: EDUCATION_LEXICAL_SPARSE_VERSION,
  });
}

export function normalizeEducationLexicalText(value) {
  if (typeof value !== "string") {
    throw new EducationLexicalSparseError(
      "education_lexical_sparse_invalid",
      "Text must be a string.",
    );
  }
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function tokenize(text) {
  const tokens = [];
  const add = (token) => {
    const safe = token.trim();
    if (safe && tokens.length < MAX_TOKENS) tokens.push(safe);
  };

  // Word segmentation improves Chinese words when ICU dictionaries are
  // available, but Han bigrams below keep behavior useful and deterministic
  // across environments with different dictionary versions.
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
    for (const segment of segmenter.segment(text)) {
      if (segment.isWordLike) add(`w:${segment.segment}`);
    }
  }

  for (const match of text.matchAll(/[\p{Script=Han}]+/gu)) {
    const chars = [...match[0]];
    for (const char of chars) add(`h1:${char}`);
    for (let index = 0; index + 1 < chars.length; index += 1) {
      add(`h2:${chars[index]}${chars[index + 1]}`);
    }
  }
  for (const match of text.matchAll(/[a-z]+(?:[_-][a-z0-9]+)*|\d+(?:\.\d+)?/gu)) {
    add(`latin:${match[0]}`);
  }
  for (const match of text.matchAll(/[a-z\d]+(?:\s*[+\-*/^=<>]\s*[a-z\d.]+)+/gu)) {
    add(`formula:${match[0].replace(/\s+/gu, "")}`);
  }
  return tokens;
}

function stableDimension(token) {
  return createHash("sha256").update(`${EDUCATION_LEXICAL_SPARSE_VERSION}\u001f${token}`)
    .digest().readUInt32BE(0) & 0x7fffffff;
}
