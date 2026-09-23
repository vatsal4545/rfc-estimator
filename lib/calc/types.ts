// Core domain types for the CPM/RFC electrical estimating engine.
// Ported from CPM_Clean.xlsx (WireTable, ConduitTable, LoadTypes, Takeoff,
// Materials, GearCatalog, Peripherals, Equipment, Outputs) plus the
// Costs Internal / Summary rollup found in RFC_V18 project files.

export type Material = "Cu" | "Al";
export type ConduitMaterial = "PVC" | "EMT";
export type Category = "L2" | "DCFC" | "Feeder";

/** Site terrain / dig difficulty. Drives trenching cost and labor multipliers. */
export type Terrain = "flat" | "sloped" | "hilly" | "rocky";

/**
 * How the conduit gets from the power source to the chargers.
 *  - "trench": underground PVC in open-cut trench (the CPM_Clean baseline).
 *  - "surface": EMT on the parking-structure ceiling/walls — strut trapeze
 *    supports every 10 ft (NEC 358.30), no digging at all.
 *  - "hybrid": chargers wired in surface EMT inside the garage, but the
 *    service section (utility → switchgear → transformer pads) still trenches.
 */
export type InstallMethod = "trench" | "surface" | "hybrid";

export interface WireRow {
  size: string;
  circularMils: number;
  ampacityCu: number;
  ampacityAl: number;
  cuPerFt: number; // $/ft, 0 = no price
  alPerFt: number; // $/ft, 0 = no price
  conduitTradeSize: string;
  note?: string;
}

export interface GroundingRow {
  ocpdA: number;
  eGCcu: string;
  eGCal: string;
}

export interface ConduitRow {
  tradeSize: string;
  emtPerFt: number;
  pvcPerFt: number;
  cementFtPerGal: number;
  note?: string;
}

export interface LoadType {
  id: string;
  category: Category;
  voltage: number;
  phases: 1 | 3;
  kwPerPort: number;
  runsPerUnit: number;
  conductorsPerRun: number;
  /** Breaker per circuit. 0 = auto-size to the next standard breaker >= 125% of circuit amps. */
  feederOcpdA: number;
  /**
   * Nameplate input current per circuit, when the manufacturer's spec sheet
   * differs from kW/(V*sqrt3). The original workbook's kW->amps table baked in
   * ~90% charger efficiency (e.g. 240kW -> 320A), so the new DCFC models carry
   * that convention here.
   */
  designAmpsOverride?: number;
  /**
   * Input current of the whole UNIT for panel-schedule load totals, when it
   * differs from the per-circuit amps (e.g. a dual-port unit wired as two
   * circuits that never both draw full power).
   */
  unitInputAmps?: number;
  designMinCu?: string;
  designMinAl?: string;
  hasDataCable: boolean;
  materialOverride?: Material;
  runsAreParallel: boolean;
  /**
   * Billable ports (plugs) per unit, when it differs from the wiring-derived
   * default (L2 = runsPerUnit, DCFC = 1): dual-cable DCFC units dispense to
   * one vehicle at a time electrically but bill network fees per port.
   */
  portsPerUnit?: number;
  notes?: string;
}

export interface GearCatalogRow {
  item: string;
  size: string;
  voltage: string;
  unitCost: number;
  note?: string;
}

export interface ServiceChainConfig {
  /** When on, the service/feeder runs below are generated and sized automatically. */
  enabled: boolean;
  /** Conductor material for the chain segments (big feeders are usually aluminium). */
  material: Material;
  utilityToSwitchgearFt: number;
  switchgearToTransformerFt: number;
  transformerToSubpanelFt: number;
  /**
   * The distribution feeders between the items on the schedule, when the
   * engineer typed them (intake 3.7.0 Electrical block I) or the app's user
   * did. Present and non-empty, they REPLACE the two auto segments
   * (switchgear → step-down transformer → sub-panel): the typed schedule is
   * the site, the auto pair is the guess. The service lateral from the utility
   * transformer is block D's and stays either way.
   */
  feeders?: DistributionFeeder[];
}

