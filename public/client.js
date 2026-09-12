import {
  COMMON_CONVERSATION_RULES,
  DEFAULT_INDUSTRY,
  FAST_CONVERSATION_RULES,
  getIndustryPreset
} from "./industry-presets.js";
import { A2UIRenderer } from "./a2ui-renderer.js";
import { initCardLibrary } from "./card-library.js";
import { initKnowledgeMaterialStudio } from "./knowledge-material-studio.js";
import { initInteractiveLessonLab } from "./interactive-lesson-lab.js";
import { initTechnologyLandscape } from "./technology-landscape.js";
import { initLearningWorkbench } from "./learning-workbench.js";
import { initEducationSettingsWorkbench } from "./education-settings-workbench.js";
import { initEducationSkillWorkbench } from "./education-skill-workbench.js";
import { initOntologyWorkbench } from "./ontology-workbench.js";
import { initSystemReleaseCenter } from "./system-release-center.js";
import { initVideoExplanationWorkbench } from "./video-explanation-workbench.js";
import { mountCoursewareAssistant } from "./courseware-assistant.js";
import { mountCoursewareLibrary } from "./courseware-library.js";
import { mountSkillHub } from "./skill-hub.js";
import { initAssessmentWorkbench } from "./assessment-workbench.js";
import { initLearningBuddyCommunity } from "./learning-buddy-community.js";
import { PLATFORM_CONTEXT } from "./platform-context.js";
import { consumeAgentNdjsonResponse } from "./agent-stream-protocol.js";
import { consumeTextSpeechNdjson } from "./volcengine-text-speech-client.js";
import {
  mountAgentAnswerAttribution,
  mountAgentExternalRichResults,
  normalizeAgentAnswerAttribution,
  normalizeAgentExternalRichResults,
  renderAgentAnswer as renderStructuredAgentAnswer
} from "./agent-answer-renderer.js";
import { mountHomeworkMark } from "./homework-mark-renderer.js";
import {
  buildImageTaskChoicePrompt,
  normalizeImageTaskChoice,
  normalizeImageTaskClarification,
  questionImageAttachmentFromDataUrl
} from "./image-task-clarification.js";
import { createVoiceTurnDetector } from "./voice-turn-detector.js";
import {
  normalizeAgentTraceEvent,
  syncAgentTraceView
} from "./agent-trace-view.js";
import {
  inferLocalKnowledgeVisualMode,
  isLocalKnowledgeFollowUpQuery,
  loadLocalKnowledgeVisualCatalog,
  mountLocalKnowledgeVisual,
  resolveLocalKnowledgeVisual
} from "./local-knowledge-visuals.js";
import {
  getPortalRole,
  getPortalWorkspacePresentation,
  initPortalRuntime,
  resolvePortalWorkspace
} from "./portal-runtime.js";
import { refreshCurrentEducationStudent } from "./education-data-client.js";
import { getComposerAttachmentController } from "./composer-attachments.js";

document.documentElement.dataset.platformProfile = PLATFORM_CONTEXT.activeProfile;

const els = {
  status: document.querySelector("#status"),
  industryInputs: [...document.querySelectorAll('input[name="industry"]')],
  industryProfileTitle: document.querySelector("#industryProfileTitle"),
  industryProfileSummary: document.querySelector("#industryProfileSummary"),
  industryModeBadge: document.querySelector("#industryModeBadge"),
  activeIndustry: document.querySelector("#activeIndustry"),
  apiKey: document.querySelector("#apiKey"),
  runtimeEndpoint: document.querySelector("#runtimeEndpoint"),
  model: document.querySelector("#model"),
  sessionId: document.querySelector("#sessionId"),
  voice: document.querySelector("#voice"),
  speed: document.querySelector("#speed"),
  speedNumber: document.querySelector("#speedNumber"),
  loudness: document.querySelector("#loudness"),
  loudnessNumber: document.querySelector("#loudnessNumber"),
  openingText: document.querySelector("#openingText"),
  personaBasePrompt: document.querySelector("#personaBasePrompt"),
  personaBackgroundPrompt: document.querySelector("#personaBackgroundPrompt"),
  personaStylePrompt: document.querySelector("#personaStylePrompt"),
  salesPlaybookPrompt: document.querySelector("#salesPlaybookPrompt"),
  instructions: document.querySelector("#instructions"),
  connectBtn: document.querySelector("#connectBtn"),
  updateSessionBtn: document.querySelector("#updateSessionBtn"),
  talkBtn: document.querySelector("#talkBtn"),
  forceCommitBtn: document.querySelector("#forceCommitBtn"),
  interruptBtn: document.querySelector("#interruptBtn"),
  closeBtn: document.querySelector("#closeBtn"),
  activeSessionId: document.querySelector("#activeSessionId"),
  activeOutputFormat: document.querySelector("#activeOutputFormat"),
  textQuestion: document.querySelector("#textQuestion"),
  textQuestionBtn: document.querySelector("#textQuestionBtn"),
  teacherAttachmentInput: document.querySelector("#teacherAttachmentInput"),
  teacherAsrBtn: document.querySelector("#teacherAsrBtn"),
  teacherSpeechStatus: document.querySelector("#teacherSpeechStatus"),
  loadedLearningMaterials: document.querySelector("#loadedLearningMaterials"),
  loadedLearningMaterialsLabel: document.querySelector("#loadedLearningMaterialsLabel"),
  loadedLearningMaterialsList: document.querySelector("#loadedLearningMaterialsList"),
  classroomLearningScopeName: document.querySelector("#classroomLearningScopeName"),
  classroomLearningScopeMeta: document.querySelector("#classroomLearningScopeMeta"),
  activeCurriculumName: document.querySelector("#activeCurriculumName"),
  activeCurriculumMeta: document.querySelector("#activeCurriculumMeta"),
  replacementText: document.querySelector("#replacementText"),
  replacementAppendBtn: document.querySelector("#replacementAppendBtn"),
  replacementCommitBtn: document.querySelector("#replacementCommitBtn"),
  clearLogBtn: document.querySelector("#clearLogBtn"),
  meterBar: document.querySelector("#meterBar"),
  partialTranscript: document.querySelector("#partialTranscript"),
  assistantText: document.querySelector("#assistantText"),
  agentAvatar: document.querySelector("#agentAvatar"),
  listenState: document.querySelector("#listenState"),
  callToolbar: document.querySelector(".call-toolbar"),
  callToolbarState: document.querySelector("#callToolbarState"),
  userMessageRow: document.querySelector("#userMessageRow"),
  liveUserMessage: document.querySelector("#liveUserMessage"),
  assistantMessageRow: document.querySelector("#assistantMessageRow"),
  voiceUserSubtitle: document.querySelector("#voiceUserSubtitle"),
  voiceAssistantSubtitle: document.querySelector("#voiceAssistantSubtitle"),
  conversationLog: document.querySelector("#conversationLog"),
  studentTurnTemplate: document.querySelector("#studentConversationTurnTemplate"),
  teacherTurnTemplate: document.querySelector("#teacherConversationTurnTemplate"),
  learningContentMount: document.querySelector("#learningContentMount"),
  toolLog: document.querySelector("#toolLog"),
  eventLog: document.querySelector("#eventLog"),
  a2uiPanel: document.querySelector("#a2uiPanel"),
  a2uiSurfaceTitle: document.querySelector("#a2uiSurfaceTitle"),
  a2uiSourceBadge: document.querySelector("#a2uiSourceBadge"),
  a2uiSurfaceRoot: document.querySelector("#a2uiSurfaceRoot"),
  a2uiEventCount: document.querySelector("#a2uiEventCount"),
  a2uiEventLog: document.querySelector("#a2uiEventLog"),
  a2uiClearBtn: document.querySelector("#a2uiClearBtn"),
  a2uiPreviewBtn: document.querySelector("#a2uiPreviewBtn"),
  editorScroll: document.querySelector(".editor-scroll"),
  knowledgeFile: document.querySelector("#knowledgeFile"),
  knowledgeFilePickerBtn: document.querySelector("#knowledgeFilePickerBtn"),
  knowledgeFileName: document.querySelector("#knowledgeFileName"),
  knowledgeSourceText: document.querySelector("#knowledgeSourceText"),
  knowledgeCompileBtn: document.querySelector("#knowledgeCompileBtn"),
  knowledgeCompileStatus: document.querySelector("#knowledgeCompileStatus"),
  knowledgeArtifactList: document.querySelector("#knowledgeArtifactList"),
  knowledgeCatalogBtn: document.querySelector("#knowledgeCatalogBtn"),
  knowledgeCatalogPanel: document.querySelector("#knowledgeCatalogPanel"),
  knowledgeCatalogCloseBtn: document.querySelector("#knowledgeCatalogCloseBtn"),
  knowledgeCatalogStatus: document.querySelector("#knowledgeCatalogStatus"),
  knowledgeCatalogSummary: document.querySelector("#knowledgeCatalogSummary"),
  knowledgeClaimsList: document.querySelector("#knowledgeClaimsList"),
  knowledgeEvidenceList: document.querySelector("#knowledgeEvidenceList"),
  knowledgeMaterialsList: document.querySelector("#knowledgeMaterialsList"),
  knowledgeAssessmentList: document.querySelector("#knowledgeAssessmentList"),
  knowledgeMetadataJson: document.querySelector("#knowledgeMetadataJson"),
  workspaceBreadcrumb: document.querySelector("#workspaceBreadcrumb"),
  workspaceTitle: document.querySelector("#workspaceTitle"),
  workspaceTypeChip: document.querySelector("#workspaceTypeChip"),
  teacherSuggestionButtons: [...document.querySelectorAll("[data-teacher-question]")],
  teacherShortcutButtons: [...document.querySelectorAll("[data-teacher-shortcut]")],
  englishPracticePicker: document.querySelector("#englishPracticePicker"),
  englishPracticePickerClose: document.querySelector("#englishPracticePickerClose"),
  englishPracticeButtons: [...document.querySelectorAll("[data-speaking-practice-level]")],
  teacherVoiceModeBtn: document.querySelector("#teacherVoiceModeBtn"),
  teacherVoicePanelCloseBtn: document.querySelector("#teacherVoicePanelCloseBtn"),
  teacherVoiceOverlayTitle: document.querySelector("#teacherVoiceOverlayTitle"),
  teacherVoiceOverlaySubtitle: document.querySelector("#teacherVoiceOverlaySubtitle"),
  teacherConversationContext: document.querySelector("#teacherConversationContext"),
  workspaceMenuButtons: [...document.querySelectorAll("[data-workspace-view]")],
  workspacePanels: [...document.querySelectorAll("[data-workspace-panel]")],
  cardLibraryRoot: document.querySelector("#cardLibraryRoot"),
  keyboardBtn: document.querySelector("#keyboardBtn"),
  textInputSheet: document.querySelector("#textInputSheet"),
  textInputCloseBtn: document.querySelector("#textInputCloseBtn"),
  voicePrimaryBtn: document.querySelector("#voicePrimaryBtn"),
  voicePrimaryLabel: document.querySelector("#voicePrimaryLabel")
};

let ws;
let mediaStream;
let audioContext;
let inputNode;
let sourceNode;
let sampleAccumulator = [];
let recording = false;
let keepAliveTimer = null;
const VOICE_CONNECT_TIMEOUT_MS = 12_000;
const MICROPHONE_PERMISSION_TIMEOUT_MS = 10_000;
const TEXT_AGENT_RESPONSE_START_TIMEOUT_MS = 20_000;
let connectPromise = null;
let connectResolve = null;
let connectReject = null;
let connectTimeoutId = null;
let voiceStartPromise = null;
let voiceStartSequence = 0;
let pendingMediaStream = null;
let voiceTurnDetector = null;
let voiceTurnCommitted = false;
let continuousVoice = false;
const disposedVoiceErrors = new WeakSet();
let assistantBuffer = "";
const assistantTextStreamState = {
  responseId: "",
  buffers: {
    audio_transcript: "",
    output_text: "",
    unknown: ""
  },
  done: {
    audio_transcript: false,
    output_text: false,
    unknown: false
  }
};
let assistantProjectionFallback = "";
const ASSISTANT_SUBTITLE_TICK_MS = 80;
const DEFAULT_SPEECH_UNITS_PER_SECOND = 5;
const assistantSubtitleState = {
  responseId: "",
  fullText: "",
  capacity: null,
  observedWidth: 0,
  textDone: false,
  audioDone: false,
  audioStartAt: null,
  audioEndAt: null,
  spokenCursor: 0,
  anchor: 0,
  timerId: null
};
const graphemeSegmenter =
  typeof Intl?.Segmenter === "function"
    ? new Intl.Segmenter("zh-CN", { granularity: "grapheme" })
    : null;
let sessionReady = false;
let currentIndustry = DEFAULT_INDUSTRY;
let lastUserQuery = "";
let lastAssistantResponse = "";
let lastA2UIResponseId = "";
let activeEducationQuestionId = "";
let a2uiEventTotal = 0;
let autoStartVoiceAfterConnect = false;
let pendingOpeningSubtitle = "";
let pendingVoiceUpdateLabel = "";
const textAgentState = {
  activeSessionId: "session-1",
  conversations: new Map(),
  histories: new Map(),
  continuationContexts: new Map(),
  pendingGradeCards: new Set(),
  controller: null,
  requestSequence: 0,
  nextTurnId: 1,
  activeTurn: null,
  abortReason: "",
  userId: getOrCreateTextAgentUserId()
};
const localVisualControllers = new WeakMap();
const WRONG_QUESTION_STORAGE_KEY = "ai-classroom:wrong-question-notes";
const ENGLISH_PRACTICE_SCENES_URL = "./data/english-speaking-practice-scenes.json";
let knowledgeCatalogLoaded = false;
let englishPracticeCatalogRequest = null;
let masteryCatalogRequest = null;
let activeEnglishPracticeScene = null;
let selectedCurriculumKnowledgePointId = "";
let selectedCurriculumKnowledgePointLabel = "";
let activeLearningScope = null;
let learningScopeStatus = "idle";
let learningScopeError = null;
let learningScopeRequestSequence = 0;
window.AITeacherLearningScope = Object.freeze({ getSnapshot: getLearningScopeSnapshot });
let voiceUserTranscriptBuffer = "";
const voiceSubtitleRenderState = {
  user: { frameId: 0, text: "", state: "idle" },
  assistant: { frameId: 0, text: "", state: "idle" }
};
const englishPracticeScenesById = new Map();
const knowledgePickerState = {
  pending: false,
  scrollTop: 0
};
const industryDrafts = {};
const a2uiTelemetryTimers = new Map();
let playback = {
  audioContext: null,
  nextTime: 0,
  sources: new Set(),
  stoppedSources: new WeakSet()
};
let conversationScrollFrame = 0;
let pendingConversationScroll = null;
const textSpeechState = {
  mode: "idle",
  recognition: null,
  asrBaseText: "",
  asrFinalText: "",
  controller: null,
  playbackId: "",
  requestSequence: 0,
  activeButton: null,
  sources: new Set(),
  nextTime: 0,
  upstreamDone: false,
  receivedAudio: false
};
const homeworkMarkControllers = new WeakMap();
const a2uiRenderer = new A2UIRenderer(els.a2uiSurfaceRoot, {
  onEvent: handleA2UIInteraction,
  onError: (error) => {
    logEvent("a2ui.validation.error", error);
    setStatus("内容展示失败，请重试", true);
  }
});

els.connectBtn.addEventListener("click", () => {
  void connect().catch(handleVoiceConnectionError);
});
els.updateSessionBtn.addEventListener("click", updateSession);
els.talkBtn.addEventListener("click", toggleTalk);
els.forceCommitBtn.addEventListener("click", forceCommit);
els.interruptBtn.addEventListener("click", interrupt);
els.closeBtn.addEventListener("click", closeSession);
els.voicePrimaryBtn?.addEventListener("click", handleVoicePrimaryAction);
els.keyboardBtn?.addEventListener("click", () => setTextInputSheet(true));
els.textInputCloseBtn?.addEventListener("click", () => setTextInputSheet(false));
els.teacherAsrBtn?.addEventListener("click", toggleComposerAsr);
els.textQuestionBtn.addEventListener("click", sendTextQuestion);
els.textQuestion?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void sendTextQuestion();
});
els.textQuestion?.addEventListener("input", () => {
  if (!selectedCurriculumKnowledgePointLabel) return;
  if (!els.textQuestion.value.includes(`@${selectedCurriculumKnowledgePointLabel}`)) {
    clearSelectedCurriculumKnowledgePoint();
  }
});
document.addEventListener("ai-teacher:conversation-change", (event) => {
  const sessionId = normalizeClientSessionId(event.detail?.sessionId);
  if (!sessionId) return;
  clearSelectedCurriculumKnowledgePoint();
  textAgentState.controller?.abort();
  textAgentState.controller = null;
  textAgentState.activeSessionId = sessionId;
  const scopedSessionId = getTextAgentSessionKey(sessionId);
  if (event.detail?.reset === true) {
    textAgentState.conversations.delete(scopedSessionId);
    textAgentState.histories.delete(scopedSessionId);
  }
  const continuationContext = normalizeTextAgentContinuationContext(event.detail?.continuationContext);
  if (continuationContext) textAgentState.continuationContexts.set(scopedSessionId, continuationContext);
  else if (event.detail?.reset === true) textAgentState.continuationContexts.delete(scopedSessionId);
  lastUserQuery = "";
  lastAssistantResponse = "";
  lastA2UIResponseId = "";
  activeEducationQuestionId = "";
  assistantBuffer = "";
  resetAssistantTextStreams();
  resetAssistantSubtitle();
  // The card renderer is a single trusted surface. Never carry a previous
  // conversation's cards or grading context into the newly selected session.
  clearA2UI();
  renderTextConversationHistory(sessionId);
  syncTextSendDisabled();
});
document.addEventListener("learning-user:change", (event) => {
  stopTextSpeech({ abortAsr: true });
  clearSelectedCurriculumKnowledgePoint();
  const nextUserId = normalizeClientSessionId(event.detail?.userId);
  if (!nextUserId || nextUserId === textAgentState.userId) return;
  masteryCatalogRequest = null;
  textAgentState.requestSequence += 1;
  textAgentState.controller?.abort();
  textAgentState.controller = null;
  textAgentState.activeTurn = null;
  textAgentState.userId = nextUserId;
  textAgentState.continuationContexts.clear();
  try {
    sessionStorage.setItem("ai-classroom:user-id", nextUserId);
  } catch {
    // The active UI profile remains the source of truth if storage is unavailable.
  }
  lastUserQuery = "";
  lastAssistantResponse = "";
  lastA2UIResponseId = "";
  activeEducationQuestionId = "";
  assistantBuffer = "";
  resetAssistantTextStreams();
  resetAssistantSubtitle();
  clearA2UI();
  renderTextConversationHistory(textAgentState.activeSessionId);
  setStatus(`已切换到${String(event.detail?.user?.name || "当前用户")}`);
  syncTextSendDisabled();
});
document.addEventListener("portal-role:change", (event) => {
  stopTextSpeech({ abortAsr: true });
  clearSelectedCurriculumKnowledgePoint();
  const nextRole = event.detail?.role === "teacher" ? "teacher" : "student";
  textAgentState.requestSequence += 1;
  textAgentState.controller?.abort();
  textAgentState.controller = null;
  textAgentState.activeTurn = null;
  lastUserQuery = "";
  lastAssistantResponse = "";
  lastA2UIResponseId = "";
  activeEducationQuestionId = "";
  assistantBuffer = "";
  resetAssistantTextStreams();
  resetAssistantSubtitle();
  clearA2UI();
  renderTextConversationHistory(textAgentState.activeSessionId);
  setStatus(nextRole === "teacher" ? "课堂预览不会写入学生记录" : "已返回个人学习空间");
  syncTextSendDisabled();
});
document.addEventListener("ai-teacher:conversation-will-change", (event) => {
  const sessionId = normalizeClientSessionId(event.detail?.sessionId);
  if (!textAgentState.controller || sessionId !== textAgentState.activeSessionId) return;
  textAgentState.requestSequence += 1;
  textAgentState.controller.abort();
  textAgentState.controller = null;
  els.textQuestionBtn.removeAttribute("aria-busy");
  cancelActiveTextConversationTurn("本次回复已取消");
  setStatus("已取消当前回复");
  syncTextSendDisabled();
});
document.addEventListener("classroom-curriculum:select", (event) => {
  selectedCurriculumKnowledgePointId = String(event.detail?.nodeId || "").trim();
  selectedCurriculumKnowledgePointLabel = String(event.detail?.label || "").trim();
});
document.addEventListener("learning-course:change", () => {
  clearSelectedCurriculumKnowledgePoint();
  stopTextSpeech({ abortAsr: true });
  void loadLearningAgentScope();
});
document.addEventListener("ai-teacher:homework-mark", handleHomeworkMarkEvent);
window.addEventListener("beforeunload", () => stopTextSpeech({ abortAsr: true }));
els.a2uiPreviewBtn.addEventListener("click", () => {
  setTextInputSheet(false);
  renderA2UIForTurn({ force: true });
});
els.a2uiClearBtn.addEventListener("click", clearA2UI);
els.knowledgeCompileBtn?.addEventListener("click", compileKnowledgeSource);
els.knowledgeFilePickerBtn?.addEventListener("click", openKnowledgeFilePicker);
els.knowledgeFile?.addEventListener("change", handleKnowledgeFileChange);
els.knowledgeFile?.addEventListener("cancel", () => {
  settleKnowledgeFilePicker({ cancelled: true });
});
els.knowledgeCatalogBtn?.addEventListener("click", () => toggleKnowledgeCatalog());
els.knowledgeCatalogCloseBtn?.addEventListener("click", () => {
  toggleKnowledgeCatalog(false);
  els.knowledgeCatalogBtn?.focus({ preventScroll: true });
});
window.addEventListener("focus", handleKnowledgePickerWindowFocus);
els.teacherShortcutButtons.forEach((button) => {
  button.addEventListener("click", () => {
    void handleTeacherShortcut(button);
  });
});
els.englishPracticePickerClose?.addEventListener("click", () => setEnglishPracticePicker(false));
els.englishPracticeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    void startEnglishPractice(button.dataset.speakingPracticeLevel);
  });
});
els.teacherVoicePanelCloseBtn?.addEventListener("click", resetEnglishPracticeScene);
document.addEventListener("click", (event) => {
  if (els.englishPracticePicker?.hidden !== false) return;
  if (els.englishPracticePicker.contains(event.target)) return;
  if (event.target.closest?.('[data-teacher-shortcut="oral-practice"]')) return;
  setEnglishPracticePicker(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.englishPracticePicker?.hidden === false) {
    event.preventDefault();
    setEnglishPracticePicker(false);
  }
});
els.conversationLog?.addEventListener("click", handleTeacherTurnAction);
els.workspaceMenuButtons.forEach((button) => {
  button.addEventListener("click", () => switchWorkspace(button.dataset.workspaceView));
});
els.speed.addEventListener("input", () => syncAudioParam("speed", els.speed.value));
els.speedNumber.addEventListener("input", () => syncAudioParam("speed", els.speedNumber.value));
els.loudness.addEventListener("input", () => syncAudioParam("loudness", els.loudness.value));
els.loudnessNumber.addEventListener("input", () => syncAudioParam("loudness", els.loudnessNumber.value));
els.voice.addEventListener("change", handleVoiceSelectionChange);
els.replacementAppendBtn.addEventListener("click", sendReplacementAppend);
els.replacementCommitBtn.addEventListener("click", sendReplacementCommit);
els.industryInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) switchIndustry(input.value);
  });
});
els.clearLogBtn?.addEventListener("click", () => {
  els.eventLog.textContent = "";
  els.toolLog.classList.add("tool-log-empty");
  els.toolLog.textContent = "暂无工具调用";
  els.partialTranscript.textContent = "等待用户开口...";
  clearA2UI();
  setUserPreview("", true);
  setAssistantPreview("你好，今天想学什么？", true);
});
initializeIndustry();
initializeCardLibrary();
const materialStudio = initKnowledgeMaterialStudio();
initInteractiveLessonLab();
initTechnologyLandscape();
initLearningWorkbench();
initAssessmentWorkbench(document.querySelector("#assessmentWorkspace"));
initLearningBuddyCommunity(document.querySelector("#learningBuddyWorkspace"));
initPortalRuntime({ activateWorkspace: switchWorkspace });
initEducationSettingsWorkbench();
initEducationSkillWorkbench(document.querySelector("#educationSkillWorkbench"));
initOntologyWorkbench();
initSystemReleaseCenter();
initVideoExplanationWorkbench(document.querySelector("#videoExplanationWorkbench"));
mountCoursewareAssistant({ materials: materialStudio });
mountCoursewareLibrary();
mountSkillHub();
document.addEventListener("workspace:navigate", event => switchWorkspace(event.detail?.view));
document.addEventListener("courseware:open-assistant", () => switchWorkspace("courseware-assistant"));
initializeTextConversationThread();
window.lucide?.createIcons?.({
  attrs: {
    "stroke-width": 1.8
  }
});
bindTextCounters();
loadRuntimeConfig();
loadLearningAgentScope();
loadKnowledgeArtifacts();
updateAudioParamValues();
initializeAssistantSubtitleObserver();

