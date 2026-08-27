// Generates RFC-Template.xlsx — a standalone, formula-driven intake +
// budgetary estimate workbook mirroring the web tool AND the shop's real
// RFC_V18 workbooks (VN Village, Boatman, CCMH, Hoopa Motel, Bartell).
//
// Sheets: Intake (details, chargers incl. dual-port L3, line wire defaults +
// service feeders, services, commercial terms) → Takeoff (one row per
// INDIVIDUAL charger: editable wire size/material/runs/one-way ft, priced
// live into the estimate) → Panel (two schedules: 480V L3 + 208V L2,
// transformer, switchgear @ website catalog rates) → Estimate → Costs
// Internal (the RFC_V18 presentation sheet, cell-for-cell Hoopa layout) →
// ADA → Timeline → RateCard (incl. wire $/ft with 450 kcmil Cu & Al) →
// Instructions.
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
import { DEFAULT_LOAD_TYPES, GEAR_CATALOG, STANDARD_BREAKERS_A, WIRE_TABLE } from "../lib/calc/tables";
import type { LoadType, QuickEstimateInput, Terrain } from "../lib/calc/types";
import { COSTS_INTERNAL_TAB_COLOR, fillCostsInternal } from "../lib/costsInternalSheet";

const MONEY = '"$"#,##0.00';
const PCT = "0.00%";
const YELLOW: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6DD" } };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF5" } };
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
    // Ports drive network fees: dual-port L2 = 2; a single-cable DCFC = 1.
    // Dual-cable DCFC units carry an explicit portsPerUnit override.
    ports: lt.portsPerUnit ?? (lt.category === "L2" ? lt.runsPerUnit : 1),
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
  /** Conduit + install hardware + terminations per unit — wire billed separately on the Wire Runs block. */
  install: number;
  /** Same allowance with surface EMT conduit (garage installs) — strut racks/straps are their own Estimate line. */
  installEmt: number;
  /** The wire the engine picked for this model's runs at calibration distances (mode). */
  defaultWire: string;
  defaultMaterial: string;
}

// The strut rack/strap lines get their own Estimate row, so the per-unit EMT
// install allowance must not double-count them.
const EMT_SUPPORT_LINES = ["Strut trapeze racks (every 10 ft, NEC 358.30)", "Strut conduit straps"];

function calibrateModel(lt: LoadType): ModelCal {
  const N = 6;
  // Wire cost (charger runs AND service chain) moves to the editable Wire Runs
  // block, so the per-unit allowance keeps only conduit/install/terminations.
  const installFor = (method: "trench" | "surface") => {
    const p = buildQuickProject(
      bareInput({ lines: [{ loadTypeId: lt.id, count: N }], installMethod: method }),
      defaultProject(),
      "cal",
    );
    const r = computeEstimate(p);
    const wireTotal = r.rows.reduce((s, row) => s + row.wireCost, 0);
    const supports = r.peripherals.lines.hardware
      .filter((h) => EMT_SUPPORT_LINES.includes(h.name))
      .reduce((s, h) => s + h.qty * h.unitCost, 0);
    return {
      install: Math.round((r.materials.grandTotal + r.peripherals.hardwareSubtotal - wireTotal - supports) / N),
      rows: r.rows,
    };
  };
  const trench = installFor("trench");
  const emt = installFor("surface");
  const own = trench.rows.filter((row) => row.loadTypeId === lt.id && row.selectedWire);
  const tally = new Map<string, number>();
  for (const row of own) tally.set(`${row.selectedWire}|${row.material}`, (tally.get(`${row.selectedWire}|${row.material}`) ?? 0) + 1);
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "|Cu";
  const [defaultWire, defaultMaterial] = best.split("|");
  return {
    lt,
    hardware: HARDWARE_ALLOWANCE[lt.id] ?? 0,
    install: trench.install,
    installEmt: emt.install,
    defaultWire,
    defaultMaterial: defaultMaterial || "Cu",
  };
}

