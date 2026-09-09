import { createHash } from "node:crypto";

import neo4j from "neo4j-driver";
import { runWithEducationDeadline } from "./education-operation-deadline.js";

import {
  ENTITY_TYPES,
  QUESTION_KNOWLEDGE_RELATIONS,
  TYPED_RELATION_TYPES,
} from "./education-import-contracts.js";

const STORE_VERSION = "neo4j-education-graph-store@1.0";
const DEFAULT_DATABASE = "neo4j";
const DEFAULT_NAMESPACE = "education";
const MAX_BATCH_ROWS = 20_000;
const MAX_EXPAND_SEEDS = 50;
const MAX_EXPAND_RESULTS = 200;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,255}$/u;
const SAFE_RELATION_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;

export const NEO4J_EDUCATION_LABELS = Object.freeze({
  corpus: "EducationCorpus",
  release: "EducationCorpusRelease",
  document: "EducationDocument",
  revision: "EducationRevision",
  chunk: "EducationChunk",
  knowledgeUnit: "EducationKnowledgeUnit",
  question: "EducationQuestion",
});

const KNOWLEDGE_ENTITY_TYPES = new Set(ENTITY_TYPES.filter((entityType) => ![
  "question",
  "question_part",
  "question_blueprint",
  "artifact",
  "submission",
  "observation",
  "evidence_claim",
].includes(entityType)));

const CONTRACT_RELATION_TO_CYPHER = Object.freeze(Object.fromEntries(
  TYPED_RELATION_TYPES.map((relationType) => [relationType, relationType.toUpperCase()]),
));

const QUESTION_LINK_TO_CYPHER = Object.freeze(Object.fromEntries(
  QUESTION_KNOWLEDGE_RELATIONS.map((relationType) => [relationType, relationType.toUpperCase()]),
));

const EXPAND_RELATION_TO_CYPHER = Object.freeze({
  ...CONTRACT_RELATION_TO_CYPHER,
  ...QUESTION_LINK_TO_CYPHER,
  supported_by: "SUPPORTED_BY",
});

for (const relationType of Object.values(EXPAND_RELATION_TO_CYPHER)) {
  if (!SAFE_RELATION_TYPE_PATTERN.test(relationType)) {
    throw new TypeError(`Unsafe internal Neo4j relationship type: ${relationType}`);
  }
}

const SCHEMA_STATEMENTS = Object.freeze([
  `CREATE CONSTRAINT edu_corpus_graph_key IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.corpus}) REQUIRE n.graph_key IS UNIQUE`,
  `CREATE CONSTRAINT edu_release_graph_key IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.release}) REQUIRE n.graph_key IS UNIQUE`,
  `CREATE CONSTRAINT edu_document_graph_key IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.document}) REQUIRE n.graph_key IS UNIQUE`,
  `CREATE CONSTRAINT edu_revision_graph_key IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.revision}) REQUIRE n.graph_key IS UNIQUE`,
  `CREATE CONSTRAINT edu_chunk_graph_key IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.chunk}) REQUIRE n.graph_key IS UNIQUE`,
  `CREATE CONSTRAINT edu_knowledge_graph_key IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.knowledgeUnit}) REQUIRE n.graph_key IS UNIQUE`,
  `CREATE CONSTRAINT edu_question_graph_key IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.question}) REQUIRE n.graph_key IS UNIQUE`,
  `CREATE INDEX edu_document_scope IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.document}) ON (n.tenant_id, n.corpus_id, n.release_id)`,
  `CREATE INDEX edu_release_lookup IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.release}) ON (n.tenant_id, n.corpus_id, n.release_id)`,
  `CREATE INDEX edu_revision_scope IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.revision}) ON (n.tenant_id, n.namespace_id, n.document_id)`,
  `CREATE INDEX edu_chunk_revision IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.chunk}) ON (n.revision_scope_key)`,
  `CREATE INDEX edu_knowledge_revision IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.knowledgeUnit}) ON (n.revision_scope_key)`,
  `CREATE INDEX edu_question_revision IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.question}) ON (n.revision_scope_key)`,
  `CREATE INDEX edu_knowledge_lookup IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.knowledgeUnit}) ON (n.tenant_id, n.namespace_id, n.resource_id)`,
  `CREATE INDEX edu_question_lookup IF NOT EXISTS
   FOR (n:${NEO4J_EDUCATION_LABELS.question}) ON (n.tenant_id, n.namespace_id, n.resource_id)`,
]);

export class Neo4jEducationGraphError extends Error {
  constructor(code, message, { cause, status = 500 } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "Neo4jEducationGraphError";
    this.code = code;
    this.status = status;
  }
}

export class Neo4jEducationGraphConfigurationError extends Neo4jEducationGraphError {
  constructor(message = "Neo4j education graph storage is not configured.") {
    super("neo4j_education_graph_unconfigured", message, { status: 503 });
    this.name = "Neo4jEducationGraphConfigurationError";
  }
}

export class Neo4jEducationGraphValidationError extends Neo4jEducationGraphError {
  constructor(message) {
    super("neo4j_education_graph_input_invalid", message, { status: 422 });
    this.name = "Neo4jEducationGraphValidationError";
  }
}

/**
 * Returns configuration state without creating a driver or exposing credentials.
 */
export function neo4jEducationGraphConfigSummary({
  uri,
  username,
  password,
  database = DEFAULT_DATABASE,
} = {}) {
  const configured = [uri, username, password].every((value) =>
    typeof value === "string" && value.trim().length > 0
  );
  return {
    provider: "neo4j",
    store_version: STORE_VERSION,
    configured,
    database: safeDatabaseName(database),
    uri_scheme: configured ? safeUriScheme(uri) : null,
  };
}

export function neo4jEducationGraphConfigFromEnv(env = process.env) {
  return {
    uri: env.NEO4J_URI,
    username: env.NEO4J_USERNAME,
    password: env.NEO4J_PASSWORD,
    database: env.NEO4J_DATABASE || DEFAULT_DATABASE,
  };
}

export function createNeo4jEducationGraphStoreFromEnv(options = {}) {
  const { env = process.env, ...overrides } = options;
  return createNeo4jEducationGraphStore({
    ...neo4jEducationGraphConfigFromEnv(env),
    ...overrides,
  });
}

/**
 * Create an education graph adapter backed only by the official neo4j-driver.
 * Missing configuration throws immediately; there is deliberately no memory or
 * file fallback that could make an unpublished graph look durable.
 */
