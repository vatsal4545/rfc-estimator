// The worksheet functions the estimator's workbooks use.
//
// Scope is deliberate: every function either of our templates calls, plus the
// obvious neighbours of those, and nothing else. An unknown function yields
// #NAME? and a warning rather than a silent wrong number — see evaluate.ts.
//
// The lazy forms (IF, IFS, IFERROR) are NOT here; they have to see their
// arguments unevaluated, so the evaluator owns them.

import type { Ctx, EngineApi, FnImpl } from "./runtime";
import {
  compare,
  ERR,
  isError,
  isMatrix,
  isRef,
  matrix,
  toBoolean,
  toNumber,
  toText,
  textToNumber,
  XlError,
  type Matrix,
  type RangeRef,
  type Scalar,
  type Value,
} from "./values";

// ---------------------------------------------------------------------------
// Argument plumbing
// ---------------------------------------------------------------------------

function flatten(v: Value, eng: EngineApi): Scalar[] {
  if (isRef(v)) return eng.refCells(v).flat();
  if (isMatrix(v)) return v.rows.flat();
  return [v];
}

/** True when the value came from cells or an array, not a literal argument. */
function isBlock(v: Value): boolean {
  return isRef(v) || isMatrix(v);
}

/**
 * The numbers an aggregate sees. Text and booleans inside a range are
 * skipped, exactly as SUM does; passed directly as an argument they are
 * coerced, which is also what SUM does.
 */
function collectNumbers(args: Value[], eng: EngineApi, ctx: Ctx): number[] | XlError {
  const out: number[] = [];
  for (const arg of args) {
    if (isBlock(arg)) {
      for (const s of flatten(arg, eng)) {
        if (isError(s)) return s;
        if (typeof s === "number") out.push(s);
      }
      continue;
    }
    const s = eng.scalarOf(arg, ctx);
    if (isError(s)) return s;
    if (s === null) continue;
    const n = toNumber(s);
    if (isError(n)) return n;
    out.push(n);
  }
  return out;
}

function num(v: Value, ctx: Ctx, eng: EngineApi): number | XlError {
  return toNumber(eng.scalarOf(v, ctx));
}

function text(v: Value, ctx: Ctx, eng: EngineApi): string | XlError {
  return toText(eng.scalarOf(v, ctx));
}

function firstError(...vs: (number | string | boolean | XlError)[]): XlError | null {
  for (const v of vs) if (isError(v)) return v;
  return null;
}

// ---------------------------------------------------------------------------
// Criteria — the ">0" / "_L2" / "*-1" strings SUMIF and friends take
// ---------------------------------------------------------------------------

export function wildcardToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~" && (pattern[i + 1] === "*" || pattern[i + 1] === "?")) {
      out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      continue;
    }
    if (ch === "*") out += "[\\s\\S]*";
    else if (ch === "?") out += "[\\s\\S]";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

export function criterionMatcher(raw: Scalar): (v: Scalar) => boolean {
  if (isError(raw)) return (v) => isError(v) && v.code === raw.code;
  if (raw === null) return (v) => v === null;
  if (typeof raw !== "string") return (v) => compare(v, raw) === 0;

  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(raw)!;
  const op = m[1] ?? "";
  const rest = m[2];
  const asNumber = textToNumber(rest);
  const target: Scalar = rest === "" ? null : asNumber !== null ? asNumber : rest;

  if (op === "" || op === "=") {
    if (typeof target === "string" && /[*?]/.test(target)) {
      const re = wildcardToRegExp(target);
      return (v) => typeof v === "string" && re.test(v);
    }
    // A bare criterion never matches a blank cell unless it is itself blank.
    if (target === null) return (v) => v === null || v === "";
    return (v) => (v === null ? false : compare(v, target) === 0);
  }
  if (op === "<>") {
    if (typeof target === "string" && /[*?]/.test(target)) {
      const re = wildcardToRegExp(target);
      return (v) => !(typeof v === "string" && re.test(v));
    }
    if (target === null) return (v) => v !== null && v !== "";
    return (v) => (v === null ? true : compare(v, target) !== 0);
  }
  return (v) => {
    if (v === null || isError(v)) return false;
    // Excel does not compare across types for the ordering operators.
    if (typeof target === "number" && typeof v !== "number") return false;
    if (typeof target === "string" && typeof v !== "string") return false;
    const c = compare(v, target);
    if (isError(c)) return false;
    if (op === "<") return c < 0;
    if (op === "<=") return c <= 0;
    if (op === ">") return c > 0;
    return c >= 0;
  };
}