/**
 * One feeder between two items on the distribution schedule, sized the way
 * the intake sizes it: ampacity at the floor divided by the parallel sets,
 * voltage drop at floor / 1.25 — so the floor is the 125 %-inclusive figure
 * and the engine's design current is floor / continuousLoadFactor.
 */
export interface DistributionFeeder {
  /** Schedule item it runs from (block E column A) — free text when the source is not on the schedule. */
  from: string;
  /** Schedule item it feeds — sets the floor, volts and phases when nothing is typed. */
  to: string;
  distanceFt: number;
  /** Column G — a typed floor (e.g. the breaker on a transformer primary). Blank = the rating of the item fed. */
  floorA?: number;
  /** The item fed's rating on the schedule, resolved when the row was read so the engine can size without the schedule. */
  ratingA?: number;
  /** Volts and phases of the item fed (a transformer takes the FROM item's volts, or the service voltage). */
  voltage: number;
  phases: 1 | 3;
  /** Column I — parallel sets typed; blank = the engine chooses. */
  sets?: number;
  /** Column K — conductor override, estimator spelling ("350 kcmil"). */
  conductorOverride?: string;
  /** Column P — conduit override, kept in the intake's own spelling; the engine sizes conduit itself. */
  conduitOverride?: string;
}

/**
 * Manual overrides for the auto-sized service gear. Blank = auto (code
 * minimum from the panel schedule). Overrides cascade: the service-chain
 * conductors, primary breaker and gear pricing all re-derive from the
 * overridden size, so bumping the switchgear one frame up re-prices
 * everything consistently.
 */
export interface GearOverrides {
  /** 480V main switchgear bus (A). */
  switchgear480A?: number;
  /** 208V sub-panel / distribution bus (A). */
  subpanel208A?: number;
  /** 480→208V step-down transformer (kVA). */
  transformerKva?: number;
}

export interface Setup {
  clientName: string;
  siteAddress: string;
  cpm: string;
  cra: string;
  utility: string;
  scopeOfWork: string;
  priceListSource: string;
  priceListDate: string;

  feederMaterial: Material;
  groundingMaterial: Material;
  conduitType: ConduitMaterial;
  continuousLoadFactor: number; // 1.25
  maxVoltageDropFraction: number; // 0.03
  powerFactor: number; // 1.0
  wireUpsizeSteps: number; // 0
  conduitUpsizeSteps: number; // 0
  dataRatePerFt: number; // $/ft cable only
  dataConduitTradeSize: string;
  trenchLengthFt: number; // manual, "suggested = longest run"
  serviceChain?: ServiceChainConfig;
  /** Manual gear-size overrides — blank fields stay auto-sized. */
  gearOverrides?: GearOverrides;
  /**
   * Conduit routing method. Absent on projects saved before the option
   * existed — derive with effectiveInstallMethod(): EMT conduit implied
   * "surface", PVC implied "trench".
   */
  installMethod?: InstallMethod;
  /**
   * Surface-EMT route length (ft) — the ceiling/wall path the conduit rack
   * actually follows, driving strut trapeze supports every 10 ft (NEC
   * 358.30). 0/absent = derive from the takeoff's longest run.
   */
  surfaceRouteFt?: number;
  /** Terrain the trench multiplier was derived from (informational). */
  terrain?: Terrain;
  /**
   * Multiplies the trenching / asphalt-cut unit rate. 1 = flat lot (the
   * CPM_Clean baseline). Hilly or rocky sites dig slower and haul more spoils
   * — see TERRAIN_INFO in autoplan.ts for the standard factors.
   */
  trenchCostMultiplier?: number;
  /** Conductor and conduit $/ft overrides (a materials quote). Blank = the shipped Rexel list. */
  materialRates?: MaterialRates;
}

