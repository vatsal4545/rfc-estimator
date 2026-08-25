import {
  CONDUIT_TABLE,
  GROUNDING_TABLE,
  STANDARD_BREAKERS_A,
  WIRE_TABLE,
  findLoadType,
  nextStandardSize,
} from "./tables";
import type {
  LoadType,
  Material,
  Setup,
  TakeoffRowComputed,
  TakeoffRowInput,
} from "./types";

const SQRT3 = Math.sqrt(3);

/**
 * Index of the first WireTable row whose ampacity/circular-mils is >= target,
 * 1-based. Returns table-length + 1 (26) when the target exceeds every row —
 * callers treat that as "cannot size, needs parallel runs" rather than
 * silently substituting the largest conductor.
 */
function firstIndexAtLeast(values: number[], target: number): number {
  if (target === 0) return 0;
  let count = 0;
  for (const v of values) if (v < target) count++;
  return count + 1;
}

function ampacityColumn(material: Material): number[] {
  return WIRE_TABLE.map((w) => (material === "Cu" ? w.ampacityCu : w.ampacityAl));
}

function circularMilsColumn(): number[] {
  return WIRE_TABLE.map((w) => w.circularMils);
}

function wireSizeAtIndex(idx: number): string {
  if (idx <= 0) return "";
  return WIRE_TABLE[Math.min(25, idx) - 1].size;
}

function wirePricePerFt(size: string, material: Material): number {
  const row = WIRE_TABLE.find((w) => w.size === size);
  if (!row) return 0;
  return material === "Cu" ? row.cuPerFt : row.alPerFt;
}

function groundSizeForOcpd(ocpdA: number, material: Material): string {
  if (ocpdA === 0) return "";
  let count = 0;
  for (const g of GROUNDING_TABLE) if (g.ocpdA < ocpdA) count++;
  const idx = Math.min(14, count + 1);
  const row = GROUNDING_TABLE[idx - 1];
  if (!row) return "";
  return material === "Cu" ? row.eGCcu : row.eGCal;
}

function conduitTradeSizeForWire(wireSize: string, upsizeSteps: number): string {
  const wireRow = WIRE_TABLE.find((w) => w.size === wireSize);
  if (!wireRow) return "";
  const baseIdx = CONDUIT_TABLE.findIndex((c) => c.tradeSize === wireRow.conduitTradeSize);
  if (baseIdx === -1) return "";
  const idx = Math.min(12, baseIdx + 1 + upsizeSteps);
  return CONDUIT_TABLE[Math.max(1, idx) - 1]?.tradeSize ?? "";
}

function conduitPricePerFt(tradeSize: string, conduitType: "PVC" | "EMT"): number {
  const row = CONDUIT_TABLE.find((c) => c.tradeSize === tradeSize);
  if (!row) return 0;
  return conduitType === "PVC" ? row.pvcPerFt : row.emtPerFt;
}

