import { describe, expect, it } from "vitest";
import { defaultFinancial, defaultSetup } from "../defaults";
import { defaultEquipmentItems } from "../equipment";
import { computeEstimate } from "../engine";
import { DEFAULT_LOAD_TYPES, GEAR_CATALOG } from "../tables";
import type { PeripheralsInput, Project, TakeoffRowInput } from "../types";

// Golden-master fixture: the "H-00087 Bartell Hotels / The Dana" project
// baked into CPM_Clean.xlsx (6ea DCFC 100kW chargers + 2 gear-feeder runs).
// Every expected number below was read directly off the workbook's own
// computed cells (not re-derived), so this test catches any drift between
// this TypeScript port and the spreadsheet it replaces.

function bartellProject(): Project {
  const takeoff: TakeoffRowInput[] = [
    { id: "1", loadTypeId: "DCFC 100kW", location: "Charger 1", units: 1, oneWayDistFt: 40 },
    { id: "2", loadTypeId: "DCFC 100kW", location: "Charger 2", units: 1, oneWayDistFt: 50 },
    { id: "3", loadTypeId: "DCFC 100kW", location: "Charger 3", units: 1, oneWayDistFt: 60 },
    { id: "4", loadTypeId: "DCFC 100kW", location: "Charger 4", units: 1, oneWayDistFt: 70 },
    { id: "5", loadTypeId: "DCFC 100kW", location: "Charger 5", units: 1, oneWayDistFt: 80 },
    { id: "6", loadTypeId: "DCFC 100kW", location: "Charger 6", units: 1, oneWayDistFt: 90 },
    { id: "7", loadTypeId: "Feeder 480V", location: "Gear feeder A", units: 1, oneWayDistFt: 70, sizeOverride: "600 kcmil" },
    { id: "8", loadTypeId: "Feeder 480V", location: "Gear feeder B", units: 1, oneWayDistFt: 60, sizeOverride: "600 kcmil" },
  ];

  const peripherals: PeripheralsInput = {
    gear: [{ item: "Main switchgear", size: "1000A", voltage: "480V", qty: 1 }],
    bollardsQty: 16,
    plywoodQty: 6,
    lumberQty: 6,
    sonoTubesQty: 22,
    christyBoxQty: 1,
    gfiTestQty: 1,
    dataBoxQty: 0,
    nutsQty: 400,
    washersQty: 400,
    elbowsQty: 6,
    junctionBoxQty: 1,
    permitFeeTotal: 1000,
    utilityAppFee: 1000,
    transformerPadCost: 1663,
    cableWellCost: 495,
    pullBoxQty: 0,
    pullBoxUnitCost: 0,
    utilitySandCost: 206,
    utilityVaultQty: 0,
    utilityVaultUnitCost: 0,
    dumpWasteCost: 0,
  };

  const setup = defaultSetup();
  return {
    setup,
    takeoff,
    loadTypes: DEFAULT_LOAD_TYPES,
    peripherals,
    equipment: defaultEquipmentItems(setup.conduitType, 90),
    financial: defaultFinancial(),
  };
}

