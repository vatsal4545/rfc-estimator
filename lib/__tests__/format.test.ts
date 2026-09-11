import { describe, expect, it } from "vitest";
import { fractionToPct, pctToFraction } from "../format";

// Percentages are entered and shown as whole numbers ("20" for 20%) but stored
// as fractions, so every project already on disk keeps working and the engine,
// exports and template never see the display form. The only thing that can go
// wrong is float noise on the way through, which would show a user "7.000000000000001".
describe("percent entry <-> fraction storage", () => {
  it("shows a stored fraction as its percentage", () => {
    expect(fractionToPct(0.2)).toBe(20);
    expect(fractionToPct(0.03)).toBe(3);
    expect(fractionToPct(0.065)).toBe(6.5);
    expect(fractionToPct(1)).toBe(100);
    expect(fractionToPct(0)).toBe(0);
  });

  it("stores typed percentages as fractions", () => {
    expect(pctToFraction(20)).toBe(0.2);
    expect(pctToFraction(3)).toBe(0.03);
    expect(pctToFraction(6.5)).toBe(0.065);
    expect(pctToFraction(0)).toBe(0);
  });

  it("survives a round trip without float dust", () => {
    // 0.07 * 100 is 7.000000000000001 in binary floating point; a field that
    // renders that is worse than the one it replaced.
    for (const shown of [3, 5, 6.5, 7, 15, 20, 33.3, 98, 100]) {
      expect(fractionToPct(pctToFraction(shown))).toBe(shown);
    }
  });

  it("is not fooled by a non-finite value", () => {
    expect(fractionToPct(Number.NaN)).toBe(0);
    expect(pctToFraction(Number.NaN)).toBe(0);
  });
});
