import { describe, expect, it } from "vitest";
import {
  adaStallBreakdown,
  adaStallBreakdownByLevel,
  buildQuickProject,
  defaultQuickInput,
} from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { EMT_SUPPORT_RATES, effectiveInstallMethod, trapezeCount } from "../install";
import type { Project, QuickEstimateInput } from "../types";

function input(overrides: Partial<QuickEstimateInput> = {}): QuickEstimateInput {
  return {
    ...defaultQuickInput(),
    lines: [
      { loadTypeId: "DCFC 200kW", count: 6 },
      { loadTypeId: "L2 Single 40A", count: 5 },
    ],
    terrain: "flat",
    ...overrides,
  };
}

function build(overrides: Partial<QuickEstimateInput> = {}): { p: Project; r: ReturnType<typeof computeEstimate> } {
  const p = buildQuickProject(input(overrides), defaultProject(), "t");
  return { p, r: computeEstimate(p) };
}

// ---------------------------------------------------------------------------
// CBC 11B-228.3.2 — L2 and DCFC counted as separate facilities
// ---------------------------------------------------------------------------

describe("ADA per charging level (CBC 11B-228.3.2)", () => {
  it("applies the 11B-228.3.2.1 table separately per level and sums", () => {
    // Access Board / CBC worked examples.
    const a = adaStallBreakdownByLevel(10, 4);
    expect(a.combined).toEqual({ van: 2, standard: 1, ambulatory: 0, total: 3 });
    const b = adaStallBreakdownByLevel(6, 2);
    expect(b.combined).toEqual({ van: 2, standard: 1, ambulatory: 0, total: 3 });
    const c = adaStallBreakdownByLevel(30, 8);
    expect(c.combined).toEqual({ van: 2, standard: 2, ambulatory: 1, total: 5 });
  });

  it("single-level sites match the plain table", () => {
    expect(adaStallBreakdownByLevel(12, 0).combined).toEqual(adaStallBreakdown(12));
    expect(adaStallBreakdownByLevel(0, 7).combined).toEqual(adaStallBreakdown(7));
    expect(adaStallBreakdownByLevel(0, 0).combined.total).toBe(0);
  });

  it("requires MORE stalls than the old combined count on mixed sites", () => {
    const separate = adaStallBreakdownByLevel(10, 4).combined.total;
    const combined = adaStallBreakdown(14).total;
    expect(separate).toBeGreaterThan(combined);
  });
});

// ---------------------------------------------------------------------------
// Install methods — trench / surface EMT / hybrid
// ---------------------------------------------------------------------------

describe("Install method — surface EMT (parking garage)", () => {
  const { p, r } = build({ installMethod: "surface" });

  it("switches to EMT conduit with zero trenching", () => {
    expect(p.setup.conduitType).toBe("EMT");
    expect(p.setup.trenchLengthFt).toBe(0);
    expect(r.peripherals.asphaltTrenching).toBe(0);
    const trench = r.peripherals.lines.civil.find((c) => c.name === "Trenching / asphalt cut")!;
    expect(trench.qty).toBe(0);
  });

  it("adds strut trapeze racks every 10 ft (NEC 358.30) plus per-conduit straps", () => {
    const routeFt = 100 + 15 * 5 + (100 + 15 * 4); // both legs
    expect(p.setup.surfaceRouteFt).toBe(routeFt);
    const racks = r.peripherals.lines.hardware.find((h) => h.name.startsWith("Strut trapeze"))!;
    expect(racks.qty).toBe(trapezeCount(routeFt));
    expect(racks.qty).toBe(Math.ceil(routeFt / 10) + 1);
    const straps = r.peripherals.lines.hardware.find((h) => h.name === "Strut conduit straps")!;
    expect(straps.qty).toBe(Math.ceil(r.rollups.totalConduitFt / 10));
    const couplings = r.peripherals.lines.hardware.find((h) => h.name === "EMT set-screw couplings")!;
    expect(couplings.unitCost).toBe(EMT_SUPPORT_RATES.couplingEach);
  });

  it("drops dig gear, keeps a scissor lift, and prices no rebar/pad concrete", () => {
    const byName = (n: string) => r.equipment.items.find((i) => i.name === n)!;
    expect(byName("Mini excavator").qty).toBe(0);
    expect(byName("Saw cutter").qty).toBe(0);
    expect(byName("Compactor").qty).toBe(0);
    expect(byName("Temporary fencing").qty).toBe(0);
    expect(byName("Scissor lift").qty).toBe(1);
    const rebar = r.peripherals.lines.civil.find((c) => c.name === "Rebar")!;
    expect(rebar.qty).toBe(0);
  });

  it("costs less than the trenched install of the same site", () => {
    const trenchTotal = build({ installMethod: "trench" }).r.costs.totalCost;
    expect(r.costs.totalCost).toBeLessThan(trenchTotal);
  });
});

