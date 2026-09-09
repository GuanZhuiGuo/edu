import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_VERSION = "1.0.0";
const BANK_VERSION = "2026.08-seed.1";
const COMPILED_AT = "2026-08-14T00:00:00+08:00";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INPUTS = Object.freeze({
  ontology: path.join(ROOT, "public/data/junior-math-ontology.json"),
  visuals: path.join(ROOT, "public/data/junior-math-visual-artifacts.json")
});
const OUTPUTS = Object.freeze({
  publicBank: path.join(ROOT, "public/data/junior-math-question-bank.json"),
  publicSchema: path.join(ROOT, "public/data/junior-math-question-bank.schema.json"),
  privateBank: path.join(ROOT, "data/junior-math-question-bank-private.json"),
  privateSchema: path.join(ROOT, "data/junior-math-question-bank-private.schema.json")
});

const QUESTION_VARIANTS = Object.freeze([
  { suffix: "C01", code: "concept", label: "概念与方法辨析" },
  { suffix: "M01", code: "method", label: "方法与互动探究" },
  { suffix: "A01", code: "application", label: "迁移与真实应用" }
]);

const TYPE_LABELS = Object.freeze({
  single_choice: "单项选择题",
  numeric_response: "数值填空题",
  short_response: "简答题",
  extended_response: "综合解答题"
});

const VARIANT_METHOD = Object.freeze({
  numberline: {
    correct: "先确定原点、正方向和单位长度，再定位对象并比较位置或距离",
    hint: "先把题目中的数或区间转换为数轴上的位置关系。",
    strategies: ["数轴表征", "位置与距离比较"]
  },
  algebra: {
    correct: "识别代数结构，逐步进行有依据的等价变形，并用代入或逆运算检验",
    hint: "先识别运算对象与结构，再决定使用哪条运算法则。",
    strategies: ["结构识别", "等价变形", "结果检验"]
  },
  coordinate: {
    correct: "先建立坐标基准，再把几何或数量条件转换为坐标变化并反向核验",
    hint: "先标明坐标系、原点和方向，再写出点或图形的坐标。",
    strategies: ["坐标表征", "数形结合"]
  },
  linear: {
    correct: "联系斜率、截距、点的坐标与表达式，通过代入和图象相互验证",
    hint: "先找出已知点、斜率或截距，再选择表达式形式。",
    strategies: ["待定系数", "数形结合"]
  },
  quadratic: {
    correct: "先识别开口、对称轴和顶点，再联系表达式、图象与最值进行验证",
    hint: "先从顶点和开口方向判断图象的关键性质。",
    strategies: ["图象性质", "配方与顶点", "最值分析"]
  },
  concept: {
    correct: "明确概念的条件与结论，给出正例和反例，并说明使用依据",
    hint: "先把定义中的条件和结论分别写出来。",
    strategies: ["条件结论辨析", "正例反例"]
  },
  triangle: {
    correct: "先标注已知边角与对应关系，再选择适用定理并逐步写出依据",
    hint: "先在图上标出全部已知条件和需要求证的对象。",
    strategies: ["图形标注", "定理选择", "推理论证"]
  },
  circle: {
    correct: "先确定圆心、半径、弧弦角或切线关系，再选择相应定理计算或证明",
    hint: "先判断题目涉及的是弧、弦、角、切线还是位置关系。",
    strategies: ["圆中关系识别", "定理应用"]
  },
  statistics: {
    correct: "先明确总体、样本与研究问题，再选择统计量或图表并解释其局限",
    hint: "先确认数据从哪里来，以及要回答什么统计问题。",
    strategies: ["数据整理", "统计量选择", "结论解释"]
  },
  probability: {
    correct: "先写出样本空间并判断是否等可能，再计算或用重复试验估计概率",
    hint: "先列清所有可能结果，检查它们是否等可能。",
    strategies: ["样本空间", "等可能性", "频率估计"]
  }
});

const DISTRACTORS = Object.freeze([
  "只记住最终结论，不核对适用条件，也不保留过程",
  "看到熟悉词语就套用公式，不检查对象、单位或图形对应关系",
  "只抄写题目中的数据，把未经验证的直觉直接作为结论"
]);

const DOMAIN_PROFILE = Object.freeze({
  "domain-number-algebra": {
    contextCode: "campus_operation",
    contextLabel: "校园运营与数量关系",
    scenario: "校园义卖、出行或费用方案",
    coreAbilities: ["抽象能力", "运算能力", "模型观念"]
  },
  "domain-geometry": {
    contextCode: "campus_design",
    contextLabel: "校园空间与工程设计",
    scenario: "校园导览、场地测量或图案设计",
    coreAbilities: ["几何直观", "空间观念", "推理能力"]
  },
  "domain-statistics": {
    contextCode: "class_survey",
    contextLabel: "班级调查与数据决策",
    scenario: "班级调查、活动抽样或随机试验",
    coreAbilities: ["数据观念", "推理能力", "应用意识"]
  },
  "domain-practice": {
    contextCode: "school_project",
    contextLabel: "校园真实项目",
    scenario: "校园节能、资源配置或活动改进项目",
    coreAbilities: ["模型观念", "应用意识", "创新意识"]
  }
});

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function hash(...values) {
  return createHash("sha256").update(values.join("\n")).digest("hex");
}

