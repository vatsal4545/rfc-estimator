// Excel export: renders the current estimate as a styled .xlsx workbook.
//
// The money math is written as LIVE FORMULAS (with cached results so the file
// opens showing the right numbers even before Excel recalculates): change the
// contingency %, a qty, or a unit cost inside Excel and every subtotal and the
// Total Cost update — the workbook behaves like the original RFC_V18 sheets,
// but generated in one click. Engineering decisions (wire sizes, breaker
// picks) are exported as values; re-run the app to re-derive those.

import ExcelJS from "exceljs";
import { GPR_ITEM_NAME, TERRAIN_INFO, estimateTimeline, timelineTotal } from "./calc/autoplan";
import { laborBreakdown } from "./calc/costs";
import { INSTALL_METHOD_INFO, effectiveInstallMethod, surfaceRouteFt } from "./calc/install";
import { GEAR_CATALOG } from "./calc/tables";
import type { EstimateResult, GearSelection, Project } from "./calc/types";
import { COSTS_INTERNAL_TAB_COLOR, fillCostsInternal } from "./costsInternalSheet";

const MONEY = '"$"#,##0.00';
const PCT = "0.00%";
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8EDF5" },
};

type WS = ExcelJS.Worksheet;

function f(formula: string, result: number): ExcelJS.CellFormulaValue {
  return { formula, result: Math.round(result * 100) / 100 };
}

function headerRow(ws: WS, rowNo: number, labels: string[], startCol = 1): void {
  labels.forEach((label, i) => {
    const cell = ws.getCell(rowNo, startCol + i);
    cell.value = label;
    cell.font = { bold: true, size: 10 };
    cell.fill = HEADER_FILL;
    cell.border = { bottom: { style: "thin" } };
  });
}

function sectionTitle(ws: WS, rowNo: number, text: string): void {
  const cell = ws.getCell(rowNo, 1);
  cell.value = text;
  cell.font = { bold: true, size: 12 };
}

function moneyCol(ws: WS, col: number): void {
  ws.getColumn(col).numFmt = MONEY;
}

export async function buildEstimateWorkbook(
  project: Project,
  result: EstimateResult,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RFC Estimator";
  wb.created = new Date();

  // Tab order = reading order; Summary is filled last (it references Cost Detail).
  const intake = wb.addWorksheet("Intake");
  const summary = wb.addWorksheet("Summary");
  const costs = wb.addWorksheet("Cost Detail");
  const costsInternal = wb.addWorksheet("Costs Internal", {
    properties: { tabColor: { argb: COSTS_INTERNAL_TAB_COLOR } },
  });
  const takeoff = wb.addWorksheet("Takeoff");
  const materials = wb.addWorksheet("Materials BOM");
  const panel = wb.addWorksheet("Panel Schedule");
  // Plan-set style schedules — created here so they tab right after the summary.
  const panel480 = result.panel.bus480 ? wb.addWorksheet("Panel EV_MAIN 480V") : undefined;
  const panel208 = result.panel.bus208 ? wb.addWorksheet("Panel EV_SUB 208V") : undefined;
  const peripherals = wb.addWorksheet("Peripherals");
  const equipment = wb.addWorksheet("Equipment");
  const assumptions = wb.addWorksheet("Assumptions");

  const refs = fillCostDetail(costs, project, result);
  fillSummary(summary, project, result, refs);
  const fin = project.financial;
  fillCostsInternal(costsInternal, {
    // One CellSource per engine cost line, in engine order (matches the labels).
    lines: result.costs.lines.map((line, i) => ({
      formula: `'Cost Detail'!B${refs.lineStartRow + i}`,
      cached: line.base,
    })),
    contingency: { formula: "'Cost Detail'!$B$4", cached: fin.contingencyPct },
    laborContingency: {
      formula: "IF('Cost Detail'!$B$8,'Cost Detail'!$B$4,0)",
      cached: (fin.applyContingencyToLabor ?? true) ? fin.contingencyPct : 0,
    },
    dailyRate: { formula: "'Cost Detail'!$B$6", cached: laborBreakdown(fin).blendedRate },
    businessDays: { formula: "'Cost Detail'!$B$7", cached: fin.laborBusinessDays },
    // Site plan + SLD + PM hours×rate — everything on the Design invoice
    // except the plan check / permit fee (permitting-side).
    constructionPm: {
      formula: `'Cost Detail'!D${refs.designStartRow}+'Cost Detail'!D${refs.designStartRow + 1}+'Cost Detail'!D${refs.designStartRow + 2}`,
      cached: fin.autoCadDesignCost + fin.electricalEngDesignCost + fin.pmHours * fin.pmHourlyRate,
    },
  });
  fillIntake(intake, project, result);
  fillTakeoff(takeoff, result);
  fillMaterials(materials, project, result);
  fillPanel(panel, project, result);
  fillPlanSetSchedules(result, panel480, panel208);
  fillPeripherals(peripherals, result);
  fillEquipment(equipment, result);
  fillAssumptions(assumptions, project, result);
  return wb;
}

