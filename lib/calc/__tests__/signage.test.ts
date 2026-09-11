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

  it("strips at (L2 x 2 + DC) / 10", () => {
    expect(line(build(12, 16), "Striping").qty).toBeCloseTo(4.4, 5);
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
