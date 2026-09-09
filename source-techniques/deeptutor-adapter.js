/**
 * DeepTutor source-first adapter.
 *
 * The deterministic Book Engine behaviours in this module are faithful
 * JavaScript ports of the Apache-2.0 DeepTutor sources listed in
 * DEEPTUTOR_SOURCE_PROVENANCE. The small source-section compiler is local:
 * upstream DeepTutor uses an LLM-backed SourceExplorer/SpineSynthesizer for
 * semantic chapter synthesis, so this adapter never claims that a heuristic
 * split is equivalent to that agent.
 *
 * No model client is accepted or called here. The result contains:
 *   - `material`: the existing local DeepTutor technique contract;
 *   - `claims`: source-grounded claims used by that material;
 *   - `book`: DeepTutor Book Engine-shaped chapters and deterministic overview;
 *   - `provenance`: an explicit source/license/port boundary.
 */

const MAX_SOURCE_LENGTH = 20_000;
const MAX_CHAPTERS = 6;

export const DEEPTUTOR_SOURCE_PROVENANCE = Object.freeze({
  upstream_repo: "https://github.com/HKUDS/DeepTutor",
  source_revision: "47d05809ea5d19e8b1390d4b42402302c37709bb",
  upstream_release: "v1.5.5",
  license: "Apache-2.0",
  copyright:
    "2025 Data Intelligence Lab, The University of Hong Kong",
  source_files: Object.freeze([
    Object.freeze({
      path: "deeptutor/book/blocks/concept_graph.py",
      symbols: Object.freeze(["_safe_id", "_escape_label", "render_mermaid"]),
      use: "faithful JavaScript port"
    }),
    Object.freeze({
      path: "deeptutor/book/agents/spine_synthesizer.py",
      symbols: Object.freeze(["_build_chapter_map"]),
      use: "faithful JavaScript port"
    }),
    Object.freeze({
      path: "deeptutor/book/engine.py",
      symbols: Object.freeze([
        "_ensure_overview_chapter",
        "_materialize_overview_page"
      ]),
      use: "JavaScript adaptation of deterministic overview materialisation"
    }),
    Object.freeze({
      path: "deeptutor/book/agents/page_planner.py",
      symbols: Object.freeze(["_TEMPLATES_V2", "_static_plan"]),
      use: "faithful JavaScript port of the concept template"
    })
  ]),
  local_adaptation: Object.freeze({
    component: "deterministic source-section compiler",
    reason:
      "DeepTutor's semantic SourceExplorer/SpineSynthesizer is LLM-backed and its Python runtime is not embedded in this Node application.",
    llm_used: false
  })
});

const CONCEPT_BLOCK_TEMPLATE = Object.freeze([
  Object.freeze({
    type: "section",
    params: Object.freeze({ role: "definition", target_words: 1400 })
  }),
  Object.freeze({
    type: "figure",
    params: Object.freeze({
      variant: "mindmap",
      transition_in: "Map the related concepts"
    })
  }),
  Object.freeze({
    type: "section",
    params: Object.freeze({ role: "examples", target_words: 1200 })
  }),
  Object.freeze({
    type: "flash_cards",
    params: Object.freeze({
      count: 5,
      transition_in: "Hooks for recall"
    })
  }),
  Object.freeze({
    type: "callout",
    params: Object.freeze({
      variant: "common_pitfall",
      transition_in: "Watch out for these"
    })
  }),
  Object.freeze({
    type: "figure",
    params: Object.freeze({
      variant: "comparison",
      transition_in: "Side-by-side comparison"
    })
  }),
  Object.freeze({
    type: "quiz",
    params: Object.freeze({
      num_questions: 3,
      transition_in: "Self-check"
    })
  })
]);

/**
 * Produce one source-grounded DeepTutor material without invoking an LLM.
 *
 * @param {{
 *   source_text: string,
 *   source_id?: string,
 *   title?: string,
 *   subject?: string,
 *   grade_band?: string,
 *   language?: string
 * }} source
 * @returns {{
 *   material: {
 *     concept_graph: object,
 *     blocks: object[],
 *     flashcards: object[],
 *     a2ui_projection: object
 *   },
 *   claims: object[],
 *   book: object,
 *   provenance: object
 * }}
 */
