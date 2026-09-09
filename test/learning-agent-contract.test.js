import assert from "node:assert/strict";
import test from "node:test";

import {
  LEARNING_AGENT_CONTRACT_VERSION,
  LEARNING_AGENT_VISUAL_VARIANTS,
  LearningAgentContractError,
  buildLearningAgentContractPrompt,
  createLearningAgentRuntime,
  createPublicLearningAgentProjection,
  hydrateLearningAgentResponse,
  parseLearningAgentResponse,
  validateLearningAgentResponse
} from "../learning-agent-contract.js";
import { validateAgentEducationUiResponse } from "../agent-education-ui-contract.js";

const REQUEST_ID = "request_turn_001";
const KNOWLEDGE_REGISTRY = [
  { id: "M4-GE-TRI-10", name: "勾股定理" },
  { id: "M4-NA-FUN-02", name: "一次函数的图象和性质" }
];
const KNOWLEDGE_CANDIDATES = [
  {
    candidate_id: "candidate.kp.1",
    knowledge_point_id: "M4-GE-TRI-10",
    label: "勾股定理",
    score: 0.97
  },
  {
    candidate_id: "candidate.kp.2",
    knowledge_point_id: "M4-NA-FUN-02",
    label: "一次函数的图象和性质",
    score: 0.91
  }
];

function authority(overrides = {}) {
  return {
    tenant_id: "tenant_school_1",
    user_id: "student_1",
    session_id: "session_1",
    turn_id: "turn_1",
    request_id: REQUEST_ID,
    idempotency_key: "idem_1",
    expected_state_version: 0,
    ...overrides
  };
}

function baseResponse(overrides = {}) {
  const answer = overrides.answer || "先确认直角三角形，再使用勾股定理。";
  return {
    schema_version: LEARNING_AGENT_CONTRACT_VERSION,
    request_id: REQUEST_ID,
    answer,
    ui_plan: {
      schema_version: "ai-teacher-ui@1.1",
      answer,
      cards: []
    },
    event: {
      event_proposal_id: "event.1",
      type: "knowledge_question",
      confidence: 0.94,
      evidence_spans: [{ source: "user_text", quote: "勾股定理怎么用" }]
    },
    knowledge_proposals: [
      {
        proposal_id: "knowledge.1",
        mention: "勾股定理",
        candidate_id: "candidate.kp.1",
        role: "primary",
        confidence: 0.95,
        evidence_spans: [{ source: "user_text", quote: "勾股定理" }]
      }
    ],
    mastery_evidence_proposals: [],
    assessment_proposals: [],
    visual_proposals: [],
    ...overrides
  };
}

function assessmentProposal() {
  return {
    proposal_id: "assessment.1",
    knowledge_proposal_ids: ["knowledge.1"],
    blueprint: {
      item_type: "single_choice",
      cognitive_level: "apply",
      difficulty: "easy",
      generation_method: "条件变式",
      estimated_minutes: 2
    },
    public_item: {
      title: "勾股定理练习",
      prompt: "直角三角形的两条直角边为 3 和 4，斜边长是多少？",
      instruction: "选择一个答案",
      options: [
        { id: "A", label: "5" },
        { id: "B", label: "6" },
        { id: "C", label: "7" }
      ]
    },
    private_key: {
      correct_option_ids: ["A"],
      explanation: "3²+4²=25，所以斜边为 5。",
      solution_paths: [
        {
          title: "直接代入",
          steps: ["识别两条直角边", "代入 a²+b²=c²", "开平方得 c=5"],
          when_to_use: "已知两条直角边"
        }
      ],
      common_errors: ["把直角边当成斜边"],
      scoring_points: [{ criterion: "正确代入并得出结果", points: 2 }]
    }
  };
}

function visualProposal(visibility = "immediate", purpose = "question_stimulus") {
  return {
    proposal_id: "visual.1",
    knowledge_proposal_ids: ["knowledge.1"],
    assessment_proposal_id: "assessment.1",
    purpose,
    visibility,
    visual_spec: {
      schema_version: "interactive-visual@1.0",
      variant: "triangle",
      title: "题目中的直角三角形",
      description: "拖动边长理解三边关系",
      model: "right_triangle",
      parameters: { a: 3, b: 4 }
    }
  };
}

