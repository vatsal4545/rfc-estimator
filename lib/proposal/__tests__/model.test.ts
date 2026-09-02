import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../../calc/autoplan";
import { defaultProject } from "../../calc/defaults";
import { computeEstimate } from "../../calc/engine";
import type { Project } from "../../calc/types";
import { computeSiteCapacity } from "../../skus";
import { defaultCommercial, defaultIntake, modelInputsOf } from "../defaults";
import { amortize, irr, npv, npvFromZero, paybackIndex, pmt, roundUp } from "../finance";
import { computeProposal } from "../index";
import { computeModel, findRateRow } from "../model";
import type { ModelContext, ModelInputs } from "../types";

// ---------------------------------------------------------------------------
// Replay of BW_Model_5.xlsx — Best Western, Hawthorne CA (engine 2.0.0). The
// workbook's Utility_Rates, Revenue, Carbon, Financing, Cashflow and
// Business_Model sheets, fed the workbook's own inputs. Every expected number
// below was read off the workbook (and re-derived independently in Python).
// ---------------------------------------------------------------------------

const BW_PRICE = 952404.346787333; // Cost_Buildup!C26

function bwContext(): ModelContext {
  return {
    dcPositions: 8, // 4 × TP5-360 dual
    dcNameplateKw: 1440,
    l2Positions: 4,
    l2KwPerPosition: 7.2,
    hoursPerDay: 24,
    daysPerYear: 365,
    utility: "SCE — Southern California Edison",
    schedule: "TOU-EV-9",
    customerPrice: BW_PRICE,
    contractValue: BW_PRICE,
    clientProjectCost: BW_PRICE,
    hardwarePrice: 341405.9, // Cost_Buildup!C5
    constructionPrice: 395501.708037333 + 3500, // SUM(C12:C22): construction lines + Rule 29 fee
    servicePrice: 129444.511 + 28792.8, // C6 + C7
    salesTaxPct: 0.0725,
    contractYears: 5,
    annualServiceAfterContract: 4 * 9318.015, // cabinets × the year-3 class rate
    annualNetworkFee: 12 * 39.99 * 12,
    notes: [],
  };
}

/** The BW inputs: SCE TOU-EV-9 placeholder energy rates (0.34 / 0.16 / 0.13), no blocks, 30/55/15 mix, ramped subscription. */
function bwInputs(): ModelInputs {
  const m = modelInputsOf(undefined);
  return {
    ...m,
    tariff: {
      ...m.tariff,
      basis: "manual",
      manual: { ...m.tariff.manual, peakPerKwh: 0.34, offPeakPerKwh: 0.16, superOffPeakPerKwh: 0.13 },
    },
    carbon: { ...m.carbon, l2CreditPerKwh: 0 }, // BW modelled no L2 consumption credit
  };
}

describe("finance helpers — Excel conventions", () => {
  it("PMT, NPV, IRR and the amortisation schedule match Excel on the BW loan", () => {
    const payment = pmt(0.0839 / 12, 60, BW_PRICE);
    expect(payment).toBeCloseTo(19489.58, 2); // Financing!B9
    const rows = amortize(BW_PRICE, 0.0839 / 12, 60, payment);
    expect(rows[0].interest).toBeCloseTo(6658.89, 2); // E14
    expect(rows[0].principal).toBeCloseTo(12830.69, 2); // D14
    expect(rows[59].closing).toBeCloseTo(0, 4); // F73
    expect(npv(0.1, [100, 100])).toBeCloseTo(100 / 1.1 + 100 / 1.21, 9);
    expect(npvFromZero(0.1, [-100, 110])).toBeCloseTo(0, 9);
    expect(irr([-100, 110])).toBeCloseTo(0.1, 9);
    expect(irr([-100, 60, 60])).toBeCloseTo(0.130662, 5);
    expect(irr([100, 100])).toBeNull();
    expect(paybackIndex([-10, 4, 4, 4])).toBe(3);
    expect(paybackIndex([-10, 1, 1])).toBeNull();
    expect(roundUp(0.816)).toBe(1);
    expect(roundUp(1.224)).toBe(2);
    expect(roundUp(2.0000000001)).toBe(2);
    expect(roundUp(0)).toBe(0);
  });
});

