import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../calc/autoplan";
import { defaultProject } from "../calc/defaults";
import { computeEstimate } from "../calc/engine";
import {
  DEFAULT_REMOVAL_RATES,
  RETAIN_ELEMENTS,
  applyProjectType,
  applyRemovalScope,
  computeExisting,
  defaultExisting,
  emptyMonth,
  projectTypeFromText,
  removalItems,
  type ExistingContext,
  type ExistingInput,
} from "../existing";
import { defaultInterconnection } from "../interconnection";
import { defaultCommercial, defaultIntake as defaultCommercialIntake } from "../proposal/defaults";
import { computeProposal } from "../proposal";

const KWH = [9800, 10200, 9900, 11500, 12000, 11800, 12500, 13100, 12800, 13400, 13900, 14100];
const PORTS = [4, 4, 3, 3, 3, 4, 3, 3, 3, 4, 4, 4];

/** A failing 2018 installation (2 × 50 kW dual + 2 × 62.5 kW single = 6 ports, 225 kW) replaced by 4 × 360 kW dual + 2 L2 dual. */
function replacement(): ExistingInput {
  const x = defaultExisting();
  x.projectType = "replace";
  RETAIN_ELEMENTS.forEach((e, i) => {
    x.register[e.key] = ["RETAIN", "RETAIN", "REPLACE", "RETAIN", "RETAIN", "REPLACE", "REPLACE", "REPLACE", "PARTIAL", "RETAIN", "REPLACE", "REPLACE"][i] as ExistingInput["register"][typeof e.key];
  });
  x.units = [
    { makeModel: "ABB Terra 54", kw: 50, ports: 2, connectors: "CCS1 / CHAdeMO", qty: 2, yearInstalled: "2018", working: "Working" },
    { makeModel: "ChargePoint Express 250", kw: 62.5, ports: 1, connectors: "CCS1", qty: 2, yearInstalled: "2019", working: "Failed" },
  ];
  x.infrastructure = { ...x.infrastructure, serviceA: 800, voltage: 480, spareA: 200, frameA: 800 };
  x.history = KWH.map((k, i) => ({ ...emptyMonth(`2025-${String(9 + i).padStart(2, "0")}`), kwh: k, revenue: k * 0.55, sessions: Math.round(k / 32), utilityCost: k * 0.28, portsWorking: PORTS[i] }));
  x.connectors = {
    nacs: { onExisting: false, onNew: true, fleetShare: 0.55 },
    ccs1: { onExisting: true, onNew: true, fleetShare: 0.4 },
    chademo: { onExisting: true, onNew: false, fleetShare: 0.03 },
    j1772: { onExisting: false, onNew: true, fleetShare: 0.02 },
  };
  x.removal = { cabinets: 4, pads: 4, bollards: 8, signs: 4, disposalLoads: 2, recycling: "Yes", hazmat: "No", temporaryCharging: "No", protectionDays: 5 };
  x.revenueBasis = "historical";
  return x;
}

const ctx: ExistingContext = { newPorts: 12, newDcPositions: 8, newDcKw: 1440, newConnectedKw: 1468.8, serviceVoltage: 480, benchmarkUtilisation: 0.231, benchmarkState: "California" };

