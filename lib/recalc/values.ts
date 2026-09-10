// The value model the recalculation engine works in — Excel's, not
// JavaScript's. Blank is not "", FALSE is not 0, and an error is a value that
// propagates rather than an exception.
//
// Everything here is pure and has no idea what a workbook is.

export type ErrCode = "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A";

/** An Excel error value. Compared by code, never thrown. */
export class XlError {
  constructor(readonly code: ErrCode) {}
  toString(): string {
    return this.code;
  }
}

export const ERR = {
  null: new XlError("#NULL!"),
  div0: new XlError("#DIV/0!"),
  value: new XlError("#VALUE!"),
  ref: new XlError("#REF!"),
  name: new XlError("#NAME?"),
  num: new XlError("#NUM!"),
  na: new XlError("#N/A"),
} as const;

export const ERR_BY_CODE: Record<string, XlError> = Object.fromEntries(
  Object.values(ERR).map((e) => [e.code, e]),
);

/** A single cell's worth of value. `null` is blank — distinct from "". */
export type Scalar = number | string | boolean | XlError | null;

/** A rectangular block of scalars: the value of a range or of an array expression. */
export interface Matrix {
  readonly kind: "matrix";
  readonly rows: Scalar[][];
}

/**
 * A live reference. Kept unresolved for as long as possible because several
 * functions (INDEX, MATCH, SUMIF, ROW, COUNTA) care about the range itself,
 * and because scalar use of a multi-cell range means implicit intersection,
 * which depends on where the formula lives.
 */
export interface RangeRef {
  readonly kind: "ref";
  readonly sheet: string;
  /** 1-based, inclusive, r1<=r2 and c1<=c2. */
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

export type Value = Scalar | Matrix | RangeRef;

export function isError(v: unknown): v is XlError {
  return v instanceof XlError;
}

export function isMatrix(v: Value): v is Matrix {
  return typeof v === "object" && v !== null && (v as Matrix).kind === "matrix";
}

export function isRef(v: Value): v is RangeRef {
  return typeof v === "object" && v !== null && (v as RangeRef).kind === "ref";
}

export function matrix(rows: Scalar[][]): Matrix {
  return { kind: "matrix", rows };
}

export function singleCell(r: RangeRef): boolean {
  return r.r1 === r.r2 && r.c1 === r.c2;
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/** Excel's General format, which is what & and TEXT-free concatenation use. */
export function generalFormat(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "#NUM!" : "#NUM!";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  // 15 significant digits, trailing zeros dropped — "x"&(1/3) is
  // "x0.333333333333333" in Excel, not the full binary expansion.
  const s = n.toPrecision(15);
  if (s.includes("e") || s.includes("E")) return String(Number(s));
  return s.replace(/\.?0+$/, "");
}

export function toText(v: Scalar): string | XlError {
  if (isError(v)) return v;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return generalFormat(v);
  return v;
}

/** Parse the numeric strings Excel accepts where a number is wanted. */
export function textToNumber(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  let body = t;
  let scale = 1;
  if (body.endsWith("%")) {
    body = body.slice(0, -1).trim();
    scale = 0.01;
  }
  if (/^\$?-?[\d,]*\.?\d+(e[+-]?\d+)?$/i.test(body)) {
    const n = Number(body.replace(/[$,]/g, ""));
    if (Number.isFinite(n)) return n * scale;
  }
  return null;
}

export function toNumber(v: Scalar): number | XlError {
  if (isError(v)) return v;
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = textToNumber(v);
  return n === null ? ERR.value : n;
}

export function toBoolean(v: Scalar): boolean | XlError {
  if (isError(v)) return v;
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const upper = v.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  const n = textToNumber(v);
  return n === null ? ERR.value : n !== 0;
}

/** Sort rank of a scalar's type, for < and >: number < text < FALSE < TRUE. */
function typeRank(v: Scalar): number {
  if (typeof v === "number") return 0;
  if (typeof v === "string") return 1;
  return 2;
}

/**
 * Excel's comparison. Returns -1/0/1, or an error if either side is one.
 * Blank takes the type of the other side: blank=0 and blank="" are both TRUE.
 */
export function compare(a: Scalar, b: Scalar): number | XlError {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === "string" && typeof b === "string") {
    const x = a.toUpperCase();
    const y = b.toUpperCase();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  const x = typeof a === "boolean" ? (a ? 1 : 0) : (a as number);
  const y = typeof b === "boolean" ? (b ? 1 : 0) : (b as number);
  return x === y ? 0 : x < y ? -1 : 1;
}
