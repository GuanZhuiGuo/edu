import test from "node:test";
import assert from "node:assert/strict";
import {
  getCurrentSystemRelease,
  getSystemReleaseManifest,
} from "../system-release-manifest.js";

test("system release manifest exposes an honest local development release", () => {
  const current = getCurrentSystemRelease();
  assert.equal(current.display_version, "MVP 2.0");
  assert.equal(current.production_release, false);
  assert.match(current.release_id, /^local-/u);
});

test("system architecture covers the knowledge and learning feedback loop", () => {
  const manifest = getSystemReleaseManifest();
  const nodeIds = new Set(manifest.architecture.nodes.map((node) => node.id));
  for (const required of ["import", "ontology", "review", "sqlite", "qdrant", "neo4j", "runtime", "mastery", "student", "teacher"]) {
    assert.equal(nodeIds.has(required), true, `missing architecture node ${required}`);
  }
  for (const edge of manifest.architecture.edges) {
    assert.equal(nodeIds.has(edge.source), true);
    assert.equal(nodeIds.has(edge.target), true);
  }
});

test("manifest returns defensive copies", () => {
  const first = getSystemReleaseManifest();
  first.releases[0].highlights.push("mutated");
  first.architecture.nodes[0].label = "mutated";
  const second = getSystemReleaseManifest();
  assert.notEqual(second.architecture.nodes[0].label, "mutated");
  assert.equal(second.releases[0].highlights.includes("mutated"), false);
});
