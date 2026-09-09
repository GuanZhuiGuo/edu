const CURRENT_STUDENT_KEY = "ai-classroom:current-student-id:v1";
const DEFAULT_ONTOLOGY_ID = "junior-math-moe-2022";

const state = {
  students: [],
  currentStudentId: "",
  profile: null,
  mastery: emptyMastery(),
  masteryHistory: emptyMasteryHistory(),
  learningEvents: { total: 0, items: [] },
  ontology: null,
  questions: { total: 0, items: [] },
  status: {
    bootstrap: "idle",
    students: "idle",
    student: "idle",
    masteryHistory: "idle",
    ontology: "idle",
    questions: "idle"
  },
  errors: {
    bootstrap: null,
    students: null,
    student: null,
    masteryHistory: null,
    ontology: null,
    questions: null
  }
};

let bootstrapPromise = null;
let studentLoadSequence = 0;

export class EducationDataClientError extends Error {
  constructor(message, { status = 0, code = "education_data_request_failed", cause } = {}) {
    super(message, { cause });
    this.name = "EducationDataClientError";
    this.status = status;
    this.code = code;
  }
}

export function getEducationDataSnapshot() {
  return clone(state);
}

export function getEducationStudents() {
  return clone(state.students);
}

export function getCurrentEducationStudentId() {
  return state.currentStudentId;
}

export function getCurrentEducationStudent() {
  return clone(state.students.find((student) => student.id === state.currentStudentId) || null);
}

export function getCurrentEducationProfile() {
  return clone(state.profile);
}

export function getCurrentEducationMastery() {
  return clone(state.mastery);
}

export function getCurrentEducationMasteryHistory() {
  return clone(state.masteryHistory);
}

export function getCurrentEducationEvents() {
  return clone(state.learningEvents);
}

export function getEducationOntology() {
  return clone(state.ontology);
}

export function getEducationQuestions() {
  return clone(state.questions);
}

export function getEducationDataStatus(scope = "bootstrap") {
  return state.status[scope] || "idle";
}

export function getEducationDataError(scope = "bootstrap") {
  return state.errors[scope] ? clone(state.errors[scope]) : null;
}

export async function bootstrapEducationData({ force = false } = {}) {
  if (!force && state.status.bootstrap === "ready") return getEducationDataSnapshot();
  if (bootstrapPromise && !force) return bootstrapPromise;
  bootstrapPromise = runBootstrap().finally(() => {
    bootstrapPromise = null;
  });
  return bootstrapPromise;
}

export async function selectEducationStudent(studentId) {
  const next = state.students.find((student) => student.id === String(studentId || ""));
  if (!next) throw new EducationDataClientError("学生不在当前可访问列表中", { code: "student_not_accessible" });
  const previousStudentId = state.currentStudentId;
  state.currentStudentId = next.id;
  writeCurrentStudentPreference(next.id);
  setLoading("student");
  clearStudentData({ keepStudentId: true });
  emit("learning-user:change", {
    userId: next.id,
    user: clone(next),
    previousUserId: previousStudentId || null,
    simulated: next.simulated,
    dataSource: "education-api"
  });
  await loadCurrentStudentData(next.id);
  return getEducationDataSnapshot();
}

export async function refreshCurrentEducationStudent() {
  if (!state.currentStudentId) return getEducationDataSnapshot();
  await loadCurrentStudentData(state.currentStudentId);
  return getEducationDataSnapshot();
}

export async function refreshEducationOntology(ontologyId = DEFAULT_ONTOLOGY_ID) {
  return loadOntology(ontologyId);
}

export async function refreshEducationQuestions(ontologyId = DEFAULT_ONTOLOGY_ID) {
  return loadQuestions(ontologyId);
}

async function runBootstrap() {
  state.status.bootstrap = "loading";
  state.errors.bootstrap = null;

  const studentsTask = loadStudents();
  const ontologyTask = loadOntology(DEFAULT_ONTOLOGY_ID);
  const questionsTask = loadQuestions(DEFAULT_ONTOLOGY_ID);
  await Promise.allSettled([studentsTask, ontologyTask, questionsTask]);

  if (state.students.length) {
    const preferred = readCurrentStudentPreference();
    const selected = state.students.find((student) => student.id === preferred) || state.students[0];
    state.currentStudentId = selected.id;
    writeCurrentStudentPreference(selected.id);
    await loadCurrentStudentData(selected.id).catch(() => null);
    emit("learning-user:change", {
      userId: selected.id,
      user: clone(selected),
      previousUserId: null,
      simulated: selected.simulated,
      initial: true,
      dataSource: "education-api"
    });
  } else {
    clearStudentData();
  }

  const hasAnyData = Boolean(state.students.length || state.ontology || state.questions.items.length);
  state.status.bootstrap = hasAnyData ? "ready" : "error";
  if (!hasAnyData) {
    state.errors.bootstrap = state.errors.students
      || state.errors.ontology
      || state.errors.questions
      || publicError(new EducationDataClientError("教育数据暂时不可用"));
  }
  const detail = getEducationDataSnapshot();
  emit("education-data:ready", detail);
  emit("data-ready", { source: "education-api", ...detail });
  return detail;
}

