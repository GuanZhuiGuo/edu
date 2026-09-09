/**
 * Source-first adapter for cclank/cell-architecture-studio.
 *
 * This module ports the upstream specimen/organelle data model and the
 * deterministic procedural placements used by CellScene.tsx. It does not call
 * an LLM and it deliberately rejects non-cell topics: the upstream project is
 * a curated cell gallery, not a generic text-to-3D engine.
 *
 * Upstream: https://github.com/cclank/cell-architecture-studio
 * Revision: 1cab982e7a0f96af854a696430c0724707764358
 * License: MIT
 */

const SOURCE_TEXT_MAX_LENGTH = 20_000;
const SOURCE_CLAIM_LIMIT = 12;
const SUPPORTED_SOURCE_FIELDS = new Set([
  "source_text",
  "source_id",
  "title",
  "subject",
  "grade_band",
  "language"
]);

export const CELL_STUDIO_SOURCE_PROVENANCE = deepFreeze({
  upstream_repo: "https://github.com/cclank/cell-architecture-studio",
  source_revision: "1cab982e7a0f96af854a696430c0724707764358",
  license: "MIT",
  integration: "source-port",
  source_files: [
    "src/data/cells.ts",
    "src/components/CellScene.tsx",
    "src/components/Stage.tsx",
    "LICENSE"
  ],
  reused_capabilities: [
    "CellItem and OrganelleItem specimen model",
    "seven supported model kinds",
    "procedural primitive placements and dimensions",
    "deterministic Dots distribution",
    "mesh/focus spatial exploration semantics",
    "camera distance and field-of-view defaults"
  ],
  excluded_assets: [
    "GLB models",
    "cell render images",
    "NIH preview images"
  ]
});

export class CellStudioSourceAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CellStudioSourceAdapterError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

/**
 * Exact port of the deterministic point distribution in upstream
 * CellScene.tsx::Dots. Kept public so the renderer can expand aggregate
 * organelles without model inference if it later adopts instanced meshes.
 */
export function createCellStudioDotPositions(count, spread) {
  if (!Number.isInteger(count) || count < 0 || count > 256) {
    throw new CellStudioSourceAdapterError(
      "CELL_STUDIO_INVALID_INPUT",
      "count must be an integer between 0 and 256",
      { path: "count" }
    );
  }
  const normalizedSpread = tuple3(spread, "spread", { min: 0, max: 100 });
  return Array.from({ length: count }, (_, index) => {
    const a = index * 1.71;
    const b = index * 2.37;
    return [
      Math.sin(a) * normalizedSpread[0],
      Math.cos(b) * normalizedSpread[1],
      Math.sin(a + b) * normalizedSpread[2]
    ];
  });
}

/**
 * Returns a diagnostic rather than guessing. A tied specimen score is
 * intentionally unsupported because, for example, "cell wall" alone cannot
 * distinguish a plant cell from a bacterium.
 */
export function inspectCellStudioSupport(source) {
  let normalized;
  try {
    normalized = normalizeSource(source);
  } catch (error) {
    return {
      supported: false,
      reason: "invalid_source",
      specimen_id: null,
      candidates: [],
      matched_terms: [],
      error_code:
        error instanceof CellStudioSourceAdapterError
          ? error.code
          : "CELL_STUDIO_INVALID_INPUT"
    };
  }

  const text = canonicalText(
    [normalized.title, normalized.subject, normalized.source_text]
      .filter(Boolean)
      .join("\n")
  );
  const candidates = CELL_SPECIMENS.map((specimen) => scoreSpecimen(specimen, text))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.direct_matches - left.direct_matches ||
        left.specimen_id.localeCompare(right.specimen_id)
    );

  if (!candidates.length) {
    return {
      supported: false,
      reason: "no_supported_cell_terms",
      specimen_id: null,
      candidates: [],
      matched_terms: []
    };
  }

  const best = candidates[0];
  const tied = candidates.filter(
    (candidate) =>
      candidate.score === best.score &&
      candidate.direct_matches === best.direct_matches
  );
  if (tied.length > 1) {
    return {
      supported: false,
      reason: "ambiguous_cell_specimen",
      specimen_id: null,
      candidates: tied.map(toPublicCandidate),
      matched_terms: unique(tied.flatMap((candidate) => candidate.matched_terms))
    };
  }

  return {
    supported: true,
    reason: "supported",
    specimen_id: best.specimen_id,
    confidence:
      best.direct_matches > 0 ? "direct" : best.score >= 6 ? "strong" : "inferred",
    candidates: candidates.slice(0, 3).map(toPublicCandidate),
    matched_terms: [...best.matched_terms]
  };
}

