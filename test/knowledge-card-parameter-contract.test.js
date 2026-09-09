import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  KnowledgeCardParameterError,
  applyKnowledgeCardInputValues,
  assertKnowledgeCardParameterization,
  createKnowledgeCardParameterization,
  createStaticKnowledgeCardParameterization,
  resolveKnowledgeCardInputValues,
  withKnowledgeCardParameterization,
} from "../public/knowledge-card-parameter-contract.js";

const artifactsPath = new URL(
  "../public/data/junior-math-visual-artifacts.json",
  import.meta.url,
);

function parameterDefinitions() {
  return [
    {
      key: "slope",
      label: "斜率",
      control: "range",
      min: -4,
      max: 4,
      step: 0.5,
      default: 1.5,
      unit: "k",
      excluded_values: [0],
    },
    {
      key: "opening",
      label: "开口方向",
      control: "select",
      choices: [
        { value: "up", label: "向上" },
        { value: "down", label: "向下" },
      ],
      default: "up",
    },
    {
      key: "closed",
      label: "包含边界",
      control: "toggle",
      default: false,
    },
  ];
}

function createBoundedContract() {
  return createKnowledgeCardParameterization({
    parameters: parameterDefinitions(),
    renderer: "junior-math-controlled",
    rendererVersion: "1.0",
    templateId: "quadratic:quadratic_vertex_form",
    cardType: "interactive_visual",
  });
}

function assertContractError(expectedCode, expectedPath = undefined) {
  return (error) => {
    assert.ok(error instanceof KnowledgeCardParameterError);
    assert.equal(error.code, expectedCode);
    if (expectedPath !== undefined) assert.equal(error.path, expectedPath);
    return true;
  };
}

test("range, select and toggle definitions compile into a closed input schema", () => {
  const contract = createBoundedContract();

  assert.equal(contract.mode, "bounded");
  assert.equal(contract.accepts_input, true);
  assert.equal(contract.accepts_model_values, true);
  assert.equal(contract.input_policy, "partial_with_defaults");
  assert.equal(contract.input_schema.type, "object");
  assert.equal(contract.input_schema.additionalProperties, false);
  assert.deepEqual(contract.input_schema.required, []);

  assert.deepEqual(contract.input_schema.properties.slope, {
    type: "number",
    title: "斜率",
    minimum: -4,
    maximum: 4,
    multipleOf: 0.5,
    default: 1.5,
    not: { enum: [0] },
    "x-control": "range",
    "x-unit": "k",
  });
  assert.deepEqual(contract.input_schema.properties.opening, {
    type: "string",
    title: "开口方向",
    enum: ["up", "down"],
    default: "up",
    "x-control": "select",
    "x-option-labels": { up: "向上", down: "向下" },
  });
  assert.deepEqual(contract.input_schema.properties.closed, {
    type: "boolean",
    title: "包含边界",
    default: false,
    "x-control": "toggle",
  });

  assert.deepEqual(contract.defaults, {
    slope: 1.5,
    opening: "up",
    closed: false,
  });
  assert.deepEqual(contract.bindings, [
    {
      input: "slope",
      target: { kind: "parameter_value", parameter_key: "slope" },
    },
    {
      input: "opening",
      target: { kind: "parameter_value", parameter_key: "opening" },
    },
    {
      input: "closed",
      target: { kind: "parameter_value", parameter_key: "closed" },
    },
  ]);
  assert.equal(assertKnowledgeCardParameterization(contract), contract);
});

test("partial input is resolved with trusted defaults", () => {
  const contract = createBoundedContract();

  assert.deepEqual(resolveKnowledgeCardInputValues(contract, { slope: 2.5 }), {
    slope: 2.5,
    opening: "up",
    closed: false,
  });
  assert.deepEqual(
    resolveKnowledgeCardInputValues(
      contract,
      { opening: "down", closed: true },
      { includeDefaults: false },
    ),
    { opening: "down", closed: true },
  );
});

test("unknown, out-of-range and invalid control values are rejected", () => {
  const contract = createBoundedContract();

  assert.throws(
    () => resolveKnowledgeCardInputValues(contract, { renderer: "untrusted" }),
    assertContractError("card_input_unknown", "inputs.renderer"),
  );
  assert.throws(
    () => resolveKnowledgeCardInputValues(contract, { slope: 4.5 }),
    assertContractError("card_input_range", "inputs.slope"),
  );
  assert.throws(
    () => resolveKnowledgeCardInputValues(contract, { slope: 1.25 }),
    assertContractError("card_input_step", "inputs.slope"),
  );
  assert.throws(
    () => resolveKnowledgeCardInputValues(contract, { slope: 0 }),
    assertContractError("card_input_excluded", "inputs.slope"),
  );
  assert.throws(
    () => resolveKnowledgeCardInputValues(contract, { opening: "sideways" }),
    assertContractError("card_input_enum", "inputs.opening"),
  );
  assert.throws(
    () => resolveKnowledgeCardInputValues(contract, { closed: "true" }),
    assertContractError("card_input_type", "inputs.closed"),
  );
});

