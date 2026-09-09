import assert from "node:assert/strict";
import test from "node:test";

import {
  NEO4J_EDUCATION_SCHEMA_STATEMENTS,
  Neo4jEducationGraphConfigurationError,
  Neo4jEducationGraphValidationError,
  createNeo4jEducationGraphStore,
  createNeo4jEducationGraphStoreFromEnv,
  neo4jEducationGraphConfigSummary,
  projectEducationImportGraph,
} from "../neo4j-education-graph-store.js";

const NOW = new Date("2026-08-19T05:00:00.000Z");

function record(values) {
  return { get: (key) => values[key] };
}

function fakeDriver({ run } = {}) {
  const state = {
    queries: [],
    sessions: [],
    verifyConnectivityCalls: 0,
    executeReadCalls: 0,
    executeWriteCalls: 0,
    closeCalls: 0,
  };
  const driver = {
    async verifyConnectivity() {
      state.verifyConnectivityCalls += 1;
    },
    session(config) {
      state.sessions.push(config);
      const tx = {
        async run(query, params = {}) {
          state.queries.push({ query, params });
          if (run) return run(query, params, state);
          if (query === "RETURN 1 AS ok") return { records: [record({ ok: 1 })] };
          if (query.includes("RETURN count(")) {
            return { records: [record({ count: params.rows?.length ?? 1 })] };
          }
          return { records: [] };
        },
      };
      return {
        async executeRead(callback) {
          state.executeReadCalls += 1;
          return callback(tx);
        },
        async executeWrite(callback) {
          state.executeWriteCalls += 1;
          return callback(tx);
        },
        async close() {
          state.closeCalls += 1;
        },
      };
    },
    async close() {
      state.driverCloseCalls = (state.driverCloseCalls || 0) + 1;
    },
  };
  return { driver, state };
}

function publication(overrides = {}) {
  return {
    tenantId: "tenant_alpha",
    namespaceId: "junior_math",
    corpusId: "junior_math_2022",
    releaseId: "release_2026_08_19",
    principalId: "teacher_001",
    readPrincipals: ["teacher_001", "student_001"],
    writePrincipals: ["teacher_001"],
    visibility: "private",
    document: {
      id: "doc_math_2022",
      title: "义务教育数学课程标准",
      document_type: "curriculum_standard",
      language: "zh-CN",
      subject: "math",
      grade_band: "junior_secondary",
      source_file_name: "math-standard.pdf",
      source_sha256: "a".repeat(64),
    },
    revision: {
      id: "doc_math_2022:r1",
      document_id: "doc_math_2022",
      recorded_at: NOW.toISOString(),
      review_status: "verified",
      confidence: 0.98,
    },
    chunks: [{
      id: "block_linear_function",
      page_index: 20,
      reading_order: 1,
      block_type: "paragraph",
      text: "体会一次函数的意义。",
      layer: "printed",
      extraction_method: "vision_model",
      confidence: 0.97,
    }],
    knowledgeUnits: [
      {
        id: "kp_linear_function",
        entity_type: "knowledge_point",
        name: "一次函数",
        statement: "理解一次函数的概念。",
        knowledge_form: "concept",
        aliases: ["线性函数"],
        confidence: { overall: 0.95 },
        review_status: "verified",
        source_anchor: { page_index: 20, block_ids: ["block_linear_function"] },
      },
      {
        id: "kp_substitution",
        entity_type: "knowledge_point",
        name: "代入求函数值",
        statement: "将自变量代入函数表达式。",
        knowledge_form: "procedure",
        aliases: [],
        confidence: 0.94,
        review_status: "verified",
        source_anchor: { page_index: 20, block_ids: ["block_linear_function"] },
      },
    ],
    questions: [{
      id: "question_linear_001",
      revision_id: "question_linear_001:r1",
      question_type: "calculation",
      language: "zh-CN",
      stem: "已知 y=2x+1，x=3 时求 y。",
      parts: [{ id: "part_main" }],
      confidence: { overall: 0.96 },
      review_status: "verified",
      source_anchor: { page_index: 20, block_ids: ["block_linear_function"] },
    }],
    relations: [{
      id: "rel_linear_before_substitution",
      source_id: "kp_linear_function",
      source_type: "knowledge_point",
      target_id: "kp_substitution",
      target_type: "knowledge_point",
      relation_type: "prerequisite_of",
      scope: "same_framework",
      confidence: { overall: 0.9 },
      review_status: "verified",
    }],
    questionLinks: [{
      id: "qk_linear_001",
      question_id: "question_linear_001",
      question_revision_id: "question_linear_001:r1",
      part_id: "part_main",
      knowledge_point_id: "kp_substitution",
      relation: "assesses",
      role: "primary",
      weight: 1,
      observable_indicator: "能够完成直接代入计算",
      mapping_method: "human",
      confidence: { overall: 0.96 },
      review_status: "verified",
    }],
    ...overrides,
  };
}

