export const A2UI_VERSION = "v0.9";
export const A2UI_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
export const A2UI_COMPONENTS = new Set([
  "Button",
  "Card",
  "CheckBox",
  "ChoicePicker",
  "Column",
  "Divider",
  "Row",
  "Text",
  "TextField"
]);

const INTERACTIVE_QUERY =
  /推荐|方案|比较|选择|适合|预算|养老|保障|理赔|报案|材料|分期|还款|账单|旅行|酒店|饮品|咖啡|产品|配置|测算/;
const CLAIM_QUERY = /理赔|报案|出险|住院|重疾|身故|伤残|材料|赔付|拒赔/;
const INSURANCE_PLAN_QUERY = /养老|年金|终身寿险|方案|推荐|比较|预算|储备|传承|保障配置/;
const ANSWER_MIN_LENGTH = 16;

export function shouldRenderA2UI(query, force = false) {
  return force || INTERACTIVE_QUERY.test(String(query || ""));
}

export function createA2UIResponse({ industry, query = "", answer = "", force = false } = {}) {
  if (!shouldRenderA2UI(query, force) && !shouldRenderA2UI(answer, false)) return null;

  const normalizedIndustry = String(industry || "retail");
  const surfaceId = makeSurfaceId(normalizedIndustry);
  const answerDriven = normalizeAnswer(answer).length >= ANSWER_MIN_LENGTH;
  const template = answerDriven ? "answer_driven" : resolveTemplate(normalizedIndustry, query);
  const definition = answerDriven
    ? createAnswerDrivenSurface(normalizedIndustry, query, answer)
    : createTemplateDefinition(template, { query, answer });
  validateComponents(definition.components);

  return {
    surfaceId,
    template,
    mode: answerDriven ? "answer_driven" : "industry_template",
    title: definition.title,
    messages: [
      {
        version: A2UI_VERSION,
        createSurface: {
          surfaceId,
          catalogId: A2UI_CATALOG_ID,
          sendDataModel: true,
          theme: { primaryColor: "#2468f2" }
        }
      },
      {
        version: A2UI_VERSION,
        updateComponents: {
          surfaceId,
          components: definition.components
        }
      },
      {
        version: A2UI_VERSION,
        updateDataModel: {
          surfaceId,
          path: "/",
          value: definition.dataModel
        }
      }
    ]
  };
}

export function normalizeA2UIAction(input) {
  const action = input?.action;
  if (input?.version !== A2UI_VERSION || !action || typeof action !== "object") return null;

  const name = safeIdentifier(action.name);
  const surfaceId = safeIdentifier(action.surfaceId);
  const sourceComponentId = safeIdentifier(action.sourceComponentId);
  if (!name || !surfaceId || !sourceComponentId) return null;

  return {
    version: A2UI_VERSION,
    action: {
      name,
      surfaceId,
      sourceComponentId,
      timestamp: safeTimestamp(action.timestamp),
      context: sanitizeActionContext(action.context)
    }
  };
}

export function sanitizeA2UIEvent(input) {
  const normalizedAction = normalizeA2UIAction(input);
  if (normalizedAction) {
    return {
      kind: "action",
      ...normalizedAction,
      action: {
        ...normalizedAction.action,
        context: summarizeContext(normalizedAction.action.context)
      }
    };
  }

  const telemetry = input?.telemetry;
  if (input?.version !== A2UI_VERSION || !telemetry || typeof telemetry !== "object") return null;
  const interaction = ["input", "change", "focus", "click"].includes(telemetry.interaction)
    ? telemetry.interaction
    : "change";

  return {
    kind: "telemetry",
    version: A2UI_VERSION,
    telemetry: {
      interaction,
      surfaceId: safeIdentifier(telemetry.surfaceId),
      componentId: safeIdentifier(telemetry.componentId),
      componentType: safeIdentifier(telemetry.componentType),
      label: safeText(telemetry.label, 80),
      valueSummary: sanitizeValueSummary(telemetry.valueSummary),
      timestamp: safeTimestamp(telemetry.timestamp)
    }
  };
}

