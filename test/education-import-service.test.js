import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  EducationImportServiceError,
  createEducationImportService,
  validateEducationImportCandidatePack,
} from "../education-import-service.js";
import {
  validateDocumentIR,
  validateQuestionIR,
  validateSubmissionIR,
} from "../education-import-contracts.js";
import { createArkEducationModelClient } from "../ark-education-model-client.js";

const FIXED_NOW = "2026-08-16T08:00:00.000Z";
const FIXED_JOB_UUID = "11111111-1111-4111-8111-111111111111";

function semanticClauseFixture(input, suffix = "fixture") {
  const lines = String(input?.input || "").split("\n");
  const markerIndex = lines.indexOf("SOURCE_BLOCKS_JSONL");
  const source = JSON.parse(lines.slice(markerIndex + 1).find((line) => line.trim().startsWith("{")));
  return {
    entities: [{
      proposal_id: `kp:${suffix}`,
      entity_type: "knowledge_point",
      display_name: "一次函数的概念与应用",
      statement: "理解一次函数的概念，并能使用其表达式解决问题。",
      action_verb: "理解",
      knowledge_form: "concept",
      aliases: [],
      parent_proposal_id: null,
      basis: "explicit",
      confidence: 0.92,
      source_refs: [{ page_index: source.page_index, block_ids: [source.block_id] }],
    }],
    relations: [],
    question_links: [],
    solution_strategies: [],
    proposition_angles: [],
    misconceptions: [],
  };
}

test("persists a native PDF job and produces valid DocumentIR and candidate pack", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const calls = [];
  const runner = createPdfRunner({
    calls,
    text: [
      "\u521d\u4e2d\u6570\u5b66\u671f\u4e2d\u8bd5\u5377",
      "1. \u5df2\u77e5\u4e00\u6b21\u51fd\u6570 y = 2x + 1\uff0c\u8bf7\u6c42 x = 3 \u65f6\u7684\u51fd\u6570\u503c\u5e76\u5199\u51fa\u5fc5\u8981\u8fc7\u7a0b\u3002",
      "A. 5\nB. 6\nC. 7\nD. 8",
      "\u672c\u8bd5\u5377\u7528\u4e8e\u9a8c\u8bc1 PDF \u539f\u751f\u6587\u672c\u62bd\u53d6\u3001\u5206\u9875\u6805\u683c\u5316\u3001\u7ed3\u6784\u5316\u5019\u9009\u751f\u6210\u4e0e\u672c\u5730\u6301\u4e45\u5316\u6d41\u7a0b\u3002",
    ].join("\n\n"),
  });
  let modelCalls = 0;
  const service = createEducationImportService({
    storageDir,
    commandRunner: runner,
    modelClient: {
      configSummary: () => ({ configured: true }),
      async chatCompletion() {
        modelCalls += 1;
        throw new Error("native PDF should not call the visual model");
      },
    },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());

  const created = await service.create({
    file_name: "\u521d\u4e2d\u6570\u5b66\u671f\u4e2d\u8bd5\u5377.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
  });

  assert.equal(created.id, `import-${FIXED_JOB_UUID}`);
  assert.equal(created.status, "queued");
  assert.equal(created.request.identity_status, "unresolved");
  const result = await service.waitForCompletion(created.id);

  assert.equal(result.status, "succeeded", JSON.stringify(result.error));
  assert.equal(result.document_ir.document_type, "exam_paper");
  assert.equal(validateDocumentIR(result.document_ir).valid, true);
  assert.deepEqual(
    validateEducationImportCandidatePack(result.candidate_pack, result.document_ir),
    { valid: true, errors: [] },
  );
  assert.equal(result.candidate_pack.receipt.model.used, false);
  assert.deepEqual(result.candidate_pack.receipt.native.pdf_tools_used, [
    "pdfinfo",
    "pdftotext",
    "pdftoppm",
  ]);
  assert.equal(result.candidate_pack.assets.length, 1);
  assert.match(result.candidate_pack.assets[0].storage_ref, /^pages\/page-0001\.png$/u);
  assert.ok(result.candidate_pack.candidates.questions.length >= 1);
  assert.equal(modelCalls, 0);
  assert.deepEqual(calls.map((call) => call.command), ["pdfinfo", "pdftotext", "pdftoppm"]);
  assert.deepEqual(calls[2].args.slice(0, 8), [
    "-f", "1", "-l", "1", "-singlefile", "-scale-to", "1800", "-png",
  ]);
  assert.equal(JSON.stringify(result).includes(storageDir), false);

  const listed = await service.list({ status: "succeeded" });
  assert.equal(listed.total, 1);
  assert.equal(listed.jobs[0].result.page_count, 1);
  assert.equal("document_ir" in listed.jobs[0], false);

  const persistedDocument = JSON.parse(await readFile(
    join(storageDir, created.id, "document-ir.json"),
    "utf8",
  ));
  assert.equal(persistedDocument.id, result.document_ir.id);
  assert.equal((await stat(storageDir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(storageDir, created.id, "source.pdf"))).mode & 0o777, 0o600);
  assert.equal(
    (await stat(join(storageDir, created.id, "pages", "page-0001.png"))).mode & 0o777,
    0o600,
  );
});

