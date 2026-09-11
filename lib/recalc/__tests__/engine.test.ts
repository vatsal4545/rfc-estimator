// Unit tests for the formula engine: the semantics that are easy to get
// subtly wrong and expensive to get wrong silently.

import { describe, expect, it } from "vitest";
import { cellKey, parseA1, translateFormula } from "../a1";
import { Engine } from "../evaluate";
import type { SheetGrid, WorkbookGrid } from "../grid";
import { applyNumberFormat, criterionMatcher, partsFromSerial, pmt, serialFromParts } from "../functions";
import { tokenize } from "../parse";
import { compare, generalFormat, isError, toNumber, type Scalar } from "../values";

/** A workbook from a literal: "=..." is a formula, anything else a constant. */
function book(sheets: Record<string, Record<string, Scalar | string>>): WorkbookGrid {
  const grids: SheetGrid[] = Object.entries(sheets).map(([name, cells]) => {
    const grid: SheetGrid = { name, path: `${name}.xml`, values: new Map(), formulas: new Map(), maxRow: 0, maxCol: 0 };
    for (const [ref, value] of Object.entries(cells)) {
      const at = parseA1(ref)!;
      const key = cellKey(at.row, at.col);
      grid.maxRow = Math.max(grid.maxRow, at.row);
      grid.maxCol = Math.max(grid.maxCol, at.col);
      if (typeof value === "string" && value.startsWith("=")) grid.formulas.set(key, value.slice(1));
      else grid.values.set(key, value);
    }
    return grid;
  });
  const byName = new Map(grids.map((g) => [g.name.toUpperCase(), g]));
  return {
    order: grids.map((g) => g.name),
    sheets: grids,
    sheet: (n) => byName.get(n.toUpperCase()),
    names: new Map(),
    localNames: new Map(),
  };
}

function value(wb: WorkbookGrid, sheet: string, ref: string): Scalar {
  const at = parseA1(ref)!;
  return new Engine(wb).cellValue(wb.sheet(sheet)!, at.row, at.col);
}

/** Evaluate one formula in a sheet of constants. */
function evalIn(cells: Record<string, Scalar | string>, formula: string, at = "Z1"): Scalar {
  const wb = book({ S: { ...cells, [at]: `=${formula}` } });
  return value(wb, "S", at);
}

describe("coercion", () => {
  it("keeps blank distinct from empty text", () => {
    expect(evalIn({ A1: null }, 'A1=""')).toBe(true);
    expect(evalIn({ A1: null }, "A1=0")).toBe(true);
    expect(evalIn({ A1: "" }, "A1=0")).toBe(false);
    expect(evalIn({ A1: 0 }, 'A1=""')).toBe(false);
  });

  it("orders types the way Excel does: number < text < boolean", () => {
    expect(compare(5, "5")).toBe(-1);
    expect(compare("abc", true)).toBe(-1);
    expect(compare("ABC", "abc")).toBe(0);
  });

  it("formats numbers into text the way & does", () => {
    expect(generalFormat(120)).toBe("120");
    expect(generalFormat(1 / 3)).toBe("0.333333333333333");
    expect(evalIn({ A1: 120 }, '"L3 ("&A1&" kW)"')).toBe("L3 (120 kW)");
  });

  it("treats a formula's blank result as 0, as Excel caches it", () => {
    expect(evalIn({}, "A1")).toBe(0);
  });

  it("propagates errors instead of throwing", () => {
    expect(isError(evalIn({ A1: 0 }, "1/A1"))).toBe(true);
    expect(evalIn({ A1: 0 }, 'IFERROR(1/A1,"safe")')).toBe("safe");
    expect(evalIn({}, "SUM(1,NOTAFUNCTION(2))")).toSatisfy((v: Scalar) => isError(v) && v.code === "#NAME?");
  });
});