export function createNeo4jEducationGraphStore({
  uri,
  username,
  password,
  database = DEFAULT_DATABASE,
  driver: injectedDriver = null,
  ownsDriver = injectedDriver === null,
  now = () => new Date(),
  driverConfig,
} = {}) {
  let driver = injectedDriver;
  if (!driver) {
    const summary = neo4jEducationGraphConfigSummary({ uri, username, password, database });
    if (!summary.configured) throw new Neo4jEducationGraphConfigurationError();
    driver = neo4j.driver(
      uri.trim(),
      neo4j.auth.basic(username.trim(), password),
      {
        connectionTimeout: 1_500,
        connectionAcquisitionTimeout: 1_500,
        maxTransactionRetryTime: 0,
        ...driverConfig,
      },
    );
  }
  assertDriver(driver);
  const databaseName = safeDatabaseName(database);
  let closed = false;

  function assertOpen() {
    if (closed) {
      throw new Neo4jEducationGraphError(
        "neo4j_education_graph_closed",
        "The Neo4j education graph store is closed.",
        { status: 503 },
      );
    }
  }

  function configSummary() {
    return {
      provider: "neo4j",
      store_version: STORE_VERSION,
      configured: true,
      database: databaseName,
      uri_scheme: typeof uri === "string" ? safeUriScheme(uri) : "injected-driver",
      fail_closed: true,
      max_expand_hops: 2,
    };
  }

  async function health({ signal } = {}) {
    assertOpen();
    const startedAt = Date.now();
    try {
      // An authenticated read proves connectivity and database access in one
      // bounded session; verifyConnectivity has no caller cancellation API.
      await withSession(driver, databaseName, "read", async (session) => {
        const result = await session.executeRead((tx) => tx.run("RETURN 1 AS ok"), { timeout: 1_200 });
        const ok = result.records?.[0]?.get?.("ok");
        if (toNativeNumber(ok) !== 1) {
          throw new Error("Neo4j health query returned an unexpected result.");
        }
      }, { signal, timeoutMs: 1_500 });
      return {
        ok: true,
        provider: "neo4j",
        database: databaseName,
        latency_ms: Math.max(0, Date.now() - startedAt),
      };
    } catch (error) {
      throw wrapDriverError("neo4j_education_graph_unavailable", "Neo4j health check failed.", error, 503);
    }
  }

  async function initializeSchema() {
    assertOpen();
    try {
      await withSession(driver, databaseName, "write", (session) => session.executeWrite(async (tx) => {
        for (const statement of SCHEMA_STATEMENTS) await tx.run(statement);
      }));
      return { initialized: true, statement_count: SCHEMA_STATEMENTS.length };
    } catch (error) {
      throw wrapDriverError(
        "neo4j_education_schema_initialization_failed",
        "Neo4j education graph schema initialization failed.",
        error,
      );
    }
  }

  async function prepareRelease(input = {}) {
    assertOpen();
    const control = normalizeReleaseControl(input, now);
    try {
      return await withSession(driver, databaseName, "write", (session) =>
        session.executeWrite(async (tx) => {
          await runControlExpectedCount(tx, UPSERT_RELEASE_PREPARING_CYPHER, control, "release preparation");
          return {
            corpus_id: control.corpusId,
            release_id: control.releaseId,
            status: "preparing",
          };
        })
      );
    } catch (error) {
      if (error instanceof Neo4jEducationGraphError) throw error;
      throw wrapDriverError(
        "neo4j_education_release_prepare_failed",
        "Neo4j education corpus release preparation failed.",
        error,
      );
    }
  }

  async function setReleaseStatus(input = {}) {
    assertOpen();
    const control = normalizeReleaseControl(input, now);
    const status = input.status;
    if (!["ready", "retired", "failed"].includes(status)) {
      throw new Neo4jEducationGraphValidationError(
        "status must be ready, retired, or failed; preparing requires prepareRelease() and active requires activateRelease()",
      );
    }
    try {
      return await withSession(driver, databaseName, "write", (session) =>
        session.executeWrite(async (tx) => {
          const result = await tx.run(SET_RELEASE_STATUS_CYPHER, {
            corpusGraphKey: control.corpusGraphKey,
            releaseGraphKey: control.releaseGraphKey,
            status,
            now: control.now,
            ...scopeParams(control),
          });
          if (resultCount(result) !== 1) {
            throw new Neo4jEducationGraphError(
              "neo4j_education_release_transition_refused",
              "The release status transition was refused by its ACL or current state.",
              { status: 409 },
            );
          }
          return { corpus_id: control.corpusId, release_id: control.releaseId, status };
        })
      );
    } catch (error) {
      if (error instanceof Neo4jEducationGraphError) throw error;
      throw wrapDriverError(
        "neo4j_education_release_status_failed",
        "Neo4j education corpus release status update failed.",
        error,
      );
    }
  }

  async function activateRelease(input = {}) {
    assertOpen();
    const control = normalizeReleaseControl(input, now);
    try {
      return await withSession(driver, databaseName, "write", (session) =>
        session.executeWrite(async (tx) => {
          const result = await tx.run(ACTIVATE_RELEASE_CYPHER, {
            corpusGraphKey: control.corpusGraphKey,
            releaseGraphKey: control.releaseGraphKey,
            activeEdgeGraphKey: baseGraphKey(control, "active-release", control.corpusId),
            now: control.now,
            ...scopeParams(control),
          });
          if (resultCount(result) !== 1) {
            throw new Neo4jEducationGraphError(
              "neo4j_education_release_activation_refused",
              "Only an authorized ready release can be activated.",
              { status: 409 },
            );
          }
          return { corpus_id: control.corpusId, release_id: control.releaseId, status: "active" };
        })
      );
    } catch (error) {
      if (error instanceof Neo4jEducationGraphError) throw error;
      throw wrapDriverError(
        "neo4j_education_release_activation_failed",
        "Neo4j education corpus release activation failed and was rolled back.",
        error,
      );
    }
  }

  async function resolveActiveRelease(input = {}) {
    assertOpen();
    const scope = normalizeScope(input, { writeRequired: false });
    const corpusId = requireId(input.corpusId, "corpusId");
    const corpusGraphKey = baseGraphKey(scope, "corpus", corpusId);
    try {
      const result = await withSession(driver, databaseName, "read", (session) =>
        session.executeRead((tx) => tx.run(RESOLVE_ACTIVE_RELEASE_CYPHER, {
          corpusGraphKey,
          corpusId,
          ...scopeParams(scope),
        }), { timeout: 3_500 }),
      { signal: input.signal, timeoutMs: 4_000 });
      if (!result.records?.length) return null;
      const release = result.records[0].get("release")?.properties || {};
      return {
        corpus_id: corpusId,
        release_id: release.release_id,
        status: release.status,
        activated_at: release.activated_at || null,
      };
    } catch (error) {
      if (error instanceof Neo4jEducationGraphError) throw error;
      throw wrapDriverError(
        "neo4j_education_active_release_resolve_failed",
        "Neo4j active education corpus release lookup failed.",
        error,
      );
    }
  }

  /**
   * Atomically publish one document revision projection.
   *
   * Labels and relationship types are fixed by this module. Data supplied by a
   * model can never become Cypher syntax. Re-publishing the same keys is an
   * idempotent upsert, while ACL checks prevent an existing node being replaced
   * by a principal that lacks write access.
   */
  async function publishGraph(input = {}) {
    assertOpen();
    const graph = normalizePublishedGraph(input, now);
    try {
      return await withSession(driver, databaseName, "write", (session) =>
        session.executeWrite(async (tx) => publishGraphTransaction(tx, graph))
      );
    } catch (error) {
      if (error instanceof Neo4jEducationGraphError) throw error;
      throw wrapDriverError(
        "neo4j_education_graph_publish_failed",
        "Neo4j education graph publication failed and was rolled back.",
        error,
      );
    }
  }

  async function deleteRevision(input = {}) {
    assertOpen();
    const scope = normalizeReleaseScope(input);
    const documentId = requireId(input.documentId, "documentId");
    const revisionId = requireId(input.revisionId, "revisionId");
    const revisionGraphKey = graphKey(scope, "revision", revisionId);
    const revisionScopeKey = graphKey(scope, "revision-scope", revisionId);
    try {
      return await withSession(driver, databaseName, "write", (session) =>
        session.executeWrite(async (tx) => {
          const preflight = await tx.run(
            `MATCH (release:${NEO4J_EDUCATION_LABELS.release} {graph_key: $releaseGraphKey})
             WHERE release.status <> "active"
               AND release.tenant_id = $tenantId AND release.namespace_id = $namespaceId
               AND release.corpus_id = $corpusId AND release.release_id = $releaseId
               AND $principalId IN coalesce(release.acl_write, [])
             MATCH (r:${NEO4J_EDUCATION_LABELS.revision} {graph_key: $revisionGraphKey})
             WHERE r.tenant_id = $tenantId AND r.namespace_id = $namespaceId
               AND r.corpus_id = $corpusId AND r.release_id = $releaseId
               AND r.document_id = $documentId
             OPTIONAL MATCH (n)
             WHERE n.revision_scope_key = $revisionScopeKey
               AND n.tenant_id = $tenantId AND n.namespace_id = $namespaceId
               AND n.corpus_id = $corpusId AND n.release_id = $releaseId
             RETURN r,
                    count(n) AS total,
                    count(CASE WHEN $principalId IN coalesce(n.acl_write, []) THEN 1 END) AS writable`,
            {
              revisionGraphKey,
              revisionScopeKey,
              releaseGraphKey: scope.releaseGraphKey,
              documentId,
              ...scopeParams(scope),
            },
          );
          if (!preflight.records?.length) {
            throw new Neo4jEducationGraphError(
              "neo4j_education_revision_not_found",
              "The requested education graph revision was not found in this tenant namespace.",
              { status: 404 },
            );
          }
          const revisionNode = preflight.records[0].get("r");
          if (!canWriteNode(revisionNode, scope.principalId)) {
            throw new Neo4jEducationGraphError(
              "neo4j_education_graph_forbidden",
              "The current principal cannot delete this education graph revision.",
              { status: 403 },
            );
          }
          const total = toNativeNumber(preflight.records[0].get("total"));
          const writable = toNativeNumber(preflight.records[0].get("writable"));
          if (total !== writable) {
            throw new Neo4jEducationGraphError(
              "neo4j_education_graph_acl_conflict",
              "Revision deletion was refused because one or more child nodes have incompatible ACLs.",
              { status: 409 },
            );
          }

          let deleted = 0;
          for (const label of [
            NEO4J_EDUCATION_LABELS.chunk,
            NEO4J_EDUCATION_LABELS.knowledgeUnit,
            NEO4J_EDUCATION_LABELS.question,
          ]) {
            const result = await tx.run(
              `MATCH (n:${label} {revision_scope_key: $revisionScopeKey})
               WHERE n.tenant_id = $tenantId AND n.namespace_id = $namespaceId
                 AND n.corpus_id = $corpusId AND n.release_id = $releaseId
                 AND $principalId IN coalesce(n.acl_write, [])
               DETACH DELETE n
               RETURN count(n) AS count`,
              { revisionScopeKey, ...scopeParams(scope) },
            );
            deleted += resultCount(result);
          }
          const revisionDelete = await tx.run(
            `MATCH (r:${NEO4J_EDUCATION_LABELS.revision} {graph_key: $revisionGraphKey})
             WHERE r.tenant_id = $tenantId AND r.namespace_id = $namespaceId
               AND r.corpus_id = $corpusId AND r.release_id = $releaseId
               AND r.document_id = $documentId
               AND $principalId IN coalesce(r.acl_write, [])
             DETACH DELETE r
             RETURN count(r) AS count`,
            {
              revisionGraphKey,
              documentId,
              ...scopeParams(scope),
            },
          );
          const revisionCount = resultCount(revisionDelete);
          if (revisionCount !== 1) {
            throw new Neo4jEducationGraphError(
              "neo4j_education_graph_acl_conflict",
              "Revision deletion lost its write authorization and was rolled back.",
              { status: 409 },
            );
          }
          return { deleted_nodes: deleted + revisionCount, revision_id: revisionId };
        })
      );
    } catch (error) {
      if (error instanceof Neo4jEducationGraphError) throw error;
      throw wrapDriverError(
        "neo4j_education_graph_delete_failed",
        "Neo4j education revision deletion failed and was rolled back.",
        error,
      );
    }
  }

  /**
   * Expand only approved education relationships by exactly one or two hops.
   * The relationship alternation and hop bound are selected from internal
   * whitelists after validation; neither is interpolated from raw caller text.
   */
  async function expand(input = {}) {
    assertOpen();
    const scope = normalizeReleaseScope(input, { writeRequired: false });
    const seedIds = normalizeIdArray(input.seedIds, "seedIds", { min: 1, max: MAX_EXPAND_SEEDS });
    const hops = input.hops === undefined ? 1 : Number(input.hops);
    if (![1, 2].includes(hops)) {
      throw new Neo4jEducationGraphValidationError("hops must be exactly 1 or 2");
    }
    const limit = normalizeInteger(input.limit, "limit", { min: 1, max: MAX_EXPAND_RESULTS, fallback: 50 });
    const relationTypes = normalizeExpandRelationTypes(input.relationTypes);
    const cypherRelationTypes = relationTypes.map((type) => EXPAND_RELATION_TO_CYPHER[type]);
    const relationshipPattern = `:${cypherRelationTypes.join("|")}`;
    const revisionScopeKey = input.revisionId
      ? graphKey(scope, "revision-scope", requireId(input.revisionId, "revisionId"))
      : null;
    const query = `MATCH (corpus:${NEO4J_EDUCATION_LABELS.corpus} {graph_key: $corpusGraphKey})
        -[active:ACTIVE_RELEASE]->
        (release:${NEO4J_EDUCATION_LABELS.release} {graph_key: $releaseGraphKey})
      WHERE release.status = "active"
        AND corpus.tenant_id = $tenantId AND corpus.namespace_id = $namespaceId
        AND corpus.corpus_id = $corpusId
        AND release.tenant_id = $tenantId AND release.namespace_id = $namespaceId
        AND release.corpus_id = $corpusId AND release.release_id = $releaseId
        AND active.corpus_id = $corpusId AND active.release_id = $releaseId
        AND ANY(p IN $readPrincipals WHERE p IN coalesce(corpus.acl_read, []))
        AND ANY(p IN $readPrincipals WHERE p IN coalesce(release.acl_read, []))
      MATCH (seed)
      WHERE (seed:${NEO4J_EDUCATION_LABELS.chunk}
          OR seed:${NEO4J_EDUCATION_LABELS.knowledgeUnit}
          OR seed:${NEO4J_EDUCATION_LABELS.question})
        AND seed.tenant_id = $tenantId AND seed.namespace_id = $namespaceId
        AND seed.corpus_id = $corpusId AND seed.release_id = $releaseId
        AND (seed.resource_id IN $seedIds OR seed.question_id IN $seedIds)
        AND ($revisionScopeKey IS NULL OR seed.revision_scope_key = $revisionScopeKey)
        AND ANY(principal IN $readPrincipals WHERE principal IN coalesce(seed.acl_read, []))
      OPTIONAL MATCH p=(seed)-[${relationshipPattern}*1..${hops}]-(neighbor)
      WHERE neighbor IS NULL OR ALL(n IN nodes(p) WHERE
        n.tenant_id = $tenantId AND n.namespace_id = $namespaceId
        AND n.corpus_id = $corpusId AND n.release_id = $releaseId
        AND ($revisionScopeKey IS NULL OR n.revision_scope_key = $revisionScopeKey)
        AND ANY(principal IN $readPrincipals WHERE principal IN coalesce(n.acl_read, [])))
        AND ALL(r IN relationships(p) WHERE
          r.tenant_id = $tenantId AND r.namespace_id = $namespaceId
          AND r.corpus_id = $corpusId AND r.release_id = $releaseId
          AND ($revisionScopeKey IS NULL OR r.revision_scope_key = $revisionScopeKey))
      RETURN seed, p
      LIMIT $limit`;
    try {
      const result = await withSession(driver, databaseName, "read", (session) =>
        session.executeRead((tx) => tx.run(query, {
          seedIds,
          corpusGraphKey: scope.corpusGraphKey,
          releaseGraphKey: scope.releaseGraphKey,
          revisionScopeKey,
          limit: neo4j.int(limit),
          ...scopeParams(scope),
        }), { timeout: 3_500 }),
      { signal: input.signal, timeoutMs: 4_000 });
      return graphExpansionFromRecords(result.records || []);
    } catch (error) {
      if (error instanceof Neo4jEducationGraphError) throw error;
      throw wrapDriverError(
        "neo4j_education_graph_expand_failed",
        "Neo4j education graph expansion failed.",
        error,
      );
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    if (ownsDriver) await driver.close();
  }

  return Object.freeze({
    configSummary,
    health,
    initializeSchema,
    prepareRelease,
    setReleaseStatus,
    publishGraph,
    activateRelease,
    resolveActiveRelease,
    deleteRevision,
    expand,
    close,
  });
}

/**
 * Convert the existing import contracts into the stable publishGraph payload.
 * This is a pure projection only; it never opens a database connection.
 */
export function projectEducationImportGraph({ documentIR, candidatePack } = {}) {
  if (!documentIR || typeof documentIR !== "object") {
    throw new Neo4jEducationGraphValidationError("documentIR is required");
  }
  if (!candidatePack || typeof candidatePack !== "object") {
    throw new Neo4jEducationGraphValidationError("candidatePack is required");
  }
  if (candidatePack.document_id !== documentIR.id
    || candidatePack.document_revision_id !== documentIR.revision_id) {
    throw new Neo4jEducationGraphValidationError("candidatePack does not belong to documentIR");
  }
  return {
    document: {
      id: documentIR.id,
      title: documentIR.title,
      document_type: documentIR.document_type,
      language: documentIR.language,
      subject: documentIR.subject,
      grade_band: documentIR.grade_band,
      source_file_name: documentIR.source_file?.file_name,
      source_sha256: documentIR.source_file?.sha256,
    },
    revision: {
      id: documentIR.revision_id,
      document_id: documentIR.id,
      recorded_at: documentIR.provenance?.recorded_at,
      review_status: documentIR.review_status,
      confidence: documentIR.confidence?.overall,
    },
    chunks: documentIR.pages.flatMap((page) => page.blocks.map((block) => ({
      id: block.id,
      page_index: page.index,
      reading_order: block.reading_order,
      block_type: block.type,
      text: block.text,
      layer: block.layer,
      extraction_method: block.extraction?.method,
      confidence: block.extraction?.confidence,
    }))),
    knowledgeUnits: [...(candidatePack.candidates?.curriculum_standards || [])],
    questions: [...(candidatePack.candidates?.questions || [])],
    relations: [...(candidatePack.candidates?.typed_relations || [])],
    questionLinks: [...(candidatePack.candidates?.question_knowledge_links || [])],
  };
}

async function publishGraphTransaction(tx, graph) {
  await runControlExpectedCount(tx, UPSERT_RELEASE_PREPARING_CYPHER, graph.scope, "release preparation");
  await runExpectedCount(tx, UPSERT_DOCUMENT_CYPHER, [graph.document], graph.scope, "documents");
  await runExpectedCount(tx, UPSERT_REVISION_CYPHER, [graph.revision], graph.scope, "revisions");
  await runExpectedCount(tx, LINK_DOCUMENT_REVISION_CYPHER, [{
    document_graph_key: graph.document.graph_key,
    revision_graph_key: graph.revision.graph_key,
    graph_key: graph.revision.membership_edge_key,
    revision_scope_key: graph.revisionScopeKey,
  }], graph.scope, "document revision memberships");

  for (const rows of batchRows(graph.chunks)) {
    await runExpectedCount(tx, UPSERT_CHUNKS_CYPHER, rows, graph.scope, "chunks");
  }
  for (const rows of batchRows(graph.knowledgeUnits)) {
    await runExpectedCount(tx, UPSERT_KNOWLEDGE_CYPHER, rows, graph.scope, "knowledge units");
  }
  for (const rows of batchRows(graph.questions)) {
    await runExpectedCount(tx, UPSERT_QUESTIONS_CYPHER, rows, graph.scope, "questions");
  }

  for (const group of graph.relationGroups) {
    const cypher = relationUpsertCypher(group.sourceLabel, group.targetLabel, group.cypherType);
    for (const rows of batchRows(group.rows)) {
      await runExpectedCount(tx, cypher, rows, graph.scope, `${group.contractType} relations`);
    }
  }
  for (const group of graph.questionLinkGroups) {
    const cypher = relationUpsertCypher(
      NEO4J_EDUCATION_LABELS.question,
      NEO4J_EDUCATION_LABELS.knowledgeUnit,
      group.cypherType,
    );
    for (const rows of batchRows(group.rows)) {
      await runExpectedCount(tx, cypher, rows, graph.scope, `${group.contractType} question links`);
    }
  }
  for (const group of graph.sourceLinkGroups) {
    const cypher = sourceLinkUpsertCypher(group.sourceLabel);
    for (const rows of batchRows(group.rows)) {
      await runExpectedCount(tx, cypher, rows, graph.scope, `${group.sourceLabel} source links`);
    }
  }
  const readyResult = await tx.run(MARK_RELEASE_READY_CYPHER, {
    releaseGraphKey: graph.scope.releaseGraphKey,
    chunkCount: graph.chunks.length,
    knowledgeUnitCount: graph.knowledgeUnits.length,
    questionCount: graph.questions.length,
    relationCount: graph.relationGroups.reduce((sum, group) => sum + group.rows.length, 0),
    questionLinkCount: graph.questionLinkGroups.reduce((sum, group) => sum + group.rows.length, 0),
    graphDigest: graph.scope.graphDigest,
    now: graph.now,
    ...scopeParams(graph.scope),
  });
  if (resultCount(readyResult) !== 1) {
    throw new Neo4jEducationGraphError(
      "neo4j_education_release_transition_refused",
      "The graph was not marked ready; publication was rolled back.",
      { status: 409 },
    );
  }
  return {
    corpus_id: graph.scope.corpusId,
    release_id: graph.scope.releaseId,
    document_id: graph.document.resource_id,
    revision_id: graph.revision.resource_id,
    counts: {
      chunks: graph.chunks.length,
      knowledge_units: graph.knowledgeUnits.length,
      questions: graph.questions.length,
      relations: graph.relationGroups.reduce((sum, group) => sum + group.rows.length, 0),
      question_links: graph.questionLinkGroups.reduce((sum, group) => sum + group.rows.length, 0),
      source_links: graph.sourceLinkGroups.reduce((sum, group) => sum + group.rows.length, 0),
    },
  };
}

const UPSERT_RELEASE_PREPARING_CYPHER = `
  MERGE (corpus:${NEO4J_EDUCATION_LABELS.corpus} {graph_key: $corpusGraphKey})
  ON CREATE SET corpus.created_at = $now, corpus.created_by = $principalId,
                corpus.acl_read = $readPrincipals, corpus.acl_write = $writePrincipals
  WITH corpus
  WHERE corpus.created_by = $principalId OR $principalId IN coalesce(corpus.acl_write, [])
  SET corpus.tenant_id = $tenantId, corpus.namespace_id = $namespaceId,
      corpus.corpus_id = $corpusId, corpus.visibility = $visibility,
      corpus.acl_read = $readPrincipals, corpus.acl_write = $writePrincipals,
      corpus.updated_at = $now
  MERGE (release:${NEO4J_EDUCATION_LABELS.release} {graph_key: $releaseGraphKey})
  ON CREATE SET release.created_at = $now, release.created_by = $principalId,
                release.status = "preparing",
                release.acl_read = $readPrincipals, release.acl_write = $writePrincipals
  WITH corpus, release
  WHERE (release.created_by = $principalId OR $principalId IN coalesce(release.acl_write, []))
    AND release.status IN ["preparing", "ready", "failed"]
    AND ($graphDigest IS NULL OR release.graph_manifest_hash IS NULL
      OR release.graph_manifest_hash = $graphDigest)
  SET release.tenant_id = $tenantId, release.namespace_id = $namespaceId,
      release.corpus_id = $corpusId, release.release_id = $releaseId,
      release.visibility = $visibility,
      release.acl_read = $readPrincipals, release.acl_write = $writePrincipals,
      release.status = "preparing",
      release.graph_status = CASE WHEN $graphDigest IS NULL
        THEN release.graph_status ELSE "preparing" END,
      release.updated_at = $now
  MERGE (corpus)-[membership:HAS_RELEASE {graph_key: $releaseMembershipGraphKey}]->(release)
  SET membership.tenant_id = $tenantId, membership.namespace_id = $namespaceId,
      membership.corpus_id = $corpusId, membership.release_id = $releaseId,
      membership.updated_at = $now
  RETURN count(release) AS count`;

const MARK_RELEASE_READY_CYPHER = `
  MATCH (release:${NEO4J_EDUCATION_LABELS.release} {graph_key: $releaseGraphKey})
  WHERE release.tenant_id = $tenantId AND release.namespace_id = $namespaceId
    AND release.corpus_id = $corpusId AND release.release_id = $releaseId
    AND $principalId IN coalesce(release.acl_write, [])
    AND release.status = "preparing"
  SET release.status = "ready", release.graph_status = "ready",
      release.graph_chunk_count = $chunkCount,
      release.graph_knowledge_unit_count = $knowledgeUnitCount,
      release.graph_question_count = $questionCount,
      release.graph_relation_count = $relationCount,
      release.graph_question_link_count = $questionLinkCount,
      release.graph_manifest_hash = $graphDigest,
      release.ready_at = $now, release.updated_at = $now
  RETURN count(release) AS count`;

const SET_RELEASE_STATUS_CYPHER = `
  MATCH (corpus:${NEO4J_EDUCATION_LABELS.corpus} {graph_key: $corpusGraphKey})
        -[:HAS_RELEASE]->
        (release:${NEO4J_EDUCATION_LABELS.release} {graph_key: $releaseGraphKey})
  WHERE corpus.tenant_id = $tenantId AND corpus.namespace_id = $namespaceId
    AND release.corpus_id = $corpusId AND release.release_id = $releaseId
    AND $principalId IN coalesce(corpus.acl_write, [])
    AND $principalId IN coalesce(release.acl_write, [])
    AND release.status <> "active"
    AND ($status <> "ready" OR release.graph_status = "ready")
  SET release.status = $status, release.updated_at = $now
  RETURN count(release) AS count`;

const ACTIVATE_RELEASE_CYPHER = `
  MATCH (corpus:${NEO4J_EDUCATION_LABELS.corpus} {graph_key: $corpusGraphKey})
        -[:HAS_RELEASE]->
        (target:${NEO4J_EDUCATION_LABELS.release} {graph_key: $releaseGraphKey})
  WHERE corpus.tenant_id = $tenantId AND corpus.namespace_id = $namespaceId
    AND target.corpus_id = $corpusId AND target.release_id = $releaseId
    AND $principalId IN coalesce(corpus.acl_write, [])
    AND $principalId IN coalesce(target.acl_write, [])
    AND target.status IN ["ready", "active"]
    AND target.graph_status = "ready"
  OPTIONAL MATCH (corpus)-[oldEdge:ACTIVE_RELEASE]->(current:${NEO4J_EDUCATION_LABELS.release})
  WITH corpus, target, collect(oldEdge) AS oldEdges, collect(current) AS previousReleases
  FOREACH (previous IN previousReleases |
    SET previous.status = CASE WHEN previous.graph_key = target.graph_key THEN previous.status ELSE "retired" END,
        previous.retired_at = CASE WHEN previous.graph_key = target.graph_key THEN previous.retired_at ELSE $now END,
        previous.updated_at = $now)
  FOREACH (edge IN oldEdges | DELETE edge)
  MERGE (corpus)-[active:ACTIVE_RELEASE {graph_key: $activeEdgeGraphKey}]->(target)
  SET active.tenant_id = $tenantId, active.namespace_id = $namespaceId,
      active.corpus_id = $corpusId, active.release_id = $releaseId,
      active.updated_at = $now,
      target.status = "active", target.activated_at = $now, target.updated_at = $now
  RETURN count(target) AS count`;

const RESOLVE_ACTIVE_RELEASE_CYPHER = `
  MATCH (corpus:${NEO4J_EDUCATION_LABELS.corpus} {graph_key: $corpusGraphKey})
        -[active:ACTIVE_RELEASE]->
        (release:${NEO4J_EDUCATION_LABELS.release})
  WHERE corpus.tenant_id = $tenantId AND corpus.namespace_id = $namespaceId
    AND corpus.corpus_id = $corpusId
    AND release.tenant_id = $tenantId AND release.namespace_id = $namespaceId
    AND release.corpus_id = $corpusId AND release.status = "active"
    AND active.corpus_id = $corpusId
    AND ANY(p IN $readPrincipals WHERE p IN coalesce(corpus.acl_read, []))
    AND ANY(p IN $readPrincipals WHERE p IN coalesce(release.acl_read, []))
  RETURN release LIMIT 1`;

const COMMON_CREATE_AND_AUTH_CYPHER = `
  ON CREATE SET n.created_at = $now, n.created_by = $principalId,
                n.acl_read = $readPrincipals, n.acl_write = $writePrincipals
  WITH n, row
  WHERE n.created_by = $principalId OR $principalId IN coalesce(n.acl_write, [])
  SET n.tenant_id = $tenantId,
      n.namespace_id = $namespaceId,
      n.corpus_id = $corpusId,
      n.release_id = $releaseId,
      n.visibility = $visibility,
      n.acl_read = $readPrincipals,
      n.acl_write = $writePrincipals,
      n.updated_at = $now`;

const UPSERT_DOCUMENT_CYPHER = `UNWIND $rows AS row
  MERGE (n:${NEO4J_EDUCATION_LABELS.document} {graph_key: row.graph_key})
  ${COMMON_CREATE_AND_AUTH_CYPHER}
  SET n.resource_id = row.resource_id,
      n.title = row.title,
      n.document_type = row.document_type,
      n.language = row.language,
      n.subject = row.subject,
      n.grade_band = row.grade_band,
      n.source_file_name = row.source_file_name,
      n.source_sha256 = row.source_sha256
  RETURN count(n) AS count`;

const UPSERT_REVISION_CYPHER = `UNWIND $rows AS row
  MERGE (n:${NEO4J_EDUCATION_LABELS.revision} {graph_key: row.graph_key})
  ${COMMON_CREATE_AND_AUTH_CYPHER}
  SET n.resource_id = row.resource_id,
      n.document_id = row.document_id,
      n.revision_scope_key = row.revision_scope_key,
      n.recorded_at = row.recorded_at,
      n.review_status = row.review_status,
      n.confidence = row.confidence
  RETURN count(n) AS count`;

const LINK_DOCUMENT_REVISION_CYPHER = `UNWIND $rows AS row
  MATCH (d:${NEO4J_EDUCATION_LABELS.document} {graph_key: row.document_graph_key})
  MATCH (r:${NEO4J_EDUCATION_LABELS.revision} {graph_key: row.revision_graph_key})
  WHERE $principalId IN coalesce(d.acl_write, []) AND $principalId IN coalesce(r.acl_write, [])
  MERGE (d)-[rel:HAS_REVISION {graph_key: row.graph_key}]->(r)
  SET rel.tenant_id = $tenantId, rel.namespace_id = $namespaceId,
      rel.corpus_id = $corpusId, rel.release_id = $releaseId,
      rel.revision_scope_key = row.revision_scope_key, rel.updated_at = $now
  RETURN count(rel) AS count`;

const UPSERT_CHUNKS_CYPHER = memberUpsertCypher(
  NEO4J_EDUCATION_LABELS.chunk,
  "HAS_CHUNK",
  [
    "resource_id", "revision_scope_key", "page_index", "reading_order", "block_type",
    "text", "layer", "extraction_method", "confidence",
  ],
);

const UPSERT_KNOWLEDGE_CYPHER = memberUpsertCypher(
  NEO4J_EDUCATION_LABELS.knowledgeUnit,
  "HAS_KNOWLEDGE_UNIT",
  [
    "resource_id", "revision_scope_key", "entity_type", "name", "statement", "knowledge_form",
    "aliases", "action_verb", "confidence", "review_status",
  ],
);

const UPSERT_QUESTIONS_CYPHER = memberUpsertCypher(
  NEO4J_EDUCATION_LABELS.question,
  "HAS_QUESTION",
  [
    "resource_id", "question_id", "question_revision_id", "revision_scope_key", "question_type",
    "language", "stem", "stimulus", "part_ids", "confidence", "review_status",
  ],
);

function memberUpsertCypher(label, membershipType, properties) {
  const propertySet = properties.map((property) => `n.${property} = row.${property}`).join(",\n      ");
  return `UNWIND $rows AS row
    MATCH (revision:${NEO4J_EDUCATION_LABELS.revision} {graph_key: row.revision_graph_key})
    WHERE $principalId IN coalesce(revision.acl_write, [])
    MERGE (n:${label} {graph_key: row.graph_key})
    ON CREATE SET n.created_at = $now, n.created_by = $principalId,
                  n.acl_read = $readPrincipals, n.acl_write = $writePrincipals
    WITH revision, n, row
    WHERE n.created_by = $principalId OR $principalId IN coalesce(n.acl_write, [])
    SET n.tenant_id = $tenantId,
        n.namespace_id = $namespaceId,
        n.corpus_id = $corpusId,
        n.release_id = $releaseId,
        n.visibility = $visibility,
        n.acl_read = $readPrincipals,
        n.acl_write = $writePrincipals,
        n.updated_at = $now
    SET ${propertySet}
    MERGE (revision)-[membership:${membershipType} {graph_key: row.membership_edge_key}]->(n)
    SET membership.tenant_id = $tenantId, membership.namespace_id = $namespaceId,
        membership.corpus_id = $corpusId, membership.release_id = $releaseId,
        membership.revision_scope_key = row.revision_scope_key, membership.updated_at = $now
    RETURN count(n) AS count`;
}

function relationUpsertCypher(sourceLabel, targetLabel, relationshipType) {
  assertInternalLabel(sourceLabel);
  assertInternalLabel(targetLabel);
  assertInternalRelationshipType(relationshipType);
  return `UNWIND $rows AS row
    MATCH (source:${sourceLabel} {graph_key: row.source_graph_key})
    MATCH (target:${targetLabel} {graph_key: row.target_graph_key})
    WHERE $principalId IN coalesce(source.acl_write, [])
      AND $principalId IN coalesce(target.acl_write, [])
    MERGE (source)-[rel:${relationshipType} {graph_key: row.graph_key}]->(target)
    SET rel.tenant_id = $tenantId,
        rel.namespace_id = $namespaceId,
        rel.corpus_id = $corpusId,
        rel.release_id = $releaseId,
        rel.revision_scope_key = row.revision_scope_key,
        rel.resource_id = row.resource_id,
        rel.contract_type = row.contract_type,
        rel.scope = row.scope,
        rel.role = row.role,
        rel.weight = row.weight,
        rel.part_id = row.part_id,
        rel.source_part_id = row.source_part_id,
        rel.target_part_id = row.target_part_id,
        rel.observable_indicator = row.observable_indicator,
        rel.mapping_method = row.mapping_method,
        rel.source_block_ids = row.source_block_ids,
        rel.source_page_indexes = row.source_page_indexes,
        rel.confidence = row.confidence,
        rel.review_status = row.review_status,
        rel.updated_at = $now
    RETURN count(rel) AS count`;
}

function sourceLinkUpsertCypher(sourceLabel) {
  assertInternalLabel(sourceLabel);
  return `UNWIND $rows AS row
    MATCH (source:${sourceLabel} {graph_key: row.source_graph_key})
    MATCH (chunk:${NEO4J_EDUCATION_LABELS.chunk} {graph_key: row.chunk_graph_key})
    WHERE $principalId IN coalesce(source.acl_write, [])
      AND $principalId IN coalesce(chunk.acl_write, [])
    MERGE (source)-[rel:SUPPORTED_BY {graph_key: row.graph_key}]->(chunk)
    SET rel.tenant_id = $tenantId,
        rel.namespace_id = $namespaceId,
        rel.corpus_id = $corpusId,
        rel.release_id = $releaseId,
        rel.revision_scope_key = row.revision_scope_key,
        rel.page_index = row.page_index,
        rel.updated_at = $now
    RETURN count(rel) AS count`;
}

function normalizePublishedGraph(input, now) {
  const normalizedScope = normalizeScope(input);
  const nowValue = normalizeNow(now);
  const corpusId = requireId(input.corpusId, "corpusId");
  const releaseId = requireId(input.releaseId, "releaseId");
  const scope = {
    ...normalizedScope,
    corpusId,
    releaseId,
    corpusGraphKey: baseGraphKey(normalizedScope, "corpus", corpusId),
    releaseGraphKey: baseGraphKey(normalizedScope, "release", corpusId, releaseId),
    releaseMembershipGraphKey: baseGraphKey(normalizedScope, "has-release", corpusId, releaseId),
    now: nowValue,
  };
  const document = normalizeDocument(input.document, scope);
  const revision = normalizeRevision(input.revision, document, scope);
  const revisionScopeKey = revision.revision_scope_key;
  const common = { scope, document, revision, revisionScopeKey, now: nowValue };
  const chunks = normalizeArray(input.chunks, "chunks", MAX_BATCH_ROWS * 5)
    .map((chunk) => normalizeChunk(chunk, common));
  const knowledgeUnits = normalizeArray(input.knowledgeUnits, "knowledgeUnits", MAX_BATCH_ROWS * 5)
    .map((unit) => normalizeKnowledgeUnit(unit, common));
  const questions = normalizeArray(input.questions, "questions", MAX_BATCH_ROWS * 5)
    .map((question) => normalizeQuestion(question, common));
  assertUniqueRows(chunks, "chunks");
  assertUniqueRows(knowledgeUnits, "knowledgeUnits");
  assertUniqueRows(questions, "questions", "question_id");

  const chunkMap = new Map(chunks.map((row) => [row.resource_id, row]));
  const knowledgeMap = new Map(knowledgeUnits.map((row) => [row.resource_id, row]));
  const questionMap = new Map(questions.map((row) => [row.question_id, row]));
  const questionPartMap = buildQuestionPartMap(questions);
  const relations = normalizeArray(input.relations, "relations", MAX_BATCH_ROWS * 5)
    .map((relation) => normalizeRelation(
      relation,
      common,
      knowledgeMap,
      questionMap,
      questionPartMap,
    ));
  const questionLinks = normalizeArray(input.questionLinks, "questionLinks", MAX_BATCH_ROWS * 5)
    .map((link) => normalizeQuestionLink(link, common, knowledgeMap, questionMap));
  assertUniqueRows(relations, "relations");
  assertUniqueRows(questionLinks, "questionLinks");
  assertAnchorChunksPresent(relations, chunkMap, "relation");
  assertAnchorChunksPresent(questionLinks, chunkMap, "questionLink");
  scope.graphDigest = graphPublicationDigest({
    access: {
      tenant_id: scope.tenantId,
      namespace_id: scope.namespaceId,
      corpus_id: scope.corpusId,
      release_id: scope.releaseId,
      visibility: scope.visibility,
      acl_read: scope.readPrincipals,
      acl_write: scope.writePrincipals,
    },
    document,
    revision,
    chunks,
    knowledgeUnits,
    questions,
    relations,
    questionLinks,
  });

  return {
    ...common,
    chunks,
    knowledgeUnits,
    questions,
    relationGroups: groupRelations(relations),
    questionLinkGroups: groupQuestionLinks(questionLinks),
    sourceLinkGroups: buildSourceLinkGroups({
      scope,
      revisionScopeKey,
      chunks: chunkMap,
      knowledgeUnits,
      questions,
    }),
  };
}

function normalizeScope(input, { writeRequired = true } = {}) {
  const tenantId = requireId(input.tenantId, "tenantId");
  const namespaceId = requireId(input.namespaceId || DEFAULT_NAMESPACE, "namespaceId");
  const principalId = requireId(input.principalId, "principalId");
  const readPrincipals = normalizeIdArray(
    input.readPrincipals === undefined ? [principalId] : input.readPrincipals,
    "readPrincipals",
    { min: 1, max: 200 },
  );
  const writePrincipals = normalizeIdArray(
    input.writePrincipals === undefined ? [principalId] : input.writePrincipals,
    "writePrincipals",
    { min: writeRequired ? 1 : 0, max: 200 },
  );
  if (writeRequired && !writePrincipals.includes(principalId)) {
    throw new Neo4jEducationGraphValidationError("principalId must be present in writePrincipals");
  }
  const visibility = input.visibility || "private";
  if (!["private", "tenant", "public"].includes(visibility)) {
    throw new Neo4jEducationGraphValidationError("visibility must be private, tenant, or public");
  }
  return { tenantId, namespaceId, principalId, readPrincipals, writePrincipals, visibility };
}

function normalizeReleaseScope(input, options) {
  const scope = normalizeScope(input, options);
  const corpusId = requireId(input.corpusId, "corpusId");
  const releaseId = requireId(input.releaseId, "releaseId");
  return {
    ...scope,
    corpusId,
    releaseId,
    corpusGraphKey: baseGraphKey(scope, "corpus", corpusId),
    releaseGraphKey: baseGraphKey(scope, "release", corpusId, releaseId),
    releaseMembershipGraphKey: baseGraphKey(scope, "has-release", corpusId, releaseId),
  };
}

function normalizeReleaseControl(input, now) {
  const scope = normalizeReleaseScope(input);
  return { ...scope, now: normalizeNow(now) };
}

function normalizeDocument(value, scope) {
  assertPlainObject(value, "document");
  const resourceId = requireId(value.id, "document.id");
  return compactProperties({
    graph_key: graphKey(scope, "document", resourceId),
    resource_id: resourceId,
    title: requiredText(value.title, "document.title", 500),
    document_type: optionalText(value.document_type || value.documentType, "document.document_type", 80),
    language: optionalText(value.language, "document.language", 40),
    subject: optionalText(value.subject, "document.subject", 120),
    grade_band: optionalText(value.grade_band || value.gradeBand, "document.grade_band", 120),
    source_file_name: optionalText(value.source_file_name || value.sourceFileName, "document.source_file_name", 500),
    source_sha256: optionalSha256(value.source_sha256 || value.sourceSha256, "document.source_sha256"),
  });
}

function normalizeRevision(value, document, scope) {
  assertPlainObject(value, "revision");
  const resourceId = requireId(value.id, "revision.id");
  const documentId = requireId(value.document_id || value.documentId || document.resource_id, "revision.document_id");
  if (documentId !== document.resource_id) {
    throw new Neo4jEducationGraphValidationError("revision.document_id must equal document.id");
  }
  const revisionScopeKey = graphKey(scope, "revision-scope", resourceId);
  return compactProperties({
    graph_key: graphKey(scope, "revision", resourceId),
    resource_id: resourceId,
    document_id: documentId,
    revision_scope_key: revisionScopeKey,
    recorded_at: optionalDateTime(value.recorded_at || value.recordedAt, "revision.recorded_at"),
    review_status: requireVerifiedStatus(value.review_status || value.reviewStatus, "revision.review_status"),
    confidence: optionalUnitNumber(value.confidence, "revision.confidence"),
    membership_edge_key: graphKey(scope, "has-revision", documentId, resourceId),
  });
}

function normalizeChunk(value, graph) {
  assertPlainObject(value, "chunk");
  const resourceId = requireId(value.id, "chunk.id");
  return compactProperties({
    graph_key: graphKey(graph.scope, "chunk", graph.revision.resource_id, resourceId),
    resource_id: resourceId,
    revision_graph_key: graph.revision.graph_key,
    revision_scope_key: graph.revisionScopeKey,
    membership_edge_key: graphKey(graph.scope, "has-chunk", graph.revision.resource_id, resourceId),
    page_index: normalizeInteger(value.page_index ?? value.pageIndex, "chunk.page_index", { min: 0, max: 1_000_000 }),
    reading_order: normalizeInteger(value.reading_order ?? value.readingOrder ?? 0, "chunk.reading_order", { min: 0, max: 1_000_000 }),
    block_type: requiredText(value.block_type || value.blockType || value.type, "chunk.block_type", 80),
    text: optionalText(value.text, "chunk.text", 100_000),
    layer: optionalText(value.layer, "chunk.layer", 40),
    extraction_method: optionalText(value.extraction_method || value.extractionMethod, "chunk.extraction_method", 80),
    confidence: optionalUnitNumber(value.confidence, "chunk.confidence"),
  });
}

function normalizeKnowledgeUnit(value, graph) {
  assertPlainObject(value, "knowledgeUnit");
  const resourceId = requireId(value.id, "knowledgeUnit.id");
  const entityType = value.entity_type || value.entityType || value.candidate_type || value.candidateType;
  if (!KNOWLEDGE_ENTITY_TYPES.has(entityType)) {
    throw new Neo4jEducationGraphValidationError(`Unsupported knowledgeUnit.entity_type: ${String(entityType)}`);
  }
  return compactProperties({
    graph_key: graphKey(graph.scope, "knowledge", graph.revision.resource_id, resourceId),
    resource_id: resourceId,
    revision_graph_key: graph.revision.graph_key,
    revision_scope_key: graph.revisionScopeKey,
    membership_edge_key: graphKey(graph.scope, "has-knowledge", graph.revision.resource_id, resourceId),
    entity_type: entityType,
    name: requiredText(value.name || value.canonical_name || value.canonicalName, "knowledgeUnit.name", 500),
    statement: optionalText(value.statement || value.description, "knowledgeUnit.statement", 20_000),
    knowledge_form: optionalText(value.knowledge_form || value.knowledgeForm, "knowledgeUnit.knowledge_form", 80),
    aliases: normalizeTextArray(value.aliases || [], "knowledgeUnit.aliases", { max: 100, itemMax: 500 }),
    action_verb: optionalText(value.action_verb || value.actionVerb, "knowledgeUnit.action_verb", 80),
    confidence: extractConfidence(value.confidence, "knowledgeUnit.confidence"),
    review_status: requireVerifiedStatus(
      value.review_status || value.reviewStatus,
      "knowledgeUnit.review_status",
    ),
    source_anchors: normalizeSourceAnchors(value),
  });
}

function normalizeQuestion(value, graph) {
  assertPlainObject(value, "question");
  const questionId = requireId(value.question_id || value.questionId || value.id, "question.id");
  const questionRevisionId = requireId(
    value.question_revision_id || value.questionRevisionId || value.revision_id || value.revisionId,
    "question.revision_id",
  );
  const resourceId = questionRevisionId;
  const parts = Array.isArray(value.parts) ? value.parts : [];
  return compactProperties({
    graph_key: graphKey(graph.scope, "question", graph.revision.resource_id, questionRevisionId),
    resource_id: resourceId,
    question_id: questionId,
    question_revision_id: questionRevisionId,
    revision_graph_key: graph.revision.graph_key,
    revision_scope_key: graph.revisionScopeKey,
    membership_edge_key: graphKey(graph.scope, "has-question", graph.revision.resource_id, questionRevisionId),
    question_type: optionalText(value.question_type || value.questionType, "question.question_type", 80),
    language: optionalText(value.language, "question.language", 40),
    stem: requiredText(value.stem, "question.stem", 100_000),
    stimulus: optionalText(value.stimulus, "question.stimulus", 100_000),
    part_ids: normalizeIdArray(parts.map((part) => part?.id), "question.parts[].id", { min: 0, max: 200 }),
    confidence: extractConfidence(value.confidence, "question.confidence"),
    review_status: requireVerifiedStatus(value.review_status || value.reviewStatus, "question.review_status"),
    source_anchors: normalizeSourceAnchors(value),
  });
}

function normalizeRelation(value, graph, knowledgeMap, questionMap, questionPartMap) {
  assertPlainObject(value, "relation");
  const resourceId = requireId(value.id, "relation.id");
  const contractType = value.relation_type || value.relationType;
  const cypherType = CONTRACT_RELATION_TO_CYPHER[contractType];
  if (!cypherType) {
    throw new Neo4jEducationGraphValidationError(`Unsupported relation.relation_type: ${String(contractType)}`);
  }
  const sourceType = requiredEntityType(value.source_type || value.sourceType, "relation.source_type");
  const targetType = requiredEntityType(value.target_type || value.targetType, "relation.target_type");
  const source = resolveEndpoint(
    value.source_id || value.sourceId,
    sourceType,
    knowledgeMap,
    questionMap,
    questionPartMap,
    "relation.source_id",
  );
  const target = resolveEndpoint(
    value.target_id || value.targetId,
    targetType,
    knowledgeMap,
    questionMap,
    questionPartMap,
    "relation.target_id",
  );
  if (source.row.graph_key === target.row.graph_key && source.partId === target.partId) {
    throw new Neo4jEducationGraphValidationError("relation endpoints must be different");
  }
  const sourceAnchors = normalizeSourceAnchors(value);
  return compactProperties({
    graph_key: graphKey(graph.scope, "relation", graph.revision.resource_id, resourceId),
    resource_id: resourceId,
    revision_scope_key: graph.revisionScopeKey,
    contract_type: contractType,
    cypher_type: cypherType,
    source_label: source.label,
    target_label: target.label,
    source_graph_key: source.row.graph_key,
    target_graph_key: target.row.graph_key,
    source_part_id: source.partId,
    target_part_id: target.partId,
    scope: optionalText(value.scope, "relation.scope", 40),
    source_block_ids: anchorBlockIds(sourceAnchors),
    source_page_indexes: anchorPageIndexes(sourceAnchors),
    confidence: extractConfidence(value.confidence, "relation.confidence"),
    review_status: requireVerifiedStatus(value.review_status || value.reviewStatus, "relation.review_status"),
  });
}

function normalizeQuestionLink(value, graph, knowledgeMap, questionMap) {
  assertPlainObject(value, "questionLink");
  const resourceId = requireId(value.id, "questionLink.id");
  const contractType = value.relation;
  const cypherType = QUESTION_LINK_TO_CYPHER[contractType];
  if (!cypherType) {
    throw new Neo4jEducationGraphValidationError(`Unsupported questionLink.relation: ${String(contractType)}`);
  }
  const questionId = requireId(value.question_id || value.questionId, "questionLink.question_id");
  const knowledgeId = requireId(value.knowledge_point_id || value.knowledgePointId, "questionLink.knowledge_point_id");
  const question = questionMap.get(questionId);
  const knowledge = knowledgeMap.get(knowledgeId);
  if (!question) throw new Neo4jEducationGraphValidationError(`questionLink question not found in publication: ${questionId}`);
  if (!knowledge) throw new Neo4jEducationGraphValidationError(`questionLink knowledge unit not found in publication: ${knowledgeId}`);
  const expectedQuestionRevision = value.question_revision_id || value.questionRevisionId;
  if (expectedQuestionRevision && expectedQuestionRevision !== question.question_revision_id) {
    throw new Neo4jEducationGraphValidationError("questionLink.question_revision_id does not match the published question");
  }
  const partId = requireId(value.part_id || value.partId, "questionLink.part_id");
  if (!question.part_ids.includes(partId)) {
    throw new Neo4jEducationGraphValidationError("questionLink.part_id does not belong to the published question");
  }
  const sourceAnchors = normalizeSourceAnchors(value);
  return compactProperties({
    graph_key: graphKey(graph.scope, "question-link", graph.revision.resource_id, resourceId),
    resource_id: resourceId,
    revision_scope_key: graph.revisionScopeKey,
    contract_type: contractType,
    cypher_type: cypherType,
    source_graph_key: question.graph_key,
    target_graph_key: knowledge.graph_key,
    role: optionalText(value.role, "questionLink.role", 40),
    weight: optionalUnitNumber(value.weight, "questionLink.weight"),
    part_id: partId,
    observable_indicator: optionalText(value.observable_indicator || value.observableIndicator, "questionLink.observable_indicator", 1000),
    mapping_method: optionalText(value.mapping_method || value.mappingMethod, "questionLink.mapping_method", 40),
    source_block_ids: anchorBlockIds(sourceAnchors),
    source_page_indexes: anchorPageIndexes(sourceAnchors),
    confidence: extractConfidence(value.confidence, "questionLink.confidence"),
    review_status: requireVerifiedStatus(
      value.review_status || value.reviewStatus,
      "questionLink.review_status",
    ),
  });
}

function resolveEndpoint(rawId, entityType, knowledgeMap, questionMap, questionPartMap, path) {
  const id = requireId(rawId, path);
  if (KNOWLEDGE_ENTITY_TYPES.has(entityType)) {
    const row = knowledgeMap.get(id);
    if (!row) throw new Neo4jEducationGraphValidationError(`${path} is not a published knowledge unit: ${id}`);
    if (row.entity_type !== entityType) {
      throw new Neo4jEducationGraphValidationError(`${path} entity type does not match the published knowledge unit`);
    }
    return { label: NEO4J_EDUCATION_LABELS.knowledgeUnit, row, partId: null };
  }
  if (entityType === "question") {
    const row = questionMap.get(id);
    if (!row) throw new Neo4jEducationGraphValidationError(`${path} is not a published question: ${id}`);
    return { label: NEO4J_EDUCATION_LABELS.question, row, partId: null };
  }
  if (entityType === "question_part") {
    const row = questionPartMap.get(id);
    if (!row) throw new Neo4jEducationGraphValidationError(`${path} is not a published question part: ${id}`);
    return { label: NEO4J_EDUCATION_LABELS.question, row, partId: id };
  }
  throw new Neo4jEducationGraphValidationError(`Entity type ${entityType} cannot be represented by this graph projection`);
}

function buildQuestionPartMap(questions) {
  const result = new Map();
  for (const question of questions) {
    for (const partId of question.part_ids) {
      if (result.has(partId)) {
        throw new Neo4jEducationGraphValidationError(`question part id is not unique: ${partId}`);
      }
      result.set(partId, question);
    }
  }
  return result;
}

function groupRelations(relations) {
  const groups = new Map();
  for (const relation of relations) {
    const key = [relation.source_label, relation.target_label, relation.cypher_type].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        sourceLabel: relation.source_label,
        targetLabel: relation.target_label,
        cypherType: relation.cypher_type,
        contractType: relation.contract_type,
        rows: [],
      });
    }
    groups.get(key).rows.push(relation);
  }
  return [...groups.values()];
}

