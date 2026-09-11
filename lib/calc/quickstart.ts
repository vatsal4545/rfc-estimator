import type { TakeoffEdit, TakeoffRowInput } from "./types";

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
 * Expands "5x DCFC 240kW + 6x L2 Dual 40A" style input into takeoff rows.
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
        genKey: `${line.loadTypeId} #${i + 1}`,
        units: 1,
        oneWayDistFt: assumption.startFt + assumption.stepFt * chargerIndex,
      });
      chargerIndex += 1;
    }
  }
  return rows;
}

/**
 * Re-apply hand edits to a freshly generated takeoff: rows the user removed
 * stay removed, rows the user changed keep the changed cells, and rows the
 * user added by hand ride along after the generated ones. Keyed by genKey, so
 * the edits survive any number of rebuilds and any change of charger count.
 */
export function applyTakeoffEdits(
  generated: TakeoffRowInput[],
  edits: Record<string, TakeoffEdit> | undefined,
  previous: TakeoffRowInput[],
): TakeoffRowInput[] {
  const out: TakeoffRowInput[] = [];
  for (const row of generated) {
    const e = row.genKey ? edits?.[row.genKey] : undefined;
    if (e?.removed) continue;
    if (!e) {
      out.push(row);
      continue;
    }
    const patch: TakeoffEdit = { ...e };
    delete patch.removed;
    out.push({ ...row, ...patch });
  }
  for (const row of previous) if (row.manual && !row.synthetic) out.push({ ...row });
  return out;
}

// ---------------------------------------------------------------------------
// Location naming
// ---------------------------------------------------------------------------

/**
 * The location a row takes when its load type changes — the same
 * "<loadTypeId> #<n>" the Quick Estimate generates, numbered past the rows
 * already carrying that type. The row being changed is not counted, so
 * switching the only L2 row to DCFC gives "#1" rather than "#2".
 */
export function locationForLoadType(
  rows: { id: string; loadTypeId: string }[],
  rowId: string,
  nextLoadTypeId: string,
): string {
  const n = rows.filter((r) => r.id !== rowId && r.loadTypeId === nextLoadTypeId).length;
  return `${nextLoadTypeId} #${n + 1}`;
}

/**
 * Whether a location is still one of ours to rewrite. Anything a person typed
 * is theirs — "North lot, by the pylon" survives a load-type change, while the
 * generated "DCFC 200kW #1" and the hand-added "Run 3" do not.
 *
 * Matching against the project's real load type ids keeps this tight: "Pylon
 * #3" is only an auto name if a load type is actually called "Pylon".
 */
export function isAutoLocation(location: string, loadTypeIds: string[]): boolean {
  const s = location.trim();
  if (s === "") return false;
  if (/^Run \d+$/.test(s)) return true;
  const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return loadTypeIds.some((id) => new RegExp(`^${escape(id)} #\\d+$`).test(s));
}