/** Line up a criteria range and the range being summed, cell for cell. */
function alignedCells(range: Value, eng: EngineApi): Scalar[] {
  return flatten(range, eng);
}

function sumIfCore(
  sumCells: Scalar[],
  tests: { cells: Scalar[]; match: (v: Scalar) => boolean }[],
  countOnly: boolean,
): number | XlError {
  let total = 0;
  const n = tests[0]?.cells.length ?? sumCells.length;
  for (let i = 0; i < n; i++) {
    let ok = true;
    for (const t of tests) {
      if (!t.match(t.cells[i] ?? null)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (countOnly) {
      total += 1;
      continue;
    }
    const v = sumCells[i] ?? null;
    if (isError(v)) return v;
    if (typeof v === "number") total += v;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Dates — 1900 serials, the leap-year bug included
// ---------------------------------------------------------------------------

const EPOCH = Date.UTC(1899, 11, 30);

export function serialFromParts(year: number, month: number, day: number): number {
  let y = Math.trunc(year);
  if (y >= 0 && y < 1900) y += 1900;
  const ms = Date.UTC(y, 0, 1) + 0;
  const d = new Date(ms);
  d.setUTCMonth(Math.trunc(month) - 1);
  d.setUTCDate(Math.trunc(day));
  const serial = Math.round((d.getTime() - EPOCH) / 86400000);
  // Excel counts a 29 February 1900 that never happened.
  return serial < 60 ? serial - 1 : serial;
}

export function partsFromSerial(serial: number): { year: number; month: number; day: number } {
  const n = Math.trunc(serial);
  const adjusted = n < 60 ? n + 1 : n;
  const d = new Date(EPOCH + adjusted * 86400000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// ---------------------------------------------------------------------------
// TEXT / number formatting
// ---------------------------------------------------------------------------

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A practical subset of Excel's number formats: enough for TEXT(). */
export function applyNumberFormat(value: number, format: string): string {
  const sections = splitSections(format);
  const negative = value < 0;
  let section = sections[0];
  if (negative && sections[1] !== undefined) section = sections[1];
  else if (value === 0 && sections[2] !== undefined) section = sections[2];
  const useMinus = negative && sections[1] === undefined;

  if (/[ymdhs]/i.test(section.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, ""))) {
    return formatDate(value, section);
  }

  let n = Math.abs(value);
  const percents = (section.match(/%/g) ?? []).length;
  n *= Math.pow(100, percents);

  const [intFmt, decFmt = ""] = splitOutsideQuotes(section, ".");
  const grouping = /,(?=[#0?])/.test(intFmt) || /,+$/.test(intFmt.replace(/[^#0?,]/g, ""));
  const decimals = (decFmt.match(/[0#?]/g) ?? []).length;
  const minInt = (intFmt.match(/0/g) ?? []).length;

  const fixed = n.toFixed(decimals);
  const dp = fixed.split(".")[1] ?? "";
  let ip = fixed.split(".")[0];
  if (minInt > ip.length) ip = ip.padStart(minInt, "0");
  if (minInt === 0 && ip === "0" && decimals > 0 && !/0/.test(intFmt)) ip = "";
  if (grouping && ip) ip = groupThousands(ip);

  let out = "";
  let intDone = false;
  let decIndex = 0;
  const emitInt = () => {
    if (!intDone) {
      out += ip;
      intDone = true;
    }
  };
  let seenDot = false;
  for (let i = 0; i < section.length; i++) {
    const ch = section[i];
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      out += section.slice(i + 1, end < 0 ? section.length : end);
      i = end < 0 ? section.length : end;
      continue;
    }
    if (ch === "\\") {
      out += section[++i] ?? "";
      continue;
    }
    if (ch === "[") {
      const end = section.indexOf("]", i);
      i = end < 0 ? section.length : end;
      continue;
    }
    if (ch === "0" || ch === "#" || ch === "?") {
      if (!seenDot) emitInt();
      else out += dp[decIndex++] ?? "";
      continue;
    }
    if (ch === ",") {
      if (!seenDot && !intDone) continue;
      if (!seenDot) continue;
      out += ",";
      continue;
    }
    if (ch === ".") {
      emitInt();
      seenDot = true;
      if (decimals > 0) out += ".";
      continue;
    }
    if (ch === "%") {
      out += "%";
      continue;
    }
    out += ch;
  }
  if (!intDone) out += ip;
  return (useMinus ? "-" : "") + out;
}

function splitSections(format: string): string[] {
  return splitOutsideQuotes(format, ";");
}

function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      quoted = !quoted;
      cur += ch;
      continue;
    }
    if (ch === "\\") {
      cur += ch + (s[++i] ?? "");
      continue;
    }
    if (!quoted && ch === sep) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatDate(serial: number, format: string): string {
  const p = partsFromSerial(serial);
  const frac = serial - Math.trunc(serial);
  const secondsOfDay = Math.round(frac * 86400);
  const hh = Math.floor(secondsOfDay / 3600);
  const mi = Math.floor((secondsOfDay % 3600) / 60);
  const ss = secondsOfDay % 60;
  const weekday = new Date(EPOCH + Math.trunc(serial) * 86400000).getUTCDay();
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return format.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|"[^"]*"/gi, (tok) => {
    if (tok.startsWith('"')) return tok.slice(1, -1);
    switch (tok.toLowerCase()) {
      case "yyyy":
        return String(p.year);
      case "yy":
        return pad(p.year % 100, 2);
      case "mmmm":
        return MONTHS[p.month - 1];
      case "mmm":
        return MONTHS[p.month - 1].slice(0, 3);
      case "mm":
        return pad(p.month, 2);
      case "m":
        return String(p.month);
      case "dddd":
        return DAYS[weekday];
      case "ddd":
        return DAYS[weekday].slice(0, 3);
      case "dd":
        return pad(p.day, 2);
      case "d":
        return String(p.day);
      case "hh":
        return pad(hh, 2);
      case "h":
        return String(hh);
      case "ss":
        return pad(ss, 2);
      case "s":
        return String(ss);
      default:
        return tok;
    }
  }).replace(/\bmi\b/g, pad(mi, 2));
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

function matchIn(lookup: Scalar, cells: Scalar[], type: number): number | XlError {
  if (isError(lookup)) return lookup;
  if (type === 0) {
    const wildcard = typeof lookup === "string" && /[*?]/.test(lookup);
    const re = wildcard ? wildcardToRegExp(lookup) : null;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i] ?? null;
      if (re) {
        if (typeof v === "string" && re.test(v)) return i + 1;
        continue;
      }
      if (v === null || isError(v)) continue;
      if (compare(v, lookup) === 0) return i + 1;
    }
    return ERR.na;
  }
  // 1 = ascending, largest value <= lookup; -1 = descending, smallest >= lookup.
  let found = -1;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i] ?? null;
    if (v === null || isError(v)) continue;
    const c = compare(v, lookup);
    if (isError(c)) continue;
    if (type === 1 ? c <= 0 : c >= 0) found = i + 1;
    else break;
  }
  return found === -1 ? ERR.na : found;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const FUNCTIONS: Record<string, FnImpl> = {
  // --- maths and aggregation -----------------------------------------------
  SUM: (args, ctx, eng) => {
    const ns = collectNumbers(args, eng, ctx);
    return isError(ns) ? ns : ns.reduce((a, b) => a + b, 0);
  },
  PRODUCT: (args, ctx, eng) => {
    const ns = collectNumbers(args, eng, ctx);
    return isError(ns) ? ns : ns.length === 0 ? 0 : ns.reduce((a, b) => a * b, 1);
  },
  MAX: (args, ctx, eng) => {
    const ns = collectNumbers(args, eng, ctx);
    return isError(ns) ? ns : ns.length === 0 ? 0 : Math.max(...ns);
  },
  MIN: (args, ctx, eng) => {
    const ns = collectNumbers(args, eng, ctx);
    return isError(ns) ? ns : ns.length === 0 ? 0 : Math.min(...ns);
  },
  AVERAGE: (args, ctx, eng) => {
    const ns = collectNumbers(args, eng, ctx);
    if (isError(ns)) return ns;
    return ns.length === 0 ? ERR.div0 : ns.reduce((a, b) => a + b, 0) / ns.length;
  },
  ABS: (args, ctx, eng) => {
    const n = num(args[0], ctx, eng);
    return isError(n) ? n : Math.abs(n);
  },
  SQRT: (args, ctx, eng) => {
    const n = num(args[0], ctx, eng);
    if (isError(n)) return n;
    return n < 0 ? ERR.num : Math.sqrt(n);
  },
  POWER: (args, ctx, eng) => {
    const a = num(args[0], ctx, eng);
    const b = num(args[1], ctx, eng);
    const e = firstError(a, b);
    if (e) return e;
    const r = Math.pow(a as number, b as number);
    return Number.isFinite(r) ? r : ERR.num;
  },
  INT: (args, ctx, eng) => {
    const n = num(args[0], ctx, eng);
    return isError(n) ? n : Math.floor(n);
  },
  MOD: (args, ctx, eng) => {
    const a = num(args[0], ctx, eng);
    const b = num(args[1], ctx, eng);
    const e = firstError(a, b);
    if (e) return e;
    if (b === 0) return ERR.div0;
    return (a as number) - (b as number) * Math.floor((a as number) / (b as number));
  },
  ROUND: (args, ctx, eng) => roundTo(args, ctx, eng, "half"),
  ROUNDUP: (args, ctx, eng) => roundTo(args, ctx, eng, "up"),
  ROUNDDOWN: (args, ctx, eng) => roundTo(args, ctx, eng, "down"),
  CEILING: (args, ctx, eng) => {
    const n = num(args[0], ctx, eng);
    const step = args.length > 1 ? num(args[1], ctx, eng) : 1;
    const e = firstError(n, step);
    if (e) return e;
    if (step === 0) return 0;
    return Math.ceil((n as number) / (step as number)) * (step as number);
  },
  FLOOR: (args, ctx, eng) => {
    const n = num(args[0], ctx, eng);
    const step = args.length > 1 ? num(args[1], ctx, eng) : 1;
    const e = firstError(n, step);
    if (e) return e;
    if (step === 0) return ERR.div0;
    return Math.floor((n as number) / (step as number)) * (step as number);
  },

  // --- logic ---------------------------------------------------------------
  AND: (args, ctx, eng) => {
    let seen = false;
    for (const a of args) {
      for (const s of flatten(a, eng)) {
        if (isError(s)) return s;
        if (s === null || typeof s === "string") continue;
        const b = toBoolean(s);
        if (isError(b)) return b;
        seen = true;
        if (!b) return false;
      }
    }
    return seen ? true : ERR.value;
  },
  OR: (args, ctx, eng) => {
    let seen = false;
    let any = false;
    for (const a of args) {
      for (const s of flatten(a, eng)) {
        if (isError(s)) return s;
        if (s === null || typeof s === "string") continue;
        const b = toBoolean(s);
        if (isError(b)) return b;
        seen = true;
        if (b) any = true;
      }
    }
    return seen ? any : ERR.value;
  },
  NOT: (args, ctx, eng) => {
    const b = toBoolean(eng.scalarOf(args[0], ctx));
    return isError(b) ? b : !b;
  },
  TRUE: () => true,
  FALSE: () => false,
  NA: () => ERR.na,

  // --- information ---------------------------------------------------------
  N: (args, ctx, eng) => {
    const v = eng.scalarOf(args[0], ctx);
    if (isError(v)) return v;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    return 0;
  },
  ISNUMBER: (args, ctx, eng) => typeof eng.scalarOf(args[0], ctx) === "number",
  ISTEXT: (args, ctx, eng) => typeof eng.scalarOf(args[0], ctx) === "string",
  ISBLANK: (args, ctx, eng) => eng.scalarOf(args[0], ctx) === null,
  ISERROR: (args, ctx, eng) => isError(eng.scalarOf(args[0], ctx)),
  ISERR: (args, ctx, eng) => {
    const v = eng.scalarOf(args[0], ctx);
    return isError(v) && v.code !== "#N/A";
  },
  ISNA: (args, ctx, eng) => {
    const v = eng.scalarOf(args[0], ctx);
    return isError(v) && v.code === "#N/A";
  },

  // --- text ----------------------------------------------------------------
  TEXT: (args, ctx, eng) => {
    const v = eng.scalarOf(args[0], ctx);
    if (isError(v)) return v;
    const fmt = text(args[1], ctx, eng);
    if (isError(fmt)) return fmt;
    if (fmt.trim().toUpperCase() === "GENERAL") return toText(v);
    if (typeof v === "string") {
      const parsed = textToNumber(v);
      if (parsed === null) return v;
      return applyNumberFormat(parsed, fmt);
    }
    const n = toNumber(v);
    return isError(n) ? n : applyNumberFormat(n, fmt);
  },
  LEFT: (args, ctx, eng) => {
    const s = text(args[0], ctx, eng);
    if (isError(s)) return s;
    const n = args.length > 1 ? num(args[1], ctx, eng) : 1;
    return isError(n) ? n : s.slice(0, Math.max(0, Math.trunc(n)));
  },
  RIGHT: (args, ctx, eng) => {
    const s = text(args[0], ctx, eng);
    if (isError(s)) return s;
    const n = args.length > 1 ? num(args[1], ctx, eng) : 1;
    if (isError(n)) return n;
    const k = Math.max(0, Math.trunc(n));
    return k === 0 ? "" : s.slice(-k);
  },
  MID: (args, ctx, eng) => {
    const s = text(args[0], ctx, eng);
    const start = num(args[1], ctx, eng);
    const len = num(args[2], ctx, eng);
    const e = firstError(s, start, len);
    if (e) return e;
    if ((start as number) < 1 || (len as number) < 0) return ERR.value;
    return (s as string).substr(Math.trunc(start as number) - 1, Math.trunc(len as number));
  },
  LEN: (args, ctx, eng) => {
    const s = text(args[0], ctx, eng);
    return isError(s) ? s : s.length;
  },
  TRIM: (args, ctx, eng) => {
    const s = text(args[0], ctx, eng);
    return isError(s) ? s : s.replace(/\s+/g, " ").trim();
  },
  UPPER: (args, ctx, eng) => {
    const s = text(args[0], ctx, eng);
    return isError(s) ? s : s.toUpperCase();
  },
  LOWER: (args, ctx, eng) => {
    const s = text(args[0], ctx, eng);
    return isError(s) ? s : s.toLowerCase();
  },
  CONCATENATE: (args, ctx, eng) => {
    let out = "";
    for (const a of args) {
      const s = text(a, ctx, eng);
      if (isError(s)) return s;
      out += s;
    }
    return out;
  },
  EXACT: (args, ctx, eng) => {
    const a = text(args[0], ctx, eng);
    const b = text(args[1], ctx, eng);
    const e = firstError(a, b);
    return e ? e : a === b;
  },
  VALUE: (args, ctx, eng) => {
    const s = text(args[0], ctx, eng);
    if (isError(s)) return s;
    const n = textToNumber(s);
    return n === null ? ERR.value : n;
  },
  SEARCH: (args, ctx, eng) => findIn(args, ctx, eng, false),
  FIND: (args, ctx, eng) => findIn(args, ctx, eng, true),
  SUBSTITUTE: (args, ctx, eng) => {
    const s = text(args[0], ctx, eng);
    const from = text(args[1], ctx, eng);
    const to = text(args[2], ctx, eng);
    const e = firstError(s, from, to);
    if (e) return e;
    if (from === "") return s;
    return (s as string).split(from as string).join(to as string);
  },

  // --- counting and conditional aggregation --------------------------------
  COUNT: (args, ctx, eng) => {
    let n = 0;
    for (const a of args) {
      if (isBlock(a)) {
        for (const s of flatten(a, eng)) if (typeof s === "number") n++;
        continue;
      }
      const s = eng.scalarOf(a, ctx);
      if (typeof s === "number") n++;
      else if (typeof s === "string" && textToNumber(s) !== null) n++;
      else if (typeof s === "boolean") n++;
    }
    return n;
  },
  COUNTA: (args, ctx, eng) => {
    let n = 0;
    for (const a of args) for (const s of flatten(a, eng)) if (s !== null) n++;
    return n;
  },
  COUNTBLANK: (args, ctx, eng) => flatten(args[0], eng).filter((s) => s === null || s === "").length,
  SUMIF: (args, ctx, eng) => {
    const range = alignedCells(args[0], eng);
    const match = criterionMatcher(eng.scalarOf(args[1], ctx));
    const sumCells = args.length > 2 ? alignedCells(args[2], eng) : range;
    return sumIfCore(sumCells, [{ cells: range, match }], false);
  },
  SUMIFS: (args, ctx, eng) => {
    const sumCells = alignedCells(args[0], eng);
    const tests: { cells: Scalar[]; match: (v: Scalar) => boolean }[] = [];
    for (let i = 1; i + 1 < args.length; i += 2) {
      tests.push({ cells: alignedCells(args[i], eng), match: criterionMatcher(eng.scalarOf(args[i + 1], ctx)) });
    }
    return sumIfCore(sumCells, tests, false);
  },
  COUNTIF: (args, ctx, eng) => {
    const range = alignedCells(args[0], eng);
    const match = criterionMatcher(eng.scalarOf(args[1], ctx));
    return sumIfCore(range, [{ cells: range, match }], true);
  },
  COUNTIFS: (args, ctx, eng) => {
    const tests: { cells: Scalar[]; match: (v: Scalar) => boolean }[] = [];
    for (let i = 0; i + 1 < args.length; i += 2) {
      tests.push({ cells: alignedCells(args[i], eng), match: criterionMatcher(eng.scalarOf(args[i + 1], ctx)) });
    }
    return sumIfCore([], tests, true);
  },
  SUMPRODUCT: (args, ctx, eng) => {
    const grids = args.map((a) => eng.gridOf(a));
    const rows = Math.max(...grids.map((g) => g.length));
    const cols = Math.max(...grids.map((g) => g[0]?.length ?? 0));
    let total = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let product = 1;
        for (const g of grids) {
          const cell = pick(g, r, c);
          if (isError(cell)) return cell;
          // Text and blanks count as zero, which zeroes the whole product.
          product *= typeof cell === "number" ? cell : typeof cell === "boolean" ? (cell ? 1 : 0) : 0;
          if (product === 0) break;
        }
        total += product;
      }
    }
    return total;
  },

  // --- references ----------------------------------------------------------
  ROW: (args, ctx) => {
    if (args.length === 0) return ctx.row;
    const a = args[0];
    return isRef(a) ? a.r1 : ctx.row;
  },
  COLUMN: (args, ctx) => {
    if (args.length === 0) return ctx.col;
    const a = args[0];
    return isRef(a) ? a.c1 : ctx.col;
  },
  ROWS: (args, ctx, eng) => {
    const a = args[0];
    return isRef(a) ? a.r2 - a.r1 + 1 : eng.gridOf(a).length;
  },
  COLUMNS: (args, ctx, eng) => {
    const a = args[0];
    return isRef(a) ? a.c2 - a.c1 + 1 : (eng.gridOf(a)[0]?.length ?? 0);
  },
  INDEX: (args, ctx, eng) => {
    const source = args[0];
    const rowArg = args.length > 1 ? num(args[1], ctx, eng) : 0;
    if (isError(rowArg)) return rowArg;
    const colArg = args.length > 2 ? num(args[2], ctx, eng) : 0;
    if (isError(colArg)) return colArg;
    const r = Math.trunc(rowArg);
    const c = Math.trunc(colArg);
    if (isRef(source)) {
      const height = source.r2 - source.r1 + 1;
      const width = source.c2 - source.c1 + 1;
      // One-dimensional ranges take a single index along their own axis.
      let rowIdx = r;
      let colIdx = c;
      if (args.length === 2 && height === 1 && width > 1) {
        rowIdx = 1;
        colIdx = r;
      }
      if (rowIdx < 0 || colIdx < 0 || rowIdx > height || colIdx > width) return ERR.ref;
      const r1 = rowIdx === 0 ? source.r1 : source.r1 + rowIdx - 1;
      const r2 = rowIdx === 0 ? source.r2 : r1;
      const c1 = colIdx === 0 ? source.c1 : source.c1 + colIdx - 1;
      const c2 = colIdx === 0 ? source.c2 : c1;
      const out: RangeRef = { kind: "ref", sheet: source.sheet, r1, c1, r2, c2 };
      return out;
    }
    const grid = eng.gridOf(source);
    const height = grid.length;
    const width = grid[0]?.length ?? 0;
    let rowIdx = r;
    let colIdx = c;
    if (args.length === 2 && height === 1 && width > 1) {
      rowIdx = 1;
      colIdx = r;
    }
    if (rowIdx < 1 || colIdx < 0 || rowIdx > height || colIdx > width) return ERR.ref;
    if (colIdx === 0) return matrix([grid[rowIdx - 1]]);
    return grid[rowIdx - 1][colIdx - 1] ?? null;
  },
  MATCH: (args, ctx, eng) => {
    const lookup = eng.scalarOf(args[0], ctx);
    const cells = flatten(args[1], eng);
    const typeArg = args.length > 2 ? num(args[2], ctx, eng) : 1;
    if (isError(typeArg)) return typeArg;
    return matchIn(lookup, cells, Math.trunc(typeArg));
  },
  VLOOKUP: (args, ctx, eng) => {
    const lookup = eng.scalarOf(args[0], ctx);
    const table = args[1];
    const colArg = num(args[2], ctx, eng);
    if (isError(colArg)) return colArg;
    const approx = args.length > 3 ? toBoolean(eng.scalarOf(args[3], ctx)) : true;
    if (isError(approx)) return approx;
    const grid = eng.gridOf(table);
    const col = Math.trunc(colArg);
    if (col < 1 || col > (grid[0]?.length ?? 0)) return ERR.ref;
    const first = grid.map((r) => r[0] ?? null);
    const at = matchIn(lookup, first, approx ? 1 : 0);
    if (isError(at)) return at;
    return grid[at - 1][col - 1] ?? null;
  },

  // --- finance -------------------------------------------------------------
  PMT: (args, ctx, eng) => {
    const rate = num(args[0], ctx, eng);
    const nper = num(args[1], ctx, eng);
    const pv = num(args[2], ctx, eng);
    const fv = args.length > 3 ? num(args[3], ctx, eng) : 0;
    const type = args.length > 4 ? num(args[4], ctx, eng) : 0;
    const e = firstError(rate, nper, pv, fv, type);
    if (e) return e;
    return pmt(rate as number, nper as number, pv as number, fv as number, type as number);
  },

  // --- dates ---------------------------------------------------------------
  DATE: (args, ctx, eng) => {
    const y = num(args[0], ctx, eng);
    const m = num(args[1], ctx, eng);
    const d = num(args[2], ctx, eng);
    const e = firstError(y, m, d);
    if (e) return e;
    const serial = serialFromParts(y as number, m as number, d as number);
    return serial < 0 ? ERR.num : serial;
  },
  YEAR: (args, ctx, eng) => datePart(args, ctx, eng, "year"),
  MONTH: (args, ctx, eng) => datePart(args, ctx, eng, "month"),
  DAY: (args, ctx, eng) => datePart(args, ctx, eng, "day"),
  TODAY: () => {
    const now = new Date();
    return serialFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
  },
  NOW: () => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return serialFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate()) + (now.getTime() - midnight) / 86400000;
  },
  EOMONTH: (args, ctx, eng) => {
    const start = num(args[0], ctx, eng);
    const months = num(args[1], ctx, eng);
    const e = firstError(start, months);
    if (e) return e;
    const p = partsFromSerial(start as number);
    return serialFromParts(p.year, p.month + Math.trunc(months as number) + 1, 0);
  },
};

