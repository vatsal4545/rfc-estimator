// The override register — the intake's Overrides tab and the Best Western
// model's Overrides sheet. "Type a number only when you know better than the
// engine — a vendor quote, an AHJ fee schedule, a field measurement. Leave it
// blank and the model uses its own number. An override with no reason is
// indistinguishable from a typo six months later."
//
// Three classes of key:
//   engine — replace a cost-line base, the site-works total or D&E inside
//            computeCosts (Total Cost moves); see engineOverridesOf in costs.ts
//   model  — replace a business-model figure inside computeModel
//   field  — write the value through to the field it names (crew days, the
//            switchgear frame, the hardware cost, the retail price), so the
//            rest of the app sees a typed field with the reason on record

import { COST_LINE_NAMES } from "./calc/costs";
import type { OverrideEntry, Project } from "./calc/types";
import type { ModelOverrides } from "./proposal/types";
import { modelInputsOf } from "./proposal/defaults";

export { engineOverridesOf } from "./calc/costs";

export type OverrideClass = "engine" | "model" | "field";

export interface OverrideSpec {
  key: string;
  label: string;
  units: string;
  cls: OverrideClass;
  hint: string;
}

export const OVERRIDE_SPECS: OverrideSpec[] = [
  ...COST_LINE_NAMES.map((name) => ({
    key: `line:${name}`,
    label: `${name} — base, before contingency and markup`,
    units: "$",
    cls: "engine" as const,
    hint:
      name === "Main Distribution Switchgear"
        ? "Vendor quote for the switchboard, before markup — use it when the board is quoted rather than taken from the frame schedule"
        : name === "Wires, Conduits & Electrical Peripherals"
          ? "Contractor take-off or a materials quote"
          : name === "Permits"
            ? "AHJ fee schedule — verify locally"
            : name === "Utility"
              ? "Utility application worksheet"
              : name === "Construction Equipment"
                ? "Rental house quote"
                : name === "Dump / Waste"
                  ? "Hauler quote"
                  : "Civil subcontractor quote",
  })),
  { key: "siteWorks", label: "Site works total — striping, paving, concrete, ADA (before uplift)", units: "$", cls: "engine", hint: "One civil quote covering the four site-works lines; the engine rescales them to match" },
  { key: "design", label: "Design and engineering (before plan check)", units: "$", cls: "engine", hint: "Fixed-unit D&E where the sets and hours differ from the Financials tab" },
  { key: "crewDays", label: "Crew days on site", units: "days", cls: "field", hint: "Must match the construction schedule you publish — written to the Financials tab" },
  { key: "switchgearA", label: "Main switchgear frame (A)", units: "A", cls: "field", hint: "Engineering may rule differently, or load management may reduce it — written to the gear override" },
  { key: "hardwareCost", label: "Charger hardware cost, total", units: "$", cls: "field", hint: "A dealer quote in place of the price book — written to the Financials tab (manual)" },
  { key: "retailPerKwh", label: "Retail price to driver", units: "$/kWh", cls: "field", hint: "Pricing committee decision — written to the Business model tab" },
  { key: "kwhPerDay", label: "Steady-state kWh per day", units: "kWh", cls: "model", hint: "Force a throughput figure from a traffic study or a comparable site" },
  { key: "carbonGrossPerYear", label: "Gross capacity credit per year", units: "$", cls: "model", hint: "Force the figure the aggregator confirms in writing" },
  { key: "loanPayment", label: "Loan payment per period", units: "$", cls: "model", hint: "Force the lender quote if it differs from the computed PMT" },
  { key: "blendedPerKwh", label: "Delivered energy cost", units: "$/kWh", cls: "model", hint: "Twelve months of billing beats any tariff estimate" },
  { key: "fixedUtilityPerYear", label: "Utility demand / subscription, fixed cost per year", units: "$/yr", cls: "model", hint: "The subscription and demand charges the utility actually bills, per year" },
];

export function overrideSpec(key: string): OverrideSpec | undefined {
  return OVERRIDE_SPECS.find((s) => s.key === key);
}