export function describeA2UIAction(input) {
  const normalized = normalizeA2UIAction(input);
  if (!normalized) return "";
  const { action } = normalized;
  const entries = Object.entries(action.context || {})
    .slice(0, 12)
    .map(([key, value]) => `${safeText(key, 40)}=${formatContextValue(value)}`)
    .join("，");
  return `用户通过 A2UI 交互界面执行了 ${action.name}${entries ? `，提交信息：${entries}` : ""}。请基于当前行业人设继续回答，并确认下一步。`;
}

function resolveTemplate(industry, query) {
  if (
    (industry === "insurance" || industry === "pingan_insurance_fast") &&
    CLAIM_QUERY.test(query) &&
    !INSURANCE_PLAN_QUERY.test(query)
  ) {
    return "insurance_claim";
  }
  if (industry === "pingan_insurance_fast" || industry === "insurance") return "insurance_plan";
  if (industry === "cmb_credit_fast") return "credit_installment";
  if (industry === "travel" || industry === "travel_fast") return "travel_plan";
  if (industry === "retail") return "retail_recommendation";
  return "wealth_plan";
}

function createTemplateDefinition(template, context) {
  switch (template) {
    case "insurance_claim":
      return createInsuranceClaimSurface();
    case "insurance_plan":
      return createInsurancePlanSurface();
    case "credit_installment":
      return createCreditInstallmentSurface();
    case "travel_plan":
      return createTravelPlanSurface();
    case "retail_recommendation":
      return createRetailSurface();
    default:
      return createWealthPlanSurface(context);
  }
}

function createAnswerDrivenSurface(industry, query, answer) {
  const segments = extractAnswerSegments(answer);
  const cards = createAnswerCards(segments, industry, query, answer);
  const title = inferAnswerSurfaceTitle(industry, query, answer);
  const cardIds = [];
  const components = [
    column("root", [
      "answer_heading",
      "answer_question",
      "answer_cards",
      "answer_divider",
      "answer_followup_card",
      "answer_boundary"
    ]),
    text("answer_heading", title, "h3"),
    text("answer_question", `客户关注：${safeText(query, 180) || "本轮咨询"}`, "caption")
  ];

  cards.forEach((item, index) => {
    const suffix = index + 1;
    const cardId = `answer_card_${suffix}`;
    const contentId = `answer_card_content_${suffix}`;
    const titleId = `answer_card_title_${suffix}`;
    const bodyId = `answer_card_body_${suffix}`;
    const buttonId = `answer_card_button_${suffix}`;
    const buttonTextId = `answer_card_button_text_${suffix}`;
    cardIds.push(cardId);
    components.push(
      card(cardId, contentId),
      column(contentId, [titleId, bodyId, buttonId]),
      text(titleId, item.title, "h4"),
      text(bodyId, item.body, "body"),
      button(buttonId, buttonTextId, "继续了解", "inspect_answer_topic", {
        topic: item.title,
        excerpt: item.body,
        originalQuery: safeText(query, 240)
      }),
      text(buttonTextId, "继续了解", "body")
    );
  });

  components.push(
    row("answer_cards", cardIds),
    { id: "answer_divider", component: "Divider" },
    card("answer_followup_card", "answer_followup_form"),
    column("answer_followup_form", [
      "answer_followup_title",
      "answer_followup_topic",
      "answer_followup_note",
      "answer_followup_submit"
    ]),
    text("answer_followup_title", "继续咨询", "h4"),
    choice(
      "answer_followup_topic",
      "想继续了解",
      "/followUp/topic",
      cards.map((item) => item.title)
    ),
    textField(
      "answer_followup_note",
      inferFollowUpLabel(industry, query, answer),
      "/followUp/note",
      "longText"
    ),
    button(
      "answer_followup_submit",
      "answer_followup_submit_text",
      "继续咨询",
      "continue_from_answer_card",
      {
        topic: { path: "/followUp/topic" },
        note: { path: "/followUp/note" },
        originalQuery: safeText(query, 240)
      }
    ),
    text("answer_followup_submit_text", "继续咨询", "body"),
    text("answer_boundary", inferServiceBoundary(industry), "caption")
  );

  return {
    title,
    dataModel: {
      followUp: {
        topic: cards[0]?.title || "核心建议",
        note: ""
      }
    },
    components
  };
}

