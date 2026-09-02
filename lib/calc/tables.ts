import type {
  ConduitRow,
  GearCatalogRow,
  GroundingRow,
  LoadType,
  WireRow,
} from "./types";

// WireTable — NEC 310.16 (75C) ampacity, circular mils, Rexel price list
// (2026-03-20), conduit trade size. Carried verbatim from CPM_Clean.xlsx.
// A 0 $/ft means "no price on the vendor list" — flagged downstream, not
// silently treated as free.
export const WIRE_TABLE: WireRow[] = [
  { size: "14 AWG", circularMils: 4110, ampacityCu: 20, ampacityAl: 15, cuPerFt: 0, alPerFt: 0, conduitTradeSize: '1/2"', note: "Add price if used" },
  { size: "12 AWG", circularMils: 6530, ampacityCu: 25, ampacityAl: 20, cuPerFt: 0, alPerFt: 0, conduitTradeSize: '1/2"', note: "Add price if used" },
  { size: "10 AWG", circularMils: 10380, ampacityCu: 35, ampacityAl: 30, cuPerFt: 0.30329, alPerFt: 0.28, conduitTradeSize: '1/2"', note: "Cu = 10 STR THHN" },
  { size: "8 AWG", circularMils: 16510, ampacityCu: 50, ampacityAl: 40, cuPerFt: 0.56613, alPerFt: 0, conduitTradeSize: '3/4"', note: "Al 8 AWG price missing on vendor list" },
  { size: "6 AWG", circularMils: 26240, ampacityCu: 65, ampacityAl: 50, cuPerFt: 0.87104, alPerFt: 0.30636, conduitTradeSize: '1"' },
  { size: "4 AWG", circularMils: 41740, ampacityCu: 85, ampacityAl: 65, cuPerFt: 1.33293, alPerFt: 0.37998, conduitTradeSize: '1"' },
  { size: "3 AWG", circularMils: 52620, ampacityCu: 100, ampacityAl: 75, cuPerFt: 1.68126, alPerFt: 0.36681, conduitTradeSize: '1"', note: "Al 3 AWG priced below Al 4 AWG - verify vendor list" },
  { size: "2 AWG", circularMils: 66360, ampacityCu: 115, ampacityAl: 90, cuPerFt: 2.1044, alPerFt: 0.4821, conduitTradeSize: '1-1/4"' },
  { size: "1 AWG", circularMils: 83690, ampacityCu: 130, ampacityAl: 100, cuPerFt: 2.39833, alPerFt: 0.66733, conduitTradeSize: '1-1/4"' },
  { size: "1/0 AWG", circularMils: 105600, ampacityCu: 150, ampacityAl: 120, cuPerFt: 2.95304, alPerFt: 0.75045, conduitTradeSize: '1-1/2"' },
  { size: "2/0 AWG", circularMils: 133100, ampacityCu: 175, ampacityAl: 135, cuPerFt: 3.63758, alPerFt: 0.88701, conduitTradeSize: '1-1/2"' },
  { size: "3/0 AWG", circularMils: 167800, ampacityCu: 200, ampacityAl: 155, cuPerFt: 4.5658, alPerFt: 1.09956, conduitTradeSize: '2"' },
  { size: "4/0 AWG", circularMils: 211600, ampacityCu: 230, ampacityAl: 180, cuPerFt: 5.73045, alPerFt: 1.2278, conduitTradeSize: '2"' },
  { size: "250 kcmil", circularMils: 250000, ampacityCu: 255, ampacityAl: 205, cuPerFt: 6.64016, alPerFt: 1.49616, conduitTradeSize: '2-1/2"' },
  { size: "300 kcmil", circularMils: 300000, ampacityCu: 285, ampacityAl: 230, cuPerFt: 7.9632, alPerFt: 2.06137, conduitTradeSize: '2-1/2"' },
  { size: "350 kcmil", circularMils: 350000, ampacityCu: 310, ampacityAl: 250, cuPerFt: 9.32416, alPerFt: 2.10412, conduitTradeSize: '3"' },
  { size: "400 kcmil", circularMils: 400000, ampacityCu: 335, ampacityAl: 270, cuPerFt: 10.60671, alPerFt: 2.45797, conduitTradeSize: '3"' },
  { size: "450 kcmil", circularMils: 450000, ampacityCu: 355, ampacityAl: 290, cuPerFt: 11.334, alPerFt: 2.589, conduitTradeSize: '3"', note: "450 kcmil is NOT in NEC 310.16 - ampacity interpolated, verify. Al $/ft interpolated between the 400/500 kcmil vendor prices" },
  { size: "500 kcmil", circularMils: 500000, ampacityCu: 380, ampacityAl: 310, cuPerFt: 13.30059, alPerFt: 2.7204, conduitTradeSize: '3"' },
  { size: "600 kcmil", circularMils: 600000, ampacityCu: 420, ampacityAl: 340, cuPerFt: 16.57382, alPerFt: 3.44354, conduitTradeSize: '4"', note: "4 in shown for 4 XHHW conductors; 3-1/2 in is adequate for 3 THHN" },
  { size: "700 kcmil", circularMils: 700000, ampacityCu: 460, ampacityAl: 375, cuPerFt: 0, alPerFt: 4.809, conduitTradeSize: '4"', note: "Cu price missing on vendor list" },
  { size: "750 kcmil", circularMils: 750000, ampacityCu: 475, ampacityAl: 385, cuPerFt: 25.921, alPerFt: 4.859, conduitTradeSize: '4"' },
  { size: "800 kcmil", circularMils: 800000, ampacityCu: 490, ampacityAl: 395, cuPerFt: 0, alPerFt: 0, conduitTradeSize: '4"', note: "Both prices missing on vendor list" },
  { size: "900 kcmil", circularMils: 900000, ampacityCu: 520, ampacityAl: 425, cuPerFt: 0, alPerFt: 7.566, conduitTradeSize: '4"', note: "Cu price missing; Al 900 priced above Al 1000 - verify" },
  { size: "1000 kcmil", circularMils: 1000000, ampacityCu: 545, ampacityAl: 445, cuPerFt: 34.398, alPerFt: 6.668, conduitTradeSize: '5"' },
];

