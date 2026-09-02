// Cost build-up: the estimator's cost lines → list price → customer price,
// mirroring the Best Western model's Cost_Buildup sheet and the intake's
// markup / discount / pass-through policy.
//
//   materials-class construction line   price = base × (1 + contingency) × (1 + materials markup)
//   labour, construction PM             price = loaded cost × (1 + labour markup) × (1 − in-house discount)
//   design and engineering              price = cost × (1 − in-house discount)
//   pass-through fees                   price = base — no contingency, markup or discount
//   charger hardware                    price = list × (1 − hardware discount); tax on the discounted price
//   warranty + service, EVOLV           price = list × (1 − their discounts)
//   construction sales tax (optional)   materials-class price × tax rate, its own row
//
// The estimator's Total Cost is never touched; it is carried alongside.

import type { CostsResult, FinancialInput } from "../calc/types";
import type { BuildupRow, CommercialInput, CostBuildupResult } from "./types";

const sum = (rows: BuildupRow[], pick: (r: BuildupRow) => number) => rows.reduce((s, r) => s + pick(r), 0);

export function computeCostBuildup(
  financial: FinancialInput,
  costs: CostsResult,
  commercial: CommercialInput,
): CostBuildupResult {
  const c = commercial;
  const rows: BuildupRow[] = [];
  const passThrough = new Set(c.passThroughLines);

  // ---- Equipment purchase invoice -----------------------------------------
  const hardwareList = financial.chargerHardwareCost;
  const hardwarePrice = hardwareList * (1 - c.discountHardwarePct);
  rows.push({
    id: "hardware",
    label: "Charger hardware",
    group: "equipment",
    scopeLine: "hardware",
    uplift: "equipment",
    cost: hardwareList,
    list: hardwareList,
    discountPct: c.discountHardwarePct,
    price: hardwarePrice,
    note: "Price-book list × (1 − hardware discount)",
  });
  const serviceList = financial.chargerWarrantyCost + financial.fiveYearServiceCost;
  rows.push({
    id: "service",
    label: "Service and extended warranty",
    group: "equipment",
    scopeLine: "service",
    uplift: "equipment",
    cost: serviceList,
    list: serviceList,
    discountPct: c.discountServicePct,
    price: serviceList * (1 - c.discountServicePct),
    note: "Warranty + service agreement, less the service discount",
  });
  rows.push({
    id: "evolv",
    label: "EVOLV network and commissioning",
    group: "equipment",
    scopeLine: "evolv",
    uplift: "equipment",
    cost: financial.evolvCommissioningCost,
    list: financial.evolvCommissioningCost,
    discountPct: c.discountEvolvPct,
    price: financial.evolvCommissioningCost * (1 - c.discountEvolvPct),
  });
  const hardwareTax = hardwarePrice * financial.salesTaxPct;
  rows.push({
    id: "salesTaxHardware",
    label: "Sales tax on chargers",
    group: "equipment",
    scopeLine: "salesTax",
    uplift: "tax",
    cost: hardwareTax,
    list: hardwareTax,
    discountPct: 0,
    price: hardwareTax,
    note: "On the DISCOUNTED hardware price — follows whoever supplies the hardware",
  });

  // ---- Design and engineering ---------------------------------------------
  // The engine's figure (site plan + stamped set + PM hours, or the override
  // register's typed D&E) — never re-derived from the fields here.
  const designCost = costs.designAndEngineering;
  rows.push({
    id: "design",
    label: "Design and engineering",
    group: "design",
    scopeLine: "design",
    uplift: "inHouse",
    cost: designCost,
    list: designCost,
    discountPct: c.discountInHousePct,
    price: designCost * (1 - c.discountInHousePct),
    note: "Site plan, stamped electrical set, design/permitting PM hours — in-house, no markup",
  });

  // ---- Construction: the estimator's eleven lines ---------------------------
  for (const line of costs.lines) {
    if (passThrough.has(line.name)) {
      rows.push({
        id: `line:${line.name}`,
        label: line.name,
        group: "construction",
        scopeLine: "construction",
        uplift: "passThrough",
        cost: line.finalCost,
        base: line.base,
        contingency: 0,
        list: line.base,
        discountPct: 0,
        price: line.base,
        note: "Pass-through: billed at exactly cost — no contingency, markup or discount",
      });
    } else {
      const list = line.finalCost * (1 + c.markupMaterialsPct);
      rows.push({
        id: `line:${line.name}`,
        label: line.name,
        group: "construction",
        scopeLine: "construction",
        uplift: "materials",
        cost: line.finalCost,
        base: line.base,
        contingency: line.contingency,
        list,
        discountPct: 0,
        price: list,
      });
    }
  }

  // Labour and construction PM: loaded cost from the estimator, then the
  // labour markup, then the in-house discount.
  const laborLoaded = costs.labor;
  const laborBase = laborLoaded / (1 + financial.contingencyPct) || 0;
  const laborContingency = (financial.applyContingencyToLabor ?? true) ? laborLoaded - laborBase : 0;
  const laborList = laborLoaded * (1 + c.markupLaborPct);
  rows.push({
    id: "labor",
    label: "Labour",
    group: "construction",
    scopeLine: "construction",
    uplift: "labor",
    cost: laborLoaded,
    base: (financial.applyContingencyToLabor ?? true) ? laborBase : laborLoaded,
    contingency: laborContingency,
    list: laborList,
    discountPct: c.discountInHousePct,
    price: laborList * (1 - c.discountInHousePct),
    note: "Crew days × rate × (1 + contingency) × (1 + labour markup), less the in-house discount",
  });
  const pmList = costs.constructionPm * (1 + c.markupLaborPct);
  rows.push({
    id: "constructionPm",
    label: "Construction project management",
    group: "construction",
    scopeLine: "construction",
    uplift: "labor",
    cost: costs.constructionPm,
    base: costs.constructionPm,
    contingency: 0,
    list: pmList,
    discountPct: c.discountInHousePct,
    price: pmList * (1 - c.discountInHousePct),
    note: `${Math.round((financial.pmPctOfLabor ?? 0) * 100)}% of loaded labour (CEO basis)`,
  });

  // Sales tax on materials-class construction lines, at their marked-up price.
  const materialsPrice = sum(
    rows.filter((r) => r.group === "construction" && r.uplift === "materials"),
    (r) => r.price,
  );
  const constructionTaxPrice = c.taxConstructionMaterials ? materialsPrice * financial.salesTaxPct : 0;
  if (c.taxConstructionMaterials) {
    rows.push({
      id: "constructionTax",
      label: "Sales tax on construction materials",
      group: "construction",
      scopeLine: "construction",
      uplift: "tax",
      cost: costs.salesTaxOnConstruction,
      base: constructionTaxPrice,
      contingency: 0,
      list: constructionTaxPrice,
      discountPct: 0,
      price: constructionTaxPrice,
      note: "Materials-class lines at their marked-up price × tax rate. Cost column shows the estimator's own construction tax.",
    });
  }

  // ---- Pass-through fees outside the estimator's lines ----------------------
  if (financial.planCheckPermitFee) {
    rows.push({
      id: "planCheck",
      label: "Plan check (AHJ)",
      group: "construction",
      scopeLine: "construction",
      uplift: "passThrough",
      cost: financial.planCheckPermitFee,
      base: financial.planCheckPermitFee,
      contingency: 0,
      list: financial.planCheckPermitFee,
      discountPct: 0,
      price: financial.planCheckPermitFee,
      note: "Pass-through at cost",
    });
  }
  if (c.utilityInterconnectFee) {
    rows.push({
      id: "interconnect",
      label: "Utility interconnection — design / application fee",
      group: "passThrough",
      scopeLine: "interconnect",
      uplift: "passThrough",
      cost: c.utilityInterconnectFee,
      list: c.utilityInterconnectFee,
      discountPct: 0,
      price: c.utilityInterconnectFee,
      note: "Rule 29 design fee where the serving utility charges one — pass-through",
    });
  }
  if (c.lineExtensionContribution) {
    rows.push({
      id: "lineExtension",
      label: "Utility line-extension contribution (Rules 15/16, ITCC)",
      group: "passThrough",
      scopeLine: "interconnect",
      uplift: "passThrough",
      cost: c.lineExtensionContribution,
      list: c.lineExtensionContribution,
      discountPct: 0,
      price: c.lineExtensionContribution,
      note: "Customer contribution the utility's design requires — pass-through at cost. Excluded by name when zero.",
    });
  }
  if (c.additionalScope) {
    rows.push({
      id: "additional",
      label: "Additional or unforeseen scope",
      group: "additional",
      scopeLine: "additional",
      uplift: "passThrough",
      cost: c.additionalScope,
      list: c.additionalScope,
      discountPct: 0,
      price: c.additionalScope,
    });
  }

  const by = (g: BuildupRow["group"]) => rows.filter((r) => r.group === g);
  const equipmentList = sum(by("equipment"), (r) => r.list);
  const equipmentPrice = sum(by("equipment"), (r) => r.price);
  const designList = sum(by("design"), (r) => r.list);
  const designPrice = sum(by("design"), (r) => r.price);
  const constructionList = sum(by("construction"), (r) => r.list);
  const constructionPrice = sum(by("construction"), (r) => r.price);
  const passThroughTotal = sum(
    rows.filter((r) => r.uplift === "passThrough"),
    (r) => r.price,
  );
  const listTotal = sum(rows, (r) => r.list);
  const customerPrice = sum(rows, (r) => r.price);

  return {
    rows,
    equipmentList,
    equipmentPrice,
    designList,
    designPrice,
    constructionList,
    constructionPrice,
    passThroughTotal,
    constructionTaxPrice,
    listTotal,
    customerPrice,
    discountToCustomer: listTotal - customerPrice,
    estimatorTotalCost: costs.totalCost,
  };
}
