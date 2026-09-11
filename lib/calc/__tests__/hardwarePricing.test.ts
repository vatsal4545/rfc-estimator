import { describe, expect, it } from "vitest";
import { PRICE_BOOK } from "../../ref/priceBook";
import { HARDWARE_ALLOWANCE, HARDWARE_ALLOWANCE_BASIS } from "../autoplan";
import { DEFAULT_LOAD_TYPES } from "../tables";

// The per-model allowance is what a charger costs before anyone picks a SKU,
// and it has to agree with the CEO's price book to the dollar: the intake
// prices a line at its book list, so any gap here is a discrepancy that shows
// up in front of a client.
//
// Every basis in HARDWARE_ALLOWANCE_BASIS either cites a SKU pattern ("x"
// standing in for the connector count, whose price the book does not vary) or
// says the figure is interpolated because the book has no SKU at that rating.
// Both claims are checked here, so neither can be used to wave a number past.

const kwOf = (id: string) => Number(/(\d+)\s*kW/i.exec(id)?.[1] ?? 0);

/** "CTX-AiO-160-x-350 list — note" -> the SKUs it names. */
function citedSkus(basis: string) {
  const cited = basis.split(" list")[0].trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-/]*$/.test(cited)) return null;
  const rx = new RegExp(
    "^" + cited.split("-").map((p) => (p === "x" ? "[^-]+" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("-") + "$",
  );
  return PRICE_BOOK.filter((s) => rx.test(s.sku));
}

describe("every allowance matches the intake's price book", () => {
  it("prices each model at the list price of the SKU its basis names", () => {
    const problems: string[] = [];
    for (const [id, basis] of Object.entries(HARDWARE_ALLOWANCE_BASIS)) {
      if (/interpolat/i.test(basis)) continue;
      const hits = citedSkus(basis);
      const cited = basis.split(" list")[0].trim();
      if (!hits?.length) {
        problems.push(`${id}: basis cites "${cited}", which matches nothing in the book`);
        continue;
      }
      const prices = [...new Set(hits.map((s) => s.msrp))];
      if (prices.length > 1) problems.push(`${id}: "${cited}" spans several prices ${prices.join("/")}`);
      else if (prices[0] !== HARDWARE_ALLOWANCE[id]) {
        problems.push(`${id}: app $${HARDWARE_ALLOWANCE[id]} vs ${cited} list $${prices[0]}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("only calls a price interpolated where the book really has no SKU at that rating", () => {
    const wrong: string[] = [];
    for (const [id, basis] of Object.entries(HARDWARE_ALLOWANCE_BASIS)) {
      if (!/interpolat/i.test(basis)) continue;
      const kw = kwOf(id);
      const at = PRICE_BOOK.filter((s) => s.capacity === `${kw} kW DC`);
      if (at.length) wrong.push(`${id}: called interpolated, but the book has ${at[0].sku} at ${kw} kW`);
    }
    expect(wrong).toEqual([]);
  });

  it("prices a model named for the CTX Gen3 AiO as that unit, not as the cheaper TP5", () => {
    // Priced at the TP5 list, these understated a 160 kW dual by $11,200 a unit
    // until somebody picked the SKU by hand.
    const aio = DEFAULT_LOAD_TYPES.filter((l) => l.category === "DCFC" && /AiO|CTX Gen3/i.test(l.notes ?? ""));
    expect(aio.map((l) => l.id)).toEqual([
      "DCFC 60kW Dual",
      "DCFC 120kW Dual",
      "DCFC 160kW Dual",
      "DCFC 240kW Dual",
    ]);
    for (const lt of aio) {
      const sku = PRICE_BOOK.find((s) => s.sku.startsWith(`CTX-AiO-${kwOf(lt.id)}-`))!;
      expect(HARDWARE_ALLOWANCE[lt.id]).toBe(sku.msrp);
    }
  });

  it("covers every model — no allowance without a basis", () => {
    const missing = Object.keys(HARDWARE_ALLOWANCE).filter((id) => !HARDWARE_ALLOWANCE_BASIS[id]);
    expect(missing).toEqual([]);
  });
});