test("prompt fixes proposal-only authority and enumerates the existing ten visual variants", () => {
  const prompt = buildLearningAgentContractPrompt({
    requestId: REQUEST_ID,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES,
    uiReferenceCatalog: { assessments: [{ ref: "assessment.fixed.1", label: "固定题" }] }
  });

  assert.match(prompt, /candidate_id 必须为 null/u);
  assert.match(prompt, /mastery_probability/u);
  assert.match(prompt, /private_key/u);
  assert.match(prompt, /interactive-visual@1\.0/u);
  assert.match(prompt, /candidate\.kp\.1/u);
  LEARNING_AGENT_VISUAL_VARIANTS.forEach((variant) => assert.match(prompt, new RegExp(variant, "u")));
});

test("parser accepts a complete v2 response whose nested UI plan remains ai-teacher-ui@1.1 compatible", () => {
  const payload = baseResponse();
  assert.deepEqual(parseLearningAgentResponse(JSON.stringify(payload)), payload);
  assert.equal(validateAgentEducationUiResponse(payload.ui_plan).valid, true);
  assert.throws(
    () => parseLearningAgentResponse(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``),
    (error) => error instanceof LearningAgentContractError && error.code === "learning_agent_invalid_json"
  );
});

test("validator forbids Agent-authored mastery values and answer-bearing public questions", () => {
  const withMasteryDelta = baseResponse({
    mastery_evidence_proposals: [
      {
        proposal_id: "evidence.1",
        knowledge_proposal_id: "knowledge.1",
        evidence_mode: "self_report",
        signal_type: "self_report_easy",
        evidence_ref: null,
        strength: "weak",
        confidence: 0.7,
        basis: "学生说很简单",
        mastery_delta: 0.2
      }
    ]
  });
  let result = validateLearningAgentResponse(withMasteryDelta);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.code === "ADDITIONAL_PROPERTY"));

  const proposal = assessmentProposal();
  proposal.public_item.correct_answer = "A";
  result = validateLearningAgentResponse(baseResponse({ assessment_proposals: [proposal] }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.path.endsWith("correct_answer")));
});

test("server candidate selection yields mapped, partial, no-match and conflict receipts without name guessing", () => {
  const mapped = hydrateLearningAgentResponse(baseResponse(), {
    authority: authority(),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES
  });
  assert.equal(mapped.mapping.status, "mapped");
  assert.equal(mapped.mapping.items[0].knowledge_point_id, "M4-GE-TRI-10");

  const partialPayload = baseResponse({
    knowledge_proposals: [
      baseResponse().knowledge_proposals[0],
      {
        proposal_id: "knowledge.2",
        mention: "某个未收录的方法",
        candidate_id: null,
        role: "supporting",
        confidence: 0.4,
        evidence_spans: [{ source: "user_text", quote: "某个方法" }]
      }
    ]
  });
  const partial = hydrateLearningAgentResponse(partialPayload, {
    authority: authority(),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES
  });
  assert.equal(partial.mapping.status, "partial_mapping");

  const fakeCandidate = baseResponse();
  fakeCandidate.knowledge_proposals[0].candidate_id = "candidate.agent.invented";
  const noMatch = hydrateLearningAgentResponse(fakeCandidate, {
    authority: authority(),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES
  });
  assert.equal(noMatch.mapping.status, "no_match");
  assert.equal(noMatch.mapping.items[0].code, "CANDIDATE_NOT_IN_TURN");

  const conflict = hydrateLearningAgentResponse(baseResponse(), {
    authority: authority(),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: [{
      candidate_id: "candidate.kp.1",
      knowledge_point_id: "MISSING-KP",
      label: "已过期候选"
    }]
  });
  assert.equal(conflict.mapping.status, "conflict");
  assert.equal(conflict.mapping.items[0].code, "CANDIDATE_TARGET_MISSING");
});

