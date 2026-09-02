import { conduitTableFor, wireTableFor } from "./tables";
import type {
  ConduitMaterial,
  MaterialsConduitLine,
  MaterialsResult,
  MaterialsWireLine,
  Rollups,
  Setup,
  TakeoffRowComputed,
} from "./types";

export function computeMaterials(
  rows: TakeoffRowComputed[],
  setup: Setup,
  rollups: Rollups,
): MaterialsResult {
  const wireLines: MaterialsWireLine[] = wireTableFor(setup).map((w) => {
    const cuFt =
      rows.filter((r) => r.selectedWire === w.size && r.material === "Cu").reduce((s, r) => s + r.wireFt, 0) +
      (setup.groundingMaterial === "Cu"
        ? rows.filter((r) => r.groundSize === w.size).reduce((s, r) => s + r.groundFt, 0)
        : 0);
    const alFt =
      rows.filter((r) => r.selectedWire === w.size && r.material === "Al").reduce((s, r) => s + r.wireFt, 0) +
      (setup.groundingMaterial === "Al"
        ? rows.filter((r) => r.groundSize === w.size).reduce((s, r) => s + r.groundFt, 0)
        : 0);
    const cuCost = cuFt * w.cuPerFt;
    const alCost = alFt * w.alPerFt;
    let flag = "";
    if (cuFt > 0 && w.cuPerFt === 0) flag = "NO Cu PRICE — add it on WireTable";
    else if (alFt > 0 && w.alPerFt === 0) flag = "NO Al PRICE — add it on WireTable";
    return { size: w.size, cuFt, cuPerFt: w.cuPerFt, cuCost, alFt, alPerFt: w.alPerFt, alCost, flag };
  });

  // A hybrid install mixes conduit materials (EMT branch runs, PVC in the
  // service trench), so each trade size rolls up per material at its own
  // price — otherwise the BOM re-prices the PVC footage at EMT rates and the
  // cross-check against the row totals breaks.
  const conduitLines: MaterialsConduitLine[] = [];
  const otherType: ConduitMaterial = setup.conduitType === "PVC" ? "EMT" : "PVC";
  for (const c of conduitTableFor(setup)) {
    const ftOf = (m: ConduitMaterial) =>
      rows
        .filter((r) => r.conduitSize === c.tradeSize && (r.conduitOverride ?? setup.conduitType) === m)
        .reduce((s, r) => s + r.conduitFt, 0);
    const priceOf = (m: ConduitMaterial) => (m === "PVC" ? c.pvcPerFt : c.emtPerFt);
    const line = (m: ConduitMaterial, feederFt: number, dataFt: number): MaterialsConduitLine => {
      const totalFt = feederFt + dataFt;
      const perFt = priceOf(m);
      return {
        tradeSize: c.tradeSize,
        conduitType: m,
        feederFt,
        dataFt,
        totalFt,
        perFt,
        cost: totalFt * perFt,
        flag: totalFt > 0 && perFt === 0 ? "NO PRICE — add it on ConduitTable" : "",
      };
    };
    // Data conduit always follows the Setup toggle: only charger rows carry
    // data, and those never override the conduit material.
    const dataFt = c.tradeSize === setup.dataConduitTradeSize ? rollups.totalDataFt : 0;
    conduitLines.push(line(setup.conduitType, ftOf(setup.conduitType), dataFt));
    const otherFt = ftOf(otherType);
    if (otherFt > 0) conduitLines.push(line(otherType, otherFt, 0));
  }

  const conductorSubtotalCu = wireLines.reduce((s, l) => s + l.cuCost, 0);
  const conductorSubtotalAl = wireLines.reduce((s, l) => s + l.alCost, 0);
  const conduitSubtotal = conduitLines.reduce((s, l) => s + l.cost, 0);
  const dataCableCost = rollups.totalDataFt * setup.dataRatePerFt;
  const grandTotal = conductorSubtotalCu + conductorSubtotalAl + conduitSubtotal + dataCableCost;
  const crossCheck = Math.round((grandTotal - rollups.feederMaterialsTotal) * 100) / 100;

  return {
    wireLines,
    conduitLines,
    conductorSubtotalCu,
    conductorSubtotalAl,
    conduitSubtotal,
    dataCableCost,
    grandTotal,
    crossCheck,
  };
}
