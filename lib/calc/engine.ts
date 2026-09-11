import { buildServiceChain } from "./chain";
import { computeCosts, engineOverridesOf } from "./costs";
import { computeEquipment } from "./equipment";
import { computeMaterials } from "./materials";
import { computePanelSchedule } from "./panel";
import { computePeripherals } from "./peripherals";
import { computeQA } from "./qa";
import { computeRollups } from "./rollups";
import { computeTakeoffRow } from "./sizing";
import type { EstimateResult, Project } from "./types";

export function computeEstimate(project: Project): EstimateResult {
  // Pass 1: charger/manual rows size on their own; the panel schedule (buses,
  // transformer, gear) derives from them.
  const manualRows = project.takeoff
    .filter((r) => !r.synthetic)
    .map((row) => computeTakeoffRow(row, project.setup, project.loadTypes));
  const panel = computePanelSchedule(manualRows, project.loadTypes, project.setup.gearOverrides);

  // Pass 2: the service chain (utility TX -> switchgear -> step-down TX ->
  // sub-panel) is generated from the panel schedule and sized by the same
  // engine — ampacity at 125% continuous, voltage drop, parallel runs.
  const chain = buildServiceChain(panel, project.setup);
  const chainLoadTypes = [...project.loadTypes, ...chain.loadTypes];
  const chainRows = chain.rows.map((row) => computeTakeoffRow(row, project.setup, chainLoadTypes));

  const rows = [...manualRows, ...chainRows];
  const rollups = computeRollups(rows, chainLoadTypes);
  const materials = computeMaterials(rows, project.setup, rollups);
  const peripherals = computePeripherals(
    project.peripherals,
    project.setup,
    rollups,
    materials.conduitLines,
    project.peripherals.useAutoGear ? panel.suggestedGear : undefined,
  );
  const equipment = computeEquipment(project.equipment, project.setup, rollups);
  const costs = computeCosts(materials, peripherals, equipment, project.financial, engineOverridesOf(project.overrides));
  const qa = computeQA(rows, materials, rollups, project.setup);

  return { rows, rollups, materials, peripherals, equipment, costs, qa, panel };
}

export * from "./types";
export * from "./tables";
