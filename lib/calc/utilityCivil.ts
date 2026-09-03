// Utility-side substructures the CUSTOMER furnishes and installs for a new
// underground service, by delivery utility: the transformer pad, the cable
// well under it, the pull boxes on the utility's route, and the Christy box
// at the point of connection. The utility supplies the transformer and the
// primary cable; who builds the pad, well and boxes is the utility's rule.
//
// Rules on file (Sept 2026):
// - SMUD, Engineering Spec T007 "Distribution Underground Structure" Rev 11:
//   the customer installs conduits, boxes, transformer pads/wells and service
//   boxes (4.1.5, 4.3.1); pull boxes in the PUE are installed by the customer
//   and deeded to SMUD (4.1.9); SMUD furnishes transformers, switchgear and
//   primary conductors (4.2.1). SMUD's own term is "cable well" — the Ø32"
//   well under the pad on 8" of ¾" crushed rock.
// - SDG&E, General Conditions for UG Electric Distribution (106-35140F) §12:
//   all substructures and hardware are provided and installed by the
//   Applicant; transformer and equipment pads and secondary handholes are the
//   Applicant's improvements, inspected by SDG&E before crews set equipment.
// - PG&E / SCE under their EV infrastructure rules (Rule 29): the utility
//   designs, builds and owns the service extension. When the intake says the
//   utility provides the transformer-to-switchgear run, no pad, well or pull
//   box is ours; when we build the service section, we furnish the pad.
// - Other publicly owned utilities, co-ops and Michigan utilities follow the
//   SMUD pattern (customer-built substructures) until their spec says otherwise.
//
// Prices are installed budgets (material, excavation, base rock, set, backfill)
// pending the utility's design: precast pad material alone runs ~$1,000 for a
// 72"×72" pad (Lockwood Precast list) and California three-phase pads are
// larger; Christy N48 box + lid listed $422 in 2017; a Christy N36-class box
// with a traffic lid installs for about $600 (the shop's figure).

import { UTILITIES } from "../ref/utilities";

export const UTILITY_CIVIL_RATES = {
  /** Three-phase precast transformer pad, set on compacted base rock, grounded. */
  transformerPad: 5000,
  /** Utility pull box / secondary handhole, traffic-rated precast, installed. */
  pullBoxEach: 2500,
  /** Cable well under the transformer pad (SMUD) or the service handhole (SDG&E), installed. */
  cableWell: 3500,
  /** Christy concrete box with traffic lid at the point of connection / service conduit route. */
  serviceBox: 600,
} as const;

export type UtilityCivilRegime = "smud" | "sdge" | "ca-iou-ev-rule" | "pou" | "unknown";

export interface UtilityCivilResult {
  regime: UtilityCivilRegime;
  label: string;
  transformerPadCost: number;
  pullBoxQty: number;
  pullBoxUnitCost: number;
  cableWellCost: number;
  serviceBoxQty: number;
  serviceBoxUnitCost: number;
  /** What the rule says, for the tab and the export. */
  basis: string;
  source: string;
}

export interface UtilityCivilCounts {
  nDCFC: number;
  nL2: number;
}

/** Which rule a delivery utility falls under. */
export function utilityCivilRegime(utility: string): { regime: UtilityCivilRegime; label: string } {
  const u = utility.trim();
  if (!u) return { regime: "unknown", label: "No utility picked" };
  if (/^SMUD\b|Sacramento Municipal/i.test(u)) return { regime: "smud", label: "SMUD — customer builds pads, wells and boxes (T007)" };
  if (/^SDG&E\b|San Diego Gas/i.test(u)) return { regime: "sdge", label: "SDG&E — Applicant installs all substructures (106-35140F §12)" };
  if (/^PG&E\b|Pacific Gas|^SCE\b|Southern California Edison/i.test(u)) return { regime: "ca-iou-ev-rule", label: `${u.split(" — ")[0]} — EV infrastructure rule (Rule 29)` };
  const row = UTILITIES.find((r) => r.utility === u);
  if (row && row.type === "IOU" && row.state === "California") return { regime: "ca-iou-ev-rule", label: `${u.split(" — ")[0]} — California IOU EV infrastructure rule` };
  if (row) return { regime: "pou", label: `${row.type} — customer-built substructures per the utility's service requirements` };
  return { regime: "pou", label: "Utility not on the roster — customer-built substructures assumed; confirm its service requirements" };
}

