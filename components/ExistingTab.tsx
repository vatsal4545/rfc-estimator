"use client";

import { fractionToPct, money, num, pct, pctToFraction } from "@/lib/format";
import {
  CONNECTOR_KEYS,
  CONNECTOR_LABELS,
  PROJECT_TYPE_TEXT,
  RETAIN_DECISIONS,
  RETAIN_ELEMENTS,
  applyRemovalScope,
  computeExisting,
  defaultExisting,
  emptyMonth,
  emptyUnit,
  type ExistingInput,
  type ProjectType,
  type RetainDecision,
} from "@/lib/existing";
import { modelInputsOf } from "@/lib/proposal/defaults";
import { MARKET_BENCHMARKS } from "@/lib/ref/benchmarks";
import { computeSiteCapacity } from "@/lib/skus";
import { useProject } from "./ProjectContext";
import { Field, Grid, Pill, Section, inputCls, selectCls, theadCls } from "./ui";

// Existing site — the CEO intake's Existing tab (1B · rip and replace). On a
// greenfield site leave it alone. On a replacement site it decides the
// electrical and civil scope, prices the removal into Dump / Waste, and can
// hand the business model twelve months of metered history instead of the
// market benchmark.

const th = "px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap";
const thNum = `${th} text-right`;
const td = "px-2 py-1";
const tdNum = "px-2 py-1 text-right tabular-nums whitespace-nowrap";
const tableCls = "min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800";
const wrapCls = "max-h-[70vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800";
const noteCls = "text-xs text-zinc-500";
const small = `${inputCls} w-24 py-1`;
const kwh = (n: number) => num(n, 0);
const okText = (s: string) => /^(OK|Greenfield|n\/a|Market benchmark|HISTORICAL — )/.test(s);

