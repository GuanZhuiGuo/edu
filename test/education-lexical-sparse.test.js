import assert from "node:assert/strict";
import test from "node:test";

import {
  EDUCATION_LEXICAL_SPARSE_VERSION,
  encodeEducationLexicalSparse,
  normalizeEducationLexicalText,
} from "../education-lexical-sparse.js";

test("lexical_sparse_v1 normalizes full-width text and is deterministic", () => {
  assert.equal(normalizeEducationLexicalText("ＡＢＣ　１２"), "abc 12");
  const first = encodeEducationLexicalSparse("一次函数 y = 2x + 1，一次函数");
  const second = encodeEducationLexicalSparse("一次函数 y = 2x + 1，一次函数");
  assert.deepEqual(first, second);
  assert.equal(first.version, EDUCATION_LEXICAL_SPARSE_VERSION);
  assert.equal(first.indices.length, first.values.length);
  assert.ok(first.indices.length > 5);
  assert.ok(first.indices.every((value, index, values) =>
    Number.isSafeInteger(value) && value >= 0 && (index === 0 || value > values[index - 1])
  ));
  assert.ok(first.values.every((value) => Number.isFinite(value) && value > 0));
  const once = encodeEducationLexicalSparse("函数");
  const repeated = encodeEducationLexicalSparse("函数 函数");
  assert.ok(Math.max(...repeated.values) > Math.max(...once.values));
});

test("lexical_sparse_v1 rejects empty and non-string input", () => {
  assert.throws(() => encodeEducationLexicalSparse(" \n "), /searchable token/u);
  assert.throws(() => encodeEducationLexicalSparse(null), /must be a string/u);
});
