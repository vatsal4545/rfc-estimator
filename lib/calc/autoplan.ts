// Quick Estimate auto-planner: expands a charger list + a few site facts
// into a complete Project — takeoff runs, service chain, gear, civil
// quantities, design services, permits, scanning, labor and equipment
// durations — so a non-technical user gets a defensible number in one step.
//
// Every derived value lands in a normal editable field on the detail tabs;
// nothing here is a hidden adder. Dollar defaults are budgetary allowances
// (2025-26 US / California market) meant to be overridden with real quotes.

import { computeEstimate } from "./engine";
import { generateTakeoffRows } from "./quickstart";
import { findLoadType } from "./tables";
import type {
  EstimateResult,
  LoadType,
  Project,
  QuickEstimateInput,
  Terrain,
} from "./types";

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export interface TerrainInfo {
  label: string;
  /** Multiplies the $40.81/ft flat-lot trenching baseline. */
  trenchFactor: number;
  /** Multiplies the estimated construction labor days. */
  laborFactor: number;
  /** $/trench-ft allowance for spoils haul-off & dump fees. */
  spoilsPerFt: number;
  /**
   * Multiplies the accessible-EVCS per-stall costs: CBC 11B-812.3 caps slope
   * at 2% in any direction, so sloped lots need regrading under every
   * accessible stall (typ. $3.5-4.5k adder, can 2-3x the stall on steep lots).
   */
  adaRegradeFactor: number;
  blurb: string;
}

export const TERRAIN_INFO: Record<Terrain, TerrainInfo> = {
  flat: {
    label: "Flat lot",
    trenchFactor: 1.0,
    laborFactor: 1.0,
    spoilsPerFt: 5,
    adaRegradeFactor: 1.0,
    blurb: "Level parking lot, standard open-cut trench.",
  },
  sloped: {
    label: "Gentle slope",
    trenchFactor: 1.2,
    laborFactor: 1.15,
    spoilsPerFt: 6,
    adaRegradeFactor: 1.4,
    blurb: "Graded site — benching, some hand digging.",
  },
  hilly: {
    label: "Hilly site",
    trenchFactor: 1.5,
    laborFactor: 1.3,
    spoilsPerFt: 8,
    adaRegradeFactor: 1.7,
    blurb: "Serious grade changes — slower digging, more spoils handling.",
  },
  rocky: {
    label: "Rocky / hard dig",
    trenchFactor: 2.5,
    laborFactor: 1.5,
    spoilsPerFt: 12,
    adaRegradeFactor: 1.8,
    blurb: "Rock or cobble — breaker time, extra dump runs. Solid rock: get a quote.",
  },
};

// ---------------------------------------------------------------------------
// ADA — CBC 11B-812 accessible EVCS by total count at the facility.
// Three types with different dimensions (and costs): van accessible
// (12 ft + 5 ft aisle), standard accessible (9 ft + 5 ft aisle), and
// ambulatory (10 ft wide, no aisle).
// ---------------------------------------------------------------------------

export interface AdaBreakdown {
  van: number;
  standard: number;
  ambulatory: number;
  total: number;
}

/**
 * CBC Table 11B-228.3.2.1, including the "plus 1 per N or fraction thereof
 * over 100" rows. Van divisor is 300 per the 2022 CBC verbatim text (some
 * older jurisdiction handouts print 200 — verify with the AHJ above 100 EVCS).
 */
export function adaStallBreakdown(nChargers: number): AdaBreakdown {
  if (nChargers <= 0) return { van: 0, standard: 0, ambulatory: 0, total: 0 };
  const over100 = Math.max(0, nChargers - 100);
  const van = nChargers <= 100 ? 1 : 1 + Math.ceil(over100 / 300);
  const standard =
    nChargers <= 4 ? 0 :
    nChargers <= 50 ? 1 :
    nChargers <= 75 ? 2 :
    nChargers <= 100 ? 3 :
    3 + Math.ceil(over100 / 60);
  const ambulatory =
    nChargers <= 25 ? 0 :
    nChargers <= 50 ? 1 :
    nChargers <= 75 ? 2 :
    nChargers <= 100 ? 3 :
    3 + Math.ceil(over100 / 50);
  return { van, standard, ambulatory, total: van + standard + ambulatory };
}

/** Total accessible EVCS required (sum of all three 11B-812 types). */
export function adaStallCount(nChargers: number): number {
  return adaStallBreakdown(nChargers).total;
}

