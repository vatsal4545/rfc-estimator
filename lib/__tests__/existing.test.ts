import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../calc/autoplan";
import { defaultProject } from "../calc/defaults";
import { computeEstimate } from "../calc/engine";
import {
  DEFAULT_REMOVAL_RATES,
  RETAIN_ELEMENTS,
  applyRemovalScope,
  computeExisting,
  defaultExisting,
  emptyMonth,
  projectTypeFromText,
  removalItems,
  type ExistingContext,
  type ExistingInput,
} from "../existing";
import { defaultCommercial } from "../proposal/defaults";
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
    // 1,468.8 kW at 480 V × 125% = 2,208 A against an 800 A service.
    expect(r.checks.serviceCarriesLoad).toMatch(/^UNDERSIZED — 2,208 A/);
    expect(r.checks.switchgearCarriesLoad).toMatch(/^UNDERSIZED/);
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
    expect(projectTypeFromText("Rip and replace — reuse infrastructure")).toBe("replace");
    expect(projectTypeFromText("Replace and expand — reuse plus new capacity")).toBe("expand");
    expect(projectTypeFromText("")).toBe("greenfield");
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
    expect(est.costs.totalCost).toBeCloseTo(plain.costs.totalCost + 5665 * 1.1 * (1 + before.financial.salesTaxPct), 4);
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
