import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import { WIRE_TABLE, conduitTableFor, wireTableFor } from "../tables";

describe("conductor and conduit $/ft overrides", () => {
  const base = defaultProject();
  const quick = { ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 360kW Dual", count: 2 }], firstRunFtDcfc: 100, stepFt: 15 };
  const project = buildQuickProject(quick, base, "t", HARDWARE_ALLOWANCE);
  const shipped = computeEstimate(project);
  const dc = shipped.rows.filter((r) => !r.synthetic && r.category === "DCFC");
  const size = dc[0].selectedWire;
  const conduit = dc[0].conduitSize;

  it("a quoted $/ft reprices every run of that size and the BOM, nothing else", () => {
    const shippedPrice = WIRE_TABLE.find((w) => w.size === size)!.cuPerFt;
    const quoted = { ...project, setup: { ...project.setup, materialRates: { wire: { [size]: { cuPerFt: shippedPrice + 1 } } } } };
    const est = computeEstimate(quoted);
    const rows = est.rows.filter((r) => !r.synthetic && r.category === "DCFC");
    rows.forEach((r, i) => {
      expect(r.selectedWire).toBe(size); // sizing untouched
      expect(r.wireCostPerFt).toBeCloseTo(shippedPrice + 1, 6);
      expect(r.wireCost - dc[i].wireCost).toBeCloseTo(dc[i].wireFt, 2); // +$1/ft × ft
    });
    const line = est.materials.wireLines.find((l) => l.size === size)!;
    expect(line.cuPerFt).toBeCloseTo(shippedPrice + 1, 6);
    const extra = dc.reduce((s, r) => s + r.wireFt, 0);
    expect(est.costs.lines[0].base - shipped.costs.lines[0].base).toBeCloseTo(extra, 2);
    expect(est.costs.lines[1].base).toBe(shipped.costs.lines[1].base); // switchgear untouched
  });

  it("conduit overrides reprice the conduit footage; blank fields keep the shipped price", () => {
    const table = conduitTableFor(project.setup);
    const shippedPvc = table.find((c) => c.tradeSize === conduit)!.pvcPerFt;
    const quoted = { ...project, setup: { ...project.setup, materialRates: { conduit: { [conduit]: { pvcPerFt: shippedPvc * 2 } } } } };
    const est = computeEstimate(quoted);
    const r = est.rows.filter((row) => !row.synthetic && row.category === "DCFC")[0];
    expect(r.conduitCostPerFt).toBeCloseTo(shippedPvc * 2, 6);
    expect(conduitTableFor(quoted.setup).find((c) => c.tradeSize === conduit)!.emtPerFt).toBe(table.find((c) => c.tradeSize === conduit)!.emtPerFt);
    expect(wireTableFor(undefined)).toBe(WIRE_TABLE);
    expect(wireTableFor({ materialRates: {} })).toBe(WIRE_TABLE);
  });
});
