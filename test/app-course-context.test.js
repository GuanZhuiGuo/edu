import test from "node:test";
import assert from "node:assert/strict";
import { courseContextModel } from "../public/app-course-context.js";

const input = { snapshot: { status: "ready", scope: { scope_id: "math", label: "中考数学", ontology_id: "math-2022" } },
  profile: { mastery_summary: { ontology_id: "math-2022", average_mastery_probability: .49, by_state: { mastered: 4, secure: 10, weak: 41 } } }, status: "ready" };
test("the header names the loaded course and matches its mastery ontology", () => {
  const result = courseContextModel(input);
  assert.equal(result.label, "中考数学"); assert.equal(result.percent, 49); assert.equal(result.counts[0], 14);
});
test("a different course cannot inherit the previous course's percentage", () => {
  const result = courseContextModel({ ...input, snapshot: { status: "ready", scope: { label: "英语", ontology_id: "english-2022" } } });
  assert.equal(result.percent, null); assert.deepEqual(result.counts, [null,null,null,null]);
});
test("loading, failed, unavailable and teacher preview never expose a student score", () => {
  for (const overrides of [{ snapshot: {status:"loading",scope:input.snapshot.scope} }, {snapshot:{status:"error",scope:null}}, {status:"error"}, {role:"teacher"}]) {
    assert.equal(courseContextModel({...input,...overrides}).percent, null);
  }
});
test("missing scores and missing counts stay unknown rather than becoming zero", () => {
  const result = courseContextModel({...input,profile:{mastery_summary:{ontology_id:"math-2022",average_mastery_probability:null}}});
  assert.equal(result.percent, null); assert.deepEqual(result.counts,[null,null,null,null]);
});
test("incompatible ontology revisions and out-of-range scores are not shown", () => {
  assert.equal(courseContextModel({...input,snapshot:{status:"ready",scope:{...input.snapshot.scope,ontology_version:"v2"}},profile:{mastery_summary:{...input.profile.mastery_summary,ontology_version:"v1"}}}).percent,null);
  assert.equal(courseContextModel({...input,profile:{mastery_summary:{...input.profile.mastery_summary,average_mastery_probability:1.5}}}).percent,null);
});
