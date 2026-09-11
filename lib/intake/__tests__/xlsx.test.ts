import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkbook, serialToIsoDate, unescapeXml } from "../xlsx";

const TEMPLATE = join(__dirname, "..", "..", "..", "templates", "source", "EVSE_Project_Intake_TEMPLATE_3.1.0.xlsx");
const FIXTURE = join(__dirname, "..", "__fixtures__", "intake-sample-3.1.0.xlsx");

describe("xlsx reader", () => {
  it("reads the CEO's intake template, which ExcelJS cannot open", async () => {
    const wb = await readWorkbook(readFileSync(TEMPLATE));
    expect(wb.sheetNames).toEqual([
      "Version", "README", "Project", "Existing", "Equipment", "Electrical", "Construction", "Commercial",
      "Revenue", "Carbon", "Deal_Structure", "Overrides", "PriceBook", "RefData", "Utilities", "RateLibrary",
    ]);
    expect(wb.get("Version", "B4")).toBe("3.1.0");
    expect(wb.get("Version", "B8")).toBe("4aecae7d4b5f25a9");
    expect(wb.get("Project", "B22")).toBe(24);
    expect(wb.get("Project", "B23")).toBe(365);
    expect(wb.get("Commercial", "B21")).toBe(0.0839);
    expect(wb.get("RateLibrary", "F5")).toBe(0.35711);
    expect(wb.get("Existing", "C150")).toBe(0.85);
    // Shared strings with non-ASCII text survive.
    expect(wb.get("Utilities", "A5")).toBe("PG&E — Pacific Gas and Electric");
    expect(wb.get("Existing", "B5")).toBe("Greenfield — new service");
    // A script-generated template carries formulas with no cached value: null value, formula text present.
    expect(wb.get("Revenue", "B6")).toBeNull();
    expect(wb.formula("Revenue", "B6")).toContain("B$91");
    expect(wb.get("Project", "B99")).toBeNull();
    expect(wb.has("Nope")).toBe(false);
    expect(wb.get("Nope", "A1")).toBeNull();
  });

  it("reads dates and openpyxl-written values from the filled fixture", async () => {
    const wb = await readWorkbook(readFileSync(FIXTURE));
    expect(wb.get("Project", "B5")).toBe("Best Western Hawthorne");
    expect(wb.get("Project", "B33")).toBe("2026-09-01"); // a date cell → ISO string
    expect(wb.get("Version", "B11")).toBe("2026-09-02");
    expect(wb.get("Equipment", "I7")).toBe(4);
    expect(wb.get("Existing", "B67")).toBe(9800);
    expect(wb.get("Existing", "C67")).toBeCloseTo(5390, 6);
    expect(wb.get("Overrides", "B26")).toBe(0.62);
    expect(wb.cells("Existing").size).toBeGreaterThan(100);
  });

  it("helpers: XML entities and Excel serial dates", () => {
    expect(unescapeXml("PG&amp;E &lt;x&gt; &quot;q&quot; &#8212; &#x2014;")).toBe('PG&E <x> "q" — —');
    expect(serialToIsoDate(45900)).toBe("2025-08-31");
    expect(serialToIsoDate(46266)).toBe("2026-09-01");
  });
});
