import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE } from "../../calc/autoplan";
import { GEAR_CATALOG } from "../../calc/tables";
import { INTAKE_GEAR_480V, MARKET_BENCHMARKS } from "../benchmarks";
import { ARCHITECTURE, CAPACITIES, PRICE_BOOK, REFDATA_META, SERVICE_RATES, findSku } from "../priceBook";
import { RATE_LIBRARY } from "../rateLibrary";
import { RATE_SCHEDULE_PICKER, UTILITIES } from "../utilities";

// The reference tables are generated from the CEO's EVSE Project Intake
// template (scripts/import-intake-refdata.py). These checks pin the shape and
// a few values read straight off the workbook, so a regeneration from a new
// template that moved a column or lost a row fails loudly.

describe("reference data — provenance", () => {
  it("records the template it came from", () => {
    expect(REFDATA_META.templateVersion).toBe("2.9.0");
    expect(REFDATA_META.contentHash).toBe("4aecae7d4b5f25a9");
    expect(REFDATA_META.released).toBe("2026-08-29");
  });
});

describe("price book", () => {
  it("carries all 92 SKUs with roles, capacities and list prices", () => {
    expect(PRICE_BOOK).toHaveLength(92);
    expect(PRICE_BOOK.every((s) => s.sku && s.role && s.msrp >= 0)).toBe(true);
    expect(PRICE_BOOK.filter((s) => s.role === "power_cabinet").map((s) => s.sku)).toEqual([
      "CTX-DSPB-360",
      "CTX-DSPB-480",
      "CTX-DSPB-1280",
    ]);
    expect(PRICE_BOOK.filter((s) => s.role === "dispenser")).toHaveLength(2);
    expect(PRICE_BOOK.filter((s) => s.role === "accessory")).toHaveLength(5);
    expect(PRICE_BOOK.filter((s) => s.role === "level_2")).toHaveLength(10);
  });

  it("reads the Best Western cabinet and a Level 2 dual off PriceBook!D", () => {
    const tp5 = findSku("TP5-360-480-2-300")!;
    expect(tp5.msrp).toBe(99000);
    expect(tp5.ratedKw).toBe(360);
    expect(tp5.connectors).toBe(2);
    expect(tp5.capacity).toBe("360 kW DC");
    expect(tp5.role).toBe("all_in_one");
    const l2 = findSku("CTX-C40-240-2")!;
    expect(l2.msrp).toBe(1952.5);
    expect(l2.ratedKw).toBe(7.2); // rating supplied by the capacity index (the book lists none for L2)
    expect(l2.connectors).toBe(2);
    // Buy America rows also take their rating from the capacity index.
    expect(findSku("TP5-60-480-2-BAA")!.ratedKw).toBe(60);
    expect(CAPACITIES.find((c) => c.capacity === "Level 2 AC")!.perPort).toBe(1);
  });

  it("evaluates the derived distributed-system service rates (uncached formulas)", () => {
    const base = SERVICE_RATES.find((r) => r.class === "DC-360kW CCS1 + CCS1")!;
    expect(base.yearlyWarranty).toBe(4051.08);
    expect(base.inWarrantyService).toBe(4898.88);
    expect(base.warrantyPlusServiceYr3).toBe(8949.96);
    expect(base.includedWarranty).toBe("2 years, parts only");
    expect(base.outOfWarrantyService).toBe("NOT OFFERED");
    // CTX-DSPB-360 = 360 kW rates + 25%; DSPB-480 = +30% / +25%; DSPB-1280 = +50% / +25%.
    const d360 = SERVICE_RATES.find((r) => r.class === "CTX-DSPB-360")!;
    expect(d360.yearlyWarranty).toBeCloseTo(4051.08 * 1.25, 2);
    expect(d360.inWarrantyService).toBeCloseTo(4898.88 * 1.25, 2);
    expect(d360.warrantyPlusServiceYr3).toBeCloseTo(4051.08 * 1.25 + 4898.88 * 1.25, 2);
    const d1280 = SERVICE_RATES.find((r) => r.class === "CTX-DSPB-1280")!;
    expect(d1280.yearlyWarranty).toBeCloseTo(4051.08 * 1.25 * 1.3 * 1.5, 1);
    expect(d1280.inWarrantyService).toBeCloseTo(4898.88 * 1.25 * 1.25 * 1.25, 1);
    expect(SERVICE_RATES.find((r) => r.class === "AC Charger - 7.2 kW UP80J-PMP Single")!.yearlyWarranty).toBe(416);
  });

  it("carries the Nexus architecture table", () => {
    const c480 = ARCHITECTURE.find((a) => a.sku === "CTX-DSPB-480")!;
    expect(c480.acKw).toBe(524);
    expect(c480.dcKw).toBe(480);
    expect(c480.maxDualDispensers).toBe(3);
    expect(ARCHITECTURE.find((a) => a.sku === "CTX-DSPB-1280")!.maxDualDispensers).toBe(8);
    expect(ARCHITECTURE.find((a) => a.sku === "CTX-DST-2-300")!.dcOutputs).toBe(2);
  });
});

