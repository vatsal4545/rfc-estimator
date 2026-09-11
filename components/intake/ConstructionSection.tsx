"use client";

import { tableWrapCls, theadCls } from "../ui";
import { GPR_ITEM_NAME } from "@/lib/calc/autoplan";
import { SITE_WORKS_LINES } from "@/lib/calc/costs";
import { AUTO_QTY_ITEM } from "@/lib/calc/equipment";
import type { EquipmentRentalItem } from "@/lib/calc/types";
import { money, num, pct } from "@/lib/format";
import type { StickyPath } from "@/lib/intake/rebuild";
import { defaultCommercial } from "@/lib/proposal/defaults";
import type { CommercialInput } from "@/lib/proposal/types";
import { useProject } from "../ProjectContext";
import { Field, Grid, Pill, Section, inputCls } from "../ui";
import { useRebuild } from "./useRebuild";

// 4 · Construction — the intake's Construction tab over the estimator's
// fields: labour, site-works quantities, design and engineering, rentals,
// markups and pass-through fees. Quantities the engine derives show as
// "auto"; typing one pins it so the next rebuild leaves it alone.

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap";
const thNum = `${th} text-right`;
const td = "px-3 py-1.5 whitespace-nowrap";
const tdNum = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
const wrap = tableWrapCls;
const table = "min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800";
const readonlyCls = "rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm tabular-nums dark:border-zinc-800 dark:bg-zinc-900";

function AutoPill({ typed }: { typed: boolean }) {
  return (
    <span
      title={typed ? "Typed by hand — survives rebuilds" : "Derived by the estimator — follows the equipment"}
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${typed ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}
    >
      {typed ? "typed" : "auto"}
    </span>
  );
}

/** A number the estimator derives: type to pin it, “→ auto” to hand it back. */
function PinnedNumber({ label, hint, path, value, step }: { label: string; hint?: string; path: StickyPath; value: number; step?: string }) {
  const { pin, unpin, pinned } = useRebuild();
  const typed = pinned(path);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input type="number" step={step ?? "any"} className={inputCls} value={value} onChange={(e) => pin(path, Number(e.target.value))} />
        <AutoPill typed={typed} />
        {typed && (
          <button className="whitespace-nowrap text-xs font-medium text-blue-600 hover:underline" onClick={() => unpin(path)}>
            → auto
          </button>
        )}
      </div>
    </Field>
  );
}

