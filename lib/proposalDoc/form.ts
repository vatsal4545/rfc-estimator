// The proposal form's field rules: which widget, what goes in the box, and
// what comes back out.
//
// These are pure so they can be tested without a browser or a Python runtime.
// The precedence rule in particular is worth pinning down: it decides whose
// client name ends up on a customer-facing document.

import type { Project } from "../calc/types";
import type { OperatorInputSpec } from "./runtime";

/**
 * The widget for a declared input. field_map.yaml does not say, because the
 * desktop GUI infers it from the default and the format; do the same rather
 * than keeping a second list in sync with the YAML.
 */
export type Widget = "text" | "textarea" | "date" | "integer" | "number" | "percent";

export function widgetFor(spec: OperatorInputSpec): Widget {
  if (spec.token === "proposal_date") return "date";
  if (spec.token === "site_location_narrative") return "textarea";
  if (spec.format?.startsWith("percent")) return "percent";
  if (spec.token.endsWith("_kw")) return "number";
  if (typeof spec.default === "number") return Number.isInteger(spec.default) ? "integer" : "number";
  if (spec.token.startsWith("existing_ports")) return "integer";
  return "text";
}

/** Title-case the token when field_map gives no prompt of its own. */
export function labelFor(spec: OperatorInputSpec): string {
  if (spec.prompt) return spec.prompt;
  return spec.token
    .replace(/_/g, " ")
    .replace(/\bl2\b/gi, "L2")
    .replace(/\bl3\b/gi, "L3")
    .replace(/\bkw\b/gi, "kW")
    .replace(/^./, (c) => c.toUpperCase());
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * What 1 · Project already knows, keyed by the proposal's own token names.
 *
 * The desktop app reads these from the workbook's client-info block
 * (INPUT SHEET N17:N21), which the estimator's own export leaves empty — it
 * has no reason to write cells it never reads back. The details live in the
 * intake instead, so there is no sense retyping them here.
 *
 * Empty strings and nulls are dropped rather than passed through, so a field
 * nobody filled in falls through to the declared default.
 */
export function projectPrefills(project: Project): Record<string, string> {
  const intake = project.intake;
  const setup = project.setup;
  const out: Record<string, string> = {};
  const put = (token: string, value: unknown) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (text !== "") out[token] = text;
  };

  put("client_contact_name", intake?.contactName);
  put("client_title", intake?.contactTitle);
  // Site name is its own intake field, falling back to the client — the two
  // are the same thing on most projects, and Client is the one always filled.
  put("site_name", intake?.siteName || setup?.clientName);
  put("site_address", setup?.siteAddress);
  put("property_type", intake?.propertyType);
  put("proposal_date", intake?.proposalDate);
  put("validity_days", intake?.validityDays);
  // "Prepared by" is whoever completed the intake, else the project's CPM.
  put("prepared_by_name", intake?.completedBy || setup?.cpm);
  return out;
}

/**
 * What goes in the box before the user types.
 *
 * Order: the workbook's own client-info block, then 1 · Project, then the
 * declared default. The workbook comes first deliberately — an imported
 * workbook that names its own client is describing a site that may not be the
 * one open in the estimator, and quietly relabelling someone else's proposal
 * with this project's client would be a bad way to find that out. In practice
 * the estimator's export leaves that block empty, so the intake fills
 * everything.
 */
export function initialValue(
  spec: OperatorInputSpec,
  workbookRaw: Record<string, unknown>,
  fromProject: Record<string, string>,
): string {
  const asPercent = widgetFor(spec) === "percent";
  const workbook = workbookRaw[spec.token];
  if (workbook !== undefined && workbook !== null && workbook !== "") {
    return asPercent ? String(Number(workbook) * 100) : String(workbook);
  }
  const project = fromProject[spec.token];
  if (project !== undefined) return asPercent ? String(Number(project) * 100) : project;
  if (spec.default === "today") return todayIso();
  if (spec.default === undefined) return "";
  return asPercent ? String(Number(spec.default) * 100) : String(spec.default);
}

/**
 * Form strings back to what the Python side expects. An empty box is
 * `undefined`, which the caller drops — the agent then leaves the placeholder
 * blank rather than printing a guess.
 */
export function coerce(spec: OperatorInputSpec, value: string): unknown {
  const widget = widgetFor(spec);
  if (value.trim() === "") return undefined;
  if (widget === "percent") {
    const n = Number(value);
    return Number.isFinite(n) ? n / 100 : undefined;
  }
  if (widget === "integer" || widget === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return value;
}
