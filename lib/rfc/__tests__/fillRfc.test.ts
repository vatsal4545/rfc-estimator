import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../../calc/autoplan";
import { laborBreakdown } from "../../calc/costs";
import { defaultProject } from "../../calc/defaults";
import { computeEstimate } from "../../calc/engine";
import type { Project } from "../../calc/types";
import { COSTS_INTERNAL_LABELS } from "../../costsInternalSheet";
import { readWorkbook } from "../../intake/xlsx";
import { patchWorkbook } from "../../intake/xlsxWrite";
import { computeProposal } from "../../proposal";
import { defaultCommercial } from "../../proposal/defaults";
import { PRICE_BOOK } from "../../ref/priceBook";
import { crossCheckPriceBook, fillRfcWorkbook, planRfcFill, resolveStandInSku, rfcFileName, verifyRfcTemplate } from "../fillRfc";
import { REVENUE_SCENARIO_COLUMNS } from "../template";
import { rfcProject } from "./rfcProject";

const TEMPLATE = join(__dirname, "..", "..", "..", "public", "rfc", "IntakeSheet_RFC_MSRP_Calculator_Simple_v17.updated.xlsx");

describe("filling the RFC / MSRP calculator from a project", async () => {
  const project = rfcProject();
  const result = computeEstimate(project);
  const proposal = computeProposal(project, result)!;
  const template = readFileSync(TEMPLATE);
  const { bytes, report } = await fillRfcWorkbook(template, project, result, proposal);
  const wb = await readWorkbook(bytes);
  const fin = project.financial;

  it("writes without a refusal, and touches only the three input sheets", () => {
    expect(report.refused).toEqual([]);
    expect(Object.keys(report.bySheet).sort()).toEqual([
      "Costs Internal",
      "INPUT SHEET",
      "Internal Summary",
      "Updated Chargers Revenue Calcul",
    ]);
    // Every planned write landed — nothing silently dropped.
    expect(report.filled).toBe(planRfcFill(project, result, proposal).writes.length);
    expect(report.template).toBe("RFC / MSRP Calculator v17");
  });

  it("reports no price-book divergence — every SKU, category and price agrees with the workbook", () => {
    const priceNotes = report.warnings.filter(
      (w) => w.includes("prices at") || w.includes("not in the workbook") || w.includes("no MSRP") || w.includes("category list"),
    );
    expect(priceNotes).toEqual([]);
  });

  // ---- 1 · Equipment -------------------------------------------------------

  it("INPUT SHEET: one line item per equipment line — category token, SKU, discount, qty", () => {
    expect(wb.get("INPUT SHEET", "D8")).toBe("_kW360");
    expect(wb.get("INPUT SHEET", "E8")).toBe("TP5-360-480-2-300");
    expect(wb.get("INPUT SHEET", "H8")).toBe(0.15);
    expect(wb.get("INPUT SHEET", "I8")).toBe(4);

    expect(wb.get("INPUT SHEET", "D9")).toBe("_L2");
    expect(wb.get("INPUT SHEET", "E9")).toBe("CTX-C40-240-2");
    expect(wb.get("INPUT SHEET", "I9")).toBe(2);

    // The accessory lands after the chargers.
    expect(wb.get("INPUT SHEET", "D10")).toBe("_L2_Accessories");
    expect(wb.get("INPUT SHEET", "E10")).toBe("CTX-FLUXPED-CMS-2");
    expect(wb.get("INPUT SHEET", "I10")).toBe(3);

    // Nothing beyond the lines we wrote.
    expect(wb.get("INPUT SHEET", "E11")).toBeNull();
  });

  it("INPUT SHEET: the description and MSRP formulas are left for the workbook to resolve", () => {
    expect(wb.formula("INPUT SHEET", "F8")).toContain("CTX Price Book");
    expect(wb.formula("INPUT SHEET", "G8")).toContain("CTX Price Book");
    expect(wb.formula("INPUT SHEET", "J8")).toBe('IF(E8="","",I8*G8)');
    expect(wb.formula("INPUT SHEET", "K38")).toBe("SUM(K8:K37)");
    // Charger and port counts are the sheet's own SUMIFs over what we wrote.
    expect(wb.formula("INPUT SHEET", "N8")).toContain("SUMIF");
  });

  it("INPUT SHEET: the de-rate factor and L2 rating come from the app", () => {
    expect(wb.get("INPUT SHEET", "N11")).toBe(proposal.model.inputs.revenue.deratingFactor);
    expect(wb.get("INPUT SHEET", "N10")).toBe(proposal.model.context.l2KwPerPosition);
  });

  it("the app's MSRPs match what the workbook's price book will look up", () => {
    for (const line of report.equipment) {
      const row = [...wb.cells("CTX Price Book").entries()].find(([ref, v]) => ref.startsWith("C") && v === line.sku)?.[0];
      expect(row, `${line.sku} present in the workbook price book`).toBeDefined();
      const msrp = wb.get("CTX Price Book", `F${row!.slice(1)}`);
      expect(msrp).toBeCloseTo(line.unitList, 2);
    }
  });

  // ---- 2 · Revenue ---------------------------------------------------------

  it("Revenue tab: the app's inputs across the Standard-Low block, Med/High left alone", () => {
    const rev = proposal.model.inputs.revenue;
    const ctx = proposal.model.context;
    for (const col of REVENUE_SCENARIO_COLUMNS) {
      expect(wb.get("Updated Chargers Revenue Calcul", `${col}20`)).toBe(rev.stallOccupancy);
      expect(wb.get("Updated Chargers Revenue Calcul", `${col}21`)).toBe(rev.chargingHoursShare);
      expect(wb.get("Updated Chargers Revenue Calcul", `${col}7`)).toBe(ctx.hoursPerDay);
      expect(wb.get("Updated Chargers Revenue Calcul", `${col}36`)).toBe(ctx.daysPerYear);
      expect(wb.get("Updated Chargers Revenue Calcul", `${col}34`)).toBe(rev.taperFactor);
      expect(wb.get("Updated Chargers Revenue Calcul", `${col}39`)).toBe(rev.cardFeePct);
      expect(wb.get("Updated Chargers Revenue Calcul", `${col}55`)).toBe(rev.rampYear1);
      expect(wb.get("Updated Chargers Revenue Calcul", `${col}58`)).toBe(rev.growthAfterRamp);
      expect(wb.get("Updated Chargers Revenue Calcul", `${col}59`)).toBe(ctx.contractYears);
    }
    // Hours came from the intake (12), not the 24 default — proof it is ours.
    expect(wb.get("Updated Chargers Revenue Calcul", "B7")).toBe(12);
    expect(wb.get("Updated Chargers Revenue Calcul", "B36")).toBe(360);
    // Retail price on B13 only; C13:H13 stay as =B13.
    expect(wb.get("Updated Chargers Revenue Calcul", "B13")).toBe(rev.retailPerKwh);
    expect(wb.formula("Updated Chargers Revenue Calcul", "C13")).toBe("B13");
    // Standard-Med and Standard-High keep the workbook's own occupancy tiers.
    expect(wb.get("Updated Chargers Revenue Calcul", "I20")).toBe(0.45);
    expect(wb.get("Updated Chargers Revenue Calcul", "P20")).toBe(0.6);
  });

  it("Revenue tab: the resolved tariff replaces the workbook's rate-library lookup", () => {
    const t = proposal.model.tariff;
    expect(wb.get("Updated Chargers Revenue Calcul", "B202")).toBe(t.utility);
    expect(wb.get("Updated Chargers Revenue Calcul", "B203")).toBe(t.schedule);
    expect(wb.get("Updated Chargers Revenue Calcul", "B206")).toBeCloseTo(t.rates.peakPerKwh, 6);
    expect(wb.get("Updated Chargers Revenue Calcul", "B207")).toBeCloseTo(t.rates.offPeakPerKwh, 6);
    expect(wb.get("Updated Chargers Revenue Calcul", "B208")).toBeCloseTo(t.rates.superOffPeakPerKwh, 6);
    expect(wb.get("Updated Chargers Revenue Calcul", "B209")).toBeCloseTo(t.rates.customerPerMonth, 6);
    expect(wb.get("Updated Chargers Revenue Calcul", "B210")).toBeCloseTo(t.rates.demandPerKwMonth, 6);
    expect(wb.get("Updated Chargers Revenue Calcul", "B211")).toBeCloseTo(t.rates.blockKw, 6);
    expect(wb.get("Updated Chargers Revenue Calcul", "B212")).toBeCloseTo(t.rates.blockPerMonth, 6);
    expect(wb.get("Updated Chargers Revenue Calcul", "B213")).toBeCloseTo(t.rates.overagePerKw, 6);
    // Their formulas are gone, so nothing re-resolves them on open.
    expect(wb.formula("Updated Chargers Revenue Calcul", "B206")).toBeUndefined();
    expect(wb.formula("Updated Chargers Revenue Calcul", "B213")).toBeUndefined();
    // The rows that read them still do.
    expect(wb.formula("Updated Chargers Revenue Calcul", "B40")).toBe("$B$206");
  });

  it("Revenue tab: the time-of-use mix and demand sizing", () => {
    const t = proposal.model.tariff;
    const shares = t.isFlat ? { peak: 1, offPeak: 0, superOffPeak: 0 } : t.touShares;
    expect(wb.get("Updated Chargers Revenue Calcul", "B43")).toBeCloseTo(shares.peak, 6);
    expect(wb.get("Updated Chargers Revenue Calcul", "B44")).toBeCloseTo(shares.offPeak, 6);
    expect(wb.get("Updated Chargers Revenue Calcul", "B45")).toBeCloseTo(shares.superOffPeak, 6);
    const ti = proposal.model.inputs.tariff;
    expect(wb.get("Updated Chargers Revenue Calcul", "B51")).toBe(ti.peakToAverageFactor);
    expect(wb.get("Updated Chargers Revenue Calcul", "B52")).toBe(ti.safetyMarginPct);
    expect(wb.get("Updated Chargers Revenue Calcul", "B53")).toBe(ti.sizeDemandOnFullRating ? "Yes" : "No");
    expect(wb.get("Updated Chargers Revenue Calcul", "B54")).toBe(ti.demandChargeFromYear);
  });

  it("Revenue tab: the roll-up and ten-year tables are left entirely to the workbook", () => {
    expect(wb.formula("Updated Chargers Revenue Calcul", "C65")).toBe("SUM(C6:H6)");
    expect(wb.formula("Updated Chargers Revenue Calcul", "C95")).toBe("$C$72*B95");
    expect(wb.formula("Updated Chargers Revenue Calcul", "C189")).toBe("P95");
  });

  // ---- 3 · Costs Internal --------------------------------------------------

  it("Costs Internal: the app's table, row for row", () => {
    COSTS_INTERNAL_LABELS.forEach((_label, i) => {
      const r = 3 + i;
      expect(wb.get("Costs Internal", `C${r}`)).toBe(1);
      expect(wb.get("Costs Internal", `D${r}`)).toBeCloseTo(result.costs.lines[i].base, 2);
      expect(wb.get("Costs Internal", `E${r}`)).toBe(fin.contingencyPct);
      // The CPM Calcs formula the app's figure supersedes is gone.
      expect(wb.formula("Costs Internal", `D${r}`)).toBeUndefined();
    });
    // The loading chain is untouched. F3 is a shared-formula master spanning
    // F3:F13 and G5/G8/G12 are masters of their own runs, so only the masters
    // carry text — the dependents inherit it, and all of them must survive.
    expect(wb.formula("Costs Internal", "F3")).toBe("(D3*E3)+D3");
    expect(wb.formula("Costs Internal", "G3")).toBe("F3*C3");
    expect(wb.formula("Costs Internal", "G5")).toBe("F5*C5");
    expect(wb.formula("Costs Internal", "G8")).toBe("F8*C8");
    expect(wb.formula("Costs Internal", "G12")).toBe("F12*C12");
    for (let r = 3; r <= 13; r++) expect(wb.formula("Costs Internal", `F${r}`)).toBeDefined();
    expect(wb.formula("Costs Internal", "G15")).toBe("SUM(G3:G13)");
  });

  it("Costs Internal: the shared-formula masters are never overwritten, even opted in", async () => {
    const { written, refused } = await patchWorkbook(template, [
      { sheet: "Costs Internal", ref: "F3", value: 1, overwriteFormula: true },
    ]);
    expect(written).toBe(0);
    expect(refused[0]).toContain("defines a shared formula");
  });

  it("Costs Internal: Construction PM is shown but stays out of the subtotal", () => {
    const expected =
      result.costs.constructionPm + fin.autoCadDesignCost + fin.electricalEngDesignCost + fin.pmHours * fin.pmHourlyRate;
    expect(wb.get("Costs Internal", "C14")).toBe(1);
    expect(wb.get("Costs Internal", "D14")).toBeCloseTo(expected, 2);
    expect(wb.get("Costs Internal", "E14")).toBe(0);
    expect(wb.formula("Costs Internal", "G15")).toBe("SUM(G3:G13)"); // 14 excluded
  });

  it("Costs Internal: the labor box drives the labor row", () => {
    const labor = laborBreakdown(fin);
    expect(wb.get("Costs Internal", "K4")).toBeCloseTo(labor.blendedRate, 2);
    expect(wb.get("Costs Internal", "K5")).toBe(42);
    expect(wb.get("Costs Internal", "E18")).toBe(fin.contingencyPct);
    // C18/D18 read the box and must not have been overwritten.
    expect(wb.formula("Costs Internal", "C18")).toBe("K5");
    expect(wb.formula("Costs Internal", "D18")).toBe("K4");
    expect(wb.formula("Costs Internal", "G20")).toBe("G15+G19");
  });

  it("Costs Internal: labor contingency drops to zero when it is not applied to labor", () => {
    const p = { ...project, financial: { ...fin, applyContingencyToLabor: false } };
    const plan = planRfcFill(p, computeEstimate(p), computeProposal(p, computeEstimate(p)));
    expect(plan.writes.find((w) => w.sheet === "Costs Internal" && w.ref === "E18")?.value).toBe(0);
  });

  it("clears the Internal Summary sentinel, so the summary populates", () => {
    const subtotal = result.costs.lines.reduce((s, l) => s + l.base * (1 + fin.contingencyPct), 0);
    expect(Math.abs(Math.round(subtotal * 100) / 100 - 88919.7)).toBeGreaterThan(0.005);
    expect(report.warnings.some((w) => w.includes("88919.70"))).toBe(false);
    // The summary reads Costs Internal through that sentinel guard.
    expect(wb.formula("Internal Summary", "B14")).toContain("88919.7");
  });

  // ---- The Grand Total reconciliation -------------------------------------
  // The Internal Summary ships the Design Invoice, construction PM and
  // construction sales tax as hard zeros, and nothing else feeds them, so the
  // Grand Total used to come out ~$47k short of the app's Total Cost.
  it("Internal Summary: fills the rows nothing else feeds", () => {
    expect(wb.get("Internal Summary", "B9")).toBeCloseTo(fin.autoCadDesignCost, 2);
    expect(wb.get("Internal Summary", "B10")).toBeCloseTo(fin.electricalEngDesignCost, 2);
    expect(wb.get("Internal Summary", "B11")).toBeCloseTo(fin.pmHours * fin.pmHourlyRate, 2);
    expect(wb.get("Internal Summary", "B12")).toBeCloseTo(fin.planCheckPermitFee, 2);
    expect(wb.get("Internal Summary", "B25")).toBeCloseTo(result.costs.constructionPm, 2);
    expect(wb.get("Internal Summary", "B27")).toBeCloseTo(result.costs.salesTaxOnConstruction, 2);
    // Materials stays zero: the app folds it into "Wires, Conduits …".
    expect(wb.get("Internal Summary", "B26")).toBe(0);
    // The rows are inputs, so their discount and price formulas must survive.
    expect(wb.formula("Internal Summary", "D9")).toBe("(B9)-((B9)*C9)");
    expect(wb.formula("Internal Summary", "B8")).toBe("SUM(B9:B12)");
    expect(wb.formula("Internal Summary", "D29")).toBe("(B28+B13+B8+B3)");
  });

  it("the Excel Grand Total ties to the app's Total Cost, bar the tax basis", () => {
    const c = result.costs;
    const g = (ref: string) => Number(wb.get("Internal Summary", ref) ?? 0);
    const ci = (ref: string) => Number(wb.get("Costs Internal", ref) ?? 0);

    // Evaluate the workbook's own chain from what was written.
    const construction = Array.from({ length: 11 }, (_, i) => ci(`D${3 + i}`) * (1 + ci(`E${3 + i}`)) * ci(`C${3 + i}`));
    const B13 = construction.reduce((s, x) => s + x, 0) + g("B25") + g("B26") + g("B27");
    const B28 = ci("K4") * (1 + ci("E18")) * ci("K5");
    const B8 = g("B9") + g("B10") + g("B11") + g("B12");
    const hardware = report.equipment.reduce((s, e) => s + e.qty * e.unitList, 0);
    const discounted = report.equipment.reduce((s, e) => s + e.qty * e.unitList * (1 - 0.15), 0);
    const B7 = discounted * fin.salesTaxPct; // the workbook taxes the DISCOUNTED price
    const B3 = hardware + (fin.chargerWarrantyCost + fin.fiveYearServiceCost) + fin.evolvCommissioningCost + B7;
    const D29 = B28 + B13 + B8 + B3;

    // The one remaining difference is the sales-tax basis: the workbook taxes
    // the discounted hardware (its own B7 formula, deliberately not touched),
    // the cost engine taxes list. The cost engine keeps commercial inputs out
    // of Total Cost by design — see costBuildup.test.ts, "never touches Total
    // Cost". The app's Customer price already uses the workbook's basis.
    const taxBasisDelta = c.equipmentPurchaseTax - B7;
    expect(taxBasisDelta).toBeGreaterThan(0);
    expect(D29).toBeCloseTo(c.totalCost - taxBasisDelta, 1);
    expect(hardware).toBeGreaterThan(discounted);
  });

  // The workbook has no markup column — the Proposal tab is pure formulas off
  // the Internal Summary's D column — so the app's priced rows can only land
  // in the "Applied Discount" column, negative where the app marks up.
  it("Internal Summary: Total After Discount equals the app's Customer price", () => {
    const c = result.costs;
    const g = (ref: string) => Number(wb.get("Internal Summary", ref) ?? 0);
    const ci = (ref: string) => Number(wb.get("Costs Internal", ref) ?? 0);

    // Column B, as the workbook's own formulas will compute it.
    const hardwareList = report.equipment.reduce((s, e) => s + e.qty * e.unitList, 0);
    const hardwareDiscount = 0.15;
    const D4 = hardwareList * (1 - hardwareDiscount);
    const B: Record<number, number> = {
      4: hardwareList,
      5: fin.chargerWarrantyCost + fin.fiveYearServiceCost,
      6: fin.evolvCommissioningCost,
      7: D4 * 0.0725, // the workbook hard-codes this rate
      9: g("B9"),
      10: g("B10"),
      11: g("B11"),
      12: g("B12"),
      25: g("B25"),
      26: g("B26"),
      27: g("B27"),
      28: ci("K4") * (1 + ci("E18")) * ci("K5"),
    };
    COSTS_INTERNAL_LABELS.forEach((_l, i) => {
      B[14 + i] = ci(`D${3 + i}`) * (1 + ci(`E${3 + i}`)) * ci(`C${3 + i}`);
    });

    // D = B − B×C on every row. Row 4's C is the sheet's own formula.
    const customerPriceOf = (rowNo: number) => {
      const cDisc = rowNo === 4 ? hardwareDiscount : Number(wb.get("Internal Summary", `C${rowNo}`) ?? 0);
      return B[rowNo] - B[rowNo] * cDisc;
    };
    const rowsUsed = [4, 5, 6, 7, 9, 10, 11, 12, ...COSTS_INTERNAL_LABELS.map((_l, i) => 14 + i), 25, 26, 27, 28];
    const D30 = rowsUsed.reduce((s, r) => s + customerPriceOf(r), 0);

    expect(D30).toBeCloseTo(proposal.costBuildup.customerPrice, 2);

    // A marked-up construction line carries a NEGATIVE discount, and a
    // pass-through line a positive one (it bills at base, without contingency).
    const wires = COSTS_INTERNAL_LABELS.indexOf("Wires, Conduits and Peripherals");
    expect(Number(wb.get("Internal Summary", `C${14 + wires}`))).toBeLessThan(0);
    const permits = COSTS_INTERNAL_LABELS.indexOf("Permits");
    expect(Number(wb.get("Internal Summary", `C${14 + permits}`))).toBeGreaterThan(0);
    expect(customerPriceOf(14 + permits)).toBeCloseTo(c.lines[permits].base, 2);

    // Column B still shows internal cost, and the discount formulas survive.
    expect(g("B25")).toBeCloseTo(c.constructionPm, 2);
    // D9 is the shared-formula master for the whole D9:D27 run (design AND
    // construction), so only it carries text; the run must survive intact.
    expect(wb.formula("Internal Summary", "D9")).toBe("(B9)-((B9)*C9)");
    for (let r = 9; r <= 27; r++) expect(wb.formula("Internal Summary", `D${r}`)).toBeDefined();
    expect(wb.formula("Internal Summary", "D30")).toBe("SUM(D3,D8,D13,D28)");
    expect(report.warnings.some((w) => w.includes("Applied Discount"))).toBe(true);
  });

  it("leaves the discount column alone when there is no customer price to align to", async () => {
    const bare = defaultProject();
    const res = computeEstimate(bare);
    const { report: r } = await fillRfcWorkbook(template, bare, res, null);
    expect(r.leftBlank.some((s) => s.includes("Applied Discount"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("Applied Discount column now carries"))).toBe(false);
  });

  it("names the file after the client", () => {
    expect(rfcFileName(project)).toBe("hoopa-motel-rfc-msrp-calculator.xlsx");
  });
});

describe("the RFC fill's guards", async () => {
  const template = readFileSync(TEMPLATE);

  it("refuses a workbook whose Costs Internal rows no longer line up", async () => {
    const { bytes } = await patchWorkbook(template, [{ sheet: "Costs Internal", ref: "B5", value: "Something else" }]);
    const wb = await readWorkbook(bytes);
    expect(() => verifyRfcTemplate(wb)).toThrow(/Electrical Sub-Panels, Transformers, Breakers/);
  });

  it("refuses a workbook whose INPUT SHEET headers moved", async () => {
    const { bytes } = await patchWorkbook(template, [{ sheet: "INPUT SHEET", ref: "E7", value: "Part number" }]);
    const wb = await readWorkbook(bytes);
    expect(() => verifyRfcTemplate(wb)).toThrow(/should be "SKU" but reads "Part number"/);
  });

  it("accepts the shipped workbook", async () => {
    const wb = await readWorkbook(template);
    expect(() => verifyRfcTemplate(wb)).not.toThrow();
  });

  it("flags a SKU the workbook's price book does not carry", async () => {
    const wb = await readWorkbook(template);
    const notes = crossCheckPriceBook(wb, [
      { row: 8, category: "_kW360", sku: "NOT-A-REAL-SKU", description: "x", qty: 1, unitList: 1000 },
    ]);
    expect(notes.some((n) => n.includes("SKU not found"))).toBe(true);
  });

  it("flags a price the workbook disagrees with", async () => {
    const wb = await readWorkbook(template);
    const notes = crossCheckPriceBook(wb, [
      { row: 8, category: "_kW360", sku: "TP5-360-480-2-300", description: "x", qty: 1, unitList: 1 },
    ]);
    expect(notes.some((n) => n.includes("prices at") && n.includes("in the app"))).toBe(true);
  });

  // Regression: a project whose Equipment tab holds only GENERIC models (no
  // SKU picked) produced a completely blank INPUT SHEET, because the fill can
  // only price by SKU. That is the default state of a new project, so it was
  // the common case, not the edge case.
  it("writes generic catalog-allowance models via a price-identical stand-in SKU", () => {
    const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
    // defaultQuickInput() is exactly what a new project starts with:
    // [{ loadTypeId: "DCFC 200kW", count: 6 }, { loadTypeId: "L2 Single 40A", count: 5 }]
    const p = buildQuickProject({ ...defaultQuickInput(), clientName: "Generic" }, base, "t", HARDWARE_ALLOWANCE);
    const res = computeEstimate(p);
    const plan = planRfcFill(p, res, computeProposal(p, res));

    // The L2 line reaches the sheet, at the price the app actually used.
    const l2 = plan.equipment.find((e) => e.sku === "CTX-C48-240-1");
    expect(l2, "L2 Single 40A resolved to a stand-in").toBeDefined();
    expect(l2!.qty).toBe(5);
    expect(l2!.unitList).toBe(1402.5);
    expect(l2!.category).toBe("_L2");
    expect(plan.substitutions).toContainEqual({ loadTypeId: "L2 Single 40A", sku: "CTX-C48-240-1", unitList: 1402.5 });
    expect(plan.writes.some((w) => w.sheet === "INPUT SHEET" && w.ref.startsWith("E"))).toBe(true);
  });

  it("never substitutes a SKU at a different price", () => {
    // The trap: L2 Single 40A maps by load type to CTX-R40-240-1, a HOME unit
    // at $605, while the app prices the model at $1,402.50.
    expect(resolveStandInSku("L2 Single 40A", 1402.5)?.sku).toBe("CTX-C48-240-1");
    expect(resolveStandInSku("L2 Single 40A", 1402.5)?.msrp).toBe(1402.5);
    // The other trap: the Buy-America members of a family cost far more.
    const dc60 = resolveStandInSku("DCFC 60kW", 28500);
    expect(dc60?.msrp).toBe(28500);
    expect(dc60?.sku).not.toContain("BAA");
    // Every allowance model that resolves must resolve at an identical price.
    for (const [loadTypeId, allowance] of Object.entries(HARDWARE_ALLOWANCE)) {
      const hit = resolveStandInSku(loadTypeId, allowance);
      if (hit) expect(hit.msrp, `${loadTypeId} -> ${hit.sku}`).toBeCloseTo(allowance, 2);
    }
    // And a price nothing matches resolves to nothing, rather than to something close.
    expect(resolveStandInSku("DCFC 360kW Dual", 12345)).toBeUndefined();
  });

  it("refuses, with an actionable reason, a model the price book has no unit for", () => {
    // DCFC 200kW: the allowance is interpolated between TP5-180 and TP5-240.
    expect(resolveStandInSku("DCFC 200kW", 68000)).toBeUndefined();
    const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
    const p = buildQuickProject({ ...defaultQuickInput(), clientName: "Generic" }, base, "t", HARDWARE_ALLOWANCE);
    const res = computeEstimate(p);
    const plan = planRfcFill(p, res, computeProposal(p, res));
    const w = plan.warnings.find((x) => x.startsWith("DCFC 200kW"));
    expect(w).toBeDefined();
    expect(w).toContain("no such unit");
    expect(w).toContain("Pick a specific SKU");
    expect(plan.equipment.some((e) => e.qty === 6)).toBe(false);
  });

  it("mixes explicit SKUs and a resolvable generic model in one sheet", () => {
    const p = rfcProject();
    // A generic catalog-allowance model alongside the three SKU lines. This
    // one resolves (the 180 kW allowance is a TP5-180-480-x list price), so it
    // becomes a fourth line rather than being dropped.
    p.quick = { ...p.quick!, lines: [...p.quick!.lines, { loadTypeId: "DCFC 180kW Dual", count: 1 }] };
    const res = computeEstimate(p);
    const plan = planRfcFill(p, res, computeProposal(p, res));
    expect(plan.equipment).toHaveLength(4);
    const stood = plan.equipment.find((e) => e.qty === 1)!;
    expect(stood.category).toBe("_kW180");
    expect(stood.unitList).toBe(HARDWARE_ALLOWANCE["DCFC 180kW Dual"]);
    expect(plan.substitutions.map((s) => s.loadTypeId)).toEqual(["DCFC 180kW Dual"]);
    // Chargers keep their order and come before the extras, the stand-in
    // included — it is a charger line, not an accessory.
    expect(plan.equipment.map((e) => e.sku)).toEqual([
      "TP5-360-480-2-300",
      "CTX-C40-240-2",
      "TP5-180-480-1",
      "CTX-FLUXPED-CMS-2",
    ]);
    expect(plan.equipment.map((e) => e.row)).toEqual([8, 9, 10, 11]);
  });

  it("warns when there are more equipment lines than the INPUT SHEET has rows", () => {
    const p = rfcProject();
    const skus = PRICE_BOOK.filter((s) => s.role === "accessory" || s.role === "level_2");
    // 31 extras against 30 line-item rows.
    p.quick = {
      ...p.quick!,
      lines: [],
      extras: Array.from({ length: 31 }, (_, i) => ({ sku: skus[i % skus.length].sku, count: 1 })),
    };
    const res = computeEstimate(p);
    const plan = planRfcFill(p, res, computeProposal(p, res));
    expect(plan.equipment).toHaveLength(30);
    expect(plan.equipment[29].row).toBe(37);
    expect(plan.warnings.some((w) => w.includes("does not fit") && w.includes("30 line-item rows"))).toBe(true);
    // Nothing was written past the table.
    expect(plan.writes.some((w) => w.sheet === "INPUT SHEET" && /^[DEHI]38$/.test(w.ref))).toBe(false);
  });

  it("warns, but still fills, when a project has no Commercial inputs", async () => {
    const bare = defaultProject();
    const res = computeEstimate(bare);
    const { report } = await fillRfcWorkbook(template, bare, res, null);
    expect(report.refused).toEqual([]);
    expect(report.warnings.some((w) => w.includes("no Commercial inputs"))).toBe(true);
    expect(report.bySheet["Costs Internal"]).toBeGreaterThan(0);
    expect(report.bySheet["Updated Chargers Revenue Calcul"]).toBeUndefined();
  });
});

describe("the shared writer's formula rules", () => {
  it("still refuses a formula cell when the write does not opt in", async () => {
    const template = readFileSync(TEMPLATE);
    const { written, refused } = await patchWorkbook(template, [
      { sheet: "Costs Internal", ref: "D3", value: 123 },
      { sheet: "Costs Internal", ref: "G15", value: 456 },
    ]);
    expect(written).toBe(0);
    expect(refused).toHaveLength(2);
    expect(refused[0]).toContain("holds a formula");
  });

  it("overwrites only where the write opts in", async () => {
    const template = readFileSync(TEMPLATE);
    const { bytes, written, refused } = await patchWorkbook(template, [
      { sheet: "Costs Internal", ref: "D3", value: 123, overwriteFormula: true },
      { sheet: "Costs Internal", ref: "G15", value: 456 },
    ]);
    expect(written).toBe(1);
    expect(refused).toHaveLength(1);
    const wb = await readWorkbook(bytes);
    expect(wb.get("Costs Internal", "D3")).toBe(123);
    expect(wb.formula("Costs Internal", "D3")).toBeUndefined();
    expect(wb.formula("Costs Internal", "G15")).toBe("SUM(G3:G13)");
  });
});