test("fails closed when Neo4j configuration is absent and never exposes credentials", () => {
  const summary = neo4jEducationGraphConfigSummary({
    uri: "neo4j+s://graph.example.test",
    username: "neo4j",
    password: "secret-value",
  });
  assert.deepEqual(summary, {
    provider: "neo4j",
    store_version: "neo4j-education-graph-store@1.0",
    configured: true,
    database: "neo4j",
    uri_scheme: "neo4j+s",
  });
  assert.equal(JSON.stringify(summary).includes("secret-value"), false);
  assert.throws(
    () => createNeo4jEducationGraphStoreFromEnv({ env: {} }),
    Neo4jEducationGraphConfigurationError,
  );
});

test("initializes only Community-compatible uniqueness constraints and range indexes", async () => {
  const { driver, state } = fakeDriver();
  const store = createNeo4jEducationGraphStore({ driver, now: () => NOW });

  const result = await store.initializeSchema();

  assert.equal(result.initialized, true);
  assert.equal(result.statement_count, NEO4J_EDUCATION_SCHEMA_STATEMENTS.length);
  assert.equal(state.executeWriteCalls, 1);
  assert.equal(state.queries.length, NEO4J_EDUCATION_SCHEMA_STATEMENTS.length);
  assert.equal(state.queries.every(({ query }) => query.includes("IF NOT EXISTS")), true);
  assert.equal(state.queries.some(({ query }) => /IS NOT NULL|NODE KEY|RELATIONSHIP KEY/u.test(query)), false);
  assert.equal(state.sessions.every(({ database }) => database === "neo4j"), true);
});

test("publishes a verified revision atomically with parameterized values and allowlisted typed edges", async () => {
  const { driver, state } = fakeDriver();
  const store = createNeo4jEducationGraphStore({ driver, now: () => NOW });

  const result = await store.publishGraph(publication());

  assert.equal(state.executeWriteCalls, 1);
  assert.equal(result.counts.chunks, 1);
  assert.equal(result.counts.knowledge_units, 2);
  assert.equal(result.counts.questions, 1);
  assert.equal(result.counts.relations, 1);
  assert.equal(result.counts.question_links, 1);
  assert.equal(result.counts.source_links, 3);
  assert.equal(state.queries.some(({ query }) => query.includes(":PREREQUISITE_OF")), true);
  assert.equal(state.queries.some(({ query }) => query.includes(":ASSESSES")), true);
  assert.equal(state.queries.every(({ query }) => !query.includes("一次函数")), true);
  assert.equal(state.queries.some(({ params }) => JSON.stringify(params).includes("一次函数")), true);
  for (const { params } of state.queries.filter(({ params }) => params.rows)) {
    assert.equal(params.tenantId, "tenant_alpha");
    assert.equal(params.namespaceId, "junior_math");
    assert.deepEqual(params.readPrincipals, ["teacher_001", "student_001"]);
    assert.deepEqual(params.writePrincipals, ["teacher_001"]);
    assert.equal(params.now, NOW.toISOString());
  }
});

test("rejects unverified candidates and invented relationship types before opening a transaction", async () => {
  const { driver, state } = fakeDriver();
  const store = createNeo4jEducationGraphStore({ driver, now: () => NOW });
  const unverified = publication();
  unverified.knowledgeUnits[0].review_status = "needs_review";
  await assert.rejects(() => store.publishGraph(unverified), Neo4jEducationGraphValidationError);

  const invented = publication();
  invented.relations[0].relation_type = "MODEL_INVENTED_TYPE) DELETE n //";
  await assert.rejects(() => store.publishGraph(invented), Neo4jEducationGraphValidationError);
  assert.equal(state.executeWriteCalls, 0);
  assert.equal(state.queries.length, 0);
});

test("maps a question_part endpoint onto its owning Question node and retains the part id", async () => {
  const { driver, state } = fakeDriver();
  const store = createNeo4jEducationGraphStore({ driver, now: () => NOW });
  const input = publication();
  input.relations[0] = {
    ...input.relations[0],
    source_type: "question_part",
    source_id: "part_main",
    relation_type: "requires_knowledge",
  };
  await store.publishGraph(input);
  const relationQuery = state.queries.find(({ query }) => query.includes(":REQUIRES_KNOWLEDGE"));
  assert.ok(relationQuery);
  assert.equal(relationQuery.params.rows[0].source_part_id, "part_main");
  assert.equal(relationQuery.params.rows[0].source_graph_key,
    state.queries.find(({ query }) => query.includes("HAS_QUESTION")).params.rows[0].graph_key);
});