function groupQuestionLinks(questionLinks) {
  const groups = new Map();
  for (const link of questionLinks) {
    if (!groups.has(link.cypher_type)) {
      groups.set(link.cypher_type, {
        cypherType: link.cypher_type,
        contractType: link.contract_type,
        rows: [],
      });
    }
    groups.get(link.cypher_type).rows.push(link);
  }
  return [...groups.values()];
}

function buildSourceLinkGroups({ scope, revisionScopeKey, chunks, knowledgeUnits, questions }) {
  const groups = [];
  for (const [sourceLabel, sources] of [
    [NEO4J_EDUCATION_LABELS.knowledgeUnit, knowledgeUnits],
    [NEO4J_EDUCATION_LABELS.question, questions],
  ]) {
    const rows = [];
    for (const source of sources) {
      for (const anchor of source.source_anchors || []) {
        for (const chunkId of anchor.block_ids) {
          const chunk = chunks.get(chunkId);
          if (!chunk) {
            throw new Neo4jEducationGraphValidationError(
              `Source anchor references a chunk that is not in this publication: ${chunkId}`,
            );
          }
          rows.push({
            graph_key: graphKey(scope, "supported-by", source.graph_key, chunk.graph_key),
            source_graph_key: source.graph_key,
            chunk_graph_key: chunk.graph_key,
            revision_scope_key: revisionScopeKey,
            page_index: anchor.page_index,
          });
        }
      }
    }
    if (rows.length) groups.push({ sourceLabel, rows: dedupeRows(rows) });
  }
  return groups;
}

