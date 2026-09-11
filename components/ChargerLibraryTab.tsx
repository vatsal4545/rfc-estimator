"use client";

import { useState } from "react";
import type { Category, LoadType, Material } from "@/lib/calc/types";
import { useProject } from "./ProjectContext";
import { Field, Grid, Section, inputCls, selectCls, theadCls } from "./ui";

const BLANK: Omit<LoadType, "id"> = {
  category: "L2",
  voltage: 208,
  phases: 1,
  kwPerPort: 7.7,
  runsPerUnit: 1,
  conductorsPerRun: 2,
  feederOcpdA: 50,
  hasDataCable: true,
  runsAreParallel: false,
};

export function ChargerLibraryTab() {
  const { project, setProject } = useProject();
  const [draft, setDraft] = useState<Omit<LoadType, "id"> & { id: string }>({ id: "", ...BLANK });

  function addLoadType() {
    if (!draft.id.trim()) return;
    if (project.loadTypes.some((l) => l.id === draft.id)) return;
    setProject((p) => ({ ...p, loadTypes: [...p.loadTypes, { ...draft }] }));
    setDraft({ id: "", ...BLANK });
  }

  function removeLoadType(id: string) {
    setProject((p) => ({
      ...p,
      loadTypes: p.loadTypes.filter((l) => l.id !== id),
      takeoff: p.takeoff.filter((r) => r.loadTypeId !== id),
    }));
  }

  return (
    <div>
      <Section
        title="Charger & feeder library"
        subtitle="Every model available on the Takeoff dropdown. Add a charger once and reuse it on every future project."
      >
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className={theadCls}>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">kW/port</th>
                <th className="px-3 py-2">Volts</th>
                <th className="px-3 py-2">Ph</th>
                <th className="px-3 py-2">Runs/unit</th>
                <th className="px-3 py-2">Cond/run</th>
                <th className="px-3 py-2">OCPD (A)</th>
                <th className="px-3 py-2">Design min Cu</th>
                <th className="px-3 py-2">Design min Al</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {project.loadTypes.map((lt) => (
                <tr key={lt.id}>
                  <td className="px-3 py-2 font-medium">{lt.id}</td>
                  <td className="px-3 py-2">{lt.category}</td>
                  <td className="px-3 py-2">{lt.kwPerPort}</td>
                  <td className="px-3 py-2">{lt.voltage}</td>
                  <td className="px-3 py-2">{lt.phases}</td>
                  <td className="px-3 py-2">{lt.runsPerUnit}</td>
                  <td className="px-3 py-2">{lt.conductorsPerRun}</td>
                  <td className="px-3 py-2">{lt.feederOcpdA}</td>
                  <td className="px-3 py-2">{lt.designMinCu ?? "—"}</td>
                  <td className="px-3 py-2">{lt.designMinAl ?? "—"}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => removeLoadType(lt.id)} className="text-zinc-400 hover:text-red-600">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Add a charger or feeder model">
        <Grid cols={4}>
          <Field label="ID / name">
            <input className={inputCls} value={draft.id} onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))} />
          </Field>
          <Field label="Category">
            <select
              className={selectCls}
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as Category }))}
            >
              <option value="L2">L2</option>
              <option value="DCFC">DCFC</option>
              <option value="Feeder">Feeder</option>
            </select>
          </Field>
          <Field label="kW per port">
            <input type="number" className={inputCls} value={draft.kwPerPort} onChange={(e) => setDraft((d) => ({ ...d, kwPerPort: Number(e.target.value) }))} />
          </Field>
          <Field label="Voltage">
            <input type="number" className={inputCls} value={draft.voltage} onChange={(e) => setDraft((d) => ({ ...d, voltage: Number(e.target.value) }))} />
          </Field>
          <Field label="Phases">
            <select className={selectCls} value={draft.phases} onChange={(e) => setDraft((d) => ({ ...d, phases: Number(e.target.value) as 1 | 3 }))}>
              <option value={1}>1</option>
              <option value={3}>3</option>
            </select>
          </Field>
          <Field label="Runs per unit">
            <input type="number" className={inputCls} value={draft.runsPerUnit} onChange={(e) => setDraft((d) => ({ ...d, runsPerUnit: Number(e.target.value) }))} />
          </Field>
          <Field label="Conductors per run">
            <input type="number" className={inputCls} value={draft.conductorsPerRun} onChange={(e) => setDraft((d) => ({ ...d, conductorsPerRun: Number(e.target.value) }))} />
          </Field>
          <Field label="Feeder OCPD (A)" hint="0 = auto: next standard breaker ≥ 125% of input amps">
            <input type="number" className={inputCls} value={draft.feederOcpdA} onChange={(e) => setDraft((d) => ({ ...d, feederOcpdA: Number(e.target.value) }))} />
          </Field>
          <Field label="Input amps per circuit" hint="Optional nameplate override — else computed from kW">
            <input
              type="number"
              className={inputCls}
              value={draft.designAmpsOverride ?? ""}
              placeholder="auto"
              onChange={(e) => setDraft((d) => ({ ...d, designAmpsOverride: e.target.value ? Number(e.target.value) : undefined }))}
            />
          </Field>
          <Field label="Unit input amps" hint="For panel totals when a multi-circuit unit draws less than circuits × amps">
            <input
              type="number"
              className={inputCls}
              value={draft.unitInputAmps ?? ""}
              placeholder="auto"
              onChange={(e) => setDraft((d) => ({ ...d, unitInputAmps: e.target.value ? Number(e.target.value) : undefined }))}
            />
          </Field>
          <Field label="Design min size — Cu" hint="Optional, leave blank to size purely by code">
            <input className={inputCls} value={draft.designMinCu ?? ""} onChange={(e) => setDraft((d) => ({ ...d, designMinCu: e.target.value || undefined }))} />
          </Field>
          <Field label="Design min size — Al">
            <input className={inputCls} value={draft.designMinAl ?? ""} onChange={(e) => setDraft((d) => ({ ...d, designMinAl: e.target.value || undefined }))} />
          </Field>
          <Field label="Material override" hint="Leave blank to follow the Setup toggle">
            <select
              className={selectCls}
              value={draft.materialOverride ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, materialOverride: (e.target.value || undefined) as Material | undefined }))}
            >
              <option value="">Follow Setup</option>
              <option value="Cu">Copper</option>
              <option value="Al">Aluminium</option>
            </select>
          </Field>
          <Field label="Has data cable?">
            <select
              className={selectCls}
              value={draft.hasDataCable ? "Y" : "N"}
              onChange={(e) => setDraft((d) => ({ ...d, hasDataCable: e.target.value === "Y" }))}
            >
              <option value="Y">Yes</option>
              <option value="N">No</option>
            </select>
          </Field>
        </Grid>
        <button
          onClick={addLoadType}
          className="mt-4 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Add to library
        </button>
      </Section>
    </div>
  );
}
