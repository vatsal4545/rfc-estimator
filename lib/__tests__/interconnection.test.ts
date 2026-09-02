import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../calc/autoplan";
import { defaultProject } from "../calc/defaults";
import { computeEstimate } from "../calc/engine";
import { defaultExisting } from "../existing";
import { computeInterconnection, defaultInterconnection, interconnectionRegime } from "../interconnection";
import { computeProposal } from "../proposal";
import { defaultCommercial } from "../proposal/defaults";

describe("interconnection regime", () => {
  it("resolves from the delivery utility roster", () => {
    expect(interconnectionRegime("PG&E — Pacific Gas and Electric").regime).toBe("pge-rule29");
    expect(interconnectionRegime("SCE — Southern California Edison").regime).toBe("sce-rule29");
    expect(interconnectionRegime("SDG&E — San Diego Gas & Electric").regime).toBe("sdge-rule45");
    expect(interconnectionRegime("Liberty Utilities (CalPeco Electric)").regime).toBe("ca-iou");
    expect(interconnectionRegime("SMUD — Sacramento Municipal Utility District").regime).toBe("pou");
    expect(interconnectionRegime("Plumas-Sierra Rural Electric Cooperative").regime).toBe("pou");
    expect(interconnectionRegime("DTE Electric Company").regime).toBe("michigan");
    expect(interconnectionRegime("").regime).toBe("unknown");
    expect(interconnectionRegime("Some Co-op Nobody Listed").regime).toBe("other");
    expect(interconnectionRegime("PG&E — Pacific Gas and Electric").evRuleApplies).toBe(true);
    expect(interconnectionRegime("SMUD — Sacramento Municipal Utility District").evRuleApplies).toBe(false);
  });
});

describe("what the customer bears, exclusions and checks", () => {
  function project(utility: string) {
    const base = { ...defaultProject(), commercial: { ...defaultCommercial(), utilityInterconnectFee: 3500 } };
    const p = buildQuickProject({ ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 360kW Dual", count: 4, sku: "TP5-360-480-2-300" }] }, base, "ic");
    p.setup.utility = utility;
    return p;
  }

  it("PG&E: the utility builds the extension; design fee, service run, gear and chargers in the price; Rules 15/16 and ITCC excluded", () => {
    const p = project("PG&E — Pacific Gas and Electric");
    p.intake = { ...p.intake!, interconnection: { ...defaultInterconnection(), applicationSubmitted: "Yes — 2026-08-01", padLocationAgreed: "Yes", proofOfCommitment: "Yes", acceptsOandM: "Yes", acceptsActivation: "Yes" } } as typeof p.intake;
    const est = computeEstimate(p);
    const r = computeInterconnection(p, est, computeProposal(p, est)!.costBuildup);
    expect(r.regime.regime).toBe("pge-rule29");
    expect(r.utilityPaysFor).toHaveLength(6);
    const row = (item: string) => r.customerBears.find((b) => b.item.startsWith(item))!;
    expect(row("Utility interconnection design").inPrice).toBe("Yes");
    expect(row("Utility interconnection design").amount).toBe(3500);
    expect(row("Service entrance conductors").inPrice).toBe("Yes");
    expect(row("Service entrance conductors").amount).toBeGreaterThan(0);
    expect(row("Meter socket").amount).toBeCloseTo(est.costs.lines.find((l) => l.name === "Main Distribution Switchgear")!.finalCost, 6);
    expect(row("All EV charging equipment").amount).toBeCloseTo(p.financial.chargerHardwareCost * 0.93, 2);
    expect(row("Rule 15 distribution").inPrice).toBe("NO — EXCLUDED");
    expect(row("Rule 16").inPrice).toBe("NO — EXCLUDED");
    expect(row("ITCC").inPrice).toBe("NO — EXCLUDED");
    expect(r.exclusionWording).toMatch(/^Utility distribution work under PG&E Electric Rules 15 and 16/);
    expect(r.obligations).toHaveLength(4);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("a carried line-extension contribution shows up as a pass-through and wants a returned design", () => {
    const p = project("PG&E — Pacific Gas and Electric");
    p.commercial!.lineExtensionContribution = 12000;
    p.intake = { ...p.intake!, interconnection: { ...defaultInterconnection(), rule15Indicated: "Unknown — design not yet submitted" } } as typeof p.intake;
    const est = computeEstimate(p);
    const proposal = computeProposal(p, est)!;
    expect(proposal.costBuildup.rows.find((r) => r.id === "lineExtension")!.price).toBe(12000);
    expect(proposal.margin.rows.find((r) => r.line === "interconnect")!.margin).toBeCloseTo(3500 * 0.3, 6); // no margin on the contribution
    const r = computeInterconnection(p, est, proposal.costBuildup);
    expect(r.customerBears.find((b) => b.item.startsWith("Rule 15"))!.inPrice).toBe("Yes");
    expect(r.checks.find((c) => c.label.startsWith("Rule 15/16"))!.ok).toBe(false);
    expect(r.exclusionWording).toMatch(/stated line-extension contribution/);
  });

  it("a publicly owned utility gets no Rule 29 allowance — the fee is flagged; the utility-provided feeder leaves our scope", () => {
    const p = project("SMUD — Sacramento Municipal Utility District");
    p.intake = { ...p.intake!, interconnection: { ...defaultInterconnection(), serviceFeederBy: "Utility — EV infrastructure rule" } } as typeof p.intake;
    const est = computeEstimate(p);
    const r = computeInterconnection(p, est);
    expect(r.regime.regime).toBe("pou");
    expect(r.utilityPaysFor).toHaveLength(1);
    expect(r.obligations).toHaveLength(0);
    expect(r.checks.find((c) => c.label.startsWith("No Rule 29 allowance"))!.ok).toBe(false);
    expect(r.customerBears.find((b) => b.item.startsWith("Service entrance"))!.inPrice).toBe("NO — EXCLUDED");
    expect(r.exclusionWording).toMatch(/own policy/);
  });

  it("a retained service on a replacement site needs no application — a fee still carried fails the check", () => {
    const p = project("PG&E — Pacific Gas and Electric");
    const existing = defaultExisting();
    existing.projectType = "replace";
    existing.register.service = "RETAIN";
    p.existing = existing;
    const r = computeInterconnection(p, computeEstimate(p));
    const check = r.checks.find((c) => c.label.startsWith("Retained service"))!;
    expect(check.ok).toBe(false);
    p.commercial!.utilityInterconnectFee = 0;
    expect(computeInterconnection(p, computeEstimate(p)).checks.find((c) => c.label.startsWith("Retained service"))!.ok).toBe(true);
  });
});
