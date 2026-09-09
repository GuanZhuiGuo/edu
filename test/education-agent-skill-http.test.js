import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createEducationAgentSkillHttpHandler } from "../education-agent-skill-http.js";
import { createEducationAgentSkillRegistry } from "../education-agent-skill-registry.js";

function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[String(name).toLowerCase()] = value; };
  res.end = (body = "") => { res.body = String(body); res.writableEnded = true; };
  return res;
}

function request(method = "GET") {
  return { method, headers: { authorization: "Bearer local" } };
}

test("serves a read-only public Skill list and detail", () => {
  const handler = createEducationAgentSkillHttpHandler({
    registry: createEducationAgentSkillRegistry(),
    authorizeRequest: () => true,
  });
  const listRes = response();
  const listHandled = handler(
    request(),
    listRes,
    new URL("http://localhost/api/education/agent/skills"),
  );
  const list = JSON.parse(listRes.body);

  assert.equal(listHandled, true);
  assert.equal(listRes.statusCode, 200);
  assert.equal(list.published_skill_count, 4);
  assert.equal(list.skills[0].id, "knowledge_tutor");
  assert.equal(JSON.stringify(list).includes("system_prompt"), false);

  const detailRes = response();
  handler(
    request(),
    detailRes,
    new URL("http://localhost/api/education/agent/skills/photo_solver"),
  );
  const detail = JSON.parse(detailRes.body);
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detail.skill.id, "photo_solver");
  assert.equal(detail.skill.input.accepts_image, true);
});

test("rejects unauthorized reads and does not accept browser writes", () => {
  const registry = createEducationAgentSkillRegistry();
  const denied = createEducationAgentSkillHttpHandler({ registry, authorizeRequest: () => false });
  const deniedRes = response();
  assert.equal(denied(request(), deniedRes, new URL("http://localhost/api/education/agent/skills")), true);
  assert.equal(deniedRes.statusCode, 403);

  const allowed = createEducationAgentSkillHttpHandler({ registry, authorizeRequest: () => true });
  const postRes = response();
  assert.equal(allowed(request("POST"), postRes, new URL("http://localhost/api/education/agent/skills")), false);
  assert.equal(postRes.body, undefined);
});

test("returns 404 for malformed or unpublished Skill ids", () => {
  const handler = createEducationAgentSkillHttpHandler({
    registry: createEducationAgentSkillRegistry(),
    authorizeRequest: () => true,
  });
  for (const pathname of [
    "/api/education/agent/skills/not_published",
    "/api/education/agent/skills/%252e%252e",
  ]) {
    const res = response();
    assert.equal(handler(request(), res, new URL(`http://localhost${pathname}`)), true);
    assert.equal(res.statusCode, 404);
  }
});
