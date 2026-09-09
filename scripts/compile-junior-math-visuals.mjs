import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  KNOWLEDGE_CARD_PARAMETER_SCHEMA_VERSION,
  assertKnowledgeCardParameterization,
  createKnowledgeCardParameterization,
  createStaticKnowledgeCardParameterization
} from "../public/knowledge-card-parameter-contract.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = dirname(dirname(SCRIPT_PATH));
const DEFAULT_ONTOLOGY_PATH = resolve(PROJECT_ROOT, "public/data/junior-math-ontology.json");
const DEFAULT_CURRICULUM_QUOTES_PATH = resolve(PROJECT_ROOT, "public/data/junior-math-curriculum-quotes.json");
const DEFAULT_OUTPUT_PATH = resolve(PROJECT_ROOT, "public/data/junior-math-visual-artifacts.json");

export const EXPECTED_KNOWLEDGE_POINT_COUNT = 140;
export const ARTIFACT_SCHEMA_VERSION = "junior-math-visual-artifacts@1.0";
export const ARTIFACT_VERSION = "junior-math-moe-2022-visuals@1.3";
export const MINDMAP_SCHEMA_VERSION = "education-mindmap@1.0";
export const INTERACTIVE_SCHEMA_VERSION = "junior-math-interactive@1.0";
export const INTERACTIVE_RENDERER = "junior-math-controlled";

export const INTERACTIVE_VARIANTS = Object.freeze([
  "linear",
  "quadratic",
  "numberline",
  "triangle",
  "circle",
  "coordinate",
  "statistics",
  "probability",
  "algebra",
  "concept"
]);

export const COMPILER_LIMITS = Object.freeze({
  expected_artifact_count: EXPECTED_KNOWLEDGE_POINT_COUNT,
  max_mindmap_branches: 4,
  // A branch may reference every other knowledge point. This is a safety bound,
  // not a presentation limit; the UI decides whether to collapse long branches.
  max_mindmap_children_per_branch: EXPECTED_KNOWLEDGE_POINT_COUNT,
  max_parameters: 6,
  max_parameter_steps: 500,
  max_data_array_items: 32,
  max_string_length: 240,
  // The closed input Schema adds trusted object layers on top of the original
  // visual payload. The parameter contract validates those layers separately;
  // this remains the compiler's hard serialization-depth bound.
  max_data_depth: 10,
  numeric_min: -1000,
  numeric_max: 1000
});

const RELATION_LABELS = Object.freeze({
  prerequisite_of: "先修",
  strongly_related_to: "强关联",
  applied_with: "联合应用",
  equivalent_view_of: "等价视角",
  represented_by: "可表示为",
  supported_by: "由……支撑",
  applied_in: "应用于",
  derived_from: "推导自",
  specializes: "特化",
  equivalent_to: "等价",
  contrasts_with: "对照区别"
});

const RELATION_PRIORITY = Object.freeze([
  "strongly_related_to",
  "applied_with",
  "equivalent_view_of",
  "represented_by",
  "supported_by",
  "derived_from",
  "specializes",
  "equivalent_to",
  "contrasts_with",
  "applied_in"
]);

const VARIANT_INSTRUCTIONS = Object.freeze({
  linear: "调节斜率与截距，观察直线的位置和变化趋势。",
  quadratic: "调节开口、对称轴和顶点，观察抛物线及最值变化。",
  numberline: "调节数值或区间边界，观察数在数轴上的位置关系。",
  triangle: "调节边长、角度或相似比，观察三角形关系保持与变化。",
  circle: "调节半径、角度或位置，观察圆中量与位置关系。",
  coordinate: "调节坐标或变换参数，观察图形与数量关系。",
  statistics: "调整样本或分组方式，比较数据分布和数字特征。",
  probability: "调整试验次数并观察频率变化，理解概率的稳定性。",
  algebra: "调节系数并逐步变形，观察代数关系保持不变。",
  concept: "按步骤切换条件、过程与结论，梳理概念和推理结构。"
});

function dedicatedVisualProfile(variant, model, steps) {
  return Object.freeze({
    variant,
    model,
    steps: Object.freeze(steps)
  });
}

// These points previously fell through broad prefix rules and rendered a
// different mathematical object (for example, rotation as translation). Keep
// the mapping explicit so no future broad prefix rule can regress the model.
export const HIGH_RISK_VISUAL_PROFILES = Object.freeze({
  "M4-NA-RAT-04": dedicatedVisualProfile("algebra", "power_operations", ["识别底数和指数", "展开乘方", "按符号规则计算", "检查结果"]),
  "M4-NA-RAT-05": dedicatedVisualProfile("algebra", "mixed_operations", ["确定运算顺序", "处理括号与乘方", "完成乘除和加减", "估算并检查"]),
  "M4-NA-RAT-06": dedicatedVisualProfile("algebra", "operation_laws", ["识别算式结构", "选择运算律", "进行等价变形", "验证简化结果"]),
  "M4-NA-RAT-07": dedicatedVisualProfile("algebra", "word_problem", ["提取相反意义的量", "建立有理数算式", "计算并解释", "检验实际合理性"]),
  "M4-NA-REAL-03": dedicatedVisualProfile("algebra", "square_root_inverse", ["区分平方根与算术平方根", "识别立方根", "使用根号表示", "用乘方检验"]),
  "M4-NA-REAL-04": dedicatedVisualProfile("algebra", "square_root_inverse", ["识别乘方关系", "转化为开方问题", "判断根的符号", "代回验证"]),
  "M4-NA-REAL-05": dedicatedVisualProfile("algebra", "square_root_inverse", ["判断结果范围", "输入开方运算", "按精度取值", "解释数值意义"]),
  "M4-NA-REAL-08": dedicatedVisualProfile("algebra", "radical_operations", ["化为最简二次根式", "识别同类根式", "完成四则运算", "检查结果形式"]),
  "M4-NA-ALG-01": dedicatedVisualProfile("algebra", "expression_builder", ["识别数量和变量", "用字母表示", "组成代数式", "解释代数式意义"]),
  "M4-NA-ALG-02": dedicatedVisualProfile("algebra", "formula_builder", ["分析数量关系", "选择字母", "写出代数式或公式", "用情境检验"]),
  "M4-NA-ALG-03": dedicatedVisualProfile("algebra", "substitution_evaluator", ["确认字母取值", "代入代数式", "按顺序计算", "核对单位和结果"]),
  "M4-NA-ALG-04": dedicatedVisualProfile("algebra", "exponent_laws", ["识别幂的结构", "选择指数律", "等价变形", "用数值检验"]),
  "M4-NA-ALG-05": dedicatedVisualProfile("algebra", "scientific_notation", ["确定数的量级", "移动小数点", "写出 10 的整数次幂", "还原检查"]),
  "M4-GE-TRANS-01": dedicatedVisualProfile("coordinate", "axis_reflection", ["确定对称轴", "作点到对称轴的垂线", "取等距离对应点", "验证连线被垂直平分"]),
  "M4-GE-TRANS-02": dedicatedVisualProfile("coordinate", "axis_reflection", ["识别关键点", "逐点作轴对称点", "按原顺序连接", "检查对应边与角"]),
  "M4-GE-TRANS-03": dedicatedVisualProfile("coordinate", "rotation", ["确定旋转中心", "确定方向和旋转角", "作等距离对应点", "检查对应夹角"]),
  "M4-GE-TRANS-04": dedicatedVisualProfile("coordinate", "central_symmetry", ["确定对称中心", "连接原点与对应点", "使中心平分连线", "验证 180° 旋转"]),
  "M4-GE-TRANS-06": dedicatedVisualProfile("coordinate", "transform_composition", ["选择第一次变换", "记录中间图形", "执行后续变换", "比较不变量与最终位置"]),
  "M4-GE-PROJ-01": dedicatedVisualProfile("coordinate", "projection_rays", ["确定投射中心或方向", "连接物点与投影线", "求与投影面的交点", "比较中心与平行投影"]),
  "M4-GE-PROJ-02": dedicatedVisualProfile("coordinate", "orthographic_views", ["确定观察方向", "识别可见轮廓", "对齐三个视图", "反向检验几何体"]),
  "M4-GE-PROJ-03": dedicatedVisualProfile("concept", "solid_net", ["识别几何体的面", "判断相邻关系", "展开或折叠", "检查重叠与缺面"]),
  "M4-GC-COORD-05": dedicatedVisualProfile("coordinate", "dilation", ["确定位似中心", "确定位似比", "按倍数变换坐标", "验证对应点共线"])
});

