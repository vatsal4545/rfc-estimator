// The existing installation on a replacement site — the CEO intake's Existing
// tab (1B · Rip and replace). What is retained and what is replaced, the units
// coming out, the electrical infrastructure already in the ground, up to
// thirty-six months of metered history, the port / connector / power uplifts
// with their capture factors, and the removal scope.
//
// Two things leave this module: the projected baseline (history × uplifts)
// that the business model uses instead of the greenfield utilisation build-up
// when the revenue basis is "historical actuals", and the removal cost lines
// that applyRemovalScope() writes into peripherals.demolitionItems so the
// engine prices them into the Dump / Waste line. The engine itself never
// reads this section.

import type { CustomLineItem, Project } from "./calc/types";

export type ProjectType = "greenfield" | "replace" | "expand";
export const PROJECT_TYPE_TEXT: Record<ProjectType, string> = {
  greenfield: "Greenfield — new service",
  replace: "Rip and replace — reuse infrastructure",
  expand: "Replace and expand — reuse plus new capacity",
};

export type RetainDecision = "" | "RETAIN" | "REPLACE" | "PARTIAL" | "NOT PRESENT";
export const RETAIN_DECISIONS: RetainDecision[] = ["", "RETAIN", "REPLACE", "PARTIAL", "NOT PRESENT"];

export const RETAIN_ELEMENTS = [
  { key: "service", label: "Utility service and meter", basis: "Existing service stays. No Rule 29 application, no new meter." },
  { key: "feeder", label: "Service feeder to switchgear", basis: "Conductor from the point of delivery to the switchboard." },
  { key: "switchgear", label: "Main distribution switchgear", basis: "Switchboard, main breaker and metering section." },
  { key: "branchConductors", label: "Branch conductors to each charger", basis: "The feeders from switchgear to cabinet. The single largest reuse saving." },
  { key: "conduitTrench", label: "Conduit and trench", basis: "Existing conduit reused; no re-trenching if the new cabinets land on the same pads." },
  { key: "branchBreakers", label: "Branch breakers", basis: "Sized to the new cabinet, not the old one. Usually cheap and always worth replacing." },
  { key: "pads", label: "Concrete pads", basis: "New cabinets rarely match the old footprint or anchor pattern." },
  { key: "bollards", label: "Bollards and equipment protection", basis: "Usually disturbed by pad removal." },
  { key: "paving", label: "Paving and striping", basis: "Reinstatement around the new pads only." },
  { key: "ada", label: "ADA stalls and route", basis: "Reused if the layout is unchanged and still compliant." },
  { key: "signage", label: "Signage", basis: "Network branding, pricing and connector types all change." },
  { key: "network", label: "Network and payment hardware", basis: "Integrated in the new cabinets." },
] as const;
export type RetainKey = (typeof RETAIN_ELEMENTS)[number]["key"];

export type UnitCondition = "" | "Working" | "Intermittent" | "Failed" | "Removed already" | "Unknown";

export interface ExistingUnit {
  makeModel: string;
  kw: number | null;
  ports: number | null;
  connectors: string;
  qty: number | null;
  yearInstalled: string;
  working: UnitCondition;
}

export interface HistoryMonth {
  /** YYYY-MM */
  month: string;
  kwh: number | null;
  revenue: number | null;
  sessions: number | null;
  utilityCost: number | null;
  portsWorking: number | null;
  note: string;
}

export const CONNECTOR_KEYS = ["nacs", "ccs1", "chademo", "j1772"] as const;
export type ConnectorKey = (typeof CONNECTOR_KEYS)[number];
export const CONNECTOR_LABELS: Record<ConnectorKey, string> = { nacs: "NACS / Tesla", ccs1: "CCS1", chademo: "CHAdeMO", j1772: "J1772 (Level 2)" };

export interface ConnectorRow {
  onExisting: boolean;
  onNew: boolean;
  /** Share of the local fleet this connector reaches. */
  fleetShare: number;
}

export interface RemovalScope {
  cabinets: number;
  pads: number;
  bollards: number;
  signs: number;
  disposalLoads: number;
  recycling: "" | "Yes" | "No" | "Unknown";
  hazmat: "" | "Yes" | "No" | "Unknown";
  temporaryCharging: "" | "Yes" | "No" | "Unknown";
  protectionDays: number;
}

