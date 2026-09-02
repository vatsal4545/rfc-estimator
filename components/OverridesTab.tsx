"use client";

import { useMemo } from "react";
import { computeEstimate } from "@/lib/calc/engine";
import { COST_LINE_NAMES, SITE_WORKS_LINES } from "@/lib/calc/costs";
import { money, num } from "@/lib/format";
import { OVERRIDE_SPECS, activeOverrideCount, applyFieldOverrides, fieldOverrideDrift, fieldValue, setOverride, type OverrideSpec } from "@/lib/overrides";
import { computeProposal } from "@/lib/proposal";
import { defaultRevenue } from "@/lib/proposal/defaults";
import { hardwareListTotal } from "@/lib/skus";
import { useProject } from "./ProjectContext";
import { Pill, Section, inputCls } from "./ui";

// Overrides — the intake's register. "Type a number only when you know better
// than the engine — a quote, a fee schedule, a field measurement. Leave a row
// blank and the engine uses its own number. An override with no reason is
// indistinguishable from a typo six months later."

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap";
const thNum = `${th} text-right`;
const td = "px-3 py-1.5";
const tdNum = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
const CLASS_LABEL = { engine: "Total Cost", model: "Business model", field: "Typed field" } as const;

export function OverridesTab() {
  const { project, setProject, result, proposal, hardwareAllowance } = useProject();

  // What the engine and the model say with the register switched off.
  const baseline = useMemo(() => {
    const stripped = { ...project, overrides: undefined };
    const est = computeEstimate(stripped);
    const prop = computeProposal(stripped, est);
    const autoGear = computeEstimate({ ...stripped, setup: { ...stripped.setup, gearOverrides: { ...stripped.setup.gearOverrides, switchgear480A: undefined } } });
    return { est, prop, autoSwitchgearA: autoGear.panel.bus480?.suggestedBusA };
  }, [project]);

  const fmt = (spec: OverrideSpec, v: number | undefined | null) => {
    if (v === undefined || v === null || !Number.isFinite(v)) return "—";
    if (spec.units === "$" || spec.units === "$/yr") return money(v);
    if (spec.units === "$/kWh") return `$${v.toFixed(4)}`;
    return num(v, spec.units === "days" || spec.units === "A" ? 0 : 1);
  };
  const engineValue = (spec: OverrideSpec): number | undefined => {
    const e = baseline.est;
    if (spec.key.startsWith("line:")) return e.costs.lines.find((l) => l.name === spec.key.slice(5))?.base;
    switch (spec.key) {
      case "siteWorks":
        return e.costs.lines.filter((l) => (SITE_WORKS_LINES as string[]).includes(l.name)).reduce((s, l) => s + l.base, 0);
      case "design":
        return e.costs.designAndEngineering;
      case "switchgearA":
        return baseline.autoSwitchgearA;
      case "hardwareCost":
        return hardwareListTotal(project, hardwareAllowance) ?? undefined;
      case "retailPerKwh":
        return defaultRevenue().retailPerKwh;
      case "crewDays":
        return undefined;
      case "kwhPerDay":
        return baseline.prop?.model.usage.siteKwhPerDay;
      case "carbonGrossPerYear":
        return baseline.prop?.model.carbon.grossPerYear;
      case "loanPayment":
        return baseline.prop?.model.financing.payment;
      case "blendedPerKwh":
        return baseline.prop?.model.tariff.blendedPerKwh;
      case "fixedUtilityPerYear":
        return baseline.prop?.model.tariff.years[0]?.fixedCost;
    }
    return undefined;
  };
  const inUse = (spec: OverrideSpec): number | undefined => {
    if (spec.key.startsWith("line:")) return result.costs.lines.find((l) => l.name === spec.key.slice(5))?.base;
    switch (spec.key) {
      case "siteWorks":
        return result.costs.lines.filter((l) => (SITE_WORKS_LINES as string[]).includes(l.name)).reduce((s, l) => s + l.base, 0);
      case "design":
        return result.costs.designAndEngineering;
      case "kwhPerDay":
        return proposal?.model.usage.siteKwhPerDay;
      case "carbonGrossPerYear":
        return proposal?.model.carbon.grossPerYear;
      case "loanPayment":
        return proposal?.model.financing.payment;
      case "blendedPerKwh":
        return proposal?.model.tariff.blendedPerKwh;
      case "fixedUtilityPerYear":
        return proposal?.model.tariff.years[0]?.fixedCost;
      default:
        return fieldValue(project, spec.key);
    }
  };
  const entryFor = (key: string) => project.overrides?.find((o) => o.key === key);
  function edit(key: string, patch: { value?: number | null; reason?: string; source?: string }) {
    setProject((p) => applyFieldOverrides({ ...p, overrides: setOverride(p.overrides, key, patch) }));
  }
  const active = activeOverrideCount(project);
  const drift = fieldOverrideDrift(project);
  const groups: { title: string; keys: string[] }[] = [
    { title: "Construction cost lines — before contingency and markup", keys: [...COST_LINE_NAMES.map((n) => `line:${n}`), "siteWorks", "design"] },
    { title: "Typed fields — written through to the tab that owns them", keys: ["crewDays", "switchgearA", "hardwareCost", "retailPerKwh"] },
    { title: "Business model figures", keys: ["kwhPerDay", "carbonGrossPerYear", "loanPayment", "blendedPerKwh", "fixedUtilityPerYear"] },
  ];

  return (
    <div>
      <Section
        title="Override register"
        subtitle="Force any derived value when you know better than the engine — a vendor quote, an AHJ fee schedule, a field measurement. Leave a row blank and the engine uses its own number. Every override is reported on the export so a reviewer can see where the model was touched."
      >
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <Pill ok={active === 0}>{active === 0 ? "No overrides — every figure is engine-derived" : `${active} override(s) active — one or more figures are typed, not computed`}</Pill>
          {drift.map((d) => (
            <span key={d.entry.key} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {OVERRIDE_SPECS.find((s) => s.key === d.entry.key)?.label}: the field now reads {d.current} against the override {d.entry.value} — re-apply or clear
            </span>
          ))}
        </div>
        {groups.map((g) => (
          <div key={g.title} className="mb-6">
            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">{g.title}</div>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                <thead className="bg-zinc-50 dark:bg-zinc-900">
                  <tr>
                    <th className={th}>Item</th>
                    <th className={thNum}>Engine value</th>
                    <th className={thNum}>Override</th>
                    <th className={thNum}>In use</th>
                    <th className={th}>Units</th>
                    <th className={th}>Why — quote, fee schedule, measurement</th>
                    <th className={th}>Source</th>
                    <th className={th}>Moves</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {g.keys.map((key) => {
                    const spec = OVERRIDE_SPECS.find((s) => s.key === key)!;
                    const entry = entryFor(key);
                    return (
                      <tr key={key} className={entry ? "bg-amber-50/50 dark:bg-amber-950/20" : undefined} title={spec.hint}>
                        <td className={td}>{spec.label}</td>
                        <td className={`${tdNum} text-zinc-500`}>{spec.cls === "field" && spec.key === "crewDays" ? "typed on Financials" : fmt(spec, engineValue(spec))}</td>
                        <td className={tdNum}>
                          <input
                            type="number"
                            step="any"
                            className={`${inputCls} w-32 py-1 text-right`}
                            value={entry?.value ?? ""}
                            placeholder="—"
                            onChange={(e) => edit(key, { value: e.target.value === "" ? null : Number(e.target.value) })}
                          />
                        </td>
                        <td className={`${tdNum} font-medium`}>{fmt(spec, inUse(spec))}</td>
                        <td className={`${td} text-xs text-zinc-500`}>{spec.units}</td>
                        <td className={td}>
                          <input className={`${inputCls} w-56 py-1`} value={entry?.reason ?? ""} placeholder={spec.hint} disabled={!entry} onChange={(e) => edit(key, { reason: e.target.value })} />
                        </td>
                        <td className={td}>
                          <input className={`${inputCls} w-40 py-1`} value={entry?.source ?? ""} placeholder="quote ref, fee schedule, who measured" disabled={!entry} onChange={(e) => edit(key, { source: e.target.value })} />
                        </td>
                        <td className={`${td} text-xs text-zinc-500`}>{CLASS_LABEL[spec.cls]}</td>
                        <td className={td}>
                          {entry && (
                            <button className="text-zinc-400 hover:text-red-600" onClick={() => edit(key, { value: null })} title="Clear the override — the engine value stands">
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <ul className="space-y-1 text-xs text-zinc-500">
          <li>• Construction-line overrides replace the base the estimator computed; contingency and the materials markup apply on top, exactly as they would to the engine&apos;s number. The site-works figure rescales the four civil lines to match one quote.</li>
          <li>• Typed fields are written to the tab that owns them (Financials, Panel schedule gear override, Business model) so the rest of the app sees the same number; a later edit on that tab shows here as drift.</li>
          <li>• Business-model figures force the model only — Total Cost and the customer price are untouched. Working units with salvage value belong here as a negative additional-scope line, not buried in the construction estimate.</li>
        </ul>
      </Section>
    </div>
  );
}
