import { TEACHER_TURN_TOOL } from "./teacher-agent.js";

export const DEFAULT_INDUSTRY = "education";
export const TOOL_SLOTS = ["benefit", "recommendation", "lead", "knowledge", "transfer"];
const promptOnlyIndustries = new Set([
  "travel_fast",
  "banking_fast",
  "cmb_credit_fast",
  "pingan_insurance_fast"
]);

const transferTool = {
  type: "function",
  name: "transfer_human",
  description: "用户明确要求人工，或问题涉及投诉、隐私、安全、资格审批、交易、风控及模型无法确认的关键信息时，转交人工继续处理。",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string", description: "转人工原因" },
      priority: { type: "string", description: "优先级：normal、high、urgent" },
      summary: { type: "string", description: "已确认的用户需求、关键条件和待处理问题摘要" }
    },
    required: ["reason", "summary"]
  }
};

const INDUSTRY_TOOLSETS = {
  education: {
    tools: {},
    results: {}
  },
  retail: {
    tools: {
      benefit: {
        type: "function",
        name: "query_coupon",
        description: "查询演示用户当前可领取或可使用的瑞幸咖啡优惠券。用户询问优惠、券、会员权益或价格时调用。",
        parameters: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "用户 ID，不知道时填 demo_user" },
            scene: { type: "string", description: "用户场景，如 app_home、menu、checkout" }
          },
          required: ["user_id"]
        }
      },
      recommendation: {
        type: "function",
        name: "recommend_product",
        description: "根据口味、冷热、甜度、咖啡因偏好、预算和优惠情况推荐瑞幸饮品或组合。",
        parameters: {
          type: "object",
          properties: {
            user_query: { type: "string", description: "用户原始需求" },
            taste: { type: "string", description: "口味偏好，如清爽、醇厚、奶香" },
            temperature: { type: "string", description: "冷饮或热饮偏好" },
            sugar_preference: { type: "string", description: "甜度偏好" },
            budget: { type: "string", description: "预算" }
          },
          required: ["user_query"]
        }
      },
      lead: {
        type: "function",
        name: "create_booking",
        description: "用户确认饮品方向并同意继续时，创建到店取餐或门店服务意向。这里只创建演示意向，不直接完成支付。",
        parameters: {
          type: "object",
          properties: {
            user_id: { type: "string" },
            service_type: { type: "string", description: "到店取餐、门店咨询等" },
            preferred_time: { type: "string" },
            city: { type: "string" },
            selected_items: { type: "array", items: { type: "string" } }
          },
          required: ["service_type"]
        }
      },
      knowledge: {
        type: "function",
        name: "search_activity_kb",
        description: "查询瑞幸饮品风味、配料与过敏原提示、优惠券限制、门店和取餐服务规则。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "用户要查询的问题" },
            scene: { type: "string", description: "当前页面或服务场景" },
            top_k: { type: "number", description: "返回知识片段数量" }
          },
          required: ["query"]
        }
      },
      transfer: transferTool
    },
    results: {
      query_coupon: () => ({
        status: "success",
        demo_data: true,
        answer_brief: "演示账户有 2 项可用权益：指定饮品立减券和配送费减免券，实际可用范围以用户券包页面为准。",
        benefits: [
          { id: "demo_drink_coupon", name: "指定饮品立减券", restriction: "指定饮品可用，不与同类券叠加" },
          { id: "demo_delivery_coupon", name: "配送费减免券", restriction: "达到券面门槛后可用" }
        ],
        next_suggestion: "可结合用户口味推荐一款主推饮品和一款更低糖的备选。"
      }),
      recommend_product: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "按用户偏好，主推生椰拿铁，备选标准美式；前者更顺滑，后者咖啡味更直接且无额外奶糖。",
        matched_query: args.user_query || "",
        products: [
          { id: "demo_coconut_latte", name: "生椰拿铁", role: "主推", reason: "椰香与咖啡平衡，可建议少甜以保留咖啡风味" },
          { id: "demo_americano", name: "标准美式", role: "备选", reason: "咖啡风味直接，可做无糖，适合更看重清爽口感" }
        ],
        confirmation_question: "你更想要顺滑奶香，还是更直接的咖啡味？"
      }),
      create_booking: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "已创建演示取餐意向，实际商品、门店库存和支付仍需在 App 内确认。",
        booking: {
          id: `retail_demo_${Date.now()}`,
          service_type: args.service_type || "到店取餐",
          preferred_time: args.preferred_time || "待确认",
          city: args.city || "待确认",
          selected_items: args.selected_items || []
        }
      }),
      search_activity_kb: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "知识库返回了饮品调整与优惠使用提示；配料、过敏原和实际券规则仍应以商品详情和券面为准。",
        query: args.query || "",
        references: [
          { title: "饮品定制说明", snippet: "部分饮品支持调整甜度和冰量，具体以商品页可选项为准。" },
          { title: "优惠使用说明", snippet: "优惠是否可叠加、适用门店及商品范围以券面展示为准。" }
        ]
      })
    }
  },
  travel: {
    tools: {
      benefit: {
        type: "function",
        name: "query_travel_offer",
        description: "查询当前旅行场景可用的机票、酒店、度假套餐优惠和会员权益。",
        parameters: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "用户 ID，不知道时填 demo_user" },
            destination: { type: "string" },
            travel_dates: { type: "string" },
            scene: { type: "string" }
          },
          required: ["user_id"]
        }
      },
      recommendation: {
        type: "function",
        name: "recommend_travel_plan",
        description: "根据出发地、目的地、日期、同行人、预算和偏好生成可比较的机酒或度假方案。",
        parameters: {
          type: "object",
          properties: {
            user_query: { type: "string" },
            origin: { type: "string" },
            destination: { type: "string" },
            travel_dates: { type: "string" },
            travelers: { type: "string" },
            total_budget: { type: "string" },
            priorities: { type: "array", items: { type: "string" } }
          },
          required: ["user_query"]
        }
      },
      lead: {
        type: "function",
        name: "create_travel_consultation",
        description: "用户认可行程方向并同意后，创建旅行顾问咨询单，用于继续核价、核库存和完善行程。",
        parameters: {
          type: "object",
          properties: {
            destination: { type: "string" },
            travel_dates: { type: "string" },
            travelers: { type: "string" },
            budget: { type: "string" },
            preferred_contact_time: { type: "string" },
            confirmed_requirements: { type: "string" }
          },
          required: ["confirmed_requirements"]
        }
      },
      knowledge: {
        type: "function",
        name: "search_travel_kb",
        description: "查询目的地、酒店设施、退改规则、签证材料、交通衔接和旅行服务说明。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            destination: { type: "string" },
            travel_dates: { type: "string" },
            top_k: { type: "number" }
          },
          required: ["query"]
        }
      },
      transfer: transferTool
    },
    results: {
      query_travel_offer: () => ({
        status: "success",
        demo_data: true,
        answer_brief: "演示场景可比较机酒组合优惠与接送机权益，真实价格、适用日期和库存需在下单页再次确认。",
        offers: [
          { name: "机酒组合优惠", value: "组合预订可享演示专属减免", restriction: "适用日期和产品以核价结果为准" },
          { name: "接送机权益", value: "部分度假套餐可选", restriction: "需确认航班时刻与服务区域" }
        ]
      }),
      recommend_travel_plan: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "主推亚龙湾连住的省心方案，备选市区加海棠湾的性价比方案；带长辈更建议减少换酒店和早晚航班。",
        matched_query: args.user_query || "",
        plans: [
          {
            id: "travel_plan_relaxed",
            name: "亚龙湾四天三晚省心方案",
            role: "主推",
            highlights: ["同一区域连住", "减少搬运行李", "预留半天自由活动"],
            tradeoff: "海湾酒店通常预算占比更高，需按日期实时核价"
          },
          {
            id: "travel_plan_value",
            name: "市区加海棠湾性价比方案",
            role: "备选",
            highlights: ["餐饮选择更多", "兼顾城市与海湾体验"],
            tradeoff: "需要换一次酒店，带长辈时行程更折腾"
          }
        ],
        missing_information: ["准确出发日期或可浮动范围", "出发城市"],
        price_note: "以上为演示方案，不代表实时价格或库存。"
      }),
      create_travel_consultation: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "已创建演示旅行咨询单，顾问将在核价和核库存后继续完善方案。",
        consultation: {
          id: `travel_demo_${Date.now()}`,
          destination: args.destination || "待确认",
          travel_dates: args.travel_dates || "待确认",
          travelers: args.travelers || "待确认",
          confirmed_requirements: args.confirmed_requirements || "待补充"
        }
      }),
      search_travel_kb: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "知识库建议带长辈优先选择少换乘、少换酒店的行程，并在预订前确认取消政策和无障碍设施。",
        query: args.query || "",
        references: [
          { title: "长辈同行规划建议", snippet: "优先白天抵达、减少换酒店，并为交通与用餐预留弹性时间。" },
          { title: "退改核对清单", snippet: "分别核对机票、酒店和套餐项目的取消时点、手续费及不可退条件。" }
        ]
      })
    }
  },
  insurance: {
    tools: {
      benefit: {
        type: "function",
        name: "query_insurance_benefit",
        description: "查询演示用户已有保单服务、会员权益或可使用的保险咨询服务，不直接判断保障是否充足。",
        parameters: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "用户 ID，不知道时填 demo_user" },
            benefit_type: { type: "string" }
          },
          required: ["user_id"]
        }
      },
      recommendation: {
        type: "function",
        name: "recommend_insurance_plan",
        description: "根据保障目标、年龄阶段、家庭责任、已有保障和预算，给出保障配置方向，不输出承保或理赔承诺。",
        parameters: {
          type: "object",
          properties: {
            user_query: { type: "string" },
            age_stage: { type: "string" },
            family_responsibility: { type: "string" },
            existing_coverage: { type: "string" },
            annual_budget: { type: "string" },
            primary_concern: { type: "string" }
          },
          required: ["user_query"]
        }
      },
      lead: {
        type: "function",
        name: "create_insurance_consultation",
        description: "用户同意后创建持牌保险顾问咨询单，继续完成需求分析、产品说明和健康告知。",
        parameters: {
          type: "object",
          properties: {
            consultation_topic: { type: "string" },
            confirmed_needs: { type: "string" },
            annual_budget: { type: "string" },
            preferred_contact_time: { type: "string" }
          },
          required: ["consultation_topic", "confirmed_needs"]
        }
      },
      knowledge: {
        type: "function",
        name: "search_insurance_kb",
        description: "查询险种概念、保险责任、等待期、免赔额、除外责任、续保、健康告知和服务流程。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            product_category: { type: "string" },
            top_k: { type: "number" }
          },
          required: ["query"]
        }
      },
      transfer: transferTool
    },
    results: {
      query_insurance_benefit: () => ({
        status: "success",
        demo_data: true,
        answer_brief: "演示账户可使用一次家庭保障梳理和一次持牌顾问条款解读服务，实际权益以账户页面为准。",
        benefits: [
          { name: "家庭保障梳理", status: "可预约", scope: "需求分析与保障缺口说明" },
          { name: "条款解读服务", status: "可预约", scope: "由持牌顾问解释重要责任与限制" }
        ]
      }),
      recommend_insurance_plan: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "有房贷和子女责任时，可优先补齐医疗与家庭经济支柱的定期寿险，再按预算考虑重疾和意外保障。",
        matched_query: args.user_query || "",
        plans: [
          {
            name: "基础保障顺序",
            role: "主推方向",
            components: ["社会医保基础上补充医疗保障", "家庭经济支柱配置定期寿险", "补充综合意外保障"],
            reason: "先覆盖大额医疗支出和家庭责任中断风险"
          },
          {
            name: "增强保障方向",
            role: "预算允许时",
            components: ["在基础方案上评估重疾保障"],
            reason: "用于疾病治疗期间的收入与康复支出补偿"
          }
        ],
        required_follow_up: ["现有社保和商业保单", "家庭主要收入承担情况", "可持续年度预算"],
        compliance_note: "这是演示性的保障方向，不代表具体产品推荐；承保、保费和责任以健康告知、正式条款及核保结果为准。"
      }),
      create_insurance_consultation: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "已创建演示持牌顾问咨询单，后续将基于用户授权补充需求与健康告知。",
        consultation: {
          id: `insurance_demo_${Date.now()}`,
          topic: args.consultation_topic,
          confirmed_needs: args.confirmed_needs,
          annual_budget: args.annual_budget || "待确认"
        }
      }),
      search_insurance_kb: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "知识库提示：医疗险重点比较免赔额、续保条件和除外责任；寿险重点确认保障期限、保额与免责条款。",
        query: args.query || "",
        references: [
          { title: "医疗险比较要点", snippet: "关注保障责任、免赔额、医院范围、续保条件及既往症等除外说明。" },
          { title: "健康告知说明", snippet: "应如实回答正式投保页面的问题，具体核保结论由保险公司作出。" }
        ]
      })
    }
  },
  banking: {
    tools: {
      benefit: {
        type: "function",
        name: "query_bank_benefit",
        description: "查询演示客户可使用的账户权益、费率减免和客户经理服务。",
        parameters: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "用户 ID，不知道时填 demo_user" },
            benefit_type: { type: "string" },
            scene: { type: "string" }
          },
          required: ["user_id"]
        }
      },
      recommendation: {
        type: "function",
        name: "recommend_bank_solution",
        description: "根据资金用途、金额、期限、流动性要求和风险承受能力，推荐个人金融配置方向或产品类别。",
        parameters: {
          type: "object",
          properties: {
            user_query: { type: "string" },
            amount: { type: "string" },
            goal: { type: "string" },
            horizon: { type: "string" },
            liquidity_need: { type: "string" },
            risk_preference: { type: "string" },
            risk_assessment_completed: { type: "boolean" }
          },
          required: ["user_query"]
        }
      },
      lead: {
        type: "function",
        name: "create_bank_advisor_appointment",
        description: "用户明确同意后预约客户经理，继续进行风险测评、产品适当性说明或贷款资格咨询。",
        parameters: {
          type: "object",
          properties: {
            consultation_topic: { type: "string" },
            confirmed_needs: { type: "string" },
            preferred_channel: { type: "string" },
            preferred_contact_time: { type: "string" }
          },
          required: ["consultation_topic", "confirmed_needs"]
        }
      },
      knowledge: {
        type: "function",
        name: "search_bank_kb",
        description: "查询存款、理财、基金、贷款和信用卡的产品规则、风险等级、期限、费用、申赎与服务流程。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            product_category: { type: "string" },
            top_k: { type: "number" }
          },
          required: ["query"]
        }
      },
      transfer: transferTool
    },
    results: {
      query_bank_benefit: () => ({
        status: "success",
        demo_data: true,
        answer_brief: "演示客户可预约一次个人资产配置咨询，并可查询部分转账与账户服务费减免，实际权益以银行账户页面为准。",
        benefits: [
          { name: "个人资产配置咨询", status: "可预约", restriction: "仅提供咨询，不代表产品审批或投资承诺" },
          { name: "账户服务费减免", status: "待核实", restriction: "以客户等级和官方规则为准" }
        ]
      }),
      recommend_bank_solution: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "半年后可能用车款，主方案应以期限匹配和本金稳定为先；可保留应急资金，再比较对应期限的存款类产品。",
        matched_query: args.user_query || "",
        plans: [
          {
            name: "期限匹配的存款分层",
            role: "主推方向",
            allocation: ["保留一部分高流动性资金", "其余比较不超过计划用款日的存款类产品"],
            reason: "优先满足半年后用款和低波动要求",
            risk: "提前支取可能影响利息，具体利率与规则需实时查询"
          },
          {
            name: "低波动净值型产品候选",
            role: "备选方向",
            prerequisite: "完成风险测评且能够接受净值波动",
            risk: "非存款，不保证本金和收益，申赎时点也可能影响流动性"
          }
        ],
        compliance_note: "演示结果仅用于售前比较，不构成投资建议；具体产品、利率、风险等级和适当性结果以银行官方流程为准。"
      }),
      create_bank_advisor_appointment: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "已创建演示客户经理预约，后续将通过正式渠道完成风险测评与产品适当性说明。",
        appointment: {
          id: `bank_demo_${Date.now()}`,
          topic: args.consultation_topic,
          confirmed_needs: args.confirmed_needs,
          preferred_channel: args.preferred_channel || "待确认"
        }
      }),
      search_bank_kb: (args) => ({
        status: "success",
        demo_data: true,
        answer_brief: "知识库提示：存款与理财在本金保障、收益形式、流动性和风险上不同，比较时需同时核对期限、提前退出规则和费用。",
        query: args.query || "",
        references: [
          { title: "存款与理财的区别", snippet: "存款按约定规则计息；银行理财通常为净值型非存款产品，不保证本金和收益。" },
          { title: "短期资金规划", snippet: "有明确用款日期时，应优先匹配期限并预留应急流动性，避免被迫提前退出。" }
        ]
      })
    }
  }
};

