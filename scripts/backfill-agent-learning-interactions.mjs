import "dotenv/config";

import Database from "better-sqlite3";

import { createEducationDataRuntime } from "../education-data-runtime.js";
import { createEducationDataService } from "../education-data-service.js";

const runtime = createEducationDataRuntime({ env: process.env });
const ontology = runtime.store.listOntologies({ tenantId: runtime.tenantId })[0];

if (!ontology) {
  runtime.store.close();
  throw new Error("当前租户没有可用于补记学习互动的知识本体");
}

const reader = new Database(runtime.store.filename, { readonly: true, fileMustExist: true });
const traceRows = reader.prepare(`SELECT
    t.trace_id,
    t.student_id,
    t.started_at,
    s.output_json
  FROM education_agent_traces t
  JOIN education_agent_trace_spans s
    ON s.tenant_id=t.tenant_id AND s.trace_id=t.trace_id
  WHERE t.tenant_id=? AND t.status='success' AND s.name='pi_agent_runtime'
  ORDER BY t.started_at ASC, s.sequence ASC`).all(runtime.tenantId);
reader.close();

const service = createEducationDataService({ store: runtime.store });
const seenTraceIds = new Set();
let interactionCount = 0;
let evidenceCount = 0;
let skippedCount = 0;

for (const row of traceRows) {
  if (seenTraceIds.has(row.trace_id)) continue;
  const output = parseObject(row.output_json);
  const knowledgePointIds = Array.isArray(output.knowledge_point_ids)
    ? [...new Set(output.knowledge_point_ids.map(String).map((value) => value.trim()).filter(Boolean))]
    : [];
  if (output.status !== "answered" || !knowledgePointIds.length) {
    skippedCount += 1;
    continue;
  }
  seenTraceIds.add(row.trace_id);
  const receipt = service.recordLearningInteraction({
    tenantId: runtime.tenantId,
    studentId: row.student_id,
    interaction: {
      interaction_id: row.trace_id,
      ontology_id: ontology.ontology_id,
      ontology_version: ontology.ontology_version,
      knowledge_point_ids: knowledgePointIds,
      event_type: output.skill || "knowledge_tutor",
      evidence_type: "knowledge_interaction",
      outcome: "knowledge_exposure",
      source_type: "pi_learning_interaction",
      occurred_at: row.started_at,
      title: "完成一次 AI 教师知识问答",
      description: "从已完成会话补记学习足迹；普通提问不作为掌握度得分。",
    },
  });
  interactionCount += 1;
  evidenceCount += receipt.records.length;
}

runtime.store.close();

process.stdout.write(`${JSON.stringify({
  tenant_id: runtime.tenantId,
  ontology_id: ontology.ontology_id,
  interactions_processed: interactionCount,
  evidence_records_processed: evidenceCount,
  rows_skipped: skippedCount,
}, null, 2)}\n`);

function parseObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
