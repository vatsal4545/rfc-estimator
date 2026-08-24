import { describe, expect, it } from "vitest";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { generateTakeoffRows } from "../quickstart";
import type { Project } from "../types";

// Full-chain automation on the user's scenario: 5x DCFC 240kW + 6x L2 Dual
// 80A. With the service chain on, the app must generate and size every
// upstream segment (utility TX -> switchgear -> step-down TX -> sub-panel)
// and auto-cost the gear, with zero manual rows.
describe("Service chain — 5x DCFC 240kW + 6x L2 Dual 80A", () => {
  const base = defaultProject();
  const project: Project = {
    ...base,
    takeoff: generateTakeoffRows([
      { loadTypeId: "DCFC 240kW", count: 5 },
      { loadTypeId: "L2 Dual 80A", count: 6 },
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
    // Connected 1,808A: 5x320 chargers + 208A raw transformer primary
    // (480A of L2 at 208V reflects to 480x208/480 = 208A). The 125% factor
    // is applied exactly once, by the sizing engine: x1.25 = 2,260A.
    expect(svc.designAmps).toBeCloseTo(1808, 0);
    // 7 parallel runs keep each run within the 600 kcmil Al cap (340A):
    // 2260 / 7 = 323A -> 600 kcmil Al per run.
    expect(svc.resolvedRunsPerUnit).toBe(7);
    expect(svc.selectedWire).toBe("600 kcmil");
    expect(svc.material).toBe("Al");
    expect(svc.wireFt).toBe(7 * 4 * 25); // runs x conductors x distance
  });

  it("sizes the transformer primary and secondary feeders from the suggested 225 kVA unit", () => {
    const pri = seg("FDR Switchgear→TX");
    expect(pri.designAmps).toBeCloseTo(270.6, 1); // 225 kVA at 480V
    expect(pri.volts).toBe(480);

    const sec = seg("FDR TX→Sub-panel");
    expect(sec.designAmps).toBeCloseTo(624.5, 1); // 225 kVA at 208V
    expect(sec.volts).toBe(208);
    expect(sec.resolvedRunsPerUnit).toBeGreaterThanOrEqual(2); // parallel set on the secondary
  });

  it("auto-costs the suggested gear (switchgear + sub-panel + transformer + breakers) without any manual entry", () => {
    // 2500A switchgear $58,540 flows into the estimate directly...
    expect(r.peripherals.gearMainSwitchgear).toBeCloseTo(58540, 2);
    // ...and the 208V side gear prices automatically: 600A sub-panel $5,387 +
    // 225KVA transformer $7,144 + branch breakers at budgetary catalog prices
    // (5x 400A@480V $1,200 + 12x 50A@208V $75 + 1x 350A@480V transformer
    // primary $1,000).
    expect(r.peripherals.gearOtherTotal).toBeCloseTo(5387 + 7144 + 5 * 1200 + 12 * 75 + 1000, 2);
  });

  it("keeps the chain out of the panel buses (no self-inflation)", () => {
    expect(r.panel.bus480?.suggestedBusA).toBe(2500);
    expect(r.panel.bus208?.suggestedBusA).toBe(600);
    expect(r.panel.transformer?.suggestedKva).toBe(225);
  });

  it("chain wire/conduit money lands in the BOM", () => {
    const svc = seg("SVC Utility→Switchgear");
    expect(svc.rowTotal).toBeGreaterThan(0);
    const al600 = r.materials.wireLines.find((l) => l.size === "600 kcmil")!;
    expect(al600.alFt).toBeGreaterThanOrEqual(700); // 7 runs x 4 cond x 25 ft
  });
});

// A 208V-only site gets a single service segment straight to the main panel.
describe("Service chain — L2-only site", () => {
  const base = defaultProject();
  const project: Project = {
    ...base,
    takeoff: generateTakeoffRows([{ loadTypeId: "L2 Dual 80A", count: 4 }], { startFt: 50, stepFt: 10 }),
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
