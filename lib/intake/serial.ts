// Excel serial dates, shared by the reader, the writer and the fill plan.

/** ISO yyyy-mm-dd → Excel serial date (1900 system). null when the text is not a date. */
export function isoToSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(ms)) return null;
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86400000);
}
