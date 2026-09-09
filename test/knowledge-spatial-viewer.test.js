import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateSpatialBounds,
  normalizeSpatialScene
} from "../public/knowledge-spatial-viewer.js";

test("normalizes a wrapped spatial_scene without mutating its source", () => {
  const source = {
    spatial_scene: {
      title: "细胞结构",
      nodes: [
        {
          id: "cell membrane",
          label: "细胞膜",
          description: "控制物质进出",
          position: ["1", 2, "bad"],
          geometry: "orb",
          color: "#ABC",
          scale: 1.5
        },
        {
          id: "nucleus",
          label: "细胞核",
          position: { x: -2, y: 0.5, z: 1 },
          geometry: { type: "cube" },
          scale: [2, 0, 99],
          parent_id: "cell membrane"
        }
      ],
      edges: [{ from: "cell membrane", to: "nucleus", label: "包含" }]
    }
  };
  const snapshot = structuredClone(source);

  const normalized = normalizeSpatialScene(source);

  assert.deepEqual(source, snapshot);
  assert.equal(normalized.title, "细胞结构");
  assert.equal(normalized.nodes[0].id, "cell-membrane");
  assert.deepEqual(normalized.nodes[0].position, [1, 2, -0.38]);
  assert.equal(normalized.nodes[0].geometry, "sphere");
  assert.equal(normalized.nodes[0].color, "#abc");
  assert.deepEqual(normalized.nodes[0].scale, [1.5, 1.5, 1.5]);
  assert.equal(normalized.nodes[1].geometry, "box");
  assert.deepEqual(normalized.nodes[1].scale, [2, 0.12, 8]);
  assert.equal(normalized.nodes[1].parent_id, "cell-membrane");
  assert.deepEqual(
    normalized.edges.map(({ from, to, label, derived }) => ({
      from,
      to,
      label,
      derived
    })),
    [{ from: "cell-membrane", to: "nucleus", label: "包含", derived: false }]
  );
});

test("deduplicates node ids, filters invalid edges and derives missing parent edges", () => {
  const normalized = normalizeSpatialScene({
    nodes: [
      { id: "root", label: "根节点", position: [0, 0, 0] },
      { id: "root", label: "重复节点", position: [1, 0, 0] },
      { id: "child", label: "子节点", parent_id: "root", position: [2, 0, 0] }
    ],
    edges: [
      { from: "missing", to: "child", label: "无效" },
      { from: "root", to: "root", label: "自环" },
      { from: "root", to: "child", label: "已有父子边" },
      { from: "root", to: "child", label: "重复边" }
    ]
  });

  assert.deepEqual(
    normalized.nodes.map((node) => node.id),
    ["root", "root-2", "child"]
  );
  assert.equal(normalized.nodes[2].parent_id, "root");
  assert.equal(normalized.edges.length, 1);
  assert.equal(normalized.edges[0].label, "已有父子边");

  const derived = normalizeSpatialScene({
    nodes: [
      { id: "parent", position: [0, 0, 0] },
      { id: "child", parent_id: "parent", position: [0, 1, 0] }
    ]
  });
  assert.deepEqual(
    derived.edges.map(({ from, to, derived: isDerived }) => ({
      from,
      to,
      derived: isDerived
    })),
    [{ from: "parent", to: "child", derived: true }]
  );
});

test("supplies deterministic layout, safe visual defaults and camera limits", () => {
  const normalized = normalizeSpatialScene({
    nodes: [
      { label: "A", color: "javascript:alert(1)", geometry: "unknown" },
      { label: "B", scale: null },
      { label: "C" },
      { label: "D" }
    ],
    camera: {
      fov: 180,
      near: -4,
      far: 1,
      min_distance: 9,
      max_distance: 2,
      auto_rotate: false
    }
  });

  assert.deepEqual(
    normalized.nodes.map((node) => node.id),
    ["node-1", "node-2", "node-3", "node-4"]
  );
  assert.equal(new Set(normalized.nodes.map((node) => node.position.join(","))).size, 4);
  assert.equal(normalized.nodes[0].geometry, "sphere");
  assert.equal(normalized.nodes[0].color, "#6750a4");
  assert.deepEqual(normalized.nodes[1].scale, [1, 1, 1]);
  assert.equal(normalized.camera.fov, 72);
  assert.equal(normalized.camera.near, 0.001);
  assert.ok(normalized.camera.far >= normalized.camera.near + 10);
  assert.ok(normalized.camera.max_distance > normalized.camera.min_distance);
  assert.equal(normalized.camera.auto_rotate, false);
});

