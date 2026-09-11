"use client";

import { theadCls } from "../ui";
import { defaultQuickInput, normalizeQuickInput } from "@/lib/calc/autoplan";
import type { QuickEstimateInput } from "@/lib/calc/types";
import { money, num } from "@/lib/format";
import { rebuildProject } from "@/lib/intake/rebuild";
import { findSku } from "@/lib/ref/priceBook";
import { CHARGER_SKUS, EXTRA_SKUS, computeEquipmentSchedule, computeSiteCapacity, loadTypeIdForSku } from "@/lib/skus";
import { useProject } from "../ProjectContext";
import { Pill, Section, inputCls, selectCls } from "../ui";
import { useRebuild } from "./useRebuild";

// 2 · Equipment — the intake's Equipment tab as a form over the Quick Estimate
// lines: pick a capacity, then a SKU (the list narrows the way the sheet's
// picker does); description, role, kW, connectors and MSRP come from the CEO's
// price book. The estimate rebuilds as the lines change.

const CAPACITY_ORDER = ["Level 2 AC", "30 kW DC", "60 kW DC", "120 kW DC", "160 kW DC", "180 kW DC", "240 kW DC", "360 kW DC", "V2G", "Distributed system", "Accessory"];
const CAPACITIES = [...new Set(CHARGER_SKUS.map((s) => s.capacity))].sort((a, b) => {
  const ia = CAPACITY_ORDER.indexOf(a);
  const ib = CAPACITY_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});
const GENERIC = "__generic";
const DEFAULT_SKU = CHARGER_SKUS.find((s) => s.sku === "TP5-360-480-2-300") ?? CHARGER_SKUS[0];

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap";
const thNum = `${th} text-right`;
const td = "px-3 py-1.5 align-middle";
const tdNum = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap align-middle";
const shortDesc = (d: string) => (d.length > 64 ? `${d.slice(0, 62).trimEnd()}…` : d);
const roleLabel: Record<string, string> = { all_in_one: "All-in-one", power_cabinet: "Power cabinet", dispenser: "Dispenser", level_2: "Level 2", accessory: "Accessory" };