export async function estimateWorkbookBuffer(
  project: Project,
  result: EstimateResult,
): Promise<ArrayBuffer> {
  const wb = await buildEstimateWorkbook(project, result);
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Browser helper: builds the workbook and triggers a download. */
export async function downloadEstimateExcel(
  project: Project,
  result: EstimateResult,
): Promise<void> {
  const buffer = await estimateWorkbookBuffer(project, result);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const name = project.setup.clientName || "project";
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-rfc-estimate.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Cost Detail — the Costs Internal / Summary chain with live formulas
// ---------------------------------------------------------------------------

interface CostRefs {
  constructionSubtotal: string;
  labor: string;
  salesTax: string;
  equipSubtotal: string;
  designSubtotal: string;
  total: string;
  /** Row of the first construction line on Cost Detail (Costs Internal reads them). */
  lineStartRow: number;
  /** Row of the first Design Invoice line (site plan; SLD and PM follow). */
  designStartRow: number;
}

function fillCostDetail(ws: WS, project: Project, result: EstimateResult): CostRefs {
  const fin = project.financial;
  const c = result.costs;
  ws.getColumn(1).width = 44;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 16;

  sectionTitle(ws, 1, "Cost Detail");
  ws.getCell("A2").value =
    "Editable inputs — change these (or any qty / unit cost) and the totals recalculate.";
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };

  // Inputs block (absolute refs used by the formulas below). With an
  // itemized labor breakdown the daily rate is the blended base/days, so
  // the rate x days formula chain still equals the itemized total.
  const labor = laborBreakdown(fin);
  const inputs: [string, string, number | boolean, string?][] = [
    ["B4", "Contingency %", fin.contingencyPct, PCT],
    ["B5", "Sales tax %", fin.salesTaxPct, PCT],
    ["B6", labor.itemized ? "Labor daily rate (blended — see Assumptions)" : "Labor daily rate", labor.blendedRate, MONEY],
    ["B7", "Labor business days", fin.laborBusinessDays],
    ["B8", "Apply contingency to labor", fin.applyContingencyToLabor ?? true],
    ["B9", "PM hours (CPM)", fin.pmHours],
    ["B10", "PM hourly rate", fin.pmHourlyRate, MONEY],
  ];
  for (const [addr, label, value, fmt] of inputs) {
    const cell = ws.getCell(addr);
    ws.getCell(addr.replace("B", "A")).value = label;
    cell.value = value;
    if (fmt) cell.numFmt = fmt;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6DD" } };
  }

  // Construction lines: base | contingency | final.
  let row = 12;
  headerRow(ws, row, ["Electrical supply & construction", "Base", "Contingency", "Final"]);
  row++;
  const firstLine = row;
  for (const line of c.lines) {
    ws.getCell(row, 1).value = line.name;
    ws.getCell(row, 2).value = line.base;
    ws.getCell(row, 3).value = f(`B${row}*$B$4`, line.contingency);
    ws.getCell(row, 4).value = f(`B${row}+C${row}`, line.finalCost);
    row++;
  }
  const subRow = row;
  ws.getCell(row, 1).value = "Construction total";
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 4).value = f(
    `SUM(D${firstLine}:D${subRow - 1})`,
    c.electricalSupplyConstructionTotal,
  );
  ws.getCell(row, 4).font = { bold: true };
  row += 1;
  const laborRow = row;
  ws.getCell(row, 1).value = "Labor (rate × days, contingency per toggle)";
  ws.getCell(row, 4).value = f(`$B$6*(1+IF($B$8,$B$4,0))*$B$7`, c.labor);
  row += 1;
  const taxRow = row;
  ws.getCell(row, 1).value = "Sales tax on construction";
  ws.getCell(row, 4).value = f(`D${subRow}*$B$5`, c.salesTaxOnConstruction);
  row += 2;

  // Equipment purchase invoice.
  headerRow(ws, row, ["Equipment Purchase Invoice", "", "", "Amount"]);
  row++;
  const equipStart = row;
  const equipLines: [string, number][] = [
    ["Charger hardware", fin.chargerHardwareCost],
    ["Warranty", fin.chargerWarrantyCost],
    ["Commissioning", fin.evolvCommissioningCost],
    ["5-year service agreement", fin.fiveYearServiceCost],
  ];
  for (const [name, base] of equipLines) {
    ws.getCell(row, 1).value = name;
    ws.getCell(row, 4).value = base;
    row++;
  }
  ws.getCell(row, 1).value = "Sales tax on charger hardware";
  ws.getCell(row, 4).value = f(`D${equipStart}*$B$5`, c.equipmentPurchaseTax);
  row++;
  const equipSubRow = row;
  ws.getCell(row, 1).value = "Equipment purchase total";
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 4).value = f(
    `SUM(D${equipStart}:D${equipSubRow - 1})`,
    c.equipmentPurchaseInvoice + c.equipmentPurchaseTax,
  );
  ws.getCell(row, 4).font = { bold: true };
  row += 2;

  // Design invoice.
  headerRow(ws, row, ["Design Invoice", "", "", "Amount"]);
  row++;
  const designStart = row;
  ws.getCell(row, 1).value = "Site plan design (AutoCAD)";
  ws.getCell(row, 4).value = fin.autoCadDesignCost;
  row++;
  ws.getCell(row, 1).value = "SLD / electrical engineering design";
  ws.getCell(row, 4).value = fin.electricalEngDesignCost;
  row++;
  ws.getCell(row, 1).value = "Construction PM (hours × rate)";
  ws.getCell(row, 4).value = f(`$B$9*$B$10`, fin.pmHours * fin.pmHourlyRate);
  row++;
  ws.getCell(row, 1).value = "Plan check / permit fee (financed)";
  ws.getCell(row, 4).value = fin.planCheckPermitFee;
  row++;
  const designSubRow = row;
  ws.getCell(row, 1).value = "Design invoice total";
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 4).value = f(`SUM(D${designStart}:D${designSubRow - 1})`, c.designInvoice);
  ws.getCell(row, 4).font = { bold: true };
  row += 2;

  const totalRow = row;
  ws.getCell(row, 1).value = "TOTAL COST";
  ws.getCell(row, 1).font = { bold: true, size: 13 };
  ws.getCell(row, 4).value = f(
    `D${subRow}+D${laborRow}+D${taxRow}+D${equipSubRow}+D${designSubRow}`,
    c.totalCost,
  );
  ws.getCell(row, 4).font = { bold: true, size: 13 };
  ws.getCell(row, 4).fill = HEADER_FILL;

  moneyCol(ws, 2);
  moneyCol(ws, 3);
  moneyCol(ws, 4);
  ws.getCell("B7").numFmt = "0";
  ws.getCell("B9").numFmt = "0";
  ws.views = [{ state: "frozen", ySplit: 3 }];

  return {
    constructionSubtotal: `'Cost Detail'!D${subRow}`,
    labor: `'Cost Detail'!D${laborRow}`,
    salesTax: `'Cost Detail'!D${taxRow}`,
    equipSubtotal: `'Cost Detail'!D${equipSubRow}`,
    designSubtotal: `'Cost Detail'!D${designSubRow}`,
    total: `'Cost Detail'!D${totalRow}`,
    lineStartRow: firstLine,
    designStartRow: designStart,
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function fillSummary(ws: WS, project: Project, result: EstimateResult, refs: CostRefs): void {
  const s = project.setup;
  const c = result.costs;
  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 52;

  ws.getCell("A1").value = `RFC Estimate — ${s.clientName || "New project"}`;
  ws.getCell("A1").font = { bold: true, size: 16 };

  const info: [string, string][] = [
    ["Client", s.clientName],
    ["Site address", s.siteAddress],
    ["Utility", s.utility],
    ["CPM", s.cpm],
    ["CRA", s.cra],
    ["Price list", `${s.priceListSource} (${s.priceListDate})`],
    ["Date generated", new Date().toISOString().slice(0, 10)],
    ["Scope of work", s.scopeOfWork],
  ];
  let row = 3;
  for (const [label, value] of info) {
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 1).font = { bold: true };
    ws.getCell(row, 2).value = value;
    row++;
  }
  row++;

  headerRow(ws, row, ["Cost summary", "Amount"]);
  row++;
  const lines: [string, string, number][] = [
    ["Electrical supply & construction", refs.constructionSubtotal, c.electricalSupplyConstructionTotal],
    ["Labor", refs.labor, c.labor],
    ["Sales tax on construction", refs.salesTax, c.salesTaxOnConstruction],
    ["Equipment purchase invoice (incl. tax)", refs.equipSubtotal, c.equipmentPurchaseInvoice + c.equipmentPurchaseTax],
    ["Design invoice", refs.designSubtotal, c.designInvoice],
  ];
  for (const [label, ref, value] of lines) {
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 2).value = f(ref, value);
    ws.getCell(row, 2).numFmt = MONEY;
    row++;
  }
  ws.getCell(row, 1).value = "TOTAL COST";
  ws.getCell(row, 1).font = { bold: true, size: 14 };
  ws.getCell(row, 2).value = f(refs.total, c.totalCost);
  ws.getCell(row, 2).font = { bold: true, size: 14 };
  ws.getCell(row, 2).numFmt = MONEY;
  ws.getCell(row, 2).fill = HEADER_FILL;
  row += 2;

  const failing = result.qa.filter((q) => !q.ok);
  ws.getCell(row, 1).value = failing.length === 0 ? "QA: all checks pass" : "QA: review before quoting";
  ws.getCell(row, 1).font = {
    bold: true,
    color: { argb: failing.length === 0 ? "FF1F7A33" : "FFB45309" },
  };
  row++;
  for (const q of failing) {
    ws.getCell(row, 1).value = `• ${q.label}`;
    ws.getCell(row, 2).value = q.detail;
    row++;
  }
}