test("uses injected Ark visual chat for student work and keeps candidates review-only", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const modelInputs = [];
  const service = createEducationImportService({
    storageDir,
    modelClient: {
      configSummary: () => ({ configured: true }),
      async chatCompletion(input) {
        modelInputs.push(input);
        return {
          id: "chatcmpl-import-1",
          model: "vision-test-model",
          requestId: "request-import-1",
          finishReason: "stop",
          usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
          text: JSON.stringify({
            document: {
              document_type: "student_homework",
              title: "\u4e00\u6b21\u51fd\u6570\u5b66\u751f\u4f5c\u4e1a",
              language: "zh-CN",
              subject: "\u6570\u5b66",
              grade_band: "\u516b\u5e74\u7ea7",
            },
            blocks: [
              {
                type: "question_stem",
                text: "1. \u8ba1\u7b97 2x + 1 = 7 \u4e2d x \u7684\u503c",
                normalized_text: "1. \u8ba1\u7b97 2x + 1 = 7 \u4e2d x \u7684\u503c",
                layer: "printed",
                bbox: [0.1, 0.1, 0.8, 0.2],
                confidence: 0.96,
                question_number: "1",
                option_label: null,
                score_value: null,
                max_score: null,
              },
              {
                type: "student_response",
                text: "x = 3",
                normalized_text: "x=3",
                layer: "student",
                bbox: [0.15, 0.4, 0.4, 0.15],
                confidence: 0.87,
                question_number: "1",
                option_label: null,
                score_value: null,
                max_score: null,
              },
              {
                type: "teacher_mark",
                text: "\u6b63\u786e",
                normalized_text: "\u6b63\u786e",
                layer: "teacher",
                bbox: [0.7, 0.4, 0.2, 0.15],
                confidence: 0.8,
                question_number: "1",
                option_label: null,
                score_value: 5,
                max_score: 5,
              },
            ],
            questions: [{
              local_id: "q1",
              question_number: "1",
              question_type: "calculation",
              response_type: "workings",
              stem: "\u8ba1\u7b97 2x + 1 = 7 \u4e2d x \u7684\u503c",
              options: [],
              student_response: "x = 3",
              selected_option_labels: [],
              teacher_feedback: "\u6b63\u786e",
              score: 5,
              max_score: 5,
              confidence: 0.88,
            }],
            warnings: [],
          }),
        };
      },
    },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());

  const created = await service.create({
    file: {
      name: "../\u5b66\u751f\u4f5c\u4e1a.png",
      type: "image/png",
      buffer: makePng(1200, 1600),
    },
    document_type: "student_homework",
    tenant_id: "tenant-1",
    learner_id: "learner-1",
  });
  const result = await service.waitForCompletion(created.id);

  assert.equal(result.status, "succeeded");
  assert.equal(result.source.file_name, "\u5b66\u751f\u4f5c\u4e1a.png");
  assert.equal(modelInputs.length, 1);
  assert.equal(modelInputs[0].responseFormat.type, "json_schema");
  assert.equal(modelInputs[0].responseFormat.json_schema.strict, true);
  assert.match(
    modelInputs[0].messages[1].content[1].image_url.url,
    /^data:image\/png;base64,/u,
  );
  assert.equal(modelInputs[0].signal instanceof AbortSignal, true);
  assert.equal(result.document_ir.review_status, "needs_review");
  assert.equal(result.candidate_pack.review_status, "needs_review");
  assert.equal(result.candidate_pack.candidates.questions.length, 1);
  assert.equal(result.candidate_pack.candidates.submissions.length, 1);
  assert.deepEqual(result.candidate_pack.candidates.questions[0].asset_ids, []);
  assert.deepEqual(result.candidate_pack.candidates.questions[0].parts[0].asset_ids, []);
  assert.deepEqual(
    result.candidate_pack.candidates.submissions[0].responses[0].asset_ids,
    [result.candidate_pack.assets[0].id],
  );
  assert.equal(
    validateQuestionIR(result.candidate_pack.candidates.questions[0]).valid,
    true,
  );
  assert.equal(
    validateSubmissionIR(result.candidate_pack.candidates.submissions[0]).valid,
    true,
  );
  assert.equal(
    result.candidate_pack.candidates.submissions[0].grading_events[0].is_final,
    false,
  );
  assert.equal(result.candidate_pack.candidates.evidence.length, 0);
  assert.equal(result.candidate_pack.candidates.question_knowledge_links.length, 0);
  assert.equal(result.candidate_pack.receipt.model.request_ids[0], "request-import-1");
  assert.equal(JSON.stringify(result).includes("data:image/png"), false);

  const questionId = result.candidate_pack.candidates.questions[0].id;
  const reviewedQuestion = await service.review(created.id, {
    target_type: "question",
    target_id: questionId,
    status: "verified",
    reviewer_id: "teacher-1",
    note: "\u5df2\u5bf9\u7167\u539f\u56fe\u590d\u6838",
  });
  assert.equal(reviewedQuestion.candidate_pack.candidates.questions[0].review_status, "verified");
  assert.equal(reviewedQuestion.candidate_pack.review_status, "needs_review");
  assert.equal(reviewedQuestion.candidate_pack.review_history.length, 1);

  const reviewedPack = await service.review(created.id, {
    target_type: "pack",
    status: "verified",
    reviewer_id: "teacher-1",
    note: "\u6574\u5305\u590d\u6838\u901a\u8fc7",
  });
  assert.equal(reviewedPack.document_ir.review_status, "verified");
  assert.equal(reviewedPack.candidate_pack.review_status, "verified");
  assert.equal(reviewedPack.candidate_pack.candidates.submissions[0].review_status, "verified");
});

test("routes numbered curriculum clauses to standards without creating fake questions", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const curriculumText = [
    "1. 数与代数领域引导学生理解数的意义和运算的一致性。",
    "2. 图形与几何领域引导学生发展空间观念和几何直观。",
    "3. 统计与概率领域引导学生用数据表达和解释现实问题。",
    "4. 综合与实践领域引导学生综合运用数学知识解决真实情境中的问题。",
  ].join("\n");
  const service = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({ text: curriculumText }),
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());

  const created = await service.create({
    file_name: "curriculum-numbered.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
    document_type: "curriculum_standard",
  });
  const result = await service.waitForCompletion(created.id);

  assert.equal(result.status, "succeeded", JSON.stringify(result.error));
  assert.equal(result.candidate_pack.candidates.questions.length, 0);
  assert.ok(result.candidate_pack.candidates.curriculum_standards.length >= 4);
  assert.ok(result.document_ir.pages[0].blocks.every((block) => block.type !== "question_stem"));
});

