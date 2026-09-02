// Proposal layer — the CEO's commercial model (EVSE Project Intake 2.9.0 and
// the Best Western project model) on top of the estimator's cost result.
//
// The estimator stops at Total Cost. This layer turns that cost into a
// customer price (markups, discounts, pass-through fees, tax rules), then a
// margin by line and a scope of supply. It only READS the estimator's result;
// nothing here changes a number under lib/calc.
//
// Everything is optional on a Project: a body saved before the layer existed
// has no `commercial` section and behaves exactly as before.

import type { CostLine } from "../calc/types";

export type ScopeStatus = "we" | "others" | "none";

/** The Business_Model rows — one per service line ZIE can provide, hand to a third party, or drop. */
export const SCOPE_LINES = [
  "hardware",
  "service",
  "evolv",
  "salesTax",
  "design",
  "construction",
  "interconnect",
  "additional",
] as const;
export type ScopeLine = (typeof SCOPE_LINES)[number];

export const SCOPE_LABELS: Record<ScopeLine, string> = {
  hardware: "Charger hardware — procurement and sale",
  service: "Extended warranty and O&M service",
  evolv: "EVOLV platform and commissioning",
  salesTax: "Sales tax on chargers",
  design: "Design and engineering",
  construction: "Construction — all-inclusive",
  interconnect: "Utility interconnection management",
  additional: "Additional or unforeseen scope",
};

/** Cost-side assumptions the margin view needs (the Business_Model blue cells). */
export interface MarginAssumptions {
  /** Our all-in hardware cost when known (dealer price × units). Wins over hardwarePctOfList. */
  hardwareCostTotal?: number;
  /** Our hardware cost as a share of list price. BW basis: $118,107 on $401,654 list ≈ 29.4%. */
  hardwarePctOfList: number;
  /** Cost of the service and warranty line as a share of its price (BW: 55%). */
  servicePctOfPrice: number;
  /** EVOLV platform fees paid through to the vendor, as a share of price (BW: 45%). */
  evolvPctOfPrice: number;
  /** In-house design hours at cost, as a share of the design price (BW: 60%). */
  designPctOfPrice: number;
  /** Rule 29 application and coordination cost, as a share of price (BW: 70%). */
  interconnectPctOfPrice: number;
  /** Share of the construction contingency reserve expected to be spent (BW: 50%). */
  contingencySpendShare: number;
  /** Internal cost of the construction PM fee, as a share of its price (BW: 30%). */
  pmInternalCostPct: number;
}

/**
 * Service and network terms (intake 2.9.0 Commercial tab). With the
 * price-book basis, lib/skus derives extended warranty, service and EVOLV
 * network fees from the price book's service classes and these terms; the
 * legacy "allowance" basis keeps the estimator's commissioning allowances.
 */
export interface ServiceTerms {
  basis: "price-book" | "allowance";
  /** Service contract length in years (intake: 5). */
  contractYears: number;
  /** EVOLV network fee per port per month (intake: $39.99). */
  evolvPerPortMonth: number;
  /** Override the price book's included-warranty years (DC classes 2, AC 1). */
  includedWarrantyYears?: number;
}

/** The CEO intake's Project tab: who the client is, what the site is, which utility serves it, and the proposal's metadata. */
export interface IntakeInput {
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  propertyType: string;
  publicAccess: "" | "Yes" | "No";
  hoursOpen: number | null;
  daysPerWeek: number | null;
  state: string;
  rateSchedule: string;
  existingServiceA: number | null;
  existingServiceVoltage: number | null;
  separatelyMeteredEv: "" | "Yes" | "No" | "Unknown";
  proposalDate: string;
  validityDays: number | null;
  projectReference: string;
  notes: string;
  /** Fields the intake importer fills that the first Intake tab did not carry — all optional. */
  siteName?: string;
  county?: string;
  /** Days open per year (intake Project!B23). Wins over daysPerWeek for the model when set. */
  daysOpenPerYear?: number | null;
  /** The schedule the site is billed on today, from a recent bill (Project!B27). */
  currentRateSchedule?: string;
  billsObtained?: "" | "Yes" | "No";
  /** Community choice aggregator, if any — changes only the generation $/kWh. */
  cca?: string;
  /** Utility interconnection record — the intake's Rule 29 block (lib/interconnection). */
  interconnection?: import("../interconnection").InterconnectionInput;
  /** Document control for the handoff (the intake's Version tab): this file's revision, who completed it, what changed. */
  fileVersion?: string;
  completedBy?: string;
  revisionNotes?: string;
  /**
   * Whether the filled intake carries the estimator's construction and
   * engineering figures in its Overrides register (default true) — the
   * CEO's engine then prices the job on the estimator's numbers while the
   * intake's own derivation stays visible beside them.
   */
  carryEstimatorOverrides?: boolean;
}