// ---------------------------------------------------------------------------
// Takeoff
// ---------------------------------------------------------------------------

function fillTakeoff(ws: WS, result: EstimateResult): void {
  const cols = [4, 26, 16, 8, 6, 10, 6, 11, 5, 9, 9, 11, 8, 9, 9, 11, 9, 9, 9, 11, 8, 11, 12, 22];
  cols.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  sectionTitle(ws, 1, "Takeoff — one row per circuit run (service chain rows are auto-generated)");
  headerRow(ws, 3, [
    "#", "Location", "Load type", "Volts", "Ph", "Units", "Runs", "Dist ft",
    "Wire", "Wire ft", "$/ft", "Wire cost",
    "Ground", "Gnd ft", "$/ft", "Gnd cost",
    "Conduit", "Cond ft", "$/ft", "Cond cost",
    "Data ft", "Data cost", "Row total", "Flag",
  ]);

  let row = 4;
  const first = row;
  result.rows.forEach((r, i) => {
    const v = [
      i + 1,
      r.synthetic ? `${r.location} (auto)` : r.location,
      r.loadTypeId,
      r.volts, r.phases, r.units, r.resolvedRunsPerUnit, r.oneWayDistFt,
      `${r.selectedWire} ${r.material}`, r.wireFt, r.wireCostPerFt, null,
      r.groundSize, r.groundFt, r.groundCostPerFt, null,
      r.conduitSize, r.conduitFt, r.conduitCostPerFt, null,
      r.dataFt, r.dataCost, null,
      r.flag === "OK" ? "" : r.flag,
    ];
    v.forEach((val, ci) => {
      if (val !== null) ws.getCell(row, ci + 1).value = val as ExcelJS.CellValue;
    });
    ws.getCell(row, 12).value = f(`J${row}*K${row}`, r.wireCost);
    ws.getCell(row, 16).value = f(`N${row}*O${row}`, r.groundCost);
    ws.getCell(row, 20).value = f(`R${row}*S${row}`, r.conduitCost);
    ws.getCell(row, 23).value = f(`L${row}+P${row}+T${row}+V${row}`, r.rowTotal);
    if (r.synthetic) ws.getRow(row).font = { color: { argb: "FF64748B" } };
    row++;
  });
  ws.getCell(row, 2).value = "Feeder materials total";
  ws.getCell(row, 2).font = { bold: true };
  ws.getCell(row, 23).value = f(`SUM(W${first}:W${row - 1})`, result.rollups.feederMaterialsTotal);
  ws.getCell(row, 23).font = { bold: true };

  for (const col of [11, 12, 15, 16, 19, 20, 22, 23]) moneyCol(ws, col);
  ws.views = [{ state: "frozen", ySplit: 3 }];
}

// ---------------------------------------------------------------------------
// Materials BOM
// ---------------------------------------------------------------------------

