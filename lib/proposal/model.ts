// The downstream business model — what the Best Western workbook (engine
// 2.0.0) computes from the intake: utilisation → energy, the utility tariff
// with a ramped demand subscription, the ten-year revenue projection, the
// LCFS/FCI carbon credit with its net-capex cap, the financing schedule, the
// cashflow and return, and the alternative deal structure (what we keep, what
// we give, both sides' NPV and IRR).
//
// Pure functions over ModelInputs + ModelContext. modelContextOf() derives the
// context from a project and its price layer; the BW replay test feeds the
// workbook's own figures in and ties every sheet to the cent.

import type { Project } from "../calc/types";
import { computeExisting } from "../existing";
import { modelOverridesOf } from "../overrides";
import { MARKET_BENCHMARKS } from "../ref/benchmarks";
import { RATE_LIBRARY, type RateSchedule } from "../ref/rateLibrary";
import { computeEquipmentSchedule, computeSiteCapacity, serviceTermsOf } from "../skus";
import { impliedMarketGrowth, modelInputsOf, zeroRates } from "./defaults";
import { amortize, irr, npv, npvFromZero, paybackIndex, pmt, roundUp } from "./finance";
import type {
  BenchmarkResult,
  CarbonInput,
  CarbonResult,
  CarbonYear,
  CashflowResult,
  CashflowYear,
  CostBuildupResult,
  DealInput,
  DealResult,
  DealYear,
  FinancingInput,
  FinancingResult,
  GuardRail,
  HistoricalBasis,
  MarginResult,
  ModelContext,
  ModelInputs,
  ModelOverrides,
  ModelResult,
  MonthlyPosition,
  RevenueInput,
  RevenueResult,
  RevenueYear,
  ScopeLine,
  TariffInput,
  TariffRates,
  TariffResult,
  TariffYear,
  TouShares,
  UsageResult,
  UsageYear,
} from "./types";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n) || lo));

/** Model horizon in whole years, 1–50. */
export function horizonOf(fin: FinancingInput): number {
  return clampInt(fin.horizonYears, 1, 50);
}

// ---------------------------------------------------------------------------
// Context from a project
// ---------------------------------------------------------------------------

export function modelContextOf(project: Project, costBuildup: CostBuildupResult, margin: MarginResult): ModelContext {
  const cap = computeSiteCapacity(project);
  const schedule = computeEquipmentSchedule(project);
  const terms = serviceTermsOf(project);
  const it = project.intake;
  const hoursPerDay = it?.hoursOpen && it.hoursOpen > 0 ? Math.min(24, it.hoursOpen) : 24;
  const daysPerYear =
    it?.daysOpenPerYear && it.daysOpenPerYear > 0
      ? Math.min(366, Math.round(it.daysOpenPerYear))
      : it?.daysPerWeek && it.daysPerWeek > 0
        ? Math.round((Math.min(7, it.daysPerWeek) / 7) * 365)
        : 365;
  const ours = (line: ScopeLine) => {
    const r = margin.rows.find((x) => x.line === line);
    return r && r.status === "we" ? r.price : 0;
  };
  const notes = [...cap.notes];
  if (cap.source === "none") notes.push("No chargers on the project yet — the revenue model has nothing to dispense.");
  if (cap.source === "takeoff") notes.push("Equipment read from the Takeoff rows (no Quick Estimate lines).");
  if (!it?.hoursOpen) notes.push("Hours open per day not set on the Intake tab — 24 assumed.");
  let historical: HistoricalBasis | undefined;
  const ex = project.existing;
  if (ex && ex.projectType !== "greenfield") {
    const revenue = modelInputsOf(project.commercial).revenue;
    const bm = MARKET_BENCHMARKS.find((b) => b.state === revenue.benchmarkState);
    const r = computeExisting(ex, {
      newPorts: cap.dcPositions + cap.l2Positions,
      newDcPositions: cap.dcPositions,
      newDcKw: cap.dcNameplateKw,
      newConnectedKw: cap.dcNameplateKw + cap.l2NameplateKw,
      serviceVoltage: ex.infrastructure.voltage ?? 480,
      benchmarkUtilisation: bm?.portUtilisation ?? null,
      benchmarkState: revenue.benchmarkState,
    });
    historical = {
      revenueBasis: ex.revenueBasis,
      months: r.history.months,
      kwhPerYear: r.history.kwhPerYear,
      projectedKwhPerYear: r.projectedKwhPerYear,
      impliedRetailPerKwh: r.history.impliedRetailPerKwh,
      impliedDeliveredPerKwh: r.history.impliedDeliveredPerKwh,
    };
    notes.push(r.basisInForce);
  }
  return {
    dcPositions: cap.dcPositions,
    dcNameplateKw: cap.dcNameplateKw,
    l2Positions: cap.l2Positions,
    l2KwPerPosition: cap.l2Positions > 0 ? cap.l2NameplateKw / cap.l2Positions : 0,
    hoursPerDay,
    daysPerYear,
    utility: project.setup.utility,
    schedule: it?.rateSchedule ?? "",
    customerPrice: costBuildup.customerPrice,
    contractValue: margin.contractValue,
    clientProjectCost: margin.clientProjectCost,
    hardwarePrice: ours("hardware"),
    constructionPrice: ours("construction") + ours("interconnect") + ours("additional"),
    servicePrice: ours("service") + ours("evolv"),
    salesTaxPct: project.financial.salesTaxPct,
    contractYears: Math.max(0, terms.contractYears),
    annualServiceAfterContract: schedule.serviceAfterContractPerYear,
    annualNetworkFee: schedule.networkPerYear,
    notes,
    historical,
  };
}

