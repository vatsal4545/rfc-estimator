// "Costs Internal" — a faithful replica of the RFC_V18 sheet (layout, colors,
// borders and formula structure lifted cell-for-cell from the Hoopa Motel
// D-00025 workbook): dark-blue banner over B2:G2, light-blue category column,
// Quantity | Individual Cost | Contingency | Final Cost | Total columns, the
// gray subtotal bands, the ZERO IMPACT BUILDERS COSTS labor block, and the
// small Labor box at J3:K7.
//
// Both generators share this file — the app's Excel export wires the rows to
// its Cost Detail sheet, the standalone RFC-Template wires them to Estimate /
// Panel — so the sheet looks identical wherever it is produced. Unlike some
// source workbooks (VN Village), Individual Cost carries NO hidden +10%
// markup: the only loading is the visible Contingency column.

import type ExcelJS from "exceljs";

const BANNER = "FF326698"; // dark blue header/total fill (white bold text)
const CATEGORY = "FF9AD3E6"; // light blue category-name fill (black bold text)
const BAND = "FFD9D9D9"; // subtotal band (theme white, -15% tint in the source)
export const COSTS_INTERNAL_TAB_COLOR = "FFFCD5B5"; // accent6 +60% tint in the source
const MONEY = '"$"#,##0.00';
const PCT = "0%";

/** Row labels exactly as they appear in the source sheet (rows 3–13). The
 * order matches the engine's `CostsResult.lines` and the template's Estimate
 * lines one-for-one — keep all three in sync. */
export const COSTS_INTERNAL_LABELS = [
  "Wires, Conduits and Peripherals",
  "Main Distribution Switchgear",
  "Electrical Sub-Panels, Transformers, Breakers",
  "Bollards, Signage",
  "Asphalt, Paving, and Striping",
  "Concrete Improvements",
  "ADA",
  "Dump/ Waste",
  "Permits",
  "Utility",
  "Construction Equipment",
] as const;

export interface CellSource {
  /** Excel formula, without the leading "=". */
  formula: string;
  /** Cached result so the file opens showing numbers (app export); the
   * standalone template omits it and lets Excel calculate on open. */
  cached?: number;
}

export interface CostsInternalSpec {
  /** Individual Cost (column D) source for each of the 11 category rows. */
  lines: CellSource[];
  /** Contingency fraction for construction rows (E3:E13). */
  contingency: CellSource;
  /** Contingency fraction for the labor row (E18) — 0 when labor is unloaded. */
  laborContingency: CellSource;
  /** Labor daily rate (K4, read by D18). */
  dailyRate: CellSource;
  /** Labor business days (K5, read by C18). */
  businessDays: CellSource;
  /** Construction PM row (D14): the CEO-basis construction PM (% of loaded
   * labour) plus the design costs except the AHJ plan check (permitting-side).
   * Shown at 0% contingency and kept out of the G15 construction subtotal —
   * the source sums G3:G13 only. */
  constructionPm: CellSource;
}