function assertAnchorChunksPresent(rows, chunks, path) {
  for (const row of rows) {
    for (const blockId of row.source_block_ids || []) {
      if (!chunks.has(blockId)) {
        throw new Neo4jEducationGraphValidationError(
          `${path} source anchor references a chunk that is not in this publication: ${blockId}`,
        );
      }
    }
  }
}

function normalizeSourceAnchors(value) {
  const anchors = [];
  if (value.source_anchor) anchors.push(value.source_anchor);
  if (Array.isArray(value.source_anchors)) anchors.push(...value.source_anchors);
  if (Array.isArray(value.provenance?.source_anchors)) anchors.push(...value.provenance.source_anchors);
  return anchors.map((anchor, index) => {
    assertPlainObject(anchor, `source_anchor[${index}]`);
    return {
      page_index: normalizeInteger(anchor.page_index ?? anchor.pageIndex, `source_anchor[${index}].page_index`, { min: 0, max: 1_000_000 }),
      block_ids: normalizeIdArray(anchor.block_ids || anchor.blockIds, `source_anchor[${index}].block_ids`, { min: 1, max: 500 }),
    };
  });
}

function anchorBlockIds(anchors) {
  return [...new Set(anchors.flatMap((anchor) => anchor.block_ids))];
}

function anchorPageIndexes(anchors) {
  return [...new Set(anchors.map((anchor) => anchor.page_index))];
}

