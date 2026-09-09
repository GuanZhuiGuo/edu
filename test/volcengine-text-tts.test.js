import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";

import {
  VOLCENGINE_TEXT_TTS_VOICES,
  VolcengineTextTtsError,
  buildVolcengineTextTtsSessionPayload,
  createVolcengineTextTtsHttpHandler,
  createVolcengineTextTtsService,
} from "../volcengine-text-tts.js";

const TEST_ENV = Object.freeze({
  DOUBAO_API_KEY: "test-only-key",
  DOUBAO_TEXT_TTS_ENDPOINT: "wss://tts.example.test/duplex",
  DOUBAO_TEXT_TTS_MODEL: "tts-test-model",
});

function createFakeWebSocketClass({ script = "manual" } = {}) {
  return class FakeWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    static instances = [];

    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.readyState = this.constructor.CONNECTING;
      this.sent = [];
      this.closeCalls = 0;
      this.constructor.instances.push(this);
      if (script !== "manual") queueMicrotask(() => this.open());
    }

    open() {
      if (this.readyState !== this.constructor.CONNECTING) return;
      this.readyState = this.constructor.OPEN;
      this.emit("open");
    }

    send(raw) {
      const message = JSON.parse(String(raw));
      this.sent.push(message);
      if (script === "success" && message.type === "session.create") {
        queueMicrotask(() => this.receive({ type: "session.created", session: { id: "tts-session" } }));
      }
      if (script === "success" && message.type === "speech_text_buffer.commit") {
        queueMicrotask(() => {
          this.receive({ type: "response.output_audio.started", response_id: "response-1" });
          this.receive({ type: "response.output_audio.delta", response_id: "response-1", delta: "AAECAw==" });
          this.receive({ type: "response.output_audio.done", response_id: "response-1" });
          this.receive({ type: "response.done", response_id: "response-1" });
        });
      }
      if (script === "upstream-error" && message.type === "session.create") {
        queueMicrotask(() => this.receive({ type: "session.created" }));
      }
      if (script === "upstream-error" && message.type === "speech_text_buffer.commit") {
        queueMicrotask(() => this.receive({
          type: "error",
          error: { message: "private upstream detail must not escape" },
        }));
      }
    }

    receive(event) {
      if (this.readyState !== this.constructor.OPEN) return;
      this.emit("message", Buffer.from(JSON.stringify(event)));
    }

    close() {
      this.closeCalls += 1;
      if (this.readyState === this.constructor.CLOSED) return;
      const wasConnecting = this.readyState === this.constructor.CONNECTING;
      this.readyState = this.constructor.CLOSED;
      queueMicrotask(() => {
        if (script === "connecting-close-error" && wasConnecting) {
          this.emit("error", new Error("WebSocket was closed before the connection was established"));
        }
        this.emit("close", 1000, Buffer.alloc(0));
      });
    }

    terminate() {
      this.close();
    }
  };
}

function request(overrides = {}) {
  return {
    playback_id: "playback-test-1",
    text: "三角形面积等于底乘高除以二。",
    voice: VOLCENGINE_TEXT_TTS_VOICES[0],
    speed: 0,
    loudness: 0,
    ...overrides,
  };
}

test("isolated short session maps vendor PCM events to ordered public TTS events", async () => {
  const FakeWebSocket = createFakeWebSocketClass();
  const service = createVolcengineTextTtsService({
    env: TEST_ENV,
    WebSocketImpl: FakeWebSocket,
    requestTimeoutMs: 5_000,
  });
  const events = [];
  const synthesis = service.synthesize(request(), {
    onEvent(event) {
      events.push(event);
    },
  });
  const socket = FakeWebSocket.instances[0];

  socket.open();
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].type, "session.create");
  assert.equal(socket.sent[0].session.audio.output.voice, VOLCENGINE_TEXT_TTS_VOICES[0]);
  assert.equal(socket.sent[0].session.audio.output.speed, 0);
  assert.equal(socket.sent[0].session.audio.output.loudness, 0);
  assert.equal(socket.options.headers["X-Api-Key"], TEST_ENV.DOUBAO_API_KEY);

  socket.receive({ type: "session.created" });
  assert.equal(socket.sent.filter((message) => message.type === "speech_text_buffer.commit").length, 1);
  assert.equal(socket.sent.at(-1).text, request().text);
  socket.receive({ type: "session.created" });
  assert.equal(socket.sent.filter((message) => message.type === "speech_text_buffer.commit").length, 1);

  socket.receive({ type: "response.output_audio.started", response_id: "response-1" });
  socket.receive({ type: "response.output_audio.delta", response_id: "response-1", delta: "AAECAw==" });
  socket.receive({ type: "response.output_audio.done", response_id: "response-1" });
  socket.receive({ type: "response.done", response_id: "response-1" });
  await synthesis;

  assert.deepEqual(events.map((event) => event.type), [
    "tts.audio.started",
    "tts.audio.delta",
    "tts.audio.done",
    "tts.done",
  ]);
  assert.ok(events.every((event) => event.playback_id === "playback-test-1"));
  assert.equal(events[1].delta, "AAECAw==");
  assert.equal(events[1].sample_rate, 24_000);
  assert.equal(events[1].format, "pcm_s16le");
  assert.equal(service.activeCount, 0);
  assert.equal(socket.closeCalls, 1);
});

