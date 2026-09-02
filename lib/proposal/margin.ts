// Business model: scope of supply, margin by service line, and the
// construction margin build-up — the Best Western model's Business_Model
// sheet, computed from the cost build-up.
//
// "Handing a line to a third party removes its price AND its margin": a line
// marked "others" leaves our contract value but stays in the client's project
// cost; "none" drops it from both. Sales tax follows the hardware line.

import type { BuildupRow, CommercialInput, ConstructionBuildupRow, CostBuildupResult, MarginResult, ScopeLine, ScopeRow } from "./types";
import { SCOPE_LABELS, SCOPE_LINES } from "./types";

const sum = <T>(items: T[], pick: (t: T) => number) => items.reduce((s, t) => s + pick(t), 0);
const pctOf = (part: number, whole: number) => (whole === 0 ? null : part / whole);

export function computeMargin(buildup: CostBuildupResult, commercial: CommercialInput): MarginResult {
  const m = commercial.margin;
  const rowsFor = (line: ScopeLine) => buildup.rows.filter((r) => r.scopeLine === line);
  const priceOf = (line: ScopeLine) => sum(rowsFor(line), (r) => r.price);

  // ---- Construction margin build-up --------------------------------------
  // Materials carry the materials markup; labour carries contingency and the
  // labour markup; PM is a fee, so most of it is margin; pass-through fees and
  // the tax row carry nothing.
  const construction = rowsFor("construction");
  const component = (
    label: string,
    rows: BuildupRow[],
    cost: (rows: BuildupRow[]) => { baseCost: number; contingency: number; expectedCost: number },
    note: string,
  ): ConstructionBuildupRow => {
    const price = sum(rows, (r) => r.price);
    const { baseCost, contingency, expectedCost } = cost(rows);
    return { component: label, price, baseCost, contingency, expectedCost, margin: price - expectedCost, marginPct: pctOf(price - expectedCost, price), note };
  };
  const reserveCost = (rows: BuildupRow[]) => {
    const baseCost = sum(rows, (r) => r.base ?? r.cost);
    const contingency = sum(rows, (r) => r.contingency ?? 0);
    return { baseCost, contingency, expectedCost: baseCost + contingency * m.contingencySpendShare };
  };
  const constructionRows: ConstructionBuildupRow[] = [
    component(
      "Materials, equipment and site works",
      construction.filter((r) => r.uplift === "materials"),
      reserveCost,
      "Base cost plus the share of contingency you expect to spend",
    ),
    component("Labour", construction.filter((r) => r.id === "labor"), reserveCost, "Crew days at the burdened rate, plus expected contingency spend"),
    component(
      "Construction project management",
      construction.filter((r) => r.id === "constructionPm"),
      (rows) => {
        const price = sum(rows, (r) => r.price);
        return { baseCost: price * m.pmInternalCostPct, contingency: 0, expectedCost: price * m.pmInternalCostPct };
      },
      "A fee, so most of it is margin",
    ),
    component(
      "Pass-through fees and sales tax",
      construction.filter((r) => r.uplift === "passThrough" || r.uplift === "tax"),
      (rows) => {
        const price = sum(rows, (r) => r.price);
        return { baseCost: price, contingency: 0, expectedCost: price };
      },
      "Billed at cost — no margin",
    ),
  ].filter((r) => r.price !== 0 || r.baseCost !== 0);
  const total: ConstructionBuildupRow = {
    component: "Construction total",
    price: sum(constructionRows, (r) => r.price),
    baseCost: sum(constructionRows, (r) => r.baseCost),
    contingency: sum(constructionRows, (r) => r.contingency),
    expectedCost: sum(constructionRows, (r) => r.expectedCost),
    margin: 0,
    marginPct: null,
    note: "",
  };
  total.margin = total.price - total.expectedCost;
  total.marginPct = pctOf(total.margin, total.price);

  // ---- Cost per scope line -------------------------------------------------
  const hardwareList = sum(rowsFor("hardware"), (r) => r.list);
  const costOf: Record<ScopeLine, { cost: number; basis: string }> = {
    hardware: {
      cost: m.hardwareCostTotal ?? hardwareList * m.hardwarePctOfList,
      basis: m.hardwareCostTotal !== undefined ? "Our hardware cost (entered)" : `${Math.round(m.hardwarePctOfList * 1000) / 10}% of list — BW assumption, replace with the dealer cost`,
    },
    service: { cost: priceOf("service") * m.servicePctOfPrice, basis: `${Math.round(m.servicePctOfPrice * 100)}% of price — cost assumption, replace with the service cost basis` },
    evolv: { cost: priceOf("evolv") * m.evolvPctOfPrice, basis: `${Math.round(m.evolvPctOfPrice * 100)}% of price — platform fees paid through to the vendor` },
    salesTax: { cost: priceOf("salesTax"), basis: "Pass-through — no margin. Follows whoever supplies the hardware." },
    design: { cost: priceOf("design") * m.designPctOfPrice, basis: `${Math.round(m.designPctOfPrice * 100)}% of price — in-house design hours at cost` },
    construction: { cost: total.expectedCost, basis: "From the construction margin build-up below, not a blanket divide" },
    interconnect: {
      // The design / application fee carries coordination margin; a Rule 15/16 contribution is a pure pass-through.
      cost:
        sum(rowsFor("interconnect").filter((r) => r.id !== "lineExtension"), (r) => r.price) * m.interconnectPctOfPrice +
        sum(rowsFor("interconnect").filter((r) => r.id === "lineExtension"), (r) => r.price),
      basis: `${Math.round(m.interconnectPctOfPrice * 100)}% of the design fee — application and coordination; any line-extension contribution at cost`,
    },
    additional: { cost: priceOf("additional"), basis: "Carried at cost" },
  };

  const status = (line: ScopeLine) => (line === "salesTax" ? commercial.scope.hardware : commercial.scope[line]);
  const rows: ScopeRow[] = SCOPE_LINES.map((line) => {
    const st = status(line);
    const price = priceOf(line);
    const cost = costOf[line].cost;
    const margin = st === "we" ? price - cost : 0;
    return {
      line,
      label: SCOPE_LABELS[line],
      status: st,
      price,
      cost,
      margin,
      marginPct: st === "we" ? pctOf(margin, price) : null,
      thirdParty: st === "others" ? price : 0,
      toClient: st === "none" ? 0 : price,
      basis: costOf[line].basis,
    };
  });

  const we = rows.filter((r) => r.status === "we");
  const contractValue = sum(we, (r) => r.price);
  const ourCost = sum(we, (r) => r.cost);
  const grossMargin = sum(rows, (r) => r.margin);
  const thirdPartyTotal = sum(rows, (r) => r.thirdParty);
  const clientProjectCost = sum(rows, (r) => r.toClient);
  const largest = [...we].sort((a, b) => b.margin - a.margin)[0];
  const others = rows.filter((r) => r.status === "others").length;
  const none = rows.filter((r) => r.status === "none").length;

  return {
    rows,
    contractValue,
    ourCost,
    grossMargin,
    marginRate: pctOf(grossMargin, contractValue),
    thirdPartyTotal,
    clientProjectCost,
    largestMarginLine: largest && grossMargin > 0 ? { label: largest.label, share: largest.margin / grossMargin } : undefined,
    construction: {
      rows: constructionRows,
      total,
      ifContingencyClean: total.price - total.baseCost,
      ifContingencySpent: total.price - total.baseCost - total.contingency,
    },
    scopeCheck:
      others === 0 && none === 0
        ? "OK — full scope with us, identical to the base model"
        : `SCOPE SPLIT — ${others} line(s) by others, ${none} not required`,
  };
}