test("calculates stable bounds for empty, single-node and distributed scenes", () => {
  assert.deepEqual(calculateSpatialBounds([]), {
    min: [-1, -1, -1],
    max: [1, 1, 1],
    center: [0, 0, 0],
    size: [2, 2, 2],
    radius: 1.5
  });

  const single = calculateSpatialBounds([
    { position: [4, 5, 6], scale: [1, 1, 1] }
  ]);
  assert.deepEqual(single.center, [4, 5, 6]);
  assert.equal(single.radius, 1.5);

  const distributed = calculateSpatialBounds([
    { position: [-3, -2, -1], scale: 1 },
    { position: [5, 4, 3], scale: [2, 1, 1] }
  ]);
  assert.deepEqual(distributed.min, [-3, -2, -1]);
  assert.deepEqual(distributed.max, [5, 4, 3]);
  assert.deepEqual(distributed.center, [1, 1, 1]);
  assert.deepEqual(distributed.size, [8, 6, 4]);
  assert.ok(distributed.radius > 6);
});

test("handles malformed input as an empty but mountable scene", () => {
  const normalized = normalizeSpatialScene(null);

  assert.equal(normalized.version, "1.0");
  assert.equal(normalized.title, "空间结构探索");
  assert.deepEqual(normalized.nodes, []);
  assert.deepEqual(normalized.edges, []);
  assert.deepEqual(normalized.camera.target, [0, 0, 0]);
  assert.ok(normalized.camera.position[2] > 0);
});

test("accepts the generated pipeline geometry and relation contract", () => {
  const normalized = normalizeSpatialScene({
    spatial_scene: {
      id: "scene_pipeline",
      nodes: [
        {
          id: "root",
          label: "核心",
          kind: "concept",
          claim_ids: ["claim_core"],
          geometry: {
            shape: "plane",
            position: { x: 1, y: 2, z: 3 },
            size: { x: 2, y: 1, z: 0.2 },
            rotation: { x: 15, y: -30, z: 90 }
          }
        },
        {
          id: "part",
          label: "部件",
          kind: "structure",
          claim_ids: ["claim_part", "claim_core"],
          geometry: {
            shape: "custom",
            position: { x: -2, y: 0, z: 1 },
            size: { x: 0.8, y: 0.9, z: 1 }
          }
        }
      ],
      edges: [
        {
          from: "root",
          to: "part",
          relation: "包含",
          geometry: {
            path: [
              { x: 1, y: 2, z: 3 },
              { x: 0, y: 3.5, z: 2 },
              { x: -2, y: 0, z: 1 }
            ]
          }
        }
      ],
      layers: [
        {
          id: "layer_core",
          label: "核心结构",
          node_ids: ["root", "part"],
          default_visible: false
        }
      ]
    }
  });

  assert.equal(normalized.id, "scene_pipeline");
  assert.deepEqual(normalized.nodes[0].position, [1, 2, 3]);
  assert.deepEqual(normalized.nodes[0].scale, [2, 1, 0.2]);
  assert.deepEqual(normalized.nodes[0].rotation, [15, -30, 90]);
  assert.equal(normalized.nodes[0].geometry, "box");
  assert.equal(normalized.nodes[0].kind, "concept");
  assert.deepEqual(normalized.nodes[0].claim_ids, ["claim_core"]);
  assert.equal(normalized.nodes[1].geometry, "dodecahedron");
  assert.equal(normalized.nodes[1].kind, "structure");
  assert.deepEqual(normalized.nodes[1].claim_ids, ["claim_part", "claim_core"]);
  assert.equal(normalized.edges[0].label, "包含");
  assert.deepEqual(normalized.edges[0].geometry.path, [
    [1, 2, 3],
    [0, 3.5, 2],
    [-2, 0, 1]
  ]);
  assert.deepEqual(normalized.layers, [
    {
      id: "layer_core",
      label: "核心结构",
      node_ids: ["root", "part"],
      default_visible: false
    }
  ]);
});

test("keeps selection payload semantics and normalizes aliases without mutation", () => {
  const source = {
    nodes: [
      {
        id: "force node",
        label: "合外力",
        kind: "process",
        claimIds: ["claim_force", "claim_force", "", "claim_motion"],
        rotation: [0, 450, -450],
        position: [0, 0, 0]
      },
      {
        id: "result node",
        label: "结果",
        kind: "annotation",
        claim_ids: ["claim_result"],
        position: [3, 1, 0]
      }
    ],
    edges: [
      {
        from: "force node",
        to: "result node",
        label: "导致",
        path: [[0, 0, 0], [1.5, 2, 0], [3, 1, 0]]
      }
    ],
    layers: [
      {
        id: "hidden layer",
        label: "推导层",
        nodeIds: ["force node", "result node", "missing"],
        defaultVisible: false
      }
    ]
  };
  const snapshot = structuredClone(source);

  const normalized = normalizeSpatialScene(source);
  const selectableNode = normalized.nodes[0];

  assert.deepEqual(source, snapshot);
  assert.equal(selectableNode.kind, "process");
  assert.deepEqual(selectableNode.claim_ids, ["claim_force", "claim_motion"]);
  assert.deepEqual(selectableNode.rotation, [0, 360, -360]);
  assert.deepEqual(normalized.edges[0].geometry.path, [
    [0, 0, 0],
    [1.5, 2, 0],
    [3, 1, 0]
  ]);
  assert.deepEqual(normalized.layers[0], {
    id: "hidden-layer",
    label: "推导层",
    node_ids: ["force-node", "result-node"],
    default_visible: false
  });
});
