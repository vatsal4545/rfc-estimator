import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, defaultQuickInput } from "../../calc/autoplan";
import { defaultProject } from "../../calc/defaults";
import type { Project } from "../../calc/types";
import { defaultCommercial } from "../../proposal/defaults";
import { canRebuild, clearSticky, isSticky, readPath, rebuildProject, setSticky, writePath } from "../rebuild";

function seed(): Project {
  const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
  base.quick = { ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 360kW Dual", count: 2 }, { loadTypeId: "L2 Dual 40A", count: 2 }], firstRunFtDcfc: 100, firstRunFtL2: 60, stepFt: 15 };
  return rebuildProject(base, HARDWARE_ALLOWANCE);
}

describe("rebuilding from the intake tabs", () => {
  it("re-derives everything a Build derives, but keeps what was pinned by hand", () => {
    const built = seed();
    expect(canRebuild(built)).toBe(true);
    const engineBollards = built.peripherals.bollardsQty;
    const engineDays = built.financial.laborBusinessDays;
    expect(engineBollards).toBeGreaterThan(0);

    let pinned = setSticky(built, "peripherals.bollardsQty", 20);
    pinned = setSticky(pinned, "financial.pmHours", 35);
    pinned = setSticky(pinned, "peripherals.gpr", 3);
    expect(isSticky(pinned, "peripherals.bollardsQty")).toBe(true);
    expect(readPath(pinned, "peripherals.gpr")).toBe(3);

    // More chargers: labour days and the engine's own quantities move, the pinned ones do not.
    const more = rebuildProject({ ...pinned, quick: { ...pinned.quick!, lines: [{ loadTypeId: "DCFC 360kW Dual", count: 6 }, { loadTypeId: "L2 Dual 40A", count: 2 }] } }, HARDWARE_ALLOWANCE);
    expect(more.financial.laborBusinessDays).toBeGreaterThan(engineDays);
    expect(more.peripherals.bollardsQty).toBe(20);
    expect(more.financial.pmHours).toBe(35);
    expect(readPath(more, "peripherals.gpr")).toBe(3);
    expect(more.takeoff.filter((r) => !r.synthetic)).toHaveLength(8);

    // Unpin → the next rebuild hands the field back to the engine.
    const released = rebuildProject(clearSticky(more, "peripherals.bollardsQty"), HARDWARE_ALLOWANCE);
    expect(released.peripherals.bollardsQty).toBeGreaterThan(20);
    expect(released.sticky).toEqual(["financial.pmHours", "peripherals.gpr"]);
    expect(released.financial.pmHours).toBe(35);
  });

  it("pins the rentals list as a whole and reads/writes dot paths", () => {
    const built = seed();
    const rentals = built.equipment.map((e) => (e.name === "Forklift" ? { ...e, qty: 2, durationValue: 5 } : e));
    const pinned = setSticky(built, "equipment", rentals);
    const rebuilt = rebuildProject({ ...pinned, quick: { ...pinned.quick!, firstRunFtDcfc: 300 } }, HARDWARE_ALLOWANCE);
    expect(rebuilt.equipment.find((e) => e.name === "Forklift")).toMatchObject({ qty: 2, durationValue: 5 });
    expect(rebuilt.setup.trenchLengthFt).toBeGreaterThan(built.setup.trenchLengthFt);
    expect(readPath(rebuilt, "financial.laborDailyRate")).toBe(2750);
    expect(writePath(rebuilt, "setup.scopeOfWork", "Custom scope").setup.scopeOfWork).toBe("Custom scope");
    expect(writePath(rebuilt, "nope.field", 1)).toBe(rebuilt);
  });

  it("a hand-built takeoff with no quick lines is never regenerated", () => {
    const manual: Project = { ...defaultProject(), quick: { ...defaultQuickInput(), lines: [] } };
    manual.takeoff = [{ id: "m1", loadTypeId: "DCFC 360kW Dual", location: "Bay 1", units: 1, oneWayDistFt: 120 }];
    expect(canRebuild(manual)).toBe(false);
    expect(canRebuild({ ...defaultProject(), takeoff: [] })).toBe(true);
  });
});
