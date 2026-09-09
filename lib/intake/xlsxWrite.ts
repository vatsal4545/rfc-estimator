// A small .xlsx cell WRITER — the twin of xlsx.ts. It patches values into an
// existing workbook's sheet XML and touches nothing else: styles, data
// validations, comments, defined names, formulas and column widths all
// survive byte for byte. That is what filling the CEO's intake template
// needs — ExcelJS cannot open the template at all, and a full rewrite would
// lose the very things that make the template theirs.
//
// Cells are written as inline strings, plain numbers or booleans into the
// existing <c> element (its style is kept), or inserted into the right row in
// column order when the template has no placeholder cell. A target cell that
// carries a formula is refused unless the write opts in with
// `overwriteFormula`; a cell defining a shared formula is refused either way.

import JSZip from "jszip";
import { attrs, sheetPathsOf, zipText } from "./xlsx";

export { isoToSerial } from "./serial";

export type WriteValue = string | number | boolean | null;

export interface CellWrite {
  sheet: string;
  ref: string;
  value: WriteValue;
  /**
   * Replace the formula in the target cell with this literal value. Off by
   * default, and deliberately so: filling the intake must never clobber the
   * template's own math. The RFC/MSRP calculator fill opts in for the two
   * ranges whose formulas it is meant to supersede — the Costs Internal
   * "Individual Cost" column (which reads CPM Calcs) and the resolved utility
   * rate cells (which read the workbook's own copy of the rate library).
   */
  overwriteFormula?: boolean;
}