function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function defaultParameters(interactive) {
  return (interactive?.parameters || []).map((parameter) => ({
    key: parameter.key,
    label: parameter.label,
    value: parameter.default
  }));
}

function parameterSummary(interactive) {
  const entries = defaultParameters(interactive);
  return entries.length
    ? entries.map(({ label, value }) => `${label}=${String(value)}`).join("，")
    : "采用图中的默认条件";
}

function guidanceSteps(knowledgePoint, interactive) {
  const source = interactive?.data?.guidance_steps;
  if (Array.isArray(source) && source.length >= 2) return source.slice(0, 5);
  const method = VARIANT_METHOD[interactive?.variant] || VARIANT_METHOD.concept;
  return [
    `识别“${knowledgePoint.name}”涉及的对象与条件`,
    method.correct,
    "写出关键中间过程",
    "检查结论是否满足原条件并解释其意义"
  ];
}

function exactProblem(knowledgePoint, interactive) {
  const model = interactive?.model;
  const title = knowledgePoint.name;
  const numeric = (stem, value, display, ast, steps, turningPoint, alternatives = []) => ({
    public: { stem, questionType: "numeric_response" },
    private: {
      key: { kind: "numeric", value, display, tolerance: 1e-9 },
      verification: { kind: "arithmetic_ast", ast },
      steps,
      turningPoint,
      alternatives
    }
  });
  const text = (stem, value, steps, turningPoint, requiredConcepts = []) => ({
    public: { stem, questionType: "short_response" },
    private: {
      key: { kind: "text", accepted_values: [value], normalization: "trim_spaces_and_punctuation" },
      verification: { kind: "accepted_text", values: [value] },
      steps,
      turningPoint,
      requiredConcepts,
      alternatives: []
    }
  });

  if (model === "power_operations") {
    return numeric("计算 (-3)²，并说明负号为什么也要参与乘方。", 9, "9", { op: "pow", args: [-3, 2] }, ["把 (-3)² 展开为 (-3)×(-3)", "同号相乘得正数", "得到 9"], "括号表示底数是 -3，而不是只对 3 乘方。");
  }
  if (model === "mixed_operations") {
    return numeric("计算 8+3×2，并写出运算顺序。", 14, "14", { op: "add", args: [8, { op: "multiply", args: [3, 2] }] }, ["先算乘法 3×2=6", "再算加法 8+6", "得到 14"], "同级之外先乘除后加减。");
  }
  if (model === "operation_laws") {
    return numeric("用运算律简算 2×(3+4)。", 14, "14", { op: "multiply", args: [2, { op: "add", args: [3, 4] }] }, ["识别乘法分配律结构", "写成 2×3+2×4", "计算得到 14"], "分配时括号内每一项都要与 2 相乘。", ["也可先算括号 3+4=7，再算 2×7=14。"]);
  }
  if (model === "word_problem") {
    return numeric("义卖中每份纪念品 12 元，购买 4 份，付 100 元，应找回多少元？", 52, "52 元", { op: "subtract", args: [100, { op: "multiply", args: [12, 4] }] }, ["总价为 12×4=48 元", "找零为 100-48", "得到 52 元并核对不超过付款额"], "先区分总价和找零两个相反方向的量。");
  }
  if (model === "square_root_inverse") {
    return numeric("求 49 的算术平方根，并用乘方检验。", 7, "7", { op: "sqrt", args: [49] }, ["算术平方根取非负值", "7²=49", "所以结果为 7"], "平方根有正负两个值时，算术平方根只取非负值。");
  }
  if (model === "radical_operations") {
    return numeric("计算 √4×√9。", 6, "6", { op: "multiply", args: [{ op: "sqrt", args: [4] }, { op: "sqrt", args: [9] }] }, ["√4=2", "√9=3", "2×3=6"], "先确认两个被开方数非负，再分别化简。");
  }
  if (model === "expression_builder") {
    return numeric("代数式 2x+3 中，当 x=2 时，求这个代数式的值。", 7, "7", { op: "add", args: [{ op: "multiply", args: [2, 2] }, 3] }, ["把 x=2 代入 2x+3", "计算 2×2+3", "得到 7"], "代入后要保留原有运算顺序。");
  }
  if (model === "formula_builder") {
    return numeric("长方形长 6 cm、宽 4 cm，先写出面积公式，再求面积。", 24, "24 cm²", { op: "multiply", args: [6, 4] }, ["设长为 a、宽为 b，则 S=ab", "代入 a=6、b=4", "S=24 cm²"], "公式中的字母必须与题目数量一一对应。");
  }
  if (model === "substitution_evaluator") {
    return numeric("当 x=4 时，求 3x-2 的值。", 10, "10", { op: "subtract", args: [{ op: "multiply", args: [3, 4] }, 2] }, ["代入 x=4", "计算 3×4-2", "得到 10"], "负号和减号必须随代数式一起保留。");
  }
  if (model === "exponent_laws") {
    return numeric("计算 2³×2²，并说明所用的指数幂性质。", 32, "32", { op: "multiply", args: [{ op: "pow", args: [2, 3] }, { op: "pow", args: [2, 2] }] }, ["同底数幂相乘，指数相加", "2³×2²=2⁵", "2⁵=32"], "只有底数相同时才能直接把指数相加。");
  }
  if (model === "scientific_notation") {
    return numeric("把 3.2×10⁴ 还原成普通数。", 32000, "32000", { op: "multiply", args: [3.2, { op: "pow", args: [10, 4] }] }, ["10⁴=10000", "3.2×10000", "小数点向右移动 4 位得到 32000"], "指数为正时小数点向右移动。");
  }
  if (model === "linear_equation_steps") {
    return numeric("解方程 2x-3=5，并把结果代回检验。", 4, "x=4", { op: "divide", args: [{ op: "add", args: [5, 3] }, 2] }, ["两边同时加 3，得 2x=8", "两边同时除以 2，得 x=4", "代回：2×4-3=5"], "等式两边必须进行同一种变形。");
  }
  if (model === "inequality_interval") {
    return text("把解集 x＞2 表示在数轴上，并写明端点是否取到、射线方向。", "2处空心点，射线向右", ["边界值是 2", "严格大于不包含 2，因此画空心点", "大于 2 的数在右侧，射线向右"], "严格不等号对应空心端点。", ["严格不等号", "数轴方向"]);
  }
  if (model === "linear_slope_intercept") {
    return numeric("一次函数 y=1.5x+1 中，当 x=2 时求 y。", 4, "4", { op: "add", args: [{ op: "multiply", args: [1.5, 2] }, 1] }, ["把 x=2 代入表达式", "计算 1.5×2+1", "得到 y=4"], "点的坐标必须同时满足函数表达式。");
  }
  if (model === "quadratic_vertex_form") {
    return numeric("二次函数 y=0.5x²-1 的顶点纵坐标是多少？", -1, "-1", { op: "subtract", args: [{ op: "multiply", args: [0.5, { op: "pow", args: [0, 2] }] }, 1] }, ["表达式可看作 y=0.5(x-0)²-1", "顶点横坐标为 0", "顶点纵坐标为 -1"], "顶点式中的常数项直接给出顶点纵坐标。");
  }
  if (model === "inverse_proportion_samples") {
    return numeric("反比例函数 y=4/x 中，当 x=2 时求 y。", 2, "2", { op: "divide", args: [4, 2] }, ["把 x=2 代入 y=4/x", "计算 4÷2", "得到 y=2"], "反比例函数的自变量不能取 0。");
  }
  if (model === "right_triangle") {
    return numeric("直角三角形两条直角边长分别为 6 和 8，求斜边长。", 10, "10", { op: "sqrt", args: [{ op: "add", args: [{ op: "pow", args: [6, 2] }, { op: "pow", args: [8, 2] }] }] }, ["确认 6、8 是两条直角边", "由勾股定理 c²=6²+8²=100", "斜边长 c=10"], "必须先确认哪一边是斜边。");
  }
  if (model === "similar_triangles") {
    return numeric("两个相似三角形的相似比为 1.5，原图一条对应边长为 4，求放大后对应边长。", 6, "6", { op: "multiply", args: [4, 1.5] }, ["确认相似比是放大后与原图之比", "对应边成比例", "4×1.5=6"], "先明确相似比的方向，不能直接取倒数。");
  }
  if (model === "circle_elements" && title.includes("位置关系")) {
    return text("圆的半径为 5，点 P 到圆心的距离为 6。判断点 P 与圆的位置关系。", "圆外", ["比较点到圆心距离 d 与半径 r", "d=6，r=5，所以 d＞r", "点 P 在圆外"], "点与圆的位置关系只需比较 d 与 r。", ["点到圆心距离", "半径"]);
  }
  if (model === "inscribed_angle") {
    return numeric("同弧所对圆心角为 120°，求这条弧所对的圆周角。", 60, "60°", { op: "divide", args: [120, 2] }, ["同弧所对圆周角等于圆心角的一半", "120°÷2", "得到 60°"], "必须确认两个角所对的是同一条弧。");
  }
  if (model === "tangent_position") {
    return text("圆的半径为 5，圆心到直线 l 的距离为 6。判断直线 l 与圆的位置关系。", "相离", ["比较圆心到直线距离 d 与半径 r", "d=6＞r=5", "直线与圆相离"], "判断直线与圆的位置关系，应比较圆心到直线的距离而不是任意点距离。", ["圆心到直线距离", "半径"]);
  }
  if (model === "sector_measure") {
    return numeric("半径为 5、圆心角为 120° 的扇形面积是多少？结果保留 π。", (25 * Math.PI) / 3, "25π/3", { op: "multiply", args: [{ op: "divide", args: [120, 360] }, { op: "multiply", args: [Math.PI, { op: "pow", args: [5, 2] }] }] }, ["扇形占整圆的 120/360", "S=(120/360)×π×5²", "化简为 25π/3"], "圆心角所占比例必须除以 360°。");
  }
  if (model === "axis_reflection") {
    return text("点 P(3,2) 关于 x 轴对称后的坐标是什么？", "(3,-2)", ["关于 x 轴对称时横坐标不变", "纵坐标变为相反数", "得到 (3,-2)"], "要先确认对称轴是 x 轴还是 y 轴。", ["轴对称坐标规律"]);
  }
  if (model === "rotation") {
    return text("点 P(3,2) 绕原点逆时针旋转 90° 后的坐标是什么？", "(-2,3)", ["逆时针旋转 90° 使用 (x,y)→(-y,x)", "代入 (3,2)", "得到 (-2,3)"], "旋转方向决定坐标符号。");
  }
  if (model === "central_symmetry") {
    return text("点 P(3,2) 关于原点中心对称后的坐标是什么？", "(-3,-2)", ["关于原点中心对称时两个坐标都取相反数", "(3,2)→(-3,-2)", "用中点为原点检验"], "中心对称相当于绕中心旋转 180°。");
  }
  if (model === "coordinate_transformation") {
    return text("点 P(2,1) 先向右平移 2 个单位，再向下平移 1 个单位，所得坐标是什么？", "(4,0)", ["向右使横坐标加 2", "向下使纵坐标减 1", "(2+2,1-1)=(4,0)"], "水平变化作用于横坐标，竖直变化作用于纵坐标。");
  }
  if (model === "transform_composition") {
    return text("点 P(2,1) 先向右平移 2、向下平移 1，再关于 x 轴对称，所得坐标是什么？", "(4,0)", ["平移后得到 (4,0)", "关于 x 轴对称，横坐标不变、纵坐标取相反数", "仍为 (4,0)"], "复合变换必须严格按给定顺序执行。");
  }
  if (model === "dilation") {
    return text("以原点为位似中心，位似比为 1.5，点 P(3,2) 的对应点坐标是什么？", "(4.5,3)", ["原点位似时两个坐标同乘位似比", "(3×1.5,2×1.5)", "得到 (4.5,3)"], "位似比需要同时作用在两个坐标上。");
  }
  if (model === "descriptive_statistics" && /平均数|中位数|众数/.test(title)) {
    return text("数据 2、4、4、6、9 的平均数、中位数和众数分别是多少？", "5，4，4", ["总和 25，平均数 25÷5=5", "排序后中间数为 4", "出现次数最多的数为 4"], "三种集中趋势量的定义不同，不能互相替代。", ["平均数", "中位数", "众数"]);
  }
  if (model === "equally_likely_outcomes") {
    return text("掷一枚均匀六面骰子一次，点数为偶数的概率是多少？", "1/2", ["样本空间为 1、2、3、4、5、6", "偶数结果为 2、4、6，共 3 个", "概率为 3/6=1/2"], "只有确认六个结果等可能后才能用结果数之比计算。", ["等可能结果", "样本空间"]);
  }
  return null;
}

