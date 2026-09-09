import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const visualArtifactsPath = join(
  moduleDir,
  "public",
  "data",
  "junior-math-visual-artifacts.json",
);

const COURSE_SCOPES = Object.freeze([
  Object.freeze({
    scope_id: "course-junior-math",
    label: "中考数学",
    subject: "数学",
    grade_band: "初中",
    course_id: "junior-math-moe-2022",
    corpus_id: "junior-math-moe-2022",
    ontology_id: "junior-math-moe-2022",
    namespace_id: "organization_course",
    loaded_materials: Object.freeze([
      Object.freeze({
        material_id: "MOE-MATH-2022",
        title: "义务教育数学课程标准（2022年版）",
        version: "2022",
        publisher: "中华人民共和国教育部",
        scope: "第四学段（7～9年级）",
        source_type: "curriculum_standard",
      }),
    ]),
  }),
]);

const scopeById = new Map(COURSE_SCOPES.map((scope) => [scope.scope_id, scope]));
const scopeByCourseId = new Map(COURSE_SCOPES.map((scope) => [scope.course_id, scope]));
let visualCatalogPromise = null;

export function listLoadedLearningScopes({ dataService, tenantId } = {}) {
  const loadedOntologyIds = new Set(
    safeListOntologies(dataService, tenantId).map((item) => item.ontology_id),
  );
  return COURSE_SCOPES
    .filter((scope) => loadedOntologyIds.has(scope.ontology_id))
    .map(publicScope);
}

export function resolveLoadedLearningScope(
  requestedScopeId,
  { dataService, tenantId } = {},
) {
  const requested = cleanId(requestedScopeId);
  const configured = scopeById.get(requested)
    || scopeByCourseId.get(requested)
    || COURSE_SCOPES[0];
  const loaded = listLoadedLearningScopes({ dataService, tenantId });
  const match = loaded.find((scope) => scope.scope_id === configured.scope_id);
  if (match) return match;
  const fallback = loaded[0];
  if (!fallback) {
    const error = new Error("当前没有已加载且已审核的教材或课标");
    error.code = "learning_scope_empty";
    error.status = 503;
    throw error;
  }
  return fallback;
}

export function createLearningRetrievalAdapter({
  hybridRetrievalService = null,
  connectionMonitor = null,
  dataService,
  tenantId,
} = {}) {
  if (!dataService) throw new TypeError("dataService is required");

  async function search(input = {}) {
    input.signal?.throwIfAborted();
    const scope = resolveLoadedLearningScope(input.courseId, {
      dataService,
      tenantId: input.tenantId || tenantId,
    });
    let remoteReceipt = null;
    const connection = connectionMonitor
      ? await connectionMonitor.getStatus({ signal: input.signal }) : null;
    if (connection && !connection.retrieval.remote_allowed) {
      remoteReceipt = { status: "tool_error", code: connection.retrieval.reason };
    } else if (hybridRetrievalService?.search) {
      remoteReceipt = await hybridRetrievalService.search({
        ...input,
        tenantId: input.tenantId || tenantId,
        namespaceId: scope.namespace_id,
        courseId: scope.course_id,
        corpusId: scope.corpus_id,
      });
      if (remoteReceipt?.status === "retrieved") {
        return decorateRemoteReceipt(remoteReceipt, scope);
      }
    }

    input.signal?.throwIfAborted();
    const localReceipt = await searchReviewedLocalOntology({
      dataService,
      tenantId: input.tenantId || tenantId,
      scope,
      query: input.query,
      limit: input.limit,
    });
    input.signal?.throwIfAborted();
    if (localReceipt.status === "retrieved") {
      return remoteReceipt
        ? decorateLocalFallbackReceipt(localReceipt, remoteReceipt)
        : localReceipt;
    }
    if (remoteReceipt?.status === "tool_error") {
      // The reviewed local ontology is an authoritative, independently
      // readable index of the selected curriculum. When that index completes
      // normally and finds no candidate, a failed vector backend only means
      // semantic recall is degraded; it does not invalidate the local
      // no-match decision. Preserve `no_match` so the server-owned external
      // teaching fallback may run, while retaining the upstream failure for
      // Trace and operations diagnostics. Exceptions from the local read are
      // intentionally not caught here and remain `tool_error` upstream.
      return decorateLocalFallbackReceipt(localReceipt, remoteReceipt);
    }
    return localReceipt;
  }

  return Object.freeze({ search });
}

