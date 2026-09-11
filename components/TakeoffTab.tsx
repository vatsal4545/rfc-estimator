"use client";

import { useState } from "react";
import { generateTakeoffRows, type QuickLine } from "@/lib/calc/quickstart";
import { WIRE_TABLE } from "@/lib/calc/tables";
import type { Project, TakeoffEdit, TakeoffRowInput } from "@/lib/calc/types";
import { canRebuild, rebuildProject } from "@/lib/intake/rebuild";
import { newId } from "@/lib/id";
import { money, num } from "@/lib/format";
import { useProject } from "./ProjectContext";
import { FlagBadge, inputCls, selectCls } from "./ui";

function QuickGenerate({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { project, setProject } = useProject();
  const [lines, setLines] = useState<QuickLine[]>([
    { loadTypeId: project.loadTypes[0]?.id ?? "", count: 1 },
  ]);
  const [startFt, setStartFt] = useState(100);
  const [stepFt, setStepFt] = useState(15);

  const totalChargers = lines.reduce((s, l) => s + (l.count > 0 ? l.count : 0), 0);

  function generate(mode: "replace" | "append") {
    const rows = generateTakeoffRows(lines, { startFt, stepFt }, newId("qs"));
    setProject((p) => ({
      ...p,
      takeoff: mode === "replace" ? rows : [...p.takeoff, ...rows],
      // Quick generate means "automate everything": turn on the service chain
      // (utility TX -> switchgear -> step-down TX -> sub-panel) and auto gear
      // costing so the transformer, sub-panel and breakers price themselves.
      setup: {
        ...p.setup,
        serviceChain: {
          enabled: true,
          material: p.setup.serviceChain?.material ?? "Al",
          utilityToSwitchgearFt: p.setup.serviceChain?.utilityToSwitchgearFt ?? 25,
          switchgearToTransformerFt: p.setup.serviceChain?.switchgearToTransformerFt ?? 15,
          transformerToSubpanelFt: p.setup.serviceChain?.transformerToSubpanelFt ?? 15,
        },
      },
      peripherals: { ...p.peripherals, useAutoGear: true },
    }));
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="mb-4 w-full rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Quick generate takeoff</h3>
          <p className="text-xs text-zinc-500">
            Pick charger models and counts — runs, breakers, wire, conduit, gear and costs all derive automatically.
            Distances are assumptions: first charger {startFt} ft, +{stepFt} ft each after; replace with real
            measurements when the site plan lands.
          </p>
        </div>
        <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600">
          ✕
        </button>
      </div>

      {lines.map((line, idx) => (
        <div key={idx} className="mb-2 flex items-center gap-2">
          <select
            className={selectCls}
            value={line.loadTypeId}
            onChange={(e) =>
              setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, loadTypeId: e.target.value } : l)))
            }
          >
            {project.loadTypes
              .filter((lt) => lt.category !== "Feeder")
              .map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.id}
                </option>
              ))}
          </select>
          <span className="text-sm text-zinc-500">×</span>
          <input
            type="number"
            min={1}
            className={`${inputCls} w-20`}
            value={line.count}
            onChange={(e) =>
              setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, count: Number(e.target.value) } : l)))
            }
          />
          <button
            onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
            className="text-zinc-400 hover:text-red-600"
            title="Remove line"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() => setLines((ls) => [...ls, { loadTypeId: project.loadTypes[0]?.id ?? "", count: 1 }])}
        className="mb-3 text-sm font-medium text-blue-600 hover:underline"
      >
        + Add charger model
      </button>

      <div className="mb-3 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">First charger distance (ft)</span>
          <input type="number" className={`${inputCls} w-28`} value={startFt} onChange={(e) => setStartFt(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Increment per charger (ft)</span>
          <input type="number" className={`${inputCls} w-28`} value={stepFt} onChange={(e) => setStepFt(Number(e.target.value))} />
        </label>
        <span className="pb-2 text-xs text-zinc-500">
          {totalChargers} charger{totalChargers === 1 ? "" : "s"} → {startFt} ft … {startFt + stepFt * Math.max(0, totalChargers - 1)} ft
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => generate("replace")}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Generate (replace takeoff)
        </button>
        <button
          onClick={() => generate("append")}
          className="rounded-md border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
        >
          Append to takeoff
        </button>
      </div>
    </div>
  );
}

const EDITABLE: (keyof TakeoffEdit)[] = ["loadTypeId", "location", "units", "oneWayDistFt", "runsPerUnitOverride", "sizeOverride", "ocpdOverrideA", "conduitOverride"];

