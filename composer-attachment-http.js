import Busboy from "busboy";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const EXTRACT_PATH = "/api/composer/attachments/extract";
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 48_000;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);
const FORMAT_BY_EXTENSION = new Map([
  [".pdf", "pdf"],
  [".docx", "docx"],
  [".pptx", "pptx"],
  [".txt", "text"],
  [".md", "markdown"],
  [".markdown", "markdown"],
]);

export class ComposerAttachmentError extends Error {
  constructor(code, message, { status = 400, cause } = {}) {
    super(message, { cause });
    this.name = "ComposerAttachmentError";
    this.code = code;
    this.status = status;
  }
}

export function createComposerAttachmentHttpHandler({
  authorizeRequest = () => false,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
} = {}) {
  return async function handleComposerAttachmentHttp(req, res, requestUrl) {
    const pathname = requestUrl?.pathname || new URL(req.url || "/", "http://localhost").pathname;
    if (pathname !== EXTRACT_PATH) return false;
    if (authorizeRequest(req) !== true) {
      sendJson(res, 403, { error: "composer_attachment_forbidden", message: "当前请求不能读取附件" });
      return true;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      sendJson(res, 405, { error: "method_not_allowed", message: "仅支持 POST" });
      return true;
    }
    try {
      const upload = await readSingleUpload(req, { maxFileBytes });
      const attachment = await extractComposerDocument(upload);
      sendJson(res, 200, {
        schema_version: "composer-attachment-extract@1.0",
        attachment,
      });
    } catch (error) {
      const publicError = error instanceof ComposerAttachmentError
        ? error
        : new ComposerAttachmentError("composer_attachment_extract_failed", "文档读取失败，请检查文件后重试", { status: 422, cause: error });
      sendJson(res, publicError.status, { error: publicError.code, message: publicError.message });
    }
    return true;
  };
}

export async function extractComposerDocument({ bytes, fileName } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const safeName = String(fileName || "document").replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 180) || "document";
  const extension = extname(safeName).toLowerCase();
  const format = FORMAT_BY_EXTENSION.get(extension);
  if (!format) {
    if ([".doc", ".ppt"].includes(extension)) {
      throw new ComposerAttachmentError("composer_attachment_legacy_office", "暂不支持旧版 DOC/PPT，请另存为 DOCX/PPTX 后上传", { status: 415 });
    }
    throw new ComposerAttachmentError("composer_attachment_type_unsupported", "支持 PDF、DOCX、PPTX、TXT 和 Markdown 文档", { status: 415 });
  }
  if (!buffer.length) throw new ComposerAttachmentError("composer_attachment_empty", "附件内容为空", { status: 422 });
  assertSignature(format, buffer);

  let text = "";
  if (TEXT_EXTENSIONS.has(extension)) text = decodePlainText(buffer);
  else if (format === "pdf") text = await extractPdfText(buffer);
  else text = await extractOfficeText(buffer, format);
  text = normalizeExtractedText(text).slice(0, MAX_TEXT_CHARACTERS);
  if (text.length < 2) {
    throw new ComposerAttachmentError(
      "composer_attachment_no_text",
      format === "pdf" ? "没有从 PDF 读取到文字；扫描版请改为上传页面图片" : "没有从文档读取到可用文字",
      { status: 422 },
    );
  }
  return Object.freeze({
    name: safeName,
    mime_type: mimeForFormat(format),
    format,
    size_bytes: buffer.length,
    character_count: text.length,
    truncated: text.length >= MAX_TEXT_CHARACTERS,
    text,
  });
}

function assertSignature(format, bytes) {
  if (format === "pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new ComposerAttachmentError("composer_attachment_signature_invalid", "文件内容不是有效的 PDF", { status: 422 });
  }
  if (["docx", "pptx"].includes(format) && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new ComposerAttachmentError("composer_attachment_signature_invalid", "Office 文档已损坏或格式与扩展名不一致", { status: 422 });
  }
}

function decodePlainText(bytes) {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const nulRatio = [...text].filter((character) => character === "\u0000").length / Math.max(1, text.length);
  if (nulRatio > 0.01) throw new ComposerAttachmentError("composer_attachment_text_invalid", "文本文件编码无法识别", { status: 422 });
  return text;
}

