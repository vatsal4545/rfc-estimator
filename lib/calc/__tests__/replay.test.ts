import { describe, expect, it } from "vitest";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import type { Project } from "../types";

// Replay of the real "L-11101 VN Village Center" workbook: 6x DCFC 100kW at
// the distances read from its CPM Calcs tab. Its materials money must tie to
// the workbook's own computed cells to the penny — proof the engine equals
// the spreadsheet on a clean project (VN had no gear feeders, so none of the
// original's feeder defects fire).
describe("VN Village Center replay (real project)", () => {
  const project: Project = {
    ...defaultProject(),
    takeoff: [25, 45, 45, 65, 70, 100].map((d, i) => ({
      id: `${i}`,
      loadTypeId: "DCFC 100kW",
      location: `Charger ${i + 1}`,
      units: 1,
      oneWayDistFt: d,
    })),
  };
  const r = computeEstimate(project);

  it("selects 3/0 AWG Cu and 2-inch conduit on every run, like the workbook", () => {
    for (const row of r.rows) {
      expect(row.selectedWire).toBe("3/0 AWG");
      expect(row.groundSize).toBe("6 AWG");
      expect(row.conduitSize).toBe('2"');
    }
  });

  it("ties the materials money to the workbook to the penny", () => {
    const wire = r.materials.wireLines.find((l) => l.size === "3/0 AWG")!;
    expect(wire.cuFt).toBe(1050); // their R13
    expect(wire.cuCost).toBeCloseTo(4794.09, 2); // their T13

    const ground = r.materials.wireLines.find((l) => l.size === "6 AWG")!;
    expect(ground.cuFt).toBe(350);
    expect(ground.cuCost).toBeCloseTo(304.86, 2); // their T7

    const c2 = r.materials.conduitLines.find((l) => l.tradeSize === '2"')!;
    expect(c2.cost).toBeCloseTo(311.4, 2); // their X10
    const c34 = r.materials.conduitLines.find((l) => l.tradeSize === '3/4"')!;
    expect(c34.cost).toBeCloseTo(101.92, 2); // their X6

    // Their Y27 (5,512.27) + the CAT5 cable they park in N82 (350 ft x $0.10)
    expect(r.materials.grandTotal).toBeCloseTo(5512.27 + 35.0, 2);
  });

  it("prices the 1000A switchgear from the catalog, not the re-typed $36,813", () => {
    const sg = project.peripherals.gear[0];
    expect(sg.size).toBe("1000A");
    expect(r.peripherals.gearMainSwitchgear).toBeCloseTo(36812.5, 2);
  });

  it("suggests the same 1000A switchgear their INPUT SHEET recorded", () => {
    expect(r.panel.bus480?.suggestedBusA).toBe(1000);
  });

  it("auto-derives their hand-counted striping quantity (0.6 lots)", () => {
    const striping = r.peripherals.lines.signage.find((s) => s.name === "Striping")!;
    expect(striping.qty).toBeCloseTo(0.6, 6);
  });
});

describe("Dump/waste flows into Total Cost (bug found replaying Boatman)", () => {
  const base = defaultProject();
  const project: Project = {
    ...base,
    takeoff: [{ id: "1", loadTypeId: "DCFC 100kW", location: "c1", units: 1, oneWayDistFt: 50 }],
    peripherals: { ...base.peripherals, dumpWasteCost: 4000 },
  };
  const r = computeEstimate(project);

  it("adds a contingency-loaded Dump/Waste line", () => {
    const line = r.costs.lines.find((l) => l.name === "Dump / Waste")!;
    expect(line.base).toBe(4000);
    expect(line.finalCost).toBeCloseTo(4400, 2);
  });
});

describe("ADA stall override (Boatman/VN convention)", () => {
  const base = defaultProject();
  const project: Project = {
    ...base,
    takeoff: [{ id: "1", loadTypeId: "DCFC 100kW", location: "c1", units: 1, oneWayDistFt: 50 }],
    peripherals: { ...base.peripherals, adaQtyOverride: 4, adaUnitCost: 4900, adaRampCost: 5200 },
  };
  const r = computeEstimate(project);

  it("prices ADA as stalls x unit + ramp instead of per charger", () => {
    expect(r.peripherals.adaAllowance).toBe(4 * 4900 + 5200); // 24,800 — Boatman's O110
  });
});