export function normalizeIndustry(industry) {
  return Object.hasOwn(INDUSTRY_TOOLSETS, industry) || promptOnlyIndustries.has(industry)
    ? industry
    : DEFAULT_INDUSTRY;
}

export function isPromptOnlyIndustry(industry) {
  return promptOnlyIndustries.has(normalizeIndustry(industry));
}

export function getIndustryTools(industry, enabledSlots = {}) {
  const normalizedIndustry = normalizeIndustry(industry);
  if (isPromptOnlyIndustry(normalizedIndustry) || normalizedIndustry === "education") return [];

  const toolset = INDUSTRY_TOOLSETS[normalizedIndustry];
  return TOOL_SLOTS.filter((slot) => enabledSlots[slot] !== false)
    .map((slot) => toolset.tools?.[slot])
    .filter(Boolean)
    .map((tool) => structuredClone(tool));
}

export function getSessionTools(industry, enabledSlots = {}, customTools = []) {
  const normalizedIndustry = normalizeIndustry(industry);
  if (isPromptOnlyIndustry(normalizedIndustry)) return [];

  const normalizedCustomTools = Array.isArray(customTools) ? customTools : [];
  if (normalizedIndustry === "education") {
    // MVP 1.0 freezes the education model-visible tool surface to exactly one
    // aggregate tool. Retrieval, grading, state and card assembly remain
    // private implementation details behind teacher_turn.
    return [structuredClone(TEACHER_TURN_TOOL)];
  }

  return [
    ...getIndustryTools(normalizedIndustry, enabledSlots),
    ...structuredClone(normalizedCustomTools)
  ];
}

