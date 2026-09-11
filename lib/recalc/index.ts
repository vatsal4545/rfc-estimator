// Recalculate a workbook and persist the answers.
//
// Why this exists: a formula cell in OOXML carries both the formula (<f>) and
// its last computed result (<v>). Excel recalculates on open and so never
// misses the <v>; every other reader — openpyxl, pandas, SheetJS — reads the
// <v> and nothing else. A workbook written with formulas but no cached values
// looks perfect in Excel and reads as blanks and zeroes everywhere else.
//
// Our RFC/MSRP export fills a formula-driven template, so the numbers that
// matter are the workbook's own, not the app's: there is nothing to copy in.
// This module evaluates the workbook the way Excel would and writes the
// result of every formula cell next to its formula.

import JSZipCtor from "jszip";
import type JSZip from "jszip";
import { escapeXml } from "../intake/xlsxWrite";
import { keyToA1 } from "./a1";
import { Engine, type RecalcWarning } from "./evaluate";
import { readWorkbookGrid, type WorkbookGrid } from "./grid";
import { zipText } from "../intake/xlsx";
import { isError, type Scalar } from "./values";

export interface RecalcReport {
  /** Formula cells given a cached value. */
  evaluated: number;
  /** Formula cells whose value is an Excel error, with the code. */
  errors: { sheet: string; ref: string; code: string }[];
  /** Anything the engine could not do faithfully — unknown functions, cycles. */
  warnings: RecalcWarning[];
}

/** Excel's <v> text for a computed value. */
function valueXml(value: Scalar): { t: string; v: string } {
  if (isError(value)) return { t: "e", v: value.code };
  if (typeof value === "boolean") return { t: "b", v: value ? "1" : "0" };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { t: "e", v: "#NUM!" };
    return { t: "n", v: numberXml(value) };
  }
  // A blank result is not a thing a formula can produce: it is "".
  return { t: "str", v: escapeXml(value ?? "") };
}

export function numberXml(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const s = String(n);
  return s.includes("e") ? s.replace("e", "E") : s;
}

/** Replace `t=` on a <c> start tag, adding it when absent. */
function withType(cellAttrs: string, t: string): string {
  const stripped = cellAttrs.replace(/\s+t="[^"]*"/g, "");
  return `${stripped} t="${t}"`;
}

/**
 * Write cached values into one sheet's XML. Only cells that already carry an
 * <f> are touched, and the <f> element itself — shared-formula attributes and
 * all — is copied through byte for byte, so the workbook stays live in Excel.
 */
export function writeCachedValues(
  xml: string,
  values: Map<number, Scalar>,
  keyOf: (ref: string) => number | null,
): { xml: string; written: number; skipped: string[] } {
  let written = 0;
  // Cells carrying an <f> the recalculation produced no value for — an
  // orphaned shared formula, say. They keep whatever stale value they had,
  // which is the very thing this module exists to prevent, so they are named
  // rather than passed over.
  const skipped: string[] = [];
  const next = xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (whole, attrText: string, body?: string) => {
    if (body === undefined) return whole;
    const fm = /<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/.exec(body);
    if (!fm) return whole;
    const ref = /\br="([^"]+)"/.exec(attrText)?.[1];
    if (!ref) return whole;
    const key = keyOf(ref);
    if (key === null || !values.has(key)) {
      skipped.push(ref);
      return whole;
    }
    const { t, v } = valueXml(values.get(key)!);
    written++;
    // Excel writes an empty result as <v/>; match it byte for byte.
    return `<c${withType(attrText, t)}>${fm[0]}${v === "" ? "<v/>" : `<v>${v}</v>`}</c>`;
  });
  return { xml: next, written, skipped };
}

/**
 * Evaluate every formula in the workbook and write the results back into the
 * zip. The zip is mutated in place; the caller generates the bytes.
 */
export async function recalculateWorkbook(zip: JSZip): Promise<RecalcReport> {
  const book = await readWorkbookGrid(zip);
  const engine = new Engine(book);
  const report: RecalcReport = { evaluated: 0, errors: [], warnings: [] };

  for (const sheet of book.sheets) {
    const computed = new Map<number, Scalar>();
    // Reading order keeps the recursion shallow: a row that depends on the
    // row above it finds the answer already cached rather than re-entering.
    for (const key of [...sheet.formulas.keys()].sort((a, b) => a - b)) {
      const row = Math.floor(key / 16384);
      const col = key % 16384;
      const value = engine.cellValue(sheet, row, col);
      computed.set(key, value);
      if (isError(value)) report.errors.push({ sheet: sheet.name, ref: keyToA1(key), code: value.code });
    }
    if (computed.size === 0) continue;
    const xml = await zipText(zip, sheet.path);
    if (xml === undefined) continue;
    const patched = writeCachedValues(xml, computed, (ref) => keyFromRef(ref));
    zip.file(sheet.path, patched.xml);
    report.evaluated += patched.written;
    for (const ref of patched.skipped) {
      engine.warnings.push({
        sheet: sheet.name,
        ref,
        message: "formula cell left with the value it already had — the engine produced none",
      });
    }
  }
  report.warnings = engine.warnings;
  return report;
}

/**
 * Recalculate a whole .xlsx and hand back its bytes — for exporters that
 * build a file rather than patch one. Every formula keeps its formula and
 * gains its result, so the workbook stays live in Excel and reads correctly
 * everywhere else.
 */
export async function cacheFormulaValues(
  data: ArrayBuffer | Uint8Array,
): Promise<{ bytes: Uint8Array; report: RecalcReport }> {
  const zip = await JSZipCtor.loadAsync(data);
  const report = await recalculateWorkbook(zip);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { bytes, report };
}

function keyFromRef(ref: string): number | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref);
  if (!m) return null;
  let col = 0;
  const letters = m[1].toUpperCase();
  for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
  return Number(m[2]) * 16384 + col;
}

export type { WorkbookGrid, RecalcWarning };
export { Engine } from "./evaluate";
export { readWorkbookGrid } from "./grid";