function initializeCardLibrary() {
  if (!els.cardLibraryRoot) return;
  initCardLibrary(els.cardLibraryRoot, {
    initialType: "knowledge.explanation",
    onAction: (event, definition) => {
      logEvent("card-library.action", {
        cardType: definition.type,
        event
      });
    },
    onError: (error, definition) => {
      logEvent("card-library.error", {
        cardType: definition.type,
        message: error?.message || String(error)
      });
    }
  });
}

function switchWorkspace(view) {
  const workspaceMeta = {
    agent: {
      breadcrumb: "AI教师",
      title: "AI教师",
      chip: ""
    },
    graph: {
      breadcrumb: "知识图谱",
      title: "知识图谱",
      chip: ""
    },
    ontology: {
      breadcrumb: "本体图",
      title: "本体图",
      chip: "实体 · 关系 · 题目映射 · 发布版本"
    },
    records: {
      breadcrumb: "学习记录",
      title: "学习记录",
      chip: "学习画像 · 学习动态"
    },
    bank: {
      breadcrumb: "题库",
      title: "我的题库",
      chip: "历史作答 · 错题整理"
    },
    assessment: {
      breadcrumb: "智能评测",
      title: "智能评测",
      chip: "评测方法 · 任务 · 证据复盘"
    },
    plan: {
      breadcrumb: "学习计划",
      title: "学习计划",
      chip: "本周目标 · 每日任务"
    },
    buddy: {
      breadcrumb: "学习搭子",
      title: "学习搭子",
      chip: "专注学习 · 共同进步"
    },
    materials: {
      breadcrumb: "学习资料",
      title: "学习资料",
      chip: "知识讲解 · 练习素材"
    },
    library: {
      breadcrumb: "学习卡片",
      title: "学习卡片",
      chip: "讲解 · 练习 · 复习"
    },
    "voice-config": {
      breadcrumb: "声音与偏好",
      title: "声音与偏好",
      chip: "声音 · 对话习惯"
    }
  };
  const role = getPortalRole();
  const targetView = resolvePortalWorkspace(view, role);
  if (targetView !== "agent") stopTextSpeech({ abortAsr: true });
  const app = document.querySelector(".app");
  app?.classList.toggle("is-graph-immersive", targetView === "graph");
  app?.classList.toggle("is-agent-view", targetView === "agent");
  app?.classList.toggle("is-authoring-view", ["courseware-assistant", "courseware-library", "skill-hub", "assessment"].includes(targetView));
  els.workspaceMenuButtons.forEach((button) => {
    const selected = button.dataset.workspaceView === targetView
      && (!button.dataset.portalRole || button.dataset.portalRole === role);
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  document.querySelectorAll("[data-workspace-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.workspacePanel !== targetView;
  });
  const meta = getPortalWorkspacePresentation(targetView, role)
    || workspaceMeta[targetView]
    || { breadcrumb: "AI教师", title: "AI教师", chip: "" };
  if (els.workspaceBreadcrumb) els.workspaceBreadcrumb.textContent = meta.breadcrumb;
  if (els.workspaceTitle) els.workspaceTitle.textContent = meta.title;
  if (els.workspaceTypeChip) {
    els.workspaceTypeChip.textContent = meta.chip;
    els.workspaceTypeChip.hidden = !meta.chip;
  }
  queueMicrotask(() => window.lucide?.createIcons?.());
  document.dispatchEvent(new CustomEvent("learning-workspace:change", { detail: { view: targetView, role } }));
  if (role === "teacher") {
    const tools = { "video-explanation": "video", "lesson-lab": "interactive", materials: "materials" };
    if (tools[view]) document.dispatchEvent(new CustomEvent("courseware:select-tool", { detail: { tool: tools[view] } }));
    if (view === "tech-landscape" || view === "agent-skills") document.dispatchEvent(new CustomEvent("skill-hub:select-tab", { detail: { tab: view === "tech-landscape" ? "technology" : "skills" } }));
  }
}

function setTextInputSheet(open) {
  if (!els.textInputSheet) return;
  if (els.textInputSheet.dataset.persistent === "true") {
    els.textInputSheet.hidden = false;
    if (open) window.setTimeout(() => els.textQuestion?.focus(), 40);
    return;
  }
  els.textInputSheet.hidden = !open;
  els.keyboardBtn?.classList.toggle("is-active", open);
  if (open) {
    window.setTimeout(() => els.textQuestion?.focus(), 40);
  }
}

function setTextSpeechStatus(message = "", isError = false) {
  if (!els.teacherSpeechStatus) return;
  els.teacherSpeechStatus.textContent = String(message || "");
  els.teacherSpeechStatus.classList.toggle("is-error", Boolean(message) && isError);
}

function isDuplexVoiceBusy() {
  return Boolean(sessionReady || ws || voiceStartPromise || recording || connectPromise);
}

function toggleComposerAsr() {
  if (textSpeechState.mode === "asr_listening" || textSpeechState.mode === "asr_requesting") {
    stopComposerAsr({ abort: false });
    return;
  }
  startComposerAsr();
}

function startComposerAsr() {
  if (isDuplexVoiceBusy()) {
    setTextSpeechStatus("请先结束语音课堂，再使用语音输入", true);
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (typeof SpeechRecognition !== "function") {
    setTextSpeechStatus("当前浏览器不支持语音输入，请使用最新版 Chrome 或 Edge", true);
    return;
  }
  stopTextTts();
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  textSpeechState.mode = "asr_requesting";
  textSpeechState.recognition = recognition;
  textSpeechState.asrBaseText = els.textQuestion?.value || "";
  textSpeechState.asrFinalText = "";
  syncComposerAsrButton();
  setTextSpeechStatus("请允许麦克风权限…");

  recognition.onstart = () => {
    if (textSpeechState.recognition !== recognition) return;
    textSpeechState.mode = "asr_listening";
    syncComposerAsrButton();
    setTextSpeechStatus("正在听，再点一次结束");
  };
  recognition.onresult = (event) => {
    if (textSpeechState.recognition !== recognition || !els.textQuestion) return;
    let finalDelta = "";
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = String(event.results[index]?.[0]?.transcript || "");
      if (event.results[index].isFinal) finalDelta += transcript;
      else interim += transcript;
    }
    if (finalDelta) textSpeechState.asrFinalText += finalDelta;
    const base = textSpeechState.asrBaseText.trimEnd();
    const spoken = `${textSpeechState.asrFinalText}${interim}`.trim();
    els.textQuestion.value = [base, spoken].filter(Boolean).join(base && spoken ? " " : "");
    els.textQuestion.dispatchEvent(new Event("input", { bubbles: true }));
  };
  recognition.onerror = (event) => {
    if (textSpeechState.recognition !== recognition) return;
    const messages = {
      "not-allowed": "浏览器没有麦克风权限，请允许后重试",
      "audio-capture": "没有检测到可用麦克风",
      "no-speech": "没有听到语音，可以再试一次",
      network: "语音识别服务暂时不可用"
    };
    setTextSpeechStatus(messages[event.error] || "语音识别失败，请重试", true);
  };
  recognition.onend = () => {
    if (textSpeechState.recognition !== recognition) return;
    textSpeechState.recognition = null;
    textSpeechState.mode = "idle";
    syncComposerAsrButton();
    if (!els.teacherSpeechStatus?.classList.contains("is-error")) {
      setTextSpeechStatus(textSpeechState.asrFinalText ? "语音已转为文字" : "");
    }
  };
  try {
    recognition.start();
  } catch {
    textSpeechState.recognition = null;
    textSpeechState.mode = "idle";
    syncComposerAsrButton();
    setTextSpeechStatus("语音输入启动失败，请重试", true);
  }
}

function stopComposerAsr({ abort = false } = {}) {
  const recognition = textSpeechState.recognition;
  if (!recognition) return;
  try {
    if (abort) recognition.abort();
    else recognition.stop();
  } catch {
    textSpeechState.recognition = null;
    textSpeechState.mode = "idle";
    syncComposerAsrButton();
  }
}

function syncComposerAsrButton() {
  const button = els.teacherAsrBtn;
  if (!button) return;
  const active = textSpeechState.mode === "asr_listening" || textSpeechState.mode === "asr_requesting";
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", active ? "结束语音输入" : "开始语音输入");
  button.title = active ? "结束语音输入" : "语音输入";
  const icon = button.querySelector("[data-lucide]");
  const iconName = active ? "square" : "mic";
  if (icon && icon.getAttribute("data-lucide") !== iconName) {
    icon.setAttribute("data-lucide", iconName);
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  }
}

async function toggleTeacherTts(button, text) {
  if (
    ["tts_connecting", "tts_playing"].includes(textSpeechState.mode)
    && textSpeechState.activeButton === button
  ) {
    stopTextTts();
    setTextSpeechStatus("已停止播放");
    return;
  }
  if (isDuplexVoiceBusy()) {
    setTextSpeechStatus("请先结束语音课堂，再播放文字回复", true);
    return;
  }
  const spokenText = String(text || "").trim();
  if (!spokenText) {
    setTextSpeechStatus("本条回复暂无可播放文字", true);
    return;
  }
  stopComposerAsr({ abort: true });
  stopTextTts();
  const playbackId = globalThis.crypto?.randomUUID?.()
    || `tts-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const requestSequence = textSpeechState.requestSequence + 1;
  const controller = new AbortController();
  let audioPlaybackContext;
  try {
    audioPlaybackContext = ensurePlaybackContext();
  } catch {
    setTextSpeechStatus("当前浏览器无法播放音频", true);
    return;
  }
  textSpeechState.requestSequence = requestSequence;
  textSpeechState.mode = "tts_connecting";
  textSpeechState.controller = controller;
  textSpeechState.playbackId = playbackId;
  textSpeechState.activeButton = button;
  textSpeechState.nextTime = audioPlaybackContext.currentTime + 0.05;
  textSpeechState.upstreamDone = false;
  textSpeechState.receivedAudio = false;
  syncTeacherTtsButton(button, true);
  setTextSpeechStatus("正在连接火山语音…");

  try {
    const response = await fetch("/api/voice/tts/stream", {
      method: "POST",
      headers: {
        accept: "application/x-ndjson",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        playback_id: playbackId,
        text: spokenText.slice(0, 8_000),
        voice: els.voice?.value?.trim() || "zh_female_vv_jupiter_bigtts",
        speed: audioRatioToProtocolValue(els.speed?.value),
        loudness: audioRatioToProtocolValue(els.loudness?.value)
      }),
      signal: controller.signal
    });
    await consumeTextSpeechNdjson(response, {
      onStarted: (event) => {
        if (!isActiveTextTts(playbackId, requestSequence)) return;
        textSpeechState.mode = "tts_playing";
        setTextSpeechStatus("火山语音播放中");
        logEvent("text.tts.started", {
          playback_id: playbackId,
          provider: String(event.provider || "volcengine")
        });
      },
      onAudio: (event) => {
        if (!isActiveTextTts(playbackId, requestSequence)) return;
        textSpeechState.mode = "tts_playing";
        textSpeechState.receivedAudio = true;
        playTextTtsPcm16Base64(
          event.delta || event.audio || "",
          event.sample_rate || event.sampleRate || 24_000,
          playbackId
        );
      },
      onAudioDone: () => {
        if (!isActiveTextTts(playbackId, requestSequence)) return;
        textSpeechState.upstreamDone = true;
        finishTextTtsWhenDrained(playbackId);
      }
    });
    if (!isActiveTextTts(playbackId, requestSequence)) return;
    textSpeechState.upstreamDone = true;
    if (!textSpeechState.receivedAudio) {
      throw new Error("火山语音未返回可播放音频");
    }
    finishTextTtsWhenDrained(playbackId);
  } catch (error) {
    if (!isActiveTextTts(playbackId, requestSequence)) return;
    if (error?.name === "AbortError") return;
    finishTextTts(
      playbackId,
      error?.message || "火山语音播放失败，请重试",
      true
    );
    logEvent("text.tts.error", {
      playback_id: playbackId,
      message: error?.message || String(error)
    });
  } finally {
    if (isActiveTextTts(playbackId, requestSequence)) {
      textSpeechState.controller = null;
    }
  }
}

function isActiveTextTts(playbackId, requestSequence = textSpeechState.requestSequence) {
  return textSpeechState.playbackId === playbackId
    && textSpeechState.requestSequence === requestSequence;
}

function finishTextTtsWhenDrained(playbackId) {
  if (!isActiveTextTts(playbackId) || !textSpeechState.upstreamDone) return;
  if (textSpeechState.sources.size) return;
  finishTextTts(playbackId, "播放完成");
}

function finishTextTts(playbackId, message, isError = false) {
  if (!isActiveTextTts(playbackId)) return;
  if (isError) {
    for (const source of textSpeechState.sources) {
      try {
        source.stop();
      } catch {
        // The audio chunk may already have completed.
      }
    }
    textSpeechState.sources.clear();
  }
  syncTeacherTtsButton(textSpeechState.activeButton, false);
  textSpeechState.mode = "idle";
  textSpeechState.controller = null;
  textSpeechState.playbackId = "";
  textSpeechState.activeButton = null;
  textSpeechState.nextTime = 0;
  textSpeechState.upstreamDone = false;
  textSpeechState.receivedAudio = false;
  setTextSpeechStatus(message, isError);
}

function stopTextTts() {
  textSpeechState.controller?.abort();
  for (const source of textSpeechState.sources) {
    try {
      source.stop();
    } catch {
      // The audio chunk may already have completed.
    }
  }
  textSpeechState.sources.clear();
  syncTeacherTtsButton(textSpeechState.activeButton, false);
  textSpeechState.mode = "idle";
  textSpeechState.controller = null;
  textSpeechState.playbackId = "";
  textSpeechState.activeButton = null;
  textSpeechState.nextTime = 0;
  textSpeechState.upstreamDone = false;
  textSpeechState.receivedAudio = false;
}

function syncTeacherTtsButton(button, active) {
  if (!button) return;
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", active ? "停止播放本条回复" : "播放本条回复");
  button.title = active ? "停止播放" : "播放回复";
  const icon = button.querySelector("[data-lucide]");
  const iconName = active ? "square" : "volume-2";
  if (icon && icon.getAttribute("data-lucide") !== iconName) {
    icon.setAttribute("data-lucide", iconName);
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  }
}

function stopTextSpeech({ abortAsr = false } = {}) {
  stopTextTts();
  stopComposerAsr({ abort: abortAsr });
}

function handleVoicePrimaryAction() {
  stopTextSpeech({ abortAsr: true });
  if (!sessionReady) {
    if (voiceStartPromise) return voiceStartPromise;
    voiceUserTranscriptBuffer = "";
    queueVoiceSubtitle(
      "user",
      activeEnglishPracticeScene
        ? getSpeakingPracticeUserPrompt(activeEnglishPracticeScene)
        : "请开始说话",
      "idle"
    );
    queueVoiceSubtitle(
      "assistant",
      activeEnglishPracticeScene
        ? `正在连接${activeEnglishPracticeScene.label}口语陪练…`
        : "正在连接AI教师…",
      "pending"
    );
    autoStartVoiceAfterConnect = true;
    setStatus("请允许麦克风");
    setListeningState(false, "等待麦克风权限");
    unlockPlaybackContext();

    // getUserMedia must be invoked synchronously from the user's click. Waiting
    // until the remote session is ready loses the browser activation and can
    // leave Doubao connected without any audio input.
    const mediaRequest = requestMicrophoneStream();
    const attemptId = ++voiceStartSequence;
    const startPromise = startVoiceSession(mediaRequest, attemptId);
    const guardedStartPromise = startPromise
      .catch((error) => {
        if (attemptId !== voiceStartSequence) return;
        if (isMicrophoneFailure(error)) {
          handleMicrophoneError(error);
          return;
        }
        if (error?.code !== "VOICE_CONNECTION_DISPOSED") {
          handleVoiceConnectionError(error);
        }
      })
      .finally(() => {
        if (voiceStartPromise === guardedStartPromise) voiceStartPromise = null;
        if (attemptId === voiceStartSequence && !sessionReady) {
          autoStartVoiceAfterConnect = false;
          syncVoiceDock("可重试");
        }
      });
    voiceStartPromise = guardedStartPromise;
    return voiceStartPromise;
  }
  if (isPlaying()) {
    interrupt();
    syncVoiceDock("已打断");
    return Promise.resolve();
  }
  return toggleTalk().then(() => {
    syncVoiceDock(recording ? "正在听" : "可继续提问");
  });
}

function requestMicrophoneStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error("当前浏览器不支持麦克风录音");
    error.name = "NotSupportedError";
    return Promise.reject(error);
  }
  const permissionRequest = navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error("等待麦克风授权超时");
      error.name = "TimeoutError";
      error.code = "MICROPHONE_PERMISSION_TIMEOUT";
      reject(error);
    }, MICROPHONE_PERMISSION_TIMEOUT_MS);

    permissionRequest.then(
      (stream) => {
        if (settled) {
          // The user may approve the browser prompt after our UI has already
          // returned to retry state. Never retain that late microphone stream.
          for (const track of stream?.getTracks() || []) track.stop();
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(stream);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

async function startVoiceSession(mediaRequest, attemptId = voiceStartSequence) {
  syncVoiceDock("连接中");
  setStatus("正在连接并申请麦克风");
  setListeningState(false, "等待麦克风权限");

  const microphoneReady = Promise.resolve(mediaRequest).then((stream) => {
    if (attemptId !== voiceStartSequence || !autoStartVoiceAfterConnect) {
      for (const track of stream?.getTracks() || []) track.stop();
      const error = new Error("语音连接已终止");
      error.code = "VOICE_CONNECTION_DISPOSED";
      throw error;
    }
    pendingMediaStream = stream;
    if (!sessionReady) {
      setStatus("麦克风已就绪，正在连接AI教师");
      setListeningState(false, "正在连接");
    }
    return stream;
  });
  const connectionReady = connect();
  const [stream] = await Promise.all([microphoneReady, connectionReady]);

  if (
    attemptId !== voiceStartSequence ||
    !sessionReady ||
    !pendingMediaStream ||
    pendingMediaStream !== stream
  ) {
    const error = new Error("语音连接已终止");
    error.code = "VOICE_CONNECTION_DISPOSED";
    throw error;
  }

  pendingMediaStream = null;
  autoStartVoiceAfterConnect = false;
  await startRecording(stream);
  continuousVoice = true;
}

function isMicrophoneFailure(error) {
  return [
    "NotAllowedError",
    "NotFoundError",
    "NotReadableError",
    "NotSupportedError",
    "TimeoutError",
    "OverconstrainedError",
    "SecurityError"
  ].includes(error?.name);
}

function syncVoiceDock(stateLabel = "") {
  if (!els.voicePrimaryBtn || !els.voicePrimaryLabel) return;
  const speaking = /播报|回答/.test(stateLabel) || isPlaying();
  let label = "开始提问";
  let iconName = "mic";
  if (!sessionReady) label = autoStartVoiceAfterConnect ? "正在连接" : "开始上课";
  if (!sessionReady && autoStartVoiceAfterConnect) iconName = "loader-circle";
  if (sessionReady && speaking) {
    label = "打断回答";
    iconName = "square";
  }
  if (sessionReady && recording) {
    label = "结束提问";
    iconName = "audio-lines";
  }
  els.voicePrimaryLabel.textContent = label;
  els.voicePrimaryBtn.setAttribute("aria-label", label);
  els.voicePrimaryBtn.title = label;
  els.voicePrimaryBtn.classList.toggle("is-connecting", !sessionReady && autoStartVoiceAfterConnect);
  els.voicePrimaryBtn.classList.toggle("is-listening", recording);
  els.voicePrimaryBtn.classList.toggle("is-speaking", sessionReady && speaking);
  els.voicePrimaryBtn.setAttribute("aria-pressed", String(recording));
  const icon = els.voicePrimaryBtn.querySelector("[data-lucide]");
  if (icon && icon.getAttribute("data-lucide") !== iconName) {
    icon.setAttribute("data-lucide", iconName);
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  }
}

function initializeIndustry() {
  const selected = els.industryInputs.find((input) => input.checked)?.value || DEFAULT_INDUSTRY;
  currentIndustry = selected;
  applyIndustryPreset(currentIndustry);
}

function switchIndustry(nextIndustry) {
  if (nextIndustry === currentIndustry) return;

  industryDrafts[currentIndustry] = captureIndustryDraft();
  currentIndustry = nextIndustry;
  applyIndustryPreset(currentIndustry);

  if (sessionReady && ws?.readyState === WebSocket.OPEN) {
    updateSession();
    setStatus(`已切换至${getIndustryPreset(currentIndustry).label}`, false, true);
  } else {
    setStatus("未连接");
  }
}

function captureIndustryDraft() {
  return {
    basePrompt: els.personaBasePrompt.value,
    backgroundPrompt: els.personaBackgroundPrompt.value,
    stylePrompt: els.personaStylePrompt.value,
    salesPlaybook: els.salesPlaybookPrompt.value,
    openingText: els.openingText.value,
    sampleQuestion: els.textQuestion.value
  };
}

function applyIndustryPreset(industry) {
  const preset = getIndustryPreset(industry);
  const values = industryDrafts[industry] || preset;

  els.industryInputs.forEach((input) => {
    input.checked = input.value === industry;
  });
  els.industryProfileTitle.textContent = preset.profileTitle;
  els.industryProfileSummary.textContent = preset.profileSummary;
  els.industryModeBadge.textContent =
    industry === "education" ? "双工自主推理" : "工具增强";
  els.industryModeBadge.classList.remove("is-fast");
  els.activeIndustry.textContent = preset.badge;
  els.personaBasePrompt.value = values.basePrompt;
  els.personaBackgroundPrompt.value = values.backgroundPrompt;
  els.personaStylePrompt.value = values.stylePrompt;
  els.salesPlaybookPrompt.value = values.salesPlaybook;
  els.openingText.value = values.openingText;
  els.textQuestion.value = values.sampleQuestion;
  syncTextSendDisabled();
  els.a2uiPreviewBtn.textContent = industry === "education" ? "生成卡片" : "界面";
  lastAssistantResponse = "";
  setUserPreview(preset.previewUserText, true);
  setAssistantPreview(preset.previewAssistantText, true);
  clearA2UI();
  els.partialTranscript.textContent = "等待用户开口...";
  els.instructions.value = buildPersonaInstructions();
  refreshTextCounters();
}

function connect() {
  if (sessionReady && ws?.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  if (connectPromise) return connectPromise;

  // A local WebSocket can remain OPEN after the upstream Doubao session has
  // ended. It cannot be reused because the server-side bridge is single-use.
  if (ws && !sessionReady) {
    const staleSocket = ws;
    ws = null;
    if (
      staleSocket.readyState === WebSocket.OPEN ||
      staleSocket.readyState === WebSocket.CONNECTING
    ) {
      staleSocket.close();
    }
  }

  sessionReady = false;
  setStatus("正在连接AI教师");
  let socket;
  try {
    if (!["http:", "https:"].includes(location.protocol) || !location.host) {
      const error = new Error("VOICE_PAGE_ORIGIN_INVALID");
      error.code = "VOICE_PAGE_ORIGIN_INVALID";
      throw error;
    }
    const websocketProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${websocketProtocol}//${location.host}/voice`);
    ws = socket;
  } catch (error) {
    handleVoiceConnectionError(error);
    return Promise.reject(error);
  }

  connectPromise = new Promise((resolve, reject) => {
    connectResolve = resolve;
    connectReject = reject;
    connectTimeoutId = window.setTimeout(() => {
      if (socket !== ws || sessionReady) return;
      const error = new Error("语音连接超时");
      error.code = "VOICE_CONNECT_TIMEOUT";
      handleVoiceConnectionError(error);
    }, VOICE_CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (socket !== ws) return;
      const config = buildSessionConfig();
      if (!config) {
        const error = new Error("语音会话配置无效");
        error.code = "VOICE_SESSION_CONFIG_INVALID";
        handleVoiceConnectionError(error);
        return;
      }
      pendingOpeningSubtitle = String(config.openingText || "");
      socket.send(JSON.stringify({
        type: "session.start",
        apiKey: els.apiKey.value.trim(),
        config
      }));
      els.apiKey.value = "";
    });
    socket.addEventListener("message", (event) => {
      if (socket !== ws) return;
      try {
        handleGatewayMessage(JSON.parse(event.data));
      } catch (error) {
        logEvent("gateway.message.error", { message: error?.message || String(error) });
      }
    });
    socket.addEventListener("close", () => {
      if (socket !== ws) return;
      const error = new Error("语音连接已断开");
      error.code = "VOICE_SOCKET_CLOSED";
      disposeVoiceSession({
        error,
        statusText: "语音已断开，点击重试",
        stateLabel: "可重试",
        isError: true,
        closeSocket: false
      });
    });
    socket.addEventListener("error", () => {
      if (socket !== ws) return;
      const error = new Error("语音 WebSocket 连接失败");
      error.code = "VOICE_WEBSOCKET_ERROR";
      handleVoiceConnectionError(error);
    });
  });
  return connectPromise;
}

