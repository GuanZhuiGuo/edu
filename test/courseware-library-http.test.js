import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCoursewareLibraryHttpHandler } from "../courseware-library-http.js";
import { createCoursewareLibraryRepository } from "../courseware-library-repository.js";

async function start(t, { authorizeRequest = () => true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "courseware-library-http-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCoursewareLibraryRepository({
    filename: join(directory, "library.json"),
    now: () => "2026-09-12T10:10:10.000Z",
  });
  const handler = createCoursewareLibraryHttpHandler({ repository, authorizeRequest });
  const server = createServer(async (req, res) => {
    const handled = await handler(req, res, new URL(req.url, "http://localhost"));
    if (!handled) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function draft() {
  return {
    id: "courseware:newton-lab",
    title: "牛顿第二定律互动实验",
    subject: "物理",
    type: "physics_lab",
    technology: "Matter.js",
    interactive: true,
    tags: ["力与运动"],
    lesson: { version: "1.0", lesson_id: "newton-lab" },
  };
}

test("courseware library HTTP saves, lists and deletes durable items", async (t) => {
  const base = await start(t);
  const savedResponse = await fetch(`${base}/api/courseware-library`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft()),
  });
  assert.equal(savedResponse.status, 200);
  assert.equal((await savedResponse.json()).item.id, draft().id);

  const listedResponse = await fetch(`${base}/api/courseware-library`);
  assert.equal(listedResponse.status, 200);
  assert.deepEqual((await listedResponse.json()).items.map((item) => item.id), [draft().id]);

  const deletedResponse = await fetch(`${base}/api/courseware-library/${encodeURIComponent(draft().id)}`, { method: "DELETE" });
  assert.equal(deletedResponse.status, 200);
  assert.equal((await deletedResponse.json()).deleted, true);
  assert.deepEqual((await (await fetch(`${base}/api/courseware-library`)).json()).items, []);
});

test("courseware library HTTP enforces authorization and JSON input", async (t) => {
  const blocked = await start(t, { authorizeRequest: () => false });
  assert.equal((await fetch(`${blocked}/api/courseware-library`)).status, 403);

  const base = await start(t);
  const unsupported = await fetch(`${base}/api/courseware-library`, { method: "PUT" });
  assert.equal(unsupported.status, 405);
  assert.match(unsupported.headers.get("allow") || "", /GET/);

  const invalid = await fetch(`${base}/api/courseware-library`, { method: "POST", body: "{}" });
  assert.equal(invalid.status, 415);
  assert.equal((await invalid.json()).error, "courseware_content_type_invalid");
});
