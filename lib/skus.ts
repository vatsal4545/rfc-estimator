// SKU layer — the CEO's price book (lib/ref/priceBook) meeting the estimator's
// charger library. Maps a Chargetronix SKU to the load type the engine sizes
// with, prices hardware at the book's list price, and derives extended
// warranty, service and EVOLV network fees from the book's service classes
// and the Commercial tab's terms (contract years, $/port/month).
//
// Sits beside lib/catalog.ts, outside lib/calc: the engine keeps sizing from
// load types and never reads a SKU. Quick Estimate calls applyEquipmentSchedule
// after buildQuickProject; ProjectContext calls reconcileServiceTerms when a
// project opens or its terms change, so price-book updates flow into every
// project that still tracks them.

import { HARDWARE_ALLOWANCE } from "./calc/autoplan";
import { DEFAULT_LOAD_TYPES } from "./calc/tables";
import type { LoadType, Project } from "./calc/types";
import { defaultServiceTerms } from "./proposal/defaults";
import type { ServiceTerms } from "./proposal/types";
import { ARCHITECTURE, PRICE_BOOK, REFDATA_META, SERVICE_RATES, findSku, type PriceBookSku, type ServiceRate } from "./ref/priceBook";

const LOAD_TYPE_IDS = new Set(DEFAULT_LOAD_TYPES.map((lt) => lt.id));

export function serviceTermsOf(project: Pick<Project, "commercial">): ServiceTerms {
  return project.commercial?.serviceTerms ?? defaultServiceTerms();
}

/** SKUs a Quick Estimate charger line can carry — they take an AC circuit. */
export const CHARGER_SKUS: PriceBookSku[] = PRICE_BOOK.filter(
  (s) => s.role === "all_in_one" || s.role === "level_2" || s.role === "power_cabinet",
);
/** SKUs with no circuit of their own: dispensers (ports on a cabinet) and accessories (price only). */
export const EXTRA_SKUS: PriceBookSku[] = PRICE_BOOK.filter((s) => s.role === "dispenser" || s.role === "accessory");

function kwFromText(text: string): number {
  const m = /(\d+(?:\.\d+)?)\s*kW/i.exec(text);
  return m ? Number(m[1]) : 0;
}

/** Level-2 amps and port count, from "40A Dual Commercial L2 Charger …". */
function l2Spec(sku: PriceBookSku): { amps: number; dual: boolean } {
  const m = /(\d+)\s*A\b/.exec(sku.description);
  return { amps: m ? Number(m[1]) : 0, dual: sku.connectors >= 2 || /dual/i.test(sku.description) };
}

/** Rated kW — the book's column where it has one, else parsed from the description (V2G units). */
export function skuRatedKw(sku: PriceBookSku): number {
  return sku.ratedKw || kwFromText(sku.description);
}

/**
 * The estimator load type a SKU sizes with, or null for items without a
 * circuit (dispensers, accessories) or ratings the lineup has no model for.
 */
