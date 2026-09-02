import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkbook } from "../xlsx";
import { colIndex, escapeXml, isoToSerial, patchSheetXml, patchWorkbook } from "../xlsxWrite";

const TEMPLATE = join(__dirname, "..", "..", "..", "templates", "source", "EVSE_Project_Intake_TEMPLATE_2.9.0.xlsx");

describe("xlsx writer", () => {
  it("writes strings, numbers, dates and new rows into the CEO's template and reads them back", async () => {
    const res = await patchWorkbook(readFileSync(TEMPLATE), [
      { sheet: "Project", ref: "B5", value: 'Best Western "Hawthorne" & Co <LLC>' },
      { sheet: "Project", ref: "B22", value: 20 },
      { sheet: "Project", ref: "B33", value: isoToSerial("2026-09-01") }, // m/d/yyyy cell
      { sheet: "Project", ref: "B34", value: 0.0725 },
      { sheet: "Version", ref: "B11", value: "2026-09-02" }, // General cell — ISO text
      { sheet: "Existing", ref: "A67", value: "2025-09" },
      { sheet: "Existing", ref: "B67", value: 9800 },
      { sheet: "Existing", ref: "Z999", value: 1 }, // no such row in the template
      { sheet: "Equipment", ref: "I7", value: 4 },
      { sheet: "Equipment", ref: "I8", value: null }, // clear
      { sheet: "Revenue", ref: "B12", value: 5 }, // formula cell → refused
      { sheet: "Nope", ref: "A1", value: 1 }, // no sheet → refused
    ]);
    expect(res.refused).toEqual([
      "Nope!A1: no such sheet",
      "Revenue!B12: the template cell holds a formula — left as is",
    ]);
    expect(res.written).toBe(10);

    const wb = await readWorkbook(res.bytes);
    expect(wb.get("Project", "B5")).toBe('Best Western "Hawthorne" & Co <LLC>');
    expect(wb.get("Project", "B22")).toBe(20);
    expect(wb.get("Project", "B33")).toBe("2026-09-01");
    expect(wb.get("Project", "B34")).toBe(0.0725);
    expect(wb.get("Version", "B11")).toBe("2026-09-02");
    expect(wb.get("Existing", "A67")).toBe("2025-09");
    expect(wb.get("Existing", "B67")).toBe(9800);
    expect(wb.get("Existing", "Z999")).toBe(1);
    expect(wb.get("Equipment", "I7")).toBe(4);
    expect(wb.get("Equipment", "I8")).toBeNull();
    // Untouched parts survive: the template identity, a formula, another sheet's constants.
    expect(wb.get("Version", "B4")).toBe("2.9.0");
    expect(wb.formula("Revenue", "B12")).toBe("Project!B22");
    expect(wb.get("RateLibrary", "F5")).toBe(0.35711);
    expect(wb.sheetNames).toHaveLength(16);
  });

  it("keeps the placeholder cell's style and orders inserted cells by column", () => {
    const xml =
      '<worksheet><sheetData><row r="5" spans="1:3"><c r="A5" s="1" t="inlineStr"><is><t>Label</t></is></c><c r="B5" s="7" t="n"></c></row><row r="9"><c r="D9" s="2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>';
    const out = patchSheetXml(xml, [
      { sheet: "S", ref: "B5", value: 42 },
      { sheet: "S", ref: "C5", value: "new" },
      { sheet: "S", ref: "A5", value: "Changed" },
      { sheet: "S", ref: "B7", value: true },
      { sheet: "S", ref: "A12", value: 3.5 },
      { sheet: "S", ref: "D9", value: 9 },
      { sheet: "S", ref: "bad ref", value: 1 },
    ]);
    expect(out.xml).toBe(
      '<worksheet><sheetData><row r="5" spans="1:3"><c r="A5" s="1" t="inlineStr"><is><t xml:space="preserve">Changed</t></is></c><c r="B5" s="7" t="n"><v>42</v></c><c r="C5" t="inlineStr"><is><t xml:space="preserve">new</t></is></c></row>' +
        '<row r="7"><c r="B7" t="b"><v>1</v></c></row>' +
        '<row r="9"><c r="D9" s="2"><f>1+1</f><v>2</v></c></row>' +
        '<row r="12"><c r="A12" t="n"><v>3.5</v></c></row></sheetData></worksheet>',
    );
    expect(out.written).toBe(5);
    expect(out.refused).toEqual(["S!bad ref: not a cell reference", "S!D9: the template cell holds a formula — left as is"]);
  });

  it("helpers", () => {
    expect(escapeXml('a<b>&"c"')).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
    expect(isoToSerial("2026-09-01")).toBe(46266);
    expect(isoToSerial("2025-08-31")).toBe(45900);
    expect(isoToSerial("Rev A")).toBeNull();
    expect(colIndex("A")).toBe(1);
    expect(colIndex("Z")).toBe(26);
    expect(colIndex("AA")).toBe(27);
  });
});
