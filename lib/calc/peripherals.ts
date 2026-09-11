import {
  EMT_SUPPORT_RATES,
  effectiveInstallMethod,
  strutStrapCount,
  surfaceRouteFt,
  trapezeCount,
} from "./install";
import { CONDUIT_TABLE, GEAR_CATALOG } from "./tables";
import type {
  CivilItem,
  GearSelection,
  HardwareItem,
  MaterialsConduitLine,
  PeripheralsInput,
  PeripheralsResult,
  Rollups,
  Setup,
  SignageItem,
} from "./types";

/**
 * Civil unit rates and pad volumes. Sources (Aug 2026, SoCal): 2500 PSI
 * ready-mix quotes cluster $146-195/yd delivered (most CA plants price 2500
 * at the 3000 PSI 5-sack rate); batch plants add a ~$125 short-load fee under
 * 8 yd, which nearly every EV pad pour hits. Asphalt saw-cut patch-back runs
 * $4-12/SF — $5 is the large-area rate. Consumables lump sums price out the
 * per-pad forming/anchoring kit: wedge anchors ($7.50), conduit ells
 * ($20-55), 2x4s ($6), plywood ($42), plus nuts/washers/waste.
 * Pad volumes are calibrated to field orders: 5 DCFC pads + 1 switchgear pad
 * + bollard footings rounds up to the 7 yd actually ordered.
 */
export const CIVIL_RATES = {
  bollardEach: 110,
  // Signage and striping, from the shop's RFC_V18 "CPM Calcs" sheet.
  signEach: 40,
  signPostEach: 56.1,
  /** A striping "unit" is ten stalls' worth of work, which is how the sheet counts it. */
  stripingPerStall: 1500,
  concretePerYard: 165, // 2500 PSI delivered
  concreteShortLoadFee: 125,
  shortLoadThresholdYd: 8,
  asphaltPerSf: 5,
  stallSf: 162, // 9 x 18 ft stall
  consumablesPerL2: 275,
  consumablesPerDcfc: 550,
  ydPerDcfcPad: 0.75,
  ydPerL2Pad: 0.35,
  ydSwitchgearPad: 1.75,
  ydXfmrSubPanelPad: 0.5,
  ydPerBollard: 0.08,
} as const;

function pvcCementGallons(conduitLines: MaterialsConduitLine[]): number {
  return conduitLines.reduce((sum, line) => {
    if (line.conduitType !== "PVC") return sum;
    const table = CONDUIT_TABLE.find((c) => c.tradeSize === line.tradeSize);
    if (!table || table.cementFtPerGal === 0) return sum;
    return sum + line.totalFt / table.cementFtPerGal;
  }, 0);
}

function gearUnitCost(sel: GearSelection): number {
  if (sel.costOverride !== undefined) return sel.costOverride;
  const row = GEAR_CATALOG.find(
    (g) => g.item === sel.item && g.size === sel.size && g.voltage === sel.voltage,
  );
  return row?.unitCost ?? 0;
}

