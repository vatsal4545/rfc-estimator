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
import type { CostsResult, FinancialInput } from "./calc/types";
import type { CommercialInput } from "./proposal/types";

/**
 * What the "Construction PM" row (D14) holds — the single definition the app
 * tab, the Cost Detail export and the RFC/MSRP fill all read, so the three can
 * never disagree.
 *
 * The CEO-basis construction PM (a % of loaded labour) plus the design /
 * permitting PM hours, which are a manual entry on the Financials tab. The
 * auto-calculated design fees — AutoCAD site plan, electrical engineering SLD
 * and the AHJ plan check — are NOT here: they are their own Design Invoice
 * lines, and counting them here too would double them on the Internal Summary.
 */
export function constructionPmRowCost(costs: CostsResult, financial: FinancialInput): number {
  return costs.constructionPm + financial.pmHours * financial.pmHourlyRate;
}

/** The design PM hours the Construction PM row above absorbs. */
export function designPmHoursCost(financial: FinancialInput): number {
  return financial.pmHours * financial.pmHourlyRate;
}

/**
 * The E-column ("Contingency") value for every row of the sheet.
 *
 * The column carries contingency AND the commercial markup, compounded, so
 * that Final Cost / Total land on the LIST price — the figure the Internal
 * Summary's "Price" column wants. Without this the markup has nowhere to go
 * but that sheet's "Applied Discount" column, where it shows up as a negative
 * discount; folding it in here leaves that column holding genuine discounts
 * only. Same money either way, one presentation instead of two.
 *
 * Note what this means: with a commercial section attached, column D is still
 * raw cost but F and G are PRICE. Without one there is no markup to fold and
 * the column is plain contingency, exactly as before.
 */
export interface CostsInternalLoading {
  /** E3:E13, one per engine cost line, in engine order. */
  lines: number[];
  /** E14 — the Construction PM row. */
  constructionPm: number;
  /** E18 — the labor row. */
  labor: number;
  /** True when a commercial markup is folded into the values above. */
  includesMarkup: boolean;
}

