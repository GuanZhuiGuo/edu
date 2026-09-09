import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_ASSETS = Object.freeze({
  ontology: join(moduleDir, "public", "data", "junior-math-ontology.json"),
  publicQuestions: join(moduleDir, "public", "data", "junior-math-question-bank.json"),
  privateQuestions: join(moduleDir, "data", "junior-math-question-bank-private.json"),
  mastery: join(moduleDir, "public", "data", "demo-student-mastery.json")
});

export const EDUCATION_DEMO_TENANT_ID = "local-demo";
export const EDUCATION_DEMO_STUDENTS = Object.freeze([
  Object.freeze({
    student_id: "user-lin-zhixia",
    name: "林知夏",
    grade: "八年级",
    goal: "期中数学提升",
    avatar: "林",
    is_demo: true,
    profile: Object.freeze({ color: "blue", mastery_variant: "balanced" })
  }),
  Object.freeze({
    student_id: "user-chen-yu",
    name: "陈屿",
    grade: "九年级",
    goal: "中考冲刺",
    avatar: "陈",
    is_demo: true,
    profile: Object.freeze({ color: "violet", mastery_variant: "advanced" })
  }),
  Object.freeze({
    student_id: "user-tang-guo",
    name: "唐果",
    grade: "七年级",
    goal: "基础巩固",
    avatar: "唐",
    is_demo: true,
    profile: Object.freeze({ color: "green", mastery_variant: "foundation" })
  })
]);

/**
 * Idempotently imports the checked-in curriculum assets into SQLite.
 *
 * These rows are reconstructable demo seed data, not measurements from real
 * students. They are explicitly marked is_demo/demo_seed at every personal
 * data boundary. Once written, all product reads come from SQLite.
 */
export function seedEducationDemoData({
  store,
  tenantId = EDUCATION_DEMO_TENANT_ID,
  assets = DEFAULT_ASSETS
} = {}) {
  if (!store) throw new TypeError("store is required");
  const sources = {
    ontology: readAsset(assets.ontology),
    publicQuestions: readAsset(assets.publicQuestions),
    privateQuestions: readAsset(assets.privateQuestions),
    mastery: readAsset(assets.mastery)
  };
  const ontology = JSON.parse(sources.ontology);
  const publicQuestions = JSON.parse(sources.publicQuestions);
  const privateQuestions = JSON.parse(sources.privateQuestions);
  const mastery = JSON.parse(sources.mastery);

  store.upsertTenant({ tenantId, name: "AI教师本地演示租户" });
  for (const student of EDUCATION_DEMO_STUDENTS) {
    store.upsertStudent({ tenantId, student });
  }

  const ontologyResult = store.importOntology({
    tenantId,
    ontology,
    seedRevision: digest(sources.ontology)
  });
  const questionResult = store.importQuestionBank({
    tenantId,
    publicCatalog: publicQuestions,
    privateCatalog: privateQuestions,
    seedRevision: digest(`${sources.publicQuestions}\n${sources.privateQuestions}`)
  });

  let evidenceInserted = 0;
  let evidenceIdempotent = 0;
  for (const student of EDUCATION_DEMO_STUDENTS) {
    for (const record of mastery.records || []) {
      const transformed = transformDemoMasteryRecord(record, student.student_id);
      if (!transformed) continue;
      const evidenceId = `demo-seed:${student.student_id}:${record.knowledge_point_id}`;
      const result = store.recordMasteryEvidence({
        tenantId,
        studentId: student.student_id,
        evidence: {
          evidence_id: evidenceId,
          ontology_id: mastery.ontology_id,
          ontology_version: mastery.ontology_version,
          knowledge_point_id: record.knowledge_point_id,
          evidence_type: "aggregate_snapshot_import",
          outcome: "historical_demo_snapshot",
          score: transformed.probability,
          weight: Math.min(100, Math.max(1, Number(record.evidence_count || 1))),
          sample_count: Math.max(1, Number(record.evidence_count || 1)),
          apply_to_mastery: true,
          source_type: "rebuildable_demo_seed",
          source_ref: evidenceId,
          occurred_at: record.last_event_at || "2026-08-06T00:00:00+08:00",
          metadata: {
            title: "导入演示学情快照",
            description: "可重建演示数据，不是真实学生测量证据。",
            demo_seed: true,
            source_snapshot_student_id: mastery.student_id,
            original_evidence_count: Number(record.evidence_count || 1),
            variant: student.profile.mastery_variant
          }
        }
      });
      if (result.idempotent) evidenceIdempotent += 1;
      else evidenceInserted += 1;
    }
  }

  return {
    tenant_id: tenantId,
    demo_seed: true,
    data_boundary: "rebuildable_demo_seed_not_real_student_measurement",
    students: EDUCATION_DEMO_STUDENTS.length,
    ontology: ontologyResult,
    question_bank: questionResult,
    mastery_evidence: {
      inserted: evidenceInserted,
      idempotent: evidenceIdempotent
    },
    summary: store.summary({ tenantId })
  };
}

function transformDemoMasteryRecord(record, studentId) {
  if (record?.mastery_probability == null || Number(record.evidence_count || 0) <= 0) return null;
  const base = Number(record.mastery_probability);
  const variation = stableHash(`${studentId}:${record.knowledge_point_id}`);
  let offset = 0;
  let assessmentRate = 100;
  if (studentId === "user-chen-yu") {
    offset = 0.08;
    assessmentRate = 96;
  } else if (studentId === "user-tang-guo") {
    offset = -0.09;
    assessmentRate = 78;
  }
  if (variation % 100 >= assessmentRate) return null;
  const jitter = ((variation % 9) - 4) * 0.012;
  return { probability: Number(clamp(base + offset + jitter, 0.08, 0.97).toFixed(4)) };
}

function readAsset(path) {
  return readFileSync(path, "utf8");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
