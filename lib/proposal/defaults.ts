import type {
  CarbonInput,
  CommercialInput,
  DealInput,
  FinancingInput,
  IntakeInput,
  MarginAssumptions,
  ModelInputs,
  RevenueInput,
  ServiceTerms,
  TariffInput,
  TariffRates,
} from "./types";

/** Engine cost lines billed at exactly cost (intake 2.9.0 pass-through policy). */
export const DEFAULT_PASS_THROUGH_LINES = ["Permits", "Utility"];

/**
 * The Business_Model cost-basis assumptions from the Best Western model.
 * Every one of them is a stand-in until a real cost is known — the tab says
 * so next to each field.
 */
export function defaultMarginAssumptions(): MarginAssumptions {
  return {
    hardwarePctOfList: 0.294, // BW: $118,107 cost on $401,654 list
    servicePctOfPrice: 0.55,
    evolvPctOfPrice: 0.45,
    designPctOfPrice: 0.6,
    interconnectPctOfPrice: 0.7,
    contingencySpendShare: 0.5,
    pmInternalCostPct: 0.3,
  };
}

/** Intake 2.9.0 Commercial tab: 5-year contract, EVOLV $39.99 per port per month, price-book service classes. */
export function defaultServiceTerms(): ServiceTerms {
  return { basis: "price-book", contractYears: 5, evolvPerPortMonth: 39.99 };
}

export function defaultIntake(): IntakeInput {
  return {
    contactName: "",
    contactTitle: "",
    contactEmail: "",
    contactPhone: "",
    propertyType: "",
    publicAccess: "",
    hoursOpen: null,
    daysPerWeek: null,
    state: "California",
    rateSchedule: "",
    existingServiceA: null,
    existingServiceVoltage: null,
    separatelyMeteredEv: "",
    proposalDate: "",
    validityDays: 30,
    projectReference: "",
    notes: "",
  };
}

/**
 * Commercial terms as the EVSE Project Intake 2.9.0 ships them: 20% markup
 * on materials and on labour, 7% off hardware, service and in-house work,
 * nothing off EVOLV, fees passed through at cost, full scope with ZIE.
 */
export function defaultCommercial(): CommercialInput {
  return {
    markupMaterialsPct: 0.2,
    markupLaborPct: 0.2,
    discountHardwarePct: 0.07,
    discountServicePct: 0.07,
    discountEvolvPct: 0,
    discountInHousePct: 0.07,
    taxConstructionMaterials: true,
    passThroughLines: [...DEFAULT_PASS_THROUGH_LINES],
    utilityInterconnectFee: 0,
    additionalScope: 0,
    scope: {
      hardware: "we",
      service: "we",
      evolv: "we",
      salesTax: "we",
      design: "we",
      construction: "we",
      interconnect: "we",
      additional: "we",
    },
    margin: defaultMarginAssumptions(),
    serviceTerms: defaultServiceTerms(),
  };
}

// ---------------------------------------------------------------------------
// Business model defaults — intake 2.9.0 Revenue / Carbon / Commercial /
// Deal_Structure tabs, with the BW model's figures where the intake leaves a
// cell blank (time-of-use mix, subscription policy).
// ---------------------------------------------------------------------------

/** National DC fast-charging activity — Paren, US EV Fast Charging Q2 2026 (via BW_Model_5 Benchmarks). Refresh quarterly. */
export const MARKET_ACTIVITY = {
  sessionsPerPortMonth: 214,
  /** Total sessions, June 2026 against June 2025. */
  sessionsYoY: 0.29,
  /** Station count, year on year. */
  stationsYoY: 0.164,
  source: "Paren, US EV Fast Charging Report, Q2 2026",
} as const;

/** Sessions growth net of new supply — the market's implied per-port growth. */
export function impliedMarketGrowth(): number {
  return (1 + MARKET_ACTIVITY.sessionsYoY) / (1 + MARKET_ACTIVITY.stationsYoY) - 1;
}

