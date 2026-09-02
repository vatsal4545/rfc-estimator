// Business-model sheets for the Excel export — the Best Western workbook's
// Utility_Rates, Revenue, Carbon, Financing, Cashflow and Business_Model
// (deal structure) sheets, rebuilt on top of the Cost Buildup / Business
// Model sheets with live formulas and cached results. Yellow cells are the
// model's inputs; change a retail price, a rate or a share and every sheet
// downstream recalculates in Excel, exactly as in the app.
//
// Appended only when the project carries a commercial section.

import type ExcelJS from "exceljs";
import type { EstimateResult, Project } from "./calc/types";
import type { ProposalSheetRefs } from "./exportProposal";
import { computeProposal } from "./proposal";
import type { ModelResult } from "./proposal/types";

const MONEY = '"$"#,##0.00';
const PCT = "0.00%";
const RATE = '"$"0.0000';
const KWH = "#,##0";
const YELLOW: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6DD" } };
const HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF5" } };

type WS = ExcelJS.Worksheet;

/** Formula with a cached result. Money rounds to cents; rates, factors and kWh keep more. */
function f(formula: string, result: number | string, digits = 2): ExcelJS.CellFormulaValue {
  const r = typeof result === "number" ? Math.round(result * Math.pow(10, digits)) / Math.pow(10, digits) : result;
  return { formula, result: r };
}

function title(ws: WS, text: string, note: string): void {
  ws.getCell("A1").value = text;
  ws.getCell("A1").font = { bold: true, size: 12 };
  ws.getCell("A2").value = note;
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };
}

function header(ws: WS, row: number, labels: string[]): void {
  labels.forEach((label, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = label;
    cell.font = { bold: true, size: 10 };
    cell.fill = HEADER;
    cell.border = { bottom: { style: "thin" } };
  });
}

function input(ws: WS, row: number, label: string, value: ExcelJS.CellValue, fmt?: string, note?: string): void {
  ws.getCell(row, 1).value = label;
  const cell = ws.getCell(row, 2);
  cell.value = value;
  if (fmt) cell.numFmt = fmt;
  cell.fill = YELLOW;
  if (note) {
    ws.getCell(row, 3).value = note;
    ws.getCell(row, 3).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  }
}

function derived(ws: WS, row: number, label: string, value: ExcelJS.CellValue, fmt?: string, note?: string): void {
  ws.getCell(row, 1).value = label;
  const cell = ws.getCell(row, 2);
  cell.value = value;
  if (fmt) cell.numFmt = fmt;
  if (note) {
    ws.getCell(row, 3).value = note;
    ws.getCell(row, 3).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  }
}

function listValidation(ws: WS, addr: string, options: string[]): void {
  ws.getCell(addr).dataValidation = { type: "list", allowBlank: false, formulae: [`"${options.join(",")}"`] };
}

const POLICY_TEXT = { ramped: "Ramped to projected demand", nameplate: "Fixed at full nameplate", manual: "Fixed at the manual level" } as const;
const SHARE_BASIS_TEXT = { profit: "Net charging profit", gross: "Gross revenue" } as const;

/** Row anchors shared across the sheets. */
interface Anchors {
  n: number; // horizon years
  revYear: (t: number) => number; // Revenue!row for year t
  urYear: (t: number) => number; // 'Utility Rates'!row for year t
  carbonYear: (t: number) => number;
}

const REV_TABLE_HDR = 37;
const UR_TABLE_HDR = 32;
const CARBON_TABLE_HDR = 19;

