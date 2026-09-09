import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PUBLIC_PATH = join(
  moduleDir,
  "public",
  "data",
  "junior-math-question-bank.json"
);
const DEFAULT_PRIVATE_PATH = join(
  moduleDir,
  "data",
  "junior-math-question-bank-private.json"
);
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 500;

export class QuestionBankRepositoryError extends Error {
  constructor(message, { code = "question_bank_repository_error", status = 500 } = {}) {
    super(message);
    this.name = "QuestionBankRepositoryError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Read-only, versioned question repository. Public question content and private
 * answer/solution data are loaded from different files and are never merged by
 * list/getPublicItem calls.
 */
export function createQuestionBankRepository({
  publicPath = DEFAULT_PUBLIC_PATH,
  privatePath = DEFAULT_PRIVATE_PATH,
  readFileImpl = readFile
} = {}) {
  let snapshotPromise = null;

  async function loadSnapshot() {
    if (!snapshotPromise) {
      snapshotPromise = Promise.all([
        readJson(readFileImpl, publicPath, "question_bank_public_invalid"),
        readJson(readFileImpl, privatePath, "question_bank_private_invalid")
      ])
        .then(([publicCatalog, privateCatalog]) =>
          createSnapshot(publicCatalog, privateCatalog)
        )
        .catch((error) => {
          snapshotPromise = null;
          throw error;
        });
    }
    return snapshotPromise;
  }

  async function summary() {
    const snapshot = await loadSnapshot();
    return clone(snapshot.summary);
  }

  async function list({ knowledgePointId = "", query = "", limit = DEFAULT_LIMIT } = {}) {
    const snapshot = await loadSnapshot();
    const safePointId = safeIdentifier(knowledgePointId);
    const normalizedQuery = normalizeSearchText(query);
    const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
    const items = snapshot.publicItems.filter((item) => {
      if (safePointId && !getKnowledgePointIds(item).includes(safePointId)) return false;
      if (!normalizedQuery) return true;
      const haystack = normalizeSearchText([
        item.id,
        item.stem,
        item.question_type,
        item.proposition_method,
        item.ability_level,
        ...getKnowledgePointIds(item),
        ...getKnowledgePointNames(item)
      ].join(" "));
      return haystack.includes(normalizedQuery);
    });
    return {
      schema_version: snapshot.publicSchemaVersion,
      bank_id: snapshot.bankId,
      version: snapshot.version,
      total: items.length,
      items: clone(items.slice(0, safeLimit))
    };
  }

  async function getPublicItem(questionId) {
    const snapshot = await loadSnapshot();
    const item = snapshot.publicById.get(safeIdentifier(questionId));
    return item ? clone(item) : null;
  }

  async function getSolution(questionId) {
    const snapshot = await loadSnapshot();
    const safeQuestionId = safeIdentifier(questionId);
    const publicItem = snapshot.publicById.get(safeQuestionId);
    const privateItem = snapshot.privateById.get(safeQuestionId);
    if (!publicItem || !privateItem) return null;
    return clone({
      schema_version: "question-solution@1.0",
      question_id: safeQuestionId,
      question_version: String(publicItem.version || snapshot.version || "1.0"),
      revealed: true,
      answer_key: privateItem.key ?? null,
      solution_plan: privateItem.solution_plan ?? null,
      scoring: privateItem.scoring ?? null,
      verification: privateItem.verification ?? null,
      review: privateItem.review ?? null
    });
  }

  function invalidate() {
    snapshotPromise = null;
  }

  return Object.freeze({ loadSnapshot, summary, list, getPublicItem, getSolution, invalidate });
}

function createSnapshot(publicCatalog, privateCatalog) {
  if (!isPlainObject(publicCatalog) || !Array.isArray(publicCatalog.items)) {
    throw invalidCatalog("公开题库缺少 items 数组", "question_bank_public_invalid");
  }
  if (!isPlainObject(privateCatalog) || !Array.isArray(privateCatalog.items)) {
    throw invalidCatalog("私有题库缺少 items 数组", "question_bank_private_invalid");
  }
  if (privateCatalog.storage_classification !== "server_private") {
    throw invalidCatalog("私有题库必须标记为 server_private", "question_bank_private_invalid");
  }

  const publicItems = [];
  const publicById = new Map();
  for (const rawItem of publicCatalog.items) {
    const item = normalizePublicItem(rawItem);
    if (!item || publicById.has(item.id)) {
      throw invalidCatalog("公开题库存在无效或重复题目 ID", "question_bank_public_invalid");
    }
    assertNoPrivateFields(item);
    publicById.set(item.id, item);
    publicItems.push(item);
  }

  const privateById = new Map();
  for (const item of privateCatalog.items) {
    const questionId = safeIdentifier(item?.question_id ?? item?.id);
    if (!questionId || privateById.has(questionId)) {
      throw invalidCatalog("私有题库存在无效或重复题目 ID", "question_bank_private_invalid");
    }
    privateById.set(questionId, clone(item));
  }

  const missingPrivate = publicItems
    .filter((item) => item.solution_preview?.has_full_solution !== false)
    .map((item) => item.id)
    .filter((id) => !privateById.has(id));
  if (missingPrivate.length) {
    throw invalidCatalog(
      `有 ${missingPrivate.length} 道公开题缺少私有答案或解题思路`,
      "question_bank_private_missing"
    );
  }

  return Object.freeze({
    publicSchemaVersion: String(publicCatalog.schema_version || "question-bank-public@1.0"),
    privateSchemaVersion: String(privateCatalog.schema_version || "question-bank-private@1.0"),
    bankId: String(publicCatalog.bank_id || publicCatalog.question_bank_id || "junior-math-seed"),
    version: String(publicCatalog.version || "1.0"),
    publicItems: deepFreeze(publicItems),
    publicById,
    privateById,
    summary: deepFreeze({
      schema_version: String(publicCatalog.schema_version || "question-bank-public@1.0"),
      bank_id: String(publicCatalog.bank_id || publicCatalog.question_bank_id || "junior-math-seed"),
      version: String(publicCatalog.version || "1.0"),
      public_item_count: publicItems.length,
      private_item_count: privateById.size,
      knowledge_point_count: new Set(publicItems.flatMap(getKnowledgePointIds)).size,
      storage_boundary: "public_prompt/private_key"
    })
  });
}

function normalizePublicItem(rawItem) {
  if (!isPlainObject(rawItem)) return null;
  const id = safeIdentifier(rawItem.id ?? rawItem.question_id);
  const stem = safeText(rawItem.stem, 4_000);
  if (!id || !stem) return null;
  return deepFreeze({
    ...clone(rawItem),
    id,
    stem
  });
}

function assertNoPrivateFields(value, path = "$") {
  const forbidden = new Set([
    "answer",
    "answer_key",
    "correct_answer",
    "correct_option_id",
    "final_answer",
    "solution_plan",
    "explanation"
  ]);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateFields(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) {
      throw invalidCatalog(`公开题库包含私有字段 ${path}.${key}`, "question_bank_public_leak");
    }
    assertNoPrivateFields(child, `${path}.${key}`);
  }
}

function getKnowledgePointIds(item) {
  const values = Array.isArray(item?.knowledge_point_mapping)
    ? item.knowledge_point_mapping
    : Array.isArray(item?.knowledge_points)
      ? item.knowledge_points
      : [];
  return values
    .map((entry) => safeIdentifier(entry?.knowledge_point_id ?? entry?.id ?? entry))
    .filter(Boolean);
}

function getKnowledgePointNames(item) {
  const values = Array.isArray(item?.knowledge_point_mapping)
    ? item.knowledge_point_mapping
    : [];
  return values.map((entry) => safeText(entry?.name ?? entry?.knowledge_point_name, 240)).filter(Boolean);
}

async function readJson(readFileImpl, path, errorCode) {
  let source;
  try {
    source = await readFileImpl(path, "utf8");
  } catch (cause) {
    throw new QuestionBankRepositoryError("题库资产尚未生成或无法读取", {
      code: errorCode,
      status: 503,
      cause
    });
  }
  try {
    return JSON.parse(source);
  } catch {
    throw invalidCatalog("题库资产不是合法 JSON", errorCode);
  }
}

function invalidCatalog(message, code) {
  return new QuestionBankRepositoryError(message, { code, status: 500 });
}

function safeIdentifier(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:@-]/gu, "")
    .slice(0, 200);
}

function safeText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const defaultQuestionBankRepository = createQuestionBankRepository();