test("static cards reject every supplied input", () => {
  const contract = createStaticKnowledgeCardParameterization({
    cardType: "knowledge.mindmap",
    staticReason: "ontology_relation_structure",
  });

  assert.equal(contract.mode, "none");
  assert.equal(contract.accepts_input, false);
  assert.equal(contract.accepts_model_values, false);
  assert.equal(contract.input_policy, "reject_all");
  assert.deepEqual(resolveKnowledgeCardInputValues(contract, {}), {});
  assert.throws(
    () => resolveKnowledgeCardInputValues(contract, { root: "tampered" }),
    assertContractError("card_input_not_supported", "inputs"),
  );
});

test("model-generated card data cannot promote its own renderer or parameters", () => {
  const material = withKnowledgeCardParameterization({
    material_id: "generated-1",
    recommended_type: "knowledge.explanation",
    data: {
      interactive: {
        renderer: "model-authored-renderer",
        template_id: "model-authored-template",
        parameters: parameterDefinitions(),
      },
    },
  });

  assert.equal(material.parameterization.mode, "none");
  assert.equal(material.parameterization.runtime.renderer, null);
  assert.equal(material.parameterization.runtime.template_id, null);
  assert.deepEqual(material.parameterization.input_schema.properties, {});

  const trusted = withKnowledgeCardParameterization(
    { material_id: "trusted-1", recommended_type: "knowledge.interactive" },
    {
      allowBoundedTemplate: true,
      renderer: "server-controlled-renderer",
      templateId: "template:server-owned",
      parameters: parameterDefinitions(),
    },
  );
  assert.equal(trusted.parameterization.mode, "bounded");
  assert.equal(trusted.parameterization.runtime.renderer, "server-controlled-renderer");
  assert.equal(trusted.parameterization.runtime.template_id, "template:server-owned");

  assert.throws(
    () => createKnowledgeCardParameterization({ parameters: parameterDefinitions() }),
    assertContractError("card_trusted_template_required", "parameterization.runtime"),
  );
  const executable = structuredClone(trusted.parameterization);
  executable.runtime.executable_model_code = true;
  assert.throws(
    () => assertKnowledgeCardParameterization(executable),
    assertContractError("card_runtime_executable_forbidden", "runtime.executable_model_code"),
  );
});

test("applying inputs changes only declared parameter value fields", () => {
  const contract = createBoundedContract();
  const interactive = {
    schema_version: "junior-math-interactive@1.0",
    renderer: "junior-math-controlled",
    renderer_version: "1.0",
    variant: "quadratic",
    model: "quadratic_vertex_form",
    title: "二次函数",
    parameters: parameterDefinitions().map((definition) => ({
      ...definition,
      value: definition.default,
    })),
    data: { trusted: true },
    parameterization: contract,
  };
  const original = structuredClone(interactive);
  const expected = structuredClone(interactive);
  expected.parameters.find((parameter) => parameter.key === "slope").value = -2.5;
  expected.parameters.find((parameter) => parameter.key === "opening").value = "down";
  expected.parameters.find((parameter) => parameter.key === "closed").value = true;

  const applied = applyKnowledgeCardInputValues(interactive, {
    slope: -2.5,
    opening: "down",
    closed: true,
  });

  assert.deepEqual(applied, expected);
  assert.deepEqual(interactive, original, "the trusted template must not be mutated");
});

test("all 140 committed artifacts expose consistent static and bounded contracts", async () => {
  const output = JSON.parse(await readFile(artifactsPath, "utf8"));

  assert.equal(output.artifacts.length, 140);
  for (const artifact of output.artifacts) {
    const label = artifact.artifact_id;
    const mindmapContract = artifact.mindmap.parameterization;
    const interactiveContract = artifact.interactive.parameterization;

    assert.doesNotThrow(
      () => assertKnowledgeCardParameterization(mindmapContract),
      `${label} mindmap contract must be valid`,
    );
    assert.equal(mindmapContract.mode, "none", `${label} mindmap must be static`);
    assert.equal(mindmapContract.accepts_model_values, false);

    assert.doesNotThrow(
      () => assertKnowledgeCardParameterization(interactiveContract),
      `${label} interactive contract must be valid`,
    );
    assert.equal(interactiveContract.mode, "bounded", `${label} interactive must be bounded`);
    assert.equal(interactiveContract.accepts_model_values, true);

    const parameterKeys = artifact.interactive.parameters.map((parameter) => parameter.key);
    const schemaKeys = Object.keys(interactiveContract.input_schema.properties);
    const defaultKeys = Object.keys(interactiveContract.defaults);
    assert.deepEqual(schemaKeys, parameterKeys, `${label} schema keys must match renderer parameters`);
    assert.deepEqual(defaultKeys, parameterKeys, `${label} default keys must match renderer parameters`);

    for (const parameter of artifact.interactive.parameters) {
      assert.deepEqual(
        interactiveContract.defaults[parameter.key],
        parameter.default,
        `${label}.${parameter.key} default must stay compiler-owned`,
      );
      assert.deepEqual(
        interactiveContract.bindings.find((binding) => binding.input === parameter.key),
        {
          input: parameter.key,
          target: { kind: "parameter_value", parameter_key: parameter.key },
        },
        `${label}.${parameter.key} must bind only to its own value slot`,
      );
    }
  }
});