test("integrates with the real Ark client boundary without persisting its credential", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const apiKey = "test-only-ark-secret";
  const requests = [];
  const modelClient = createArkEducationModelClient({
    env: {
      ARK_API_KEY: apiKey,
      ARK_BASE_URL: "https://ark.example.test/api/v3",
      ARK_VISION_MODEL: "vision-import-test",
      ARK_MODEL_MAX_RETRIES: "0",
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === "x-request-id" ? "request-real-client" : null },
        async text() {
          return JSON.stringify({
            id: "chatcmpl-real-client",
            model: "vision-import-test",
            choices: [{
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  document: {
                    document_type: "courseware",
                    title: "\u4e00\u6b21\u51fd\u6570\u8bfe\u4ef6",
                    language: "zh-CN",
                    subject: "\u6570\u5b66",
                    grade_band: "\u516b\u5e74\u7ea7",
                  },
                  blocks: [],
                  questions: [],
                  warnings: [],
                }),
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          });
        },
      };
    },
  });
  const service = createEducationImportService({
    storageDir,
    modelClient,
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());

  const created = await service.create({
    file_name: "courseware.png",
    mime_type: "image/png",
    buffer: makePng(800, 600),
  });
  const result = await service.waitForCompletion(created.id);

  assert.equal(result.status, "succeeded");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://ark.example.test/api/v3/chat/completions");
  assert.equal(requests[0].init.headers.authorization, `Bearer ${apiKey}`);
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, "vision-import-test");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.name, "education_import_page");
  assert.match(body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/u);
  assert.equal(result.candidate_pack.receipt.model.request_ids[0], "request-real-client");
  const persistedJob = await readFile(join(storageDir, created.id, "job.json"), "utf8");
  const persistedPack = await readFile(join(storageDir, created.id, "candidate-pack.json"), "utf8");
  assert.equal(persistedJob.includes(apiKey), false);
  assert.equal(persistedPack.includes(apiKey), false);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
});

test("resumes a persisted unfinished job after restart without retaining a model client or secret", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const firstService = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({
      text: "\u8fd9\u662f\u4e00\u4efd\u539f\u751f PDF \u6559\u6750\u6587\u672c\uff0c\u5177\u6709\u8db3\u591f\u591a\u7684\u5b57\u7b26\u7528\u4e8e\u907f\u514d\u542f\u52a8\u89c6\u89c9\u6a21\u578b\u5206\u6790\u6d41\u7a0b\uff0c\u5e76\u9a8c\u8bc1\u91cd\u542f\u540e\u7684\u672c\u5730\u6301\u4e45\u5316\u4efb\u52a1\u53ef\u4ee5\u6b63\u5e38\u88ab\u8bfb\u53d6\u3002".repeat(3),
    }),
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  const created = await firstService.create({
    file_name: "\u6559\u6750.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
    document_type: "textbook",
  });
  const completed = await firstService.waitForCompletion(created.id);
  assert.equal(completed.status, "succeeded");
  await firstService.close();

  const jobPath = join(storageDir, created.id, "job.json");
  const interruptedJob = JSON.parse(await readFile(jobPath, "utf8"));
  interruptedJob.status = "processing";
  interruptedJob.phase = "native_text";
  interruptedJob.completed_at = null;
  interruptedJob.result = null;
  await writeFile(jobPath, `${JSON.stringify(interruptedJob, null, 2)}\n`, "utf8");

  const resumedCalls = [];
  const secondService = createEducationImportService({
    storageDir,
    modelClient: null,
    commandRunner: createPdfRunner({
      calls: resumedCalls,
      text: "\u8fd9\u662f\u4e00\u4efd\u539f\u751f PDF \u6559\u6750\u6587\u672c\uff0c\u5177\u6709\u8db3\u591f\u591a\u7684\u5b57\u7b26\u7528\u4e8e\u907f\u514d\u542f\u52a8\u89c6\u89c9\u6a21\u578b\u5206\u6790\u6d41\u7a0b\uff0c\u5e76\u9a8c\u8bc1\u91cd\u542f\u540e\u7684\u672c\u5730\u6301\u4e45\u5316\u4efb\u52a1\u53ef\u4ee5\u6b63\u5e38\u88ab\u8bfb\u53d6\u3002".repeat(3),
    }),
  });
  t.after(() => secondService.close());
  const listedDuringResume = await secondService.list();
  const restored = await secondService.waitForCompletion(created.id);

  assert.equal(listedDuringResume.total, 1);
  assert.equal(restored.status, "succeeded");
  assert.equal(restored.document_ir.id, completed.document_ir.id);
  assert.deepEqual(resumedCalls.map((call) => call.command), [
    "pdfinfo",
    "pdftotext",
    "pdftoppm",
  ]);
  assert.equal(secondService.configSummary().model_configured, false);
  assert.equal(JSON.stringify(restored).includes("ARK_API_KEY"), false);
});

test("enforces content sniffing, path boundaries, page limits, and sanitized failures", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const service = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({ pages: 3, text: "short" }),
    limits: { maxPages: 2 },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());

  await assert.rejects(
    service.create({
      file_name: "fake.pdf",
      mime_type: "application/pdf",
      buffer: makePng(10, 10),
    }),
    (error) => {
      assert.ok(error instanceof EducationImportServiceError);
      assert.equal(error.code, "education_import_mime_mismatch");
      assert.equal(error.status, 415);
      return true;
    },
  );
  await assert.rejects(
    service.create({ source_path: join(storageDir, "not-allowed.pdf") }),
    (error) => error.code === "education_import_source_path_disabled",
  );

  const created = await service.create({
    file_name: "too-many-pages.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
  });
  const failed = await service.waitForCompletion(created.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "education_import_page_limit_exceeded");
  assert.equal(JSON.stringify(failed).includes(storageDir), false);
});

