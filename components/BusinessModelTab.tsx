"use client";

import { fractionToPct, money, num, pct, pctToFraction } from "@/lib/format";
import { defaultCommercial, modelInputsOf } from "@/lib/proposal/defaults";
import type { ModelInputs, TariffRates } from "@/lib/proposal/types";
import { MARKET_BENCHMARKS } from "@/lib/ref/benchmarks";
import { useProject } from "./ProjectContext";
import { Field, Grid, Pill, Section, inputCls, selectCls, tableWrapCls, theadCls } from "./ui";

// Business model — the downstream model the CEO builds from the intake (the
// Best Western workbook's Utility_Rates, Revenue, Carbon, Financing, Cashflow
// and Business_Model sheets), computed from the Commercial tab's customer
// price and the project's equipment. Total Cost never changes here.

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap";
const thNum = `${th} text-right`;
const td = "px-3 py-1.5 whitespace-nowrap";
const tdNum = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
const tableCls = "min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800";
const wrapCls = tableWrapCls;
const totalCls = "bg-zinc-50 font-medium dark:bg-zinc-900";
const noteCls = "text-xs text-zinc-500";

const kwh = (n: number) => num(n, 0);
const kw = (n: number) => num(n, 1);
const rate = (n: number) => `$${n.toFixed(4)}`;
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;
const yearsOrNever = (n: number | null) => (n === null ? "beyond horizon" : `year ${n}`);