test("direct assessment is mastery-eligible only after server evidence verification; self-report is preference only", () => {
  const payload = baseResponse({
    event: {
      event_proposal_id: "event.1",
      type: "assessment_answer",
      confidence: 0.98,
      evidence_spans: [{ source: "student_answer", quote: "A" }]
    },
    mastery_evidence_proposals: [
      {
        proposal_id: "evidence.direct",
        knowledge_proposal_id: "knowledge.1",
        evidence_mode: "direct_assessment",
        signal_type: "answer_correct",
        evidence_ref: "attempt.1",
        strength: "strong",
        confidence: 0.99,
        basis: "服务端题目作答结果"
      },
      {
        proposal_id: "evidence.self",
        knowledge_proposal_id: "knowledge.1",
        evidence_mode: "self_report",
        signal_type: "self_report_easy",
        evidence_ref: null,
        strength: "weak",
        confidence: 0.8,
        basis: "学生说这类题很简单"
      }
    ]
  });
  const hydrated = hydrateLearningAgentResponse(payload, {
    authority: authority(),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES,
    verifiedEvidence: [{
      evidence_ref: "attempt.1",
      tenant_id: "tenant_school_1",
      user_id: "student_1",
      knowledge_point_ids: ["M4-GE-TRI-10"],
      outcome: "correct",
      kind: "assessment_attempt"
    }]
  });

  assert.equal(hydrated.evidence_decisions[0].status, "accepted_direct");
  assert.equal(hydrated.evidence_decisions[0].apply_to_mastery, true);
  assert.equal(hydrated.evidence_decisions[1].status, "preference_only");
  assert.equal(hydrated.evidence_decisions[1].apply_to_mastery, false);

  const unverified = hydrateLearningAgentResponse(payload, {
    authority: authority(),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES,
    verifiedEvidence: []
  });
  assert.equal(unverified.evidence_decisions[0].status, "rejected");
  assert.equal(unverified.evidence_decisions[0].code, "DIRECT_EVIDENCE_NOT_FOUND");
});

test("generated question and matching controlled visual hydrate together while private answers never enter JSON", () => {
  const payload = baseResponse({
    assessment_proposals: [assessmentProposal()],
    visual_proposals: [visualProposal()]
  });
  const hydrated = hydrateLearningAgentResponse(payload, {
    authority: authority(),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES
  });
  const publicProjection = createPublicLearningAgentProjection(hydrated);
  const publicJson = JSON.stringify(publicProjection);

  assert.equal(hydrated.assessment_receipts[0].status, "drafted");
  assert.equal(hydrated.assessment_receipts[0].publishable, false);
  assert.equal(hydrated.visual_receipts[0].assessment_id, hydrated.assessment_receipts[0].assessment_id);
  assert.equal(hydrated.visual_receipts[0].visual_spec.schema_version, "interactive-visual@1.0");
  assert.equal(hydrated.visual_receipts[0].visual_spec.variant, "triangle");
  assert.equal(publicJson.includes("correct_option_ids"), false);
  assert.equal(publicJson.includes("3²+4²=25"), false);
  assert.equal(publicJson.includes("private_key"), false);
});

test("solution visual is withheld before submit and executable visual fields fail closed", () => {
  const solution = visualProposal("after_submit", "solution_explanation");
  const hydrated = hydrateLearningAgentResponse(baseResponse({
    assessment_proposals: [assessmentProposal()],
    visual_proposals: [solution]
  }), {
    authority: authority(),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES
  });
  assert.equal(hydrated.visual_receipts[0].visual_spec, null);

  const unsafe = visualProposal();
  unsafe.visual_spec.parameters.onChange = "fetch('/private')";
  const validation = validateLearningAgentResponse(baseResponse({
    assessment_proposals: [assessmentProposal()],
    visual_proposals: [unsafe]
  }));
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((item) => item.code === "EXECUTABLE_FIELD"));
  assert.ok(validation.errors.some((item) => item.code === "EXECUTABLE_CONTENT"));
});