export function generateDeepTutorSourceMaterial(source) {
  const normalized = normalizeSource(source);
  const sections = deriveSourceSections(normalized.source_text);
  const zh = isChinese(normalized);
  const title = normalizeTitle(
    normalized.title || inferTitle(normalized.source_text, sections),
    zh
  );
  const sourceRef = normalized.source_id || "inline_source";

  const claims = sections.map((section, index) => ({
    id: claimId(index),
    text: clipText(
      section.content.length >= 8 ? section.content : section.sourceSupport,
      600
    ),
    source_support: clipVerbatim(section.sourceSupport, 500)
  }));

  const chapters = sections.map((section, index) => {
    const chapterTitle = uniqueSectionTitle(sections, index);
    return {
      id: chapterId(index),
      title: chapterTitle,
      learning_objectives: [
        zh
          ? `能够复述并解释“${clipText(chapterTitle, 48)}”`
          : `Explain “${clipText(chapterTitle, 48)}” in your own words`
      ],
      content_type: "concept",
      source_anchors: [
        {
          kind: "manual",
          ref: sourceRef,
          snippet: clipVerbatim(section.sourceSupport, 300)
        }
      ],
      prerequisites: [],
      summary: clipText(section.content, 320),
      order: index,
      covers: [conceptId(index)],
      blocks: createStaticConceptPlan({
        chapterTitle,
        chapterSummary: clipText(section.content, 320),
        objectives: [
          zh
            ? `理解${clipText(chapterTitle, 48)}`
            : `Understand ${clipText(chapterTitle, 48)}`
        ],
        anchors: [
          {
            kind: "manual",
            ref: sourceRef,
            snippet: clipVerbatim(section.sourceSupport, 300)
          }
        ]
      })
    };
  });

  const rawConceptGraph = {
    nodes: chapters.map((chapter, index) => ({
      id: conceptId(index),
      label: chapter.title,
      chapter_id: chapter.id,
      description: chapter.summary,
      weight: 1
    })),
    edges: []
  };
  const chapterMap = buildChapterMap(chapters, rawConceptGraph, title);
  const overview = materializeOverview({
    title,
    language: zh ? "zh" : "en",
    chapters,
    conceptGraph: chapterMap
  });

  return {
    material: createCompatibleMaterial({
      title,
      zh,
      sections,
      claims,
      chapterMap
    }),
    claims,
    book: {
      format: "deeptutor.book.source-first.v1",
      title,
      language: zh ? "zh" : "en",
      source_id: normalized.source_id || null,
      spine: {
        chapters,
        concept_graph: chapterMap,
        exploration_summary:
          "Local deterministic source sections; no semantic LLM exploration was run."
      },
      overview
    },
    provenance: structuredClone(DEEPTUTOR_SOURCE_PROVENANCE)
  };
}

/**
 * Faithful port of DeepTutor's deterministic Mermaid renderer.
 */
export function renderDeepTutorMermaid(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (nodes.length === 0) {
    return 'graph TD\n  empty["(no concepts yet)"]';
  }

  const chapterMode = nodes.some((node) => Boolean(node?.chapter_id));
  const used = new Set();
  const idMap = new Map();
  const lines = ["graph TD"];
  let chapterSequence = 0;

  for (const node of nodes) {
    const safeId = safeMermaidId(node?.id || node?.label, used);
    idMap.set(node?.id, safeId);

    if (chapterMode && node?.chapter_id) {
      chapterSequence += 1;
      const number = String(chapterSequence).padStart(2, "0");
      const label = escapeMermaidLabel(node?.label, 28);
      lines.push(`  ${safeId}["${number} · ${label}"]`);
    } else if (chapterMode && !node?.chapter_id) {
      const label = escapeMermaidLabel(node?.label, 36);
      lines.push(`  ${safeId}(["${label}"])`);
    } else {
      lines.push(`  ${safeId}["${escapeMermaidLabel(node?.label, 48)}"]`);
    }
  }

  const arrows = {
    depends_on: "-->",
    extends: "==>",
    related: "-.->"
  };
  for (const edge of edges) {
    if (!idMap.has(edge?.src) || !idMap.has(edge?.dst)) continue;
    const arrow = arrows[edge?.relation] || "-->";
    lines.push(`  ${idMap.get(edge.src)} ${arrow} ${idMap.get(edge.dst)}`);
  }

  return lines.join("\n");
}