export function ConstructionSection() {
  const { project, setProject, result } = useProject();
  const { pin, unpin, pinned } = useRebuild();
  const f = project.financial;
  const per = project.peripherals;
  const c = project.commercial;
  const costs = result.costs;

  function setFinancial<K extends keyof typeof f>(key: K, value: (typeof f)[K]) {
    setProject((p) => ({ ...p, financial: { ...p.financial, [key]: value } }));
  }
  function setPeripherals<K extends keyof typeof per>(key: K, value: (typeof per)[K]) {
    setProject((p) => ({ ...p, peripherals: { ...p.peripherals, [key]: value } }));
  }
  function setCommercial<K extends keyof CommercialInput>(key: K, value: CommercialInput[K]) {
    setProject((p) => ({ ...p, commercial: { ...(p.commercial ?? defaultCommercial()), [key]: value } }));
  }

  const civil = result.peripherals.lines.civil;
  const signage = result.peripherals.lines.signage;
  const qtyOf = (list: { name: string; qty: number }[], pred: (n: string) => boolean) => list.filter((l) => pred(l.name)).reduce((t, l) => t + l.qty, 0);
  const concreteAuto = qtyOf(civil, (n) => n.startsWith("Concrete ("));
  const asphaltAuto = qtyOf(civil, (n) => n === "Asphalt paving — parking stalls");
  const gpr = (per.customItems ?? []).find((i) => i.name === GPR_ITEM_NAME)?.qty ?? 0;
  const siteWorksBase = costs.lines.filter((l) => (SITE_WORKS_LINES as string[]).includes(l.name)).reduce((t, l) => t + l.base, 0);
  const rentalsPinned = pinned("equipment");
  const passThrough = per.permitFeeTotal + f.planCheckPermitFee + per.utilityAppFee + (c?.utilityInterconnectFee ?? 0) + (c?.lineExtensionContribution ?? 0);

  const setRental = (idx: number, patch: Partial<EquipmentRentalItem>) => pin("equipment", project.equipment.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  return (
    <div>
      <Section title="4 · Construction — labour" subtitle="Crew days come from the takeoff and the terrain; the CEO basis is $2,750 a day, fully burdened, contingency on top, construction PM as 15% of the loaded labour. Type over a derived value to pin it.">
        <Grid cols={4}>
          <PinnedNumber label="Crew days on site" hint="Estimator schedule from the takeoff — must match the schedule you publish" path="financial.laborBusinessDays" value={f.laborBusinessDays} step="1" />
          <Field label="Crew day rate ($)" hint="Fully burdened — intake 2.9.0: $2,750">
            <input type="number" className={inputCls} value={f.laborDailyRate} onChange={(e) => setFinancial("laborDailyRate", Number(e.target.value))} />
          </Field>
          <Field label="Contingency" hint="Every construction line; decimals (0.10 = 10%)">
            <input type="number" step="0.01" className={inputCls} value={f.contingencyPct} onChange={(e) => setFinancial("contingencyPct", Number(e.target.value))} />
          </Field>
          <Field label="Markup on labour" hint="Commercial terms — after contingency (intake: 0.20)">
            <input type="number" step="0.01" className={inputCls} value={c?.markupLaborPct ?? 0.2} disabled={!c} onChange={(e) => setCommercial("markupLaborPct", Number(e.target.value))} />
          </Field>
          <PinnedNumber label="Construction PM as % of labour" hint={`CEO basis 0.15 · currently ${money(costs.constructionPm)}`} path="financial.pmPctOfLabor" value={f.pmPctOfLabor ?? 0} step="0.01" />
          <Field label="Labour cost" hint={`${num(f.laborBusinessDays)} days × ${money(f.laborDailyRate)}${(f.applyContingencyToLabor ?? true) ? ` × ${1 + f.contingencyPct}` : ""}`}>
            <div className={readonlyCls}>{money(costs.labor)}</div>
          </Field>
          <Field label="Labour + PM, before markup">
            <div className={readonlyCls}>{money(costs.labor + costs.constructionPm)}</div>
          </Field>
        </Grid>
      </Section>

      <Section title="Site works — quantities" subtitle="What the estimate derived from the chargers and the dig. Blank concrete and asphalt fields mean the engine's own order; every other quantity shows whether it is the engine's or yours. The intake's Construction rows 14–27 receive these; the money travels through the override register.">
        <Grid cols={4}>
          <Field label="Concrete (yd³)" hint={`Blank = auto (${num(concreteAuto)} yd now)`}>
            <input type="number" className={inputCls} placeholder="auto" value={per.concreteYardsOverride ?? ""} onChange={(e) => setPeripherals("concreteYardsOverride", e.target.value === "" ? undefined : Number(e.target.value))} />
          </Field>
          <Field label="Asphalt / paving (sq ft)" hint={`Blank = auto (${num(asphaltAuto)} SF now)`}>
            <input type="number" className={inputCls} placeholder="auto" value={per.asphaltSfOverride ?? ""} onChange={(e) => setPeripherals("asphaltSfOverride", e.target.value === "" ? undefined : Number(e.target.value))} />
          </Field>
          <PinnedNumber label="Bollards (ea)" hint="2 per charger + 4 at switchgear + 3 at the step-down" path="peripherals.bollardsQty" value={per.bollardsQty} step="1" />
          <PinnedNumber label="Dump / disposal ($)" hint="Terrain-scaled spoils haul-off; removal scope adds to it" path="peripherals.dumpWasteCost" value={per.dumpWasteCost} />
          <PinnedNumber label="ADA van stalls (ea)" hint="CBC 11B-812, per charging level" path="peripherals.adaVanQty" value={per.adaVanQty ?? 0} step="1" />
          <PinnedNumber label="ADA standard stalls (ea)" path="peripherals.adaStdQty" value={per.adaStdQty ?? 0} step="1" />
          <PinnedNumber label="ADA ambulatory stalls (ea)" path="peripherals.adaAmbQty" value={per.adaAmbQty ?? 0} step="1" />
          <PinnedNumber label="ADA ramp ($)" hint="0 = no ramp" path="peripherals.adaRampCost" value={per.adaRampCost ?? 0} />
          <PinnedNumber label="GPR scan (days)" hint="Private utility locating along the trench route" path="peripherals.gpr" value={gpr} step="1" />
          <PinnedNumber label="GFI test (ea)" hint="Service above 1,000 A" path="peripherals.gfiTestQty" value={per.gfiTestQty} step="1" />
        </Grid>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <Derived label="Rebar (auto)" value={num(qtyOf(civil, (n) => n === "Rebar"))} />
          <Derived label="Striping (auto)" value={qtyOf(signage, (n) => n === "Striping") > 0 ? "1 lot" : "—"} />
          <Derived label="Signs / posts (auto)" value={`${num(qtyOf(signage, (n) => n === "Signs"))} / ${num(qtyOf(signage, (n) => n === "Sign posts"))}`} />
          <Derived label="Wheel stops (auto)" value={num(qtyOf(civil, (n) => n === "Wheel stops"))} />
          <Derived label="Site works, before uplift" value={money(siteWorksBase)} />
        </div>
      </Section>

      <Section title="Design and engineering" subtitle="The estimator prices design as fees (market-rate formulas at Build); the intake carries drawing sets and PM hours at its own rates. Your total travels as override row 16, plan check as a pass-through fee.">
        <Grid cols={4}>
          <PinnedNumber label="Site plan design — AutoCAD ($)" path="financial.autoCadDesignCost" value={f.autoCadDesignCost} />
          <PinnedNumber label="Electrical engineering — SLD ($)" path="financial.electricalEngDesignCost" value={f.electricalEngDesignCost} />
          <PinnedNumber label="Project management (hours)" hint="Design and permitting PM — a manual entry" path="financial.pmHours" value={f.pmHours} step="1" />
          <Field label="PM hourly rate ($)" hint="Intake: $358">
            <input type="number" className={inputCls} value={f.pmHourlyRate} onChange={(e) => setFinancial("pmHourlyRate", Number(e.target.value))} />
          </Field>
          <PinnedNumber label="Plan check fee ($)" hint="AHJ, valuation-based on DC sites — pass-through" path="financial.planCheckPermitFee" value={f.planCheckPermitFee} />
          <Field label="Design and engineering total" hint="before plan check — what the override register carries">
            <div className={readonlyCls}>{money(costs.designAndEngineering)}</div>
          </Field>
        </Grid>
      </Section>

      <Section title="Equipment rentals" subtitle="The standard build's rental list with the estimator's durations. Edit any cell and the list is pinned as a whole; “→ auto” hands it back to the engine.">
        <div className="mb-2 flex items-center gap-2 text-xs">
          <AutoPill typed={rentalsPinned} />
          {rentalsPinned && (
            <button className="font-medium text-blue-600 hover:underline" onClick={() => unpin("equipment")}>
              → auto
            </button>
          )}
        </div>
        <div className={wrap}>
          <table className={table}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Rental</th>
                <th className={thNum}>Qty</th>
                <th className={thNum}>Rate</th>
                <th className={th}>Basis</th>
                <th className={thNum}>Duration</th>
                <th className={thNum}>Delivery</th>
                <th className={thNum}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {result.equipment.items.map((item, idx) => (
                <tr key={`${item.name}-${idx}`} className={item.qty > 0 ? "" : "text-zinc-400"}>
                  <td className={td}>{item.name}</td>
                  <td className={tdNum}>
                    {item.name === AUTO_QTY_ITEM ? (
                      <span title="Follows the open trench: longest run × 2 + 60 ft">{num(item.qty)} ft (auto)</span>
                    ) : (
                      <input type="number" className={`${inputCls} w-20 py-1 text-right`} value={item.qty} onChange={(e) => setRental(idx, { qty: Number(e.target.value) })} />
                    )}
                  </td>
                  <td className={tdNum}>
                    <input type="number" className={`${inputCls} w-24 py-1 text-right`} value={item.rate} onChange={(e) => setRental(idx, { rate: Number(e.target.value) })} />
                  </td>
                  <td className={`${td} text-zinc-500`}>{item.rateBasis}</td>
                  <td className={tdNum}>
                    <input type="number" className={`${inputCls} w-20 py-1 text-right`} value={item.durationValue} onChange={(e) => setRental(idx, { durationValue: Number(e.target.value) })} />
                  </td>
                  <td className={tdNum}>
                    <input type="number" className={`${inputCls} w-24 py-1 text-right`} value={item.delivery} onChange={(e) => setRental(idx, { delivery: Number(e.target.value) })} />
                  </td>
                  <td className={`${tdNum} font-medium`}>{money(item.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-zinc-50 font-medium dark:bg-zinc-900">
              <tr>
                <td className={td} colSpan={6}>
                  Rentals, before uplift
                </td>
                <td className={tdNum}>{money(result.equipment.subtotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section title="Markups and pass-through fees" subtitle="Materials carry the materials markup; permits, utility fees and the interconnection design fee pass through at exactly cost — no contingency, markup or discount.">
        <Grid cols={4}>
          <Field label="Markup on materials" hint="Commercial terms — switchgear, conductor, conduit, site works, rentals (intake: 0.20)">
            <input type="number" step="0.01" className={inputCls} value={c?.markupMaterialsPct ?? 0.2} disabled={!c} onChange={(e) => setCommercial("markupMaterialsPct", Number(e.target.value))} />
          </Field>
          <PinnedNumber label="Permit issuance ($)" hint="AHJ permit fees; plan check is on the design block" path="peripherals.permitFeeTotal" value={per.permitFeeTotal} />
          <PinnedNumber label="Utility application / contract fees ($)" path="peripherals.utilityAppFee" value={per.utilityAppFee} />
          <Field label="Utility interconnection design fee ($)" hint="Rule 29 design fee where the utility charges one">
            <input type="number" className={inputCls} value={c?.utilityInterconnectFee ?? 0} disabled={!c} onChange={(e) => setCommercial("utilityInterconnectFee", Number(e.target.value))} />
          </Field>
          <Field label="Line-extension contribution ($)" hint="Rules 15/16, only when the utility design requires it; blank = excluded by name">
            <input
              type="number"
              className={inputCls}
              value={c?.lineExtensionContribution ?? ""}
              disabled={!c}
              onChange={(e) => setCommercial("lineExtensionContribution", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Field>
          <Field label="Additional or unforeseen scope ($)" hint="Anything the standard build does not cover">
            <input type="number" className={inputCls} value={c?.additionalScope ?? 0} disabled={!c} onChange={(e) => setCommercial("additionalScope", Number(e.target.value))} />
          </Field>
          <Field label="Pass-through total" hint="permits + plan check + utility + interconnection + line extension">
            <div className={readonlyCls}>{money(passThrough)}</div>
          </Field>
          <Field label="Total Cost (estimator)" hint="unchanged by anything on the proposal side">
            <div className={readonlyCls}>{money(costs.totalCost)}</div>
          </Field>
        </Grid>
        <div className="mt-3 text-xs text-zinc-500">
          Contingency {pct(f.contingencyPct)} · labour markup {c ? pct(c.markupLaborPct) : "—"} · materials markup {c ? pct(c.markupMaterialsPct) : "—"}
          {!c && " · set up pricing on 5 · Commercial to edit the markups"}
        </div>
      </Section>
      <div className="hidden">
        <Pill ok>{num(0)}</Pill>
      </div>
    </div>
  );
}

function Derived({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-medium text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}
