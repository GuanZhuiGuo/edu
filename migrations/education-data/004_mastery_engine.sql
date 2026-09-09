ALTER TABLE education_mastery_evidence
  ADD COLUMN evidence_class TEXT NOT NULL DEFAULT 'legacy'
  CHECK (evidence_class IN ('real', 'demo', 'proposal', 'legacy'));

ALTER TABLE education_mastery_evidence
  ADD COLUMN verified_receipt_id TEXT;

ALTER TABLE education_mastery_evidence
  ADD COLUMN question_id TEXT;

ALTER TABLE education_mastery_evidence
  ADD COLUMN attempt_id TEXT;

UPDATE education_mastery_evidence
SET evidence_class = 'demo'
WHERE source_type = 'rebuildable_demo_seed'
   OR json_extract(metadata_json, '$.demo_seed') = 1;

UPDATE education_mastery_evidence
SET evidence_class = 'proposal'
WHERE apply_to_mastery = 0
  AND (source_type = 'agent_proposal' OR source_type LIKE '%proposal%');

CREATE TABLE IF NOT EXISTS education_mastery_policies (
  tenant_id TEXT NOT NULL,
  policy_key TEXT NOT NULL DEFAULT 'default',
  schema_version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  algorithm TEXT NOT NULL,
  config_json TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, policy_key),
  FOREIGN KEY (tenant_id) REFERENCES education_tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS education_verified_assessment_receipts (
  tenant_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_version TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  verifier_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, receipt_id),
  UNIQUE (tenant_id, student_id, attempt_id),
  FOREIGN KEY (tenant_id, student_id)
    REFERENCES education_students(tenant_id, student_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, question_id)
    REFERENCES education_questions(tenant_id, question_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS education_verified_receipts_question_idx
  ON education_verified_assessment_receipts(tenant_id, student_id, question_id, verified_at);

CREATE INDEX IF NOT EXISTS education_mastery_evidence_class_idx
  ON education_mastery_evidence(tenant_id, evidence_class, occurred_at);

CREATE UNIQUE INDEX IF NOT EXISTS education_mastery_verified_receipt_kp_idx
  ON education_mastery_evidence(tenant_id, verified_receipt_id, knowledge_point_id)
  WHERE verified_receipt_id IS NOT NULL;
