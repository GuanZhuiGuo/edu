import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BRIDGE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIRECTORY = path.resolve(BRIDGE_DIRECTORY, "../..");
const OPENMAIC_DIRECTORY = path.join(
  PROJECT_DIRECTORY,
  "third_party",
  "openmaic"
);
const OPENMAIC_WORKER_PATH = path.join(
  BRIDGE_DIRECTORY,
  "generated",
  "official-worker.mjs"
);

const DEFAULT_TIMEOUT_MS = 240_000;
const FORCE_KILL_GRACE_MS = 1_500;
const MAX_SOURCE_LENGTH = 20_000;
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

export const OPENMAIC_OFFICIAL_PROVENANCE = deepFreeze({
  upstream_repo: "https://github.com/THU-MAIC/OpenMAIC",
  source_revision: "fcdb6d62b380c066de2a4733910669c9e697b83a",
  source_revision_date: "2026-07-03T14:19:38+08:00",
  source_revision_subject:
    "feat(dsl): own element-level normalization & defaults; wire the generator (#787) (#832)",
  repository_version: "0.3.0",
  npm_provenance: {
    package: "@openmaic/dsl",
    version: "0.3.0",
    source_revision: "fcdb6d62b380c066de2a4733910669c9e697b83a"
  },
  renderer: {
    package: "@openmaic/renderer",
    version: "0.0.2",
    source_entry:
      "packages/@openmaic/renderer/src/index.ts#SlideCanvas",
    built_entry:
      "packages/@openmaic/renderer/dist/index.js#SlideCanvas"
  },
  license: "MIT",
  license_file: "LICENSE",
  integration: "official-source-pipeline",
  upstream_modified: false,
  source_files: [
    "lib/generation/generation-pipeline.ts",
    "lib/generation/pipeline-runner.ts",
    "lib/generation/outline-generator.ts",
    "lib/generation/scene-generator.ts",
    "lib/api/stage-api.ts",
    "lib/api/stage-api-scene.ts",
    "packages/@openmaic/renderer/src/SlideCanvas.tsx",
    "LICENSE"
  ],
  local_bridge: {
    worker: "source-bridges/openmaic/official-worker.ts",
    built_worker:
      "source-bridges/openmaic/generated/official-worker.mjs",
    build_script:
      "source-bridges/openmaic/build-official-worker.mjs",
    compatibility_reason:
      "The upstream root package has no ESM type while @openmaic/dsl is ESM-only; the pinned upstream esbuild compiles an ESM worker without changing upstream source.",
    transport: "JSONL child-process RPC",
    model_boundary:
      "The host injects the official AICallFn callback; credentials are removed from the worker environment.",
    output_boundary:
      "Returns native OpenMAIC Stage, Scene, Slide, QuizQuestion and Action objects without an A2UI or compact projection."
  }
});

