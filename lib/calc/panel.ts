import {
  GEAR_CATALOG,
  STANDARD_BREAKERS_A,
  findLoadType,
  nextStandardSize,
} from "./tables";
import type { GearOverrides, GearSelection, LoadType, TakeoffRowComputed } from "./types";

const SQRT3 = Math.sqrt(3);

// Bus ratings available in the gear catalog. Suggestions stay on sizes the
// estimate can actually price. Exported so the UI's override pickers offer
// the same catalog.
export const SWITCHGEAR_480V_A = [400, 600, 800, 1000, 1200, 1600, 2000, 2500, 3000, 3200, 4000, 5000];
export const SUBPANEL_208V_A = [150, 250, 400, 600, 800, 1000];
export const TRANSFORMER_KVA = [75, 112.5, 150, 175, 225, 300, 500];

export interface BranchCircuit {
  loadTypeId: string;
  location: string;
  voltage: number;
  phases: 1 | 3;
  poles: 2 | 3;
  circuits: number; // breaker count for this row
  ampsPerCircuit: number; // continuous input amps each breaker sees
  breakerA: number;
  wire: string;
  conduit: string;
}

export interface BusSummary {
  voltage: 208 | 480;
  circuitCount: number;
  connectedAmps: number; // line current the bus carries (3-phase loads contribute I, single-phase I/sqrt3)
  demandAmps: number; // connected x 125% (NEC 625.41/625.42 continuous)
  /** Bus in use: the manual override when set, else the code minimum. */
  suggestedBusA: number;
  /** Auto-sized code minimum (next catalog size >= demand) — kept for display next to an override. */
  autoBusA: number;
  /** True when suggestedBusA comes from a manual override. */
  overridden: boolean;
}

export interface PanelSchedule {
  branches: BranchCircuit[];
  bus480?: BusSummary;
  bus208?: BusSummary;
  transformer?: {
    connectedKva: number;
    demandKva: number; // x 125%
    suggestedKva: number;
    /** Auto-sized code minimum kVA — kept for display next to an override. */
    autoKva: number;
    /** True when suggestedKva comes from a manual override. */
    overridden: boolean;
    primaryAmps480: number; // RAW connected primary current (no 125% factor)
    primaryBreakerA: number; // 125% of the selected transformer's rated primary FLA
  };
  suggestedGear: GearSelection[];
  notes: string[];
}

/**
 * Derives the electrical one-line from the takeoff: branch breakers per
 * charger, 480V switchgear, and (when 208V L2 load exists on a 480V service)
 * the step-down transformer and 208V sub-panel.
 *
 * Loads are treated as continuous per NEC 625.41/625.42: every bus and
 * breaker is sized at 125% of nameplate input current. Unit input amps come
 * from LoadTypes (unitInputAmps override, else the per-circuit design amps),
 * matching the kW->amps table in the original INPUT SHEET.
 */