function fillMaterials(ws: WS, project: Project, result: EstimateResult): void {
  const m = result.materials;
  [16, 12, 12, 14, 12, 12, 14, 30].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  sectionTitle(ws, 1, "Bill of materials — vendor-ready");
  headerRow(ws, 3, ["Conductor size", "Cu ft", "Cu $/ft", "Cu cost", "Al ft", "Al $/ft", "Al cost", "Flag"]);
  let row = 4;
  const wireFirst = row;
  for (const l of m.wireLines.filter((l) => l.cuFt > 0 || l.alFt > 0)) {
    ws.getCell(row, 1).value = l.size;
    ws.getCell(row, 2).value = l.cuFt;
    ws.getCell(row, 3).value = l.cuPerFt;
    ws.getCell(row, 4).value = f(`B${row}*C${row}`, l.cuCost);
    ws.getCell(row, 5).value = l.alFt;
    ws.getCell(row, 6).value = l.alPerFt;
    ws.getCell(row, 7).value = f(`E${row}*F${row}`, l.alCost);
    ws.getCell(row, 8).value = l.flag;
    row++;
  }
  const wireSub = row;
  ws.getCell(row, 1).value = "Conductor subtotals";
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 4).value = f(`SUM(D${wireFirst}:D${wireSub - 1})`, m.conductorSubtotalCu);
  ws.getCell(row, 7).value = f(`SUM(G${wireFirst}:G${wireSub - 1})`, m.conductorSubtotalAl);
  row += 2;

  headerRow(ws, row, ["Conduit trade size", "Feeder ft", "Data ft", "Total ft", "$/ft", "Cost", "", "Flag"]);
  row++;
  const condFirst = row;
  for (const l of m.conduitLines.filter((l) => l.totalFt > 0)) {
    ws.getCell(row, 1).value = `${l.tradeSize} ${l.conduitType}`;
    ws.getCell(row, 2).value = l.feederFt;
    ws.getCell(row, 3).value = l.dataFt;
    ws.getCell(row, 4).value = f(`B${row}+C${row}`, l.totalFt);
    ws.getCell(row, 5).value = l.perFt;
    ws.getCell(row, 6).value = f(`D${row}*E${row}`, l.cost);
    ws.getCell(row, 8).value = l.flag;
    row++;
  }
  const condSub = row;
  ws.getCell(row, 1).value = "Conduit subtotal";
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 6).value = f(`SUM(F${condFirst}:F${condSub - 1})`, m.conduitSubtotal);
  row += 2;

  ws.getCell(row, 1).value = `Data cable (${result.rollups.totalDataFt} ft × $${project.setup.dataRatePerFt}/ft)`;
  ws.getCell(row, 6).value = m.dataCableCost;
  const dataRow = row;
  row++;
  ws.getCell(row, 1).value = "MATERIALS GRAND TOTAL";
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 6).value = f(
    `D${wireSub}+G${wireSub}+F${condSub}+F${dataRow}`,
    m.grandTotal,
  );
  ws.getCell(row, 6).font = { bold: true };
  ws.getCell(row, 6).fill = HEADER_FILL;

  for (const col of [3, 4, 5, 6, 7]) moneyCol(ws, col);
  ws.getColumn(2).numFmt = "#,##0";
  ws.getColumn(4).numFmt = "#,##0";
  ws.views = [{ state: "frozen", ySplit: 3 }];
}

// ---------------------------------------------------------------------------
// Panel schedule
// ---------------------------------------------------------------------------

function gearUnitCost(sel: GearSelection): number {
  if (sel.costOverride !== undefined) return sel.costOverride;
  const hit = GEAR_CATALOG.find(
    (g) => g.item === sel.item && g.size === sel.size && g.voltage === sel.voltage,
  );
  return hit?.unitCost ?? 0;
}

function fillPanel(ws: WS, project: Project, result: EstimateResult): void {
  const p = result.panel;
  [26, 22, 10, 6, 8, 10, 12, 11, 14, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  sectionTitle(ws, 1, "Panel schedule — branch circuits");
  headerRow(ws, 3, ["Load type", "Location", "Volts", "Ph", "Poles", "Circuits", "A / circuit", "Breaker A", "Wire", "Conduit"]);
  let row = 4;
  for (const b of p.branches) {
    const v = [b.loadTypeId, b.location, b.voltage, b.phases, b.poles, b.circuits, b.ampsPerCircuit, b.breakerA, b.wire, b.conduit];
    v.forEach((val, ci) => (ws.getCell(row, ci + 1).value = val));
    row++;
  }
  row++;

  sectionTitle(ws, row, "Buses & transformer");
  row++;
  const busLines: string[][] = [];
  if (p.bus480) busLines.push(["480V bus", `${p.bus480.circuitCount} circuits`, `connected ${p.bus480.connectedAmps.toFixed(0)}A`, `demand ${p.bus480.demandAmps.toFixed(0)}A`, `suggested ${p.bus480.suggestedBusA}A`]);
  if (p.bus208) busLines.push(["208V bus", `${p.bus208.circuitCount} circuits`, `connected ${p.bus208.connectedAmps.toFixed(0)}A`, `demand ${p.bus208.demandAmps.toFixed(0)}A`, `suggested ${p.bus208.suggestedBusA}A`]);
  if (p.transformer) busLines.push(["Step-down transformer", `connected ${p.transformer.connectedKva.toFixed(1)} kVA`, `demand ${p.transformer.demandKva.toFixed(1)} kVA`, `suggested ${p.transformer.suggestedKva} kVA`, `primary breaker ${p.transformer.primaryBreakerA}A`]);
  for (const line of busLines) {
    line.forEach((val, ci) => (ws.getCell(row, ci + 1).value = val));
    ws.getCell(row, 1).font = { bold: true };
    row++;
  }
  row++;

  sectionTitle(ws, row, "Gear (priced into the estimate)");
  row++;
  headerRow(ws, row, ["Item", "Size", "Voltage", "Qty", "Unit cost", "Total"]);
  row++;
  const gearFirst = row;
  const gearList = project.peripherals.useAutoGear ? p.suggestedGear : project.peripherals.gear;
  for (const g of gearList) {
    ws.getCell(row, 1).value = g.item;
    ws.getCell(row, 2).value = g.size;
    ws.getCell(row, 3).value = g.voltage;
    ws.getCell(row, 4).value = g.qty;
    const unit = gearUnitCost(g);
    ws.getCell(row, 5).value = unit;
    ws.getCell(row, 6).value = f(`D${row}*E${row}`, g.qty * unit);
    ws.getCell(row, 5).numFmt = MONEY;
    ws.getCell(row, 6).numFmt = MONEY;
    row++;
  }
  ws.getCell(row, 1).value = "Gear total";
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 6).value = f(
    `SUM(F${gearFirst}:F${row - 1})`,
    result.peripherals.gearMainSwitchgear + result.peripherals.gearOtherTotal,
  );
  ws.getCell(row, 6).numFmt = MONEY;
  ws.getCell(row, 6).font = { bold: true };
  row += 2;

  for (const note of p.notes) {
    ws.getCell(row, 1).value = `Note: ${note}`;
    ws.getCell(row, 1).font = { italic: true, color: { argb: "FFB45309" } };
    row++;
  }
}