export interface CommercialInput {
  /** Markup on materials-class construction lines: switchgear, conductor, conduit, site works, rentals. Intake 2.9.0: 20%. */
  markupMaterialsPct: number;
  /** Markup on labour and construction PM, applied after contingency. Intake 2.9.0: 20%. */
  markupLaborPct: number;
  /** Discounts off list / off in-house prices. Intake 2.9.0 defaults 7% / 7% / 0 / 7%. */
  discountHardwarePct: number;
  discountServicePct: number;
  discountEvolvPct: number;
  /** Applies ONLY to work ZIE performs: labour, construction PM, design and engineering. Never to materials or rentals. */
  discountInHousePct: number;
  /**
   * Sales tax on the marked-up materials-class lines, as its own row. On by
   * default (California taxes materials; the estimator's Total Cost taxes its
   * loaded construction subtotal the RFC_V18 way). The BW model taxed only
   * the discounted hardware — switch this off to reproduce it.
   */
  taxConstructionMaterials: boolean;
  /**
   * Estimator cost lines billed at exactly cost — no contingency, no markup,
   * no discount (intake 2.9.0: "charges levied by someone else"). Matched by
   * engine line name; default ["Permits", "Utility"].
   */
  passThroughLines: string[];
  /** Utility interconnection (Rule 29 design / application) fee — pass-through. */
  utilityInterconnectFee: number;
  /** Anything the standard build does not cover — pass-through. */
  additionalScope: number;
  /**
   * Utility line-extension contribution (PG&E Rules 15/16 and the ITCC gross-up
   * on it), if the utility's design triggers one — pass-through at cost.
   * 0 / absent = excluded by name in the proposal.
   */
  lineExtensionContribution?: number;
  scope: Record<ScopeLine, ScopeStatus>;
  margin: MarginAssumptions;
  /** Absent on commercial sections created before the SKU layer — read through serviceTermsOf(). */
  serviceTerms?: ServiceTerms;
  /**
   * The downstream business model (intake 2.9.0 Revenue / Carbon / Commercial
   * financing / Deal_Structure tabs; BW_Model_5's Utility_Rates, Revenue,
   * Carbon, Financing, Cashflow and Business_Model sheets). Each section is
   * optional — read them through modelInputsOf(), which fills the intake's
   * defaults for anything a saved project does not carry.
   */
  tariff?: TariffInput;
  revenue?: RevenueInput;
  carbon?: CarbonInput;
  financing?: FinancingInput;
  deal?: DealInput;
}

export type UpliftClass = "materials" | "labor" | "passThrough" | "equipment" | "inHouse" | "tax";
export type BuildupGroup = "equipment" | "design" | "construction" | "passThrough" | "additional";

export interface BuildupRow {
  id: string;
  label: string;
  group: BuildupGroup;
  scopeLine: ScopeLine;
  uplift: UpliftClass;
  /** Estimator cost as the estimator carries it (contingency-loaded where it loads it). */
  cost: number;
  /** Base before contingency and the contingency dollars, for the margin build-up (construction rows). */
  base?: number;
  contingency?: number;
  /** Before discounts: cost with markup on construction rows, MSRP / list on equipment. */
  list: number;
  discountPct: number;
  /** What the customer pays for the row. */
  price: number;
  note?: string;
}

export interface CostBuildupResult {
  rows: BuildupRow[];
  equipmentList: number;
  equipmentPrice: number;
  designList: number;
  designPrice: number;
  constructionList: number;
  constructionPrice: number;
  passThroughTotal: number;
  constructionTaxPrice: number;
  listTotal: number;
  customerPrice: number;
  discountToCustomer: number;
  /** The estimator's Total Cost, unchanged, for the side-by-side. */
  estimatorTotalCost: number;
}