export function computeTakeoffRow(
  input: TakeoffRowInput,
  setup: Setup,
  loadTypes: LoadType[],
): TakeoffRowComputed {
  const lt = findLoadType(loadTypes, input.loadTypeId);
  const base = {
    ...input,
  };

  if (!lt) {
    return {
      ...base,
      category: "",
      material: setup.feederMaterial,
      volts: 0,
      phases: 1,
      resolvedRunsPerUnit: 0,
      condPerRun: 0,
      ocpdA: 0,
      designAmps: 0,
      contAmps: 0,
      cmReqdVD: 0,
      idxAmp: 0,
      idxVD: 0,
      idxDesignMin: 0,
      selectedWire: "",
      wireFt: 0,
      wireCostPerFt: 0,
      wireCost: 0,
      groundSize: "",
      groundFt: 0,
      groundCostPerFt: 0,
      groundCost: 0,
      conduitSize: "",
      conduitFt: 0,
      conduitCostPerFt: 0,
      conduitCost: 0,
      dataFt: 0,
      dataCost: 0,
      rowTotal: 0,
      flag: "Load type not on the LoadTypes sheet",
    };
  }

  const runsPerUnit = input.runsPerUnitOverride ?? lt.runsPerUnit;
  const material: Material = lt.materialOverride ?? setup.feederMaterial;
  const groundMaterial: Material = setup.groundingMaterial;
  const volts = lt.voltage;
  const phases = lt.phases;
  const condPerRun = lt.conductorsPerRun;

  const designAmps =
    lt.designAmpsOverride ??
    (lt.kwPerPort === 0
      ? 0
      : (lt.kwPerPort * 1000) / (volts * setup.powerFactor * (phases === 3 ? SQRT3 : 1)));

  // Parallel-capable: multiple runs land on ONE input and split the current
  // (DCFC and feeders — a 2nd run halves amps per set, so smaller wire and
  // less voltage drop). L2 runs are one circuit per port: more runs never
  // split the load there, they'd just be extra circuits.
  const parallelCapable = lt.runsAreParallel || lt.category !== "L2";
  const parallelDivisor = parallelCapable ? runsPerUnit : 1;

  // OCPD left at 0 on the LoadType means auto-size: next standard breaker at
  // or above 125% of the circuit current (NEC 625.41 continuous load). A
  // parallel set is ONE circuit behind ONE breaker (240.8 forbids paralleled
  // breakers), so the OCPD sizes on the FULL design current — only the
  // per-conductor wire sizing divides by the parallel runs.
  const autoOcpdA =
    lt.feederOcpdA > 0
      ? lt.feederOcpdA
      : designAmps > 0
        ? nextStandardSize(STANDARD_BREAKERS_A, designAmps * setup.continuousLoadFactor)
        : 0;
  const ocpdOverridden = input.ocpdOverrideA !== undefined && input.ocpdOverrideA > 0;
  const ocpdA = ocpdOverridden ? input.ocpdOverrideA! : autoOcpdA;

  const contAmps =
    input.units === 0 || runsPerUnit === 0
      ? 0
      : (designAmps / parallelDivisor) * setup.continuousLoadFactor;

  const cmReqdVD =
    designAmps === 0 || input.oneWayDistFt === 0 || runsPerUnit === 0
      ? 0
      : (phases === 3 ? SQRT3 : 2) *
        (material === "Cu" ? 12.9 : 21.2) *
        (designAmps / parallelDivisor) *
        input.oneWayDistFt /
        (volts * setup.maxVoltageDropFraction);

  const idxAmp = firstIndexAtLeast(ampacityColumn(material), contAmps);
  const idxVD = firstIndexAtLeast(circularMilsColumn(), cmReqdVD);

  const designMinSize = material === "Cu" ? lt.designMinCu : lt.designMinAl;
  const idxDesignMin = designMinSize
    ? WIRE_TABLE.findIndex((w) => w.size === designMinSize) + 1
    : 0;

  const maxIdx = Math.max(idxAmp, idxVD, idxDesignMin);
  // Overflow: the load needs more than the largest cataloged conductor —
  // refuse to size (and price) rather than quietly using 1000 kcmil.
  const exceedsTable = idxAmp > 25 || idxVD > 25;
  // A size override must exist in the wire table; a typo ("3/0" vs "3/0 AWG")
  // would otherwise silently zero the wire AND conduit cost for the row.
  const overrideValid =
    input.sizeOverride !== undefined && WIRE_TABLE.some((w) => w.size === input.sizeOverride);
  const selectedWire = overrideValid
    ? input.sizeOverride!
    : exceedsTable || maxIdx === 0
      ? ""
      : wireSizeAtIndex(Math.min(25, maxIdx + setup.wireUpsizeSteps));

  const wireFt = selectedWire === "" ? 0 : input.units * runsPerUnit * condPerRun * input.oneWayDistFt;
  const wireCostPerFt = selectedWire ? wirePricePerFt(selectedWire, material) : 0;
  const wireCost = wireFt * wireCostPerFt;

  const groundSize = ocpdA === 0 ? "" : groundSizeForOcpd(ocpdA, groundMaterial);
  const groundFt = selectedWire === "" ? 0 : input.units * runsPerUnit * input.oneWayDistFt;
  const groundCostPerFt = groundSize ? wirePricePerFt(groundSize, groundMaterial) : 0;
  const groundCost = groundFt * groundCostPerFt;

  const conduitMaterial = input.conduitOverride ?? setup.conduitType;
  const conduitSize = selectedWire === "" ? "" : conduitTradeSizeForWire(selectedWire, setup.conduitUpsizeSteps);
  const conduitFt = selectedWire === "" ? 0 : input.units * runsPerUnit * input.oneWayDistFt;
  const conduitCostPerFt = conduitSize ? conduitPricePerFt(conduitSize, conduitMaterial) : 0;
  const conduitCost = conduitFt * conduitCostPerFt;

  const dataFt = lt.hasDataCable ? input.units * input.oneWayDistFt : 0;
  const dataConduitPerFt = conduitPricePerFt(setup.dataConduitTradeSize, conduitMaterial);
  const dataCost = dataFt * (setup.dataRatePerFt + dataConduitPerFt);

  const rowTotal = wireCost + groundCost + conduitCost + dataCost;

  // One breaker serves the whole (possibly paralleled) circuit, so both
  // bounds check against the FULL design current and the combined ampacity.
  const reqOcpdA = designAmps * setup.continuousLoadFactor;
  const wireRowSel = WIRE_TABLE.find((w) => w.size === selectedWire);
  const wireAmpacityTotal = wireRowSel
    ? (material === "Cu" ? wireRowSel.ampacityCu : wireRowSel.ampacityAl) *
      (parallelCapable ? runsPerUnit : 1)
    : 0;
  // NEC 240.4(B): the OCPD may round up to the next standard size above the
  // conductor ampacity — anything beyond that leaves the wire unprotected.
  const maxOcpdForWire =
    wireAmpacityTotal > 0 ? nextStandardSize(STANDARD_BREAKERS_A, wireAmpacityTotal) : 0;

  let flag = "OK";
  if (selectedWire === "" && exceedsTable) {
    flag = "Exceeds conductor table - use parallel runs";
  } else if (selectedWire === "") {
    flag = "Cannot size - set kW on LoadTypes or enter a Size override";
  } else if (ocpdOverridden && designAmps > 0 && ocpdA < reqOcpdA) {
    flag = `Breaker override ${ocpdA}A is below 125% of continuous load (${Math.ceil(reqOcpdA)}A required, NEC 625.41)`;
  } else if (ocpdOverridden && maxOcpdForWire > 0 && ocpdA > maxOcpdForWire) {
    flag = `Breaker override ${ocpdA}A exceeds the ${selectedWire} conductor's protection limit (${maxOcpdForWire}A max, NEC 240.4) - upsize the wire`;
  } else if (input.sizeOverride && !overrideValid) {
    flag = `Invalid size override "${input.sizeOverride}" - auto-sized to ${selectedWire}`;
  } else if (wireCostPerFt === 0) {
    flag = `No ${material} price for ${selectedWire}`;
  } else if (groundSize && groundCostPerFt === 0) {
    flag = `No price for ground conductor ${groundSize}`;
  } else if (conduitSize && conduitCostPerFt === 0) {
    flag = `No price for ${conduitSize} conduit`;
  } else if (exceedsTable) {
    flag = "Exceeds conductor table - use parallel runs";
  } else if (idxVD > idxAmp) {
    // The wire was upsized to hold voltage sag under the Setup limit, not for
    // current. On parallel-capable runs an extra run splits the amps and can
    // beat the fatter wire on cost; on per-port circuits (L2) more runs
    // wouldn't help — the upsized wire is simply the price of the distance.
    flag = parallelCapable
      ? "Voltage drop governs - add a parallel run (Runs column) or keep the upsized wire"
      : "Voltage drop governs - wire upsized for the long run";
  } else if (overrideValid && input.sizeOverride !== wireSizeAtIndex(Math.max(1, Math.min(25, maxIdx)))) {
    flag = "Manual override in use";
  } else if (idxDesignMin > Math.max(idxAmp, idxVD)) {
    flag = `Design min governs; code min is ${wireSizeAtIndex(Math.max(1, Math.max(idxAmp, idxVD)))}`;
  }

  return {
    ...base,
    category: lt.category,
    material,
    volts,
    phases,
    resolvedRunsPerUnit: runsPerUnit,
    condPerRun,
    ocpdA,
    designAmps,
    contAmps,
    cmReqdVD,
    idxAmp,
    idxVD,
    idxDesignMin,
    selectedWire,
    wireFt,
    wireCostPerFt,
    wireCost,
    groundSize,
    groundFt,
    groundCostPerFt,
    groundCost,
    conduitSize,
    conduitFt,
    conduitCostPerFt,
    conduitCost,
    dataFt,
    dataCost,
    rowTotal,
    flag,
  };
}
