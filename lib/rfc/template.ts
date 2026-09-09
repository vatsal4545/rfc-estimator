// The RFC / MSRP calculator workbook — where the estimator's figures go.
//
// The workbook is formula-driven off three input surfaces. Fill those and the
// rest of the file (Proposal, Internal Summary, Financial Worksheet, DLL
// Schedule, Cashflow, CPM Calcs) computes itself:
//
//   1. INPUT SHEET rows 8-37       — the equipment line items. Category, SKU,
//      discount and qty are the only inputs; description and MSRP are the
//      sheet's own INDEX/MATCH into its CTX Price Book, so we never write a
//      price and the two can never disagree.
//   2. Updated Chargers Revenue Calcul — already built to mirror the app's
//      Revenue tab; its row 33 says so, and row 197 records the sync date.
//   3. Costs Internal rows 3-18    — the same table as the app's Costs
//      Internal tab, row for row.
//
// This file holds the addresses and the structural guard. The values come
// from plan.ts.

/** Sheet names, exactly as the workbook spells them. */
export const RFC_SHEETS = {
  input: "INPUT SHEET",
  revenue: "Updated Chargers Revenue Calcul",
  costs: "Costs Internal",
  priceBook: "CTX Price Book",
  internalSummary: "Internal Summary",
} as const;

export const RFC_TEMPLATE = {
  /** Served from public/ so the browser can fetch it; see fetchRfcTemplate(). */
  publicPath: "/rfc/IntakeSheet_RFC_MSRP_Calculator_Simple_v17.updated.xlsx",
  label: "RFC / MSRP Calculator v17",
} as const;

/**
 * INPUT SHEET line items. Rows 8-37; only D, E, H and I are inputs — C
 * (item #), F (description), G (MSRP), J (MSRP total) and K (line total
 * after discount) are formulas and must be left alone.
 */
export const INPUT_ITEMS = {
  firstRow: 8,
  lastRow: 37,
  category: "D",
  sku: "E",
  discount: "H",
  qty: "I",
} as const;

export const INPUT_ITEM_ROWS = INPUT_ITEMS.lastRow - INPUT_ITEMS.firstRow + 1;

/** The two Financial Worksheet Inputs on INPUT SHEET that are plain constants. */
export const INPUT_FINANCIAL = {
  /** N10 — nameplate kW per Level 2 position. */
  l2RatingKw: "N10",
  /** N11 — rating de-rate factor, read by the revenue tab and the roll-ups. */
  derateFactor: "N11",
} as const;

/**
 * CTX Price Book, for the fill-time cross-check. Category tokens live in
 * I3:I16 (the _CTX_Category_List defined name backing the D8:D37 dropdown);
 * SKUs run down column C with the description in D and the MSRP in F.
 */
export const PRICE_BOOK_RANGE = {
  firstRow: 3,
  lastRow: 131,
  sku: "C",
  description: "D",
  ourCost: "E",
  msrp: "F",
  categoryListFirstRow: 3,
  categoryListLastRow: 16,
  categoryList: "I",
} as const;

/**
 * Costs Internal. Rows 3-13 are the 11 engine cost lines in order, row 14 is
 * Construction PM (shown but deliberately outside the SUM(G3:G13) subtotal),
 * rows 17-20 the ZERO IMPACT BUILDERS labor block, J3:K7 the labor box.
 * F and G are formulas; C18/D18 read K5/K4 and so are left alone.
 */
export const COSTS_INTERNAL = {
  firstLineRow: 3,
  lastLineRow: 13,
  constructionPmRow: 14,
  qty: "C",
  individualCost: "D",
  contingency: "E",
  /** E18 — the labor row's contingency. */
  laborContingency: "E18",
  /** K4 — labor daily cost, read by D18. */
  laborDailyRate: "K4",
  /**
   * K5 — total business days, read by C18, K6 and K7. Holds a formula
   * ('INPUT SHEET CPM'!P11) in the blank template, so the write opts in.
   */
  laborBusinessDays: "K5",
  /** G15 — the construction subtotal the Internal Summary sentinel tests. */
  constructionSubtotal: "G15",
} as const;

/**
 * Internal Summary zeroes its cost rows while Costs Internal still shows the
 * template's untouched default total:
 *   =IF(ROUND('Costs Internal'!G15,2)=88919.7, 0, 'Costs Internal'!G3)
 * Writing real costs moves G15 and the summary populates — that is the
 * intended behaviour. It only misfires if our own subtotal lands exactly on
 * the sentinel, which planRfcFill warns about.
 */
export const INTERNAL_SUMMARY_SENTINEL = 88919.7;

/**
 * Internal Summary rows the workbook ships as hard zeros and nothing else
 * feeds. Without these the Grand Total is short by the whole Design Invoice,
 * the construction sales tax and the construction PM — the app counts all
 * three in its Total Cost.
 *
 * "Materials" is deliberately left alone: the app has no separate materials
 * line, it is already inside "Wires, Conduits and Peripherals".
 */
export const INTERNAL_SUMMARY = {
  autoCadDesign: "B9",
  electricalEngDesign: "B10",
  designProjectManagement: "B11",
  planCheckPermitFees: "B12",
  constructionPm: "B25",
  materials: "B26",
  salesTaxOnConstruction: "B27",
} as const;

