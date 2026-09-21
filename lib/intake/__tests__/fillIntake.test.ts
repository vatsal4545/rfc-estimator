import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../../calc/autoplan";
import { defaultProject } from "../../calc/defaults";
import { computeEstimate } from "../../calc/engine";
import type { Project } from "../../calc/types";
import { defaultExisting, emptyMonth } from "../../existing";
import { defaultInterconnection } from "../../interconnection";
import { applyFieldOverrides } from "../../overrides";
import { computeProposal } from "../../proposal";
import { defaultCommercial, defaultDeal, defaultIntake, defaultTariff, zeroRates } from "../../proposal/defaults";
import { findSku } from "../../ref/priceBook";
import { applyEquipmentSchedule, loadTypeIdForSku } from "../../skus";
import { INTAKE_FEEDER_SIZES, conductorFromIntake, conductorToIntake, conduitToIntake, snapConductorToIntake, tradeSizeInches } from "../cells";
import { capacityForLoadType, fillIntakeWorkbook, intakeFileName, planIntakeFill, splitAddress, verifyIntakeTemplate } from "../fillIntake";
import { projectFromIntake } from "../importIntake";
import { readWorkbook } from "../xlsx";
import { patchWorkbook } from "../xlsxWrite";

const TEMPLATE = join(__dirname, "..", "..", "..", "templates", "source", "EVSE_Project_Intake_TEMPLATE_3.8.0.xlsx");

/** Best Western-shaped: 4 × TP5-360 dual + 2 × CTX-C40 dual on SCE, manual tariff, a deal structure, two register entries. */
function bwProject(): Project {
  const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
  const dc = findSku("TP5-360-480-2-300")!;
  const l2 = findSku("CTX-C40-240-2")!;
  const quick = {
    ...defaultQuickInput(),
    clientName: "Best Western Hawthorne",
    siteAddress: "15000 Hawthorn Blvd, Hawthorne, CA 90260",
    lines: [
      { loadTypeId: loadTypeIdForSku(dc)!, count: 4, sku: dc.sku },
      { loadTypeId: loadTypeIdForSku(l2)!, count: 2, sku: l2.sku },
    ],
    firstRunFtDcfc: 80,
    firstRunFtL2: 60,
    stepFt: 15,
  };
  let project = applyEquipmentSchedule(buildQuickProject(quick, base, "t", HARDWARE_ALLOWANCE), HARDWARE_ALLOWANCE);
  // The sheet has ONE conductor material (Electrical B6) and prices block I's feeders in it; keep the chain on the site material so the fill has nothing to warn about.
  project.setup = { ...project.setup, utility: "SCE — Southern California Edison", cpm: "Vatsal Patel", cra: "Account Owner", serviceChain: { ...project.setup.serviceChain!, material: project.setup.feederMaterial } };
  project.intake = {
    ...defaultIntake(),
    contactName: "Mohammad Noorali",
    contactTitle: "General Manager",
    contactEmail: "gm@example.com",
    contactPhone: "310-555-0100",
    propertyType: "Hotel",
    publicAccess: "Yes",
    hoursOpen: 24,
    daysOpenPerYear: 365,
    rateSchedule: "TOU-EV-9",
    currentRateSchedule: "TOU-GS-2",
    existingServiceA: 800,
    existingServiceVoltage: 480,
    billsObtained: "Yes",
    proposalDate: "2026-09-01",
    validityDays: 30,
    projectReference: "BW-TEST-001",
    county: "Los Angeles",
    cca: "Clean Power Alliance",
    fileVersion: "Rev B",
    completedBy: "Test CPM",
    revisionNotes: "Second issue after the site walk.",
    interconnection: {
      ...defaultInterconnection(),
      serviceType: "Added load to existing service",
      serviceRoute: "Underground",
      distanceToPoiFt: 150,
      serviceFeederBy: "Utility — EV infrastructure rule",
      pointOfConnection: "Existing MSB",
      padLocationAgreed: "Yes",
    },
  };
  project.commercial = {
    ...project.commercial!,
    discountHardwarePct: 0.15,
    utilityInterconnectFee: 3500,
    scope: { ...project.commercial!.scope, design: "others" },
    tariff: {
      ...defaultTariff(),
      basis: "manual",
      manual: { ...zeroRates(), peakPerKwh: 0.28, offPeakPerKwh: 0.28, superOffPeakPerKwh: 0.28, customerPerMonth: 701.42 },
      touShares: null,
      provenance: { source: "SCE TOU-EV rate fact sheet, July 2025", verified: "No", verifiedBy: "VP · 2026-09-01", eligibilityThreshold: "", crossesThreshold: "" },
    },
    deal: { ...defaultDeal(), name: "Carbon share test", carbonSharePct: 0.5, capitalContribution: 100000 },
  };
  const existing = defaultExisting();
  existing.projectType = "replace";
  existing.ageYears = 7;
  existing.reason = "End of life";
  existing.owner = "Client";
  existing.register.service = "RETAIN";
  existing.register.switchgear = "REPLACE";
  existing.units.push({ makeModel: "ABB Terra 54", kw: 50, ports: 2, connectors: "CCS1 / CHAdeMO", qty: 2, yearInstalled: "2018", working: "Working" });
  existing.history = ["2025-09", "2025-10", "2025-11"].map((mo, i) => ({ ...emptyMonth(mo), kwh: 10000 + i * 500, revenue: 5500, utilityCost: 2800, portsWorking: 4 }));
  existing.revenueBasis = "historical";
  project.existing = existing;
  project.overrides = [
    { id: "ov-switchgearA", key: "switchgearA", value: 3200, reason: "Engineer's single line", source: "SLD rev 2", date: "2026-09-02" },
    { id: "ov-kwhPerDay", key: "kwhPerDay", value: 1400, reason: "Traffic study, Aug 2026", date: "2026-09-02" },
  ];
  project = applyFieldOverrides(project);
  return project;
}