async function loadStudents() {
  setLoading("students");
  try {
    const payload = await requestJson("/api/education/students");
    if (!Array.isArray(payload?.items)) throw incompatible("学生列表协议不兼容");
    state.students = payload.items.map(normalizeStudent).filter(Boolean);
    setReady("students");
    return state.students;
  } catch (error) {
    state.students = [];
    setError("students", error);
    throw error;
  }
}

async function loadCurrentStudentData(studentId) {
  const sequence = ++studentLoadSequence;
  setLoading("student");
  clearStudentData({ keepStudentId: true });
  setLoading("masteryHistory");
  const encodedId = encodeURIComponent(studentId);
  const ontologyId = state.ontology?.ontology_id || DEFAULT_ONTOLOGY_ID;
  try {
    const historyRequest = requestJson(`/api/education/students/${encodedId}/mastery-history?ontology_id=${encodeURIComponent(ontologyId)}&limit=1000`)
      .then((payload) => ({ payload, error: null }))
      .catch((error) => ({ payload: null, error }));
    const [profile, mastery, learningEvents, historyResult] = await Promise.all([
      requestJson(`/api/education/students/${encodedId}`),
      requestJson(`/api/education/students/${encodedId}/mastery?ontology_id=${encodeURIComponent(ontologyId)}&limit=1000`),
      requestJson(`/api/education/students/${encodedId}/learning-events?limit=100`),
      historyRequest
    ]);
    if (sequence !== studentLoadSequence || state.currentStudentId !== studentId) return null;
    if (!profile || profile.student_id !== studentId) throw incompatible("学生档案协议不兼容");
    if (!Array.isArray(mastery?.items)) throw incompatible("掌握度协议不兼容");
    if (!Array.isArray(learningEvents?.items)) throw incompatible("学习记录协议不兼容");
    state.profile = normalizeProfile(profile);
    state.mastery = normalizeMastery(mastery);
    if (historyResult.error) {
      state.masteryHistory = emptyMasteryHistory(studentId, ontologyId);
      setError("masteryHistory", historyResult.error);
    } else {
      state.masteryHistory = normalizeMasteryHistory(historyResult.payload, { studentId, ontologyId });
      setReady("masteryHistory");
    }
    state.learningEvents = {
      student_id: studentId,
      total: Number(learningEvents.total || 0),
      items: learningEvents.items.map(normalizeLearningEvent).filter(Boolean)
    };
    setReady("student");
    emit("learning-user:data-change", {
      userId: studentId,
      kind: "database-refresh",
      simulated: state.profile.simulated,
      dataSource: "education-api"
    });
    return state.profile;
  } catch (error) {
    if (sequence !== studentLoadSequence) return null;
    clearStudentData({ keepStudentId: true });
    setError("student", error);
    setError("masteryHistory", error);
    emit("learning-user:data-change", {
      userId: studentId,
      kind: "database-error",
      error: publicError(error),
      dataSource: "education-api"
    });
    throw error;
  }
}

async function loadOntology(ontologyId) {
  setLoading("ontology");
  try {
    const payload = await requestJson(`/api/education/ontologies/${encodeURIComponent(ontologyId)}/graph?include_questions=true&question_limit=500`);
    state.ontology = adaptOntologyGraph(payload);
    setReady("ontology");
    emit("education-data:ontology", { ontology: clone(state.ontology) });
    return state.ontology;
  } catch (error) {
    state.ontology = null;
    setError("ontology", error);
    throw error;
  }
}

