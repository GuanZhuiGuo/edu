import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLOCK_TYPES,
  DOCUMENT_TYPES,
  EDUCATION_IMPORT_SCHEMA_VERSION,
  REVIEW_STATUSES,
  assertCurriculumStandardCandidate,
  assertDocumentIR,
  assertQuestionIR,
  assertSubmissionIR,
  validateEducationImportContract,
} from "./education-import-contracts.js";
import {
  compileEducationSemanticProposals,
  mergeSemanticProposalsIntoCandidatePack,
} from "./education-semantic-compiler.js";
import { repairUtf8Mojibake } from "./education-text-encoding.js";
import {
  compileEducationCardTemplateProposals,
  validateEducationCardTemplateProposal,
} from "./education-card-proposal-compiler.js";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));

export const EDUCATION_IMPORT_JOB_SCHEMA_VERSION = "education-import-job@1.0";
export const EDUCATION_IMPORT_CANDIDATE_PACK_SCHEMA_VERSION =
  "education-import-candidate-pack@1.0";

export const EDUCATION_IMPORT_JOB_STATUSES = Object.freeze([
  "queued",
  "processing",
  "succeeded",
  "failed",
]);

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed"]);
const DOCUMENT_TYPE_SET = new Set(DOCUMENT_TYPES);
const BLOCK_TYPE_SET = new Set(BLOCK_TYPES);
const REVIEW_STATUS_SET = new Set(REVIEW_STATUSES);
const CONTRACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const JOB_ID_PATTERN = /^import-[a-f0-9-]{8,80}$/u;

export const DEFAULT_EDUCATION_IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 50 * 1024 * 1024,
  maxImageFileBytes: 20 * 1024 * 1024,
  maxPages: 80,
  maxVisionPages: 24,
  maxPageImageBytes: 12 * 1024 * 1024,
  maxRenderedBytes: 240 * 1024 * 1024,
  maxExtractedTextBytes: 12 * 1024 * 1024,
  maxBlocksPerPage: 1_500,
  maxCandidates: 1_000,
  maxConcurrentJobs: 2,
  maxPendingJobs: 100,
  lowTextCharacters: 80,
  pageImageMaxDimension: 1_800,
  nativeToolTimeoutMs: 45_000,
  modelRequestTimeoutMs: 90_000,
  semanticBatchPages: 24,
  maxSemanticBatches: 50,
  jobTimeoutMs: 8 * 60_000,
  jobLeaseStaleMs: 10 * 60_000,
});

const MIME_DESCRIPTORS = Object.freeze({
  pdf: Object.freeze({ mimeType: "application/pdf", extension: ".pdf" }),
  png: Object.freeze({ mimeType: "image/png", extension: ".png" }),
  jpeg: Object.freeze({ mimeType: "image/jpeg", extension: ".jpg" }),
  webp: Object.freeze({ mimeType: "image/webp", extension: ".webp" }),
  gif: Object.freeze({ mimeType: "image/gif", extension: ".gif" }),
});

const DECLARED_MIME_TO_KIND = new Map([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpeg"],
  ["image/jpg", "jpeg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

const VISUAL_DOCUMENT_TYPES = new Set([
  // Video-explanation uploads are normalized as courseware. Slides often
  // contain diagrams, formulas and layout meaning even when native text is
  // plentiful, so every page must reach the multimodal understanding pass.
  "courseware",
  "student_homework",
  "student_exam",
  "grading_sheet",
]);

const PRIVATE_CONTENT_DOCUMENT_TYPES = new Set([
  "answer_key",
  "grading_sheet",
]);

const QUESTION_BEARING_DOCUMENT_TYPES = new Set([
  "textbook",
  "courseware",
  "question_collection",
  "homework_template",
  "student_homework",
  "exam_paper",
  "student_exam",
]);

const CANDIDATE_COLLECTIONS = Object.freeze({
  curriculum_standard: ["curriculum_standards", "CurriculumStandardCandidate"],
  question: ["questions", "QuestionIR"],
  submission: ["submissions", "SubmissionIR"],
  typed_relation: ["typed_relations", "TypedRelation"],
  question_knowledge_link: ["question_knowledge_links", "QuestionKnowledgeLink"],
  evidence: ["evidence", "EvidenceCandidate"],
});

const MODEL_PAGE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    document: {
      type: "object",
      additionalProperties: false,
      properties: {
        document_type: { type: ["string", "null"] },
        title: { type: ["string", "null"] },
        language: { type: ["string", "null"] },
        subject: { type: ["string", "null"] },
        grade_band: { type: ["string", "null"] },
      },
      required: ["document_type", "title", "language", "subject", "grade_band"],
    },
    blocks: {
      type: "array",
      maxItems: 400,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: [...BLOCK_TYPES] },
          text: { type: ["string", "null"] },
          normalized_text: { type: ["string", "null"] },
          layer: { type: "string", enum: ["printed", "student", "teacher", "unknown"] },
          bbox: {
            anyOf: [
              {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: { type: "number", minimum: 0, maximum: 1 },
              },
              { type: "null" },
            ],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          question_number: { type: ["string", "null"] },
          option_label: { type: ["string", "null"] },
          score_value: { type: ["number", "null"] },
          max_score: { type: ["number", "null"] },
        },
        required: [
          "type",
          "text",
          "normalized_text",
          "layer",
          "bbox",
          "confidence",
          "question_number",
          "option_label",
          "score_value",
          "max_score",
        ],
      },
    },
    questions: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          local_id: { type: ["string", "null"] },
          question_number: { type: ["string", "null"] },
          question_type: { type: "string" },
          response_type: { type: "string" },
          stem: { type: "string" },
          options: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                text: { type: "string" },
              },
              required: ["label", "text"],
            },
          },
          student_response: { type: ["string", "null"] },
          selected_option_labels: {
            type: "array",
            maxItems: 20,
            items: { type: "string" },
          },
          teacher_feedback: { type: ["string", "null"] },
          score: { type: ["number", "null"] },
          max_score: { type: ["number", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: [
          "local_id",
          "question_number",
          "question_type",
          "response_type",
          "stem",
          "options",
          "student_response",
          "selected_option_labels",
          "teacher_feedback",
          "score",
          "max_score",
          "confidence",
        ],
      },
    },
    warnings: {
      type: "array",
      maxItems: 30,
      items: { type: "string" },
    },
  },
  required: ["document", "blocks", "questions", "warnings"],
});

export class EducationImportServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "EducationImportServiceError";
    this.code = code;
    this.status = Number.isInteger(options.status) ? options.status : 500;
    this.retryable = options.retryable === true;
  }
}

/**
 * Persistent, route-agnostic education document importer.
 *
 * The factory has no environment or credential reads. Inject an already
 * configured Ark education model client when image/low-text analysis is
 * required. Runtime data is stored below storageDir with private permissions.
 */
