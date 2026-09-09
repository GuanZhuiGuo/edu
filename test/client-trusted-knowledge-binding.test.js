import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeAgentAnswerAttribution } from "../public/agent-answer-renderer.js";

const clientPath = new URL("../public/client.js", import.meta.url);

async function loadBindingHelpers() {
  const source = await readFile(clientPath, "utf8");
  const startMarker = "// TRUSTED_KNOWLEDGE_BINDING_HELPERS_START";
  const endMarker = "// TRUSTED_KNOWLEDGE_BINDING_HELPERS_END";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, "trusted binding helper block must remain testable");
  const helperSource = source.slice(start + startMarker.length, end);
  const helpers = Function(
    `"use strict";\n${helperSource}\nreturn { resolveTrustedKnowledgeBinding, settleTurnKnowledgeBinding, hasTrustedKnowledgeBinding };`,
  )();
  return { source, ...helpers };
}

async function loadAnswerAttributionLifecycle(mountAgentAnswerAttribution) {
  const source = await readFile(clientPath, "utf8");
  const start = source.indexOf("function renderTurnAnswerAttribution(runtime)");
  const end = source.indexOf("function safeExternalReferenceUrl(value)", start);
  assert.ok(start >= 0 && end > start, "answer attribution lifecycle must remain testable");
  const renderTurnAnswerAttribution = Function(
    "normalizeAgentAnswerAttribution",
    "mountAgentAnswerAttribution",
    `"use strict";\n${source.slice(start, end)}\nreturn renderTurnAnswerAttribution;`,
  )(normalizeAgentAnswerAttribution, mountAgentAnswerAttribution);
  return renderTurnAnswerAttribution;
}

function speculativeRecord() {
  return {
    status: "streaming",
    groundingStatus: "pending",
    knowledgeBindingState: "pending",
    trustedKnowledgeBinding: null,
    knowledgePointId: "local-guess-kp",
    visualArtifactId: "local-guess-card",
  };
}

test("only an answered teaching package with a canonical knowledge point creates a trusted binding", async () => {
  const { resolveTrustedKnowledgeBinding, settleTurnKnowledgeBinding, hasTrustedKnowledgeBinding } = await loadBindingHelpers();
  const record = speculativeRecord();
  const binding = settleTurnKnowledgeBinding(record, {
    status: "answered",
    knowledge_point_ids: ["M4-GE-TRI-10"],
    cards: [{
      ref: "visual:M4-GE-TRI-10",
      knowledge_point_id: "M4-GE-TRI-10",
      source: "trusted_registry",
      input_values: { leg_a: 5, leg_b: 12 },
    }],
  });

  assert.deepEqual(binding, {
    status: "answered",
    knowledgePointId: "M4-GE-TRI-10",
    visualArtifactId: "visual:M4-GE-TRI-10",
    inputValues: { leg_a: 5, leg_b: 12 },
    source: "server_grounded_teaching_package",
  });
  assert.equal(record.knowledgeBindingState, "trusted");
  assert.equal(record.knowledgePointId, "M4-GE-TRI-10");
  assert.equal(hasTrustedKnowledgeBinding(record), true);
  assert.equal(resolveTrustedKnowledgeBinding({ status: "answered", knowledge_point_ids: [] }), null);
});

test("related_only, no_match and tool_error clear every speculative local binding", async () => {
  const { settleTurnKnowledgeBinding, hasTrustedKnowledgeBinding } = await loadBindingHelpers();
  for (const status of ["related_only", "no_match", "tool_error"]) {
    const record = speculativeRecord();
    const binding = settleTurnKnowledgeBinding(record, {
      status,
      knowledge_point_ids: ["must-not-bind"],
      cards: [{ ref: "must-not-render", source: "trusted_registry" }],
    });
    assert.equal(binding, null, status);
    assert.equal(record.groundingStatus, status);
    assert.equal(record.knowledgeBindingState, "rejected");
    assert.equal(record.trustedKnowledgeBinding, null);
    assert.equal(record.knowledgePointId, "");
    assert.equal(record.visualArtifactId, "");
    assert.equal(hasTrustedKnowledgeBinding(record), false);
  }
});

