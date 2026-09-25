import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../autoplan";
import { gearUnitCost } from "../peripherals";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { estimatorOverrideRows } from "../../intake/handoff";
import { fillIntakeWorkbook } from "../../intake/fillIntake";
import { projectFromIntake } from "../../intake/importIntake";
import { CLIENT_L2_PANEL_ITEM, engineDistributionSchedule } from "../../intake/schedule";
import { readWorkbook } from "../../intake/xlsx";
import { computeProposal } from "../../proposal";
import { defaultCommercial } from "../../proposal/defaults";
import type { Project } from "../types";

const TEMPLATE = join(__dirname, "..", "..", "..", "templates", "source", "EVSE_Project_Intake_TEMPLATE_3.8.1.xlsx");

/** A mixed site: two 360 kW DC cabinets on 480 V and four dual Level 2 pedestals on 208 V. */
function site(l2ClientPowered?: boolean): Project {
  const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
  base.peripherals = { ...base.peripherals, l2ClientPowered };
  return buildQuickProject(
    { ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 360kW Dual", count: 2, sku: "TP5-360-480-2-300" }, { loadTypeId: "L2 Dual 40A", count: 4, sku: "CTX-C40-240-2" }], firstRunFtDcfc: 100, firstRunFtL2: 60, stepFt: 15 },
    base,
  );
}

describe("Level 2 client powered — the client's 208 V panel feeds the Level 2 units", () => {
  const normal = site();
  const client = site(true);
  const n = computeEstimate(normal);
  const c = computeEstimate(client);
  const gear = (p: ReturnType<typeof computeEstimate>) => p.panel.suggestedGear.map((g) => `${g.item} ${g.size} ${g.voltage} ×${g.qty}`);
  const line = (p: ReturnType<typeof computeEstimate>, name: string) => p.costs.lines.find((l) => l.name === name)!.base;

  it("the normal site carries a step-down transformer and a 208 V sub-panel; the client-powered one carries neither", () => {
    expect(n.panel.transformer).toBeDefined();
    expect(gear(n).some((g) => g.startsWith("Transformer"))).toBe(true);
    expect(gear(n).some((g) => g.startsWith("Sub-panel") || g.startsWith("Distribution panel"))).toBe(true);
    expect(c.panel.transformer).toBeUndefined();
    expect(gear(c).some((g) => g.startsWith("Transformer"))).toBe(false);
    expect(gear(c).some((g) => g.startsWith("Sub-panel") || g.startsWith("Distribution panel"))).toBe(false);
  });

  it("keeps every Level 2 branch breaker and circuit, and sizes the client's panel as spare capacity", () => {
    const l2Breakers = (p: ReturnType<typeof computeEstimate>) => p.panel.suggestedGear.filter((g) => g.item === "Branch breaker" && g.voltage === "208V").reduce((s, g) => s + g.qty, 0);
    expect(l2Breakers(c)).toBe(l2Breakers(n));
    expect(l2Breakers(c)).toBe(8); // four dual pedestals, one circuit per port
    expect(c.rows.filter((r) => !r.synthetic && r.category === "L2")).toHaveLength(n.rows.filter((r) => !r.synthetic && r.category === "L2").length);
    expect(c.panel.bus208?.clientPowered).toBe(true);
    expect(c.panel.bus208?.demandAmps).toBeCloseTo(n.panel.bus208!.demandAmps, 6);
    expect(c.panel.notes.some((x) => /client powered/.test(x))).toBe(true);
  });

  it("takes the Level 2 load off the 480 V bus and drops the transformer's primary breaker and the two feeder legs", () => {
    expect(c.panel.bus480!.connectedAmps).toBeLessThan(n.panel.bus480!.connectedAmps);
    expect(c.panel.bus480!.connectedAmps).toBeCloseTo(n.panel.bus480!.connectedAmps - n.panel.transformer!.primaryAmps480, 6);
    expect(n.rows.some((r) => r.synthetic && r.loadTypeId === "FDR Switchgear→TX")).toBe(true);
    expect(c.rows.some((r) => r.synthetic && r.loadTypeId.startsWith("FDR"))).toBe(false);
    expect(c.rows.some((r) => r.synthetic && r.loadTypeId.startsWith("SVC"))).toBe(true); // the 480 V service run stays
  });

  it("prices less gear, and the gear line difference is exactly the transformer, sub-panel and primary breaker", () => {
    const priced = (p: ReturnType<typeof computeEstimate>, pred: (g: { item: string; voltage: string; size: string }) => boolean) =>
      p.panel.suggestedGear.filter(pred).reduce((s, g) => s + g.qty * gearUnitCost(g), 0);
    const dropped = priced(n, (g) => g.item === "Transformer" || g.item === "Sub-panel" || g.item === "Distribution panel") + (priced(n, (g) => g.item === "Branch breaker" && g.voltage === "480V") - priced(c, (g) => g.item === "Branch breaker" && g.voltage === "480V"));
    expect(dropped).toBeGreaterThan(0);
    expect(line(n, "Electrical Sub-Panels, Transformers, Breakers") - line(c, "Electrical Sub-Panels, Transformers, Breakers")).toBeCloseTo(dropped, 2);
  });

  it("drops the transformer/sub-panel pad and bollards, and the scope sentence says so", () => {
    expect(client.peripherals.bollardsQty).toBeLessThan(normal.peripherals.bollardsQty);
    const concrete = (p: ReturnType<typeof computeEstimate>) => p.peripherals.lines.civil.find((x) => x.name.startsWith("Concrete (2500"))?.qty ?? 0;
    expect(concrete(c)).toBeLessThanOrEqual(concrete(n));
    expect(client.setup.scopeOfWork).toMatch(/client powered/);
    expect(normal.setup.scopeOfWork).not.toMatch(/client powered/);
  });

  it("the intake schedule lists the client's panel by others and lands the Level 2 breakers in it; the handoff reason says client powered", () => {
    const rows = engineDistributionSchedule(client, c);
    const panelRow = rows.find((r) => r.item.startsWith(CLIENT_L2_PANEL_ITEM))!;
    expect(panelRow).toMatchObject({ type: "Panelboard", volts: 208, whoProvides: "By others", costBasis: "By others", quotedCost: null });
    expect(rows.some((r) => r.type === "Transformer")).toBe(false);
    expect(rows.some((r) => r.type === "Subpanel" && !r.item.startsWith(CLIENT_L2_PANEL_ITEM))).toBe(false);
    const l2Breaker = rows.find((r) => /breaker/i.test(r.item) && r.feeds.startsWith("Level 2 units"))!;
    expect(l2Breaker.fedFrom).toBe(panelRow.item);
    const reason = estimatorOverrideRows(client, c, computeProposal(client, c)).find((r) => r.row === 10)!.reason;
    expect(reason).toMatch(/client powered/);
  });

  it("round trip: the filled intake carries the row, and importing it back turns the option on with the same gear", async () => {
    const proposal = computeProposal(client, c)!;
    const { bytes, report } = await fillIntakeWorkbook(readFileSync(TEMPLATE), client, c, proposal, { today: "2026-09-21" });
    expect(report.warnings.some((w) => /Level 2 client powered/.test(w))).toBe(true);
    const wb = await readWorkbook(bytes);
    const items = Array.from({ length: 12 }, (_, i) => String(wb.get("Electrical", `A${135 + i}`) ?? ""));
    expect(items.some((x) => x.startsWith(CLIENT_L2_PANEL_ITEM))).toBe(true);
    const types = Array.from({ length: 12 }, (_, i) => String(wb.get("Electrical", `B${135 + i}`) ?? ""));
    expect(types).not.toContain("Transformer"); // (the utility's transformer PAD is an "Other" row and may stay)
    expect(types.filter((t) => t === "Subpanel" || t === "Panelboard")).toEqual(["Panelboard"]); // only the client's panel
    expect(String(wb.get("Equipment", "B27"))).toMatch(/client powered/);
    const imported = projectFromIntake(wb, { ...defaultProject(), commercial: defaultCommercial() });
    // Each Level 2 run comes home tagged "Client powered n" in column E — the same flag, per charger.
    const again = computeEstimate(imported.project);
    const l2 = again.rows.filter((r) => !r.synthetic && r.category === "L2");
    expect(l2.length).toBeGreaterThan(0);
    expect(l2.every((r) => r.clientPowered)).toBe(true);
    expect(again.panel.transformer).toBeUndefined();
    expect(again.panel.suggestedGear.some((g) => g.item === "Sub-panel" || g.item === "Distribution panel")).toBe(false);
  });
});