/** Estimator unit rates for the removal scope — materials, equipment and disposal only; the crew's time is in the crew days. */
export interface RemovalRates {
  cabinet: number;
  pad: number;
  bollard: number;
  sign: number;
  disposalLoad: number;
  protectionDay: number;
}

export interface ExistingInput {
  projectType: ProjectType;
  ageYears: number | null;
  reason: string;
  owner: string;
  register: Record<RetainKey, RetainDecision>;
  units: ExistingUnit[];
  infrastructure: {
    serviceA: number | null;
    voltage: number | null;
    spareA: number | null;
    frameA: number | null;
    branchConductor: string;
    avgRunFt: number | null;
    conduit: string;
    rateSchedule: string;
    separatelyMetered: "" | "Yes" | "No" | "Unknown";
  };
  history: HistoryMonth[];
  connectors: Record<ConnectorKey, ConnectorRow>;
  /** Capture factors: how much of each theoretical uplift converts to energy sold (intake defaults). */
  capture: { availability: number; ports: number; connectors: number; power: number };
  removal: RemovalScope;
  removalRates: RemovalRates;
  /** Which projection the revenue model uses (intake Revenue!B59). */
  revenueBasis: "market" | "historical";
}

/**
 * Removal unit rates — what it costs to take the old installation out, apart
 * from the crew's time (0.5 crew day per cabinet and 0.75 per pad, indicative,
 * belong in the crew days). Rigging and haul-off for a cabinet; saw-cut,
 * break-out and the concrete's share of a disposal load for a pad; a 40-yd
 * roll-off for concrete and steel; barricades, cones and signage per day of a
 * live customer lot.
 */
export const DEFAULT_REMOVAL_RATES: RemovalRates = {
  cabinet: 350,
  pad: 400,
  bollard: 45,
  sign: 20,
  disposalLoad: 650,
  protectionDay: 185,
};

export function emptyRegister(): Record<RetainKey, RetainDecision> {
  return Object.fromEntries(RETAIN_ELEMENTS.map((e) => [e.key, ""])) as Record<RetainKey, RetainDecision>;
}

export function emptyUnit(): ExistingUnit {
  return { makeModel: "", kw: null, ports: null, connectors: "", qty: null, yearInstalled: "", working: "" };
}

export function emptyMonth(month = ""): HistoryMonth {
  return { month, kwh: null, revenue: null, sessions: null, utilityCost: null, portsWorking: null, note: "" };
}

export function defaultExisting(): ExistingInput {
  return {
    projectType: "greenfield",
    ageYears: null,
    reason: "",
    owner: "",
    register: emptyRegister(),
    units: [],
    infrastructure: {
      serviceA: null,
      voltage: null,
      spareA: null,
      frameA: null,
      branchConductor: "",
      avgRunFt: null,
      conduit: "",
      rateSchedule: "",
      separatelyMetered: "",
    },
    history: [],
    connectors: {
      nacs: { onExisting: false, onNew: true, fleetShare: 0 },
      ccs1: { onExisting: false, onNew: true, fleetShare: 0 },
      chademo: { onExisting: false, onNew: false, fleetShare: 0 },
      j1772: { onExisting: false, onNew: false, fleetShare: 0 },
    },
    capture: { availability: 0.85, ports: 0.4, connectors: 0.5, power: 0.25 },
    removal: { cabinets: 0, pads: 0, bollards: 0, signs: 0, disposalLoads: 0, recycling: "", hazmat: "", temporaryCharging: "", protectionDays: 0 },
    removalRates: { ...DEFAULT_REMOVAL_RATES },
    revenueBasis: "market",
  };
}