function createCompatibleMaterial({
  title,
  zh,
  sections,
  claims,
  chapterMap
}) {
  const nodes = chapterMap.nodes.map((node, index) => {
    const isRoot = !node.chapter_id;
    return {
      id: isRoot ? "dt_root" : `dt_node_${String(index).padStart(2, "0")}`,
      label: clipText(node.label, 80),
      summary: clipText(
        isRoot
          ? sections.map((section) => section.content).join(" ")
          : node.description,
        320
      ),
      claim_ids: isRoot
        ? claims.slice(0, 6).map((claim) => claim.id)
        : [claims.find((claim, claimIndex) => chapterId(claimIndex) === node.chapter_id)?.id]
            .filter(Boolean)
    };
  });
  const nodeIdByBookNodeId = new Map(
    chapterMap.nodes.map((node, index) => [node.id, nodes[index].id])
  );
  const edges = chapterMap.edges
    .filter(
      (edge) =>
        nodeIdByBookNodeId.has(edge.src) && nodeIdByBookNodeId.has(edge.dst)
    )
    .map((edge, index) => ({
      id: `dt_edge_${String(index + 1).padStart(2, "0")}`,
      from: nodeIdByBookNodeId.get(edge.src),
      to: nodeIdByBookNodeId.get(edge.dst),
      relation: edge.relation === "related" ? (zh ? "包含章节" : "contains") : edge.relation
    }));

  const summaryContent = clipText(
    sections.map((section) => section.content).join(" "),
    1200
  );
  const explanationBlocks = sections.slice(0, 6).map((section, index) => ({
    id: `dt_block_explanation_${String(index + 1).padStart(2, "0")}`,
    type: "explanation",
    title: uniqueSectionTitle(sections, index),
    content: clipText(section.content, 1200),
    claim_ids: [claims[index].id]
  }));
  const keyPoints = sections
    .slice(0, 5)
    .map((section) => clipText(section.content, 180));

  return {
    concept_graph: {
      root_id: nodes[0].id,
      nodes,
      edges
    },
    blocks: [
      {
        id: "dt_block_summary",
        type: "summary",
        title: zh ? "内容概览" : "Overview",
        content: summaryContent,
        claim_ids: claims.slice(0, 6).map((claim) => claim.id)
      },
      ...explanationBlocks
    ],
    flashcards: sections.slice(0, Math.max(2, sections.length)).map((section, index) => ({
      id: `dt_flashcard_${String(index + 1).padStart(2, "0")}`,
      front: zh
        ? `“${uniqueSectionTitle(sections, index)}”讲了什么？`
        : `What does “${uniqueSectionTitle(sections, index)}” explain?`,
      back: clipText(section.content, 600),
      claim_ids: [claims[index].id]
    })),
    a2ui_projection: {
      title: clipText(title, 120),
      summary: clipText(sections[0].content, 320),
      body: clipText(summaryContent, 900),
      key_points: keyPoints.slice(0, Math.max(2, keyPoints.length)),
      callout: zh
        ? "按概念图顺序阅读，也可以从任一章节切入。"
        : "Follow the concept map in order, or enter from any chapter."
    }
  };
}

function createStaticConceptPlan({
  chapterTitle,
  chapterSummary,
  objectives,
  anchors
}) {
  return CONCEPT_BLOCK_TEMPLATE.map((template) => {
    const params = {
      chapter_title: chapterTitle,
      chapter_summary: chapterSummary,
      objectives: [...objectives],
      anchors: structuredClone(anchors),
      ...template.params
    };
    const transition = params.transition_in || "";
    delete params.transition_in;
    return {
      type: template.type,
      status: "pending",
      params,
      metadata: transition ? { transition_in: transition } : {}
    };
  });
}

