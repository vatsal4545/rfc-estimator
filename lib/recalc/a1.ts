// A1 arithmetic: column letters, cell keys, and the reference shifting a
// shared formula needs.

export const MAX_COL = 16384;

export function colToNum(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Cell key used by the grid — one integer per cell, cheap to hash. */
export function cellKey(row: number, col: number): number {
  return row * MAX_COL + col;
}

export function keyToA1(key: number): string {
  return numToCol(key % MAX_COL) + Math.floor(key / MAX_COL);
}

export function parseA1(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim());
  return m ? { row: Number(m[2]), col: colToNum(m[1]) } : null;
}

/**
 * Shift the relative parts of every reference in a formula by (dRow, dCol) —
 * what Excel does when it stores one shared formula for a whole column and
 * lets each cell derive its own. Quoted strings and sheet names are skipped.
 */
export function translateFormula(src: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return src;
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      const end = closingQuote(src, i, '"');
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "'") {
      const end = closingQuote(src, i, "'");
      out += src.slice(i, end);
      i = end;
      continue;
    }
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/.exec(src.slice(i));
    // Only when it is a whole token: not part of a longer name, and not
    // preceded by a name character (so LOG10 and A1B are left alone).
    const prev = out[out.length - 1] ?? "";
    const after = src.slice(i + (m?.[0].length ?? 0));
    // A trailing "(" makes it a function name (LOG10), not a reference.
    if (m && !/[A-Za-z0-9_.$]/.test(prev) && !/^[A-Za-z0-9_.(]/.test(after)) {
      const col = m[1] === "$" ? colToNum(m[2]) : colToNum(m[2]) + dCol;
      const row = m[3] === "$" ? Number(m[4]) : Number(m[4]) + dRow;
      out += col < 1 || row < 1 || col > MAX_COL ? "#REF!" : `${m[1]}${numToCol(col)}${m[3]}${row}`;
      i += m[0].length;
      continue;
    }
    // Skip whole identifiers so their trailing digits are never mistaken for
    // a row number on the next pass.
    const id = /^[A-Za-z_\\][A-Za-z0-9_.\\?]*/.exec(src.slice(i));
    if (id) {
      out += id[0];
      i += id[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Index just past the closing quote of the run starting at `start`. */
function closingQuote(src: string, start: number, q: string): number {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === q) {
      if (src[i + 1] === q) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return src.length;
}
