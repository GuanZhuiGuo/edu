const SENTENCE_BOUNDARY = /(?<=[。！？!?；;\n])/u;
const TRAILING_PUNCTUATION = /[。！？!?；;]+$/u;

export function compileSourceText(source = {}) {
  const sourceText =
    typeof source.source_text === "string" ? source.source_text.trim() : "";
  if (sourceText.length < 20 || sourceText.length > 4000) {
    throw sourceTechniqueError(
      "INVALID_SOURCE_TEXT",
      "知识内容需要在 20 到 4000 个字符之间"
    );
  }

  const sentences = sourceText
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.replace(TRAILING_PUNCTUATION, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (sentences.length === 0) sentences.push(sourceText);

  const requestedTitle =
    typeof source.title === "string" ? source.title.trim() : "";
  const title = (requestedTitle || sentences[0] || "知识点素材").slice(0, 48);
  const topicId = `topic_${stableHash(`${title}:${sourceText}`).slice(0, 12)}`;
  const claims = sentences.slice(0, 6).map((text, index) => ({
    claim_id: `claim_${index + 1}`,
    id: `claim_${index + 1}`,
    text: text.slice(0, 600),
    source_support: text.slice(0, 500)
  }));

  return Object.freeze({
    source_text: sourceText,
    title,
    language:
      typeof source.language === "string" && source.language.trim()
        ? source.language.trim().slice(0, 20)
        : "zh-CN",
    topic_id: topicId,
    sentences: Object.freeze([...sentences]),
    claims: Object.freeze(claims.map((claim) => Object.freeze(claim)))
  });
}

export function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function sourceTechniqueError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "SourceTechniqueError";
  error.code = code;
  Object.assign(error, details);
  return error;
}
