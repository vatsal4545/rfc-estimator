"use client";

import type { EstimateResult, TakeoffRowComputed } from "@/lib/calc/types";
import { num } from "@/lib/format";

function segLabel(row: TakeoffRowComputed | undefined): string {
  if (!row || !row.selectedWire) return "— set distance —";
  return `${row.resolvedRunsPerUnit} × ${row.selectedWire} ${row.material} + ${row.groundSize} EGC · ${num(row.oneWayDistFt)} ft · ${row.conduitSize} ${row.resolvedRunsPerUnit > 1 ? `× ${row.resolvedRunsPerUnit}` : ""}`;
}

function NodeBox({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="rounded-md border-2 border-zinc-400 bg-white px-4 py-2 text-center shadow-sm dark:border-zinc-500 dark:bg-zinc-900">
      <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{title}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function Wire({ label, warn }: { label: string; warn?: string }) {
  return (
    <div className="flex items-center gap-3 py-1 pl-6">
      <div className="h-10 w-0.5 bg-zinc-400 dark:bg-zinc-500" />
      <div className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
        {label}
        {warn && <span className="ml-2 text-amber-600 dark:text-amber-400">⚠ {warn}</span>}
      </div>
    </div>
  );
}

function Branch({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pl-10">
      <div className="h-3 w-4 border-b border-l border-zinc-400 dark:border-zinc-500" />
      <div className="font-mono text-xs text-zinc-600 dark:text-zinc-300">{label}</div>
    </div>
  );
}

export function SLD({ result }: { result: EstimateResult }) {
  const { panel, rows } = result;
  const chainRow = (idPart: string) => rows.find((r) => r.id === `chain-${idPart}`);
  const svc = chainRow("SVC Utility→Switchgear") ?? chainRow("SVC Utility→Panel");
  const pri = chainRow("FDR Switchgear→TX");
  const sec = chainRow("FDR TX→Sub-panel");

  // Charger branches grouped by load type for compact labels.
  const groups = new Map<string, { count: number; sample: TakeoffRowComputed }>();
  for (const r of rows.filter((r) => r.category === "L2" || r.category === "DCFC")) {
    const g = groups.get(r.loadTypeId) ?? { count: 0, sample: r };
    g.count += r.units;
    groups.set(r.loadTypeId, g);
  }
  const branchesAt = (voltage: number) =>
    Array.from(groups.entries()).filter(([, g]) => g.sample.volts === voltage);

  const has480 = Boolean(panel.bus480);
  const mainBus = has480 ? panel.bus480 : panel.bus208;
  if (!mainBus) return <p className="text-sm text-zinc-400">Add chargers to draw the one-line.</p>;

  return (
    <div className="slim-scroll overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="min-w-[420px]">
        <NodeBox title="UTILITY TRANSFORMER" sub={`${has480 ? "480Y/277V" : "208Y/120V"} service`} />
        <Wire label={segLabel(svc)} warn={svc && svc.flag !== "OK" && svc.flag !== "Manual override in use" ? svc.flag : undefined} />
        <NodeBox
          title={has480 ? "MAIN SWITCHGEAR" : "MAIN PANEL"}
          sub={`${mainBus.suggestedBusA} A bus @ ${mainBus.voltage}V · demand ${num(mainBus.demandAmps)} A`}
        />
        {branchesAt(has480 ? 480 : 208).map(([id, g]) => (
          <Branch
            key={id}
            label={`${g.count} × ${g.sample.ocpdA}A/${g.sample.phases === 3 ? 3 : 2}P → ${id} (${g.sample.resolvedRunsPerUnit} × ${g.sample.selectedWire} ${g.sample.material} each)`}
          />
        ))}
        {has480 && panel.transformer && panel.bus208 && (
          <>
            <Branch label={`1 × ${panel.transformer.primaryBreakerA}A/3P → step-down transformer`} />
            <Wire label={segLabel(pri)} warn={pri && pri.flag !== "OK" && pri.flag !== "Manual override in use" ? pri.flag : undefined} />
            <NodeBox
              title="STEP-DOWN TRANSFORMER"
              sub={`${panel.transformer.suggestedKva} kVA · 480Δ → 208Y/120V`}
            />
            <Wire label={segLabel(sec)} warn={sec && sec.flag !== "OK" && sec.flag !== "Manual override in use" ? sec.flag : undefined} />
            <NodeBox
              title="208V SUB-PANEL"
              sub={`${panel.bus208.suggestedBusA} A bus · demand ${num(panel.bus208.demandAmps)} A`}
            />
            {branchesAt(208).map(([id, g]) => (
              <Branch
                key={id}
                label={`${g.count * g.sample.resolvedRunsPerUnit} × ${g.sample.ocpdA}A/2P → ${id} (${g.sample.selectedWire} ${g.sample.material})`}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
