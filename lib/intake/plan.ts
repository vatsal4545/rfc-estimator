// Plan the fill of the CEO's EVSE Project Intake 2.9.0 from a project — which
// cell gets which value. Pure and light (no zip code), so the intake tabs can
// preview it live; fillIntake.ts applies it to the template.
//
// The client does not fill the intake — we do, from the estimate. Every blue
// cell the estimator knows is written into a copy of the blank template
// (values only; the template's formulas, checks, dropdowns and comments are
// untouched), and the estimator's construction and engineering figures go
// into the intake's own Overrides register with their reasons. The CEO opens
// the file they know, every green check recalculates, and their engine prices
// the job on the estimator's numbers with the intake's derivation visible
// beside them. What the estimator does not model is reported so a human can
// finish those cells.

import { GPR_ITEM_NAME } from "../calc/autoplan";
import { effectiveInstallMethod } from "../calc/install";
import type { EstimateResult, GearSelection, Project } from "../calc/types";
import { CONNECTOR_KEYS, PROJECT_TYPE_TEXT, RETAIN_ELEMENTS } from "../existing";
import { defaultInterconnection } from "../interconnection";
import { defaultServiceTerms, modelInputsOf } from "../proposal/defaults";
import type { ProposalResult, ScopeLine, ScopeStatus } from "../proposal/types";
import { findSku } from "../ref/priceBook";
import {
  AC_RUN_TABLE,
  CARBON_CELLS,
  COMMERCIAL_CELLS,
  CONSTRUCTION_CELLS,
  DEAL_CELLS,
  DISTRIBUTION_TABLE,
  ELECTRICAL_CELLS,
  EQUIPMENT_TABLE,
  EXISTING_CAPTURE_ROWS,
  EXISTING_CELLS,
  EXISTING_CONNECTOR_ROWS,
  EXISTING_HISTORY_TABLE,
  EXISTING_REMOVAL_CELLS,
  EXISTING_UNITS_TABLE,
  FEE_COLS,
  FEE_ROWS,
  INTAKE_TEXT,
  L2_CIRCUIT_TABLE,
  OVERRIDE_COLS,
  PROJECT_CELLS,
  RENTAL_TABLE,
  RENTAL_ROW_NAMES,
  REVENUE_CELLS,
  SCOPE_ROWS,
  SERVICE_FEEDER_ROW,
  SITE_WORKS_COLS,
  SITE_WORKS_ROWS,
  VERSION_CELLS,
  conductorToIntake,
  conduitToIntake,
} from "./cells";
import { estimatorOverrideRows, type IntakeOverrideRow } from "./handoff";
import { isoToSerial } from "./serial";
import type { CellWrite } from "./xlsxWrite";

export interface IntakeFillOptions {
  /** ISO date written as "Date completed"; defaults to today. */
  today?: string;
  /** Carry the estimator's construction and engineering figures into the Overrides register (default: the project's setting, else true). */
  carryOverrides?: boolean;
}

export interface IntakeFillPlan {
  writes: CellWrite[];
  fileVersion: string;
  overrides: IntakeOverrideRow[];
  /** Blue cells left for a human — what the estimator does not model. */
  leftBlank: string[];
  warnings: string[];
}

const SCOPE_TEXT: Record<ScopeStatus, string> = { we: INTAKE_TEXT.weProvide, others: INTAKE_TEXT.byOthers, none: INTAKE_TEXT.notRequired };
const DC_CAPACITIES = [30, 60, 120, 160, 180, 240, 360];

/** The intake's capacity-picker label for a generic (SKU-less) estimator model. */
export function capacityForLoadType(loadTypeId: string): string | undefined {
  if (loadTypeId.startsWith("Power cabinet")) return INTAKE_TEXT.capacityDistributed;
  if (/^L2\b/i.test(loadTypeId)) return INTAKE_TEXT.capacityLevel2;
  const m = /(\d+)\s*kW/i.exec(loadTypeId);
  if (m && DC_CAPACITIES.includes(Number(m[1]))) return `${m[1]} kW DC`;
  return undefined;
}

/** "15000 Hawthorn Blvd, Hawthorne, CA 90260" → street + the rest. */
export function splitAddress(address: string): [string, string] {
  const i = address.indexOf(",");
  if (i < 0) return [address.trim(), ""];
  return [address.slice(0, i).trim(), address.slice(i + 1).trim()];
}

function gearType(item: string): string {
  const t = item.toLowerCase();
  if (t.includes("switchgear") || t.includes("switchboard")) return "Switchboard";
  if (t.includes("transformer")) return "Transformer";
  if (t.includes("sub-panel") || t.includes("subpanel") || t.includes("sub panel")) return "Subpanel";
  if (t.includes("panel")) return "Panelboard";
  if (t.includes("disconnect")) return "Service disconnect";
  return "Other";
}

const parseNumber = (text: string): number | undefined => {
  const m = /(\d+(?:\.\d+)?)/.exec(text);
  return m ? Number(m[1]) : undefined;
};

