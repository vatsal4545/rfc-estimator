import { describe, expect, it } from "vitest";
import { defaultProject, defaultSetup } from "../defaults";
import { computeEstimate } from "../engine";
import { generateTakeoffRows } from "../quickstart";
import { computeTakeoffRow } from "../sizing";
import { DEFAULT_LOAD_TYPES } from "../tables";
import type { LoadType, Project } from "../types";

// Regression tests for the three findings from the independent code review
// (ruflo-core:reviewer, 2026-08-18).

describe("Review finding 1 — 125% continuous factor applied exactly once in panel/chain", () => {
  const base = defaultProject();
  const project: Project = {
    ...base,
    takeoff: generateTakeoffRows([
      { loadTypeId: "DCFC 240kW", count: 5 },
      { loadTypeId: "L2 Dual 40A", count: 6 },
    ]),
  };
  const { panel } = computeEstimate(project);

  it("reports the transformer primary as RAW connected amps (120A, not 150A)", () => {
    // 480A of connected L2 is SINGLE-phase 208V load = 99.84 kVA, which the
    // transformer reflects onto the 480V bus as 99,840 / (480 x sqrt3) = 120A.
    expect(panel.transformer?.primaryAmps480).toBeCloseTo(120.1, 0);
  });

  it("bus demand is connected x 1.25 with no compounding (2,150A, not 2,213A)", () => {
    expect(panel.bus480?.connectedAmps).toBeCloseTo(1720.1, 0);
    expect(panel.bus480?.demandAmps).toBeCloseTo(2150.1, 0);
    expect(panel.bus480?.suggestedBusA).toBe(2500);
  });

  it("primary breaker is 125% of the selected transformer's rated FLA", () => {
    // 150 kVA at 480V = 180.4A FLA -> x1.25 = 225.5 -> 250A standard.
    expect(panel.transformer?.primaryBreakerA).toBe(250);
  });
});

describe("Review finding 2 — size-override typos no longer silently zero the row", () => {
  it("auto-sizes instead, prices correctly, and raises a distinct flag", () => {
    const row = computeTakeoffRow(
      { id: "1", loadTypeId: "DCFC 100kW", location: "typo", units: 1, oneWayDistFt: 100, sizeOverride: "3/0" },
      defaultSetup(),
      DEFAULT_LOAD_TYPES,
    );
    expect(row.selectedWire).toBe("3/0 AWG"); // auto-sized, override ignored
    expect(row.wireCost).toBeCloseTo(300 * 4.5658, 2); // priced, not $0
    expect(row.conduitSize).toBe('2"');
    expect(row.flag).toBe('Invalid size override "3/0" - auto-sized to 3/0 AWG');
  });

  it("surfaces invalid overrides as a failed QA check", () => {
    const base = defaultProject();
    const project: Project = {
      ...base,
      takeoff: [
        { id: "1", loadTypeId: "DCFC 100kW", location: "typo", units: 1, oneWayDistFt: 100, sizeOverride: "500 MCM" },
      ],
    };
    const { qa } = computeEstimate(project);
    const check = qa.find((q) => q.label === "Size overrides are valid")!;
    expect(check.ok).toBe(false);
  });

  it("still honors valid overrides", () => {
    const row = computeTakeoffRow(
      { id: "1", loadTypeId: "Feeder 480V", location: "f", units: 1, oneWayDistFt: 70, sizeOverride: "600 kcmil" },
      defaultSetup(),
      DEFAULT_LOAD_TYPES,
    );
    expect(row.selectedWire).toBe("600 kcmil");
    expect(row.wireCost).toBeGreaterThan(0);
  });
});

describe("Review finding 3 — loads beyond the conductor table refuse to price", () => {
  const monster: LoadType = {
    id: "DCFC 600kW single-run",
    category: "DCFC",
    voltage: 480,
    phases: 3,
    kwPerPort: 600,
    runsPerUnit: 1,
    conductorsPerRun: 3,
    feederOcpdA: 0,
    hasDataCable: false,
    runsAreParallel: false,
  };

  it("returns no wire and $0 with the exceeds flag, instead of a plausible 1000 kcmil price", () => {
    const row = computeTakeoffRow(
      { id: "1", loadTypeId: "DCFC 600kW single-run", location: "x", units: 1, oneWayDistFt: 50 },
      defaultSetup(),
      [...DEFAULT_LOAD_TYPES, monster],
    );
    // 600kW @ 480V = 721.7A x1.25 = 902A > 545A (1000 kcmil Cu max).
    expect(row.selectedWire).toBe("");
    expect(row.wireCost).toBe(0);
    expect(row.rowTotal).toBe(0);
    expect(row.flag).toBe("Exceeds conductor table - use parallel runs");
  });

  it("a legitimate exact fit on the largest conductor still sizes normally", () => {
    // 545A Cu ampacity = 1000 kcmil exactly; contAmps must land at/below it.
    const exact: LoadType = { ...monster, id: "exact-fit", kwPerPort: 0, designAmpsOverride: 436, feederOcpdA: 600 };
    const row = computeTakeoffRow(
      { id: "1", loadTypeId: "exact-fit", location: "x", units: 1, oneWayDistFt: 10 },
      defaultSetup(),
      [...DEFAULT_LOAD_TYPES, exact],
    );
    // 436 x 1.25 = 545 -> exactly the 1000 kcmil row, no exceeds flag.
    expect(row.selectedWire).toBe("1000 kcmil");
    expect(row.flag).not.toMatch(/^Exceeds/);
  });
});