/** Functions that map over an array argument element by element. */
export const ELEMENTWISE = new Set([
  "N",
  "ISNUMBER",
  "ISTEXT",
  "ISBLANK",
  "ISERROR",
  "ISERR",
  "ISNA",
  "SEARCH",
  "FIND",
  "LEFT",
  "RIGHT",
  "MID",
  "LEN",
  "TRIM",
  "UPPER",
  "LOWER",
  "TEXT",
  "VALUE",
  "EXACT",
  "ABS",
  "INT",
  "ROUND",
  "ROUNDUP",
  "ROUNDDOWN",
  "SQRT",
  "MOD",
  "POWER",
  "NOT",
  "YEAR",
  "MONTH",
  "DAY",
  "DATE",
]);

function pick(grid: Scalar[][], r: number, c: number): Scalar {
  const row = grid.length === 1 ? grid[0] : grid[r];
  if (!row) return ERR.na;
  const cell = row.length === 1 ? row[0] : row[c];
  return cell === undefined ? ERR.na : cell;
}

function roundTo(args: Value[], ctx: Ctx, eng: EngineApi, mode: "half" | "up" | "down"): Value {
  const n = num(args[0], ctx, eng);
  const digitsArg = args.length > 1 ? num(args[1], ctx, eng) : 0;
  const e = firstError(n, digitsArg);
  if (e) return e;
  const digits = Math.trunc(digitsArg as number);
  const factor = Math.pow(10, digits);
  const scaled = (n as number) * factor;
  // Nudge away from binary representation error before deciding the digit.
  const nudged = Number(scaled.toPrecision(15));
  const sign = nudged < 0 ? -1 : 1;
  const abs = Math.abs(nudged);
  const rounded = mode === "half" ? Math.round(abs) : mode === "up" ? Math.ceil(abs) : Math.floor(abs);
  return (sign * rounded) / factor;
}

