import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEducationDataStore } from "../education-data-store.js";
import {
  QuestionImportReviewError,
  createQuestionImportReviewService,
} from "../question-import-review-service.js";

const JOB_ID = "import-11111111-1111-4111-8111-111111111111";
const CANDIDATE_ID = "question:source-1";

test("question import review preserves anchors, enforces human mappings, and publishes idempotently", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "question-import-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const importStorageDir = join(root, "imports");
  const artifactCatalogPath = join(root, "artifacts.json");
  await writeFile(artifactCatalogPath, JSON.stringify({
    ontology_ref: { ontology_id: "ontology-1", ontology_version: "v1" },
    artifacts: [{
      artifact_id: "visual:kp-1",
      knowledge_point_id: "kp-1",
      title: "一次函数互动图",
      interactive: { renderer: "controlled", variant: "linear" },
    }],
  }));

  const store = createEducationDataStore({ filename: ":memory:" });
  store.initialize();
  t.after(() => store.close());
  store.upsertTenant({ tenantId: "tenant-1", name: "测试租户" });
  store.importOntology({
    tenantId: "tenant-1",
    ontology: {
      ontology_id: "ontology-1",
      ontology_version: "v1",
      name: "测试本体",
      entity_classes: [
        { key: "domain", name: "领域" },
        { key: "theme", name: "主题" },
        { key: "knowledge_point", name: "知识点" },
      ],
      relation_types: [{ key: "part_of", name: "属于", directed: true }],
      domains: [{ id: "domain-1", name: "数与代数" }],
      themes: [{ id: "theme-1", domain_id: "domain-1", name: "函数" }],
      knowledge_points: [{
        id: "kp-1",
        entity_class: "knowledge_point",
        theme_id: "theme-1",
        name: "一次函数的图象与性质",
        measurable_behavior: "能解释一次函数图象。",
      }],
      edges: [],
    },
  });

  const importService = {
    async get(id) {
      return id === JOB_ID ? importedJob() : null;
    },
  };
  const service = createQuestionImportReviewService({
    importService,
    dataStore: store,
    defaultTenantId: "tenant-1",
    defaultOntologyId: "ontology-1",
    defaultOntologyVersion: "v1",
    importStorageDir,
    artifactCatalogPath,
    now: () => new Date("2026-08-24T08:00:00.000Z"),
    idFactory: () => "publication-1",
  });

  const initial = await service.getReview(JOB_ID);
  assert.equal(initial.counts.pending, 1);
  assert.deepEqual(initial.items[0].source_anchor, importedJob()
    .candidate_pack.candidates.questions[0].source_anchor);
  assert.equal(initial.items[0].candidate.source_anchor.quote, "已知 y=2x+1，求 x=3 时的函数值。");

  await assert.rejects(
    () => service.reviewBatch(JOB_ID, {
      reviewer_id: "teacher-1",
      decisions: [{
        candidate_id: CANDIDATE_ID,
        status: "accept",
        canonical_knowledge_point_id: "kp-1",
        question_type: "calculation",
        difficulty: "foundation",
        solution_strategy: "先代入自变量，再计算并检验函数值。",
      }],
    }),
    (error) => error instanceof QuestionImportReviewError
      && error.code === "question_review_card_decision_required",
  );

  const reviewed = await service.reviewBatch(JOB_ID, {
    reviewer_id: "teacher-1",
    expected_revision: 0,
    decisions: [{
      candidate_id: CANDIDATE_ID,
      status: "accept",
      canonical_knowledge_point_id: "kp-1",
      question_type: "calculation",
      difficulty: "foundation",
      solution_strategy: "先代入自变量，再计算并检验函数值。",
      answer_key: "7",
      artifact_ref: "visual:kp-1",
      card_pending: false,
    }],
  });
  assert.equal(reviewed.counts.accept, 1);
  assert.equal(reviewed.items[0].artifact_ref, "visual:kp-1");
  assert.deepEqual(reviewed.items[0].source_anchor, initial.items[0].source_anchor);

  const publication = await service.publish(JOB_ID, {
    reviewer_id: "teacher-1",
    expected_revision: reviewed.revision,
  });
  assert.equal(publication.idempotent, false);
  assert.equal(publication.question_count, 1);
  assert.equal(publication.card_bound_count, 1);
  const publicQuestions = store.listQuestions({ tenantId: "tenant-1" });
  assert.equal(publicQuestions.total, 1);
  assert.equal(publicQuestions.items[0].artifact_ref.artifact_id, "visual:kp-1");
  assert.equal(JSON.stringify(publicQuestions).includes("answer_key"), false);
  assert.equal(JSON.stringify(publicQuestions).includes("solution_plan"), false);
  const privateSolution = store.getQuestionSolution({
    tenantId: "tenant-1",
    questionId: publicQuestions.items[0].id,
  });
  assert.equal(privateSolution.storage_classification, "server_private");
  assert.equal(privateSolution.private_payload.key.value, "7");
  assert.match(privateSolution.private_payload.solution_plan.explanation, /代入自变量/u);

  const repeated = await service.publish(JOB_ID, { reviewer_id: "teacher-1" });
  assert.equal(repeated.idempotent, true);
  assert.equal(store.listQuestions({ tenantId: "tenant-1" }).total, 1);
});