function settleVoiceConnect(error = null) {
  const resolve = connectResolve;
  const reject = connectReject;
  if (connectTimeoutId != null) window.clearTimeout(connectTimeoutId);
  connectTimeoutId = null;
  connectResolve = null;
  connectReject = null;
  connectPromise = null;
  if (error) reject?.(error);
  else resolve?.();
}

function handleVoiceConnectionError(error) {
  if (error && typeof error === "object" && disposedVoiceErrors.has(error)) return;
  const timeout = error?.code === "VOICE_CONNECT_TIMEOUT";
  disposeVoiceSession({
    error,
    statusText: timeout ? "连接超时，点击重试" : "连接失败，点击重试",
    stateLabel: "可重试",
    isError: true
  });
  logEvent("gateway.connection.error", {
    code: error?.code || error?.message || "VOICE_CONNECTION_FAILED"
  });
}

function disposeVoiceSession({
  error = null,
  statusText = "语音已断开，点击重试",
  stateLabel = "可重试",
  isError = false,
  closeSocket = true
} = {}) {
  const socket = ws;
  ws = null;
  voiceStartSequence += 1;
  voiceStartPromise = null;
  sessionReady = false;
  autoStartVoiceAfterConnect = false;
  pendingOpeningSubtitle = "";
  pendingVoiceUpdateLabel = "";
  continuousVoice = false;
  voiceTurnCommitted = false;
  voiceTurnDetector?.reset?.();

  const connectionError = error || Object.assign(new Error("语音连接已终止"), {
    code: "VOICE_CONNECTION_DISPOSED"
  });
  if (connectionError && typeof connectionError === "object") {
    disposedVoiceErrors.add(connectionError);
  }
  settleVoiceConnect(connectionError);
  stopPendingMediaStream();
  stopRecording();
  stopKeepAlive();
  stopPlayback();

  if (
    closeSocket &&
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    socket.close();
  }

  setConnected(false);
  setStatus(statusText, isError);
  setListeningState(false, stateLabel);
  queueVoiceSubtitle(
    "assistant",
    isError ? "语音连接已中断，请重试" : statusText,
    isError ? "error" : "idle"
  );
}

function stopPendingMediaStream() {
  const stream = pendingMediaStream;
  pendingMediaStream = null;
  for (const track of stream?.getTracks() || []) track.stop();
}

function handleGatewayMessage(msg) {
  logEvent(msg.type, msg);

  switch (msg.type) {
    case "gateway.connected":
      setStatus("网关已连接");
      break;
    case "voice.session.created":
      sessionReady = true;
      settleVoiceConnect();
      pendingOpeningSubtitle = "";
      queueVoiceSubtitle(
        "assistant",
        autoStartVoiceAfterConnect && !pendingMediaStream
          ? "语音已连接，请允许麦克风"
          : "已连接，请开始说话",
        autoStartVoiceAfterConnect && !pendingMediaStream ? "pending" : "idle"
      );
      queueVoiceSubtitle(
        "user",
        activeEnglishPracticeScene
          ? getSpeakingPracticeUserPrompt(activeEnglishPracticeScene)
          : "请开始说话",
        "idle"
      );
      if (msg.session?.id) {
        els.activeSessionId.textContent = msg.session.id;
        els.sessionId.value = msg.session.id;
      }
      els.activeOutputFormat.textContent = "pcm_s16le / 24k";
      setConnected(true);
      if (autoStartVoiceAfterConnect && !pendingMediaStream) {
        setStatus("已连接，等待麦克风权限");
        setListeningState(false, "等待麦克风权限");
      } else {
        setStatus("可通话", false, true);
        setListeningState(false, "待用户开口");
      }
      break;
    case "voice.session.updated":
      if (pendingVoiceUpdateLabel) {
        setStatus(`已切换为${pendingVoiceUpdateLabel}，下一句生效`, false, true);
        pendingVoiceUpdateLabel = "";
      } else {
        setStatus("会话已更新", false, true);
      }
      break;
    case "gateway.error":
    case "voice.error": {
      const message = extractVoiceErrorMessage(msg);
      const error = new Error(message || "语音服务连接异常");
      error.code = msg.type === "gateway.error" ? "VOICE_GATEWAY_ERROR" : "VOICE_UPSTREAM_ERROR";
      disposeVoiceSession({
        error,
        statusText: "语音连接异常，点击重试",
        stateLabel: "可重试",
        isError: true
      });
      break;
    }
    case "voice.transcript.started":
      voiceUserTranscriptBuffer = "";
      els.partialTranscript.textContent = "正在听...";
      setListeningState(true, "正在听");
      setUserPreview("正在听...", false);
      queueVoiceSubtitle("user", "正在听…", "listening");
      clearA2UI();
      if (isPlaying()) interrupt();
      break;
    case "voice.transcript.delta": {
      voiceUserTranscriptBuffer = mergeStreamingText(
        voiceUserTranscriptBuffer,
        msg.delta || ""
      );
      const transcriptPreview = voiceUserTranscriptBuffer || "正在听…";
      els.partialTranscript.textContent = transcriptPreview;
      setUserPreview(transcriptPreview, false);
      queueVoiceSubtitle("user", transcriptPreview, "listening");
      break;
    }
    case "voice.transcript.completed":
      els.partialTranscript.textContent = msg.transcript || "识别完成";
      voiceUserTranscriptBuffer = String(msg.transcript || voiceUserTranscriptBuffer || "");
      assistantBuffer = "";
      assistantProjectionFallback = "";
      resetAssistantTextStreams();
      resetAssistantSubtitle();
      lastAssistantResponse = "";
      setListeningState(false, "识别完成");
      lastUserQuery = msg.transcript || "";
      setUserPreview(msg.transcript || "已识别到语音", false);
      setAssistantPreview("正在生成回复...", false);
      queueVoiceSubtitle("user", voiceUserTranscriptBuffer || "已识别到语音", "complete");
      queueVoiceSubtitle("assistant", "正在生成回复…", "pending");
      clearA2UI();
      break;
    case "voice.text.fallback":
      assistantProjectionFallback = String(msg.text || "").trim();
      if (assistantProjectionFallback) {
        assistantBuffer = syncSelectedAssistantSubtitle().text;
        queueVoiceSubtitle("assistant", assistantBuffer, "pending");
      }
      break;
    case "voice.transcript.failed":
      stopKeepAlive();
      voiceTurnCommitted = false;
      voiceUserTranscriptBuffer = "";
      els.partialTranscript.textContent = "没有听清，请再说一次";
      setListeningState(false, "请再说一次");
      setUserPreview("没有听清，请再说一次", false);
      queueVoiceSubtitle("user", "没有听清，请再说一次", "error");
      void resumeContinuousVoice();
      break;
    case "voice.text.delta": {
      assistantBuffer = appendAssistantSubtitle(
        msg.delta || "",
        msg.response_id || "",
        msg.text_source || ""
      );
      queueVoiceSubtitle("assistant", assistantBuffer || "正在生成回复…", "speaking");
      break;
    }
    case "voice.text.done": {
      const completedSubtitle = completeAssistantSubtitle(
        msg.text || "",
        msg.response_id || "",
        msg.text_source || ""
      );
      if (completedSubtitle.text) {
        assistantBuffer = completedSubtitle.text;
        lastAssistantResponse = completedSubtitle.text;
        queueVoiceSubtitle(
          "assistant",
          completedSubtitle.text,
          completedSubtitle.done ? "complete" : "speaking"
        );
        if (currentIndustry !== "education") {
          renderA2UIForTurn({ responseId: msg.response_id, answer: completedSubtitle.text });
        }
      } else if (assistantBuffer) {
        queueVoiceSubtitle(
          "assistant",
          assistantBuffer,
          completedSubtitle.done ? "complete" : "speaking"
        );
      }
      break;
    }
    case "voice.audio.started":
      ensurePlaybackContext();
      markAssistantSubtitleAudioStarted(msg.response_id || "");
      setListeningState(false, "正在播报");
      break;
    case "voice.audio.delta":
      if ((msg.format || "pcm_s16le") === "pcm_s16le") {
        playPcm16Base64(
          msg.delta,
          msg.sampleRate || 24000,
          msg.response_id || ""
        );
      }
      break;
    case "voice.audio.done":
      markAssistantSubtitleAudioDone(msg.response_id || "");
      setListeningState(recording, isPlaying() ? "播报中，可直接打断" : "可继续提问");
      break;
    case "voice.response.done":
      stopKeepAlive();
      voiceTurnDetector?.reset?.();
      voiceTurnCommitted = false;
      if (isPlaying()) {
        setStatus("正在播报，你可以直接开口打断", false, true);
        setListeningState(recording, "播报中，可直接打断");
      } else {
        setStatus("可继续", false, true);
        setListeningState(recording, recording ? "正在听" : "可继续提问");
      }
      void resumeContinuousVoice().then(() => {
        if (isPlaying()) {
          setStatus("正在播报，你可以直接开口打断", false, true);
          setListeningState(true, "播报中，可直接打断");
        }
      });
      break;
    case "voice.response.canceled":
      stopKeepAlive();
      stopPlayback();
      setListeningState(false, "已打断");
      queueVoiceSubtitle("assistant", "已停止回答", "idle");
      void resumeContinuousVoice();
      break;
    case "voice.audio.committed":
      setStatus("正在理解你的问题");
      break;
    case "tool.calls":
      appendToolLog("CALL", msg.items);
      break;
    case "tool.results":
      appendToolLog("RESULT", msg.items);
      break;
    case "education.ui":
      applyEducationUI(msg.ui, {
        activeQuestionId: msg.active_question_id,
        source: msg.source || "knowledge_tool"
      });
      break;
    case "education.projection":
      if (shouldClearCardsForProjection(msg)) clearA2UI();
      break;
    case "education.error":
      setStatus("教学工具调用失败", true);
      setAssistantPreview(msg.message || "教学工具暂时不可用，请稍后重试。", false);
      break;
    case "a2ui.action.accepted":
      setStatus("界面操作已提交", false, true);
      break;
    case "a2ui.action.rejected":
      setStatus("界面操作无效", true);
      break;
    case "voice.session.closed":
    case "gateway.closed": {
      const error = new Error("语音会话已结束");
      error.code = "VOICE_UPSTREAM_CLOSED";
      disposeVoiceSession({
        error,
        statusText: "语音已结束，点击重试",
        stateLabel: "可重试",
        isError: false
      });
      break;
    }
    default:
      break;
  }
}

function extractVoiceErrorMessage(message) {
  return String(
    message?.message ||
      message?.error?.error?.message ||
      message?.error?.message ||
      ""
  ).trim();
}

function setConnected(connected) {
  els.connectBtn.disabled = connected;
  els.updateSessionBtn.disabled = !connected;
  els.talkBtn.disabled = false;
  els.talkBtn.title = connected ? "开始或停止语音" : "请先连接AI教师";
  els.forceCommitBtn.disabled = !connected;
  els.interruptBtn.disabled = !connected;
  els.closeBtn.disabled = !connected;
  syncTextSendDisabled(connected);
  els.replacementAppendBtn.disabled = !connected;
  els.replacementCommitBtn.disabled = !connected;
  syncVoiceDock(connected ? "待用户开口" : "未连接");
}

function setStatus(text, error = false, ok = false) {
  els.status.textContent = text;
  els.status.classList.toggle("err", error);
  els.status.classList.toggle("ok", ok);
}

function updateAudioParamValues() {
  syncAudioParam("speed", els.speed.value);
  syncAudioParam("loudness", els.loudness.value);
}

function syncAudioParam(type, value) {
  const normalized = normalizeAudioParam(value);
  const slider = type === "speed" ? els.speed : els.loudness;
  const numberInput = type === "speed" ? els.speedNumber : els.loudnessNumber;

  slider.value = normalized;
  numberInput.value = normalized;
}

function normalizeAudioParam(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(2, Math.max(0.5, Math.round(number * 100) / 100));
}

function audioRatioToProtocolValue(value) {
  return Math.round((normalizeAudioParam(value) - 1) * 100);
}

function setListeningState(active, text) {
  const label = text || (active ? "正在听" : "待用户开口");
  els.agentAvatar?.classList.toggle("is-listening", active);
  els.listenState?.classList.toggle("is-active", active);
  els.callToolbar?.classList.toggle("is-active", active);

  const listenText = els.listenState?.querySelector(".listen-text");
  if (listenText) listenText.textContent = label;
  if (els.callToolbarState) els.callToolbarState.textContent = label;
  syncVoiceDock(label);
}

function queueVoiceSubtitle(role, text, state = "idle") {
  const channel = role === "assistant" ? voiceSubtitleRenderState.assistant : voiceSubtitleRenderState.user;
  channel.text = String(text || "");
  channel.state = String(state || "idle");
  if (channel.frameId) return;
  channel.frameId = window.requestAnimationFrame(() => {
    channel.frameId = 0;
    const element = role === "assistant" ? els.voiceAssistantSubtitle : els.voiceUserSubtitle;
    if (!element) return;
    element.textContent = channel.text || (role === "assistant" ? "AI教师正在思考…" : "请开始说话");
    const row = element.closest(".voice-subtitle-line");
    if (row) row.dataset.voiceSubtitleState = channel.state;
  });
}

function setUserPreview(text, muted = false) {
  if (!els.liveUserMessage) return;
  els.liveUserMessage.textContent = text || "等待用户输入...";
  els.userMessageRow?.classList.toggle("is-muted", muted || !text);
}

function setAssistantPreview(text, muted = false) {
  if (!els.assistantText) return;
  setStructuredAnswerLayout(false);
  els.assistantText.classList.remove("is-structured-answer");
  delete els.assistantText.dataset.rawText;
  els.assistantText.textContent = text || "AI教师正在思考...";
  els.assistantMessageRow?.classList.toggle("is-muted", muted || !text);
}

function setStructuredAnswerLayout(active) {
  els.assistantMessageRow?.classList.toggle("has-structured-answer", active);
  els.assistantMessageRow
    ?.closest(".conversation-log")
    ?.classList.toggle("has-structured-answer", active);
}

function resetAssistantSubtitle(responseId = "") {
  stopAssistantSubtitleTicker();
  assistantSubtitleState.responseId = String(responseId || "");
  assistantSubtitleState.fullText = "";
  assistantSubtitleState.capacity = null;
  assistantSubtitleState.textDone = false;
  assistantSubtitleState.audioDone = false;
  assistantSubtitleState.audioStartAt = null;
  assistantSubtitleState.audioEndAt = null;
  assistantSubtitleState.spokenCursor = 0;
  assistantSubtitleState.anchor = 0;
}

function normalizeAssistantTextSource(source) {
  if (source === "audio_transcript" || source === "output_text") return source;
  return "unknown";
}

function resetAssistantTextStreams(responseId = "") {
  assistantTextStreamState.responseId = String(responseId || "");
  for (const source of ["audio_transcript", "output_text", "unknown"]) {
    assistantTextStreamState.buffers[source] = "";
    assistantTextStreamState.done[source] = false;
  }
}

function syncAssistantTextStreamResponse(responseId = "") {
  const nextResponseId = String(responseId || "");
  if (nextResponseId && nextResponseId !== assistantTextStreamState.responseId) {
    resetAssistantTextStreams(nextResponseId);
  }
}

function mergeStreamingText(currentText, incomingText) {
  const current = String(currentText || "");
  const incoming = String(incomingText || "");
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming) || current.endsWith(incoming)) return current;

  const maxOverlap = Math.min(current.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (current.slice(-overlap) === incoming.slice(0, overlap)) {
      return current + incoming.slice(overlap);
    }
  }
  return current + incoming;
}

function selectAssistantTextStream() {
  const completedSource = ["audio_transcript", "output_text", "unknown"]
    .find((source) => assistantTextStreamState.done[source] && assistantTextStreamState.buffers[source]);
  if (completedSource) {
    return {
      source: completedSource,
      text: assistantTextStreamState.buffers[completedSource],
      done: true
    };
  }
  if (assistantProjectionFallback) {
    return {
      source: "projection_fallback",
      text: assistantProjectionFallback,
      done: true
    };
  }
  const source = assistantTextStreamState.buffers.audio_transcript
    ? "audio_transcript"
    : assistantTextStreamState.buffers.output_text
      ? "output_text"
      : "unknown";
  return {
    source,
    text: assistantTextStreamState.buffers[source],
    done: assistantTextStreamState.done[source]
  };
}

function syncSelectedAssistantSubtitle(responseId = "") {
  syncAssistantSubtitleResponse(responseId);
  const selected = selectAssistantTextStream();
  assistantSubtitleState.fullText = selected.text;
  assistantSubtitleState.textDone = selected.done;
  renderAssistantSubtitleWindow();
  startAssistantSubtitleTicker();
  return selected;
}

function appendAssistantSubtitle(delta, responseId = "", textSource = "") {
  syncAssistantTextStreamResponse(responseId);
  const source = normalizeAssistantTextSource(textSource);
  assistantTextStreamState.buffers[source] = mergeStreamingText(
    assistantTextStreamState.buffers[source],
    delta
  );
  assistantTextStreamState.done[source] = false;
  return syncSelectedAssistantSubtitle(responseId).text;
}

function completeAssistantSubtitle(text, responseId = "", textSource = "") {
  syncAssistantTextStreamResponse(responseId);
  const source = normalizeAssistantTextSource(textSource);
  const finalText = String(text || "");
  if (finalText) {
    // The upstream completed value is authoritative and repairs any ambiguous
    // overlap encountered while rendering streaming deltas.
    assistantTextStreamState.buffers[source] = finalText;
  }
  assistantTextStreamState.done[source] = true;
  return syncSelectedAssistantSubtitle(responseId);
}

function replaceAssistantSubtitle(text, responseId = "") {
  syncAssistantSubtitleResponse(responseId);
  assistantSubtitleState.fullText = String(text || "");
  assistantSubtitleState.textDone = true;
  renderAssistantSubtitleWindow();
  startAssistantSubtitleTicker();
}

function syncAssistantSubtitleResponse(responseId) {
  const nextResponseId = String(responseId || "");
  if (
    nextResponseId &&
    assistantSubtitleState.responseId &&
    nextResponseId !== assistantSubtitleState.responseId
  ) {
    resetAssistantSubtitle(nextResponseId);
  } else if (nextResponseId && !assistantSubtitleState.responseId) {
    assistantSubtitleState.responseId = nextResponseId;
  }
}

function markAssistantSubtitleTextDone(responseId = "") {
  syncAssistantSubtitleResponse(responseId);
  assistantSubtitleState.textDone = true;
  renderAssistantSubtitleWindow();
  startAssistantSubtitleTicker();
}

function markAssistantSubtitleAudioStarted(responseId = "") {
  syncAssistantSubtitleResponse(responseId);
  assistantSubtitleState.audioDone = false;
  startAssistantSubtitleTicker();
}

function registerAssistantSubtitleAudioChunk(responseId, startAt, endAt) {
  syncAssistantSubtitleResponse(responseId);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return;
  if (
    !Number.isFinite(assistantSubtitleState.audioStartAt) ||
    startAt < assistantSubtitleState.audioStartAt
  ) {
    assistantSubtitleState.audioStartAt = startAt;
  }
  assistantSubtitleState.audioEndAt = Math.max(
    Number(assistantSubtitleState.audioEndAt) || 0,
    endAt
  );
  startAssistantSubtitleTicker();
}

function markAssistantSubtitleAudioDone(responseId = "") {
  syncAssistantSubtitleResponse(responseId);
  assistantSubtitleState.audioDone = true;
  startAssistantSubtitleTicker();
  updateAssistantSubtitlePlayback();
}

function renderAssistantSubtitleWindow({ playbackComplete = false } = {}) {
  if (!els.assistantText) return;
  const graphemes = splitGraphemes(assistantSubtitleState.fullText);
  if (!graphemes.length) {
    setAssistantPreview("", true);
    return;
  }

  if (!Number.isInteger(assistantSubtitleState.capacity)) {
    els.assistantText.textContent = graphemes.join("");
    if (subtitleElementOverflows()) {
      assistantSubtitleState.capacity = measureSubtitleCapacity(graphemes);
    }
  }

  const capacity = assistantSubtitleState.capacity;
  if (!Number.isInteger(capacity) || graphemes.length <= capacity) {
    assistantSubtitleState.anchor = 0;
    els.assistantText.textContent = graphemes.join("");
    els.assistantMessageRow?.classList.remove("is-muted");
    return;
  }

  const maxCursor = Math.max(0, graphemes.length - 1);
  const cursor = Math.max(
    0,
    Math.min(maxCursor, Math.floor(assistantSubtitleState.spokenCursor || 0))
  );

  if (playbackComplete) {
    assistantSubtitleState.anchor = Math.max(0, graphemes.length - capacity);
  } else if (
    cursor < assistantSubtitleState.anchor ||
    cursor >= assistantSubtitleState.anchor + capacity
  ) {
    assistantSubtitleState.anchor = cursor;
  }

  renderAssistantSubtitleSlice(graphemes);
  els.assistantMessageRow?.classList.remove("is-muted");

  while (
    assistantSubtitleState.capacity > 1 &&
    subtitleElementOverflows()
  ) {
    assistantSubtitleState.capacity -= 1;
    renderAssistantSubtitleSlice(graphemes);
  }

  if (
    !playbackComplete &&
    cursor > assistantSubtitleState.anchor &&
    isSubtitleCursorBeyondFirstLine(graphemes, cursor)
  ) {
    assistantSubtitleState.anchor = cursor;
    renderAssistantSubtitleSlice(graphemes);
  }
}

function renderAssistantSubtitleSlice(graphemes) {
  const start = Math.max(0, assistantSubtitleState.anchor);
  const end = start + Math.max(1, assistantSubtitleState.capacity || graphemes.length);
  els.assistantText.textContent = graphemes.slice(start, end).join("");
}

function splitGraphemes(text) {
  const value = String(text || "");
  if (!graphemeSegmenter) return Array.from(value);
  return [...graphemeSegmenter.segment(value)].map((item) => item.segment);
}

function subtitleElementOverflows() {
  return els.assistantText.scrollHeight > els.assistantText.clientHeight + 1;
}

function measureSubtitleCapacity(graphemes) {
  let low = 1;
  let high = graphemes.length;
  let best = 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    els.assistantText.textContent = graphemes.slice(0, middle).join("");
    if (subtitleElementOverflows()) {
      high = middle - 1;
    } else {
      best = middle;
      low = middle + 1;
    }
  }
  return Math.max(1, best);
}

function isSubtitleCursorBeyondFirstLine(graphemes, cursor) {
  const relativeCursor = cursor - assistantSubtitleState.anchor;
  if (relativeCursor <= 0) return false;

  const textNode = els.assistantText.firstChild;
  const visible = graphemes.slice(
    assistantSubtitleState.anchor,
    assistantSubtitleState.anchor + assistantSubtitleState.capacity
  );
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    return relativeCursor >= Math.max(1, Math.floor(visible.length / 2));
  }

  const characterStart = visible
    .slice(0, Math.min(relativeCursor, visible.length - 1))
    .join("").length;
  const characterEnd =
    characterStart +
    (visible[Math.min(relativeCursor, visible.length - 1)] || "").length;
  const range = document.createRange();
  try {
    range.setStart(textNode, characterStart);
    range.setEnd(textNode, Math.max(characterStart + 1, characterEnd));
    const cursorRect = range.getBoundingClientRect();
    const subtitleRect = els.assistantText.getBoundingClientRect();
    const lineHeight =
      Number.parseFloat(getComputedStyle(els.assistantText).lineHeight) ||
      els.assistantText.clientHeight / 2;
    if (cursorRect.height > 0 && subtitleRect.height > 0) {
      return cursorRect.top >= subtitleRect.top + lineHeight * 0.8;
    }
  } catch {
    // Fall through to the character-count approximation.
  } finally {
    range.detach?.();
  }
  return relativeCursor >= Math.max(1, Math.floor(visible.length / 2));
}

