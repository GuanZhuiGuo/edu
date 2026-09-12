import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILENAME = fileURLToPath(new URL("./data/education-runtime/courseware-library.json", import.meta.url));
const SCHEMA_VERSION = "courseware-library@1.0";
const MAX_ITEM_BYTES = 4 * 1024 * 1024;
const SUPPORTED_TYPES = new Set([
  "function_graph", "physics_lab", "projectile_lab", "acid_base_lab",
  "mindmap", "concept_cards", "video", "geometry", "visual",
]);

export class CoursewareLibraryRepositoryError extends Error {
  constructor(code, message, { status = 500, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CoursewareLibraryRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export function createCoursewareLibraryRepository({
  filename = DEFAULT_FILENAME,
  now = () => new Date().toISOString(),
  createId = () => `courseware:${randomUUID()}`,
} = {}) {
  let mutation = Promise.resolve();

  async function readState() {
    try {
      const parsed = JSON.parse(await readFile(filename, "utf8"));
      if (parsed?.schema_version !== SCHEMA_VERSION || !Array.isArray(parsed.items)) {
        throw new CoursewareLibraryRepositoryError("courseware_library_corrupt", "课件库数据格式无效。");
      }
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") return { schema_version: SCHEMA_VERSION, items: [] };
      if (error instanceof CoursewareLibraryRepositoryError) throw error;
      throw new CoursewareLibraryRepositoryError("courseware_library_read_failed", "读取持久化课件库失败。", { cause: error });
    }
  }

  async function writeState(state) {
    await mkdir(dirname(filename), { recursive: true });
    const temporary = join(dirname(filename), `.${filename.split("/").pop()}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, filename);
    } catch (error) {
      throw new CoursewareLibraryRepositoryError("courseware_library_write_failed", "写入持久化课件库失败。", { cause: error });
    }
  }

  function serialize(operation) {
    const pending = mutation.then(operation, operation);
    mutation = pending.catch(() => undefined);
    return pending;
  }

  return Object.freeze({
    async list() {
      await mutation;
      const state = await readState();
      return structuredClone(state.items).sort((left, right) =>
        String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
    },
    async save(input) {
      return serialize(async () => {
        const state = await readState();
        const item = normalizePersistentCourseware(input, { now, createId });
        const index = state.items.findIndex((entry) => entry.id === item.id);
        if (index >= 0) state.items[index] = item;
        else state.items.unshift(item);
        await writeState(state);
        return structuredClone(item);
      });
    },
    async delete(id) {
      return serialize(async () => {
        const normalizedId = normalizeId(id);
        const state = await readState();
        const next = state.items.filter((entry) => entry.id !== normalizedId);
        if (next.length === state.items.length) return false;
        await writeState({ ...state, items: next });
        return true;
      });
    },
    filename,
  });
}

function normalizePersistentCourseware(input, { now, createId }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CoursewareLibraryRepositoryError("courseware_invalid", "缺少有效的课件内容。", { status: 400 });
  }
  const title = String(input.title || "").trim();
  if (!title || title.length > 160) {
    throw new CoursewareLibraryRepositoryError("courseware_title_invalid", "课件名称需为 1 到 160 个字符。", { status: 400 });
  }
  if (!SUPPORTED_TYPES.has(input.type)) {
    throw new CoursewareLibraryRepositoryError("courseware_type_invalid", "不支持此课件类型。", { status: 400 });
  }
  if (!input.lesson && !input.visualArtifact && !String(input.html || "").trim() && !String(input.videoUrl || "").trim()) {
    throw new CoursewareLibraryRepositoryError("courseware_content_missing", "课件没有可持久化的内容。", { status: 400 });
  }
  let copy;
  try {
    copy = structuredClone(input);
    if (Buffer.byteLength(JSON.stringify(copy), "utf8") > MAX_ITEM_BYTES) throw new Error("item too large");
  } catch (error) {
    throw new CoursewareLibraryRepositoryError("courseware_content_invalid", "课件内容无法持久化或超过 4 MB。", { status: 413, cause: error });
  }
  const timestamp = now();
  const id = copy.id ? normalizeId(copy.id) : createId();
  const createdAt = Number.isFinite(Date.parse(copy.createdAt)) ? copy.createdAt : timestamp;
  return {
    ...copy,
    id,
    title,
    description: String(copy.description || ""),
    subject: String(copy.subject || copy.lesson?.subject || "综合"),
    technology: String(copy.technology || "原生 DOM"),
    tags: [...new Set((Array.isArray(copy.tags) ? copy.tags : []).filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))],
    interactive: copy.interactive === true,
    source: "saved",
    createdAt,
    updatedAt: timestamp,
  };
}

function normalizeId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/u.test(id) || id.startsWith("builtin:")) {
    throw new CoursewareLibraryRepositoryError("courseware_id_invalid", "课件 ID 无效。", { status: 400 });
  }
  return id;
}
