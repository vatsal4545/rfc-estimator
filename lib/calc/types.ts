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
  transformerPadCost: number;
  cableWellCost: number;
  pullBoxQty: number;
  pullBoxUnitCost: number;
  utilitySandCost: number;
  utilityVaultQty: number;
  utilityVaultUnitCost: number;
  dumpWasteCost: number; // not present in CPM_Clean; real bids carry this line
}

export interface PeripheralsResult {
  gearMainSwitchgear: number;
  gearOtherTotal: number;
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
  };
}

export interface EquipmentRentalItem {
  name: string;
  qty: number;
  rate: number;
  rateBasis: string;
  durationValue: number;
  delivery: number;
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
  chargerWarrantyCost: number;
  evolvCommissioningCost: number;
  fiveYearServiceCost: number;
  autoCadDesignCost: number;
  electricalEngDesignCost: number;
  pmHours: number;
  pmHourlyRate: number; // 358
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
  electricalSupplyConstructionTotal: number;
  labor: number;
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