/** The register's business-model figures, keyed for computeModel. */
export function modelOverridesOf(entries?: OverrideEntry[]): ModelOverrides | undefined {
  if (!entries?.length) return undefined;
  const out: ModelOverrides = {};
  for (const e of entries) {
    if (!Number.isFinite(e.value)) continue;
    switch (e.key) {
      case "kwhPerDay":
        out.kwhPerDay = e.value;
        break;
      case "carbonGrossPerYear":
        out.carbonGrossPerYear = e.value;
        break;
      case "loanPayment":
        out.loanPayment = e.value;
        break;
      case "blendedPerKwh":
        out.blendedPerKwh = e.value;
        break;
      case "fixedUtilityPerYear":
        out.fixedUtilityPerYear = e.value;
        break;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** What a field-class override currently reads in the project. */
export function fieldValue(project: Project, key: string): number | undefined {
  switch (key) {
    case "crewDays":
      return project.financial.laborBusinessDays;
    case "switchgearA":
      return project.setup.gearOverrides?.switchgear480A;
    case "hardwareCost":
      return project.financial.chargerHardwareCost;
    case "retailPerKwh":
      return modelInputsOf(project.commercial).revenue.retailPerKwh;
    default:
      return undefined;
  }
}

/**
 * Write every field-class override through to the field it names. Idempotent;
 * returns the project untouched when every field already carries its value.
 */
export function applyFieldOverrides(project: Project): Project {
  let next = project;
  for (const e of project.overrides ?? []) {
    if (!Number.isFinite(e.value)) continue;
    switch (e.key) {
      case "crewDays":
        if (next.financial.laborBusinessDays !== e.value) next = { ...next, financial: { ...next.financial, laborBusinessDays: e.value } };
        break;
      case "switchgearA":
        if (next.setup.gearOverrides?.switchgear480A !== e.value)
          next = { ...next, setup: { ...next.setup, gearOverrides: { ...next.setup.gearOverrides, switchgear480A: e.value } } };
        break;
      case "hardwareCost":
        if (next.financial.chargerHardwareCost !== e.value || next.financial.chargerHardwareCostIsAuto !== false)
          next = { ...next, financial: { ...next.financial, chargerHardwareCost: e.value, chargerHardwareCostIsAuto: false } };
        break;
      case "retailPerKwh": {
        if (!next.commercial) break;
        const revenue = modelInputsOf(next.commercial).revenue;
        if (revenue.retailPerKwh !== e.value) next = { ...next, commercial: { ...next.commercial, revenue: { ...revenue, retailPerKwh: e.value } } };
        break;
      }
    }
  }
  return next;
}

/** Field-class entries whose field has since been edited to a different value. */
export function fieldOverrideDrift(project: Project): { entry: OverrideEntry; current: number | undefined }[] {
  return (project.overrides ?? [])
    .filter((e) => overrideSpec(e.key)?.cls === "field")
    .map((entry) => ({ entry, current: fieldValue(project, entry.key) }))
    .filter(({ entry, current }) => current !== undefined && Math.abs(current - entry.value) > 1e-9);
}

export function activeOverrideCount(project: Pick<Project, "overrides">): number {
  return (project.overrides ?? []).filter((e) => Number.isFinite(e.value)).length;
}

/** Add or replace the entry for a key; a null value removes it. */
export function setOverride(entries: OverrideEntry[] | undefined, key: string, patch: { value?: number | null; reason?: string; source?: string }): OverrideEntry[] | undefined {
  const list = [...(entries ?? [])];
  const idx = list.findIndex((e) => e.key === key);
  if (patch.value === null) {
    if (idx >= 0) list.splice(idx, 1);
    return list.length ? list : undefined;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...(patch.value !== undefined ? { value: patch.value } : {}), ...(patch.reason !== undefined ? { reason: patch.reason } : {}), ...(patch.source !== undefined ? { source: patch.source } : {}) };
  } else {
    if (patch.value === undefined) return entries;
    list.push({ id: `ov-${key}`, key, value: patch.value, reason: patch.reason ?? "", source: patch.source ?? "", date: today });
  }
  return list;
}