// NEC 250.122 Table B — equipment grounding conductor by OCPD rating.
export const GROUNDING_TABLE: GroundingRow[] = [
  { ocpdA: 15, eGCcu: "14 AWG", eGCal: "12 AWG" },
  { ocpdA: 20, eGCcu: "12 AWG", eGCal: "10 AWG" },
  { ocpdA: 60, eGCcu: "10 AWG", eGCal: "8 AWG" },
  { ocpdA: 100, eGCcu: "8 AWG", eGCal: "6 AWG" },
  { ocpdA: 200, eGCcu: "6 AWG", eGCal: "4 AWG" },
  { ocpdA: 300, eGCcu: "4 AWG", eGCal: "2 AWG" },
  { ocpdA: 400, eGCcu: "3 AWG", eGCal: "1 AWG" },
  { ocpdA: 500, eGCcu: "2 AWG", eGCal: "1/0 AWG" },
  { ocpdA: 600, eGCcu: "1 AWG", eGCal: "2/0 AWG" },
  { ocpdA: 800, eGCcu: "1/0 AWG", eGCal: "3/0 AWG" },
  { ocpdA: 1000, eGCcu: "2/0 AWG", eGCal: "4/0 AWG" },
  { ocpdA: 1200, eGCcu: "3/0 AWG", eGCal: "250 kcmil" },
  { ocpdA: 1600, eGCcu: "4/0 AWG", eGCal: "350 kcmil" },
  { ocpdA: 2000, eGCcu: "250 kcmil", eGCal: "400 kcmil" },
];

