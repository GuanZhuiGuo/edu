import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createEducationDataService } from "../education-data-service.js";
import { createEducationDataStore } from "../education-data-store.js";
import { createHmacGradingReceiptAuthority } from "../education-mastery-engine.js";
import {
  createPiLearningHttpHandler,
  normalizeExternalRichResults,
} from "../pi-learning-http.js";

const TENANT_ID = "tenant-pi-http";
const STUDENT_ID = "student-1";
const ONTOLOGY_ID = "junior-math-moe-2022";
const ONTOLOGY_VERSION = "math-standard-test@1.0";
const KNOWLEDGE_POINT_ID = "M4-NA-FUN-02";
const SECOND_KNOWLEDGE_POINT_ID = "M4-NA-FUN-03";
const ASSESSMENT_ID = "assessment.runtime.1";
const INSTANCE_ID = "assessment_instance:runtime-1";
const NOW = "2026-08-24T12:00:00.000Z";
const HMAC_SECRET = "pi-http-test-secret-with-at-least-32-bytes-123456";

test("Pi learning HTTP uses the server scope, registers generated questions, and writes only HMAC-verified grading", async (t) => {
  const runtime = createRuntime(t);
  const runCalls = [];
  const gradeCalls = [];
  let issueCount = 0;
  const authority = createHmacGradingReceiptAuthority({
    secret: HMAC_SECRET,
    issuerId: "pi-http-grader",
    clock: () => NOW,
  });
  const observedReceipts = [];
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt(receipt, context) {
      observedReceipts.push(receipt);
      return authority.verify(receipt, context);
    },
  });
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent" }),
    async runTurn(input) {
      runCalls.push(input);
      return teachingPackage();
    },
    grade(input) {
      gradeCalls.push(input);
      assert.equal(input.assessment_instance_id, INSTANCE_ID);
      assert.equal(input.student_id, STUDENT_ID);
      assert.equal(input.session_id, "session-1");
      return {
        verified: true,
        receipt_id: "grading:runtime-1",
        assessment_instance_id: INSTANCE_ID,
        assessment_id: ASSESSMENT_ID,
        knowledge_point_ids: [KNOWLEDGE_POINT_ID],
        outcome: "correct",
        score: 1,
        max_score: 1,
        hint_usage: 0,
        submitted_at: NOW,
      };
    },
  };
  const gradingReceiptAuthority = {
    ...authority,
    issue(payload) {
      issueCount += 1;
      return authority.issue(payload);
    },
  };
  const handler = createPiLearningHttpHandler({
    agent,
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority,
    authorizeRequest: () => true,
    servicePrincipalId: "server-course-reader",
    clock: () => NOW,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      session_id: "session-1",
      course_scope_id: "course-junior-math",
      knowledge_point_id: KNOWLEDGE_POINT_ID,
      skill: "question_generator",
      message: "按当前教材给我出一道一次函数题",
      question_preferences: {
        item_type: "single_choice",
        difficulty: "medium",
        cognitive_level: "apply",
        generation_method: "条件变式",
      },
      continuation_context: {
        source_kind: "learning_event",
        source_id: "event-yesterday-1",
        source_date: "2026-08-23",
        course_id: "course-junior-math",
        course_name: "中考数学",
        title: "一次函数复习",
        summary: "已经练习了用两点确定一次函数表达式。",
        knowledge_point_ids: [KNOWLEDGE_POINT_ID],
      },
      // These browser-provided values must never replace the server scope.
      courseScope: {
        course_id: "attacker-course",
        corpus_id: "attacker-corpus",
        loaded_materials: [{ material_id: "attacker-material", title: "伪造教材" }],
        allowed_card_refs: [{ ref: "attacker-card" }],
      },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).answer, "请完成这道一次函数练习。");

    assert.equal(runCalls.length, 1);
    assert.equal(runCalls[0].courseScope.course_id, ONTOLOGY_ID);
    assert.equal(runCalls[0].courseScope.corpus_id, ONTOLOGY_ID);
    assert.equal(runCalls[0].courseScope.loaded_materials[0].material_id, "MOE-MATH-2022");
    assert.equal(runCalls[0].courseScope.loaded_materials.some((item) => item.material_id === "attacker-material"), false);
    assert.equal(runCalls[0].authority.tenant_id, TENANT_ID);
    assert.equal(runCalls[0].authority.user_id, STUDENT_ID);
    assert.equal(runCalls[0].authority.principal_id, "server-course-reader");
    assert.match(runCalls[0].message, /\[学习延续上下文\]/u);
    assert.match(runCalls[0].message, /来源日期：2026-08-23/u);
    assert.match(runCalls[0].message, /已经练习了用两点确定一次函数表达式/u);
    assert.match(runCalls[0].message, /仍须通过当前已加载教材检索确认/u);

    const registered = runtime.store.getQuestion({ tenantId: TENANT_ID, questionId: ASSESSMENT_ID });
    assert.ok(registered, "generated assessment must be registered before the response completes");
    assert.equal(registered.version, "1.0");
    assert.equal(registered.knowledge_point_mappings[0].knowledge_point_id, KNOWLEDGE_POINT_ID);
    assert.equal(runtime.store.getQuestionSolution({ tenantId: TENANT_ID, questionId: ASSESSMENT_ID }), null);

    const grade = await postJson(`${baseUrl}/api/education/agent/grade`, {
      user_id: STUDENT_ID,
      session_id: "session-1",
      assessment_instance_id: INSTANCE_ID,
      selected: "B",
      duration_ms: 8_000,
    });
    assert.equal(grade.status, 200);
    const gradeBody = await grade.json();
    assert.equal(gradeBody.correct, true);
    assert.equal(gradeBody.mastery_updated, true);
    assert.equal(issueCount, 1);
    assert.equal(gradeCalls.length, 1);
    assert.equal(observedReceipts.length, 1);
    assert.match(observedReceipts[0].signature, /^hmac-sha256:/u);
    assert.equal(observedReceipts[0].tenant_id, TENANT_ID);
    assert.equal(observedReceipts[0].student_id, STUDENT_ID);
    assert.equal(observedReceipts[0].question_id, ASSESSMENT_ID);
    assert.equal(observedReceipts[0].evidence_source, "server_graded_question");

    const mastery = dataService.getMastery({
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      ontologyId: ONTOLOGY_ID,
      ontologyVersion: ONTOLOGY_VERSION,
      limit: 20,
    });
    const point = mastery.items.find((item) => item.knowledge_point_id === KNOWLEDGE_POINT_ID);
    assert.equal(point.mastery_probability, 1);
    assert.equal(point.evidence_count, 1);
  });
});

