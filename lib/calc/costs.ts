import type {
  CostLine,
  CostsResult,
  EquipmentResult,
  FinancialInput,
  LaborItem,
  MaterialsResult,
  PeripheralsResult,
} from "./types";

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

  const lines: CostLine[] = raw.map((r) => {
    const contingency = r.base * financial.contingencyPct;
    return { name: r.name, base: r.base, contingency, finalCost: r.base + contingency };
  });

  const electricalSupplyConstructionTotal = lines.reduce((s, l) => s + l.finalCost, 0);
  const labor =
    laborBreakdown(financial).base *
    ((financial.applyContingencyToLabor ?? true) ? 1 + financial.contingencyPct : 1);
  const salesTaxOnConstruction = electricalSupplyConstructionTotal * financial.salesTaxPct;

  const equipmentPurchaseInvoice =
    financial.chargerHardwareCost +
    financial.chargerWarrantyCost +
    financial.evolvCommissioningCost +
    financial.fiveYearServiceCost;
  const equipmentPurchaseTax = financial.chargerHardwareCost * financial.salesTaxPct;

  const designInvoice =
    financial.autoCadDesignCost +
    financial.electricalEngDesignCost +
    financial.pmHours * financial.pmHourlyRate +
    financial.planCheckPermitFee;

  const totalCost =
    equipmentPurchaseInvoice +
    equipmentPurchaseTax +
    designInvoice +
    electricalSupplyConstructionTotal +
    salesTaxOnConstruction +
    labor;

  return {
    lines,
    electricalSupplyConstructionTotal,
    labor,
    salesTaxOnConstruction,
    equipmentPurchaseInvoice,
    equipmentPurchaseTax,
    designInvoice,
    totalCost,
  };
}