function buildConceptItem(knowledgePoint, artifact, identifiers) {
  const interactive = artifact.interactive || {};
  const method = VARIANT_METHOD[interactive.variant] || VARIANT_METHOD.concept;
  const correctIndex = Number.parseInt(hash(knowledgePoint.id).slice(0, 8), 16) % 4;
  const optionTexts = [...DISTRACTORS];
  optionTexts.splice(correctIndex, 0, method.correct);
  const options = optionTexts.map((text, index) => ({
    id: String.fromCharCode(65 + index),
    text
  }));
  const correctOptionId = options[correctIndex].id;
  return {
    public: {
      ...identifiers,
      title: `${knowledgePoint.name}｜方法辨析`,
      stem: `解决与“${knowledgePoint.name}”有关的问题时，下列哪一种做法最可靠？`,
      question_type: "single_choice",
      question_type_label: TYPE_LABELS.single_choice,
      options,
      response_spec: { mode: "select_one", option_count: 4 }
    },
    private: {
      ...identifiers,
      key: { kind: "option_id", value: correctOptionId },
      verification: { kind: "option_membership", option_ids: options.map((option) => option.id) },
      solution_steps: [
        { order: 1, title: "识别目标", detail: `题目考查的是处理“${knowledgePoint.name}”时的方法选择。` },
        { order: 2, title: "核对依据", detail: method.correct },
        { order: 3, title: "排除干扰", detail: "其余做法都缺少条件核对、过程证据或结果验证。" }
      ],
      key_turning_point: "可靠的数学方法必须同时保留条件、过程和验证证据。",
      common_errors: [
        { error: "凭关键词套公式", cause: "没有核对定义或定理的适用条件", feedback: "先圈出条件，再选择规则。" },
        { error: "只写最终结论", cause: "过程不可核验", feedback: "至少补出关键中间步骤和依据。" }
      ],
      alternative_solutions: []
    }
  };
}

