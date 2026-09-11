export function money(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function num(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

/** Round away binary-float dust at a chosen precision. */
function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// Percentages are stored as fractions (0.2) so that saved projects, the engine,
// the exports and the template never have to care how a field is typed — but
// nobody types "0.2" for 20%. These two convert at the edge, and both round,
// because 0.07 * 100 is 7.000000000000001 in binary floating point and a field
// that renders that is worse than the one it replaced.

/** Stored fraction -> the whole percent shown in an input. */
export function fractionToPct(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return round(fraction * 100, 6);
}

/** Typed percent -> the fraction written back to the project. */
export function pctToFraction(shown: number): number {
  if (!Number.isFinite(shown)) return 0;
  return round(shown / 100, 10);
}
