// The evaluator: an AST plus a workbook grid in, one scalar per cell out.
//
// Cells are computed on demand and memoised, so a cell is evaluated once no
// matter how many formulas read it. The lazy forms (IF, IFS, IFERROR) live
// here because they must see their arguments unevaluated — both for
// correctness (IFERROR has to catch, not inherit) and for speed (the DLL
// amortisation schedule guards 480 rows of arithmetic behind one IF).

import { cellKey, colToNum, keyToA1, MAX_COL, parseA1 } from "./a1";
import { ELEMENTWISE, FUNCTIONS } from "./functions";
import type { SheetGrid, WorkbookGrid } from "./grid";
import { parseFormula, type BinOp, type Node } from "./parse";
import type { Ctx, EngineApi } from "./runtime";
import {
  compare,
  ERR,
  isError,
  isMatrix,
  isRef,
  matrix,
  singleCell,
  toNumber,
  toText,
  XlError,
  type Matrix,
  type RangeRef,
  type Scalar,
  type Value,
} from "./values";

export interface RecalcWarning {
  sheet: string;
  ref: string;
  message: string;
}

export class Engine implements EngineApi {
  private readonly cache = new Map<string, Scalar>();
  private readonly active = new Set<string>();
  readonly warnings: RecalcWarning[] = [];
  private warnAt: { sheet: string; ref: string } = { sheet: "", ref: "" };

  constructor(private readonly book: WorkbookGrid) {}

  warn(message: string): void {
    if (this.warnings.length < 200) this.warnings.push({ ...this.warnAt, message });
  }

  // -------------------------------------------------------------------------
  // Cells
  // -------------------------------------------------------------------------

  /** The value of one cell: its constant, or its formula evaluated. */
  cellValue(sheet: SheetGrid, row: number, col: number): Scalar {
    const key = cellKey(row, col);
    const formula = sheet.formulas.get(key);
    if (formula === undefined) return sheet.values.get(key) ?? null;

    const id = `${sheet.name}!${key}`;
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;
    if (this.active.has(id)) {
      // A circular reference. Excel with iterative calculation off shows 0;
      // saying so in the report is the useful part.
      this.noteCycle(sheet.name, keyToA1(key));
      return 0;
    }

    this.active.add(id);
    const cyclesBefore = this.cycleHits;
    let value: Scalar;
    try {
      const ctx: Ctx = { sheet: sheet.name, row, col, array: false };
      const before = this.warnAt;
      this.warnAt = { sheet: sheet.name, ref: keyToA1(key) };
      const computed = this.scalarOf(this.eval(parseFormula(formula), ctx), ctx);
      // A formula never yields a blank: =A1 against an empty A1 is 0, which
      // is what Excel caches.
      value = computed === null ? 0 : computed;
      this.warnAt = before;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.warnings.push({ sheet: sheet.name, ref: keyToA1(key), message });
      value = sheet.values.get(key) ?? ERR.value;
    } finally {
      this.active.delete(id);
    }
    // Anything computed through a cycle is not an answer; Excel shows 0 in
    // every cell of the loop and so do we.
    if (this.cycleHits > cyclesBefore) value = 0;
    this.cache.set(id, value);
    return value;
  }

  private cycles = new Set<string>();
  private cycleHits = 0;

  private noteCycle(sheet: string, ref: string): void {
    this.cycleHits++;
    const id = `${sheet}!${ref}`;
    if (this.cycles.has(id)) return;
    this.cycles.add(id);
    this.warnings.push({ sheet, ref, message: "circular reference — treated as 0, as Excel does" });
  }

  // -------------------------------------------------------------------------
  // EngineApi
  // -------------------------------------------------------------------------

  scalarOf(v: Value, ctx: Ctx): Scalar {
    if (isRef(v)) {
      const at = intersect(v, ctx);
      if (isError(at)) return at;
      const sheet = this.book.sheet(v.sheet);
      if (!sheet) return ERR.ref;
      return this.cellValue(sheet, at.row, at.col);
    }
    if (isMatrix(v)) return v.rows[0]?.[0] ?? null;
    return v;
  }

