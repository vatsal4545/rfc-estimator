import type {
  CostLine,
  CostsResult,
  EquipmentResult,
  FinancialInput,
  MaterialsResult,
  PeripheralsResult,
} from "./types";

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
  const laborRate =
    financial.laborDailyRate * ((financial.applyContingencyToLabor ?? true) ? 1 + financial.contingencyPct : 1);
  const labor = laborRate * financial.laborBusinessDays;
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
