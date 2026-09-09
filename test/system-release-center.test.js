import test from "node:test";
import assert from "node:assert/strict";
import { buildArchitectureGraphOption } from "../public/system-release-center.js";
import { getSystemReleaseManifest } from "../system-release-manifest.js";

test("architecture graph renders deterministic layered nodes and directed flows", () => {
  const option = buildArchitectureGraphOption({
    nodes: [
      { id: "source", layer: "source", label: "资料", detail: "PDF" },
      { id: "runtime", layer: "runtime", label: "运行时", detail: "Agent" },
    ],
    edges: [{ source: "source", target: "runtime", label: "输入" }],
  });
  assert.equal(option.series[0].layout, "none");
  assert.equal(option.series[0].data.length, 2);
  assert.equal(option.series[0].links.length, 1);
  assert.deepEqual(option.series[0].links[0].symbol, ["none", "arrow"]);
});

test("architecture graph assigns every current system node a unique position", () => {
  const option = buildArchitectureGraphOption(getSystemReleaseManifest().architecture);
  const positions = option.series[0].data.map((node) => `${node.x}:${node.y}`);
  assert.equal(new Set(positions).size, positions.length);
});

test("compact architecture graph stacks layers without overlapping nodes", () => {
  const option = buildArchitectureGraphOption(getSystemReleaseManifest().architecture, { compact: true });
  const positions = option.series[0].data.map((node) => `${node.x}:${node.y}`);
  assert.equal(new Set(positions).size, positions.length);
  assert.equal(option.graphic.length, 0);
  assert.ok(option.series[0].data.every((node) => node.symbolSize[1] === 42));
});
