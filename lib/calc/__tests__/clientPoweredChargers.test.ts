import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../autoplan";
import { clientPoweredCounts } from "../clientPowered";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { fillIntakeWorkbook } from "../../intake/fillIntake";
import { projectFromIntake } from "../../intake/importIntake";
import { CLIENT_DC_BOARD_ITEM, CLIENT_L2_PANEL_ITEM, engineDistributionSchedule } from "../../intake/schedule";
import { readWorkbook } from "../../intake/xlsx";
import { computeProposal } from "../../proposal";
import { defaultCommercial } from "../../proposal/defaults";
import type { Project, TakeoffEdit } from "../types";

const TEMPLATE = join(__dirname, "..", "..", "..", "templates", "source", "EVSE_Project_Intake_TEMPLATE_3.8.1.xlsx");

const DC = "DCFC 360kW Dual";
const L2 = "L2 Dual 40A";

/** Twenty chargers: two 360 kW DC cabinets and eighteen dual Level 2 pedestals, some of them client powered. */
function site(edits: Record<string, TakeoffEdit> = {}, dcCount = 2, l2Count = 18): Project {
  const base: Project = { ...defaultProject(), commercial: defaultCommercial(), takeoffEdits: Object.keys(edits).length ? edits : undefined };
  base.setup = { ...base.setup, utility: "SMUD — Sacramento Municipal Utility District" };
  const lines = [
    ...(dcCount ? [{ loadTypeId: DC, count: dcCount, sku: "TP5-360-480-2-300" }] : []),
    ...(l2Count ? [{ loadTypeId: L2, count: l2Count, sku: "CTX-C40-240-2" }] : []),
  ];
  return buildQuickProject({ ...defaultQuickInput(), lines, firstRunFtDcfc: 100, firstRunFtL2: 60, stepFt: 15 }, base);
}

const breakers = (r: ReturnType<typeof computeEstimate>, voltage: string) => r.panel.suggestedGear.filter((g) => g.item === "Branch breaker" && g.voltage === voltage).reduce((s, g) => s + g.qty, 0);

