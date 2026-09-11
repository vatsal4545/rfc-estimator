import { describe, expect, it } from "vitest";
import { defaultProject } from "../defaults";
import { computeTakeoffRow } from "../sizing";
import { DEFAULT_LOAD_TYPES } from "../tables";

// A dual-port L2 is two circuits, one per port, and its runs are NOT a parallel
// set — so the automatic sizing must never split its amps. But a user who types
// a number into Runs/u is asking for parallel conductors explicitly, and the
// field did nothing on L2 rows at all.
describe("Runs/u override on an L2 row", () => {
  const setup = defaultProject().setup;
  const row = (runsPerUnitOverride?: number) =>
    computeTakeoffRow(
      { id: "r", loadTypeId: "L2 Dual 40A", location: "far", units: 1, oneWayDistFt: 300, runsPerUnitOverride },
      setup,
      DEFAULT_LOAD_TYPES,
    );

  it("leaves automatic sizing alone when nothing is typed", () => {
    const auto = row();
    expect(auto.resolvedRunsPerUnit).toBe(2); // the model's own per-port circuits
    expect(auto.contAmps).toBeCloseTo(auto.designAmps * 1.25, 5); // full amps per circuit
  });

  it("splits the amps when the user explicitly asks for parallel sets", () => {
    const four = row(4);
    expect(four.resolvedRunsPerUnit).toBe(4);
    expect(four.contAmps).toBeCloseTo((four.designAmps / 4) * 1.25, 5);
  });

  it("sizes smaller conductors once the amps are split", () => {
    expect(row(4).idxAmp).toBeLessThan(row().idxAmp);
  });

  it("flags a parallel set below the 1/0 floor of NEC 310.10(H)", () => {
    // 40A a port split four ways lands far below 1/0, which the code does not
    // permit to be paralleled. Size it, price it, but say so.
    expect(row(4).flag).toContain("310.10(H)");
  });
});
