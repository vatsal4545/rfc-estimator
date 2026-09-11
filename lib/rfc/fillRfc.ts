// Fill the RFC / MSRP calculator workbook from a project.
//
// The same shape as the intake fill (verify → plan → patch → hand over the
// file): values are patched into a copy of the workbook, so its formulas,
// dropdowns, styles, defined names and column widths survive untouched, and
// Excel recalculates the whole file on open. The estimator's equipment,
// revenue inputs and internal costs go in; every other figure in the
// workbook is computed by the workbook itself.
//
// The cell-by-cell plan lives in plan.ts, the addresses in template.ts.

import type { EstimateResult, Project } from "../calc/types";
import { COSTS_INTERNAL_LABELS } from "../costsInternalSheet";
import type { RecalcReport } from "../recalc";
import { readWorkbook, type WorkbookCells } from "../intake/xlsx";
import { patchWorkbook } from "../intake/xlsxWrite";
import type { ProposalResult } from "../proposal/types";
import { crossCheckPriceBook, planRfcFill, type RfcEquipmentRow, type RfcFillOptions } from "./plan";
import { COSTS_INTERNAL, RFC_LANDMARKS, RFC_SHEETS, RFC_TEMPLATE } from "./template";

export { crossCheckPriceBook, planRfcFill, resolveStandInSku, type RfcEquipmentRow, type RfcFillOptions, type RfcFillPlan } from "./plan";

export interface RfcFillReport {
  template: string;
  /** Cells actually written. */
  filled: number;
  bySheet: Record<string, number>;
  /** One row per equipment line written to the INPUT SHEET. */
  equipment: RfcEquipmentRow[];
  leftBlank: string[];
  warnings: string[];
  /** Writes the workbook refused — should be empty. */
  refused: string[];
  /**
   * The recalculation that gave every formula cell its cached value. The
   * workbook derives almost everything it shows, so this — not `filled` — is
   * what any reader other than Excel actually sees.
   */
  recalc?: RecalcReport;
}

/**
 * Refuse to fill a workbook the cell map was not written for. There is no
 * Version sheet to gate on, so this asserts the structural landmarks the map
 * depends on: the INPUT SHEET item headers, the price book's columns, the
 * Costs Internal table (headers and all eleven row labels, in order) and the
 * revenue tab's app-aligned input block.
 */
export function verifyRfcTemplate(wb: WorkbookCells): void {
  const missing = Object.values(RFC_SHEETS).filter((name) => !wb.has(name));
  if (missing.length > 0) {
    throw new Error(
      `The RFC calculator template is missing ${missing.length === 1 ? "the sheet" : "the sheets"} ${missing.map((m) => `"${m}"`).join(", ")}. ` +
        `Replace public${RFC_TEMPLATE.publicPath} with the current workbook, or update lib/rfc/template.ts to match it.`,
    );
  }

  const problems: string[] = [];
  for (const l of RFC_LANDMARKS) {
    const got = wb.get(l.sheet, l.ref);
    const text = typeof got === "string" ? got.trim() : got === null ? "" : String(got);
    const ok = l.match === "prefix" ? text.startsWith(l.expect) : text === l.expect;
    if (!ok) problems.push(`${l.sheet}!${l.ref} should be "${l.expect}" but reads "${text}"`);
  }

  // The Costs Internal paste is positional, so its labels must still line up
  // with the engine's cost lines. The sheet spells one with a trailing space.
  COSTS_INTERNAL_LABELS.forEach((label, i) => {
    const ref = `B${COSTS_INTERNAL.firstLineRow + i}`;
    const got = wb.get(RFC_SHEETS.costs, ref);
    const text = typeof got === "string" ? got.trim() : "";
    if (text !== label) problems.push(`${RFC_SHEETS.costs}!${ref} should be "${label}" but reads "${text}"`);
  });

  if (problems.length > 0) {
    throw new Error(
      `The RFC calculator template does not match the app's cell map:\n  - ${problems.join("\n  - ")}\n` +
        `Replace public${RFC_TEMPLATE.publicPath} with the workbook this map was written for, or update lib/rfc/template.ts and lib/rfc/plan.ts to the new layout.`,
    );
  }
}

/** Fill the workbook (its bytes) from the project. Pure. */
export async function fillRfcWorkbook(
  template: ArrayBuffer | Uint8Array,
  project: Project,
  result: EstimateResult,
  proposal: ProposalResult | null,
  opts: RfcFillOptions = {},
): Promise<{ bytes: Uint8Array; report: RfcFillReport }> {
  const wb = await readWorkbook(template);
  verifyRfcTemplate(wb);

  const plan = planRfcFill(project, result, proposal, opts);
  // Verify the equipment against the workbook's own price book before we
  // hand the file over — the workbook derives the prices, so this is the
  // only place a divergence would otherwise go unnoticed.
  const priceWarnings = crossCheckPriceBook(wb, plan.equipment);

  const patched = await patchWorkbook(template, plan.writes);
  const bySheet: Record<string, number> = {};
  for (const w of plan.writes) bySheet[w.sheet] = (bySheet[w.sheet] ?? 0) + 1;

  return {
    bytes: patched.bytes,
    report: {
      template: RFC_TEMPLATE.label,
      filled: patched.written,
      bySheet,
      equipment: plan.equipment,
      leftBlank: plan.leftBlank,
      warnings: [...plan.warnings, ...priceWarnings, ...recalcWarnings(patched.recalc)],
      refused: patched.refused,
      recalc: patched.recalc,
    },
  };
}

/**
 * Anything about the recalculation a human should see. Errors are not
 * automatically wrong — the workbook itself shows #N/A for an unpriced SKU —
 * but a formula the engine could not evaluate is a gap in the export.
 */
function recalcWarnings(recalc: RecalcReport | undefined): string[] {
  if (!recalc) return [];
  const out: string[] = [];
  const unique = new Set(recalc.warnings.map((w) => w.message));
  for (const message of unique) {
    const first = recalc.warnings.find((w) => w.message === message)!;
    const count = recalc.warnings.filter((w) => w.message === message).length;
    out.push(`recalculation: ${message} (${first.sheet}!${first.ref}${count > 1 ? ` and ${count - 1} more` : ""})`);
  }
  return out;
}

export function rfcFileName(project: Project): string {
  const slug = (t: string) => t.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${slug(project.setup.clientName || "project")}-rfc-msrp-calculator.xlsx`;
}

/** The blank workbook shipped with the app (public/rfc). */
export async function fetchRfcTemplate(): Promise<ArrayBuffer> {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const res = await fetch(`${base}${RFC_TEMPLATE.publicPath}`);
  if (!res.ok) throw new Error(`Could not load the blank RFC calculator template (${res.status}).`);
  return res.arrayBuffer();
}

/** Browser helper: fill the workbook and hand the file to the user. */
export async function downloadRfc(
  project: Project,
  result: EstimateResult,
  proposal: ProposalResult | null,
  opts: RfcFillOptions = {},
): Promise<RfcFillReport> {
  const template = await fetchRfcTemplate();
  const { bytes, report } = await fillRfcWorkbook(template, project, result, proposal, opts);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = rfcFileName(project);
  a.click();
  URL.revokeObjectURL(url);
  return report;
}