export interface TakeoffRowInput {
  id: string;
  loadTypeId: string;
  location: string;
  units: number;
  oneWayDistFt: number;
  runsPerUnitOverride?: number;
  sizeOverride?: string;
  /**
   * Breaker override (A) for this row's circuits. Wins over the LoadType's
   * OCPD and the auto-sizer; the EGC re-derives from it (NEC 250.122) and it
   * flows into the panel schedule. Flagged when below 125% of continuous amps.
   */
  ocpdOverrideA?: number;
  /** Per-row conduit material, when it differs from the Setup toggle (hybrid installs). */
  conduitOverride?: ConduitMaterial;
  /** Row generated by the service-chain builder — shown read-only, regenerated every compute. */
  synthetic?: boolean;
  /**
   * Identity of a row the Quick Estimate generated — "<loadTypeId> #<n>". Hand
   * edits to the row are recorded on project.takeoffEdits under this key and
   * re-applied after every rebuild (lib/calc/quickstart applyTakeoffEdits).
   */
  genKey?: string;
  /** Row added by hand on the Takeoff tab — carried through every rebuild as is. */
  manual?: boolean;
  /**
   * This charger is CLIENT POWERED: fed from the client's existing panel or
   * board, not from our service. Its load leaves our buses (so our switchgear,
   * step-down and sub-panel size without it), its branch breaker is still
   * priced (landed in the client's gear) and its branch circuit stays. Any
   * number of chargers can carry it — two of twenty, say. The engine also sets
   * it on every Level 2 row when peripherals.l2ClientPowered is on.
   */
  clientPowered?: boolean;
}

/** A hand edit to a generated takeoff row, keyed by the row's genKey. `removed` drops the row. */
export type TakeoffEdit = Partial<Pick<TakeoffRowInput, "loadTypeId" | "location" | "units" | "oneWayDistFt" | "runsPerUnitOverride" | "sizeOverride" | "ocpdOverrideA" | "conduitOverride" | "clientPowered">> & {
  removed?: boolean;
};

/**
 * Per-project overrides of the vendor $/ft tables — a materials quote in place
 * of the shipped Rexel list. Keys are the table's own size strings; a missing
 * key or field keeps the shipped price.
 */
export interface MaterialRates {
  wire?: Record<string, { cuPerFt?: number; alPerFt?: number }>;
  conduit?: Record<string, { pvcPerFt?: number; emtPerFt?: number }>;
}

export interface TakeoffRowComputed extends TakeoffRowInput {
  category: Category | "";
  material: Material;
  volts: number;
  phases: 1 | 3;
  resolvedRunsPerUnit: number;
  condPerRun: number;
  ocpdA: number;
  designAmps: number;
  contAmps: number;
  cmReqdVD: number;
  idxAmp: number;
  idxVD: number;
  idxDesignMin: number;
  selectedWire: string;
  wireFt: number;
  wireCostPerFt: number;
  wireCost: number;
  groundSize: string;
  groundFt: number;
  groundCostPerFt: number;
  groundCost: number;
  conduitSize: string;
  conduitFt: number;
  conduitCostPerFt: number;
  conduitCost: number;
  dataFt: number;
  dataCost: number;
  rowTotal: number;
  flag: string;
}

export interface Rollups {
  nL2: number;
  nDCFC: number;
  nChargers: number;
  /** Level 2 stalls — plugs, not units. A dual-port unit serves two. */
  nL2Stalls: number;
  nFeeders: number;
  nCircuits: number;
  longestRunFt: number;
  totalConductorFt: number;
  totalConduitFt: number;
  totalDataFt: number;
  feederMaterialsTotal: number;
}

export interface MaterialsWireLine {
  size: string;
  cuFt: number;
  cuPerFt: number;
  cuCost: number;
  alFt: number;
  alPerFt: number;
  alCost: number;
  flag: string;
}

export interface MaterialsConduitLine {
  tradeSize: string;
  /** PVC or EMT — hybrid installs mix both (EMT branch runs + PVC service trench), each priced at its own rate. */
  conduitType: ConduitMaterial;
  feederFt: number;
  dataFt: number;
  totalFt: number;
  perFt: number;
  cost: number;
  flag: string;
}

export interface MaterialsResult {
  wireLines: MaterialsWireLine[];
  conduitLines: MaterialsConduitLine[];
  conductorSubtotalCu: number;
  conductorSubtotalAl: number;
  conduitSubtotal: number;
  dataCableCost: number;
  grandTotal: number;
  crossCheck: number; // must round to 0.00
}

