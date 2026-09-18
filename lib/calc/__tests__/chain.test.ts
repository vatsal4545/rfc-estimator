import { describe, expect, it } from "vitest";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { generateTakeoffRows } from "../quickstart";
import { GEAR_CATALOG } from "../tables";
import type { Project } from "../types";

// Full-chain automation on the user's scenario: 5x DCFC 240kW + 6x L2 Dual
// 80A. With the service chain on, the app must generate and size every
// upstream segment (utility TX -> switchgear -> step-down TX -> sub-panel)
// and auto-cost the gear, with zero manual rows.
describe("Service chain — 5x DCFC 240kW + 6x L2 Dual 40A", () => {
  const base = defaultProject();
  const project: Project = {
    ...base,
    takeoff: generateTakeoffRows([
      { loadTypeId: "DCFC 240kW", count: 5 },
      { loadTypeId: "L2 Dual 40A", count: 6 },
    ]),
    setup: {
      ...base.setup,
      serviceChain: {
        enabled: true,
        material: "Al",
        utilityToSwitchgearFt: 25,
        switchgearToTransformerFt: 15,
        transformerToSubpanelFt: 15,
      },
    },
    peripherals: { ...base.peripherals, useAutoGear: true },
  };
  const r = computeEstimate(project);

  const seg = (id: string) => r.rows.find((row) => row.id === `chain-${id}`)!;

  it("generates all three upstream segments as synthetic takeoff rows", () => {
    expect(seg("SVC Utility→Switchgear")).toBeDefined();
    expect(seg("FDR Switchgear→TX")).toBeDefined();
    expect(seg("FDR TX→Sub-panel")).toBeDefined();
    expect(r.rows.filter((row) => row.synthetic)).toHaveLength(3);
  });

  it("sizes the 480V service conductors with auto parallel runs at 125% continuous (applied once)", () => {
    const svc = seg("SVC Utility→Switchgear");
    // Connected 1,720A: 5x320 chargers + 120A raw transformer primary. The L2
    // side is 99.84 kVA of SINGLE-phase load, which reflects onto the 480V bus
    // as 99,840 / (480 x sqrt3) = 120A. The 125% factor is applied exactly
    // once, by the sizing engine: x1.25 = 2,150A.
    expect(svc.designAmps).toBeCloseTo(1720.1, 0);
    // 7 parallel runs: 2150 / 7 = 307A -> 500 kcmil Al per run.
    expect(svc.resolvedRunsPerUnit).toBe(7);
    expect(svc.selectedWire).toBe("500 kcmil");
    expect(svc.material).toBe("Al");
    expect(svc.wireFt).toBe(7 * 4 * 25); // runs x conductors x distance
  });

  it("sizes the transformer primary and secondary feeders from the suggested 150 kVA unit", () => {
    const pri = seg("FDR Switchgear→TX");
    expect(pri.designAmps).toBeCloseTo(180.4, 1); // 150 kVA at 480V
    expect(pri.volts).toBe(480);

    const sec = seg("FDR TX→Sub-panel");
    expect(sec.designAmps).toBeCloseTo(416.4, 1); // 150 kVA at 208V
    expect(sec.volts).toBe(208);
    expect(sec.resolvedRunsPerUnit).toBeGreaterThanOrEqual(2); // parallel set on the secondary
  });

  it("auto-costs the suggested gear (switchgear + sub-panel + transformer + breakers) without any manual entry", () => {
    // The suggested 2500A switchgear prices at its catalog rate directly...
    const sg2500 = GEAR_CATALOG.find(
      (g) => g.item === "Main switchgear" && g.size === "2500A" && g.voltage === "480V",
    )!;
    expect(r.peripherals.gearMainSwitchgear).toBeCloseTo(sg2500.unitCost, 2);
    // ...and the 208V side gear prices automatically: 400A sub-panel $1,660 +
    // 150KVA transformer $5,298 + branch breakers at budgetary catalog prices
    // (5x 400A@480V $1,200 + 12x 50A@208V $75 + 1x 250A@480V transformer
    // primary $750).
    expect(r.peripherals.gearOtherTotal).toBeCloseTo(1660 + 5298 + 5 * 1200 + 12 * 75 + 750, 2);
  });

  it("keeps the chain out of the panel buses (no self-inflation)", () => {
    expect(r.panel.bus480?.suggestedBusA).toBe(2500);
    expect(r.panel.bus208?.suggestedBusA).toBe(400);
    expect(r.panel.transformer?.suggestedKva).toBe(150);
  });

  it("chain wire/conduit money lands in the BOM", () => {
    const svc = seg("SVC Utility→Switchgear");
    expect(svc.rowTotal).toBeGreaterThan(0);
    const al500 = r.materials.wireLines.find((l) => l.size === "500 kcmil")!;
    expect(al500.alFt).toBeGreaterThanOrEqual(700); // 7 runs x 4 cond x 25 ft
  });
});