/** Default per-stall construction allowances by type on a FLAT lot (striping,
 * "EV CHARGING ONLY" stencil, ISA sign where required, aisle hatching, wheel
 * stop, localized surface correction). Market-validated: standard $4.5-5.5k
 * typical ($4,900 = this shop's 2025 bid rate), van ≈ standard × 1.2,
 * ambulatory ≈ standard × 0.6 (no aisle, never gets an ISA). Sloped lots
 * multiply by TERRAIN_INFO.adaRegradeFactor for the 2%-slope regrade.
 * Note 11B-812.9: EVCS markings must NOT be blue. */
export const ADA_UNIT_COST = { van: 6500, standard: 4900, ambulatory: 3500, ramp: 5200 } as const;

// ---------------------------------------------------------------------------
// Charger hardware — budgetary allowances per unit, replace with real quotes
// ---------------------------------------------------------------------------

export const HARDWARE_ALLOWANCE: Record<string, number> = {
  "L2 Single": 3000,
  "L2 Single 40A": 4000,
  "L2 Dual": 7500,
  "L2 Dual 80A": 6500,
  "L2 Dual 32A": 5500,
  "DCFC 50kW": 32000,
  "DCFC 60kW": 38000,
  "DCFC 100kW": 52000,
  "DCFC 120kW": 60000,
  "DCFC 160kW": 72000,
  "DCFC 180kW": 80000,
  "DCFC 200kW": 92000,
  "DCFC 240kW": 105000,
  "DCFC 275kW": 120000,
  "DCFC 300kW": 135000,
  "DCFC 360kW": 155000,
};

// ---------------------------------------------------------------------------
// Soft-cost rate card (single place to tune the market defaults)
// ---------------------------------------------------------------------------

export const RATE_CARD = {
  /** AutoCAD site plan: base fee + per-charger, plus a DCFC complexity adder. */
  sitePlanBase: 2500,
  sitePlanPerCharger: 150,
  sitePlanDcfcAdder: 1000,
  /** PE-stamped electrical plan set (SLD, load calcs, panel schedule).
   * Calibrated so 6x200kW + 5xL2 lands ~ $12k (market typical for multi-DCFC). */
  sldBaseL2Only: 2500,
  sldBaseWithDcfc: 6000,
  sldPerDcfc: 900,
  sldPerL2: 150,
  /** Private utility locating (GPR) — day rate and trench-ft covered per day. */
  gprDayRate: 1500,
  gprFtPerDay: 2000,
  /** AHJ fees. L2-only sites are streamlined (AB 1236: flat, cost-of-processing).
   * DCFC/commercial sites are typically valuation-based: ~2% plan check. */
  permitIssuanceBase: 200,
  permitIssuancePerCharger: 60,
  planCheckL2OnlyFlat: 300,
  planCheckPctOfValuation: 0.02,
  planCheckBase: 500,
  /** Utility application / engineering advance (often $0 under make-ready programs). */
  utilityAppFeeL2Only: 800,
  utilityAppFeeDcfc: 2500,
  /** Construction PM: % of construction valuation, converted to hours at the PM rate. */
  cpmPctOfConstruction: 0.05,
  cpmMinHours: 24,
  /** Commissioning allowances per unit. */
  commissioningPerDcfc: 1500,
  commissioningPerL2: 250,
} as const;

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

interface ChargerCounts {
  nL2: number;
  nDCFC: number;
  nChargers: number;
}

export function countChargers(input: QuickEstimateInput, loadTypes: LoadType[]): ChargerCounts {
  let nL2 = 0;
  let nDCFC = 0;
  for (const line of input.lines) {
    if (line.count <= 0) continue;
    const lt = findLoadType(loadTypes, line.loadTypeId);
    if (!lt) continue;
    if (lt.category === "L2") nL2 += line.count;
    if (lt.category === "DCFC") nDCFC += line.count;
  }
  return { nL2, nDCFC, nChargers: nL2 + nDCFC };
}

export function longestRunFt(input: QuickEstimateInput, counts: ChargerCounts): number {
  if (counts.nChargers === 0) return 0;
  return input.firstRunFt + input.stepFt * (counts.nChargers - 1);
}

/** Crew-days: mobilization + per-charger install + trench production, terrain-adjusted. */
export function estimateLaborDays(counts: ChargerCounts, trenchFt: number, terrain: Terrain): number {
  if (counts.nChargers === 0) return 0;
  const base = 8 + 2.5 * counts.nDCFC + 1.0 * counts.nL2 + trenchFt / 40;
  return Math.ceil(base * TERRAIN_INFO[terrain].laborFactor);
}