export function createEducationImportService({
  storageDir = join(moduleDir, "data", "education-imports"),
  modelClient = null,
  semanticModelClient = null,
  cardTemplateCatalogPath = join(moduleDir, "public", "data", "junior-math-visual-artifacts.json"),
  commandRunner = runNativeCommand,
  tools = {},
  limits = {},
  allowedSourceRoots = [],
  now = () => new Date(),
  idFactory = randomUUID,
  autoResume = true,
} = {}) {
  const rootDir = resolve(storageDir);
  const safeLimits = normalizeLimits(limits);
  const toolCommands = Object.freeze({
    pdfinfo: normalizeToolCommand(tools.pdfinfo, "pdfinfo"),
    pdftotext: normalizeToolCommand(tools.pdftotext, "pdftotext"),
    pdftoppm: normalizeToolCommand(tools.pdftoppm, "pdftoppm"),
  });
  const sourceRoots = allowedSourceRoots.map((entry) => resolve(String(entry)));
  const jobs = new Map();
  const pendingQueue = [];
  const pendingIds = new Set();
  const runningControllers = new Map();
  const runningTasks = new Map();
  const jobLocks = new Map();
  const serviceInstanceId = randomUUID();
  let initializePromise = null;
  let trustedCardCatalogPromise = null;
  let closed = false;
  let creatingCount = 0;

  async function initialize() {
    if (!initializePromise) {
      initializePromise = loadPersistedJobs().catch((error) => {
        initializePromise = null;
        throw error;
      });
    }
    return initializePromise;
  }

  async function loadPersistedJobs() {
    let entries = [];
    try {
      await mkdir(rootDir, { recursive: true, mode: 0o700 });
      await chmod(rootDir, 0o700);
      entries = await readdir(rootDir, { withFileTypes: true });
    } catch (cause) {
      throw new EducationImportServiceError(
        "education_import_storage_unavailable",
        "Education import storage is unavailable.",
        { status: 503, retryable: true, cause },
      );
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name)) continue;
      try {
        const job = JSON.parse(await readFile(jobFilePath(entry.name), "utf8"));
        if (!isPersistedJob(job, entry.name)) continue;
        const jobMetadataChanged = repairPersistedJobMetadata(job);
        if (jobMetadataChanged) {
          // A metadata migration must never make an otherwise healthy task
          // disappear merely because its storage is temporarily read-only.
          await atomicWriteJson(jobFilePath(entry.name), job).catch(() => {});
        }
        await repairPersistedDocumentMetadata(documentFilePath(entry.name)).catch(() => {});
        jobs.set(job.id, job);
        if (autoResume && !TERMINAL_JOB_STATUSES.has(job.status)) {
          enqueue(job.id);
        }
      } catch {
        // A corrupt or incomplete directory is isolated from healthy jobs.
      }
    }
    schedulePump();
  }

  async function create(input = {}) {
    ensureOpen();
    await initialize();
    const admittedCount = [...jobs.values()].filter((job) =>
      !TERMINAL_JOB_STATUSES.has(job.status)
    ).length + creatingCount;
    if (admittedCount >= safeLimits.maxPendingJobs) {
      throw new EducationImportServiceError(
        "education_import_queue_full",
        "The education import queue is full.",
        { status: 429, retryable: true },
      );
    }
    creatingCount += 1;
    try {
      const normalized = await normalizeCreateInput(input, {
        limits: safeLimits,
        allowedSourceRoots: sourceRoots,
      });
      return await withPromiseLock(jobLocks, "create", async () => {
        const activeCount = [...jobs.values()].filter((job) =>
          !TERMINAL_JOB_STATUSES.has(job.status)
        ).length;
        if (activeCount >= safeLimits.maxPendingJobs) {
          throw new EducationImportServiceError(
            "education_import_queue_full",
            "The education import queue is full.",
            { status: 429, retryable: true },
          );
        }

        const jobId = allocateJobId(jobs, idFactory);
        const jobDir = jobDirectory(jobId);
        const storedFileName = `source${MIME_DESCRIPTORS[normalized.kind].extension}`;
        const sourcePath = join(jobDir, storedFileName);
        const timestamp = isoNow(now);
        const job = {
          schema_version: EDUCATION_IMPORT_JOB_SCHEMA_VERSION,
          id: jobId,
          status: "queued",
          phase: "queued",
          created_at: timestamp,
          updated_at: timestamp,
          started_at: null,
          completed_at: null,
          source: {
            file_name: normalized.fileName,
            mime_type: normalized.mimeType,
            kind: normalized.kind,
            sha256: normalized.sha256,
            size_bytes: normalized.bytes.length,
            stored_file_name: storedFileName,
          },
          request: normalized.request,
          progress: {
            current_page: 0,
            total_pages: null,
            rendered_pages: 0,
            vision_pages: 0,
            native_text_characters: 0,
            semantic_batches_completed: 0,
            semantic_batches_total: 0,
          },
          result: null,
          review: {
            status: "candidate",
            updated_at: null,
          },
          error: null,
        };

        try {
          await mkdir(jobDir, { recursive: false, mode: 0o700 });
          await writeFile(sourcePath, normalized.bytes, { mode: 0o600, flag: "wx" });
          await persistJob(job);
        } catch (cause) {
          throw new EducationImportServiceError(
            "education_import_storage_write_failed",
            "The education import could not be persisted.",
            { status: 503, retryable: true, cause },
          );
        }

        jobs.set(job.id, job);
        enqueue(job.id);
        schedulePump();
        return publicJob(job);
      });
    } finally {
      creatingCount -= 1;
    }
  }

  async function list({ status, limit = 50, offset = 0 } = {}) {
    await initialize();
    const safeStatus = status === undefined || status === null || status === ""
      ? ""
      : normalizeJobStatus(status);
    const safeLimit = boundedInteger(limit, 1, 200, 50);
    const safeOffset = boundedInteger(offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const matches = [...jobs.values()]
      .filter((job) => !safeStatus || job.status === safeStatus)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
    return {
      schema_version: "education-import-job-list@1.0",
      total: matches.length,
      offset: safeOffset,
      limit: safeLimit,
      jobs: matches.slice(safeOffset, safeOffset + safeLimit).map(publicJob),
    };
  }

  async function get(jobId, { includeArtifacts = true } = {}) {
    await initialize();
    const safeJobId = normalizeJobId(jobId);
    const job = jobs.get(safeJobId);
    if (!job) return null;
    const result = publicJob(job);
    if (includeArtifacts && job.status === "succeeded") {
      await withPromiseLock(jobLocks, job.id, async () => {
        Object.assign(result, publicJob(jobs.get(job.id) || job));
        const [document, candidatePack] = await Promise.all([
          readJsonArtifact(documentFilePath(job.id), "DocumentIR"),
          readJsonArtifact(candidatePackFilePath(job.id), "candidate pack"),
        ]);
        const documentValidation = validateEducationImportContract("DocumentIR", document);
        const validation = validateEducationImportCandidatePack(
          candidatePack,
          document,
          { jobId: job.id },
        );
        if (!documentValidation.valid || !validation.valid) {
          throw new EducationImportServiceError(
            "education_import_artifact_invalid",
            "The persisted education import artifact is invalid.",
            { status: 500 },
          );
        }
        result.document_ir = document;
        result.candidate_pack = candidatePack;
        if (jobs.get(job.id)?.result?.semantic) {
          const semanticArtifact = await readJsonArtifact(
            semanticArtifactFilePath(job.id),
            "semantic artifact",
          );
          if (!validateSemanticArtifact(semanticArtifact, document)) {
            throw new EducationImportServiceError(
              "education_import_artifact_invalid",
              "The persisted education semantic artifact is invalid.",
              { status: 500 },
            );
          }
          result.semantic_artifact = semanticArtifact;
        }
      });
    }
    return result;
  }

  /**
   * Server-internal page asset reader for downstream education compilers.
   * It never returns a filesystem path and re-validates the persisted size and
   * sha256 before exposing bytes to another server module.
   */
  async function getPageAsset(jobId, assetId) {
    await initialize();
    const safeJobId = normalizeJobId(jobId);
    const safeAssetId = optionalIdentifier(assetId, "asset_id");
    if (!safeAssetId) throw invalidInput("asset_id is required.");
    const job = jobs.get(safeJobId);
    if (!job || job.status !== "succeeded") {
      throw new EducationImportServiceError(
        "education_import_asset_unavailable",
        "The education import page asset is unavailable.",
        { status: 404 },
      );
    }
    return withPromiseLock(jobLocks, safeJobId, async () => {
      const pack = await readJsonArtifact(candidatePackFilePath(safeJobId), "candidate pack");
      const asset = (Array.isArray(pack?.assets) ? pack.assets : []).find((item) => item?.id === safeAssetId);
      if (!asset || typeof asset.storage_ref !== "string") {
        throw new EducationImportServiceError(
          "education_import_asset_not_found",
          "The education import page asset was not found.",
          { status: 404 },
        );
      }
      const root = jobDirectory(safeJobId);
      const assetPath = resolve(root, asset.storage_ref);
      if (!isWithinRoot(assetPath, root)) {
        throw new EducationImportServiceError(
          "education_import_asset_invalid",
          "The education import page asset path is invalid.",
          { status: 500 },
        );
      }
      const info = await stat(assetPath);
      if (!info.isFile() || info.size !== Number(asset.size_bytes) || info.size > safeLimits.maxPageImageBytes) {
        throw new EducationImportServiceError(
          "education_import_asset_integrity_failed",
          "The education import page asset failed its size check.",
          { status: 500 },
        );
      }
      const bytes = await readFile(assetPath);
      if (sha256(bytes) !== asset.sha256) {
        throw new EducationImportServiceError(
          "education_import_asset_integrity_failed",
          "The education import page asset failed its digest check.",
          { status: 500 },
        );
      }
      return {
        asset: {
          id: asset.id,
          page_index: asset.page_index,
          mime_type: asset.mime_type,
          sha256: asset.sha256,
          size_bytes: asset.size_bytes,
          width: asset.width,
          height: asset.height,
        },
        bytes,
      };
    });
  }

  async function review(jobId, input = {}) {
    ensureOpen();
    await initialize();
    const safeJobId = normalizeJobId(jobId);
    const status = normalizeReviewStatus(input.status ?? input.review_status);
    const targetType = normalizeReviewTarget(input.target_type ?? input.targetType ?? "pack");
    const targetId = optionalIdentifier(input.target_id ?? input.targetId, "target_id");
    const reviewerId = optionalIdentifier(
      input.reviewer_id ?? input.reviewerId,
      "reviewer_id",
    );
    const note = optionalText(input.note, "note", 2_000);

    await withPromiseLock(jobLocks, safeJobId, async () => {
      const job = jobs.get(safeJobId);
      if (!job) {
        throw new EducationImportServiceError(
          "education_import_not_found",
          "The education import job was not found.",
          { status: 404 },
        );
      }
      if (job.status !== "succeeded") {
        throw new EducationImportServiceError(
          "education_import_not_reviewable",
          "Only succeeded education imports can be reviewed.",
          { status: 409 },
        );
      }
      const [document, pack] = await Promise.all([
        readJsonArtifact(documentFilePath(job.id), "DocumentIR"),
        readJsonArtifact(candidatePackFilePath(job.id), "candidate pack"),
      ]);
      let semanticArtifact = null;
      if (job.result?.semantic) {
        semanticArtifact = await readJsonArtifact(
          semanticArtifactFilePath(job.id),
          "semantic artifact",
        );
        if (!validateSemanticArtifact(semanticArtifact, document)) {
          throw new EducationImportServiceError(
            "education_import_artifact_invalid",
            "The persisted education semantic artifact is invalid.",
            { status: 500 },
          );
        }
      }
      applyReview({ document, pack, semanticArtifact, status, targetType, targetId });
      const reviewedAt = isoNow(now);
      if (!Array.isArray(pack.review_history)) pack.review_history = [];
      pack.review_history.push({
        id: stableId("review", job.id, reviewedAt, String(pack.review_history.length)),
        target_type: targetType,
        target_id: targetId,
        status,
        reviewer_id: reviewerId,
        note,
        reviewed_at: reviewedAt,
      });
      if (pack.review_history.length > 500) {
        pack.review_history = pack.review_history.slice(-500);
      }
      pack.review_status = derivePackReviewStatus(document, pack);
      pack.updated_at = reviewedAt;
      assertDocumentIR(document);
      const validation = validateEducationImportCandidatePack(pack, document, { jobId: job.id });
      if (!validation.valid) {
        throw new EducationImportServiceError(
          "education_import_review_invalid",
          "The requested review would make the candidate pack invalid.",
          { status: 422 },
        );
      }
      await Promise.all([
        atomicWriteJson(documentFilePath(job.id), document),
        atomicWriteJson(candidatePackFilePath(job.id), pack),
      ]);
      job.review = { status: pack.review_status, updated_at: reviewedAt };
      job.updated_at = reviewedAt;
      await persistJob(job);
    });
    return get(safeJobId);
  }

  /**
   * Resolve semantic proposals that were deliberately withheld from the
   * publishable candidate collections. A reviewer can acknowledge one item or
   * the whole queue, but this operation never promotes the rejected model
   * payload into ontology data. It only records that the omission was reviewed.
   */
  async function resolveSemanticReview(jobId, input = {}) {
    ensureOpen();
    await initialize();
    const safeJobId = normalizeJobId(jobId);
    const proposal = optionalText(input.proposal, "proposal", 160);
    const reviewerId = optionalIdentifier(
      input.reviewer_id ?? input.reviewerId,
      "reviewer_id",
    );
    const note = optionalText(input.note, "note", 2_000);
    if (!note) {
      throw invalidInput("A review note is required when resolving semantic review items.");
    }

    await withPromiseLock(jobLocks, safeJobId, async () => {
      const job = jobs.get(safeJobId);
      if (!job) {
        throw new EducationImportServiceError(
          "education_import_not_found",
          "The education import job was not found.",
          { status: 404 },
        );
      }
      if (job.status !== "succeeded" || !job.result?.semantic) {
        throw new EducationImportServiceError(
          "education_import_semantic_review_unavailable",
          "This import has no completed semantic artifact to review.",
          { status: 409 },
        );
      }
      const [document, pack, semanticArtifact] = await Promise.all([
        readJsonArtifact(documentFilePath(job.id), "DocumentIR"),
        readJsonArtifact(candidatePackFilePath(job.id), "candidate pack"),
        readJsonArtifact(semanticArtifactFilePath(job.id), "semantic artifact"),
      ]);
      if (!validateSemanticArtifact(semanticArtifact, document)) {
        throw new EducationImportServiceError(
          "education_import_artifact_invalid",
          "The persisted education semantic artifact is invalid.",
          { status: 500 },
        );
      }
      const pending = semanticArtifact.review_queue || [];
      const selected = proposal
        ? pending.filter((entry) => entry?.proposal === proposal)
        : pending;
      if (!selected.length) {
        throw new EducationImportServiceError(
          "education_import_semantic_review_target_not_found",
          "The semantic review item was not found.",
          { status: 404 },
        );
      }
      const reviewedAt = isoNow(now);
      const selectedSet = new Set(selected);
      semanticArtifact.review_queue = pending.filter((entry) => !selectedSet.has(entry));
      if (!Array.isArray(semanticArtifact.review_history)) semanticArtifact.review_history = [];
      semanticArtifact.review_history.push(...selected.map((entry, index) => ({
        id: stableId(
          "semantic-review",
          job.id,
          reviewedAt,
          entry.proposal,
          String(semanticArtifact.review_history.length + index),
        ),
        proposal: entry.proposal,
        resolution: "withheld_confirmed",
        reviewer_id: reviewerId,
        note,
        reviewed_at: reviewedAt,
      })));
      if (semanticArtifact.review_history.length > 500) {
        semanticArtifact.review_history = semanticArtifact.review_history.slice(-500);
      }

      if (
        semanticArtifact.review_queue.length === 0
        && semanticArtifact.failed_batches.length === 0
        && semanticArtifact.batches.every((batch) => batch?.status === "succeeded")
      ) {
        semanticArtifact.status = "succeeded";
        pack.processing_status = "completed";
        pack.warnings = (pack.warnings || []).filter((warning) => ![
          "semantic_compilation_partial",
          "semantic_cross_batch_relations_need_review",
          "semantic_proposals_need_review",
        ].includes(warning?.code));
      }
      pack.updated_at = reviewedAt;
      job.updated_at = reviewedAt;
      job.result.semantic = {
        ...job.result.semantic,
        status: semanticArtifact.status,
        review_queue_count: semanticArtifact.review_queue.length,
      };
      await Promise.all([
        atomicWriteJson(semanticArtifactFilePath(job.id), semanticArtifact),
        atomicWriteJson(candidatePackFilePath(job.id), pack),
        persistJob(job),
      ]);
    });
    return get(safeJobId);
  }

  async function waitForCompletion(jobId, { timeoutMs = safeLimits.jobTimeoutMs + 5_000 } = {}) {
    const safeJobId = normalizeJobId(jobId);
    const deadline = Date.now() + boundedInteger(timeoutMs, 100, 30 * 60_000, 60_000);
    while (Date.now() < deadline) {
      const job = await get(safeJobId, { includeArtifacts: false });
      if (!job) return null;
      if (TERMINAL_JOB_STATUSES.has(job.status)) return get(safeJobId);
      await delay(20);
    }
    throw new EducationImportServiceError(
      "education_import_wait_timeout",
      "Timed out while waiting for the education import job.",
      { status: 504, retryable: true },
    );
  }

  function configSummary() {
    const modelSummary = typeof modelClient?.configSummary === "function"
      ? modelClient.configSummary()
      : null;
    const semanticSummary = typeof semanticModelClient?.configSummary === "function"
      ? semanticModelClient.configSummary()
      : null;
    return {
      schema_version: "education-import-service-config@1.0",
      model_configured: modelSummary ? modelSummary.configured === true : Boolean(modelClient),
      semantic_model_configured: semanticSummary
        ? semanticSummary.configured === true
        : Boolean(semanticModelClient),
      supported_mime_types: [...new Set(
        Object.values(MIME_DESCRIPTORS).map((descriptor) => descriptor.mimeType),
      )],
      tools: { ...toolCommands },
      limits: { ...safeLimits },
    };
  }

  async function close() {
    closed = true;
    const shutdownReason = new EducationImportServiceError(
      "education_import_service_shutdown",
      "The education import service is shutting down.",
      { status: 503, retryable: true },
    );
    for (const controller of runningControllers.values()) controller.abort(shutdownReason);
    pendingQueue.length = 0;
    pendingIds.clear();
    await Promise.allSettled([...runningTasks.values(), ...jobLocks.values()]);
  }

  function enqueue(jobId) {
    if (pendingIds.has(jobId) || runningControllers.has(jobId)) return;
    pendingIds.add(jobId);
    pendingQueue.push(jobId);
  }

  function schedulePump() {
    queueMicrotask(() => void pump());
  }

  async function pump() {
    if (closed) return;
    while (
      pendingQueue.length
      && runningControllers.size < safeLimits.maxConcurrentJobs
    ) {
      const jobId = pendingQueue.shift();
      pendingIds.delete(jobId);
      const job = jobs.get(jobId);
      if (!job || TERMINAL_JOB_STATUSES.has(job.status)) continue;
      const controller = new AbortController();
      runningControllers.set(jobId, controller);
      const task = processJob(job, controller);
      runningTasks.set(jobId, task);
      void task
        .finally(() => {
          runningControllers.delete(jobId);
          runningTasks.delete(jobId);
          schedulePump();
        });
    }
  }

  async function processJob(job, controller) {
    let leaseToken;
    try {
      leaseToken = await acquireJobLease(job.id);
    } catch (error) {
      // A worker that did not acquire the lease has no authority to overwrite
      // persisted job state: another process may still be the valid owner.
      // Keep the task recoverable and retry acquisition after the lease window.
      scheduleLeaseRefresh(job.id);
      return;
    }
    if (!leaseToken) {
      scheduleLeaseRefresh(job.id);
      return;
    }
    // The snapshot read before lease acquisition may be stale. Another worker
    // can finish and release the lease while this worker is waiting, so always
    // re-read under the lease before changing state or repeating model work.
    try {
      const persisted = JSON.parse(await readFile(jobFilePath(job.id), "utf8"));
      if (isPersistedJob(persisted, job.id)) {
        job = persisted;
        jobs.set(job.id, persisted);
      }
      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        await releaseJobLease(job.id, leaseToken);
        return;
      }
    } catch (cause) {
      const refreshError = new EducationImportServiceError(
        "education_import_job_unavailable",
        "The education import job state is unavailable.",
        { status: 503, retryable: true, cause },
      );
      const normalized = normalizeProcessingError(refreshError, false);
      await updateJob(job, {
        status: "failed",
        phase: "failed",
        completed_at: isoNow(now),
        error: {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable,
        },
      }).catch(() => {});
      await releaseJobLease(job.id, leaseToken);
      return;
    }
    const timeout = setTimeout(() => controller.abort(
      new EducationImportServiceError(
        "education_import_job_timeout",
        "The education import exceeded its processing deadline.",
        { status: 504, retryable: true },
      ),
    ), safeLimits.jobTimeoutMs);
    try {
      await updateJob(job, {
        status: "processing",
        phase: "inspecting",
        started_at: job.started_at || isoNow(now),
        completed_at: null,
        error: null,
      });
      const sourcePath = join(jobDirectory(job.id), job.source.stored_file_name);
      const verifiedSource = await verifyPersistedSource(job, sourcePath);
      const parsed = job.source.kind === "pdf"
        ? await parsePdf(job, sourcePath, controller.signal)
        : await parseImage(job, sourcePath, controller.signal, verifiedSource.bytes);
      await verifyPersistedSource(job, sourcePath, { includeBytes: false });
      if (controller.signal.aborted) throw abortedImportError();
      await updateJob(job, { phase: "assembling" });
      const assembled = assembleArtifacts(
        job,
        parsed,
        isoNow(now),
        safeLimits,
      );
      const { document } = assembled;
      let { candidatePack } = assembled;
      let semanticArtifact = null;
      assertDocumentIR(document);
      if (isSemanticModelConfigured(semanticModelClient)) {
        await updateJob(job, { phase: "semantic_compilation" });
        const semanticCompilation = await compileSemanticBatches({
          job,
          document,
          candidatePack,
          signal: controller.signal,
        });
        candidatePack = semanticCompilation.candidatePack;
        semanticArtifact = semanticCompilation.semanticArtifact;
        const trustedArtifacts = await loadTrustedCardTemplates();
        semanticArtifact.extensions.knowledge_card_proposals = [
          ...compileEducationCardTemplateProposals({
            candidatePack,
            trustedArtifacts,
          }),
        ];
        semanticArtifact.card_generation = {
          schema_version: "education-import-card-generation@1.0",
          status: "proposed_for_review",
          proposal_count: semanticArtifact.extensions.knowledge_card_proposals.length,
          bounded_template_count: semanticArtifact.extensions.knowledge_card_proposals
            .filter((item) => item.renderability === "bounded_template_match").length,
          publication_boundary: "human_review_required",
        };
      } else if (semanticModelClient) {
        candidatePack = {
          ...candidatePack,
          processing_status: "partial",
          review_status: "needs_review",
          warnings: [...candidatePack.warnings],
        };
        appendCandidatePackWarning(candidatePack, {
          code: "semantic_model_unconfigured",
          page_index: null,
          message: "Knowledge-point and relation compilation requires a configured semantic model.",
        });
      }
      const packValidation = validateEducationImportCandidatePack(
        candidatePack,
        document,
        { jobId: job.id },
      );
      if (!packValidation.valid) {
        throw new EducationImportServiceError(
          "education_import_candidate_pack_invalid",
          "The extracted education candidate pack is invalid.",
          { status: 502 },
        );
      }
      await updateJob(job, { phase: "persisting" });
      const writes = [
        atomicWriteJson(documentFilePath(job.id), document),
        atomicWriteJson(candidatePackFilePath(job.id), candidatePack),
      ];
      if (semanticArtifact) {
        writes.push(atomicWriteJson(semanticArtifactFilePath(job.id), semanticArtifact));
      }
      await Promise.all(writes);
      const candidateCounts = countCandidates(candidatePack);
      await updateJob(job, {
        status: "succeeded",
        phase: "completed",
        completed_at: isoNow(now),
        result: {
          document_id: document.id,
          document_revision_id: document.revision_id,
          document_type: document.document_type,
          page_count: document.pages.length,
          candidate_counts: candidateCounts,
          warning_count: candidatePack.warnings.length,
          semantic: semanticArtifact ? {
            status: semanticArtifact.status,
            batch_count: semanticArtifact.batch_count,
            failed_batch_count: semanticArtifact.failed_batches.length,
            extension_count: Object.values(semanticArtifact.extensions)
              .reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0),
            review_queue_count: semanticArtifact.review_queue.length,
            card_proposal_count: semanticArtifact.extensions.knowledge_card_proposals?.length || 0,
            bounded_card_template_count: semanticArtifact.card_generation?.bounded_template_count || 0,
          } : null,
        },
        review: {
          status: candidatePack.review_status,
          updated_at: null,
        },
      });
    } catch (error) {
      if (controller.signal.reason?.code === "education_import_service_shutdown") {
        await updateJob(job, {
          status: "queued",
          phase: "interrupted",
          completed_at: null,
          error: null,
        }).catch(() => {});
        return;
      }
      const normalized = normalizeProcessingError(error, controller.signal.aborted);
      await updateJob(job, {
        status: "failed",
        phase: "failed",
        completed_at: isoNow(now),
        error: {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable,
        },
      }).catch(() => {});
    } finally {
      clearTimeout(timeout);
      await releaseJobLease(job.id, leaseToken);
    }
  }

  async function parsePdf(job, sourcePath, signal) {
    await updateJob(job, { phase: "native_metadata" });
    const infoResult = await invokeNativeTool({
      runner: commandRunner,
      command: toolCommands.pdfinfo,
      args: [sourcePath],
      timeoutMs: safeLimits.nativeToolTimeoutMs,
      maxBuffer: 512 * 1024,
      signal,
    });
    const pdfInfo = parsePdfInfo(infoResult.stdout);
    if (pdfInfo.pageCount > safeLimits.maxPages) {
      throw new EducationImportServiceError(
        "education_import_page_limit_exceeded",
        `PDF files may contain at most ${safeLimits.maxPages} pages.`,
        { status: 413 },
      );
    }
    job.progress.total_pages = pdfInfo.pageCount;
    await updateJob(job, { progress: job.progress, phase: "native_text" });

    const textResult = await invokeNativeTool({
      runner: commandRunner,
      command: toolCommands.pdftotext,
      args: ["-layout", "-enc", "UTF-8", sourcePath, "-"],
      timeoutMs: safeLimits.nativeToolTimeoutMs,
      maxBuffer: safeLimits.maxExtractedTextBytes,
      signal,
    });
    if (Buffer.byteLength(textResult.stdout, "utf8") > safeLimits.maxExtractedTextBytes) {
      throw new EducationImportServiceError(
        "education_import_extracted_text_limit_exceeded",
        "Extracted PDF text exceeds the safe output limit.",
        { status: 413 },
      );
    }
    const pageTexts = splitPdfText(textResult.stdout, pdfInfo.pageCount).map((text) =>
      limitUtf8Text(text, 1_000_000)
    );
    const nativeTextCharacters = pageTexts.reduce(
      (sum, text) => sum + nonWhitespaceLength(text),
      0,
    );
    job.progress.native_text_characters = nativeTextCharacters;
    await updateJob(job, { progress: job.progress, phase: "rendering_pages" });

    const pagesDir = join(jobDirectory(job.id), "pages");
    await mkdir(pagesDir, { recursive: true, mode: 0o700 });
    const pageAssets = [];
    let renderedBytes = 0;
    for (let index = 0; index < pdfInfo.pageCount; index += 1) {
      if (signal.aborted) throw abortedImportError();
      const prefix = join(pagesDir, `page-${String(index + 1).padStart(4, "0")}`);
      await invokeNativeTool({
        runner: commandRunner,
        command: toolCommands.pdftoppm,
        args: [
          "-f",
          String(index + 1),
          "-l",
          String(index + 1),
          "-singlefile",
          "-scale-to",
          String(safeLimits.pageImageMaxDimension),
          "-png",
          sourcePath,
          prefix,
        ],
        timeoutMs: safeLimits.nativeToolTimeoutMs,
        maxBuffer: 512 * 1024,
        signal,
      });
      const imagePath = `${prefix}.png`;
      await chmod(imagePath, 0o600);
      const imageStat = await stat(imagePath);
      if (imageStat.size <= 0 || imageStat.size > safeLimits.maxPageImageBytes) {
        throw new EducationImportServiceError(
          "education_import_rendered_page_too_large",
          "A rendered PDF page exceeds the safe image size limit.",
          { status: 413 },
        );
      }
      renderedBytes += imageStat.size;
      if (renderedBytes > safeLimits.maxRenderedBytes) {
        throw new EducationImportServiceError(
          "education_import_rendered_output_limit_exceeded",
          "Rendered PDF pages exceed the safe output limit.",
          { status: 413 },
        );
      }
      const imageBytes = await readFile(imagePath);
      const dimensions = parseImageDimensions(imageBytes, "png");
      pageAssets.push(makePageAsset({
        job,
        pageIndex: index,
        mimeType: "image/png",
        storageRef: relative(jobDirectory(job.id), imagePath),
        bytes: imageBytes,
        dimensions,
      }));
      job.progress.current_page = index + 1;
      job.progress.rendered_pages = index + 1;
      await updateJob(job, { progress: job.progress });
    }

    const requestedType = job.request.document_type;
    const effectiveType = chooseDocumentType(
      requestedType,
      [],
      job.source.file_name,
      pageTexts.join("\n"),
    );
    const visionIndexes = pageTexts
      .map((text, index) => ({ index, characters: nonWhitespaceLength(text) }))
      .filter(({ characters }) =>
        VISUAL_DOCUMENT_TYPES.has(effectiveType)
        || characters < safeLimits.lowTextCharacters
      )
      .map(({ index }) => index);
    if (visionIndexes.length > safeLimits.maxVisionPages) {
      throw new EducationImportServiceError(
        "education_import_vision_page_limit_exceeded",
        `At most ${safeLimits.maxVisionPages} pages may require visual analysis.`,
        { status: 413 },
      );
    }
    const analyses = new Map();
    const modelReceipts = [];
    if (visionIndexes.length) {
      ensureVisionAvailable(modelClient);
      await updateJob(job, { phase: "visual_analysis" });
      for (const pageIndex of visionIndexes) {
        if (signal.aborted) throw abortedImportError();
        const asset = pageAssets[pageIndex];
        const imagePath = join(jobDirectory(job.id), asset.storage_ref);
        const analysis = await analyzeVisualPage({
          modelClient,
          imageBytes: await readFile(imagePath),
          mimeType: asset.mime_type,
          pageIndex,
          nativeText: pageTexts[pageIndex],
          documentHint: effectiveType,
          timeoutMs: safeLimits.modelRequestTimeoutMs,
          signal,
        });
        analyses.set(pageIndex, analysis.data);
        modelReceipts.push(analysis.receipt);
        job.progress.vision_pages += 1;
        job.progress.current_page = pageIndex + 1;
        await updateJob(job, { progress: job.progress });
      }
    }
    return {
      kind: "pdf",
      pdfInfo,
      pageTexts,
      pageAssets,
      analyses,
      modelReceipts,
    };
  }

  async function parseImage(job, sourcePath, signal, verifiedBytes) {
    ensureVisionAvailable(modelClient);
    const bytes = verifiedBytes || await readFile(sourcePath);
    const dimensions = parseImageDimensions(bytes, job.source.kind);
    if (dimensions.width * dimensions.height > 80_000_000) {
      throw new EducationImportServiceError(
        "education_import_image_pixel_limit_exceeded",
        "The image dimensions exceed the safe pixel limit.",
        { status: 413 },
      );
    }
    job.progress.total_pages = 1;
    job.progress.rendered_pages = 1;
    await updateJob(job, { progress: job.progress, phase: "visual_analysis" });
    const asset = makePageAsset({
      job,
      pageIndex: 0,
      mimeType: job.source.mime_type,
      storageRef: job.source.stored_file_name,
      bytes,
      dimensions,
    });
    const analysis = await analyzeVisualPage({
      modelClient,
      imageBytes: bytes,
      mimeType: job.source.mime_type,
      pageIndex: 0,
      nativeText: "",
      documentHint: job.request.document_type,
      timeoutMs: safeLimits.modelRequestTimeoutMs,
      signal,
    });
    job.progress.current_page = 1;
    job.progress.vision_pages = 1;
    await updateJob(job, { progress: job.progress });
    return {
      kind: "image",
      pdfInfo: null,
      pageTexts: [""],
      pageAssets: [asset],
      analyses: new Map([[0, analysis.data]]),
      modelReceipts: [analysis.receipt],
    };
  }

  async function compileSemanticBatches({ job, document, candidatePack: initialPack, signal }) {
    const descriptors = makeSemanticBatchDescriptors(
      document.pages,
      safeLimits.semanticBatchPages,
    );
    let candidatePack = initialPack;
    const extensions = emptySemanticExtensions();
    const reviewQueue = [];
    const proposalIdMap = {};
    const warnings = [];
    const batches = [];
    const failedBatches = [];
    const modelReceipts = [];
    let succeededBatchCount = 0;
    let partialBatchCount = 0;
    let attemptedBatchCount = 0;
    job.progress.semantic_batches_completed = 0;
    job.progress.semantic_batches_total = descriptors.length;
    await updateJob(job, { progress: job.progress });

    for (const descriptor of descriptors) {
      if (signal.aborted) throw abortedImportError();
      if (descriptor.batch_index > safeLimits.maxSemanticBatches) {
        const failure = {
          batch_index: descriptor.batch_index,
          id_namespace: descriptor.id_namespace,
          page_indexes: descriptor.page_indexes,
          status: "skipped",
          code: "education_semantic_batch_limit_reached",
          message: "This semantic batch was not attempted because the configured batch limit was reached.",
        };
        failedBatches.push(failure);
        batches.push(failure);
        job.progress.semantic_batches_completed += 1;
        await updateJob(job, { progress: job.progress });
        continue;
      }

      attemptedBatchCount += 1;
      let semanticResult = null;
      try {
        const batchCandidatePack = filterCandidatePackForSemanticBatch(
          candidatePack,
          new Set(descriptor.page_indexes),
        );
        semanticResult = await compileEducationSemanticProposals({
          documentIR: document,
          candidatePack: batchCandidatePack,
          modelClient: semanticModelClient,
          signal,
          idNamespace: descriptor.id_namespace,
          pageIndexes: descriptor.page_indexes,
        });
        modelReceipts.push({
          batch_index: descriptor.batch_index,
          id_namespace: descriptor.id_namespace,
          ...semanticResult.model_receipt,
        });
        const merged = mergeSemanticProposalsIntoCandidatePack(
          candidatePack,
          semanticResult,
          { updatedAt: isoNow(now) },
        );
        candidatePack = merged.candidate_pack;
        appendSemanticExtensions(extensions, merged.semantic_extensions);
        reviewQueue.push(...merged.semantic_review_queue.map((entry) => ({
          ...entry,
          batch_index: descriptor.batch_index,
          id_namespace: descriptor.id_namespace,
        })));
        for (const [proposalId, candidateId] of Object.entries(merged.proposal_id_map)) {
          proposalIdMap[`${descriptor.id_namespace}:${proposalId}`] = candidateId;
        }
        warnings.push(...semanticResult.warnings.map((warning) => ({
          ...warning,
          batch_index: descriptor.batch_index,
          id_namespace: descriptor.id_namespace,
        })));
        const batchStatus = semanticResult.status === "partial"
          || semanticResult.input_receipt?.truncated === true
          || semanticResult.warnings.some((warning) => warning?.code === "semantic_input_truncated")
          ? "partial"
          : "succeeded";
        batches.push({
          ...descriptor,
          status: batchStatus,
          input_receipt: semanticResult.input_receipt,
          candidate_counts: countSemanticCandidates(semanticResult.candidates),
          extension_count: countSemanticExtensions(merged.semantic_extensions),
          review_queue_count: merged.semantic_review_queue.length,
          warning_count: semanticResult.warnings.length,
          model_receipt: semanticResult.model_receipt,
        });
        succeededBatchCount += 1;
        if (batchStatus === "partial") partialBatchCount += 1;
      } catch (error) {
        if (signal.aborted) throw error;
        const failure = {
          ...descriptor,
          status: "failed",
          code: safeSemanticFailureCode(error),
          message: "This semantic batch failed; its source pages remain available for review and reprocessing.",
        };
        failedBatches.push(failure);
        batches.push(failure);
      }
      job.progress.semantic_batches_completed += 1;
      await updateJob(job, { progress: job.progress });
    }

    if (descriptors.length > 1) {
      const crossBatchMessage = "Knowledge dependencies that cross semantic batch boundaries require reconciliation before publication.";
      appendCandidatePackWarning(candidatePack, {
        code: "semantic_cross_batch_relations_need_review",
        page_index: null,
        message: crossBatchMessage,
      });
      warnings.push({
        code: "semantic_cross_batch_relations_need_review",
        message: crossBatchMessage,
      });
      reviewQueue.push({
        proposal: "cross_batch_relation_reconciliation",
        status: "needs_review",
        reasons: [crossBatchMessage],
        source_refs: [],
        batch_index: null,
        id_namespace: null,
      });
    }

    const crossBatchReconciliationPending = descriptors.length > 1;
    const status = succeededBatchCount === 0
      ? "failed"
      : failedBatches.length > 0
        || partialBatchCount > 0
        || crossBatchReconciliationPending
        ? "partial"
        : "succeeded";
    if (status !== "succeeded") {
      candidatePack = {
        ...candidatePack,
        processing_status: "partial",
        review_status: "needs_review",
        warnings: [...candidatePack.warnings],
      };
      appendCandidatePackWarning(candidatePack, {
        code: status === "partial" ? "semantic_compilation_partial" : "semantic_compilation_failed",
        page_index: null,
        message: status === "partial"
          ? "Semantic compilation is incomplete because a batch was truncated, failed, skipped, or still requires cross-batch reconciliation."
          : "Semantic compilation failed for every batch; only non-semantic import candidates are available.",
      });
    }

    const singleBatchReceipt = descriptors.length === 1
      ? (modelReceipts[0]
        ? stripBatchReceiptMetadata(modelReceipts[0])
        : null)
      : null;
    return {
      candidatePack,
      semanticArtifact: {
        schema_version: "education-semantic-artifact@1.0",
        document_id: document.id,
        document_revision_id: document.revision_id,
        generated_at: document.provenance.recorded_at,
        status,
        batch_count: descriptors.length,
        attempted_batch_count: attemptedBatchCount,
        succeeded_batch_count: succeededBatchCount,
        partial_batch_count: partialBatchCount,
        failed_batches: failedBatches,
        batches,
        extensions,
        review_queue: reviewQueue,
        proposal_id_map: proposalIdMap,
        warnings,
        model_receipts: modelReceipts,
        model_receipt: singleBatchReceipt,
      },
    };
  }

  async function loadTrustedCardTemplates() {
    if (!trustedCardCatalogPromise) {
      trustedCardCatalogPromise = readFile(resolve(cardTemplateCatalogPath), "utf8")
        .then((source) => JSON.parse(source))
        .then((catalog) => Array.isArray(catalog?.artifacts) ? catalog.artifacts : [])
        .catch(() => []);
    }
    return trustedCardCatalogPromise;
  }

  async function updateJob(job, patch) {
    Object.assign(job, clone(patch));
    job.updated_at = isoNow(now);
    await persistJob(job);
  }

  async function persistJob(job) {
    await atomicWriteJson(jobFilePath(job.id), job);
  }

  function jobDirectory(jobId) {
    return join(rootDir, normalizeJobId(jobId));
  }

  function jobFilePath(jobId) {
    return join(jobDirectory(jobId), "job.json");
  }

  function documentFilePath(jobId) {
    return join(jobDirectory(jobId), "document-ir.json");
  }

  function candidatePackFilePath(jobId) {
    return join(jobDirectory(jobId), "candidate-pack.json");
  }

  function semanticArtifactFilePath(jobId) {
    return join(jobDirectory(jobId), "semantic-artifact.json");
  }

  function leaseFilePath(jobId) {
    return join(jobDirectory(jobId), "processing.lock");
  }

  async function acquireJobLease(jobId) {
    const leasePath = leaseFilePath(jobId);
    const staleAfterMs = Math.max(
      safeLimits.jobLeaseStaleMs,
      safeLimits.jobTimeoutMs + 60_000,
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = randomUUID();
      let handle;
      try {
        handle = await open(leasePath, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify({
          token,
          instance_id: serviceInstanceId,
          acquired_at: new Date().toISOString(),
        })}\n`, "utf8");
        await handle.sync();
        await handle.close();
        return token;
      } catch (cause) {
        await handle?.close().catch(() => {});
        if (cause?.code !== "EEXIST") {
          throw new EducationImportServiceError(
            "education_import_lease_unavailable",
            "The education import job lease is unavailable.",
            { status: 503, retryable: true, cause },
          );
        }
        let leaseStat;
        try {
          leaseStat = await stat(leasePath);
        } catch {
          continue;
        }
        if (Date.now() - leaseStat.mtimeMs <= staleAfterMs) return null;
        const stalePath = `${leasePath}.stale-${randomUUID()}`;
        try {
          await rename(leasePath, stalePath);
          await unlink(stalePath).catch(() => {});
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  async function releaseJobLease(jobId, token) {
    const leasePath = leaseFilePath(jobId);
    try {
      const lease = JSON.parse(await readFile(leasePath, "utf8"));
      if (lease?.token === token) await unlink(leasePath);
    } catch {
      // A missing, stale, or replaced lease must never remove another owner.
    }
  }

  function scheduleLeaseRefresh(jobId) {
    const timer = setTimeout(async () => {
      if (closed) return;
      try {
        const persisted = JSON.parse(await readFile(jobFilePath(jobId), "utf8"));
        if (!isPersistedJob(persisted, jobId)) return;
        jobs.set(jobId, persisted);
        if (!TERMINAL_JOB_STATUSES.has(persisted.status)) {
          enqueue(jobId);
          schedulePump();
        }
      } catch {
        // The active lease owner may be between atomic writes; retry on demand.
      }
    }, 250);
    timer.unref?.();
  }

  async function verifyPersistedSource(job, sourcePath, { includeBytes = true } = {}) {
    let bytes;
    try {
      bytes = await readBoundedFile(sourcePath, safeLimits.maxFileBytes);
    } catch (cause) {
      if (cause instanceof EducationImportServiceError) throw cause;
      throw new EducationImportServiceError(
        "education_import_source_unavailable",
        "The persisted education import source is unavailable.",
        { status: 422, cause },
      );
    }
    const kind = sniffFileKind(bytes);
    if (
      bytes.length !== job.source.size_bytes
      || sha256(bytes) !== job.source.sha256
      || kind !== job.source.kind
    ) {
      throw new EducationImportServiceError(
        "education_import_source_integrity_failed",
        "The persisted education import source no longer matches the task receipt.",
        { status: 409 },
      );
    }
    return { bytes: includeBytes ? bytes : null };
  }

  function ensureOpen() {
    if (closed) {
      throw new EducationImportServiceError(
        "education_import_service_closed",
        "The education import service is closed.",
        { status: 503 },
      );
    }
  }

  return Object.freeze({
    initialize,
    create,
    list,
    get,
    getPageAsset,
    review,
    resolveSemanticReview,
    waitForCompletion,
    configSummary,
    close,
  });
}

export function validateEducationImportCandidatePack(pack, document, { jobId } = {}) {
  const errors = [];
  if (!isPlainObject(pack)) {
    return { valid: false, errors: ["$pack: must be an object"] };
  }
  const allowedKeys = new Set([
    "schema_version",
    "job_id",
    "document_id",
    "document_revision_id",
    "generated_at",
    "updated_at",
    "processing_status",
    "review_status",
    "assets",
    "candidates",
    "rejected_candidates",
    "warnings",
    "receipt",
    "review_history",
  ]);
  for (const key of Object.keys(pack)) {
    if (!allowedKeys.has(key)) errors.push(`$pack.${key}: is not allowed`);
  }
  if (pack.schema_version !== EDUCATION_IMPORT_CANDIDATE_PACK_SCHEMA_VERSION) {
    errors.push(`$pack.schema_version: must equal ${EDUCATION_IMPORT_CANDIDATE_PACK_SCHEMA_VERSION}`);
  }
  if (!JOB_ID_PATTERN.test(pack.job_id || "")) errors.push("$pack.job_id: is invalid");
  if (jobId && pack.job_id !== jobId) errors.push("$pack.job_id: does not match the job");
  if (!CONTRACT_ID_PATTERN.test(pack.document_id || "")) errors.push("$pack.document_id: is invalid");
  if (!CONTRACT_ID_PATTERN.test(pack.document_revision_id || "")) {
    errors.push("$pack.document_revision_id: is invalid");
  }
  if (!REVIEW_STATUS_SET.has(pack.review_status)) errors.push("$pack.review_status: is invalid");
  if (!["completed", "partial"].includes(pack.processing_status)) {
    errors.push("$pack.processing_status: must be completed or partial");
  }
  if (!isUtcIso(pack.generated_at)) errors.push("$pack.generated_at: must be a UTC ISO date-time");
  if (!isUtcIso(pack.updated_at)) errors.push("$pack.updated_at: must be a UTC ISO date-time");
  if (document) {
    const documentValidation = validateEducationImportContract("DocumentIR", document);
    errors.push(...documentValidation.errors.map((error) => `DocumentIR ${error}`));
    if (document.id !== pack.document_id) errors.push("$pack.document_id: does not match DocumentIR");
    if (document.revision_id !== pack.document_revision_id) {
      errors.push("$pack.document_revision_id: does not match DocumentIR");
    }
  }

  const pageBlocks = new Map();
  const allIds = new Set();
  const assetIds = new Set();
  if (document?.id) allIds.add(document.id);
  for (const page of Array.isArray(document?.pages) ? document.pages : []) {
    const ids = new Set();
    for (const block of Array.isArray(page.blocks) ? page.blocks : []) {
      ids.add(block.id);
      if (allIds.has(block.id)) errors.push(`DocumentIR block ${block.id}: duplicate global id`);
      allIds.add(block.id);
    }
    pageBlocks.set(page.index, ids);
  }
  if (document) {
    validateCandidateAnchors(document, pageBlocks, errors, "$document", document);
  }

  if (!Array.isArray(pack.assets)) {
    errors.push("$pack.assets: must be an array");
  } else {
    for (const [index, asset] of pack.assets.entries()) {
      const assetPath = `$pack.assets[${index}]`;
      if (!hasExactObjectKeys(asset, [
        "id", "page_index", "mime_type", "storage_ref", "sha256", "size_bytes", "width", "height",
      ], errors, assetPath)) continue;
      if (!CONTRACT_ID_PATTERN.test(asset.id || "")) {
        errors.push(`$pack.assets[${index}].id: is invalid`);
        continue;
      }
      if (assetIds.has(asset.id)) errors.push(`$pack.assets[${index}].id: must be unique`);
      if (allIds.has(asset.id)) errors.push(`$pack.assets[${index}].id: duplicate global id`);
      assetIds.add(asset.id);
      allIds.add(asset.id);
      if (!Number.isInteger(asset.page_index) || !pageBlocks.has(asset.page_index)) {
        errors.push(`$pack.assets[${index}].page_index: is invalid`);
      }
      if (typeof asset.storage_ref !== "string" || !isSafeStorageRef(asset.storage_ref)) {
        errors.push(`$pack.assets[${index}].storage_ref: is unsafe`);
      }
      if (!/^[a-f0-9]{64}$/u.test(asset.sha256 || "")) {
        errors.push(`$pack.assets[${index}].sha256: is invalid`);
      }
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(asset.mime_type)) {
        errors.push(`$pack.assets[${index}].mime_type: is invalid`);
      }
      for (const key of ["size_bytes", "width", "height"]) {
        if (!Number.isInteger(asset[key]) || asset[key] <= 0) {
          errors.push(`$pack.assets[${index}].${key}: must be a positive integer`);
        }
      }
    }
  }

  const collectionSpecs = [
    ["curriculum_standards", "CurriculumStandardCandidate"],
    ["questions", "QuestionIR"],
    ["submissions", "SubmissionIR"],
    ["typed_relations", "TypedRelation"],
    ["question_knowledge_links", "QuestionKnowledgeLink"],
    ["evidence", "EvidenceCandidate"],
  ];
  if (!isPlainObject(pack.candidates)) {
    errors.push("$pack.candidates: must be an object");
  } else {
    const allowedCollections = new Set(collectionSpecs.map(([name]) => name));
    for (const key of Object.keys(pack.candidates)) {
      if (!allowedCollections.has(key)) errors.push(`$pack.candidates.${key}: is not allowed`);
    }
    for (const [name, contractName] of collectionSpecs) {
      const values = pack.candidates[name];
      if (!Array.isArray(values)) {
        errors.push(`$pack.candidates.${name}: must be an array`);
        continue;
      }
      values.forEach((candidate, index) => {
        const result = validateEducationImportContract(contractName, candidate);
        errors.push(...result.errors.map((error) =>
          `$pack.candidates.${name}[${index}] ${error}`
        ));
        if (candidate?.id) {
          if (allIds.has(candidate.id)) {
            errors.push(`$pack.candidates.${name}[${index}].id: duplicate global id`);
          }
          allIds.add(candidate.id);
        }
        collectNestedCandidateIds(
          candidate,
          allIds,
          errors,
          `$pack.candidates.${name}[${index}]`,
        );
        validateCandidateAnchors(
          candidate,
          pageBlocks,
          errors,
          `$pack.candidates.${name}[${index}]`,
          document,
        );
      });
    }
  }

  validateQuestionReferences(pack, assetIds, errors);
  validateSubmissionReferences(pack, assetIds, errors);
  validateRejectedCandidates(pack.rejected_candidates, errors);
  validatePackWarnings(pack.warnings, pageBlocks, errors);
  validateReviewHistory(pack.review_history, errors);
  validatePackReceipt(pack.receipt, errors);
  return { valid: errors.length === 0, errors };
}

export function assertEducationImportCandidatePack(pack, document, options) {
  const result = validateEducationImportCandidatePack(pack, document, options);
  if (!result.valid) {
    throw new EducationImportServiceError(
      "education_import_candidate_pack_invalid",
      `Education import candidate pack validation failed: ${result.errors.join("; ")}`,
      { status: 422 },
    );
  }
  return pack;
}

export async function runNativeCommand(command, args, {
  timeoutMs = 30_000,
  maxBuffer = 8 * 1024 * 1024,
  signal,
} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, {
      encoding: "utf8",
      maxBuffer,
      timeout: timeoutMs,
      signal,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        error.nativeToolCode = error.code;
        rejectPromise(error);
        return;
      }
      resolvePromise({ stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

async function readBoundedFile(path, maxBytes) {
  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
    handle = await open(path, flags);
    const sourceStat = await handle.stat();
    if (!sourceStat.isFile()) {
      throw new EducationImportServiceError(
        "education_import_source_invalid",
        "The education import source must be a regular file.",
        { status: 422 },
      );
    }
    if (sourceStat.size > maxBytes) {
      throw new EducationImportServiceError(
        "education_import_file_too_large",
        `Files may contain at most ${maxBytes} bytes.`,
        { status: 413 },
      );
    }
    const chunks = [];
    const readBuffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(readBuffer, 0, readBuffer.length, null);
      if (!bytesRead) break;
      if (total + bytesRead > maxBytes) {
        throw new EducationImportServiceError(
          "education_import_file_too_large",
          `Files may contain at most ${maxBytes} bytes.`,
          { status: 413 },
        );
      }
      chunks.push(Buffer.from(readBuffer.subarray(0, bytesRead)));
      total += bytesRead;
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function normalizeCreateInput(input, { limits, allowedSourceRoots }) {
  if (!isPlainObject(input)) throw invalidInput("Import input must be an object.");
  const bytes = await readInputBytes(input, limits, allowedSourceRoots);
  if (!bytes.length) throw invalidInput("The education import file is empty.");
  if (bytes.length > limits.maxFileBytes) {
    throw new EducationImportServiceError(
      "education_import_file_too_large",
      `Files may contain at most ${limits.maxFileBytes} bytes.`,
      { status: 413 },
    );
  }
  const kind = sniffFileKind(bytes);
  if (!kind) {
    throw new EducationImportServiceError(
      "education_import_unsupported_file",
      "Only PDF, PNG, JPEG, WebP, and GIF files are supported.",
      { status: 415 },
    );
  }
  if (kind !== "pdf" && bytes.length > limits.maxImageFileBytes) {
    throw new EducationImportServiceError(
      "education_import_image_too_large",
      `Images may contain at most ${limits.maxImageFileBytes} bytes.`,
      { status: 413 },
    );
  }
  const fileObject = isPlainObject(input.file) ? input.file : {};
  const declaredMime = normalizeMime(
    input.mime_type ?? input.mimeType ?? fileObject.mime_type ?? fileObject.mimeType ?? fileObject.type,
  );
  if (declaredMime) {
    const declaredKind = DECLARED_MIME_TO_KIND.get(declaredMime);
    if (!declaredKind || declaredKind !== kind) {
      throw new EducationImportServiceError(
        "education_import_mime_mismatch",
        "The declared file type does not match the file content.",
        { status: 415 },
      );
    }
  }
  const descriptor = MIME_DESCRIPTORS[kind];
  const rawFileName = input.file_name
    ?? input.fileName
    ?? fileObject.file_name
    ?? fileObject.fileName
    ?? fileObject.name
    ?? `upload${descriptor.extension}`;
  const fileName = sanitizeFileName(repairUtf8Mojibake(String(rawFileName || "")), descriptor.extension);
  const documentType = normalizeDocumentType(input.document_type ?? input.documentType ?? "unknown");
  const tenantId = optionalIdentifier(input.tenant_id ?? input.tenantId, "tenant_id");
  const learnerId = optionalIdentifier(input.learner_id ?? input.learnerId, "learner_id");
  if (Boolean(tenantId) !== Boolean(learnerId)) {
    throw invalidInput("tenant_id and learner_id must be provided together.");
  }
  return {
    bytes,
    kind,
    mimeType: descriptor.mimeType,
    fileName,
    sha256: sha256(bytes),
    request: {
      document_type: documentType,
      title: optionalImportText(input.title, "title", 500),
      language: optionalImportText(input.language, "language", 40),
      subject: optionalImportText(input.subject, "subject", 120),
      grade_band: optionalImportText(input.grade_band ?? input.gradeBand, "grade_band", 120),
      identity: tenantId && learnerId
        ? { tenant_id: tenantId, learner_id: learnerId, status: "resolved" }
        : { tenant_id: null, learner_id: null, status: "unresolved" },
    },
  };
}

async function readInputBytes(input, limits, allowedSourceRoots) {
  const fileObject = isPlainObject(input.file) ? input.file : {};
  const byteValue = input.buffer
    ?? input.bytes
    ?? (Buffer.isBuffer(input.file) || input.file instanceof Uint8Array ? input.file : undefined)
    ?? fileObject.buffer
    ?? fileObject.bytes;
  if (Buffer.isBuffer(byteValue) || byteValue instanceof Uint8Array) {
    return Buffer.from(byteValue);
  }
  const base64Value = input.base64 ?? fileObject.base64;
  if (typeof base64Value === "string") {
    const compact = base64Value.replace(/\s+/gu, "");
    if (!compact || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(compact)) {
      throw invalidInput("base64 must be valid standard base64 data.");
    }
    if (compact.length > Math.ceil(limits.maxFileBytes / 3) * 4 + 4) {
      throw new EducationImportServiceError(
        "education_import_file_too_large",
        `Files may contain at most ${limits.maxFileBytes} bytes.`,
        { status: 413 },
      );
    }
    return Buffer.from(compact, "base64");
  }
  const sourcePath = input.source_path ?? input.sourcePath ?? fileObject.path;
  if (typeof sourcePath === "string" && sourcePath.trim()) {
    if (!allowedSourceRoots.length) {
      throw new EducationImportServiceError(
        "education_import_source_path_disabled",
        "Importing from a server file path is disabled.",
        { status: 403 },
      );
    }
    const sourceAbsolutePath = resolve(sourcePath);
    let resolvedPath;
    let canonicalRoots;
    try {
      resolvedPath = await realpath(sourceAbsolutePath);
      canonicalRoots = await Promise.all(allowedSourceRoots.map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          return root;
        }
      }));
    } catch (cause) {
      throw new EducationImportServiceError(
        "education_import_source_unavailable",
        "The allowed source file is unavailable.",
        { status: 404, cause },
      );
    }
    const permitted = canonicalRoots.some((root) => isWithinRoot(resolvedPath, root));
    if (!permitted) {
      throw new EducationImportServiceError(
        "education_import_source_path_forbidden",
        "The source file is outside the allowed import directories.",
        { status: 403 },
      );
    }
    try {
      // Open the canonical path that was actually checked. This avoids
      // re-resolving a caller-controlled alias after the authorization check.
      return await readBoundedFile(resolvedPath, limits.maxFileBytes);
    } catch (cause) {
      if (cause instanceof EducationImportServiceError) throw cause;
      throw new EducationImportServiceError(
        "education_import_source_unavailable",
        "The allowed source file is unavailable.",
        { status: 404, cause },
      );
    }
  }
  throw invalidInput("Provide file bytes, base64, or an explicitly allowed source path.");
}

function sniffFileKind(bytes) {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "webp";
  if (bytes.length >= 10 && /^GIF8[79]a$/u.test(bytes.subarray(0, 6).toString("ascii"))) return "gif";
  return null;
}

function parseImageDimensions(bytes, kind) {
  let dimensions = null;
  if (kind === "png" && bytes.length >= 24) {
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (kind === "gif" && bytes.length >= 10) {
    dimensions = { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  } else if (kind === "jpeg") {
    dimensions = parseJpegDimensions(bytes);
  } else if (kind === "webp") {
    dimensions = parseWebpDimensions(bytes);
  }
  if (
    !dimensions
    || !Number.isInteger(dimensions.width)
    || !Number.isInteger(dimensions.height)
    || dimensions.width <= 0
    || dimensions.height <= 0
  ) {
    throw new EducationImportServiceError(
      "education_import_image_invalid",
      "The image dimensions could not be read safely.",
      { status: 422 },
    );
  }
  return dimensions;
}

function parseJpegDimensions(bytes) {
  let offset = 2;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (sofMarkers.has(marker) && length >= 7) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function parseWebpDimensions(bytes) {
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    for (let offset = 20; offset + 10 <= bytes.length && offset < 64; offset += 1) {
      if (bytes[offset + 3] === 0x9d && bytes[offset + 4] === 0x01 && bytes[offset + 5] === 0x2a) {
        return {
          width: bytes.readUInt16LE(offset + 6) & 0x3fff,
          height: bytes.readUInt16LE(offset + 8) & 0x3fff,
        };
      }
    }
  }
  return null;
}

function parsePdfInfo(stdout) {
  const source = String(stdout || "");
  const pagesMatch = source.match(/^Pages:\s+(\d+)\s*$/imu);
  if (!pagesMatch) {
    throw new EducationImportServiceError(
      "education_import_pdf_metadata_invalid",
      "The PDF page count could not be read.",
      { status: 422 },
    );
  }
  const pageCount = Number(pagesMatch[1]);
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new EducationImportServiceError(
      "education_import_pdf_metadata_invalid",
      "The PDF contains no readable pages.",
      { status: 422 },
    );
  }
  const sizeMatch = source.match(/^Page size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts/imu);
  const width = Number(sizeMatch?.[1]) || 612;
  const height = Number(sizeMatch?.[2]) || 792;
  if (width <= 0 || height <= 0 || width > 20_000 || height > 20_000) {
    throw new EducationImportServiceError(
      "education_import_pdf_page_size_invalid",
      "The PDF page dimensions exceed the safe limit.",
      { status: 413 },
    );
  }
  return { pageCount, width, height };
}

function splitPdfText(stdout, pageCount) {
  const normalized = String(stdout || "").replace(/\r\n?/gu, "\n");
  const parts = normalized.split("\f");
  while (parts.length > pageCount && !parts.at(-1)?.trim()) parts.pop();
  const pages = parts.slice(0, pageCount);
  while (pages.length < pageCount) pages.push("");
  return pages;
}

async function invokeNativeTool({ runner, command, args, timeoutMs, maxBuffer, signal }) {
  if (signal?.aborted) throw abortedImportError();
  try {
    const result = await runner(command, args, { timeoutMs, maxBuffer, signal });
    if (typeof result === "string") return { stdout: result, stderr: "" };
    if (!result || typeof result !== "object") return { stdout: "", stderr: "" };
    return { stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
  } catch (cause) {
    if (signal?.aborted || cause?.name === "AbortError") throw abortedImportError();
    const missing = cause?.code === "ENOENT" || cause?.nativeToolCode === "ENOENT";
    throw new EducationImportServiceError(
      missing ? "education_import_native_tool_unavailable" : "education_import_native_tool_failed",
      missing
        ? "A required PDF processing tool is unavailable."
        : "Native PDF processing failed.",
      { status: missing ? 503 : 422, retryable: missing, cause },
    );
  }
}

function isSemanticModelConfigured(modelClient) {
  if (!modelClient || (
    typeof modelClient.extractStructured !== "function"
    && typeof modelClient.chatCompletion !== "function"
  )) return false;
  return !(
    typeof modelClient.configSummary === "function"
    && modelClient.configSummary()?.configured === false
  );
}

function ensureVisionAvailable(modelClient) {
  if (!modelClient || typeof modelClient.chatCompletion !== "function") {
    throw new EducationImportServiceError(
      "education_import_vision_unavailable",
      "Visual analysis is required but no Ark education model client is configured.",
      { status: 503, retryable: true },
    );
  }
  if (
    typeof modelClient.configSummary === "function"
    && modelClient.configSummary()?.configured === false
  ) {
    throw new EducationImportServiceError(
      "education_import_vision_unavailable",
      "Visual analysis is required but the Ark education model client is not configured.",
      { status: 503, retryable: true },
    );
  }
}

async function analyzeVisualPage({
  modelClient,
  imageBytes,
  mimeType,
  pageIndex,
  nativeText,
  documentHint,
  timeoutMs,
  signal,
}) {
  const nativeExcerpt = limitUtf8Text(nativeText, 16_000).trim();
  const pageContext = [
    `Page index: ${pageIndex}.`,
    `Document type hint: ${documentHint || "unknown"}.`,
    "Extract only content visibly present on this page.",
    "Separate printed, student-written, and teacher-mark layers.",
    "Use normalized [x,y,width,height] boxes from 0 to 1 when a reliable box is visible; otherwise null.",
    "Do not invent canonical knowledge point IDs, answers, identities, grades, or verification status.",
    nativeExcerpt ? `Native PDF text for corroboration:\n${nativeExcerpt}` : "No reliable native text is available.",
  ].join("\n");
  let response;
  try {
    response = await modelClient.chatCompletion({
      messages: [
        {
          role: "system",
          content: "You extract conservative, reviewable education document structure as JSON.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: pageContext },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${imageBytes.toString("base64")}`,
                detail: "high",
              },
            },
          ],
        },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "education_import_page",
          strict: true,
          schema: MODEL_PAGE_SCHEMA,
        },
      },
      temperature: 0,
      maxTokens: 16_384,
      timeoutMs,
      signal,
    });
  } catch (cause) {
    if (signal?.aborted || cause?.code === "ark_model_aborted") throw abortedImportError();
    throw new EducationImportServiceError(
      "education_import_vision_failed",
      "Ark visual analysis failed for an education document page.",
      { status: 502, retryable: cause?.retryable === true, cause },
    );
  }
  if (["length", "content_filter"].includes(response?.finishReason)) {
    throw new EducationImportServiceError(
      "education_import_vision_incomplete",
      "Ark visual analysis returned an incomplete page result.",
      { status: 502, retryable: response.finishReason === "length" },
    );
  }
  let raw;
  try {
    raw = JSON.parse(stripJsonFence(response?.text));
  } catch (cause) {
    throw new EducationImportServiceError(
      "education_import_vision_response_invalid",
      "Ark visual analysis returned invalid structured JSON.",
      { status: 502, retryable: true, cause },
    );
  }
  const shapeErrors = validateVisualResponseShape(raw);
  if (shapeErrors.length) {
    throw new EducationImportServiceError(
      "education_import_vision_response_invalid",
      "Ark visual analysis did not satisfy the required page schema.",
      { status: 502, retryable: true },
    );
  }
  return {
    data: normalizeVisualAnalysis(raw),
    receipt: {
      model: safeReceiptIdentifier(response?.model),
      request_id: safeReceiptIdentifier(response?.requestId),
      response_id: safeReceiptIdentifier(response?.id),
      usage: normalizeUsageReceipt(response?.usage),
    },
  };
}

