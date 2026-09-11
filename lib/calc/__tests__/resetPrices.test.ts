import { describe, expect, it } from "vitest";
import { defaultProject } from "../defaults";
import {
  CIVIL_RATES,
  PERIPHERAL_PRICE_KEYS,
  PERIPHERAL_SHIPPED_PRICES,
  peripheralPriceOverrideCount,
  resetPeripheralPrices,
} from "../peripherals";

// "Reset pricing" has to mean prices and nothing else. The scope someone
// entered — how many bollards, how many pull boxes, which stalls are van
// accessible — is not a price and must survive.
describe("resetting peripheral prices", () => {
  const shipped = defaultProject().peripherals;

  it("clears an optional unit rate so it tracks the shipped table again", () => {
    const reset = resetPeripheralPrices({ ...shipped, concreteUnitCost: 999, asphaltPerSf: 42 });
    expect(reset.concreteUnitCost).toBeUndefined();
    expect(reset.asphaltPerSf).toBeUndefined();
  });

  it("writes back the two rates the type requires", () => {
    const reset = resetPeripheralPrices({ ...shipped, pullBoxUnitCost: 9999, utilityVaultUnitCost: 8888 });
    expect(reset.pullBoxUnitCost).toBe(PERIPHERAL_SHIPPED_PRICES.pullBoxUnitCost);
    expect(reset.utilityVaultUnitCost).toBe(PERIPHERAL_SHIPPED_PRICES.utilityVaultUnitCost);
  });

  it("leaves quantities and scope alone", () => {
    const reset = resetPeripheralPrices({
      ...shipped,
      bollardsQty: 17,
      pullBoxQty: 4,
      adaVanQty: 2,
      concreteYardsOverride: 12,
      bollardUnitCost: 777,
    });
    expect(reset.bollardsQty).toBe(17);
    expect(reset.pullBoxQty).toBe(4);
    expect(reset.adaVanQty).toBe(2);
    expect(reset.concreteYardsOverride).toBe(12);
    expect(reset.bollardUnitCost).toBeUndefined(); // the price did go
  });

  it("leaves custom items and the terrain-derived ADA costs alone", () => {
    const edited = {
      ...shipped,
      customItems: [{ name: "Crane day", qty: 1, unitCost: 4200 }],
      adaVanUnitCost: 7150, // what the planner writes on sloped ground
    };
    const reset = resetPeripheralPrices(edited);
    expect(reset.customItems).toEqual([{ name: "Crane day", qty: 1, unitCost: 4200 }]);
    expect(reset.adaVanUnitCost).toBe(7150);
  });
});

// The count drives a "N prices quoted" note, so it has to mean something. It
// used to compare against a fresh project, where these fields are undefined —
// so a value the planner had written at its own shipped rate counted as a
// quote, and a project with no quotes on it read "5 prices quoted".
describe("counting prices that are actually off the shipped list", () => {
  const shipped = defaultProject().peripherals;

  it("counts nothing on a project that has not been quoted", () => {
    expect(peripheralPriceOverrideCount(shipped)).toBe(0);
  });

  it("does not count a field written at exactly the shipped rate", () => {
    const planned = { ...shipped, bollardUnitCost: CIVIL_RATES.bollardEach, pullBoxUnitCost: 0 };
    expect(peripheralPriceOverrideCount(planned)).toBe(0);
  });

  it("counts a real quote, and stops counting it after a reset", () => {
    const quoted = { ...shipped, bollardUnitCost: 210, concreteUnitCost: 198 };
    expect(peripheralPriceOverrideCount(quoted)).toBe(2);
    expect(peripheralPriceOverrideCount(resetPeripheralPrices(quoted))).toBe(0);
  });

  it("covers rates only — no quantities, fees or ADA in the key list", () => {
    expect(PERIPHERAL_PRICE_KEYS).toContain("concreteUnitCost");
    expect(PERIPHERAL_PRICE_KEYS).toContain("pullBoxUnitCost");
    expect(PERIPHERAL_PRICE_KEYS).not.toContain("bollardsQty");
    expect(PERIPHERAL_PRICE_KEYS).not.toContain("customItems");
    expect(PERIPHERAL_PRICE_KEYS).not.toContain("permitFeeTotal");
    expect(PERIPHERAL_PRICE_KEYS).not.toContain("adaVanUnitCost");
  });
});