function startAssistantSubtitleTicker() {
  if (assistantSubtitleState.timerId != null) return;
  assistantSubtitleState.timerId = window.setInterval(
    updateAssistantSubtitlePlayback,
    ASSISTANT_SUBTITLE_TICK_MS
  );
}

function stopAssistantSubtitleTicker() {
  if (assistantSubtitleState.timerId == null) return;
  window.clearInterval(assistantSubtitleState.timerId);
  assistantSubtitleState.timerId = null;
}

function updateAssistantSubtitlePlayback() {
  const playbackContext = playback.audioContext;
  const graphemes = splitGraphemes(assistantSubtitleState.fullText);
  const startAt = assistantSubtitleState.audioStartAt;
  const endAt = assistantSubtitleState.audioEndAt;

  if (
    !playbackContext ||
    !graphemes.length ||
    !Number.isFinite(startAt) ||
    !Number.isFinite(endAt) ||
    endAt <= startAt
  ) {
    renderAssistantSubtitleWindow();
    return;
  }

  const now = playbackContext.currentTime;
  const elapsed = Math.max(0, now - startAt);
  const exactDuration = endAt - startAt;
  const playbackComplete =
    assistantSubtitleState.audioDone && now >= endAt - 0.02;
  let progress;

  if (assistantSubtitleState.audioDone && assistantSubtitleState.textDone) {
    progress = Math.max(0, Math.min(1, elapsed / exactDuration));
  } else {
    const estimatedDuration = Math.max(
      exactDuration,
      estimateSubtitleSpeechDuration(graphemes)
    );
    progress = Math.max(0, Math.min(0.98, elapsed / estimatedDuration));
  }

  const estimatedCursor = playbackComplete
    ? graphemes.length - 1
    : Math.floor(progress * graphemes.length);
  assistantSubtitleState.spokenCursor = Math.max(
    assistantSubtitleState.spokenCursor,
    Math.max(0, estimatedCursor)
  );
  renderAssistantSubtitleWindow({ playbackComplete });

  if (playbackComplete) {
    stopAssistantSubtitleTicker();
  }
}

function estimateSubtitleSpeechDuration(graphemes) {
  const speechUnits = graphemes.reduce((total, grapheme) => {
    if (/^\s$/u.test(grapheme)) return total + 0.08;
    if (/^[，。！？、；：,.!?;:]$/u.test(grapheme)) return total + 0.4;
    if (/^[\x00-\x7F]$/u.test(grapheme)) return total + 0.35;
    return total + 1;
  }, 0);
  return Math.max(0.8, speechUnits / DEFAULT_SPEECH_UNITS_PER_SECOND);
}

function initializeAssistantSubtitleObserver() {
  const phoneScreen = document.querySelector(".teacher-phone-screen");
  if (!phoneScreen || typeof ResizeObserver !== "function") return;
  assistantSubtitleState.observedWidth = phoneScreen.clientWidth;
  const observer = new ResizeObserver(([entry]) => {
    const nextWidth = Math.round(entry.contentRect.width);
    if (!nextWidth || nextWidth === assistantSubtitleState.observedWidth) return;
    assistantSubtitleState.observedWidth = nextWidth;
    assistantSubtitleState.capacity = null;
    assistantSubtitleState.anchor = Math.min(
      assistantSubtitleState.anchor,
      assistantSubtitleState.spokenCursor
    );
    renderAssistantSubtitleWindow();
  });
  observer.observe(phoneScreen);
}

function shouldClearCardsForProjection(message) {
  const groundingMode =
    message?.voice_projection?.grounding_mode ||
    message?.teaching_package?.grounding?.mode ||
    "";
  const cards = message?.ui_projection?.cards;
  return groundingMode === "model_prior" && (!Array.isArray(cards) || cards.length === 0);
}

async function toggleTalk() {
  if (!sessionReady) {
    setStatus("请先连接AI教师", true);
    setListeningState(false, "需先连接");
    setUserPreview("请先连接AI教师，再开始语音。", true);
    logEvent("client.voice.warning", { message: "Voice session is not ready." });
    return;
  }

  try {
    if (recording) {
      pauseMicrophoneKeepAlive();
    } else if (keepAliveTimer) {
      stopKeepAlive();
      await startRecording();
    } else {
      await startRecording();
    }
  } catch (error) {
    handleMicrophoneError(error);
  }
}

function handleMicrophoneError(error) {
  const message = microphoneErrorMessage(error);
  autoStartVoiceAfterConnect = false;
  if (ws || sessionReady || connectPromise) {
    disposeVoiceSession({
      error,
      statusText: "麦克风不可用，点击重试",
      stateLabel: "可重试",
      isError: true
    });
  } else {
    stopPendingMediaStream();
    stopRecording();
    setConnected(false);
    setStatus("麦克风不可用，点击重试", true);
    setListeningState(false, "可重试");
  }
  setUserPreview(message, true);
  logEvent("client.microphone.error", {
    name: error?.name || "Error",
    message: error?.message || String(error)
  });
}

function microphoneErrorMessage(error) {
  if (error?.code === "MICROPHONE_PERMISSION_TIMEOUT") {
    return "未收到麦克风授权。请在浏览器地址栏允许麦克风后重试。";
  }
  if (error?.name === "NotAllowedError") {
    return "浏览器没有麦克风权限，请允许 localhost 使用麦克风后再试。";
  }
  if (error?.name === "NotFoundError") {
    return "没有检测到可用麦克风，请检查输入设备。";
  }
  if (error?.name === "NotReadableError") {
    return "麦克风正在被其他应用占用，请关闭占用后再试。";
  }
  if (error?.name === "NotSupportedError") {
    return "当前浏览器不支持麦克风录音，请使用最新版 Chrome 或 Edge。";
  }
  return `麦克风启动失败：${error?.message || "未知错误"}`;
}

async function startRecording(preparedStream = null) {
  const nextMediaStream = preparedStream || (await requestMicrophoneStream());
  let nextAudioContext;
  let nextSourceNode;
  let nextInputNode;
  try {
    nextAudioContext = new AudioContext();
    if (nextAudioContext.state === "suspended") await nextAudioContext.resume();
    nextSourceNode = nextAudioContext.createMediaStreamSource(nextMediaStream);
    nextInputNode = nextAudioContext.createScriptProcessor(4096, 1, 1);
  } catch (error) {
    for (const track of nextMediaStream?.getTracks() || []) track.stop();
    nextAudioContext?.close().catch(() => {});
    throw error;
  }
  const inputSampleRate = nextAudioContext.sampleRate;
  voiceTurnCommitted = false;
  voiceTurnDetector = createVoiceTurnDetector({
    sampleRate: inputSampleRate,
    onCommit: commitDetectedVoiceTurn
  });
  voiceTurnDetector.reset();
  mediaStream = nextMediaStream;
  audioContext = nextAudioContext;
  sourceNode = nextSourceNode;
  inputNode = nextInputNode;
  nextSourceNode.connect(nextInputNode);
  nextInputNode.connect(nextAudioContext.destination);
  sampleAccumulator = [];
  recording = true;
  els.talkBtn.textContent = "停止通话";
  syncVoiceDock("正在听");
  setStatus("聆听中", false, true);
  setListeningState(true, "正在听");
  setUserPreview("正在听...", false);

  nextInputNode.onaudioprocess = (event) => {
    if (!recording || inputNode !== nextInputNode) return;
    const input = event.inputBuffer.getChannelData(0);
    for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel += 1) {
      event.outputBuffer.getChannelData(channel).fill(0);
    }
    const rms = Math.sqrt(input.reduce((sum, value) => sum + value * value, 0) / input.length);
    els.meterBar.style.width = `${Math.min(100, Math.round(rms * 260))}%`;
    voiceTurnDetector?.pushFrame(input, performance.now());
    if (!recording || inputNode !== nextInputNode) return;

    const pcm16 = downsampleToPcm16(input, inputSampleRate, 16000);
    for (const sample of pcm16) sampleAccumulator.push(sample);

    while (sampleAccumulator.length >= 320) {
      const frame = sampleAccumulator.splice(0, 320);
      send({
        type: "audio.append",
        audio: pcm16ToBase64(frame)
      });
    }
  };
}

function commitDetectedVoiceTurn(event) {
  if (!recording || voiceTurnCommitted || !sessionReady) return;
  voiceTurnCommitted = true;
  stopRecording();
  send({ type: "audio.commit" });
  startKeepAlive();
  setStatus("正在理解你的问题");
  setListeningState(false, "正在思考");
  logEvent("client.voice.turn.committed", {
    reason: event?.reason || "vad",
    speech_duration_ms: Math.max(0, Math.round(Number(event?.speechDurationMs) || 0))
  });
}

async function resumeContinuousVoice() {
  if (!continuousVoice || !sessionReady || recording || voiceStartPromise) return;
  if (textSpeechState.mode !== "idle") return;
  voiceStartPromise = startRecording()
    .catch((error) => {
      if (isMicrophoneFailure(error)) handleMicrophoneError(error);
      else handleVoiceConnectionError(error);
    })
    .finally(() => {
      voiceStartPromise = null;
    });
  await voiceStartPromise;
}

function pauseMicrophoneKeepAlive() {
  voiceTurnCommitted = true;
  stopRecording();
  send({ type: "audio.commit" });
  startKeepAlive();
  els.talkBtn.textContent = "开始通话";
  setStatus("已停止收音", false, true);
  setListeningState(false, "已停止收音");
}

function stopRecording() {
  const previousInputNode = inputNode;
  const previousSourceNode = sourceNode;
  const previousMediaStream = mediaStream;
  const previousAudioContext = audioContext;
  recording = false;
  if (!keepAliveTimer) els.talkBtn.textContent = "开始通话";
  els.meterBar.style.width = "0%";
  if (!keepAliveTimer) setListeningState(false, "待用户开口");
  inputNode = null;
  sourceNode = null;
  mediaStream = null;
  audioContext = null;
  if (previousInputNode) previousInputNode.onaudioprocess = null;
  previousInputNode?.disconnect();
  previousSourceNode?.disconnect();
  for (const track of previousMediaStream?.getTracks() || []) track.stop();
  previousAudioContext?.close().catch(() => {});
  syncVoiceDock("待用户开口");
}

function startKeepAlive() {
  stopKeepAlive();
  const silence = btoa(String.fromCharCode(...new Uint8Array(640)));
  keepAliveTimer = setInterval(() => {
    send({ type: "audio.append", audio: silence });
  }, 20);
}

function stopKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
  if (!recording) els.talkBtn.textContent = "开始通话";
}

function interrupt() {
  stopKeepAlive();
  stopPlayback();
  send({ type: "response.cancel" });
  // Do not depend on an upstream cancel acknowledgement to reopen the mic.
  // Some canceled responses never emit a terminal event, while the learner
  // still expects to speak immediately after pressing interrupt.
  voiceTurnDetector?.reset?.();
  voiceTurnCommitted = false;
  void resumeContinuousVoice();
}

function updateSession() {
  const config = buildSessionConfig();
  if (!config) return;
  send({ type: "session.update", config });
}

function handleVoiceSelectionChange() {
  const voiceId = els.voice.value.trim();
  const selectedOption = els.voice.selectedOptions?.[0];
  const shortcutSelect = document.querySelector("#teacherVoiceShortcut");
  const shortcutHasVoice = [...(shortcutSelect?.options || [])].some(
    (option) => option.value === voiceId
  );

  if (shortcutHasVoice && shortcutSelect.value !== voiceId) {
    shortcutSelect.value = voiceId;
    shortcutSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const shortcutLabel = shortcutHasVoice
    ? shortcutSelect.selectedOptions?.[0]?.textContent?.trim()
    : "";
  const voiceLabel = shortcutLabel || selectedOption?.textContent?.trim() || "新音色";

  if (!sessionReady || ws?.readyState !== WebSocket.OPEN) {
    pendingVoiceUpdateLabel = "";
    setStatus(`已选择${voiceLabel}，连接后生效`, false, true);
    return;
  }

  pendingVoiceUpdateLabel = voiceLabel;
  updateSession();
  setStatus(`正在切换为${voiceLabel}…`);
}

function forceCommit() {
  if (recording) {
    voiceTurnCommitted = true;
    stopRecording();
  }
  send({ type: "audio.commit" });
  startKeepAlive();
}

async function handleTeacherShortcut(button) {
  if (!button || button.getAttribute("aria-busy") === "true") return;
  const shortcutId = String(button.dataset.teacherShortcut || "").trim();
  button.setAttribute("aria-busy", "true");
  button.disabled = true;
  try {
    if (shortcutId === "oral-practice") {
      await loadEnglishPracticeCatalog();
      setEnglishPracticePicker(true, button);
      return;
    }
    const grounding = await prepareTeacherShortcutGrounding(
      shortcutId,
      button.dataset.teacherQuestion || ""
    );
    if (!grounding.artifacts.length) {
      const visibleQuery = button.dataset.teacherQuestion || "请根据本地资料帮我学习";
      const turn = appendTextConversationTurn(visibleQuery);
      completeTextConversationTurn(
        turn,
        "我还没有找到足够可靠的本地资料。请先 @ 一个知识点，或先在对话中告诉我你想学什么。"
      );
      setStatus("未检索到可靠的本地资料", true);
      return;
    }
    els.textQuestion.value = grounding.visibleQuery;
    await submitTextQuestion(grounding.visibleQuery, { shortcut: grounding });
  } catch (error) {
    setStatus(error?.message || "本地资料检索失败", true);
  } finally {
    button.removeAttribute("aria-busy");
    button.disabled = false;
  }
}

async function prepareTeacherShortcutGrounding(shortcutId, fallbackQuery) {
  const catalog = await loadLocalKnowledgeVisualCatalog();
  const latestKnowledgePointId = getLatestConversationKnowledgePointId();
  const preferredKnowledgePointId =
    selectedCurriculumKnowledgePointId || latestKnowledgePointId || "";
  const artifacts = [];
  const appendById = (knowledgePointId) => {
    const artifact = catalog.byKnowledgePointId.get(String(knowledgePointId || ""));
    if (!artifact || artifacts.some((item) => item.artifact_id === artifact.artifact_id)) return;
    artifacts.push(artifact);
  };

  if (shortcutId === "key-points" || shortcutId === "mindmap") {
    appendById(preferredKnowledgePointId);
    if (!artifacts.length) {
      const direct = resolveLocalKnowledgeVisual(catalog, fallbackQuery);
      if (direct) artifacts.push(direct);
    }
  } else if (shortcutId === "practice" || shortcutId === "mock-exam") {
    appendById(preferredKnowledgePointId);
    for (const note of readSessionList(WRONG_QUESTION_STORAGE_KEY)) {
      appendById(note.knowledge_point_id);
      if (shortcutId === "practice" && artifacts.length) break;
      if (shortcutId === "mock-exam" && artifacts.length >= 5) break;
    }
    if ((shortcutId === "practice" && !artifacts.length) || (shortcutId === "mock-exam" && artifacts.length < 5)) {
      const mastery = await loadLocalMasteryCatalog();
      const weakRecords = mastery.records
        .filter((record) => record.mastery_state === "weak")
        .sort((left, right) => {
          const probabilityGap = Number(left.mastery_probability ?? 1) - Number(right.mastery_probability ?? 1);
          if (probabilityGap) return probabilityGap;
          return Number(right.confidence || 0) - Number(left.confidence || 0);
        });
      for (const record of weakRecords) {
        appendById(record.knowledge_point_id);
        if (shortcutId === "practice" && artifacts.length >= 1) break;
        if (shortcutId === "mock-exam" && artifacts.length >= 5) break;
      }
    }
  }

  const limitedArtifacts = artifacts.slice(0, shortcutId === "mock-exam" ? 5 : 1);
  const firstTitle = limitedArtifacts[0]?.title || "";
  const visibleQuery = shortcutId === "key-points"
    ? `请讲讲“${firstTitle}”的重点`
    : shortcutId === "mindmap"
      ? `给我“${firstTitle}”的思维导图`
      : shortcutId === "practice"
        ? `请围绕“${firstTitle}”出一道练习题`
        : shortcutId === "mock-exam"
          ? "请根据我的本地薄弱知识点开始一次模拟测验"
          : String(fallbackQuery || "").trim();
  return { id: shortcutId, artifacts: limitedArtifacts, visibleQuery };
}

function getLatestConversationKnowledgePointId() {
  const history = getTextConversationHistory(textAgentState.activeSessionId);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const id = String(history[index]?.knowledgePointId || "").trim();
    if (id) return id;
  }
  return "";
}

function loadLocalMasteryCatalog() {
  if (!masteryCatalogRequest) {
    masteryCatalogRequest = import("./education-data-client.js")
      .then(async (module) => {
        const api = globalThis.EducationDataClient;
        if (!api) throw new Error("教育数据服务未初始化");
        if (api.getStatus?.("bootstrap") !== "ready") {
          await (api.bootstrap?.() || module.bootstrapEducationData());
        }
        const payload = api.getMastery?.() || module.getCurrentEducationMastery();
        if (!Array.isArray(payload?.records)) throw new Error("掌握度数据协议无效");
        return payload;
      })
      .catch((error) => {
        masteryCatalogRequest = null;
        throw error;
      });
  }
  return masteryCatalogRequest;
}

function loadEnglishPracticeCatalog() {
  if (!englishPracticeCatalogRequest) {
    englishPracticeCatalogRequest = fetch(ENGLISH_PRACTICE_SCENES_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error("口语练习场景读取失败");
        const payload = await response.json();
        if (
          payload.schema_version !== "speaking-practice-scenes@1.1" ||
          !Array.isArray(payload.scenes)
        ) {
          throw new Error("口语练习场景格式无效");
        }
        englishPracticeScenesById.clear();
        payload.scenes.forEach((scene) => {
          if (scene?.id && scene?.label && scene?.opening_text && Array.isArray(scene.instructions)) {
            englishPracticeScenesById.set(scene.id, Object.freeze({ ...scene }));
          }
        });
        return payload;
      })
      .catch((error) => {
        englishPracticeCatalogRequest = null;
        throw error;
      });
  }
  return englishPracticeCatalogRequest;
}

function setEnglishPracticePicker(open, trigger = null) {
  if (!els.englishPracticePicker) return;
  els.englishPracticePicker.hidden = !open;
  const oralTrigger = trigger || document.querySelector('[data-teacher-shortcut="oral-practice"]');
  oralTrigger?.setAttribute("aria-expanded", String(open));
  if (open) {
    window.setTimeout(() => els.englishPracticeButtons[0]?.focus(), 30);
  } else if (trigger) {
    trigger.focus();
  }
}

async function startEnglishPractice(sceneId) {
  const scene = englishPracticeScenesById.get(String(sceneId || ""));
  if (!scene) {
    setStatus("没有找到对应的本地口语练习场景", true);
    return;
  }
  activeEnglishPracticeScene = scene;
  setEnglishPracticePicker(false);
  applyEnglishPracticeSceneToInterface(scene);
  if (sessionReady || ws || connectPromise) closeSession();
  els.teacherVoiceModeBtn?.click();
  await handleVoicePrimaryAction();
}

function applyEnglishPracticeSceneToInterface(scene) {
  const languageLabel = scene.language_label || "英语";
  const listeningText = scene.listening_text || `等待你用${languageLabel}开口…`;
  const userPreview = scene.user_preview || `说出你的${languageLabel}回答`;
  const userPrompt = getSpeakingPracticeUserPrompt(scene);
  if (els.teacherConversationContext) {
    els.teacherConversationContext.textContent = `${scene.label} · 口语陪练`;
  }
  if (els.teacherVoiceOverlayTitle) {
    els.teacherVoiceOverlayTitle.textContent = `${scene.label}口语陪练`;
    els.teacherVoiceOverlayTitle.dataset.practiceLabel = `${scene.label}口语陪练`;
  }
  if (els.teacherVoiceOverlaySubtitle) {
    els.teacherVoiceOverlaySubtitle.textContent = "全双工对话 · 双方字幕";
  }
  els.partialTranscript.textContent = listeningText;
  setUserPreview(userPreview, true);
  setAssistantPreview(scene.opening_text, false);
  voiceUserTranscriptBuffer = "";
  queueVoiceSubtitle("user", userPrompt, "idle");
  queueVoiceSubtitle("assistant", scene.opening_text, "speaking");
}

function getSpeakingPracticeUserPrompt(scene = activeEnglishPracticeScene) {
  if (!scene) return "请开始说话";
  return scene.user_prompt || "请用英语回答 · Speak when you're ready";
}

function resetEnglishPracticeScene() {
  if (!activeEnglishPracticeScene) return;
  activeEnglishPracticeScene = null;
  if (els.teacherVoiceOverlayTitle) {
    delete els.teacherVoiceOverlayTitle.dataset.practiceLabel;
    const teacherName = document.querySelector("#teacherPersonaName")?.textContent?.trim() || "林老师";
    els.teacherVoiceOverlayTitle.textContent = `与${teacherName}语音交流`;
  }
  if (els.teacherVoiceOverlaySubtitle) {
    els.teacherVoiceOverlaySubtitle.textContent = "直接开口，我会跟随你的节奏";
  }
  if (els.teacherConversationContext) {
    els.teacherConversationContext.textContent = "初中数学 · 2022课标";
  }
  voiceUserTranscriptBuffer = "";
  queueVoiceSubtitle("user", "请开始说话", "idle");
  queueVoiceSubtitle("assistant", els.openingText.value.trim() || "你好，今天想学什么？", "idle");
}

function clearSelectedCurriculumKnowledgePoint() {
  selectedCurriculumKnowledgePointId = "";
  selectedCurriculumKnowledgePointLabel = "";
}

function getSelectedCurriculumKnowledgePointIdForText(text) {
  const id = String(selectedCurriculumKnowledgePointId || "").trim();
  const label = String(selectedCurriculumKnowledgePointLabel || "").trim();
  if (!id || !label) return "";
  return String(text || "").includes(`@${label}`) ? id : "";
}

async function sendTextQuestion() {
  if (currentIndustry === "education" && textAgentState.controller) {
    textAgentState.abortReason = "user";
    textAgentState.controller.abort();
    cancelActiveTextConversationTurn("本次回复已取消");
    setStatus("已取消当前回复");
    syncTextSendDisabled();
    return;
  }
  const text = els.textQuestion.value.trim();
  const attachmentController = getComposerAttachmentController("teacher");
  const attachmentItems = attachmentController?.getItems?.() || [];
  if (attachmentController?.isProcessing?.()) {
    setStatus("附件仍在读取，请稍候再发送");
    return;
  }
  if (attachmentController?.hasErrors?.()) {
    setStatus("有附件读取失败，请移除或重新添加后再发送", true);
    return;
  }
  if (!text && !attachmentItems.some((item) => item.status === "ready")) {
    return;
  }
  stopTextTts();
  stopComposerAsr({ abort: false });
  const hasImage = attachmentItems.some((item) => item.kind === "image" && item.status === "ready");
  const imageTaskMode = hasImage ? getTeacherImageTaskMode() : "auto";
  const imagePrompt = imageTaskMode === "grade"
    ? "请批改这页作业，标出对错并给出订正建议。"
    : imageTaskMode === "solve"
      ? "请识别并解答这道图片题，给出关键解题思路。"
      : "请识别这张图片，判断是拍题解答还是作业批改，并按对应方式处理。";
  const attachmentPrompt = hasImage ? imagePrompt : "请阅读我附上的文档，并结合当前课程回答。";
  await submitTextQuestion(text || attachmentPrompt);
}