test("question import review tracks reject and needs_edit per item", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "question-import-review-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = {
    listOntologies: () => [{ ontology_id: "ontology-1", ontology_version: "v1" }],
    listKnowledgePoints: () => ({
      ontology_id: "ontology-1",
      ontology_version: "v1",
      items: [{ id: "kp-1", name: "一次函数" }],
    }),
    importQuestionBank: () => ({ idempotent: false }),
  };
  const service = createQuestionImportReviewService({
    importService: { get: async () => importedJob() },
    dataStore: store,
    defaultTenantId: "tenant-1",
    defaultOntologyId: "ontology-1",
    importStorageDir: join(root, "imports"),
    artifactCatalogPath: join(root, "missing.json"),
  });

  await assert.rejects(
    () => service.reviewBatch(JOB_ID, {
      decisions: [{ candidate_id: CANDIDATE_ID, status: "needs_edit" }],
    }),
    (error) => error.code === "question_review_note_required",
  );
  const needsEdit = await service.reviewBatch(JOB_ID, {
    decisions: [{
      candidate_id: CANDIDATE_ID,
      status: "needs_edit",
      note: "公式字符缺失，请重新识别原页。",
    }],
  });
  assert.equal(needsEdit.counts.needs_edit, 1);
  assert.equal(needsEdit.items[0].history.length, 1);
  const rejected = await service.reviewBatch(JOB_ID, {
    expected_revision: needsEdit.revision,
    decisions: [{
      candidate_id: CANDIDATE_ID,
      status: "reject",
      note: "这是题型标题，不是完整题目。",
    }],
  });
  assert.equal(rejected.counts.reject, 1);
  assert.equal(rejected.items[0].history.length, 2);
  assert.deepEqual(rejected.items[0].source_anchor, needsEdit.items[0].source_anchor);
});

