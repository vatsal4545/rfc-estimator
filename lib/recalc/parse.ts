// Formula text → AST.
//
// A tokenizer and a precedence-climbing parser for the A1 formula grammar as
// it appears in a saved workbook: no localisation, no R1C1, no whitespace
// significance beyond the intersection operator (which nothing here uses).
// Sheet-qualified references and defined names, error literals and the
// _xlfn. prefix on newer functions are all handled.

import { ERR, ERR_BY_CODE, type XlError } from "./values";

export type Node =
  | { t: "blank" }
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: XlError }
  | { t: "ref"; sheet?: string; a1: string }
  | { t: "name"; sheet?: string; name: string }
  | { t: "call"; name: string; args: Node[] }
  | { t: "bin"; op: BinOp; l: Node; r: Node }
  | { t: "neg"; x: Node }
  | { t: "pct"; x: Node }
  | { t: "array"; rows: Node[][] };

export type BinOp = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";

interface Token {
  k: "num" | "str" | "err" | "ref" | "name" | "func" | "op" | "(" | ")" | "," | ";" | "{" | "}" | "%";
  v?: string;
  n?: number;
  sheet?: string;
}

const CELL = "\\$?[A-Za-z]{1,3}\\$?\\d{1,7}";
const COLS = "\\$?[A-Za-z]{1,3}";
const ROWS = "\\$?\\d{1,7}";
const REF_BODY = new RegExp(`^(?:(?:${CELL})(?::(?:${CELL}))?|(?:${COLS}):(?:${COLS})|(?:${ROWS}):(?:${ROWS}))`);
const NAME_CHARS = /^[A-Za-z_\\][A-Za-z0-9_.\\?]*/;
const ERR_LITERAL = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)/;

/** `'A Sheet'!` or `Sheet1!` at the head of `s`; also `[1]Sheet!` from a link. */
function sheetPrefix(s: string): { name: string; len: number } | null {
  if (s.startsWith("'")) {
    let i = 1;
    let name = "";
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          name += "'";
          i += 2;
          continue;
        }
        break;
      }
      name += s[i++];
    }
    if (s[i] !== "'" || s[i + 1] !== "!") return null;
    return { name: name.replace(/^\[\d+\]/, ""), len: i + 2 };
  }
  const m = /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(s);
  return m ? { name: m[1], len: m[0].length } : null;
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = rest[0];
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = 1;
      let v = "";
      while (j < rest.length) {
        if (rest[j] === '"') {
          if (rest[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += rest[j++];
      }
      out.push({ k: "str", v });
      i += j + 1;
      continue;
    }
    if (ch === "#") {
      const e = ERR_LITERAL.exec(rest);
      out.push({ k: "err", v: e ? e[0] : "#VALUE!" });
      i += e ? e[0].length : 1;
      continue;
    }
    if (/[\d.]/.test(ch)) {
      const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest);
      if (num) {
        out.push({ k: "num", n: Number(num[0]) });
        i += num[0].length;
        continue;
      }
    }
    const two = rest.slice(0, 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      out.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>".includes(ch)) {
      out.push({ k: "op", v: ch });
      i++;
      continue;
    }
    if ("()".includes(ch) || ch === "," || ch === ";" || ch === "{" || ch === "}" || ch === "%") {
      out.push({ k: ch as Token["k"] });
      i++;
      continue;
    }
    // A sheet prefix, a reference, a defined name or a function name.
    const pre = sheetPrefix(rest);
    const after = pre ? rest.slice(pre.len) : rest;
    if (pre && after.startsWith("#REF!")) {
      out.push({ k: "err", v: "#REF!" });
      i += pre.len + 5;
      continue;
    }
    const refm = REF_BODY.exec(after);
    // A1-looking text is a reference only when what follows cannot extend it
    // into a longer name (LOG10, A1B, TRUE1 …).
    if (refm && !/^[A-Za-z0-9_.]/.test(after.slice(refm[0].length))) {
      out.push({ k: "ref", v: refm[0].replace(/\$/g, "").toUpperCase(), sheet: pre?.name });
      i += (pre?.len ?? 0) + refm[0].length;
      continue;
    }
    const nm = NAME_CHARS.exec(after);
    if (nm) {
      const raw = nm[0];
      const bare = raw.replace(/^_xlfn\./i, "").replace(/^_xludf\./i, "");
      const tail = after.slice(raw.length);
      if (/^\s*\(/.test(tail) && !pre) {
        out.push({ k: "func", v: bare.toUpperCase() });
        i += raw.length;
        continue;
      }
      const upper = bare.toUpperCase();
      if (!pre && (upper === "TRUE" || upper === "FALSE")) {
        out.push({ k: "name", v: upper });
        i += raw.length;
        continue;
      }
      out.push({ k: "name", v: bare, sheet: pre?.name });
      i += (pre?.len ?? 0) + raw.length;
      continue;
    }
    throw new Error(`cannot parse formula near "${rest.slice(0, 24)}"`);
  }
  return out;
}