function buildChapterMap(chapters, rawGraph, bookTitle) {
  const nodes = [];
  const chapterSlug = new Map();
  const titleSlug = new Map();
  const conceptSlug = new Map();
  const used = new Set();

  for (const [index, chapter] of chapters.entries()) {
    const slug = uniqueSlug(slugify(chapter.title) || `ch_${index + 1}`, used);
    chapterSlug.set(chapter.id, slug);
    titleSlug.set(chapter.title.trim().toLocaleLowerCase(), slug);
    for (const concept of chapter.covers || []) {
      if (!conceptSlug.has(concept)) conceptSlug.set(concept, slug);
    }
    nodes.push({
      id: slug,
      label: chapter.title,
      chapter_id: chapter.id,
      description: chapter.summary || "",
      weight: 1
    });
  }

  const edges = [];
  const edgePairs = new Set();
  for (const edge of rawGraph.edges || []) {
    if (edge.relation !== "depends_on") continue;
    const src = conceptSlug.get(edge.src);
    const dst = conceptSlug.get(edge.dst);
    if (!src || !dst || src === dst) continue;
    const pair = `${src}\u0000${dst}`;
    if (edgePairs.has(pair)) continue;
    edgePairs.add(pair);
    edges.push({
      src,
      dst,
      relation: "depends_on",
      rationale: edge.rationale || ""
    });
  }

  for (const chapter of chapters) {
    const destination = chapterSlug.get(chapter.id);
    if (!destination) continue;
    for (const prerequisite of chapter.prerequisites || []) {
      const source = titleSlug.get(
        String(prerequisite || "").trim().toLocaleLowerCase()
      );
      if (!source || source === destination) continue;
      const pair = `${source}\u0000${destination}`;
      if (edgePairs.has(pair)) continue;
      edgePairs.add(pair);
      edges.push({
        src: source,
        dst: destination,
        relation: "depends_on",
        rationale: ""
      });
    }
  }

  const incoming = new Set(edges.map((edge) => edge.dst));
  const roots = nodes.filter((node) => !incoming.has(node.id));
  if (roots.length > 1 && bookTitle) {
    const rootId = uniqueSlug(slugify(bookTitle) || "book", used);
    nodes.unshift({
      id: rootId,
      label: bookTitle,
      chapter_id: "",
      description: "",
      weight: 1
    });
    for (const root of roots) {
      edges.push({
        src: rootId,
        dst: root.id,
        relation: "related",
        rationale: ""
      });
    }
  }

  return { nodes, edges };
}

function materializeOverview({ title, language, chapters, conceptGraph }) {
  const zh = language === "zh";
  const overviewChapter = {
    id: "dt_overview",
    title: zh ? "本书导览" : "How to read this book",
    learning_objectives: zh
      ? [
          "了解整本书的章节脉络",
          "掌握各章之间的概念依赖关系",
          "选择最合适的阅读顺序"
        ]
      : [
          "See the full chapter map at a glance",
          "Understand how concepts depend on each other",
          "Pick the reading path that fits your goals"
        ],
    content_type: "overview",
    summary: zh
      ? "自动生成的概念图与章节索引，作为本书的入口。"
      : "Auto-generated overview of the book's concept graph and chapter index.",
    order: 0,
    auto_overview: true
  };
  const chapterIndex = chapters.map((chapter, index) => ({
    id: chapter.id,
    title: chapter.title,
    summary: chapter.summary,
    objectives: [...chapter.learning_objectives],
    order: index + 1,
    content_type: chapter.content_type,
    page_id: ""
  }));
  const intro = zh
    ? `# ${title}\n\n下方的概念图展示了本书 ${conceptGraph.nodes.length} 个核心概念以及它们之间的依赖关系；再下方是 ${chapterIndex.length} 个章节的入口。你可以按从上到下的顺序阅读，也可以根据自己的兴趣或先验知识选择切入点。`
    : `# ${title}\n\nThe diagram below maps the ${conceptGraph.nodes.length} core concepts in this book and how they depend on each other. The chapter index that follows lists all ${chapterIndex.length} chapters — read top-to-bottom for the recommended path, or jump straight to whatever you're most curious about.`;
  const indexMarkdown =
    (zh ? "## 章节索引\n\n" : "## Chapter index\n\n") +
    chapterIndex
      .map((entry) => `- **${entry.title}**${entry.summary ? ` — ${entry.summary}` : ""}`)
      .join("\n");

  return {
    chapter: overviewChapter,
    blocks: [
      {
        type: "text",
        status: "ready",
        title: zh ? "如何阅读这本书" : "How to read this book",
        params: { role: "overview_intro" },
        payload: { content: intro, format: "markdown" }
      },
      {
        type: "concept_graph",
        status: "ready",
        title: zh ? "概念图" : "Concept map",
        params: {
          concept_graph: structuredClone(conceptGraph),
          chapter_index: structuredClone(chapterIndex)
        },
        payload: {
          render_type: "concept_graph",
          code: {
            language: "mermaid",
            content: renderDeepTutorMermaid(conceptGraph)
          },
          graph: structuredClone(conceptGraph),
          index: {
            chapters: structuredClone(chapterIndex),
            node_to_chapter: Object.fromEntries(
              conceptGraph.nodes
                .filter((node) => node.chapter_id)
                .map((node) => [node.id, node.chapter_id])
            )
          }
        },
        metadata: {
          node_count: conceptGraph.nodes.length,
          edge_count: conceptGraph.edges.length
        }
      },
      {
        type: "text",
        status: "ready",
        title: zh ? "章节索引" : "Chapter index",
        params: { role: "chapter_index" },
        payload: { content: indexMarkdown, format: "markdown" }
      }
    ]
  };
}

