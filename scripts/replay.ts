/**
 * Replays two real RFC_V18 projects through the estimator engine using ONLY
 * values read off their INPUT SHEET / CPM Calcs tabs, then prints our numbers
 * next to the workbook's own numbers for comparison.
 *
 *   npx tsx scripts/replay.ts
 *
 * Sources:
 *  - I-271839 Boatman:   6x 100kW DCFC + 10x 32A dual-port L2 + 4 gear feeders
 *  - L-11101 VN Village: 6x 100kW DCFC, no L2, no feeder runs
 */
import { computeEstimate } from "../lib/calc/engine";
import { defaultFinancial, defaultSetup } from "../lib/calc/defaults";
import { DEFAULT_LOAD_TYPES } from "../lib/calc/tables";
import type { EquipmentRentalItem, LoadType, PeripheralsInput, Project, TakeoffRowInput } from "../lib/calc/types";

// The Boatman feeder block mixes materials: two aluminium 600kcmil runs and
// two copper runs (4/0 and 350kcmil). Our stock "Feeder 480V" forces Al, so a
// copper variant is declared here.
const FEEDER_CU: LoadType = {
  id: "Feeder 480V Cu",
  category: "Feeder",
  voltage: 480,
  phases: 3,
  kwPerPort: 0,
  runsPerUnit: 1,
  conductorsPerRun: 4,
  feederOcpdA: 400,
  hasDataCable: false,
  runsAreParallel: false,
};

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function report(name: string, project: Project, theirs: Record<string, number>) {
  const r = computeEstimate(project);
  console.log(`\n${"=".repeat(70)}\n${name}\n${"=".repeat(70)}`);

  console.log("\n-- Takeoff sizing (per run) --");
  for (const row of r.rows) {
    console.log(
      `  ${row.location.padEnd(18)} ${String(row.oneWayDistFt).padStart(4)} ft  ` +
        `${(row.selectedWire || "—").padEnd(10)} ${row.material}  gnd ${(row.groundSize || "—").padEnd(8)} ` +
        `cond ${(row.conduitSize || "—").padEnd(7)} $${row.rowTotal.toFixed(2).padStart(9)}  ${row.flag}`,
    );
  }

  console.log("\n-- Our buckets --");
  const ours: Record<string, number> = {
    "Materials (wire+gnd+conduit+data)": r.materials.grandTotal,
    "Hardware & consumables": r.peripherals.hardwareSubtotal,
    "Main switchgear": r.peripherals.gearMainSwitchgear,
    "Sub-panels / transformers / breakers": r.peripherals.gearOtherTotal,
    "Signage & striping (incl. striping)": r.peripherals.signageSubtotal,
    "Trenching / asphalt": r.peripherals.asphaltTrenching,
    ADA: r.peripherals.adaAllowance,
    "Concrete improvements bucket": r.peripherals.concreteImprovements,
    "Dump / waste": r.peripherals.dumpWaste,
    Permits: r.peripherals.permitsSubtotal,
    Utility: r.peripherals.utilitySubtotal,
    Equipment: r.equipment.subtotal,
  };
  for (const [k, v] of Object.entries(ours)) console.log(`  ${k.padEnd(40)} ${fmt(v)}`);
  console.log(`  ${"— construction total (pre-contingency)".padEnd(40)} ${fmt(Object.values(ours).reduce((a, b) => a + b, 0))}`);
  console.log(`  ${"— with 10% contingency".padEnd(40)} ${fmt(r.costs.electricalSupplyConstructionTotal)}`);

  console.log("\n-- Their workbook --");
  for (const [k, v] of Object.entries(theirs)) console.log(`  ${k.padEnd(40)} ${fmt(v)}`);

  console.log("\n-- QA flags --");
  for (const q of r.qa.filter((q) => !q.ok)) console.log(`  ⚠ ${q.label}: ${q.detail}`);

  console.log("\n-- Panel schedule --");
  if (r.panel.bus480) console.log(`  480V: connected ${r.panel.bus480.connectedAmps.toFixed(1)}A, demand ${r.panel.bus480.demandAmps.toFixed(1)}A -> ${r.panel.bus480.suggestedBusA}A switchgear`);
  if (r.panel.bus208) console.log(`  208V: connected ${r.panel.bus208.connectedAmps.toFixed(1)}A, demand ${r.panel.bus208.demandAmps.toFixed(1)}A -> ${r.panel.bus208.suggestedBusA}A panel`);
  if (r.panel.transformer) console.log(`  TX:   ${r.panel.transformer.connectedKva.toFixed(1)} kVA -> ${r.panel.transformer.suggestedKva} kVA`);
  return r;
}