test("admits concurrent creates atomically and enforces the pending-job cap", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const service = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({
      text: "\u8fd9\u662f\u4e00\u4efd\u5177\u6709\u8db3\u591f\u539f\u751f\u6587\u672c\u7684 PDF \u6587\u6863\uff0c\u7528\u4e8e\u9a8c\u8bc1\u5e76\u53d1\u5bfc\u5165\u65f6\u7684\u4efb\u52a1\u961f\u5217\u5bb9\u91cf\u9650\u5236\u3001\u539f\u5b50\u51c6\u5165\u5224\u65ad\u4e0e\u540e\u53f0\u5904\u7406\u72b6\u6001\u3002".repeat(3),
    }),
    limits: { maxPendingJobs: 1, maxConcurrentJobs: 1 },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());
  const input = {
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
    document_type: "textbook",
  };

  const outcomes = await Promise.allSettled([
    service.create({ ...input, file_name: "first.pdf" }),
    service.create({ ...input, file_name: "second.pdf" }),
  ]);
  const accepted = outcomes.find((outcome) => outcome.status === "fulfilled");
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");

  assert.ok(accepted);
  assert.ok(rejected);
  assert.equal(rejected.reason.code, "education_import_queue_full");
  assert.equal((await service.waitForCompletion(accepted.value.id)).status, "succeeded");
  assert.equal((await service.list()).total, 1);
});

test("close leaves an active task recoverable and waits for its lease to release", async (t) => {
  const storageDir = await temporaryDirectory(t);
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const blockingRunner = async (command, args, { signal }) => {
    if (basename(command) !== "pdfinfo") throw new Error("unexpected command");
    markStarted();
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(
        new DOMException("aborted", "AbortError"),
      ), { once: true });
    });
  };
  const firstService = createEducationImportService({
    storageDir,
    commandRunner: blockingRunner,
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  const created = await firstService.create({
    file_name: "interruptible.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
    document_type: "textbook",
  });
  await started;
  await firstService.close();

  const interrupted = JSON.parse(await readFile(join(storageDir, created.id, "job.json"), "utf8"));
  assert.equal(interrupted.status, "queued");
  assert.equal(interrupted.phase, "interrupted");
  await assert.rejects(stat(join(storageDir, created.id, "processing.lock")), { code: "ENOENT" });

  const resumedService = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({
      text: "\u5173\u95ed\u524d\u7684\u4efb\u52a1\u5728\u91cd\u542f\u540e\u5e94\u7ee7\u7eed\u6267\u884c\uff0c\u800c\u4e0d\u5e94\u88ab\u8bb0\u5f55\u4e3a\u8d85\u65f6\u5931\u8d25\u3002".repeat(4),
    }),
  });
  t.after(() => resumedService.close());
  const resumed = await resumedService.waitForCompletion(created.id);
  assert.equal(resumed.status, "succeeded");
});

test("a persistent lease prevents two service instances from consuming one recovered task", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const seedService = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({
      text: "\u6301\u4e45\u5316\u4efb\u52a1\u5728\u591a\u5b9e\u4f8b\u542f\u52a8\u65f6\u53ea\u80fd\u7531\u4e00\u4e2a\u670d\u52a1\u5b9e\u4f8b\u6d88\u8d39\uff0c\u4ee5\u9632\u6b62\u91cd\u590d\u7684 PDF \u5de5\u5177\u6267\u884c\u4e0e\u89c6\u89c9\u6a21\u578b\u8ba1\u8d39\u3002".repeat(3),
    }),
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  const seeded = await seedService.create({
    file_name: "lease.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
    document_type: "textbook",
  });
  await seedService.waitForCompletion(seeded.id);
  await seedService.close();
  await markJobInterrupted(storageDir, seeded.id);

  const calls = [];
  const runner = createPdfRunner({
    calls,
    text: "\u6301\u4e45\u5316\u4efb\u52a1\u5728\u591a\u5b9e\u4f8b\u542f\u52a8\u65f6\u53ea\u80fd\u7531\u4e00\u4e2a\u670d\u52a1\u5b9e\u4f8b\u6d88\u8d39\uff0c\u4ee5\u9632\u6b62\u91cd\u590d\u7684 PDF \u5de5\u5177\u6267\u884c\u4e0e\u89c6\u89c9\u6a21\u578b\u8ba1\u8d39\u3002".repeat(3),
    delayMs: 40,
  });
  const serviceA = createEducationImportService({ storageDir, commandRunner: runner });
  const serviceB = createEducationImportService({ storageDir, commandRunner: runner });
  t.after(() => Promise.all([serviceA.close(), serviceB.close()]));

  await Promise.all([serviceA.initialize(), serviceB.initialize()]);
  const [resultA, resultB] = await Promise.all([
    serviceA.waitForCompletion(seeded.id),
    serviceB.waitForCompletion(seeded.id),
  ]);

  assert.equal(resultA.status, "succeeded");
  assert.equal(resultB.status, "succeeded");
  assert.deepEqual(calls.map((call) => call.command), ["pdfinfo", "pdftotext", "pdftoppm"]);
});

test("recovery fails closed when persisted source bytes no longer match the task receipt", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const seedService = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({ text: "\u6e90\u6587\u4ef6\u5b8c\u6574\u6027\u6821\u9a8c\u9700\u8981\u8db3\u591f\u7684\u539f\u751f\u6587\u672c\u4ee5\u907f\u514d\u89c6\u89c9\u5206\u6790\u3002".repeat(4) }),
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  const seeded = await seedService.create({
    file_name: "integrity.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\noriginal", "utf8"),
    document_type: "textbook",
  });
  await seedService.waitForCompletion(seeded.id);
  await seedService.close();
  await markJobInterrupted(storageDir, seeded.id);
  await writeFile(
    join(storageDir, seeded.id, "source.pdf"),
    Buffer.from("%PDF-1.7\nreplaced", "utf8"),
  );
  let toolCalls = 0;
  const recoveryService = createEducationImportService({
    storageDir,
    commandRunner: async () => {
      toolCalls += 1;
      throw new Error("tools must not run after an integrity failure");
    },
  });
  t.after(() => recoveryService.close());

  const result = await recoveryService.waitForCompletion(seeded.id);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "education_import_source_integrity_failed");
  assert.equal(toolCalls, 0);
});