function calibrateEquipment(method: "trench" | "surface" = "trench"): { base: number; perDay: number } {
  const run = (count: number) => {
    const p = buildQuickProject(
      bareInput({ lines: [{ loadTypeId: "DCFC 100kW", count }], installMethod: method }),
      defaultProject(),
      "cal",
    );
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
  const equipCal = calibrateEquipment("trench");
  const equipCalEmt = calibrateEquipment("surface");

  const wb = new ExcelJS.Workbook();
  wb.creator = "RFC Estimator";
  wb.calcProperties.fullCalcOnLoad = true;

  const intake = wb.addWorksheet("Intake");
  const takeoff = wb.addWorksheet("Takeoff");
  const panel = wb.addWorksheet("Panel");
  const planSet480 = wb.addWorksheet("Panel 480V");
  const planSet208 = wb.addWorksheet("Panel 208V");
  const estimate = wb.addWorksheet("Estimate");
  const periph = wb.addWorksheet("Peripherals");
  const costsInternal = wb.addWorksheet("Costs Internal", {
    properties: { tabColor: { argb: COSTS_INTERNAL_TAB_COLOR } },
  });
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
  [22, 14, 16, 10, 9, 12, 11, 12, 9, 9, 10, 9, 10, 13, 9, 14, 36, 12, 9, 9, 10].forEach(
    (w, i) => (rate.getColumn(i + 1).width = w),
  );
  rate.getCell("A1").value = "Rate Card — every price the template uses. Edit the yellow cells; formulas follow.";
  rate.getCell("A1").font = { bold: true, size: 13 };

  head(rate, 3, ["Model", "Hardware $/u", "Install $/u (excl. wire)", "Category", "Voltage", "Breaker A", "Circuits/u", "Unit input A", "Ports/u", "kW/port", "A/circuit", "Runs/u", "Cond/run", "Default wire", "Material", "Install EMT $/u"]);
  models.forEach((m, i) => {
    const row = 4 + i;
    const e = electrical(m.lt);
    rate.getCell(row, 1).value = m.lt.id;
    rate.getCell(row, 2).value = m.hardware;
    rate.getCell(row, 2).numFmt = MONEY;
    rate.getCell(row, 2).fill = YELLOW;
    rate.getCell(row, 3).value = m.install;
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
    rate.getCell(row, 12).value = m.lt.runsPerUnit;
    rate.getCell(row, 13).value = m.lt.conductorsPerRun;
    rate.getCell(row, 14).value = m.defaultWire;
    rate.getCell(row, 15).value = m.defaultMaterial;
    rate.getCell(row, 16).value = m.installEmt;
    rate.getCell(row, 16).numFmt = MONEY;
    rate.getCell(row, 16).fill = YELLOW;
  });
  const modelEnd = 3 + models.length;
  rate.getCell(modelEnd + 1, 1).value =
    "Install $/u = conduit, terminations & install hardware (engine-calibrated) — wire is priced on the Intake's Wire Runs block. 'Install EMT $/u' is the same allowance with surface EMT conduit (garage installs; strut racks are a separate Estimate line). Hardware $/u are budgetary — swap in CTX/vendor quotes.";
  rate.getCell(modelEnd + 1, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  wb.definedNames.add(`RateCard!$A$4:$P$${modelEnd}`, "ModelTable");

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
  gRow++;

  // Wire prices — the Intake's Wire Runs block looks sizes up here. A $0
  // price means "no price on the vendor list": type one in before using it.
  label(rate, gRow, "Wire $/ft — THHN/XHHW (Rexel list; incl. 450 kcmil Cu & Al)", true);
  gRow++;
  head(rate, gRow, ["Size", "Cu $/ft", "Al $/ft", "Cu A (75C)", "Al A (75C)"]);
  gRow++;
  const wireFirst = gRow;
  for (const w of WIRE_TABLE) {
    rate.getCell(gRow, 1).value = w.size;
    rate.getCell(gRow, 2).value = w.cuPerFt;
    rate.getCell(gRow, 2).numFmt = MONEY;
    rate.getCell(gRow, 2).fill = YELLOW;
    rate.getCell(gRow, 3).value = w.alPerFt;
    rate.getCell(gRow, 3).numFmt = MONEY;
    rate.getCell(gRow, 3).fill = YELLOW;
    rate.getCell(gRow, 4).value = w.ampacityCu;
    rate.getCell(gRow, 5).value = w.ampacityAl;
    gRow++;
  }
  const wireLast = gRow - 1;
  wb.definedNames.add(`RateCard!$A$${wireFirst}:$A$${wireLast}`, "WireSizes");
  wb.definedNames.add(`RateCard!$A$${wireFirst}:$E$${wireLast}`, "WireTable");
  rate.getCell(gRow, 1).value =
    "450 kcmil: ampacity interpolated (not in NEC 310.16) and the Al $/ft interpolated between 400/500 kcmil — verify before quoting.";
  rate.getCell(gRow, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };

  head(rate, 3, ["Terrain", "Trench ×", "Labor ×", "ADA ×", "Spoils $/ft"], 17);
  (Object.keys(TERRAIN_INFO) as Terrain[]).forEach((t, i) => {
    const info = TERRAIN_INFO[t];
    const row = 4 + i;
    rate.getCell(row, 17).value = t;
    rate.getCell(row, 18).value = info.trenchFactor;
    rate.getCell(row, 19).value = info.laborFactor;
    rate.getCell(row, 20).value = info.adaRegradeFactor;
    rate.getCell(row, 21).value = info.spoilsPerFt;
    for (let cc = 18; cc <= 21; cc++) rate.getCell(row, cc).fill = YELLOW;
  });
  wb.definedNames.add(`RateCard!$Q$4:$U$7`, "TerrainTable");

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
    // Civil rates behind the Peripherals sheet (Aug-2026 SoCal quotes on file):
    // 2500 PSI ready-mix $146-195/yd delivered, short-load fee under 8 yd,
    // asphalt saw-cut patch-back $4-12/SF, forming/anchoring kit per pad.
    ["ConcreteRate", "Concrete $/yd (2500 PSI delivered)", 165, MONEY],
    ["ShortLoadFee", "Concrete short-load fee (order < 8 yd)", 125, MONEY],
    ["AsphaltRate", "Asphalt stall paving $/SF", 5, MONEY],
    ["StallSqFt", "Stall patch-back SF per stall (9x18)", 162],
    ["BollardCost", "Bollard installed $/ea", 110, MONEY],
    ["BollardPerChg", "Bollards per charger", 2],
    ["BollardAtGear", "Bollards at switchgear (4-5)", 4],
    ["BollardAtStepdown", "Bollards at step-down TX + sub-panel", 3],
    ["ConsumDcfc", "Forming consumables $/DCFC (anchors, ells, forms)", 550, MONEY],
    ["ConsumL2", "Forming consumables $/L2", 275, MONEY],
    ["PadYdDcfc", "Concrete yd per DCFC pad", 0.75],
    ["PadYdL2", "Concrete yd per L2 pad", 0.35],
    ["PadYdGear", "Concrete yd — switchgear pad", 1.75],
    ["PadYdXfmr", "Concrete yd — step-down TX + sub-panel pad", 0.5],
    ["PadYdBollard", "Concrete yd per bollard footing", 0.08],
    ["TransformerPad", "Utility transformer pad $ (DCFC)", 5000, MONEY],
    ["CommDcfc", "Commissioning $/DCFC", 1500, MONEY],
    ["CommL2", "Commissioning $/L2", 250, MONEY],
    ["EquipBase", "Equipment rentals base $", equipCal.base, MONEY],
    ["EquipPerDay", "Equipment rentals $/labor-day", equipCal.perDay, MONEY],
    ["EquipBaseEmt", "Equipment base $ (surface EMT — lift, no dig gear)", equipCalEmt.base, MONEY],
    ["EquipPerDayEmt", "Equipment $/labor-day (surface EMT)", equipCalEmt.perDay, MONEY],
    ["EmtRackCost", "Strut trapeze rack $ (strut+rod+anchors, NEC 358.30)", 28, MONEY],
    ["EmtStrapCost", "Strut conduit strap $ (per pipe per rack)", 3.25, MONEY],
    ["EmtFtPerDay", "Surface EMT route-ft per crew-day", 100],
    ["PermitBase", "Permit issuance base $ (AHJ)", 200, MONEY],
    ["PermitPerChg", "Permit issuance $/charger", 60, MONEY],
    ["UtilAppDcfc", "Utility application $ (DCFC site)", 2500, MONEY],
    ["UtilAppL2", "Utility application $ (L2-only site)", 800, MONEY],
  ];
  scalars.forEach(([name, text, value, fmt], i) => {
    const row = 10 + i;
    rate.getCell(row, 17).value = text;
    const c = rate.getCell(row, 18);
    c.value = value;
    if (fmt) c.numFmt = fmt;
    c.fill = YELLOW;
    wb.definedNames.add(`RateCard!$R$${row}`, name);
  });

  // ------------------------------------------------------------------ Intake
  [30, 26, 16, 10, 18, 15, 10, 12, 14, 13].forEach((w, i) => (intake.getColumn(i + 1).width = w));
  intake.getCell("A1").value = "RFC INTAKE — EV Charging Project";
  intake.getCell("A1").font = { bold: true, size: 16 };
  intake.getCell("A2").value =
    "Yellow cells are the inputs — everything else (Panel, Estimate, Costs Internal, ADA, Timeline) calculates from them.";
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

  label(intake, 21, "CHARGERS — one line per model, or qty 1 per line for per-charger distances/breakers", true);
  head(intake, 22, ["Model", "Qty", "Hardware $/u", "Category", "Install $ (excl. wire)", "Hardware $", "Ports"]);
  // 12 lines: enough for one row per individual charger on typical sites
  // (enter qty 1 per line to control each charger's distance, wire and
  // breaker like the website's Takeoff tab).
  const N_CH = 12;
  const CH_FIRST = 23;
  const CH_LAST = CH_FIRST + N_CH - 1; // 34
  // Takeoff sheet: one row per individual charger (website Takeoff parity).
  const N_TK = 24;
  const TK_FIRST = 5;
  const TK_LAST = TK_FIRST + N_TK - 1; // 28
  const TK_TOTAL = TK_LAST + 1; // 29
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
    // Install allowance follows the method: col 3 = trenched PVC, col 16 = surface EMT.
    intake.getCell(row, 5).value = {
      formula: `IFERROR($B${row}*VLOOKUP($A${row},ModelTable,IF(InstallMethod="Trenched",3,16),FALSE),0)`,
    };
    intake.getCell(row, 5).numFmt = MONEY;
    intake.getCell(row, 6).value = { formula: `IFERROR($B${row}*VLOOKUP($A${row},ModelTable,2,FALSE),0)` };
    intake.getCell(row, 6).numFmt = MONEY;
    intake.getCell(row, 7).value = { formula: `IFERROR($B${row}*VLOOKUP($A${row},ModelTable,9,FALSE),0)` };
  }
  // Row anchors below the (now 12-row) charger block — everything downstream
  // derives from these so the block can grow without stale references.
  const TOT = CH_LAST + 2; // 36: Total chargers
  const SITE = TOT + 5; // 41: SITE header
  const W_HEAD = SITE + 10; // 51: wire-runs header
  const W_FIRST = W_HEAD + 2; // 53: first charger wire row
  const FDR_FIRST = W_FIRST + N_CH; // 65: first service/feeder row
  const W_TOTAL = FDR_FIRST + 3; // 68: wire total

  label(intake, TOT, "Total chargers");
  intake.getCell(TOT, 2).value = { formula: `SUM(B${CH_FIRST}:B${CH_LAST})` };
  // SUMPRODUCT instead of SUMIF: the criteria string "L2" doubles as a cell
  // address, which trips some evaluators — the comparison form is unambiguous.
  label(intake, TOT + 1, "DCFC count");
  intake.getCell(TOT + 1, 2).value = { formula: `SUMPRODUCT((D${CH_FIRST}:D${CH_LAST}="DCFC")*B${CH_FIRST}:B${CH_LAST})` };
  label(intake, TOT + 2, "L2 count");
  intake.getCell(TOT + 2, 2).value = { formula: `SUMPRODUCT((D${CH_FIRST}:D${CH_LAST}="L2")*B${CH_FIRST}:B${CH_LAST})` };
  label(intake, TOT + 3, "Total ports");
  intake.getCell(TOT + 3, 2).value = { formula: `SUM(G${CH_FIRST}:G${CH_LAST})` };
  wb.definedNames.add(`Intake!$B$${TOT}`, "NTotal");
  wb.definedNames.add(`Intake!$B$${TOT + 1}`, "NDcfc");
  wb.definedNames.add(`Intake!$B$${TOT + 2}`, "NumL2");
  wb.definedNames.add(`Intake!$B$${TOT + 3}`, "NPorts");

  label(intake, SITE, "SITE", true);
  label(intake, SITE + 1, "Distance to nearest L3 / DCFC charger (ft)");
  inputCell(SITE + 1, 100);
  label(intake, SITE + 2, "Distance to nearest L2 charger (ft)");
  inputCell(SITE + 2, 100);
  label(intake, SITE + 3, "Spacing per extra charger (ft)");
  inputCell(SITE + 3, 15);
  label(intake, SITE + 4, "Terrain");
  inputCell(SITE + 4, "flat").dataValidation = { type: "list", allowBlank: false, formulae: ['"flat,sloped,hilly,rocky"'] };
  label(intake, SITE + 5, "Install method (Trenched / Surface EMT / Hybrid)");
  inputCell(SITE + 5, "Trenched").dataValidation = {
    type: "list",
    allowBlank: false,
    formulae: ['"Trenched,Surface EMT,Hybrid"'],
  };
  intake.getCell(SITE + 5, 3).value =
    "Surface EMT = garage ceiling racks, no digging. Hybrid = EMT inside, trench only the utility→switchgear section.";
  intake.getCell(SITE + 5, 3).font = { italic: true, size: 8, color: { argb: "FF666666" } };
  label(intake, SITE + 6, "Conduit route (ft) — the path the runs follow; overtype if surveyed");
  inputCell(SITE + 6, {
    formula: "IF(NDcfc>0,RunFtDcfc+StepFt*(NDcfc-1),0)+IF(NumL2>0,RunFtL2+StepFt*(NumL2-1),0)",
  } as ExcelJS.CellValue);
  label(intake, SITE + 7, "Trench length (ft) — auto from the method; overtype if surveyed");
  // Hybrid counts only the service legs that actually exist (runs > 0):
  // single-voltage sites have no step-down TX or sub-panel feeder to bury.
  inputCell(SITE + 7, {
    formula: `IF(InstallMethod="Surface EMT",0,IF(InstallMethod="Hybrid",SUMPRODUCT(($D$${FDR_FIRST}:$D$${FDR_FIRST + 2}>0)*$F$${FDR_FIRST}:$F$${FDR_FIRST + 2}),RouteFt))`,
  } as ExcelJS.CellValue);
  label(intake, SITE + 8, "Construction labor days — overtype if known");
  inputCell(SITE + 8, {
    formula:
      'IF(NTotal<=0,0,ROUNDUP((8+2.5*NDcfc+1*NumL2+TrenchFt/40)*VLOOKUP(Terrain,TerrainTable,3,FALSE)+IF(InstallMethod="Trenched",0,RouteFt/EmtFtPerDay),0))',
  } as ExcelJS.CellValue);
  wb.definedNames.add(`Intake!$B$${SITE + 1}`, "RunFtDcfc");
  wb.definedNames.add(`Intake!$B$${SITE + 2}`, "RunFtL2");
  wb.definedNames.add(`Intake!$B$${SITE + 3}`, "StepFt");
  wb.definedNames.add(`Intake!$B$${SITE + 4}`, "Terrain");
  wb.definedNames.add(`Intake!$B$${SITE + 5}`, "InstallMethod");
  wb.definedNames.add(`Intake!$B$${SITE + 6}`, "RouteFt");
  wb.definedNames.add(`Intake!$B$${SITE + 7}`, "TrenchFt");
  wb.definedNames.add(`Intake!$B$${SITE + 8}`, "LaborDays");

  // ---- Wire Runs & Feeders: every run's size, material and length is a
  // yellow cell (defaults auto-fill from the model + site distances; overtype
  // freely — that is how the shop edited the V18 workbooks).
  label(
    intake,
    W_HEAD - 1,
    "WIRE RUNS & FEEDERS — line defaults; per-charger lengths live on the Takeoff sheet",
    true,
  );
  head(intake, W_HEAD, ["Run", "Wire size", "Material", "Runs", "Cond/run", "One-way ft", "$/ft", "Wire $", "Breaker ovr (A)", "Breaker A used"]);
  const wireDropdown = `RateCard!$A$${wireFirst}:$A$${wireLast}`;
  const wireInput = (row: number, col: number, value: ExcelJS.CellValue, list?: string) => {
    const c = intake.getCell(row, col);
    c.value = value;
    c.fill = YELLOW;
    c.border = { bottom: { style: "thin" } };
    if (list) c.dataValidation = { type: "list", allowBlank: true, formulae: [list] };
    return c;
  };
  for (let i = 0; i < N_CH; i++) {
    const row = W_FIRST + i;
    const src = CH_FIRST + i;
    intake.getCell(row, 1).value = { formula: `IF($A$${src}<>"",$A$${src},"")` };
    wireInput(row, 2, { formula: `IFERROR(VLOOKUP($A$${src},ModelTable,14,FALSE),"")` }, wireDropdown);
    wireInput(row, 3, { formula: `IFERROR(VLOOKUP($A$${src},ModelTable,15,FALSE),"Cu")` }, '"Cu,Al"');
    // Runs is editable (like the feeders): overtype to run parallel sets —
    // e.g. two smaller conductors per DCFC instead of one fat one on long runs.
    wireInput(row, 4, { formula: `IFERROR($B$${src}*VLOOKUP($A$${src},ModelTable,12,FALSE),0)` } as ExcelJS.CellValue);
    intake.getCell(row, 5).value = { formula: `IFERROR(VLOOKUP($A$${src},ModelTable,13,FALSE),0)` };
    // Per-charger one-way lengths (and any per-unit size/material overrides)
    // live on the Takeoff sheet; this line's Wire $ reads its rows back so
    // the WireTotal → Estimate chain is untouched.
    intake.getCell(row, 6).value = { formula: `IF($A$${src}<>"","→ Takeoff","")` };
    intake.getCell(row, 6).font = { italic: true, size: 8, color: { argb: "FF666666" } };
    intake.getCell(row, 8).value = {
      formula: `SUMPRODUCT((Takeoff!$S$${TK_FIRST}:$S$${TK_LAST}=${i + 1})*Takeoff!$J$${TK_FIRST}:$J$${TK_LAST})`,
    };
    intake.getCell(row, 8).numFmt = MONEY;
    // Breaker: yellow override wins over the model's rating — feeds the Panel
    // sheet's branch-breaker pricing and both plan-set schedules (mirrors the
    // website Takeoff's breaker column). Undersizing is on you: NEC 625.41
    // wants ≥125% of continuous amps.
    const oc = intake.getCell(row, 9);
    oc.fill = YELLOW;
    oc.border = { bottom: { style: "thin" } };
    intake.getCell(row, 10).value = {
      formula: `IF($A$${src}="","",IF(ISNUMBER($I$${row}),$I$${row},IFERROR(VLOOKUP($A$${src},ModelTable,6,FALSE),"")))`,
    };
  }
  // The feeder rows self-reference their own wire-size cells and read the
  // Panel sheet's connected-amps / TX-FLA cells (rows parameterized below).
  const PNL_BUS480_CONN = 5 + N_CH + 2; // Panel!F19: 480V bus connected amps
  const PNL_SCHED2_HEAD = PNL_BUS480_CONN + 6; // Panel row 25: 208V schedule head
  const PNL_BUS208_CONN = PNL_SCHED2_HEAD + N_CH + 1; // Panel!F38: 208V connected amps
  const PNL_TX_FLA = PNL_BUS208_CONN + 11; // Panel!F49: selected TX primary FLA
  const feeders: [string, string, string, string, string | number][] = [
    [
      "Service: utility → 480V switchgear",
      "600 kcmil",
      "Al",
      `IF(NDcfc>0,MAX(1,ROUNDUP(Panel!$F$${PNL_BUS480_CONN}*1.25/VLOOKUP($B$${FDR_FIRST},WireTable,IF($C$${FDR_FIRST}="Cu",4,5),FALSE),0)),0)`,
      25,
    ],
    [
      "Feeder: switchgear → step-down TX",
      "4/0 AWG",
      "Al",
      `IF(TxKvaSuggested>0,MAX(1,ROUNDUP(Panel!$F$${PNL_TX_FLA}*1.25/VLOOKUP($B$${FDR_FIRST + 1},WireTable,IF($C$${FDR_FIRST + 1}="Cu",4,5),FALSE),0)),0)`,
      15,
    ],
    [
      "Service/feeder → 208V panel",
      "350 kcmil",
      "Al",
      `IF(NumL2>0,MAX(1,ROUNDUP(IF(TxKvaSuggested>0,TxKvaSuggested*1000/(208*SQRT(3)),Panel!$F$${PNL_BUS208_CONN})*1.25/VLOOKUP($B$${FDR_FIRST + 2},WireTable,IF($C$${FDR_FIRST + 2}="Cu",4,5),FALSE),0)),0)`,
      15,
    ],
  ];
  feeders.forEach(([name, size, mat, runsFormula, ft], i) => {
    const row = FDR_FIRST + i;
    intake.getCell(row, 1).value = name;
    wireInput(row, 2, size, wireDropdown);
    wireInput(row, 3, mat, '"Cu,Al"');
    // Runs is editable too — Boatman's feeder was a hand-typed single run.
    wireInput(row, 4, { formula: runsFormula } as ExcelJS.CellValue);
    intake.getCell(row, 5).value = 4;
    wireInput(row, 6, ft);
  });
  // $/ft and Wire $ formulas apply to the FEEDER rows only — charger lines
  // price on the Takeoff sheet (their H cells read it back above).
  for (let row = FDR_FIRST; row <= FDR_FIRST + 2; row++) {
    intake.getCell(row, 7).value = {
      formula: `IF(OR($B$${row}="",$D$${row}=0),0,IF($C$${row}="Cu",VLOOKUP($B$${row},WireTable,2,FALSE),VLOOKUP($B$${row},WireTable,3,FALSE)))`,
    };
    intake.getCell(row, 7).numFmt = MONEY;
    intake.getCell(row, 8).value = { formula: `$D$${row}*$E$${row}*$F$${row}*$G$${row}` };
    intake.getCell(row, 8).numFmt = MONEY;
  }
  label(intake, W_TOTAL, "Wire total (Takeoff chargers + feeders)", true);
  intake.getCell(W_TOTAL, 8).value = { formula: `SUM(H${W_FIRST}:H${FDR_FIRST + 2})` };
  intake.getCell(W_TOTAL, 8).numFmt = MONEY;
  intake.getCell(W_TOTAL, 8).font = { bold: true };
  wb.definedNames.add(`Intake!$H$${W_TOTAL}`, "WireTotal");

  // ---- Labor breakdown: itemize by role/phase; the total feeds the Estimate
  // (mirrors the app's Financials table). Row 1 defaults to the classic
  // crew rate × schedule days, so an untouched sheet prices exactly as before.
  const LAB = W_TOTAL + 2; // 70: labor header
  label(intake, LAB, "LABOR BREAKDOWN — add roles/phases; the total feeds the estimate", true);
  head(intake, LAB + 1, ["Role / phase", "Days", "$ / day", "Labor $"]);
  const laborRows: [string | null, ExcelJS.CellValue, ExcelJS.CellValue][] = [
    ["Electrical crew", { formula: "LaborDays" } as ExcelJS.CellValue, { formula: "LaborDayRate" } as ExcelJS.CellValue],
    [null, 0, 0],
    [null, 0, 0],
  ];
  laborRows.forEach(([name, days, rate], i) => {
    const row = LAB + 2 + i;
    const nameCell = intake.getCell(row, 1);
    if (name) nameCell.value = name;
    nameCell.fill = YELLOW;
    nameCell.border = { bottom: { style: "thin" } };
    wireInput(row, 2, days);
    wireInput(row, 3, rate).numFmt = MONEY;
    intake.getCell(row, 4).value = { formula: `$B$${row}*$C$${row}` };
    intake.getCell(row, 4).numFmt = MONEY;
  });
  label(intake, LAB + 5, "Labor total (before contingency)", true);
  intake.getCell(LAB + 5, 4).value = { formula: `SUM(D${LAB + 2}:D${LAB + 4})` };
  intake.getCell(LAB + 5, 4).numFmt = MONEY;
  intake.getCell(LAB + 5, 4).font = { bold: true };
  wb.definedNames.add(`Intake!$D$${LAB + 5}`, "LaborBase");

  const SVC = LAB + 7; // 77: services header
  label(intake, SVC, "INCLUDED SERVICES (Yes / No)", true);
  const services: [string, string][] = [
    ["Charger hardware", "IncHardware"],
    ["Site plan design (AutoCAD)", "IncSitePlan"],
    ["SLD / electrical design", "IncSLD"],
    ["Construction PM (CPM)", "IncCpm"],
    ["Permitting fees", "IncPermits"],
    ["Private utility scan (GPR)", "IncGpr"],
  ];
  services.forEach(([name, defName], i) => {
    const row = SVC + 1 + i;
    label(intake, row, name);
    inputCell(row, "Yes").dataValidation = { type: "list", allowBlank: false, formulae: ['"Yes,No"'] };
    wb.definedNames.add(`Intake!$B$${row}`, defName);
  });

  const COM = SVC + 8; // 85: commercial terms header
  label(intake, COM, "COMMERCIAL TERMS (from the RFC_V18 / Hoopa proposal structure)", true);
  const commercial: [string, string, number | string, string?][] = [
    ["Hardware price factor", "HardwareFactor", 1, undefined],
    ["Rebate / incentive amount ($)", "RebateAmt", 0, MONEY],
    ["Network (EVOLV) fee $/port/month", "NetworkFeeMo", 39.99, MONEY],
    ["Contract length (years)", "ContractYears", 5, undefined],
    ["Service plan $/year (post-warranty)", "ServicePlanYr", 0, MONEY],
  ];
  commercial.forEach(([text, defName, value, fmt], i) => {
    const row = COM + 1 + i;
    label(intake, row, text);
    inputCell(row, value as ExcelJS.CellValue, fmt);
    wb.definedNames.add(`Intake!$B$${row}`, defName);
  });
  intake.getCell(COM + 1, 3).value = "1 = RateCard prices as-is; 1.155 = vendor cost × 1.05 contingency × 1.10 markup";
  intake.getCell(COM + 1, 3).font = { italic: true, size: 8, color: { argb: "FF666666" } };

  const BOT = COM + 7; // 92: summary block
  label(intake, BOT, "Accessible stalls (CBC 11B-228.3: L2 and DCFC counted separately)", true);
  intake.getCell(BOT, 2).value = { formula: `AdaVan&" van + "&AdaStd&" standard + "&AdaAmb&" ambulatory"` };
  label(intake, BOT + 1, "Main gear (auto — Panel sheet)", true);
  intake.getCell(BOT + 1, 2).value = {
    formula:
      'IF(NDcfc>0,SgSuggested&"A switchgear @ 480V","208V service")&IF(TxKvaSuggested>0," + "&TxKvaSuggested&" kVA step-down TX","")',
  };
  label(intake, BOT + 2, "TOTAL ESTIMATE", true);
  intake.getCell(BOT + 2, 1).font = { bold: true, size: 14 };
  intake.getCell(BOT + 2, 2).value = { formula: "TotalCost" };
  intake.getCell(BOT + 2, 2).numFmt = MONEY;
  intake.getCell(BOT + 2, 2).font = { bold: true, size: 14 };
  intake.getCell(BOT + 2, 2).fill = HEADER_FILL;
  label(intake, BOT + 3, "CUSTOMER TOTAL (after rebate)", true);
  intake.getCell(BOT + 3, 2).value = { formula: "CustomerTotal" };
  intake.getCell(BOT + 3, 2).numFmt = MONEY;
  intake.getCell(BOT + 3, 2).font = { bold: true };
  intake.views = [{ state: "frozen", ySplit: 2 }];

  // ------------------------------------------------------------------ Takeoff
  // One row per INDIVIDUAL charger (both L2 and L3), mirroring the website's
  // Takeoff tab: wire size, material, runs and one-way ft are yellow —
  // defaults auto-fill from the Intake line and the distance ladder, and any
  // overtype reprices the row live. Row totals roll into WireTotal → Estimate
  // → Costs Internal, so this sheet IS where charger wire gets priced.
  [4, 22, 9, 12, 9, 7, 9, 11, 9, 12, 10].forEach((w, i) => (takeoff.getColumn(i + 1).width = w));
  takeoff.getCell("A1").value = "TAKEOFF — one row per charger (wire length, size, runs all editable)";
  takeoff.getCell("A1").font = { bold: true, size: 13 };
  takeoff.getCell("A2").value =
    "Rows expand from the Intake charger lines in order. Yellow cells default from the Intake line + distance ladder — overtype any of them (e.g. the surveyed one-way ft per charger) and the wire $ reprices into the estimate. Clear an overtype by re-entering the default.";
  takeoff.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };

  // Hidden helper: units per Intake line (Q) + running count before (R), then
  // per-row line index (S) / unit-within-line (T).
  takeoff.getCell(2, 17).value = "engine — do not edit";
  takeoff.getCell(2, 17).font = { italic: true, size: 8, color: { argb: "FF999999" } };
  for (let j = 0; j < N_CH; j++) {
    const hr = 3 + j;
    const ir = CH_FIRST + j;
    takeoff.getCell(hr, 17).value = { formula: `IF(Intake!$A$${ir}<>"",Intake!$B$${ir},0)` };
    takeoff.getCell(hr, 18).value = j === 0 ? 0 : { formula: `R${hr - 1}+Q${hr - 1}` };
  }
  const TK_UNITS_TOTAL = 3 + N_CH; // Q15: total units across all lines
  takeoff.getCell(TK_UNITS_TOTAL, 17).value = { formula: `SUM(Q3:Q${2 + N_CH})` };

  head(takeoff, TK_FIRST - 1, ["#", "Charger", "Category", "Wire size", "Material", "Runs", "Cond/run", "One-way ft", "$/ft", "Wire $", "Breaker A"]);
  const tkInput = (row: number, col: number, value: ExcelJS.CellValue, list?: string) => {
    const c = takeoff.getCell(row, col);
    c.value = value;
    c.fill = YELLOW;
    c.border = { bottom: { style: "thin" } };
    if (list) c.dataValidation = { type: "list", allowBlank: true, formulae: [list] };
    return c;
  };
  const CH_A = `Intake!$A$${CH_FIRST}:$A$${CH_LAST}`;
  const CH_B = `Intake!$B$${CH_FIRST}:$B$${CH_LAST}`;
  const CH_D = `Intake!$D$${CH_FIRST}:$D$${CH_LAST}`;
  const WL_B = `Intake!$B$${W_FIRST}:$B$${W_FIRST + N_CH - 1}`; // line wire size
  const WL_C = `Intake!$C$${W_FIRST}:$C$${W_FIRST + N_CH - 1}`; // line material
  const WL_D = `Intake!$D$${W_FIRST}:$D$${W_FIRST + N_CH - 1}`; // line total runs
  const WL_E = `Intake!$E$${W_FIRST}:$E$${W_FIRST + N_CH - 1}`; // cond/run
  const WL_J = `Intake!$J$${W_FIRST}:$J$${W_FIRST + N_CH - 1}`; // breaker used
  for (let k = 1; k <= N_TK; k++) {
    const r = TK_FIRST + k - 1;
    takeoff.getCell(r, 1).value = k;
    // hidden: line index + unit number within the line
    takeoff.getCell(r, 19).value = {
      formula: `IF(A${r}<=$Q$${TK_UNITS_TOTAL},MATCH(A${r}-0.5,$R$3:$R$${2 + N_CH},1),0)`,
    };
    takeoff.getCell(r, 20).value = { formula: `IF(S${r}>0,A${r}-INDEX($R$3:$R$${2 + N_CH},S${r}),0)` };
    takeoff.getCell(r, 2).value = { formula: `IF(S${r}>0,INDEX(${CH_A},S${r})&" #"&T${r},"")` };
    takeoff.getCell(r, 3).value = { formula: `IF(S${r}>0,INDEX(${CH_D},S${r}),"")` };
    tkInput(r, 4, { formula: `IF(S${r}>0,INDEX(${WL_B},S${r}),"")` }, wireDropdown);
    tkInput(r, 5, { formula: `IF(S${r}>0,INDEX(${WL_C},S${r}),"")` }, '"Cu,Al"');
    // Per-unit parallel runs = the line's total runs / qty (keeps line-level
    // Runs overrides meaningful); overtype per charger for odd splits.
    tkInput(r, 6, { formula: `IF(S${r}>0,IFERROR(INDEX(${WL_D},S${r})/INDEX(${CH_B},S${r}),1),0)` });
    takeoff.getCell(r, 7).value = { formula: `IF(S${r}>0,INDEX(${WL_E},S${r}),0)` };
    // Distance ladder per LEVEL: charger n of a level sits StepFt past the
    // previous one, starting from that level's first-run distance. Overtype
    // with the surveyed length per charger — that is the point of this sheet.
    tkInput(r, 8, {
      formula: `IF(S${r}=0,0,IF($C${r}="DCFC",RunFtDcfc,RunFtL2)+StepFt*(SUMPRODUCT(($C$${TK_FIRST}:$C${r}=$C${r})*1)-1))`,
    });
    takeoff.getCell(r, 9).value = {
      formula: `IF(OR($D${r}="",$F${r}=0),0,IF($E${r}="Cu",VLOOKUP($D${r},WireTable,2,FALSE),VLOOKUP($D${r},WireTable,3,FALSE)))`,
    };
    takeoff.getCell(r, 9).numFmt = MONEY;
    takeoff.getCell(r, 10).value = { formula: `$F${r}*$G${r}*$H${r}*$I${r}` };
    takeoff.getCell(r, 10).numFmt = MONEY;
    takeoff.getCell(r, 11).value = { formula: `IF(S${r}>0,INDEX(${WL_J},S${r}),"")` };
  }
  for (const col of [17, 18, 19, 20]) takeoff.getColumn(col).hidden = true;
  label(takeoff, TK_TOTAL, "Charger wire total → Intake / Estimate", true);
  takeoff.getCell(TK_TOTAL, 10).value = { formula: `SUM(J${TK_FIRST}:J${TK_LAST})` };
  takeoff.getCell(TK_TOTAL, 10).numFmt = MONEY;
  takeoff.getCell(TK_TOTAL, 10).font = { bold: true };
  takeoff.getCell(TK_TOTAL, 10).fill = HEADER_FILL;
  wb.definedNames.add(`Takeoff!$J$${TK_TOTAL}`, "TakeoffWire");
  takeoff.getCell(TK_TOTAL + 1, 2).value = {
    formula: `IF($Q$${TK_UNITS_TOTAL}>${N_TK},"⚠ More than ${N_TK} chargers — rows truncated; use the app's Excel export for larger sites","")`,
  };
  takeoff.getCell(TK_TOTAL + 1, 2).font = { color: { argb: "FFB45309" }, italic: true };
  takeoff.getCell(TK_TOTAL + 2, 2).value =
    "Conduit & terminations are in the per-charger install allowance (RateCard); this sheet prices the conductors. Breaker column mirrors the Intake line (override it there).";
  takeoff.getCell(TK_TOTAL + 2, 2).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  takeoff.views = [{ state: "frozen", ySplit: TK_FIRST - 1 }];

  // ------------------------------------------------------------------ Panel
  // Row anchors (all derived from N_CH so the 12-line intake flows through):
  // schedule1 rows 5..4+N, then 5 summary rows; schedule2 head PNL_SCHED2_HEAD,
  // rows +1..+N, then summary; TX block; branch breakers; gear total.
  const P1 = 5; // first 480V schedule row
  const PNL_SG_ROW = PNL_BUS480_CONN + 2; // suggested switchgear (F col), override in D
  const PNL_P2 = PNL_SCHED2_HEAD + 1; // first 208V schedule row
  const PNL_PNL_ROW = PNL_BUS208_CONN + 2; // suggested 208V panel
  const PNL_TX_LBL = PNL_BUS208_CONN + 6; // TX block header
  const PNL_TX_CONN = PNL_TX_LBL + 1; // connected kVA (TxKvaConnected)
  const PNL_TX_ROW = PNL_TX_LBL + 3; // suggested TX kVA
  const PNL_TX_BRK = PNL_TX_FLA + 1; // primary breaker A
  const PNL_BB_HEAD = PNL_TX_BRK + 3; // branch-breaker table head
  const PNL_BB_FIRST = PNL_BB_HEAD + 1;
  const PNL_BB_TOTAL = PNL_BB_FIRST + N_CH;
  const PNL_GEAR_TOTAL = PNL_BB_TOTAL + 2;

  [24, 12, 12, 12, 14, 14].forEach((w, i) => (panel.getColumn(i + 1).width = w));
  panel.getCell("A1").value =
    "Panel Schedules — auto from Intake (mirrors the app's algorithm, NEC 625 continuous loads at 125%)";
  panel.getCell("A1").font = { bold: true, size: 13 };

  label(panel, 3, "PANEL SCHEDULE 1 — 480V SWITCHGEAR (LEVEL 3 / DCFC)", true);
  head(panel, 4, ["Model", "Qty", "Breaker A", "Circuits", "A per circuit", "Connected A"]);
  for (let i = 0; i < N_CH; i++) {
    const row = P1 + i;
    const src = CH_FIRST + i;
    panel.getCell(row, 1).value = { formula: `IF(Intake!$D${src}="DCFC",Intake!$A${src},"")` };
    panel.getCell(row, 2).value = { formula: `IF(Intake!$D${src}="DCFC",Intake!$B${src},0)` };
    panel.getCell(row, 3).value = { formula: `IF(B${row}>0,Intake!$J$${W_FIRST + i},"")` };
    panel.getCell(row, 4).value = { formula: `IF(B${row}>0,B${row}*VLOOKUP(Intake!$A${src},ModelTable,7,FALSE),0)` };
    panel.getCell(row, 5).value = { formula: `IF(B${row}>0,VLOOKUP(Intake!$A${src},ModelTable,8,FALSE),"")` };
    panel.getCell(row, 6).value = { formula: `IF(B${row}>0,B${row}*VLOOKUP(Intake!$A${src},ModelTable,8,FALSE),0)` };
  }
  label(panel, PNL_BUS480_CONN - 2, "DCFC connected amps");
  panel.getCell(PNL_BUS480_CONN - 2, 6).value = { formula: `SUM(F${P1}:F${P1 + N_CH - 1})` };
  label(panel, PNL_BUS480_CONN - 1, "+ Transformer primary reflection (raw)");
  panel.getCell(PNL_BUS480_CONN - 1, 6).value = { formula: "IF(AND(NDcfc>0,NumL2>0),TxKvaConnected*1000/(480*SQRT(3)),0)" };
  label(panel, PNL_BUS480_CONN, "480V bus connected amps", true);
  panel.getCell(PNL_BUS480_CONN, 6).value = { formula: `F${PNL_BUS480_CONN - 2}+F${PNL_BUS480_CONN - 1}` };
  label(panel, PNL_BUS480_CONN + 1, "480V bus demand amps (×125%)", true);
  panel.getCell(PNL_BUS480_CONN + 1, 6).value = { formula: `F${PNL_BUS480_CONN}*1.25` };
  label(panel, PNL_SG_ROW, `Main switchgear (A) — auto, or type an override in D${PNL_SG_ROW}`, true);
  panel.getCell(PNL_SG_ROW, 4).fill = YELLOW;
  panel.getCell(PNL_SG_ROW, 4).border = { bottom: { style: "thin" } };
  panel.getCell(PNL_SG_ROW, 4).dataValidation = { type: "list", allowBlank: true, formulae: ["SgSizes"] };
  panel.getCell(PNL_SG_ROW, 5).value = "← override";
  panel.getCell(PNL_SG_ROW, 5).font = { italic: true, size: 8, color: { argb: "FF666666" } };
  panel.getCell(PNL_SG_ROW, 6).value = {
    formula: `IF(NDcfc>0,IF(ISNUMBER($D$${PNL_SG_ROW}),$D$${PNL_SG_ROW},INDEX(SgSizes,MIN(ROWS(SgSizes),COUNTIF(SgSizes,"<"&F${PNL_BUS480_CONN + 1})+1))),0)`,
  };
  wb.definedNames.add(`Panel!$F$${PNL_SG_ROW}`, "SgSuggested");
  label(panel, PNL_SG_ROW + 1, "Switchgear price (website catalog)", true);
  panel.getCell(PNL_SG_ROW + 1, 6).value = { formula: "IF(NDcfc>0,IFERROR(VLOOKUP(SgSuggested,SgTable,2,FALSE),0),0)" };
  panel.getCell(PNL_SG_ROW + 1, 6).numFmt = MONEY;

  label(panel, PNL_SCHED2_HEAD - 1, "PANEL SCHEDULE 2 — 208V PANEL (LEVEL 2)", true);
  head(panel, PNL_SCHED2_HEAD, ["Model", "Qty", "Breaker A", "Circuits", "A per circuit", "Connected A"]);
  for (let i = 0; i < N_CH; i++) {
    const row = PNL_P2 + i;
    const src = CH_FIRST + i;
    panel.getCell(row, 1).value = { formula: `IF(Intake!$D${src}="L2",Intake!$A${src},"")` };
    panel.getCell(row, 2).value = { formula: `IF(Intake!$D${src}="L2",Intake!$B${src},0)` };
    panel.getCell(row, 3).value = { formula: `IF(B${row}>0,Intake!$J$${W_FIRST + i},"")` };
    panel.getCell(row, 4).value = { formula: `IF(B${row}>0,B${row}*VLOOKUP(Intake!$A${src},ModelTable,7,FALSE),0)` };
    panel.getCell(row, 5).value = { formula: `IF(B${row}>0,VLOOKUP(Intake!$A${src},ModelTable,8,FALSE),"")` };
    panel.getCell(row, 6).value = { formula: `IF(B${row}>0,B${row}*VLOOKUP(Intake!$A${src},ModelTable,8,FALSE),0)` };
  }
  label(panel, PNL_BUS208_CONN, "208V bus connected amps", true);
  panel.getCell(PNL_BUS208_CONN, 6).value = { formula: `SUM(F${PNL_P2}:F${PNL_P2 + N_CH - 1})` };
  label(panel, PNL_BUS208_CONN + 1, "208V bus demand amps (×125%)", true);
  panel.getCell(PNL_BUS208_CONN + 1, 6).value = { formula: `F${PNL_BUS208_CONN}*1.25` };
  label(panel, PNL_PNL_ROW, `208V panel (A) — auto, or type an override in D${PNL_PNL_ROW}`, true);
  panel.getCell(PNL_PNL_ROW, 4).fill = YELLOW;
  panel.getCell(PNL_PNL_ROW, 4).border = { bottom: { style: "thin" } };
  panel.getCell(PNL_PNL_ROW, 4).dataValidation = { type: "list", allowBlank: true, formulae: ["PnlSizes"] };
  panel.getCell(PNL_PNL_ROW, 5).value = "← override";
  panel.getCell(PNL_PNL_ROW, 5).font = { italic: true, size: 8, color: { argb: "FF666666" } };
  panel.getCell(PNL_PNL_ROW, 6).value = {
    formula: `IF(NumL2>0,IF(ISNUMBER($D$${PNL_PNL_ROW}),$D$${PNL_PNL_ROW},INDEX(PnlSizes,MIN(ROWS(PnlSizes),COUNTIF(PnlSizes,"<"&F${PNL_BUS208_CONN + 1})+1))),0)`,
  };
  label(panel, PNL_PNL_ROW + 1, "Panel type");
  panel.getCell(PNL_PNL_ROW + 1, 6).value = {
    formula: `IF(NumL2=0,"—",IF(F${PNL_PNL_ROW}>=1000,"Distribution panel","Sub-panel"))`,
  };
  label(panel, PNL_PNL_ROW + 2, "Panel price", true);
  panel.getCell(PNL_PNL_ROW + 2, 6).value = { formula: `IF(NumL2>0,IFERROR(VLOOKUP(F${PNL_PNL_ROW},PnlTable,2,FALSE),0),0)` };
  panel.getCell(PNL_PNL_ROW + 2, 6).numFmt = MONEY;

  label(panel, PNL_TX_LBL, "STEP-DOWN TRANSFORMER (480V → 208V, only when both levels exist)", true);
  label(panel, PNL_TX_CONN, "Connected kVA (208V load)");
  panel.getCell(PNL_TX_CONN, 6).value = { formula: `IF(AND(NDcfc>0,NumL2>0),F${PNL_BUS208_CONN}*208*SQRT(3)/1000,0)` };
  wb.definedNames.add(`Panel!$F$${PNL_TX_CONN}`, "TxKvaConnected");
  label(panel, PNL_TX_CONN + 1, "Demand kVA (×125%)");
  panel.getCell(PNL_TX_CONN + 1, 6).value = { formula: `F${PNL_TX_CONN}*1.25` };
  label(panel, PNL_TX_ROW, `Transformer (kVA) — auto, or type an override in D${PNL_TX_ROW}`, true);
  panel.getCell(PNL_TX_ROW, 4).fill = YELLOW;
  panel.getCell(PNL_TX_ROW, 4).border = { bottom: { style: "thin" } };
  panel.getCell(PNL_TX_ROW, 4).dataValidation = { type: "list", allowBlank: true, formulae: ["TxSizes"] };
  panel.getCell(PNL_TX_ROW, 5).value = "← override";
  panel.getCell(PNL_TX_ROW, 5).font = { italic: true, size: 8, color: { argb: "FF666666" } };
  panel.getCell(PNL_TX_ROW, 6).value = {
    formula: `IF(F${PNL_TX_CONN}>0,IF(ISNUMBER($D$${PNL_TX_ROW}),$D$${PNL_TX_ROW},INDEX(TxSizes,MIN(ROWS(TxSizes),COUNTIF(TxSizes,"<"&F${PNL_TX_CONN + 1})+1))),0)`,
  };
  wb.definedNames.add(`Panel!$F$${PNL_TX_ROW}`, "TxKvaSuggested");
  label(panel, PNL_TX_ROW + 1, "Transformer price", true);
  panel.getCell(PNL_TX_ROW + 1, 6).value = { formula: `IF(F${PNL_TX_ROW}>0,IFERROR(VLOOKUP(F${PNL_TX_ROW},TxTable,2,FALSE),0),0)` };
  panel.getCell(PNL_TX_ROW + 1, 6).numFmt = MONEY;
  label(panel, PNL_TX_FLA, "Primary FLA at 480V (selected TX)");
  panel.getCell(PNL_TX_FLA, 6).value = { formula: `IF(F${PNL_TX_ROW}>0,F${PNL_TX_ROW}*1000/(480*SQRT(3)),0)` };
  label(panel, PNL_TX_BRK, "Primary breaker (125% of FLA, next standard)");
  panel.getCell(PNL_TX_BRK, 6).value = {
    formula: `IF(F${PNL_TX_ROW}>0,INDEX(StdBrk,MIN(ROWS(StdBrk),COUNTIF(StdBrk,"<"&F${PNL_TX_FLA}*1.25)+1)),0)`,
  };
  label(panel, PNL_TX_BRK + 1, "Primary breaker price");
  panel.getCell(PNL_TX_BRK + 1, 6).value = { formula: `IF(F${PNL_TX_BRK}>0,IFERROR(VLOOKUP(F${PNL_TX_BRK},BrkTbl480,2,FALSE),0),0)` };
  panel.getCell(PNL_TX_BRK + 1, 6).numFmt = MONEY;

  label(panel, PNL_BB_HEAD - 1, "BRANCH BREAKERS (sizes from the Intake's Breaker column — overrides included)", true);
  head(panel, PNL_BB_HEAD, ["Model", "Breaker A", "Voltage", "Circuits", "Unit $", "Total $"]);
  for (let i = 0; i < N_CH; i++) {
    const row = PNL_BB_FIRST + i;
    const src = CH_FIRST + i;
    panel.getCell(row, 1).value = { formula: `IF(Intake!$B${src}>0,Intake!$A${src},"")` };
    panel.getCell(row, 2).value = { formula: `IF(Intake!$B${src}>0,Intake!$J$${W_FIRST + i},"")` };
    panel.getCell(row, 3).value = { formula: `IF(Intake!$B${src}>0,VLOOKUP(Intake!$A${src},ModelTable,5,FALSE),"")` };
    panel.getCell(row, 4).value = { formula: `IF(Intake!$B${src}>0,Intake!$B${src}*VLOOKUP(Intake!$A${src},ModelTable,7,FALSE),0)` };
    panel.getCell(row, 5).value = {
      formula: `IF(D${row}>0,IF(C${row}=480,IFERROR(VLOOKUP(B${row},BrkTbl480,2,FALSE),0),IFERROR(VLOOKUP(B${row},BrkTbl208,2,FALSE),0)),0)`,
    };
    panel.getCell(row, 5).numFmt = MONEY;
    panel.getCell(row, 6).value = { formula: `D${row}*E${row}` };
    panel.getCell(row, 6).numFmt = MONEY;
  }
  label(panel, PNL_BB_TOTAL, "Branch breakers total (incl. TX primary)", true);
  panel.getCell(PNL_BB_TOTAL, 6).value = { formula: `SUM(F${PNL_BB_FIRST}:F${PNL_BB_FIRST + N_CH - 1})+F${PNL_TX_BRK + 1}` };
  panel.getCell(PNL_BB_TOTAL, 6).numFmt = MONEY;

  label(panel, PNL_GEAR_TOTAL, "GEAR TOTAL — switchgear + panel + transformer + breakers", true);
  panel.getCell(PNL_GEAR_TOTAL, 1).font = { bold: true, size: 12 };
  panel.getCell(PNL_GEAR_TOTAL, 6).value = {
    formula: `F${PNL_SG_ROW + 1}+F${PNL_PNL_ROW + 2}+F${PNL_TX_ROW + 1}+F${PNL_BB_TOTAL}`,
  };
  panel.getCell(PNL_GEAR_TOTAL, 6).numFmt = MONEY;
  panel.getCell(PNL_GEAR_TOTAL, 6).font = { bold: true, size: 12 };
  panel.getCell(PNL_GEAR_TOTAL, 6).fill = HEADER_FILL;
  wb.definedNames.add(`Panel!$F$${PNL_GEAR_TOTAL}`, "GearTotal");
  panel.getCell(PNL_GEAR_TOTAL + 2, 1).value =
    "A $0 unit price means no catalog price for that size — add it on the RateCard before quoting.";
  panel.getCell(PNL_GEAR_TOTAL + 2, 1).font = { italic: true, size: 9, color: { argb: "FFB45309" } };
  panel.getCell(PNL_GEAR_TOTAL + 3, 1).value =
    `Yellow D-column cells override the auto gear size (D${PNL_SG_ROW} switchgear, D${PNL_PNL_ROW} panel, D${PNL_TX_ROW} transformer) — the primary breaker, feeder runs on the Intake, and prices all re-derive. Clear the cell to go back to auto. Branch breaker sizes come from the Intake wire-runs Breaker column.`;
  panel.getCell(PNL_GEAR_TOTAL + 3, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
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
    // Line rows 3..2+N_CH, running-total total row TOT_R; per-circuit rows
    // start at HELPER_FIRST. Breaker sizes come from the Intake wire-runs
    // "Breaker A used" column (col J) so per-line overrides flow into the
    // plan-set schedules too.
    const LINES_LAST = 2 + N_CH;
    const TOT_R = LINES_LAST + 1;
    const JRANGE = `Intake!$J$${W_FIRST}:$J$${W_FIRST + N_CH - 1}`;
    ws.getCell(2, 18).value = "engine — do not edit";
    ws.getCell(2, 18).font = { italic: true, size: 8, color: { argb: "FF999999" } };
    for (let j = 0; j < N_CH; j++) {
      const ir = CH_FIRST + j; // intake charger row
      const hr = 3 + j;
      ws.getCell(hr, 19).value = {
        formula: `IF(Intake!$D$${ir}="${cfg.category}",Intake!$B$${ir}*IFERROR(VLOOKUP(Intake!$A$${ir},ModelTable,7,FALSE),0),0)`,
      };
      ws.getCell(hr, 20).value = j === 0 ? 0 : { formula: `T${hr - 1}+S${hr - 1}` };
    }
    ws.getCell(TOT_R, 18).value = "total circuits";
    ws.getCell(TOT_R, 18).font = { size: 8 };
    ws.getCell(TOT_R, 19).value = { formula: `SUM(S3:S${LINES_LAST})` };

    const maxCkts = cfg.poles === 3 ? 16 : 24;
    const HELPER_FIRST = TOT_R + 2;
    for (let k = 1; k <= maxCkts; k++) {
      const hr = HELPER_FIRST + k - 1;
      ws.getCell(hr, 19).value = k;
      ws.getCell(hr, 20).value = { formula: `IF(S${hr}<=$S$${TOT_R},MATCH(S${hr}-0.5,$T$3:$T$${LINES_LAST},1),0)` };
      ws.getCell(hr, 21).value = { formula: `IF(T${hr}>0,S${hr}-INDEX($T$3:$T$${LINES_LAST},T${hr}),0)` };
      ws.getCell(hr, 22).value = { formula: `IF(T${hr}>0,INDEX(Intake!$A$${CH_FIRST}:$A$${CH_LAST},T${hr}),"")` };
      ws.getCell(hr, 23).value = { formula: `IF(T${hr}>0,IFERROR(VLOOKUP(V${hr},ModelTable,7,FALSE),1),1)` };
      if (cfg.includeTx) {
        ws.getCell(hr, 24).value = {
          formula: `IF(T${hr}>0,UPPER(V${hr})&" #"&U${hr},IF(S${hr}=$S$${TOT_R}+1,IF(TxKvaSuggested>0,"XFMR "&TxKvaSuggested&" KVA - EV_SUB (208V)",""),""))`,
        };
        ws.getCell(hr, 25).value = {
          formula: `IF(T${hr}>0,IFERROR(INDEX(${JRANGE},T${hr}),0),IF(S${hr}=$S$${TOT_R}+1,IF(TxKvaSuggested>0,Panel!$F$${PNL_TX_BRK},0),0))`,
        };
        ws.getCell(hr, 26).value = {
          formula: `IF(T${hr}>0,IFERROR(VLOOKUP(V${hr},ModelTable,11,FALSE),0)*${cfg.vLL}/SQRT(3),IF(S${hr}=$S$${TOT_R}+1,IF(TxKvaSuggested>0,TxKvaConnected*1000/3,0),0))`,
        };
        ws.getCell(hr, 27).value = {
          formula: `IF(S${hr}<=$S$${TOT_R},1,IF(S${hr}=$S$${TOT_R}+1,IF(TxKvaSuggested>0,1,0),0))`,
        };
      } else {
        // Dual-port L2 units get A/B suffixes per circuit within the unit.
        ws.getCell(hr, 24).value = {
          formula: `IF(T${hr}>0,UPPER(V${hr})&" #"&ROUNDUP(U${hr}/W${hr},0)&IF(W${hr}>1,CHAR(64+U${hr}-(ROUNDUP(U${hr}/W${hr},0)-1)*W${hr}),""),"")`,
        };
        ws.getCell(hr, 25).value = { formula: `IF(T${hr}>0,IFERROR(INDEX(${JRANGE},T${hr}),0),0)` };
        ws.getCell(hr, 26).value = {
          formula: `IF(T${hr}>0,IFERROR(VLOOKUP(V${hr},ModelTable,11,FALSE),0)*${cfg.vLL}/2,0)`,
        };
        ws.getCell(hr, 27).value = { formula: `IF(S${hr}<=$S$${TOT_R},1,0)` };
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
      formula: `IF($S$${TOT_R}${cfg.includeTx ? "+IF(TxKvaSuggested>0,1,0)" : ""}>${maxCkts},"⚠ More than ${maxCkts} circuits — grid truncated, use the app's Excel export","")`,
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
    mainFormula: `Panel!$F$${PNL_PNL_ROW}`,
    includeTx: false,
  });

  // ------------------------------------------------------------------ Estimate
  [44, 16, 12].forEach((w, i) => (estimate.getColumn(i + 1).width = w));
  estimate.getCell("A1").value = "Budgetary Estimate (auto from Intake + Panel + RateCard)";
  estimate.getCell("A1").font = { bold: true, size: 13 };
  estimate.getCell("A2").value =
    "Structure mirrors the RFC_V18 Costs Internal → Summary chain. For the engineered takeoff use the app's Excel export.";
  estimate.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };

  label(estimate, 4, "Construction labor days (edit on Intake)");
  estimate.getCell(4, 2).value = { formula: "LaborDays" };

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
  eLine(7, "Wire runs (Takeoff + feeders) + conduit & install allowance", `WireTotal+SUM(Intake!E${CH_FIRST}:E${CH_LAST})`);
  eLine(8, "Switchgear, panels & transformer (Panel sheet)", "GearTotal");
  eLine(
    9,
    "Trenching / asphalt cut (terrain-adj.) + stall paving",
    "TrenchFt*TrenchRate*VLOOKUP(Terrain,TerrainTable,2,FALSE)+PeriphAsphalt",
  );
  // NEC 358.30: racks every 10 ft along the route (+1 end rack), one strut
  // strap per conduit per rack ≈ one per 10 conduit-ft. Charger conduit-ft
  // come per-unit from the Takeoff sheet (runs × one-way ft per charger);
  // hybrid keeps the service feeders underground, so only surface installs
  // add the feeder footage.
  eLine(
    10,
    "Surface EMT supports — strut racks @ 10 ft + straps (NEC 358.30)",
    `IF(InstallMethod="Trenched",0,(ROUNDUP(RouteFt/10,0)+1)*EmtRackCost+ROUNDUP((SUMPRODUCT(Takeoff!$F$${TK_FIRST}:$F$${TK_LAST},Takeoff!$H$${TK_FIRST}:$H$${TK_LAST})+IF(InstallMethod="Surface EMT",SUMPRODUCT(Intake!$D$${FDR_FIRST}:$D$${FDR_FIRST + 2},Intake!$F$${FDR_FIRST}:$F$${FDR_FIRST + 2}),0))/10,0)*EmtStrapCost)`,
  );
  eLine(11, "Civil — concrete, rebar, consumables (Peripherals sheet)", "PeriphCivil");
  eLine(12, "Signage, striping & bollards (Peripherals sheet)", "PeriphSignage");
  eLine(13, "Accessible EVCS stalls + ramp (ADA sheet)", "AdaCost");
  eLine(14, "Spoils haul-off / dump", "TrenchFt*VLOOKUP(Terrain,TerrainTable,5,FALSE)");
  eLine(15, "Private utility scan (GPR)", 'IF(OR(IncGpr="No",TrenchFt<=0),0,MAX(1,ROUNDUP(TrenchFt/GprFtPerDay,0))*GprDayRate)');
  eLine(
    16,
    "Equipment rentals",
    'IF(NTotal<=0,0,IF(InstallMethod="Surface EMT",EquipBaseEmt+EquipPerDayEmt*LaborDays,EquipBase+EquipPerDay*LaborDays))',
  );
  eLine(17, "Permit issuance (AHJ)", 'IF(IncPermits="Yes",PermitBase+PermitPerChg*NTotal,0)');
  eLine(18, "Utility application + transformer pad", 'IF(IncPermits="Yes",IF(NDcfc>0,UtilAppDcfc+TransformerPad,UtilAppL2),0)');
  eLine(19, "Construction subtotal", "SUM(B7:B18)");
  estimate.getCell(19, 1).font = { bold: true };
  eLine(20, "Contingency", "B19*ContingencyPct");
  eLine(21, "Construction total (loaded)", "B19+B20");
  estimate.getCell(21, 1).font = { bold: true };
  estimate.getCell(21, 2).font = { bold: true };
  wb.definedNames.add("Estimate!$B$21", "ConstructionTotal");

  eLine(23, "Labor (breakdown total, contingency-loaded)", "LaborBase*(1+ContingencyPct)");
  wb.definedNames.add("Estimate!$B$23", "LaborCost");
  eLine(24, "Sales tax on construction", "ConstructionTotal*TaxPct");
  eLine(25, "Permit valuation (construction + labor)", "ConstructionTotal+LaborCost");
  estimate.getCell(25, 1).font = { italic: true, size: 9 };
  wb.definedNames.add("Estimate!$B$25", "Valuation");

  eHeader(27, "Equipment purchase invoice");
  eLine(28, "Charger hardware (RateCard × price factor)", `IF(IncHardware="Yes",SUM(Intake!F${CH_FIRST}:F${CH_LAST})*HardwareFactor,0)`);
  eLine(29, "Commissioning", 'IF(IncHardware="Yes",CommDcfc*NDcfc+CommL2*NumL2,0)');
  eLine(30, "Network (EVOLV) fees — ports × $/mo × contract", 'IF(IncHardware="Yes",NPorts*NetworkFeeMo*12*ContractYears,0)');
  eLine(31, "Service plan over contract (post-warranty years)", 'IF(IncHardware="Yes",ServicePlanYr*ContractYears,0)');
  eLine(32, "Sales tax on charger hardware", "B28*TaxPct");

  eHeader(34, "Design invoice");
  eLine(35, "Site plan design (AutoCAD)", 'IF(IncSitePlan="Yes",2500+150*NTotal+IF(NDcfc>0,1000,0),0)');
  eLine(36, "SLD / electrical engineering (PE)", 'IF(IncSLD="Yes",IF(NDcfc>0,6000+900*NDcfc+150*NumL2,2500+150*NumL2),0)');
  estimate.getCell(37, 3).value = { formula: 'IF(IncCpm="Yes",MAX(24,ROUND(CpmPct*Valuation/PmRate,0)),0)' };
  estimate.getCell(37, 3).numFmt = "0";
  eLine(37, "Construction PM — hours in col C", "C37*PmRate");
  eLine(38, "Plan check (AHJ, % of valuation for DCFC)", 'IF(IncPermits="Yes",IF(NDcfc>0,500+0.02*Valuation,300),0)');
  eLine(39, "Design subtotal", "SUM(B35:B38)");
  estimate.getCell(39, 1).font = { bold: true };

  eLine(41, "TOTAL PROJECT COST", "ConstructionTotal+LaborCost+B24+B28+B29+B30+B31+B32+B39");
  estimate.getCell(41, 1).font = { bold: true, size: 14 };
  estimate.getCell(41, 2).font = { bold: true, size: 14 };
  estimate.getCell(41, 2).fill = HEADER_FILL;
  wb.definedNames.add("Estimate!$B$41", "TotalCost");
  eLine(42, "Less: rebates / incentives (CALeVIP etc.)", "-RebateAmt");
  eLine(43, "CUSTOMER TOTAL (after rebate)", "TotalCost-RebateAmt");
  estimate.getCell(43, 1).font = { bold: true, size: 12 };
  estimate.getCell(43, 2).font = { bold: true, size: 12 };
  wb.definedNames.add("Estimate!$B$43", "CustomerTotal");
  estimate.views = [{ state: "frozen", ySplit: 2 }];

  // ---------------------------------------------------------------- Peripherals
  // Itemized signage/protection + civil detail, mirroring the app engine's
  // Peripherals tab. Quantities derive from the Intake counts; unit costs
  // read the RateCard scalars (yellow there) or sit yellow here. The three
  // subtotals feed the Estimate: PeriphSignage → B12, PeriphCivil → B11,
  // PeriphAsphalt → B9's stall-paving term.
  [46, 12, 12, 14].forEach((w, i) => (periph.getColumn(i + 1).width = w));
  periph.getCell("A1").value = "Peripherals — signage, protection & civil detail (auto from Intake + RateCard)";
  periph.getCell("A1").font = { bold: true, size: 13 };
  periph.getCell("A2").value =
    "Quantities follow the Intake charger counts; edit rates on the RateCard (or the yellow cells below). Trench-cut asphalt prices on the Estimate; the asphalt here is stall patch-back only.";
  periph.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };

  const pLine = (
    row: number,
    name: string,
    qty: { formula: string } | number,
    unit: { formula: string } | number,
    opts?: { yellowQty?: boolean; yellowUnit?: boolean },
  ) => {
    periph.getCell(row, 1).value = name;
    periph.getCell(row, 2).value = typeof qty === "number" ? qty : { formula: qty.formula };
    if (opts?.yellowQty) periph.getCell(row, 2).fill = YELLOW;
    periph.getCell(row, 3).value = typeof unit === "number" ? unit : { formula: unit.formula };
    periph.getCell(row, 3).numFmt = MONEY;
    if (opts?.yellowUnit) periph.getCell(row, 3).fill = YELLOW;
    periph.getCell(row, 4).value = { formula: `B${row}*C${row}` };
    periph.getCell(row, 4).numFmt = MONEY;
  };
  const pSubtotal = (row: number, label: string, first: number, last: number, name: string) => {
    periph.getCell(row, 1).value = label;
    periph.getCell(row, 1).font = { bold: true };
    periph.getCell(row, 4).value = { formula: `SUM(D${first}:D${last})` };
    periph.getCell(row, 4).numFmt = MONEY;
    periph.getCell(row, 4).font = { bold: true };
    wb.definedNames.add(`Peripherals!$D$${row}`, name);
  };

  label(periph, 4, "SIGNAGE & PROTECTION", true);
  head(periph, 5, ["Item", "Qty", "Unit $", "Total"]);
  pLine(
    6,
    "Bollards (2/charger + 4-5 at switchgear + 3 at step-down/sub-panel)",
    { formula: "NTotal*BollardPerChg+IF(NDcfc>0,BollardAtGear,0)+IF(AND(NDcfc>0,NumL2>0),BollardAtStepdown,0)" },
    { formula: "BollardCost" },
  );
  pLine(7, "Signs", { formula: "NTotal" }, 40, { yellowUnit: true });
  pLine(8, "Sign posts", { formula: "NumL2+ROUNDUP(NDcfc/2,0)" }, 56.1, { yellowUnit: true });
  pLine(9, "Striping (per 10-stall lot)", { formula: "(NumL2*2+NDcfc)/10" }, 1500, { yellowUnit: true });
  pSubtotal(10, "Signage & protection subtotal", 6, 9, "PeriphSignage");

  label(periph, 12, "CONCRETE & CIVIL", true);
  head(periph, 13, ["Item", "Qty", "Unit $", "Total"]);
  // Pad volumes summed then rounded UP to whole yards the way the batch plant
  // sells them — calibrated so 5 DCFC pads + the switchgear pad + bollard
  // footings order 7 yd. L2 pads pour only on full-trench jobs; surface EMT
  // anchors to the existing slab (no pour).
  pLine(
    14,
    "Concrete order — 2500 PSI (yd, rounded up to whole yards)",
    {
      formula:
        'IF(InstallMethod="Surface EMT",0,CEILING(NDcfc*PadYdDcfc+IF(InstallMethod="Trenched",NumL2*PadYdL2,0)+IF(NDcfc>0,PadYdGear,0)+IF(AND(NDcfc>0,NumL2>0),PadYdXfmr,0)+B6*PadYdBollard,1))',
    },
    { formula: "ConcreteRate" },
  );
  pLine(15, "Concrete short-load fee (order < 8 yd)", { formula: "IF(AND(B14>0,B14<8),1,0)" }, { formula: "ShortLoadFee" });
  pLine(
    16,
    "Rebar (#4 mats — 3/DCFC pad, 2/L2 pad, 2/feeder)",
    {
      formula:
        'IF(InstallMethod="Surface EMT",0,NDcfc*3+IF(InstallMethod="Trenched",NumL2*2,0)+IF(AND(NDcfc>0,NumL2>0),3,IF(NTotal>0,1,0))*2)',
    },
    25.65,
    { yellowUnit: true },
  );
  pLine(17, "Forming & anchoring consumables — DCFC pads", { formula: "NDcfc" }, { formula: "ConsumDcfc" });
  pLine(18, "Forming & anchoring consumables — L2 pads", { formula: "NumL2" }, { formula: "ConsumL2" });
  pLine(19, "Wheel stops", { formula: "NTotal" }, 70.58, { yellowUnit: true });
  pLine(20, "Christy boxes (1 per 200 trench-ft)", { formula: "IF(TrenchFt>0,MAX(1,ROUNDUP(TrenchFt/200,0)),0)" }, 160, { yellowUnit: true });
  pLine(21, "GFI test (service > 1000A)", { formula: "IF(NDcfc>0,IF(SgSuggested>1000,1,0),0)" }, 2000, { yellowUnit: true });
  pLine(22, "Plywood (manual count)", 0, 55, { yellowQty: true, yellowUnit: true });
  pLine(23, "2x4 lumber (manual count)", 0, 10, { yellowQty: true, yellowUnit: true });
  pLine(24, "Sono tubes (manual count)", 0, 19, { yellowQty: true, yellowUnit: true });
  pSubtotal(25, "Civil subtotal (feeds Estimate B11)", 14, 24, "PeriphCivil");

  label(periph, 27, "ASPHALT — STALL PATCH-BACK", true);
  head(periph, 28, ["Item", "Qty (SF)", "Unit $", "Total"]);
  pLine(
    29,
    "Asphalt paving — parking stalls (2 stalls/L2, 1/DCFC × SF/stall)",
    { formula: 'IF(InstallMethod="Surface EMT",0,(NumL2*2+NDcfc)*StallSqFt)' },
    { formula: "AsphaltRate" },
  );
  wb.definedNames.add("Peripherals!$D$29", "PeriphAsphalt");
  periph.getCell(30, 1).value =
    "Feeds the Estimate's trenching/asphalt row (B9). Overtype the qty formula with surveyed SF when the patch limits are drawn.";
  periph.getCell(30, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  periph.views = [{ state: "frozen", ySplit: 2 }];

  // ------------------------------------------------------------ Costs Internal
  // The RFC_V18 presentation view of the Estimate: same layout as the source
  // workbooks (Hoopa D-00025). Rows re-slice the Estimate lines into the
  // shop's categories — G15 ties to ConstructionTotal, G18 to LaborCost,
  // G20 to the permit Valuation.
  fillCostsInternal(costsInternal, {
    lines: [
      { formula: "Estimate!B7+Estimate!B10" }, // Wires, Conduits and Peripherals ← make-ready + EMT strut supports
      { formula: `Panel!F${PNL_SG_ROW + 1}` }, // Main Distribution Switchgear
      { formula: `Panel!F${PNL_PNL_ROW + 2}+Panel!F${PNL_TX_ROW + 1}+Panel!F${PNL_BB_TOTAL}` }, // Sub-panels, transformers, breakers
      { formula: "Estimate!B12" }, // Bollards, Signage ← signage/striping/bollards
      { formula: "Estimate!B9" }, // Asphalt, Paving, and Striping ← trenching
      { formula: "Estimate!B11" }, // Concrete Improvements ← civil
      { formula: "Estimate!B13" }, // ADA
      { formula: "Estimate!B14" }, // Dump/ Waste ← spoils haul-off
      { formula: "Estimate!B17" }, // Permits ← AHJ issuance
      { formula: "Estimate!B18+Estimate!B15" }, // Utility ← application + pad + GPR scan
      { formula: "Estimate!B16" }, // Construction Equipment ← rentals
    ],
    contingency: { formula: "ContingencyPct" },
    laborContingency: { formula: "ContingencyPct" },
    // Blended daily rate: with an itemized labor breakdown on the Intake the
    // sheet's rate × days × contingency chain still equals LaborBase loaded.
    dailyRate: { formula: "IF(LaborDays>0,LaborBase/LaborDays,0)" },
    businessDays: { formula: "LaborDays" },
    // Design invoice minus the AHJ plan check (B38, permitting-side):
    // site plan + SLD + CPM hours × rate.
    constructionPm: { formula: "Estimate!B35+Estimate!B36+Estimate!B37" },
  });

  // ------------------------------------------------------------------ ADA
  // CBC 11B-228.3.2: "Each combination of charging level and EV connector
  // type … shall be considered as a facility" — the table runs separately
  // for L2 and DCFC, then the site total is the SUM of the two lookups.
  [34, 12, 10, 12, 12, 10, 40].forEach((w, i) => (ada.getColumn(i + 1).width = w));
  ada.getCell("A1").value = "Accessible EVCS — CBC 11B-228.3 / 11B-812 (auto from Intake)";
  ada.getCell("A1").font = { bold: true, size: 13 };
  ada.getCell("A2").value =
    "Each charging level (L2, DCFC) counts as its own facility per 11B-228.3.2 — the table below runs once per level, then sums.";
  ada.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };

  head(ada, 3, ["Facility (charging level)", "Chargers", "Van", "Standard", "Ambulatory", "Total"]);
  const adaLevel = (row: number, name: string, countFormula: string) => {
    ada.getCell(row, 1).value = name;
    ada.getCell(row, 2).value = { formula: countFormula };
    ada.getCell(row, 3).value = {
      formula: `IF($B$${row}<=0,0,IF($B$${row}<=100,1,1+ROUNDUP(($B$${row}-100)/300,0)))`,
    };
    ada.getCell(row, 4).value = {
      formula: `IF($B$${row}<=4,0,IF($B$${row}<=50,1,IF($B$${row}<=75,2,IF($B$${row}<=100,3,3+ROUNDUP(($B$${row}-100)/60,0)))))`,
    };
    ada.getCell(row, 5).value = {
      formula: `IF($B$${row}<=25,0,IF($B$${row}<=50,1,IF($B$${row}<=75,2,IF($B$${row}<=100,3,3+ROUNDUP(($B$${row}-100)/50,0)))))`,
    };
    ada.getCell(row, 6).value = { formula: `C${row}+D${row}+E${row}` };
  };
  adaLevel(4, "Level 2 (208/240V AC)", "NumL2");
  adaLevel(5, "Level 3 / DCFC", "NDcfc");
  ada.getCell(6, 1).value = "SITE TOTAL (sum of facilities)";
  ada.getCell(6, 1).font = { bold: true };
  ada.getCell(6, 2).value = { formula: "NTotal" };
  ada.getCell(6, 3).value = { formula: "C4+C5" };
  ada.getCell(6, 4).value = { formula: "D4+D5" };
  ada.getCell(6, 5).value = { formula: "E4+E5" };
  ada.getCell(6, 6).value = { formula: "C6+D6+E6" };
  for (let c = 2; c <= 6; c++) ada.getCell(6, c).font = { bold: true };

  // Quantity overrides — same as the website's Peripherals ADA section: type
  // a count to replace the code minimum (surveyed sites, AHJ agreements);
  // clear the cell to go back to auto. The cost row uses the USED counts.
  ada.getCell(7, 1).value = "Override quantities (blank = code minimum)";
  for (const c of [3, 4, 5]) {
    ada.getCell(7, c).fill = YELLOW;
    ada.getCell(7, c).border = { bottom: { style: "thin" } };
  }
  ada.getCell(8, 1).value = "STALLS USED (override, else code)";
  ada.getCell(8, 1).font = { bold: true };
  ada.getCell(8, 3).value = { formula: "IF(ISNUMBER(C7),C7,C6)" };
  ada.getCell(8, 4).value = { formula: "IF(ISNUMBER(D7),D7,D6)" };
  ada.getCell(8, 5).value = { formula: "IF(ISNUMBER(E7),E7,E6)" };
  ada.getCell(8, 6).value = { formula: "C8+D8+E8" };
  for (let c = 3; c <= 6; c++) ada.getCell(8, c).font = { bold: true };
  wb.definedNames.add("ADA!$C$8", "AdaVan");
  wb.definedNames.add("ADA!$D$8", "AdaStd");
  wb.definedNames.add("ADA!$E$8", "AdaAmb");

  label(ada, 9, "Terrain regrade factor (2% slope rule)");
  ada.getCell(9, 2).value = { formula: "VLOOKUP(Terrain,TerrainTable,4,FALSE)" };
  label(ada, 10, "ADA construction cost", true);
  ada.getCell(10, 2).value = {
    formula:
      "(AdaVan*AdaVanCost+AdaStd*AdaStdCost+AdaAmb*AdaAmbCost)*VLOOKUP(Terrain,TerrainTable,4,FALSE)+IF(NTotal>0,AdaRampCost,0)",
  };
  ada.getCell(10, 2).numFmt = MONEY;
  wb.definedNames.add("ADA!$B$10", "AdaCost");

  ada.getCell(13, 1).value =
    "CBC Table 11B-228.3.2.1 — applied PER FACILITY (per charging level), not to the combined count (van divisor 300 per 2022/2025 CBC; verify with your AHJ):";
  ada.getCell(13, 1).font = { bold: true };
  const codeTable = [
    ["EVCS per facility", "Van", "Standard", "Ambulatory"],
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
    "11B-228.3.2: each charging level AND connector type is a separate facility — mixing CCS + NACS on one power level can add facilities; verify with the AHJ.",
    "Slope ≤ 2% in every direction under stalls and aisles — regrading is the big cost on sloped lots.",
    "EVCS markings must NOT be blue (11B-812.9); stencil 'EV CHARGING ONLY' in 12-in letters.",
    "ISA signs (per facility): none if ≤4 EVCS; van space only for 5-25; all van + standard for 26+. Never on ambulatory.",
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
    ["1. Yellow cells are the only inputs. Intake top-to-bottom: your details, client & program IDs, chargers (every L3 size in", false],
    ["   Single and Dual-port; L2 at 32/40/80A per port, Single and Dual), separate L3 / L2 site distances, WIRE RUNS & FEEDERS,", false],
    ["   labor days, services, commercial terms. Totals show at the bottom of the Intake.", false],
    [`2. CHARGERS: ${N_CH} lines (model × qty). TAKEOFF SHEET: one row per INDIVIDUAL charger — L2 and L3 — with its own`, false],
    ["   yellow wire size, material, runs and one-way ft. Defaults fill from the Intake line + the distance ladder; overtype the", false],
    ["   surveyed length (or a different size) per charger and the wire $ reprices straight into the Estimate — same as the", false],
    ["   website's Takeoff tab. The Intake's WIRE RUNS block holds each line's DEFAULTS plus the three service feeders; its", false],
    ["   Wire $ column reads the Takeoff rows back, so nothing double-counts. On long runs, extra parallel runs split the", false],
    ["   amps so each set can use smaller wire — often cheaper than one fat conductor.", false],
    ["   BREAKER COLUMN (col I): overrides the model's breaker for that line — flows into the Panel sheet's branch-breaker", false],
    ["   pricing and both plan-set schedules. NEC 625.41 wants ≥125% of continuous amps; the template does not police it.", false],
    ["   LABOR BREAKDOWN: itemize by role/phase (foreman, crew, flagger…); the total feeds the estimate, contingency-loaded.", false],
    [`   INSTALL METHOD (Intake B${SITE + 5}): 'Trenched' = underground PVC (the classic outdoor lot). 'Surface EMT' = garage install on`, false],
    ["   strut trapeze racks every 10 ft (NEC 358.30) — zero trenching, racks/straps priced on the Estimate, install allowance", false],
    ["   switches to the EMT column, dig-gear rentals swap for a scissor lift. 'Hybrid' = chargers in EMT inside the structure,", false],
    [`   trench only the utility → switchgear service section (feeder lengths, rows ${FDR_FIRST}-${FDR_FIRST + 2}).`, false],
    [`   PANEL SHEET OVERRIDES: type a size in the yellow D-cells (D${PNL_SG_ROW} switchgear, D${PNL_PNL_ROW} panel, D${PNL_TX_ROW} transformer) to force gear one`, false],
    ["   frame up/down — the primary breaker, Intake feeder runs and prices all re-derive. Clear the cell to go back to auto.", false],
    ["   ADA SHEET OVERRIDES: row 7 yellow cells replace the code-minimum stall counts (like the website's Peripherals tab);", false],
    ["   utility/permit fee rates (PermitBase, PermitPerChg, UtilAppDcfc, UtilAppL2) are yellow scalars on the RateCard.", false],
    ["   PERIPHERALS SHEET: itemized bollards (2/charger + 4-5 at switchgear + 3 at step-down/sub-panel), concrete order rounded", false],
    ["   up to whole yards (2500 PSI ConcreteRate + ShortLoadFee on the RateCard), asphalt stall patch-back (AsphaltRate $/SF),", false],
    ["   forming consumables per pad, rebar, wheel stops. Its subtotals feed Estimate rows 9/11/12 — edit rates, not formulas.", false],
    ["3. Every price lives on the RateCard (yellow) — hardware, install allowance, gear catalog, wire $/ft (incl. 450 kcmil Cu & Al),", false],
    ["   labor, tax, contingency. Change there, everything follows.", false],
    ["4. Costs Internal shows the estimate in the RFC_V18 layout (cell-for-cell Hoopa D-00025). Panel 480V / 208V are plan-set", false],
    ["   style schedules ready for the drawing set. Grid capacity: 16 circuits @480V / 24 @208V.", false],
    ["", false],
    ["FOLDED IN FROM THE REAL RFC_V18 WORKBOOKS (VN Village, Boatman, CCMH, Hoopa, Bartell)", true],
    ["• Costs Internal → Summary structure: per-line contingency, labor loaded with contingency, sales tax on construction and on chargers.", false],
    ["• Hoopa proposal extras: EVOLV network fees ($39.99/port/mo × contract), service plans, hardware price factor, rebate line.", false],
    ["• Intake carries the incentive program + application ID (CALeVIP / CEC style: D-00025, H-01007, I-271839…).", false],
    ["", false],
    ["WHAT THIS TEMPLATE IS", true],
    ["A budgetary intake + estimate (±15% vs the RFC Estimator app). Install allowances are engine-calibrated per charger; gear and", false],
    ["wire are priced live. For the engineered takeoff — exact NEC sizes, vendor BOM — use the web app's '⬇ Excel' export.", false],
    ["", false],
    ["KEY ASSUMPTIONS (2025-26 CA market, sources on file)", true],
    ["• Buses, breakers and the transformer size at 125% of connected input amps (NEC 625 continuous loads), matching the app.", false],
    ["• Terrain multipliers: trenching ×1.2 sloped / ×1.5 hilly / ×2.5 rocky; ADA regrade ×1.4/×1.7/×1.8 (2% slope rule). Solid rock: quote.", false],
    ["• ADA per CBC 11B-228.3: L2 and DCFC count as SEPARATE facilities — the stall table runs once per level, then sums (see ADA sheet).", false],
    ["• ADA stall rates: van $6.5k, standard $4.9k (shop bid rate), ambulatory $3.5k flat-lot, ramp $5.2k. Markings must NOT be blue.", false],
    ["• Surface EMT: strut trapeze $28 + $3.25/strap per pipe per rack (every 10 ft, NEC 358.30); EMT hangs ~100 route-ft/crew-day.", false],
    ["   Open-air decks are damp/wet locations — swap set-screw fittings for listed raintight compression (≈2-3× price) per 358.42.", false],
    ["• Permits: L2-only = streamlined flat fees (AB 1236); DCFC = plan check ≈ 2% of construction valuation + issuance + utility fees.", false],
    ["• Design: site plan $2.5k + $150/charger (+$1k DCFC); SLD $6k + $900/DCFC + $150/L2 (PE). CPM = 5% of construction at $358/h.", false],
    ["• 450 kcmil: ampacity and the Al $/ft are interpolated (not NEC 310.16 / not on the vendor list) — verify before quoting.", false],
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
    ["L2-only 8xDual40", bareInput({ lines: [{ loadTypeId: "L2 Dual 40A", count: 8 }] })],
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

  // Surface-EMT sanity: engine must zero the trench and carry strut racks.
  {
    const p = buildQuickProject(
      bareInput({ lines: [{ loadTypeId: "L2 Dual 40A", count: 8 }], installMethod: "surface" }),
      defaultProject(),
      "chk",
    );
    const r = computeEstimate(p);
    const racks = r.peripherals.lines.hardware.find((h) => h.name.startsWith("Strut trapeze"))?.qty ?? 0;
    const ok = r.peripherals.asphaltTrenching === 0 && racks > 0 && p.setup.conduitType === "EMT";
    console.log(
      `${ok ? "PASS" : "FAIL"} surface EMT: trench $${r.peripherals.asphaltTrenching}, ${racks} strut racks, conduit ${p.setup.conduitType}`,
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
  // Two trench legs now — one per charger level (RunFtDcfc / RunFtL2 defaults).
  const trench = (100 + 15 * (nD - 1)) + (100 + 15 * (nL - 1));
  const t = TERRAIN_INFO.flat;
  const laborDays = Math.ceil((8 + 2.5 * nD + nL + trench / 40) * t.laborFactor);
  // Mirror the Wire Runs block defaults exactly as the template formulas do.
  const wireRow = (size: string) => WIRE_TABLE.find((w) => w.size === size)!;
  const pricePerFt = (size: string, mat: string) => (mat === "Cu" ? wireRow(size).cuPerFt : wireRow(size).alPerFt);
  // Each level sequences from its own first-run distance (priors are per-level,
  // and the default intake has one line per level, so priors are 0 here).
  let chargerWire = 0;
  for (const { id, cnt } of [{ id: "DCFC 200kW", cnt: 6 }, { id: "L2 Single 40A", cnt: 5 }]) {
    const m = models.find((x) => x.lt.id === id)!;
    const ft = 100 + 15 * ((cnt - 1) / 2);
    chargerWire += cnt * m.lt.runsPerUnit * m.lt.conductorsPerRun * ft * pricePerFt(m.defaultWire, m.defaultMaterial);
  }
  const txConnKvaM = (5 * 40 * 208 * SQRT3) / 1000;
  const txKvaM = nextSizeCountif(TX_TABLE.map((x) => x[0]), txConnKvaM * 1.25);
  const f13 = 6 * 265 + (txConnKvaM * 1000) / (480 * SQRT3);
  const svcRuns = Math.max(1, Math.ceil((f13 * 1.25) / wireRow("600 kcmil").ampacityAl));
  const f37 = (txKvaM * 1000) / (480 * SQRT3);
  const sgTxRuns = Math.max(1, Math.ceil((f37 * 1.25) / wireRow("4/0 AWG").ampacityAl));
  const secFla = (txKvaM * 1000) / (208 * SQRT3);
  const txPnlRuns = Math.max(1, Math.ceil((secFla * 1.25) / wireRow("350 kcmil").ampacityAl));
  const wireMirror =
    chargerWire +
    svcRuns * 4 * 25 * pricePerFt("600 kcmil", "Al") +
    sgTxRuns * 4 * 15 * pricePerFt("4/0 AWG", "Al") +
    txPnlRuns * 4 * 15 * pricePerFt("350 kcmil", "Al");
  const install =
    6 * models.find((m) => m.lt.id === "DCFC 200kW")!.install +
    5 * models.find((m) => m.lt.id === "L2 Single 40A")!.install;
  // Per-level ADA (CBC 11B-228.3.2): 6 DCFC → 1 van + 1 std; 5 L2 → 1 van + 1 std.
  const adaCost = (2 * ADA_UNIT_COST.van + 2 * ADA_UNIT_COST.standard) * t.adaRegradeFactor + ADA_UNIT_COST.ramp;
  // Peripherals-sheet mirror: bollards 2/charger + 4 at gear + 3 at the
  // step-down pad; concrete order = pad volumes rounded up to whole yards;
  // 3 chain legs on a mixed-voltage trench job; GFI fires (SG > 1000A here).
  const bollardsM = n * 2 + 4 + 3;
  const concreteYdM = Math.ceil(nD * 0.75 + nL * 0.35 + 1.75 + 0.5 + bollardsM * 0.08);
  const civilMirror =
    concreteYdM * 165 + (concreteYdM > 0 && concreteYdM < 8 ? 125 : 0) +
    (nD * 3 + nL * 2 + 3 * 2) * 25.65 +
    nD * 550 + nL * 275 +
    n * 70.58 +
    Math.max(1, Math.ceil(trench / 200)) * 160 +
    2000;
  const signageMirror = n * 40 + (nL + Math.ceil(nD / 2)) * 56.1 + bollardsM * 110 + ((nL * 2 + nD) / 10) * 1500;
  const asphaltStallsM = (nL * 2 + nD) * 162 * 5;
  const constr =
    install + wireMirror + gearMirror + trench * 40.81 * t.trenchFactor + asphaltStallsM +
    civilMirror + signageMirror +
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
