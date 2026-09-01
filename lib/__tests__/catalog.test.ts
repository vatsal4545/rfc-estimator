import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../calc/autoplan";
import { defaultProject } from "../calc/defaults";
import {
  autoHardwareCost,
  createCatalogStore,
  effectiveHardwareAllowance,
  isAutoHardwareCost,
  reconcileHardwareCost,
} from "../catalog";
import type { StorageLike } from "../projectStore";

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("global charger-price catalog", () => {
  it("stores overrides, merges over shipped defaults, and resets", () => {
    const store = createCatalogStore(memoryStorage());
    store.setPrice("DCFC 200kW", 85000);
    let eff = effectiveHardwareAllowance(store.getOverrides());
    expect(eff["DCFC 200kW"]).toBe(85000);
    expect(eff["L2 Single 40A"]).toBe(HARDWARE_ALLOWANCE["L2 Single 40A"]); // untouched default
    store.setPrice("DCFC 200kW", undefined);
    eff = effectiveHardwareAllowance(store.getOverrides());
    expect(eff["DCFC 200kW"]).toBe(HARDWARE_ALLOWANCE["DCFC 200kW"]);
  });

  it("build bakes catalog prices in and flags the line as auto", () => {
    const p = buildQuickProject(defaultQuickInput(), defaultProject(), "t", {
      ...HARDWARE_ALLOWANCE,
      "DCFC 200kW": 85000,
    });
    // 6 x 85,000 + 5 x 4,000 (L2 Single 40A default)
    expect(p.financial.chargerHardwareCost).toBe(6 * 85000 + 5 * 4000);
    expect(p.financial.chargerHardwareCostIsAuto).toBe(true);
  });

  it("reconciles auto-priced projects to a new catalog, leaves manual ones alone", () => {
    const p = buildQuickProject(defaultQuickInput(), defaultProject(), "t");
    const newPrices = { ...HARDWARE_ALLOWANCE, "DCFC 200kW": 85000 };
    const r = reconcileHardwareCost(p, newPrices);
    expect(r.financial.chargerHardwareCost).toBe(6 * 85000 + 5 * 4000);

    const manual = { ...p, financial: { ...p.financial, chargerHardwareCost: 500000, chargerHardwareCostIsAuto: false } };
    expect(reconcileHardwareCost(manual, newPrices).financial.chargerHardwareCost).toBe(500000);
  });

  it("legacy projects without the flag: auto when the stored cost matches defaults", () => {
    const p = buildQuickProject(defaultQuickInput(), defaultProject(), "t");
    delete p.financial.chargerHardwareCostIsAuto;
    expect(isAutoHardwareCost(p)).toBe(true); // untouched build => follows catalog
    p.financial.chargerHardwareCost = 123456; // hand-edited before the flag existed
    expect(isAutoHardwareCost(p)).toBe(false);

    // Manual (non-quick) projects have no auto derivation and are never touched.
    const manualBuild = defaultProject();
    delete manualBuild.quick;
    manualBuild.financial.chargerHardwareCost = 572000;
    expect(autoHardwareCost(manualBuild, HARDWARE_ALLOWANCE)).toBeNull();
    expect(reconcileHardwareCost(manualBuild, HARDWARE_ALLOWANCE).financial.chargerHardwareCost).toBe(572000);
  });
});
