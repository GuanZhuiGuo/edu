import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  extractAgentVisualReferences,
  formatAgentMath,
  mountAgentAnswerAttribution,
  normalizeAgentAnswerAttribution,
  normalizeAgentExternalRichResults,
  parseAgentAnswer,
  parseAgentInline
} from "../public/agent-answer-renderer.js";

const clientPath = new URL("../public/client.js", import.meta.url);

test("restores structure when the model compresses a complete Markdown lesson into one line", () => {
  const answer = "**勾股定理的使用方法 结论：先判断是否为直角三角形。 #### 1. 适用条件与核心公式 - 前提：仅适用于直角三角形。 - 公式：两直角边为 \\(a\\)、\\(b\\)，斜边为 \\(c\\)。 \\[a^2 + b^2 = c^2\\] #### 2. 常见应用思路 1. 直接求边长 2. 利用逆定理判断 [visual:M4-GE-TRI-10] --- ### 选择题练习 **题目**：已知一个直角三角形的两条直角边。**";
  const parsed = parseAgentAnswer(answer);

  assert.deepEqual(parsed.visualRefs, ["visual:M4-GE-TRI-10"]);
  assert.equal(parsed.text.includes("[visual:"), false);
  assert.deepEqual(
    parsed.blocks.map((block) => block.type),
    ["paragraph", "heading", "list", "math", "heading", "list", "divider", "heading"]
  );
  assert.equal(parsed.blocks[1].level, 4);
  assert.equal(parsed.blocks[2].ordered, false);
  assert.equal(parsed.blocks[2].items.length, 2);
  assert.equal(parsed.blocks[3].value, "a² + b² = c²");
  assert.equal(parsed.blocks[5].ordered, true);
  assert.equal(parsed.blocks[5].items.length, 2);
  assert.deepEqual(parsed.blocks[7].inline.at(-2), { type: "strong", value: "题目" });

  const visibleText = parsed.blocks
    .flatMap((block) => block.inline || block.items?.flat() || [])
    .map((token) => token.value)
    .join("");
  assert.equal(visibleText.includes("**勾股"), false);
  assert.equal(visibleText.endsWith("**"), false);
});

test("protects inline math while recovering inline list boundaries", () => {
  const parsed = parseAgentAnswer(
    "#### 求边长 - 已知斜边和直角边：\\(a = \\sqrt{c^2 - b^2}\\) - 代入后检查结果"
  );

  assert.deepEqual(parsed.blocks.map((block) => block.type), ["heading", "list"]);
  assert.equal(parsed.blocks[1].items.length, 2);
  assert.deepEqual(parsed.blocks[1].items[0].at(-1), {
    type: "math",
    value: "a = √(c² - b²)"
  });
});

test("formats common LaTeX into readable mathematical text", () => {
  assert.equal(
    formatAgentMath("c = \\sqrt{a^2 + b^2} \\leq 10"),
    "c = √(a² + b²) ≤ 10"
  );
  assert.equal(formatAgentMath("\\frac{1}{2} \\pi r^2"), "(1) / (2) π r²");
  assert.equal(formatAgentMath("x_1 \\neq x_2"), "x₁ ≠ x₂");
  assert.equal(formatAgentMath("y=-x^2+4x-3"), "y=-x²+4x-3");
  assert.equal(formatAgentMath("x^{12}+x_{10}"), "x¹²+x₁₀");
  assert.equal(formatAgentMath("\\left| -\\frac{6}{5} \\right|"), "| -(6) / (5) |");
  assert.equal(formatAgentMath("\\boldsymbol{x}"), "x");
});

test("retains original TeX for KaTeX without changing the public parse shape", () => {
  const parsed = parseAgentAnswer(
    "行内 $\\left| -\\frac{6}{5} \\right|$\n\n$$\\frac{6}{5}$$"
  );
  const inlineMath = parsed.blocks[0].inline.find((token) => token.type === "math");
  const blockMath = parsed.blocks[1];

  assert.equal(inlineMath.tex, "\\left| -\\frac{6}{5} \\right|");
  assert.equal(blockMath.tex, "\\frac{6}{5}");
  assert.equal(Object.keys(inlineMath).includes("tex"), false);
  assert.equal(Object.keys(blockMath).includes("tex"), false);
  assert.deepEqual(inlineMath, { type: "math", value: "| -(6) / (5) |" });
});

