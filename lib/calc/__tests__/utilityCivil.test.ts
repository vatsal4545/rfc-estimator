import { describe, expect, it } from "vitest";
import { HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../autoplan";
import { defaultProject } from "../defaults";
import { computeEstimate } from "../engine";
import type { Project } from "../types";
import { UTILITY_CIVIL_RATES, utilityCivilFor, utilityCivilRegime } from "../utilityCivil";

const R = UTILITY_CIVIL_RATES;
const dc = { nDCFC: 4, nL2: 2 };
const l2only = { nDCFC: 0, nL2: 6 };

describe("customer-furnished utility substructures", () => {
  it("SMUD: pad, cable well, two pull boxes and the service box on a DC site; one pull box and the box on Level 2 only", () => {
    const smud = utilityCivilFor("SMUD — Sacramento Municipal Utility District", dc);
    expect(smud.regime).toBe("smud");
    expect(smud).toMatchObject({ transformerPadCost: R.transformerPad, cableWellCost: R.cableWell, pullBoxQty: 2, pullBoxUnitCost: R.pullBoxEach, serviceBoxQty: 1, serviceBoxUnitCost: 600 });
    expect(smud.source).toMatch(/T007/);
    const l2 = utilityCivilFor("SMUD — Sacramento Municipal Utility District", l2only);
    expect(l2).toMatchObject({ transformerPadCost: 0, cableWellCost: 0, pullBoxQty: 1, serviceBoxQty: 1 });
  });

  it("SDG&E: the Applicant installs pad, handhole and pull box", () => {
    const r = utilityCivilFor("SDG&E — San Diego Gas & Electric", dc);
    expect(r.regime).toBe("sdge");
    expect(r).toMatchObject({ transformerPadCost: 5000, cableWellCost: 3500, pullBoxQty: 1, serviceBoxQty: 1 });
    expect(r.source).toMatch(/106-35140F/);
  });

  it("PG&E / SCE under Rule 29: nothing but the service box when the utility provides the run, the pad when we do", () => {
    const utilityRun = utilityCivilFor("PG&E — Pacific Gas and Electric", dc, true);
    expect(utilityRun).toMatchObject({ regime: "ca-iou-ev-rule", transformerPadCost: 0, cableWellCost: 0, pullBoxQty: 0, serviceBoxQty: 1 });
    const ourRun = utilityCivilFor("SCE — Southern California Edison", dc, false);
    expect(ourRun).toMatchObject({ transformerPadCost: 5000, cableWellCost: 0, pullBoxQty: 1, serviceBoxQty: 1 });
  });

  it("other public utilities follow the customer-built pattern; no utility keeps the pad allowance only", () => {
    expect(utilityCivilFor("LADWP — Los Angeles Dept of Water & Power", dc)).toMatchObject({ regime: "pou", transformerPadCost: 5000, cableWellCost: 3500, pullBoxQty: 1 });
    expect(utilityCivilRegime("Anaheim Public Utilities").regime).toBe("pou");
    expect(utilityCivilRegime("DTE Electric Company").regime).toBe("pou");
    expect(utilityCivilFor("", dc)).toMatchObject({ regime: "unknown", transformerPadCost: 5000, cableWellCost: 0, pullBoxQty: 0, serviceBoxQty: 1 });
    expect(utilityCivilFor("", { nDCFC: 0, nL2: 0 }).serviceBoxQty).toBe(0);
  });

  it("Build writes the rule onto the peripherals and the Utility and hardware lines carry it", () => {
    const base: Project = { ...defaultProject(), setup: { ...defaultProject().setup, utility: "SMUD — Sacramento Municipal Utility District" } };
    const quick = { ...defaultQuickInput(), lines: [{ loadTypeId: "DCFC 360kW Dual", count: 4 }, { loadTypeId: "L2 Dual 40A", count: 2 }] };
    const p = buildQuickProject(quick, base, "t", HARDWARE_ALLOWANCE);
    expect(p.peripherals).toMatchObject({ transformerPadCost: 5000, cableWellCost: 3500, pullBoxQty: 2, pullBoxUnitCost: 2500, serviceBoxQty: 1, serviceBoxUnitCost: 600 });
    const est = computeEstimate(p);
    const utilityLine = est.costs.lines.find((l) => l.name === "Utility")!;
    expect(utilityLine.base).toBeCloseTo(p.peripherals.utilityAppFee + 5000 + 3500 + 2 * 2500, 2);
    const box = est.peripherals.lines.hardware.find((h) => h.name.startsWith("Christy box, traffic-rated"))!;
    expect(box.qty).toBe(1);
    expect(box.unitCost).toBe(600);
    // The same site on PG&E with the utility building the run: no pad, no well, no pull box.
    const pge = buildQuickProject(quick, { ...base, setup: { ...base.setup, utility: "PG&E — Pacific Gas and Electric" }, intake: { ...(base.intake ?? {}), interconnection: { serviceFeederBy: "Utility — EV infrastructure rule" } } } as Project, "t", HARDWARE_ALLOWANCE);
    expect(pge.peripherals).toMatchObject({ transformerPadCost: 0, cableWellCost: 0, pullBoxQty: 0, serviceBoxQty: 1 });
  });
});
