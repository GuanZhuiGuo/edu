import { createHash } from "node:crypto";

import { compileEducationKnowledgePublicationPlan } from "./education-knowledge-projection.js";
import {
  EDUCATION_LEXICAL_SPARSE_VERSION,
  encodeEducationLexicalSparse,
} from "./education-lexical-sparse.js";

const MAX_VECTOR_BATCH = 128;

export class EducationKnowledgePublicationError extends Error {
  constructor(code, message, { status = 500, retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "EducationKnowledgePublicationError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * Publish a verified import into an inactive Qdrant/Neo4j release, then make
 * that release visible with one Neo4j control-plane transition. This is a
 * compensating workflow, not a cross-database transaction: partial vector or
 * graph writes remain unreachable until activateRelease succeeds.
 */
export function createEducationKnowledgePublicationService({
  importService,
  modelClient,
  vectorStore,
  graphStore,
  now = () => new Date(),
  compilePlan = compileEducationKnowledgePublicationPlan,
  lexicalEncoder = encodeEducationLexicalSparse,
} = {}) {
  assertMethod(importService, "get");
  assertMethod(modelClient, "embedMultimodal");
  for (const method of ["ensureCollection", "upsertPoints", "setPublishState"]) {
    assertMethod(vectorStore, method);
  }
  for (const method of [
    "initializeSchema", "prepareRelease", "publishGraph", "activateRelease",
    "resolveActiveRelease", "setReleaseStatus",
  ]) assertMethod(graphStore, method);

  async function publishImport(jobId, options = {}) {
    const identity = normalizePublicationIdentity(options);
    const artifact = await importService.get(requireText(jobId, "jobId"), {
      includeArtifacts: true,
    });
    if (!artifact) {
      throw new EducationKnowledgePublicationError(
        "education_knowledge_import_not_found",
        "The education import was not found.",
        { status: 404 },
      );
    }
    const embeddingModel = modelClient.configSummary?.().embeddingModel || "ark_embedding";
    const plan = compilePlan({
      documentIR: artifact.document_ir,
      candidatePack: artifact.candidate_pack,
      semanticArtifact: artifact.semantic_artifact || null,
      tenantId: identity.tenantId,
      namespace: identity.namespace,
      courseId: identity.courseId,
      embeddingModel,
      publishedAt: now().toISOString(),
    });
    const control = graphControl(identity, plan);
    const manifest = buildPublicationManifest(plan);

    const active = await graphStore.resolveActiveRelease(control);
    if (active?.release_id === plan.release_id && active.status === "active") {
      return publicationReceipt(plan, manifest, {
        status: "active",
        idempotent: true,
        sparseKinds: [],
      });
    }

    let activated = false;
    try {
      await graphStore.initializeSchema();
      await graphStore.prepareRelease(control);
      const embedded = await embedRecords(plan.vector_records, {
        modelClient,
        lexicalEncoder,
        signal: options.signal,
      });
      const denseSize = embedded[0]?.dense.length;
      if (!Number.isInteger(denseSize) || denseSize < 1
        || embedded.some((entry) => entry.dense.length !== denseSize)) {
        throw new EducationKnowledgePublicationError(
          "education_knowledge_embedding_dimension_invalid",
          "The embedding model returned inconsistent vector dimensions.",
          { status: 502 },
        );
      }
      await vectorStore.ensureCollection({ denseSize, signal: options.signal });
      const points = embedded.map((entry) => ({
        dense: entry.dense,
        sparse: entry.sparse,
        payload: vectorPayload(entry.record, {
          sparseKind: entry.sparseKind,
          sparseVersion: entry.sparseVersion,
          principalIds: identity.readPrincipals,
        }),
      }));
      let vectorCount = 0;
      for (const batch of batches(points, MAX_VECTOR_BATCH)) {
        const result = await vectorStore.upsertPoints(batch, { signal: options.signal });
        vectorCount += result.count;
      }
      if (vectorCount !== manifest.counts.vector_records) {
        throw new EducationKnowledgePublicationError(
          "education_knowledge_vector_manifest_mismatch",
          "The vector publication count did not match its manifest.",
          { status: 502 },
        );
      }

      const graphResult = await graphStore.publishGraph(graphPayload(plan, identity));
      assertGraphManifest(graphResult?.counts, manifest.counts);
      await vectorStore.setPublishState({
        tenantId: plan.tenant_id,
        corpusId: plan.corpus_id,
        releaseId: plan.release_id,
        fromPublishState: "staging",
        publishState: "published",
        signal: options.signal,
      });
      await graphStore.activateRelease(control);
      activated = true;
      return publicationReceipt(plan, manifest, {
        status: "active",
        idempotent: false,
        sparseKinds: embedded.map((entry) => entry.sparseKind),
      });
    } catch (cause) {
      if (!activated) {
        try {
          await graphStore.setReleaseStatus({ ...control, status: "failed" });
        } catch {
          // Preserve the first failure. A failed compensation never makes the
          // release active and is surfaced by health/operational monitoring.
        }
      }
      if (cause instanceof EducationKnowledgePublicationError) throw cause;
      throw new EducationKnowledgePublicationError(
        "education_knowledge_publication_failed",
        "Education knowledge publication failed before activation.",
        { status: Number.isInteger(cause?.status) ? cause.status : 502, cause },
      );
    }
  }

  return Object.freeze({ publishImport });
}

async function embedRecords(records, { modelClient, lexicalEncoder, signal }) {
  const output = [];
  for (const record of records) {
    const response = await modelClient.embedMultimodal({
      input: [{ type: "text", text: record.content }],
      encodingFormat: "float",
      signal,
    });
    if (!Array.isArray(response.embedding) || !response.embedding.every(Number.isFinite)) {
      throw new EducationKnowledgePublicationError(
        "education_knowledge_embedding_invalid",
        "The embedding provider returned an invalid dense vector.",
        { status: 502 },
      );
    }
    const providerSparse = normalizeProviderSparse(response.sparseEmbedding);
    const localSparse = providerSparse ? null : lexicalEncoder(record.content);
    output.push({
      record,
      dense: [...response.embedding],
      sparse: providerSparse || sparseVector(localSparse),
      sparseKind: providerSparse ? "provider_sparse" : "local_lexical",
      sparseVersion: providerSparse
        ? (response.model || "provider")
        : (localSparse.version || EDUCATION_LEXICAL_SPARSE_VERSION),
    });
  }
  return output;
}

function vectorPayload(record, { sparseKind, sparseVersion, principalIds }) {
  return {
    ...record.payload,
    acl_principal_ids: principalIds,
    title: record.title,
    content: record.content,
    content_hash: record.content_hash,
    source_anchor: record.source_anchor,
    sparse_encoder_kind: sparseKind,
    sparse_encoder_version: sparseVersion,
    tags: record.lexical_terms,
  };
}

function graphPayload(plan, identity) {
  return {
    ...graphControl(identity, plan),
    document: plan.document,
    revision: plan.revision,
    chunks: plan.graph.chunks.map((chunk, index) => ({
      ...chunk,
      text: chunk.content,
      reading_order: index,
      layer: "printed",
      extraction_method: "reviewed_import",
    })),
    knowledgeUnits: plan.graph.knowledge_units.map((unit) => ({
      ...unit,
      entity_type: unit.knowledge_type,
      name: unit.title,
      review_status: "verified",
    })),
    questions: plan.graph.questions.map((question) => ({
      ...question,
      question_id: question.id,
      question_revision_id: question.revision_id,
      review_status: "verified",
    })),
    relations: plan.graph.relations.map((relation) => ({
      ...relation,
      review_status: "verified",
    })),
    questionLinks: plan.graph.question_links.map((link) => ({
      ...link,
      review_status: "verified",
    })),
  };
}

function graphControl(identity, plan) {
  return {
    tenantId: identity.tenantId,
    namespaceId: plan.namespace,
    principalId: identity.principalId,
    readPrincipals: identity.readPrincipals,
    writePrincipals: identity.writePrincipals,
    visibility: plan.visibility === "shared" || plan.namespace === "shared_curriculum"
      ? "public"
      : "tenant",
    corpusId: plan.corpus_id,
    releaseId: plan.release_id,
  };
}

function normalizePublicationIdentity(input) {
  const principalId = requireText(input.principalId, "principalId");
  const tenantId = requireText(input.tenantId, "tenantId");
  const namespace = input.namespace || "organization_course";
  const courseId = input.courseId || (namespace === "shared_curriculum" ? "shared_curriculum" : null);
  return {
    tenantId,
    principalId,
    namespace,
    courseId,
    readPrincipals: normalizePrincipals(input.readPrincipals, principalId),
    writePrincipals: normalizePrincipals(input.writePrincipals, principalId),
  };
}

function normalizePrincipals(value, principalId) {
  const list = value === undefined ? [principalId] : value;
  if (!Array.isArray(list) || !list.includes(principalId)) {
    throw new EducationKnowledgePublicationError(
      "education_knowledge_identity_invalid",
      "The acting principal must be included in publication principals.",
      { status: 403 },
    );
  }
  return [...new Set(list.map((item) => requireText(item, "principal")))];
}

function buildPublicationManifest(plan) {
  const vectorDigest = sha256(plan.vector_records.map((record) => ({
    id: record.record_id,
    revision_id: record.payload.revision_id,
    content_hash: record.content_hash,
  })));
  const graphDigest = sha256(plan.graph);
  return Object.freeze({
    schema_version: "education-knowledge-manifest@1.0",
    counts: Object.freeze({
      vector_records: plan.statistics.vector_record_count,
      chunks: plan.statistics.chunk_count,
      knowledge_units: plan.statistics.knowledge_unit_count,
      questions: plan.statistics.question_count,
      relations: plan.statistics.relation_count,
      question_links: plan.statistics.question_link_count,
    }),
    vector_digest: vectorDigest,
    graph_digest: graphDigest,
    digest: sha256({ vectorDigest, graphDigest, statistics: plan.statistics }),
  });
}

function assertGraphManifest(actual, expected) {
  for (const key of ["chunks", "knowledge_units", "questions", "relations", "question_links"]) {
    if (actual?.[key] !== expected[key]) {
      throw new EducationKnowledgePublicationError(
        "education_knowledge_graph_manifest_mismatch",
        "The graph publication count did not match its manifest.",
        { status: 502 },
      );
    }
  }
}

function publicationReceipt(plan, manifest, { status, idempotent, sparseKinds }) {
  const kinds = [...new Set(sparseKinds)];
  return Object.freeze({
    schema_version: "education-knowledge-publication-receipt@1.0",
    publication_id: plan.publication_id,
    tenant_id: plan.tenant_id,
    corpus_id: plan.corpus_id,
    release_id: plan.release_id,
    status,
    idempotent,
    retrieval_ready: status === "active",
    sparse_encoder_kinds: kinds,
    manifest,
  });
}

function normalizeProviderSparse(value) {
  if (!value || !Array.isArray(value.indices) || !Array.isArray(value.values)
    || value.indices.length === 0 || value.indices.length !== value.values.length) return null;
  const pairs = value.indices.map((index, offset) => ({ index, value: value.values[offset] }))
    .filter((entry) => Number.isSafeInteger(entry.index) && entry.index >= 0
      && Number.isFinite(entry.value) && entry.value !== 0)
    .sort((left, right) => left.index - right.index);
  if (pairs.length !== value.indices.length
    || pairs.some((entry, index) => index > 0 && entry.index === pairs[index - 1].index)) return null;
  return { indices: pairs.map((entry) => entry.index), values: pairs.map((entry) => entry.value) };
}

function sparseVector(value) {
  return { indices: [...value.indices], values: [...value.values] };
}

function batches(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireText(value, field) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new EducationKnowledgePublicationError(
      "education_knowledge_publication_input_invalid",
      `${field} is required.`,
      { status: 422 },
    );
  }
  return text;
}

function assertMethod(value, method) {
  if (!value || typeof value[method] !== "function") {
    throw new TypeError(`${method} dependency is required.`);
  }
}

export { buildPublicationManifest };
