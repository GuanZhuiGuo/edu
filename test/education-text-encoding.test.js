import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEducationImportService } from "../education-import-service.js";
import { repairUtf8Mojibake } from "../education-text-encoding.js";

test("repairs reversible UTF-8-as-latin1 metadata without touching healthy text", () => {
  assert.equal(
    repairUtf8Mojibake("æ³å¾ç¡å£«å¹å»æ¹æ¡.pdf"),
    "法律硕士培养方案.pdf",
  );
  assert.equal(repairUtf8Mojibake("课程：ä¸­æ.pdf"), "课程：中文.pdf");
  assert.equal(repairUtf8Mojibake("河南财经政法大学.pdf"), "河南财经政法大学.pdf");
  assert.equal(repairUtf8Mojibake("Café-conversation.pdf"), "Café-conversation.pdf");
  assert.equal(repairUtf8Mojibake("Märchen.pdf"), "Märchen.pdf");
});

test("service repairs narrowly scoped persisted import metadata and DocumentIR", async () => {
  const storageDir = await mkdtemp(join(tmpdir(), "education-import-encoding-"));
  const jobId = "import-12345678";
  const jobDir = join(storageDir, jobId);
  await mkdir(jobDir);
  const job = {
    schema_version: "education-import-job@1.0",
    id: jobId,
    status: "succeeded",
    phase: "completed",
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
    started_at: "2026-08-21T00:00:00.000Z",
    completed_at: "2026-08-21T00:00:01.000Z",
    source: {
      file_name: "A_æ¿æ³ç±»æ¡ä¾é¢.pdf",
      mime_type: "application/pdf",
      kind: "pdf",
      sha256: "a".repeat(64),
      size_bytes: 12,
      stored_file_name: "source.pdf",
    },
    request: {
      document_type: "question_collection",
      title: "æ¿æ³ç±»é¢åº",
      language: "zh-CN",
      subject: "民法·证据法",
      grade_band: null,
      identity: { tenant_id: null, learner_id: null, status: "unresolved" },
    },
    progress: {},
    result: null,
    review: { status: "candidate", updated_at: null },
    error: null,
  };
  const document = {
    schema_version: "education-document-ir@1.0",
    title: "æ¿æ³ç±»é¢åº",
    subject: "民法·证据法",
    source_file: { file_name: job.source.file_name },
  };
  await writeFile(join(jobDir, "job.json"), `${JSON.stringify(job, null, 2)}\n`, "utf8");
  await writeFile(join(jobDir, "document-ir.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const service = createEducationImportService({ storageDir, autoResume: false });
  try {
    const listed = await service.list();
    assert.equal(listed.jobs[0].source.file_name, "A_政法类案例题.pdf");
    assert.equal(listed.jobs[0].request.title, "政法类题库");
    assert.equal(listed.jobs[0].request.subject, "民法·证据法");

    const persistedJob = JSON.parse(await readFile(join(jobDir, "job.json"), "utf8"));
    const persistedDocument = JSON.parse(await readFile(join(jobDir, "document-ir.json"), "utf8"));
    assert.equal(persistedJob.source.file_name, "A_政法类案例题.pdf");
    assert.equal(persistedDocument.source_file.file_name, "A_政法类案例题.pdf");
    assert.equal(persistedDocument.title, "政法类题库");
    assert.equal(persistedDocument.subject, "民法·证据法");
  } finally {
    await service.close();
    await rm(storageDir, { recursive: true, force: true });
  }
});