export function canCreateCellStudioMaterial(source) {
  return inspectCellStudioSupport(source).supported;
}

/**
 * Produces source excerpts with stable IDs. The main pipeline may publish these
 * as its grounded claims and pass their IDs to validateCellStudioOutput.
 */
export function extractCellStudioSourceClaims(source) {
  const normalized = normalizeSource(source);
  const sentences = splitSourceSentences(normalized.source_text);
  return sentences.slice(0, SOURCE_CLAIM_LIMIT).map((text, index) => ({
    id: `source_${String(index + 1).padStart(2, "0")}`,
    text,
    source_support: text
  }));
}

/**
 * Convert one standard source object to the existing `{ spatial_scene }`
 * technique contract. No prompt, model client, network call, random value, or
 * upstream binary asset is used.
 */
export function createCellStudioMaterial(source) {
  const normalized = normalizeSource(source);
  const support = inspectCellStudioSupport(normalized);
  if (!support.supported) {
    throw new CellStudioSourceAdapterError(
      "CELL_STUDIO_UNSUPPORTED_SOURCE",
      support.reason === "ambiguous_cell_specimen"
        ? "The source matches multiple Cell Architecture Studio specimens"
        : "The source does not match a specimen supported by Cell Architecture Studio",
      {
        reason: support.reason,
        candidates: support.candidates,
        matched_terms: support.matched_terms
      }
    );
  }

  const specimen = CELL_SPECIMEN_BY_ID.get(support.specimen_id);
  const claims = extractCellStudioSourceClaims(normalized);
  const language = normalized.language?.toLowerCase().startsWith("en")
    ? "en"
    : "zh";
  const sentenceEvidence = indexSentenceEvidence(claims, specimen);
  const rootId = `${specimen.id}.specimen`;
  const rootPosition = vectorObject(specimen.geometry.position);
  const nodes = [
    {
      id: rootId,
      label: localized(specimen.name, language),
      kind: "structure",
      description: evidenceDescription(
        sentenceEvidence.root,
        localized(specimen.summary, language)
      ),
      geometry: geometryObject(specimen.geometry),
      claim_ids: [sentenceEvidence.root.id]
    },
    ...specimen.organelles.map((organelle) => {
      const evidence =
        sentenceEvidence.organelles.get(organelle.id) || sentenceEvidence.root;
      return {
        id: `${specimen.id}.${organelle.id}`,
        label: localized(organelle.name, language),
        kind: organelle.kind,
        description: evidenceDescription(
          evidence,
          localized(organelle.summary, language)
        ),
        geometry: geometryObject(organelle.geometry),
        claim_ids: [evidence.id]
      };
    })
  ];

  const edges = specimen.organelles.map((organelle, index) => {
    const target = vectorObject(organelle.geometry.position);
    return {
      id: `${specimen.id}.contains.${organelle.id}`,
      from: rootId,
      to: `${specimen.id}.${organelle.id}`,
      relation: language === "en" ? "contains" : "包含",
      geometry: {
        path: createConnectionPath(rootPosition, target, index)
      }
    };
  });

  const envelopeNodeIds = [
    rootId,
    ...specimen.organelles
      .filter((organelle) => organelle.layer === "envelope")
      .map((organelle) => `${specimen.id}.${organelle.id}`)
  ];
  const internalNodeIds = specimen.organelles
    .filter((organelle) => organelle.layer !== "envelope")
    .map((organelle) => `${specimen.id}.${organelle.id}`);
  const layers = [
    {
      id: `${specimen.id}.envelope`,
      label: language === "en" ? "Specimen outline" : "标本外形",
      node_ids: envelopeNodeIds,
      default_visible: true
    }
  ];
  if (internalNodeIds.length) {
    layers.push({
      id: `${specimen.id}.structures`,
      label: language === "en" ? "Internal structures" : "内部结构",
      node_ids: internalNodeIds,
      default_visible: true
    });
  }

  const requestedTitle = normalized.title
    ? clampText(normalized.title, 112)
    : localized(specimen.name, language);
  return {
    spatial_scene: {
      id: `cell_studio.${specimen.id}`,
      title:
        language === "en"
          ? `${requestedTitle} · 3D structure explorer`
          : `${requestedTitle} · 三维结构探索`,
      description:
        language === "en"
          ? `A deterministic mesh/focus scene generated from the ${localized(
              specimen.name,
              language
            )} source model.`
          : `基于 ${localized(
              specimen.name,
              language
            )} 源码数据模型生成的确定性网格与聚焦探索场景。`,
      coordinate_system: "cartesian-3d",
      camera: {
        position: { x: 0, y: 0.2, z: 5.8 },
        target: { x: 0, y: 0, z: 0 },
        fov: 38
      },
      bounds: {
        min: { x: -6, y: -4, z: -4 },
        max: { x: 6, y: 4, z: 4 },
        unit: "studio"
      },
      nodes,
      edges,
      layers
    }
  };
}