export interface ScopeRow {
  line: ScopeLine;
  label: string;
  status: ScopeStatus;
  price: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  /** Price that leaves our contract when a third party supplies the line. */
  thirdParty: number;
  /** What the client still pays for the line (ours or third-party's). */
  toClient: number;
  basis: string;
}

export interface ConstructionBuildupRow {
  component: string;
  price: number;
  baseCost: number;
  contingency: number;
  expectedCost: number;
  margin: number;
  marginPct: number | null;
  note: string;
}

export interface MarginResult {
  rows: ScopeRow[];
  contractValue: number;
  ourCost: number;
  grossMargin: number;
  marginRate: number | null;
  thirdPartyTotal: number;
  clientProjectCost: number;
  largestMarginLine?: { label: string; share: number };
  construction: {
    rows: ConstructionBuildupRow[];
    total: ConstructionBuildupRow;
    /** Margin if no contingency dollar is spent / if every one is. */
    ifContingencyClean: number;
    ifContingencySpent: number;
  };
  scopeCheck: string;
}

// ---------------------------------------------------------------------------
// Business model — inputs
// ---------------------------------------------------------------------------

/** How the demand subscription is set each year (BW Utility_Rates!B57). */
export type SubscriptionPolicy = "ramped" | "nameplate" | "manual";

/** One schedule's bill, decomposed (intake 2.9.0 Revenue rows 91-100 + RateLibrary columns). */
export interface TariffRates {
  peakPerKwh: number;
  offPeakPerKwh: number;
  superOffPeakPerKwh: number;
  /** Fixed monthly meter charge. */
  customerPerMonth: number;
  /** $/kW-month on billing demand; 0 on a schedule with no demand charge. */
  demandPerKwMonth: number;
  /** Subscription block size (kW); 0 when the schedule sells no blocks. */
  blockKw: number;
  blockPerMonth: number;
  /** Charged on demand above the subscribed level. */
  overagePerKw: number;
}

export interface TouShares {
  peak: number;
  offPeak: number;
  superOffPeak: number;
}

export interface TariffInput {
  /**
   * "library": the rate-library row for the Setup utility and the Intake
   * rate schedule; "manual": the rates below (a bill, a rate quotation, a
   * schedule the library has not researched).
   */
  basis: "library" | "manual";
  manual: TariffRates;
  /** Share of energy dispensed in each period; null on a flat schedule (energy then prices at the peak rate). */
  touShares: TouShares | null;
  subscriptionPolicy: SubscriptionPolicy;
  /** Subscribed kW when the policy is "manual". */
  manualSubscribedKw: number;
  /** Ratio of peak simultaneous draw to the daily average (BW: 4). */
  peakToAverageFactor: number;
  /** Headroom above projected peak before overage bites (BW: 20%). */
  safetyMarginPct: number;
  /** A vehicle at the start of a session draws full power — size demand on the port rating, not the tapered average. */
  sizeDemandOnFullRating: boolean;
  /** First model year a $/kW-month demand charge bills (SCE's facilities-related demand charges resume 1 Jan 2030). */
  demandChargeFromYear: number;
  /** Tariff provenance — printed on the proposal at the point of use (intake 2.9.0 Revenue rows 82-86). */
  provenance: {
    source: string;
    verified: "" | "Yes" | "No";
    verifiedBy: string;
    eligibilityThreshold: string;
    crossesThreshold: "" | "Yes" | "No";
  };
}

export interface RevenueInput {
  /** Retail price to the driver, $/kWh (intake: $0.65). */
  retailPerKwh: number;
  /** Card processing, share of gross (3%). */
  cardFeePct: number;
  /** Keep No unless it is contracted — informational, nothing is counted. */
  idleFeeRevenue: boolean;
  /** Share of stalls used per day (20%). */
  stallOccupancy: number;
  /** Charging hours per occupied stall, as a share of open hours (25%). */
  chargingHoursShare: number;
  /** Cabinet output vs label (0.98). */
  deratingFactor: number;
  /** Average delivered power as a share of the port rating — the charging-curve taper (0.70). */
  taperFactor: number;
  rampYear1: number;
  rampYear2: number;
  rampYear3: number;
  /** Annual growth after the ramp (6%). */
  growthAfterRamp: number;
  /** Market the projection is tested against (lib/ref/benchmarks). */
  benchmarkState: string;
}

