import { describe, expect, it } from "vitest";
import {
  ADA_UNIT_COST,
  GPR_ITEM_NAME,
  TERRAIN_INFO,
  adaStallBreakdown,
  adaStallCount,
  buildQuickProject,
  defaultQuickInput,
  estimateTimeline,
  timelineTotal,
} from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import type { QuickEstimateInput } from "../types";

function ceoInput(overrides: Partial<QuickEstimateInput> = {}): QuickEstimateInput {
  // The motivating scenario: "6x 200kW level-3 chargers and 5x level-2 40A".
  return {
    ...defaultQuickInput(),
    clientName: "Test Client",
    siteAddress: "1 Test Way",
    lines: [
      { loadTypeId: "DCFC 200kW", count: 6 },
      { loadTypeId: "L2 Single 40A", count: 5 },
    ],
    ...overrides,
  };
}

describe("buildQuickProject", () => {
  it("expands 6 DCFC + 5 L2 into a fully-derived project", () => {
    const p = buildQuickProject(ceoInput(), defaultProject(), "t");
    const r = computeEstimate(p);

    expect(p.takeoff).toHaveLength(11);
    // Two trench legs, one per level: DCFC 100+15×5 = 175 ft, L2 100+15×4 = 160 ft.
    expect(p.setup.trenchLengthFt).toBe(100 + 15 * 5 + (100 + 15 * 4));
    expect(r.rollups.nDCFC).toBe(6);
    expect(r.rollups.nL2).toBe(5);

    // Everything the CEO used to type by hand is now non-zero.
    expect(p.financial.autoCadDesignCost).toBeGreaterThan(0);
    expect(p.financial.electricalEngDesignCost).toBeGreaterThan(0);
    expect(p.financial.pmHours).toBeGreaterThanOrEqual(24);
    expect(p.financial.planCheckPermitFee).toBeGreaterThan(0);
    expect(p.financial.laborBusinessDays).toBeGreaterThan(0);
    expect(p.financial.chargerHardwareCost).toBe(6 * 92000 + 5 * 4000);
    expect(p.peripherals.permitFeeTotal).toBe(200 + 60 * 11);
    expect(p.peripherals.utilityAppFee).toBe(2500);
    expect(p.peripherals.bollardsQty).toBe(24);
    // CBC 11B-228.3.2: each charging level is its own facility — the table
    // runs separately for the 6 DCFC (1 van + 1 std) and the 5 L2 (1 van +
    // 1 std), then sums: 2 van + 2 standard + 0 ambulatory.
    expect(p.peripherals.adaVanQty).toBe(2);
    expect(p.peripherals.adaStdQty).toBe(2);
    expect(p.peripherals.adaAmbQty).toBe(0);
    expect(p.peripherals.adaQtyOverride).toBeUndefined();
    expect(r.peripherals.adaAllowance).toBe(
      2 * ADA_UNIT_COST.van + 2 * ADA_UNIT_COST.standard + ADA_UNIT_COST.ramp,
    );
    expect(r.costs.totalCost).toBeGreaterThan(0);

    // GPR scan: 250 trench-ft → 1 crew day at the day rate.
    const gpr = (p.peripherals.customItems ?? []).find((c) => c.name === GPR_ITEM_NAME);
    expect(gpr).toBeDefined();
    expect(gpr!.qty).toBe(1);
    expect(gpr!.unitCost).toBe(1500);
  });

  it("multi-DCFC SLD fee lands in the market-typical band (~$12k)", () => {
    const p = buildQuickProject(ceoInput(), defaultProject(), "t");
    expect(p.financial.electricalEngDesignCost).toBeGreaterThanOrEqual(10000);
    expect(p.financial.electricalEngDesignCost).toBeLessThanOrEqual(15000);
  });

  it("scales trenching cost and labor by terrain", () => {
    const flat = buildQuickProject(ceoInput({ terrain: "flat" }), defaultProject(), "t");
    const hilly = buildQuickProject(ceoInput({ terrain: "hilly" }), defaultProject(), "t");
    const rFlat = computeEstimate(flat);
    const rHilly = computeEstimate(hilly);

    expect(hilly.setup.trenchCostMultiplier).toBe(TERRAIN_INFO.hilly.trenchFactor);
    expect(rHilly.peripherals.asphaltTrenching).toBeCloseTo(
      rFlat.peripherals.asphaltTrenching * 1.5,
      6,
    );
    expect(hilly.financial.laborBusinessDays).toBeGreaterThan(flat.financial.laborBusinessDays);
    expect(hilly.peripherals.dumpWasteCost).toBeGreaterThan(flat.peripherals.dumpWasteCost);

    // Sloped lots regrade every accessible stall to the 2% limit (11B-812.3).
    expect(flat.peripherals.adaVanUnitCost).toBe(ADA_UNIT_COST.van);
    expect(hilly.peripherals.adaVanUnitCost).toBe(
      Math.round(ADA_UNIT_COST.van * TERRAIN_INFO.hilly.adaRegradeFactor),
    );
    expect(rHilly.peripherals.adaAllowance).toBeGreaterThan(rFlat.peripherals.adaAllowance);
  });

  it("L2-only sites use the streamlined flat plan-check fee", () => {
    const p = buildQuickProject(
      ceoInput({ lines: [{ loadTypeId: "L2 Single 40A", count: 5 }] }),
      defaultProject(),
      "t",
    );
    expect(p.financial.planCheckPermitFee).toBe(300);
    expect(p.peripherals.utilityAppFee).toBe(800);
    expect(p.peripherals.transformerPadCost).toBe(0);
  });

  it("service toggles zero out their lines", () => {
    const p = buildQuickProject(
      ceoInput({
        includeChargerHardware: false,
        includeSitePlanDesign: false,
        includeSldDesign: false,
        includeCpm: false,
        includePermits: false,
        includePrivateScan: false,
      }),
      defaultProject(),
      "t",
    );
    expect(p.financial.chargerHardwareCost).toBe(0);
    expect(p.financial.evolvCommissioningCost).toBe(0);
    expect(p.financial.autoCadDesignCost).toBe(0);
    expect(p.financial.electricalEngDesignCost).toBe(0);
    expect(p.financial.pmHours).toBe(0);
    expect(p.financial.planCheckPermitFee).toBe(0);
    expect(p.peripherals.permitFeeTotal).toBe(0);
    expect(p.peripherals.utilityAppFee).toBe(0);
    expect((p.peripherals.customItems ?? []).some((c) => c.name === GPR_ITEM_NAME)).toBe(false);
  });

  it("does not mutate the base project and stays deterministic", () => {
    const base = defaultProject();
    const snapshot = JSON.stringify(base);
    const a = buildQuickProject(ceoInput(), base, "t");
    const b = buildQuickProject(ceoInput(), base, "t");
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("CPM hours track ~5% of construction valuation at the PM rate", () => {
    const p = buildQuickProject(ceoInput(), defaultProject(), "t");
    const r = computeEstimate(p);
    const valuation = r.costs.electricalSupplyConstructionTotal + r.costs.labor;
    const expected = Math.round((0.05 * valuation) / p.financial.pmHourlyRate);
    // Valuation moves slightly between pass 1 (fee lines unset) and the final
    // project, so allow a small tolerance rather than exact equality.
    expect(Math.abs(p.financial.pmHours - expected) / expected).toBeLessThan(0.15);
  });
});

describe("adaStallBreakdown (CBC Table 11B-228.3.2.1 / 11B-812)", () => {
  const bd = adaStallBreakdown;
  it("matches every row of the code table", () => {
    expect(bd(0)).toEqual({ van: 0, standard: 0, ambulatory: 0, total: 0 });
    expect(bd(1)).toEqual({ van: 1, standard: 0, ambulatory: 0, total: 1 });
    expect(bd(4)).toEqual({ van: 1, standard: 0, ambulatory: 0, total: 1 });
    expect(bd(5)).toEqual({ van: 1, standard: 1, ambulatory: 0, total: 2 });
    expect(bd(25)).toEqual({ van: 1, standard: 1, ambulatory: 0, total: 2 });
    expect(bd(26)).toEqual({ van: 1, standard: 1, ambulatory: 1, total: 3 });
    expect(bd(50)).toEqual({ van: 1, standard: 1, ambulatory: 1, total: 3 });
    expect(bd(51)).toEqual({ van: 1, standard: 2, ambulatory: 2, total: 5 });
    expect(bd(75)).toEqual({ van: 1, standard: 2, ambulatory: 2, total: 5 });
    expect(bd(76)).toEqual({ van: 1, standard: 3, ambulatory: 3, total: 7 });
    expect(bd(100)).toEqual({ van: 1, standard: 3, ambulatory: 3, total: 7 });
  });
  it("applies the over-100 'per N or fraction thereof' formulas (van per 300)", () => {
    // 101: fraction over 100 → +1 in every column.
    expect(bd(101)).toEqual({ van: 2, standard: 4, ambulatory: 4, total: 10 });
    // 160: 60 over → van +1, standard +1 (60/60), ambulatory +2 (60/50 → 1.2 → 2).
    expect(bd(160)).toEqual({ van: 2, standard: 4, ambulatory: 5, total: 11 });
    // 400: 300 over → van 1+1, standard 3+5, ambulatory 3+6.
    expect(bd(400)).toEqual({ van: 2, standard: 8, ambulatory: 9, total: 19 });
    expect(adaStallCount(400)).toBe(19);
  });
});

describe("estimateTimeline", () => {
  it("builds a schedule where the utility phase is parallel", () => {
    const p = buildQuickProject(ceoInput(), defaultProject(), "t");
    const r = computeEstimate(p);
    const phases = estimateTimeline(p, r);
    expect(phases.length).toBeGreaterThan(4);
    const utility = phases.find((ph) => ph.name.startsWith("Utility"));
    expect(utility?.parallel).toBe(true);
    const total = timelineTotal(phases);
    expect(total.lowDays).toBeGreaterThan(0);
    expect(total.highDays).toBeGreaterThanOrEqual(total.lowDays);
    // On a DCFC site the utility queue (up to 250 days) outlasts the whole
    // sequential path and becomes the critical-path high end.
    expect(total.highDays).toBe(250);
  });
});
