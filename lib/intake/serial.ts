// Excel serial dates, shared by the reader, the writer and the fill plan.

/** ISO yyyy-mm-dd → Excel serial date (1900 system). null when the text is not a date. */
export function isoToSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(ms)) return null;
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86400000);
}

/** Excel serial date (1900 system) → ISO yyyy-mm-dd. */
export function serialToIso(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** A cell that should hold a date — a serial, an ISO string or a datetime string — as ISO yyyy-mm-dd; "" when it is neither. */
export function cellToIso(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) return serialToIso(v);
  if (typeof v === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
    if (m) return m[1];
  }
  return "";
}