test("rejects syntactically valid Ark JSON that does not satisfy the local page schema", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const service = createEducationImportService({
    storageDir,
    modelClient: {
      configSummary: () => ({ configured: true }),
      async chatCompletion() {
        return { text: "{}", finishReason: "stop", model: "fixture-model" };
      },
    },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());
  const created = await service.create({
    file_name: "invalid-model-output.png",
    mime_type: "image/png",
    buffer: makePng(300, 400),
  });
  const result = await service.waitForCompletion(created.id);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "education_import_vision_response_invalid");
});

test("infers student PDFs before routing, anchors each question, scopes private ids, and gates review", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const modelCalls = [];
  let idCounter = 0;
  const service = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({
      text: "\u8fd9\u662f\u5b66\u751f\u4f5c\u4e1a PDF \u4e2d\u53ef\u62bd\u53d6\u7684\u5370\u5237\u6587\u672c\uff0c\u5b57\u7b26\u6570\u8db3\u591f\u591a\uff0c\u4f46\u4ecd\u5fc5\u987b\u4f7f\u7528\u89c6\u89c9\u6a21\u578b\u8bc6\u522b\u624b\u5199\u7b54\u6848\u548c\u6559\u5e08\u6279\u6ce8\u3002".repeat(3),
    }),
    modelClient: {
      configSummary: () => ({ configured: true }),
      async chatCompletion(input) {
        modelCalls.push(input);
        return {
          text: JSON.stringify(makeStudentVisualPayload()),
          finishReason: "stop",
          model: "vision-test-model",
          requestId: `request-${modelCalls.length}`,
        };
      },
    },
    idFactory: () => {
      idCounter += 1;
      return `22222222-2222-4222-8222-${String(idCounter).padStart(12, "0")}`;
    },
  });
  t.after(() => service.close());
  const source = Buffer.from("%PDF-1.7\nstudent-homework", "utf8");
  const firstJob = await service.create({
    file_name: "\u5b66\u751f\u4f5c\u4e1a.pdf",
    mime_type: "application/pdf",
    buffer: source,
    tenant_id: "tenant-1",
    learner_id: "learner-1",
  });
  const first = await service.waitForCompletion(firstJob.id);

  assert.equal(first.status, "succeeded");
  assert.equal(first.document_ir.document_type, "student_homework");
  assert.equal(first.progress.vision_pages, 1);
  assert.equal(modelCalls.length, 1);
  assert.equal(first.candidate_pack.candidates.questions.length, 2);
  assert.equal(first.candidate_pack.candidates.submissions[0].responses.length, 2);
  const [firstQuestion, secondQuestion] = first.candidate_pack.candidates.questions;
  assert.notDeepEqual(firstQuestion.source_anchor.block_ids, secondQuestion.source_anchor.block_ids);

  const secondJob = await service.create({
    file_name: "\u5b66\u751f\u4f5c\u4e1a.pdf",
    mime_type: "application/pdf",
    buffer: source,
    tenant_id: "tenant-2",
    learner_id: "learner-2",
  });
  const second = await service.waitForCompletion(secondJob.id);
  assert.notEqual(first.document_ir.id, second.document_ir.id);
  assert.notEqual(
    first.candidate_pack.candidates.submissions[0].id,
    second.candidate_pack.candidates.submissions[0].id,
  );
  assert.notEqual(
    first.candidate_pack.candidates.submissions[0].attempt.id,
    second.candidate_pack.candidates.submissions[0].attempt.id,
  );

  const unresolvedJob = await service.create({
    file_name: "\u5b66\u751f\u4f5c\u4e1a.pdf",
    mime_type: "application/pdf",
    buffer: source,
  });
  const unresolved = await service.waitForCompletion(unresolvedJob.id);
  assert.equal(unresolved.candidate_pack.candidates.submissions[0].identity.status, "unresolved");
  await assert.rejects(
    service.review(unresolvedJob.id, { target_type: "pack", status: "verified" }),
    (error) => error.code === "education_import_review_gate_failed" && error.status === 409,
  );
});

test("persists semantic proposal sidecars without treating them as published ontology facts", async (t) => {
  const storageDir = await temporaryDirectory(t);
  let semanticCalls = 0;
  const service = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({
      text: "理解一次函数的概念，并能根据图像分析函数随自变量变化的规律。".repeat(6),
    }),
    semanticModelClient: {
      configSummary: () => ({ configured: true }),
      async extractStructured(input) {
        semanticCalls += 1;
        return {
          data: semanticClauseFixture(input, "sidecar"),
          model: "semantic-fixture-model",
          requestId: "semantic-fixture-request",
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        };
      },
    },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());

  const created = await service.create({
    file_name: "curriculum.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
    document_type: "curriculum_standard",
  });
  const result = await service.waitForCompletion(created.id);

  assert.equal(result.status, "succeeded");
  assert.equal(semanticCalls, 1);
  assert.equal(result.result.semantic.review_queue_count, 0);
  assert.equal(result.result.semantic.status, "succeeded");
  assert.equal(result.result.semantic.batch_count, 1);
  assert.equal(result.semantic_artifact.schema_version, "education-semantic-artifact@1.0");
  assert.equal(result.semantic_artifact.status, "succeeded");
  assert.equal(result.semantic_artifact.batch_count, 1);
  assert.equal(result.semantic_artifact.failed_batches.length, 0);
  assert.equal(result.semantic_artifact.model_receipts.length, 1);
  assert.equal(result.semantic_artifact.model_receipt.model, "semantic-fixture-model");
  assert.deepEqual(result.semantic_artifact.extensions.solution_strategies, []);
  assert.equal(result.result.semantic.card_proposal_count, 2);
  assert.equal(result.result.semantic.bounded_card_template_count, 0);
  assert.equal(result.semantic_artifact.extensions.knowledge_card_proposals.length, 2);
  assert.equal(
    result.semantic_artifact.extensions.knowledge_card_proposals.every(
      (item) => item.parameterization.mode === "none" && item.publishable === false,
    ),
    true,
  );
  assert.equal(result.candidate_pack.review_status, "needs_review");
  assert.equal(
    (await stat(join(storageDir, created.id, "semantic-artifact.json"))).mode & 0o777,
    0o600,
  );
  const semanticPath = join(storageDir, created.id, "semantic-artifact.json");
  const corruptSemantic = JSON.parse(await readFile(semanticPath, "utf8"));
  corruptSemantic.document_id = "document-from-another-import";
  await writeFile(semanticPath, `${JSON.stringify(corruptSemantic, null, 2)}\n`, "utf8");
  await assert.rejects(
    service.get(created.id),
    (error) => error.code === "education_import_artifact_invalid",
  );
});

