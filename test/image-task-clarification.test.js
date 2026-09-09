import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildImageTaskChoicePrompt,
  normalizeImageTaskClarification,
  questionImageAttachmentFromDataUrl,
} from "../public/image-task-clarification.js";

test("normalizes the server clarification to the two fixed product choices", () => {
  const clarification = normalizeImageTaskClarification({
    status: "clarify",
    clarification: {
      prompt: "请选择处理方式",
      options: [
        { id: "grade", label: "<img onerror=alert(1)>" },
        { id: "solve", label: "任意上游文案" },
      ],
    },
  });

  assert.equal(clarification.prompt, "请选择处理方式");
  assert.deepEqual(
    clarification.options.map(({ id, label }) => ({ id, label })),
    [
      { id: "solve", label: "拍题解答" },
      { id: "grade", label: "作业批改" },
    ],
  );
});

test("rejects malformed or incomplete clarification payloads", () => {
  assert.equal(normalizeImageTaskClarification(null), null);
  assert.equal(normalizeImageTaskClarification({ status: "resolved" }), null);
  assert.equal(normalizeImageTaskClarification({
    status: "clarify",
    clarification: { options: [{ id: "solve" }] },
  }), null);
});

test("restores a supported attachment from the saved turn data URL", () => {
  const attachment = questionImageAttachmentFromDataUrl(
    "data:image/png;base64,aGVsbG8=",
    { name: "上一张题目.png" },
  );
  assert.deepEqual({ ...attachment }, {
    mime_type: "image/png",
    data: "aGVsbG8=",
    name: "上一张题目.png",
  });
  assert.equal(questionImageAttachmentFromDataUrl("javascript:alert(1)"), null);
  assert.equal(questionImageAttachmentFromDataUrl("data:image/svg+xml;base64,aGVsbG8="), null);
});

test("builds an explicit retry prompt for each single-path choice", () => {
  assert.match(buildImageTaskChoicePrompt("solve"), /解答.*解题思路/u);
  assert.match(buildImageTaskChoicePrompt("grade"), /批改.*订正建议/u);
  assert.equal(buildImageTaskChoicePrompt("both"), "");
});

test("the classroom exposes fixed photo actions and reuses the saved image after clarification", async () => {
  const [html, clientSource] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/client.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /data-teacher-photo-mode="solve"[^>]*data-ui-tooltip="拍题解答"/u);
  assert.match(html, /data-teacher-photo-mode="grade"[^>]*data-ui-tooltip="作业批改"/u);
  assert.match(html, /data-teacher-shortcut="oral-practice"/u);
  assert.doesNotMatch(html, /data-teacher-shortcut="(?:key-points|mindmap|practice|mock-exam)"/u);
  assert.doesNotMatch(html, /id="teacherWebSearchToggle"/u);
  assert.match(clientSource, /online_search: \{ enabled: false \}/u);
  assert.doesNotMatch(clientSource, /WEB_SEARCH_STORAGE_PREFIX|syncOnlineSearchPreference|toggleOnlineSearch/u);
  assert.match(clientSource, /turn\.record\.imageTaskClarification = normalizeImageTaskClarification/u);
  assert.match(clientSource, /questionImageAttachmentFromDataUrl\(record\.questionImageUrl/u);
  assert.match(clientSource, /attachmentOverride: attachment,[\s\S]*?imageTaskModeOverride: mode\.id/u);
  assert.match(clientSource, /dataset\.imageTaskChoice = option\.id/u);

  const sendStart = clientSource.indexOf("async function sendEducationAgentQuestion");
  const sendEnd = clientSource.indexOf("function resolvePiLearningSkill", sendStart);
  const sendSource = clientSource.slice(sendStart, sendEnd);
  const imagePersistedAt = sendSource.indexOf("turn.record.questionImageUrl =");
  const messageRenderedAt = sendSource.indexOf("renderTurnQuestionImage(turn)");
  const composerClearedAt = sendSource.indexOf('new CustomEvent("teacher-attachment:clear")');
  const requestStartedAt = sendSource.indexOf('fetch("/api/agent/chat/stream"');
  assert.ok(imagePersistedAt >= 0);
  assert.ok(messageRenderedAt > imagePersistedAt);
  assert.ok(composerClearedAt > messageRenderedAt);
  assert.ok(requestStartedAt > composerClearedAt);
  assert.match(sendSource, /if \(!attachmentOverride\)[\s\S]*?teacher-attachment:clear/u);
  assert.match(clientSource, /function renderTurnQuestionImage[\s\S]*?questionImageAttachmentFromDataUrl[\s\S]*?target\.prepend\(figure\)/u);
});