test("ordinary Pi learning proposals are recorded per knowledge point but never applied to mastery", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({ secret: HMAC_SECRET, clock: () => NOW });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent" }),
    async runTurn() {
      return {
        ...teachingPackage(),
        request_id: "pi-request:ordinary-learning",
        skill: "knowledge_tutor",
        answer: "一次函数的图象与变化规律需要结合来看。",
        knowledge_point_ids: [KNOWLEDGE_POINT_ID, SECOND_KNOWLEDGE_POINT_ID],
        question_drafts: [],
        mastery_evidence_proposals: [
          {
            proposal_id: "interaction-primary",
            knowledge_point_id: KNOWLEDGE_POINT_ID,
            evidence_mode: "inferred",
            signal_type: "learning_interaction",
            status: "pending_review",
            strength: "weak",
            confidence: 0.8,
            basis: "student asked for an explanation",
          },
          {
            proposal_id: "interaction-supporting",
            knowledge_point_id: SECOND_KNOWLEDGE_POINT_ID,
            evidence_mode: "inferred",
            signal_type: "learning_interaction",
            status: "pending_review",
            strength: "weak",
            confidence: 0.7,
            basis: "same learning turn referenced a related knowledge point",
          },
        ],
      };
    },
    grade() {
      throw new Error("grade is not used in this test");
    },
  };
  const handler = createPiLearningHttpHandler({
    agent,
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
    servicePrincipalId: "server-course-reader",
    clock: () => NOW,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      session_id: "session-ordinary-learning",
      course_scope_id: "course-junior-math",
      skill: "knowledge_tutor",
      message: "一次函数的图象与变化规律有什么关系？",
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).answer, "一次函数的图象与变化规律需要结合来看。");

    const mastery = dataService.getMastery({
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      ontologyId: ONTOLOGY_ID,
      ontologyVersion: ONTOLOGY_VERSION,
      limit: 20,
    });
    const observed = mastery.items.filter((item) =>
      [KNOWLEDGE_POINT_ID, SECOND_KNOWLEDGE_POINT_ID].includes(item.knowledge_point_id));
    assert.equal(observed.length, 2);
    assert.ok(observed.every((item) => item.mastery_state === "unassessed"));
    assert.ok(observed.every((item) => item.mastery_probability === null));

    const history = dataService.getMasteryHistory({
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      ontologyId: ONTOLOGY_ID,
      ontologyVersion: ONTOLOGY_VERSION,
      limit: 20,
    });
    const proposals = history.items.filter((item) => item.source_ref === "pi-request:ordinary-learning");
    assert.equal(proposals.length, 2);
    assert.deepEqual(
      new Set(proposals.map((item) => item.knowledge_point_id)),
      new Set([KNOWLEDGE_POINT_ID, SECOND_KNOWLEDGE_POINT_ID]),
    );
    assert.ok(proposals.every((item) => item.evidence_class === "proposal"));
    assert.ok(proposals.every((item) => item.eligible_for_projection === false));
    assert.ok(proposals.every((item) => item.included_in_current_projection === false));

    const events = dataService.getLearningEvents({
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      limit: 20,
    });
    assert.equal(events.items.filter((item) =>
      item.source_type === "pi_learning_interaction"
      && item.payload.evidence_source_ref === "pi-request:ordinary-learning",
    ).length, 2);
  });
});

test("Pi learning stream flushes safe trace and forwards only allowlisted grounded deltas", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({
    secret: HMAC_SECRET,
    clock: () => NOW,
  });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  let completed = false;
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent" }),
    async runTurn(_input, { onEvent }) {
      onEvent({
        type: "trace",
        stage: "retrieval.started",
        message: "正在检索当前已加载教材",
        elapsed_ms: 5,
        prompt: "SECRET_PROMPT_MUST_NOT_LEAK",
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      onEvent({
        type: "delta",
        source: "provider_text_delta",
        delta: "UNTRUSTED_PROVIDER_TEXT_MUST_NOT_LEAK",
        elapsed_ms: 55,
      });
      onEvent({
        type: "delta",
        source: "grounded_model_stream",
        delta: "请完成这道",
        elapsed_ms: 58,
        tool_arguments: "SECRET_TOOL_ARGUMENTS_MUST_NOT_LEAK",
      });
      onEvent({
        type: "delta",
        source: "validated_teaching_package",
        delta: "一次函数练习。",
        elapsed_ms: 60,
        evidence: "SECRET_EVIDENCE_MUST_NOT_LEAK",
      });
      completed = true;
      return teachingPackage();
    },
    grade() {
      throw new Error("grade is not used in this test");
    },
  };
  const handler = createPiLearningHttpHandler({
    agent,
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
    servicePrincipalId: "server-course-reader",
    streamHeartbeatMs: 50,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, {
      user_id: STUDENT_ID,
      session_id: "session-stream",
      course_scope_id: "course-junior-math",
      knowledge_point_id: KNOWLEDGE_POINT_ID,
      skill: "question_generator",
      message: "给我出一道一次函数题",
    });
    assert.equal(response.status, 200);
    assert.equal(completed, false, "response headers must flush before the model finishes");
    const body = await response.text();
    const events = body.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events[0].type, "status");
    assert.equal(events[0].stage, "request.accepted");
    assert.ok(events.some((event) => event.type === "trace" && event.stage === "retrieval.started"));
    assert.deepEqual(
      events.filter((event) => event.type === "delta").map((event) => event.delta),
      ["请完成这道", "一次函数练习。"],
    );
    assert.deepEqual(
      events.filter((event) => event.type === "delta").map((event) => event.source),
      ["grounded_model_stream", "validated_teaching_package"],
    );
    assert.equal(events.at(-1).type, "final");
    assert.doesNotMatch(body, /SECRET_PROMPT|SECRET_EVIDENCE|SECRET_TOOL_ARGUMENTS|UNTRUSTED_PROVIDER_TEXT/u);

    const traceId = events.at(-1).trace_id;
    const traceResponse = await fetch(
      `${baseUrl}/api/education/agent/traces/${encodeURIComponent(traceId)}?user_id=${STUDENT_ID}`,
    );
    assert.equal(traceResponse.status, 200);
    const trace = await traceResponse.json();
    assert.equal(trace.trace_id, traceId);
    assert.equal(trace.status, "success");
    assert.equal(trace.summary.delta_count, 2);
    assert.ok(trace.spans.some((span) => span.name === "pi_agent_runtime"));
    assert.ok(trace.spans.some((span) => span.name === "hybrid_knowledge_retrieval"));
    assert.ok(trace.spans.some((span) => span.name === "response_stream"));
    assert.doesNotMatch(JSON.stringify(trace), /SECRET_PROMPT|SECRET_EVIDENCE|SECRET_TOOL_ARGUMENTS|UNTRUSTED_PROVIDER_TEXT/u);

    const traceList = await fetch(
      `${baseUrl}/api/education/agent/traces?user_id=${STUDENT_ID}&conversation_id=session-stream`,
    );
    assert.equal(traceList.status, 200);
    assert.equal((await traceList.json()).items[0].trace_id, traceId);
  });
});