async function submitTextQuestion(text, { shortcut = null } = {}) {
  if (currentIndustry === "education" && textAgentState.controller) {
    setStatus("请等待当前回复完成");
    return;
  }
  setTextInputSheet(false);
  lastUserQuery = text;
  lastAssistantResponse = "";
  lastA2UIResponseId = "";
  assistantBuffer = "";
  resetAssistantTextStreams();
  resetAssistantSubtitle();
  clearA2UI();
  setListeningState(false, "文本提问中");
  if (currentIndustry === "education") {
    const shortcutKnowledgePointId = String(shortcut?.artifacts?.[0]?.knowledge_point_id || "").trim();
    const requestedKnowledgePointId = shortcutKnowledgePointId
      || getSelectedCurriculumKnowledgePointIdForText(text);
    const turn = appendTextConversationTurn(text);
    if (shortcut?.artifacts?.length) {
      const primaryArtifact = shortcut.artifacts[0];
      turn.record.knowledgePointId = primaryArtifact.knowledge_point_id || "";
      turn.record.visualArtifactId = primaryArtifact.artifact_id || "";
      turn.record.shortcutId = shortcut.id || "";
    } else if (requestedKnowledgePointId) {
      turn.record.knowledgePointId = requestedKnowledgePointId;
    }
    // Only a knowledge point explicitly selected by the learner may be shown
    // provisionally. Free-form text must wait for the server's semantic match;
    // otherwise a lexical guess can flash the wrong card before no_match.
    if (turn.record.knowledgePointId || turn.record.visualArtifactId) {
      void hydrateTextConversationVisual(turn, { showRequestedMode: true });
    }
    clearSelectedCurriculumKnowledgePoint();
    await sendEducationAgentQuestion(text, turn, {
      shortcut,
      knowledgePointIdOverride: requestedKnowledgePointId
    });
    return;
  }
  setUserPreview(text, false);
  setAssistantPreview("正在生成回复...", false);
  send({ type: "speech.commit", text });
}

async function sendEducationAgentQuestion(text, turn, {
  shortcut = null,
  attachmentOverride = null,
  attachmentContextOverride = "",
  attachmentSummaryOverride = null,
  imageTaskModeOverride = "",
  knowledgePointIdOverride = ""
} = {}) {
  if (textAgentState.controller) {
    setStatus("请等待当前回复完成");
    return;
  }
  const sessionId = textAgentState.activeSessionId || "session-1";
  const requestSequence = textAgentState.requestSequence + 1;
  textAgentState.requestSequence = requestSequence;
  textAgentState.controller?.abort();
  const controller = new AbortController();
  textAgentState.controller = controller;
  textAgentState.abortReason = "";
  const originalText = String(text || "");
  if (els.textQuestion.value.trim() === originalText.trim()) {
    els.textQuestion.value = "";
  }
  syncTextSendDisabled();
  els.textQuestionBtn.setAttribute("aria-busy", "true");
  setStatus("AI教师正在思考");

  let responseStartTimer = null;
  try {
    const preparedAttachments = attachmentOverride
      ? { image: attachmentOverride, context: attachmentContextOverride, summary: attachmentSummaryOverride || [] }
      : await readTeacherAttachments();
    const attachment = preparedAttachments.image || null;
    const attachmentContext = String(preparedAttachments.context || "");
    const attachmentSummary = Array.isArray(preparedAttachments.summary) ? preparedAttachments.summary : [];
    const requestMessage = [String(text || "").trim(), attachmentContext].filter(Boolean).join("\n\n").slice(0, 12_000);
    const explicitImageTaskMode = normalizeImageTaskChoice(imageTaskModeOverride)?.id || "";
    const imageTaskMode = attachment
      ? explicitImageTaskMode || getTeacherImageTaskMode()
      : undefined;
    const skill = resolvePiLearningSkill({ text, shortcut, hasImage: Boolean(attachment) });
    if (attachment) {
      turn.record.questionImageUrl = `data:${attachment.mime_type};base64,${attachment.data}`;
      turn.record.questionImageName = attachment.name || "";
      turn.record.imageTaskMode = imageTaskMode;
      renderTurnQuestionImage(turn);
    }
    turn.record.questionDocuments = attachmentSummary.filter((item) => item.kind === "document");
    renderTurnQuestionDocuments(turn);
    // Attachment content is now owned by this conversation turn, so the
    // composer can reset before the slower model request begins. A photo-task
    // clarification retry passes attachmentOverride and keeps new selections.
    if (!attachmentOverride) {
      if (attachment || turn.record.questionDocuments.length) {
        document.dispatchEvent(new CustomEvent("teacher-attachment:clear"));
      }
    }
    responseStartTimer = window.setTimeout(() => {
      textAgentState.abortReason = "response_start_timeout";
      controller.abort();
    }, TEXT_AGENT_RESPONSE_START_TIMEOUT_MS);
    const response = await fetch("/api/agent/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        skill,
        message: requestMessage,
        conversation_id: textAgentState.conversations.get(getTextAgentSessionKey(sessionId)) || "",
        user_id: getTextAgentRequestUserId(),
        session_id: getTextAgentRequestSessionId(sessionId),
        course_scope_id: activeLearningScope?.scope_id || getRequestedLearningScopeId(),
        portal_role: getPortalRole(),
        continuation_context: textAgentState.continuationContexts.get(getTextAgentSessionKey(sessionId)) || undefined,
        online_search: { enabled: false },
        image: attachment,
        image_task_mode: imageTaskMode,
        knowledge_point_id: knowledgePointIdOverride || undefined,
        question_preferences: skill === "question_generator"
          ? {
              knowledge_point_id: knowledgePointIdOverride || undefined,
              count: shortcut?.id === "mock-exam" ? 3 : 1,
              question_type: "single_choice",
              adaptive: true
            }
          : undefined,
        shortcut: shortcut
          ? {
              id: shortcut.id,
              artifact_ids: shortcut.artifacts.map((artifact) => artifact.artifact_id),
              knowledge_point_ids: shortcut.artifacts.map((artifact) => artifact.knowledge_point_id)
            }
          : undefined,
        require_structured_response: Boolean(shortcut)
      }),
      signal: controller.signal
    });
    window.clearTimeout(responseStartTimer);
    responseStartTimer = null;
    const payload = await consumeAgentNdjsonResponse(response, {
      onDelta: (delta) => {
        if (
          requestSequence !== textAgentState.requestSequence ||
          sessionId !== textAgentState.activeSessionId
        ) {
          return;
        }
        appendTextConversationDelta(turn, delta);
      },
      onTrace: (event) => {
        if (
          requestSequence !== textAgentState.requestSequence ||
          sessionId !== textAgentState.activeSessionId
        ) {
          return;
        }
        appendTextConversationTrace(turn, event);
      },
      onStatus: (event) => {
        if (
          requestSequence !== textAgentState.requestSequence ||
          sessionId !== textAgentState.activeSessionId
        ) {
          return;
        }
        updateTextConversationStatus(turn, event);
      }
    });
    if (
      requestSequence !== textAgentState.requestSequence ||
      sessionId !== textAgentState.activeSessionId
    ) {
      return;
    }

    const answer = String(payload.display_answer || payload.answer || "").trim();
    if (!answer) throw new Error("AI教师没有返回可展示的回答");
    const conversationId = String(payload.conversation_id || "").trim();
    if (conversationId) {
      textAgentState.conversations.set(getTextAgentSessionKey(sessionId), conversationId);
    }
    assistantBuffer = answer;
    lastAssistantResponse = answer;
    const teachingPackage = payload.teaching_package && typeof payload.teaching_package === "object"
      ? payload.teaching_package
      : null;
    const trustedKnowledgeBinding = applyFinalTurnKnowledgeBinding(turn, teachingPackage);
    if (payload.trace_id) turn.record.traceId = String(payload.trace_id);
    turn.record.externalGrounding = normalizeExternalGrounding(payload.external_grounding);
    turn.record.answerAttribution = normalizeAgentAnswerAttribution(payload.answer_attribution)
      || turn.record.externalGrounding?.answerAttribution
      || null;
    turn.record.homeworkMark = payload.homework_mark && typeof payload.homework_mark === "object"
      ? payload.homework_mark
      : null;
    turn.record.imageTask = payload.image_task && typeof payload.image_task === "object"
      ? payload.image_task
      : null;
    turn.record.imageTaskClarification = normalizeImageTaskClarification(turn.record.imageTask);
    completeTextConversationTurn(turn, answer);
    renderTurnImageTaskClarification(turn);
    renderTurnExternalGrounding(turn);
    renderTurnHomeworkMark(turn);
    if (trustedKnowledgeBinding) {
      void hydrateTextConversationVisual(turn, { showRequestedMode: true });
    } else {
      clearA2UI();
    }
    if (trustedKnowledgeBinding && payload.ui_projection) {
      applyEducationUI(payload.ui_projection, { source: "pi_agent" });
    }
    setStatus("可以继续提问", false, true);
    setListeningState(false, "可继续提问");
    logEvent("text.agent.completed", {
      session_id: sessionId,
      conversation_id: conversationId,
      chat_id: String(payload.chat_id || ""),
      message_id: String(payload.message_id || ""),
      trace_id: String(payload.trace_id || ""),
      grading_session_id: String(payload.grading_session_id || sessionId),
      ui_mode: String(payload.ui_mode || "text_fallback"),
      skill: String(teachingPackage?.skill || skill),
      grounding_status: String(teachingPackage?.status || payload.grounding_status || ""),
      skipped_cards: Array.isArray(payload.ui_skipped_cards)
        ? payload.ui_skipped_cards.length
        : 0
    });
    return { ok: true, payload };
  } catch (error) {
    if (error?.name === "AbortError") {
      if (textAgentState.abortReason === "response_start_timeout") {
        const message = "AI教师未开始响应，请重试";
        failTextConversationTurn(turn, message);
        if (!els.textQuestion.value.trim()) els.textQuestion.value = originalText;
        setStatus("连接AI教师超时，请重试", true);
        setListeningState(false, "可重新提问");
      }
      return { ok: false, error };
    }
    if (
      requestSequence !== textAgentState.requestSequence ||
      sessionId !== textAgentState.activeSessionId
    ) {
      return;
    }
    const message = error?.message || "AI教师暂时无法回复，请稍后重试";
    controller.abort();
    failTextConversationTurn(turn, message);
    if (!els.textQuestion.value.trim()) els.textQuestion.value = originalText;
    setStatus("回复失败，请重试", true);
    setListeningState(false, "可重新提问");
    logEvent("text.agent.error", { session_id: sessionId, message });
    return { ok: false, error };
  } finally {
    if (responseStartTimer) window.clearTimeout(responseStartTimer);
    if (requestSequence === textAgentState.requestSequence) {
      textAgentState.controller = null;
      textAgentState.abortReason = "";
      if (textAgentState.activeTurn?.record?.id === turn?.record?.id) {
        textAgentState.activeTurn = null;
      }
      syncTextSendDisabled();
      els.textQuestionBtn.removeAttribute("aria-busy");
    }
  }
}

function getTeacherImageTaskMode() {
  const mode = String(els.teacherAttachmentInput?.dataset.imageTaskMode || "auto").trim().toLowerCase();
  return ["solve", "grade"].includes(mode) ? mode : "auto";
}

function resolvePiLearningSkill({ text, shortcut, hasImage }) {
  if (hasImage) return "photo_solver";
  if (["practice", "mock-exam"].includes(shortcut?.id)) return "question_generator";
  if (/(?:出|生成|来|练|测|考)\s*(?:一|两|三|几|\d+)?\s*(?:道|组)?(?:题|练习|测验)|考考我|模拟测验/iu.test(String(text || ""))) {
    return "question_generator";
  }
  return "knowledge_tutor";
}

async function readTeacherAttachments() {
  const controller = getComposerAttachmentController("teacher");
  if (!controller) return { image: null, documents: [], context: "", summary: [] };
  return controller.prepare({ maxDocumentCharacters: 8_000 });
}

function initializeTextConversationThread() {
  if (!els.conversationLog || !els.studentTurnTemplate || !els.teacherTurnTemplate) return;
  renderTextConversationHistory(textAgentState.activeSessionId);
}

function getTextConversationHistory(sessionId, create = false) {
  const normalizedSessionId = normalizeClientSessionId(sessionId) || "session-1";
  const scopedSessionId = getTextAgentSessionKey(normalizedSessionId);
  if (!textAgentState.histories.has(scopedSessionId) && create) {
    textAgentState.histories.set(scopedSessionId, []);
  }
  return textAgentState.histories.get(scopedSessionId) || [];
}

function normalizeTextAgentContinuationContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = (entry, maxLength = 1_200) => String(entry || "").trim().slice(0, maxLength);
  const normalized = {
    source_kind: text(value.source_kind, 40),
    source_id: text(value.source_id, 160),
    source_date: text(value.source_date, 20),
    course_id: text(value.course_id, 120),
    course_name: text(value.course_name, 100),
    title: text(value.title, 160),
    summary: text(value.summary, 2_000),
    last_user_message: text(value.last_user_message, 1_200),
    last_teacher_message: text(value.last_teacher_message, 2_000),
    knowledge_point_ids: Array.isArray(value.knowledge_point_ids)
      ? value.knowledge_point_ids.map((item) => text(item, 160)).filter(Boolean).slice(0, 12)
      : []
  };
  return Object.values(normalized).some((entry) => Array.isArray(entry) ? entry.length : Boolean(entry))
    ? normalized
    : null;
}

// TRUSTED_KNOWLEDGE_BINDING_HELPERS_START
// These helpers are intentionally DOM-free: the server decision, rather than
// a local text/card guess, is the sole authority for a completed turn binding.
function resolveTrustedKnowledgeBinding(teachingPackage) {
  if (!teachingPackage || typeof teachingPackage !== "object" || teachingPackage.status !== "answered") {
    return null;
  }
  const knowledgePointId = (Array.isArray(teachingPackage.knowledge_point_ids)
    ? teachingPackage.knowledge_point_ids
    : [])
    .map((value) => String(value || "").trim())
    .find((value) => value && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value));
  if (!knowledgePointId) return null;
  const trustedCard = (Array.isArray(teachingPackage.cards) ? teachingPackage.cards : []).find((card) => {
    const ref = String(card?.ref || "").trim();
    const cardKnowledgePointId = String(card?.knowledge_point_id || "").trim();
    const trustedSource = !card?.source || card.source === "trusted_registry";
    return ref && trustedSource && (!cardKnowledgePointId || cardKnowledgePointId === knowledgePointId);
  });
  return {
    status: "answered",
    knowledgePointId,
    visualArtifactId: String(trustedCard?.ref || "").trim(),
    inputValues: normalizeTrustedCardInputValues(trustedCard?.input_values),
    source: "server_grounded_teaching_package",
  };
}

function normalizeTrustedCardInputValues(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, entry] of Object.entries(value).slice(0, 32)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key)) continue;
    if (["string", "number", "boolean"].includes(typeof entry)
      && (typeof entry !== "number" || Number.isFinite(entry))) {
      output[key] = entry;
    }
  }
  return output;
}

function settleTurnKnowledgeBinding(record, teachingPackage, statusOverride = "") {
  if (!record || typeof record !== "object") return null;
  const finalStatus = String(statusOverride || teachingPackage?.status || "tool_error").trim() || "tool_error";
  const binding = resolveTrustedKnowledgeBinding(teachingPackage);
  record.groundingStatus = finalStatus;
  if (!binding) {
    record.knowledgeBindingState = "rejected";
    record.trustedKnowledgeBinding = null;
    record.knowledgePointId = "";
    record.visualArtifactId = "";
    return null;
  }
  record.knowledgeBindingState = "trusted";
  record.trustedKnowledgeBinding = { ...binding };
  record.knowledgePointId = binding.knowledgePointId;
  record.visualArtifactId = binding.visualArtifactId;
  return record.trustedKnowledgeBinding;
}

function hasTrustedKnowledgeBinding(record) {
  const binding = record?.trustedKnowledgeBinding;
  return record?.knowledgeBindingState === "trusted"
    && binding?.status === "answered"
    && Boolean(binding.knowledgePointId)
    && binding.knowledgePointId === record.knowledgePointId;
}
// TRUSTED_KNOWLEDGE_BINDING_HELPERS_END

function applyFinalTurnKnowledgeBinding(runtime, teachingPackage, statusOverride = "") {
  if (!runtime?.record) return null;
  const binding = settleTurnKnowledgeBinding(runtime.record, teachingPackage, statusOverride);
  localVisualControllers.get(runtime.assistantElement)?.destroy();
  localVisualControllers.delete(runtime.assistantElement);
  runtime.assistantElement?.querySelector(".local-turn-visual-mount")?.remove();
  if (runtime.assistantElement) {
    if (binding) runtime.assistantElement.dataset.knowledgePointId = binding.knowledgePointId;
    else delete runtime.assistantElement.dataset.knowledgePointId;
  }
  if (!binding) {
    runtime.record.localVisualMode = "";
    runtime.record.localVisualOpen = false;
    clearA2UI();
  }
  syncTeacherTurnActions(runtime);
  return binding;
}

function appendTextConversationTurn(userText) {
  const sessionId = textAgentState.activeSessionId || "session-1";
  const record = {
    id: `text-turn-${Date.now()}-${textAgentState.nextTurnId++}`,
    sessionId,
    requestSessionId: getTextAgentRequestSessionId(sessionId),
    requestUserId: getTextAgentRequestUserId(),
    startedAt: new Date().toISOString(),
    completedAt: "",
    traceId: "",
    userText: String(userText || "").trim(),
    assistantText: "",
    status: "pending",
    groundingStatus: "pending",
    knowledgeBindingState: "pending",
    trustedKnowledgeBinding: null,
    knowledgePointId: "",
    visualArtifactId: "",
    shortcutId: "",
    localVisualMode: "",
    localVisualOpen: false,
    savedToMistakes: false,
    questionImageUrl: "",
    questionImageName: "",
    questionDocuments: [],
    imageTask: null,
    imageTaskClarification: null,
    imageTaskChoicePending: "",
    imageTaskResolvedMode: "",
    answerAttribution: null,
    externalGrounding: null,
    homeworkMark: null,
    trace: [],
    agentStatus: ""
  };
  getTextConversationHistory(sessionId, true).push(record);
  els.liveUserMessage.textContent = record.userText;
  els.userMessageRow?.classList.add("is-muted");
  const runtime = mountTextConversationTurn(record, { attachCards: true });
  textAgentState.activeTurn = runtime;
  scrollConversationToTurn(runtime.assistantElement, { force: true });
  return runtime;
}

function mountTextConversationTurn(record, { attachCards = false } = {}) {
  const userFragment = els.studentTurnTemplate?.content?.cloneNode(true);
  const assistantFragment = els.teacherTurnTemplate?.content?.cloneNode(true);
  const userElement = userFragment?.querySelector?.(".conversation-turn.user");
  const assistantElement = assistantFragment?.querySelector?.(".conversation-turn.assistant");
  if (!userElement || !assistantElement || !els.conversationLog) return null;
  if (!record.sessionId) record.sessionId = textAgentState.activeSessionId || "session-1";
  if (!record.knowledgeBindingState) {
    record.knowledgeBindingState = record.trustedKnowledgeBinding
      ? "trusted"
      : ["pending", "streaming"].includes(record.status) ? "pending" : "rejected";
  }

  userElement.dataset.textTurnId = record.id;
  assistantElement.dataset.textTurnId = record.id;
  renderUserMessageInto(userElement.querySelector(".message-content"), userElement, record.userText);
  const assistantContent = assistantElement.querySelector(".assistant-text");
  const status = assistantElement.querySelector(".turn-status");
  status.textContent = record.status === "streaming" ? "正在输入" : "正在思考";
  if (record.status === "pending") {
    assistantElement.classList.add("is-pending");
  } else if (record.status === "streaming") {
    assistantElement.classList.add("is-streaming");
    const parsed = renderAgentAnswerInto(assistantContent, assistantElement, record.assistantText);
    syncAgentVisualReference(record, parsed);
  } else if (record.status === "completed") {
    const parsed = renderAgentAnswerInto(assistantContent, assistantElement, record.assistantText);
    syncAgentVisualReference(record, parsed);
  } else {
    assistantContent.textContent = record.assistantText;
    assistantElement.classList.add(record.status === "error" ? "is-error" : "is-canceled");
  }

  const insertionPoint = els.conversationLog.querySelector(".live-caption-strip");
  els.conversationLog.insertBefore(userElement, insertionPoint);
  els.conversationLog.insertBefore(assistantElement, insertionPoint);
  if (attachCards) attachLearningContentToTurn(assistantElement);
  const runtime = { record, userElement, assistantElement, assistantContent };
  renderTurnQuestionImage(runtime);
  renderTurnQuestionDocuments(runtime);
  renderTurnAnswerAttribution(runtime);
  renderTextConversationTrace(runtime);
  syncTeacherTurnActions(runtime);
  renderTurnImageTaskClarification(runtime);
  renderTurnExternalGrounding(runtime);
  renderTurnHomeworkMark(runtime);
  if (record.localVisualOpen) void hydrateTextConversationVisual(runtime, { showRequestedMode: false });
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  return runtime;
}

function renderTurnQuestionImage(runtime) {
  const target = runtime?.userElement?.querySelector?.(".message-content");
  if (!target || !runtime?.record) return;
  target.querySelector(".turn-question-image")?.remove();
  runtime.userElement.classList.remove("has-question-image");
  const attachment = questionImageAttachmentFromDataUrl(runtime.record.questionImageUrl, {
    name: runtime.record.questionImageName || "question-image",
  });
  if (!attachment) return;

  const figure = document.createElement("figure");
  figure.className = "turn-question-image";
  const image = document.createElement("img");
  image.src = `data:${attachment.mime_type};base64,${attachment.data}`;
  image.alt = attachment.name && attachment.name !== "question-image"
    ? `你上传的图片：${attachment.name}`
    : "你上传的题目图片";
  image.decoding = "async";
  figure.append(image);
  target.prepend(figure);
  runtime.userElement.classList.add("has-question-image");
}

function renderTurnQuestionDocuments(runtime) {
  const target = runtime?.userElement?.querySelector?.(".message-content");
  if (!target || !runtime?.record) return;
  target.querySelector(".turn-question-documents")?.remove();
  const documents = Array.isArray(runtime.record.questionDocuments)
    ? runtime.record.questionDocuments.filter((item) => item?.name).slice(0, 4)
    : [];
  runtime.userElement.classList.toggle("has-question-documents", documents.length > 0);
  if (!documents.length) return;
  const list = document.createElement("div");
  list.className = "turn-question-documents";
  list.setAttribute("aria-label", "本轮参考文档");
  documents.forEach((documentItem) => {
    const chip = document.createElement("span");
    const icon = document.createElement("i");
    icon.dataset.lucide = documentItem.format === "pptx" ? "presentation" : "file-text";
    icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("b");
    name.textContent = String(documentItem.name || "参考文档");
    chip.append(icon, name);
    list.append(chip);
  });
  target.prepend(list);
  window.lucide?.createIcons?.({ root: list, attrs: { "stroke-width": 1.8 } });
}

function attachLearningContentToTurn(assistantElement) {
  if (!els.learningContentMount || !assistantElement) return;
  const placeholder = assistantElement.querySelector(".message-card-rail");
  if (placeholder && placeholder !== els.learningContentMount) {
    placeholder.replaceWith(els.learningContentMount);
  } else {
    assistantElement.querySelector(".message-bubble")?.append(els.learningContentMount);
  }
}

function renderTurnImageTaskClarification(runtime) {
  if (!runtime?.assistantElement || !runtime?.record) return;
  runtime.assistantElement.querySelector(".image-task-clarification")?.remove();
  if (runtime.record.imageTaskResolvedMode) return;
  const clarification = runtime.record.imageTaskClarification?.options
    ? runtime.record.imageTaskClarification
    : normalizeImageTaskClarification(runtime.record.imageTask);
  runtime.record.imageTaskClarification = clarification;
  if (!clarification || !runtime.record.questionImageUrl) return;

  const container = document.createElement("div");
  container.className = "image-task-clarification";
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", clarification.prompt);
  const label = document.createElement("span");
  label.className = "image-task-clarification-label";
  label.textContent = "选择处理方式";
  const actions = document.createElement("div");
  actions.className = "image-task-clarification-actions";
  const pendingMode = normalizeImageTaskChoice(runtime.record.imageTaskChoicePending)?.id || "";
  clarification.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.imageTaskChoice = option.id;
    button.disabled = Boolean(pendingMode);
    button.setAttribute("aria-busy", String(pendingMode === option.id));
    button.setAttribute("aria-label", pendingMode === option.id
      ? `正在按${option.label}处理`
      : `按${option.label}处理这张图片`);
    const icon = document.createElement("i");
    icon.dataset.lucide = option.id === "grade" ? "file-check-2" : "scan-search";
    icon.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.textContent = pendingMode === option.id ? "正在处理…" : option.label;
    button.append(icon, copy);
    actions.append(button);
  });
  container.append(label, actions);

  const bubble = runtime.assistantElement.querySelector(".message-bubble");
  const rail = bubble?.querySelector(".message-card-rail, .ai-learning-content-mount");
  if (rail) bubble.insertBefore(container, rail);
  else bubble?.append(container);
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