export interface GearSelection {
  item: string;
  size: string;
  voltage: string;
  qty: number;
  costOverride?: number;
  /** Branch breakers for client-powered chargers — priced, but landed in the client's existing panel or board. */
  clientPowered?: boolean;
}

export interface HardwareItem {
  name: string;
  qty: number;
  unitCost: number;
  auto: boolean;
}

export interface CivilItem {
  name: string;
  qty: number;
  unitCost: number;
  auto: boolean;
}

export interface SignageItem {
  name: string;
  qty: number;
  unitCost: number;
  auto: boolean;
  /**
   * What the Takeoff would give if nobody had typed over it. Carried even when
   * overridden, so the UI can offer the derived count as the placeholder and
   * say what "→ auto" would put back.
   */
  autoQty?: number;
}

export interface FeeItem {
  name: string;
  qty: number;
  unitCost: number;
}

export interface CustomLineItem {
  name: string;
  qty: number;
  unitCost: number;
}

export interface PeripheralsInput {
  gear: GearSelection[];
  /** When true, the gear list is taken from the panel schedule's suggestions instead of the manual list above. */
  useAutoGear?: boolean;
  bollardsQty: number;
  plywoodQty: number;
  lumberQty: number;
  sonoTubesQty: number;
  christyBoxQty: number;
  gfiTestQty: number;
  gfiTestUnitCost?: number; // default 2000; Boatman used 4000
  dataBoxQty: number;
  nutsQty: number;
  washersQty: number;
  elbowsQty: number;
  junctionBoxQty: number;
  /** Site-specific hardware the standard list doesn't carry (GPR scan, uni strut, combo locks...). */
  customItems?: CustomLineItem[];
  /**
   * Removal and demolition on a replacement site (cabinets out, pads broken
   * out, disposal loads, site protection) — written by the Existing tab from
   * its removal scope (lib/existing applyRemovalScope) and priced into the
   * Dump / Waste line. Absent or empty on a greenfield project.
   */
  demolitionItems?: CustomLineItem[];
  /**
   * ADA pricing. Default (no override): allowance of adaUnitCost per charger,
   * the CPM_Clean convention. Real bids often price by ADA stall count plus a
   * ramp — set adaQtyOverride (stalls) and adaRampCost for that.
   */
  adaQtyOverride?: number;
  adaUnitCost?: number; // default 3250
  adaRampCost?: number; // default 0
  /**
   * Per-type accessible EVCS pricing (CBC 11B-812: van 12ft + 5ft aisle,
   * standard 9ft + 5ft aisle, ambulatory 10ft no aisle). When ANY of the
   * three quantities is set, this path wins over adaQtyOverride/adaUnitCost:
   * allowance = van·vanCost + standard·stdCost + ambulatory·ambCost + ramp.
   */
  adaVanQty?: number;
  adaStdQty?: number;
  adaAmbQty?: number;
  adaVanUnitCost?: number; // default 6500
  adaStdUnitCost?: number; // default 4900
  adaAmbUnitCost?: number; // default 3500
  /** Installed bollard unit cost. Default 110. */
  bollardUnitCost?: number;
  /** Quoted signage and striping rates; blank uses the shipped CIVIL_RATES. */
  signUnitCost?: number;
  signPostUnitCost?: number;
  stripingUnitCost?: number;
  /**
   * Typed signage counts. Blank hands the line back to the Takeoff; a zero is
   * an answer ("no signs on this job") and is honoured, which is why these are
   * read with ?? and not ||.
   */
  signQtyOverride?: number;
  signPostQtyOverride?: number;
  adaSignPostQtyOverride?: number;
  stripingQtyOverride?: number;
  /**
   * Concrete supply (2500 PSI delivered). The order quantity is auto-derived
   * from pad volumes (DCFC pads, L2 pads, switchgear pad, step-down/sub-panel
   * pad, bollard footings) and rounded UP to whole yards the way a batch
   * plant sells it. Override the order size with concreteYardsOverride.
   */
  concreteUnitCost?: number; // default 165 $/yd
  concreteYardsOverride?: number;
  concreteShortLoadFee?: number; // default 125, charged when 0 < order < 8 yd
  /** Asphalt patch-back on charger parking stalls, $/SF. Default 5. */
  asphaltPerSf?: number;
  /** Override the auto stall-paving area (SF). Default: stalls x 162 SF (9x18 stall). */
  asphaltSfOverride?: number;
  /** Forming & anchoring consumables lump sums (anchors, elbows, plywood, lumber, hardware). */
  consumablesPerL2?: number; // default 275
  consumablesPerDcfc?: number; // default 550
  permitFeeTotal: number;
  utilityAppFee: number;
  /**
   * Customer-furnished utility substructures (lib/calc/utilityCivil): the
   * transformer pad, the cable well under it, the utility's pull boxes.
   * Set by Build from the delivery utility's rule; editable and pinnable.
   */
  transformerPadCost: number;
  cableWellCost: number;
  pullBoxQty: number;
  pullBoxUnitCost: number;
  /**
   * Concrete coring — core-drilled penetrations for EMT through slabs and
   * walls on an indoor / parking-structure route (hardware line, into the
   * wires-and-peripherals cost line). Counted by hand; absent = none.
   */
  coringQty?: number;
  /** Installed cost per core (3–4" through a 6–8" slab, coring sub, mobilisation spread). Default CIVIL_RATES.coringPerHole. */
  coringUnitCost?: number;
  /**
   * The site keeps its existing main switchgear: no new switchboard is
   * priced (the Main Distribution Switchgear line reads 0), no switchgear
   * pad is poured and the planner adds no bollards at the gear. The panel
   * schedule still sizes the frame so the intake and the adequacy check see
   * what the existing board has to carry.
   */
  existingSwitchgear?: boolean;
  /**
   * The Level 2 chargers are CLIENT POWERED: fed from the client's existing
   * 208 V panel rather than from our service. No step-down transformer and no
   * 208 V sub-panel are sized or priced, their pad and bollards drop out and
   * the Level 2 load no longer rides on the 480 V bus; the Level 2 branch
   * breakers (landed in the client's panel) and every Level 2 branch circuit
   * stay. The 208 V bus is still summed so the client's panel is told what
   * spare capacity it needs. The CEO's intake has no cell for this, so it
   * travels on the distribution schedule as a "by others" panel row.
   */
  l2ClientPowered?: boolean;
  /**
   * EVSE disconnecting means (NEC 625.43) — fused or non-fused disconnects at
   * the DC chargers, counted by hand. Priced into the sub-panels /
   * transformers / breakers line. Absent = none.
   */
  disconnectQty?: number;
  /** Installed cost each. Default steps with the largest DC branch breaker: DISCONNECT_RATES in peripherals.ts ($5,000–7,000). */
  disconnectUnitCost?: number;
  /** Christy concrete box with traffic lid at the point of connection (hardware line). Absent = none. */
  serviceBoxQty?: number;
  /** Installed cost of that box. Default 600. */
  serviceBoxUnitCost?: number;
  utilitySandCost: number;
  utilityVaultQty: number;
  utilityVaultUnitCost: number;
  dumpWasteCost: number; // not present in CPM_Clean; real bids carry this line
}

