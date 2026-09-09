import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEducationDataStore } from "../education-data-store.js";
import {
  EducationVideoRepositoryError,
  createEducationVideoRepository,
} from "../education-video-repository.js";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "education-video-repository-"));
  const filename = join(directory, "education.sqlite");
  const store = createEducationDataStore({ filename });
  const migration = store.initialize();
  store.upsertTenant({ tenantId: "tenant-a", name: "A" });
  store.upsertTenant({ tenantId: "tenant-b", name: "B" });
  store.close();
  const repository = createEducationVideoRepository({ filename });
  t.after(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { repository, migration };
}

function createProject(repository, tenantId, projectId, importId = "import-shared") {
  return repository.createProject({
    tenantId,
    project: {
      project_id: projectId,
      title: projectId,
      source_import_id: importId,
      status: "source_ready",
    },
  });
}

function createVersion(repository, tenantId, projectId, suffix = "one", duration = 8) {
  return repository.createVersionWithScenes({
    tenantId,
    projectId,
    version: { version_id: `video-version-${suffix}`, status: "ready" },
    scenes: [{
      scene_id: `video-scene-${suffix}`,
      title: "镜头",
      duration_seconds: duration,
      status: "ready",
    }],
  });
}

test("migration 006/007 persists multiple projects per import and isolates tenants", (t) => {
  const { repository, migration } = fixture(t);
  assert.equal(migration.applied.includes("006_education_video_explanations.sql"), true);
  assert.equal(migration.applied.includes("007_education_video_paid_task_claim.sql"), true);

  createProject(repository, "tenant-a", "video-project-a1");
  createProject(repository, "tenant-a", "video-project-a2");
  createProject(repository, "tenant-b", "video-project-b1");

  assert.deepEqual(
    repository.listProjects({ tenantId: "tenant-a" }).projects.map((item) => item.project_id).sort(),
    ["video-project-a1", "video-project-a2"],
  );
  assert.deepEqual(
    repository.listProjects({ tenantId: "tenant-b" }).projects.map((item) => item.project_id),
    ["video-project-b1"],
  );
});

test("scene duration is 4-30 seconds and paid task claim is atomic", (t) => {
  const { repository } = fixture(t);
  createProject(repository, "tenant-a", "video-project-a1");
  createVersion(repository, "tenant-a", "video-project-a1", "min", 4);
  const maxProject = createVersion(repository, "tenant-a", "video-project-a1", "max", 30);
  assert.equal(maxProject.latest_version.scenes[0].duration_seconds, 30);

  assert.throws(
    () => createVersion(repository, "tenant-a", "video-project-a1", "too-short", 3),
    (error) => error instanceof EducationVideoRepositoryError && error.status === 400,
  );

  repository.createTask({
    tenantId: "tenant-a",
    task: {
      task_id: "video-task-first",
      project_id: "video-project-a1",
      version_id: "video-version-min",
      scene_id: "video-scene-min",
      task_type: "seedance_video",
      status: "queued",
      submission_state: "not_submitted",
    },
  });
  assert.throws(
    () => repository.createTask({
      tenantId: "tenant-a",
      task: {
        task_id: "video-task-second",
        project_id: "video-project-a1",
        version_id: "video-version-min",
        scene_id: "video-scene-min",
        task_type: "seedance_video",
        status: "queued",
        submission_state: "not_submitted",
      },
    }),
    (error) => error instanceof EducationVideoRepositoryError && error.status === 409,
  );
});