// ---------------------------------------------------------------- Boatman

const boatmanTakeoff: TakeoffRowInput[] = [
  ...[55, 60, 80, 85, 125, 135].map((d, i) => ({
    id: `l3-${i + 1}`, loadTypeId: "DCFC 100kW", location: `L3 chgr ${i + 1}`, units: 1, oneWayDistFt: d,
  })),
  ...[30, 40, 60, 80, 100, 120, 140, 160, 180, 200].map((d, i) => ({
    id: `l2-${i + 1}`, loadTypeId: "L2 Dual 32A", location: `L2 chgr ${i + 1}`, units: 1, oneWayDistFt: d,
  })),
  { id: "f1", loadTypeId: "Feeder 480V", location: "Pole - TX", units: 1, oneWayDistFt: 40, runsPerUnitOverride: 2, sizeOverride: "600 kcmil" },
  { id: "f2", loadTypeId: "Feeder 480V", location: "TX - SG", units: 1, oneWayDistFt: 100, runsPerUnitOverride: 5, sizeOverride: "600 kcmil" },
  { id: "f3", loadTypeId: "Feeder 480V Cu", location: "SG - Tx", units: 1, oneWayDistFt: 20, runsPerUnitOverride: 1, sizeOverride: "4/0 AWG" },
  { id: "f4", loadTypeId: "Feeder 480V Cu", location: "Tx - sub", units: 1, oneWayDistFt: 140, runsPerUnitOverride: 2, sizeOverride: "350 kcmil" },
];

const boatmanPeripherals: PeripheralsInput = {
  gear: [
    { item: "Main switchgear", size: "1600A", voltage: "480V", qty: 1 },
    { item: "Sub-panel", size: "600A", voltage: "208V", qty: 1 },
    { item: "Transformer", size: "150KVA", voltage: "208V", qty: 1 },
  ],
  nutsQty: 400,
  washersQty: 400,
  elbowsQty: 6,
  junctionBoxQty: 4,
  dataBoxQty: 0,
  plywoodQty: 6,
  lumberQty: 6,
  sonoTubesQty: 22,
  christyBoxQty: 0,
  gfiTestQty: 1,
  gfiTestUnitCost: 4000,
  bollardsQty: 54,
  customItems: [
    { name: "Screws & bolts", qty: 1, unitCost: 182.73 },
    { name: "X-ray / GPR scanning", qty: 1, unitCost: 2000 },
    { name: "Uni strut", qty: 8, unitCost: 55 },
    { name: "PVC bushings", qty: 1, unitCost: 11.06 },
    { name: "Ground rod clamps", qty: 10, unitCost: 7.22 },
    { name: "Combo locks", qty: 2, unitCost: 337.73 },
    { name: "Tape / marking supplies", qty: 1, unitCost: 125.57 },
    { name: "Cutting / saw consumables", qty: 2, unitCost: 535.16 },
    { name: "Misc electrical hardware", qty: 4, unitCost: 217.5 },
    { name: "Form stakes", qty: 20, unitCost: 8.63 },
    { name: "Wire dobies", qty: 50, unitCost: 1.18 },
    { name: "SG sign", qty: 1, unitCost: 130 },
    { name: "Steel mesh roll", qty: 2, unitCost: 169 },
  ],
  adaQtyOverride: 4,
  adaUnitCost: 4900,
  adaRampCost: 5200,
  permitFeeTotal: 2000,
  utilityAppFee: 46500,
  transformerPadCost: 1663,
  cableWellCost: 495,
  pullBoxQty: 0,
  pullBoxUnitCost: 0,
  utilitySandCost: 420,
  utilityVaultQty: 0,
  utilityVaultUnitCost: 0,
  dumpWasteCost: 4000,
};

