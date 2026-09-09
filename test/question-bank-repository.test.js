import assert from "node:assert/strict";
import test from "node:test";

import {
  createQuestionBankRepository
} from "../question-bank-repository.js";

test("question repository keeps public and private payloads separated", async () => {
  const repository = createQuestionBankRepository();
  const summary = await repository.summary();
  assert.equal(summary.public_item_count, 420);
  assert.equal(summary.private_item_count, 420);
  assert.equal(summary.knowledge_point_count, 140);

  const page = await repository.list({
    knowledgePointId: "M4-NA-RAT-01",
    limit: 10
  });
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 3);
  const serialized = JSON.stringify(page);
  assert.doesNotMatch(
    serialized,
    /correct_option_id|correct_answer|answer_key|solution_plan|final_answer/u
  );
});

test("full solution is returned only by the explicit private reveal operation", async () => {
  const repository = createQuestionBankRepository();
  const item = await repository.getPublicItem("JMQ-M4-NA-RAT-01-C01");
  assert.equal(item.solution_preview.full_solution_access, "server_controlled");
  assert.equal(item.solution_plan, undefined);

  const solution = await repository.getSolution(item.id);
  assert.equal(solution.revealed, true);
  assert.equal(solution.answer_key.kind, "option_id");
  assert.ok(solution.solution_plan.steps.length >= 2);
});

test("unknown question ids do not reveal private data", async () => {
  const repository = createQuestionBankRepository();
  assert.equal(await repository.getPublicItem("missing"), null);
  assert.equal(await repository.getSolution("missing"), null);
});
