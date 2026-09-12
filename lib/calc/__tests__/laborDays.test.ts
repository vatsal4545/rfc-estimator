import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput, estimateLaborDays } from "../autoplan";
import { defaultProject } from "../defaults";

// A Level 2 install is not a day's work per unit. A single-port 32A unit is one
// circuit to pull, terminate and commission — several fit in a crew-day. A
// dual-port unit is two circuits and is closer to the full day the estimate
// used to charge for every L2 regardless.
const days = (lines: { loadTypeId: string; count: number }[]) =>
  buildQuickProject({ ...defaultQuickInput(), terrain: "flat", lines }, defaultProject(), "lab")
    .financial.laborBusinessDays;

describe("Level 2 crew-days scale with the work, not the unit count", () => {
  it("charges a quarter day for a single-port L2", () => {
    // 8 mobilisation + 4 L2 x 0.25 = 1 + trench; the L2 term is the point.
    const one = estimateLaborDays({ nL2: 4, nDCFC: 0, nChargers: 4, nL2Multiport: 0 }, 0, "flat");
    expect(one).toBe(Math.ceil(8 + 4 * 0.25));
  });

  it("charges a full day for a dual-port L2", () => {
    const dual = estimateLaborDays({ nL2: 4, nDCFC: 0, nChargers: 4, nL2Multiport: 4 }, 0, "flat");
    expect(dual).toBe(Math.ceil(8 + 4 * 1.0));
  });

  it("reads a real project's mix rather than its unit count", () => {
    // 29 single-port L2 + 12 DC on 785 ft: the L2 term is 7.25 days, not 29.
    expect(days([
      { loadTypeId: "DCFC 120kW Dual", count: 12 },
      { loadTypeId: "L2 Single 32A", count: 29 },
    ])).toBe(Math.ceil(8 + 12 * 2.5 + 29 * 0.25 + 785 / 40));
  });

  it("keeps a dual-heavy job close to where it was", () => {
    // Crystal Springs: 13 dual + 3 single + 12 DC on 590 ft.
    expect(days([
      { loadTypeId: "L2 Dual 40A", count: 13 },
      { loadTypeId: "L2 Single 40A", count: 3 },
      { loadTypeId: "DCFC 100kW", count: 12 },
    ])).toBe(Math.ceil(8 + 12 * 2.5 + (13 * 1.0 + 3 * 0.25) + 590 / 40));
  });
});
