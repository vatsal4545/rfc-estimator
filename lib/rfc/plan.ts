// Every cell the estimator fills in the RFC / MSRP calculator workbook.
//
// Pure: project + estimate + proposal in, cell writes out. Three surfaces,
// in the order the recap asks for them — equipment onto INPUT SHEET, the
// Revenue tab's inputs onto Updated Chargers Revenue Calcul, and the Costs
// Internal table 1-to-1 onto Costs Internal. Everything else in the workbook
// is formulas reading those, so nothing downstream is written.
//
// The equipment fill writes category, SKU, discount and qty only. Description
// and MSRP are the workbook's own INDEX/MATCH into its CTX Price Book, which
// is why they cannot drift from the app: the fill cross-checks each SKU
// against that price book (see crossCheckPriceBook) and reports any
// disagreement rather than writing a price of its own.

import { HARDWARE_ALLOWANCE_BASIS } from "../calc/autoplan";
import { laborBreakdown } from "../calc/costs";
import type { EstimateResult, Project } from "../calc/types";
import { COSTS_INTERNAL_LABELS } from "../costsInternalSheet";
import type { CellWrite } from "../intake/xlsxWrite";
import type { WorkbookCells } from "../intake/xlsx";
import type { ProposalResult } from "../proposal/types";
import { PRICE_BOOK, findSku, type PriceBookSku } from "../ref/priceBook";
import { computeEquipmentSchedule, loadTypeIdForSku } from "../skus";
import {
  COSTS_INTERNAL,
  INPUT_FINANCIAL,
  INPUT_ITEMS,
  INPUT_ITEM_ROWS,
  INTERNAL_SUMMARY,
  INTERNAL_SUMMARY_DISCOUNT,
  INTERNAL_SUMMARY_SENTINEL,
  PRICE_BOOK_RANGE,
  REVENUE_ROWS,
  REVENUE_SCENARIO_COLUMNS,
  REVENUE_TARIFF,
  RFC_SHEETS,
  WORKBOOK_HARDWARE_TAX_RATE,
} from "./template";

export interface RfcFillPlan {
  writes: CellWrite[];
  /** What the estimator could not express in the workbook, for the report. */
  warnings: string[];
  /** Input cells deliberately left to a human. */
  leftBlank: string[];
  /** One entry per equipment line written, for the cross-check and the report. */
  equipment: RfcEquipmentRow[];
  /** Generic models given a price-identical price-book stand-in. */
  substitutions: { loadTypeId: string; sku: string; unitList: number }[];
}

export interface RfcEquipmentRow {
  row: number;
  category: string;
  sku: string;
  description: string;
  qty: number;
  /** The app's unit list price. The workbook derives its own; they must agree. */
  unitList: number;
}

export interface RfcFillOptions {
  /** Hardware allowance for SKU-less models, when the user has catalog overrides. */
  hardwareAllowance?: Record<string, number>;
}

/**
 * A generic (SKU-less) estimator model priced at the catalog allowance has no
 * SKU for the workbook to look a price up by, so the line would be dropped.
 * Most of those allowances were, however, taken straight from a price-book
 * SKU's list price — HARDWARE_ALLOWANCE_BASIS records which, e.g.
 * "TP5-360-480-x-300 list" — so a stand-in usually exists.
 *
 * The hard rule is price parity: a candidate is only ever accepted when its
 * MSRP equals, to the cent, the price the app actually used for the line.
 * That is what keeps the substitution honest. Two traps it closes:
 *
 *   - "L2 Single 40A" maps by load type to CTX-R40-240-1 (a *home* unit at
 *     $605) while the app prices it at $1,402.50 from CTX-C48-240-1 — a 57%
 *     under-price if taken naively.
 *   - The Buy-America (-BAA) members of a SKU family cost far more than the
 *     rest (TP5-60-480-2-BAA is $68,200 against the family's $28,500).
 *
 * Returns undefined when nothing priced identically exists — for the models
 * whose allowance is interpolated between two SKUs (50/100/200/275/300 kW),
 * the price book genuinely has no such unit and a human must choose.
 */
