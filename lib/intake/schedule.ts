// The distribution equipment schedule (intake Electrical block E) as data:
// the engine's own rows — the switchboard, step-down, sub-panel, breakers,
// disconnects and utility substructures the estimate carries — or the rows
// someone typed (an imported workbook's, or the 3 · Electrical editor's).
// The fill writes whichever is in force; block I's feeders name these rows;
// and a typed schedule with vendor-quoted costs can price the estimator's
// switchgear line, so both sides carry the same gear money.

import { GPR_ITEM_NAME } from "../calc/autoplan";
import { COST_LINE_NAMES } from "../calc/costs";
import { disconnectRateFor, gearUnitCost } from "../calc/peripherals";
import { GEAR_CATALOG } from "../calc/tables";
import type { EstimateResult, GearSelection, Project } from "../calc/types";
import { defaultInterconnection } from "../interconnection";
import { setOverride } from "../overrides";
import type { DistributionScheduleRow, IntakeInput } from "../proposal/types";
import { INTAKE_GEAR_480V } from "../ref/benchmarks";
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The intake's own RefData gear table carries this exact price — then the row can honestly say "RefData rate"; otherwise it is the estimator's allowance. */
function refDataHas(item: string, size: string, cost: number): boolean {
  const key = item === "Main switchgear" ? "Main" : item === "Main breaker" ? "main breakers" : item === "Branch breaker" ? "breakers" : item === "Disconnect" || item === "EVSE disconnect" ? "disconnects" : "";
  return !!key && INTAKE_GEAR_480V.some((g) => g.item === key && g.size === size && Math.abs(g.cost - cost) < 0.005);
}

/** Cost basis for a catalog-priced row: the sheet's own table where it agrees, the estimator's allowance where it does not. */
export function catalogBasis(item: string, size: string, cost: number): string {
  return refDataHas(item, size, cost) ? DISTRIBUTION_COST_BASES[1] : DISTRIBUTION_COST_BASES[4];
}

const kvaOf = (text: string): number | undefined => {
  const m = /(\d+(?:\.\d+)?)\s*kva/i.exec(text);
  return m ? Number(m[1]) : undefined;
};

/**
 * The estimator's catalog price for a typed row, from its type, rating and
 * volts: a switchboard is a main switchgear frame, a service disconnect a
 * main device, a panelboard or sub-panel a 208 V sub-panel, a transformer
 * its kVA, an EVSE disconnect the disconnect ladder, a breaker its frame.
 * Meter cabinets, tap boxes and the rest have no catalog price.
 */
export function catalogPriceFor(row: Pick<DistributionScheduleRow, "type" | "item" | "ratingA" | "volts" | "qty">): { unitCost: number; basis: string; catalogItem: string; size: string } | undefined {
  const type = row.type.trim().toLowerCase();
  const rating = row.ratingA ?? 0;
  const volts = row.volts ?? 480;
  const lookup = (item: string, size: string, voltage: string) => {
    const hit = GEAR_CATALOG.find((g) => g.item === item && g.size === size && g.voltage === voltage);
    return hit && hit.unitCost > 0 ? { unitCost: hit.unitCost, basis: catalogBasis(item, size, hit.unitCost), catalogItem: item, size } : undefined;
  };
  if (type === "switchboard") return rating > 0 ? lookup("Main switchgear", `${rating}A`, "480V") : undefined;
  if (type === "service disconnect") return rating > 0 ? (volts >= 300 ? lookup("Main breaker", `${rating}A`, "480V") : lookup("Disconnect", `${rating}A`, "208V")) : undefined;
  if (type === "panelboard" || type === "subpanel") return rating > 0 ? (lookup("Sub-panel", `${rating}A`, "208V") ?? lookup("Distribution panel", `${rating}A`, "208V")) : undefined;
  if (type === "transformer") {
    const kva = kvaOf(row.item);
    return kva ? lookup("Transformer", `${kva}KVA`, "208V") : undefined;
  }
  if (type === "evse disconnect") return rating > 0 ? { unitCost: disconnectRateFor(rating), basis: DISTRIBUTION_COST_BASES[4], catalogItem: "EVSE disconnect", size: `${rating}A` } : undefined;
  if (type === "meter / ct cabinet") return rating > 0 ? lookup("Meter socket", `${rating}A`, "208V") : undefined;
  if (/breaker/.test(row.item.toLowerCase()) && rating > 0) return lookup("Branch breaker", `${rating}A`, volts >= 300 ? "480V" : "208V");
  return undefined;
}

/**
 * A typed row priced from the catalog unless a vendor quote or a by-others /
 * priced-elsewhere basis was chosen: the amount lands in the quoted-cost
 * column with its basis, so the sheet's B178 carries it. Rows the catalog
 * cannot price keep whatever they had.
 */
export function withCatalogPrice(row: DistributionScheduleRow): DistributionScheduleRow {
  const basis = row.costBasis.trim();
  if (basis === DISTRIBUTION_COST_BASES[0] || basis === DISTRIBUTION_COST_BASES[3] || basis === DISTRIBUTION_COST_BASES[2]) return row;
  const hit = catalogPriceFor(row);
  if (!hit) return row;
  return { ...row, costBasis: hit.basis, quotedCost: round2(hit.unitCost * Math.max(1, row.qty ?? 1)) };
}

/** Typed rows in force (blank rows dropped). */
export function typedDistributionSchedule(intake: IntakeInput | undefined): DistributionScheduleRow[] {
  return (intake?.distributionSchedule ?? []).filter((r) => r.item.trim() || r.type.trim() || (r.quotedCost ?? 0) > 0);
}