function NumField({
  label,
  hint,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  step?: string;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" step={step ?? "any"} min={min} className={inputCls} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

/**
 * A percentage typed the way people say it — "20" for 20%, with the sign in the
 * box so there is no doubt. The value stays a fraction in the project, so saved
 * projects, the engine, the exports and the template never see the display form.
 */
function PctField({
  label,
  hint,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  step?: string;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <input
          type="number"
          step={step ?? "1"}
          min={min}
          className={`${inputCls} pr-7`}
          value={fractionToPct(value)}
          onChange={(e) => onChange(pctToFraction(Number(e.target.value)))}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
          %
        </span>
      </div>
    </Field>
  );
}

function TextField({ label, hint, value, onChange, placeholder }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div
      className={
        accent
          ? "rounded-lg border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/30"
          : "rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      }
    >
      <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? "text-blue-800 dark:text-blue-200" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

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

const RATE_FIELDS: { key: keyof TariffRates; label: string; hint: string }[] = [
  { key: "peakPerKwh", label: "Peak $/kWh", hint: "On-peak energy charge" },
  { key: "offPeakPerKwh", label: "Off-peak $/kWh", hint: "" },
  { key: "superOffPeakPerKwh", label: "Super off-peak $/kWh", hint: "0 when the schedule has no third period" },
  { key: "customerPerMonth", label: "Customer charge $/month", hint: "Fixed meter charge" },
  { key: "demandPerKwMonth", label: "Demand charge $/kW-month", hint: "0 on a schedule with no demand charge" },
  { key: "blockKw", label: "Subscription block (kW)", hint: "0 when the schedule sells no blocks" },
  { key: "blockPerMonth", label: "Block price $/month", hint: "" },
  { key: "overagePerKw", label: "Overage $/kW", hint: "Charged on demand above the subscribed level" },
];

/**
 * Everything the model sections read and edit: the model result, its inputs
 * and the setters that write a section back onto project.commercial. Null
 * until the project has a commercial section (see ModelUnavailable).
 */
export function useModel() {
  const { project, setProject, proposal } = useProject();
  const c = project.commercial;
  if (!c || !proposal) return null;
  const m = proposal.model;
  const inputs = m.inputs;
  const { context: ctx, usage, tariff, revenue, carbon, financing, cashflow, deal } = m;

  function setSection<K extends keyof ModelInputs>(key: K, patch: Partial<ModelInputs[K]>) {
    setProject((p) => {
      const cur = p.commercial ?? defaultCommercial();
      const all = modelInputsOf(cur);
      return { ...p, commercial: { ...cur, [key]: { ...all[key], ...patch } } };
    });
  }
  const setTariff = (patch: Partial<ModelInputs["tariff"]>) => setSection("tariff", patch);
  const setRevenue = (patch: Partial<ModelInputs["revenue"]>) => setSection("revenue", patch);
  const setCarbon = (patch: Partial<ModelInputs["carbon"]>) => setSection("carbon", patch);
  const setFinancing = (patch: Partial<ModelInputs["financing"]>) => setSection("financing", patch);
  const setDeal = (patch: Partial<ModelInputs["deal"]>) => setSection("deal", patch);
  const setManualRate = (key: keyof TariffRates, v: number) => setTariff({ manual: { ...inputs.tariff.manual, [key]: v } });
  const setShare = (key: "peak" | "offPeak" | "superOffPeak", v: number) =>
    setTariff({ touShares: { ...(inputs.tariff.touShares ?? { peak: 1, offPeak: 0, superOffPeak: 0 }), [key]: v } });

  const horizon = revenue.years.length;
  const sumOf = <T,>(xs: T[], pick: (t: T) => number) => xs.reduce((s, t) => s + pick(t), 0);
  const statusOk = /^VERIFIED/i.test(tariff.status) || /^MANUAL/.test(tariff.status);

  return { project, setProject, c, proposal, m, inputs, ctx, usage, tariff, revenue, carbon, financing, cashflow, deal, setTariff, setRevenue, setCarbon, setFinancing, setDeal, setManualRate, setShare, horizon, sumOf, statusOk };
}

/** Shown in place of any model section while the project has no commercial section. */
export function ModelUnavailable() {
  const { setProject } = useProject();
  return (
      <Section
        title="Business model — revenue, carbon, financing, return"
        subtitle="The model runs downstream of the customer price. This project has no commercial section yet; set one up on the Commercial tab and the model appears here."
      >
        <button
          onClick={() => setProject((p) => ({ ...p, commercial: defaultCommercial() }))}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Set up pricing with the intake 2.9.0 defaults
        </button>
      </Section>
  );
}

/** Monthly payment, NPV, IRR and year-1 return, with the site line and any model notes. */
export function ModelHeadline() {
  const x = useModel();
  if (!x) return null;
  const { inputs, ctx, usage, tariff, revenue, carbon, financing, cashflow, horizon } = x;
  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={financing.offered ? "Monthly payment" : "Customer price (cash)"}
          value={financing.offered ? money(financing.payment) : money(financing.baseAmount)}
          sub={financing.offered ? `${financing.nPayments} payments at ${pct(financing.annualRate)} on ${money(financing.financedAmount)}` : "no financing offered"}
          accent
        />
        <Stat label={`${horizon}-year NPV`} value={money(cashflow.npv)} sub={`discounted at ${pct(inputs.financing.discountRate)} · net ${money(cashflow.totalNet)}`} />
        <Stat label="IRR" value={cashflow.irr === null ? "n/a" : pct(cashflow.irr)} sub={`break-even ${yearsOrNever(cashflow.breakEvenYear)}`} />
        <Stat
          label="Year 1 · charging + carbon"
          value={money((revenue.years[0]?.chargingProfit ?? 0) + (carbon.years[0]?.net ?? 0))}
          sub={`charging ${money(revenue.years[0]?.chargingProfit ?? 0)} · carbon net ${money(carbon.years[0]?.net ?? 0)}`}
        />
      </div>
      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
        <span>
          Site: {ctx.dcPositions} DC positions · {kw(ctx.dcNameplateKw)} kW DC nameplate · {ctx.l2Positions} L2 positions · {ctx.hoursPerDay} h/day · {ctx.daysPerYear} days/yr
        </span>
        <span>Steady state {kwh(usage.siteKwhPerYear)} kWh/yr</span>
        <span>
          Tariff {tariff.utility || "—"} {tariff.schedule || ""} · all-in {rate(tariff.horizonAllInPerKwh)}/kWh
        </span>
      </div>
      {(ctx.notes.length > 0 || tariff.warnings.length > 0) && (
        <ul className="mb-6 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {[...ctx.notes, ...tariff.warnings].map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 6 · Revenue — site and utilisation (intake Revenue rows 12–22). */
export function UsageSection() {
  const x = useModel();
  if (!x) return null;
  const { inputs, usage, revenue, setRevenue } = x;
  return (
    <>
      <Section
        title="Site and utilisation"
        subtitle="Utilisation expressed as stall-hours, then energy. The taper is applied before any money is counted. Every one of these will be challenged by the customer — set them where you can defend them. Hours and days come from the Intake tab."
      >
        <Grid cols={4}>
          <PctField label="Stall occupancy" hint="Share of stalls used per day (intake 20%)" step="1" value={inputs.revenue.stallOccupancy} onChange={(v) => setRevenue({ stallOccupancy: v })} />
          <PctField label="Charging hours per occupied stall" hint="Share of open hours (25%)" step="1" value={inputs.revenue.chargingHoursShare} onChange={(v) => setRevenue({ chargingHoursShare: v })} />
          <PctField label="Nameplate de-rate" hint="Cabinet output vs label (98%)" step="1" value={inputs.revenue.deratingFactor} onChange={(v) => setRevenue({ deratingFactor: v })} />
          <PctField label="Charging-curve taper" hint="Average delivered power vs port rating (70%)" step="1" value={inputs.revenue.taperFactor} onChange={(v) => setRevenue({ taperFactor: v })} />
          <PctField label="Year 1 share of steady state" hint="Greenfield sites take time to fill (50%)" step="5" value={inputs.revenue.rampYear1} onChange={(v) => setRevenue({ rampYear1: v })} />
          <PctField label="Year 2 share" step="5" value={inputs.revenue.rampYear2} onChange={(v) => setRevenue({ rampYear2: v })} />
          <PctField label="Year 3 share" step="5" value={inputs.revenue.rampYear3} onChange={(v) => setRevenue({ rampYear3: v })} />
          <PctField label="Annual growth after ramp" hint="Justify as a level, not a rate (6%)" step="1" value={inputs.revenue.growthAfterRamp} onChange={(v) => setRevenue({ growthAfterRamp: v })} />
        </Grid>
        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Steady-state projection</div>
            <KV
              rows={[
                ["DC positions · nameplate", `${usage.dc.positions} · ${kw(usage.dc.nameplateKw)} kW`],
                ["Power per DC position (de-rated)", `${kw(usage.dc.powerPerPosition)} kW`],
                ["Average delivered power (tapered)", `${kw(usage.dc.avgDeliveredKw)} kW`],
                ["DC stalls in use × hours per stall", `${num(usage.dc.stallsInUse, 2)} × ${num(usage.dc.chargingHoursPerStall, 2)} h = ${num(usage.dc.stallHoursPerDay, 2)} stall-h/day`],
                ["DC kWh per day / year", `${kwh(usage.dc.kwhPerDay)} / ${kwh(usage.dc.kwhPerYear)}`],
                ["L2 positions · power per position", `${usage.l2.positions} · ${num(usage.l2.powerPerPosition, 3)} kW`],
                ["L2 kWh per day / year", `${kwh(usage.l2.kwhPerDay)} / ${kwh(usage.l2.kwhPerYear)}`],
                ["Site kWh per day / year, both streams", `${kwh(usage.siteKwhPerDay)} / ${kwh(usage.siteKwhPerYear)}`],
              ]}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Market cross-check</div>
              <select className={`${selectCls} py-1 text-xs`} value={inputs.revenue.benchmarkState} onChange={(e) => setRevenue({ benchmarkState: e.target.value })}>
                {MARKET_BENCHMARKS.map((b) => (
                  <option key={b.state} value={b.state}>
                    {b.state}
                  </option>
                ))}
              </select>
            </div>
            <KV
              rows={[
                ["Benchmark port utilisation", revenue.benchmark.benchmarkUtilisation === null ? "—" : pct1(revenue.benchmark.benchmarkUtilisation), "time-based — share of the day a port delivers energy"],
                ["kWh/day if the site ran at benchmark", revenue.benchmark.kwhPerDayAtBenchmark === null ? "—" : kwh(revenue.benchmark.kwhPerDayAtBenchmark)],
                ["Site factor — this model vs benchmark", revenue.benchmark.siteFactor === null ? "—" : pct1(revenue.benchmark.siteFactor), "a new site should not be modelled at the state average"],
                ["Retail price vs the state average", revenue.benchmark.priceVsMarket === null ? "—" : `${revenue.benchmark.priceVsMarket >= 0 ? "+" : ""}${pct1(revenue.benchmark.priceVsMarket)}`, revenue.benchmark.benchmarkPricePerKwh === null ? "" : `state average $${revenue.benchmark.benchmarkPricePerKwh}/kWh`],
                ["Market's implied per-port growth", pct1(revenue.benchmark.impliedMarketGrowth), revenue.benchmark.growthVerdict],
              ]}
            />
          </div>
        </div>
      </Section>
    </>
  );
}

/** 6 · Revenue — the utility tariff, decomposed, and the demand subscription (intake Revenue rows 36–55, 82–94). */
export function TariffSection() {
  const x = useModel();
  if (!x) return null;
  const { inputs, tariff, setTariff, setManualRate, setShare, horizon, sumOf, statusOk } = x;
  return (
    <>
      <Section
        title="Utility tariff — the bill, decomposed"
        subtitle="One row per component so a demand charge cannot hide inside a blended cents-per-kWh figure. Utility and schedule come from the Setup and Intake tabs; the rate library supplies the figures where it has them."
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{tariff.utility || "No utility selected"}</span>
          <span className="text-zinc-400">·</span>
          <span>{tariff.schedule || "no schedule"}</span>
          <Pill ok={statusOk}>{tariff.status}</Pill>
          <span className={noteCls}>basis: {tariff.basis === "library" ? "rate library" : "manual"}</span>
        </div>
        <Grid cols={4}>
          <Field label="Rate basis">
            <select className={selectCls} value={inputs.tariff.basis} onChange={(e) => setTariff({ basis: e.target.value as "library" | "manual" })}>
              <option value="library">Rate library row (utility + schedule)</option>
              <option value="manual">Manual — a bill, a rate quote, an unresearched schedule</option>
            </select>
          </Field>
          {inputs.tariff.basis === "library" && (
            <div className="flex items-end">
              <button
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                onClick={() => setTariff({ basis: "manual", manual: { ...tariff.rates } })}
                title="Copy the resolved rates into the manual fields and edit them"
              >
                Copy to manual and edit
              </button>
            </div>
          )}
        </Grid>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {RATE_FIELDS.map((f) =>
            inputs.tariff.basis === "manual" ? (
              <NumField key={f.key} label={f.label} hint={f.hint || undefined} step="0.0001" value={inputs.tariff.manual[f.key]} onChange={(v) => setManualRate(f.key, v)} />
            ) : (
              <Field key={f.key} label={f.label} hint={f.hint || undefined}>
                <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm tabular-nums dark:border-zinc-800 dark:bg-zinc-900">{tariff.rates[f.key]}</div>
              </Field>
            ),
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Time-of-use mix — share of energy dispensed in each period</div>
            <label className="mb-2 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={inputs.tariff.touShares === null}
                onChange={(e) => setTariff({ touShares: e.target.checked ? null : { peak: 0.3, offPeak: 0.55, superOffPeak: 0.15 } })}
              />
              Flat schedule — no time-of-use split (energy priced at the single rate)
            </label>
            {inputs.tariff.touShares !== null && (
              <Grid cols={3}>
                <PctField label="Peak share" step="5" value={inputs.tariff.touShares.peak} onChange={(v) => setShare("peak", v)} />
                <PctField label="Off-peak share" step="5" value={inputs.tariff.touShares.offPeak} onChange={(v) => setShare("offPeak", v)} />
                <PctField label="Super off-peak share" step="5" value={inputs.tariff.touShares.superOffPeak} onChange={(v) => setShare("superOffPeak", v)} />
              </Grid>
            )}
            <div className="mt-3">
              <KV
                rows={[
                  ["Blended volumetric $/kWh", rate(tariff.blendedPerKwh), tariff.isFlat ? "flat" : `${pct1(tariff.touShares.peak)} / ${pct1(tariff.touShares.offPeak)} / ${pct1(tariff.touShares.superOffPeak)}`],
                  ["All-in $/kWh — year 1 / horizon / year 10", `${rate(tariff.year1AllInPerKwh)} / ${rate(tariff.horizonAllInPerKwh)} / ${rate(tariff.year10AllInPerKwh)}`, "energy plus the fixed and demand cost spread over the year's volume"],
                ]}
              />
            </div>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Demand subscription — how it ramps</div>
            <Grid cols={2}>
              <Field label="Subscription policy" hint="Demand is set by simultaneous draw, not annual energy">
                <select className={selectCls} value={inputs.tariff.subscriptionPolicy} onChange={(e) => setTariff({ subscriptionPolicy: e.target.value as ModelInputs["tariff"]["subscriptionPolicy"] })}>
                  <option value="ramped">Ramped to projected demand</option>
                  <option value="nameplate">Fixed at full nameplate</option>
                  <option value="manual">Fixed at the manual level</option>
                </select>
              </Field>
              <NumField label="Manual subscribed kW" hint="Used by the manual policy" value={inputs.tariff.manualSubscribedKw} onChange={(v) => setTariff({ manualSubscribedKw: v })} />
              <NumField label="Peak-to-average concurrency factor" hint="Ratio of peak simultaneous draw to the daily average (4)" step="0.5" value={inputs.tariff.peakToAverageFactor} onChange={(v) => setTariff({ peakToAverageFactor: v })} />
              <PctField label="Safety margin on subscribed kW" hint="Headroom before overage bites (20%)" step="5" value={inputs.tariff.safetyMarginPct} onChange={(v) => setTariff({ safetyMarginPct: v })} />
              <NumField label="Demand charge bills from year" hint="SCE facilities-related demand charges resume 1 Jan 2030" min={1} step="1" value={inputs.tariff.demandChargeFromYear} onChange={(v) => setTariff({ demandChargeFromYear: v })} />
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" className="h-4 w-4" checked={inputs.tariff.sizeDemandOnFullRating} onChange={(e) => setTariff({ sizeDemandOnFullRating: e.target.checked })} />
                Size demand on the full port rating
              </label>
            </Grid>
          </div>
        </div>

        <div className={`${wrapCls} mt-5`}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Year</th>
                <th className={thNum}>kWh</th>
                <th className={thNum}>kWh/day</th>
                <th className={thNum}>Avg ports</th>
                <th className={thNum}>Peak ports</th>
                <th className={thNum}>Peak kW</th>
                <th className={thNum}>Subscribed kW</th>
                <th className={thNum}>Blocks</th>
                <th className={thNum}>Subscription</th>
                <th className={thNum}>Demand charge</th>
                <th className={thNum}>Customer charge</th>
                <th className={thNum}>Energy</th>
                <th className={thNum}>All-in $/kWh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {tariff.years.map((y) => (
                <tr key={y.year}>
                  <td className={td}>{y.year}</td>
                  <td className={tdNum}>{kwh(y.kwh)}</td>
                  <td className={tdNum}>{kwh(y.kwhPerDay)}</td>
                  <td className={tdNum}>{num(y.avgConcurrentPorts, 2)}</td>
                  <td className={tdNum}>{y.peakConcurrentPorts}</td>
                  <td className={tdNum}>{kw(y.peakDemandKw)}</td>
                  <td className={tdNum}>{kw(y.subscribedKw)}</td>
                  <td className={tdNum}>{y.blocks}</td>
                  <td className={tdNum}>{money(y.subscriptionCost)}</td>
                  <td className={tdNum}>{money(y.demandChargeCost)}</td>
                  <td className={tdNum}>{money(y.customerChargeCost)}</td>
                  <td className={tdNum}>{money(y.energyCost)}</td>
                  <td className={tdNum}>{rate(y.allInPerKwh)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className={totalCls}>
              <tr>
                <td className={td} colSpan={8}>
                  Across the horizon · flat at full nameplate {money(tariff.flatAtNameplateTotal)} · saving from ramping {money(tariff.savingFromRamping)}
                </td>
                <td className={tdNum}>{money(tariff.subscriptionTotal)}</td>
                <td className={tdNum}>{money(sumOf(tariff.years, (y) => y.demandChargeCost))}</td>
                <td className={tdNum}>{money(sumOf(tariff.years, (y) => y.customerChargeCost))}</td>
                <td className={tdNum}>{money(sumOf(tariff.years, (y) => y.energyCost))}</td>
                <td className={tdNum}>{rate(tariff.horizonAllInPerKwh)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">The other side of ramping — overage exposure</div>
            <KV
              rows={[
                ["All positions drawing at once", `${kw(tariff.fullAtOnceKw)} kW`, "the physical maximum the site can pull"],
                [`Year ${horizon} subscribed level`, `${kw(tariff.years[horizon - 1]?.subscribedKw ?? 0)} kW`],
                ["Unsubscribed headroom", `${kw(tariff.overage.unsubscribedKw)} kW`, "exposed to the overage rate"],
                ["Cost of one month at full simultaneous draw", money(tariff.overage.oneMonthFullDraw), "a single busy fifteen-minute interval sets the month"],
                ["Worst-case months the saving would absorb", tariff.overage.monthsAbsorbed === null ? "n/a" : num(tariff.overage.monthsAbsorbed, 1), tariff.overage.verdict],
              ]}
            />
            <p className={`mt-2 ${noteCls}`}>
              Set the subscription from the demand ramp, then true it up on the first two quarters of interval data. Tell the client explicitly: a subscription set to projected demand is a saving they are choosing, with a downside they should know about.
            </p>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Tariff provenance — printed on the proposal at the point of use</div>
            <Grid cols={2}>
              <TextField label="Source of the rate figures" hint="A filed tariff sheet, a rate insert, a bill, or a phone call — name it" value={inputs.tariff.provenance.source} onChange={(v) => setTariff({ provenance: { ...inputs.tariff.provenance, source: v } })} />
              <Field label="Verified against the filed tariff sheets?" hint="No is a perfectly good answer; nobody knowing is not">
                <select className={selectCls} value={inputs.tariff.provenance.verified} onChange={(e) => setTariff({ provenance: { ...inputs.tariff.provenance, verified: e.target.value as "" | "Yes" | "No" } })}>
                  <option value="">—</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </Field>
              <TextField label="Verified by / date" value={inputs.tariff.provenance.verifiedBy} onChange={(v) => setTariff({ provenance: { ...inputs.tariff.provenance, verifiedBy: v } })} />
              <TextField label="Demand-schedule eligibility threshold" hint="If this utility moves customers onto a demand schedule above some consumption, record it" value={inputs.tariff.provenance.eligibilityThreshold} onChange={(v) => setTariff({ provenance: { ...inputs.tariff.provenance, eligibilityThreshold: v } })} />
              <Field label="Would this site cross that threshold?" hint="If yes, the tariff behind every revenue figure is the wrong one">
                <select className={selectCls} value={inputs.tariff.provenance.crossesThreshold} onChange={(e) => setTariff({ provenance: { ...inputs.tariff.provenance, crossesThreshold: e.target.value as "" | "Yes" | "No" } })}>
                  <option value="">—</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </Field>
            </Grid>
          </div>
        </div>
      </Section>
    </>
  );
}

/** 6 · Revenue — the revenue projection (intake Revenue rows 5–9). */
export function RevenueSection() {
  const x = useModel();
  if (!x) return null;
  const { inputs, revenue, setRevenue, horizon, sumOf } = x;
  return (
    <>
      <Section
        title="Revenue projection"
        subtitle={`Gross revenue less the utility bill, card fees and — once the ${revenue.contractYears}-year service contract ends — warranty, service and the network fee the site then pays itself (${money(revenue.postContractServicePerYear)}/yr).`}
      >
        <Grid cols={3}>
          <NumField label="Retail price to driver ($/kWh)" hint="Intake: $0.65" step="0.01" value={inputs.revenue.retailPerKwh} onChange={(v) => setRevenue({ retailPerKwh: v })} />
          <PctField label="Card processing fee (share of gross)" hint="3%" step="0.1" value={inputs.revenue.cardFeePct} onChange={(v) => setRevenue({ cardFeePct: v })} />
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" className="h-4 w-4" checked={inputs.revenue.idleFeeRevenue} onChange={(e) => setRevenue({ idleFeeRevenue: e.target.checked })} />
            Idle fee revenue contracted (not counted — disclosure only)
          </label>
        </Grid>
        <div className={`${wrapCls} mt-4`}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Year</th>
                <th className={thNum}>Ramp</th>
                <th className={thNum}>kWh</th>
                <th className={thNum}>Gross revenue</th>
                <th className={thNum}>Utility cost</th>
                <th className={thNum}>Card fees</th>
                <th className={thNum}>Service & network</th>
                <th className={thNum}>Charging profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {revenue.years.map((y) => (
                <tr key={y.year}>
                  <td className={td}>{y.year}</td>
                  <td className={tdNum}>{pct1(y.ramp)}</td>
                  <td className={tdNum}>{kwh(y.kwh)}</td>
                  <td className={tdNum}>{money(y.grossRevenue)}</td>
                  <td className={tdNum}>{money(y.utilityCost)}</td>
                  <td className={tdNum}>{money(y.cardFees)}</td>
                  <td className={tdNum}>{money(y.serviceAndNetwork)}</td>
                  <td className={`${tdNum} font-medium`}>{money(y.chargingProfit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className={totalCls}>
              <tr>
                <td className={td} colSpan={2}>
                  {horizon}-year total
                </td>
                <td className={tdNum}>{kwh(sumOf(revenue.years, (y) => y.kwh))}</td>
                <td className={tdNum}>{money(sumOf(revenue.years, (y) => y.grossRevenue))}</td>
                <td className={tdNum}>{money(sumOf(revenue.years, (y) => y.utilityCost))}</td>
                <td className={tdNum}>{money(sumOf(revenue.years, (y) => y.cardFees))}</td>
                <td className={tdNum}>{money(sumOf(revenue.years, (y) => y.serviceAndNetwork))}</td>
                <td className={tdNum}>{money(sumOf(revenue.years, (y) => y.chargingProfit))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>
    </>
  );
}

/** 7 · Carbon — FCI capacity credit, aggregator, incentives (intake Carbon tab). */
export function CarbonSection() {
  const x = useModel();
  if (!x) return null;
  const { inputs, carbon, setCarbon, sumOf } = x;
  return (
    <>
      <Section
        title="Carbon credits and incentives"
        subtitle="The FCI capacity credit is usually the most reliable revenue in the model — treat its inputs accordingly. It pays on DC fast-charging capacity only; Level 2 earns consumption credits. The aggregator's share is a disclosed cost, never our revenue."
      >
        <Grid cols={4}>
          <Field label="Site qualifies for FCI capacity credits?">
            <select className={selectCls} value={inputs.carbon.qualifies} onChange={(e) => setCarbon({ qualifies: e.target.value as ModelInputs["carbon"]["qualifies"] })}>
              <option value="">—</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
              <option value="Pending">Pending</option>
            </select>
          </Field>
          <Field label="Permit clears the 1 Jan 2022 test?">
            <select className={selectCls} value={inputs.carbon.permitClears2022} onChange={(e) => setCarbon({ permitClears2022: e.target.value as "" | "Yes" | "No" })}>
              <option value="">—</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </Field>
          <TextField label="Application filed?" hint="Yes / No — with date" value={inputs.carbon.applicationFiled} onChange={(v) => setCarbon({ applicationFiled: v })} />
          <TextField label="Registered aggregator" value={inputs.carbon.aggregator} onChange={(v) => setCarbon({ aggregator: v })} />
          <NumField label="FCI credit rate ($/kW/yr)" hint="Confirm with the aggregator in writing ($71.6667)" step="0.0001" value={inputs.carbon.fciRatePerKwYear} onChange={(v) => setCarbon({ fciRatePerKwYear: v })} />
          <PctField label="Aggregator share of credit value" hint="5%" step="1" value={inputs.carbon.aggregatorSharePct} onChange={(v) => setCarbon({ aggregatorSharePct: v })} />
          <NumField label="Crediting period (years)" min={0} step="1" value={inputs.carbon.creditingYears} onChange={(v) => setCarbon({ creditingYears: v })} />
          <NumField label="Cap multiple of net capex" hint="FCI revenue stops at this multiple (1.5×)" step="0.1" value={inputs.carbon.capMultiple} onChange={(v) => setCarbon({ capMultiple: v })} />
          <NumField label="L2 consumption credit ($/kWh)" hint="$0.0045 on L2 energy; 0 excludes it" step="0.0005" value={inputs.carbon.l2CreditPerKwh} onChange={(v) => setCarbon({ l2CreditPerKwh: v })} />
          <NumField label="Grants or rebates awarded ($)" hint="Reduce net capex and therefore the cap" value={inputs.carbon.grantsAwarded} onChange={(v) => setCarbon({ grantsAwarded: v })} />
          <Field label="Federal ITC claimed?" hint="Sec 30C ended for property in service after 30 Jun 2026">
            <select className={selectCls} value={inputs.carbon.federalItc} onChange={(e) => setCarbon({ federalItc: e.target.value as "" | "Yes" | "No" })}>
              <option value="">—</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </Field>
          <TextField label="State programme evaluated" hint="e.g. Fast Charge California — name it even if it does not qualify" value={inputs.carbon.stateProgramme} onChange={(v) => setCarbon({ stateProgramme: v })} />
          <TextField label="State programme outcome" hint="Qualifies / Does not qualify / Applied — with the reason" value={inputs.carbon.stateProgrammeOutcome} onChange={(v) => setCarbon({ stateProgrammeOutcome: v })} />
        </Grid>
        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <KV
            rows={[
              ["DC nameplate (credit basis)", `${kw(carbon.dcNameplateKw)} kW`],
              ["Gross capacity credit per year", money(carbon.grossPerYear)],
              ["Net of aggregator share, per year", money(carbon.netPerYear)],
              ["Net capital expenditure", money(carbon.netCapex), "customer price less grants"],
              ["Credit cap", money(carbon.cap), carbon.capBinds ? "YES — credit truncates" : "No — full period available"],
              ["Gross across the crediting period", money(carbon.grossAcrossPeriod)],
            ]}
          />
          <div className={wrapCls}>
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Year</th>
                  <th className={thNum}>Capacity credit</th>
                  <th className={thNum}>Cumulative</th>
                  <th className={thNum}>L2 credit</th>
                  <th className={thNum}>Net of aggregator</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {carbon.years.map((y) => (
                  <tr key={y.year}>
                    <td className={td}>{y.year}</td>
                    <td className={tdNum}>{money(y.capacityCredit)}</td>
                    <td className={tdNum}>{money(y.cumulativeAfter)}</td>
                    <td className={tdNum}>{money(y.l2Credit)}</td>
                    <td className={`${tdNum} font-medium`}>{money(y.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className={totalCls}>
                <tr>
                  <td className={td}>Total</td>
                  <td className={tdNum}>{money(sumOf(carbon.years, (y) => y.capacityCredit))}</td>
                  <td className={tdNum} />
                  <td className={tdNum}>{money(sumOf(carbon.years, (y) => y.l2Credit))}</td>
                  <td className={tdNum}>{money(carbon.totalNet)}</td>
                </tr>
                <tr className="text-xs font-normal text-zinc-500">
                  <td className={td} colSpan={5}>
                    Gross {money(carbon.totalGross)} · aggregator administration fee {money(carbon.totalAdminFee)} (disclosed cost, not our revenue) · net to the site {money(carbon.totalNet)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </Section>
    </>
  );
}

/** 5 · Commercial — financing terms and the model horizon (intake Commercial rows 19–29). */
export function FinancingSection() {
  const x = useModel();
  if (!x) return null;
  const { inputs, financing, setFinancing } = x;
  return (
    <>
      <Section title="Financing" subtitle="Full amortisation of the financed amount at the quoted rate and term. The model horizon and discount rate live here too.">
        <Grid cols={4}>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" className="h-4 w-4" checked={inputs.financing.offered} onChange={(e) => setFinancing({ offered: e.target.checked })} />
            Financing offered
          </label>
          <TextField label="Lender" value={inputs.financing.lender} onChange={(v) => setFinancing({ lender: v })} />
          <PctField label="Annual interest rate" hint="Intake: 8.39%" step="0.01" value={inputs.financing.annualRate} onChange={(v) => setFinancing({ annualRate: v })} />
          <NumField label="Term (years)" min={0} step="1" value={inputs.financing.termYears} onChange={(v) => setFinancing({ termYears: v })} />
          <NumField label="Payments per year" min={1} step="1" value={inputs.financing.paymentsPerYear} onChange={(v) => setFinancing({ paymentsPerYear: v })} />
          <NumField label="Down payment ($)" value={inputs.financing.downPayment} onChange={(v) => setFinancing({ downPayment: v })} />
          <Field label="Financing start date">
            <input type="date" className={inputCls} value={inputs.financing.startDate} onChange={(e) => setFinancing({ startDate: e.target.value })} />
          </Field>
          <Field label="Client finances" hint="Whether the facility covers third-party scope too">
            <select className={selectCls} value={inputs.financing.financeBasis} onChange={(e) => setFinancing({ financeBasis: e.target.value as "whole" | "ours" })}>
              <option value="whole">Whole project (ours + third-party scope)</option>
              <option value="ours">Our scope only (contract value)</option>
            </select>
          </Field>
          <NumField label="Model horizon (years)" hint="Use 10 — the carbon credit runs ten years" min={1} step="1" value={inputs.financing.horizonYears} onChange={(v) => setFinancing({ horizonYears: v })} />
          <PctField label="Discount rate for NPV" hint="Default: the financing rate" step="0.01" value={inputs.financing.discountRate} onChange={(v) => setFinancing({ discountRate: v })} />
        </Grid>
        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <KV
            rows={[
              ["Amount to finance", money(financing.baseAmount), inputs.financing.financeBasis === "ours" ? "our contract value" : "client's total project cost"],
              ["Financed after the down payment", money(financing.financedAmount)],
              ["Number of payments", `${financing.nPayments}`],
              [inputs.financing.paymentsPerYear === 12 ? "Monthly payment" : "Payment per period", financing.offered ? money(financing.payment) : "— not offered"],
              ["Total paid over the term", money(financing.totalPaid)],
              ["Total interest", money(financing.totalInterest)],
            ]}
          />
          {financing.schedule.length > 0 && (
            <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Amortisation schedule ({financing.schedule.length} payments)</summary>
              <div className="slim-scroll max-h-80 overflow-auto">
                <table className={tableCls}>
                  <thead className={theadCls}>
                    <tr>
                      <th className={th}>#</th>
                      <th className={thNum}>Opening</th>
                      <th className={thNum}>Payment</th>
                      <th className={thNum}>Principal</th>
                      <th className={thNum}>Interest</th>
                      <th className={thNum}>Closing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {financing.schedule.map((r) => (
                      <tr key={r.n}>
                        <td className={td}>{r.n}</td>
                        <td className={tdNum}>{money(r.opening)}</td>
                        <td className={tdNum}>{money(r.payment)}</td>
                        <td className={tdNum}>{money(r.principal)}</td>
                        <td className={tdNum}>{money(r.interest)}</td>
                        <td className={tdNum}>{money(Math.abs(r.closing) < 0.005 ? 0 : r.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      </Section>
    </>
  );
}

/** Output — cashflow, NPV, IRR, break-even and the position by payment period. */
export function CashflowSection() {
  const x = useModel();
  if (!x) return null;
  const { inputs, cashflow } = x;
  return (
    <>
      <Section title="Cashflow and return" subtitle="Charging profit plus the net carbon credit, against the capital outlay. Year 0 is the client's purchase; NPV discounts years 1 onward.">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className={wrapCls}>
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Year</th>
                  <th className={thNum}>Charging profit</th>
                  <th className={thNum}>Carbon (net)</th>
                  <th className={thNum}>Annual cashflow</th>
                  <th className={thNum}>Cumulative</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {cashflow.years.map((y) => (
                  <tr key={y.year} className={y.cumulative >= 0 && y.year > 0 ? "" : "text-zinc-700 dark:text-zinc-300"}>
                    <td className={td}>{y.year}</td>
                    <td className={tdNum}>{y.year === 0 ? "—" : money(y.chargingProfit)}</td>
                    <td className={tdNum}>{y.year === 0 ? "—" : money(y.carbonNet)}</td>
                    <td className={tdNum}>{money(y.cashflow)}</td>
                    <td className={`${tdNum} ${y.cumulative < 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{money(y.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <KV
              rows={[
                ["Total net over the horizon", money(cashflow.totalNet)],
                [`NPV at ${pct(inputs.financing.discountRate)}`, money(cashflow.npv)],
                ["IRR", cashflow.irr === null ? "n/a" : pct(cashflow.irr)],
                ["Cumulative break-even", yearsOrNever(cashflow.breakEvenYear), "year in which cumulative cashflow turns positive"],
                ...(cashflow.monthly.length > 0
                  ? ([
                      ["Cash position across the financing term", money(cashflow.cumulativeMonthly), cashflow.cumulativeMonthly < 0 ? "the customer funds this much over the term" : "the site covers its own payments over the term"],
                      ["First period with a positive net position", cashflow.firstPositivePeriod === null ? "none" : `period ${cashflow.firstPositivePeriod}`],
                    ] as [string, string, string?][])
                  : []),
              ]}
            />
            {cashflow.monthly.length > 0 && (
              <details className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Position by payment period — loan payment against carbon and charging</summary>
                <div className="slim-scroll max-h-80 overflow-auto">
                  <table className={tableCls}>
                    <thead className={theadCls}>
                      <tr>
                        <th className={th}>Period</th>
                        <th className={thNum}>Loan payment</th>
                        <th className={thNum}>Carbon</th>
                        <th className={thNum}>Charging</th>
                        <th className={thNum}>Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {cashflow.monthly.map((r) => (
                        <tr key={r.period}>
                          <td className={td}>{r.period}</td>
                          <td className={tdNum}>{money(r.loanPayment)}</td>
                          <td className={tdNum}>{money(r.carbon)}</td>
                          <td className={tdNum}>{money(r.charging)}</td>
                          <td className={`${tdNum} ${r.net < 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{money(r.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}

/** 8 · Deal structure — trading price for a share of the upside (intake Deal_Structure tab). */
export function DealSection() {
  const x = useModel();
  if (!x) return null;
  const { inputs, ctx, financing, deal, setDeal } = x;
  return (
    <>
      <Section
        title="Deal structure (optional)"
        subtitle="Leave every knob at zero for a straight sale. Fill them in only when we are trading price for a share of the upside — the model reports both sides so a structure can be judged before it is offered."
      >
        <Grid cols={4}>
          <TextField label="Structure name" hint="So a reader knows which structure this is" value={inputs.deal.name} onChange={(v) => setDeal({ name: v })} />
          <PctField label="Our share of the net carbon credit" hint="0 = client keeps all of it" step="5" value={inputs.deal.carbonSharePct} onChange={(v) => setDeal({ carbonSharePct: v })} />
          <PctField label="Our share of charging revenue" step="5" value={inputs.deal.revenueSharePct} onChange={(v) => setDeal({ revenueSharePct: v })} />
          <Field label="Revenue share is taken on" hint="On gross we get paid before the site covers its energy cost">
            <select className={selectCls} value={inputs.deal.revenueShareBasis} onChange={(e) => setDeal({ revenueShareBasis: e.target.value as "profit" | "gross" })}>
              <option value="profit">Net charging profit</option>
              <option value="gross">Gross revenue</option>
            </select>
          </Field>
          <NumField label="Share runs for (years)" hint="Cannot exceed the model horizon" min={0} step="1" value={inputs.deal.shareYears} onChange={(v) => setDeal({ shareYears: v })} />
          <PctField label="Extra discount on charger hardware" hint="On top of the discount already in the base price" step="1" value={inputs.deal.extraDiscountHardwarePct} onChange={(v) => setDeal({ extraDiscountHardwarePct: v })} />
          <PctField label="Extra discount on electrical and construction" step="1" value={inputs.deal.extraDiscountConstructionPct} onChange={(v) => setDeal({ extraDiscountConstructionPct: v })} />
          <PctField label="Extra discount on service, warranty and network" step="1" value={inputs.deal.extraDiscountServicePct} onChange={(v) => setDeal({ extraDiscountServicePct: v })} />
          <NumField label="Direct capital contribution ($)" hint="Cash or hardware we fund outright" value={inputs.deal.capitalContribution} onChange={(v) => setDeal({ capitalContribution: v })} />
          <NumField label="Minimum acceptable client NPV ($)" hint="Below this the structure is not worth offering" value={inputs.deal.minClientNpv} onChange={(v) => setDeal({ minClientNpv: v })} />
          <NumField label="Minimum return on our capital (×)" hint="Multiple of what we contribute" step="0.5" value={inputs.deal.minReturnMultiple} onChange={(v) => setDeal({ minReturnMultiple: v })} />
          <NumField label="Maximum capital we will contribute ($)" hint="Hard ceiling on our exposure; 0 = none" value={inputs.deal.maxContribution} onChange={(v) => setDeal({ maxContribution: v })} />
        </Grid>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Value of what we give</div>
            <KV
              rows={[
                ["Hardware concession", money(deal.contributions.hardware), `on ${money(ctx.hardwarePrice)} of hardware we provide`],
                ["Sales tax relief on that concession", money(deal.contributions.taxRelief), "tax follows the discounted hardware price"],
                ["Electrical and construction concession", money(deal.contributions.construction), `on ${money(ctx.constructionPrice)}`],
                ["Service, warranty and network concession", money(deal.contributions.service), `on ${money(ctx.servicePrice)}`],
                ["Direct capital contribution", money(deal.contributions.capital)],
                ["Total we contribute", money(deal.contributions.total)],
              ]}
            />
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Revised client position</div>
            <KV
              rows={[
                ["Base customer price / financed amount", money(deal.basePrice)],
                ["Less our contribution", money(-deal.contributions.total)],
                ["Client price", money(deal.clientPrice)],
                ["Client payment per period", financing.offered ? money(deal.clientPayment) : "— no financing"],
                ["Change in payment", financing.offered ? money(deal.paymentChange) : "—", "negative is a saving to the client"],
                ["Base case check", deal.isBaseCase ? "OK — every knob at zero, identical to the cashflow above" : `Structure in force: ${deal.name}`],
              ]}
            />
          </div>
        </div>

        <div className={`${wrapCls} mt-5`}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Year</th>
                <th className={thNum}>Charging profit (base)</th>
                <th className={thNum}>We take</th>
                <th className={thNum}>Client keeps</th>
                <th className={thNum}>Carbon net (base)</th>
                <th className={thNum}>We take</th>
                <th className={thNum}>Client keeps</th>
                <th className={thNum}>Client total</th>
                <th className={thNum}>Our total</th>
                <th className={thNum}>Client cumulative</th>
                <th className={thNum}>Our cumulative</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {deal.years.map((y) => (
                <tr key={y.year}>
                  <td className={td}>{y.year}</td>
                  <td className={tdNum}>{money(y.profitBase)}</td>
                  <td className={tdNum}>{money(y.profitWeTake)}</td>
                  <td className={tdNum}>{money(y.profitClientKeeps)}</td>
                  <td className={tdNum}>{money(y.carbonBase)}</td>
                  <td className={tdNum}>{money(y.carbonWeTake)}</td>
                  <td className={tdNum}>{money(y.carbonClientKeeps)}</td>
                  <td className={`${tdNum} font-medium`}>{money(y.clientTotal)}</td>
                  <td className={`${tdNum} font-medium`}>{money(y.ourTotal)}</td>
                  <td className={tdNum}>{money(y.clientCumulative)}</td>
                  <td className={tdNum}>{money(y.ourCumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className={wrapCls}>
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Outcome</th>
                  <th className={thNum}>Client</th>
                  <th className={thNum}>Zero Impact Energy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {(
                  [
                    ["Capital at risk", money(deal.client.capitalAtRisk), money(deal.ours.capitalAtRisk)],
                    ["Cash received over the horizon", money(deal.client.cashReceived), money(deal.ours.cashReceived)],
                    ["Net position", money(deal.client.netPosition), money(deal.ours.netPosition)],
                    [`NPV at ${pct(inputs.financing.discountRate)}`, money(deal.client.npv), money(deal.ours.npv)],
                    ["IRR", deal.client.irr === null ? "n/a" : pct(deal.client.irr), deal.ours.irr === null ? "n/a — no capital at risk" : pct(deal.ours.irr)],
                    ["Return multiple on our capital", "—", deal.ours.returnMultiple === null ? "n/a" : `${deal.ours.returnMultiple.toFixed(2)}×`],
                    ["Payback", yearsOrNever(deal.client.paybackYears), deal.contributions.total > 0 ? yearsOrNever(deal.ours.paybackYears) : "n/a"],
                    ["Carbon share that makes our contribution break even", "—", deal.breakEvenCarbonShare === null ? "n/a" : pct1(deal.breakEvenCarbonShare)],
                  ] as [string, string, string][]
                ).map(([k, a, b]) => (
                  <tr key={k}>
                    <td className={td}>{k}</td>
                    <td className={tdNum}>{a}</td>
                    <td className={tdNum}>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Guard rails</div>
            <ul className="space-y-2">
              {deal.guardRails.map((g) => (
                <li key={g.label} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                  <span>
                    {g.label}
                    <span className={`block ${noteCls}`}>{g.detail}</span>
                  </span>
                  <Pill ok={g.ok}>{g.ok ? "OK" : "FAILS"}</Pill>
                </li>
              ))}
            </ul>
            <ul className={`mt-3 space-y-1 ${noteCls}`}>
              <li>• A carbon share needs the credit assigned contractually and the aggregator agreement to allow it — confirm before pricing a structure around it.</li>
              <li>• Our IRR is measured on contributed capital only: a small contribution against a long revenue share shows a very high IRR on a small base. Read the multiple and the dollar column alongside it.</li>
              <li>• Handing a line to a third party (Commercial tab) removes its price and its margin; the client still finances it under the whole-project basis.</li>
            </ul>
          </div>
        </div>
      </Section>
    </>
  );
}

/** The whole model, top to bottom — the "Business model" output tab. */
export function BusinessModelTab() {
  const x = useModel();
  if (!x) return <ModelUnavailable />;
  return (
    <div>
      <ModelHeadline />
      <UsageSection />
      <TariffSection />
      <RevenueSection />
      <CarbonSection />
      <FinancingSection />
      <CashflowSection />
      <DealSection />
    </div>
  );
}