function buildMethodItem(knowledgePoint, artifact, identifiers) {
  const interactive = artifact.interactive || {};
  const exact = exactProblem(knowledgePoint, interactive);
  const method = VARIANT_METHOD[interactive.variant] || VARIANT_METHOD.concept;
  if (exact) {
    return {
      public: {
        ...identifiers,
        title: `${knowledgePoint.name}｜方法练习`,
        stem: exact.public.stem,
        question_type: exact.public.questionType,
        question_type_label: TYPE_LABELS[exact.public.questionType],
        options: [],
        response_spec: { mode: exact.public.questionType === "numeric_response" ? "enter_number" : "enter_text" }
      },
      private: {
        ...identifiers,
        key: exact.private.key,
        verification: exact.private.verification,
        solution_steps: exact.private.steps.map((detail, index) => ({ order: index + 1, title: `步骤 ${index + 1}`, detail })),
        key_turning_point: exact.private.turningPoint,
        common_errors: [
          { error: "跳过对象或条件识别", cause: "直接计算导致规则使用错位", feedback: method.hint },
          { error: "得到结果后不检验", cause: "忽略符号、单位或原条件", feedback: "把结果代回或用图形关系复核。" }
        ],
        alternative_solutions: exact.private.alternatives.map((detail, index) => ({ name: `可选方法 ${index + 1}`, steps: [detail] }))
      }
    };
  }

  const steps = guidanceSteps(knowledgePoint, interactive);
  const defaults = parameterSummary(interactive);
  return {
    public: {
      ...identifiers,
      title: `${knowledgePoint.name}｜互动探究`,
      stem: `在“${artifact.title}”互动图中使用默认条件（${defaults}）。按图中变化完成“${knowledgePoint.name}”，记录一个关键观察，并说明你的判断依据。`,
      question_type: "short_response",
      question_type_label: TYPE_LABELS.short_response,
      options: [],
      response_spec: { mode: "enter_text", expected_sections: ["观察", "过程", "依据", "检验"] }
    },
    private: {
      ...identifiers,
      key: {
        kind: "rubric",
        required_concepts: [knowledgePoint.name, ...steps.slice(0, 3)],
        sample_response: `示例作答应围绕“${knowledgePoint.name}”，使用默认条件 ${defaults}，写出观察、关键过程、所用依据和检验。答案可有不同表述。`
      },
      verification: { kind: "rubric_review", auto_gradable: false },
      solution_steps: steps.map((detail, index) => ({ order: index + 1, title: `步骤 ${index + 1}`, detail })),
      key_turning_point: method.correct,
      common_errors: [
        { error: "只描述图形变化，不说明依据", cause: "观察与知识点没有建立联系", feedback: "指出变化对应的定义、性质或运算规则。" },
        { error: "只操作一次就下结论", cause: "没有比较或检验", feedback: "至少改变一个参数并复核结论是否保持。" }
      ],
      alternative_solutions: []
    }
  };
}

