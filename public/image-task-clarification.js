const IMAGE_TASK_MODES = Object.freeze({
  solve: Object.freeze({
    id: "solve",
    label: "拍题解答",
    prompt: "请解答刚才上传的题目，并给出关键解题思路。",
  }),
  grade: Object.freeze({
    id: "grade",
    label: "作业批改",
    prompt: "请批改刚才上传的整页作业，标出对错并给出订正建议。",
  }),
});

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function normalizeImageTaskChoice(value) {
  const mode = String(value || "").trim().toLowerCase();
  return IMAGE_TASK_MODES[mode] || null;
}

export function normalizeImageTaskClarification(value) {
  if (!value || typeof value !== "object" || value.status !== "clarify") return null;
  const offeredModes = new Set(
    (Array.isArray(value.clarification?.options) ? value.clarification.options : [])
      .map((option) => normalizeImageTaskChoice(option?.id)?.id)
      .filter(Boolean),
  );
  if (!offeredModes.has("solve") || !offeredModes.has("grade")) return null;
  return Object.freeze({
    prompt: safeText(value.clarification?.prompt, 160)
      || "请选择这张图片要用于拍题解答，还是作业批改。",
    options: Object.freeze([
      IMAGE_TASK_MODES.solve,
      IMAGE_TASK_MODES.grade,
    ]),
  });
}

export function questionImageAttachmentFromDataUrl(dataUrl, { name = "question-image" } = {}) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
    String(dataUrl || "").trim(),
  );
  if (!match || !SUPPORTED_IMAGE_TYPES.has(match[1])) return null;
  const estimatedBytes = Math.floor((match[2].length * 3) / 4)
    - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (estimatedBytes <= 0 || estimatedBytes > MAX_IMAGE_BYTES) return null;
  return Object.freeze({
    mime_type: match[1],
    data: match[2],
    name: safeText(name, 180) || "question-image",
  });
}

export function buildImageTaskChoicePrompt(mode) {
  return normalizeImageTaskChoice(mode)?.prompt || "";
}

function safeText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .trim()
    .slice(0, maxLength);
}