describe("operators", () => {
  it("binds unary minus tighter than the power operator", () => {
    expect(evalIn({}, "-2^2")).toBe(4);
    expect(evalIn({}, "0-2^2")).toBe(-4);
  });

  it("reads a percent literal as a hundredth", () => {
    expect(evalIn({ A1: 1000 }, "A1*7.25%")).toBeCloseTo(72.5, 10);
    expect(evalIn({ A1: 100 }, "(10%*A1)+A1")).toBeCloseTo(110, 10);
  });

  it("computes the line total the export was getting wrong", () => {
    // INPUT SHEET!K8 = IF(OR($G8="",$I8=""),"",J8-(H8*J8))
    const cells = { G8: 54000, H8: 0.15, I8: 6, J8: 324000 };
    expect(evalIn(cells, 'IF(OR($G8="",$I8=""),"",J8-(H8*J8))', "K8")).toBe(275400);
    expect(evalIn({ ...cells, G8: "", I8: "" }, 'IF(OR($G8="",$I8=""),"",J8-(H8*J8))', "K8")).toBe("");
  });
});

describe("references", () => {
  it("resolves a full-column reference against the used range", () => {
    const wb = book({
      Book: { C3: "SKU-1", F3: 54000, C4: "SKU-2", F4: 12000 },
      S: { E8: "SKU-2", G8: "=IFERROR(INDEX(Book!$F:$F,MATCH($E8,Book!$C:$C,0)),\"\")" },
    });
    expect(value(wb, "S", "G8")).toBe(12000);
  });

  it("intersects a multi-row range with the formula's own row", () => {
    // The DLL amortisation schedule is written entirely this way.
    const wb = book({
      S: { A1: 10, A2: 20, A3: 30, B2: "=A1:A3*2" },
    });
    expect(value(wb, "S", "B2")).toBe(40);
  });

  it("gives #VALUE! when nothing intersects", () => {
    const wb = book({ S: { A1: 10, A2: 20, D9: "=A1:A2*2" } });
    expect(value(wb, "S", "D9")).toSatisfy((v: Scalar) => isError(v) && v.code === "#VALUE!");
  });

  it("follows a defined name, including one that is itself a formula", () => {
    const wb = book({ S: { A1: 4, B1: "=Doubled+1" } });
    wb.names.set("DOUBLED", "S!A1*2");
    expect(value(wb, "S", "B1")).toBe(9);
  });

  it("treats a circular reference as 0 and says so", () => {
    const wb = book({ S: { A1: "=B1+1", B1: "=A1+1" } });
    const engine = new Engine(wb);
    expect(engine.cellValue(wb.sheet("S")!, 1, 1)).toBe(0);
    expect(engine.warnings.map((w) => w.message)).toContain("circular reference — treated as 0, as Excel does");
  });
});