async function handleImageTaskClarificationChoice(button) {
  const mode = normalizeImageTaskChoice(button?.dataset?.imageTaskChoice);
  const assistantElement = button?.closest?.(".conversation-turn.assistant");
  const record = findTextConversationRecord(assistantElement?.dataset?.textTurnId);
  if (!mode || !assistantElement || !record || record.imageTaskChoicePending) return;
  if (record.sessionId !== textAgentState.activeSessionId) return;
  if (textAgentState.controller) {
    setStatus("请等待当前回复完成");
    return;
  }
  const attachment = questionImageAttachmentFromDataUrl(record.questionImageUrl, {
    name: `photo-${mode.id}`,
  });
  if (!attachment) {
    setStatus("原图已失效，请重新上传图片", true);
    return;
  }

  record.imageTaskChoicePending = mode.id;
  renderTurnImageTaskClarification({ record, assistantElement });
  const prompt = buildImageTaskChoicePrompt(mode.id);
  const followUpTurn = appendTextConversationTurn(prompt);
  followUpTurn.record.questionImageUrl = record.questionImageUrl;
  followUpTurn.record.questionImageName = record.questionImageName || "";
  followUpTurn.record.imageTaskMode = mode.id;
  const result = await sendEducationAgentQuestion(prompt, followUpTurn, {
    attachmentOverride: attachment,
    imageTaskModeOverride: mode.id,
  });
  record.imageTaskChoicePending = "";
  if (result?.ok) {
    record.imageTaskResolvedMode = mode.id;
    record.imageTaskClarification = null;
    setStatus(`已按${mode.label}处理`, false, true);
    logEvent("image_task.clarification_resolved", {
      source_turn_id: record.id,
      resolved_mode: mode.id,
    });
  }
  renderTurnImageTaskClarification({ record, assistantElement });
}

