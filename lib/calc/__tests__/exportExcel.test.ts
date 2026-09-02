import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildEstimateWorkbook, estimateWorkbookBuffer } from "../../exportExcel";
import { buildQuickProject, defaultQuickInput } from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { computeProposal } from "../../proposal";
import { defaultCommercial, defaultIntake, modelInputsOf } from "../../proposal/defaults";

function cellNumber(v: ExcelJS.CellValue): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v) return v.result as number;
  // ExcelJS drops a cached result of exactly 0 from the value object.
  if (v && typeof v === "object" && "formula" in v) return 0;
  throw new Error(`cell is not numeric: ${JSON.stringify(v)}`);
}

describe("Excel export", () => {
  const project = buildQuickProject(
    { ...defaultQuickInput(), clientName: "Test Client", terrain: "hilly" },
    defaultProject(),
    "t",
  );
  const result = computeEstimate(project);

  it("round-trips through the xlsx format with every sheet, Intake first", async () => {
    const buffer = await estimateWorkbookBuffer(project, result);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Intake",
      "Summary",
      "Cost Detail",
      "Costs Internal",
      "Takeoff",
      "Materials BOM",
      "Panel Schedule",
      "Panel EV_MAIN 480V",
      "Panel EV_SUB 208V",
      "Peripherals",
      "Equipment",
      "Assumptions",
    ]);
  });

  it("plan-set panel schedules tie phase totals to the connected loads", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    const sqrt3 = Math.sqrt(3);

    // 480V: 6x DCFC 200kW at 265A -> per-phase VA = 277.1 x 265 each, plus
    // the transformer primary reflection (connected kVA / 3 per phase).
    const main = wb.getWorksheet("Panel EV_MAIN 480V")!;
    let totalCell: ExcelJS.CellValue | undefined;
    main.eachRow((row) => {
      if (row.getCell(12).value === "TOTAL 3PH VA") totalCell = row.getCell(14).value;
    });
    const dcfcVA = 6 * 3 * (480 / sqrt3) * 265;
    const txVA = result.panel.transformer!.connectedKva * 1000;
    expect(cellNumber(totalCell!)).toBeCloseTo(dcfcVA + txVA, 0);

    // 208V: 5x L2 40A, 2-pole -> total VA = 208 x 40 x 5.
    const sub = wb.getWorksheet("Panel EV_SUB 208V")!;
    let subTotal: ExcelJS.CellValue | undefined;
    sub.eachRow((row) => {
      if (row.getCell(12).value === "TOTAL 3PH VA") subTotal = row.getCell(14).value;
    });
    expect(cellNumber(subTotal!)).toBeCloseTo(208 * 40 * 5, 0);

    // Every circuit landed: 6 DCFC descriptions on the main, 5 L2 on the sub.
    const count = (ws: ExcelJS.Worksheet, needle: string) => {
      let n = 0;
      ws.eachRow((row) => {
        for (const col of [3, 14]) {
          const v = row.getCell(col).value;
          if (typeof v === "string" && v.includes(needle) && !v.startsWith("---")) n++;
        }
      });
      return n;
    };
    expect(count(main, "DCFC 200KW")).toBe(6);
    expect(count(sub, "L2 SINGLE 40A")).toBe(5);
  });

  it("Summary total ties to the engine and references Cost Detail", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    const summary = wb.getWorksheet("Summary")!;
    let totalCell: ExcelJS.Cell | undefined;
    summary.eachRow((row) => {
      if (row.getCell(1).value === "TOTAL COST") totalCell = row.getCell(2);
    });
    expect(totalCell).toBeDefined();
    expect(cellNumber(totalCell!.value)).toBeCloseTo(result.costs.totalCost, 2);
    expect((totalCell!.value as ExcelJS.CellFormulaValue).formula).toContain("'Cost Detail'!");
    // The Cost Detail total formula carries the CEO-basis construction PM line.
    const costs = wb.getWorksheet("Cost Detail")!;
    let pmRow = 0;
    let totalFormula = "";
    costs.eachRow((row) => {
      if (row.getCell(1).value === "Construction PM (% of loaded labor — CEO basis)") pmRow = row.number;
      if (row.getCell(1).value === "TOTAL COST") totalFormula = (row.getCell(4).value as ExcelJS.CellFormulaValue).formula;
    });
    expect(pmRow).toBeGreaterThan(0);
    expect(totalFormula).toContain(`D${pmRow}`);
    expect(cellNumber(costs.getCell(pmRow, 4).value)).toBeCloseTo(result.costs.constructionPm, 2);
  });

  it("Cost Detail contingency cells are live formulas against the input block", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    const costs = wb.getWorksheet("Cost Detail")!;
    // First construction line sits right under the header at row 12.
    const contingency = costs.getCell("C13").value as ExcelJS.CellFormulaValue;
    expect(contingency.formula).toBe("B13*$B$4");
    expect(costs.getCell("B4").value).toBeCloseTo(project.financial.contingencyPct, 6);
    // Cached result matches the engine line.
    expect(contingency.result).toBeCloseTo(result.costs.lines[0].contingency, 2);
  });

  it("Costs Internal replicates the RFC_V18 sheet and ties to the engine", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    const ws = wb.getWorksheet("Costs Internal")!;
    // Layout matches the source workbook: labels in B3:B13, banner in B2.
    expect(ws.getCell("B2").value).toBe("Electrical Supply & Construction Management Costs");
    expect(ws.getCell("B3").value).toBe("Wires, Conduits and Peripherals");
    expect(ws.getCell("B13").value).toBe("Construction Equipment");
    expect(ws.getCell("B14").value).toBe("Construction PM");
    expect(ws.getCell("B17").value).toBe("ZERO IMPACT BUILDERS COSTS");
    // Individual Cost reads the Cost Detail bases; contingency reads the input block.
    expect((ws.getCell("D3").value as ExcelJS.CellFormulaValue).formula).toBe("'Cost Detail'!B13");
    expect((ws.getCell("E3").value as ExcelJS.CellFormulaValue).formula).toBe("'Cost Detail'!$B$4");
    // Construction PM row = CEO-basis PM (% of loaded labour) + the design
    // invoice minus the AHJ plan check, at 0% contingency, excluded from the
    // G15 construction subtotal.
    const fin = project.financial;
    expect(cellNumber(ws.getCell("D14").value)).toBeCloseTo(
      result.costs.constructionPm + fin.autoCadDesignCost + fin.electricalEngDesignCost + fin.pmHours * fin.pmHourlyRate,
      2,
    );
    expect(ws.getCell("E14").value).toBe(0);
    expect((ws.getCell("G15").value as ExcelJS.CellFormulaValue).formula).toBe("SUM(G3:G13)");
    // Money ties: G15 = construction total, G18/G19 = labor, G20 = both.
    expect(cellNumber(ws.getCell("G15").value)).toBeCloseTo(
      result.costs.electricalSupplyConstructionTotal,
      2,
    );
    expect(cellNumber(ws.getCell("G18").value)).toBeCloseTo(result.costs.labor, 2);
    expect(cellNumber(ws.getCell("G20").value)).toBeCloseTo(
      result.costs.electricalSupplyConstructionTotal + result.costs.labor,
      2,
    );
  });

  it("Takeoff row totals and the materials grand total tie to the engine", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    const takeoff = wb.getWorksheet("Takeoff")!;
    // 11 charger rows + 3 synthetic service-chain rows, starting at row 4.
    expect(result.rows).toHaveLength(14);
    const lastDataRow = 4 + result.rows.length - 1;
    const grand = takeoff.getCell(lastDataRow + 1, 23).value as ExcelJS.CellFormulaValue;
    expect(grand.result).toBeCloseTo(result.rollups.feederMaterialsTotal, 2);

    const materials = wb.getWorksheet("Materials BOM")!;
    let grandTotal: number | undefined;
    materials.eachRow((row) => {
      if (row.getCell(1).value === "MATERIALS GRAND TOTAL") {
        grandTotal = cellNumber(row.getCell(6).value);
      }
    });
    expect(grandTotal).toBeCloseTo(result.materials.grandTotal, 2);
  });

  it("gear on the Panel Schedule prices every suggested line", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    const panel = wb.getWorksheet("Panel Schedule")!;
    let gearTotal: number | undefined;
    panel.eachRow((row) => {
      if (row.getCell(1).value === "Gear total") gearTotal = cellNumber(row.getCell(6).value);
    });
    expect(gearTotal).toBeCloseTo(
      result.peripherals.gearMainSwitchgear + result.peripherals.gearOtherTotal,
      2,
    );
  });
});