/** Everything the estimator can say about the project, as intake cell writes. Pure. */
export function planIntakeFill(project: Project, result: EstimateResult, proposal: ProposalResult | null, opts: IntakeFillOptions = {}): IntakeFillPlan {
  const writes: CellWrite[] = [];
  const leftBlank: string[] = [];
  const warnings: string[] = [];
  const put = (sheet: string, ref: string, value: string | number | null | undefined) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" && value.trim() === "") return;
    if (typeof value === "number" && !Number.isFinite(value)) return;
    writes.push({ sheet, ref, value });
  };
  const yesNo = (b: boolean | undefined | null) => (b === undefined || b === null ? undefined : b ? INTAKE_TEXT.yes : INTAKE_TEXT.no);
  const yn = (on: boolean) => (on ? "Y" : "N");
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const it = project.intake;
  const s = project.setup;
  const f = project.financial;
  const per = project.peripherals;
  const q = project.quick;
  const c = project.commercial;
  const m = modelInputsOf(c);
  const x = project.existing;
  const ic = { ...defaultInterconnection(), ...it?.interconnection };
  const loadTypeOf = (id: string) => project.loadTypes.find((l) => l.id === id);

  // ---- Version ------------------------------------------------------------
  const fileVersion = it?.fileVersion?.trim() || "Rev A";
  put("Version", VERSION_CELLS.fileVersion, fileVersion);
  put("Version", VERSION_CELLS.dateCompleted, today);
  put("Version", VERSION_CELLS.completedBy, it?.completedBy?.trim() || s.cpm);
  put("Version", VERSION_CELLS.projectReference, it?.projectReference);
  const generated = `Filled by the RFC Estimator on ${today}${s.clientName ? ` for ${s.clientName}` : ""}. Construction and engineering figures are the estimator's — see the Overrides tab.`;
  put("Version", VERSION_CELLS.revisionNotes, [it?.revisionNotes?.trim(), generated].filter(Boolean).join(" "));

  // ---- Project ------------------------------------------------------------
  put("Project", PROJECT_CELLS.clientName, s.clientName);
  put("Project", PROJECT_CELLS.contactName, it?.contactName);
  put("Project", PROJECT_CELLS.contactTitle, it?.contactTitle);
  put("Project", PROJECT_CELLS.contactEmail, it?.contactEmail);
  put("Project", PROJECT_CELLS.contactPhone, it?.contactPhone);
  put("Project", PROJECT_CELLS.siteName, it?.siteName || s.clientName);
  const [street, cityStateZip] = splitAddress(s.siteAddress);
  put("Project", PROJECT_CELLS.street, street);
  put("Project", PROJECT_CELLS.cityStateZip, cityStateZip);
  put("Project", PROJECT_CELLS.county, it?.county);
  put("Project", PROJECT_CELLS.propertyType, it?.propertyType);
  const hours = it?.hoursOpen ?? 24;
  const access = it?.publicAccess === "Yes" ? (hours >= 24 ? "Public 24/7" : "Public during business hours") : it?.publicAccess === "No" ? "Restricted" : undefined;
  put("Project", PROJECT_CELLS.access, access);
  put("Project", PROJECT_CELLS.hoursOpen, hours);
  put("Project", PROJECT_CELLS.daysOpen, it?.daysOpenPerYear ?? (it?.daysPerWeek ? Math.round((it.daysPerWeek / 7) * 365) : 365));
  put("Project", PROJECT_CELLS.utility, s.utility);
  put("Project", PROJECT_CELLS.currentSchedule, it?.currentRateSchedule);
  put("Project", PROJECT_CELLS.existingServiceA, it?.existingServiceA ?? x?.infrastructure.serviceA ?? undefined);
  put("Project", PROJECT_CELLS.serviceVoltage, it?.existingServiceVoltage ?? 480);
  put("Project", PROJECT_CELLS.billsObtained, it?.billsObtained);
  const proposalSerial = it?.proposalDate ? isoToSerial(it.proposalDate) : null;
  if (proposalSerial !== null) put("Project", PROJECT_CELLS.proposalDate, proposalSerial);
  put("Project", PROJECT_CELLS.validityDays, it?.validityDays ?? undefined);
  put("Project", PROJECT_CELLS.preparedBy, s.cpm);
  put("Project", PROJECT_CELLS.accountOwner, s.cra);
  put("Project", PROJECT_CELLS.cca, it?.cca);

  // ---- Existing -----------------------------------------------------------
  put("Existing", EXISTING_CELLS.projectType, PROJECT_TYPE_TEXT[x?.projectType ?? "greenfield"]);
  if (x && x.projectType !== "greenfield") {
    put("Existing", EXISTING_CELLS.ageYears, x.ageYears ?? undefined);
    put("Existing", EXISTING_CELLS.reason, x.reason);
    put("Existing", EXISTING_CELLS.owner, x.owner);
    RETAIN_ELEMENTS.forEach((e, i) => put("Existing", `B${EXISTING_CELLS.registerFirstRow + i}`, x.register[e.key] || undefined));
    const unitRows = EXISTING_UNITS_TABLE.lastRow - EXISTING_UNITS_TABLE.firstRow + 1;
    x.units.slice(0, unitRows).forEach((u, i) => {
      const r = EXISTING_UNITS_TABLE.firstRow + i;
      put("Existing", `${EXISTING_UNITS_TABLE.makeModel}${r}`, u.makeModel);
      put("Existing", `${EXISTING_UNITS_TABLE.kw}${r}`, u.kw ?? undefined);
      put("Existing", `${EXISTING_UNITS_TABLE.ports}${r}`, u.ports ?? undefined);
      put("Existing", `${EXISTING_UNITS_TABLE.connectors}${r}`, u.connectors);
      put("Existing", `${EXISTING_UNITS_TABLE.qty}${r}`, u.qty ?? undefined);
      put("Existing", `${EXISTING_UNITS_TABLE.yearInstalled}${r}`, u.yearInstalled);
      put("Existing", `${EXISTING_UNITS_TABLE.working}${r}`, u.working);
    });
    if (x.units.length > unitRows) warnings.push(`${x.units.length - unitRows} existing unit row(s) beyond the intake's ${unitRows} were not written.`);
    const inf = x.infrastructure;
    put("Existing", EXISTING_CELLS.serviceA, inf.serviceA ?? undefined);
    put("Existing", EXISTING_CELLS.voltage, inf.voltage ?? undefined);
    put("Existing", EXISTING_CELLS.spareA, inf.spareA ?? undefined);
    put("Existing", EXISTING_CELLS.frameA, inf.frameA ?? undefined);
    put("Existing", EXISTING_CELLS.branchConductor, inf.branchConductor);
    put("Existing", EXISTING_CELLS.avgRunFt, inf.avgRunFt ?? undefined);
    put("Existing", EXISTING_CELLS.conduit, inf.conduit);
    put("Existing", EXISTING_CELLS.rateSchedule, inf.rateSchedule);
    put("Existing", EXISTING_CELLS.separatelyMetered, inf.separatelyMetered);
    const monthRows = EXISTING_HISTORY_TABLE.lastRow - EXISTING_HISTORY_TABLE.firstRow + 1;
    const history = x.history.slice(0, monthRows);
    history.forEach((h, i) => {
      const r = EXISTING_HISTORY_TABLE.firstRow + i;
      put("Existing", `${EXISTING_HISTORY_TABLE.month}${r}`, h.month);
      put("Existing", `${EXISTING_HISTORY_TABLE.kwh}${r}`, h.kwh ?? undefined);
      put("Existing", `${EXISTING_HISTORY_TABLE.revenue}${r}`, h.revenue ?? undefined);
      put("Existing", `${EXISTING_HISTORY_TABLE.sessions}${r}`, h.sessions ?? undefined);
      put("Existing", `${EXISTING_HISTORY_TABLE.utilityCost}${r}`, h.utilityCost ?? undefined);
      put("Existing", `${EXISTING_HISTORY_TABLE.portsWorking}${r}`, h.portsWorking ?? undefined);
      put("Existing", `${EXISTING_HISTORY_TABLE.note}${r}`, h.note);
    });
    if (x.history.length > monthRows) warnings.push(`${x.history.length - monthRows} history month(s) beyond the intake's ${monthRows} were not written.`);
    CONNECTOR_KEYS.forEach((k, i) => {
      const r = EXISTING_CONNECTOR_ROWS.firstRow + i;
      put("Existing", `${EXISTING_CONNECTOR_ROWS.onExisting}${r}`, yesNo(x.connectors[k].onExisting));
      put("Existing", `${EXISTING_CONNECTOR_ROWS.onNew}${r}`, yesNo(x.connectors[k].onNew));
      put("Existing", `${EXISTING_CONNECTOR_ROWS.fleetShare}${r}`, x.connectors[k].fleetShare);
    });
    put("Existing", `${EXISTING_CAPTURE_ROWS.col}${EXISTING_CAPTURE_ROWS.availability}`, x.capture.availability);
    put("Existing", `${EXISTING_CAPTURE_ROWS.col}${EXISTING_CAPTURE_ROWS.ports}`, x.capture.ports);
    put("Existing", `${EXISTING_CAPTURE_ROWS.col}${EXISTING_CAPTURE_ROWS.connectors}`, x.capture.connectors);
    put("Existing", `${EXISTING_CAPTURE_ROWS.col}${EXISTING_CAPTURE_ROWS.power}`, x.capture.power);
    put("Existing", EXISTING_REMOVAL_CELLS.cabinets, x.removal.cabinets);
    put("Existing", EXISTING_REMOVAL_CELLS.pads, x.removal.pads);
    put("Existing", EXISTING_REMOVAL_CELLS.bollards, x.removal.bollards);
    put("Existing", EXISTING_REMOVAL_CELLS.signs, x.removal.signs);
    put("Existing", EXISTING_REMOVAL_CELLS.disposalLoads, x.removal.disposalLoads);
    put("Existing", EXISTING_REMOVAL_CELLS.recycling, x.removal.recycling);
    put("Existing", EXISTING_REMOVAL_CELLS.hazmat, x.removal.hazmat);
    put("Existing", EXISTING_REMOVAL_CELLS.temporaryCharging, x.removal.temporaryCharging);
    put("Existing", EXISTING_REMOVAL_CELLS.protectionDays, x.removal.protectionDays);
    // Revenue tab's historical block — the site's own run rate.
    const withKwh = history.filter((h) => h.kwh !== null && h.kwh !== undefined);
    if (withKwh.length > 0) {
      const months = withKwh.length;
      const kwh = withKwh.reduce((t, h) => t + (h.kwh ?? 0), 0);
      put("Revenue", REVENUE_CELLS.historyMonths, months);
      put("Revenue", REVENUE_CELLS.historyKwhPerDay, Math.round((kwh / (months * (365 / 12))) * 10) / 10);
      const withRevenue = withKwh.filter((h) => h.revenue !== null && h.revenue !== undefined);
      if (withRevenue.length) {
        const revenue = withRevenue.reduce((t, h) => t + (h.revenue ?? 0), 0);
        put("Revenue", REVENUE_CELLS.historyRevenuePerYear, Math.round((revenue * 12) / withRevenue.length));
        const withCost = withRevenue.filter((h) => h.utilityCost !== null && h.utilityCost !== undefined);
        if (withCost.length) {
          const profit = withCost.reduce((t, h) => t + (h.revenue ?? 0) - (h.utilityCost ?? 0), 0);
          put("Revenue", REVENUE_CELLS.historyProfitPerYear, Math.round((profit * 12) / withCost.length));
        }
      }
      const withPorts = withKwh.filter((h) => h.portsWorking !== null && h.portsWorking !== undefined);
      if (withPorts.length) put("Revenue", REVENUE_CELLS.historyPortsInService, Math.round((withPorts.reduce((t, h) => t + (h.portsWorking ?? 0), 0) / withPorts.length) * 10) / 10);
    }
    put("Revenue", REVENUE_CELLS.revenueBasis, x.revenueBasis === "historical" ? INTAKE_TEXT.revenueBasis.historical : INTAKE_TEXT.revenueBasis.market);
  }

  // ---- Equipment ------------------------------------------------------------
  const lineRows: { loadTypeId: string; rowNo: number }[] = [];
  const chargerLines = (q?.lines ?? []).filter((l) => l.count > 0);
  const extras = (q?.extras ?? []).filter((e) => e.count > 0);
  const dispenserExtras = extras.filter((e) => findSku(e.sku)?.role === "dispenser");
  const accessoryExtras = extras.filter((e) => findSku(e.sku)?.role !== "dispenser");
  const isCabinetLine = (l: { loadTypeId: string; sku?: string }) => (l.sku ? findSku(l.sku)?.role === "power_cabinet" : false) || l.loadTypeId.startsWith("Power cabinet");
  const totalCabinets = chargerLines.filter(isCabinetLine).reduce((t, l) => t + l.count, 0);
  const totalDispensers = dispenserExtras.reduce((t, e) => t + e.count, 0);
  const perCabinet = totalCabinets > 0 ? Math.floor(totalDispensers / totalCabinets) : 0;
  if (totalCabinets > 0 && perCabinet * totalCabinets !== totalDispensers) {
    warnings.push(`${totalDispensers} dispenser(s) do not divide evenly across ${totalCabinets} cabinet(s) — ${perCabinet} per cabinet written, ${totalDispensers - perCabinet * totalCabinets} left off the Equipment tab.`);
  }
  const dispenserSku = dispenserExtras[0] ? findSku(dispenserExtras[0].sku) : undefined;
  let eqRow = EQUIPMENT_TABLE.firstRow;
  const equipmentRow = (capacity: string | undefined, sku: string | undefined, qty: number, extra?: { dispenserSku?: string; perCabinet?: number; connectors?: number }, label?: string): number | undefined => {
    if (eqRow > EQUIPMENT_TABLE.lastRow) {
      warnings.push(`${label ?? sku ?? capacity ?? "Equipment line"} × ${qty} does not fit — the intake has ${EQUIPMENT_TABLE.lastRow - EQUIPMENT_TABLE.firstRow + 1} equipment rows.`);
      return undefined;
    }
    put("Equipment", `${EQUIPMENT_TABLE.capacity}${eqRow}`, capacity);
    put("Equipment", `${EQUIPMENT_TABLE.sku}${eqRow}`, sku);
    put("Equipment", `${EQUIPMENT_TABLE.qty}${eqRow}`, qty);
    if (extra?.perCabinet) {
      put("Equipment", `${EQUIPMENT_TABLE.dispenserSku}${eqRow}`, extra.dispenserSku);
      put("Equipment", `${EQUIPMENT_TABLE.dispensersPerCabinet}${eqRow}`, extra.perCabinet);
      put("Equipment", `${EQUIPMENT_TABLE.connectorsPerDispenser}${eqRow}`, extra.connectors);
    }
    return eqRow++;
  };
  for (const l of chargerLines) {
    const sku = l.sku ? findSku(l.sku) : undefined;
    if (!sku) warnings.push(`${l.loadTypeId} × ${l.count} has no price-book SKU — the intake cannot price it. Pick a SKU on the Equipment tab.`);
    const rowNo = equipmentRow(
      sku ? sku.capacity : capacityForLoadType(l.loadTypeId),
      sku?.sku,
      l.count,
      isCabinetLine(l) && perCabinet > 0 ? { dispenserSku: dispenserSku?.sku, perCabinet, connectors: dispenserSku?.connectors || 2 } : undefined,
      l.loadTypeId,
    );
    if (rowNo !== undefined) lineRows.push({ loadTypeId: l.loadTypeId, rowNo });
  }
  if (totalCabinets === 0) for (const e of dispenserExtras) equipmentRow(findSku(e.sku)?.capacity ?? INTAKE_TEXT.capacityDistributed, e.sku, e.count);
  for (const e of accessoryExtras) equipmentRow(findSku(e.sku)?.capacity ?? INTAKE_TEXT.capacityAccessory, e.sku, e.count);
  put("Equipment", EQUIPMENT_TABLE.scopeSentence, s.scopeOfWork);
  const lineNoFor = (loadTypeId: string): number | undefined => {
    const hit = lineRows.find((r) => r.loadTypeId === loadTypeId);
    return hit ? hit.rowNo - EQUIPMENT_TABLE.firstRow + 1 : undefined;
  };

  // ---- Electrical -----------------------------------------------------------
  const method = effectiveInstallMethod(s);
  put("Electrical", ELECTRICAL_CELLS.material, s.feederMaterial);
  put("Electrical", ELECTRICAL_CELLS.conduit, s.conduitType === "EMT" ? "EMT" : "PVC");
  if (method === "hybrid") warnings.push("Hybrid install: the intake carries one conduit type — EMT written; the trenched service section is not distinguishable on the intake.");
  leftBlank.push("Electrical B7 trench surface, B8 trench depth, F5 design ambient — site facts the estimator does not model.");
  let acRow = AC_RUN_TABLE.firstRow;
  let acOverflow = 0;
  for (const r of result.rows) {
    if (r.synthetic || r.category === "L2") continue;
    const lt = loadTypeOf(r.loadTypeId);
    const parallel = lt?.runsAreParallel ?? false;
    if (!parallel && r.resolvedRunsPerUnit > 1) warnings.push(`${r.location}: ${r.resolvedRunsPerUnit} separate circuits per unit in the estimator — the intake carries one AC run per unit (sets = 1).`);
    for (let u = 0; u < Math.max(1, r.units); u++) {
      if (acRow > AC_RUN_TABLE.lastRow) {
        acOverflow++;
        continue;
      }
      put("Electrical", `${AC_RUN_TABLE.line}${acRow}`, lineNoFor(r.loadTypeId));
      put("Electrical", `${AC_RUN_TABLE.distanceFt}${acRow}`, r.oneWayDistFt);
      put("Electrical", `${AC_RUN_TABLE.conductor}${acRow}`, conductorToIntake(r.selectedWire));
      put("Electrical", `${AC_RUN_TABLE.sets}${acRow}`, parallel ? r.resolvedRunsPerUnit : 1);
      put("Electrical", `${AC_RUN_TABLE.conduit}${acRow}`, conduitToIntake(r.conduitSize));
      acRow++;
    }
  }
  if (acOverflow) warnings.push(`${acOverflow} DC unit run(s) beyond the intake's ${AC_RUN_TABLE.lastRow - AC_RUN_TABLE.firstRow + 1} AC-run rows were not written.`);
  put("Electrical", ELECTRICAL_CELLS.pointOfConnection, ic.pointOfConnection);
  put("Electrical", ELECTRICAL_CELLS.txToSwitchgearFt, s.serviceChain?.utilityToSwitchgearFt);
  put("Electrical", ELECTRICAL_CELLS.spareCapacityA, x?.infrastructure.spareA ?? undefined);
  const frame = result.panel.bus480 ?? result.panel.bus208;
  put("Electrical", ELECTRICAL_CELLS.switchgearPricedA, frame?.suggestedBusA);
  leftBlank.push("Electrical B32 distance to the pole, B34–B36 load management and board count — the estimator sizes one board at full nameplate.");
  put("Electrical", ELECTRICAL_CELLS.serviceType, ic.serviceType);
  put("Electrical", ELECTRICAL_CELLS.serviceRoute, ic.serviceRoute);
  put("Electrical", ELECTRICAL_CELLS.distanceToPoiFt, ic.distanceToPoiFt ?? undefined);
  put("Electrical", ELECTRICAL_CELLS.applicationSubmitted, ic.applicationSubmitted);
  put("Electrical", ELECTRICAL_CELLS.utilityProjectNumber, ic.utilityProjectNumber);
  if ((c?.utilityInterconnectFee ?? 0) > 0) put("Electrical", ELECTRICAL_CELLS.interconnectFee, c!.utilityInterconnectFee);
  put("Electrical", ELECTRICAL_CELLS.rule15Indicated, ic.rule15Indicated);
  put("Electrical", ELECTRICAL_CELLS.rule15Allowance, ic.rule15Allowance ?? undefined);
  if ((c?.lineExtensionContribution ?? 0) > 0) put("Electrical", ELECTRICAL_CELLS.contributionAboveAllowance, c!.lineExtensionContribution);
  put("Electrical", ELECTRICAL_CELLS.rule16, ic.rule16);
  put("Electrical", ELECTRICAL_CELLS.itcc, ic.itcc);
  put("Electrical", ELECTRICAL_CELLS.padLocationAgreed, ic.padLocationAgreed);
  put("Electrical", ELECTRICAL_CELLS.proofOfCommitment, ic.proofOfCommitment);
  put("Electrical", ELECTRICAL_CELLS.acceptsOandM, ic.acceptsOandM);
  put("Electrical", ELECTRICAL_CELLS.acceptsActivation, ic.acceptsActivation);
  put("Electrical", ELECTRICAL_CELLS.designSubmitted, ic.designSubmitted);
  put("Electrical", ELECTRICAL_CELLS.designReturned, ic.designReturned);
  put("Electrical", ELECTRICAL_CELLS.feederBy, ic.serviceFeederBy);
  const svc = result.rows.find((r) => r.synthetic && r.loadTypeId.startsWith("SVC Utility"));
  put("Electrical", `${SERVICE_FEEDER_ROW.material}${SERVICE_FEEDER_ROW.row}`, s.serviceChain?.material ?? svc?.material);
  if (svc) {
    put("Electrical", `${SERVICE_FEEDER_ROW.conductor}${SERVICE_FEEDER_ROW.row}`, conductorToIntake(svc.selectedWire));
    put("Electrical", `${SERVICE_FEEDER_ROW.sets}${SERVICE_FEEDER_ROW.row}`, svc.resolvedRunsPerUnit);
  }
  // Distribution equipment — documented, priced through the override register (never twice).
  const gear: GearSelection[] = per.useAutoGear ? result.panel.suggestedGear : per.gear;
  let dRow = DISTRIBUTION_TABLE.firstRow;
  const distributionRow = (item: string, type: string, qty: number, volts?: number, ratingA?: number) => {
    if (dRow > DISTRIBUTION_TABLE.lastRow) return;
    put("Electrical", `${DISTRIBUTION_TABLE.item}${dRow}`, item);
    put("Electrical", `${DISTRIBUTION_TABLE.type}${dRow}`, type);
    put("Electrical", `${DISTRIBUTION_TABLE.qty}${dRow}`, qty);
    put("Electrical", `${DISTRIBUTION_TABLE.volts}${dRow}`, volts);
    put("Electrical", `${DISTRIBUTION_TABLE.ratingA}${dRow}`, ratingA);
    put("Electrical", `${DISTRIBUTION_TABLE.whoProvides}${dRow}`, INTAKE_TEXT.feederByUs);
    put("Electrical", `${DISTRIBUTION_TABLE.costBasis}${dRow}`, INTAKE_TEXT.costBasisPricedElsewhere);
    dRow++;
  };
  for (const g of gear) {
    if (g.qty <= 0) continue;
    const amps = /a$/i.test(g.size.trim()) ? parseNumber(g.size) : undefined;
    distributionRow(`${g.item} ${g.size}`.trim(), gearType(g.item), g.qty, parseNumber(g.voltage), amps);
  }
  for (const item of per.customItems ?? []) if (/\(quoted\)$/.test(item.name) && item.qty > 0) distributionRow(item.name.replace(/\s*\(quoted\)$/, ""), "Other", item.qty);
  let l2Row = L2_CIRCUIT_TABLE.firstRow;
  let l2Overflow = 0;
  for (const r of result.rows) {
    if (r.synthetic || r.category !== "L2") continue;
    const lt = loadTypeOf(r.loadTypeId);
    const circuits = (lt?.runsAreParallel ? 1 : Math.max(1, r.resolvedRunsPerUnit)) * Math.max(1, r.units);
    for (let i = 0; i < circuits; i++) {
      if (l2Row > L2_CIRCUIT_TABLE.lastRow) {
        l2Overflow++;
        continue;
      }
      put("Electrical", `${L2_CIRCUIT_TABLE.line}${l2Row}`, lineNoFor(r.loadTypeId));
      put("Electrical", `${L2_CIRCUIT_TABLE.units}${l2Row}`, 1);
      put("Electrical", `${L2_CIRCUIT_TABLE.volts}${l2Row}`, r.volts);
      put("Electrical", `${L2_CIRCUIT_TABLE.ampsPerUnit}${l2Row}`, Math.round(r.designAmps * 10) / 10);
      put("Electrical", `${L2_CIRCUIT_TABLE.distanceFt}${l2Row}`, r.oneWayDistFt);
      put("Electrical", `${L2_CIRCUIT_TABLE.conductor}${l2Row}`, conductorToIntake(r.selectedWire));
      l2Row++;
    }
  }
  if (l2Overflow) warnings.push(`${l2Overflow} Level 2 circuit(s) beyond the intake's ${L2_CIRCUIT_TABLE.lastRow - L2_CIRCUIT_TABLE.firstRow + 1} rows were not written.`);
  if (totalCabinets > 0) leftBlank.push("Electrical rows 174–205 cabinet-to-dispenser DC runs — the estimator sizes the cabinets' AC feeders only.");

  // ---- Construction ---------------------------------------------------------
  put("Construction", CONSTRUCTION_CELLS.crewDays, f.laborBusinessDays);
  put("Construction", CONSTRUCTION_CELLS.crewRate, f.laborDailyRate);
  put("Construction", CONSTRUCTION_CELLS.contingency, f.contingencyPct);
  put("Construction", CONSTRUCTION_CELLS.markupLabor, c?.markupLaborPct);
  put("Construction", CONSTRUCTION_CELLS.pmPct, f.pmPctOfLabor ?? 0);
  const civil = result.peripherals.lines.civil;
  const signage = result.peripherals.lines.signage;
  const qtyOf = (list: { name: string; qty: number }[], pred: (name: string) => boolean) => list.filter((l) => pred(l.name)).reduce((t, l) => t + l.qty, 0);
  const siteQty = (row: number, qty: number) => {
    put("Construction", `${SITE_WORKS_COLS.qty}${row}`, Math.round(qty * 100) / 100);
    put("Construction", `${SITE_WORKS_COLS.include}${row}`, yn(qty > 0));
  };
  siteQty(SITE_WORKS_ROWS.concreteYd, qtyOf(civil, (n) => n.startsWith("Concrete (")));
  siteQty(SITE_WORKS_ROWS.rebar, qtyOf(civil, (n) => n === "Rebar"));
  siteQty(SITE_WORKS_ROWS.asphaltSf, qtyOf(civil, (n) => n === "Asphalt paving — parking stalls"));
  siteQty(SITE_WORKS_ROWS.striping, qtyOf(signage, (n) => n === "Striping") > 0 ? 1 : 0);
  const adaPerType = qtyOf(civil, (n) => /^ADA (van|standard|ambulatory)/.test(n));
  siteQty(SITE_WORKS_ROWS.adaStalls, adaPerType > 0 ? adaPerType : qtyOf(civil, (n) => n === "ADA asphalt / paving allowance"));
  siteQty(SITE_WORKS_ROWS.adaRamp, qtyOf(civil, (n) => n === "ADA ramp"));
  siteQty(SITE_WORKS_ROWS.bollards, qtyOf(signage, (n) => n === "Bollards"));
  siteQty(SITE_WORKS_ROWS.signs, qtyOf(signage, (n) => n === "Signs"));
  siteQty(SITE_WORKS_ROWS.signPosts, qtyOf(signage, (n) => n === "Sign posts"));
  siteQty(SITE_WORKS_ROWS.gpr, (per.customItems ?? []).find((i) => i.name === GPR_ITEM_NAME)?.qty ?? 0);
  siteQty(SITE_WORKS_ROWS.gfi, qtyOf(civil, (n) => n.startsWith("GFI test")));
  siteQty(SITE_WORKS_ROWS.dump, qtyOf(civil, (n) => n === "Dump / waste"));
  leftBlank.push("Construction B16 steel mesh and B24 switchgear sign — not separate lines in the estimator (inside the site-works override).");
  if (f.pmHours > 0) put("Construction", CONSTRUCTION_CELLS.pmHours, f.pmHours);
  leftBlank.push("Construction B32/B33 drawing-set counts — the estimator prices design as fees; the D&E total travels as override row 16.");
  for (const rr of RENTAL_ROW_NAMES) {
    if (!rr.estimator) continue;
    const item = result.equipment.items.find((i) => i.name === rr.estimator);
    if (!item) continue;
    put("Construction", `${RENTAL_TABLE.qty}${rr.row}`, item.qty);
    put("Construction", `${RENTAL_TABLE.unitCost}${rr.row}`, item.rate);
    put("Construction", `${RENTAL_TABLE.days}${rr.row}`, rr.estimator === "Temporary fencing" ? item.durationValue * 7 : item.durationValue);
    put("Construction", `${RENTAL_TABLE.include}${rr.row}`, yn(item.qty > 0));
  }
  const unmappedRentals = result.equipment.items.filter((i) => i.qty > 0 && !RENTAL_ROW_NAMES.some((rr) => rr.estimator === i.name)).map((i) => i.name);
  if (unmappedRentals.length) warnings.push(`Rental(s) with no intake row: ${unmappedRentals.join(", ")} — carried inside override row 15 only.`);
  put("Construction", CONSTRUCTION_CELLS.markupMaterials, c?.markupMaterialsPct);
  const feeAmount = (row: number, amount: number) => {
    put("Construction", `${FEE_COLS.qty}${row}`, amount > 0 ? 1 : 0);
    if (amount > 0) put("Construction", `${FEE_COLS.unitCost}${row}`, Math.round(amount * 100) / 100);
    put("Construction", `${FEE_COLS.include}${row}`, yn(amount > 0));
  };
  const feeFlag = (row: number, on: boolean) => {
    put("Construction", `${FEE_COLS.qty}${row}`, on ? 1 : 0);
    put("Construction", `${FEE_COLS.include}${row}`, yn(on));
  };
  feeAmount(FEE_ROWS.permits, per.permitFeeTotal + f.planCheckPermitFee);
  feeAmount(FEE_ROWS.utilityContract, per.utilityAppFee);
  feeFlag(FEE_ROWS.interconnectDesign, (c?.utilityInterconnectFee ?? 0) > 0);
  feeFlag(FEE_ROWS.lineExtension, (c?.lineExtensionContribution ?? 0) > 0);
  leftBlank.push("Construction rows 85–88 fire review, encroachment, inspection and meter fees — not modelled.");

  // ---- Commercial -----------------------------------------------------------
  if (c) {
    put("Commercial", COMMERCIAL_CELLS.discountHardware, c.discountHardwarePct);
    put("Commercial", COMMERCIAL_CELLS.discountService, c.discountServicePct);
    put("Commercial", COMMERCIAL_CELLS.discountEvolv, c.discountEvolvPct);
    put("Commercial", COMMERCIAL_CELLS.discountInHouse, c.discountInHousePct);
    put("Commercial", COMMERCIAL_CELLS.salesTax, f.salesTaxPct);
    const terms = c.serviceTerms ?? defaultServiceTerms();
    put("Commercial", COMMERCIAL_CELLS.contractYears, terms.contractYears);
    put("Commercial", COMMERCIAL_CELLS.inWarrantyYears, terms.includedWarrantyYears);
    put("Commercial", COMMERCIAL_CELLS.evolvPerPortMonth, terms.evolvPerPortMonth);
    put("Commercial", COMMERCIAL_CELLS.financingOffered, yesNo(m.financing.offered));
    put("Commercial", COMMERCIAL_CELLS.lender, m.financing.lender);
    put("Commercial", COMMERCIAL_CELLS.annualRate, m.financing.annualRate);
    put("Commercial", COMMERCIAL_CELLS.termYears, m.financing.termYears);
    put("Commercial", COMMERCIAL_CELLS.paymentsPerYear, m.financing.paymentsPerYear);
    put("Commercial", COMMERCIAL_CELLS.downPayment, m.financing.downPayment);
    put("Commercial", COMMERCIAL_CELLS.startDate, m.financing.startDate);
    put("Commercial", COMMERCIAL_CELLS.horizonYears, m.financing.horizonYears);
    put("Commercial", COMMERCIAL_CELLS.discountRate, m.financing.discountRate);

    // ---- Revenue ------------------------------------------------------------
    put("Revenue", REVENUE_CELLS.retailPerKwh, m.revenue.retailPerKwh);
    put("Revenue", REVENUE_CELLS.cardFeePct, m.revenue.cardFeePct);
    put("Revenue", REVENUE_CELLS.idleFee, yesNo(m.revenue.idleFeeRevenue));
    put("Revenue", REVENUE_CELLS.stallOccupancy, m.revenue.stallOccupancy);
    put("Revenue", REVENUE_CELLS.chargingHoursShare, m.revenue.chargingHoursShare);
    put("Revenue", REVENUE_CELLS.derating, m.revenue.deratingFactor);
    put("Revenue", REVENUE_CELLS.taper, m.revenue.taperFactor);
    put("Revenue", REVENUE_CELLS.rampYear1, m.revenue.rampYear1);
    put("Revenue", REVENUE_CELLS.rampYear2, m.revenue.rampYear2);
    put("Revenue", REVENUE_CELLS.rampYear3, m.revenue.rampYear3);
    put("Revenue", REVENUE_CELLS.growth, m.revenue.growthAfterRamp);
    put("Revenue", REVENUE_CELLS.rateSchedule, it?.rateSchedule);
    if (m.tariff.touShares) {
      put("Revenue", REVENUE_CELLS.sharePeak, m.tariff.touShares.peak);
      put("Revenue", REVENUE_CELLS.shareOffPeak, m.tariff.touShares.offPeak);
      put("Revenue", REVENUE_CELLS.shareSuperOffPeak, m.tariff.touShares.superOffPeak);
    }
    put("Revenue", REVENUE_CELLS.benchmarkState, m.revenue.benchmarkState);
    put("Revenue", REVENUE_CELLS.subscriptionPolicy, INTAKE_TEXT.subscription[m.tariff.subscriptionPolicy]);
    put("Revenue", REVENUE_CELLS.peakToAverage, m.tariff.peakToAverageFactor);
    put("Revenue", REVENUE_CELLS.safetyMargin, m.tariff.safetyMarginPct);
    put("Revenue", REVENUE_CELLS.sizeOnFullRating, yesNo(m.tariff.sizeDemandOnFullRating));
    put("Revenue", REVENUE_CELLS.source, m.tariff.provenance.source);
    put("Revenue", REVENUE_CELLS.verified, m.tariff.provenance.verified);
    put("Revenue", REVENUE_CELLS.verifiedBy, m.tariff.provenance.verifiedBy);
    put("Revenue", REVENUE_CELLS.eligibilityThreshold, m.tariff.provenance.eligibilityThreshold);
    put("Revenue", REVENUE_CELLS.crossesThreshold, m.tariff.provenance.crossesThreshold);
    if (m.tariff.basis === "manual") {
      const r = m.tariff.manual;
      const flat = r.peakPerKwh === r.offPeakPerKwh && r.peakPerKwh === r.superOffPeakPerKwh;
      const volumetric = flat ? r.peakPerKwh : proposal?.model.tariff.blendedPerKwh ?? r.peakPerKwh;
      if (!flat) warnings.push("Manual tariff with time-of-use rates: the intake takes one volumetric $/kWh — the blended rate was written.");
      put("Revenue", REVENUE_CELLS.volumetricPerKwh, volumetric);
      put("Revenue", REVENUE_CELLS.customerPerMonth, r.customerPerMonth);
      put("Revenue", REVENUE_CELLS.demandPerKwMonth, r.demandPerKwMonth);
      if (m.tariff.subscriptionPolicy === "manual") put("Revenue", REVENUE_CELLS.billingDemandKw, m.tariff.manualSubscribedKw);
    }
    leftBlank.push("Revenue B37 service voltage level, B46 expected site factor, B55 interval data — not modelled.");

    // ---- Carbon -------------------------------------------------------------
    put("Carbon", CARBON_CELLS.qualifies, m.carbon.qualifies);
    put("Carbon", CARBON_CELLS.permitClears2022, m.carbon.permitClears2022);
    put("Carbon", CARBON_CELLS.applicationFiled, m.carbon.applicationFiled);
    put("Carbon", CARBON_CELLS.aggregator, m.carbon.aggregator);
    put("Carbon", CARBON_CELLS.aggregatorShare, m.carbon.aggregatorSharePct);
    put("Carbon", CARBON_CELLS.fciRate, m.carbon.fciRatePerKwYear);
    put("Carbon", CARBON_CELLS.creditingYears, m.carbon.creditingYears);
    put("Carbon", CARBON_CELLS.l2CreditPerKwh, m.carbon.l2CreditPerKwh);
    const l2KwhPerDay = proposal?.model.usage.l2.kwhPerDay ?? 0;
    if (l2KwhPerDay > 0) put("Carbon", CARBON_CELLS.l2KwhPerDay, Math.round(l2KwhPerDay * 10) / 10);
    put("Carbon", CARBON_CELLS.capMultiple, m.carbon.capMultiple);
    put("Carbon", CARBON_CELLS.grants, m.carbon.grantsAwarded);
    put("Carbon", CARBON_CELLS.federalItc, m.carbon.federalItc);
    put("Carbon", CARBON_CELLS.stateProgramme, m.carbon.stateProgramme);
    put("Carbon", CARBON_CELLS.stateOutcome, m.carbon.stateProgrammeOutcome);

    // ---- Deal structure -----------------------------------------------------
    put("Deal_Structure", DEAL_CELLS.name, m.deal.name);
    put("Deal_Structure", DEAL_CELLS.carbonShare, m.deal.carbonSharePct);
    put("Deal_Structure", DEAL_CELLS.revenueShare, m.deal.revenueSharePct);
    put("Deal_Structure", DEAL_CELLS.revenueShareBasis, m.deal.revenueShareBasis === "gross" ? INTAKE_TEXT.grossRevenue : INTAKE_TEXT.netChargingProfit);
    put("Deal_Structure", DEAL_CELLS.shareYears, m.deal.shareYears);
    put("Deal_Structure", DEAL_CELLS.extraDiscountHardware, m.deal.extraDiscountHardwarePct);
    put("Deal_Structure", DEAL_CELLS.extraDiscountConstruction, m.deal.extraDiscountConstructionPct);
    put("Deal_Structure", DEAL_CELLS.extraDiscountService, m.deal.extraDiscountServicePct);
    put("Deal_Structure", DEAL_CELLS.capitalContribution, m.deal.capitalContribution);
    put("Deal_Structure", DEAL_CELLS.minClientNpv, m.deal.minClientNpv);
    put("Deal_Structure", DEAL_CELLS.minReturnMultiple, m.deal.minReturnMultiple);
    put("Deal_Structure", DEAL_CELLS.maxContribution, m.deal.maxContribution);
    for (const [line, row] of Object.entries(SCOPE_ROWS) as [ScopeLine, number][]) put("Deal_Structure", `B${row}`, SCOPE_TEXT[c.scope[line] ?? "we"]);
    put("Deal_Structure", DEAL_CELLS.clientFinances, m.financing.financeBasis === "ours" ? INTAKE_TEXT.ourScopeOnly : INTAKE_TEXT.wholeProject);
  } else {
    warnings.push("No commercial section on this project — the Commercial, Revenue, Carbon and Deal_Structure tabs keep the template's defaults. Set up pricing on the Commercial tab.");
  }

  // ---- Overrides ------------------------------------------------------------
  const carry = opts.carryOverrides ?? it?.carryEstimatorOverrides ?? true;
  const overrides = estimatorOverrideRows(project, result, proposal, carry);
  for (const o of overrides) {
    put("Overrides", `${OVERRIDE_COLS.value}${o.row}`, o.value);
    put("Overrides", `${OVERRIDE_COLS.reason}${o.row}`, o.reason);
  }
  if (!carry) warnings.push("Estimator figures NOT carried into the override register — the CEO's engine will price construction from the intake's own derivation.");

  return { writes, fileVersion, overrides, leftBlank, warnings };
}