export function loadTypeIdForSku(sku: PriceBookSku): string | null {
  let id: string | null = null;
  if (sku.role === "level_2") {
    const { amps, dual } = l2Spec(sku);
    id = dual
      ? amps >= 80
        ? "L2 Dual 80A"
        : amps >= 40
          ? "L2 Dual 40A"
          : "L2 Dual 32A"
      : amps >= 80
        ? "L2 Single 80A"
        : amps >= 48
          ? "L2 Single 48A"
          : amps >= 40
            ? "L2 Single 40A"
            : "L2 Single 32A";
  } else if (sku.role === "all_in_one") {
    const kw = skuRatedKw(sku);
    const v2g = sku.category === "_V2G";
    // V2G units are single-connector bidirectional chargers; size them on the
    // nearest lineup rating at or above their kW.
    const target = v2g ? (kw <= 30 ? 30 : kw <= 50 ? 50 : 60) : kw;
    const dual = !v2g && sku.connectors >= 2;
    id = `DCFC ${target}kW${dual ? " Dual" : ""}`;
  } else if (sku.role === "power_cabinet") {
    const arch = ARCHITECTURE.find((a) => a.sku === sku.sku);
    id = arch ? `Power cabinet ${arch.dcKw}kW` : null;
  }
  return id && LOAD_TYPE_IDS.has(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Service classes
// ---------------------------------------------------------------------------

const DC_CLASSES = SERVICE_RATES.map((r) => {
  const m = /DC-(\d+)\s*kW/i.exec(r.class);
  return { r, kw: m ? Number(m[1]) : 0 };
})
  .filter((x) => x.kw > 0)
  .sort((a, b) => a.kw - b.kw);
const AC_SINGLE = SERVICE_RATES.find((r) => /AC Charger/i.test(r.class) && /Single/i.test(r.class));
const AC_DUAL = SERVICE_RATES.find((r) => /AC Charger/i.test(r.class) && /Dual/i.test(r.class));
const DISPENSER_CLASS = SERVICE_RATES.find((r) => r.class.startsWith("CTX-DST"));

export interface ServiceClassPick {
  rate?: ServiceRate;
  /** False when a neighbouring class stands in for a rating the book has no class for. */
  exact: boolean;
  note?: string;
}

/** The DC service class for a rating: exact where the book has it, else the next class up. */
export function dcServiceClass(kw: number): ServiceClassPick {
  const exact = DC_CLASSES.find((c) => c.kw === kw);
  if (exact) return { rate: exact.r, exact: true };
  const up = DC_CLASSES.find((c) => c.kw > kw) ?? DC_CLASSES[DC_CLASSES.length - 1];
  if (!up) return { exact: false, note: "no DC service class in the price book" };
  return { rate: up.r, exact: false, note: `no ${kw} kW service class in the price book — ${up.kw} kW rates used` };
}

export function serviceClassForSku(sku: PriceBookSku): ServiceClassPick {
  switch (sku.role) {
    case "level_2":
      return { rate: l2Spec(sku).dual ? AC_DUAL : AC_SINGLE, exact: true };
    case "all_in_one":
      return dcServiceClass(skuRatedKw(sku));
    case "power_cabinet": {
      const rate = SERVICE_RATES.find((r) => r.class === sku.sku);
      return rate ? { rate, exact: true } : { exact: false, note: `no service class for ${sku.sku}` };
    }
    case "dispenser":
      return { rate: DISPENSER_CLASS, exact: true };
    default:
      return { exact: true }; // accessories carry no service
  }
}

/** Service class for a generic (non-SKU) model, by level and rating. */
export function serviceClassForLoadType(lt: LoadType): ServiceClassPick {
  if (lt.category === "L2") return { rate: lt.runsPerUnit >= 2 ? AC_DUAL : AC_SINGLE, exact: true };
  if (lt.id.startsWith("Power cabinet")) {
    const rate = SERVICE_RATES.find((r) => r.class === `CTX-DSPB-${kwFromText(lt.id)}`);
    return rate ? { rate, exact: true } : { exact: false, note: `no service class for ${lt.id}` };
  }
  if (lt.category === "DCFC") return dcServiceClass(lt.kwPerPort);
  return { exact: true };
}

/** Years of warranty included in the list price: the terms' override, else parsed from the class ("2 years, parts only"), else 2. */
export function includedWarrantyYears(rate: ServiceRate | undefined, terms: ServiceTerms): number {
  if (terms.includedWarrantyYears !== undefined) return terms.includedWarrantyYears;
  const m = rate ? /(\d+)\s*year/i.exec(rate.includedWarranty) : null;
  return m ? Number(m[1]) : 2;
}

/** Billable ports (network fees bill per port): the model's override, else L2 = circuits, DCFC = 1. */
export function portsForLoadType(lt: LoadType): number {
  return lt.portsPerUnit ?? (lt.category === "L2" ? lt.runsPerUnit : lt.category === "DCFC" ? 1 : 0);
}

/** Billable ports per SKU: connectors; dispensers carry the cabinet's connectors; cabinets and accessories none. */
export function portsForSku(sku: PriceBookSku): number {
  if (sku.role === "dispenser") return ARCHITECTURE.find((a) => a.sku === sku.sku)?.dcOutputs ?? 2;
  if (sku.role === "power_cabinet" || sku.role === "accessory") return 0;
  return Math.max(1, sku.connectors);
}

// ---------------------------------------------------------------------------
// Equipment schedule
// ---------------------------------------------------------------------------

export interface ScheduleLine {
  kind: "charger" | "extra";
  sku?: string;
  loadTypeId?: string;
  description: string;
  count: number;
  unitList: number;
  listTotal: number;
  priceBasis: string;
  portsPerUnit: number;
  ports: number;
  /** Connected AC kW for the line (0 for dispensers and accessories). */
  acKw: number;
  serviceClass?: string;
  includedYears: number;
  /** Per unit over the contract: yearly warranty × years beyond the included ones. */
  warrantyPerUnit: number;
  /** Per unit over the contract: in-warranty service × contract years. */
  servicePerUnit: number;
  warrantyTotal: number;
  serviceTotal: number;
  evolvTotal: number;
  /** Per year once the contract ends: units × the class's warranty + service rate (the year-3 rate). */
  serviceAfterContractPerYear: number;
  warnings: string[];
}

export interface EquipmentSchedule {
  terms: ServiceTerms;
  lines: ScheduleLine[];
  hardwareList: number;
  ports: number;
  connectedKw: number;
  warrantyTotal: number;
  serviceTotal: number;
  evolvTotal: number;
  /** What the site pays itself after the contract: warranty + service at the year-3 class rates, and the network fee, per year. */
  serviceAfterContractPerYear: number;
  networkPerYear: number;
  cabinets: number;
  dispensers: number;
  dispenserCapacity: number;
  warnings: string[];
  /** True when any line carries a price-book SKU or an extra exists. */
  hasSkus: boolean;
}

/**
 * The equipment schedule for a project's Quick Estimate lines: list prices,
 * ports, service classes and contract totals. Pure; reads the project only.
 */
export function computeEquipmentSchedule(
  project: Project,
  allowance: Record<string, number> = HARDWARE_ALLOWANCE,
): EquipmentSchedule {
  const terms = serviceTermsOf(project);
  const years = Math.max(0, terms.contractYears);
  const q = project.quick;
  const lines: ScheduleLine[] = [];
  const warnings: string[] = [];
  const loadTypeOf = (id: string) => project.loadTypes.find((l) => l.id === id) ?? DEFAULT_LOAD_TYPES.find((l) => l.id === id);
  let cabinets = 0;
  let dispenserCapacity = 0;
  let dispensers = 0;

  const serviceFor = (pick: ServiceClassPick) => {
    const inc = includedWarrantyYears(pick.rate, terms);
    return {
      includedYears: inc,
      warrantyPerUnit: pick.rate ? pick.rate.yearlyWarranty * Math.max(0, years - inc) : 0,
      servicePerUnit: pick.rate ? pick.rate.inWarrantyService * years : 0,
      yr3PerUnit: pick.rate ? pick.rate.warrantyPlusServiceYr3 : 0,
    };
  };
  const evolv = (ports: number) => ports * terms.evolvPerPortMonth * 12 * years;

  for (const line of q?.lines ?? []) {
    if (line.count <= 0) continue;
    const lt = loadTypeOf(line.loadTypeId);
    const sku = line.sku ? findSku(line.sku) : undefined;
    const lineWarnings: string[] = [];
    if (line.sku && !sku) lineWarnings.push(`${line.sku} is not in price book ${REFDATA_META.templateVersion} — priced at the catalog allowance`);
    const unitList = sku ? sku.msrp : (allowance[line.loadTypeId] ?? 0);
    const pick = sku ? serviceClassForSku(sku) : lt ? serviceClassForLoadType(lt) : { exact: true };
    if (pick.note) lineWarnings.push(pick.note);
    const portsPerUnit = sku ? portsForSku(sku) : lt ? portsForLoadType(lt) : 0;
    const svc = serviceFor(pick);
    const cabinet = sku?.role === "power_cabinet" || (lt?.id.startsWith("Power cabinet") ?? false);
    if (cabinet) {
      cabinets += line.count;
      const archSku = sku?.sku ?? `CTX-DSPB-${lt ? kwFromText(lt.id) : 0}`;
      dispenserCapacity += line.count * (ARCHITECTURE.find((a) => a.sku === archSku)?.maxDualDispensers ?? 0);
    }
    const acKwPerUnit = lt ? lt.kwPerPort * (lt.runsAreParallel ? 1 : lt.runsPerUnit) : 0;
    lines.push({
      kind: "charger",
      sku: sku?.sku,
      loadTypeId: line.loadTypeId,
      description: sku ? `${sku.sku} — ${sku.description}` : line.loadTypeId,
      count: line.count,
      unitList,
      listTotal: unitList * line.count,
      priceBasis: sku ? "price-book list" : "catalog allowance",
      portsPerUnit,
      ports: portsPerUnit * line.count,
      acKw: acKwPerUnit * line.count,
      serviceClass: pick.rate?.class,
      includedYears: svc.includedYears,
      warrantyPerUnit: svc.warrantyPerUnit,
      servicePerUnit: svc.servicePerUnit,
      warrantyTotal: svc.warrantyPerUnit * line.count,
      serviceTotal: svc.servicePerUnit * line.count,
      evolvTotal: evolv(portsPerUnit * line.count),
      serviceAfterContractPerYear: svc.yr3PerUnit * line.count,
      warnings: lineWarnings,
    });
  }

  for (const x of q?.extras ?? []) {
    if (x.count <= 0) continue;
    const sku = findSku(x.sku);
    const lineWarnings: string[] = [];
    if (!sku) lineWarnings.push(`${x.sku} is not in price book ${REFDATA_META.templateVersion}`);
    const pick = sku ? serviceClassForSku(sku) : { exact: true };
    const portsPerUnit = sku ? portsForSku(sku) : 0;
    if (sku?.role === "dispenser") dispensers += x.count;
    const svc = serviceFor(pick);
    lines.push({
      kind: "extra",
      sku: x.sku,
      description: sku ? `${sku.sku} — ${sku.description}` : x.sku,
      count: x.count,
      unitList: sku?.msrp ?? 0,
      listTotal: (sku?.msrp ?? 0) * x.count,
      priceBasis: "price-book list",
      portsPerUnit,
      ports: portsPerUnit * x.count,
      acKw: 0,
      serviceClass: pick.rate?.class,
      includedYears: svc.includedYears,
      warrantyPerUnit: svc.warrantyPerUnit,
      servicePerUnit: svc.servicePerUnit,
      warrantyTotal: svc.warrantyPerUnit * x.count,
      serviceTotal: svc.servicePerUnit * x.count,
      evolvTotal: evolv(portsPerUnit * x.count),
      serviceAfterContractPerYear: svc.yr3PerUnit * x.count,
      warnings: lineWarnings,
    });
  }

  if (dispensers > 0 && cabinets === 0) warnings.push("Dispensers need a power cabinet (CTX-DSPB) charger line — none in the schedule.");
  if (cabinets > 0 && dispensers === 0) warnings.push("Power cabinets have no connectors of their own — add CTX-DST dispenser lines for the ports.");
  if (cabinets > 0 && dispensers > dispenserCapacity)
    warnings.push(`${dispensers} dispensers exceed the ${dispenserCapacity} the cabinets accept (3 per 360/480 kW cabinet, 8 per 1,280 kW).`);
  if (cabinets > 0) warnings.push("Distributed system: the cabinet's AC feeder is sized; dispenser DC runs, pads and stalls are not in the takeoff yet.");
  for (const l of lines) warnings.push(...l.warnings.map((w) => `${l.sku ?? l.loadTypeId}: ${w}`));

  // Totals land in the Financials fields, so keep them to the cent — the
  // per-line arithmetic otherwise leaves floating-point dust in the inputs.
  const cents = (n: number) => Math.round(n * 100) / 100;
  const sum = (pick: (l: ScheduleLine) => number) => cents(lines.reduce((s, l) => s + pick(l), 0));
  return {
    terms,
    lines,
    hardwareList: sum((l) => l.listTotal),
    ports: sum((l) => l.ports),
    connectedKw: sum((l) => l.acKw),
    warrantyTotal: sum((l) => l.warrantyTotal),
    serviceTotal: sum((l) => l.serviceTotal),
    evolvTotal: sum((l) => l.evolvTotal),
    serviceAfterContractPerYear: sum((l) => l.serviceAfterContractPerYear),
    networkPerYear: cents(sum((l) => l.ports) * terms.evolvPerPortMonth * 12),
    cabinets,
    dispensers,
    dispenserCapacity,
    warnings,
    hasSkus: lines.some((l) => l.sku !== undefined),
  };
}

/**
 * What the hardware line SHOULD be for a quick-built project: SKU lines at
 * list, extras at list, generic models at the catalog allowance. null when the
 * project has no quick intake; 0 when hardware is excluded.
 */
export function hardwareListTotal(project: Project, allowance: Record<string, number> = HARDWARE_ALLOWANCE): number | null {
  const q = project.quick;
  if (!q) return null;
  if (!q.includeChargerHardware) return 0;
  return computeEquipmentSchedule(project, allowance).hardwareList;
}

/**
 * After a Quick Estimate build: set the hardware line from the schedule (SKU
 * list prices where chosen) and, on the price-book basis, the extended
 * warranty, service and EVOLV lines. Manual fields are left alone.
 */
export function applyEquipmentSchedule(project: Project, allowance: Record<string, number> = HARDWARE_ALLOWANCE): Project {
  const s = computeEquipmentSchedule(project, allowance);
  const include = project.quick?.includeChargerHardware !== false;
  const financial = { ...project.financial };
  if (financial.chargerHardwareCostIsAuto ?? true) {
    financial.chargerHardwareCost = include ? s.hardwareList : 0;
    financial.chargerHardwareCostIsAuto = true;
  }
  if (s.terms.basis === "price-book") {
    financial.chargerWarrantyCost = include ? s.warrantyTotal : 0;
    financial.fiveYearServiceCost = include ? s.serviceTotal : 0;
    financial.evolvCommissioningCost = include ? s.evolvTotal : 0;
    financial.serviceTermsAuto = true;
  } else {
    financial.serviceTermsAuto = false;
  }
  return { ...project, financial };
}

/**
 * Re-derive the three service fields for a project that still tracks the
 * price book (serviceTermsAuto) — on open, and when the terms or the price
 * book change. Returns the project untouched when manual or already current.
 */
export function reconcileServiceTerms(project: Project, allowance: Record<string, number> = HARDWARE_ALLOWANCE): Project {
  if (!project.financial.serviceTermsAuto || !project.quick) return project;
  const s = computeEquipmentSchedule(project, allowance);
  if (s.terms.basis !== "price-book") return project;
  const include = project.quick.includeChargerHardware !== false;
  const next = {
    chargerWarrantyCost: include ? s.warrantyTotal : 0,
    fiveYearServiceCost: include ? s.serviceTotal : 0,
    evolvCommissioningCost: include ? s.evolvTotal : 0,
  };
  const f = project.financial;
  if (
    f.chargerWarrantyCost === next.chargerWarrantyCost &&
    f.fiveYearServiceCost === next.fiveYearServiceCost &&
    f.evolvCommissioningCost === next.evolvCommissioningCost
  )
    return project;
  return { ...project, financial: { ...f, ...next } };
}

// ---------------------------------------------------------------------------
// Site capacity — what the business model needs from the equipment
// ---------------------------------------------------------------------------

export interface SiteCapacity {
  /** DC charging positions (connectors a driver plugs into) and DC nameplate kW — the LCFS capacity-credit basis. */
  dcPositions: number;
  dcNameplateKw: number;
  l2Positions: number;
  /** Nameplate kW across every L2 position (7.2 per position on the CTX line; the load type's kW per port for generic models). */
  l2NameplateKw: number;
  cabinets: number;
  dispensers: number;
  source: "quick" | "takeoff" | "none";
  notes: string[];
}

/**
 * Positions and nameplate kW by level, from the Quick Estimate lines (SKUs,
 * generic models, dispenser extras) or, for a hand-built project, the takeoff
 * rows. Pure; reads the project only.
 */
export function computeSiteCapacity(project: Pick<Project, "quick" | "takeoff" | "loadTypes">): SiteCapacity {
  const cap: SiteCapacity = { dcPositions: 0, dcNameplateKw: 0, l2Positions: 0, l2NameplateKw: 0, cabinets: 0, dispensers: 0, source: "none", notes: [] };
  const loadTypeOf = (id: string) => project.loadTypes.find((l) => l.id === id) ?? DEFAULT_LOAD_TYPES.find((l) => l.id === id);
  const addLoadType = (lt: LoadType | undefined, count: number, label: string) => {
    if (!lt) {
      cap.notes.push(`${label}: unknown model — not counted`);
      return;
    }
    if (lt.category === "L2") {
      const ports = portsForLoadType(lt);
      cap.l2Positions += ports * count;
      cap.l2NameplateKw += lt.kwPerPort * ports * count;
    } else if (lt.category === "DCFC") {
      if (lt.id.startsWith("Power cabinet")) {
        cap.cabinets += count;
        cap.dcNameplateKw += kwFromText(lt.id) * count;
      } else {
        cap.dcNameplateKw += lt.kwPerPort * count;
        cap.dcPositions += portsForLoadType(lt) * count;
      }
    }
  };
  const addSku = (sku: PriceBookSku, count: number) => {
    switch (sku.role) {
      case "all_in_one":
        cap.dcNameplateKw += skuRatedKw(sku) * count;
        cap.dcPositions += portsForSku(sku) * count;
        break;
      case "level_2":
        cap.l2Positions += portsForSku(sku) * count;
        cap.l2NameplateKw += (sku.ratedKw || 7.2) * portsForSku(sku) * count;
        break;
      case "power_cabinet": {
        const arch = ARCHITECTURE.find((a) => a.sku === sku.sku);
        cap.cabinets += count;
        cap.dcNameplateKw += (arch?.dcKw ?? skuRatedKw(sku)) * count;
        break;
      }
      case "dispenser":
        cap.dispensers += count;
        cap.dcPositions += portsForSku(sku) * count;
        break;
      default:
        break; // accessories carry no capacity
    }
  };

  const q = project.quick;
  if (q && q.lines.some((l) => l.count > 0)) {
    cap.source = "quick";
    for (const line of q.lines) {
      if (line.count <= 0) continue;
      const sku = line.sku ? findSku(line.sku) : undefined;
      if (sku) addSku(sku, line.count);
      else addLoadType(loadTypeOf(line.loadTypeId), line.count, line.loadTypeId);
    }
    for (const x of q.extras ?? []) {
      if (x.count <= 0) continue;
      const sku = findSku(x.sku);
      if (sku) addSku(sku, x.count);
      else cap.notes.push(`${x.sku}: not in the price book — not counted`);
    }
  } else {
    const rows = project.takeoff.filter((r) => !r.synthetic && r.units > 0);
    if (rows.length > 0) cap.source = "takeoff";
    for (const r of rows) addLoadType(loadTypeOf(r.loadTypeId), r.units, r.loadTypeId);
  }
  if (cap.cabinets > 0 && cap.dispensers === 0) cap.notes.push("Power cabinets without dispensers: no DC positions counted for them.");
  return cap;
}
