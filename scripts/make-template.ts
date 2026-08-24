// Generates RFC-Template.xlsx — a standalone, formula-driven intake +
// budgetary estimate workbook mirroring the web tool AND the shop's real
// RFC_V18 workbooks (VN Village, Boatman, CCMH, Hoopa Motel, Bartell).
//
// Sheets: Intake (only place a user types) → Panel (two schedules: 480V L3 +
// 208V L2, transformer, switchgear @ website catalog rates) → Estimate →
// Revenue & Payback (Hoopa revenue model: occupancy × hours × derated kW,
// LCFS carbon credits) → Financing (DLL-style loan summary) → ADA → Timeline
// → RateCard → Instructions.
//
// "Next standard size >= demand" uses INDEX/COUNTIF, verified against the
// engine below. Make-ready allowances are engine-calibrated at generation
// time. Regenerate with:  npm run template
//
// Scope: budgetary tool. The engineered takeoff (exact wire sizes, vendor
// BOM) still comes from the app's "⬇ Excel" export.

import ExcelJS from "exceljs";
import path from "node:path";
import {
  ADA_UNIT_COST,
  HARDWARE_ALLOWANCE,
  TERRAIN_INFO,
  buildQuickProject,
  defaultQuickInput,
} from "../lib/calc/autoplan";
import { defaultProject } from "../lib/calc/defaults";
import { computeEstimate } from "../lib/calc/engine";
import { DEFAULT_LOAD_TYPES, GEAR_CATALOG, STANDARD_BREAKERS_A } from "../lib/calc/tables";
import type { LoadType, QuickEstimateInput, Terrain } from "../lib/calc/types";

const MONEY = '"$"#,##0.00';
const PCT = "0.00%";
const YELLOW: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6DD" } };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF5" } };
const CIVIL_BASE = 15 * 193.54;
const SQRT3 = Math.sqrt(3);

// ---------------------------------------------------------------------------
// Per-model electrical data — must mirror sizing.ts / panel.ts exactly
// ---------------------------------------------------------------------------

function designAmps(lt: LoadType): number {
  return (
    lt.designAmpsOverride ??
    (lt.kwPerPort === 0 ? 0 : (lt.kwPerPort * 1000) / (lt.voltage * (lt.phases === 3 ? SQRT3 : 1)))
  );
}

