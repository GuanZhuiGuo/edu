import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8"));
}

function walkKeys(value, visitor, trail = "root") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkKeys(entry, visitor, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    visitor(key, entry, `${trail}.${key}`);
    walkKeys(entry, visitor, `${trail}.${key}`);
  }
}

function evaluateAst(node) {
  if (typeof node === "number") return node;
  assert.ok(node && typeof node === "object" && Array.isArray(node.args));
  const values = node.args.map(evaluateAst);
  if (node.op === "add") return values.reduce((total, value) => total + value, 0);
  if (node.op === "subtract") return values[0] - values[1];
  if (node.op === "multiply") return values.reduce((total, value) => total * value, 1);
  if (node.op === "divide") return values[0] / values[1];
  if (node.op === "pow") return values[0] ** values[1];
  if (node.op === "sqrt") return Math.sqrt(values[0]);
  assert.fail(`Unsupported AST operation: ${node.op}`);
}

test("question bank compiler is deterministic and generated outputs are current", () => {
  const result = spawnSync(process.execPath, ["scripts/compile-junior-math-question-bank.mjs", "--check"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /140 knowledge points, 420 public items, 420 private keys/);
});

test("public bank covers every ontology knowledge point with three stable variants", async () => {
  const [ontology, bank] = await Promise.all([
    readJson("public/data/junior-math-ontology.json"),
    readJson("public/data/junior-math-question-bank.json")
  ]);
  assert.equal(bank.schema_version, "assessment-item-public-bank@1.0");
  assert.equal(bank.statistics.knowledge_point_count, 140);
  assert.equal(bank.items.length, 420);
  assert.deepEqual(bank.statistics.variant_counts, { concept: 140, method: 140, application: 140 });

  const ontologyIds = new Set(ontology.knowledge_points.map((point) => point.id));
  const itemIds = new Set();
  const byPoint = new Map();
  for (const item of bank.items) {
    assert.match(item.id, /^JMQ-M4-[A-Z]+-[A-Z]+-\d{2}-(C01|M01|A01)$/);
    assert.equal(itemIds.has(item.id), false, `duplicate item id: ${item.id}`);
    itemIds.add(item.id);
    assert.equal(item.item_status, "draft");
    assert.equal(item.knowledge_point_mapping.length, 1);
    const mapping = item.knowledge_point_mapping[0];
    assert.equal(mapping.role, "primary");
    assert.equal(mapping.weight, 1);
    assert.equal(ontologyIds.has(mapping.id), true, `unknown knowledge point: ${mapping.id}`);
    if (!byPoint.has(mapping.id)) byPoint.set(mapping.id, new Set());
    byPoint.get(mapping.id).add(item.variant.code);
    assert.equal(item.provenance.seed, true);
    assert.equal(item.provenance.generated, true);
    assert.equal(item.provenance.official_exam_question, false);
    assert.equal(item.provenance.review_status, "pending_teacher_review");
    assert.equal(item.quality.publishable, false);
  }
  assert.equal(itemIds.size, 420);
  for (const pointId of ontologyIds) {
    assert.deepEqual([...byPoint.get(pointId)].sort(), ["application", "concept", "method"], pointId);
  }
});

test("public bank contains no private answer or full-solution fields", async () => {
  const bank = await readJson("public/data/junior-math-question-bank.json");
  const banned = /^(answer|answer_key|correct_answer|correct_option_id|final_answer|analysis|explanation|solution_steps|key_turning_point|common_errors|alternative_solutions)$/i;
  walkKeys(bank, (key, _value, trail) => {
    assert.equal(banned.test(key), false, `private field leaked at ${trail}`);
  });
  assert.equal(bank.privacy_contract.contains_answer_keys, false);
  assert.equal(bank.privacy_contract.contains_full_solutions, false);
  assert.equal(bank.privacy_contract.full_solution_delivery, "authenticated_server_endpoint_only");
});

test("private keys align one-to-one and every item has a complete solution plan", async () => {
  const [publicBank, privateBank] = await Promise.all([
    readJson("public/data/junior-math-question-bank.json"),
    readJson("data/junior-math-question-bank-private.json")
  ]);
  assert.equal(privateBank.storage_classification, "server_private");
  assert.equal(privateBank.access_contract.static_serving_allowed, false);
  assert.equal(privateBank.items.length, 420);

  const publicById = new Map(publicBank.items.map((item) => [item.id, item]));
  const privateIds = new Set();
  for (const item of privateBank.items) {
    assert.equal(privateIds.has(item.question_id), false, `duplicate private id: ${item.question_id}`);
    privateIds.add(item.question_id);
    const publicItem = publicById.get(item.question_id);
    assert.ok(publicItem, `missing public item: ${item.question_id}`);
    assert.equal(item.knowledge_point_id, publicItem.knowledge_point_mapping[0].id);
    assert.ok(item.key && typeof item.key.kind === "string");
    assert.ok(Array.isArray(item.solution_plan.steps) && item.solution_plan.steps.length >= 3);
    assert.ok(item.solution_plan.key_turning_point.length >= 4);
    assert.ok(Array.isArray(item.solution_plan.common_errors) && item.solution_plan.common_errors.length >= 2);
    assert.ok(Array.isArray(item.solution_plan.alternative_solutions));
    assert.ok(item.solution_plan.explanation.length >= 10);
    assert.equal(item.review.seed, true);
    assert.equal(item.review.generated, true);
    assert.equal(item.review.review_status, "pending_teacher_review");
    if (["option_membership", "arithmetic_ast", "accepted_text"].includes(item.verification.kind)) {
      assert.equal(item.review.solver_status, "deterministic_checked");
      assert.equal(item.scoring.requires_human_review, false);
    } else {
      assert.equal(item.review.solver_status, "rubric_defined_human_review_required");
      assert.equal(item.scoring.requires_human_review, true);
    }
  }
  assert.equal(privateIds.size, publicById.size);
});

test("choice and numeric keys pass independent consistency checks", async () => {
  const [publicBank, privateBank] = await Promise.all([
    readJson("public/data/junior-math-question-bank.json"),
    readJson("data/junior-math-question-bank-private.json")
  ]);
  const publicById = new Map(publicBank.items.map((item) => [item.id, item]));
  let choiceCount = 0;
  let numericCount = 0;
  const correctOptionCounts = new Map();
  for (const privateItem of privateBank.items) {
    const publicItem = publicById.get(privateItem.question_id);
    if (privateItem.key.kind === "option_id") {
      choiceCount += 1;
      const optionIds = publicItem.options.map((option) => option.id);
      assert.equal(new Set(optionIds).size, optionIds.length);
      assert.equal(optionIds.includes(privateItem.key.value), true);
      assert.deepEqual(privateItem.verification.option_ids, optionIds);
      correctOptionCounts.set(privateItem.key.value, (correctOptionCounts.get(privateItem.key.value) || 0) + 1);
    }
    if (privateItem.key.kind === "numeric") {
      numericCount += 1;
      assert.equal(privateItem.verification.kind, "arithmetic_ast");
      const computed = evaluateAst(privateItem.verification.ast);
      assert.ok(Math.abs(computed - privateItem.key.value) <= privateItem.key.tolerance, privateItem.question_id);
    }
  }
  assert.equal(choiceCount, 140);
  assert.equal(numericCount, 40);
  for (const optionId of ["A", "B", "C", "D"]) {
    assert.ok((correctOptionCounts.get(optionId) || 0) >= 20, `correct option ${optionId} is underrepresented`);
  }
});

test("public and private JSON schemas document their security boundary", async () => {
  const [publicSchema, privateSchema] = await Promise.all([
    readJson("public/data/junior-math-question-bank.schema.json"),
    readJson("data/junior-math-question-bank-private.schema.json")
  ]);
  assert.equal(publicSchema.title, "JuniorMathQuestionBankPublic");
  assert.match(publicSchema.properties.items.items.properties.solution_preview.description, /不包含答案/);
  assert.equal(privateSchema.title, "JuniorMathQuestionBankPrivate");
  assert.equal(privateSchema.properties.storage_classification.const, "server_private");
  assert.match(privateSchema.description, /不得由静态目录直接提供/);
});
