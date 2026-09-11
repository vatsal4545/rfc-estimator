import { describe, expect, it } from "vitest";
import { buildQuickProject, defaultQuickInput } from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";

// Striping is counted in ten-stall units. A dual-port L2 serves two stalls and
// a single-port one serves one — the RFC's (L2 x 2 + DC) assumed every L2 was
// dual and billed a site of singles for twice the striping it needs.
const striping = (lines: { loadTypeId: string; count: number }[]) => {
  const p = buildQuickProject({ ...defaultQuickInput(), terrain: "flat", lines }, defaultProject(), "st");
  return computeEstimate(p).peripherals.lines.signage.find((s) => s.name === "Striping")!.qty;
};

describe("striping counts L2 stalls by port", () => {
  it("counts a single-port L2 as one stall", () => {
    expect(striping([{ loadTypeId: "L2 Single 40A", count: 8 }])).toBeCloseTo(0.8, 5);
  });

  it("counts a dual-port L2 as two", () => {
    expect(striping([{ loadTypeId: "L2 Dual 40A", count: 4 }])).toBeCloseTo(0.8, 5);
  });

  it("leaves DC at one stall a cabinet", () => {
    expect(striping([{ loadTypeId: "DCFC 200kW", count: 6 }])).toBeCloseTo(0.6, 5);
    expect(striping([{ loadTypeId: "DCFC 200kW Dual", count: 6 }])).toBeCloseTo(0.6, 5);
  });

  it("adds the two streams", () => {
    // 3 single L2 (3) + 5 dual L2 (10) + 4 DC (4) = 17 stalls
    expect(striping([
      { loadTypeId: "L2 Single 40A", count: 3 },
      { loadTypeId: "L2 Dual 40A", count: 5 },
      { loadTypeId: "DCFC 200kW", count: 4 },
    ])).toBeCloseTo(1.7, 5);
  });
});