export function fillModelSheets(wb: ExcelJS.Workbook, project: Project, result: EstimateResult, refs: ProposalSheetRefs): void {
  const proposal = computeProposal(project, result);
  if (!proposal) return;
  const m = proposal.model;
  const a: Anchors = {
    n: m.revenue.years.length,
    revYear: (t) => REV_TABLE_HDR + t,
    urYear: (t) => UR_TABLE_HDR + t,
    carbonYear: (t) => CARBON_TABLE_HDR + t,
  };
  const ur = wb.addWorksheet("Utility Rates");
  const rev = wb.addWorksheet("Revenue");
  const carbon = wb.addWorksheet("Carbon");
  const fin = wb.addWorksheet("Financing");
  const cash = wb.addWorksheet("Cashflow");
  const deal = wb.addWorksheet("Deal Structure");
  fillRevenue(rev, m, a);
  fillUtilityRates(ur, m, a);
  fillCarbon(carbon, m, a, refs);
  fillFinancing(fin, m, refs);
  fillCashflow(cash, m, a);
  fillDeal(deal, m, a, refs);
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

function fillRevenue(ws: WS, m: ModelResult, a: Anchors): void {
  [44, 16, 14, 14, 14, 16, 16, 14, 18, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  title(
    ws,
    "Revenue — utilisation, energy, charging profit",
    "Stall-hours, then energy, then money; the taper is applied before anything is counted. Yellow cells are the assumptions the customer will challenge. Hours and days come from the Intake tab.",
  );
  const r = m.inputs.revenue;
  const u = m.usage;
  const ctx = m.context;
  input(ws, 4, "Retail price to driver ($/kWh)", r.retailPerKwh, RATE);
  input(ws, 5, "Card processing fee (share of gross)", r.cardFeePct, PCT);
  input(ws, 6, "Hours per day the site is chargeable", ctx.hoursPerDay, "0", "From the Intake tab");
  input(ws, 7, "Days per year", ctx.daysPerYear, "0");
  input(ws, 8, "Stall occupancy (share of stalls used per day)", r.stallOccupancy, PCT);
  input(ws, 9, "Charging hours per occupied stall (share of open hours)", r.chargingHoursShare, PCT);
  input(ws, 10, "Nameplate de-rate factor", r.deratingFactor, "0.00", "Cabinet output vs label");
  input(ws, 11, "Charging-curve taper (average delivered power, share of rating)", r.taperFactor, "0.00");
  input(ws, 12, "Year 1 share of steady state", r.rampYear1, PCT);
  input(ws, 13, "Year 2 share of steady state", r.rampYear2, PCT);
  input(ws, 14, "Year 3 share of steady state", r.rampYear3, PCT);
  input(ws, 15, "Annual growth after ramp", r.growthAfterRamp, PCT, "Justify as a level, not a rate");
  input(ws, 17, "DC charging positions", ctx.dcPositions, "0", "From the equipment schedule");
  input(ws, 18, "DC nameplate (kW)", ctx.dcNameplateKw, "#,##0.0", "The LCFS capacity-credit basis");
  input(ws, 19, "Level 2 positions", ctx.l2Positions, "0");
  input(ws, 20, "Nameplate kW per Level 2 position", ctx.l2KwPerPosition, "0.000");
  input(ws, 21, "Service contract length (years)", ctx.contractYears, "0", "Commercial tab");
  input(ws, 22, "Warranty + service after the contract ($/yr)", ctx.annualServiceAfterContract, MONEY, "Units × the year-3 class rate");
  input(ws, 23, "Network fee after the contract ($/yr)", ctx.annualNetworkFee, MONEY, "Ports × $/port/month × 12");

  ws.getCell(24, 1).value = "Steady-state projection";
  ws.getCell(24, 1).font = { bold: true };
  derived(ws, 25, "Power per DC position (kW)", f("IF($B$17=0,0,$B$18*$B$10/$B$17)", u.dc.powerPerPosition, 6), "#,##0.00", "Nameplate ÷ positions × de-rate");
  derived(ws, 26, "Average delivered power (kW)", f("$B$25*$B$11", u.dc.avgDeliveredKw, 6), "#,##0.00", "De-rated, then tapered");
  derived(ws, 27, "DC charging stall-hours per day", f("$B$17*$B$8*$B$6*$B$9", u.dc.stallHoursPerDay, 6), "#,##0.00");
  derived(ws, 28, "DC kWh per day", f("$B$27*$B$26", u.dc.kwhPerDay, 6), "#,##0.0");
  derived(ws, 29, "Power per Level 2 position (kW)", f("$B$20*$B$10", u.l2.powerPerPosition, 6), "0.000");
  derived(ws, 30, "Level 2 kWh per day", f("$B$19*$B$8*$B$6*$B$9*$B$29*$B$11", u.l2.kwhPerDay, 6), "#,##0.0", "Same occupancy, hours and taper as the DC stream");
  derived(ws, 31, "Site kWh per day, both streams", f("$B$28+$B$30", u.siteKwhPerDay, 6), "#,##0.0");
  derived(ws, 32, "Site kWh per year", f("$B$31*$B$7", u.siteKwhPerYear, 4), KWH);
  derived(ws, 33, "DC kWh per year", f("$B$28*$B$7", u.dc.kwhPerYear, 4), KWH);
  derived(ws, 34, "Level 2 kWh per year", f("$B$30*$B$7", u.l2.kwhPerYear, 4), KWH);

  header(ws, REV_TABLE_HDR, ["Year", "Ramp", "kWh", "DC kWh", "L2 kWh", "Gross revenue", "Utility cost", "Card fees", "Service & network", "Charging profit"]);
  for (let t = 1; t <= a.n; t++) {
    const row = a.revYear(t);
    const y = m.revenue.years[t - 1];
    const usage = m.usage.years[t - 1];
    ws.getCell(row, 1).value = t;
    const rampF = t === 1 ? "$B$12" : t === 2 ? "$B$13" : t === 3 ? "$B$14" : `$B$14*(1+$B$15)^${t - 3}`;
    ws.getCell(row, 2).value = f(rampF, y.ramp, 8);
    ws.getCell(row, 3).value = f(`D${row}+E${row}`, y.kwh, 4);
    ws.getCell(row, 4).value = f(`$B$33*B${row}`, usage.dcKwh, 4);
    ws.getCell(row, 5).value = f(`$B$34*B${row}`, usage.l2Kwh, 4);
    ws.getCell(row, 6).value = f(`C${row}*$B$4`, y.grossRevenue);
    ws.getCell(row, 7).value = f(`C${row}*'Utility Rates'!$B$22+'Utility Rates'!M${a.urYear(t)}`, y.utilityCost);
    ws.getCell(row, 8).value = f(`F${row}*$B$5`, y.cardFees);
    ws.getCell(row, 9).value = f(`IF(A${row}>$B$21,$B$22+$B$23,0)`, y.serviceAndNetwork);
    ws.getCell(row, 10).value = f(`F${row}-G${row}-H${row}-I${row}`, y.chargingProfit);
    ws.getCell(row, 2).numFmt = PCT;
    for (const col of [3, 4, 5]) ws.getCell(row, col).numFmt = KWH;
    for (const col of [6, 7, 8, 9, 10]) ws.getCell(row, col).numFmt = MONEY;
  }
  const first = a.revYear(1);
  const last = a.revYear(a.n);
  const tot = last + 1;
  ws.getCell(tot, 1).value = `${a.n}-year total`;
  ws.getCell(tot, 1).font = { bold: true };
  const sumCol = (col: string, pick: (y: (typeof m.revenue.years)[number]) => number) => f(`SUM(${col}${first}:${col}${last})`, m.revenue.years.reduce((s, y) => s + pick(y), 0));
  ws.getCell(tot, 3).value = f(`SUM(C${first}:C${last})`, m.revenue.years.reduce((s, y) => s + y.kwh, 0), 4);
  ws.getCell(tot, 6).value = sumCol("F", (y) => y.grossRevenue);
  ws.getCell(tot, 7).value = sumCol("G", (y) => y.utilityCost);
  ws.getCell(tot, 8).value = sumCol("H", (y) => y.cardFees);
  ws.getCell(tot, 9).value = sumCol("I", (y) => y.serviceAndNetwork);
  ws.getCell(tot, 10).value = sumCol("J", (y) => y.chargingProfit);
  ws.getCell(tot, 3).numFmt = KWH;
  for (const col of [6, 7, 8, 9, 10]) {
    ws.getCell(tot, col).numFmt = MONEY;
    ws.getCell(tot, col).font = { bold: true };
  }

  // Market cross-check.
  const b = m.revenue.benchmark;
  let n = tot + 3;
  ws.getCell(n, 1).value = "Market benchmarking";
  ws.getCell(n, 1).font = { bold: true };
  n++;
  input(ws, n, "State for benchmarking", b.state, undefined, "lib/ref/benchmarks — Paren, US EV Fast Charging Q2 2026");
  n++;
  input(ws, n, "Benchmark port utilisation (time-based)", b.benchmarkUtilisation ?? 0, PCT);
  const utilRow = n;
  n++;
  input(ws, n, "Benchmark price to driver ($/kWh)", b.benchmarkPricePerKwh ?? 0, RATE);
  const priceRow = n;
  n++;
  derived(ws, n, "kWh/day if the site ran at benchmark", f(`$B$17*24*$B$${utilRow}*$B$26`, b.kwhPerDayAtBenchmark ?? 0, 4), "#,##0.0", "What an average port in this state delivers");
  const bmKwhRow = n;
  n++;
  derived(ws, n, "Site factor — this model as a share of benchmark", f(`IF($B$${bmKwhRow}=0,0,$B$28/$B$${bmKwhRow})`, b.siteFactor ?? 0, 6), PCT, "A new site should not be modelled at the state average");
  n++;
  derived(ws, n, "Retail price against the state average", f(`IF($B$${priceRow}=0,0,$B$4/$B$${priceRow}-1)`, b.priceVsMarket ?? 0, 6), PCT, "Positive means we price above the market");
  n++;
  input(ws, n, "Market's implied per-port growth", b.impliedMarketGrowth, PCT, "Sessions growth net of new supply");
  const growthRow = n;
  n++;
  derived(
    ws,
    n,
    "Model against market",
    f(`IF($B$15<=$B$${growthRow},"Conservative — below the market's implied per-port growth","ABOVE the market's implied per-port growth — justify it")`, b.growthVerdict),
  );
  ws.views = [{ state: "frozen", ySplit: 3 }];
}

// ---------------------------------------------------------------------------
// Utility Rates
// ---------------------------------------------------------------------------

function fillUtilityRates(ws: WS, m: ModelResult, a: Anchors): void {
  [44, 16, 14, 12, 12, 14, 16, 10, 16, 16, 16, 16, 16, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  title(
    ws,
    "Utility Rates — the bill, decomposed, and the demand ramp",
    "One row per component of the bill, so a demand charge cannot hide inside a blended cents-per-kWh figure. The subscription follows the demand ramp year by year; a site that fills gradually should not carry a full-nameplate subscription from day one.",
  );
  const t = m.tariff;
  const ti = m.inputs.tariff;
  derived(ws, 4, "Utility", t.utility || "—");
  derived(ws, 5, "Rate schedule", t.schedule || "—");
  derived(ws, 6, "Basis", t.basis === "library" ? "Rate library" : "Manual");
  derived(ws, 7, "Rate data status", t.status, undefined, /^VERIFIED|^MANUAL/i.test(t.status) ? "" : "Verify against the tariff book before issuing a proposal");
  ws.getCell(8, 1).value = "Tariff figures";
  ws.getCell(8, 1).font = { bold: true };
  input(ws, 9, "Peak $/kWh", t.rates.peakPerKwh, RATE);
  input(ws, 10, "Off-peak $/kWh", t.rates.offPeakPerKwh, RATE);
  input(ws, 11, "Super off-peak $/kWh", t.rates.superOffPeakPerKwh, RATE, "0 when the schedule has no third period");
  input(ws, 12, "Customer charge ($/month)", t.rates.customerPerMonth, MONEY, "The fixed monthly meter charge");
  input(ws, 13, "Demand charge ($/kW-month)", t.rates.demandPerKwMonth, MONEY, "Zero on a schedule with no demand charge");
  input(ws, 14, "Subscription block size (kW)", t.rates.blockKw, "0", "Zero means no blocks are sold");
  input(ws, 15, "Subscription block price ($/block/month)", t.rates.blockPerMonth, MONEY);
  input(ws, 16, "Overage rate ($/kW)", t.rates.overagePerKw, MONEY, "Charged on demand above the subscribed level");
  ws.getCell(17, 1).value = "Time-of-use mix — share of energy dispensed in each period";
  ws.getCell(17, 1).font = { bold: true };
  input(ws, 18, "Peak share", t.touShares.peak, PCT, t.isFlat ? "Flat schedule — 100% at the single rate" : "");
  input(ws, 19, "Off-peak share", t.touShares.offPeak, PCT);
  input(ws, 20, "Super off-peak share", t.touShares.superOffPeak, PCT);
  derived(ws, 21, "Mix check", f('IF(ABS($B$18+$B$19+$B$20-1)<0.0001,"OK — sums to 100%","MUST SUM TO 100%")', "OK — sums to 100%"));
  derived(ws, 22, "Blended volumetric $/kWh", f("$B$9*$B$18+$B$10*$B$19+$B$11*$B$20", t.blendedPerKwh, 6), RATE, "Weighted by the mix above");
  ws.getCell(23, 1).value = "Demand subscription";
  ws.getCell(23, 1).font = { bold: true };
  input(ws, 24, "Subscription policy", POLICY_TEXT[ti.subscriptionPolicy], undefined, "How the subscription is set each year");
  listValidation(ws, "B24", Object.values(POLICY_TEXT));
  input(ws, 25, "Peak-to-average concurrency factor", ti.peakToAverageFactor, "0.0", "Ratio of peak simultaneous draw to the daily average");
  input(ws, 26, "Safety margin on subscribed kW", ti.safetyMarginPct, PCT, "Headroom above projected peak before overage bites");
  input(ws, 27, "Size demand on the full port rating? (Yes / No)", ti.sizeDemandOnFullRating ? "Yes" : "No", undefined, "A vehicle at the start of a session draws full power");
  listValidation(ws, "B27", ["Yes", "No"]);
  input(ws, 28, "Manual subscribed kW", ti.manualSubscribedKw, "#,##0.0", "Used by the manual policy");
  input(ws, 29, "Connected nameplate (kW)", t.nameplateKw, "#,##0.0", "DC nameplate plus Level 2 — the full-nameplate policy");
  input(ws, 30, "Demand charge bills from year", ti.demandChargeFromYear, "0", "SCE facilities-related demand charges resume 1 Jan 2030");

  header(ws, UR_TABLE_HDR, [
    "Year", "kWh dispensed", "kWh/day", "Avg concurrent ports", "Peak concurrent ports", "Peak demand kW", "Subscribed kW", "Blocks",
    "Subscription $/yr", "Demand charge $/yr", "Customer charge $/yr", "Energy $/yr", "Fixed & demand $/yr", "All-in $/kWh",
  ]);
  for (let yr = 1; yr <= a.n; yr++) {
    const row = a.urYear(yr);
    const y = t.years[yr - 1];
    const R = `Revenue!`;
    ws.getCell(row, 1).value = yr;
    ws.getCell(row, 2).value = f(`${R}C${a.revYear(yr)}`, y.kwh, 4);
    ws.getCell(row, 3).value = f(`IF(${R}$B$7=0,0,B${row}/${R}$B$7)`, y.kwhPerDay, 6);
    ws.getCell(row, 4).value = f(`IF(${R}$B$26=0,0,C${row}/(${R}$B$26*24))`, y.avgConcurrentPorts, 8);
    ws.getCell(row, 5).value = f(`IF(${R}$B$17=0,0,MIN(${R}$B$17,MAX(1,ROUNDUP(D${row}*$B$25,0))))`, y.peakConcurrentPorts, 0);
    ws.getCell(row, 6).value = f(`E${row}*IF($B$27="Yes",${R}$B$25,${R}$B$26)`, y.peakDemandKw, 6);
    ws.getCell(row, 7).value = f(
      `IF($B$24="${POLICY_TEXT.nameplate}",$B$29,IF($B$24="${POLICY_TEXT.manual}",$B$28,F${row}*(1+$B$26)))`,
      y.subscribedKw,
      6,
    );
    ws.getCell(row, 8).value = f(`IF($B$14=0,0,ROUNDUP(G${row}/$B$14,0))`, y.blocks, 0);
    ws.getCell(row, 9).value = f(`H${row}*$B$15*12`, y.subscriptionCost);
    ws.getCell(row, 10).value = f(
      `IF(A${row}>=$B$30,12*$B$13*IF($B$24="${POLICY_TEXT.nameplate}",$B$29,IF($B$24="${POLICY_TEXT.manual}",$B$28,F${row})),0)`,
      y.demandChargeCost,
    );
    ws.getCell(row, 11).value = f("12*$B$12", y.customerChargeCost);
    ws.getCell(row, 12).value = f(`B${row}*$B$22`, y.energyCost);
    ws.getCell(row, 13).value = f(`I${row}+J${row}+K${row}`, y.fixedCost);
    ws.getCell(row, 14).value = f(`$B$22+IF(B${row}=0,0,M${row}/B${row})`, y.allInPerKwh, 6);
    for (const col of [2, 3]) ws.getCell(row, col).numFmt = KWH;
    ws.getCell(row, 4).numFmt = "0.000";
    for (const col of [6, 7]) ws.getCell(row, col).numFmt = "#,##0.0";
    for (const col of [9, 10, 11, 12, 13]) ws.getCell(row, col).numFmt = MONEY;
    ws.getCell(row, 14).numFmt = RATE;
  }
  const first = a.urYear(1);
  const last = a.urYear(a.n);
  let n = last + 1;
  ws.getCell(n, 1).value = "Total across the horizon";
  ws.getCell(n, 1).font = { bold: true };
  ws.getCell(n, 9).value = f(`SUM(I${first}:I${last})`, t.subscriptionTotal);
  ws.getCell(n, 10).value = f(`SUM(J${first}:J${last})`, t.years.reduce((s, y) => s + y.demandChargeCost, 0));
  ws.getCell(n, 11).value = f(`SUM(K${first}:K${last})`, t.years.reduce((s, y) => s + y.customerChargeCost, 0));
  ws.getCell(n, 12).value = f(`SUM(L${first}:L${last})`, t.years.reduce((s, y) => s + y.energyCost, 0));
  ws.getCell(n, 13).value = f(`SUM(M${first}:M${last})`, t.years.reduce((s, y) => s + y.fixedCost, 0));
  for (const col of [9, 10, 11, 12, 13]) {
    ws.getCell(n, col).numFmt = MONEY;
    ws.getCell(n, col).font = { bold: true };
  }
  const totalRow = n;
  n += 2;
  derived(ws, n, "Subscription flat at full nameplate, across the horizon", f(`IF($B$14=0,0,ROUNDUP($B$29/$B$14,0)*$B$15*12)*${a.n}`, t.flatAtNameplateTotal), MONEY, "For comparison");
  const flatRow = n;
  n++;
  derived(ws, n, "Saving from ramping the subscription", f(`B${flatRow}-I${totalRow}`, t.savingFromRamping), MONEY, "Real money — but overage is charged at roughly double");
  const savingRow = n;
  n++;
  derived(ws, n, "Horizon all-in $/kWh (energy + fixed and demand)", f(`IF(SUM(B${first}:B${last})=0,$B$22,$B$22+M${totalRow}/SUM(B${first}:B${last}))`, t.horizonAllInPerKwh, 6), RATE, "Weighted across the horizon — the figure to quote");
  n++;
  derived(ws, n, "Year 1 all-in $/kWh", f(`N${first}`, t.year1AllInPerKwh, 6), RATE, "Fixed cost over a small volume — the ramp years carry the worst rate");
  n++;
  derived(ws, n, `Year ${a.n} all-in $/kWh`, f(`N${last}`, t.year10AllInPerKwh, 6), RATE);
  n += 2;
  ws.getCell(n, 1).value = "The other side of ramping — overage exposure";
  ws.getCell(n, 1).font = { bold: true };
  n++;
  derived(ws, n, "All positions drawing at once (kW)", f("Revenue!$B$17*Revenue!$B$25", t.fullAtOnceKw, 6), "#,##0.0", "The physical maximum the site can pull");
  const fullRow = n;
  n++;
  derived(ws, n, `Year ${a.n} subscribed level (kW)`, f(`G${last}`, t.years[a.n - 1]?.subscribedKw ?? 0, 6), "#,##0.0");
  const subRow = n;
  n++;
  derived(ws, n, "Unsubscribed headroom (kW)", f(`B${fullRow}-B${subRow}`, t.overage.unsubscribedKw, 6), "#,##0.0", "Exposed to the overage rate");
  const headroomRow = n;
  n++;
  derived(ws, n, "Cost of one month at full simultaneous draw", f(`MAX(0,B${headroomRow})*$B$16`, t.overage.oneMonthFullDraw), MONEY, "A single busy fifteen-minute interval sets the month");
  const oneMonthRow = n;
  n++;
  derived(ws, n, "Worst-case months the saving would absorb", f(`IF(B${oneMonthRow}=0,"n/a",B${savingRow}/B${oneMonthRow})`, t.overage.monthsAbsorbed ?? "n/a", 4), "0.0");
  const monthsRow = n;
  n++;
  derived(
    ws,
    n,
    "Net of the saving, is ramping still right?",
    f(
      `IF($B$16=0,"n/a — schedule has no overage rate",IF(B${savingRow}>B${oneMonthRow}*3,"Ramping is right — the saving absorbs "&TEXT(B${monthsRow},"0")&" worst-case months","Marginal — subscribe closer to nameplate"))`,
      t.overage.verdict,
    ),
  );
  n += 2;
  ws.getCell(n, 1).value = "Tariff provenance";
  ws.getCell(n, 1).font = { bold: true };
  n++;
  input(ws, n, "Source of the rate figures", ti.provenance.source || "—");
  n++;
  input(ws, n, "Verified against the filed tariff sheets?", ti.provenance.verified || "—");
  n++;
  input(ws, n, "Verified by / date", ti.provenance.verifiedBy || "—");
  n++;
  input(ws, n, "Demand-schedule eligibility threshold", ti.provenance.eligibilityThreshold || "—");
  n++;
  input(ws, n, "Would this site cross that threshold?", ti.provenance.crossesThreshold || "—");
  ws.views = [{ state: "frozen", ySplit: 3 }];
}

// ---------------------------------------------------------------------------
// Carbon
// ---------------------------------------------------------------------------

function fillCarbon(ws: WS, m: ModelResult, a: Anchors, refs: ProposalSheetRefs): void {
  [44, 18, 16, 16, 14, 16, 16, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  title(
    ws,
    "Carbon — FCI capacity credit with the net-capex cap, year by year",
    "DC fast-charging capacity only; Level 2 earns consumption credits. The aggregator's share is disclosed as a cost — it carries no margin for us and appears nowhere in our scope of supply.",
  );
  const c = m.carbon;
  const ci = m.inputs.carbon;
  input(ws, 4, "FCI credit rate ($/kW/yr)", ci.fciRatePerKwYear, '"$"0.0000', "Confirm with the aggregator in writing");
  input(ws, 5, "Aggregator share of credit value", ci.aggregatorSharePct, PCT, "Third-party administrator — a deduction from proceeds");
  input(ws, 6, "Crediting period (years)", ci.creditingYears, "0");
  input(ws, 7, "Cap multiple of net capex", ci.capMultiple, "0.0", "FCI revenue stops at this multiple");
  input(ws, 8, "Grants or rebates awarded", ci.grantsAwarded, MONEY, "Reduces net capex and therefore the cap");
  input(ws, 9, "Level 2 consumption credit ($/kWh)", ci.l2CreditPerKwh, '"$"0.0000', "0 excludes it");
  derived(ws, 10, "DC nameplate (kW)", f("Revenue!$B$18", c.dcNameplateKw, 6), "#,##0.0", "The capacity-credit basis");
  derived(ws, 12, "Gross capacity credit per year", f("$B$10*$B$4", c.grossPerYear), MONEY);
  derived(ws, 13, "Net of aggregator share, per year", f("$B$12*(1-$B$5)", c.netPerYear), MONEY);
  derived(ws, 14, "Net capital expenditure", f(`${refs.customerPrice}-$B$8`, c.netCapex), MONEY, "Customer price less grants");
  derived(ws, 15, "Credit cap", f("$B$14*$B$7", c.cap), MONEY, "FCI revenue stops here");
  derived(ws, 16, "Gross across the crediting period", f("$B$12*$B$6", c.grossAcrossPeriod), MONEY);
  derived(ws, 17, "Does the cap bind?", f('IF($B$16>$B$15,"YES — credit truncates","No — full period available")', c.capBinds ? "YES — credit truncates" : "No — full period available"));

  header(ws, CARBON_TABLE_HDR, ["Year", "Cumulative before", "Capacity credit", "Cumulative after", "L2 kWh", "L2 credit", "Gross", "Net of aggregator"]);
  for (let t = 1; t <= a.n; t++) {
    const row = a.carbonYear(t);
    const y = c.years[t - 1];
    ws.getCell(row, 1).value = t;
    ws.getCell(row, 2).value = t === 1 ? 0 : f(`D${row - 1}`, y.cumulativeBefore);
    ws.getCell(row, 3).value = f(`IF(A${row}>$B$6,0,MIN($B$12,MAX(0,$B$15-B${row})))`, y.capacityCredit);
    ws.getCell(row, 4).value = f(`B${row}+C${row}`, y.cumulativeAfter);
    ws.getCell(row, 5).value = f(`Revenue!E${a.revYear(t)}`, y.l2Kwh, 4);
    ws.getCell(row, 6).value = f(`E${row}*$B$9`, y.l2Credit);
    ws.getCell(row, 7).value = f(`C${row}+F${row}`, y.gross);
    ws.getCell(row, 8).value = f(`G${row}*(1-$B$5)`, y.net);
    for (const col of [2, 3, 4, 6, 7, 8]) ws.getCell(row, col).numFmt = MONEY;
    ws.getCell(row, 5).numFmt = KWH;
  }
  const first = a.carbonYear(1);
  const last = a.carbonYear(a.n);
  const tot = last + 1;
  ws.getCell(tot, 1).value = "Across the horizon";
  ws.getCell(tot, 1).font = { bold: true };
  ws.getCell(tot, 3).value = f(`SUM(C${first}:C${last})`, c.years.reduce((s, y) => s + y.capacityCredit, 0));
  ws.getCell(tot, 6).value = f(`SUM(F${first}:F${last})`, c.years.reduce((s, y) => s + y.l2Credit, 0));
  ws.getCell(tot, 7).value = f(`SUM(G${first}:G${last})`, c.totalGross);
  ws.getCell(tot, 8).value = f(`SUM(H${first}:H${last})`, c.totalNet);
  for (const col of [3, 6, 7, 8]) {
    ws.getCell(tot, col).numFmt = MONEY;
    ws.getCell(tot, col).font = { bold: true };
  }
  derived(ws, tot + 2, "Administration fee across the horizon (disclosed cost — not our revenue)", f(`G${tot}*$B$5`, c.totalAdminFee), MONEY);
  derived(ws, tot + 3, "Net credit to the site", f(`H${tot}`, c.totalNet), MONEY);
  let n = tot + 5;
  ws.getCell(n, 1).value = "Eligibility and incentives";
  ws.getCell(n, 1).font = { bold: true };
  n++;
  for (const [label, value] of [
    ["Site qualifies for FCI capacity credits?", ci.qualifies || "—"],
    ["Permit clears the 1 Jan 2022 test?", ci.permitClears2022 || "—"],
    ["Application filed?", ci.applicationFiled || "—"],
    ["Registered aggregator", ci.aggregator || "—"],
    ["Federal ITC claimed?", ci.federalItc || "—"],
    ["State programme evaluated", ci.stateProgramme || "—"],
    ["State programme outcome", ci.stateProgrammeOutcome || "—"],
  ] as [string, string][]) {
    input(ws, n, label, value);
    n++;
  }
  ws.views = [{ state: "frozen", ySplit: 3 }];
}

// ---------------------------------------------------------------------------
// Financing
// ---------------------------------------------------------------------------

function fillFinancing(ws: WS, m: ModelResult, refs: ProposalSheetRefs): void {
  [44, 18, 16, 16, 16, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  title(ws, "Financing — full amortisation of the financed amount", "Payment, total interest and the schedule at the quoted rate and term. The model horizon and discount rate live here.");
  const fi = m.inputs.financing;
  const fr = m.financing;
  input(ws, 4, "Financing offered? (Yes / No)", fi.offered ? "Yes" : "No");
  listValidation(ws, "B4", ["Yes", "No"]);
  input(ws, 5, "Lender", fi.lender || "—");
  input(ws, 6, "Client finances (Whole project / Our scope only)", fi.financeBasis === "ours" ? "Our scope only" : "Whole project", undefined, "Whether the facility covers third-party scope too");
  listValidation(ws, "B6", ["Whole project", "Our scope only"]);
  derived(ws, 7, "Amount to finance (before down payment)", f(`IF($B$6="Our scope only",${refs.contractValue},${refs.clientProjectCost})`, fr.baseAmount), MONEY, "Business Model sheet");
  input(ws, 8, "Down payment", fi.downPayment, MONEY);
  derived(ws, 9, "Financed amount", f("MAX(0,$B$7-$B$8)", fr.financedAmount), MONEY);
  input(ws, 10, "Annual interest rate", fi.annualRate, PCT);
  input(ws, 11, "Term (years)", fr.termYears, "0");
  input(ws, 12, "Payments per year", fr.paymentsPerYear, "0");
  derived(ws, 13, "Number of payments", f("$B$11*$B$12", fr.nPayments, 0), "0");
  derived(ws, 14, "Payment per period", f('IF(AND($B$4="Yes",$B$13>0),PMT($B$10/$B$12,$B$13,-$B$9),0)', fr.payment), MONEY, fr.paymentsPerYear === 12 ? "Monthly payment" : "");
  derived(ws, 15, "Total paid", f("$B$14*$B$13", fr.totalPaid), MONEY);
  derived(ws, 16, "Total interest", f('IF($B$4="Yes",$B$15-$B$9,0)', fr.totalInterest), MONEY);
  input(ws, 17, "Model horizon (years)", m.revenue.years.length, "0", "Use 10 — the carbon credit runs ten years. The year tables are laid out for this horizon.");
  input(ws, 18, "Discount rate for NPV", fi.discountRate, PCT, "Default: the financing rate");
  if (fr.schedule.length > 0) {
    const HDR = 20;
    header(ws, HDR, ["Pmt", "Opening balance", "Payment", "Principal", "Interest", "Closing balance"]);
    fr.schedule.forEach((r, i) => {
      const row = HDR + 1 + i;
      ws.getCell(row, 1).value = r.n;
      ws.getCell(row, 2).value = i === 0 ? f("$B$9", r.opening) : f(`F${row - 1}`, r.opening);
      ws.getCell(row, 3).value = f("$B$14", r.payment);
      ws.getCell(row, 4).value = f(`C${row}-E${row}`, r.principal);
      ws.getCell(row, 5).value = f(`B${row}*$B$10/$B$12`, r.interest);
      ws.getCell(row, 6).value = f(`B${row}-D${row}`, Math.abs(r.closing) < 0.005 ? 0 : r.closing);
      for (const col of [2, 3, 4, 5, 6]) ws.getCell(row, col).numFmt = MONEY;
    });
  } else {
    ws.getCell(20, 1).value = fi.offered ? "No payments in the term." : "No financing offered — the client buys outright at the amount above.";
    ws.getCell(20, 1).font = { italic: true, color: { argb: "FF666666" } };
  }
  ws.views = [{ state: "frozen", ySplit: 3 }];
}

// ---------------------------------------------------------------------------
// Cashflow
// ---------------------------------------------------------------------------

function fillCashflow(ws: WS, m: ModelResult, a: Anchors): void {
  [44, 18, 16, 18, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  title(ws, "Cashflow and return", "Charging profit plus the net carbon credit, against the capital outlay. Year 0 is the purchase; NPV discounts years 1 onward.");
  const c = m.cashflow;
  header(ws, 4, ["Year", "Charging profit", "Carbon (net)", "Annual cashflow", "Cumulative"]);
  const y0 = 5;
  ws.getCell(y0, 1).value = 0;
  ws.getCell(y0, 4).value = f("-Financing!$B$7", c.years[0].cashflow);
  ws.getCell(y0, 5).value = f(`D${y0}`, c.years[0].cumulative);
  for (let t = 1; t <= a.n; t++) {
    const row = y0 + t;
    const y = c.years[t];
    ws.getCell(row, 1).value = t;
    ws.getCell(row, 2).value = f(`Revenue!J${a.revYear(t)}`, y.chargingProfit);
    ws.getCell(row, 3).value = f(`Carbon!H${a.carbonYear(t)}`, y.carbonNet);
    ws.getCell(row, 4).value = f(`B${row}+C${row}`, y.cashflow);
    ws.getCell(row, 5).value = f(`E${row - 1}+D${row}`, y.cumulative);
  }
  const last = y0 + a.n;
  for (let r = y0; r <= last; r++) for (const col of [2, 3, 4, 5]) ws.getCell(r, col).numFmt = MONEY;
  let n = last + 2;
  ws.getCell(n, 1).value = "Return";
  ws.getCell(n, 1).font = { bold: true };
  n++;
  derived(ws, n, "Total net over the horizon", f(`SUM(D${y0}:D${last})`, c.totalNet), MONEY);
  n++;
  derived(ws, n, "NPV at the discount rate", f(`NPV(Financing!$B$18,D${y0 + 1}:D${last})+D${y0}`, c.npv), MONEY, "Financing!B18");
  n++;
  derived(ws, n, "IRR", f(`IFERROR(IRR(D${y0}:D${last}),"n/a")`, c.irr ?? "n/a", 6), PCT);
  n++;
  derived(
    ws,
    n,
    "Cumulative break-even (year)",
    f(`IF(COUNTIF(E${y0}:E${last},">0")=0,"beyond horizon",MINIFS(A${y0}:A${last},E${y0}:E${last},">0"))`, c.breakEvenYear ?? "beyond horizon", 0),
    "0",
    "First year in which cumulative cashflow is positive",
  );
  n += 2;
  if (c.monthly.length > 0) {
    ws.getCell(n, 1).value = "Position by payment period during the financing term";
    ws.getCell(n, 1).font = { bold: true };
    n++;
    header(ws, n, ["Period", "Loan payment", "Carbon", "Charging", "Net position"]);
    const hdr = n;
    const carbonRange = `Carbon!$H$${a.carbonYear(1)}:$H$${a.carbonYear(a.n)}`;
    const profitRange = `Revenue!$J$${a.revYear(1)}:$J$${a.revYear(a.n)}`;
    c.monthly.forEach((p, i) => {
      const row = hdr + 1 + i;
      ws.getCell(row, 1).value = p.period;
      ws.getCell(row, 2).value = f("Financing!$B$14", p.loanPayment);
      ws.getCell(row, 3).value = f(`INDEX(${carbonRange},MIN(${a.n},ROUNDUP(A${row}/Financing!$B$12,0)))/Financing!$B$12`, p.carbon);
      ws.getCell(row, 4).value = f(`INDEX(${profitRange},MIN(${a.n},ROUNDUP(A${row}/Financing!$B$12,0)))/Financing!$B$12`, p.charging);
      ws.getCell(row, 5).value = f(`C${row}+D${row}-B${row}`, p.net);
      for (const col of [2, 3, 4, 5]) ws.getCell(row, col).numFmt = MONEY;
    });
    const mFirst = hdr + 1;
    const mLast = hdr + c.monthly.length;
    n = mLast + 2;
    derived(ws, n, "Cumulative position across the term", f(`SUM(E${mFirst}:E${mLast})`, c.cumulativeMonthly), MONEY, "Cash the customer funds (negative) or receives (positive)");
    n++;
    derived(
      ws,
      n,
      "First period with a positive net position",
      f(`IF(COUNTIF(E${mFirst}:E${mLast},">0")=0,"none",MINIFS(A${mFirst}:A${mLast},E${mFirst}:E${mLast},">0"))`, c.firstPositivePeriod ?? "none", 0),
      "0",
    );
  }
  ws.views = [{ state: "frozen", ySplit: 4 }];
}

// ---------------------------------------------------------------------------
// Deal Structure
// ---------------------------------------------------------------------------

function fillDeal(ws: WS, m: ModelResult, a: Anchors, refs: ProposalSheetRefs): void {
  [44, 18, 16, 16, 18, 16, 16, 18, 18, 18, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  title(
    ws,
    "Deal Structure — what we keep, what we give, both sides of the return",
    "Leave every knob at zero for a straight sale and this sheet reproduces the Cashflow sheet. Fill them in only when we are trading price for a share of the upside.",
  );
  const d = m.deal;
  const di = m.inputs.deal;
  const F = "Financing!";
  input(ws, 4, "Structure name", di.name);
  input(ws, 5, "Our share of the net carbon credit", di.carbonSharePct, PCT, "0% = client keeps all of it");
  input(ws, 6, "Our share of charging revenue", di.revenueSharePct, PCT);
  input(ws, 7, "Revenue share is taken on", SHARE_BASIS_TEXT[di.revenueShareBasis], undefined, "Net charging profit / Gross revenue");
  listValidation(ws, "B7", Object.values(SHARE_BASIS_TEXT));
  input(ws, 8, "Share runs for (years)", di.shareYears, "0", "Cannot exceed the model horizon");
  input(ws, 9, "Extra discount on charger hardware", di.extraDiscountHardwarePct, PCT, "On top of the discount already in the base price");
  input(ws, 10, "Extra discount on electrical and construction", di.extraDiscountConstructionPct, PCT);
  input(ws, 11, "Extra discount on service, warranty and network", di.extraDiscountServicePct, PCT);
  input(ws, 12, "Direct capital contribution", di.capitalContribution, MONEY, "Cash or hardware we fund outright");
  input(ws, 13, "Minimum acceptable client NPV", di.minClientNpv, MONEY);
  input(ws, 14, "Minimum acceptable return on our capital (multiple)", di.minReturnMultiple, "0.0");
  input(ws, 15, "Maximum capital we will contribute (0 = no ceiling)", di.maxContribution, MONEY);

  const we = (line: Parameters<typeof refs.scopeStatus>[0]) => `IF(${refs.scopeStatus(line)}="We provide",${refs.scopePrice(line)},0)`;
  ws.getCell(16, 1).value = "Value of what we give";
  ws.getCell(16, 1).font = { bold: true };
  derived(ws, 17, "Hardware concession", f(`${we("hardware")}*$B$9`, d.contributions.hardware), MONEY, "On the hardware we provide");
  derived(ws, 18, "Sales tax relief on that concession", f(`B17*${refs.salesTaxRate}`, d.contributions.taxRelief), MONEY, "Tax follows the discounted hardware price");
  derived(ws, 19, "Electrical and construction concession", f(`(${we("construction")}+${we("interconnect")}+${we("additional")})*$B$10`, d.contributions.construction), MONEY);
  derived(ws, 20, "Service, warranty and network concession", f(`(${we("service")}+${we("evolv")})*$B$11`, d.contributions.service), MONEY);
  derived(ws, 21, "Direct capital contribution", f("$B$12", d.contributions.capital), MONEY);
  derived(ws, 22, "Total we contribute", f("SUM(B17:B21)", d.contributions.total), MONEY);
  ws.getCell(22, 2).font = { bold: true };
  ws.getCell(23, 1).value = "Revised client position";
  ws.getCell(23, 1).font = { bold: true };
  derived(ws, 24, "Base customer price / financed amount", f(`${F}$B$7`, d.basePrice), MONEY);
  derived(ws, 25, "Less our contribution", f("-$B$22", -d.contributions.total), MONEY);
  derived(ws, 26, "Client price", f("B24+B25", d.clientPrice), MONEY);
  derived(
    ws,
    27,
    "Client payment per period",
    f(`IF(AND(${F}$B$4="Yes",${F}$B$13>0),PMT(${F}$B$10/${F}$B$12,${F}$B$13,-MAX(0,B26-${F}$B$8)),0)`, d.clientPayment),
    MONEY,
  );
  derived(ws, 28, "Change in payment", f(`B27-${F}$B$14`, d.paymentChange), MONEY, "Negative is a saving to the client");

  const HDR = 30;
  header(ws, HDR, [
    "Year", "Charging profit (base)", "We take", "Client keeps", "Carbon net (base)", "We take", "Client keeps", "Client total", "Our total", "Client cumulative", "Our cumulative",
  ]);
  const y0 = HDR + 1;
  ws.getCell(y0, 1).value = 0;
  ws.getCell(y0, 8).value = f("-$B$26", -d.clientPrice);
  ws.getCell(y0, 9).value = f("-$B$22", -d.contributions.total);
  ws.getCell(y0, 10).value = f(`H${y0}`, -d.clientPrice);
  ws.getCell(y0, 11).value = f(`I${y0}`, -d.contributions.total);
  for (let t = 1; t <= a.n; t++) {
    const row = y0 + t;
    const y = d.years[t - 1];
    ws.getCell(row, 1).value = t;
    ws.getCell(row, 2).value = f(`Revenue!J${a.revYear(t)}`, y.profitBase);
    ws.getCell(row, 3).value = f(`IF(A${row}>$B$8,0,IF($B$7="${SHARE_BASIS_TEXT.gross}",Revenue!F${a.revYear(t)}*$B$6,B${row}*$B$6))`, y.profitWeTake);
    ws.getCell(row, 4).value = f(`B${row}-C${row}`, y.profitClientKeeps);
    ws.getCell(row, 5).value = f(`Carbon!H${a.carbonYear(t)}`, y.carbonBase);
    ws.getCell(row, 6).value = f(`IF(A${row}>$B$8,0,E${row}*$B$5)`, y.carbonWeTake);
    ws.getCell(row, 7).value = f(`E${row}-F${row}`, y.carbonClientKeeps);
    ws.getCell(row, 8).value = f(`D${row}+G${row}`, y.clientTotal);
    ws.getCell(row, 9).value = f(`C${row}+F${row}`, y.ourTotal);
    ws.getCell(row, 10).value = f(`J${row - 1}+H${row}`, y.clientCumulative);
    ws.getCell(row, 11).value = f(`K${row - 1}+I${row}`, y.ourCumulative);
  }
  const yLast = y0 + a.n;
  for (let r = y0; r <= yLast; r++) for (let col = 2; col <= 11; col++) ws.getCell(r, col).numFmt = MONEY;

  const O = yLast + 2;
  header(ws, O, ["Outcome", "Client", "Zero Impact Energy"]);
  const disc = `${F}$B$18`;
  const rows: [string, ExcelJS.CellValue, ExcelJS.CellValue, string?][] = [
    ["Capital at risk", f("-$B$26", d.client.capitalAtRisk), f("-$B$22", d.ours.capitalAtRisk), "Client finances its price; we fund our contribution outright"],
    ["Cash received over the horizon", f(`SUM(H${y0 + 1}:H${yLast})`, d.client.cashReceived), f(`SUM(I${y0 + 1}:I${yLast})`, d.ours.cashReceived)],
    ["Net position", f(`SUM(H${y0 + 1}:H${yLast})-$B$26`, d.client.netPosition), f(`SUM(I${y0 + 1}:I${yLast})-$B$22`, d.ours.netPosition)],
    ["NPV at the discount rate", f(`NPV(${disc},H${y0 + 1}:H${yLast})-$B$26`, d.client.npv), f(`NPV(${disc},I${y0 + 1}:I${yLast})-$B$22`, d.ours.npv)],
    ["IRR", f(`IFERROR(IRR(H${y0}:H${yLast}),"n/a")`, d.client.irr ?? "n/a", 6), f(`IF($B$22=0,"n/a",IFERROR(IRR(I${y0}:I${yLast}),"n/a"))`, d.ours.irr ?? "n/a", 6), "Our IRR is on contributed capital only"],
    ["Return multiple on our capital", "—", f(`IF($B$22=0,"n/a",SUM(I${y0 + 1}:I${yLast})/$B$22)`, d.ours.returnMultiple ?? "n/a", 4)],
    [
      "Payback (years)",
      f(`IF(COUNTIF(J${y0}:J${yLast},">0")=0,"beyond horizon",MINIFS(A${y0}:A${yLast},J${y0}:J${yLast},">0"))`, d.client.paybackYears ?? "beyond horizon", 0),
      f(
        `IF($B$22=0,"n/a",IF(COUNTIF(K${y0}:K${yLast},">0")=0,"beyond horizon",MINIFS(A${y0}:A${yLast},K${y0}:K${yLast},">0")))`,
        d.contributions.total > 0 ? (d.ours.paybackYears ?? "beyond horizon") : "n/a",
        0,
      ),
      "Cumulative, including the capital",
    ],
    [
      "Carbon share that makes our contribution break even",
      "—",
      f(`IF($B$22=0,"n/a",IFERROR($B$22/NPV(${disc},Carbon!H${a.carbonYear(1)}:H${a.carbonYear(a.n)}),"check"))`, d.breakEvenCarbonShare ?? "n/a", 6),
      "The share of net carbon credit whose present value equals what we put in",
    ],
  ];
  rows.forEach((r, i) => {
    const row = O + 1 + i;
    ws.getCell(row, 1).value = r[0];
    ws.getCell(row, 2).value = r[1];
    ws.getCell(row, 3).value = r[2];
    if (r[3]) {
      ws.getCell(row, 4).value = r[3];
      ws.getCell(row, 4).font = { italic: true, size: 9, color: { argb: "FF666666" } };
    }
    const fmt = i === 4 ? PCT : i === 5 ? '0.00"×"' : i === 6 ? "0" : i === 7 ? PCT : MONEY;
    ws.getCell(row, 2).numFmt = fmt;
    ws.getCell(row, 3).numFmt = fmt;
  });
  const npvRow = O + 4;
  const multRow = O + 6;
  let n = O + rows.length + 2;
  ws.getCell(n, 1).value = "Guard rails";
  ws.getCell(n, 1).font = { bold: true };
  n++;
  const rails: [string, string, string][] = [
    ["Client NPV at or above the minimum", `IF(B${npvRow}>=$B$13,"OK","FAILS")`, d.guardRails[0].ok ? "OK" : "FAILS"],
    [
      "Return on our capital at or above the minimum multiple",
      `IF($B$22=0,"OK — no capital contributed",IF(C${multRow}>=$B$14,"OK","FAILS"))`,
      d.contributions.total === 0 ? "OK — no capital contributed" : d.guardRails[1].ok ? "OK" : "FAILS",
    ],
    ["Contribution within the ceiling", `IF($B$15=0,"OK — no ceiling set",IF($B$22<=$B$15,"OK","FAILS"))`, di.maxContribution === 0 ? "OK — no ceiling set" : d.guardRails[2].ok ? "OK" : "FAILS"],
    ["Share term within the model horizon", `IF($B$8<=${F}$B$17,"OK","FAILS")`, d.guardRails[3].ok ? "OK" : "FAILS"],
  ];
  for (const [label, formula, cached] of rails) {
    ws.getCell(n, 1).value = label;
    ws.getCell(n, 2).value = f(formula, cached);
    n++;
  }
  n++;
  for (const note of [
    "Set every knob to zero and this sheet returns the base case: client NPV matches the Cashflow sheet and our position is zero.",
    "A carbon share needs the credit assigned contractually and the aggregator agreement to allow it. Confirm before pricing a structure around it.",
    "A revenue share on gross is very different from a share of net profit — on gross we get paid before the site covers its energy cost.",
    "Our IRR is measured on contributed capital only; read the multiple and the dollar column alongside it.",
  ]) {
    ws.getCell(n, 1).value = `• ${note}`;
    ws.getCell(n, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
    n++;
  }
  ws.views = [{ state: "frozen", ySplit: 3 }];
}
