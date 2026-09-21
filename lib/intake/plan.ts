// Plan the fill of the CEO's EVSE Project Intake 3.8.0 from a project — which
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
import { feederFloorA, feederSegmentId } from "../calc/chain";
import { designRate, designSets } from "../calc/designFees";
import { effectiveInstallMethod } from "../calc/install";
import type { EstimateResult, Project } from "../calc/types";
import { CONNECTOR_KEYS, PROJECT_TYPE_TEXT, RETAIN_ELEMENTS, capacityOf, hasExistingChargers, keepsExistingService } from "../existing";
import { feederOutOfScope } from "../interconnection";
import { defaultInterconnection } from "../interconnection";
import { defaultServiceTerms, modelInputsOf } from "../proposal/defaults";
import type { ProposalResult, ScopeLine, ScopeStatus } from "../proposal/types";
import { findSku } from "../ref/priceBook";
import {
  CARBON_CELLS,
  CHARGER_RUN_TABLE,
  INTAKE_TEMPLATE,
  COMMERCIAL_CELLS,
  CONSTRUCTION_CELLS,
  DEAL_CELLS,
  DISPENSER_RUN_TABLE,
  DISTRIBUTION_FEEDER_TABLE,
  DISTRIBUTION_TABLE,
  DESIGN_AMBIENT_DEFAULT_C,
  ELECTRICAL_CELLS,
  designAmbientOf,
  EQUIPMENT_SINGLES,
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
  OVERRIDE_COLS,
  REVISIONS_TABLE,
  PROJECT_CELLS,
  RENTAL_ROW_NAMES,
  intakeRentalRow,
  RENTAL_TABLE,
  rentalRatePerOf,
  REVENUE_CELLS,
  SCOPE_ROWS,
  SERVICE_FEEDER_ROW,
  SITE_WORKS_COLS,
  SITE_WORKS_ROWS,
  VERSION_CELLS,
  INTAKE_CHARGER_RUN_SIZES,
  INTAKE_FEEDER_SIZES,
  conductorToIntake,
  conduitToIntake,
  snapConductorToIntake,
  splitApplicationSubmitted,
} from "./cells";
import { estimatorOverrideRows, type IntakeOverrideRow } from "./handoff";
import { CLIENT_L2_PANEL_ITEM, engineDistributionSchedule, typedDistributionSchedule } from "./schedule";
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
  // Off by default: the CEO prices the job from the intake's own derivation and wants the Overrides tab left to what was typed there.
  const carry = opts.carryOverrides ?? it?.carryEstimatorOverrides ?? false;

  // ---- Version ------------------------------------------------------------
  const fileVersion = it?.fileVersion?.trim() || "Rev A";
  put("Version", VERSION_CELLS.fileVersion, fileVersion);
  put("Version", VERSION_CELLS.dateCompleted, today);
  put("Version", VERSION_CELLS.completedBy, it?.completedBy?.trim() || s.cpm);
  put("Version", VERSION_CELLS.projectReference, it?.projectReference);
  const generated = `Filled by the RFC Estimator on ${today}${s.clientName ? ` for ${s.clientName}` : ""}.${carry ? " Construction and engineering figures are the estimator's — see the Overrides tab." : ""}`;
  const revisionNotes = [it?.revisionNotes?.trim(), generated].filter(Boolean).join(" ");
  put("Version", VERSION_CELLS.revisionNotes, revisionNotes);
  // The Revisions tab: the file's own history as imported, then this issue —
  // replacing the row that already carries this revision letter, else appended.
  const history = (it?.revisions ?? []).filter((r) => r.rev.trim() || r.notes.trim());
  const thisIssue = { rev: fileVersion, date: today, by: it?.completedBy?.trim() || s.cpm, notes: revisionNotes };
  const slot = history.findIndex((r) => r.rev.trim().toLowerCase() === fileVersion.toLowerCase());
  const revisions = slot >= 0 ? history.map((r, i) => (i === slot ? thisIssue : r)) : [...history, thisIssue];
  const revisionRows = REVISIONS_TABLE.lastRow - REVISIONS_TABLE.firstRow + 1;
  revisions.slice(0, revisionRows).forEach((r, i) => {
    const row = REVISIONS_TABLE.firstRow + i;
    put("Revisions", `${REVISIONS_TABLE.rev}${row}`, r.rev);
    const serial = isoToSerial(r.date);
    if (serial !== null) put("Revisions", `${REVISIONS_TABLE.date}${row}`, serial);
    put("Revisions", `${REVISIONS_TABLE.by}${row}`, r.by);
    put("Revisions", `${REVISIONS_TABLE.notes}${row}`, r.notes);
  });
  if (revisions.length > revisionRows) warnings.push(`${revisions.length - revisionRows} revision row(s) beyond the Revisions tab's ${revisionRows} were not written.`);

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
  put("Project", PROJECT_CELLS.serviceVoltage, it?.existingServiceVoltage ?? x?.infrastructure.voltage ?? 480);
  put("Project", PROJECT_CELLS.billsObtained, it?.billsObtained);
  const proposalSerial = it?.proposalDate ? isoToSerial(it.proposalDate) : null;
  if (proposalSerial !== null) put("Project", PROJECT_CELLS.proposalDate, proposalSerial);
  put("Project", PROJECT_CELLS.validityDays, it?.validityDays ?? undefined);
  put("Project", PROJECT_CELLS.preparedBy, s.cpm);
  put("Project", PROJECT_CELLS.accountOwner, s.cra);
  put("Project", PROJECT_CELLS.cca, it?.cca);

  // ---- Existing -----------------------------------------------------------
  put("Existing", EXISTING_CELLS.projectType, PROJECT_TYPE_TEXT[x?.projectType ?? "greenfield"]);
  // An add-load site keeps a service but has no chargers: the register's
  // service, feeder and switchgear rows, section D and section I travel; the
  // charger sections (units, history, connectors, uplifts, removal) stand
  // down on the sheet and are left blank.
  if (x && keepsExistingService(x.projectType)) {
    const chargers = hasExistingChargers(x.projectType);
    put("Existing", EXISTING_CELLS.ageYears, x.ageYears ?? undefined);
    put("Existing", EXISTING_CELLS.reason, x.reason);
    put("Existing", EXISTING_CELLS.owner, x.owner);
    RETAIN_ELEMENTS.forEach((e, i) => put("Existing", `B${EXISTING_CELLS.registerFirstRow + i}`, x.register[e.key] || undefined));
    const unitRows = EXISTING_UNITS_TABLE.lastRow - EXISTING_UNITS_TABLE.firstRow + 1;
    (chargers ? x.units : []).slice(0, unitRows).forEach((u, i) => {
      const r = EXISTING_UNITS_TABLE.firstRow + i;
      put("Existing", `${EXISTING_UNITS_TABLE.makeModel}${r}`, u.makeModel);
      put("Existing", `${EXISTING_UNITS_TABLE.kw}${r}`, u.kw ?? undefined);
      put("Existing", `${EXISTING_UNITS_TABLE.ports}${r}`, u.ports ?? undefined);
      put("Existing", `${EXISTING_UNITS_TABLE.connectors}${r}`, u.connectors);
      put("Existing", `${EXISTING_UNITS_TABLE.qty}${r}`, u.qty ?? undefined);
      put("Existing", `${EXISTING_UNITS_TABLE.yearInstalled}${r}`, u.yearInstalled);
      put("Existing", `${EXISTING_UNITS_TABLE.working}${r}`, u.working);
    });
    if (chargers && x.units.length > unitRows) warnings.push(`${x.units.length - unitRows} existing unit row(s) beyond the intake's ${unitRows} were not written.`);
    const inf = x.infrastructure;
    put("Existing", EXISTING_CELLS.serviceA, inf.serviceA ?? undefined);
    put("Existing", EXISTING_CELLS.spareA, inf.spareA ?? undefined);
    put("Existing", EXISTING_CELLS.frameA, inf.frameA ?? undefined);
    put("Existing", EXISTING_CELLS.branchConductor, inf.branchConductor);
    put("Existing", EXISTING_CELLS.avgRunFt, inf.avgRunFt ?? undefined);
    put("Existing", EXISTING_CELLS.conduit, inf.conduit);
    put("Existing", EXISTING_CELLS.rateSchedule, inf.rateSchedule);
    put("Existing", EXISTING_CELLS.separatelyMetered, inf.separatelyMetered);
    const cap = capacityOf(x);
    put("Existing", EXISTING_CELLS.peakDemandKw, cap.peakDemandKw ?? undefined);
    put("Existing", EXISTING_CELLS.gearSpaceForFeeder, cap.gearSpaceForFeeder);
    put("Existing", EXISTING_CELLS.utilityNotified, cap.utilityNotified);
    if (cap.peakDemandKw === null && inf.spareA === null) leftBlank.push("Existing B192 peak demand / B52 spare capacity — the capacity verdict falls back to the bare service size until one of them is entered.");
    const monthRows = EXISTING_HISTORY_TABLE.lastRow - EXISTING_HISTORY_TABLE.firstRow + 1;
    const history = (chargers ? x.history : []).slice(0, monthRows);
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
    if (chargers && x.history.length > monthRows) warnings.push(`${x.history.length - monthRows} history month(s) beyond the intake's ${monthRows} were not written.`);
    if (chargers) {
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
    }
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
    put("Revenue", REVENUE_CELLS.revenueBasis, chargers && x.revenueBasis === "historical" ? INTAKE_TEXT.revenueBasis.historical : INTAKE_TEXT.revenueBasis.market);
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
  // New at template 3.2.0: the voltage the Level 2 units are actually fed at.
  // The sheet derates 240 V-rated units to it in the AC-input column and flags
  // ENTER IT when the service is below 240 V and this is blank. The estimator
  // models every L2 load type at 208 V, so it can answer rather than be asked.
  const firstL2 = result.rows.find((r) => r.category === "L2" && !r.synthetic);
  if (firstL2) put("Equipment", EQUIPMENT_SINGLES.l2SupplyVoltage, firstL2.volts);

  // ---- Electrical -----------------------------------------------------------
  // Block A — the sizing basis.
  const method = effectiveInstallMethod(s);
  put("Electrical", ELECTRICAL_CELLS.material, s.feederMaterial);
  put("Electrical", ELECTRICAL_CELLS.conduit, s.conduitType === "EMT" ? "EMT" : "PVC");
  if (method === "hybrid") warnings.push("Hybrid install: the intake carries one conduit type — EMT written; the trenched service section is not distinguishable on the intake.");
  put("Electrical", ELECTRICAL_CELLS.allowableVdFraction, s.maxVoltageDropFraction);
  // The sheet does nothing without a design ambient (every charger-run verdict
  // waits for B10 and the wire line prices at $0), so one is always written:
  // the site figure typed on 3 · Electrical, else the NEC 310.16 table ambient
  // the estimator itself sizes on — flagged so the site figure gets typed.
  const ambient = designAmbientOf(it);
  const ambientC = ambient.value;
  put("Electrical", ELECTRICAL_CELLS.ambientC, ambientC);
  if (!ambient.typed)
    warnings.push(
      `Electrical B10 design ambient written as ${DESIGN_AMBIENT_DEFAULT_C} °C — the NEC 310.16 table ambient, the estimator's own sizing basis, not a site figure. Type the site's ASHRAE 2% design dry-bulb (or the duct-bank temperature for buried runs) on 3 · Electrical if it is hotter; the sheet will then size some runs up.`,
    );
  if (it?.trenchSurface?.trim()) put("Electrical", ELECTRICAL_CELLS.trenchSurface, it.trenchSurface.trim());
  if (it?.trenchDepthIn !== undefined && it?.trenchDepthIn !== null) put("Electrical", ELECTRICAL_CELLS.trenchDepthIn, it.trenchDepthIn);
  if (!it?.trenchSurface?.trim() || it?.trenchDepthIn === undefined || it?.trenchDepthIn === null) leftBlank.push("Electrical B8 trench surface, B9 trench depth — site facts the estimator does not model; the template's Mixed / 24 in stand unless an imported intake carried them.");

  // Block B — the charger-run table. The sheet lists every unit that takes a
  // feeder or a branch itself, line by line in Equipment order; the estimator
  // writes each unit's distance and its own sizing (conductor and conduit as
  // overrides, circuits per unit as sets) on the unit's row. Unit k of the
  // schedule is row firstRow + k − 1, so the rows are located the way the
  // sheet locates them: by cumulative unit count over the lines that carry a
  // priced SKU. A line with no SKU has no role on the sheet and no rows here.
  const unitsBefore = new Map<number, number>();
  const lineCount = new Map<number, number>();
  let cumulativeUnits = 0;
  for (const l of chargerLines) {
    const lr = lineRows.find((r) => r.loadTypeId === l.loadTypeId);
    if (!lr) continue;
    const role = l.sku ? findSku(l.sku)?.role : undefined;
    if (role !== "all_in_one" && role !== "power_cabinet" && role !== "level_2") continue;
    unitsBefore.set(lr.rowNo, cumulativeUnits);
    lineCount.set(lr.rowNo, l.count);
    cumulativeUnits += l.count;
  }
  const chargerRows = CHARGER_RUN_TABLE.lastRow - CHARGER_RUN_TABLE.firstRow + 1;
  if (cumulativeUnits > chargerRows) warnings.push(`${cumulativeUnits} charger units against the intake's ${chargerRows} charger-run rows — the runs beyond row ${CHARGER_RUN_TABLE.lastRow} were not written.`);
  const unitsWritten = new Map<number, number>();
  const unplacedLines = new Set<string>();
  const snappedSizes = new Map<string, number>();
  let runFt = 0;
  for (const r of result.rows) {
    if (r.synthetic) continue;
    const rowNo = lineRows.find((x) => x.loadTypeId === r.loadTypeId)?.rowNo;
    const before = rowNo !== undefined ? unitsBefore.get(rowNo) : undefined;
    if (rowNo === undefined || before === undefined) {
      unplacedLines.add(r.loadTypeId);
      continue;
    }
    for (let u = 0; u < Math.max(1, r.units); u++) {
      const k = unitsWritten.get(rowNo) ?? 0;
      unitsWritten.set(rowNo, k + 1);
      if (k >= (lineCount.get(rowNo) ?? 0)) continue; // more estimator rows than units on the line — the sheet has no row for them
      const row = CHARGER_RUN_TABLE.firstRow + before + k;
      if (row > CHARGER_RUN_TABLE.lastRow) continue;
      put("Electrical", `${CHARGER_RUN_TABLE.distanceFt}${row}`, r.oneWayDistFt);
      if (it?.sharedTrenchRuns) put("Electrical", `${CHARGER_RUN_TABLE.sharesTrench}${row}`, INTAKE_TEXT.yes);
      put("Electrical", `${CHARGER_RUN_TABLE.sets}${row}`, Math.max(1, r.resolvedRunsPerUnit));
      // The estimator's size, or the next one up when the sheet's table does not
      // carry it (3 AWG, 450 kcmil…); a snapped conductor takes the sheet's own
      // conduit rather than the estimator's, which was sized for the smaller wire.
      const conductor = snapConductorToIntake(r.selectedWire);
      put("Electrical", `${CHARGER_RUN_TABLE.conductorOverride}${row}`, conductor.size);
      if (conductor.snapped) snappedSizes.set(`${conductorToIntake(r.selectedWire)} → ${conductor.size}`, (snappedSizes.get(`${conductorToIntake(r.selectedWire)} → ${conductor.size}`) ?? 0) + 1);
      // A conductor someone typed on the row (an imported intake's, or a Takeoff override) goes with the sheet's own conduit for it; the estimator's conduit travels only with the estimator's conductor.
      else if (!r.sizeOverride) put("Electrical", `${CHARGER_RUN_TABLE.conduitOverride}${row}`, conduitToIntake(r.conduitSize));
      runFt += r.oneWayDistFt;
    }
  }
  if (snappedSizes.size) {
    warnings.push(
      `Conductor sizes the intake's sizing table does not carry were rounded up on the charger runs: ${[...snappedSizes].map(([k, n]) => `${k} (${n} run${n === 1 ? "" : "s"})`).join(", ")} — the sheet sizes the conduit for the larger wire itself, so those rows price a little above the estimator.`,
    );
  }
  for (const id of unplacedLines) warnings.push(`${id}: no price-book SKU on its Equipment line, so the intake lists no charger run for it — its distances were not written. Pick a SKU on the Equipment tab.`);
  for (const [rowNo, count] of lineCount) {
    const written = unitsWritten.get(rowNo) ?? 0;
    if (written < count) warnings.push(`Equipment line ${rowNo - EQUIPMENT_TABLE.firstRow + 1}: ${count} unit(s) on the schedule but the estimate sizes ${written} — ${count - written} charger-run row(s) left without a distance.`);
  }
  if (!it?.sharedTrenchRuns && runFt > 0 && s.trenchLengthFt > 0 && s.trenchLengthFt < runFt) {
    leftBlank.push(`Electrical ${CHARGER_RUN_TABLE.sharesTrench}${CHARGER_RUN_TABLE.firstRow}–${CHARGER_RUN_TABLE.sharesTrench}${CHARGER_RUN_TABLE.lastRow} shared-trench flags — the estimator digs ${Math.round(s.trenchLengthFt)} ft of trench for ${Math.round(runFt)} ft of charger runs; mark the runs that share another run's trench so the sheet's trench figure agrees.`);
  }
  if (totalCabinets > 0) leftBlank.push(`Electrical rows ${DISPENSER_RUN_TABLE.firstRow}–${DISPENSER_RUN_TABLE.lastRow} cabinet-to-dispenser DC runs — the estimator sizes the cabinets' AC feeders only.`);

  if (per.l2ClientPowered && result.rows.some((r) => !r.synthetic && r.category === "L2"))
    warnings.push(
      `Level 2 client powered: the units are fed from the client's existing 208 V panel, so no step-down transformer or sub-panel is priced (their pad and bollards drop out; the Level 2 branch breakers and circuits stay). The intake ${INTAKE_TEMPLATE.version} has no cell for this — it travels as the "${CLIENT_L2_PANEL_ITEM}" row on the distribution schedule (by others) and in the scope sentence.`,
    );
  // Block D — service and switchgear.
  put("Electrical", ELECTRICAL_CELLS.pointOfConnection, ic.pointOfConnection);
  put("Electrical", ELECTRICAL_CELLS.txToSwitchgearFt, s.serviceChain?.utilityToSwitchgearFt);
  put("Electrical", ELECTRICAL_CELLS.spareCapacityA, x?.infrastructure.spareA ?? undefined);
  const frame = result.panel.bus480 ?? result.panel.bus208;
  // A retained board is not a priced one: the sheet's B112 is "size being priced", and 0 keeps RefData from pricing a switchboard the site already has.
  put("Electrical", ELECTRICAL_CELLS.switchgearPricedA, per.existingSwitchgear ? 0 : frame?.suggestedBusA);
  if (it?.switchgearToPoleFt !== undefined && it?.switchgearToPoleFt !== null) put("Electrical", ELECTRICAL_CELLS.switchgearToPoleFt, it.switchgearToPoleFt);
  leftBlank.push("Electrical B120 distance to the pole (unless an imported intake carried it), B110 board count and B114–B115 load management — the estimator sizes one board at full nameplate; the template's 1 / No stand.");
  leftBlank.push("Electrical B117 demand-limiting setpoint — the billing setpoint the EMS holds the peak fifteen-minute draw to. Nothing is sized on it and the estimator does not model it; blank leaves the template falling back to the sizing cap above.");
  put("Electrical", ELECTRICAL_CELLS.feederBy, ic.serviceFeederBy);
  const svc = feederOutOfScope(ic.serviceFeederBy) ? undefined : result.rows.find((r) => r.synthetic && r.loadTypeId.startsWith("SVC Utility"));
  if (!feederOutOfScope(ic.serviceFeederBy)) put("Electrical", `${SERVICE_FEEDER_ROW.material}${SERVICE_FEEDER_ROW.row}`, s.serviceChain?.material ?? svc?.material);
  if (svc) {
    put("Electrical", `${SERVICE_FEEDER_ROW.conductor}${SERVICE_FEEDER_ROW.row}`, snapConductorToIntake(svc.selectedWire, INTAKE_FEEDER_SIZES).size);
    put("Electrical", `${SERVICE_FEEDER_ROW.sets}${SERVICE_FEEDER_ROW.row}`, svc.resolvedRunsPerUnit);
    // The feeder's own verdict asks for B126 whenever we provide the run; the site ambient stands for it unless a duct-bank figure is typed later.
    put("Electrical", ELECTRICAL_CELLS.feederAmbientC, ambientC);
  }

  // Block F — the Rule 29 block.
  put("Electrical", ELECTRICAL_CELLS.serviceType, ic.serviceType);
  put("Electrical", ELECTRICAL_CELLS.serviceRoute, ic.serviceRoute);
  put("Electrical", ELECTRICAL_CELLS.distanceToPoiFt, ic.distanceToPoiFt ?? undefined);
  const application = splitApplicationSubmitted(ic.applicationSubmitted);
  put("Electrical", ELECTRICAL_CELLS.applicationSubmitted, application.status);
  put("Electrical", ELECTRICAL_CELLS.applicationDate, application.date);
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

  // Block E — distribution equipment, documented and priced through the
  // override register (never twice). A typed schedule (an imported
  // workbook's, or the 3 · Electrical editor's) travels exactly as typed;
  // otherwise the engine's own rows (lib/intake/schedule.ts).
  const typedSchedule = typedDistributionSchedule(it);
  const scheduleRows = typedSchedule.length ? typedSchedule : engineDistributionSchedule(project, result);
  const scheduleCapacity = DISTRIBUTION_TABLE.lastRow - DISTRIBUTION_TABLE.firstRow + 1;
  let dRow = DISTRIBUTION_TABLE.firstRow;
  for (const r of scheduleRows.slice(0, scheduleCapacity)) {
    put("Electrical", `${DISTRIBUTION_TABLE.item}${dRow}`, r.item);
    put("Electrical", `${DISTRIBUTION_TABLE.type}${dRow}`, r.type);
    put("Electrical", `${DISTRIBUTION_TABLE.qty}${dRow}`, r.qty ?? undefined);
    put("Electrical", `${DISTRIBUTION_TABLE.volts}${dRow}`, r.volts ?? undefined);
    put("Electrical", `${DISTRIBUTION_TABLE.phases}${dRow}`, r.phases ?? undefined);
    put("Electrical", `${DISTRIBUTION_TABLE.ratingA}${dRow}`, r.ratingA ?? undefined);
    put("Electrical", `${DISTRIBUTION_TABLE.fedFrom}${dRow}`, r.fedFrom);
    put("Electrical", `${DISTRIBUTION_TABLE.feeds}${dRow}`, r.feeds);
    put("Electrical", `${DISTRIBUTION_TABLE.location}${dRow}`, r.location);
    put("Electrical", `${DISTRIBUTION_TABLE.whoProvides}${dRow}`, r.whoProvides);
    put("Electrical", `${DISTRIBUTION_TABLE.costBasis}${dRow}`, r.costBasis);
    put("Electrical", `${DISTRIBUTION_TABLE.quotedCost}${dRow}`, r.quotedCost ?? undefined);
    dRow++;
  }
  if (scheduleRows.length > scheduleCapacity) warnings.push(`${scheduleRows.length - scheduleCapacity} distribution schedule row(s) beyond the intake's table were not written.`);
  const rowByType = (re: RegExp) => scheduleRows.find((r) => re.test(r.type.trim()) || re.test(r.item.trim()));
  const boardRow = rowByType(/^switchboard$/i) ?? rowByType(/switchgear|switchboard|main board|msb/i);
  const mainName = boardRow?.item ?? (ic.pointOfConnection || "Service equipment");

  // Block I (3.7.0) — the feeders between the items on the schedule. The
  // sheet prices this block into the Pricing tab's wire line, so the
  // estimator's feeder segments must land here for the two to agree. Typed
  // feeders (imported block I, or the app's own table) travel as typed; else
  // the chain's switchgear → transformer → sub-panel pair is written against
  // the names block E just used, with the estimator's sizing current as the
  // floor (a transformer's schedule rating is kVA, which the sheet cannot
  // size on) and its conductor as the override — the same conductor at the
  // same floor prices the same on both sides.
  const cf = s.continuousLoadFactor;
  const F = DISTRIBUTION_FEEDER_TABLE;
  let fRow = F.firstRow;
  const feederRow = (from: string, to: string, distanceFt: number, floorA: number | undefined, sets: number | undefined, conductor: string | undefined, conduit: string | undefined) => {
    if (fRow > F.lastRow) return;
    put("Electrical", `${F.from}${fRow}`, from);
    put("Electrical", `${F.to}${fRow}`, to);
    put("Electrical", `${F.floorA}${fRow}`, floorA && floorA > 0 ? floorA : undefined);
    put("Electrical", `${F.distanceFt}${fRow}`, distanceFt > 0 ? distanceFt : undefined);
    put("Electrical", `${F.sets}${fRow}`, sets && sets > 0 ? sets : undefined);
    put("Electrical", `${F.conductorOverride}${fRow}`, conductor);
    put("Electrical", `${F.conduitOverride}${fRow}`, conduit);
    fRow++;
  };
  const typedFeeders = (s.serviceChain?.feeders ?? []).filter((x) => x.to.trim() || x.from.trim() || x.distanceFt > 0);
  const feederSeg = (loadTypeId: string) => result.rows.find((r) => r.synthetic && r.loadTypeId.startsWith("FDR") && r.loadTypeId === loadTypeId);
  const feederSegs = result.rows.filter((r) => r.synthetic && r.loadTypeId.startsWith("FDR"));
  // The sheet has ONE conductor material (B6) and reads every size in block I
  // as that material. An estimator conductor sized in the other material would
  // be misread — its ampacity and price both wrong on the sheet — so it is
  // written only when the two agree; otherwise the sheet sizes its own at the
  // floor and the report says why the two sides price differently.
  const feederMaterialsAgree = !s.serviceChain || s.serviceChain.material === s.feederMaterial;
  if (feederSegs.length && !feederMaterialsAgree) {
    warnings.push(`Block I prices its feeders in the site material (Electrical B6 = ${s.feederMaterial}); the estimator's feeder segments are ${s.serviceChain!.material}, so their conductors were not written as overrides and the sheet sizes its own. Set the service-chain material to ${s.feederMaterial} for the two to price alike.`);
  }
  const engineConductor = (seg: { selectedWire: string } | undefined) => (seg && feederMaterialsAgree ? snapConductorToIntake(seg.selectedWire, INTAKE_CHARGER_RUN_SIZES).size : undefined);
  if (typedFeeders.length) {
    typedFeeders.forEach((x, i) => {
      const seg = feederSeg(feederSegmentId(i, x));
      const conductor = x.conductorOverride ? snapConductorToIntake(x.conductorOverride).size : engineConductor(seg);
      feederRow(x.from, x.to, x.distanceFt, x.floorA, x.sets ?? seg?.resolvedRunsPerUnit, conductor, x.conduitOverride);
      if (feederFloorA(x) <= 0) warnings.push(`Distribution feeder ${i + 1} (${x.from || "?"} → ${x.to || "?"}): no floor — the item fed is not on the schedule with a rating and no floor was typed, so neither the estimator nor the sheet can size it (Electrical G${F.firstRow + i}).`);
      else if (!(x.distanceFt > 0)) warnings.push(`Distribution feeder ${i + 1} (${x.from || "?"} → ${x.to || "?"}): no distance — not priced (Electrical H${F.firstRow + i}).`);
    });
    if (typedFeeders.length > F.lastRow - F.firstRow + 1) warnings.push(`${typedFeeders.length - (F.lastRow - F.firstRow + 1)} distribution feeder(s) beyond the intake's table were not written.`);
  } else {
    const txSeg = feederSeg("FDR Switchgear→TX");
    const spSeg = feederSeg("FDR TX→Sub-panel");
    // TO must be an item on block E as written — the engine's rows, or on an
    // imported / typed schedule the engineer's own transformer and panel rows
    // (the sheet resolves volts, phases and rating from them) — and the pair
    // runs from the item the schedule says feeds the transformer.
    const txRow = rowByType(/^transformer$/i) ?? rowByType(/transformer|step.?down/i);
    const spRow = rowByType(/^(subpanel|sub-panel|panelboard|panel)$/i) ?? rowByType(/sub.?panel|panelboard/i);
    const txTo = txRow?.item;
    const spTo = spRow?.item;
    const txFrom = txRow ? (scheduleRows.find((r) => r.item.trim() && r.item.trim() === txRow.fedFrom.trim())?.item ?? mainName) : mainName;
    if (txSeg && txTo) feederRow(txFrom, txTo, txSeg.oneWayDistFt, Math.ceil(txSeg.designAmps * cf), txSeg.resolvedRunsPerUnit, engineConductor(txSeg), undefined);
    if (spSeg && txTo && spTo) feederRow(txTo, spTo, spSeg.oneWayDistFt, Math.ceil(spSeg.designAmps * cf), spSeg.resolvedRunsPerUnit, engineConductor(spSeg), undefined);
    if (typedSchedule.length && (txSeg || spSeg) && (!txRow || !spRow)) warnings.push(`Block I: the typed schedule has no ${!txRow ? "transformer" : "sub-panel"} row, so the estimator's ${!txRow ? "switchgear → transformer" : "transformer → sub-panel"} feeder could not be written against a schedule item and was left out; add the row to the schedule or type the feeder on 3 · Electrical.`);
    if (!txSeg && !spSeg && typedSchedule.length) leftBlank.push(`Electrical block I distribution feeders (rows ${F.firstRow}–${F.lastRow}) — the imported schedule has items but no feeder rows were typed and the estimator has no step-down transformer to derive them from; every panel, transformer and remote disconnect needs one.`);
  }

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
  siteQty(SITE_WORKS_ROWS.striping, qtyOf(signage, (n) => n === "Striping"));
  const adaPerType = qtyOf(civil, (n) => /^ADA (van|standard|ambulatory)/.test(n));
  siteQty(SITE_WORKS_ROWS.adaStalls, adaPerType > 0 ? adaPerType : qtyOf(civil, (n) => n === "ADA asphalt / paving allowance"));
  siteQty(SITE_WORKS_ROWS.adaRamp, qtyOf(civil, (n) => n === "ADA ramp"));
  siteQty(SITE_WORKS_ROWS.bollards, qtyOf(signage, (n) => n === "Bollards"));
  siteQty(SITE_WORKS_ROWS.signs, qtyOf(signage, (n) => n === "Signs"));
  siteQty(SITE_WORKS_ROWS.signPosts, qtyOf(signage, (n) => n === "Sign posts"));
  const gprItem = (per.customItems ?? []).find((i) => i.name === GPR_ITEM_NAME);
  siteQty(SITE_WORKS_ROWS.gpr, gprItem?.qty ?? 0);
  if (gprItem && gprItem.qty > 0 && gprItem.unitCost > 0) put("Construction", `D${SITE_WORKS_ROWS.gpr}`, gprItem.unitCost);
  siteQty(SITE_WORKS_ROWS.gfi, qtyOf(civil, (n) => n.startsWith("GFI test")));
  siteQty(SITE_WORKS_ROWS.dump, qtyOf(civil, (n) => n === "Dump / waste"));
  // Steel mesh is inside the estimator's concrete line — a blank quantity would let the sheet add its standard build on top.
  siteQty(SITE_WORKS_ROWS.steelMesh, 0);
  if (it?.switchgearSignQty !== undefined && it?.switchgearSignQty !== null) siteQty(SITE_WORKS_ROWS.switchgearSign, it.switchgearSignQty);
  else leftBlank.push("Construction B24 switchgear sign — not a separate line in the estimator (inside the site-works override) unless an imported intake carried a count.");
  // Design and engineering, as the sheet prices it: quantity × rate on each
  // of the three rows, so B35 reproduces the estimator's design total. A
  // typed set count travels as typed; a market-rate fee travels as the sets
  // it buys at the rate (fractional when it is not a whole number of sets).
  const designRow = (setsCell: string, rateCell: string, sets: number, rate: number) => {
    put("Construction", setsCell, sets > 0 ? sets : undefined);
    put("Construction", rateCell, rate);
  };
  designRow(CONSTRUCTION_CELLS.autoCadSets, CONSTRUCTION_CELLS.autoCadRate, designSets(f, "autoCad"), designRate(f, "autoCad"));
  designRow(CONSTRUCTION_CELLS.eeSets, CONSTRUCTION_CELLS.eeRate, designSets(f, "ee"), designRate(f, "ee"));
  designRow(CONSTRUCTION_CELLS.pmHours, CONSTRUCTION_CELLS.pmRate, f.pmHours, f.pmHourlyRate);
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const rentalRowOf = (i: { name: string }) => intakeRentalRow(i.name);
  for (const rr of RENTAL_ROW_NAMES) {
    const item = result.equipment.items.find((i) => rentalRowOf(i)?.row === rr.row);
    if (!item) continue;
    put("Construction", `${RENTAL_TABLE.qty}${rr.row}`, item.qty);
    // Since 3.8.0 a row carries the unit its rate is per (F: day / week / month)
    // with the duration in that unit, so the estimator's rate and duration
    // travel as they are — fencing per ft per week stays weekly, a monthly
    // container stays monthly. The sheet prices qty × rate × duration either way.
    put("Construction", `${RENTAL_TABLE.unitCost}${rr.row}`, round4(item.rate));
    put("Construction", `${RENTAL_TABLE.duration}${rr.row}`, round4(item.durationValue));
    put("Construction", `${RENTAL_TABLE.ratePer}${rr.row}`, rentalRatePerOf(item.rateBasis));
    put("Construction", `${RENTAL_TABLE.include}${rr.row}`, yn(item.qty > 0 && !item.excluded));
  }
  const unmappedRentals = result.equipment.items.filter((i) => i.qty > 0 && !i.excluded && !rentalRowOf(i)).map((i) => i.name);
  if (unmappedRentals.length)
    warnings.push(
      `Rental line(s) NOT on the intake: ${unmappedRentals.join(", ")} — the intake's rental table has 14 fixed rows (${RENTAL_ROW_NAMES.map((rr) => rr.estimator ?? rr.label).join(", ")}) and no free one. Rename the line to one of those on the Peripherals tab to carry it${carry ? "; its money still travels inside override row 15" : ""}.`,
    );
  // Two lines on one row (a custom line named like a standard one): the sheet gets the first; say so.
  for (const rr of RENTAL_ROW_NAMES) {
    const onRow = result.equipment.items.filter((i) => i.qty > 0 && !i.excluded && rentalRowOf(i)?.row === rr.row);
    if (onRow.length > 1) warnings.push(`${onRow.length} rental lines map to intake row ${rr.row} (${rr.label}): only "${onRow[0].name}" was written — merge them on the Peripherals tab.`);
  }
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
    leftBlank.push("Revenue B56 annual tariff escalation — the CEO's model reads it; the estimator has no escalation, so the template's 0 stands and holds every tariff flat for the horizon.");

    // ---- Carbon -------------------------------------------------------------
    put("Carbon", CARBON_CELLS.qualifies, m.carbon.qualifies);
    put("Carbon", CARBON_CELLS.permitClears2022, m.carbon.permitClears2022);
    put("Carbon", CARBON_CELLS.applicationFiled, m.carbon.applicationFiled);
    put("Carbon", CARBON_CELLS.aggregator, m.carbon.aggregator);
    put("Carbon", CARBON_CELLS.aggregatorShare, m.carbon.aggregatorSharePct);
    put("Carbon", CARBON_CELLS.fciRate, m.carbon.fciRatePerKwYear);
    put("Carbon", CARBON_CELLS.creditingYears, m.carbon.creditingYears);
    put("Carbon", CARBON_CELLS.l2CreditPerKwh, m.carbon.l2CreditPerKwh);
    // Carbon B18 "Site-total L2 kWh per day" was an input through 3.1.0 and is
    // derived at 3.2.0 — the sheet computes it from the Revenue tab's new
    // Level 2 stream. Writing it now would be refused, and rightly: the
    // workbook's own figure is the one its credit rows are built on.
    const l2KwhPerDay = proposal?.model.usage.l2.kwhPerDay ?? 0;
    if (l2KwhPerDay > 0) {
      leftBlank.push(
        `Carbon B18 site-total Level 2 kWh per day — the template derives this from its own Level 2 stream at 3.2.0. The estimator's figure (${Math.round(l2KwhPerDay * 10) / 10} kWh/day) is not written; compare the two if the credit looks wrong.`,
      );
    }
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
  const overrides = estimatorOverrideRows(project, result, proposal, carry);
  for (const o of overrides) {
    put("Overrides", `${OVERRIDE_COLS.value}${o.row}`, o.value);
    put("Overrides", `${OVERRIDE_COLS.reason}${o.row}`, o.reason);
  }
  if (!carry) leftBlank.push("Estimator figures NOT carried into the override register — the CEO's engine will price construction from the intake's own derivation.");

  return { writes, fileVersion, overrides, leftBlank, warnings };
}

