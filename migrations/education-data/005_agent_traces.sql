CREATE TABLE IF NOT EXISTS education_agent_traces (
  tenant_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  skill_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  total_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_ms >= 0),
  request_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, trace_id),
  FOREIGN KEY (tenant_id) REFERENCES education_tenants(tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id)
    REFERENCES education_students(tenant_id, student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS education_agent_traces_conversation_idx
  ON education_agent_traces(tenant_id, student_id, conversation_id, started_at DESC);

CREATE TABLE IF NOT EXISTS education_agent_trace_spans (
  tenant_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'running',
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, trace_id, span_id),
  FOREIGN KEY (tenant_id, trace_id)
    REFERENCES education_agent_traces(tenant_id, trace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS education_agent_trace_spans_order_idx
  ON education_agent_trace_spans(tenant_id, trace_id, sequence, started_at);
