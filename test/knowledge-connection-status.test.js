import test from "node:test";
import assert from "node:assert/strict";
import { createKnowledgeConnectionStore } from "../public/knowledge-connection-status.js";

const healthy = {
  overall: "healthy", checked_at: "2026-09-09T08:00:00.000Z",
  components: { neo4j: { status: "healthy" }, qdrant: { status: "healthy" } },
  retrieval: { mode: "hybrid" }
};
const response = (data = healthy) => ({ ok: true, json: async () => data });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness(fetch) {
  const doc = new EventTarget();
  doc.hidden = false;
  const view = new EventTarget();
  const timers = new Map();
  let nextTimer = 0;
  const store = createKnowledgeConnectionStore({
    document: doc, window: view, fetch,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return { store, doc, view, timers, runTimer(delay) {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `a ${delay} ms timer should exist`);
    timers.delete(entry[0]);
    entry[1].callback();
  } };
}

test("host and content subscribers share one initial request, polling timer and manual refresh", async () => {
  const requests = [];
  let gate = deferred();
  const h = harness((url, options) => { requests.push({ url, options }); return gate.promise; });
  const hostStates = [];
  const contentStates = [];
  h.store.subscribe(state => hostStates.push(state));
  const first = h.store.start();
  const unsubscribe = h.store.subscribe(state => contentStates.push(state));
  assert.equal(h.store.start(), first);
  assert.equal(h.store.check(true), first, "manual checks join an in-flight check");
  await Promise.resolve();
  assert.equal(requests.length, 1);
  gate.resolve(response());
  await first;
  assert.deepEqual(hostStates.at(-1), contentStates.at(-1));
  assert.equal(hostStates.at(-1).data, healthy);
  assert.equal(hostStates.at(-1).checking, false);
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 30000).length, 1);
  await h.store.start();
  assert.equal(requests.length, 1, "mounting a second view after load does not restart polling");

  gate = deferred();
  const refresh = h.store.check(true);
  assert.equal(h.store.check(true), refresh);
  await Promise.resolve();
  assert.equal(requests.length, 2);
  assert.equal(requests.at(-1).url, "/api/education/knowledge/connections?refresh=1");
  assert.equal(requests.at(-1).options.cache, "no-store");
  assert.equal(hostStates.at(-1).checking, true);
  assert.equal(contentStates.at(-1).checking, true);
  unsubscribe();
  const contentUpdates = contentStates.length;
  gate.resolve(response());
  await refresh;
  assert.equal(contentStates.length, contentUpdates);
  assert.equal(hostStates.at(-1).checking, false);
  h.store.destroy();
});

test("the owning document pauses hidden polling and deduplicates resume and online checks", async () => {
  let requests = 0;
  const h = harness(async () => { requests++; return response(); });
  await h.store.start();
  h.doc.hidden = true;
  h.doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.timers.size, 0);
  h.doc.hidden = false;
  h.doc.dispatchEvent(new Event("visibilitychange"));
  h.view.dispatchEvent(new Event("online"));
  await h.store.check();
  assert.equal(requests, 2);
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 30000).length, 1);
  h.runTimer(30000);
  await h.store.check();
  assert.equal(requests, 3);
  h.store.destroy();
});

test("a status timeout reports unknown to all views and a subsequent check can recover", async () => {
  let requests = 0;
  let timedOutSignal;
  const h = harness((_url, { signal }) => {
    requests++;
    if (requests > 1) return Promise.resolve(response());
    timedOutSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
  });
  const first = h.store.start();
  await Promise.resolve();
  h.runTimer(4500);
  await first;
  assert.equal(timedOutSignal.aborted, true);
  assert.deepEqual(h.store.getSnapshot(), { data: { overall: "unknown" }, checking: false });
  await h.store.check(true);
  assert.equal(h.store.getSnapshot().data.overall, "healthy");
  h.store.destroy();
});

test("invalid status responses remain unknown and destroying the owner stops all polling", async () => {
  let requests = 0;
  const h = harness(async () => { requests++; return response({ overall: "healthy" }); });
  await h.store.start();
  assert.equal(h.store.getSnapshot().data.overall, "unknown");
  h.store.destroy();
  assert.equal(h.timers.size, 0);
  h.view.dispatchEvent(new Event("online"));
  h.doc.dispatchEvent(new Event("visibilitychange"));
  await h.store.start();
  await h.store.check(true);
  assert.equal(requests, 1);
});
