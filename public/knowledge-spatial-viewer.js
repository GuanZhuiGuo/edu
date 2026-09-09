const DEFAULT_THREE_MODULE_URL = "/vendor/three.module.js";
const DEFAULT_COLORS = [
  "#6750a4",
  "#386a20",
  "#006a6a",
  "#8c5000",
  "#984061",
  "#415f91"
];
const SUPPORTED_GEOMETRIES = new Set([
  "sphere",
  "box",
  "cylinder",
  "cone",
  "torus",
  "octahedron",
  "tetrahedron",
  "dodecahedron"
]);
const GEOMETRY_ALIASES = new Map([
  ["ball", "sphere"],
  ["orb", "sphere"],
  ["cube", "box"],
  ["rect", "box"],
  ["tube", "cylinder"],
  ["pyramid", "cone"],
  ["ring", "torus"],
  ["plane", "box"],
  ["custom", "dodecahedron"],
  ["octa", "octahedron"],
  ["tetra", "tetrahedron"],
  ["dodeca", "dodecahedron"]
]);
const mountedViewers = new WeakMap();
const modulePromises = new Map();

/**
 * Normalize the generic spatial_scene contract without mutating the source.
 *
 * Supported input:
 * {
 *   spatial_scene: {
 *     nodes: [{
 *       id, label, kind, description, claim_ids, position, geometry, color,
 *       scale, rotation, parent_id
 *     }],
 *     edges: [{ from, to, label, geometry: { path } }],
 *     layers: [{ id, label, node_ids, default_visible }],
 *     camera: { position, target, fov, near, far, min_distance, max_distance, auto_rotate }
 *   }
 * }
 */
export function normalizeSpatialScene(input = {}) {
  const source =
    isRecord(input?.spatial_scene) ? input.spatial_scene : isRecord(input) ? input : {};
  const rawNodes = Array.isArray(source.nodes) ? source.nodes.filter(isRecord) : [];
  const usedNodeIds = new Set();
  const nodeAliases = new Map();
  const pendingParents = new Map();

  const nodes = rawNodes.map((rawNode, index) => {
    const rawId = normalizeReference(rawNode.id);
    const baseId = normalizeIdentifier(rawId || `node-${index + 1}`);
    const id = createUniqueId(baseId || `node-${index + 1}`, usedNodeIds);
    const fallbackPosition = createFallbackPosition(index, rawNodes.length);
    const geometrySource = isRecord(rawNode.geometry) ? rawNode.geometry : {};
    const position = normalizeVector3(
      rawNode.position ?? geometrySource.position,
      fallbackPosition,
      -10000,
      10000
    );
    const scale = normalizeScale(rawNode.scale ?? geometrySource.size);
    const geometry = normalizeGeometry(
      geometrySource.shape ?? rawNode.geometry
    );
    const color = normalizeColor(rawNode.color, DEFAULT_COLORS[index % DEFAULT_COLORS.length]);
    const rotation = normalizeVector3(
      rawNode.rotation ?? geometrySource.rotation,
      [0, 0, 0],
      -360,
      360
    );

    if (rawId && !nodeAliases.has(rawId)) nodeAliases.set(rawId, id);
    if (!nodeAliases.has(id)) nodeAliases.set(id, id);
    pendingParents.set(id, normalizeReference(rawNode.parent_id ?? rawNode.parentId));

    return {
      id,
      label: normalizeText(rawNode.label ?? rawNode.name, `节点 ${index + 1}`, 120),
      kind: normalizeText(rawNode.kind, "structure", 40),
      description: normalizeText(rawNode.description ?? rawNode.note, "", 1200),
      claim_ids: normalizeReferenceList(rawNode.claim_ids ?? rawNode.claimIds, 32),
      position,
      geometry,
      color,
      scale,
      rotation,
      parent_id: null
    };
  });

  const nodeIds = new Set(nodes.map((node) => node.id));
  const resolveNodeId = (reference) => {
    const rawReference = normalizeReference(reference);
    if (!rawReference) return null;
    if (nodeAliases.has(rawReference)) return nodeAliases.get(rawReference);
    const normalizedReference = normalizeIdentifier(rawReference);
    return nodeIds.has(normalizedReference) ? normalizedReference : null;
  };

  nodes.forEach((node) => {
    const parentId = resolveNodeId(pendingParents.get(node.id));
    node.parent_id = parentId && parentId !== node.id ? parentId : null;
  });

  const nodePositionById = new Map(
    nodes.map((node) => [node.id, node.position])
  );
  const edges = [];
  const edgeKeys = new Set();
  const usedEdgeIds = new Set();
  const rawEdges = Array.isArray(source.edges) ? source.edges.filter(isRecord) : [];
  rawEdges.forEach((rawEdge, index) => {
    const from = resolveNodeId(rawEdge.from ?? rawEdge.source);
    const to = resolveNodeId(rawEdge.to ?? rawEdge.target);
    if (!from || !to || from === to) return;
    const key = `${from}\u0000${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    const fallbackPath = [
      nodePositionById.get(from) || [0, 0, 0],
      nodePositionById.get(to) || [0, 0, 0]
    ];
    edges.push({
      id: createUniqueId(
        normalizeIdentifier(normalizeReference(rawEdge.id) || `edge-${index + 1}`),
        usedEdgeIds
      ),
      from,
      to,
      label: normalizeText(rawEdge.label ?? rawEdge.relation, "", 120),
      geometry: {
        path: normalizeSpatialPath(
          rawEdge.geometry?.path ?? rawEdge.path,
          fallbackPath
        )
      },
      derived: false
    });
  });

  nodes.forEach((node) => {
    if (!node.parent_id) return;
    const key = `${node.parent_id}\u0000${node.id}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: createUniqueId(`parent-${node.parent_id}-${node.id}`, usedEdgeIds),
      from: node.parent_id,
      to: node.id,
      label: "",
      geometry: {
        path: [
          [...(nodePositionById.get(node.parent_id) || [0, 0, 0])],
          [...node.position]
        ]
      },
      derived: true
    });
  });

  const layers = normalizeSpatialLayers(source.layers, resolveNodeId);
  const bounds = calculateSpatialBounds(nodes);
  const camera = normalizeCamera(source.camera, bounds);

  return {
    id: normalizeIdentifier(normalizeReference(source.id) || "spatial-scene"),
    version: normalizeText(source.version, "1.0", 24),
    title: normalizeText(source.title, "空间结构探索", 160),
    description: normalizeText(source.description, "", 1200),
    coordinate_system: normalizeText(
      source.coordinate_system ?? source.coordinateSystem,
      "cartesian-3d",
      40
    ),
    nodes,
    edges,
    layers,
    camera
  };
}

