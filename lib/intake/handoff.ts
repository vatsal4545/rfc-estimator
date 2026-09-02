// The handoff to the CEO's process: which of the estimator's figures travel
// into the intake's override register, and how complete the intake-shaped
// tabs are before the workbook goes out.
//
// The register is the seam between the two systems. The intake derives its
// own electrical and civil costs from distances and RefData rates; a row in
// its Overrides tab forces that figure to a typed one, with the reason beside
// it, and the CEO's engine reports every active override on the model
// summary. So the estimator's construction and engineering numbers land
// there — in force, but never hidden.

import { SITE_WORKS_LINES } from "../calc/costs";
import type { EstimateResult, Project } from "../calc/types";
import { money, num } from "../format";
import { modelInputsOf } from "../proposal/defaults";
import type { ProposalResult } from "../proposal/types";
import { RATE_LIBRARY } from "../ref/rateLibrary";
import { OVERRIDE_ROWS } from "./cells";

export interface IntakeOverrideRow {
  /** Row on the intake's Overrides tab. */
  row: number;
  label: string;
  value: number;
  reason: string;
  /** "estimator": the engine's figure; "register": an entry someone typed on the Overrides tab, carried as is. */
  source: "estimator" | "register";
}

const ROW_LABELS: Record<number, string> = {
  9: "Wires, conduits and peripherals (before uplift)",
  10: "Switchgear and distribution (before uplift)",
  11: "Site works (before uplift)",
  12: "Dump, waste and freight (before uplift)",
  13: "Permits and plan check (before uplift)",
  14: "Utility application and contract fees (before uplift)",
  15: "Construction equipment rentals (before uplift)",
  16: "Design and engineering",
  17: "Rule 15/16 customer contribution (if triggered)",
  18: "Additional or unforeseen scope",
  19: "Standard frame (A)",
  20: "Branch breaker per cabinet (A)",
  21: "Crew days on site",
  22: "Steady-state kWh per day",
  23: "Gross capacity credit per year",
  24: "Monthly loan payment",
  25: "Hardware MSRP each",
  26: "Retail price to driver",
  27: "Delivered energy cost",
  28: "Utility demand / subscription",
};

