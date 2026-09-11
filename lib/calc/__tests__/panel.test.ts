import { describe, expect, it } from "vitest";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { generateTakeoffRows } from "../quickstart";
import { computeTakeoffRow } from "../sizing";
import { DEFAULT_LOAD_TYPES } from "../tables";
import type { LoadType, Project } from "../types";

describe("Panel schedule — Bartell (6x DCFC 100kW, validated against the real project)", () => {
  const project: Project = {
    ...defaultProject(),
    takeoff: [1, 2, 3, 4, 5, 6].map((i) => ({
      id: `${i}`,
      loadTypeId: "DCFC 100kW",
      location: `Charger ${i}`,
      units: 1,
      oneWayDistFt: 30 + i * 10,
    })),
  };
  const { panel } = computeEstimate(project);

  it("suggests the 1000A/480V switchgear the real project used", () => {
    expect(panel.bus480?.suggestedBusA).toBe(1000);
    expect(panel.bus480?.connectedAmps).toBeCloseTo(721.7, 0);
    expect(panel.bus480?.demandAmps).toBeCloseTo(902.1, 0);
  });

  it("lists six 200A 3-pole branch circuits and no 208V bus or transformer", () => {
    const breakers = panel.branches.filter((b) => b.breakerA === 200 && b.poles === 3);
    expect(breakers.reduce((s, b) => s + b.circuits, 0)).toBe(6);
    expect(panel.bus208).toBeUndefined();
    expect(panel.transformer).toBeUndefined();
  });
});

describe("Quick-generate — 5x DCFC 240kW + 6x L2 Dual 40A (user scenario)", () => {
  const rows = generateTakeoffRows([
    { loadTypeId: "DCFC 240kW", count: 5 },
    { loadTypeId: "L2 Dual 40A", count: 6 },
  ]);
  const project: Project = { ...defaultProject(), takeoff: rows };
  const result = computeEstimate(project);

  it("assumes wire lengths from 100 ft, +15 ft per charger", () => {
    expect(rows).toHaveLength(11);
    expect(rows[0].oneWayDistFt).toBe(100);
    expect(rows[1].oneWayDistFt).toBe(115);
    expect(rows[4].oneWayDistFt).toBe(160);
    expect(rows[5].oneWayDistFt).toBe(175); // first L2 continues the ladder
    expect(rows[10].oneWayDistFt).toBe(250);
  });

  it("sizes each 240kW charger as 2 parallel runs of 3/0 Cu on a 400A breaker", () => {
    const first = result.rows[0];
    expect(first.designAmps).toBe(320); // input amps from the original sheet's table
    expect(first.ocpdA).toBe(400);
    expect(first.selectedWire).toBe("3/0 AWG");
    expect(first.resolvedRunsPerUnit).toBe(2);
  });

  it("sizes each L2 dual-port as two 50A circuits, upsized for voltage drop at long runs", () => {
    const l2 = result.rows[5]; // 175 ft — VD pushes past the 8 AWG ampacity minimum
    expect(l2.ocpdA).toBe(50);
    expect(l2.selectedWire).toBe("4 AWG");
    expect(l2.flag).toBe("Voltage drop governs - wire upsized for the long run");
    expect(l2.groundSize).toBe("10 AWG");
    expect(l2.resolvedRunsPerUnit).toBe(2);

    // At a short run the same charger sizes to its 8 AWG design minimum.
    const short = computeTakeoffRow(
      { id: "s", loadTypeId: "L2 Dual 40A", location: "near", units: 1, oneWayDistFt: 50 },
      defaultProject().setup,
      DEFAULT_LOAD_TYPES,
    );
    expect(short.selectedWire).toBe("8 AWG");
  });

  it("builds the full one-line: 2500A switchgear, 400A sub-panel, 150KVA transformer", () => {
    const { panel } = result;
    expect(panel.bus480?.suggestedBusA).toBe(2500);
    expect(panel.bus208?.suggestedBusA).toBe(400);
    // 6 units x 80A = 480A of single-phase load = 99.84 kVA, which a 208Y bus
    // carries as 277A per line. This used to read 480A — the branch-current sum
    // mistaken for a line current, which bought a 600A panel and a 225 kVA
    // transformer the load never needed.
    expect(panel.bus208?.connectedAmps).toBeCloseTo(277.13, 1);
    expect(panel.bus208?.circuitCount).toBe(12);
    expect(panel.transformer?.suggestedKva).toBe(150);
    expect(panel.transformer?.primaryBreakerA).toBe(250);
  });

  it("suggests a priceable gear list", () => {
    const gear = result.panel.suggestedGear;
    expect(gear).toContainEqual({ item: "Main switchgear", size: "2500A", voltage: "480V", qty: 1 });
    expect(gear).toContainEqual({ item: "Sub-panel", size: "400A", voltage: "208V", qty: 1 });
    expect(gear).toContainEqual({ item: "Transformer", size: "150KVA", voltage: "208V", qty: 1 });
    const b400 = gear.find((g) => g.item === "Branch breaker" && g.size === "400A");
    expect(b400?.qty).toBe(5);
    const b50 = gear.find((g) => g.item === "Branch breaker" && g.size === "50A");
    expect(b50?.qty).toBe(12);
  });
});

describe("Auto-OCPD for custom chargers", () => {
  it("sizes the breaker to the next standard size at 125% continuous", () => {
    const custom: LoadType = {
      id: "Custom 19.2kW",
      category: "L2",
      voltage: 208,
      phases: 1,
      kwPerPort: 19.2,
      runsPerUnit: 1,
      conductorsPerRun: 2,
      feederOcpdA: 0, // auto
      hasDataCable: true,
      runsAreParallel: false,
    };
    const row = computeTakeoffRow(
      { id: "1", loadTypeId: "Custom 19.2kW", location: "x", units: 1, oneWayDistFt: 50 },
      defaultProject().setup,
      [...DEFAULT_LOAD_TYPES, custom],
    );
    // 19.2kW @ 208V 1ph = 92.3A -> x1.25 = 115.4 -> next standard = 125A
    expect(row.ocpdA).toBe(125);
  });
});

describe("Single-phase L2 aggregation — the 3-phase factor belongs to L3 only", () => {
  // The shop's EV_LVL2SUB schedule enters each L2 port as flat per-pole VA and
  // only divides by sqrt(3) at the end to reach line amps. L2 units are 2-pole
  // 208V line-to-line loads, so their VA is I x V; treating the branch-current
  // sum as a 3-phase line current overstated the load by 73%.
  const project: Project = {
    ...defaultProject(),
    takeoff: [
      { id: "dc", loadTypeId: "DCFC 240kW", location: "DC row", units: 1, oneWayDistFt: 100 },
      { id: "l2", loadTypeId: "L2 Dual 40A", location: "L2 row", units: 6, oneWayDistFt: 120 },
    ],
  };
  const { panel } = computeEstimate(project);

  it("totals L2 kVA as amps x volts, without the sqrt(3)", () => {
    // 6 units x 80A input = 480A of single-phase 208V load = 99.84 kVA.
    expect(panel.transformer?.connectedKva).toBeCloseTo(99.84, 2);
  });

  it("sizes the 208V bus on line current, not the branch-current sum", () => {
    // A 208Y sub-panel carries 99,840 VA / (208 x sqrt3) = 277.1A per line.
    expect(panel.bus208?.connectedAmps).toBeCloseTo(277.1, 1);
  });
});
