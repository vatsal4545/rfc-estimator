// The CEO's EVSE Project Intake 3.8.0 — where every blue cell lives.
//
// One vocabulary for both directions: the importer (importIntake.ts) reads
// these cells into a project, the filler (fillIntake.ts) writes a project back
// into them. The round-trip test locks the two together, so a template change
// is a one-file edit here plus a fixture regeneration.

import { DESIGN_UNIT_RATES } from "../calc/designFees";

/** The template generation this map describes. Compared against Version!B4 / B8 before anything is written. */
export const INTAKE_TEMPLATE = {
  version: "3.8.0",
  /**
   * Version!B8. It held at 4aecae7d4b5f25a9 across 2.9.0 -> 3.1.0 despite 53
   * changed cells, and moved at 3.2.0, 3.5.0, 3.6.0, 3.7.0, 3.7.2 and 3.8.0 — so it
   * is not a reliable content digest. The version string is what actually
   * gates a fill.
   */
  contentHash: "3a564d9eb659391e",
  file: "EVSE_Project_Intake_TEMPLATE_3.8.0.xlsx",
  /** Where the blank template ships in the app bundle (public/). */
  publicPath: "/intake/EVSE_Project_Intake_TEMPLATE_3.8.0.xlsx",
} as const;

export const VERSION_CELLS = {
  templateVersion: "B4",
  released: "B5",
  contentHash: "B8",
  fileVersion: "B10",
  dateCompleted: "B11",
  completedBy: "B12",
  projectReference: "B13",
  revisionNotes: "B14",
} as const;

/** The Revisions tab — this filled file's own history, one row per issue (row 4 is the header). */
export const REVISIONS_TABLE = { firstRow: 5, lastRow: 16, rev: "A", date: "B", by: "C", notes: "D" } as const;

export const PROJECT_CELLS = {
  clientName: "B5",
  contactName: "B6",
  contactTitle: "B7",
  contactEmail: "B8",
  contactPhone: "B9",
  siteName: "B12",
  street: "B13",
  cityStateZip: "B14",
  county: "B15",
  propertyType: "B16",
  access: "B21",
  hoursOpen: "B22",
  daysOpen: "B23",
  utility: "B26",
  currentSchedule: "B27",
  existingServiceA: "B28",
  serviceVoltage: "B29",
  billsObtained: "B30",
  proposalDate: "B33",
  validityDays: "B34",
  preparedBy: "B35",
  accountOwner: "B36",
  cca: "B46",
} as const;

/** Equipment rows 7–18: one price-book line each. Columns D–H, K, M are the sheet's own lookups. */
/**
 * Equipment tab singles. l2SupplyVoltage is new at 3.2.0: the voltage the
 * Level 2 units are actually fed at, which the sheet derates 240 V-rated units
 * to in its AC-input column. The estimator already models L2 at 208 V, so it
 * writes the project's own service voltage rather than leaving the sheet to
 * guess and flag ENTER IT.
 */
export const EQUIPMENT_SINGLES = {
  l2SupplyVoltage: "B30",
} as const;

export const EQUIPMENT_TABLE = {
  firstRow: 7,
  lastRow: 18,
  capacity: "B",
  sku: "C",
  qty: "I",
  dispenserSku: "L",
  dispensersPerCabinet: "N",
  connectorsPerDispenser: "O",
  scopeSentence: "B27",
} as const;

/**
 * The Electrical tab as rebuilt at template 3.3.0 ("around how sites are
 * built"): block A sizing basis, block B ONE charger-run table generated from
 * the Equipment tab, block C dispenser runs (power cabinets only), block D
 * service and switchgear, block E the distribution schedule, block F the
 * utility interconnection (Rule 29) block, block G retained infrastructure
 * (auto, from the Existing tab), block H the site's conductor sizing table
 * (auto) and, since 3.7.0, block I the distribution feeders between the items
 * on the schedule. 3.5.0 moved nothing — it locked every non-blue cell; 3.6.0
 * and 3.7.0 only appended; 3.7.1–3.7.2 repaired dropdowns and the nine
 * unbalanced formulas without moving a cell. 3.8.0 cut block B from sixty
 * charger runs to thirty (rows 18–47), so every block below it on THIS tab
 * sits thirty rows higher than at 3.7.x; no other tab moved. A 3.3.0–3.7.x
 * file is read through ELECTRICAL_LEGACY_SHIFT.
 */
