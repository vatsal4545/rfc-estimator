// Import a completed EVSE Project Intake workbook (template 2.x) as a new
// project: every blue cell the CEO's questionnaire asks for, mapped onto the
// estimator — Quick Estimate lines and distances, the price layer's terms,
// the business model's assumptions, the existing installation, the Rule 29
// block and the override register — with a report of what was mapped, what
// was skipped and what needs a look.
//
// The estimator's own rates stay in force (the user's decision): quantities,
// terms, choices and typed figures come across; the intake's unit costs do not,
// except where the intake carries a quote the estimator has no table for.

import { GPR_ITEM_NAME, HARDWARE_ALLOWANCE, buildQuickProject, defaultQuickInput } from "../calc/autoplan";
import type { EquipmentRentalItem, OverrideEntry, Project, QuickChargerLine, QuickExtraLine } from "../calc/types";
import {
  CONNECTOR_KEYS,
  RETAIN_ELEMENTS,
  applyRemovalScope,
  defaultExisting,
  emptyMonth,
  projectTypeFromText,
  type ExistingInput,
  type RetainDecision,
  type UnitCondition,
} from "../existing";
import { defaultInterconnection, type InterconnectionInput } from "../interconnection";
import { applyFieldOverrides } from "../overrides";
import { defaultCommercial, defaultIntake, modelInputsOf } from "../proposal/defaults";
import type { CommercialInput, IntakeInput, ScopeLine, ScopeStatus, SubscriptionPolicy } from "../proposal/types";
import { MARKET_BENCHMARKS } from "../ref/benchmarks";
import { findSku } from "../ref/priceBook";
import { UTILITIES } from "../ref/utilities";
import { applyEquipmentSchedule, loadTypeIdForSku } from "../skus";
import { readWorkbook, type CellValue, type WorkbookCells } from "./xlsx";

export interface IntakeImportReport {
  templateVersion: string;
  contentHash: string;
  fileVersion: string;
  completedBy: string;
  dateCompleted: string;
  /** What landed where. */
  mapped: string[];
  /** Intake fields the estimator has no home for (or derives itself). */
  skipped: string[];
  /** Things to look at before trusting the estimate. */
  warnings: string[];
}

export interface IntakeImportResult {
  project: Project;
  report: IntakeImportReport;
  /** Library name for the imported project. */
  name: string;
}

const INTAKE_SHEETS = ["Version", "Project", "Existing", "Equipment", "Electrical", "Construction", "Commercial", "Revenue", "Carbon", "Deal_Structure", "Overrides"] as const;

/** Is this workbook an EVSE Project Intake (any 1.x/2.x generation)? */
export function looksLikeIntake(wb: WorkbookCells): boolean {
  return ["Project", "Equipment", "Commercial"].every((s) => resolveSheet(wb, s) !== undefined);
}

function resolveSheet(wb: WorkbookCells, name: string): string | undefined {
  if (wb.has(name)) return name;
  return wb.sheetNames.find((s) => s.endsWith(`_${name}`) || s.toLowerCase() === name.toLowerCase());
}

const RENTAL_NAMES: Record<string, string> = {
  fencing: "Temporary fencing",
  temporaryfencing: "Temporary fencing",
  minix: "Mini excavator",
  miniexcavator: "Mini excavator",
  dumptruck: "Dump truck",
  forklift: "Forklift",
  trenchplates: "Trench plates",
  storagecontainer: "Storage container",
  portablerestroom: "Portable restroom",
  lowboi: "Lowboy transport",
  lowboy: "Lowboy transport",
  lowboytransport: "Lowboy transport",
  sawcutter: "Saw cutter",
  jackhammer: "Jack hammer",
  compactor: "Compactor",
  scissorlift: "Scissor lift",
};

const POLICY: Record<string, SubscriptionPolicy> = {
  "ramped to projected demand": "ramped",
  "fixed at full nameplate": "nameplate",
  "fixed at a manual level": "manual",
  "fixed at the manual level": "manual",
};

const SCOPE_STATUS: Record<string, ScopeStatus> = { "we provide": "we", "by others": "others", "not required": "none" };

