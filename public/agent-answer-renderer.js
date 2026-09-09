const VISUAL_DIRECTIVE_PATTERN = /\[(visual:[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159})\]/gu;
const BLOCK_MATH_MARKER_PATTERN = /^\uE000agent-math-(\d+)\uE001$/u;
const MAX_INLINE_EMPHASIS_LENGTH = 240;
export const EXTERNAL_RICH_RESULTS_SCHEMA_VERSION = "external-rich-results@1.0";
export const ANSWER_ATTRIBUTION_SCHEMA_VERSION = "answer-attribution@1.0";

const CONTROLLED_ANSWER_ATTRIBUTIONS = Object.freeze({
  doubao_aixue: Object.freeze({
    sourceLabel: "内容来自豆包爱学",
    accessibleLabel: "本条回答由豆包爱学补充，不是当前所选教材原文",
  }),
});

const CONTROLLED_ANSWER_ATTRIBUTION_REASONS = new Set([
  "curriculum_no_match",
]);

const SUPERSCRIPT_CHARACTERS = Object.freeze({
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ"
});

const SUBSCRIPT_CHARACTERS = Object.freeze({
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎"
});

const MATH_SYMBOLS = Object.freeze({
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  phi: "φ",
  omega: "ω",
  Delta: "Δ",
  Theta: "Θ",
  Sigma: "Σ",
  Omega: "Ω",
  times: "·",
  cdot: "·",
  div: "÷",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  pm: "±",
  mp: "∓",
  infty: "∞",
  angle: "∠",
  triangle: "△",
  perpendicular: "⊥",
  parallel: "∥",
  degree: "°",
  rightarrow: "→",
  leftarrow: "←",
  Leftrightarrow: "⇔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  sum: "∑",
  prod: "∏"
});

export function extractAgentVisualReferences(source) {
  const visualRefs = [];
  const seen = new Set();
  const text = String(source || "").replace(VISUAL_DIRECTIVE_PATTERN, (_directive, ref) => {
    if (!seen.has(ref)) {
      seen.add(ref);
      visualRefs.push(ref);
    }
    return "\n";
  });
  return { text, visualRefs };
}

export function parseAgentAnswer(source) {
  const originalText = String(source || "").replace(/\r\n?/gu, "\n");
  const extracted = extractAgentVisualReferences(originalText);
  const displayText = normalizeLegacyDisplayMarkup(extracted.text);
  const unwrapped = unwrapAccidentalDocumentEmphasis(displayText);
  const { text, mathBlocks } = normalizeAgentBlockSyntax(unwrapped);
  const blocks = [];
  let paragraphLines = [];
  let activeList = null;

  const closeParagraph = () => {
    if (!paragraphLines.length) return;
    blocks.push({
      type: "paragraph",
      inline: parseAgentInline(paragraphLines.join(" "))
    });
    paragraphLines = [];
  };
  const closeList = () => {
    if (!activeList) return;
    blocks.push(activeList);
    activeList = null;
  };
  const closeOpenBlocks = () => {
    closeParagraph();
    closeList();
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      closeOpenBlocks();
      continue;
    }

    const mathMarker = line.match(BLOCK_MATH_MARKER_PATTERN);
    if (mathMarker) {
      closeOpenBlocks();
      const math = mathBlocks[Number(mathMarker[1])];
      if (math !== undefined) blocks.push(createMathDescriptor(math));
      continue;
    }
    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})$/u.test(line)) {
      closeOpenBlocks();
      blocks.push({ type: "divider" });
      continue;
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/u);
    if (headingMatch) {
      closeOpenBlocks();
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        inline: parseAgentInline(headingMatch[2])
      });
      continue;
    }
    const listMatch = line.match(/^([-*+]|(\d{1,4})[.)])\s+(.+)$/u);
    if (listMatch) {
      closeParagraph();
      const ordered = Boolean(listMatch[2]);
      if (!activeList || activeList.ordered !== ordered) closeList();
      if (!activeList) {
        activeList = {
          type: "list",
          ordered,
          start: ordered ? Number(listMatch[2]) : undefined,
          items: []
        };
      }
      activeList.items.push(parseAgentInline(listMatch[3]));
      continue;
    }
    const noteMatch = line.match(/^>\s?(.*)$/u);
    if (noteMatch) {
      closeOpenBlocks();
      blocks.push({ type: "note", inline: parseAgentInline(noteMatch[1]) });
      continue;
    }

    closeList();
    paragraphLines.push(line);
  }
  closeOpenBlocks();

  return {
    source: originalText,
    text: displayText,
    visualRefs: extracted.visualRefs,
    blocks
  };
}

