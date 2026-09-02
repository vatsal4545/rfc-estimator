import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../../calc/autoplan";
import { defaultProject } from "../../calc/defaults";
import { computeEstimate } from "../../calc/engine";
import type { CostsResult, FinancialInput } from "../../calc/types";
import { computeCostBuildup } from "../costBuildup";
import { defaultCommercial } from "../defaults";
import { computeProposal } from "../index";
import { computeMargin } from "../margin";
import type { CommercialInput } from "../types";

// ---------------------------------------------------------------------------
// Replay of BW_Model_5.xlsx — "Best Western, 15000 Hawthorn Blvd, Hawthorne
// CA" (engine 2.0.0, built from intake 1.6.0). The workbook's electrical block
// is hand-typed, so its quantities are fed in as engine cost lines; the
// build-up and margin must then reproduce its Cost_Buildup and Business_Model
// sheets to the cent. Every expected number below was read off the workbook.
// ---------------------------------------------------------------------------

function bwFinancial(): FinancialInput {
  return {
    contingencyPct: 0.1,
    laborDailyRate: 2750,
    laborBusinessDays: 30,
    applyContingencyToLabor: true,
    salesTaxPct: 0.0725,
    chargerHardwareCost: 4 * 100413.5, // Inputs!B9 MSRP each × 4 cabinets = 401,654
    chargerWarrantyCost: 0,
    // Inputs!B13/B14: 4 × (5,058.94 × 2 in-warranty years + 9,318.01 × 3) = 152,287.64
    fiveYearServiceCost: 4 * (5058.94 * 2 + 9318.01 * 3),
    evolvCommissioningCost: 12 * 39.99 * 12 * 5, // 12 ports × $39.99 × 12 × 5 years = 28,792.80
    autoCadDesignCost: 3 * 3412.5,
    electricalEngDesignCost: 3 * 2080,
    pmHours: 35,
    pmHourlyRate: 358,
    pmPctOfLabor: 0.15,
    planCheckPermitFee: 0,
  };
}

/** The workbook's Overrides!D9:D15 as engine cost lines (base, before uplift). */
function bwCosts(): CostsResult {
  const bases: [string, number][] = [
    ["Wires, Conduits & Electrical Peripherals", 2640 * 6.64016 + 880 * 2.1044 + 880 * 1.396 + 440 * 0.2912 + 400 * 4.809 + 1500],
    ["Main Distribution Switchgear", 67500 + 43333.33 + 11470 + 4 * 3700 + 2055.31],
    ["Electrical Sub-Panels, Transformers, Breakers", 0],
    ["Striping, Bollards, Signage", 2574.4],
    ["Asphalt and Paving", 9770.1],
    ["Concrete Improvements", 7921.04],
    ["ADA", 17300],
    ["Dump / Waste", 3000],
    ["Permits", 3500],
    ["Utility", 3710],
    ["Construction Equipment", 12264.63],
  ];
  const lines = bases.map(([name, base]) => ({ name, base, contingency: base * 0.1, finalCost: base * 1.1 }));
  const construction = lines.reduce((s, l) => s + l.finalCost, 0);
  const labor = 30 * 2750 * 1.1;
  const constructionPm = labor * 0.15;
  return {
    lines,
    designAndEngineering: 3 * 3412.5 + 3 * 2080 + 35 * 358,
    electricalSupplyConstructionTotal: construction,
    labor,
    constructionPm,
    salesTaxOnConstruction: construction * 0.0725,
    equipmentPurchaseInvoice: 0,
    equipmentPurchaseTax: 0,
    designInvoice: 0,
    totalCost: 0,
  };
}

/** Commercial terms as the BW model ran them (engine 2.0.0, intake 1.6.0). */
function bwCommercial(): CommercialInput {
  const c = defaultCommercial();
  return {
    ...c,
    markupMaterialsPct: 0.1,
    markupLaborPct: 0.2,
    discountHardwarePct: 0.15,
    discountServicePct: 0.15,
    discountEvolvPct: 0,
    discountInHousePct: 0, // no in-house discount existed yet
    taxConstructionMaterials: false, // BW taxed the discounted hardware only
    passThroughLines: [], // BW uplifted permits and utility fees; 2.9.0 stopped doing that
    utilityInterconnectFee: 3500, // Rule 29 design fee
    margin: {
      ...c.margin,
      hardwareCostTotal: 4 * 29000 + 2 * 828.95 + 2 * 224.6, // Business_Model!D9 = 118,107.10
    },
  };
}