// ---------------------------------------------------------------------------
// Plan-set panel schedules — the classic phase-staggered A/B/C layout used in
// permit drawings: odd circuits down the left, even down the right, phase
// rotation A/B/C per slot, "---" continuation rows for multi-pole breakers,
// per-phase VA columns and the TOTAL / DEMAND / HIGH-PHASE footer (NEC 625
// continuous loads at 125%). Footer totals are live SUM formulas.
// ---------------------------------------------------------------------------

interface PanelCircuit {
  desc: string;
  breakerA: number;
  poles: 2 | 3;
  /** VA placed in each occupied phase slot (per pole). */
  vaPerPole: number;
}

interface PanelSlot {
  desc?: string;
  breakerA?: number;
  poles?: number;
  cont?: boolean;
  va?: number;
}

function placeCircuits(circuits: PanelCircuit[]): { left: PanelSlot[]; right: PanelSlot[] } {
  const left: PanelSlot[] = [];
  const right: PanelSlot[] = [];
  for (const c of circuits) {
    const side = left.length <= right.length ? left : right;
    for (let k = 0; k < c.poles; k++) {
      side.push(
        k === 0
          ? { desc: c.desc, breakerA: c.breakerA, poles: c.poles, va: c.vaPerPole }
          : { cont: true, va: c.vaPerPole },
      );
    }
  }
  return { left, right };
}

function fillPlanSet(
  ws: WS,
  opts: {
    name: string;
    fedBy: string;
    vLN: number;
    vLL: number;
    busA: number;
    aic: string;
    circuits: PanelCircuit[];
  },
): void {
  const widths = [4, 5, 26, 9, 7, 11, 11, 11, 11, 11, 11, 7, 9, 26, 5, 4];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells(1, 2, 1, 15);
  ws.getCell(1, 2).value = "PANEL SCHEDULE";
  ws.getCell(1, 2).font = { bold: true, size: 13 };
  ws.getCell(1, 2).alignment = { horizontal: "center" };

  const hdr = (row: number, col: number, labelText: string, value: string | number) => {
    ws.getCell(row, col).value = labelText;
    ws.getCell(row, col).font = { bold: true, size: 10 };
    ws.getCell(row, col + 1).value = value;
  };
  hdr(3, 2, "NAME", opts.name);
  hdr(3, 4, "LOCATION", "OUTDOOR");
  hdr(3, 8, "VOLTAGE", `${opts.vLN} / ${opts.vLL}  3PH 4W`);
  hdr(3, 13, "MAIN", `${opts.busA} A 3P`);
  hdr(4, 4, "FED BY", opts.fedBy);
  hdr(4, 8, "ENCLOSURE", "NEMA3R");
  hdr(4, 13, "BUS BAR", `${opts.busA} A`);
  hdr(5, 4, "MOUNTING", "SURFACE");
  hdr(5, 8, "PANEL TYPE", "NF");
  hdr(5, 13, "MAIN AIC", opts.aic);

  // Column headers with merged phase columns (left/right sub-cells each).
  const HEAD = 7;
  const heads: [number, string][] = [
    [2, "CKT"], [3, "DESCRIPTION"], [4, "BREAKER"], [5, "POLES"],
    [12, "POLES"], [13, "BREAKER"], [14, "DESCRIPTION"], [15, "CKT"],
  ];
  for (const [col, text] of heads) {
    ws.getCell(HEAD, col).value = text;
    ws.getCell(HEAD, col).font = { bold: true, size: 10 };
    ws.getCell(HEAD, col).fill = HEADER_FILL;
    ws.getCell(HEAD, col).alignment = { horizontal: "center" };
  }
  (["A", "B", "C"] as const).forEach((ph, i) => {
    const col = 6 + i * 2;
    ws.mergeCells(HEAD, col, HEAD, col + 1);
    ws.getCell(HEAD, col).value = ph;
    ws.getCell(HEAD, col).font = { bold: true, size: 10 };
    ws.getCell(HEAD, col).fill = HEADER_FILL;
    ws.getCell(HEAD, col).alignment = { horizontal: "center" };
  });

  const { left, right } = placeCircuits(opts.circuits);
  // Complete the phase rotation and leave spare slots, like real schedules.
  const usedSlots = Math.max(left.length, right.length);
  const slots = Math.max(12, Math.ceil((usedSlots + 3) / 3) * 3);
  const GRID = HEAD + 1;

  const phaseVA = [0, 0, 0];
  for (let s = 0; s < slots; s++) {
    const row = GRID + s;
    const ph = s % 3;
    ws.getCell(row, 1).value = "ABC"[ph];
    ws.getCell(row, 16).value = "ABC"[ph];
    ws.getCell(row, 2).value = 2 * s + 1;
    ws.getCell(row, 15).value = 2 * s + 2;
    const l = left[s];
    if (l) {
      ws.getCell(row, 3).value = l.cont ? "---" : l.desc;
      if (!l.cont) {
        ws.getCell(row, 4).value = l.breakerA;
        ws.getCell(row, 5).value = l.poles;
      }
      if (l.va) {
        ws.getCell(row, 6 + ph * 2).value = Math.round(l.va);
        phaseVA[ph] += l.va;
      }
    }
    const r = right[s];
    if (r) {
      ws.getCell(row, 14).value = r.cont ? "---" : r.desc;
      if (!r.cont) {
        ws.getCell(row, 13).value = r.breakerA;
        ws.getCell(row, 12).value = r.poles;
      }
      if (r.va) {
        ws.getCell(row, 7 + ph * 2).value = Math.round(r.va);
        phaseVA[ph] += r.va;
      }
    }
    for (let col = 2; col <= 15; col++) {
      ws.getCell(row, col).border = { top: { style: "hair" }, bottom: { style: "hair" } };
    }
  }

  // Footer — per-phase on the left, panel totals on the right. Live formulas
  // over the grid so edited VA cells re-total in Excel.
  const F = GRID + slots + 1;
  const gridTop = GRID;
  const gridBot = GRID + slots - 1;
  const colL = (i: number) => ws.getColumn(6 + i * 2).letter;
  const colR = (i: number) => ws.getColumn(7 + i * 2).letter;
  const totalVA = phaseVA.reduce((a, b) => a + b, 0);

  ws.getCell(F, 3).value = "TOTAL VA";
  ws.getCell(F + 1, 3).value = "DEMAND VA";
  ws.getCell(F + 2, 3).value = "HIGH PH VA";
  ws.getCell(F + 3, 3).value = "HIGH PH AMP";
  for (let i = 0; i < 3; i++) {
    const col = 6 + i * 2;
    ws.mergeCells(F, col, F, col + 1);
    ws.getCell(F, col).value = f(
      `SUM(${colL(i)}${gridTop}:${colR(i)}${gridBot})`,
      phaseVA[i],
    );
    ws.mergeCells(F + 1, col, F + 1, col + 1);
    ws.getCell(F + 1, col).value = f(`${colL(i)}${F}*1.25`, phaseVA[i] * 1.25);
    ws.mergeCells(F + 2, col, F + 2, col + 1);
    ws.getCell(F + 2, col).value = f(
      `MAX($F$${F + 1},$H$${F + 1},$J$${F + 1})`,
      Math.max(...phaseVA) * 1.25,
    );
    ws.mergeCells(F + 3, col, F + 3, col + 1);
    ws.getCell(F + 3, col).value = f(
      `${colL(i)}${F + 2}/${opts.vLN}`,
      (Math.max(...phaseVA) * 1.25) / opts.vLN,
    );
    for (let r2 = F; r2 <= F + 3; r2++) ws.getCell(r2, col).numFmt = "#,##0";
  }
  ws.getCell(F + 3, 6).numFmt = "#,##0.0";
  ws.getCell(F + 3, 8).numFmt = "#,##0.0";
  ws.getCell(F + 3, 10).numFmt = "#,##0.0";

  const rLabel = (row: number, text: string) => {
    ws.mergeCells(row, 12, row, 13);
    ws.getCell(row, 12).value = text;
    ws.getCell(row, 12).font = { bold: true, size: 10 };
  };
  rLabel(F, "TOTAL 3PH VA");
  ws.getCell(F, 14).value = f(`F${F}+H${F}+J${F}`, totalVA);
  rLabel(F + 1, "TOTAL DEMAND VA");
  ws.getCell(F + 1, 14).value = f(`N${F}*1.25`, totalVA * 1.25);
  rLabel(F + 2, "TOTAL AMP");
  ws.getCell(F + 2, 14).value = f(
    `N${F + 1}/(${opts.vLL}*SQRT(3))`,
    (totalVA * 1.25) / (opts.vLL * SQRT3_CONST),
  );
  rLabel(F + 3, "MAIN BREAKER");
  ws.getCell(F + 3, 14).value = opts.busA;
  for (let r2 = F; r2 <= F + 2; r2++) ws.getCell(r2, 14).numFmt = "#,##0";
  ws.getCell(F + 2, 14).numFmt = "#,##0.0";
  ws.views = [{ state: "frozen", ySplit: HEAD }];
}