export interface PeripheralsResult {
  gearMainSwitchgear: number;
  /** Sub-panels, transformers, branch breakers and the EVSE disconnects. */
  gearOtherTotal: number;
  /** EVSE disconnects: qty × the rate in force (inside gearOtherTotal). */
  disconnectsTotal: number;
  /** The disconnect rate in force — the typed one, else the amperage default. */
  disconnectUnitCost: number;
  hardwareSubtotal: number;
  civilSubtotal: number;
  asphaltTrenching: number;
  adaAllowance: number;
  concreteImprovements: number;
  signageSubtotal: number;
  permitsSubtotal: number;
  utilitySubtotal: number;
  dumpWaste: number;
  lines: {
    hardware: HardwareItem[];
    civil: CivilItem[];
    signage: SignageItem[];
    /** Removal and demolition lines (replacement sites) — inside dumpWaste. */
    demolition: CivilItem[];
  };
}

export interface EquipmentRentalItem {
  name: string;
  qty: number;
  rate: number;
  rateBasis: string;
  durationValue: number;
  delivery: number;
  /**
   * Out of scope: priced at zero but kept with its quantity and rate intact, so
   * it costs nothing to put back. Distinct from qty 0 — that loses the number,
   * and it cannot silence the auto-quantity fencing line at all.
   */
  excluded?: boolean;
  /** A typed quantity for the auto-quantity fencing line (an imported intake's figure) — wins over the trench-length count. */
  qtyOverride?: number;
}