export function calculateSpatialBounds(nodes = []) {
  const validNodes = Array.isArray(nodes) ? nodes.filter(isRecord) : [];
  if (!validNodes.length) {
    return {
      min: [-1, -1, -1],
      max: [1, 1, 1],
      center: [0, 0, 0],
      size: [2, 2, 2],
      radius: 1.5
    };
  }

  const positions = validNodes.map((node) =>
    normalizeVector3(node.position, [0, 0, 0], -10000, 10000)
  );
  const min = [...positions[0]];
  const max = [...positions[0]];
  positions.forEach((position) => {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], position[axis]);
      max[axis] = Math.max(max[axis], position[axis]);
    }
  });

  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const size = min.map((value, axis) => max[axis] - value);
  const spreadRadius = Math.max(
    ...positions.map((position) =>
      Math.hypot(
        position[0] - center[0],
        position[1] - center[1],
        position[2] - center[2]
      )
    )
  );
  const largestScale = Math.max(
    1,
    ...validNodes.flatMap((node) => normalizeScale(node.scale))
  );
  const radius = Math.max(1.5, spreadRadius + largestScale * 0.72);

  return { min, max, center, size, radius };
}

/**
 * Mount a dependency-light Three.js viewer.
 *
 * `options.three` may inject an already loaded Three.js module. Otherwise the
 * browser imports `/vendor/three.module.js` (or `options.threeModuleUrl`).
 * The function is async so importing this module in Node does not resolve the
 * browser-only Three.js URL.
 */
export async function mountKnowledgeSpatialViewer(container, scene, options = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("mountKnowledgeSpatialViewer requires a DOM container");
  }

  mountedViewers.get(container)?.destroy();
  const THREE = await resolveThreeModule(options);
  assertThreeModule(THREE);
  mountedViewers.get(container)?.destroy();
  const normalizedScene = normalizeSpatialScene(scene);
  const controller = createSpatialViewer(container, normalizedScene, THREE, options);
  mountedViewers.set(container, controller);
  return controller;
}