function normalizeSource(source) {
  if (!isPlainObject(source)) {
    throw new TypeError("source must be a plain object");
  }
  if (
    typeof source.source_text !== "string" ||
    source.source_text.trim().length < 20 ||
    source.source_text.trim().length > MAX_SOURCE_LENGTH
  ) {
    throw new RangeError(
      `source.source_text must contain 20-${MAX_SOURCE_LENGTH} characters`
    );
  }
  const normalized = { source_text: source.source_text.trim() };
  for (const [field, limit] of [
    ["source_id", 96],
    ["title", 160],
    ["subject", 80],
    ["grade_band", 80],
    ["language", 40]
  ]) {
    if (source[field] === undefined) continue;
    if (
      typeof source[field] !== "string" ||
      !source[field].trim() ||
      source[field].trim().length > limit
    ) {
      throw new TypeError(
        `source.${field} must be a non-empty string no longer than ${limit} characters`
      );
    }
    normalized[field] = source[field].trim();
  }
  return normalized;
}

function deriveSourceSections(sourceText) {
  let slices = markdownHeadingSlices(sourceText);
  if (slices.length < 2) slices = paragraphSlices(sourceText);
  if (slices.length < 2) slices = punctuationSlices(sourceText, /[。！？!?；;]/u);
  if (slices.length < 2) slices = punctuationSlices(sourceText, /[，,:：、]/u);
  if (slices.length < 2) slices = splitSingleSlice(sourceText);
  slices = packSlices(sourceText, slices, MAX_CHAPTERS);

  return slices.map((slice, index) => {
    const sourceSupport = sourceText.slice(slice.start, slice.end).trim();
    const heading = slice.heading ? cleanHeading(slice.heading) : "";
    const content = cleanContent(sourceSupport);
    return {
      heading,
      content: ensureMinimumText(content, `Section ${index + 1}`),
      sourceSupport: ensureMinimumText(sourceSupport, content)
    };
  });
}