export function computePanelSchedule(
  rows: TakeoffRowComputed[],
  loadTypes: LoadType[],
  overrides?: GearOverrides,
): PanelSchedule {
  const notes: string[] = [];
  const chargerRows = rows.filter((r) => r.category === "L2" || r.category === "DCFC");

  const branches: BranchCircuit[] = chargerRows.map((r) => {
    const lt = findLoadType(loadTypes, r.loadTypeId);
    const parallel = lt?.runsAreParallel ?? false;
    // A parallel set is ONE circuit (one breaker, conductors in parallel);
    // non-parallel multi-run units (dual-port L2) are one circuit per run,
    // each carrying the row's design amps.
    const circuitsPerUnit = parallel ? 1 : r.resolvedRunsPerUnit;
    const ampsPerCircuit = r.designAmps;
    return {
      loadTypeId: r.loadTypeId,
      location: r.location,
      voltage: r.volts,
      phases: r.phases,
      poles: r.phases === 3 ? 3 : 2,
      circuits: r.units * circuitsPerUnit,
      ampsPerCircuit,
      breakerA: r.ocpdA,
      wire: r.selectedWire,
      conduit: r.conduitSize,
    };
  });

  function unitInputAmps(r: TakeoffRowComputed): number {
    const lt = findLoadType(loadTypes, r.loadTypeId);
    return lt?.unitInputAmps ?? r.designAmps;
  }

  const rows480 = chargerRows.filter((r) => r.volts === 480);
  const rows208 = chargerRows.filter((r) => r.volts === 208);

  let bus208: BusSummary | undefined;
  let transformer: PanelSchedule["transformer"];
  let bus480: BusSummary | undefined;

  if (rows208.length > 0) {
    // Connected VA first, then the line current the 208Y bus actually carries.
    // A 3-phase load's input amps are already a line current (VA = I x V x
    // sqrt3); a single-phase L2 unit is a 2-pole line-to-line load, so its VA is
    // I x V with no sqrt(3). Summing single-phase branch amps and treating that
    // sum as a 3-phase line current overstated the L2 side — and every bus and
    // transformer sized from it — by 73%. The shop's EV_LVL2SUB schedule does
    // the same thing the right way round: per-pole VA summed, divided by
    // V x 1.732 only at the end to reach line amps.
    const connectedVa = rows208.reduce(
      (s, r) => s + r.units * unitInputAmps(r) * r.volts * (r.phases === 3 ? SQRT3 : 1),
      0,
    );
    const connectedAmps = connectedVa / (208 * SQRT3);
    const demandAmps = connectedAmps * 1.25;
    const autoBusA = nextStandardSize(SUBPANEL_208V_A, demandAmps);
    const overrideA = overrides?.subpanel208A;
    bus208 = {
      voltage: 208,
      circuitCount: branches.filter((b) => b.voltage === 208).reduce((s, b) => s + b.circuits, 0),
      connectedAmps,
      demandAmps,
      suggestedBusA: overrideA && overrideA > 0 ? overrideA : autoBusA,
      autoBusA,
      overridden: !!overrideA && overrideA > 0,
    };
    if (bus208.overridden && bus208.suggestedBusA < demandAmps) {
      notes.push(`208V panel override ${bus208.suggestedBusA}A is below the ${Math.ceil(demandAmps)}A demand (NEC 625 continuous) — undersized.`);
    }
    if (demandAmps > SUBPANEL_208V_A[SUBPANEL_208V_A.length - 1]) {
      notes.push("208V demand exceeds the largest cataloged panel — split the L2 load across multiple sub-panels.");
    }
  }

  const has480Service = rows480.length > 0;
  if (bus208 && has480Service) {
    // Step-down transformer for the L2 load, fed from the 480V gear.
    const connectedKva = (bus208.connectedAmps * 208 * SQRT3) / 1000;
    const demandKva = connectedKva * 1.25; // transformer sized at 125% continuous
    const autoKva = nextStandardSize(TRANSFORMER_KVA, demandKva);
    const overrideKva = overrides?.transformerKva;
    const suggestedKva = overrideKva && overrideKva > 0 ? overrideKva : autoKva;
    // primaryAmps480 is the RAW connected current the transformer reflects
    // onto the 480V bus — the 125% factor is applied exactly once per
    // consumer: by the bus demand calc below, and by the breaker sizing here
    // (125% of the selected transformer's rated primary FLA, NEC 450.3(B)).
    const primaryAmps480 = (connectedKva * 1000) / (480 * SQRT3);
    const transformerFla480 = (suggestedKva * 1000) / (480 * SQRT3);
    transformer = {
      connectedKva,
      demandKva,
      suggestedKva,
      autoKva,
      overridden: !!overrideKva && overrideKva > 0,
      primaryAmps480,
      primaryBreakerA: nextStandardSize(STANDARD_BREAKERS_A, transformerFla480 * 1.25),
    };
    if (transformer.overridden && suggestedKva < demandKva) {
      notes.push(`Transformer override ${suggestedKva} kVA is below the ${demandKva.toFixed(1)} kVA demand (125% continuous) — undersized.`);
    }
    if (demandKva > TRANSFORMER_KVA[TRANSFORMER_KVA.length - 1]) {
      notes.push("208V load exceeds the largest cataloged transformer — use multiple transformers.");
    }
  } else if (bus208 && !has480Service) {
    notes.push("All loads are 208V — service assumed 208V, no step-down transformer added.");
  }

  if (has480Service) {
    const connected480 = rows480.reduce((s, r) => s + r.units * unitInputAmps(r), 0);
    const withTransformer = connected480 + (transformer ? transformer.primaryAmps480 : 0);
    const demandAmps = withTransformer * 1.25;
    const autoBusA = nextStandardSize(SWITCHGEAR_480V_A, demandAmps);
    const overrideA = overrides?.switchgear480A;
    bus480 = {
      voltage: 480,
      circuitCount:
        branches.filter((b) => b.voltage === 480).reduce((s, b) => s + b.circuits, 0) +
        (transformer ? 1 : 0),
      connectedAmps: withTransformer,
      demandAmps,
      suggestedBusA: overrideA && overrideA > 0 ? overrideA : autoBusA,
      autoBusA,
      overridden: !!overrideA && overrideA > 0,
    };
    if (bus480.overridden && bus480.suggestedBusA < demandAmps) {
      notes.push(`Switchgear override ${bus480.suggestedBusA}A is below the ${Math.ceil(demandAmps)}A demand (NEC 625 continuous) — undersized.`);
    }
  }

  // Suggested gear list, on catalog size strings so Peripherals can price it.
  const suggestedGear: GearSelection[] = [];
  if (bus480) {
    suggestedGear.push({ item: "Main switchgear", size: `${bus480.suggestedBusA}A`, voltage: "480V", qty: 1 });
  }
  if (bus208) {
    const item = bus208.suggestedBusA >= 1000 ? "Distribution panel" : "Sub-panel";
    suggestedGear.push({ item, size: `${bus208.suggestedBusA}A`, voltage: "208V", qty: 1 });
  }
  if (transformer) {
    suggestedGear.push({ item: "Transformer", size: `${transformer.suggestedKva}KVA`, voltage: "208V", qty: 1 });
  }
  // Branch breakers grouped by size + voltage.
  const breakerGroups = new Map<string, { size: number; voltage: number; qty: number }>();
  for (const b of branches) {
    if (b.breakerA === 0) continue;
    const key = `${b.breakerA}|${b.voltage}`;
    const g = breakerGroups.get(key) ?? { size: b.breakerA, voltage: b.voltage, qty: 0 };
    g.qty += b.circuits;
    breakerGroups.set(key, g);
  }
  if (transformer) {
    const key = `${transformer.primaryBreakerA}|480`;
    const g = breakerGroups.get(key) ?? { size: transformer.primaryBreakerA, voltage: 480, qty: 0 };
    g.qty += 1;
    breakerGroups.set(key, g);
  }
  for (const g of Array.from(breakerGroups.values()).sort((a, b) => b.voltage - a.voltage || b.size - a.size)) {
    suggestedGear.push({ item: "Branch breaker", size: `${g.size}A`, voltage: `${g.voltage}V`, qty: g.qty });
  }

  const unpriced = suggestedGear.filter((g) => {
    const hit = GEAR_CATALOG.find((c) => c.item === g.item && c.size === g.size && c.voltage === g.voltage);
    return !hit || hit.unitCost === 0;
  });
  if (unpriced.length > 0) {
    notes.push(
      `No catalog price for: ${unpriced.map((g) => `${g.item} ${g.size} ${g.voltage}`).join(", ")} — add prices or overrides before quoting.`,
    );
  }

  return { branches, bus480, bus208, transformer, suggestedGear, notes };
}