/**
 * The customer-furnished substructures for a site, from the utility rule and
 * the charger mix. A transformer pad only exists where a new pad-mounted
 * transformer is likely — DC fast charging; a Level 2-only site usually
 * lands on the existing service.
 */
export function utilityCivilFor(utility: string, counts: UtilityCivilCounts, feederByUtility = false): UtilityCivilResult {
  const { regime, label } = utilityCivilRegime(utility);
  const newTransformer = counts.nDCFC > 0;
  const anyChargers = counts.nDCFC + counts.nL2 > 0;
  const R = UTILITY_CIVIL_RATES;
  const base = {
    regime,
    label,
    transformerPadCost: 0,
    pullBoxQty: 0,
    pullBoxUnitCost: R.pullBoxEach,
    cableWellCost: 0,
    serviceBoxQty: anyChargers ? 1 : 0,
    serviceBoxUnitCost: R.serviceBox,
    basis: "",
    source: "",
  };
  switch (regime) {
    case "smud":
      return {
        ...base,
        transformerPadCost: newTransformer ? R.transformerPad : 0,
        cableWellCost: newTransformer ? R.cableWell : 0,
        pullBoxQty: newTransformer ? 2 : anyChargers ? 1 : 0,
        basis: newTransformer
          ? "SMUD furnishes the transformer and primary cable; we furnish and install the pad, the cable well under it, the primary and secondary pull boxes (deeded to SMUD) and the service box."
          : "SMUD: no new transformer on a Level 2-only site; one secondary pull box and the service box are ours.",
        source: "SMUD Engineering Specification T007 Rev 11, §4.1.5, 4.1.9, 4.2.1, 4.10.5",
      };
    case "sdge":
      return {
        ...base,
        transformerPadCost: newTransformer ? R.transformerPad : 0,
        cableWellCost: newTransformer ? R.cableWell : 0,
        pullBoxQty: anyChargers ? 1 : 0,
        basis: newTransformer
          ? "SDG&E sets the transformer; the Applicant provides and installs the transformer pad, the secondary handhole (cable well) and the pull box, compacted and at final grade before SDG&E crews are scheduled."
          : "SDG&E: no new transformer on a Level 2-only site; the secondary pull box and the service box are ours.",
        source: "SDG&E General Conditions for UG Electric Distribution Service Systems 106-35140F, §12.1, 12.4, 12.5",
      };
    case "ca-iou-ev-rule":
      return {
        ...base,
        transformerPadCost: newTransformer && !feederByUtility ? R.transformerPad : 0,
        pullBoxQty: newTransformer && !feederByUtility ? 1 : 0,
        basis: feederByUtility
          ? "The utility designs, builds and owns the EV service extension including the transformer pad and its substructures; only the service box at our point of connection is ours."
          : newTransformer
            ? "We build the service section, so the transformer pad and one pull box are ours; the utility supplies the transformer under its EV infrastructure rule."
            : "Level 2-only site on the existing service; the service box is ours.",
        source: "PG&E Electric Rule 29 / SCE Rule 29 (EV infrastructure); Intake Electrical B119 'Who provides this run?'",
      };
    case "pou":
      return {
        ...base,
        transformerPadCost: newTransformer ? R.transformerPad : 0,
        cableWellCost: newTransformer ? R.cableWell : 0,
        pullBoxQty: newTransformer ? 1 : 0,
        basis: newTransformer
          ? "Publicly owned utilities generally have the customer build the transformer pad, well and pull boxes to their standard; the utility sets the transformer. Confirm with the utility's service requirements."
          : "Level 2-only site on the existing service; the service box is ours.",
        source: "Utility service requirements (customer-built substructures pattern); verify per utility",
      };
    default:
      return {
        ...base,
        transformerPadCost: newTransformer ? R.transformerPad : 0,
        basis: "No delivery utility picked — the transformer pad is carried as an allowance on a DC site; pick the utility on 1 · Project to apply its rule.",
        source: "Estimator default",
      };
  }
}
