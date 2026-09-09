const C1_CONTROL_PATTERN = /[\u0080-\u009f]/gu;
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/gu;
const COMMON_MOJIBAKE_LEAD_PATTERN = /[ÂÃâäåæçèéïð]/gu;

/**
 * Repairs the specific, reversible failure mode where UTF-8 bytes were decoded
 * as latin1 (for example `中文.pdf` becoming `ä¸­æ.pdf`).
 *
 * The repair is intentionally conservative:
 * - every byte must form canonical UTF-8;
 * - the candidate must reduce encoding symptoms or recover CJK text;
 * - normal Unicode text and ordinary accented names are left untouched.
 *
 * Mixed strings are supported by considering only latin1-sized runs, so a
 * healthy Chinese prefix is never re-encoded while a damaged suffix can still
 * be recovered.
 */
export function repairUtf8Mojibake(value) {
  if (typeof value !== "string" || !value) return value;
  let output = "";
  let latin1Run = "";

  const flushRun = () => {
    if (!latin1Run) return;
    output += repairLatin1Run(latin1Run);
    latin1Run = "";
  };

  for (const character of value) {
    if (character.codePointAt(0) <= 0xff) {
      latin1Run += character;
    } else {
      flushRun();
      output += character;
    }
  }
  flushRun();
  return output;
}

function repairLatin1Run(value) {
  if (!/[\u0080-\u00ff]/u.test(value)) return value;
  const bytes = Buffer.from([...value].map((character) => character.charCodeAt(0)));
  const candidate = bytes.toString("utf8");
  if (
    candidate === value
    || candidate.includes("\ufffd")
    || !Buffer.from(candidate, "utf8").equals(bytes)
  ) return value;

  const originalControls = countMatches(value, C1_CONTROL_PATTERN);
  const candidateControls = countMatches(candidate, C1_CONTROL_PATTERN);
  const originalCjk = countMatches(value, CJK_PATTERN);
  const candidateCjk = countMatches(candidate, CJK_PATTERN);
  const originalMarkers = countMatches(value, COMMON_MOJIBAKE_LEAD_PATTERN);
  const candidateMarkers = countMatches(candidate, COMMON_MOJIBAKE_LEAD_PATTERN);

  const isClearImprovement = candidateControls < originalControls
    || (candidateCjk > originalCjk && candidateCjk > 0)
    || (originalMarkers > 0 && candidateMarkers < originalMarkers);
  return isClearImprovement ? candidate : value;
}

function countMatches(value, pattern) {
  return (String(value).match(pattern) || []).length;
}