const boatmanEquipment: EquipmentRentalItem[] = [
  { name: "Temporary fencing", qty: 0, rate: 2.95, rateBasis: "per ft per week", durationValue: 2, delivery: 800 }, // qty auto
  { name: "Mini excavator", qty: 1, rate: 2110, rateBasis: "per month", durationValue: 1, delivery: 0 },
  { name: "Storage container", qty: 1, rate: 185, rateBasis: "per month", durationValue: 10, delivery: 0 },
  { name: "Portable restroom", qty: 1, rate: 267, rateBasis: "per month", durationValue: 5, delivery: 65 },
  { name: "Saw cutter", qty: 1, rate: 169, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Jack hammer", qty: 1, rate: 155, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Compactor", qty: 1, rate: 175, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Generator rental", qty: 1, rate: 220, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Dump trailer rental", qty: 1, rate: 796.63, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Equipment protection", qty: 1, rate: 45, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Skidsteer rental", qty: 1, rate: 750, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Telehandler rental", qty: 1, rate: 1410, rateBasis: "per day", durationValue: 2, delivery: 400 },
];

const boatmanSetup = { ...defaultSetup(), clientName: "I-271839 Boatman", utility: "PG&E", trenchLengthFt: 325 };

const boatman: Project = {
  setup: boatmanSetup,
  takeoff: boatmanTakeoff,
  loadTypes: [...DEFAULT_LOAD_TYPES, FEEDER_CU],
  peripherals: boatmanPeripherals,
  equipment: boatmanEquipment,
  financial: defaultFinancial(),
};

report("BOATMAN (I-271839) — 6x 100kW DCFC + 10x 32A dual L2 + 4 feeders", boatman, {
  "Y27 wires/conduit/CAT5-conduit": 34909.24,
  "N82 peripherals (incl CAT5 cable)": 14858.06,
  "R73 main switchgear": 56750,
  "Y75 subpanel+transformer": 10685,
  "G92 signage (no striping)": 7439.3,
  "O104 asphalt + striping": 17163.25,
  "O98 concrete+rebar+mesh": 7711.18,
  "O110 ADA (4 stalls + ramp)": 24800,
  "J99 dump/waste": 4000,
  "I92 permits": 2000,
  "O92 utility": 49078,
  "J92 equipment": 13990.63,
  "G14 construction total w/ contingency": 267723.12,
});

// ---------------------------------------------------------------- VN Village

const vnTakeoff: TakeoffRowInput[] = [25, 45, 45, 65, 70, 100].map((d, i) => ({
  id: `l3-${i + 1}`, loadTypeId: "DCFC 100kW", location: `L3 chgr ${i + 1}`, units: 1, oneWayDistFt: d,
}));

const vnPeripherals: PeripheralsInput = {
  gear: [{ item: "Main switchgear", size: "1000A", voltage: "480V", qty: 1 }],
  nutsQty: 400,
  washersQty: 400,
  elbowsQty: 6,
  junctionBoxQty: 4,
  dataBoxQty: 0,
  plywoodQty: 6,
  lumberQty: 6,
  sonoTubesQty: 22,
  christyBoxQty: 0,
  gfiTestQty: 1,
  gfiTestUnitCost: 2500,
  bollardsQty: 24,
  customItems: [
    { name: "Screws & bolts", qty: 1, unitCost: 182.73 },
    { name: "Sweeps", qty: 4, unitCost: 75 },
    { name: "GPR scan", qty: 1, unitCost: 2500 },
    { name: "Uni strut", qty: 6, unitCost: 55 },
    { name: "PVC bushing", qty: 1, unitCost: 7.22 },
    { name: "PVC bushing (2)", qty: 1, unitCost: 11.06 },
    { name: "Ground rod clamps", qty: 7, unitCost: 7.22 },
    { name: "Combo locks", qty: 2, unitCost: 337.73 },
    { name: "Tape / marking supplies", qty: 1, unitCost: 125.57 },
    { name: "Cutting / saw consumables", qty: 1, unitCost: 535.16 },
    { name: "Misc electrical hardware", qty: 1, unitCost: 217.5 },
    { name: "Form stakes", qty: 20, unitCost: 8.63 },
    { name: "Wire dobies", qty: 50, unitCost: 1.18 },
    { name: "SG sign", qty: 1, unitCost: 150 },
    { name: "Steel mesh roll", qty: 2, unitCost: 169 },
  ],
  adaQtyOverride: 2,
  adaUnitCost: 4900,
  adaRampCost: 5200,
  permitFeeTotal: 2500,
  utilityAppFee: 5000,
  transformerPadCost: 0,
  cableWellCost: 0,
  pullBoxQty: 0,
  pullBoxUnitCost: 0,
  utilitySandCost: 0,
  utilityVaultQty: 0,
  utilityVaultUnitCost: 0,
  dumpWasteCost: 3000,
};

const vnEquipment: EquipmentRentalItem[] = [
  { name: "Temporary fencing", qty: 0, rate: 2.95, rateBasis: "per ft per week", durationValue: 2, delivery: 800 },
  { name: "Mini excavator", qty: 1, rate: 2957, rateBasis: "per month", durationValue: 1, delivery: 0 },
  { name: "Storage container", qty: 1, rate: 185, rateBasis: "per month", durationValue: 5, delivery: 0 },
  { name: "Portable restroom", qty: 1, rate: 267, rateBasis: "per month", durationValue: 1, delivery: 65 },
  { name: "Saw cutter", qty: 1, rate: 169, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Jack hammer", qty: 1, rate: 155, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Compactor", qty: 1, rate: 175, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Generator rental", qty: 1, rate: 220, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Dump trailer rental", qty: 1, rate: 796.63, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Equipment protection", qty: 1, rate: 45, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Skidsteer rental", qty: 1, rate: 750, rateBasis: "per day", durationValue: 1, delivery: 0 },
  { name: "Telehandler rental", qty: 1, rate: 1410, rateBasis: "per day", durationValue: 2, delivery: 400 },
];

const vn: Project = {
  setup: { ...defaultSetup(), clientName: "L-11101 VN Village Center", trenchLengthFt: 170 },
  takeoff: vnTakeoff,
  loadTypes: DEFAULT_LOAD_TYPES,
  peripherals: vnPeripherals,
  equipment: vnEquipment,
  financial: defaultFinancial(),
};

report("VN VILLAGE CENTER (L-11101) — 6x 100kW DCFC only", vn, {
  "Y27 wires/conduit/CAT5-conduit": 5512.27,
  "N82 peripherals (incl CAT5 cable)": 10398.25,
  "R73 main switchgear (typed 36,813)": 36813,
  "Y75 subpanel+transformer": 0,
  "G92 signage (no striping)": 3198.3,
  "O104 asphalt + striping": 7837.7,
  "O98 concrete+rebar+mesh": 5205.65,
  "O110 ADA (2 stalls + ramp)": 15000,
  "J99 dump/waste": 3000,
  "I92 permits": 2500,
  "O92 utility (contract fees)": 5000,
  "J92 equipment": 12484.63,
  "G15 construction total (w/ hidden +10% and contingency)": 129409.26,
});
