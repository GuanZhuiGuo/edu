import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateMasteryProjection,
  DEFAULT_MASTERY_POLICY,
  MASTERY_POLICY_SCHEMA_VERSION,
} from "./education-mastery-policy.js";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_DB_PATH = join(moduleDir, "data", "education-runtime", "education.sqlite");
const DEFAULT_MIGRATIONS_DIR = join(moduleDir, "migrations", "education-data");
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;

export class EducationDataStoreError extends Error {
  constructor(message, { code = "education_data_store_error", status = 500, cause } = {}) {
    super(message, { cause });
    this.name = "EducationDataStoreError";
    this.code = code;
    this.status = status;
  }
}

/**
 * SQLite-backed authoritative application data store.
 *
 * The store never derives tenant identity from client payloads. Every method
 * requires an explicit server-resolved tenantId and applies it to all reads and
 * writes. Answers and full solutions live in a separate private table and are
 * not selected by public question APIs.
 */
export function createEducationDataStore({
  filename = process.env.EDUCATION_DATA_DB_PATH || DEFAULT_DB_PATH,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  readonly = false,
  clock = () => new Date().toISOString()
} = {}) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename, { readonly, fileMustExist: readonly });
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (!readonly && filename !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  function initialize() {
    if (readonly) return { applied: [], readonly: true };
    db.exec(`CREATE TABLE IF NOT EXISTS education_schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);
    const applied = [];
    const migrations = readdirSync(migrationsDir)
      .filter((name) => /^\d+.*\.sql$/u.test(name))
      .sort((left, right) => left.localeCompare(right));
    const hasMigration = db.prepare(
      "SELECT 1 FROM education_schema_migrations WHERE version = ?"
    );
    const recordMigration = db.prepare(
      "INSERT INTO education_schema_migrations(version, applied_at) VALUES (?, ?)"
    );
    ensureEducationSchemaCompatibility(db);
    for (const migration of migrations) {
      if (hasMigration.get(migration)) continue;
      const sql = readFileSync(join(migrationsDir, migration), "utf8");
      db.transaction(() => {
        db.exec(sql);
        ensureEducationSchemaCompatibility(db);
        recordMigration.run(migration, clock());
      })();
      applied.push(migration);
    }
    return { applied, readonly: false };
  }

  function upsertTenant({ tenantId, name = "" }) {
    const id = requiredId(tenantId, "tenant_id");
    const now = clock();
    db.prepare(`INSERT INTO education_tenants(tenant_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`)
      .run(id, cleanText(name, 240) || id, now, now);
    return getTenant(id);
  }

  function getTenant(tenantId) {
    const row = db.prepare("SELECT * FROM education_tenants WHERE tenant_id = ?")
      .get(requiredId(tenantId, "tenant_id"));
    return row ? snakeRow(row) : null;
  }

  function upsertStudent({ tenantId, student }) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const studentId = requiredId(student?.student_id ?? student?.studentId ?? student?.id, "student_id");
    assertTenantExists(safeTenantId);
    const now = clock();
    const profile = isPlainObject(student?.profile) ? student.profile : {};
    db.prepare(`INSERT INTO education_students(
      tenant_id, student_id, name, grade, goal, avatar, profile_json, is_demo, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, student_id) DO UPDATE SET
      name = excluded.name,
      grade = excluded.grade,
      goal = excluded.goal,
      avatar = excluded.avatar,
      profile_json = excluded.profile_json,
      is_demo = excluded.is_demo,
      active = excluded.active,
      updated_at = excluded.updated_at`)
      .run(
        safeTenantId,
        studentId,
        cleanText(student?.name, 240) || studentId,
        cleanText(student?.grade, 120),
        cleanText(student?.goal, 500),
        cleanText(student?.avatar, 40),
        stringifyJson(profile),
        student?.is_demo === true || student?.simulated === true ? 1 : 0,
        student?.active === false ? 0 : 1,
        now,
        now
      );
    return getStudent({ tenantId: safeTenantId, studentId });
  }

  function listStudents({ tenantId, includeInactive = false } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const rows = db.prepare(`SELECT * FROM education_students
      WHERE tenant_id = ? ${includeInactive ? "" : "AND active = 1"}
      ORDER BY is_demo ASC, name COLLATE NOCASE ASC, student_id ASC`).all(safeTenantId);
    return rows.map(studentRow);
  }

  function getStudent({ tenantId, studentId }) {
    const row = db.prepare(`SELECT * FROM education_students
      WHERE tenant_id = ? AND student_id = ?`)
      .get(requiredId(tenantId, "tenant_id"), requiredId(studentId, "student_id"));
    return row ? studentRow(row) : null;
  }

  function importOntology({ tenantId, ontology, seedRevision = "" }) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    assertTenantExists(safeTenantId);
    const normalized = normalizeOntology(ontology);
    const revision = cleanText(seedRevision, 200) || normalized.ontology_version;
    const existing = db.prepare(`SELECT seed_revision FROM education_ontologies
      WHERE tenant_id = ? AND ontology_id = ? AND ontology_version = ?`)
      .get(safeTenantId, normalized.ontology_id, normalized.ontology_version);
    if (existing) {
      if (String(existing.seed_revision || "") === revision) {
        return { idempotent: true, ...ontologyCounts(safeTenantId, normalized.ontology_id, normalized.ontology_version) };
      }
      throw conflict("本体版本已存在且内容修订不同；请发布新的 ontology_version", "ontology_version_conflict");
    }

    const write = db.transaction(() => {
      const now = clock();
      db.prepare(`INSERT INTO education_ontologies(
        tenant_id, ontology_id, ontology_version, name, description, schema_version,
        source_document_json, boundaries_json, visualization_json, review_status,
        seed_revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          safeTenantId,
          normalized.ontology_id,
          normalized.ontology_version,
          normalized.name,
          normalized.description,
          normalized.schema_version,
          stringifyJson(normalized.source_document),
          stringifyJson(normalized.educational_boundaries),
          stringifyJson(normalized.visualization_profile),
          normalized.review_status,
          revision,
          now,
          now
        );

      const insertClass = db.prepare(`INSERT INTO education_entity_classes(
        tenant_id, ontology_id, ontology_version, class_key, name, definition
      ) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const item of normalized.entity_classes) {
        insertClass.run(safeTenantId, normalized.ontology_id, normalized.ontology_version,
          item.key, item.name, item.definition);
      }

      const insertRelationType = db.prepare(`INSERT INTO education_relation_types(
        tenant_id, ontology_id, ontology_version, relation_key, name, directed, definition
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const item of normalized.relation_types) {
        insertRelationType.run(safeTenantId, normalized.ontology_id, normalized.ontology_version,
          item.key, item.name, item.directed ? 1 : 0, item.definition);
      }

      const insertEntity = db.prepare(`INSERT INTO education_ontology_entities(
        tenant_id, ontology_id, ontology_version, entity_id, entity_kind, class_key,
        name, description, aliases_json, properties_json, source_ref_json,
        review_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const entity of normalized.entities) {
        insertEntity.run(
          safeTenantId, normalized.ontology_id, normalized.ontology_version,
          entity.entity_id, entity.entity_kind, entity.class_key, entity.name,
          entity.description, stringifyJson(entity.aliases), stringifyJson(entity.properties),
          stringifyJson(entity.source_ref), entity.review_status, now, now
        );
      }

      const insertRelation = db.prepare(`INSERT INTO education_ontology_relations(
        tenant_id, ontology_id, ontology_version, relation_id, source_entity_id,
        target_entity_id, relation_type, directed, properties_json, review_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const relation of normalized.relations) {
        insertRelation.run(
          safeTenantId, normalized.ontology_id, normalized.ontology_version,
          relation.relation_id, relation.source_entity_id, relation.target_entity_id,
          relation.relation_type, relation.directed ? 1 : 0,
          stringifyJson(relation.properties), relation.review_status, now, now
        );
      }
      return { idempotent: false, ...ontologyCounts(safeTenantId, normalized.ontology_id, normalized.ontology_version) };
    });
    return write();
  }

  function listOntologies({ tenantId } = {}) {
    return db.prepare(`SELECT o.*,
      (SELECT COUNT(*) FROM education_ontology_entities e
       WHERE e.tenant_id=o.tenant_id AND e.ontology_id=o.ontology_id AND e.ontology_version=o.ontology_version
         AND e.entity_kind='knowledge_point') AS knowledge_point_count,
      (SELECT COUNT(*) FROM education_ontology_relations r
       WHERE r.tenant_id=o.tenant_id AND r.ontology_id=o.ontology_id AND r.ontology_version=o.ontology_version) AS relation_count
      FROM education_ontologies o WHERE o.tenant_id = ?
      ORDER BY o.updated_at DESC`)
      .all(requiredId(tenantId, "tenant_id"))
      .map(ontologyRow);
  }

  function getOntologyGraph({ tenantId, ontologyId, ontologyVersion = "", includeQuestions = false, questionLimit = 100 } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const ontology = resolveOntology(safeTenantId, ontologyId, ontologyVersion);
    if (!ontology) return null;
    const key = [safeTenantId, ontology.ontology_id, ontology.ontology_version];
    const entityClasses = db.prepare(`SELECT class_key AS key, name, definition
      FROM education_entity_classes WHERE tenant_id=? AND ontology_id=? AND ontology_version=? ORDER BY class_key`).all(...key);
    const relationTypes = db.prepare(`SELECT relation_key AS key, name, directed, definition
      FROM education_relation_types WHERE tenant_id=? AND ontology_id=? AND ontology_version=? ORDER BY relation_key`).all(...key)
      .map((row) => ({ ...row, directed: Boolean(row.directed) }));
    const entities = db.prepare(`SELECT * FROM education_ontology_entities
      WHERE tenant_id=? AND ontology_id=? AND ontology_version=? ORDER BY entity_kind, entity_id`).all(...key).map(entityRow);
    const relations = db.prepare(`SELECT * FROM education_ontology_relations
      WHERE tenant_id=? AND ontology_id=? AND ontology_version=? ORDER BY relation_id`).all(...key).map(relationRow);
    const result = {
      ontology: ontologyRow({
        ...ontology,
        knowledge_point_count: entities.filter((entity) => entity.entity_kind === "knowledge_point").length,
        relation_count: relations.length,
      }),
      entity_classes: entityClasses,
      relation_types: relationTypes,
      entities,
      relations
    };
    if (includeQuestions) {
      const linked = listQuestions({
        tenantId: safeTenantId,
        ontologyId: ontology.ontology_id,
        ontologyVersion: ontology.ontology_version,
        limit: Math.min(500, safeLimit(questionLimit))
      });
      result.question_nodes = linked.items;
      result.question_relations = linked.items.flatMap((item) =>
        item.knowledge_point_mappings.map((mapping) => ({
          source: item.id,
          target: mapping.knowledge_point_id,
          type: mapping.mapping_role === "primary" ? "assesses" : "requires_knowledge",
          weight: mapping.weight
        }))
      );
    }
    return result;
  }

  function listKnowledgePoints({ tenantId, ontologyId, ontologyVersion = "", query = "", limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const ontology = resolveOntology(safeTenantId, ontologyId, ontologyVersion);
    if (!ontology) return { total: 0, items: [] };
    const needle = cleanText(query, 240);
    const params = [safeTenantId, ontology.ontology_id, ontology.ontology_version];
    const queryClause = needle ? "AND (name LIKE ? ESCAPE '\\' OR entity_id LIKE ? ESCAPE '\\')" : "";
    if (needle) params.push(`%${escapeLike(needle)}%`, `%${escapeLike(needle)}%`);
    const count = db.prepare(`SELECT COUNT(*) AS count FROM education_ontology_entities
      WHERE tenant_id=? AND ontology_id=? AND ontology_version=? AND entity_kind='knowledge_point' ${queryClause}`)
      .get(...params).count;
    const rows = db.prepare(`SELECT * FROM education_ontology_entities
      WHERE tenant_id=? AND ontology_id=? AND ontology_version=? AND entity_kind='knowledge_point' ${queryClause}
      ORDER BY entity_id LIMIT ? OFFSET ?`).all(...params, safeLimit(limit), safeOffset(offset));
    return { ontology_id: ontology.ontology_id, ontology_version: ontology.ontology_version, total: count, items: rows.map(entityRow) };
  }

  function importQuestionBank({ tenantId, publicCatalog, privateCatalog, seedRevision = "" }) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const normalized = normalizeQuestionBank(publicCatalog, privateCatalog);
    resolveOntologyOrThrow(safeTenantId, normalized.ontology_id, normalized.ontology_version);
    const revision = cleanText(seedRevision, 200) || normalized.build_fingerprint || normalized.version;
    const existing = db.prepare(`SELECT seed_revision FROM education_question_banks
      WHERE tenant_id=? AND bank_id=? AND version=?`).get(safeTenantId, normalized.bank_id, normalized.version);
    if (existing) {
      if (String(existing.seed_revision || "") === revision) {
        return { idempotent: true, ...questionCounts(safeTenantId, normalized.bank_id, normalized.version) };
      }
      throw conflict("题库版本已存在且内容修订不同；请发布新的 version", "question_bank_version_conflict");
    }

    const write = db.transaction(() => {
      const now = clock();
      db.prepare(`INSERT INTO education_question_banks(
        tenant_id, bank_id, version, ontology_id, ontology_version, schema_version,
        provenance_json, seed_revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(safeTenantId, normalized.bank_id, normalized.version, normalized.ontology_id,
          normalized.ontology_version, normalized.schema_version,
          stringifyJson(normalized.provenance), revision, now, now);

      const insertQuestion = db.prepare(`INSERT INTO education_questions(
        tenant_id, bank_id, bank_version, question_id, question_version, title,
        stem, question_type, difficulty, proposition_method, ability_level,
        public_payload_json, review_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertMapping = db.prepare(`INSERT INTO education_question_knowledge_points(
        tenant_id, question_id, ontology_id, ontology_version, knowledge_point_id,
        mapping_role, weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const insertSolution = db.prepare(`INSERT INTO education_question_solutions(
        tenant_id, question_id, storage_classification, private_payload_json, updated_at
      ) VALUES (?, ?, 'server_private', ?, ?)`);

      for (const item of normalized.items) {
        insertQuestion.run(
          safeTenantId, normalized.bank_id, normalized.version, item.id,
          item.version, item.title, item.stem, item.question_type, item.difficulty,
          item.proposition_method, item.ability_level, stringifyJson(item.public_payload),
          item.review_status, now, now
        );
        for (const mapping of item.mappings) {
          insertMapping.run(safeTenantId, item.id, normalized.ontology_id,
            normalized.ontology_version, mapping.knowledge_point_id,
            mapping.mapping_role, mapping.weight);
        }
        if (item.private_payload) {
          insertSolution.run(safeTenantId, item.id, stringifyJson(item.private_payload), now);
        }
      }
      return { idempotent: false, ...questionCounts(safeTenantId, normalized.bank_id, normalized.version) };
    });
    return write();
  }

  function listQuestions({
    tenantId,
    ontologyId = "",
    ontologyVersion = "",
    knowledgePointId = "",
    questionType = "",
    difficulty = "",
    propositionMethod = "",
    query = "",
    limit = DEFAULT_LIMIT,
    offset = 0
  } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const where = ["q.tenant_id = ?"];
    const params = [safeTenantId];
    let resolved = null;
    if (ontologyId) {
      resolved = resolveOntologyOrThrow(safeTenantId, ontologyId, ontologyVersion);
      where.push(`EXISTS (SELECT 1 FROM education_question_knowledge_points qkp
        WHERE qkp.tenant_id=q.tenant_id AND qkp.question_id=q.question_id
          AND qkp.ontology_id=? AND qkp.ontology_version=?)`);
      params.push(resolved.ontology_id, resolved.ontology_version);
    }
    if (knowledgePointId) {
      where.push(`EXISTS (SELECT 1 FROM education_question_knowledge_points qkp
        WHERE qkp.tenant_id=q.tenant_id AND qkp.question_id=q.question_id
          AND qkp.knowledge_point_id=?)`);
      params.push(requiredId(knowledgePointId, "knowledge_point_id"));
    }
    for (const [column, value] of [["q.question_type", questionType], ["q.difficulty", difficulty], ["q.proposition_method", propositionMethod]]) {
      const safeValue = cleanText(value, 160);
      if (safeValue) { where.push(`${column} = ?`); params.push(safeValue); }
    }
    const needle = cleanText(query, 240);
    if (needle) {
      where.push("(q.title LIKE ? ESCAPE '\\' OR q.stem LIKE ? ESCAPE '\\')");
      params.push(`%${escapeLike(needle)}%`, `%${escapeLike(needle)}%`);
    }
    const whereSql = where.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS count FROM education_questions q WHERE ${whereSql}`).get(...params).count;
    const rows = db.prepare(`SELECT q.* FROM education_questions q WHERE ${whereSql}
      ORDER BY q.question_id LIMIT ? OFFSET ?`).all(...params, safeLimit(limit), safeOffset(offset));
    const items = rows.map((row) => publicQuestionRow(row, listQuestionMappings(safeTenantId, row.question_id)));
    return { total, limit: safeLimit(limit), offset: safeOffset(offset), items };
  }

  function getQuestion({ tenantId, questionId }) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeQuestionId = requiredId(questionId, "question_id");
    const row = db.prepare("SELECT * FROM education_questions WHERE tenant_id=? AND question_id=?")
      .get(safeTenantId, safeQuestionId);
    return row ? publicQuestionRow(row, listQuestionMappings(safeTenantId, safeQuestionId)) : null;
  }

  function getQuestionSolution({ tenantId, questionId }) {
    const row = db.prepare(`SELECT private_payload_json, storage_classification, updated_at
      FROM education_question_solutions WHERE tenant_id=? AND question_id=?`)
      .get(requiredId(tenantId, "tenant_id"), requiredId(questionId, "question_id"));
    return row ? {
      question_id: requiredId(questionId, "question_id"),
      storage_classification: row.storage_classification,
      private_payload: parseJson(row.private_payload_json, {}),
      updated_at: row.updated_at
    } : null;
  }

  function getMasteryPolicy({ tenantId, policyKey = "default" } = {}) {
    const row = db.prepare(`SELECT * FROM education_mastery_policies
      WHERE tenant_id=? AND policy_key=?`)
      .get(requiredId(tenantId, "tenant_id"), requiredId(policyKey, "policy_key"));
    return row ? masteryPolicyRow(row) : null;
  }

  function ensureMasteryPolicy({ tenantId, policyKey = "default", policy, updatedBy = "system_default" } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safePolicyKey = requiredId(policyKey, "policy_key");
    assertTenantExists(safeTenantId);
    const existing = getMasteryPolicy({ tenantId: safeTenantId, policyKey: safePolicyKey });
    if (existing) return { ...existing, idempotent: true };
    const value = isPlainObject(policy) ? policy : DEFAULT_MASTERY_POLICY;
    const now = clock();
    db.prepare(`INSERT INTO education_mastery_policies(
      tenant_id, policy_key, schema_version, enabled, algorithm, config_json,
      config_version, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .run(safeTenantId, safePolicyKey,
        cleanText(value.schema_version, 160) || MASTERY_POLICY_SCHEMA_VERSION,
        value.enabled === false ? 0 : 1,
        cleanText(value.algorithm, 160) || "weighted_evidence_decay_v1",
        stringifyJson(value), cleanText(updatedBy, 200) || "system_default", now, now);
    return { ...getMasteryPolicy({ tenantId: safeTenantId, policyKey: safePolicyKey }), idempotent: false };
  }

  function updateMasteryPolicy({
    tenantId,
    policyKey = "default",
    policy,
    expectedVersion,
    updatedBy = "settings",
  } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safePolicyKey = requiredId(policyKey, "policy_key");
    const current = getMasteryPolicy({ tenantId: safeTenantId, policyKey: safePolicyKey });
    if (!current) throw notFound("掌握度策略不存在", "mastery_policy_not_found");
    const safeExpectedVersion = Math.floor(Number(expectedVersion));
    if (!Number.isFinite(safeExpectedVersion) || safeExpectedVersion !== current.config_version) {
      throw conflict("掌握度策略已被其他会话修改，请刷新后重试", "mastery_policy_version_conflict");
    }
    const value = isPlainObject(policy) ? policy : {};
    const now = clock();
    const result = db.prepare(`UPDATE education_mastery_policies SET
      schema_version=?, enabled=?, algorithm=?, config_json=?,
      config_version=config_version+1, updated_by=?, updated_at=?
      WHERE tenant_id=? AND policy_key=? AND config_version=?`)
      .run(
        cleanText(value.schema_version, 160) || MASTERY_POLICY_SCHEMA_VERSION,
        value.enabled === false ? 0 : 1,
        cleanText(value.algorithm, 160) || "weighted_evidence_decay_v1",
        stringifyJson(value), cleanText(updatedBy, 200) || "settings", now,
        safeTenantId, safePolicyKey, safeExpectedVersion,
      );
    if (result.changes !== 1) {
      throw conflict("掌握度策略已更新，请刷新后重试", "mastery_policy_version_conflict");
    }
    return getMasteryPolicy({ tenantId: safeTenantId, policyKey: safePolicyKey });
  }

  function recordVerifiedAssessment({ tenantId, studentId, receipt, evidenceItems = [] } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeStudentId = requiredId(studentId, "student_id");
    assertStudentExists(safeTenantId, safeStudentId);
    const item = normalizeVerifiedReceipt(receipt);
    if (item.tenant_id !== safeTenantId || item.student_id !== safeStudentId) {
      throw conflict("判题回执与当前租户或学生不匹配", "grading_receipt_scope_mismatch");
    }
    const question = getQuestion({ tenantId: safeTenantId, questionId: item.question_id });
    if (!question || question.version !== item.question_version) {
      throw conflict("判题回执与当前题目版本不匹配", "grading_receipt_question_mismatch");
    }
    const mappedKnowledgePoints = new Set(question.knowledge_point_mappings.map((mapping) => mapping.knowledge_point_id));
    const normalizedEvidence = array(evidenceItems).map((evidence) => {
      const normalized = normalizeEvidence({
        ...evidence,
        evidence_class: "real",
        verified_receipt_id: item.receipt_id,
        question_id: item.question_id,
        attempt_id: item.attempt_id,
        apply_to_mastery: true,
      });
      if (!mappedKnowledgePoints.has(normalized.knowledge_point_id)) {
        throw conflict("掌握证据知识点不在题目的已审核映射中", "grading_receipt_knowledge_mismatch");
      }
      return normalized;
    });
    if (!normalizedEvidence.length) throw badRequest("判题回执没有可写入的知识点证据", "empty_verified_evidence");

    const write = db.transaction(() => {
      const existingById = db.prepare(`SELECT * FROM education_verified_assessment_receipts
        WHERE tenant_id=? AND receipt_id=?`).get(safeTenantId, item.receipt_id);
      const existingByAttempt = db.prepare(`SELECT * FROM education_verified_assessment_receipts
        WHERE tenant_id=? AND student_id=? AND attempt_id=?`)
        .get(safeTenantId, safeStudentId, item.attempt_id);
      const existing = existingById || existingByAttempt;
      if (existing) {
        if (existing.receipt_id !== item.receipt_id || existing.payload_hash !== item.payload_hash
          || existing.question_id !== item.question_id || existing.student_id !== safeStudentId) {
          throw conflict("同一回执或作答已绑定不同内容", "grading_receipt_idempotency_conflict");
        }
        return {
          idempotent: true,
          receipt: verifiedReceiptRow(existing),
          projections: normalizedEvidence.map((evidence) => getMasteryRecord({
            tenantId: safeTenantId,
            studentId: safeStudentId,
            ontologyId: evidence.ontology_id,
            ontologyVersion: evidence.ontology_version,
            knowledgePointId: evidence.knowledge_point_id,
          })),
        };
      }
      const now = clock();
      db.prepare(`INSERT INTO education_verified_assessment_receipts(
        tenant_id, receipt_id, student_id, attempt_id, question_id, question_version,
        payload_hash, payload_json, verifier_id, verified_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(safeTenantId, item.receipt_id, safeStudentId, item.attempt_id,
          item.question_id, item.question_version, item.payload_hash,
          stringifyJson(item.payload), item.verifier_id, item.verified_at, now);
      const results = normalizedEvidence.map((evidence) => recordMasteryEvidence({
        tenantId: safeTenantId,
        studentId: safeStudentId,
        evidence,
      }));
      return {
        idempotent: false,
        receipt: verifiedReceiptRow(db.prepare(`SELECT * FROM education_verified_assessment_receipts
          WHERE tenant_id=? AND receipt_id=?`).get(safeTenantId, item.receipt_id)),
        evidence_ids: normalizedEvidence.map((evidence) => evidence.evidence_id),
        projections: results.map((result) => result.projection),
      };
    });
    return write();
  }

  function recordMasteryEvidence({ tenantId, studentId, evidence }) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeStudentId = requiredId(studentId, "student_id");
    assertStudentExists(safeTenantId, safeStudentId);
    const item = normalizeEvidence(evidence);
    resolveKnowledgePointOrThrow(safeTenantId, item.ontology_id, item.ontology_version, item.knowledge_point_id);
    const write = db.transaction(() => {
      const now = clock();
      const result = db.prepare(`INSERT INTO education_mastery_evidence(
        tenant_id, evidence_id, student_id, ontology_id, ontology_version,
        knowledge_point_id, evidence_type, outcome, score, weight, sample_count, apply_to_mastery,
        source_type, source_ref, metadata_json, occurred_at, created_at,
        evidence_class, verified_receipt_id, question_id, attempt_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, evidence_id) DO NOTHING`)
        .run(
          safeTenantId, item.evidence_id, safeStudentId, item.ontology_id,
          item.ontology_version, item.knowledge_point_id, item.evidence_type,
          item.outcome, item.score, item.weight, item.sample_count, item.apply_to_mastery ? 1 : 0,
          item.source_type, item.source_ref, stringifyJson(item.metadata),
          item.occurred_at, now, item.evidence_class, item.verified_receipt_id,
          item.question_id, item.attempt_id
        );
      if (result.changes === 0) {
        const existingEvidence = db.prepare(`SELECT score, weight, sample_count, source_type, source_ref,
          student_id, ontology_id, ontology_version, knowledge_point_id, evidence_class,
          verified_receipt_id, question_id, attempt_id, outcome, apply_to_mastery
          FROM education_mastery_evidence WHERE tenant_id=? AND evidence_id=?`)
          .get(safeTenantId, item.evidence_id);
        const canRefreshDemoSeed = existingEvidence
          && item.source_type === "rebuildable_demo_seed"
          && item.metadata.demo_seed === true
          && existingEvidence.source_type === item.source_type
          && existingEvidence.source_ref === item.source_ref;
        const demoSeedChanged = canRefreshDemoSeed && (
          Number(existingEvidence.score) !== Number(item.score)
          || Number(existingEvidence.weight) !== Number(item.weight)
          || Number(existingEvidence.sample_count) !== Number(item.sample_count)
        );
        if (demoSeedChanged) {
          db.prepare(`UPDATE education_mastery_evidence
            SET score=?, weight=?, sample_count=?, metadata_json=?, occurred_at=?
            WHERE tenant_id=? AND evidence_id=?`)
            .run(item.score, item.weight, item.sample_count, stringifyJson(item.metadata),
              item.occurred_at, safeTenantId, item.evidence_id);
          return {
            idempotent: false,
            refreshed_demo_seed: true,
            projection: recomputeMastery({
              tenantId: safeTenantId, studentId: safeStudentId,
              ontologyId: item.ontology_id, ontologyVersion: item.ontology_version,
              knowledgePointId: item.knowledge_point_id
            })
          };
        }
        if (!evidenceEquivalent(existingEvidence, item, safeStudentId)) {
          throw conflict("同一 evidence_id 已绑定不同证据内容", "mastery_evidence_idempotency_conflict");
        }
        return { idempotent: true, projection: getMasteryRecord({
          tenantId: safeTenantId, studentId: safeStudentId,
          ontologyId: item.ontology_id, ontologyVersion: item.ontology_version,
          knowledgePointId: item.knowledge_point_id
        }) };
      }
      db.prepare(`INSERT INTO education_learning_events(
        tenant_id, event_id, student_id, event_type, title, description,
        source_type, source_ref, payload_json, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, student_id, source_type, source_ref, event_type) DO NOTHING`)
        .run(
          safeTenantId, `event:${item.evidence_id}`, safeStudentId, "mastery_evidence",
          item.metadata.title || "新增学习证据", item.metadata.description || "",
          item.source_type, item.evidence_id,
          stringifyJson({ evidence_id: item.evidence_id, knowledge_point_id: item.knowledge_point_id,
            outcome: item.outcome, apply_to_mastery: item.apply_to_mastery,
            evidence_source_ref: item.source_ref }),
          item.occurred_at, now
        );
      const projection = recomputeMastery({
        tenantId: safeTenantId, studentId: safeStudentId,
        ontologyId: item.ontology_id, ontologyVersion: item.ontology_version,
        knowledgePointId: item.knowledge_point_id
      });
      return { idempotent: false, projection };
    });
    return write();
  }

  function recomputeMastery({ tenantId, studentId, ontologyId, ontologyVersion, knowledgePointId }) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeStudentId = requiredId(studentId, "student_id");
    const kp = resolveKnowledgePointOrThrow(safeTenantId, ontologyId, ontologyVersion, knowledgePointId);
    const rows = db.prepare(`SELECT evidence_id, outcome, score, weight, sample_count,
      apply_to_mastery, source_type, metadata_json, evidence_class, occurred_at
      FROM education_mastery_evidence
      WHERE tenant_id=? AND student_id=? AND ontology_id=? AND ontology_version=?
        AND knowledge_point_id=? AND apply_to_mastery=1 AND score IS NOT NULL
      ORDER BY occurred_at ASC, evidence_id ASC`)
      .all(safeTenantId, safeStudentId, kp.ontology_id, kp.ontology_version, kp.entity_id);
    const policy = getMasteryPolicy({ tenantId: safeTenantId })?.config || DEFAULT_MASTERY_POLICY;
    const projection = calculateMasteryProjection(rows, policy, { now: clock() });
    if (projection.mastery_probability == null) {
      db.prepare(`DELETE FROM education_student_mastery
        WHERE tenant_id=? AND student_id=? AND ontology_id=? AND ontology_version=? AND knowledge_point_id=?`)
        .run(safeTenantId, safeStudentId, kp.ontology_id, kp.ontology_version, kp.entity_id);
      return unassessedMastery(kp.entity_id);
    }
    const existing = db.prepare(`SELECT state_version FROM education_student_mastery
      WHERE tenant_id=? AND student_id=? AND ontology_id=? AND ontology_version=? AND knowledge_point_id=?`)
      .get(safeTenantId, safeStudentId, kp.ontology_id, kp.ontology_version, kp.entity_id);
    const now = clock();
    db.prepare(`INSERT INTO education_student_mastery(
      tenant_id, student_id, ontology_id, ontology_version, knowledge_point_id,
      mastery_state, mastery_probability, confidence, evidence_count, total_weight,
      latest_source, last_event_at, state_version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, student_id, ontology_id, ontology_version, knowledge_point_id)
    DO UPDATE SET mastery_state=excluded.mastery_state,
      mastery_probability=excluded.mastery_probability, confidence=excluded.confidence,
      evidence_count=excluded.evidence_count, total_weight=excluded.total_weight,
      latest_source=excluded.latest_source, last_event_at=excluded.last_event_at,
      state_version=excluded.state_version, updated_at=excluded.updated_at`)
      .run(
        safeTenantId, safeStudentId, kp.ontology_id, kp.ontology_version, kp.entity_id,
        projection.mastery_state, projection.mastery_probability, projection.confidence,
        projection.evidence_count, projection.total_weight,
        projection.latest_source, projection.last_event_at,
        Number(existing?.state_version || 0) + 1, now
      );
    return getMasteryRecord({
      tenantId: safeTenantId, studentId: safeStudentId,
      ontologyId: kp.ontology_id, ontologyVersion: kp.ontology_version,
      knowledgePointId: kp.entity_id
    });
  }

  function recomputeAllMastery({ tenantId } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const groups = db.prepare(`SELECT DISTINCT student_id, ontology_id, ontology_version, knowledge_point_id
      FROM education_mastery_evidence WHERE tenant_id=? AND apply_to_mastery=1`).all(safeTenantId);
    const write = db.transaction(() => groups.map((group) => recomputeMastery({
      tenantId: safeTenantId,
      studentId: group.student_id,
      ontologyId: group.ontology_id,
      ontologyVersion: group.ontology_version,
      knowledgePointId: group.knowledge_point_id,
    })));
    const projections = write();
    return { recomputed: projections.length, projections };
  }

  function masteryEvidenceSummary({ tenantId } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const rows = db.prepare(`SELECT evidence_class, COUNT(*) AS count,
      SUM(CASE WHEN apply_to_mastery=1 THEN 1 ELSE 0 END) AS applied_count,
      MAX(occurred_at) AS latest_at
      FROM education_mastery_evidence WHERE tenant_id=? GROUP BY evidence_class`)
      .all(safeTenantId);
    const byClass = Object.fromEntries(["real", "demo", "proposal", "legacy"].map((key) => [key, {
      count: 0, applied_count: 0, latest_at: null,
    }]));
    for (const row of rows) {
      byClass[row.evidence_class] = {
        count: Number(row.count || 0),
        applied_count: Number(row.applied_count || 0),
        latest_at: row.latest_at || null,
      };
    }
    const verifiedReceipts = db.prepare(`SELECT COUNT(*) AS count
      FROM education_verified_assessment_receipts WHERE tenant_id=?`).get(safeTenantId).count;
    return {
      total: rows.reduce((sum, row) => sum + Number(row.count || 0), 0),
      verified_receipts: Number(verifiedReceipts || 0),
      by_class: byClass,
      boundary: {
        real: "server_verified_grading_receipt_only",
        demo: "rebuildable_seed_prior",
        proposal: "never_applied_to_mastery",
      },
    };
  }

  function listMasteryEvidence({
    tenantId,
    studentId,
    ontologyId,
    ontologyVersion = "",
    knowledgePointId = "",
    limit = MAX_LIMIT,
    offset = 0,
    order = "desc",
  } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeStudentId = requiredId(studentId, "student_id");
    assertStudentExists(safeTenantId, safeStudentId);
    const ontology = resolveOntologyOrThrow(safeTenantId, ontologyId, ontologyVersion);
    const safeKnowledgePointId = knowledgePointId
      ? resolveKnowledgePointOrThrow(
        safeTenantId,
        ontology.ontology_id,
        ontology.ontology_version,
        knowledgePointId,
      ).entity_id
      : "";
    const where = [
      "e.tenant_id=?",
      "e.student_id=?",
      "e.ontology_id=?",
      "e.ontology_version=?",
    ];
    const params = [
      safeTenantId,
      safeStudentId,
      ontology.ontology_id,
      ontology.ontology_version,
    ];
    if (safeKnowledgePointId) {
      where.push("e.knowledge_point_id=?");
      params.push(safeKnowledgePointId);
    }
    const whereSql = where.join(" AND ");
    const evidenceFrom = `FROM education_mastery_evidence e
      JOIN education_ontology_entities kp
        ON kp.tenant_id=e.tenant_id
        AND kp.ontology_id=e.ontology_id
        AND kp.ontology_version=e.ontology_version
        AND kp.entity_id=e.knowledge_point_id
        AND kp.entity_kind='knowledge_point'`;
    const total = Number(db.prepare(`SELECT COUNT(*) AS count ${evidenceFrom}
      WHERE ${whereSql}`).get(...params).count || 0);
    const safePageLimit = safeLimit(limit);
    const safePageOffset = safeOffset(offset);
    const orderSql = String(order).toLowerCase() === "asc" ? "ASC" : "DESC";
    const rows = db.prepare(`SELECT e.*, kp.name AS knowledge_point_name ${evidenceFrom}
      WHERE ${whereSql}
      ORDER BY e.occurred_at ${orderSql}, e.evidence_id ${orderSql}
      LIMIT ? OFFSET ?`).all(...params, safePageLimit, safePageOffset);
    return {
      student_id: safeStudentId,
      ontology_id: ontology.ontology_id,
      ontology_version: ontology.ontology_version,
      knowledge_point_id: safeKnowledgePointId || null,
      total,
      limit: safePageLimit,
      offset: safePageOffset,
      items: rows.map(masteryEvidenceRow),
    };
  }

  function listMastery({ tenantId, studentId, ontologyId, ontologyVersion = "", state = "", limit = MAX_LIMIT, offset = 0 } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeStudentId = requiredId(studentId, "student_id");
    assertStudentExists(safeTenantId, safeStudentId);
    const ontology = resolveOntologyOrThrow(safeTenantId, ontologyId, ontologyVersion);
    const safeState = cleanText(state, 40);
    if (safeState && !["mastered", "secure", "learning", "weak", "unassessed"].includes(safeState)) {
      throw badRequest("无效的掌握状态", "invalid_mastery_state");
    }
    const stateClause = safeState
      ? "AND COALESCE(m.mastery_state, 'unassessed') = ?"
      : "";
    const params = [safeStudentId, safeTenantId, ontology.ontology_id, ontology.ontology_version];
    if (safeState) params.push(safeState);
    const base = `FROM education_ontology_entities e
      LEFT JOIN education_student_mastery m
        ON m.tenant_id=e.tenant_id AND m.ontology_id=e.ontology_id
        AND m.ontology_version=e.ontology_version AND m.knowledge_point_id=e.entity_id
        AND m.student_id=?
      WHERE e.tenant_id=? AND e.ontology_id=? AND e.ontology_version=?
        AND e.entity_kind='knowledge_point' ${stateClause}`;
    const total = db.prepare(`SELECT COUNT(*) AS count ${base}`).get(...params).count;
    const rows = db.prepare(`SELECT e.entity_id AS knowledge_point_id, e.name AS knowledge_point_name,
      COALESCE(m.mastery_state, 'unassessed') AS mastery_state,
      m.mastery_probability, COALESCE(m.confidence, 0) AS confidence,
      COALESCE(m.evidence_count, 0) AS evidence_count,
      COALESCE(m.total_weight, 0) AS total_weight,
      m.latest_source, m.last_event_at, COALESCE(m.state_version, 0) AS state_version
      ${base} ORDER BY e.entity_id LIMIT ? OFFSET ?`)
      .all(...params, safeLimit(limit), safeOffset(offset));
    return {
      student_id: safeStudentId,
      ontology_id: ontology.ontology_id,
      ontology_version: ontology.ontology_version,
      total,
      items: rows.map(masteryRow)
    };
  }

  function getMasteryRecord({ tenantId, studentId, ontologyId, ontologyVersion, knowledgePointId }) {
    const result = listMastery({ tenantId, studentId, ontologyId, ontologyVersion, limit: MAX_LIMIT });
    return result.items.find((item) => item.knowledge_point_id === knowledgePointId) || null;
  }

  function listLearningEvents({ tenantId, studentId, limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeStudentId = requiredId(studentId, "student_id");
    assertStudentExists(safeTenantId, safeStudentId);
    const total = db.prepare(`SELECT COUNT(*) AS count FROM education_learning_events
      WHERE tenant_id=? AND student_id=?`).get(safeTenantId, safeStudentId).count;
    const rows = db.prepare(`SELECT * FROM education_learning_events
      WHERE tenant_id=? AND student_id=? ORDER BY occurred_at DESC, event_id DESC
      LIMIT ? OFFSET ?`).all(safeTenantId, safeStudentId, safeLimit(limit), safeOffset(offset));
    return { student_id: safeStudentId, total, items: rows.map(learningEventRow) };
  }

  function createAgentTrace({ tenantId, trace } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const traceId = requiredId(trace?.trace_id ?? trace?.id, "trace_id");
    const studentId = requiredId(trace?.student_id, "student_id");
    assertStudentExists(safeTenantId, studentId);
    const startedAt = safeIsoTime(trace?.started_at, clock());
    const now = clock();
    db.prepare(`INSERT INTO education_agent_traces(
      tenant_id, trace_id, conversation_id, message_id, student_id, request_id,
      skill_id, status, total_ms, request_json, summary_json, started_at,
      ended_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        safeTenantId,
        traceId,
        requiredId(trace?.conversation_id, "conversation_id"),
        requiredId(trace?.message_id ?? trace?.request_id ?? traceId, "message_id"),
        studentId,
        requiredId(trace?.request_id ?? traceId, "request_id"),
        cleanText(trace?.skill_id, 120),
        normalizeTraceStatus(trace?.status, "running"),
        safeTraceDuration(trace?.total_ms),
        stringifyJson(redactTraceValue(trace?.request || {})),
        stringifyJson(redactTraceValue(trace?.summary || {})),
        startedAt,
        trace?.ended_at ? safeIsoTime(trace.ended_at, now) : null,
        now,
        now,
      );
    return getAgentTrace({ tenantId: safeTenantId, traceId, studentId });
  }

  function upsertAgentTraceSpan({ tenantId, traceId, span } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeTraceId = requiredId(traceId, "trace_id");
    const trace = db.prepare(`SELECT trace_id FROM education_agent_traces
      WHERE tenant_id=? AND trace_id=?`).get(safeTenantId, safeTraceId);
    if (!trace) throw notFound("Trace 不存在或不属于当前租户", "agent_trace_not_found");
    const spanId = requiredId(span?.span_id ?? span?.id, "span_id");
    const now = clock();
    const startedAt = safeIsoTime(span?.started_at, now);
    const endedAt = span?.ended_at ? safeIsoTime(span.ended_at, now) : null;
    db.prepare(`INSERT INTO education_agent_trace_spans(
      tenant_id, trace_id, span_id, parent_span_id, sequence, name, kind, status,
      duration_ms, input_json, output_json, error_json, started_at, ended_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, trace_id, span_id) DO UPDATE SET
      parent_span_id=excluded.parent_span_id,
      sequence=excluded.sequence,
      name=excluded.name,
      kind=excluded.kind,
      status=excluded.status,
      duration_ms=excluded.duration_ms,
      input_json=excluded.input_json,
      output_json=excluded.output_json,
      error_json=excluded.error_json,
      started_at=excluded.started_at,
      ended_at=excluded.ended_at,
      updated_at=excluded.updated_at`)
      .run(
        safeTenantId,
        safeTraceId,
        spanId,
        span?.parent_span_id ? requiredId(span.parent_span_id, "parent_span_id") : null,
        Math.max(0, Math.floor(Number(span?.sequence) || 0)),
        cleanText(span?.name, 240) || "未命名 Span",
        cleanText(span?.kind, 80) || "internal",
        normalizeTraceStatus(span?.status, "running"),
        safeTraceDuration(span?.duration_ms),
        stringifyJson(redactTraceValue(span?.input || {})),
        stringifyJson(redactTraceValue(span?.output || {})),
        stringifyJson(redactTraceValue(span?.error || {})),
        startedAt,
        endedAt,
        now,
        now,
      );
    return db.prepare(`SELECT * FROM education_agent_trace_spans
      WHERE tenant_id=? AND trace_id=? AND span_id=?`)
      .get(safeTenantId, safeTraceId, spanId);
  }

  function finishAgentTrace({ tenantId, traceId, studentId, status, totalMs, summary, endedAt } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeTraceId = requiredId(traceId, "trace_id");
    const safeStudentId = requiredId(studentId, "student_id");
    const now = clock();
    const result = db.prepare(`UPDATE education_agent_traces SET
      status=?, total_ms=?, summary_json=?, ended_at=?, updated_at=?
      WHERE tenant_id=? AND trace_id=? AND student_id=?`)
      .run(
        normalizeTraceStatus(status, "success"),
        safeTraceDuration(totalMs),
        stringifyJson(redactTraceValue(summary || {})),
        safeIsoTime(endedAt, now),
        now,
        safeTenantId,
        safeTraceId,
        safeStudentId,
      );
    if (!result.changes) throw notFound("Trace 不存在或无权访问", "agent_trace_not_found");
    return getAgentTrace({ tenantId: safeTenantId, traceId: safeTraceId, studentId: safeStudentId });
  }

  function getAgentTrace({ tenantId, traceId, studentId } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeTraceId = requiredId(traceId, "trace_id");
    const safeStudentId = requiredId(studentId, "student_id");
    const row = db.prepare(`SELECT * FROM education_agent_traces
      WHERE tenant_id=? AND trace_id=? AND student_id=?`)
      .get(safeTenantId, safeTraceId, safeStudentId);
    if (!row) return null;
    const spans = db.prepare(`SELECT * FROM education_agent_trace_spans
      WHERE tenant_id=? AND trace_id=? ORDER BY sequence, started_at, span_id`)
      .all(safeTenantId, safeTraceId)
      .map(agentTraceSpanRow);
    return { ...agentTraceRow(row), spans };
  }

  function listAgentTraces({ tenantId, studentId, conversationId, limit = 30 } = {}) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const safeStudentId = requiredId(studentId, "student_id");
    const safeConversationId = requiredId(conversationId, "conversation_id");
    assertStudentExists(safeTenantId, safeStudentId);
    return db.prepare(`SELECT * FROM education_agent_traces
      WHERE tenant_id=? AND student_id=? AND conversation_id=?
      ORDER BY started_at DESC LIMIT ?`)
      .all(safeTenantId, safeStudentId, safeConversationId, Math.min(100, Math.max(1, Number(limit) || 30)))
      .map(agentTraceRow);
  }

  function summary({ tenantId }) {
    const safeTenantId = requiredId(tenantId, "tenant_id");
    const scalar = (table, suffix = "") => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=? ${suffix}`).get(safeTenantId).count;
    return {
      storage: "sqlite",
      filename: filename === ":memory:" ? ":memory:" : filename,
      tenant_id: safeTenantId,
      counts: {
        students: scalar("education_students", "AND active=1"),
        ontologies: scalar("education_ontologies"),
        ontology_entities: scalar("education_ontology_entities"),
        knowledge_points: scalar("education_ontology_entities", "AND entity_kind='knowledge_point'"),
        ontology_relations: scalar("education_ontology_relations"),
        questions: scalar("education_questions"),
        private_solutions: scalar("education_question_solutions"),
        mastery_evidence: scalar("education_mastery_evidence"),
        mastery_projections: scalar("education_student_mastery"),
        verified_assessment_receipts: scalar("education_verified_assessment_receipts"),
        learning_events: scalar("education_learning_events"),
        agent_traces: scalar("education_agent_traces"),
        agent_trace_spans: scalar("education_agent_trace_spans")
      },
      mastery_evidence: masteryEvidenceSummary({ tenantId: safeTenantId }),
    };
  }

  function close() {
    if (db.open) db.close();
  }

  function assertTenantExists(tenantId) {
    if (!getTenant(tenantId)) throw notFound("租户不存在", "tenant_not_found");
  }

  function assertStudentExists(tenantId, studentId) {
    if (!getStudent({ tenantId, studentId })) throw notFound("学生不存在或不属于当前租户", "student_not_found");
  }

  function resolveOntology(tenantId, ontologyId, ontologyVersion = "") {
    const safeOntologyId = requiredId(ontologyId, "ontology_id");
    if (ontologyVersion) {
      return db.prepare(`SELECT * FROM education_ontologies
        WHERE tenant_id=? AND ontology_id=? AND ontology_version=?`)
        .get(tenantId, safeOntologyId, requiredId(ontologyVersion, "ontology_version")) || null;
    }
    return db.prepare(`SELECT * FROM education_ontologies
      WHERE tenant_id=? AND ontology_id=? ORDER BY updated_at DESC, ontology_version DESC LIMIT 1`)
      .get(tenantId, safeOntologyId) || null;
  }

  function resolveOntologyOrThrow(tenantId, ontologyId, ontologyVersion = "") {
    const value = resolveOntology(tenantId, ontologyId, ontologyVersion);
    if (!value) throw notFound("本体版本不存在或不属于当前租户", "ontology_not_found");
    return value;
  }

  function resolveKnowledgePointOrThrow(tenantId, ontologyId, ontologyVersion, knowledgePointId) {
    const ontology = resolveOntologyOrThrow(tenantId, ontologyId, ontologyVersion);
    const row = db.prepare(`SELECT * FROM education_ontology_entities
      WHERE tenant_id=? AND ontology_id=? AND ontology_version=? AND entity_id=?
        AND entity_kind='knowledge_point'`)
      .get(tenantId, ontology.ontology_id, ontology.ontology_version,
        requiredId(knowledgePointId, "knowledge_point_id"));
    if (!row) throw notFound("知识点不存在或不属于当前本体", "knowledge_point_not_found");
    return row;
  }

  function ontologyCounts(tenantId, ontologyId, ontologyVersion) {
    const [entityCount, relationCount] = [
      db.prepare(`SELECT COUNT(*) AS count FROM education_ontology_entities
        WHERE tenant_id=? AND ontology_id=? AND ontology_version=?`).get(tenantId, ontologyId, ontologyVersion).count,
      db.prepare(`SELECT COUNT(*) AS count FROM education_ontology_relations
        WHERE tenant_id=? AND ontology_id=? AND ontology_version=?`).get(tenantId, ontologyId, ontologyVersion).count
    ];
    return { ontology_id: ontologyId, ontology_version: ontologyVersion, entity_count: entityCount, relation_count: relationCount };
  }

  function questionCounts(tenantId, bankId, version) {
    const questionCount = db.prepare(`SELECT COUNT(*) AS count FROM education_questions
      WHERE tenant_id=? AND bank_id=? AND bank_version=?`).get(tenantId, bankId, version).count;
    const solutionCount = db.prepare(`SELECT COUNT(*) AS count FROM education_question_solutions s
      JOIN education_questions q ON q.tenant_id=s.tenant_id AND q.question_id=s.question_id
      WHERE q.tenant_id=? AND q.bank_id=? AND q.bank_version=?`).get(tenantId, bankId, version).count;
    return { bank_id: bankId, version, question_count: questionCount, private_solution_count: solutionCount };
  }

  function listQuestionMappings(tenantId, questionId) {
    return db.prepare(`SELECT ontology_id, ontology_version, knowledge_point_id, mapping_role, weight
      FROM education_question_knowledge_points WHERE tenant_id=? AND question_id=?
      ORDER BY mapping_role='primary' DESC, knowledge_point_id`).all(tenantId, questionId);
  }

  return Object.freeze({
    initialize,
    upsertTenant,
    getTenant,
    upsertStudent,
    listStudents,
    getStudent,
    importOntology,
    listOntologies,
    getOntologyGraph,
    listKnowledgePoints,
    importQuestionBank,
    listQuestions,
    getQuestion,
    getQuestionSolution,
    getMasteryPolicy,
    ensureMasteryPolicy,
    updateMasteryPolicy,
    recordVerifiedAssessment,
    recordMasteryEvidence,
    recomputeMastery,
    recomputeAllMastery,
    masteryEvidenceSummary,
    listMasteryEvidence,
    listMastery,
    getMasteryRecord,
    listLearningEvents,
    createAgentTrace,
    upsertAgentTraceSpan,
    finishAgentTrace,
    getAgentTrace,
    listAgentTraces,
    summary,
    close,
    filename
  });
}

function ensureEducationSchemaCompatibility(db) {
  const table = db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='education_mastery_evidence'`).get();
  if (!table) return;
  const columns = new Set(db.pragma("table_info(education_mastery_evidence)").map((column) => column.name));
  if (!columns.has("sample_count")) {
    db.exec(`ALTER TABLE education_mastery_evidence
      ADD COLUMN sample_count INTEGER NOT NULL DEFAULT 1 CHECK (sample_count >= 1)`);
  }
}

function normalizeOntology(value) {
  if (!isPlainObject(value)) throw badRequest("本体数据必须是 JSON 对象", "invalid_ontology");
  const ontologyId = requiredId(value.ontology_id, "ontology_id");
  const ontologyVersion = requiredId(value.ontology_version, "ontology_version");
  const entityClasses = array(value.entity_classes).map((item) => ({
    key: requiredId(item?.key, "entity_class.key"),
    name: cleanText(item?.name, 240) || requiredId(item?.key, "entity_class.key"),
    definition: cleanText(item?.definition, 2_000)
  }));
  const relationTypes = array(value.relation_types).map((item) => ({
    key: requiredId(item?.key, "relation_type.key"),
    name: cleanText(item?.name, 240) || requiredId(item?.key, "relation_type.key"),
    directed: item?.directed !== false,
    definition: cleanText(item?.definition, 2_000)
  }));
  const classKeys = new Set(entityClasses.map((item) => item.key));
  const relationTypeByKey = new Map(relationTypes.map((item) => [item.key, item]));
  for (const requiredClass of ["domain", "theme"]) {
    if (!classKeys.has(requiredClass)) throw badRequest(`本体缺少 ${requiredClass} 实体类`, "invalid_ontology_schema");
  }
  if (!relationTypeByKey.has("part_of")) throw badRequest("本体缺少 part_of 关系类型", "invalid_ontology_schema");

  const entities = [];
  for (const domain of array(value.domains)) {
    entities.push({
      entity_id: requiredId(domain?.id, "domain.id"), entity_kind: "domain", class_key: "domain",
      name: cleanText(domain?.name, 400), description: cleanText(domain?.description, 2_000), aliases: [],
      properties: omit(domain, ["id", "name", "description"]), source_ref: {}, review_status: "curated"
    });
  }
  for (const theme of array(value.themes)) {
    entities.push({
      entity_id: requiredId(theme?.id, "theme.id"), entity_kind: "theme", class_key: "theme",
      name: cleanText(theme?.name, 400), description: cleanText(theme?.description, 2_000), aliases: [],
      properties: omit(theme, ["id", "name", "description"]), source_ref: {}, review_status: "curated"
    });
  }
  for (const point of array(value.knowledge_points)) {
    const classKey = requiredId(point?.entity_class, "knowledge_point.entity_class");
    if (!classKeys.has(classKey)) throw badRequest(`未定义的实体类 ${classKey}`, "invalid_ontology_schema");
    entities.push({
      entity_id: requiredId(point?.id, "knowledge_point.id"), entity_kind: "knowledge_point", class_key: classKey,
      name: cleanText(point?.name, 600), description: cleanText(point?.measurable_behavior ?? point?.description, 3_000),
      aliases: array(point?.aliases).map((item) => cleanText(item, 300)).filter(Boolean),
      properties: omit(point, ["id", "entity_class", "name", "measurable_behavior", "description", "aliases", "source_ref", "review_status"]),
      source_ref: isPlainObject(point?.source_ref) ? point.source_ref : {},
      review_status: cleanText(point?.review_status, 80) || "candidate"
    });
  }
  for (const instance of array(value.instances)) {
    const classKey = requiredId(instance?.entity_class ?? instance?.class_key, "instance.entity_class");
    if (!classKeys.has(classKey)) throw badRequest(`未定义的实体类 ${classKey}`, "invalid_ontology_schema");
    entities.push({
      entity_id: requiredId(instance?.id, "instance.id"), entity_kind: "ontology_instance", class_key: classKey,
      name: cleanText(instance?.name, 600), description: cleanText(instance?.description, 3_000),
      aliases: array(instance?.aliases),
      properties: omit(instance, ["id", "entity_class", "class_key", "name", "description", "aliases", "source_ref", "review_status"]),
      source_ref: isPlainObject(instance?.source_ref) ? instance.source_ref : {},
      review_status: cleanText(instance?.review_status, 80) || "candidate"
    });
  }
  const entityIds = new Set();
  for (const entity of entities) {
    if (entityIds.has(entity.entity_id)) throw badRequest(`重复实体 ID ${entity.entity_id}`, "duplicate_ontology_entity");
    entityIds.add(entity.entity_id);
    if (!entity.name) throw badRequest(`实体 ${entity.entity_id} 缺少名称`, "invalid_ontology_entity");
  }

  const sourceRelations = [...array(value.edges), ...array(value.relations)];
  const sourceRelationKeys = new Set(sourceRelations.map((edge) => [
    edge?.source ?? edge?.source_id,
    edge?.target ?? edge?.target_id,
    edge?.type ?? edge?.relation_type
  ].map((part) => String(part || "")).join("\u0000")));
  const relations = [];
  for (const theme of array(value.themes)) {
    const key = [theme?.id, theme?.domain_id, "part_of"].map((part) => String(part || "")).join("\u0000");
    if (theme?.domain_id && !sourceRelationKeys.has(key)) {
      relations.push(structuralRelation(`part-of:${theme.id}:${theme.domain_id}`, theme.id, theme.domain_id));
    }
  }
  for (const point of array(value.knowledge_points)) {
    const key = [point?.id, point?.theme_id, "part_of"].map((part) => String(part || "")).join("\u0000");
    if (point?.theme_id && !sourceRelationKeys.has(key)) {
      relations.push(structuralRelation(`part-of:${point.id}:${point.theme_id}`, point.id, point.theme_id));
    }
  }
  for (const edge of sourceRelations) {
    const relationType = requiredId(edge?.type ?? edge?.relation_type, "relation.type");
    if (!relationTypeByKey.has(relationType)) throw badRequest(`未定义的关系类型 ${relationType}`, "invalid_ontology_schema");
    relations.push({
      relation_id: requiredId(edge?.id ?? `relation:${relations.length + 1}`, "relation.id"),
      source_entity_id: requiredId(edge?.source ?? edge?.source_id, "relation.source"),
      target_entity_id: requiredId(edge?.target ?? edge?.target_id, "relation.target"),
      relation_type: relationType,
      directed: edge?.directed ?? relationTypeByKey.get(relationType).directed,
      properties: omit(edge, ["id", "source", "source_id", "target", "target_id", "type", "relation_type", "directed", "review_status"]),
      review_status: cleanText(edge?.review_status, 80) || "candidate"
    });
  }
  const relationIds = new Set();
  for (const relation of relations) {
    if (relationIds.has(relation.relation_id)) throw badRequest(`重复关系 ID ${relation.relation_id}`, "duplicate_ontology_relation");
    relationIds.add(relation.relation_id);
    if (!entityIds.has(relation.source_entity_id) || !entityIds.has(relation.target_entity_id)) {
      throw badRequest(`关系 ${relation.relation_id} 引用了不存在的实体`, "dangling_ontology_relation");
    }
  }
  return {
    ontology_id: ontologyId,
    ontology_version: ontologyVersion,
    name: cleanText(value.name, 400) || ontologyId,
    description: cleanText(value.description, 4_000),
    schema_version: cleanText(value.schema_version, 160) || "learning-ontology@1.0",
    source_document: isPlainObject(value.source_document) ? value.source_document : {},
    educational_boundaries: isPlainObject(value.educational_boundaries) ? value.educational_boundaries : {},
    visualization_profile: isPlainObject(value.visualization_profile) ? value.visualization_profile : {},
    review_status: cleanText(value.review_status, 80) || "curated",
    entity_classes: entityClasses,
    relation_types: relationTypes,
    entities,
    relations
  };
}

function normalizeQuestionBank(publicCatalog, privateCatalog) {
  if (!isPlainObject(publicCatalog) || !Array.isArray(publicCatalog.items)) {
    throw badRequest("公开题库缺少 items", "invalid_question_bank");
  }
  if (!isPlainObject(privateCatalog) || !Array.isArray(privateCatalog.items)
    || privateCatalog.storage_classification !== "server_private") {
    throw badRequest("私有答案库无效或未标记 server_private", "invalid_private_question_bank");
  }
  const ontologyId = requiredId(publicCatalog.ontology_ref?.id, "ontology_ref.id");
  const ontologyVersion = requiredId(publicCatalog.ontology_ref?.version, "ontology_ref.version");
  const privateById = new Map(privateCatalog.items.map((item) => [requiredId(item?.question_id, "private.question_id"), item]));
  const itemIds = new Set();
  const items = publicCatalog.items.map((item) => {
    const id = requiredId(item?.id, "question.id");
    if (itemIds.has(id)) throw badRequest(`重复题目 ID ${id}`, "duplicate_question");
    itemIds.add(id);
    assertNoPrivateQuestionFields(item);
    const rawMappings = Array.isArray(item.knowledge_point_mapping)
      ? item.knowledge_point_mapping
      : item.knowledge_point_id ? [{ id: item.knowledge_point_id, role: "primary", weight: 1 }] : [];
    const mappings = rawMappings.map((mapping) => ({
      knowledge_point_id: requiredId(mapping?.id ?? mapping?.knowledge_point_id ?? mapping, "question.knowledge_point_id"),
      mapping_role: cleanText(mapping?.role, 80) || "primary",
      weight: clamp(Number(mapping?.weight ?? 1), 0, 1)
    }));
    if (!mappings.length) throw badRequest(`题目 ${id} 未关联知识点`, "question_without_knowledge_point");
    return {
      id,
      version: cleanText(item.version, 120) || "1.0",
      title: cleanText(item.title, 600),
      stem: cleanText(item.stem, 8_000),
      question_type: cleanText(item.question_type, 120) || "unknown",
      difficulty: cleanText(item.difficulty?.code ?? item.difficulty, 120),
      proposition_method: cleanText(item.proposition_method?.code ?? item.proposition_method, 160),
      ability_level: cleanText(item.ability_level, 120),
      public_payload: item,
      private_payload: privateById.get(id) || null,
      review_status: cleanText(item.provenance?.review_status ?? item.item_status, 120) || "candidate",
      mappings
    };
  });
  return {
    bank_id: requiredId(publicCatalog.bank_id, "bank_id"),
    version: requiredId(publicCatalog.version, "bank_version"),
    schema_version: cleanText(publicCatalog.schema_version, 160) || "assessment-item-public-bank@1.0",
    ontology_id: ontologyId,
    ontology_version: ontologyVersion,
    provenance: isPlainObject(publicCatalog.provenance) ? publicCatalog.provenance : {},
    build_fingerprint: cleanText(publicCatalog.build_fingerprint, 200),
    items
  };
}

function normalizeEvidence(value) {
  if (!isPlainObject(value)) throw badRequest("掌握证据必须是 JSON 对象", "invalid_mastery_evidence");
  const score = value.score == null ? null : Number(value.score);
  if (score != null && (!Number.isFinite(score) || score < 0 || score > 1)) {
    throw badRequest("score 必须介于 0 和 1 之间", "invalid_mastery_score");
  }
  const weight = Number(value.weight ?? 1);
  if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
    throw badRequest("weight 必须介于 0 和 100 之间", "invalid_mastery_weight");
  }
  const sampleCount = Math.max(1, Math.floor(Number(value.sample_count ?? 1) || 1));
  if (sampleCount > 100_000) {
    throw badRequest("sample_count 不能大于 100000", "invalid_sample_count");
  }
  const occurredAt = cleanText(value.occurred_at, 80);
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    throw badRequest("occurred_at 必须是有效时间", "invalid_evidence_time");
  }
  const sourceType = cleanText(value.source_type, 120) || "unknown";
  const metadata = isPlainObject(value.metadata) ? value.metadata : {};
  const requestedClass = cleanText(value.evidence_class, 40);
  const evidenceClass = requestedClass
    || (sourceType === "rebuildable_demo_seed" || metadata.demo_seed === true
      ? "demo"
      : value.apply_to_mastery === true ? "legacy" : "proposal");
  if (!["real", "demo", "proposal", "legacy"].includes(evidenceClass)) {
    throw badRequest("无效的 evidence_class", "invalid_evidence_class");
  }
  if (evidenceClass === "proposal" && value.apply_to_mastery === true) {
    throw badRequest("Agent 提议不能直接更新掌握度", "proposal_cannot_apply_to_mastery");
  }
  const verifiedReceiptId = cleanOptionalId(value.verified_receipt_id, "verified_receipt_id");
  if (evidenceClass === "real" && !verifiedReceiptId) {
    throw badRequest("真实掌握证据必须关联已验证判题回执", "verified_receipt_required");
  }
  return {
    evidence_id: requiredId(value.evidence_id, "evidence_id"),
    ontology_id: requiredId(value.ontology_id, "ontology_id"),
    ontology_version: requiredId(value.ontology_version, "ontology_version"),
    knowledge_point_id: requiredId(value.knowledge_point_id, "knowledge_point_id"),
    evidence_type: cleanText(value.evidence_type, 120) || "direct_assessment",
    outcome: cleanText(value.outcome, 120) || "observed",
    score,
    weight,
    sample_count: sampleCount,
    apply_to_mastery: value.apply_to_mastery === true,
    source_type: sourceType,
    source_ref: requiredId(value.source_ref, "source_ref"),
    metadata,
    evidence_class: evidenceClass,
    verified_receipt_id: verifiedReceiptId,
    question_id: cleanOptionalId(value.question_id, "question_id"),
    attempt_id: cleanOptionalId(value.attempt_id, "attempt_id"),
    occurred_at: new Date(occurredAt).toISOString()
  };
}

function normalizeVerifiedReceipt(value) {
  if (!isPlainObject(value)) throw badRequest("判题回执必须是 JSON 对象", "invalid_grading_receipt");
  const payloadHash = cleanText(value.payload_hash, 80).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(payloadHash)) {
    throw badRequest("判题回执缺少合法的 payload_hash", "invalid_grading_receipt_hash");
  }
  const verifiedAt = cleanText(value.verified_at, 80);
  if (!verifiedAt || Number.isNaN(Date.parse(verifiedAt))) {
    throw badRequest("判题回执 verified_at 无效", "invalid_grading_receipt_time");
  }
  return {
    receipt_id: requiredId(value.receipt_id, "receipt_id"),
    tenant_id: requiredId(value.tenant_id, "tenant_id"),
    student_id: requiredId(value.student_id, "student_id"),
    attempt_id: requiredId(value.attempt_id, "attempt_id"),
    question_id: requiredId(value.question_id, "question_id"),
    question_version: requiredId(value.question_version, "question_version"),
    payload_hash: payloadHash,
    payload: isPlainObject(value.payload) ? value.payload : {},
    verifier_id: requiredId(value.verifier_id, "verifier_id"),
    verified_at: new Date(verifiedAt).toISOString(),
  };
}

function structuralRelation(id, source, target) {
  return {
    relation_id: id,
    source_entity_id: requiredId(source, "relation.source"),
    target_entity_id: requiredId(target, "relation.target"),
    relation_type: "part_of",
    directed: true,
    properties: { generated_structure_edge: true },
    review_status: "curated"
  };
}

function studentRow(row) {
  return {
    tenant_id: row.tenant_id,
    student_id: row.student_id,
    name: row.name,
    grade: row.grade,
    goal: row.goal,
    avatar: row.avatar,
    profile: parseJson(row.profile_json, {}),
    is_demo: Boolean(row.is_demo),
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function ontologyRow(row) {
  return {
    tenant_id: row.tenant_id,
    ontology_id: row.ontology_id,
    ontology_version: row.ontology_version,
    name: row.name,
    description: row.description,
    schema_version: row.schema_version,
    source_document: parseJson(row.source_document_json, {}),
    educational_boundaries: parseJson(row.boundaries_json, {}),
    visualization_profile: parseJson(row.visualization_json, {}),
    review_status: row.review_status,
    knowledge_point_count: Number(row.knowledge_point_count || 0),
    relation_count: Number(row.relation_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function entityRow(row) {
  return {
    id: row.entity_id,
    entity_kind: row.entity_kind,
    entity_class: row.class_key,
    name: row.name,
    description: row.description,
    aliases: parseJson(row.aliases_json, []),
    properties: parseJson(row.properties_json, {}),
    source_ref: parseJson(row.source_ref_json, {}),
    review_status: row.review_status
  };
}

function relationRow(row) {
  return {
    id: row.relation_id,
    source: row.source_entity_id,
    target: row.target_entity_id,
    type: row.relation_type,
    directed: Boolean(row.directed),
    properties: parseJson(row.properties_json, {}),
    review_status: row.review_status
  };
}

function publicQuestionRow(row, mappings) {
  const payload = parseJson(row.public_payload_json, {});
  return {
    ...payload,
    id: row.question_id,
    version: row.question_version,
    title: row.title,
    stem: row.stem,
    question_type: row.question_type,
    difficulty_code: row.difficulty,
    proposition_method_code: row.proposition_method,
    ability_level: row.ability_level,
    review_status: row.review_status,
    knowledge_point_mappings: mappings
  };
}

function masteryRow(row) {
  return {
    knowledge_point_id: row.knowledge_point_id,
    knowledge_point_name: row.knowledge_point_name,
    mastery_state: row.mastery_state,
    mastery_probability: row.mastery_probability == null ? null : Number(row.mastery_probability),
    confidence: Number(row.confidence),
    evidence_count: Number(row.evidence_count),
    total_weight: Number(row.total_weight),
    latest_source: row.latest_source,
    last_event_at: row.last_event_at,
    state_version: Number(row.state_version)
  };
}

function masteryEvidenceRow(row) {
  return {
    evidence_id: row.evidence_id,
    student_id: row.student_id,
    ontology_id: row.ontology_id,
    ontology_version: row.ontology_version,
    knowledge_point_id: row.knowledge_point_id,
    knowledge_point_name: row.knowledge_point_name || null,
    evidence_type: row.evidence_type,
    outcome: row.outcome,
    score: row.score == null ? null : Number(row.score),
    weight: Number(row.weight),
    sample_count: Number(row.sample_count || 1),
    apply_to_mastery: Boolean(row.apply_to_mastery),
    source_type: row.source_type,
    source_ref: row.source_ref,
    metadata: parseJson(row.metadata_json, {}),
    evidence_class: row.evidence_class,
    verified_receipt_id: row.verified_receipt_id || null,
    question_id: row.question_id || null,
    attempt_id: row.attempt_id || null,
    occurred_at: row.occurred_at,
    created_at: row.created_at,
  };
}

function unassessedMastery(knowledgePointId) {
  return {
    knowledge_point_id: knowledgePointId,
    mastery_state: "unassessed",
    mastery_probability: null,
    confidence: 0,
    evidence_count: 0,
    total_weight: 0,
    latest_source: null,
    last_event_at: null,
    state_version: 0
  };
}

function learningEventRow(row) {
  return {
    event_id: row.event_id,
    student_id: row.student_id,
    event_type: row.event_type,
    title: row.title,
    description: row.description,
    source_type: row.source_type,
    source_ref: row.source_ref,
    payload: parseJson(row.payload_json, {}),
    occurred_at: row.occurred_at,
    created_at: row.created_at
  };
}

function agentTraceRow(row) {
  return {
    id: row.trace_id,
    trace_id: row.trace_id,
    conversation_id: row.conversation_id,
    message_id: row.message_id,
    student_id: row.student_id,
    request_id: row.request_id,
    skill_id: row.skill_id,
    status: row.status,
    total_ms: Number(row.total_ms) || 0,
    request: parseJson(row.request_json, {}),
    summary: parseJson(row.summary_json, {}),
    started_at: row.started_at,
    ended_at: row.ended_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function agentTraceSpanRow(row) {
  return {
    id: row.span_id,
    span_id: row.span_id,
    trace_id: row.trace_id,
    parent_span_id: row.parent_span_id,
    sequence: Number(row.sequence) || 0,
    name: row.name,
    kind: row.kind,
    status: row.status,
    duration_ms: Number(row.duration_ms) || 0,
    input: parseJson(row.input_json, {}),
    output: parseJson(row.output_json, {}),
    error: parseJson(row.error_json, {}),
    started_at: row.started_at,
    ended_at: row.ended_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function masteryPolicyRow(row) {
  return {
    tenant_id: row.tenant_id,
    policy_key: row.policy_key,
    schema_version: row.schema_version,
    enabled: Boolean(row.enabled),
    algorithm: row.algorithm,
    config: parseJson(row.config_json, {}),
    config_version: Number(row.config_version),
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function verifiedReceiptRow(row) {
  return {
    receipt_id: row.receipt_id,
    student_id: row.student_id,
    attempt_id: row.attempt_id,
    question_id: row.question_id,
    question_version: row.question_version,
    verifier_id: row.verifier_id,
    verified_at: row.verified_at,
  };
}

function evidenceEquivalent(row, item, studentId) {
  return row
    && row.student_id === studentId
    && row.ontology_id === item.ontology_id
    && row.ontology_version === item.ontology_version
    && row.knowledge_point_id === item.knowledge_point_id
    && row.outcome === item.outcome
    && nullableNumber(row.score) === nullableNumber(item.score)
    && Number(row.weight) === Number(item.weight)
    && Number(row.sample_count) === Number(item.sample_count)
    && Boolean(row.apply_to_mastery) === Boolean(item.apply_to_mastery)
    && row.source_type === item.source_type
    && row.source_ref === item.source_ref
    && row.evidence_class === item.evidence_class
    && String(row.verified_receipt_id || "") === String(item.verified_receipt_id || "")
    && String(row.question_id || "") === String(item.question_id || "")
    && String(row.attempt_id || "") === String(item.attempt_id || "");
}

function nullableNumber(value) {
  return value == null ? null : Number(value);
}

function assertNoPrivateQuestionFields(value, path = "$") {
  const forbidden = new Set(["answer", "answer_key", "correct_answer", "correct_option_id", "final_answer", "solution_plan", "explanation"]);
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoPrivateQuestionFields(item, `${path}[${index}]`));
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw badRequest(`公开题目包含私有字段 ${path}.${key}`, "public_question_private_leak");
    assertNoPrivateQuestionFields(child, `${path}.${key}`);
  }
}

function masteryState(probability) {
  if (probability >= 0.85) return "mastered";
  if (probability >= 0.7) return "secure";
  if (probability >= 0.45) return "learning";
  return "weak";
}

function snakeRow(row) {
  return row ? { ...row } : row;
}

function requiredId(value, field) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 200 || !/^[\p{L}\p{N}_.:@/+~-]+$/u.test(id)) {
    throw badRequest(`${field} 不是合法标识符`, "invalid_identifier");
  }
  return id;
}

function cleanOptionalId(value, field) {
  if (value == null || String(value).trim() === "") return null;
  return requiredId(value, field);
}

function cleanText(value, maxLength = 1_000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeIsoTime(value, fallback) {
  const candidate = value == null || value === "" ? fallback : value;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback).toISOString() : parsed.toISOString();
}

function safeTraceDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) ? Math.max(0, Math.min(3_600_000, Math.round(duration))) : 0;
}

function normalizeTraceStatus(value, fallback) {
  const status = cleanText(value, 40).toLowerCase();
  return ["running", "success", "error", "cancelled", "timeout"].includes(status)
    ? status
    : fallback;
}

function redactTraceValue(value, depth = 0, budget = { count: 0 }) {
  budget.count += 1;
  if (depth > 8 || budget.count > 2_000) return "[TRUNCATED]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value
      .slice(0, 12_000)
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/giu, "Bearer [REDACTED]")
      .replace(/\bark-[A-Za-z0-9_-]{12,}\b/gu, "ark-[REDACTED]")
      .replace(/\b(?:sk|api)[-_][A-Za-z0-9_-]{16,}\b/giu, "[REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactTraceValue(item, depth + 1, budget));
  }
  if (typeof value !== "object") return cleanText(value, 1_000);
  const result = {};
  for (const [key, child] of Object.entries(value).slice(0, 120)) {
    if (/(?:authorization|api[_-]?key|access[_-]?token|secret|password|image[_-]?data|base64|raw[_-]?image)/iu.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = redactTraceValue(child, depth + 1, budget);
  }
  return result;
}

function safeLimit(value) {
  return Math.min(MAX_LIMIT, Math.max(1, Number(value) || DEFAULT_LIMIT));
}

function safeOffset(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/gu, "\\$&");
}

function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function omit(value, keys) {
  if (!isPlainObject(value)) return {};
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value) {
  return Number(Number(value).toFixed(4));
}

function badRequest(message, code) {
  return new EducationDataStoreError(message, { code, status: 400 });
}

function notFound(message, code) {
  return new EducationDataStoreError(message, { code, status: 404 });
}

function conflict(message, code) {
  return new EducationDataStoreError(message, { code, status: 409 });
}