describe("Cost build-up — Best Western replay (BW_Model_5.xlsx)", () => {
  const b = computeCostBuildup(bwFinancial(), bwCosts(), bwCommercial());
  const row = (id: string) => b.rows.find((r) => r.id === id)!;

  it("reproduces every Cost_Buildup row", () => {
    expect(row("hardware").price).toBeCloseTo(341405.9, 1); // C5
    expect(row("service").price).toBeCloseTo(129444.49, 1); // C6
    expect(row("evolv").price).toBeCloseTo(28792.8, 2); // C7
    expect(row("salesTaxHardware").price).toBeCloseTo(24751.93, 1); // C8
    expect(b.equipmentPrice).toBeCloseTo(524395.12, 1); // C9
    expect(row("design").price).toBeCloseTo(29007.5, 2); // C11
    expect(row("line:Wires, Conduits & Electrical Peripherals").price).toBeCloseTo(29236.14, 1); // C12
    expect(row("line:Main Distribution Switchgear").price).toBeCloseTo(168381.95, 1); // C13
    expect(row("line:Dump / Waste").price).toBeCloseTo(3630, 2); // C15
    expect(row("line:Permits").price).toBeCloseTo(4235, 2); // C16 — uplifted in this vintage
    expect(row("line:Utility").price).toBeCloseTo(4489.1, 2); // C17
    expect(row("line:Construction Equipment").price).toBeCloseTo(14840.2, 1); // C18
    expect(row("labor").price).toBeCloseTo(108900, 2); // C19: 30 × 2,750 × 1.1 × 1.2
    expect(row("constructionPm").price).toBeCloseTo(16335, 2); // C20: 15% of the labour price
    expect(row("interconnect").price).toBe(3500); // C21
  });

  it("lands on the workbook's customer price, list total and discount", () => {
    expect(b.customerPrice).toBeCloseTo(952404.31, 0); // C26 CUSTOMER PRICE / FINANCED AMOUNT
    expect(b.listTotal).toBeCloseTo(1035495.5, 0); // B23 GRAND TOTAL (list)
    expect(b.discountToCustomer).toBeCloseTo(83091.2, 0); // C25 — hardware and service only
  });

  it("reproduces the Business_Model margin by line and the construction build-up", () => {
    const m = computeMargin(b, bwCommercial());
    const line = (l: string) => m.rows.find((r) => r.line === l)!;
    expect(line("hardware").margin).toBeCloseTo(341405.9 - 118107.1, 0); // E9 = 223,298.8
    expect(line("service").margin).toBeCloseTo(129444.49 * 0.45, 0); // E10 = 58,250
    expect(line("evolv").margin).toBeCloseTo(28792.8 * 0.55, 0); // E11 = 15,836
    expect(line("salesTax").margin).toBe(0); // E12 pass-through
    expect(line("design").margin).toBeCloseTo(29007.5 * 0.4, 0); // E13 = 11,603
    expect(line("construction").price).toBeCloseTo(395502, 0); // C14 = SUM(C12:C20)
    expect(line("construction").margin).toBeCloseTo(69447.2, 0); // E14 from the build-up
    expect(line("interconnect").margin).toBeCloseTo(1050, 1); // E15

    expect(m.contractValue).toBeCloseTo(952404.31, 0); // C17
    expect(m.grossMargin).toBeCloseTo(379485, 0); // E17
    expect(m.marginRate).toBeCloseTo(0.39845, 3); // F17
    expect(m.largestMarginLine?.label).toBe("Charger hardware — procurement and sale"); // B25

    const cb = m.construction;
    const comp = (name: string) => cb.rows.find((r) => r.component === name)!;
    expect(comp("Materials, equipment and site works").price).toBeCloseTo(270267, 0); // B109
    expect(comp("Materials, equipment and site works").expectedCost).toBeCloseTo(234529, 0); // E109
    expect(comp("Labour").price).toBeCloseTo(108900, 1); // B110
    expect(comp("Labour").expectedCost).toBeCloseTo(86625, 1); // E110 = 82,500 + 8,250 × 50%
    expect(comp("Labour").margin).toBeCloseTo(22275, 1); // F110
    expect(comp("Construction project management").margin).toBeCloseTo(11434.5, 1); // F111
    expect(cb.total.price).toBeCloseTo(395502, 0); // B112
    expect(cb.total.expectedCost).toBeCloseTo(326054, 0); // E112
    expect(cb.total.margin).toBeCloseTo(69447.2, 0); // F112
    expect(cb.ifContingencyClean).toBeCloseTo(84740.3, 0); // B115
    expect(cb.ifContingencySpent).toBeCloseTo(54154.2, 0); // B116
    expect(m.scopeCheck).toMatch(/^OK/);
  });
});

