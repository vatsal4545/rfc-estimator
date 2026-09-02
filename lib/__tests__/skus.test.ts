import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, RATE_CARD, buildQuickProject, defaultQuickInput } from "../calc/autoplan";
import { defaultProject } from "../calc/defaults";
import { computeEstimate } from "../calc/engine";
import { DEFAULT_LOAD_TYPES } from "../calc/tables";
import type { Project } from "../calc/types";
import { autoHardwareCost, reconcileHardwareCost } from "../catalog";
import { defaultCommercial, defaultServiceTerms } from "../proposal/defaults";
import { PRICE_BOOK, SERVICE_RATES, findSku } from "../ref/priceBook";
import {
  applyEquipmentSchedule,
  computeEquipmentSchedule,
  dcServiceClass,
  hardwareListTotal,
  loadTypeIdForSku,
  portsForSku,
  reconcileServiceTerms,
  serviceClassForLoadType,
  serviceClassForSku,
} from "../skus";

const lt = (id: string) => DEFAULT_LOAD_TYPES.find((l) => l.id === id)!;

describe("SKU → load type", () => {
  const cases: [string, string | null][] = [
    ["TP5-360-480-2-300", "DCFC 360kW Dual"],
    ["TP5-360-480-1-300", "DCFC 360kW Dual"], // two cables (CCS1 & NACS) — a dual-cable unit
    ["HPC-360-480-4-BAA", "DCFC 360kW Dual"],
    ["TP5-240-480-2-300", "DCFC 240kW Dual"],
    ["CTX-AiO-240-5-300", "DCFC 240kW"], // single CCS1
    ["CTX-AiO-120-5-350", "DCFC 120kW"],
    ["TP5-160-480-1", "DCFC 160kW"], // description says Single
    ["TP5-60-480-2-BAA", "DCFC 60kW Dual"],
    ["TP5-30-480-1", "DCFC 30kW"],
    ["CTX-V2G-20-480-1", "DCFC 30kW"],
    ["CTX-V2G-60-480-1", "DCFC 60kW"],
    ["CTX-C32-240-1", "L2 Single 32A"],
    ["CTX-R40-240-1", "L2 Single 40A"],
    ["CTX-C48-240-1", "L2 Single 48A"],
    ["CTX-C80-240-1-ISO", "L2 Single 80A"],
    ["CTX-C40-240-2", "L2 Dual 40A"],
    ["CTX-C80-240-2-ISO", "L2 Dual 80A"],
    ["CTX-DSPB-360", "Power cabinet 360kW"],
    ["CTX-DSPB-480", "Power cabinet 480kW"],
    ["CTX-DSPB-1280", "Power cabinet 1280kW"],
    ["CTX-DST-2-300", null],
    ["CTX-FLUXPED", null],
  ];
  it.each(cases)("%s → %s", (sku, expected) => {
    expect(loadTypeIdForSku(findSku(sku)!)).toBe(expected);
  });

  it("maps every charger SKU in the book to a real load type", () => {
    const chargers = PRICE_BOOK.filter((s) => s.role === "all_in_one" || s.role === "level_2" || s.role === "power_cabinet");
    const ids = new Set(DEFAULT_LOAD_TYPES.map((l) => l.id));
    for (const s of chargers) {
      const id = loadTypeIdForSku(s);
      expect(id, s.sku).not.toBeNull();
      expect(ids.has(id!), s.sku).toBe(true);
    }
  });

  it("the new price-book models size sensibly", () => {
    // CTX-DSPB-480: 2 circuits at 315 A → 400 A breakers; 630 A unit input on the panel.
    const cab = lt("Power cabinet 480kW");
    expect(cab.runsPerUnit).toBe(2);
    expect(cab.feederOcpdA).toBe(400);
    expect(cab.unitInputAmps).toBeCloseTo(630.3, 1);
    expect(cab.portsPerUnit).toBe(0);
    expect(lt("L2 Single 48A").feederOcpdA).toBe(60);
    expect(lt("DCFC 30kW").feederOcpdA).toBe(50);
  });
});