describe("Business model — Best Western replay (BW_Model_5.xlsx)", () => {
  const m = computeModel(bwInputs(), bwContext());

  it("Utility_Rates: blended $/kWh, the demand ramp and the all-in figures", () => {
    expect(m.tariff.blendedPerKwh).toBeCloseTo(0.2095, 6); // B33
    expect(m.tariff.nameplateKw).toBeCloseTo(1468.8, 6); // B39 connected load
    const y = m.tariff.years;
    expect(y[0].kwhPerDay).toBeCloseTo(604.55808, 4); // C63
    expect(y[0].avgConcurrentPorts).toBeCloseTo(0.204, 6); // D63
    expect(y[0].peakConcurrentPorts).toBe(1); // E63
    expect(y[0].peakDemandKw).toBeCloseTo(176.4, 6); // F63
    expect(y[0].subscribedKw).toBeCloseTo(211.68, 6); // G63
    expect(y[1].peakConcurrentPorts).toBe(2); // E64
    expect(y[6].peakConcurrentPorts).toBe(3); // E69
    expect(y[9].subscribedKw).toBeCloseTo(635.04, 6); // G72
    expect(y[9].blocks).toBe(0); // no block size on TOU-EV-9
    expect(m.tariff.subscriptionTotal).toBe(0); // I73
    expect(m.tariff.horizonAllInPerKwh).toBeCloseTo(0.2095, 6); // B96
    expect(m.tariff.fullAtOnceKw).toBeCloseTo(1411.2, 6); // B86
    expect(m.tariff.overage.unsubscribedKw).toBeCloseTo(776.16, 4); // B88
    expect(m.tariff.overage.verdict).toMatch(/^n\/a/); // no overage rate
    expect(m.tariff.status).toMatch(/^MANUAL/);
  });

  it("Revenue: utilisation → energy → charging profit, year by year", () => {
    expect(m.usage.dc.powerPerPosition).toBeCloseTo(176.4, 6); // B9
    expect(m.usage.dc.avgDeliveredKw).toBeCloseTo(123.48, 6); // B10
    expect(m.usage.dc.stallHoursPerDay).toBeCloseTo(9.6, 9); // B8
    expect(m.usage.dc.kwhPerDay).toBeCloseTo(1185.408, 6); // B11
    expect(m.usage.dc.kwhPerYear).toBeCloseTo(432673.92, 4); // B12
    expect(m.usage.l2.kwhPerDay).toBeCloseTo(23.70816, 6); // B19
    expect(m.usage.siteKwhPerYear).toBeCloseTo(441327.3984, 4); // B21
    const y = m.revenue.years;
    expect(y[0].kwh).toBeCloseTo(220663.6992, 3); // C22
    expect(y[0].grossRevenue).toBeCloseTo(143431.40448, 3); // D22
    expect(y[0].utilityCost).toBeCloseTo(46229.0449824, 3); // E22
    expect(y[0].cardFees).toBeCloseTo(4302.9421344, 3); // F22
    expect(y[0].serviceAndNetwork).toBe(0); // G22 — inside the contract
    expect(y[0].chargingProfit).toBeCloseTo(92899.4173632, 3); // H22
    expect(y[3].ramp).toBeCloseTo(1.06, 9); // B25
    expect(y[5].serviceAndNetwork).toBeCloseTo(43030.62, 2); // G27 — year 6, contract over
    expect(y[5].chargingProfit).toBeCloseTo(178258.7649, 2); // H27
    expect(y[9].chargingProfit).toBeCloseTo(236342.13, 2); // H31
    expect(m.revenue.postContractServicePerYear).toBeCloseTo(43030.62, 2);
  });

  it("Benchmarks: the site against the California market", () => {
    const b = m.revenue.benchmark;
    expect(b.benchmarkUtilisation).toBeCloseTo(0.231, 9);
    expect(b.kwhPerDayAtBenchmark).toBeCloseTo(5476.58496, 4); // B27
    expect(b.siteFactor).toBeCloseTo(0.21645, 4); // B29
    expect(b.priceVsMarket).toBeCloseTo(0.0726, 3); // $0.65 against the $0.606 state average (BW compared the taper cell by mistake)
    expect(b.impliedMarketGrowth).toBeCloseTo(0.108247, 5); // B19
    expect(b.growthVerdict).toMatch(/^Conservative/);
  });

  it("Carbon: FCI credit net of the aggregator, cap does not bind", () => {
    expect(m.carbon.grossPerYear).toBeCloseTo(103200.048, 4); // B5
    expect(m.carbon.netPerYear).toBeCloseTo(98040.0456, 4); // B6
    expect(m.carbon.netCapex).toBeCloseTo(BW_PRICE, 6); // B7
    expect(m.carbon.cap).toBeCloseTo(1428606.52, 2); // B8
    expect(m.carbon.capBinds).toBe(false); // B10
    expect(m.carbon.years).toHaveLength(10);
    for (const y of m.carbon.years) expect(y.net).toBeCloseTo(98040.0456, 4); // E14:E23
    expect(m.carbon.totalGross).toBeCloseTo(1032000.48, 2); // B31
    expect(m.carbon.totalAdminFee).toBeCloseTo(51600.024, 3); // B33
    expect(m.carbon.totalNet).toBeCloseTo(980400.456, 3); // B34
  });

  it("Financing: 60 payments at 8.39%", () => {
    expect(m.financing.financedAmount).toBeCloseTo(BW_PRICE, 6);
    expect(m.financing.nPayments).toBe(60);
    expect(m.financing.payment).toBeCloseTo(19489.58, 2); // B9
    expect(m.financing.totalPaid).toBeCloseTo(1169374.8, 1); // B10
    expect(m.financing.totalInterest).toBeCloseTo(216970.45, 2); // B11
    expect(m.financing.schedule).toHaveLength(60);
    expect(m.financing.schedule[59].closing).toBeCloseTo(0, 4);
  });

  it("Cashflow: total net, NPV, IRR, break-even and the monthly position", () => {
    const c = m.cashflow;
    expect(c.years[0].cashflow).toBeCloseTo(-BW_PRICE, 6); // D5
    expect(c.years[1].cashflow).toBeCloseTo(190939.4629632, 3); // D6
    expect(c.years[3].cumulative).toBeCloseTo(-240236.83, 2); // E8
    expect(c.years[4].cumulative).toBeCloseTo(54749.98, 2); // E9
    expect(c.totalNet).toBeCloseTo(1884029.56, 2); // B18
    expect(c.npv).toBeCloseTo(865720.38, 2); // B19
    expect(c.irr).toBeCloseTo(0.244219, 6); // B20
    expect(c.breakEvenYear).toBe(4); // B21
    expect(c.monthly).toHaveLength(60);
    expect(c.monthly[0].net).toBeCloseTo(-3577.96, 2); // E26
    expect(c.monthly[12].net).toBeCloseTo(292.85, 2); // E38
    expect(c.cumulativeMonthly).toBeCloseTo(144583.14, 2); // B87
    expect(c.firstPositivePeriod).toBe(13); // B88
  });

  it("Business_Model base case: every knob at zero reproduces the Cashflow tab, our position is nil", () => {
    const d = m.deal;
    expect(d.isBaseCase).toBe(true);
    expect(d.contributions.total).toBe(0); // B58
    expect(d.clientPrice).toBeCloseTo(BW_PRICE, 6); // B63
    expect(d.clientPayment).toBeCloseTo(19489.58, 2); // B64
    expect(d.paymentChange).toBeCloseTo(0, 9); // B65
    expect(d.years[0].clientTotal).toBeCloseTo(190939.4629632, 3); // H70
    expect(d.client.cashReceived).toBeCloseTo(2836433.9, 1); // B84
    expect(d.client.netPosition).toBeCloseTo(1884029.56, 2); // B85
    expect(d.client.npv).toBeCloseTo(865720.38, 2); // B86 = Cashflow!B19
    expect(d.client.irr).toBeCloseTo(0.244219, 6); // B87
    // BW's payback cell restarts the cumulative at year 1 and reports 1; the
    // capital-inclusive payback is year 4, the same year the Cashflow tab finds.
    expect(d.client.paybackYears).toBe(4);
    expect(d.ours.npv).toBe(0);
    expect(d.ours.irr).toBeNull(); // C87 "n/a"
    expect(d.ours.returnMultiple).toBeNull(); // C88
    expect(d.breakEvenCarbonShare).toBeNull(); // B90
    expect(d.guardRails.every((g) => g.ok)).toBe(true);
  });

  it("Business_Model with shares and a contribution: both sides' NPV, IRR, multiple, payback, break-even carbon share", () => {
    // 50% of the net carbon credit, 10% of net charging profit for 10 years;
    // in return 5% extra off hardware and $100k of capital. Expected values
    // re-derived independently in Python from the workbook's flows.
    const inputs = bwInputs();
    inputs.deal = {
      ...inputs.deal,
      name: "Carbon-share structure",
      carbonSharePct: 0.5,
      revenueSharePct: 0.1,
      revenueShareBasis: "profit",
      shareYears: 10,
      extraDiscountHardwarePct: 0.05,
      capitalContribution: 100000,
      minReturnMultiple: 2,
      maxContribution: 150000,
    };
    const d = computeModel(inputs, bwContext()).deal;
    expect(d.isBaseCase).toBe(false);
    expect(d.contributions.hardware).toBeCloseTo(17070.295, 3); // B53
    expect(d.contributions.taxRelief).toBeCloseTo(1237.596, 3); // B54
    expect(d.contributions.total).toBeCloseTo(118307.89, 2); // B58
    expect(d.clientPrice).toBeCloseTo(834096.46, 2); // B63
    expect(d.clientPayment).toBeCloseTo(17068.58, 2); // B64
    expect(d.paymentChange).toBeCloseTo(-2421.0, 1); // B65
    expect(d.years[0].carbonWeTake).toBeCloseTo(49020.0228, 4);
    expect(d.years[0].profitWeTake).toBeCloseTo(9289.94, 2);
    expect(d.client.cashReceived).toBeCloseTo(2160630.33, 2);
    expect(d.ours.cashReceived).toBeCloseTo(675803.57, 2);
    expect(d.client.npv).toBeCloseTo(543639.92, 2);
    expect(d.client.irr).toBeCloseTo(0.201158, 5);
    expect(d.ours.npv).toBeCloseTo(322080.46, 2);
    expect(d.ours.irr).toBeCloseTo(0.530134, 5);
    expect(d.ours.returnMultiple).toBeCloseTo(5.7122, 4);
    expect(d.client.paybackYears).toBe(5);
    expect(d.ours.paybackYears).toBe(2);
    expect(d.breakEvenCarbonShare).toBeCloseTo(0.183015, 5);
    expect(d.guardRails.find((g) => g.label.startsWith("Return on our capital"))!.ok).toBe(true);
    expect(d.guardRails.find((g) => g.label.startsWith("Contribution"))!.ok).toBe(true);
    // A gross-revenue share is taken before energy cost — bigger than the same share of profit.
    const gross = computeModel({ ...inputs, deal: { ...inputs.deal, revenueShareBasis: "gross" } }, bwContext()).deal;
    expect(gross.years[0].profitWeTake).toBeCloseTo(14343.14, 2);
    expect(gross.ours.cashReceived).toBeGreaterThan(d.ours.cashReceived);
  });

  it("policy switches: fixed at nameplate and manual subscribed kW; a block-priced schedule bills blocks", () => {
    const inputs = bwInputs();
    inputs.tariff.manual = { ...inputs.tariff.manual, blockKw: 50, blockPerMonth: 95.56, overagePerKw: 3.82 }; // PG&E BEV-2-S blocks
    const ramped = computeModel(inputs, bwContext()).tariff;
    expect(ramped.years[0].blocks).toBe(5); // 211.68 kW / 50 → 5 blocks
    expect(ramped.years[0].subscriptionCost).toBeCloseTo(5 * 95.56 * 12, 6);
    expect(ramped.years[9].blocks).toBe(13); // 635.04 / 50 → 13
    expect(ramped.flatAtNameplateTotal).toBeCloseTo(30 * 95.56 * 12 * 10, 6); // ROUNDUP(1468.8/50) = 30 blocks
    expect(ramped.savingFromRamping).toBeGreaterThan(0);
    expect(ramped.overage.oneMonthFullDraw).toBeCloseTo(776.16 * 3.82, 4);
    expect(ramped.overage.verdict).toMatch(/^Ramping is right/);
    const nameplate = computeModel({ ...inputs, tariff: { ...inputs.tariff, subscriptionPolicy: "nameplate" } }, bwContext()).tariff;
    expect(nameplate.years.every((y) => y.subscribedKw === nameplate.nameplateKw)).toBe(true);
    expect(nameplate.savingFromRamping).toBeCloseTo(0, 6);
    const manual = computeModel({ ...inputs, tariff: { ...inputs.tariff, subscriptionPolicy: "manual", manualSubscribedKw: 400 } }, bwContext()).tariff;
    expect(manual.years[5].subscribedKw).toBe(400);
    expect(manual.years[5].blocks).toBe(8);
    // Ramped subscription costs less than nameplate — that is the whole point of the ramp.
    expect(ramped.subscriptionTotal).toBeLessThan(nameplate.subscriptionTotal);
    // The all-in figure carries the fixed cost over the year's volume — worst in year 1.
    expect(ramped.year1AllInPerKwh).toBeGreaterThan(ramped.horizonAllInPerKwh);
  });

  it("customer and demand charges bill on top of energy, from the year they start", () => {
    const inputs = bwInputs();
    inputs.tariff.manual = { ...inputs.tariff.manual, customerPerMonth: 701.42, demandPerKwMonth: 10 };
    inputs.tariff.demandChargeFromYear = 5; // SCE FRD charges resume in 2030
    const t = computeModel(inputs, bwContext()).tariff;
    expect(t.years[0].customerChargeCost).toBeCloseTo(701.42 * 12, 6);
    expect(t.years[0].demandChargeCost).toBe(0);
    expect(t.years[4].demandChargeCost).toBeCloseTo(12 * 10 * t.years[4].peakDemandKw, 6);
    expect(t.years[4].utilityCost).toBeCloseTo(t.years[4].energyCost + t.years[4].fixedCost, 6);
  });

  it("the carbon cap truncates the credit when 1.5× net capex is smaller than the crediting period pays", () => {
    const ctx = { ...bwContext(), customerPrice: 400000 }; // cap = 600,000 < 1,032,000 gross
    const c = computeModel(bwInputs(), ctx).carbon;
    expect(c.capBinds).toBe(true);
    expect(c.years[5].capacityCredit).toBeCloseTo(600000 - 5 * 103200.048, 3); // year 6 takes what is left
    expect(c.years[6].capacityCredit).toBe(0);
    expect(c.totalGross).toBeCloseTo(600000, 3);
    // Grants reduce net capex and therefore the cap.
    const g = computeModel({ ...bwInputs(), carbon: { ...bwInputs().carbon, grantsAwarded: 100000 } }, ctx).carbon;
    expect(g.cap).toBeCloseTo(450000, 6);
  });

  it("financing switched off: no payment, no schedule, no monthly position; cashflow unchanged", () => {
    const inputs = bwInputs();
    inputs.financing = { ...inputs.financing, offered: false };
    const m2 = computeModel(inputs, bwContext());
    expect(m2.financing.payment).toBe(0);
    expect(m2.financing.schedule).toHaveLength(0);
    expect(m2.cashflow.monthly).toHaveLength(0);
    expect(m2.cashflow.npv).toBeCloseTo(m.cashflow.npv, 6);
    expect(m2.deal.clientPayment).toBe(0);
    // Down payment and "our scope only" basis move the financed amount, not the price.
    const down = computeModel({ ...bwInputs(), financing: { ...bwInputs().financing, downPayment: 100000 } }, bwContext()).financing;
    expect(down.financedAmount).toBeCloseTo(BW_PRICE - 100000, 6);
    expect(down.payment).toBeLessThan(m.financing.payment);
    const ours = computeModel({ ...bwInputs(), financing: { ...bwInputs().financing, financeBasis: "ours" } }, { ...bwContext(), clientProjectCost: BW_PRICE + 50000 }).financing;
    expect(ours.baseAmount).toBeCloseTo(BW_PRICE, 6);
  });
});

