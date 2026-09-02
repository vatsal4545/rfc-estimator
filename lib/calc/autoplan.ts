// Quick Estimate auto-planner: expands a charger list + a few site facts
// into a complete Project — takeoff runs, service chain, gear, civil
// quantities, design services, permits, scanning, labor and equipment
// durations — so a non-technical user gets a defensible number in one step.
//
// Every derived value lands in a normal editable field on the detail tabs;
// nothing here is a hidden adder. Dollar defaults are budgetary allowances
// (2025-26 US / California market) meant to be overridden with real quotes.

import { computeEstimate } from "./engine";
import { INSTALL_METHOD_INFO, SURFACE_FT_PER_CREW_DAY, effectiveInstallMethod } from "./install";
import { applyTakeoffEdits, generateTakeoffRows } from "./quickstart";
import { findLoadType } from "./tables";
import type {
  EstimateResult,
  InstallMethod,
  LoadType,
  Project,
  QuickEstimateInput,
  Terrain,
} from "./types";

export { INSTALL_METHOD_INFO } from "./install";

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

/**
 * CBC 11B-228.3.2: "Each combination of charging level … shall be considered
 * as a facility" — the table applies to L2 and DCFC (and L1) SEPARATELY,
 * then the site total is the sum. 10 L2 + 4 DCFC therefore needs 2 van + 1
 * standard (one lookup per level), not the single combined-14 lookup.
 * Strictly each connector type is its own facility too — sites mixing CCS
 * and NACS on the same power level should verify with the AHJ.
 */
