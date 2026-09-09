import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const baseUrl = String(process.env.EDUCATION_IMPORT_BASE_URL || "http://localhost:3042").replace(/\/$/u, "");
const outputDir = join(repoRoot, "data", "import-results", "huel-cross-discipline-2026-08-20");
const only = new Set(process.argv.slice(2).filter((value) => value.startsWith("--only=")).flatMap((value) => value.slice(7).split(",")));
const retrySemantic = process.argv.includes("--retry-semantic");

const definitions = [
  {
    key: "huel-law-jm-035102",
    path: "data/import-sources/henan-university/法律硕士培养方案-法学背景-2022修订.pdf",
    documentType: "curriculum_standard",
    title: "河南财经政法大学法律硕士（法学）2022培养方案",
    subject: "法学与法律实务",
    gradeBand: "研究生·035102",
    sourceClass: "official_program_plan",
  },
  {
    key: "huel-law-jm-035101",
    path: "data/import-sources/henan-university/法律硕士培养方案-非法学背景-2022修订.pdf",
    documentType: "curriculum_standard",
    title: "河南财经政法大学法律硕士（非法学）2022培养方案",
    subject: "法学与法律实务",
    gradeBand: "研究生·035101",
    sourceClass: "official_program_plan",
  },
  {
    key: "huel-higher-math-program-excerpt",
    path: "data/import-sources/henan-university/管理科学培养方案-高等数学课程设置-导入摘录.pdf",
    documentType: "curriculum_standard",
    title: "河南财经政法大学管理科学培养方案·高等数学课程设置摘录",
    subject: "高等数学与管理科学",
    gradeBand: "本科·2023版摘录",
    sourceClass: "official_program_plan_excerpt",
  },
  {
    key: "huel-math-competition-paper",
    path: "data/import-sources/henan-university/第十一届全国大学生数学竞赛非数学类试题及参考解答.pdf",
    documentType: "exam_paper",
    title: "河南财大官网数学竞赛试题与参考解答导入样本",
    subject: "高等数学",
    gradeBand: "大学非数学类竞赛",
    sourceClass: "official_exam_sample",
  },
  {
    key: "synthetic-law-case",
    path: "data/import-sources/synthetic/A_政法类案例题_合同与证据推理.pdf",
    documentType: "question_collection",
    title: "合成样本·合同与证据推理案例题",
    subject: "民法·证据法·信息系统",
    gradeBand: "跨学科验证样本",
    sourceClass: "synthetic_validation",
  },
  {
    key: "synthetic-math-homework",
    path: "data/import-sources/synthetic/B_高等数学作业_导数与边际成本.pdf",
    documentType: "homework_template",
    title: "合成样本·导数与边际成本作业",
    subject: "高等数学·微观经济学",
    gradeBand: "跨学科验证样本",
    sourceClass: "synthetic_validation",
  },
  {
    key: "synthetic-law-statistics-exam",
    path: "data/import-sources/synthetic/C_综合试卷_统计概率与法律实证.pdf",
    documentType: "exam_paper",
    title: "合成样本·统计概率与法律实证综合试卷",
    subject: "统计概率·法律实证·经济解释",
    gradeBand: "跨学科验证样本",
    sourceClass: "synthetic_validation",
  },
];

await mkdir(outputDir, { recursive: true });
const selected = only.size ? definitions.filter((item) => only.has(item.key)) : definitions;
if (!selected.length) throw new Error("No matching import definitions.");

const list = await fetchJson(`${baseUrl}/api/education/imports?limit=200`);
const existingJobs = Array.isArray(list.jobs) ? list.jobs : [];
const receipts = [];