function buildApplicationItem(knowledgePoint, artifact, identifiers, domainProfile) {
  const interactive = artifact.interactive || {};
  const method = VARIANT_METHOD[interactive.variant] || VARIANT_METHOD.concept;
  const steps = guidanceSteps(knowledgePoint, interactive);
  return {
    public: {
      ...identifiers,
      title: `${knowledgePoint.name}｜迁移应用`,
      stem: `在“${domainProfile.scenario}”中设计并解决一个必须运用“${knowledgePoint.name}”的问题。请给出合理数据或图形条件，完成求解，并解释结果为什么符合实际情境。`,
      question_type: "extended_response",
      question_type_label: TYPE_LABELS.extended_response,
      options: [],
      response_spec: { mode: "enter_structured_text", expected_sections: ["问题与条件", "数学表示", "求解过程", "情境解释"] }
    },
    private: {
      ...identifiers,
      key: {
        kind: "rubric",
        required_concepts: [knowledgePoint.name, "条件完整", "过程可核验", "结论符合情境"],
        sample_response: `示例方案应从${domainProfile.scenario}提出可计算或可论证的问题，明确数据与条件，运用“${knowledgePoint.name}”完成求解，并检查单位、范围或图形条件。开放题不限定唯一数据。`
      },
      verification: { kind: "rubric_review", auto_gradable: false },
      solution_steps: [
        { order: 1, title: "提出问题", detail: `从${domainProfile.scenario}中明确待求量或待证结论。` },
        { order: 2, title: "建立表示", detail: `把现实条件转换为与“${knowledgePoint.name}”一致的数、式、图或统计对象。` },
        { order: 3, title: "求解与论证", detail: steps.slice(0, 3).join("；") },
        { order: 4, title: "解释与检验", detail: "回到情境检查单位、取值范围、精度和结论合理性。" }
      ],
      key_turning_point: method.correct,
      common_errors: [
        { error: "情境中缺少必要数据", cause: "问题无法唯一求解或验证", feedback: "补齐对象、数量、单位和约束条件。" },
        { error: "算出数值后直接结束", cause: "没有回到真实情境解释", feedback: "说明结果的单位、范围和实际含义。" }
      ],
      alternative_solutions: [{ name: "替代建模路径", steps: ["可更换合理数据或表示方式，但必须仍然考查同一知识点并给出完整验证。"] }]
    }
  };
}

function masteryAbility(knowledgeForm, variantCode) {
  if (variantCode === "concept") return "understand";
  if (variantCode === "application") return "transfer_and_model";
  if (knowledgeForm === "reasoning_proof") return "analyze_and_prove";
  if (knowledgeForm === "application_modeling") return "apply_and_model";
  return "apply";
}

function difficulty(knowledgePoint, variantCode) {
  if (variantCode === "concept") return { code: "foundation", label: "基础" };
  if (variantCode === "application") return { code: knowledgePoint.optional ? "advanced" : "intermediate", label: knowledgePoint.optional ? "进阶" : "中等" };
  return { code: knowledgePoint.knowledge_form === "reasoning_proof" ? "intermediate" : "foundation", label: knowledgePoint.knowledge_form === "reasoning_proof" ? "中等" : "基础" };
}

