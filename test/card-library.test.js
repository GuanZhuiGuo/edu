import test from "node:test";
import assert from "node:assert/strict";

import { EDUCATION_CARD_CATALOG } from "../public/card-library-data.js";
import { createEducationCardMessages } from "../public/card-library.js";
import { deriveQuizOptionFeedback } from "../public/a2ui-renderer.js";

test("card library exposes eleven unique education card contracts", () => {
  assert.equal(EDUCATION_CARD_CATALOG.length, 11);
  assert.equal(
    new Set(EDUCATION_CARD_CATALOG.map((definition) => definition.type)).size,
    11
  );
  assert.equal(
    new Set(EDUCATION_CARD_CATALOG.map((definition) => definition.id)).size,
    11
  );

  for (const definition of EDUCATION_CARD_CATALOG) {
    assert.equal(definition.mockData.type, definition.type);
    assert.equal(definition.mockData.version, definition.version);
    assert.ok(definition.mockData.id);
    assert.equal(definition.schema.type, "object");
    assert.ok(definition.schema.properties);
    assert.equal(definition.mockData.meta.parameterization.mode, "none");
    assert.equal(
      definition.mockData.meta.parameterization.input_schema.additionalProperties,
      false,
    );
  }
});

test("every card mock can be wrapped in the trusted A2UI v0.9 message sequence", () => {
  for (const definition of EDUCATION_CARD_CATALOG) {
    const messages = createEducationCardMessages(definition.mockData);
    assert.equal(messages.length, 3);
    assert.equal(messages[0].version, "v0.9");
    assert.equal(
      messages[1].updateComponents.components[1].card.type,
      definition.type
    );
    assert.equal(
      messages[2].updateDataModel.value.contract_version,
      definition.version
    );
  }
});

test("wrong quiz feedback marks the selected option red and the correct option green", () => {
  const shared = {
    selectedValue: "D",
    correctValue: "A",
    result: "incorrect",
    revealResult: true
  };
  assert.equal(
    deriveQuizOptionFeedback({ ...shared, optionValue: "D" }),
    "incorrect"
  );
  assert.equal(
    deriveQuizOptionFeedback({ ...shared, optionValue: "A" }),
    "correct"
  );
  assert.equal(
    deriveQuizOptionFeedback({ ...shared, optionValue: "B" }),
    ""
  );
});