const CELL_SPECIMENS = deepFreeze([
  {
    id: "plant",
    name: { zh: "植物细胞", en: "Plant Cell" },
    summary: {
      zh: "具有细胞壁、叶绿体、大液泡与细胞核的植物细胞标本。",
      en: "A plant-cell specimen with a cell wall, chloroplasts, a vacuole and a nucleus."
    },
    direct_aliases: ["植物细胞", "plant cell"],
    context_aliases: ["植物组织", "叶片细胞", "plant tissue"],
    geometry: {
      shape: "box",
      position: [0, 0, 0],
      size: [4.7, 2.7, 0.42],
      rotation: [5.73, -16.04, 0]
    },
    organelles: [
      organelle(
        "nucleus",
        "细胞核",
        "Nucleus",
        ["细胞核", "nucleus", "nuclear"],
        "细胞核是源码标本的控制中心结构。",
        "The nucleus is the source specimen's control-center structure.",
        "concept",
        "sphere",
        [0.92, 0.42, 0.45],
        [1.04, 1.04, 0.76]
      ),
      organelle(
        "chloroplast",
        "叶绿体",
        "Chloroplast",
        ["叶绿体", "chloroplast", "chlorophyll"],
        "叶绿体是源码标本中的光能转换结构。",
        "The chloroplast is the light-harvesting structure in the source specimen.",
        "process",
        "sphere",
        [-1.65, 0.48, 0.28],
        [0.7, 0.36, 0.24]
      ),
      organelle(
        "vacuole",
        "液泡",
        "Vacuole",
        ["液泡", "中央液泡", "vacuole"],
        "中央液泡是源码标本中的水分与溶质储存空间。",
        "The central vacuole is the source specimen's water-and-solute reservoir.",
        "structure",
        "sphere",
        [-0.45, -0.12, 0.32],
        [1.64, 1.22, 0.44]
      ),
      organelle(
        "cellWall",
        "细胞壁",
        "Cell Wall",
        ["细胞壁", "cell wall", "cellulose"],
        "细胞壁构成源码标本的刚性外框。",
        "The cell wall forms the rigid frame of the source specimen.",
        "structure",
        "box",
        [0, 0, -0.18],
        [4.18, 2.24, 0.24],
        [0, 0, 0],
        "envelope"
      )
    ]
  },
  {
    id: "whiteBlood",
    name: { zh: "白细胞", en: "White Blood Cell" },
    summary: {
      zh: "具有分叶细胞核、溶酶体与颗粒的免疫细胞标本。",
      en: "An immune-cell specimen with a lobed nucleus, lysosomes and granules."
    },
    direct_aliases: ["白细胞", "白血球", "white blood cell", "leukocyte"],
    context_aliases: ["免疫细胞", "immune cell", "blood smear"],
    geometry: {
      shape: "sphere",
      position: [0, 0, 0],
      size: [3.24, 3.24, 3.24]
    },
    organelles: [
      organelle(
        "lysosome",
        "溶酶体",
        "Lysosome",
        ["溶酶体", "lysosome"],
        "溶酶体是源码标本中的消化与回收囊泡。",
        "Lysosomes are digestive and recycling vesicles in the source specimen.",
        "process",
        "sphere",
        representativeDot(7, [0.92, 0.88, 0.62], 1.2),
        [0.22, 0.22, 0.22]
      ),
      organelle(
        "nucleus",
        "分叶细胞核",
        "Lobed Nucleus",
        ["分叶核", "细胞核", "lobed nucleus", "nucleus"],
        "分叶细胞核沿用源码中的三叶程序几何布局。",
        "The lobed nucleus follows the source's three-lobe procedural layout.",
        "structure",
        "sphere",
        [-0.504, 0.264, 0.408],
        [1.0, 0.86, 0.67]
      ),
      organelle(
        "granules",
        "颗粒",
        "Granules",
        ["颗粒", "granule", "granules"],
        "颗粒按源码的确定性点阵分布呈现。",
        "Granules follow the source's deterministic dot distribution.",
        "annotation",
        "sphere",
        representativeDot(3, [1.05, 1.02, 0.72], 1.2),
        [0.2, 0.2, 0.2]
      )
    ]
  },
  {
    id: "neuron",
    name: { zh: "神经元", en: "Neuron" },
    summary: {
      zh: "由胞体、轴突和树突组成的神经细胞标本。",
      en: "A nerve-cell specimen composed of a soma, axon and dendrites."
    },
    direct_aliases: ["神经元", "神经细胞", "neuron", "nerve cell"],
    context_aliases: ["神经冲动", "突触", "nerve impulse", "synapse"],
    geometry: {
      shape: "custom",
      position: [0, 0, 0],
      size: [4.8, 3.2, 1.4],
      rotation: [1.15, -11.46, 0]
    },
    organelles: [
      organelle(
        "axon",
        "轴突",
        "Axon",
        ["轴突", "axon", "myelin"],
        "轴突沿用源码中由胞体向外延伸的管状路径。",
        "The axon follows the source's tube path extending away from the soma.",
        "process",
        "cylinder",
        [1.2, 0, 0.02],
        [0.16, 2.32, 0.16],
        [0, 0, 90]
      ),
      organelle(
        "soma",
        "胞体",
        "Soma",
        ["胞体", "细胞体", "soma", "cell body"],
        "胞体是源码神经元模型的代谢与整合中心。",
        "The soma is the source neuron's metabolic and integration center.",
        "structure",
        "sphere",
        [-0.55, 0, 0.08],
        [1.28, 1.16, 0.88]
      ),
      organelle(
        "dendrites",
        "树突",
        "Dendrites",
        ["树突", "dendrite", "dendrites"],
        "树突使用源码中的分支曲线路径组织。",
        "Dendrites use the branching curve paths defined by the source.",
        "process",
        "custom",
        [-1.55, 0.82, 0.08],
        [1.3, 1.1, 0.24]
      )
    ]
  },
  {
    id: "epithelial",
    name: { zh: "上皮细胞", en: "Epithelial Cell" },
    summary: {
      zh: "具有微绒毛、紧密连接与细胞核的柱状上皮细胞标本。",
      en: "A columnar epithelial specimen with microvilli, tight junctions and a nucleus."
    },
    direct_aliases: ["上皮细胞", "上皮组织", "epithelial cell", "epithelium"],
    context_aliases: ["吸收表面", "屏障组织", "absorption surface", "barrier tissue"],
    geometry: {
      shape: "cylinder",
      position: [0, 0, 0],
      size: [1.69, 2.81, 1.69],
      rotation: [4.58, -12.61, 0]
    },
    organelles: [
      organelle(
        "microvilli",
        "微绒毛",
        "Microvilli",
        ["微绒毛", "microvilli", "brush border"],
        "微绒毛按源码的六乘六交错网格程序化排布。",
        "Microvilli follow the source's staggered six-by-six procedural grid.",
        "process",
        "cylinder",
        [0, 1.55, 0],
        [1.4, 0.44, 1.4]
      ),
      organelle(
        "junctions",
        "紧密连接",
        "Tight Junctions",
        ["紧密连接", "细胞连接", "tight junction", "junctions"],
        "紧密连接沿用源码中连接相邻细胞的曲线路径。",
        "Tight junctions follow the source curves linking neighboring cells.",
        "process",
        "custom",
        [-0.89, 1.08, 0],
        [0.5, 0.2, 0.8]
      ),
      organelle(
        "nucleus",
        "细胞核",
        "Nucleus",
        ["细胞核", "nucleus"],
        "细胞核位于源码柱状细胞的基底侧。",
        "The nucleus sits toward the basal side of the source columnar cell.",
        "structure",
        "sphere",
        [0, -0.59, 0],
        [0.99, 0.78, 0.99]
      )
    ]
  },
  {
    id: "bacteria",
    name: { zh: "细菌细胞", en: "Bacteria Cell" },
    summary: {
      zh: "具有细胞壁、拟核与鞭毛的原核细胞标本。",
      en: "A prokaryotic specimen with a cell wall, nucleoid and flagellum."
    },
    direct_aliases: ["细菌细胞", "细菌", "原核细胞", "bacteria", "bacterial cell"],
    context_aliases: ["原核生物", "革兰氏", "prokaryote", "gram stain"],
    geometry: {
      shape: "cylinder",
      position: [0, 0, 0],
      size: [1.75, 4.55, 1.75],
      rotation: [1.15, 5.73, 90]
    },
    organelles: [
      organelle(
        "nucleoid",
        "拟核",
        "Nucleoid",
        ["拟核", "核区", "nucleoid"],
        "拟核沿用源码中穿过细胞内部的弯曲管状路径。",
        "The nucleoid follows the source's curved tube path through the cell interior.",
        "structure",
        "custom",
        [0.1, 0.02, 0.35],
        [2.1, 0.5, 0.4]
      ),
      organelle(
        "cellWall",
        "细胞壁",
        "Cell Wall",
        ["细胞壁", "肽聚糖", "cell wall", "peptidoglycan"],
        "细胞壁构成源码细菌标本的保护外壳。",
        "The cell wall forms the protective shell of the source bacteria specimen.",
        "structure",
        "cylinder",
        [0, 0, 0],
        [1.56, 4.2, 1.56],
        [0, 0, 90],
        "envelope"
      ),
      organelle(
        "flagellum",
        "鞭毛",
        "Flagellum",
        ["鞭毛", "flagellum", "flagella"],
        "鞭毛沿用源码中从细胞末端伸出的弯曲运动路径。",
        "The flagellum follows the source's curved motility path from the cell end.",
        "process",
        "custom",
        [2.65, -0.6, 0.03],
        [2.0, 0.8, 0.16]
      )
    ]
  },
  {
    id: "animal",
    name: { zh: "动物细胞", en: "Animal Cell" },
    summary: {
      zh: "具有线粒体、细胞核和高尔基体的真核细胞标本。",
      en: "A eukaryotic specimen with mitochondria, a nucleus and a Golgi apparatus."
    },
    direct_aliases: ["动物细胞", "animal cell"],
    context_aliases: ["动物组织", "animal tissue"],
    geometry: {
      shape: "sphere",
      position: [0, 0, 0],
      size: [3.67, 2.7, 1.56],
      rotation: [3.44, -19.48, 0]
    },
    organelles: [
      organelle(
        "mitochondrion",
        "线粒体",
        "Mitochondrion",
        ["线粒体", "mitochondrion", "mitochondria"],
        "线粒体沿用源码中的胶囊外形与内部环形褶皱。",
        "The mitochondrion follows the source capsule and inner-ring construction.",
        "process",
        "cylinder",
        [-0.82, 0.44, 0.32],
        [0.32, 0.62, 0.32],
        [22.92, 5.73, 64.17]
      ),
      organelle(
        "nucleus",
        "细胞核",
        "Nucleus",
        ["细胞核", "nucleus"],
        "细胞核沿用源码中偏离中心的球状布局。",
        "The nucleus follows the source's off-center spherical placement.",
        "structure",
        "sphere",
        [0.22, 0.18, 0.36],
        [1.1, 1.1, 0.84]
      ),
      organelle(
        "golgi",
        "高尔基体",
        "Golgi Apparatus",
        ["高尔基体", "高尔基器", "golgi", "golgi apparatus"],
        "高尔基体沿用源码的四层环状堆叠布局。",
        "The Golgi apparatus follows the source's four-ring stacked layout.",
        "structure",
        "custom",
        [0.03, -0.44, 0.46],
        [1.0, 0.8, 0.28]
      )
    ]
  },
  {
    id: "muscle",
    name: { zh: "肌细胞", en: "Muscle Cell" },
    summary: {
      zh: "具有肌原纤维、肌膜与线粒体的肌纤维标本。",
      en: "A muscle-fiber specimen with myofibrils, sarcolemma and mitochondria."
    },
    direct_aliases: ["肌细胞", "肌肉细胞", "肌纤维", "muscle cell", "muscle fiber"],
    context_aliases: ["肌节", "骨骼肌", "sarcomere", "skeletal muscle"],
    geometry: {
      shape: "cylinder",
      position: [0, 0, 0],
      size: [1.4, 4.4, 1.4],
      rotation: [6.88, -10.31, 90]
    },
    organelles: [
      organelle(
        "myofibril",
        "肌原纤维",
        "Myofibril",
        ["肌原纤维", "肌节", "myofibril", "sarcomere"],
        "肌原纤维使用源码的七束布局与固定肌节间距。",
        "Myofibrils use the source's seven-bundle layout and fixed sarcomere spacing.",
        "process",
        "cylinder",
        [0, 0.36, 0],
        [0.26, 4.32, 0.26],
        [0, 0, 90]
      ),
      organelle(
        "sarcolemma",
        "肌膜",
        "Sarcolemma",
        ["肌膜", "sarcolemma"],
        "肌膜沿用源码中的透明胶囊状外层。",
        "The sarcolemma follows the source's translucent capsule-like outer layer.",
        "structure",
        "cylinder",
        [0, 0, 0],
        [1.36, 4.2, 1.36],
        [0, 0, 90],
        "envelope"
      ),
      organelle(
        "mitochondria",
        "线粒体",
        "Mitochondria",
        ["线粒体", "mitochondria", "mitochondrion"],
        "线粒体沿用源码中分布于肌原纤维之间的四点布局。",
        "Mitochondria follow the source's four placements between myofibrils.",
        "process",
        "cylinder",
        [-1.8, -0.5, 0.2],
        [0.18, 0.32, 0.18],
        [0, 0, 90]
      )
    ]
  }
]);