function propositionMethod(variantCode) {
  if (variantCode === "concept") return { code: "method_discrimination", label: "方法辨析" };
  if (variantCode === "method") return { code: "controlled_parameter_practice", label: "参数化方法练习" };
  return { code: "authentic_context_modeling", label: "真实情境建模" };
}

function relatedKnowledge(knowledgePoint, ontology, byId) {
  const ids = new Set();
  for (const edge of ontology.edges) {
    if (edge.type === "prerequisite_of" && edge.target === knowledgePoint.id && byId.has(edge.source)) ids.add(edge.source);
    if (edge.type === "strongly_related_to") {
      if (edge.source === knowledgePoint.id && byId.has(edge.target)) ids.add(edge.target);
      if (edge.target === knowledgePoint.id && byId.has(edge.source)) ids.add(edge.source);
    }
  }
  return [...ids].slice(0, 4).map((id) => ({ id, name: byId.get(id).name }));
}

function commonPublicFields(knowledgePoint, artifact, ontology, variant, byId) {
  const domain = ontology.domains.find((item) => item.id === knowledgePoint.domain_id);
  const theme = ontology.themes.find((item) => item.id === knowledgePoint.theme_id);
  const domainProfile = DOMAIN_PROFILE[knowledgePoint.domain_id] || DOMAIN_PROFILE["domain-practice"];
  const method = VARIANT_METHOD[artifact.interactive?.variant] || VARIANT_METHOD.concept;
  return {
    item_status: "draft",
    version: "1.0.0",
    variant: { code: variant.code, label: variant.label },
    difficulty: difficulty(knowledgePoint, variant.code),
    proposition_method: propositionMethod(variant.code),
    ability_level: masteryAbility(knowledgePoint.knowledge_form, variant.code),
    core_abilities: domainProfile.coreAbilities,
    context: {
      code: variant.code === "application" ? domainProfile.contextCode : "pure_math",
      label: variant.code === "application" ? domainProfile.contextLabel : "数学学习"
    },
    knowledge_point_mapping: [{
      id: knowledgePoint.id,
      name: knowledgePoint.name,
      role: "primary",
      weight: 1
    }],
    related_knowledge_points: relatedKnowledge(knowledgePoint, ontology, byId),
    curriculum_ref: {
      ontology_id: ontology.ontology_id,
      ontology_version: ontology.ontology_version,
      theme_id: theme?.id,
      theme_name: theme?.name,
      domain_id: domain?.id,
      domain_name: domain?.name,
      document_id: knowledgePoint.source_ref?.document_id,
      printed_page: knowledgePoint.source_ref?.printed_page
    },
    artifact_ref: {
      artifact_id: artifact.artifact_id,
      interactive_variant: artifact.interactive?.variant,
      interactive_model: artifact.interactive?.model
    },
    solution_preview: {
      strategy_labels: method.strategies,
      first_hint: method.hint,
      full_solution_access: "server_controlled",
      has_full_solution: true
    },
    provenance: {
      seed: true,
      generated: true,
      generator: `compile-junior-math-question-bank.mjs@${SCRIPT_VERSION}`,
      source_kind: "curriculum_grounded_seed",
      official_exam_question: false,
      disclaimer: "本题为系统生成的课标对齐种子题，不是官方真题。",
      review_status: "pending_teacher_review"
    },
    quality: {
      schema_status: "validated",
      content_status: "generated_pending_review",
      answer_consistency_status: variant.code === "concept" ? "deterministic_checked" : "checked_by_private_key",
      publishable: false
    }
  };
}

function commonPrivateFields(publicItem, artifact, verification) {
  const deterministic = ["option_membership", "arithmetic_ast", "accepted_text"].includes(verification?.kind);
  return {
    storage_classification: "server_private",
    question_version: publicItem.version,
    knowledge_point_id: publicItem.knowledge_point_mapping[0].id,
    curriculum_basis: {
      outline_description: artifact.source?.outline_description,
      verbatim_text: artifact.source?.verbatim_text,
      clause_locator: artifact.source?.clause_locator,
      printed_pages: artifact.source?.printed_pages || []
    },
    scoring: {
      max_score: publicItem.question_type === "extended_response" ? 8 : publicItem.question_type === "short_response" ? 4 : 2,
      partial_credit: !deterministic,
      requires_human_review: !deterministic
    },
    review: {
      seed: true,
      generated: true,
      review_status: "pending_teacher_review",
      solver_status: deterministic ? "deterministic_checked" : "rubric_defined_human_review_required"
    }
  };
}

function evaluateAst(node) {
  if (typeof node === "number") return node;
  if (!node || typeof node !== "object" || !Array.isArray(node.args)) throw new Error("Invalid arithmetic AST");
  const values = node.args.map(evaluateAst);
  if (node.op === "add") return values.reduce((total, value) => total + value, 0);
  if (node.op === "subtract") return values[0] - values[1];
  if (node.op === "multiply") return values.reduce((total, value) => total * value, 1);
  if (node.op === "divide") return values[0] / values[1];
  if (node.op === "pow") return values[0] ** values[1];
  if (node.op === "sqrt") return Math.sqrt(values[0]);
  throw new Error(`Unsupported arithmetic operation: ${node.op}`);
}

