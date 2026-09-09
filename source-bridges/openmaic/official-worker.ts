import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { StageStore } from '../../third_party/openmaic/lib/api/stage-api-types.ts';
import type {
  AICallFn,
  GenerationCallbacks,
} from '../../third_party/openmaic/lib/generation/pipeline-types.ts';
import {
  createGenerationSession,
  runGenerationPipeline,
} from '../../third_party/openmaic/lib/generation/generation-pipeline.ts';
import type {
  Scene,
  Stage,
} from '../../third_party/openmaic/lib/types/stage.ts';

type SourceInput = {
  sourceText: string;
  title: string;
  language: string;
  sourceId?: string;
};

type IncomingMessage =
  | { type: 'start'; source: SourceInput }
  | { type: 'ai_result'; id: string; text: string }
  | {
      type: 'ai_error';
      id: string;
      error?: { name?: string; message?: string; stack?: string };
    };

type PendingCall = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};

const protocolWrite = process.stdout.write.bind(process.stdout);
const pendingCalls = new Map<string, PendingCall>();
const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let started = false;
let aiCallCount = 0;
let outlineMetadata: {
  courseTitle?: string;
  languageDirective?: string;
} = {};

// OpenMAIC's logger deliberately uses console.*. Keep stdout reserved for the
// JSONL protocol so upstream logging can never be mistaken for RPC data.
const stderrConsole = (...args: unknown[]) => {
  process.stderr.write(`${args.map(formatLogValue).join(' ')}\n`);
};
console.log = stderrConsole;
console.info = stderrConsole;
console.debug = stderrConsole;
console.warn = stderrConsole;
console.error = stderrConsole;

input.on('line', (line) => {
  let message: IncomingMessage;
  try {
    message = JSON.parse(line) as IncomingMessage;
  } catch (error) {
    void fail('OPENMAIC_INVALID_HOST_PROTOCOL', error);
    return;
  }

  if (message.type === 'start') {
    if (started) {
      void fail(
        'OPENMAIC_DUPLICATE_START',
        new Error('The OpenMAIC worker accepts exactly one start message.'),
      );
      return;
    }
    started = true;
    void run(message.source);
    return;
  }

  const pending = pendingCalls.get(message.id);
  if (!pending) return;
  pendingCalls.delete(message.id);

  if (message.type === 'ai_result') {
    pending.resolve(message.text);
  } else {
    const error = new Error(message.error?.message || 'The host aiCall callback failed.');
    error.name = message.error?.name || 'HostAICallError';
    if (message.error?.stack) error.stack = message.error.stack;
    pending.reject(error);
  }
});

input.on('close', () => {
  for (const pending of pendingCalls.values()) {
    pending.reject(new Error('The host closed the OpenMAIC bridge transport.'));
  }
  pendingCalls.clear();
});

