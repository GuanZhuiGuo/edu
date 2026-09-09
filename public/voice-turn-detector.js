const DEFAULT_OPTIONS = Object.freeze({
  sampleRate: 16_000,
  frameDurationMs: 20,
  speechStartThreshold: 0.025,
  speechContinueThreshold: 0.015,
  minimumSpeechMs: 160,
  trailingSilenceMs: 750,
  maximumTurnMs: 25_000
});

/**
 * Small, transport-agnostic client VAD for committing one realtime voice turn.
 *
 * Feed either PCM Float32 samples:
 *   detector.pushFrame(float32Samples, performance.now())
 *
 * or an already calculated RMS frame:
 *   detector.pushFrame({ rms: 0.04, atMs: performance.now(), durationMs: 20 })
 *
 * A `commit` event is emitted at most once until `reset()` is called.
 */
export function createVoiceTurnDetector(options = {}) {
  const config = normalizeOptions(options);
  const onCommit = typeof options.onCommit === "function" ? options.onCommit : null;
  let state = createInitialState();

  return Object.freeze({
    pushFrame(frame, atMs) {
      if (state.committed) return null;

      const input = normalizeFrame(frame, atMs, config, state.lastFrameEndMs);
      if (!input) return null;

      const frameStartMs = input.atMs;
      const frameEndMs = frameStartMs + input.durationMs;
      state.lastFrameEndMs = frameEndMs;

      if (!state.speechStarted) {
        updateSpeechCandidate(state, input.rms, frameStartMs, frameEndMs, config);
        if (!state.speechStarted) return null;

        return Object.freeze({
          type: "speech_start",
          atMs: state.speechStartedAtMs,
          rms: input.rms
        });
      }

      if (input.rms >= config.speechContinueThreshold) {
        state.lastSpeechAtMs = frameEndMs;
      }

      const elapsedMs = Math.max(0, frameEndMs - state.speechStartedAtMs);
      if (elapsedMs >= config.maximumTurnMs) {
        return commit("maximum_turn", frameEndMs, elapsedMs);
      }

      const silenceMs = Math.max(0, frameEndMs - state.lastSpeechAtMs);
      if (silenceMs >= config.trailingSilenceMs) {
        return commit("trailing_silence", frameEndMs, elapsedMs);
      }

      return null;
    },

    reset() {
      state = createInitialState();
    },

    getState() {
      return Object.freeze({
        speechStarted: state.speechStarted,
        speechStartedAtMs: state.speechStartedAtMs,
        lastSpeechAtMs: state.lastSpeechAtMs,
        committed: state.committed,
        commitReason: state.commitReason
      });
    },

    config: Object.freeze({ ...config })
  });

  function commit(reason, atMs, elapsedMs) {
    if (state.committed) return null;
    state.committed = true;
    state.commitReason = reason;
    const event = Object.freeze({
      type: "commit",
      reason,
      atMs,
      speechStartedAtMs: state.speechStartedAtMs,
      speechDurationMs: elapsedMs
    });
    onCommit?.(event);
    return event;
  }
}

export function calculatePcmRms(samples) {
  if (!isFloat32Samples(samples) || samples.length === 0) return 0;
  let squareSum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? samples[index] : 0;
    squareSum += sample * sample;
  }
  return Math.sqrt(squareSum / samples.length);
}

function createInitialState() {
  return {
    speechCandidateAtMs: null,
    speechCandidateDurationMs: 0,
    speechStarted: false,
    speechStartedAtMs: 0,
    lastSpeechAtMs: 0,
    lastFrameEndMs: null,
    committed: false,
    commitReason: ""
  };
}

function updateSpeechCandidate(state, rms, frameStartMs, frameEndMs, config) {
  if (rms < config.speechStartThreshold) {
    state.speechCandidateAtMs = null;
    state.speechCandidateDurationMs = 0;
    return;
  }

  if (state.speechCandidateAtMs == null) {
    state.speechCandidateAtMs = frameStartMs;
    state.speechCandidateDurationMs = 0;
  }
  state.speechCandidateDurationMs = frameEndMs - state.speechCandidateAtMs;

  if (state.speechCandidateDurationMs < config.minimumSpeechMs) return;

  state.speechStarted = true;
  state.speechStartedAtMs = state.speechCandidateAtMs;
  state.lastSpeechAtMs = frameEndMs;
}

function normalizeFrame(frame, explicitAtMs, config, previousFrameEndMs) {
  let rms;
  let atMs = explicitAtMs;
  let durationMs;

  if (typeof frame === "number") {
    rms = frame;
  } else if (isFloat32Samples(frame)) {
    rms = calculatePcmRms(frame);
    durationMs = (frame.length / config.sampleRate) * 1000;
  } else if (frame && typeof frame === "object") {
    const samples = frame.samples ?? frame.pcm;
    rms = Number.isFinite(frame.rms)
      ? frame.rms
      : isFloat32Samples(samples)
        ? calculatePcmRms(samples)
        : NaN;
    atMs = frame.atMs ?? frame.timestampMs ?? explicitAtMs;
    durationMs = frame.durationMs;
    if (!Number.isFinite(durationMs) && isFloat32Samples(samples)) {
      durationMs = (samples.length / config.sampleRate) * 1000;
    }
  }

  if (!Number.isFinite(rms) || rms < 0) return null;
  const safeDurationMs = positiveNumber(durationMs, config.frameDurationMs);
  const fallbackAtMs = previousFrameEndMs ?? 0;
  const safeAtMs = nonNegativeNumber(atMs, fallbackAtMs);
  return {
    rms,
    atMs: Math.max(safeAtMs, fallbackAtMs),
    durationMs: safeDurationMs
  };
}

function normalizeOptions(options) {
  const speechStartThreshold = positiveNumber(
    options.speechStartThreshold,
    DEFAULT_OPTIONS.speechStartThreshold
  );
  const speechContinueThreshold = positiveNumber(
    options.speechContinueThreshold,
    Math.min(DEFAULT_OPTIONS.speechContinueThreshold, speechStartThreshold)
  );
  return {
    sampleRate: positiveNumber(options.sampleRate, DEFAULT_OPTIONS.sampleRate),
    frameDurationMs: positiveNumber(options.frameDurationMs, DEFAULT_OPTIONS.frameDurationMs),
    speechStartThreshold,
    speechContinueThreshold: Math.min(speechContinueThreshold, speechStartThreshold),
    minimumSpeechMs: positiveNumber(options.minimumSpeechMs, DEFAULT_OPTIONS.minimumSpeechMs),
    trailingSilenceMs: positiveNumber(options.trailingSilenceMs, DEFAULT_OPTIONS.trailingSilenceMs),
    maximumTurnMs: positiveNumber(options.maximumTurnMs, DEFAULT_OPTIONS.maximumTurnMs)
  };
}

function isFloat32Samples(value) {
  return value instanceof Float32Array;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

