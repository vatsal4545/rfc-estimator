"use client";

import { ADA_UNIT_COST, BOLLARD_RULE, adaStallBreakdown } from "@/lib/calc/autoplan";
import { AUTO_QTY_ITEM } from "@/lib/calc/equipment";
import { CIVIL_RATES, peripheralPriceOverrideCount, resetPeripheralPrices } from "@/lib/calc/peripherals";
import { GEAR_CATALOG } from "@/lib/calc/tables";
import { money, num } from "@/lib/format";
import { utilityCivilFor } from "@/lib/calc/utilityCivil";
import { MaterialRatesSection } from "./MaterialRatesSection";
import { useProject } from "./ProjectContext";
import { Field, Grid, Section, inputCls, selectCls, tableWrapCls, theadCls } from "./ui";

const GEAR_ITEMS = Array.from(new Set(GEAR_CATALOG.map((g) => g.item)));

export function PeripheralsTab() {
  const { project, setProject, result } = useProject();
  const p = project.peripherals;
  const pricesOffShipped = peripheralPriceOverrideCount(p);

  function updateP<K extends keyof typeof p>(key: K, value: (typeof p)[K]) {
    setProject((proj) => ({ ...proj, peripherals: { ...proj.peripherals, [key]: value } }));
  }

  function updateGear(idx: number, patch: Partial<(typeof p.gear)[number]>) {
    setProject((proj) => ({
      ...proj,
      peripherals: {
        ...proj.peripherals,
        gear: proj.peripherals.gear.map((g, i) => (i === idx ? { ...g, ...patch } : g)),
      },
    }));
  }

  function addGear() {
    const first = GEAR_CATALOG[0];
    setProject((proj) => ({
      ...proj,
      peripherals: {
        ...proj.peripherals,
        gear: [...proj.peripherals.gear, { item: first.item, size: first.size, voltage: first.voltage, qty: 0 }],
      },
    }));
  }

  function removeGear(idx: number) {
    setProject((proj) => ({
      ...proj,
      peripherals: { ...proj.peripherals, gear: proj.peripherals.gear.filter((_, i) => i !== idx) },
    }));
  }

  function updateEquip(idx: number, patch: Partial<(typeof project.equipment)[number]>) {
    setProject((proj) => ({
      ...proj,
      equipment: proj.equipment.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    }));
  }

  // "No equipment on this job" in one click, and back again. Excluding keeps
  // every quantity and rate, so the decision is reversible.
  function setAllEquipExcluded(excluded: boolean) {
    setProject((proj) => ({ ...proj, equipment: proj.equipment.map((e) => ({ ...e, excluded })) }));
  }

  function addEquip() {
    setProject((proj) => ({
      ...proj,
      equipment: [
        ...proj.equipment,
        { name: "New rental", qty: 1, rate: 0, rateBasis: "per day", durationValue: 1, delivery: 0 },
      ],
    }));
  }

  function removeEquip(idx: number) {
    setProject((proj) => ({
      ...proj,
      equipment: proj.equipment.filter((_, i) => i !== idx),
    }));
  }

  const customItems = p.customItems ?? [];
  const civilRule = utilityCivilFor(project.setup.utility, result.rollups, (project.intake?.interconnection?.serviceFeederBy ?? "").startsWith("Utility"));
  const civilLines = result.peripherals.lines.civil;
  const concreteLine = civilLines.find((c) => c.name.startsWith("Concrete ("));
  const asphaltLine = civilLines.find((c) => c.name === "Asphalt paving — parking stalls");

  function updateCustom(idx: number, patch: Partial<(typeof customItems)[number]>) {
    updateP(
      "customItems",
      customItems.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    );
  }

  return (
    <div>
      <MaterialRatesSection />
      <Section title="A. Electrical gear" subtitle="Unit cost is looked up from the gear catalog; override if you have a live quote.">
        {p.useAutoGear ? (
          <>
            <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
              Auto gear is ON — the rows below track the Panel schedule live: change charger counts on the
              Takeoff and the switchgear, sub-panel, transformer and breakers re-size and re-price here
              automatically. Force a different size with the pickers on the Panel schedule tab.{" "}
              <button className="font-medium underline" onClick={() => updateP("useAutoGear", false)}>
                Switch to manual gear
              </button>
            </div>
            <div className={tableWrapCls}>
              <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                <thead className={theadCls}>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Voltage</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Catalog cost</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {result.panel.suggestedGear.map((g, idx) => {
                    const catalog = GEAR_CATALOG.find(
                      (c) => c.item === g.item && c.size === g.size && c.voltage === g.voltage,
                    );
                    const unitCost = catalog?.unitCost ?? 0;
                    return (
                      <tr key={idx}>
                        <td className="px-3 py-2">{g.item}</td>
                        <td className="px-3 py-2">{g.size}</td>
                        <td className="px-3 py-2">{g.voltage}</td>
                        <td className="px-3 py-2 text-right">{g.qty}</td>
                        <td className="px-3 py-2 text-right">
                          {unitCost > 0 ? (
                            money(unitCost)
                          ) : (
                            <span className="text-amber-600">no catalog price</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{money(g.qty * unitCost)}</td>
                      </tr>
                    );
                  })}
                  {result.panel.suggestedGear.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">
                        Add chargers on the Takeoff tab — the gear derives from them.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-zinc-50 dark:bg-zinc-900">
                  <tr className="font-medium">
                    <td colSpan={5} className="px-3 py-2 text-right">
                      Gear total (live)
                    </td>
                    <td className="px-3 py-2 text-right">
                      {money(result.peripherals.gearMainSwitchgear + result.peripherals.gearOtherTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <>
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Manual gear — this list is frozen: it does NOT follow charger-count changes on the Takeoff.{" "}
          <button className="font-medium underline" onClick={() => updateP("useAutoGear", true)}>
            Switch to auto gear (re-sizes &amp; re-prices from the Panel schedule)
          </button>
        </div>
        <div className={tableWrapCls}>
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className={theadCls}>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Voltage</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Catalog cost</th>
                <th className="px-3 py-2">Override</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {p.gear.map((g, idx) => {
                const options = GEAR_CATALOG.filter((c) => c.item === g.item);
                const catalog = GEAR_CATALOG.find((c) => c.item === g.item && c.size === g.size && c.voltage === g.voltage);
                const unitCost = g.costOverride ?? catalog?.unitCost ?? 0;
                return (
                  <tr key={idx}>
                    <td className="px-3 py-2">
                      <select
                        className={selectCls}
                        value={g.item}
                        onChange={(e) => {
                          const next = GEAR_CATALOG.find((c) => c.item === e.target.value)!;
                          updateGear(idx, { item: next.item, size: next.size, voltage: next.voltage });
                        }}
                      >
                        {GEAR_ITEMS.map((i) => (
                          <option key={i} value={i}>
                            {i}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={selectCls}
                        value={`${g.size}|${g.voltage}`}
                        onChange={(e) => {
                          const [size, voltage] = e.target.value.split("|");
                          updateGear(idx, { size, voltage });
                        }}
                      >
                        {options.map((o) => (
                          <option key={`${o.size}|${o.voltage}`} value={`${o.size}|${o.voltage}`}>
                            {o.size} / {o.voltage}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">{g.voltage}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        className={`${inputCls} w-16`}
                        value={g.qty}
                        onChange={(e) => updateGear(idx, { qty: Number(e.target.value) })}
                      />
                    </td>
                    <td className="px-3 py-2">{money(catalog?.unitCost ?? 0)}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        className={`${inputCls} w-24`}
                        placeholder="—"
                        value={g.costOverride ?? ""}
                        onChange={(e) => updateGear(idx, { costOverride: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{money(g.qty * unitCost)}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => removeGear(idx)} className="text-zinc-400 hover:text-red-600">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={addGear} className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + Add gear line
        </button>
          </>
        )}
      </Section>

      <Section title="B. Hardware, civil, signage — manual counts" subtitle="Ground rods, anchor bolts, rebar, concrete, signs, striping and wheel stops are auto-derived from the Takeoff counts. Everything below is what you still count by hand.">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
          {pricesOffShipped > 0 ? (
            <>
              <button
                className="font-medium text-blue-600 hover:underline"
                onClick={() => setProject((proj) => ({ ...proj, peripherals: resetPeripheralPrices(proj.peripherals) }))}
              >
                Reset unit prices to the shipped list
              </button>
              <span className="text-zinc-500">
                {pricesOffShipped} price{pricesOffShipped === 1 ? "" : "s"} quoted on this project — quantities and custom
                items are not touched.
              </span>
            </>
          ) : (
            <span className="text-zinc-500">Every unit price below is the shipped rate.</span>
          )}
        </div>
        <Grid cols={4}>
          <Field label="Nuts (ea)"><input type="number" className={inputCls} value={p.nutsQty} onChange={(e) => updateP("nutsQty", Number(e.target.value))} /></Field>
          <Field label="Washers (ea)"><input type="number" className={inputCls} value={p.washersQty} onChange={(e) => updateP("washersQty", Number(e.target.value))} /></Field>
          <Field label="Elbows (ea)"><input type="number" className={inputCls} value={p.elbowsQty} onChange={(e) => updateP("elbowsQty", Number(e.target.value))} /></Field>
          <Field label="Junction boxes (ea)"><input type="number" className={inputCls} value={p.junctionBoxQty} onChange={(e) => updateP("junctionBoxQty", Number(e.target.value))} /></Field>
          <Field label="Data boxes (ea)"><input type="number" className={inputCls} value={p.dataBoxQty} onChange={(e) => updateP("dataBoxQty", Number(e.target.value))} /></Field>
          <Field label="Plywood (ea)"><input type="number" className={inputCls} value={p.plywoodQty} onChange={(e) => updateP("plywoodQty", Number(e.target.value))} /></Field>
          <Field label="2x4 lumber (ea)"><input type="number" className={inputCls} value={p.lumberQty} onChange={(e) => updateP("lumberQty", Number(e.target.value))} /></Field>
          <Field label="Sono tubes (ea)"><input type="number" className={inputCls} value={p.sonoTubesQty} onChange={(e) => updateP("sonoTubesQty", Number(e.target.value))} /></Field>
          <Field label="Christy box (ea)"><input type="number" className={inputCls} value={p.christyBoxQty} onChange={(e) => updateP("christyBoxQty", Number(e.target.value))} /></Field>
          <Field label="GFI test (ea, service > 1000A)"><input type="number" className={inputCls} value={p.gfiTestQty} onChange={(e) => updateP("gfiTestQty", Number(e.target.value))} /></Field>
          <Field
            label="Bollards (ea)"
            hint={`Auto-filled: ${BOLLARD_RULE.perCharger}/charger + ${BOLLARD_RULE.switchgear}-5 at switchgear + ${BOLLARD_RULE.stepDownSubPanel} at step-down TX & sub-panel`}
          ><input type="number" className={inputCls} value={p.bollardsQty} onChange={(e) => updateP("bollardsQty", Number(e.target.value))} /></Field>
          <Field label="Dump / waste ($)" hint="Not in the original workbook — real bids carry this line"><input type="number" className={inputCls} value={p.dumpWasteCost} onChange={(e) => updateP("dumpWasteCost", Number(e.target.value))} /></Field>
          {(p.demolitionItems?.length ?? 0) > 0 && (
            <Field label="Removal and demolition (Existing site tab)" hint="Set on the Existing site tab — priced into the Dump / Waste line">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                {money((p.demolitionItems ?? []).reduce((s, d) => s + d.qty * d.unitCost, 0))}
                <span className="ml-1 text-xs text-zinc-500">· {p.demolitionItems!.length} line(s)</span>
              </div>
            </Field>
          )}
        </Grid>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Ground rods (auto)" value={num(result.rollups.nChargers + result.rollups.nFeeders)} />
          <Stat label="Anchor bolts (auto)" value={num(result.rollups.nDCFC * 6 + result.rollups.nL2 * 4 + result.rollups.nFeeders * 4)} />
          <Stat label="Signs (auto)" value={num(result.rollups.nChargers)} />
          <Stat label="Wheel stops (auto)" value={num(result.rollups.nChargers)} />
        </div>

        <h3 className="mt-6 text-sm font-semibold text-zinc-800 dark:text-zinc-200">Civil rates &amp; quantities</h3>
        <p className="text-xs text-zinc-500">
          Concrete order is auto-sized from the pad volumes (DCFC / L2 / switchgear / step-down pads + bollard
          footings) and rounded up to whole yards; loads under {CIVIL_RATES.shortLoadThresholdYd} yd carry the
          short-load fee. Stall paving assumes {CIVIL_RATES.stallSf} SF per stall (9&times;18). Consumables cover the
          per-pad forming &amp; anchoring kit — wedge anchors, conduit ells, plywood, lumber, nuts &amp; washers.
        </p>
        <Grid cols={4}>
          <Field label="Concrete ($/yd, 2500 PSI)">
            <input type="number" className={inputCls} value={p.concreteUnitCost ?? CIVIL_RATES.concretePerYard} onChange={(e) => updateP("concreteUnitCost", Number(e.target.value))} />
          </Field>
          <Field label="Concrete order (yd)" hint={`Blank = auto (${num(concreteLine?.qty ?? 0)} yd now)`}>
            <input
              type="number"
              className={inputCls}
              placeholder="auto"
              value={p.concreteYardsOverride ?? ""}
              onChange={(e) => updateP("concreteYardsOverride", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Field>
          <Field label="Short-load fee ($)" hint={`Applied when order < ${CIVIL_RATES.shortLoadThresholdYd} yd`}>
            <input type="number" className={inputCls} value={p.concreteShortLoadFee ?? CIVIL_RATES.concreteShortLoadFee} onChange={(e) => updateP("concreteShortLoadFee", Number(e.target.value))} />
          </Field>
          <Field label="Bollard unit cost ($)">
            <input type="number" className={inputCls} value={p.bollardUnitCost ?? CIVIL_RATES.bollardEach} onChange={(e) => updateP("bollardUnitCost", Number(e.target.value))} />
          </Field>
          <Field label="Asphalt paving ($/SF)">
            <input type="number" className={inputCls} value={p.asphaltPerSf ?? CIVIL_RATES.asphaltPerSf} onChange={(e) => updateP("asphaltPerSf", Number(e.target.value))} />
          </Field>
          <Field label="Asphalt area (SF)" hint={`Blank = auto (${num(asphaltLine?.qty ?? 0)} SF now)`}>
            <input
              type="number"
              className={inputCls}
              placeholder="auto"
              value={p.asphaltSfOverride ?? ""}
              onChange={(e) => updateP("asphaltSfOverride", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Field>
          <Field label="Consumables per L2 ($)">
            <input type="number" className={inputCls} value={p.consumablesPerL2 ?? CIVIL_RATES.consumablesPerL2} onChange={(e) => updateP("consumablesPerL2", Number(e.target.value))} />
          </Field>
          <Field label="Consumables per DCFC ($)">
            <input type="number" className={inputCls} value={p.consumablesPerDcfc ?? CIVIL_RATES.consumablesPerDcfc} onChange={(e) => updateP("consumablesPerDcfc", Number(e.target.value))} />
          </Field>
        </Grid>

        <h3 className="mt-6 text-sm font-semibold text-zinc-800 dark:text-zinc-200">Custom line items</h3>
        <p className="text-xs text-zinc-500">
          Site-specific hardware the standard list doesn&apos;t carry — GPR scanning, uni strut, combo locks, form
          stakes, marking supplies…
        </p>
        <div className="mt-2 space-y-2">
          {customItems.map((c, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                className={`${inputCls} w-56`}
                value={c.name}
                onChange={(e) => updateCustom(idx, { name: e.target.value })}
              />
              <input
                type="number"
                className={`${inputCls} w-20`}
                value={c.qty}
                title="Qty"
                onChange={(e) => updateCustom(idx, { qty: Number(e.target.value) })}
              />
              <span className="text-xs text-zinc-500">×</span>
              <input
                type="number"
                className={`${inputCls} w-24`}
                value={c.unitCost}
                title="Unit cost $"
                onChange={(e) => updateCustom(idx, { unitCost: Number(e.target.value) })}
              />
              <span className="w-24 text-right text-sm font-medium">{money(c.qty * c.unitCost)}</span>
              <button
                onClick={() => updateP("customItems", customItems.filter((_, i) => i !== idx))}
                className="text-zinc-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => updateP("customItems", [...customItems, { name: "New item", qty: 1, unitCost: 0 }])}
          className="mt-2 text-sm font-medium text-blue-600 hover:underline"
        >
          + Add custom item
        </button>
      </Section>

      <AdaSection
        p={p}
        updateP={updateP}
        nChargers={result.rollups.nChargers}
        allowance={result.peripherals.adaAllowance}
      />

      <Section
        title="C. Utility substructures & fees"
        subtitle={`${civilRule.label}. ${civilRule.basis} Installed budgets pending the utility's design (${civilRule.source}); Build re-derives them from the utility on the Quick Estimate / 1 · Project tab — pin a typed value on 3 · Electrical to keep it.`}
      >
        <Grid cols={3}>
          <Field label="Plan check & permit fees ($)"><input type="number" className={inputCls} value={p.permitFeeTotal} onChange={(e) => updateP("permitFeeTotal", Number(e.target.value))} /></Field>
          <Field label="Utility application / R16 fees ($)"><input type="number" className={inputCls} value={p.utilityAppFee} onChange={(e) => updateP("utilityAppFee", Number(e.target.value))} /></Field>
          <Field label="Transformer pad ($)" hint="Three-phase precast pad on base rock, installed; utility sets the transformer"><input type="number" className={inputCls} value={p.transformerPadCost} onChange={(e) => updateP("transformerPadCost", Number(e.target.value))} /></Field>
          <Field label="Cable well ($)" hint="Well under the pad (SMUD) or the secondary handhole (SDG&E), installed"><input type="number" className={inputCls} value={p.cableWellCost} onChange={(e) => updateP("cableWellCost", Number(e.target.value))} /></Field>
          <Field label="Pull box qty" hint="Utility pull boxes on the primary / secondary route"><input type="number" className={inputCls} value={p.pullBoxQty} onChange={(e) => updateP("pullBoxQty", Number(e.target.value))} /></Field>
          <Field label="Pull box unit cost ($)" hint="Traffic-rated precast, installed"><input type="number" className={inputCls} value={p.pullBoxUnitCost} onChange={(e) => updateP("pullBoxUnitCost", Number(e.target.value))} /></Field>
          <Field label="Christy box at the point of connection (ea)" hint="Concrete box with traffic lid — a hardware line"><input type="number" className={inputCls} value={p.serviceBoxQty ?? 0} onChange={(e) => updateP("serviceBoxQty", Number(e.target.value))} /></Field>
          <Field label="Christy box unit cost ($)" hint="Installed; default $600"><input type="number" className={inputCls} value={p.serviceBoxUnitCost ?? 600} onChange={(e) => updateP("serviceBoxUnitCost", Number(e.target.value))} /></Field>
          <Field label="Utility sand ($)"><input type="number" className={inputCls} value={p.utilitySandCost} onChange={(e) => updateP("utilitySandCost", Number(e.target.value))} /></Field>
          <Field label="Utility vault qty"><input type="number" className={inputCls} value={p.utilityVaultQty} onChange={(e) => updateP("utilityVaultQty", Number(e.target.value))} /></Field>
          <Field label="Utility vault unit cost ($)"><input type="number" className={inputCls} value={p.utilityVaultUnitCost} onChange={(e) => updateP("utilityVaultUnitCost", Number(e.target.value))} /></Field>
        </Grid>
      </Section>

      <Section title="D. Construction equipment rental" subtitle="One formula on every row: Qty x Rate x Duration + delivery (delivery only charged if Qty > 0). Clear a row's Incl. box to take it out of the estimate without losing what you typed.">
        <div className="mb-2 flex items-center gap-3 text-sm">
          <button
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            onClick={() => setAllEquipExcluded(true)}
          >
            Exclude all
          </button>
          <button
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            onClick={() => setAllEquipExcluded(false)}
          >
            Include all
          </button>
          {result.equipment.items.some((i) => i.excluded) && (
            <span className="text-xs text-zinc-500">
              {result.equipment.items.filter((i) => i.excluded).length} of {result.equipment.items.length} excluded
            </span>
          )}
        </div>
        <div className={tableWrapCls}>
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className={theadCls}>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2" title="Untick to leave this line out of the estimate">Incl.</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Rate</th>
                <th className="px-3 py-2">Basis</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Delivery</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {result.equipment.items.map((item, idx) => (
                <tr key={idx} className={item.excluded ? "opacity-45" : undefined}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-blue-600"
                      checked={!item.excluded}
                      title={item.excluded ? "Excluded — priced at zero" : "Included in the estimate"}
                      onChange={(e) => updateEquip(idx, { excluded: !e.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {item.name === AUTO_QTY_ITEM ? (
                      item.name
                    ) : (
                      <input
                        className={`${inputCls} w-40`}
                        value={item.name}
                        onChange={(e) => updateEquip(idx, { name: e.target.value })}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {item.name === AUTO_QTY_ITEM ? (
                      <span className="text-zinc-500" title="Auto: longest run x 2 + 60, tracks the Takeoff tab">
                        {num(item.qty)} (auto)
                      </span>
                    ) : (
                      <input
                        type="number"
                        className={`${inputCls} w-20`}
                        value={item.qty}
                        onChange={(e) => updateEquip(idx, { qty: Number(e.target.value) })}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className={`${inputCls} w-20`}
                      value={item.rate}
                      onChange={(e) => updateEquip(idx, { rate: Number(e.target.value) })}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{item.rateBasis}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className={`${inputCls} w-16`}
                      value={item.durationValue}
                      onChange={(e) => updateEquip(idx, { durationValue: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className={`${inputCls} w-20`}
                      value={item.delivery}
                      onChange={(e) => updateEquip(idx, { delivery: Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{money(item.total)}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => removeEquip(idx)} className="text-zinc-400 hover:text-red-600" title="Remove rental">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-zinc-50 dark:bg-zinc-900">
              <tr className="font-medium">
                <td colSpan={7} className="px-3 py-2 text-right">
                  Equipment subtotal
                </td>
                <td className="px-3 py-2 text-right">{money(result.equipment.subtotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <button onClick={addEquip} className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + Add rental line
        </button>
      </Section>
    </div>
  );
}

function AdaSection({
  p,
  updateP,
  nChargers,
  allowance,
}: {
  p: import("@/lib/calc/types").PeripheralsInput;
  updateP: <K extends keyof import("@/lib/calc/types").PeripheralsInput>(
    key: K,
    value: import("@/lib/calc/types").PeripheralsInput[K],
  ) => void;
  nChargers: number;
  allowance: number;
}) {
  const code = adaStallBreakdown(nChargers);
  const byType = p.adaVanQty !== undefined || p.adaStdQty !== undefined || p.adaAmbQty !== undefined;

  const qtyField = (
    label: string,
    key: "adaVanQty" | "adaStdQty" | "adaAmbQty",
    required: number,
  ) => (
    <Field label={label} hint={`Code requires ${required} for ${nChargers} chargers`}>
      <input
        type="number"
        className={inputCls}
        placeholder={String(required)}
        value={p[key] ?? ""}
        onChange={(e) => updateP(key, e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </Field>
  );

  return (
    <Section
      title="Accessible EVCS (ADA — CBC 11B-812)"
      subtitle="Per-type stall pricing: van 12ft + 5ft aisle, standard 9ft + 5ft aisle, ambulatory 10ft no aisle (CBC 11B-812). Setting any per-type qty overrides the legacy per-charger allowance. Gotchas: ≤2% slope under every stall, markings must NOT be blue, and accessible EVCS don't count toward regular ADA parking minimums."
    >
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="rounded-md bg-amber-100 px-2 py-1 font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          Code table: {code.van} van + {code.standard} standard + {code.ambulatory} ambulatory
        </span>
        <button
          onClick={() => {
            updateP("adaVanQty", code.van);
            updateP("adaStdQty", code.standard);
            updateP("adaAmbQty", code.ambulatory);
          }}
          className="rounded-md border border-blue-600 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
        >
          Apply code minimums
        </button>
      </div>
      <Grid cols={3}>
        {qtyField("Van-accessible stalls", "adaVanQty", code.van)}
        {qtyField("Standard accessible stalls", "adaStdQty", code.standard)}
        {qtyField("Ambulatory stalls", "adaAmbQty", code.ambulatory)}
        <Field label="Van unit cost ($)">
          <input type="number" className={inputCls} value={p.adaVanUnitCost ?? ADA_UNIT_COST.van} onChange={(e) => updateP("adaVanUnitCost", Number(e.target.value))} />
        </Field>
        <Field label="Standard unit cost ($)">
          <input type="number" className={inputCls} value={p.adaStdUnitCost ?? ADA_UNIT_COST.standard} onChange={(e) => updateP("adaStdUnitCost", Number(e.target.value))} />
        </Field>
        <Field label="Ambulatory unit cost ($)">
          <input type="number" className={inputCls} value={p.adaAmbUnitCost ?? ADA_UNIT_COST.ambulatory} onChange={(e) => updateP("adaAmbUnitCost", Number(e.target.value))} />
        </Field>
        <Field label="ADA ramp ($)" hint="Curb ramp / grade transition, when scoped">
          <input type="number" className={inputCls} value={p.adaRampCost ?? 0} onChange={(e) => updateP("adaRampCost", Number(e.target.value))} />
        </Field>
        {!byType && (
          <>
            <Field label="Legacy: flat stall count" hint={`Blank = 1 per charger (${nChargers} now)`}>
              <input
                type="number"
                className={inputCls}
                placeholder="auto"
                value={p.adaQtyOverride ?? ""}
                onChange={(e) => updateP("adaQtyOverride", e.target.value === "" ? undefined : Number(e.target.value))}
              />
            </Field>
            <Field label="Legacy: flat unit cost ($)">
              <input type="number" className={inputCls} value={p.adaUnitCost ?? 3250} onChange={(e) => updateP("adaUnitCost", Number(e.target.value))} />
            </Field>
          </>
        )}
      </Grid>
      <p className="mt-2 text-sm text-zinc-500">
        ADA line total: <span className="font-semibold">{money(allowance)}</span>
        {byType ? " (per-type pricing)" : " (legacy allowance)"}
      </p>
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}