function normalizeLegacyDisplayMarkup(source) {
  return String(source || "")
    .replace(/<\s*summary(?:\s[^>]*)?>/giu, "\n### ")
    .replace(/<\s*\/\s*summary\s*>/giu, "\n")
    .replace(/<\s*\/?\s*details(?:\s[^>]*)?>/giu, "\n")
    .replace(/<\s*br\s*\/?>/giu, "\n")
    .replace(/<\s*(?:strong|b)\s*>/giu, "**")
    .replace(/<\s*\/\s*(?:strong|b)\s*>/giu, "**")
    .replace(/<\s*li(?:\s[^>]*)?>/giu, "\n- ")
    .replace(/<\s*\/\s*li\s*>/giu, "")
    .replace(/<\s*\/?\s*(?:ul|ol|p|div)(?:\s[^>]*)?>/giu, "\n")
    .replace(/\n{3,}/gu, "\n\n");
}

export function parseAgentInline(value) {
  const text = String(value || "");
  const tokens = [];
  const tokenPattern = new RegExp(
    [
      "`[^`\\n]+`",
      "\\\\\\((?:[^\\n]|\\n(?!\\n))*?\\\\\\)",
      "\\$(?!\\$)[^$\\n]+\\$",
      `\\*\\*[^*\\n]{1,${MAX_INLINE_EMPHASIS_LENGTH}}\\*\\*`,
      `__[^_\\n]{1,${MAX_INLINE_EMPHASIS_LENGTH}}__`
    ].join("|"),
    "gu"
  );
  let cursor = 0;
  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > cursor) tokens.push({ type: "text", value: text.slice(cursor, match.index) });
    const raw = match[0];
    if (raw.startsWith("`")) {
      tokens.push({ type: "code", value: raw.slice(1, -1) });
    } else if (raw.startsWith("\\(")) {
      tokens.push(createMathDescriptor(raw.slice(2, -2)));
    } else if (raw.startsWith("$")) {
      tokens.push(createMathDescriptor(raw.slice(1, -1)));
    } else {
      tokens.push({ type: "strong", value: raw.slice(2, -2) });
    }
    cursor = match.index + raw.length;
  }
  if (cursor < text.length) tokens.push({ type: "text", value: text.slice(cursor) });
  return tokens;
}