const CELL_SPECIMEN_BY_ID = new Map(
  CELL_SPECIMENS.map((specimen) => [specimen.id, specimen])
);

function organelle(
  id,
  zhName,
  enName,
  aliases,
  zhSummary,
  enSummary,
  kind,
  shape,
  position,
  size,
  rotation = [0, 0, 0],
  layer = "structures"
) {
  return {
    id,
    name: { zh: zhName, en: enName },
    aliases,
    summary: { zh: zhSummary, en: enSummary },
    kind,
    layer,
    geometry: { shape, position, size, rotation }
  };
}

function representativeDot(index, spread, groupScale = 1) {
  return createCellStudioDotPositions(index + 1, spread)[index].map(
    (value) => Number((value * groupScale).toFixed(4))
  );
}

function scoreSpecimen(specimen, text) {
  const directTerms = matchingTerms(text, specimen.direct_aliases);
  const contextTerms = matchingTerms(text, specimen.context_aliases);
  const organelleTerms = specimen.organelles.flatMap((organelle) =>
    matchingTerms(text, organelle.aliases)
  );
  return {
    specimen_id: specimen.id,
    score:
      directTerms.length * 12 +
      contextTerms.length * 5 +
      unique(organelleTerms).length * 3,
    direct_matches: directTerms.length,
    matched_terms: unique([...directTerms, ...contextTerms, ...organelleTerms])
  };
}

