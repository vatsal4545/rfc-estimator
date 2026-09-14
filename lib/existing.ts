// The existing site — the CEO intake's Existing tab (1B · existing service,
// rip and replace, or replace and expand). Four project types since intake
// 3.6.0: a greenfield build with a new service; a greenfield build that adds
// its load to an existing service and switchboard (no chargers today); and
// the two replacement types where chargers exist. What is retained and what
// is replaced, the units coming out, the electrical infrastructure already in
// the ground, section I's capacity test of that infrastructure, up to
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

export type ProjectType = "greenfield" | "addLoad" | "replace" | "expand";
/** The intake's Existing!B5 dropdown, in its order. */
export const PROJECT_TYPE_TEXT: Record<ProjectType, string> = {
  greenfield: "Greenfield — new service",
  addLoad: "Greenfield — add load to existing service",
  replace: "Rip and replace — reuse infrastructure",
  expand: "Replace and expand — reuse plus new capacity",
};
export const PROJECT_TYPE_HINT: Record<ProjectType, string> = {
  greenfield: "Builds everything, including a new utility service. Only the project type applies on this tab.",
  addLoad: "No chargers today, but a service and switchboard that can take the new load. The register's service, feeder and switchgear rows, the existing infrastructure and the capacity test apply; the charger sections stand down.",
  replace: "Chargers exist today and are swapped on the existing infrastructure. Every section applies.",
  expand: "Chargers exist today; they are replaced and the site grows. Every section applies.",
};

/** Chargers exist on the site today — the register, units, history, uplifts and removal scope all apply. */
export const hasExistingChargers = (t: ProjectType): boolean => t === "replace" || t === "expand";
/** The site keeps an electrical service that must carry the new load — the infrastructure rows and section I apply. */
export const keepsExistingService = (t: ProjectType): boolean => t !== "greenfield";

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

/**
 * Section I · capacity of the existing service (intake 3.6.0 rows 188–201).
 * The three inputs; the verdicts are computed. Optional on stored bodies
 * written before 3.6.0 — read it through `capacityOf()`.
 */
export interface ExistingCapacity {
  /** Highest fifteen-minute demand on the last twelve months of interval data or bills (kW) — NEC 220.87. */
  peakDemandKw: number | null;
  /** A spare main-section breaker, section or tap position to land the new feeder. */
  gearSpaceForFeeder: "" | "Yes" | "No" | "Unknown";
  /** Adding load to an existing service is still an application with most utilities. */
  utilityNotified: "" | "Yes" | "No" | "Not required" | "Unknown";
}

export function defaultCapacity(): ExistingCapacity {
  return { peakDemandKw: null, gearSpaceForFeeder: "", utilityNotified: "" };
}

export const capacityOf = (x: Pick<ExistingInput, "capacity">): ExistingCapacity => ({ ...defaultCapacity(), ...x.capacity });

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
  /** Section I — the existing service's capacity for the new load (add-load and replacement sites). */
  capacity?: ExistingCapacity;
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
    capacity: defaultCapacity(),
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
  if (!t) return "greenfield";
  if (t.startsWith("greenfield")) return t.includes("add load") || t.includes("existing service") ? "addLoad" : "greenfield";
  if (t.includes("expand")) return "expand";
  return "replace";
}

/**
 * What choosing a project type implies elsewhere in the project, filled in
 * only where the field is still blank. An add-load site by definition keeps
 * its service, feeder and switchgear, connects at the existing switchgear
 * and is an added-load application with the utility — the intake's row 200
 * checks that the three tabs agree, so set them together.
 */
