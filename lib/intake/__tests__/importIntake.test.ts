import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GPR_ITEM_NAME } from "../../calc/autoplan";
import { defaultProject } from "../../calc/defaults";
import { computeEstimate } from "../../calc/engine";
import { computeExisting } from "../../existing";
import { computeInterconnection } from "../../interconnection";
import { computeProposal } from "../../proposal";
import { defaultCommercial } from "../../proposal/defaults";
import { importIntakeFile, looksLikeIntake, projectFromIntake } from "../importIntake";
import { readWorkbook } from "../xlsx";

const FIXTURE = join(__dirname, "..", "__fixtures__", "intake-sample-3.1.0.xlsx");
const TEMPLATE = join(__dirname, "..", "..", "..", "templates", "source", "EVSE_Project_Intake_TEMPLATE_3.1.0.xlsx");

describe("importing a completed intake workbook", async () => {
  const base = { ...defaultProject(), commercial: defaultCommercial() };
  const result = await importIntakeFile(readFileSync(FIXTURE), base);
  const { project, report } = result;
  const estimate = computeEstimate(project);
  const proposal = computeProposal(project, estimate)!;

  it("recognises the workbook and records its version", () => {
    expect(report.templateVersion).toBe("3.1.0");
    expect(report.contentHash).toBe("4aecae7d4b5f25a9");
    expect(report.fileVersion).toBe("Rev A");
    expect(report.completedBy).toBe("Test CPM");
    expect(report.dateCompleted).toBe("2026-09-02");
    expect(result.name).toBe("Best Western Hawthorne");
    expect(report.warnings.filter((w) => /not found/.test(w))).toHaveLength(0);
  });

  it("Project tab → setup and intake", () => {
    expect(project.setup.clientName).toBe("Best Western Hawthorne");
    expect(project.setup.siteAddress).toBe("15000 Hawthorn Blvd, Hawthorne, CA 90260");
    expect(project.setup.utility).toBe("SCE — Southern California Edison");
    expect(project.setup.cpm).toBe("Vatsal Patel");
    expect(project.setup.cra).toBe("Account Owner");
    expect(project.setup.scopeOfWork).toMatch(/^Installation of \(4\) 360 kW/);
    const it = project.intake!;
    expect(it.contactName).toBe("Mohammad Noorali");
    expect(it.contactEmail).toBe("gm@example.com");
    expect(it.propertyType).toBe("Hotel");
    expect(it.publicAccess).toBe("Yes");
    expect(it.hoursOpen).toBe(24);
    expect(it.daysOpenPerYear).toBe(365);
    expect(it.daysPerWeek).toBe(7);
    expect(it.state).toBe("California");
    expect(it.rateSchedule).toBe("TOU-EV-9"); // Revenue!B36, the schedule the site will take
    expect(it.currentRateSchedule).toBe("TOU-GS-2");
    expect(it.existingServiceA).toBe(800);
    expect(it.existingServiceVoltage).toBe(480);
    expect(it.billsObtained).toBe("Yes");
    expect(it.proposalDate).toBe("2026-09-01");
    expect(it.validityDays).toBe(30);
    expect(it.projectReference).toBe("BW-TEST-001");
    expect(it.county).toBe("Los Angeles");
    expect(it.cca).toBe("Clean Power Alliance");
    expect(it.notes).toMatch(/Imported from EVSE Project Intake 3\.1\.0 Rev A completed by Test CPM on 2026-09-02/);
  });

  it("Equipment and Electrical → Quick Estimate lines, distances, materials and gear", () => {
    const q = project.quick!;
    expect(q.lines).toEqual([
      { loadTypeId: "DCFC 360kW Dual", count: 4, sku: "TP5-360-480-2-300" },
      { loadTypeId: "L2 Dual 40A", count: 2, sku: "CTX-C40-240-2" },
    ]);
    expect(q.extras ?? []).toEqual([]);
    expect(q.firstRunFtDcfc).toBe(80);
    expect(q.stepFt).toBe(15); // 80 → 125 across four cabinets
    expect(q.firstRunFtL2).toBe(60);
    expect(q.installMethod).toBe("trench");
    expect(project.setup.feederMaterial).toBe("Cu");
    expect(project.setup.serviceChain?.utilityToSwitchgearFt).toBe(0); // the utility provides the service run
    expect(project.setup.gearOverrides?.switchgear480A).toBe(3200);
    expect(estimate.panel.bus480?.suggestedBusA).toBe(3200);
    expect(project.takeoff.filter((r) => !r.synthetic)).toHaveLength(6);
    expect(estimate.rows.some((r) => r.loadTypeId.startsWith("SVC"))).toBe(false);
    // Quoted distribution gear lands in the wires and peripherals line.
    expect(project.peripherals.customItems!.some((c) => c.name.startsWith("EVSE disconnects") && c.unitCost === 12000)).toBe(true);
    expect(report.mapped.some((m) => /Distribution equipment: 1 quoted item/.test(m))).toBe(true);
    expect(report.skipped.some((s) => /Trench surface/.test(s))).toBe(true);
  });

  it("Construction → labour, D&E, site-works quantities, rentals and pass-through fees", () => {
    const f = project.financial;
    expect(f.laborBusinessDays).toBe(34);
    expect(f.laborDailyRate).toBe(2750);
    expect(f.contingencyPct).toBe(0.1);
    expect(f.pmPctOfLabor).toBe(0.15);
    expect(f.salesTaxPct).toBe(0.0725);
    expect(f.autoCadDesignCost).toBeCloseTo(3 * 3412.5, 6);
    expect(f.electricalEngDesignCost).toBeCloseTo(3 * 2080, 6);
    expect(f.pmHours).toBe(35);
    expect(f.pmHourlyRate).toBe(358);
    expect(estimate.costs.designAndEngineering).toBeCloseTo(29007.5, 6);
    expect(f.planCheckPermitFee).toBe(0); // permit + plan check carried as one pass-through fee
    const per = project.peripherals;
    expect(per.concreteYardsOverride).toBe(6);
    expect(per.asphaltSfOverride).toBe(400);
    expect(per.adaVanQty).toBe(1);
    expect(per.adaStdQty).toBe(1);
    expect(per.adaAmbQty).toBe(0);
    expect(per.adaRampCost).toBe(5200);
    expect(per.bollardsQty).toBe(12);
    expect(per.gfiTestQty).toBe(1);
    expect(per.dumpWasteCost).toBe(5000);
    expect(per.customItems!.find((c) => c.name === GPR_ITEM_NAME)!.qty).toBe(1);
    expect(per.permitFeeTotal).toBe(4000 + 850);
    expect(per.utilityAppFee).toBe(3500);
    expect(project.commercial!.utilityInterconnectFee).toBe(3500);
    expect(project.commercial!.lineExtensionContribution).toBeUndefined();
    expect(project.commercial!.markupLaborPct).toBe(0.2);
    expect(project.commercial!.markupMaterialsPct).toBe(0.2);
    const rental = (name: string) => project.equipment.find((e) => e.name === name)!;
    expect(rental("Mini excavator")).toMatchObject({ qty: 1, durationValue: 30, rate: 2110 }); // intake days, estimator rate
    expect(rental("Dump truck")).toMatchObject({ qty: 1, durationValue: 4 });
    expect(rental("Generator rental")).toMatchObject({ qty: 1, rate: 220, durationValue: 10 }); // not in the standard list → appended at the intake's rate
    expect(report.skipped.some((s) => /Rebar/.test(s))).toBe(false); // nothing entered for rebar
  });

  it("Commercial, Revenue, Carbon and Deal_Structure → the price layer and the business model", () => {
    const c = project.commercial!;
    expect(c.discountHardwarePct).toBe(0.07);
    expect(c.discountInHousePct).toBe(0.07);
    expect(c.serviceTerms).toMatchObject({ contractYears: 5, evolvPerPortMonth: 39.99, includedWarrantyYears: 2 });
    expect(c.financing).toMatchObject({ offered: true, lender: "De Lage Landen", annualRate: 0.0839, termYears: 5, paymentsPerYear: 12, downPayment: 0, startDate: "2026-10-01", horizonYears: 10, discountRate: 0.0839, financeBasis: "whole" });
    expect(c.revenue).toMatchObject({ retailPerKwh: 0.62, cardFeePct: 0.03, idleFeeRevenue: false, stallOccupancy: 0.2, taperFactor: 0.7, rampYear2: 0.75, growthAfterRamp: 0.06, benchmarkState: "California" });
    // The tariff block carried a volumetric figure and a customer charge → manual basis, flat.
    expect(c.tariff!.basis).toBe("manual");
    expect(c.tariff!.manual).toMatchObject({ peakPerKwh: 0.28, offPeakPerKwh: 0.28, superOffPeakPerKwh: 0.28, customerPerMonth: 701.42, demandPerKwMonth: 0 });
    expect(c.tariff!.touShares).toBeNull();
    expect(c.tariff!.subscriptionPolicy).toBe("ramped");
    expect(c.tariff!.peakToAverageFactor).toBe(4);
    expect(c.tariff!.provenance).toMatchObject({ source: "SCE TOU-EV rate fact sheet, July 2025", verified: "No", verifiedBy: "VP · 2026-09-01" });
    expect(c.carbon).toMatchObject({ qualifies: "Yes", permitClears2022: "Yes", aggregator: "Registered aggregator LLC", aggregatorSharePct: 0.05, fciRatePerKwYear: 71.6667, creditingYears: 10, l2CreditPerKwh: 0.0045, capMultiple: 1.5, federalItc: "No", stateProgramme: "Fast Charge California", stateProgrammeOutcome: "Does not qualify" });
    expect(c.deal).toMatchObject({ name: "Carbon share test", carbonSharePct: 0.5, revenueSharePct: 0.1, revenueShareBasis: "profit", shareYears: 10, extraDiscountHardwarePct: 0.05, capitalContribution: 100000, minReturnMultiple: 2, maxContribution: 150000 });
    expect(c.scope.design).toBe("others");
    expect(c.scope.hardware).toBe("we");
    expect(c.scope.salesTax).toBe("we");
    const m = proposal.model;
    expect(m.tariff.basis).toBe("manual");
    expect(m.tariff.blendedPerKwh).toBe(0.28);
    expect(m.tariff.years[0].customerChargeCost).toBeCloseTo(701.42 * 12, 6);
    expect(m.financing.payment).toBeGreaterThan(0);
    expect(m.deal.isBaseCase).toBe(false);
    expect(proposal.margin.rows.find((r) => r.line === "design")!.status).toBe("others");
  });

  it("Existing tab → a replacement site with twelve months of history driving the revenue model", () => {
    const x = project.existing!;
    expect(x.projectType).toBe("replace");
    expect(x.ageYears).toBe(7);
    expect(x.register.service).toBe("RETAIN");
    expect(x.register.switchgear).toBe("REPLACE");
    expect(x.register.paving).toBe("PARTIAL");
    expect(x.units).toHaveLength(2);
    expect(x.units[1]).toMatchObject({ makeModel: "ChargePoint Express 250", kw: 62.5, ports: 1, qty: 2, working: "Failed" });
    expect(x.infrastructure).toMatchObject({ serviceA: 800, voltage: 480, spareA: 200, frameA: 800, branchConductor: "250 KCMIL Cu", separatelyMetered: "No" });
    expect(x.history).toHaveLength(12);
    expect(x.history[0]).toMatchObject({ month: "2025-09", kwh: 9800, portsWorking: 4 });
    expect(x.history[2].note).toBe("Two units down all month");
    expect(x.connectors.nacs).toEqual({ onExisting: false, onNew: true, fleetShare: 0.55 });
    expect(x.connectors.chademo).toEqual({ onExisting: true, onNew: false, fleetShare: 0.03 });
    expect(x.removal).toMatchObject({ cabinets: 4, pads: 4, bollards: 8, signs: 4, disposalLoads: 2, recycling: "Yes", hazmat: "No", temporaryCharging: "No", protectionDays: 5 });
    expect(x.revenueBasis).toBe("historical");
    // Removal priced into Dump / Waste; the model runs on history × uplifts.
    expect(project.peripherals.demolitionItems).toHaveLength(6);
    expect(estimate.peripherals.dumpWaste).toBeCloseTo(5000 + 5665, 6);
    const r = computeExisting(x, { newPorts: 12, newDcPositions: 8, newDcKw: 1440, newConnectedKw: 1468.8, serviceVoltage: 480, benchmarkUtilisation: 0.231, benchmarkState: "California" });
    expect(r.history.kwhPerYear).toBe(145000);
    expect(proposal.model.usage.basis).toBe("override"); // the register forces kWh/day — see below
    expect(proposal.model.context.historical?.months).toBe(12);
  });

  it("Overrides tab → the register, with field-class entries written through", () => {
    const keys = (project.overrides ?? []).map((o) => o.key).sort();
    expect(keys).toEqual(["kwhPerDay", "line:Electrical Sub-Panels, Transformers, Breakers", "line:Main Distribution Switchgear", "retailPerKwh", "switchgearA"]);
    // The intake's one "switchgear and distribution" row spans both estimator lines: the quote lands on the first, the second is zeroed.
    expect(estimate.costs.lines.find((l) => l.name === "Electrical Sub-Panels, Transformers, Breakers")!.base).toBe(0);
    const sg = project.overrides!.find((o) => o.key === "line:Main Distribution Switchgear")!;
    expect(sg.value).toBe(150000);
    expect(sg.reason).toBe("Vendor quote for the switchboard");
    expect(sg.source).toMatch(/Overrides!B10/);
    expect(estimate.costs.lines.find((l) => l.name === "Main Distribution Switchgear")!.base).toBe(150000);
    expect(proposal.model.usage.siteKwhPerDay).toBe(1400);
    expect(proposal.model.inputs.revenue.retailPerKwh).toBe(0.62);
    expect(project.setup.gearOverrides?.switchgear480A).toBe(3200);
  });

  it("Rule 29 block → the interconnection record", () => {
    const ic = project.intake!.interconnection!;
    expect(ic).toMatchObject({
      serviceType: "Added load to existing service",
      serviceRoute: "Underground",
      distanceToPoiFt: 150,
      applicationSubmitted: "No",
      rule15Indicated: "Unknown — design not yet submitted",
      rule16: "Unknown",
      padLocationAgreed: "Yes",
      proofOfCommitment: "Yes",
      acceptsOandM: "Yes",
      acceptsActivation: "Yes",
      serviceFeederBy: "Utility — EV infrastructure rule",
      pointOfConnection: "Existing MSB",
    });
    const r = computeInterconnection(project, estimate, proposal.costBuildup);
    expect(r.regime.regime).toBe("sce-rule29");
    // Service retained on the Existing tab but a $3,500 design fee is carried — the check says so.
    expect(r.checks.find((c) => c.label.startsWith("Retained service"))!.ok).toBe(false);
    expect(r.customerBears.find((b) => b.item.startsWith("Service entrance"))!.inPrice).toBe("NO — EXCLUDED");
  });

  it("the report lists what landed and what did not", () => {
    expect(report.mapped.length).toBeGreaterThan(15);
    expect(report.mapped.some((m) => /Equipment: 4 × TP5-360-480-2-300 → sized as DCFC 360kW Dual/.test(m))).toBe(true);
    expect(report.mapped.some((m) => /Override: .*150000/.test(m))).toBe(true);
    expect(report.mapped.some((m) => /Removal scope: 6 line/.test(m))).toBe(true);
    expect(report.skipped.some((s) => /Service voltage level/.test(s))).toBe(true);
    expect(report.warnings.some((w) => /Build button re-derives/.test(w))).toBe(true);
    expect(project.commercial!.additionalScope).toBe(0);
  });

  it("the blank template imports as an empty greenfield project with warnings, and a non-intake workbook is refused", async () => {
    const wb = await readWorkbook(readFileSync(TEMPLATE));
    expect(looksLikeIntake(wb)).toBe(true);
    const blank = projectFromIntake(wb, base);
    expect(blank.project.quick!.lines).toEqual([]);
    expect(blank.project.existing).toBeUndefined();
    expect(blank.project.overrides).toBeUndefined();
    expect(blank.report.warnings.some((w) => /No charger lines/.test(w))).toBe(true);
    expect(blank.name).toBe("Imported intake");
    // The defaults the template ships travel across even when nothing is filled in.
    expect(blank.project.financial.laborDailyRate).toBe(2750);
    expect(blank.project.commercial!.financing!.annualRate).toBe(0.0839);
    expect(blank.project.commercial!.revenue!.retailPerKwh).toBe(0.65);
    expect(computeEstimate(blank.project).costs.totalCost).toBeGreaterThanOrEqual(0);
    const fake = { sheetNames: ["Sheet1"], has: () => false, get: () => null, formula: () => undefined, cells: () => new Map() };
    expect(looksLikeIntake(fake)).toBe(false);
  });
});