describe("Excel export — proposal sheets", () => {
  const base = buildQuickProject(defaultQuickInput(), defaultProject(), "t");
  const project = { ...base, commercial: defaultCommercial() };
  const result = computeEstimate(project);
  const proposal = computeProposal(project, result)!;

  it("appends Cost Buildup and Business Model after Assumptions, tied to the proposal", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    const names = wb.worksheets.map((w) => w.name);
    expect(names.slice(0, 12)).toEqual([
      "Intake", "Summary", "Cost Detail", "Costs Internal", "Takeoff", "Materials BOM", "Panel Schedule",
      "Panel EV_MAIN 480V", "Panel EV_SUB 208V", "Peripherals", "Equipment", "Assumptions",
    ]);
    expect(names.slice(12, 14)).toEqual(["Cost Buildup", "Business Model"]);

    const cb = wb.getWorksheet("Cost Buildup")!;
    let price: ExcelJS.CellValue | undefined;
    let hardware: ExcelJS.CellValue | undefined;
    cb.eachRow((row) => {
      if (row.getCell(1).value === "CUSTOMER PRICE / FINANCED AMOUNT") price = row.getCell(8).value;
      if (row.getCell(4).value === "hardware") hardware = row.getCell(8).value;
    });
    expect(cellNumber(price!)).toBeCloseTo(proposal.costBuildup.customerPrice, 2);
    expect((price as ExcelJS.CellFormulaValue).formula).toMatch(/^SUM\(H/);
    // Hardware price is a live formula off the list price and the discount input.
    expect((hardware as ExcelJS.CellFormulaValue).formula).toBe("F15*(1-G15)");
    // Cached results are rounded to cents, so allow half a cent.
    expect(cellNumber(hardware!)).toBeCloseTo(project.financial.chargerHardwareCost * 0.93, 1);

    const bm = wb.getWorksheet("Business Model")!;
    let contract: ExcelJS.CellValue | undefined;
    let margin: ExcelJS.CellValue | undefined;
    bm.eachRow((row) => {
      if (row.getCell(1).value === "OUR CONTRACT VALUE") {
        contract = row.getCell(3).value;
        margin = row.getCell(5).value;
      }
    });
    expect(cellNumber(contract!)).toBeCloseTo(proposal.margin.contractValue, 2);
    expect(cellNumber(margin!)).toBeCloseTo(proposal.margin.grossMargin, 2);
    expect((contract as ExcelJS.CellFormulaValue).formula).toContain("SUMIF(");
    // Named ranges the Business Model formulas aggregate over exist.
    expect(wb.definedNames.getRanges("BuildupPrice").ranges.length).toBe(1);
    expect(wb.definedNames.getRanges("CustomerPrice").ranges.length).toBe(1);
  });

  it("the Intake sheet lists SKUs, extras and the equipment schedule", async () => {
    const skuProject = {
      ...buildQuickProject(
        {
          ...defaultQuickInput(),
          lines: [{ loadTypeId: "DCFC 360kW Dual", count: 4, sku: "TP5-360-480-2-300" }],
          extras: [{ sku: "CTX-FLUXPED", count: 2 }],
        },
        defaultProject(),
        "s",
      ),
      commercial: defaultCommercial(),
    };
    const wb = await buildEstimateWorkbook(skuProject, computeEstimate(skuProject));
    const intake = wb.getWorksheet("Intake")!;
    const labels: string[] = [];
    intake.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === "string") labels.push(v);
    });
    expect(labels).toContain("DCFC 360kW Dual — TP5-360-480-2-300");
    expect(labels).toContain("CTX-FLUXPED (dispenser / accessory)");
    expect(labels.some((l) => l.startsWith("Equipment schedule"))).toBe(true);
    expect(labels).toContain("Client, access and utility (intake)");
  });

  it("leaves the twelve estimator sheets alone for a project without a commercial section", async () => {
    const wb = await buildEstimateWorkbook(base, computeEstimate(base));
    expect(wb.worksheets).toHaveLength(12);
  });
});

