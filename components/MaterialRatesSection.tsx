"use client";

import { useState } from "react";
import { CONDUIT_TABLE, WIRE_TABLE } from "@/lib/calc/tables";
import type { MaterialRates } from "@/lib/calc/types";
import { money, num } from "@/lib/format";
import { useProject } from "./ProjectContext";
import { Section, inputCls, theadCls } from "./ui";

// Conductor and conduit $/ft — the vendor list the engine prices every run
// with, editable per project when a materials quote says otherwise. Blank
// means the shipped Rexel price; the estimate reprices live.

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap";
const thNum = `${th} text-right`;
const td = "px-3 py-1 whitespace-nowrap";
const tdNum = "px-3 py-1 text-right tabular-nums whitespace-nowrap";
const wrap = "max-h-[70vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800";
const table = "min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800";

export function MaterialRatesSection({ compact = false }: { compact?: boolean }) {
  const { project, setProject, result } = useProject();
  const rates = project.setup.materialRates ?? {};
  const [showAll, setShowAll] = useState(!compact);
  const wireLines = result.materials.wireLines;
  const conduitLines = result.materials.conduitLines;
  const overridden = (Object.keys(rates.wire ?? {}).length ?? 0) + (Object.keys(rates.conduit ?? {}).length ?? 0);

  function setRates(next: MaterialRates) {
    const clean: MaterialRates = {};
    const wire = Object.fromEntries(Object.entries(next.wire ?? {}).filter(([, v]) => v.cuPerFt !== undefined || v.alPerFt !== undefined));
    const conduit = Object.fromEntries(Object.entries(next.conduit ?? {}).filter(([, v]) => v.pvcPerFt !== undefined || v.emtPerFt !== undefined));
    if (Object.keys(wire).length) clean.wire = wire;
    if (Object.keys(conduit).length) clean.conduit = conduit;
    setProject((p) => ({ ...p, setup: { ...p.setup, materialRates: Object.keys(clean).length ? clean : undefined } }));
  }
  const setWire = (size: string, field: "cuPerFt" | "alPerFt", text: string) => {
    const cur = rates.wire?.[size] ?? {};
    setRates({ ...rates, wire: { ...(rates.wire ?? {}), [size]: { ...cur, [field]: text === "" ? undefined : Number(text) } } });
  };
  const setConduit = (size: string, field: "pvcPerFt" | "emtPerFt", text: string) => {
    const cur = rates.conduit?.[size] ?? {};
    setRates({ ...rates, conduit: { ...(rates.conduit ?? {}), [size]: { ...cur, [field]: text === "" ? undefined : Number(text) } } });
  };

  const wireRows = WIRE_TABLE.filter((w) => {
    if (showAll) return true;
    const line = wireLines.find((l) => l.size === w.size);
    return (line && (line.cuFt > 0 || line.alFt > 0)) || rates.wire?.[w.size] !== undefined;
  });
  const conduitRows = CONDUIT_TABLE.filter((c) => {
    if (showAll) return true;
    const ft = conduitLines.filter((l) => l.tradeSize === c.tradeSize).reduce((s, l) => s + l.totalFt, 0);
    return ft > 0 || rates.conduit?.[c.tradeSize] !== undefined;
  });
  const ftOf = (tradeSize: string, type: "PVC" | "EMT") => conduitLines.filter((l) => l.tradeSize === tradeSize && l.conduitType === type).reduce((s, l) => s + l.totalFt, 0);
  const priceCell = (value: number | undefined, shipped: number, onChange: (t: string) => void, inUse: boolean) => (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        step="0.001"
        className={`${inputCls} w-24 py-0.5 text-right ${inUse ? "" : "opacity-60"}`}
        placeholder={shipped ? shipped.toFixed(3) : "no price"}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== undefined && <span className="text-[10px] text-blue-700 dark:text-blue-300" title={`Shipped price ${shipped.toFixed(3)}`}>quote</span>}
    </div>
  );
  const wiresBase = result.costs.lines.find((l) => l.name === "Wires, Conduits & Electrical Peripherals")?.base ?? 0;

  return (
    <Section
      title="Conductor and conduit prices ($/ft)"
      subtitle={`The vendor list every run is priced with — shipped from the Rexel table. Type over a price when a materials quote says otherwise; blank means the shipped price. The estimate reprices as you type. ${overridden ? `${overridden} price(s) quoted on this project.` : "No quotes on this project."} Wires, conduits and peripherals line now ${money(wiresBase)}, before contingency.`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <button className="font-medium text-blue-600 hover:underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show only sizes in use" : "Show every size"}
        </button>
        {overridden > 0 && (
          <button className="font-medium text-blue-600 hover:underline" onClick={() => setRates({})}>
            Reset all to the shipped list
          </button>
        )}
        <span className="text-zinc-500">Lump-sum quotes for the whole line go on the Overrides tab instead.</span>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={wrap}>
          <table className={table}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Conductor</th>
                <th className={thNum}>Cu ft in use</th>
                <th className={thNum}>Cu $/ft</th>
                <th className={thNum}>Al ft in use</th>
                <th className={thNum}>Al $/ft</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {wireRows.map((w) => {
                const line = wireLines.find((l) => l.size === w.size);
                const cuFt = line?.cuFt ?? 0;
                const alFt = line?.alFt ?? 0;
                return (
                  <tr key={w.size} className={cuFt + alFt > 0 ? "" : "text-zinc-400"}>
                    <td className={`${td} font-medium`}>{w.size}</td>
                    <td className={tdNum}>{cuFt ? num(cuFt) : "—"}</td>
                    <td className={tdNum}>{priceCell(rates.wire?.[w.size]?.cuPerFt, w.cuPerFt, (t) => setWire(w.size, "cuPerFt", t), cuFt > 0)}</td>
                    <td className={tdNum}>{alFt ? num(alFt) : "—"}</td>
                    <td className={tdNum}>{priceCell(rates.wire?.[w.size]?.alPerFt, w.alPerFt, (t) => setWire(w.size, "alPerFt", t), alFt > 0)}</td>
                  </tr>
                );
              })}
              {wireRows.length === 0 && (
                <tr>
                  <td className={`${td} text-zinc-500`} colSpan={5}>
                    No conductor in the takeoff yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className={wrap}>
          <table className={table}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Conduit</th>
                <th className={thNum}>PVC ft in use</th>
                <th className={thNum}>PVC $/ft</th>
                <th className={thNum}>EMT ft in use</th>
                <th className={thNum}>EMT $/ft</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {conduitRows.map((c) => {
                const pvc = ftOf(c.tradeSize, "PVC");
                const emt = ftOf(c.tradeSize, "EMT");
                return (
                  <tr key={c.tradeSize} className={pvc + emt > 0 ? "" : "text-zinc-400"}>
                    <td className={`${td} font-medium`}>{c.tradeSize}</td>
                    <td className={tdNum}>{pvc ? num(pvc) : "—"}</td>
                    <td className={tdNum}>{priceCell(rates.conduit?.[c.tradeSize]?.pvcPerFt, c.pvcPerFt, (t) => setConduit(c.tradeSize, "pvcPerFt", t), pvc > 0)}</td>
                    <td className={tdNum}>{emt ? num(emt) : "—"}</td>
                    <td className={tdNum}>{priceCell(rates.conduit?.[c.tradeSize]?.emtPerFt, c.emtPerFt, (t) => setConduit(c.tradeSize, "emtPerFt", t), emt > 0)}</td>
                  </tr>
                );
              })}
              {conduitRows.length === 0 && (
                <tr>
                  <td className={`${td} text-zinc-500`} colSpan={5}>
                    No conduit in the takeoff yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
