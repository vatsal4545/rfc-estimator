"use client";

import { SUBPANEL_208V_A, SWITCHGEAR_480V_A, TRANSFORMER_KVA } from "@/lib/calc/panel";
import type { GearOverrides, Material } from "@/lib/calc/types";
import { money, num } from "@/lib/format";
import { useProject } from "./ProjectContext";
import { SLD } from "./SLD";
import { Field, Grid, Section, inputCls, selectCls } from "./ui";

export function PanelScheduleTab() {
  const { project, setProject, result } = useProject();
  const { panel } = result;
  const chain = project.setup.serviceChain ?? {
    enabled: false,
    material: "Al" as Material,
    utilityToSwitchgearFt: 25,
    switchgearToTransformerFt: 15,
    transformerToSubpanelFt: 15,
  };

  function updateChain(patch: Partial<typeof chain>) {
    setProject((p) => ({
      ...p,
      setup: { ...p.setup, serviceChain: { ...chain, ...patch } },
    }));
  }

  function applySuggestedGear() {
    setProject((p) => ({
      ...p,
      peripherals: { ...p.peripherals, gear: panel.suggestedGear.map((g) => ({ ...g })) },
    }));
  }

  function setGearOverride(patch: Partial<GearOverrides>) {
    setProject((p) => ({
      ...p,
      setup: { ...p.setup, gearOverrides: { ...p.setup.gearOverrides, ...patch } },
    }));
  }

  const hasBranches = panel.branches.length > 0;
  const chainRows = result.rows.filter((r) => r.id.startsWith("chain-"));

  return (
    <div>
      <Section
        title="Service chain — utility transformer to sub-panel"
        subtitle="Sizes every upstream segment automatically (ampacity at 125% continuous + voltage drop, parallel runs picked for you) and adds the wire, ground and conduit to the takeoff and BOM. Enter the three distances from the site plan."
      >
        <div className="mb-3 flex items-center gap-2">
          <input
            id="chain-toggle"
            type="checkbox"
            checked={chain.enabled}
            onChange={(e) => updateChain({ enabled: e.target.checked })}
            className="h-4 w-4"
          />
          <label htmlFor="chain-toggle" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Auto-generate service &amp; feeder runs
          </label>
        </div>
        {chain.enabled && (
          <>
            <Grid cols={4}>
              <Field label="Utility TX → Switchgear (ft)">
                <input
                  type="number"
                  className={inputCls}
                  value={chain.utilityToSwitchgearFt}
                  onChange={(e) => updateChain({ utilityToSwitchgearFt: Number(e.target.value) })}
                />
              </Field>
              <Field label="Switchgear → Step-down TX (ft)" hint="Used only when 208V L2 load exists">
                <input
                  type="number"
                  className={inputCls}
                  value={chain.switchgearToTransformerFt}
                  onChange={(e) => updateChain({ switchgearToTransformerFt: Number(e.target.value) })}
                />
              </Field>
              <Field label="Step-down TX → Sub-panel (ft)">
                <input
                  type="number"
                  className={inputCls}
                  value={chain.transformerToSubpanelFt}
                  onChange={(e) => updateChain({ transformerToSubpanelFt: Number(e.target.value) })}
                />
              </Field>
              <Field label="Feeder material">
                <select
                  className={selectCls}
                  value={chain.material}
                  onChange={(e) => updateChain({ material: e.target.value as Material })}
                >
                  <option value="Al">Aluminium</option>
                  <option value="Cu">Copper</option>
                </select>
              </Field>
            </Grid>
            {chainRows.length > 0 && (
              <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  <thead className="bg-zinc-50 dark:bg-zinc-900">
                    <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                      <th className="px-3 py-2">Segment</th>
                      <th className="px-3 py-2 text-right">Load (A)</th>
                      <th className="px-3 py-2 text-right">Dist (ft)</th>
                      <th className="px-3 py-2">Conductors</th>
                      <th className="px-3 py-2">Ground</th>
                      <th className="px-3 py-2">Conduit</th>
                      <th className="px-3 py-2 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {chainRows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2">{r.location}</td>
                        <td className="px-3 py-2 text-right">{num(r.designAmps, 1)}</td>
                        <td className="px-3 py-2 text-right">{num(r.oneWayDistFt)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.resolvedRunsPerUnit} × {r.selectedWire} {r.material}
                        </td>
                        <td className="px-3 py-2">{r.groundSize}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.resolvedRunsPerUnit} × {r.conduitSize}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{money(r.rowTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Single-line diagram" subtitle="Derived live from the takeoff, panel schedule and service chain.">
        <SLD result={result} />
      </Section>
      <Section
        title="Branch circuits"
        subtitle="One line per takeoff row. Every EVSE load is continuous, so each breaker is at least 125% of the circuit's input current (NEC 625.41/625.42)."
      >
        {hasBranches ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Load type</th>
                  <th className="px-3 py-2 text-right">Circuits</th>
                  <th className="px-3 py-2 text-right">Amps / circuit</th>
                  <th className="px-3 py-2">Breaker</th>
                  <th className="px-3 py-2">Wire</th>
                  <th className="px-3 py-2">Conduit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {panel.branches.map((b, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{b.location}</td>
                    <td className="px-3 py-2">{b.loadTypeId}</td>
                    <td className="px-3 py-2 text-right">{b.circuits}</td>
                    <td className="px-3 py-2 text-right">{num(b.ampsPerCircuit, 1)} A</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {b.breakerA} A / {b.poles}P @ {b.voltage}V
                    </td>
                    <td className="px-3 py-2">{b.wire || "—"}</td>
                    <td className="px-3 py-2">{b.conduit || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No chargers on the Takeoff tab yet.</p>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {panel.bus480 && (
          <BusCard
            title="480V switchgear"
            lines={[
              ["Circuits", `${panel.bus480.circuitCount}`],
              ["Connected", `${num(panel.bus480.connectedAmps, 1)} A`],
              ["Demand ×125%", `${num(panel.bus480.demandAmps, 1)} A`],
            ]}
            highlight={`${panel.bus480.suggestedBusA} A bus${panel.bus480.overridden ? " (manual)" : ""}`}
            override={{
              value: project.setup.gearOverrides?.switchgear480A,
              autoLabel: `auto — ${panel.bus480.autoBusA} A`,
              options: SWITCHGEAR_480V_A,
              unit: "A",
              onChange: (v) => setGearOverride({ switchgear480A: v }),
            }}
          />
        )}
        {panel.bus208 && (
          <BusCard
            title="208V panel (L2)"
            lines={[
              ["Circuits", `${panel.bus208.circuitCount}`],
              ["Connected", `${num(panel.bus208.connectedAmps, 1)} A`],
              ["Demand ×125%", `${num(panel.bus208.demandAmps, 1)} A`],
            ]}
            highlight={`${panel.bus208.suggestedBusA} A bus${panel.bus208.overridden ? " (manual)" : ""}`}
            override={{
              value: project.setup.gearOverrides?.subpanel208A,
              autoLabel: `auto — ${panel.bus208.autoBusA} A`,
              options: SUBPANEL_208V_A,
              unit: "A",
              onChange: (v) => setGearOverride({ subpanel208A: v }),
            }}
          />
        )}
        {panel.transformer && (
          <BusCard
            title="Step-down transformer 480→208V"
            lines={[
              ["Connected", `${num(panel.transformer.connectedKva, 1)} kVA`],
              ["Demand ×125%", `${num(panel.transformer.demandKva, 1)} kVA`],
              ["Primary breaker", `${panel.transformer.primaryBreakerA} A @ 480V`],
            ]}
            highlight={`${panel.transformer.suggestedKva} kVA${panel.transformer.overridden ? " (manual)" : ""}`}
            override={{
              value: project.setup.gearOverrides?.transformerKva,
              autoLabel: `auto — ${panel.transformer.autoKva} kVA`,
              options: TRANSFORMER_KVA,
              unit: "kVA",
              onChange: (v) => setGearOverride({ transformerKva: v }),
            }}
          />
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Overrides cascade: the service-chain conductors, primary breaker and gear pricing all re-derive
        from the size you pick. Sizes below the ×125% demand get flagged in the notes above.
      </p>

      <div className="mt-4" />
      <Section
        title="Suggested gear"
        subtitle="Derived from the buses above, on catalog sizes so it prices automatically. Apply replaces the gear list on the Peripherals tab."
      >
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Voltage</th>
                <th className="px-3 py-2 text-right">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {panel.suggestedGear.map((g, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">{g.item}</td>
                  <td className="px-3 py-2">{g.size}</td>
                  <td className="px-3 py-2">{g.voltage}</td>
                  <td className="px-3 py-2 text-right">{g.qty}</td>
                </tr>
              ))}
              {panel.suggestedGear.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                    Add chargers on the Takeoff tab to build the one-line.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {panel.notes.length > 0 && (
          <ul className="mt-3 space-y-1">
            {panel.notes.map((n, i) => (
              <li key={i} className="text-sm text-amber-700 dark:text-amber-400">
                ⚠ {n}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={project.peripherals.useAutoGear ?? false}
              onChange={(e) =>
                setProject((p) => ({ ...p, peripherals: { ...p.peripherals, useAutoGear: e.target.checked } }))
              }
            />
            Auto-cost this gear in the estimate (transformer, sub-panel, breakers included live)
          </label>
          <button
            onClick={applySuggestedGear}
            disabled={panel.suggestedGear.length === 0 || (project.peripherals.useAutoGear ?? false)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Copy to Peripherals for manual editing
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Gear currently priced in the estimate: {money(result.peripherals.gearMainSwitchgear + result.peripherals.gearOtherTotal)}
          {project.peripherals.useAutoGear ? " (auto, from this panel schedule)" : " (manual list on the Peripherals tab)"}.
        </p>
      </Section>
    </div>
  );
}

interface BusOverride {
  value: number | undefined;
  autoLabel: string;
  options: number[];
  unit: string;
  onChange: (v: number | undefined) => void;
}

function BusCard({
  title,
  lines,
  highlight,
  override,
}: {
  title: string;
  lines: [string, string][];
  highlight: string;
  override?: BusOverride;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase text-zinc-500">{title}</div>
      <div className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{highlight}</div>
      <dl className="mt-2 space-y-1 text-sm">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {override && (
        <label className="mt-3 block text-xs text-zinc-500">
          Size
          <select
            className={`${selectCls} mt-1`}
            value={override.value ?? ""}
            onChange={(e) => override.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          >
            <option value="">{override.autoLabel}</option>
            {override.options.map((o) => (
              <option key={o} value={o}>
                {o} {override.unit}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