/**
 * The design ambient written to Electrical!B10 (and B126 for a feeder we
 * provide) when nobody has typed the site's figure. 30 °C is the NEC 310.16
 * table ambient — no correction — which is exactly how the estimator sizes
 * every conductor, so with this value the sheet and the estimator pick the
 * same wire. A hotter site (ASHRAE 2% design dry-bulb, or a duct-bank
 * temperature) is typed on 3 · Electrical and travels instead.
 */
export const DESIGN_AMBIENT_DEFAULT_C = 30;

/** The design ambient in force for a project: the typed site figure, else the default. */
export function designAmbientOf(intake: { designAmbientC?: number | null } | undefined | null): { value: number; typed: boolean } {
  const v = intake?.designAmbientC;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? { value: v, typed: true } : { value: DESIGN_AMBIENT_DEFAULT_C, typed: false };
}

export const ELECTRICAL_CELLS = {
  // Block A — sizing basis
  material: "B6",
  conduit: "B7",
  trenchSurface: "B8",
  trenchDepthIn: "B9",
  /**
   * SITE DATA the sheet insists on: every charger-run verdict reads "SET THE
   * DESIGN AMBIENT" until it holds a number, the auto conductor column is
   * blank without it and the wire line prices at $0. The fill therefore
   * ALWAYS writes it: the value typed on the app's Electrical section
   * (project.intake.designAmbientC) or, failing that, DESIGN_AMBIENT_DEFAULT_C
   * — with a warning in the handoff report so the site figure gets typed.
   */
  ambientC: "B10",
  insulationC: "B11",
  terminationC: "B12",
  /** Allowable voltage drop as a fraction (0.03 = 3%) — the estimator's maxVoltageDropFraction. */
  allowableVdFraction: "B13",
  // Block D — service and switchgear
  boards: "B110",
  switchgearPricedA: "B112",
  loadManagement: "B114",
  /** SIZING cap: conductors, gear and power per position are sized on this. */
  cappedKw: "B115",
  /**
   * BILLING setpoint, new at 3.0.0 — what the EMS holds the peak fifteen-minute
   * draw to. Nothing is sized on it. Kept separate from cappedKw above because
   * typing a billing figure into the sizing cap cut the revenue projection to
   * buy a demand-charge saving. The estimator models neither, so this is
   * reported rather than written.
   */
  demandSetpointKw: "B117",
  pointOfConnection: "B118",
  spareCapacityA: "B119",
  switchgearToPoleFt: "B120",
  // Service feeder block
  governingRule: "B124",
  feederBy: "B125",
  feederAmbientC: "B126",
  txToSwitchgearFt: "B127",
  // Block F — Rule 29 block
  serviceType: "B155",
  serviceRoute: "B156",
  distanceToPoiFt: "B157",
  /** A dropdown since 3.3.0 (Yes / No / In preparation); the date has its own row below. */
  applicationSubmitted: "B158",
  applicationDate: "B159",
  utilityProjectNumber: "B160",
  interconnectFee: "B161",
  rule15Indicated: "B162",
  rule15Allowance: "B163",
  contributionAboveAllowance: "B164",
  rule16: "B165",
  itcc: "B166",
  padLocationAgreed: "B167",
  proofOfCommitment: "B168",
  acceptsOandM: "B169",
  acceptsActivation: "B170",
  designSubmitted: "B171",
  designReturned: "B172",
} as const;

/**
 * Block B — the charger-run table, one row per unit that takes a feeder or a
 * branch: every standalone DC charger, power cabinet and Level 2 unit, in the
 * order of the Equipment tab (line by line, unit by unit — Equipment columns
 * Q–V number them and column W here says which line a row belongs to). The
 * sheet fills columns A–D and every "(auto)" column itself; the blue cells are
 * the circuit name (blank = its own circuit), the distance, the shared-trench
 * flag, the conductor and conduit overrides and the number of sets. "Sets"
 * is how the sheet carries a unit fed by more than one circuit — a dual
 * Level 2 pedestal on two branches, a power cabinet on two inputs — so the
 * estimator's circuits per unit land there. Unit k of the schedule is row
 * firstRow + k − 1. Thirty rows since 3.8.0 (sixty before); the sheet prices
 * nothing on a row with no charger.
 */