function findIn(args: Value[], ctx: Ctx, eng: EngineApi, caseSensitive: boolean): Value {
  const needle = text(args[0], ctx, eng);
  const hay = text(args[1], ctx, eng);
  const startArg = args.length > 2 ? num(args[2], ctx, eng) : 1;
  const e = firstError(needle, hay, startArg);
  if (e) return e;
  const from = Math.max(1, Math.trunc(startArg as number)) - 1;
  if (!caseSensitive && /[*?]/.test(needle as string)) {
    const re = wildcardToRegExp(`*${needle}*`);
    if (!re.test(hay as string)) return ERR.value;
  }
  const at = caseSensitive
    ? (hay as string).indexOf(needle as string, from)
    : (hay as string).toUpperCase().indexOf((needle as string).toUpperCase(), from);
  return at < 0 ? ERR.value : at + 1;
}

function datePart(args: Value[], ctx: Ctx, eng: EngineApi, part: "year" | "month" | "day"): Value {
  const n = num(args[0], ctx, eng);
  if (isError(n)) return n;
  if (n < 0) return ERR.num;
  return partsFromSerial(n)[part];
}

export function pmt(rate: number, nper: number, pv: number, fv = 0, type = 0): number | XlError {
  if (nper === 0) return ERR.num;
  if (rate === 0) return -(pv + fv) / nper;
  const factor = Math.pow(1 + rate, nper);
  const payment = (-rate * (pv * factor + fv)) / ((1 + rate * (type ? 1 : 0)) * (factor - 1));
  return Number.isFinite(payment) ? payment : ERR.num;
}

export function matrixOfRow(row: Scalar[]): Matrix {
  return matrix([row]);
}
