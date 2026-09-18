import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../autoplan";
import { defaultProject } from "../defaults";
import { DESIGN_UNIT_RATES, applyTypedDesignSets, clearDesignSets, designRate, designSets, designSetsTyped, withDesignRate, withDesignSets } from "../designFees";

// Design and engineering as the intake prices it: quantity × rate on each row.
describe("design fees as quantity × rate", () => {
  const f = { ...defaultProject().financial, autoCadDesignCost: 9650, electricalEngDesignCost: 21150 };

  it("reads a market-rate fee as the sets it buys at the template's rate", () => {
    expect(designRate(f, "autoCad")).toBe(DESIGN_UNIT_RATES.autoCad);
    expect(designSets(f, "autoCad")).toBeCloseTo(9650 / 3412.5, 4);
    expect(designSets(f, "ee")).toBeCloseTo(21150 / 2080, 4);
    expect(designSetsTyped(f, "autoCad")).toBe(false);
  });

  it("a typed quantity makes the fee quantity × rate; a typed rate keeps the quantity and moves the fee", () => {
    const typed = withDesignSets(f, "autoCad", 3);
    expect(typed.autoCadSets).toBe(3);
    expect(typed.autoCadDesignCost).toBe(10237.5);
    expect(designSetsTyped(typed, "autoCad")).toBe(true);
    const repriced = withDesignRate(typed, "autoCad", 3600);
    expect(repriced.autoCadSets).toBe(3);
    expect(repriced.autoCadSetRate).toBe(3600);
    expect(repriced.autoCadDesignCost).toBe(10800);
    // Typing a rate on an untyped row pins the sets in force first (column B fixed, column D changed).
    const rateFirst = withDesignRate(f, "ee", 2500);
    expect(rateFirst.eeSets).toBeCloseTo(21150 / 2080, 4);
    expect(rateFirst.electricalEngDesignCost).toBeCloseTo((21150 / 2080) * 2500, 0);
    expect(clearDesignSets(repriced, "autoCad").autoCadSets).toBeUndefined();
  });

  it("a typed quantity survives a Build: the market-rate fee yields to sets × rate", () => {
    expect(applyTypedDesignSets({ ...f, eeSets: 2 }).electricalEngDesignCost).toBe(4160);
    const base = defaultProject();
    base.financial = withDesignSets(base.financial, "autoCad", 2);
    const built = buildQuickProject({ ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 240kW", count: 4 }] }, base, "t", HARDWARE_ALLOWANCE);
    expect(built.financial.autoCadSets).toBe(2);
    expect(built.financial.autoCadDesignCost).toBe(6825);
    expect(built.financial.electricalEngDesignCost).toBeGreaterThan(0); // the untyped row still gets the market-rate fee
  });
});
