import type { TakeoffRowInput } from "./types";

export interface QuickLine {
  loadTypeId: string;
  count: number;
}

export interface DistanceAssumption {
  startFt: number; // first charger's one-way distance
  stepFt: number; // added per subsequent charger
}

export const DEFAULT_DISTANCE_ASSUMPTION: DistanceAssumption = { startFt: 100, stepFt: 15 };

/**
 * Expands "5x DCFC 240kW + 6x L2 Dual 80A" style input into takeoff rows.
 * Distances follow the assumption ladder: charger 1 gets startFt, each next
 * charger +stepFt, continuing across every line in order — placeholders to
 * replace with real site measurements when the plan is available.
 */
export function generateTakeoffRows(
  lines: QuickLine[],
  assumption: DistanceAssumption = DEFAULT_DISTANCE_ASSUMPTION,
  idSeed = "qs",
): TakeoffRowInput[] {
  const rows: TakeoffRowInput[] = [];
  let chargerIndex = 0;
  for (const line of lines) {
    if (!line.loadTypeId || line.count <= 0) continue;
    for (let i = 0; i < line.count; i++) {
      rows.push({
        id: `${idSeed}-${rows.length + 1}`,
        loadTypeId: line.loadTypeId,
        location: `${line.loadTypeId} #${i + 1}`,
        units: 1,
        oneWayDistFt: assumption.startFt + assumption.stepFt * chargerIndex,
      });
      chargerIndex += 1;
    }
  }
  return rows;
}