function markdownHeadingSlices(text) {
  const matches = [...text.matchAll(/^(#{1,6})[ \t]+(.+)$/gmu)];
  if (matches.length === 0) return [];
  const slices = [];
  const firstStart = matches[0].index;
  if (text.slice(0, firstStart).trim().length >= 4) {
    slices.push({ start: 0, end: firstStart, heading: "" });
  }
  for (const [index, match] of matches.entries()) {
    slices.push({
      start: match.index,
      end: matches[index + 1]?.index ?? text.length,
      heading: match[2].trim()
    });
  }
  return slices.filter((slice) => text.slice(slice.start, slice.end).trim().length >= 4);
}

function paragraphSlices(text) {
  const slices = [];
  const separator = /\n[ \t]*\n+/gu;
  let start = 0;
  for (const match of text.matchAll(separator)) {
    if (text.slice(start, match.index).trim().length >= 4) {
      slices.push({ start, end: match.index, heading: "" });
    }
    start = match.index + match[0].length;
  }
  if (text.slice(start).trim().length >= 4) {
    slices.push({ start, end: text.length, heading: "" });
  }
  return slices;
}

function punctuationSlices(text, punctuationPattern) {
  const slices = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!punctuationPattern.test(text[index])) continue;
    const end = index + 1;
    if (text.slice(start, end).trim().length >= 4) {
      slices.push({ start, end, heading: "" });
    }
    start = end;
  }
  if (text.slice(start).trim().length >= 4) {
    slices.push({ start, end: text.length, heading: "" });
  }
  return slices;
}

function splitSingleSlice(text) {
  const trimmedStart = text.search(/\S/u);
  const trimmedEnd = text.length - (text.match(/\s*$/u)?.[0].length || 0);
  const start = Math.max(0, trimmedStart);
  const length = trimmedEnd - start;
  const middle = start + Math.floor(length / 2);
  const split = nearestWhitespace(text, middle, start + 4, trimmedEnd - 4);
  return [
    { start, end: split, heading: "" },
    { start: split, end: trimmedEnd, heading: "" }
  ];
}

function nearestWhitespace(text, middle, minimum, maximum) {
  for (let offset = 0; offset < 40; offset += 1) {
    for (const position of [middle + offset, middle - offset]) {
      if (
        position >= minimum &&
        position <= maximum &&
        /\s/u.test(text[position] || "")
      ) {
        return position;
      }
    }
  }
  return Math.min(maximum, Math.max(minimum, middle));
}

function packSlices(text, slices, maximum) {
  if (slices.length <= maximum) return slices;
  const packed = [];
  for (let bucket = 0; bucket < maximum; bucket += 1) {
    const startIndex = Math.floor((bucket * slices.length) / maximum);
    const endIndex = Math.floor(((bucket + 1) * slices.length) / maximum) - 1;
    packed.push({
      start: slices[startIndex].start,
      end: slices[endIndex].end,
      heading: slices[startIndex].heading || ""
    });
  }
  return packed.filter((slice) => text.slice(slice.start, slice.end).trim());
}

function uniqueSectionTitle(sections, index) {
  const base = clipText(
    sections[index].heading || inferSectionTitle(sections[index].content, index),
    80
  );
  const previous = sections.slice(0, index).map((section, previousIndex) =>
    clipText(
      section.heading || inferSectionTitle(section.content, previousIndex),
      80
    ).toLocaleLowerCase()
  );
  if (!previous.includes(base.toLocaleLowerCase())) return base;
  return clipText(`${base} ${index + 1}`, 80);
}

function inferSectionTitle(content, index) {
  const compact = cleanContent(content);
  const prefix = compact.split(/[：:，,。.!！？?；;]/u)[0]?.trim() || "";
  if (prefix.length >= 2 && prefix.length <= 28) return prefix;
  const words = compact.split(/\s+/u).filter(Boolean);
  if (words.length > 1) return words.slice(0, 6).join(" ");
  return clipText(compact, 24) || `Section ${index + 1}`;
}

function inferTitle(sourceText, sections) {
  const heading = markdownHeadingSlices(sourceText)[0]?.heading;
  if (heading) return cleanHeading(heading);
  const first = sections[0]?.content || sourceText;
  const colonPrefix = first.split(/[：:]/u)[0]?.trim();
  if (colonPrefix && colonPrefix.length >= 2 && colonPrefix.length <= 32) {
    return colonPrefix;
  }
  return inferSectionTitle(first, 0);
}

function normalizeTitle(value, zh) {
  const clipped = clipText(cleanHeading(value), 120);
  if (clipped.length >= 2) return clipped;
  return zh ? `${clipped || "知识"}学习` : `${clipped || "Topic"} guide`;
}

function isChinese(source) {
  if (source.language) return /^zh(?:-|$)/iu.test(source.language);
  return /[\u3400-\u9fff]/u.test(source.source_text);
}

function cleanHeading(value) {
  return String(value || "")
    .replace(/^#{1,6}[ \t]+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function cleanContent(value) {
  return String(value || "")
    .replace(/^#{1,6}[ \t]+[^\r\n]+\r?\n?/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function clipText(value, limit) {
  const clean = String(value || "").replace(/\s+/gu, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function clipVerbatim(value, limit) {
  const clean = String(value || "").trim();
  return clean.length <= limit ? clean : clean.slice(0, limit).trimEnd();
}

function ensureMinimumText(value, fallback) {
  const text = String(value || "").trim();
  if (text.length >= 4) return text;
  return `${text}${String(fallback || "content")}`.slice(0, 500);
}

function slugify(value) {
  return [...String(value || "").trim()]
    .map((character) =>
      /[\p{L}\p{N}]/u.test(character) ? character.toLocaleLowerCase() : "_"
    )
    .join("")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48) || "concept";
}

function uniqueSlug(base, used) {
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 44)}_${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function safeMermaidId(value, used) {
  const cleaned =
    [...String(value || "n")]
      .map((character) =>
        /[\p{L}\p{N}]/u.test(character) ? character : "_"
      )
      .join("")
      .replace(/^_+|_+$/gu, "") || "n";
  let candidate = cleaned.slice(0, 32);
  let suffix = 1;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${cleaned.slice(0, 30)}_${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

function escapeMermaidLabel(value, maximum) {
  let cleaned = String(value || "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/"/gu, "'");
  if (cleaned.length > maximum) {
    cleaned = `${cleaned.slice(0, maximum - 1)}…`;
  }
  return cleaned || "concept";
}

function claimId(index) {
  return `dt_claim_${String(index + 1).padStart(2, "0")}`;
}

function chapterId(index) {
  return `dt_ch_${String(index + 1).padStart(2, "0")}`;
}

function conceptId(index) {
  return `dt_concept_${String(index + 1).padStart(2, "0")}`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
