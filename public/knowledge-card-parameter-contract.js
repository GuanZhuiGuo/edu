const JSON_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";

export const KNOWLEDGE_CARD_PARAMETER_SCHEMA_VERSION =
  "knowledge-card-parameterization@1.0";

const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const ALLOWED_CONTROLS = new Set(["range", "select", "toggle"]);
const MAX_PARAMETERS = 32;

export class KnowledgeCardParameterError extends Error {
  constructor(code, message, path = "") {
    super(message);
    this.name = "KnowledgeCardParameterError";
    this.code = code;
    this.path = path;
  }
}

/**
 * Turn the renderer's trusted parameter definitions into a bounded JSON
 * Schema. The renderer/template identity remains server-owned; a model may
 * only fill the declared values.
 */
export function createKnowledgeCardParameterization({
  parameters = [],
  renderer = "",
  rendererVersion = "1.0",
  templateId = "",
  cardType = "interactive_visual",
  staticReason = "static_content",
} = {}) {
  const definitions = normalizeParameterDefinitions(parameters);
  const properties = {};
  const defaults = {};
  const bindings = [];

  for (const definition of definitions) {
    properties[definition.key] = propertySchema(definition);
    defaults[definition.key] = clone(definition.default);
    bindings.push({
      input: definition.key,
      target: {
        kind: "parameter_value",
        parameter_key: definition.key,
      },
    });
  }

  const bounded = definitions.length > 0;
  const trustedRenderer = safeIdentifier(renderer, 160);
  const trustedTemplate = safeIdentifier(templateId, 160);
  const normalizedCardType = safeIdentifier(cardType, 96) || "knowledge_card";
  const reason = safeText(staticReason, 160) || "static_content";
  if (bounded && (!trustedRenderer || !trustedTemplate)) {
    throw error(
      "card_trusted_template_required",
      "bounded card inputs require a server-owned renderer and template id",
      "parameterization.runtime",
    );
  }

  return deepFreeze({
    schema_version: KNOWLEDGE_CARD_PARAMETER_SCHEMA_VERSION,
    mode: bounded ? "bounded" : "none",
    accepts_input: bounded,
    accepts_model_values: bounded,
    input_policy: bounded ? "partial_with_defaults" : "reject_all",
    input_schema: {
      $schema: JSON_SCHEMA_DRAFT,
      title: bounded ? "Knowledge card render inputs" : "Static knowledge card inputs",
      type: "object",
      additionalProperties: false,
      properties,
      required: [],
    },
    defaults,
    bindings,
    runtime: {
      card_type: normalizedCardType,
      renderer: trustedRenderer || null,
      renderer_version: safeText(rendererVersion, 40) || "1.0",
      template_id: trustedTemplate || null,
      executable_model_code: false,
      ...(bounded ? {} : { static_reason: reason }),
    },
  });
}

export function createStaticKnowledgeCardParameterization(options = {}) {
  return createKnowledgeCardParameterization({ ...options, parameters: [] });
}

/**
 * Validate and resolve a model/user supplied partial slot object. Defaults are
 * applied after validation, so the returned values are reproducible.
 */
export function resolveKnowledgeCardInputValues(
  parameterization,
  values = {},
  { includeDefaults = true } = {},
) {
  const contract = assertKnowledgeCardParameterization(parameterization);
  const source = values === undefined || values === null ? {} : values;
  if (!isPlainObject(source)) {
    throw error("card_input_object_required", "card inputs must be an object", "inputs");
  }
  const entries = Object.entries(source);
  if (entries.length > MAX_PARAMETERS) {
    throw error("card_input_too_many", "card inputs exceed the bounded slot count", "inputs");
  }
  const properties = contract.input_schema.properties;
  if (contract.mode === "none" && entries.length) {
    throw error("card_input_not_supported", "this card is static and accepts no inputs", "inputs");
  }
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(properties, key)) {
      throw error("card_input_unknown", `unknown card input: ${key}`, `inputs.${key}`);
    }
  }

  const output = includeDefaults ? clone(contract.defaults) : {};
  for (const [key, value] of entries) {
    output[key] = validateInputValue(value, properties[key], `inputs.${key}`);
  }
  return deepFreeze(output);
}