export function sitePlanFee(counts: ChargerCounts): number {
  if (counts.nChargers === 0) return 0;
  return (
    RATE_CARD.sitePlanBase +
    RATE_CARD.sitePlanPerCharger * counts.nChargers +
    (counts.nDCFC > 0 ? RATE_CARD.sitePlanDcfcAdder : 0)
  );
}

export function sldFee(counts: ChargerCounts): number {
  if (counts.nChargers === 0) return 0;
  const base = counts.nDCFC > 0 ? RATE_CARD.sldBaseWithDcfc : RATE_CARD.sldBaseL2Only;
  return base + RATE_CARD.sldPerDcfc * counts.nDCFC + RATE_CARD.sldPerL2 * counts.nL2;
}

/** Business days to produce the site plan / the stamped electrical set. */
export function sitePlanDesignDays(counts: ChargerCounts): number {
  return counts.nChargers === 0 ? 0 : 5 + Math.ceil(counts.nChargers / 4);
}

export function sldDesignDays(counts: ChargerCounts): number {
  if (counts.nChargers === 0) return 0;
  return counts.nDCFC > 0 ? 10 + Math.ceil(counts.nDCFC / 2) : 7;
}

export const GPR_ITEM_NAME = "Private utility locating (GPR scan)";

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function defaultQuickInput(): QuickEstimateInput {
  return {
    clientName: "",
    siteAddress: "",
    lines: [
      { loadTypeId: "DCFC 200kW", count: 6 },
      { loadTypeId: "L2 Single 40A", count: 5 },
    ],
    firstRunFt: 100,
    stepFt: 15,
    terrain: "flat",
    includeChargerHardware: true,
    includeSitePlanDesign: true,
    includeSldDesign: true,
    includeCpm: true,
    includePermits: true,
    includePrivateScan: true,
  };
}

/**
 * Expands the Quick Estimate input into a full Project. Pure: `base` supplies
 * the load-type library, rate settings and anything the wizard doesn't
 * derive; it is not mutated. Two passes — the first computes construction
 * valuation and the panel schedule, the second sets the valuation-dependent
 * fees (plan check, GFI test).
 */