export const CHARGER_RUN_TABLE = {
  firstRow: 18,
  lastRow: 47,
  circuit: "E",
  distanceFt: "F",
  sharesTrench: "G",
  conductorOverride: "L",
  sets: "M",
  conduitOverride: "R",
  /** Auto columns, read back by the importer when the file carries cached values. */
  autoConductor: "K",
  autoConduit: "Q",
  stream: "V",
  line: "W",
} as const;

/**
 * Block C — cabinet-to-dispenser DC runs, used only when a power cabinet is
 * scheduled (the sheet says NOT USED otherwise). Rows are built from the
 * cabinet lines: dispenser k is row firstRow + k − 1.
 */
export const DISPENSER_RUN_TABLE = { firstRow: 65, lastRow: 96, distanceFt: "C", conductor: "E", ground: "F", conduit: "G", sharedTrench: "H" } as const;

/** The transformer-to-switchgear feeder (one lateral). */
export const SERVICE_FEEDER_ROW = { row: 130, material: "B", conductor: "I", sets: "J" } as const;

/** Block E — distribution equipment schedule. */
export const DISTRIBUTION_TABLE = {
  firstRow: 135,
  lastRow: 146,
  item: "A",
  type: "B",
  qty: "C",
  volts: "D",
  phases: "E",
  ratingA: "F",
  fedFrom: "G",
  feeds: "H",
  location: "I",
  whoProvides: "J",
  costBasis: "K",
  quotedCost: "L",
} as const;

/**
 * Block I (3.7.0) — the distribution feeders: the wire between the boxes on
 * the schedule that nothing else carried until now (existing board to the new
 * EV panel, breaker to transformer primary, transformer secondary to the
 * Level 2 panel, panel to panel). One row per feeder; FROM and TO are items
 * on the schedule (column A of block E — the dropdowns list A135:A146), the
 * floor is the rating of the item fed unless column G types one, and the
 * sheet sizes conductor, ground, conduit and material itself. Its material
 * total (B226) joins the wire line on the Pricing tab, so the estimator's
 * feeder segments must land here for the two to agree.
 */
export const DISTRIBUTION_FEEDER_TABLE = {
  firstRow: 212,
  lastRow: 223,
  from: "B",
  to: "C",
  floorA: "G",
  distanceFt: "H",
  sets: "I",
  conductorOverride: "K",
  conduitOverride: "P",
  /** Auto columns, read back when the file carries cached values. */
  autoVolts: "D",
  autoPhases: "E",
  autoRatingA: "F",
  autoConductor: "J",
  autoConduit: "O",
  material: "Q",
  verdict: "R",
} as const;

/** Block I's summary rows (all formulas). */
export const DISTRIBUTION_FEEDER_CELLS = { count: "B225", material: "B226", distanceFt: "B227", verdict: "B228", coverage: "B229" } as const;

/**
 * Reading a 3.3.0–3.7.x file with this map: the Electrical tab's rows from the
 * first row below the charger-run table (48 at 3.8.0) sat thirty rows lower
 * (block B had sixty rows, 18–77). Charger runs 31–60 of such a file have no
 * row here and are reported, not read.
 */
export const ELECTRICAL_LEGACY_SHIFT = { firstMovedRow: 48, rows: 30, lastLegacyChargerRow: 77 } as const;

/** Whether a template version reads the Electrical tab at its pre-3.8.0 (3.3.0–3.7.x) row positions. */
export function electricalUsesLegacyRows(templateVersion: string): boolean {
  const [major, minor] = templateVersion.split(".").map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major === 3 && minor >= 3 && minor < 8;
}

