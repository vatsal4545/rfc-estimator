import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../calc/autoplan";
import { defaultProject } from "../calc/defaults";
import { computeEstimate } from "../calc/engine";
import type { Project, Terrain } from "../calc/types";
import { utilityCivilFor } from "../calc/utilityCivil";
import { defaultInterconnection } from "../interconnection";
import { fillIntakeWorkbook } from "../intake/fillIntake";
import { readWorkbook } from "../intake/xlsx";
import { computeProposal } from "../proposal";
import { defaultCommercial, defaultIntake, defaultTariff, zeroRates } from "../proposal/defaults";
import { findSku } from "../ref/priceBook";
import { applyEquipmentSchedule, loadTypeIdForSku } from "../skus";

const TEMPLATE = join(__dirname, "..", "..", "templates", "source", "EVSE_Project_Intake_TEMPLATE_3.1.0.xlsx");

interface Scenario {
  name: string;
  utility: string;
  schedule: string;
  lines: { sku: string; count: number }[];
  firstDc: number;
  firstL2: number;
  step: number;
  terrain: Terrain;
  feederByUtility?: boolean;
  manualRates?: { peak: number; off: number; superOff: number; customer: number };
  expectCivil: { pad: number; well: number; pullBoxes: number };
}

// Three utilities, three sites, three sets of numbers — the same chain must tie on every one.
const SCENARIOS: Scenario[] = [
  {
    name: "SMUD hotel — 4 × 360 kW dual + 2 dual L2, hilly, long runs",
    utility: "SMUD — Sacramento Municipal Utility District",
    schedule: "EV_SR tier EV2 (10-20% util)",
    lines: [{ sku: "TP5-360-480-2-300", count: 4 }, { sku: "CTX-C40-240-2", count: 2 }],
    firstDc: 180,
    firstL2: 90,
    step: 20,
    terrain: "hilly",
    expectCivil: { pad: 5000, well: 3500, pullBoxes: 2 },
  },
  {
    name: "SDG&E retail — 6 × 160 kW + 4 dual L2, flat, short runs, manual tariff",
    utility: "SDG&E — San Diego Gas & Electric",
    schedule: "EV-HP (>150 kW)",
    lines: [{ sku: "TP5-160-480-2-300", count: 6 }, { sku: "CTX-C80-240-2", count: 4 }],
    firstDc: 60,
    firstL2: 40,
    step: 12,
    terrain: "flat",
    expectCivil: { pad: 5000, well: 3500, pullBoxes: 1 },
  },
  {
    name: "PG&E depot — 2 × 240 kW + 8 single L2, sloped, utility builds the service run",
    utility: "PG&E — Pacific Gas and Electric",
    schedule: "BEV-2-S",
    lines: [{ sku: "TP5-240-480-2-300", count: 2 }, { sku: "CTX-C48-240-1", count: 8 }],
    firstDc: 120,
    firstL2: 150,
    step: 15,
    terrain: "sloped",
    feederByUtility: true,
    expectCivil: { pad: 0, well: 0, pullBoxes: 0 },
  },
];

export function buildScenario(sc: Scenario): Project {
  const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
  base.setup = { ...base.setup, utility: sc.utility, cpm: "Vatsal Patel", cra: "Account Owner" };
  base.intake = {
    ...defaultIntake(),
    contactName: "Site contact",
    propertyType: "Hotel",
    publicAccess: "Yes",
    hoursOpen: 24,
    daysOpenPerYear: 365,
    rateSchedule: sc.schedule,
    proposalDate: "2026-09-03",
    interconnection: { ...defaultInterconnection(), serviceType: "New service", serviceFeederBy: sc.feederByUtility ? "Utility — EV infrastructure rule" : "Zero Impact Energy" },
  };
  if (sc.manualRates) {
    base.commercial = {
      ...base.commercial!,
      tariff: { ...defaultTariff(), basis: "manual", manual: { ...zeroRates(), peakPerKwh: sc.manualRates.peak, offPeakPerKwh: sc.manualRates.off, superOffPeakPerKwh: sc.manualRates.superOff, customerPerMonth: sc.manualRates.customer } },
    };
  }
  const quick = {
    ...defaultQuickInput(),
    clientName: sc.name.split(" — ")[0],
    siteAddress: "1 Main St, Somewhere, CA 90000",
    lines: sc.lines.map((l) => ({ loadTypeId: loadTypeIdForSku(findSku(l.sku)!)!, count: l.count, sku: l.sku })),
    firstRunFtDcfc: sc.firstDc,
    firstRunFtL2: sc.firstL2,
    stepFt: sc.step,
    terrain: sc.terrain,
  };
  return applyEquipmentSchedule(buildQuickProject(quick, base, "sc", HARDWARE_ALLOWANCE), HARDWARE_ALLOWANCE);
}

