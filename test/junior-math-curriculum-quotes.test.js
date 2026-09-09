import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ontologyPath = new URL("../public/data/junior-math-ontology.json", import.meta.url);
const quotesPath = new URL("../public/data/junior-math-curriculum-quotes.json", import.meta.url);
const EXPECTED_KNOWLEDGE_POINT_COUNT = 140;
const PDF_PAGE_OFFSET = 7;
const SOURCE_PDF_PAGE_COUNT = 189;
const REVIEWED_CONTENT_PAGES = new Set([
  54, 55, 56, 57, 58,
  63, 64, 65, 66, 67, 68, 69, 70,
  74, 75, 76, 77, 78
]);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseDeclaredPrintedPages(value) {
  const pages = new Set();
  for (const part of String(value).split(/[,，]/u)) {
    const range = part.trim().split(/[～~-]/u).map(Number);
    assert.ok(range.length >= 1 && range.length <= 2 && range.every(Number.isInteger), `invalid source page declaration: ${value}`);
    const [start, end = start] = range;
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return pages;
}

function assertNoEmptyValue(value, path) {
  if (typeof value === "string") {
    assert.ok(value.trim(), `${path} must not be empty`);
    return;
  }
  if (Array.isArray(value)) {
    assert.ok(value.length > 0, `${path} must not be an empty array`);
    value.forEach((item, index) => assertNoEmptyValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    assert.ok(entries.length > 0, `${path} must not be an empty object`);
    entries.forEach(([key, item]) => assertNoEmptyValue(item, `${path}.${key}`));
    return;
  }
  assert.notEqual(value, null, `${path} must not be null`);
  assert.notEqual(value, undefined, `${path} must not be undefined`);
}

test("curriculum quotes join all 140 ontology knowledge points exactly once", async () => {
  const [ontology, quotes] = await Promise.all([readJson(ontologyPath), readJson(quotesPath)]);
  const ontologyIds = ontology.knowledge_points.map((point) => point.id);
  const quoteIds = quotes.entries.map((entry) => entry.knowledge_point_id);

  assert.equal(ontologyIds.length, EXPECTED_KNOWLEDGE_POINT_COUNT);
  assert.equal(quotes.entries.length, EXPECTED_KNOWLEDGE_POINT_COUNT);
  assert.equal(new Set(quoteIds).size, EXPECTED_KNOWLEDGE_POINT_COUNT);
  assert.deepEqual(new Set(quoteIds), new Set(ontologyIds));
  assert.equal(quotes.statistics.knowledge_point_count, EXPECTED_KNOWLEDGE_POINT_COUNT);
  assert.equal(quotes.statistics.unique_knowledge_point_count, EXPECTED_KNOWLEDGE_POINT_COUNT);
});

test("every quote is non-empty, verbatim-marked and distinct from measurable_behavior", async () => {
  const [ontology, quotes] = await Promise.all([readJson(ontologyPath), readJson(quotesPath)]);
  const pointById = new Map(ontology.knowledge_points.map((point) => [point.id, point]));

  for (const entry of quotes.entries) {
    const point = pointById.get(entry.knowledge_point_id);
    assert.ok(point, `unknown knowledge point: ${entry.knowledge_point_id}`);
    assertNoEmptyValue(entry, entry.knowledge_point_id);
    assert.equal(entry.is_verbatim, true, `${entry.knowledge_point_id}.is_verbatim`);
    assert.equal(entry.ocr_reviewed, true, `${entry.knowledge_point_id}.ocr_reviewed`);
    assert.equal(entry.verbatim_text, entry.verbatim_quotes.join("\n"));
    assert.notEqual(
      entry.verbatim_text.normalize("NFKC").replace(/\s+/gu, " ").trim(),
      point.measurable_behavior.normalize("NFKC").replace(/\s+/gu, " ").trim(),
      `${entry.knowledge_point_id} must quote the source, not copy measurable_behavior`
    );
    assert.equal(entry.quote_sources.length, entry.verbatim_quotes.length);
    assert.deepEqual(
      entry.quote_sources.map((source) => source.verbatim_text),
      entry.verbatim_quotes,
      `${entry.knowledge_point_id} quote sources must preserve every original clause`
    );
  }
});

test("printed and PDF page locators are legal, aligned by +7, and declared by ontology", async () => {
  const [ontology, quotes] = await Promise.all([readJson(ontologyPath), readJson(quotesPath)]);
  const pointById = new Map(ontology.knowledge_points.map((point) => [point.id, point]));

  for (const entry of quotes.entries) {
    const point = pointById.get(entry.knowledge_point_id);
    const declaredPages = parseDeclaredPrintedPages(point.source_ref.printed_page);
    assert.equal(entry.printed_pages.length, entry.pdf_pages.length);

    for (let index = 0; index < entry.printed_pages.length; index += 1) {
      const printedPage = entry.printed_pages[index];
      const pdfPage = entry.pdf_pages[index];
      assert.equal(Number.isInteger(printedPage), true);
      assert.equal(Number.isInteger(pdfPage), true);
      assert.ok(REVIEWED_CONTENT_PAGES.has(printedPage), `${entry.knowledge_point_id}: unreviewed printed page ${printedPage}`);
      assert.ok(declaredPages.has(printedPage), `${entry.knowledge_point_id}: page ${printedPage} is outside ontology source_ref`);
      assert.equal(pdfPage, printedPage + PDF_PAGE_OFFSET);
      assert.ok(pdfPage >= 1 && pdfPage <= SOURCE_PDF_PAGE_COUNT);
    }

    const sourcePrintedPages = [...new Set(entry.quote_sources.flatMap((source) => source.printed_pages))].sort((a, b) => a - b);
    const sourcePdfPages = [...new Set(entry.quote_sources.flatMap((source) => source.pdf_pages))].sort((a, b) => a - b);
    assert.deepEqual(entry.printed_pages, sourcePrintedPages);
    assert.deepEqual(entry.pdf_pages, sourcePdfPages);
    for (const source of entry.quote_sources) {
      assert.equal(source.printed_pages.length, source.pdf_pages.length);
      source.printed_pages.forEach((printedPage, index) => {
        assert.equal(source.pdf_pages[index], printedPage + PDF_PAGE_OFFSET);
      });
    }
  }
});
