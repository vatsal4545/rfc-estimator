"use client";

import { useMemo, useState } from "react";
import { money, num } from "@/lib/format";
import { INTAKE_TEMPLATE } from "@/lib/intake/cells";
import type { IntakeFillReport } from "@/lib/intake/fillIntake";
import { intakeCompleteness } from "@/lib/intake/handoff";
import { planIntakeFill } from "@/lib/intake/plan";
import { defaultIntake } from "@/lib/proposal/defaults";
import type { IntakeInput } from "@/lib/proposal/types";
import { IntakeImportPanel } from "../IntakeTab";
import { useProject } from "../ProjectContext";
import { Field, Grid, Pill, Section, inputCls } from "../ui";

// Version & handoff — the intake's Version tab plus the handoff itself: how
// complete the intake is, what the estimator's figures will say in the CEO's
// override register, what is left for a human, and the download of the
// filled EVSE Project Intake 2.9.0.

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap";
const td = "px-3 py-1.5 align-top";
const tdNum = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap align-top";

const STATE_LABEL = { done: "complete", partial: "in progress", empty: "not started" } as const;

export function HandoffSection() {
  const { project, setProject, result, proposal } = useProject();
  const it = project.intake ?? defaultIntake();
  const sections = useMemo(() => intakeCompleteness(project, result, proposal), [project, result, proposal]);
  const plan = useMemo(() => planIntakeFill(project, result, proposal), [project, result, proposal]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<IntakeFillReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof IntakeInput>(key: K, value: IntakeInput[K]) {
    setProject((p) => ({ ...p, intake: { ...(p.intake ?? defaultIntake()), [key]: value } }));
  }
  async function download() {
    setBusy(true);
    setError(null);
    try {
      // The zip patcher loads only when someone actually downloads.
      const { downloadIntake } = await import("@/lib/intake/fillIntake");
      setReport(await downloadIntake(project, result, proposal));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const filled = sections.reduce((t, s) => t + s.filled, 0);
  const total = sections.reduce((t, s) => t + s.total, 0);
  const carry = it.carryEstimatorOverrides ?? true;
  const bySheet = Object.entries(
    plan.writes.reduce<Record<string, number>>((acc, w) => {
      acc[w.sheet] = (acc[w.sheet] ?? 0) + 1;
      return acc;
    }, {}),
  );
  const fmtValue = (row: number, v: number) => (row === 19 || row === 20 || row === 21 ? num(v) : row === 22 ? `${num(v)} kWh` : row === 26 || row === 27 ? `$${v.toFixed(4)}` : money(v));

  return (
    <div>
      <Section title="Version & handoff — document control" subtitle={`The intake's Version tab. Template ${INTAKE_TEMPLATE.version} (content hash ${INTAKE_TEMPLATE.contentHash}) is the generation this app fills; the file version is yours to increment each time you send it.`}>
        <Grid cols={3}>
          <Field label="This file version" hint="Rev A, Rev B… increment each time you send it">
            <input className={inputCls} value={it.fileVersion ?? ""} placeholder="Rev A" onChange={(e) => update("fileVersion", e.target.value)} />
          </Field>
          <Field label="Completed by" hint={`Blank = the CPM on the Project tab${project.setup.cpm ? ` (${project.setup.cpm})` : ""}`}>
            <input className={inputCls} value={it.completedBy ?? ""} placeholder={project.setup.cpm || "name"} onChange={(e) => update("completedBy", e.target.value)} />
          </Field>
          <Field label="Project reference">
            <input className={inputCls} value={it.projectReference} onChange={(e) => update("projectReference", e.target.value)} />
          </Field>
        </Grid>
        <div className="mt-4">
          <Field label="Notes on this revision" hint="What changed since the last version you sent — the generated 'filled by the RFC Estimator' line is added after it">
            <textarea className={`${inputCls} min-h-16`} value={it.revisionNotes ?? ""} onChange={(e) => update("revisionNotes", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Completeness" subtitle="The intake's own rule: leave a cell blank rather than guess — a blank is a question we will ask, a guess becomes a number in a proposal. These are the fields the CEO's process needs filled.">
        <div className="mb-3 flex items-center gap-3 text-sm">
          <Pill ok={filled === total}>
            {filled} of {total} checks
          </Pill>
          <span className="text-xs text-zinc-500">{sections.filter((s) => s.state === "done").length} of {sections.length} sections complete</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <details key={s.key} className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <summary className="flex cursor-pointer items-center justify-between text-sm">
                <span className="font-medium">{s.label}</span>
                <span className={`text-xs ${s.state === "done" ? "text-green-700 dark:text-green-400" : s.state === "partial" ? "text-amber-700 dark:text-amber-300" : "text-zinc-400"}`}>
                  {s.filled}/{s.total} · {STATE_LABEL[s.state]}
                </span>
              </summary>
              <ul className="mt-2 space-y-0.5 text-xs">
                {s.checks.map((ch) => (
                  <li key={ch.label} className={ch.ok ? "text-zinc-500" : "text-amber-800 dark:text-amber-300"}>
                    {ch.ok ? "✓" : "○"} {ch.label}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Section>

      <Section
        title="What travels into the CEO's override register"
        subtitle="The intake derives its own electrical and civil costs from distances and RefData rates. A row in its Overrides tab forces that figure to a typed one — with the reason beside it — and the CEO's engine reports every active override on the model summary. So the estimator's construction and engineering numbers land there: in force, never hidden."
      >
        <label className="mb-3 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" className="h-4 w-4" checked={carry} onChange={(e) => update("carryEstimatorOverrides", e.target.checked)} />
          Carry the estimator&apos;s construction and engineering figures (rows 9–16, the frame and the branch breaker) into the register
        </label>
        {plan.overrides.length === 0 ? (
          <div className="text-sm text-zinc-500">Nothing to carry — the CEO&apos;s engine will price the job from the intake&apos;s own derivation.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className={th}>Row</th>
                  <th className={th}>Override</th>
                  <th className={`${th} text-right`}>Value</th>
                  <th className={th}>Why — as written on the intake</th>
                  <th className={th}>From</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {plan.overrides.map((o) => (
                  <tr key={o.row}>
                    <td className={`${td} text-zinc-500`}>{o.row}</td>
                    <td className={td}>{o.label}</td>
                    <td className={`${tdNum} font-medium`}>{fmtValue(o.row, o.value)}</td>
                    <td className={`${td} max-w-lg text-xs text-zinc-600 dark:text-zinc-400`}>{o.reason}</td>
                    <td className={`${td} text-xs text-zinc-500`}>{o.source === "estimator" ? "estimator" : "your Overrides tab"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Left for a human" subtitle="Blue cells the estimator does not model. Finish them in Excel before the file goes out, or leave them blank as questions.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Left blank ({plan.leftBlank.length})</div>
            <ul className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              {plan.leftBlank.map((s) => (
                <li key={s}>• {s}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-amber-800 dark:text-amber-300">Look at ({plan.warnings.length})</div>
            <ul className="space-y-0.5 text-xs text-amber-900 dark:text-amber-200">
              {plan.warnings.map((s) => (
                <li key={s}>• {s}</li>
              ))}
              {plan.warnings.length === 0 && <li className="text-zinc-500">nothing</li>}
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Send the intake" subtitle={`A copy of the blank EVSE Project Intake ${INTAKE_TEMPLATE.version} with ${plan.writes.length} cells filled — values only. Its formulas, checks, dropdowns and comments are the template's own; every green check recalculates when it opens.`}>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={download} disabled={busy} className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">
            {busy ? "Filling…" : `⬇ Intake ${INTAKE_TEMPLATE.version} (.xlsx)`}
          </button>
          <span className="text-xs text-zinc-500">{bySheet.map(([sheet, n]) => `${sheet} ${n}`).join(" · ")}</span>
        </div>
        {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
        {report && (
          <div className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
            Wrote {report.filled} cells as {report.fileVersion}
            {report.refused.length > 0 && <span className="text-amber-800 dark:text-amber-300"> · {report.refused.length} refused: {report.refused.join("; ")}</span>}
          </div>
        )}
        <p className="mt-4 text-xs text-zinc-500">
          Coming back the other way: a filled intake the CEO or the RSM edited imports here as a new project, so the two versions can be compared side by side.
        </p>
      </Section>

      <IntakeImportPanel />
    </div>
  );
}