describe("service classes", () => {
  it("picks the exact DC class where the book has one and the next class up where it does not", () => {
    expect(dcServiceClass(360).rate!.class).toBe("DC-360kW CCS1 + CCS1");
    expect(dcServiceClass(360).exact).toBe(true);
    const c200 = dcServiceClass(200);
    expect(c200.rate!.class).toBe("DC-240KW");
    expect(c200.exact).toBe(false);
    expect(c200.note).toMatch(/240 kW rates used/);
    expect(dcServiceClass(30).rate!.class).toBe("DC-60kW CCS1 + NACS");
    expect(dcServiceClass(400).rate!.class).toBe("DC-360kW CCS1 + CCS1"); // above the top class: the top class
  });

  it("maps SKUs and generic models to their classes", () => {
    expect(serviceClassForSku(findSku("CTX-C40-240-2")!).rate!.class).toMatch(/Dual/);
    expect(serviceClassForSku(findSku("CTX-C48-240-1")!).rate!.class).toMatch(/Single/);
    expect(serviceClassForSku(findSku("CTX-DSPB-480")!).rate!.class).toBe("CTX-DSPB-480");
    expect(serviceClassForSku(findSku("CTX-DST-2-300")!).rate!.class).toMatch(/^CTX-DST/);
    expect(serviceClassForSku(findSku("CTX-FLUXPED")!).rate).toBeUndefined();
    expect(serviceClassForLoadType(lt("DCFC 200kW")).rate!.class).toBe("DC-240KW");
    expect(serviceClassForLoadType(lt("L2 Dual 40A")).rate!.class).toMatch(/Dual/);
    expect(serviceClassForLoadType(lt("Power cabinet 1280kW")).rate!.class).toBe("CTX-DSPB-1280");
  });

  it("the book's year-3 rate is warranty + service for every class, so the split reproduces the CEO's total", () => {
    for (const r of SERVICE_RATES) expect(r.yearlyWarranty + r.inWarrantyService).toBeCloseTo(r.warrantyPlusServiceYr3, 1);
  });

  it("counts billable ports per SKU", () => {
    expect(portsForSku(findSku("TP5-360-480-2-300")!)).toBe(2);
    expect(portsForSku(findSku("CTX-AiO-240-5-300")!)).toBe(1);
    expect(portsForSku(findSku("CTX-DST-2-300")!)).toBe(2);
    expect(portsForSku(findSku("CTX-DSPB-480")!)).toBe(0);
    expect(portsForSku(findSku("CTX-FLUXPED")!)).toBe(0);
  });
});

/** Best Western: 4 × TP5-360-480-2-300 + 2 × CTX-C40-240-2, 5-year contract, EVOLV $39.99/port/month. */
function bwProject(): Project {
  const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
  const quick = {
    ...defaultQuickInput(),
    lines: [
      { loadTypeId: "DCFC 360kW Dual", count: 4, sku: "TP5-360-480-2-300" },
      { loadTypeId: "L2 Dual 40A", count: 2, sku: "CTX-C40-240-2" },
    ],
  };
  return buildQuickProject(quick, base, "bw");
}