// ConduitTable — EMT / PVC-40 price per ft (Rexel, 2026-03-20).
export const CONDUIT_TABLE: ConduitRow[] = [
  { tradeSize: '1/2"', emtPerFt: 0.4662, pvcPerFt: 0.2445, cementFtPerGal: 300 },
  { tradeSize: '3/4"', emtPerFt: 0.7972, pvcPerFt: 0.2912, cementFtPerGal: 200 },
  { tradeSize: '1"', emtPerFt: 1.3978, pvcPerFt: 0.4698, cementFtPerGal: 125 },
  { tradeSize: '1-1/4"', emtPerFt: 2.2649, pvcPerFt: 0.6155, cementFtPerGal: 100 },
  { tradeSize: '1-1/2"', emtPerFt: 2.7641, pvcPerFt: 0.7129, cementFtPerGal: 90 },
  { tradeSize: '2"', emtPerFt: 3.1597, pvcPerFt: 0.8897, cementFtPerGal: 60 },
  { tradeSize: '2-1/2"', emtPerFt: 4.9185, pvcPerFt: 1.396, cementFtPerGal: 50 },
  { tradeSize: '3"', emtPerFt: 6.2269, pvcPerFt: 1.7033, cementFtPerGal: 40 },
  { tradeSize: '3-1/2"', emtPerFt: 8.2239, pvcPerFt: 2.25, cementFtPerGal: 35 },
  { tradeSize: '4"', emtPerFt: 8.2746, pvcPerFt: 2.3164, cementFtPerGal: 30 },
  { tradeSize: '5"', emtPerFt: 0, pvcPerFt: 3.3106, cementFtPerGal: 10, note: "EMT price missing" },
  { tradeSize: '6"', emtPerFt: 0, pvcPerFt: 0, cementFtPerGal: 10, note: "Both prices missing — add before using 6 in conduit" },
];