async function loadQuestions(ontologyId) {
  setLoading("questions");
  try {
    const payload = await requestJson(`/api/education/questions?ontology_id=${encodeURIComponent(ontologyId)}&limit=1000`);
    if (!Array.isArray(payload?.items)) throw incompatible("题库协议不兼容");
    state.questions = {
      total: Number(payload.total || 0),
      limit: Number(payload.limit || payload.items.length),
      offset: Number(payload.offset || 0),
      items: payload.items
    };
    setReady("questions");
    emit("education-data:questions", { questions: clone(state.questions) });
    return state.questions;
  } catch (error) {
    state.questions = { total: 0, items: [] };
    setError("questions", error);
    throw error;
  }
}

export function adaptOntologyGraph(payload = {}) {
  if (!payload?.ontology || !Array.isArray(payload.entities) || !Array.isArray(payload.relations)) {
    throw incompatible("知识本体协议不兼容");
  }
  const entities = payload.entities.map((entity) => ({
    ...(isPlainObject(entity.properties) ? entity.properties : {}),
    id: String(entity.id || ""),
    entity_kind: String(entity.entity_kind || ""),
    entity_class: String(entity.entity_class || ""),
    name: String(entity.name || ""),
    description: String(entity.description || ""),
    aliases: Array.isArray(entity.aliases) ? entity.aliases.map(String) : [],
    source_ref: isPlainObject(entity.source_ref) ? entity.source_ref : {},
    review_status: String(entity.review_status || "")
  }));
  const relations = payload.relations.map((relation) => ({
    ...(isPlainObject(relation.properties) ? relation.properties : {}),
    id: String(relation.id || ""),
    source: String(relation.source || ""),
    target: String(relation.target || ""),
    type: String(relation.type || ""),
    directed: relation.directed !== false,
    review_status: String(relation.review_status || "")
  }));
  const parentByEntityId = new Map(
    relations.filter((relation) => relation.type === "part_of").map((relation) => [relation.source, relation.target])
  );
  const domains = entities
    .filter((entity) => entity.entity_kind === "domain")
    .map(({ entity_kind, entity_class, ...entity }) => entity);
  const themes = entities
    .filter((entity) => entity.entity_kind === "theme")
    .map(({ entity_kind, entity_class, ...entity }) => ({
      ...entity,
      domain_id: entity.domain_id || parentByEntityId.get(entity.id) || ""
    }));
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));
  const knowledgePoints = entities
    .filter((entity) => entity.entity_kind === "knowledge_point")
    .map(({ entity_kind, description, ...entity }) => {
      const themeId = entity.theme_id || parentByEntityId.get(entity.id) || "";
      return {
        ...entity,
        entity_class: entity.entity_class,
        measurable_behavior: description,
        description,
        theme_id: themeId,
        domain_id: entity.domain_id || themeById.get(themeId)?.domain_id || ""
      };
    });
  return {
    ...payload.ontology,
    schema_version: payload.ontology.schema_version || "education-ontology-graph@1.0",
    domains,
    themes,
    knowledge_points: knowledgePoints,
    edges: relations,
    question_nodes: Array.isArray(payload.question_nodes) ? payload.question_nodes : [],
    question_relations: Array.isArray(payload.question_relations) ? payload.question_relations : [],
    entity_classes: Array.isArray(payload.entity_classes) ? payload.entity_classes : [],
    relation_types: Array.isArray(payload.relation_types) ? payload.relation_types : []
  };
}

function normalizeStudent(value) {
  const id = String(value?.student_id || "").trim();
  if (!id) return null;
  return {
    id,
    student_id: id,
    name: String(value.name || id),
    grade: String(value.grade || ""),
    goal: String(value.goal || ""),
    avatar: String(value.avatar || value.name || id).slice(0, 1),
    simulated: value.is_demo === true,
    is_demo: value.is_demo === true,
    color: String(value.profile?.color || "blue"),
    profile: isPlainObject(value.profile) ? value.profile : {},
    mastery_summary: isPlainObject(value.mastery_summary) ? value.mastery_summary : null,
    active: value.active !== false,
    updated_at: value.updated_at || null
  };
}

function normalizeProfile(value) {
  const student = normalizeStudent(value);
  return student ? {
    ...student,
    mastery_summary: isPlainObject(value.mastery_summary) ? value.mastery_summary : null,
    recent_learning_events: Array.isArray(value.recent_learning_events)
      ? value.recent_learning_events.map(normalizeLearningEvent).filter(Boolean)
      : []
  } : null;
}

