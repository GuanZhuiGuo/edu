import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createEducationVideoHttpHandler } from "../education-video-http.js";

test("HTTP accepts short generate routes and awaits available-import config", async (t) => {
  const calls = [];
  const resolutionCalls = [];
  const service = {
    listProjects() { return { projects: [] }; },
    async getConfig() { return { configured: true, imports: [{ import_id: "import-a", title: "课件" }] }; },
    async generateSceneImage(projectId, sceneId) {
      calls.push(["image", projectId, sceneId]);
      return { task_id: "image-task", status: "succeeded" };
    },
    async generateSceneVideo(projectId, sceneId) {
      calls.push(["video", projectId, sceneId]);
      return { task_id: "video-task", status: "running" };
    },
    async resolveUnknownSubmission(taskId, input) {
      resolutionCalls.push([taskId, input]);
      return { task_id: taskId, status: "failed", submission_state: "confirmed" };
    },
  };
  const handler = createEducationVideoHttpHandler({ service, authorizeRequest: () => true });
  const server = createServer(async (req, res) => {
    const handled = await handler(req, res, new URL(req.url, "http://127.0.0.1"));
    if (!handled) { res.statusCode = 404; res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const config = await fetch(`${base}/api/education/videos/config`).then((response) => response.json());
  assert.equal(config.imports[0].import_id, "import-a");

  const imageResponse = await fetch(`${base}/api/education/videos/projects/video-project-a/scenes/video-scene-a/image`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(imageResponse.status, 200);

  const videoResponse = await fetch(`${base}/api/education/videos/projects/video-project-a/scenes/video-scene-a/video/regenerate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(videoResponse.status, 202);
  const resolutionResponse = await fetch(`${base}/api/education/videos/tasks/video-task-unknown/submission-resolution`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resolution: "provider_task_not_created", note: "已在上游确认" }),
  });
  assert.equal(resolutionResponse.status, 200);
  assert.deepEqual(calls, [
    ["image", "video-project-a", "video-scene-a"],
    ["video", "video-project-a", "video-scene-a"],
  ]);
  assert.deepEqual(resolutionCalls, [[
    "video-task-unknown",
    { resolution: "provider_task_not_created", note: "已在上游确认" },
  ]]);
});