test("knowledge tutor no-match falls back to Doubao AI Learning without leaking the local refusal", async (t) => {
  let agentCalls = 0;
  let botCalls = 0;
  let botInput = null;
  const localAnswer = "当前已加载教材中没有找到能精确回答这个问题的知识点。";
  const externalAnswer = "积分可以理解为对无穷多个微小量进行累加。";
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent", model: "test-model" }),
    async runTurn(input, { onEvent }) {
      agentCalls += 1;
      assert.equal(input.skill, "knowledge_tutor");
      onEvent({
        type: "delta",
        source: "validated_teaching_package",
        delta: localAnswer,
        elapsed_ms: 20,
      });
      return boundaryTeachingPackage("no_match", {
        skill: "knowledge_tutor",
        answer: localAnswer,
        requestId: "pi-request:curriculum-no-match",
      });
    },
    grade() { throw new Error("grade is not used in this test"); },
  };
  const educationBotClient = {
    configSummary: () => ({ configured: true, can_attempt: true, configuration_status: "verified" }),
    async *streamChatCompletion(input) {
      botCalls += 1;
      botInput = input;
      yield {
        type: "delta",
        response_id: "doubao-aixue-response-1",
        content_delta: externalAnswer,
      };
      yield { type: "metadata", references: [], search_results: [], follow_ups: [] };
      yield { type: "done" };
    },
    async submitHomeworkMark() { throw new Error("not used"); },
    async pollHomeworkMark() { throw new Error("not used"); },
  };
  const { handler, dataService } = createAgentTestHandler(t, { agent, educationBotClient });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, {
      user_id: STUDENT_ID,
      session_id: "session-curriculum-no-match",
      course_scope_id: "course-junior-math",
      skill: "knowledge_tutor",
      message: "怎么算积分？",
      online_search: { enabled: false },
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    const events = body.trim().split("\n").map((line) => JSON.parse(line));
    const deltas = events.filter((event) => event.type === "delta");
    assert.deepEqual(deltas.map((event) => event.source), ["external_web_stream"]);
    assert.deepEqual(deltas.map((event) => event.delta), [externalAnswer]);
    assert.equal(body.includes(localAnswer), false, "the buffered local refusal must be discarded");

    const final = events.at(-1);
    assert.equal(final.type, "final");
    assert.equal(final.answer, externalAnswer);
    assert.equal(final.grounding_status, "external_answered");
    assert.deepEqual(final.answer_attribution, {
      schema_version: "answer-attribution@1.0",
      provider: "doubao_aixue",
      source_label: "内容来自豆包爱学",
      fallback_reason: "curriculum_no_match",
    });
    assert.equal(final.external_grounding.provider, "doubao_aixue");
    assert.equal(final.external_grounding.source_label, "内容来自豆包爱学");
    assert.equal(final.external_grounding.fallback_reason, "curriculum_no_match");
    assert.equal(final.external_grounding.mode, "external_fallback");
    assert.equal(final.teaching_package.answer_attribution.provider, "doubao_aixue");
    assert.equal(final.teaching_package.grounding.provider, "doubao_aixue");
    assert.deepEqual(final.teaching_package.knowledge_point_ids, []);
    assert.deepEqual(final.teaching_package.cards, []);
    assert.deepEqual(final.teaching_package.mastery_evidence_proposals, []);
    assert.equal(final.ui_projection, null);
    assert.equal(agentCalls, 1);
    assert.equal(botCalls, 1);
    assert.equal(botInput.browsingMode, 2);
    assert.match(botInput.messages[0].content, /当前已加载教材未找到/u);

    assert.equal(dataService.listQuestions({ tenantId: TENANT_ID }).total, 0);
    assert.equal(dataService.getLearningEvents({
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      limit: 20,
    }).total, 0);
    const masteryHistory = dataService.getMasteryHistory({
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      ontologyId: ONTOLOGY_ID,
      ontologyVersion: ONTOLOGY_VERSION,
      limit: 20,
    });
    assert.equal(masteryHistory.total, 0);
    const mastery = dataService.getMastery({
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      ontologyId: ONTOLOGY_ID,
      ontologyVersion: ONTOLOGY_VERSION,
      limit: 20,
    });
    assert.ok(mastery.items.every((item) => item.evidence_count === 0));
    assert.ok(mastery.items.every((item) => item.mastery_probability === null));
  });
});

test("automatic Doubao AI Learning fallback is limited to tutor and photo-solver no-match", async (t) => {
  const cases = [
    { status: "answered", skill: "knowledge_tutor" },
    { status: "related_only", skill: "knowledge_tutor" },
    { status: "tool_error", skill: "knowledge_tutor" },
    { status: "no_match", skill: "question_generator" },
  ];
  let agentCalls = 0;
  let botCalls = 0;
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent", model: "test-model" }),
    async runTurn(input, { onEvent }) {
      const current = cases[agentCalls];
      assert.ok(current, "unexpected Agent call");
      assert.equal(input.skill, current.skill);
      agentCalls += 1;
      const answer = `local-${current.skill}-${current.status}`;
      onEvent({
        type: "delta",
        source: "validated_teaching_package",
        delta: answer,
        elapsed_ms: 10,
      });
      return boundaryTeachingPackage(current.status, {
        skill: current.skill,
        answer,
        requestId: `pi-request:${current.skill}-${current.status}`,
      });
    },
    grade() { throw new Error("grade is not used in this test"); },
  };
  const educationBotClient = {
    configSummary: () => ({ configured: true, can_attempt: true, configuration_status: "verified" }),
    async *streamChatCompletion() {
      botCalls += 1;
      yield { type: "delta", content_delta: "must not be called" };
      yield { type: "done" };
    },
    async submitHomeworkMark() { throw new Error("not used"); },
    async pollHomeworkMark() { throw new Error("not used"); },
  };
  const { handler } = createAgentTestHandler(t, { agent, educationBotClient });

  await withHttpServer(handler, async (baseUrl) => {
    for (const [index, current] of cases.entries()) {
      const response = await postJson(`${baseUrl}/api/agent/chat`, {
        user_id: STUDENT_ID,
        session_id: `session-fallback-boundary-${index}`,
        course_scope_id: "course-junior-math",
        skill: current.skill,
        message: `case-${index}`,
      });
      assert.equal(response.status, 200, `${current.skill}:${current.status}`);
      const payload = await response.json();
      assert.equal(payload.grounding_status, current.status);
      assert.equal(payload.answer, `local-${current.skill}-${current.status}`);
      assert.equal(payload.answer_attribution, undefined);
      assert.equal(payload.external_grounding, undefined);
      assert.equal(payload.external_fallback, null);
    }
  });
  assert.equal(agentCalls, cases.length);
  assert.equal(botCalls, 0);
});