describe("existing installation — rip and replace", () => {
  const r = computeExisting(replacement(), ctx);

  it("reads the register into scope profiles", () => {
    expect(r.register.retained).toBe(5);
    expect(r.register.replaced).toBe(7);
    expect(r.register.scopeProfile).toBe("Infrastructure reuse — no new service, no new feeder");
    expect(r.register.electricalProfile).toMatch(/^CHARGER SWAP/); // service, branch conductors and conduit all retained
    expect(r.register.constructionProfile).toMatch(/^PAD-AND-CHARGER SWAP/);
  });

  it("sums the units coming out and tests the existing service against the new load", () => {
    expect(r.units.count).toBe(4);
    expect(r.units.ports).toBe(6);
    expect(r.units.connectedKw).toBe(225);
    expect(r.units.working).toBe(2);
    expect(r.units.failed).toBe(2);
    expect(r.units.powerPerPosition).toBeCloseTo(37.5, 9);
    // 1,468.8 kW at 480 V × 125% = 2,208 A. No measured demand, so the basis is
    // the 200 A of stated spare capacity plus the 271 A the 225 kW of removed
    // chargers give back — 471 A available (Existing!B195).
    expect(r.capacity.basis).toBe("Spare capacity stated for the gear");
    expect(r.capacity.newAmps125).toBeCloseTo(2208, 0);
    expect(r.capacity.availableA).toBeCloseTo(200 + (225 * 1000) / (480 * Math.sqrt(3)), 6);
    expect(r.checks.serviceCarriesLoad).toMatch(/^UPGRADE NEEDED — 2,208 A required against 471 A available \(Spare capacity/);
    expect(r.checks.switchgearCarriesLoad).toMatch(/^UNDERSIZED — the 800 A frame does not cover the new load at 125% plus the 600 A already on it/);
    expect(r.capacity.verdict).toMatch(/^NOT YET — service: UPGRADE NEEDED/);
    expect(r.checks.loadChange).toBe("+1,244 kW (+553%) against the existing 225 kW");
    expect(r.checks.reuseFeasible).toMatch(/^NOT FEASIBLE/);
  });

  it("derives the historical run rate from the months that carry data", () => {
    expect(r.history.months).toBe(12);
    expect(r.history.totalKwh).toBe(145000);
    expect(r.history.kwhPerYear).toBeCloseTo(145000, 6);
    expect(r.history.kwhPerDay).toBeCloseTo(145000 / 365, 6);
    expect(r.history.impliedRetailPerKwh).toBeCloseTo(0.55, 9);
    expect(r.history.impliedDeliveredPerKwh).toBeCloseTo(0.28, 9);
    expect(r.history.revenuePerYear).toBeCloseTo(145000 * 0.55, 4);
    expect(r.history.netBeforeFees).toBeCloseTo(145000 * (0.55 - 0.28), 4);
    expect(r.history.avgPortsWorking).toBeCloseTo(3.5, 9);
    expect(r.history.availability).toBeCloseTo(3.5 / 6, 9);
    expect(r.history.kwhPerSession).toBeGreaterThan(30);
  });

  it("stacks four capped, captured uplifts into the projected baseline", () => {
    const by = Object.fromEntries(r.uplifts.map((u) => [u.key, u]));
    expect(by.availability.theoretical).toBeCloseTo(6 / 3.5, 9);
    expect(by.availability.applied).toBeCloseTo(1 + (6 / 3.5 - 1) * 0.85, 9);
    expect(by.ports.theoretical).toBe(2); // 12 new ports over 6
    expect(by.ports.applied).toBeCloseTo(1.4, 9);
    expect(r.coverage.existing).toBeCloseTo(0.43, 9);
    expect(r.coverage.afterReplacement).toBeCloseTo(0.97, 9);
    expect(by.connectors.theoretical).toBeCloseTo(0.97 / 0.43, 9);
    expect(by.power.theoretical).toBe(2); // 180 kW over 37.5 kW, capped at 2×
    expect(by.power.applied).toBeCloseTo(1.25, 9);
    const combined = by.availability.applied * by.ports.applied * by.connectors.applied * by.power.applied;
    expect(r.combinedUplift).toBeCloseTo(combined, 9);
    expect(r.combinedUplift).toBeCloseTo(4.5785, 3);
    expect(r.projectedKwhPerYear).toBeCloseTo(145000 * combined, 4);
    expect(r.capacityCheck).toMatch(/^OK — implies 7\.5%/);
    expect(r.projectionVsHistory).toMatch(/^4\.58× the historical run rate/);
    expect(r.market.shareOfBenchmark).toBeCloseTo(r.market.impliedUtilisation / 0.231, 9);
    expect(r.market.verdict).toMatch(/^OK/);
    expect(r.historicalUsable).toBe(true);
    expect(r.basisInForce).toMatch(/^HISTORICAL — 12 months of data/);
  });

  it("prices the removal scope and counts the indicative crew days", () => {
    const rates = DEFAULT_REMOVAL_RATES;
    expect(r.removal.lines).toHaveLength(6);
    expect(r.removal.total).toBeCloseTo(4 * rates.cabinet + 4 * rates.pad + 8 * rates.bollard + 4 * rates.sign + 2 * rates.disposalLoad + 5 * rates.protectionDay, 6);
    expect(r.removal.total).toBe(5665);
    expect(r.removal.crewDays).toBe(5); // 4 × 0.5 + 4 × 0.75
    expect(r.removal.phasedProgramme).toMatch(/^OK/);
    expect(r.removal.greenfieldError).toBeNull();
  });

  it("stands down on a greenfield project, and flags removal quantities entered on one", () => {
    const g = defaultExisting();
    g.removal.cabinets = 2;
    const gr = computeExisting(g, ctx);
    expect(gr.isReplacement).toBe(false);
    expect(gr.register.scopeProfile).toMatch(/^Greenfield/);
    expect(gr.checks.serviceCarriesLoad).toMatch(/^n\/a/);
    expect(gr.removal.lines).toHaveLength(0);
    expect(gr.removal.greenfieldError).toMatch(/GREENFIELD/);
    expect(removalItems(g)).toEqual([]);
    expect(removalItems(undefined)).toEqual([]);
  });

  it("market basis on a site with history, and historical basis without enough months, both say so", () => {
    const m = replacement();
    m.revenueBasis = "market";
    expect(computeExisting(m, ctx).basisInForce).toMatch(/throwing away your best evidence/);
    const short = replacement();
    short.history = short.history.slice(0, 6);
    const sr = computeExisting(short, ctx);
    expect(sr.historicalUsable).toBe(false);
    expect(sr.basisInForce).toMatch(/ONLY 6 MONTH/);
  });

  it("project type text from the intake's dropdown", () => {
    expect(projectTypeFromText("Greenfield — new service")).toBe("greenfield");
    expect(projectTypeFromText("Greenfield — add load to existing service")).toBe("addLoad");
    expect(projectTypeFromText("Rip and replace — reuse infrastructure")).toBe("replace");
    expect(projectTypeFromText("Replace and expand — reuse plus new capacity")).toBe("expand");
    expect(projectTypeFromText("")).toBe("greenfield");
  });
});

describe("existing site — greenfield, add load to existing service (intake 3.6.0 section I)", () => {
  /** A 1,200 A 480 V service and board, 320 kW measured peak, taking 300 kW of new chargers. */
  function addLoad(): ExistingInput {
    const x = defaultExisting();
    x.projectType = "addLoad";
    x.register.service = "RETAIN";
    x.register.feeder = "RETAIN";
    x.register.switchgear = "RETAIN";
    x.infrastructure = { ...x.infrastructure, serviceA: 1200, voltage: 480, spareA: null, frameA: 1200 };
    x.capacity = { peakDemandKw: 320, gearSpaceForFeeder: "Yes", utilityNotified: "Yes" };
    return x;
  }
  const small: ExistingContext = { ...ctx, newPorts: 4, newDcPositions: 4, newDcKw: 300, newConnectedKw: 300 };
  const amps125 = (kw: number) => ((kw * 1000) / (480 * Math.sqrt(3))) * 1.25;

  it("keeps a service but has no chargers: the register's service rows and section I apply, the charger sections stand down", () => {
    const r = computeExisting(addLoad(), small);
    expect(r.keepsService).toBe(true);
    expect(r.isReplacement).toBe(false);
    expect(r.register.scopeProfile).toMatch(/^Add load to existing service — no new service, no new feeder/);
    expect(r.register.electricalProfile).toMatch(/^EXISTING SERVICE — no new service and no service feeder/);
    expect(r.register.constructionProfile).toMatch(/^GREENFIELD SITE WORKS ON AN EXISTING SERVICE/);
    expect(r.checks.loadChange).toBe("n/a — no existing chargers; the added load is 300 kW on top of the building load");
    expect(r.removal.lines).toHaveLength(0);
    expect(r.removal.crewDays).toBe(0);
    expect(removalItems(addLoad())).toEqual([]);
    expect(r.historicalUsable).toBe(false);
  });

  it("measured peak demand (NEC 220.87) is the strongest basis: service size less the demand at 125%", () => {
    const r = computeExisting(addLoad(), small);
    expect(r.capacity.basis).toBe("NEC 220.87 — measured peak demand");
    expect(r.capacity.newAmps125).toBeCloseTo(amps125(300), 6);
    expect(r.capacity.demandAmps125).toBeCloseTo(amps125(320), 6);
    expect(r.capacity.availableA).toBeCloseTo(1200 - amps125(320), 6);
    expect(r.checks.serviceCarriesLoad).toMatch(/^OK — 719 A available against 451 A the new load needs at 125% \(NEC 220\.87/);
    // The frame must carry the existing demand plus the new load: 481 + 451 = 932 A on 1,200 A.
    expect(r.checks.switchgearCarriesLoad).toMatch(/^OK — the 1,200 A frame carries the existing demand plus the new load at 125% \(932 A\)/);
    expect(r.capacity.verdict).toBe("OK — the existing service and switchgear carry the added load");
    expect(r.capacity.notes).toEqual([]);
  });

  it("without measured demand it falls back to the stated spare capacity, then to the bare service size", () => {
    const spare = addLoad();
    spare.capacity!.peakDemandKw = null;
    spare.infrastructure.spareA = 500;
    let r = computeExisting(spare, small);
    expect(r.capacity.basis).toBe("Spare capacity stated for the gear");
    expect(r.capacity.availableA).toBe(500); // no removed chargers to give current back
    expect(r.checks.serviceCarriesLoad).toMatch(/^OK — 500 A available against 451 A/);
    // With spare capacity the frame must carry what is already on it (1,200 − 500 = 700 A) plus the new load.
    expect(r.checks.switchgearCarriesLoad).toMatch(/^OK — the 1,200 A frame is adequate for the new load on top of the load already on it/);
    spare.infrastructure.spareA = 400;
    r = computeExisting(spare, small);
    expect(r.checks.serviceCarriesLoad).toMatch(/^UPGRADE NEEDED — 451 A required against 400 A available/);
    expect(r.checks.reuseFeasible).toMatch(/^NOT FEASIBLE/);
    expect(r.capacity.verdict).toMatch(/^NOT YET — service: UPGRADE NEEDED/);
    const bare = addLoad();
    bare.capacity!.peakDemandKw = null;
    r = computeExisting(bare, small);
    expect(r.capacity.basis).toBe("Service size only — no existing-load data");
    expect(r.capacity.availableA).toBe(1200);
    expect(r.checks.switchgearCarriesLoad).toMatch(/^OK — the 1,200 A frame is adequate for the new load$/);
    const none = addLoad();
    none.capacity!.peakDemandKw = null;
    none.infrastructure.serviceA = null;
    r = computeExisting(none, small);
    expect(r.capacity.basis).toBe("no basis yet");
    expect(r.checks.serviceCarriesLoad).toBe("enter the existing service size, its spare capacity or its peak demand");
  });

  it("the gear-space and utility-notification answers surface as notes, and a body stored before 3.6.0 reads with defaults", () => {
    const x = addLoad();
    x.capacity = { peakDemandKw: 320, gearSpaceForFeeder: "No", utilityNotified: "No" };
    const r = computeExisting(x, small);
    expect(r.capacity.notes).toHaveLength(2);
    expect(r.capacity.notes[0]).toMatch(/section extension or a tap box/);
    delete (x as Partial<ExistingInput>).capacity;
    const legacy = computeExisting(x, small);
    expect(legacy.capacity.basis).toBe("Service size only — no existing-load data");
    expect(legacy.capacity.notes).toEqual(["Space on the existing gear for the new feeder not yet answered.", "Utility notification of the added load not yet answered."]);
  });

  it("applyProjectType fills in what an add-load site implies, only where blank", () => {
    const p = { ...defaultProject(), intake: { ...defaultCommercialIntake(), interconnection: { ...defaultInterconnection(), serviceType: "New service" as const } } };
    const next = applyProjectType(p, "addLoad");
    expect(next.existing!.projectType).toBe("addLoad");
    expect(next.existing!.register).toMatchObject({ service: "RETAIN", feeder: "RETAIN", switchgear: "RETAIN", pads: "" });
    expect(next.intake!.interconnection).toMatchObject({ serviceType: "New service", serviceFeederBy: "Existing — retained", pointOfConnection: "Existing MSB" });
    // Switching to a replacement leaves the register alone; back to greenfield too.
    const rep = applyProjectType(next, "replace");
    expect(rep.existing!.register.service).toBe("RETAIN");
    expect(applyProjectType(rep, "greenfield").existing!.projectType).toBe("greenfield");
  });
});

describe("removal scope reaches Total Cost and the historical basis reaches the model", () => {
  function bwProject() {
    const base = { ...defaultProject(), commercial: defaultCommercial() };
    const p = buildQuickProject(
      { ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 360kW Dual", count: 4, sku: "TP5-360-480-2-300" }, { loadTypeId: "L2 Dual 40A", count: 2, sku: "CTX-C40-240-2" }] },
      base,
      "x",
    );
    p.setup.utility = "PG&E — Pacific Gas and Electric";
    p.intake = { ...p.intake!, rateSchedule: "BEV-2-S", hoursOpen: 24 } as typeof p.intake;
    return p;
  }

  it("applyRemovalScope writes demolition items into Dump / Waste, and only there", () => {
    const before = bwProject();
    const plain = computeEstimate(before);
    const withExisting = applyRemovalScope({ ...before, existing: replacement() });
    expect(withExisting.peripherals.demolitionItems).toHaveLength(6);
    const est = computeEstimate(withExisting);
    const dump = (e: typeof est) => e.costs.lines.find((l) => l.name === "Dump / Waste")!;
    expect(dump(est).base).toBeCloseTo(dump(plain).base + 5665, 6);
    expect(est.peripherals.lines.demolition).toHaveLength(6);
    for (const l of est.costs.lines) if (l.name !== "Dump / Waste") expect(l.base).toBeCloseTo(plain.costs.lines.find((x) => x.name === l.name)!.base, 6);
    // Contingency only — construction is not sales-taxed.
    expect(est.costs.totalCost).toBeCloseTo(plain.costs.totalCost + 5665 * 1.1, 4);
    // Idempotent, and a greenfield section clears the items again.
    expect(applyRemovalScope(withExisting)).toBe(withExisting);
    const cleared = applyRemovalScope({ ...withExisting, existing: defaultExisting() });
    expect(cleared.peripherals.demolitionItems).toBeUndefined();
  });

  it("the business model switches to history × uplifts when the basis is historical with twelve months", () => {
    const p = { ...bwProject(), existing: replacement() };
    const m = computeProposal(p, computeEstimate(p))!.model;
    expect(m.context.historical?.months).toBe(12);
    expect(m.usage.basis).toBe("historical");
    expect(m.usage.siteKwhPerYear).toBeCloseTo(m.context.historical!.projectedKwhPerYear, 4);
    // Year 1 starts at the historical run rate and ramps the uplift in: run rate + 50% of the gap.
    const hist = m.context.historical!.kwhPerYear;
    const proj = m.context.historical!.projectedKwhPerYear;
    expect(m.usage.years[0].kwh).toBeCloseTo(hist + (proj - hist) * 0.5, 2);
    expect(m.usage.years[2].kwh).toBeCloseTo(proj, 2);
    expect(m.usage.years[3].kwh).toBeCloseTo(proj * 1.06, 2);
    expect(m.tariff.warnings.some((w) => /12 months of billing say \$0\.2800/.test(w))).toBe(true);
    // Market basis on the same project: the greenfield build-up.
    const market = { ...p, existing: { ...replacement(), revenueBasis: "market" as const } };
    const mm = computeProposal(market, computeEstimate(market))!.model;
    expect(mm.usage.basis).toBe("greenfield");
    expect(mm.usage.years[0].ramp).toBe(0.5);
  });
});
