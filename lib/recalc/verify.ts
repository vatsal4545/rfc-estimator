// Audit a finished .xlsx: does every formula cell carry its computed result?
//
// This is the check that would have caught the bug. It reads the sheet XML
// directly rather than going through a reader, because the distinction that
// matters is invisible to every reader: a formula whose result is the empty
// string is stored as <v/>, and openpyxl, pandas and our own reader all hand
// that back as None — indistinguishable from a formula that was never
// computed at all. Only the presence of the <v> element separates the two.

import JSZip from "jszip";
import { attrs, sheetPathsOf, unescapeXml, zipText } from "../intake/xlsx";
import { ERR_BY_CODE, type Scalar } from "./values";

export interface FormulaCell {
  sheet: string;
  ref: string;
  /** The formula text, without the leading "=". Empty for a shared-formula member. */
  formula: string;
  /** False when the cell has an <f> and no <v> — the bug. */
  cached: boolean;
  /** The cached result, when there is one. */
  value: Scalar;
  /** The raw <v> text. "" means the formula's answer is the empty string. */
  raw: string | undefined;
  /** The cell's t attribute: n, str, b, e or s. */
  type: string;
}

export interface FormulaAudit {
  cells: FormulaCell[];
  /** "Sheet!A1" for every formula cell with no cached value at all. */
  missing: string[];
  /** Formula cells whose cached result is an Excel error. */
  errors: string[];
}

/** Every formula cell in the workbook, and whether it carries a result. */
export async function auditFormulaCells(data: ArrayBuffer | Uint8Array): Promise<FormulaAudit> {
  const zip = await JSZip.loadAsync(data);
  const sharedXml = (await zipText(zip, "xl/sharedStrings.xml")) ?? "";
  const shared: string[] = [];
  for (const m of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    let t = "";
    for (const tm of m[1].matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) t += unescapeXml(tm[1] ?? "");
    shared.push(t);
  }

  const audit: FormulaAudit = { cells: [], missing: [], errors: [] };
  for (const sheet of await sheetPathsOf(zip)) {
    const xml = (await zipText(zip, sheet.path)) ?? "";
    const body = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? "";
    for (const m of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const inner = m[2];
      if (inner === undefined) continue;
      const fm = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
      if (!fm) continue;
      const a = attrs(`<c ${m[1]}>`);
      const ref = a.r;
      if (!ref) continue;
      const vm = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(inner);
      const raw = vm ? (vm[1] ?? "") : undefined;
      const cell: FormulaCell = {
        sheet: sheet.name,
        ref,
        formula: unescapeXml(fm[1] ?? ""),
        cached: raw !== undefined,
        value: decode(a.t ?? "n", raw, shared),
        raw,
        type: a.t ?? "n",
      };
      audit.cells.push(cell);
      if (!cell.cached) audit.missing.push(`${sheet.name}!${ref}`);
      else if (a.t === "e") audit.errors.push(`${sheet.name}!${ref} = ${raw}`);
    }
  }
  return audit;
}

function decode(t: string, raw: string | undefined, shared: string[]): Scalar {
  if (raw === undefined) return null;
  if (t === "str") return unescapeXml(raw);
  if (t === "s") return shared[Number(raw)] ?? null;
  if (t === "b") return raw === "1";
  if (t === "e") return ERR_BY_CODE[unescapeXml(raw)] ?? null;
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
