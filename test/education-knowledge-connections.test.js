import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createEducationKnowledgeConnectionMonitor } from "../education-knowledge-connections.js";

function store(health = async () => ({ ok: true })) {
  return { configSummary: () => ({ configured: true }), health };
}

test("unconfigured dependencies are skipped without probing or exposing configuration", async () => {
  let probes = 0;
  const monitor = createEducationKnowledgeConnectionMonitor({
    vectorStore: { configSummary: () => ({ configured: false, password: "secret" }), health() { probes++; } },
  });
  const result = await monitor.getStatus();
  assert.equal(result.overall, "unconfigured");
  assert.equal(result.retrieval.remote_allowed, false);
  assert.equal(result.retrieval.mode, "local_reviewed");
  assert.equal(result.next_check_at, null);
  assert.equal(probes, 0);
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("first probes run in parallel, share one flight across callers and abort timed out work", async () => {
  let started = 0;
  let cancelled = 0;
  const blocked = store(({ signal }) => new Promise((_, reject) => {
    started++;
    signal.addEventListener("abort", () => { cancelled++; reject(signal.reason); }, { once: true });
  }));
  const monitor = createEducationKnowledgeConnectionMonitor({
    graphStore: blocked, vectorStore: blocked, probeTimeoutMs: 30,
  });
  const requests = Array.from({ length: 20 }, () => monitor.getStatus());
  await delay(5);
  assert.equal(started, 2, "both dependencies started before either completes");
  const results = await Promise.all(requests);
  assert.equal(cancelled, 2);
  assert.equal(results[0].overall, "degraded");
  assert.equal(results[0].components.neo4j.code, "education_knowledge_probe_timeout");
  assert.ok(results.every((result) => result.retrieval.remote_allowed === false));
  monitor.close();
});

test("known outages return cached status immediately while recovery is probed in background", async () => {
  let time = 100_000;
  let mode = "failed";
  let releaseProbe;
  let probeCount = 0;
  const graph = store(async () => {
    probeCount++;
    if (mode === "failed") throw new Error("bolt://user:secret@internal-host");
    return new Promise((resolve) => { releaseProbe = () => resolve({ ok: true }); });
  });
  const monitor = createEducationKnowledgeConnectionMonitor({
    graphStore: graph, vectorStore: store(), now: () => time,
  });
  const initial = await monitor.getStatus();
  assert.equal(initial.components.neo4j.status, "unavailable");
  assert.ok(!JSON.stringify(initial).includes("internal-host"));
  mode = "recovering";
  time += 31_000;
  const cached = await monitor.getStatus();
  assert.equal(cached.retrieval.remote_allowed, false);
  assert.equal(probeCount, 2);
  const probe = monitor.refresh();
  releaseProbe();
  const recovered = await probe;
  assert.equal(recovered.overall, "healthy");
  assert.equal(recovered.retrieval.mode, "remote_hybrid");
  monitor.close();
});

test("manual refresh is rate limited and cannot flood dependency probes", async () => {
  let time = 100_000;
  let count = 0;
  const healthy = store(async () => { count++; return { ok: true }; });
  const monitor = createEducationKnowledgeConnectionMonitor({
    graphStore: healthy, vectorStore: healthy, now: () => time,
  });
  await monitor.getStatus();
  await Promise.all(Array.from({ length: 12 }, () => monitor.getStatus({ refresh: true })));
  assert.equal(count, 2);
  time += 5_001;
  await Promise.all(Array.from({ length: 12 }, () => monitor.getStatus({ refresh: true })));
  assert.equal(count, 4);
  monitor.close();
});

test("cancelling one waiter does not cancel a shared health probe for another request", async () => {
  let release;
  let probeSignal;
  const graph = store(({ signal }) => {
    probeSignal = signal;
    return new Promise((resolve) => { release = resolve; });
  });
  const monitor = createEducationKnowledgeConnectionMonitor({ graphStore: graph, vectorStore: store() });
  const controller = new AbortController();
  const cancelled = monitor.getStatus({ signal: controller.signal });
  const active = monitor.getStatus();
  await delay(1);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(probeSignal.aborted, false);
  release({ ok: true });
  assert.equal((await active).ok, true);
  monitor.close();
});

test("a probe predating a real retrieval failure cannot overwrite its open circuit", async () => {
  let time = 100_000;
  let mode = "healthy";
  let release;
  const graph = store(async () => mode === "healthy" ? { ok: true }
    : new Promise((resolve) => { release = resolve; }));
  const monitor = createEducationKnowledgeConnectionMonitor({ graphStore: graph, vectorStore: store(), now: () => time });
  await monitor.getStatus();
  mode = "delayed";
  time += 31_000;
  const probe = monitor.refresh();
  await delay(1);
  monitor.recordFailure("neo4j", "retrieval_backend_failed");
  release({ ok: true });
  assert.equal((await probe).components.neo4j.status, "unavailable");
  mode = "healthy";
  time += 31_000;
  assert.equal((await monitor.refresh()).ok, true);
  monitor.close();
});

test("closing the monitor cancels active network probes", async () => {
  let cancelled = false;
  const graph = store(({ signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => { cancelled = true; reject(signal.reason); }, { once: true });
  }));
  const monitor = createEducationKnowledgeConnectionMonitor({ graphStore: graph, vectorStore: store() });
  const probe = monitor.getStatus();
  await delay(1);
  monitor.close();
  await probe;
  assert.equal(cancelled, true);
  assert.equal(monitor.snapshot().next_check_at, null);
});