export function projectFromIntake(wb: WorkbookCells, base: Project, allowance: Record<string, number> = HARDWARE_ALLOWANCE): IntakeImportResult {
  const mapped: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const sheets = new Map<string, string | undefined>(INTAKE_SHEETS.map((s) => [s, resolveSheet(wb, s)]));
  for (const s of INTAKE_SHEETS) if (!sheets.get(s)) warnings.push(`Sheet "${s}" not found in the workbook — its fields were not imported.`);

  const cell = (sheet: string, ref: string): CellValue => {
    const name = sheets.get(sheet);
    return name ? wb.get(name, ref) : null;
  };
  const num = (sheet: string, ref: string): number | undefined => {
    const v = cell(sheet, ref);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/[$,%]/g, "")))) return Number(v.replace(/[$,%]/g, ""));
    return undefined;
  };
  const str = (sheet: string, ref: string): string => {
    const v = cell(sheet, ref);
    return v === null ? "" : String(v).trim();
  };
  const yes = (sheet: string, ref: string): boolean | undefined => {
    const v = str(sheet, ref).toLowerCase();
    return v === "" ? undefined : v === "yes" || v === "y" || v === "true";
  };
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  // ---- Version ----------------------------------------------------------
  const templateVersion = str("Version", "B4");
  const contentHash = str("Version", "B8");
  const fileVersion = str("Version", "B10");
  const dateCompleted = str("Version", "B11");
  const completedBy = str("Version", "B12");
  const projectReference = str("Version", "B13");
  const revisionNotes = str("Version", "B14");
  if (templateVersion && !templateVersion.startsWith("2.")) warnings.push(`Template ${templateVersion} — the importer is written to the 2.x layout; some fields may have moved.`);
  if (!templateVersion) warnings.push("No template version on the Version tab — is this an EVSE Project Intake?");

  // ---- Project ----------------------------------------------------------
  const clientName = str("Project", "B5") || str("Project", "B12");
  const siteName = str("Project", "B12");
  const siteAddress = [str("Project", "B13"), str("Project", "B14")].filter(Boolean).join(", ");
  const utility = str("Project", "B26");
  const utilityRow = UTILITIES.find((u) => u.utility === utility);
  if (utility && !utilityRow) warnings.push(`Utility "${utility}" is not on the roster — the tariff engine will look for a rate-library row by schedule name only.`);
  const access = str("Project", "B21");
  const hoursOpen = num("Project", "B22");
  const daysOpen = num("Project", "B23");
  if (clientName) mapped.push(`Client "${clientName}" · ${siteAddress || "no address"}`);
  if (utility) mapped.push(`Delivery utility ${utility}`);

  // ---- Equipment → Quick Estimate lines ---------------------------------
  const lines: QuickChargerLine[] = [];
  const extras: QuickExtraLine[] = [];
  const equipmentLine = new Map<number, { sku: string; role: string }>();
  for (let r = 7; r <= 18; r++) {
    const sku = str("Equipment", `C${r}`);
    const qty = num("Equipment", `I${r}`) ?? 0;
    if (!sku && qty === 0) continue;
    const book = findSku(sku);
    if (!book) {
      if (sku) warnings.push(`Equipment line ${r - 6}: SKU "${sku}" is not in price book ${templateVersion || "(current)"} — line skipped (${qty} unit(s), capacity "${str("Equipment", `B${r}`)}").`);
      continue;
    }
    equipmentLine.set(r - 6, { sku, role: book.role });
    if (qty <= 0) continue;
    if (book.role === "dispenser" || book.role === "accessory") {
      extras.push({ sku, count: qty });
      mapped.push(`Equipment: ${qty} × ${sku} (${book.role})`);
      continue;
    }
    const loadTypeId = loadTypeIdForSku(book);
    if (!loadTypeId) {
      warnings.push(`Equipment line ${r - 6}: ${sku} has no estimator model to size with — skipped.`);
      continue;
    }
    lines.push({ loadTypeId, count: qty, sku });
    mapped.push(`Equipment: ${qty} × ${sku} → sized as ${loadTypeId}`);
    if (book.role === "power_cabinet") {
      const perCabinet = num("Equipment", `N${r}`) ?? 0;
      const dispenserSku = str("Equipment", `L${r}`) || "CTX-DST-2-300";
      const connectors = num("Equipment", `O${r}`);
      if (perCabinet > 0) {
        extras.push({ sku: dispenserSku, count: perCabinet * qty });
        mapped.push(`Equipment: ${perCabinet * qty} dispensers (${dispenserSku}) on the ${sku} cabinets`);
        if (connectors === 1) warnings.push(`Dispensers on line ${r - 6} are single-connector in the intake; the price book's dispenser carries two ports.`);
      }
    }
  }
  if (lines.length === 0) warnings.push("No charger lines could be imported from the Equipment tab — the estimate has no equipment.");
  const scopeSentence = str("Equipment", "B27");

  // ---- Electrical → distances, materials, gear, interconnection ---------
  const material = str("Electrical", "B5");
  const conduit = str("Electrical", "B6");
  const dcDist: number[] = [];
  const l2Dist: number[] = [];
  for (let r = 12; r <= 23; r++) {
    const d = num("Electrical", `D${r}`);
    if (d === undefined || d <= 0) continue;
    const lineNo = num("Electrical", `B${r}`);
    const eq = lineNo ? equipmentLine.get(lineNo) : undefined;
    if (eq?.role === "level_2") l2Dist.push(d);
    else dcDist.push(d);
  }
  for (let r = 151; r <= 166; r++) {
    const d = num("Electrical", `H${r}`);
    const units = num("Electrical", `C${r}`) ?? 0;
    if (d !== undefined && d > 0 && (units > 0 || num("Electrical", `E${r}`))) l2Dist.push(d);
  }
  const ladder = (ds: number[]) => {
    const sorted = [...ds].sort((a, b) => a - b);
    const first = sorted[0];
    const step = sorted.length >= 2 ? Math.round(((sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1)) * 10) / 10 : undefined;
    return { first, step };
  };
  const dc = dcDist.length ? ladder(dcDist) : undefined;
  const l2 = l2Dist.length ? ladder(l2Dist) : undefined;
  if (dc) mapped.push(`AC runs: ${dcDist.length} DC run(s), nearest ${dc.first} ft${dc.step !== undefined ? `, ${dc.step} ft between units` : ""}`);
  if (l2) mapped.push(`Level 2 runs: ${l2Dist.length} run(s), nearest ${l2.first} ft`);
  if (!dc && !l2 && lines.length) warnings.push("No run distances on the Electrical tab — the Quick Estimate defaults (100 ft, 15 ft steps) are in force.");
  const txToSwitchgear = num("Electrical", "B31");
  const switchgearPriced = num("Electrical", "B42");
  const boards = num("Electrical", "B36") ?? 1;
  if (boards > 1) warnings.push(`${boards} service boards in the lineup — the estimator sizes one switchboard; split the gear by hand on the Peripherals tab.`);
  if (yes("Electrical", "B34")) warnings.push(`Load management proposed (cap ${num("Electrical", "B35") ?? "not entered"} kW) — the estimator sizes the service at full nameplate.`);
  const dcRuns: number[] = [];
  for (let r = 174; r <= 205; r++) {
    const d = num("Electrical", `C${r}`);
    if (d !== undefined && d > 0) dcRuns.push(d);
  }
  if (dcRuns.length) skipped.push(`${dcRuns.length} cabinet-to-dispenser DC run(s), ${dcRuns.reduce((s, d) => s + d, 0)} ft — dispenser DC runs are not in the estimator takeoff yet.`);
  for (const [ref, label] of [
    ["B7", "Trench surface"],
    ["B8", "Trench depth (in)"],
    ["F5", "Design ambient (C)"],
    ["B30", "Point of connection"],
    ["B32", "Distance switchgear to pole (ft)"],
  ] as const) {
    const v = str("Electrical", ref);
    if (v) skipped.push(`Electrical ${label}: "${v}" — recorded in the notes, not modelled.`);
  }
  const feederBy = str("Electrical", "B119");
  const interconnection: InterconnectionInput = {
    ...defaultInterconnection(),
    serviceType: str("Electrical", "B51") as InterconnectionInput["serviceType"],
    serviceRoute: str("Electrical", "B52") as InterconnectionInput["serviceRoute"],
    distanceToPoiFt: num("Electrical", "B53") ?? null,
    applicationSubmitted: str("Electrical", "B54"),
    utilityProjectNumber: str("Electrical", "B55"),
    rule15Indicated: str("Electrical", "B57") as InterconnectionInput["rule15Indicated"],
    rule15Allowance: num("Electrical", "B58") ?? null,
    rule16: str("Electrical", "B60") as InterconnectionInput["rule16"],
    itcc: str("Electrical", "B61") as InterconnectionInput["itcc"],
    padLocationAgreed: str("Electrical", "B62") as InterconnectionInput["padLocationAgreed"],
    proofOfCommitment: str("Electrical", "B63") as InterconnectionInput["proofOfCommitment"],
    acceptsOandM: str("Electrical", "B64") as InterconnectionInput["acceptsOandM"],
    acceptsActivation: str("Electrical", "B65") as InterconnectionInput["acceptsActivation"],
    designSubmitted: str("Electrical", "B66"),
    designReturned: str("Electrical", "B67"),
    serviceFeederBy: feederBy as InterconnectionInput["serviceFeederBy"],
    pointOfConnection: str("Electrical", "B30"),
  };
  const interconnectFeeUnit = num("Electrical", "B56") ?? 0;
  const lineExtensionUnit = num("Electrical", "B59") ?? 0;
  // Distribution equipment schedule — quoted items we provide, at the materials markup.
  const distributionItems: { name: string; qty: number; unitCost: number }[] = [];
  for (let r = 130; r <= 141; r++) {
    const item = str("Electrical", `A${r}`);
    const cost = num("Electrical", `L${r}`) ?? 0;
    const who = str("Electrical", `J${r}`).toLowerCase();
    if (!item || cost <= 0 || who === "by others") continue;
    distributionItems.push({ name: `${item}${str("Electrical", `B${r}`) ? ` — ${str("Electrical", `B${r}`)}` : ""}${num("Electrical", `F${r}`) ? ` ${num("Electrical", `F${r}`)} A` : ""} (quoted)`, qty: 1, unitCost: cost });
  }
  if (distributionItems.length) mapped.push(`Distribution equipment: ${distributionItems.length} quoted item(s), ${money(distributionItems.reduce((s, i) => s + i.unitCost, 0))} into the wires and peripherals line`);

  // ---- Construction -------------------------------------------------------
  const crewDays = num("Construction", "B5");
  const crewRate = num("Construction", "B6");
  const contingency = num("Construction", "B7");
  const markupLabor = num("Construction", "B8");
  const pmPct = num("Construction", "B10");
  const markupMaterials = num("Construction", "B72");
  const include = (ref: string) => str("Construction", ref).toUpperCase() !== "N";
  const siteQty = (row: number) => (include(`E${row}`) ? num("Construction", `B${row}`) : 0);
  const concreteYd = siteQty(14);
  const asphaltSf = siteQty(17);
  const adaStalls = siteQty(19);
  const adaRamps = siteQty(20);
  const bollards = siteQty(21);
  const gprEa = siteQty(25);
  const gfiEa = siteQty(26);
  const dumpLots = siteQty(27);
  for (const [row, label] of [[15, "Rebar"], [16, "Steel mesh"], [18, "Striping"], [22, "Signs"], [23, "Sign posts"], [24, "Switchgear sign"]] as [number, string][]) {
    const q = num("Construction", `B${row}`);
    if (q !== undefined && q > 0) skipped.push(`Construction ${label} quantity ${q} — the estimator derives this line from the chargers and the dig.`);
  }
  const autoCadSets = num("Construction", "B32");
  const eeSets = num("Construction", "B33");
  const pmHours = num("Construction", "B34");
  const rentals: { name: string; qty?: number; unitCost?: number; days?: number; include: boolean }[] = [];
  for (let r = 39; r <= 52; r++) {
    const name = str("Construction", `A${r}`);
    if (!name) continue;
    rentals.push({ name, qty: num("Construction", `B${r}`), unitCost: num("Construction", `C${r}`), days: num("Construction", `D${r}`), include: include(`E${r}`) });
  }
  const fee = (row: number) => (include(`E${row}`) ? (num("Construction", `B${row}`) ?? 0) * (num("Construction", `D${row}`) ?? 0) : 0);
  const feeQty = (row: number) => (include(`E${row}`) ? (num("Construction", `B${row}`) ?? 0) : 0);
  const permitFees = fee(81) + fee(85) + fee(86) + fee(87);
  const permitQty = feeQty(81) + feeQty(85) + feeQty(86) + feeQty(87);
  const utilityFees = fee(82) + fee(88);
  const utilityQty = feeQty(82) + feeQty(88);
  const interconnectFee = feeQty(83) * interconnectFeeUnit;
  const lineExtension = feeQty(84) * lineExtensionUnit;
  if (feeQty(83) === 0 && interconnectFeeUnit > 0) warnings.push(`Interconnection design fee ${money(interconnectFeeUnit)} is on the Electrical tab but its quantity on the Construction fee table is 0 — not carried.`);

  // ---- Commercial ----------------------------------------------------------
  const commercial: CommercialInput = { ...(base.commercial ?? defaultCommercial()) };
  const model = modelInputsOf(commercial);
  const pctOr = (v: number | undefined, d: number) => (v !== undefined ? v : d);
  commercial.discountHardwarePct = pctOr(num("Commercial", "B5"), commercial.discountHardwarePct);
  commercial.discountServicePct = pctOr(num("Commercial", "B6"), commercial.discountServicePct);
  commercial.discountEvolvPct = pctOr(num("Commercial", "B7"), commercial.discountEvolvPct);
  commercial.discountInHousePct = pctOr(num("Commercial", "B8"), commercial.discountInHousePct);
  const salesTax = num("Commercial", "B9");
  commercial.serviceTerms = {
    ...(commercial.serviceTerms ?? { basis: "price-book", contractYears: 5, evolvPerPortMonth: 39.99 }),
    contractYears: pctOr(num("Commercial", "B12"), commercial.serviceTerms?.contractYears ?? 5),
    evolvPerPortMonth: pctOr(num("Commercial", "B14"), commercial.serviceTerms?.evolvPerPortMonth ?? 39.99),
    includedWarrantyYears: num("Commercial", "B13"),
  };
  if (markupLabor !== undefined) commercial.markupLaborPct = markupLabor;
  if (markupMaterials !== undefined) commercial.markupMaterialsPct = markupMaterials;
  mapped.push(`Commercial terms: ${Math.round(commercial.discountHardwarePct * 100)}% / ${Math.round(commercial.discountServicePct * 100)}% / ${Math.round(commercial.discountEvolvPct * 100)}% / ${Math.round(commercial.discountInHousePct * 100)}% discounts, ${commercial.serviceTerms.contractYears}-year service`);

  const financing = { ...model.financing };
  const offered = yes("Commercial", "B19");
  if (offered !== undefined) financing.offered = offered;
  financing.lender = str("Commercial", "B20") || financing.lender;
  financing.annualRate = pctOr(num("Commercial", "B21"), financing.annualRate);
  financing.termYears = pctOr(num("Commercial", "B22"), financing.termYears);
  financing.paymentsPerYear = pctOr(num("Commercial", "B23"), financing.paymentsPerYear);
  financing.downPayment = pctOr(num("Commercial", "B24"), financing.downPayment);
  financing.startDate = str("Commercial", "B25");
  financing.horizonYears = pctOr(num("Commercial", "B28"), financing.horizonYears);
  financing.discountRate = pctOr(num("Commercial", "B29"), financing.discountRate);
  const basisText = str("Deal_Structure", "B41").toLowerCase();
  if (basisText) financing.financeBasis = basisText.startsWith("our") ? "ours" : "whole";

  // ---- Revenue ---------------------------------------------------------------
  const revenue = { ...model.revenue };
  revenue.retailPerKwh = pctOr(num("Revenue", "B5"), revenue.retailPerKwh);
  revenue.cardFeePct = pctOr(num("Revenue", "B8"), revenue.cardFeePct);
  revenue.idleFeeRevenue = yes("Revenue", "B9") ?? revenue.idleFeeRevenue;
  revenue.stallOccupancy = pctOr(num("Revenue", "B13"), revenue.stallOccupancy);
  revenue.chargingHoursShare = pctOr(num("Revenue", "B14"), revenue.chargingHoursShare);
  revenue.deratingFactor = pctOr(num("Revenue", "B15"), revenue.deratingFactor);
  revenue.taperFactor = pctOr(num("Revenue", "B16"), revenue.taperFactor);
  revenue.rampYear1 = pctOr(num("Revenue", "B19"), revenue.rampYear1);
  revenue.rampYear2 = pctOr(num("Revenue", "B20"), revenue.rampYear2);
  revenue.rampYear3 = pctOr(num("Revenue", "B21"), revenue.rampYear3);
  revenue.growthAfterRamp = pctOr(num("Revenue", "B22"), revenue.growthAfterRamp);
  const benchmarkState = str("Revenue", "B45");
  if (benchmarkState) {
    if (MARKET_BENCHMARKS.some((b) => b.state === benchmarkState)) revenue.benchmarkState = benchmarkState;
    else warnings.push(`Benchmark state "${benchmarkState}" is not in the market table — ${revenue.benchmarkState} kept.`);
  }
  const rateSchedule = str("Revenue", "B36") || str("Project", "B27");
  const tariff = { ...model.tariff, provenance: { ...model.tariff.provenance } };
  const peakShare = num("Revenue", "B38");
  const offShare = num("Revenue", "B39");
  const superShare = num("Revenue", "B40");
  if (peakShare === undefined && offShare === undefined && superShare === undefined) tariff.touShares = null;
  else tariff.touShares = { peak: peakShare ?? 0, offPeak: offShare ?? 0, superOffPeak: superShare ?? 0 };
  const policy = POLICY[str("Revenue", "B51").toLowerCase()];
  if (policy) tariff.subscriptionPolicy = policy;
  tariff.peakToAverageFactor = pctOr(num("Revenue", "B52"), tariff.peakToAverageFactor);
  tariff.safetyMarginPct = pctOr(num("Revenue", "B53"), tariff.safetyMarginPct);
  const sizeFull = yes("Revenue", "B54");
  if (sizeFull !== undefined) tariff.sizeDemandOnFullRating = sizeFull;
  tariff.provenance.source = str("Revenue", "B82");
  tariff.provenance.verified = (str("Revenue", "B83") as "" | "Yes" | "No") || "";
  tariff.provenance.verifiedBy = str("Revenue", "B84");
  tariff.provenance.eligibilityThreshold = str("Revenue", "B85");
  tariff.provenance.crossesThreshold = (str("Revenue", "B86") as "" | "Yes" | "No") || "";
  const volumetric = num("Revenue", "B91");
  const customerCharge = num("Revenue", "B92");
  const demandCharge = num("Revenue", "B93");
  const billingDemand = num("Revenue", "B94");
  if (volumetric !== undefined || customerCharge !== undefined || demandCharge !== undefined) {
    tariff.basis = "manual";
    tariff.manual = {
      peakPerKwh: volumetric ?? 0,
      offPeakPerKwh: volumetric ?? 0,
      superOffPeakPerKwh: volumetric ?? 0,
      customerPerMonth: customerCharge ?? 0,
      demandPerKwMonth: demandCharge ?? 0,
      blockKw: 0,
      blockPerMonth: 0,
      overagePerKw: 0,
    };
    tariff.touShares = null;
    mapped.push(`Tariff figures from the intake (manual basis): ${volumetric !== undefined ? `$${volumetric}/kWh volumetric` : "no $/kWh"}${customerCharge ? `, $${customerCharge}/month customer charge` : ""}${demandCharge ? `, $${demandCharge}/kW-month demand` : ""}`);
  }
  if (billingDemand !== undefined && billingDemand > 0) {
    tariff.subscriptionPolicy = "manual";
    tariff.manualSubscribedKw = billingDemand;
    mapped.push(`Billing demand assumed ${billingDemand} kW → manual subscription level`);
  }
  for (const [ref, label] of [["B37", "Service voltage level"], ["B46", "Expected site factor"], ["B55", "Interval data available"]] as const) {
    const v = str("Revenue", ref);
    if (v) skipped.push(`Revenue ${label}: "${v}" — the model derives or does not use it.`);
  }
  const revenueBasisText = str("Revenue", "B59").toLowerCase();

  // ---- Carbon ----------------------------------------------------------------
  const carbon = { ...model.carbon };
  carbon.qualifies = (str("Carbon", "B5") as typeof carbon.qualifies) || carbon.qualifies;
  carbon.permitClears2022 = (str("Carbon", "B6") as typeof carbon.permitClears2022) || carbon.permitClears2022;
  carbon.applicationFiled = str("Carbon", "B7") || carbon.applicationFiled;
  carbon.aggregator = str("Carbon", "B8") || carbon.aggregator;
  carbon.aggregatorSharePct = pctOr(num("Carbon", "B9"), carbon.aggregatorSharePct);
  carbon.fciRatePerKwYear = pctOr(num("Carbon", "B10"), carbon.fciRatePerKwYear);
  carbon.creditingYears = pctOr(num("Carbon", "B11"), carbon.creditingYears);
  carbon.l2CreditPerKwh = pctOr(num("Carbon", "B17"), carbon.l2CreditPerKwh);
  carbon.capMultiple = pctOr(num("Carbon", "B21"), carbon.capMultiple);
  carbon.grantsAwarded = pctOr(num("Carbon", "B22"), carbon.grantsAwarded);
  carbon.federalItc = (str("Carbon", "B25") as typeof carbon.federalItc) || carbon.federalItc;
  carbon.stateProgramme = str("Carbon", "B26") || carbon.stateProgramme;
  carbon.stateProgrammeOutcome = str("Carbon", "B27") || carbon.stateProgrammeOutcome;

  // ---- Deal structure ------------------------------------------------------
  const deal = { ...model.deal };
  deal.name = str("Deal_Structure", "B9") || deal.name;
  deal.carbonSharePct = pctOr(num("Deal_Structure", "B10"), deal.carbonSharePct);
  deal.revenueSharePct = pctOr(num("Deal_Structure", "B11"), deal.revenueSharePct);
  deal.revenueShareBasis = str("Deal_Structure", "B12").toLowerCase().startsWith("gross") ? "gross" : "profit";
  deal.shareYears = pctOr(num("Deal_Structure", "B13"), deal.shareYears);
  deal.extraDiscountHardwarePct = pctOr(num("Deal_Structure", "B16"), deal.extraDiscountHardwarePct);
  deal.extraDiscountConstructionPct = pctOr(num("Deal_Structure", "B17"), deal.extraDiscountConstructionPct);
  deal.extraDiscountServicePct = pctOr(num("Deal_Structure", "B18"), deal.extraDiscountServicePct);
  deal.capitalContribution = pctOr(num("Deal_Structure", "B19"), deal.capitalContribution);
  deal.minClientNpv = pctOr(num("Deal_Structure", "B22"), deal.minClientNpv);
  deal.minReturnMultiple = pctOr(num("Deal_Structure", "B23"), deal.minReturnMultiple);
  deal.maxContribution = pctOr(num("Deal_Structure", "B24"), deal.maxContribution);
  const scopeRows: [number, ScopeLine][] = [[30, "hardware"], [31, "service"], [32, "evolv"], [34, "design"], [35, "construction"], [36, "interconnect"]];
  const scope = { ...commercial.scope };
  for (const [row, line] of scopeRows) {
    const st = SCOPE_STATUS[str("Deal_Structure", `B${row}`).toLowerCase()];
    if (st) scope[line] = st;
  }
  scope.salesTax = scope.hardware;
  commercial.scope = scope;
  const byOthers = scopeRows.filter(([, l]) => scope[l] !== "we").map(([, l]) => l);
  if (byOthers.length) mapped.push(`Scope of supply: ${byOthers.join(", ")} not provided by us`);

  // ---- Existing installation -----------------------------------------------
  let existing: ExistingInput | undefined;
  const projectType = projectTypeFromText(str("Existing", "B5"));
  if (sheets.get("Existing")) {
    const x = defaultExisting();
    x.projectType = projectType;
    x.ageYears = num("Existing", "B6") ?? null;
    x.reason = str("Existing", "B7");
    x.owner = str("Existing", "B8");
    RETAIN_ELEMENTS.forEach((e, i) => {
      const d = str("Existing", `B${13 + i}`).toUpperCase() as RetainDecision;
      if (["RETAIN", "REPLACE", "PARTIAL", "NOT PRESENT"].includes(d)) x.register[e.key] = d;
    });
    for (let r = 33; r <= 40; r++) {
      const make = str("Existing", `A${r}`);
      const qty = num("Existing", `E${r}`);
      if (!make && qty === undefined) continue;
      x.units.push({
        makeModel: make,
        kw: num("Existing", `B${r}`) ?? null,
        ports: num("Existing", `C${r}`) ?? null,
        connectors: str("Existing", `D${r}`),
        qty: qty ?? null,
        yearInstalled: str("Existing", `F${r}`),
        working: (str("Existing", `G${r}`) as UnitCondition) || "",
      });
    }
    x.infrastructure = {
      serviceA: num("Existing", "B50") ?? null,
      voltage: num("Existing", "B51") ?? null,
      spareA: num("Existing", "B52") ?? num("Electrical", "B33") ?? null,
      frameA: num("Existing", "B53") ?? null,
      branchConductor: str("Existing", "B54"),
      avgRunFt: num("Existing", "B55") ?? null,
      conduit: str("Existing", "B56"),
      rateSchedule: str("Existing", "B57"),
      separatelyMetered: (str("Existing", "B58") as ExistingInput["infrastructure"]["separatelyMetered"]) || "",
    };
    for (let r = 67; r <= 102; r++) {
      const month = str("Existing", `A${r}`);
      const kwh = num("Existing", `B${r}`);
      if (!month && kwh === undefined) continue;
      x.history.push({
        ...emptyMonth(month.length >= 7 ? month.slice(0, 7) : month),
        kwh: kwh ?? null,
        revenue: num("Existing", `C${r}`) ?? null,
        sessions: num("Existing", `D${r}`) ?? null,
        utilityCost: num("Existing", `E${r}`) ?? null,
        portsWorking: num("Existing", `F${r}`) ?? null,
        note: str("Existing", `G${r}`),
      });
    }
    CONNECTOR_KEYS.forEach((k, i) => {
      const r = 131 + i;
      const onExisting = yes("Existing", `B${r}`);
      const onNew = yes("Existing", `C${r}`);
      const share = num("Existing", `D${r}`);
      if (onExisting !== undefined) x.connectors[k].onExisting = onExisting;
      if (onNew !== undefined) x.connectors[k].onNew = onNew;
      if (share !== undefined) x.connectors[k].fleetShare = share;
    });
    x.capture = {
      availability: pctOr(num("Existing", "C150"), x.capture.availability),
      ports: pctOr(num("Existing", "C151"), x.capture.ports),
      connectors: pctOr(num("Existing", "C152"), x.capture.connectors),
      power: pctOr(num("Existing", "C153"), x.capture.power),
    };
    x.removal = {
      cabinets: num("Existing", "B174") ?? 0,
      pads: num("Existing", "B175") ?? 0,
      bollards: num("Existing", "B176") ?? 0,
      signs: num("Existing", "B177") ?? 0,
      disposalLoads: num("Existing", "B178") ?? 0,
      recycling: (str("Existing", "B179") as ExistingInput["removal"]["recycling"]) || "",
      hazmat: (str("Existing", "B180") as ExistingInput["removal"]["hazmat"]) || "",
      temporaryCharging: (str("Existing", "B181") as ExistingInput["removal"]["temporaryCharging"]) || "",
      protectionDays: num("Existing", "B182") ?? 0,
    };
    x.revenueBasis = revenueBasisText.startsWith("historical") ? "historical" : "market";
    const anything = projectType !== "greenfield" || x.units.length > 0 || x.history.length > 0;
    if (anything) {
      existing = x;
      mapped.push(`Existing installation: ${projectType === "greenfield" ? "greenfield" : `replacement — ${x.units.length} unit row(s), ${x.history.filter((m) => m.kwh !== null).length} months of history, revenue basis ${x.revenueBasis}`}`);
    }
  }

  // ---- Overrides -------------------------------------------------------------
  const overrides: OverrideEntry[] = [];
  let lineExtensionOverride: number | undefined;
  let additionalScope: number | undefined;
  let hardwareMsrpEach: number | undefined;
  const overrideRows: [number, string | null][] = [
    [9, "line:Wires, Conduits & Electrical Peripherals"],
    [10, "line:Main Distribution Switchgear"],
    [11, "siteWorks"],
    [12, "line:Dump / Waste"],
    [13, "line:Permits"],
    [14, "line:Utility"],
    [15, "line:Construction Equipment"],
    [16, "design"],
    [17, null],
    [18, null],
    [19, "switchgearA"],
    [20, null],
    [21, "crewDays"],
    [22, "kwhPerDay"],
    [23, "carbonGrossPerYear"],
    [24, "loanPayment"],
    [25, null],
    [26, "retailPerKwh"],
    [27, "blendedPerKwh"],
    [28, "fixedUtilityPerYear"],
  ];
  const today = new Date().toISOString().slice(0, 10);
  for (const [row, key] of overrideRows) {
    const v = num("Overrides", `B${row}`);
    if (v === undefined) continue;
    const reason = str("Overrides", `D${row}`);
    const label = str("Overrides", `A${row}`);
    if (row === 17) lineExtensionOverride = v;
    else if (row === 18) additionalScope = v;
    else if (row === 25) hardwareMsrpEach = v;
    else if (row === 20) skipped.push(`Override "${label}" = ${v} A — per-circuit breakers are set on the Takeoff tab; not imported.`);
    else if (key) {
      overrides.push({ id: `ov-${key}`, key, value: v, reason, source: `Intake ${templateVersion || ""} Overrides!B${row}`.trim(), date: today });
      mapped.push(`Override: ${label} = ${v}${reason ? ` (${reason})` : ""}`);
      // The intake's one "switchgear and distribution" row spans the estimator's
      // switchgear AND sub-panel / transformer / breaker lines — carry it on the
      // first and zero the second, or the distribution gear would count twice.
      if (row === 10) {
        overrides.push({ id: "ov-line:Electrical Sub-Panels, Transformers, Breakers", key: "line:Electrical Sub-Panels, Transformers, Breakers", value: 0, reason: "Included in the switchgear and distribution override (intake Overrides row 10)", source: `Intake ${templateVersion || ""} Overrides!B10`.trim(), date: today });
      }
    }
  }
  if (hardwareMsrpEach !== undefined) {
    const units = lines.reduce((s, l) => s + l.count, 0);
    if (units > 0) {
      overrides.push({ id: "ov-hardwareCost", key: "hardwareCost", value: hardwareMsrpEach * units, reason: str("Overrides", "D25"), source: `Intake Overrides!B25 × ${units} units`, date: today });
      mapped.push(`Override: hardware MSRP ${money(hardwareMsrpEach)} each × ${units} units = ${money(hardwareMsrpEach * units)}`);
    }
  }

  // ---- Build the project ---------------------------------------------------
  const quickBase: Project = JSON.parse(JSON.stringify(base));
  quickBase.setup.feederMaterial = material === "Al" ? "Al" : material === "Cu" ? "Cu" : quickBase.setup.feederMaterial;
  quickBase.setup.serviceChain = {
    ...(quickBase.setup.serviceChain ?? { enabled: false, material: "Al", utilityToSwitchgearFt: 25, switchgearToTransformerFt: 15, transformerToSubpanelFt: 15 }),
    // The utility builds the transformer-to-switchgear run under its EV infrastructure rule — not our scope.
    utilityToSwitchgearFt: feederBy.startsWith("Utility") ? 0 : (txToSwitchgear ?? quickBase.setup.serviceChain?.utilityToSwitchgearFt ?? 25),
  };
  if (feederBy.startsWith("Utility")) mapped.push("Service feeder provided by the utility — the transformer-to-switchgear run is left out of our scope");
  else if (txToSwitchgear !== undefined) mapped.push(`Transformer-to-switchgear run ${txToSwitchgear} ft (our scope)`);
  const quick = {
    ...defaultQuickInput(),
    clientName,
    siteAddress,
    lines: lines.length ? lines : [],
    extras,
    firstRunFtDcfc: dc?.first ?? 100,
    firstRunFtL2: l2?.first ?? dc?.first ?? 100,
    stepFt: dc?.step ?? l2?.step ?? 15,
    installMethod: conduit === "EMT" ? ("surface" as const) : ("trench" as const),
    includeCpm: pmPct === undefined ? true : pmPct > 0,
  };
  let project = buildQuickProject(quick, quickBase, "intake", allowance);

  project.setup = {
    ...project.setup,
    utility,
    cpm: str("Project", "B35") || project.setup.cpm,
    cra: str("Project", "B36") || project.setup.cra,
    scopeOfWork: scopeSentence || project.setup.scopeOfWork,
    gearOverrides: switchgearPriced ? { ...project.setup.gearOverrides, switchgear480A: switchgearPriced } : project.setup.gearOverrides,
  };
  if (switchgearPriced) mapped.push(`Switchgear frame being priced: ${switchgearPriced} A`);

  const f = { ...project.financial };
  if (crewDays !== undefined) f.laborBusinessDays = crewDays;
  if (crewRate !== undefined) f.laborDailyRate = crewRate;
  if (contingency !== undefined) f.contingencyPct = contingency;
  if (salesTax !== undefined) f.salesTaxPct = salesTax;
  if (pmPct !== undefined) f.pmPctOfLabor = pmPct;
  if (autoCadSets !== undefined) f.autoCadDesignCost = autoCadSets * (num("Construction", "D32") ?? 3412.5);
  if (eeSets !== undefined) f.electricalEngDesignCost = eeSets * (num("Construction", "D33") ?? 2080);
  if (pmHours !== undefined) {
    f.pmHours = pmHours;
    f.pmHourlyRate = num("Construction", "D34") ?? f.pmHourlyRate;
  }
  if (permitQty > 0) f.planCheckPermitFee = 0; // the intake carries permit and plan check as one pass-through fee
  project.financial = f;
  if (crewDays !== undefined) mapped.push(`Labour: ${crewDays} crew days at ${money(crewRate ?? f.laborDailyRate)}/day, ${Math.round((contingency ?? f.contingencyPct) * 100)}% contingency, PM ${Math.round((pmPct ?? f.pmPctOfLabor ?? 0) * 100)}% of labour`);
  if (autoCadSets !== undefined || eeSets !== undefined || pmHours !== undefined) mapped.push(`Design and engineering: ${autoCadSets ?? "—"} AutoCAD set(s), ${eeSets ?? "—"} EE set(s), ${pmHours ?? "—"} PM hours`);

  const per = { ...project.peripherals };
  if (concreteYd !== undefined) per.concreteYardsOverride = concreteYd;
  if (asphaltSf !== undefined) per.asphaltSfOverride = asphaltSf;
  if (adaStalls !== undefined) {
    per.adaVanQty = Math.min(1, adaStalls);
    per.adaStdQty = Math.max(0, adaStalls - Math.min(1, adaStalls));
    per.adaAmbQty = 0;
  }
  if (adaRamps !== undefined) per.adaRampCost = adaRamps * (num("Construction", "D20") ?? 5200);
  if (bollards !== undefined) per.bollardsQty = bollards;
  if (gfiEa !== undefined) per.gfiTestQty = gfiEa;
  if (dumpLots !== undefined) per.dumpWasteCost = dumpLots * (num("Construction", "D27") ?? 5000);
  let customItems = per.customItems ?? [];
  if (gprEa !== undefined) {
    customItems = customItems.filter((c) => c.name !== GPR_ITEM_NAME);
    if (gprEa > 0) customItems.push({ name: GPR_ITEM_NAME, qty: gprEa, unitCost: customItems.find((c) => c.name === GPR_ITEM_NAME)?.unitCost ?? 1500 });
  }
  customItems = [...customItems, ...distributionItems];
  per.customItems = customItems;
  if (permitQty > 0) per.permitFeeTotal = permitFees;
  if (utilityQty > 0) per.utilityAppFee = utilityFees;
  project.peripherals = per;
  const siteNotes = [concreteYd !== undefined && `${concreteYd} yd concrete`, asphaltSf !== undefined && `${asphaltSf} sq ft asphalt`, adaStalls !== undefined && `${adaStalls} ADA stall(s)`, bollards !== undefined && `${bollards} bollards`, gfiEa !== undefined && `${gfiEa} GFI test(s)`, dumpLots !== undefined && `${dumpLots} dump lot(s)`].filter(Boolean);
  if (siteNotes.length) mapped.push(`Site works quantities: ${siteNotes.join(", ")} (estimator rates)`);
  if (permitQty > 0 || utilityQty > 0) mapped.push(`Pass-through fees: permits ${money(permitFees)}, utility ${money(utilityFees)}${interconnectFee ? `, interconnection ${money(interconnectFee)}` : ""}${lineExtension ? `, line extension ${money(lineExtension)}` : ""}`);

  // Rentals: quantities and durations from the intake, the estimator's rates.
  const equipment: EquipmentRentalItem[] = project.equipment.map((e) => ({ ...e }));
  for (const r of rentals) {
    const key = r.name.toLowerCase().replace(/[^a-z]/g, "");
    const target = RENTAL_NAMES[key];
    const hasInput = r.qty !== undefined || r.days !== undefined;
    if (!hasInput && r.include) continue;
    if (target) {
      const item = equipment.find((e) => e.name === target);
      if (!item) continue;
      if (!r.include) item.qty = 0;
      else {
        if (r.qty !== undefined) item.qty = r.qty;
        if (r.days !== undefined) item.durationValue = target === "Temporary fencing" ? Math.max(1, Math.ceil(r.days / 7)) : r.days;
      }
      mapped.push(`Rental ${target}: qty ${item.qty}, ${item.durationValue} × ${item.rateBasis}`);
    } else if (r.include && (r.qty ?? 0) > 0) {
      equipment.push({ name: r.name, qty: r.qty ?? 1, rate: r.unitCost ?? 0, rateBasis: "per day", durationValue: r.days ?? 1, delivery: 0 });
      mapped.push(`Rental ${r.name} added: ${r.qty} × ${money(r.unitCost ?? 0)}/day × ${r.days ?? 1} days`);
    }
  }
  project.equipment = equipment;

  commercial.utilityInterconnectFee = interconnectFee;
  commercial.lineExtensionContribution = lineExtensionOverride ?? (lineExtension > 0 ? lineExtension : undefined);
  if (additionalScope !== undefined) commercial.additionalScope = additionalScope;
  commercial.tariff = tariff;
  commercial.revenue = revenue;
  commercial.carbon = carbon;
  commercial.financing = financing;
  commercial.deal = deal;
  project.commercial = commercial;

  const intake: IntakeInput = {
    ...(base.intake ?? defaultIntake()),
    contactName: str("Project", "B6"),
    contactTitle: str("Project", "B7"),
    contactEmail: str("Project", "B8"),
    contactPhone: str("Project", "B9"),
    propertyType: str("Project", "B16"),
    publicAccess: access ? (access.toLowerCase().startsWith("public") ? "Yes" : "No") : "",
    hoursOpen: hoursOpen ?? null,
    daysPerWeek: daysOpen !== undefined ? Math.min(7, Math.max(1, Math.round((daysOpen / 365) * 7))) : null,
    daysOpenPerYear: daysOpen ?? null,
    state: utilityRow?.state ?? (base.intake?.state || "California"),
    rateSchedule,
    currentRateSchedule: str("Project", "B27"),
    existingServiceA: num("Project", "B28") ?? null,
    existingServiceVoltage: num("Project", "B29") ?? null,
    billsObtained: (str("Project", "B30") as IntakeInput["billsObtained"]) || "",
    separatelyMeteredEv: existing?.infrastructure.separatelyMetered === "Yes" || existing?.infrastructure.separatelyMetered === "No" ? existing.infrastructure.separatelyMetered : "",
    proposalDate: str("Project", "B33"),
    validityDays: num("Project", "B34") ?? null,
    projectReference,
    notes: [revisionNotes, `Imported from EVSE Project Intake ${templateVersion || "(unknown version)"}${fileVersion ? ` ${fileVersion}` : ""}${completedBy ? ` completed by ${completedBy}` : ""}${dateCompleted ? ` on ${dateCompleted}` : ""}.`, ...skipped.filter((s) => s.startsWith("Electrical")).map((s) => `• ${s}`)]
      .filter(Boolean)
      .join("\n"),
    siteName,
    county: str("Project", "B15"),
    cca: str("Project", "B46"),
    interconnection,
  };
  project.intake = intake;
  if (rateSchedule) mapped.push(`Rate schedule ${rateSchedule}${access ? ` · ${access}` : ""} · ${hoursOpen ?? 24} h/day · ${daysOpen ?? 365} days/yr`);
  project.existing = existing;
  project.overrides = overrides.length ? overrides : undefined;

  project = applyEquipmentSchedule(project, allowance);
  project = applyRemovalScope(project);
  project = applyFieldOverrides(project);
  if (existing && existing.projectType !== "greenfield") {
    const items = project.peripherals.demolitionItems ?? [];
    if (items.length) mapped.push(`Removal scope: ${items.length} line(s) into Dump / Waste at the estimator's removal rates`);
  }
  warnings.push("The Quick Estimate's Build button re-derives quantities from its inputs — the intake's site-works quantities and fees live on the Peripherals and Financials tabs and would need re-entering after a rebuild.");

  return {
    project,
    name: clientName || siteName || "Imported intake",
    report: { templateVersion, contentHash, fileVersion, completedBy, dateCompleted, mapped, skipped, warnings },
  };
}

/** Read an .xlsx and import it. */
export async function importIntakeFile(data: ArrayBuffer | Uint8Array, base: Project, allowance: Record<string, number> = HARDWARE_ALLOWANCE): Promise<IntakeImportResult> {
  const wb = await readWorkbook(data);
  if (!looksLikeIntake(wb)) throw new Error("This workbook does not look like an EVSE Project Intake (no Project / Equipment / Commercial sheets).");
  return projectFromIntake(wb, base, allowance);
}