/** An Electrical-tab cell address of the current map, moved to where a 3.3.0–3.7.x file kept it. */
export function legacyElectricalRef(ref: string): string {
  const m = /^(\$?[A-Z]{1,3}\$?)(\d+)$/.exec(ref);
  if (!m) return ref;
  const row = Number(m[2]);
  return row >= ELECTRICAL_LEGACY_SHIFT.firstMovedRow ? `${m[1]}${row + ELECTRICAL_LEGACY_SHIFT.rows}` : ref;
}

/** The Rule 29 block's "application submitted" dropdown since 3.3.0. */
export const APPLICATION_SUBMITTED_OPTIONS = ["Yes", "No", "In preparation"] as const;

/**
 * The estimator keeps "application submitted" as one free-text field ("Yes —
 * 2026-08-01"); the intake has a dropdown and a date row. Split one into the
 * other and back.
 */
export function splitApplicationSubmitted(text: string): { status: string; date: string } {
  const t = text.trim();
  if (!t) return { status: "", date: "" };
  const date = /\d{4}-\d{2}-\d{2}/.exec(t)?.[0] ?? "";
  const head = t.split(/\s+[—–-]\s+|,/)[0].trim();
  const status = APPLICATION_SUBMITTED_OPTIONS.find((o) => o.toLowerCase() === head.toLowerCase()) ?? (/^y/i.test(head) ? "Yes" : /^n/i.test(head) ? "No" : /^in prep/i.test(head) ? "In preparation" : "");
  return { status: status || (date ? "Yes" : t), date };
}

export function joinApplicationSubmitted(status: string, date: string): string {
  const s = status.trim();
  const d = date.trim();
  return s && d ? `${s} — ${d}` : s || d;
}

export const CONSTRUCTION_CELLS = {
  crewDays: "B5",
  crewRate: "B6",
  contingency: "B7",
  markupLabor: "B8",
  pmPct: "B10",
  autoCadSets: "B32",
  eeSets: "B33",
  pmHours: "B34",
  autoCadRate: "D32",
  eeRate: "D33",
  pmRate: "D34",
  markupMaterials: "B72",
} as const;

/** Site works rows: quantity in column B, include flag (Y/N) in column E. */
export const SITE_WORKS_ROWS = {
  concreteYd: 14,
  rebar: 15,
  steelMesh: 16,
  asphaltSf: 17,
  striping: 18,
  adaStalls: 19,
  adaRamp: 20,
  bollards: 21,
  signs: 22,
  signPosts: 23,
  switchgearSign: 24,
  gpr: 25,
  gfi: 26,
  dump: 27,
} as const;
export const SITE_WORKS_COLS = { qty: "B", include: "E" } as const;
/** The template's design unit rates (Construction!D32 / D33) — see lib/calc/designFees. */
export const DESIGN_SET_RATES = { autoCad: DESIGN_UNIT_RATES.autoCad, ee: DESIGN_UNIT_RATES.ee } as const;

/**
 * Rentals: name in A (the template's own labels), qty B, unit cost C,
 * duration D, include E and, since 3.8.0, the unit the rate is per in F (day /
 * week / month) — the duration is in that unit, and the sheet prices
 * qty × unit cost × duration regardless of it (Pricing!B12).
 */
export const RENTAL_TABLE = { firstRow: 39, lastRow: 52, name: "A", qty: "B", unitCost: "C", duration: "D", include: "E", ratePer: "F" } as const;
/** The F-column dropdown, in the sheet's spelling. */
export const RENTAL_RATE_PER = ["day", "week", "month"] as const;
export type RentalRatePer = (typeof RENTAL_RATE_PER)[number];

/** The intake's rate unit for an estimator rate basis ("per ft per week" → week, "per month" → month, "each way" and "per day" → day). */
export function rentalRatePerOf(rateBasis: string): RentalRatePer {
  const b = rateBasis.toLowerCase();
  if (/\bweek/.test(b)) return "week";
  if (/\bmonth/.test(b)) return "month";
  return "day";
}

