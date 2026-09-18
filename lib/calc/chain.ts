import { effectiveInstallMethod } from "./install";
import type { PanelSchedule } from "./panel";
import { WIRE_TABLE } from "./tables";
import type { ConduitMaterial, DistributionFeeder, LoadType, Material, Setup, TakeoffRowInput } from "./types";

const SQRT3 = Math.sqrt(3);

// Parallel sets are capped at 600 kcmil per conductor — the largest size crews
// commonly pull; the source workbooks' service runs (e.g. 5x600 kcmil Al on
// Boatman) follow the same practice.
const MAX_PARALLEL_SIZE = "600 kcmil";
const MAX_RUNS = 8;

function maxAmpacity(material: Material): number {
  const row = WIRE_TABLE.find((w) => w.size === MAX_PARALLEL_SIZE)!;
  return material === "Cu" ? row.ampacityCu : row.ampacityAl;
}

/** Fewest parallel runs so each run's 125%-continuous load fits within the size cap. */
function autoRuns(connectedAmps: number, material: Material, contFactor: number): number {
  const cap = maxAmpacity(material);
  for (let n = 1; n <= MAX_RUNS; n++) {
    if ((connectedAmps * contFactor) / n <= cap) return n;
  }
  return MAX_RUNS;
}

export interface ServiceChainResult {
  loadTypes: LoadType[];
  rows: TakeoffRowInput[];
}

/** Load-type id (and `chain-` row id suffix) of typed distribution feeder k (0-based) — how the intake fill finds its row again. */
export function feederSegmentId(index: number, feeder: DistributionFeeder): string {
  return `FDR ${index + 1} ${feeder.from.trim() || "?"} → ${feeder.to.trim() || "?"}`;
}

/** The floor the feeder is sized to: the typed one, else the item fed's rating on the schedule. */
export function feederFloorA(feeder: DistributionFeeder): number {
  const typed = feeder.floorA ?? 0;
  if (typed > 0) return typed;
  return feeder.ratingA ?? 0;
}

/**
 * Builds the upstream one-line as sized takeoff rows, Southwire-calculator
 * style — each segment gets ampacity (125% continuous) AND voltage-drop
 * sizing from the engine, with parallel runs chosen automatically:
 *
 *   utility TX -> main switchgear            (service conductors)
 *   switchgear -> step-down transformer      (only when 208V load on a 480V service)
 *   transformer -> 208V sub-panel            (secondary conductors)
 *
 * Charger branch runs stay on the Takeoff tab; these three segments complete
 * the SLD from the utility transformer to every charger.
 */
export function buildServiceChain(
  panel: PanelSchedule,
  setup: Setup,
): ServiceChainResult {
  const cfg = setup.serviceChain;
  const loadTypes: LoadType[] = [];
  const rows: TakeoffRowInput[] = [];
  if (!cfg?.enabled) return { loadTypes, rows };

  const mat = cfg.material;
  const cf = setup.continuousLoadFactor;
  // Hybrid installs run the chargers in surface EMT but trench the service
  // section — those buried segments go in PVC regardless of the Setup toggle.
  const chainConduit: ConduitMaterial | undefined =
    effectiveInstallMethod(setup) === "hybrid" ? "PVC" : undefined;

  function segment(
    id: string,
    location: string,
    voltage: number,
    connectedAmps: number,
    ocpdA: number,
    distFt: number,
    typed?: { phases: 1 | 3; sets?: number; sizeOverride?: string },
  ) {
    if (connectedAmps <= 0 || distFt <= 0) return;
    const runs = typed?.sets && typed.sets > 0 ? typed.sets : autoRuns(connectedAmps, mat, cf);
    loadTypes.push({
      id,
      category: "Feeder",
      voltage,
      phases: typed?.phases ?? 3,
      kwPerPort: 0,
      runsPerUnit: runs,
      conductorsPerRun: typed?.phases === 1 ? 3 : 4,
      feederOcpdA: ocpdA,
      designAmpsOverride: connectedAmps,
      hasDataCable: false,
      materialOverride: mat,
      runsAreParallel: true,
      notes: typed ? "Distribution feeder from the schedule (intake block I)" : "Auto-generated service chain segment",
    });
    rows.push({
      id: `chain-${id}`,
      loadTypeId: id,
      location,
      units: 1,
      oneWayDistFt: distFt,
      ...(typed?.sets && typed.sets > 0 ? { runsPerUnitOverride: typed.sets } : {}),
      ...(typed?.sizeOverride ? { sizeOverride: typed.sizeOverride } : {}),
      conduitOverride: chainConduit,
      synthetic: true,
    });
  }

  // Typed distribution feeders (intake 3.7.0 block I) replace the guessed
  // switchgear → transformer → sub-panel pair. Each is sized the way the
  // sheet sizes it: the floor is the 125 %-inclusive figure (the rating of
  // the item fed, or the typed floor), so the design current is floor / cf
  // and the engine's own 125 % lands back on the floor; the OCPD is the next
  // standard device at or above it.
  const typedFeeders = (cfg.feeders ?? []).filter((f) => f.to.trim() || f.from.trim() || f.distanceFt > 0);
  function typedSegments() {
    typedFeeders.forEach((f, i) => {
      const floor = feederFloorA(f);
      segment(feederSegmentId(i, f), `${f.from.trim() || "?"} → ${f.to.trim() || "?"}`, f.voltage > 0 ? f.voltage : 480, floor / cf, 0, f.distanceFt, {
        phases: f.phases === 1 ? 1 : 3,
        sets: f.sets,
        sizeOverride: f.conductorOverride,
      });
    });
  }

  if (panel.bus480) {
    // Service entrance at 480V, carrying chargers + step-down transformer.
    segment(
      "SVC Utility→Switchgear",
      "Utility TX → Switchgear",
      480,
      panel.bus480.connectedAmps,
      panel.bus480.suggestedBusA,
      cfg.utilityToSwitchgearFt,
    );
    if (typedFeeders.length) {
      typedSegments();
    } else if (panel.transformer && panel.bus208) {
      const primaryFla = (panel.transformer.suggestedKva * 1000) / (480 * SQRT3);
      segment(
        "FDR Switchgear→TX",
        "Switchgear → Step-down TX",
        480,
        primaryFla,
        panel.transformer.primaryBreakerA,
        cfg.switchgearToTransformerFt,
      );
      const secondaryFla = (panel.transformer.suggestedKva * 1000) / (208 * SQRT3);
      segment(
        "FDR TX→Sub-panel",
        "Step-down TX → Sub-panel",
        208,
        secondaryFla,
        panel.bus208.suggestedBusA,
        cfg.transformerToSubpanelFt,
      );
    }
  } else if (panel.bus208) {
    // 208V-only site: service straight from the utility TX to the main panel.
    segment(
      "SVC Utility→Panel",
      "Utility TX → Main panel",
      208,
      panel.bus208.connectedAmps,
      panel.bus208.suggestedBusA,
      cfg.utilityToSwitchgearFt,
    );
    if (typedFeeders.length) typedSegments();
  }

  return { loadTypes, rows };
}