export function zeroRates(): TariffRates {
  return {
    peakPerKwh: 0,
    offPeakPerKwh: 0,
    superOffPeakPerKwh: 0,
    customerPerMonth: 0,
    demandPerKwMonth: 0,
    blockKw: 0,
    blockPerMonth: 0,
    overagePerKw: 0,
  };
}

/** Rate library row for the Setup utility + Intake schedule; BW's 30 / 55 / 15 time-of-use mix; ramped subscription with the BW factors. */
export function defaultTariff(): TariffInput {
  return {
    basis: "library",
    manual: zeroRates(),
    touShares: { peak: 0.3, offPeak: 0.55, superOffPeak: 0.15 },
    subscriptionPolicy: "ramped",
    manualSubscribedKw: 0,
    peakToAverageFactor: 4,
    safetyMarginPct: 0.2,
    sizeDemandOnFullRating: true,
    demandChargeFromYear: 1,
    provenance: { source: "", verified: "", verifiedBy: "", eligibilityThreshold: "", crossesThreshold: "" },
  };
}

/** Intake 2.9.0 Revenue tab: $0.65/kWh, 3% card fees, 20% occupancy, 25% charging share, 0.98 de-rate, 0.70 taper, 50/75/100% ramp, 6% growth. */
export function defaultRevenue(): RevenueInput {
  return {
    retailPerKwh: 0.65,
    cardFeePct: 0.03,
    idleFeeRevenue: false,
    stallOccupancy: 0.2,
    chargingHoursShare: 0.25,
    deratingFactor: 0.98,
    taperFactor: 0.7,
    rampYear1: 0.5,
    rampYear2: 0.75,
    rampYear3: 1,
    growthAfterRamp: 0.06,
    benchmarkState: "California",
  };
}

/** Intake 2.9.0 Carbon tab: FCI $71.6667/kW/yr for 10 years, 5% aggregator, 1.5× net-capex cap, L2 consumption credit $0.0045/kWh. */
export function defaultCarbon(): CarbonInput {
  return {
    qualifies: "",
    permitClears2022: "",
    applicationFiled: "",
    aggregator: "",
    aggregatorSharePct: 0.05,
    fciRatePerKwYear: 71.6667,
    creditingYears: 10,
    l2CreditPerKwh: 0.0045,
    capMultiple: 1.5,
    grantsAwarded: 0,
    federalItc: "No",
    stateProgramme: "",
    stateProgrammeOutcome: "",
  };
}

/** Intake 2.9.0 Commercial tab: De Lage Landen, 8.39% over 5 years, monthly, no down payment; 10-year horizon discounted at the financing rate. */
export function defaultFinancing(): FinancingInput {
  return {
    offered: true,
    lender: "De Lage Landen",
    annualRate: 0.0839,
    termYears: 5,
    paymentsPerYear: 12,
    downPayment: 0,
    startDate: "",
    horizonYears: 10,
    discountRate: 0.0839,
    financeBasis: "whole",
  };
}

/** Intake 2.9.0 Deal_Structure tab: every knob at zero — a straight sale; guard rails 2× on our capital. */
export function defaultDeal(): DealInput {
  return {
    name: "Base case — no share",
    carbonSharePct: 0,
    revenueSharePct: 0,
    revenueShareBasis: "profit",
    shareYears: 10,
    extraDiscountHardwarePct: 0,
    extraDiscountConstructionPct: 0,
    extraDiscountServicePct: 0,
    capitalContribution: 0,
    minClientNpv: 0,
    minReturnMultiple: 2,
    maxContribution: 0,
  };
}

/** The model's inputs with the intake's defaults filled in for any section a saved commercial section lacks. */
export function modelInputsOf(commercial: Pick<CommercialInput, "tariff" | "revenue" | "carbon" | "financing" | "deal"> | undefined): ModelInputs {
  return {
    tariff: { ...defaultTariff(), ...commercial?.tariff },
    revenue: { ...defaultRevenue(), ...commercial?.revenue },
    carbon: { ...defaultCarbon(), ...commercial?.carbon },
    financing: { ...defaultFinancing(), ...commercial?.financing },
    deal: { ...defaultDeal(), ...commercial?.deal },
  };
}