test("Doubao AI Learning failure before its first delta restores the local no-match result", async (t) => {
  let botCalls = 0;
  const localAnswer = "当前教材没有找到能精确回答这个问题的知识点。";
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent", model: "test-model" }),
    async runTurn(_input, { onEvent }) {
      onEvent({
        type: "delta",
        source: "validated_teaching_package",
        delta: localAnswer,
        elapsed_ms: 10,
      });
      return boundaryTeachingPackage("no_match", {
        skill: "knowledge_tutor",
        answer: localAnswer,
        requestId: "pi-request:fallback-provider-failed",
      });
    },
    grade() { throw new Error("grade is not used in this test"); },
  };
  const educationBotClient = {
    configSummary: () => ({ configured: true, can_attempt: true, configuration_status: "verified" }),
    async *streamChatCompletion() {
      botCalls += 1;
      const error = new Error("provider unavailable before output");
      error.code = "volc_education_network_error";
      error.status = 502;
      throw error;
    },
    async submitHomeworkMark() { throw new Error("not used"); },
    async pollHomeworkMark() { throw new Error("not used"); },
  };
  const { handler } = createAgentTestHandler(t, { agent, educationBotClient });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, {
      user_id: STUDENT_ID,
      session_id: "session-fallback-provider-failed",
      course_scope_id: "course-junior-math",
      skill: "knowledge_tutor",
      message: "教材外的问题",
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    const deltas = events.filter((event) => event.type === "delta");
    assert.deepEqual(deltas.map((event) => event.source), ["validated_teaching_package"]);
    assert.deepEqual(deltas.map((event) => event.delta), [localAnswer]);
    assert.equal(events.some((event) => event.type === "delta" && event.source === "external_web_stream"), false);
    assert.ok(events.some((event) =>
      event.type === "status" && event.stage === "external_fallback.unavailable"));

    const final = events.at(-1);
    assert.equal(final.type, "final");
    assert.equal(final.answer, localAnswer);
    assert.equal(final.grounding_status, "no_match");
    assert.equal(final.teaching_package.status, "no_match");
    assert.equal(final.answer_attribution, undefined);
    assert.equal(final.external_grounding, undefined);
    assert.equal(final.external_fallback.status, "failed");
    assert.equal(final.external_fallback.attempted, true);
    assert.equal(final.external_fallback.provider, "doubao_aixue");
    assert.equal(final.external_fallback.source_label, "内容来自豆包爱学");
    assert.equal(final.external_fallback.fallback_reason, "curriculum_no_match");
    assert.equal(final.external_fallback.error_code, "volc_education_network_error");
    assert.equal(botCalls, 1);
  });
});

test("browser online_search cannot bypass an answered selected-curriculum turn", async (t) => {
  let agentCalls = 0;
  let botCalls = 0;
  const localAnswer = "当前教材中，一次函数的图象是一条直线。";
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent" }),
    async runTurn(input, { onEvent }) {
      agentCalls += 1;
      assert.equal(input.skill, "knowledge_tutor");
      onEvent({
        type: "delta",
        source: "validated_teaching_package",
        delta: localAnswer,
        elapsed_ms: 10,
      });
      return boundaryTeachingPackage("answered", {
        skill: "knowledge_tutor",
        answer: localAnswer,
        requestId: "pi-request:browser-online-search-ignored",
      });
    },
    grade() { throw new Error("grade is not used in this test"); },
  };
  const educationBotClient = {
    configSummary: () => ({ configured: true, can_attempt: true, configuration_status: "verified" }),
    async *streamChatCompletion() {
      botCalls += 1;
      yield { type: "delta", content_delta: "must not be called" };
      yield { type: "done" };
    },
    async submitHomeworkMark() { throw new Error("not used"); },
    async pollHomeworkMark() { throw new Error("not used"); },
  };
  const { handler } = createAgentTestHandler(t, { agent, educationBotClient });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, {
      user_id: STUDENT_ID,
      session_id: "session-web-search",
      course_scope_id: "course-junior-math",
      skill: "knowledge_tutor",
      message: "一次函数的图象是什么？",
      online_search: {
        enabled: true,
        bot_id: "attacker-bot",
        api_token: "attacker-token",
      },
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    const deltas = events.filter((event) => event.type === "delta");
    assert.deepEqual(deltas.map((event) => event.delta), [localAnswer]);
    assert.equal(deltas[0].source, "validated_teaching_package");
    const final = events.at(-1);
    assert.equal(final.type, "final");
    assert.equal(final.answer, localAnswer);
    assert.equal(final.grounding_status, "answered");
    assert.equal(final.external_grounding, undefined);
    assert.equal(final.answer_attribution, undefined);
    assert.equal(final.external_fallback, null);
    assert.equal(agentCalls, 1);
    assert.equal(botCalls, 0);
  });
});