describe("Excel export — intake blocks for a replacement site with overrides", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { importIntakeFile } = await import("../../intake/importIntake");
  const fixture = join(__dirname, "..", "..", "intake", "__fixtures__", "intake-sample-2.9.0.xlsx");
  const imported = await importIntakeFile(readFileSync(fixture), { ...defaultProject(), commercial: defaultCommercial() });
  const project = { ...imported.project, commercial: { ...imported.project.commercial!, lineExtensionContribution: 12000 } };
  const result = computeEstimate(project);

  it("the Intake sheet carries the interconnection block, the existing installation and the override register", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    const intake = wb.getWorksheet("Intake")!;
    const labels: string[] = [];
    intake.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === "string") labels.push(v);
    });
    expect(labels.some((l) => l.startsWith("Utility interconnection — SCE Rule 29"))).toBe(true);
    expect(labels).toContain("Rule 15 distribution line extension");
    expect(labels).toContain("Exclusion wording for the proposal");
    expect(labels.some((l) => l.startsWith("Existing installation — rip and replace"))).toBe(true);
    expect(labels).toContain("Availability recovered");
    expect(labels).toContain("Removal — concrete pads saw-cut and broken out");
    expect(labels.some((l) => l.startsWith("Override register — 4 active"))).toBe(true);
    expect(labels).toContain("Main Distribution Switchgear — base, before contingency and markup");
    // The line-extension contribution is its own pass-through row on Cost Buildup, read from the B13 input.
    const cb = wb.getWorksheet("Cost Buildup")!;
    let row: ExcelJS.Row | undefined;
    cb.eachRow((r) => {
      if (r.getCell(4).value === "lineExtension") row = r;
    });
    expect(row).toBeDefined();
    expect(cellNumber(row!.getCell(8).value)).toBe(12000);
    expect((row!.getCell(5).value as ExcelJS.CellFormulaValue).formula).toBe("$B$13");
    expect(cb.getCell("B13").value).toBe(12000);
    // Cost Detail carries the register's switchgear base.
    const costs = wb.getWorksheet("Cost Detail")!;
    let sg: number | undefined;
    costs.eachRow((r) => {
      if (r.getCell(1).value === "Main Distribution Switchgear") sg = cellNumber(r.getCell(2).value);
    });
    expect(sg).toBe(150000);
  });
});

