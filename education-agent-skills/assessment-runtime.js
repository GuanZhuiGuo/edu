import { createHash } from "node:crypto";

const MAX_RESPONSE_LENGTH = 8_000;

/**
 * Keeps model-authored answer keys on the server and exposes only opaque
 * assessment instances plus verified grading receipts. It deliberately does
 * not calculate or persist mastery; the education data service consumes the
 * receipt after applying its own policy and idempotency checks.
 */
export function createPiAssessmentRuntime({ learningRuntime, now = () => new Date().toISOString() } = {}) {
  if (!learningRuntime || typeof learningRuntime.getPrivateAssessment !== "function") {
    throw new TypeError("learningRuntime.getPrivateAssessment is required");
  }
  const instances = new Map();
  const gradingReceipts = new Map();

  function registerAssessment({
    tenantId,
    studentId,
    sessionId,
    assessmentId,
    requestId,
  } = {}) {
    const tenant = identifier(tenantId, "tenantId");
    const student = identifier(studentId, "studentId");
    const session = identifier(sessionId, "sessionId");
    const assessment = identifier(assessmentId, "assessmentId");
    const privateAssessment = learningRuntime.getPrivateAssessment({
      tenantId: tenant,
      userId: student,
      assessmentId: assessment,
    });
    if (!privateAssessment) {
      throw runtimeError("assessment_private_key_not_found", "题目的服务端评分信息不存在", 404);
    }
    const instanceId = `assessment_instance:${digest([
      tenant,
      student,
      session,
      assessment,
      identifier(requestId || assessment, "requestId"),
    ].join("\u001f")).slice(0, 32)}`;
    if (!instances.has(instanceId)) {
      instances.set(instanceId, Object.freeze({
        assessment_instance_id: instanceId,
        assessment_id: assessment,
        tenant_id: tenant,
        student_id: student,
        session_id: session,
        created_at: safeTimestamp(now()),
      }));
    }
    return publicInstance(instances.get(instanceId), privateAssessment);
  }

  function registerTeachingPackage(teachingPackage, context = {}) {
    if (!teachingPackage || teachingPackage.schema_version !== "pi-learning-teaching-package@1.0") {
      throw runtimeError("teaching_package_invalid", "只能注册已验证的 Pi 学习教学包", 422);
    }
    const tenantId = context.tenantId || context.tenant_id || teachingPackage.authority?.tenant_id;
    const studentId = context.studentId || context.student_id || teachingPackage.authority?.user_id;
    const sessionId = context.sessionId || context.session_id || teachingPackage.authority?.session_id;
    return Object.freeze((teachingPackage.question_drafts || []).map((draft) => {
      const existing = instances.get(String(draft?.assessment_instance_id || ""));
      if (existing) {
        if (
          identifier(studentId, "studentId") !== existing.student_id
          || identifier(sessionId, "sessionId") !== existing.session_id
        ) {
          throw runtimeError("assessment_scope_mismatch", "题目实例不属于当前学生会话", 403);
        }
        const privateAssessment = learningRuntime.getPrivateAssessment({
          tenantId: existing.tenant_id,
          userId: existing.student_id,
          assessmentId: existing.assessment_id,
        });
        return publicInstance(existing, privateAssessment);
      }
      return registerAssessment({
        tenantId,
        studentId,
        sessionId,
        assessmentId: draft.assessment_id,
        requestId: teachingPackage.request_id,
      });
    }));
  }

  function grade(input = {}) {
    const instanceId = identifier(
      input.assessment_instance_id || input.assessmentInstanceId,
      "assessment_instance_id",
    );
    const instance = instances.get(instanceId);
    if (!instance) {
      throw runtimeError("assessment_instance_not_found", "题目实例不存在或已失效", 404);
    }
    assertScope(instance, input);
    const privateAssessment = learningRuntime.getPrivateAssessment({
      tenantId: instance.tenant_id,
      userId: instance.student_id,
      assessmentId: instance.assessment_id,
    });
    if (!privateAssessment) {
      throw runtimeError("assessment_private_key_not_found", "题目的服务端评分信息不存在", 404);
    }

    const submitted = normalizeSubmittedAnswer(input);
    const answerFingerprint = digest(JSON.stringify(submitted));
    const receiptKey = `${instanceId}:${answerFingerprint}`;
    if (gradingReceipts.has(receiptKey)) return gradingReceipts.get(receiptKey);

    const judgment = judge(privateAssessment, submitted);
    const receipt = deepFreeze({
      schema_version: "verified-grading-receipt@1.0",
      receipt_id: `grading:${digest(receiptKey).slice(0, 32)}`,
      evidence_ref: `grading:${digest(receiptKey).slice(0, 32)}`,
      verified: judgment.outcome !== "manual_review",
      source: "pi_learning_assessment_runtime",
      tenant_id: instance.tenant_id,
      user_id: instance.student_id,
      session_id: instance.session_id,
      assessment_instance_id: instanceId,
      assessment_id: instance.assessment_id,
      knowledge_point_ids: [...privateAssessment.knowledge_point_ids],
      outcome: judgment.outcome,
      score: judgment.score,
      max_score: 1,
      difficulty: privateAssessment.blueprint?.difficulty || "medium",
      cognitive_level: privateAssessment.blueprint?.cognitive_level || "apply",
      item_type: privateAssessment.blueprint?.item_type || "short_answer",
      hint_usage: normalizeHintUsage(input.hint_usage || input.hintUsage),
      submitted_at: safeTimestamp(now()),
    });
    gradingReceipts.set(receiptKey, receipt);
    return receipt;
  }

  return Object.freeze({ registerAssessment, registerTeachingPackage, grade });
}