test("a trusted card cannot silently cross-bind to another knowledge point", async () => {
  const { resolveTrustedKnowledgeBinding } = await loadBindingHelpers();
  const binding = resolveTrustedKnowledgeBinding({
    status: "answered",
    knowledge_point_ids: ["kp-exact"],
    cards: [
      { ref: "visual:wrong", knowledge_point_id: "kp-related", source: "trusted_registry" },
      { ref: "visual:exact", knowledge_point_id: "kp-exact", source: "trusted_registry" },
    ],
  });
  assert.equal(binding.knowledgePointId, "kp-exact");
  assert.equal(binding.visualArtifactId, "visual:exact");
});

test("conversation integration gates cards and learning actions on the trusted server binding", async () => {
  const { source } = await loadBindingHelpers();
  assert.match(source, /const trustedKnowledgeBinding = applyFinalTurnKnowledgeBinding\(turn, teachingPackage\)/u);
  assert.match(source, /if \(trustedKnowledgeBinding && payload\.ui_projection\)/u);
  assert.match(source, /if \(turn\.record\.knowledgePointId \|\| turn\.record\.visualArtifactId\) \{\s*void hydrateTextConversationVisual/u);
  assert.match(source, /if \(!hasTrustedKnowledgeBinding\(record\)\)[\s\S]*?return;/u);
  assert.match(source, /const trusted = runtime\.record\.status === "completed" && hasTrustedKnowledgeBinding\(runtime\.record\)/u);
  assert.match(source, /if \(runtime\.record\.knowledgeBindingState === "rejected"\) return false;/u);
});

test("conversation integration preserves and mounts external rich results beside the answer", async () => {
  const { source } = await loadBindingHelpers();
  assert.match(source, /value\.rich_results \|\| value\.richResults/u);
  assert.match(source, /mountAgentExternalRichResults\(richMount, grounding\.richResults\)/u);
  assert.match(source, /bubble\.insertBefore\(richMount, rail\)/u);
});

test("conversation integration preserves controlled fallback attribution without citations", async () => {
  const { source } = await loadBindingHelpers();
  assert.match(source, /normalizeAgentAnswerAttribution\(payload\.answer_attribution\)/u);
  assert.match(source, /if \(!references\.length && richResults\.isEmpty && !answerAttribution\) return null;/u);
  assert.match(source, /renderTurnAnswerAttribution\(runtime\);/u);
  assert.match(source, /runtime\.record\.status === "completed"[\s\S]*?mountAgentAnswerAttribution\(metadata, attribution\)/u);
  assert.match(source, /function mountTextConversationTurn[\s\S]*?renderTurnAnswerAttribution\(runtime\);[\s\S]*?renderTurnExternalGrounding\(runtime\);/u);
});

test("failed and canceled turns cannot restore attribution from stale external grounding", async () => {
  const mountedValues = [];
  const renderTurnAnswerAttribution = await loadAnswerAttributionLifecycle((_metadata, value) => {
    mountedValues.push(value);
    return value;
  });
  const controlledAttribution = {
    schemaVersion: "answer-attribution@1.0",
    provider: "doubao_aixue",
    fallbackReason: "curriculum_no_match",
  };
  const metadata = {};

  for (const status of ["error", "canceled"]) {
    const record = {
      status,
      answerAttribution: controlledAttribution,
      externalGrounding: { answerAttribution: controlledAttribution },
    };
    const result = renderTurnAnswerAttribution({
      record,
      assistantElement: { querySelector: () => metadata },
    });
    assert.equal(result, null, status);
    assert.equal(record.answerAttribution, null, status);
    assert.equal(mountedValues.at(-1), null, status);
  }

  const completedRecord = {
    status: "completed",
    answerAttribution: null,
    externalGrounding: { answerAttribution: controlledAttribution },
  };
  const completed = renderTurnAnswerAttribution({
    record: completedRecord,
    assistantElement: { querySelector: () => metadata },
  });
  assert.equal(completed.provider, "doubao_aixue");
  assert.equal(completed.sourceLabel, "内容来自豆包爱学");
});