export function formatAgentMath(value) {
  let result = String(value || "")
    .replace(/\\(?:left|right)(?=[()[\]{}|.])/gu, "")
    .replace(/\\begin\{cases\}/gu, "{")
    .replace(/\\end\{cases\}/gu, "")
    .replace(/\\(?:dfrac|tfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/gu, "($1) / ($2)")
    .replace(/\\sqrt\[3\]\{([^{}]+)\}/gu, "∛($1)")
    .replace(/\\sqrt\{([^{}]+)\}/gu, "√($1)")
    .replace(/\\(?:text|mathrm|mathbf|boldsymbol|operatorname)\{([^{}]+)\}/gu, "$1")
    .replace(/\\overline\{([^{}]+)\}/gu, "$1̅")
    .replace(/\\(?:lvert|rvert|vert)(?![a-zA-Z])/gu, "|")
    .replace(/\\(?:,|;|:|!|quad|qquad)\s*/gu, " ")
    .replace(/\\\\/gu, " ; ");

  for (const [command, symbol] of Object.entries(MATH_SYMBOLS)) {
    result = result.replace(new RegExp(`\\\\${command}(?![a-zA-Z])`, "gu"), symbol);
  }

  result = result
    .replace(/\^\{([^{}]+)\}/gu, (_match, exponent) => toScript(exponent, SUPERSCRIPT_CHARACTERS, true))
    .replace(/_\{([^{}]+)\}/gu, (_match, subscript) => toScript(subscript, SUBSCRIPT_CHARACTERS, false))
    // In TeX an unbraced script consumes exactly one following token. Keeping
    // this to one character prevents `x^2+4x` from being rendered as if `2+4`
    // were the exponent. Multi-character scripts remain supported via ^{...}
    // and _{...} above.
    .replace(/\^([0-9n+\-=])/gu, (_match, exponent) => toScript(exponent, SUPERSCRIPT_CHARACTERS, true))
    .replace(/_([0-9+\-=])/gu, (_match, subscript) => toScript(subscript, SUBSCRIPT_CHARACTERS, false))
    .replace(/\\([a-zA-Z]+)/gu, "$1")
    .replace(/[{}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return result;
}

export function renderAgentAnswer(target, messageRow, source) {
  if (!target) return parseAgentAnswer(source);
  const parsed = parseAgentAnswer(source);
  const doc = target.ownerDocument || globalThis.document;
  if (!doc?.createDocumentFragment) return parsed;
  const fragment = doc.createDocumentFragment();

  for (const block of parsed.blocks) {
    if (block.type === "divider") {
      const divider = doc.createElement("div");
      divider.className = "agent-answer-divider";
      divider.setAttribute("role", "separator");
      fragment.append(divider);
      continue;
    }
    if (block.type === "heading") {
      const heading = doc.createElement("div");
      heading.className = "agent-answer-heading";
      heading.dataset.headingLevel = String(block.level);
      appendInlineNodes(doc, heading, block.inline);
      fragment.append(heading);
      continue;
    }
    if (block.type === "list") {
      const list = doc.createElement(block.ordered ? "ol" : "ul");
      list.className = "agent-answer-list";
      if (block.ordered && block.start > 1) list.start = block.start;
      block.items.forEach((tokens) => {
        const item = doc.createElement("li");
        appendInlineNodes(doc, item, tokens);
        list.append(item);
      });
      fragment.append(list);
      continue;
    }
    if (block.type === "math") {
      const paragraph = doc.createElement("p");
      paragraph.className = "agent-answer-paragraph agent-answer-math-block";
      const math = doc.createElement("span");
      math.className = "agent-answer-math";
      renderMathInto(math, block.tex, block.value, { displayMode: true });
      paragraph.append(math);
      fragment.append(paragraph);
      continue;
    }
    const paragraph = doc.createElement("p");
    paragraph.className = block.type === "note" ? "agent-answer-note" : "agent-answer-paragraph";
    appendInlineNodes(doc, paragraph, block.inline);
    fragment.append(paragraph);
  }

  if (!fragment.childNodes.length) {
    target.textContent = parsed.visualRefs.length
      ? "已准备好对应的互动内容"
      : "AI教师没有返回可展示的回答";
  } else {
    target.replaceChildren(fragment);
  }
  target.dataset.rawText = parsed.text.trim();
  target.dataset.visualRefs = JSON.stringify(parsed.visualRefs);
  target.classList.add("is-structured-answer");
  messageRow?.classList.add("has-structured-answer");
  messageRow?.classList.remove("is-muted");
  messageRow?.closest?.(".conversation-log")?.classList.add("has-structured-answer");
  return parsed;
}

/**
 * Normalize server-owned answer provenance without trusting provider copy.
 *
 * The same fields may arrive either as the standalone answer_attribution
 * contract or on the external_grounding envelope. Only a known provider and
 * fallback reason can create a learner-visible badge; source_label is ignored
 * deliberately so persisted history cannot inject or rename product copy.
 */
export function normalizeAgentAnswerAttribution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const nested = value.answer_attribution && typeof value.answer_attribution === "object"
    ? value.answer_attribution
    : value.answerAttribution && typeof value.answerAttribution === "object"
      ? value.answerAttribution
      : null;
  const source = nested || value;
  const isGroundingEnvelope = !nested && (
    Object.hasOwn(value, "references")
    || Object.hasOwn(value, "search_results")
    || Object.hasOwn(value, "rich_results")
    || Object.hasOwn(value, "richResults")
    || String(value.mode || "").startsWith("external_")
  );
  const schemaVersion = String(source.schema_version || source.schemaVersion || "").trim();
  if (!isGroundingEnvelope && schemaVersion !== ANSWER_ATTRIBUTION_SCHEMA_VERSION) return null;

  const provider = String(source.provider || source.provider_id || source.providerId || "")
    .trim()
    .toLowerCase();
  const fallbackReason = String(
    source.fallback_reason || source.fallbackReason || source.reason || ""
  ).trim().toLowerCase();
  const controlled = CONTROLLED_ANSWER_ATTRIBUTIONS[provider];
  if (!controlled || !CONTROLLED_ANSWER_ATTRIBUTION_REASONS.has(fallbackReason)) return null;

  return Object.freeze({
    schemaVersion: ANSWER_ATTRIBUTION_SCHEMA_VERSION,
    provider,
    sourceLabel: controlled.sourceLabel,
    accessibleLabel: controlled.accessibleLabel,
    fallbackReason,
  });
}

/** Mount a compact provenance label in an existing message metadata row. */
export function mountAgentAnswerAttribution(root, value) {
  const attribution = normalizeAgentAnswerAttribution(value);
  root?.querySelector?.(".turn-answer-attribution")?.remove();
  const doc = root?.ownerDocument || globalThis.document;
  if (!attribution || !root?.append || !doc?.createElement) return attribution;

  const badge = doc.createElement("span");
  badge.className = "turn-answer-attribution";
  badge.dataset.answerProvider = attribution.provider;
  badge.dataset.fallbackReason = attribution.fallbackReason;
  badge.textContent = attribution.sourceLabel;
  badge.setAttribute("aria-label", attribution.accessibleLabel);
  badge.title = attribution.accessibleLabel;
  root.append(badge);
  return attribution;
}

/**
 * Browser-side trust boundary for AskEcho rich results. The server already
 * emits a narrow contract, but persisted history and extension events are
 * treated as untrusted again before DOM construction.
 */
export function normalizeAgentExternalRichResults(value) {
  const candidate = value?.rich_results && typeof value.rich_results === "object"
    ? value.rich_results
    : value;
  const source = candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate
    : {};
  const cards = dedupeExternalItems(
    (Array.isArray(source.cards) ? source.cards : [])
      .slice(0, 30)
      .map(normalizeAgentExternalCard)
      .filter(Boolean),
    (item) => item.id || `${item.kind}:${item.url || ""}:${item.title}`,
    12,
  );
  const cardImageUrls = new Set(cards.map((item) => item.image?.imageUrl).filter(Boolean));
  const cardVideoKeys = new Set(cards.map((item) => (
    item.video?.id || item.video?.url || item.video?.coverImage?.imageUrl
  )).filter(Boolean));
  const imagesSource = Array.isArray(source.images)
    ? source.images
    : Array.isArray(source.image_infos) ? source.image_infos : [];
  const images = dedupeExternalItems(
    imagesSource.slice(0, 40).map(normalizeAgentExternalImage).filter(Boolean),
    (item) => item.imageUrl,
    16,
  ).filter((item) => !cardImageUrls.has(item.imageUrl));
  const videosSource = Array.isArray(source.videos)
    ? source.videos
    : Array.isArray(source.video_infos) ? source.video_infos : [];
  const videos = dedupeExternalItems(
    videosSource.slice(0, 20).map(normalizeAgentExternalVideo).filter(Boolean),
    (item) => item.id || item.url || item.coverImage?.imageUrl,
    8,
  ).filter((item) => !cardVideoKeys.has(item.id || item.url || item.coverImage?.imageUrl));
  return Object.freeze({
    schemaVersion: EXTERNAL_RICH_RESULTS_SCHEMA_VERSION,
    cards: Object.freeze(cards),
    images: Object.freeze(images),
    videos: Object.freeze(videos),
    isEmpty: cards.length + images.length + videos.length === 0,
  });
}

/**
 * Render only DOM nodes created by this module. Provider markup is never
 * assigned to innerHTML, and every navigation/media URL is HTTPS-only.
 */
export function mountAgentExternalRichResults(root, value) {
  const results = normalizeAgentExternalRichResults(value);
  const doc = root?.ownerDocument || globalThis.document;
  if (!root?.replaceChildren || !doc?.createElement) return results;
  root.replaceChildren();
  root.classList?.add("agent-external-rich-results");
  root.dataset.schemaVersion = EXTERNAL_RICH_RESULTS_SCHEMA_VERSION;
  root.hidden = results.isEmpty;
  if (results.isEmpty) return results;

  const section = doc.createElement("section");
  section.className = "agent-external-rich-section";
  section.setAttribute("aria-label", "联网图文结果");

  if (results.cards.length) {
    const rail = doc.createElement("div");
    rail.className = "agent-external-card-rail";
    results.cards.forEach((card) => rail.append(createExternalCardNode(doc, card)));
    section.append(rail);
  }
  if (results.images.length) {
    const gallery = doc.createElement("div");
    gallery.className = "agent-external-image-gallery";
    results.images.forEach((item, index) => {
      const figure = doc.createElement("figure");
      figure.className = "agent-external-image";
      const link = createSafeExternalLink(doc, item.sourceUrl || item.imageUrl, "查看图片来源");
      const image = createSafeExternalImage(doc, item, `联网图片 ${index + 1}`);
      if (link) {
        link.replaceChildren(image);
        figure.append(link);
      } else {
        figure.append(image);
      }
      if (item.alt) {
        const caption = doc.createElement("figcaption");
        caption.textContent = item.alt;
        figure.append(caption);
      }
      gallery.append(figure);
    });
    section.append(gallery);
  }
  if (results.videos.length) {
    const rail = doc.createElement("div");
    rail.className = "agent-external-video-rail";
    results.videos.forEach((video) => rail.append(createExternalVideoNode(doc, video)));
    section.append(rail);
  }
  root.append(section);
  return results;
}

function createExternalCardNode(doc, card) {
  const article = doc.createElement("article");
  article.className = `agent-external-card is-${card.kind}`;
  const media = card.image || card.video?.coverImage;
  if (media) article.append(createSafeExternalImage(doc, media, card.title));
  const body = doc.createElement("div");
  body.className = "agent-external-card-copy";
  const meta = doc.createElement("small");
  meta.textContent = [card.siteName, card.authorName].filter(Boolean).join(" · ")
    || externalCardKindLabel(card.kind);
  const title = doc.createElement("strong");
  title.textContent = card.title;
  body.append(meta, title);
  if (card.summary) {
    const summary = doc.createElement("p");
    summary.textContent = card.summary;
    body.append(summary);
  }
  const link = createSafeExternalLink(doc, card.url || card.video?.url, card.kind === "video" ? "打开视频" : "查看来源");
  if (link) body.append(link);
  article.append(body);
  return article;
}

function createExternalVideoNode(doc, video) {
  const article = doc.createElement("article");
  article.className = "agent-external-video";
  const link = createSafeExternalLink(doc, video.url, video.url ? "打开联网视频" : "");
  if (video.coverImage) {
    const image = createSafeExternalImage(doc, video.coverImage, video.title || "联网视频封面");
    if (link) {
      link.replaceChildren(image);
      article.append(link);
    } else {
      article.append(image);
    }
  }
  const body = doc.createElement("div");
  const title = doc.createElement("strong");
  title.textContent = video.title || "联网视频";
  const meta = doc.createElement("small");
  meta.textContent = [video.siteName, video.authorName, formatExternalDuration(video.durationMs)]
    .filter(Boolean)
    .join(" · ");
  body.append(title, meta);
  if (link && !video.coverImage) body.append(link);
  article.append(body);
  return article;
}

function createSafeExternalImage(doc, item, fallbackAlt) {
  const image = doc.createElement("img");
  image.src = item.imageUrl;
  image.alt = item.alt || fallbackAlt || "联网图片";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  if (item.width) image.width = item.width;
  if (item.height) image.height = item.height;
  return image;
}

function createSafeExternalLink(doc, value, label) {
  const url = safeAgentExternalHttpsUrl(value);
  if (!url || !label) return null;
  const link = doc.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.textContent = label;
  return link;
}

function normalizeAgentExternalCard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const providerType = safeAgentExternalToken(value.provider_type || value.card_type || value.type, 48).toLowerCase();
  const body = resolveAgentExternalCardBody(value, providerType);
  const kind = ["video", "image", "article", "reference", "summary"].includes(value.kind)
    ? value.kind
    : normalizeAgentExternalCardKind(providerType);
  const video = kind === "video" ? normalizeAgentExternalVideo(body.video || body) : null;
  const image = normalizeAgentExternalImage(
    body.image || body.cover_image || body.image_info || value.image || value.cover_image,
  );
  const id = safeAgentExternalPlainText(body.id || value.id || value.card_id, 240);
  const url = safeAgentExternalHttpsUrl(body.url || body.link || value.url || value.link) || video?.url || "";
  const title = safeAgentExternalPlainText(body.title || body.name || value.title || value.name, 600)
    || externalCardKindLabel(kind);
  const summary = safeAgentExternalPlainText(
    body.summary || body.description || body.subtitle || body.text
      || value.summary || value.description || value.subtitle,
    2_000,
  );
  if (!id && !url && !image && !video && !summary && !providerType) return null;
  return Object.freeze({
    id,
    kind,
    providerType: providerType || "unknown",
    title,
    summary,
    siteName: safeAgentExternalPlainText(body.site_name || value.site_name, 240),
    sourceType: safeAgentExternalToken(body.source_type || value.source_type, 120),
    authorName: safeAgentExternalPlainText(body.author_name || value.author_name, 240),
    url: url || null,
    image,
    video,
  });
}

function resolveAgentExternalCardBody(value, providerType) {
  const candidates = providerType
    ? [`${providerType}_card`, "card_data", "data"]
    : ["video_card", "image_card", "article_card", "web_card", "card_data", "data"];
  for (const key of candidates) {
    if (!Object.hasOwn(value, key)) continue;
    const candidate = value[key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  return value;
}

function normalizeAgentExternalImage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const imageUrl = safeAgentExternalHttpsUrl(value.image_url || value.imageUrl || value.url || value.src);
  if (!imageUrl) return null;
  return Object.freeze({
    imageUrl,
    sourceUrl: safeAgentExternalHttpsUrl(value.source_url || value.sourceUrl || value.link) || null,
    width: boundedAgentExternalNumber(value.width, 100_000),
    height: boundedAgentExternalNumber(value.height, 100_000),
    alt: safeAgentExternalPlainText(value.alt || value.title || value.caption, 300),
  });
}

function normalizeAgentExternalVideo(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const url = safeAgentExternalHttpsUrl(value.url || value.video_url || value.videoUrl || value.play_url);
  const coverImage = normalizeAgentExternalImage(
    value.cover_image || value.coverImage || value.poster || value.image_info,
  );
  const id = safeAgentExternalPlainText(value.id || value.video_id || value.videoId, 240);
  if (!url && !coverImage && !id) return null;
  return Object.freeze({
    id,
    url: url || null,
    title: safeAgentExternalPlainText(value.title || value.name, 600),
    siteName: safeAgentExternalPlainText(value.site_name || value.siteName, 240),
    sourceType: safeAgentExternalToken(value.source_type || value.sourceType, 120),
    authorName: safeAgentExternalPlainText(value.author_name || value.authorName, 240),
    width: boundedAgentExternalNumber(value.width, 100_000),
    height: boundedAgentExternalNumber(value.height, 100_000),
    durationMs: boundedAgentExternalNumber(value.duration_ms ?? value.durationMs ?? value.duration, 86_400_000),
    coverImage,
  });
}

function normalizeAgentExternalCardKind(value) {
  if (value === "video") return "video";
  if (["image", "image_group", "gallery"].includes(value)) return "image";
  if (["article", "web", "news", "reference"].includes(value)) return "article";
  if (["product", "poi", "travel", "weather"].includes(value)) return "reference";
  return "summary";
}

function externalCardKindLabel(kind) {
  return ({
    video: "联网视频",
    image: "联网图片",
    article: "联网资料",
    reference: "联网信息",
    summary: "联网内容",
  })[kind] || "联网内容";
}

function dedupeExternalItems(items, identity, limit) {
  const output = [];
  const seen = new Set();
  for (const item of items) {
    const key = identity(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

function safeAgentExternalHttpsUrl(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || candidate.length > 4_096) return "";
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || isAgentLocalOrPrivateHostname(parsed.hostname)) return "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isAgentLocalOrPrivateHostname(value) {
  const hostname = String(value || "").replace(/^\[|\]$/gu, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname.includes(":")
    && (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:"))) {
    return true;
  }
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return false;
  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function safeAgentExternalPlainText(value, maxLength) {
  if (value == null) return "";
  return String(value)
    .replace(/<[^>]*>/gu, " ")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function safeAgentExternalToken(value, maxLength) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/gu, "").slice(0, maxLength);
}

function boundedAgentExternalNumber(value, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= maximum ? Math.round(number) : null;
}

function formatExternalDuration(value) {
  if (!value) return "";
  const totalSeconds = Math.max(1, Math.round(value / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function normalizeAgentBlockSyntax(source) {
  const mathBlocks = [];
  const inlineMath = [];
  let text = String(source || "").replace(/\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/gu, (token) => {
    const value = token.startsWith("$$") ? token.slice(2, -2) : token.slice(2, -2);
    const marker = `\uE000agent-math-${mathBlocks.length}\uE001`;
    mathBlocks.push(value);
    return `\n${marker}\n`;
  });
  text = text.replace(/\\\([^\n]*?\\\)|\$(?!\$)[^$\n]+\$/gu, (token) => {
    const marker = `\uE002agent-inline-math-${inlineMath.length}\uE003`;
    inlineMath.push(token);
    return marker;
  });

  text = text
    .replace(/([^\n])\s+(?=#{1,6}\s+)/gu, "$1\n")
    .replace(/([^\n])\s+((?:-{3,}|\*{3,}|_{3,}))(?=\s|$)/gu, "$1\n$2\n")
    .replace(/([^\n])[\t ]+(?=(?:[-*+]\s+|\d{1,4}[.)]\s+))/gu, (match, previous) => {
      return previous === "#" ? match : `${previous}\n`;
    });
  text = text.replace(/\uE002agent-inline-math-(\d+)\uE003/gu, (_marker, index) => {
    return inlineMath[Number(index)] || "";
  });
  return { text, mathBlocks };
}

function unwrapAccidentalDocumentEmphasis(source) {
  const trimmed = String(source || "").trim();
  if (
    trimmed.startsWith("**")
    && trimmed.endsWith("**")
    && /(?:#{1,6}\s+|(?:^|\s)(?:-{3,}|\*{3,})(?:\s|$)|(?:^|\s)\d{1,3}[.)]\s+)/u.test(trimmed)
  ) {
    return trimmed.slice(2, -2).trim();
  }
  return source;
}

function appendInlineNodes(doc, parent, tokens) {
  tokens.forEach((token) => {
    if (token.type === "text") {
      parent.append(doc.createTextNode(token.value));
      return;
    }
    const tagName = token.type === "strong" ? "strong" : token.type === "code" ? "code" : "span";
    const node = doc.createElement(tagName);
    if (token.type === "math") {
      node.className = "agent-answer-math";
      renderMathInto(node, token.tex, token.value);
    } else {
      node.textContent = token.value;
    }
    parent.append(node);
  });
}

function createMathDescriptor(value) {
  const tex = String(value || "").trim();
  const descriptor = { type: "math", value: formatAgentMath(tex) };
  // Keep the public parse shape backward-compatible while retaining the
  // original TeX for KaTeX. Existing consumers that serialize the parsed
  // answer continue to receive only the readable fallback value.
  Object.defineProperty(descriptor, "tex", {
    value: tex,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return descriptor;
}

function renderMathInto(node, tex, fallback, { displayMode = false } = {}) {
  const katex = node?.ownerDocument?.defaultView?.katex || globalThis.katex;
  if (!node || typeof katex?.render !== "function" || !tex) {
    if (node) node.textContent = fallback;
    return false;
  }
  try {
    katex.render(tex, node, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: "warn",
      output: "htmlAndMathml",
      maxExpand: 1_000,
      maxSize: 20,
    });
    node.dataset.mathRenderer = "katex";
    return true;
  } catch {
    node.textContent = fallback;
    node.dataset.mathRenderer = "fallback";
    return false;
  }
}

function toScript(value, characterMap, keepUnsupported) {
  const input = String(value || "");
  const converted = [...input].map((character) => characterMap[character] || "").join("");
  if (converted.length === input.length) return converted;
  return keepUnsupported ? `^(${input})` : `_(${input})`;
}
