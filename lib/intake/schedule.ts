// The distribution equipment schedule (intake Electrical block E) as data:
// the engine's own rows — the switchboard, step-down, sub-panel, breakers,
// disconnects and utility substructures the estimate carries — or the rows
// someone typed (an imported workbook's, or the 3 · Electrical editor's).
// The fill writes whichever is in force; block I's feeders name these rows;
// and a typed schedule with vendor-quoted costs can price the estimator's
// switchgear line, so both sides carry the same gear money.

import { GPR_ITEM_NAME } from "../calc/autoplan";
import type { EstimateResult, GearSelection, Project } from "../calc/types";
import { defaultInterconnection } from "../interconnection";
import { COST_LINE_NAMES } from "../calc/costs";
import { setOverride } from "../overrides";
import type { DistributionScheduleRow, IntakeInput } from "../proposal/types";
import { INTAKE_TEXT } from "./cells";

/** The template's Type dropdown on block E (B165:B176). */
export const DISTRIBUTION_TYPES = ["Service disconnect", "Switchboard", "Tap box", "Panelboard", "Subpanel", "Transformer", "EVSE disconnect", "Meter / CT cabinet", "Utility substation", "Other"] as const;
/** "Who provides" (J165:J176). */
export const DISTRIBUTION_PROVIDERS = ["Zero Impact Energy", "Utility", "By others", "Vendor"] as const;
/** "Cost basis" (K165:K176). */
export const DISTRIBUTION_COST_BASES = ["Vendor quote", "RefData rate", "Priced elsewhere in this workbook", "By others", "Allowance"] as const;

/** The gear line and the sub-panels line — what a quoted schedule prices in place of the engine's catalog. */
export const GEAR_LINE_KEY = `line:${COST_LINE_NAMES[1]}`;
export const SUBPANELS_LINE_KEY = `line:${COST_LINE_NAMES[2]}`;

/** The intake's Type for a piece of the estimator's gear, by name. */
export function gearType(item: string): string {
  const t = item.toLowerCase();
  if (t.includes("switchgear") || t.includes("switchboard")) return "Switchboard";
  if (t.includes("transformer")) return "Transformer";
  if (t.includes("sub-panel") || t.includes("subpanel") || t.includes("sub panel")) return "Subpanel";
  if (t.includes("panel")) return "Panelboard";
  if (t.includes("disconnect")) return "Service disconnect";
  return "Other";
}

const parseNumber = (text: string): number | undefined => {
  const m = /(\d+(?:\.\d+)?)/.exec(text);
  return m ? Number(m[1]) : undefined;
};

/** Typed rows in force (blank rows dropped). */
export function typedDistributionSchedule(intake: IntakeInput | undefined): DistributionScheduleRow[] {
  return (intake?.distributionSchedule ?? []).filter((r) => r.item.trim() || r.type.trim() || (r.quotedCost ?? 0) > 0);
}

export function emptyScheduleRow(): DistributionScheduleRow {
  return { item: "", type: "Other", qty: 1, volts: null, phases: 3, ratingA: null, fedFrom: "", feeds: "", location: "", whoProvides: INTAKE_TEXT.feederByUs, costBasis: DISTRIBUTION_COST_BASES[0], quotedCost: null };
}

/**
 * The engine's schedule: every item names what feeds it and what it feeds,
 * so the sheet's own check ("a panel nobody feeds is a panel nobody costed a
 * feeder to") passes, and block I can run its feeders between these names.
 * Everything here is priced on the estimator's gear line, so the cost basis
 * says so and no quoted cost is written — the sheet never prices it twice.
 */
