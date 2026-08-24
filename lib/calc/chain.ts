import type { PanelSchedule } from "./panel";
import { WIRE_TABLE } from "./tables";
import type { LoadType, Material, Setup, TakeoffRowInput } from "./types";

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

  function segment(
    id: string,
    location: string,
    voltage: number,
    connectedAmps: number,
    ocpdA: number,
    distFt: number,
  ) {
    if (connectedAmps <= 0 || distFt <= 0) return;
    const runs = autoRuns(connectedAmps, mat, cf);
    loadTypes.push({
      id,
      category: "Feeder",
      voltage,
      phases: 3,
      kwPerPort: 0,
      runsPerUnit: runs,
      conductorsPerRun: 4,
      feederOcpdA: ocpdA,
      designAmpsOverride: connectedAmps,
      hasDataCable: false,
      materialOverride: mat,
      runsAreParallel: true,
      notes: "Auto-generated service chain segment",
    });
    rows.push({
      id: `chain-${id}`,
      loadTypeId: id,
      location,
      units: 1,
      oneWayDistFt: distFt,
      synthetic: true,
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
    if (panel.transformer && panel.bus208) {
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
  }

  return { loadTypes, rows };
}