export interface CarbonInput {
  qualifies: "" | "Yes" | "No" | "Pending";
  permitClears2022: "" | "Yes" | "No";
  applicationFiled: string;
  aggregator: string;
  /** Third-party administrator's share of proceeds (5%) — a disclosed cost, never our revenue. */
  aggregatorSharePct: number;
  /** FCI capacity credit, $/kW/yr on DC nameplate ($71.6667). */
  fciRatePerKwYear: number;
  creditingYears: number;
  /** Level 2 consumption credit, $/kWh dispensed by L2 (0.0045). 0 excludes it. */
  l2CreditPerKwh: number;
  /** FCI revenue stops at this multiple of net capex (1.5×). */
  capMultiple: number;
  /** Grants or rebates awarded — reduce net capex and therefore the cap. */
  grantsAwarded: number;
  federalItc: "" | "Yes" | "No";
  stateProgramme: string;
  stateProgrammeOutcome: string;
}

export interface FinancingInput {
  offered: boolean;
  lender: string;
  annualRate: number;
  termYears: number;
  paymentsPerYear: number;
  downPayment: number;
  startDate: string;
  /** Model horizon in years — 10, the carbon credit's crediting period. */
  horizonYears: number;
  /** Discount rate for NPV — default the financing rate. */
  discountRate: number;
  /** Whether the client finances the whole project (third-party scope too) or only our contract value. */
  financeBasis: "whole" | "ours";
}

export interface DealInput {
  name: string;
  /** Our share of the net carbon credit (0 = client keeps all of it). */
  carbonSharePct: number;
  /** Our share of charging revenue. */
  revenueSharePct: number;
  revenueShareBasis: "profit" | "gross";
  /** Years the shares run — cannot exceed the model horizon. */
  shareYears: number;
  /** What we give in return, on top of the discounts already in the base price. */
  extraDiscountHardwarePct: number;
  extraDiscountConstructionPct: number;
  extraDiscountServicePct: number;
  /** Cash or hardware we fund outright. */
  capitalContribution: number;
  /** Guard rails the model reports against. */
  minClientNpv: number;
  minReturnMultiple: number;
  /** Hard ceiling on our exposure; 0 = none set. */
  maxContribution: number;
}

/** Override-register figures the business model honours (lib/overrides modelOverridesOf). */
export interface ModelOverrides {
  /** Forces the steady-state site kWh per day (a traffic study, a comparable site). */
  kwhPerDay?: number;
  /** Forces the gross capacity credit per year (the figure the aggregator confirms in writing). */
  carbonGrossPerYear?: number;
  /** Forces the loan payment per period (the lender's quote). */
  loanPayment?: number;
  /** Forces the delivered energy cost, $/kWh (twelve months of billing). */
  blendedPerKwh?: number;
  /** Forces the utility's fixed and demand cost, $/yr, every year. */
  fixedUtilityPerYear?: number;
}

export interface ModelInputs {
  tariff: TariffInput;
  revenue: RevenueInput;
  carbon: CarbonInput;
  financing: FinancingInput;
  deal: DealInput;
  overrides?: ModelOverrides;
}

/** A replacement site's metered history (lib/existing), when the revenue basis is historical actuals. */
export interface HistoricalBasis {
  revenueBasis: "market" | "historical";
  months: number;
  /** Historical kWh per year — the run rate. */
  kwhPerYear: number;
  /** History × the stated uplifts — what the projection uses at steady state. */
  projectedKwhPerYear: number;
  impliedRetailPerKwh: number;
  impliedDeliveredPerKwh: number;
}

/**
 * What the model needs from the rest of the project: the equipment, the
 * access policy, the utility, the price layer. Built by modelContextOf(); the
 * BW replay feeds the workbook's own figures in directly.
 */
