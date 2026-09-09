import { createId } from "./contracts.js";

const EVENT_VERSION = "1.0";
const MAX_RECEIPTS = 200;

/**
 * Business-facing adapter for injecting a trusted VoiceProjection into the
 * active Doubao realtime session. Vendor protocol details stay in this file.
 *
 * `speech_text_buffer.commit` is a direct speech/TTS primitive. It must receive
 * learner-facing speech only; sending the structured VoiceProjection here
 * makes the upstream voice read JSON and internal control fields aloud.
 * The next vendor `response.output_audio.started` event closes the correlation
 * loop with the real duplex response id.
 */
export class DuplexSessionAdapter {
  constructor({ sessionId, sendVendor, sendClient, onResponseLinked } = {}) {
    this.sessionId = String(sessionId || "session_default");
    this.sendVendor = typeof sendVendor === "function" ? sendVendor : () => false;
    this.sendClient = typeof sendClient === "function" ? sendClient : () => {};
    this.onResponseLinked =
      typeof onResponseLinked === "function" ? onResponseLinked : () => {};
    this.receipts = new Map();
    this.pending = [];
    this.activeResponseId = "";
  }

  setSessionId(sessionId) {
    this.sessionId = String(sessionId || this.sessionId || "session_default");
  }

  injectVoiceProjection(voiceProjection, options = {}) {
    const appEvent = createVoiceProjectionEvent(
      voiceProjection,
      options.eventId,
      options.responseMode
    );
    const cached = this.receipts.get(appEvent.event_id);
    if (cached) return structuredClone(cached);

    const vendorEventId = createId("vendor_voice_projection");
    const pendingResponseId = `pending:${appEvent.event_id}`;
    const speechText = renderVoiceProjectionSpeechText(appEvent.voice_projection);
    const vendorPayload = {
      event_id: vendorEventId,
      type: "speech_text_buffer.commit",
      text: speechText
    };
    const accepted = this.sendVendor(vendorPayload) !== false;
    const receipt = {
      accepted,
      event_id: appEvent.event_id,
      vendor_event_id: vendorEventId,
      duplex_response_id: accepted ? pendingResponseId : "",
      status: accepted ? "accepted_pending_response" : "rejected",
      session_id: appEvent.session_id,
      turn_id: appEvent.turn_id,
      turn_sequence: appEvent.turn_sequence,
      package_id: appEvent.package_id,
      injected_at: new Date().toISOString()
    };

    this.rememberReceipt(receipt);
    if (accepted) this.pending.push(appEvent.event_id);
    this.emitSubtitleFallback(appEvent, speechText);
    this.sendClient({
      type: "education.voice_projection.receipt",
      receipt: structuredClone(receipt)
    });
    return structuredClone(receipt);
  }

  /**
   * A VoiceProjection returned as a function result is already in the vendor
   * conversation, so it must not be injected again. We only register it for
   * response-id correlation.
   */
  trackToolProjection(voiceProjection, { callId = "", vendorEventId = "" } = {}) {
    const appEvent = createVoiceProjectionEvent(
      voiceProjection,
      callId ? `tool:${callId}` : undefined
    );
    const cached = this.receipts.get(appEvent.event_id);
    if (cached) return structuredClone(cached);

    const receipt = {
      accepted: true,
      event_id: appEvent.event_id,
      vendor_event_id: String(vendorEventId || callId || createId("vendor_tool_result")),
      duplex_response_id: `pending:${appEvent.event_id}`,
      status: "accepted_pending_response",
      session_id: appEvent.session_id,
      turn_id: appEvent.turn_id,
      turn_sequence: appEvent.turn_sequence,
      package_id: appEvent.package_id,
      injected_at: new Date().toISOString()
    };
    this.rememberReceipt(receipt);
    this.pending.push(appEvent.event_id);
    this.emitSubtitleFallback(
      appEvent,
      renderVoiceProjectionSpeechText(appEvent.voice_projection)
    );
    return structuredClone(receipt);
  }

  linkResponseStarted(responseId) {
    const duplexResponseId = String(responseId || "");
    if (!duplexResponseId) return null;
    this.activeResponseId = duplexResponseId;

    while (this.pending.length) {
      const eventId = this.pending.shift();
      const current = this.receipts.get(eventId);
      if (!current || current.status !== "accepted_pending_response") continue;
      const linked = {
        ...current,
        duplex_response_id: duplexResponseId,
        status: "response_started",
        response_started_at: new Date().toISOString()
      };
      this.receipts.set(eventId, linked);
      this.onResponseLinked(structuredClone(linked));
      this.sendClient({
        type: "education.voice_projection.receipt",
        receipt: structuredClone(linked)
      });
      return structuredClone(linked);
    }
    return null;
  }

  linkResponseDone(responseId) {
    const duplexResponseId = String(responseId || this.activeResponseId || "");
    if (!duplexResponseId) return null;
    let matched = null;
    for (const [eventId, current] of this.receipts) {
      if (
        current.duplex_response_id !== duplexResponseId ||
        current.status === "response_done" ||
        current.status === "canceled"
      ) {
        continue;
      }
      const completed = {
        ...current,
        status: "response_done",
        response_done_at: new Date().toISOString()
      };
      this.receipts.set(eventId, completed);
      matched = completed;
    }
    if (this.activeResponseId === duplexResponseId) this.activeResponseId = "";
    return matched ? structuredClone(matched) : null;
  }