describe.each(SCENARIOS)("scenario: $name", (sc) => {
  const project = buildScenario(sc);
  const result = computeEstimate(project);
  const proposal = computeProposal(project, result)!;
  const c = result.costs;
  const b = proposal.costBuildup;
  const m = proposal.margin;
  const model = proposal.model;
  const near = (a: number, x: number) => expect(a).toBeCloseTo(x, 2);

  it("sizes every charger and builds a full takeoff", () => {
    const units = sc.lines.reduce((s, l) => s + l.count, 0);
    expect(result.rows.filter((r) => !r.synthetic)).toHaveLength(units);
    expect(result.rows.every((r) => r.selectedWire !== "")).toBe(true);
    expect(result.panel.bus480!.suggestedBusA).toBeGreaterThan(0);
    expect(c.totalCost).toBeGreaterThan(100000);
  });

  it("carries the utility's substructure rule", () => {
    const rule = utilityCivilFor(sc.utility, result.rollups, sc.feederByUtility ?? false);
    expect(project.peripherals.transformerPadCost).toBe(sc.expectCivil.pad);
    expect(project.peripherals.cableWellCost).toBe(sc.expectCivil.well);
    expect(project.peripherals.pullBoxQty).toBe(sc.expectCivil.pullBoxes);
    expect(project.peripherals.serviceBoxQty).toBe(1);
    expect(rule.transformerPadCost).toBe(sc.expectCivil.pad);
    near(c.lines.find((l) => l.name === "Utility")!.base, project.peripherals.utilityAppFee + sc.expectCivil.pad + sc.expectCivil.well + sc.expectCivil.pullBoxes * 2500);
    expect(result.peripherals.lines.hardware.find((h) => h.name.startsWith("Christy box, traffic-rated"))!.qty * 600).toBe(600);
  });

  it("the number chain ties from Costs Internal to the business model", () => {
    const constructionSubtotal = c.lines.reduce((s, l) => s + l.finalCost, 0);
    near(constructionSubtotal, c.electricalSupplyConstructionTotal);
    near(c.electricalSupplyConstructionTotal + c.labor + c.constructionPm + c.salesTaxOnConstruction + c.equipmentPurchaseInvoice + c.equipmentPurchaseTax + c.designInvoice, c.totalCost);
    near(b.estimatorTotalCost, c.totalCost);
    near(b.listTotal - b.discountToCustomer, b.customerPrice);
    near(b.rows.reduce((s, r) => s + r.price, 0), b.customerPrice);
    // The only deliberate gap between Σ row cost and Total Cost is the hardware sales-tax convention (list vs discounted).
    const hardwareList = b.rows.find((r) => r.id === "hardware")!.list;
    near(c.totalCost - b.rows.reduce((s, r) => s + r.cost, 0), hardwareList * project.commercial!.discountHardwarePct * project.financial.salesTaxPct);
    near(m.contractValue + m.thirdPartyTotal, m.clientProjectCost);
    near(m.clientProjectCost, b.customerPrice);
    near(model.financing.baseAmount, m.clientProjectCost);
    near(-model.cashflow.years[0].cashflow, model.financing.baseAmount);
    near(model.carbon.netCapex, b.customerPrice - model.inputs.carbon.grantsAwarded);
    expect(model.cashflow.npv).not.toBeNaN();
    expect(model.usage.siteKwhPerYear).toBeGreaterThan(0);
  });

  it("fills the CEO's intake with the utility, the schedule and the substructures", async () => {
    const { bytes, report } = await fillIntakeWorkbook(readFileSync(TEMPLATE), project, result, proposal, { today: "2026-09-03" });
    expect(report.refused).toEqual([]);
    const wb = await readWorkbook(bytes);
    expect(wb.get("Project", "B26")).toBe(sc.utility);
    expect(wb.get("Revenue", "B36")).toBe(sc.schedule);
    expect(wb.get("Overrides", "B14")).toBeCloseTo(c.lines.find((l) => l.name === "Utility")!.base, 2);
    const reason = String(wb.get("Overrides", "D14"));
    if (sc.expectCivil.pad > 0) expect(reason).toMatch(/transformer pad/);
    else expect(reason).not.toMatch(/transformer pad/);
    // Substructures appear on the intake's distribution schedule, priced elsewhere.
    const items = Array.from({ length: 12 }, (_, i) => String(wb.get("Electrical", `A${130 + i}`) ?? "")).join(" | ");
    if (sc.expectCivil.pad > 0) expect(items).toMatch(/Transformer pad/);
    if (sc.expectCivil.pullBoxes > 0) expect(items).toMatch(/pull box/i);
    expect(wb.get("Electrical", "B119")).toBe(sc.feederByUtility ? "Utility — EV infrastructure rule" : "Zero Impact Energy");
  });
});