  gridOf(v: Value): Scalar[][] {
    if (isRef(v)) return this.refCells(v);
    if (isMatrix(v)) return v.rows;
    return [[v]];
  }

  refCells(r: RangeRef): Scalar[][] {
    const sheet = this.book.sheet(r.sheet);
    if (!sheet) return [[ERR.ref]];
    const out: Scalar[][] = [];
    const lastRow = Math.min(r.r2, Math.max(sheet.maxRow, r.r1));
    const lastCol = Math.min(r.c2, Math.max(sheet.maxCol, r.c1));
    for (let row = r.r1; row <= lastRow; row++) {
      const line: Scalar[] = [];
      for (let col = r.c1; col <= lastCol; col++) line.push(this.cellValue(sheet, row, col));
      out.push(line);
    }
    return out.length === 0 ? [[null]] : out;
  }

  // -------------------------------------------------------------------------
  // Expressions
  // -------------------------------------------------------------------------

  eval(node: Node, ctx: Ctx): Value {
    switch (node.t) {
      case "blank":
        return null;
      case "num":
        return node.v;
      case "str":
        return node.v;
      case "bool":
        return node.v;
      case "err":
        return node.v;
      case "ref":
        return this.resolveRef(node.a1, node.sheet ?? ctx.sheet);
      case "name":
        return this.resolveName(node, ctx);
      case "neg": {
        const v = toNumber(this.scalarOf(this.eval(node.x, ctx), ctx));
        return isError(v) ? v : -v;
      }
      case "pct": {
        const v = toNumber(this.scalarOf(this.eval(node.x, ctx), ctx));
        return isError(v) ? v : v / 100;
      }
      case "array":
        return matrix(node.rows.map((r) => r.map((n) => this.scalarOf(this.eval(n, ctx), ctx))));
      case "bin":
        return this.binary(node.op, node.l, node.r, ctx);
      case "call":
        return this.call(node.name, node.args, ctx);
    }
  }

  private resolveRef(a1: string, sheetName: string): Value {
    const parsed = parseRange(a1);
    if (!parsed) return ERR.ref;
    const sheet = this.book.sheet(sheetName);
    if (!sheet) return ERR.ref;
    const r2 = parsed.r2 === Infinity ? Math.max(sheet.maxRow, parsed.r1) : parsed.r2;
    const c2 = parsed.c2 === Infinity ? Math.max(sheet.maxCol, parsed.c1) : parsed.c2;
    return { kind: "ref", sheet: sheet.name, r1: parsed.r1, c1: parsed.c1, r2, c2 };
  }

  private resolveName(node: { sheet?: string; name: string }, ctx: Ctx): Value {
    const key = node.name.toUpperCase();
    const owner = node.sheet ?? ctx.sheet;
    const local = this.book.localNames.get(this.book.sheet(owner)?.name ?? owner)?.get(key);
    const definition = local ?? this.book.names.get(key);
    if (definition === undefined) {
      this.warn(`unknown name "${node.name}"`);
      return ERR.name;
    }
    if (definition.includes("#REF!")) return ERR.ref;
    // A name is an expression evaluated where it is used: relative parts of
    // its definition resolve against the calling cell.
    return this.eval(parseFormula(definition.replace(/^=/, "")), { ...ctx, sheet: node.sheet ?? ctx.sheet });
  }

  private call(name: string, args: Node[], ctx: Ctx): Value {
    switch (name) {
      case "IF":
        return this.ifCall(args, ctx);
      case "IFS":
        return this.ifsCall(args, ctx);
      case "IFERROR":
      case "IFNA":
        return this.ifErrorCall(name, args, ctx);
      case "CHOOSE":
        return this.chooseCall(args, ctx);
    }
    const impl = FUNCTIONS[name];
    if (!impl) {
      this.warn(`unsupported function ${name}()`);
      return ERR.name;
    }
    const array = ctx.array || name === "SUMPRODUCT";
    const argCtx: Ctx = array === ctx.array ? ctx : { ...ctx, array };
    const values = args.map((a) => this.eval(a, argCtx));
    if (ctx.array && ELEMENTWISE.has(name)) {
      return this.vectorize(values, ctx, (row) => impl(row, ctx, this));
    }
    return impl(values, argCtx, this);
  }