export function buildQuickProject(
  input: QuickEstimateInput,
  base: Project,
  idSeed = "qs",
): Project {
  const p: Project = JSON.parse(JSON.stringify(base));
  p.quick = { ...input, lines: input.lines.map((l) => ({ ...l })) };

  const counts = countChargers(input, p.loadTypes);
  const terrain = TERRAIN_INFO[input.terrain];
  const trenchFt = longestRunFt(input, counts);
  const laborDays = estimateLaborDays(counts, trenchFt, input.terrain);
  const ada = adaStallBreakdown(counts.nChargers);

  // --- Takeoff + service chain + auto gear -------------------------------
  // L2 chargers go nearest the panel: 208V branch runs are the ones voltage
  // drop punishes, while 480V DCFC tolerates the longer end of the ladder.
  const orderedLines = [...input.lines].sort((a, b) => {
    const cat = (id: string) => (findLoadType(p.loadTypes, id)?.category === "L2" ? 0 : 1);
    return cat(a.loadTypeId) - cat(b.loadTypeId);
  });
  p.takeoff = generateTakeoffRows(
    orderedLines,
    { startFt: input.firstRunFt, stepFt: input.stepFt },
    idSeed,
  );
  p.setup = {
    ...p.setup,
    clientName: input.clientName,
    siteAddress: input.siteAddress,
    scopeOfWork: scopeText(input, p.loadTypes),
    trenchLengthFt: trenchFt,
    terrain: input.terrain,
    trenchCostMultiplier: terrain.trenchFactor,
    serviceChain: {
      enabled: true,
      material: p.setup.serviceChain?.material ?? "Al",
      utilityToSwitchgearFt: p.setup.serviceChain?.utilityToSwitchgearFt ?? 25,
      switchgearToTransformerFt: p.setup.serviceChain?.switchgearToTransformerFt ?? 15,
      transformerToSubpanelFt: p.setup.serviceChain?.transformerToSubpanelFt ?? 15,
    },
  };

  // --- Civil / peripherals -------------------------------------------------
  const gprDays = input.includePrivateScan && trenchFt > 0 ? Math.max(1, Math.ceil(trenchFt / RATE_CARD.gprFtPerDay)) : 0;
  const customItems = (p.peripherals.customItems ?? []).filter((c) => c.name !== GPR_ITEM_NAME);
  if (gprDays > 0) {
    customItems.push({ name: GPR_ITEM_NAME, qty: gprDays, unitCost: RATE_CARD.gprDayRate });
  }

  p.peripherals = {
    ...p.peripherals,
    useAutoGear: true,
    customItems,
    bollardsQty: counts.nDCFC * 4,
    dataBoxQty: counts.nChargers > 0 ? 1 : 0,
    christyBoxQty: trenchFt > 0 ? Math.max(1, Math.ceil(trenchFt / 200)) : 0,
    adaQtyOverride: undefined, // per-type path below wins
    adaVanQty: ada.van,
    adaStdQty: ada.standard,
    adaAmbQty: ada.ambulatory,
    // 11B-812.3 caps slope at 2% under every accessible stall — sloped lots
    // carry a regrade multiplier on the per-stall cost.
    adaVanUnitCost: Math.round(ADA_UNIT_COST.van * terrain.adaRegradeFactor),
    adaStdUnitCost: Math.round(ADA_UNIT_COST.standard * terrain.adaRegradeFactor),
    adaAmbUnitCost: Math.round(ADA_UNIT_COST.ambulatory * terrain.adaRegradeFactor),
    adaRampCost: ada.total > 0 ? ADA_UNIT_COST.ramp : 0,
    transformerPadCost: counts.nDCFC > 0 ? 5000 : 0,
    dumpWasteCost: Math.round(trenchFt * terrain.spoilsPerFt),
    permitFeeTotal: input.includePermits
      ? RATE_CARD.permitIssuanceBase + RATE_CARD.permitIssuancePerCharger * counts.nChargers
      : 0,
    utilityAppFee: input.includePermits
      ? counts.nDCFC > 0
        ? RATE_CARD.utilityAppFeeDcfc
        : RATE_CARD.utilityAppFeeL2Only
      : 0,
  };

  // --- Equipment durations -------------------------------------------------
  const trenchDays = trenchFt > 0 ? Math.ceil((trenchFt / 80) * terrain.trenchFactor) : 0;
  const siteMonths = Math.max(1, Math.ceil(laborDays / 22));
  p.equipment = p.equipment.map((item) => {
    switch (item.name) {
      case "Mini excavator":
      case "Storage container":
      case "Portable restroom":
        return { ...item, qty: 1, durationValue: siteMonths };
      case "Saw cutter":
      case "Compactor":
        return { ...item, qty: 1, durationValue: Math.max(1, trenchDays) };
      case "Jack hammer":
        return { ...item, qty: 1, durationValue: input.terrain === "rocky" ? Math.max(2, trenchDays) : 1 };
      case "Dump truck":
        return { ...item, qty: input.terrain === "hilly" || input.terrain === "rocky" ? 1 : item.qty, durationValue: Math.max(1, Math.ceil(trenchDays / 2)) };
      default:
        return item;
    }
  });

  // --- Design invoice, hardware, labor ------------------------------------
  const hardwareCost = input.includeChargerHardware
    ? input.lines.reduce((s, l) => s + (l.count > 0 ? l.count * (HARDWARE_ALLOWANCE[l.loadTypeId] ?? 0) : 0), 0)
    : 0;
  const commissioning = input.includeChargerHardware
    ? counts.nDCFC * RATE_CARD.commissioningPerDcfc + counts.nL2 * RATE_CARD.commissioningPerL2
    : 0;

  p.financial = {
    ...p.financial,
    laborBusinessDays: laborDays,
    autoCadDesignCost: input.includeSitePlanDesign ? sitePlanFee(counts) : 0,
    electricalEngDesignCost: input.includeSldDesign ? sldFee(counts) : 0,
    pmHours: 0, // set from valuation below
    chargerHardwareCost: hardwareCost,
    evolvCommissioningCost: commissioning,
    planCheckPermitFee: 0, // set from valuation below
  };

  // --- Pass 1: valuation + panel-dependent quantities ----------------------
  const pass1 = computeEstimate(p);
  const valuation = pass1.costs.electricalSupplyConstructionTotal + pass1.costs.labor;

  if (input.includePermits && counts.nChargers > 0) {
    // L2-only sites get the streamlined flat fee (AB 1236); DCFC sites are
    // typically valuation-based commercial plan check.
    p.financial.planCheckPermitFee =
      counts.nDCFC > 0
        ? Math.round(RATE_CARD.planCheckBase + RATE_CARD.planCheckPctOfValuation * valuation)
        : RATE_CARD.planCheckL2OnlyFlat;
  }
  if (input.includeCpm && counts.nChargers > 0) {
    // Construction management benchmarks at ~5-6% of construction cost;
    // expressed as hours at the shop's PM rate so it stays editable.
    p.financial.pmHours = Math.max(
      RATE_CARD.cpmMinHours,
      Math.round((RATE_CARD.cpmPctOfConstruction * valuation) / p.financial.pmHourlyRate),
    );
  }
  const mainBusA = pass1.panel.bus480?.suggestedBusA ?? 0;
  p.peripherals.gfiTestQty = mainBusA > 1000 ? 1 : 0;

  return p;
}

