import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../../calc/autoplan";
import { defaultProject } from "../../calc/defaults";
import { computeEstimate } from "../../calc/engine";
import { applyFieldOverrides } from "../../overrides";
import { computeProposal } from "../../proposal";
import { defaultCommercial, defaultIntake } from "../../proposal/defaults";
import { findSku } from "../../ref/priceBook";
import { applyEquipmentSchedule, loadTypeIdForSku } from "../../skus";
import { fillIntakeWorkbook } from "../fillIntake";
import { GEAR_LINE_KEY, SUBPANELS_LINE_KEY, clearGearQuotePricing, distributionScheduleOf, engineDistributionSchedule, gearPricedAtQuotes, priceGearAtQuotes, quotedGearTotal } from "../schedule";
import { readWorkbook } from "../xlsx";

const TEMPLATE = join(__dirname, "..", "..", "..", "templates", "source", "EVSE_Project_Intake_TEMPLATE_3.7.2.xlsx");

function site() {
  const dc = findSku("TP5-360-480-2-300")!;
  const l2 = findSku("CTX-C40-240-2")!;
  const base = { ...defaultProject(), commercial: defaultCommercial() };
  return applyEquipmentSchedule(buildQuickProject({ ...defaultQuickInput(), clientName: "Schedule test", lines: [{ loadTypeId: loadTypeIdForSku(dc)!, count: 4, sku: dc.sku }, { loadTypeId: loadTypeIdForSku(l2)!, count: 2, sku: l2.sku }] }, base, "t", HARDWARE_ALLOWANCE), HARDWARE_ALLOWANCE);
}

// The distribution schedule (intake block E) as data — the engine's rows and the typed ones — and pricing the gear at the schedule's quotes.
describe("distribution schedule as data", () => {
  it("the engine's rows are what the fill writes to block E, every item naming what feeds it", async () => {
    const project = site();
    const result = computeEstimate(project);
    const rows = engineDistributionSchedule(project, result);
    expect(rows[0].type).toBe("Switchboard");
    expect(rows.some((r) => r.type === "Transformer")).toBe(true);
    expect(rows.some((r) => r.type === "Subpanel")).toBe(true);
    expect(rows.every((r) => r.fedFrom.trim() !== "")).toBe(true);
    expect(rows.every((r) => r.costBasis === "Priced elsewhere in this workbook" && r.quotedCost === null)).toBe(true);
    const { bytes } = await fillIntakeWorkbook(readFileSync(TEMPLATE), project, result, computeProposal(project, result)!, { today: "2026-09-18" });
    const wb = await readWorkbook(bytes);
    rows.forEach((r, i) => {
      expect(wb.get("Electrical", `A${165 + i}`)).toBe(r.item);
      expect(wb.get("Electrical", `B${165 + i}`)).toBe(r.type);
    });
    expect(distributionScheduleOf(project, result)).toEqual({ rows, typed: false });
    // Block I names the transformer and sub-panel rows, so the sheet resolves their volts.
    expect(wb.get("Electrical", "C242")).toBe(rows.find((r) => r.type === "Transformer")!.item);
    expect(wb.get("Electrical", "B242")).toBe(rows[0].item);
    expect(wb.get("Electrical", "D242")).toBe(480);
    expect(wb.get("Electrical", "D243")).toBe(208);
  });

  it("a typed schedule with vendor quotes prices the switchgear line, the sheet's B178 and the register alike", async () => {
    let project = site();
    const result0 = computeEstimate(project);
    const before = result0.costs.lines.find((l) => l.name === "Main Distribution Switchgear")!.base;
    const subBefore = result0.costs.lines.find((l) => l.name === "Electrical Sub-Panels, Transformers, Breakers")!.base;
    expect(before).toBeGreaterThan(0);
    // Start from the engine's rows (what the 3 · Electrical editor seeds), quote three of them, mark one as by others.
    const rows = engineDistributionSchedule(project, result0).map((r) => ({ ...r }));
    rows[0] = { ...rows[0], item: "Main service quick disconnect — Siemens HF367R 800 A fused", costBasis: "Vendor quote", quotedCost: 5700 };
    const tx = rows.findIndex((r) => r.type === "Transformer");
    rows[tx] = { ...rows[tx], costBasis: "Vendor quote", quotedCost: 10500 };
    rows.push({ item: "EV panelboard — Siemens P1842MC400AT 400 A", type: "Panelboard", qty: 1, volts: 480, phases: 3, ratingA: 400, fedFrom: rows[0].item, feeds: "Chargers", location: "Outdoor", whoProvides: "Zero Impact Energy", costBasis: "Vendor quote", quotedCost: 5320 });
    rows.push({ item: "(E) Restaurant panel 800 A — existing, retained", type: "Switchboard", qty: 1, volts: 208, phases: 3, ratingA: 800, fedFrom: rows[0].item, feeds: "Restaurant", location: "Existing", whoProvides: "By others", costBasis: "By others", quotedCost: null });
    expect(quotedGearTotal(rows)).toBe(21520);
    // A figure typed against a by-others row is not our money (the sheet's B178 would still sum it — leave such rows unpriced).
    expect(quotedGearTotal([...rows, { ...rows[rows.length - 1], quotedCost: 99999 }])).toBe(21520);
    project = { ...project, intake: { ...(project.intake ?? defaultIntake()), distributionSchedule: rows } };
    expect(gearPricedAtQuotes(project)).toBe(false);
    project = applyFieldOverrides(priceGearAtQuotes(project, rows, "Courtesy Electric S1804803"));
    expect(gearPricedAtQuotes(project)).toBe(true);
    expect(project.overrides!.find((o) => o.key === GEAR_LINE_KEY)).toMatchObject({ value: 21520, source: "Courtesy Electric S1804803" });
    expect(project.overrides!.find((o) => o.key === SUBPANELS_LINE_KEY)!.value).toBe(0);
    const result = computeEstimate(project);
    expect(result.costs.lines.find((l) => l.name === "Main Distribution Switchgear")!.base).toBe(21520);
    expect(result.costs.lines.find((l) => l.name === "Electrical Sub-Panels, Transformers, Breakers")!.base).toBe(0);
    expect(subBefore).toBeGreaterThan(0);
    const { bytes } = await fillIntakeWorkbook(readFileSync(TEMPLATE), project, result, computeProposal(project, result)!, { today: "2026-09-18" });
    const wb = await readWorkbook(bytes);
    // The rows travel as typed; the sheet's own gear total is the quotes; the register row says the same; block I still finds the transformer row.
    expect(wb.get("Electrical", "A165")).toBe(rows[0].item);
    expect(wb.get("Electrical", "L165")).toBe(5700);
    expect(wb.get("Electrical", "B178")).toBe(21520);
    expect(wb.get("Overrides", "B10")).toBe(21520);
    expect(wb.get("Electrical", "C242")).toBe(rows[tx].item);
    expect(wb.get("Electrical", "B242")).toBe(rows[0].item);
    // And back to the catalog.
    const back = clearGearQuotePricing(project);
    expect(gearPricedAtQuotes(back)).toBe(false);
    expect(computeEstimate(applyFieldOverrides(back)).costs.lines.find((l) => l.name === "Main Distribution Switchgear")!.base).toBe(before);
  });
});