describe("CPM engine — Bartell fixture (validated against CPM_Clean.xlsx)", () => {
  const result = computeEstimate(bartellProject());

  it("sizes each DCFC 100kW run to 3/0 AWG with the design-min flag", () => {
    const row1 = result.rows[0];
    expect(row1.selectedWire).toBe("3/0 AWG");
    expect(row1.wireFt).toBeCloseTo(120, 6);
    expect(row1.wireCost).toBeCloseTo(547.896, 3);
    expect(row1.groundSize).toBe("6 AWG");
    expect(row1.groundCost).toBeCloseTo(34.8416, 3);
    expect(row1.conduitSize).toBe('2"');
    expect(row1.conduitCost).toBeCloseTo(35.588, 3);
    expect(row1.dataCost).toBeCloseTo(15.648, 3);
    expect(row1.rowTotal).toBeCloseTo(633.9736, 3);
    expect(row1.flag).toBe("Design min governs; code min is 2/0 AWG");

    const row6 = result.rows[5];
    expect(row6.rowTotal).toBeCloseTo(1426.4406, 3);
  });

  it("sizes the gear feeders to the overridden 600 kcmil aluminium", () => {
    const feederA = result.rows[6];
    expect(feederA.selectedWire).toBe("600 kcmil");
    expect(feederA.material).toBe("Al");
    expect(feederA.groundSize).toBe("3 AWG");
    expect(feederA.conduitSize).toBe('4"');
  });

  it("rolls up charger and feeder counts correctly", () => {
    expect(result.rollups.nDCFC).toBe(6);
    expect(result.rollups.nL2).toBe(0);
    expect(result.rollups.nChargers).toBe(6);
    expect(result.rollups.nFeeders).toBe(2);
    expect(result.rollups.longestRunFt).toBe(90);
    expect(result.rollups.feederMaterialsTotal).toBeCloseTo(8491.5792, 3);
  });

  it("matches the Materials grand total exactly (was $0 for feeder wire before the fix)", () => {
    expect(result.materials.grandTotal).toBeCloseTo(8491.5792, 3);
    expect(result.materials.crossCheck).toBe(0);

    const line3_0 = result.materials.wireLines.find((l) => l.size === "3/0 AWG")!;
    expect(line3_0.cuFt).toBe(1170);
    expect(line3_0.cuCost).toBeCloseTo(5341.986, 3);

    const line600 = result.materials.wireLines.find((l) => l.size === "600 kcmil")!;
    expect(line600.alFt).toBe(520);
    expect(line600.alCost).toBeCloseTo(1790.6408, 3);

    const line3AWG = result.materials.wireLines.find((l) => l.size === "3 AWG")!;
    expect(line3AWG.cuFt).toBe(130);
    expect(line3AWG.cuCost).toBeCloseTo(218.5638, 3);
  });

  it("matches Peripherals subtotals exactly (ADA asphalt was billed for 2 chargers, not 6, before the fix)", () => {
    expect(result.peripherals.hardwareSubtotal).toBeCloseTo(1108.66066667, 2);
    expect(result.peripherals.civilSubtotal).toBeCloseTo(31365.54, 2);
    expect(result.peripherals.adaAllowance).toBeCloseTo(19500, 2);
    expect(result.peripherals.signageSubtotal).toBeCloseTo(3068.3, 2);
    expect(result.peripherals.permitsSubtotal).toBe(1000);
    expect(result.peripherals.utilitySubtotal).toBe(3364);
    // Gear prices from the live catalog (Bartell's manual list picked 1000A).
    const sg1000 = GEAR_CATALOG.find(
      (g) => g.item === "Main switchgear" && g.size === "1000A" && g.voltage === "480V",
    )!;
    expect(result.peripherals.gearMainSwitchgear).toBeCloseTo(sg1000.unitCost, 2);
    expect(result.peripherals.gearOtherTotal).toBe(0);
  });

  it("matches the Equipment rental subtotal", () => {
    expect(result.equipment.subtotal).toBeCloseTo(8268, 2);
  });

  it("passes every QA check", () => {
    for (const check of result.qa) {
      expect(check.ok, `${check.label}: ${check.detail}`).toBe(true);
    }
  });

  it("Total Cost includes construction, labor, tax and (unlike the original) equipment purchase + design", () => {
    // With no equipment purchase / design invoice inputs, Total Cost should
    // equal the fully-loaded electrical construction cost + labor + tax.
    expect(result.costs.equipmentPurchaseInvoice).toBe(0);
    expect(result.costs.designInvoice).toBe(0);
    // Labor carries the 10% contingency like both source workbooks' Costs
    // Internal ZIB block (2,250 -> 2,475/day x 30 = 74,250).
    expect(result.costs.labor).toBe(2250 * 1.1 * 30);
    expect(result.costs.totalCost).toBeCloseTo(
      result.costs.electricalSupplyConstructionTotal + result.costs.salesTaxOnConstruction + result.costs.labor,
      2,
    );
  });
});