const SQRT3_CONST = Math.sqrt(3);

function fillPlanSetSchedules(result: EstimateResult, ws480?: WS, ws208?: WS): void {
  const p = result.panel;

  const expand = (voltage: 208 | 480): PanelCircuit[] => {
    const out: PanelCircuit[] = [];
    for (const b of p.branches.filter((br) => br.voltage === voltage)) {
      for (let k = 0; k < b.circuits; k++) {
        const suffix = b.circuits > 1 ? ` ${String.fromCharCode(65 + k)}` : "";
        out.push({
          desc: `${b.location}${suffix}`.toUpperCase(),
          breakerA: b.breakerA,
          poles: b.poles,
          vaPerPole:
            b.poles === 3
              ? (voltage / SQRT3_CONST) * b.ampsPerCircuit
              : (voltage * b.ampsPerCircuit) / 2,
        });
      }
    }
    return out;
  };

  if (ws480 && p.bus480) {
    const circuits = expand(480);
    if (p.transformer) {
      circuits.push({
        desc: `XFMR ${p.transformer.suggestedKva} KVA - EV_SUB (208V)`,
        breakerA: p.transformer.primaryBreakerA,
        poles: 3,
        vaPerPole: (p.transformer.connectedKva * 1000) / 3,
      });
    }
    fillPlanSet(ws480, {
      name: "EV_MAIN",
      fedBy: "UTILITY",
      vLN: 277,
      vLL: 480,
      busA: p.bus480.suggestedBusA,
      aic: "65,000",
      circuits,
    });
  }

  if (ws208 && p.bus208) {
    fillPlanSet(ws208, {
      name: "EV_SUB",
      fedBy: p.transformer ? `EV_MAIN VIA ${p.transformer.suggestedKva} KVA XFMR` : "UTILITY",
      vLN: 120,
      vLL: 208,
      busA: p.bus208.suggestedBusA,
      aic: "22,000",
      circuits: expand(208),
    });
  }
}

// ---------------------------------------------------------------------------
// Peripherals
// ---------------------------------------------------------------------------