const PRECEDENCE: Record<BinOp, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(): Token | undefined {
    return this.toks[this.i];
  }

  private take(): Token {
    const t = this.toks[this.i++];
    if (!t) throw new Error("formula ended early");
    return t;
  }

  private expect(k: Token["k"]): Token {
    const t = this.take();
    if (t.k !== k) throw new Error(`expected ${k}, got ${t.k}${t.v ? ` "${t.v}"` : ""}`);
    return t;
  }

  parse(): Node {
    const n = this.expr(0);
    if (this.i !== this.toks.length) {
      const t = this.toks[this.i];
      throw new Error(`unexpected trailing "${t.v ?? t.k}"`);
    }
    return n;
  }

  private expr(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== "op") break;
      const op = t.v as BinOp;
      const prec = PRECEDENCE[op];
      if (prec === undefined || prec < minPrec) break;
      this.i++;
      // Every binary operator here is left-associative (2^3^2 is 64).
      const right = this.expr(prec + 1);
      left = { t: "bin", op, l: left, r: right };
    }
    return left;
  }

  /** Unary minus binds tighter than ^ : -2^2 is 4. */
  private unary(): Node {
    const t = this.peek();
    if (t?.k === "op" && (t.v === "-" || t.v === "+")) {
      this.i++;
      const x = this.unary();
      return t.v === "-" ? { t: "neg", x } : x;
    }
    return this.postfix(this.primary());
  }

  private postfix(node: Node): Node {
    let n = node;
    while (this.peek()?.k === "%") {
      this.i++;
      n = { t: "pct", x: n };
    }
    return n;
  }

  private primary(): Node {
    const t = this.take();
    switch (t.k) {
      case "num":
        return { t: "num", v: t.n! };
      case "str":
        return { t: "str", v: t.v! };
      case "err":
        return { t: "err", v: ERR_BY_CODE[t.v!] ?? ERR.value };
      case "ref":
        return { t: "ref", sheet: t.sheet, a1: t.v! };
      case "name":
        if (!t.sheet && (t.v === "TRUE" || t.v === "FALSE")) return { t: "bool", v: t.v === "TRUE" };
        return { t: "name", sheet: t.sheet, name: t.v! };
      case "func": {
        this.expect("(");
        const args: Node[] = [];
        if (this.peek()?.k !== ")") {
          for (;;) {
            args.push(this.argument());
            const nx = this.peek();
            if (nx?.k === "," || nx?.k === ";") {
              this.i++;
              continue;
            }
            break;
          }
        }
        this.expect(")");
        return { t: "call", name: t.v!, args };
      }
      case "(": {
        const inner = this.expr(0);
        this.expect(")");
        return inner;
      }
      case "{": {
        const rows: Node[][] = [];
        let row: Node[] = [];
        for (;;) {
          row.push(this.expr(0));
          const nx = this.take();
          if (nx.k === ",") continue;
          if (nx.k === ";") {
            rows.push(row);
            row = [];
            continue;
          }
          if (nx.k === "}") {
            rows.push(row);
            break;
          }
          throw new Error("bad array literal");
        }
        return { t: "array", rows };
      }
      default:
        throw new Error(`unexpected ${t.k}${t.v ? ` "${t.v}"` : ""}`);
    }
  }

  /** An omitted argument — IF(a,,b) — is a blank, not a syntax error. */
  private argument(): Node {
    const t = this.peek();
    if (!t || t.k === "," || t.k === ";" || t.k === ")") return { t: "blank" };
    return this.expr(0);
  }
}

const cache = new Map<string, Node>();

/** Parse a formula (without its leading "="). Memoized: workbooks repeat themselves. */
export function parseFormula(src: string): Node {
  const hit = cache.get(src);
  if (hit) return hit;
  const node = new Parser(tokenize(src)).parse();
  if (cache.size < 20000) cache.set(src, node);
  return node;
}