// ---------------------------------------------------------------------------
// Utilisation → energy (BW Revenue rows 4-21)
// ---------------------------------------------------------------------------

export function rampFactor(rev: RevenueInput, year: number): number {
  if (year <= 1) return rev.rampYear1;
  if (year === 2) return rev.rampYear2;
  if (year === 3) return rev.rampYear3;
  return rev.rampYear3 * Math.pow(1 + rev.growthAfterRamp, year - 3);
}

export function computeUsage(rev: RevenueInput, ctx: ModelContext, horizon: number, overrides?: ModelOverrides): UsageResult {
  const chargingHoursPerStall = rev.chargingHoursShare * ctx.hoursPerDay;
  const dcPower = ctx.dcPositions > 0 ? (ctx.dcNameplateKw * rev.deratingFactor) / ctx.dcPositions : 0;
  const dcAvg = dcPower * rev.taperFactor;
  const dcStalls = ctx.dcPositions * rev.stallOccupancy;
  const dcStallHours = dcStalls * chargingHoursPerStall;
  const buildupDcKwhPerDay = dcStallHours * dcAvg;
  const l2Power = ctx.l2KwPerPosition * rev.deratingFactor;
  const l2Stalls = ctx.l2Positions * rev.stallOccupancy;
  const buildupL2KwhPerDay = l2Stalls * chargingHoursPerStall * l2Power * rev.taperFactor;
  const buildupSiteKwhPerDay = buildupDcKwhPerDay + buildupL2KwhPerDay;

  // Steady state: the greenfield build-up, a replacement site's history × the
  // stated uplifts (Existing tab, twelve months minimum), or a forced kWh/day
  // from the override register. Whichever wins, the DC / L2 split follows the
  // build-up's proportions (all DC when the build-up has none).
  let basis: UsageResult["basis"] = "greenfield";
  let basisNote = "Greenfield build-up: stall occupancy × charging hours × de-rated, tapered power";
  let siteKwhPerDay = buildupSiteKwhPerDay;
  const hist = ctx.historical;
  const historicalInForce = !!hist && hist.revenueBasis === "historical" && hist.months >= 12 && hist.projectedKwhPerYear > 0;
  if (historicalInForce) {
    basis = "historical";
    siteKwhPerDay = hist!.projectedKwhPerYear / ctx.daysPerYear;
    basisNote = `Historical actuals: ${hist!.months} months of metered history × the Existing tab's uplifts — ${Math.round(hist!.projectedKwhPerYear).toLocaleString("en-US")} kWh/yr at steady state`;
  }
  if (overrides?.kwhPerDay !== undefined) {
    basis = "override";
    siteKwhPerDay = overrides.kwhPerDay;
    basisNote = `Override register: steady-state kWh per day forced to ${overrides.kwhPerDay.toLocaleString("en-US")}`;
  }
  const dcShare = buildupSiteKwhPerDay > 0 ? buildupDcKwhPerDay / buildupSiteKwhPerDay : ctx.dcPositions > 0 || ctx.l2Positions === 0 ? 1 : 0;
  const dcKwhPerDay = siteKwhPerDay * dcShare;
  const l2KwhPerDay = siteKwhPerDay - dcKwhPerDay;

  // Ramp. A greenfield site fills from the year-1 share; a replacement site
  // with history starts at its run rate and ramps the UPLIFT in, on the same
  // year-1/2/3 shares, then grows.
  const startShare = historicalInForce && siteKwhPerDay > 0 ? Math.min(1, hist!.kwhPerYear / ctx.daysPerYear / siteKwhPerDay) : 0;
  const effectiveRamp = (t: number) => {
    const r = rampFactor(rev, t);
    if (!historicalInForce) return r;
    if (t <= 3) return startShare + (1 - startShare) * r;
    const r3 = startShare + (1 - startShare) * rev.rampYear3;
    return r3 * Math.pow(1 + rev.growthAfterRamp, t - 3);
  };
  const years: UsageYear[] = [];
  for (let t = 1; t <= horizon; t++) {
    const ramp = effectiveRamp(t);
    const dcKwh = dcKwhPerDay * ctx.daysPerYear * ramp;
    const l2Kwh = l2KwhPerDay * ctx.daysPerYear * ramp;
    years.push({ year: t, ramp, dcKwh, l2Kwh, kwh: dcKwh + l2Kwh });
  }
  return {
    basis,
    basisNote,
    hoursPerDay: ctx.hoursPerDay,
    daysPerYear: ctx.daysPerYear,
    dc: {
      positions: ctx.dcPositions,
      nameplateKw: ctx.dcNameplateKw,
      powerPerPosition: dcPower,
      avgDeliveredKw: dcAvg,
      stallsInUse: dcStalls,
      chargingHoursPerStall,
      stallHoursPerDay: dcStallHours,
      kwhPerDay: dcKwhPerDay,
      kwhPerYear: dcKwhPerDay * ctx.daysPerYear,
    },
    l2: {
      positions: ctx.l2Positions,
      powerPerPosition: l2Power,
      stallsInUse: l2Stalls,
      chargingHoursPerStall,
      kwhPerDay: l2KwhPerDay,
      kwhPerYear: l2KwhPerDay * ctx.daysPerYear,
    },
    siteKwhPerDay,
    siteKwhPerYear: siteKwhPerDay * ctx.daysPerYear,
    years,
  };
}

