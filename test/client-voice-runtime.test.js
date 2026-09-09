import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/client.js", import.meta.url), "utf8");

function functionBody(name) {
  const signature = `function ${name}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  assert.fail(`unterminated ${signature}`);
}

test("subtitle audio timeline receives response id, start and end exactly once", () => {
  const playbackBody = functionBody("playPcm16Base64");
  const calls = [...playbackBody.matchAll(/registerAssistantSubtitleAudioChunk\s*\(([^)]*)\)/gu)];
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0][1].split(",").map((value) => value.trim()),
    ["responseId", "startAt", "playback.nextTime"]
  );
});

test("voice startup connects upstream while microphone permission is pending", () => {
  const body = functionBody("startVoiceSession");
  const connectAt = body.indexOf("const connectionReady = connect()");
  const jointWaitAt = body.indexOf("await Promise.all([microphoneReady, connectionReady])");

  assert.notEqual(connectAt, -1);
  assert.notEqual(jointWaitAt, -1);
  assert.ok(connectAt < jointWaitAt, "connect must start before waiting for microphone readiness");
  assert.doesNotMatch(
    body.slice(0, connectAt),
    /await\s+(?:mediaRequest|microphoneReady)/u,
    "microphone permission must not serialize the upstream connection"
  );
});

test("streaming user transcript schedules one subtitle update per vendor delta", () => {
  const start = source.indexOf('case "voice.transcript.delta"');
  const end = source.indexOf('case "voice.transcript.completed"', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const branch = source.slice(start, end);
  assert.equal((branch.match(/queueVoiceSubtitle\s*\(/gu) || []).length, 1);
});

test("manual interruption restores continuous listening without waiting for vendor cancel ack", () => {
  const body = functionBody("interrupt");
  assert.match(body, /stopPlayback\(\)/u);
  assert.match(body, /response\.cancel/u);
  assert.match(body, /voiceTurnCommitted\s*=\s*false/u);
  assert.match(body, /resumeContinuousVoice\(\)/u);
});

test("browser playback completion, rather than audio.done alone, drains the queue and resumes listening", () => {
  const playbackBody = functionBody("playPcm16Base64");
  const drainedBody = functionBody("handlePlaybackQueueDrained");
  const stopBody = functionBody("stopPlayback");

  assert.match(playbackBody, /wasStopped/u);
  assert.match(playbackBody, /handlePlaybackQueueDrained\(\)/u);
  assert.match(drainedBody, /updateAssistantSubtitlePlayback\(\)/u);
  assert.match(drainedBody, /resumeContinuousVoice\(\)/u);
  assert.match(stopBody, /stoppedSources\.add\(source\)/u);
  assert.match(source, /case "voice\.audio\.done":[\s\S]{0,300}isPlaying\(\)/u);
});

test("committed turns keep the duplex audio channel alive until a terminal response", () => {
  const commitBody = functionBody("commitDetectedVoiceTurn");
  const manualCommitBody = functionBody("pauseMicrophoneKeepAlive");
  const forceCommitBody = functionBody("forceCommit");
  const interruptBody = functionBody("interrupt");

  assert.match(commitBody, /send\(\{ type: "audio\.commit" \}\);[\s\S]*startKeepAlive\(\)/u);
  assert.match(manualCommitBody, /send\(\{ type: "audio\.commit" \}\);[\s\S]*startKeepAlive\(\)/u);
  assert.match(forceCommitBody, /send\(\{ type: "audio\.commit" \}\);[\s\S]*startKeepAlive\(\)/u);
  assert.match(interruptBody, /stopKeepAlive\(\)[\s\S]*resumeContinuousVoice\(\)/u);
  assert.match(source, /case "voice\.transcript\.failed":[\s\S]{0,500}stopKeepAlive\(\)[\s\S]{0,500}resumeContinuousVoice\(\)/u);
  assert.match(source, /case "voice\.response\.canceled":[\s\S]{0,300}stopKeepAlive\(\)[\s\S]{0,300}resumeContinuousVoice\(\)/u);
});

test("text reply playback uses an isolated Volcengine stream instead of browser speech synthesis", () => {
  const toggleBody = functionBody("toggleTeacherTts");
  const stopBody = functionBody("stopTextTts");
  const queueBody = functionBody("playTextTtsPcm16Base64");

  assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance/u);
  assert.match(toggleBody, /fetch\("\/api\/voice\/tts\/stream"/u);
  assert.match(toggleBody, /consumeTextSpeechNdjson/u);
  assert.match(toggleBody, /voice:\s*els\.voice/u);
  assert.match(toggleBody, /speed:\s*audioRatioToProtocolValue/u);
  assert.match(stopBody, /controller\?\.abort\(\)/u);
  assert.match(stopBody, /textSpeechState\.sources/u);
  assert.match(queueBody, /textSpeechState\.sources\.add\(source\)/u);
  assert.doesNotMatch(queueBody, /registerAssistantSubtitleAudioChunk/u);
});
