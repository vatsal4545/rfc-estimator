// Proposal-layer sheets for the Excel export: "Cost Buildup" (estimator cost →
// list price → customer price) and "Business Model" (scope of supply, margin
// by line, construction margin build-up) — the two sheets the Best Western
// model has and the estimator's workbook lacked. Live formulas with cached
// results, like the rest of the export: change a markup or a discount in the
// inputs block and the customer price recalculates in Excel.
//
// Only added when the project carries a commercial section; the twelve
// estimator sheets are untouched either way.

import type ExcelJS from "exceljs";
import type { EstimateResult, Project } from "./calc/types";
import { computeProposal } from "./proposal";
import { SCOPE_LABELS, SCOPE_LINES, type BuildupRow, type CommercialInput, type ScopeLine } from "./proposal/types";

/** Cell anchors on the Cost Detail sheet the proposal formulas read. */
export interface ProposalCostRefs {
  /** Row of the first construction line (B base, C contingency, D final). */
  lineStartRow: number;
  /** Row of the first Design Invoice line: site plan; SLD, PM hours, plan check follow. */
  designStartRow: number;
  /** Row of the first Equipment Purchase line: hardware; warranty, commissioning, service follow. */
  equipStartRow: number;
  labor: string;
  constructionPm: string;
  salesTax: string;
  total: string;
}

const MONEY = '"$"#,##0.00';
const PCT = "0.00%";
const YELLOW: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6DD" } };
const HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF5" } };
const CD = "'Cost Detail'!";

type WS = ExcelJS.Worksheet;

function f(formula: string, result: number | string): ExcelJS.CellFormulaValue {
  return { formula, result: typeof result === "number" ? Math.round(result * 100) / 100 : result };
}

function header(ws: WS, row: number, labels: string[]): void {
  labels.forEach((label, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = label;
    cell.font = { bold: true, size: 10 };
    cell.fill = HEADER;
    cell.border = { bottom: { style: "thin" } };
  });
}

function input(ws: WS, addr: string, label: string, value: ExcelJS.CellValue, fmt?: string): void {
  ws.getCell(addr.replace("B", "A")).value = label;
  const cell = ws.getCell(addr);
  cell.value = value;
  if (fmt) cell.numFmt = fmt;
  cell.fill = YELLOW;
}

/** Cells on the proposal sheets that the business-model sheets read. */
export interface ProposalSheetRefs {
  /** 'Cost Buildup' customer price cell. */
  customerPrice: string;
  /** 'Business Model' totals: our contract value and the client's total project cost. */
  contractValue: string;
  clientProjectCost: string;
  /** 'Business Model' scope rows: who provides the line and our price for it. */
  scopeStatus: (line: ScopeLine) => string;
  scopePrice: (line: ScopeLine) => string;
  /** The sales tax rate input on Cost Detail. */
  salesTaxRate: string;
}

export function fillProposalSheets(
  wb: ExcelJS.Workbook,
  project: Project,
  result: EstimateResult,
  refs: ProposalCostRefs,
): ProposalSheetRefs | undefined {
  const proposal = computeProposal(project, result);
  const c = project.commercial;
  if (!proposal || !c) return undefined;
  const cb = wb.addWorksheet("Cost Buildup");
  const bm = wb.addWorksheet("Business Model");
  const priceRow = fillCostBuildup(cb, wb, c, proposal.costBuildup.rows, result, refs);
  const scope = fillBusinessModel(bm, c, proposal);
  return {
    customerPrice: `'Cost Buildup'!$H$${priceRow}`,
    contractValue: `'Business Model'!$C$${scope.totalRow}`,
    clientProjectCost: `'Business Model'!$G$${scope.totalRow}`,
    scopeStatus: (line) => `'Business Model'!$B$${scope.lineRow.get(line)}`,
    scopePrice: (line) => `'Business Model'!$C$${scope.lineRow.get(line)}`,
    salesTaxRate: `${CD}$B$5`,
  };
}

// ---------------------------------------------------------------------------
// Cost Buildup
// ---------------------------------------------------------------------------