// A 208V-only site gets a single service segment straight to the main panel.
describe("Service chain — L2-only site", () => {
  const base = defaultProject();
  const project: Project = {
    ...base,
    takeoff: generateTakeoffRows([{ loadTypeId: "L2 Dual 40A", count: 4 }], { startFt: 50, stepFt: 10 }),
    setup: { ...base.setup, serviceChain: { ...base.setup.serviceChain!, enabled: true } },
  };
  const r = computeEstimate(project);

  it("creates only the utility-to-panel segment at 208V", () => {
    const synthetic = r.rows.filter((row) => row.synthetic);
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0].volts).toBe(208);
    expect(r.panel.transformer).toBeUndefined();
  });
});

// Intake 3.7.0 block I: feeders typed between the items on the distribution
// schedule replace the guessed switchgear → transformer → sub-panel pair and
// size the way the sheet sizes them — at the floor the item fed sets.
describe("Service chain — typed distribution feeders (intake 3.7.0 block I)", () => {
  const base = defaultProject();
  const project: Project = {
    ...base,
    takeoff: generateTakeoffRows([
      { loadTypeId: "DCFC 240kW", count: 5 },
      { loadTypeId: "L2 Dual 40A", count: 6 },
    ]),
    setup: {
      ...base.setup,
      serviceChain: {
        enabled: true,
        material: "Cu",
        utilityToSwitchgearFt: 25,
        switchgearToTransformerFt: 15,
        transformerToSubpanelFt: 15,
        feeders: [
          // Floor from the item fed's schedule rating; the engine picks the sets.
          { from: "Existing MSB", to: "EV distribution panel", distanceFt: 60, voltage: 480, phases: 3, ratingA: 400 },
          // A typed floor (breaker on a transformer primary) wins over the rating; sets and conductor typed.
          { from: "EV distribution panel", to: "Transformer 112.5 kVA", distanceFt: 25, voltage: 480, phases: 3, ratingA: 0, floorA: 175, sets: 1, conductorOverride: "2/0 AWG" },
          // No floor anywhere — the sheet says "enter the item fed"; the engine cannot size it either.
          { from: "Transformer 112.5 kVA", to: "Mystery box", distanceFt: 40, voltage: 208, phases: 3 },
        ],
      },
    },
    peripherals: { ...base.peripherals, useAutoGear: true },
  };
  const r = computeEstimate(project);
  const fdr = r.rows.filter((row) => row.synthetic && row.loadTypeId.startsWith("FDR"));

  it("replaces the auto pair with one segment per typed feeder that has a floor, keeping the service lateral", () => {
    expect(r.rows.find((row) => row.id === "chain-SVC Utility→Switchgear")).toBeDefined();
    expect(r.rows.find((row) => row.id === "chain-FDR Switchgear→TX")).toBeUndefined();
    expect(r.rows.find((row) => row.id === "chain-FDR TX→Sub-panel")).toBeUndefined();
    expect(fdr.map((row) => row.loadTypeId)).toEqual(["FDR 1 Existing MSB → EV distribution panel", "FDR 2 EV distribution panel → Transformer 112.5 kVA"]);
  });

  it("sizes at the floor: design current = floor / 1.25 so the engine's 125 % lands back on the floor, OCPD = the floor", () => {
    const f1 = fdr[0];
    expect(f1.designAmps).toBeCloseTo(400 / 1.25, 6);
    expect(f1.ocpdA).toBe(400);
    expect(f1.oneWayDistFt).toBe(60);
    expect(f1.material).toBe("Cu");
    expect(f1.rowTotal).toBeGreaterThan(0);
  });

  it("honours a typed floor, typed sets and a typed conductor", () => {
    const f2 = fdr[1];
    expect(f2.designAmps).toBeCloseTo(175 / 1.25, 6);
    expect(f2.ocpdA).toBe(175);
    expect(f2.resolvedRunsPerUnit).toBe(1);
    expect(f2.selectedWire).toBe("2/0 AWG");
  });

  it("survives a Quick Estimate rebuild", async () => {
    const { buildQuickProject, defaultQuickInput, HARDWARE_ALLOWANCE } = await import("../autoplan");
    const rebuilt = buildQuickProject({ ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 240kW", count: 2 }] }, project, "t", HARDWARE_ALLOWANCE);
    expect(rebuilt.setup.serviceChain?.feeders).toHaveLength(3);
  });
});