test("runtime enforces per-user CAS and scoped idempotency while keeping private answer keys server-side", () => {
  const runtime = createLearningAgentRuntime({ now: () => "2026-08-14T12:00:00+08:00" });
  const payload = baseResponse({ assessment_proposals: [assessmentProposal()] });
  const options = {
    authority: authority(),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES
  };
  const first = runtime.apply(payload, options);
  assert.equal(first.ok, true);
  assert.equal(first.state_version, 1);
  assert.equal(first.idempotent, false);

  const replay = runtime.apply(payload, options);
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.state_version, 1);

  const changed = structuredClone(payload);
  changed.answer = "改变后的回答";
  changed.ui_plan.answer = changed.answer;
  const idempotencyConflict = runtime.apply(changed, options);
  assert.equal(idempotencyConflict.code, "IDEMPOTENCY_CONFLICT");

  const stalePayload = baseResponse({ request_id: "request_turn_002" });
  stalePayload.ui_plan.answer = stalePayload.answer;
  const stale = runtime.apply(stalePayload, {
    ...options,
    authority: authority({ request_id: "request_turn_002", idempotency_key: "idem_2", expected_state_version: 0 })
  });
  assert.equal(stale.code, "STALE_STATE_VERSION");

  const privateAssessment = runtime.getPrivateAssessment({
    tenantId: "tenant_school_1",
    userId: "student_1",
    assessmentId: first.public_projection.assessment_receipts[0].assessment_id
  });
  assert.deepEqual(privateAssessment.private_key.correct_option_ids, ["A"]);
  assert.equal(JSON.stringify(runtime.inspect({ tenantId: "tenant_school_1", userId: "student_1" })).includes("correct_option_ids"), false);
  assert.equal(runtime.inspect({ tenantId: "tenant_school_1", userId: "student_2" }).state_version, 0);

  const userTwo = runtime.apply(payload, {
    ...options,
    authority: authority({ user_id: "student_2" })
  });
  assert.equal(userTwo.ok, true);
  assert.equal(userTwo.state_version, 1);
  assert.equal(runtime.inspect({ tenantId: "tenant_school_1", userId: "student_1" }).learning_events.length, 1);
  assert.equal(runtime.inspect({ tenantId: "tenant_school_1", userId: "student_2" }).learning_events.length, 1);
});

test("no-match creates no mastery ledger entry and mapped self-report stays a non-mastery preference", () => {
  const runtime = createLearningAgentRuntime();
  const noMatchPayload = baseResponse({
    knowledge_proposals: [{
      ...baseResponse().knowledge_proposals[0],
      candidate_id: null,
      mention: "未收录的解题术语"
    }],
    mastery_evidence_proposals: [{
      proposal_id: "evidence.unmapped",
      knowledge_proposal_id: "knowledge.1",
      evidence_mode: "inferred",
      signal_type: "teacher_observation",
      evidence_ref: null,
      strength: "weak",
      confidence: 0.5,
      basis: "只有 Agent 的初步判断"
    }]
  });
  const noMatch = runtime.apply(noMatchPayload, {
    authority: authority(),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES
  });
  assert.equal(noMatch.public_projection.mapping.status, "no_match");
  assert.equal(noMatch.applied.mastery_eligible_evidence_count, 0);
  assert.equal(runtime.inspect({ tenantId: "tenant_school_1", userId: "student_1" }).evidence_events.length, 0);

  const selfReportPayload = baseResponse({
    request_id: "request_turn_self_report",
    event: {
      event_proposal_id: "event.self",
      type: "student_self_report",
      confidence: 0.9,
      evidence_spans: [{ source: "user_text", quote: "这个太简单了，不要再考" }]
    },
    mastery_evidence_proposals: [{
      proposal_id: "evidence.self",
      knowledge_proposal_id: "knowledge.1",
      evidence_mode: "self_report",
      signal_type: "self_report_easy",
      evidence_ref: null,
      strength: "weak",
      confidence: 0.9,
      basis: "学生自述很容易"
    }]
  });
  selfReportPayload.ui_plan.answer = selfReportPayload.answer;
  const selfReport = runtime.apply(selfReportPayload, {
    authority: authority({
      request_id: "request_turn_self_report",
      idempotency_key: "idem_self_report",
      expected_state_version: 1
    }),
    knowledgeRegistry: KNOWLEDGE_REGISTRY,
    knowledgeCandidates: KNOWLEDGE_CANDIDATES
  });
  assert.equal(selfReport.ok, true);
  assert.equal(selfReport.applied.mastery_eligible_evidence_count, 0);
  assert.equal(selfReport.applied.preference_event_count, 1);
  const evidence = runtime.inspect({ tenantId: "tenant_school_1", userId: "student_1" }).evidence_events;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].status, "preference_only");
  assert.equal(evidence[0].apply_to_mastery, false);
});

test("request nonce and nested answer are validated before hydration", () => {
  assert.throws(
    () => hydrateLearningAgentResponse(baseResponse(), {
      authority: authority({ request_id: "another_request" }),
      knowledgeRegistry: KNOWLEDGE_REGISTRY,
      knowledgeCandidates: KNOWLEDGE_CANDIDATES
    }),
    (error) => error?.code === "learning_agent_request_mismatch"
  );

  const mismatched = baseResponse();
  mismatched.ui_plan.answer = "不同的回答";
  const validation = validateLearningAgentResponse(mismatched);
  assert.ok(validation.errors.some((item) => item.code === "ANSWER_MISMATCH"));
});