test("unavailable Doubao AI Learning is checked only after a local no-match", async (t) => {
  let agentCalls = 0;
  let botCalls = 0;
  const localAnswer = "当前教材中未找到这个知识点。";
  const educationBotClient = {
    configSummary: () => ({
      configured: true,
      can_attempt: false,
      configuration_status: "rejected",
    }),
    async *streamChatCompletion() {
      botCalls += 1;
      yield { type: "done" };
    },
    async submitHomeworkMark() {
      botCalls += 1;
      throw new Error("must not be called");
    },
    async pollHomeworkMark() {
      botCalls += 1;
      throw new Error("must not be called");
    },
  };
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent" }),
    async runTurn(input, { onEvent }) {
      agentCalls += 1;
      assert.equal(input.skill, "knowledge_tutor");
      onEvent({ type: "delta", source: "validated_teaching_package", delta: localAnswer });
      return boundaryTeachingPackage("no_match", {
        skill: "knowledge_tutor",
        answer: localAnswer,
        requestId: "pi-request:rejected-fallback",
      });
    },
    grade() { throw new Error("grade is not used in this test"); },
  };
  const { handler } = createAgentTestHandler(t, { agent, educationBotClient });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, {
      user_id: STUDENT_ID,
      session_id: "session-rejected-web-search",
      course_scope_id: "course-junior-math",
      message: "查询最新信息",
      online_search: { enabled: true },
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    const final = events.at(-1);
    assert.equal(final.type, "final");
    assert.equal(final.answer, localAnswer);
    assert.equal(final.grounding_status, "no_match");
    assert.equal(final.external_fallback.status, "failed");
    assert.equal(final.external_fallback.error_code, "online_search_not_configured");
    assert.equal(agentCalls, 1);
    assert.equal(botCalls, 0);
  });
});

test("invalid Doubao AI Learning credentials preserve the completed local no-match", async (t) => {
  let agentCalls = 0;
  const localAnswer = "当前教材中未找到这个知识点。";
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent" }),
    async runTurn(input, { onEvent }) {
      agentCalls += 1;
      assert.equal(input.skill, "knowledge_tutor");
      onEvent({ type: "delta", source: "validated_teaching_package", delta: localAnswer });
      return boundaryTeachingPackage("no_match", {
        skill: "knowledge_tutor",
        answer: localAnswer,
        requestId: "pi-request:invalid-key-fallback",
      });
    },
    grade() { throw new Error("grade is not used in this test"); },
  };
  const educationBotClient = {
    configSummary: () => ({ configured: true, can_attempt: true, configuration_status: "verified" }),
    async *streamChatCompletion() {
      const error = new Error("invalid api key");
      error.code = "volc_education_provider_error";
      error.providerCode = "invalid_api_key";
      error.status = 401;
      throw error;
    },
    async submitHomeworkMark() { throw new Error("not used"); },
    async pollHomeworkMark() { throw new Error("not used"); },
  };
  const { handler } = createAgentTestHandler(t, { agent, educationBotClient });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, {
      user_id: STUDENT_ID,
      session_id: "session-invalid-web-search-key",
      course_scope_id: "course-junior-math",
      message: "教育部官网是什么",
      online_search: { enabled: true },
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    const final = events.at(-1);
    assert.equal(final.type, "final");
    assert.equal(final.answer, localAnswer);
    assert.equal(final.grounding_status, "no_match");
    assert.equal(final.external_fallback.status, "failed");
    assert.equal(final.external_fallback.error_code, "online_search_invalid_api_key");
    assert.equal(agentCalls, 1);
  });
});

test("photo solver calls Doubao AI Learning only after its selected-curriculum result is no-match", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({ secret: HMAC_SECRET, clock: () => NOW });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  let agentCalls = 0;
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent" }),
    async runTurn(input, { onEvent }) {
      agentCalls += 1;
      assert.equal(input.skill, "photo_solver");
      assert.ok(input.image);
      onEvent({
        type: "delta",
        source: "validated_teaching_package",
        delta: "当前教材未匹配到这道题。",
      });
      return boundaryTeachingPackage("no_match", {
        skill: "photo_solver",
        answer: "当前教材未匹配到这道题。",
        requestId: "pi-request:photo-solver-fallback",
      });
    },
    grade() { throw new Error("grade is not used in this test"); },
  };
  let botInput = null;
  let homeworkCalls = 0;
  const educationBotClient = {
    configSummary: () => ({ configured: false, can_attempt: true, configuration_status: "unverified" }),
    async *streamChatCompletion(input) {
      botInput = input;
      yield { type: "delta", response_id: "external-image-chat", content_delta: "联网解题结果" };
      yield { type: "metadata", references: [], search_results: [], follow_ups: [] };
      yield { type: "done" };
    },
    async submitHomeworkMark() {
      homeworkCalls += 1;
      throw new Error("must not be called");
    },
    async pollHomeworkMark() { throw new Error("completed submissions are not polled"); },
  };
  const handler = createPiLearningHttpHandler({
    agent,
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
    educationBotClient,
    clock: () => NOW,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, {
      user_id: STUDENT_ID,
      session_id: "session-online-image",
      course_scope_id: "course-junior-math",
      message: "请联网解答并标出每道题",
      online_search: { enabled: true },
      image_task_mode: "solve",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    const final = events.at(-1);
    assert.equal(final.type, "final");
    assert.equal(final.answer, "联网解题结果");
    assert.equal(final.answer_attribution.source_label, "内容来自豆包爱学");
    assert.equal(final.external_grounding.mode, "external_fallback");
    assert.equal(final.homework_mark, null);
    assert.equal(final.image_task.resolved_mode, "solve");
    assert.equal(final.image_task.decision_source, "user_explicit");
    assert.equal(botInput.learnMode, "auto_learning");
    assert.equal(botInput.browsingMode, 2);
    assert.equal(agentCalls, 1);
    assert.equal(homeworkCalls, 0);
  });
});