export interface EquipmentResult {
  items: (EquipmentRentalItem & { total: number })[];
  subtotal: number;
}

/** One line of the itemized labor breakdown (foreman, crew, flagger…). */
export interface LaborItem {
  id: string;
  name: string;
  days: number;
  dailyRate: number;
}

export interface FinancialInput {
  contingencyPct: number; // 0.10
  laborDailyRate: number;
  laborBusinessDays: number;
  /**
   * Optional itemized labor. When present (non-empty), labor cost =
   * Σ days × dailyRate (contingency per the toggle) and laborDailyRate
   * becomes a derived blended rate. When absent, labor is the simple
   * laborDailyRate × laborBusinessDays. laborBusinessDays stays the
   * SCHEDULE duration either way (drives equipment rental & timeline).
   */
  laborItems?: LaborItem[];
  /**
   * Both source workbooks load the labor daily rate with the same 10%
   * contingency as the construction lines (Costs Internal "ZERO IMPACT
   * BUILDERS COSTS": 2,250 -> 2,475/day). Defaults to true to match them.
   */
  applyContingencyToLabor?: boolean;
  salesTaxPct: number; // 0.0725
  chargerHardwareCost: number;
  /** True when chargerHardwareCost tracks the global charger-price catalog
   * (counts x $/unit, re-derived when catalog prices change); false once the
   * user hand-types a cost on the Financials tab. */
  chargerHardwareCostIsAuto?: boolean;
  /**
   * True while warranty, service and EVOLV track the price book's service
   * classes and the Commercial tab's terms (lib/skus). Hand-typing any of the
   * three on the Financials tab switches it off.
   */
  serviceTermsAuto?: boolean;
  chargerWarrantyCost: number;
  evolvCommissioningCost: number;
  fiveYearServiceCost: number;
  autoCadDesignCost: number;
  electricalEngDesignCost: number;
  /**
   * Design as the intake prices it — drawing sets at a rate per set
   * (Construction!B32/D32, B33/D33). A typed set count makes the fee
   * sets × rate (lib/calc/designFees); absent, the fee is the market-rate
   * formula and the sets shown are fee ÷ rate. Rates default to the
   * template's ($3,412.50 / $2,080).
   */
  autoCadSets?: number;
  autoCadSetRate?: number;
  eeSets?: number;
  eeSetRate?: number;
  /** Design / permitting PM hours at pmHourlyRate — a manual entry. */
  pmHours: number;
  pmHourlyRate: number; // 358
  /**
   * Construction PM as a share of the loaded labour line — the CEO basis
   * (EVSE Project Intake 2.9.0, Construction!B10 = 15%). computeCosts adds
   * labor × pmPctOfLabor as its own line: not taxed, not in the construction
   * subtotal. Absent on projects saved before Sept 2026 → 0, so their Total
   * Cost is unchanged; defaultFinancial() and Quick Estimate set 0.15.
   */
  pmPctOfLabor?: number;
  planCheckPermitFee: number;
}

export interface CostLine {
  name: string;
  base: number;
  contingency: number;
  finalCost: number;
}

export interface CostsResult {
  lines: CostLine[];
  /**
   * Design and engineering before the plan-check fee: site plan + stamped
   * electrical set + PM hours × rate, or the override register's "design"
   * figure when one is active. The price layer reads this, not the fields.
   */
  designAndEngineering: number;
  electricalSupplyConstructionTotal: number;
  labor: number;
  /** Construction PM = labor × pmPctOfLabor (CEO basis). 0 when the field is unset. */
  constructionPm: number;
  salesTaxOnConstruction: number;
  equipmentPurchaseInvoice: number;
  equipmentPurchaseTax: number;
  designInvoice: number;
  totalCost: number;
}

export interface QACheck {
  label: string;
  ok: boolean;
  detail: string;
}