/** The rows the sheet always carries, in order — optional model rows appear with zeros so the Excel toggles still work. */
function sheetRows(rows: BuildupRow[], costs: EstimateResult["costs"]): BuildupRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const placeholder = (id: string, label: string, group: BuildupRow["group"], scopeLine: ScopeLine, uplift: BuildupRow["uplift"], note?: string): BuildupRow =>
    byId.get(id) ?? { id, label, group, scopeLine, uplift, cost: 0, base: 0, contingency: 0, list: 0, discountPct: 0, price: 0, note };
  const out: BuildupRow[] = [];
  for (const id of ["hardware", "service", "evolv", "salesTaxHardware", "design"]) out.push(byId.get(id)!);
  for (const line of costs.lines) out.push(byId.get(`line:${line.name}`)!);
  out.push(byId.get("labor")!, byId.get("constructionPm")!);
  out.push(placeholder("constructionTax", "Sales tax on construction materials", "construction", "construction", "tax", "Materials-class lines at their marked-up price × tax rate"));
  out.push(placeholder("planCheck", "Plan check (AHJ)", "construction", "construction", "passThrough", "Pass-through at cost"));
  out.push(placeholder("interconnect", "Utility interconnection — design / application fee", "passThrough", "interconnect", "passThrough", "Pass-through"));
  out.push(placeholder("lineExtension", "Utility line-extension contribution (Rules 15/16, ITCC)", "passThrough", "interconnect", "passThrough", "Pass-through at cost; excluded by name when zero"));
  out.push(placeholder("additional", "Additional or unforeseen scope", "additional", "additional", "passThrough"));
  return out;
}