function publicInstance(instance, privateAssessment) {
  return deepFreeze({
    schema_version: "assessment-instance@1.0",
    assessment_instance_id: instance.assessment_instance_id,
    assessment_id: instance.assessment_id,
    public_item: clone(privateAssessment.public_item),
    blueprint: clone(privateAssessment.blueprint),
    knowledge_point_ids: [...privateAssessment.knowledge_point_ids],
    created_at: instance.created_at,
  });
}

function assertScope(instance, input) {
  const student = identifier(input.student_id || input.studentId, "student_id");
  const session = identifier(input.session_id || input.sessionId, "session_id");
  if (student !== instance.student_id || session !== instance.session_id) {
    throw runtimeError("assessment_scope_mismatch", "题目实例不属于当前学生会话", 403);
  }
}

function normalizeSubmittedAnswer(input) {
  const selected = input.selected_option_ids || input.selectedOptionIds || input.selected;
  if (Array.isArray(selected)) {
    return Object.freeze({
      kind: "option_ids",
      values: Object.freeze([...new Set(selected.map((item) => identifier(item, "selected_option_ids")))].sort()),
    });
  }
  if (typeof selected === "string" && selected.trim()) {
    return Object.freeze({ kind: "option_ids", values: Object.freeze([identifier(selected, "selected")]) });
  }
  const raw = input.student_answer ?? input.studentAnswer ?? input.answer;
  const answer = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, MAX_RESPONSE_LENGTH);
  if (!answer) throw runtimeError("student_answer_required", "请先提交答案", 422);
  return Object.freeze({ kind: "text", value: answer });
}

function judge(privateAssessment, submitted) {
  const key = privateAssessment.private_key || {};
  if (submitted.kind === "option_ids" && Array.isArray(key.correct_option_ids)) {
    const expected = [...new Set(key.correct_option_ids.map(String))].sort();
    const correct = expected.length === submitted.values.length
      && expected.every((value, index) => value === submitted.values[index]);
    return { outcome: correct ? "correct" : "incorrect", score: correct ? 1 : 0 };
  }
  if (submitted.kind === "text" && Array.isArray(key.accepted_answers)) {
    const actual = comparable(submitted.value);
    const correct = key.accepted_answers.some((answer) => comparable(answer) === actual);
    return { outcome: correct ? "correct" : "incorrect", score: correct ? 1 : 0 };
  }
  return { outcome: "manual_review", score: null };
}

function normalizeHintUsage(value) {
  if (value === undefined || value === null) return 0;
  const result = Number(value);
  return Number.isInteger(result) ? Math.min(20, Math.max(0, result)) : 0;
}

function comparable(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "")
    .replace(/[，。；：、！？]/gu, "");
}

function identifier(value, field) {
  const result = String(value || "").trim();
  if (!result || result.length > 200 || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw runtimeError("assessment_input_invalid", `${field} is required`, 422);
  }
  return result;
}

function runtimeError(code, message, status) {
  const error = new Error(message);
  error.name = "PiAssessmentRuntimeError";
  error.code = code;
  error.status = status;
  return error;
}

function safeTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