function fillPeripherals(ws: WS, result: EstimateResult): void {
  const per = result.peripherals;
  [34, 10, 14, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  moneyCol(ws, 3);
  moneyCol(ws, 4);

  let row = 1;
  const writeSection = (
    title: string,
    items: { name: string; qty: number; unitCost: number; auto?: boolean }[],
    subtotalLabel: string,
    subtotalValue: number,
  ) => {
    sectionTitle(ws, row, title);
    row++;
    headerRow(ws, row, ["Item", "Qty", "Unit cost", "Total"]);
    row++;
    const first = row;
    for (const it of items) {
      ws.getCell(row, 1).value = it.auto ? `${it.name} (auto)` : it.name;
      ws.getCell(row, 2).value = Math.round(it.qty * 100) / 100;
      ws.getCell(row, 3).value = it.unitCost;
      ws.getCell(row, 4).value = f(`B${row}*C${row}`, it.qty * it.unitCost);
      row++;
    }
    ws.getCell(row, 1).value = subtotalLabel;
    ws.getCell(row, 1).font = { bold: true };
    if (row > first) ws.getCell(row, 4).value = f(`SUM(D${first}:D${row - 1})`, subtotalValue);
    ws.getCell(row, 4).font = { bold: true };
    row += 2;
  };

  writeSection("Hardware & electrical peripherals", per.lines.hardware, "Hardware subtotal", per.hardwareSubtotal);
  writeSection("Civil (trenching, ADA, concrete)", per.lines.civil, "Civil subtotal", per.civilSubtotal);
  writeSection("Signage & striping", per.lines.signage, "Signage subtotal", per.signageSubtotal);

  sectionTitle(ws, row, "Permits & utility");
  row++;
  const fees: [string, number][] = [
    ["Permit fees (AHJ issuance)", per.permitsSubtotal],
    ["Utility subtotal (application, pad, wells, vaults…)", per.utilitySubtotal],
    ["Dump / waste", per.dumpWaste],
  ];
  for (const [name, val] of fees) {
    ws.getCell(row, 1).value = name;
    ws.getCell(row, 4).value = val;
    row++;
  }
  ws.views = [{ state: "frozen", ySplit: 0 }];
}

// ---------------------------------------------------------------------------
// Equipment rentals
// ---------------------------------------------------------------------------

function fillEquipment(ws: WS, result: EstimateResult): void {
  [24, 10, 12, 18, 10, 12, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  sectionTitle(ws, 1, "Construction equipment rentals");
  headerRow(ws, 3, ["Item", "Qty", "Rate", "Basis", "Duration", "Delivery", "Total"]);
  let row = 4;
  const first = row;
  for (const it of result.equipment.items) {
    ws.getCell(row, 1).value = it.name;
    ws.getCell(row, 2).value = it.qty;
    ws.getCell(row, 3).value = it.rate;
    ws.getCell(row, 4).value = it.rateBasis;
    ws.getCell(row, 5).value = it.durationValue;
    ws.getCell(row, 6).value = it.delivery;
    ws.getCell(row, 7).value = f(`B${row}*C${row}*E${row}+IF(B${row}>0,F${row},0)`, it.total);
    row++;
  }
  ws.getCell(row, 1).value = "Equipment subtotal";
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 7).value = f(`SUM(G${first}:G${row - 1})`, result.equipment.subtotal);
  ws.getCell(row, 7).font = { bold: true };
  for (const col of [3, 6, 7]) moneyCol(ws, col);
  ws.views = [{ state: "frozen", ySplit: 3 }];
}

// ---------------------------------------------------------------------------
// Intake — the input record behind this estimate (values, not formulas)
// ---------------------------------------------------------------------------

function fillIntake(ws: WS, project: Project, result: EstimateResult): void {
  [36, 24, 50].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const per = project.peripherals;
  const q = project.quick;
  const terrain = project.setup.terrain ?? "flat";
  const info = TERRAIN_INFO[terrain];
  const method = effectiveInstallMethod(project.setup);
  const chain = project.setup.serviceChain;
  const civil = result.peripherals.lines.civil;
  const concreteLine = civil.find((c) => c.name.startsWith("Concrete ("));
  const asphaltLine = civil.find((c) => c.name === "Asphalt paving — parking stalls");

  let row = 1;
  sectionTitle(ws, row, "Intake — project inputs");
  row++;
  ws.getCell(row, 1).value =
    "Everything the estimate was built from. Edit inputs in the app and re-export; rates marked editable can also be tuned on the Peripherals tab.";
  ws.getCell(row, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  row += 2;

  const writeGroup = (title: string, rows: [string, string | number][]) => {
    sectionTitle(ws, row, title);
    row++;
    for (const [label, value] of rows) {
      ws.getCell(row, 1).value = label;
      ws.getCell(row, 1).font = { bold: true };
      ws.getCell(row, 2).value = value;
      row++;
    }
    row++;
  };

  writeGroup("Site", [
    ["Client", project.setup.clientName || "—"],
    ["Site address", project.setup.siteAddress || "—"],
    ["Scope of work", project.setup.scopeOfWork || "—"],
  ]);

  writeGroup("Chargers", [
    ...(q
      ? q.lines
          .filter((l) => l.count > 0)
          .map((l): [string, string | number] => [l.loadTypeId, l.count])
      : []),
    ["DCFC total", result.rollups.nDCFC],
    ["L2 total", result.rollups.nL2],
    ["Feeders", result.rollups.nFeeders],
  ]);

  writeGroup("Routing & site conditions", [
    ["Install method", INSTALL_METHOD_INFO[method].label],
    ["Terrain", `${info.label} — trench ×${info.trenchFactor}, labor ×${info.laborFactor}`],
    ["Trench length (ft)", project.setup.trenchLengthFt],
    ["Surface EMT route (ft)", surfaceRouteFt(project.setup, result.rollups.longestRunFt)],
    ...(q
      ? ([
          ["First run — DCFC (ft)", q.firstRunFtDcfc],
          ["First run — L2 (ft)", q.firstRunFtL2],
          ["Step per charger (ft)", q.stepFt],
        ] as [string, string | number][])
      : []),
    ...(chain
      ? ([
          ["Utility → switchgear (ft)", chain.utilityToSwitchgearFt],
          ["Switchgear → transformer (ft)", chain.switchgearToTransformerFt],
          ["Transformer → sub-panel (ft)", chain.transformerToSubpanelFt],
        ] as [string, string | number][])
      : []),
  ]);

  writeGroup("Civil quantities & editable rates", [
    ["Bollards (2/charger + 4-5 switchgear + 3 step-down/sub-panel)", per.bollardsQty],
    ["Bollard unit cost ($)", per.bollardUnitCost ?? 110],
    ["Concrete order (yd, 2500 PSI)", concreteLine?.qty ?? 0],
    ["Concrete rate ($/yd)", concreteLine?.unitCost ?? 165],
    ["Asphalt stall paving (SF)", asphaltLine?.qty ?? 0],
    ["Asphalt rate ($/SF)", asphaltLine?.unitCost ?? 5],
    ["Consumables per L2 ($)", per.consumablesPerL2 ?? 275],
    ["Consumables per DCFC ($)", per.consumablesPerDcfc ?? 550],
    ["ADA stalls (van / std / amb)", `${per.adaVanQty ?? 0} / ${per.adaStdQty ?? 0} / ${per.adaAmbQty ?? 0}`],
  ]);

  writeGroup("Permits & utility", [
    ["Plan check & permit fees ($)", per.permitFeeTotal],
    ["Utility application fee ($)", per.utilityAppFee],
    ["Transformer pad ($)", per.transformerPadCost],
  ]);
}

// ---------------------------------------------------------------------------
// Assumptions & schedule
// ---------------------------------------------------------------------------

function fillAssumptions(ws: WS, project: Project, result: EstimateResult): void {
  [38, 18, 60].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  let row = 1;
  sectionTitle(ws, row, "Assumptions");
  row++;
  ws.getCell(row, 1).value =
    "Budgetary allowances (charger hardware, breaker prices marked 'budgetary', design fees) should be replaced with vendor quotes before contract.";
  ws.getCell(row, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  row += 2;

  const q = project.quick;
  const terrain = project.setup.terrain ?? "flat";
  const info = TERRAIN_INFO[terrain];
  const rows: [string, string][] = [
    ...(q
      ? ([
          ["Chargers", q.lines.filter((l) => l.count > 0).map((l) => `${l.count} × ${l.loadTypeId}`).join(" + ")],
          ["Distance ladder", `first DCFC ${q.firstRunFtDcfc} ft, first L2 ${q.firstRunFtL2} ft, +${q.stepFt} ft each after (per level)`],
        ] as [string, string][])
      : []),
    ["Terrain", `${info.label} — trenching ×${info.trenchFactor}, labor ×${info.laborFactor}, ADA regrade ×${info.adaRegradeFactor}`],
    [
      "Install method",
      (() => {
        const m = effectiveInstallMethod(project.setup);
        const mi = INSTALL_METHOD_INFO[m];
        const racks =
          result.peripherals.lines.hardware.find((h) => h.name.startsWith("Strut trapeze"))?.qty ?? 0;
        // Resolve the route the same way the engine does — a blank
        // surfaceRouteFt means "derived from the longest run", not 0 ft.
        const routeFt = surfaceRouteFt(project.setup, result.rollups.longestRunFt);
        return m === "trench"
          ? `${mi.label} — ${project.setup.trenchLengthFt} ft trench`
          : `${mi.label} — ${routeFt} ft EMT route, ${racks} strut trapeze racks every 10 ft (NEC 358.30)${
              m === "hybrid" ? `, ${project.setup.trenchLengthFt} ft service trench` : ", no digging"
            }`;
      })(),
    ],
    ["Trench length", `${project.setup.trenchLengthFt} ft`],
    [
      "Accessible EVCS (CBC 11B-228.3: table applied per charging level, then summed)",
      project.peripherals.adaVanQty !== undefined ||
      project.peripherals.adaStdQty !== undefined ||
      project.peripherals.adaAmbQty !== undefined
        ? `${project.peripherals.adaVanQty ?? 0} van (12ft+5ft aisle) + ${project.peripherals.adaStdQty ?? 0} standard (9ft+5ft aisle) + ${project.peripherals.adaAmbQty ?? 0} ambulatory (10ft) + ramp`
        : `${project.peripherals.adaQtyOverride ?? result.rollups.nChargers} stalls + ramp (legacy allowance)`,
    ],
    [
      "Accessible EVCS code notes",
      "Slope ≤2% all directions under stalls/aisles (regrade driver on sloped lots) · markings must NOT be blue (11B-812.9) · ISA signs: none ≤4 EVCS, van-only 5-25, van+standard 26+ · accessible EVCS do NOT count toward ADA parking counts (11B-208.1) · operable parts 15-48in reach",
    ],
    [
      "Construction labor",
      (() => {
        const lb = laborBreakdown(project.financial);
        return lb.itemized
          ? `${project.financial.laborBusinessDays} business days · itemized: ${lb.items
              .map((i) => `${i.name || "line"} ${i.days}d × $${i.dailyRate}`)
              .join(" + ")} = $${Math.round(lb.base).toLocaleString("en-US")}`
          : `${project.financial.laborBusinessDays} business days × $${project.financial.laborDailyRate}/day`;
      })(),
    ],
    ["CPM", `${project.financial.pmHours} h × $${project.financial.pmHourlyRate}/h`],
    [
      "Private utility scan",
      (() => {
        const gpr = (project.peripherals.customItems ?? []).find((c) => c.name === GPR_ITEM_NAME);
        return gpr ? `${gpr.qty} day(s) × $${gpr.unitCost}` : "not included";
      })(),
    ],
  ];
  for (const [label, value] of rows) {
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 1).font = { bold: true };
    ws.getCell(row, 2).value = value;
    row++;
  }
  row++;

  sectionTitle(ws, row, "Estimated schedule (business days)");
  row++;
  const phases = estimateTimeline(project, result);
  headerRow(ws, row, ["Phase", "Low – High", "Note"]);
  row++;
  for (const ph of phases) {
    ws.getCell(row, 1).value = ph.parallel ? `${ph.name} (parallel)` : ph.name;
    ws.getCell(row, 2).value = `${ph.lowDays} – ${ph.highDays}`;
    ws.getCell(row, 3).value = ph.note ?? "";
    row++;
  }
  const total = timelineTotal(phases);
  ws.getCell(row, 1).value = "End-to-end estimate";
  ws.getCell(row, 1).font = { bold: true };
  ws.getCell(row, 2).value = `${total.lowDays} – ${total.highDays}`;
  ws.getCell(row, 2).font = { bold: true };
  ws.getCell(row, 3).value = `≈ ${(total.lowDays / 21).toFixed(1)} – ${(total.highDays / 21).toFixed(1)} months; utility energization usually decides the finish date`;
  row += 2;

  sectionTitle(ws, row, "QA checks");
  row++;
  for (const qa of result.qa) {
    ws.getCell(row, 1).value = qa.label;
    ws.getCell(row, 2).value = qa.ok ? "OK" : "REVIEW";
    ws.getCell(row, 2).font = { bold: true, color: { argb: qa.ok ? "FF1F7A33" : "FFB45309" } };
    ws.getCell(row, 3).value = qa.detail;
    row++;
  }
}