export function applyProjectType(project: Project, projectType: ProjectType): Project {
  const x: ExistingInput = { ...(project.existing ?? defaultExisting()), projectType };
  let next: Project = { ...project, existing: x };
  if (projectType !== "addLoad") return next;
  const register = { ...x.register };
  for (const k of ["service", "feeder", "switchgear"] as const) if (!register[k]) register[k] = "RETAIN";
  next = { ...next, existing: { ...x, register } };
  const ic = next.intake?.interconnection;
  if (next.intake && ic) {
    const patched = { ...ic };
    if (!patched.serviceType) patched.serviceType = "Added load to existing service";
    if (!patched.serviceFeederBy) patched.serviceFeederBy = "Existing — retained";
    if (!patched.pointOfConnection) patched.pointOfConnection = "Existing MSB";
    next = { ...next, intake: { ...next.intake, interconnection: patched } };
  }
  return next;
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

export interface CapacityResult {
  /** False on a greenfield build with a new service — nothing to test. */
  applies: boolean;
  newLoadKw: number;
  /** The new load at 125% (A) — the continuous-load rule; what the existing service has to have free. */
  newAmps125: number;
  peakDemandKw: number | null;
  /** The measured peak at 125% (A) — what NEC 220.87 takes the existing load to be. */
  demandAmps125: number;
  /** Which of the three answers the verdict rests on: measured demand, stated spare capacity, or the bare service size. */
  basis: string;
  /** Capacity available for the new load (A). */
  availableA: number;
  gearSpaceForFeeder: ExistingCapacity["gearSpaceForFeeder"];
  utilityNotified: ExistingCapacity["utilityNotified"];
  /** One line for the reviewer (Existing!B201 without the cross-tab check): OK, NOT YET, or n/a. */
  verdict: string;
  notes: string[];
}

export interface ExistingResult {
  projectType: ProjectType;
  /** Chargers exist today (rip and replace, replace and expand). */
  isReplacement: boolean;
  /** The site keeps a service the new load must fit on (add-load and replacement sites). */
  keepsService: boolean;
  register: { retained: number; replaced: number; scopeProfile: string; electricalProfile: string; constructionProfile: string };
  units: { count: number; ports: number; connectedKw: number; working: number; failed: number; unknown: number; powerPerPosition: number };
  checks: { serviceCarriesLoad: string; switchgearCarriesLoad: string; loadChange: string; reuseFeasible: string };
  capacity: CapacityResult;
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
  const isReplacement = hasExistingChargers(x.projectType);
  const keepsService = keepsExistingService(x.projectType);
  const addLoad = x.projectType === "addLoad";
  const decisions = RETAIN_ELEMENTS.map((e) => x.register[e.key]);
  const retained = decisions.filter((d) => d === "RETAIN").length;
  const replaced = decisions.filter((d) => d === "REPLACE" || d === "PARTIAL").length;
  const reg = x.register;
  const scopeProfile = addLoad
    ? "Add load to existing service — no new service, no new feeder; connect at the existing switchgear and price the distribution from there inward"
    : !isReplacement
      ? "Greenfield — the full electrical and civil scope is priced"
      : reg.service === "RETAIN"
        ? reg.feeder === "RETAIN"
          ? "Infrastructure reuse — no new service, no new feeder"
          : "Service retained, feeder replaced"
        : "New or upgraded service — price this as greenfield electrical";
  const electricalProfile = addLoad
    ? "EXISTING SERVICE — no new service and no service feeder; price the distribution from the existing switchgear inward and the full charger scope"
    : !isReplacement
      ? "GREENFIELD — price the full electrical scope"
      : reg.service === "RETAIN" && reg.branchConductors === "RETAIN" && reg.conduitTrench === "RETAIN"
        ? "CHARGER SWAP — electrical scope is breakers, terminations and commissioning only"
        : "PARTIAL — price the replaced elements; zero the retained lines on the takeoff";
  const constructionProfile = addLoad
    ? "GREENFIELD SITE WORKS ON AN EXISTING SERVICE — pads, trench and conduit from the existing switchgear; no service or transformer work"
    : !isReplacement
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

  // Section I — capacity of the existing service (Existing!B190–B201; rows
  // 60–61 and Electrical!B215 read it). Three ways to answer "does the
  // existing service carry the new load", in order of strength: the measured
  // peak demand at 125% (NEC 220.87), the spare capacity stated for the gear,
  // or the bare service size.
  const inf = x.infrastructure;
  const cap = capacityOf(x);
  const volts = n(inf.voltage) || ctx.serviceVoltage || 480;
  const amps125 = (kw: number) => (kw > 0 ? ((kw * 1000) / (volts * Math.sqrt(3))) * 1.25 : 0);
  const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
  const newAmps125 = amps125(ctx.newConnectedKw);
  const hasDemand = isNum(cap.peakDemandKw);
  const hasSpare = isNum(inf.spareA);
  const hasService = isNum(inf.serviceA);
  const demandAmps125 = hasDemand ? amps125(cap.peakDemandKw ?? 0) : 0;
  const basis = hasDemand ? "NEC 220.87 — measured peak demand" : hasSpare ? "Spare capacity stated for the gear" : hasService ? "Service size only — no existing-load data" : "no basis yet";
  // On a replacement the removed chargers give their current back to the spare capacity.
  const removedAmps = isReplacement && unitKw > 0 ? (unitKw * 1000) / (volts * Math.sqrt(3)) : 0;
  const availableA = !keepsService ? 0 : hasDemand ? Math.max(0, n(inf.serviceA) - demandAmps125) : hasSpare ? n(inf.spareA) + removedAmps : n(inf.serviceA);
  const serviceCarriesLoad = !keepsService
    ? "n/a — greenfield, there is no existing service"
    : newAmps125 === 0
      ? "enter the new equipment"
      : basis === "no basis yet"
        ? "enter the existing service size, its spare capacity or its peak demand"
        : newAmps125 <= availableA
          ? `OK — ${fmt(availableA)} A available against ${fmt(newAmps125)} A the new load needs at 125% (${basis})`
          : `UPGRADE NEEDED — ${fmt(newAmps125)} A required against ${fmt(availableA)} A available (${basis}). A new or enlarged service puts Rule 29 back in scope.`;
  const loadAlreadyOnFrame = hasSpare ? Math.max(0, n(inf.serviceA) - n(inf.spareA)) : 0;
  const switchgearCarriesLoad = !keepsService
    ? "n/a — greenfield, there is no existing gear"
    : !isNum(inf.frameA)
      ? "enter the existing frame as a number"
      : newAmps125 === 0
        ? "enter the new equipment"
        : hasDemand
          ? inf.frameA >= demandAmps125 + newAmps125
            ? `OK — the ${fmt(inf.frameA)} A frame carries the existing demand plus the new load at 125% (${fmt(demandAmps125 + newAmps125)} A)`
            : `UNDERSIZED — ${fmt(demandAmps125 + newAmps125)} A on a ${fmt(inf.frameA)} A frame. Replace the switchgear.`
          : inf.frameA >= newAmps125 + loadAlreadyOnFrame
            ? `OK — the ${fmt(inf.frameA)} A frame is adequate for the new load${hasSpare ? " on top of the load already on it" : ""}`
            : `UNDERSIZED — the ${fmt(inf.frameA)} A frame does not cover the new load at 125%${hasSpare ? ` plus the ${fmt(loadAlreadyOnFrame)} A already on it` : ""}. Replace the switchgear.`;
  const loadChange = addLoad
    ? `n/a — no existing chargers; the added load is ${fmt(ctx.newConnectedKw)} kW on top of the building load`
    : unitKw === 0 || ctx.newConnectedKw === 0
      ? "enter the existing equipment and the new equipment"
      : `${signed(ctx.newConnectedKw - unitKw)} kW (${signed(Math.round((ctx.newConnectedKw / unitKw - 1) * 100))}%) against the existing ${fmt(unitKw)} kW`;
  const reuseFeasible = !keepsService
    ? "n/a"
    : newAmps125 === 0 || basis === "no basis yet"
      ? "enter the existing service size and the new equipment"
      : newAmps125 <= availableA
        ? "OK — reuse is feasible on capacity grounds"
        : "NOT FEASIBLE on capacity — the new load exceeds what the existing service has free; price a new or upgraded service";
  const capacityNotes: string[] = [];
  if (keepsService && cap.gearSpaceForFeeder === "No") capacityNotes.push("No spare position on the existing gear for the new feeder — a section extension or a tap box goes on the distribution schedule.");
  if (keepsService && cap.gearSpaceForFeeder === "") capacityNotes.push("Space on the existing gear for the new feeder not yet answered.");
  if (keepsService && cap.utilityNotified === "No") capacityNotes.push("The utility has not been notified of the added load — most utilities treat it as an application even with no new service.");
  if (keepsService && cap.utilityNotified === "") capacityNotes.push("Utility notification of the added load not yet answered.");
  const capacityVerdict = !keepsService
    ? "n/a — greenfield, the service is priced new"
    : serviceCarriesLoad.startsWith("OK") && switchgearCarriesLoad.startsWith("OK")
      ? "OK — the existing service and switchgear carry the added load"
      : `NOT YET — ${[!serviceCarriesLoad.startsWith("OK") ? `service: ${serviceCarriesLoad}` : "", !switchgearCarriesLoad.startsWith("OK") ? `frame: ${switchgearCarriesLoad}` : ""].filter(Boolean).join("; ")}`;
  const capacity: CapacityResult = {
    applies: keepsService,
    newLoadKw: ctx.newConnectedKw,
    newAmps125,
    peakDemandKw: hasDemand ? cap.peakDemandKw : null,
    demandAmps125,
    basis: keepsService ? basis : "n/a",
    availableA,
    gearSpaceForFeeder: cap.gearSpaceForFeeder,
    utilityNotified: cap.utilityNotified,
    verdict: capacityVerdict,
    notes: capacityNotes,
  };

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
    keepsService,
    register: { retained, replaced, scopeProfile, electricalProfile, constructionProfile },
    units: { count: unitCount, ports: unitPorts, connectedKw: unitKw, working, failed, unknown, powerPerPosition: existingPowerPerPosition },
    checks: { serviceCarriesLoad, switchgearCarriesLoad, loadChange, reuseFeasible },
    capacity,
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
          ? "REMOVAL QUANTITIES ARE ENTERED ON A GREENFIELD PROJECT. Greenfield — new service or add-load — means there are no chargers on the site to remove — change the project type or clear the quantities."
          : null,
    },
  };
}

/** The removal lines as peripherals items (the engine prices them into Dump / Waste). Empty unless chargers exist today. */
export function removalItems(x: ExistingInput | undefined): CustomLineItem[] {
  if (!x || !hasExistingChargers(x.projectType)) return [];
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