async function runExpectedCount(tx, cypher, rows, scope, description) {
  if (!rows.length) return;
  const result = await tx.run(cypher, {
    rows: rows.map(stripInternalProjectionProperties),
    now: scope.now,
    ...scopeParams(scope),
  });
  const actual = resultCount(result);
  if (actual !== rows.length) {
    throw new Neo4jEducationGraphError(
      "neo4j_education_graph_acl_conflict",
      `Publication of ${description} was refused: expected ${rows.length} authorized rows, received ${actual}.`,
      { status: 409 },
    );
  }
}

async function runControlExpectedCount(tx, cypher, scope, description) {
  const result = await tx.run(cypher, {
    corpusGraphKey: scope.corpusGraphKey,
    releaseGraphKey: scope.releaseGraphKey,
    releaseMembershipGraphKey: scope.releaseMembershipGraphKey,
    graphDigest: scope.graphDigest || null,
    now: scope.now,
    ...scopeParams(scope),
  });
  if (resultCount(result) !== 1) {
    throw new Neo4jEducationGraphError(
      "neo4j_education_graph_acl_conflict",
      `Publication of ${description} was refused by its ACL or release state.`,
      { status: 409 },
    );
  }
}

function stripInternalProjectionProperties(row) {
  const result = { ...row };
  delete result.source_anchors;
  delete result.source_label;
  delete result.target_label;
  delete result.cypher_type;
  return result;
}

