import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCoursewareLibraryHttpHandler } from "../courseware-library-http.js";
import { createCoursewareLibraryRepository } from "../courseware-library-repository.js";

test("courseware library survives repository and service recreation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "courseware-library-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "courseware-library.json");
  const draft = {
    id: "courseware:openmaic-newton-draft",
    title: "牛顿第二定律互动课堂（OpenMAIC 草稿）",
    description: "8 场景大纲已生成，官方 Worker 在场景生成阶段中断。",
    subject: "物理",
    type: "visual",
    technology: "OpenMAIC",
    tags: ["八年级", "牛顿第二定律", "生成中断草稿"],
    interactive: false,
    html: "<!doctype html><title>OpenMAIC 草稿</title><p>场景进度 2/8</p>",
  };

  const first = createCoursewareLibraryRepository({ filename, now: () => "2026-09-12T10:10:10.000Z" });
  const saved = await first.save(draft);
  assert.equal(saved.id, draft.id);

  const restarted = createCoursewareLibraryRepository({ filename });
  const items = await restarted.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].title, draft.title);
  assert.match(items[0].html, /2\/8/);
  assert.equal(items[0].source, "saved");
  assert.equal(JSON.parse(await readFile(filename, "utf8")).schema_version, "courseware-library@1.0");
});

test("courseware library HTTP exposes the same durable record after a new repository instance", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "courseware-library-http-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "courseware-library.json");
  await createCoursewareLibraryRepository({ filename }).save({
    id: "courseware:restart-proof",
    title: "重启恢复草稿",
    type: "visual",
    html: "<!doctype html><title>重启恢复草稿</title>",
  });
  const handler = createCoursewareLibraryHttpHandler({
    repository: createCoursewareLibraryRepository({ filename }),
    authorizeRequest: () => true,
  });
  const server = createServer(async (req, res) => {
    const handled = await handler(req, res, new URL(req.url, "http://localhost"));
    if (!handled) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/courseware-library`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items[0].id, "courseware:restart-proof");
  assert.equal(body.items[0].source, "saved");
});