function KV({ rows }: { rows: [string, string, string?][] }) {
  return (
    <table className="min-w-full text-sm">
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map(([k, v, note]) => (
          <tr key={k}>
            <td className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-400">{k}</td>
            <td className="py-1.5 text-right font-medium tabular-nums">{v}</td>
            {note !== undefined && <td className={`py-1.5 pl-3 ${noteCls}`}>{note}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ExistingTab() {
  const { project, setProject } = useProject();
  const x = project.existing ?? defaultExisting();
  const cap = computeSiteCapacity(project);
  const revenue = modelInputsOf(project.commercial).revenue;
  const bm = MARKET_BENCHMARKS.find((b) => b.state === revenue.benchmarkState);
  const r = computeExisting(x, {
    newPorts: cap.dcPositions + cap.l2Positions,
    newDcPositions: cap.dcPositions,
    newDcKw: cap.dcNameplateKw,
    newConnectedKw: cap.dcNameplateKw + cap.l2NameplateKw,
    serviceVoltage: x.infrastructure.voltage ?? 480,
    benchmarkUtilisation: bm?.portUtilisation ?? null,
    benchmarkState: revenue.benchmarkState,
  });
  const isReplacement = x.projectType !== "greenfield";

  function update(patch: Partial<ExistingInput>) {
    setProject((p) => applyRemovalScope({ ...p, existing: { ...(p.existing ?? defaultExisting()), ...patch } }));
  }
  const numOrNull = (v: string) => (v === "" ? null : Number(v));
  const setUnit = (i: number, patch: Partial<ExistingInput["units"][number]>) => update({ units: x.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) });
  const setMonth = (i: number, patch: Partial<ExistingInput["history"][number]>) => update({ history: x.history.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const addMonths = (count: number) => {
    const last = x.history[x.history.length - 1]?.month;
    const start = last && /^\d{4}-\d{2}$/.test(last) ? new Date(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 1) : new Date(new Date().getFullYear(), new Date().getMonth() - count, 1);
    const rows = Array.from({ length: count }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      return emptyMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    });
    update({ history: [...x.history, ...rows].slice(0, 36) });
  };

  return (
    <div>
      <Section
        title="Existing installation — rip and replace"
        subtitle="Complete this tab only when the site already has charging equipment. On a greenfield site leave it blank and the model ignores it. On a replacement site it is the most valuable page in the intake: it replaces market assumptions with the site's own history."
      >
        <Grid cols={4}>
          <Field label="Project type" hint="Greenfield builds everything. Rip and replace swaps the chargers and reuses the electrical infrastructure. Replace and expand does both.">
            <select className={selectCls} value={x.projectType} onChange={(e) => update({ projectType: e.target.value as ProjectType })}>
              {(Object.keys(PROJECT_TYPE_TEXT) as ProjectType[]).map((k) => (
                <option key={k} value={k}>
                  {PROJECT_TYPE_TEXT[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Age of the existing installation (years)" hint="Drives whether the existing conductors and gear are worth reusing">
            <input type="number" className={inputCls} value={x.ageYears ?? ""} onChange={(e) => update({ ageYears: numOrNull(e.target.value) })} disabled={!isReplacement} />
          </Field>
          <Field label="Reason for replacement" hint="End of life, unreliability, obsolete connectors, insufficient power, or a commercial decision">
            <input className={inputCls} value={x.reason} onChange={(e) => update({ reason: e.target.value })} disabled={!isReplacement} />
          </Field>
          <Field label="Who owns the existing equipment?" hint="If a third party owns it, removal and disposal need their agreement">
            <input className={inputCls} value={x.owner} onChange={(e) => update({ owner: e.target.value })} disabled={!isReplacement} />
          </Field>
        </Grid>
        {isReplacement && (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Field label="Revenue basis" hint="Set to historical actuals on any replacement site with twelve or more months of usable data. This baseline REPLACES the market benchmark, it does not add to it.">
              <select className={selectCls} value={x.revenueBasis} onChange={(e) => update({ revenueBasis: e.target.value as ExistingInput["revenueBasis"] })}>
                <option value="market">Market benchmark — greenfield build-up</option>
                <option value="historical">Historical actuals — replacement site</option>
              </select>
            </Field>
            <div className="self-end">
              <Pill ok={/^HISTORICAL — /.test(r.basisInForce) || /^Market benchmark — greenfield/.test(r.basisInForce)}>{r.basisInForce}</Pill>
            </div>
          </div>
        )}
      </Section>

      {isReplacement && (
        <>
          <Section
            title="B · What is retained and what is replaced"
            subtitle="This register is the whole commercial difference between a greenfield project and a replacement. Every line marked RETAIN removes cost from the electrical and construction scope; every REPLACE puts it back. Zero the retained lines on the Peripherals and Takeoff tabs — this register tells you which."
          >
            <div className={wrapCls}>
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <th className={th}>Element</th>
                    <th className={th}>Decision</th>
                    <th className={th}>Basis for the decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {RETAIN_ELEMENTS.map((e) => (
                    <tr key={e.key}>
                      <td className={td}>{e.label}</td>
                      <td className={td}>
                        <select className={`${selectCls} py-1`} value={x.register[e.key]} onChange={(ev) => update({ register: { ...x.register, [e.key]: ev.target.value as RetainDecision } })}>
                          {RETAIN_DECISIONS.map((d) => (
                            <option key={d} value={d}>
                              {d || "—"}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`${td} ${noteCls}`}>{e.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <KV
                rows={[
                  ["Elements retained / replaced", `${r.register.retained} / ${r.register.replaced}`, "of 12 in the register"],
                  ["Scope profile", r.register.scopeProfile],
                  ["Electrical scope", r.register.electricalProfile],
                  ["Construction scope", r.register.constructionProfile],
                ]}
              />
            </div>
          </Section>

          <Section title="C · Existing equipment being removed" subtitle="One row per existing cabinet or unit. Drives the demolition scope below and the port comparison in section F.">
            <div className={wrapCls}>
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <th className={th}>Make and model</th>
                    <th className={thNum}>Rating kW</th>
                    <th className={thNum}>Ports</th>
                    <th className={th}>Connectors</th>
                    <th className={thNum}>Qty</th>
                    <th className={th}>Year installed</th>
                    <th className={th}>Working?</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {x.units.map((u, i) => (
                    <tr key={i}>
                      <td className={td}>
                        <input className={`${inputCls} w-52 py-1`} value={u.makeModel} onChange={(e) => setUnit(i, { makeModel: e.target.value })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={small} value={u.kw ?? ""} onChange={(e) => setUnit(i, { kw: numOrNull(e.target.value) })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={`${inputCls} w-16 py-1`} value={u.ports ?? ""} onChange={(e) => setUnit(i, { ports: numOrNull(e.target.value) })} />
                      </td>
                      <td className={td}>
                        <input className={`${inputCls} w-36 py-1`} value={u.connectors} onChange={(e) => setUnit(i, { connectors: e.target.value })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={`${inputCls} w-16 py-1`} value={u.qty ?? ""} onChange={(e) => setUnit(i, { qty: numOrNull(e.target.value) })} />
                      </td>
                      <td className={td}>
                        <input className={`${inputCls} w-20 py-1`} value={u.yearInstalled} onChange={(e) => setUnit(i, { yearInstalled: e.target.value })} />
                      </td>
                      <td className={td}>
                        <select className={`${selectCls} py-1`} value={u.working} onChange={(e) => setUnit(i, { working: e.target.value as ExistingInput["units"][number]["working"] })}>
                          {["", "Working", "Intermittent", "Failed", "Removed already", "Unknown"].map((o) => (
                            <option key={o} value={o}>
                              {o || "—"}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={td}>
                        <button className="text-zinc-400 hover:text-red-600" onClick={() => update({ units: x.units.filter((_, j) => j !== i) })} title="Remove row">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="mt-2 rounded-md border border-blue-600 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950" onClick={() => update({ units: [...x.units, emptyUnit()] })}>
              + Add unit
            </button>
            <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <KV
                rows={[
                  ["Existing units on site", `${r.units.count}`, "cabinets or standalone units to be removed"],
                  ["Existing ports on site", `${r.units.ports}`],
                  ["Existing connected load", `${num(r.units.connectedKw, 1)} kW`, "what the existing service was sized for"],
                  ["Units fully working / failed / unknown", `${r.units.working} / ${r.units.failed} / ${r.units.unknown}`, "the gap against units on site is the availability the new equipment recovers"],
                  ["Existing power per DC position", `${num(r.units.powerPerPosition, 1)} kW`, "DC positions only (≥ 30 kW)"],
                ]}
              />
              <div>
                <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">D · Existing electrical infrastructure</div>
                <Grid cols={3}>
                  <Field label="Service size (A)">
                    <input type="number" className={inputCls} value={x.infrastructure.serviceA ?? ""} onChange={(e) => update({ infrastructure: { ...x.infrastructure, serviceA: numOrNull(e.target.value) } })} />
                  </Field>
                  <Field label="Service voltage">
                    <input type="number" className={inputCls} value={x.infrastructure.voltage ?? ""} onChange={(e) => update({ infrastructure: { ...x.infrastructure, voltage: numOrNull(e.target.value) } })} />
                  </Field>
                  <Field label="Spare capacity (A)">
                    <input type="number" className={inputCls} value={x.infrastructure.spareA ?? ""} onChange={(e) => update({ infrastructure: { ...x.infrastructure, spareA: numOrNull(e.target.value) } })} />
                  </Field>
                  <Field label="Switchgear frame (A)">
                    <input type="number" className={inputCls} value={x.infrastructure.frameA ?? ""} onChange={(e) => update({ infrastructure: { ...x.infrastructure, frameA: numOrNull(e.target.value) } })} />
                  </Field>
                  <Field label="Branch conductor size" hint="e.g. 250 KCMIL Cu">
                    <input className={inputCls} value={x.infrastructure.branchConductor} onChange={(e) => update({ infrastructure: { ...x.infrastructure, branchConductor: e.target.value } })} />
                  </Field>
                  <Field label="Average branch run (ft)">
                    <input type="number" className={inputCls} value={x.infrastructure.avgRunFt ?? ""} onChange={(e) => update({ infrastructure: { ...x.infrastructure, avgRunFt: numOrNull(e.target.value) } })} />
                  </Field>
                  <Field label="Conduit size and type" hint="e.g. 2-1/2 in PVC">
                    <input className={inputCls} value={x.infrastructure.conduit} onChange={(e) => update({ infrastructure: { ...x.infrastructure, conduit: e.target.value } })} />
                  </Field>
                  <Field label="Existing rate schedule" hint="The tariff the site is billed on today">
                    <input className={inputCls} value={x.infrastructure.rateSchedule} onChange={(e) => update({ infrastructure: { ...x.infrastructure, rateSchedule: e.target.value } })} />
                  </Field>
                  <Field label="Separately metered for EV today?">
                    <select className={selectCls} value={x.infrastructure.separatelyMetered} onChange={(e) => update({ infrastructure: { ...x.infrastructure, separatelyMetered: e.target.value as ExistingInput["infrastructure"]["separatelyMetered"] } })}>
                      {["", "Yes", "No", "Unknown"].map((o) => (
                        <option key={o} value={o}>
                          {o || "—"}
                        </option>
                      ))}
                    </select>
                  </Field>
                </Grid>
                <div className="mt-3">
                  <KV
                    rows={[
                      ["Does the existing service carry the new load?", r.checks.serviceCarriesLoad],
                      ["Does the existing switchgear carry the new load?", r.checks.switchgearCarriesLoad],
                      ["Load change from the existing installation", r.checks.loadChange],
                      ["Reuse feasibility", r.checks.reuseFeasible],
                    ]}
                  />
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="E · Historical usage and billing"
            subtitle="Up to thirty-six months of actuals. Twelve is the minimum for a credible run rate; twenty-four is better. Enter outage months as they happened — a site that averaged 3.4 of 5 ports working was rationing demand, not meeting it, and section F states the recovery separately."
          >
            <div className={wrapCls}>
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <th className={th}>Month</th>
                    <th className={thNum}>kWh dispensed</th>
                    <th className={thNum}>Gross revenue</th>
                    <th className={thNum}>Sessions</th>
                    <th className={thNum}>Utility cost</th>
                    <th className={thNum}>Ports working</th>
                    <th className={th}>Note / outage</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {x.history.map((m, i) => (
                    <tr key={i}>
                      <td className={td}>
                        <input className={`${inputCls} w-24 py-1`} value={m.month} placeholder="YYYY-MM" onChange={(e) => setMonth(i, { month: e.target.value })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={small} value={m.kwh ?? ""} onChange={(e) => setMonth(i, { kwh: numOrNull(e.target.value) })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={small} value={m.revenue ?? ""} onChange={(e) => setMonth(i, { revenue: numOrNull(e.target.value) })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={`${inputCls} w-20 py-1`} value={m.sessions ?? ""} onChange={(e) => setMonth(i, { sessions: numOrNull(e.target.value) })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={small} value={m.utilityCost ?? ""} onChange={(e) => setMonth(i, { utilityCost: numOrNull(e.target.value) })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={`${inputCls} w-16 py-1`} value={m.portsWorking ?? ""} onChange={(e) => setMonth(i, { portsWorking: numOrNull(e.target.value) })} />
                      </td>
                      <td className={td}>
                        <input className={`${inputCls} w-48 py-1`} value={m.note} onChange={(e) => setMonth(i, { note: e.target.value })} />
                      </td>
                      <td className={td}>
                        <button className="text-zinc-400 hover:text-red-600" onClick={() => update({ history: x.history.filter((_, j) => j !== i) })} title="Remove month">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex gap-2">
              <button className="rounded-md border border-blue-600 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950" onClick={() => addMonths(1)} disabled={x.history.length >= 36}>
                + Add month
              </button>
              <button className="rounded-md border border-blue-600 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950" onClick={() => addMonths(12)} disabled={x.history.length >= 36}>
                + Add twelve months
              </button>
            </div>
            <div className="mt-3">
              <KV
                rows={[
                  ["Months with data", `${r.history.months}`, "twelve is the minimum for a credible run rate"],
                  ["Average kWh per day / historical kWh per year", `${kwh(r.history.kwhPerDay)} / ${kwh(r.history.kwhPerYear)}`, "the run rate the new projection is built from"],
                  ["Historical gross revenue / utility cost per year", `${money(r.history.revenuePerYear)} / ${money(r.history.utilityPerYear)}`, `net before card fees ${money(r.history.netBeforeFees)}`],
                  ["Implied retail price", `$${r.history.impliedRetailPerKwh.toFixed(4)}/kWh`, `against $${revenue.retailPerKwh}/kWh proposed — a large increase on a settled driver base is a demand risk`],
                  ["Implied delivered cost", `$${r.history.impliedDeliveredPerKwh.toFixed(4)}/kWh`, "what the utility actually charged, all-in — better than any tariff estimate"],
                  ["Average kWh per session", num(r.history.kwhPerSession, 1), "typically 25 to 55 kWh on DC; low suggests failed or abandoned sessions"],
                  ["Average ports working / availability", `${num(r.history.avgPortsWorking, 2)} / ${pct(r.history.availability)}`, "ports working as a share of ports installed — the recovery opportunity"],
                ]}
              />
            </div>
          </Section>

          <Section
            title="F · G · Port expansion, connector coverage and the projected baseline"
            subtitle="Four uplifts, each a capture factor rather than taken at face value. A capture factor of 100% would claim the site converts the whole theoretical gain into energy sold; anything near that is not credible."
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <div className={wrapCls}>
                  <table className={tableCls}>
                    <thead className={theadCls}>
                      <tr>
                        <th className={th}>Connector</th>
                        <th className={th}>On the existing</th>
                        <th className={th}>On the new</th>
                        <th className={thNum}>Share of the local fleet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {CONNECTOR_KEYS.map((k) => (
                        <tr key={k}>
                          <td className={td}>{CONNECTOR_LABELS[k]}</td>
                          <td className={td}>
                            <input type="checkbox" className="h-4 w-4" checked={x.connectors[k].onExisting} onChange={(e) => update({ connectors: { ...x.connectors, [k]: { ...x.connectors[k], onExisting: e.target.checked } } })} />
                          </td>
                          <td className={td}>
                            <input type="checkbox" className="h-4 w-4" checked={x.connectors[k].onNew} onChange={(e) => update({ connectors: { ...x.connectors, [k]: { ...x.connectors[k], onNew: e.target.checked } } })} />
                          </td>
                          <td className={tdNum}>
                            <input type="number" step="1" className={small} value={fractionToPct(x.connectors[k].fleetShare)} onChange={(e) => update({ connectors: { ...x.connectors, [k]: { ...x.connectors[k], fleetShare: pctToFraction(Number(e.target.value)) } } })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3">
                  <KV
                    rows={[
                      ["Fleet coverage today → after replacement", `${pct(r.coverage.existing)} → ${pct(r.coverage.afterReplacement)}`, `${r.coverage.multiple.toFixed(2)}× — adding NACS to a CCS-only site is the largest addressable-market change available`],
                      ["Existing ports → new ports", `${r.units.ports} → ${cap.dcPositions + cap.l2Positions}`],
                      ["Existing → new power per DC position", `${num(r.units.powerPerPosition, 1)} → ${num(cap.dcPositions > 0 ? cap.dcNameplateKw / cap.dcPositions : 0, 1)} kW`, "capped at 2.00× — beyond double, the constraint is how many vehicles arrive"],
                    ]}
                  />
                </div>
              </div>
              <div>
                <div className={wrapCls}>
                  <table className={tableCls}>
                    <thead className={theadCls}>
                      <tr>
                        <th className={th}>Uplift</th>
                        <th className={thNum}>Theoretical</th>
                        <th className={thNum}>Capture</th>
                        <th className={thNum}>Applied</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {r.uplifts.map((u) => (
                        <tr key={u.key} title={u.basis}>
                          <td className={td}>{u.label}</td>
                          <td className={tdNum}>{u.theoretical.toFixed(2)}×</td>
                          <td className={tdNum}>
                            <input type="number" step="0.05" className={`${inputCls} w-20 py-1`} value={x.capture[u.key]} onChange={(e) => update({ capture: { ...x.capture, [u.key]: Number(e.target.value) } })} />
                          </td>
                          <td className={`${tdNum} font-medium`}>{u.applied.toFixed(3)}×</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-zinc-50 font-medium dark:bg-zinc-900">
                      <tr>
                        <td className={td} colSpan={3}>
                          Combined uplift multiple
                        </td>
                        <td className={tdNum}>{r.combinedUplift.toFixed(3)}×</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="mt-3">
                  <KV
                    rows={[
                      ["Historical kWh per year", kwh(r.history.kwhPerYear), "from section E — the starting point"],
                      ["Projected kWh per year at steady state", kwh(r.projectedKwhPerYear), r.projectionVsHistory],
                      ["Projected kWh per day", kwh(r.projectedKwhPerDay)],
                      ["Sanity check against capacity", r.capacityCheck, "stops an optimistic stack of uplifts producing a number the hardware cannot deliver"],
                      ["Cross-check against the market", r.market.verdict, r.market.benchmarkUtilisation ? `implied ${pct(r.market.impliedUtilisation)} port-time utilisation against ${pct(r.market.benchmarkUtilisation)} for ${revenue.benchmarkState}` : ""],
                    ]}
                  />
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="H · Removal, disposal and site protection"
            subtitle="What it costs to take the old installation out — real scope on a replacement, zero on a greenfield. Quantities × the estimator's removal rates land in the Dump / Waste line (materials-class, marked up); the crew's time belongs in the crew days."
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Grid cols={2}>
                <Field label="Cabinets to disconnect and remove (ea)" hint="Includes de-energising, lockout and terminations">
                  <input type="number" className={inputCls} value={x.removal.cabinets} onChange={(e) => update({ removal: { ...x.removal, cabinets: Number(e.target.value) } })} />
                </Field>
                <Field label="Concrete pads to break out (ea)" hint="Saw-cut, break, remove and dispose">
                  <input type="number" className={inputCls} value={x.removal.pads} onChange={(e) => update({ removal: { ...x.removal, pads: Number(e.target.value) } })} />
                </Field>
                <Field label="Bollards to remove (ea)">
                  <input type="number" className={inputCls} value={x.removal.bollards} onChange={(e) => update({ removal: { ...x.removal, bollards: Number(e.target.value) } })} />
                </Field>
                <Field label="Signage to remove (ea)">
                  <input type="number" className={inputCls} value={x.removal.signs} onChange={(e) => update({ removal: { ...x.removal, signs: Number(e.target.value) } })} />
                </Field>
                <Field label="Disposal loads (ea)" hint="Concrete and steel to a licensed facility">
                  <input type="number" className={inputCls} value={x.removal.disposalLoads} onChange={(e) => update({ removal: { ...x.removal, disposalLoads: Number(e.target.value) } })} />
                </Field>
                <Field label="Site protection and traffic control (days)" hint="Barriers, cones and signage around a live customer lot">
                  <input type="number" className={inputCls} value={x.removal.protectionDays} onChange={(e) => update({ removal: { ...x.removal, protectionDays: Number(e.target.value) } })} />
                </Field>
                <Field label="Equipment recycling or resale?" hint="Working units may carry salvage value — credit it on the Overrides tab, not here">
                  <select className={selectCls} value={x.removal.recycling} onChange={(e) => update({ removal: { ...x.removal, recycling: e.target.value as ExistingInput["removal"]["recycling"] } })}>
                    {["", "Yes", "No", "Unknown"].map((o) => (
                      <option key={o} value={o}>
                        {o || "—"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Hazardous material identified?" hint="Older units may contain fluids requiring special handling">
                  <select className={selectCls} value={x.removal.hazmat} onChange={(e) => update({ removal: { ...x.removal, hazmat: e.target.value as ExistingInput["removal"]["hazmat"] } })}>
                    {["", "Yes", "No", "Unknown"].map((o) => (
                      <option key={o} value={o}>
                        {o || "—"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Temporary charging required during works?" hint="If the site cannot go dark, this is a separate cost">
                  <select className={selectCls} value={x.removal.temporaryCharging} onChange={(e) => update({ removal: { ...x.removal, temporaryCharging: e.target.value as ExistingInput["removal"]["temporaryCharging"] } })}>
                    {["", "Yes", "No", "Unknown"].map((o) => (
                      <option key={o} value={o}>
                        {o || "—"}
                      </option>
                    ))}
                  </select>
                </Field>
              </Grid>
              <div>
                <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Removal rates (estimator) and cost lines</div>
                <Grid cols={3}>
                  {(
                    [
                      ["cabinet", "Cabinet removal $/ea"],
                      ["pad", "Pad break-out $/ea"],
                      ["bollard", "Bollard $/ea"],
                      ["sign", "Sign $/ea"],
                      ["disposalLoad", "Disposal load $/ea"],
                      ["protectionDay", "Site protection $/day"],
                    ] as [keyof ExistingInput["removalRates"], string][]
                  ).map(([k, label]) => (
                    <Field key={k} label={label}>
                      <input type="number" className={inputCls} value={x.removalRates[k]} onChange={(e) => update({ removalRates: { ...x.removalRates, [k]: Number(e.target.value) } })} />
                    </Field>
                  ))}
                </Grid>
                <div className={`${wrapCls} mt-3`}>
                  <table className={tableCls}>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {r.removal.lines.map((l) => (
                        <tr key={l.name}>
                          <td className={td}>{l.name}</td>
                          <td className={tdNum}>
                            {l.qty} × {money(l.unitCost)}
                          </td>
                          <td className={`${tdNum} font-medium`}>{money(l.total)}</td>
                        </tr>
                      ))}
                      {r.removal.lines.length === 0 && (
                        <tr>
                          <td className={`${td} ${noteCls}`} colSpan={3}>
                            No removal quantities entered.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="bg-zinc-50 font-medium dark:bg-zinc-900">
                      <tr>
                        <td className={td} colSpan={2}>
                          Into the Dump / Waste line (before contingency and markup)
                        </td>
                        <td className={tdNum}>{money(r.removal.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <span>
                    Indicative removal crew days: <span className="font-medium">{r.removal.crewDays}</span> <span className={noteCls}>(½ day per cabinet, ¾ per pad)</span>
                  </span>
                  <button
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    disabled={r.removal.crewDays === 0}
                    onClick={() => setProject((p) => ({ ...p, financial: { ...p.financial, laborBusinessDays: p.financial.laborBusinessDays + r.removal.crewDays } }))}
                    title="Adds the indicative removal days to the crew days on the Financials tab"
                  >
                    Add {r.removal.crewDays} day(s) to the crew days ({project.financial.laborBusinessDays} now)
                  </button>
                </div>
                <div className="mt-2">
                  <Pill ok={okText(r.removal.phasedProgramme)}>{r.removal.phasedProgramme}</Pill>
                </div>
              </div>
            </div>
          </Section>
        </>
      )}
      {!isReplacement && r.removal.greenfieldError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{r.removal.greenfieldError}</div>
      )}
    </div>
  );
}