export function costsInternalLoading(
  costs: CostsResult,
  financial: FinancialInput,
  commercial: CommercialInput | undefined,
): CostsInternalLoading {
  const contingency = financial.contingencyPct;
  const laborContingency = (financial.applyContingencyToLabor ?? true) ? contingency : 0;
  if (!commercial) {
    return {
      lines: costs.lines.map(() => contingency),
      constructionPm: 0,
      labor: laborContingency,
      includesMarkup: false,
    };
  }
  // Pass-through lines bill at exactly base cost — no contingency, no markup —
  // so they load by nothing at all and F = D.
  const passThrough = new Set(commercial.passThroughLines);
  const lines = costs.lines.map((l) =>
    passThrough.has(l.name) ? 0 : (1 + contingency) * (1 + commercial.markupMaterialsPct) - 1,
  );
  // The Construction PM row mixes a marked-up CEO-basis PM with design PM
  // hours, which are in-house and carry no markup, so its loading is blended.
  const pmCost = constructionPmRowCost(costs, financial);
  const pmList = costs.constructionPm * (1 + commercial.markupLaborPct) + designPmHoursCost(financial);
  return {
    lines,
    constructionPm: pmCost > 0.005 ? pmList / pmCost - 1 : 0,
    labor: (1 + laborContingency) * (1 + commercial.markupLaborPct) - 1,
    includesMarkup: true,
  };
}

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
  /**
   * Loading fraction for each construction row (E3:E13), in the same order as
   * `lines`. Contingency plus the commercial markup, compounded — see
   * costsInternalLoading — so F/G land on the list price.
   */
  contingency: (CellSource | number)[];
  /** Loading fraction for the labor row (E18). */
  laborContingency: CellSource;
  /** Labor daily rate (K4, read by D18). */
  dailyRate: CellSource;
  /** Labor business days (K5, read by C18). */
  businessDays: CellSource;
  /** Construction PM row (D14): the CEO-basis construction PM (% of loaded
   * labour) plus the manual design / permitting PM hours. Kept out of the G15
   * construction subtotal — the source sums G3:G13 only. */
  constructionPm: CellSource;
  /** Loading fraction for the Construction PM row (E14). Always ours to
   * compute — it blends a marked-up CEO PM with un-marked-up design hours —
   * so it is a plain number, never a reference. */
  constructionPmLoading: number;
  /** True when a commercial markup is folded into the loading column. */
  includesMarkup?: boolean;
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
  /**
   * A cached value for a PERCENTAGE cell. Never round2 one of these: the
   * loading column runs to three decimals once markup is folded in (0.344 for
   * 12% contingency and a 20% markup) and 2dp would quietly turn it into 34%,
   * throwing every Final Cost below it off by half a percent.
   */
  const valPct = (s: CellSource): ExcelJS.CellValue =>
    s.cached !== undefined ? { formula: s.formula, result: s.cached } : { formula: s.formula };
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
  set("E2", spec.includesMarkup ? "Contingency + markup" : "Contingency", { ...banner, align: "center", numFmt: PCT });
  set("F2", spec.includesMarkup ? "List Price" : "Final Cost", { ...banner, align: "center", numFmt: MONEY });
  set("G2", "Total", { ...banner, align: "center", numFmt: MONEY, border: { right: M } });

  // ---- category rows 3–13 ---------------------------------------------------
  if (spec.contingency.length !== spec.lines.length) {
    throw new Error(`Costs Internal: ${spec.lines.length} lines but ${spec.contingency.length} loading fractions`);
  }
  spec.lines.forEach((line, i) => {
    const r = 3 + i;
    const cont = spec.contingency[i];
    const contValue = typeof cont === "number" ? cont : cont.cached;
    const loaded = line.cached !== undefined && contValue !== undefined ? line.cached * (1 + contValue) : undefined;
    set(`B${r}`, COSTS_INTERNAL_LABELS[i], { bold: true, fill: CATEGORY, border: { left: M } });
    set(`C${r}`, 1, { align: "center" });
    set(`D${r}`, val(line), { align: "center", numFmt: MONEY });
    set(`E${r}`, typeof cont === "number" ? cont : valPct(cont), { align: "center", numFmt: PCT });
    set(`F${r}`, derived(`(D${r}*E${r})+D${r}`, loaded), { align: "center", numFmt: MONEY });
    set(`G${r}`, derived(`F${r}*C${r}`, loaded), { align: "center", numFmt: MONEY, border: { right: M } });
  });

  // Row 14: Construction PM — design costs minus the AHJ plan check. Not part
  // of SUM(G3:G13): its dollars live on the Design invoice, shown here only.
  const pm = spec.constructionPm;
  const pmLoad = spec.constructionPmLoading;
  const pmLoaded = pm.cached !== undefined ? pm.cached * (1 + pmLoad) : undefined;
  set("B14", "Construction PM", { bold: true, fill: CATEGORY, border: { left: M } });
  set("C14", 1, { align: "center" });
  set("D14", val(pm), { align: "center", numFmt: MONEY });
  set("E14", pmLoad, { align: "center", numFmt: PCT });
  set("F14", derived("(D14*E14)+D14", pmLoaded), { align: "center", numFmt: MONEY });
  set("G14", derived("F14*C14", pmLoaded), { align: "center", numFmt: MONEY, border: { right: M } });

  // ---- construction subtotal band (row 15) ----------------------------------
  const contOf = (c: CellSource | number): number | undefined => (typeof c === "number" ? c : c.cached);
  const cachedBases =
    spec.lines.every((l) => l.cached !== undefined) && spec.contingency.every((c) => contOf(c) !== undefined)
      ? spec.lines.reduce((s, l, i) => s + (l.cached as number) * (1 + (contOf(spec.contingency[i]) as number)), 0)
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
  set("E18", valPct(labCont), { align: "center", numFmt: PCT });
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