export interface ModelContext {
  /** DC charging positions (connectors) and DC nameplate kW — the FCI basis. */
  dcPositions: number;
  dcNameplateKw: number;
  l2Positions: number;
  /** Nameplate kW per L2 position (7.2 for the CTX L2 line; the load type's kW per port for generic models). */
  l2KwPerPosition: number;
  hoursPerDay: number;
  daysPerYear: number;
  utility: string;
  schedule: string;
  /** The Cost Buildup's customer price (full scope) — the carbon cap's net-capex basis. */
  customerPrice: number;
  /** Business Model totals: what we sell, and what the client pays in total (ours + third-party). */
  contractValue: number;
  clientProjectCost: number;
  /** Prices of the lines we provide, for the deal-structure concessions (0 when a line is by others / not required). */
  hardwarePrice: number;
  constructionPrice: number;
  servicePrice: number;
  salesTaxPct: number;
  /** Service contract length; after it, the site pays warranty + service at the year-3 class rate and the network fee itself. */
  contractYears: number;
  annualServiceAfterContract: number;
  annualNetworkFee: number;
  /** Notes about how the context was derived (equipment source, stand-ins). */
  notes: string[];
  /** Present on a replacement site with history entered on the Existing tab. */
  historical?: HistoricalBasis;
}

// ---------------------------------------------------------------------------
// Business model — results
// ---------------------------------------------------------------------------

export interface UsageYear {
  year: number;
  /** Share of steady state: the ramp, then growth. */
  ramp: number;
  dcKwh: number;
  l2Kwh: number;
  kwh: number;
}

export interface UsageResult {
  /** Where the steady state comes from: the greenfield build-up, a replacement site's history × uplifts, or a forced kWh/day. */
  basis: "greenfield" | "historical" | "override";
  basisNote: string;
  hoursPerDay: number;
  daysPerYear: number;
  dc: {
    positions: number;
    nameplateKw: number;
    /** Nameplate ÷ positions × de-rate. */
    powerPerPosition: number;
    /** De-rated, then tapered. */
    avgDeliveredKw: number;
    stallsInUse: number;
    chargingHoursPerStall: number;
    stallHoursPerDay: number;
    kwhPerDay: number;
    kwhPerYear: number;
  };
  l2: {
    positions: number;
    powerPerPosition: number;
    stallsInUse: number;
    chargingHoursPerStall: number;
    kwhPerDay: number;
    kwhPerYear: number;
  };
  siteKwhPerDay: number;
  siteKwhPerYear: number;
  years: UsageYear[];
}

export interface TariffYear {
  year: number;
  kwh: number;
  kwhPerDay: number;
  avgConcurrentPorts: number;
  peakConcurrentPorts: number;
  peakDemandKw: number;
  subscribedKw: number;
  blocks: number;
  subscriptionCost: number;
  demandChargeCost: number;
  customerChargeCost: number;
  /** Subscription + demand + customer charges — the year's fixed utility cost. */
  fixedCost: number;
  energyCost: number;
  utilityCost: number;
  allInPerKwh: number;
}

export interface TariffResult {
  utility: string;
  schedule: string;
  basis: "library" | "manual";
  /** The library row's STATUS (VERIFIED / PARTIAL / NOT PUBLISHED / PLACEHOLDER …) or the manual basis. */
  status: string;
  rates: TariffRates;
  /** Effective shares after folding a super-off-peak share into off-peak on a schedule with no super-off period. */
  touShares: TouShares;
  isFlat: boolean;
  blendedPerKwh: number;
  nameplateKw: number;
  fullAtOnceKw: number;
  years: TariffYear[];
  subscriptionTotal: number;
  /** Ten years of subscription at full nameplate, for comparison. */
  flatAtNameplateTotal: number;
  savingFromRamping: number;
  year1AllInPerKwh: number;
  year10AllInPerKwh: number;
  horizonAllInPerKwh: number;
  overage: {
    unsubscribedKw: number;
    /** Cost of one month at full simultaneous draw, at the overage rate. */
    oneMonthFullDraw: number;
    /** Worst-case months the ramping saving would absorb; null when the schedule has no overage rate. */
    monthsAbsorbed: number | null;
    verdict: string;
  };
  warnings: string[];
}

export interface RevenueYear {
  year: number;
  ramp: number;
  kwh: number;
  grossRevenue: number;
  utilityCost: number;
  cardFees: number;
  serviceAndNetwork: number;
  chargingProfit: number;
}