describe("equipment schedule — Best Western configuration", () => {
  const project = bwProject();
  const s = computeEquipmentSchedule(project);

  it("prices hardware at the price book's list and counts twelve ports", () => {
    expect(s.hasSkus).toBe(true);
    expect(s.hardwareList).toBeCloseTo(4 * 99000 + 2 * 1952.5, 6);
    expect(s.ports).toBe(12); // 8 DC + 4 L2 — Inputs!B25 in the BW model
    expect(s.connectedKw).toBeCloseTo(4 * 360 + 2 * 16.64, 6);
  });

  it("reproduces the BW model's EVOLV line: 12 ports × $39.99 × 12 × 5 = $28,792.80", () => {
    expect(s.evolvTotal).toBeCloseTo(28792.8, 6);
  });

  it("splits the CEO's service formula into extended warranty and service, to the cent", () => {
    // CEO: per cabinet = in-warranty service × included years + year-3 rate × (contract − included).
    const dc = SERVICE_RATES.find((r) => r.class === "DC-360kW CCS1 + CCS1")!;
    const ac = SERVICE_RATES.find((r) => r.class === "AC Charger - 2 x 7.2 kW UP160J-PMP Dual")!;
    const ceoDc = dc.inWarrantyService * 2 + dc.warrantyPlusServiceYr3 * 3; // 2 years included on DC
    const ceoAc = ac.inWarrantyService * 1 + ac.warrantyPlusServiceYr3 * 4; // 1 year included on AC
    expect(s.warrantyTotal + s.serviceTotal).toBeCloseTo(4 * ceoDc + 2 * ceoAc, 2);
    expect(s.warrantyTotal).toBeCloseTo(4 * dc.yearlyWarranty * 3 + 2 * ac.yearlyWarranty * 4, 2);
    expect(s.serviceTotal).toBeCloseTo(4 * dc.inWarrantyService * 5 + 2 * ac.inWarrantyService * 5, 2);
    expect(s.lines[0].includedYears).toBe(2);
    expect(s.lines[1].includedYears).toBe(1);
  });

  it("applyEquipmentSchedule writes the financial lines and flags them auto", () => {
    const p = applyEquipmentSchedule(project);
    expect(p.financial.chargerHardwareCost).toBeCloseTo(s.hardwareList, 6);
    expect(p.financial.chargerHardwareCostIsAuto).toBe(true);
    expect(p.financial.chargerWarrantyCost).toBeCloseTo(s.warrantyTotal, 6);
    expect(p.financial.fiveYearServiceCost).toBeCloseTo(s.serviceTotal, 6);
    expect(p.financial.evolvCommissioningCost).toBeCloseTo(28792.8, 6);
    expect(p.financial.serviceTermsAuto).toBe(true);
    // The engine sizes from the load types the SKUs mapped to — 4 dual 360s + 2 L2 duals.
    const r = computeEstimate(p);
    expect(r.rollups.nDCFC).toBe(4);
    expect(r.rollups.nL2).toBe(2);
  });

  it("the included-warranty override and the contract length move every derived line", () => {
    const p = applyEquipmentSchedule({
      ...project,
      commercial: { ...project.commercial!, serviceTerms: { basis: "price-book", contractYears: 10, evolvPerPortMonth: 39.99, includedWarrantyYears: 0 } },
    });
    const dc = SERVICE_RATES.find((r) => r.class === "DC-360kW CCS1 + CCS1")!;
    const ac = SERVICE_RATES.find((r) => r.class === "AC Charger - 2 x 7.2 kW UP160J-PMP Dual")!;
    expect(p.financial.chargerWarrantyCost).toBeCloseTo(4 * dc.yearlyWarranty * 10 + 2 * ac.yearlyWarranty * 10, 2);
    expect(p.financial.evolvCommissioningCost).toBeCloseTo(12 * 39.99 * 12 * 10, 6);
  });
});

describe("reconcile and manual overrides", () => {
  const project = applyEquipmentSchedule(bwProject());

  it("re-derives auto service lines when the terms change, and leaves current ones untouched", () => {
    expect(reconcileServiceTerms(project)).toBe(project); // already current → same object
    const longer = { ...project, commercial: { ...project.commercial!, serviceTerms: { ...defaultServiceTerms(), contractYears: 7 } } };
    const r = reconcileServiceTerms(longer);
    expect(r.financial.evolvCommissioningCost).toBeCloseTo(12 * 39.99 * 12 * 7, 6);
  });

  it("never touches a hand-typed service line", () => {
    const manual = { ...project, financial: { ...project.financial, serviceTermsAuto: false, evolvCommissioningCost: 1234 } };
    const longer = { ...manual, commercial: { ...manual.commercial!, serviceTerms: { ...defaultServiceTerms(), contractYears: 7 } } };
    expect(reconcileServiceTerms(longer).financial.evolvCommissioningCost).toBe(1234);
    expect(applyEquipmentSchedule({ ...manual, financial: { ...manual.financial, chargerHardwareCostIsAuto: false, chargerHardwareCost: 5 } }).financial.chargerHardwareCost).toBe(5);
  });

  it("the allowance basis keeps the estimator's commissioning allowance and generic pricing", () => {
    const base: Project = { ...defaultProject(), commercial: { ...defaultCommercial(), serviceTerms: { basis: "allowance", contractYears: 5, evolvPerPortMonth: 39.99 } } };
    const built = buildQuickProject(defaultQuickInput(), base, "t");
    const p = applyEquipmentSchedule(built);
    expect(p.financial.evolvCommissioningCost).toBe(6 * RATE_CARD.commissioningPerDcfc + 5 * RATE_CARD.commissioningPerL2);
    expect(p.financial.chargerWarrantyCost).toBe(built.financial.chargerWarrantyCost);
    expect(p.financial.chargerHardwareCost).toBe(6 * HARDWARE_ALLOWANCE["DCFC 200kW"] + 5 * HARDWARE_ALLOWANCE["L2 Single 40A"]);
    expect(p.financial.serviceTermsAuto).toBe(false);
  });

  it("legacy projects without a commercial section or SKUs keep their numbers", () => {
    const built = buildQuickProject(defaultQuickInput(), defaultProject(), "t");
    expect(reconcileServiceTerms(built)).toBe(built);
    expect(hardwareListTotal(built)).toBe(built.financial.chargerHardwareCost);
    expect(autoHardwareCost(built, HARDWARE_ALLOWANCE)).toBe(built.financial.chargerHardwareCost);
  });

  it("excluded hardware zeroes every equipment line", () => {
    const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
    const p = applyEquipmentSchedule(buildQuickProject({ ...defaultQuickInput(), includeChargerHardware: false }, base, "t"));
    expect(p.financial.chargerHardwareCost).toBe(0);
    expect(p.financial.evolvCommissioningCost).toBe(0);
    expect(p.financial.fiveYearServiceCost).toBe(0);
  });
});

