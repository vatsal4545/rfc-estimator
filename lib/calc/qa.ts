import type { EstimateResult, QACheck, Setup, TakeoffRowComputed } from "./types";

export function computeQA(
  rows: TakeoffRowComputed[],
  materials: EstimateResult["materials"],
  rollups: EstimateResult["rollups"],
  setup: Setup,
): QACheck[] {
  const missingPriceRows = rows.filter((r) => r.flag.startsWith("No"));
  const exceedsRows = rows.filter((r) => r.flag.startsWith("Exceeds"));
  const vdRows = rows.filter((r) => r.flag.startsWith("Voltage"));
  const invalidOverrideRows = rows.filter((r) => r.flag.startsWith("Invalid size override"));

  return [
    {
      label: "Size overrides are valid",
      ok: invalidOverrideRows.length === 0,
      detail:
        invalidOverrideRows.length === 0
          ? "OK"
          : `${invalidOverrideRows.length} row(s) have an override not in the conductor table`,
    },
    {
      label: "Materials rollup ties to Takeoff row totals",
      ok: materials.crossCheck === 0,
      detail:
        materials.crossCheck === 0
          ? "OK"
          : `MISMATCH ($${materials.crossCheck.toFixed(2)}) — a Takeoff size is missing from the tables`,
    },
    {
      label: "Every Takeoff row priced",
      ok: missingPriceRows.length === 0,
      detail: missingPriceRows.length === 0 ? "OK" : `${missingPriceRows.length} row(s) have a missing price`,
    },
    {
      label: "Nothing exceeds the conductor table",
      ok: exceedsRows.length === 0,
      detail: exceedsRows.length === 0 ? "OK" : "A run needs parallel conductors",
    },
    {
      label: "Voltage drop within limit on every run",
      ok: vdRows.length === 0,
      detail: vdRows.length === 0 ? "OK" : `${vdRows.length} run(s) governed by voltage drop`,
    },
    {
      label: "Charger count entered",
      ok: rollups.nChargers > 0,
      detail: rollups.nChargers > 0 ? "OK" : "No chargers on the Takeoff sheet",
    },
    {
      label: "Trench length set",
      ok: setup.conduitType === "EMT" || setup.trenchLengthFt > 0,
      detail:
        setup.conduitType === "EMT" || setup.trenchLengthFt > 0
          ? "OK"
          : "PVC selected but trench length is 0",
    },
  ];
}
