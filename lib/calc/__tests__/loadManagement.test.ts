import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { fillIntakeWorkbook } from "../../intake/fillIntake";
import { projectFromIntake } from "../../intake/importIntake";
import { readWorkbook } from "../../intake/xlsx";
import { computeProposal } from "../../proposal";
import { defaultCommercial } from "../../proposal/defaults";
import type { LoadManagement, Project } from "../types";

const TEMPLATE = join(__dirname, "..", "..", "..", "templates", "source", "EVSE_Project_Intake_TEMPLATE_3.8.1.xlsx");

/** The Oceana Inn (E-00039) shape: six 60 kW dual DC all-in-ones on 480 V and eight 32 A single Level 2 on 208 V. */
function site(loadManagement?: LoadManagement): Project {
  const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
  base.setup = { ...base.setup, loadManagement };
  return buildQuickProject(
    { ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 60kW Dual", count: 6, sku: "CTX-AiO-60-3-200" }, { loadTypeId: "L2 Single 32A", count: 8, sku: "CTX-C32-240-1" }], firstRunFtDcfc: 100, firstRunFtL2: 110, stepFt: 15 },
    base,
  );
}

describe("load management — the service sized on a managed site draw", () => {
  const full = computeEstimate(site());
  const dialed = computeEstimate(site({ dcUnitKw: 50 }));

  it("at nameplate six 60 kW units + the Level 2 transformer need an 800 A frame", () => {
    expect(full.panel.bus480!.managedKw).toBeUndefined();
    expect(full.panel.bus480!.demandAmps).toBeGreaterThan(600);
    expect(full.panel.bus480!.autoBusA).toBe(800);
  });

  it("dialed to 50 kW each, the same site fits the 600 A board signed with the utility", () => {
    const b = dialed.panel.bus480!;
    const dcAt50 = (6 * 50 * 1000) / (480 * Math.sqrt(3));
    expect(b.connectedAmps).toBeCloseTo(dcAt50 + dialed.panel.transformer!.primaryAmps480, 6);
    expect(b.nameplateAmps).toBeCloseTo(full.panel.bus480!.connectedAmps, 6);
    expect(b.demandAmps).toBeLessThanOrEqual(600);
    expect(b.autoBusA).toBe(600);
    expect(b.managedKw).toBeCloseTo((b.connectedAmps * 480 * Math.sqrt(3)) / 1000, 6);
    expect(dialed.panel.notes.some((n) => /Load managed/.test(n) && /dialed to 50 kW/.test(n))).toBe(true);
  });

  it("branch circuits, the step-down and the 208 V panel stay at nameplate", () => {
    const breakers = (r: ReturnType<typeof computeEstimate>) => r.panel.suggestedGear.filter((g) => g.item === "Branch breaker").map((g) => `${g.size} ${g.voltage} ×${g.qty}`);
    expect(breakers(dialed)).toEqual(breakers(full));
    expect(dialed.panel.transformer!.suggestedKva).toBe(full.panel.transformer!.suggestedKva);
    expect(dialed.panel.bus208!.suggestedBusA).toBe(full.panel.bus208!.suggestedBusA);
  });

  it("a typed site cap wins over the dial; a cap at or above nameplate changes nothing", () => {
    const capped = computeEstimate(site({ dcUnitKw: 50, cappedKw: 349.92 })).panel.bus480!;
    expect(capped.managedKw).toBe(349.92);
    expect(capped.connectedAmps).toBeCloseTo((349.92 * 1000) / (480 * Math.sqrt(3)), 6);
    expect(capped.autoBusA).toBe(600);
    const loose = computeEstimate(site({ cappedKw: 5000 })).panel.bus480!;
    expect(loose.managedKw).toBeUndefined();
    expect(loose.autoBusA).toBe(800);
  });

  it("round trip: the fill writes B114 Yes + B115 cap, the sheet's frame check passes at 600 A, and the import turns it back on", async () => {
    const project = site({ dcUnitKw: 50 });
    const result = computeEstimate(project);
    const { bytes } = await fillIntakeWorkbook(readFileSync(TEMPLATE), project, result, computeProposal(project, result), { today: "2026-09-25" });
    const wb = await readWorkbook(bytes);
    expect(wb.get("Electrical", "B114")).toBe("Yes");
    expect(wb.get("Electrical", "B115")).toBeCloseTo(result.panel.bus480!.managedKw!, 2);
    expect(wb.get("Electrical", "B112")).toBe(600);
    expect(wb.get("Electrical", "B111")).toBe(600);
    expect(String(wb.get("Electrical", "B113"))).toMatch(/^OK/);
    const imported = projectFromIntake(wb, { ...defaultProject(), commercial: defaultCommercial() });
    expect(imported.project.setup.loadManagement?.cappedKw).toBeCloseTo(result.panel.bus480!.managedKw!, 2);
    expect(computeEstimate(imported.project).panel.bus480!.autoBusA).toBe(600);
  });

  it("an unmanaged fill writes B114 No and leaves the cap blank", async () => {
    const project = site();
    const result = computeEstimate(project);
    const wb = await readWorkbook((await fillIntakeWorkbook(readFileSync(TEMPLATE), project, result, computeProposal(project, result), { today: "2026-09-25" })).bytes);
    expect(wb.get("Electrical", "B114")).toBe("No");
    expect(wb.get("Electrical", "B115")).toBeNull();
  });
});