function validateVisualResponseShape(raw) {
  const errors = [];
  const requireExactObject = (value, keys, path) => {
    if (!isPlainObject(value)) {
      errors.push(`${path}: object required`);
      return false;
    }
    const expected = new Set(keys);
    for (const key of keys) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${path}.${key}: unknown`);
    return true;
  };
  if (!requireExactObject(raw, ["document", "blocks", "questions", "warnings"], "$")) {
    return errors;
  }
  const documentKeys = ["document_type", "title", "language", "subject", "grade_band"];
  if (requireExactObject(raw.document, documentKeys, "$.document")) {
    for (const key of documentKeys) {
      if (raw.document[key] !== null && typeof raw.document[key] !== "string") {
        errors.push(`$.document.${key}: string or null required`);
      }
    }
  }
  if (!Array.isArray(raw.blocks) || raw.blocks.length > 400) {
    errors.push("$.blocks: bounded array required");
  } else {
    const blockKeys = [
      "type", "text", "normalized_text", "layer", "bbox", "confidence",
      "question_number", "option_label", "score_value", "max_score",
    ];
    raw.blocks.forEach((block, index) => {
      const path = `$.blocks[${index}]`;
      if (!requireExactObject(block, blockKeys, path)) return;
      if (!BLOCK_TYPE_SET.has(block.type)) errors.push(`${path}.type: invalid`);
      if (!["printed", "student", "teacher", "unknown"].includes(block.layer)) {
        errors.push(`${path}.layer: invalid`);
      }
      for (const key of ["text", "normalized_text", "question_number", "option_label"]) {
        if (block[key] !== null && typeof block[key] !== "string") {
          errors.push(`${path}.${key}: string or null required`);
        }
      }
      if (!Number.isFinite(block.confidence) || block.confidence < 0 || block.confidence > 1) {
        errors.push(`${path}.confidence: invalid`);
      }
      if (
        block.bbox !== null
        && (!Array.isArray(block.bbox)
          || block.bbox.length !== 4
          || !block.bbox.every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
      ) errors.push(`${path}.bbox: invalid`);
      for (const key of ["score_value", "max_score"]) {
        if (block[key] !== null && !Number.isFinite(block[key])) errors.push(`${path}.${key}: invalid`);
      }
    });
  }
  if (!Array.isArray(raw.questions) || raw.questions.length > 100) {
    errors.push("$.questions: bounded array required");
  } else {
    const questionKeys = [
      "local_id", "question_number", "question_type", "response_type", "stem", "options",
      "student_response", "selected_option_labels", "teacher_feedback", "score", "max_score",
      "confidence",
    ];
    raw.questions.forEach((question, index) => {
      const path = `$.questions[${index}]`;
      if (!requireExactObject(question, questionKeys, path)) return;
      for (const key of ["local_id", "question_number", "student_response", "teacher_feedback"]) {
        if (question[key] !== null && typeof question[key] !== "string") {
          errors.push(`${path}.${key}: string or null required`);
        }
      }
      for (const key of ["question_type", "response_type", "stem"]) {
        if (typeof question[key] !== "string") errors.push(`${path}.${key}: string required`);
      }
      if (!Array.isArray(question.options) || question.options.length > 20) {
        errors.push(`${path}.options: bounded array required`);
      } else {
        question.options.forEach((option, optionIndex) => {
          const optionPath = `${path}.options[${optionIndex}]`;
          if (!requireExactObject(option, ["label", "text"], optionPath)) return;
          if (typeof option.label !== "string" || typeof option.text !== "string") {
            errors.push(`${optionPath}: label and text strings required`);
          }
        });
      }
      if (
        !Array.isArray(question.selected_option_labels)
        || question.selected_option_labels.length > 20
        || !question.selected_option_labels.every((label) => typeof label === "string")
      ) errors.push(`${path}.selected_option_labels: bounded string array required`);
      for (const key of ["score", "max_score"]) {
        if (question[key] !== null && !Number.isFinite(question[key])) errors.push(`${path}.${key}: invalid`);
      }
      if (!Number.isFinite(question.confidence) || question.confidence < 0 || question.confidence > 1) {
        errors.push(`${path}.confidence: invalid`);
      }
    });
  }
  if (
    !Array.isArray(raw.warnings)
    || raw.warnings.length > 30
    || !raw.warnings.every((warning) => typeof warning === "string")
  ) errors.push("$.warnings: bounded string array required");
  return errors;
}

function normalizeVisualAnalysis(raw) {
  if (!isPlainObject(raw)) {
    throw new EducationImportServiceError(
      "education_import_vision_response_invalid",
      "Ark visual analysis returned an invalid page object.",
      { status: 502 },
    );
  }
  const document = isPlainObject(raw.document) ? {
    document_type: DOCUMENT_TYPE_SET.has(raw.document.document_type)
      ? raw.document.document_type
      : null,
    title: optionalModelText(raw.document.title, 500),
    language: optionalModelText(raw.document.language, 40),
    subject: optionalModelText(raw.document.subject, 120),
    grade_band: optionalModelText(raw.document.grade_band, 120),
  } : null;
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : [])
    .slice(0, 400)
    .map(normalizeVisualBlock)
    .filter(Boolean);
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .slice(0, 100)
    .map(normalizeVisualQuestion)
    .filter(Boolean);
  const warnings = (Array.isArray(raw.warnings) ? raw.warnings : [])
    .slice(0, 30)
    .map((warning) => optionalModelText(warning, 400))
    .filter(Boolean);
  return { document, blocks, questions, warnings };
}

function normalizeVisualBlock(block) {
  if (!isPlainObject(block) || !BLOCK_TYPE_SET.has(block.type)) return null;
  const text = optionalModelText(block.text, 50_000);
  if (isTextBlockType(block.type) && !text) return null;
  const bbox = normalizeModelBbox(block.bbox);
  return {
    type: block.type,
    text,
    normalized_text: optionalModelText(block.normalized_text, 50_000),
    layer: ["printed", "student", "teacher", "unknown"].includes(block.layer)
      ? block.layer
      : "unknown",
    bbox,
    confidence: boundedNumber(block.confidence, 0, 1, 0.6),
    question_number: optionalModelText(block.question_number, 40),
    option_label: optionalModelText(block.option_label, 12),
    score_value: optionalNonNegativeNumber(block.score_value),
    max_score: optionalPositiveNumber(block.max_score),
  };
}

function normalizeVisualQuestion(question) {
  if (!isPlainObject(question)) return null;
  const stem = optionalModelText(question.stem, 30_000);
  if (!stem) return null;
  const options = (Array.isArray(question.options) ? question.options : [])
    .slice(0, 20)
    .map((option) => ({
      label: optionalModelText(option?.label, 12),
      text: optionalModelText(option?.text, 6_000),
    }))
    .filter((option) => option.label && option.text);
  return {
    local_id: optionalModelText(question.local_id, 80),
    question_number: optionalModelText(question.question_number, 40),
    question_type: normalizeQuestionType(question.question_type),
    response_type: normalizeResponseType(question.response_type, options.length),
    stem,
    options,
    student_response: optionalModelText(question.student_response, 30_000),
    selected_option_labels: (Array.isArray(question.selected_option_labels)
      ? question.selected_option_labels
      : [])
      .slice(0, 20)
      .map((label) => optionalModelText(label, 12))
      .filter(Boolean),
    teacher_feedback: optionalModelText(question.teacher_feedback, 10_000),
    score: optionalNonNegativeNumber(question.score),
    max_score: optionalPositiveNumber(question.max_score),
    confidence: boundedNumber(question.confidence, 0, 1, 0.55),
  };
}

function assembleArtifacts(job, parsed, generatedAt, limits) {
  const visualHints = [...parsed.analyses.values()].map((analysis) => analysis.document).filter(Boolean);
  const allNativeText = parsed.pageTexts.join("\n");
  const documentType = chooseDocumentType(
    job.request.document_type,
    visualHints,
    job.source.file_name,
    allNativeText,
  );
  const identity = job.request.identity;
  const privateScope = VISUAL_DOCUMENT_TYPES.has(documentType)
    ? identity?.status === "resolved"
      ? `tenant:${identity.tenant_id}:learner:${identity.learner_id}`
      : `unresolved:${job.id}`
    : "shared";
  const hashKey = sha256(Buffer.from(
    `${job.source.sha256}\u0000${privateScope}`,
    "utf8",
  )).slice(0, 24);
  const documentId = `doc:${hashKey}`;
  const revisionId = `docrev:${hashKey}`;
  const pages = [];
  const pageBlockMaps = new Map();
  for (let pageIndex = 0; pageIndex < parsed.pageTexts.length; pageIndex += 1) {
    const asset = parsed.pageAssets[pageIndex];
    const nativeBlocks = createNativeBlocks({
      documentHash: hashKey,
      pageIndex,
      text: parsed.pageTexts[pageIndex],
      maxBlocks: limits.maxBlocksPerPage,
      documentType,
    });
    const analysis = parsed.analyses.get(pageIndex);
    const useAllVisualBlocks = parsed.kind === "image"
      || VISUAL_DOCUMENT_TYPES.has(documentType)
      || nonWhitespaceLength(parsed.pageTexts[pageIndex]) < limits.lowTextCharacters;
    const acceptedVisual = (analysis?.blocks || []).filter((block) =>
      useAllVisualBlocks
      || block.layer !== "printed"
      || ["image", "diagram", "teacher_mark", "student_response", "score"].includes(block.type)
    );
    let blocks = [...nativeBlocks];
    const visualCapacity = Math.max(
      0,
      limits.maxBlocksPerPage - blocks.length - (parsed.kind === "image" ? 1 : 0),
    );
    for (const shallowBlock of acceptedVisual.slice(0, visualCapacity)) {
      blocks.push(hydrateVisualBlock({
        shallowBlock,
        documentHash: hashKey,
        pageIndex,
        blockIndex: blocks.length,
        assetId: asset.id,
      }));
    }
    if (!blocks.length || parsed.kind === "image") {
      const imageBlock = {
        id: stableId("block", hashKey, String(pageIndex), "page-image"),
        type: "image",
        page_index: pageIndex,
        reading_order: 0,
        layer: "unknown",
        extraction: {
          method: parsed.analyses.has(pageIndex) ? "vlm" : "native_pdf",
          confidence: parsed.analyses.has(pageIndex) ? 0.9 : 1,
        },
        asset_id: asset.id,
      };
      blocks = parsed.kind === "image"
        ? [imageBlock, ...blocks].slice(0, limits.maxBlocksPerPage)
        : [imageBlock];
    }
    blocks.forEach((block, index) => {
      block.reading_order = index;
    });
    const width = parsed.kind === "pdf" ? parsed.pdfInfo.width : asset.width;
    const height = parsed.kind === "pdf" ? parsed.pdfInfo.height : asset.height;
    pages.push({
      index: pageIndex,
      width,
      height,
      unit: parsed.kind === "pdf" ? "pdf_points" : "pixels",
      blocks,
    });
    pageBlockMaps.set(pageIndex, blocks);
  }

  const firstBlock = pages.flatMap((page) => page.blocks).at(0);
  const firstAnchor = createAnchor({
    documentId,
    revisionId,
    pageIndex: firstBlock.page_index,
    blockIds: [firstBlock.id],
    quote: firstBlock.text,
    contentHash: job.source.sha256,
  });
  const method = parsed.kind === "image"
    ? "vlm"
    : parsed.analyses.size
      ? "hybrid"
      : "native_pdf";
  const title = job.request.title
    || visualHints.map((hint) => hint.title).find(Boolean)
    || titleFromFileName(job.source.file_name);
  const language = job.request.language
    || visualHints.map((hint) => hint.language).find(Boolean)
    || inferDocumentLanguage(allNativeText);
  const subject = job.request.subject
    || visualHints.map((hint) => hint.subject).find(Boolean)
    || undefined;
  const gradeBand = job.request.grade_band
    || visualHints.map((hint) => hint.grade_band).find(Boolean)
    || undefined;
  const needsReview = parsed.analyses.size > 0
    || documentType === "unknown"
    || VISUAL_DOCUMENT_TYPES.has(documentType);
  const document = {
    schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
    id: documentId,
    revision_id: revisionId,
    document_type: documentType,
    title,
    language,
    ...(subject ? { subject } : {}),
    ...(gradeBand ? { grade_band: gradeBand } : {}),
    source_file: {
      file_name: job.source.file_name,
      mime_type: job.source.mime_type,
      sha256: job.source.sha256,
      size_bytes: job.source.size_bytes,
    },
    pages,
    provenance: createProvenance(method, [firstAnchor], generatedAt),
    confidence: createConfidence({
      overall: method === "native_pdf" ? 0.86 : 0.72,
      extraction: method === "native_pdf" ? 0.94 : 0.75,
      sourceAlignment: method === "native_pdf" ? 0.94 : 0.78,
      layout: method === "native_pdf" ? 0.7 : 0.78,
      text: method === "native_pdf" ? 0.94 : 0.72,
    }),
    review_status: needsReview ? "needs_review" : "candidate",
  };

  const rejectedCandidates = [];
  const questions = [];
  const questionSources = [];
  for (const [pageIndex, analysis] of parsed.analyses.entries()) {
    const pageBlocks = pageBlockMaps.get(pageIndex) || [];
    const remainingQuestionCapacity = Math.max(0, limits.maxCandidates - questions.length);
    const pageQuestions = QUESTION_BEARING_DOCUMENT_TYPES.has(documentType)
      ? analysis.questions
      : [];
    pageQuestions.slice(0, remainingQuestionCapacity).forEach((rawQuestion, index) => {
      const anchorBlock = selectQuestionAnchor(pageBlocks, rawQuestion, index);
      const hydrated = hydrateQuestion({
        rawQuestion,
        document,
        pageIndex,
        index,
        anchorBlock,
        asset: parsed.pageAssets[pageIndex],
        generatedAt,
        method: parsed.kind === "pdf" ? "hybrid" : "vlm",
      });
      const validation = validateEducationImportContract("QuestionIR", hydrated);
      if (validation.valid) {
        questions.push(hydrated);
        questionSources.push({
          question: hydrated,
          rawQuestion,
          pageIndex,
          anchorBlock,
          privateAssetIds: [parsed.pageAssets[pageIndex].id],
        });
      } else {
        rejectedCandidates.push({
          contract_name: "QuestionIR",
          local_id: rawQuestion.local_id || null,
          page_index: pageIndex,
          errors: validation.errors.slice(0, 20),
        });
      }
    });
    if (pageQuestions.length > remainingQuestionCapacity) {
      rejectedCandidates.push({
        contract_name: "QuestionIR",
        local_id: null,
        page_index: pageIndex,
        errors: ["candidate limit exceeded"],
      });
    }
  }
  const visionQuestionPages = new Set(questionSources.map((source) => source.pageIndex));
  for (const nativeQuestion of deriveNativeQuestions(
    document,
    visionQuestionPages,
    generatedAt,
    parsed.pageAssets,
  )) {
    if (questions.length >= limits.maxCandidates) break;
    questions.push(nativeQuestion);
  }

  const curriculumStandards = deriveCurriculumCandidates(
    document,
    generatedAt,
    Math.max(0, limits.maxCandidates - questions.length),
  );
  const submissions = buildSubmissionCandidates({
    job,
    document,
    questionSources,
    generatedAt,
  });
  const warnings = [];
  for (const [pageIndex, analysis] of parsed.analyses.entries()) {
    analysis.warnings.forEach((message) => warnings.push({
      code: "model_page_warning",
      page_index: pageIndex,
      message,
    }));
  }
  if (PRIVATE_CONTENT_DOCUMENT_TYPES.has(documentType)) {
    warnings.push({
      code: "private_answer_contract_unavailable",
      page_index: null,
      message: "Answer and grading content remains in reviewable DocumentIR blocks because no private answer contract is available.",
    });
  }
  if (submissions.length) {
    warnings.push({
      code: "submission_mapping_requires_review",
      page_index: null,
      message: "Imported student responses are candidates only and cannot update mastery before identity, version, mapping, grading, and duplicate checks.",
    });
  }
  if (documentType === "unknown") {
    warnings.push({
      code: "document_type_unresolved",
      page_index: null,
      message: "The document type could not be resolved confidently.",
    });
  }

  const modelUsage = aggregateModelUsage(parsed.modelReceipts);
  const candidatePack = {
    schema_version: EDUCATION_IMPORT_CANDIDATE_PACK_SCHEMA_VERSION,
    job_id: job.id,
    document_id: document.id,
    document_revision_id: document.revision_id,
    generated_at: generatedAt,
    updated_at: generatedAt,
    processing_status: rejectedCandidates.length ? "partial" : "completed",
    review_status: needsReview || questions.length || curriculumStandards.length || submissions.length
      ? "needs_review"
      : "candidate",
    assets: parsed.pageAssets.map(publicAsset),
    candidates: {
      curriculum_standards: curriculumStandards,
      questions,
      submissions,
      typed_relations: [],
      question_knowledge_links: [],
      evidence: [],
    },
    rejected_candidates: rejectedCandidates,
    warnings,
    receipt: {
      native: {
        pdf_tools_used: parsed.kind === "pdf"
          ? ["pdfinfo", "pdftotext", "pdftoppm"]
          : [],
        page_count: pages.length,
        native_text_characters: parsed.pageTexts.reduce(
          (sum, text) => sum + nonWhitespaceLength(text),
          0,
        ),
      },
      model: {
        used: parsed.modelReceipts.length > 0,
        models: [...new Set(parsed.modelReceipts.map((receipt) => receipt.model).filter(Boolean))],
        request_ids: parsed.modelReceipts.map((receipt) => receipt.request_id).filter(Boolean),
        usage: modelUsage,
      },
    },
    review_history: [],
  };
  return { document, candidatePack };
}

function createNativeBlocks({ documentHash, pageIndex, text, maxBlocks, documentType }) {
  const normalized = String(text || "").replace(/[ \t]+$/gmu, "").trim();
  if (!normalized) return [];
  const paragraphs = segmentNativeText(normalized)
    .flatMap((paragraph) => splitLongText(paragraph.trim(), 48_000))
    .filter(Boolean)
    .slice(0, maxBlocks);
  return paragraphs.map((paragraph, index) => ({
    id: stableId("block", documentHash, String(pageIndex), `native-${index}`),
    type: classifyNativeBlock(paragraph, index, documentType),
    page_index: pageIndex,
    reading_order: index,
    text: paragraph,
    normalized_text: normalizeExtractedText(paragraph),
    layer: "printed",
    extraction: { method: "native_pdf", confidence: 0.96 },
  }));
}

function segmentNativeText(text) {
  const structuralLine = /^(?:(?:\d+|[\u4e00-\u9fff]{1,4})[.\u3001)\uff09]|[A-H][.\u3001)\uff09]|(?:\u7b54\u6848|\u53c2\u8003\u7b54\u6848|\u89e3\u6790|\u89e3\u7b54|\u8bc1\u660e)[:\uff1a])\s*/iu;
  return text.split(/\n\s*\n+/u).flatMap((paragraph) => {
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    const structuralCount = lines.filter((line) => structuralLine.test(line)).length;
    return lines.length > 1 && structuralCount >= 2 ? lines : [paragraph];
  });
}

function classifyNativeBlock(text, index, documentType = "unknown") {
  const compact = text.trim();
  if (["curriculum_standard", "exam_syllabus"].includes(documentType)) {
    if (/^(?:\d+(?:\.\d+)*|[\u4e00-\u9fff]{1,6})[.\u3001)\uff09]\s*/u.test(compact)) {
      return compact.length <= 120 ? "heading" : "list_item";
    }
    if (/^[A-H][.\u3001)\uff09]\s*/iu.test(compact)) return "list_item";
  }
  if (/^(?:\d+|[\u4e00-\u9fff]{1,4})[.\u3001)\uff09]\s*/u.test(compact)) return "question_stem";
  if (/^[A-H][.\u3001)\uff09]\s*/iu.test(compact)) return "question_option";
  if (/^(?:\u7b54\u6848|\u53c2\u8003\u7b54\u6848)[:\uff1a]/u.test(compact)) return "answer";
  if (/^(?:\u89e3\u6790|\u89e3\u7b54|\u8bc1\u660e)[:\uff1a]/u.test(compact)) return "solution";
  if (/^(?:\u7b2c.{1,20}[\u7ae0\u8282]|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+[\u3001.])\s*/u.test(compact)) return "heading";
  if (index === 0 && compact.length <= 80 && !/[\u3002\uff01\uff1f.!?]$/u.test(compact)) return "heading";
  if ((compact.match(/[=+\-\u00d7\u00f7\u221a\u2220\u2211\u222b]/gu) || []).length >= 3) return "formula";
  return "paragraph";
}

function hydrateVisualBlock({ shallowBlock, documentHash, pageIndex, blockIndex, assetId }) {
  const block = {
    id: stableId("block", documentHash, String(pageIndex), `visual-${blockIndex}`),
    type: shallowBlock.type,
    page_index: pageIndex,
    reading_order: blockIndex,
    layer: shallowBlock.layer,
    extraction: { method: "vlm", confidence: shallowBlock.confidence },
  };
  if (shallowBlock.text) block.text = shallowBlock.text;
  if (shallowBlock.normalized_text) block.normalized_text = shallowBlock.normalized_text;
  if (shallowBlock.bbox) block.bbox = shallowBlock.bbox;
  if (["image", "diagram"].includes(block.type)) block.asset_id = assetId;
  const annotations = {};
  if (shallowBlock.question_number) annotations.question_number = shallowBlock.question_number;
  if (shallowBlock.option_label) annotations.option_label = shallowBlock.option_label;
  if (shallowBlock.score_value !== null) annotations.score_value = shallowBlock.score_value;
  if (shallowBlock.max_score !== null) annotations.max_score = shallowBlock.max_score;
  if (Object.keys(annotations).length) block.annotations = annotations;
  return block;
}

function hydrateQuestion({
  rawQuestion,
  document,
  pageIndex,
  index,
  anchorBlock,
  asset,
  generatedAt,
  method,
}) {
  const questionId = stableId("question", document.revision_id, String(pageIndex), String(index), rawQuestion.local_id || "");
  const revisionId = stableId("qrev", questionId, rawQuestion.stem);
  const partId = stableId("qpart", questionId, "1");
  const anchor = createAnchor({
    documentId: document.id,
    revisionId: document.revision_id,
    pageIndex,
    blockIds: [anchorBlock.id],
    quote: rawQuestion.stem,
    contentHash: document.source_file.sha256,
  });
  const options = rawQuestion.options.map((option, optionIndex) => ({
    id: stableId("qoption", questionId, String(optionIndex), option.label),
    label: option.label,
    text: option.text,
  }));
  const responseType = normalizeResponseType(rawQuestion.response_type, options.length);
  const publicAssetIds = VISUAL_DOCUMENT_TYPES.has(document.document_type)
    ? []
    : [asset.id];
  return {
    schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
    id: questionId,
    revision_id: revisionId,
    privacy: "public_prompt",
    question_type: normalizeQuestionType(rawQuestion.question_type),
    language: document.language,
    stem: rawQuestion.stem,
    stimulus: null,
    parts: [{
      id: partId,
      ...(rawQuestion.question_number ? { label: rawQuestion.question_number } : {}),
      stem: rawQuestion.stem,
      response_type: responseType,
      options,
      asset_ids: publicAssetIds,
      source_anchor: anchor,
    }],
    asset_ids: publicAssetIds,
    task_features: {
      cognitive_process: "unspecified",
      proposition_angles: [],
    },
    source_anchor: anchor,
    provenance: createProvenance(method, [anchor], generatedAt),
    confidence: createConfidence({
      overall: rawQuestion.confidence,
      extraction: rawQuestion.confidence,
      sourceAlignment: Math.min(0.9, rawQuestion.confidence + 0.08),
    }),
    review_status: "needs_review",
  };
}

function selectQuestionAnchor(pageBlocks, rawQuestion, questionIndex) {
  const stems = pageBlocks.filter((block) => block.type === "question_stem");
  if (rawQuestion.question_number) {
    const numbered = stems.find((block) =>
      block.annotations?.question_number === rawQuestion.question_number
    );
    if (numbered) return numbered;
  }
  const normalizedStem = normalizeAnchorText(rawQuestion.stem);
  if (normalizedStem) {
    const textual = stems.find((block) => {
      const normalizedBlock = normalizeAnchorText(block.text || block.normalized_text);
      const needle = normalizedStem.slice(0, Math.min(40, normalizedStem.length));
      return normalizedBlock.includes(needle) || normalizedStem.includes(normalizedBlock);
    });
    if (textual) return textual;
  }
  return stems[questionIndex] || stems[0] || pageBlocks[0];
}

function normalizeAnchorText(value) {
  return String(value || "").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function deriveNativeQuestions(document, excludedPages, generatedAt, pageAssets) {
  if (!QUESTION_BEARING_DOCUMENT_TYPES.has(document.document_type)) return [];
  const candidates = [];
  for (const page of document.pages) {
    if (excludedPages.has(page.index)) continue;
    for (let index = 0; index < page.blocks.length; index += 1) {
      const block = page.blocks[index];
      if (block.type !== "question_stem" || !block.text) continue;
      const optionBlocks = [];
      for (let next = index + 1; next < page.blocks.length; next += 1) {
        if (page.blocks[next].type === "question_stem") break;
        if (page.blocks[next].type === "question_option") optionBlocks.push(page.blocks[next]);
      }
      const rawQuestion = {
        local_id: null,
        question_number: block.text.match(/^([^\s]{1,12})/u)?.[1] || null,
        question_type: optionBlocks.length >= 2 ? "single_choice" : "unknown",
        response_type: optionBlocks.length >= 2 ? "single_select" : "text",
        stem: block.text,
        options: optionBlocks.map((option, optionIndex) => ({
          label: option.text.match(/^([A-H])/iu)?.[1]?.toUpperCase() || String(optionIndex + 1),
          text: option.text.replace(/^[A-H][.\u3001)\uff09]\s*/iu, "").trim() || option.text,
        })),
        confidence: 0.68,
      };
      const asset = pageAssets[page.index];
      const candidate = hydrateQuestion({
        rawQuestion,
        document,
        pageIndex: page.index,
        index,
        anchorBlock: block,
        asset,
        generatedAt,
        method: "parsed_block",
      });
      assertQuestionIR(candidate);
      candidates.push(candidate);
    }
  }
  return candidates;
}

function deriveCurriculumCandidates(document, generatedAt, maximum = 400) {
  if (!["curriculum_standard", "exam_syllabus"].includes(document.document_type)) return [];
  if (maximum <= 0) return [];
  const candidates = [];
  for (const page of document.pages) {
    for (const block of page.blocks) {
      if (!block.text || !["paragraph", "list_item", "heading"].includes(block.type)) continue;
      if (block.text.length < 8 || block.text.length > 12_000) continue;
      const anchor = createAnchor({
        documentId: document.id,
        revisionId: document.revision_id,
        pageIndex: page.index,
        blockIds: [block.id],
        quote: block.text,
        contentHash: document.source_file.sha256,
      });
      const candidate = {
        schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
        id: stableId("curriculum", document.revision_id, block.id),
        revision_id: stableId("currev", document.revision_id, block.id, block.text),
        candidate_type: document.document_type === "curriculum_standard"
          ? "standard_clause"
          : "learning_objective",
        canonical_name: block.text.replace(/\s+/gu, " ").slice(0, 120),
        statement: block.text,
        knowledge_form: "unspecified",
        aliases: [],
        source_anchor: anchor,
        provenance: createProvenance("parsed_block", [anchor], generatedAt),
        confidence: createConfidence({ overall: 0.66, extraction: 0.9, sourceAlignment: 0.94 }),
        review_status: "needs_review",
      };
      assertCurriculumStandardCandidate(candidate);
      candidates.push(candidate);
      if (candidates.length >= Math.min(400, maximum)) return candidates;
    }
  }
  return candidates;
}

function buildSubmissionCandidates({ job, document, questionSources, generatedAt }) {
  if (!VISUAL_DOCUMENT_TYPES.has(document.document_type)) return [];
  const responses = [];
  const gradingEvents = [];
  for (const source of questionSources) {
    const part = source.question.parts[0];
    const selectedOptionIds = source.rawQuestion.selected_option_labels
      .map((label) => part.options.find((option) => option.label === label)?.id)
      .filter(Boolean);
    const hasResponse = Boolean(source.rawQuestion.student_response) || selectedOptionIds.length > 0;
    if (!hasResponse) continue;
    const anchor = source.question.source_anchor;
    responses.push({
      question_id: source.question.id,
      question_revision_id: source.question.revision_id,
      part_id: part.id,
      response_text: source.rawQuestion.student_response || null,
      selected_option_ids: selectedOptionIds,
      asset_ids: source.privateAssetIds || source.question.asset_ids,
      source_anchor: anchor,
    });
    if (
      source.rawQuestion.score !== null
      && source.rawQuestion.max_score !== null
      && source.rawQuestion.score <= source.rawQuestion.max_score
    ) {
      gradingEvents.push({
        question_id: source.question.id,
        part_id: part.id,
        score: source.rawQuestion.score,
        max_score: source.rawQuestion.max_score,
        is_final: false,
        grader_type: "imported",
        feedback: source.rawQuestion.teacher_feedback || null,
        source_anchor: anchor,
      });
    }
  }
  if (!responses.length) return [];
  const anchor = responses[0].source_anchor;
  const submissionId = stableId("submission", document.revision_id, "1");
  const submission = {
    schema_version: EDUCATION_IMPORT_SCHEMA_VERSION,
    id: submissionId,
    revision_id: stableId("subrev", submissionId, document.source_file.sha256),
    document_id: document.id,
    identity: clone(job.request.identity),
    attempt: {
      id: stableId("attempt", submissionId, "1"),
      opportunity_id: stableId("opportunity", document.id, "import"),
      session_id: null,
      submitted_at: null,
    },
    responses,
    grading_events: gradingEvents,
    assistance_level: "unknown",
    source_anchor: anchor,
    provenance: createProvenance("vlm", [anchor], generatedAt),
    confidence: createConfidence({ overall: 0.58, extraction: 0.68, sourceAlignment: 0.75 }),
    review_status: "needs_review",
  };
  assertSubmissionIR(submission);
  return [submission];
}

function makePageAsset({ job, pageIndex, mimeType, storageRef, bytes, dimensions }) {
  return {
    id: stableId("asset", job.id, job.source.sha256, String(pageIndex)),
    page_index: pageIndex,
    mime_type: mimeType,
    storage_ref: storageRef.split(sep).join("/"),
    sha256: sha256(bytes),
    size_bytes: bytes.length,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function publicAsset(asset) {
  return {
    id: asset.id,
    page_index: asset.page_index,
    mime_type: asset.mime_type,
    storage_ref: asset.storage_ref,
    sha256: asset.sha256,
    size_bytes: asset.size_bytes,
    width: asset.width,
    height: asset.height,
  };
}

function createAnchor({ documentId, revisionId, pageIndex, blockIds, quote, contentHash }) {
  return {
    document_id: documentId,
    document_revision_id: revisionId,
    page_index: pageIndex,
    block_ids: [...blockIds],
    ...(quote ? { quote: String(quote).slice(0, 4_000) } : {}),
    content_hash: contentHash,
  };
}

function createProvenance(method, sourceAnchors, recordedAt) {
  return {
    method,
    pipeline: { name: "education_import", version: "1.0" },
    source_anchors: clone(sourceAnchors),
    parent_ids: [],
    recorded_at: recordedAt,
  };
}

function createConfidence({ overall, extraction, sourceAlignment, layout, text }) {
  return {
    overall: boundedNumber(overall, 0, 1, 0.5),
    ...(layout === undefined ? {} : { layout: boundedNumber(layout, 0, 1, 0.5) }),
    ...(text === undefined ? {} : { text: boundedNumber(text, 0, 1, 0.5) }),
    extraction: boundedNumber(extraction, 0, 1, 0.5),
    source_alignment: boundedNumber(sourceAlignment, 0, 1, 0.5),
  };
}

function chooseDocumentType(requested, visualHints, fileName, text) {
  if (DOCUMENT_TYPE_SET.has(requested) && requested !== "unknown") return requested;
  const modelType = visualHints.map((hint) => hint.document_type).find((type) =>
    DOCUMENT_TYPE_SET.has(type) && type !== "unknown"
  );
  if (modelType) return modelType;
  const source = `${fileName}\n${text.slice(0, 20_000)}`;
  if (/\u5b66\u751f.*\u4f5c\u4e1a|\u4f5c\u4e1a.*\u5b66\u751f/u.test(source)) return "student_homework";
  if (/\u5b66\u751f.*(?:\u8bd5\u5377|\u8003\u8bd5)|(?:\u8bd5\u5377|\u8003\u8bd5).*\u5b66\u751f/u.test(source)) return "student_exam";
  if (/\u8bfe\u7a0b\u6807\u51c6|\u8bfe\u6807/u.test(source)) return "curriculum_standard";
  if (/\u8003\u8bd5\u5927\u7eb2|\u8003\u7eb2/u.test(source)) return "exam_syllabus";
  if (/\u7b54\u6848|answer[ _-]?key/iu.test(source)) return "answer_key";
  if (/\u6210\u7ee9\u5355|\u8bc4\u5206\u8868|grading/iu.test(source)) return "grading_sheet";
  if (/\u6559\u6750|textbook/iu.test(source)) return "textbook";
  if (/\u8bfe\u4ef6|courseware/iu.test(source)) return "courseware";
  if (/\u9898\u5e93|\u4e60\u9898\u96c6|question[ _-]?(?:bank|collection)/iu.test(source)) return "question_collection";
  if (/\u8bd5\u5377|\u8003\u8bd5|exam/iu.test(source)) return "exam_paper";
  if (/\u4f5c\u4e1a|homework/iu.test(source)) return "homework_template";
  return "unknown";
}

function validateCandidateAnchors(candidate, pageBlocks, errors, path, document) {
  const anchors = [];
  if (candidate?.source_anchor) anchors.push(candidate.source_anchor);
  if (Array.isArray(candidate?.provenance?.source_anchors)) {
    anchors.push(...candidate.provenance.source_anchors);
  }
  if (Array.isArray(candidate?.parts)) {
    for (const part of candidate.parts) if (part?.source_anchor) anchors.push(part.source_anchor);
  }
  if (Array.isArray(candidate?.responses)) {
    for (const response of candidate.responses) if (response?.source_anchor) anchors.push(response.source_anchor);
  }
  if (Array.isArray(candidate?.grading_events)) {
    for (const event of candidate.grading_events) if (event?.source_anchor) anchors.push(event.source_anchor);
  }
  anchors.forEach((anchor, index) => {
    if (document && anchor?.document_id !== document.id) {
      errors.push(`${path} anchor[${index}]: document id does not match`);
    }
    if (document && anchor?.document_revision_id !== document.revision_id) {
      errors.push(`${path} anchor[${index}]: document revision does not match`);
    }
    const ids = pageBlocks.get(anchor?.page_index);
    if (!ids) {
      errors.push(`${path} anchor[${index}]: page does not exist`);
      return;
    }
    for (const blockId of Array.isArray(anchor.block_ids) ? anchor.block_ids : []) {
      if (!ids.has(blockId)) errors.push(`${path} anchor[${index}]: block ${blockId} is not on the page`);
    }
  });
}

function collectNestedCandidateIds(candidate, allIds, errors, path) {
  const nested = [];
  if (Array.isArray(candidate?.parts)) {
    for (const [partIndex, part] of candidate.parts.entries()) {
      nested.push([part?.id, `${path}.parts[${partIndex}].id`]);
      for (const [optionIndex, option] of (part?.options || []).entries()) {
        nested.push([option?.id, `${path}.parts[${partIndex}].options[${optionIndex}].id`]);
      }
    }
  }
  if (candidate?.attempt?.id) nested.push([candidate.attempt.id, `${path}.attempt.id`]);
  for (const [id, idPath] of nested) {
    if (!id) continue;
    if (allIds.has(id)) errors.push(`${idPath}: duplicate global id`);
    allIds.add(id);
  }
}

function validateQuestionReferences(pack, assetIds, errors) {
  const questions = Array.isArray(pack?.candidates?.questions) ? pack.candidates.questions : [];
  for (const [index, question] of questions.entries()) {
    for (const assetId of Array.isArray(question.asset_ids) ? question.asset_ids : []) {
      if (!assetIds.has(assetId)) errors.push(`question[${index}].asset_ids: unknown asset ${assetId}`);
    }
    for (const [partIndex, part] of (question.parts || []).entries()) {
      for (const assetId of Array.isArray(part.asset_ids) ? part.asset_ids : []) {
        if (!assetIds.has(assetId)) {
          errors.push(`question[${index}].parts[${partIndex}].asset_ids: unknown asset ${assetId}`);
        }
      }
    }
  }
}

function validateSubmissionReferences(pack, assetIds, errors) {
  const questions = Array.isArray(pack?.candidates?.questions) ? pack.candidates.questions : [];
  const byId = new Map(questions.map((question) => [question.id, question]));
  const submissions = Array.isArray(pack?.candidates?.submissions) ? pack.candidates.submissions : [];
  for (const [index, submission] of submissions.entries()) {
    for (const response of submission.responses || []) {
      const question = byId.get(response.question_id);
      if (!question) {
        errors.push(`submission[${index}]: unknown question ${response.question_id}`);
        continue;
      }
      if (question.revision_id !== response.question_revision_id) {
        errors.push(`submission[${index}]: question revision mismatch`);
      }
      const part = question.parts.find((entry) => entry.id === response.part_id);
      if (!part) {
        errors.push(`submission[${index}]: unknown question part ${response.part_id}`);
        continue;
      }
      const optionIds = new Set(part.options.map((option) => option.id));
      for (const optionId of response.selected_option_ids || []) {
        if (!optionIds.has(optionId)) errors.push(`submission[${index}]: unknown selected option ${optionId}`);
      }
      for (const assetId of response.asset_ids || []) {
        if (!assetIds.has(assetId)) errors.push(`submission[${index}]: unknown response asset ${assetId}`);
      }
    }
    for (const event of submission.grading_events || []) {
      const question = byId.get(event.question_id);
      if (!question || !question.parts.some((part) => part.id === event.part_id)) {
        errors.push(`submission[${index}]: grading event references an unknown question part`);
      }
    }
  }
}

function applyReview({ document, pack, semanticArtifact = null, status, targetType, targetId }) {
  if (targetType === "pack") {
    if (targetId) throw invalidInput("target_id is not allowed for a pack review.");
    if (status === "verified" && pack.processing_status !== "completed") {
      throw new EducationImportServiceError(
        "education_import_review_gate_failed",
        "An incomplete candidate pack cannot be verified as a whole.",
        { status: 409 },
      );
    }
    if (
      status === "verified"
      && semanticArtifact
      && (
        semanticArtifact.status !== "succeeded"
        || semanticArtifact.review_queue.length > 0
      )
    ) {
      throw new EducationImportServiceError(
        "education_import_review_gate_failed",
        "A candidate pack with incomplete semantic compilation or unresolved semantic review items cannot be verified as a whole.",
        { status: 409 },
      );
    }
    for (const submission of pack.candidates?.submissions || []) {
      assertCandidateReviewGate(submission, status);
    }
    document.review_status = status;
    for (const collection of Object.values(pack.candidates || {})) {
      if (!Array.isArray(collection)) continue;
      for (const candidate of collection) candidate.review_status = status;
    }
    return;
  }
  if (targetType === "document") {
    if (targetId && targetId !== document.id) {
      throw new EducationImportServiceError(
        "education_import_review_target_not_found",
        "The review target was not found.",
        { status: 404 },
      );
    }
    document.review_status = status;
    return;
  }
  if (!targetId) throw invalidInput("target_id is required for candidate reviews.");
  const [collectionName] = CANDIDATE_COLLECTIONS[targetType] || [];
  const candidate = pack.candidates?.[collectionName]?.find((entry) => entry.id === targetId);
  if (!candidate) {
    throw new EducationImportServiceError(
      "education_import_review_target_not_found",
      "The review target was not found.",
      { status: 404 },
    );
  }
  assertCandidateReviewGate(candidate, status);
  candidate.review_status = status;
}

function assertCandidateReviewGate(candidate, status) {
  if (
    status === "verified"
    && candidate?.identity
    && candidate.identity.status !== "resolved"
  ) {
    throw new EducationImportServiceError(
      "education_import_review_gate_failed",
      "A candidate with unresolved identity cannot be verified.",
      { status: 409 },
    );
  }
}

function derivePackReviewStatus(document, pack) {
  const statuses = [document.review_status];
  for (const collection of Object.values(pack.candidates || {})) {
    if (!Array.isArray(collection)) continue;
    statuses.push(...collection.map((candidate) => candidate.review_status));
  }
  if (statuses.every((status) => status === "verified")) return "verified";
  if (statuses.every((status) => status === "rejected")) return "rejected";
  return "needs_review";
}

function publicJob(job) {
  return clone({
    schema_version: job.schema_version,
    id: job.id,
    status: job.status,
    phase: job.phase,
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    source: {
      file_name: job.source.file_name,
      mime_type: job.source.mime_type,
      sha256: job.source.sha256,
      size_bytes: job.source.size_bytes,
    },
    request: {
      document_type: job.request.document_type,
      title: job.request.title,
      language: job.request.language,
      subject: job.request.subject,
      grade_band: job.request.grade_band,
      identity_status: job.request.identity?.status || "unresolved",
    },
    progress: job.progress,
    result: job.result,
    review: job.review,
    error: job.error,
  });
}

function validateSemanticArtifact(value, document) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.schema_version !== "education-semantic-artifact@1.0") return false;
  if (value.document_id !== document.id || value.document_revision_id !== document.revision_id) {
    return false;
  }
  if (!["succeeded", "partial", "failed"].includes(value.status)) return false;
  if (!Number.isInteger(value.batch_count) || value.batch_count < 1) return false;
  if (
    "partial_batch_count" in value
    && (
      !Number.isInteger(value.partial_batch_count)
      || value.partial_batch_count < 0
      || value.partial_batch_count > value.batch_count
    )
  ) return false;
  if (!Array.isArray(value.batches) || value.batches.length !== value.batch_count) return false;
  if (!Array.isArray(value.failed_batches) || !Array.isArray(value.review_queue)) return false;
  if (!Array.isArray(value.warnings) || !Array.isArray(value.model_receipts)) return false;
  if (!value.extensions || typeof value.extensions !== "object" || Array.isArray(value.extensions)) {
    return false;
  }
  if (!Object.values(value.extensions).every(Array.isArray)) return false;
  const cardProposals = value.extensions.knowledge_card_proposals;
  if (cardProposals && !cardProposals.every(validateEducationCardTemplateProposal)) return false;
  if (value.card_generation !== undefined) {
    const generation = value.card_generation;
    if (!generation || typeof generation !== "object" || Array.isArray(generation)) return false;
    if (generation.schema_version !== "education-import-card-generation@1.0") return false;
    if (generation.status !== "proposed_for_review") return false;
    if (generation.publication_boundary !== "human_review_required") return false;
    if (generation.proposal_count !== (cardProposals?.length || 0)) return false;
    if (generation.bounded_template_count !== (cardProposals || [])
      .filter((item) => item.renderability === "bounded_template_match").length) return false;
  }
  if (!value.proposal_id_map || typeof value.proposal_id_map !== "object" || Array.isArray(value.proposal_id_map)) {
    return false;
  }
  return value.failed_batches.every((batch) =>
    batch && typeof batch === "object" && Number.isInteger(batch.batch_index)
  );
}

async function readJsonArtifact(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new EducationImportServiceError(
      "education_import_artifact_unavailable",
      `The persisted ${label} is unavailable.`,
      { status: 500, cause },
    );
  }
}

async function atomicWriteJson(path, value) {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, path);
}

function normalizeProcessingError(error, timedOut) {
  if (timedOut || error?.code === "education_import_aborted") {
    return new EducationImportServiceError(
      "education_import_job_timeout",
      "The education import exceeded its processing deadline.",
      { status: 504, retryable: true },
    );
  }
  if (error instanceof EducationImportServiceError) return error;
  return new EducationImportServiceError(
    "education_import_processing_failed",
    "The education import could not be processed.",
    { status: 500, retryable: false, cause: error },
  );
}

function abortedImportError() {
  return new EducationImportServiceError(
    "education_import_aborted",
    "The education import was aborted.",
    { status: 499, retryable: true },
  );
}

function normalizeLimits(overrides) {
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_EDUCATION_IMPORT_LIMITS)) {
    const value = Number(overrides?.[key]);
    result[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }
  result.maxConcurrentJobs = Math.min(result.maxConcurrentJobs, 8);
  result.maxPendingJobs = Math.max(result.maxPendingJobs, result.maxConcurrentJobs);
  result.maxPages = Math.min(result.maxPages, 1_000);
  result.maxVisionPages = Math.min(result.maxVisionPages, result.maxPages);
  result.semanticBatchPages = Math.min(result.semanticBatchPages, result.maxPages);
  result.maxSemanticBatches = Math.min(result.maxSemanticBatches, 64);
  result.modelRequestTimeoutMs = Math.max(100, Math.min(result.modelRequestTimeoutMs, 10 * 60_000));
  result.nativeToolTimeoutMs = Math.max(100, Math.min(result.nativeToolTimeoutMs, 10 * 60_000));
  result.jobTimeoutMs = Math.max(1_000, Math.min(result.jobTimeoutMs, 60 * 60_000));
  return Object.freeze(result);
}

function makeSemanticBatchDescriptors(pages, batchSize) {
  const descriptors = [];
  for (let offset = 0; offset < pages.length; offset += batchSize) {
    const batchPages = pages.slice(offset, offset + batchSize);
    const batchIndex = descriptors.length + 1;
    const pageIndexes = batchPages.map((page) => page.index);
    descriptors.push({
      batch_index: batchIndex,
      id_namespace: `semantic-batch-${String(batchIndex).padStart(4, "0")}`,
      page_indexes: pageIndexes,
      page_start_index: pageIndexes[0],
      page_end_index: pageIndexes.at(-1),
      page_count: pageIndexes.length,
    });
  }
  return descriptors;
}

function filterCandidatePackForSemanticBatch(candidatePack, pageIndexes) {
  const curriculum = (candidatePack.candidates?.curriculum_standards || []).filter((candidate) =>
    pageIndexes.has(candidate.source_anchor?.page_index)
  );
  const questions = (candidatePack.candidates?.questions || []).flatMap((question) => {
    const parts = (question.parts || []).filter((part) =>
      pageIndexes.has(part.source_anchor?.page_index)
    );
    if (!parts.length) return [];
    return [{ ...question, parts }];
  });
  return {
    document_id: candidatePack.document_id,
    document_revision_id: candidatePack.document_revision_id,
    candidates: {
      curriculum_standards: curriculum,
      questions,
    },
  };
}

function emptySemanticExtensions() {
  return {
    assessment_dimensions: [],
    solution_strategies: [],
    proposition_angles: [],
    misconceptions: [],
    relation_proposals: [],
  };
}

function appendSemanticExtensions(target, source) {
  for (const key of Object.keys(target)) {
    const seen = new Set(target[key].map((value) => value?.id).filter(Boolean));
    for (const value of Array.isArray(source?.[key]) ? source[key] : []) {
      if (value?.id && seen.has(value.id)) continue;
      target[key].push(value);
      if (value?.id) seen.add(value.id);
    }
  }
}

function countSemanticCandidates(candidates) {
  return Object.fromEntries(Object.entries(candidates || {}).map(([key, values]) => [
    key,
    Array.isArray(values) ? values.length : 0,
  ]));
}

function countSemanticExtensions(extensions) {
  return Object.values(extensions || {}).reduce(
    (sum, values) => sum + (Array.isArray(values) ? values.length : 0),
    0,
  );
}

function safeSemanticFailureCode(error) {
  const code = typeof error?.code === "string" ? error.code : "education_semantic_batch_failed";
  return CONTRACT_ID_PATTERN.test(code) ? code.slice(0, 128) : "education_semantic_batch_failed";
}

function stripBatchReceiptMetadata(receipt) {
  const { batch_index: _batchIndex, id_namespace: _idNamespace, ...modelReceipt } = receipt;
  return modelReceipt;
}

function appendCandidatePackWarning(candidatePack, warning) {
  if (!Array.isArray(candidatePack.warnings)) candidatePack.warnings = [];
  const duplicate = candidatePack.warnings.some((existing) =>
    existing.code === warning.code && existing.page_index === warning.page_index
  );
  if (!duplicate) candidatePack.warnings.push(warning);
}

function normalizeToolCommand(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || value.includes("\0") || value.length > 1_024) {
    throw invalidInput("PDF tool commands must be safe strings.");
  }
  return value;
}

function allocateJobId(jobs, idFactory) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const raw = String(idFactory());
    const normalized = raw.toLowerCase().replace(/[^a-f0-9-]/gu, "").slice(0, 80);
    const suffix = /^[a-f0-9-]{8,80}$/u.test(normalized)
      ? normalized
      : sha256(Buffer.from(`${raw}\u0000${attempt}`, "utf8")).slice(0, 32);
    const id = `import-${suffix}`;
    if (JOB_ID_PATTERN.test(id) && !jobs.has(id)) return id;
  }
  const fallback = `import-${randomUUID()}`;
  if (!jobs.has(fallback)) return fallback;
  throw new EducationImportServiceError(
    "education_import_id_allocation_failed",
    "An education import job identifier could not be allocated.",
    { status: 500 },
  );
}

function normalizeJobId(value) {
  if (typeof value !== "string" || !JOB_ID_PATTERN.test(value)) {
    throw invalidInput("The education import job id is invalid.");
  }
  return value;
}

function normalizeJobStatus(value) {
  if (!EDUCATION_IMPORT_JOB_STATUSES.includes(value)) {
    throw invalidInput("The education import status is invalid.");
  }
  return value;
}

function normalizeReviewStatus(value) {
  if (!REVIEW_STATUS_SET.has(value)) throw invalidInput("The review status is invalid.");
  return value;
}

function normalizeReviewTarget(value) {
  const target = String(value || "").trim();
  if (!["pack", "document", ...Object.keys(CANDIDATE_COLLECTIONS)].includes(target)) {
    throw invalidInput("The review target type is invalid.");
  }
  return target;
}

function normalizeDocumentType(value) {
  if (!DOCUMENT_TYPE_SET.has(value)) throw invalidInput("The document type is invalid.");
  return value;
}

function normalizeMime(value) {
  if (value === undefined || value === null || value === "") return "";
  return String(value).split(";", 1)[0].trim().toLowerCase();
}

function sanitizeFileName(value, fallbackExtension) {
  const cleaned = basename(String(value || ""))
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 240);
  return cleaned || `upload${fallbackExtension}`;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw invalidInput(`${field} must be text.`);
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw invalidInput(`${field} must contain between 1 and ${maxLength} characters.`);
  }
  return result;
}

function optionalImportText(value, field, maxLength) {
  return optionalText(
    typeof value === "string" ? repairUtf8Mojibake(value) : value,
    field,
    maxLength,
  );
}

function repairPersistedJobMetadata(job) {
  let changed = false;
  changed = repairObjectString(job.source, "file_name") || changed;
  for (const key of ["title", "language", "subject", "grade_band"]) {
    changed = repairObjectString(job.request, key) || changed;
  }
  return changed;
}

async function repairPersistedDocumentMetadata(path) {
  let document;
  try {
    document = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return false;
  }
  let changed = repairObjectString(document.source_file, "file_name");
  for (const key of ["title", "language", "subject", "grade_band"]) {
    changed = repairObjectString(document, key) || changed;
  }
  if (changed) await atomicWriteJson(path, document);
  return changed;
}

function repairObjectString(target, key) {
  if (!isPlainObject(target) || typeof target[key] !== "string") return false;
  const repaired = repairUtf8Mojibake(target[key]);
  if (repaired === target[key]) return false;
  target[key] = repaired;
  return true;
}

function optionalIdentifier(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !CONTRACT_ID_PATTERN.test(value)) {
    throw invalidInput(`${field} is invalid.`);
  }
  return value;
}

function optionalModelText(value, maxLength) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result ? result.slice(0, maxLength) : null;
}

function normalizeModelBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [x, y, width, height] = value.map(Number);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x > 1 || y > 1 || width > 1 || height > 1 || x + width > 1.000001 || y + height > 1.000001) {
    return null;
  }
  return { x, y, width, height, unit: "normalized" };
}

function normalizeQuestionType(value) {
  const allowed = new Set([
    "single_choice", "multiple_choice", "true_false", "fill_blank", "short_answer",
    "calculation", "proof", "essay", "composite", "unknown",
  ]);
  return allowed.has(value) ? value : "unknown";
}

function normalizeResponseType(value, optionCount) {
  const allowed = new Set([
    "single_select", "multi_select", "boolean", "text", "number",
    "expression", "workings", "essay", "unknown",
  ]);
  const result = allowed.has(value) ? value : "unknown";
  if (["single_select", "multi_select"].includes(result) && optionCount < 2) return "text";
  return result;
}

function isTextBlockType(type) {
  return !["table", "image", "diagram"].includes(type);
}

function normalizeExtractedText(text) {
  return String(text).replace(/[ \t]+/gu, " ").replace(/\n{3,}/gu, "\n\n").trim();
}

function splitLongText(text, maximum) {
  if (text.length <= maximum) return [text];
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += maximum) {
    chunks.push(text.slice(offset, offset + maximum));
  }
  return chunks;
}

function limitUtf8Text(value, maxBytes) {
  const source = String(value || "");
  if (Buffer.byteLength(source, "utf8") <= maxBytes) return source;
  let lower = 0;
  let upper = source.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (Buffer.byteLength(source.slice(0, middle), "utf8") <= maxBytes) lower = middle;
    else upper = middle - 1;
  }
  return source.slice(0, lower);
}

function nonWhitespaceLength(value) {
  return String(value || "").replace(/\s/gu, "").length;
}

function stableId(prefix, ...parts) {
  const digest = sha256(Buffer.from(parts.join("\u0000"), "utf8")).slice(0, 24);
  return `${prefix}:${digest}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function titleFromFileName(fileName) {
  const title = basename(fileName, extname(fileName)).trim();
  return title.slice(0, 500) || "Imported education document";
}

function inferDocumentLanguage(text) {
  const sample = String(text || "").slice(0, 20_000);
  const cjkCharacters = (sample.match(/[\u3400-\u9fff]/gu) || []).length;
  const latinCharacters = (sample.match(/[A-Za-z]/gu) || []).length;
  return latinCharacters > Math.max(20, cjkCharacters * 2) ? "en" : "zh-CN";
}

function isoNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new EducationImportServiceError(
      "education_import_clock_invalid",
      "The education import clock returned an invalid value.",
      { status: 500 },
    );
  }
  return date.toISOString();
}