function createSpatialViewer(container, spatialScene, THREE, options) {
  const doc = container.ownerDocument;
  const view = doc.defaultView || window;
  const root = doc.createElement("section");
  root.className = "knowledge-spatial-viewer";
  root.setAttribute("aria-label", spatialScene.title);
  root.style.setProperty(
    "--ksv-min-height",
    normalizeCssSize(options.minHeight, "360px")
  );

  const style = doc.createElement("style");
  style.textContent = viewerStyles();

  const stage = doc.createElement("div");
  stage.className = "knowledge-spatial-viewer__stage";
  const canvasHost = doc.createElement("div");
  canvasHost.className = "knowledge-spatial-viewer__canvas";
  const labelLayer = doc.createElement("div");
  labelLayer.className = "knowledge-spatial-viewer__labels";
  labelLayer.setAttribute("aria-label", "空间节点");

  const toolbar = doc.createElement("div");
  toolbar.className = "knowledge-spatial-viewer__toolbar";
  const toolbarGroup = doc.createElement("div");
  toolbarGroup.className = "knowledge-spatial-viewer__toolbar-group";
  const autoRotateButton = createButton(doc, "自动旋转");
  const resetButton = createButton(doc, "重置视角");
  const clearButton = createButton(doc, "显示全部");
  clearButton.hidden = true;
  toolbarGroup.append(autoRotateButton, resetButton, clearButton);
  const sceneCount = doc.createElement("span");
  sceneCount.className = "knowledge-spatial-viewer__count";
  sceneCount.textContent = `${spatialScene.nodes.length} 个节点 · ${spatialScene.edges.length} 条关系`;
  toolbar.append(toolbarGroup, sceneCount);

  const details = doc.createElement("div");
  details.className = "knowledge-spatial-viewer__details";
  details.setAttribute("aria-live", "polite");
  const detailsTitle = doc.createElement("strong");
  const detailsDescription = doc.createElement("span");
  detailsTitle.textContent = spatialScene.title;
  detailsDescription.textContent = spatialScene.nodes.length
    ? "拖拽旋转，滚轮或触控板缩放；点击节点查看结构关系。"
    : "当前知识产物没有可展示的空间节点。";
  details.append(detailsTitle, detailsDescription);

  stage.append(canvasHost, labelLayer, toolbar, details);
  root.append(style, stage);
  container.replaceChildren(root);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
  } catch (error) {
    detailsTitle.textContent = "无法启动 3D 视图";
    detailsDescription.textContent = "当前设备或浏览器没有可用的 WebGL 环境。";
    root.dataset.state = "unsupported";
    throw error;
  }

  renderer.setPixelRatio(Math.min(Number(view.devicePixelRatio) || 1, 2));
  renderer.setClearColor(0x000000, 0);
  if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  if (THREE.ACESFilmicToneMapping) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
  }
  renderer.domElement.setAttribute("aria-label", "可交互知识空间 3D 场景");
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.style.touchAction = "none";
  canvasHost.append(renderer.domElement);

  const webglScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    spatialScene.camera.fov,
    1,
    spatialScene.camera.near,
    spatialScene.camera.far
  );
  const cameraTarget = new THREE.Vector3(...spatialScene.camera.target);
  const desiredCameraTarget = cameraTarget.clone();
  const cameraDirection = new THREE.Vector3(...spatialScene.camera.position)
    .sub(cameraTarget)
    .normalize();
  if (!Number.isFinite(cameraDirection.lengthSq()) || cameraDirection.lengthSq() < 0.01) {
    cameraDirection.set(0.4, 0.28, 1).normalize();
  }
  let cameraDistance = clamp(
    new THREE.Vector3(...spatialScene.camera.position).distanceTo(cameraTarget),
    spatialScene.camera.min_distance,
    spatialScene.camera.max_distance
  );
  let desiredCameraDistance = cameraDistance;
  camera.position.copy(cameraTarget).addScaledVector(cameraDirection, cameraDistance);
  camera.lookAt(cameraTarget);

  const ambientLight = new THREE.HemisphereLight(0xffffff, 0xc7c3d1, 1.75);
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
  keyLight.position.set(5, 7, 8);
  const fillLight = new THREE.DirectionalLight(0xbec9ff, 1.35);
  fillLight.position.set(-6, 1, 4);
  webglScene.add(ambientLight, keyLight, fillLight);

  const bounds = calculateSpatialBounds(spatialScene.nodes);
  const pivot = new THREE.Group();
  pivot.position.set(...bounds.center);
  pivot.name = "knowledge-spatial-pivot";
  webglScene.add(pivot);

  const gridSize = Math.max(6, Math.ceil(bounds.radius * 3.4));
  const grid = new THREE.GridHelper(gridSize, 12, 0xc8c4d4, 0xe4e1eb);
  grid.position.set(
    bounds.center[0],
    bounds.center[1] - Math.max(1.2, bounds.radius * 0.72),
    bounds.center[2]
  );
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.24;
  });
  webglScene.add(grid);

  const nodeById = new Map(spatialScene.nodes.map((node) => [node.id, node]));
  const nodeEntries = new Map();
  const clickableMeshes = [];
  spatialScene.nodes.forEach((node) => {
    const geometry = createGeometry(THREE, node.geometry);
    const material = new THREE.MeshStandardMaterial({
      color: node.color,
      roughness: 0.38,
      metalness: 0.08,
      transparent: true,
      opacity: 0.94,
      emissive: node.color,
      emissiveIntensity: 0.055
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      node.position[0] - bounds.center[0],
      node.position[1] - bounds.center[1],
      node.position[2] - bounds.center[2]
    );
    mesh.scale.set(...node.scale);
    mesh.rotation.set(
      degreesToRadians(node.rotation[0]),
      degreesToRadians(node.rotation[1]),
      degreesToRadians(node.rotation[2])
    );
    mesh.userData.nodeId = node.id;
    mesh.userData.kind = node.kind;
    mesh.userData.claimIds = [...node.claim_ids];
    mesh.name = `knowledge-node:${node.id}`;
    pivot.add(mesh);
    clickableMeshes.push(mesh);

    const label = doc.createElement("button");
    label.type = "button";
    label.className = "knowledge-spatial-viewer__label";
    label.dataset.nodeId = node.id;
    label.textContent = node.label;
    label.title = node.description || node.label;
    label.setAttribute("aria-label", `聚焦 ${node.label}`);
    labelLayer.append(label);

    nodeEntries.set(node.id, {
      node,
      mesh,
      material,
      label,
      baseScale: new THREE.Vector3(...node.scale),
      worldPosition: new THREE.Vector3()
    });
  });

  const edgeEntries = [];
  spatialScene.edges.forEach((edge) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) return;
    const fallbackPath = [from.position, to.position];
    const path = Array.isArray(edge.geometry?.path) && edge.geometry.path.length >= 2
      ? edge.geometry.path
      : fallbackPath;
    const controlPoints = path.map(
      (point) =>
        new THREE.Vector3(
          point[0] - bounds.center[0],
          point[1] - bounds.center[1],
          point[2] - bounds.center[2]
        )
    );
    let renderPoints = controlPoints;
    if (controlPoints.length > 2 && typeof THREE.CatmullRomCurve3 === "function") {
      const curve = new THREE.CatmullRomCurve3(
        controlPoints,
        false,
        "centripetal"
      );
      renderPoints = curve.getPoints(Math.max(24, (controlPoints.length - 1) * 16));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(renderPoints);
    const material = new THREE.LineBasicMaterial({
      color: edge.derived ? 0xa8a2b6 : 0x81789a,
      transparent: true,
      opacity: edge.derived ? 0.38 : 0.58
    });
    const line = new THREE.Line(geometry, material);
    line.name = `knowledge-edge:${edge.id}`;
    pivot.add(line);

    let label = null;
    if (edge.label) {
      label = doc.createElement("span");
      label.className =
        "knowledge-spatial-viewer__edge-label knowledge-spatial-viewer__projected";
      label.textContent = edge.label;
      labelLayer.append(label);
    }
    edgeEntries.push({
      edge,
      line,
      material,
      label,
      localPosition:
        renderPoints[Math.floor((renderPoints.length - 1) / 2)]?.clone() ||
        controlPoints[0].clone(),
      worldPosition: new THREE.Vector3()
    });
  });

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const eventController = new AbortController();
  const signal = eventController.signal;
  const mediaQuery =
    typeof view.matchMedia === "function"
      ? view.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  let reducedMotion = Boolean(mediaQuery?.matches);
  let autoRotate =
    !reducedMotion &&
    Boolean(options.autoRotate ?? spatialScene.camera.auto_rotate ?? true);
  let selectedId = null;
  let destroyed = false;
  let animationFrame = 0;
  let previousFrameTime = 0;
  let pointerState = null;
  let resizeObserver = null;

  const refreshAutoRotateButton = () => {
    autoRotateButton.disabled = reducedMotion;
    autoRotateButton.setAttribute("aria-pressed", String(autoRotate));
    autoRotateButton.textContent = reducedMotion
      ? "已减少动态"
      : autoRotate
        ? "暂停旋转"
        : "自动旋转";
    autoRotateButton.title = reducedMotion
      ? "系统已启用减少动态效果"
      : "切换场景自动旋转";
  };

  const updateSelection = (nodeId, emit = true) => {
    const selectedEntry = nodeId ? nodeEntries.get(nodeId) : null;
    selectedId = selectedEntry?.node.id || null;
    clearButton.hidden = !selectedId;

    nodeEntries.forEach((entry, id) => {
      const active = id === selectedId;
      const dimmed = Boolean(selectedId) && !active;
      entry.material.opacity = dimmed ? 0.16 : active ? 1 : 0.94;
      entry.material.emissiveIntensity = active ? 0.5 : dimmed ? 0 : 0.055;
      entry.material.depthWrite = !dimmed;
      entry.mesh.renderOrder = active ? 3 : dimmed ? 0 : 1;
      entry.mesh.scale
        .copy(entry.baseScale)
        .multiplyScalar(active ? 1.12 : 1);
      entry.label.classList.toggle("is-active", active);
      entry.label.classList.toggle("is-dimmed", dimmed);
      entry.label.setAttribute("aria-pressed", String(active));
    });

    edgeEntries.forEach((entry) => {
      const connected =
        selectedId &&
        (entry.edge.from === selectedId || entry.edge.to === selectedId);
      entry.material.opacity = selectedId
        ? connected
          ? 0.72
          : 0.07
        : entry.edge.derived
          ? 0.38
          : 0.58;
      if (entry.label) {
        entry.label.classList.toggle("is-dimmed", Boolean(selectedId) && !connected);
      }
    });

    if (selectedEntry) {
      selectedEntry.mesh.getWorldPosition(desiredCameraTarget);
      desiredCameraDistance = clamp(
        Math.min(desiredCameraDistance, Math.max(bounds.radius * 1.85, 2.6)),
        spatialScene.camera.min_distance,
        spatialScene.camera.max_distance
      );
      detailsTitle.textContent = selectedEntry.node.label;
      detailsDescription.textContent =
        selectedEntry.node.description || "已聚焦该结构节点。";
    } else {
      desiredCameraTarget.set(...spatialScene.camera.target);
      detailsTitle.textContent = spatialScene.title;
      detailsDescription.textContent = spatialScene.nodes.length
        ? "拖拽旋转，滚轮或触控板缩放；点击节点查看结构关系。"
        : "当前知识产物没有可展示的空间节点。";
    }

    if (emit) {
      const selectedNode = selectedEntry?.node || null;
      if (typeof options.onSelect === "function") options.onSelect(selectedNode);
      root.dispatchEvent(
        new view.CustomEvent("knowledge-spatial:select", {
          bubbles: true,
          detail: {
            node: selectedNode,
            kind: selectedNode?.kind || null,
            claim_ids: selectedNode ? [...selectedNode.claim_ids] : []
          }
        })
      );
    }
    return selectedEntry?.node || null;
  };

  const setAutoRotate = (value) => {
    autoRotate = !reducedMotion && Boolean(value);
    refreshAutoRotateButton();
    return autoRotate;
  };

  const reset = () => {
    pivot.rotation.set(0, 0, 0);
    cameraTarget.set(...spatialScene.camera.target);
    desiredCameraTarget.copy(cameraTarget);
    cameraDistance = clamp(
      new THREE.Vector3(...spatialScene.camera.position).distanceTo(cameraTarget),
      spatialScene.camera.min_distance,
      spatialScene.camera.max_distance
    );
    desiredCameraDistance = cameraDistance;
    updateSelection(null);
  };

  const pickAt = (event) => {
    if (!clickableMeshes.length) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointerNdc, camera);
    const intersection = raycaster.intersectObjects(clickableMeshes, false)[0];
    return updateSelection(intersection?.object?.userData?.nodeId || null);
  };

  const resize = () => {
    if (destroyed) return;
    const rect = canvasHost.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || root.clientWidth || 1));
    const height = Math.max(1, Math.round(rect.height || root.clientHeight || 1));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const projectPosition = (worldPosition, element) => {
    const projected = worldPosition.clone().project(camera);
    const visible =
      projected.z > -1 &&
      projected.z < 1 &&
      projected.x > -1.15 &&
      projected.x < 1.15 &&
      projected.y > -1.15 &&
      projected.y < 1.15;
    element.hidden = !visible;
    if (!visible) return;
    element.style.transform = `translate(-50%, -50%) translate(${(
      (projected.x * 0.5 + 0.5) *
      canvasHost.clientWidth
    ).toFixed(1)}px, ${(
      (-projected.y * 0.5 + 0.5) *
      canvasHost.clientHeight
    ).toFixed(1)}px)`;
    element.style.zIndex = String(Math.max(1, Math.round((1 - projected.z) * 100)));
  };

  const updateProjectedLabels = () => {
    pivot.updateMatrixWorld(true);
    nodeEntries.forEach((entry) => {
      entry.mesh.getWorldPosition(entry.worldPosition);
      projectPosition(entry.worldPosition, entry.label);
    });
    edgeEntries.forEach((entry) => {
      if (!entry.label) return;
      entry.worldPosition.copy(entry.localPosition).applyMatrix4(pivot.matrixWorld);
      projectPosition(entry.worldPosition, entry.label);
    });
  };

  const animate = (time) => {
    if (destroyed) return;
    const delta = Math.min(0.05, Math.max(0, (time - previousFrameTime) / 1000 || 0));
    previousFrameTime = time;
    if (autoRotate) pivot.rotation.y += delta * 0.22;

    if (selectedId) {
      const selectedEntry = nodeEntries.get(selectedId);
      selectedEntry?.mesh.getWorldPosition(desiredCameraTarget);
    }
    const easing = reducedMotion ? 1 : 1 - Math.pow(0.001, delta || 1 / 60);
    cameraTarget.lerp(desiredCameraTarget, easing);
    cameraDistance += (desiredCameraDistance - cameraDistance) * easing;
    camera.position.copy(cameraTarget).addScaledVector(cameraDirection, cameraDistance);
    camera.lookAt(cameraTarget);
    renderer.render(webglScene, camera);
    updateProjectedLabels();
    animationFrame = view.requestAnimationFrame(animate);
  };

  autoRotateButton.addEventListener(
    "click",
    () => setAutoRotate(!autoRotate),
    { signal }
  );
  resetButton.addEventListener("click", reset, { signal });
  clearButton.addEventListener("click", () => updateSelection(null), { signal });
  labelLayer.addEventListener(
    "click",
    (event) => {
      const label =
        typeof event.target?.closest === "function"
          ? event.target.closest("[data-node-id]")
          : null;
      if (label) updateSelection(label.dataset.nodeId);
    },
    { signal }
  );
  renderer.domElement.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      renderer.domElement.setPointerCapture?.(event.pointerId);
      pointerState = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false
      };
    },
    { signal }
  );
  renderer.domElement.addEventListener(
    "pointermove",
    (event) => {
      if (!pointerState || event.pointerId !== pointerState.id) return;
      const dx = event.clientX - pointerState.lastX;
      const dy = event.clientY - pointerState.lastY;
      pointerState.lastX = event.clientX;
      pointerState.lastY = event.clientY;
      pointerState.moved ||= Math.hypot(
        event.clientX - pointerState.startX,
        event.clientY - pointerState.startY
      ) > 4;
      if (!pointerState.moved) return;
      setAutoRotate(false);
      pivot.rotation.y += dx * 0.007;
      pivot.rotation.x = clamp(pivot.rotation.x + dy * 0.005, -1.05, 1.05);
    },
    { signal }
  );
  const finishPointer = (event) => {
    if (!pointerState || event.pointerId !== pointerState.id) return;
    const wasMoved = pointerState.moved;
    pointerState = null;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
    if (!wasMoved) pickAt(event);
  };
  renderer.domElement.addEventListener("pointerup", finishPointer, { signal });
  renderer.domElement.addEventListener(
    "pointercancel",
    () => {
      pointerState = null;
    },
    { signal }
  );
  renderer.domElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      desiredCameraDistance = clamp(
        desiredCameraDistance * Math.exp(event.deltaY * 0.00115),
        spatialScene.camera.min_distance,
        spatialScene.camera.max_distance
      );
    },
    { signal, passive: false }
  );
  renderer.domElement.addEventListener(
    "dblclick",
    () => updateSelection(null),
    { signal }
  );

  const handleMotionPreference = (event) => {
    reducedMotion = event.matches;
    if (reducedMotion) autoRotate = false;
    refreshAutoRotateButton();
  };
  mediaQuery?.addEventListener?.("change", handleMotionPreference);

  if (typeof view.ResizeObserver === "function") {
    resizeObserver = new view.ResizeObserver(resize);
    resizeObserver.observe(canvasHost);
  } else {
    view.addEventListener("resize", resize, { signal });
  }

  refreshAutoRotateButton();
  resize();
  animationFrame = view.requestAnimationFrame(animate);

  const controller = {
    scene: spatialScene,
    root,
    select(nodeId) {
      return updateSelection(normalizeReference(nodeId));
    },
    reset,
    setAutoRotate,
    getSelectedNode() {
      return selectedId ? nodeById.get(selectedId) || null : null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      eventController.abort();
      resizeObserver?.disconnect();
      mediaQuery?.removeEventListener?.("change", handleMotionPreference);
      view.cancelAnimationFrame(animationFrame);
      webglScene.traverse((object) => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material)
          ? object.material
          : object.material
            ? [object.material]
            : [];
        materials.forEach((material) => {
          Object.values(material).forEach((value) => {
            if (value?.isTexture) value.dispose();
          });
          material.dispose?.();
        });
      });
      renderer.dispose();
      renderer.forceContextLoss?.();
      if (root.isConnected) root.remove();
      if (mountedViewers.get(container) === controller) mountedViewers.delete(container);
    }
  };

  return controller;
}