test("converts legacy details markup into visible answer structure without rendering raw tags", () => {
  const parsed = parseAgentAnswer(
    "<details><summary>点击查看答案与解析</summary>**答案：C**\n解析过程</details>"
  );

  assert.deepEqual(parsed.blocks.map((block) => block.type), ["heading", "paragraph"]);
  assert.equal(parsed.blocks[0].inline[0].value, "点击查看答案与解析");
  assert.equal(parsed.blocks[1].inline[0].type, "strong");
  assert.equal(parsed.text.includes("<details>"), false);
  assert.equal(parsed.text.includes("<summary>"), false);
});

test("extracts unique trusted-shape visual references without interpreting arbitrary HTML", () => {
  const extracted = extractAgentVisualReferences(
    "<img src=x onerror=alert(1)> [visual:M4-GE-TRI-10] [visual:M4-GE-TRI-10] [visual:<script>]"
  );
  assert.deepEqual(extracted.visualRefs, ["visual:M4-GE-TRI-10"]);
  assert.equal(extracted.text.includes("<img src=x onerror=alert(1)>"), true);
  assert.equal(extracted.text.includes("[visual:<script>]"), true);

  const tokens = parseAgentInline(extracted.text);
  assert.equal(tokens[0].type, "text");
  assert.equal(tokens[0].value.includes("<img src=x onerror=alert(1)>"), true);
});

test("accepts only the controlled Doubao Aixue answer attribution contract", () => {
  assert.deepEqual(
    normalizeAgentAnswerAttribution({
      schema_version: "answer-attribution@1.0",
      provider: "doubao_aixue",
      source_label: "<img src=x onerror=alert(1)>",
      fallback_reason: "curriculum_no_match",
    }),
    {
      schemaVersion: "answer-attribution@1.0",
      provider: "doubao_aixue",
      sourceLabel: "内容来自豆包爱学",
      accessibleLabel: "本条回答由豆包爱学补充，不是当前所选教材原文",
      fallbackReason: "curriculum_no_match",
    },
  );

  assert.equal(normalizeAgentAnswerAttribution({
    schema_version: "answer-attribution@1.0",
    provider: "uncontrolled_provider",
    fallback_reason: "curriculum_no_match",
  }), null);
  assert.equal(normalizeAgentAnswerAttribution({
    schema_version: "answer-attribution@0.9",
    provider: "doubao_aixue",
    fallback_reason: "curriculum_no_match",
  }), null);
  assert.equal(normalizeAgentAnswerAttribution({
    schema_version: "answer-attribution@1.0",
    provider: "doubao_aixue",
    fallback_reason: "arbitrary_reason",
  }), null);
});

test("recognizes Doubao Aixue attribution on the external grounding envelope", () => {
  const attribution = normalizeAgentAnswerAttribution({
    mode: "external_web",
    provider: "doubao_aixue",
    source_label: "伪造来源名",
    fallback_reason: "curriculum_no_match",
    references: [],
  });

  assert.equal(attribution.provider, "doubao_aixue");
  assert.equal(attribution.sourceLabel, "内容来自豆包爱学");
});