function isUtcIso(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isSafeStorageRef(value) {
  if (!value || isAbsolute(value) || value.includes("\0")) return false;
  const normalized = value.replace(/\\/gu, "/");
  return !normalized.split("/").includes("..");
}

function isWithinRoot(path, root) {
  const relation = relative(root, path);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

function isPersistedJob(job, directoryName) {
  return isPlainObject(job)
    && job.schema_version === EDUCATION_IMPORT_JOB_SCHEMA_VERSION
    && job.id === directoryName
    && JOB_ID_PATTERN.test(job.id)
    && EDUCATION_IMPORT_JOB_STATUSES.includes(job.status)
    && isPlainObject(job.source)
    && typeof job.source.stored_file_name === "string"
    && basename(job.source.stored_file_name) === job.source.stored_file_name;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function invalidInput(message) {
  return new EducationImportServiceError(
    "education_import_invalid_request",
    message,
    { status: 400 },
  );
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function optionalNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function optionalPositiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeUsageReceipt(usage) {
  if (!isPlainObject(usage)) return null;
  const result = {};
  for (const key of [
    "prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens",
  ]) {
    if (Number.isInteger(usage[key]) && usage[key] >= 0) result[key] = usage[key];
  }
  return Object.keys(result).length ? result : null;
}

function aggregateModelUsage(receipts) {
  const result = {};
  for (const receipt of receipts) {
    for (const [key, value] of Object.entries(receipt.usage || {})) {
      result[key] = (result[key] || 0) + value;
    }
  }
  return Object.keys(result).length ? result : null;
}

function safeReceiptIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,191}$/u.test(value)
    ? value
    : null;
}

function stripJsonFence(value) {
  const source = String(value || "").trim();
  const match = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match ? match[1] : source;
}

function hasExactObjectKeys(value, keys, errors, path) {
  if (!isPlainObject(value)) {
    errors.push(`${path}: must be an object`);
    return false;
  }
  const expected = new Set(keys);
  for (const key of keys) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: is required`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${path}.${key}: is not allowed`);
  return true;
}

function validateRejectedCandidates(values, errors) {
  if (!Array.isArray(values)) {
    errors.push("$pack.rejected_candidates: must be an array");
    return;
  }
  values.forEach((value, index) => {
    const path = `$pack.rejected_candidates[${index}]`;
    if (!hasExactObjectKeys(value, ["contract_name", "local_id", "page_index", "errors"], errors, path)) return;
    if (typeof value.contract_name !== "string" || !value.contract_name) errors.push(`${path}.contract_name: is invalid`);
    if (value.local_id !== null && typeof value.local_id !== "string") errors.push(`${path}.local_id: is invalid`);
    if (!Number.isInteger(value.page_index) || value.page_index < 0) errors.push(`${path}.page_index: is invalid`);
    if (!Array.isArray(value.errors) || !value.errors.every((item) => typeof item === "string")) {
      errors.push(`${path}.errors: must be a string array`);
    }
  });
}

function validatePackWarnings(values, pageBlocks, errors) {
  if (!Array.isArray(values)) {
    errors.push("$pack.warnings: must be an array");
    return;
  }
  values.forEach((value, index) => {
    const path = `$pack.warnings[${index}]`;
    if (!hasExactObjectKeys(value, ["code", "page_index", "message"], errors, path)) return;
    if (typeof value.code !== "string" || !CONTRACT_ID_PATTERN.test(value.code)) errors.push(`${path}.code: is invalid`);
    if (value.page_index !== null && (!Number.isInteger(value.page_index) || !pageBlocks.has(value.page_index))) {
      errors.push(`${path}.page_index: is invalid`);
    }
    if (typeof value.message !== "string" || !value.message.trim() || value.message.length > 2_000) {
      errors.push(`${path}.message: is invalid`);
    }
  });
}

function validateReviewHistory(values, errors) {
  if (!Array.isArray(values)) {
    errors.push("$pack.review_history: must be an array");
    return;
  }
  values.forEach((value, index) => {
    const path = `$pack.review_history[${index}]`;
    if (!hasExactObjectKeys(value, [
      "id", "target_type", "target_id", "status", "reviewer_id", "note", "reviewed_at",
    ], errors, path)) return;
    if (!CONTRACT_ID_PATTERN.test(value.id || "")) errors.push(`${path}.id: is invalid`);
    if (!["pack", "document", ...Object.keys(CANDIDATE_COLLECTIONS)].includes(value.target_type)) {
      errors.push(`${path}.target_type: is invalid`);
    }
    for (const key of ["target_id", "reviewer_id"]) {
      if (value[key] !== null && !CONTRACT_ID_PATTERN.test(value[key] || "")) errors.push(`${path}.${key}: is invalid`);
    }
    if (value.note !== null && (typeof value.note !== "string" || value.note.length > 2_000)) {
      errors.push(`${path}.note: is invalid`);
    }
    if (!REVIEW_STATUS_SET.has(value.status)) errors.push(`${path}.status: is invalid`);
    if (!isUtcIso(value.reviewed_at)) errors.push(`${path}.reviewed_at: is invalid`);
  });
}

function validatePackReceipt(receipt, errors) {
  if (!hasExactObjectKeys(receipt, ["native", "model"], errors, "$pack.receipt")) return;
  if (hasExactObjectKeys(
    receipt.native,
    ["pdf_tools_used", "page_count", "native_text_characters"],
    errors,
    "$pack.receipt.native",
  )) {
    if (!Array.isArray(receipt.native.pdf_tools_used)
      || !receipt.native.pdf_tools_used.every((tool) => ["pdfinfo", "pdftotext", "pdftoppm"].includes(tool))) {
      errors.push("$pack.receipt.native.pdf_tools_used: is invalid");
    }
    for (const key of ["page_count", "native_text_characters"]) {
      if (!Number.isInteger(receipt.native[key]) || receipt.native[key] < 0) {
        errors.push(`$pack.receipt.native.${key}: is invalid`);
      }
    }
  }
  if (hasExactObjectKeys(
    receipt.model,
    ["used", "models", "request_ids", "usage"],
    errors,
    "$pack.receipt.model",
  )) {
    if (typeof receipt.model.used !== "boolean") errors.push("$pack.receipt.model.used: is invalid");
    for (const key of ["models", "request_ids"]) {
      if (!Array.isArray(receipt.model[key])
        || !receipt.model[key].every((item) => typeof item === "string" && item.length <= 192)) {
        errors.push(`$pack.receipt.model.${key}: is invalid`);
      }
    }
    if (receipt.model.usage !== null) {
      if (!isPlainObject(receipt.model.usage)
        || !Object.values(receipt.model.usage).every((value) => Number.isInteger(value) && value >= 0)) {
        errors.push("$pack.receipt.model.usage: is invalid");
      }
    }
  }
}

function countCandidates(pack) {
  const result = {};
  for (const [name, values] of Object.entries(pack.candidates || {})) {
    result[name] = Array.isArray(values) ? values.length : 0;
  }
  return result;
}

async function withPromiseLock(map, key, task) {
  const previous = map.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  map.set(key, current);
  try {
    return await current;
  } finally {
    if (map.get(key) === current) map.delete(key);
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
