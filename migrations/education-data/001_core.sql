PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS education_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS education_tenants (
  tenant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS education_students (
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  name TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  profile_json TEXT NOT NULL DEFAULT '{}',
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, student_id),
  FOREIGN KEY (tenant_id) REFERENCES education_tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS education_ontologies (
  tenant_id TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  schema_version TEXT NOT NULL,
  source_document_json TEXT NOT NULL DEFAULT '{}',
  boundaries_json TEXT NOT NULL DEFAULT '{}',
  visualization_json TEXT NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'verified',
  seed_revision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, ontology_id, ontology_version),
  FOREIGN KEY (tenant_id) REFERENCES education_tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS education_entity_classes (
  tenant_id TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  class_key TEXT NOT NULL,
  name TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, ontology_id, ontology_version, class_key),
  FOREIGN KEY (tenant_id, ontology_id, ontology_version)
    REFERENCES education_ontologies(tenant_id, ontology_id, ontology_version) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS education_relation_types (
  tenant_id TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  relation_key TEXT NOT NULL,
  name TEXT NOT NULL,
  directed INTEGER NOT NULL CHECK (directed IN (0, 1)),
  definition TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, ontology_id, ontology_version, relation_key),
  FOREIGN KEY (tenant_id, ontology_id, ontology_version)
    REFERENCES education_ontologies(tenant_id, ontology_id, ontology_version) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS education_ontology_entities (
  tenant_id TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('domain', 'theme', 'knowledge_point', 'ontology_instance')),
  class_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  properties_json TEXT NOT NULL DEFAULT '{}',
  source_ref_json TEXT NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, ontology_id, ontology_version, entity_id),
  FOREIGN KEY (tenant_id, ontology_id, ontology_version)
    REFERENCES education_ontologies(tenant_id, ontology_id, ontology_version) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS education_entities_kind_idx
  ON education_ontology_entities(tenant_id, ontology_id, ontology_version, entity_kind);
CREATE INDEX IF NOT EXISTS education_entities_name_idx
  ON education_ontology_entities(tenant_id, ontology_id, ontology_version, name);

CREATE TABLE IF NOT EXISTS education_ontology_relations (
  tenant_id TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  relation_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  directed INTEGER NOT NULL CHECK (directed IN (0, 1)),
  properties_json TEXT NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, ontology_id, ontology_version, relation_id),
  FOREIGN KEY (tenant_id, ontology_id, ontology_version, source_entity_id)
    REFERENCES education_ontology_entities(tenant_id, ontology_id, ontology_version, entity_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, ontology_id, ontology_version, target_entity_id)
    REFERENCES education_ontology_entities(tenant_id, ontology_id, ontology_version, entity_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS education_relations_source_idx
  ON education_ontology_relations(tenant_id, ontology_id, ontology_version, source_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS education_relations_target_idx
  ON education_ontology_relations(tenant_id, ontology_id, ontology_version, target_entity_id, relation_type);

CREATE TABLE IF NOT EXISTS education_question_banks (
  tenant_id TEXT NOT NULL,
  bank_id TEXT NOT NULL,
  version TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  seed_revision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, bank_id, version),
  FOREIGN KEY (tenant_id, ontology_id, ontology_version)
    REFERENCES education_ontologies(tenant_id, ontology_id, ontology_version) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS education_questions (
  tenant_id TEXT NOT NULL,
  bank_id TEXT NOT NULL,
  bank_version TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_version TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  stem TEXT NOT NULL,
  question_type TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT '',
  proposition_method TEXT NOT NULL DEFAULT '',
  ability_level TEXT NOT NULL DEFAULT '',
  public_payload_json TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, question_id),
  FOREIGN KEY (tenant_id, bank_id, bank_version)
    REFERENCES education_question_banks(tenant_id, bank_id, version) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS education_questions_filter_idx
  ON education_questions(tenant_id, question_type, difficulty, proposition_method);

CREATE TABLE IF NOT EXISTS education_question_solutions (
  tenant_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  storage_classification TEXT NOT NULL DEFAULT 'server_private',
  private_payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, question_id),
  FOREIGN KEY (tenant_id, question_id)
    REFERENCES education_questions(tenant_id, question_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS education_question_knowledge_points (
  tenant_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  mapping_role TEXT NOT NULL DEFAULT 'primary',
  weight REAL NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 1),
  PRIMARY KEY (tenant_id, question_id, ontology_id, ontology_version, knowledge_point_id, mapping_role),
  FOREIGN KEY (tenant_id, question_id)
    REFERENCES education_questions(tenant_id, question_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, ontology_id, ontology_version, knowledge_point_id)
    REFERENCES education_ontology_entities(tenant_id, ontology_id, ontology_version, entity_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS education_question_kp_idx
  ON education_question_knowledge_points(tenant_id, ontology_id, ontology_version, knowledge_point_id);

CREATE TABLE IF NOT EXISTS education_mastery_evidence (
  tenant_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  score REAL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  weight REAL NOT NULL DEFAULT 1 CHECK (weight >= 0),
  apply_to_mastery INTEGER NOT NULL DEFAULT 0 CHECK (apply_to_mastery IN (0, 1)),
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, evidence_id),
  FOREIGN KEY (tenant_id, student_id)
    REFERENCES education_students(tenant_id, student_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, ontology_id, ontology_version, knowledge_point_id)
    REFERENCES education_ontology_entities(tenant_id, ontology_id, ontology_version, entity_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, student_id, source_type, source_ref, knowledge_point_id)
);

CREATE INDEX IF NOT EXISTS education_mastery_evidence_student_idx
  ON education_mastery_evidence(tenant_id, student_id, ontology_id, ontology_version, knowledge_point_id, occurred_at);

CREATE TABLE IF NOT EXISTS education_student_mastery (
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  ontology_id TEXT NOT NULL,
  ontology_version TEXT NOT NULL,
  knowledge_point_id TEXT NOT NULL,
  mastery_state TEXT NOT NULL CHECK (mastery_state IN ('mastered', 'secure', 'learning', 'weak', 'unassessed')),
  mastery_probability REAL CHECK (mastery_probability IS NULL OR (mastery_probability >= 0 AND mastery_probability <= 1)),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  total_weight REAL NOT NULL DEFAULT 0 CHECK (total_weight >= 0),
  latest_source TEXT,
  last_event_at TEXT,
  state_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, student_id, ontology_id, ontology_version, knowledge_point_id),
  FOREIGN KEY (tenant_id, student_id)
    REFERENCES education_students(tenant_id, student_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, ontology_id, ontology_version, knowledge_point_id)
    REFERENCES education_ontology_entities(tenant_id, ontology_id, ontology_version, entity_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS education_mastery_state_idx
  ON education_student_mastery(tenant_id, student_id, ontology_id, ontology_version, mastery_state);

CREATE TABLE IF NOT EXISTS education_learning_events (
  tenant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, event_id),
  FOREIGN KEY (tenant_id, student_id)
    REFERENCES education_students(tenant_id, student_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, student_id, source_type, source_ref, event_type)
);

CREATE INDEX IF NOT EXISTS education_learning_events_student_idx
  ON education_learning_events(tenant_id, student_id, occurred_at DESC);