export function resolveStandInSku(loadTypeId: string, unitList: number): PriceBookSku | undefined {
  const samePrice = (s: PriceBookSku) => Math.abs(s.msrp - unitList) < 0.005;

  // Candidates named by the allowance's own provenance note, "x" standing in
  // for the connector variant.
  const basis = HARDWARE_ALLOWANCE_BASIS[loadTypeId] ?? "";
  const named = /\b((?:CTX|TP5|HPC)-[A-Za-z0-9-]+)\b/.exec(basis)?.[1];
  const fromBasis = named
    ? PRICE_BOOK.filter((s) => {
        if (!named.includes("x")) return s.sku === named;
        const [head, ...rest] = named.split("x");
        return s.sku.startsWith(head) && rest.every((part) => part === "" || s.sku.includes(part));
      })
    : [];

  // Plus anything the load-type mapping claims is this model.
  const fromLoadType = PRICE_BOOK.filter((s) => loadTypeIdForSku(s) === loadTypeId);

  const pool = [...new Set([...fromBasis, ...fromLoadType])].filter(samePrice);
  if (pool.length === 0) return undefined;
  // Prefer one the load-type mapping agrees is this model (so a "Dual" model
  // gets a genuinely dual-connector SKU, and the workbook's port maths hold),
  // then shortest/alphabetical so the choice is stable run to run.
  const rank = (s: PriceBookSku) => (loadTypeIdForSku(s) === loadTypeId ? 0 : 1);
  return pool.sort((a, b) => rank(a) - rank(b) || a.sku.length - b.sku.length || a.sku.localeCompare(b.sku))[0];
}