test("mounts attribution as text and ignores provider-controlled HTML", () => {
  const appended = [];
  let removed = false;
  const badge = {
    className: "",
    dataset: {},
    attributes: new Map(),
    text: "",
    set textContent(value) { this.text = String(value); },
    get textContent() { return this.text; },
    set innerHTML(_value) { throw new Error("answer attribution must not use innerHTML"); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
  };
  const root = {
    ownerDocument: { createElement: () => badge },
    querySelector: () => ({ remove: () => { removed = true; } }),
    append: (node) => appended.push(node),
  };

  const attribution = mountAgentAnswerAttribution(root, {
    schema_version: "answer-attribution@1.0",
    provider: "doubao_aixue",
    source_label: "<svg onload=alert(1)>",
    fallback_reason: "curriculum_no_match",
  });

  assert.equal(removed, true);
  assert.equal(attribution.sourceLabel, "内容来自豆包爱学");
  assert.equal(appended.length, 1);
  assert.equal(badge.textContent, "内容来自豆包爱学");
  assert.equal(badge.textContent.includes("<svg"), false);
  assert.equal(badge.dataset.answerProvider, "doubao_aixue");
  assert.equal(badge.attributes.get("aria-label"), "本条回答由豆包爱学补充，不是当前所选教材原文");
});

test("user turns use the safe math renderer without promoting visual directives to cards", async () => {
  const parsed = parseAgentAnswer(
    "我算出 \\(c = \\sqrt{a^2 + b^2}\\) <img src=x onerror=alert(1)> [visual:M4-GE-TRI-10]"
  );
  const math = parsed.blocks[0].inline.find((token) => token.type === "math");
  const visibleText = parsed.blocks[0].inline.map((token) => token.value).join("");
  assert.deepEqual(math, { type: "math", value: "c = √(a² + b²)" });
  assert.equal(visibleText.includes("<img src=x onerror=alert(1)>"), true);
  assert.deepEqual(parsed.visualRefs, ["visual:M4-GE-TRI-10"]);

  const clientSource = await readFile(clientPath, "utf8");
  assert.match(
    clientSource,
    /renderUserMessageInto\(userElement\.querySelector\("\.message-content"\), userElement, record\.userText\)/u,
  );
  assert.match(clientSource, /function renderUserMessageInto[\s\S]*?delete target\.dataset\.visualRefs/u);
  assert.match(clientSource, /return \{ \.\.\.parsed, visualRefs: \[\] \};/u);
});

test("normalizes AskEcho rich media without accepting provider HTML or unsafe URLs", () => {
  const results = normalizeAgentExternalRichResults({
    schema_version: "external-rich-results@1.0",
    cards: [{
      id: "card-1",
      kind: "video",
      provider_type: "video",
      title: "<script>alert(1)</script>二次函数视频",
      summary: "<b>先看开口方向</b>",
      site_name: "教学网",
      url: "https://viewer:secret@media.example.test/quadratic.mp4",
      image: {
        image_url: "https://images.example.test/quadratic-cover.jpg",
        width: 640,
        height: 360,
      },
      video: {
        id: "video-1",
        url: "https://media.example.test/quadratic.mp4",
        duration_ms: 31_000,
      },
      html: "<iframe src=https://attacker.test></iframe>",
    }],
    images: [{
      image_url: "https://images.example.test/quadratic.png",
      source_url: "https://source.example.test/quadratic",
      alt: "<img src=x>函数图像",
    }, {
      image_url: "javascript:alert(1)",
    }, {
      image_url: "https://127.0.0.1/private.png",
    }],
    videos: [{
      id: "video-1",
      url: "https://media.example.test/quadratic.mp4",
    }, {
      id: "video-2",
      title: "另一个讲解",
      url: "https://media.example.test/another.mp4",
      cover_image: { image_url: "https://images.example.test/another.jpg" },
    }],
  });

  assert.equal(results.schemaVersion, "external-rich-results@1.0");
  assert.equal(results.isEmpty, false);
  assert.equal(results.cards.length, 1);
  assert.equal(results.cards[0].title, "alert(1) 二次函数视频");
  assert.equal(results.cards[0].summary, "先看开口方向");
  assert.equal(results.cards[0].url, "https://media.example.test/quadratic.mp4");
  assert.equal(Object.hasOwn(results.cards[0], "html"), false);
  assert.deepEqual(results.images.map((item) => item.imageUrl), [
    "https://images.example.test/quadratic.png",
  ]);
  assert.equal(results.images[0].alt, "函数图像");
  assert.deepEqual(results.videos.map((item) => item.id), ["video-2"]);
  assert.equal(Object.isFrozen(results.cards), true);
});

test("accepts the official nested video_card shape but exposes only display fields", () => {
  const results = normalizeAgentExternalRichResults({
    cards: [{
      card_type: "video",
      video_card: {
        id: "official-video",
        source_type: "douyin_video",
        site_name: "视频来源",
        title: "一次函数讲解",
        cover_image: {
          url: "https://images.example.test/cover.jpg",
          width: 540,
          height: 960,
        },
        url: "https://media.example.test/lesson.mp4",
        duration: 27_981,
        author_name: "王老师",
        arbitrary_provider_payload: { secret: true },
      },
    }],
  });

  const card = results.cards[0];
  assert.equal(card.kind, "video");
  assert.equal(card.video.durationMs, 27_981);
  assert.equal(card.image.imageUrl, "https://images.example.test/cover.jpg");
  assert.equal(card.authorName, "王老师");
  assert.equal(Object.hasOwn(card, "arbitrary_provider_payload"), false);
});
