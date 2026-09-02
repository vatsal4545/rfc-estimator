import type {
  CostLine,
  CostsResult,
  EquipmentResult,
  FinancialInput,
  LaborItem,
  MaterialsResult,
  OverrideEntry,
  PeripheralsResult,
} from "./types";

/** The eleven construction cost lines, in the Costs Internal / Summary order. */
export const COST_LINE_NAMES = [
  "Wires, Conduits & Electrical Peripherals",
  "Main Distribution Switchgear",
  "Electrical Sub-Panels, Transformers, Breakers",
  "Striping, Bollards, Signage",
  "Asphalt and Paving",
  "Concrete Improvements",
  "ADA",
  "Dump / Waste",
  "Permits",
  "Utility",
  "Construction Equipment",
] as const;
export type CostLineName = (typeof COST_LINE_NAMES)[number];

/** The four lines the intake's single "Site works (before uplift)" override spans. */
export const SITE_WORKS_LINES: CostLineName[] = ["Striping, Bollards, Signage", "Asphalt and Paving", "Concrete Improvements", "ADA"];

/** Override-register entries the engine honours: cost-line bases, the site-works total and design + engineering. */
export interface EngineOverrides {
  lines: Map<string, number>;
  siteWorks?: number;
  design?: number;
}

export function engineOverridesOf(entries?: OverrideEntry[]): EngineOverrides {
  const out: EngineOverrides = { lines: new Map() };
  for (const e of entries ?? []) {
    if (!Number.isFinite(e.value)) continue;
    if (e.key.startsWith("line:")) out.lines.set(e.key.slice(5), e.value);
    else if (e.key === "siteWorks") out.siteWorks = e.value;
    else if (e.key === "design") out.design = e.value;
  }
  return out;
}

/**
 * The labor cost lines: the itemized breakdown when one was entered,
 * otherwise a single derived crew line (rate × schedule days). `blendedRate`
 * is base / schedule-days — what the Costs Internal sheet shows as the daily
 * cost so its rate × days × contingency chain still ties.
 */
export function laborBreakdown(financial: FinancialInput): {
  items: LaborItem[];
  itemized: boolean;
  base: number;
  blendedRate: number;
} {
  const itemized = (financial.laborItems?.length ?? 0) > 0;
  const items: LaborItem[] = itemized
    ? financial.laborItems!
    : [{ id: "crew", name: "Electrical crew", days: financial.laborBusinessDays, dailyRate: financial.laborDailyRate }];
  const base = items.reduce((s, i) => s + i.days * i.dailyRate, 0);
  const blendedRate = financial.laborBusinessDays > 0 ? base / financial.laborBusinessDays : 0;
  return { items, itemized, base, blendedRate };
}

/**
 * Mirrors the real Costs Internal -> Summary chain (see the Boatman RFC_V18
 * sample): each construction line gets its own contingency-loaded row, labor
 * is added without contingency, and sales tax is applied to the construction
 * subtotal. Unlike the source workbooks, Equipment Purchase Invoice and
 * Design Invoice are wired into Total Cost instead of silently reading two
 * empty section-header cells (Summary!B3 / B8 in the original).
 */
export function computeCosts(
  materials: MaterialsResult,
  peripherals: PeripheralsResult,
  equipment: EquipmentResult,
  financial: FinancialInput,
  overrides: EngineOverrides = { lines: new Map() },
): CostsResult {
  const raw: { name: string; base: number }[] = [
    { name: "Wires, Conduits & Electrical Peripherals", base: materials.grandTotal + peripherals.hardwareSubtotal },
    { name: "Main Distribution Switchgear", base: peripherals.gearMainSwitchgear },
    { name: "Electrical Sub-Panels, Transformers, Breakers", base: peripherals.gearOtherTotal },
    { name: "Striping, Bollards, Signage", base: peripherals.signageSubtotal },
    { name: "Asphalt and Paving", base: peripherals.asphaltTrenching },
    { name: "Concrete Improvements", base: peripherals.concreteImprovements },
    { name: "ADA", base: peripherals.adaAllowance },
    { name: "Dump / Waste", base: peripherals.dumpWaste },
    { name: "Permits", base: peripherals.permitsSubtotal },
    { name: "Utility", base: peripherals.utilitySubtotal },
    { name: "Construction Equipment", base: equipment.subtotal },
  ];

  // Override register: a typed base replaces the engine's for a line; the
  // site-works figure rescales the four civil lines so their total matches
  // (all of it lands on Concrete Improvements when the engine has none).
  for (const r of raw) {
    const forced = overrides.lines.get(r.name);
    if (forced !== undefined) r.base = forced;
  }
  if (overrides.siteWorks !== undefined) {
    const civil = raw.filter((r) => (SITE_WORKS_LINES as string[]).includes(r.name));
    const total = civil.reduce((s, r) => s + r.base, 0);
    if (total > 0) for (const r of civil) r.base = (r.base / total) * overrides.siteWorks;
    else {
      for (const r of civil) r.base = 0;
      raw.find((r) => r.name === "Concrete Improvements")!.base = overrides.siteWorks;
    }
  }

  const lines: CostLine[] = raw.map((r) => {
    const contingency = r.base * financial.contingencyPct;
    return { name: r.name, base: r.base, contingency, finalCost: r.base + contingency };
  });

  const electricalSupplyConstructionTotal = lines.reduce((s, l) => s + l.finalCost, 0);
  const labor =
    laborBreakdown(financial).base *
    ((financial.applyContingencyToLabor ?? true) ? 1 + financial.contingencyPct : 1);
  const salesTaxOnConstruction = electricalSupplyConstructionTotal * financial.salesTaxPct;
  // Construction PM on the CEO basis (intake 2.9.0, Construction!B10): a share
  // of the loaded labour line. Cost, not price — the 20% labour markup lives
  // in the proposal layer. Not taxed, outside the construction subtotal, and
  // 0 when the field is unset so older saved projects keep their Total Cost.
  const constructionPm = labor * (financial.pmPctOfLabor ?? 0);

  const equipmentPurchaseInvoice =
    financial.chargerHardwareCost +
    financial.chargerWarrantyCost +
    financial.evolvCommissioningCost +
    financial.fiveYearServiceCost;
  const equipmentPurchaseTax = financial.chargerHardwareCost * financial.salesTaxPct;

  // Design and engineering: site plan + stamped set + PM hours, or the
  // register's typed figure; the plan-check fee rides on top either way.
  const designAndEngineering =
    overrides.design ?? financial.autoCadDesignCost + financial.electricalEngDesignCost + financial.pmHours * financial.pmHourlyRate;
  const designInvoice = designAndEngineering + financial.planCheckPermitFee;

  const totalCost =
    equipmentPurchaseInvoice +
    equipmentPurchaseTax +
    designInvoice +
    electricalSupplyConstructionTotal +
    salesTaxOnConstruction +
    labor +
    constructionPm;

  return {
    lines,
    designAndEngineering,
    electricalSupplyConstructionTotal,
    labor,
    constructionPm,
    salesTaxOnConstruction,
    equipmentPurchaseInvoice,
    equipmentPurchaseTax,
    designInvoice,
    totalCost,
  };
}