function normalizeCamera(cameraInput, bounds) {
  const camera = isRecord(cameraInput) ? cameraInput : {};
  const radius = bounds.radius;
  const target = normalizeVector3(camera.target, bounds.center, -10000, 10000);
  const defaultPosition = [
    target[0] + radius * 0.72,
    target[1] + radius * 0.48,
    target[2] + radius * 2.75
  ];
  const position = normalizeVector3(camera.position, defaultPosition, -10000, 10000);
  const inferredDistance = Math.max(
    0.1,
    Math.hypot(
      position[0] - target[0],
      position[1] - target[1],
      position[2] - target[2]
    )
  );
  const minDistance = clamp(
    finiteNumber(camera.min_distance ?? camera.minDistance, Math.max(1, radius * 0.55)),
    0.25,
    10000
  );
  const maxDistance = Math.max(
    minDistance + 0.5,
    clamp(
      finiteNumber(
        camera.max_distance ?? camera.maxDistance,
        Math.max(radius * 8, inferredDistance * 2.8)
      ),
      1,
      50000
    )
  );
  const near = clamp(finiteNumber(camera.near, 0.05), 0.001, 100);
  const far = Math.max(
    near + 10,
    clamp(finiteNumber(camera.far, Math.max(2000, radius * 100)), 10, 100000)
  );

  return {
    position,
    target,
    fov: clamp(finiteNumber(camera.fov, 42), 24, 72),
    near,
    far,
    min_distance: Math.min(minDistance, maxDistance - 0.5),
    max_distance: maxDistance,
    auto_rotate:
      typeof camera.auto_rotate === "boolean"
        ? camera.auto_rotate
        : typeof camera.autoRotate === "boolean"
          ? camera.autoRotate
          : true
  };
}

