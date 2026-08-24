import { defaultQuickInput } from "./autoplan";
import { defaultEquipmentItems } from "./equipment";
import { DEFAULT_LOAD_TYPES } from "./tables";
import type { FinancialInput, PeripheralsInput, Project, Setup } from "./types";

export function defaultSetup(): Setup {
  return {
    clientName: "",
    siteAddress: "",
    cpm: "",
    cra: "",
    utility: "",
    scopeOfWork: "",
    priceListSource: "Rexel",
    priceListDate: new Date().toISOString().slice(0, 10),
    feederMaterial: "Cu",
    groundingMaterial: "Cu",
    conduitType: "PVC",
    continuousLoadFactor: 1.25,
    maxVoltageDropFraction: 0.03,
    powerFactor: 1,
    wireUpsizeSteps: 0,
    conduitUpsizeSteps: 0,
    dataRatePerFt: 0.1,
    dataConduitTradeSize: '3/4"',
    trenchLengthFt: 80,
    serviceChain: {
      enabled: false,
      material: "Al",
      utilityToSwitchgearFt: 25,
      switchgearToTransformerFt: 15,
      transformerToSubpanelFt: 15,
    },
  };
}

export function defaultPeripherals(): PeripheralsInput {
  return {
    gear: [{ item: "Main switchgear", size: "1000A", voltage: "480V", qty: 1 }],
    bollardsQty: 0,
    plywoodQty: 0,
    lumberQty: 0,
    sonoTubesQty: 0,
    christyBoxQty: 0,
    gfiTestQty: 0,
    dataBoxQty: 0,
    nutsQty: 0,
    washersQty: 0,
    elbowsQty: 0,
    junctionBoxQty: 0,
    permitFeeTotal: 1000,
    utilityAppFee: 1000,
    transformerPadCost: 0,
    cableWellCost: 0,
    pullBoxQty: 0,
    pullBoxUnitCost: 0,
    utilitySandCost: 0,
    utilityVaultQty: 0,
    utilityVaultUnitCost: 0,
    dumpWasteCost: 0,
  };
}

export function defaultFinancial(): FinancialInput {
  return {
    contingencyPct: 0.1,
    laborDailyRate: 2250,
    laborBusinessDays: 30,
    applyContingencyToLabor: true,
    salesTaxPct: 0.0725,
    chargerHardwareCost: 0,
    chargerWarrantyCost: 0,
    evolvCommissioningCost: 0,
    fiveYearServiceCost: 0,
    autoCadDesignCost: 0,
    electricalEngDesignCost: 0,
    pmHours: 0,
    pmHourlyRate: 358,
    planCheckPermitFee: 0,
  };
}

export function defaultProject(): Project {
  const setup = defaultSetup();
  return {
    setup,
    takeoff: [],
    loadTypes: DEFAULT_LOAD_TYPES,
    peripherals: defaultPeripherals(),
    equipment: defaultEquipmentItems(setup.conduitType, 0),
    financial: defaultFinancial(),
    quick: defaultQuickInput(),
  };
}
