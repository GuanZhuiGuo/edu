import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createCoursewareDeepAgentHttpHandler } from "../courseware-deep-agent-http.js";
import { CoursewareDeepAgentError } from "../courseware-deep-agent.js";

async function start(t, { agent, authorizeRequest = () => true } = {}) {
  const handler = createCoursewareDeepAgentHttpHandler({ agent, authorizeRequest });
  const server = createServer(async (req, res) => {
    const handled = await handler(req, res, new URL(req.url, "http://localhost"));
    if (!handled) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function fakeAgent() {
  return {
    configSummary: () => ({ engine: "langchain_deepagents_js", configured: true, checkpoint: "memory_per_process", shell_access: false }),
    plan: async (input) => ({ engine: "deterministic_domain_router", status: "planned", plan: { title: input.prompt, recommended_type: null } }),
  };
}

test("courseware Agent HTTP config and plan endpoints expose only public data", async (t) => {
  const base = await start(t, { agent: fakeAgent() });
  const configResponse = await fetch(`${base}/api/courseware-agent/config`);
  assert.equal(configResponse.status, 200);
  assert.deepEqual(await configResponse.json(), {
    engine: "langchain_deepagents_js",
    configured: true,
    checkpoint: "memory_per_process",
    shell_access: false,
  });
  const planResponse = await fetch(`${base}/api/courseware-agent/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "制作一个二次函数参数实验。" }),
  });
  assert.equal(planResponse.status, 200);
  assert.equal((await planResponse.json()).plan.recommended_type, null);
  assert.equal(planResponse.headers.get("cache-control"), "no-store");
});

test("courseware Agent HTTP enforces authorization, method and content type", async (t) => {
  const denied = await start(t, { agent: fakeAgent(), authorizeRequest: () => false });
  assert.equal((await fetch(`${denied}/api/courseware-agent/config`)).status, 403);

  const base = await start(t, { agent: fakeAgent() });
  const method = await fetch(`${base}/api/courseware-agent/config`, { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET");
  const contentType = await fetch(`${base}/api/courseware-agent/plan`, { method: "POST", body: "{}" });
  assert.equal(contentType.status, 415);
  assert.equal((await contentType.json()).error, "courseware_plan_content_type_invalid");
});

test("courseware Agent HTTP does not leak provider errors", async (t) => {
  const agent = fakeAgent();
  agent.plan = async () => {
    throw new CoursewareDeepAgentError("courseware_deep_agent_failed", "Deep Agents JS 未能完成课件规划，系统可以回退到已有执行器。", {
      status: 502,
      cause: new Error("secret endpoint and credential"),
    });
  };
  const base = await start(t, { agent });
  const response = await fetch(`${base}/api/courseware-agent/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "制作一整套跨载体课堂课件。" }),
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.error, "courseware_deep_agent_failed");
  assert.doesNotMatch(JSON.stringify(body), /credential|secret endpoint/u);
});
