import test from "node:test";
import assert from "node:assert/strict";

import {
  DuplexSessionAdapter,
  renderVoiceProjectionSpeechText,
  serializeVoiceProjectionForRealtime
} from "../duplex-session-adapter.js";

function projection(overrides = {}) {
  return {
    projection_version: "1.0",
    session_id: "lesson_voice_test",
    turn_id: "turn_voice_test",
    turn_sequence: 1,
    package_id: "package_voice_test",
    grounding_mode: "retrieved",
    response_directive: "explain",
    answer_brief: {
      direct_answer: "三角形面积等于底乘高除以二",
      must_include: [{ text: "先确认底和对应的高" }],
      exact_values: [{ spoken_text: "公式是 S 等于二分之一 a h" }],
      next_move: "我们代入题目中的数值试试看"
    },
    ...overrides
  };
}

test("trusted projection is compiled to learner-facing speech and reused as subtitle fallback", () => {
  const vendorMessages = [];
  const clientMessages = [];
  const adapter = new DuplexSessionAdapter({
    sessionId: "lesson_voice_test",
    sendVendor(payload) {
      vendorMessages.push(payload);
      return true;
    },
    sendClient(payload) {
      clientMessages.push(payload);
    }
  });

  const receipt = adapter.injectVoiceProjection(projection(), {
    eventId: "voice_projection_test"
  });

  assert.equal(receipt.accepted, true);
  assert.equal(vendorMessages.length, 1);
  assert.equal(vendorMessages[0].type, "speech_text_buffer.commit");
  assert.match(vendorMessages[0].text, /三角形面积等于底乘高除以二/u);
  assert.match(vendorMessages[0].text, /先确认底和对应的高/u);
  assert.doesNotMatch(vendorMessages[0].text, /projection_version|VoiceProjection|package_voice_test|\{/u);

  const fallback = clientMessages.find((message) => message.type === "voice.text.fallback");
  assert.ok(fallback);
  assert.equal(fallback.text, vendorMessages[0].text);
  assert.equal(fallback.package_id, "package_voice_test");
});

test("welcome projection produces the exact natural welcome subtitle instead of protocol JSON", () => {
  const welcome = projection({
    grounding_mode: "state_authoritative",
    answer_brief: null,
    authoritative_result: {
      status: "welcome",
      message: "你好，我是AI教师。今天我们一起学习函数。"
    }
  });

  const speech = renderVoiceProjectionSpeechText(welcome);
  assert.equal(speech, "你好，我是AI教师。今天我们一起学习函数。");
  assert.equal(
    serializeVoiceProjectionForRealtime({ voice_projection: welcome }),
    speech
  );
  assert.doesNotMatch(speech, /TRUSTED_VOICE_PROJECTION|event_version|session_id/u);
});

test("speech projection removes control bytes and de-duplicates repeated claims", () => {
  const speech = renderVoiceProjectionSpeechText(projection({
    answer_brief: {
      direct_answer: "先画图\u0000再计算",
      must_include: [{ text: "先画图再计算" }, { text: "标出对应的高" }],
      exact_values: [],
      next_move: "标出对应的高"
    }
  }));

  assert.equal(speech.includes("\u0000"), false);
  assert.equal((speech.replace(/\s/gu, "").match(/先画图再计算/gu) || []).length, 1);
  assert.equal((speech.match(/标出对应的高/gu) || []).length, 1);
});

test("canceling a projected response clears pending and active response state", () => {
  const adapter = new DuplexSessionAdapter({ sendVendor: () => true });
  adapter.injectVoiceProjection(projection(), { eventId: "interrupt_me" });
  adapter.linkResponseStarted("response_voice_test");

  assert.equal(adapter.activeResponseId, "response_voice_test");
  adapter.cancelPending("user_interrupted");
  assert.equal(adapter.activeResponseId, "");
  assert.deepEqual(adapter.pending, []);
});
