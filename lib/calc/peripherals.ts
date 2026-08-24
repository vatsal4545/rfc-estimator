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

function pvcCementGallons(conduitLines: MaterialsConduitLine[]): number {
  return conduitLines.reduce((sum, line) => {
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

  const isPVC = setup.conduitType === "PVC";

  const hardware: HardwareItem[] = [
    { name: "Nuts", qty: input.nutsQty, unitCost: 0.109, auto: false },
    { name: "Washers", qty: input.washersQty, unitCost: 0.099, auto: false },
    { name: "Elbows", qty: input.elbowsQty, unitCost: 6.929, auto: false },
    { name: "Couplings", qty: Math.ceil(rollups.totalConduitFt / 10), unitCost: 1.3, auto: true },
    { name: "Junction box", qty: input.junctionBoxQty, unitCost: 177, auto: false },
    { name: "Data box", qty: input.dataBoxQty, unitCost: 1500, auto: false },
    { name: "Ground rods", qty: rollups.nChargers + rollups.nFeeders, unitCost: 34.87, auto: true },
    { name: "Charger anchor bolts", qty: rollups.nDCFC * 6 + rollups.nL2 * 4 + rollups.nFeeders * 4, unitCost: 5, auto: true },
    {
      name: "PVC cement",
      qty: isPVC ? pvcCementGallons(conduitLines) : 0,
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

  const civil: CivilItem[] = [
    { name: "Trenching / asphalt cut", qty: isPVC ? setup.trenchLengthFt : 0, unitCost: trenchRatePerFt, auto: true },
    ...adaLines,
    { name: "ADA ramp", qty: adaRamp > 0 ? 1 : 0, unitCost: adaRamp, auto: false },
    { name: "Plywood", qty: input.plywoodQty, unitCost: 55, auto: false },
    { name: "2x4 lumber", qty: input.lumberQty, unitCost: 10, auto: false },
    { name: "Sono tubes", qty: input.sonoTubesQty, unitCost: 19, auto: false },
    { name: "Christy box", qty: input.christyBoxQty, unitCost: 160, auto: false },
    {
      name: "Rebar",
      qty: isPVC ? rollups.nDCFC * 3 + rollups.nL2 * 2 + rollups.nFeeders * 2 : 0,
      unitCost: 25.65,
      auto: true,
    },
    {
      name: "Concrete",
      qty: (isPVC ? rollups.nDCFC * 1 + rollups.nL2 * 0.5 + rollups.nFeeders * 1.5 : 0) + 15,
      unitCost: 193.54,
      auto: true,
    },
    { name: "Wheel stops", qty: rollups.nChargers, unitCost: 70.58, auto: true },
    { name: "GFI test (service > 1000A)", qty: input.gfiTestQty, unitCost: input.gfiTestUnitCost ?? 2000, auto: false },
    { name: "Dump / waste", qty: input.dumpWasteCost > 0 ? 1 : 0, unitCost: input.dumpWasteCost, auto: false },
  ];
  const asphaltTrenching = civil.find((c) => c.name === "Trenching / asphalt cut")!.qty * trenchRatePerFt;
  const adaAllowance =
    (adaByType
      ? adaVanQty * adaVanCost + adaStdQty * adaStdCost + adaAmbQty * adaAmbCost
      : adaQty * adaUnitCost) + adaRamp;
  const concreteImprovements = civil
    .filter(
      (c) =>
        c.name !== "Trenching / asphalt cut" &&
        !c.name.startsWith("ADA ") &&
        c.name !== "Dump / waste",
    )
    .reduce((s, c) => s + c.qty * c.unitCost, 0);
  const civilSubtotal = civil.reduce((s, c) => s + c.qty * c.unitCost, 0);

  const signage: SignageItem[] = [
    { name: "Signs", qty: rollups.nChargers, unitCost: 40, auto: true },
    { name: "Sign posts", qty: rollups.nL2 + Math.ceil(rollups.nDCFC / 2), unitCost: 56.1, auto: true },
    { name: "Bollards", qty: input.bollardsQty, unitCost: 110, auto: false },
    { name: "Striping", qty: (rollups.nL2 * 2 + rollups.nDCFC) / 10, unitCost: 1500, auto: true },
  ];
  const signageSubtotal = signage.reduce((s, x) => s + x.qty * x.unitCost, 0);

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
    dumpWaste: input.dumpWasteCost,
    lines: { hardware, civil, signage },
  };
}