/** Register keys → intake rows (the field-class and model-class entries travel as typed). */
const REGISTER_ROW: Record<string, number> = {
  "line:Wires, Conduits & Electrical Peripherals": OVERRIDE_ROWS.wires,
  "line:Main Distribution Switchgear": OVERRIDE_ROWS.switchgear,
  siteWorks: OVERRIDE_ROWS.siteWorks,
  "line:Dump / Waste": OVERRIDE_ROWS.dump,
  "line:Permits": OVERRIDE_ROWS.permits,
  "line:Utility": OVERRIDE_ROWS.utility,
  "line:Construction Equipment": OVERRIDE_ROWS.rentals,
  design: OVERRIDE_ROWS.design,
  switchgearA: OVERRIDE_ROWS.frameA,
  crewDays: OVERRIDE_ROWS.crewDays,
  kwhPerDay: OVERRIDE_ROWS.kwhPerDay,
  carbonGrossPerYear: OVERRIDE_ROWS.carbonGrossPerYear,
  loanPayment: OVERRIDE_ROWS.loanPayment,
  hardwareCost: OVERRIDE_ROWS.hardwareMsrpEach,
  retailPerKwh: OVERRIDE_ROWS.retailPerKwh,
  blendedPerKwh: OVERRIDE_ROWS.blendedPerKwh,
  fixedUtilityPerYear: OVERRIDE_ROWS.fixedUtilityPerYear,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The rows the filled intake's Overrides tab receives. With `carry` on, the
 * estimator's construction and engineering figures (before contingency and
 * markup — the same bases the app's Overrides tab shows as engine values) fill
 * rows 9–16 plus the frame and branch breaker; entries typed on the app's
 * own register travel too and win their row.
 */
export function estimatorOverrideRows(project: Project, result: EstimateResult, proposal: ProposalResult | null, carry = true): IntakeOverrideRow[] {
  const rows = new Map<number, IntakeOverrideRow>();
  const put = (row: number, value: number | undefined, reason: string, source: IntakeOverrideRow["source"] = "estimator") => {
    if (value === undefined || !Number.isFinite(value)) return;
    rows.set(row, { row, label: ROW_LABELS[row] ?? `Row ${row}`, value: round2(value), reason, source });
  };
  const base = (name: string) => result.costs.lines.find((l) => l.name === name)?.base ?? 0;
  const f = project.financial;
  const c = project.commercial;

  if (carry) {
    const r = result.rollups;
    put(OVERRIDE_ROWS.wires, base("Wires, Conduits & Electrical Peripherals"), `RFC Estimator take-off: ${num(r.totalConductorFt)} ft conductor, ${num(r.totalConduitFt)} ft conduit, peripherals — before contingency and markup`);
    const bus480 = result.panel.bus480;
    const bus208 = result.panel.bus208;
    const tx = result.panel.transformer;
    const gearBits = [
      bus480 ? `${num(bus480.suggestedBusA)} A 480 V switchgear` : "",
      tx ? `${num(tx.suggestedKva)} kVA step-down` : "",
      bus208 ? `${num(bus208.suggestedBusA)} A 208 V sub-panel` : "",
    ].filter(Boolean);
    put(
      OVERRIDE_ROWS.switchgear,
      base("Main Distribution Switchgear") + base("Electrical Sub-Panels, Transformers, Breakers"),
      `RFC Estimator gear catalog: ${gearBits.join(" + ") || "distribution gear"}, breakers — before markup`,
    );
    const siteWorks = SITE_WORKS_LINES.map((n) => [n, base(n)] as const);
    put(OVERRIDE_ROWS.siteWorks, siteWorks.reduce((s, [, v]) => s + v, 0), `RFC Estimator civil: ${siteWorks.map(([n, v]) => `${n.toLowerCase()} ${money(v)}`).join(", ")} — before markup`);
    const demolition = result.peripherals.lines.demolition.length;
    put(OVERRIDE_ROWS.dump, base("Dump / Waste"), `RFC Estimator: terrain-scaled spoils haul-off${demolition ? ` + ${demolition} removal line(s) from the existing installation` : ""}`);
    put(OVERRIDE_ROWS.permits, base("Permits") + f.planCheckPermitFee, `RFC Estimator: plan check ${money(f.planCheckPermitFee)} (valuation-based) + permit issuance ${money(base("Permits"))} — pass-through`);
    put(OVERRIDE_ROWS.utility, base("Utility"), "RFC Estimator: utility application fee — pass-through");
    put(OVERRIDE_ROWS.rentals, base("Construction Equipment"), `RFC Estimator: ${result.equipment.items.filter((i) => i.qty > 0).length} rental line(s), qty × rate × duration + delivery`);
    put(
      OVERRIDE_ROWS.design,
      result.costs.designAndEngineering,
      `RFC Estimator: site plan ${money(f.autoCadDesignCost)} + SLD / electrical ${money(f.electricalEngDesignCost)} + PM ${num(f.pmHours)} h × ${money(f.pmHourlyRate)} — before plan check`,
    );
    const frame = bus480 ?? bus208;
    if (frame) put(OVERRIDE_ROWS.frameA, frame.suggestedBusA, frame.overridden ? "Frame typed on the estimator (manual gear override)" : "RFC Estimator panel schedule: next standard frame at or above 125% of the continuous load (NEC 625.41/42)");
    const dcBreakers = [...new Set(result.rows.filter((row) => !row.synthetic && row.category === "DCFC" && row.ocpdA > 0).map((row) => row.ocpdA))];
    if (dcBreakers.length === 1) put(OVERRIDE_ROWS.branchBreakerA, dcBreakers[0], "RFC Estimator: branch breaker per DC unit (125% of circuit amps, next standard size)");
  }
  if (c && c.lineExtensionContribution && c.lineExtensionContribution > 0) put(OVERRIDE_ROWS.lineExtension, c.lineExtensionContribution, "Rules 15/16 contribution from the utility design — pass-through at cost");
  if (c && c.additionalScope > 0) put(OVERRIDE_ROWS.additionalScope, c.additionalScope, "Additional or unforeseen scope carried on the Commercial tab — pass-through");

  // Entries typed on the app's register travel as typed and win their row.
  const units = (project.quick?.lines ?? []).reduce((s, l) => s + Math.max(0, l.count), 0);
  for (const e of project.overrides ?? []) {
    if (!Number.isFinite(e.value)) continue;
    const row = REGISTER_ROW[e.key];
    if (!row) continue;
    const value = e.key === "hardwareCost" ? (units > 0 ? e.value / units : undefined) : e.value;
    const reason = [e.reason, e.source].filter(Boolean).join(" — ") || "Typed on the estimator's Overrides tab";
    put(row, value, reason, "register");
  }
  return [...rows.values()].sort((a, b) => a.row - b.row);
}

// ---------------------------------------------------------------------------
// Completeness — is the intake ready to send?
// ---------------------------------------------------------------------------

export interface SectionCheck {
  label: string;
  ok: boolean;
}

export interface SectionStatus {
  key: string;
  label: string;
  checks: SectionCheck[];
  filled: number;
  total: number;
  /** "empty" — nothing entered; "partial"; "done". */
  state: "empty" | "partial" | "done";
}

const has = (v: unknown) => v !== undefined && v !== null && v !== "" && !(typeof v === "number" && Number.isNaN(v));

export function intakeCompleteness(project: Project, result: EstimateResult, proposal: ProposalResult | null): SectionStatus[] {
  const it = project.intake;
  const s = project.setup;
  const q = project.quick;
  const c = project.commercial;
  const m = modelInputsOf(c);
  const lines = (q?.lines ?? []).filter((l) => l.count > 0);
  const ic = it?.interconnection;
  const tariff = proposal?.model.tariff;
  const libraryRow = RATE_LIBRARY.find((r) => r.utility === s.utility && r.schedule === (it?.rateSchedule ?? ""));
  const tariffOk = m.tariff.basis === "manual" ? m.tariff.manual.peakPerKwh > 0 : !!libraryRow && !/NOT PUBLISHED|PLACEHOLDER/i.test(libraryRow.status);

  const section = (key: string, label: string, checks: SectionCheck[]): SectionStatus => {
    const filled = checks.filter((x) => x.ok).length;
    return { key, label, checks, filled, total: checks.length, state: filled === 0 ? "empty" : filled === checks.length ? "done" : "partial" };
  };

  return [
    section("project", "1 · Project", [
      { label: "Client legal name", ok: has(s.clientName) },
      { label: "Site address", ok: has(s.siteAddress) },
      { label: "Client contact", ok: has(it?.contactName) },
      { label: "Property type", ok: has(it?.propertyType) },
      { label: "Public access", ok: has(it?.publicAccess) },
      { label: "Hours and days open", ok: has(it?.hoursOpen) && (has(it?.daysOpenPerYear) || has(it?.daysPerWeek)) },
      { label: "Delivery utility", ok: has(s.utility) },
      { label: "Rate schedule the site will take", ok: has(it?.rateSchedule) },
      { label: "Proposal date", ok: has(it?.proposalDate) },
      { label: "Prepared by (CPM)", ok: has(s.cpm) },
    ]),
    section("existing", "Existing", [
      { label: "Project type stated", ok: !!project.existing },
      { label: "History entered (replacement sites)", ok: project.existing ? project.existing.projectType === "greenfield" || project.existing.history.some((h) => has(h.kwh)) : false },
    ]),
    section("equipment", "2 · Equipment", [
      { label: "At least one charger line", ok: lines.length > 0 },
      { label: "Every line carries a price-book SKU", ok: lines.length > 0 && lines.every((l) => !!l.sku) },
      { label: "Estimate built", ok: project.takeoff.length > 0 },
      { label: "Scope of work sentence", ok: has(s.scopeOfWork) },
    ]),
    section("electrical", "3 · Electrical", [
      { label: "Run distances", ok: !!q && (q.firstRunFtDcfc > 0 || q.firstRunFtL2 > 0) },
      { label: "Conductor material and conduit", ok: has(s.feederMaterial) && has(s.conduitType) },
      { label: "Service type (new / added load)", ok: has(ic?.serviceType) },
      { label: "Who provides the service feeder", ok: has(ic?.serviceFeederBy) },
      { label: "Switchgear frame sized", ok: !!(result.panel.bus480 ?? result.panel.bus208) },
    ]),
    section("construction", "4 · Construction", [
      { label: "Crew days", ok: project.financial.laborBusinessDays > 0 },
      { label: "Crew day rate", ok: project.financial.laborDailyRate > 0 },
      { label: "Construction PM %", ok: has(project.financial.pmPctOfLabor) },
      { label: "Permit and utility fees", ok: project.peripherals.permitFeeTotal + project.financial.planCheckPermitFee > 0 && project.peripherals.utilityAppFee > 0 },
      { label: "Design and engineering", ok: result.costs.designAndEngineering > 0 },
    ]),
    section("commercial", "5 · Commercial", [
      { label: "Pricing set up", ok: !!c },
      { label: "Service contract terms", ok: !!c?.serviceTerms },
      { label: "Financing terms", ok: !m.financing.offered || (has(m.financing.lender) && m.financing.annualRate > 0) },
    ]),
    section("revenue", "6 · Revenue", [
      { label: "Retail price", ok: m.revenue.retailPerKwh > 0 },
      { label: "Utilisation assumptions", ok: m.revenue.stallOccupancy > 0 && m.revenue.chargingHoursShare > 0 },
      { label: "Tariff resolved (library row verified, or manual rates)", ok: tariffOk || (!!tariff && /^VERIFIED|^MANUAL/i.test(tariff.status)) },
      { label: "Rate figures sourced", ok: has(m.tariff.provenance.source) },
    ]),
    section("carbon", "7 · Carbon", [
      { label: "FCI eligibility stated", ok: has(m.carbon.qualifies) },
      { label: "Aggregator named", ok: has(m.carbon.aggregator) },
      { label: "Credit rate and period", ok: m.carbon.fciRatePerKwYear > 0 && m.carbon.creditingYears > 0 },
    ]),
    section("deal", "8 · Deal structure", [{ label: "Structure named (base case is fine)", ok: has(m.deal.name) }]),
    section("overrides", "9 · Overrides", [{ label: "Every register entry has a reason", ok: (project.overrides ?? []).every((o) => has(o.reason)) }]),
  ];
}