export function EquipmentSection() {
  const { project, setProject, result, hardwareAllowance } = useProject();
  const { auto, rebuild, pin, unpin, pinned } = useRebuild();
  const input: QuickEstimateInput = project.quick ? normalizeQuickInput(project.quick, project.setup) : defaultQuickInput();
  const schedule = computeEquipmentSchedule(project, hardwareAllowance);
  const cap = computeSiteCapacity(project);
  const discount = project.commercial?.discountHardwarePct ?? 0;
  const chargerModels = project.loadTypes.filter((lt) => lt.category !== "Feeder");

  const setQuick = (patch: Partial<QuickEstimateInput>) =>
    rebuild((p) => ({ ...p, quick: { ...(p.quick ? normalizeQuickInput(p.quick, p.setup) : defaultQuickInput()), ...patch } }));
  const setLine = (idx: number, patch: Partial<QuickEstimateInput["lines"][number]>) => setQuick({ lines: input.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  const setLineSku = (idx: number, skuId: string) => {
    if (skuId === GENERIC) {
      const { loadTypeId, count } = input.lines[idx];
      return setQuick({ lines: input.lines.map((l, i) => (i === idx ? { loadTypeId, count } : l)) });
    }
    const sku = findSku(skuId);
    setLine(idx, { sku: skuId, loadTypeId: (sku ? loadTypeIdForSku(sku) : null) ?? input.lines[idx].loadTypeId });
  };
  const setLineCapacity = (idx: number, capacity: string) => {
    if (capacity === GENERIC) return setLineSku(idx, GENERIC);
    const first = CHARGER_SKUS.find((s) => s.capacity === capacity);
    if (first) setLineSku(idx, first.sku);
  };
  const extras = input.extras ?? [];
  const setExtra = (idx: number, patch: Partial<{ sku: string; count: number }>) => setQuick({ extras: extras.map((x, i) => (i === idx ? { ...x, ...patch } : x)) });

  // The sheet's own totals (Equipment rows 20–26), from the price book.
  let chargingUnits = 0;
  let acUnits = 0;
  for (const l of input.lines) {
    if (l.count <= 0) continue;
    const sku = l.sku ? findSku(l.sku) : undefined;
    const role = sku?.role ?? (l.loadTypeId.startsWith("Power cabinet") ? "power_cabinet" : "all_in_one");
    acUnits += l.count;
    if (role !== "power_cabinet") chargingUnits += l.count;
  }
  for (const x of extras) if (findSku(x.sku)?.role === "dispenser") chargingUnits += x.count;

  const scopePinned = pinned("setup.scopeOfWork");

  return (
    <div>
      <Section
        title="2 · Equipment — what is being sold"
        subtitle="Pick a capacity, then the SKU: the list narrows the way the intake's picker does. Description, role, kW, connectors and MSRP come from the CEO's price book (template 2.9.0). Every change rebuilds the estimate — sizing, gear, civil, labour days — underneath."
      >
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className={theadCls}>
              <tr>
                <th className={th}>Line</th>
                <th className={th}>Capacity</th>
                <th className={th}>SKU</th>
                <th className={th}>Description</th>
                <th className={th}>Role</th>
                <th className={thNum}>kW</th>
                <th className={thNum}>Connectors</th>
                <th className={thNum}>Qty</th>
                <th className={thNum}>MSRP each</th>
                <th className={thNum}>List total</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {input.lines.map((line, idx) => {
                const sku = line.sku ? findSku(line.sku) : undefined;
                const lt = chargerModels.find((m) => m.id === line.loadTypeId);
                const sched = schedule.lines.find((l) => l.kind === "charger" && (l.sku ?? l.loadTypeId) === (line.sku ?? line.loadTypeId));
                const capacity = sku?.capacity ?? GENERIC;
                const skusForCapacity = sku ? CHARGER_SKUS.filter((s) => s.capacity === sku.capacity) : [];
                return (
                  <tr key={idx}>
                    <td className={`${td} text-zinc-500`}>{idx + 1}</td>
                    <td className={td}>
                      <select className={`${selectCls} py-1`} value={capacity} onChange={(e) => setLineCapacity(idx, e.target.value)}>
                        <option value={GENERIC}>Generic model</option>
                        {CAPACITIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={td}>
                      {sku ? (
                        <select className={`${selectCls} py-1`} value={sku.sku} onChange={(e) => setLineSku(idx, e.target.value)}>
                          {skusForCapacity.map((s) => (
                            <option key={s.sku} value={s.sku}>
                              {s.sku}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select className={`${selectCls} py-1`} value={line.loadTypeId} onChange={(e) => setLine(idx, { loadTypeId: e.target.value })} title="Estimator model — no price-book SKU; priced at the catalog allowance">
                          {chargerModels.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.id}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className={`${td} max-w-xs text-xs text-zinc-600 dark:text-zinc-400`} title={sku?.description}>
                      {sku ? shortDesc(sku.description) : `Estimator model${lt ? ` — sized as ${lt.id}` : ""}`}
                      {!sku && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">no SKU</span>}
                    </td>
                    <td className={`${td} text-xs text-zinc-500`}>{sku ? roleLabel[sku.role] ?? sku.role : lt?.category ?? "—"}</td>
                    <td className={tdNum}>{sku ? num(sku.ratedKw, 0) : lt ? num(lt.kwPerPort * (lt.runsAreParallel ? 1 : lt.runsPerUnit), 0) : "—"}</td>
                    <td className={tdNum}>{sched ? num(sched.portsPerUnit) : sku ? num(sku.connectors) : "—"}</td>
                    <td className={tdNum}>
                      <input type="number" min={0} className={`${inputCls} w-20 py-1 text-right`} value={line.count} onChange={(e) => setLine(idx, { count: Number(e.target.value) })} />
                    </td>
                    <td className={tdNum}>{money(sku ? sku.msrp : (hardwareAllowance[line.loadTypeId] ?? 0))}</td>
                    <td className={`${tdNum} font-medium`}>{money((sku ? sku.msrp : (hardwareAllowance[line.loadTypeId] ?? 0)) * Math.max(0, line.count))}</td>
                    <td className={td}>
                      <button className="text-zinc-400 hover:text-red-600" onClick={() => setQuick({ lines: input.lines.filter((_, i) => i !== idx) })} title="Remove line">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
              {extras.map((x, idx) => {
                const sku = findSku(x.sku);
                return (
                  <tr key={`x-${idx}`} className="bg-zinc-50/50 dark:bg-zinc-900/40">
                    <td className={`${td} text-zinc-500`}>{input.lines.length + idx + 1}</td>
                    <td className={`${td} text-xs text-zinc-500`}>{sku?.capacity ?? "Accessory"}</td>
                    <td className={td}>
                      <select className={`${selectCls} py-1`} value={x.sku} onChange={(e) => setExtra(idx, { sku: e.target.value })}>
                        {EXTRA_SKUS.map((s) => (
                          <option key={s.sku} value={s.sku}>
                            {s.sku}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`${td} max-w-xs text-xs text-zinc-600 dark:text-zinc-400`} title={sku?.description}>
                      {sku ? shortDesc(sku.description) : "not in the price book"}
                    </td>
                    <td className={`${td} text-xs text-zinc-500`}>{sku ? roleLabel[sku.role] ?? sku.role : "—"}</td>
                    <td className={tdNum}>{sku?.ratedKw ? num(sku.ratedKw, 0) : "—"}</td>
                    <td className={tdNum}>{sku ? num(sku.connectors) : "—"}</td>
                    <td className={tdNum}>
                      <input type="number" min={0} className={`${inputCls} w-20 py-1 text-right`} value={x.count} onChange={(e) => setExtra(idx, { count: Number(e.target.value) })} />
                    </td>
                    <td className={tdNum}>{money(sku?.msrp ?? 0)}</td>
                    <td className={`${tdNum} font-medium`}>{money((sku?.msrp ?? 0) * Math.max(0, x.count))}</td>
                    <td className={td}>
                      <button className="text-zinc-400 hover:text-red-600" onClick={() => setQuick({ extras: extras.filter((_, i) => i !== idx) })} title="Remove line">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <button className="font-medium text-blue-600 hover:underline" onClick={() => setQuick({ lines: [...input.lines, { loadTypeId: loadTypeIdForSku(DEFAULT_SKU) ?? chargerModels[0]?.id ?? "", count: 1, sku: DEFAULT_SKU.sku }] })}>
            + Add charger line
          </button>
          <button className="font-medium text-blue-600 hover:underline" onClick={() => setQuick({ extras: [...extras, { sku: EXTRA_SKUS[0]?.sku ?? "", count: 1 }] })}>
            + Add dispenser / accessory
          </button>
        </div>
        {schedule.warnings.length > 0 && (
          <ul className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {schedule.warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Derived label="Charging units" value={num(chargingUnits)} hint="units a driver plugs into" />
          <Derived label="AC-connected units" value={num(acUnits)} hint="each needs an AC run" />
          <Derived label="Total ports" value={num(schedule.ports)} hint="the EVOLV billing basis" />
          <Derived label="Connected load" value={`${num(schedule.connectedKw, 0)} kW`} hint="AC input — what the switchgear sees" />
          <Derived label="Equipment MSRP total" value={money(schedule.hardwareList)} />
          <Derived label="After hardware discount" value={money(schedule.hardwareList * (1 - discount))} hint={`${Math.round(discount * 100)}% off list — Commercial tab`} />
          <Derived label="DC fast-charging capacity" value={`${num(cap.dcNameplateKw, 0)} kW`} hint="the FCI credit basis" />
          <Derived label="Estimate Total Cost" value={money(result.costs.totalCost)} hint={auto ? "rebuilt from these lines" : "hand-built takeoff"} />
        </div>
      </Section>

      <Section title="Scope of work sentence" subtitle="One line, as it will read on the proposal. The estimator writes it from the lines above; type to replace it.">
        <div className="flex items-start gap-3">
          <textarea
            className={`${inputCls} min-h-16 flex-1`}
            value={project.setup.scopeOfWork}
            onChange={(e) => pin("setup.scopeOfWork", e.target.value)}
          />
          <div className="flex flex-col items-end gap-1">
            <Pill ok={!scopePinned}>{scopePinned ? "typed" : "auto"}</Pill>
            {scopePinned && (
              <button className="text-xs font-medium text-blue-600 hover:underline" onClick={() => unpin("setup.scopeOfWork")}>
                → auto
              </button>
            )}
          </div>
        </div>
      </Section>

      {!auto && (
        <div className="mb-8 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <span>This project&apos;s takeoff was built by hand on the Estimator tabs, so equipment edits here do not regenerate it.</span>
          <button
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
            onClick={() => setProject((p) => rebuildProject(p, hardwareAllowance))}
            title="Replace the hand-built takeoff with one generated from these lines"
          >
            Rebuild from these lines
          </button>
        </div>
      )}
    </div>
  );
}

function Derived({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-medium text-zinc-900 dark:text-zinc-100">{value}</div>
      {hint && <div className="text-xs text-zinc-400">{hint}</div>}
    </div>
  );
}