test("AskEcho rich cards, image metadata and video metadata survive as a safe display contract", () => {
  const rich = normalizeExternalRichResults({
    cards: [{
      card_type: "video",
      video_card: {
        id: "video-1",
        title: "<img src=x onerror=alert(1)> 一次函数<b>视频</b>",
        site_name: "教学网",
        source_type: "douyin_video<script>",
        author_name: "王老师",
        url: "https://user:secret@media.example.test/lesson.mp4",
        duration: 27_981,
        cover_image: {
          url: "https://images.example.test/cover.jpg",
          width: 540,
          height: 960,
        },
        executable_html: "<script>steal()</script>",
      },
    }, {
      card_type: "image",
      image_card: {
        id: "unsafe-card",
        title: "不安全图片",
        url: "javascript:alert(1)",
        cover_image: { url: "https://127.0.0.1/admin.png" },
      },
    }],
    images: [{
      image_url: "https://images.example.test/function.png",
      source_url: "https://source.example.test/function",
      width: 800,
      height: 600,
    }, {
      image_url: "http://images.example.test/not-https.png",
    }, {
      image_url: "https://localhost/private.png",
    }],
    videos: [{
      id: "video-2",
      title: "函数图像讲解",
      url: "https://media.example.test/function.mp4",
      cover_image: { url: "https://images.example.test/function-cover.jpg" },
      duration: 12_000,
    }, {
      id: "private-video",
      url: "https://192.168.1.8/private.mp4",
    }],
  });

  assert.equal(rich.schema_version, "external-rich-results@1.0");
  assert.equal(rich.cards.length, 2);
  assert.equal(rich.cards[0].kind, "video");
  assert.equal(rich.cards[0].title, "一次函数 视频");
  assert.equal(rich.cards[0].url, "https://media.example.test/lesson.mp4");
  assert.equal(rich.cards[0].source_type, "douyin_videoscript");
  assert.equal(Object.hasOwn(rich.cards[0], "executable_html"), false);
  assert.equal(rich.cards[1].url, null);
  assert.equal(rich.cards[1].image, null);
  assert.deepEqual(rich.images.map((item) => item.image_url), [
    "https://images.example.test/function.png",
  ]);
  assert.equal(rich.videos.length, 2, "safe card identity may remain even when an unsafe media URL is rejected");
  assert.equal(rich.videos[0].url, "https://media.example.test/function.mp4");
  assert.equal(rich.videos[1].url, null);
  assert.equal(Object.isFrozen(rich), true);
});

test("explicit homework grading calls only the authoritative marking API", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({ secret: HMAC_SECRET, clock: () => NOW });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  let agentCalls = 0;
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent" }),
    async runTurn() {
      agentCalls += 1;
      throw new Error("Pi Agent must not be used for homework grading");
    },
    grade() { throw new Error("grade is not used in this test"); },
  };
  let submittedImage = "";
  const educationBotClient = {
    configSummary: () => ({ configured: false, can_attempt: true, configuration_status: "unverified" }),
    async *streamChatCompletion() { yield { type: "done" }; },
    async submitHomeworkMark({ imageBase64 }) {
      submittedImage = imageBase64;
      return {
        schema_version: "homework_mark@1.0",
        task_id: "mark-task-1",
        status: "running",
        questions: [],
      };
    },
    async pollHomeworkMark(taskId, { onUpdate }) {
      assert.equal(taskId, "mark-task-1");
      await onUpdate({ status: "running", questions: [{ question_id: "q1" }] });
      return {
        schema_version: "homework_mark@1.0",
        task_id: taskId,
        status: "success",
        preprocessed_image_url: "https://example.test/preprocessed.jpg",
        questions: [{
          question_id: "q1",
          finished: true,
          polygon: [{ x: 1, y: 2 }, { x: 20, y: 2 }, { x: 20, y: 30 }, { x: 1, y: 30 }],
          answers: [],
          solution_text: "答案与解析",
        }],
      };
    },
  };
  const handler = createPiLearningHttpHandler({
    agent,
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
    educationBotClient,
    clock: () => NOW,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      session_id: "session-homework-mark",
      course_scope_id: "course-junior-math",
      message: "请批改这张作业",
      image_task_mode: "grade",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.match(payload.answer, /批改完成，共识别 1 道题/u);
    assert.equal(payload.grounding_status, "homework_graded");
    assert.equal(payload.image_task.resolved_mode, "grade");
    assert.equal(payload.homework_mark.status, "success");
    assert.equal(payload.homework_mark.questions[0].polygon.length, 4);
    assert.equal(submittedImage, "data:image/png;base64,aGVsbG8=");
    assert.equal(agentCalls, 0);
  });
});

test("auto image routing chooses one path and low confidence asks for an explicit choice", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({ secret: HMAC_SECRET, clock: () => NOW });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  let agentCalls = 0;
  let homeworkCalls = 0;
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent", model: "vision-test" }),
    async runTurn(input) {
      agentCalls += 1;
      assert.equal(input.skill, "photo_solver");
      return { ...teachingPackage(), skill: "photo_solver", question_drafts: [] };
    },
    grade() { throw new Error("grade is not used in this test"); },
  };
  const educationBotClient = {
    configSummary: () => ({ configured: false, can_attempt: true, configuration_status: "unverified" }),
    async *streamChatCompletion() { yield { type: "done" }; },
    async submitHomeworkMark() {
      homeworkCalls += 1;
      throw new Error("must not be called");
    },
    async pollHomeworkMark() { throw new Error("must not be called"); },
  };
  const decisions = [{
    schema_version: "education-image-task-decision@1.0",
    status: "resolved",
    requested_mode: "auto",
    resolved_mode: "solve",
    confidence: 0.93,
    decision_source: "vision_model",
    reason_code: "model_resolved",
    basis: "图片为一道未作答题目",
    observed_signals: ["blank_problem_visible"],
    clarification: null,
  }, {
    schema_version: "education-image-task-decision@1.0",
    status: "clarify",
    requested_mode: "auto",
    resolved_mode: null,
    confidence: 0.55,
    decision_source: "vision_model",
    reason_code: "model_confidence_below_threshold",
    basis: "无法确认图片是否包含学生作答",
    observed_signals: ["insufficient_context"],
    clarification: {
      prompt: "请选择这张图片要用于拍照答题，还是作业批改。",
      options: [{ id: "solve", label: "拍照答题" }, { id: "grade", label: "作业批改" }],
    },
  }];
  const imageTaskIntentResolver = {
    configSummary: () => ({ configured: true, fallback: "clarify" }),
    async resolve() { return decisions.shift(); },
  };
  const handler = createPiLearningHttpHandler({
    agent,
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
    educationBotClient,
    imageTaskIntentResolver,
    clock: () => NOW,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const first = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      session_id: "session-auto-solve",
      course_scope_id: "course-junior-math",
      message: "帮我看看这道题",
      image_task_mode: "auto",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    });
    assert.equal(first.status, 200);
    const solved = await first.json();
    assert.equal(solved.image_task.resolved_mode, "solve");
    assert.equal(agentCalls, 1);
    assert.equal(homeworkCalls, 0);

    const second = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      session_id: "session-auto-clarify",
      course_scope_id: "course-junior-math",
      image_task_mode: "auto",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    });
    assert.equal(second.status, 200);
    const clarified = await second.json();
    assert.equal(clarified.grounding_status, "clarify");
    assert.equal(clarified.image_task.status, "clarify");
    assert.deepEqual(
      clarified.image_task.clarification.options.map((item) => item.id),
      ["solve", "grade"],
    );
    assert.equal(agentCalls, 1);
    assert.equal(homeworkCalls, 0);
  });
});