/**
 * Apply validated slot values to a trusted interactive spec. Only the value
 * field of an already-declared parameter may change; renderer/model/template
 * fields are never accepted from slot input.
 */
export function applyKnowledgeCardInputValues(interactiveSpec, values = {}) {
  if (!isPlainObject(interactiveSpec)) return interactiveSpec;
  const contract = interactiveSpec.parameterization;
  if (!contract) {
    if (isPlainObject(values) && Object.keys(values).length === 0) return clone(interactiveSpec);
    throw error(
      "card_parameterization_missing",
      "interactive card has no trusted input schema",
      "parameterization",
    );
  }
  const resolved = resolveKnowledgeCardInputValues(contract, values);
  const output = clone(interactiveSpec);
  const parameters = Array.isArray(output.parameters) ? output.parameters : [];
  const byKey = new Map(parameters.map((item) => [String(item?.key || ""), item]));
  for (const binding of contract.bindings) {
    const key = binding.input;
    const targetKey = binding.target.parameter_key;
    const parameter = byKey.get(targetKey);
    if (!parameter || !Object.hasOwn(resolved, key)) continue;
    parameter.value = clone(resolved[key]);
  }
  return output;
}

/** Add an explicit input contract to generated card material. */
export function withKnowledgeCardParameterization(material, options = {}) {
  if (!isPlainObject(material)) return material;
  const output = clone(material);
  const trustedTemplate = options.allowBoundedTemplate === true;
  const parameters = trustedTemplate && Array.isArray(options.parameters)
    ? options.parameters
    : [];
  const renderer = trustedTemplate ? options.renderer : "";
  const templateId = trustedTemplate ? options.templateId : "";
  if (trustedTemplate && (!safeIdentifier(renderer, 160) || !safeIdentifier(templateId, 160))) {
    throw error(
      "card_trusted_template_required",
      "bounded card generation requires a server-owned renderer and template id",
      "parameterization.runtime",
    );
  }
  output.parameterization = createKnowledgeCardParameterization({
    parameters,
    renderer,
    rendererVersion: options.rendererVersion || "1.0",
    templateId,
    cardType: output.recommended_type || options.cardType || "knowledge_card",
    staticReason: options.staticReason || staticReasonForCard(output.recommended_type),
  });
  return output;
}

/**
 * Normalize a generated material list at the server boundary. A model may
 * never promote its own renderer, parameter definitions, Schema or binding
 * metadata into runtime authority. Bounded inputs are available only when the
 * caller explicitly supplies a server-owned template contract.
 */
export function parameterizeKnowledgeCardMaterials(materials, options = {}) {
  if (!Array.isArray(materials)) return [];
  return materials.slice(0, 64).map((material) =>
    withKnowledgeCardParameterization(material, options));
}