  /** Apply a scalar function across the widest argument, Excel array style. */
  private vectorize(values: Value[], ctx: Ctx, apply: (args: Value[]) => Value): Value {
    const grids = values.map((v) => (isRef(v) && !singleCell(v)) || isMatrix(v) ? this.gridOf(v) : null);
    if (!grids.some((g) => g !== null)) return apply(values);
    const rows = Math.max(...grids.map((g) => g?.length ?? 1));
    const cols = Math.max(...grids.map((g) => g?.[0]?.length ?? 1));
    const out: Scalar[][] = [];
    for (let r = 0; r < rows; r++) {
      const line: Scalar[] = [];
      for (let c = 0; c < cols; c++) {
        const row = values.map((v, i) => {
          const g = grids[i];
          return g ? broadcast(g, r, c) : this.scalarOf(v, ctx);
        });
        const got = apply(row);
        line.push(this.scalarOf(got, ctx));
      }
      out.push(line);
    }
    return matrix(out);
  }

  private ifCall(args: Node[], ctx: Ctx): Value {
    const condition = this.eval(args[0] ?? { t: "blank" }, ctx);
    if (ctx.array && ((isRef(condition) && !singleCell(condition)) || isMatrix(condition))) {
      const grid = this.gridOf(condition);
      const whenTrue = args[1] ? this.eval(args[1], ctx) : true;
      const whenFalse = args[2] ? this.eval(args[2], ctx) : false;
      const tg = this.gridOf(whenTrue);
      const fg = this.gridOf(whenFalse);
      return matrix(
        grid.map((line, r) =>
          line.map((cell, c) => {
            const b = truthy(cell);
            if (isError(b)) return b;
            return broadcast(b ? tg : fg, r, c);
          }),
        ),
      );
    }
    const b = truthy(this.scalarOf(condition, ctx));
    if (isError(b)) return b;
    const branch = b ? args[1] : args[2];
    if (!branch) return b ? true : false;
    return this.eval(branch, ctx);
  }

  private ifsCall(args: Node[], ctx: Ctx): Value {
    for (let i = 0; i + 1 < args.length; i += 2) {
      const b = truthy(this.scalarOf(this.eval(args[i], ctx), ctx));
      if (isError(b)) return b;
      if (b) return this.eval(args[i + 1], ctx);
    }
    return ERR.na;
  }

  private ifErrorCall(name: string, args: Node[], ctx: Ctx): Value {
    const value = this.eval(args[0] ?? { t: "blank" }, ctx);
    const caught = (s: Scalar) => (name === "IFNA" ? isError(s) && s.code === "#N/A" : isError(s));
    if (ctx.array && ((isRef(value) && !singleCell(value)) || isMatrix(value))) {
      const fallback = this.gridOf(args[1] ? this.eval(args[1], ctx) : "");
      return matrix(this.gridOf(value).map((line, r) => line.map((cell, c) => (caught(cell) ? broadcast(fallback, r, c) : cell))));
    }
    const s = this.scalarOf(value, ctx);
    if (!caught(s)) return s;
    return args[1] ? this.eval(args[1], ctx) : "";
  }

  private chooseCall(args: Node[], ctx: Ctx): Value {
    const pick = toNumber(this.scalarOf(this.eval(args[0], ctx), ctx));
    if (isError(pick)) return pick;
    const at = Math.trunc(pick);
    if (at < 1 || at >= args.length) return ERR.value;
    return this.eval(args[at], ctx);
  }

