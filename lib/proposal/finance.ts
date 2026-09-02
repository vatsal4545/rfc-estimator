// Time-value-of-money helpers with Excel's conventions, so the model ties to
// the workbook functions the export writes: PMT, NPV (first flow discounted
// one period), IRR (Newton with a bisection fallback), an amortisation
// schedule and the "year cumulative turns positive" payback.

/** Excel PMT for a loan: level payment per period on `principal` at `ratePerPeriod` over `nPeriods`. Positive number. */
export function pmt(ratePerPeriod: number, nPeriods: number, principal: number): number {
  if (nPeriods <= 0) return 0;
  if (ratePerPeriod === 0) return principal / nPeriods;
  return (principal * ratePerPeriod) / (1 - Math.pow(1 + ratePerPeriod, -nPeriods));
}

/** Excel NPV: Σ flows[i] / (1 + rate)^(i + 1) — the first flow is one period out. */
export function npv(rate: number, flows: number[]): number {
  return flows.reduce((s, cf, i) => s + cf / Math.pow(1 + rate, i + 1), 0);
}

/** NPV of a flow series whose first element is at time zero (undiscounted). */
export function npvFromZero(rate: number, flows: number[]): number {
  return flows.reduce((s, cf, i) => s + cf / Math.pow(1 + rate, i), 0);
}

/**
 * Excel IRR on a series starting at time zero. Newton from 10%, bisection on
 * [-0.99, 10] when Newton wanders; null when the flows never change sign or no
 * root is bracketed.
 */
export function irr(flows: number[]): number | null {
  if (flows.length < 2) return null;
  const hasPos = flows.some((f) => f > 0);
  const hasNeg = flows.some((f) => f < 0);
  if (!hasPos || !hasNeg) return null;
  const f = (r: number) => flows.reduce((s, cf, i) => s + cf / Math.pow(1 + r, i), 0);
  const df = (r: number) => flows.reduce((s, cf, i) => s - (i * cf) / Math.pow(1 + r, i + 1), 0);
  let r = 0.1;
  for (let i = 0; i < 60; i++) {
    const y = f(r);
    const d = df(r);
    if (!Number.isFinite(y) || !Number.isFinite(d) || d === 0) break;
    const next = r - y / d;
    if (next <= -0.999 || !Number.isFinite(next)) break;
    if (Math.abs(next - r) < 1e-12) return next;
    r = next;
  }
  if (Number.isFinite(r) && r > -0.999 && Math.abs(f(r)) < 1e-6) return r;
  // Bisection fallback.
  let lo = -0.99;
  let hi = 10;
  let flo = f(lo);
  const fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (flo * fm <= 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

export interface AmortRow {
  n: number;
  opening: number;
  payment: number;
  principal: number;
  interest: number;
  closing: number;
}

/** Level-payment amortisation: interest on the opening balance each period, the rest of the payment retires principal. */
export function amortize(principal: number, ratePerPeriod: number, nPeriods: number, payment: number): AmortRow[] {
  const rows: AmortRow[] = [];
  let balance = principal;
  for (let n = 1; n <= nPeriods; n++) {
    const interest = balance * ratePerPeriod;
    const prin = payment - interest;
    const closing = balance - prin;
    rows.push({ n, opening: balance, payment, principal: prin, interest, closing });
    balance = closing;
  }
  return rows;
}

/**
 * First index whose running total is positive, on a series starting at time
 * zero (BW: MATCH(TRUE, cumulative > 0) − 1). null = never within the series.
 */
export function paybackIndex(flows: number[]): number | null {
  let cum = 0;
  for (let i = 0; i < flows.length; i++) {
    cum += flows[i];
    if (cum > 0) return i;
  }
  return null;
}

/** Excel ROUNDUP(x, 0) for a non-negative x, tolerant of floating-point dust (0.999999999 → 1, 2.0000000001 → 2). */
export function roundUp(x: number): number {
  const eps = 1e-9;
  const c = Math.ceil(x - eps);
  return c <= 0 ? 0 : c;
}
