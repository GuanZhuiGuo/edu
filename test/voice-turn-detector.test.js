import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePcmRms,
  createVoiceTurnDetector
} from "../public/voice-turn-detector.js";

function feed(detector, values, { startAt = 0, frameMs = 20 } = {}) {
  const events = [];
  values.forEach((rms, index) => {
    const event = detector.pushFrame({
      rms,
      atMs: startAt + index * frameMs,
      durationMs: frameMs
    });
    if (event) events.push(event);
  });
  return events;
}

test("continuous silence never starts or commits a turn", () => {
  const detector = createVoiceTurnDetector();
  const events = feed(detector, Array(2_000).fill(0.004));

  assert.deepEqual(events, []);
  assert.deepEqual(detector.getState(), {
    speechStarted: false,
    speechStartedAtMs: 0,
    lastSpeechAtMs: 0,
    committed: false,
    commitReason: ""
  });
});

test("speech followed by about 750ms silence commits exactly once", () => {
  const committed = [];
  const detector = createVoiceTurnDetector({ onCommit: (event) => committed.push(event) });
  const events = feed(detector, [
    ...Array(10).fill(0.04),
    ...Array(37).fill(0.003),
    0.003
  ]);

  assert.equal(events.filter((event) => event.type === "speech_start").length, 1);
  const commit = events.find((event) => event.type === "commit");
  assert.equal(commit?.reason, "trailing_silence");
  assert.equal(committed.length, 1);

  assert.equal(detector.pushFrame({ rms: 0.04, atMs: 2_000, durationMs: 20 }), null);
  assert.equal(detector.pushFrame({ rms: 0, atMs: 2_020, durationMs: 20 }), null);
  assert.equal(committed.length, 1);
});

test("short noise spikes and threshold jitter do not start a turn", () => {
  const detector = createVoiceTurnDetector();
  const events = feed(detector, [
    ...Array(20).fill(0.006),
    0.031, 0.028, 0.008,
    0.029, 0.01,
    0.027, 0.026, 0.012,
    ...Array(60).fill(0.005)
  ]);

  assert.deepEqual(events, []);
  assert.equal(detector.getState().speechStarted, false);
  assert.equal(detector.getState().committed, false);
});

test("a long active utterance commits at the 25 second maximum", () => {
  const detector = createVoiceTurnDetector();
  const events = feed(detector, Array(1_300).fill(0.04));
  const commit = events.find((event) => event.type === "commit");

  assert.equal(commit?.reason, "maximum_turn");
  assert.ok(commit.speechDurationMs >= 25_000);
  assert.equal(events.filter((event) => event.type === "commit").length, 1);
});

test("duplicate and late frames cannot produce a second commit", () => {
  const detector = createVoiceTurnDetector({
    minimumSpeechMs: 40,
    trailingSilenceMs: 60
  });
  const events = feed(detector, [0.05, 0.05, 0, 0, 0, 0]);
  assert.equal(events.filter((event) => event.type === "commit").length, 1);

  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      detector.pushFrame({ rms: index % 2 ? 0.05 : 0, atMs: 20, durationMs: 20 }),
      null
    );
  }

  detector.reset();
  assert.equal(detector.getState().committed, false);
  assert.equal(
    feed(detector, [0.05, 0.05, 0, 0, 0, 0]).filter((event) => event.type === "commit").length,
    1
  );
});

test("Float32 PCM input derives RMS and duration from sample rate", () => {
  const detector = createVoiceTurnDetector({
    sampleRate: 16_000,
    minimumSpeechMs: 40,
    trailingSilenceMs: 60
  });
  const speech = new Float32Array(320).fill(0.05);
  const silence = new Float32Array(320);

  assert.ok(Math.abs(calculatePcmRms(speech) - 0.05) < 1e-6);
  assert.equal(detector.pushFrame(speech, 0), null);
  assert.equal(detector.pushFrame(speech, 20)?.type, "speech_start");
  assert.equal(detector.pushFrame(silence, 40), null);
  assert.equal(detector.pushFrame(silence, 60), null);
  assert.equal(detector.pushFrame(silence, 80)?.reason, "trailing_silence");
});