function validateOutput(publicBank, privateBank, ontology) {
  const knowledgeIds = new Set(ontology.knowledge_points.map((item) => item.id));
  const publicIds = new Set();
  const privateIds = new Set();
  const counts = new Map();
  for (const item of publicBank.items) {
    if (!/^JMQ-M4-[A-Z]+-[A-Z]+-\d{2}-(C01|M01|A01)$/.test(item.id)) throw new Error(`Unstable item id: ${item.id}`);
    if (publicIds.has(item.id)) throw new Error(`Duplicate public id: ${item.id}`);
    publicIds.add(item.id);
    const primary = item.knowledge_point_mapping?.find((mapping) => mapping.role === "primary");
    if (!primary || !knowledgeIds.has(primary.id)) throw new Error(`Invalid knowledge mapping: ${item.id}`);
    counts.set(primary.id, (counts.get(primary.id) || 0) + 1);
    if (item.provenance.official_exam_question !== false || item.provenance.review_status !== "pending_teacher_review") throw new Error(`Invalid provenance: ${item.id}`);
  }
  for (const id of knowledgeIds) if (counts.get(id) !== 3) throw new Error(`Expected 3 items for ${id}, got ${counts.get(id) || 0}`);
  for (const item of privateBank.items) {
    if (privateIds.has(item.question_id)) throw new Error(`Duplicate private id: ${item.question_id}`);
    privateIds.add(item.question_id);
    if (item.verification?.kind === "arithmetic_ast") {
      const computed = evaluateAst(item.verification.ast);
      if (Math.abs(computed - item.key.value) > (item.key.tolerance ?? 1e-9)) throw new Error(`Arithmetic key mismatch: ${item.question_id}`);
    }
  }
  if (publicIds.size !== privateIds.size || [...publicIds].some((id) => !privateIds.has(id))) throw new Error("Public/private item ids do not align");
  const bannedPublicKeys = /^(answer|answer_key|correct_answer|correct_option_id|final_answer|analysis|explanation|solution_steps|key_turning_point|common_errors|alternative_solutions)$/i;
  const inspect = (value, trail = "root") => {
    if (Array.isArray(value)) return value.forEach((entry, index) => inspect(entry, `${trail}[${index}]`));
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (bannedPublicKeys.test(key)) throw new Error(`Private key leaked into public output at ${trail}.${key}`);
      inspect(entry, `${trail}.${key}`);
    }
  };
  inspect(publicBank);
}

function publicSchema() {
  return {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://local.ai-classroom/schemas/junior-math-question-bank.schema.json",
    title: "JuniorMathQuestionBankPublic",
    description: "学生端可读取的题面、题目属性、知识点映射与不泄答案的解题预览。",
    type: "object",
    required: ["schema_version", "bank_id", "version", "items"],
    properties: {
      schema_version: { const: "assessment-item-public-bank@1.0" },
      bank_id: { type: "string" },
      version: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "stem", "question_type", "knowledge_point_mapping", "provenance", "quality"],
          properties: {
            id: { type: "string", pattern: "^JMQ-M4-" },
            stem: { type: "string", minLength: 8 },
            question_type: { enum: Object.keys(TYPE_LABELS) },
            options: { type: "array" },
            knowledge_point_mapping: { type: "array", minItems: 1 },
            solution_preview: { type: "object", description: "仅包含策略标签和首层提示，不包含答案或完整解法。" },
            provenance: { type: "object" },
            quality: { type: "object" }
          },
          additionalProperties: true
        }
      }
    },
    additionalProperties: true
  };
}

function privateSchema() {
  return {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://local.ai-classroom/schemas/junior-math-question-bank-private.schema.json",
    title: "JuniorMathQuestionBankPrivate",
    description: "仅服务端读取的答案、完整解题计划、常见错误、评分与课程依据。不得由静态目录直接提供。",
    type: "object",
    required: ["schema_version", "storage_classification", "public_bank_ref", "items"],
    properties: {
      schema_version: { const: "assessment-key-private-bank@1.0" },
      storage_classification: { const: "server_private" },
      public_bank_ref: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["question_id", "key", "solution_plan", "scoring", "review"],
          properties: {
            question_id: { type: "string", pattern: "^JMQ-M4-" },
            key: { type: "object" },
            solution_plan: {
              type: "object",
              required: ["steps", "key_turning_point", "common_errors", "alternative_solutions"]
            },
            scoring: { type: "object" },
            review: { type: "object" }
          },
          additionalProperties: true
        }
      }
    },
    additionalProperties: true
  };
}