export function computePeripherals(
  input: PeripheralsInput,
  setup: Setup,
  rollups: Rollups,
  conduitLines: MaterialsConduitLine[],
  autoGear?: GearSelection[],
): PeripheralsResult {
  const gearList = autoGear ?? input.gear;
  const gearTotals = gearList.map((g) => ({ ...g, unitCost: gearUnitCost(g), total: g.qty * gearUnitCost(g) }));
  const mainSwitchgear = gearTotals.filter((g) => g.item === "Main switchgear");
  const otherGear = gearTotals.filter((g) => g.item !== "Main switchgear");
  const gearMainSwitchgear = mainSwitchgear.reduce((s, g) => s + g.total, 0);
  const gearOtherTotal = otherGear.reduce((s, g) => s + g.total, 0);

  const method = effectiveInstallMethod(setup);
  const surfaceMounted = method !== "trench";
  const routeFt = surfaceMounted ? surfaceRouteFt(setup, rollups.longestRunFt) : 0;

  // Per-material conduit footage (feeder runs only, matching the legacy
  // couplings line): a hybrid's buried PVC service section must not collect
  // strut straps or EMT couplings.
  const emtFeederFt = conduitLines
    .filter((l) => l.conduitType === "EMT")
    .reduce((s, l) => s + l.feederFt, 0);
  const pvcFeederFt = conduitLines
    .filter((l) => l.conduitType === "PVC")
    .reduce((s, l) => s + l.feederFt, 0);

  const hardware: HardwareItem[] = [
    { name: "Nuts", qty: input.nutsQty, unitCost: 0.109, auto: false },
    { name: "Washers", qty: input.washersQty, unitCost: 0.099, auto: false },
    { name: "Elbows", qty: input.elbowsQty, unitCost: 6.929, auto: false },
    { name: "Couplings", qty: Math.ceil(pvcFeederFt / 10), unitCost: 1.3, auto: true },
    {
      name: "EMT set-screw couplings",
      qty: Math.ceil(emtFeederFt / 10),
      unitCost: EMT_SUPPORT_RATES.couplingEach,
      auto: true,
    },
    // NEC 358.30: EMT secured every 10 ft and within 3 ft of terminations.
    // Racks (strut + rod + anchors) run the common route; every conduit gets
    // its own strut strap on every rack.
    {
      name: "Strut trapeze racks (every 10 ft, NEC 358.30)",
      qty: surfaceMounted ? trapezeCount(routeFt) : 0,
      unitCost: EMT_SUPPORT_RATES.trapezeMaterial,
      auto: true,
    },
    {
      name: "Strut conduit straps",
      qty: surfaceMounted ? strutStrapCount(emtFeederFt) : 0,
      unitCost: EMT_SUPPORT_RATES.strutStrapEach,
      auto: true,
    },
    { name: "Junction box", qty: input.junctionBoxQty, unitCost: 177, auto: false },
    // The concrete box with a traffic lid where the service conduit meets our
    // route — one per site, priced installed (lib/calc/utilityCivil).
    { name: "Christy box, traffic-rated (point of connection)", qty: input.serviceBoxQty ?? 0, unitCost: input.serviceBoxUnitCost ?? 600, auto: false },
    { name: "Data box", qty: input.dataBoxQty, unitCost: 1500, auto: false },
    { name: "Ground rods", qty: rollups.nChargers + rollups.nFeeders, unitCost: 34.87, auto: true },
    { name: "Charger anchor bolts", qty: rollups.nDCFC * 6 + rollups.nL2 * 4 + rollups.nFeeders * 4, unitCost: 5, auto: true },
    // Counts only the PVC lines, so a hybrid's trenched service section still
    // gets cement while the EMT branch runs don't.
    {
      name: "PVC cement",
      qty: pvcCementGallons(conduitLines),
      unitCost: 18.8,
      auto: true,
    },
    ...(input.customItems ?? []).map((c) => ({ name: c.name, qty: c.qty, unitCost: c.unitCost, auto: false })),
  ];
  const hardwareSubtotal = hardware.reduce((s, h) => s + h.qty * h.unitCost, 0);

  const adaRamp = input.adaRampCost ?? 0;
  // Per-type accessible EVCS pricing (CBC 11B-812) wins when any type qty is
  // set; otherwise the legacy per-charger / flat-override allowance applies.
  const adaByType =
    input.adaVanQty !== undefined || input.adaStdQty !== undefined || input.adaAmbQty !== undefined;
  const adaVanQty = input.adaVanQty ?? 0;
  const adaStdQty = input.adaStdQty ?? 0;
  const adaAmbQty = input.adaAmbQty ?? 0;
  const adaVanCost = input.adaVanUnitCost ?? 6500;
  const adaStdCost = input.adaStdUnitCost ?? 4900;
  const adaAmbCost = input.adaAmbUnitCost ?? 3500;
  const adaUnitCost = input.adaUnitCost ?? 3250;
  const adaQty = input.adaQtyOverride ?? rollups.nChargers;

  // 40.81 $/ft is the CPM_Clean flat-lot baseline; hilly/rocky sites carry a
  // difficulty multiplier (see TERRAIN_INFO in autoplan.ts).
  const trenchRatePerFt = 40.81 * (setup.trenchCostMultiplier ?? 1);

  const adaLines: CivilItem[] = adaByType
    ? [
        { name: "ADA van-accessible EVCS (12ft + 5ft aisle)", qty: adaVanQty, unitCost: adaVanCost, auto: false },
        { name: "ADA standard accessible EVCS (9ft + 5ft aisle)", qty: adaStdQty, unitCost: adaStdCost, auto: false },
        { name: "ADA ambulatory EVCS (10ft, no aisle)", qty: adaAmbQty, unitCost: adaAmbCost, auto: false },
      ]
    : [
        { name: "ADA asphalt / paving allowance", qty: adaQty, unitCost: adaUnitCost, auto: input.adaQtyOverride === undefined },
      ];

  // Trenched footage: the whole route on a trench job, just the service
  // section on a hybrid (autoplan pre-fills it with the chain distances),
  // zero on a pure surface-EMT install.
  const trenchQtyFt = method === "surface" ? 0 : setup.trenchLengthFt;

  // Charger pads / slab restoration follow the dig: full scope when trenched,
  // gear pads + DCFC pads only on a hybrid, none for pure surface EMT
  // (garage chargers wall-mount or anchor to the existing slab).
  const rebarQty =
    method === "trench"
      ? rollups.nDCFC * 3 + rollups.nL2 * 2 + rollups.nFeeders * 2
      : method === "hybrid"
        ? rollups.nDCFC * 3 + rollups.nFeeders * 2
        : 0;
  // Concrete order: pad volumes summed then rounded UP to whole yards the way
  // a batch plant sells it. DCFC pads follow the dig (trench + hybrid); L2
  // pedestal pads pour only on full-trench jobs (hybrids surface-feed the L2
  // bank); pure surface EMT anchors to the existing slab — no pour. The
  // switchgear pad rides with any DCFC scope, the step-down TX + sub-panel
  // pad only exists on mixed-voltage sites, and every bollard adds a footing.
  const mixedVoltage = rollups.nDCFC > 0 && rollups.nL2 > 0;
  const padYards =
    method === "surface"
      ? 0
      : rollups.nDCFC * CIVIL_RATES.ydPerDcfcPad +
        (method === "trench" ? rollups.nL2 * CIVIL_RATES.ydPerL2Pad : 0) +
        (rollups.nDCFC > 0 ? CIVIL_RATES.ydSwitchgearPad : 0) +
        (mixedVoltage ? CIVIL_RATES.ydXfmrSubPanelPad : 0) +
        input.bollardsQty * CIVIL_RATES.ydPerBollard;
  const concreteQty = input.concreteYardsOverride ?? (padYards > 0 ? Math.ceil(padYards) : 0);
  const concreteRate = input.concreteUnitCost ?? CIVIL_RATES.concretePerYard;
  const shortLoadFee =
    concreteQty > 0 && concreteQty < CIVIL_RATES.shortLoadThresholdYd
      ? (input.concreteShortLoadFee ?? CIVIL_RATES.concreteShortLoadFee)
      : 0;

  // Stall patch-back: most sites repave the charger stalls in asphalt after
  // the trench work. Dual-port L2s serve two stalls, DCFCs one.
  const stallCount = rollups.nL2 * 2 + rollups.nDCFC;
  const asphaltSfAuto = method === "surface" ? 0 : stallCount * CIVIL_RATES.stallSf;
  const asphaltSf = input.asphaltSfOverride ?? asphaltSfAuto;
  const asphaltRate = input.asphaltPerSf ?? CIVIL_RATES.asphaltPerSf;

  // Forming & anchoring kit per pad: wedge anchors, conduit ells, form
  // lumber/plywood, nuts/washers/waste — priced as a lump per charger.
  const consumablesLump =
    rollups.nDCFC * (input.consumablesPerDcfc ?? CIVIL_RATES.consumablesPerDcfc) +
    rollups.nL2 * (input.consumablesPerL2 ?? CIVIL_RATES.consumablesPerL2);

  const civil: CivilItem[] = [
    { name: "Trenching / asphalt cut", qty: trenchQtyFt, unitCost: trenchRatePerFt, auto: true },
    {
      name: "Asphalt paving — parking stalls",
      qty: asphaltSf,
      unitCost: asphaltRate,
      auto: input.asphaltSfOverride === undefined,
    },
    ...adaLines,
    { name: "ADA ramp", qty: adaRamp > 0 ? 1 : 0, unitCost: adaRamp, auto: false },
    { name: "Plywood", qty: input.plywoodQty, unitCost: 55, auto: false },
    { name: "2x4 lumber", qty: input.lumberQty, unitCost: 10, auto: false },
    {
      name: "Forming & anchoring consumables",
      qty: consumablesLump > 0 ? 1 : 0,
      unitCost: consumablesLump,
      auto: true,
    },
    { name: "Sono tubes", qty: input.sonoTubesQty, unitCost: 19, auto: false },
    { name: "Christy box", qty: input.christyBoxQty, unitCost: 160, auto: false },
    { name: "Rebar", qty: rebarQty, unitCost: 25.65, auto: true },
    { name: "Concrete (2500 PSI, yd)", qty: concreteQty, unitCost: concreteRate, auto: input.concreteYardsOverride === undefined },
    { name: "Concrete short-load fee (< 8 yd)", qty: shortLoadFee > 0 ? 1 : 0, unitCost: shortLoadFee, auto: true },
    { name: "Wheel stops", qty: rollups.nChargers, unitCost: 70.58, auto: true },
    { name: "GFI test (service > 1000A)", qty: input.gfiTestQty, unitCost: input.gfiTestUnitCost ?? 2000, auto: false },
    { name: "Dump / waste", qty: input.dumpWasteCost > 0 ? 1 : 0, unitCost: input.dumpWasteCost, auto: false },
  ];
  const asphaltTrenching = trenchQtyFt * trenchRatePerFt + asphaltSf * asphaltRate;
  const adaAllowance =
    (adaByType
      ? adaVanQty * adaVanCost + adaStdQty * adaStdCost + adaAmbQty * adaAmbCost
      : adaQty * adaUnitCost) + adaRamp;
  const concreteImprovements = civil
    .filter(
      (c) =>
        c.name !== "Trenching / asphalt cut" &&
        c.name !== "Asphalt paving — parking stalls" &&
        !c.name.startsWith("ADA ") &&
        c.name !== "Dump / waste",
    )
    .reduce((s, c) => s + c.qty * c.unitCost, 0);
  const civilSubtotal = civil.reduce((s, c) => s + c.qty * c.unitCost, 0);

  // Signage and striping follow the RFC_V18 "CPM Calcs" sheet: one sign per
  // charger, a post per L2 plus one per two DC cabinets, and striping counted
  // in ten-stall units. Posts round UP where the sheet allows a half — half a
  // post cannot be ordered. The accessible stall's post is its own line rather
  // than buried in the charger count, so it survives a change of charger mix
  // and can be seen on the estimate.
  const signPostCost = input.signPostUnitCost ?? CIVIL_RATES.signPostEach;
  const adaStalls = adaByType ? adaVanQty + adaStdQty + adaAmbQty : adaQty;
  // A derived count is right for a standard job and wrong for the one where the
  // AHJ wants a sign at each end of the row. A typed count wins and the line
  // stops calling itself automatic; clearing it hands the line back to the
  // Takeoff. Read with ?? so a deliberate zero survives.
  const counted = (override: number | undefined, derived: number) => ({
    qty: override ?? derived,
    auto: override === undefined,
    autoQty: derived,
  });
  const signage: SignageItem[] = [
    { name: "Signs", ...counted(input.signQtyOverride, rollups.nChargers), unitCost: input.signUnitCost ?? CIVIL_RATES.signEach },
    { name: "Sign posts", ...counted(input.signPostQtyOverride, rollups.nL2 + Math.ceil(rollups.nDCFC / 2)), unitCost: signPostCost },
    { name: "ADA sign post", ...counted(input.adaSignPostQtyOverride, adaStalls > 0 ? 1 : 0), unitCost: signPostCost },
    { name: "Bollards", qty: input.bollardsQty, autoQty: input.bollardsQty, unitCost: input.bollardUnitCost ?? CIVIL_RATES.bollardEach, auto: false },
    { name: "Striping", ...counted(input.stripingQtyOverride, (rollups.nL2 * 2 + rollups.nDCFC) / 10), unitCost: input.stripingUnitCost ?? CIVIL_RATES.stripingPerStall },
  ];
  const signageSubtotal = signage.reduce((s, x) => s + x.qty * x.unitCost, 0);

  // Removal and demolition on a replacement site (lib/existing writes these
  // from the Existing tab's removal scope) — priced into Dump / Waste.
  const demolition: CivilItem[] = (input.demolitionItems ?? []).map((c) => ({ name: c.name, qty: c.qty, unitCost: c.unitCost, auto: false }));
  const demolitionTotal = demolition.reduce((s, d) => s + d.qty * d.unitCost, 0);

  const permitsSubtotal = input.permitFeeTotal;

  const utilitySubtotal =
    input.utilityAppFee +
    input.transformerPadCost +
    input.cableWellCost +
    input.pullBoxQty * input.pullBoxUnitCost +
    input.utilitySandCost +
    input.utilityVaultQty * input.utilityVaultUnitCost;

  return {
    gearMainSwitchgear,
    gearOtherTotal,
    hardwareSubtotal,
    civilSubtotal,
    asphaltTrenching,
    adaAllowance,
    concreteImprovements,
    signageSubtotal,
    permitsSubtotal,
    utilitySubtotal,
    dumpWaste: input.dumpWasteCost + demolitionTotal,
    lines: { hardware, civil, signage, demolition },
  };
}