/** Everything the estimator can say about the project, as RFC cell writes. Pure. */
export function planRfcFill(
  project: Project,
  result: EstimateResult,
  proposal: ProposalResult | null,
  opts: RfcFillOptions = {},
): RfcFillPlan {
  const writes: CellWrite[] = [];
  const warnings: string[] = [];
  const leftBlank: string[] = [];
  const equipment: RfcEquipmentRow[] = [];
  const substitutions: { loadTypeId: string; sku: string; unitList: number }[] = [];

  const put = (sheet: string, ref: string, value: string | number | boolean | null | undefined, overwriteFormula = false) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" && value.trim() === "") return;
    if (typeof value === "number" && !Number.isFinite(value)) return;
    writes.push(overwriteFormula ? { sheet, ref, value, overwriteFormula } : { sheet, ref, value });
  };

  // ---- 1 · Equipment → INPUT SHEET -----------------------------------------
  const schedule = computeEquipmentSchedule(project, opts.hardwareAllowance);
  const discount = project.commercial?.discountHardwarePct ?? 0;

  // Charger lines first, then dispensers, then accessories — the ordering the
  // intake fill uses, so the two exports read the same way.
  const ordered = [
    ...schedule.lines.filter((l) => l.kind === "charger"),
    ...schedule.lines.filter((l) => l.kind === "extra" && l.sku && findSku(l.sku)?.role === "dispenser"),
    ...schedule.lines.filter((l) => l.kind === "extra" && l.sku && findSku(l.sku)?.role !== "dispenser"),
  ].filter((l) => l.count > 0);

  let row = INPUT_ITEMS.firstRow;
  for (const line of ordered) {
    let sku = line.sku ? findSku(line.sku) : undefined;
    if (!sku && line.loadTypeId) {
      // A generic model priced at the catalog allowance: stand in a
      // price-identical price-book SKU so the line still reaches the sheet.
      sku = resolveStandInSku(line.loadTypeId, line.unitList);
      if (sku) {
        substitutions.push({ loadTypeId: line.loadTypeId, sku: sku.sku, unitList: line.unitList });
      }
    }
    if (!sku) {
      const basis = line.loadTypeId ? (HARDWARE_ALLOWANCE_BASIS[line.loadTypeId] ?? "") : "";
      const why = /interpolat/i.test(basis)
        ? ` The CTX price book has no such unit — the app prices it by interpolation (${basis}).`
        : "";
      warnings.push(
        `${line.loadTypeId ?? line.description} × ${line.count} could not be written: the RFC calculator prices only by price-book SKU, and this model has none at $${line.unitList.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/unit.${why} Pick a specific SKU for it on the Equipment tab.`,
      );
      continue;
    }
    if (row > INPUT_ITEMS.lastRow) {
      warnings.push(
        `${sku.sku} × ${line.count} does not fit — the INPUT SHEET has ${INPUT_ITEM_ROWS} line-item rows and they are full.`,
      );
      continue;
    }
    put(RFC_SHEETS.input, `${INPUT_ITEMS.category}${row}`, sku.category);
    put(RFC_SHEETS.input, `${INPUT_ITEMS.sku}${row}`, sku.sku);
    put(RFC_SHEETS.input, `${INPUT_ITEMS.discount}${row}`, discount);
    put(RFC_SHEETS.input, `${INPUT_ITEMS.qty}${row}`, line.count);
    equipment.push({
      row,
      category: sku.category,
      sku: sku.sku,
      description: sku.description,
      qty: line.count,
      unitList: line.unitList,
    });
    row++;
  }
  if (substitutions.length > 0) {
    warnings.push(
      `${substitutions.length} generic model${substitutions.length === 1 ? "" : "s"} had no SKU, so the workbook was given a price-identical stand-in: ${substitutions
        .map((s) => `${s.loadTypeId} → ${s.sku}`)
        .join("; ")}. The unit price is unchanged; the sheet will show that SKU's description. Pick the exact SKU on the Equipment tab if the model matters.`,
    );
  }
  if (equipment.length === 0) {
    warnings.push("No equipment lines were written — the INPUT SHEET is empty, so every price and count in the workbook stays at zero.");
  }

  const ctx = proposal?.model.context;
  const revenue = proposal?.model.inputs.revenue;
  const tariffInput = proposal?.model.inputs.tariff;
  const tariff = proposal?.model.tariff;

  // The de-rate factor and the L2 rating are read by the revenue tab's
  // roll-ups (C66/C68 divide by N11), so they belong with the equipment.
  if (revenue) put(RFC_SHEETS.input, INPUT_FINANCIAL.derateFactor, revenue.deratingFactor);
  if (ctx && ctx.l2Positions > 0 && ctx.l2KwPerPosition > 0) {
    put(RFC_SHEETS.input, INPUT_FINANCIAL.l2RatingKw, ctx.l2KwPerPosition);
  }

  // ---- 2 · Revenue → Updated Chargers Revenue Calcul -----------------------
  if (!proposal || !ctx || !revenue || !tariffInput || !tariff) {
    warnings.push(
      "This project has no Commercial inputs yet, so the Revenue tab and the utility tariff were left at the workbook's own defaults. Open the Commercial tab to model them.",
    );
    leftBlank.push(`${RFC_SHEETS.revenue}: the app-aligned inputs (rows 7-59) and the utility tariff (B202:B213)`);
  } else {
    const cols = REVENUE_SCENARIO_COLUMNS;
    /** Write one value across the Standard-Low scenario block (B:H). */
    const scenario = (rowNo: number, value: string | number | boolean) => {
      for (const col of cols) put(RFC_SHEETS.revenue, `${col}${rowNo}`, value);
    };

    scenario(REVENUE_ROWS.hoursPerDay, ctx.hoursPerDay);
    scenario(REVENUE_ROWS.daysPerYear, ctx.daysPerYear);
    // Row 20 is the input; row 8 duplicates it as a literal in this block
    // only (the sheet notes that quirk itself at A199), so both get written.
    scenario(REVENUE_ROWS.occupancy, revenue.stallOccupancy);
    scenario(REVENUE_ROWS.occupancyLiteral, revenue.stallOccupancy);
    scenario(REVENUE_ROWS.chargingHoursShare, revenue.chargingHoursShare);
    scenario(REVENUE_ROWS.taperFactor, revenue.taperFactor);
    scenario(REVENUE_ROWS.cardFeePct, revenue.cardFeePct);
    scenario(REVENUE_ROWS.rampYear1, revenue.rampYear1);
    scenario(REVENUE_ROWS.rampYear2, revenue.rampYear2);
    scenario(REVENUE_ROWS.rampYear3, revenue.rampYear3);
    scenario(REVENUE_ROWS.growthAfterRamp, revenue.growthAfterRamp);
    scenario(REVENUE_ROWS.contractYears, ctx.contractYears);
    scenario(REVENUE_ROWS.peakToAverageFactor, tariffInput.peakToAverageFactor);
    scenario(REVENUE_ROWS.safetyMarginPct, tariffInput.safetyMarginPct);
    scenario(REVENUE_ROWS.sizeDemandOnFullRating, tariffInput.sizeDemandOnFullRating ? "Yes" : "No");
    scenario(REVENUE_ROWS.demandChargeFromYear, tariffInput.demandChargeFromYear);

    // Retail price: B13 only — C13:H13 are =B13 and would be refused.
    put(RFC_SHEETS.revenue, `B${REVENUE_ROWS.retailPerKwh}`, revenue.retailPerKwh);

    // Time-of-use mix. The app folds a super-off-peak share into off-peak on a
    // schedule with no super-off period, so write the effective shares; a flat
    // schedule prices everything at the peak rate, which is 100/0/0 here.
    const shares = tariff.isFlat ? { peak: 1, offPeak: 0, superOffPeak: 0 } : tariff.touShares;
    scenario(REVENUE_ROWS.peakShare, shares.peak);
    scenario(REVENUE_ROWS.offPeakShare, shares.offPeak);
    scenario(REVENUE_ROWS.superOffPeakShare, shares.superOffPeak);

    // Utility + schedule satisfy the dropdowns and record provenance.
    put(RFC_SHEETS.revenue, REVENUE_TARIFF.utility, tariff.utility);
    put(RFC_SHEETS.revenue, REVENUE_TARIFF.schedule, tariff.schedule);

    // The resolved rates, written over the workbook's own rate-library lookup.
    // This is what keeps a manual-basis project (or a schedule the workbook's
    // library copy has not researched) from silently pricing energy at zero.
    const r = tariff.rates;
    put(RFC_SHEETS.revenue, REVENUE_TARIFF.peakPerKwh, r.peakPerKwh, true);
    put(RFC_SHEETS.revenue, REVENUE_TARIFF.offPeakPerKwh, r.offPeakPerKwh, true);
    put(RFC_SHEETS.revenue, REVENUE_TARIFF.superOffPeakPerKwh, r.superOffPeakPerKwh, true);
    put(RFC_SHEETS.revenue, REVENUE_TARIFF.customerPerMonth, r.customerPerMonth, true);
    put(RFC_SHEETS.revenue, REVENUE_TARIFF.demandPerKwMonth, r.demandPerKwMonth, true);
    put(RFC_SHEETS.revenue, REVENUE_TARIFF.blockKw, r.blockKw, true);
    put(RFC_SHEETS.revenue, REVENUE_TARIFF.blockPerMonth, r.blockPerMonth, true);
    put(RFC_SHEETS.revenue, REVENUE_TARIFF.overagePerKw, r.overagePerKw, true);

    // Divergences the workbook cannot express. Reported, not fought.
    if (tariffInput.subscriptionPolicy !== "ramped") {
      warnings.push(
        `The demand subscription policy is "${tariffInput.subscriptionPolicy}", but the workbook models only the ramped policy (it sizes the subscription from each year's projected demand). Its subscription and demand-charge rows will differ from the app's.`,
      );
    }
    if (ctx.dcPositions > 0) {
      warnings.push(
        "The workbook's revenue rows hard-code 30/60/80/90/120/180 kW per DC port and ignore the ratings on the INPUT SHEET — the sheet notes this at A199. If this project's DC mix is not on that ladder, its DC energy will differ from the app's.",
      );
    }
    if (!tariff.schedule) {
      warnings.push("No utility rate schedule is set, so the workbook has no schedule to name — the rates were still written from the app's resolved tariff.");
    }
  }

  // ---- 3 · Costs Internal → Costs Internal ---------------------------------
  const fin = project.financial;
  const costs = result.costs;
  const contingency = fin.contingencyPct;
  const laborContingency = (fin.applyContingencyToLabor ?? true) ? fin.contingencyPct : 0;
  const labor = laborBreakdown(fin);

  if (costs.lines.length !== COSTS_INTERNAL_LABELS.length) {
    warnings.push(
      `The engine produced ${costs.lines.length} cost lines but the workbook's Costs Internal table has ${COSTS_INTERNAL_LABELS.length} rows — only the first ${Math.min(costs.lines.length, COSTS_INTERNAL_LABELS.length)} were written.`,
    );
  }
  const lineCount = Math.min(costs.lines.length, COSTS_INTERNAL_LABELS.length);
  for (let i = 0; i < lineCount; i++) {
    const r = COSTS_INTERNAL.firstLineRow + i;
    put(RFC_SHEETS.costs, `${COSTS_INTERNAL.qty}${r}`, 1);
    // Individual Cost holds a CPM Calcs formula in the blank template; the
    // app's own figure supersedes it. No hidden markup — the only loading is
    // the visible Contingency column, exactly as the app's tab shows.
    put(RFC_SHEETS.costs, `${COSTS_INTERNAL.individualCost}${r}`, costs.lines[i].base, true);
    put(RFC_SHEETS.costs, `${COSTS_INTERNAL.contingency}${r}`, contingency);
  }

  // Construction PM — displayed, but outside SUM(G3:G13), as in the app.
  const constructionPm =
    costs.constructionPm + fin.autoCadDesignCost + fin.electricalEngDesignCost + fin.pmHours * fin.pmHourlyRate;
  const pmRow = COSTS_INTERNAL.constructionPmRow;
  put(RFC_SHEETS.costs, `${COSTS_INTERNAL.qty}${pmRow}`, 1);
  put(RFC_SHEETS.costs, `${COSTS_INTERNAL.individualCost}${pmRow}`, constructionPm, true);
  put(RFC_SHEETS.costs, `${COSTS_INTERNAL.contingency}${pmRow}`, 0);

  // Labor. C18 and D18 read K5 and K4, so the box drives the row; K6 and K7
  // derive from it too. K5 pulls business days from 'INPUT SHEET CPM' in the
  // blank template — the app's schedule supersedes that, as it does the CPM
  // Calcs figures above.
  put(RFC_SHEETS.costs, COSTS_INTERNAL.laborDailyRate, labor.blendedRate);
  put(RFC_SHEETS.costs, COSTS_INTERNAL.laborBusinessDays, fin.laborBusinessDays, true);
  put(RFC_SHEETS.costs, COSTS_INTERNAL.laborContingency, laborContingency);

  // ---- The Internal Summary rows nothing else feeds ------------------------
  // Costs Internal only carries the eleven construction lines and labor. The
  // Design Invoice, the construction sales tax and the construction PM are
  // part of the app's Total Cost but ship as hard zeros here, so the Grand
  // Total would come out short by all three.
  const designComponents = fin.autoCadDesignCost + fin.electricalEngDesignCost + fin.pmHours * fin.pmHourlyRate;
  if (Math.abs(costs.designAndEngineering - designComponents) < 0.005) {
    put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY.autoCadDesign, fin.autoCadDesignCost);
    put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY.electricalEngDesign, fin.electricalEngDesignCost);
    put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY.designProjectManagement, fin.pmHours * fin.pmHourlyRate);
  } else {
    // The override register replaced design with one typed figure, and the
    // workbook has no single design line to carry it. Put it on the first row
    // so the invoice total is right, and say so rather than splitting it.
    put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY.autoCadDesign, costs.designAndEngineering);
    put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY.electricalEngDesign, 0);
    put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY.designProjectManagement, 0);
    warnings.push(
      `Design and engineering is overridden to $${costs.designAndEngineering.toLocaleString("en-US", { maximumFractionDigits: 2 })} in the register, so it went onto the Internal Summary's "AutoCad Design Services" row whole — the workbook has no single design line. The Design Invoice total is correct; its three-way split is not.`,
    );
  }
  put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY.planCheckPermitFees, fin.planCheckPermitFee);
  put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY.constructionPm, costs.constructionPm);
  put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY.salesTaxOnConstruction, costs.salesTaxOnConstruction);

  // ---- Customer price: the Applied Discount column -------------------------
  // D = B − B×C on every row, so writing C aligns the workbook's "Customer
  // Price" column (and D30, and the whole Proposal tab, which reads it) with
  // the app's Cost Buildup. A negative C is a markup — the workbook has
  // nowhere else to express one.
  if (proposal) {
    const buildup = proposal.costBuildup;
    const priceOf = (id: string) => buildup.rows.find((r) => r.id === id)?.price;
    /** C such that B×(1−C) lands on the target. */
    const factor = (bValue: number, target: number | undefined): number | undefined => {
      if (target === undefined) return bValue === 0 ? undefined : 1; // not billed → 100% off
      if (Math.abs(bValue) < 0.005) return undefined;
      return 1 - target / bValue;
    };
    const putFactor = (ref: string, bValue: number, target: number | undefined) => {
      const c = factor(bValue, target);
      if (c !== undefined) put(RFC_SHEETS.internalSummary, ref, c);
    };

    const hardwarePrice = fin.chargerHardwareCost * (1 - discount);
    // Row 4's discount is the sheet's own formula off the INPUT SHEET, and it
    // already yields the app's hardware price, so it is not touched.
    putFactor(INTERNAL_SUMMARY_DISCOUNT.service, fin.chargerWarrantyCost + fin.fiveYearServiceCost, priceOf("service"));
    putFactor(INTERNAL_SUMMARY_DISCOUNT.evolv, fin.evolvCommissioningCost, priceOf("evolv"));
    putFactor(INTERNAL_SUMMARY_DISCOUNT.salesTaxHardware, hardwarePrice * WORKBOOK_HARDWARE_TAX_RATE, priceOf("salesTaxHardware"));
    // One factor across the three design rows, so their D's sum to the price
    // whatever the split between AutoCAD, engineering and PM hours.
    const designFactor = factor(costs.designAndEngineering, priceOf("design"));
    if (designFactor !== undefined) {
      for (const ref of INTERNAL_SUMMARY_DISCOUNT.design) put(RFC_SHEETS.internalSummary, ref, designFactor);
    }
    putFactor(INTERNAL_SUMMARY_DISCOUNT.planCheck, fin.planCheckPermitFee, priceOf("planCheck"));
    for (let i = 0; i < lineCount; i++) {
      const line = costs.lines[i];
      putFactor(`${INTERNAL_SUMMARY_DISCOUNT.lineColumn}${INTERNAL_SUMMARY_DISCOUNT.firstLineRow + i}`, line.finalCost, priceOf(`line:${line.name}`));
    }
    putFactor(INTERNAL_SUMMARY_DISCOUNT.constructionPm, costs.constructionPm, priceOf("constructionPm"));
    putFactor(INTERNAL_SUMMARY_DISCOUNT.salesTaxOnConstruction, costs.salesTaxOnConstruction, priceOf("constructionTax"));
    putFactor(INTERNAL_SUMMARY_DISCOUNT.labor, costs.labor, priceOf("labor"));

    // Pass-through fees the app bills but the Internal Summary has no row for.
    // They go on the spare "Materials" row at cost, or D30 would be short.
    const unhomed = ["interconnect", "lineExtension", "additional"]
      .map((id) => buildup.rows.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
    if (unhomed.length > 0) {
      const total = unhomed.reduce((s, r) => s + r.price, 0);
      put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY.materials, total);
      put(RFC_SHEETS.internalSummary, INTERNAL_SUMMARY_DISCOUNT.materials, 0);
      warnings.push(
        `${unhomed.map((r) => r.label).join(" and ")} (${total.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })}) went onto the Internal Summary's "Materials" row — the sheet has no row of its own for pass-through fees, and Total After Discount would otherwise be short by that much.`,
      );
    }

    // The workbook's charger tax rate is hard-coded; say so if it is not ours.
    if (Math.abs(fin.salesTaxPct - WORKBOOK_HARDWARE_TAX_RATE) > 1e-9) {
      warnings.push(
        `This project's sales tax is ${(fin.salesTaxPct * 100).toFixed(3)}% but the workbook hard-codes ${(WORKBOOK_HARDWARE_TAX_RATE * 100).toFixed(2)}% for tax on chargers (B7). The Customer Price column was corrected for the difference, but the sheet's own "Price" column still shows tax at ${(WORKBOOK_HARDWARE_TAX_RATE * 100).toFixed(2)}%.`,
      );
    }

    warnings.push(
      `The Internal Summary's "Applied Discount" column now carries the app's full markup-and-discount factor, so "Customer Price" (D) and Total After Discount (D30) equal the app's Customer price of ${buildup.customerPrice.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })}. Entries are negative where the app marks a line up — the workbook has no markup column of its own. Column B still shows internal cost.`,
    );
  } else {
    leftBlank.push(`${RFC_SHEETS.internalSummary}: the Applied Discount column (no Commercial inputs, so there is no customer price to align to)`);
  }

  // The Internal Summary zeroes its cost rows while Costs Internal's subtotal
  // still reads the template's default. Ours moves it — unless it lands
  // exactly on the sentinel, which would silently blank the summary.
  const subtotal = costs.lines.slice(0, lineCount).reduce((s, l) => s + l.base * (1 + contingency), 0);
  if (Math.abs(Math.round(subtotal * 100) / 100 - INTERNAL_SUMMARY_SENTINEL) < 0.005) {
    warnings.push(
      `This project's construction subtotal is exactly $${INTERNAL_SUMMARY_SENTINEL.toFixed(2)}, the value the Internal Summary treats as "template untouched" — its cost rows will read zero. Nudge any cost input to clear it.`,
    );
  }

  return { writes, warnings, leftBlank, equipment, substitutions };
}