function matchingTerms(text, aliases) {
  return aliases.filter((alias) => text.includes(canonicalText(alias)));
}

function toPublicCandidate(candidate) {
  return {
    specimen_id: candidate.specimen_id,
    score: candidate.score,
    matched_terms: [...candidate.matched_terms]
  };
}

function indexSentenceEvidence(claims, specimen) {
  const root =
    findEvidence(claims, [
      ...specimen.direct_aliases,
      ...specimen.context_aliases
    ]) || claims[0];
  return {
    root,
    organelles: new Map(
      specimen.organelles.map((organelle) => [
        organelle.id,
        findEvidence(claims, organelle.aliases)
      ])
    )
  };
}

function findEvidence(claims, aliases) {
  return claims.find((claim) => {
    const text = canonicalText(claim.text);
    return aliases.some((alias) => text.includes(canonicalText(alias)));
  });
}

function evidenceDescription(evidence, fallback) {
  const excerpt = clampText(evidence?.text || "", 300);
  const supplement = clampText(fallback, 180);
  if (!excerpt) return supplement;
  if (canonicalText(excerpt).includes(canonicalText(supplement))) return excerpt;
  return clampText(`${excerpt} ${supplement}`, 500);
}

function createConnectionPath(from, to, index) {
  const midpoint = {
    x: Number(((from.x + to.x) / 2).toFixed(4)),
    y: Number((((from.y + to.y) / 2) + 0.22 + (index % 3) * 0.09).toFixed(4)),
    z: Number((((from.z + to.z) / 2) + (index % 2 === 0 ? 0.12 : -0.12)).toFixed(4))
  };
  return [structuredClone(from), midpoint, structuredClone(to)];
}