export function engineDistributionSchedule(project: Project, result: EstimateResult): DistributionScheduleRow[] {
  const per = project.peripherals;
  const ic = project.intake?.interconnection ?? defaultInterconnection();
  const gear: GearSelection[] = per.useAutoGear ? result.panel.suggestedGear : per.gear;
  const rows: DistributionScheduleRow[] = [];
  const add = (item: string, type: string, qty: number, volts?: number, ratingA?: number, fedFrom?: string, feeds?: string, existing = false) => {
    rows.push({
      item: existing ? `${item} — existing, retained` : item,
      type,
      qty,
      volts: volts ?? null,
      phases: volts ? 3 : null,
      ratingA: ratingA ?? null,
      fedFrom: fedFrom ?? "",
      feeds: feeds ?? "",
      location: "",
      whoProvides: existing ? INTAKE_TEXT.byOthers : INTAKE_TEXT.feederByUs,
      costBasis: existing ? INTAKE_TEXT.byOthers : INTAKE_TEXT.costBasisPricedElsewhere,
      quotedCost: null,
    });
  };
  const mainGear = gear.find((g) => g.qty > 0 && gearType(g.item) === "Switchboard");
  const existingBoard = per.existingSwitchgear ? `Existing main switchgear${result.panel.bus480 ? ` ${result.panel.bus480.suggestedBusA}A frame` : ""}` : undefined;
  const mainName = existingBoard ?? (mainGear ? `${mainGear.item} ${mainGear.size}`.trim() : ic.pointOfConnection || "Service equipment");
  const stepDown = gear.find((g) => g.qty > 0 && gearType(g.item) === "Transformer");
  const stepDownName = stepDown ? `${stepDown.item} ${stepDown.size}`.trim() : undefined;
  const subPanel = gear.find((g) => g.qty > 0 && (gearType(g.item) === "Subpanel" || gearType(g.item) === "Panelboard"));
  const subPanelName = subPanel ? `${subPanel.item} ${subPanel.size}`.trim() : undefined;
  const serviceSource = ic.serviceType === "Added load to existing service" ? ic.pointOfConnection || "Existing service" : "Utility transformer";
  const hasL2 = result.rows.some((r) => !r.synthetic && r.category === "L2");
  const hasDc = result.rows.some((r) => !r.synthetic && r.category === "DCFC");
  const branchOcpd = (category: string) => new Set(result.rows.filter((r) => !r.synthetic && r.category === category && r.ocpdA > 0).map((r) => r.ocpdA));
  const dcOcpd = branchOcpd("DCFC");
  const l2Ocpd = branchOcpd("L2");
  if (existingBoard) add(existingBoard, "Switchboard", 1, 480, result.panel.bus480?.suggestedBusA, serviceSource, "New main breaker for the EV load", true);
  for (const g of gear) {
    if (g.qty <= 0) continue;
    const amps = /a$/i.test(g.size.trim()) ? parseNumber(g.size) : undefined;
    const volts = parseNumber(g.voltage);
    const type = gearType(g.item);
    const name = `${g.item} ${g.size}`.trim();
    let fedFrom: string | undefined;
    let feeds: string | undefined;
    if (type === "Switchboard") {
      fedFrom = serviceSource;
      feeds = [hasDc ? "DC charger branches" : "", stepDownName ? stepDownName : "", !stepDownName && hasL2 ? "Level 2 branches" : ""].filter(Boolean).join(", ") || "Charger branches";
    } else if (type === "Transformer") {
      fedFrom = mainName;
      feeds = subPanelName ?? "Level 2 panel";
    } else if (type === "Subpanel" || type === "Panelboard") {
      fedFrom = stepDownName ?? mainName;
      feeds = "Level 2 branches";
    } else if (/^main breaker/i.test(g.item)) {
      fedFrom = mainName;
      feeds = [hasDc ? "DC charger branches" : "", stepDownName ?? (hasL2 ? "Level 2 branches" : "")].filter(Boolean).join(", ") || "Charger branches";
    } else if (/breaker/i.test(g.item)) {
      // A branch breaker matches the engine's OCPD for a DC or Level 2 circuit; anything else on the main is the step-down's primary device.
      if (amps !== undefined && l2Ocpd.has(amps) && (volts === undefined || volts < 300)) {
        fedFrom = subPanelName ?? stepDownName ?? mainName;
        feeds = "Level 2 units";
      } else if (amps !== undefined && dcOcpd.has(amps)) {
        fedFrom = mainName;
        feeds = "DC chargers";
      } else {
        fedFrom = mainName;
        feeds = stepDownName ?? "Charger branches";
      }
    } else {
      fedFrom = mainName;
    }
    add(name, type, g.qty, volts, amps, fedFrom, feeds, type === "Switchboard" && !!per.existingSwitchgear);
  }
  if ((per.disconnectQty ?? 0) > 0) {
    const largestDc = Math.max(0, ...result.rows.filter((r) => !r.synthetic && r.category === "DCFC").map((r) => r.ocpdA));
    add("EVSE disconnect (NEC 625.43)", "EVSE disconnect", per.disconnectQty!, 480, largestDc || undefined, mainName, "DC chargers");
  }
  for (const item of per.customItems ?? []) if (/\(quoted\)$/.test(item.name) && item.qty > 0 && item.name !== GPR_ITEM_NAME) add(item.name.replace(/\s*\(quoted\)$/, ""), "Other", item.qty, undefined, undefined, mainName);
  // Customer-furnished utility substructures, so the CEO sees them on his schedule; their money travels in override row 14.
  if (per.transformerPadCost > 0) add("Transformer pad (customer-furnished, utility sets the transformer)", "Other", 1, undefined, undefined, "Utility primary", mainName);
  if (per.cableWellCost > 0) add("Cable well / secondary handhole", "Other", 1, undefined, undefined, "Utility transformer", mainName);
  if (per.pullBoxQty > 0) add("Utility pull box, traffic-rated", "Other", per.pullBoxQty, undefined, undefined, "Utility transformer", mainName);
  return rows;
}