test("response.done without a valid audio delta rejects as retryable tts_no_audio", async () => {
  const FakeWebSocket = createFakeWebSocketClass();
  const service = createVolcengineTextTtsService({
    env: TEST_ENV,
    WebSocketImpl: FakeWebSocket,
    requestTimeoutMs: 5_000,
  });
  const events = [];
  const synthesis = service.synthesize(request({ playback_id: "no-audio-test" }), {
    onEvent(event) {
      events.push(event);
    },
  });
  const socket = FakeWebSocket.instances[0];

  socket.open();
  socket.receive({ type: "session.created" });
  socket.receive({ type: "response.output_audio.delta", delta: "not-base64" });
  socket.receive({ type: "response.output_audio.done" });
  socket.receive({ type: "response.done" });

  await assert.rejects(
    synthesis,
    (error) => error instanceof VolcengineTextTtsError
      && error.code === "tts_no_audio"
      && error.retryable === true,
  );
  assert.deepEqual(events, []);
  assert.equal(service.activeCount, 0);
  assert.equal(socket.closeCalls, 1);
});

test("duplicate response.done emits public terminal events exactly once", async () => {
  const FakeWebSocket = createFakeWebSocketClass();
  const service = createVolcengineTextTtsService({
    env: TEST_ENV,
    WebSocketImpl: FakeWebSocket,
    requestTimeoutMs: 5_000,
  });
  const events = [];
  const synthesis = service.synthesize(request({ playback_id: "duplicate-terminal-test" }), {
    async onEvent(event) {
      events.push(event);
      await Promise.resolve();
    },
  });
  const socket = FakeWebSocket.instances[0];

  socket.open();
  socket.receive({ type: "session.created" });
  socket.receive({ type: "response.output_audio.delta", delta: "AAECAw==" });
  socket.receive({ type: "response.output_audio.done" });
  socket.receive({ type: "response.done" });
  socket.receive({ type: "response.done" });
  await synthesis;

  assert.deepEqual(events.map((event) => event.type), [
    "tts.audio.started",
    "tts.audio.delta",
    "tts.audio.done",
    "tts.done",
  ]);
  assert.equal(events.filter((event) => event.type === "tts.audio.done").length, 1);
  assert.equal(events.filter((event) => event.type === "tts.done").length, 1);
  assert.equal(service.activeCount, 0);
  assert.equal(socket.closeCalls, 1);
});

test("config summary reports the real provider without exposing its credential", () => {
  const service = createVolcengineTextTtsService({ env: TEST_ENV });
  const summary = service.configSummary();
  assert.equal(summary.provider, "volcengine_duplex_short_session");
  assert.equal(summary.transport, "server_ndjson_stream");
  assert.equal(summary.configured, true);
  assert.equal(summary.credential_env, "DOUBAO_API_KEY");
  assert.equal(summary.output.sample_rate, 24_000);
  assert.equal(JSON.stringify(summary).includes(TEST_ENV.DOUBAO_API_KEY), false);

  const missing = createVolcengineTextTtsService({ env: {} }).configSummary();
  assert.equal(missing.configured, false);
});

test("request validation accepts every UI voice and rejects unsafe synthesis parameters", () => {
  const service = createVolcengineTextTtsService({ env: TEST_ENV });
  for (const voice of [
    "saturn_zh_female_chengshujiejie_tob",
    "saturn_zh_female_keainvsheng_tob",
    "saturn_zh_female_nuanxinxuejie_tob",
    "saturn_zh_female_wenrouwenya_tob",
    "saturn_zh_male_cixingnansang_tob",
    "saturn_zh_male_fengfashaonian_tob",
  ]) {
    assert.equal(service.prepareRequest(request({ voice })).voice, voice);
  }
  assert.throws(
    () => service.prepareRequest(request({ voice: "unapproved-voice" })),
    (error) => error instanceof VolcengineTextTtsError && error.code === "tts_voice_invalid",
  );
  assert.throws(
    () => service.prepareRequest(request({ playback_id: "../unsafe" })),
    (error) => error.code === "tts_playback_id_invalid",
  );
  assert.throws(
    () => service.prepareRequest(request({ speed: 1.5 })),
    (error) => error.code === "tts_speed_invalid",
  );
  assert.throws(
    () => service.prepareRequest(request({ loudness: 101 })),
    (error) => error.code === "tts_loudness_invalid",
  );
});

test("AbortSignal closes only the isolated synthesis socket", async () => {
  const FakeWebSocket = createFakeWebSocketClass({ script: "connecting-close-error" });
  const service = createVolcengineTextTtsService({
    env: TEST_ENV,
    WebSocketImpl: FakeWebSocket,
    requestTimeoutMs: 5_000,
  });
  const controller = new AbortController();
  const synthesis = service.synthesize(request({ playback_id: "abort-test" }), {
    signal: controller.signal,
  });
  const socket = FakeWebSocket.instances[0];
  controller.abort();

  await assert.rejects(synthesis, (error) => error.code === "tts_aborted");
  assert.equal(socket.closeCalls, 1);
  assert.equal(service.activeCount, 0);
});