function fillCostBuildup(
  ws: WS,
  wb: ExcelJS.Workbook,
  c: CommercialInput,
  modelRows: BuildupRow[],
  result: EstimateResult,
  refs: ProposalCostRefs,
): number {
  [46, 13, 12, 18, 16, 16, 11, 16, 16, 16, 60].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getCell("A1").value = "Cost Buildup — estimator cost, list price, customer price";
  ws.getCell("A1").font = { bold: true, size: 12 };
  ws.getCell("A2").value =
    "Intake terms: markup on materials and labour after contingency; discounts off list (hardware, service, EVOLV) or off in-house work; pass-through fees at exactly cost. Edit the yellow cells. The estimator's Total Cost (Cost Detail) is unchanged.";
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };

  input(ws, "B4", "Markup on materials", c.markupMaterialsPct, PCT);
  input(ws, "B5", "Markup on labour (labour and construction PM)", c.markupLaborPct, PCT);
  input(ws, "B6", "Hardware discount (off list)", c.discountHardwarePct, PCT);
  input(ws, "B7", "Service and warranty discount", c.discountServicePct, PCT);
  input(ws, "B8", "EVOLV and commissioning discount", c.discountEvolvPct, PCT);
  input(ws, "B9", "In-house services discount (labour, PM, design)", c.discountInHousePct, PCT);
  input(ws, "B10", "Sales tax on construction materials? (Yes / No)", c.taxConstructionMaterials ? "Yes" : "No");
  ws.getCell("B10").dataValidation = { type: "list", allowBlank: false, formulae: ['"Yes,No"'] };
  input(ws, "B11", "Utility interconnection fee (pass-through)", c.utilityInterconnectFee, MONEY);
  input(ws, "B12", "Additional or unforeseen scope (pass-through)", c.additionalScope, MONEY);
  input(ws, "B13", "Utility line-extension contribution — Rules 15/16, ITCC (pass-through)", c.lineExtensionContribution ?? 0, MONEY);

  const HDR = 14;
  header(ws, HDR, ["Line", "Scope", "Class", "Id", "Estimator cost", "List", "Discount", "Customer price", "Base", "Contingency", "Note"]);
  const rows = sheetRows(modelRows, result.costs);
  const first = HDR + 1;
  const rowNo = new Map<string, number>();
  rows.forEach((r, i) => rowNo.set(r.id, first + i));
  const eq = refs.equipStartRow;
  const dz = refs.designStartRow;
  const hardwareRow = rowNo.get("hardware")!;
  const materialsRows = rows.filter((r) => r.uplift === "materials" && r.group === "construction").map((r) => rowNo.get(r.id)!);

  rows.forEach((r, i) => {
    const n = first + i;
    ws.getCell(n, 1).value = r.label;
    ws.getCell(n, 2).value = r.scopeLine;
    ws.getCell(n, 3).value = r.uplift;
    ws.getCell(n, 4).value = r.id;
    ws.getCell(n, 11).value = r.note ?? "";
    const E = `E${n}`;
    const F = `F${n}`;
    const G = `G${n}`;
    const I = `I${n}`;
    let costF: string;
    let baseF: string | number = 0;
    let contF: string | number = 0;
    let listF = `${E}`;
    let discF: string | number = 0;
    let priceF = `${F}*(1-${G})`;
    if (r.id === "hardware") {
      costF = `${CD}D${eq}`;
      discF = "$B$6";
    } else if (r.id === "service") {
      costF = `${CD}D${eq + 1}+${CD}D${eq + 3}`;
      discF = "$B$7";
    } else if (r.id === "evolv") {
      costF = `${CD}D${eq + 2}`;
      discF = "$B$8";
    } else if (r.id === "salesTaxHardware") {
      priceF = `H${hardwareRow}*${CD}$B$5`;
      costF = `H${n}`;
      listF = `H${n}`;
    } else if (r.id === "design") {
      costF = `${CD}D${dz}+${CD}D${dz + 1}+${CD}D${dz + 2}`;
      discF = "$B$9";
    } else if (r.id.startsWith("line:")) {
      const lineIdx = result.costs.lines.findIndex((l) => `line:${l.name}` === r.id);
      const cdRow = refs.lineStartRow + lineIdx;
      costF = `${CD}D${cdRow}`;
      baseF = `${CD}B${cdRow}`;
      if (r.uplift === "passThrough") {
        contF = 0;
        listF = `${I}`;
      } else {
        contF = `${CD}C${cdRow}`;
        listF = `${E}*(1+$B$4)`;
      }
    } else if (r.id === "labor") {
      costF = refs.labor;
      baseF = `IF(${CD}$B$8,${E}/(1+${CD}$B$4),${E})`;
      contF = `${E}-${I}`;
      listF = `${E}*(1+$B$5)`;
      discF = "$B$9";
    } else if (r.id === "constructionPm") {
      costF = refs.constructionPm;
      baseF = `${E}`;
      listF = `${E}*(1+$B$5)`;
      discF = "$B$9";
    } else if (r.id === "constructionTax") {
      priceF = `IF($B$10="Yes",(${materialsRows.map((m) => `H${m}`).join("+") || "0"})*${CD}$B$5,0)`;
      costF = refs.salesTax;
      listF = `H${n}`;
      baseF = `H${n}`;
    } else if (r.id === "planCheck") {
      costF = `${CD}D${dz + 3}`;
      baseF = `${E}`;
    } else if (r.id === "interconnect") {
      costF = "$B$11";
    } else if (r.id === "lineExtension") {
      costF = "$B$13";
    } else {
      costF = "$B$12";
    }
    ws.getCell(n, 5).value = f(costF, r.cost);
    ws.getCell(n, 6).value = f(listF, r.list);
    ws.getCell(n, 7).value = typeof discF === "string" ? f(discF, r.discountPct) : discF;
    ws.getCell(n, 8).value = f(priceF, r.price);
    ws.getCell(n, 9).value = typeof baseF === "string" ? f(baseF, r.base ?? 0) : baseF;
    ws.getCell(n, 10).value = typeof contF === "string" ? f(contF, r.contingency ?? 0) : contF;
    ws.getCell(n, 7).numFmt = PCT;
  });
  const last = first + rows.length - 1;

  const listTotal = rows.reduce((s, r) => s + r.list, 0);
  const priceTotal = rows.reduce((s, r) => s + r.price, 0);
  let n = last + 2;
  ws.getCell(n, 1).value = "Grand total (list)";
  ws.getCell(n, 1).font = { bold: true };
  ws.getCell(n, 6).value = f(`SUM(F${first}:F${last})`, listTotal);
  ws.getCell(n, 6).font = { bold: true };
  const listRow = n;
  n++;
  ws.getCell(n, 1).value = "Discount to customer";
  ws.getCell(n, 8).value = f(`F${listRow}-H${n + 1}`, listTotal - priceTotal);
  n++;
  ws.getCell(n, 1).value = "CUSTOMER PRICE / FINANCED AMOUNT";
  ws.getCell(n, 1).font = { bold: true, size: 13 };
  ws.getCell(n, 8).value = f(`SUM(H${first}:H${last})`, priceTotal);
  ws.getCell(n, 8).font = { bold: true, size: 13 };
  ws.getCell(n, 8).fill = HEADER;
  wb.definedNames.add(`'Cost Buildup'!$H$${n}`, "CustomerPrice");
  const priceRow = n;
  n++;
  ws.getCell(n, 1).value = "Estimator Total Cost (Cost Detail — contingency-loaded, RFC_V18 tax convention)";
  ws.getCell(n, 1).font = { italic: true, color: { argb: "FF666666" } };
  ws.getCell(n, 8).value = f(refs.total, result.costs.totalCost);

  for (const col of [5, 6, 8, 9, 10]) ws.getColumn(col).numFmt = MONEY;
  ws.getCell("B4").numFmt = PCT;
  ws.views = [{ state: "frozen", ySplit: HDR }];

  // Named ranges the Business Model sheet aggregates over.
  const rng = (col: string) => `'Cost Buildup'!$${col}$${first}:$${col}$${last}`;
  wb.definedNames.add(rng("B"), "BuildupScope");
  wb.definedNames.add(rng("C"), "BuildupClass");
  wb.definedNames.add(rng("D"), "BuildupId");
  wb.definedNames.add(rng("F"), "BuildupList");
  wb.definedNames.add(rng("H"), "BuildupPrice");
  wb.definedNames.add(rng("I"), "BuildupBase");
  wb.definedNames.add(rng("J"), "BuildupCont");
  return priceRow;
}