function fail(message) {
  throw new Error(`[junior-math-visuals] ${message}`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
  if (value.length > COMPILER_LIMITS.max_string_length) fail(`${label} exceeds string limit`);
  return value.trim();
}

function range(key, label, min, max, step, defaultValue, extra = {}) {
  return { key, label, control: "range", min, max, step, default: defaultValue, ...extra };
}

function select(key, label, choices, defaultValue) {
  return {
    key,
    label,
    control: "select",
    choices: choices.map(([value, choiceLabel]) => ({ value, label: choiceLabel })),
    default: defaultValue
  };
}

function toggle(key, label, defaultValue) {
  return { key, label, control: "toggle", default: defaultValue };
}

function resolveVariant(point) {
  const id = point.id;
  if (/^M4-NA-FUN-(10|11|12)$/u.test(id)) return "quadratic";
  if (/^M4-NA-FUN-(06|07|08|09)$/u.test(id)) return "linear";
  if (id.startsWith("M4-ST-PROB-")) return "probability";
  if (id.startsWith("M4-ST-DATA-")) return "statistics";
  if (id.startsWith("M4-GE-CIR-")) return "circle";
  if (id.startsWith("M4-GE-TRI-") || id.startsWith("M4-GE-SIM-")) return "triangle";
  if (
    id.startsWith("M4-GC-COORD-") ||
    id.startsWith("M4-GE-TRANS-") ||
    id.startsWith("M4-GE-PROJ-") ||
    id.startsWith("M4-NA-FUN-")
  ) return "coordinate";
  if (
    id.startsWith("M4-NA-RAT-") ||
    id.startsWith("M4-NA-REAL-") ||
    id.startsWith("M4-NA-INEQ-")
  ) return "numberline";
  if (id.startsWith("M4-NA-ALG-") || id.startsWith("M4-NA-EQ-")) return "algebra";
  return "concept";
}

function linearSpec() {
  return {
    model: "linear_slope_intercept",
    viewport: { x_min: -6, x_max: 6, y_min: -6, y_max: 6, grid_step: 1 },
    parameters: [
      range("slope", "斜率 k", -4, 4, 0.25, 1.5),
      range("intercept", "截距 b", -5, 5, 0.5, 1)
    ],
    annotations: ["x_intercept", "y_intercept", "monotonicity"]
  };
}

function quadraticSpec() {
  return {
    model: "quadratic_vertex_form",
    viewport: { x_min: -6, x_max: 6, y_min: -6, y_max: 6, grid_step: 1 },
    parameters: [
      range("a_magnitude", "开口系数绝对值", 0.25, 2, 0.25, 0.5),
      select("opening", "开口方向", [["up", "向上"], ["down", "向下"]], "up"),
      range("vertex_x", "对称轴 h", -3, 3, 0.5, 0),
      range("vertex_y", "顶点纵坐标 k", -3, 3, 0.5, -1)
    ],
    annotations: ["vertex", "symmetry_axis", "extreme_value"]
  };
}

function numberlineSpec(point) {
  const inequality = /不等|解集/u.test(point.name);
  if (inequality) {
    return {
      model: "inequality_interval",
      viewport: { min: -10, max: 10, tick_step: 1 },
      parameters: [
        range("boundary", "边界值", -9, 9, 0.5, 2),
        select("direction", "解集方向", [["less", "小于"], ["greater", "大于"]], "greater"),
        toggle("closed", "包含边界值", false)
      ],
      annotations: ["boundary", "interval_direction"]
    };
  }
  return {
    model: "ordered_points",
    viewport: { min: -10, max: 10, tick_step: 1 },
    parameters: [
      range("point_a", "数 A", -9, 9, 0.5, -2),
      range("point_b", "数 B", -9, 9, 0.5, 3)
    ],
    annotations: ["origin", "distance", "order"]
  };
}

function triangleSpec(point) {
  if (/勾股|直角|正弦|余弦|正切/u.test(point.name)) {
    return {
      model: "right_triangle",
      parameters: [
        range("leg_a", "直角边 a", 3, 12, 1, 6),
        range("leg_b", "直角边 b", 3, 12, 1, 8)
      ],
      annotations: ["right_angle", "hypotenuse", "area"]
    };
  }
  if (/相似|比例|位似/u.test(point.name)) {
    return {
      model: "similar_triangles",
      parameters: [
        range("base", "原图边长", 2, 8, 0.5, 4),
        range("scale", "相似比", 0.5, 3, 0.25, 1.5),
        range("angle", "对应角", 20, 120, 5, 60, { unit: "degree" })
      ],
      annotations: ["corresponding_sides", "corresponding_angles", "scale_ratio"]
    };
  }
  return {
    model: "general_triangle",
    parameters: [
      range("side_a", "边 a", 3, 10, 0.5, 5),
      range("side_b", "边 b", 3, 10, 0.5, 6),
      range("included_angle", "夹角", 20, 140, 5, 60, { unit: "degree" })
    ],
    constraints: ["positive_sides", "triangle_inequality"],
    annotations: ["vertices", "sides", "angles"]
  };
}

function circleSpec(point) {
  const name = point.name;
  const model = /弧长|扇形/u.test(name)
    ? "sector_measure"
    : /圆周角|圆心角|弧/u.test(name)
      ? "inscribed_angle"
      : /切线|直线与圆/u.test(name)
        ? "tangent_position"
        : "circle_elements";
  return {
    model,
    parameters: [
      range("radius", "半径", 2, 10, 0.5, 5),
      range("central_angle", "圆心角", 30, 330, 15, 120, { unit: "degree" }),
      range("point_distance", "点到圆心距离", 0, 12, 0.5, 6)
    ],
    annotations: ["center", "radius", "arc", "chord"]
  };
}

function coordinateSpec(point) {
  const name = point.name;
  if (/平移|轴对称|中心对称|旋转|位似/u.test(name)) {
    return {
      model: "coordinate_transformation",
      viewport: { x_min: -6, x_max: 6, y_min: -6, y_max: 6, grid_step: 1 },
      parameters: [
        range("point_x", "横坐标 x", -5, 5, 0.5, 2),
        range("point_y", "纵坐标 y", -5, 5, 0.5, 1),
        range("delta_x", "水平变化", -4, 4, 0.5, 2),
        range("delta_y", "竖直变化", -4, 4, 0.5, -1)
      ],
      annotations: ["original_point", "image_point", "transformation_vector"]
    };
  }
  if (/反比例/u.test(name)) {
    return {
      model: "inverse_proportion_samples",
      viewport: { x_min: -6, x_max: 6, y_min: -6, y_max: 6, grid_step: 1 },
      parameters: [range("coefficient", "比例系数 k", -8, 8, 1, 4, { excluded_values: [0] })],
      annotations: ["quadrants", "sample_points", "asymptotes"]
    };
  }
  return {
    model: "cartesian_relation",
    viewport: { x_min: -6, x_max: 6, y_min: -6, y_max: 6, grid_step: 1 },
    parameters: [
      range("point_x", "横坐标 x", -5, 5, 0.5, 2),
      range("point_y", "纵坐标 y", -5, 5, 0.5, 1)
    ],
    annotations: ["origin", "axes", "coordinates"]
  };
}

function statisticsSpec(point, order) {
  const name = point.name;
  const model = /箱线|四分位|百分位/u.test(name)
    ? "box_plot"
    : /频数|直方图/u.test(name)
      ? "frequency_distribution"
      : /平均|中位|众数|方差|离差/u.test(name)
        ? "descriptive_statistics"
        : /抽样|样本|总体/u.test(name)
          ? "sampling_comparison"
          : "chart_comparison";
  const base = 24 + (order % 7);
  return {
    model,
    parameters: [
      range("sample_size", "样本量", 10, 100, 10, 30),
      range("bin_count", "分组数", 3, 10, 1, 5)
    ],
    data: {
      sample: [base, base + 4, base + 7, base + 7, base + 11, base + 14, base + 18, base + 21],
      series_label: "示例样本"
    },
    annotations: ["mean", "median", "range"]
  };
}

function probabilitySpec(point) {
  return {
    model: /频率|重复试验/u.test(point.name) ? "frequency_simulation" : "equally_likely_outcomes",
    parameters: [
      range("trials", "试验次数", 10, 200, 10, 60),
      select("event", "关注事件", [["even", "偶数"], ["greater_than_four", "大于 4"], ["prime", "质数"]], "even")
    ],
    data: {
      outcomes: [1, 2, 3, 4, 5, 6],
      deterministic_seed: 202
    },
    annotations: ["theoretical_probability", "observed_frequency"]
  };
}

function algebraSpec(point) {
  const name = point.name;
  const model = /一元二次/u.test(name)
    ? "quadratic_equation_steps"
    : /二元|三元|方程组/u.test(name)
      ? "linear_system_steps"
      : /分式/u.test(name)
        ? "rational_expression_steps"
        : /因式|整式|平方差|完全平方|同类项/u.test(name)
          ? "algebra_tiles"
          : "linear_equation_steps";
  return {
    model,
    parameters: [
      range("coefficient_a", "系数 a", -6, 6, 1, 2, { excluded_values: [0] }),
      range("coefficient_b", "系数 b", -8, 8, 1, -3),
      range("constant", "常数 c", -10, 10, 1, 5),
      range("step_index", "变形步骤", 0, 3, 1, 0)
    ],
    annotations: ["equivalent_transform", "current_step", "check_result"]
  };
}

function conceptSpec(point) {
  const name = point.name;
  const model = /证明|命题|定理|推论|反例|反证/u.test(name)
    ? "proof_structure"
    : /项目|现实|模型|方案|研究/u.test(name)
      ? "modeling_cycle"
      : /区分|识别|理解/u.test(name)
        ? "classification"
        : "relationship_explorer";
  const steps = model === "modeling_cycle"
    ? ["发现问题", "建立模型", "求解检验", "解释表达"]
    : model === "proof_structure"
      ? ["识别条件", "选择依据", "形成推理", "检查结论"]
      : ["观察对象", "比较特征", "归纳关系"];
  return {
    model,
    parameters: [range("step_index", "查看步骤", 0, steps.length - 1, 1, 0)],
    data: { steps, focus: point.name },
    annotations: ["condition", "process", "conclusion"]
  };
}

function highRiskDedicatedSpec(point, profile) {
  const rangeParameter = (key, label, min, max, step, defaultValue) => range(key, label, min, max, step, defaultValue);
  const specs = {
    expression_builder: {
      variable: "x",
      parameters: [
        rangeParameter("coefficient_a", "字母系数", -9, 9, 1, 2),
        rangeParameter("coefficient_b", "常数项", -20, 20, 1, 3),
        rangeParameter("variable_value", "x 的值", -10, 10, 1, 2)
      ]
    },
    formula_builder: {
      parameters: [
        select("formula_kind", "公式类型", [["rectangle_area", "长方形面积"], ["triangle_area", "三角形面积"], ["distance", "路程公式"]], "rectangle_area"),
        rangeParameter("length", "长 / 底 / 速度", 0.5, 20, 0.5, 6),
        rangeParameter("width", "宽", 0.5, 20, 0.5, 4),
        rangeParameter("height", "高 / 时间", 0.5, 20, 0.5, 3)
      ]
    },
    substitution_evaluator: {
      variable: "x",
      parameters: [
        rangeParameter("coefficient_a", "系数 a", -9, 9, 1, 3),
        rangeParameter("coefficient_b", "常数 b", -20, 20, 1, -2),
        rangeParameter("variable_value", "x 的值", -10, 10, 1, 4)
      ]
    },
    exponent_laws: {
      parameters: [
        rangeParameter("base", "底数", 1, 9, 1, 2),
        rangeParameter("exponent_m", "指数 m", 0, 6, 1, 3),
        rangeParameter("exponent_n", "指数 n", 0, 6, 1, 2),
        select("operation", "指数律", [["multiply", "同底数幂相乘"], ["divide", "同底数幂相除"], ["power", "幂的乘方"]], "multiply")
      ]
    },
    scientific_notation: {
      parameters: [
        rangeParameter("coefficient", "有效数", -9.9, 9.9, 0.1, 3.2),
        rangeParameter("exponent", "10 的指数", -8, 8, 1, 4)
      ]
    },
    power_operations: {
      parameters: [
        rangeParameter("base", "底数", -9, 9, 1, 3),
        rangeParameter("exponent", "指数", 0, 8, 1, 2)
      ]
    },
    mixed_operations: {
      parameters: [
        rangeParameter("operand_a", "数 a", -20, 20, 1, 8),
        rangeParameter("operand_b", "数 b", -20, 20, 1, 3),
        rangeParameter("operand_c", "数 c", -20, 20, 1, 2),
        select("pattern", "运算结构", [["multiply_first", "先乘后加"], ["parentheses_first", "括号优先"]], "multiply_first")
      ]
    },
    operation_laws: {
      parameters: [
        rangeParameter("operand_a", "数 a", -12, 12, 1, 2),
        rangeParameter("operand_b", "数 b", -12, 12, 1, 3),
        rangeParameter("operand_c", "数 c", -12, 12, 1, 4),
        select("law", "运算律", [["commutative", "交换律"], ["associative", "结合律"], ["distributive", "分配律"]], "distributive")
      ]
    },
    word_problem: {
      parameters: [
        select("scenario", "问题类型", [["total", "求总价"], ["change", "求找零"], ["rate", "求平均量"]], "total"),
        rangeParameter("quantity", "数量 / 份数", 1, 20, 1, 4),
        rangeParameter("unit_price", "单价", 0.5, 100, 0.5, 12),
        rangeParameter("paid", "付款 / 总量", 1, 500, 1, 100)
      ]
    },
    square_root_inverse: {
      parameters: [rangeParameter("radicand", "被开方数", 0, 400, 1, 49)]
    },
    radical_operations: {
      parameters: [
        rangeParameter("radicand_a", "被开方数 a", 1, 100, 1, 4),
        rangeParameter("radicand_b", "被开方数 b", 1, 100, 1, 9),
        select("operation", "根式运算", [["multiply", "乘法"], ["divide", "除法"]], "multiply")
      ]
    },
    axis_reflection: {
      parameters: [
        rangeParameter("point_x", "原点横坐标", -6, 6, 0.5, 3),
        rangeParameter("point_y", "原点纵坐标", -6, 6, 0.5, 2),
        select("axis", "对称轴", [["x", "x 轴"], ["y", "y 轴"]], "x")
      ]
    },
    rotation: {
      parameters: [
        rangeParameter("point_x", "原点横坐标", -6, 6, 0.5, 3),
        rangeParameter("point_y", "原点纵坐标", -6, 6, 0.5, 2),
        rangeParameter("center_x", "中心横坐标", -4, 4, 0.5, 0),
        rangeParameter("center_y", "中心纵坐标", -4, 4, 0.5, 0),
        select("angle", "旋转角", [["90", "90°"], ["180", "180°"], ["270", "270°"]], "90")
      ]
    },
    central_symmetry: {
      parameters: [
        rangeParameter("point_x", "原点横坐标", -6, 6, 0.5, 3),
        rangeParameter("point_y", "原点纵坐标", -6, 6, 0.5, 2),
        rangeParameter("center_x", "中心横坐标", -4, 4, 0.5, 0),
        rangeParameter("center_y", "中心纵坐标", -4, 4, 0.5, 0)
      ]
    },
    transform_composition: {
      parameters: [
        rangeParameter("point_x", "原点横坐标", -6, 6, 0.5, 2),
        rangeParameter("point_y", "原点纵坐标", -6, 6, 0.5, 1),
        rangeParameter("delta_x", "水平平移", -4, 4, 0.5, 2),
        rangeParameter("delta_y", "竖直平移", -4, 4, 0.5, -1),
        select("axis", "再关于", [["x", "x 轴对称"], ["y", "y 轴对称"]], "x")
      ]
    },
    dilation: {
      parameters: [
        rangeParameter("point_x", "原点横坐标", -6, 6, 0.5, 3),
        rangeParameter("point_y", "原点纵坐标", -6, 6, 0.5, 2),
        rangeParameter("center_x", "位似中心横坐标", -4, 4, 0.5, 0),
        rangeParameter("center_y", "位似中心纵坐标", -4, 4, 0.5, 0),
        rangeParameter("scale_factor", "位似比", 0.25, 3, 0.25, 1.5)
      ]
    },
    projection_rays: {
      parameters: [
        rangeParameter("light_x", "投射中心横坐标", -6, -1, 0.5, -4),
        rangeParameter("light_y", "投射中心纵坐标", 2, 9, 0.5, 6),
        rangeParameter("object_x", "物体位置", -0.5, 3, 0.5, 1),
        rangeParameter("object_height", "物体高度", 0.5, 6, 0.5, 3),
        rangeParameter("screen_x", "投影面位置", 4, 9, 0.5, 6)
      ]
    },
    orthographic_views: {
      parameters: [
        rangeParameter("length", "长", 1, 10, 0.5, 6),
        rangeParameter("width", "宽", 1, 10, 0.5, 4),
        rangeParameter("height", "高", 1, 10, 0.5, 5),
        select("active_view", "视图", [["front", "主视图"], ["top", "俯视图"], ["side", "左视图"]], "front")
      ]
    },
    solid_net: {
      parameters: [
        select("solid", "几何体", [["cube", "正方体"], ["triangular_prism", "三棱柱"]], "cube"),
        rangeParameter("fold_progress", "折叠进度", 0, 1, 0.1, 0)
      ]
    }
  };
  const specific = specs[profile.model];
  if (!specific) fail(`missing dedicated visual spec for ${point.id}: ${profile.model}`);
  return {
    model: profile.model,
    ...specific,
    data: {
      ...(specific.data || {}),
      focus: point.name,
      guidance_steps: [...profile.steps]
    },
    annotations: ["controlled_parameters", "live_result", "verified_model"],
    visual_profile: {
      profile_id: `explicit:${point.id}`,
      status: "supported",
      variant: profile.variant,
      model: profile.model,
      mapping_source: "explicit_point_profile"
    }
  };
}

function buildInteractive(point) {
  const explicitProfile = HIGH_RISK_VISUAL_PROFILES[point.id];
  const variant = explicitProfile?.variant || resolveVariant(point);
  const order = Number(point.visualization?.order || 0);
  const specific = explicitProfile
    ? highRiskDedicatedSpec(point, explicitProfile)
    : variant === "linear"
    ? linearSpec()
    : variant === "quadratic"
      ? quadraticSpec()
      : variant === "numberline"
        ? numberlineSpec(point)
        : variant === "triangle"
          ? triangleSpec(point)
          : variant === "circle"
            ? circleSpec(point)
            : variant === "coordinate"
              ? coordinateSpec(point)
              : variant === "statistics"
                ? statisticsSpec(point, order)
                : variant === "probability"
                  ? probabilitySpec(point)
                  : variant === "algebra"
                    ? algebraSpec(point)
                    : conceptSpec(point);
  const interactive = {
    schema_version: INTERACTIVE_SCHEMA_VERSION,
    renderer: INTERACTIVE_RENDERER,
    variant,
    title: point.name,
    instruction: VARIANT_INSTRUCTIONS[variant],
    aria_label: `${point.name}互动图解`,
    ...specific
  };
  interactive.parameterization = createKnowledgeCardParameterization({
    parameters: interactive.parameters,
    renderer: INTERACTIVE_RENDERER,
    rendererVersion: "1.0",
    templateId: `${interactive.variant}:${interactive.model}`,
    cardType: "interactive_visual"
  });
  return interactive;
}

function relationEntry(edge, pointId, pointById, relationTypeByKey) {
  const otherId = edge.source === pointId ? edge.target : edge.source;
  const other = pointById.get(otherId);
  if (!other) return null;
  return {
    id: other.id,
    label: other.name,
    relation_type: edge.type,
    relation_label: relationTypeByKey.get(edge.type)?.name || RELATION_LABELS[edge.type] || edge.type,
    direction: edge.source === pointId ? "outgoing" : "incoming",
    edge_id: edge.id
  };
}

function mergeRelationsByNeighbor(entries) {
  const relationOrder = new Map(RELATION_PRIORITY.map((type, index) => [type, index]));
  const sorted = [...entries].sort((a, b) =>
    (relationOrder.get(a.relation_type) ?? 999) - (relationOrder.get(b.relation_type) ?? 999) ||
    a.id.localeCompare(b.id, "en") ||
    a.direction.localeCompare(b.direction, "en") ||
    a.edge_id.localeCompare(b.edge_id, "en")
  );
  const grouped = new Map();
  for (const entry of sorted) {
    if (!grouped.has(entry.id)) {
      grouped.set(entry.id, {
        id: entry.id,
        label: entry.label,
        relations: []
      });
    }
    const group = grouped.get(entry.id);
    const relationKey = `${entry.relation_type}:${entry.direction}`;
    let relation = group.relations.find((item) => `${item.type}:${item.direction}` === relationKey);
    if (!relation) {
      relation = {
        type: entry.relation_type,
        label: entry.relation_label,
        direction: entry.direction,
        edge_ids: []
      };
      group.relations.push(relation);
    }
    if (!relation.edge_ids.includes(entry.edge_id)) relation.edge_ids.push(entry.edge_id);
  }
  return [...grouped.values()].map((group) => {
    const primary = group.relations[0];
    const relationTypes = [...new Set(group.relations.map((relation) => relation.type))];
    const relationLabels = relationTypes.map((type) => group.relations.find((relation) => relation.type === type).label);
    const directions = [...new Set(group.relations.map((relation) => relation.direction))];
    return {
      id: group.id,
      label: group.label,
      relation_type: primary.type,
      relation_label: primary.label,
      direction: primary.direction,
      relation_types: relationTypes,
      relation_labels: relationLabels,
      directions,
      relations: group.relations
    };
  });
}

function buildMindmap(point, context) {
  const { domainById, themeById, pointById, edgesByPoint, relationTypeByKey } = context;
  const domain = domainById.get(point.domain_id);
  const theme = themeById.get(point.theme_id);
  const incident = edgesByPoint.get(point.id) || [];
  const prerequisites = [];
  const successors = [];
  const related = [];

  for (const edge of incident) {
    if (edge.type === "part_of") continue;
    const entry = relationEntry(edge, point.id, pointById, relationTypeByKey);
    if (!entry) continue;
    if (edge.type === "prerequisite_of" && edge.target === point.id) prerequisites.push(entry);
    else if (edge.type === "prerequisite_of" && edge.source === point.id) successors.push(entry);
    else related.push(entry);
  }

  const branches = [
    {
      id: `${point.id}:curriculum`,
      title: "课标定位",
      kind: "curriculum",
      children: [
        { id: domain.id, label: domain.name, relation_type: "part_of" },
        { id: theme.id, label: theme.name, relation_type: "part_of" }
      ]
    }
  ];
  const addBranch = (key, title, values) => {
    const children = mergeRelationsByNeighbor(values);
    if (children.length) branches.push({ id: `${point.id}:${key}`, title, kind: key, children });
  };
  addBranch("prerequisites", "前置知识", prerequisites);
  addBranch("successors", "后续知识", successors);
  addBranch("relations", "关联知识", related);

  return {
    schema_version: MINDMAP_SCHEMA_VERSION,
    root: point.name,
    root_id: point.id,
    branches: branches.slice(0, COMPILER_LIMITS.max_mindmap_branches),
    relation_counts: {
      prerequisites: mergeRelationsByNeighbor(prerequisites).length,
      successors: mergeRelationsByNeighbor(successors).length,
      related: mergeRelationsByNeighbor(related).length
    },
    relation_edge_counts: {
      prerequisites: prerequisites.length,
      successors: successors.length,
      related: related.length
    },
    parameterization: createStaticKnowledgeCardParameterization({
      cardType: "knowledge.mindmap",
      staticReason: "ontology_relation_structure"
    })
  };
}

function buildSource(point, ontology, quoteByPointId) {
  const quote = quoteByPointId.get(point.id);
  if (!quote) fail(`missing curriculum quote for ${point.id}`);
  return {
    document_id: point.source_ref.document_id,
    document_title: ontology.source_document.title,
    document_scope: ontology.source_document.scope,
    outline_description: point.measurable_behavior,
    printed_page: point.source_ref.printed_page,
    extraction_source: point.source_ref.extraction_source,
    text_basis: "ontology.measurable_behavior",
    verbatim_text: quote.verbatim_text,
    verbatim_quotes: quote.verbatim_quotes,
    clause_locator: quote.clause_locator,
    printed_pages: quote.printed_pages,
    pdf_pages: quote.pdf_pages,
    is_verbatim: quote.is_verbatim === true,
    ocr_reviewed: quote.ocr_reviewed === true,
    verbatim_text_basis: "source_pdf.rendered_manual_review"
  };
}

function buildQuoteIndex(catalog) {
  if (!isRecord(catalog) || catalog.schema_version !== "junior-math-curriculum-quotes@1.0") {
    fail("curriculum quote catalog schema mismatch");
  }
  if (!Array.isArray(catalog.entries)) fail("curriculum quote catalog entries are required");
  return new Map(catalog.entries.map((entry) => [entry.knowledge_point_id, entry]));
}

function buildContext(ontology) {
  const pointById = new Map(ontology.knowledge_points.map((point) => [point.id, point]));
  const edgesByPoint = new Map(ontology.knowledge_points.map((point) => [point.id, []]));
  for (const edge of ontology.edges) {
    if (edgesByPoint.has(edge.source)) edgesByPoint.get(edge.source).push(edge);
    if (edgesByPoint.has(edge.target)) edgesByPoint.get(edge.target).push(edge);
  }
  for (const edges of edgesByPoint.values()) edges.sort((a, b) => a.id.localeCompare(b.id, "en"));
  return {
    pointById,
    edgesByPoint,
    domainById: new Map(ontology.domains.map((domain) => [domain.id, domain])),
    themeById: new Map(ontology.themes.map((theme) => [theme.id, theme])),
    relationTypeByKey: new Map(ontology.relation_types.map((relation) => [relation.key, relation]))
  };
}

export function compileJuniorMathVisuals(ontology, curriculumQuotes = loadDefaultCurriculumQuotes()) {
  validateOntology(ontology);
  const context = buildContext(ontology);
  const quoteByPointId = buildQuoteIndex(curriculumQuotes);
  const artifacts = ontology.knowledge_points.map((point) => ({
    artifact_id: `visual:${point.id}`,
    knowledge_point_id: point.id,
    title: point.name,
    domain_id: point.domain_id,
    theme_id: point.theme_id,
    source: buildSource(point, ontology, quoteByPointId),
    mindmap: buildMindmap(point, context),
    interactive: buildInteractive(point)
  }));
  const variantCounts = Object.fromEntries(INTERACTIVE_VARIANTS.map((variant) => [variant, 0]));
  for (const artifact of artifacts) variantCounts[artifact.interactive.variant] += 1;

  const output = {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    artifact_set_id: "junior-math-moe-2022-visual-artifacts",
    version: ARTIFACT_VERSION,
    ontology_ref: {
      ontology_id: ontology.ontology_id,
      ontology_version: ontology.ontology_version,
      source_schema_version: ontology.schema_version,
      source_generated_at: ontology.generated_at
    },
    schema: {
      artifact: "knowledge-visual-artifact@1.0",
      source: "curriculum-source-ref@1.0",
      mindmap: MINDMAP_SCHEMA_VERSION,
      interactive: INTERACTIVE_SCHEMA_VERSION,
      parameterization: KNOWLEDGE_CARD_PARAMETER_SCHEMA_VERSION,
      renderer: INTERACTIVE_RENDERER,
      variant_allowlist: [...INTERACTIVE_VARIANTS],
      limits: { ...COMPILER_LIMITS }
    },
    artifacts,
    statistics: {
      artifact_count: artifacts.length,
      source_count: artifacts.length,
      mindmap_count: artifacts.length,
      interactive_count: artifacts.length,
      variant_counts: variantCounts
    }
  };
  validateVisualArtifacts(output, ontology, curriculumQuotes);
  return output;
}

function validateOntology(ontology) {
  if (!isRecord(ontology)) fail("ontology must be an object");
  if (!Array.isArray(ontology.knowledge_points)) fail("ontology.knowledge_points must be an array");
  if (ontology.knowledge_points.length !== EXPECTED_KNOWLEDGE_POINT_COUNT) {
    fail(`ontology must contain exactly ${EXPECTED_KNOWLEDGE_POINT_COUNT} knowledge points`);
  }
  const ids = new Set();
  const domainIds = new Set((ontology.domains || []).map((domain) => domain.id));
  const themeIds = new Set((ontology.themes || []).map((theme) => theme.id));
  for (const point of ontology.knowledge_points) {
    const id = requireText(point.id, "knowledge point id");
    if (ids.has(id)) fail(`duplicate knowledge point id: ${id}`);
    ids.add(id);
    requireText(point.name, `${id}.name`);
    requireText(point.measurable_behavior, `${id}.measurable_behavior`);
    if (!domainIds.has(point.domain_id)) fail(`${id} has unknown domain_id`);
    if (!themeIds.has(point.theme_id)) fail(`${id} has unknown theme_id`);
    if (!isRecord(point.source_ref)) fail(`${id} needs source_ref`);
    requireText(point.source_ref.document_id, `${id}.source_ref.document_id`);
    requireText(point.source_ref.printed_page, `${id}.source_ref.printed_page`);
    requireText(point.source_ref.extraction_source, `${id}.source_ref.extraction_source`);
  }
}

function validateFiniteNumber(value, label) {
  if (!Number.isFinite(value)) fail(`${label} must be finite`);
  if (value < COMPILER_LIMITS.numeric_min || value > COMPILER_LIMITS.numeric_max) {
    fail(`${label} is outside compiler numeric bounds`);
  }
}

function validateParameter(parameter, label) {
  if (!isRecord(parameter)) fail(`${label} must be an object`);
  requireText(parameter.key, `${label}.key`);
  requireText(parameter.label, `${label}.label`);
  if (parameter.control === "range") {
    for (const key of ["min", "max", "step", "default"]) validateFiniteNumber(parameter[key], `${label}.${key}`);
    if (parameter.min >= parameter.max) fail(`${label} range must have min < max`);
    if (parameter.step <= 0) fail(`${label}.step must be positive`);
    if (parameter.default < parameter.min || parameter.default > parameter.max) fail(`${label}.default is outside range`);
    if ((parameter.max - parameter.min) / parameter.step > COMPILER_LIMITS.max_parameter_steps) {
      fail(`${label} exceeds maximum parameter steps`);
    }
    if (parameter.excluded_values !== undefined) {
      if (!Array.isArray(parameter.excluded_values) || parameter.excluded_values.length > 8) {
        fail(`${label}.excluded_values must be a bounded array`);
      }
      for (const value of parameter.excluded_values) {
        validateFiniteNumber(value, `${label}.excluded_values`);
        if (value < parameter.min || value > parameter.max) fail(`${label} excludes a value outside its range`);
      }
      if (parameter.excluded_values.includes(parameter.default)) fail(`${label}.default cannot be excluded`);
    }
    return;
  }
  if (parameter.control === "select") {
    if (!Array.isArray(parameter.choices) || !parameter.choices.length || parameter.choices.length > 10) {
      fail(`${label}.choices must contain 1 to 10 entries`);
    }
    const values = new Set();
    for (const choice of parameter.choices) {
      if (!isRecord(choice)) fail(`${label}.choice must be an object`);
      const value = requireText(choice.value, `${label}.choice.value`);
      requireText(choice.label, `${label}.choice.label`);
      if (values.has(value)) fail(`${label} has duplicate choice value: ${value}`);
      values.add(value);
    }
    if (!values.has(parameter.default)) fail(`${label}.default must be an allowed choice`);
    return;
  }
  if (parameter.control === "toggle") {
    if (typeof parameter.default !== "boolean") fail(`${label}.default must be boolean`);
    return;
  }
  fail(`${label}.control is not allowed`);
}

function validateBoundedData(value, label, depth = 0) {
  if (depth > COMPILER_LIMITS.max_data_depth) fail(`${label} exceeds maximum nesting depth`);
  if (typeof value === "number") return validateFiniteNumber(value, label);
  if (typeof value === "string") {
    if (value.length > COMPILER_LIMITS.max_string_length) fail(`${label} exceeds string limit`);
    return;
  }
  if (typeof value === "boolean" || value === null) return;
  if (Array.isArray(value)) {
    if (value.length > COMPILER_LIMITS.max_data_array_items) fail(`${label} exceeds array limit`);
    value.forEach((item, index) => validateBoundedData(item, `${label}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value)) fail(`${label} contains an unsupported value`);
  const entries = Object.entries(value);
  if (entries.length > 32) fail(`${label} exceeds object key limit`);
  for (const [key, item] of entries) {
    if (/^(html|script|url|src|href|expression|javascript)$/iu.test(key)) fail(`${label}.${key} is forbidden`);
    validateBoundedData(item, `${label}.${key}`, depth + 1);
  }
}

export function validateVisualArtifacts(output, ontology, curriculumQuotes = loadDefaultCurriculumQuotes()) {
  validateOntology(ontology);
  const quoteByPointId = buildQuoteIndex(curriculumQuotes);
  if (!isRecord(output)) fail("output must be an object");
  if (output.schema_version !== ARTIFACT_SCHEMA_VERSION) fail("unexpected artifact schema version");
  if (output.version !== ARTIFACT_VERSION) fail("unexpected artifact version");
  if (!isRecord(output.schema)) fail("output.schema is required");
  if (output.schema.interactive !== INTERACTIVE_SCHEMA_VERSION) fail("interactive schema version mismatch");
  if (output.schema.parameterization !== KNOWLEDGE_CARD_PARAMETER_SCHEMA_VERSION) {
    fail("parameterization schema version mismatch");
  }
  if (output.schema.renderer !== INTERACTIVE_RENDERER) fail("interactive renderer mismatch");
  if (JSON.stringify(output.schema.variant_allowlist) !== JSON.stringify(INTERACTIVE_VARIANTS)) {
    fail("variant allowlist mismatch");
  }
  if (!Array.isArray(output.artifacts) || output.artifacts.length !== EXPECTED_KNOWLEDGE_POINT_COUNT) {
    fail(`output must contain exactly ${EXPECTED_KNOWLEDGE_POINT_COUNT} artifacts`);
  }

  const ontologyById = new Map(ontology.knowledge_points.map((point) => [point.id, point]));
  const validMindmapNodeIds = new Set([
    ...ontology.domains.map((domain) => domain.id),
    ...ontology.themes.map((theme) => theme.id),
    ...ontology.knowledge_points.map((point) => point.id)
  ]);
  const artifactIds = new Set();
  const knowledgePointIds = new Set();
  const variantCounts = Object.fromEntries(INTERACTIVE_VARIANTS.map((variant) => [variant, 0]));

  for (const artifact of output.artifacts) {
    if (!isRecord(artifact)) fail("artifact must be an object");
    const artifactId = requireText(artifact.artifact_id, "artifact_id");
    const pointId = requireText(artifact.knowledge_point_id, `${artifactId}.knowledge_point_id`);
    if (artifactIds.has(artifactId)) fail(`duplicate artifact_id: ${artifactId}`);
    if (knowledgePointIds.has(pointId)) fail(`duplicate knowledge_point_id: ${pointId}`);
    artifactIds.add(artifactId);
    knowledgePointIds.add(pointId);
    const point = ontologyById.get(pointId);
    if (!point) fail(`${artifactId} references an unknown knowledge point`);
    if (artifact.title !== point.name) fail(`${artifactId} title does not match ontology`);

    const source = artifact.source;
    if (!isRecord(source)) fail(`${artifactId}.source is required`);
    if (source.document_id !== point.source_ref.document_id) fail(`${artifactId} source document mismatch`);
    if (source.outline_description !== point.measurable_behavior) fail(`${artifactId} source description mismatch`);
    if (source.printed_page !== point.source_ref.printed_page) fail(`${artifactId} source page mismatch`);
    if (source.text_basis !== "ontology.measurable_behavior") fail(`${artifactId} source text basis mismatch`);
    const quote = quoteByPointId.get(pointId);
    if (!quote) fail(`${artifactId} curriculum quote is missing`);
    if (source.verbatim_text !== quote.verbatim_text || source.is_verbatim !== true) {
      fail(`${artifactId} verbatim curriculum text mismatch`);
    }
    if (source.verbatim_text_basis !== "source_pdf.rendered_manual_review" || source.ocr_reviewed !== true) {
      fail(`${artifactId} verbatim provenance is incomplete`);
    }
    if (JSON.stringify(source.printed_pages) !== JSON.stringify(quote.printed_pages) ||
        JSON.stringify(source.pdf_pages) !== JSON.stringify(quote.pdf_pages)) {
      fail(`${artifactId} verbatim page locator mismatch`);
    }

    const mindmap = artifact.mindmap;
    if (!isRecord(mindmap) || mindmap.schema_version !== MINDMAP_SCHEMA_VERSION) {
      fail(`${artifactId} mindmap schema mismatch`);
    }
    if (mindmap.root_id !== pointId || mindmap.root !== point.name) fail(`${artifactId} mindmap root mismatch`);
    try {
      assertKnowledgeCardParameterization(mindmap.parameterization);
    } catch (error) {
      fail(`${artifactId} mindmap parameterization invalid: ${error.message}`);
    }
    if (mindmap.parameterization.mode !== "none") fail(`${artifactId} mindmap must remain static`);
    if (!Array.isArray(mindmap.branches) || !mindmap.branches.length || mindmap.branches.length > COMPILER_LIMITS.max_mindmap_branches) {
      fail(`${artifactId} mindmap branches are outside bounds`);
    }
    for (const branch of mindmap.branches) {
      requireText(branch.id, `${artifactId}.mindmap.branch.id`);
      requireText(branch.title, `${artifactId}.mindmap.branch.title`);
      if (!Array.isArray(branch.children) || branch.children.length > COMPILER_LIMITS.max_mindmap_children_per_branch) {
        fail(`${artifactId} mindmap branch children are outside bounds`);
      }
      const branchChildIds = new Set();
      for (const child of branch.children) {
        if (!isRecord(child)) fail(`${artifactId} mindmap child must be an object`);
        if (!validMindmapNodeIds.has(child.id)) fail(`${artifactId} mindmap child references unknown node: ${child.id}`);
        requireText(child.label, `${artifactId}.mindmap.child.label`);
        if (branchChildIds.has(child.id)) fail(`${artifactId} mindmap branch has duplicate child: ${child.id}`);
        branchChildIds.add(child.id);
        if (branch.kind === "curriculum") continue;
        if (!Array.isArray(child.relation_types) || !child.relation_types.length) {
          fail(`${artifactId} mindmap child relation_types are required`);
        }
        if (!Array.isArray(child.relation_labels) || child.relation_labels.length !== child.relation_types.length) {
          fail(`${artifactId} mindmap child relation labels mismatch`);
        }
        if (!Array.isArray(child.relations) || !child.relations.length) {
          fail(`${artifactId} mindmap child relations are required`);
        }
        child.relation_types.forEach((type, index) => {
          requireText(type, `${artifactId}.mindmap.child.relation_types[${index}]`);
          requireText(child.relation_labels[index], `${artifactId}.mindmap.child.relation_labels[${index}]`);
        });
        for (const relation of child.relations) {
          requireText(relation.type, `${artifactId}.mindmap.child.relation.type`);
          requireText(relation.label, `${artifactId}.mindmap.child.relation.label`);
          requireText(relation.direction, `${artifactId}.mindmap.child.relation.direction`);
          if (!Array.isArray(relation.edge_ids) || !relation.edge_ids.length) {
            fail(`${artifactId} mindmap child relation edge_ids are required`);
          }
          relation.edge_ids.forEach((edgeId, index) => requireText(edgeId, `${artifactId}.mindmap.child.relation.edge_ids[${index}]`));
        }
      }
    }
    const relationBranchKeys = [
      ["prerequisites", "prerequisites"],
      ["successors", "successors"],
      ["relations", "related"]
    ];
    for (const [branchKind, countKey] of relationBranchKeys) {
      const branch = mindmap.branches.find((item) => item.kind === branchKind);
      const children = branch?.children || [];
      const edgeCount = children.reduce(
        (sum, child) => sum + child.relations.reduce((relationSum, relation) => relationSum + relation.edge_ids.length, 0),
        0
      );
      if (mindmap.relation_counts?.[countKey] !== children.length) {
        fail(`${artifactId} mindmap ${countKey} neighbor count mismatch`);
      }
      if (mindmap.relation_edge_counts?.[countKey] !== edgeCount) {
        fail(`${artifactId} mindmap ${countKey} edge count mismatch`);
      }
    }

    const interactive = artifact.interactive;
    if (!isRecord(interactive)) fail(`${artifactId}.interactive is required`);
    if (interactive.schema_version !== INTERACTIVE_SCHEMA_VERSION) fail(`${artifactId} interactive schema mismatch`);
    if (interactive.renderer !== INTERACTIVE_RENDERER) fail(`${artifactId} renderer mismatch`);
    if (!INTERACTIVE_VARIANTS.includes(interactive.variant)) fail(`${artifactId} has unknown variant`);
    variantCounts[interactive.variant] += 1;
    requireText(interactive.title, `${artifactId}.interactive.title`);
    requireText(interactive.instruction, `${artifactId}.interactive.instruction`);
    requireText(interactive.model, `${artifactId}.interactive.model`);
    const highRiskProfile = HIGH_RISK_VISUAL_PROFILES[pointId];
    if (highRiskProfile) {
      if (interactive.variant !== highRiskProfile.variant || interactive.model !== highRiskProfile.model) {
        fail(`${artifactId} dedicated visual profile mismatch`);
      }
      if (interactive.visual_profile?.status !== "supported") {
        fail(`${artifactId} supported visual profile metadata is missing`);
      }
      if (interactive.visual_profile.variant !== highRiskProfile.variant ||
          interactive.visual_profile.model !== highRiskProfile.model) {
        fail(`${artifactId} verified visual profile metadata mismatch`);
      }
    }
    if (!Array.isArray(interactive.parameters) || interactive.parameters.length > COMPILER_LIMITS.max_parameters) {
      fail(`${artifactId} parameters are outside bounds`);
    }
    const parameterKeys = new Set();
    interactive.parameters.forEach((parameter, index) => {
      validateParameter(parameter, `${artifactId}.parameters[${index}]`);
      if (parameterKeys.has(parameter.key)) fail(`${artifactId} has duplicate parameter key: ${parameter.key}`);
      parameterKeys.add(parameter.key);
    });
    try {
      assertKnowledgeCardParameterization(interactive.parameterization);
    } catch (error) {
      fail(`${artifactId} interactive parameterization invalid: ${error.message}`);
    }
    if (interactive.parameterization.mode !== "bounded") {
      fail(`${artifactId} interactive parameterization must be bounded`);
    }
    if (JSON.stringify(Object.keys(interactive.parameterization.input_schema.properties)) !== JSON.stringify([...parameterKeys])) {
      fail(`${artifactId} input schema keys do not match renderer parameters`);
    }
    validateBoundedData(interactive, `${artifactId}.interactive`);
  }

  if (knowledgePointIds.size !== ontologyById.size) fail("artifact coverage is incomplete");
  for (const pointId of ontologyById.keys()) {
    if (!knowledgePointIds.has(pointId)) fail(`missing artifact for ${pointId}`);
  }
  for (const variant of INTERACTIVE_VARIANTS) {
    if (variantCounts[variant] < 1) fail(`required variant has no artifact: ${variant}`);
  }

  const expectedStats = {
    artifact_count: output.artifacts.length,
    source_count: output.artifacts.length,
    mindmap_count: output.artifacts.length,
    interactive_count: output.artifacts.length,
    variant_counts: variantCounts
  };
  if (JSON.stringify(output.statistics) !== JSON.stringify(expectedStats)) fail("statistics mismatch");
  return true;
}

export function serializeVisualArtifacts(output) {
  return `${JSON.stringify(output, null, 2)}\n`;
}

function loadDefaultCurriculumQuotes(quotesPath = DEFAULT_CURRICULUM_QUOTES_PATH) {
  return JSON.parse(readFileSync(quotesPath, "utf8"));
}

export function compileFromFile(ontologyPath = DEFAULT_ONTOLOGY_PATH, quotesPath = DEFAULT_CURRICULUM_QUOTES_PATH) {
  const ontology = JSON.parse(readFileSync(ontologyPath, "utf8"));
  const curriculumQuotes = loadDefaultCurriculumQuotes(quotesPath);
  return { ontology, curriculumQuotes, output: compileJuniorMathVisuals(ontology, curriculumQuotes) };
}

export function writeCompiledVisuals({ ontologyPath = DEFAULT_ONTOLOGY_PATH, quotesPath = DEFAULT_CURRICULUM_QUOTES_PATH, outputPath = DEFAULT_OUTPUT_PATH } = {}) {
  const { output } = compileFromFile(ontologyPath, quotesPath);
  writeFileSync(outputPath, serializeVisualArtifacts(output), "utf8");
  return output;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const { output } = compileFromFile();
  const serialized = serializeVisualArtifacts(output);
  if (checkOnly) {
    const existing = readFileSync(DEFAULT_OUTPUT_PATH, "utf8");
    if (existing !== serialized) fail("compiled JSON is stale; run this script without --check");
    console.log(`validated ${output.statistics.artifact_count} deterministic visual artifacts`);
    return;
  }
  writeFileSync(DEFAULT_OUTPUT_PATH, serialized, "utf8");
  console.log(`wrote ${output.statistics.artifact_count} visual artifacts to ${DEFAULT_OUTPUT_PATH}`);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) main();