function decorateLocalFallbackReceipt(localReceipt, remoteReceipt) {
  return {
    ...localReceipt,
    retrieval_mode: "reviewed_local_ontology_fallback",
    retrieval_degraded: true,
    fallback: {
      from: "hybrid_rrf",
      reason_code: String(remoteReceipt?.code || "hybrid_retrieval_unavailable"),
    },
  };
}

export async function resolveAllowedLearningCardRefs({
  scopeId = "course-junior-math",
  query = "",
  knowledgePointIds = [],
  limit = 8,
} = {}) {
  const scope = scopeById.get(cleanId(scopeId)) || scopeByCourseId.get(cleanId(scopeId));
  if (!scope || scope.ontology_id !== "junior-math-moe-2022") return [];
  const catalog = await loadVisualCatalog();
  const requestedIds = new Set(
    (Array.isArray(knowledgePointIds) ? knowledgePointIds : [])
      .map(cleanId)
      .filter(Boolean),
  );
  const ranked = catalog.artifacts
    .map((artifact) => ({
      artifact,
      score: requestedIds.has(artifact.knowledge_point_id)
        ? 10_000
        : lexicalScore(query, [
          artifact.knowledge_point_id,
          artifact.title,
          artifact?.source?.outline_description,
          artifact?.mindmap?.root,
        ]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, clampLimit(limit, 8));
  return ranked.map(({ artifact }) => trustedCardRef(artifact));
}

async function searchReviewedLocalOntology({ dataService, tenantId, scope, query, limit }) {
  const graph = dataService.getOntologyGraph({
    tenantId,
    ontologyId: scope.ontology_id,
    includeQuestions: false,
  });
  const artifacts = await loadVisualCatalog();
  const artifactByPointId = artifacts.byKnowledgePointId;
  const safeQuery = String(query || "").trim().slice(0, 8_000);
  const entities = Array.isArray(graph?.entities) ? graph.entities : [];
  const candidates = entities
    .filter((entity) => entity.entity_kind === "knowledge_point")
    .map((entity) => ({
      entity,
      score: lexicalScore(safeQuery, [
        entity.id,
        entity.name,
        entity.description,
        ...(Array.isArray(entity.aliases) ? entity.aliases : []),
        entity?.properties?.measurable_behavior,
      ]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, clampLimit(limit, 8));

  if (!candidates.length) {
    return localReceipt(scope, {
      status: "no_match",
      code: "reviewed_local_knowledge_no_match",
    });
  }

  const selectedIds = new Set(candidates.map((entry) => entry.entity.id));
  const relationships = (Array.isArray(graph?.relations) ? graph.relations : [])
    .filter((relation) => selectedIds.has(relation.source) || selectedIds.has(relation.target))
    .slice(0, 80);
  const neighborIds = new Set(relationships.flatMap((relation) => [relation.source, relation.target]));
  const graphNodes = entities
    .filter((entity) => neighborIds.has(entity.id))
    .slice(0, 120)
    .map((entity) => ({
      id: entity.id,
      type: entity.entity_kind,
      label: entity.name,
    }));

  return localReceipt(scope, {
    status: "retrieved",
    code: "reviewed_local_ontology",
    hits: candidates.map(({ entity, score }) => {
      const artifact = artifactByPointId.get(entity.id);
      return {
        id: `local:${entity.id}`,
        score,
        record_id: entity.id,
        entity_type: "knowledge_point",
        title: entity.name,
        content: [
          entity.description,
          entity?.properties?.measurable_behavior,
          artifact?.source?.outline_description,
          artifact?.source?.is_verbatim ? artifact?.source?.verbatim_text : "",
        ].filter(Boolean).join("\n"),
        source_anchor: entity.source_ref || artifact?.source || null,
        document_id: scope.loaded_materials[0]?.material_id || null,
        document_revision_id: scope.loaded_materials[0]?.version || null,
        card_refs: artifact ? [trustedCardRef(artifact)] : [],
      };
    }),
    graph: {
      nodes: graphNodes,
      relationships: relationships.map((relation) => ({
        source: relation.source,
        target: relation.target,
        type: relation.type,
        directed: relation.directed !== false,
      })),
    },
  });
}

async function decorateRemoteReceipt(receipt, scope) {
  const catalog = await loadVisualCatalog();
  const hits = (Array.isArray(receipt.hits) ? receipt.hits : []).map((hit) => {
    const artifact = catalog.byKnowledgePointId.get(String(hit.record_id || ""))
      || bestArtifactForTitle(catalog.artifacts, hit.title);
    return {
      ...hit,
      card_refs: artifact ? [trustedCardRef(artifact)] : [],
    };
  });
  return {
    ...receipt,
    scope_id: scope.scope_id,
    loaded_materials: scope.loaded_materials,
    hits,
  };
}

function localReceipt(scope, overrides) {
  return {
    schema_version: "education-hybrid-retrieval-receipt@1.0",
    status: "no_match",
    code: "reviewed_local_knowledge_no_match",
    retrieval_mode: "reviewed_local_ontology",
    retrieval_degraded: false,
    tenant_id: null,
    corpus_id: scope.corpus_id,
    active_release_id: `local-reviewed:${scope.ontology_id}`,
    scope_id: scope.scope_id,
    loaded_materials: scope.loaded_materials,
    hits: [],
    graph: { nodes: [], relationships: [] },
    ...overrides,
  };
}

function publicScope(scope) {
  return {
    scope_id: scope.scope_id,
    label: scope.label,
    subject: scope.subject,
    grade_band: scope.grade_band,
    course_id: scope.course_id,
    corpus_id: scope.corpus_id,
    ontology_id: scope.ontology_id,
    namespace_id: scope.namespace_id,
    loaded_materials: scope.loaded_materials.map((item) => ({ ...item })),
  };
}

function safeListOntologies(dataService, tenantId) {
  try {
    const items = dataService?.listOntologies?.({ tenantId });
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function loadVisualCatalog() {
  if (!visualCatalogPromise) {
    visualCatalogPromise = readFile(visualArtifactsPath, "utf8")
      .then((raw) => {
        const parsed = JSON.parse(raw);
        const artifacts = Array.isArray(parsed?.artifacts) ? parsed.artifacts : [];
        return {
          artifacts,
          byKnowledgePointId: new Map(
            artifacts.map((artifact) => [String(artifact.knowledge_point_id || ""), artifact]),
          ),
        };
      })
      .catch((error) => {
        visualCatalogPromise = null;
        throw error;
      });
  }
  return visualCatalogPromise;
}

function trustedCardRef(artifact) {
  return {
    ref: String(artifact.artifact_id || ""),
    type: "interactive_visual",
    knowledge_point_id: String(artifact.knowledge_point_id || ""),
    title: String(artifact.title || ""),
    protocol: String(artifact.schema_version || "junior-math-visual-artifact@1.0"),
    parameterization: artifact.interactive?.parameterization || null,
  };
}

function bestArtifactForTitle(artifacts, title) {
  const ranked = artifacts
    .map((artifact) => ({ artifact, score: lexicalScore(title, [artifact.title]) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.artifact || null;
}

function lexicalScore(query, fields) {
  const needle = normalizeSearchText(query);
  if (!needle) return 0;
  let score = 0;
  for (const raw of fields) {
    const value = normalizeSearchText(raw);
    if (!value) continue;
    if (value === needle) score = Math.max(score, 1_000);
    if (value.includes(needle)) score = Math.max(score, 700 + Math.min(120, needle.length * 8));
    if (needle.includes(value) && value.length >= 2) score = Math.max(score, 620 + Math.min(120, value.length * 8));
    const overlap = ngramOverlap(needle, value);
    score = Math.max(score, Math.round(overlap * 500));
  }
  return score;
}

function ngramOverlap(left, right) {
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  if (!leftSet.size || !rightSet.size) return 0;
  let matches = 0;
  for (const item of leftSet) if (rightSet.has(item)) matches += 1;
  return matches / Math.max(1, Math.min(leftSet.size, rightSet.size));
}

function bigrams(value) {
  const result = new Set();
  if (value.length === 1) result.add(value);
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function cleanId(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/u.test(text) ? text : "";
}

function clampLimit(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? Math.max(1, Math.min(20, numeric)) : fallback;
}
