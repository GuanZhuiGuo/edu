import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const moduleDir = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_CATALOG_PATH = join(
  moduleDir,
  "public",
  "data",
  "junior-math-visual-artifacts.json",
);

/**
 * Resolves current local knowledge artifacts after retrieval has established
 * canonical knowledge IDs. One artifact already contains both the mind-map
 * and deterministic interactive view, so the public ref remains its existing
 * artifact_id rather than a model-authored renderer or URL.
 */
export function createLocalKnowledgeArtifactResolver({
  catalogPath = DEFAULT_CATALOG_PATH,
  readFileImpl = readFile,
} = {}) {
  let catalogPromise = null;

  async function load() {
    if (!catalogPromise) {
      catalogPromise = readFileImpl(catalogPath, "utf8")
        .then((source) => JSON.parse(source))
        .then((catalog) => {
          if (
            catalog?.schema_version !== "junior-math-visual-artifacts@1.0"
            || !Array.isArray(catalog.artifacts)
          ) {
            throw new TypeError("本地知识卡片协议不兼容");
          }
          return new Map(catalog.artifacts
            .filter((item) => item?.artifact_id && item?.knowledge_point_id)
            .map((item) => [String(item.knowledge_point_id), Object.freeze({
              ref: String(item.artifact_id),
              type: "interactive_visual",
              knowledge_point_id: String(item.knowledge_point_id),
              parameterization: item.interactive?.parameterization || null,
            })]));
        })
        .catch((error) => {
          catalogPromise = null;
          throw error;
        });
    }
    return catalogPromise;
  }

  return async function resolveLocalKnowledgeArtifacts({ candidates = [] } = {}) {
    const byKnowledgePointId = await load();
    return candidates
      .map((candidate) => byKnowledgePointId.get(String(candidate?.knowledge_point_id || "")))
      .filter(Boolean);
  };
}