// ---------------------------------------------------------------------------
// Business Model
// ---------------------------------------------------------------------------

const STATUS_TEXT = { we: "We provide", others: "By others", none: "Not required" } as const;

function fillBusinessModel(
  ws: WS,
  c: CommercialInput,
  proposal: NonNullable<ReturnType<typeof computeProposal>>,
): { lineRow: Map<ScopeLine, number>; totalRow: number } {
  const m = proposal.margin;
  [44, 16, 16, 16, 16, 11, 16, 60].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getCell("A1").value = "Business Model — scope of supply, margin by line, construction margin build-up";
  ws.getCell("A1").font = { bold: true, size: 12 };
  ws.getCell("A2").value =
    'Everything "We provide" reproduces the base case. "By others" leaves our contract value but stays in the client\'s project cost; "Not required" drops the line. Cost-basis assumptions are the yellow cells — stand-ins until real costs are known.';
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };

  const a = c.margin;
  input(ws, "B4", "Our hardware cost, total (blank = share of list below)", a.hardwareCostTotal ?? null, MONEY);
  input(ws, "B5", "Hardware cost, share of list", a.hardwarePctOfList, PCT);
  input(ws, "B6", "Service cost, share of price", a.servicePctOfPrice, PCT);
  input(ws, "B7", "EVOLV cost, share of price", a.evolvPctOfPrice, PCT);
  input(ws, "B8", "Design cost, share of price", a.designPctOfPrice, PCT);
  input(ws, "B9", "Interconnection cost, share of price", a.interconnectPctOfPrice, PCT);
  input(ws, "B10", "Share of contingency expected to be spent", a.contingencySpendShare, PCT);
  input(ws, "B11", "Construction PM fee — internal cost share", a.pmInternalCostPct, PCT);

  // ---- Construction margin build-up (rows 25-32) — referenced by the scope table.
  const BU = 25;
  header(ws, BU - 1, ["Construction margin build-up", "Price", "Base cost", "Contingency", "Expected cost", "Margin", "Margin %", "Note"]);
  const comp = (name: string) => m.construction.rows.find((r) => r.component === name);
  const sumifs = (range: string, ...pairs: [string, string][]) =>
    `SUMIFS(${range},${pairs.map(([r, v]) => `${r},"${v}"`).join(",")})`;
  const construction = ["BuildupScope", "construction"] as [string, string];
  const buRows: { label: string; price: string; base: string; cont: string | number; expected: string; note: string; key: string }[] = [
    {
      key: "Materials, equipment and site works",
      label: "Materials, equipment and site works",
      price: sumifs("BuildupPrice", construction, ["BuildupClass", "materials"]),
      base: sumifs("BuildupBase", construction, ["BuildupClass", "materials"]),
      cont: sumifs("BuildupCont", construction, ["BuildupClass", "materials"]),
      expected: `C${BU}+D${BU}*$B$10`,
      note: "Base cost plus the share of contingency you expect to spend",
    },
    {
      key: "Labour",
      label: "Labour",
      price: sumifs("BuildupPrice", ["BuildupId", "labor"]),
      base: sumifs("BuildupBase", ["BuildupId", "labor"]),
      cont: sumifs("BuildupCont", ["BuildupId", "labor"]),
      expected: `C${BU + 1}+D${BU + 1}*$B$10`,
      note: "Crew days at the burdened rate, plus expected contingency spend",
    },
    {
      key: "Construction project management",
      label: "Construction project management",
      price: sumifs("BuildupPrice", ["BuildupId", "constructionPm"]),
      base: `B${BU + 2}*$B$11`,
      cont: 0,
      expected: `C${BU + 2}`,
      note: "A fee, so most of it is margin",
    },
    {
      key: "Pass-through fees and sales tax",
      label: "Pass-through fees and sales tax",
      price: `${sumifs("BuildupPrice", construction, ["BuildupClass", "passThrough"])}+${sumifs("BuildupPrice", construction, ["BuildupClass", "tax"])}`,
      base: `B${BU + 3}`,
      cont: 0,
      expected: `B${BU + 3}`,
      note: "Billed at cost — no margin",
    },
  ];
  buRows.forEach((r, i) => {
    const n = BU + i;
    const cached = comp(r.key);
    ws.getCell(n, 1).value = r.label;
    ws.getCell(n, 2).value = f(r.price, cached?.price ?? 0);
    ws.getCell(n, 3).value = f(r.base, cached?.baseCost ?? 0);
    ws.getCell(n, 4).value = typeof r.cont === "string" ? f(r.cont, cached?.contingency ?? 0) : r.cont;
    ws.getCell(n, 5).value = f(r.expected, cached?.expectedCost ?? 0);
    ws.getCell(n, 6).value = f(`B${n}-E${n}`, cached?.margin ?? 0);
    ws.getCell(n, 7).value = f(`IF(B${n}=0,"",F${n}/B${n})`, cached?.marginPct ?? "");
    ws.getCell(n, 8).value = r.note;
  });
  const tot = BU + buRows.length;
  const t = m.construction.total;
  ws.getCell(tot, 1).value = "CONSTRUCTION TOTAL";
  ws.getCell(tot, 1).font = { bold: true };
  ws.getCell(tot, 2).value = f(`SUM(B${BU}:B${tot - 1})`, t.price);
  ws.getCell(tot, 3).value = f(`SUM(C${BU}:C${tot - 1})`, t.baseCost);
  ws.getCell(tot, 4).value = f(`SUM(D${BU}:D${tot - 1})`, t.contingency);
  ws.getCell(tot, 5).value = f(`SUM(E${BU}:E${tot - 1})`, t.expectedCost);
  ws.getCell(tot, 6).value = f(`B${tot}-E${tot}`, t.margin);
  ws.getCell(tot, 7).value = f(`IF(B${tot}=0,"",F${tot}/B${tot})`, t.marginPct ?? "");
  ws.getCell(tot + 2, 1).value = "If contingency runs clean (nothing spent)";
  ws.getCell(tot + 2, 6).value = f(`B${tot}-C${tot}`, m.construction.ifContingencyClean);
  ws.getCell(tot + 3, 1).value = "If contingency is fully spent";
  ws.getCell(tot + 3, 6).value = f(`B${tot}-C${tot}-D${tot}`, m.construction.ifContingencySpent);

  // ---- Scope of supply and margin by line (rows 14-22).
  const SC = 14;
  header(ws, SC - 1, ["Service line", "Who provides", "Our price", "Our cost", "Margin", "Margin %", "To the client", "Cost basis"]);
  const lineRow = new Map<ScopeLine, number>();
  SCOPE_LINES.forEach((line, i) => lineRow.set(line, SC + i));
  SCOPE_LINES.forEach((line, i) => {
    const n = SC + i;
    const row = m.rows.find((r) => r.line === line)!;
    ws.getCell(n, 1).value = SCOPE_LABELS[line];
    if (line === "salesTax") {
      ws.getCell(n, 2).value = f(`B${lineRow.get("hardware")}`, STATUS_TEXT[row.status]);
    } else {
      ws.getCell(n, 2).value = STATUS_TEXT[row.status];
      ws.getCell(n, 2).fill = YELLOW;
    }
    ws.getCell(n, 3).value = f(`SUMIF(BuildupScope,"${line}",BuildupPrice)`, row.price);
    const costF: Record<ScopeLine, string> = {
      hardware: `IF($B$4="",SUMIF(BuildupScope,"hardware",BuildupList)*$B$5,$B$4)`,
      service: `C${n}*$B$6`,
      evolv: `C${n}*$B$7`,
      salesTax: `C${n}`,
      design: `C${n}*$B$8`,
      construction: `E${tot}`,
      interconnect: `SUMIF(BuildupId,"interconnect",BuildupPrice)*$B$9+SUMIF(BuildupId,"lineExtension",BuildupPrice)`,
      additional: `C${n}`,
    };
    ws.getCell(n, 4).value = f(costF[line], row.cost);
    ws.getCell(n, 5).value = f(`IF(B${n}="We provide",C${n}-D${n},0)`, row.margin);
    ws.getCell(n, 6).value = f(`IF(OR(B${n}<>"We provide",C${n}=0),"",E${n}/C${n})`, row.marginPct ?? "");
    ws.getCell(n, 7).value = f(`IF(B${n}="Not required",0,C${n})`, row.toClient);
    ws.getCell(n, 8).value = row.basis;
  });
  const scLast = SC + SCOPE_LINES.length - 1;
  for (let r = SC; r <= scLast; r++) {
    ws.getCell(r, 2).dataValidation = { type: "list", allowBlank: false, formulae: ['"We provide,By others,Not required"'] };
  }
  const n = scLast + 1;
  ws.getCell(n, 1).value = "OUR CONTRACT VALUE";
  ws.getCell(n, 1).font = { bold: true, size: 12 };
  ws.getCell(n, 3).value = f(`SUMIF(B${SC}:B${scLast},"We provide",C${SC}:C${scLast})`, m.contractValue);
  ws.getCell(n, 4).value = f(`SUMIF(B${SC}:B${scLast},"We provide",D${SC}:D${scLast})`, m.ourCost);
  ws.getCell(n, 5).value = f(`SUM(E${SC}:E${scLast})`, m.grossMargin);
  ws.getCell(n, 6).value = f(`IF(C${n}=0,"",E${n}/C${n})`, m.marginRate ?? "");
  ws.getCell(n, 7).value = f(`SUM(G${SC}:G${scLast})`, m.clientProjectCost);
  ws.getCell(n, 8).value = f(
    `IF(COUNTIF(B${SC}:B${scLast},"We provide")=${SCOPE_LINES.length},"OK — full scope with us, identical to the base model","SCOPE SPLIT — "&COUNTIF(B${SC}:B${scLast},"By others")&" line(s) by others, "&COUNTIF(B${SC}:B${scLast},"Not required")&" not required")`,
    m.scopeCheck,
  );
  for (let col = 3; col <= 7; col++) ws.getCell(n, col).font = { bold: true };
  ws.getCell(n, 3).fill = HEADER;

  for (const col of [2, 3, 4, 5, 7]) ws.getColumn(col).numFmt = MONEY;
  ws.getColumn(6).numFmt = PCT;
  for (let r = SC; r <= scLast + 1; r++) ws.getCell(r, 2).numFmt = "@";
  for (let r = 5; r <= 11; r++) ws.getCell(r, 2).numFmt = PCT;
  ws.getCell("B4").numFmt = MONEY;
  ws.views = [{ state: "frozen", ySplit: 3 }];
  return { lineRow, totalRow: n };
}