export interface BenchmarkResult {
  state: string;
  benchmarkUtilisation: number | null;
  benchmarkPricePerKwh: number | null;
  /** kWh/day the site would deliver at the state's average port utilisation. */
  kwhPerDayAtBenchmark: number | null;
  /** This model's steady-state kWh/day as a share of the benchmark. */
  siteFactor: number | null;
  /** Retail price against the state average; positive means above the market. */
  priceVsMarket: number | null;
  impliedMarketGrowth: number;
  growthVerdict: string;
}

export interface RevenueResult {
  years: RevenueYear[];
  /** Warranty + service at the year-3 class rate plus the network fee, once the contract ends. */
  postContractServicePerYear: number;
  contractYears: number;
  benchmark: BenchmarkResult;
}

export interface CarbonYear {
  year: number;
  cumulativeBefore: number;
  capacityCredit: number;
  cumulativeAfter: number;
  l2Kwh: number;
  l2Credit: number;
  gross: number;
  net: number;
}

export interface CarbonResult {
  dcNameplateKw: number;
  grossPerYear: number;
  netPerYear: number;
  netCapex: number;
  cap: number;
  grossAcrossPeriod: number;
  capBinds: boolean;
  years: CarbonYear[];
  totalGross: number;
  totalAdminFee: number;
  totalNet: number;
}

export interface AmortizationRow {
  n: number;
  opening: number;
  payment: number;
  principal: number;
  interest: number;
  closing: number;
}

export interface FinancingResult {
  offered: boolean;
  /** Whole project or our scope, before the down payment. */
  baseAmount: number;
  financedAmount: number;
  annualRate: number;
  termYears: number;
  paymentsPerYear: number;
  nPayments: number;
  payment: number;
  totalPaid: number;
  totalInterest: number;
  schedule: AmortizationRow[];
}

export interface CashflowYear {
  year: number;
  chargingProfit: number;
  carbonNet: number;
  cashflow: number;
  cumulative: number;
}

export interface MonthlyPosition {
  period: number;
  loanPayment: number;
  carbon: number;
  charging: number;
  net: number;
}

export interface CashflowResult {
  /** Year 0 is the capital outlay. */
  years: CashflowYear[];
  totalNet: number;
  npv: number;
  irr: number | null;
  /** Year in which cumulative cashflow turns positive; null = beyond the horizon. */
  breakEvenYear: number | null;
  monthly: MonthlyPosition[];
  cumulativeMonthly: number;
  firstPositivePeriod: number | null;
}

export interface DealYear {
  year: number;
  profitBase: number;
  profitWeTake: number;
  profitClientKeeps: number;
  carbonBase: number;
  carbonWeTake: number;
  carbonClientKeeps: number;
  clientTotal: number;
  ourTotal: number;
  clientCumulative: number;
  ourCumulative: number;
}

export interface DealSide {
  capitalAtRisk: number;
  cashReceived: number;
  netPosition: number;
  npv: number;
  irr: number | null;
  paybackYears: number | null;
}

export interface GuardRail {
  label: string;
  ok: boolean;
  detail: string;
}

export interface DealResult {
  name: string;
  isBaseCase: boolean;
  contributions: {
    hardware: number;
    taxRelief: number;
    construction: number;
    service: number;
    capital: number;
    total: number;
  };
  basePrice: number;
  clientPrice: number;
  clientPayment: number;
  paymentChange: number;
  shareYears: number;
  years: DealYear[];
  client: DealSide;
  ours: DealSide & { returnMultiple: number | null };
  /** Share of the net carbon credit whose present value equals what we contribute; null without a contribution. */
  breakEvenCarbonShare: number | null;
  guardRails: GuardRail[];
}

export interface ModelResult {
  context: ModelContext;
  inputs: ModelInputs;
  usage: UsageResult;
  tariff: TariffResult;
  revenue: RevenueResult;
  carbon: CarbonResult;
  financing: FinancingResult;
  cashflow: CashflowResult;
  deal: DealResult;
}

export interface ProposalResult {
  costBuildup: CostBuildupResult;
  margin: MarginResult;
  /** The downstream business model — revenue, carbon, financing, cashflow, deal structure. */
  model: ModelResult;
}

/** Re-export so callers can type the engine lines they classify. */
export type { CostLine };