// LoadTypes — charger / feeder definitions. Design min sizes reproduce the
// original workbook's selections so copper quantities don't move on known
// jobs; clear them to size purely by NEC code minimum.
export const DEFAULT_LOAD_TYPES: LoadType[] = [
  { id: "L2 Single", category: "L2", voltage: 208, phases: 1, kwPerPort: 7.7, runsPerUnit: 1, conductorsPerRun: 2, feederOcpdA: 50, designMinCu: "8 AWG", designMinAl: "6 AWG", hasDataCable: true, runsAreParallel: false, notes: "Original hardcoded 8 AWG (Cu) / 6 AWG (Al) for runs under 150 ft" },
  { id: "L2 Single 32A", category: "L2", voltage: 208, phases: 1, kwPerPort: 6.656, runsPerUnit: 1, conductorsPerRun: 2, feederOcpdA: 40, designAmpsOverride: 32, designMinCu: "8 AWG", designMinAl: "6 AWG", hasDataCable: true, runsAreParallel: false, notes: "Single-port 32A L2: one 2-pole 40A circuit (32A x 125%)" },
  { id: "L2 Single 40A", category: "L2", voltage: 208, phases: 1, kwPerPort: 8.32, runsPerUnit: 1, conductorsPerRun: 2, feederOcpdA: 50, designAmpsOverride: 40, designMinCu: "8 AWG", designMinAl: "6 AWG", hasDataCable: true, runsAreParallel: false, notes: "Single-port 40A L2 (e.g. ChargePoint CP6000 class): one 2-pole 50A circuit (40A x 125%)" },
  { id: "L2 Single 80A", category: "L2", voltage: 208, phases: 1, kwPerPort: 16.64, runsPerUnit: 1, conductorsPerRun: 2, feederOcpdA: 100, designAmpsOverride: 80, designMinCu: "8 AWG", designMinAl: "6 AWG", hasDataCable: true, runsAreParallel: false, notes: "Single-port 80A L2 (e.g. CTX-C80-240-1): one 2-pole 100A circuit (80A x 125%)" },
  { id: "L2 Dual", category: "L2", voltage: 208, phases: 1, kwPerPort: 19.2, runsPerUnit: 2, conductorsPerRun: 2, feederOcpdA: 125, unitInputAmps: 92.3, designMinCu: "8 AWG", designMinAl: "6 AWG", hasDataCable: true, runsAreParallel: false, notes: "Each port is its own circuit carrying the full port load" },
  { id: "L2 Dual 32A", category: "L2", voltage: 208, phases: 1, kwPerPort: 6.656, runsPerUnit: 2, conductorsPerRun: 2, feederOcpdA: 40, designAmpsOverride: 32, unitInputAmps: 64, designMinCu: "8 AWG", designMinAl: "6 AWG", hasDataCable: true, runsAreParallel: false, notes: "32A-per-port dual unit (e.g. the Boatman scope): each port its own 2-pole 40A circuit (32A x 125%)" },
  { id: "L2 Dual 40A", category: "L2", voltage: 208, phases: 1, kwPerPort: 8.32, runsPerUnit: 2, conductorsPerRun: 2, feederOcpdA: 50, unitInputAmps: 80, designMinCu: "8 AWG", designMinAl: "6 AWG", hasDataCable: true, runsAreParallel: false, notes: "40A-per-port dual unit (80A total input; formerly id 'L2 Dual 80A'): each port its own 2-pole 50A circuit (40A x 125%)" },
  { id: "L2 Dual 80A", category: "L2", voltage: 208, phases: 1, kwPerPort: 16.64, runsPerUnit: 2, conductorsPerRun: 2, feederOcpdA: 100, designAmpsOverride: 80, unitInputAmps: 160, designMinCu: "8 AWG", designMinAl: "6 AWG", hasDataCable: true, runsAreParallel: false, notes: "80A-per-port dual unit (160A total input; the old 'L2 Dual 80A' id meant two 40A ports — now 'L2 Dual 40A'): each port its own 2-pole 100A circuit (80A x 125%)" },
  { id: "DCFC 50kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 50, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 100, designMinCu: "1/0 AWG", designMinAl: "1 AWG", hasDataCable: true, runsAreParallel: false },
  { id: "DCFC 50kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 50, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 100, designMinCu: "1/0 AWG", designMinAl: "1 AWG", hasDataCable: true, runsAreParallel: false, portsPerUnit: 2, notes: "Dual-cable: one unit, one circuit, two billable ports sharing 50kW" },
  { id: "DCFC 60kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 60, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 100, designMinCu: "1/0 AWG", designMinAl: "1 AWG", hasDataCable: true, runsAreParallel: false },
  { id: "DCFC 60kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 60, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 100, designMinCu: "1/0 AWG", designMinAl: "1 AWG", hasDataCable: true, runsAreParallel: false, portsPerUnit: 2, notes: "Dual-cable (e.g. TP5-60 CCS1+CCS1): two billable ports sharing 60kW" },
  { id: "DCFC 100kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 100, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 200, designMinCu: "3/0 AWG", designMinAl: "250 kcmil", hasDataCable: true, runsAreParallel: false, notes: "Design min reproduces the original selection; code min is smaller" },
  { id: "DCFC 100kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 100, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 200, designMinCu: "3/0 AWG", designMinAl: "250 kcmil", hasDataCable: true, runsAreParallel: false, portsPerUnit: 2, notes: "Dual-cable: two billable ports sharing 100kW" },
  { id: "DCFC 120kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 120, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 200, designMinCu: "3/0 AWG", designMinAl: "250 kcmil", hasDataCable: true, runsAreParallel: false },
  { id: "DCFC 120kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 120, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 200, designMinCu: "3/0 AWG", designMinAl: "250 kcmil", hasDataCable: true, runsAreParallel: false, portsPerUnit: 2, notes: "Dual-cable AiO (CTX Gen3 120kW CCS1+CCS1/NACS, or CCS1+CHAdeMO): one unit, one circuit, two billable ports sharing 120kW" },
  { id: "DCFC 160kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 160, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 300, designMinCu: "300 kcmil", designMinAl: "400 kcmil", hasDataCable: true, runsAreParallel: false },
  { id: "DCFC 160kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 160, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 300, designMinCu: "300 kcmil", designMinAl: "400 kcmil", hasDataCable: true, runsAreParallel: false, portsPerUnit: 2, notes: "Dual-cable AiO (CTX Gen3 160kW): one unit, one circuit, two billable ports sharing 160kW" },
  { id: "DCFC 180kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 180, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 400, hasDataCable: true, runsAreParallel: false, notes: "No design min in original — sizes purely by code" },
  { id: "DCFC 180kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 180, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 400, hasDataCable: true, runsAreParallel: false, portsPerUnit: 2, notes: "Dual-cable (e.g. TP5-180 dual): two billable ports sharing 180kW" },
  { id: "DCFC 200kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 200, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 350, designAmpsOverride: 265, hasDataCable: true, runsAreParallel: false, notes: "Input amps per the original INPUT SHEET table (265A); original breaker was a non-standard 335A — rounded to 350A" },
  { id: "DCFC 200kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 200, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 350, designAmpsOverride: 265, hasDataCable: true, runsAreParallel: false, portsPerUnit: 2, notes: "Dual-cable: same 265A input as DCFC 200kW, two billable ports" },
  { id: "DCFC 240kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 240, runsPerUnit: 2, conductorsPerRun: 3, feederOcpdA: 400, designAmpsOverride: 320, hasDataCable: true, runsAreParallel: true, notes: "Input amps per the original INPUT SHEET table (320A, ~90% efficiency). 2 parallel sets sharing the load" },
  { id: "DCFC 240kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 240, runsPerUnit: 2, conductorsPerRun: 3, feederOcpdA: 400, designAmpsOverride: 320, hasDataCable: true, runsAreParallel: true, portsPerUnit: 2, notes: "Dual-cable AiO (CTX Gen3 240kW): same electrical as DCFC 240kW, two billable ports sharing 240kW" },
  { id: "DCFC 275kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 275, runsPerUnit: 2, conductorsPerRun: 3, feederOcpdA: 500, designAmpsOverride: 385, hasDataCable: true, runsAreParallel: true, notes: "Input amps per the original INPUT SHEET table (385A). 2 parallel sets sharing the load" },
  { id: "DCFC 275kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 275, runsPerUnit: 2, conductorsPerRun: 3, feederOcpdA: 500, designAmpsOverride: 385, hasDataCable: true, runsAreParallel: true, portsPerUnit: 2, notes: "Dual-cable: same electrical as DCFC 275kW, two billable ports" },
  { id: "DCFC 300kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 300, runsPerUnit: 2, conductorsPerRun: 3, feederOcpdA: 500, designMinCu: "250 kcmil", designMinAl: "350 kcmil", hasDataCable: true, runsAreParallel: true, notes: "2 parallel sets sharing the load" },
  { id: "DCFC 300kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 300, runsPerUnit: 2, conductorsPerRun: 3, feederOcpdA: 500, designMinCu: "250 kcmil", designMinAl: "350 kcmil", hasDataCable: true, runsAreParallel: true, portsPerUnit: 2, notes: "Dual-cable: same electrical as DCFC 300kW, two billable ports" },
  { id: "DCFC 360kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 360, runsPerUnit: 2, conductorsPerRun: 3, feederOcpdA: 600, designMinCu: "350 kcmil", designMinAl: "500 kcmil", hasDataCable: true, runsAreParallel: true, notes: "2 parallel sets sharing the load" },
  { id: "DCFC 360kW Dual", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 360, runsPerUnit: 2, conductorsPerRun: 3, feederOcpdA: 600, designMinCu: "350 kcmil", designMinAl: "500 kcmil", hasDataCable: true, runsAreParallel: true, portsPerUnit: 2, notes: "Dual-cable (e.g. HPC-360): same electrical as DCFC 360kW, two billable ports" },
  // Price-book additions (Sept 2026): models the CEO's Chargetronix book
  // carries that the original lineup lacked. Additive — existing ids and
  // their sizing are untouched. Power cabinets are the Nexus distributed
  // system's AC side; their connectors live on CTX-DST dispensers, which the
  // SKU layer prices and counts for ports (DC runs are not in the takeoff).
  { id: "DCFC 30kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 30, runsPerUnit: 1, conductorsPerRun: 3, feederOcpdA: 50, hasDataCable: true, runsAreParallel: false, notes: "TP5-30 wall-mount class: 36 A at 480 V, 50 A breaker at 125%" },
  { id: "L2 Single 48A", category: "L2", voltage: 208, phases: 1, kwPerPort: 9.984, runsPerUnit: 1, conductorsPerRun: 2, feederOcpdA: 60, designAmpsOverride: 48, designMinCu: "8 AWG", designMinAl: "6 AWG", hasDataCable: true, runsAreParallel: false, notes: "Single-port 48A L2 (CTX-C48 / CTX-R48): one 2-pole 60A circuit (48A x 125%)" },
  { id: "Power cabinet 360kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 196.5, runsPerUnit: 2, conductorsPerRun: 3, feederOcpdA: 300, designAmpsOverride: 236.4, unitInputAmps: 472.7, hasDataCable: true, runsAreParallel: false, portsPerUnit: 0, notes: "CTX-DSPB-360 Nexus power cabinet: 393 kW AC input on 2 circuits, 472.7 A total (DERIVED in the price book — confirm with Chargetronix). No connectors of its own." },
  { id: "Power cabinet 480kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 262, runsPerUnit: 2, conductorsPerRun: 3, feederOcpdA: 400, designAmpsOverride: 315.2, unitInputAmps: 630.3, hasDataCable: true, runsAreParallel: false, portsPerUnit: 0, notes: "CTX-DSPB-480 Nexus power cabinet: 524 kW AC input, 2 circuits at 315 A (PUBLISHED). Takes up to 3 dual dispensers." },
  { id: "Power cabinet 1280kW", category: "DCFC", voltage: 480, phases: 3, kwPerPort: 232.9, runsPerUnit: 6, conductorsPerRun: 3, feederOcpdA: 400, designAmpsOverride: 280.1, unitInputAmps: 1680.7, hasDataCable: true, runsAreParallel: false, portsPerUnit: 0, notes: "CTX-DSPB-1280 Nexus power cabinet: 1,397 kW AC input on 6 circuits, 1,680.7 A total (DERIVED). Takes up to 8 dual dispensers." },
  { id: "Feeder 480V", category: "Feeder", voltage: 480, phases: 3, kwPerPort: 0, runsPerUnit: 1, conductorsPerRun: 4, feederOcpdA: 400, hasDataCable: false, materialOverride: "Al", runsAreParallel: false, notes: "Gear-to-gear feeder. Leave kW at 0 and size on the Takeoff override, or enter kW served." },
  { id: "Feeder 208V", category: "Feeder", voltage: 208, phases: 3, kwPerPort: 0, runsPerUnit: 1, conductorsPerRun: 4, feederOcpdA: 400, hasDataCable: false, materialOverride: "Al", runsAreParallel: false, notes: "Transformer secondary / sub-panel feeder" },
];

export const GEAR_CATALOG: GearCatalogRow[] = [
  // Main switchgear 480V: the shop's own budgetary ladder. 2000A/2500A were
  // re-set Aug 2026 to fix the old price inversion (2500A had been priced
  // below the 2000A unit); every other size is the original list. NOARK MxS
  // assembled-budgetary comparison research is on file (memory:
  // switchgear-price-research) — RFQ NOARK Pomona or Butcher Power Products
  // for real quotes before contract.
  { item: "Main switchgear", size: "400A", voltage: "480V", unitCost: 20426.82 },
  { item: "Main switchgear", size: "800A", voltage: "480V", unitCost: 31187 },
  { item: "Main switchgear", size: "1000A", voltage: "480V", unitCost: 36812.5 },
  { item: "Main switchgear", size: "1200A", voltage: "480V", unitCost: 43292.68 },
  { item: "Main switchgear", size: "1600A", voltage: "480V", unitCost: 56750 },
  { item: "Main switchgear", size: "2000A", voltage: "480V", unitCost: 55000, note: "Re-set Aug 2026 (was $60k) — keeps the ladder monotonic" },
  { item: "Main switchgear", size: "2500A", voltage: "480V", unitCost: 60000, note: "Re-set Aug 2026 (was $58.5k, priced below the 2000A unit)" },
  { item: "Main switchgear", size: "3000A", voltage: "480V", unitCost: 65000 },
  { item: "Main switchgear", size: "4000A", voltage: "480V", unitCost: 67500 },
  { item: "Main switchgear", size: "5000A", voltage: "480V", unitCost: 70000 },
  { item: "Main switchgear", size: "350A", voltage: "208V", unitCost: 0, note: "No price on original list" },
  { item: "Main breaker", size: "110A", voltage: "480V", unitCost: 0, note: "No price on original list" },
  { item: "Main breaker", size: "125A", voltage: "480V", unitCost: 0, note: "No price on original list" },
  { item: "Main breaker", size: "250A", voltage: "480V", unitCost: 0, note: "No price on original list" },
  { item: "Main breaker", size: "300A", voltage: "480V", unitCost: 1200 },
  { item: "Main breaker", size: "400A", voltage: "208V", unitCost: 0, note: "No price on original list" },
  { item: "Main breaker", size: "600A", voltage: "208V", unitCost: 0, note: "No price on original list" },
  { item: "Branch breaker", size: "40A", voltage: "208V", unitCost: 60 },
  { item: "Branch breaker", size: "50A", voltage: "208V", unitCost: 75, note: "Budgetary — verify vendor quote" },
  { item: "Branch breaker", size: "60A", voltage: "208V", unitCost: 90, note: "Budgetary — verify vendor quote" },
  { item: "Branch breaker", size: "100A", voltage: "480V", unitCost: 350, note: "Budgetary — no price on original list" },
  { item: "Branch breaker", size: "125A", voltage: "480V", unitCost: 420, note: "Budgetary — verify vendor quote" },
  { item: "Branch breaker", size: "150A", voltage: "480V", unitCost: 480, note: "Budgetary — verify vendor quote" },
  { item: "Branch breaker", size: "175A", voltage: "480V", unitCost: 550, note: "Budgetary — verify vendor quote" },
  { item: "Branch breaker", size: "200A", voltage: "480V", unitCost: 650, note: "Budgetary — no price on original list" },
  { item: "Branch breaker", size: "225A", voltage: "480V", unitCost: 700, note: "Budgetary — verify vendor quote" },
  { item: "Branch breaker", size: "250A", voltage: "480V", unitCost: 750, note: "Budgetary — verify vendor quote" },
  { item: "Branch breaker", size: "300A", voltage: "480V", unitCost: 800 },
  { item: "Branch breaker", size: "350A", voltage: "480V", unitCost: 1000, note: "Budgetary — verify vendor quote" },
  { item: "Branch breaker", size: "400A", voltage: "480V", unitCost: 1200, note: "Budgetary — verify vendor quote" },
  { item: "Branch breaker", size: "500A", voltage: "480V", unitCost: 1800, note: "Budgetary — no price on original list" },
  { item: "Branch breaker", size: "600A", voltage: "480V", unitCost: 2200, note: "Budgetary — no price on original list" },
  { item: "Transformer", size: "75KVA", voltage: "208V", unitCost: 2970 },
  { item: "Transformer", size: "112.5KVA", voltage: "208V", unitCost: 3250 },
  { item: "Transformer", size: "150KVA", voltage: "208V", unitCost: 5298 },
  { item: "Transformer", size: "175KVA", voltage: "208V", unitCost: 6000 },
  { item: "Transformer", size: "225KVA", voltage: "208V", unitCost: 7144 },
  { item: "Transformer", size: "300KVA", voltage: "208V", unitCost: 10493 },
  { item: "Transformer", size: "500KVA", voltage: "208V", unitCost: 14500 },
  { item: "Sub-panel", size: "150A", voltage: "208V", unitCost: 1000 },
  { item: "Sub-panel", size: "250A", voltage: "208V", unitCost: 1120 },
  { item: "Sub-panel", size: "400A", voltage: "208V", unitCost: 1660 },
  { item: "Sub-panel", size: "600A", voltage: "208V", unitCost: 5387 },
  { item: "Sub-panel", size: "800A", voltage: "208V", unitCost: 4650, note: "Priced below the 600A unit — verify" },
  { item: "Distribution panel", size: "1000A", voltage: "208V", unitCost: 30000 },
  { item: "Meter socket", size: "600A", voltage: "208V", unitCost: 1786 },
  { item: "Disconnect", size: "300A", voltage: "208V", unitCost: 1700 },
];

// NEC 240.6(A) standard OCPD ratings, plus the large frame sizes the gear
// catalog carries.
export const STANDARD_BREAKERS_A: number[] = [
  15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175,
  200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000, 1200, 1600,
  2000, 2500, 3000, 4000, 5000,
];

/** Smallest value in `sizes` that is >= amps; falls back to the largest size. */
export function nextStandardSize(sizes: number[], amps: number): number {
  for (const s of sizes) if (s >= amps) return s;
  return sizes[sizes.length - 1];
}

export function findLoadType(loadTypes: LoadType[], id: string): LoadType | undefined {
  return loadTypes.find((l) => l.id === id);
}

export function wireIndexBySize(size: string): number {
  return WIRE_TABLE.findIndex((w) => w.size === size);
}