describe("conductor sizes the intake's sizing table does not carry", () => {
  it("rounds an estimator size up to the next one the sheet knows, and leaves a known size alone", () => {
    expect(snapConductorToIntake("3 AWG")).toEqual({ size: "2 AWG", snapped: true });
    expect(snapConductorToIntake("12 AWG")).toEqual({ size: "10 AWG", snapped: true });
    expect(snapConductorToIntake("450 kcmil")).toEqual({ size: "500 KCMIL", snapped: true });
    expect(snapConductorToIntake("450 kcmil", INTAKE_FEEDER_SIZES)).toEqual({ size: "450 KCMIL", snapped: false }); // the feeder's table has it
    expect(snapConductorToIntake("700 kcmil")).toEqual({ size: "750 KCMIL", snapped: true });
    expect(snapConductorToIntake("3/0 AWG")).toEqual({ size: "3 /0", snapped: false });
    expect(snapConductorToIntake("300 kcmil")).toEqual({ size: "300 KCMIL", snapped: false });
  });
});

describe("filling the CEO's intake from a project", async () => {
  const project = bwProject();
  const result = computeEstimate(project);
  const proposal = computeProposal(project, result)!;
  const template = readFileSync(TEMPLATE);
  const { bytes, report } = await fillIntakeWorkbook(template, project, result, proposal, { today: "2026-09-02" });
  const wb = await readWorkbook(bytes);
  const base = (name: string) => result.costs.lines.find((l) => l.name === name)!.base;
  const dcRows = result.rows.filter((r) => !r.synthetic && r.category === "DCFC");
  const l2Rows = result.rows.filter((r) => !r.synthetic && r.category === "L2");

  it("writes without a refusal and reports what it did", () => {
    expect(report.refused).toEqual([]);
    expect(report.templateVersion).toBe("3.8.0");
    expect(report.fileVersion).toBe("Rev B");
    expect(report.filled).toBeGreaterThan(150);
    expect(Object.keys(report.bySheet).sort()).toEqual(["Carbon", "Commercial", "Construction", "Deal_Structure", "Electrical", "Equipment", "Existing", "Project", "Revenue", "Revisions", "Version"]); // no Overrides: the register stays in the app unless asked for
    expect(report.leftBlank.some((s) => s.startsWith("Electrical B10"))).toBe(false); // B10 is always written now
    expect(report.warnings).toHaveLength(1); // only the "design ambient defaulted" flag
    expect(report.warnings[0]).toMatch(/^Electrical B10 design ambient written as 30 °C/);
  });

  it("Version and Project tabs", () => {
    expect(wb.get("Version", "B10")).toBe("Rev B");
    expect(wb.get("Version", "B11")).toBe("2026-09-02");
    expect(wb.get("Version", "B12")).toBe("Test CPM");
    expect(wb.get("Version", "B13")).toBe("BW-TEST-001");
    expect(wb.get("Version", "B14")).toMatch(/^Second issue after the site walk\. Filled by the RFC Estimator on 2026-09-02 for Best Western Hawthorne/);
    expect(wb.get("Version", "B4")).toBe("3.8.0"); // untouched
    expect(wb.get("Project", "B5")).toBe("Best Western Hawthorne");
    expect(wb.get("Project", "B6")).toBe("Mohammad Noorali");
    expect(wb.get("Project", "B12")).toBe("Best Western Hawthorne");
    expect(wb.get("Project", "B13")).toBe("15000 Hawthorn Blvd");
    expect(wb.get("Project", "B14")).toBe("Hawthorne, CA 90260");
    expect(wb.get("Project", "B15")).toBe("Los Angeles");
    expect(wb.get("Project", "B16")).toBe("Hotel");
    expect(wb.get("Project", "B21")).toBe("Public 24/7");
    expect(wb.get("Project", "B22")).toBe(24);
    expect(wb.get("Project", "B23")).toBe(365);
    expect(wb.get("Project", "B26")).toBe("SCE — Southern California Edison");
    expect(wb.get("Project", "B27")).toBe("TOU-GS-2");
    expect(wb.get("Project", "B28")).toBe(800);
    expect(wb.get("Project", "B30")).toBe("Yes");
    expect(wb.get("Project", "B33")).toBe("2026-09-01");
    expect(wb.get("Project", "B34")).toBe(30);
    expect(wb.get("Project", "B35")).toBe("Vatsal Patel");
    expect(wb.get("Project", "B36")).toBe("Account Owner");
    expect(wb.get("Project", "B46")).toBe("Clean Power Alliance");
  });

  it("Equipment tab: one row per SKU line, the sheet's capacity labels, the scope sentence", () => {
    expect(wb.get("Equipment", "B7")).toBe("360 kW DC");
    expect(wb.get("Equipment", "C7")).toBe("TP5-360-480-2-300");
    expect(wb.get("Equipment", "I7")).toBe(4);
    expect(wb.get("Equipment", "B8")).toBe("Level 2 AC");
    expect(wb.get("Equipment", "C8")).toBe("CTX-C40-240-2");
    expect(wb.get("Equipment", "I8")).toBe(2);
    expect(wb.get("Equipment", "C9")).toBeNull();
    expect(String(wb.get("Equipment", "B27"))).toMatch(/^Turnkey EVCS install/);
  });

  it("Electrical tab: the sizing basis, one charger-run row per unit with the engine's sizing, the frame, the feeder, the Rule 29 block", () => {
    expect(wb.get("Electrical", "B6")).toBe(project.setup.feederMaterial);
    expect(wb.get("Electrical", "B7")).toBe("PVC");
    expect(wb.get("Electrical", "B13")).toBe(project.setup.maxVoltageDropFraction);
    // Design ambient: nothing on the sheet works without B10, so an untyped project gets the NEC 310.16 table ambient (the estimator's own basis), flagged.
    expect(project.intake?.designAmbientC ?? null).toBeNull();
    expect(wb.get("Electrical", "B10")).toBe(30);
    expect(report.warnings.some((w) => /B10 design ambient written as 30 °C/.test(w))).toBe(true);
    expect(wb.get("Electrical", "K18")).toBeTruthy(); // the sheet's auto conductor resolves — it is blank while B10 is
    expect(wb.get("Electrical", "B56")).toBeGreaterThan(0); // and the charger-run material prices
    // Charger runs: units 1–4 are the TP5 cabinets (Equipment line 1), units 5–6 the Level 2 duals (line 2) — rows 18–23.
    expect(dcRows).toHaveLength(4);
    dcRows.forEach((r, i) => {
      const row = 18 + i;
      expect(wb.formula("Electrical", `A${row}`)).toBeTruthy(); // the sheet names the charger itself
      expect(wb.get("Electrical", `F${row}`)).toBe(80 + 15 * i);
      // A DC cabinet on parallel sets: the set count travels; the conductor and conduit are the sheet's own (no typed override pins them).
      expect(wb.get("Electrical", `L${row}`)).toBeNull();
      expect(wb.get("Electrical", `M${row}`)).toBe(r.resolvedRunsPerUnit);
      expect(r.resolvedRunsPerUnit).toBeGreaterThan(1);
      expect(wb.get("Electrical", `R${row}`)).toBeNull();
      expect(wb.get("Electrical", `K${row}`)).toBeTruthy(); // the sheet sized it
      expect(wb.get("Electrical", `E${row}`)).toBeNull(); // its own circuit
    });
    // A dual Level 2 pedestal is one unit on two branches: one row, two sets, at the unit's distance.
    expect(l2Rows).toHaveLength(2);
    expect(wb.get("Electrical", "F22")).toBe(60);
    // A dual Level 2 pedestal is two 40 A circuits in the estimator but ONE 80 A circuit on the sheet — "sets" there means parallel conductors (NEC 310.10(G): not below 1/0), so neither the count nor the estimator's 8 AWG is written.
    expect(wb.get("Electrical", "M22")).toBeNull();
    expect(wb.get("Electrical", "L22")).toBeNull();
    expect(l2Rows[0].resolvedRunsPerUnit).toBe(2);
    expect(wb.get("Electrical", "F23")).toBe(75);
    expect(wb.get("Electrical", "F24")).toBeNull();
    expect(wb.formula("Electrical", "J22")).toBeTruthy(); // breaker is the sheet's own auto column
    expect(wb.formula("Electrical", "K22")).toBeTruthy(); // so is the auto conductor beside the override
    // Service and switchgear.
    expect(wb.get("Electrical", "B118")).toBe("Existing MSB");
    expect(wb.get("Electrical", "B127")).toBe(project.setup.serviceChain!.utilityToSwitchgearFt);
    expect(wb.get("Electrical", "B112")).toBe(3200); // the register's frame, written through the gear override
    expect(wb.get("Electrical", "B125")).toBe("Utility — EV infrastructure rule");
    // Rule 29 block.
    expect(wb.get("Electrical", "B155")).toBe("Added load to existing service");
    expect(wb.get("Electrical", "B156")).toBe("Underground");
    expect(wb.get("Electrical", "B157")).toBe(150);
    expect(wb.get("Electrical", "B161")).toBe(3500);
    expect(wb.get("Electrical", "B167")).toBe("Yes");
    // Distribution gear priced from the estimator's catalog — the sheet's B148 is the sum of column L, so this is how the CEO's Pricing tab gets the gear.
    expect(String(wb.get("Electrical", "A135"))).toMatch(/switchgear/i);
    expect(wb.get("Electrical", "J135")).toBe("Zero Impact Energy");
    expect(wb.get("Electrical", "K135")).toBe("Allowance"); // the 3,200 A frame is the estimator's Larson-based figure, not in the sheet's RefData
    expect(wb.get("Electrical", "L135")).toBe(62200);
    expect(wb.get("Electrical", "B148")).toBeCloseTo(base("Main Distribution Switchgear") + base("Electrical Sub-Panels, Transformers, Breakers"), 2);
    expect(String(wb.get("Electrical", "B149"))).toMatch(/^OK/);
    // Nothing landed where the 3.2.0 layout used to keep these.
    expect(wb.get("Electrical", "B5")).toBeNull();
    expect(wb.get("Electrical", "D12")).toBeNull();
    expect(wb.get("Electrical", "B48")).toBeNull(); // the blank row under the thirty charger runs
  });

  it("Construction tab: design and engineering as quantity × rate on rows 32–34, summing to the estimator's design total", () => {
    const f = project.financial;
    expect(f.autoCadDesignCost).toBeGreaterThan(0);
    expect(wb.get("Construction", "B32")).toBeCloseTo(f.autoCadDesignCost / 3412.5, 4);
    expect(wb.get("Construction", "D32")).toBe(3412.5);
    expect(wb.get("Construction", "B33")).toBeCloseTo(f.electricalEngDesignCost / 2080, 4);
    expect(wb.get("Construction", "D33")).toBe(2080);
    expect(wb.get("Construction", "B34")).toBeNull(); // no PM hours typed
    expect(wb.get("Construction", "D34")).toBe(358);
    // The sheet's own total (B35 = SUMPRODUCT of B × D) reproduces the estimator's design and engineering line.
    expect(wb.get("Construction", "B35")).toBeCloseTo(result.costs.designAndEngineering, 0);
    expect(report.leftBlank.some((s) => /B32\/B33/.test(s))).toBe(false);
  });

  it("Construction tab: labour, site-works quantities, rentals, markups, pass-through fees", () => {
    expect(wb.get("Construction", "B5")).toBe(project.financial.laborBusinessDays);
    expect(wb.get("Construction", "B6")).toBe(2750);
    expect(wb.get("Construction", "B7")).toBe(0.1);
    expect(wb.get("Construction", "B8")).toBe(0.2);
    expect(wb.get("Construction", "B10")).toBe(0.15);
    expect(wb.get("Construction", "B21")).toBe(project.peripherals.bollardsQty);
    expect(wb.get("Construction", "E21")).toBe("Y");
    expect(wb.get("Construction", "B19")).toBe((project.peripherals.adaVanQty ?? 0) + (project.peripherals.adaStdQty ?? 0) + (project.peripherals.adaAmbQty ?? 0));
    expect(wb.get("Construction", "B20")).toBe(1);
    expect(wb.get("Construction", "B27")).toBe(1); // dump lot
    const fencing = result.equipment.items.find((i) => i.name === "Temporary fencing")!;
    expect(wb.get("Construction", "B39")).toBe(fencing.qty);
    expect(wb.get("Construction", "D39")).toBe(fencing.durationValue); // weeks, with F saying so (3.8.0) — no more ×7 into days
    expect(wb.get("Construction", "B40")).toBe(1); // mini excavator on a trench job
    expect(wb.get("Construction", "E40")).toBe("Y");
    // 3.8.0: the rate travels in its own unit with F saying which — a monthly excavator stays monthly, fencing per ft per week stays weekly.
    const excavator = project.equipment.find((e) => e.name === "Mini excavator")!;
    expect(wb.get("Construction", "C40")).toBe(excavator.rate);
    expect(wb.get("Construction", "D40")).toBe(excavator.durationValue);
    expect(wb.get("Construction", "F40")).toBe("month");
    const fence = project.equipment.find((e) => e.name === "Temporary fencing")!;
    expect(fence.rateBasis).toBe("per ft per week");
    expect(wb.get("Construction", "C39")).toBe(fence.rate);
    expect(wb.get("Construction", "D39")).toBe(fence.durationValue);
    expect(wb.get("Construction", "F39")).toBe("week");
    expect(wb.get("Construction", "F42")).toBe("day"); // forklift, per day
    expect(wb.get("Construction", "B72")).toBe(0.2);
    expect(wb.get("Construction", "B81")).toBe(1);
    expect(wb.get("Construction", "D81")).toBeCloseTo(project.peripherals.permitFeeTotal + project.financial.planCheckPermitFee, 2);
    expect(wb.get("Construction", "D82")).toBe(project.peripherals.utilityAppFee);
    expect(wb.get("Construction", "B83")).toBe(1);
    expect(wb.formula("Construction", "D83")).toBe("Electrical!$B$161"); // the template's own link, untouched
    expect(wb.get("Construction", "B84")).toBe(0);
  });

  it("Commercial, Revenue, Carbon and Deal_Structure tabs", () => {
    expect(wb.get("Commercial", "B5")).toBe(0.15);
    expect(wb.get("Commercial", "B9")).toBe(0.0725);
    expect(wb.get("Commercial", "B12")).toBe(5);
    expect(wb.get("Commercial", "B14")).toBe(39.99);
    expect(wb.get("Commercial", "B19")).toBe("Yes");
    expect(wb.get("Commercial", "B20")).toBe("De Lage Landen");
    expect(wb.get("Commercial", "B21")).toBe(0.0839);
    expect(wb.get("Revenue", "B5")).toBe(0.65);
    expect(wb.get("Revenue", "B9")).toBe("No");
    expect(wb.get("Revenue", "B13")).toBe(0.2);
    expect(wb.get("Revenue", "B36")).toBe("TOU-EV-9");
    expect(wb.get("Revenue", "B38")).toBeNull(); // flat manual tariff → no TOU split
    expect(wb.get("Revenue", "B45")).toBe("California");
    expect(wb.get("Revenue", "B51")).toBe("Ramped to projected demand");
    expect(wb.get("Revenue", "B54")).toBe("Yes");
    expect(wb.get("Revenue", "B59")).toBe("Historical actuals — replacement site");
    expect(wb.get("Revenue", "B25")).toBe(3);
    expect(wb.get("Revenue", "B26")).toBeCloseTo(31500 / (3 * (365 / 12)), 1);
    expect(wb.get("Revenue", "B82")).toBe("SCE TOU-EV rate fact sheet, July 2025");
    expect(wb.get("Revenue", "B91")).toBe(0.28);
    expect(wb.get("Revenue", "B92")).toBe(701.42);
    // The formula cell stays a formula AND now carries its computed value:
    // Excel recalculates on open, every other reader reads the cached value.
    expect(wb.formula("Revenue", "B12")).toBe("Project!B22");
    expect(wb.get("Revenue", "B12")).toBe(wb.get("Project", "B22"));
    expect(wb.get("Carbon", "B9")).toBe(0.05);
    expect(wb.get("Carbon", "B10")).toBe(71.6667);
    expect(wb.get("Carbon", "B18")).toBeCloseTo(proposal.model.usage.l2.kwhPerDay, 0);
    expect(wb.get("Deal_Structure", "B9")).toBe("Carbon share test");
    expect(wb.get("Deal_Structure", "B10")).toBe(0.5);
    expect(wb.get("Deal_Structure", "B19")).toBe(100000);
    expect(wb.get("Deal_Structure", "B30")).toBe("We provide");
    expect(wb.get("Deal_Structure", "B34")).toBe("By others");
    expect(wb.get("Deal_Structure", "B41")).toBe("Whole project");
  });

  it("Existing tab: the replacement site travels", () => {
    expect(wb.get("Existing", "B5")).toBe("Rip and replace — reuse infrastructure");
    expect(wb.get("Existing", "B6")).toBe(7);
    expect(wb.get("Existing", "B13")).toBe("RETAIN"); // service
    expect(wb.get("Existing", "B15")).toBe("REPLACE"); // switchgear
    expect(wb.get("Existing", "A33")).toBe("ABB Terra 54");
    expect(wb.get("Existing", "E33")).toBe(2);
    expect(wb.get("Existing", "A67")).toBe("2025-09");
    expect(wb.get("Existing", "B69")).toBe(11000);
    expect(wb.get("Existing", "C150")).toBe(0.85);
  });

  it("Overrides tab: blank by default — the register travels only when the handoff asks for it", async () => {
    expect(wb.get("Overrides", "B9")).toBeNull();
    expect(wb.get("Overrides", "B10")).toBeNull();
    expect(wb.get("Overrides", "B16")).toBeNull();
    // Since 2026-09-21 even the register's own entries stay in the app unless the handoff asks for them — an override on the sheet is a deliberate act.
    expect(wb.get("Overrides", "B19")).toBeNull();
    expect(wb.get("Overrides", "B22")).toBeNull();
    expect(report.overrides).toEqual([]);
    expect(report.leftBlank.some((s) => /Overrides register — 2 entries on the app's Overrides tab stay in the app/.test(s))).toBe(true);
    const withRegister = await fillIntakeWorkbook(template, project, result, proposal, { today: "2026-09-02", writeRegister: true });
    const wbReg = await readWorkbook(withRegister.bytes);
    expect(wbReg.get("Overrides", "B19")).toBe(3200); // typed on the app's register
    expect(wbReg.get("Overrides", "B22")).toBe(1400);
    expect(withRegister.report.overrides.map((o) => o.row)).toEqual([19, 22]);
    expect(String(wb.get("Version", "B14"))).not.toMatch(/Overrides tab/);
  });

  it("Overrides tab carries the estimator's construction figures with reasons when asked, and the register's own entries win their rows", async () => {
    const carried = await fillIntakeWorkbook(template, project, result, proposal, { today: "2026-09-02", carryOverrides: true });
    const wb = await readWorkbook(carried.bytes);
    const report = carried.report;
    expect(String(wb.get("Version", "B14"))).toMatch(/see the Overrides tab/);
    expect(wb.get("Overrides", "B9")).toBeCloseTo(base("Wires, Conduits & Electrical Peripherals"), 2);
    expect(String(wb.get("Overrides", "D9"))).toMatch(/^RFC Estimator take-off/);
    expect(wb.get("Overrides", "B10")).toBeCloseTo(base("Main Distribution Switchgear") + base("Electrical Sub-Panels, Transformers, Breakers"), 2);
    expect(wb.get("Overrides", "B11")).toBeCloseTo(base("Striping, Bollards, Signage") + base("Asphalt and Paving") + base("Concrete Improvements") + base("ADA"), 2);
    expect(wb.get("Overrides", "B12")).toBeCloseTo(base("Dump / Waste"), 2);
    expect(wb.get("Overrides", "B13")).toBeCloseTo(base("Permits") + project.financial.planCheckPermitFee, 2);
    expect(wb.get("Overrides", "B14")).toBeCloseTo(base("Utility"), 2);
    expect(wb.get("Overrides", "B15")).toBeCloseTo(base("Construction Equipment"), 2);
    expect(wb.get("Overrides", "B16")).toBeCloseTo(result.costs.designAndEngineering, 2);
    expect(wb.get("Overrides", "B17")).toBeNull(); // no line-extension contribution
    expect(wb.get("Overrides", "B19")).toBe(3200);
    expect(wb.get("Overrides", "D19")).toBe("Engineer's single line — SLD rev 2");
    expect(wb.get("Overrides", "B22")).toBe(1400);
    expect(wb.get("Overrides", "B26")).toBeNull();
    expect(report.overrides.map((o) => o.row)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 19, 20, 22]);
    expect(report.overrides.find((o) => o.row === 19)!.source).toBe("register");
  });

  it("round trip: importing the filled intake gives the same equipment, distances, terms and carried figures back", () => {
    const back = projectFromIntake(wb, { ...defaultProject(), commercial: defaultCommercial() });
    const p = back.project;
    expect(p.quick!.lines).toEqual([
      { loadTypeId: "DCFC 360kW Dual", count: 4, sku: "TP5-360-480-2-300" },
      { loadTypeId: "L2 Dual 40A", count: 2, sku: "CTX-C40-240-2" },
    ]);
    expect(p.quick!.firstRunFtDcfc).toBe(80);
    expect(p.quick!.stepFt).toBe(15);
    expect(p.quick!.firstRunFtL2).toBe(60);
    expect(p.setup.clientName).toBe("Best Western Hawthorne");
    expect(p.setup.siteAddress).toBe("15000 Hawthorn Blvd, Hawthorne, CA 90260");
    expect(p.setup.utility).toBe("SCE — Southern California Edison");
    expect(p.setup.serviceChain?.utilityToSwitchgearFt).toBe(0); // the utility provides the run
    expect(p.intake!.contactName).toBe("Mohammad Noorali");
    expect(p.intake!.rateSchedule).toBe("TOU-EV-9");
    expect(p.intake!.interconnection?.serviceType).toBe("Added load to existing service");
    expect(p.financial.laborBusinessDays).toBe(project.financial.laborBusinessDays);
    expect(p.commercial!.discountHardwarePct).toBe(0.15);
    expect(p.commercial!.utilityInterconnectFee).toBe(3500);
    expect(p.commercial!.scope.design).toBe("others");
    expect(p.commercial!.tariff!.basis).toBe("manual");
    expect(p.commercial!.tariff!.manual.peakPerKwh).toBe(0.28);
    expect(p.commercial!.deal!.name).toBe("Carbon share test");
    expect(p.commercial!.deal!.capitalContribution).toBe(100000);
    expect(p.existing!.projectType).toBe("replace");
    expect(p.existing!.history).toHaveLength(3);
    expect(p.existing!.revenueBasis).toBe("historical");
    // Nothing came back through the register — it was not written (default) — so the app's Overrides tab of the re-import is empty.
    const keys = (p.overrides ?? []).map((o) => o.key);
    expect(keys).toEqual([]);
    // With nothing carried in the register, the re-imported estimate is the estimator's own re-derivation from the
    // intake's inputs (typed distances, conductors and quantities) — the frame override still lands.
    const again = computeEstimate(p);
    expect(again.panel.bus480?.suggestedBusA).toBe(3200);
    expect(again.costs.totalCost).toBeGreaterThan(0);
  });

  it("refuses a template the cell map was not written for", async () => {
    const doctored = await patchWorkbook(template, [{ sheet: "Version", ref: "B4", value: "3.3.0" }]);
    await expect(fillIntakeWorkbook(doctored.bytes, project, result, proposal)).rejects.toThrow(/does not match the app's cell map for 3\.8\.0/);
    expect(() => verifyIntakeTemplate({ sheetNames: [], has: () => false, get: () => null, formula: () => undefined, cells: () => new Map() })).toThrow();
  });

  it("plan helpers and vocabularies", () => {
    expect(splitAddress("15000 Hawthorn Blvd, Hawthorne, CA 90260")).toEqual(["15000 Hawthorn Blvd", "Hawthorne, CA 90260"]);
    expect(splitAddress("Main St")).toEqual(["Main St", ""]);
    expect(capacityForLoadType("DCFC 360kW Dual")).toBe("360 kW DC");
    expect(capacityForLoadType("L2 Dual 40A")).toBe("Level 2 AC");
    expect(capacityForLoadType("Power cabinet 480kW")).toBe("Distributed system");
    expect(capacityForLoadType("DCFC 200kW Dual")).toBeUndefined();
    expect(conductorToIntake("1/0 AWG")).toBe("1 /0");
    expect(conductorToIntake("250 kcmil")).toBe("250 KCMIL");
    expect(conductorToIntake("8 AWG")).toBe("8 AWG");
    expect(conductorFromIntake("1 /0")).toBe("1/0 AWG");
    expect(conductorFromIntake("300 KCMIL")).toBe("300 kcmil");
    expect(tradeSizeInches('1-1/4"')).toBe(1.25);
    expect(tradeSizeInches('(3  1/2")')).toBe(3.5);
    expect(conduitToIntake('1-1/4"')).toBe('(1 1/4")');
    expect(conduitToIntake('3"')).toBe('(3") ');
    expect(conduitToIntake('2-1/2"')).toBe('(2 1/2")');
    expect(intakeFileName(project)).toBe("best-western-hawthorne-evse-intake-3.8.0-rev-b.xlsx");
    const plan = planIntakeFill(project, result, proposal, { today: "2026-09-02", carryOverrides: false, writeRegister: true });
    expect(plan.overrides.map((o) => o.row)).toEqual([19, 22]);
    expect(plan.leftBlank.some((w) => /NOT carried/.test(w))).toBe(true);
    expect(plan.warnings.some((w) => /NOT carried/.test(w))).toBe(false);
  });
});

describe("filling the intake for an add-load site (3.6.0 project type)", async () => {
  // The Best Western equipment on a site with no chargers today: a 1,200 A
  // 480 V service and board that carry the new load, 320 kW measured peak.
  const project = bwProject();
  project.existing = {
    ...defaultExisting(),
    projectType: "addLoad",
    register: { ...defaultExisting().register, service: "RETAIN", feeder: "RETAIN", switchgear: "RETAIN" },
    infrastructure: { ...defaultExisting().infrastructure, serviceA: 1200, voltage: 480, frameA: 1200, rateSchedule: "TOU-GS-2" },
    capacity: { peakDemandKw: 320, gearSpaceForFeeder: "Yes", utilityNotified: "Yes" },
    // Charger-section data that must NOT travel on an add-load site.
    units: [{ makeModel: "ghost", kw: 50, ports: 2, connectors: "CCS1", qty: 1, yearInstalled: "2018", working: "Working" }],
    history: [{ ...emptyMonth("2025-09"), kwh: 1000 }],
    revenueBasis: "historical",
  };
  project.intake = { ...project.intake!, existingServiceA: 1200, interconnection: { ...project.intake!.interconnection!, serviceType: "Added load to existing service", serviceFeederBy: "Existing — retained", pointOfConnection: "Existing MSB" } };
  project.peripherals = { ...project.peripherals, existingSwitchgear: true };
  project.setup = { ...project.setup, serviceChain: { ...project.setup.serviceChain!, utilityToSwitchgearFt: 0 } };
  const result = computeEstimate(project);
  const proposal = computeProposal(project, result)!;
  const { bytes, report } = await fillIntakeWorkbook(readFileSync(TEMPLATE), project, result, proposal, { today: "2026-09-14" });
  const wb = await readWorkbook(bytes);

  it("writes the project type, the three register rows, section D and section I — and leaves the charger sections blank", () => {
    expect(report.refused).toEqual([]);
    expect(wb.get("Existing", "B5")).toBe("Greenfield — add load to existing service");
    expect(wb.get("Existing", "B13")).toBe("RETAIN");
    expect(wb.get("Existing", "B14")).toBe("RETAIN");
    expect(wb.get("Existing", "B15")).toBe("RETAIN");
    expect(wb.get("Existing", "B16")).toBeNull(); // branch conductors — not applicable, left blank
    expect(wb.get("Existing", "B50")).toBe(1200);
    expect(wb.get("Existing", "B53")).toBe(1200);
    expect(wb.get("Existing", "B192")).toBe(320);
    expect(wb.get("Existing", "B196")).toBe("Yes");
    expect(wb.get("Existing", "B197")).toBe("Yes");
    expect(wb.get("Existing", "A33")).toBeNull(); // no existing units
    expect(wb.get("Existing", "A67")).toBeNull(); // no history
    expect(wb.get("Existing", "B131")).toBeNull(); // no connector uplift
    expect(wb.get("Existing", "B174")).toBeNull(); // no removal scope
    expect(wb.get("Revenue", "B59")).toBe("Market benchmark — greenfield");
    expect(wb.get("Electrical", "B125")).toBe("Existing — retained");
    expect(wb.get("Electrical", "B155")).toBe("Added load to existing service");
    expect(wb.get("Electrical", "B118")).toBe("Existing MSB");
    expect(wb.get("Project", "B28")).toBe(1200); // Existing!B200 wants the Project tab's service size to agree
  });

  it("imports back as an add-load site with the capacity inputs, the retained feeder out of scope", () => {
    const back = projectFromIntake(wb, { ...defaultProject(), commercial: defaultCommercial() });
    const x = back.project.existing!;
    expect(x.projectType).toBe("addLoad");
    expect(x.register).toMatchObject({ service: "RETAIN", feeder: "RETAIN", switchgear: "RETAIN" });
    expect(x.infrastructure).toMatchObject({ serviceA: 1200, voltage: 480, frameA: 1200 });
    expect(x.capacity).toEqual({ peakDemandKw: 320, gearSpaceForFeeder: "Yes", utilityNotified: "Yes" });
    expect(x.units).toEqual([]);
    expect(x.history).toEqual([]);
    expect(back.project.setup.serviceChain?.utilityToSwitchgearFt).toBe(0);
    expect(back.project.intake!.interconnection?.serviceFeederBy).toBe("Existing — retained");
    expect(back.report.mapped.some((m) => /^Existing site: add load to the existing service — 1200 A service, 320 kW measured peak/.test(m))).toBe(true);
    expect(back.report.mapped.some((m) => /Service feeder retained/.test(m))).toBe(true);
    expect(back.project.peripherals.demolitionItems).toBeUndefined();
  });
});

describe("custom rental lines and the intake's 14 fixed rental rows", async () => {
  const project = bwProject();
  project.equipment = [
    ...project.equipment,
    { name: "Generator rental", qty: 1, rate: 220, rateBasis: "per day", durationValue: 3, delivery: 0 },
    { name: "Scissor lift 26 ft", qty: 2, rate: 310, rateBasis: "per day", durationValue: 5, delivery: 0 },
  ];
  const result = computeEstimate(project);
  const proposal = computeProposal(project, result)!;
  const { bytes, report } = await fillIntakeWorkbook(readFileSync(TEMPLATE), project, result, proposal, { today: "2026-09-18" });
  const wb = await readWorkbook(bytes);

  it("a line named after one of the intake's rows lands on that row; any other name is reported as not on the sheet", () => {
    expect(wb.get("Construction", "A50")).toBe("Generator rental"); // the template's own locked label
    expect(wb.get("Construction", "B50")).toBe(1);
    expect(wb.get("Construction", "C50")).toBe(220);
    expect(wb.get("Construction", "D50")).toBe(3);
    expect(wb.get("Construction", "E50")).toBe("Y");
    expect(wb.get("Construction", "F50")).toBe("day");
    expect(report.warnings.some((w) => /NOT on the intake: Scissor lift 26 ft/.test(w))).toBe(true);
    expect(report.warnings.some((w) => /override row 15/.test(w))).toBe(false); // nothing goes to Overrides by default
  });
});

// Intake block I (3.7.0; rows 212–223 since 3.8.0) — the distribution feeders between the items on the
// schedule. The sheet prices this block into the Pricing tab's wire line, so
// the estimator's feeder segments must land here: the chain's guessed pair
// on a project built in the app, the engineer's typed rows on an import.
describe("block I — distribution feeders (intake 3.8.0 rows 212–223)", async () => {
  const FIXTURE = join(__dirname, "..", "__fixtures__", "intake-sample-3.8.0.xlsx");
  const template = readFileSync(TEMPLATE);

  it("writes the chain's switchgear → transformer → sub-panel pair against the names block E used, at the estimator's floor and conductor", async () => {
    const project = bwProject();
    const result = computeEstimate(project);
    const proposal = computeProposal(project, result)!;
    const { bytes } = await fillIntakeWorkbook(template, project, result, proposal, { today: "2026-09-02" });
    const wb = await readWorkbook(bytes);
    const scheduleRow = (type: string) => {
      for (let r = 135; r <= 146; r++) if (wb.get("Electrical", `B${r}`) === type) return String(wb.get("Electrical", `A${r}`));
      throw new Error(`no ${type} on the schedule`);
    };
    const tx = result.rows.find((r) => r.synthetic && r.loadTypeId === "FDR Switchgear→TX")!;
    const sp = result.rows.find((r) => r.synthetic && r.loadTypeId === "FDR TX→Sub-panel")!;
    expect(tx).toBeDefined();
    expect(wb.get("Electrical", "B212")).toBe(wb.get("Electrical", "A135")); // the switchboard
    expect(wb.get("Electrical", "C212")).toBe(scheduleRow("Transformer"));
    expect(wb.get("Electrical", "H212")).toBe(15);
    expect(wb.get("Electrical", "G212")).toBe(Math.ceil(tx.designAmps * project.setup.continuousLoadFactor)); // a transformer's schedule rating is kVA — the floor must be typed
    expect(wb.get("Electrical", "I212")).toBe(tx.resolvedRunsPerUnit);
    expect(wb.get("Electrical", "K212")).toBe(snapConductorToIntake(tx.selectedWire).size);
    expect(wb.get("Electrical", "P212")).toBeNull(); // the sheet sizes its own conduit
    expect(wb.get("Electrical", "B213")).toBe(scheduleRow("Transformer"));
    expect(wb.get("Electrical", "C213")).toBe(scheduleRow("Subpanel"));
    expect(wb.get("Electrical", "H213")).toBe(15);
    expect(wb.get("Electrical", "G213")).toBeNull(); // the secondary feeder's floor is the panel it lands in — the sheet's own default (NEC 240.21(C))
    expect(sp.designAmps).toBeCloseTo(sp.ocpdA / project.setup.continuousLoadFactor, 6); // and the estimator sized it to that panel's main, not the transformer's full secondary FLA
    expect(wb.get("Electrical", "B214")).toBeNull();
    expect(wb.get("Electrical", "B225")).toBe(2);
    // The sheet resolves both rows against the schedule: volts, phases, and the floor in force.
    expect(wb.get("Electrical", "D212")).toBe(480);
    expect(wb.get("Electrical", "S212")).toBe(wb.get("Electrical", "G212"));
    expect(wb.get("Electrical", "D213")).toBe(208);
  });

  it("carries an imported workbook's typed feeders back as typed, sized OK on the sheet, and prices them into the wire line", async () => {
    const base = { ...defaultProject(), commercial: defaultCommercial() };
    const imported = projectFromIntake(await readWorkbook(readFileSync(FIXTURE)), base);
    const project = imported.project;
    const result = computeEstimate(project);
    const proposal = computeProposal(project, result)!;
    const { bytes, report } = await fillIntakeWorkbook(template, project, result, proposal, { today: "2026-09-18" });
    const wb = await readWorkbook(bytes);
    // Row 1 as typed (FROM, TO, distance; no floor) plus the engine's sets and conductor as overrides.
    expect(wb.get("Electrical", "B212")).toBe("Existing MSB");
    expect(wb.get("Electrical", "C212")).toBe("EV distribution panel");
    expect(wb.get("Electrical", "H212")).toBe(60);
    expect(wb.get("Electrical", "G212")).toBeNull();
    const fdr = result.rows.filter((r) => r.synthetic && r.loadTypeId.startsWith("FDR"));
    expect(wb.get("Electrical", "I212")).toBe(fdr[0].resolvedRunsPerUnit);
    expect(wb.get("Electrical", "K212")).toBe(snapConductorToIntake(fdr[0].selectedWire).size);
    // Row 2: the typed sets and conductor win.
    expect(wb.get("Electrical", "B213")).toBe("EV distribution panel");
    expect(wb.get("Electrical", "C213")).toBe("EVSE disconnects");
    expect(wb.get("Electrical", "H213")).toBe(25);
    expect(wb.get("Electrical", "I213")).toBe(2);
    expect(wb.get("Electrical", "K213")).toBe("350 KCMIL");
    expect(wb.get("Electrical", "B214")).toBeNull();
    // The sheet, recalculated: both feeders resolve, size OK at the 40 °C design ambient, and cost money that reaches the Pricing tab.
    expect(wb.get("Electrical", "F212")).toBe(400);
    expect(wb.get("Electrical", "F213")).toBe(600);
    expect(String(wb.get("Electrical", "R212"))).toMatch(/^OK/);
    expect(String(wb.get("Electrical", "R213"))).toMatch(/^OK/);
    expect(String(wb.get("Electrical", "B228"))).toMatch(/^OK/);
    const feederMaterial = wb.get("Electrical", "B226") as number;
    expect(feederMaterial).toBeGreaterThan(0);
    expect(wb.get("Pricing", "B10")).toBeCloseTo(((wb.get("Electrical", "B56") as number) + (wb.get("Electrical", "B98") as number) + feederMaterial) * 1.2, 4); // charger-run + dispenser-run + feeder material, at the 3.8.0 rows
    // The chain follows the sheet's one material, so nothing to warn about.
    expect(report.warnings.filter((w) => /Block I prices its feeders/.test(w))).toEqual([]);
    // Round trip: the filled file imports to the same feeders (row 1 now carrying the engine's sets and conductor as typed), and fills identically.
    const back = projectFromIntake(wb, base).project;
    expect(back.setup.serviceChain!.feeders).toHaveLength(2);
    expect(back.setup.serviceChain!.feeders![1]).toEqual(project.setup.serviceChain!.feeders![1]);
    expect(back.setup.serviceChain!.feeders![0]).toEqual({ ...project.setup.serviceChain!.feeders![0], sets: fdr[0].resolvedRunsPerUnit, conductorOverride: conductorFromIntake(String(wb.get("Electrical", "K212"))) });
    const again = computeEstimate(back);
    const { bytes: bytes2 } = await fillIntakeWorkbook(template, back, again, computeProposal(back, again)!, { today: "2026-09-18" });
    const wb2 = await readWorkbook(bytes2);
    for (const c of ["B212", "C212", "G212", "H212", "I212", "K212", "B213", "C213", "H213", "I213", "K213", "B214", "B226"]) expect(wb2.get("Electrical", c)).toEqual(wb.get("Electrical", c));
  });

  it("when the chain's material differs from the site material, leaves the conductor to the sheet and says why the two sides price differently", async () => {
    const project = bwProject();
    project.setup = { ...project.setup, feederMaterial: "Cu", serviceChain: { ...project.setup.serviceChain!, material: "Al" } };
    const result = computeEstimate(project);
    const proposal = computeProposal(project, result)!;
    const plan = planIntakeFill(project, result, proposal, { today: "2026-09-02" });
    expect(plan.warnings.some((w) => /Block I prices its feeders in the site material \(Electrical B6 = Cu\); the estimator's feeder segments are Al/.test(w))).toBe(true);
    const { bytes } = await fillIntakeWorkbook(template, project, result, proposal, { today: "2026-09-02" });
    const wb = await readWorkbook(bytes);
    expect(wb.get("Electrical", "H212")).toBe(15); // the feeder is still scheduled…
    expect(wb.get("Electrical", "G212")).toBeGreaterThan(0); // …at the estimator's floor…
    expect(wb.get("Electrical", "K212")).toBeNull(); // …but an aluminium size would be misread as copper, so the sheet sizes its own
    expect(wb.get("Electrical", "K213")).toBeNull();
  });
});