describe("Cost build-up — intake 2.9.0 policy on a real Quick Estimate project", () => {
  const project = buildQuickProject(defaultQuickInput(), defaultProject(), "t");
  const estimate = computeEstimate(project);
  const commercial = defaultCommercial();
  const b = computeCostBuildup(project.financial, estimate.costs, commercial);
  const row = (id: string) => b.rows.find((r) => r.id === id)!;

  it("ships the intake's defaults: 20% markups, 7% hardware / service / in-house, EVOLV undiscounted", () => {
    expect(commercial.markupMaterialsPct).toBe(0.2);
    expect(commercial.markupLaborPct).toBe(0.2);
    expect(commercial.discountHardwarePct).toBe(0.07);
    expect(commercial.discountServicePct).toBe(0.07);
    expect(commercial.discountEvolvPct).toBe(0);
    expect(commercial.discountInHousePct).toBe(0.07);
    expect(commercial.taxConstructionMaterials).toBe(true);
    expect(commercial.passThroughLines).toEqual(["Permits", "Utility"]);
  });

  it("passes permits and utility fees through at exactly cost — no contingency, markup or discount", () => {
    const permits = estimate.costs.lines.find((l) => l.name === "Permits")!;
    const utility = estimate.costs.lines.find((l) => l.name === "Utility")!;
    expect(row("line:Permits").price).toBe(permits.base);
    expect(row("line:Utility").price).toBe(utility.base);
    expect(row("planCheck").price).toBe(project.financial.planCheckPermitFee);
    expect(row("line:Permits").uplift).toBe("passThrough");
  });

  it("marks up materials-class lines on their contingency-loaded cost and leaves them undiscounted", () => {
    const sg = estimate.costs.lines.find((l) => l.name === "Main Distribution Switchgear")!;
    expect(row("line:Main Distribution Switchgear").price).toBeCloseTo(sg.finalCost * 1.2, 6);
    expect(row("line:Main Distribution Switchgear").discountPct).toBe(0);
  });

  it("prices labour and PM with the labour markup then the in-house discount; hardware from list less 7%, taxed on the discounted price", () => {
    expect(row("labor").price).toBeCloseTo(estimate.costs.labor * 1.2 * 0.93, 6);
    expect(row("constructionPm").price).toBeCloseTo(estimate.costs.constructionPm * 1.2 * 0.93, 6);
    expect(row("hardware").price).toBeCloseTo(project.financial.chargerHardwareCost * 0.93, 6);
    expect(row("salesTaxHardware").price).toBeCloseTo(project.financial.chargerHardwareCost * 0.93 * 0.0725, 6);
    expect(row("design").price).toBeCloseTo(
      (project.financial.autoCadDesignCost + project.financial.electricalEngDesignCost) * 0.93,
      6,
    );
  });

  it("taxes construction materials at their marked-up price as its own row, and the toggle removes it", () => {
    const materials = b.rows.filter((r) => r.group === "construction" && r.uplift === "materials");
    const expected = materials.reduce((s, r) => s + r.price, 0) * project.financial.salesTaxPct;
    expect(row("constructionTax").price).toBeCloseTo(expected, 6);
    const off = computeCostBuildup(project.financial, estimate.costs, { ...commercial, taxConstructionMaterials: false });
    expect(off.rows.find((r) => r.id === "constructionTax")).toBeUndefined();
    expect(off.customerPrice).toBeCloseTo(b.customerPrice - expected, 6);
  });

  it("never touches Total Cost: the estimate is identical with and without the commercial section", () => {
    const withSection = computeEstimate({ ...project, commercial });
    const without = computeEstimate({ ...project, commercial: undefined });
    expect(withSection.costs.totalCost).toBe(without.costs.totalCost);
    expect(JSON.stringify(withSection)).toBe(JSON.stringify(without));
    expect(b.estimatorTotalCost).toBe(estimate.costs.totalCost);
  });

  it("computeProposal returns null for a project without a commercial section", () => {
    expect(computeProposal({ ...project, commercial: undefined }, estimate)).toBeNull();
    const p = computeProposal({ ...project, commercial }, estimate)!;
    expect(p.costBuildup.customerPrice).toBeCloseTo(b.customerPrice, 6);
    expect(p.margin.contractValue).toBeCloseTo(b.customerPrice, 6);
  });

  it("scope of supply: a line by others leaves the contract but stays in the client's cost; sales tax follows hardware", () => {
    const split: CommercialInput = { ...commercial, scope: { ...commercial.scope, construction: "others", hardware: "none" } };
    const m = computeMargin(computeCostBuildup(project.financial, estimate.costs, split), split);
    const construction = m.rows.find((r) => r.line === "construction")!;
    const hardware = m.rows.find((r) => r.line === "hardware")!;
    const tax = m.rows.find((r) => r.line === "salesTax")!;
    expect(construction.status).toBe("others");
    expect(construction.margin).toBe(0);
    expect(construction.thirdParty).toBeCloseTo(construction.price, 6);
    expect(m.clientProjectCost).toBeCloseTo(m.contractValue + m.thirdPartyTotal, 6);
    expect(hardware.toClient).toBe(0);
    expect(tax.status).toBe("none"); // follows the hardware line, whatever the stored value
    expect(m.scopeCheck).toMatch(/^SCOPE SPLIT/);
  });
});