function geometryObject(geometry) {
  const value = {
    shape: geometry.shape,
    position: vectorObject(geometry.position),
    size: vectorObject(geometry.size)
  };
  if (geometry.rotation?.some((number) => number !== 0)) {
    value.rotation = vectorObject(geometry.rotation);
  }
  return value;
}

function vectorObject(tuple) {
  return { x: tuple[0], y: tuple[1], z: tuple[2] };
}

function normalizeSource(source) {
  if (!isPlainObject(source)) {
    throw new CellStudioSourceAdapterError(
      "CELL_STUDIO_INVALID_INPUT",
      "Cell Studio source must be an object"
    );
  }
  for (const key of Object.keys(source)) {
    if (!SUPPORTED_SOURCE_FIELDS.has(key)) {
      throw new CellStudioSourceAdapterError(
        "CELL_STUDIO_INVALID_INPUT",
        `Unsupported source field: ${key}`,
        { path: key }
      );
    }
  }
  const sourceText =
    typeof source.source_text === "string" ? source.source_text.trim() : "";
  if (sourceText.length < 20 || sourceText.length > SOURCE_TEXT_MAX_LENGTH) {
    throw new CellStudioSourceAdapterError(
      "CELL_STUDIO_INVALID_INPUT",
      `source_text must contain 20-${SOURCE_TEXT_MAX_LENGTH} characters`,
      { path: "source_text" }
    );
  }
  const normalized = { source_text: sourceText };
  for (const [key, limit] of [
    ["source_id", 96],
    ["title", 160],
    ["subject", 80],
    ["grade_band", 80],
    ["language", 40]
  ]) {
    if (source[key] === undefined) continue;
    if (
      typeof source[key] !== "string" ||
      !source[key].trim() ||
      source[key].trim().length > limit
    ) {
      throw new CellStudioSourceAdapterError(
        "CELL_STUDIO_INVALID_INPUT",
        `${key} must be a non-empty string no longer than ${limit} characters`,
        { path: key }
      );
    }
    normalized[key] = source[key].trim();
  }
  if (
    normalized.source_id &&
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(normalized.source_id)
  ) {
    throw new CellStudioSourceAdapterError(
      "CELL_STUDIO_INVALID_INPUT",
      "source_id contains unsupported characters",
      { path: "source_id" }
    );
  }
  return normalized;
}

function splitSourceSentences(sourceText) {
  const paragraphs = sourceText
    .split(/\r?\n+/u)
    .flatMap((paragraph) => paragraph.split(/(?<=[。！？!?；;.!])\s*/u))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (!paragraphs.length) return [sourceText];
  if (paragraphs.length <= SOURCE_CLAIM_LIMIT) return paragraphs;
  const head = paragraphs.slice(0, SOURCE_CLAIM_LIMIT - 1);
  head.push(paragraphs.slice(SOURCE_CLAIM_LIMIT - 1).join(" "));
  return head;
}

function localized(value, language) {
  return value?.[language] || value?.zh || value?.en || "";
}

function canonicalText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function clampText(value, limit) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function tuple3(value, path, { min, max }) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some(
      (item) => !Number.isFinite(item) || item < min || item > max
    )
  ) {
    throw new CellStudioSourceAdapterError(
      "CELL_STUDIO_INVALID_INPUT",
      `${path} must be a three-number tuple within ${min}-${max}`,
      { path }
    );
  }
  return [...value];
}

function unique(items) {
  return [...new Set(items)];
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