// ---------------------------------------------------------------------------
// Resetting prices to the shipped list
// ---------------------------------------------------------------------------

/**
 * The peripheral unit prices that have a fixed shipped rate to return to, and
 * that rate.
 *
 * Deliberately NOT here:
 *  - quantities and scope (bollard count, which stalls are van accessible) —
 *    not prices, and "reset" would mean deleting what someone surveyed;
 *  - lump-sum fees quoted per job (permits, utility application) — no shipped
 *    value exists;
 *  - custom line items — same;
 *  - the ADA unit costs. Those look like prices but the auto-planner derives
 *    them from terrain (ADA_UNIT_COST.van x adaRegradeFactor), so there is no
 *    single shipped number, and clearing them only invites the next rebuild to
 *    write them straight back.
 */
export const PERIPHERAL_SHIPPED_PRICES = {
  asphaltPerSf: CIVIL_RATES.asphaltPerSf,
  bollardUnitCost: CIVIL_RATES.bollardEach,
  concreteUnitCost: CIVIL_RATES.concretePerYard,
  concreteShortLoadFee: CIVIL_RATES.concreteShortLoadFee,
  consumablesPerL2: CIVIL_RATES.consumablesPerL2,
  consumablesPerDcfc: CIVIL_RATES.consumablesPerDcfc,
  serviceBoxUnitCost: 600,
  pullBoxUnitCost: 0,
  utilityVaultUnitCost: 0,
} as const;

