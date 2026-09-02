// Global charger-price catalog — ONE place to set what each charger model
// costs, applied across EVERY project (unlike project bodies, this is stored
// once per browser, not per project). The shipped defaults live in
// HARDWARE_ALLOWANCE (autoplan.ts); this module layers user overrides on top.
//
// How prices reach estimates: buildQuickProject bakes the per-model allowance
// into financial.chargerHardwareCost at Build time, and the sum is flagged
// chargerHardwareCostIsAuto. reconcileHardwareCost() re-derives that sum from
// the CURRENT catalog whenever a project is opened (or a price is edited), so
// catalog changes flow into every auto-priced project — while a hand-typed
// hardware cost on the Financials tab (auto flag off) is never touched.

import { HARDWARE_ALLOWANCE } from "./calc/autoplan";
import type { Project } from "./calc/types";
import type { StorageLike } from "./projectStore";
import { hardwareListTotal } from "./skus";

const CATALOG_KEY = "rfc-estimator:catalog:v1";

export interface CatalogOverrides {
  /** modelId -> $/unit; absent = shipped default. */
  hardwareAllowance: Record<string, number>;
  /** Last local edit — cloud sync keeps whichever device's catalog is newer. */
  updatedAt: number;
}

export function createCatalogStore(storage: StorageLike) {
  const read = (): CatalogOverrides => {
    try {
      const raw = storage.getItem(CATALOG_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return { hardwareAllowance: parsed?.hardwareAllowance ?? {}, updatedAt: parsed?.updatedAt ?? 0 };
    } catch {
      return { hardwareAllowance: {}, updatedAt: 0 };
    }
  };
  const write = (c: CatalogOverrides) => storage.setItem(CATALOG_KEY, JSON.stringify(c));

  return {
    getOverrides: read,
    /** price undefined = back to the shipped default. */
    setPrice(modelId: string, price: number | undefined): CatalogOverrides {
      const c = read();
      if (price === undefined || Number.isNaN(price)) delete c.hardwareAllowance[modelId];
      else c.hardwareAllowance[modelId] = price;
      c.updatedAt = Date.now();
      write(c);
      return c;
    },
    /** Cloud sync: adopt the remote catalog when it is newer. Returns the
     * (possibly unchanged) local catalog and whether it changed. */
    mergeCatalog(remote: CatalogOverrides | undefined): { catalog: CatalogOverrides; changed: boolean } {
      const mine = read();
      if (!remote || (remote.updatedAt ?? 0) <= mine.updatedAt) return { catalog: mine, changed: false };
      write(remote);
      return { catalog: remote, changed: true };
    },
  };
}

export type CatalogStore = ReturnType<typeof createCatalogStore>;

export function browserCatalogStore(): CatalogStore {
  return createCatalogStore(globalThis.localStorage);
}

/** Shipped defaults with the user's overrides applied. */
export function effectiveHardwareAllowance(overrides: CatalogOverrides): Record<string, number> {
  return { ...HARDWARE_ALLOWANCE, ...overrides.hardwareAllowance };
}

/** What the hardware line SHOULD be for a quick-built project under the given
 * allowance table; null when the project has no quick intake (manual builds).
 * Lines carrying a price-book SKU price at the SKU's list price, dispensers
 * and accessories add theirs, and generic models use the catalog allowance. */
export function autoHardwareCost(project: Project, allowance: Record<string, number>): number | null {
  return hardwareListTotal(project, allowance);
}

/** Auto unless the user hand-typed a hardware cost. Projects saved before the
 * flag existed count as auto when their stored cost matches the shipped
 * defaults (i.e. Build wrote it and nobody touched it). */
export function isAutoHardwareCost(project: Project): boolean {
  return (
    project.financial.chargerHardwareCostIsAuto ??
    autoHardwareCost(project, HARDWARE_ALLOWANCE) === project.financial.chargerHardwareCost
  );
}

/** Re-derive the hardware line from the current catalog for auto-priced
 * projects; returns the project untouched when manual or already current. */
export function reconcileHardwareCost(project: Project, allowance: Record<string, number>): Project {
  if (!isAutoHardwareCost(project)) return project;
  const expected = autoHardwareCost(project, allowance);
  if (expected === null || expected === project.financial.chargerHardwareCost) return project;
  return {
    ...project,
    financial: { ...project.financial, chargerHardwareCost: expected, chargerHardwareCostIsAuto: true },
  };
}