test("health proves authenticated database connectivity with one cancellable read query", async () => {
  const { driver, state } = fakeDriver();
  const store = createNeo4jEducationGraphStore({ driver, database: "education", now: () => NOW });

  const result = await store.health();

  assert.equal(result.ok, true);
  assert.equal(result.database, "education");
  assert.equal(state.verifyConnectivityCalls, 0);
  assert.equal(state.executeReadCalls, 1);
  assert.equal(state.queries[0].query, "RETURN 1 AS ok");
  assert.equal(state.sessions[0].database, "education");
});

test("cancelling an acquired Neo4j read closes its session and prevents the caller from hanging", async () => {
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  const { driver, state } = fakeDriver({ run: () => { started(); return new Promise(() => {}); } });
  const store = createNeo4jEducationGraphStore({ driver, database: "education", now: () => NOW });
  const controller = new AbortController();
  const operation = store.health({ signal: controller.signal });
  await pending;
  controller.abort();
  await assert.rejects(operation, (error) => error.code === "neo4j_education_graph_unavailable");
  assert.equal(state.closeCalls, 1);
});

test("CorpusRelease control plane prepares, atomically activates, and resolves an active release", async () => {
  const { driver, state } = fakeDriver({
    run(query, params) {
      if (query.includes("RETURN release LIMIT 1")) {
        return {
          records: [record({
            release: {
              properties: {
                corpus_id: params.corpusId,
                release_id: "release_2026_08_19",
                status: "active",
                activated_at: NOW.toISOString(),
              },
            },
          })],
        };
      }
      if (query.includes("RETURN count(")) {
        return { records: [record({ count: params.rows?.length ?? 1 })] };
      }
      return { records: [] };
    },
  });
  const store = createNeo4jEducationGraphStore({ driver, now: () => NOW });
  const control = {
    tenantId: "tenant_alpha",
    namespaceId: "junior_math",
    principalId: "teacher_001",
    corpusId: "junior_math_2022",
    releaseId: "release_preparing",
  };

  assert.equal((await store.prepareRelease(control)).status, "preparing");
  assert.equal((await store.setReleaseStatus({ ...control, status: "failed" })).status, "failed");
  await store.publishGraph(publication());
  assert.equal((await store.activateRelease({
    ...control,
    releaseId: "release_2026_08_19",
  })).status, "active");
  const active = await store.resolveActiveRelease({
    tenantId: "tenant_alpha",
    namespaceId: "junior_math",
    principalId: "teacher_001",
    corpusId: "junior_math_2022",
  });

  assert.deepEqual(active, {
    corpus_id: "junior_math_2022",
    release_id: "release_2026_08_19",
    status: "active",
    activated_at: NOW.toISOString(),
  });
  assert.equal(state.queries.some(({ query }) => query.includes("FOREACH (edge IN oldEdges | DELETE edge)")), true);
  assert.equal(state.queries.some(({ query }) => query.includes("ACTIVE_RELEASE")), true);
});