test("compiles long documents in page-scoped semantic batches and reports partial failures honestly", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const semanticInputs = [];
  const service = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({
      pages: 50,
      text: "理解一次函数的概念，并能使用函数表达式解决实际问题。".repeat(4),
    }),
    semanticModelClient: {
      configSummary: () => ({ configured: true }),
      async extractStructured(input) {
        semanticInputs.push(input);
        if (semanticInputs.length === 2) {
          const error = new Error("provider detail must not be persisted");
          error.code = "ark_model_unavailable";
          throw error;
        }
        return {
          data: semanticClauseFixture(input, `batch-${semanticInputs.length}`),
          model: "semantic-batch-model",
          requestId: `semantic-batch-request-${semanticInputs.length}`,
          usage: { total_tokens: 10 },
        };
      },
    },
    limits: {
      maxPages: 60,
      semanticBatchPages: 24,
      maxSemanticBatches: 3,
      jobTimeoutMs: 60_000,
    },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());

  const created = await service.create({
    file_name: "long-curriculum.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nlong-semantic-fixture", "utf8"),
    document_type: "curriculum_standard",
  });
  const result = await service.waitForCompletion(created.id, { timeoutMs: 65_000 });

  assert.equal(result.status, "succeeded", "document import remains usable when one semantic batch fails");
  assert.equal(semanticInputs.length, 3, "a failed middle batch must not suppress the remaining batch");
  assert.match(semanticInputs[0].input, /"id_namespace":"semantic-batch-0001"/u);
  assert.match(semanticInputs[1].input, /"id_namespace":"semantic-batch-0002"/u);
  assert.match(semanticInputs[2].input, /"id_namespace":"semantic-batch-0003"/u);
  assert.match(semanticInputs[0].input, /"page_indexes":\[0,1,2,/u);
  assert.match(semanticInputs[2].input, /"page_indexes":\[48,49\]/u);
  assert.equal(result.semantic_artifact.status, "partial");
  assert.equal(result.semantic_artifact.batch_count, 3);
  assert.equal(result.semantic_artifact.attempted_batch_count, 3);
  assert.equal(result.semantic_artifact.succeeded_batch_count, 2);
  assert.equal(result.semantic_artifact.failed_batches.length, 1);
  assert.equal(result.semantic_artifact.failed_batches[0].batch_index, 2);
  assert.equal(result.semantic_artifact.failed_batches[0].code, "education_semantic_model_failed");
  assert.equal(result.semantic_artifact.model_receipts.length, 2);
  assert.equal(result.semantic_artifact.model_receipt, null, "legacy single receipt is only populated for one batch");
  assert.equal(result.candidate_pack.processing_status, "partial");
  assert.ok(result.candidate_pack.warnings.some((warning) => warning.code === "semantic_compilation_partial"));
  assert.ok(result.candidate_pack.warnings.some((warning) => warning.code === "semantic_cross_batch_relations_need_review"));
  assert.equal(JSON.stringify(result.semantic_artifact).includes("provider detail"), false);
});

test("keeps a truncated single semantic batch and its candidate pack partial", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const sourceText = Array.from(
    { length: 220 },
    (_, index) => `课程内容${index + 1}：理解并应用对应的数学概念解决问题。`,
  ).join("\n\n");
  const service = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({ text: sourceText }),
    semanticModelClient: {
      configSummary: () => ({ configured: true }),
      async extractStructured(input) {
        return {
          data: semanticClauseFixture(input, "truncated"),
          model: "semantic-truncation-model",
          requestId: "semantic-truncation-request",
        };
      },
    },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());

  const created = await service.create({
    file_name: "truncated-curriculum.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\ntruncated-semantic", "utf8"),
    document_type: "curriculum_standard",
  });
  const result = await service.waitForCompletion(created.id);

  assert.equal(result.status, "succeeded");
  assert.equal(result.semantic_artifact.status, "partial");
  assert.equal(result.semantic_artifact.partial_batch_count, 1);
  assert.equal(result.semantic_artifact.batches[0].status, "partial");
  assert.equal(result.semantic_artifact.batches[0].input_receipt.truncated, true);
  assert.ok(result.semantic_artifact.warnings.some((warning) => warning.code === "semantic_input_truncated"));
  assert.equal(result.candidate_pack.processing_status, "partial");
  await assert.rejects(
    service.review(created.id, { target_type: "pack", status: "verified" }),
    (error) => error.code === "education_import_review_gate_failed" && error.status === 409,
  );
});