function scopeParams(scope) {
  return compactProperties({
    tenantId: scope.tenantId,
    namespaceId: scope.namespaceId,
    principalId: scope.principalId,
    readPrincipals: scope.readPrincipals,
    writePrincipals: scope.writePrincipals,
    visibility: scope.visibility,
    corpusId: scope.corpusId,
    releaseId: scope.releaseId,
    now: scope.now,
  });
}

async function withSession(driver, database, mode, callback, { signal, timeoutMs } = {}) {
  signal?.throwIfAborted();
  const session = driver.session({
    database,
    defaultAccessMode: mode === "read" ? neo4j.session.READ : neo4j.session.WRITE,
  });
  let closePromise;
  let cancelled = false;
  const close = () => closePromise ||= Promise.resolve().then(() => session.close());
  try {
    if (timeoutMs) {
      return await runWithEducationDeadline(() => callback(session), {
        signal, timeoutMs, code: "neo4j_education_read_timeout",
        onAbort: () => {
          cancelled = true;
          // Closing the session cancels its outstanding transaction. Driver
          // acquisition and retry limits also bound work waiting for a socket.
          void close().catch(() => {});
        },
      });
    }
    return await callback(session);
  } finally {
    if (!cancelled) await close();
  }
}

function graphExpansionFromRecords(records) {
  const nodes = new Map();
  const relationships = new Map();
  for (const record of records) {
    addSafeNode(nodes, record.get?.("seed"));
    const path = record.get?.("p");
    for (const segment of path?.segments || []) {
      addSafeNode(nodes, segment.start);
      addSafeNode(nodes, segment.end);
      addSafeRelationship(relationships, segment.relationship);
    }
  }
  return { nodes: [...nodes.values()], relationships: [...relationships.values()] };
}