function normalizeVector3(value, fallback, minimum, maximum) {
  const values = Array.isArray(value)
    ? value
    : isRecord(value)
      ? [value.x, value.y, value.z]
      : [];
  return [0, 1, 2].map((axis) =>
    clamp(finiteNumber(values[axis], fallback[axis]), minimum, maximum)
  );
}

function normalizeScale(value) {
  if (Array.isArray(value) || isRecord(value)) {
    return normalizeVector3(value, [1, 1, 1], 0.12, 8);
  }
  const scalar = clamp(finiteNumber(value, 1), 0.12, 8);
  return [scalar, scalar, scalar];
}

function normalizeReferenceList(value, maximum = 32) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const references = [];
  for (const item of value) {
    const reference = normalizeReference(item);
    if (!reference || seen.has(reference)) continue;
    seen.add(reference);
    references.push(reference);
    if (references.length >= maximum) break;
  }
  return references;
}

function normalizeSpatialPath(value, fallback) {
  const source = Array.isArray(value) && value.length >= 2 ? value : fallback;
  return source
    .slice(0, 64)
    .map((point, index) =>
      normalizeVector3(
        point,
        fallback[Math.min(index, fallback.length - 1)] || [0, 0, 0],
        -10000,
        10000
      )
    );
}

function normalizeSpatialLayers(value, resolveNodeId) {
  if (!Array.isArray(value)) return [];
  const usedLayerIds = new Set();
  return value
    .filter(isRecord)
    .slice(0, 32)
    .map((layer, index) => {
      const id = createUniqueId(
        normalizeIdentifier(normalizeReference(layer.id) || `layer-${index + 1}`),
        usedLayerIds
      );
      const nodeIds = [];
      const seenNodeIds = new Set();
      const rawNodeIds = Array.isArray(layer.node_ids)
        ? layer.node_ids
        : Array.isArray(layer.nodeIds)
          ? layer.nodeIds
          : [];
      rawNodeIds.forEach((reference) => {
        const nodeId = resolveNodeId(reference);
        if (!nodeId || seenNodeIds.has(nodeId)) return;
        seenNodeIds.add(nodeId);
        nodeIds.push(nodeId);
      });
      return {
        id,
        label: normalizeText(layer.label ?? layer.name, `图层 ${index + 1}`, 120),
        node_ids: nodeIds,
        default_visible:
          typeof layer.default_visible === "boolean"
            ? layer.default_visible
            : typeof layer.defaultVisible === "boolean"
              ? layer.defaultVisible
              : true
      };
    });
}