type Border = Partial<Record<"left" | "right" | "top" | "bottom", { style: "medium" }>>;
const M = { style: "medium" as const };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fillCostsInternal(ws: ExcelJS.Worksheet, spec: CostsInternalSpec): void {
  if (spec.lines.length !== COSTS_INTERNAL_LABELS.length) {
    throw new Error(`Costs Internal expects ${COSTS_INTERNAL_LABELS.length} lines, got ${spec.lines.length}`);
  }

  // Column widths straight from the source sheet (H is the 0.71 spacer).
  const widths = [9.14, 73, 8.14, 18, 11.71, 12.43, 12.71, 0.71, 11.71, 24.71, 12.57];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const r of [2, 7, 16, 17, 20]) ws.getRow(r).height = 15.75;

  const val = (s: CellSource): ExcelJS.CellValue =>
    s.cached !== undefined ? { formula: s.formula, result: round2(s.cached) } : { formula: s.formula };
  const derived = (formula: string, cached: number | undefined): ExcelJS.CellValue =>
    cached !== undefined ? { formula, result: round2(cached) } : { formula };
  const set = (
    addr: string,
    value: ExcelJS.CellValue,
    opts: {
      bold?: boolean;
      white?: boolean;
      fill?: string;
      numFmt?: string;
      align?: "center" | "right";
      border?: Border;
    } = {},
  ): void => {
    const c = ws.getCell(addr);
    if (value !== null) c.value = value;
    c.font = {
      name: "Calibri",
      size: 11,
      bold: opts.bold ?? false,
      color: { argb: opts.white ? "FFFFFFFF" : "FF000000" },
    };
    if (opts.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
    if (opts.numFmt) c.numFmt = opts.numFmt;
    if (opts.align) c.alignment = { horizontal: opts.align };
    if (opts.border) c.border = opts.border;
  };

  // ---- header banner (row 2) ------------------------------------------------
  const banner = { bold: true, white: true, fill: BANNER };
  set("B2", "Electrical Supply & Construction Management Costs", { ...banner, border: { left: M } });
  set("C2", "Quantity", { ...banner, align: "center" });
  set("D2", "Individual Cost", { ...banner, align: "center", numFmt: MONEY });
  set("E2", "Contingency", { ...banner, align: "center", numFmt: PCT });
  set("F2", "Final Cost", { ...banner, align: "center", numFmt: MONEY });
  set("G2", "Total", { ...banner, align: "center", numFmt: MONEY, border: { right: M } });

  // ---- category rows 3–13 ---------------------------------------------------
  const cont = spec.contingency;
  spec.lines.forEach((line, i) => {
    const r = 3 + i;
    const loaded = line.cached !== undefined && cont.cached !== undefined
      ? line.cached * (1 + cont.cached)
      : undefined;
    set(`B${r}`, COSTS_INTERNAL_LABELS[i], { bold: true, fill: CATEGORY, border: { left: M } });
    set(`C${r}`, 1, { align: "center" });
    set(`D${r}`, val(line), { align: "center", numFmt: MONEY });
    set(`E${r}`, val(cont), { align: "center", numFmt: PCT });
    set(`F${r}`, derived(`(D${r}*E${r})+D${r}`, loaded), { align: "center", numFmt: MONEY });
    set(`G${r}`, derived(`F${r}*C${r}`, loaded), { align: "center", numFmt: MONEY, border: { right: M } });
  });

  // Row 14: Construction PM — design costs minus the AHJ plan check. Not part
  // of SUM(G3:G13): its dollars live on the Design invoice, shown here only.
  const pm = spec.constructionPm;
  set("B14", "Construction PM", { bold: true, fill: CATEGORY, border: { left: M } });
  set("C14", 1, { align: "center" });
  set("D14", val(pm), { align: "center", numFmt: MONEY });
  set("E14", 0, { align: "center", numFmt: PCT });
  set("F14", derived("(D14*E14)+D14", pm.cached), { align: "center", numFmt: MONEY });
  set("G14", derived("F14*C14", pm.cached), { align: "center", numFmt: MONEY, border: { right: M } });

  // ---- construction subtotal band (row 15) ----------------------------------
  const cachedBases = spec.lines.every((l) => l.cached !== undefined) && cont.cached !== undefined
    ? spec.lines.reduce((s, l) => s + (l.cached as number) * (1 + (cont.cached as number)), 0)
    : undefined;
  const bandFmt: Record<string, string | undefined> = { D: MONEY, E: PCT, F: MONEY };
  for (const col of ["B", "C", "D", "E", "F"]) {
    set(`${col}15`, null, { bold: true, fill: BAND, align: col === "B" ? undefined : "center", numFmt: bandFmt[col], border: col === "B" ? { left: M } : undefined });
  }
  set("G15", derived("SUM(G3:G13)", cachedBases), { bold: true, fill: BAND, align: "center", numFmt: MONEY, border: { right: M } });

  // ---- ZERO IMPACT BUILDERS COSTS block (rows 17–20) -------------------------
  // Merged cells share one style object in ExcelJS, so the merged banner gets
  // a single uniform style; Excel hides the interior edges of the merge and
  // renders only the outer medium box.
  ws.mergeCells("B17:G17");
  set("B17", "ZERO IMPACT BUILDERS COSTS", { bold: true, align: "center", border: { left: M, right: M, top: M, bottom: M } });

  const days = spec.businessDays;
  const rate = spec.dailyRate;
  const labCont = spec.laborContingency;
  const laborCached = days.cached !== undefined && rate.cached !== undefined && labCont.cached !== undefined
    ? rate.cached * (1 + labCont.cached) * days.cached
    : undefined;
  set("B18", "Labor", { bold: true, fill: CATEGORY, border: { left: M } });
  set("C18", derived("K5", days.cached), { align: "center" });
  set("D18", derived("K4", rate.cached), { align: "center", numFmt: MONEY });
  set("E18", val(labCont), { align: "center", numFmt: PCT });
  set("F18", derived("(D18*E18)+D18", rate.cached !== undefined && labCont.cached !== undefined ? rate.cached * (1 + labCont.cached) : undefined), { align: "center", numFmt: MONEY });
  set("G18", derived("F18*C18", laborCached), { align: "center", numFmt: MONEY, border: { right: M } });

  for (const col of ["B", "C", "D", "E", "F"]) {
    set(`${col}19`, null, { bold: true, fill: BAND, align: col === "B" ? undefined : "center", numFmt: bandFmt[col], border: col === "B" ? { left: M } : undefined });
  }
  set("G19", derived("SUM(G18)", laborCached), { bold: true, fill: BAND, align: "center", numFmt: MONEY, border: { right: M } });

  ws.mergeCells("C20:F20");
  set("B20", null, { border: { left: M, bottom: M } });
  set("C20", "Total", { bold: true, align: "right", border: { bottom: M } });
  const totalCached = cachedBases !== undefined && laborCached !== undefined ? cachedBases + laborCached : undefined;
  set("G20", derived("G15+G19", totalCached), { bold: true, white: true, fill: BANNER, align: "center", numFmt: MONEY, border: { right: M, bottom: M } });

  // ---- Labor box (J3:K7) -----------------------------------------------------
  set("J3", "Labor", { ...banner, align: "center", border: { left: M, top: M } });
  set("K3", null, { ...banner, align: "center", numFmt: MONEY, border: { right: M, top: M } });
  set("J4", "Daily Cost", { border: { left: M } });
  set("K4", val(rate), { numFmt: MONEY, border: { right: M } });
  set("J5", "Total Business Days", { border: { left: M } });
  set("K5", val(days), { align: "center", border: { right: M } });
  set("J6", "Total Months", { border: { left: M } });
  set("K6", derived("K5/30", days.cached !== undefined ? days.cached / 30 : undefined), { align: "center", border: { right: M } });
  set("J7", "Total Labor", { border: { left: M, bottom: M } });
  set("K7", derived("K5*K4", days.cached !== undefined && rate.cached !== undefined ? days.cached * rate.cached : undefined), { numFmt: MONEY, border: { right: M, bottom: M } });
}