// ---------------------------------------------------------------------------
// Plumbing: the model computed from a real project
// ---------------------------------------------------------------------------

/** Best Western as a Quick Estimate: 4 × TP5-360 dual + 2 × CTX-C40 dual, SCE, 24/7. */
function bwProject(): Project {
  const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
  const quick = {
    ...defaultQuickInput(),
    clientName: "Best Western",
    lines: [
      { loadTypeId: "DCFC 360kW Dual", count: 4, sku: "TP5-360-480-2-300" },
      { loadTypeId: "L2 Dual 40A", count: 2, sku: "CTX-C40-240-2" },
    ],
  };
  const p = buildQuickProject(quick, base, "bw");
  p.setup.utility = "SCE — Southern California Edison";
  p.intake = { ...defaultIntake(), hoursOpen: 24, daysPerWeek: 7, rateSchedule: "TOU-EV-9" };
  return p;
}

describe("Business model — from a project", () => {
  it("site capacity from SKUs, generic models, dispensers and takeoff rows", () => {
    const bw = computeSiteCapacity(bwProject());
    expect(bw.source).toBe("quick");
    expect(bw.dcPositions).toBe(8);
    expect(bw.dcNameplateKw).toBe(1440);
    expect(bw.l2Positions).toBe(4);
    expect(bw.l2NameplateKw).toBeCloseTo(28.8, 9);

    const generic = computeSiteCapacity(buildQuickProject(defaultQuickInput(), defaultProject(), "g")); // 6 × DCFC 200kW + 5 × L2 Single 40A
    expect(generic.dcPositions).toBe(6);
    expect(generic.dcNameplateKw).toBe(1200);
    expect(generic.l2Positions).toBe(5);
    expect(generic.l2NameplateKw).toBeCloseTo(5 * 8.32, 9);

    const distributed = computeSiteCapacity(
      buildQuickProject(
        { ...defaultQuickInput(), lines: [{ loadTypeId: "Power cabinet 480kW", count: 1, sku: "CTX-DSPB-480" }], extras: [{ sku: "CTX-DST-2-300", count: 3 }] },
        defaultProject(),
        "d",
      ),
    );
    expect(distributed.cabinets).toBe(1);
    expect(distributed.dispensers).toBe(3);
    expect(distributed.dcNameplateKw).toBe(480);
    expect(distributed.dcPositions).toBe(6);

    // A hand-built project (no Quick Estimate) reads its takeoff rows.
    const manual = buildQuickProject(defaultQuickInput(), defaultProject(), "m");
    delete manual.quick;
    const fromTakeoff = computeSiteCapacity(manual);
    expect(fromTakeoff.source).toBe("takeoff");
    expect(fromTakeoff.dcPositions).toBe(6);
    expect(fromTakeoff.l2Positions).toBe(5);
  });

  it("the BW project reproduces the workbook's utilisation and carbon; SCE TOU-EV-9 is flagged NOT PUBLISHED", () => {
    const project = bwProject();
    const proposal = computeProposal(project, computeEstimate(project))!;
    const m = proposal.model;
    expect(m.context.dcPositions).toBe(8);
    expect(m.context.hoursPerDay).toBe(24);
    expect(m.context.daysPerYear).toBe(365);
    expect(m.usage.dc.powerPerPosition).toBeCloseTo(176.4, 6);
    expect(m.usage.siteKwhPerYear).toBeCloseTo(441327.3984, 3);
    expect(m.carbon.netPerYear).toBeCloseTo(98040.0456, 4);
    // Post-contract service: 4 DC units at the 2.9.0 book's DC-360 year-3 rate ($8,949.96; BW's 1.6.0 book
    // had $9,318.015) + 2 AC duals at theirs ($736.11), plus 12 ports of EVOLV.
    expect(m.context.annualNetworkFee).toBeCloseTo(12 * 39.99 * 12, 2);
    expect(m.context.annualServiceAfterContract).toBeCloseTo(4 * 8949.96 + 2 * 736.11, 2);
    // The 2.9.0 library carries SCE TOU-EV-9 with no published $/kWh.
    expect(m.tariff.basis).toBe("library");
    expect(m.tariff.status).toBe("NOT PUBLISHED");
    expect(m.tariff.blendedPerKwh).toBe(0);
    expect(m.tariff.warnings.some((w) => /NOT PUBLISHED/.test(w))).toBe(true);
    // Financing follows the customer price; the deal's base case ties to the cashflow.
    expect(m.financing.financedAmount).toBeCloseTo(proposal.costBuildup.customerPrice, 6);
    expect(m.cashflow.years[0].cashflow).toBeCloseTo(-proposal.margin.clientProjectCost, 6);
    expect(m.deal.client.npv).toBeCloseTo(m.cashflow.npv, 6);
  });

  it("a verified PG&E schedule prices energy and subscription blocks from the library", () => {
    const project = bwProject();
    project.setup.utility = "PG&E — Pacific Gas and Electric";
    project.intake = { ...project.intake!, rateSchedule: "BEV-2-S" };
    const m = computeProposal(project, computeEstimate(project))!.model;
    expect(m.tariff.status).toBe("VERIFIED");
    expect(m.tariff.warnings).toHaveLength(0);
    expect(m.tariff.rates.blockKw).toBe(50);
    expect(m.tariff.blendedPerKwh).toBeCloseTo(0.36977 * 0.3 + 0.15654 * 0.55 + 0.13327 * 0.15, 9);
    expect(m.tariff.years[0].blocks).toBe(5);
    expect(m.tariff.years[0].subscriptionCost).toBeCloseTo(5 * 95.56 * 12, 6);
    expect(m.revenue.years[0].utilityCost).toBeCloseTo(m.tariff.years[0].energyCost + m.tariff.years[0].subscriptionCost, 6);
    // Schedule picked off the generic list for a utility the library has not researched resolves by name, with a note.
    const found = findRateRow("Lodi Electric Utility", "BEV-1");
    expect(found.row?.utility).toMatch(/^PG&E/);
    expect(found.note).toMatch(/Rates taken from/);
    expect(findRateRow("SCE — Southern California Edison", "BEV-1").row).toBeUndefined();
  });

  it("a flat schedule with no time-of-use split prices at the single rate; a folded super-off share warns", () => {
    const project = bwProject();
    project.setup.utility = "Alameda Municipal Power";
    project.intake = { ...project.intake!, rateSchedule: "Schedule A-3" };
    project.commercial!.tariff = { ...modelInputsOf(project.commercial).tariff, touShares: null };
    const flat = computeProposal(project, computeEstimate(project))!.model.tariff;
    expect(flat.isFlat).toBe(true);
    expect(flat.blendedPerKwh).toBeCloseTo(0.14673, 9);
    expect(flat.years[0].demandChargeCost).toBeCloseTo(12 * 17.96 * flat.years[0].peakDemandKw, 6);
    expect(flat.years[0].customerChargeCost).toBeCloseTo(573.6 * 12, 6);

    project.setup.utility = "IID — Imperial Irrigation District";
    project.intake = { ...project.intake!, rateSchedule: "TOU-GL" };
    project.commercial!.tariff = { ...modelInputsOf(project.commercial).tariff, touShares: { peak: 0.3, offPeak: 0.55, superOffPeak: 0.15 } };
    const folded = computeProposal(project, computeEstimate(project))!.model.tariff;
    expect(folded.touShares.peak).toBeCloseTo(0.3, 12);
    expect(folded.touShares.offPeak).toBeCloseTo(0.7, 12);
    expect(folded.touShares.superOffPeak).toBe(0);
    expect(folded.blendedPerKwh).toBeCloseTo(0.2873 * 0.3 + 0.0821 * 0.7, 9);
    expect(folded.warnings.some((w) => /super off-peak/.test(w))).toBe(true);
  });

  it("intake hours and days feed the utilisation; a project without a commercial section has no model", () => {
    const project = bwProject();
    project.intake = { ...project.intake!, hoursOpen: 12, daysPerWeek: 5 };
    const m = computeProposal(project, computeEstimate(project))!.model;
    expect(m.context.hoursPerDay).toBe(12);
    expect(m.context.daysPerYear).toBe(261);
    expect(m.usage.dc.chargingHoursPerStall).toBeCloseTo(3, 9);
    const none = { ...project, commercial: undefined };
    expect(computeProposal(none, computeEstimate(none))).toBeNull();
  });

  it("never touches Total Cost or the estimate: identical with and without the model sections", () => {
    const project = bwProject();
    const plain = computeEstimate({ ...project, commercial: undefined });
    project.commercial = { ...project.commercial!, ...modelInputsOf(undefined), deal: { ...modelInputsOf(undefined).deal, carbonSharePct: 0.5 } };
    const withModel = computeEstimate(project);
    expect(JSON.stringify(withModel)).toBe(JSON.stringify(plain));
    const proposal = computeProposal(project, withModel)!;
    expect(proposal.costBuildup.estimatorTotalCost).toBe(plain.costs.totalCost);
    expect(proposal.model.deal.isBaseCase).toBe(false);
  });

  it("a commercial section saved before the model existed gets the intake's defaults", () => {
    const inputs = modelInputsOf({ financing: { ...modelInputsOf(undefined).financing, annualRate: 0.07 } });
    expect(inputs.financing.annualRate).toBe(0.07);
    expect(inputs.financing.horizonYears).toBe(10);
    expect(inputs.revenue.retailPerKwh).toBe(0.65);
    expect(inputs.carbon.fciRatePerKwYear).toBe(71.6667);
    expect(inputs.deal.minReturnMultiple).toBe(2);
    expect(inputs.tariff.subscriptionPolicy).toBe("ramped");
  });
});
