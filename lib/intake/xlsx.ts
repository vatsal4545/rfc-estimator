// A small .xlsx cell reader — constants, cached formula results, shared
// strings and dates — built on jszip and a tolerant tag scanner.
//
// Why not ExcelJS: its reader fails on the CEO's intake template ("Cannot read
// properties of undefined (reading 'comments')"), and a completed intake is
// the same workbook with the blue cells filled in. The importer only needs
// cell values, so this reads the sheet XML directly and never touches
// comments, styles beyond number formats, drawings or validations. Files
// written by Excel, LibreOffice and openpyxl all follow this layout.

import JSZip from "jszip";

export type CellValue = string | number | boolean | null;

export interface WorkbookCells {
  sheetNames: string[];
  has(sheet: string): boolean;
  /** The cell's value: a constant or a cached formula result; null when blank, an error, or an uncached formula. */
  get(sheet: string, ref: string): CellValue;
  /** The cell's formula text, when it has one. */
  formula(sheet: string, ref: string): string | undefined;
  /** Every populated cell of a sheet, for callers that scan ranges. */
  cells(sheet: string): Map<string, CellValue>;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? m;
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = unescapeXml(m[2]);
  return out;
}

/** Text of every <t> element inside a shared-string item or an inline string (rich-text runs concatenate). */
function textOf(xml: string): string {
  let out = "";
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += unescapeXml(m[1] ?? "");
  return out;
}

/** Excel serial date (1900 system) → ISO yyyy-mm-dd. */
export function serialToIsoDate(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Built-in date number formats, plus any custom format with date tokens outside quotes. */
function isDateFormat(numFmtId: number, custom: Map<number, string>): boolean {
  if ((numFmtId >= 14 && numFmtId <= 22) || (numFmtId >= 45 && numFmtId <= 47)) return true;
  const code = custom.get(numFmtId);
  if (!code) return false;
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  return /[ymdh]/i.test(stripped) && !/[#0]/.test(stripped);
}

export async function readWorkbook(data: ArrayBuffer | Uint8Array): Promise<WorkbookCells> {
  const zip = await JSZip.loadAsync(data);
  const text = async (path: string): Promise<string | undefined> => {
    const file = zip.file(path) ?? zip.file(path.replace(/^\//, ""));
    return file ? file.async("string") : undefined;
  };

  const workbookXml = await text("xl/workbook.xml");
  if (!workbookXml) throw new Error("Not an .xlsx workbook (xl/workbook.xml missing)");
  const relsXml = (await text("xl/_rels/workbook.xml.rels")) ?? "";
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) rels.set(a.Id, a.Target);
  }
  const sheets: { name: string; path: string }[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*?\/?>/g)) {
    const a = attrs(m[0]);
    const rid = a["r:id"] ?? Object.entries(a).find(([k]) => k.endsWith(":id"))?.[1];
    const target = rid ? rels.get(rid) : undefined;
    if (!a.name || !target) continue;
    const path = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target}`;
    sheets.push({ name: a.name, path });
  }

  // Shared strings.
  const sharedXml = (await text("xl/sharedStrings.xml")) ?? "";
  const shared: string[] = [];
  for (const m of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  // Number formats → which cell styles are dates.
  const stylesXml = (await text("xl/styles.xml")) ?? "";
  const customFormats = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*?\/?>/g)) {
    const a = attrs(m[0]);
    if (a.numFmtId && a.formatCode) customFormats.set(Number(a.numFmtId), a.formatCode);
  }
  const dateStyles: boolean[] = [];
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  for (const m of cellXfs.matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const a = attrs(m[0]);
    dateStyles.push(isDateFormat(Number(a.numFmtId ?? 0), customFormats));
  }

  const values = new Map<string, Map<string, CellValue>>();
  const formulas = new Map<string, Map<string, string>>();
  for (const sheet of sheets) {
    const xml = await text(sheet.path);
    const cellMap = new Map<string, CellValue>();
    const formulaMap = new Map<string, string>();
    values.set(sheet.name, cellMap);
    formulas.set(sheet.name, formulaMap);
    if (!xml) continue;
    const body = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? "";
    for (const m of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(`<c ${m[1]}>`);
      const ref = a.r;
      if (!ref) continue;
      const inner = m[2] ?? "";
      const f = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
      if (f) formulaMap.set(ref, unescapeXml(f[1] ?? ""));
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const t = a.t ?? "n";
      let value: CellValue = null;
      if (t === "s") value = v !== undefined ? (shared[Number(v)] ?? null) : null;
      else if (t === "str") value = v !== undefined ? unescapeXml(v) : null;
      else if (t === "inlineStr") value = textOf(inner);
      else if (t === "b") value = v === "1";
      else if (t === "e") value = null;
      else if (v !== undefined && v !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) {
          const style = a.s !== undefined ? Number(a.s) : -1;
          value = style >= 0 && dateStyles[style] ? serialToIsoDate(n) : n;
        }
      }
      if (value !== null) cellMap.set(ref, value);
    }
  }

  return {
    sheetNames: sheets.map((s) => s.name),
    has: (sheet) => values.has(sheet),
    get: (sheet, ref) => values.get(sheet)?.get(ref) ?? null,
    formula: (sheet, ref) => formulas.get(sheet)?.get(ref),
    cells: (sheet) => values.get(sheet) ?? new Map(),
  };
}
