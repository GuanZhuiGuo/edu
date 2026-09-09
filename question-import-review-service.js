import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { QUESTION_TYPES } from "./education-import-contracts.js";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_IMPORT_STORAGE_DIR = join(moduleDir, "data", "education-imports");
const DEFAULT_ARTIFACT_CATALOG_PATH = join(
  moduleDir,
  "public",
  "data",
  "junior-math-visual-artifacts.json",
);
const REVIEW_SCHEMA_VERSION = "question-import-review@1.0";
const REVIEW_FILE_NAME = "question-review.json";
const REVIEW_STATUSES = new Set(["accept", "reject", "needs_edit"]);
const ACCEPTABLE_QUESTION_TYPES = new Set(QUESTION_TYPES.filter((value) => value !== "unknown"));
const DIFFICULTIES = new Set(["foundation", "standard", "advanced"]);
const ID_PATTERN = /^[\p{L}\p{N}_.:@/+~-]{1,200}$/u;
const MAX_BATCH_SIZE = 200;

export class QuestionImportReviewError extends Error {
  constructor(code, message, { status = 422, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "QuestionImportReviewError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Human review and publication boundary for question-bearing imports.
 *
 * Parsed/model output remains a proposal. Only a reviewer can map a question
 * to a canonical knowledge-point ID, confirm its assessment attributes and
 * choose a trusted local card (or explicitly mark the card as pending). The
 * service persists immutable source anchors beside every decision and publishes
 * through the authoritative SQLite question store using a public/private split.
 */
export function createQuestionImportReviewService({
  importService,
  dataStore,
  defaultTenantId = "",
  defaultOntologyId = "junior-math-moe-2022",
  defaultOntologyVersion = "",
  importStorageDir = DEFAULT_IMPORT_STORAGE_DIR,
  artifactCatalogPath = DEFAULT_ARTIFACT_CATALOG_PATH,
  now = () => new Date(),
  idFactory = randomUUID,
} = {}) {
  if (!importService || typeof importService.get !== "function") {
    throw new TypeError("importService.get is required");
  }
  if (!dataStore
    || typeof dataStore.listKnowledgePoints !== "function"
    || typeof dataStore.importQuestionBank !== "function") {
    throw new TypeError("dataStore question publication methods are required");
  }

  const storageRoot = resolve(importStorageDir);
  const locks = new Map();
  let artifactCatalogPromise = null;

  async function getReview(jobId, input = {}) {
    const context = await loadContext(jobId, input);
    const persisted = await readReviewArtifact(context.job.id);
    return buildReceipt(context, persisted);
  }

  async function reviewBatch(jobId, input = {}) {
    const decisions = normalizeDecisionBatch(input.decisions);
    if (!decisions.length) {
      throw invalid("question_review_empty_batch", "请至少选择一道题目进行审核");
    }
    const tenantId = safeId(input.tenant_id || defaultTenantId, "tenant_id");
    const reviewerId = safeId(input.reviewer_id || "local-reviewer", "reviewer_id");
    return withLock(locks, jobId, async () => {
      const context = await loadContext(jobId, {
        ...input,
        tenant_id: tenantId,
      });
      const review = await readReviewArtifact(context.job.id)
        || createReviewArtifact(context, isoNow(now));
      assertExpectedRevision(review, input.expected_revision);
      const byCandidateId = new Map(review.items.map((item) => [item.candidate_id, item]));
      const reviewedAt = isoNow(now);

      for (const decision of decisions) {
        const candidate = context.candidateById.get(decision.candidate_id);
        if (!candidate) {
          throw new QuestionImportReviewError(
            "question_review_candidate_not_found",
            `未找到候选题 ${decision.candidate_id}`,
            { status: 404 },
          );
        }
        const previous = byCandidateId.get(decision.candidate_id)
          || createReviewItem(candidate);
        if (previous.publication?.status === "published") {
          throw new QuestionImportReviewError(
            "question_review_already_published",
            `题目 ${decision.candidate_id} 已发布；如需修改，请重新导入并发布新版本`,
            { status: 409 },
          );
        }
        const next = await applyDecision({
          decision,
          previous,
          candidate,
          context,
          reviewerId,
          reviewedAt,
        });
        byCandidateId.set(decision.candidate_id, next);
      }

      review.items = context.candidates.map((candidate) =>
        byCandidateId.get(candidate.id) || createReviewItem(candidate));
      review.revision += 1;
      review.updated_at = reviewedAt;
      await writeReviewArtifact(context.job.id, review);
      return buildReceipt(context, review);
    });
  }

  async function publish(jobId, input = {}) {
    const tenantId = safeId(input.tenant_id || defaultTenantId, "tenant_id");
    const reviewerId = safeId(input.reviewer_id || "local-reviewer", "reviewer_id");
    return withLock(locks, jobId, async () => {
      const context = await loadContext(jobId, {
        ...input,
        tenant_id: tenantId,
      });
      const review = await readReviewArtifact(context.job.id);
      if (!review) {
        throw new QuestionImportReviewError(
          "question_review_required",
          "请先完成人工题目审核",
          { status: 409 },
        );
      }
      const accepted = review.items.filter((item) => item.status === "accept");
      if (!accepted.length) {
        throw new QuestionImportReviewError(
          "question_review_no_accepted_items",
          "没有可发布的已接受题目",
          { status: 409 },
        );
      }
      const unpublishedAccepted = accepted.filter(
        (item) => item.publication?.status !== "published",
      );
      if (!unpublishedAccepted.length) {
        const latestPublication = [...review.publication_history]
          .reverse()
          .find((entry) => entry.status === "published");
        if (!latestPublication) {
          throw new QuestionImportReviewError(
            "question_review_publication_state_invalid",
            "题目已标记发布，但缺少可验证的发布记录",
            { status: 500 },
          );
        }
        return {
          schema_version: "question-import-publication-receipt@1.0",
          idempotent: true,
          ...latestPublication,
          skipped_published_count: accepted.length,
          cumulative_published_count: accepted.length,
          review: buildReceipt(context, review),
        };
      }
      assertExpectedRevision(review, input.expected_revision);
      for (const item of unpublishedAccepted) {
        await validateAcceptedReviewItem(item, context);
      }

      const fingerprint = contentHash({
        job_id: context.job.id,
        document_revision_id: context.job.document_ir?.revision_id || "",
        accepted: unpublishedAccepted.map(publicationFingerprintItem),
      });
      const existing = review.publication_history.find((entry) =>
        entry.fingerprint === fingerprint && entry.status === "published");
      if (existing) {
        return {
          schema_version: "question-import-publication-receipt@1.0",
          idempotent: true,
          ...existing,
          review: buildReceipt(context, review),
        };
      }

      const bankId = safeId(
        input.bank_id || `imported-bank:${shortHash(context.job.id, 16)}`,
        "bank_id",
      );
      const version = safeId(
        input.version || `review-${fingerprint.slice(0, 12)}`,
        "version",
      );
      const catalogs = buildQuestionCatalogs({
        context,
        accepted: unpublishedAccepted,
        bankId,
        version,
        fingerprint,
        reviewerId,
        publishedAt: isoNow(now),
      });
      let storeReceipt;
      try {
        storeReceipt = dataStore.importQuestionBank({
          tenantId,
          publicCatalog: catalogs.public_catalog,
          privateCatalog: catalogs.private_catalog,
          seedRevision: fingerprint,
        });
      } catch (cause) {
        throw new QuestionImportReviewError(
          cause?.code || "question_review_publication_failed",
          cause?.message || "正式题库写入失败",
          { status: cause?.status || 500, cause },
        );
      }

      const publishedAt = isoNow(now);
      const publicationId = `question-publication:${idFactory()}`;
      const itemIdsByCandidate = new Map(catalogs.public_catalog.items.map((item) => [
        item.provenance.import_candidate_id,
        item.id,
      ]));
      for (const item of review.items) {
        const questionId = itemIdsByCandidate.get(item.candidate_id);
        if (!questionId) continue;
        item.publication = {
          status: "published",
          publication_id: publicationId,
          question_id: questionId,
          bank_id: bankId,
          version,
          fingerprint,
          published_at: publishedAt,
        };
      }
      const publication = {
        publication_id: publicationId,
        status: "published",
        job_id: context.job.id,
        tenant_id: tenantId,
        bank_id: bankId,
        version,
        fingerprint,
        question_count: catalogs.public_catalog.items.length,
        card_bound_count: unpublishedAccepted.filter((item) => item.artifact_ref).length,
        card_pending_count: unpublishedAccepted.filter((item) => item.card_pending).length,
        skipped_published_count: accepted.length - unpublishedAccepted.length,
        cumulative_published_count: accepted.length,
        reviewer_id: reviewerId,
        published_at: publishedAt,
        store_receipt: storeReceipt,
      };
      review.publication_history.push(publication);
      review.revision += 1;
      review.updated_at = publishedAt;
      await writeReviewArtifact(context.job.id, review);
      return {
        schema_version: "question-import-publication-receipt@1.0",
        idempotent: storeReceipt?.idempotent === true,
        ...publication,
        review: buildReceipt(context, review),
      };
    });
  }

  async function loadContext(jobId, input = {}) {
    const safeJobId = safeId(jobId, "job_id");
    const job = await importService.get(safeJobId);
    if (!job) {
      throw new QuestionImportReviewError(
        "education_import_not_found",
        "未找到这次导入任务",
        { status: 404 },
      );
    }
    if (job.status !== "succeeded") {
      throw new QuestionImportReviewError(
        "question_review_import_not_ready",
        "导入解析完成后才能审核题目",
        { status: 409 },
      );
    }
    const candidates = Array.isArray(job.candidate_pack?.candidates?.questions)
      ? job.candidate_pack.candidates.questions
      : [];
    if (!candidates.length) {
      throw new QuestionImportReviewError(
        "question_review_no_candidates",
        "这次导入没有抽取出题目候选",
        { status: 409 },
      );
    }
    const tenantId = safeId(input.tenant_id || defaultTenantId, "tenant_id");
    const ontologies = dataStore.listOntologies({ tenantId });
    const requestedOntologyId = safeOptionalId(input.ontology_id)
      || safeOptionalId(defaultOntologyId)
      || ontologies[0]?.ontology_id;
    const requestedOntologyVersion = safeOptionalId(input.ontology_version)
      || safeOptionalId(defaultOntologyVersion)
      || ontologies.find((item) => item.ontology_id === requestedOntologyId)?.ontology_version
      || "";
    if (!requestedOntologyId) {
      throw new QuestionImportReviewError(
        "question_review_ontology_required",
        "正式知识点本体尚未建立，不能审核题目映射",
        { status: 409 },
      );
    }
    const knowledgeResult = dataStore.listKnowledgePoints({
      tenantId,
      ontologyId: requestedOntologyId,
      ontologyVersion: requestedOntologyVersion,
      limit: 1_000,
    });
    if (!knowledgeResult.items?.length) {
      throw new QuestionImportReviewError(
        "question_review_knowledge_catalog_empty",
        "目标本体没有可用的正式知识点",
        { status: 409 },
      );
    }
    const artifactCatalog = await loadArtifactCatalog();
    const trustedArtifacts = artifactCatalog.ontology_id === (knowledgeResult.ontology_id || requestedOntologyId)
      && artifactCatalog.ontology_version === (knowledgeResult.ontology_version || requestedOntologyVersion)
      ? artifactCatalog.artifacts
      : [];
    return {
      job,
      candidates,
      candidateById: new Map(candidates.map((candidate) => [candidate.id, candidate])),
      tenantId,
      ontologyId: knowledgeResult.ontology_id || requestedOntologyId,
      ontologyVersion: knowledgeResult.ontology_version || requestedOntologyVersion,
      ontologies,
      knowledgePoints: knowledgeResult.items,
      knowledgePointById: new Map(knowledgeResult.items.map((item) => [item.id, item])),
      artifactCatalog: trustedArtifacts,
      artifactById: new Map(trustedArtifacts.map((item) => [item.artifact_id, item])),
    };
  }

  async function loadArtifactCatalog() {
    if (!artifactCatalogPromise) {
      artifactCatalogPromise = readFile(artifactCatalogPath, "utf8")
        .then((source) => JSON.parse(source))
        .then((catalog) => ({
          ontology_id: safeOptionalId(
            catalog?.ontology_ref?.ontology_id || catalog?.ontology_ref?.id,
          ),
          ontology_version: safeOptionalId(
            catalog?.ontology_ref?.ontology_version || catalog?.ontology_ref?.version,
          ),
          artifacts: (Array.isArray(catalog?.artifacts) ? catalog.artifacts : []).map((artifact) => ({
            artifact_id: safeOptionalId(artifact?.artifact_id),
            knowledge_point_id: safeOptionalId(artifact?.knowledge_point_id),
            title: safeText(artifact?.title, 600),
            renderer: safeText(artifact?.interactive?.renderer, 120),
            variant: safeText(artifact?.interactive?.variant, 120),
            parameterization: clone(artifact?.interactive?.parameterization || null),
          })).filter((artifact) => artifact.artifact_id && artifact.knowledge_point_id),
        }))
        .catch(() => ({ ontology_id: "", ontology_version: "", artifacts: [] }));
    }
    return artifactCatalogPromise;
  }

  async function readReviewArtifact(jobId) {
    try {
      const value = JSON.parse(await readFile(reviewFilePath(jobId), "utf8"));
      if (value?.schema_version !== REVIEW_SCHEMA_VERSION || value?.job_id !== jobId) {
        throw new Error("invalid review artifact");
      }
      value.items = Array.isArray(value.items) ? value.items : [];
      value.publication_history = Array.isArray(value.publication_history)
        ? value.publication_history
        : [];
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new QuestionImportReviewError(
        "question_review_storage_invalid",
        "题目审核记录无法读取",
        { status: 500, cause: error },
      );
    }
  }

  async function writeReviewArtifact(jobId, review) {
    const path = reviewFilePath(jobId);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, `${JSON.stringify(review, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporaryPath, path);
    } catch (cause) {
      throw new QuestionImportReviewError(
        "question_review_storage_failed",
        "题目审核记录保存失败",
        { status: 503, cause },
      );
    }
  }

  function reviewFilePath(jobId) {
    return join(storageRoot, safeId(jobId, "job_id"), REVIEW_FILE_NAME);
  }

  return Object.freeze({
    getReview,
    reviewBatch,
    publish,
    configSummary: () => ({
      schema_version: REVIEW_SCHEMA_VERSION,
      statuses: [...REVIEW_STATUSES],
      question_types: [...ACCEPTABLE_QUESTION_TYPES],
      difficulties: [...DIFFICULTIES],
      publication_boundary: "human_review_to_sqlite_public_private_split",
    }),
  });
}

async function applyDecision({ decision, previous, candidate, context, reviewerId, reviewedAt }) {
  const status = decision.status;
  const artifactRef = safeOptionalId(decision.artifact_ref ?? previous.artifact_ref);
  const hasExplicitCardPending = Object.hasOwn(decision, "card_pending");
  const next = {
    ...previous,
    status,
    reviewer_id: reviewerId,
    reviewed_at: reviewedAt,
    note: safeText(decision.note ?? previous.note, 2_000),
    edited_stem: safeText(decision.stem ?? previous.edited_stem ?? candidate.stem, 8_000),
    canonical_knowledge_point_id: safeOptionalId(
      decision.canonical_knowledge_point_id ?? previous.canonical_knowledge_point_id,
    ),
    question_type: safeText(decision.question_type ?? previous.question_type, 120),
    difficulty: safeText(decision.difficulty ?? previous.difficulty, 120),
    solution_strategy: safeText(decision.solution_strategy ?? previous.solution_strategy, 6_000),
    answer_key: safeText(decision.answer_key ?? previous.answer_key, 2_000),
    artifact_ref: artifactRef,
    card_pending: hasExplicitCardPending
      ? decision.card_pending === true
      : artifactRef
        ? false
        : previous.card_pending === true,
  };
  if (status === "needs_edit" && !next.note) {
    throw invalid(
      "question_review_note_required",
      `题目 ${candidate.id} 退回修改时必须说明原因`,
    );
  }
  if (status === "accept") await validateAcceptedReviewItem(next, context);
  next.history = [...(Array.isArray(previous.history) ? previous.history : []), {
    decision_id: `question-review-decision:${randomUUID()}`,
    status,
    reviewer_id: reviewerId,
    note: next.note,
    reviewed_at: reviewedAt,
  }].slice(-30);
  return next;
}

async function validateAcceptedReviewItem(item, context) {
  const candidateId = item.candidate_id || "候选题";
  if (!item.edited_stem) {
    throw invalid("question_review_stem_required", `${candidateId} 缺少可发布题干`);
  }
  if (!item.canonical_knowledge_point_id
    || !context.knowledgePointById.has(item.canonical_knowledge_point_id)) {
    throw invalid(
      "question_review_knowledge_point_required",
      `${candidateId} 必须选择当前正式本体中的知识点`,
    );
  }
  if (!ACCEPTABLE_QUESTION_TYPES.has(item.question_type)) {
    throw invalid(
      "question_review_question_type_required",
      `${candidateId} 必须确认题型`,
    );
  }
  if (!DIFFICULTIES.has(item.difficulty)) {
    throw invalid(
      "question_review_difficulty_required",
      `${candidateId} 必须确认难度`,
    );
  }
  if (item.solution_strategy.length < 6) {
    throw invalid(
      "question_review_solution_strategy_required",
      `${candidateId} 必须填写可复核的解题思路`,
    );
  }
  if (item.artifact_ref && item.card_pending) {
    throw invalid(
      "question_review_card_binding_conflict",
      `${candidateId} 不能同时绑定卡片并标记待生成`,
    );
  }
  if (!item.artifact_ref && !item.card_pending) {
    throw invalid(
      "question_review_card_decision_required",
      `${candidateId} 必须绑定受信卡片，或明确标记为待生成卡片`,
    );
  }
  if (item.artifact_ref) {
    const artifact = context.artifactById.get(item.artifact_ref);
    if (!artifact || artifact.knowledge_point_id !== item.canonical_knowledge_point_id) {
      throw invalid(
        "question_review_card_not_trusted",
        `${candidateId} 选择的卡片不属于该知识点或不是受信本地素材`,
      );
    }
  }
}

function buildReceipt(context, persisted) {
  const review = persisted || createReviewArtifact(context, isoNow(() => new Date()));
  const reviewedById = new Map(review.items.map((item) => [item.candidate_id, item]));
  const items = context.candidates.map((candidate) => {
    const item = reviewedById.get(candidate.id) || createReviewItem(candidate);
    return {
      ...item,
      candidate: publicCandidate(candidate),
    };
  });
  const counts = { pending: 0, accept: 0, reject: 0, needs_edit: 0, published: 0 };
  for (const item of items) {
    counts[item.status] = (counts[item.status] || 0) + 1;
    if (item.publication?.status === "published") counts.published += 1;
  }
  return {
    schema_version: REVIEW_SCHEMA_VERSION,
    job_id: context.job.id,
    revision: review.revision,
    ontology_ref: {
      id: context.ontologyId,
      version: context.ontologyVersion,
    },
    source: {
      document_id: context.job.document_ir?.id || "",
      document_revision_id: context.job.document_ir?.revision_id || "",
      title: context.job.document_ir?.title || context.job.request?.title || "",
      file_name: context.job.source?.file_name || "",
    },
    counts,
    question_types: [...ACCEPTABLE_QUESTION_TYPES],
    difficulties: [...DIFFICULTIES],
    knowledge_points: context.knowledgePoints.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
    })),
    trusted_cards: context.artifactCatalog
      .filter((item) => context.knowledgePointById.has(item.knowledge_point_id)),
    items,
    publication_history: review.publication_history,
    updated_at: review.updated_at,
  };
}

function createReviewArtifact(context, createdAt) {
  return {
    schema_version: REVIEW_SCHEMA_VERSION,
    job_id: context.job.id,
    revision: 0,
    source_document_id: context.job.document_ir?.id || "",
    source_document_revision_id: context.job.document_ir?.revision_id || "",
    items: context.candidates.map(createReviewItem),
    publication_history: [],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function createReviewItem(candidate) {
  return {
    candidate_id: candidate.id,
    candidate_revision_id: candidate.revision_id || "",
    source_anchor: clone(candidate.source_anchor || candidate.provenance?.source_anchors?.[0] || {}),
    original_stem: safeText(candidate.stem, 8_000),
    status: "pending",
    reviewer_id: "",
    reviewed_at: null,
    note: "",
    edited_stem: safeText(candidate.stem, 8_000),
    canonical_knowledge_point_id: "",
    question_type: ACCEPTABLE_QUESTION_TYPES.has(candidate.question_type)
      ? candidate.question_type
      : "",
    difficulty: "",
    solution_strategy: "",
    answer_key: "",
    artifact_ref: "",
    card_pending: false,
    history: [],
    publication: null,
  };
}

function publicCandidate(candidate) {
  return {
    id: candidate.id,
    revision_id: candidate.revision_id || "",
    stem: candidate.stem,
    question_type: candidate.question_type,
    language: candidate.language,
    options: (candidate.parts || []).flatMap((part) => part.options || []),
    source_anchor: clone(candidate.source_anchor || {}),
    confidence: clone(candidate.confidence || {}),
    review_status: candidate.review_status,
  };
}

function buildQuestionCatalogs({
  context,
  accepted,
  bankId,
  version,
  fingerprint,
  reviewerId,
  publishedAt,
}) {
  const publicItems = [];
  const privateItems = [];
  for (const item of accepted) {
    const candidate = context.candidateById.get(item.candidate_id);
    const knowledgePoint = context.knowledgePointById.get(item.canonical_knowledge_point_id);
    const questionId = `IMP-${shortHash(`${context.job.id}:${item.candidate_id}`, 24)}`;
    const options = (candidate.parts || []).flatMap((part) => part.options || [])
      .map((option) => ({
        id: safeText(option.label || option.id, 40),
        text: safeText(option.text, 2_000),
      })).filter((option) => option.id && option.text);
    const artifactRef = item.artifact_ref ? context.artifactById.get(item.artifact_ref) : null;
    publicItems.push({
      item_status: "published",
      version: "1.0.0",
      id: questionId,
      title: safeText(item.edited_stem, 120),
      stem: item.edited_stem,
      question_type: item.question_type,
      difficulty: { code: item.difficulty, label: difficultyLabel(item.difficulty) },
      proposition_method: { code: "reviewed_import", label: "导入题人工审核" },
      ability_level: "unclassified",
      options,
      knowledge_point_mapping: [{
        id: item.canonical_knowledge_point_id,
        name: knowledgePoint.name,
        role: "primary",
        weight: 1,
      }],
      ...(artifactRef ? {
        artifact_ref: {
          artifact_id: artifactRef.artifact_id,
          interactive_variant: artifactRef.variant,
          renderer: artifactRef.renderer,
          parameterization: clone(artifactRef.parameterization),
        },
        card_status: "bound",
      } : { card_status: "pending" }),
      solution_preview: {
        strategy_labels: [safeText(item.solution_strategy, 120)],
        first_hint: safeText(item.solution_strategy, 240),
        full_solution_access: "server_controlled",
        has_full_solution: true,
      },
      source_anchor: clone(item.source_anchor),
      provenance: {
        source_type: "reviewed_question_import",
        import_job_id: context.job.id,
        import_candidate_id: item.candidate_id,
        reviewer_id: reviewerId,
        review_status: "verified",
        published_at: publishedAt,
      },
      quality: {
        source_anchor_status: "preserved",
        mapping_status: "human_confirmed",
        solution_strategy_status: "human_confirmed",
        card_status: artifactRef ? "trusted_local_bound" : "card_pending",
        publishable: true,
      },
    });
    privateItems.push({
      question_id: questionId,
      storage_classification: "server_private",
      question_version: "1.0.0",
      knowledge_point_id: item.canonical_knowledge_point_id,
      source_anchor: clone(item.source_anchor),
      ...(item.answer_key ? {
        key: { kind: "reviewer_supplied_text", value: item.answer_key },
      } : {
        key: { kind: "not_supplied", value: null },
      }),
      verification: {
        kind: item.answer_key ? "human_reviewed_answer" : "human_grading_required",
        auto_gradable: false,
      },
      solution_plan: {
        steps: [{ order: 1, title: "解题思路", detail: item.solution_strategy }],
        key_turning_point: item.solution_strategy,
        common_errors: [],
        alternative_solutions: [],
        explanation: item.solution_strategy,
      },
      review: {
        review_status: "verified",
        reviewer_id: reviewerId,
        reviewed_at: item.reviewed_at,
        import_job_id: context.job.id,
        import_candidate_id: item.candidate_id,
      },
    });
  }
  return {
    public_catalog: {
      schema_version: "assessment-item-public-bank@1.0",
      bank_id: bankId,
      version,
      compiled_at: publishedAt,
      build_fingerprint: fingerprint,
      ontology_ref: { id: context.ontologyId, version: context.ontologyVersion },
      provenance: {
        source_type: "reviewed_question_import",
        import_job_id: context.job.id,
        review_status: "verified",
        reviewer_id: reviewerId,
      },
      privacy_contract: {
        contains_answer_keys: false,
        contains_full_solutions: false,
        full_solution_delivery: "authenticated_server_endpoint_only",
      },
      items: publicItems,
    },
    private_catalog: {
      schema_version: "assessment-key-private-bank@1.0",
      storage_classification: "server_private",
      bank_id: `${bankId}:private`,
      version,
      compiled_at: publishedAt,
      build_fingerprint: fingerprint,
      public_bank_ref: bankId,
      items: privateItems,
    },
  };
}

function publicationFingerprintItem(item) {
  return {
    candidate_id: item.candidate_id,
    candidate_revision_id: item.candidate_revision_id,
    edited_stem: item.edited_stem,
    canonical_knowledge_point_id: item.canonical_knowledge_point_id,
    question_type: item.question_type,
    difficulty: item.difficulty,
    solution_strategy: item.solution_strategy,
    answer_key: item.answer_key,
    artifact_ref: item.artifact_ref,
    card_pending: item.card_pending,
  };
}

function normalizeDecisionBatch(value) {
  if (!Array.isArray(value) || value.length > MAX_BATCH_SIZE) {
    throw invalid(
      "question_review_invalid_batch",
      `单次审核必须包含 1-${MAX_BATCH_SIZE} 道题`,
    );
  }
  const seen = new Set();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw invalid("question_review_invalid_decision", `第 ${index + 1} 项审核决定无效`);
    }
    const candidateId = safeId(raw.candidate_id, "candidate_id");
    if (seen.has(candidateId)) {
      throw invalid("question_review_duplicate_candidate", `重复审核候选题 ${candidateId}`);
    }
    seen.add(candidateId);
    const status = safeText(raw.status, 40);
    if (!REVIEW_STATUSES.has(status)) {
      throw invalid("question_review_invalid_status", `候选题 ${candidateId} 的审核状态无效`);
    }
    return { ...raw, candidate_id: candidateId, status };
  });
}

function assertExpectedRevision(review, value) {
  if (value == null || value === "") return;
  const expected = Number(value);
  if (!Number.isInteger(expected) || expected !== Number(review.revision)) {
    throw new QuestionImportReviewError(
      "question_review_revision_conflict",
      "题目审核记录已被更新，请刷新后重试",
      { status: 409 },
    );
  }
}

function withLock(locks, key, task) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  locks.set(key, current);
  return current.finally(() => {
    if (locks.get(key) === current) locks.delete(key);
  });
}

function difficultyLabel(value) {
  return ({ foundation: "基础", standard: "进阶", advanced: "挑战" })[value] || value;
}

function safeId(value, field) {
  const text = String(value ?? "").trim();
  if (!ID_PATTERN.test(text)) {
    throw invalid("question_review_invalid_identifier", `${field} 无效`);
  }
  return text;
}

function safeOptionalId(value) {
  const text = String(value ?? "").trim();
  return text && ID_PATTERN.test(text) ? text : "";
}

function safeText(value, maxLength = 1_000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function contentHash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function shortHash(value, length) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isoNow(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function invalid(code, message) {
  return new QuestionImportReviewError(code, message, { status: 422 });
}