// ---------------------------------------------------------------------------
// Utility tariff (BW Utility_Rates; intake 2.9.0 Revenue rows 32-103)
// ---------------------------------------------------------------------------

/** The rate-library row for a utility + schedule; a schedule picked off another utility's list resolves by name with a note. */
export function findRateRow(utility: string, schedule: string): { row?: RateSchedule; note?: string } {
  if (!schedule) return {};
  const exact = RATE_LIBRARY.find((r) => r.utility === utility && r.schedule === schedule);
  if (exact) return { row: exact };
  const utilityHasRows = RATE_LIBRARY.some((r) => r.utility === utility);
  if (utilityHasRows) return {};
  const byName = RATE_LIBRARY.find((r) => r.schedule === schedule);
  return byName ? { row: byName, note: `Rates taken from ${byName.utility}'s ${byName.schedule} — the library has no row for ${utility || "this utility"}.` } : {};
}

export function ratesOfRow(row: RateSchedule): TariffRates {
  return {
    peakPerKwh: row.peakPerKwh,
    offPeakPerKwh: row.offPeakPerKwh,
    superOffPeakPerKwh: row.superOffPeakPerKwh,
    customerPerMonth: row.customerPerMonth,
    demandPerKwMonth: row.demandPerKwMonth,
    blockKw: row.blockKw,
    blockPerMonth: row.blockPerMonth,
    overagePerKw: row.overagePerKw,
  };
}