/** The estimator's rate basis for an intake rate unit, keeping a per-unit-of-quantity basis (fencing is per ft) — "per ft per week" with F = day becomes "per ft per day". */
export function rateBasisFromRatePer(ratePer: string, priorBasis?: string): string {
  const unit = (RENTAL_RATE_PER as readonly string[]).includes(ratePer.trim().toLowerCase()) ? ratePer.trim().toLowerCase() : "day";
  const prior = (priorBasis ?? "").toLowerCase();
  const perQty = /^per (ft|foot|lf|sq ft|each|ea)\b/.exec(prior);
  return perQty ? `per ${perQty[1]} per ${unit}` : `per ${unit}`;
}

/** Pass-through fees: quantity B, unit cost D, include E. */
export const FEE_ROWS = {
  permits: 81,
  utilityContract: 82,
  interconnectDesign: 83,
  lineExtension: 84,
  fireReview: 85,
  encroachment: 86,
  inspection: 87,
  meterConnection: 88,
} as const;
export const FEE_COLS = { qty: "B", unitCost: "D", include: "E" } as const;

export const COMMERCIAL_CELLS = {
  discountHardware: "B5",
  discountService: "B6",
  discountEvolv: "B7",
  discountInHouse: "B8",
  salesTax: "B9",
  contractYears: "B12",
  inWarrantyYears: "B13",
  /**
   * New at 3.0.0 and read by the CEO's model: whether service and extended
   * warranty are renewed past the contract, since the model measures a longer
   * horizon and charges the uncovered years as an operating cost. The template
   * ships "Yes"; the estimator has no such field, so it leaves that standing.
   */
  renewService: "B17",
  evolvPerPortMonth: "B14",
  financingOffered: "B19",
  lender: "B20",
  annualRate: "B21",
  termYears: "B22",
  paymentsPerYear: "B23",
  downPayment: "B24",
  startDate: "B25",
  horizonYears: "B28",
  discountRate: "B29",
} as const;

export const REVENUE_CELLS = {
  retailPerKwh: "B5",
  cardFeePct: "B8",
  idleFee: "B9",
  /** =Project!B22 in the template — a formula, never written. */
  hoursPerDay: "B12",
  stallOccupancy: "B13",
  chargingHoursShare: "B14",
  derating: "B15",
  taper: "B16",
  rampYear1: "B19",
  rampYear2: "B20",
  rampYear3: "B21",
  growth: "B22",
  /**
   * New at 3.0.0 and read by the CEO's model, which until then held every
   * tariff flat for ten years. Applied to demand and block rates year by year.
   * The estimator has no tariff escalation, so the template's 0 stands.
   */
  tariffEscalation: "B56",
  /**
   * New at 3.2.0. The Level 2 stream runs on its own physics now — the sheet
   * looks up a state benchmark (BM_L2_KWH) and this overrides it per site.
   * The estimator has no Level 2 energy model, so the benchmark stands.
   */
  l2KwhPerPortDayOverride: "B110",
  historyMonths: "B25",
  historyKwhPerDay: "B26",
  historyRevenuePerYear: "B27",
  historyProfitPerYear: "B28",
  historyPortsInService: "B29",
  historyFailedShare: "B30",
  rateSchedule: "B36",
  voltageLevel: "B37",
  sharePeak: "B38",
  shareOffPeak: "B39",
  shareSuperOffPeak: "B40",
  benchmarkState: "B45",
  expectedSiteFactor: "B46",
  subscriptionPolicy: "B51",
  peakToAverage: "B52",
  safetyMargin: "B53",
  sizeOnFullRating: "B54",
  intervalData: "B55",
  revenueBasis: "B59",
  source: "B82",
  verified: "B83",
  verifiedBy: "B84",
  eligibilityThreshold: "B85",
  crossesThreshold: "B86",
  volumetricPerKwh: "B91",
  customerPerMonth: "B92",
  demandPerKwMonth: "B93",
  billingDemandKw: "B94",
} as const;

export const CARBON_CELLS = {
  qualifies: "B5",
  permitClears2022: "B6",
  applicationFiled: "B7",
  aggregator: "B8",
  aggregatorShare: "B9",
  fciRate: "B10",
  creditingYears: "B11",
  l2CreditPerKwh: "B17",
  /**
   * Derived since template 3.2.0 — the sheet computes it from the Revenue
   * tab's Level 2 stream. Kept for the importer, which still reads it; the
   * filler must not write it.
   */
  l2KwhPerDay: "B18",
  capMultiple: "B21",
  grants: "B22",
  federalItc: "B25",
  stateProgramme: "B26",
  stateOutcome: "B27",
} as const;