function normalizeGeometry(value) {
  const raw = isRecord(value) ? value.type ?? value.name : value;
  const key = String(raw || "sphere").trim().toLowerCase();
  const aliased = GEOMETRY_ALIASES.get(key) || key;
  return SUPPORTED_GEOMETRIES.has(aliased) ? aliased : "sphere";
}

function normalizeColor(value, fallback) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{3}$/i.test(color) || /^#[0-9a-f]{6}$/i.test(color)) {
    return color.toLowerCase();
  }
  return fallback;
}

function createFallbackPosition(index, total) {
  if (total <= 1) return [0, 0, 0];
  const columns = Math.max(2, Math.ceil(Math.sqrt(total)));
  const rows = Math.ceil(total / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  return [
    (column - (columns - 1) / 2) * 2.15,
    ((rows - 1) / 2 - row) * 1.85,
    ((index % 3) - 1) * 0.38
  ];
}

function createGeometry(THREE, geometry) {
  switch (geometry) {
    case "box":
      return new THREE.BoxGeometry(0.92, 0.92, 0.92, 2, 2, 2);
    case "cylinder":
      return new THREE.CylinderGeometry(0.46, 0.54, 1.12, 28, 2);
    case "cone":
      return new THREE.ConeGeometry(0.58, 1.16, 30, 2);
    case "torus":
      return new THREE.TorusGeometry(0.52, 0.18, 18, 48);
    case "octahedron":
      return new THREE.OctahedronGeometry(0.68, 1);
    case "tetrahedron":
      return new THREE.TetrahedronGeometry(0.74, 1);
    case "dodecahedron":
      return new THREE.DodecahedronGeometry(0.64, 1);
    case "sphere":
    default:
      return new THREE.SphereGeometry(0.56, 32, 24);
  }
}

async function resolveThreeModule(options) {
  const provided = options.three || options.THREE;
  if (provided) return provided;
  const url = String(options.threeModuleUrl || DEFAULT_THREE_MODULE_URL);
  if (!modulePromises.has(url)) {
    modulePromises.set(
      url,
      import(url).catch((error) => {
        modulePromises.delete(url);
        throw error;
      })
    );
  }
  return modulePromises.get(url);
}

function assertThreeModule(THREE) {
  const required = [
    "WebGLRenderer",
    "Scene",
    "PerspectiveCamera",
    "Group",
    "Mesh",
    "MeshStandardMaterial",
    "Raycaster",
    "Vector2",
    "Vector3"
  ];
  const missing = required.filter((name) => typeof THREE?.[name] !== "function");
  if (missing.length) {
    throw new TypeError(`Invalid Three.js module; missing: ${missing.join(", ")}`);
  }
}

function createButton(doc, label) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "knowledge-spatial-viewer__button";
  button.textContent = label;
  return button;
}