describe("Install method — hybrid (EMT chargers + service trench)", () => {
  const { p, r } = build({ installMethod: "hybrid" });

  it("trenches only the service section (chain distances)", () => {
    expect(p.setup.trenchLengthFt).toBe(25 + 15 + 15);
    // Trench cut on the 55 ft service section plus the terrain-independent
    // stall patch-back (16 stalls x 162 SF x $5).
    expect(r.peripherals.asphaltTrenching).toBeCloseTo(55 * 40.81 + 16 * 162 * 5, 2);
  });

  it("runs the service chain in PVC while charger runs stay EMT", () => {
    const chainRows = r.rows.filter((row) => row.synthetic);
    expect(chainRows.length).toBeGreaterThan(0);
    for (const row of chainRows) expect(row.conduitOverride).toBe("PVC");
    expect(p.setup.conduitType).toBe("EMT");
  });

  it("BOM prices each conduit material at its own rate and still ties to the row totals", () => {
    expect(r.materials.crossCheck).toBe(0);
    expect(r.qa.find((q) => q.label.includes("Materials"))!.ok).toBe(true);
    const pvcLines = r.materials.conduitLines.filter((l) => l.conduitType === "PVC" && l.totalFt > 0);
    const emtLines = r.materials.conduitLines.filter((l) => l.conduitType === "EMT" && l.totalFt > 0);
    expect(pvcLines.length).toBeGreaterThan(0); // trenched service section
    expect(emtLines.length).toBeGreaterThan(0); // garage branch runs
    // The trenched PVC section still gets solvent cement.
    const cement = r.peripherals.lines.hardware.find((h) => h.name === "PVC cement")!;
    expect(cement.qty).toBeGreaterThan(0);
  });

  it("counts straps/EMT couplings only on EMT footage; the buried PVC section gets PVC couplings", () => {
    const emtFt = r.materials.conduitLines
      .filter((l) => l.conduitType === "EMT")
      .reduce((s, l) => s + l.feederFt, 0);
    const pvcFt = r.materials.conduitLines
      .filter((l) => l.conduitType === "PVC")
      .reduce((s, l) => s + l.feederFt, 0);
    expect(pvcFt).toBeGreaterThan(0);
    const byName = (n: string) => r.peripherals.lines.hardware.find((h) => h.name === n)!;
    expect(byName("Strut conduit straps").qty).toBe(Math.ceil(emtFt / 10));
    expect(byName("EMT set-screw couplings").qty).toBe(Math.ceil(emtFt / 10));
    expect(byName("Couplings").qty).toBe(Math.ceil(pvcFt / 10));
  });

  it("single-voltage hybrids trench only the utility leg (no step-down segments exist)", () => {
    const l2Only = build({ installMethod: "hybrid", lines: [{ loadTypeId: "L2 Dual 40A", count: 8 }] });
    expect(l2Only.p.setup.trenchLengthFt).toBe(25);
    const dcfcOnly = build({ installMethod: "hybrid", lines: [{ loadTypeId: "DCFC 160kW", count: 4 }] });
    expect(dcfcOnly.p.setup.trenchLengthFt).toBe(25);
  });

  it("still carries EMT supports for the garage route and keeps small dig gear", () => {
    const racks = r.peripherals.lines.hardware.find((h) => h.name.startsWith("Strut trapeze"))!;
    expect(racks.qty).toBeGreaterThan(0);
    const byName = (n: string) => r.equipment.items.find((i) => i.name === n)!;
    expect(byName("Mini excavator").qty).toBe(1);
    expect(byName("Scissor lift").qty).toBe(1);
    expect(byName("Temporary fencing").qty).toBe(55 * 2 + 60);
  });
});