describe("Excel export — business-model sheets", () => {
  // Best Western as a Quick Estimate on a verified PG&E schedule, so every
  // sheet carries real numbers: 4 × TP5-360 dual + 2 × CTX-C40 dual, 24/7.
  const base = buildQuickProject(
    {
      ...defaultQuickInput(),
      clientName: "Best Western",
      lines: [
        { loadTypeId: "DCFC 360kW Dual", count: 4, sku: "TP5-360-480-2-300" },
        { loadTypeId: "L2 Dual 40A", count: 2, sku: "CTX-C40-240-2" },
      ],
    },
    defaultProject(),
    "bw",
  );
  base.setup.utility = "PG&E — Pacific Gas and Electric";
  const project = {
    ...base,
    commercial: { ...defaultCommercial(), deal: { ...modelInputsOf(undefined).deal, carbonSharePct: 0.5, capitalContribution: 100000 } },
    intake: { ...defaultIntake(), hoursOpen: 24, daysPerWeek: 7, rateSchedule: "BEV-2-S" },
  };
  const result = computeEstimate(project);
  const model = computeProposal(project, result)!.model;

  const cellAt = (ws: ExcelJS.Worksheet, label: string, col = 2) => {
    let found: ExcelJS.CellValue | undefined;
    ws.eachRow((row) => {
      if (row.getCell(1).value === label) found = row.getCell(col).value;
    });
    if (found === undefined) throw new Error(`no row labelled ${label}`);
    return found;
  };
  const formulaOf = (v: ExcelJS.CellValue) => (v as ExcelJS.CellFormulaValue).formula;

  it("appends the six model sheets after Business Model", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    expect(wb.worksheets.map((w) => w.name).slice(12)).toEqual([
      "Cost Buildup", "Business Model", "Utility Rates", "Revenue", "Carbon", "Financing", "Cashflow", "Deal Structure",
    ]);
  });

  it("Revenue and Utility Rates carry live formulas whose cached results tie to the model", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    const rev = wb.getWorksheet("Revenue")!;
    expect(cellNumber(rev.getCell("B32").value)).toBeCloseTo(model.usage.siteKwhPerYear, 2);
    // Year 1 sits under the header at row 38: kWh = DC + L2, profit = gross − utility − fees − service.
    expect(cellNumber(rev.getCell("C38").value)).toBeCloseTo(model.revenue.years[0].kwh, 2);
    expect(formulaOf(rev.getCell("C38").value)).toBe("D38+E38");
    expect(formulaOf(rev.getCell("G38").value)).toBe("C38*'Utility Rates'!$B$22+'Utility Rates'!M33");
    expect(cellNumber(rev.getCell("J38").value)).toBeCloseTo(model.revenue.years[0].chargingProfit, 2);
    expect(cellNumber(rev.getCell("J47").value)).toBeCloseTo(model.revenue.years[9].chargingProfit, 2);
    expect(formulaOf(rev.getCell("B41").value)).toBe("$B$14*(1+$B$15)^1");

    const ur = wb.getWorksheet("Utility Rates")!;
    expect(cellNumber(ur.getCell("B22").value)).toBeCloseTo(model.tariff.blendedPerKwh, 6);
    expect(ur.getCell("B14").value).toBe(50); // BEV-2-S block size
    expect(cellNumber(ur.getCell("H33").value)).toBe(model.tariff.years[0].blocks);
    expect(formulaOf(ur.getCell("H33").value)).toBe("IF($B$14=0,0,ROUNDUP(G33/$B$14,0))");
    expect(cellNumber(ur.getCell("I33").value)).toBeCloseTo(model.tariff.years[0].subscriptionCost, 2);
    expect(cellNumber(ur.getCell("M42").value)).toBeCloseTo(model.tariff.years[9].fixedCost, 2);
    expect(cellNumber(cellAt(ur, "Saving from ramping the subscription"))).toBeCloseTo(model.tariff.savingFromRamping, 2);
  });

  it("Carbon, Financing, Cashflow and Deal Structure tie to the model and read each other", async () => {
    const wb = await buildEstimateWorkbook(project, result);
    const carbon = wb.getWorksheet("Carbon")!;
    expect(formulaOf(carbon.getCell("B14").value)).toBe("'Cost Buildup'!$H$" + formulaOf(carbon.getCell("B14").value).split("$H$")[1]);
    expect(cellNumber(carbon.getCell("B13").value)).toBeCloseTo(model.carbon.netPerYear, 2);
    expect(cellNumber(carbon.getCell("H20").value)).toBeCloseTo(model.carbon.years[0].net, 2);
    expect(formulaOf(carbon.getCell("C21").value)).toBe("IF(A21>$B$6,0,MIN($B$12,MAX(0,$B$15-B21)))");

    const fin = wb.getWorksheet("Financing")!;
    expect(cellNumber(fin.getCell("B7").value)).toBeCloseTo(model.financing.baseAmount, 2);
    expect(formulaOf(fin.getCell("B7").value)).toContain("'Business Model'!$G$");
    expect(cellNumber(fin.getCell("B14").value)).toBeCloseTo(model.financing.payment, 2);
    expect(formulaOf(fin.getCell("B14").value)).toContain("PMT($B$10/$B$12,$B$13,-$B$9)");
    expect(cellNumber(fin.getCell("F80").value)).toBeCloseTo(0, 1); // payment 60 closes the loan

    const cash = wb.getWorksheet("Cashflow")!;
    expect(cellNumber(cash.getCell("D5").value)).toBeCloseTo(-model.financing.baseAmount, 2);
    expect(cellNumber(cellAt(cash, "NPV at the discount rate"))).toBeCloseTo(model.cashflow.npv, 2);
    expect(formulaOf(cellAt(cash, "NPV at the discount rate"))).toBe("NPV(Financing!$B$18,D6:D15)+D5");
    expect(cellNumber(cellAt(cash, "IRR"))).toBeCloseTo(model.cashflow.irr!, 6);
    expect(cellNumber(cellAt(cash, "Cumulative break-even (year)"))).toBe(model.cashflow.breakEvenYear);
    expect(cellNumber(cellAt(cash, "Cumulative position across the term"))).toBeCloseTo(model.cashflow.cumulativeMonthly, 2);

    const deal = wb.getWorksheet("Deal Structure")!;
    expect(deal.getCell("B5").value).toBe(0.5);
    expect(cellNumber(deal.getCell("B22").value)).toBeCloseTo(model.deal.contributions.total, 2);
    expect(cellNumber(deal.getCell("B26").value)).toBeCloseTo(model.deal.clientPrice, 2);
    expect(cellNumber(deal.getCell("B27").value)).toBeCloseTo(model.deal.clientPayment, 2);
    expect(cellNumber(deal.getCell("F32").value)).toBeCloseTo(model.deal.years[0].carbonWeTake, 2);
    expect(cellNumber(cellAt(deal, "NPV at the discount rate", 2))).toBeCloseTo(model.deal.client.npv, 2);
    expect(cellNumber(cellAt(deal, "NPV at the discount rate", 3))).toBeCloseTo(model.deal.ours.npv, 2);
    expect(cellNumber(cellAt(deal, "IRR", 3))).toBeCloseTo(model.deal.ours.irr!, 6);
    expect(cellNumber(cellAt(deal, "Return multiple on our capital", 3))).toBeCloseTo(model.deal.ours.returnMultiple!, 4);
    expect(cellAt(deal, "Return on our capital at or above the minimum multiple")).toMatchObject({ result: "OK" });
  });

  it("no financing: the Financing sheet has no schedule and Cashflow no monthly block", async () => {
    const cash = { ...project, commercial: { ...project.commercial, financing: { ...modelInputsOf(undefined).financing, offered: false } } };
    const wb = await buildEstimateWorkbook(cash, computeEstimate(cash));
    const fin = wb.getWorksheet("Financing")!;
    expect(fin.getCell("B4").value).toBe("No");
    expect(cellNumber(fin.getCell("B14").value)).toBe(0);
    expect(fin.getCell("A21").value ?? null).toBeNull();
    const cf = wb.getWorksheet("Cashflow")!;
    let monthly = false;
    cf.eachRow((row) => {
      if (row.getCell(1).value === "Position by payment period during the financing term") monthly = true;
    });
    expect(monthly).toBe(false);
  });
});
