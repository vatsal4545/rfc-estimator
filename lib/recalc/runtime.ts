// The contract between the evaluator and the function library.

import type { RangeRef, Scalar, Value } from "./values";

/** Where a formula is being evaluated — implicit intersection needs to know. */
export interface Ctx {
  sheet: string;
  row: number;
  col: number;
  /**
   * Array (SUMPRODUCT-style) evaluation. In array context a multi-cell range
   * stays a block and operators broadcast over it; outside one it collapses
   * to the single cell that intersects the formula's own row or column.
   */
  array: boolean;
}

export interface EngineApi {
  /** Collapse a value to one scalar, applying implicit intersection to ranges. */
  scalarOf(v: Value, ctx: Ctx): Scalar;
  /** Materialise a value as a rectangle — a scalar becomes 1×1. */
  gridOf(v: Value): Scalar[][];
  /** The values behind a range reference. */
  refCells(r: RangeRef): Scalar[][];
  /** Note something the caller should see (an unknown function, a cycle). */
  warn(message: string): void;
}

export type FnImpl = (args: Value[], ctx: Ctx, eng: EngineApi) => Value;
