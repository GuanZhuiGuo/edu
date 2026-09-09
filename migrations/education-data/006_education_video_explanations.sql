PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS education_video_projects (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'importing', 'source_ready', 'storyboarding', 'ready',
    'generating', 'composing', 'completed', 'failed', 'archived'
  )),
  source_import_id TEXT,
  source_file_name TEXT NOT NULL DEFAULT '',
  source_mime_type TEXT NOT NULL DEFAULT '',
  source_document_id TEXT,
  source_document_revision_id TEXT,
  audience TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'zh-CN',
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  visual_style TEXT NOT NULL DEFAULT 'education-clean',
  presenter_mode TEXT NOT NULL DEFAULT 'voice_over',
  voice_id TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, project_id),
  FOREIGN KEY (tenant_id) REFERENCES education_tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS education_video_projects_status_idx
  ON education_video_projects(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS education_video_projects_import_idx
  ON education_video_projects(tenant_id, source_import_id)
  WHERE source_import_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS education_video_versions (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'storyboarding', 'ready', 'generating', 'composing',
    'completed', 'failed', 'superseded'
  )),
  title TEXT NOT NULL DEFAULT '',
  overview TEXT NOT NULL DEFAULT '',
  learning_objectives_json TEXT NOT NULL DEFAULT '[]',
  script_json TEXT NOT NULL DEFAULT '{}',
  subtitle_json TEXT NOT NULL DEFAULT '{}',
  generation_settings_json TEXT NOT NULL DEFAULT '{}',
  composed_output_json TEXT NOT NULL DEFAULT '{}',
  model_receipt_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, version_id),
  UNIQUE (tenant_id, project_id, version_number),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES education_video_projects(tenant_id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS education_video_versions_project_idx
  ON education_video_versions(tenant_id, project_id, version_number DESC);

CREATE TABLE IF NOT EXISTS education_video_scenes (
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  scene_index INTEGER NOT NULL CHECK (scene_index >= 0),
  title TEXT NOT NULL,
  narration_text TEXT NOT NULL DEFAULT '',
  subtitle_text TEXT NOT NULL DEFAULT '',
  visual_type TEXT NOT NULL DEFAULT 'slide_explanation',
  visual_prompt TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 8 CHECK (duration_seconds BETWEEN 4 AND 30),
  key_points_json TEXT NOT NULL DEFAULT '[]',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  reference_assets_json TEXT NOT NULL DEFAULT '[]',
  image_output_json TEXT NOT NULL DEFAULT '{}',
  video_output_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'ready', 'image_queued', 'image_generating', 'image_ready',
    'video_queued', 'video_generating', 'completed', 'failed'
  )),
  error_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, scene_id),
  UNIQUE (tenant_id, version_id, scene_index),
  FOREIGN KEY (tenant_id, version_id)
    REFERENCES education_video_versions(tenant_id, version_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES education_video_projects(tenant_id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS education_video_scenes_version_idx
  ON education_video_scenes(tenant_id, version_id, scene_index);

CREATE TABLE IF NOT EXISTS education_video_assets (
  tenant_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  scene_id TEXT,
  asset_type TEXT NOT NULL CHECK (asset_type IN (
    'source_page', 'image', 'video', 'narration', 'subtitle', 'music', 'composed_video'
  )),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('draft', 'ready', 'failed', 'superseded')),
  provider TEXT NOT NULL DEFAULT '',
  provider_ref TEXT,
  source_url TEXT,
  local_path TEXT,
  mime_type TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, asset_id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES education_video_projects(tenant_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, version_id)
    REFERENCES education_video_versions(tenant_id, version_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, scene_id)
    REFERENCES education_video_scenes(tenant_id, scene_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS education_video_assets_scene_idx
  ON education_video_assets(tenant_id, version_id, scene_id, asset_type, created_at DESC);

CREATE TABLE IF NOT EXISTS education_video_generation_tasks (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  scene_id TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN ('seedream_image', 'seedance_video', 'compose_video')),
  provider TEXT NOT NULL DEFAULT 'ark',
  model TEXT NOT NULL DEFAULT '',
  provider_task_id TEXT,
  submission_state TEXT NOT NULL DEFAULT 'not_submitted' CHECK (submission_state IN (
    'not_submitted', 'submitting', 'confirmed', 'unknown'
  )),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'submitting', 'running', 'succeeded', 'failed',
    'cancel_requested', 'cancelled', 'unavailable'
  )),
  request_json TEXT NOT NULL DEFAULT '{}',
  response_json TEXT NOT NULL DEFAULT '{}',
  output_url TEXT,
  local_output_path TEXT,
  error_json TEXT NOT NULL DEFAULT '{}',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_poll_at TEXT,
  user_initiated INTEGER NOT NULL DEFAULT 1 CHECK (user_initiated IN (0, 1)),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, task_id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES education_video_projects(tenant_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, version_id)
    REFERENCES education_video_versions(tenant_id, version_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, scene_id)
    REFERENCES education_video_scenes(tenant_id, scene_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS education_video_tasks_project_idx
  ON education_video_generation_tasks(tenant_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS education_video_tasks_poll_idx
  ON education_video_generation_tasks(tenant_id, status, next_poll_at)
  WHERE status IN ('queued', 'submitting', 'running', 'cancel_requested');
CREATE UNIQUE INDEX IF NOT EXISTS education_video_tasks_provider_idx
  ON education_video_generation_tasks(tenant_id, provider, provider_task_id)
  WHERE provider_task_id IS NOT NULL;
