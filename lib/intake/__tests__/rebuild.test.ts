import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, defaultQuickInput } from "../../calc/autoplan";
import { defaultProject } from "../../calc/defaults";
import type { Project } from "../../calc/types";
import { defaultCommercial } from "../../proposal/defaults";
import { canRebuild, clearSticky, isSticky, readPath, rebuildProject, setSticky, writePath } from "../rebuild";
import { applyTakeoffEdits } from "../../calc/quickstart";

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

  it("a takeoff typed row by row is never regenerated; generated ones (old or new) are", () => {
    const manual: Project = { ...defaultProject() };
    manual.takeoff = [{ id: "m1", loadTypeId: "DCFC 360kW Dual", location: "Bay 1", units: 1, oneWayDistFt: 120 }];
    expect(canRebuild(manual)).toBe(false);
    expect(canRebuild({ ...defaultProject(), takeoff: [] })).toBe(true);
    // Built before genKey existed: the generator's own location pattern still counts.
    const legacy: Project = { ...defaultProject() };
    legacy.takeoff = [{ id: "qs-1", loadTypeId: "DCFC 360kW Dual", location: "DCFC 360kW Dual #1", units: 1, oneWayDistFt: 100 }];
    expect(canRebuild(legacy)).toBe(true);
    expect(canRebuild(seed())).toBe(true);
  });

  it("hand edits, removals and hand-added rows on the Takeoff tab survive every rebuild", () => {
    const built = seed();
    const rows = built.takeoff.filter((r) => !r.synthetic);
    expect(rows.every((r) => r.genKey)).toBe(true);
    const dc2 = rows.find((r) => r.genKey === "DCFC 360kW Dual #2")!;
    const dc1 = rows.find((r) => r.genKey === "DCFC 360kW Dual #1")!;
    // What the Takeoff tab records: a distance and a wire override on #2, #1 removed, one manual row added.
    const edited: Project = {
      ...built,
      takeoff: [...built.takeoff.filter((r) => r.id !== dc1.id).map((r) => (r.id === dc2.id ? { ...r, oneWayDistFt: 250, sizeOverride: "500 kcmil" } : r)), { id: "m9", loadTypeId: "L2 Dual 40A", location: "Guard shack", units: 1, oneWayDistFt: 40, manual: true }],
      takeoffEdits: { "DCFC 360kW Dual #2": { oneWayDistFt: 250, sizeOverride: "500 kcmil" }, "DCFC 360kW Dual #1": { removed: true } },
    };
    // More cabinets: new rows appear, the edited row keeps its cells, the removed one stays out, the manual one rides along.
    const more = rebuildProject({ ...edited, quick: { ...edited.quick!, lines: [{ loadTypeId: "DCFC 360kW Dual", count: 4 }, { loadTypeId: "L2 Dual 40A", count: 2 }] } }, HARDWARE_ALLOWANCE);
    const after = more.takeoff.filter((r) => !r.synthetic);
    expect(after.filter((r) => r.genKey?.startsWith("DCFC")).map((r) => r.genKey)).toEqual(["DCFC 360kW Dual #2", "DCFC 360kW Dual #3", "DCFC 360kW Dual #4"]);
    const kept = after.find((r) => r.genKey === "DCFC 360kW Dual #2")!;
    expect(kept.oneWayDistFt).toBe(250);
    expect(kept.sizeOverride).toBe("500 kcmil");
    expect(after.find((r) => r.genKey === "DCFC 360kW Dual #3")!.oneWayDistFt).toBe(130); // the ladder, untouched
    expect(after.find((r) => r.manual)).toMatchObject({ location: "Guard shack", oneWayDistFt: 40 });
    expect(more.takeoffEdits).toEqual(edited.takeoffEdits);
    // Forgetting the edits regenerates the row and brings the removed one back.
    const forgotten = rebuildProject({ ...more, takeoffEdits: undefined }, HARDWARE_ALLOWANCE);
    expect(forgotten.takeoff.filter((r) => r.genKey?.startsWith("DCFC"))).toHaveLength(4);
    expect(forgotten.takeoff.find((r) => r.genKey === "DCFC 360kW Dual #2")!.oneWayDistFt).toBe(115);
    expect(forgotten.takeoff.find((r) => r.manual)).toBeTruthy();
    // The pure helper, on its own.
    expect(applyTakeoffEdits([{ id: "a", loadTypeId: "X", location: "X #1", genKey: "X #1", units: 1, oneWayDistFt: 10 }], { "X #1": { units: 3, removed: false } }, [])).toEqual([{ id: "a", loadTypeId: "X", location: "X #1", genKey: "X #1", units: 3, oneWayDistFt: 10 }]);
  });
});