test("auto image routing can choose homework grading without calling the Pi solver", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({ secret: HMAC_SECRET, clock: () => NOW });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  let agentCalls = 0;
  let homeworkCalls = 0;
  const handler = createPiLearningHttpHandler({
    agent: {
      configSummary: () => ({ configured: true }),
      async runTurn() { agentCalls += 1; return teachingPackage(); },
      grade() { throw new Error("not used"); },
    },
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
    imageTaskIntentResolver: {
      configSummary: () => ({ configured: true, fallback: "clarify" }),
      async resolve() {
        return {
          schema_version: "education-image-task-decision@1.0",
          status: "resolved",
          requested_mode: "auto",
          resolved_mode: "grade",
          confidence: 0.95,
          decision_source: "vision_model",
          reason_code: "model_resolved",
          basis: "图片中可见一页已完成作业",
          observed_signals: ["completed_answers_visible"],
          clarification: null,
        };
      },
    },
    educationBotClient: {
      configSummary: () => ({ configured: false, can_attempt: true, configuration_status: "unverified" }),
      async *streamChatCompletion() { yield { type: "done" }; },
      async submitHomeworkMark() {
        homeworkCalls += 1;
        return {
          schema_version: "homework_mark@1.0",
          task_id: "mark-auto-grade",
          status: "success",
          questions: [],
        };
      },
      async pollHomeworkMark() { throw new Error("not reached"); },
    },
    clock: () => NOW,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      course_scope_id: "course-junior-math",
      image_task_mode: "auto",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.image_task.resolved_mode, "grade");
    assert.equal(payload.homework_mark.task_id, "mark-auto-grade");
    assert.equal(homeworkCalls, 1);
    assert.equal(agentCalls, 0);
  });
});

test("homework grade gate uses can_attempt and does not trust legacy configured", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({ secret: HMAC_SECRET, clock: () => NOW });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  let providerCalls = 0;
  let agentCalls = 0;
  const handler = createPiLearningHttpHandler({
    agent: {
      configSummary: () => ({ configured: true }),
      async runTurn() { agentCalls += 1; return teachingPackage(); },
      grade() { throw new Error("not used"); },
    },
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
    educationBotClient: {
      configSummary: () => ({ configured: true, can_attempt: false, configuration_status: "rejected" }),
      async *streamChatCompletion() { providerCalls += 1; yield { type: "done" }; },
      async submitHomeworkMark() { providerCalls += 1; throw new Error("must not be called"); },
      async pollHomeworkMark() { providerCalls += 1; throw new Error("must not be called"); },
    },
    clock: () => NOW,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      course_scope_id: "course-junior-math",
      image_task_mode: "grade",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    });
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.error, "homework_mark_not_configured");
    assert.match(payload.message, /鉴权失败/u);
    assert.equal(providerCalls, 0);
    assert.equal(agentCalls, 0);
  });
});

test("explicit homework grading surfaces a safe provider failure instead of returning a Pi answer", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({ secret: HMAC_SECRET, clock: () => NOW });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  let agentCalls = 0;
  const handler = createPiLearningHttpHandler({
    agent: {
      configSummary: () => ({ configured: true }),
      async runTurn() { agentCalls += 1; return teachingPackage(); },
      grade() { throw new Error("not used"); },
    },
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
    educationBotClient: {
      configSummary: () => ({ configured: false, can_attempt: true, configuration_status: "unverified" }),
      async *streamChatCompletion() { yield { type: "done" }; },
      async submitHomeworkMark() {
        const error = new Error("provider detail must stay hidden");
        error.code = "volc_education_provider_error";
        error.status = 502;
        throw error;
      },
      async pollHomeworkMark() { throw new Error("not reached"); },
    },
    clock: () => NOW,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      course_scope_id: "course-junior-math",
      image_task_mode: "grade",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    });
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.error, "homework_mark_provider_error");
    assert.doesNotMatch(JSON.stringify(payload), /provider detail must stay hidden/u);
    assert.equal(agentCalls, 0);
  });
});

test("image task mode rejects invalid values and mode-without-image", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({ secret: HMAC_SECRET, clock: () => NOW });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  const handler = createPiLearningHttpHandler({
    agent: {
      configSummary: () => ({ configured: true }),
      async runTurn() { throw new Error("must not be called"); },
      grade() { throw new Error("must not be called"); },
    },
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const invalid = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      course_scope_id: "course-junior-math",
      image_task_mode: "both",
      image: { mime_type: "image/png", data: "aGVsbG8=" },
    });
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error, "image_task_mode_invalid");

    const missing = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      course_scope_id: "course-junior-math",
      image_task_mode: "solve",
      message: "请解答",
    });
    assert.equal(missing.status, 422);
    assert.equal((await missing.json()).error, "image_task_image_required");
  });
});

