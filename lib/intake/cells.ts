// The CEO's EVSE Project Intake 3.1.0 — where every blue cell lives.
//
// One vocabulary for both directions: the importer (importIntake.ts) reads
// these cells into a project, the filler (fillIntake.ts) writes a project back
// into them. The round-trip test locks the two together, so a template change
// is a one-file edit here plus a fixture regeneration.

/** The template generation this map describes. Compared against Version!B4 / B8 before anything is written. */
export const INTAKE_TEMPLATE = {
  version: "3.1.0",
  /**
   * Version!B8. Note it did NOT change between 2.9.0 and 3.1.0 even though 53
   * cells did, so it identifies the template family rather than its contents —
   * the version string is what actually gates a fill.
   */
  contentHash: "4aecae7d4b5f25a9",
  file: "EVSE_Project_Intake_TEMPLATE_3.1.0.xlsx",
  /** Where the blank template ships in the app bundle (public/). */
  publicPath: "/intake/EVSE_Project_Intake_TEMPLATE_3.1.0.xlsx",
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

export const ELECTRICAL_CELLS = {
  material: "B5",
  conduit: "B6",
  trenchSurface: "B7",
  trenchDepthIn: "B8",
  ambientC: "F5",
  pointOfConnection: "B30",
  txToSwitchgearFt: "B31",
  switchgearToPoleFt: "B32",
  spareCapacityA: "B33",
  loadManagement: "B34",
  /** SIZING cap: conductors, gear and power per position are sized on this. */
  cappedKw: "B35",
  boards: "B36",
  /**
   * BILLING setpoint, new at 3.0.0 — what the EMS holds the peak fifteen-minute
   * draw to. Nothing is sized on it. Kept separate from cappedKw above because
   * typing a billing figure into the sizing cap cut the revenue projection to
   * buy a demand-charge saving. The estimator models neither, so this is
   * reported rather than written.
   */
  demandSetpointKw: "B45",
  switchgearPricedA: "B42",
  // Rule 29 block
  serviceType: "B51",
  serviceRoute: "B52",
  distanceToPoiFt: "B53",
  applicationSubmitted: "B54",
  utilityProjectNumber: "B55",
  interconnectFee: "B56",
  rule15Indicated: "B57",
  rule15Allowance: "B58",
  contributionAboveAllowance: "B59",
  rule16: "B60",
  itcc: "B61",
  padLocationAgreed: "B62",
  proofOfCommitment: "B63",
  acceptsOandM: "B64",
  acceptsActivation: "B65",
  designSubmitted: "B66",
  designReturned: "B67",
  // Service feeder block
  governingRule: "B118",
  feederBy: "B119",
  feederAmbientC: "B120",
} as const;

/** AC runs, one row per AC-connected unit (cabinet or all-in-one). */
export const AC_RUN_TABLE = { firstRow: 12, lastRow: 23, line: "B", distanceFt: "D", conductor: "I", sets: "J", conduit: "O" } as const;
/** The transformer-to-switchgear feeder (one lateral). */
export const SERVICE_FEEDER_ROW = { row: 123, material: "B", conductor: "I", sets: "J" } as const;
/** Distribution equipment schedule. */
export const DISTRIBUTION_TABLE = {
  firstRow: 130,
  lastRow: 141,
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
/** Level 2 circuits, one row per circuit. Column G (breaker) is the sheet's own auto column and is never written. */
export const L2_CIRCUIT_TABLE = { firstRow: 151, lastRow: 166, line: "B", units: "C", volts: "D", ampsPerUnit: "E", distanceFt: "H", conductor: "I" } as const;
/** Cabinet-to-dispenser DC runs (distributed systems). */
export const DC_RUN_TABLE = { firstRow: 174, lastRow: 205, fedFromLine: "B", distanceFt: "C", circuits: "D", conductor: "E", ground: "F", conduit: "G", sharedTrench: "H" } as const;

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

/** Rentals: name in A (the template's own labels), qty B, unit cost C, days D, include E. */
export const RENTAL_TABLE = { firstRow: 39, lastRow: 52, name: "A", qty: "B", unitCost: "C", days: "D", include: "E" } as const;

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
  voltage: "B51",
  spareA: "B52",
  frameA: "B53",
  branchConductor: "B54",
  avgRunFt: "B55",
  conduit: "B56",
  rateSchedule: "B57",
  separatelyMetered: "B58",
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