function normalizeMastery(value) {
  return {
    student_id: String(value.student_id || ""),
    ontology_id: String(value.ontology_id || DEFAULT_ONTOLOGY_ID),
    ontology_version: String(value.ontology_version || ""),
    total: Number(value.total || 0),
    records: value.items.map((record) => ({
      ...record,
      mastery_probability: record.mastery_probability == null ? null : Number(record.mastery_probability),
      confidence: Number(record.confidence || 0),
      evidence_count: Number(record.evidence_count || 0)
    }))
  };
}

function normalizeMasteryHistory(value, { studentId = "", ontologyId = DEFAULT_ONTOLOGY_ID } = {}) {
  const source = isPlainObject(value) ? value : {};
  const rawItems = Array.isArray(source.items)
    ? source.items
    : Array.isArray(source.events)
      ? source.events
      : [];
  const items = rawItems.map(normalizeMasteryHistoryItem).filter(Boolean);
  return {
    student_id: String(source.student_id || studentId),
    ontology_id: String(source.ontology_id || ontologyId),
    ontology_version: String(source.ontology_version || ""),
    total: Number(source.total ?? items.length),
    summary: isPlainObject(source.summary)
      ? clone(source.summary)
      : isPlainObject(source.current)
        ? clone(source.current)
        : null,
    policy: normalizeMasteryHistoryPolicy(source.policy || source.calculation || source.calculation_rules),
    history_mode: String(source.history_mode || ""),
    items
  };
}

function normalizeMasteryHistoryItem(value) {
  if (!isPlainObject(value)) return null;
  const knowledgePoint = isPlainObject(value.knowledge_point) ? value.knowledge_point : {};
  const context = isPlainObject(value.context) ? value.context : {};
  const before = isPlainObject(value.before) ? value.before : {};
  const after = isPlainObject(value.after) ? value.after : {};
  const projectionDelta = isPlainObject(value.projection_delta)
    ? value.projection_delta
    : isPlainObject(value.delta)
      ? value.delta
      : {};
  const knowledgePointId = String(knowledgePoint.id || value.knowledge_point_id || "");
  const knowledgePointName = String(knowledgePoint.name || value.knowledge_point_name || "");
  if (!knowledgePointId && !knowledgePointName) return null;
  const hasProjectionDecision = typeof value.included_in_current_projection === "boolean";
  return {
    knowledge_point: { id: knowledgePointId, name: knowledgePointName },
    title: String(value.question_title || value.title || context.title || ""),
    description: String(value.description || context.description || ""),
    occurred_at: value.occurred_at || null,
    evidence_type: String(value.evidence_type || ""),
    evidence_class: String(value.evidence_class || ""),
    source_type: String(value.source_type || ""),
    outcome: String(value.outcome || ""),
    difficulty: String(value.difficulty || context.difficulty || ""),
    hints_used: nullableNumber(value.hints_used ?? context.hints_used),
    duration_ms: nullableNumber(value.duration_ms ?? context.duration_ms),
    effective_score: nullableNumber(value.effective_score),
    effective_weight: nullableNumber(value.effective_weight),
    before_probability: nullableNumber(value.before_probability ?? before.mastery_probability),
    after_probability: nullableNumber(value.after_probability ?? after.mastery_probability),
    delta: nullableNumber(
      isPlainObject(value.delta)
        ? value.delta.mastery_probability
        : value.delta ?? projectionDelta.mastery_probability
    ),
    before_state: String(value.before_state || before.mastery_state || ""),
    after_state: String(value.after_state || after.mastery_state || ""),
    apply_to_mastery: hasProjectionDecision
      ? value.included_in_current_projection === true
      : value.apply_to_mastery === true,
    eligible_for_projection: value.eligible_for_projection === true
  };
}

function normalizeMasteryHistoryPolicy(value) {
  if (!isPlainObject(value)) return null;
  const envelope = value;
  const policy = isPlainObject(envelope.policy) ? envelope.policy : envelope;
  return {
    config_version: nullableNumber(envelope.config_version ?? policy.config_version),
    algorithm: String(policy.algorithm || envelope.algorithm || ""),
    enabled: policy.enabled !== false,
    thresholds: numericObject(policy.thresholds),
    outcome_scores: numericObject(policy.outcome_scores),
    difficulty_weights: numericObject(policy.difficulty_weights),
    source_weights: numericObject(policy.source_weights),
    evidence_class_weights: numericObject(policy.evidence_class_weights),
    hint_adjustment: numericObject(policy.hint_adjustment),
    duration_adjustment: isPlainObject(policy.duration_adjustment) ? clone(policy.duration_adjustment) : {},
    forgetting: isPlainObject(policy.forgetting) ? clone(policy.forgetting) : {},
    confidence: numericObject(policy.confidence),
    authority: isPlainObject(envelope.authority)
      ? clone(envelope.authority)
      : String(envelope.authority || policy.authority || "")
  };
}