describe("functions", () => {
  it("matches SUMIF and SUMIFS criteria, wildcards included", () => {
    const cells = {
      D8: "_L2", E8: "CTX-A", I8: 3,
      D9: "_kW60", E9: "TP5-60-1", I9: 2,
      D10: "_L2", E10: "CTX-2-1", I10: 5,
    };
    expect(evalIn(cells, 'SUMIF($D$8:$D$10,"_L2",$I$8:$I$10)')).toBe(8);
    expect(evalIn(cells, 'SUMIFS($I$8:$I$10,$D$8:$D$10,"_L2",$E$8:$E$10,"*-1")')).toBe(5);
    expect(evalIn(cells, 'SUMIF($D$8:$D$10,"_kW"&60,$I$8:$I$10)')).toBe(2);
  });

  it("compares criteria only within a type", () => {
    const gt = criterionMatcher(">0");
    expect(gt(5)).toBe(true);
    expect(gt(-1)).toBe(false);
    expect(gt("text")).toBe(false);
    expect(gt(null)).toBe(false);
  });

  it("evaluates SUMPRODUCT as an array expression", () => {
    // INPUT SHEET!N9 — the dual-port count.
    const cells = {
      D8: "_L2", F8: "Dual port L2", I8: 2,
      D9: "_L2", F9: "Single port", I9: 3,
      D10: "_kW60", F10: "Dual DC", I10: 4,
    };
    const formula = 'SUMPRODUCT(($D$8:$D$10="_L2")*(1+ISNUMBER(SEARCH("dual",$F$8:$F$10&"")))*IF($I$8:$I$10="",0,$I$8:$I$10))';
    expect(evalIn(cells, formula)).toBe(2 * 2 + 3);
  });

  it("does MATCH exact, ascending and descending", () => {
    const cells = { A1: 100, A2: 60, A3: 20, A4: 0 };
    expect(evalIn(cells, "MATCH(60,A1:A4,0)")).toBe(2);
    expect(evalIn(cells, "MATCH(0.01,A1:A4,-1)")).toBe(3);
    expect(evalIn({ B1: 1, B2: 5, B3: 9 }, "MATCH(6,B1:B3,1)")).toBe(2);
  });

  it("computes PMT the way the DLL schedule needs it", () => {
    // 967,955.10 over 5 years, monthly, at 8.5%.
    const payment = pmt(0.085 / 12, 60, 967955.1);
    expect(payment).toBeCloseTo(-19859.08, 2);
    expect(pmt(0, 10, 1000)).toBe(-100);
  });

  it("round-trips dates through Excel's 1900 serials", () => {
    expect(serialFromParts(2026, 9, 10)).toBe(46275);
    expect(partsFromSerial(46275)).toEqual({ year: 2026, month: 9, day: 10 });
    // Month overflow is how the schedule steps a year at a time.
    expect(serialFromParts(2026, 13, 10)).toBe(serialFromParts(2027, 1, 10));
  });

  it("formats numbers for TEXT", () => {
    expect(applyNumberFormat(1234.567, "#,##0")).toBe("1,235");
    expect(applyNumberFormat(0.0725, "0.00%")).toBe("7.25%");
    expect(applyNumberFormat(-42, "+#,##0;-#,##0")).toBe("-42");
    expect(applyNumberFormat(1234.5, "$#,##0")).toBe("$1,235");
    expect(applyNumberFormat(3.14159, "0.0")).toBe("3.1");
  });

  it("rounds the way Excel does, not the way binary floats do", () => {
    expect(evalIn({}, "ROUND(2.675,2)")).toBe(2.68);
    expect(evalIn({}, "ROUNDUP(1.001,2)")).toBe(1.01);
    expect(toNumber("7.25%")).toBeCloseTo(0.0725, 10);
  });
});

describe("shared formulas", () => {
  it("shifts the relative parts of a reference and leaves the absolute ones", () => {
    expect(translateFormula("IF(E9=\"\",\"\",I9*G9)", 3, 0)).toBe('IF(E12="","",I12*G12)');
    expect(translateFormula("SUM($H$18:$H18)", 5, 0)).toBe("SUM($H$18:$H23)");
    expect(translateFormula("'CTX Price Book'!$F$3+A1", 1, 1)).toBe("'CTX Price Book'!$F$3+B2");
  });

  it("leaves text and function names alone", () => {
    expect(translateFormula('IF(A1="B2",LOG10(A1),0)', 1, 0)).toBe('IF(A2="B2",LOG10(A2),0)');
  });
});

describe("the tokenizer", () => {
  it("reads a sheet-qualified name apart from a reference", () => {
    expect(tokenize("'DLL Schedule'!Loan_Amount")).toEqual([{ k: "name", v: "Loan_Amount", sheet: "DLL Schedule" }]);
    expect(tokenize("'CTX Price Book'!$C$3")).toEqual([{ k: "ref", v: "C3", sheet: "CTX Price Book" }]);
  });

  it("strips the _xlfn prefix newer functions carry", () => {
    expect(tokenize("_xlfn.IFS(A1=1,2)")[0]).toEqual({ k: "func", v: "IFS" });
  });
});
