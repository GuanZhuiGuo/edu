import assert from "node:assert/strict";
import test from "node:test";
import {
  TextSpeechStreamError,
  consumeTextSpeechNdjson
} from "../public/volcengine-text-speech-client.js";

function streamResponse(events, { status = 200, contentType = "application/x-ndjson" } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
      controller.close();
    }
  });
  return new Response(body, {
    status,
    headers: { "content-type": contentType }
  });
}

test("consumes Volcengine PCM speech events in order", async () => {
  const received = [];
  const result = await consumeTextSpeechNdjson(streamResponse([
    { type: "tts.audio.started", provider: "volcengine" },
    { type: "tts.audio.delta", delta: "AQI=", sample_rate: 24_000 },
    { type: "tts.audio.done" },
    { type: "tts.done" }
  ]), {
    onStarted: () => received.push("started"),
    onAudio: (event) => received.push(`audio:${event.delta}`),
    onAudioDone: () => received.push("audio.done")
  });

  assert.deepEqual(received, ["started", "audio:AQI=", "audio.done"]);
  assert.deepEqual(result, { completed: true, audioChunks: 1 });
});

test("does not accept a stream without audio", async () => {
  await assert.rejects(
    consumeTextSpeechNdjson(streamResponse([{ type: "tts.done" }])),
    (error) => error instanceof TextSpeechStreamError
      && error.code === "text_speech_stream_incomplete"
  );
});

test("surfaces a non-stream API error", async () => {
  const response = new Response(JSON.stringify({
    error: "tts_not_configured",
    message: "火山语音未配置"
  }), {
    status: 503,
    headers: { "content-type": "application/json" }
  });

  await assert.rejects(
    consumeTextSpeechNdjson(response),
    (error) => error instanceof TextSpeechStreamError
      && error.code === "tts_not_configured"
      && error.message === "火山语音未配置"
  );
});
