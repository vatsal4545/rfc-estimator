import type { Rollups, TakeoffRowComputed } from "./types";

export function computeRollups(rows: TakeoffRowComputed[]): Rollups {
  const nL2 = rows.filter((r) => r.category === "L2").reduce((s, r) => s + r.units, 0);
  const nDCFC = rows.filter((r) => r.category === "DCFC").reduce((s, r) => s + r.units, 0);
  const nFeeders = rows.filter((r) => r.category === "Feeder").reduce((s, r) => s + r.units, 0);
  const nCircuits = rows
    .filter((r) => r.category !== "Feeder" && r.category !== "")
    .reduce((s, r) => s + r.units * r.resolvedRunsPerUnit, 0);
  const longestRunFt = rows.reduce((m, r) => Math.max(m, r.oneWayDistFt), 0);
  const totalConductorFt = rows.reduce((s, r) => s + r.wireFt + r.groundFt, 0);
  const totalConduitFt = rows.reduce((s, r) => s + r.conduitFt, 0);
  const totalDataFt = rows.reduce((s, r) => s + r.dataFt, 0);
  const feederMaterialsTotal = rows.reduce((s, r) => s + r.rowTotal, 0);
  // Level 2 stalls. An L2 run is one circuit per port, so its circuits are its
  // plugs: a single-port unit is one stall and a dual is two. Counting every L2
  // as dual billed a site of singles for twice the striping it needs.
  // (A Runs/u override for parallel conductors would read high here; the
  // striping quantity is typeable on the Peripherals tab for that case.)
  const nL2Stalls = rows
    .filter((r) => r.category === "L2")
    .reduce((s, r) => s + r.units * r.resolvedRunsPerUnit, 0);

  return {
    nL2,
    nDCFC,
    nChargers: nL2 + nDCFC,
    nL2Stalls,
    nFeeders,
    nCircuits,
    longestRunFt,
    totalConductorFt,
    totalConduitFt,
    totalDataFt,
    feederMaterialsTotal,
  };
}