describe("estimator hardware defaults tie to the price book", () => {
  const tie: [string, string][] = [
    ["DCFC 360kW Dual", "TP5-360-480-2-300"],
    ["DCFC 360kW", "TP5-360-480-1-300"],
    ["DCFC 240kW", "TP5-240-480-2-300"],
    ["DCFC 180kW Dual", "TP5-180-480-1"],
    ["DCFC 160kW", "TP5-160-480-1"],
    ["DCFC 120kW Dual", "TP5-120-480-1"],
    ["DCFC 60kW", "TP5-60-480-1"],
    ["L2 Dual 40A", "CTX-C40-240-2"],
    ["L2 Dual 80A", "CTX-C80-240-2"],
    ["L2 Single 80A", "CTX-C80-240-1"],
    ["L2 Single 32A", "CTX-C32-240-1"],
    ["L2 Single 40A", "CTX-C48-240-1"],
  ];
  it.each(tie)("%s is priced at the %s list price", (model, sku) => {
    expect(HARDWARE_ALLOWANCE[model]).toBe(findSku(sku)!.msrp);
  });

  it("interpolates the ratings the book has no TP5 for, along the TP5 curve, to the nearest $100", () => {
    const tp5 = (kw: number) => PRICE_BOOK.find((s) => s.sku.startsWith(`TP5-${kw}-480`) && !s.sku.endsWith("BAA"))!.msrp;
    const lerp = (kw: number, lo: number, hi: number) => tp5(lo) + ((tp5(hi) - tp5(lo)) * (kw - lo)) / (hi - lo);
    expect(HARDWARE_ALLOWANCE["DCFC 50kW"]).toBe(Math.round(lerp(50, 30, 60) / 100) * 100);
    expect(HARDWARE_ALLOWANCE["DCFC 100kW"]).toBe(Math.round(lerp(100, 60, 120) / 100) * 100);
    expect(HARDWARE_ALLOWANCE["DCFC 200kW"]).toBe(Math.round(lerp(200, 180, 240) / 100) * 100);
    expect(HARDWARE_ALLOWANCE["DCFC 275kW"]).toBe(Math.round(lerp(275, 240, 360) / 100) * 100);
    expect(HARDWARE_ALLOWANCE["DCFC 300kW"]).toBe(Math.round(lerp(300, 240, 360) / 100) * 100);
  });
});

describe("rate library, utilities, benchmarks, gear", () => {
  it("carries the researched schedules with their STATUS", () => {
    expect(RATE_LIBRARY.length).toBeGreaterThanOrEqual(30);
    const bev2s = RATE_LIBRARY.find((r) => r.schedule === "BEV-2-S")!;
    expect(bev2s.utility).toBe("PG&E — Pacific Gas and Electric");
    expect(bev2s.peakPerKwh).toBe(0.36977);
    expect(bev2s.blockKw).toBe(50);
    expect(bev2s.blockPerMonth).toBe(95.56);
    expect(bev2s.overagePerKw).toBe(3.82);
    expect(bev2s.status).toBe("VERIFIED");
    const sce = RATE_LIBRARY.find((r) => r.schedule === "TOU-EV-9")!;
    expect(sce.status).toBe("NOT PUBLISHED");
    expect(RATE_LIBRARY.every((r) => r.status.length > 0)).toBe(true);
  });

  it("lists every California and Michigan delivery utility and the schedule picker", () => {
    expect(UTILITIES.length).toBeGreaterThanOrEqual(70);
    const sce = UTILITIES.find((u) => u.utility.startsWith("SCE"))!;
    expect(sce.type).toBe("IOU");
    expect(sce.state).toBe("California");
    expect(UTILITIES.some((u) => u.utility === "DTE Electric Company")).toBe(true);
    expect(RATE_SCHEDULE_PICKER).toContain("BEV-2-S");
    expect(RATE_SCHEDULE_PICKER).toContain("TOU-EV-9");
  });

  it("carries the Paren market benchmarks", () => {
    const ca = MARKET_BENCHMARKS.find((b) => b.state === "California")!;
    expect(ca.portUtilisation).toBe(0.231);
    expect(ca.priceToDriverPerKwh).toBe(0.606);
    expect(MARKET_BENCHMARKS.find((b) => b.state === "United States (average)")!.portUtilisation).toBe(0.1576);
  });

  it("uses the same 480V switchgear price table as the estimator's GEAR_CATALOG", () => {
    const mains = INTAKE_GEAR_480V.filter((g) => g.item === "Main");
    expect(mains.length).toBeGreaterThanOrEqual(8);
    // The estimator re-set 2000A/2500A in Aug 2026 to remove the price
    // inversion the source table still carries (2500A priced below 2000A),
    // and 3000A/4000A/5000A in Sept 2026 on Larson Electronics' published
    // main-breaker boards (the source table's $67.5k / $70k top end sat below
    // even switch-only gear). Every other size must agree to the dollar; the
    // estimator's 600A and 3200A frames have no row in the source table.
    const deliberatelyDifferent = new Set(["2000A", "2500A", "3000A", "4000A", "5000A"]);
    for (const g of mains) {
      const size = g.size.replace(".0", "A").replace(/AA$/, "A");
      if (deliberatelyDifferent.has(size)) continue;
      const ours = GEAR_CATALOG.find((c) => c.item === "Main switchgear" && c.voltage === "480V" && c.size === size);
      if (ours) expect(ours.unitCost).toBeCloseTo(g.cost, 0);
    }
    expect(INTAKE_GEAR_480V.find((g) => g.item === "Main" && g.size === "1000A")!.cost).toBe(36812.5);
  });
});
