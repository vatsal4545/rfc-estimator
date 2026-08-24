import { CONDUIT_TABLE, WIRE_TABLE } from "./tables";
import type {
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
  const wireLines: MaterialsWireLine[] = WIRE_TABLE.map((w) => {
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

  const conduitLines: MaterialsConduitLine[] = CONDUIT_TABLE.map((c) => {
    const feederFt = rows.filter((r) => r.conduitSize === c.tradeSize).reduce((s, r) => s + r.conduitFt, 0);
    const dataFt = c.tradeSize === setup.dataConduitTradeSize ? rollups.totalDataFt : 0;
    const totalFt = feederFt + dataFt;
    const perFt = setup.conduitType === "PVC" ? c.pvcPerFt : c.emtPerFt;
    const cost = totalFt * perFt;
    const flag = totalFt > 0 && perFt === 0 ? "NO PRICE — add it on ConduitTable" : "";
    return { tradeSize: c.tradeSize, feederFt, dataFt, totalFt, perFt, cost, flag };
  });

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