export const DEAL_CELLS = {
  name: "B9",
  carbonShare: "B10",
  revenueShare: "B11",
  revenueShareBasis: "B12",
  shareYears: "B13",
  extraDiscountHardware: "B16",
  extraDiscountConstruction: "B17",
  extraDiscountService: "B18",
  capitalContribution: "B19",
  minClientNpv: "B22",
  minReturnMultiple: "B23",
  maxContribution: "B24",
  /**
   * New at 3.0.0: what is being done about a guard-rail breach above and what
   * would release it. Judgement written down, not a number the estimator holds.
   */
  pricePosition: "B25",
  clientFinances: "B41",
} as const;
/** Scope of supply rows (column B: We provide / By others / Not required). */
export const SCOPE_ROWS = { hardware: 30, service: 31, evolv: 32, salesTax: 33, design: 34, construction: 35, interconnect: 36 } as const;

/** Override register rows: value in B, reason in D. */
export const OVERRIDE_ROWS = {
  wires: 9,
  switchgear: 10,
  siteWorks: 11,
  dump: 12,
  permits: 13,
  utility: 14,
  rentals: 15,
  design: 16,
  lineExtension: 17,
  additionalScope: 18,
  frameA: 19,
  branchBreakerA: 20,
  crewDays: 21,
  kwhPerDay: 22,
  carbonGrossPerYear: 23,
  loanPayment: 24,
  hardwareMsrpEach: 25,
  retailPerKwh: 26,
  blendedPerKwh: 27,
  fixedUtilityPerYear: 28,
} as const;
export const OVERRIDE_COLS = { value: "B", reason: "D" } as const;

export const EXISTING_CELLS = {
  projectType: "B5",
  ageYears: "B6",
  reason: "B7",
  owner: "B8",
  /** Register rows 13–24 in RETAIN_ELEMENTS order, decision in column B. */
  registerFirstRow: 13,
  serviceA: "B50",
  /** B51 (existing service voltage) is the sheet's own formula — it reads Project!B29 when the service is retained. Write the voltage there. */
  spareA: "B52",
  frameA: "B53",
  branchConductor: "B54",
  avgRunFt: "B55",
  conduit: "B56",
  rateSchedule: "B57",
  separatelyMetered: "B58",
  /** Section I · capacity of the existing service (3.6.0, rows 188–201): the three inputs. B190/B191/B193–B195 and B198–B201 are the sheet's own. */
  peakDemandKw: "B192",
  gearSpaceForFeeder: "B196",
  utilityNotified: "B197",
} as const;
export const EXISTING_UNITS_TABLE = { firstRow: 33, lastRow: 40, makeModel: "A", kw: "B", ports: "C", connectors: "D", qty: "E", yearInstalled: "F", working: "G" } as const;
export const EXISTING_HISTORY_TABLE = { firstRow: 67, lastRow: 102, month: "A", kwh: "B", revenue: "C", sessions: "D", utilityCost: "E", portsWorking: "F", note: "G" } as const;
/** Connector rows 131–134 in CONNECTOR_KEYS order. */
export const EXISTING_CONNECTOR_ROWS = { firstRow: 131, onExisting: "B", onNew: "C", fleetShare: "D" } as const;
export const EXISTING_CAPTURE_ROWS = { availability: 150, ports: 151, connectors: 152, power: 153, col: "C" } as const;
export const EXISTING_REMOVAL_CELLS = {
  cabinets: "B174",
  pads: "B175",
  bollards: "B176",
  signs: "B177",
  disposalLoads: "B178",
  recycling: "B179",
  hazmat: "B180",
  temporaryCharging: "B181",
  protectionDays: "B182",
} as const;

// ---------------------------------------------------------------------------
// Dropdown vocabularies the template validates — write exactly these strings.
// ---------------------------------------------------------------------------