test("keeps fully called multi-batch semantic imports partial until cross-batch reconciliation", async (t) => {
  const storageDir = await temporaryDirectory(t);
  let semanticCalls = 0;
  const service = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({
      pages: 2,
      text: "理解一次函数的概念，并能使用函数表达式解决实际问题。".repeat(4),
    }),
    semanticModelClient: {
      configSummary: () => ({ configured: true }),
      async extractStructured(input) {
        semanticCalls += 1;
        return {
          data: semanticClauseFixture(input, `cross-${semanticCalls}`),
          model: "semantic-cross-batch-model",
          requestId: `semantic-cross-batch-${semanticCalls}`,
        };
      },
    },
    limits: { semanticBatchPages: 1, maxSemanticBatches: 2 },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());

  const created = await service.create({
    file_name: "cross-batch-curriculum.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\ncross-batch", "utf8"),
    document_type: "curriculum_standard",
  });
  const result = await service.waitForCompletion(created.id);

  assert.equal(semanticCalls, 2);
  assert.equal(result.semantic_artifact.succeeded_batch_count, 2);
  assert.equal(result.semantic_artifact.partial_batch_count, 0);
  assert.deepEqual(result.semantic_artifact.batches.map((batch) => batch.status), ["succeeded", "succeeded"]);
  assert.equal(result.semantic_artifact.status, "partial");
  assert.ok(result.semantic_artifact.review_queue.some(
    (entry) => entry.proposal === "cross_batch_relation_reconciliation",
  ));
  assert.equal(result.candidate_pack.processing_status, "partial");
  await assert.rejects(
    service.review(created.id, { target_type: "pack", status: "verified" }),
    (error) => error.code === "education_import_review_gate_failed" && error.status === 409,
  );

  const reconciled = await service.resolveSemanticReview(created.id, {
    note: "跨批次关系已人工核对；未形成来源充分的关系继续保持不发布。",
    reviewer_id: "teacher-reviewer",
  });
  assert.equal(reconciled.semantic_artifact.status, "succeeded");
  assert.equal(reconciled.semantic_artifact.review_queue.length, 0);
  assert.equal(reconciled.semantic_artifact.review_history.length, 1);
  assert.equal(reconciled.semantic_artifact.review_history[0].resolution, "withheld_confirmed");
  assert.equal(reconciled.candidate_pack.processing_status, "completed");
  assert.equal(reconciled.candidate_pack.warnings.some(
    (warning) => warning.code === "semantic_cross_batch_relations_need_review",
  ), false);

  const verified = await service.review(created.id, {
    target_type: "pack",
    status: "verified",
    reviewer_id: "teacher-reviewer",
    note: "DocumentIR、候选实例与关系均已完成复核。",
  });
  assert.equal(verified.candidate_pack.review_status, "verified");
});

test("pack verification fails closed while the semantic sidecar has unresolved review items", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const service = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner({
      text: "理解一次函数的概念，并能根据图像分析函数变化规律。".repeat(4),
    }),
    semanticModelClient: {
      configSummary: () => ({ configured: true }),
      async extractStructured() {
        return {
          data: {
            entities: [{
              proposal_id: "kp:missing_anchor",
              entity_type: "knowledge_point",
              display_name: "缺少来源锚点的知识点",
              statement: "该候选故意引用不存在的来源块。",
              action_verb: "理解",
              knowledge_form: "concept",
              aliases: [],
              parent_proposal_id: null,
              basis: "explicit",
              confidence: 0.9,
              source_refs: [{ page_index: 0, block_ids: ["missing-block"] }],
            }],
            relations: [], question_links: [], solution_strategies: [], proposition_angles: [], misconceptions: [],
          },
          model: "semantic-review-gate-model",
          requestId: "semantic-review-gate-request",
        };
      },
    },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());

  const created = await service.create({
    file_name: "semantic-review-gate.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nsemantic-review-gate", "utf8"),
    document_type: "curriculum_standard",
  });
  const result = await service.waitForCompletion(created.id);

  assert.equal(result.semantic_artifact.status, "succeeded");
  assert.equal(result.candidate_pack.processing_status, "completed");
  assert.ok(result.semantic_artifact.review_queue.length > 0);
  await assert.rejects(
    service.review(created.id, { target_type: "pack", status: "verified" }),
    (error) => error.code === "education_import_review_gate_failed" && error.status === 409,
  );
});

test("semantic batch limits and total semantic failure are persisted as incomplete artifacts", async (t) => {
  const limitedStorage = await temporaryDirectory(t);
  let limitedCalls = 0;
  const limitedService = createEducationImportService({
    storageDir: limitedStorage,
    commandRunner: createPdfRunner({ pages: 3, text: "掌握有理数运算规则。".repeat(8) }),
    semanticModelClient: {
      configSummary: () => ({ configured: true }),
      async extractStructured(input) {
        limitedCalls += 1;
        return {
          data: semanticClauseFixture(input, `limit-${limitedCalls}`),
          model: "semantic-limit-model",
          requestId: `limit-${limitedCalls}`,
        };
      },
    },
    limits: { semanticBatchPages: 1, maxSemanticBatches: 2 },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => limitedService.close());
  const limitedCreated = await limitedService.create({
    file_name: "limited.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nlimited", "utf8"),
    document_type: "curriculum_standard",
  });
  const limited = await limitedService.waitForCompletion(limitedCreated.id);
  assert.equal(limitedCalls, 2);
  assert.equal(limited.semantic_artifact.status, "partial");
  assert.equal(limited.semantic_artifact.batch_count, 3);
  assert.equal(limited.semantic_artifact.failed_batches[0].status, "skipped");
  assert.equal(limited.semantic_artifact.failed_batches[0].code, "education_semantic_batch_limit_reached");
  assert.equal(limited.candidate_pack.processing_status, "partial");

  const failedStorage = await temporaryDirectory(t);
  const failedService = createEducationImportService({
    storageDir: failedStorage,
    commandRunner: createPdfRunner({ text: "理解整式的概念。".repeat(20) }),
    semanticModelClient: {
      configSummary: () => ({ configured: true }),
      async extractStructured() {
        throw Object.assign(new Error("upstream private text"), { code: "ark_model_unavailable" });
      },
    },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => failedService.close());
  const failedCreated = await failedService.create({
    file_name: "failed-semantic.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfailed-semantic", "utf8"),
    document_type: "curriculum_standard",
  });
  const failed = await failedService.waitForCompletion(failedCreated.id);
  assert.equal(failed.status, "succeeded");
  assert.equal(failed.semantic_artifact.status, "failed");
  assert.equal(failed.semantic_artifact.batch_count, 1);
  assert.equal(failed.semantic_artifact.succeeded_batch_count, 0);
  assert.equal(failed.semantic_artifact.model_receipts.length, 0);
  assert.equal(failed.semantic_artifact.model_receipt, null);
  assert.equal(failed.candidate_pack.processing_status, "partial");
  assert.ok(failed.candidate_pack.warnings.some((warning) => warning.code === "semantic_compilation_failed"));
  assert.equal(JSON.stringify(failed.semantic_artifact).includes("upstream private text"), false);
  await assert.rejects(
    failedService.review(failedCreated.id, { target_type: "pack", status: "verified" }),
    (error) => error.code === "education_import_review_gate_failed" && error.status === 409,
  );
});

