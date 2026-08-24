"use client";

import { useProject } from "./ProjectContext";
import { Field, Grid, Section, inputCls } from "./ui";

export function FinancialsTab() {
  const { project, setProject } = useProject();
  const f = project.financial;

  function update<K extends keyof typeof f>(key: K, value: (typeof f)[K]) {
    setProject((p) => ({ ...p, financial: { ...p.financial, [key]: value } }));
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