function numericObject(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const number = Number(item);
    return Number.isFinite(number) ? [[key, number]] : [];
  }));
}

function nullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLearningEvent(value) {
  if (!value || !value.event_id) return null;
  return {
    event_id: String(value.event_id),
    event_type: String(value.event_type || "learning_event"),
    title: String(value.title || "学习记录"),
    description: String(value.description || ""),
    source_type: String(value.source_type || ""),
    source_ref: String(value.source_ref || ""),
    payload: isPlainObject(value.payload) ? value.payload : {},
    occurred_at: value.occurred_at || null,
    created_at: value.created_at || null
  };
}

async function requestJson(url, { signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal
    });
  } catch (error) {
    throw new EducationDataClientError("无法连接教育数据服务", {
      code: "education_data_unreachable",
      cause: error
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new EducationDataClientError(payload.message || `教育数据读取失败（${response.status}）`, {
      status: response.status,
      code: payload.error || "education_data_request_failed"
    });
  }
  return payload;
}

function clearStudentData({ keepStudentId = false } = {}) {
  state.profile = null;
  state.mastery = emptyMastery(keepStudentId ? state.currentStudentId : "");
  state.masteryHistory = emptyMasteryHistory(
    keepStudentId ? state.currentStudentId : "",
    state.mastery?.ontology_id || DEFAULT_ONTOLOGY_ID
  );
  state.learningEvents = { student_id: keepStudentId ? state.currentStudentId : "", total: 0, items: [] };
  if (!keepStudentId) state.currentStudentId = "";
}

function emptyMastery(studentId = "") {
  return {
    student_id: studentId,
    ontology_id: DEFAULT_ONTOLOGY_ID,
    ontology_version: "",
    total: 0,
    records: []
  };
}

function emptyMasteryHistory(studentId = "", ontologyId = DEFAULT_ONTOLOGY_ID) {
  return {
    student_id: studentId,
    ontology_id: ontologyId,
    ontology_version: "",
    total: 0,
    summary: null,
    policy: null,
    history_mode: "",
    items: []
  };
}

function setLoading(scope) {
  state.status[scope] = "loading";
  state.errors[scope] = null;
}

function setReady(scope) {
  state.status[scope] = "ready";
  state.errors[scope] = null;
}

function setError(scope, error) {
  state.status[scope] = "error";
  state.errors[scope] = publicError(error);
}

function publicError(error) {
  return {
    code: String(error?.code || "education_data_request_failed"),
    status: Number(error?.status || 0),
    message: String(error?.message || "教育数据读取失败")
  };
}

function incompatible(message) {
  return new EducationDataClientError(message, { code: "education_data_protocol_incompatible" });
}

function readCurrentStudentPreference() {
  try {
    return String(globalThis.localStorage?.getItem(CURRENT_STUDENT_KEY) || "");
  } catch {
    return "";
  }
}

function writeCurrentStudentPreference(studentId) {
  try {
    globalThis.localStorage?.setItem(CURRENT_STUDENT_KEY, String(studentId || ""));
  } catch {
    // The in-memory selection remains authoritative for this page session.
  }
}

function emit(type, detail) {
  if (typeof document === "undefined" || typeof CustomEvent !== "function") return;
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const publicApi = Object.freeze({
  bootstrap: bootstrapEducationData,
  selectStudent: selectEducationStudent,
  refreshCurrentStudent: refreshCurrentEducationStudent,
  refreshOntology: refreshEducationOntology,
  refreshQuestions: refreshEducationQuestions,
  getSnapshot: getEducationDataSnapshot,
  getStudents: getEducationStudents,
  getCurrentStudentId: getCurrentEducationStudentId,
  getCurrentStudent: getCurrentEducationStudent,
  getProfile: getCurrentEducationProfile,
  getMastery: getCurrentEducationMastery,
  getMasteryHistory: getCurrentEducationMasteryHistory,
  getLearningEvents: getCurrentEducationEvents,
  getOntology: getEducationOntology,
  getQuestions: getEducationQuestions,
  getStatus: getEducationDataStatus,
  getError: getEducationDataError
});

if (typeof globalThis !== "undefined") globalThis.EducationDataClient = publicApi;
