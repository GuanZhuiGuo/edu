import assert from "node:assert/strict";
import test from "node:test";

import {
  SourceQualityError,
  analyzeSourceQuality,
  assertSourceQuality,
  normalizeSourceTextForQuality,
  propositionSimilarity
} from "../source-techniques/source-quality.js";

const NORMAL_DEFINITION =
  "牛顿第二定律说明物体的加速度与所受合外力成正比，与物体质量成反比。";

test("normalizes NFKC, zero-width characters, punctuation and whitespace", () => {
  assert.equal(
    normalizeSourceTextForQuality(
      "  Ｆ＝ｍａ，，\u200B  质量不变。\r\n\r\n合外力增大！！ "
    ),
    "F=ma, 质量不变。\n合外力增大!"
  );
});

test("allows a normal 20+ character definition and returns a quality report", () => {
  const report = assertSourceQuality({
    source_text: NORMAL_DEFINITION
  });

  assert.equal(report.passed, true);
  assert.equal(report.status, "ok");
  assert.equal(report.error_code, null);
  assert.deepEqual(report.metrics, {
    input_length: NORMAL_DEFINITION.length,
    normalized_length: NORMAL_DEFINITION.length,
    effective_length: NORMAL_DEFINITION.length - 2,
    proposition_count: 1,
    unique_proposition_count: 1,
    exact_duplicate_count: 0,
    near_duplicate_count: 0,
    duplicate_count: 0,
    duplicate_ratio: 0,
    unique_ratio: 1
  });
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.propositions));
});

test("rejects the same screenshot-style sentence repeated three times", () => {
  const repeated = `${NORMAL_DEFINITION}${NORMAL_DEFINITION}${NORMAL_DEFINITION}`;
  const report = analyzeSourceQuality(repeated);

  assert.equal(report.passed, false);
  assert.equal(report.status, "error");
  assert.equal(report.error_code, "SOURCE_TOO_REPETITIVE");
  assert.equal(report.metrics.proposition_count, 3);
  assert.equal(report.metrics.unique_proposition_count, 1);
  assert.equal(report.metrics.exact_duplicate_count, 2);
  assert.equal(report.metrics.duplicate_ratio, 0.6667);

  assert.throws(
    () => assertSourceQuality({ source_text: repeated }),
    (error) => {
      assert.ok(error instanceof SourceQualityError);
      assert.equal(error.code, "SOURCE_TOO_REPETITIVE");
      assert.equal(error.report.metrics.unique_proposition_count, 1);
      assert.doesNotMatch(error.message, /适配器|模型/);
      return true;
    }
  );
});

test("detects exact duplicates despite punctuation and whitespace differences", () => {
  const report = analyzeSourceQuality(
    [
      "光合作用把光能转化为化学能。",
      "  光合作用把光能转化为化学能！",
      "光合作用把光能转化为化学能 ;"
    ].join("\n")
  );

  assert.equal(report.error_code, "SOURCE_TOO_REPETITIVE");
  assert.equal(report.metrics.exact_duplicate_count, 2);
  assert.deepEqual(
    report.propositions.map((item) => item.duplicate_kind),
    [null, "exact", "exact"]
  );
});

test("detects near-duplicate propositions as one unique proposition", () => {
  const report = analyzeSourceQuality(
    [
      "光合作用是绿色植物利用光能合成有机物并释放氧气的过程。",
      "光合作用指绿色植物利用光能合成有机物并释放氧气的过程。",
      "光合作用就是绿色植物利用光能合成有机物并释放氧气的过程。"
    ].join("；")
  );

  assert.equal(report.passed, false);
  assert.equal(report.error_code, "SOURCE_TOO_REPETITIVE");
  assert.equal(report.metrics.unique_proposition_count, 1);
  assert.equal(report.metrics.near_duplicate_count, 2);
  assert.ok(
    report.propositions.slice(1).every(
      (item) => item.similarity >= 0.86
    )
  );
});

test("protects numeric differences from near-duplicate merging", () => {
  const report = analyzeSourceQuality(
    [
      "实验一把温度升高到20摄氏度并记录反应速率。",
      "实验二把温度升高到30摄氏度并记录反应速率。",
      "实验三把温度升高到40摄氏度并记录反应速率。"
    ].join("；")
  );

  assert.equal(report.passed, true);
  assert.equal(report.metrics.unique_proposition_count, 3);
  assert.equal(report.metrics.duplicate_count, 0);
  assert.deepEqual(
    report.propositions.map((item) => item.numbers),
    [["一", "20"], ["二", "30"], ["三", "40"]]
  );
});

test("protects negation differences from near-duplicate merging", () => {
  const report = analyzeSourceQuality(
    "合外力不为零时物体会产生加速度；合外力为零时物体不会产生加速度。"
  );

  assert.equal(report.passed, true);
  assert.equal(report.metrics.unique_proposition_count, 2);
  assert.equal(report.metrics.duplicate_count, 0);
  assert.notDeepEqual(
    report.propositions[0].negations,
    report.propositions[1].negations
  );
});

test("finds a whole-text repeated unit even without sentence punctuation", () => {
  const unit = "植物利用光能合成有机物并释放氧气";
  const report = analyzeSourceQuality(unit.repeat(3));

  assert.equal(report.passed, false);
  assert.equal(report.error_code, "SOURCE_TOO_REPETITIVE");
  assert.deepEqual(report.repeated_unit, {
    repetitions: 3,
    unit_length: unit.length,
    unit
  });
});

test("two repeated propositions warn but do not hard-fail", () => {
  const report = analyzeSourceQuality(
    `${NORMAL_DEFINITION}${NORMAL_DEFINITION}`
  );

  assert.equal(report.passed, true);
  assert.equal(report.status, "warning");
  assert.deepEqual(report.warning_codes, [
    "SOURCE_HAS_DUPLICATES",
    "SOURCE_LOW_INFORMATION_DENSITY"
  ]);
});

test("similarity is deterministic and punctuation-insensitive", () => {
  assert.equal(
    propositionSimilarity("F=ma，质量保持不变。", "F=ma 质量保持不变!"),
    1
  );
  assert.ok(
    propositionSimilarity(
      "光合作用是植物利用光能合成有机物的过程",
      "光合作用指植物利用光能合成有机物的过程"
    ) > 0.86
  );
  assert.equal(
    propositionSimilarity(
      "温度升高到20摄氏度后反应加快",
      "温度升高到30摄氏度后反应加快"
    ),
    0
  );
  assert.equal(
    propositionSimilarity("物体会继续加速", "物体不会继续加速"),
    0
  );
});

test("rejects invalid input with a stable non-quality error", () => {
  assert.throws(
    () => analyzeSourceQuality({ source: NORMAL_DEFINITION }),
    (error) => {
      assert.ok(error instanceof SourceQualityError);
      assert.equal(error.code, "SOURCE_QUALITY_INVALID_INPUT");
      assert.equal(error.report, null);
      return true;
    }
  );
});
