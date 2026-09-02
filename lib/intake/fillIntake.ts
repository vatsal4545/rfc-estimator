// Fill the CEO's EVSE Project Intake 2.9.0 from a project.
//
// The client does not fill the intake — we do, from the estimate. Every blue
// cell the estimator knows is written into a copy of the blank template
// (values only; the template's formulas, checks, dropdowns and comments are
// untouched), and the estimator's construction and engineering figures go
// into the intake's own Overrides register with their reasons. The CEO opens
// the file they know, every green check recalculates, and their engine prices
// the job on the estimator's numbers with the intake's derivation visible
// beside them. What the estimator does not model is reported so a human can
// finish those cells. The cell-by-cell plan lives in plan.ts.

import type { EstimateResult, Project } from "../calc/types";
import type { ProposalResult } from "../proposal/types";
import { INTAKE_TEMPLATE, VERSION_CELLS } from "./cells";
import type { IntakeOverrideRow } from "./handoff";
import { planIntakeFill, type IntakeFillOptions } from "./plan";
import { readWorkbook, type WorkbookCells } from "./xlsx";
import { patchWorkbook } from "./xlsxWrite";

export { capacityForLoadType, planIntakeFill, splitAddress, type IntakeFillOptions, type IntakeFillPlan } from "./plan";

export interface IntakeFillReport {
  templateVersion: string;
  fileVersion: string;
  /** Cells written. */
  filled: number;
  bySheet: Record<string, number>;
  overrides: IntakeOverrideRow[];
  leftBlank: string[];
  warnings: string[];
  /** Writes the template refused (a formula cell) — should be empty. */
  refused: string[];
}

/** Refuse to fill a template the cell map was not written for. */
export function verifyIntakeTemplate(wb: WorkbookCells): { version: string; contentHash: string } {
  const version = String(wb.get("Version", VERSION_CELLS.templateVersion) ?? "");
  const contentHash = String(wb.get("Version", VERSION_CELLS.contentHash) ?? "");
  if (version !== INTAKE_TEMPLATE.version || contentHash !== INTAKE_TEMPLATE.contentHash) {
    throw new Error(
      `Intake template ${version || "?"} (hash ${contentHash || "none"}) does not match the app's cell map for ${INTAKE_TEMPLATE.version} (${INTAKE_TEMPLATE.contentHash}). Run npm run refdata on the new template and update lib/intake/cells.ts before filling it.`,
    );
  }
  return { version, contentHash };
}

/** Fill a blank intake template (its bytes) from the project. Pure apart from the date. */
export async function fillIntakeWorkbook(
  template: ArrayBuffer | Uint8Array,
  project: Project,
  result: EstimateResult,
  proposal: ProposalResult | null,
  opts: IntakeFillOptions = {},
): Promise<{ bytes: Uint8Array; report: IntakeFillReport }> {
  verifyIntakeTemplate(await readWorkbook(template));
  const plan = planIntakeFill(project, result, proposal, opts);
  const patched = await patchWorkbook(template, plan.writes);
  const bySheet: Record<string, number> = {};
  for (const w of plan.writes) bySheet[w.sheet] = (bySheet[w.sheet] ?? 0) + 1;
  return {
    bytes: patched.bytes,
    report: {
      templateVersion: INTAKE_TEMPLATE.version,
      fileVersion: plan.fileVersion,
      filled: patched.written,
      bySheet,
      overrides: plan.overrides,
      leftBlank: plan.leftBlank,
      warnings: plan.warnings,
      refused: patched.refused,
    },
  };
}

export function intakeFileName(project: Project): string {
  const slug = (t: string) => t.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${slug(project.setup.clientName || "project")}-evse-intake-${INTAKE_TEMPLATE.version}-${slug(project.intake?.fileVersion || "Rev A")}.xlsx`;
}

/** The blank template shipped with the app (public/intake). */
export async function fetchIntakeTemplate(): Promise<ArrayBuffer> {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const res = await fetch(`${base}${INTAKE_TEMPLATE.publicPath}`);
  if (!res.ok) throw new Error(`Could not load the blank intake template (${res.status}).`);
  return res.arrayBuffer();
}

/** Browser helper: fill the template and hand the file to the user. */
export async function downloadIntake(project: Project, result: EstimateResult, proposal: ProposalResult | null, opts: IntakeFillOptions = {}): Promise<IntakeFillReport> {
  const template = await fetchIntakeTemplate();
  const { bytes, report } = await fillIntakeWorkbook(template, project, result, proposal, opts);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = intakeFileName(project);
  a.click();
  URL.revokeObjectURL(url);
  return report;
}