export function assertKnowledgeCardParameterization(value) {
  if (!isPlainObject(value)) {
    throw error("card_parameterization_required", "parameterization must be an object", "parameterization");
  }
  if (value.schema_version !== KNOWLEDGE_CARD_PARAMETER_SCHEMA_VERSION) {
    throw error("card_parameterization_version", "unsupported parameterization version", "schema_version");
  }
  if (!new Set(["bounded", "none"]).has(value.mode)) {
    throw error("card_parameterization_mode", "parameterization mode is invalid", "mode");
  }
  if (!isPlainObject(value.input_schema)
    || value.input_schema.$schema !== JSON_SCHEMA_DRAFT
    || value.input_schema.type !== "object"
    || value.input_schema.additionalProperties !== false
    || !isPlainObject(value.input_schema.properties)
    || !Array.isArray(value.input_schema.required)
    || value.input_schema.required.length !== 0) {
    throw error("card_input_schema_invalid", "input_schema must be a closed object schema", "input_schema");
  }
  if (!isPlainObject(value.defaults) || !Array.isArray(value.bindings) || !isPlainObject(value.runtime)) {
    throw error("card_parameterization_invalid", "parameterization metadata is incomplete", "parameterization");
  }
  const propertyKeys = Object.keys(value.input_schema.properties);
  if (propertyKeys.length > MAX_PARAMETERS || propertyKeys.some((key) => !SAFE_KEY.test(key))) {
    throw error("card_input_schema_keys", "input_schema contains invalid slot keys", "input_schema.properties");
  }
  if (value.mode === "none" && propertyKeys.length) {
    throw error("card_static_schema_nonempty", "a static card cannot declare inputs", "input_schema.properties");
  }
  if (value.mode === "bounded" && propertyKeys.length === 0) {
    throw error("card_bounded_schema_empty", "a bounded card must declare inputs", "input_schema.properties");
  }
  const bounded = value.mode === "bounded";
  if (value.accepts_input !== bounded
    || value.accepts_model_values !== bounded
    || value.input_policy !== (bounded ? "partial_with_defaults" : "reject_all")) {
    throw error("card_input_policy_invalid", "card input policy does not match its mode", "input_policy");
  }
  if (value.runtime.executable_model_code !== false) {
    throw error("card_runtime_executable_forbidden", "model-authored executable code is forbidden", "runtime.executable_model_code");
  }
  if (bounded
    && (!safeIdentifier(value.runtime.renderer, 160)
      || !safeIdentifier(value.runtime.template_id, 160))) {
    throw error(
      "card_trusted_template_required",
      "bounded card inputs require a server-owned renderer and template id",
      "runtime",
    );
  }
  if (value.bindings.length !== propertyKeys.length) {
    throw error("card_input_binding_count", "every input must have exactly one binding", "bindings");
  }
  const seenBindings = new Set();
  for (const [index, binding] of value.bindings.entries()) {
    const input = String(binding?.input || "");
    if (!Object.hasOwn(value.input_schema.properties, input) || seenBindings.has(input)) {
      throw error("card_input_binding_invalid", "input binding is missing or duplicated", `bindings[${index}]`);
    }
    if (binding?.target?.kind !== "parameter_value"
      || binding.target.parameter_key !== input) {
      throw error("card_input_binding_target", "only same-key parameter_value bindings are allowed", `bindings[${index}]`);
    }
    seenBindings.add(input);
  }
  resolveKnowledgeCardDefaults(value);
  return value;
}

function resolveKnowledgeCardDefaults(contract) {
  const properties = contract.input_schema.properties;
  const defaults = contract.defaults;
  for (const key of Object.keys(defaults)) {
    if (!Object.hasOwn(properties, key)) {
      throw error("card_input_default_unknown", `unknown default input: ${key}`, `defaults.${key}`);
    }
    validateInputValue(defaults[key], properties[key], `defaults.${key}`);
  }
  for (const key of Object.keys(properties)) {
    if (!Object.hasOwn(defaults, key)) {
      throw error("card_input_default_missing", `missing default input: ${key}`, `defaults.${key}`);
    }
  }
}

function normalizeParameterDefinitions(value) {
  if (!Array.isArray(value) || value.length > MAX_PARAMETERS) {
    throw error("card_parameter_definitions_invalid", "parameters must be a bounded array", "parameters");
  }
  const seen = new Set();
  return value.map((item, index) => {
    if (!isPlainObject(item)) {
      throw error("card_parameter_invalid", "parameter must be an object", `parameters[${index}]`);
    }
    const key = String(item.key || "").trim();
    const control = String(item.control || "").trim();
    if (!SAFE_KEY.test(key) || seen.has(key)) {
      throw error("card_parameter_key_invalid", "parameter key is invalid or duplicated", `parameters[${index}].key`);
    }
    if (!ALLOWED_CONTROLS.has(control)) {
      throw error("card_parameter_control_invalid", "parameter control is not allowed", `parameters[${index}].control`);
    }
    seen.add(key);
    const base = {
      key,
      label: safeText(item.label, 120) || key,
      control,
      default: clone(item.default),
    };
    if (control === "range") {
      for (const field of ["min", "max", "step", "default"]) {
        if (!Number.isFinite(Number(item[field]))) {
          throw error("card_parameter_number_invalid", `${field} must be finite`, `parameters[${index}].${field}`);
        }
      }
      const min = Number(item.min);
      const max = Number(item.max);
      const step = Number(item.step);
      const fallback = Number(item.default);
      if (min >= max || step <= 0 || fallback < min || fallback > max) {
        throw error("card_parameter_range_invalid", "range bounds/default are invalid", `parameters[${index}]`);
      }
      return {
        ...base,
        min,
        max,
        step,
        default: fallback,
        unit: safeText(item.unit, 32),
        excluded_values: Array.isArray(item.excluded_values)
          ? item.excluded_values.slice(0, 16).map(Number).filter(Number.isFinite)
          : [],
      };
    }
    if (control === "select") {
      if (!Array.isArray(item.choices) || item.choices.length === 0 || item.choices.length > 32) {
        throw error("card_parameter_choices_invalid", "select choices are invalid", `parameters[${index}].choices`);
      }
      const choices = item.choices.map((choice, choiceIndex) => {
        const value = scalar(choice?.value, `parameters[${index}].choices[${choiceIndex}].value`);
        return { value, label: safeText(choice?.label, 120) || String(value) };
      });
      if (!choices.some((choice) => Object.is(choice.value, item.default))) {
        throw error("card_parameter_default_invalid", "select default is not an allowed choice", `parameters[${index}].default`);
      }
      return { ...base, choices };
    }
    if (typeof item.default !== "boolean") {
      throw error("card_parameter_default_invalid", "toggle default must be boolean", `parameters[${index}].default`);
    }
    return base;
  });
}

