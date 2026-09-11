import { findLoadType, portsForLoadType } from "./tables";
import type { LoadType, Rollups, Setup, TakeoffRowComputed } from "./types";

export function computeRollups(rows: TakeoffRowComputed[], loadTypes: LoadType[] = [], setup?: Setup): Rollups {
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
  // Charging STALLS, which is what gets striped: a unit serves as many stalls
  // as it has plugs, so a single-port L2 is one and a dual is two. Counting
  // chargers instead billed a site of single-port L2s for twice the striping.
  // A DC cabinet's stall count is a siting decision, not a property of the
  // hardware: a dual-cable unit is sometimes placed to serve one bay. The
  // project answers when it knows; blank follows the cables. L2 always follows
  // its own plugs — each port is its own stall.
  const dcStalls = setup?.dcStallsPerCabinet;
  const nStalls = rows
    .filter((r) => r.category === "L2" || r.category === "DCFC")
    .reduce((s, r) => {
      const lt = findLoadType(loadTypes, r.loadTypeId);
      const perUnit =
        r.category === "DCFC" && dcStalls !== undefined ? dcStalls : lt ? portsForLoadType(lt) : 1;
      return s + r.units * perUnit;
    }, 0);

  return {
    nL2,
    nDCFC,
    nChargers: nL2 + nDCFC,
    nStalls,
    nFeeders,
    nCircuits,
    longestRunFt,
    totalConductorFt,
    totalConduitFt,
    totalDataFt,
    feederMaterialsTotal,
  };
}