async function extractPdfText(bytes) {
  const directory = await mkdtemp(join(tmpdir(), "ai-training-composer-pdf-"));
  const sourcePath = join(directory, "source.pdf");
  try {
    await writeFile(sourcePath, bytes, { mode: 0o600 });
    const { stdout } = await execFile("pdftotext", ["-layout", "-nopgbrk", sourcePath, "-"], {
      encoding: "utf8",
      maxBuffer: MAX_EXTRACTED_BYTES,
      timeout: 45_000,
    });
    return stdout;
  } catch (cause) {
    throw new ComposerAttachmentError("composer_attachment_pdf_extract_failed", "PDF 文字读取失败；扫描版请改为上传页面图片", { status: 422, cause });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function extractOfficeText(bytes, format) {
  const directory = await mkdtemp(join(tmpdir(), "ai-training-composer-office-"));
  const sourcePath = join(directory, `source.${format}`);
  try {
    await writeFile(sourcePath, bytes, { mode: 0o600 });
    const { stdout: listing } = await execFile("unzip", ["-Z1", sourcePath], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
    });
    const entries = listing.split(/\r?\n/u).filter(Boolean);
    const selected = format === "docx"
      ? entries.filter((entry) => /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/u.test(entry))
      : entries.filter((entry) => /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/u.test(entry));
    selected.sort(naturalXmlOrder);
    if (!selected.length) throw new Error("office document XML is missing");
    const { stdout } = await execFile("unzip", ["-p", sourcePath, ...selected], {
      encoding: "utf8",
      maxBuffer: MAX_EXTRACTED_BYTES,
      timeout: 30_000,
    });
    return officeXmlToText(stdout, format);
  } catch (cause) {
    if (cause instanceof ComposerAttachmentError) throw cause;
    throw new ComposerAttachmentError("composer_attachment_office_extract_failed", "Office 文档读取失败，请确认文件未损坏", { status: 422, cause });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function officeXmlToText(xml, format) {
  const withBreaks = String(xml)
    .replace(/<w:tab\b[^>]*\/>/gu, "\t")
    .replace(/<w:br\b[^>]*\/>/gu, "\n")
    .replace(/<\/w:tc>/gu, "\t")
    .replace(/<\/(?:w:p|a:p)>/gu, "\n")
    .replace(format === "pptx" ? /<\/p:sld>/gu : /<\/w:document>/gu, "\n\n")
    .replace(/<[^>]+>/gu, "");
  return decodeXmlEntities(withBreaks);
}

function decodeXmlEntities(value) {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/giu, (entity, token) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (named[token]) return named[token];
    const numeric = token.startsWith("#x") ? Number.parseInt(token.slice(2), 16) : Number.parseInt(token.slice(1), 10);
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
  });
}

function normalizeExtractedText(value) {
  return String(value || "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t ]+\n/gu, "\n")
    .replace(/[\t ]{3,}/gu, "  ")
    .replace(/\n{4,}/gu, "\n\n\n")
    .replace(/\u0000/gu, "")
    .trim();
}

function naturalXmlOrder(left, right) {
  const leftNumber = Number(left.match(/(\d+)\.xml$/u)?.[1] || 0);
  const rightNumber = Number(right.match(/(\d+)\.xml$/u)?.[1] || 0);
  return leftNumber - rightNumber || left.localeCompare(right);
}

function mimeForFormat(format) {
  return {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    markdown: "text/markdown",
    text: "text/plain",
  }[format] || "application/octet-stream";
}

function readSingleUpload(req, { maxFileBytes }) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        defParamCharset: "utf8",
        limits: { files: 1, fileSize: maxFileBytes, fields: 2, parts: 3 },
      });
    } catch (cause) {
      reject(new ComposerAttachmentError("composer_attachment_multipart_required", "请使用文件上传格式", { status: 415, cause }));
      return;
    }
    let file = null;
    let tooLarge = false;
    let duplicate = false;
    const chunks = [];
    parser.on("file", (field, stream, info) => {
      if (field !== "file" || file) {
        duplicate = Boolean(file);
        stream.resume();
        return;
      }
      file = { fileName: info.filename || "document", mimeType: info.mimeType || "application/octet-stream" };
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.once("limit", () => { tooLarge = true; });
    });
    parser.once("filesLimit", () => { duplicate = true; });
    parser.once("error", (cause) => reject(new ComposerAttachmentError("composer_attachment_upload_invalid", "附件上传失败", { status: 400, cause })));
    parser.once("close", () => {
      if (duplicate) return reject(new ComposerAttachmentError("composer_attachment_multiple_files", "请逐个上传附件", { status: 400 }));
      if (tooLarge) return reject(new ComposerAttachmentError("composer_attachment_too_large", "文档请不要超过 16 MB", { status: 413 }));
      if (!file || !chunks.length) return reject(new ComposerAttachmentError("composer_attachment_required", "请选择需要读取的文档", { status: 400 }));
      resolve({ ...file, bytes: Buffer.concat(chunks) });
    });
    req.pipe(parser);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