test("fails image and low-text imports honestly when visual analysis is unavailable", async (t) => {
  const imageStorage = await temporaryDirectory(t);
  const imageService = createEducationImportService({
    storageDir: imageStorage,
    modelClient: null,
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => imageService.close());
  const imageJob = await imageService.create({
    file_name: "homework.png",
    mime_type: "image/png",
    buffer: makePng(400, 600),
  });
  const imageResult = await imageService.waitForCompletion(imageJob.id);
  assert.equal(imageResult.status, "failed");
  assert.equal(imageResult.error.code, "education_import_vision_unavailable");

  const pdfStorage = await temporaryDirectory(t);
  const pdfService = createEducationImportService({
    storageDir: pdfStorage,
    commandRunner: createPdfRunner({ text: "" }),
    modelClient: null,
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => pdfService.close());
  const pdfJob = await pdfService.create({
    file_name: "scan.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
  });
  const pdfResult = await pdfService.waitForCompletion(pdfJob.id);
  assert.equal(pdfResult.status, "failed");
  assert.equal(pdfResult.error.code, "education_import_vision_unavailable");
});

test("does not persist provider or native-tool secrets in failed job metadata", async (t) => {
  const storageDir = await temporaryDirectory(t);
  const secret = "sk-do-not-persist-this-value";
  const service = createEducationImportService({
    storageDir,
    commandRunner: async () => {
      throw new Error(`provider stderr ${secret}`);
    },
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());
  const created = await service.create({
    file_name: "broken.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
  });
  const failed = await service.waitForCompletion(created.id);
  const persisted = await readFile(join(storageDir, created.id, "job.json"), "utf8");

  assert.equal(failed.status, "failed");
  assert.equal(failed.error.message, "Native PDF processing failed.");
  assert.equal(JSON.stringify(failed).includes(secret), false);
  assert.equal(persisted.includes(secret), false);
});

function createPdfRunner({ calls = [], pages = 1, text = "", delayMs = 0 } = {}) {
  return async (command, args) => {
    calls.push({ command: basename(command), args: [...args] });
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (basename(command) === "pdfinfo") {
      return {
        stdout: `Pages:           ${pages}\nPage size:       612 x 792 pts\n`,
        stderr: "",
      };
    }
    if (basename(command) === "pdftotext") {
      return { stdout: Array.from({ length: pages }, () => text).join("\f"), stderr: "" };
    }
    if (basename(command) === "pdftoppm") {
      const prefix = args.at(-1);
      await writeFile(`${prefix}.png`, makePng(612, 792));
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command ${command}`);
  };
}

async function markJobInterrupted(storageDir, jobId) {
  const jobPath = join(storageDir, jobId, "job.json");
  const job = JSON.parse(await readFile(jobPath, "utf8"));
  job.status = "processing";
  job.phase = "native_text";
  job.completed_at = null;
  job.result = null;
  job.error = null;
  await writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

function makeStudentVisualPayload() {
  const block = (type, text, layer, questionNumber, bbox) => ({
    type,
    text,
    normalized_text: text,
    layer,
    bbox,
    confidence: 0.9,
    question_number: questionNumber,
    option_label: null,
    score_value: null,
    max_score: null,
  });
  const question = (number, stem, response) => ({
    local_id: `q${number}`,
    question_number: String(number),
    question_type: "calculation",
    response_type: "workings",
    stem,
    options: [],
    student_response: response,
    selected_option_labels: [],
    teacher_feedback: null,
    score: null,
    max_score: null,
    confidence: 0.9,
  });
  return {
    document: {
      document_type: "student_homework",
      title: "\u5b66\u751f\u4f5c\u4e1a",
      language: "zh-CN",
      subject: "\u6570\u5b66",
      grade_band: "\u516b\u5e74\u7ea7",
    },
    blocks: [
      block("question_stem", "1. \u8ba1\u7b97 x + 2 = 5", "printed", "1", [0.1, 0.1, 0.8, 0.12]),
      block("student_response", "x = 3", "student", "1", [0.15, 0.24, 0.4, 0.1]),
      block("question_stem", "2. \u8ba1\u7b97 2x = 8", "printed", "2", [0.1, 0.5, 0.8, 0.12]),
      block("student_response", "x = 4", "student", "2", [0.15, 0.65, 0.4, 0.1]),
    ],
    questions: [
      question(1, "\u8ba1\u7b97 x + 2 = 5", "x = 3"),
      question(2, "\u8ba1\u7b97 2x = 8", "x = 4"),
    ],
    warnings: [],
  };
}

function makePng(width, height) {
  const bytes = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  Buffer.from("IHDR", "ascii").copy(bytes, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "education-import-service-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