async function compile() {
  const [ontologyText, visualsText] = await Promise.all([
    readFile(INPUTS.ontology, "utf8"),
    readFile(INPUTS.visuals, "utf8")
  ]);
  const ontology = JSON.parse(ontologyText);
  const visuals = JSON.parse(visualsText);
  const byId = new Map(ontology.knowledge_points.map((item) => [item.id, item]));
  const artifactsByPoint = new Map(visuals.artifacts.map((item) => [item.knowledge_point_id, item]));
  const publicItems = [];
  const privateItems = [];

  for (const knowledgePoint of ontology.knowledge_points) {
    const artifact = artifactsByPoint.get(knowledgePoint.id);
    if (!artifact) throw new Error(`Missing visual artifact for ${knowledgePoint.id}`);
    const domainProfile = DOMAIN_PROFILE[knowledgePoint.domain_id] || DOMAIN_PROFILE["domain-practice"];
    for (const variant of QUESTION_VARIANTS) {
      const id = `JMQ-${knowledgePoint.id}-${variant.suffix}`;
      const identifiers = { id, knowledge_point_id: knowledgePoint.id };
      const built = variant.code === "concept"
        ? buildConceptItem(knowledgePoint, artifact, identifiers)
        : variant.code === "method"
          ? buildMethodItem(knowledgePoint, artifact, identifiers)
          : buildApplicationItem(knowledgePoint, artifact, identifiers, domainProfile);
      const publicItem = {
        ...commonPublicFields(knowledgePoint, artifact, ontology, variant, byId),
        ...built.public
      };
      publicItem.quality.answer_consistency_status = ["option_membership", "arithmetic_ast", "accepted_text"].includes(built.private.verification?.kind)
        ? "deterministic_checked"
        : "rubric_defined_human_review_required";
      const privateItem = {
        question_id: id,
        ...commonPrivateFields(publicItem, artifact, built.private.verification),
        key: built.private.key,
        verification: built.private.verification,
        solution_plan: {
          steps: built.private.solution_steps,
          key_turning_point: built.private.key_turning_point,
          common_errors: built.private.common_errors,
          alternative_solutions: built.private.alternative_solutions,
          explanation: built.private.key.kind === "rubric"
            ? built.private.key.sample_response
            : `按步骤完成并得到与判题密钥一致的结果；完整过程仅在服务端按权限返回。`
        }
      };
      publicItems.push(publicItem);
      privateItems.push(privateItem);
    }
  }

  const fingerprint = hash(ontologyText, visualsText, SCRIPT_VERSION, BANK_VERSION);
  const publicBank = {
    schema_version: "assessment-item-public-bank@1.0",
    schema_ref: "./junior-math-question-bank.schema.json",
    bank_id: "junior-math-moe-2022-seed-bank",
    version: BANK_VERSION,
    compiled_at: COMPILED_AT,
    build_fingerprint: fingerprint,
    ontology_ref: { id: ontology.ontology_id, version: ontology.ontology_version },
    provenance: {
      source_type: "curriculum_grounded_deterministic_seed",
      seed: true,
      generated: true,
      official_exam_question: false,
      review_status: "pending_teacher_review",
      disclaimer: "全部题目均为本地编译器生成的种子题，不宣称为教材原题或官方真题；教师审核前不得发布为正式题库。"
    },
    privacy_contract: {
      contains_answer_keys: false,
      contains_full_solutions: false,
      private_bank_location: "server:data/junior-math-question-bank-private.json",
      full_solution_delivery: "authenticated_server_endpoint_only"
    },
    statistics: {
      knowledge_point_count: ontology.knowledge_points.length,
      item_count: publicItems.length,
      items_per_knowledge_point: QUESTION_VARIANTS.length,
      variant_counts: Object.fromEntries(QUESTION_VARIANTS.map((variant) => [variant.code, publicItems.filter((item) => item.variant.code === variant.code).length])),
      question_type_counts: Object.fromEntries(Object.keys(TYPE_LABELS).map((type) => [type, publicItems.filter((item) => item.question_type === type).length]))
    },
    items: publicItems
  };
  const privateBank = {
    schema_version: "assessment-key-private-bank@1.0",
    schema_ref: "./junior-math-question-bank-private.schema.json",
    storage_classification: "server_private",
    bank_id: "junior-math-moe-2022-seed-bank-private",
    version: BANK_VERSION,
    compiled_at: COMPILED_AT,
    build_fingerprint: fingerprint,
    public_bank_ref: "public/data/junior-math-question-bank.json",
    access_contract: {
      static_serving_allowed: false,
      authenticated_access_required: true,
      reveal_policy: "after_attempt_or_explicit_solution_request",
      audit_required: true
    },
    statistics: { item_count: privateItems.length },
    items: privateItems
  };
  validateOutput(publicBank, privateBank, ontology);
  return new Map([
    [OUTPUTS.publicBank, json(publicBank)],
    [OUTPUTS.publicSchema, json(publicSchema())],
    [OUTPUTS.privateBank, json(privateBank)],
    [OUTPUTS.privateSchema, json(privateSchema())]
  ]);
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const outputs = await compile();
  for (const [filename, content] of outputs) {
    if (checkOnly) {
      let existing;
      try {
        existing = await readFile(filename, "utf8");
      } catch {
        throw new Error(`Missing compiled output: ${path.relative(ROOT, filename)}`);
      }
      if (existing !== content) throw new Error(`Compiled output is stale: ${path.relative(ROOT, filename)}`);
    } else {
      await writeFile(filename, content, "utf8");
    }
  }
  const mode = checkOnly ? "checked" : "compiled";
  console.log(`Junior math question bank ${mode}: 140 knowledge points, 420 public items, 420 private keys.`);
}

await main();