/** One "model × count" line in the Quick Estimate wizard. */
export interface QuickChargerLine {
  loadTypeId: string;
  count: number;
  /**
   * Price-book SKU (lib/ref/priceBook). When set, the load type above was
   * derived from it (lib/skus) and hardware prices at the SKU's list price
   * instead of the catalog allowance.
   */
  sku?: string;
}

/** A price-book item with no circuit of its own: a dispenser (adds ports to a power cabinet) or an accessory (price only). */
export interface QuickExtraLine {
  sku: string;
  count: number;
}

/**
 * Everything the Quick Estimate tab asks for. buildQuickProject() expands
 * this into a full Project — takeoff, gear, civil, design fees, permits,
 * scanning, labor — so a non-technical user never touches the detail tabs.
 */
export interface QuickEstimateInput {
  clientName: string;
  siteAddress: string;
  lines: QuickChargerLine[];
  /** One-way distance from the power source to the nearest DCFC / L3 charger (ft). */
  firstRunFtDcfc: number;
  /** One-way distance from the power source to the nearest L2 charger (ft). */
  firstRunFtL2: number;
  /** Extra distance for each subsequent charger of the same level (ft). */
  stepFt: number;
  terrain: Terrain;
  /** Conduit routing: underground trench, surface EMT (garage), or hybrid. Absent = trench. */
  installMethod?: InstallMethod;
  includeChargerHardware: boolean;
  includeSitePlanDesign: boolean;
  includeSldDesign: boolean;
  includeCpm: boolean;
  includePermits: boolean;
  includePrivateScan: boolean;
  /** Dispensers and accessories from the price book — priced and counted for EVOLV ports, never in the takeoff. */
  extras?: QuickExtraLine[];
}

/**
 * One row of the override register (the intake's Overrides tab): a typed value
 * that replaces an engine- or model-derived figure, with the reason. The key
 * catalogue lives in lib/overrides.ts; the engine honours the "line:<name>",
 * "siteWorks" and "design" keys in computeCosts, the business model honours
 * its own, and field-class keys are written through to the field they name.
 */
export interface OverrideEntry {
  id: string;
  key: string;
  value: number;
  reason: string;
  source?: string;
  date?: string;
}

export interface Project {
  setup: Setup;
  takeoff: TakeoffRowInput[];
  loadTypes: LoadType[];
  peripherals: PeripheralsInput;
  equipment: EquipmentRentalItem[];
  financial: FinancialInput;
  /** Last Quick Estimate wizard state, so the tab restores after reload. */
  quick?: QuickEstimateInput;
  /**
   * Proposal layer (lib/proposal): the CEO's commercial terms — markups,
   * discounts, pass-through fees, scope of supply, margin assumptions. Optional:
   * projects saved before the layer existed have none and price exactly as
   * before; the engine never reads it.
   */
  commercial?: import("../proposal/types").CommercialInput;
  /** Client, site, access, utility and proposal metadata (the CEO intake's Project tab). Optional. */
  intake?: import("../proposal/types").IntakeInput;
  /** The existing installation on a replacement site (the intake's Existing tab). Optional; absent on greenfield projects. */
  existing?: import("../existing").ExistingInput;
  /** The override register (the intake's Overrides tab). Optional; absent = every figure engine-derived. */
  overrides?: OverrideEntry[];
  /**
   * Fields typed by hand on the intake-shaped tabs that a Quick Estimate
   * rebuild would otherwise re-derive (crew days, site-works quantities, fees,
   * rentals…). Dot paths, see lib/intake/rebuild.ts. A rebuild re-derives
   * everything else and restores these.
   */
  sticky?: string[];
  /** Hand edits to generated takeoff rows, by genKey — re-applied after every rebuild. */
  takeoffEdits?: Record<string, TakeoffEdit>;
}

export interface EstimateResult {
  rows: TakeoffRowComputed[];
  rollups: Rollups;
  materials: MaterialsResult;
  peripherals: PeripheralsResult;
  equipment: EquipmentResult;
  costs: CostsResult;
  qa: QACheck[];
  panel: import("./panel").PanelSchedule;
}
