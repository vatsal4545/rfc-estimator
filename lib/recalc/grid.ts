// The workbook as the engine sees it: sheets of raw cell values, the formula
// behind every calculated cell (shared formulas already expanded per cell),
// and the defined names.
//
// This deliberately does NOT reuse readWorkbook() from ../intake/xlsx: that
// reader turns date-formatted numbers into ISO strings, which is right for
// importing an intake and wrong for arithmetic. Here a date is its serial.

import type JSZip from "jszip";
import { attrs, sheetPathsOf, unescapeXml, zipText } from "../intake/xlsx";
import { cellKey, parseA1, translateFormula } from "./a1";
import { ERR_BY_CODE, type Scalar } from "./values";

export interface SheetGrid {
  name: string;
  path: string;
  /** Cell key (see cellKey) → constant or cached value as the file holds it. */
  values: Map<number, Scalar>;
  /** Cell key → formula text, without the leading "=". */
  formulas: Map<number, string>;
  maxRow: number;
  maxCol: number;
}

export interface WorkbookGrid {
  order: string[];
  sheet(name: string): SheetGrid | undefined;
  sheets: SheetGrid[];
  /** Defined name (upper-cased) → definition text, for the whole book. */
  names: Map<string, string>;
  /** Sheet name → its own local names, which shadow the global ones. */
  localNames: Map<string, Map<string, string>>;
}

/** Text of every <t> in a shared-string item or inline string. */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += unescapeXml(m[1] ?? "");
  return out;
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const xml = (await zipText(zip, "xl/sharedStrings.xml")) ?? "";
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) out.push(textOf(m[1]));
  return out;
}

/** Parse one sheet's XML into values and per-cell formulas. */
export function readSheetGrid(name: string, path: string, xml: string, shared: string[]): SheetGrid {
  const grid: SheetGrid = { name, path, values: new Map(), formulas: new Map(), maxRow: 0, maxCol: 0 };
  const body = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1];
  if (!body) return grid;

  // Shared formulas: the master carries the text, the members carry only si.
  const sharedMasters = new Map<string, { formula: string; row: number; col: number }>();
  const pending: { key: number; si: string; row: number; col: number }[] = [];

  for (const m of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = attrs(`<c ${m[1]}>`);
    const at = a.r ? parseA1(a.r) : null;
    if (!at) continue;
    const key = cellKey(at.row, at.col);
    if (at.row > grid.maxRow) grid.maxRow = at.row;
    if (at.col > grid.maxCol) grid.maxCol = at.col;
    const inner = m[2] ?? "";

    const fm = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
    if (fm) {
      const fa = attrs(`<f ${fm[1]}>`);
      const text = unescapeXml(fm[2] ?? "");
      if (fa.t === "shared" && fa.si !== undefined) {
        if (text) {
          sharedMasters.set(fa.si, { formula: text, row: at.row, col: at.col });
          grid.formulas.set(key, text);
        } else {
          pending.push({ key, si: fa.si, row: at.row, col: at.col });
        }
      } else if (text) {
        grid.formulas.set(key, text);
      }
    }

    const v = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(inner);
    const raw = v ? (v[1] ?? "") : undefined;
    const t = a.t ?? "n";
    let value: Scalar = null;
    if (t === "s") value = raw !== undefined ? (shared[Number(raw)] ?? null) : null;
    else if (t === "str") value = raw !== undefined ? unescapeXml(raw) : null;
    else if (t === "inlineStr") value = textOf(inner);
    else if (t === "b") value = raw === "1";
    else if (t === "e") value = raw ? (ERR_BY_CODE[unescapeXml(raw)] ?? null) : null;
    else if (raw !== undefined && raw !== "") {
      const n = Number(raw);
      value = Number.isFinite(n) ? n : null;
    }
    if (value !== null) grid.values.set(key, value);
  }

  for (const p of pending) {
    const master = sharedMasters.get(p.si);
    if (!master) continue;
    grid.formulas.set(p.key, translateFormula(master.formula, p.row - master.row, p.col - master.col));
  }
  return grid;
}

export async function readWorkbookGrid(zip: JSZip): Promise<WorkbookGrid> {
  const paths = await sheetPathsOf(zip);
  const shared = await readSharedStrings(zip);
  const sheets: SheetGrid[] = [];
  for (const s of paths) {
    const xml = (await zipText(zip, s.path)) ?? "";
    sheets.push(readSheetGrid(s.name, s.path, xml, shared));
  }

  const byName = new Map<string, SheetGrid>();
  for (const s of sheets) byName.set(s.name.toUpperCase(), s);

  const names = new Map<string, string>();
  const localNames = new Map<string, Map<string, string>>();
  const workbookXml = (await zipText(zip, "xl/workbook.xml")) ?? "";
  for (const m of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const a = attrs(`<definedName ${m[1]}>`);
    if (!a.name) continue;
    const def = unescapeXml(m[2]).trim();
    const key = a.name.toUpperCase();
    if (a.localSheetId !== undefined) {
      const sheet = sheets[Number(a.localSheetId)];
      if (!sheet) continue;
      const bucket = localNames.get(sheet.name) ?? new Map<string, string>();
      // A workbook re-cut from another often keeps a #REF! twin of a name;
      // the usable definition wins whichever order they appear in.
      if (!bucket.has(key) || bucket.get(key)!.includes("#REF!")) bucket.set(key, def);
      localNames.set(sheet.name, bucket);
    } else if (!names.has(key) || names.get(key)!.includes("#REF!")) {
      names.set(key, def);
    }
  }

  return {
    order: sheets.map((s) => s.name),
    sheets,
    sheet: (name) => byName.get(name.toUpperCase()),
    names,
    localNames,
  };
}