export type PeripheralPriceKey = keyof typeof PERIPHERAL_SHIPPED_PRICES;

export const PERIPHERAL_PRICE_KEYS = Object.keys(PERIPHERAL_SHIPPED_PRICES) as PeripheralPriceKey[];

/** The two the type requires — cleared they would read as 0, so they are written back. */
const REQUIRED_PRICE_KEYS: readonly PeripheralPriceKey[] = ["pullBoxUnitCost", "utilityVaultUnitCost"];

/**
 * Every unit price back to the shipped rate, leaving quantities, scope, fees
 * and custom items untouched. Optional rates are cleared so they track the
 * shipped table as it changes rather than freezing today's number.
 */
export function resetPeripheralPrices(p: PeripheralsInput): PeripheralsInput {
  const out = { ...p } as Record<string, unknown>;
  for (const key of PERIPHERAL_PRICE_KEYS) {
    if (REQUIRED_PRICE_KEYS.includes(key)) out[key] = PERIPHERAL_SHIPPED_PRICES[key];
    else delete out[key];
  }
  return out as unknown as PeripheralsInput;
}

/**
 * How many unit prices this project has moved off the shipped list. Compares
 * against the shipped RATE, not against a fresh project — a field the planner
 * writes at its shipped value is not a quote, and counting it as one is how
 * this read "5 prices quoted" on a project with none.
 */
export function peripheralPriceOverrideCount(p: PeripheralsInput): number {
  return PERIPHERAL_PRICE_KEYS.filter(
    (key) => p[key] !== undefined && p[key] !== PERIPHERAL_SHIPPED_PRICES[key],
  ).length;
}