describe("client-powered chargers — two of twenty fed from the client's existing panel", () => {
  const normal = site();
  const two = site({ [`${L2} #3`]: { clientPowered: true }, [`${L2} #7`]: { clientPowered: true } });
  const n = computeEstimate(normal);
  const c = computeEstimate(two);

  it("flags exactly the two ticked units and counts them against the twenty", () => {
    const flagged = c.rows.filter((r) => r.clientPowered).map((r) => r.genKey);
    expect(flagged).toEqual([`${L2} #3`, `${L2} #7`]);
    expect(clientPoweredCounts(c.rows, two.loadTypes)).toEqual({ dc: 0, l2: 2, total: 2, chargers: 20 });
    expect(two.setup.scopeOfWork).toMatch(/2 of 20 chargers client powered \(2 Level 2\)/);
  });

  it("sizes our 208 V side on the other sixteen pedestals; the step-down and sub-panel stay", () => {
    expect(c.panel.transformer).toBeDefined();
    expect(c.panel.bus208!.clientPowered).toBeUndefined();
    expect(c.panel.bus208!.connectedAmps).toBeCloseTo((n.panel.bus208!.connectedAmps * 16) / 18, 6);
    expect(c.panel.bus480!.connectedAmps).toBeLessThan(n.panel.bus480!.connectedAmps);
    const supply = c.panel.clientSupply!.find((x) => x.voltage === 208)!;
    expect(supply).toMatchObject({ units: 2, circuitCount: 4 });
    expect(supply.connectedAmps).toBeCloseTo((n.panel.bus208!.connectedAmps * 2) / 18, 6);
  });

  it("keeps every branch breaker priced, the client's two in their own group", () => {
    expect(breakers(c, "208V")).toBe(breakers(n, "208V"));
    const theirs = c.panel.suggestedGear.filter((g) => g.clientPowered);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ item: "Branch breaker", voltage: "208V", qty: 4 });
  });

  it("the intake schedule lists the client's panel by others and lands those breakers in it", () => {
    const rows = engineDistributionSchedule(two, c);
    const panel = rows.find((r) => r.item.startsWith(CLIENT_L2_PANEL_ITEM))!;
    expect(panel).toMatchObject({ whoProvides: "By others", costBasis: "By others", quotedCost: null, volts: 208 });
    expect(panel.feeds).toMatch(/2 client-powered chargers/);
    const theirs = rows.find((r) => /in the client's panel/.test(r.item))!;
    expect(theirs.fedFrom).toBe(panel.item);
    expect(theirs.qty).toBe(4);
    expect(rows.some((r) => r.type === "Transformer")).toBe(true); // our step-down still feeds the other sixteen
  });

  it("round trip: the two run rows carry the Circuit tag, and importing them back flags the same two units", async () => {
    const { bytes, report } = await fillIntakeWorkbook(readFileSync(TEMPLATE), two, c, computeProposal(two, c)!, { today: "2026-09-23" });
    expect(report.warnings.some((w) => /2 of 20 chargers client powered/.test(w))).toBe(true);
    const wb = await readWorkbook(bytes);
    const tags = Array.from({ length: 20 }, (_, i) => String(wb.get("Electrical", `E${18 + i}`) ?? ""));
    // Equipment order: the two DC cabinets are rows 18–19, the Level 2 pedestals 20–37 — #3 and #7 are rows 22 and 26.
    expect(tags.filter(Boolean)).toEqual(["Client powered 1", "Client powered 2"]);
    expect(tags[4]).toBe("Client powered 1");
    expect(tags[8]).toBe("Client powered 2");
    const back = projectFromIntake(wb, { ...defaultProject(), commercial: defaultCommercial() });
    expect(back.report.mapped.some((m) => /2 charger run\(s\) tagged "Client powered"/.test(m))).toBe(true);
    const again = computeEstimate(back.project);
    expect(again.rows.filter((r) => r.clientPowered).map((r) => r.genKey)).toEqual([`${L2} #3`, `${L2} #7`]);
    expect(again.panel.clientSupply?.find((x) => x.voltage === 208)?.units).toBe(2);
  });
});

describe("client-powered DC chargers", () => {
  it("two of four DC cabinets on the client's board: our switchgear sizes on the other two", () => {
    const normal = computeEstimate(site({}, 4, 0));
    const p = site({ [`${DC} #1`]: { clientPowered: true }, [`${DC} #2`]: { clientPowered: true } }, 4, 0);
    const c = computeEstimate(p);
    expect(c.panel.bus480!.connectedAmps).toBeCloseTo(normal.panel.bus480!.connectedAmps / 2, 6);
    expect(breakers(c, "480V")).toBe(breakers(normal, "480V"));
    expect(c.panel.clientSupply).toEqual([expect.objectContaining({ voltage: 480, units: 2 })]);
    const rows = engineDistributionSchedule(p, c);
    expect(rows.find((r) => r.item.startsWith(CLIENT_DC_BOARD_ITEM))).toMatchObject({ whoProvides: "By others", volts: 480 });
    expect(rows.find((r) => /in the client's board/.test(r.item))?.fedFrom).toMatch(/^Client's existing 480 V switchboard/);
    // Our DC pair still needs a new transformer, so the SMUD pad stays.
    expect(p.peripherals.transformerPadCost).toBeGreaterThan(0);
  });

  it("every DC charger client powered: no switchgear, no service run, no transformer pad of ours", () => {
    const p = site({ [`${DC} #1`]: { clientPowered: true }, [`${DC} #2`]: { clientPowered: true } }, 2, 0);
    const c = computeEstimate(p);
    expect(c.panel.bus480).toBeUndefined();
    expect(c.panel.suggestedGear.some((g) => g.item === "Main switchgear")).toBe(false);
    expect(c.rows.some((r) => r.synthetic && r.loadTypeId.startsWith("SVC"))).toBe(false);
    expect(p.peripherals).toMatchObject({ transformerPadCost: 0, cableWellCost: 0 });
    expect(breakers(c, "480V")).toBeGreaterThan(0);
  });
});