test("question import review incrementally publishes only newly accepted items and replays idempotently", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "question-import-review-incremental-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactCatalogPath = join(root, "artifacts.json");
  await writeFile(artifactCatalogPath, JSON.stringify({
    ontology_ref: { ontology_id: "ontology-1", ontology_version: "v1" },
    artifacts: [{
      artifact_id: "visual:kp-1",
      knowledge_point_id: "kp-1",
      title: "一次函数互动图",
      interactive: { renderer: "controlled", variant: "linear" },
    }],
  }));

  const store = createEducationDataStore({ filename: ":memory:" });
  store.initialize();
  t.after(() => store.close());
  store.upsertTenant({ tenantId: "tenant-1", name: "测试租户" });
  store.importOntology({
    tenantId: "tenant-1",
    ontology: {
      ontology_id: "ontology-1",
      ontology_version: "v1",
      name: "测试本体",
      entity_classes: [
        { key: "domain", name: "领域" },
        { key: "theme", name: "主题" },
        { key: "knowledge_point", name: "知识点" },
      ],
      relation_types: [{ key: "part_of", name: "属于", directed: true }],
      domains: [{ id: "domain-1", name: "数与代数" }],
      themes: [{ id: "theme-1", domain_id: "domain-1", name: "函数" }],
      knowledge_points: [{
        id: "kp-1",
        entity_class: "knowledge_point",
        theme_id: "theme-1",
        name: "一次函数的图象与性质",
        measurable_behavior: "能解释一次函数图象。",
      }],
      edges: [],
    },
  });

  const job = importedJobWithTwoQuestions();
  const service = createQuestionImportReviewService({
    importService: { get: async (id) => id === JOB_ID ? job : null },
    dataStore: store,
    defaultTenantId: "tenant-1",
    defaultOntologyId: "ontology-1",
    defaultOntologyVersion: "v1",
    importStorageDir: join(root, "imports"),
    artifactCatalogPath,
    now: () => new Date("2026-08-24T09:00:00.000Z"),
    idFactory: (() => {
      let sequence = 0;
      return () => `publication-${++sequence}`;
    })(),
  });

  const firstReviewed = await service.reviewBatch(JOB_ID, {
    reviewer_id: "teacher-1",
    expected_revision: 0,
    decisions: [acceptedDecision(CANDIDATE_ID, "7")],
  });
  const firstPublished = await service.publish(JOB_ID, {
    reviewer_id: "teacher-1",
    expected_revision: firstReviewed.revision,
  });
  assert.equal(firstPublished.idempotent, false);
  assert.equal(firstPublished.question_count, 1);
  assert.equal(firstPublished.skipped_published_count, 0);
  assert.equal(firstPublished.cumulative_published_count, 1);
  assert.equal(store.listQuestions({ tenantId: "tenant-1" }).total, 1);
  const firstItemPublication = structuredClone(firstPublished.review.items[0].publication);

  const secondReviewed = await service.reviewBatch(JOB_ID, {
    reviewer_id: "teacher-1",
    expected_revision: firstPublished.review.revision,
    decisions: [acceptedDecision("question:source-2", "9")],
  });
  const replayExpectedRevision = secondReviewed.revision;
  const secondPublished = await service.publish(JOB_ID, {
    reviewer_id: "teacher-1",
    expected_revision: replayExpectedRevision,
  });
  assert.equal(secondPublished.idempotent, false);
  assert.equal(secondPublished.question_count, 1);
  assert.equal(secondPublished.skipped_published_count, 1);
  assert.equal(secondPublished.cumulative_published_count, 2);
  assert.equal(store.listQuestions({ tenantId: "tenant-1" }).total, 2);
  assert.deepEqual(secondPublished.review.items[0].publication, firstItemPublication);
  assert.equal(secondPublished.review.items[1].publication.status, "published");
  assert.notEqual(
    secondPublished.review.items[1].publication.fingerprint,
    firstItemPublication.fingerprint,
  );
  assert.equal(secondPublished.review.publication_history.length, 2);

  const questions = store.listQuestions({ tenantId: "tenant-1", knowledgePointId: "kp-1" });
  assert.equal(questions.total, 2);
  for (const question of questions.items) {
    assert.equal(question.knowledge_point_mappings[0].knowledge_point_id, "kp-1");
    assert.equal(question.artifact_ref.artifact_id, "visual:kp-1");
    assert.equal(question.source_anchor.document_id, "doc-1");
    const solution = store.getQuestionSolution({
      tenantId: "tenant-1",
      questionId: question.id,
    });
    assert.equal(solution.storage_classification, "server_private");
    assert.match(solution.private_payload.solution_plan.explanation, /代入自变量/u);
  }

  const replayed = await service.publish(JOB_ID, {
    reviewer_id: "teacher-1",
    expected_revision: replayExpectedRevision,
  });
  assert.equal(replayed.idempotent, true);
  assert.equal(replayed.publication_id, secondPublished.publication_id);
  assert.equal(replayed.fingerprint, secondPublished.fingerprint);
  assert.equal(replayed.skipped_published_count, 2);
  assert.equal(replayed.cumulative_published_count, 2);
  assert.equal(store.listQuestions({ tenantId: "tenant-1" }).total, 2);
  assert.equal(replayed.review.publication_history.length, 2);
  assert.deepEqual(replayed.review.items[0].publication, firstItemPublication);
});

function acceptedDecision(candidateId, answerKey) {
  return {
    candidate_id: candidateId,
    status: "accept",
    canonical_knowledge_point_id: "kp-1",
    question_type: "calculation",
    difficulty: "foundation",
    solution_strategy: "先代入自变量，再计算并检验函数值。",
    answer_key: answerKey,
    artifact_ref: "visual:kp-1",
    card_pending: false,
  };
}

function importedJobWithTwoQuestions() {
  const first = importedJob();
  return {
    ...first,
    candidate_pack: {
      ...first.candidate_pack,
      candidates: {
        ...first.candidate_pack.candidates,
        questions: [
          first.candidate_pack.candidates.questions[0],
          {
            ...first.candidate_pack.candidates.questions[0],
            id: "question:source-2",
            revision_id: "question-revision-2",
            stem: "已知 y=2x+3，求 x=3 时的函数值。",
            source_anchor: {
              ...first.candidate_pack.candidates.questions[0].source_anchor,
              page_index: 3,
              block_ids: ["block-8"],
              quote: "已知 y=2x+3，求 x=3 时的函数值。",
              content_hash: "b".repeat(64),
            },
          },
        ],
      },
    },
  };
}

function importedJob() {
  return {
    id: JOB_ID,
    status: "succeeded",
    source: { file_name: "一次函数题库.pdf" },
    request: { title: "一次函数题库" },
    document_ir: {
      id: "doc-1",
      revision_id: "docrev-1",
      title: "一次函数题库",
    },
    candidate_pack: {
      candidates: {
        questions: [{
          id: CANDIDATE_ID,
          revision_id: "question-revision-1",
          stem: "已知 y=2x+1，求 x=3 时的函数值。",
          question_type: "calculation",
          language: "zh-CN",
          parts: [],
          confidence: { overall: 0.92 },
          review_status: "needs_review",
          source_anchor: {
            document_id: "doc-1",
            document_revision_id: "docrev-1",
            page_index: 2,
            block_ids: ["block-7"],
            quote: "已知 y=2x+1，求 x=3 时的函数值。",
            content_hash: "a".repeat(64),
          },
        }],
      },
    },
  };
}