for (const definition of selected) {
  const absolutePath = join(repoRoot, definition.path);
  const bytes = await readFile(absolutePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let summary = existingJobs.find((job) => (
    job.source?.sha256 === sha256
    && job.request?.title === definition.title
    && (
      !retrySemantic
      || !["succeeded", "failed"].includes(job.status)
      || job.result?.semantic?.status === "succeeded"
    )
  ));

  if (!summary) {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "application/pdf" }), basename(absolutePath));
    form.set("document_type", definition.documentType);
    form.set("title", definition.title);
    form.set("language", "zh-CN");
    form.set("subject", definition.subject);
    form.set("grade_band", definition.gradeBand);
    summary = await fetchJson(`${baseUrl}/api/education/imports`, { method: "POST", body: form }, [202]);
    process.stdout.write(`[created] ${definition.key} ${summary.id}\n`);
  } else {
    process.stdout.write(`[resume] ${definition.key} ${summary.id} ${summary.status}\n`);
  }

  const job = await waitForTerminal(summary.id, definition.key);
  const fileName = `${definition.key}-${job.id}.json`;
  await writeFile(join(outputDir, fileName), `${JSON.stringify(job, null, 2)}\n`, "utf8");
  receipts.push({
    key: definition.key,
    source_class: definition.sourceClass,
    source_file: definition.path,
    source_sha256: sha256,
    job_id: job.id,
    status: job.status,
    phase: job.phase,
    created_at: job.created_at,
    completed_at: job.completed_at,
    review_status: job.review?.status || null,
    document_type: job.result?.document_type || job.request?.document_type || null,
    page_count: job.result?.page_count || job.progress?.total_pages || null,
    candidate_counts: job.result?.candidate_counts || null,
    semantic: job.result?.semantic || null,
    error: job.error || null,
    full_receipt_file: fileName,
  });
  await persistSummary();
}

process.stdout.write(`${JSON.stringify({ outputDir, receipts }, null, 2)}\n`);

async function waitForTerminal(jobId, key) {
  const startedAt = Date.now();
  let previous = "";
  let connectionInterrupted = false;
  while (Date.now() - startedAt < 45 * 60_000) {
    let job;
    try {
      job = await fetchJson(`${baseUrl}/api/education/imports/${encodeURIComponent(jobId)}`);
      if (connectionInterrupted) {
        process.stdout.write(`[resumed] ${key} import service is reachable again\n`);
        connectionInterrupted = false;
      }
    } catch (error) {
      if (!connectionInterrupted) {
        process.stdout.write(`[waiting] ${key} import service temporarily unavailable\n`);
        connectionInterrupted = true;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 4_000));
      continue;
    }
    const signature = [job.status, job.phase, job.progress?.current_page, job.progress?.total_pages].join(":");
    if (signature !== previous) {
      process.stdout.write(`[progress] ${key} ${signature}\n`);
      previous = signature;
    }
    if (["succeeded", "failed"].includes(job.status)) return job;
    await new Promise((resolveWait) => setTimeout(resolveWait, 4_000));
  }
  throw new Error(`Timed out waiting for ${key} (${jobId}).`);
}

async function persistSummary() {
  // Full job receipts are immutable, unique files. Rebuild the summary from
  // those files so parallel import runners cannot clobber one another's ledger.
  const receiptFiles = (await readdir(outputDir))
    .filter((fileName) => /-import-[a-f0-9-]+\.json$/u.test(fileName));
  const allReceipts = [];
  for (const fileName of receiptFiles) {
    const definition = definitions.find((item) => fileName.startsWith(`${item.key}-import-`));
    if (!definition) continue;
    let job;
    try {
      job = JSON.parse(await readFile(join(outputDir, fileName), "utf8"));
    } catch {
      continue;
    }
    allReceipts.push({
      key: definition.key,
      source_class: definition.sourceClass,
      source_file: definition.path,
      source_sha256: job.source?.sha256 || null,
      job_id: job.id,
      status: job.status,
      phase: job.phase,
      created_at: job.created_at,
      completed_at: job.completed_at,
      review_status: job.review?.status || null,
      document_type: job.result?.document_type || job.request?.document_type || null,
      page_count: job.result?.page_count || job.progress?.total_pages || null,
      candidate_counts: job.result?.candidate_counts || null,
      semantic: job.result?.semantic || null,
      error: job.error || null,
      full_receipt_file: fileName,
    });
  }
  allReceipts.sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || "")));
  const payload = {
    schema_version: "education-import-validation-ledger@1.0",
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    policy: {
      model_output_authority: "candidate_only",
      auto_review: false,
      auto_publish: false,
      official_source_boundary: "program plans and exam samples are not relabeled as chapter-level syllabi",
    },
    receipts: allReceipts,
  };
  await writeFile(join(outputDir, "summary.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function fetchJson(url, init = {}, allowedStatuses = [200]) {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(190_000),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(payload?.message || `${response.status} ${url}`);
  }
  return payload;
}