function createUniqueId(base, used) {
  let id = base || "item";
  let suffix = 2;
  while (used.has(id)) {
    id = `${base || "item"}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function normalizeIdentifier(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_.:-]/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128);
}

function normalizeReference(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, 256);
}

function normalizeText(value, fallback = "", maxLength = 400) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizeCssSize(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${clamp(value, 220, 1200)}px`;
  }
  const text = String(value || "").trim();
  return /^(?:\d+(?:\.\d+)?)(?:px|rem|em|vh|vw|%)$/.test(text) ? text : fallback;
}

function finiteNumber(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function degreesToRadians(value) {
  return finiteNumber(value, 0) * (Math.PI / 180);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function viewerStyles() {
  return `
    .knowledge-spatial-viewer {
      --ksv-ink: #25232a;
      --ksv-muted: #6f6b78;
      --ksv-surface: rgba(255, 255, 255, .86);
      position: relative;
      display: block;
      width: 100%;
      min-width: 0;
      color: var(--ksv-ink);
      font: 500 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      container-type: inline-size;
    }
    .knowledge-spatial-viewer__stage {
      position: relative;
      min-height: var(--ksv-min-height);
      overflow: hidden;
      border: 1px solid rgba(73, 69, 79, .16);
      border-radius: 22px;
      background:
        radial-gradient(circle at 24% 15%, rgba(103, 80, 164, .14), transparent 34%),
        radial-gradient(circle at 82% 78%, rgba(0, 106, 106, .11), transparent 36%),
        linear-gradient(145deg, #fbf9ff 0%, #f4f2f8 56%, #faf8fc 100%);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .8);
    }
    .knowledge-spatial-viewer__canvas,
    .knowledge-spatial-viewer__labels {
      position: absolute;
      inset: 0;
    }
    .knowledge-spatial-viewer__canvas canvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: grab;
      outline: none;
    }
    .knowledge-spatial-viewer__canvas canvas:active { cursor: grabbing; }
    .knowledge-spatial-viewer__labels {
      pointer-events: none;
      overflow: hidden;
    }
    .knowledge-spatial-viewer__label,
    .knowledge-spatial-viewer__projected {
      position: absolute;
      top: 0;
      left: 0;
      margin: 0;
      white-space: nowrap;
      will-change: transform;
    }
    .knowledge-spatial-viewer__label {
      pointer-events: auto;
      max-width: 148px;
      min-height: 40px;
      overflow: hidden;
      padding: 7px 11px;
      border: 1px solid rgba(73, 69, 79, .17);
      border-radius: 999px;
      background: rgba(255, 255, 255, .9);
      box-shadow: 0 5px 16px rgba(45, 41, 51, .12);
      color: #343139;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font: inherit;
      font-size: 12px;
      font-weight: 680;
      text-overflow: ellipsis;
      cursor: pointer;
      transition: opacity 160ms ease, border-color 160ms ease, background 160ms ease;
    }
    .knowledge-spatial-viewer__label:hover,
    .knowledge-spatial-viewer__label:focus-visible,
    .knowledge-spatial-viewer__label.is-active {
      border-color: #6750a4;
      background: #f1eaff;
      outline: none;
    }
    .knowledge-spatial-viewer__label.is-dimmed { opacity: .34; }
    .knowledge-spatial-viewer__edge-label {
      max-width: 110px;
      overflow: hidden;
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(245, 242, 249, .78);
      color: #716b79;
      font-size: 9px;
      text-overflow: ellipsis;
      transition: opacity 160ms ease;
    }
    .knowledge-spatial-viewer__edge-label.is-dimmed { opacity: .12; }
    .knowledge-spatial-viewer__toolbar {
      position: absolute;
      z-index: 500;
      top: 12px;
      left: 12px;
      right: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      pointer-events: none;
    }
    .knowledge-spatial-viewer__toolbar-group {
      display: flex;
      gap: 6px;
      min-width: 0;
    }
    .knowledge-spatial-viewer__button,
    .knowledge-spatial-viewer__count {
      border: 1px solid rgba(73, 69, 79, .14);
      background: var(--ksv-surface);
      box-shadow: 0 4px 14px rgba(45, 41, 51, .08);
      backdrop-filter: blur(12px);
    }
    .knowledge-spatial-viewer__button {
      pointer-events: auto;
      min-height: 40px;
      padding: 8px 12px;
      border-radius: 10px;
      color: #39353f;
      font: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .knowledge-spatial-viewer__button:hover,
    .knowledge-spatial-viewer__button:focus-visible {
      border-color: #6750a4;
      outline: none;
    }
    .knowledge-spatial-viewer__button:disabled {
      opacity: .58;
      cursor: default;
    }
    .knowledge-spatial-viewer__count {
      max-width: 46%;
      overflow: hidden;
      padding: 6px 9px;
      border-radius: 10px;
      color: var(--ksv-muted);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .knowledge-spatial-viewer__details {
      position: absolute;
      z-index: 500;
      right: 12px;
      bottom: 12px;
      left: 12px;
      display: grid;
      gap: 2px;
      max-width: min(480px, calc(100% - 24px));
      padding: 10px 12px;
      border: 1px solid rgba(73, 69, 79, .13);
      border-radius: 14px;
      background: var(--ksv-surface);
      box-shadow: 0 8px 24px rgba(45, 41, 51, .1);
      backdrop-filter: blur(14px);
      pointer-events: none;
    }
    .knowledge-spatial-viewer__details strong {
      overflow: hidden;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .knowledge-spatial-viewer__details span {
      display: -webkit-box;
      overflow: hidden;
      color: var(--ksv-muted);
      font-size: 12px;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .knowledge-spatial-viewer[data-state="unsupported"] .knowledge-spatial-viewer__toolbar {
      display: none;
    }
    @container (max-width: 460px) {
      .knowledge-spatial-viewer__stage { border-radius: 16px; }
      .knowledge-spatial-viewer__toolbar { top: 8px; right: 8px; left: 8px; }
      .knowledge-spatial-viewer__button { min-height: 40px; padding: 7px 9px; }
      .knowledge-spatial-viewer__count { display: none; }
      .knowledge-spatial-viewer__details { right: 8px; bottom: 8px; left: 8px; }
      .knowledge-spatial-viewer__label {
        max-width: 120px;
        min-height: 40px;
        padding: 6px 9px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .knowledge-spatial-viewer *,
      .knowledge-spatial-viewer *::before,
      .knowledge-spatial-viewer *::after {
        scroll-behavior: auto !important;
        transition-duration: .001ms !important;
        animation-duration: .001ms !important;
        animation-iteration-count: 1 !important;
      }
    }
  `;
}