export const INTAKE_TEXT = {
  yes: "Yes",
  no: "No",
  weProvide: "We provide",
  byOthers: "By others",
  notRequired: "Not required",
  wholeProject: "Whole project",
  ourScopeOnly: "Our scope only",
  netChargingProfit: "Net charging profit",
  grossRevenue: "Gross revenue",
  subscription: { ramped: "Ramped to projected demand", nameplate: "Fixed at full nameplate", manual: "Fixed at a manual level" },
  revenueBasis: { market: "Market benchmark — greenfield", historical: "Historical actuals — replacement site" },
  feederByUtility: "Utility — EV infrastructure rule",
  feederByUs: "Zero Impact Energy",
  /** 3.6.0: an add-load or replacement site whose service feeder stays — the run is neither sized nor costed. */
  feederByExisting: "Existing — retained",
  costBasisPricedElsewhere: "Priced elsewhere in this workbook",
  costBasisVendorQuote: "Vendor quote",
  capacityAccessory: "Accessory",
  capacityDistributed: "Distributed system",
  capacityLevel2: "Level 2 AC",
} as const;

/** Conductor sizes as the template's WIRE_SIZE list spells them (estimator spelling → intake spelling). */
export function conductorToIntake(size: string): string {
  const s = size.trim();
  let m = /^(\d+)\s*AWG$/i.exec(s);
  if (m) return `${m[1]} AWG`;
  m = /^(\d)\/0(?:\s*AWG)?$/i.exec(s);
  if (m) return `${m[1]} /0`;
  m = /^(\d+)\s*kcmil$/i.exec(s);
  if (m) return `${m[1]} KCMIL`;
  return s;
}

/**
 * The conductor ladder the charger-run table sizes and prices on (Electrical
 * block H, SZ_SIZE) and the wider one the service feeder reads (RefData
 * AMP_SIZE, which adds 450 KCMIL). The estimator's own ladder also carries
 * 14 and 12 AWG, 3 AWG and 700 / 800 / 900 KCMIL; an override in one of those
 * sizes reads "no ampacity on file" on the sheet and prices at zero, so the
 * filler rounds such a size UP to the next one the sheet knows.
 */
export const INTAKE_CHARGER_RUN_SIZES = ["10 AWG", "8 AWG", "6 AWG", "4 AWG", "2 AWG", "1 AWG", "1 /0", "2 /0", "3 /0", "4 /0", "250 KCMIL", "300 KCMIL", "350 KCMIL", "400 KCMIL", "500 KCMIL", "600 KCMIL", "750 KCMIL", "1000 KCMIL"] as const;
export const INTAKE_FEEDER_SIZES = ["10 AWG", "8 AWG", "6 AWG", "4 AWG", "2 AWG", "1 AWG", "1 /0", "2 /0", "3 /0", "4 /0", "250 KCMIL", "300 KCMIL", "350 KCMIL", "400 KCMIL", "450 KCMIL", "500 KCMIL", "600 KCMIL", "750 KCMIL", "1000 KCMIL"] as const;

/** Circular mils of a size in the intake's spelling, for ordering. */
function intakeSizeMils(size: string): number {
  let m = /^(\d+) AWG$/.exec(size);
  if (m) return { 14: 4110, 12: 6530, 10: 10380, 8: 16510, 6: 26240, 4: 41740, 3: 52620, 2: 66360, 1: 83690 }[Number(m[1])] ?? 0;
  m = /^(\d) \/0$/.exec(size);
  if (m) return [0, 105600, 133100, 167800, 211600][Number(m[1])] ?? 0;
  m = /^(\d+) KCMIL$/.exec(size);
  if (m) return Number(m[1]) * 1000;
  return 0;
}

/**
 * The estimator's conductor size as the intake can size and price it: the
 * same size when the sheet's ladder carries it, else the next size up on
 * that ladder. `snapped` says which happened.
 */
export function snapConductorToIntake(size: string, ladder: readonly string[] = INTAKE_CHARGER_RUN_SIZES): { size: string; snapped: boolean } {
  const spelled = conductorToIntake(size);
  if (ladder.includes(spelled)) return { size: spelled, snapped: false };
  const mils = intakeSizeMils(spelled);
  if (mils <= 0) return { size: spelled, snapped: false };
  const up = ladder.find((s) => intakeSizeMils(s) >= mils);
  return up ? { size: up, snapped: true } : { size: spelled, snapped: false };
}

