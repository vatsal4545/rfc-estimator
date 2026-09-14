import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { CIVIL_RATES, DISCONNECT_RATES, PERIPHERAL_PRICE_KEYS, disconnectRateFor, resetPeripheralPrices } from "../peripherals";
import { GEAR_CATALOG } from "../tables";
import { estimatorOverrideRows } from "../../intake/handoff";
import type { Project } from "../types";

// A hotel garage job: the site keeps its switchgear, the route is EMT inside
// the building, and the conduit needs core-drilled penetrations. Coring is a
// hand count priced into the wires-and-peripherals line; the retained board
// takes the switchgear line, its pad and its bollards to zero.

function garageProject(extra: Partial<Project["peripherals"]> = {}): Project {
  const base: Project = defaultProject();
  base.peripherals = { ...base.peripherals, ...extra };
  const quick = { ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 180kW Dual", count: 4 }, { loadTypeId: "L2 Dual 40A", count: 6 }], installMethod: "surface" as const };
  return buildQuickProject(quick, base, "t", HARDWARE_ALLOWANCE);
}

const line = (p: Project, name: string) => computeEstimate(p).costs.lines.find((l) => l.name === name)!.base;

describe("concrete coring", () => {
  it("is a hardware line at the shipped rate, priced into wires and peripherals, and zero when uncounted", () => {
    const none = garageProject();
    const cored = garageProject({ coringQty: 12 });
    const row = computeEstimate(cored).peripherals.lines.hardware.find((h) => h.name.startsWith("Concrete coring"))!;
    expect(row.qty).toBe(12);
    expect(row.unitCost).toBe(CIVIL_RATES.coringPerHole);
    expect(line(cored, "Wires, Conduits & Electrical Peripherals") - line(none, "Wires, Conduits & Electrical Peripherals")).toBeCloseTo(12 * CIVIL_RATES.coringPerHole, 6);
    expect(computeEstimate(none).peripherals.lines.hardware.find((h) => h.name.startsWith("Concrete coring"))!.qty).toBe(0);
  });

  it("takes a quoted rate, which the price reset clears back to the shipped one", () => {
    const quoted = garageProject({ coringQty: 8, coringUnitCost: 210 });
    expect(line(quoted, "Wires, Conduits & Electrical Peripherals") - line(garageProject({ coringQty: 8 }), "Wires, Conduits & Electrical Peripherals")).toBeCloseTo(8 * 60, 6);
    expect(PERIPHERAL_PRICE_KEYS).toContain("coringUnitCost");
    const reset = resetPeripheralPrices(quoted.peripherals);
    expect(reset.coringUnitCost).toBeUndefined();
    expect(reset.coringQty).toBe(8); // a count, not a price
  });
});

describe("existing switchgear reused", () => {
  const fresh = garageProject();
  const kept = garageProject({ existingSwitchgear: true });
  const freshR = computeEstimate(fresh);
  const keptR = computeEstimate(kept);

  it("swaps the switchboard for a main breaker at the frame size and keeps every branch breaker", () => {
    const frame = freshR.panel.bus480!.suggestedBusA;
    expect(keptR.panel.bus480?.suggestedBusA).toBe(frame); // the frame is still sized
    expect(keptR.panel.suggestedGear.some((g) => g.item === "Main switchgear")).toBe(false);
    expect(keptR.panel.suggestedGear).toContainEqual({ item: "Main breaker", size: `${frame}A`, voltage: "480V", qty: 1 });
    const branches = (r: typeof freshR) => r.panel.suggestedGear.filter((g) => g.item === "Branch breaker");
    expect(branches(keptR)).toEqual(branches(freshR));
    expect(branches(keptR).filter((g) => g.voltage === "480V").reduce((s, g) => s + g.qty, 0)).toBeGreaterThanOrEqual(4); // one per DC charger
  });

  it("prices only the main breaker on the Main Distribution Switchgear line, the rest of the gear unchanged", () => {
    const mainBreaker = GEAR_CATALOG.find((g) => g.item === "Main breaker" && g.size === `${freshR.panel.bus480!.suggestedBusA}A` && g.voltage === "480V")!;
    expect(mainBreaker.unitCost).toBeGreaterThan(0);
    expect(line(kept, "Main Distribution Switchgear")).toBe(mainBreaker.unitCost);
    expect(line(kept, "Main Distribution Switchgear")).toBeLessThan(line(fresh, "Main Distribution Switchgear"));
    expect(keptR.peripherals.gearOtherTotal).toBe(freshR.peripherals.gearOtherTotal);
    expect(keptR.costs.totalCost).toBeLessThan(freshR.costs.totalCost);
  });

  it("carries a main-breaker price at every switchboard frame in the catalog", () => {
    const frames = GEAR_CATALOG.filter((g) => g.item === "Main switchgear" && g.voltage === "480V").map((g) => g.size);
    for (const size of frames) {
      const hit = GEAR_CATALOG.find((g) => g.item === "Main breaker" && g.size === size && g.voltage === "480V");
      expect(hit?.unitCost ?? 0, `main breaker ${size}`).toBeGreaterThan(0);
    }
    const ladder = GEAR_CATALOG.filter((g) => g.item === "Main breaker" && g.voltage === "480V").map((g) => g.unitCost);
    expect(ladder).toEqual([...ladder].sort((a, b) => a - b)); // monotonic in amps
  });

  it("drops the bollards at the gear on a rebuild", () => {
    expect(fresh.peripherals.bollardsQty - kept.peripherals.bollardsQty).toBe(4);
  });

  it("drops the switchgear pad from the concrete order on a trenched job", () => {
    const dig = (extra: Partial<Project["peripherals"]>) => {
      const base: Project = defaultProject();
      base.peripherals = { ...base.peripherals, ...extra };
      return buildQuickProject({ ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 180kW Dual", count: 4 }], installMethod: "trench" as const }, base, "t", HARDWARE_ALLOWANCE);
    };
    const concrete = (p: Project) => computeEstimate(p).peripherals.lines.civil.find((c) => c.name.startsWith("Concrete ("))!.qty;
    // Same bollard count on both so only the pad moves.
    const a = dig({});
    const b = dig({ existingSwitchgear: true });
    b.peripherals.bollardsQty = a.peripherals.bollardsQty;
    expect(concrete(a) - concrete(b)).toBeGreaterThanOrEqual(1);
  });
});

describe("EVSE disconnects", () => {
  const gearLine = (p: Project) => line(p, "Electrical Sub-Panels, Transformers, Breakers");

  it("steps the default rate with the largest DC branch breaker", () => {
    expect(disconnectRateFor(200)).toBe(DISCONNECT_RATES.upTo250A);
    expect(disconnectRateFor(400)).toBe(DISCONNECT_RATES.upTo400A);
    expect(disconnectRateFor(600)).toBe(DISCONNECT_RATES.above400A);
    // Four 180 kW duals sit behind 400 A breakers.
    const r = computeEstimate(garageProject({ disconnectQty: 4 }));
    expect(r.panel.suggestedGear.some((g) => g.item === "Branch breaker" && g.size === "400A")).toBe(true);
    expect(r.peripherals.disconnectUnitCost).toBe(DISCONNECT_RATES.upTo400A);
    expect(r.peripherals.disconnectsTotal).toBe(4 * DISCONNECT_RATES.upTo400A);
  });

  it("keys the default off the charger breakers, not a larger transformer primary", () => {
    // Twelve 180 kW duals (400 A breakers) with enough Level 2 for a 500 kVA step-down, whose primary breaker is 500 A.
    const base: Project = defaultProject();
    base.peripherals = { ...base.peripherals, disconnectQty: 12 };
    const big = buildQuickProject({ ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 180kW Dual", count: 12 }, { loadTypeId: "L2 Dual 40A", count: 29 }] }, base, "t", HARDWARE_ALLOWANCE);
    const r = computeEstimate(big);
    expect(r.panel.transformer!.primaryBreakerA).toBeGreaterThan(400);
    expect(r.peripherals.disconnectUnitCost).toBe(DISCONNECT_RATES.upTo400A);
  });

  it("prices into the sub-panels / transformers / breakers line, and nothing when uncounted", () => {
    const none = garageProject();
    const four = garageProject({ disconnectQty: 4 });
    expect(gearLine(four) - gearLine(none)).toBeCloseTo(4 * DISCONNECT_RATES.upTo400A, 6);
    expect(computeEstimate(none).peripherals.disconnectsTotal).toBe(0);
    expect(line(four, "Main Distribution Switchgear")).toBe(line(none, "Main Distribution Switchgear"));
  });

  it("takes a typed price, which the price reset clears back to the amperage default", () => {
    const quoted = garageProject({ disconnectQty: 4, disconnectUnitCost: 5500 });
    expect(computeEstimate(quoted).peripherals.disconnectsTotal).toBe(4 * 5500);
    expect(PERIPHERAL_PRICE_KEYS).toContain("disconnectUnitCost");
    const reset = resetPeripheralPrices(quoted.peripherals);
    expect(reset.disconnectUnitCost).toBeUndefined();
    expect(reset.disconnectQty).toBe(4);
  });
});

describe("the intake's override register says what the gear money is", () => {
  it("names the main breaker, the retained board, the disconnects and the cores", () => {
    const p = garageProject({ existingSwitchgear: true, disconnectQty: 4, coringQty: 15 });
    const rows = estimatorOverrideRows(p, computeEstimate(p), null);
    const gear = rows.find((r) => r.row === 10)!.reason;
    expect(gear).toMatch(/main breaker into the existing switchgear/);
    expect(gear).not.toMatch(/480 V switchgear/);
    expect(gear).toMatch(/4 EVSE disconnect/);
    expect(rows.find((r) => r.row === 9)!.reason).toMatch(/15 core-drilled/);
    const plain = estimatorOverrideRows(garageProject(), computeEstimate(garageProject()), null);
    expect(plain.find((r) => r.row === 10)!.reason).toMatch(/480 V switchgear/);
    expect(plain.find((r) => r.row === 9)!.reason).not.toMatch(/core-drilled/);
  });
});