export function emptyScheduleRow(): DistributionScheduleRow {
  return { item: "", type: "Other", qty: 1, volts: 480, phases: 3, ratingA: null, fedFrom: "", feeds: "", location: "", whoProvides: INTAKE_TEXT.feederByUs, costBasis: DISTRIBUTION_COST_BASES[4], quotedCost: null };
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
  // Priced rows carry the estimator's own money in the quoted-cost column —
  // the sheet's B178 is the sum of that column and nothing else, so this is
  // how the CEO's Pricing tab gets the gear at all. The basis says whether
  // the sheet's RefData table agrees or it is the estimator's allowance.
  const add = (item: string, type: string, qty: number, volts?: number, ratingA?: number, fedFrom?: string, feeds?: string, existing = false, price?: { unitCost: number; basis: string }) => {
    const priced = !existing && price && price.unitCost > 0;
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
      costBasis: existing ? INTAKE_TEXT.byOthers : priced ? price.basis : INTAKE_TEXT.costBasisPricedElsewhere,
      quotedCost: priced ? round2(price.unitCost * qty) : null,
    });
  };
  const gearPrice = (g: GearSelection) => {
    const unitCost = gearUnitCost(g);
    return { unitCost, basis: g.costOverride !== undefined ? DISTRIBUTION_COST_BASES[0] : catalogBasis(g.item, g.size, unitCost) };
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
    add(name, type, g.qty, volts, amps, fedFrom, feeds, type === "Switchboard" && !!per.existingSwitchgear, gearPrice(g));
  }
  if ((per.disconnectQty ?? 0) > 0) {
    const largestDc = Math.max(0, ...result.rows.filter((r) => !r.synthetic && r.category === "DCFC").map((r) => r.ocpdA));
    add("EVSE disconnect (NEC 625.43)", "EVSE disconnect", per.disconnectQty!, 480, largestDc || undefined, mainName, "DC chargers", false, { unitCost: per.disconnectUnitCost ?? disconnectRateFor(largestDc), basis: DISTRIBUTION_COST_BASES[4] });
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

const ours = (r: DistributionScheduleRow) => r.whoProvides.trim().toLowerCase() !== "by others" && r.costBasis.trim().toLowerCase() !== "by others";

/** The money on the rows we provide — vendor quotes and catalog prices alike; what the sheet's B178 sums. */
export function scheduledGearTotal(rows: DistributionScheduleRow[]): number {
  return round2(rows.filter(ours).reduce((t, r) => t + Math.max(0, r.quotedCost ?? 0), 0));
}

/**
 * What the estimator should carry for a typed schedule: every priced row as
 * priced, and for a row we provide that nobody priced, the catalog's figure
 * (the sheet flags such a row UNPRICED until someone types it; the estimate
 * does not wait). Returns the total and the rows the catalog had to fill.
 */
export function estimatedGearTotal(rows: DistributionScheduleRow[]): { total: number; filled: DistributionScheduleRow[] } {
  const filled: DistributionScheduleRow[] = [];
  let total = 0;
  for (const r of rows) {
    if (!ours(r)) continue;
    if ((r.quotedCost ?? 0) > 0) total += r.quotedCost!;
    else if (r.costBasis.trim() !== INTAKE_TEXT.costBasisPricedElsewhere) {
      const hit = catalogPriceFor(r);
      if (hit) {
        total += hit.unitCost * Math.max(1, r.qty ?? 1);
        filled.push(r);
      }
    }
  }
  return { total: round2(total), filled };
}

/** @deprecated use scheduledGearTotal */
export const quotedGearTotal = scheduledGearTotal;
/** @deprecated use priceGearAtSchedule */
export const priceGearAtQuotes = (project: Project, rows: DistributionScheduleRow[], source?: string) => priceGearAtSchedule(project, rows, source);

/**
 * Price the estimator's gear at the schedule: the switchgear line becomes
 * the schedule's total (vendor quotes and catalog prices alike), the
 * sub-panels / transformers / breakers line zero (they are on the schedule),
 * both as override-register entries with their reason — so the estimate, the
 * intake's B178 and the register agree.
 */
export function priceGearAtSchedule(project: Project, rows: DistributionScheduleRow[], source = "Distribution schedule"): Project {
  const { total, filled } = estimatedGearTotal(rows);
  const quoted = rows.filter(ours).filter((r) => (r.quotedCost ?? 0) > 0 && r.costBasis.trim() === DISTRIBUTION_COST_BASES[0]).map((r) => r.item.trim()).filter(Boolean);
  const catalog = rows.filter(ours).filter((r) => (r.quotedCost ?? 0) > 0 && r.costBasis.trim() !== DISTRIBUTION_COST_BASES[0]).length + filled.length;
  const parts = [quoted.length ? `vendor quotes: ${quoted.join("; ")}` : "", catalog ? `${catalog} item(s) at the estimator's catalog` : "", filled.length ? `(${filled.length} unpriced on the sheet, carried at the catalog here)` : ""].filter(Boolean);
  let overrides = setOverride(project.overrides, GEAR_LINE_KEY, { value: total, reason: `The distribution schedule as priced — ${parts.join("; ")}.`, source });
  overrides = setOverride(overrides, SUBPANELS_LINE_KEY, { value: 0, reason: "Panelboards, transformers, disconnects and breakers are inside the quoted schedule carried on the switchgear line.", source });
  return { ...project, overrides };
}

/** Whether the register carries the schedule's pricing (both entries present). */
export function gearPricedAtSchedule(project: Pick<Project, "overrides">): boolean {
  return gearPricedAtQuotes(project);
}
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
