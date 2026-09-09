import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compileEducationCardTemplateProposals,
  validateEducationCardTemplateProposal,
} from "../education-card-proposal-compiler.js";

const catalogUrl = new URL("../public/data/junior-math-visual-artifacts.json", import.meta.url);

function candidatePack(name) {
  return {
    candidates: {
      curriculum_standards: [{
        id: "semantic-kp-1",
        candidate_type: "knowledge_point",
        name,
        provenance: { source_anchors: [{ page_index: 4, block_ids: ["block-4-2"] }] },
      }],
    },
  };
}

test("courseware card proposals expose static contracts and exact trusted interactive schemas", async () => {
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
  const proposals = compileEducationCardTemplateProposals({
    candidatePack: candidatePack("探索并应用勾股定理及逆定理"),
    trustedArtifacts: catalog.artifacts,
  });

  assert.equal(proposals.length, 3);
  assert.deepEqual(proposals.slice(0, 2).map((item) => item.parameterization.mode), ["none", "none"]);
  const interactive = proposals.find((item) => item.card_type === "interactive_visual");
  assert.equal(interactive.artifact_ref, "visual:M4-GE-TRI-10");
  assert.equal(interactive.renderability, "bounded_template_match");
  assert.equal(interactive.parameterization.mode, "bounded");
  assert.deepEqual(Object.keys(interactive.parameterization.input_schema.properties), ["leg_a", "leg_b"]);
  assert.equal(interactive.review_status, "needs_review");
  assert.equal(interactive.publishable, false);
  assert.equal(proposals.every(validateEducationCardTemplateProposal), true);
});

test("courseware compilation never grants a renderer on a fuzzy title match", async () => {
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8"));
  const proposals = compileEducationCardTemplateProposals({
    candidatePack: candidatePack("勾股定理综合练习"),
    trustedArtifacts: catalog.artifacts,
  });

  assert.equal(proposals.length, 2);
  assert.equal(proposals.every((item) => item.renderability === "static"), true);
  assert.equal(proposals.every((item) => item.parameterization.mode === "none"), true);
});