  private binary(op: BinOp, lNode: Node, rNode: Node, ctx: Ctx): Value {
    const l = this.eval(lNode, ctx);
    const r = this.eval(rNode, ctx);
    const lArray = (isRef(l) && !singleCell(l) && ctx.array) || isMatrix(l);
    const rArray = (isRef(r) && !singleCell(r) && ctx.array) || isMatrix(r);
    if (lArray || rArray) {
      const lg = lArray ? this.gridOf(l) : [[this.scalarOf(l, ctx)]];
      const rg = rArray ? this.gridOf(r) : [[this.scalarOf(r, ctx)]];
      const rows = Math.max(lg.length, rg.length);
      const cols = Math.max(lg[0]?.length ?? 1, rg[0]?.length ?? 1);
      const out: Scalar[][] = [];
      for (let i = 0; i < rows; i++) {
        const line: Scalar[] = [];
        for (let j = 0; j < cols; j++) line.push(scalarBinary(op, broadcast(lg, i, j), broadcast(rg, i, j)));
        out.push(line);
      }
      return matrix(out);
    }
    return scalarBinary(op, this.scalarOf(l, ctx), this.scalarOf(r, ctx));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function broadcast(grid: Scalar[][], r: number, c: number): Scalar {
  const row = grid.length === 1 ? grid[0] : grid[r];
  if (!row) return ERR.na;
  const cell = row.length === 1 ? row[0] : row[c];
  return cell === undefined ? ERR.na : cell;
}

function truthy(v: Scalar): boolean | XlError {
  if (isError(v)) return v;
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const upper = v.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE" || upper === "") return false;
  return ERR.value;
}

export function scalarBinary(op: BinOp, a: Scalar, b: Scalar): Scalar {
  if (op === "&") {
    const x = toText(a);
    if (isError(x)) return x;
    const y = toText(b);
    return isError(y) ? y : x + y;
  }
  if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
    const c = compare(a, b);
    if (isError(c)) return c;
    switch (op) {
      case "=":
        return c === 0;
      case "<>":
        return c !== 0;
      case "<":
        return c < 0;
      case ">":
        return c > 0;
      case "<=":
        return c <= 0;
      default:
        return c >= 0;
    }
  }
  const x = toNumber(a);
  if (isError(x)) return x;
  const y = toNumber(b);
  if (isError(y)) return y;
  switch (op) {
    case "+":
      return x + y;
    case "-":
      return x - y;
    case "*":
      return x * y;
    case "/":
      return y === 0 ? ERR.div0 : x / y;
    default: {
      const p = Math.pow(x, y);
      return Number.isFinite(p) ? p : ERR.num;
    }
  }
}

/**
 * Legacy implicit intersection: a multi-cell range used where one value is
 * wanted collapses to the cell in the formula's own row (for a column range)
 * or its own column (for a row range). The DLL amortisation schedule is
 * written entirely in this style — `Beg_Bal` means "this row's balance".
 */
export function intersect(r: RangeRef, ctx: Ctx): { row: number; col: number } | XlError {
  if (r.r1 === r.r2 && r.c1 === r.c2) return { row: r.r1, col: r.c1 };
  if (r.c1 === r.c2 && ctx.row >= r.r1 && ctx.row <= r.r2) return { row: ctx.row, col: r.c1 };
  if (r.r1 === r.r2 && ctx.col >= r.c1 && ctx.col <= r.c2) return { row: r.r1, col: ctx.col };
  return ERR.value;
}

/** "A1", "A1:B4", "C:C" or "3:7" → row/column bounds; Infinity means "the whole sheet". */
export function parseRange(a1: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const [left, right] = a1.split(":");
  if (right === undefined) {
    const at = parseA1(left);
    return at ? { r1: at.row, c1: at.col, r2: at.row, c2: at.col } : null;
  }
  const a = parseA1(left);
  const b = parseA1(right);
  if (a && b) {
    return {
      r1: Math.min(a.row, b.row),
      c1: Math.min(a.col, b.col),
      r2: Math.max(a.row, b.row),
      c2: Math.max(a.col, b.col),
    };
  }
  if (/^[A-Za-z]{1,3}$/.test(left) && /^[A-Za-z]{1,3}$/.test(right)) {
    const c1 = colToNum(left);
    const c2 = colToNum(right);
    return { r1: 1, c1: Math.min(c1, c2), r2: Infinity, c2: Math.max(c1, c2) };
  }
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const r1 = Number(left);
    const r2 = Number(right);
    return { r1: Math.min(r1, r2), c1: 1, r2: Math.max(r1, r2), c2: MAX_COL };
  }
  return null;
}

export type { Matrix };
