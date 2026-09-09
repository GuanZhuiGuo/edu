import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ARTIFACT_SCHEMA_VERSION,
  ARTIFACT_VERSION,
  COMPILER_LIMITS,
  EXPECTED_KNOWLEDGE_POINT_COUNT,
  HIGH_RISK_VISUAL_PROFILES,
  INTERACTIVE_RENDERER,
  INTERACTIVE_SCHEMA_VERSION,
  INTERACTIVE_VARIANTS,
  MINDMAP_SCHEMA_VERSION,
  compileJuniorMathVisuals,
  serializeVisualArtifacts,
  validateVisualArtifacts
} from "../scripts/compile-junior-math-visuals.mjs";

const ontologyPath = new URL("../public/data/junior-math-ontology.json", import.meta.url);
const artifactsPath = new URL("../public/data/junior-math-visual-artifacts.json", import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("visual artifact compiler is deterministic and the committed output is current", async () => {
  const [ontology, committedText] = await Promise.all([
    readJson(ontologyPath),
    readFile(artifactsPath, "utf8")
  ]);
  const first = compileJuniorMathVisuals(ontology);
  const second = compileJuniorMathVisuals(ontology);

  assert.deepEqual(second, first);
  assert.equal(serializeVisualArtifacts(first), committedText);
  assert.equal(first.schema_version, ARTIFACT_SCHEMA_VERSION);
  assert.equal(first.version, ARTIFACT_VERSION);
  assert.deepEqual(first.schema.variant_allowlist, INTERACTIVE_VARIANTS);
});

test("all 140 ontology points have source, mindmap and controlled interactive material", async () => {
  const [ontology, output] = await Promise.all([readJson(ontologyPath), readJson(artifactsPath)]);
  const ontologyById = new Map(ontology.knowledge_points.map((point) => [point.id, point]));
  const artifactIds = output.artifacts.map((artifact) => artifact.knowledge_point_id);

  assert.equal(output.artifacts.length, EXPECTED_KNOWLEDGE_POINT_COUNT);
  assert.equal(new Set(artifactIds).size, EXPECTED_KNOWLEDGE_POINT_COUNT);
  assert.deepEqual(new Set(artifactIds), new Set(ontologyById.keys()));
  assert.equal(output.statistics.artifact_count, EXPECTED_KNOWLEDGE_POINT_COUNT);
  assert.equal(output.statistics.source_count, EXPECTED_KNOWLEDGE_POINT_COUNT);
  assert.equal(output.statistics.mindmap_count, EXPECTED_KNOWLEDGE_POINT_COUNT);
  assert.equal(output.statistics.interactive_count, EXPECTED_KNOWLEDGE_POINT_COUNT);

  for (const artifact of output.artifacts) {
    const point = ontologyById.get(artifact.knowledge_point_id);
    assert.equal(artifact.source.document_id, point.source_ref.document_id);
    assert.equal(artifact.source.outline_description, point.measurable_behavior);
    assert.equal(artifact.source.printed_page, point.source_ref.printed_page);
    assert.equal(artifact.source.text_basis, "ontology.measurable_behavior");
    assert.equal(artifact.mindmap.schema_version, MINDMAP_SCHEMA_VERSION);
    assert.equal(artifact.mindmap.root_id, point.id);
    assert.equal(artifact.mindmap.root, point.name);
    assert.equal(artifact.interactive.schema_version, INTERACTIVE_SCHEMA_VERSION);
    assert.equal(artifact.interactive.renderer, INTERACTIVE_RENDERER);
  }

  assert.equal(validateVisualArtifacts(output, ontology), true);
});

test("mindmaps are compatible with root-plus-branches A2UI and keep references bounded", async () => {
  const [ontology, output] = await Promise.all([readJson(ontologyPath), readJson(artifactsPath)]);
  const validNodeIds = new Set([
    ...ontology.domains.map((domain) => domain.id),
    ...ontology.themes.map((theme) => theme.id),
    ...ontology.knowledge_points.map((point) => point.id)
  ]);

  for (const artifact of output.artifacts) {
    assert.ok(artifact.mindmap.branches.length >= 1);
    assert.ok(artifact.mindmap.branches.length <= COMPILER_LIMITS.max_mindmap_branches);
    assert.equal(artifact.mindmap.branches[0].kind, "curriculum");
    for (const branch of artifact.mindmap.branches) {
      assert.ok(branch.title);
      assert.ok(branch.children.length <= COMPILER_LIMITS.max_mindmap_children_per_branch);
      assert.ok(branch.children.every((child) => validNodeIds.has(child.id) && child.label));
    }
  }
});

test("all ontology relation edges survive mindmap compilation without branch truncation", async () => {
  const [ontology, output] = await Promise.all([readJson(ontologyPath), readJson(artifactsPath)]);
  const pointIds = new Set(ontology.knowledge_points.map((point) => point.id));
  const incidentByPoint = new Map(ontology.knowledge_points.map((point) => [point.id, []]));
  for (const edge of ontology.edges) {
    if (incidentByPoint.has(edge.source)) incidentByPoint.get(edge.source).push(edge);
    if (incidentByPoint.has(edge.target)) incidentByPoint.get(edge.target).push(edge);
  }

  for (const artifact of output.artifacts) {
    const pointId = artifact.knowledge_point_id;
    const expectedByBranch = {
      prerequisites: [],
      successors: [],
      relations: []
    };
    for (const edge of incidentByPoint.get(pointId)) {
      if (edge.type === "part_of") continue;
      const otherId = edge.source === pointId ? edge.target : edge.source;
      if (!pointIds.has(otherId)) continue;
      const branchKind = edge.type === "prerequisite_of"
        ? edge.target === pointId ? "prerequisites" : "successors"
        : "relations";
      expectedByBranch[branchKind].push({
        edge_id: edge.id,
        other_id: otherId,
        type: edge.type,
        direction: edge.source === pointId ? "outgoing" : "incoming"
      });
    }

    for (const [branchKind, expected] of Object.entries(expectedByBranch)) {
      const branch = artifact.mindmap.branches.find((item) => item.kind === branchKind);
      const children = branch?.children || [];
      assert.equal(
        children.length,
        new Set(expected.map((entry) => entry.other_id)).size,
        `${pointId}.${branchKind} lost a neighbor`
      );
      const actualEdges = [];
      for (const child of children) {
        const expectedTypes = new Set(expected.filter((entry) => entry.other_id === child.id).map((entry) => entry.type));
        assert.deepEqual(new Set(child.relation_types), expectedTypes, `${pointId}.${branchKind}.${child.id} lost a relation type`);
        for (const relation of child.relations) {
          for (const edgeId of relation.edge_ids) {
            actualEdges.push(`${edgeId}:${child.id}:${relation.type}:${relation.direction}`);
          }
        }
      }
      const expectedEdges = expected.map((entry) => `${entry.edge_id}:${entry.other_id}:${entry.type}:${entry.direction}`);
      assert.deepEqual(new Set(actualEdges), new Set(expectedEdges), `${pointId}.${branchKind} lost an ontology edge`);
    }
  }

  const denseArtifact = output.artifacts.find((artifact) => artifact.knowledge_point_id === "M4-GE-PROOF-03");
  assert.ok(denseArtifact.mindmap.branches.find((branch) => branch.kind === "relations").children.length > 4);
});

test("22 high-risk points use explicit supported visual profiles without fallback", async () => {
  const output = await readJson(artifactsPath);
  const expectedPointIds = new Set([
    "M4-NA-RAT-04", "M4-NA-RAT-05", "M4-NA-RAT-06", "M4-NA-RAT-07",
    "M4-NA-REAL-03", "M4-NA-REAL-04", "M4-NA-REAL-05", "M4-NA-REAL-08",
    "M4-NA-ALG-01", "M4-NA-ALG-02", "M4-NA-ALG-03", "M4-NA-ALG-04", "M4-NA-ALG-05",
    "M4-GE-TRANS-01", "M4-GE-TRANS-02", "M4-GE-TRANS-03", "M4-GE-TRANS-04", "M4-GE-TRANS-06",
    "M4-GE-PROJ-01", "M4-GE-PROJ-02", "M4-GE-PROJ-03", "M4-GC-COORD-05"
  ]);
  assert.deepEqual(new Set(Object.keys(HIGH_RISK_VISUAL_PROFILES)), expectedPointIds);
  assert.equal(expectedPointIds.size, 22);

  const artifactByPointId = new Map(output.artifacts.map((artifact) => [artifact.knowledge_point_id, artifact]));
  for (const pointId of expectedPointIds) {
    const artifact = artifactByPointId.get(pointId);
    const profile = HIGH_RISK_VISUAL_PROFILES[pointId];
    assert.equal(artifact.interactive.variant, profile.variant, `${pointId} variant must match its explicit profile`);
    assert.equal(artifact.interactive.model, profile.model, `${pointId} model must match its explicit profile`);
    assert.equal(artifact.interactive.visual_profile.status, "supported");
    assert.equal(artifact.interactive.visual_profile.variant, profile.variant);
    assert.equal(artifact.interactive.visual_profile.model, profile.model);
    assert.equal("fallback_reason" in artifact.interactive.visual_profile, false);
    assert.notEqual(artifact.interactive.model, "concept_steps");
    assert.ok(artifact.interactive.data.guidance_steps.length >= 3);
  }
});

test("variant whitelist is fully exercised and every parameter is finite and bounded", async () => {
  const output = await readJson(artifactsPath);
  const seenVariants = new Set(output.artifacts.map((artifact) => artifact.interactive.variant));

  assert.deepEqual(seenVariants, new Set(INTERACTIVE_VARIANTS));
  assert.equal(
    Object.values(output.statistics.variant_counts).reduce((sum, count) => sum + count, 0),
    EXPECTED_KNOWLEDGE_POINT_COUNT
  );

  for (const artifact of output.artifacts) {
    const spec = artifact.interactive;
    assert.ok(INTERACTIVE_VARIANTS.includes(spec.variant));
    assert.ok(spec.parameters.length <= COMPILER_LIMITS.max_parameters);
    assert.equal("html" in spec, false);
    assert.equal("url" in spec, false);
    assert.equal("expression" in spec, false);
    for (const parameter of spec.parameters) {
      assert.ok(["range", "select", "toggle"].includes(parameter.control));
      if (parameter.control !== "range") continue;
      for (const key of ["min", "max", "step", "default"]) {
        assert.equal(Number.isFinite(parameter[key]), true, `${artifact.artifact_id}.${parameter.key}.${key}`);
      }
      assert.ok(parameter.min >= COMPILER_LIMITS.numeric_min);
      assert.ok(parameter.max <= COMPILER_LIMITS.numeric_max);
      assert.ok(parameter.min < parameter.max);
      assert.ok(parameter.step > 0);
      assert.ok(parameter.default >= parameter.min && parameter.default <= parameter.max);
      assert.ok((parameter.max - parameter.min) / parameter.step <= COMPILER_LIMITS.max_parameter_steps);
    }
  }
});

test("validator rejects incomplete coverage and unsafe numeric parameters", async () => {
  const [ontology, output] = await Promise.all([readJson(ontologyPath), readJson(artifactsPath)]);
  const incomplete = structuredClone(output);
  incomplete.artifacts.pop();
  assert.throws(
    () => validateVisualArtifacts(incomplete, ontology),
    /exactly 140 artifacts/u
  );

  const unsafe = structuredClone(output);
  const parameter = unsafe.artifacts[0].interactive.parameters.find((item) => item.control === "range");
  parameter.max = Number.POSITIVE_INFINITY;
  assert.throws(
    () => validateVisualArtifacts(unsafe, ontology),
    /must be finite/u
  );
});