test("deleteRevision preflights ACLs and deletes only fixed revision-scoped labels atomically", async () => {
  const { driver, state } = fakeDriver({
    run(query, params) {
      if (query.includes("OPTIONAL MATCH (n)")) {
        return {
          records: [record({
            r: { properties: { acl_write: ["teacher_001"], created_by: "teacher_001" } },
            total: 4,
            writable: 4,
          })],
        };
      }
      if (query.includes("EducationChunk") && query.includes("DETACH DELETE")) {
        return { records: [record({ count: 1 })] };
      }
      if (query.includes("EducationKnowledgeUnit") && query.includes("DETACH DELETE")) {
        return { records: [record({ count: 2 })] };
      }
      if (query.includes("EducationQuestion") && query.includes("DETACH DELETE")) {
        return { records: [record({ count: 1 })] };
      }
      if (query.includes("EducationRevision") && query.includes("DETACH DELETE")) {
        return { records: [record({ count: 1 })] };
      }
      return { records: [record({ count: params.rows?.length ?? 0 })] };
    },
  });
  const store = createNeo4jEducationGraphStore({ driver, now: () => NOW });

  const result = await store.deleteRevision({
    tenantId: "tenant_alpha",
    namespaceId: "junior_math",
    principalId: "teacher_001",
    corpusId: "junior_math_2022",
    releaseId: "release_2026_08_19",
    documentId: "doc_math_2022",
    revisionId: "doc_math_2022:r1",
  });

  assert.equal(result.deleted_nodes, 5);
  assert.equal(state.executeWriteCalls, 1);
  assert.equal(state.queries.filter(({ query }) => query.includes("DETACH DELETE")).length, 4);
  assert.equal(state.queries.some(({ query }) => /MATCH \(n:\$|MATCH \(n:\{/u.test(query)), false);
});

test("expand requires a release, limits traversal to 1/2 hops, ACLs, and allowlisted relations", async () => {
  const { driver, state } = fakeDriver({
    run(query) {
      if (query.includes("RETURN seed, p")) {
        return {
          records: [record({
            seed: {
              labels: ["EducationKnowledgeUnit"],
              properties: {
                graph_key: "edu:seed",
                resource_id: "kp_linear_function",
                name: "一次函数",
                acl_write: ["teacher_001"],
              },
            },
            p: null,
          })],
        };
      }
      return { records: [] };
    },
  });
  const store = createNeo4jEducationGraphStore({ driver, now: () => NOW });

  await assert.rejects(() => store.expand({
    tenantId: "tenant_alpha",
    namespaceId: "junior_math",
    principalId: "student_001",
    corpusId: "junior_math_2022",
    seedIds: ["kp_linear_function"],
  }), /releaseId/u);
  await assert.rejects(() => store.expand({
    tenantId: "tenant_alpha",
    namespaceId: "junior_math",
    principalId: "student_001",
    corpusId: "junior_math_2022",
    releaseId: "release_2026_08_19",
    revisionId: "doc_math_2022:r1",
    seedIds: ["kp_linear_function"],
    hops: 3,
  }), /hops must be exactly 1 or 2/u);
  await assert.rejects(() => store.expand({
    tenantId: "tenant_alpha",
    namespaceId: "junior_math",
    principalId: "student_001",
    corpusId: "junior_math_2022",
    releaseId: "release_2026_08_19",
    revisionId: "doc_math_2022:r1",
    seedIds: ["kp_linear_function"],
    relationTypes: ["EVIL|MATCH"],
  }), /Unsupported expansion relation type/u);

  const result = await store.expand({
    tenantId: "tenant_alpha",
    namespaceId: "junior_math",
    principalId: "student_001",
    corpusId: "junior_math_2022",
    releaseId: "release_2026_08_19",
    revisionId: "doc_math_2022:r1",
    seedIds: ["kp_linear_function"],
    relationTypes: ["prerequisite_of", "assesses", "supported_by"],
    hops: 2,
    limit: 20,
  });

  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].properties.name, "一次函数");
  assert.equal("acl_write" in result.nodes[0].properties, false);
  const query = state.queries.at(-1).query;
  assert.match(query, /\[:PREREQUISITE_OF\|ASSESSES\|SUPPORTED_BY\*1\.\.2\]/u);
  assert.match(query, /n\.revision_scope_key = \$revisionScopeKey/u);
  assert.match(query, /r\.revision_scope_key = \$revisionScopeKey/u);
  assert.match(query, /seed\.release_id = \$releaseId/u);
  assert.match(query, /ACTIVE_RELEASE/u);
  assert.match(query, /ANY\(principal IN \$readPrincipals WHERE principal IN coalesce\(n\.acl_read/u);
});

test("projects existing import IR and candidate-pack collections without changing IDs", () => {
  const documentIR = {
    id: "doc_projected",
    revision_id: "doc_projected:r1",
    title: "投影测试",
    document_type: "exam_paper",
    language: "zh-CN",
    subject: "math",
    grade_band: "junior_secondary",
    source_file: { file_name: "test.pdf", sha256: "b".repeat(64) },
    pages: [{
      index: 0,
      blocks: [{
        id: "block_1",
        type: "question_stem",
        reading_order: 0,
        text: "1+1=?",
        layer: "printed",
        extraction: { method: "native_pdf", confidence: 1 },
      }],
    }],
    provenance: { recorded_at: NOW.toISOString() },
    confidence: { overall: 1 },
    review_status: "verified",
  };
  const candidatePack = {
    document_id: documentIR.id,
    document_revision_id: documentIR.revision_id,
    candidates: {
      curriculum_standards: [{ id: "kp_1" }],
      questions: [{ id: "q_1" }],
      typed_relations: [{ id: "rel_1" }],
      question_knowledge_links: [{ id: "qk_1" }],
    },
  };

  const projection = projectEducationImportGraph({ documentIR, candidatePack });

  assert.equal(projection.revision.id, "doc_projected:r1");
  assert.equal(projection.chunks[0].id, "block_1");
  assert.equal(projection.knowledgeUnits[0].id, "kp_1");
  assert.equal(projection.questions[0].id, "q_1");
  assert.equal(projection.relations[0].id, "rel_1");
  assert.equal(projection.questionLinks[0].id, "qk_1");
});