/** Conductor sizes back to the estimator's spelling. */
export function conductorFromIntake(size: string): string {
  const s = size.trim();
  let m = /^(\d+)\s*AWG$/i.exec(s);
  if (m) return `${m[1]} AWG`;
  m = /^(\d)\s*\/\s*0$/.exec(s);
  if (m) return `${m[1]}/0 AWG`;
  m = /^(\d+)\s*KCMIL$/i.exec(s);
  if (m) return `${m[1]} kcmil`;
  return s;
}

/** The template's PVC_SIZE list, keyed by trade size in inches (note the list's own stray spaces). */
const INTAKE_CONDUIT_SIZES: [number, string][] = [
  [0.5, '(1/2")'],
  [0.75, '(3/4")'],
  [1, '(1")'],
  [1.25, '(1 1/4")'],
  [1.5, '(1 1/2")'],
  [2, '(2")'],
  [2.5, '(2 1/2")'],
  [3, '(3") '],
  [3.5, '(3  1/2")'],
  [4, '(4")'],
  [5, '(5")'],
];

/** Trade size text ('1-1/4"', '(1 1/4")', '3"', '2.5') → inches. */
export function tradeSizeInches(text: string): number | null {
  const s = text.replace(/[()"\s]+/g, " ").trim().replace(/-/g, " ");
  const m = /^(\d+)(?:\s+(\d+)\/(\d+))?$|^(\d+)\/(\d+)$|^(\d*\.\d+)$/.exec(s);
  if (!m) return null;
  if (m[6]) return Number(m[6]);
  if (m[4]) return Number(m[4]) / Number(m[5]);
  const whole = Number(m[1]);
  return m[2] ? whole + Number(m[2]) / Number(m[3]) : whole;
}

/** Conduit trade size as the template's PVC_SIZE list spells it. */
export function conduitToIntake(size: string): string {
  const inches = tradeSizeInches(size);
  if (inches === null) return size;
  const hit = INTAKE_CONDUIT_SIZES.find(([n]) => Math.abs(n - inches) < 1e-9);
  return hit ? hit[1] : size;
}

/** The template's rental labels, in row order, with the estimator's item names. */
export const RENTAL_ROW_NAMES: { row: number; label: string; estimator?: string }[] = [
  { row: 39, label: "Fencing", estimator: "Temporary fencing" },
  { row: 40, label: "Mini x", estimator: "Mini excavator" },
  { row: 41, label: "Dump Truck", estimator: "Dump truck" },
  { row: 42, label: "Forklift", estimator: "Forklift" },
  { row: 43, label: "Trench Plates", estimator: "Trench plates" },
  { row: 44, label: "Storage container", estimator: "Storage container" },
  { row: 45, label: "Portable restroom", estimator: "Portable restroom" },
  { row: 46, label: "Low boi", estimator: "Lowboy transport" },
  { row: 47, label: "Saw cutter", estimator: "Saw cutter" },
  { row: 48, label: "Jack hammer", estimator: "Jack hammer" },
  { row: 49, label: "Compactor", estimator: "Compactor" },
  { row: 50, label: "Generator rental" },
  { row: 51, label: "Dump trailer rental" },
  { row: 52, label: "Equipment protection" },
];

/** The intake row a rental line lands on — matched by the estimator's item name or the template's own label, case-insensitively. Undefined: the sheet has no row for it. */
export function intakeRentalRow(name: string): { row: number; label: string; estimator?: string } | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return RENTAL_ROW_NAMES.find((rr) => (rr.estimator ?? "").toLowerCase() === n || rr.label.toLowerCase() === n);
}

/** Every name the intake's rental table accepts (its 14 fixed rows), for a name picker: the estimator's spelling where it has one, else the template's label. */
export const INTAKE_RENTAL_NAMES: string[] = RENTAL_ROW_NAMES.map((rr) => rr.estimator ?? rr.label);