export async function runIndustryTool(industry, name, args = {}) {
  const normalizedIndustry = normalizeIndustry(industry);
  if (isPromptOnlyIndustry(normalizedIndustry)) {
    return {
      status: "unsupported_tool",
      demo_data: true,
      tool: name,
      answer_brief: "提示词直答模式未注入任何工具"
    };
  }

  if (normalizedIndustry === "education") {
    return {
      status: "gateway_managed_tool",
      tool: name,
      answer_brief:
        "教育工具由 Gateway 以权威会话标识执行；模型只能调用 teacher_turn。"
    };
  }

  if (name === "transfer_human") {
    return {
      status: "success",
      demo_data: true,
      tool: name,
      answer_brief: "已生成演示转人工请求，人工将基于当前需求摘要继续处理。",
      handoff: {
        id: `handoff_demo_${Date.now()}`,
        reason: args.reason || "用户请求人工",
        priority: args.priority || "normal",
        summary: args.summary || "待补充"
      }
    };
  }

  const toolset = INDUSTRY_TOOLSETS[normalizedIndustry];
  const handler = toolset.results[name];
  if (!handler) {
    return {
      status: "unsupported_tool",
      demo_data: true,
      tool: name,
      answer_brief: `当前行业 demo 未实现工具 ${name}`
    };
  }

  return { tool: name, ...(await handler(args)) };
}
