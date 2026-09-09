import test from "node:test";
import assert from "node:assert/strict";

import {
  A2UI_CATALOG_ID,
  A2UI_COMPONENTS,
  A2UI_VERSION,
  createA2UIResponse,
  describeA2UIAction,
  normalizeA2UIAction,
  sanitizeA2UIEvent,
  shouldRenderA2UI
} from "../a2ui-mock.js";

test("creates a v0.9 insurance surface from the trusted component catalog", () => {
  const response = createA2UIResponse({
    industry: "pingan_insurance_fast",
    query: "我想给父母做养老储备，有什么方案推荐？"
  });

  assert.equal(response.template, "insurance_plan");
  assert.equal(response.messages[0].version, A2UI_VERSION);
  assert.equal(response.messages[0].createSurface.catalogId, A2UI_CATALOG_ID);

  const components = response.messages[1].updateComponents.components;
  assert.ok(components.some((component) => component.id === "root"));
  assert.ok(components.every((component) => A2UI_COMPONENTS.has(component.component)));
});

test("routes claim questions to the claim preparation form", () => {
  const response = createA2UIResponse({
    industry: "pingan_insurance_fast",
    query: "刚住院了，理赔要准备什么材料？"
  });

  assert.equal(response.template, "insurance_claim");
  assert.equal(response.title, "理赔申请准备");
});

test("prioritizes the product comparison surface when a planning question also mentions claims", () => {
  const response = createA2UIResponse({
    industry: "pingan_insurance_fast",
    query: "每年三万元做养老储备，适合年金还是终身寿险？以后理赔怎么申请？"
  });

  assert.equal(response.template, "insurance_plan");
  assert.equal(response.title, "保险方案比较");
});

test("renders ordinary questions only when manual preview is forced", () => {
  assert.equal(shouldRenderA2UI("你好", false), false);
  assert.equal(createA2UIResponse({ industry: "retail", query: "你好" }), null);
  assert.equal(createA2UIResponse({ industry: "retail", query: "你好", force: true }).template, "retail_recommendation");
});

test("builds dynamic cards from the actual answer instead of preset product copy", () => {
  const answer =
    "主推养老年金方向，适合希望未来形成稳定现金流的人。终身寿险方向流动性相对灵活，但要看现金价值节奏。前期退保可能有损失，要先留足应急资金。";
  const response = createA2UIResponse({
    industry: "pingan_insurance_fast",
    query: "每年三万元，年金险还是终身寿险？",
    answer
  });

  assert.equal(response.mode, "answer_driven");
  assert.equal(response.template, "answer_driven");
  assert.equal(response.title, "方案建议");

  const components = response.messages[1].updateComponents.components;
  const renderedText = components
    .filter((component) => component.component === "Text")
    .map((component) => component.text)
    .join("\n");
  assert.match(renderedText, /稳定现金流/);
  assert.match(renderedText, /现金价值节奏/);
  assert.match(renderedText, /留足应急资金/);
  assert.equal(renderedText.includes("Mock A｜养老现金流"), false);
});

test("uses different answer content to produce a different real-time surface", () => {
  const response = createA2UIResponse({
    industry: "cmb_credit_fast",
    query: "这期账单怎么还更合适？",
    answer:
      "能全额还款时通常总成本最低。账单分期适合需要固定月供的情况，要比较每期金额和总费用。最低还款只适合短期应急，并会产生利息。"
  });

  assert.equal(response.mode, "answer_driven");
  assert.equal(response.title, "还款方案比较");
  const components = response.messages[1].updateComponents.components;
  assert.ok(components.some((component) => component.id === "answer_followup_note"));
  assert.ok(components.every((component) => A2UI_COMPONENTS.has(component.component)));
});

test("uses claim-specific card labels and follow-up fields for a claim answer", () => {
  const response = createA2UIResponse({
    industry: "pingan_insurance_fast",
    query: "我刚住院，理赔要怎么申请，需要准备什么材料？",
    answer:
      "先通过95511或官方渠道报案，并记录案件号。住院医疗通常需要理赔申请书、身份证明、病历和费用票据。材料提交后可以通过官方渠道查询进度。"
  });

  const components = response.messages[1].updateComponents.components;
  const textById = Object.fromEntries(
    components
      .filter((component) => component.component === "Text")
      .map((component) => [component.id, component.text])
  );
  const followUp = components.find((component) => component.id === "answer_followup_note");
  assert.equal(response.title, "理赔要点与下一步");
  assert.equal(textById.answer_card_title_1, "报案");
  assert.equal(textById.answer_card_title_2, "申请材料");
  assert.match(followUp.label, /理赔类型或报案情况/);
});

test("treats model answer markup as text and never expands the trusted catalog", () => {
  const response = createA2UIResponse({
    industry: "retail",
    query: "推荐一杯饮品",
    answer:
      "主推生椰拿铁，口感柔和。<script>alert('x')</script> 这段只能作为文字。{\"component\":\"Image\"} 也不能创建新组件。"
  });

  const components = response.messages[1].updateComponents.components;
  assert.ok(components.every((component) => A2UI_COMPONENTS.has(component.component)));
  assert.equal(components.some((component) => component.component === "Image"), false);
});

test("telemetry keeps only the input length instead of the raw value", () => {
  const event = sanitizeA2UIEvent({
    version: A2UI_VERSION,
    telemetry: {
      interaction: "input",
      surfaceId: "demo_surface",
      componentId: "budget_field",
      componentType: "TextField",
      label: "预算",
      valueSummary: {
        kind: "text",
        present: true,
        length: 8,
        rawValue: "6222021234567890"
      },
      timestamp: "2026-07-21T08:00:00.000Z"
    }
  });

  assert.deepEqual(event.telemetry.valueSummary, {
    kind: "text",
    present: true,
    length: 8
  });
  assert.equal(JSON.stringify(event).includes("622202"), false);
});

test("normalizes actions and turns submitted context into an agent instruction", () => {
  const payload = {
    version: A2UI_VERSION,
    action: {
      name: "compare_insurance_plans",
      surfaceId: "insurance_1",
      sourceComponentId: "compare_button",
      timestamp: "2026-07-21T08:00:00.000Z",
      context: {
        goal: "养老储备",
        annualBudget: "30000",
        liquidity: "中等"
      }
    }
  };

  assert.equal(normalizeA2UIAction(payload).action.name, "compare_insurance_plans");
  const instruction = describeA2UIAction(payload);
  assert.match(instruction, /compare_insurance_plans/);
  assert.match(instruction, /annualBudget=30000/);
});