export function computeTariff(input: TariffInput, ctx: ModelContext, usage: UsageResult, horizon: number, overrides?: ModelOverrides): TariffResult {
  const warnings: string[] = [];
  let rates: TariffRates;
  let status: string;
  if (input.basis === "manual") {
    rates = { ...zeroRates(), ...input.manual };
    status = "MANUAL — rates entered by hand";
    if (rates.peakPerKwh === 0 && rates.offPeakPerKwh === 0) warnings.push("Manual basis with no $/kWh entered — energy is priced at zero.");
  } else {
    const found = findRateRow(ctx.utility, ctx.schedule);
    if (found.row) {
      rates = ratesOfRow(found.row);
      status = found.row.status;
      if (found.note) warnings.push(found.note);
      if (!/^VERIFIED/i.test(status)) warnings.push(`Rate library row is ${status} — verify against the tariff book before issuing a proposal.`);
      if (rates.peakPerKwh === 0 && rates.offPeakPerKwh === 0)
        warnings.push("The library carries no $/kWh for this schedule (NOT PUBLISHED). Enter the rates from the tariff sheet or a bill on the manual basis.");
    } else {
      rates = { ...zeroRates(), ...input.manual };
      status = ctx.schedule ? "NOT RESEARCHED — no library row for this utility and schedule" : "NO SCHEDULE SELECTED";
      warnings.push(
        ctx.schedule
          ? `The rate library has no ${ctx.schedule} row for ${ctx.utility || "this utility"} — manual rates used.`
          : "Pick a rate schedule on the Intake tab, or enter the tariff manually.",
      );
    }
  }

  // Time-of-use mix.
  const isFlat = input.touShares === null;
  let shares: TouShares = isFlat ? { peak: 1, offPeak: 0, superOffPeak: 0 } : { ...input.touShares! };
  if (isFlat) {
    if (rates.peakPerKwh !== rates.offPeakPerKwh) warnings.push("No time-of-use split entered — energy is priced at the peak rate.");
  } else {
    const total = shares.peak + shares.offPeak + shares.superOffPeak;
    if (Math.abs(total - 1) > 1e-4) warnings.push(`The three time-of-use shares sum to ${(total * 100).toFixed(1)}% — they must sum to 100%.`);
    if (rates.superOffPeakPerKwh === 0 && shares.superOffPeak > 0 && (rates.peakPerKwh > 0 || rates.offPeakPerKwh > 0)) {
      shares = { peak: shares.peak, offPeak: shares.offPeak + shares.superOffPeak, superOffPeak: 0 };
      warnings.push("The schedule has no super off-peak period — that share is priced at the off-peak rate.");
    }
  }
  let blendedPerKwh = rates.peakPerKwh * shares.peak + rates.offPeakPerKwh * shares.offPeak + rates.superOffPeakPerKwh * shares.superOffPeak;
  if (overrides?.blendedPerKwh !== undefined) {
    blendedPerKwh = overrides.blendedPerKwh;
    warnings.push(`Override register: delivered energy cost forced to $${overrides.blendedPerKwh.toFixed(4)}/kWh.`);
  } else if (ctx.historical && ctx.historical.revenueBasis === "historical" && ctx.historical.impliedDeliveredPerKwh > 0 && input.basis !== "manual") {
    warnings.push(
      `${ctx.historical.months} months of billing say $${ctx.historical.impliedDeliveredPerKwh.toFixed(4)}/kWh all-in — actual billing beats a tariff lookup; carry it on the manual basis or the override register.`,
    );
  }
  if (overrides?.fixedUtilityPerYear !== undefined) warnings.push(`Override register: fixed and demand cost forced to $${overrides.fixedUtilityPerYear.toLocaleString("en-US")}/yr.`);

  // Demand subscription, year by year.
  const nameplateKw = ctx.dcNameplateKw + ctx.l2Positions * ctx.l2KwPerPosition;
  const dcPower = usage.dc.powerPerPosition;
  const dcAvg = usage.dc.avgDeliveredKw;
  const sizingKw = input.sizeDemandOnFullRating ? dcPower : dcAvg;
  const policy = input.subscriptionPolicy;
  const years: TariffYear[] = usage.years.map((u) => {
    const kwhPerDay = ctx.daysPerYear > 0 ? u.kwh / ctx.daysPerYear : 0;
    const avgConcurrentPorts = dcAvg > 0 ? kwhPerDay / (dcAvg * 24) : 0;
    const peakConcurrentPorts = ctx.dcPositions > 0 ? Math.min(ctx.dcPositions, Math.max(1, roundUp(avgConcurrentPorts * input.peakToAverageFactor))) : 0;
    const peakDemandKw = peakConcurrentPorts * sizingKw;
    const subscribedKw = policy === "nameplate" ? nameplateKw : policy === "manual" ? input.manualSubscribedKw : peakDemandKw * (1 + input.safetyMarginPct);
    const billingDemandKw = policy === "nameplate" ? nameplateKw : policy === "manual" ? input.manualSubscribedKw : peakDemandKw;
    const blocks = rates.blockKw > 0 ? roundUp(subscribedKw / rates.blockKw) : 0;
    const subscriptionCost = blocks * rates.blockPerMonth * 12;
    const demandChargeCost = u.year >= input.demandChargeFromYear ? 12 * rates.demandPerKwMonth * billingDemandKw : 0;
    const customerChargeCost = 12 * rates.customerPerMonth;
    const fixedCost = overrides?.fixedUtilityPerYear ?? subscriptionCost + demandChargeCost + customerChargeCost;
    const energyCost = u.kwh * blendedPerKwh;
    return {
      year: u.year,
      kwh: u.kwh,
      kwhPerDay,
      avgConcurrentPorts,
      peakConcurrentPorts,
      peakDemandKw,
      subscribedKw,
      blocks,
      subscriptionCost,
      demandChargeCost,
      customerChargeCost,
      fixedCost,
      energyCost,
      utilityCost: energyCost + fixedCost,
      allInPerKwh: blendedPerKwh + (u.kwh > 0 ? fixedCost / u.kwh : 0),
    };
  });
  const subscriptionTotal = sum(years.map((y) => y.subscriptionCost));
  const flatAnnual = rates.blockKw > 0 ? roundUp(nameplateKw / rates.blockKw) * rates.blockPerMonth * 12 : 0;
  const flatAtNameplateTotal = flatAnnual * horizon;
  const savingFromRamping = flatAtNameplateTotal - subscriptionTotal;
  const totalKwh = sum(years.map((y) => y.kwh));
  const totalFixed = sum(years.map((y) => y.fixedCost));
  const last = years[years.length - 1];
  const fullAtOnceKw = ctx.dcPositions * dcPower;
  const unsubscribedKw = fullAtOnceKw - (last?.subscribedKw ?? 0);
  const oneMonthFullDraw = Math.max(0, unsubscribedKw) * rates.overagePerKw;
  const monthsAbsorbed = oneMonthFullDraw > 0 ? savingFromRamping / oneMonthFullDraw : null;
  const verdict =
    rates.overagePerKw === 0
      ? "n/a — schedule has no overage rate"
      : savingFromRamping > oneMonthFullDraw * 3
        ? `Ramping is right — the saving absorbs ${Math.round(monthsAbsorbed ?? 0)} worst-case months`
        : "Marginal — subscribe closer to nameplate";

  return {
    utility: ctx.utility,
    schedule: ctx.schedule,
    basis: input.basis,
    status,
    rates,
    touShares: shares,
    isFlat,
    blendedPerKwh,
    nameplateKw,
    fullAtOnceKw,
    years,
    subscriptionTotal,
    flatAtNameplateTotal,
    savingFromRamping,
    year1AllInPerKwh: years[0]?.allInPerKwh ?? blendedPerKwh,
    year10AllInPerKwh: last?.allInPerKwh ?? blendedPerKwh,
    horizonAllInPerKwh: totalKwh > 0 ? blendedPerKwh + totalFixed / totalKwh : blendedPerKwh,
    overage: { unsubscribedKw, oneMonthFullDraw, monthsAbsorbed, verdict },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Revenue projection (BW Revenue rows 21-31) and the market cross-check
// ---------------------------------------------------------------------------

export function computeRevenue(rev: RevenueInput, ctx: ModelContext, usage: UsageResult, tariff: TariffResult): RevenueResult {
  const postContractServicePerYear = ctx.annualServiceAfterContract + ctx.annualNetworkFee;
  const years: RevenueYear[] = usage.years.map((u, i) => {
    const grossRevenue = u.kwh * rev.retailPerKwh;
    const utilityCost = tariff.years[i]?.utilityCost ?? 0;
    const cardFees = grossRevenue * rev.cardFeePct;
    const serviceAndNetwork = u.year > ctx.contractYears ? postContractServicePerYear : 0;
    return {
      year: u.year,
      ramp: u.ramp,
      kwh: u.kwh,
      grossRevenue,
      utilityCost,
      cardFees,
      serviceAndNetwork,
      chargingProfit: grossRevenue - utilityCost - cardFees - serviceAndNetwork,
    };
  });

  const bm = MARKET_BENCHMARKS.find((b) => b.state === rev.benchmarkState);
  const util = bm?.portUtilisation ?? null;
  const price = bm?.priceToDriverPerKwh ?? null;
  const kwhPerDayAtBenchmark = util !== null ? ctx.dcPositions * 24 * util * usage.dc.avgDeliveredKw : null;
  const implied = impliedMarketGrowth();
  const benchmark: BenchmarkResult = {
    state: rev.benchmarkState,
    benchmarkUtilisation: util,
    benchmarkPricePerKwh: price,
    kwhPerDayAtBenchmark,
    siteFactor: kwhPerDayAtBenchmark ? usage.dc.kwhPerDay / kwhPerDayAtBenchmark : null,
    priceVsMarket: price ? rev.retailPerKwh / price - 1 : null,
    impliedMarketGrowth: implied,
    growthVerdict:
      rev.growthAfterRamp <= implied
        ? "Conservative — below the market's implied per-port growth"
        : "ABOVE the market's implied per-port growth — justify it",
  };
  return { years, postContractServicePerYear, contractYears: ctx.contractYears, benchmark };
}

// ---------------------------------------------------------------------------
// Carbon credits (BW Carbon; intake 2.9.0 Carbon tab)
// ---------------------------------------------------------------------------

export function computeCarbon(carbon: CarbonInput, ctx: ModelContext, usage: UsageResult, horizon: number, overrides?: ModelOverrides): CarbonResult {
  const grossPerYear = overrides?.carbonGrossPerYear ?? ctx.dcNameplateKw * carbon.fciRatePerKwYear;
  const netPerYear = grossPerYear * (1 - carbon.aggregatorSharePct);
  const netCapex = ctx.customerPrice - carbon.grantsAwarded;
  const cap = netCapex * carbon.capMultiple;
  const grossAcrossPeriod = grossPerYear * carbon.creditingYears;
  const years: CarbonYear[] = [];
  let cumulative = 0;
  for (let t = 1; t <= horizon; t++) {
    const capacityCredit = t > carbon.creditingYears ? 0 : Math.min(grossPerYear, Math.max(0, cap - cumulative));
    const l2Kwh = usage.years[t - 1]?.l2Kwh ?? 0;
    const l2Credit = l2Kwh * carbon.l2CreditPerKwh;
    const gross = capacityCredit + l2Credit;
    years.push({
      year: t,
      cumulativeBefore: cumulative,
      capacityCredit,
      cumulativeAfter: cumulative + capacityCredit,
      l2Kwh,
      l2Credit,
      gross,
      net: gross * (1 - carbon.aggregatorSharePct),
    });
    cumulative += capacityCredit;
  }
  const totalGross = sum(years.map((y) => y.gross));
  return {
    dcNameplateKw: ctx.dcNameplateKw,
    grossPerYear,
    netPerYear,
    netCapex,
    cap,
    grossAcrossPeriod,
    capBinds: grossAcrossPeriod > cap,
    years,
    totalGross,
    totalAdminFee: totalGross * carbon.aggregatorSharePct,
    totalNet: totalGross * (1 - carbon.aggregatorSharePct),
  };
}

// ---------------------------------------------------------------------------
// Financing (BW Financing; intake 2.9.0 Commercial rows 18-29)
// ---------------------------------------------------------------------------

export function computeFinancing(fin: FinancingInput, ctx: ModelContext, overrides?: ModelOverrides): FinancingResult {
  const baseAmount = fin.financeBasis === "ours" ? ctx.contractValue : ctx.clientProjectCost;
  const financedAmount = Math.max(0, baseAmount - fin.downPayment);
  const paymentsPerYear = clampInt(fin.paymentsPerYear, 1, 52);
  const termYears = Math.max(0, fin.termYears);
  const nPayments = Math.round(termYears * paymentsPerYear);
  const computed = fin.offered && nPayments > 0 ? pmt(fin.annualRate / paymentsPerYear, nPayments, financedAmount) : 0;
  const payment = fin.offered && nPayments > 0 && overrides?.loanPayment !== undefined ? overrides.loanPayment : computed;
  const schedule = fin.offered && nPayments > 0 ? amortize(financedAmount, fin.annualRate / paymentsPerYear, nPayments, payment) : [];
  const totalPaid = payment * nPayments;
  return {
    offered: fin.offered,
    baseAmount,
    financedAmount,
    annualRate: fin.annualRate,
    termYears,
    paymentsPerYear,
    nPayments,
    payment,
    totalPaid,
    totalInterest: fin.offered ? totalPaid - financedAmount : 0,
    schedule,
  };
}

// ---------------------------------------------------------------------------
// Cashflow and return (BW Cashflow)
// ---------------------------------------------------------------------------

export function computeCashflow(fin: FinancingInput, financing: FinancingResult, revenue: RevenueResult, carbon: CarbonResult): CashflowResult {
  const years: CashflowYear[] = [{ year: 0, chargingProfit: 0, carbonNet: 0, cashflow: -financing.baseAmount, cumulative: -financing.baseAmount }];
  for (let i = 0; i < revenue.years.length; i++) {
    const chargingProfit = revenue.years[i].chargingProfit;
    const carbonNet = carbon.years[i]?.net ?? 0;
    const cashflow = chargingProfit + carbonNet;
    years.push({ year: i + 1, chargingProfit, carbonNet, cashflow, cumulative: years[years.length - 1].cumulative + cashflow });
  }
  const flows = years.map((y) => y.cashflow);
  const monthly: MonthlyPosition[] = [];
  if (financing.offered && financing.nPayments > 0) {
    const ppy = financing.paymentsPerYear;
    for (let p = 1; p <= financing.nPayments; p++) {
      const yearIdx = Math.min(revenue.years.length, Math.ceil(p / ppy)) - 1;
      const carbonShare = yearIdx >= 0 ? (carbon.years[yearIdx]?.net ?? 0) / ppy : 0;
      const charging = yearIdx >= 0 ? revenue.years[yearIdx].chargingProfit / ppy : 0;
      monthly.push({ period: p, loanPayment: financing.payment, carbon: carbonShare, charging, net: carbonShare + charging - financing.payment });
    }
  }
  const firstPositive = monthly.findIndex((m) => m.net > 0);
  return {
    years,
    totalNet: sum(flows),
    npv: npvFromZero(fin.discountRate, flows),
    irr: irr(flows),
    breakEvenYear: paybackIndex(flows),
    monthly,
    cumulativeMonthly: sum(monthly.map((m) => m.net)),
    firstPositivePeriod: firstPositive >= 0 ? monthly[firstPositive].period : null,
  };
}

// ---------------------------------------------------------------------------
// Deal structure (BW Business_Model rows 39-96; intake 2.9.0 Deal_Structure)
// ---------------------------------------------------------------------------

export function computeDeal(
  deal: DealInput,
  fin: FinancingInput,
  ctx: ModelContext,
  financing: FinancingResult,
  revenue: RevenueResult,
  carbon: CarbonResult,
): DealResult {
  const horizon = revenue.years.length;
  const shareYears = Math.min(Math.max(0, deal.shareYears), horizon);
  const hardware = ctx.hardwarePrice * deal.extraDiscountHardwarePct;
  const taxRelief = hardware * ctx.salesTaxPct;
  const construction = ctx.constructionPrice * deal.extraDiscountConstructionPct;
  const service = ctx.servicePrice * deal.extraDiscountServicePct;
  const capital = deal.capitalContribution;
  const total = hardware + taxRelief + construction + service + capital;
  const basePrice = financing.baseAmount;
  const clientPrice = basePrice - total;
  const clientPayment =
    financing.offered && financing.nPayments > 0
      ? pmt(fin.annualRate / financing.paymentsPerYear, financing.nPayments, Math.max(0, clientPrice - fin.downPayment))
      : 0;

  const years: DealYear[] = [];
  let clientCumulative = -clientPrice;
  let ourCumulative = -total;
  for (let i = 0; i < horizon; i++) {
    const t = i + 1;
    const r = revenue.years[i];
    const profitBase = r.chargingProfit;
    const carbonBase = carbon.years[i]?.net ?? 0;
    const inTerm = t <= shareYears;
    const profitWeTake = inTerm ? (deal.revenueShareBasis === "gross" ? r.grossRevenue : profitBase) * deal.revenueSharePct : 0;
    const carbonWeTake = inTerm ? carbonBase * deal.carbonSharePct : 0;
    const clientTotal = profitBase - profitWeTake + (carbonBase - carbonWeTake);
    const ourTotal = profitWeTake + carbonWeTake;
    clientCumulative += clientTotal;
    ourCumulative += ourTotal;
    years.push({
      year: t,
      profitBase,
      profitWeTake,
      profitClientKeeps: profitBase - profitWeTake,
      carbonBase,
      carbonWeTake,
      carbonClientKeeps: carbonBase - carbonWeTake,
      clientTotal,
      ourTotal,
      clientCumulative,
      ourCumulative,
    });
  }
  const clientTotals = years.map((y) => y.clientTotal);
  const ourTotals = years.map((y) => y.ourTotal);
  const clientFlows = [-clientPrice, ...clientTotals];
  const ourFlows = [-total, ...ourTotals];
  const ourCash = sum(ourTotals);
  const client = {
    capitalAtRisk: -clientPrice,
    cashReceived: sum(clientTotals),
    netPosition: sum(clientTotals) - clientPrice,
    npv: npv(fin.discountRate, clientTotals) - clientPrice,
    irr: irr(clientFlows),
    paybackYears: paybackIndex(clientFlows),
  };
  const ours = {
    capitalAtRisk: -total,
    cashReceived: ourCash,
    netPosition: ourCash - total,
    npv: npv(fin.discountRate, ourTotals) - total,
    irr: total > 0 ? irr(ourFlows) : null,
    paybackYears: total > 0 ? paybackIndex(ourFlows) : null,
    returnMultiple: total > 0 ? ourCash / total : null,
  };
  const carbonNpv = npv(fin.discountRate, carbon.years.map((y) => y.net));
  const breakEvenCarbonShare = total > 0 && carbonNpv > 0 ? total / carbonNpv : null;
  const isBaseCase =
    deal.carbonSharePct === 0 &&
    deal.revenueSharePct === 0 &&
    deal.extraDiscountHardwarePct === 0 &&
    deal.extraDiscountConstructionPct === 0 &&
    deal.extraDiscountServicePct === 0 &&
    deal.capitalContribution === 0;
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const guardRails: GuardRail[] = [
    {
      label: "Client NPV at or above the minimum",
      ok: client.npv >= deal.minClientNpv,
      detail: `${money(client.npv)} against a floor of ${money(deal.minClientNpv)}`,
    },
    {
      label: `Return on our capital at least ${deal.minReturnMultiple}×`,
      ok: total > 0 ? (ours.returnMultiple ?? 0) >= deal.minReturnMultiple : true,
      detail: total > 0 ? `${(ours.returnMultiple ?? 0).toFixed(2)}× on ${money(total)} contributed` : "no capital contributed",
    },
    {
      label: "Contribution within the ceiling",
      ok: deal.maxContribution > 0 ? total <= deal.maxContribution : true,
      detail: deal.maxContribution > 0 ? `${money(total)} against a ceiling of ${money(deal.maxContribution)}` : "no ceiling set",
    },
    {
      label: "Share term within the model horizon",
      ok: deal.shareYears <= horizon,
      detail: `${deal.shareYears} years against a ${horizon}-year horizon`,
    },
  ];
  return {
    name: deal.name,
    isBaseCase,
    contributions: { hardware, taxRelief, construction, service, capital, total },
    basePrice,
    clientPrice,
    clientPayment,
    paymentChange: clientPayment - financing.payment,
    shareYears,
    years,
    client,
    ours,
    breakEvenCarbonShare,
    guardRails,
  };
}

// ---------------------------------------------------------------------------
// The whole model
// ---------------------------------------------------------------------------

export function computeModel(inputs: ModelInputs, ctx: ModelContext): ModelResult {
  const horizon = horizonOf(inputs.financing);
  const ov = inputs.overrides;
  const usage = computeUsage(inputs.revenue, ctx, horizon, ov);
  const tariff = computeTariff(inputs.tariff, ctx, usage, horizon, ov);
  const revenue = computeRevenue(inputs.revenue, ctx, usage, tariff);
  const carbon = computeCarbon(inputs.carbon, ctx, usage, horizon, ov);
  const financing = computeFinancing(inputs.financing, ctx, ov);
  const cashflow = computeCashflow(inputs.financing, financing, revenue, carbon);
  const deal = computeDeal(inputs.deal, inputs.financing, ctx, financing, revenue, carbon);
  return { context: ctx, inputs, usage, tariff, revenue, carbon, financing, cashflow, deal };
}

/** The model for a project with a commercial section, from its price layer. */
export function computeProjectModel(project: Project, costBuildup: CostBuildupResult, margin: MarginResult): ModelResult {
  const inputs = { ...modelInputsOf(project.commercial), overrides: modelOverridesOf(project.overrides) };
  return computeModel(inputs, modelContextOf(project, costBuildup, margin));
}