export interface PatchResult {
  bytes: Uint8Array;
  /** Cells actually written (cleared cells count). */
  written: number;
  /** Writes refused: a formula cell, an unknown sheet, or a malformed reference. */
  refused: string[];
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Column letters → 1-based index. */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function splitRef(ref: string): { col: string; row: number } | null {
  const m = /^([A-Za-z]{1,3})(\d+)$/.exec(ref.trim());
  return m ? { col: m[1].toUpperCase(), row: Number(m[2]) } : null;
}

function numberText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

function renderCell(ref: string, styleAttr: string, value: WriteValue): string {
  if (value === null || value === "") return `<c r="${ref}"${styleAttr}/>`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return `<c r="${ref}"${styleAttr}/>`;
    return `<c r="${ref}"${styleAttr} t="n"><v>${numberText(value)}</v></c>`;
  }
  if (typeof value === "boolean") return `<c r="${ref}"${styleAttr} t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

interface ParsedCell {
  ref: string;
  colIdx: number;
  raw: string;
  styleAttr: string;
  hasFormula: boolean;
  /**
   * The cell defines a shared formula other cells depend on (`<f t="shared"
   * ref="A1:A9" si="3">`). Replacing it would leave those dependents with no
   * definition, so it is never overwritten even when the caller opts in.
   */
  sharedMaster: boolean;
}

function parseCells(inner: string): ParsedCell[] {
  const out: ParsedCell[] = [];
  for (const m of inner.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = attrs(`<c ${m[1]}>`);
    const ref = a.r;
    if (!ref) continue;
    const split = splitRef(ref);
    if (!split) continue;
    const body = m[2] ?? "";
    const f = /<f\b([^>]*?)(?:\/>|>)/.exec(body);
    const fa = f ? attrs(`<f ${f[1]}>`) : {};
    out.push({
      ref,
      colIdx: colIndex(split.col),
      raw: m[0],
      styleAttr: a.s !== undefined ? ` s="${a.s}"` : "",
      hasFormula: f !== null,
      sharedMaster: fa.t === "shared" && fa.ref !== undefined,
    });
  }
  return out;
}

/** Patch one worksheet's XML. Pure: returns the new XML and the refs it refused. */
export function patchSheetXml(xml: string, writes: CellWrite[]): { xml: string; refused: string[]; written: number } {
  const refused: string[] = [];
  let written = 0;
  const byRow = new Map<number, Map<string, CellWrite>>();
  for (const w of writes) {
    const split = splitRef(w.ref);
    if (!split) {
      refused.push(`${w.sheet}!${w.ref}: not a cell reference`);
      continue;
    }
    const key = `${split.col}${split.row}`;
    if (!byRow.has(split.row)) byRow.set(split.row, new Map());
    byRow.get(split.row)!.set(key, { ...w, ref: key });
  }
  if (byRow.size === 0) return { xml, refused, written };

  // Locate <sheetData>…</sheetData> (or an empty <sheetData/>).
  let openStart = xml.indexOf("<sheetData");
  if (openStart < 0) return { xml, refused: [...refused, ...[...byRow.values()].flatMap((m) => [...m.values()].map((w) => `${w.sheet}!${w.ref}: sheet has no sheetData`))], written };
  const openEnd = xml.indexOf(">", openStart);
  const selfClosing = xml[openEnd - 1] === "/";
  let head: string;
  let body: string;
  let tail: string;
  if (selfClosing) {
    head = xml.slice(0, openEnd - 1) + ">";
    body = "";
    tail = "</sheetData>" + xml.slice(openEnd + 1);
  } else {
    const close = xml.indexOf("</sheetData>", openEnd);
    head = xml.slice(0, openEnd + 1);
    body = xml.slice(openEnd + 1, close);
    tail = xml.slice(close);
  }
  openStart = -1;

  const renderRow = (rowNo: number, existingAttrs: string, existingInner: string): string => {
    const pending = byRow.get(rowNo);
    const cells = parseCells(existingInner);
    if (!pending) return `<row${existingAttrs}>${existingInner}</row>`;
    const out: ParsedCell[] = [];
    for (const c of cells) {
      const w = pending.get(c.ref);
      if (!w) {
        out.push(c);
        continue;
      }
      pending.delete(c.ref);
      if (c.hasFormula && !w.overwriteFormula) {
        refused.push(`${w.sheet}!${w.ref}: the template cell holds a formula — left as is`);
        out.push(c);
        continue;
      }
      if (c.hasFormula && c.sharedMaster) {
        refused.push(`${w.sheet}!${w.ref}: the template cell defines a shared formula other cells depend on — left as is`);
        out.push(c);
        continue;
      }
      // renderCell rebuilds the <c> from scratch, so any <f> goes with it.
      out.push({ ...c, raw: renderCell(c.ref, c.styleAttr, w.value), hasFormula: false, sharedMaster: false });
      written++;
    }
    for (const w of pending.values()) {
      const split = splitRef(w.ref)!;
      out.push({ ref: w.ref, colIdx: colIndex(split.col), raw: renderCell(w.ref, "", w.value), styleAttr: "", hasFormula: false, sharedMaster: false });
      written++;
    }
    out.sort((a, b) => a.colIdx - b.colIdx);
    byRow.delete(rowNo);
    return `<row${existingAttrs}>${out.map((c) => c.raw).join("")}</row>`;
  };

  const parts: string[] = [];
  let cursor = 0;
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let m: RegExpExecArray | null;
  const flushNewRowsBefore = (rowNo: number) => {
    const due = [...byRow.keys()].filter((r) => r < rowNo).sort((a, b) => a - b);
    for (const r of due) parts.push(renderRow(r, ` r="${r}"`, ""));
  };
  while ((m = rowRe.exec(body))) {
    const a = attrs(`<row ${m[1]}>`);
    const rowNo = Number(a.r);
    parts.push(body.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    if (!Number.isFinite(rowNo)) {
      parts.push(m[0]);
      continue;
    }
    flushNewRowsBefore(rowNo);
    if (byRow.has(rowNo)) parts.push(renderRow(rowNo, m[1], m[2] ?? ""));
    else parts.push(m[0]);
  }
  parts.push(body.slice(cursor));
  flushNewRowsBefore(Number.POSITIVE_INFINITY);
  return { xml: head + parts.join("") + tail, refused, written };
}

function resolveSheet(sheets: { name: string; path: string }[], name: string): { name: string; path: string } | undefined {
  return sheets.find((s) => s.name === name) ?? sheets.find((s) => s.name.endsWith(`_${name}`) || s.name.toLowerCase() === name.toLowerCase());
}

/**
 * Write cells into a copy of the workbook. Every other part is carried over
 * untouched; the workbook is flagged to recalculate fully when Excel opens it
 * (so the template's live checks pick up the new inputs) and any stale
 * calculation chain is dropped.
 */
export async function patchWorkbook(template: ArrayBuffer | Uint8Array, writes: CellWrite[]): Promise<PatchResult> {
  const zip = await JSZip.loadAsync(template);
  const sheets = await sheetPathsOf(zip);
  const refused: string[] = [];
  let written = 0;

  const bySheet = new Map<string, CellWrite[]>();
  for (const w of writes) {
    const sheet = resolveSheet(sheets, w.sheet);
    if (!sheet) {
      refused.push(`${w.sheet}!${w.ref}: no such sheet`);
      continue;
    }
    if (!bySheet.has(sheet.path)) bySheet.set(sheet.path, []);
    bySheet.get(sheet.path)!.push(w);
  }
  for (const [path, list] of bySheet) {
    const xml = await zipText(zip, path);
    if (xml === undefined) {
      refused.push(...list.map((w) => `${w.sheet}!${w.ref}: sheet part ${path} missing`));
      continue;
    }
    const patched = patchSheetXml(xml, list);
    refused.push(...patched.refused);
    written += patched.written;
    zip.file(path, patched.xml);
  }

  // Full recalculation on open, so every green check reflects the values written.
  const workbookXml = await zipText(zip, "xl/workbook.xml");
  if (workbookXml) {
    let next = workbookXml;
    if (/<calcPr\b/.test(next)) {
      next = next.replace(/<calcPr\b([^>]*?)\/?>/, (tag, inner: string) => {
        const cleaned = inner.replace(/\sfullCalcOnLoad="[^"]*"/, "");
        return `<calcPr${cleaned} fullCalcOnLoad="1"${tag.endsWith("/>") ? "/>" : ">"}`;
      });
    } else {
      next = next.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
    }
    if (next !== workbookXml) zip.file("xl/workbook.xml", next);
  }
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const ct = await zipText(zip, "[Content_Types].xml");
    if (ct) zip.file("[Content_Types].xml", ct.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ""));
    const rels = await zipText(zip, "xl/_rels/workbook.xml.rels");
    if (rels) zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>/, ""));
  }

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { bytes, written, refused };
}
