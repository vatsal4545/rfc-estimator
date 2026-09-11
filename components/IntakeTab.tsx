"use client";

import { useRef, useState } from "react";
import { defaultProject } from "@/lib/calc/defaults";
import { money } from "@/lib/format";
import type { Project } from "@/lib/calc/types";
import type { IntakeImportReport } from "@/lib/intake/importIntake";
import { canRebuild, rebuildProject } from "@/lib/intake/rebuild";
import { computeInterconnection, defaultInterconnection, type InterconnectionInput } from "@/lib/interconnection";
import { defaultCommercial, defaultIntake } from "@/lib/proposal/defaults";
import type { IntakeInput } from "@/lib/proposal/types";
import { RATE_LIBRARY } from "@/lib/ref/rateLibrary";
import { RATE_SCHEDULE_PICKER, UTILITIES } from "@/lib/ref/utilities";
import { useProject } from "./ProjectContext";
import { Field, Grid, Pill, Section, inputCls, selectCls, tableWrapCls, theadCls } from "./ui";

// Intake — the CEO intake's Project tab: who the client is, what the site is,
// which utility serves it and on which tariff, and the proposal's metadata —
// plus the import of a completed intake workbook and the utility
// interconnection (Rule 29) block. Client, address, utility, CPM and CRA live
// on Setup (they always did); this tab edits them in place and keeps the rest
// in project.intake.

const PROPERTY_TYPES = ["Hotel / hospitality", "Retail / shopping centre", "Office / commercial", "Multifamily", "Fleet depot", "Municipal / public", "Fuel station / travel centre", "Other"];
const STATES = ["California", "Michigan", "Other"];
const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500";
const td = "px-3 py-1.5 text-sm";
const noteCls = "text-xs text-zinc-500";

function Pick({ value, onChange, options = ["", "Yes", "No"] }: { value: string; onChange: (v: string) => void; options?: string[] }) {
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o || "—"}
        </option>
      ))}
    </select>
  );
}

/** Shared state for the intake sections: the project's intake record, setup, and the pickers' option lists. */
export function useIntakeEditing() {
  const { project, setProject, result, proposal, hardwareAllowance } = useProject();
  const it = project.intake ?? defaultIntake();
  const setup = project.setup;

  function update<K extends keyof IntakeInput>(key: K, value: IntakeInput[K]) {
    setProject((p) => ({ ...p, intake: { ...(p.intake ?? defaultIntake()), [key]: value } }));
  }
  function setSetup<K extends keyof typeof setup>(key: K, value: (typeof setup)[K]) {
    setProject((p) => {
      const next = { ...p, setup: { ...p.setup, [key]: value } };
      // The delivery utility decides which substructures we furnish (pad, well, pull boxes) — re-derive them.
      return key === "utility" && canRebuild(next) ? rebuildProject(next, hardwareAllowance) : next;
    });
  }
  /** Client and address also live on the Quick Estimate intake — keep both in step. */
  function setIdentity(patch: { clientName?: string; siteAddress?: string }) {
    setProject((p) => ({
      ...p,
      setup: { ...p.setup, ...patch },
      quick: p.quick ? { ...p.quick, ...patch } : p.quick,
    }));
  }
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  const utilitiesForState = UTILITIES.filter((u) => it.state === "Other" || u.state === it.state);
  const utilityKnown = UTILITIES.some((u) => u.utility === setup.utility);
  const schedulesForUtility = RATE_LIBRARY.filter((r) => r.utility === setup.utility);
  const scheduleOptions = schedulesForUtility.length > 0 ? schedulesForUtility.map((r) => r.schedule) : RATE_SCHEDULE_PICKER;
  const chosenSchedule = RATE_LIBRARY.find((r) => r.schedule === it.rateSchedule && (schedulesForUtility.length === 0 || r.utility === setup.utility));
  const utilityRow = UTILITIES.find((u) => u.utility === setup.utility);
  const propertyTypes = it.propertyType && !PROPERTY_TYPES.includes(it.propertyType) ? [it.propertyType, ...PROPERTY_TYPES] : PROPERTY_TYPES;

  const ic = { ...defaultInterconnection(), ...it.interconnection };
  const icResult = computeInterconnection(project, result, proposal?.costBuildup);
  function setIc<K extends keyof InterconnectionInput>(key: K, value: InterconnectionInput[K]) {
    setProject((p) => {
      const cur: InterconnectionInput = { ...defaultInterconnection(), ...p.intake?.interconnection, [key]: value };
      let next: Project = { ...p, intake: { ...(p.intake ?? defaultIntake()), interconnection: cur } };
      // Who builds the transformer-to-switchgear run decides whether that
      // conductor is in our scope: the utility's EV rule → 0 ft of ours.
      if (key === "serviceFeederBy") {
        const chain = p.setup.serviceChain ?? { enabled: true, material: "Al" as const, utilityToSwitchgearFt: 25, switchgearToTransformerFt: 15, transformerToSubpanelFt: 15 };
        const byUtility = String(value).startsWith("Utility");
        const ft = byUtility ? 0 : chain.utilityToSwitchgearFt > 0 ? chain.utilityToSwitchgearFt : 25;
        next = { ...next, setup: { ...next.setup, serviceChain: { ...chain, utilityToSwitchgearFt: ft } } };
        if (canRebuild(next)) next = rebuildProject(next, hardwareAllowance);
      }
      return next;
    });
  }

  return { project, setProject, result, proposal, it, setup, update, setSetup, setIdentity, numOrNull, utilitiesForState, utilityKnown, schedulesForUtility, scheduleOptions, chosenSchedule, utilityRow, propertyTypes, ic, icResult, setIc };
}