/** The part of a row patch that a rebuild should re-apply. */
function editOf(patch: Partial<TakeoffRowInput>): TakeoffEdit {
  const out: TakeoffEdit = {};
  for (const k of EDITABLE) if (k in patch) (out as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
  return out;
}

export function TakeoffTab() {
  const { project, setProject, result, hardwareAllowance } = useProject();
  const [qgOpen, setQgOpen] = useState(false);
  const edits = project.takeoffEdits ?? {};
  const removedKeys = Object.keys(edits).filter((k) => edits[k].removed);
  const generated = canRebuild(project) && project.takeoff.some((r) => r.genKey);

  // Rows added here are flagged manual: a rebuild from the Quick Estimate
  // lines regenerates the generated rows and carries these along untouched.
  function addRow() {
    setProject((p) => ({
      ...p,
      takeoff: [
        ...p.takeoff,
        {
          id: newId("run"),
          loadTypeId: p.loadTypes[0]?.id ?? "",
          location: `Run ${p.takeoff.length + 1}`,
          units: 1,
          oneWayDistFt: 50,
          manual: true,
        },
      ],
    }));
  }

  // Removing a generated row is remembered, so the next rebuild leaves it out.
  function removeRow(id: string) {
    setProject((p) => {
      const row = p.takeoff.find((r) => r.id === id);
      const next = { ...p, takeoff: p.takeoff.filter((r) => r.id !== id) };
      if (row?.genKey) next.takeoffEdits = { ...(p.takeoffEdits ?? {}), [row.genKey]: { ...(p.takeoffEdits?.[row.genKey] ?? {}), removed: true } };
      return next;
    });
  }

  // Editing a generated row records the edit under its genKey — every rebuild re-applies it.
  function update(id: string, patch: Partial<TakeoffRowInput>) {
    setProject((p) => {
      const row = p.takeoff.find((r) => r.id === id);
      const next = { ...p, takeoff: p.takeoff.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
      const e = editOf(patch);
      if (row?.genKey && Object.keys(e).length) next.takeoffEdits = { ...(p.takeoffEdits ?? {}), [row.genKey]: { ...(p.takeoffEdits?.[row.genKey] ?? {}), ...e } };
      return next;
    });
  }

  /** Forget the hand edits on a row (or every removed row) and regenerate. */
  function forget(keys: string[]) {
    setProject((p) => {
      const rest = { ...(p.takeoffEdits ?? {}) };
      for (const k of keys) delete rest[k];
      const next: Project = { ...p, takeoffEdits: Object.keys(rest).length ? rest : undefined };
      return canRebuild(next) ? rebuildProject(next, hardwareAllowance) : next;
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Takeoff</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            One row per circuit run — chargers and gear feeders. Wire, ground, conduit sizing and cost compute live.
            {generated && " Rows come from the Quick Estimate lines; edit any cell and that row keeps your value through every rebuild — “→ auto” hands it back. Rows you add here stay too."}
            {removedKeys.length > 0 && (
              <>
                {" "}
                <button className="font-medium text-blue-600 hover:underline" onClick={() => forget(removedKeys)}>
                  Restore {removedKeys.length} removed row{removedKeys.length === 1 ? "" : "s"}
                </button>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setQgOpen(!qgOpen)}
            className="rounded-md border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
          >
            ⚡ Quick generate
          </button>
          <button
            onClick={addRow}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add run
          </button>
        </div>
      </div>

      <QuickGenerate open={qgOpen} setOpen={setQgOpen} />

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2">Load type</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Units</th>
              <th className="px-3 py-2">Dist (ft)</th>
              <th className="px-3 py-2" title="Parallel conductor sets per unit — blank = auto from the model">Runs/u</th>
              <th className="px-3 py-2" title="Breaker override (A) — blank = auto: next standard size ≥ 125% of continuous amps (NEC 625.41). The ground wire re-sizes from it (250.122).">Breaker (A)</th>
              <th className="px-3 py-2">Wire override</th>
              <th className="px-3 py-2">Wire</th>
              <th className="px-3 py-2">Ground</th>
              <th className="px-3 py-2">Conduit</th>
              <th className="px-3 py-2 text-right">Row total</th>
              <th className="px-3 py-2">Flag</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {result.rows.map((row) =>
              row.synthetic ? (
                <tr key={row.id} className="bg-blue-50/40 text-zinc-500 dark:bg-blue-950/20">
                  <td className="px-3 py-2 text-xs italic">service chain (auto)</td>
                  <td className="px-3 py-2">{row.location}</td>
                  <td className="px-3 py-2">{row.units}</td>
                  <td className="px-3 py-2">{row.oneWayDistFt}</td>
                  <td className="px-3 py-2">{row.resolvedRunsPerUnit}</td>
                  <td className="px-3 py-2">{row.ocpdA || "—"}</td>
                  <td className="px-3 py-2">—</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.resolvedRunsPerUnit} × {row.selectedWire} <span className="text-zinc-400">{row.material}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.groundSize || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.conduitSize || "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">{money(row.rowTotal)}</td>
                  <td className="px-3 py-2">
                    <FlagBadge flag={row.flag} />
                  </td>
                  <td className="px-3 py-2" title="Edit on the Panel schedule tab" />
                </tr>
              ) : (
                <tr key={row.id}>
                <td className="px-3 py-2">
                  <select
                    className={selectCls}
                    value={row.loadTypeId}
                    onChange={(e) => update(row.id, { loadTypeId: e.target.value })}
                  >
                    {project.loadTypes.map((lt) => (
                      <option key={lt.id} value={lt.id}>
                        {lt.id}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    className={`${inputCls} w-32`}
                    value={row.location}
                    onChange={(e) => update(row.id, { location: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className={`${inputCls} w-16`}
                    value={row.units}
                    onChange={(e) => update(row.id, { units: Number(e.target.value) })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className={`${inputCls} w-20`}
                    value={row.oneWayDistFt}
                    onChange={(e) => update(row.id, { oneWayDistFt: Number(e.target.value) })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={1}
                    className={`${inputCls} w-16`}
                    value={row.runsPerUnitOverride ?? ""}
                    placeholder={String(row.resolvedRunsPerUnit)}
                    title="Parallel conductor sets per unit — blank = auto. An extra set splits the amps, letting each set use smaller wire (helps when voltage drop governs). On L2 rows only an explicit number here splits them; NEC 310.10(H) allows parallel sets at 1/0 AWG and larger only."
                    onChange={(e) =>
                      update(row.id, {
                        runsPerUnitOverride: e.target.value === "" ? undefined : Math.max(1, Number(e.target.value)),
                      })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    className={`${inputCls} w-20`}
                    value={row.ocpdOverrideA ?? ""}
                    placeholder={String(row.ocpdA || "auto")}
                    title="Breaker override (A) — blank or 0 = auto-sized. Undersizing below 125% of continuous amps, or exceeding the wire's protection limit (NEC 240.4), gets flagged."
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      update(row.id, {
                        ocpdOverrideA: e.target.value === "" || !Number.isFinite(v) || v <= 0 ? undefined : v,
                      });
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    className={`${selectCls} w-28`}
                    value={row.sizeOverride ?? ""}
                    onChange={(e) => update(row.id, { sizeOverride: e.target.value || undefined })}
                  >
                    <option value="">auto</option>
                    {WIRE_TABLE.map((w) => (
                      <option key={w.size} value={w.size}>
                        {w.size}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.selectedWire || "—"} <span className="text-zinc-400">{row.material}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{row.groundSize || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.conduitSize || "—"}</td>
                <td className="px-3 py-2 text-right font-medium">{money(row.rowTotal)}</td>
                <td className="px-3 py-2">
                  <FlagBadge flag={row.flag} />
                </td>
                <td className="px-3 py-2">
                  {row.genKey && edits[row.genKey] && (
                    <button
                      className="mr-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-200"
                      title="Edited by hand — survives rebuilds. Click to hand the row back to the engine."
                      onClick={() => forget([row.genKey!])}
                    >
                      edited → auto
                    </button>
                  )}
                  {row.manual && <span className="mr-2 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title="Added by hand — kept through rebuilds">manual</span>}
                  <button onClick={() => removeRow(row.id)} className="text-zinc-400 hover:text-red-600" title="Remove run">
                    ✕
                  </button>
                </td>
              </tr>
              ),
            )}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-zinc-400">
                  No runs yet — add a charger or gear feeder to get started.
                </td>
              </tr>
            )}
          </tbody>
          {result.rows.length > 0 && (
            <tfoot className="bg-zinc-50 dark:bg-zinc-900">
              <tr className="font-medium">
                <td colSpan={10} className="px-3 py-2 text-right">
                  Feeder materials total
                </td>
                <td className="px-3 py-2 text-right">{money(result.rollups.feederMaterialsTotal)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="mt-2 text-xs text-zinc-500">
        <span className="font-medium">“Voltage drop governs”</span> = the run is long enough that the max-voltage-drop
        limit (Setup tab) picked a fatter wire than the current alone needs — compliant, just pricier. On DCFC and
        feeder runs, typing a bigger number in <span className="font-medium">Runs/u</span> splits the amps across
        parallel sets so each can use smaller wire; compare the row total both ways and keep the cheaper one. On L2
        rows each port is its own circuit, so the automatic sizing never splits them — but typing a number in
        Runs/u asks for parallel conductors explicitly and does split the amps. Watch for the NEC 310.10(H) flag:
        parallel sets are only permitted at 1/0 AWG and larger, which L2 branch conductors rarely reach.
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
        <Stat label="L2 chargers" value={num(result.rollups.nL2)} />
        <Stat label="DCFC chargers" value={num(result.rollups.nDCFC)} />
        <Stat label="Gear/feeder runs" value={num(result.rollups.nFeeders)} />
        <Stat label="Circuits" value={num(result.rollups.nCircuits)} />
        <Stat label="Longest run" value={`${num(result.rollups.longestRunFt)} ft`} />
        <Stat label="Total conduit ft" value={num(result.rollups.totalConduitFt)} />
      </div>
    </div>
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