function normalizeExternalGrounding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const answerAttribution = normalizeAgentAnswerAttribution(value);
  const richResults = normalizeAgentExternalRichResults(
    value.rich_results || value.richResults
  );
  const candidates = [
    ...(Array.isArray(value.references) ? value.references : []),
    ...(Array.isArray(value.search_results) ? value.search_results : [])
  ];
  const references = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const url = safeExternalReferenceUrl(candidate.url || candidate.link);
    const title = String(candidate.title || candidate.name || "联网资料").trim().slice(0, 240);
    const key = url || `${title}:${candidate.site_name || ""}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    references.push({
      id: String(candidate.id || "").trim().slice(0, 160),
      title,
      url,
      siteName: String(candidate.site_name || candidate.siteName || candidate.site || "").trim().slice(0, 120),
      publishTime: String(candidate.publish_time || candidate.publishTime || candidate.published_at || "").trim().slice(0, 80)
    });
    if (references.length >= 12) break;
  }
  if (!references.length && richResults.isEmpty && !answerAttribution) return null;
  return {
    mode: String(value.mode || "external_web").trim().slice(0, 80),
    references,
    richResults,
    answerAttribution
  };
}

function renderTurnAnswerAttribution(runtime) {
  if (!runtime?.assistantElement || !runtime?.record) return null;
  const metadata = runtime.assistantElement.querySelector(".message-meta");
  if (!metadata) return null;
  const attribution = runtime.record.status === "completed"
    ? normalizeAgentAnswerAttribution(runtime.record.answerAttribution)
      || normalizeAgentAnswerAttribution(runtime.record.externalGrounding)
    : null;
  runtime.record.answerAttribution = attribution;
  return mountAgentAnswerAttribution(metadata, attribution);
}

function safeExternalReferenceUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function renderTurnExternalGrounding(runtime) {
  if (!runtime?.assistantElement || !runtime?.record) return;
  runtime.assistantElement.querySelector(".turn-external-grounding")?.remove();
  runtime.assistantElement.querySelector(".agent-external-rich-results")?.remove();
  const grounding = normalizeExternalGrounding(runtime.record.externalGrounding);
  runtime.record.externalGrounding = grounding;
  if (!grounding) return;
  const bubble = runtime.assistantElement.querySelector(".message-bubble");
  const rail = bubble?.querySelector(".message-card-rail");
  if (!grounding.richResults?.isEmpty) {
    const richMount = document.createElement("div");
    mountAgentExternalRichResults(richMount, grounding.richResults);
    if (rail) bubble.insertBefore(richMount, rail);
    else bubble?.append(richMount);
  }
  if (!grounding.references.length) {
    window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
    return;
  }
  const details = document.createElement("details");
  details.className = "turn-external-grounding";
  const summary = document.createElement("summary");
  const icon = document.createElement("i");
  icon.dataset.lucide = "globe-2";
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = grounding.answerAttribution
    ? "豆包爱学参考来源"
    : "联网来源";
  const count = document.createElement("small");
  count.textContent = `${grounding.references.length} 条`;
  summary.append(icon, label, count);
  const list = document.createElement("ol");
  grounding.references.forEach((reference) => {
    const item = document.createElement("li");
    const copy = document.createElement("span");
    const title = reference.url ? document.createElement("a") : document.createElement("b");
    title.textContent = reference.title;
    if (reference.url) {
      title.href = reference.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
      title.referrerPolicy = "no-referrer";
    }
    const meta = document.createElement("small");
    meta.textContent = [reference.siteName, reference.publishTime].filter(Boolean).join(" · ") || "外部网页";
    copy.append(title, meta);
    item.append(copy);
    list.append(item);
  });
  details.append(summary, list);
  if (rail) bubble.insertBefore(details, rail);
  else bubble?.append(details);
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function renderTurnHomeworkMark(runtime) {
  if (!runtime?.assistantElement || !runtime?.record) return;
  const previous = runtime.assistantElement.querySelector(".homework-mark-mount");
  homeworkMarkControllers.get(previous)?.destroy?.();
  previous?.remove();
  if (!runtime.record.homeworkMark) return;
  const mount = document.createElement("div");
  const bubble = runtime.assistantElement.querySelector(".message-bubble");
  const rail = bubble?.querySelector(".message-card-rail");
  if (rail) bubble.insertBefore(mount, rail);
  else bubble?.append(mount);
  const controller = mountHomeworkMark(mount, runtime.record.homeworkMark, {
    fallbackImageUrl: runtime.record.questionImageUrl || ""
  });
  if (!controller) {
    mount.remove();
    return;
  }
  homeworkMarkControllers.set(mount, controller);
}

function handleHomeworkMarkEvent(event) {
  const mark = event.detail?.homeworkMark || event.detail?.homework_mark || event.detail?.mark;
  if (!mark || typeof mark !== "object") return;
  const requestedTurnId = String(event.detail?.turnId || event.detail?.turn_id || "").trim();
  const record = requestedTurnId
    ? findTextConversationRecord(requestedTurnId)
    : [...getTextConversationHistory(textAgentState.activeSessionId)].reverse()
      .find((item) => ["pending", "streaming", "completed"].includes(item.status));
  if (!record) return;
  record.homeworkMark = mark;
  const assistantElement = [...(els.conversationLog?.querySelectorAll("[data-text-turn-id].assistant") || [])]
    .find((element) => element.dataset.textTurnId === record.id);
  if (!assistantElement) return;
  renderTurnHomeworkMark({
    record,
    assistantElement,
    assistantContent: assistantElement.querySelector(".assistant-text")
  });
}

function returnLearningContentToWelcome() {
  const welcomeBubble = els.assistantMessageRow?.querySelector(".message-bubble");
  if (els.learningContentMount && welcomeBubble) welcomeBubble.append(els.learningContentMount);
}

function appendTextConversationDelta(runtime, delta) {
  if (!runtime?.record || !delta) return;
  const followBottom = isConversationNearBottom();
  runtime.record.status = "streaming";
  runtime.record.assistantText += String(delta);
  runtime.assistantElement.classList.remove("is-pending", "is-error", "is-canceled");
  runtime.assistantElement.classList.add("is-streaming");
  const status = runtime.assistantElement.querySelector(".turn-status");
  if (status) status.textContent = "正在输入";
  const parsed = renderAgentAnswerInto(
    runtime.assistantContent,
    runtime.assistantElement,
    runtime.record.assistantText
  );
  syncAgentVisualReference(runtime.record, parsed);
  if (followBottom) {
    scrollConversationToTurn(runtime.assistantElement, { force: true, behavior: "auto" });
  }
}

function appendTextConversationTrace(runtime, event) {
  if (!runtime?.record) return;
  const trace = Array.isArray(runtime.record.trace) ? runtime.record.trace : [];
  const entry = normalizeAgentTraceEvent(event, { index: trace.length });
  const previous = trace.at(-1);
  if (previous?.stage === entry.stage && previous?.message === entry.message) return;
  trace.push(entry);
  runtime.record.trace = trace.slice(-64);
  if (entry.traceId) runtime.record.traceId = entry.traceId;
  runtime.record.agentStatus = entry.message;
  const status = runtime.assistantElement.querySelector(".turn-status");
  if (status && ["pending", "streaming"].includes(runtime.record.status)) {
    status.textContent = entry.message;
  }
  renderTextConversationTrace(runtime);
}

function updateTextConversationStatus(runtime, event) {
  if (!runtime?.record) return;
  const message = String(event?.message || "AI教师正在处理")
    .replace(/[\r\n\t]+/gu, " ")
    .trim()
    .slice(0, 80);
  runtime.record.agentStatus = message;
  const status = runtime.assistantElement.querySelector(".turn-status");
  if (status && ["pending", "streaming"].includes(runtime.record.status)) status.textContent = message;
}

function renderTextConversationTrace(runtime) {
  return syncAgentTraceView(runtime);
}

function completeTextConversationTurn(runtime, answer) {
  if (!runtime?.record) return;
  runtime.record.status = "completed";
  runtime.record.completedAt = new Date().toISOString();
  runtime.record.assistantText = String(answer || "").trim();
  runtime.assistantElement.classList.remove("is-pending", "is-streaming", "is-error", "is-canceled");
  const parsed = renderAgentAnswerInto(
    runtime.assistantContent,
    runtime.assistantElement,
    runtime.record.assistantText
  );
  syncAgentVisualReference(runtime.record, parsed);
  renderTurnAnswerAttribution(runtime);
  renderTextConversationTrace(runtime);
  syncTeacherTurnActions(runtime);
  scrollConversationToTurn(runtime.assistantElement);
  document.dispatchEvent(new CustomEvent("ai-teacher:turn-completed", {
    detail: {
      sessionId: runtime.record.sessionId || textAgentState.activeSessionId,
      completedAt: runtime.record.completedAt,
      userText: runtime.record.userText,
      assistantText: runtime.record.assistantText,
      knowledgePointId: runtime.record.knowledgePointId || ""
    }
  }));
}

function failTextConversationTurn(runtime, message) {
  if (!runtime?.record) {
    setAssistantPreview(message, false);
    return;
  }
  runtime.record.status = "error";
  runtime.record.answerAttribution = null;
  applyFinalTurnKnowledgeBinding(runtime, null, "tool_error");
  runtime.record.completedAt = new Date().toISOString();
  runtime.record.assistantText = String(message || "AI教师暂时无法回复");
  runtime.assistantElement.classList.remove("is-pending", "is-streaming", "is-canceled");
  runtime.assistantElement.classList.add("is-error");
  runtime.assistantContent.textContent = runtime.record.assistantText;
  renderTurnAnswerAttribution(runtime);
  const status = runtime.assistantElement.querySelector(".turn-status");
  if (status) status.textContent = "回复失败";
  appendTextConversationTrace(runtime, {
    stage: "request.failed",
    message: runtime.record.assistantText,
    elapsed_ms: runtime.record.trace?.at(-1)?.elapsedMs || 0
  });
  scrollConversationToTurn(runtime.assistantElement);
}

function cancelActiveTextConversationTurn(message = "本次回复已取消") {
  const runtime = textAgentState.activeTurn;
  if (!runtime?.record) return;
  runtime.record.status = "canceled";
  runtime.record.answerAttribution = null;
  applyFinalTurnKnowledgeBinding(runtime, null, "canceled");
  runtime.record.completedAt = new Date().toISOString();
  runtime.record.assistantText = String(message);
  runtime.assistantElement.classList.remove("is-pending", "is-streaming", "is-error");
  runtime.assistantElement.classList.add("is-canceled");
  runtime.assistantContent.textContent = runtime.record.assistantText;
  renderTurnAnswerAttribution(runtime);
  const status = runtime.assistantElement.querySelector(".turn-status");
  if (status) status.textContent = "已取消";
  appendTextConversationTrace(runtime, {
    stage: "request.cancelled",
    message: "用户已取消本轮回复",
    elapsed_ms: runtime.record.trace?.at(-1)?.elapsedMs || 0
  });
  textAgentState.activeTurn = null;
}

function renderTextConversationHistory(sessionId) {
  if (!els.conversationLog) return;
  returnLearningContentToWelcome();
  els.conversationLog.querySelectorAll("[data-text-turn-id].assistant").forEach((node) => {
    localVisualControllers.get(node)?.destroy();
    localVisualControllers.delete(node);
  });
  els.conversationLog.querySelectorAll("[data-text-turn-id]").forEach((node) => node.remove());
  textAgentState.activeTurn = null;
  const welcome = getIndustryPreset("education").previewAssistantText || "你好，今天想学什么？";
  setUserPreview("", true);
  setAssistantPreview(welcome, false);
  const history = getTextConversationHistory(sessionId);
  history.forEach((record, index) => {
    mountTextConversationTurn(record, { attachCards: index === history.length - 1 });
  });
  if (history.length) {
    const last = els.conversationLog.querySelector('[data-text-turn-id].assistant:last-of-type') ||
      [...els.conversationLog.querySelectorAll('[data-text-turn-id].assistant')].at(-1);
    scrollConversationToTurn(last, { force: true, behavior: "auto" });
  }
}

async function handleTeacherTurnAction(event) {
  const imageTaskChoice = event.target?.closest?.("[data-image-task-choice]");
  if (imageTaskChoice && els.conversationLog?.contains(imageTaskChoice)) {
    await handleImageTaskClarificationChoice(imageTaskChoice);
    return;
  }
  const button = event.target?.closest?.("[data-teacher-turn-action]");
  if (!button || !els.conversationLog?.contains(button)) return;
  if (button.dataset.teacherTurnAction === "speak") {
    const assistantElement = button.closest(".conversation-turn.assistant");
    const spokenText = assistantElement?.querySelector(".assistant-text")?.textContent || "";
    toggleTeacherTts(button, spokenText);
    return;
  }
  if (getPortalRole() === "teacher" && button.dataset.teacherTurnAction !== "knowledge-network") {
    setStatus("课堂预览不会写入学生记录");
    return;
  }
  const assistantElement = button.closest(".conversation-turn.assistant");
  const turnId = assistantElement?.dataset.textTurnId;
  const record = findTextConversationRecord(turnId);
  if (!record || record.status !== "completed") {
    setStatus("先提出一个知识问题，完成回复后即可使用", true);
    return;
  }
  if (!hasTrustedKnowledgeBinding(record)) {
    setStatus("当前回复未确认精确知识点，不能写入学习记录", true);
    return;
  }
  const runtime = {
    record,
    assistantElement,
    assistantContent: assistantElement.querySelector(".assistant-text")
  };
  if (button.getAttribute("aria-busy") === "true") return;
  const actionSessionId = record.sessionId || textAgentState.activeSessionId || "session-1";
  button.setAttribute("aria-busy", "true");
  button.disabled = true;
  try {
    if (button.dataset.teacherTurnAction === "knowledge-network") {
      if (record.localVisualOpen && record.localVisualMode === "mindmap") {
        closeTurnLocalVisual(runtime);
        setStatus("已收起知识网络");
      } else {
        record.localVisualMode = "mindmap";
        record.localVisualOpen = true;
        const mounted = await hydrateTextConversationVisual(runtime, { showRequestedMode: false });
        if (actionSessionId !== textAgentState.activeSessionId || !runtime.assistantElement.isConnected) return;
        if (!mounted) record.localVisualOpen = false;
        setStatus(mounted ? "已打开本地知识网络" : "未匹配到对应知识点", !mounted);
      }
    } else if (button.dataset.teacherTurnAction === "add-to-mistakes") {
      await toggleTurnMistakeNote(runtime, actionSessionId);
    }
  } catch (error) {
    setStatus(error?.message || "本地学习内容暂时无法打开", true);
  } finally {
    button.removeAttribute("aria-busy");
    button.disabled = false;
    if (runtime.assistantElement.isConnected && actionSessionId === textAgentState.activeSessionId) {
      syncTeacherTurnActions(runtime);
    }
  }
}

async function hydrateTextConversationVisual(runtime, { showRequestedMode = false } = {}) {
  if (!runtime?.record || !runtime?.assistantElement?.isConnected) return false;
  const catalog = await loadLocalKnowledgeVisualCatalog();
  if (!runtime.assistantElement.isConnected) return false;
  if (runtime.record.knowledgeBindingState === "rejected") return false;
  const artifact = resolveTurnVisualArtifact(catalog, runtime.record);
  if (!artifact) return false;
  runtime.record.knowledgePointId = artifact.knowledge_point_id;
  runtime.record.visualArtifactId = artifact.artifact_id;
  runtime.assistantElement.dataset.knowledgePointId = artifact.knowledge_point_id;
  if (showRequestedMode) {
    const requestedMode = inferLocalKnowledgeVisualMode(runtime.record.userText);
    if (requestedMode) {
      runtime.record.localVisualMode = requestedMode;
      runtime.record.localVisualOpen = true;
    }
  }
  if (!runtime.record.localVisualOpen) {
    syncTeacherTurnActions(runtime);
    return true;
  }
  const desiredMode = runtime.record.localVisualMode || "mindmap";
  const existing = localVisualControllers.get(runtime.assistantElement);
  const existingArtifactId = existing?.element?.dataset?.artifactId;
  if (!existing || existingArtifactId !== artifact.artifact_id || existing.mode !== desiredMode) {
    mountTurnLocalVisual(runtime, artifact, desiredMode);
  }
  syncTeacherTurnActions(runtime);
  return true;
}

function resolveTurnVisualArtifact(catalog, record) {
  if (record.knowledgeBindingState === "rejected") return null;
  if (record.knowledgeBindingState === "trusted") {
    const binding = hasTrustedKnowledgeBinding(record) ? record.trustedKnowledgeBinding : null;
    if (!binding) return null;
    if (binding.visualArtifactId && catalog.byArtifactId.has(binding.visualArtifactId)) {
      const artifact = catalog.byArtifactId.get(binding.visualArtifactId);
      if (artifact?.knowledge_point_id === binding.knowledgePointId) return artifact;
    }
    return catalog.byKnowledgePointId.get(binding.knowledgePointId) || null;
  }
  if (record.visualArtifactId && catalog.byArtifactId.has(record.visualArtifactId)) {
    return catalog.byArtifactId.get(record.visualArtifactId);
  }
  if (record.knowledgePointId && catalog.byKnowledgePointId.has(record.knowledgePointId)) {
    return catalog.byKnowledgePointId.get(record.knowledgePointId);
  }
  const sessionId = record.sessionId || textAgentState.activeSessionId;
  const history = getTextConversationHistory(sessionId);
  const currentIndex = history.findIndex((item) => item.id === record.id);
  const followUp = isLocalKnowledgeFollowUpQuery(record.userText);
  if (!followUp) {
    const fromQuestion = resolveLocalKnowledgeVisual(catalog, record.userText);
    if (fromQuestion) return fromQuestion;
  }
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const previousId = history[index]?.visualArtifactId;
    if (previousId && catalog.byArtifactId.has(previousId)) return catalog.byArtifactId.get(previousId);
  }
  return resolveLocalKnowledgeVisual(catalog, `${record.userText}\n${String(record.assistantText || "").slice(0, 600)}`);
}

function mountTurnLocalVisual(runtime, artifact, mode) {
  const assistantElement = runtime.assistantElement;
  localVisualControllers.get(assistantElement)?.destroy();
  localVisualControllers.delete(assistantElement);
  assistantElement.querySelector(".local-turn-visual-mount")?.remove();
  const mount = document.createElement("div");
  mount.className = "local-turn-visual-mount";
  const bubble = assistantElement.querySelector(".message-bubble");
  const cardRail = bubble?.querySelector(".message-card-rail, .ai-learning-content-mount");
  if (cardRail) bubble.insertBefore(mount, cardRail);
  else bubble?.append(mount);
  const controller = mountLocalKnowledgeVisual(mount, artifact, {
    initialMode: mode,
    compact: true,
    inputValues: runtime.record.trustedKnowledgeBinding?.inputValues || {},
    onModeChange: (nextMode) => {
      runtime.record.localVisualMode = nextMode;
      syncTeacherTurnActions(runtime);
    },
    onClose: () => {
      closeTurnLocalVisual(runtime);
      syncTeacherTurnActions(runtime);
    }
  });
  if (!controller) {
    mount.remove();
    return;
  }
  localVisualControllers.set(assistantElement, controller);
}

function closeTurnLocalVisual(runtime) {
  runtime.record.localVisualOpen = false;
  localVisualControllers.get(runtime.assistantElement)?.destroy();
  localVisualControllers.delete(runtime.assistantElement);
  runtime.assistantElement.querySelector(".local-turn-visual-mount")?.remove();
  syncTeacherTurnActions(runtime);
}

async function toggleTurnMistakeNote(runtime, sessionId) {
  const catalog = await loadLocalKnowledgeVisualCatalog();
  const artifact = resolveTurnVisualArtifact(catalog, runtime.record);
  if (!artifact) throw new Error("未匹配到可收藏的知识点");
  runtime.record.knowledgePointId = artifact.knowledge_point_id;
  runtime.record.visualArtifactId = artifact.artifact_id;
  const notes = readSessionList(WRONG_QUESTION_STORAGE_KEY);
  const key = `${sessionId}:${runtime.record.id}`;
  const currentIndex = notes.findIndex((item) => item.key === key);
  const nextNotes = notes.slice();
  const willRemove = currentIndex >= 0;
  if (currentIndex >= 0) {
    nextNotes.splice(currentIndex, 1);
  } else {
    nextNotes.unshift({
      key,
      session_id: sessionId,
      turn_id: runtime.record.id,
      knowledge_point_id: artifact.knowledge_point_id,
      knowledge_point_name: artifact.title,
      question: runtime.record.userText.slice(0, 1000),
      answer: runtime.record.assistantText.slice(0, 2000),
      created_at: new Date().toISOString()
    });
  }
  if (!writeSessionList(WRONG_QUESTION_STORAGE_KEY, nextNotes.slice(0, 120))) {
    throw new Error("错题集保存失败，请检查浏览器存储空间");
  }
  runtime.record.savedToMistakes = !willRemove;
  if (sessionId === textAgentState.activeSessionId) {
    setStatus(willRemove ? "已从错题集移除" : "已加入错题集");
  }
  document.dispatchEvent(new CustomEvent("learning-records:change", { detail: { kind: "wrong-question" } }));
}

function findTextConversationRecord(turnId) {
  if (!turnId) return null;
  return getTextConversationHistory(textAgentState.activeSessionId).find((record) => record.id === turnId) || null;
}

function syncTeacherTurnActions(runtime) {
  if (!runtime?.assistantElement || !runtime?.record) return;
  const speak = runtime.assistantElement.querySelector('[data-teacher-turn-action="speak"]');
  const network = runtime.assistantElement.querySelector('[data-teacher-turn-action="knowledge-network"]');
  const mistake = runtime.assistantElement.querySelector('[data-teacher-turn-action="add-to-mistakes"]');
  const trusted = runtime.record.status === "completed" && hasTrustedKnowledgeBinding(runtime.record);
  if (speak) {
    const playable = runtime.record.status === "completed" && Boolean(runtime.record.assistantText?.trim());
    speak.disabled = !playable;
    speak.setAttribute("aria-disabled", String(!playable));
  }
  for (const button of [network, mistake]) {
    if (!button) continue;
    button.disabled = !trusted;
    button.setAttribute("aria-disabled", String(!trusted));
  }
  network?.setAttribute("aria-pressed", String(runtime.record.localVisualOpen && runtime.record.localVisualMode === "mindmap"));
  mistake?.setAttribute("aria-pressed", String(Boolean(runtime.record.savedToMistakes)));
}

function readSessionList(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(getUserScopedStorageKey(key)) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeSessionList(key, value) {
  try {
    sessionStorage.setItem(getUserScopedStorageKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isConversationNearBottom() {
  const scroller = document.querySelector(".ai-dialogue-body");
  if (!scroller) return true;
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 180;
}

function scrollConversationToTurn(element, { force = false, behavior = "smooth" } = {}) {
  if (!element || (!force && !isConversationNearBottom())) return;
  pendingConversationScroll = { element, behavior };
  if (conversationScrollFrame) return;
  conversationScrollFrame = window.requestAnimationFrame(() => {
    const pending = pendingConversationScroll;
    conversationScrollFrame = 0;
    pendingConversationScroll = null;
    pending?.element?.scrollIntoView({ block: "end", behavior: pending.behavior });
  });
}

function getOrCreateTextAgentUserId() {
  const storageKey = "ai-classroom:user-id";
  const selectedStudentKey = "ai-classroom:current-student-id:v1";
  try {
    const selectedStudentId = normalizeClientSessionId(localStorage.getItem(selectedStudentKey));
    if (selectedStudentId) {
      sessionStorage.setItem(storageKey, selectedStudentId);
      return selectedStudentId;
    }
    const current = normalizeClientSessionId(sessionStorage.getItem(storageKey));
    if (current) return current;
    const created = `learner-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return `learner-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function getActivePortalRole() {
  return document.body?.dataset?.portalRole === "teacher" ? "teacher" : "student";
}

function getTextAgentRequestUserId(userId = textAgentState.userId) {
  const safeUserId = normalizeClientSessionId(userId) || "anonymous";
  return getActivePortalRole() === "teacher" ? `teacher-preview:${safeUserId}` : safeUserId;
}

function getTextAgentRequestSessionId(sessionId) {
  const safeSessionId = normalizeClientSessionId(sessionId) || "session-1";
  return getActivePortalRole() === "teacher" ? `teacher-preview:${safeSessionId}` : safeSessionId;
}

function getTextAgentSessionKey(sessionId, userId = textAgentState.userId) {
  const safeUserId = normalizeClientSessionId(userId) || "anonymous";
  const safeSessionId = normalizeClientSessionId(sessionId) || "session-1";
  return `${getActivePortalRole()}::${safeUserId}::${safeSessionId}`;
}

function getUserScopedStorageKey(baseKey, userId = textAgentState.userId) {
  const safeUserId = normalizeClientSessionId(userId) || "anonymous";
  return `${String(baseKey || "ai-classroom:data")}:${safeUserId}`;
}

function normalizeClientSessionId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:@-]/gu, "")
    .slice(0, 160);
}

function syncTextSendDisabled(voiceConnected = sessionReady) {
  if (!els.textQuestionBtn) return;
  if (currentIndustry === "education") {
    els.textQuestionBtn.disabled = false;
    const active = Boolean(textAgentState.controller);
    els.textQuestionBtn.dataset.requestActive = active ? "true" : "false";
    els.textQuestionBtn.setAttribute("aria-label", active ? "取消当前回复" : "发送问题");
    els.textQuestionBtn.title = active ? "取消当前回复" : "发送";
    return;
  }
  els.textQuestionBtn.disabled = !voiceConnected;
}

function renderAgentAnswerPreview(markdown) {
  renderAgentAnswerInto(els.assistantText, els.assistantMessageRow, markdown);
}

function renderAgentAnswerInto(target, messageRow, markdown) {
  return renderStructuredAgentAnswer(target, messageRow, markdown);
}

function renderUserMessageInto(target, messageRow, markdown) {
  const parsed = renderStructuredAgentAnswer(target, messageRow, markdown);
  // User text is untrusted display input. The shared renderer safely creates
  // DOM/text nodes for Markdown and LaTeX, but its visual-ref side channel is
  // reserved for a server-grounded assistant package.
  if (target?.dataset) delete target.dataset.visualRefs;
  return { ...parsed, visualRefs: [] };
}

function syncAgentVisualReference(record, parsed) {
  if (!record || record.visualArtifactId || record.knowledgeBindingState !== "pending") return;
  const visualRef = Array.isArray(parsed?.visualRefs) ? parsed.visualRefs[0] : "";
  if (visualRef) record.visualArtifactId = visualRef;
}

async function renderA2UIForTurn({ force = false, responseId = "", answer = "" } = {}) {
  if (currentIndustry === "education") {
    const text = els.textQuestion.value.trim() || lastUserQuery;
    if (!text) {
      setStatus("请先输入一个问题", true);
      return;
    }
    lastUserQuery = text;
    setUserPreview(text, false);
    await previewEducationKnowledge(text);
    return;
  }

  if (responseId && responseId === lastA2UIResponseId) return;

  const query = force ? els.textQuestion.value.trim() || lastUserQuery : lastUserQuery;
  if (!query) {
    setStatus("请先输入一个问题", true);
    return;
  }

  const hadSurface = !els.a2uiPanel.hidden;
  const resolvedAnswer =
    answer || lastAssistantResponse || "";
  setA2UILoading(true, hadSurface);
  try {
    const response = await fetch("/a2ui/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        industry: currentIndustry,
        query,
        answer: resolvedAnswer,
        force
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    if (!payload.render) {
      clearA2UI();
      return;
    }

    if (!a2uiRenderer.applyMessages(payload.messages)) throw new Error("A2UI surface render failed");
    els.a2uiSurfaceTitle.textContent = payload.title || "结构化回答";
    els.a2uiSourceBadge.textContent = payload.mode === "answer_driven" ? "本次回答" : "推荐内容";
    els.a2uiSourceBadge.classList.toggle("is-answer", payload.mode === "answer_driven");
    els.a2uiPanel.hidden = false;
    els.a2uiPanel.closest(".call-canvas")?.classList.add("has-a2ui");
    if (responseId) lastA2UIResponseId = responseId;
    logEvent("a2ui.surface.rendered", {
      surfaceId: payload.surfaceId,
      template: payload.template,
      mode: payload.mode,
      version: "v0.9"
    });
    if (force) setStatus("内容已准备", false, true);
  } catch (error) {
    clearA2UI();
    setStatus("内容生成失败，请重试", true);
    logEvent("a2ui.render.error", { message: error.message });
  } finally {
    setA2UILoading(false);
  }
}

async function previewEducationKnowledge(query, artifactIds = []) {
  const text = String(query || "").trim();
  if (!text) return null;
  clearA2UI();
  setA2UILoading(true);
  setStatus("正在查找相关知识");

  try {
    const response = await fetch("/api/education/knowledge/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: text.slice(0, 2000),
        artifact_ids: Array.isArray(artifactIds) ? artifactIds : [],
        top_k: 3
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    if (typeof payload.active_question_id === "string") {
      activeEducationQuestionId = payload.active_question_id;
    }

    if (payload.result?.status === "matched") {
      applyEducationUI(payload.ui, {
        activeQuestionId: payload.active_question_id,
        source: "knowledge_preview"
      });
      setAssistantPreview(
        sessionReady
          ? "AI教师会结合当前知识为你讲解。"
          : "连接AI教师后即可继续。",
        false
      );
      setStatus("已找到相关知识", false, true);
      setListeningState(false, sessionReady ? "卡片已准备" : "待连接");
    } else {
      clearA2UI();
      setAssistantPreview(
        sessionReady
          ? "AI教师会继续为你解答。"
          : "连接AI教师后即可继续提问。",
        false
      );
      setStatus("可以继续提问", false, true);
      setListeningState(false, sessionReady ? "可继续提问" : "待连接");
    }
    return payload;
  } catch (error) {
    clearA2UI();
    setStatus("资料查找失败，请重试", true);
    setAssistantPreview(
      sessionReady
        ? "AI教师会继续为你解答。"
        : "请稍后再试。",
      false
    );
    setListeningState(false, sessionReady ? "可继续提问" : "待连接");
    logEvent("education.knowledge.error", { message: error.message });
    return null;
  } finally {
    setA2UILoading(false);
  }
}

async function previewEducationGrade(payload) {
  const action = payload?.action || {};
  const context = action.context || {};
  try {
    const response = await fetch("/api/education/grade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question_id: context.question_id || activeEducationQuestionId,
        selected: context.value,
        active_question_id: activeEducationQuestionId
      })
    });
    const responsePayload = await response.json();
    if (!response.ok) {
      throw new Error(responsePayload.message || `HTTP ${response.status}`);
    }
    activeEducationQuestionId = responsePayload.active_question_id || "";
    applyEducationUI(responsePayload.ui, {
      activeQuestionId: responsePayload.active_question_id,
      source: "offline_grade"
    });
    const result = responsePayload.result || {};
    if (result.status === "graded") {
      setAssistantPreview(
        result.correct
          ? `回答正确。${result.explanation || ""}`
          : `这次选择不正确，正确答案是 ${result.correct_answer || "待确认"}。${result.explanation || ""}`,
        false
      );
      setStatus("已完成确定性判题", false, true);
      setListeningState(false, sessionReady ? "可继续提问" : "待连接");
    } else {
      setStatus("当前没有可判定的题目", true);
    }
    return responsePayload;
  } catch (error) {
    setStatus("判题失败", true);
    setAssistantPreview("判题工具暂时不可用，请重试；系统不会猜测答案。", false);
    setListeningState(false, sessionReady ? "可继续提问" : "待连接");
    logEvent("education.grade.error", { message: error.message });
    return null;
  }
}

async function previewKnowledgeMaterialGrade(payload) {
  const action = payload?.action || {};
  const context = action.context || {};
  const bundleId = String(context.bundle_id || "").trim();
  const questionId = String(context.question_id || "").trim();
  const selected = context.value;
  if (!bundleId || !questionId || selected == null) {
    setStatus("素材判题参数不完整", true);
    return null;
  }

  try {
    const response = await fetch("/api/knowledge/materials/grade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bundle_id: bundleId,
        question_id: questionId,
        selected
      })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || `HTTP ${response.status}`);
    }

    const attemptsRemaining = Number(result.attempts_remaining);
    const locked =
      result.correct === true ||
      result.finalized === true ||
      (Number.isFinite(attemptsRemaining) && attemptsRemaining <= 0);
    a2uiRenderer.patchEducationCard(context.card_id, {
      state: {
        status: result.correct ? "correct" : "incorrect",
        selected,
        correct: Boolean(result.correct),
        locked,
        attempts_remaining: Number.isFinite(attemptsRemaining)
          ? Math.max(0, attemptsRemaining)
          : undefined
      },
      props: {
        explanation: result.explanation || ""
      },
      meta: {
        badge: result.correct
          ? "回答正确"
          : locked
            ? "本题已结束"
            : "可再尝试"
      }
    });
    setAssistantPreview(
      result.correct
        ? `回答正确。${result.explanation || ""}`
        : `这次选择不正确。${result.explanation || "请根据提示再想一想。"}`,
      false
    );
    setStatus(
      result.correct ? "素材题判定正确" : locked ? "素材题已结束" : "还可再试一次",
      false,
      true
    );
    return result;
  } catch (error) {
    setStatus("素材判题失败", true);
    setAssistantPreview(error?.message || "判题服务暂不可用，请稍后重试。", false);
    logEvent("knowledge.material.grade.error", { message: error.message });
    return null;
  }
}

function applyEducationUI(
  ui,
  { activeQuestionId = undefined, source = "knowledge_tool" } = {}
) {
  if (typeof activeQuestionId === "string") {
    activeEducationQuestionId = activeQuestionId;
  }
  if (!ui || ui.clear === true) {
    clearA2UI();
    return false;
  }
  const canPatchCurrentSurface =
    ui.mode === "patch" &&
    els.a2uiSurfaceRoot.dataset.surfaceId === ui.surface_id;
  const messages =
    ui.mode === "patch" &&
    !canPatchCurrentSurface &&
    Array.isArray(ui.fallback_messages)
      ? ui.fallback_messages
      : Array.isArray(ui.messages)
        ? ui.messages
        : [];
  if (!messages.length) {
    clearA2UI();
    return false;
  }
  if (!a2uiRenderer.applyMessages(messages)) {
    clearA2UI();
    setStatus("教学卡片无法渲染", true);
    logEvent("education.a2ui.error", { message: "A2UI render failed", source });
    return false;
  }
  els.a2uiPanel.hidden = false;
  els.a2uiPanel.closest(".call-canvas")?.classList.add("has-a2ui");
  els.a2uiSurfaceTitle.textContent = "本轮教学卡片";
  els.a2uiSourceBadge.textContent =
    source === "offline_grade"
      ? "确定性判题"
      : source === "text_agent" || source === "pi_agent"
        ? "学习卡片"
        : "知识工具";
  els.a2uiSourceBadge.classList.add("is-answer");
  logEvent("education.ui.rendered", {
    source,
    surfaceId: ui.surface_id || "",
    cardCount: Array.isArray(ui.cards) ? ui.cards.length : 0
  });
  return true;
}

async function compileKnowledgeSource() {
  const file = els.knowledgeFile?.files?.[0];
  const manualText = els.knowledgeSourceText?.value.trim() || "";
  if (!file && !manualText) {
    els.knowledgeCompileStatus.textContent = "请选择文件或输入一段文本";
    return;
  }

  const sourceType = inferKnowledgeSourceType(file);
  let extractedText = manualText;
  if (!extractedText && file && (sourceType === "text" || file.type.startsWith("text/"))) {
    extractedText = (await file.text()).slice(0, 100000);
  }

  els.knowledgeCompileBtn.disabled = true;
  els.knowledgeCompileStatus.textContent = "正在模拟抽取、切片、建索引并生成卡片素材…";
  try {
    const response = await fetch("/api/knowledge/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_type: sourceType,
        title: file?.name || "粘贴文本",
        name: file?.name || "粘贴文本",
        mime_type: file?.type || "text/plain",
        size: file?.size || extractedText.length,
        content: extractedText,
        metadata: {
          mocked: true,
          original_name: file?.name || "粘贴文本"
        }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    const artifact = payload.artifact || payload;
    els.knowledgeCompileStatus.textContent = `已编译：${artifact.title || artifact.source?.name || "知识产物"}`;
    await loadKnowledgeArtifacts();
    const introductionQuery = `请介绍刚编译的知识产物：${artifact.title || artifact.artifact_id}`;
    if (sessionReady && ws?.readyState === WebSocket.OPEN) {
      lastUserQuery = introductionQuery;
      setUserPreview(introductionQuery, false);
      setAssistantPreview("正在结合新知识生成讲解...", false);
      send({ type: "text.query", text: introductionQuery });
    } else {
      await previewEducationKnowledge(introductionQuery, [artifact.artifact_id]);
    }
  } catch (error) {
    els.knowledgeCompileStatus.textContent = `编译失败：${error.message}`;
    logEvent("knowledge.compile.error", { message: error.message });
  } finally {
    els.knowledgeCompileBtn.disabled = false;
  }
}

function openKnowledgeFilePicker() {
  if (!els.knowledgeFile) return;
  knowledgePickerState.pending = true;
  knowledgePickerState.scrollTop = els.editorScroll?.scrollTop || 0;
  els.knowledgeFile.value = "";
  try {
    els.knowledgeFile.click();
  } catch (error) {
    settleKnowledgeFilePicker({ cancelled: true });
    logEvent("knowledge.file_picker.error", { message: error.message });
  }
}

function handleKnowledgeFileChange() {
  const file = els.knowledgeFile?.files?.[0] || null;
  settleKnowledgeFilePicker({ cancelled: !file, file });
}

function handleKnowledgePickerWindowFocus() {
  if (!knowledgePickerState.pending) return;
  window.setTimeout(() => {
    if (!knowledgePickerState.pending) return;
    const file = els.knowledgeFile?.files?.[0] || null;
    settleKnowledgeFilePicker({ cancelled: !file, file });
  }, 180);
}

function settleKnowledgeFilePicker({ cancelled = false, file = null } = {}) {
  if (!knowledgePickerState.pending && !file) return;
  knowledgePickerState.pending = false;
  els.knowledgeFile?.blur();

  if (file) {
    if (els.knowledgeFileName) els.knowledgeFileName.textContent = file.name;
    if (els.knowledgeCompileStatus) {
      els.knowledgeCompileStatus.textContent = `已选择：${file.name}`;
    }
  } else if (cancelled) {
    if (els.knowledgeFileName) els.knowledgeFileName.textContent = "选择文件";
    if (els.knowledgeCompileStatus) {
      els.knowledgeCompileStatus.textContent = "已取消文件选择，页面状态已恢复";
    }
  }

  requestAnimationFrame(() => {
    if (els.editorScroll) {
      els.editorScroll.scrollTop = knowledgePickerState.scrollTop;
    }
    els.knowledgeFilePickerBtn?.focus({ preventScroll: true });
  });
}

function toggleKnowledgeCatalog(forceOpen) {
  if (!els.knowledgeCatalogPanel || !els.knowledgeCatalogBtn) return;
  const shouldOpen =
    typeof forceOpen === "boolean" ? forceOpen : els.knowledgeCatalogPanel.hidden;
  els.knowledgeCatalogPanel.hidden = !shouldOpen;
  els.knowledgeCatalogBtn.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen && !knowledgeCatalogLoaded) {
    void loadKnowledgeCatalog();
  }
}

async function loadKnowledgeCatalog() {
  if (!els.knowledgeCatalogStatus) return;
  els.knowledgeCatalogStatus.classList.remove("is-error");
  els.knowledgeCatalogStatus.textContent = "正在读取当前知识目录…";
  try {
    const response = await fetch("/api/teacher/knowledge/catalog");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    renderKnowledgeCatalog(payload);
    knowledgeCatalogLoaded = true;
  } catch (error) {
    knowledgeCatalogLoaded = false;
    els.knowledgeCatalogStatus.classList.add("is-error");
    els.knowledgeCatalogStatus.textContent = `读取失败：${error.message}。收起后可再次打开重试。`;
    logEvent("knowledge.catalog.error", { message: error.message });
  }
}

function renderKnowledgeCatalog(catalog = {}) {
  const retrieval = catalog.active_retrieval || {};
  const knowledge = catalog.knowledge || {};
  const counts = retrieval.counts || {};
  const limitations = Array.isArray(retrieval.limitations)
    ? retrieval.limitations
    : [];

  els.knowledgeCatalogStatus.classList.remove("is-error");
  els.knowledgeCatalogStatus.textContent =
    `当前 teacher_turn 使用“${retrieval.strategy || "确定性规则"}”匹配，` +
    `不是向量检索。${limitations.join("；")}`;

  renderKnowledgeMetrics([
    { value: counts.claims ?? 0, label: "知识 Claim" },
    { value: counts.evidence ?? 0, label: "依据来源" },
    { value: counts.materials ?? 0, label: "卡片素材" },
    { value: counts.assessments ?? 0, label: "题目" }
  ]);

  renderKnowledgeRecords(
    els.knowledgeClaimsList,
    knowledge.claims,
    (item) => ({
      title: item.claim_id || "Knowledge Claim",
      body: item.text || "",
      meta: retrieval.topic_id || ""
    })
  );
  renderKnowledgeRecords(
    els.knowledgeEvidenceList,
    knowledge.evidence,
    (item) => ({
      title: item.title || item.evidence_id || "Evidence",
      body: item.excerpt || "",
      meta: `${item.source_type || "mock"} · ${item.locator || item.evidence_id || ""}`
    })
  );
  renderKnowledgeRecords(
    els.knowledgeMaterialsList,
    knowledge.materials,
    (item) => ({
      title:
        item.presentation?.title ||
        item.content?.title ||
        item.material_id ||
        "Card Material",
      body: summarizeKnowledgeContent(item.content),
      meta: `${item.material_type || "material"} · ${(item.supported_card_types || []).join(", ")}`
    })
  );
  renderKnowledgeRecords(
    els.knowledgeAssessmentList,
    knowledge.assessments,
    (item) => ({
      title: item.title || item.question_id || "Question",
      body: [
        item.prompt || "",
        ...(item.options || []).map(
          (option) => `${option.id || option.value}. ${option.label || ""}`
        )
      ]
        .filter(Boolean)
        .join(" / "),
      meta: `${item.question_id || ""}${item.hint ? ` · 提示：${item.hint}` : ""}`
    })
  );

  if (els.knowledgeMetadataJson) {
    els.knowledgeMetadataJson.textContent = JSON.stringify(
      {
        catalog_version: catalog.catalog_version,
        active_retrieval: retrieval,
        compiled_preview: catalog.compiled_preview || {}
      },
      null,
      2
    );
  }
}

function renderKnowledgeMetrics(items) {
  if (!els.knowledgeCatalogSummary) return;
  els.knowledgeCatalogSummary.replaceChildren();
  for (const item of items) {
    const metric = document.createElement("div");
    metric.className = "knowledge-catalog-metric";
    const value = document.createElement("b");
    const label = document.createElement("span");
    value.textContent = String(item.value);
    label.textContent = item.label;
    metric.append(value, label);
    els.knowledgeCatalogSummary.append(metric);
  }
}

function renderKnowledgeRecords(container, items, describe) {
  if (!container) return;
  container.replaceChildren();
  const records = Array.isArray(items) ? items : [];
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "knowledge-record";
    empty.textContent = "暂无内容";
    container.append(empty);
    return;
  }

  for (const item of records) {
    const description = describe(item) || {};
    const record = document.createElement("article");
    record.className = "knowledge-record";
    const title = document.createElement("b");
    const body = document.createElement("p");
    const meta = document.createElement("small");
    title.textContent = description.title || "未命名内容";
    body.textContent = description.body || "";
    meta.textContent = description.meta || "";
    record.append(title, body, meta);
    container.append(record);
  }
}

function summarizeKnowledgeContent(content = {}) {
  return (
    content.summary ||
    content.body ||
    content.prompt ||
    content.caption ||
    content.message ||
    content.formula ||
    (Array.isArray(content.branches)
      ? content.branches.map((branch) => branch.title).filter(Boolean).join("、")
      : "") ||
    "结构化卡片素材"
  );
}

async function loadKnowledgeArtifacts() {
  if (!els.knowledgeArtifactList) return;
  try {
    const response = await fetch("/api/knowledge/artifacts");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    renderKnowledgeArtifacts(payload.artifacts || []);
  } catch (error) {
    els.knowledgeArtifactList.textContent = "等待知识编译服务启动";
  }
}

function renderKnowledgeArtifacts(artifacts) {
  els.knowledgeArtifactList.replaceChildren();
  for (const artifact of artifacts.slice(0, 6)) {
    const item = document.createElement("div");
    item.className = "artifact-item";
    const copy = document.createElement("div");
    const title = document.createElement("b");
    const meta = document.createElement("span");
    title.textContent = artifact.title || artifact.source?.name || artifact.artifact_id;
    meta.textContent = `${artifact.source_type || artifact.source?.type || "text"} · ${
      artifact.knowledge_units?.length || 0
    } 个知识单元`;
    copy.append(title, meta);
    const status = document.createElement("span");
    status.className = "artifact-status";
    if (artifact.status === "compiled") {
      status.classList.add("is-preview");
      status.textContent = "Mock 预览";
    } else {
      status.textContent = artifact.status || "处理中";
    }
    item.append(copy, status);
    els.knowledgeArtifactList.append(item);
  }
}

function inferKnowledgeSourceType(file) {
  if (!file) return "text";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  return "text";
}

function setA2UILoading(loading, preserveSurface = false) {
  els.a2uiPanel.classList.toggle("is-loading", loading);
  if (!loading) {
    els.a2uiPanel.removeAttribute("aria-busy");
    return;
  }
  if (!els.a2uiPanel.hidden && preserveSurface) {
    els.a2uiPanel.setAttribute("aria-busy", "true");
  }
}

function clearA2UI() {
  a2uiRenderer.clear();
  els.a2uiPanel.hidden = true;
  els.a2uiPanel.closest(".call-canvas")?.classList.remove("has-a2ui");
  els.a2uiSurfaceTitle.textContent =
    currentIndustry === "education" ? "本轮教学卡片" : "结构化回答";
  els.a2uiSourceBadge.textContent =
    currentIndustry === "education" ? "知识工具" : "行业模板";
  els.a2uiSourceBadge.classList.remove("is-answer");
  a2uiEventTotal = 0;
  els.a2uiEventCount.textContent = "0 条";
  els.a2uiEventLog.textContent = "尚无交互";
  for (const timer of a2uiTelemetryTimers.values()) clearTimeout(timer);
  a2uiTelemetryTimers.clear();
}

function handleA2UIInteraction(payload) {
  const telemetry = payload.telemetry;
  if (telemetry?.interaction === "input") {
    const key = `${telemetry.surfaceId}:${telemetry.componentId}`;
    clearTimeout(a2uiTelemetryTimers.get(key));
    a2uiTelemetryTimers.set(
      key,
      setTimeout(() => {
        a2uiTelemetryTimers.delete(key);
        dispatchA2UIInteraction(payload);
      }, 320)
    );
    return;
  }
  dispatchA2UIInteraction(payload);
}

function dispatchA2UIInteraction(payload) {
  appendA2UIEvent(payload);

  if (currentIndustry === "education" && payload.action) {
    if (
      payload.action.name === "answer.select" &&
      payload.action.context?.grading_source === "pi.learning"
    ) {
      void previewPiLearningGrade(payload);
      return;
    }
    if (
      payload.action.name === "answer.select" &&
      payload.action.context?.grading_source === "agent.registry"
    ) {
      void previewAgentEducationGrade(payload);
      return;
    }
    if (
      payload.action.name === "answer.select" &&
      payload.action.context?.grading_source === "knowledge.materials"
    ) {
      void previewKnowledgeMaterialGrade(payload);
      return;
    }
    if (sessionReady && ws?.readyState === WebSocket.OPEN) {
      send({ type: "a2ui.action", payload });
      return;
    }
    if (payload.action.name === "answer.select") {
      void previewEducationGrade(payload);
    } else {
      setStatus("已记录，连接AI教师后可以继续", false, true);
      void postA2UIEvent(payload);
    }
    return;
  }

  if (payload.action && sessionReady && ws?.readyState === WebSocket.OPEN) {
    send({ type: "a2ui.action", payload });
    return;
  }

  postA2UIEvent(payload);
}

async function postA2UIEvent(payload) {
  try {
    const response = await fetch("/a2ui/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    logEvent("a2ui.telemetry.error", { message: error.message });
  }
}

async function previewPiLearningGrade(payload) {
  const context = payload?.action?.context || {};
  const cardId = String(context.card_id || "").trim();
  const assessmentInstanceId = String(
    context.assessment_instance_id || context.question_id || ""
  ).trim();
  const sessionId = textAgentState.activeSessionId || "session-1";
  if (!cardId || !assessmentInstanceId || textAgentState.pendingGradeCards.has(cardId)) {
    return null;
  }
  textAgentState.pendingGradeCards.add(cardId);
  a2uiRenderer.patchEducationCard(cardId, {
    state: {
      status: "submitting",
      selected: context.value,
      loading: true,
      locked: true
    },
    meta: { badge: "正在判题" }
  });
  try {
    const response = await fetch("/api/education/agent/grade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assessment_instance_id: assessmentInstanceId,
        selected: context.value,
        user_id: getTextAgentRequestUserId(),
        session_id: getTextAgentRequestSessionId(sessionId),
        hint_usage: 0
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    if (sessionId !== textAgentState.activeSessionId) return result;
    const manualReview = result.manual_review === true;
    a2uiRenderer.patchEducationCard(cardId, {
      state: {
        status: manualReview ? "submitted" : result.correct ? "correct" : "incorrect",
        selected: result.selected,
        correct: manualReview ? null : Boolean(result.correct),
        loading: false,
        locked: true
      },
      meta: {
        badge: manualReview ? "等待复核" : result.correct ? "回答正确" : "回答错误"
      }
    });
    setAssistantPreview(
      manualReview
        ? "答案已提交，教师复核前不会改变掌握度。"
        : result.correct
          ? "回答正确，已作为真实作答证据更新学习记录。"
          : "这次没有答对，已记录本次真实作答；你可以继续让 AI 教师讲解解题思路。",
      false
    );
    setStatus(manualReview ? "等待教师复核" : "已完成判题并更新学习记录", false, true);
    if (!manualReview) {
      await refreshCurrentEducationStudent();
      document.dispatchEvent(new CustomEvent("learning-records:change", {
        detail: {
          source: "verified-grade",
          studentId: getTextAgentRequestUserId(),
          receiptId: result.receipt_id || ""
        }
      }));
    }
    return result;
  } catch (error) {
    if (sessionId === textAgentState.activeSessionId) {
      a2uiRenderer.patchEducationCard(cardId, {
        state: {
          status: "awaiting_answer",
          selected: context.value,
          loading: false,
          locked: false
        },
        meta: { badge: "可重新提交" }
      });
    }
    setStatus("判题失败，请重试", true);
    setAssistantPreview(error?.message || "判题服务暂不可用，请稍后重试。", false);
    logEvent("pi.learning.grade.error", { message: error?.message || String(error) });
    return null;
  } finally {
    textAgentState.pendingGradeCards.delete(cardId);
  }
}

async function previewAgentEducationGrade(payload) {
  const context = payload?.action?.context || {};
  const cardId = String(context.card_id || "").trim();
  const sessionId = textAgentState.activeSessionId || "session-1";
  if (!cardId || textAgentState.pendingGradeCards.has(cardId)) return null;
  textAgentState.pendingGradeCards.add(cardId);
  a2uiRenderer.patchEducationCard(cardId, {
    state: {
      status: "submitting",
      selected: context.value,
      loading: true,
      locked: true
    },
    meta: { badge: "正在判题" }
  });
  try {
    const response = await fetch("/api/agent/ui/grade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question_id: context.question_id,
        selected: context.value,
        user_id: getTextAgentRequestUserId(),
        session_id: getTextAgentRequestSessionId(sessionId),
        card_id: cardId
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    if (sessionId !== textAgentState.activeSessionId) return result;
    a2uiRenderer.patchEducationCard(cardId, {
      state: {
        status: result.correct ? "correct" : "incorrect",
        selected: result.selected,
        correct: Boolean(result.correct),
        locked: true,
        correct_answer: result.correct_option_id
      },
      props: { explanation: result.explanation || "" },
      meta: { badge: result.correct ? "回答正确" : "查看解析" }
    });
    setAssistantPreview(
      result.correct
        ? `回答正确。${result.explanation || ""}`
        : `这次选择不正确，正确选项是 ${result.correct_option_id}。${result.explanation || ""}`,
      false
    );
    setStatus("已完成判题", false, true);
    return result;
  } catch (error) {
    if (sessionId === textAgentState.activeSessionId) {
      a2uiRenderer.patchEducationCard(cardId, {
        state: {
          status: "awaiting_answer",
          selected: context.value,
          loading: false,
          locked: false
        },
        meta: { badge: "可重新提交" }
      });
    }
    setStatus("判题失败，请重试", true);
    logEvent("text.agent.grade.error", { message: error?.message || String(error) });
    return null;
  } finally {
    textAgentState.pendingGradeCards.delete(cardId);
  }
}

function appendA2UIEvent(payload) {
  const item = document.createElement("div");
  const time = new Date().toLocaleTimeString();
  item.className = "a2ui-event-item";

  if (payload.action) {
    item.textContent = `${time}｜点击｜${payload.action.name}`;
  } else {
    const telemetry = payload.telemetry || {};
    item.textContent = `${time}｜${formatA2UIInteraction(telemetry)}`;
  }

  if (!els.a2uiEventLog.querySelector(".a2ui-event-item")) els.a2uiEventLog.replaceChildren();
  els.a2uiEventLog.prepend(item);
  while (els.a2uiEventLog.children.length > 8) els.a2uiEventLog.lastElementChild.remove();
  a2uiEventTotal += 1;
  els.a2uiEventCount.textContent = `${a2uiEventTotal} 条`;
  logEvent(payload.action ? "a2ui.action" : "a2ui.telemetry", payload);
}

function formatA2UIInteraction(telemetry) {
  const summary = telemetry.valueSummary || {};
  if (summary.kind === "choice") return `选择｜${telemetry.label}：${summary.selection || "已选择"}`;
  if (summary.kind === "boolean") return `切换｜${telemetry.label}：${summary.checked ? "是" : "否"}`;
  if (summary.kind === "button") return `点击｜${telemetry.label}`;
  return `录入｜${telemetry.label}：${summary.length || 0} 字符`;
}

function sendReplacementAppend() {
  const text = els.replacementText.value.trim();
  if (!text) return;
  send({ type: "speech.replacement.append", text });
}

function sendReplacementCommit() {
  const text = els.replacementText.value.trim();
  send({ type: "speech.replacement.commit", text });
}

function closeSession() {
  send({ type: "session.close" });
  disposeVoiceSession({
    statusText: "已结束",
    stateLabel: "会话已结束",
    isError: false
  });
  els.activeSessionId.textContent = "未创建";
  setTextInputSheet(false);
}

function send(payload) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function downsampleToPcm16(float32, sourceRate, targetRate) {
  const ratio = sourceRate / targetRate;
  const length = Math.floor(float32.length / ratio);
  const output = new Int16Array(length);

  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < float32.length; j += 1) {
      sum += float32[j];
      count += 1;
    }
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, count)));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

function pcm16ToBase64(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function ensurePlaybackContext() {
  if (!playback.audioContext) {
    playback.audioContext = new AudioContext();
    playback.nextTime = playback.audioContext.currentTime + 0.05;
  }
  if (playback.audioContext.state === "suspended") {
    void playback.audioContext.resume().catch((error) => {
      logEvent("client.audio.resume.error", {
        message: error?.message || String(error)
      });
    });
  }
  return playback.audioContext;
}

function unlockPlaybackContext() {
  try {
    ensurePlaybackContext();
  } catch (error) {
    logEvent("client.audio.unlock.error", {
      message: error?.message || String(error)
    });
  }
}

function playPcm16Base64(base64, sampleRate, responseId = "") {
  if (!base64) return;
  ensurePlaybackContext();

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const samples = new Int16Array(bytes.buffer);
  const buffer = playback.audioContext.createBuffer(1, samples.length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) data[i] = samples[i] / 32768;

  const source = playback.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playback.audioContext.destination);
  playback.sources.add(source);
  source.onended = () => {
    const wasStopped = playback.stoppedSources.has(source);
    playback.stoppedSources.delete(source);
    playback.sources.delete(source);
    if (!playback.sources.size && !wasStopped) handlePlaybackQueueDrained();
  };

  const startAt = Math.max(playback.audioContext.currentTime + 0.02, playback.nextTime);
  source.start(startAt);
  playback.nextTime = startAt + buffer.duration;
  registerAssistantSubtitleAudioChunk(
    responseId,
    startAt,
    playback.nextTime
  );
}

function playTextTtsPcm16Base64(base64, sampleRate, playbackId) {
  if (!base64 || !isActiveTextTts(playbackId)) return;
  const playbackContext = ensurePlaybackContext();
  const binary = atob(base64);
  const byteLength = binary.length - (binary.length % 2);
  if (!byteLength) return;
  const samples = new Int16Array(byteLength / 2);
  for (let offset = 0; offset < byteLength; offset += 2) {
    const low = binary.charCodeAt(offset);
    const high = binary.charCodeAt(offset + 1);
    const unsigned = low | (high << 8);
    samples[offset / 2] = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
  }

  const resolvedSampleRate = Math.max(8_000, Math.min(48_000, Number(sampleRate) || 24_000));
  const buffer = playbackContext.createBuffer(1, samples.length, resolvedSampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    channel[index] = samples[index] / 32_768;
  }

  const source = playbackContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackContext.destination);
  textSpeechState.sources.add(source);
  source.onended = () => {
    textSpeechState.sources.delete(source);
    finishTextTtsWhenDrained(playbackId);
  };
  const startAt = Math.max(
    playbackContext.currentTime + 0.02,
    Number(textSpeechState.nextTime) || 0
  );
  source.start(startAt);
  textSpeechState.nextTime = startAt + buffer.duration;
}

function handlePlaybackQueueDrained() {
  // response.output_audio.done means the server has finished sending bytes;
  // this callback is the authoritative browser-side playback completion.
  updateAssistantSubtitlePlayback();
  if (recording) {
    setStatus("可以继续说", false, true);
    setListeningState(true, "正在听");
    return;
  }
  setListeningState(false, "可继续提问");
  void resumeContinuousVoice();
}

function stopPlayback() {
  stopAssistantSubtitleTicker();
  for (const source of playback.sources) {
    playback.stoppedSources.add(source);
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
  }
  playback.sources.clear();
  if (playback.audioContext) {
    playback.nextTime = playback.audioContext.currentTime + 0.05;
  }
}

function isPlaying() {
  return playback.sources.size > 0;
}

function appendToolLog(label, data) {
  if (els.toolLog.classList.contains("tool-log-empty")) {
    els.toolLog.classList.remove("tool-log-empty");
    els.toolLog.textContent = "";
  }
  const item = document.createElement("div");
  item.className = "tool-item";
  item.textContent = `${label}\n${JSON.stringify(data, null, 2)}`;
  els.toolLog.prepend(item);
}

function logEvent(type, payload) {
  const safePayload = summarizeEventForLog(type, payload);
  const line = `[${new Date().toLocaleTimeString()}] ${type}\n${JSON.stringify(safePayload, null, 2)}\n\n`;
  els.eventLog.textContent = `${line}${els.eventLog.textContent}`.slice(0, 40000);
}

function summarizeEventForLog(type, payload) {
  if (type === "voice.audio.delta") {
    return {
      type,
      response_id: payload?.response_id || "",
      format: payload?.format || "pcm_s16le",
      sample_rate: payload?.sampleRate || 24000,
      chunk_characters: String(payload?.delta || "").length
    };
  }
  if (
    type === "doubao.event" &&
    payload?.event?.type === "response.output_audio.delta"
  ) {
    return {
      event: {
        type: payload.event.type,
        response_id: payload.event.response_id || "",
        chunk_characters: String(payload.event.delta || "").length
      }
    };
  }
  return payload;
}

function bindTextCounters() {
  document.querySelectorAll("[data-count-for]").forEach((counter) => {
    const field = document.getElementById(counter.dataset.countFor);
    if (!field) return;
    const update = () => updateTextCounter(counter, field);
    field.addEventListener("input", update);
    update();
  });
}

function refreshTextCounters() {
  document.querySelectorAll("[data-count-for]").forEach((counter) => {
    const field = document.getElementById(counter.dataset.countFor);
    if (field) updateTextCounter(counter, field);
  });
}

function updateTextCounter(counter, field) {
  counter.textContent = String(field.value.length);
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch("/runtime-config");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    els.runtimeEndpoint.value = config.endpoint || "";
    els.model.value = config.model || els.model.value;
  } catch (error) {
    els.runtimeEndpoint.value = "读取失败";
    logEvent("runtime-config.error", { message: error.message });
  }
}

function getLearningScopeSnapshot() {
  // Consumers receive their own copy and cannot mutate the request authority.
  return structuredClone({
    status: learningScopeStatus,
    scope: activeLearningScope,
    error: learningScopeError,
  });
}

function updateLearningScopeState(status, scope = null, error = null) {
  activeLearningScope = scope;
  learningScopeStatus = status;
  learningScopeError = error;
  document.dispatchEvent(new CustomEvent("learning-scope:change", {
    detail: getLearningScopeSnapshot(),
  }));
}

async function loadLearningAgentScope() {
  const requestSequence = ++learningScopeRequestSequence;
  try {
    const requestedScopeId = getRequestedLearningScopeId();
    updateLearningScopeState("loading");
    const response = await fetch(
      `/api/education/agent/scope?scope_id=${encodeURIComponent(requestedScopeId)}`,
      { headers: { accept: "application/json" } }
    );
    const payload = await response.json().catch(() => ({}));
    if (requestSequence !== learningScopeRequestSequence) return;
    if (!response.ok) {
      throw new Error(payload?.message || `HTTP ${response.status}`);
    }
    if (!payload?.current_scope || typeof payload.current_scope !== "object"
      || Array.isArray(payload.current_scope) || typeof payload.current_scope.scope_id !== "string"
      || !payload.current_scope.scope_id.trim()) {
      throw new Error("服务端未返回有效的已加载课程范围");
    }
    updateLearningScopeState("ready", payload.current_scope);
    renderLoadedLearningMaterials(activeLearningScope);
  } catch (error) {
    if (requestSequence !== learningScopeRequestSequence) return;
    updateLearningScopeState("error", null, String(error?.message || error || "课程范围读取失败"));
    if (els.loadedLearningMaterialsLabel) {
      els.loadedLearningMaterialsLabel.textContent = "暂无教材";
    }
    if (els.classroomLearningScopeName) els.classroomLearningScopeName.textContent = "未加载课程";
    if (els.classroomLearningScopeMeta) els.classroomLearningScopeMeta.textContent = "请先选择课程或导入资料";
    logEvent("learning-agent.scope.error", { message: error?.message || String(error) });
  }
}

function renderLoadedLearningMaterials(scope) {
  const materials = Array.isArray(scope?.loaded_materials) ? scope.loaded_materials : [];
  const primaryMaterial = materials[0] || null;
  if (els.loadedLearningMaterialsLabel) {
    els.loadedLearningMaterialsLabel.textContent = `已加载 ${materials.length} 本`;
  }
  if (els.classroomLearningScopeName) {
    els.classroomLearningScopeName.textContent = scope?.label || primaryMaterial?.title || "已加载课程";
  }
  if (els.classroomLearningScopeMeta) {
    els.classroomLearningScopeMeta.textContent = primaryMaterial
      ? [primaryMaterial.title, primaryMaterial.version].filter(Boolean).join(" · ")
      : "当前课程暂无已审核资料";
    els.classroomLearningScopeMeta.title = materials
      .map((material) => [material.title, material.version].filter(Boolean).join(" · "))
      .filter(Boolean)
      .join("\n");
  }
  if (els.activeCurriculumName) {
    els.activeCurriculumName.textContent = scope?.label || primaryMaterial?.title || "已加载课程";
  }
  if (els.activeCurriculumMeta) {
    const knowledgeCount = Number(scope?.knowledge_point_count || scope?.knowledgePointCount || 0);
    const materialVersion = primaryMaterial?.version || primaryMaterial?.edition || "";
    els.activeCurriculumMeta.textContent = [
      materialVersion,
      knowledgeCount > 0 ? `${knowledgeCount} 个知识点` : `${materials.length} 份已审核资料`
    ].filter(Boolean).join(" · ");
  }
  if (els.teacherConversationContext) {
    els.teacherConversationContext.textContent = `${scope?.label || "已加载课程"} · 受控知识库`;
  }
  if (!els.loadedLearningMaterialsList) return;
  els.loadedLearningMaterialsList.replaceChildren();
  materials.forEach((material) => {
    const article = document.createElement("article");
    article.setAttribute("role", "listitem");
    const icon = document.createElement("i");
    icon.dataset.lucide = "book-open-check";
    icon.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    const title = document.createElement("b");
    title.textContent = material.title || "已加载教材";
    const meta = document.createElement("small");
    meta.textContent = [material.version, material.scope, material.publisher]
      .filter(Boolean)
      .join(" · ");
    copy.append(title, meta);
    article.append(icon, copy);
    els.loadedLearningMaterialsList.append(article);
  });
  window.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function getRequestedLearningScopeId() {
  const currentCourse = window.AIClassroomUserRuntime?.getCurrentCourse?.();
  return currentCourse?.agentScopeId || currentCourse?.id || activeLearningScope?.scope_id || "course-junior-math";
}

function buildSessionConfig() {
  const instructions = buildPersonaInstructions();
  els.instructions.value = instructions;

  return {
    industry: currentIndustry,
    sessionId: els.sessionId.value.trim(),
    model: els.model.value.trim(),
    voice: els.voice.value.trim(),
    speed: audioRatioToProtocolValue(els.speed.value),
    loudness: audioRatioToProtocolValue(els.loudness.value),
    openingText: activeEnglishPracticeScene?.opening_text || els.openingText.value.trim(),
    instructions,
    inputMod: "none",
    asrConfig: {},
    ttsConfig: {},
    dialogConfig: activeEnglishPracticeScene
      ? {
          speaking_practice: {
            scene_id: activeEnglishPracticeScene.id,
            scene_label: activeEnglishPracticeScene.label,
            language: activeEnglishPracticeScene.language || "english",
            subtitle_mode: "both_sides"
          }
        }
      : {},
    customTools: [],
    enabledToolSlots: {}
  };
}

function buildPersonaInstructions() {
  const preset = getIndustryPreset(currentIndustry);
  const teacherName =
    document.querySelector("#teacherPersonaName")?.textContent?.trim() || "AI教师";
  const promptOnly = preset.toolMode === "prompt_only";
  const basePrompt =
    els.personaBasePrompt.value.trim() || preset.basePrompt;
  const backgroundPrompt =
    els.personaBackgroundPrompt.value.trim() || preset.backgroundPrompt;
  const stylePrompt =
    els.personaStylePrompt.value.trim() || preset.stylePrompt;
  const salesPlaybook =
    els.salesPlaybookPrompt.value.trim() || preset.salesPlaybook;
  if (currentIndustry === "education") {
    const speakingPracticeInstructions = buildEnglishPracticeInstructions();
    return [
      "# 当前教学老师",
      `${teacherName}｜${preset.label}｜${preset.profileTitle}`,
      "",
      "# 基础人设",
      basePrompt,
      "",
      "# 教学背景与边界",
      backgroundPrompt,
      "",
      "# 讲解风格",
      stylePrompt,
      "",
      "# 教学策略",
      salesPlaybook,
      "",
      "# 教学对话规则",
      preset.toolPolicy,
      speakingPracticeInstructions,
      "",
      "# 服务与安全边界",
      preset.serviceBoundary
    ].join("\n");
  }
  const responseModeSections = promptOnly
    ? [
        "# 内置演示产品知识",
        preset.directAnswerKnowledge,
        "",
        "# 直答模式约束",
        preset.toolPolicy
      ]
    : ["# 工具使用策略", preset.toolPolicy];

  return [
    "# 当前行业场景",
    `${preset.label}｜${preset.profileTitle}`,
    "",
    "# 基础人设",
    basePrompt,
    "",
    "# 背景人设",
    backgroundPrompt,
    "",
    "# 模型对话风格",
    stylePrompt,
    "",
    "# 售前咨询与推荐策略",
    salesPlaybook,
    "",
    "# 对话执行规则",
    promptOnly ? FAST_CONVERSATION_RULES : COMMON_CONVERSATION_RULES,
    "",
    ...responseModeSections,
    "",
    "# 服务与合规边界",
    preset.serviceBoundary
  ].join("\n");
}

function buildEnglishPracticeInstructions() {
  const scene = activeEnglishPracticeScene;
  if (!scene) return "";
  const language = scene.language || "english";
  const languageLabel = scene.language_label || "英语";
  const coachingRules = language === "cantonese"
    ? [
        "# 粤语陪练反馈方式",
        "在适合提升表达时，每轮给出1至2个自然、日常可复用的粤语好句；先说明使用场景，再请学生选一句复述，避免一次堆砌大量俚语。",
        "教学目标词或短句时，给出粤语原句和对应粤拼；粤拼必须带1至6声调数字，并只解释本轮最关键的声母、韵母、声调或连读问题。",
        "发音示范必须真正读出来：先慢速清晰示范一遍，再按自然粤语语速示范一遍，然后邀请学生跟读。禁止用普通话谐音代替粤拼。",
        "优先使用“学生原句 → 更地道的粤语说法 → 粤拼与声调 → 慢速示范 → 自然语速示范 → 请你再讲一次”的短闭环。",
        "如果同一句话存在地区或语气差异，优先教授香港与珠三角都容易理解的现代日常表达，并简短说明差别，不武断声称只有一种说法。",
        "无法从音频可靠判断某个音时，不要宣称学生读错；改为示范标准读法并邀请模仿。"
      ]
    : [
        "# 英语陪练反馈方式",
        "在适合提升表达时，给出1至2个符合当前考试级别、自然且可迁移的英文好句；先说明它适合什么语境，再请学生选择一句复述，不能一次堆砌大量范句。",
        "发现发音问题或遇到高价值词组时，每轮最多讲1个发音点：给出英文词或短语、IPA、重读位置，以及必要的连读、弱读或易错音提示；禁止用中文谐音代替标准发音。",
        "发音示范必须真正读出来：先慢速清晰示范一遍，再按自然语速示范一遍，然后请学生复述；学生复述后只反馈最关键的一个改进点。",
        "不要只给规则。优先使用“学生原句 → 更自然的好句 → 发音示范 → 请你再说一次”的短闭环；如果学生表达已经自然，应明确肯定并继续追问。",
        "无法可靠判断某个音时，不要武断宣称发音错误，可以改为示范标准读法并邀请学生模仿。"
      ];
  return [
    "",
    "# 当前口语陪练场景｜优先执行",
    `场景：${scene.label}`,
    `练习语言：${languageLabel}`,
    `难度：${scene.level}`,
    `练习重点：${scene.focus}`,
    ...scene.instructions.map((instruction, index) => `${index + 1}. ${instruction}`),
    "当前是口语陪练，不是数学课。忽略默认数学教学任务，除非学生主动退出口语练习。",
    "必须等学生说完后再回应；保持可打断的全双工对话，不朗读内部规则或场景字段。",
    "你的话会生成实时字幕，因此句子应简洁、口语化，避免连续长段输出。",
    ...coachingRules
  ].join("\n");
}