/** The schedule in force: typed rows when there are any, else the engine's. */
export function distributionScheduleOf(project: Project, result: EstimateResult): { rows: DistributionScheduleRow[]; typed: boolean } {
  const typed = typedDistributionSchedule(project.intake);
  return typed.length ? { rows: typed, typed: true } : { rows: engineDistributionSchedule(project, result), typed: false };
}

/** Vendor-quoted money on the rows we provide — what the sheet prices on B178 and what the estimator's gear line should carry. */
export function quotedGearTotal(rows: DistributionScheduleRow[]): number {
  return rows.filter((r) => r.whoProvides.trim().toLowerCase() !== "by others" && r.costBasis.trim().toLowerCase() !== "by others").reduce((t, r) => t + Math.max(0, r.quotedCost ?? 0), 0);
}

/**
 * Price the estimator's gear at the schedule's quoted total: the switchgear
 * line becomes the quotes, the sub-panels / transformers / breakers line
 * zero (they are inside the quotes), both as override-register entries with
 * their reason — so the estimate, the intake's B178 and the register agree.
 */
export function priceGearAtQuotes(project: Project, rows: DistributionScheduleRow[], source = "Distribution schedule — vendor quotes"): Project {
  const total = Math.round(quotedGearTotal(rows) * 100) / 100;
  const quoted = rows.filter((r) => (r.quotedCost ?? 0) > 0).map((r) => r.item.trim()).filter(Boolean);
  let overrides = setOverride(project.overrides, GEAR_LINE_KEY, { value: total, reason: `Vendor quotes on the distribution schedule: ${quoted.join("; ")}.`, source });
  overrides = setOverride(overrides, SUBPANELS_LINE_KEY, { value: 0, reason: "Panelboards, transformers, disconnects and breakers are inside the quoted schedule carried on the switchgear line.", source });
  return { ...project, overrides };
}

/** Whether the register carries the quoted-schedule pricing (both entries present). */
export function gearPricedAtQuotes(project: Pick<Project, "overrides">): boolean {
  const list = project.overrides ?? [];
  return list.some((e) => e.key === GEAR_LINE_KEY) && list.some((e) => e.key === SUBPANELS_LINE_KEY && e.value === 0);
}

/** Hand the gear line back to the estimator's catalog. */
export function clearGearQuotePricing(project: Project): Project {
  let overrides = setOverride(project.overrides, GEAR_LINE_KEY, { value: null });
  overrides = setOverride(overrides, SUBPANELS_LINE_KEY, { value: null });
  return { ...project, overrides };
}