export function adaStallBreakdownByLevel(nL2: number, nDCFC: number): {
  l2: AdaBreakdown;
  dcfc: AdaBreakdown;
  combined: AdaBreakdown;
} {
  const l2 = adaStallBreakdown(nL2);
  const dcfc = adaStallBreakdown(nDCFC);
  return {
    l2,
    dcfc,
    combined: {
      van: l2.van + dcfc.van,
      standard: l2.standard + dcfc.standard,
      ambulatory: l2.ambulatory + dcfc.ambulatory,
      total: l2.total + dcfc.total,
    },
  };
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
// Charger hardware — CEO price book list prices (HARDWARE_ALLOWANCE_BASIS names the SKU)
// ---------------------------------------------------------------------------

/**
 * Per-model hardware list price, from the CEO's EVSE Project Intake price
 * book (template 2.9.0, Chargetronix). One rule: the TP5 all-in-one list
 * price at the model's rating — the TP5 line prices by kW, not by connector
 * count, so Single and Dual share a price. Ratings the book has no TP5 for
 * (50, 100, 200, 275, 300 kW) are interpolated linearly between the two
 * nearest listed ratings and rounded to $100. Level 2 maps to the CTX
 * commercial (C-series) units. HARDWARE_ALLOWANCE_BASIS names the SKU or
 * interpolation behind every number; the Charger pricing tab shows it.
 * The proposal layer applies the hardware discount to these list prices.
 */
export const HARDWARE_ALLOWANCE: Record<string, number> = {
  "L2 Single": 1402.5,
  "L2 Single 32A": 1402.5,
  "L2 Single 40A": 1402.5,
  "L2 Single 80A": 1650,
  "L2 Dual": 1952.5,
  "L2 Dual 32A": 1952.5,
  "L2 Dual 40A": 1952.5,
  "L2 Dual 80A": 2194.5,
  "DCFC 50kW": 23600,
  "DCFC 50kW Dual": 23600,
  "DCFC 60kW": 28500,
  "DCFC 60kW Dual": 28500,
  "DCFC 100kW": 45500,
  "DCFC 100kW Dual": 45500,
  "DCFC 120kW": 54000,
  "DCFC 120kW Dual": 54000,
  "DCFC 160kW": 57000,
  "DCFC 160kW Dual": 57000,
  "DCFC 180kW": 62000,
  "DCFC 180kW Dual": 62000,
  "DCFC 200kW": 68000,
  "DCFC 200kW Dual": 68000,
  "DCFC 240kW": 80000,
  "DCFC 240kW Dual": 80000,
  "DCFC 275kW": 85500,
  "DCFC 275kW Dual": 85500,
  "DCFC 300kW": 89500,
  "DCFC 300kW Dual": 89500,
  "DCFC 360kW": 99000,
  "DCFC 360kW Dual": 99000,
};

/** Where each HARDWARE_ALLOWANCE number comes from (price book 2.9.0). */
export const HARDWARE_ALLOWANCE_BASIS: Record<string, string> = {
  "L2 Single": "CTX-C48-240-1 list — 48A single commercial L2",
  "L2 Single 32A": "CTX-C32-240-1 list",
  "L2 Single 40A": "CTX-C48-240-1 list — nearest commercial single (the book's 40A single is a home unit)",
  "L2 Single 80A": "CTX-C80-240-1 list",
  "L2 Dual": "CTX-C40-240-2 list — 40A dual commercial L2",
  "L2 Dual 32A": "CTX-C40-240-2 list — nearest commercial dual",
  "L2 Dual 40A": "CTX-C40-240-2 list",
  "L2 Dual 80A": "CTX-C80-240-2 list",
  "DCFC 50kW": "interpolated between TP5-30 ($13,750) and TP5-60 ($28,500) — no 50 kW SKU in the book",
  "DCFC 50kW Dual": "interpolated between TP5-30 and TP5-60 — no 50 kW SKU in the book",
  "DCFC 60kW": "TP5-60-480-x list",
  "DCFC 60kW Dual": "TP5-60-480-x list (dual-cable; price does not depend on connector count)",
  "DCFC 100kW": "interpolated between TP5-60 ($28,500) and TP5-120 ($54,000) — no 100 kW SKU in the book",
  "DCFC 100kW Dual": "interpolated between TP5-60 and TP5-120 — no 100 kW SKU in the book",
  "DCFC 120kW": "TP5-120-480-x list",
  "DCFC 120kW Dual": "TP5-120-480-x list",
  "DCFC 160kW": "TP5-160-480-x list",
  "DCFC 160kW Dual": "TP5-160-480-x list",
  "DCFC 180kW": "TP5-180-480-x list",
  "DCFC 180kW Dual": "TP5-180-480-x list",
  "DCFC 200kW": "interpolated between TP5-180 ($62,000) and TP5-240 ($80,000) — no 200 kW SKU in the book",
  "DCFC 200kW Dual": "interpolated between TP5-180 and TP5-240 — no 200 kW SKU in the book",
  "DCFC 240kW": "TP5-240-480-x list",
  "DCFC 240kW Dual": "TP5-240-480-x list",
  "DCFC 275kW": "interpolated between TP5-240 ($80,000) and TP5-360 ($99,000) — no 275 kW SKU in the book",
  "DCFC 275kW Dual": "interpolated between TP5-240 and TP5-360 — no 275 kW SKU in the book",
  "DCFC 300kW": "interpolated between TP5-240 ($80,000) and TP5-360 ($99,000) — no 300 kW SKU in the book",
  "DCFC 300kW Dual": "interpolated between TP5-240 and TP5-360 — no 300 kW SKU in the book",
  "DCFC 360kW": "TP5-360-480-x-300 list",
  "DCFC 360kW Dual": "TP5-360-480-x-300 list (the Best Western model's cabinet)",
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
  /** Construction PM as a share of the loaded labour line — the CEO basis
   * (EVSE Project Intake 2.9.0, Construction!B10). Replaces the old
   * 5%-of-valuation hours derivation; PM hours are a manual field now. */
  cpmPctOfLabor: 0.15,
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

/**
 * Conduit route length: one leg per charger level, each running from the
 * power source to its own bank (RunFtDcfc / RunFtL2 in the RFC template).
 * On a trenched job this is the trench; on a surface-EMT job it is the
 * ceiling rack the strut supports follow.
 */
export function routeLengthFt(input: QuickEstimateInput, counts: ChargerCounts): number {
  const dcfcLeg = counts.nDCFC > 0 ? input.firstRunFtDcfc + input.stepFt * (counts.nDCFC - 1) : 0;
  const l2Leg = counts.nL2 > 0 ? input.firstRunFtL2 + input.stepFt * (counts.nL2 - 1) : 0;
  return dcfcLeg + l2Leg;
}

/** @deprecated renamed routeLengthFt — kept for older imports. */
export const trenchLengthFt = routeLengthFt;

/**
 * Footage that actually gets dug, by install method: the whole route when
 * trenched, nothing for surface EMT, and just the service section (utility →
 * switchgear → transformer pads, from the service-chain distances) on a hybrid.
 */
export function trenchedFt(method: InstallMethod, routeFt: number, serviceFt: number): number {
  return method === "trench" ? routeFt : method === "hybrid" ? serviceFt : 0;
}

/**
 * Backfills fields added after older projects were saved (split distances,
 * install method). Pass the project's Setup so a legacy save keeps its
 * meaning: EMT conduit implied a no-dig surface install — backfilling those
 * as "trench" would turn a garage job into a dig job on the next rebuild.
 */
export function normalizeQuickInput(q: QuickEstimateInput, setup?: Project["setup"]): QuickEstimateInput {
  const legacy = (q as QuickEstimateInput & { firstRunFt?: number }).firstRunFt;
  return {
    ...q,
    firstRunFtDcfc: q.firstRunFtDcfc ?? legacy ?? 100,
    firstRunFtL2: q.firstRunFtL2 ?? legacy ?? 100,
    installMethod: q.installMethod ?? (setup ? effectiveInstallMethod(setup) : "trench"),
  };
}

/**
 * Crew-days: mobilization + per-charger install + route production,
 * terrain-adjusted. Trenching digs ~40 ft/day; overhead EMT on strut racks
 * hangs ~100 route-ft/day (NECA labor units, incl. trapezes) and skips the
 * terrain labor factor — the garage floor is flat regardless of the lot.
 */
export function estimateLaborDays(
  counts: ChargerCounts,
  trenchFt: number,
  terrain: Terrain,
  surfaceFt = 0,
): number {
  if (counts.nChargers === 0) return 0;
  const base = 8 + 2.5 * counts.nDCFC + 1.0 * counts.nL2 + trenchFt / 40;
  return Math.ceil(base * TERRAIN_INFO[terrain].laborFactor + surfaceFt / SURFACE_FT_PER_CREW_DAY);
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

/**
 * Bollard placement rule (field practice): 2 protecting every charger, 4
 * around new switchgear (bump to 5 on tight lots — the count stays editable
 * on the Peripherals tab), and 3 covering the step-down transformer +
 * sub-panel pad, which only exists on mixed-voltage sites.
 */
export const BOLLARD_RULE = { perCharger: 2, switchgear: 4, stepDownSubPanel: 3 } as const;

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
    firstRunFtDcfc: 100,
    firstRunFtL2: 100,
    stepFt: 15,
    terrain: "flat",
    installMethod: "trench",
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
  // The app passes the global price catalog (shipped defaults + user
  // overrides from the Charger pricing tab); scripts/tests get the defaults.
  hardwareAllowance: Record<string, number> = HARDWARE_ALLOWANCE,
): Project {
  const p: Project = JSON.parse(JSON.stringify(base));
  input = normalizeQuickInput(input, base.setup);
  p.quick = { ...input, lines: input.lines.map((l) => ({ ...l })) };

  const counts = countChargers(input, p.loadTypes);
  const terrain = TERRAIN_INFO[input.terrain];
  const method: InstallMethod = input.installMethod ?? "trench";
  const routeFt = routeLengthFt(input, counts);
  const chainCfg = {
    enabled: true,
    material: p.setup.serviceChain?.material ?? ("Al" as const),
    utilityToSwitchgearFt: p.setup.serviceChain?.utilityToSwitchgearFt ?? 25,
    switchgearToTransformerFt: p.setup.serviceChain?.switchgearToTransformerFt ?? 15,
    transformerToSubpanelFt: p.setup.serviceChain?.transformerToSubpanelFt ?? 15,
  };
  // Hybrid digs only the service section. The step-down TX and 208V
  // sub-panel legs exist only on mixed-voltage sites (chain.ts builds them
  // when both levels are present) — single-voltage sites dig just the
  // utility-to-gear leg.
  const mixedVoltage = counts.nDCFC > 0 && counts.nL2 > 0;
  const serviceFt =
    counts.nChargers === 0
      ? 0
      : chainCfg.utilityToSwitchgearFt +
        (mixedVoltage ? chainCfg.switchgearToTransformerFt + chainCfg.transformerToSubpanelFt : 0);
  const trenchFt = trenchedFt(method, routeFt, serviceFt);
  const surfaceFt = method === "trench" ? 0 : routeFt;
  const laborDays = estimateLaborDays(counts, trenchFt, input.terrain, surfaceFt);
  // CBC 11B-228.3.2: L2 and DCFC are separate "facilities" — table applied per level, then summed.
  const ada = adaStallBreakdownByLevel(counts.nL2, counts.nDCFC).combined;

  // --- Takeoff + service chain + auto gear -------------------------------
  // Each level runs its own distance ladder from its own first-run input:
  // L2 banks and DCFC banks sit in different spots on real sites.
  const isL2 = (id: string) => findLoadType(p.loadTypes, id)?.category === "L2";
  const l2Lines = input.lines.filter((l) => isL2(l.loadTypeId));
  const dcfcLines = input.lines.filter((l) => !isL2(l.loadTypeId));
  // Hand edits recorded on the Takeoff tab (project.takeoffEdits) and rows
  // added there by hand survive the regeneration.
  p.takeoff = applyTakeoffEdits(
    [
      ...generateTakeoffRows(l2Lines, { startFt: input.firstRunFtL2, stepFt: input.stepFt }, `${idSeed}a`),
      ...generateTakeoffRows(dcfcLines, { startFt: input.firstRunFtDcfc, stepFt: input.stepFt }, `${idSeed}b`),
    ],
    base.takeoffEdits,
    base.takeoff,
  );
  p.setup = {
    ...p.setup,
    clientName: input.clientName,
    siteAddress: input.siteAddress,
    scopeOfWork: scopeText(input, p.loadTypes, trenchFt > 0),
    conduitType: method === "trench" ? "PVC" : "EMT",
    installMethod: method,
    surfaceRouteFt: surfaceFt,
    trenchLengthFt: trenchFt,
    terrain: input.terrain,
    trenchCostMultiplier: terrain.trenchFactor,
    serviceChain: chainCfg,
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
    bollardsQty:
      counts.nChargers * BOLLARD_RULE.perCharger +
      (counts.nDCFC > 0 ? BOLLARD_RULE.switchgear : 0) +
      (mixedVoltage ? BOLLARD_RULE.stepDownSubPanel : 0),
    dataBoxQty: counts.nChargers > 0 ? 1 : 0,
    christyBoxQty: trenchFt > 0 ? Math.max(1, Math.ceil(trenchFt / 200)) : 0,
    // Surface EMT needs a pull point roughly every 100 ft (NEC 358.26 caps
    // bends at 360° between pull points) instead of in-ground Christy boxes.
    junctionBoxQty: surfaceFt > 0 ? Math.ceil(surfaceFt / 100) : p.peripherals.junctionBoxQty,
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
  // Dig gear follows the trenched footage (zero on a pure surface job, just
  // the service section on a hybrid); surface installs swap in a scissor
  // lift for the ceiling rack work instead.
  const digging = trenchFt > 0;
  const trenchDays = digging ? Math.ceil((trenchFt / 80) * terrain.trenchFactor) : 0;
  const siteMonths = Math.max(1, Math.ceil(laborDays / 22));
  const liftMonths = surfaceFt > 0 ? Math.max(1, Math.ceil(surfaceFt / SURFACE_FT_PER_CREW_DAY / 22)) : 0;
  p.equipment = p.equipment.map((item) => {
    switch (item.name) {
      case "Mini excavator":
        return { ...item, qty: digging ? 1 : 0, durationValue: digging ? siteMonths : 0 };
      case "Storage container":
      case "Portable restroom":
        return { ...item, qty: 1, durationValue: siteMonths };
      case "Scissor lift":
        return { ...item, qty: surfaceFt > 0 ? 1 : 0, durationValue: Math.max(liftMonths, surfaceFt > 0 ? 1 : 0) };
      case "Saw cutter":
      case "Compactor":
        return { ...item, qty: digging ? 1 : 0, durationValue: Math.max(digging ? 1 : 0, trenchDays) };
      case "Jack hammer":
        return { ...item, qty: digging ? 1 : 0, durationValue: digging ? (input.terrain === "rocky" ? Math.max(2, trenchDays) : 1) : 0 };
      case "Dump truck":
        return { ...item, qty: digging && (input.terrain === "hilly" || input.terrain === "rocky") ? 1 : digging ? item.qty : 0, durationValue: Math.max(digging ? 1 : 0, Math.ceil(trenchDays / 2)) };
      default:
        return item;
    }
  });
  // Older saved projects predate the Scissor lift default — add it when the
  // install needs one and the list doesn't carry it.
  if (surfaceFt > 0 && !p.equipment.some((e) => e.name === "Scissor lift")) {
    p.equipment.push({
      name: "Scissor lift",
      qty: 1,
      rate: 1150,
      rateBasis: "per month",
      durationValue: Math.max(1, liftMonths),
      delivery: 150,
    });
  }

  // --- Design invoice, hardware, labor ------------------------------------
  const hardwareCost = input.includeChargerHardware
    ? input.lines.reduce((s, l) => s + (l.count > 0 ? l.count * (hardwareAllowance[l.loadTypeId] ?? 0) : 0), 0)
    : 0;
  const commissioning = input.includeChargerHardware
    ? counts.nDCFC * RATE_CARD.commissioningPerDcfc + counts.nL2 * RATE_CARD.commissioningPerL2
    : 0;

  p.financial = {
    ...p.financial,
    laborBusinessDays: laborDays,
    autoCadDesignCost: input.includeSitePlanDesign ? sitePlanFee(counts) : 0,
    electricalEngDesignCost: input.includeSldDesign ? sldFee(counts) : 0,
    pmHours: 0, // design-phase PM hours are a manual entry on the Financials tab
    chargerHardwareCost: hardwareCost,
    chargerHardwareCostIsAuto: true,
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
  // Construction PM on the CEO basis: a live share of the loaded labour line
  // (computeCosts multiplies it out), so it follows labour edits on the
  // Financials tab instead of being frozen at Build time.
  p.financial.pmPctOfLabor = input.includeCpm && counts.nChargers > 0 ? RATE_CARD.cpmPctOfLabor : 0;
  const mainBusA = pass1.panel.bus480?.suggestedBusA ?? 0;
  p.peripherals.gfiTestQty = mainBusA > 1000 ? 1 : 0;

  return p;
}

function scopeText(input: QuickEstimateInput, loadTypes: LoadType[], hasTrench: boolean): string {
  const parts = input.lines
    .filter((l) => l.count > 0 && findLoadType(loadTypes, l.loadTypeId))
    .map((l) => `${l.count} × ${l.loadTypeId}`);
  if (parts.length === 0) return "";
  const services: string[] = [];
  if (input.includeSitePlanDesign) services.push("site plan design");
  if (input.includeSldDesign) services.push("SLD/electrical design");
  if (input.includePermits) services.push("permitting");
  // A GPR scan only exists where something gets dug — surface-EMT builds never price one.
  if (input.includePrivateScan && hasTrench) services.push("private utility scan");
  if (input.includeCpm) services.push("construction PM");
  const method = INSTALL_METHOD_INFO[input.installMethod ?? "trench"];
  return `Turnkey EVCS install: ${parts.join(" + ")} on a ${TERRAIN_INFO[input.terrain].label.toLowerCase()}, ${method.label.toLowerCase()}${
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