describe("dispensers, accessories and the catalog", () => {
  it("prices extras, counts dispenser ports and validates them against the cabinets", () => {
    const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
    const quick = {
      ...defaultQuickInput(),
      lines: [{ loadTypeId: "Power cabinet 480kW", count: 1, sku: "CTX-DSPB-480" }],
      extras: [
        { sku: "CTX-DST-2-300", count: 4 },
        { sku: "CTX-FLUXPED", count: 2 },
      ],
    };
    const p = buildQuickProject(quick, base, "t");
    const s = computeEquipmentSchedule(p);
    expect(s.cabinets).toBe(1);
    expect(s.dispensers).toBe(4);
    expect(s.dispenserCapacity).toBe(3);
    expect(s.warnings.some((w) => w.includes("exceed"))).toBe(true);
    expect(s.ports).toBe(8); // cabinet 0 + 4 dispensers × 2
    const fluxped = findSku("CTX-FLUXPED")!;
    expect(s.hardwareList).toBeCloseTo(findSku("CTX-DSPB-480")!.msrp + 4 * findSku("CTX-DST-2-300")!.msrp + 2 * fluxped.msrp, 6);
    const acc = s.lines.find((l) => l.sku === "CTX-FLUXPED")!;
    expect(acc.ports).toBe(0);
    expect(acc.serviceTotal).toBe(0);
    const disp = s.lines.find((l) => l.sku === "CTX-DST-2-300")!;
    expect(disp.serviceClass).toMatch(/^CTX-DST/);
    // Electrically the cabinet is one DCFC-category unit with two 315 A circuits.
    const r = computeEstimate(p);
    expect(r.rollups.nDCFC).toBe(1);
    expect(r.rollups.nCircuits).toBe(2);
  });

  it("warns when dispensers have no cabinet, and when a cabinet has no dispensers", () => {
    const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
    const noCab = computeEquipmentSchedule(buildQuickProject({ ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 60kW", count: 1 }], extras: [{ sku: "CTX-DST-2-300", count: 1 }] }, base, "t"));
    expect(noCab.warnings.some((w) => w.includes("need a power cabinet"))).toBe(true);
    const noDisp = computeEquipmentSchedule(buildQuickProject({ ...defaultQuickInput(), lines: [{ loadTypeId: "Power cabinet 480kW", count: 1, sku: "CTX-DSPB-480" }] }, base, "t"));
    expect(noDisp.warnings.some((w) => w.includes("no connectors of their own"))).toBe(true);
  });

  it("the global catalog's auto hardware cost is SKU-aware and still honours model overrides", () => {
    const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
    const quick = {
      ...defaultQuickInput(),
      lines: [
        { loadTypeId: "DCFC 240kW Dual", count: 2, sku: "TP5-240-480-2-300" },
        { loadTypeId: "L2 Single 40A", count: 3 },
      ],
    };
    const p = buildQuickProject(quick, base, "t");
    const allowance = { ...HARDWARE_ALLOWANCE, "L2 Single 40A": 1000 };
    expect(autoHardwareCost(p, allowance)).toBeCloseTo(2 * 80000 + 3 * 1000, 6);
    const reconciled = reconcileHardwareCost(p, allowance);
    expect(reconciled.financial.chargerHardwareCost).toBeCloseTo(2 * 80000 + 3 * 1000, 6);
  });
});