export class OpenMaicOfficialBridgeError extends Error {
  constructor(message, { code = "OPENMAIC_BRIDGE_ERROR", details } = {}) {
    super(message);
    this.name = "OpenMaicOfficialBridgeError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/**
 * Run the real OpenMAIC two-stage generation pipeline from the pinned upstream
 * checkout. The callback has OpenMAIC's native AICallFn signature:
 *
 *   aiCall(systemPrompt, userPrompt, images?) => Promise<string>
 *
 * Returned data is the native OpenMAIC wire shape. In particular, slide
 * canvases remain at `scenes[n].content.canvas` and playback actions remain at
 * `scenes[n].actions`.
 */
export async function runOpenMaicOfficialPipeline(
  source,
  {
    aiCall,
    onProgress,
    onStageComplete,
    onTrace,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}
) {
  const normalizedSource = normalizeSource(source);
  if (typeof aiCall !== "function") {
    throw new OpenMaicOfficialBridgeError(
      "OpenMAIC official generation requires an injected aiCall(systemPrompt, userPrompt, images?) callback.",
      { code: "OPENMAIC_AI_CALL_REQUIRED" }
    );
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 900_000
  ) {
    throw new OpenMaicOfficialBridgeError(
      "timeoutMs must be an integer between 1000 and 900000.",
      {
        code: "OPENMAIC_INVALID_TIMEOUT",
        details: { timeoutMs }
      }
    );
  }
  if (signal?.aborted) {
    throw abortError(signal.reason);
  }
  if (!existsSync(OPENMAIC_WORKER_PATH)) {
    throw new OpenMaicOfficialBridgeError(
      "The official OpenMAIC worker bundle is missing. Run node source-bridges/openmaic/build-official-worker.mjs.",
      {
        code: "OPENMAIC_WORKER_NOT_BUILT",
        details: {
          expected: OPENMAIC_WORKER_PATH
        }
      }
    );
  }

  return new Promise((resolve, reject) => {
    const modelAbortController = new AbortController();
    const worker = spawn(
      process.execPath,
      [OPENMAIC_WORKER_PATH],
      {
        cwd: OPENMAIC_DIRECTORY,
        env: createWorkerEnvironment(),
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    let settled = false;
    let stdoutBuffer = "";
    let stderrTail = "";
    let aiCallCount = 0;
    let forceKillTimeout = null;
    safelyNotify(onTrace, {
      type: "process.start",
      stage: "openmaic.worker",
      status: "started",
      title: "OpenMAIC 官方 Worker 已启动",
      message: "正在加载固定版本的 Generation Pipeline"
    });

    const timeout = setTimeout(() => {
      modelAbortController.abort();
      finishWithError(
        new OpenMaicOfficialBridgeError(
          `OpenMAIC official pipeline timed out after ${timeoutMs}ms.`,
          {
            code: "OPENMAIC_PIPELINE_TIMEOUT",
            details: { timeoutMs, aiCallCount }
          }
        )
      );
    }, timeoutMs);
    timeout.unref?.();

    const onAbort = () => {
      modelAbortController.abort();
      finishWithError(abortError(signal?.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    function cleanUp({ terminate = false } = {}) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (terminate && worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGTERM");
        forceKillTimeout = setTimeout(() => {
          if (worker.exitCode === null && worker.signalCode === null) {
            worker.kill("SIGKILL");
          }
        }, FORCE_KILL_GRACE_MS);
        forceKillTimeout.unref?.();
      }
    }

    function finishWithError(error) {
      if (settled) return;
      settled = true;
      modelAbortController.abort();
      cleanUp({ terminate: true });
      safelyNotify(onTrace, {
        type: "process.error",
        stage: "openmaic.worker",
        status:
          error?.code === "OPENMAIC_PIPELINE_ABORTED"
            ? "cancelled"
            : "failed",
        title:
          error?.code === "OPENMAIC_PIPELINE_ABORTED"
            ? "OpenMAIC 生成已取消"
            : "OpenMAIC 官方 Worker 失败",
        message: "Worker 已停止，未发布未完成的原生场景",
        meta: {
          error_code:
            typeof error?.code === "string"
              ? error.code
              : "OPENMAIC_PIPELINE_FAILED",
          count: aiCallCount
        }
      });
      reject(error);
    }

    function finishWithResult(result) {
      if (settled) return;
      settled = true;
      cleanUp();
      worker.stdin.end();
      safelyNotify(onTrace, {
        type: "process.complete",
        stage: "openmaic.worker",
        status: "completed",
        title: "OpenMAIC 官方 Worker 完成",
        message: "原生 Stage、Scene 与 Action 已返回宿主",
        meta: {
          count: aiCallCount,
          scene_count: Array.isArray(result?.scenes)
            ? result.scenes.length
            : 0,
          outline_count: Array.isArray(result?.outlines)
            ? result.outlines.length
            : 0
        }
      });
      resolve(result);
    }

    function writeMessage(message) {
      if (
        settled ||
        worker.stdin.destroyed ||
        worker.stdin.writableEnded ||
        !worker.stdin.writable
      ) return false;
      try {
        return worker.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        return false;
      }
    }

    async function handleAiCall(message) {
      const callIndex = ++aiCallCount;
      const callId =
        typeof message.id === "string" && message.id
          ? message.id
          : `openmaic_${callIndex}`;
      const startedAt = Date.now();
      safelyNotify(onTrace, {
        type: "model.bridge",
        stage:
          callIndex === 1
            ? "openmaic.outlines"
            : "openmaic.scene_generation",
        status: "started",
        title:
          callIndex === 1
            ? "OpenMAIC 请求课堂大纲"
            : `OpenMAIC 请求场景内容 · ${callIndex}`,
        message: "官方 AICallFn 已交由宿主模型客户端执行",
        call_id: callId
      });
      try {
        const text = await aiCall(
          message.systemPrompt,
          message.userPrompt,
          message.images,
          {
            callId,
            callIndex,
            signal: modelAbortController.signal
          }
        );
        if (typeof text !== "string") {
          throw new TypeError(
            `aiCall must resolve to a string, received ${describeValue(text)}.`
          );
        }
        writeMessage({
          type: "ai_result",
          id: message.id,
          text
        });
        safelyNotify(onTrace, {
          type: "model.bridge",
          stage:
            callIndex === 1
              ? "openmaic.outlines"
              : "openmaic.scene_generation",
          status: "completed",
          title: `OpenMAIC 模型调用 ${callIndex} 已交付`,
          message: "完整响应已返回官方 Worker",
          call_id: callId,
          meta: {
            duration_ms: Math.max(0, Date.now() - startedAt),
            characters: text.length
          }
        });
      } catch (error) {
        safelyNotify(onTrace, {
          type: "model.bridge",
          stage:
            callIndex === 1
              ? "openmaic.outlines"
              : "openmaic.scene_generation",
          status:
            modelAbortController.signal.aborted ? "cancelled" : "failed",
          title: `OpenMAIC 模型调用 ${callIndex} 失败`,
          message: "官方 Worker 将收到稳定的模型失败信号",
          call_id: callId,
          meta: {
            error_code:
              typeof error?.code === "string"
                ? error.code
                : "OPENMAIC_AI_CALL_FAILED",
            duration_ms: Math.max(0, Date.now() - startedAt)
          }
        });
        writeMessage({
          type: "ai_error",
          id: message.id,
          error: serializeError(error)
        });
      }
    }

    function handleMessage(message) {
      if (!message || typeof message !== "object") return;

      if (message.type === "ai_call") {
        void handleAiCall(message);
        return;
      }
      if (message.type === "progress") {
        safelyNotify(onProgress, message.progress);
        return;
      }
      if (message.type === "stage_complete") {
        safelyNotify(onStageComplete, message.stage, message.result);
        return;
      }
      if (message.type === "result") {
        finishWithResult({
          ...message.result,
          provenance: structuredClone(OPENMAIC_OFFICIAL_PROVENANCE)
        });
        return;
      }
      if (message.type === "error") {
        finishWithError(
          new OpenMaicOfficialBridgeError(
            message.error?.message || "OpenMAIC official worker failed.",
            {
              code: message.error?.code || "OPENMAIC_PIPELINE_FAILED",
              details: {
                worker: message.error?.details,
                stderr: stderrTail || undefined,
                aiCallCount
              }
            }
          )
        );
      }
    }

    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          try {
            handleMessage(JSON.parse(line));
          } catch (error) {
            finishWithError(
              new OpenMaicOfficialBridgeError(
                "OpenMAIC worker emitted invalid protocol data.",
                {
                  code: "OPENMAIC_INVALID_WORKER_PROTOCOL",
                  details: {
                    line: line.slice(0, 500),
                    cause: serializeError(error)
                  }
                }
              )
            );
            return;
          }
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-12_000);
    });

    worker.stdin.on("error", () => {
      finishWithError(
        new OpenMaicOfficialBridgeError(
          "OpenMAIC worker input channel closed unexpectedly.",
          { code: "OPENMAIC_WORKER_STDIN_FAILED" }
        )
      );
    });

    worker.on("error", (error) => {
      finishWithError(
        new OpenMaicOfficialBridgeError(
          `Unable to start the pinned OpenMAIC source worker: ${error.message}`,
          {
            code: "OPENMAIC_WORKER_START_FAILED",
            details: serializeError(error)
          }
        )
      );
    });

    worker.on("exit", (code, exitSignal) => {
      clearTimeout(forceKillTimeout);
      if (settled) return;
      finishWithError(
        new OpenMaicOfficialBridgeError(
          `OpenMAIC official worker exited before returning a result (code=${code}, signal=${exitSignal ?? "none"}).`,
          {
            code: "OPENMAIC_WORKER_EXITED",
            details: {
              code,
              signal: exitSignal,
              stderr: stderrTail || undefined,
              aiCallCount
            }
          }
        )
      );
    });

    writeMessage({
      type: "start",
      source: normalizedSource
    });
  });
}

export const generateOpenMaicOfficialMaterial =
  runOpenMaicOfficialPipeline;

function normalizeSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new OpenMaicOfficialBridgeError(
      "source must be a plain object.",
      { code: "OPENMAIC_INVALID_SOURCE" }
    );
  }

  const sourceText =
    typeof source.source_text === "string" ? source.source_text.trim() : "";
  if (
    sourceText.length < 20 ||
    sourceText.length > MAX_SOURCE_LENGTH
  ) {
    throw new OpenMaicOfficialBridgeError(
      `source.source_text must contain 20-${MAX_SOURCE_LENGTH} characters.`,
      {
        code: "OPENMAIC_INVALID_SOURCE",
        details: {
          path: "source.source_text",
          length: sourceText.length
        }
      }
    );
  }

  const title =
    source.title === undefined
      ? deriveTitle(sourceText)
      : requireNonEmptyString(source.title, "source.title", 120);
  const language =
    source.language === undefined
      ? "zh-CN"
      : requireNonEmptyString(source.language, "source.language", 40);
  const sourceId =
    source.source_id === undefined
      ? undefined
      : requireNonEmptyString(source.source_id, "source.source_id", 200);

  return {
    sourceText,
    title,
    language,
    ...(sourceId ? { sourceId } : {})
  };
}

function requireNonEmptyString(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new OpenMaicOfficialBridgeError(
      `${field} must be a non-empty string.`,
      {
        code: "OPENMAIC_INVALID_SOURCE",
        details: { path: field }
      }
    );
  }
  return value.trim().slice(0, maxLength);
}

function deriveTitle(sourceText) {
  const firstLine = sourceText
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  const firstSentence = (firstLine || sourceText).split(/[。！？.!?]/)[0].trim();
  return firstSentence.slice(0, 60) || "OpenMAIC 课程";
}

function createWorkerEnvironment() {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!CHILD_ENVIRONMENT_ALLOWLIST.has(name) || value === undefined) continue;
    environment[name] = String(value);
  }
  return {
    ...environment,
    LOG_LEVEL: "error",
    OPENMAIC_OFFICIAL_BRIDGE_WORKER: "1"
  };
}

function safelyNotify(callback, ...args) {
  if (typeof callback !== "function") return;
  try {
    const pending = callback(...args);
    if (pending && typeof pending.catch === "function") {
      pending.catch(() => {});
    }
  } catch {
    // Progress observers must not be able to corrupt official generation.
  }
}

function abortError(reason) {
  return new OpenMaicOfficialBridgeError(
    reason instanceof Error
      ? reason.message
      : "OpenMAIC official generation was aborted.",
    { code: "OPENMAIC_PIPELINE_ABORTED" }
  );
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return {
    name: "Error",
    message: String(error)
  };
}

function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
