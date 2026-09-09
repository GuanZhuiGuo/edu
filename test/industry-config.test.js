import assert from "node:assert/strict";
import test from "node:test";
import {
  TOOL_SLOTS,
  getIndustryTools,
  getSessionTools,
  isPromptOnlyIndustry,
  runIndustryTool
} from "../industry-tools.js";
import { INDUSTRY_PRESETS } from "../public/industry-presets.js";

const toolIndustries = ["retail", "travel", "insurance", "banking"];
const fastIndustries = [
  "travel_fast",
  "banking_fast",
  "cmb_credit_fast",
  "pingan_insurance_fast"
];

test("education realtime session exposes only the unified teacher_turn tool", () => {
  const tools = getSessionTools(
    "education",
    { knowledge: true },
    [
      { type: "function", name: "teacher_turn" },
      { type: "function", name: "search_compiled_knowledge" },
      { type: "function", name: "custom_learning_tool" }
    ]
  );
  const names = tools.map((tool) => tool.name);

  assert.deepEqual(names, ["teacher_turn"]);
});

test("all industry presets match server tool definitions", async () => {
  for (const industry of toolIndustries) {
    const preset = INDUSTRY_PRESETS[industry];
    const tools = getIndustryTools(industry);

    assert.ok(preset, `missing preset for ${industry}`);
    assert.equal(tools.length, TOOL_SLOTS.length);
    assert.equal(new Set(tools.map((tool) => tool.name)).size, TOOL_SLOTS.length);

    TOOL_SLOTS.forEach((slot, index) => {
      assert.equal(preset.toolLabels[slot].name, tools[index].name);
    });

    const result = await runIndustryTool(industry, tools[1].name, { user_query: "demo" });
    assert.equal(result.status, "success");
    assert.equal(result.demo_data, true);
  }
});

test("fast industry presets never expose tools", async () => {
  for (const industry of fastIndustries) {
    const preset = INDUSTRY_PRESETS[industry];

    assert.ok(preset, `missing preset for ${industry}`);
    assert.equal(preset.toolMode, "prompt_only");
    assert.equal(isPromptOnlyIndustry(industry), true);
    assert.deepEqual(getIndustryTools(industry), []);
    assert.deepEqual(
      getSessionTools(industry, Object.fromEntries(TOOL_SLOTS.map((slot) => [slot, true])), [
        { type: "function", name: "forced_custom_tool" }
      ]),
      []
    );
    assert.ok(preset.directAnswerKnowledge.includes("Demo 演示"));
    assert.ok(Object.values(preset.enabledToolSlots).every((enabled) => enabled === false));

    const result = await runIndustryTool(industry, "transfer_human", {});
    assert.equal(result.status, "unsupported_tool");
  }
});

test("retail keeps the original Luckin opening and persona fields", () => {
  const retail = INDUSTRY_PRESETS.retail;

  assert.equal(retail.basePrompt, "你叫豆包，是品牌的 C 端活动讲解语音助手。");
  assert.equal(
    retail.backgroundPrompt,
    "你由营销互动助手总控在合适场景下调用。你了解当前活动、权益、商品和预约服务，可以自然承接用户的实时语音咨询。"
  );
  assert.equal(
    retail.stylePrompt,
    "你的表达自然、简洁、口语化，像真人导购一样及时回应。不要过度营销，不要重复长段规则；用户打断时先停下并顺着用户新问题回答。"
  );
  assert.equal(
    retail.openingText,
    "你好，我是 AI Lucky，瑞幸咖啡智能点单助手。可以帮你点咖啡、推荐饮品、查询优惠，也可以陪你聊聊今天想喝什么。"
  );
});

test("CMB credit card fast preset includes installment policy guardrails", () => {
  const cmbCredit = INDUSTRY_PRESETS.cmb_credit_fast;

  assert.match(cmbCredit.backgroundPrompt, /2026 年 5 月/);
  assert.match(cmbCredit.directAnswerKnowledge, /账单分期/);
  assert.match(cmbCredit.directAnswerKnowledge, /提前结清违约金/);
  assert.match(cmbCredit.directAnswerKnowledge, /现金分期/);
  assert.match(cmbCredit.serviceBoundary, /CVV2/);
});

test("Ping An insurance fast preset supports mock sales and claims guidance", () => {
  const pinganInsurance = INDUSTRY_PRESETS.pingan_insurance_fast;

  assert.match(pinganInsurance.directAnswerKnowledge, /Mock A/);
  assert.match(pinganInsurance.directAnswerKnowledge, /分红水平不保证/);
  assert.match(pinganInsurance.directAnswerKnowledge, /发生保险事故后及时报案/);
  assert.match(pinganInsurance.directAnswerKnowledge, /95511/);
  assert.match(pinganInsurance.salesPlaybook, /禁止夹带推品/);
});
