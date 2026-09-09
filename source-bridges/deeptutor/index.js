import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BRIDGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = path.join(BRIDGE_DIR, "bridge.py");
const BUNDLED_PYTHON = path.join(
  homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "bin",
  "python3"
);
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const FORCE_KILL_GRACE_MS = 1_500;
const CHILD_ENVIRONMENT_ALLOWLIST = new Set([
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT"
]);

export class DeepTutorNativeBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepTutorNativeBridgeError";
    this.code = code;
  }
}

/**
 * Execute the pinned upstream DeepTutor Book Engine.
 *
 * With `client`, model calls use JSONL callbacks and the Python process never
 * receives the client's credential. The client contract is the project's
 * existing `generateJson({system,prompt,schemaName,schema,signal,temperature})`.
 *
 * Without `client`, the child reads DEEPTUTOR_*, ARK_*, or OPENAI_* model
 * configuration from its process environment.
 */
export function runDeepTutorNative(
  source,
  {
    client,
    onTrace,
    signal,
    pythonPath,
    environment = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}
) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return rejectBeforeSpawn(
      onTrace,
      new DeepTutorNativeBridgeError(
        "INVALID_INPUT",
        "DeepTutor source must be an object"
      ),
      "process.error"
    );
  }
  if (client !== undefined && typeof client?.generateJson !== "function") {
    return rejectBeforeSpawn(
      onTrace,
      new DeepTutorNativeBridgeError(
        "INVALID_CLIENT",
        "client must expose generateJson(...)"
      ),
      "process.error"
    );
  }
  if (signal?.aborted) {
    return rejectBeforeSpawn(
      onTrace,
      new DeepTutorNativeBridgeError(
        "DEEPTUTOR_ABORTED",
        "DeepTutor generation was cancelled"
      ),
      "process.abort"
    );
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > DEFAULT_TIMEOUT_MS
  ) {
    return rejectBeforeSpawn(
      onTrace,
      new DeepTutorNativeBridgeError(
        "DEEPTUTOR_INVALID_TIMEOUT",
        `timeoutMs must be an integer between 1000 and ${DEFAULT_TIMEOUT_MS}`
      ),
      "process.error"
    );
  }

  return new Promise((resolve, reject) => {
    const childEnvironment = client
      ? withoutCredentialEnvironment(environment)
      : { ...environment };
    const resolvedPython = resolvePython(pythonPath, environment);
    const child = spawn(resolvedPython, [BRIDGE_SCRIPT], {
      cwd: BRIDGE_DIR,
      env: childEnvironment,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    let requestChain = Promise.resolve();
    const modelAbortController = new AbortController();
    let pipelineTimeout = null;
    let forceKillTimeout = null;

    const finishReject = (error, type = "process.error") => {
      if (settled) return;
      settled = true;
      modelAbortController.abort();
      clearTimeout(pipelineTimeout);
      signal?.removeEventListener("abort", abort);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        forceKillTimeout = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }, FORCE_KILL_GRACE_MS);
        forceKillTimeout.unref?.();
      }
      emitProcessTrace(onTrace, type, error);
      reject(error);
    };
    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      modelAbortController.abort();
      clearTimeout(pipelineTimeout);
      clearTimeout(forceKillTimeout);
      signal?.removeEventListener("abort", abort);
      emitDeepTutorTrace(onTrace, {
        type: "process.complete",
        stage: "deeptutor.process",
        status: "completed",
        title: "DeepTutor 源码进程已完成"
      });
      resolve(value);
    };
    const abort = () => {
      finishReject(
        new DeepTutorNativeBridgeError(
          "DEEPTUTOR_ABORTED",
          "DeepTutor generation was cancelled"
        ),
        "process.abort"
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
    pipelineTimeout = setTimeout(() => {
      finishReject(
        new DeepTutorNativeBridgeError(
          "DEEPTUTOR_PIPELINE_TIMEOUT",
          `DeepTutor generation timed out after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);
    pipelineTimeout.unref?.();
    emitDeepTutorTrace(onTrace, {
      type: "process.start",
      stage: "deeptutor.process",
      status: "started",
      title: "启动 DeepTutor 源码进程"
    });

    const writeLine = (value) => {
      if (
        child.stdin.destroyed ||
        child.stdin.writableEnded ||
        !child.stdin.writable
      ) return false;
      try {
        return child.stdin.write(`${JSON.stringify(value)}\n`);
      } catch {
        return false;
      }
    };

    const handleMessage = async (message) => {
      if (message?.type === "trace") {
        const event = normalizeDeepTutorTraceEvent(message.event);
        if (event) safeEmitTrace(onTrace, event);
        return;
      }
      if (message?.type === "llm_request") {
        if (!client) {
          throw new DeepTutorNativeBridgeError(
            "UNEXPECTED_RPC_REQUEST",
            "DeepTutor requested an RPC model callback without a client"
          );
        }
        const traceStage = deepTutorModelStage(message.stage);
        const callId = safeTraceToken(message.request_id) || "deeptutor-llm";
        emitDeepTutorTrace(onTrace, {
          type: "phase.start",
          stage: traceStage,
          status: "started",
          title: "DeepTutor 请求模型阶段",
          call_id: callId
        });
        try {
          const payload = await client.generateJson({
            system: message.system,
            prompt: message.prompt,
            schemaName: `deeptutor_native_${message.stage}`,
            schema: message.schema || schemaForStage(message.stage),
            signal: combineAbortSignals(
              signal,
              modelAbortController.signal
            ),
            stream: true,
            onTrace: (event) => safeEmitTrace(onTrace, event),
            traceContext: {
              stage: traceStage,
              callId
            },
            temperature: Number.isFinite(message.temperature)
              ? message.temperature
              : message.stage?.includes("critique")
                ? 0.1
                : 0.2,
            maxTokens: Number.isFinite(message.max_tokens)
              ? message.max_tokens
              : undefined
          });
          emitDeepTutorTrace(onTrace, {
            type: "model.success",
            stage: traceStage,
            status: "completed",
            title: "DeepTutor 模型阶段已完成",
            call_id: callId
          });
          writeLine({
            type: "llm_response",
            request_id: message.request_id,
            payload
          });
        } catch (error) {
          emitDeepTutorTrace(onTrace, {
            type: "model.error",
            stage: traceStage,
            status: "failed",
            title: "DeepTutor 模型阶段失败",
            call_id: callId,
            meta: {
              error_code: safeErrorCode(error, "PARENT_LLM_FAILED")
            }
          });
          writeLine({
            type: "llm_response",
            request_id: message.request_id,
            error: { code: "PARENT_LLM_FAILED" }
          });
        }
        return;
      }
      if (message?.type === "error" || message?.ok === false) {
        throw new DeepTutorNativeBridgeError(
          message?.error?.code || "DEEPTUTOR_BRIDGE_FAILED",
          message?.error?.message || "The native DeepTutor bridge failed"
        );
      }
      if (message?.type === "result" && message?.ok === true) {
        finishResolve(message);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        requestChain = requestChain
          .then(() => handleMessage(JSON.parse(line)))
          .catch((error) => {
            child.kill("SIGTERM");
            finishReject(
              error instanceof DeepTutorNativeBridgeError
                ? error
                : new DeepTutorNativeBridgeError(
                    "INVALID_BRIDGE_OUTPUT",
                    "DeepTutor bridge returned invalid JSON"
                  )
            );
          });
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      // Bound diagnostics and never include them in public errors.
      stderrBuffer = `${stderrBuffer}${chunk}`.slice(-16_000);
    });
    child.stdin.on("error", () => {
      finishReject(
        new DeepTutorNativeBridgeError(
          "DEEPTUTOR_STDIN_FAILED",
          "DeepTutor bridge input channel closed unexpectedly"
        )
      );
    });
    child.on("error", () => {
      finishReject(
        new DeepTutorNativeBridgeError(
          "DEEPTUTOR_PROCESS_FAILED",
          "Unable to start the native DeepTutor process"
        )
      );
    });
    child.on("close", (code) => {
      modelAbortController.abort();
      clearTimeout(pipelineTimeout);
      clearTimeout(forceKillTimeout);
      signal?.removeEventListener("abort", abort);
      requestChain.finally(() => {
        if (settled) return;
        finishReject(
          new DeepTutorNativeBridgeError(
            code === 0
              ? "DEEPTUTOR_EMPTY_RESULT"
              : "DEEPTUTOR_PROCESS_FAILED",
            "The native DeepTutor process ended without a result"
          )
        );
      });
    });

    writeLine({
      source_text: source.source_text,
      source_id: source.source_id,
      title: source.title,
      language: source.language,
      estimated_chapters: source.estimated_chapters,
      llm_mode: client ? "rpc" : "environment"
    });
  });
}

const TRACE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const DEEPTUTOR_TRACE_STATUSES = new Set([
  "pending",
  "started",
  "running",
  "streaming",
  "retrying",
  "completed",
  "failed",
  "cancelled",
  "info",
  "warning"
]);
const DEEPTUTOR_TRACE_META_KEYS = new Set([
  "round_label",
  "chapter_count",
  "issue_count",
  "verdict",
  "page_id",
  "chapter_id",
  "page_index",
  "page_count",
  "block_id",
  "block_type",
  "block_count",
  "ready_block_count",
  "kind",
  "upstream_stage",
  "payload_keys",
  "error_code"
]);

function rejectBeforeSpawn(onTrace, error, type) {
  emitProcessTrace(onTrace, type, error);
  return Promise.reject(error);
}

function emitProcessTrace(onTrace, type, error) {
  const aborted = type === "process.abort";
  emitDeepTutorTrace(onTrace, {
    type,
    stage: "deeptutor.process",
    status: aborted ? "cancelled" : "failed",
    title: aborted
      ? "DeepTutor 源码进程已取消"
      : "DeepTutor 源码进程失败",
    meta: {
      error_code: safeErrorCode(
        error,
        aborted ? "DEEPTUTOR_ABORTED" : "DEEPTUTOR_PROCESS_FAILED"
      )
    }
  });
}

function emitDeepTutorTrace(onTrace, event) {
  const normalized = normalizeDeepTutorTraceEvent(event);
  if (normalized) safeEmitTrace(onTrace, normalized);
}

function safeEmitTrace(onTrace, event) {
  if (typeof onTrace !== "function") return;
  try {
    const pending = onTrace(event);
    if (pending && typeof pending.then === "function") {
      Promise.resolve(pending).catch(() => {});
    }
  } catch {
    // Trace observers are diagnostic only and cannot affect generation.
  }
}

function normalizeDeepTutorTraceEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const type = safeTraceToken(event.type);
  const stage = safeTraceToken(event.stage);
  const status = DEEPTUTOR_TRACE_STATUSES.has(event.status)
    ? event.status
    : "";
  const title = safeTraceText(event.title, 160);
  if (!type || !stage.startsWith("deeptutor.") || !status || !title) return null;

  const normalized = { type, stage, status, title };
  const message = safeTraceText(event.message, 800);
  const callId = safeTraceToken(event.call_id);
  const meta = sanitizeDeepTutorTraceMeta(event.meta);
  if (message) normalized.message = message;
  if (callId) normalized.call_id = callId;
  if (meta) normalized.meta = meta;
  return normalized;
}

function sanitizeDeepTutorTraceMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (!DEEPTUTOR_TRACE_META_KEYS.has(key)) continue;
    if (typeof item === "boolean") {
      safe[key] = item;
    } else if (typeof item === "number" && Number.isFinite(item)) {
      safe[key] = item;
    } else if (typeof item === "string") {
      safe[key] = item.slice(0, 200);
    } else if (Array.isArray(item)) {
      safe[key] = item
        .filter((entry) =>
          typeof entry === "string"
          || typeof entry === "number"
          || typeof entry === "boolean"
        )
        .slice(0, 20)
        .map((entry) =>
          typeof entry === "string" ? entry.slice(0, 200) : entry
        );
    }
  }
  return Object.keys(safe).length ? safe : null;
}

function deepTutorModelStage(stage) {
  const suffix = safeTraceToken(stage) || "model";
  return `deeptutor.${suffix}`;
}

function safeErrorCode(error, fallback) {
  return safeTraceToken(error?.code) || fallback;
}

function safeTraceToken(value) {
  return typeof value === "string" && TRACE_TOKEN_PATTERN.test(value)
    ? value
    : "";
}

function safeTraceText(value, limit) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "")
        .slice(0, limit)
    : "";
}

function resolvePython(explicit, environment) {
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  for (const candidate of [
    environment?.DEEPTUTOR_PYTHON,
    environment?.PYTHON,
    process.env.DEEPTUTOR_PYTHON,
    process.env.PYTHON
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return existsSync(BUNDLED_PYTHON) ? BUNDLED_PYTHON : "python3";
}

function withoutCredentialEnvironment(environment) {
  const sanitized = {};
  for (const [key, value] of Object.entries(environment || {})) {
    if (!CHILD_ENVIRONMENT_ALLOWLIST.has(key) || value === undefined) continue;
    sanitized[key] = String(value);
  }
  return sanitized;
}

function combineAbortSignals(...signals) {
  const active = signals.filter(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      typeof candidate.addEventListener === "function"
  );
  if (active.length <= 1) return active[0];
  if (typeof globalThis.AbortSignal?.any === "function") {
    return globalThis.AbortSignal.any(active);
  }
  return active.find((candidate) => candidate.aborted) || active[0];
}

function schemaForStage(stage = "") {
  if (stage.includes("critique")) {
    return {
      type: "object",
      additionalProperties: false,
      required: ["issues", "verdict"],
      properties: {
        issues: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["category", "detail", "fix_hint"],
            properties: {
              category: { type: "string" },
              detail: { type: "string" },
              fix_hint: { type: "string" }
            }
          }
        },
        verdict: { type: "string", enum: ["ok", "revise"] }
      }
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["concept_graph", "chapters"],
    properties: {
      concept_graph: {
        type: "object",
        additionalProperties: false,
        required: ["nodes", "edges"],
        properties: {
          nodes: {
            type: "array",
            minItems: 1,
            maxItems: 24,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label", "description", "weight"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                description: { type: "string" },
                weight: { type: "number" }
              }
            }
          },
          edges: {
            type: "array",
            maxItems: 48,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["src", "dst", "relation", "rationale"],
              properties: {
                src: { type: "string" },
                dst: { type: "string" },
                relation: {
                  type: "string",
                  enum: ["depends_on", "extends", "related"]
                },
                rationale: { type: "string" }
              }
            }
          }
        }
      },
      chapters: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "learning_objectives",
            "content_type",
            "covers",
            "source_anchors",
            "prerequisites",
            "summary"
          ],
          properties: {
            title: { type: "string" },
            learning_objectives: {
              type: "array",
              items: { type: "string" }
            },
            content_type: {
              type: "string",
              enum: ["theory", "derivation", "history", "practice", "concept"]
            },
            covers: {
              type: "array",
              items: { type: "string" }
            },
            source_anchors: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "ref", "snippet"],
                properties: {
                  kind: {
                    type: "string",
                    enum: ["kb", "notebook", "chat", "manual"]
                  },
                  ref: { type: "string" },
                  snippet: { type: "string" }
                }
              }
            },
            prerequisites: {
              type: "array",
              items: { type: "string" }
            },
            summary: { type: "string" }
          }
        }
      }
    }
  };
}