describe("Legacy projects (no installMethod saved)", () => {
  it("derives the method from the conduit toggle", () => {
    const setup = defaultProject().setup;
    expect(effectiveInstallMethod({ ...setup, conduitType: "PVC" })).toBe("trench");
    expect(effectiveInstallMethod({ ...setup, conduitType: "EMT" })).toBe("surface");
  });

  it("rebuilding a legacy EMT project keeps it a no-dig surface job", () => {
    // Simulate an old export: EMT conduit, quick input saved before the
    // installMethod field existed. Rebuilding must not turn it into a trench job.
    const base = defaultProject();
    base.setup.conduitType = "EMT";
    delete base.setup.installMethod;
    const legacyQuick: QuickEstimateInput = { ...input({ lines: [{ loadTypeId: "L2 Dual 40A", count: 8 }] }) };
    delete legacyQuick.installMethod;
    const p = buildQuickProject(legacyQuick, base, "t");
    const r = computeEstimate(p);
    expect(p.setup.installMethod).toBe("surface");
    expect(p.setup.conduitType).toBe("EMT");
    expect(p.setup.trenchLengthFt).toBe(0);
    expect(r.peripherals.asphaltTrenching).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Editable service gear + breaker overrides
// ---------------------------------------------------------------------------

describe("Auto gear tracks charger-count changes", () => {
  it("is on by default and re-prices the switchgear when chargers decrease", () => {
    expect(defaultProject().peripherals.useAutoGear).toBe(true);
    const big = build({ lines: [{ loadTypeId: "DCFC 200kW", count: 6 }] });
    const small = build({ lines: [{ loadTypeId: "DCFC 200kW", count: 2 }] });
    expect(small.r.panel.bus480!.suggestedBusA).toBeLessThan(big.r.panel.bus480!.suggestedBusA);
    expect(small.r.peripherals.gearMainSwitchgear).toBeLessThan(big.r.peripherals.gearMainSwitchgear);
  });

  it("re-prices live when takeoff rows are removed, without rebuilding", () => {
    const { p, r: before } = build();
    // Drop half the DCFC rows straight off the takeoff — the switchgear must follow.
    let removed = 0;
    p.takeoff = p.takeoff.filter((t) => !(t.loadTypeId === "DCFC 200kW" && ++removed <= 3));
    const after = computeEstimate(p);
    expect(after.panel.bus480!.suggestedBusA).toBeLessThan(before.panel.bus480!.suggestedBusA);
    expect(after.peripherals.gearMainSwitchgear).toBeLessThan(before.peripherals.gearMainSwitchgear);
  });
});

describe("Gear overrides cascade through the service chain", () => {
  it("override wins over the auto size and re-prices the gear", () => {
    const { p } = build();
    p.setup.gearOverrides = { transformerKva: 300, switchgear480A: 3000 };
    const r = computeEstimate(p);
    expect(r.panel.transformer!.suggestedKva).toBe(300);
    expect(r.panel.transformer!.overridden).toBe(true);
    expect(r.panel.transformer!.autoKva).toBeLessThan(300);
    expect(r.panel.bus480!.suggestedBusA).toBe(3000);
    const gear = r.panel.suggestedGear;
    expect(gear.find((g) => g.item === "Transformer")!.size).toBe("300KVA");
    expect(gear.find((g) => g.item === "Main switchgear")!.size).toBe("3000A");
  });

  it("a bigger transformer resizes the primary breaker and chain conductors", () => {
    const { p, r: before } = build();
    p.setup.gearOverrides = { transformerKva: 500 };
    const after = computeEstimate(p);
    expect(after.panel.transformer!.primaryBreakerA).toBeGreaterThan(
      before.panel.transformer!.primaryBreakerA,
    );
    // Secondary feeder (TX → sub-panel) re-sizes from the bigger unit's FLA.
    const seg = (r: typeof after) => r.rows.find((x) => x.id === "chain-FDR TX→Sub-panel")!;
    expect(seg(after).designAmps).toBeGreaterThan(seg(before).designAmps);
  });

  it("an undersized override raises a panel note", () => {
    // Enough L2 to put demand (346A) above the smallest cataloged panel; with
    // the default 5 units the corrected single-phase demand is only 144A, so
    // a 150A panel is genuinely adequate and rightly draws no note.
    const { p } = build({
      lines: [
        { loadTypeId: "DCFC 200kW", count: 6 },
        { loadTypeId: "L2 Single 40A", count: 12 },
      ],
    });
    p.setup.gearOverrides = { subpanel208A: 150 };
    const r = computeEstimate(p);
    expect(r.panel.bus208!.suggestedBusA).toBe(150);
    expect(r.panel.notes.some((n) => n.includes("below") && n.includes("demand"))).toBe(true);
  });
});

describe("Per-row breaker override", () => {
  it("wins over the load type, resizes the EGC, and flows to the panel schedule", () => {
    const { p } = build();
    const row = p.takeoff.find((t) => t.loadTypeId === "L2 Single 40A")!;
    row.ocpdOverrideA = 60;
    const r = computeEstimate(p);
    const computed = r.rows.find((x) => x.id === row.id)!;
    expect(computed.ocpdA).toBe(60);
    // 250.122: 60A OCPD → 10 AWG Cu EGC (same bracket as 50A here).
    expect(computed.groundSize).toBe("10 AWG");
    const branch = r.panel.branches.find((b) => b.location === computed.location)!;
    expect(branch.breakerA).toBe(60);
  });

  it("flags an override below 125% of continuous load", () => {
    const { p } = build();
    const row = p.takeoff.find((t) => t.loadTypeId === "L2 Single 40A")!;
    row.ocpdOverrideA = 40; // 40A EVSE needs 50A (40 × 1.25)
    const r = computeEstimate(p);
    const computed = r.rows.find((x) => x.id === row.id)!;
    expect(computed.flag).toContain("below 125%");
  });

  it("parallel sets check the override against the FULL set current (one breaker per set, NEC 240.8)", () => {
    const { p } = build({ lines: [{ loadTypeId: "DCFC 240kW", count: 2 }] });
    const row = p.takeoff.find((t) => t.loadTypeId === "DCFC 240kW")!;
    row.ocpdOverrideA = 250; // the 2-run parallel set carries 320A → needs 400A
    const r = computeEstimate(p);
    expect(r.rows.find((x) => x.id === row.id)!.flag).toContain("below 125%");
  });

  it("flags an override above the conductor's protection limit (NEC 240.4)", () => {
    const { p } = build();
    const row = p.takeoff.find((t) => t.loadTypeId === "L2 Single 40A")!;
    row.ocpdOverrideA = 100; // conductor is 8 AWG Cu (50A) → 240.4 caps the OCPD at 50A
    const r = computeEstimate(p);
    const computed = r.rows.find((x) => x.id === row.id)!;
    expect(computed.flag).toContain("NEC 240.4");
  });
});
