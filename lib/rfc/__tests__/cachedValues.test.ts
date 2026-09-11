// Every formula cell in a real export carries its computed result.
//
// This is the regression guard for the bug where the RFC/MSRP export shipped
// formulas with no cached values (or, worse, with the blank template's stale
// ones). Excel recalculates on open and shows the right numbers, so the file
// looks fine to a human and reads as blanks and zeroes to openpyxl, pandas,
// SheetJS and the downstream proposal generator.
//
// The workbook under test is a FILLED one — four DC chargers, two L2 and an
// accessory. An empty export passes both checks trivially and proves nothing.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeEstimate } from "../../calc/engine";
import { computeProposal } from "../../proposal";
import { readWorkbookGrid } from "../../recalc/grid";
import { auditFormulaCells } from "../../recalc/verify";
import { cellKey, parseA1 } from "../../recalc/a1";
import { fillRfcWorkbook } from "../fillRfc";
import { RFC_TEMPLATE_PATH, rfcProject } from "./rfcProject";
import JSZip from "jszip";

describe("cached values in a freshly generated RFC export", async () => {
  const project = rfcProject();
  const result = computeEstimate(project);
  const proposal = computeProposal(project, result)!;
  const { bytes, report } = await fillRfcWorkbook(readFileSync(RFC_TEMPLATE_PATH), project, result, proposal);

  const audit = await auditFormulaCells(bytes);
  const book = await readWorkbookGrid(await JSZip.loadAsync(bytes));

  /** A cell's cached value, straight out of the file. */
  const cached = (sheet: string, ref: string) => {
    const at = parseA1(ref)!;
    return book.sheet(sheet)!.values.get(cellKey(at.row, at.col)) ?? null;
  };
  const number = (sheet: string, ref: string) => {
    const v = cached(sheet, ref);
    expect(typeof v, `${sheet}!${ref} should be numeric, got ${JSON.stringify(v)}`).toBe("number");
    return v as number;
  };

  it("has equipment on it, so the checks below are not vacuous", () => {
    expect(cached("INPUT SHEET", "E8")).toBe("TP5-360-480-2-300");
    expect(cached("INPUT SHEET", "I8")).toBe(4);
    expect(report.equipment.length).toBeGreaterThan(1);
    expect(audit.cells.length).toBeGreaterThan(8000);
  });

  // --- Check 1 -------------------------------------------------------------

  it("leaves no formula cell without a cached result", () => {
    // Read off the XML, not through a reader: a formula returning "" is
    // stored as <v/> and every reader reports that as None, so a reader
    // cannot tell "computed, empty" from "never computed".
    expect(audit.missing.slice(0, 20)).toEqual([]);
    expect(audit.missing).toHaveLength(0);
  });

  it("gives every formula with a real answer a value a reader can see", () => {
    // The openpyxl view of check 1: whatever is not an empty string must come
    // back as a value. This is the check the downstream app effectively runs.
    const invisible = audit.cells.filter((c) => c.cached && c.value === null && c.raw !== "");
    expect(invisible.map((c) => `${c.sheet}!${c.ref}`)).toEqual([]);
  });

  it("keeps the formulas, so the workbook is still live in Excel", () => {
    // Values alone would read fine and cost the recipient the model.
    const stillLive = [...book.sheets].reduce((n, s) => n + s.formulas.size, 0);
    expect(stillLive).toBe(audit.cells.length);
    expect(cached("INPUT SHEET", "K8")).toBeGreaterThan(0);
    expect(book.sheet("INPUT SHEET")!.formulas.get(cellKey(8, 11))).toContain("J8-(H8*J8)");
  });

  // --- Check 2 -------------------------------------------------------------

  it("agrees with its own inputs on the Internal Summary — no stale answers", () => {
    const stale: string[] = [];
    for (let row = 3; row <= 28; row++) {
      const listed = cached("Internal Summary", `B${row}`);
      const discount = cached("Internal Summary", `C${row}`) ?? 0;
      const customer = cached("Internal Summary", `D${row}`);
      if (typeof listed !== "number" || listed === 0) continue;
      if (typeof customer !== "number" || typeof discount !== "number") continue;
      const expected = listed - listed * discount;
      if (Math.abs(customer - expected) > 0.01) {
        stale.push(`Internal Summary!D${row}: cached ${customer.toFixed(2)}, expected ${expected.toFixed(2)}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("carries the equipment line arithmetic through the INPUT SHEET", () => {
    for (let row = 8; row <= 37; row++) {
      const sku = cached("INPUT SHEET", `E${row}`);
      if (typeof sku !== "string" || sku === "") continue;
      const msrp = number("INPUT SHEET", `G${row}`);
      const qty = number("INPUT SHEET", `I${row}`);
      const lineMsrp = number("INPUT SHEET", `J${row}`);
      const discount = (cached("INPUT SHEET", `H${row}`) as number) ?? 0;
      expect(msrp, `${sku} priced from the workbook's own price book`).toBeGreaterThan(0);
      expect(lineMsrp).toBeCloseTo(qty * msrp, 6);
      expect(number("INPUT SHEET", `K${row}`)).toBeCloseTo(lineMsrp - discount * lineMsrp, 6);
    }
  });

  // --- The chain the downstream proposal generator reads -------------------

  it("carries a real number the whole way down to the loan amount", () => {
    // K8 blank was what zeroed Internal Summary D30, Financial Worksheet B44
    // and DLL Schedule D5 (Loan_Amount), which made the downstream app
    // suppress every financing section.
    const lineTotal = number("INPUT SHEET", "K8");
    const grand = number("Internal Summary", "D30");
    const financed = number("Financial Worksheet", "B44");
    const loan = number("DLL Schedule", "D5");
    const payment = number("DLL Schedule", "J5");

    expect(lineTotal).toBeGreaterThan(0);
    expect(grand).toBeGreaterThan(0);
    expect(financed).toBeCloseTo(grand, 6);
    expect(loan).toBeCloseTo(grand, 6);
    expect(payment).toBeGreaterThan(0);

    // The amortisation schedule actually amortises rather than sitting blank.
    expect(number("DLL Schedule", "C18")).toBeCloseTo(loan, 6);
    expect(number("DLL Schedule", "I18")).toBeLessThan(loan);
  });

  it("lands the workbook's grand total on the app's customer price", () => {
    expect(number("Internal Summary", "D30")).toBeCloseTo(proposal.costBuildup.customerPrice, 2);
  });

  it("reports what it recalculated, and finds nothing it could not do", () => {
    expect(report.recalc?.evaluated).toBe(audit.cells.length);
    expect(report.recalc?.warnings ?? []).toEqual([]);
    // The blank template ships 60 #VALUE! cells on Cashflow (arithmetic on an
    // empty loan payment). A filled workbook has a loan, so they resolve.
    expect(report.recalc?.errors ?? []).toEqual([]);
  });
});
