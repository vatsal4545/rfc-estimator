import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { CIVIL_RATES } from "../peripherals";

// Signage and striping follow the shop's RFC_V18 "CPM Calcs" sheet. The rates
// used to be hardcoded in the engine, so a job that negotiated a different sign
// price had nowhere to put it.
const build = (dcfc: number, l2: number, peripherals: Record<string, unknown> = {}) => {
  const p = buildQuickProject(
    { ...defaultQuickInput(), terrain: "flat", lines: [
      { loadTypeId: "DCFC 200kW", count: dcfc },
      { loadTypeId: "L2 Single 40A", count: l2 },
    ] },
    defaultProject(),
    "sig",
  );
  return computeEstimate({ ...p, peripherals: { ...p.peripherals, ...peripherals } });
};
const line = (r: ReturnType<typeof computeEstimate>, name: string) =>
  r.peripherals.lines.signage.find((s) => s.name === name)!;

describe("signage and striping follow the RFC_V18 rules", () => {
  it("counts one sign per charger and posts at L2 + half the DC, rounded up", () => {
    const r = build(11, 16); // odd DC count, so the rounding shows
    expect(line(r, "Signs").qty).toBe(27);
    expect(line(r, "Sign posts").qty).toBe(16 + 6); // ceil(11/2) — you cannot buy half a post
  });

  it("gives ADA its own post, counted separately", () => {
    const r = build(6, 5);
    const ada = line(r, "ADA sign post");
    expect(ada.qty).toBe(1);
    expect(ada.unitCost).toBe(CIVIL_RATES.signPostEach);
    // and it is NOT folded into the charger posts
    expect(line(r, "Sign posts").qty).toBe(5 + 3);
  });

  it("strips in ten-stall units, counting L2 stalls by port", () => {
    // 16 single-port L2 (16 stalls) + 12 DC (12) = 28. The RFC's
    // (L2 x 2 + DC) / 10 reads 4.4 here by assuming every L2 is dual.
    expect(line(build(12, 16), "Striping").qty).toBeCloseTo(2.8, 5);
  });

  it("takes a quoted rate for every signage line", () => {
    const r = build(6, 5, {
      signUnitCost: 52,
      signPostUnitCost: 61,
      stripingUnitCost: 1750,
      bollardUnitCost: 125,
    });
    expect(line(r, "Signs").unitCost).toBe(52);
    expect(line(r, "Sign posts").unitCost).toBe(61);
    expect(line(r, "ADA sign post").unitCost).toBe(61);
    expect(line(r, "Striping").unitCost).toBe(1750);
    expect(line(r, "Bollards").unitCost).toBe(125);
  });

  it("falls back to the shipped rates when nothing is quoted", () => {
    const r = build(6, 5);
    expect(line(r, "Signs").unitCost).toBe(CIVIL_RATES.signEach);
    expect(line(r, "Sign posts").unitCost).toBe(CIVIL_RATES.signPostEach);
    expect(line(r, "Striping").unitCost).toBe(CIVIL_RATES.stripingPerStall);
  });
});

// The derived counts are right for a standard job and wrong for the one where
// the AHJ wants a sign at each end of the row, or the striping contractor
// quotes the lot rather than the stalls. A typed count wins; clearing it hands
// the line back to the Takeoff.
describe("a typed quantity overrides the derived one", () => {
  it("takes a typed count on every signage line", () => {
    const r = build(6, 5, {
      signQtyOverride: 14,
      signPostQtyOverride: 9,
      adaSignPostQtyOverride: 3,
      stripingQtyOverride: 6,
      bollardsQty: 40,
    });
    expect(line(r, "Signs").qty).toBe(14);
    expect(line(r, "Sign posts").qty).toBe(9);
    expect(line(r, "ADA sign post").qty).toBe(3);
    expect(line(r, "Striping").qty).toBe(6);
    expect(line(r, "Bollards").qty).toBe(40);
  });

  it("reports an overridden line as no longer automatic", () => {
    const r = build(6, 5, { signQtyOverride: 14 });
    expect(line(r, "Signs").auto).toBe(false);
    expect(line(r, "Sign posts").auto).toBe(true); // untouched
  });

  it("honours a deliberate zero — 'no signs on this job' is an answer", () => {
    const r = build(6, 5, { signQtyOverride: 0 });
    expect(line(r, "Signs").qty).toBe(0);
    expect(line(r, "Signs").auto).toBe(false);
  });

  it("keeps reporting the derived count while overridden, so it can be put back", () => {
    const r = build(6, 5, { signQtyOverride: 14 });
    expect(line(r, "Signs").qty).toBe(14);
    expect(line(r, "Signs").autoQty).toBe(11); // what "auto" would restore
  });

  it("falls back to the derived count when the override is cleared", () => {
    const r = build(6, 5, { signQtyOverride: undefined });
    expect(line(r, "Signs").qty).toBe(11);
    expect(line(r, "Signs").auto).toBe(true);
  });
});