function addSafeNode(target, node) {
  if (!node?.properties || typeof node.properties !== "object") return;
  const label = (node.labels || []).find((candidate) => Object.values(NEO4J_EDUCATION_LABELS).includes(candidate));
  if (!label) return;
  const properties = sanitizeReturnedProperties(node.properties, [
    "graph_key", "resource_id", "question_id", "question_revision_id", "entity_type", "name",
    "statement", "knowledge_form", "aliases", "question_type", "language", "stem", "stimulus",
    "part_ids", "page_index", "reading_order", "block_type", "text", "confidence", "review_status",
    "revision_scope_key",
  ]);
  target.set(properties.graph_key || `${label}:${properties.resource_id}`, { label, properties });
}

function addSafeRelationship(target, relationship) {
  if (!relationship?.properties || !Object.values(EXPAND_RELATION_TO_CYPHER).includes(relationship.type)) return;
  const properties = sanitizeReturnedProperties(relationship.properties, [
    "graph_key", "resource_id", "contract_type", "scope", "role", "weight", "part_id",
    "observable_indicator", "mapping_method", "source_block_ids", "source_page_indexes",
    "confidence", "review_status",
  ]);
  target.set(properties.graph_key || `${relationship.type}:${properties.resource_id}`, {
    type: relationship.type,
    properties,
  });
}