/**
 * The Internal Summary's columns are "Price | Applied Discount | Customer
 * Price", and D = B − B×C throughout. The workbook has no markup concept
 * anywhere (the Proposal tab is pure formulas off this same D column), so the
 * discount column is the only place the app's priced rows can land — a
 * negative entry there is a markup.
 *
 * Writing these makes D30 "Total After Discount" equal the app's Customer
 * price exactly, which is what that column is for. Row 4's discount is a
 * formula deriving the hardware discount from the INPUT SHEET and already
 * lands on the app's hardware price, so it is left alone.
 */
export const INTERNAL_SUMMARY_DISCOUNT = {
  service: "C5",
  evolv: "C6",
  salesTaxHardware: "C7",
  design: ["C9", "C10", "C11"] as const,
  planCheck: "C12",
  /** C14:C24 — the eleven construction lines, in COSTS_INTERNAL_LABELS order. */
  firstLineRow: 14,
  lastLineRow: 24,
  lineColumn: "C",
  constructionPm: "C25",
  materials: "C26",
  salesTaxOnConstruction: "C27",
  labor: "C28",
} as const;

/**
 * The workbook hard-codes 7.25% for sales tax on chargers (B7 = D4 × 7.25%).
 * The app's rate is an input, so the two can differ; the fill compensates in
 * the discount column and reports it.
 */
export const WORKBOOK_HARDWARE_TAX_RATE = 0.0725;

/**
 * Revenue tab rows. The workbook carries six scenario columns; the app has
 * one case, which goes into the Standard-Low block (B:H) so the Med / High /
 * Fleet brackets keep the workbook's own tiers. Headline column C (rows
 * 189-195) is then the app-faithful one.
 */
export const REVENUE_SCENARIO_COLUMNS = ["B", "C", "D", "E", "F", "G", "H"] as const;

export const REVENUE_ROWS = {
  hoursPerDay: 7,
  /** Literal where every other column reads row 20 — the sheet flags this at A199. */
  occupancyLiteral: 8,
  /** B13 only; C13:H13 are =B13. */
  retailPerKwh: 13,
  occupancy: 20,
  chargingHoursShare: 21,
  taperFactor: 34,
  daysPerYear: 36,
  cardFeePct: 39,
  peakShare: 43,
  offPeakShare: 44,
  superOffPeakShare: 45,
  peakToAverageFactor: 51,
  safetyMarginPct: 52,
  sizeDemandOnFullRating: 53,
  demandChargeFromYear: 54,
  rampYear1: 55,
  rampYear2: 56,
  rampYear3: 57,
  growthAfterRamp: 58,
  contractYears: 59,
} as const;

/** The utility tariff block. B202/B203 drive the dropdowns; B206:B213 are the resolved rates. */
export const REVENUE_TARIFF = {
  utility: "B202",
  schedule: "B203",
  peakPerKwh: "B206",
  offPeakPerKwh: "B207",
  superOffPeakPerKwh: "B208",
  customerPerMonth: "B209",
  demandPerKwMonth: "B210",
  blockKw: "B211",
  blockPerMonth: "B212",
  overagePerKw: "B213",
} as const;

/**
 * Structural landmarks. The workbook has no Version sheet, so there is no
 * version/hash gate like the intake's — instead we assert the cells the cell
 * map depends on still say what they said. A mismatch means the workbook was
 * re-cut and this map needs revisiting, which the thrown message says.
 */
export const RFC_LANDMARKS: { sheet: string; ref: string; expect: string; match?: "exact" | "prefix" }[] = [
  { sheet: RFC_SHEETS.input, ref: "C7", expect: "Item #" },
  { sheet: RFC_SHEETS.input, ref: "D7", expect: "Category" },
  { sheet: RFC_SHEETS.input, ref: "E7", expect: "SKU" },
  { sheet: RFC_SHEETS.input, ref: "F7", expect: "Description" },
  { sheet: RFC_SHEETS.input, ref: "G7", expect: "MSRP" },
  { sheet: RFC_SHEETS.input, ref: "H7", expect: "Discount %" },
  { sheet: RFC_SHEETS.input, ref: "I7", expect: "Qty" },
  { sheet: RFC_SHEETS.priceBook, ref: "C2", expect: "SKU" },
  { sheet: RFC_SHEETS.priceBook, ref: "D2", expect: "Description" },
  { sheet: RFC_SHEETS.priceBook, ref: "F2", expect: "MSRP" },
  { sheet: RFC_SHEETS.costs, ref: "B2", expect: "Electrical Supply & Construction Management Costs" },
  { sheet: RFC_SHEETS.costs, ref: "C2", expect: "Quantity" },
  { sheet: RFC_SHEETS.costs, ref: "D2", expect: "Individual Cost" },
  { sheet: RFC_SHEETS.costs, ref: "E2", expect: "Contingency" },
  { sheet: RFC_SHEETS.costs, ref: "B14", expect: "Construction PM" },
  { sheet: RFC_SHEETS.costs, ref: "B17", expect: "ZERO IMPACT BUILDERS COSTS" },
  { sheet: RFC_SHEETS.costs, ref: "B18", expect: "Labor" },
  { sheet: RFC_SHEETS.costs, ref: "J5", expect: "Total Business Days" },
  { sheet: RFC_SHEETS.revenue, ref: "A33", expect: "APP-ALIGNED INPUTS", match: "prefix" },
  { sheet: RFC_SHEETS.revenue, ref: "A206", expect: "Peak $/kWh" },
  { sheet: RFC_SHEETS.revenue, ref: "A213", expect: "Overage rate ($/kW)" },
  { sheet: RFC_SHEETS.revenue, ref: "B3", expect: "Standard-Low" },
];