function createAnswerCards(segments, industry, query, answer) {
  const source = segments.length ? segments : ["当前回答建议先确认需求，再比较适配方向和关键限制。"];
  const usedTitles = new Set();
  return source.slice(0, 3).map((body, index) => {
    let title = inferAnswerTopic(body, industry, index, query, answer);
    if (usedTitles.has(title)) title = `补充要点 ${index + 1}`;
    usedTitles.add(title);
    return { title, body: safeText(body, 260) };
  });
}

function extractAnswerSegments(answer) {
  const normalized = normalizeAnswer(answer);
  const sentenceMatches = normalized.match(/[^。！？；\n]+[。！？；]?/g) || [];
  let segments = sentenceMatches.map(cleanAnswerSegment).filter((item) => item.length >= 6);

  if (segments.length < 2 && normalized.length > 48) {
    segments = normalized
      .split(/[，,:：]/)
      .map(cleanAnswerSegment)
      .filter((item) => item.length >= 8);
  }

  return [...new Set(segments)].slice(0, 3);
}

function normalizeAnswer(answer) {
  return String(answer || "")
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 4000);
}

function cleanAnswerSegment(value) {
  return safeText(value, 260)
    .replace(/^[#>*_`~\s]+/, "")
    .replace(/^(?:[-•·]|\d+[.、)]|[一二三四五六七八九十]+[、.])\s*/, "")
    .replace(/[*_`~]+/g, "")
    .trim();
}

function inferAnswerSurfaceTitle(industry, query, answer) {
  const combined = `${query} ${answer}`;
  if (CLAIM_QUERY.test(combined) && !INSURANCE_PLAN_QUERY.test(query)) return "理赔要点与下一步";
  if (/分期|还款|账单|最低还款|提前结清/.test(combined)) return "还款方案比较";
  if (industry === "travel" || industry === "travel_fast") return "旅行方案建议";
  if (industry === "retail") return "饮品推荐结果";
  if (/比较|区别|还是|方案|推荐|适合/.test(combined)) return "方案建议";
  return "本轮咨询要点";
}

function inferAnswerTopic(body, industry, index, query, answer) {
  const claimFocused = CLAIM_QUERY.test(`${query} ${answer}`) && !INSURANCE_PLAN_QUERY.test(query);
  if (claimFocused) {
    if (/报案|95511|案件号/.test(body)) return "报案";
    if (/材料|病历|票据|申请书|证明/.test(body)) return "申请材料";
    if (/进度|审核|结论|赔付/.test(body)) return "进度与审核";
  }

  const rules = [
    [/年金/, "年金险方向"],
    [/终身寿/, "终身寿险方向"],
    [/医疗|重疾|保障/, "保障方向"],
    [/理赔|报案|材料/, "理赔下一步"],
    [/全额还款/, "全额还款"],
    [/账单分期|分期/, "分期方案"],
    [/最低还款/, "最低还款提醒"],
    [/提前结清/, "提前结清提醒"],
    [/主推/, "主推方案"],
    [/备选/, "备选方案"],
    [/预算|价格|费用|费率|成本/, "预算与成本"],
    [/流动性|退保|退出/, "流动性提醒"],
    [/风险|限制|注意|不能|不保证/, "关键限制"],
    [/材料|步骤|流程/, "办理步骤"]
  ];
  const matched = rules.find(([pattern]) => pattern.test(body));
  if (matched) return matched[1];
  if (industry === "travel" || industry === "travel_fast") return index === 0 ? "行程建议" : "出行提醒";
  if (industry === "retail") return index === 0 ? "推荐饮品" : "口味建议";
  return ["核心建议", "适配理由", "下一步"][index] || `要点 ${index + 1}`;
}

function inferFollowUpLabel(industry, query, answer) {
  if (CLAIM_QUERY.test(`${query} ${answer}`) && !INSURANCE_PLAN_QUERY.test(query)) {
    return "补充理赔类型或报案情况（选填，请勿填写敏感信息）";
  }
  if (industry === "travel" || industry === "travel_fast") return "补充日期、人数或预算（选填）";
  if (industry === "retail") return "补充口味、冷热或预算（选填）";
  if (industry === "cmb_credit_fast") return "补充账单情况（选填，请勿填写卡号）";
  if (industry === "insurance" || industry === "pingan_insurance_fast") {
    return "补充预算或保障偏好（选填）";
  }
  return "补充期限、金额或偏好（选填）";
}

function inferServiceBoundary(industry) {
  if (industry === "insurance" || industry === "pingan_insurance_fast") {
    return "具体保险责任、现金价值、承保和理赔结论以正式合同及官方审核为准。";
  }
  if (industry === "cmb_credit_fast") {
    return "实际资格、费率、金额和办理结果以掌上生活实时页面及正式条款为准。";
  }
  if (industry === "banking" || industry === "banking_fast") {
    return "实际产品、风险等级和收益表现以银行正式材料及风险测评结果为准。";
  }
  if (industry === "travel" || industry === "travel_fast") {
    return "实际价格、库存、退改政策和可订状态以下单页面为准。";
  }
  return "实际供应、价格和优惠以门店及下单页面为准。";
}

function createInsuranceClaimSurface() {
  return {
    title: "理赔申请准备",
    dataModel: {
      claim: { type: "住院医疗", incidentDate: "", reported: false }
    },
    components: [
      column("root", ["claim_heading", "claim_intro", "claim_form_card", "claim_steps"]),
      text("claim_heading", "理赔申请准备", "h3"),
      text("claim_intro", "先完成报案信息梳理，实际材料和结论以正式合同与平安人寿审核为准。", "body"),
      card("claim_form_card", "claim_form"),
      column("claim_form", [
        "claim_type",
        "claim_date",
        "claim_reported",
        "claim_privacy",
        "claim_submit"
      ]),
      choice("claim_type", "理赔类型", "/claim/type", ["住院医疗", "重大疾病", "意外伤残", "身故"]),
      textField("claim_date", "事故或确诊日期", "/claim/incidentDate", "date"),
      checkBox("claim_reported", "我已经通过官方渠道报案", "/claim/reported"),
      text("claim_privacy", "请勿在演示页填写身份证号、银行卡号或详细病历。", "caption"),
      button("claim_submit", "claim_submit_text", "生成材料清单", "prepare_claim_materials", {
        claimType: { path: "/claim/type" },
        incidentDate: { path: "/claim/incidentDate" },
        reported: { path: "/claim/reported" }
      }),
      text("claim_submit_text", "生成材料清单", "body"),
      row("claim_steps", ["claim_step_1", "claim_step_2", "claim_step_3"]),
      card("claim_step_1", "claim_step_1_text"),
      text("claim_step_1_text", "1. 95511 报案", "body"),
      card("claim_step_2", "claim_step_2_text"),
      text("claim_step_2_text", "2. 准备材料", "body"),
      card("claim_step_3", "claim_step_3_text"),
      text("claim_step_3_text", "3. 查询进度", "body")
    ]
  };
}

function createInsurancePlanSurface() {
  return {
    title: "保险方案比较",
    dataModel: {
      needs: { goal: "养老储备", annualBudget: "", liquidity: "中等" }
    },
    components: [
      column("root", ["plan_heading", "plan_intro", "needs_card", "plan_cards"]),
      text("plan_heading", "保险方案比较", "h3"),
      text("plan_intro", "填写三个条件，界面会把保障、长期储备和流动性放在一起比较。", "body"),
      card("needs_card", "needs_form"),
      column("needs_form", ["goal_picker", "budget_field", "liquidity_picker", "compare_button"]),
      choice("goal_picker", "主要目标", "/needs/goal", ["养老储备", "家庭保障", "财富传承"]),
      textField("budget_field", "每年可持续预算（元）", "/needs/annualBudget", "number"),
      choice("liquidity_picker", "流动性要求", "/needs/liquidity", ["较高", "中等", "较低"]),
      button("compare_button", "compare_button_text", "生成比较建议", "compare_insurance_plans", {
        goal: { path: "/needs/goal" },
        annualBudget: { path: "/needs/annualBudget" },
        liquidity: { path: "/needs/liquidity" }
      }),
      text("compare_button_text", "生成比较建议", "body"),
      row("plan_cards", ["plan_a_card", "plan_b_card"]),
      card("plan_a_card", "plan_a_content"),
      column("plan_a_content", ["plan_a_title", "plan_a_desc", "plan_a_button"]),
      text("plan_a_title", "Mock A｜养老现金流", "h4"),
      text("plan_a_desc", "适合长期养老目标，重点看领取安排与前期流动性。", "body"),
      button("plan_a_button", "plan_a_button_text", "选择方案 A", "select_insurance_plan", {
        plan: "mock_pension_cashflow",
        goal: { path: "/needs/goal" }
      }),
      text("plan_a_button_text", "选择方案 A", "body"),
      card("plan_b_card", "plan_b_content"),
      column("plan_b_content", ["plan_b_title", "plan_b_desc", "plan_b_button"]),
      text("plan_b_title", "Mock B｜终身寿险储备", "h4"),
      text("plan_b_desc", "适合长期家庭责任与传承目标，短期退出可能有损失。", "body"),
      button("plan_b_button", "plan_b_button_text", "选择方案 B", "select_insurance_plan", {
        plan: "mock_whole_life_reserve",
        goal: { path: "/needs/goal" }
      }),
      text("plan_b_button_text", "选择方案 B", "body")
    ]
  };
}

function createCreditInstallmentSurface() {
  return {
    title: "还款方式比较",
    dataModel: {
      bill: { amount: "", availableRepayment: "", preferredTerm: "6 期" }
    },
    components: [
      column("root", ["credit_heading", "credit_intro", "credit_form_card", "credit_options"]),
      text("credit_heading", "账单分期比较", "h3"),
      text("credit_intro", "输入非敏感金额信息，实际费率、资格和每期金额以掌上生活页面为准。", "body"),
      card("credit_form_card", "credit_form"),
      column("credit_form", ["bill_amount", "bill_repayment", "bill_term", "bill_submit"]),
      textField("bill_amount", "本期账单金额（元）", "/bill/amount", "number"),
      textField("bill_repayment", "本期可还金额（元）", "/bill/availableRepayment", "number"),
      choice("bill_term", "希望比较的期数", "/bill/preferredTerm", ["3 期", "6 期", "12 期"]),
      button("bill_submit", "bill_submit_text", "比较还款方式", "compare_repayment_options", {
        amount: { path: "/bill/amount" },
        availableRepayment: { path: "/bill/availableRepayment" },
        preferredTerm: { path: "/bill/preferredTerm" }
      }),
      text("bill_submit_text", "比较还款方式", "body"),
      row("credit_options", ["credit_full", "credit_installment", "credit_minimum"]),
      card("credit_full", "credit_full_text"),
      text("credit_full_text", "全额还款｜通常总成本最低", "body"),
      card("credit_installment", "credit_installment_text"),
      text("credit_installment_text", "账单分期｜固定月供，关注总成本", "body"),
      card("credit_minimum", "credit_minimum_text"),
      text("credit_minimum_text", "最低还款｜短期应急，关注计息", "body")
    ]
  };
}

function createTravelPlanSurface() {
  return {
    title: "旅行需求表",
    dataModel: {
      trip: { destination: "三亚", budget: "", companions: "带父母", pace: "轻松" }
    },
    components: [
      column("root", ["travel_heading", "travel_form_card", "travel_cards"]),
      text("travel_heading", "旅行方案生成", "h3"),
      card("travel_form_card", "travel_form"),
      column("travel_form", ["trip_destination", "trip_budget", "trip_companions", "trip_pace", "trip_submit"]),
      textField("trip_destination", "目的地", "/trip/destination", "shortText"),
      textField("trip_budget", "总预算（元）", "/trip/budget", "number"),
      choice("trip_companions", "同行人", "/trip/companions", ["自己", "情侣", "带父母", "亲子"]),
      choice("trip_pace", "行程节奏", "/trip/pace", ["轻松", "适中", "充实"]),
      button("trip_submit", "trip_submit_text", "生成主推与备选", "generate_travel_plan", {
        destination: { path: "/trip/destination" },
        budget: { path: "/trip/budget" },
        companions: { path: "/trip/companions" },
        pace: { path: "/trip/pace" }
      }),
      text("trip_submit_text", "生成主推与备选", "body"),
      row("travel_cards", ["travel_main", "travel_alt"]),
      card("travel_main", "travel_main_text"),
      text("travel_main_text", "主推｜同一酒店连住，少换乘", "body"),
      card("travel_alt", "travel_alt_text"),
      text("travel_alt_text", "备选｜调整区域，保留预算弹性", "body")
    ]
  };
}

function createRetailSurface() {
  return {
    title: "饮品推荐卡",
    dataModel: { drink: { temperature: "冰", sweetness: "不太甜" } },
    components: [
      column("root", ["retail_heading", "retail_form", "retail_cards"]),
      text("retail_heading", "今天喝什么", "h3"),
      column("retail_form", ["drink_temperature", "drink_sweetness"]),
      choice("drink_temperature", "冷热", "/drink/temperature", ["冰", "热"]),
      choice("drink_sweetness", "甜度", "/drink/sweetness", ["不太甜", "标准甜", "无糖方向"]),
      row("retail_cards", ["drink_a", "drink_b"]),
      card("drink_a", "drink_a_content"),
      column("drink_a_content", ["drink_a_title", "drink_a_desc", "drink_a_button"]),
      text("drink_a_title", "主推｜生椰拿铁方向", "h4"),
      text("drink_a_desc", "咖啡感柔和，可调整甜度和冰量。", "body"),
      button("drink_a_button", "drink_a_button_text", "选主推", "select_drink", { product: "mock_coconut_latte" }),
      text("drink_a_button_text", "选主推", "body"),
      card("drink_b", "drink_b_content"),
      column("drink_b_content", ["drink_b_title", "drink_b_desc", "drink_b_button"]),
      text("drink_b_title", "备选｜美式方向", "h4"),
      text("drink_b_desc", "咖啡感更明显，整体更清爽。", "body"),
      button("drink_b_button", "drink_b_button_text", "选备选", "select_drink", { product: "mock_americano" }),
      text("drink_b_button_text", "选备选", "body")
    ]
  };
}

function createWealthPlanSurface() {
  return {
    title: "资金需求表",
    dataModel: { funds: { amount: "", horizon: "半年", risk: "较低" } },
    components: [
      column("root", ["wealth_heading", "wealth_intro", "wealth_card"]),
      text("wealth_heading", "资金安排需求", "h3"),
      text("wealth_intro", "先确认金额、使用时间和波动承受能力，再给主方案与备选。", "body"),
      card("wealth_card", "wealth_form"),
      column("wealth_form", ["fund_amount", "fund_horizon", "fund_risk", "fund_submit"]),
      textField("fund_amount", "可安排金额（元）", "/funds/amount", "number"),
      choice("fund_horizon", "预计使用时间", "/funds/horizon", ["三个月内", "半年", "一年以上"]),
      choice("fund_risk", "波动承受能力", "/funds/risk", ["较低", "中等", "较高"]),
      button("fund_submit", "fund_submit_text", "生成配置方向", "generate_wealth_plan", {
        amount: { path: "/funds/amount" },
        horizon: { path: "/funds/horizon" },
        risk: { path: "/funds/risk" }
      }),
      text("fund_submit_text", "生成配置方向", "body")
    ]
  };
}

function text(id, value, variant = "body") {
  return { id, component: "Text", text: value, variant };
}

function column(id, children) {
  return { id, component: "Column", children, justify: "start", align: "stretch" };
}

function row(id, children) {
  return { id, component: "Row", children, justify: "start", align: "stretch" };
}

function card(id, child) {
  return { id, component: "Card", child };
}

function textField(id, label, path, textFieldType) {
  return { id, component: "TextField", label, value: { path }, textFieldType };
}

function choice(id, label, path, values) {
  return {
    id,
    component: "ChoicePicker",
    label,
    value: { path },
    selections: { path },
    maxAllowedSelections: 1,
    options: values.map((value) => ({ label: value, value }))
  };
}

function checkBox(id, label, path) {
  return { id, component: "CheckBox", label, value: { path } };
}

function button(id, child, label, eventName, context) {
  return {
    id,
    component: "Button",
    child,
    label,
    variant: "primary",
    action: { event: { name: eventName, context } }
  };
}

function makeSurfaceId(industry) {
  const slug = safeIdentifier(industry) || "demo";
  return `${slug}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function validateComponents(components) {
  if (!Array.isArray(components) || !components.some((item) => item.id === "root")) {
    throw new Error("A2UI surface requires a root component");
  }
  const ids = new Set();
  for (const item of components) {
    if (!safeIdentifier(item.id) || ids.has(item.id)) throw new Error(`Invalid A2UI component id: ${item.id}`);
    if (!A2UI_COMPONENTS.has(item.component)) throw new Error(`Unsupported A2UI component: ${item.component}`);
    ids.add(item.id);
  }
}

function sanitizeActionContext(value, depth = 0) {
  if (depth > 4) return null;
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return safeText(value, 240);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeActionContext(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 20)
      .map(([key, item]) => [safeText(key, 60), sanitizeActionContext(item, depth + 1)])
  );
}

function summarizeContext(value, depth = 0) {
  if (depth > 3) return "已提交";
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return { type: "number", present: true };
  if (typeof value === "string") {
    if (/^[a-z0-9_-]{1,48}$/i.test(value)) return value;
    return { type: "text", length: value.length, present: value.length > 0 };
  }
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => summarizeContext(item, depth + 1));
  if (typeof value !== "object") return "已提交";
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 12)
      .map(([key, item]) => [safeText(key, 60), summarizeContext(item, depth + 1)])
  );
}

function sanitizeValueSummary(value) {
  if (!value || typeof value !== "object") return { present: false };
  const output = {
    kind: ["text", "number", "choice", "boolean", "button"].includes(value.kind) ? value.kind : "text",
    present: Boolean(value.present)
  };
  if (Number.isFinite(value.length)) output.length = Math.max(0, Math.min(10000, Math.round(value.length)));
  if (output.kind === "choice") output.selection = safeText(value.selection, 80);
  if (output.kind === "boolean") output.checked = Boolean(value.checked);
  return output;
}

function safeIdentifier(value) {
  const normalized = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return normalized || "";
}

function safeText(value, limit) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
}

function safeTimestamp(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function formatContextValue(value) {
  if (value == null) return "未填写";
  if (Array.isArray(value)) return value.map(formatContextValue).join("/");
  if (typeof value === "object") return JSON.stringify(value).slice(0, 200);
  return safeText(value, 120) || "未填写";
}
