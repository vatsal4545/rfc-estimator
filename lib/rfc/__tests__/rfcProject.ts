// The project the RFC tests fill the calculator from.
//
// 4 × TP5-360 dual DC + 2 × CTX-C40 dual L2 + an accessory, on PG&E BEV-2-S.
// That schedule is VERIFIED in the rate library and every one of its rates is
// non-zero, so the tariff assertions are not vacuous — SCE's TOU-EV-9, for
// instance, is NOT PUBLISHED and resolves to all zeros.
//
// It also carries real equipment on purpose: an empty workbook satisfies the
// cached-value checks trivially and proves nothing.

import { join } from "node:path";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../../calc/autoplan";
import { defaultProject } from "../../calc/defaults";
import type { Project } from "../../calc/types";
import { defaultCommercial, defaultIntake, defaultTariff } from "../../proposal/defaults";
import { findSku } from "../../ref/priceBook";
import { applyEquipmentSchedule, loadTypeIdForSku } from "../../skus";

export const RFC_TEMPLATE_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "public",
  "rfc",
  "IntakeSheet_RFC_MSRP_Calculator_Simple_v17.updated.xlsx",
);

export function rfcProject(): Project {
  const base: Project = { ...defaultProject(), commercial: defaultCommercial() };
  const dc = findSku("TP5-360-480-2-300")!;
  const l2 = findSku("CTX-C40-240-2")!;
  const quick = {
    ...defaultQuickInput(),
    clientName: "Hoopa Motel",
    siteAddress: "100 Main St, Hoopa, CA 95546",
    lines: [
      { loadTypeId: loadTypeIdForSku(dc)!, count: 4, sku: dc.sku },
      { loadTypeId: loadTypeIdForSku(l2)!, count: 2, sku: l2.sku },
    ],
    extras: [{ sku: "CTX-FLUXPED-CMS-2", count: 3 }],
  };
  const project = applyEquipmentSchedule(buildQuickProject(quick, base, "t", HARDWARE_ALLOWANCE), HARDWARE_ALLOWANCE);
  project.setup = { ...project.setup, utility: "PG&E — Pacific Gas and Electric" };
  project.intake = { ...defaultIntake(), rateSchedule: "BEV-2-S", hoursOpen: 12, daysOpenPerYear: 360 };
  project.financial = {
    ...project.financial,
    contingencyPct: 0.12,
    laborBusinessDays: 42,
    laborDailyRate: 2500,
    applyContingencyToLabor: true,
    autoCadDesignCost: 4000,
    electricalEngDesignCost: 6000,
    pmHours: 10,
    pmHourlyRate: 358,
  };
  project.commercial = { ...project.commercial!, discountHardwarePct: 0.15, tariff: { ...defaultTariff(), basis: "library" } };
  return project;
}