function propertySchema(definition) {
  const title = definition.label;
  if (definition.control === "range") {
    const integer = [definition.min, definition.max, definition.step, definition.default]
      .every(Number.isInteger);
    return compactObject({
      type: integer ? "integer" : "number",
      title,
      minimum: definition.min,
      maximum: definition.max,
      multipleOf: definition.step,
      default: definition.default,
      ...(definition.excluded_values.length ? { not: { enum: definition.excluded_values } } : {}),
      "x-control": "range",
      "x-unit": definition.unit || undefined,
    });
  }
  if (definition.control === "select") {
    return {
      type: typeof definition.default === "number" ? "number" : "string",
      title,
      enum: definition.choices.map((choice) => clone(choice.value)),
      default: clone(definition.default),
      "x-control": "select",
      "x-option-labels": Object.fromEntries(
        definition.choices.map((choice) => [String(choice.value), choice.label]),
      ),
    };
  }
  return {
    type: "boolean",
    title,
    default: definition.default,
    "x-control": "toggle",
  };
}

function validateInputValue(value, schema, path) {
  if (!isPlainObject(schema)) throw error("card_input_schema_invalid", "slot schema is invalid", path);
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw error("card_input_type", "value must be boolean", path);
    return value;
  }
  if (schema.type === "string") {
    if (typeof value !== "string" || !schema.enum?.includes(value)) {
      throw error("card_input_enum", "value is not in the allowed choices", path);
    }
    return value;
  }
  if (schema.type === "integer" || schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw error("card_input_type", "value must be a finite number", path);
    }
    if (schema.type === "integer" && !Number.isInteger(value)) {
      throw error("card_input_integer", "value must be an integer", path);
    }
    if (value < schema.minimum || value > schema.maximum) {
      throw error("card_input_range", "value is outside the allowed range", path);
    }
    if (schema.not?.enum?.some((excluded) => Object.is(excluded, value))) {
      throw error("card_input_excluded", "value is explicitly excluded", path);
    }
    const step = Number(schema.multipleOf);
    if (Number.isFinite(step) && step > 0) {
      const offset = (value - Number(schema.minimum || 0)) / step;
      if (Math.abs(offset - Math.round(offset)) > 1e-8) {
        throw error("card_input_step", "value does not align with the allowed step", path);
      }
    }
    return value;
  }
  throw error("card_input_type", "slot type is not supported", path);
}

function scalar(value, path) {
  if (["string", "number", "boolean"].includes(typeof value)
    && (typeof value !== "number" || Number.isFinite(value))) return value;
  throw error("card_parameter_choice_invalid", "choice value must be a scalar", path);
}

function staticReasonForCard(cardType) {
  return {
    "knowledge.explanation": "source_bound_text",
    "knowledge.mindmap": "source_bound_structure",
    "quiz.single-choice": "assessment_state_server_controlled",
    "media.image": "source_asset_fixed",
    "media.video": "source_asset_fixed",
  }[String(cardType || "")] || "static_content";
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function safeIdentifier(value, maximum) {
  const candidate = String(value || "").trim().slice(0, maximum);
  return SAFE_ID.test(candidate) ? candidate : "";
}

function safeText(value, maximum) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .trim()
    .slice(0, maximum);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function error(code, message, path) {
  return new KnowledgeCardParameterError(code, message, path);
}