/** Project type from the intake's dropdown text. */
export function projectTypeFromText(text: string): ProjectType {
  const t = text.trim().toLowerCase();
  if (!t || t.startsWith("greenfield")) return "greenfield";
  if (t.includes("expand")) return "expand";
  return "replace";
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

export interface ExistingContext {
  /** The new equipment: total ports (all levels), DC positions, DC nameplate kW, connected kW. */
  newPorts: number;
  newDcPositions: number;
  newDcKw: number;
  newConnectedKw: number;
  /** Service voltage for the capacity checks (480 V for most DC sites). */
  serviceVoltage: number;
  /** Market benchmark for the plausibility check (null when no market chosen). */
  benchmarkUtilisation: number | null;
  benchmarkState: string;
}

export interface UpliftRow {
  key: "availability" | "ports" | "connectors" | "power";
  label: string;
  theoretical: number;
  capture: number;
  applied: number;
  basis: string;
}

export interface RemovalLine extends CustomLineItem {
  total: number;
}

export interface ExistingResult {
  projectType: ProjectType;
  isReplacement: boolean;
  register: { retained: number; replaced: number; scopeProfile: string; electricalProfile: string; constructionProfile: string };
  units: { count: number; ports: number; connectedKw: number; working: number; failed: number; unknown: number; powerPerPosition: number };
  checks: { serviceCarriesLoad: string; switchgearCarriesLoad: string; loadChange: string; reuseFeasible: string };
  history: {
    months: number;
    totalKwh: number;
    totalRevenue: number;
    totalSessions: number;
    totalUtility: number;
    kwhPerMonth: number;
    kwhPerDay: number;
    kwhPerYear: number;
    revenuePerYear: number;
    utilityPerYear: number;
    netBeforeFees: number;
    impliedRetailPerKwh: number;
    impliedDeliveredPerKwh: number;
    kwhPerSession: number;
    avgPortsWorking: number;
    availability: number;
  };
  coverage: { existing: number; afterReplacement: number; multiple: number };
  uplifts: UpliftRow[];
  combinedUplift: number;
  projectedKwhPerYear: number;
  projectedKwhPerDay: number;
  capacityCheck: string;
  projectionVsHistory: string;
  market: { impliedUtilisation: number; benchmarkUtilisation: number | null; shareOfBenchmark: number | null; verdict: string };
  /** What the revenue model will actually use. */
  basisInForce: string;
  historicalUsable: boolean;
  removal: { lines: RemovalLine[]; total: number; crewDays: number; phasedProgramme: string; greenfieldError: string | null };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const fmt = (v: number, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${fmt(Math.abs(v))}`;

export function computeExisting(x: ExistingInput, ctx: ExistingContext): ExistingResult {
  const isReplacement = x.projectType !== "greenfield";
  const decisions = RETAIN_ELEMENTS.map((e) => x.register[e.key]);
  const retained = decisions.filter((d) => d === "RETAIN").length;
  const replaced = decisions.filter((d) => d === "REPLACE" || d === "PARTIAL").length;
  const reg = x.register;
  const scopeProfile = !isReplacement
    ? "Greenfield — the full electrical and civil scope is priced"
    : reg.service === "RETAIN"
      ? reg.feeder === "RETAIN"
        ? "Infrastructure reuse — no new service, no new feeder"
        : "Service retained, feeder replaced"
      : "New or upgraded service — price this as greenfield electrical";
  const electricalProfile = !isReplacement
    ? "GREENFIELD — price the full electrical scope"
    : reg.service === "RETAIN" && reg.branchConductors === "RETAIN" && reg.conduitTrench === "RETAIN"
      ? "CHARGER SWAP — electrical scope is breakers, terminations and commissioning only"
      : "PARTIAL — price the replaced elements; zero the retained lines on the takeoff";
  const constructionProfile = !isReplacement
    ? "GREENFIELD — full site works"
    : reg.conduitTrench === "RETAIN"
      ? "PAD-AND-CHARGER SWAP — demolition, new pads, reinstatement and protection. No trenching, no paving beyond the pads."
      : "PARTIAL — trenching required for the replaced runs; reinstate what is opened";

  // Units coming out.
  const units = x.units.filter((u) => n(u.qty) > 0);
  const unitCount = sum(units.map((u) => n(u.qty)));
  const unitPorts = sum(units.map((u) => n(u.ports) * n(u.qty)));
  const unitKw = sum(units.map((u) => n(u.kw) * n(u.qty)));
  const working = sum(units.filter((u) => u.working === "Working").map((u) => n(u.qty)));
  const failed = sum(units.filter((u) => u.working === "Failed" || u.working === "Intermittent").map((u) => n(u.qty)));
  const unknown = sum(units.filter((u) => u.working === "Unknown" || u.working === "").map((u) => n(u.qty)));
  const dcUnits = units.filter((u) => n(u.kw) >= 30);
  const dcKw = sum(dcUnits.map((u) => n(u.kw) * n(u.qty)));
  const dcPorts = sum(dcUnits.map((u) => n(u.ports) * n(u.qty)));
  const existingPowerPerPosition = dcPorts > 0 ? dcKw / dcPorts : 0;

  // Capacity checks (Existing!B60-B62, Electrical!B82).
  const inf = x.infrastructure;
  const volts = n(inf.voltage) || ctx.serviceVoltage || 480;
  const newAmps125 = ctx.newConnectedKw > 0 ? ((ctx.newConnectedKw * 1000) / (volts * Math.sqrt(3))) * 1.25 : 0;
  const serviceCarriesLoad = !isReplacement
    ? "n/a — greenfield, there is no existing service"
    : n(inf.serviceA) === 0 || ctx.newConnectedKw === 0
      ? "enter the existing service size and the new equipment"
      : newAmps125 <= n(inf.serviceA)
        ? `OK — ${fmt(newAmps125)} A required at 125% against a ${fmt(n(inf.serviceA))} A service`
        : `UNDERSIZED — ${fmt(newAmps125)} A required at 125% against a ${fmt(n(inf.serviceA))} A service. A service upgrade puts Rule 29 back in scope.`;
  const switchgearCarriesLoad = !isReplacement
    ? "n/a — greenfield, there is no existing gear"
    : n(inf.frameA) === 0 || ctx.newConnectedKw === 0
      ? "enter the existing frame as a number and the new equipment"
      : newAmps125 <= n(inf.frameA)
        ? `OK — the ${fmt(n(inf.frameA))} A frame covers ${fmt(newAmps125)} A`
        : `UNDERSIZED — the ${fmt(n(inf.frameA))} A frame does not cover ${fmt(newAmps125)} A. Replace the switchgear.`;
  const loadChange =
    unitKw === 0 || ctx.newConnectedKw === 0
      ? "enter the existing equipment and the new equipment"
      : `${signed(ctx.newConnectedKw - unitKw)} kW (${signed(Math.round((ctx.newConnectedKw / unitKw - 1) * 100))}%) against the existing ${fmt(unitKw)} kW`;
  const reuseFeasible = !isReplacement
    ? "n/a"
    : n(inf.serviceA) === 0 || ctx.newConnectedKw === 0
      ? "enter the existing service size and the new equipment"
      : newAmps125 <= n(inf.serviceA)
        ? "OK — reuse is feasible on capacity grounds"
        : "NOT FEASIBLE on capacity — the new load exceeds the existing service; price a new or upgraded service";

  // History (section E) — only months carrying kWh count.
  const withKwh = x.history.filter((m) => m.kwh !== null && Number.isFinite(m.kwh));
  const months = withKwh.length;
  const totalKwh = sum(withKwh.map((m) => n(m.kwh)));
  const revenueMonths = x.history.filter((m) => m.revenue !== null && Number.isFinite(m.revenue));
  const utilityMonths = x.history.filter((m) => m.utilityCost !== null && Number.isFinite(m.utilityCost));
  const totalRevenue = sum(revenueMonths.map((m) => n(m.revenue)));
  const totalSessions = sum(x.history.map((m) => n(m.sessions)));
  const totalUtility = sum(utilityMonths.map((m) => n(m.utilityCost)));
  const kwhPerMonth = months > 0 ? totalKwh / months : 0;
  const kwhPerYear = kwhPerMonth * 12;
  const revenuePerYear = revenueMonths.length > 0 ? (totalRevenue / revenueMonths.length) * 12 : 0;
  const utilityPerYear = utilityMonths.length > 0 ? (totalUtility / utilityMonths.length) * 12 : 0;
  const portsMonths = x.history.filter((m) => m.portsWorking !== null && Number.isFinite(m.portsWorking));
  const avgPortsWorking = portsMonths.length > 0 ? sum(portsMonths.map((m) => n(m.portsWorking))) / portsMonths.length : 0;
  const availability = unitPorts > 0 ? avgPortsWorking / unitPorts : 0;
  const history = {
    months,
    totalKwh,
    totalRevenue,
    totalSessions,
    totalUtility,
    kwhPerMonth,
    kwhPerDay: (kwhPerYear / 365),
    kwhPerYear,
    revenuePerYear,
    utilityPerYear,
    netBeforeFees: revenuePerYear - utilityPerYear,
    impliedRetailPerKwh: totalKwh > 0 ? totalRevenue / totalKwh : 0,
    impliedDeliveredPerKwh: totalKwh > 0 ? totalUtility / totalKwh : 0,
    kwhPerSession: totalSessions > 0 ? totalKwh / totalSessions : 0,
    avgPortsWorking,
    availability,
  };

  // Section F — port expansion and connector coverage.
  const portMultiple = unitPorts === 0 || ctx.newPorts === 0 ? 1 : ctx.newPorts / unitPorts;
  const coverageExisting = sum(CONNECTOR_KEYS.filter((k) => x.connectors[k].onExisting).map((k) => x.connectors[k].fleetShare));
  const coverageNew = sum(CONNECTOR_KEYS.filter((k) => x.connectors[k].onNew).map((k) => x.connectors[k].fleetShare));
  const coverageMultiple = coverageExisting > 0 ? coverageNew / coverageExisting : 1;
  const newPowerPerPosition = ctx.newDcPositions > 0 ? ctx.newDcKw / ctx.newDcPositions : 0;
  const powerMultiple = existingPowerPerPosition === 0 || newPowerPerPosition === 0 ? 1 : Math.min(2, newPowerPerPosition / existingPowerPerPosition);
  const availabilityMultiple = availability > 0 ? 1 / availability : 1;

  const uplift = (key: UpliftRow["key"], label: string, theoretical: number, capture: number, basis: string): UpliftRow => ({
    key,
    label,
    theoretical,
    capture,
    applied: 1 + (theoretical - 1) * capture,
    basis,
  });
  const uplifts: UpliftRow[] = [
    uplift("availability", "Availability recovered", availabilityMultiple, x.capture.availability, "Ports that were dark now work. The most defensible uplift — the demand was already there and was turned away."),
    uplift("ports", "Ports added", portMultiple, x.capture.ports, "More positions capture more simultaneous arrivals, but a second position does not double demand — it shortens the queue."),
    uplift("connectors", "Connector coverage widened", coverageMultiple, x.capture.connectors, "Vehicles that could not charge here now can. Capture is below one because some of those drivers were already served nearby."),
    uplift("power", "Higher delivered power", powerMultiple, x.capture.power, "Faster sessions free the stall sooner. Only converts to energy where demand is waiting for a stall."),
  ];
  const combinedUplift = uplifts.reduce((p, u) => p * u.applied, 1);
  const projectedKwhPerYear = kwhPerYear * combinedUplift;
  const projectedKwhPerDay = projectedKwhPerYear / 365;
  const capacityKwhPerDay = 24 * ctx.newDcKw * 0.7;
  const impliedUtilisation = capacityKwhPerDay > 0 ? projectedKwhPerDay / capacityKwhPerDay : 0;
  const capacityCheck =
    projectedKwhPerYear === 0 || ctx.newDcKw === 0
      ? "enter history and the new equipment"
      : impliedUtilisation > 0.35
        ? `TOO HIGH — the projection implies ${fmt(impliedUtilisation * 100, 1)}% port-time utilisation, more than 35%. Reduce a capture factor.`
        : `OK — implies ${fmt(impliedUtilisation * 100, 1)}% port-time utilisation of the new capacity`;
  const projectionVsHistory =
    kwhPerYear === 0 ? "enter history" : `${combinedUplift.toFixed(2)}× the historical run rate — ${signed(projectedKwhPerYear - kwhPerYear)} kWh a year`;
  const shareOfBenchmark = ctx.benchmarkUtilisation ? impliedUtilisation / ctx.benchmarkUtilisation : null;
  const marketVerdict =
    impliedUtilisation === 0
      ? "no projection yet — enter the history and the new equipment"
      : !ctx.benchmarkUtilisation
        ? "no benchmark chosen — this projection is untested"
        : shareOfBenchmark! > 1
          ? `ABOVE THE MARKET — ${fmt(shareOfBenchmark! * 100)}% of the average ${ctx.benchmarkState} port. A replacement can transform a site, but it cannot beat the market without a reason you can name.`
          : `OK — ${fmt(shareOfBenchmark! * 100)}% of the average ${ctx.benchmarkState} port`;

  const historicalUsable = isReplacement && months >= 12 && projectedKwhPerYear > 0;
  const basisInForce =
    x.revenueBasis === "historical"
      ? historicalUsable
        ? `HISTORICAL — ${months} months of data, projecting ${fmt(projectedKwhPerYear)} kWh a year (${combinedUplift.toFixed(2)}× the run rate)`
        : months > 0
          ? `HISTORICAL SELECTED BUT ONLY ${months} MONTH(S) OF DATA — twelve is the minimum; the greenfield build-up is in force`
          : "HISTORICAL SELECTED WITH NO HISTORY ENTERED — the greenfield build-up is in force"
      : isReplacement && months >= 12
        ? "MARKET BENCHMARK on a replacement site with history — you are throwing away your best evidence"
        : "Market benchmark — greenfield build-up";

  // Section H — removal.
  const r = x.removal;
  const rates = x.removalRates;
  const line = (name: string, qty: number, unitCost: number): RemovalLine => ({ name, qty, unitCost, total: qty * unitCost });
  const lines = isReplacement
    ? [
        line("Removal — cabinets disconnected, rigged and hauled", n(r.cabinets), rates.cabinet),
        line("Removal — concrete pads saw-cut and broken out", n(r.pads), rates.pad),
        line("Removal — bollards", n(r.bollards), rates.bollard),
        line("Removal — signage", n(r.signs), rates.sign),
        line("Disposal loads — concrete and steel to a licensed facility", n(r.disposalLoads), rates.disposalLoad),
        line("Site protection and traffic control (days)", n(r.protectionDays), rates.protectionDay),
      ].filter((l) => l.qty > 0)
    : [];
  const removalQty = n(r.cabinets) + n(r.pads) + n(r.bollards) + n(r.signs) + n(r.disposalLoads);
  return {
    projectType: x.projectType,
    isReplacement,
    register: { retained, replaced, scopeProfile, electricalProfile, constructionProfile },
    units: { count: unitCount, ports: unitPorts, connectedKw: unitKw, working, failed, unknown, powerPerPosition: existingPowerPerPosition },
    checks: { serviceCarriesLoad, switchgearCarriesLoad, loadChange, reuseFeasible },
    history,
    coverage: { existing: coverageExisting, afterReplacement: coverageNew, multiple: coverageMultiple },
    uplifts,
    combinedUplift,
    projectedKwhPerYear,
    projectedKwhPerDay,
    capacityCheck,
    projectionVsHistory,
    market: { impliedUtilisation, benchmarkUtilisation: ctx.benchmarkUtilisation, shareOfBenchmark, verdict: marketVerdict },
    basisInForce,
    historicalUsable,
    removal: {
      lines,
      total: sum(lines.map((l) => l.total)),
      crewDays: isReplacement ? Math.round(n(r.cabinets) * 0.5 + n(r.pads) * 0.75) : 0,
      phasedProgramme:
        r.temporaryCharging === "Yes"
          ? "PHASED PROGRAMME REQUIRED — temporary charging is not in the standard scope and must be priced separately"
          : r.temporaryCharging === "No"
            ? "OK — the site can go dark during the works"
            : "not yet answered",
      greenfieldError:
        !isReplacement && removalQty > 0
          ? "REMOVAL QUANTITIES ARE ENTERED ON A GREENFIELD PROJECT. Greenfield means there is nothing on the site to remove — change the project type or clear the quantities."
          : null,
    },
  };
}

/** The removal lines as peripherals items (the engine prices them into Dump / Waste). Empty on a greenfield project. */
export function removalItems(x: ExistingInput | undefined): CustomLineItem[] {
  if (!x || x.projectType === "greenfield") return [];
  return computeExisting(x, EMPTY_CONTEXT).removal.lines.map(({ name, qty, unitCost }) => ({ name, qty, unitCost }));
}

const EMPTY_CONTEXT: ExistingContext = {
  newPorts: 0,
  newDcPositions: 0,
  newDcKw: 0,
  newConnectedKw: 0,
  serviceVoltage: 480,
  benchmarkUtilisation: null,
  benchmarkState: "",
};

/**
 * Write the removal scope into peripherals.demolitionItems so Total Cost
 * carries it. Idempotent; a greenfield project (or no Existing section)
 * clears the items. Returns the project untouched when nothing changes.
 */
export function applyRemovalScope(project: Project): Project {
  const items = removalItems(project.existing);
  const current = project.peripherals.demolitionItems ?? [];
  if (JSON.stringify(items) === JSON.stringify(current)) return project;
  const peripherals = { ...project.peripherals };
  if (items.length === 0) delete peripherals.demolitionItems;
  else peripherals.demolitionItems = items;
  return { ...project, peripherals };
}