async function run(source: SourceInput) {
  try {
    assertSource(source);
    const requirements = {
      requirement: source.sourceText,
    };
    const session = createGenerationSession(requirements);
    const timestamp = Date.now();
    const stage: Stage = {
      id: `stage_${session.id}`,
      name: source.title,
      description: source.sourceText.slice(0, 500),
      languageDirective: source.language,
      style: 'interactive',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const store = createInMemoryStore(stage);
    const aiCall: AICallFn = async (systemPrompt, userPrompt, images) => {
      const result = await requestHostAiCall(systemPrompt, userPrompt, images);
      if (aiCallCount === 1) {
        outlineMetadata = readOutlineMetadata(result);
      }
      return result;
    };
    const callbacks: GenerationCallbacks = {
      onProgress(progress) {
        send({ type: 'progress', progress });
      },
      onStageComplete(stageNumber, result) {
        send({
          type: 'stage_complete',
          stage: stageNumber,
          result,
        });
      },
      onError(error) {
        send({
          type: 'progress',
          progress: {
            ...session.progress,
            errors: [...(session.progress.errors || []), error],
          },
        });
      },
    };

    const pipelineResult = await runGenerationPipeline(
      session,
      store,
      aiCall,
      callbacks,
    );
    if (!pipelineResult.success || !pipelineResult.data) {
      throw bridgeError(
        'OPENMAIC_PIPELINE_FAILED',
        pipelineResult.error || 'The official OpenMAIC pipeline returned no session.',
      );
    }

    const state = store.getState();
    if (!state.scenes.length) {
      throw bridgeError(
        'OPENMAIC_NO_SCENES',
        'The official OpenMAIC pipeline completed without a generated Scene.',
      );
    }

    const finalStage: Stage = {
      ...(state.stage || stage),
      name: outlineMetadata.courseTitle || state.stage?.name || stage.name,
      languageDirective:
        outlineMetadata.languageDirective ||
        state.stage?.languageDirective ||
        stage.languageDirective,
      updatedAt: Date.now(),
    };
    store.setState({ stage: finalStage });

    const scenes = store.getState().scenes;
    const actions = scenes.flatMap((scene) => scene.actions || []);
    await sendFinal({
      type: 'result',
      result: {
        session: pipelineResult.data,
        outlines: pipelineResult.data.sceneOutlines || [],
        stage: finalStage,
        scenes,
        actions,
        execution: {
          mode: 'official-source',
          worker: 'source-bridges/openmaic/official-worker.ts',
          entrypoint:
            'lib/generation/generation-pipeline.ts#runGenerationPipeline',
          direct_symbols: [
            'createGenerationSession',
            'runGenerationPipeline',
          ],
          verified_pipeline_call_graph: [
            'generateSceneOutlinesFromRequirements',
            'generateFullScenes',
            'generateSceneContent',
            'generateSceneActions',
            'createSceneWithActions',
          ],
          ai_call_count: aiCallCount,
          credentials_available_to_worker: hasSensitiveCredentialEnvironment(),
          host_ai_callback: true,
          native_output: true,
          projections: [],
        },
      },
    });
  } catch (error) {
    const typedError = error as Error & { code?: string; details?: unknown };
    await fail(typedError.code || 'OPENMAIC_WORKER_FAILED', typedError);
  }
}

function createInMemoryStore(stage: Stage): StageStore {
  let state = {
    stage: stage as Stage | null,
    scenes: [] as Scene[],
    currentSceneId: null as string | null,
    mode: 'playback' as const,
  };
  const listeners: Array<(next: typeof state, previous: typeof state) => void> =
    [];

  return {
    getState: () => state,
    setState: (partial: Partial<typeof state>) => {
      const previous = state;
      state = { ...state, ...partial };
      listeners.forEach((listener) => listener(state, previous));
    },
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
  };
}

function requestHostAiCall(
  systemPrompt: string,
  userPrompt: string,
  images?: Array<{ id: string; src: string }>,
): Promise<string> {
  const id = `ai_${randomUUID()}`;
  aiCallCount += 1;
  return new Promise((resolve, reject) => {
    pendingCalls.set(id, { resolve, reject });
    send({
      type: 'ai_call',
      id,
      systemPrompt,
      userPrompt,
      ...(images ? { images } : {}),
    });
  });
}

function readOutlineMetadata(response: string) {
  try {
    const cleaned = response
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');
    const parsed = JSON.parse(cleaned) as {
      courseTitle?: unknown;
      languageDirective?: unknown;
    };
    return {
      ...(typeof parsed.courseTitle === 'string' && parsed.courseTitle.trim()
        ? { courseTitle: parsed.courseTitle.trim().slice(0, 120) }
        : {}),
      ...(typeof parsed.languageDirective === 'string' &&
      parsed.languageDirective.trim()
        ? { languageDirective: parsed.languageDirective.trim() }
        : {}),
    };
  } catch {
    return {};
  }
}

function hasSensitiveCredentialEnvironment() {
  const pattern =
    /(?:api[_-]?key|access[_-]?key|secret|password|credential|auth[_-]?token|bearer[_-]?token)/i;
  return Object.keys(process.env).some((name) => pattern.test(name));
}

function assertSource(source: SourceInput) {
  if (
    !source ||
    typeof source.sourceText !== 'string' ||
    typeof source.title !== 'string' ||
    typeof source.language !== 'string'
  ) {
    throw bridgeError(
      'OPENMAIC_INVALID_WORKER_INPUT',
      'The worker received an invalid normalized source.',
    );
  }
}

function bridgeError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function send(message: unknown) {
  protocolWrite(`${JSON.stringify(message)}\n`);
}

async function sendFinal(message: unknown) {
  await new Promise<void>((resolve, reject) => {
    protocolWrite(`${JSON.stringify(message)}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  input.close();
  process.exit(0);
}

async function fail(code: string, error: unknown) {
  const typedError = error instanceof Error ? error : new Error(String(error));
  await new Promise<void>((resolve) => {
    protocolWrite(
      `${JSON.stringify({
        type: 'error',
        error: {
          code,
          message: typedError.message,
          details:
            'details' in typedError
              ? (typedError as Error & { details?: unknown }).details
              : undefined,
        },
      })}\n`,
      () => resolve(),
    );
  });
  input.close();
  process.exit(1);
}

function formatLogValue(value: unknown) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