function sanitizeReturnedProperties(properties, allowed) {
  const result = {};
  for (const key of allowed) {
    if (properties[key] !== undefined) result[key] = toNativeValue(properties[key]);
  }
  return result;
}

function normalizeExpandRelationTypes(value) {
  if (value === undefined) return Object.keys(EXPAND_RELATION_TO_CYPHER);
  const values = normalizeTextArray(value, "relationTypes", { min: 1, max: 50, itemMax: 128 });
  for (const relationType of values) {
    if (!EXPAND_RELATION_TO_CYPHER[relationType]) {
      throw new Neo4jEducationGraphValidationError(`Unsupported expansion relation type: ${relationType}`);
    }
  }
  return values;
}

function assertDriver(driver) {
  if (!driver || typeof driver.session !== "function" || typeof driver.verifyConnectivity !== "function") {
    throw new Neo4jEducationGraphConfigurationError("A valid official Neo4j driver instance is required.");
  }
}

function assertInternalLabel(label) {
  if (!Object.values(NEO4J_EDUCATION_LABELS).includes(label)) {
    throw new TypeError(`Unsafe internal Neo4j label: ${label}`);
  }
}

function assertInternalRelationshipType(relationType) {
  if (!SAFE_RELATION_TYPE_PATTERN.test(relationType)
    || ![
      ...Object.values(EXPAND_RELATION_TO_CYPHER),
      "SUPPORTED_BY",
      "HAS_REVISION",
      "HAS_CHUNK",
      "HAS_KNOWLEDGE_UNIT",
      "HAS_QUESTION",
    ].includes(relationType)) {
    throw new TypeError(`Unsafe internal Neo4j relationship type: ${relationType}`);
  }
}

function canWriteNode(node, principalId) {
  const properties = node?.properties || {};
  return properties.created_by === principalId
    || (Array.isArray(properties.acl_write) && properties.acl_write.includes(principalId));
}

function batchRows(rows) {
  const batches = [];
  for (let index = 0; index < rows.length; index += MAX_BATCH_ROWS) {
    batches.push(rows.slice(index, index + MAX_BATCH_ROWS));
  }
  return batches;
}

function dedupeRows(rows) {
  return [...new Map(rows.map((row) => [row.graph_key, row])).values()];
}

function assertUniqueRows(rows, label, property = "resource_id") {
  const seenGraphKeys = new Set();
  const seenResources = new Set();
  for (const row of rows) {
    if (seenGraphKeys.has(row.graph_key)) {
      throw new Neo4jEducationGraphValidationError(`${label} contains a duplicate graph key`);
    }
    if (seenResources.has(row[property])) {
      throw new Neo4jEducationGraphValidationError(`${label} contains duplicate ${property}: ${row[property]}`);
    }
    seenGraphKeys.add(row.graph_key);
    seenResources.add(row[property]);
  }
}

function graphKey(scope, ...parts) {
  return hashGraphKey(
    scope.tenantId,
    scope.namespaceId,
    scope.corpusId || "",
    scope.releaseId || "",
    ...parts,
  );
}

function baseGraphKey(scope, ...parts) {
  return hashGraphKey(scope.tenantId, scope.namespaceId, ...parts);
}

function graphPublicationDigest(graph) {
  const normalized = {};
  for (const key of [
    "access", "document", "revision", "chunks", "knowledgeUnits", "questions", "relations",
    "questionLinks",
  ]) {
    const value = graph[key];
    normalized[key] = Array.isArray(value)
      ? [...value].sort((left, right) => String(left.graph_key).localeCompare(String(right.graph_key)))
      : value;
  }
  return createHash("sha256").update(stableJson(normalized)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashGraphKey(...parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part));
    hash.update("\0");
  }
  return `edu:${hash.digest("hex")}`;
}

function normalizeArray(value, path, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Neo4jEducationGraphValidationError(`${path} must be an array`);
  if (value.length > max) throw new Neo4jEducationGraphValidationError(`${path} exceeds ${max} items`);
  return value;
}

function normalizeIdArray(value, path, { min = 0, max = 200 } = {}) {
  if (!Array.isArray(value)) throw new Neo4jEducationGraphValidationError(`${path} must be an array`);
  if (value.length < min || value.length > max) {
    throw new Neo4jEducationGraphValidationError(`${path} must contain between ${min} and ${max} items`);
  }
  const result = value.map((item, index) => requireId(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new Neo4jEducationGraphValidationError(`${path} must not contain duplicates`);
  }
  return result;
}

function normalizeTextArray(value, path, { min = 0, max = 200, itemMax = 1000 } = {}) {
  if (!Array.isArray(value)) throw new Neo4jEducationGraphValidationError(`${path} must be an array`);
  if (value.length < min || value.length > max) {
    throw new Neo4jEducationGraphValidationError(`${path} must contain between ${min} and ${max} items`);
  }
  const result = value.map((item, index) => requiredText(item, `${path}[${index}]`, itemMax));
  return [...new Set(result)];
}

function normalizeInteger(value, path, { min, max, fallback } = {}) {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Neo4jEducationGraphValidationError(`${path} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function requireId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Neo4jEducationGraphValidationError(`${path} must be a safe identifier`);
  }
  return value;
}

function requiredEntityType(value, path) {
  if (!ENTITY_TYPES.includes(value)) {
    throw new Neo4jEducationGraphValidationError(`${path} must be an approved education entity type`);
  }
  return value;
}

function requiredText(value, path, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Neo4jEducationGraphValidationError(`${path} must be non-empty text no longer than ${max} characters`);
  }
  return value.trim();
}

function optionalText(value, path, max) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) {
    throw new Neo4jEducationGraphValidationError(`${path} must be text no longer than ${max} characters`);
  }
  return value.trim();
}

function optionalSha256(value, path) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/iu.test(value)) {
    throw new Neo4jEducationGraphValidationError(`${path} must be a SHA-256 hex digest`);
  }
  return value.toLowerCase();
}

function optionalDateTime(value, path) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Neo4jEducationGraphValidationError(`${path} must be an ISO date-time string`);
  }
  return value;
}

function requireVerifiedStatus(value, path) {
  if (value !== "verified") {
    throw new Neo4jEducationGraphValidationError(
      `${path} must equal verified before graph publication`,
    );
  }
  return value;
}

function optionalUnitNumber(value, path) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Neo4jEducationGraphValidationError(`${path} must be a number from 0 to 1`);
  }
  return number;
}

function extractConfidence(value, path) {
  if (value && typeof value === "object") return optionalUnitNumber(value.overall, `${path}.overall`);
  return optionalUnitNumber(value, path);
}

function normalizeNow(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Neo4jEducationGraphValidationError("now must return a valid Date");
  }
  return value.toISOString();
}

function assertPlainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Neo4jEducationGraphValidationError(`${path} must be an object`);
  }
}

function compactProperties(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function safeDatabaseName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/u.test(value)) {
    throw new Neo4jEducationGraphConfigurationError("NEO4J_DATABASE is invalid.");
  }
  return value;
}

function safeUriScheme(value) {
  try {
    return new URL(value).protocol.replace(/:$/u, "");
  } catch {
    return null;
  }
}

function resultCount(result) {
  return toNativeNumber(result.records?.[0]?.get?.("count"));
}

function toNativeNumber(value) {
  if (typeof value === "number") return value;
  if (neo4j.isInt(value)) return value.toNumber();
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return Number(value || 0);
}

function toNativeValue(value) {
  if (neo4j.isInt(value)) return value.inSafeRange() ? value.toNumber() : value.toString();
  if (Array.isArray(value)) return value.map(toNativeValue);
  return value;
}

function wrapDriverError(code, message, cause, status = 500) {
  return new Neo4jEducationGraphError(code, message, { cause, status });
}

export const NEO4J_EDUCATION_GRAPH_STORE_VERSION = STORE_VERSION;
export const NEO4J_EDUCATION_SCHEMA_STATEMENTS = SCHEMA_STATEMENTS;
export const NEO4J_EDUCATION_RELATION_TYPES = Object.freeze({
  typed_relations: { ...CONTRACT_RELATION_TO_CYPHER },
  question_links: { ...QUESTION_LINK_TO_CYPHER },
});
