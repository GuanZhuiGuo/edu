import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { createEducationImportService } from "../education-import-service.js";
import {
  EducationKnowledgeProjectionError,
  compileEducationKnowledgePublicationPlan,
} from "../education-knowledge-projection.js";

const FIXED_NOW = "2026-08-19T08:00:00.000Z";
const FIXED_JOB_UUID = "22222222-2222-4222-8222-222222222222";

test("projects a verified curriculum import into public vector and graph records", async (t) => {
  const result = await verifiedCurriculumImport(t);
  const plan = compileEducationKnowledgePublicationPlan({
    documentIR: result.document_ir,
    candidatePack: result.candidate_pack,
    tenantId: "tenant-demo",
    namespace: "shared_curriculum",
    embeddingModel: "doubao-embedding-vision-250615",
    publishedAt: FIXED_NOW,
  });

  assert.equal(plan.schema_version, "education-knowledge-publication-plan@1.0");
  assert.equal(plan.tenant_id, "tenant-demo");
  assert.equal(plan.namespace, "shared_curriculum");
  assert.equal(plan.visibility, "shared");
  assert.ok(plan.vector_records.length >= 2);
  assert.ok(plan.graph.chunks.length >= 1);
  assert.ok(plan.graph.knowledge_units.length >= 1);
  assert.equal(plan.graph.questions.length, 0);
  assert.equal(plan.statistics.vector_record_count, plan.vector_records.length);
  assert.ok(plan.vector_records.every((record) => record.payload.publish_state === "staging"));
  assert.ok(plan.vector_records.every((record) => record.payload.tenant_id === "tenant-demo"));
  assert.equal(JSON.stringify(plan).includes("student_response"), false);
});

test("publication fails closed for incomplete, semantically unresolved or private imports", async (t) => {
  const result = await verifiedCurriculumImport(t);
  const common = {
    documentIR: result.document_ir,
    candidatePack: result.candidate_pack,
    tenantId: "tenant-demo",
    namespace: "shared_curriculum",
    embeddingModel: "doubao-embedding-vision-250615",
    publishedAt: FIXED_NOW,
  };

  assert.throws(
    () => compileEducationKnowledgePublicationPlan({
      ...common,
      candidatePack: { ...result.candidate_pack, processing_status: "partial" },
    }),
    (error) => error instanceof EducationKnowledgeProjectionError
      && error.code === "education_knowledge_review_required",
  );
  assert.throws(
    () => compileEducationKnowledgePublicationPlan({
      ...common,
      semanticArtifact: { status: "partial", review_queue: [] },
    }),
    (error) => error.code === "education_knowledge_semantic_review_required",
  );
  assert.throws(
    () => compileEducationKnowledgePublicationPlan({
      ...common,
      documentIR: { ...result.document_ir, document_type: "student_homework" },
    }),
    (error) => error.code === "education_knowledge_private_document_forbidden",
  );
});

async function verifiedCurriculumImport(t) {
  const storageDir = await mkdtemp(join(tmpdir(), "education-projection-"));
  t.after(() => rm(storageDir, { recursive: true, force: true }));
  const service = createEducationImportService({
    storageDir,
    commandRunner: createPdfRunner([
      "数与式",
      "理解有理数的意义，能比较有理数的大小，并能运用有理数解决简单的实际问题。",
      "掌握数轴表示有理数的方法。",
    ].join("\n\n").repeat(24)),
    now: () => new Date(FIXED_NOW),
    idFactory: () => FIXED_JOB_UUID,
  });
  t.after(() => service.close());
  const created = await service.create({
    file_name: "课程标准.pdf",
    mime_type: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nfixture", "utf8"),
    document_type: "curriculum_standard",
    title: "义务教育数学课程标准",
    language: "zh-CN",
    subject: "数学",
    grade_band: "初中",
  });
  const completed = await service.waitForCompletion(created.id);
  assert.equal(completed.status, "succeeded", JSON.stringify(completed.error));
  return service.review(created.id, {
    target_type: "pack",
    status: "verified",
    reviewer_id: "reviewer-demo",
  });
}

function createPdfRunner(text) {
  return async (command, args) => {
    if (basename(command) === "pdfinfo") {
      return { stdout: "Pages: 1\nPage size: 612 x 792 pts\n", stderr: "" };
    }
    if (basename(command) === "pdftotext") {
      return { stdout: text, stderr: "" };
    }
    if (basename(command) === "pdftoppm") {
      await writeFile(`${args.at(-1)}.png`, makePng(612, 792));
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command ${command}`);
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
