import { runWithEducationDeadline, waitForEducationOperation } from "./education-operation-deadline.js";

const SAFE_CODES = new Set([
  "education_qdrant_collection_missing", "education_qdrant_collection_unhealthy",
  "education_qdrant_timeout", "education_qdrant_request_failed",
  "education_knowledge_probe_timeout", "retrieval_request_timeout",
  "retrieval_backend_failed",
]);

/** Process-owned health and circuit state; browser status never controls reads. */
export function createEducationKnowledgeConnectionMonitor({
  graphStore = null, vectorStore = null,
  probeTimeoutMs = 1_800, intervalMs = 30_000, refreshCooldownMs = 5_000,
  now = Date.now,
} = {}) {
  const stores = { neo4j: graphStore, qdrant: vectorStore };
  const components = Object.fromEntries(Object.entries(stores).map(([name, store]) => {
    const configured = store?.configSummary?.().configured && typeof store.health === "function";
    return [name, {
      status: configured ? "checking" : "unconfigured",
      latency_ms: null, checked_at: null,
      code: configured ? null : name === "qdrant"
        ? "education_qdrant_not_configured" : "neo4j_education_graph_unconfigured",
    }];
  }));
  const revisions = { neo4j: 0, qdrant: 0 };
  const lifetime = new AbortController();
  let checkedAt = null;
  let lastProbeStartedAt = null;
  let inFlight = null;
  let timer = null;
  let closed = false;

  function snapshot() {
    const values = Object.values(components);
    const healthy = values.every((item) => item.status === "healthy");
    const overall = healthy ? "healthy"
      : values.every((item) => item.status === "unconfigured") ? "unconfigured"
        : values.some((item) => item.status === "checking") ? "checking" : "degraded";
    const reason = healthy ? null
      : values.some((item) => item.status === "unconfigured") ? "remote_not_configured"
        : overall === "checking" ? "remote_checking" : "remote_unavailable";
    return {
      schema_version: "education-knowledge-connections@1.0",
      ok: healthy,
      overall,
      checked_at: checkedAt,
      next_check_at: closed || values.every((item) => item.status === "unconfigured")
        ? null : new Date((lastProbeStartedAt ?? now()) + intervalMs).toISOString(),
      components: Object.fromEntries(Object.entries(components).map(([name, value]) => [name, { ...value }])),
      retrieval: { mode: healthy ? "remote_hybrid" : "local_reviewed", remote_allowed: healthy, reason },
    };
  }

  async function probe(name) {
    if (components[name].status === "unconfigured") return;
    const revision = revisions[name];
    const started = now();
    let result;
    try {
      result = await runWithEducationDeadline((signal) => stores[name].health({
        ...(name === "qdrant" ? { includeCollection: true } : {}), signal,
      }), { signal: lifetime.signal, timeoutMs: probeTimeoutMs, code: "education_knowledge_probe_timeout" });
    } catch (error) {
      result = { ok: false, code: error?.code };
    }
    // A probe started before a real read failure cannot close the new circuit.
    if (closed || revision !== revisions[name]) return;
    components[name] = {
      status: result?.ok === true ? "healthy" : "unavailable",
      latency_ms: Math.max(0, now() - started),
      checked_at: new Date(now()).toISOString(),
      code: result?.ok === true ? null : safeCode(result?.code, name),
    };
  }

  function refresh({ force = false } = {}) {
    if (inFlight) return inFlight;
    if (closed || Object.values(components).every((item) => item.status === "unconfigured")) {
      return Promise.resolve(snapshot());
    }
    const age = lastProbeStartedAt === null ? Infinity : now() - lastProbeStartedAt;
    if (age < (force ? refreshCooldownMs : intervalMs)) return Promise.resolve(snapshot());
    lastProbeStartedAt = now();
    inFlight = Promise.all(Object.keys(stores).map(probe)).then(() => {
      checkedAt = new Date(now()).toISOString();
      return snapshot();
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  async function getStatus({ refresh: force = false, signal } = {}) {
    signal?.throwIfAborted();
    if (force || Object.values(components).some((item) => item.status === "checking")) {
      return waitForEducationOperation(refresh({ force }), signal);
    }
    // A known failure must never place a health check in the request path.
    void refresh();
    return snapshot();
  }

  function recordFailure(name, code) {
    if (!components[name] || components[name].status === "unconfigured" || closed) return;
    revisions[name] += 1;
    components[name] = {
      ...components[name], status: "unavailable", checked_at: new Date(now()).toISOString(),
      code: safeCode(code, name),
    };
    checkedAt = new Date(now()).toISOString();
  }

  function start() {
    if (closed || timer) return;
    void refresh();
    timer = setInterval(() => { void refresh(); }, intervalMs);
    timer.unref?.();
  }

  function close() {
    closed = true;
    clearInterval(timer);
    lifetime.abort();
  }

  return Object.freeze({ getStatus, snapshot, refresh, recordFailure, start, close });
}

function safeCode(code, name) {
  return SAFE_CODES.has(code) ? code : `${name}_unavailable`;
}
