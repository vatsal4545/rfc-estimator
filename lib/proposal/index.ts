// The proposal layer's entry point. A downstream consumer of the estimator's
// result — it reads `estimate`, never writes into it, and returns null for a
// project that has no commercial section (older saved projects), so the UI can
// hide everything price-side until the section exists.

import type { EstimateResult, Project } from "../calc/types";
import { computeCostBuildup } from "./costBuildup";
import { computeMargin } from "./margin";
import { computeProjectModel } from "./model";
import type { ProposalResult } from "./types";

export function computeProposal(project: Project, estimate: EstimateResult): ProposalResult | null {
  if (!project.commercial) return null;
  const costBuildup = computeCostBuildup(project.financial, estimate.costs, project.commercial);
  const margin = computeMargin(costBuildup, project.commercial);
  const model = computeProjectModel(project, costBuildup, margin);
  return { costBuildup, margin, model };
}

export { computeCostBuildup } from "./costBuildup";
export { computeMargin } from "./margin";
export {
  computeCarbon,
  computeCashflow,
  computeDeal,
  computeFinancing,
  computeModel,
  computeProjectModel,
  computeRevenue,
  computeTariff,
  computeUsage,
  findRateRow,
  horizonOf,
  modelContextOf,
  rampFactor,
} from "./model";
export {
  DEFAULT_PASS_THROUGH_LINES,
  MARKET_ACTIVITY,
  defaultCarbon,
  defaultCommercial,
  defaultDeal,
  defaultFinancing,
  defaultIntake,
  defaultMarginAssumptions,
  defaultRevenue,
  defaultServiceTerms,
  defaultTariff,
  impliedMarketGrowth,
  modelInputsOf,
  zeroRates,
} from "./defaults";
export * from "./types";
