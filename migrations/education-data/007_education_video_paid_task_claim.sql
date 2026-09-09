PRAGMA foreign_keys = ON;

-- A scene/model generation claim must be acquired atomically. This protects
-- against concurrent browser requests and against retrying an upstream POST
-- whose submission result is unknown.
CREATE UNIQUE INDEX IF NOT EXISTS education_video_paid_task_active_claim_idx
  ON education_video_generation_tasks(tenant_id, scene_id, task_type)
  WHERE scene_id IS NOT NULL
    AND task_type IN ('seedream_image', 'seedance_video')
    AND (
      status IN ('queued', 'submitting', 'running', 'cancel_requested')
      OR submission_state = 'unknown'
    );
