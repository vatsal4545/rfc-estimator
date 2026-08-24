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
