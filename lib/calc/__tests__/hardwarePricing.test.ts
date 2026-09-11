import { describe, expect, it } from "vitest";
import { PRICE_BOOK } from "../../ref/priceBook";
import { HARDWARE_ALLOWANCE, HARDWARE_ALLOWANCE_BASIS } from "../autoplan";
import { DEFAULT_LOAD_TYPES } from "../tables";

// The per-model allowance is what a charger costs before anyone picks a SKU,
// and the estimate has to agree with the CEO's price book to the dollar — a
// line the intake prices at its book list and the estimator prices at
// something else is a discrepancy that surfaces in front of a client.
//
// Every basis string names either a SKU family ("TP5-120-480-x list") or says
// the figure is interpolated because the book has no SKU at that capacity.
// Where it names a family, the number must BE that family's list price.
const familyOf = (basis: string): string | null => {
  const m = /^([A-Za-z0-9]+(?:-[A-Za-z]+)?)-(\d+)-/.exec(basis);
  return m ? `${m[1]}-${m[2]}-` : null;
};

describe("per-model allowances against the price book", () => {
  it("every allowance whose basis names a SKU family equals that family's list", () => {
    const mismatches: string[] = [];
    for (const [id, basis] of Object.entries(HARDWARE_ALLOWANCE_BASIS)) {
      const prefix = familyOf(basis);
      if (!prefix) continue; // interpolated, or described rather than cited
      const book = PRICE_BOOK.filter((s) => s.sku.startsWith(prefix) && !s.sku.includes("BAA"));
      if (!book.length) continue;
      const list = book[0].msrp;
      const app = HARDWARE_ALLOWANCE[id];
      if (app !== list) mismatches.push(`${id}: app $${app} vs ${prefix}x list $${list}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("a model whose description names CTX Gen3 AiO is priced as one", () => {
    // These three say "Dual-cable AiO (CTX Gen3 …)" in their own notes and were
    // priced at the cheaper TP5 list, understating a 160 kW dual by $11,200 a
    // unit until somebody picked the SKU by hand.
    const kw = (id: string) => Number(/(\d+)\s*kW/i.exec(id)![1]);
    const aioModels = DEFAULT_LOAD_TYPES.filter(
      (l) => l.category === "DCFC" && /AiO|CTX Gen3/i.test(l.notes ?? ""),
    );
    expect(aioModels.map((l) => l.id)).toEqual(["DCFC 120kW Dual", "DCFC 160kW Dual", "DCFC 240kW Dual"]);
    for (const lt of aioModels) {
      const aio = PRICE_BOOK.find((s) => s.sku.startsWith(`CTX-AiO-${kw(lt.id)}-`))!;
      expect(HARDWARE_ALLOWANCE[lt.id]).toBe(aio.msrp);
    }
  });
});
