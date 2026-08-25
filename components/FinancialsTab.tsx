"use client";

import { laborBreakdown } from "@/lib/calc/costs";
import type { LaborItem } from "@/lib/calc/types";
import { money } from "@/lib/format";
import { newId } from "@/lib/id";
import { useProject } from "./ProjectContext";
import { Field, Grid, Section, inputCls } from "./ui";

export function FinancialsTab() {
  const { project, setProject } = useProject();
  const f = project.financial;

  function update<K extends keyof typeof f>(key: K, value: (typeof f)[K]) {
    setProject((p) => ({ ...p, financial: { ...p.financial, [key]: value } }));
  }

  const breakdown = laborBreakdown(f);
  const laborContingency = (f.applyContingencyToLabor ?? true) ? f.contingencyPct : 0;

  function updateLaborItem(id: string, patch: Partial<LaborItem>) {
    update("laborItems", (f.laborItems ?? []).map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function addLaborItem() {
    // Seed the table from the current simple rate x days so switching to
    // itemized mode starts from the number already on the estimate.
    const seed: LaborItem[] = f.laborItems?.length
      ? f.laborItems
      : [{ id: newId("lb"), name: "Electrical crew", days: f.laborBusinessDays, dailyRate: f.laborDailyRate }];
    update("laborItems", [...seed, { id: newId("lb"), name: "", days: f.laborBusinessDays, dailyRate: 0 }]);
  }
  function removeLaborItem(id: string) {
    const next = (f.laborItems ?? []).filter((it) => it.id !== id);
    update("laborItems", next.length > 0 ? next : undefined);
  }

  return (
    <div>
      <Section title="Contingency, labor & tax">
        <Grid cols={3}>
          <Field label="Contingency %" hint="Applied to every construction cost line">
            <input type="number" step="0.01" className={inputCls} value={f.contingencyPct} onChange={(e) => update("contingencyPct", Number(e.target.value))} />
          </Field>
          <Field label="Labor — daily rate ($)">
            <input type="number" className={inputCls} value={f.laborDailyRate} onChange={(e) => update("laborDailyRate", Number(e.target.value))} />
          </Field>
          <Field label="Labor — business days">
            <input type="number" className={inputCls} value={f.laborBusinessDays} onChange={(e) => update("laborBusinessDays", Number(e.target.value))} />
          </Field>
          <Field label="Sales tax %" hint="Applied to the fully-loaded construction subtotal">
            <input type="number" step="0.001" className={inputCls} value={f.salesTaxPct} onChange={(e) => update("salesTaxPct", Number(e.target.value))} />
          </Field>
        </Grid>
        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={f.applyContingencyToLabor ?? true}
            onChange={(e) => update("applyContingencyToLabor", e.target.checked)}
          />
          Apply contingency to the labor rate (both source workbooks do: $2,250 → $2,475/day)
        </label>

        {/* Itemized labor: optional roles/phases table. When rows exist they
            replace rate × days as the labor cost; business days above stays
            the schedule length (equipment rental days, timeline). */}
        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Labor breakdown</div>
            <button onClick={addLaborItem} className="rounded-md border border-blue-600 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950">
              + Add line
            </button>
          </div>
          {breakdown.itemized ? (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                <thead className="bg-zinc-50 dark:bg-zinc-900">
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    <th className="px-3 py-2">Role / phase</th>
                    <th className="px-3 py-2">Days</th>
                    <th className="px-3 py-2">$ / day</th>
                    <th className="px-3 py-2 text-right">Line total</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {breakdown.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2">
                        <input className={`${inputCls} w-56`} value={it.name} placeholder="e.g. Foreman, 2-man crew, flagger" onChange={(e) => updateLaborItem(it.id, { name: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" className={`${inputCls} w-20`} value={it.days} onChange={(e) => updateLaborItem(it.id, { days: Number(e.target.value) })} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" className={`${inputCls} w-28`} value={it.dailyRate} onChange={(e) => updateLaborItem(it.id, { dailyRate: Number(e.target.value) })} />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{money(it.days * it.dailyRate)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => removeLaborItem(it.id)} className="text-zinc-400 hover:text-red-600" title="Remove line">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-zinc-50 dark:bg-zinc-900">
                  <tr className="font-medium">
                    <td colSpan={3} className="px-3 py-2 text-right">
                      Labor base {laborContingency > 0 ? `· +${Math.round(laborContingency * 100)}% contingency → ${money(breakdown.base * (1 + laborContingency))}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right">{money(breakdown.base)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="text-xs text-zinc-500">
              Using the simple model above: {money(f.laborDailyRate)}/day × {f.laborBusinessDays} days ={" "}
              {money(breakdown.base)}
              {laborContingency > 0 ? ` (+${Math.round(laborContingency * 100)}% contingency → ${money(breakdown.base * (1 + laborContingency))})` : ""}. Click
              “+ Add line” to itemize by role or phase — itemized lines replace rate × days; business days stays the
              schedule length for equipment rentals and the timeline.
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Equipment Purchase Invoice"
        subtitle="Charger hardware and financing line items. The original workbook read two empty cells here and silently dropped this whole section from Total Cost — it's wired in below."
      >
        <Grid cols={3}>
          <Field label="Charger hardware cost ($)">
            <input type="number" className={inputCls} value={f.chargerHardwareCost} onChange={(e) => update("chargerHardwareCost", Number(e.target.value))} />
          </Field>
          <Field label="Warranty ($)">
            <input type="number" className={inputCls} value={f.chargerWarrantyCost} onChange={(e) => update("chargerWarrantyCost", Number(e.target.value))} />
          </Field>
          <Field label="EVOLV / commissioning ($)">
            <input type="number" className={inputCls} value={f.evolvCommissioningCost} onChange={(e) => update("evolvCommissioningCost", Number(e.target.value))} />
          </Field>
          <Field label="5-year service agreement ($)">
            <input type="number" className={inputCls} value={f.fiveYearServiceCost} onChange={(e) => update("fiveYearServiceCost", Number(e.target.value))} />
          </Field>
        </Grid>
      </Section>

      <Section
        title="Design Invoice"
        subtitle="The Quick Estimate tab fills these from market-rate formulas — override any of them with real quotes."
      >
        <Grid cols={4}>
          <Field label="Site plan design — AutoCAD ($)" hint="Parking layout, ADA stalls, equipment placement">
            <input type="number" className={inputCls} value={f.autoCadDesignCost} onChange={(e) => update("autoCadDesignCost", Number(e.target.value))} />
          </Field>
          <Field label="SLD / electrical engineering design ($)" hint="PE-stamped single-line, load calcs, panel schedule">
            <input type="number" className={inputCls} value={f.electricalEngDesignCost} onChange={(e) => update("electricalEngDesignCost", Number(e.target.value))} />
          </Field>
          <Field label="Construction PM hours (CPM)">
            <input type="number" className={inputCls} value={f.pmHours} onChange={(e) => update("pmHours", Number(e.target.value))} />
          </Field>
          <Field label="PM hourly rate ($)">
            <input type="number" className={inputCls} value={f.pmHourlyRate} onChange={(e) => update("pmHourlyRate", Number(e.target.value))} />
          </Field>
          <Field label="Plan check / permit fee, financed ($)" hint="Separate from the internal permits line on the Peripherals tab">
            <input type="number" className={inputCls} value={f.planCheckPermitFee} onChange={(e) => update("planCheckPermitFee", Number(e.target.value))} />
          </Field>
        </Grid>
      </Section>
    </div>
  );
}