function scopeText(input: QuickEstimateInput, loadTypes: LoadType[]): string {
  const parts = input.lines
    .filter((l) => l.count > 0 && findLoadType(loadTypes, l.loadTypeId))
    .map((l) => `${l.count} × ${l.loadTypeId}`);
  if (parts.length === 0) return "";
  const services: string[] = [];
  if (input.includeSitePlanDesign) services.push("site plan design");
  if (input.includeSldDesign) services.push("SLD/electrical design");
  if (input.includePermits) services.push("permitting");
  if (input.includePrivateScan) services.push("private utility scan");
  if (input.includeCpm) services.push("construction PM");
  return `Turnkey EVCS install: ${parts.join(" + ")} on a ${TERRAIN_INFO[input.terrain].label.toLowerCase()}${
    services.length ? `, incl. ${services.join(", ")}` : ""
  }.`;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface TimelinePhase {
  name: string;
  lowDays: number;
  highDays: number;
  /** Runs alongside other phases instead of adding to the critical path. */
  parallel?: boolean;
  note?: string;
}

/**
 * Business-day schedule estimate derived from the built project. The utility
 * phase runs in parallel but is often the true critical path on DCFC sites.
 */
export function estimateTimeline(project: Project, result: EstimateResult): TimelinePhase[] {
  const { nL2, nDCFC } = result.rollups;
  const counts: ChargerCounts = { nL2, nDCFC, nChargers: nL2 + nDCFC };
  if (counts.nChargers === 0) return [];
  const phases: TimelinePhase[] = [];

  phases.push({ name: "Site survey & utility scan", lowDays: 2, highDays: 4 });
  if (project.financial.autoCadDesignCost > 0) {
    const d = sitePlanDesignDays(counts);
    phases.push({ name: "Site plan design (AutoCAD)", lowDays: d, highDays: d + 5 });
  }
  if (project.financial.electricalEngDesignCost > 0) {
    const d = sldDesignDays(counts);
    phases.push({ name: "Electrical / SLD design (PE stamp)", lowDays: d, highDays: d + 7 });
  }
  if (project.financial.planCheckPermitFee > 0 || project.peripherals.permitFeeTotal > 0) {
    phases.push({
      name: "Plan check & permits (AHJ)",
      lowDays: nDCFC > 0 ? 20 : 5,
      highDays: nDCFC > 0 ? 60 : 15,
      note:
        nDCFC > 0
          ? "AB 970 clocks say 20-40 days; real DCFC plan check with corrections runs 4-12 weeks"
          : "CA AB 1236 streamlining — often same-week for compliant L2 packages",
    });
  }
  phases.push({
    name: "Utility application & new service",
    lowDays: nDCFC > 0 ? 85 : 20,
    highDays: nDCFC > 0 ? 250 : 60,
    parallel: true,
    note: nDCFC > 0
      ? "New transformer/energization — PG&E/SCE queues run 4-12 months and usually decide the finish date"
      : "Existing service check",
  });
  const build = project.financial.laborBusinessDays;
  phases.push({ name: "Construction", lowDays: build, highDays: build + 7 });
  phases.push({ name: "Inspection & commissioning", lowDays: 5, highDays: 10 });
  return phases;
}

export function timelineTotal(phases: TimelinePhase[]): { lowDays: number; highDays: number } {
  const seq = phases.filter((p) => !p.parallel);
  const par = phases.filter((p) => p.parallel);
  const lowSeq = seq.reduce((s, p) => s + p.lowDays, 0);
  const highSeq = seq.reduce((s, p) => s + p.highDays, 0);
  // A parallel phase only extends the schedule if it outlasts the sequential path.
  const lowDays = Math.max(lowSeq, ...par.map((p) => p.lowDays), 0);
  const highDays = Math.max(highSeq, ...par.map((p) => p.highDays), 0);
  return { lowDays, highDays };
}
