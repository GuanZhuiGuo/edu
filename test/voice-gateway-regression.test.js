import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server.js", import.meta.url), "utf8");

function methodBody(name) {
  const signature = `\n  ${name}(`;
  const start = source.indexOf(signature, source.indexOf("class DoubaoBridge"));
  assert.notEqual(start, -1, `missing DoubaoBridge.${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
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
  assert.fail(`unterminated DoubaoBridge.${name}`);
}

const handleRemoteMessage = Function(
  "safeJson",
  "send",
  `return function handleRemoteMessage(raw) {${methodBody("handleRemoteMessage")}}`
)(
  (raw) => {
    try {
      return JSON.parse(raw.toString());
    } catch {
      return null;
    }
  },
  (client, payload) => client.send(JSON.stringify(payload))
);

function createClient() {
  const messages = [];
  return {
    messages,
    socket: {
      readyState: 1,
      send(raw) {
        messages.push(JSON.parse(raw));
      }
    }
  };
}

function createBridge(client) {
  return {
    client,
    config: { industry: "general" },
    lastTranscript: "",
    processedVoiceItems: new Set(),
    handleRemoteMessage
  };
}

test("completed ASR prefers transcript and keeps text only as a compatibility fallback", () => {
  const client = createClient();
  const bridge = createBridge(client.socket);

  bridge.handleRemoteMessage(JSON.stringify({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item_asr_primary",
    transcript: "规范 transcript 内容",
    text: "旧 text 内容"
  }));

  assert.equal(bridge.lastTranscript, "规范 transcript 内容");
  assert.equal(
    client.messages.find((message) => message.type === "voice.transcript.completed")?.transcript,
    "规范 transcript 内容"
  );

  bridge.handleRemoteMessage(JSON.stringify({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "item_asr_legacy",
    text: "仅有旧字段时仍可识别"
  }));
  assert.equal(bridge.lastTranscript, "仅有旧字段时仍可识别");
});

test("audio Base64 is forwarded once through voice.audio.delta, not duplicated in doubao.event", () => {
  const client = createClient();
  const bridge = createBridge(client.socket);
  const base64 = "A".repeat(32_000);

  bridge.handleRemoteMessage(JSON.stringify({
    type: "response.output_audio.delta",
    response_id: "response_audio_once",
    delta: base64
  }));

  assert.deepEqual(client.messages.map((message) => message.type), ["voice.audio.delta"]);
  assert.equal(client.messages[0].delta, base64);
});

test("non-audio vendor events remain available as raw diagnostics", () => {
  const client = createClient();
  const bridge = createBridge(client.socket);

  bridge.handleRemoteMessage(JSON.stringify({
    type: "session.updated",
    event_id: "diagnostic_event",
    session: { id: "session_diagnostic" }
  }));

  const raw = client.messages.find((message) => message.type === "doubao.event");
  assert.equal(raw?.event?.event_id, "diagnostic_event");
  assert.ok(client.messages.some((message) => message.type === "voice.session.updated"));
});