/**
 * Check the written equipment against the workbook's own CTX Price Book —
 * the "verify it is perfect" step. The workbook derives description and MSRP
 * itself, so any disagreement here is a real divergence between the app's
 * price book and the CEO's, and the workbook's copy is what the output file
 * will show.
 */
export function crossCheckPriceBook(wb: WorkbookCells, equipment: RfcEquipmentRow[]): string[] {
  const warnings: string[] = [];
  if (!wb.has(RFC_SHEETS.priceBook)) {
    return [`The workbook has no "${RFC_SHEETS.priceBook}" sheet — equipment prices could not be verified.`];
  }

  const book = new Map<string, { description: string; msrp: number | null }>();
  for (let r = PRICE_BOOK_RANGE.firstRow; r <= PRICE_BOOK_RANGE.lastRow; r++) {
    const sku = wb.get(RFC_SHEETS.priceBook, `${PRICE_BOOK_RANGE.sku}${r}`);
    if (typeof sku !== "string" || sku.trim() === "") continue;
    const msrp = wb.get(RFC_SHEETS.priceBook, `${PRICE_BOOK_RANGE.msrp}${r}`);
    const description = wb.get(RFC_SHEETS.priceBook, `${PRICE_BOOK_RANGE.description}${r}`);
    book.set(sku.trim(), {
      description: typeof description === "string" ? description : "",
      msrp: typeof msrp === "number" ? msrp : null,
    });
  }

  const categories = new Set<string>();
  for (let r = PRICE_BOOK_RANGE.categoryListFirstRow; r <= PRICE_BOOK_RANGE.categoryListLastRow; r++) {
    const c = wb.get(RFC_SHEETS.priceBook, `${PRICE_BOOK_RANGE.categoryList}${r}`);
    if (typeof c === "string" && c.trim() !== "") categories.add(c.trim());
  }

  for (const line of equipment) {
    const hit = book.get(line.sku);
    if (!hit) {
      warnings.push(
        `${line.sku} (row ${line.row}) is not in the workbook's CTX Price Book — its Description will read "SKU not found" and it will carry no price.`,
      );
      continue;
    }
    if (hit.msrp === null) {
      warnings.push(`${line.sku} (row ${line.row}) has no MSRP in the workbook's CTX Price Book — the line will not price.`);
    } else if (Math.abs(hit.msrp - line.unitList) > 0.005) {
      warnings.push(
        `${line.sku} (row ${line.row}) prices at $${hit.msrp.toFixed(2)} in the workbook but $${line.unitList.toFixed(2)} in the app — the workbook's figure is what the file will show.`,
      );
    }
    if (categories.size > 0 && !categories.has(line.category)) {
      warnings.push(
        `${line.sku} (row ${line.row}) has category "${line.category}", which is not in the workbook's category list — the Category dropdown will flag it.`,
      );
    }
  }
  return warnings;
}
