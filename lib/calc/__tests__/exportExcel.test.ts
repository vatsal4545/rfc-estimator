import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildEstimateWorkbook, estimateWorkbookBuffer } from "../../exportExcel";
import { buildQuickProject, defaultQuickInput } from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";

function cellNumber(v: ExcelJS.CellValue): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v) return v.result as number;
  throw new Error(`cell is not numeric: ${JSON.stringify(v)}`);
}

describe("Excel export", () => {
  const project = buildQuickProject(
    { ...defaultQuickInput(), clientName: "Test Client", terrain: "hilly" },
    defaultProject(),
    "t",
  );
  const result = computeEstimate(project);

  it("round-trips through the xlsx format with all eight sheets", async () => {
    const buffer = await estimateWorkbookBuffer(project, result);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Summary",
      "Cost Detail",
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