  cancelPending(reason = "user_interrupted") {
    const canceledAt = new Date().toISOString();
    const canceled = [];
    for (const eventId of this.pending.splice(0)) {
      const current = this.receipts.get(eventId);
      if (!current) continue;
      const receipt = {
        ...current,
        status: "canceled",
        cancel_reason: String(reason || "canceled"),
        canceled_at: canceledAt
      };
      this.receipts.set(eventId, receipt);
      canceled.push(structuredClone(receipt));
    }
    this.activeResponseId = "";
    return canceled;
  }

  getReceipt(eventId) {
    const receipt = this.receipts.get(String(eventId || ""));
    return receipt ? structuredClone(receipt) : null;
  }

  rememberReceipt(receipt) {
    this.receipts.set(receipt.event_id, receipt);
    while (this.receipts.size > MAX_RECEIPTS) {
      this.receipts.delete(this.receipts.keys().next().value);
    }
  }

  emitSubtitleFallback(appEvent, text) {
    const subtitle = String(text || "").trim();
    if (!subtitle) return;
    this.sendClient({
      type: "voice.text.fallback",
      turn_id: appEvent.turn_id,
      turn_sequence: appEvent.turn_sequence,
      package_id: appEvent.package_id,
      text: subtitle
    });
  }
}

export function createVoiceProjectionEvent(
  voiceProjection,
  eventId,
  responseMode = "immediate_voice"
) {
  const projection = structuredClone(voiceProjection || {});
  return {
    event_version: EVENT_VERSION,
    event_id: String(eventId || createId("inject")),
    session_id: String(projection.session_id || "session_default"),
    turn_id: String(projection.turn_id || ""),
    turn_sequence: Number.isInteger(projection.turn_sequence)
      ? projection.turn_sequence
      : 0,
    package_id: String(projection.package_id || ""),
    kind: "voice_projection",
    response_mode: responseMode === "immediate_voice" ? responseMode : "immediate_voice",
    voice_projection: projection
  };
}

export function serializeVoiceProjectionForRealtime(appEvent) {
  return renderVoiceProjectionSpeechText(appEvent?.voice_projection);
}

export function renderVoiceProjectionSpeechText(voiceProjection) {
  const projection = voiceProjection && typeof voiceProjection === "object"
    ? voiceProjection
    : {};
  const mode = String(projection.grounding_mode || "");
  if (mode === "retrieved" && projection.answer_brief) {
    const brief = projection.answer_brief;
    const parts = [];
    appendUniqueSpeech(parts, brief.direct_answer);
    for (const claim of Array.isArray(brief.must_include) ? brief.must_include : []) {
      appendUniqueSpeech(parts, claim?.text);
    }
    for (const value of Array.isArray(brief.exact_values) ? brief.exact_values : []) {
      appendUniqueSpeech(parts, value?.spoken_text);
    }
    appendUniqueSpeech(parts, brief.next_move);
    return finalizeSpeech(parts.join("。"));
  }

  if (mode === "state_authoritative") {
    const result = projection.authoritative_result || {};
    if (result.status === "welcome") {
      return finalizeSpeech(result.message || "你好，我是AI教师。今天想学什么？");
    }
    if (result.status === "graded" || result.status === "already_answered") {
      const parts = [
        result.is_correct
          ? "回答正确"
          : `这道题还不对${result.correct_option ? `，正确答案是 ${result.correct_option}` : ""}`
      ];
      appendUniqueSpeech(parts, result.explanation);
      return finalizeSpeech(parts.join("。"));
    }
    return finalizeSpeech(
      result.message || result.feedback || result.explanation || "这一步已经完成。"
    );
  }

  if (mode === "clarify") {
    return finalizeSpeech(
      projection.clarification?.prompt || "请再说具体一点，我来继续帮你。"
    );
  }
  if (mode === "tool_error") {
    return finalizeSpeech(
      projection.public_error?.user_message || "教学服务暂时不可用，请稍后重试。"
    );
  }
  if (mode === "model_prior") {
    return "这个问题不在当前已加载的课程资料中。我可以继续为你介绍这门课里的相关知识点。";
  }
  return "我已经收到你的问题，请稍等。";
}

function appendUniqueSpeech(parts, value) {
  const text = cleanSpeech(value);
  if (!text) return;
  const compact = normalizeForComparison(text);
  if (parts.some((part) => {
    const existing = normalizeForComparison(part);
    return existing.includes(compact) || compact.includes(existing);
  })) {
    return;
  }
  parts.push(text);
}

function finalizeSpeech(value) {
  const text = cleanSpeech(value)
    .replace(/[。！？,.!?]+(?=[。！？,.!?])/gu, "")
    .slice(0, 6_000);
  if (!text) return "我已经收到你的问题，请稍等。";
  return /[。！？.!?]$/u.test(text) ? text : `${text}。`;
}

function cleanSpeech(value) {
  return String(value || "")
    .replace(/[\x00-\x1F\x7F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeForComparison(value) {
  return cleanSpeech(value)
    .toLowerCase()
    .replace(/[\s。！？、，；：,.!?;:()[\]{}]/gu, "");
}
