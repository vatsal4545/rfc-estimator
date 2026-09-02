import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../calc/autoplan";
import { COST_LINE_NAMES, SITE_WORKS_LINES } from "../calc/costs";
import { defaultProject } from "../calc/defaults";
import { computeEstimate } from "../calc/engine";
import type { OverrideEntry, Project } from "../calc/types";
import { OVERRIDE_SPECS, activeOverrideCount, applyFieldOverrides, fieldOverrideDrift, modelOverridesOf, overrideSpec, setOverride } from "../overrides";
import { computeProposal } from "../proposal";
import { defaultCommercial } from "../proposal/defaults";

function project(overrides?: OverrideEntry[]): Project {
  const base = { ...defaultProject(), commercial: defaultCommercial() };
  const p = buildQuickProject({ ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 360kW Dual", count: 4, sku: "TP5-360-480-2-300" }, { loadTypeId: "L2 Dual 40A", count: 2, sku: "CTX-C40-240-2" }] }, base, "ov");
  p.setup.utility = "PG&E — Pacific Gas and Electric";
  p.intake = { ...p.intake!, rateSchedule: "BEV-2-S" } as typeof p.intake;
  p.overrides = overrides;
  return p;
}
const entry = (key: string, value: number, reason = "test"): OverrideEntry => ({ id: `ov-${key}`, key, value, reason });

describe("override register — engine class", () => {
  it("the catalogue covers every cost line plus the site-works, design, field and model keys", () => {
    for (const name of COST_LINE_NAMES) expect(overrideSpec(`line:${name}`)?.cls).toBe("engine");
    expect(overrideSpec("siteWorks")?.cls).toBe("engine");
    expect(overrideSpec("design")?.cls).toBe("engine");
    expect(overrideSpec("crewDays")?.cls).toBe("field");
    expect(overrideSpec("kwhPerDay")?.cls).toBe("model");
    expect(OVERRIDE_SPECS.length).toBe(COST_LINE_NAMES.length + 2 + 4 + 5);
  });

  it("no register → the estimate is byte-identical", () => {
    const a = computeEstimate(project());
    const b = computeEstimate(project([]));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a cost-line base override moves that line only, with contingency on the typed figure", () => {
    const plain = computeEstimate(project());
    const forced = computeEstimate(project([entry("line:Main Distribution Switchgear", 150000, "vendor quote")]));
    const line = (e: typeof plain, name: string) => e.costs.lines.find((l) => l.name === name)!;
    expect(line(forced, "Main Distribution Switchgear").base).toBe(150000);
    expect(line(forced, "Main Distribution Switchgear").contingency).toBeCloseTo(15000, 6);
    for (const name of COST_LINE_NAMES) if (name !== "Main Distribution Switchgear") expect(line(forced, name).base).toBeCloseTo(line(plain, name).base, 6);
    const delta = 150000 * 1.1 - line(plain, "Main Distribution Switchgear").finalCost;
    expect(forced.costs.totalCost).toBeCloseTo(plain.costs.totalCost + delta * (1 + 0.0725), 4);
  });

  it("the site-works figure rescales the four civil lines to the typed total", () => {
    const plain = computeEstimate(project());
    const forced = computeEstimate(project([entry("siteWorks", 60000)]));
    const civil = (e: typeof plain) => e.costs.lines.filter((l) => (SITE_WORKS_LINES as string[]).includes(l.name));
    expect(civil(forced).reduce((s, l) => s + l.base, 0)).toBeCloseTo(60000, 6);
    const plainTotal = civil(plain).reduce((s, l) => s + l.base, 0);
    for (const l of civil(forced)) expect(l.base / 60000).toBeCloseTo(civil(plain).find((x) => x.name === l.name)!.base / plainTotal, 9);
    expect(forced.costs.lines.find((l) => l.name === "Main Distribution Switchgear")!.base).toBeCloseTo(plain.costs.lines.find((l) => l.name === "Main Distribution Switchgear")!.base, 6);
  });

  it("the design figure replaces site plan + stamped set + PM hours, keeps the plan-check fee, and flows into the price layer", () => {
    const p = project([entry("design", 29007.5, "fixed-unit D&E")]);
    const est = computeEstimate(p);
    expect(est.costs.designAndEngineering).toBe(29007.5);
    expect(est.costs.designInvoice).toBeCloseTo(29007.5 + p.financial.planCheckPermitFee, 6);
    const proposal = computeProposal(p, est)!;
    expect(proposal.costBuildup.rows.find((r) => r.id === "design")!.cost).toBe(29007.5);
    expect(proposal.costBuildup.rows.find((r) => r.id === "design")!.price).toBeCloseTo(29007.5 * 0.93, 6);
  });
});

describe("override register — model class", () => {
  it("keys map to the model's override object and force the figures", () => {
    expect(modelOverridesOf(undefined)).toBeUndefined();
    expect(modelOverridesOf([entry("crewDays", 30)])).toBeUndefined(); // field class, not model
    expect(modelOverridesOf([entry("kwhPerDay", 1400), entry("loanPayment", 20000)])).toEqual({ kwhPerDay: 1400, loanPayment: 20000 });

    const plain = computeProposal(project(), computeEstimate(project()))!.model;
    const p = project([entry("kwhPerDay", 1400), entry("carbonGrossPerYear", 100000), entry("loanPayment", 20000), entry("blendedPerKwh", 0.25), entry("fixedUtilityPerYear", 12000)]);
    const m = computeProposal(p, computeEstimate(p))!.model;
    expect(m.usage.basis).toBe("override");
    expect(m.usage.siteKwhPerDay).toBe(1400);
    expect(m.usage.years[2].kwh).toBeCloseTo(1400 * 365, 6);
    expect(m.carbon.grossPerYear).toBe(100000);
    expect(m.carbon.netPerYear).toBeCloseTo(95000, 6);
    expect(m.financing.payment).toBe(20000);
    expect(m.financing.schedule[0].payment).toBe(20000);
    expect(m.tariff.blendedPerKwh).toBe(0.25);
    expect(m.tariff.years.every((y) => y.fixedCost === 12000)).toBe(true);
    expect(m.tariff.years[0].utilityCost).toBeCloseTo(m.tariff.years[0].kwh * 0.25 + 12000, 6);
    expect(m.tariff.warnings.some((w) => /forced to \$0\.2500/.test(w))).toBe(true);
    expect(plain.usage.basis).toBe("greenfield");
    expect(plain.tariff.blendedPerKwh).not.toBe(0.25);
  });
});

describe("override register — field class", () => {
  it("writes crew days, the switchgear frame, the hardware cost and the retail price through, and detects drift", () => {
    const p = project([entry("crewDays", 34), entry("switchgearA", 3200), entry("hardwareCost", 400000), entry("retailPerKwh", 0.62)]);
    const applied = applyFieldOverrides(p);
    expect(applied.financial.laborBusinessDays).toBe(34);
    expect(applied.setup.gearOverrides?.switchgear480A).toBe(3200);
    expect(applied.financial.chargerHardwareCost).toBe(400000);
    expect(applied.financial.chargerHardwareCostIsAuto).toBe(false);
    expect(applied.commercial!.revenue!.retailPerKwh).toBe(0.62);
    expect(applyFieldOverrides(applied)).toBe(applied); // idempotent
    expect(fieldOverrideDrift(applied)).toHaveLength(0);
    const drifted = { ...applied, financial: { ...applied.financial, laborBusinessDays: 40 } };
    expect(fieldOverrideDrift(drifted).map((d) => d.entry.key)).toEqual(["crewDays"]);
    expect(activeOverrideCount(applied)).toBe(4);
    const est = computeEstimate(applied);
    expect(est.panel.bus480!.suggestedBusA).toBe(3200);
  });

  it("setOverride adds, edits and removes entries", () => {
    let list = setOverride(undefined, "crewDays", { value: 34, reason: "schedule" });
    expect(list).toHaveLength(1);
    expect(list![0]).toMatchObject({ key: "crewDays", value: 34, reason: "schedule" });
    list = setOverride(list, "crewDays", { reason: "published schedule" });
    expect(list![0].reason).toBe("published schedule");
    expect(list![0].value).toBe(34);
    list = setOverride(list, "design", { value: 29007.5 });
    expect(list).toHaveLength(2);
    list = setOverride(list, "crewDays", { value: null });
    expect(list!.map((e) => e.key)).toEqual(["design"]);
    expect(setOverride(list, "design", { value: null })).toBeUndefined();
    expect(setOverride(undefined, "design", { reason: "no value yet" })).toBeUndefined();
  });
});