/** Import a completed intake workbook as a new library project, with the mapped / skipped / look-at report. */
export function IntakeImportPanel() {
  const { importProject, hardwareAllowance } = useProject();
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<IntakeImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function importFile(file: File) {
    setImporting(true);
    setImportError(null);
    try {
      // jszip and the mapping load only when someone actually imports.
      const { importIntakeFile } = await import("@/lib/intake/importIntake");
      const base = { ...defaultProject(), commercial: defaultCommercial() };
      const res = await importIntakeFile(await file.arrayBuffer(), base, hardwareAllowance);
      importProject(res.project, res.name);
      setReport(res.report);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <Section
        title="Import a completed intake workbook"
        subtitle="The CEO's EVSE Project Intake (template 2.x) filled in by the client or the RSM. Every blue cell lands where the estimator keeps it — chargers and distances, terms, revenue and carbon assumptions, the existing installation, the Rule 29 block and the override register — as a NEW project in the library. The estimator's own rates stay in force."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import intake .xlsx"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          <span className={noteCls}>Quantities, terms and typed figures come across; unit costs do not (the estimator&apos;s rates are the basis). The report below says exactly what landed.</span>
        </div>
        {importError && <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{importError}</div>}
        {report && (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div>
              <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Mapped ({report.mapped.length}) — template {report.templateVersion || "?"}
                {report.fileVersion ? ` ${report.fileVersion}` : ""}
                {report.completedBy ? ` · ${report.completedBy}` : ""}
                {report.dateCompleted ? ` · ${report.dateCompleted}` : ""}
              </div>
              <ul className="max-h-72 space-y-0.5 overflow-auto text-xs text-zinc-600 dark:text-zinc-400">
                {report.mapped.map((m, i) => (
                  <li key={i}>• {m}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Skipped ({report.skipped.length})</div>
              <ul className="max-h-72 space-y-0.5 overflow-auto text-xs text-zinc-600 dark:text-zinc-400">
                {report.skipped.map((m, i) => (
                  <li key={i}>• {m}</li>
                ))}
                {report.skipped.length === 0 && <li>nothing</li>}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium text-amber-800 dark:text-amber-300">Look at ({report.warnings.length})</div>
              <ul className="max-h-72 space-y-0.5 overflow-auto text-xs text-amber-900 dark:text-amber-200">
                {report.warnings.map((m, i) => (
                  <li key={i}>• {m}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

/** 1 · Project — client and contact (intake Project rows 5–9). */
export function ClientContactSection() {
  const x = useIntakeEditing();
  const { it, setup, update, setIdentity } = x;
  return (
    <>
      <Section title="Client and contact" subtitle="Who the proposal goes to. Client and address are shared with the Quick Estimate tab.">
        <Grid cols={3}>
          <Field label="Client">
            <input className={inputCls} value={setup.clientName} onChange={(e) => setIdentity({ clientName: e.target.value })} />
          </Field>
          <Field label="Contact name">
            <input className={inputCls} value={it.contactName} onChange={(e) => update("contactName", e.target.value)} />
          </Field>
          <Field label="Contact title">
            <input className={inputCls} value={it.contactTitle} onChange={(e) => update("contactTitle", e.target.value)} />
          </Field>
          <Field label="Email">
            <input type="email" className={inputCls} value={it.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={it.contactPhone} onChange={(e) => update("contactPhone", e.target.value)} />
          </Field>
          <Field label="Project reference" hint="Your internal number or the client's PO / RFP reference">
            <input className={inputCls} value={it.projectReference} onChange={(e) => update("projectReference", e.target.value)} />
          </Field>
        </Grid>
      </Section>
    </>
  );
}

/** 1 · Project — site and access (intake Project rows 12–23). */
export function SiteAccessSection() {
  const x = useIntakeEditing();
  const { it, setup, update, setIdentity, numOrNull, propertyTypes } = x;
  return (
    <>
      <Section title="Site and access" subtitle="What the site is and when drivers can reach it — the revenue model reads the access policy.">
        <Grid cols={3}>
          <Field label="Site address">
            <input className={inputCls} value={setup.siteAddress} onChange={(e) => setIdentity({ siteAddress: e.target.value })} />
          </Field>
          <Field label="Site name">
            <input className={inputCls} value={it.siteName ?? ""} onChange={(e) => update("siteName", e.target.value)} />
          </Field>
          <Field label="County">
            <input className={inputCls} value={it.county ?? ""} onChange={(e) => update("county", e.target.value)} />
          </Field>
          <Field label="State">
            <select className={selectCls} value={it.state} onChange={(e) => update("state", e.target.value)}>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Property type">
            <select className={selectCls} value={it.propertyType} onChange={(e) => update("propertyType", e.target.value)}>
              <option value="">—</option>
              {propertyTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Open to the public?">
            <select className={selectCls} value={it.publicAccess} onChange={(e) => update("publicAccess", e.target.value as IntakeInput["publicAccess"])}>
              <option value="">—</option>
              <option value="Yes">Yes — public charging</option>
              <option value="No">No — private / fleet / residents</option>
            </select>
          </Field>
          <Field label="Hours open per day" hint="24 unless access is genuinely gated">
            <input type="number" min={0} max={24} className={inputCls} value={it.hoursOpen ?? ""} onChange={(e) => update("hoursOpen", numOrNull(e.target.value))} />
          </Field>
          <Field label="Days open per year" hint="365 unless the site closes seasonally — the revenue model reads this">
            <input type="number" min={0} max={366} className={inputCls} value={it.daysOpenPerYear ?? ""} onChange={(e) => update("daysOpenPerYear", numOrNull(e.target.value))} />
          </Field>
          <Field label="Days per week" hint="Used when days per year is blank">
            <input type="number" min={0} max={7} className={inputCls} value={it.daysPerWeek ?? ""} onChange={(e) => update("daysPerWeek", numOrNull(e.target.value))} />
          </Field>
        </Grid>
      </Section>
    </>
  );
}

/** 1 · Project — delivery utility, schedule, existing service (intake Project rows 26–30, 46). */
export function UtilityTariffSection() {
  const x = useIntakeEditing();
  const { it, setup, update, setSetup, numOrNull, utilitiesForState, utilityKnown, scheduleOptions, chosenSchedule, utilityRow } = x;
  return (
    <>
      <Section
        title="Utility and tariff"
        subtitle="The delivery utility sets the EV tariff. Pick it from the roster (California IOUs, POUs and Michigan utilities from the CEO intake) or type another; the schedules offered follow the utility. A community choice aggregator changes only the generation $/kWh."
      >
        <Grid cols={3}>
          <Field label="Delivery utility" hint={utilityRow ? `${utilityRow.type} · ${utilityRow.territory} · ${utilityRow.evRateStatus}` : "Type a name if it is not on the roster"}>
            <select className={selectCls} value={utilityKnown ? setup.utility : "__other"} onChange={(e) => setSetup("utility", e.target.value === "__other" ? "" : e.target.value)}>
              <option value="__other">Other / not listed…</option>
              {utilitiesForState.map((u) => (
                <option key={u.utility} value={u.utility}>
                  {u.utility}
                </option>
              ))}
            </select>
          </Field>
          {!utilityKnown && (
            <Field label="Utility name">
              <input className={inputCls} value={setup.utility} onChange={(e) => setSetup("utility", e.target.value)} placeholder="e.g. SMUD" />
            </Field>
          )}
          <Field
            label="Rate schedule the site will take"
            hint={
              chosenSchedule
                ? `${chosenSchedule.status}${chosenSchedule.effective ? ` · ${chosenSchedule.effective}` : ""} · peak $${chosenSchedule.peakPerKwh}/kWh · off-peak $${chosenSchedule.offPeakPerKwh}/kWh${chosenSchedule.blockKw ? ` · ${chosenSchedule.blockKw} kW blocks at $${chosenSchedule.blockPerMonth}/mo` : ""}`
                : "From the CEO rate library; the Business model tab prices energy from it"
            }
          >
            <select className={selectCls} value={it.rateSchedule} onChange={(e) => update("rateSchedule", e.target.value)}>
              <option value="">—</option>
              {scheduleOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Current rate schedule" hint="From a recent bill — what the site is billed on today">
            <input className={inputCls} value={it.currentRateSchedule ?? ""} onChange={(e) => update("currentRateSchedule", e.target.value)} />
          </Field>
          <Field label="Community choice aggregator, if any" hint="Changes only the generation $/kWh — eligibility, TOU periods and delivery charges stay with the utility">
            <input className={inputCls} value={it.cca ?? ""} onChange={(e) => update("cca", e.target.value)} />
          </Field>
          <Field label="12 months of bills obtained?" hint="Needed to validate the energy cost">
            <Pick value={it.billsObtained ?? ""} onChange={(v) => update("billsObtained", v as IntakeInput["billsObtained"])} />
          </Field>
          <Field label="Existing service size (A)">
            <input type="number" className={inputCls} value={it.existingServiceA ?? ""} onChange={(e) => update("existingServiceA", numOrNull(e.target.value))} />
          </Field>
          <Field label="Existing service voltage (V)">
            <input type="number" className={inputCls} value={it.existingServiceVoltage ?? ""} onChange={(e) => update("existingServiceVoltage", numOrNull(e.target.value))} />
          </Field>
          <Field label="EV load separately metered today?" hint="A separate EV meter is usually needed to reach the EV tariff">
            <select className={selectCls} value={it.separatelyMeteredEv} onChange={(e) => update("separatelyMeteredEv", e.target.value as IntakeInput["separatelyMeteredEv"])}>
              <option value="">—</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
              <option value="Unknown">Unknown</option>
            </select>
          </Field>
        </Grid>
      </Section>
    </>
  );
}

/** 3 · Electrical — the utility interconnection / Rule 29 block (intake Electrical rows 51–67, 119). */
export function InterconnectionSection() {
  const x = useIntakeEditing();
  const { project, setProject, numOrNull, ic, icResult, setIc } = x;
  return (
    <>
      <Section
        title="Utility interconnection"
        subtitle="Interconnection is the serving utility's answer, not ours. In California the IOUs publish EV infrastructure rules (PG&E and SCE Rule 29, SDG&E Rule 45): the utility designs, builds and owns the service extension; the customer bears the design fee, its own service equipment and the chargers. A publicly owned utility has its own policy and no Rule 29 allowance."
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Pill ok={icResult.regime.evRuleApplies || icResult.regime.regime === "pou" || icResult.regime.regime === "michigan"}>{icResult.regime.label}</Pill>
          <span className={noteCls}>{icResult.regime.description}</span>
        </div>
        <Grid cols={4}>
          <Field label="Service type">
            <Pick value={ic.serviceType} onChange={(v) => setIc("serviceType", v as InterconnectionInput["serviceType"])} options={["", "New service", "Added load to existing service"]} />
          </Field>
          <Field label="Overhead or underground service">
            <Pick value={ic.serviceRoute} onChange={(v) => setIc("serviceRoute", v as InterconnectionInput["serviceRoute"])} options={["", "Underground", "Overhead"]} />
          </Field>
          <Field label="Point of connection" hint="Existing MSB / new service / pole transformer">
            <input className={inputCls} value={ic.pointOfConnection} onChange={(e) => setIc("pointOfConnection", e.target.value)} />
          </Field>
          <Field label="Distance to the utility's point of interconnection (ft)" hint="Drives whether distribution work is likely">
            <input type="number" className={inputCls} value={ic.distanceToPoiFt ?? ""} onChange={(e) => setIc("distanceToPoiFt", numOrNull(e.target.value))} />
          </Field>
          <Field label="Who provides the transformer-to-switchgear run?" hint="Under the IOUs' EV rules the utility does — that conductor is then not in our scope">
            <Pick value={ic.serviceFeederBy} onChange={(v) => setIc("serviceFeederBy", v as InterconnectionInput["serviceFeederBy"])} options={["", "Utility — EV infrastructure rule", "Zero Impact Energy"]} />
          </Field>
          <Field label="Application submitted?" hint="Yes / No — with the date">
            <input className={inputCls} value={ic.applicationSubmitted} onChange={(e) => setIc("applicationSubmitted", e.target.value)} />
          </Field>
          <Field label="Utility project or design number">
            <input className={inputCls} value={ic.utilityProjectNumber} onChange={(e) => setIc("utilityProjectNumber", e.target.value)} />
          </Field>
          <Field label="Design fee ($)" hint="Set on the Commercial tab as the pass-through interconnection fee">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm tabular-nums dark:border-zinc-800 dark:bg-zinc-900">{money(project.commercial?.utilityInterconnectFee ?? 0)}</div>
          </Field>
          <Field label="Rule 15 distribution extension indicated?">
            <Pick value={ic.rule15Indicated} onChange={(v) => setIc("rule15Indicated", v as InterconnectionInput["rule15Indicated"])} options={["", "Unknown — design not yet submitted", "No", "Yes"]} />
          </Field>
          <Field label="Rule 15 allowance calculated by the utility ($)">
            <input type="number" className={inputCls} value={ic.rule15Allowance ?? ""} onChange={(e) => setIc("rule15Allowance", numOrNull(e.target.value))} />
          </Field>
          <Field label="Customer contribution above the allowance ($)" hint="Pass-through at cost; excluded by name when zero — lives with the Commercial terms">
            <input
              type="number"
              className={inputCls}
              value={project.commercial?.lineExtensionContribution ?? ""}
              onChange={(e) =>
                setProject((p) => ({
                  ...p,
                  commercial: p.commercial ? { ...p.commercial, lineExtensionContribution: e.target.value === "" ? undefined : Number(e.target.value) } : p.commercial,
                }))
              }
              disabled={!project.commercial}
            />
          </Field>
          <Field label="Rule 16 component?">
            <Pick value={ic.rule16} onChange={(v) => setIc("rule16", v as InterconnectionInput["rule16"])} options={["", "No", "Yes", "Unknown"]} />
          </Field>
          <Field label="ITCC gross-up applies?">
            <Pick value={ic.itcc} onChange={(v) => setIc("itcc", v as InterconnectionInput["itcc"])} options={["", "Only if Rule 15/16 contribution arises", "Yes", "No"]} />
          </Field>
          <Field label="Transformer pad location agreed with client?">
            <Pick value={ic.padLocationAgreed} onChange={(v) => setIc("padLocationAgreed", v as InterconnectionInput["padLocationAgreed"])} />
          </Field>
          <Field label="Proof of commitment to purchase provided?" hint="Rule 29 requires a PO, budget approval or grant agreement">
            <Pick value={ic.proofOfCommitment} onChange={(v) => setIc("proofOfCommitment", v as InterconnectionInput["proofOfCommitment"])} />
          </Field>
          <Field label="Client accepts the 5-year operate-and-maintain obligation?">
            <Pick value={ic.acceptsOandM} onChange={(v) => setIc("acceptsOandM", v as InterconnectionInput["acceptsOandM"])} />
          </Field>
          <Field label="Client accepts 30-business-day activation after energization?">
            <Pick value={ic.acceptsActivation} onChange={(v) => setIc("acceptsActivation", v as InterconnectionInput["acceptsActivation"])} />
          </Field>
          <Field label="Utility design submitted (date)">
            <input className={inputCls} value={ic.designSubmitted} onChange={(e) => setIc("designSubmitted", e.target.value)} />
          </Field>
          <Field label="Utility design returned (date)">
            <input className={inputCls} value={ic.designReturned} onChange={(e) => setIc("designReturned", e.target.value)} />
          </Field>
        </Grid>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">What the customer bears</div>
            <div className={tableWrapCls}>
              <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                <thead className={theadCls}>
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>In this price?</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={th}>Treatment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {icResult.customerBears.map((b) => (
                    <tr key={b.item}>
                      <td className={td}>{b.item}</td>
                      <td className={td}>
                        <Pill ok={b.inPrice === "Yes" || b.inPrice === "Client provides"}>{b.inPrice}</Pill>
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{b.amount === null ? "—" : money(b.amount)}</td>
                      <td className={`${td} ${noteCls}`}>{b.treatment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {icResult.utilityPaysFor.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">What the utility pays for</div>
                <ul className={`space-y-0.5 ${noteCls}`}>
                  {icResult.utilityPaysFor.map((u) => (
                    <li key={u}>• {u}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Exclusion wording for the proposal</div>
            <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">{icResult.exclusionWording}</p>
            {icResult.obligations.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Obligations the client takes on</div>
                <ul className={`space-y-0.5 ${noteCls}`}>
                  {icResult.obligations.map((o) => (
                    <li key={o}>• {o}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3">
              <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Checks</div>
              <ul className="space-y-1">
                {icResult.checks.map((c) => (
                  <li key={c.label} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-800">
                    <span>
                      {c.label}
                      <span className={`block ${noteCls}`}>{c.detail}</span>
                    </span>
                    <Pill ok={c.ok}>{c.ok ? "OK" : "LOOK"}</Pill>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}

/** 1 · Project — proposal date, validity, prepared by (intake Project rows 33–36). */
export function ProposalSection() {
  const x = useIntakeEditing();
  const { it, setup, update, setSetup, numOrNull } = x;
  return (
    <>
      <Section title="Proposal" subtitle="Who prepared it, when, and how long the price holds.">
        <Grid cols={4}>
          <Field label="Prepared by (CPM)">
            <input className={inputCls} value={setup.cpm} onChange={(e) => setSetup("cpm", e.target.value)} />
          </Field>
          <Field label="CRA">
            <input className={inputCls} value={setup.cra} onChange={(e) => setSetup("cra", e.target.value)} />
          </Field>
          <Field label="Proposal date">
            <input type="date" className={inputCls} value={it.proposalDate} onChange={(e) => update("proposalDate", e.target.value)} />
          </Field>
          <Field label="Valid for (days)">
            <input type="number" min={0} className={inputCls} value={it.validityDays ?? ""} onChange={(e) => update("validityDays", numOrNull(e.target.value))} />
          </Field>
        </Grid>
        <div className="mt-4">
          <Field label="Notes" hint="Anything the estimate should carry: access constraints, client preferences, open questions, what the intake importer could not place">
            <textarea className={`${inputCls} min-h-24`} value={it.notes} onChange={(e) => update("notes", e.target.value)} />
          </Field>
        </div>
      </Section>
    </>
  );
}

/** The intake's Project tab as one form, plus the import panel — the estimator-mode Intake tab. */
export function ProjectSections() {
  return (
    <>
      <ClientContactSection />
      <SiteAccessSection />
      <UtilityTariffSection />
      <ProposalSection />
    </>
  );
}

export function IntakeTab() {
  return (
    <div>
      <IntakeImportPanel />
      <ClientContactSection />
      <SiteAccessSection />
      <UtilityTariffSection />
      <InterconnectionSection />
      <ProposalSection />
    </div>
  );
}
