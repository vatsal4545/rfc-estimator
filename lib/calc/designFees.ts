// Design and engineering as the CEO's intake prices it: a QUANTITY at a RATE.
//
// The intake's Construction tab carries three rows — AutoCAD drawing sets,
// electrical-engineering drawing sets and project-management hours — each as
// quantity (column B) × ZIE billing rate (column D), summed into the design
// and engineering total. The estimator's market-rate formulas at Build give
// a fee in dollars; this module reads that fee as a quantity at the rate
// (fee ÷ rate) until someone types a quantity, after which the fee IS
// quantity × rate, in the app, on the intake and on every export.

import type { FinancialInput } from "./types";

/** The template's own unit rates (Construction!D32–D34) — ZIE billing rates for in-house work. */
export const DESIGN_UNIT_RATES = { autoCad: 3412.5, ee: 2080, pm: 358 } as const;

export type DesignFeeKind = "autoCad" | "ee";

const COST_KEY: Record<DesignFeeKind, "autoCadDesignCost" | "electricalEngDesignCost"> = { autoCad: "autoCadDesignCost", ee: "electricalEngDesignCost" };
const SETS_KEY: Record<DesignFeeKind, "autoCadSets" | "eeSets"> = { autoCad: "autoCadSets", ee: "eeSets" };
const RATE_KEY: Record<DesignFeeKind, "autoCadSetRate" | "eeSetRate"> = { autoCad: "autoCadSetRate", ee: "eeSetRate" };

/** The rate per drawing set in force: typed, else the template's. */
export function designRate(f: FinancialInput, kind: DesignFeeKind): number {
  const r = f[RATE_KEY[kind]];
  return r !== undefined && r > 0 ? r : DESIGN_UNIT_RATES[kind];
}

/** Whether the quantity was typed (the fee follows it) rather than read off the market-rate fee. */
export function designSetsTyped(f: FinancialInput, kind: DesignFeeKind): boolean {
  return f[SETS_KEY[kind]] !== undefined;
}

/** Drawing sets in force: the typed count, else the fee at the rate (fractional when the fee is not a whole number of sets). */
export function designSets(f: FinancialInput, kind: DesignFeeKind): number {
  const typed = f[SETS_KEY[kind]];
  if (typed !== undefined) return typed;
  const cost = f[COST_KEY[kind]];
  const rate = designRate(f, kind);
  return cost > 0 && rate > 0 ? Math.round((cost / rate) * 10000) / 10000 : 0;
}

export function designCost(f: FinancialInput, kind: DesignFeeKind): number {
  return f[COST_KEY[kind]];
}

/** Type a quantity: the fee becomes quantity × rate. */
export function withDesignSets(f: FinancialInput, kind: DesignFeeKind, sets: number): FinancialInput {
  const rate = designRate(f, kind);
  return { ...f, [SETS_KEY[kind]]: sets, [COST_KEY[kind]]: Math.round(sets * rate * 100) / 100 };
}

/** Type a rate: the quantity in force stays (pinned as typed) and the fee follows — column B fixed, column D changed, as on the sheet. */
export function withDesignRate(f: FinancialInput, kind: DesignFeeKind, rate: number): FinancialInput {
  const sets = designSets(f, kind);
  return { ...f, [RATE_KEY[kind]]: rate, [SETS_KEY[kind]]: sets, [COST_KEY[kind]]: Math.round(sets * rate * 100) / 100 };
}

/** Hand the quantity back to the market-rate fee: the typed count and the fee it set are dropped (the caller rebuilds). */
export function clearDesignSets(f: FinancialInput, kind: DesignFeeKind): FinancialInput {
  const next = { ...f };
  delete next[SETS_KEY[kind]];
  return next;
}

/** After a Build: a typed quantity wins over the market-rate fee. */
export function applyTypedDesignSets(f: FinancialInput): FinancialInput {
  let next = f;
  for (const kind of ["autoCad", "ee"] as DesignFeeKind[]) {
    const sets = f[SETS_KEY[kind]];
    if (sets !== undefined) next = { ...next, [COST_KEY[kind]]: Math.round(sets * designRate(f, kind) * 100) / 100 };
  }
  return next;
}