test("Pi learning stream ends with an explicit retryable total-timeout event", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({ secret: HMAC_SECRET, clock: () => NOW });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  const agent = {
    configSummary: () => ({ configured: true, framework: "Pi Agent" }),
    runTurn(_input, { signal }) {
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("本轮已取消");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    grade() {
      throw new Error("grade is not used in this test");
    },
  };
  const handler = createPiLearningHttpHandler({
    agent,
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
    chatTotalTimeoutMs: 60,
    streamHeartbeatMs: 50,
  });

  await withHttpServer(handler, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/agent/chat/stream`, {
      user_id: STUDENT_ID,
      session_id: "session-timeout",
      course_scope_id: "course-junior-math",
      message: "一次函数是什么",
    });
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    const terminal = events.at(-1);
    assert.equal(terminal.type, "error");
    assert.equal(terminal.code, "agent_total_timeout");
    assert.equal(terminal.retryable, true);
  });
});

test("Pi learning HTTP fails closed for unauthorized, out-of-scope, and invalid browser input", async (t) => {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({
    secret: HMAC_SECRET,
    clock: () => NOW,
  });
  let agentCalls = 0;
  const agent = {
    configSummary: () => ({ configured: true }),
    async runTurn() {
      agentCalls += 1;
      return teachingPackage();
    },
    grade() {
      agentCalls += 1;
      throw new Error("grade should not be reached");
    },
  };
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  const deniedHandler = createPiLearningHttpHandler({
    agent,
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => false,
  });
  await withHttpServer(deniedHandler, async (baseUrl) => {
    const denied = await postJson(`${baseUrl}/api/agent/chat`, {
      user_id: STUDENT_ID,
      message: "一次函数",
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, "education_agent_forbidden");
  });

  const handler = createPiLearningHttpHandler({
    agent,
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
  });
  await withHttpServer(handler, async (baseUrl) => {
    const invalidCases = [
      [{
        user_id: STUDENT_ID,
        course_scope_id: "attacker-course",
        message: "一次函数",
      }, 403, "learning_scope_forbidden"],
      [{
        user_id: "student-outside-tenant",
        course_scope_id: "course-junior-math",
        message: "一次函数",
      }, 403, "student_scope_forbidden"],
      [{
        user_id: STUDENT_ID,
        course_scope_id: "course-junior-math",
        knowledge_point_id: "MALICIOUS-KP",
        message: "解释这个知识点",
      }, 403, "knowledge_point_not_in_scope"],
      [{
        user_id: STUDENT_ID,
        course_scope_id: "course-junior-math",
        skill: "arbitrary_tool_runner",
        message: "执行任意工具",
      }, 422, "pi_learning_skill_unknown"],
      [{
        user_id: STUDENT_ID,
        course_scope_id: "course-junior-math",
        skill: "question_generator",
        message: "出题",
        question_preferences: { difficulty: "impossible" },
      }, 422, "question_difficulty_invalid"],
      [{
        user_id: STUDENT_ID,
        course_scope_id: "course-junior-math",
        session_id: `invalid\u0000session`,
        message: "一次函数",
      }, 422, "learning_session_invalid"],
    ];
    for (const [body, expectedStatus, expectedCode] of invalidCases) {
      const response = await postJson(`${baseUrl}/api/agent/chat`, body);
      assert.equal(response.status, expectedStatus, expectedCode);
      assert.equal((await response.json()).error, expectedCode);
    }

    const unknownScope = await fetch(
      `${baseUrl}/api/education/agent/scope?scope_id=attacker-course`,
    );
    assert.equal(unknownScope.status, 403);
    assert.equal((await unknownScope.json()).error, "learning_scope_forbidden");

    const gradeOtherStudent = await postJson(`${baseUrl}/api/education/agent/grade`, {
      user_id: "student-outside-tenant",
      session_id: "session-1",
      assessment_instance_id: INSTANCE_ID,
      selected: "B",
    });
    assert.equal(gradeOtherStudent.status, 403);
    assert.equal((await gradeOtherStudent.json()).error, "student_scope_forbidden");
  });
  assert.equal(agentCalls, 0);
});

function createRuntime(t) {
  const store = createEducationDataStore({ filename: ":memory:", clock: () => NOW });
  store.initialize();
  t.after(() => store.close());
  store.upsertTenant({ tenantId: TENANT_ID, name: "Pi HTTP 测试租户" });
  store.upsertStudent({
    tenantId: TENANT_ID,
    student: { student_id: STUDENT_ID, name: "测试学生", grade: "八年级" },
  });
  store.importOntology({
    tenantId: TENANT_ID,
    ontology: {
      ontology_id: ONTOLOGY_ID,
      ontology_version: ONTOLOGY_VERSION,
      name: "初中数学测试本体",
      entity_classes: [
        { key: "domain", name: "领域" },
        { key: "theme", name: "主题" },
        { key: "knowledge_point", name: "知识点" },
      ],
      relation_types: [{ key: "part_of", name: "属于", directed: true }],
      domains: [{ id: "domain-functions", name: "数与代数" }],
      themes: [{ id: "theme-functions", domain_id: "domain-functions", name: "函数" }],
      knowledge_points: [{
        id: KNOWLEDGE_POINT_ID,
        entity_class: "knowledge_point",
        theme_id: "theme-functions",
        name: "一次函数的图象与性质",
        measurable_behavior: "能根据一次函数图象解释变量关系。",
      }, {
        id: SECOND_KNOWLEDGE_POINT_ID,
        entity_class: "knowledge_point",
        theme_id: "theme-functions",
        name: "一次函数的变化规律",
        measurable_behavior: "能根据系数判断一次函数的增减性。",
      }],
      edges: [],
    },
  });
  return { store };
}

function teachingPackage() {
  return {
    schema_version: "pi-learning-teaching-package@1.0",
    request_id: "pi-request:test-1",
    status: "answered",
    skill: "question_generator",
    answer: "请完成这道一次函数练习。",
    question_drafts: [{
      assessment_id: ASSESSMENT_ID,
      assessment_instance_id: INSTANCE_ID,
      knowledge_point_ids: [KNOWLEDGE_POINT_ID],
      blueprint: {
        item_type: "single_choice",
        difficulty: "medium",
        cognitive_level: "apply",
        generation_method: "条件变式",
      },
      public_item: {
        title: "一次函数练习",
        prompt: "已知 y=2x+5，它与 y 轴的交点纵坐标是多少？",
        instruction: "选择一个答案",
        options: [
          { id: "A", label: "2" },
          { id: "B", label: "5" },
          { id: "C", label: "7" },
        ],
      },
    }],
    mastery_evidence_proposals: [],
    generated_at: NOW,
  };
}

function boundaryTeachingPackage(status, {
  skill = "knowledge_tutor",
  answer = `local-${status}`,
  requestId = `pi-request:${skill}-${status}`,
} = {}) {
  return {
    schema_version: "pi-learning-teaching-package@1.0",
    request_id: requestId,
    status,
    skill,
    answer,
    grounding: {
      status: status === "answered" ? "retrieved" : status,
      code: status === "answered" ? "retrieved" : status,
    },
    knowledge_point_ids: [],
    solution_steps: [],
    cards: [],
    question_drafts: [],
    mastery_evidence_proposals: [],
    generated_at: NOW,
  };
}

function createAgentTestHandler(t, { agent, educationBotClient }) {
  const runtime = createRuntime(t);
  const authority = createHmacGradingReceiptAuthority({
    secret: HMAC_SECRET,
    clock: () => NOW,
  });
  const dataService = createEducationDataService({
    store: runtime.store,
    verifyGradingReceipt: authority.verify,
  });
  const handler = createPiLearningHttpHandler({
    agent,
    dataService,
    dataStore: runtime.store,
    tenantId: TENANT_ID,
    gradingReceiptAuthority: authority,
    authorizeRequest: () => true,
    servicePrincipalId: "server-course-reader",
    educationBotClient,
    clock: () => NOW,
  });
  return { handler, dataService, store: runtime.store };
}

async function withHttpServer(handler, run) {
  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    if (!(await handler(req, res, requestUrl))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