function electrical(lt: LoadType) {
  const amps = designAmps(lt);
  return {
    voltage: lt.voltage,
    breakerA: lt.feederOcpdA,
    circuitsPerUnit: lt.runsAreParallel ? 1 : lt.runsPerUnit,
    unitInputA: Math.round((lt.unitInputAmps ?? amps) * 10) / 10,
    // Ports drive network fees and revenue stalls: dual-port L2 = 2; a DCFC
    // dispenses to one vehicle at a time (the Hoopa revenue convention).
    ports: lt.category === "L2" ? lt.runsPerUnit : 1,
    kwPerPort: lt.kwPerPort,
    /** Per-breaker current — drives the plan-set schedules' phase VA. */
    ampsPerCircuit: Math.round(amps * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Gear price tables from the website's catalog
// ---------------------------------------------------------------------------

function catalogTable(item: string, voltage?: string): [number, number][] {
  return GEAR_CATALOG.filter((g) => g.item === item && (!voltage || g.voltage === voltage))
    .map((g) => [parseFloat(g.size), g.unitCost] as [number, number])
    .filter(([size, cost]) => Number.isFinite(size) && cost > 0)
    .sort((a, b) => a[0] - b[0]);
}

const SG_TABLE = catalogTable("Main switchgear", "480V");
const TX_TABLE = catalogTable("Transformer", "208V");
const PNL_TABLE = [...catalogTable("Sub-panel", "208V"), ...catalogTable("Distribution panel", "208V")].sort(
  (a, b) => a[0] - b[0],
);
const BRK480 = catalogTable("Branch breaker", "480V");
const BRK208 = catalogTable("Branch breaker", "208V");

// ---------------------------------------------------------------------------
// Calibration — run the real engine so template allowances match the app
// ---------------------------------------------------------------------------

function bareInput(overrides: Partial<QuickEstimateInput>): QuickEstimateInput {
  return {
    ...defaultQuickInput(),
    terrain: "flat",
    includeChargerHardware: false,
    includeSitePlanDesign: false,
    includeSldDesign: false,
    includeCpm: false,
    includePermits: false,
    includePrivateScan: false,
    ...overrides,
  };
}

interface ModelCal {
  lt: LoadType;
  hardware: number;
  makeReady: number;
}

function calibrateModel(lt: LoadType): ModelCal {
  const N = 6;
  const p = buildQuickProject(bareInput({ lines: [{ loadTypeId: lt.id, count: N }] }), defaultProject(), "cal");
  const r = computeEstimate(p);
  const makeReady = (r.materials.grandTotal + r.peripherals.hardwareSubtotal) / N;
  return { lt, hardware: HARDWARE_ALLOWANCE[lt.id] ?? 0, makeReady: Math.round(makeReady) };
}

function calibrateCategory(id: string): { civil: number; signage: number } {
  const N = 6;
  const p = buildQuickProject(bareInput({ lines: [{ loadTypeId: id, count: N }] }), defaultProject(), "cal");
  const r = computeEstimate(p);
  return {
    civil: Math.round((r.peripherals.concreteImprovements - CIVIL_BASE) / N),
    signage: Math.round(r.peripherals.signageSubtotal / N),
  };
}

function calibrateEquipment(): { base: number; perDay: number } {
  const run = (count: number) => {
    const p = buildQuickProject(bareInput({ lines: [{ loadTypeId: "DCFC 100kW", count }] }), defaultProject(), "cal");
    return { days: p.financial.laborBusinessDays, cost: computeEstimate(p).equipment.subtotal };
  };
  const a = run(4);
  const b = run(14);
  const perDay = Math.max(0, Math.round((b.cost - a.cost) / (b.days - a.days)));
  return { base: Math.max(0, Math.round(a.cost - perDay * a.days)), perDay };
}

function nextSizeCountif(sizes: number[], x: number): number {
  const below = sizes.filter((s) => s < x).length;
  return sizes[Math.min(sizes.length - 1, below)];
}

// ---------------------------------------------------------------------------
// Template build
// ---------------------------------------------------------------------------

async function main() {
  const chargerModels = DEFAULT_LOAD_TYPES.filter((lt) => lt.category !== "Feeder");
  const models = chargerModels.map(calibrateModel);
  const dcfcCal = calibrateCategory("DCFC 200kW");
  const l2Cal = calibrateCategory("L2 Single 40A");
  const equipCal = calibrateEquipment();

  const wb = new ExcelJS.Workbook();
  wb.creator = "RFC Estimator";
  wb.calcProperties.fullCalcOnLoad = true;

  const intake = wb.addWorksheet("Intake");
  const panel = wb.addWorksheet("Panel");
  const planSet480 = wb.addWorksheet("Panel 480V");
  const planSet208 = wb.addWorksheet("Panel 208V");
  const estimate = wb.addWorksheet("Estimate");
  const revenue = wb.addWorksheet("Revenue");
  const financing = wb.addWorksheet("Financing");
  const ada = wb.addWorksheet("ADA");
  const timeline = wb.addWorksheet("Timeline");
  const rate = wb.addWorksheet("RateCard");
  const help = wb.addWorksheet("Instructions");

  const label = (ws: ExcelJS.Worksheet, row: number, text: string, bold = false, col = 1) => {
    ws.getCell(row, col).value = text;
    ws.getCell(row, col).font = { bold };
  };
  const head = (ws: ExcelJS.Worksheet, row: number, labels: string[], startCol = 1) => {
    labels.forEach((h, i) => {
      const c = ws.getCell(row, startCol + i);
      c.value = h;
      c.font = { bold: true, size: 10 };
      c.fill = HEADER_FILL;
    });
  };

  // ------------------------------------------------------------------ RateCard
  [22, 14, 15, 10, 9, 12, 11, 12, 9, 9, 10, 34, 12].forEach((w, i) => (rate.getColumn(i + 1).width = w));
  rate.getCell("A1").value = "Rate Card — every price the template uses. Edit the yellow cells; formulas follow.";
  rate.getCell("A1").font = { bold: true, size: 13 };

  head(rate, 3, ["Model", "Hardware $/u", "Make-ready $/u", "Category", "Voltage", "Breaker A", "Circuits/u", "Unit input A", "Ports/u", "kW/port", "A/circuit"]);
  models.forEach((m, i) => {
    const row = 4 + i;
    const e = electrical(m.lt);
    rate.getCell(row, 1).value = m.lt.id;
    rate.getCell(row, 2).value = m.hardware;
    rate.getCell(row, 2).numFmt = MONEY;
    rate.getCell(row, 2).fill = YELLOW;
    rate.getCell(row, 3).value = m.makeReady;
    rate.getCell(row, 3).numFmt = MONEY;
    rate.getCell(row, 3).fill = YELLOW;
    rate.getCell(row, 4).value = m.lt.category;
    rate.getCell(row, 5).value = e.voltage;
    rate.getCell(row, 6).value = e.breakerA;
    rate.getCell(row, 7).value = e.circuitsPerUnit;
    rate.getCell(row, 8).value = e.unitInputA;
    rate.getCell(row, 9).value = e.ports;
    rate.getCell(row, 10).value = e.kwPerPort;
    rate.getCell(row, 11).value = e.ampsPerCircuit;
  });
  const modelEnd = 3 + models.length;
  rate.getCell(modelEnd + 1, 1).value =
    "Make-ready $/u = wire, conduit & install hardware (engine-calibrated, ~100-180 ft runs). Gear prices on the Panel sheet. Hardware $/u are budgetary — swap in CTX/vendor quotes.";
  rate.getCell(modelEnd + 1, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  wb.definedNames.add(`RateCard!$A$4:$K$${modelEnd}`, "ModelTable");

  let gRow = modelEnd + 3;
  const priceTable = (title: string, rows: [number, number][], sizeName: string, tableName: string) => {
    label(rate, gRow, title, true);
    gRow++;
    head(rate, gRow, ["Size", "Price"]);
    gRow++;
    const first = gRow;
    for (const [size, cost] of rows) {
      rate.getCell(gRow, 1).value = size;
      const c = rate.getCell(gRow, 2);
      c.value = cost;
      c.numFmt = MONEY;
      c.fill = YELLOW;
      gRow++;
    }
    wb.definedNames.add(`RateCard!$A$${first}:$A$${gRow - 1}`, sizeName);
    wb.definedNames.add(`RateCard!$A$${first}:$B$${gRow - 1}`, tableName);
    gRow++;
  };
  priceTable("Main switchgear 480V (website catalog)", SG_TABLE, "SgSizes", "SgTable");
  priceTable("Sub-panel / distribution 208V", PNL_TABLE, "PnlSizes", "PnlTable");
  priceTable("Step-down transformer 208V (kVA)", TX_TABLE, "TxSizes", "TxTable");
  priceTable("Branch breakers 480V", BRK480, "Brk480Sizes", "BrkTbl480");
  priceTable("Branch breakers 208V", BRK208, "Brk208Sizes", "BrkTbl208");
  label(rate, gRow, "Standard breaker sizes (NEC 240.6)", true);
  gRow++;
  const stdFirst = gRow;
  for (const a of STANDARD_BREAKERS_A) {
    rate.getCell(gRow, 1).value = a;
    gRow++;
  }
  wb.definedNames.add(`RateCard!$A$${stdFirst}:$A$${gRow - 1}`, "StdBrk");

  head(rate, 3, ["Terrain", "Trench ×", "Labor ×", "ADA ×", "Spoils $/ft"], 12);
  (Object.keys(TERRAIN_INFO) as Terrain[]).forEach((t, i) => {
    const info = TERRAIN_INFO[t];
    const row = 4 + i;
    rate.getCell(row, 12).value = t;
    rate.getCell(row, 13).value = info.trenchFactor;
    rate.getCell(row, 14).value = info.laborFactor;
    rate.getCell(row, 15).value = info.adaRegradeFactor;
    rate.getCell(row, 16).value = info.spoilsPerFt;
    for (let cc = 13; cc <= 16; cc++) rate.getCell(row, cc).fill = YELLOW;
  });
  wb.definedNames.add(`RateCard!$L$4:$P$7`, "TerrainTable");

  const scalars: [string, string, number, string?][] = [
    ["TrenchRate", "Trenching $/ft (flat baseline)", 40.81, MONEY],
    ["ContingencyPct", "Contingency %", 0.1, PCT],
    ["TaxPct", "Sales tax %", 0.0725, PCT],
    ["LaborDayRate", "Labor crew $/day", 2250, MONEY],
    ["PmRate", "PM hourly rate (CPM)", 358, MONEY],
    ["CpmPct", "CPM % of construction", 0.05, PCT],
    ["GprDayRate", "GPR scan $/day", 1500, MONEY],
    ["GprFtPerDay", "GPR trench-ft per day", 2000],
    ["AdaVanCost", "ADA van stall $ (flat lot)", ADA_UNIT_COST.van, MONEY],
    ["AdaStdCost", "ADA standard stall $ (flat lot)", ADA_UNIT_COST.standard, MONEY],
    ["AdaAmbCost", "ADA ambulatory stall $ (flat lot)", ADA_UNIT_COST.ambulatory, MONEY],
    ["AdaRampCost", "ADA ramp $", ADA_UNIT_COST.ramp, MONEY],
    ["CivilBase", "Civil mobilization base $", Math.round(CIVIL_BASE), MONEY],
    ["CivilDcfc", "Civil $/DCFC (concrete, rebar, stops)", dcfcCal.civil, MONEY],
    ["CivilL2", "Civil $/L2", l2Cal.civil, MONEY],
    ["SignageDcfc", "Signage+bollards $/DCFC", dcfcCal.signage, MONEY],
    ["SignageL2", "Signage $/L2", l2Cal.signage, MONEY],
    ["TransformerPad", "Utility transformer pad $ (DCFC)", 5000, MONEY],
    ["CommDcfc", "Commissioning $/DCFC", 1500, MONEY],
    ["CommL2", "Commissioning $/L2", 250, MONEY],
    ["EquipBase", "Equipment rentals base $", equipCal.base, MONEY],
    ["EquipPerDay", "Equipment rentals $/labor-day", equipCal.perDay, MONEY],
  ];
  scalars.forEach(([name, text, value, fmt], i) => {
    const row = 10 + i;
    rate.getCell(row, 12).value = text;
    const c = rate.getCell(row, 13);
    c.value = value;
    if (fmt) c.numFmt = fmt;
    c.fill = YELLOW;
    wb.definedNames.add(`RateCard!$M$${row}`, name);
  });

  // ------------------------------------------------------------------ Intake
  [30, 26, 16, 10, 15, 15, 10].forEach((w, i) => (intake.getColumn(i + 1).width = w));
  intake.getCell("A1").value = "RFC INTAKE — EV Charging Project";
  intake.getCell("A1").font = { bold: true, size: 16 };
  intake.getCell("A2").value =
    "Fill the yellow cells only — Panel, Estimate, Revenue, Financing, ADA and Timeline calculate from them.";
  intake.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };

  const inputCell = (row: number, value?: ExcelJS.CellValue, fmt?: string) => {
    const c = intake.getCell(row, 2);
    if (value !== undefined) c.value = value;
    if (fmt) c.numFmt = fmt;
    c.fill = YELLOW;
    c.border = { bottom: { style: "thin" } };
    return c;
  };

  label(intake, 4, "OUR DETAILS", true);
  ["Company", "Prepared by (CPM)", "CRA", "Phone", "Email"].forEach((t, i) => {
    label(intake, 5 + i, t);
    inputCell(5 + i);
  });
  label(intake, 11, "PROJECT", true);
  ["Client", "Site address", "City / AHJ", "Utility", "Incentive program (CALeVIP, CEC…)", "Application / project ID"].forEach(
    (t, i) => {
      label(intake, 12 + i, t);
      inputCell(12 + i);
    },
  );
  label(intake, 18, "Date");
  inputCell(18, { formula: "TODAY()" } as ExcelJS.CellValue, "yyyy-mm-dd");
  label(intake, 19, "Scope of work");
  inputCell(19);

  label(intake, 21, "CHARGERS", true);
  head(intake, 22, ["Model", "Qty", "Hardware $/u", "Category", "Make-ready $", "Hardware $", "Ports"]);
  const CH_FIRST = 23;
  const CH_LAST = 28;
  const defaults: [string, number][] = [
    ["DCFC 200kW", 6],
    ["L2 Single 40A", 5],
  ];
  for (let row = CH_FIRST; row <= CH_LAST; row++) {
    const d = defaults[row - CH_FIRST];
    const mc = intake.getCell(row, 1);
    if (d) mc.value = d[0];
    mc.fill = YELLOW;
    mc.dataValidation = { type: "list", allowBlank: true, formulae: [`RateCard!$A$4:$A$${modelEnd}`] };
    const qc = intake.getCell(row, 2);
    if (d) qc.value = d[1];
    qc.fill = YELLOW;
    intake.getCell(row, 3).value = { formula: `IFERROR(VLOOKUP($A${row},ModelTable,2,FALSE),"")` };
    intake.getCell(row, 3).numFmt = MONEY;
    intake.getCell(row, 4).value = { formula: `IFERROR(VLOOKUP($A${row},ModelTable,4,FALSE),"")` };
    intake.getCell(row, 5).value = { formula: `IFERROR($B${row}*VLOOKUP($A${row},ModelTable,3,FALSE),0)` };
    intake.getCell(row, 5).numFmt = MONEY;
    intake.getCell(row, 6).value = { formula: `IFERROR($B${row}*VLOOKUP($A${row},ModelTable,2,FALSE),0)` };
    intake.getCell(row, 6).numFmt = MONEY;
    intake.getCell(row, 7).value = { formula: `IFERROR($B${row}*VLOOKUP($A${row},ModelTable,9,FALSE),0)` };
  }
  label(intake, 30, "Total chargers");
  intake.getCell(30, 2).value = { formula: `SUM(B${CH_FIRST}:B${CH_LAST})` };
  // SUMPRODUCT instead of SUMIF: the criteria string "L2" doubles as a cell
  // address, which trips some evaluators — the comparison form is unambiguous.
  label(intake, 31, "DCFC count");
  intake.getCell(31, 2).value = { formula: `SUMPRODUCT((D${CH_FIRST}:D${CH_LAST}="DCFC")*B${CH_FIRST}:B${CH_LAST})` };
  label(intake, 32, "L2 count");
  intake.getCell(32, 2).value = { formula: `SUMPRODUCT((D${CH_FIRST}:D${CH_LAST}="L2")*B${CH_FIRST}:B${CH_LAST})` };
  label(intake, 33, "Total ports");
  intake.getCell(33, 2).value = { formula: `SUM(G${CH_FIRST}:G${CH_LAST})` };
  wb.definedNames.add("Intake!$B$30", "NTotal");
  wb.definedNames.add("Intake!$B$31", "NDcfc");
  wb.definedNames.add("Intake!$B$32", "NumL2");
  wb.definedNames.add("Intake!$B$33", "NPorts");

  label(intake, 35, "SITE", true);
  label(intake, 36, "Distance to nearest charger (ft)");
  inputCell(36, 100);
  label(intake, 37, "Spacing per extra charger (ft)");
  inputCell(37, 15);
  label(intake, 38, "Terrain");
  inputCell(38, "flat").dataValidation = { type: "list", allowBlank: false, formulae: ['"flat,sloped,hilly,rocky"'] };
  label(intake, 39, "Trench length (ft) — overtype if surveyed");
  inputCell(39, { formula: "B36+B37*MAX(0,NTotal-1)" } as ExcelJS.CellValue);
  wb.definedNames.add("Intake!$B$36", "FirstRunFt");
  wb.definedNames.add("Intake!$B$37", "StepFt");
  wb.definedNames.add("Intake!$B$38", "Terrain");
  wb.definedNames.add("Intake!$B$39", "TrenchFt");

  label(intake, 41, "INCLUDED SERVICES (Yes / No)", true);
  const services: [string, string][] = [
    ["Charger hardware", "IncHardware"],
    ["Site plan design (AutoCAD)", "IncSitePlan"],
    ["SLD / electrical design", "IncSLD"],
    ["Construction PM (CPM)", "IncCpm"],
    ["Permitting fees", "IncPermits"],
    ["Private utility scan (GPR)", "IncGpr"],
  ];
  services.forEach(([name, defName], i) => {
    const row = 42 + i;
    label(intake, row, name);
    inputCell(row, "Yes").dataValidation = { type: "list", allowBlank: false, formulae: ['"Yes,No"'] };
    wb.definedNames.add(`Intake!$B$${row}`, defName);
  });

  label(intake, 49, "COMMERCIAL TERMS (from the RFC_V18 / Hoopa proposal structure)", true);
  const commercial: [string, string, number | string, string?][] = [
    ["Hardware price factor", "HardwareFactor", 1, undefined],
    ["Rebate / incentive amount ($)", "RebateAmt", 0, MONEY],
    ["Network (EVOLV) fee $/port/month", "NetworkFeeMo", 39.99, MONEY],
    ["Contract length (years)", "ContractYears", 5, undefined],
    ["Service plan $/year (post-warranty)", "ServicePlanYr", 0, MONEY],
    ["Financing APR", "FinanceApr", 0.0839, PCT],
    ["Financing term (years)", "FinanceYears", 5, undefined],
  ];
  commercial.forEach(([text, defName, value, fmt], i) => {
    const row = 50 + i;
    label(intake, row, text);
    inputCell(row, value as ExcelJS.CellValue, fmt);
    wb.definedNames.add(`Intake!$B$${row}`, defName);
  });
  intake.getCell(50, 3).value = "1 = RateCard prices as-is; 1.155 = vendor cost × 1.05 contingency × 1.10 markup";
  intake.getCell(50, 3).font = { italic: true, size: 8, color: { argb: "FF666666" } };

  label(intake, 58, "CBC 11B-812 accessible stalls required", true);
  intake.getCell(58, 2).value = { formula: `AdaVan&" van + "&AdaStd&" standard + "&AdaAmb&" ambulatory"` };
  label(intake, 59, "Main gear (auto — Panel sheet)", true);
  intake.getCell(59, 2).value = {
    formula:
      'IF(NDcfc>0,SgSuggested&"A switchgear @ 480V","208V service")&IF(TxKvaSuggested>0," + "&TxKvaSuggested&" kVA step-down TX","")',
  };
  label(intake, 60, "TOTAL ESTIMATE", true);
  intake.getCell(60, 1).font = { bold: true, size: 14 };
  intake.getCell(60, 2).value = { formula: "TotalCost" };
  intake.getCell(60, 2).numFmt = MONEY;
  intake.getCell(60, 2).font = { bold: true, size: 14 };
  intake.getCell(60, 2).fill = HEADER_FILL;
  label(intake, 61, "CUSTOMER TOTAL (after rebate)", true);
  intake.getCell(61, 2).value = { formula: "CustomerTotal" };
  intake.getCell(61, 2).numFmt = MONEY;
  intake.getCell(61, 2).font = { bold: true };
  label(intake, 62, "Simple payback (years, revenue + credits)");
  intake.getCell(62, 2).value = { formula: "PaybackYears" };
  intake.views = [{ state: "frozen", ySplit: 2 }];

  // ------------------------------------------------------------------ Panel
  [24, 12, 12, 12, 14, 14].forEach((w, i) => (panel.getColumn(i + 1).width = w));
  panel.getCell("A1").value =
    "Panel Schedules — auto from Intake (mirrors the app's algorithm, NEC 625 continuous loads at 125%)";
  panel.getCell("A1").font = { bold: true, size: 13 };

  label(panel, 3, "PANEL SCHEDULE 1 — 480V SWITCHGEAR (LEVEL 3 / DCFC)", true);
  head(panel, 4, ["Model", "Qty", "Breaker A", "Circuits", "A per circuit", "Connected A"]);
  for (let i = 0; i < 6; i++) {
    const row = 5 + i;
    const src = CH_FIRST + i;
    panel.getCell(row, 1).value = { formula: `IF(Intake!$D${src}="DCFC",Intake!$A${src},"")` };
    panel.getCell(row, 2).value = { formula: `IF(Intake!$D${src}="DCFC",Intake!$B${src},0)` };
    panel.getCell(row, 3).value = { formula: `IF(B${row}>0,VLOOKUP(Intake!$A${src},ModelTable,6,FALSE),"")` };
    panel.getCell(row, 4).value = { formula: `IF(B${row}>0,B${row}*VLOOKUP(Intake!$A${src},ModelTable,7,FALSE),0)` };
    panel.getCell(row, 5).value = { formula: `IF(B${row}>0,VLOOKUP(Intake!$A${src},ModelTable,8,FALSE),"")` };
    panel.getCell(row, 6).value = { formula: `IF(B${row}>0,B${row}*VLOOKUP(Intake!$A${src},ModelTable,8,FALSE),0)` };
  }
  label(panel, 11, "DCFC connected amps");
  panel.getCell(11, 6).value = { formula: "SUM(F5:F10)" };
  label(panel, 12, "+ Transformer primary reflection (raw)");
  panel.getCell(12, 6).value = { formula: "IF(AND(NDcfc>0,NumL2>0),TxKvaConnected*1000/(480*SQRT(3)),0)" };
  label(panel, 13, "480V bus connected amps", true);
  panel.getCell(13, 6).value = { formula: "F11+F12" };
  label(panel, 14, "480V bus demand amps (×125%)", true);
  panel.getCell(14, 6).value = { formula: "F13*1.25" };
  label(panel, 15, "Suggested main switchgear (A)", true);
  panel.getCell(15, 6).value = {
    formula: 'IF(NDcfc>0,INDEX(SgSizes,MIN(ROWS(SgSizes),COUNTIF(SgSizes,"<"&F14)+1)),0)',
  };
  wb.definedNames.add("Panel!$F$15", "SgSuggested");
  label(panel, 16, "Switchgear price (website catalog)", true);
  panel.getCell(16, 6).value = { formula: "IF(NDcfc>0,VLOOKUP(SgSuggested,SgTable,2,FALSE),0)" };
  panel.getCell(16, 6).numFmt = MONEY;

  label(panel, 18, "PANEL SCHEDULE 2 — 208V PANEL (LEVEL 2)", true);
  head(panel, 19, ["Model", "Qty", "Breaker A", "Circuits", "A per circuit", "Connected A"]);
  for (let i = 0; i < 6; i++) {
    const row = 20 + i;
    const src = CH_FIRST + i;
    panel.getCell(row, 1).value = { formula: `IF(Intake!$D${src}="L2",Intake!$A${src},"")` };
    panel.getCell(row, 2).value = { formula: `IF(Intake!$D${src}="L2",Intake!$B${src},0)` };
    panel.getCell(row, 3).value = { formula: `IF(B${row}>0,VLOOKUP(Intake!$A${src},ModelTable,6,FALSE),"")` };
    panel.getCell(row, 4).value = { formula: `IF(B${row}>0,B${row}*VLOOKUP(Intake!$A${src},ModelTable,7,FALSE),0)` };
    panel.getCell(row, 5).value = { formula: `IF(B${row}>0,VLOOKUP(Intake!$A${src},ModelTable,8,FALSE),"")` };
    panel.getCell(row, 6).value = { formula: `IF(B${row}>0,B${row}*VLOOKUP(Intake!$A${src},ModelTable,8,FALSE),0)` };
  }
  label(panel, 26, "208V bus connected amps", true);
  panel.getCell(26, 6).value = { formula: "SUM(F20:F25)" };
  label(panel, 27, "208V bus demand amps (×125%)", true);
  panel.getCell(27, 6).value = { formula: "F26*1.25" };
  label(panel, 28, "Suggested 208V panel (A)", true);
  panel.getCell(28, 6).value = {
    formula: 'IF(NumL2>0,INDEX(PnlSizes,MIN(ROWS(PnlSizes),COUNTIF(PnlSizes,"<"&F27)+1)),0)',
  };
  label(panel, 29, "Panel type");
  panel.getCell(29, 6).value = { formula: 'IF(NumL2=0,"—",IF(F28>=1000,"Distribution panel","Sub-panel"))' };
  label(panel, 30, "Panel price", true);
  panel.getCell(30, 6).value = { formula: "IF(NumL2>0,VLOOKUP(F28,PnlTable,2,FALSE),0)" };
  panel.getCell(30, 6).numFmt = MONEY;

  label(panel, 32, "STEP-DOWN TRANSFORMER (480V → 208V, only when both levels exist)", true);
  label(panel, 33, "Connected kVA (208V load)");
  panel.getCell(33, 6).value = { formula: "IF(AND(NDcfc>0,NumL2>0),F26*208*SQRT(3)/1000,0)" };
  wb.definedNames.add("Panel!$F$33", "TxKvaConnected");
  label(panel, 34, "Demand kVA (×125%)");
  panel.getCell(34, 6).value = { formula: "F33*1.25" };
  label(panel, 35, "Suggested transformer (kVA)", true);
  panel.getCell(35, 6).value = {
    formula: 'IF(F33>0,INDEX(TxSizes,MIN(ROWS(TxSizes),COUNTIF(TxSizes,"<"&F34)+1)),0)',
  };
  wb.definedNames.add("Panel!$F$35", "TxKvaSuggested");
  label(panel, 36, "Transformer price", true);
  panel.getCell(36, 6).value = { formula: "IF(F35>0,VLOOKUP(F35,TxTable,2,FALSE),0)" };
  panel.getCell(36, 6).numFmt = MONEY;
  label(panel, 37, "Primary FLA at 480V (selected TX)");
  panel.getCell(37, 6).value = { formula: "IF(F35>0,F35*1000/(480*SQRT(3)),0)" };
  label(panel, 38, "Primary breaker (125% of FLA, next standard)");
  panel.getCell(38, 6).value = {
    formula: 'IF(F35>0,INDEX(StdBrk,MIN(ROWS(StdBrk),COUNTIF(StdBrk,"<"&F37*1.25)+1)),0)',
  };
  label(panel, 39, "Primary breaker price");
  panel.getCell(39, 6).value = { formula: "IF(F38>0,IFERROR(VLOOKUP(F38,BrkTbl480,2,FALSE),0),0)" };
  panel.getCell(39, 6).numFmt = MONEY;

  label(panel, 41, "BRANCH BREAKERS", true);
  head(panel, 42, ["Model", "Breaker A", "Voltage", "Circuits", "Unit $", "Total $"]);
  for (let i = 0; i < 6; i++) {
    const row = 43 + i;
    const src = CH_FIRST + i;
    panel.getCell(row, 1).value = { formula: `IF(Intake!$B${src}>0,Intake!$A${src},"")` };
    panel.getCell(row, 2).value = { formula: `IF(Intake!$B${src}>0,VLOOKUP(Intake!$A${src},ModelTable,6,FALSE),"")` };
    panel.getCell(row, 3).value = { formula: `IF(Intake!$B${src}>0,VLOOKUP(Intake!$A${src},ModelTable,5,FALSE),"")` };
    panel.getCell(row, 4).value = { formula: `IF(Intake!$B${src}>0,Intake!$B${src}*VLOOKUP(Intake!$A${src},ModelTable,7,FALSE),0)` };
    panel.getCell(row, 5).value = {
      formula: `IF(D${row}>0,IF(C${row}=480,IFERROR(VLOOKUP(B${row},BrkTbl480,2,FALSE),0),IFERROR(VLOOKUP(B${row},BrkTbl208,2,FALSE),0)),0)`,
    };
    panel.getCell(row, 5).numFmt = MONEY;
    panel.getCell(row, 6).value = { formula: `D${row}*E${row}` };
    panel.getCell(row, 6).numFmt = MONEY;
  }
  label(panel, 49, "Branch breakers total (incl. TX primary)", true);
  panel.getCell(49, 6).value = { formula: "SUM(F43:F48)+F39" };
  panel.getCell(49, 6).numFmt = MONEY;

  label(panel, 51, "GEAR TOTAL — switchgear + panel + transformer + breakers", true);
  panel.getCell(51, 1).font = { bold: true, size: 12 };
  panel.getCell(51, 6).value = { formula: "F16+F30+F36+F49" };
  panel.getCell(51, 6).numFmt = MONEY;
  panel.getCell(51, 6).font = { bold: true, size: 12 };
  panel.getCell(51, 6).fill = HEADER_FILL;
  wb.definedNames.add("Panel!$F$51", "GearTotal");
  panel.getCell(53, 1).value =
    "A $0 unit price means no catalog price for that size — add it on the RateCard before quoting.";
  panel.getCell(53, 1).font = { italic: true, size: 9, color: { argb: "FFB45309" } };
  panel.views = [{ state: "frozen", ySplit: 2 }];

  // -------------------------------------------------- Plan-set panel schedules
  // The permit-drawing layout (phase-staggered A/B/C, odd/even CKT numbers,
  // "---" continuation rows), fully FORMULA-DRIVEN: change charger counts on
  // the Intake and the schedules rebuild themselves. Each panel is homogeneous
  // (480V = all 3-pole, 208V = all 2-pole), so slot geometry is pre-wired and
  // a hidden helper table (cols S:AA) expands intake lines into circuits.
  const buildPlanSet = (
    ws: ExcelJS.Worksheet,
    cfg: {
      name: string;
      category: "DCFC" | "L2";
      poles: 2 | 3;
      vLL: number;
      vLNText: string;
      vLNFormula: string; // divisor for HIGH PH AMP
      aic: string;
      fedByFormula: string;
      mainFormula: string; // bus amps
      includeTx: boolean;
    },
  ) => {
    const widths = [4, 5, 26, 9, 7, 11, 11, 11, 11, 11, 11, 7, 9, 26, 5, 4];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

    // ---- hidden helper: intake lines -> circuit list -----------------------
    ws.getCell(2, 18).value = "engine — do not edit";
    ws.getCell(2, 18).font = { italic: true, size: 8, color: { argb: "FF999999" } };
    for (let j = 0; j < 6; j++) {
      const ir = CH_FIRST + j; // intake charger row
      const hr = 3 + j;
      ws.getCell(hr, 19).value = {
        formula: `IF(Intake!$D$${ir}="${cfg.category}",Intake!$B$${ir}*IFERROR(VLOOKUP(Intake!$A$${ir},ModelTable,7,FALSE),0),0)`,
      };
      ws.getCell(hr, 20).value = j === 0 ? 0 : { formula: `T${hr - 1}+S${hr - 1}` };
    }
    ws.getCell(9, 18).value = "total circuits";
    ws.getCell(9, 18).font = { size: 8 };
    ws.getCell(9, 19).value = { formula: "SUM(S3:S8)" };

    const maxCkts = cfg.poles === 3 ? 16 : 24;
    const HELPER_FIRST = 12;
    for (let k = 1; k <= maxCkts; k++) {
      const hr = HELPER_FIRST + k - 1;
      ws.getCell(hr, 19).value = k;
      ws.getCell(hr, 20).value = { formula: `IF(S${hr}<=$S$9,MATCH(S${hr}-0.5,$T$3:$T$8,1),0)` };
      ws.getCell(hr, 21).value = { formula: `IF(T${hr}>0,S${hr}-INDEX($T$3:$T$8,T${hr}),0)` };
      ws.getCell(hr, 22).value = { formula: `IF(T${hr}>0,INDEX(Intake!$A$23:$A$28,T${hr}),"")` };
      ws.getCell(hr, 23).value = { formula: `IF(T${hr}>0,IFERROR(VLOOKUP(V${hr},ModelTable,7,FALSE),1),1)` };
      if (cfg.includeTx) {
        ws.getCell(hr, 24).value = {
          formula: `IF(T${hr}>0,UPPER(V${hr})&" #"&U${hr},IF(S${hr}=$S$9+1,IF(TxKvaSuggested>0,"XFMR "&TxKvaSuggested&" KVA - EV_SUB (208V)",""),""))`,
        };
        ws.getCell(hr, 25).value = {
          formula: `IF(T${hr}>0,IFERROR(VLOOKUP(V${hr},ModelTable,6,FALSE),0),IF(S${hr}=$S$9+1,IF(TxKvaSuggested>0,Panel!$F$38,0),0))`,
        };
        ws.getCell(hr, 26).value = {
          formula: `IF(T${hr}>0,IFERROR(VLOOKUP(V${hr},ModelTable,11,FALSE),0)*${cfg.vLL}/SQRT(3),IF(S${hr}=$S$9+1,IF(TxKvaSuggested>0,TxKvaConnected*1000/3,0),0))`,
        };
        ws.getCell(hr, 27).value = {
          formula: `IF(S${hr}<=$S$9,1,IF(S${hr}=$S$9+1,IF(TxKvaSuggested>0,1,0),0))`,
        };
      } else {
        // Dual-port L2 units get A/B suffixes per circuit within the unit.
        ws.getCell(hr, 24).value = {
          formula: `IF(T${hr}>0,UPPER(V${hr})&" #"&ROUNDUP(U${hr}/W${hr},0)&IF(W${hr}>1,CHAR(64+U${hr}-(ROUNDUP(U${hr}/W${hr},0)-1)*W${hr}),""),"")`,
        };
        ws.getCell(hr, 25).value = { formula: `IF(T${hr}>0,IFERROR(VLOOKUP(V${hr},ModelTable,6,FALSE),0),0)` };
        ws.getCell(hr, 26).value = {
          formula: `IF(T${hr}>0,IFERROR(VLOOKUP(V${hr},ModelTable,11,FALSE),0)*${cfg.vLL}/2,0)`,
        };
        ws.getCell(hr, 27).value = { formula: `IF(S${hr}<=$S$9,1,0)` };
      }
    }
    for (let col = 18; col <= 27; col++) ws.getColumn(col).hidden = true;

    // ---- header block -------------------------------------------------------
    ws.mergeCells(1, 2, 1, 15);
    ws.getCell(1, 2).value = "PANEL SCHEDULE";
    ws.getCell(1, 2).font = { bold: true, size: 13 };
    ws.getCell(1, 2).alignment = { horizontal: "center" };
    const hdr = (row: number, col: number, labelText: string, value: ExcelJS.CellValue) => {
      ws.getCell(row, col).value = labelText;
      ws.getCell(row, col).font = { bold: true, size: 10 };
      ws.getCell(row, col + 1).value = value;
    };
    hdr(3, 2, "NAME", cfg.name);
    hdr(3, 4, "LOCATION", "OUTDOOR");
    hdr(3, 8, "VOLTAGE", `${cfg.vLNText} / ${cfg.vLL}  3PH 4W`);
    hdr(3, 13, "MAIN", { formula: `${cfg.mainFormula}&" A 3P"` } as ExcelJS.CellValue);
    hdr(4, 4, "FED BY", { formula: cfg.fedByFormula } as ExcelJS.CellValue);
    hdr(4, 8, "ENCLOSURE", "NEMA3R");
    hdr(4, 13, "BUS BAR", { formula: `${cfg.mainFormula}&" A"` } as ExcelJS.CellValue);
    hdr(5, 4, "MOUNTING", "SURFACE");
    hdr(5, 8, "PANEL TYPE", "NF");
    hdr(5, 13, "MAIN AIC", cfg.aic);

    // ---- grid ----------------------------------------------------------------
    const HEAD = 7;
    const gridHeads: [number, string][] = [
      [2, "CKT"], [3, "DESCRIPTION"], [4, "BREAKER"], [5, "POLES"],
      [12, "POLES"], [13, "BREAKER"], [14, "DESCRIPTION"], [15, "CKT"],
    ];
    for (const [col, text] of gridHeads) {
      ws.getCell(HEAD, col).value = text;
      ws.getCell(HEAD, col).font = { bold: true, size: 10 };
      ws.getCell(HEAD, col).fill = HEADER_FILL;
      ws.getCell(HEAD, col).alignment = { horizontal: "center" };
    }
    (["A", "B", "C"] as const).forEach((phLabel, i) => {
      const col = 6 + i * 2;
      ws.mergeCells(HEAD, col, HEAD, col + 1);
      ws.getCell(HEAD, col).value = phLabel;
      ws.getCell(HEAD, col).font = { bold: true, size: 10 };
      ws.getCell(HEAD, col).fill = HEADER_FILL;
      ws.getCell(HEAD, col).alignment = { horizontal: "center" };
    });

    const SLOTS = 24;
    const GRID = HEAD + 1;
    for (let r = 1; r <= SLOTS; r++) {
      const row = GRID + r - 1;
      const ph = (r - 1) % 3;
      const first = (r - 1) % cfg.poles === 0;
      const nL = 2 * Math.floor((r - 1) / cfg.poles) + 1;
      const nR = nL + 1;
      const hrL = HELPER_FIRST + nL - 1;
      const hrR = HELPER_FIRST + nR - 1;
      const inRangeL = nL <= maxCkts;
      const inRangeR = nR <= maxCkts;
      ws.getCell(row, 1).value = "ABC"[ph];
      ws.getCell(row, 16).value = "ABC"[ph];
      ws.getCell(row, 2).value = 2 * r - 1;
      ws.getCell(row, 15).value = 2 * r;
      if (inRangeL) {
        ws.getCell(row, 3).value = { formula: `IF($AA$${hrL}=1,${first ? `$X$${hrL}` : '"---"'},"")` };
        if (first) {
          ws.getCell(row, 4).value = { formula: `IF($AA$${hrL}=1,$Y$${hrL},"")` };
          ws.getCell(row, 5).value = { formula: `IF($AA$${hrL}=1,${cfg.poles},"")` };
        }
        ws.getCell(row, 6 + ph * 2).value = { formula: `IF($AA$${hrL}=1,ROUND($Z$${hrL},0),"")` };
      }
      if (inRangeR) {
        ws.getCell(row, 14).value = { formula: `IF($AA$${hrR}=1,${first ? `$X$${hrR}` : '"---"'},"")` };
        if (first) {
          ws.getCell(row, 13).value = { formula: `IF($AA$${hrR}=1,$Y$${hrR},"")` };
          ws.getCell(row, 12).value = { formula: `IF($AA$${hrR}=1,${cfg.poles},"")` };
        }
        ws.getCell(row, 7 + ph * 2).value = { formula: `IF($AA$${hrR}=1,ROUND($Z$${hrR},0),"")` };
      }
      for (let col = 2; col <= 15; col++) {
        ws.getCell(row, col).border = { top: { style: "hair" }, bottom: { style: "hair" } };
      }
    }

    // ---- footer --------------------------------------------------------------
    const F = GRID + SLOTS + 1;
    const gridBot = GRID + SLOTS - 1;
    ws.getCell(F, 3).value = "TOTAL VA";
    ws.getCell(F + 1, 3).value = "DEMAND VA";
    ws.getCell(F + 2, 3).value = "HIGH PH VA";
    ws.getCell(F + 3, 3).value = "HIGH PH AMP";
    for (let i = 0; i < 3; i++) {
      const col = 6 + i * 2;
      const cl = ws.getColumn(col).letter;
      const cr = ws.getColumn(col + 1).letter;
      ws.mergeCells(F, col, F, col + 1);
      ws.getCell(F, col).value = { formula: `SUM(${cl}${GRID}:${cr}${gridBot})` };
      ws.mergeCells(F + 1, col, F + 1, col + 1);
      ws.getCell(F + 1, col).value = { formula: `${cl}${F}*1.25` };
      ws.mergeCells(F + 2, col, F + 2, col + 1);
      ws.getCell(F + 2, col).value = { formula: `MAX($F$${F + 1},$H$${F + 1},$J$${F + 1})` };
      ws.mergeCells(F + 3, col, F + 3, col + 1);
      ws.getCell(F + 3, col).value = { formula: `${cl}${F + 2}/${cfg.vLNFormula}` };
      for (let r2 = F; r2 <= F + 2; r2++) ws.getCell(r2, col).numFmt = "#,##0";
      ws.getCell(F + 3, col).numFmt = "#,##0.0";
    }
    const rLabel = (row: number, text: string) => {
      ws.mergeCells(row, 12, row, 13);
      ws.getCell(row, 12).value = text;
      ws.getCell(row, 12).font = { bold: true, size: 10 };
    };
    rLabel(F, "TOTAL 3PH VA");
    ws.getCell(F, 14).value = { formula: `F${F}+H${F}+J${F}` };
    rLabel(F + 1, "TOTAL DEMAND VA");
    ws.getCell(F + 1, 14).value = { formula: `N${F}*1.25` };
    rLabel(F + 2, "TOTAL AMP");
    ws.getCell(F + 2, 14).value = { formula: `N${F + 1}/(${cfg.vLL}*SQRT(3))` };
    rLabel(F + 3, "MAIN BREAKER");
    ws.getCell(F + 3, 14).value = { formula: cfg.mainFormula };
    ws.getCell(F, 14).numFmt = "#,##0";
    ws.getCell(F + 1, 14).numFmt = "#,##0";
    ws.getCell(F + 2, 14).numFmt = "#,##0.0";
    ws.getCell(F + 5, 2).value = {
      formula: `IF($S$9${cfg.includeTx ? "+IF(TxKvaSuggested>0,1,0)" : ""}>${maxCkts},"⚠ More than ${maxCkts} circuits — grid truncated, use the app's Excel export","")`,
    };
    ws.getCell(F + 5, 2).font = { color: { argb: "FFB45309" }, italic: true };
    ws.views = [{ state: "frozen", ySplit: HEAD }];
  };

  buildPlanSet(planSet480, {
    name: "EV_MAIN",
    category: "DCFC",
    poles: 3,
    vLL: 480,
    vLNText: "277",
    vLNFormula: "(480/SQRT(3))",
    aic: "65,000",
    fedByFormula: '"UTILITY"',
    mainFormula: "SgSuggested",
    includeTx: true,
  });
  buildPlanSet(planSet208, {
    name: "EV_SUB",
    category: "L2",
    poles: 2,
    vLL: 208,
    vLNText: "120",
    vLNFormula: "120",
    aic: "22,000",
    fedByFormula: 'IF(TxKvaSuggested>0,"EV_MAIN VIA "&TxKvaSuggested&" KVA XFMR","UTILITY")',
    mainFormula: "Panel!$F$28",
    includeTx: false,
  });

  // ------------------------------------------------------------------ Estimate
  [44, 16, 12].forEach((w, i) => (estimate.getColumn(i + 1).width = w));
  estimate.getCell("A1").value = "Budgetary Estimate (auto from Intake + Panel + RateCard)";
  estimate.getCell("A1").font = { bold: true, size: 13 };
  estimate.getCell("A2").value =
    "Structure mirrors the RFC_V18 Costs Internal → Summary chain. For the engineered takeoff use the app's Excel export.";
  estimate.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };

  label(estimate, 4, "Construction labor days (derived)");
  estimate.getCell(4, 2).value = {
    formula: "IF(NTotal<=0,0,ROUNDUP((8+2.5*NDcfc+1*NumL2+TrenchFt/40)*VLOOKUP(Terrain,TerrainTable,3,FALSE),0))",
  };
  wb.definedNames.add("Estimate!$B$4", "LaborDays");

  const eHeader = (row: number, text: string) => {
    estimate.getCell(row, 1).value = text;
    estimate.getCell(row, 1).font = { bold: true };
    estimate.getCell(row, 1).fill = HEADER_FILL;
    estimate.getCell(row, 2).fill = HEADER_FILL;
  };
  const eLine = (row: number, name: string, formula: string) => {
    estimate.getCell(row, 1).value = name;
    estimate.getCell(row, 2).value = { formula };
    estimate.getCell(row, 2).numFmt = MONEY;
  };

  eHeader(6, "Electrical supply & construction");
  eLine(7, "Electrical make-ready (wire, conduit, install hardware)", `SUM(Intake!E${CH_FIRST}:E${CH_LAST})`);
  eLine(8, "Switchgear, panels & transformer (Panel sheet)", "GearTotal");
  eLine(9, "Trenching / asphalt cut (terrain-adjusted)", "TrenchFt*TrenchRate*VLOOKUP(Terrain,TerrainTable,2,FALSE)");
  eLine(10, "Civil (concrete, rebar, wheel stops)", "IF(NTotal>0,CivilBase,0)+NDcfc*CivilDcfc+NumL2*CivilL2");
  eLine(11, "Signage, striping & bollards", "NDcfc*SignageDcfc+NumL2*SignageL2");
  eLine(12, "Accessible EVCS stalls + ramp (ADA sheet)", "AdaCost");
  eLine(13, "Spoils haul-off / dump", "TrenchFt*VLOOKUP(Terrain,TerrainTable,5,FALSE)");
  eLine(14, "Private utility scan (GPR)", 'IF(IncGpr="Yes",MAX(1,ROUNDUP(TrenchFt/GprFtPerDay,0))*GprDayRate,0)');
  eLine(15, "Equipment rentals", "IF(NTotal>0,EquipBase+EquipPerDay*LaborDays,0)");
  eLine(16, "Permit issuance (AHJ)", 'IF(IncPermits="Yes",200+60*NTotal,0)');
  eLine(17, "Utility application + transformer pad", 'IF(IncPermits="Yes",IF(NDcfc>0,2500+TransformerPad,800),0)');
  eLine(18, "Construction subtotal", "SUM(B7:B17)");
  estimate.getCell(18, 1).font = { bold: true };
  eLine(19, "Contingency", "B18*ContingencyPct");
  eLine(20, "Construction total (loaded)", "B18+B19");
  estimate.getCell(20, 1).font = { bold: true };
  estimate.getCell(20, 2).font = { bold: true };
  wb.definedNames.add("Estimate!$B$20", "ConstructionTotal");

  eLine(22, "Labor (days × rate, contingency-loaded)", "LaborDays*LaborDayRate*(1+ContingencyPct)");
  wb.definedNames.add("Estimate!$B$22", "LaborCost");
  eLine(23, "Sales tax on construction", "ConstructionTotal*TaxPct");
  eLine(24, "Permit valuation (construction + labor)", "ConstructionTotal+LaborCost");
  estimate.getCell(24, 1).font = { italic: true, size: 9 };
  wb.definedNames.add("Estimate!$B$24", "Valuation");

  eHeader(26, "Equipment purchase invoice");
  eLine(27, "Charger hardware (RateCard × price factor)", `IF(IncHardware="Yes",SUM(Intake!F${CH_FIRST}:F${CH_LAST})*HardwareFactor,0)`);
  eLine(28, "Commissioning", 'IF(IncHardware="Yes",CommDcfc*NDcfc+CommL2*NumL2,0)');
  eLine(29, "Network (EVOLV) fees — ports × $/mo × contract", 'IF(IncHardware="Yes",NPorts*NetworkFeeMo*12*ContractYears,0)');
  eLine(30, "Service plan over contract (post-warranty years)", 'IF(IncHardware="Yes",ServicePlanYr*ContractYears,0)');
  eLine(31, "Sales tax on charger hardware", "B27*TaxPct");

  eHeader(33, "Design invoice");
  eLine(34, "Site plan design (AutoCAD)", 'IF(IncSitePlan="Yes",2500+150*NTotal+IF(NDcfc>0,1000,0),0)');
  eLine(35, "SLD / electrical engineering (PE)", 'IF(IncSLD="Yes",IF(NDcfc>0,6000+900*NDcfc+150*NumL2,2500+150*NumL2),0)');
  estimate.getCell(36, 3).value = { formula: 'IF(IncCpm="Yes",MAX(24,ROUND(CpmPct*Valuation/PmRate,0)),0)' };
  estimate.getCell(36, 3).numFmt = "0";
  eLine(36, "Construction PM — hours in col C", "C36*PmRate");
  eLine(37, "Plan check (AHJ, % of valuation for DCFC)", 'IF(IncPermits="Yes",IF(NDcfc>0,500+0.02*Valuation,300),0)');
  eLine(38, "Design subtotal", "SUM(B34:B37)");
  estimate.getCell(38, 1).font = { bold: true };

  eLine(40, "TOTAL PROJECT COST", "ConstructionTotal+LaborCost+B23+B27+B28+B29+B30+B31+B38");
  estimate.getCell(40, 1).font = { bold: true, size: 14 };
  estimate.getCell(40, 2).font = { bold: true, size: 14 };
  estimate.getCell(40, 2).fill = HEADER_FILL;
  wb.definedNames.add("Estimate!$B$40", "TotalCost");
  eLine(41, "Less: rebates / incentives (CALeVIP etc.)", "-RebateAmt");
  eLine(42, "CUSTOMER TOTAL (after rebate)", "TotalCost-RebateAmt");
  estimate.getCell(42, 1).font = { bold: true, size: 12 };
  estimate.getCell(42, 2).font = { bold: true, size: 12 };
  wb.definedNames.add("Estimate!$B$42", "CustomerTotal");
  estimate.views = [{ state: "frozen", ySplit: 2 }];

  // ------------------------------------------------------------------ Revenue
  [30, 10, 10, 12, 13, 13, 13, 13].forEach((w, i) => (revenue.getColumn(i + 1).width = w));
  revenue.getCell("A1").value = "Revenue & Payback (the Hoopa RFC revenue model, formula-driven)";
  revenue.getCell("A1").font = { bold: true, size: 13 };
  revenue.getCell("A2").value =
    "kWh/day = ports × occupancy × operating hours × charging% × port kW × derate. Credits = LCFS $/kW/yr on DCFC.";
  revenue.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };

  const revInputs: [string, string, number, string?][] = [
    ["Retail price $/kWh", "RetailKwh", 0.65, MONEY],
    ["Utility cost $/kWh", "UtilityKwh", 0.4, MONEY],
    ["Hours of operation / day", "OpHours", 12],
    ["Stall occupancy %", "OccPct", 0.2, PCT],
    ["Charging % per occupied hour", "ChargePct", 0.5, PCT],
    ["Carbon credit $/kW/yr (DCFC, LCFS)", "CcRate", 71.6667, MONEY],
    ["Charger derate factor", "DerateF", 0.98],
  ];
  revInputs.forEach(([text, defName, value, fmt], i) => {
    const row = 4 + i;
    label(revenue, row, text);
    const c = revenue.getCell(row, 2);
    c.value = value;
    if (fmt) c.numFmt = fmt;
    c.fill = YELLOW;
    wb.definedNames.add(`Revenue!$B$${row}`, defName);
  });

  head(revenue, 12, ["Model", "Qty", "Ports", "kW/port", "kWh/day", "Rev $/day", "Net $/mo", "CC $/yr"]);
  for (let i = 0; i < 6; i++) {
    const row = 13 + i;
    const src = CH_FIRST + i;
    revenue.getCell(row, 1).value = { formula: `IF(Intake!$B${src}>0,Intake!$A${src},"")` };
    revenue.getCell(row, 2).value = { formula: `IF(Intake!$B${src}>0,Intake!$B${src},0)` };
    revenue.getCell(row, 3).value = { formula: `Intake!$G${src}` };
    revenue.getCell(row, 4).value = { formula: `IF(B${row}>0,VLOOKUP(Intake!$A${src},ModelTable,10,FALSE),0)` };
    revenue.getCell(row, 5).value = { formula: `C${row}*OccPct*OpHours*ChargePct*D${row}*DerateF` };
    revenue.getCell(row, 6).value = { formula: `E${row}*RetailKwh` };
    revenue.getCell(row, 6).numFmt = MONEY;
    revenue.getCell(row, 7).value = { formula: `E${row}*30*(RetailKwh-UtilityKwh)` };
    revenue.getCell(row, 7).numFmt = MONEY;
    // Nested IFs, not AND(): AND doesn't short-circuit, so the VLOOKUP's
    // #N/A on an empty intake row would poison the whole column.
    revenue.getCell(row, 8).value = {
      formula: `IF(B${row}<=0,0,IF(VLOOKUP(Intake!$A${src},ModelTable,4,FALSE)="DCFC",B${row}*D${row}*CcRate,0))`,
    };
    revenue.getCell(row, 8).numFmt = MONEY;
  }
  label(revenue, 19, "Totals", true);
  revenue.getCell(19, 5).value = { formula: "SUM(E13:E18)" };
  revenue.getCell(19, 7).value = { formula: "SUM(G13:G18)" };
  revenue.getCell(19, 7).numFmt = MONEY;
  revenue.getCell(19, 8).value = { formula: "SUM(H13:H18)" };
  revenue.getCell(19, 8).numFmt = MONEY;

  label(revenue, 21, "Charging net revenue / year", true);
  revenue.getCell(21, 2).value = { formula: "G19*12" };
  revenue.getCell(21, 2).numFmt = MONEY;
  wb.definedNames.add("Revenue!$B$21", "RevenueYr");
  label(revenue, 22, "Carbon credits / year (DCFC)", true);
  revenue.getCell(22, 2).value = { formula: "H19" };
  revenue.getCell(22, 2).numFmt = MONEY;
  wb.definedNames.add("Revenue!$B$22", "CcYr");
  label(revenue, 23, "Total annual benefit", true);
  revenue.getCell(23, 2).value = { formula: "RevenueYr+CcYr" };
  revenue.getCell(23, 2).numFmt = MONEY;
  wb.definedNames.add("Revenue!$B$23", "AnnualBenefit");
  label(revenue, 24, "Benefit over the contract (flat, no escalation)");
  revenue.getCell(24, 2).value = { formula: "AnnualBenefit*ContractYears" };
  revenue.getCell(24, 2).numFmt = MONEY;
  label(revenue, 25, "Simple payback (years)", true);
  revenue.getCell(25, 2).value = { formula: 'IF(AnnualBenefit>0,ROUND(CustomerTotal/AnnualBenefit,1),"n/a")' };
  wb.definedNames.add("Revenue!$B$25", "PaybackYears");
  revenue.getCell(27, 1).value =
    "Assumptions from the Hoopa RFC 'standard-low' case (20% occupancy). Bump occupancy % for busier sites — their 'medium' case used 45-50%.";
  revenue.getCell(27, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };

  // ------------------------------------------------------------------ Financing
  [38, 16].forEach((w, i) => (financing.getColumn(i + 1).width = w));
  financing.getCell("A1").value = "Financing (DLL-style loan summary)";
  financing.getCell("A1").font = { bold: true, size: 13 };
  label(financing, 3, "Loan amount (customer total)");
  financing.getCell(3, 2).value = { formula: "CustomerTotal" };
  financing.getCell(3, 2).numFmt = MONEY;
  label(financing, 4, "Annual interest rate (Intake)");
  financing.getCell(4, 2).value = { formula: "FinanceApr" };
  financing.getCell(4, 2).numFmt = PCT;
  label(financing, 5, "Term (years, Intake)");
  financing.getCell(5, 2).value = { formula: "FinanceYears" };
  label(financing, 6, "Monthly payment", true);
  financing.getCell(6, 2).value = {
    formula: "IF(FinanceApr>0,-PMT(FinanceApr/12,FinanceYears*12,CustomerTotal),CustomerTotal/(FinanceYears*12))",
  };
  financing.getCell(6, 2).numFmt = MONEY;
  label(financing, 7, "Total of payments");
  financing.getCell(7, 2).value = { formula: "B6*FinanceYears*12" };
  financing.getCell(7, 2).numFmt = MONEY;
  label(financing, 8, "Total interest");
  financing.getCell(8, 2).value = { formula: "B7-B3" };
  financing.getCell(8, 2).numFmt = MONEY;
  label(financing, 10, "Monthly revenue + credits (Revenue sheet)");
  financing.getCell(10, 2).value = { formula: "AnnualBenefit/12" };
  financing.getCell(10, 2).numFmt = MONEY;
  label(financing, 11, "Net monthly cashflow during the term", true);
  financing.getCell(11, 2).value = { formula: "B10-B6" };
  financing.getCell(11, 2).numFmt = MONEY;
  financing.getCell(13, 1).value =
    "Mirrors the DLL amortization summary in the Hoopa RFC (their deal: 8.39% APR × 60 months). Negative net cashflow = the site doesn't cover its own loan yet.";
  financing.getCell(13, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };

  // ------------------------------------------------------------------ ADA
  [40, 16, 60].forEach((w, i) => (ada.getColumn(i + 1).width = w));
  ada.getCell("A1").value = "Accessible EVCS — CBC 11B-812 (auto from Intake)";
  ada.getCell("A1").font = { bold: true, size: 13 };
  label(ada, 3, "Total chargers (from Intake)");
  ada.getCell(3, 2).value = { formula: "NTotal" };
  label(ada, 4, "Van accessible (12 ft + 5 ft aisle)");
  ada.getCell(4, 2).value = { formula: "IF(NTotal<=0,0,IF(NTotal<=100,1,1+ROUNDUP((NTotal-100)/300,0)))" };
  label(ada, 5, "Standard accessible (9 ft + 5 ft aisle)");
  ada.getCell(5, 2).value = {
    formula: "IF(NTotal<=4,0,IF(NTotal<=50,1,IF(NTotal<=75,2,IF(NTotal<=100,3,3+ROUNDUP((NTotal-100)/60,0)))))",
  };
  label(ada, 6, "Ambulatory (10 ft, no aisle)");
  ada.getCell(6, 2).value = {
    formula: "IF(NTotal<=25,0,IF(NTotal<=50,1,IF(NTotal<=75,2,IF(NTotal<=100,3,3+ROUNDUP((NTotal-100)/50,0)))))",
  };
  wb.definedNames.add("ADA!$B$4", "AdaVan");
  wb.definedNames.add("ADA!$B$5", "AdaStd");
  wb.definedNames.add("ADA!$B$6", "AdaAmb");
  label(ada, 7, "Total accessible stalls", true);
  ada.getCell(7, 2).value = { formula: "AdaVan+AdaStd+AdaAmb" };
  label(ada, 9, "Terrain regrade factor (2% slope rule)");
  ada.getCell(9, 2).value = { formula: "VLOOKUP(Terrain,TerrainTable,4,FALSE)" };
  label(ada, 10, "ADA construction cost", true);
  ada.getCell(10, 2).value = {
    formula:
      "(AdaVan*AdaVanCost+AdaStd*AdaStdCost+AdaAmb*AdaAmbCost)*VLOOKUP(Terrain,TerrainTable,4,FALSE)+IF(NTotal>0,AdaRampCost,0)",
  };
  ada.getCell(10, 2).numFmt = MONEY;
  wb.definedNames.add("ADA!$B$10", "AdaCost");

  ada.getCell(13, 1).value = "CBC Table 11B-228.3.2.1 (2022 CBC — van divisor is 300; verify with your AHJ):";
  ada.getCell(13, 1).font = { bold: true };
  const codeTable = [
    ["Total EVCS", "Van", "Standard", "Ambulatory"],
    ["1 – 4", "1", "0", "0"],
    ["5 – 25", "1", "1", "0"],
    ["26 – 50", "1", "1", "1"],
    ["51 – 75", "1", "2", "2"],
    ["76 – 100", "1", "3", "3"],
    ["101+", "1 + 1/300 over 100", "3 + 1/60 over 100", "3 + 1/50 over 100"],
  ];
  codeTable.forEach((r, i) => {
    r.forEach((v, j) => {
      const c = ada.getCell(14 + i, 1 + j);
      c.value = v;
      if (i === 0) {
        c.font = { bold: true };
        c.fill = HEADER_FILL;
      }
      c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });
  });
  [
    "Slope ≤ 2% in every direction under stalls and aisles — regrading is the big cost on sloped lots.",
    "EVCS markings must NOT be blue (11B-812.9); stencil 'EV CHARGING ONLY' in 12-in letters.",
    "ISA signs: none if ≤4 EVCS; van space only for 5-25; all van + standard for 26+. Never on ambulatory.",
    "Accessible EVCS do NOT count toward regular ADA parking minimums (11B-208.1).",
    "Charger operable parts must sit 15-48 in from grade with 30×48 in clear floor space.",
  ].forEach((n, i) => {
    ada.getCell(22 + i, 1).value = `• ${n}`;
    ada.getCell(22 + i, 1).font = { size: 9, color: { argb: "FF666666" } };
  });

  // ------------------------------------------------------------------ Timeline
  [40, 12, 12, 60].forEach((w, i) => (timeline.getColumn(i + 1).width = w));
  timeline.getCell("A1").value = "Schedule estimate (business days, auto from Intake)";
  timeline.getCell("A1").font = { bold: true, size: 13 };
  head(timeline, 3, ["Phase", "Low", "High", "Note"]);
  const tRow = (row: number, name: string, lo: string, hi: string, note: string) => {
    timeline.getCell(row, 1).value = name;
    timeline.getCell(row, 2).value = { formula: lo };
    timeline.getCell(row, 3).value = { formula: hi };
    timeline.getCell(row, 4).value = note;
  };
  tRow(4, "Site survey & utility scan", "2", "4", "");
  tRow(5, "Site plan design (AutoCAD)", 'IF(IncSitePlan="Yes",5+ROUNDUP(NTotal/4,0),0)', 'IF(IncSitePlan="Yes",10+ROUNDUP(NTotal/4,0),0)', "");
  tRow(6, "SLD / electrical design (PE)", 'IF(IncSLD="Yes",IF(NDcfc>0,10+ROUNDUP(NDcfc/2,0),7),0)', 'IF(IncSLD="Yes",IF(NDcfc>0,17+ROUNDUP(NDcfc/2,0),14),0)', "");
  tRow(7, "Plan check & permits (AHJ)", 'IF(IncPermits="Yes",IF(NDcfc>0,20,5),0)', 'IF(IncPermits="Yes",IF(NDcfc>0,60,15),0)', "AB 970 clocks 20-40 days; real DCFC plan check 4-12 weeks");
  tRow(8, "Utility application & new service (PARALLEL)", "IF(NDcfc>0,85,20)", "IF(NDcfc>0,250,60)", "PG&E/SCE queues 4-12 months — usually the critical path on DCFC sites");
  tRow(9, "Construction", "LaborDays", "LaborDays+7", "");
  tRow(10, "Inspection & commissioning", "5", "10", "");
  timeline.getCell(12, 1).value = "End-to-end (sequential path vs parallel utility)";
  timeline.getCell(12, 1).font = { bold: true };
  timeline.getCell(12, 2).value = { formula: "MAX(B4+B5+B6+B7+B9+B10,B8)" };
  timeline.getCell(12, 3).value = { formula: "MAX(C4+C5+C6+C7+C9+C10,C8)" };
  timeline.getCell(13, 1).value = "≈ months (21 business days/month)";
  timeline.getCell(13, 2).value = { formula: "ROUND(B12/21,1)" };
  timeline.getCell(13, 3).value = { formula: "ROUND(C12/21,1)" };

  // ------------------------------------------------------------------ Instructions
  help.getColumn(1).width = 114;
  const helpLines: [string, boolean][] = [
    ["HOW TO USE THIS TEMPLATE", true],
    ["1. Fill the yellow cells on the Intake sheet: your details, client & program IDs, chargers, site facts, services, commercial terms.", false],
    ["2. Everything else calculates: Panel (sizing + gear pricing at website catalog rates), Panel 480V & Panel 208V (plan-set style", false],
    ["   schedules with phase-staggered circuits, ready for the drawing set), Estimate, Revenue & Payback, Financing, ADA and Timeline.", false],
    ["   The totals, gear pick and payback show at the bottom of the Intake sheet. Grid capacity: 16 circuits @480V / 24 @208V.", false],
    ["3. Every price lives on the RateCard (yellow) — hardware, gear catalog, labor, tax, contingency. Change there, everything follows.", false],
    ["", false],
    ["WHAT WAS FOLDED IN FROM THE REAL RFC_V18 WORKBOOKS (VN Village, Boatman, CCMH, Hoopa, Bartell)", true],
    ["• Costs Internal → Summary structure: per-line contingency, labor loaded with contingency, sales tax on construction and on chargers.", false],
    ["• Hoopa proposal extras: EVOLV network fees ($39.99/port/mo × contract), service plans over contract, hardware price factor", false],
    ["  (1.05 contingency × 1.10 markup when starting from vendor cost), rebate/incentive line, customer total after rebate.", false],
    ["• Hoopa revenue model: occupancy × operating hours × charging% × derated port kW; $0.65/kWh retail vs $0.40/kWh utility;", false],
    ["  LCFS carbon credits ≈ $71.67/kW/yr on DCFC; simple payback. Their financing: DLL loan at 8.39% APR × 60 months (PMT-based).", false],
    ["• Intake carries the incentive program + application ID (CALeVIP / CEC style: D-00025, H-01007, I-271839…).", false],
    ["", false],
    ["WHAT THIS TEMPLATE IS", true],
    ["A budgetary intake + estimate. Make-ready allowances are engine-calibrated per charger (~100-180 ft runs); gear is sized & priced live.", false],
    ["Accuracy target ±15% vs the full RFC Estimator app. For the engineered takeoff — exact NEC wire sizes and the vendor-ready BOM —", false],
    ["build the project in the RFC Estimator web app and use its '⬇ Excel' export.", false],
    ["", false],
    ["KEY ASSUMPTIONS (2025-26 CA market, sources on file)", true],
    ["• Buses, breakers and the transformer size at 125% of connected input amps (NEC 625 continuous loads), matching the app.", false],
    ["• Terrain multipliers: trenching ×1.2 sloped / ×1.5 hilly / ×2.5 rocky; ADA regrade ×1.4/×1.7/×1.8 (2% slope rule). Solid rock: quote.", false],
    ["• ADA per CBC 11B-812: van $6.5k, standard $4.9k (shop bid rate), ambulatory $3.5k flat-lot, ramp $5.2k. Markings must NOT be blue.", false],
    ["• Permits: L2-only = streamlined flat fees (AB 1236); DCFC = plan check ≈ 2% of construction valuation + issuance + utility fees.", false],
    ["• Design: site plan $2.5k + $150/charger (+$1k DCFC); SLD $6k + $900/DCFC + $150/L2 (PE). CPM = 5% of construction at $358/h.", false],
    ["• GPR $1,500/day per 2,000 trench-ft. Utility energization on DCFC sites runs 4-12 months and sets the real schedule.", false],
    ["• Charger hardware and 'budgetary' breaker prices are allowances — swap in CTX price-book / vendor quotes on the RateCard.", false],
  ];
  helpLines.forEach(([text, bold], i) => {
    const c = help.getCell(1 + i, 1);
    c.value = text;
    c.font = bold ? { bold: true, size: 12 } : { size: 10 };
  });

  const out = process.argv[2] ?? path.join(__dirname, "..", "templates", "RFC-Template.xlsx");
  await wb.xlsx.writeFile(out);
  console.log(`wrote ${out}`);

  // ------------------------------------------------------------ Verification
  const scenarios: [string, QuickEstimateInput][] = [
    ["6xDCFC200+5xL2-40 (default)", { ...defaultQuickInput(), terrain: "flat" }],
    ["DCFC-only 4x160", bareInput({ lines: [{ loadTypeId: "DCFC 160kW", count: 4 }] })],
    ["L2-only 8xDual80", bareInput({ lines: [{ loadTypeId: "L2 Dual 80A", count: 8 }] })],
  ];
  for (const [name, input] of scenarios) {
    const p = buildQuickProject(input, defaultProject(), "chk");
    const r = computeEstimate(p);
    const byId = (id: string) => chargerModels.find((m) => m.id === id)!;
    const sumAmps = (cat: string) =>
      input.lines.reduce((s, l) => {
        const lt = byId(l.loadTypeId);
        return lt.category === cat ? s + l.count * electrical(lt).unitInputA : s;
      }, 0);
    const l2A = sumAmps("L2");
    const dcfcA = sumAmps("DCFC");
    const hasBoth = l2A > 0 && dcfcA > 0;
    const txConnKva = hasBoth ? (l2A * 208 * SQRT3) / 1000 : 0;
    const txKva = txConnKva > 0 ? nextSizeCountif(TX_TABLE.map((t) => t[0]), txConnKva * 1.25) : 0;
    const txPrimary = hasBoth ? (txConnKva * 1000) / (480 * SQRT3) : 0;
    const sg = dcfcA > 0 ? nextSizeCountif(SG_TABLE.map((t) => t[0]), (dcfcA + txPrimary) * 1.25) : 0;
    const pnl = l2A > 0 ? nextSizeCountif(PNL_TABLE.map((t) => t[0]), l2A * 1.25) : 0;
    const ok =
      sg === (r.panel.bus480?.suggestedBusA ?? 0) &&
      pnl === (r.panel.bus208?.suggestedBusA ?? 0) &&
      txKva === (r.panel.transformer?.suggestedKva ?? 0);
    console.log(
      `${ok ? "PASS" : "FAIL"} ${name}: template SG ${sg}A / panel ${pnl}A / TX ${txKva}kVA — engine ${r.panel.bus480?.suggestedBusA ?? 0}A / ${r.panel.bus208?.suggestedBusA ?? 0}A / ${r.panel.transformer?.suggestedKva ?? 0}kVA`,
    );
  }

  // Mirror the Estimate chain for the default intake vs the app (which has no
  // network-fee line — add it to the app side so the comparison is apples-to-apples).
  const appProject = buildQuickProject({ ...defaultQuickInput(), terrain: "flat" }, defaultProject(), "chk");
  const appResult = computeEstimate(appProject);
  const gearMirror = appResult.peripherals.gearMainSwitchgear + appResult.peripherals.gearOtherTotal;
  const nD = 6, nL = 5, n = nD + nL;
  const nPorts = 6 * 1 + 5 * 1;
  const networkFees = nPorts * 39.99 * 12 * 5;
  const trench = 100 + 15 * (n - 1);
  const t = TERRAIN_INFO.flat;
  const laborDays = Math.ceil((8 + 2.5 * nD + nL + trench / 40) * t.laborFactor);
  const makeReady =
    6 * models.find((m) => m.lt.id === "DCFC 200kW")!.makeReady +
    5 * models.find((m) => m.lt.id === "L2 Single 40A")!.makeReady;
  const adaCost = (ADA_UNIT_COST.van + ADA_UNIT_COST.standard) * t.adaRegradeFactor + ADA_UNIT_COST.ramp;
  const constr =
    makeReady + gearMirror + trench * 40.81 * t.trenchFactor +
    Math.round(CIVIL_BASE) + nD * dcfcCal.civil + nL * l2Cal.civil +
    nD * dcfcCal.signage + nL * l2Cal.signage +
    adaCost + trench * t.spoilsPerFt + 1500 +
    equipCal.base + equipCal.perDay * laborDays +
    (200 + 60 * n) + (2500 + 5000);
  const loaded = constr * 1.1;
  const labor = laborDays * 2250 * 1.1;
  const valuation = loaded + labor;
  const hardware = 6 * 92000 + 5 * 4000;
  const design =
    (2500 + 150 * n + 1000) + (6000 + 900 * nD + 150 * nL) +
    Math.max(24, Math.round((0.05 * valuation) / 358)) * 358 +
    (500 + 0.02 * valuation);
  const templateTotal =
    loaded + labor + loaded * 0.0725 + hardware * 1.0725 + (1500 * nD + 250 * nL) + networkFees + design;
  const appTotal = appResult.costs.totalCost + networkFees;
  console.log(
    `template mirror total: $${templateTotal.toFixed(0)}  |  app engine total (+network fees): $${appTotal.toFixed(0)}  |  delta ${(((templateTotal - appTotal) / appTotal) * 100).toFixed(1)}%`,
  );
}

main();