test("a stalled upstream is bounded by the per-request timeout", async () => {
  const FakeWebSocket = createFakeWebSocketClass();
  const service = createVolcengineTextTtsService({
    env: TEST_ENV,
    WebSocketImpl: FakeWebSocket,
    requestTimeoutMs: 1_000,
  });
  const startedAt = Date.now();
  await assert.rejects(
    service.synthesize(request({ playback_id: "timeout-test" })),
    (error) => error.code === "tts_timeout" && error.retryable === true,
  );
  assert.ok(Date.now() - startedAt >= 900);
  assert.equal(FakeWebSocket.instances[0].closeCalls, 1);
  assert.equal(service.activeCount, 0);
});

test("session payload is an explicit realtime text-only session with PCM 24k output", () => {
  const payload = buildVolcengineTextTtsSessionPayload(request({ loudness: 18 }), { model: "model-test" });
  assert.equal(payload.type, "session.create");
  assert.equal(payload.session.type, "realtime");
  assert.equal(payload.session.model, "model-test");
  assert.equal(payload.session.audio.input.format.rate, 16_000);
  assert.deepEqual(payload.session.audio.output.format, { type: "pcm_s16le", rate: 24_000 });
  assert.equal(payload.session.audio.output.loudness, 18);
  assert.equal("tools" in payload.session, false);
});

test("HTTP endpoint streams NDJSON and never returns the server credential", async (t) => {
  const FakeWebSocket = createFakeWebSocketClass({ script: "success" });
  const service = createVolcengineTextTtsService({
    env: TEST_ENV,
    WebSocketImpl: FakeWebSocket,
    requestTimeoutMs: 5_000,
  });
  const url = await startHttpHandler(t, service);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request({ playback_id: "http-success" })),
  });
  const body = await response.text();
  const events = body.trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/x-ndjson/u);
  assert.deepEqual(events.map((event) => event.type), [
    "tts.audio.started",
    "tts.audio.delta",
    "tts.audio.done",
    "tts.done",
  ]);
  assert.equal(body.includes(TEST_ENV.DOUBAO_API_KEY), false);
});

test("post-header upstream failures terminate with a sanitized tts.error event", async (t) => {
  const FakeWebSocket = createFakeWebSocketClass({ script: "upstream-error" });
  const service = createVolcengineTextTtsService({
    env: TEST_ENV,
    WebSocketImpl: FakeWebSocket,
    requestTimeoutMs: 5_000,
  });
  const url = await startHttpHandler(t, service);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request({ playback_id: "http-error" })),
  });
  const body = await response.text();
  const events = body.trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(response.status, 200);
  assert.deepEqual(events.map((event) => event.type), ["tts.error"]);
  assert.equal(events[0].playback_id, "http-error");
  assert.equal(events[0].code, "tts_upstream_error");
  assert.equal(events[0].message, "火山语音合成失败，请稍后重试");
  assert.equal(events[0].retryable, true);
  assert.equal("error" in events[0], false);
  assert.equal(body.includes("private upstream detail"), false);
});

test("HTTP endpoint rejects unauthorized and unconfigured requests before streaming", async (t) => {
  const FakeWebSocket = createFakeWebSocketClass();
  const configured = createVolcengineTextTtsService({
    env: TEST_ENV,
    WebSocketImpl: FakeWebSocket,
  });
  const defaultForbiddenUrl = await startHttpHandler(t, configured, {});
  const defaultForbidden = await fetch(defaultForbiddenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request()),
  });
  assert.equal(defaultForbidden.status, 403);

  const forbiddenUrl = await startHttpHandler(t, configured, { authorizeRequest: () => false });
  const forbidden = await fetch(forbiddenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request()),
  });
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.headers.get("content-type") || "", /application\/json/u);

  const throwingUrl = await startHttpHandler(t, configured, {
    authorizeRequest() {
      throw new Error("authorization unavailable");
    },
  });
  const throwing = await fetch(throwingUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request()),
  });
  assert.equal(throwing.status, 403);
  assert.equal(FakeWebSocket.instances.length, 0);

  const unavailable = createVolcengineTextTtsService({ env: {} });
  const unavailableUrl = await startHttpHandler(t, unavailable);
  const response = await fetch(unavailableUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request()),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "tts_not_configured",
    message: "火山文字播报尚未配置",
    retryable: false,
  });
});

async function startHttpHandler(t, service, options = { authorizeRequest: () => true }) {
  const handler = createVolcengineTextTtsHttpHandler({ service, ...options });
  const server = createServer(async (req, res) => {
    const handled = await handler(req, res, new URL(req.url || "/", `http://${req.headers.host}`));
    if (!handled) {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}/api/voice/tts/stream`;
}
