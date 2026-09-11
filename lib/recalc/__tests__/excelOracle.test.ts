// The engine against Excel itself.
//
// The shipped RFC/MSRP template was last saved by Excel, so every one of its
// 8,385 formula cells carries the value EXCEL computed. Recalculating that
// untouched workbook and diffing cell by cell is the strongest check we can
// run without Excel in the loop: any semantic the engine gets wrong — a
// coercion, an implicit intersection, a criteria match, a rounding — shows up
// here as a disagreement with the authority.
//
// If this test fails after a change to the engine, the engine is wrong.

import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { keyToA1 } from "../a1";
import { Engine } from "../evaluate";
import { readWorkbookGrid } from "../grid";
import { isError, type Scalar } from "../values";
import { RFC_TEMPLATE_PATH } from "../../rfc/__tests__/rfcProject";
import { INTAKE_TEMPLATE } from "../../intake/cells";
import { join } from "node:path";

const INTAKE_TEMPLATE_PATH = join(__dirname, "..", "..", "..", "public", INTAKE_TEMPLATE.publicPath);

function describeValue(v: Scalar): string {
  if (v === null) return "<blank>";
  if (isError(v)) return v.code;
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

/** Same answer, allowing for the last bit of a double. */
function agrees(ours: Scalar, excel: Scalar): boolean {
  if (isError(ours) || isError(excel)) return isError(ours) && isError(excel) && ours.code === excel.code;
  if (typeof ours === "number" && typeof excel === "number") {
    return Math.abs(ours - excel) <= 1e-9 * Math.max(1, Math.abs(ours), Math.abs(excel));
  }
  // Excel stores an empty result as <v/>, which reads back as blank.
  const norm = (v: Scalar) => (v === null ? "" : v);
  return norm(ours) === norm(excel);
}

async function diffAgainstCachedValues(path: string) {
  const book = await readWorkbookGrid(await JSZip.loadAsync(readFileSync(path)));
  const engine = new Engine(book);
  const disagreements: string[] = [];
  let compared = 0;
  for (const sheet of book.sheets) {
    for (const key of [...sheet.formulas.keys()].sort((a, b) => a - b)) {
      const row = Math.floor(key / 16384);
      const col = key % 16384;
      const ours = engine.cellValue(sheet, row, col);
      const excel = sheet.values.get(key) ?? null;
      // Only cells the file actually carries a value for can be compared.
      if (excel === null) continue;
      compared++;
      if (!agrees(ours, excel)) {
        disagreements.push(
          `${sheet.name}!${keyToA1(key)}: Excel ${describeValue(excel)}, engine ${describeValue(ours)} — ${sheet.formulas.get(key)}`,
        );
      }
    }
  }
  return { compared, disagreements, warnings: engine.warnings };
}

describe("the engine reproduces what Excel computed", () => {
  it("matches every cached value in the RFC / MSRP calculator template", async () => {
    const { compared, disagreements, warnings } = await diffAgainstCachedValues(RFC_TEMPLATE_PATH);
    expect(disagreements.slice(0, 10)).toEqual([]);
    expect(disagreements).toHaveLength(0);
    // A guard on the guard: if the template is ever re-cut with no cached
    // values, this test would pass vacuously.
    expect(compared).toBeGreaterThan(3000);
    expect(warnings).toEqual([]);
  });

  it("evaluates the whole intake template, which ships with nothing cached", async () => {
    // The intake template was written by a script, not by Excel: not one of
    // its 750 formulas carries a value, so there is nothing here to diff
    // against. What this asserts instead is that the engine understands the
    // entire sheet — no unsupported function, no parse failure.
    const { compared, disagreements, warnings } = await diffAgainstCachedValues(INTAKE_TEMPLATE_PATH);
    expect(disagreements).toEqual([]);
    expect(compared).toBe(0);
    // One genuine circular reference of the template's own: Revenue!B7 is
    // derived from B95, which reaches B99/B100, whose SUMIFS key off B7.
    // Excel flags it and shows 0; so do we, and we say so.
    expect(warnings.map((w) => `${w.sheet}!${w.ref}: ${w.message}`)).toEqual([
      "Revenue!B7: circular reference — treated as 0, as Excel does",
    ]);
  });
});
