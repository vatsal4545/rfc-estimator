"use client";

// Generate Proposal — the EVProposalGenerator, in the estimator.
//
// The document is produced by the real ev_proposal_agent running under Pyodide
// (lib/proposalDoc/runtime.ts), not by a reimplementation, so the numbers and
// the prose are the desktop app's. This file is only the form: pick a source,
// fill in the details the workbook cannot know, choose which sections to keep,
// and download.
//
// The one thing here that the desktop app does not have is the source choice.
// "Use the current estimator settings" generates exactly the bytes the toolbar's
// ⬇ Download RFC button would hand you and feeds those in, so both paths run
// the same code on the same kind of file.

import { useCallback, useMemo, useRef, useState } from "react";
import { useProject } from "./ProjectContext";
import { Field, Grid, Section, inputCls } from "./ui";
import { fetchRfcTemplate, fillRfcWorkbook, type RfcFillReport } from "../lib/rfc/fillRfc";
import {
  coerce,
  initialValue,
  labelFor,
  projectPrefills,
  widgetFor,
} from "../lib/proposalDoc/form";
import {
  downloadDocx,
  generateProposal,
  inspectWorkbook,
  operatorInputSpec,
  sectionRegistry,
  type Finding,
  type GenerateResult,
  type InspectResult,
  type OperatorInputSpec,
  type SectionSpec,
} from "../lib/proposalDoc/runtime";

type Source = "estimator" | "import";

interface Workbook {
  bytes: Uint8Array;
  label: string;
  /** Warnings from our own fill, on the estimator path — dropped lines and the like. */
  fillReport?: RfcFillReport;
}

/**
 * Let the browser paint before we block it.
 *
 * Pyodide runs on the main thread and the Python call is synchronous, so
 * between setBusy(...) and the call returning there is no opportunity to
 * render: React schedules the update, the thread goes into WASM for ten or
 * twenty seconds, and the user sees the old markup the whole time. Two frames
 * is enough to get the pending state on screen first.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/**
 * A CSS-only spinner. It has to be CSS-only: while the generator is running
 * the main thread is inside WASM, so anything driven by JavaScript would sit
 * frozen. A transform animation runs on the compositor and keeps turning.
 */
function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

function levelClass(level: string): string {
  const l = level.toUpperCase();
  if (l === "ERROR") return "text-red-700 dark:text-red-400";
  if (l === "WARNING") return "text-amber-700 dark:text-amber-400";
  return "text-zinc-500 dark:text-zinc-400";
}

function FindingList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  const order = { ERROR: 0, WARNING: 1, INFO: 2 } as Record<string, number>;
  const sorted = [...findings].sort(
    (a, b) => (order[a.level.toUpperCase()] ?? 3) - (order[b.level.toUpperCase()] ?? 3),
  );
  return (
    <ul className="mt-3 space-y-1.5 text-sm">
      {sorted.map((f, i) => (
        <li key={`${f.code}-${i}`} className="flex gap-2">
          <span className={`shrink-0 font-medium ${levelClass(f.level)}`}>{f.level.toUpperCase()}</span>
          <span className="text-zinc-700 dark:text-zinc-300">{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

export default function GenerateProposalTab() {
  const { project, result, proposal, hardwareAllowance } = useProject();

  const [source, setSource] = useState<Source>("estimator");
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [inspection, setInspection] = useState<InspectResult | null>(null);
  const [specs, setSpecs] = useState<OperatorInputSpec[] | null>(null);
  const [sections, setSections] = useState<SectionSpec[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [disabledSections, setDisabledSections] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  /** Which step the busy message belongs to, so it renders beside its button. */
  const [stage, setStage] = useState<"workbook" | "generating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<GenerateResult | null>(null);
  const [showQa, setShowQa] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const detection = inspection?.detection;

  /** 1 · Project, in the proposal's own vocabulary. */
  const fromProject = useMemo(() => projectPrefills(project), [project]);

  /** Load a workbook: inspect it, then build the form from what it says. */
  const loadWorkbook = useCallback(
    async (next: Workbook) => {
    setError(null);
    setOutcome(null);
    setInspection(null);
    setWorkbook(next);
    setStage("workbook");
    setBusy("Reading the workbook…");
    await nextPaint();
    try {
      const report = await inspectWorkbook(next.bytes, (m) => setBusy(m));
      if (!report.ok) {
        setError(report.detail ? `${report.error}\n\n${report.detail}` : report.error);
        return;
      }
      setInspection(report);
      const [declared, registry] = await Promise.all([operatorInputSpec(), sectionRegistry()]);
      setSpecs(declared);
      setSections(registry);
      // Precedence is the desktop app's: what the user typed, then the
      // workbook's own prefill, then the declared default.
      setValues((current) => {
        const seeded: Record<string, string> = {};
        for (const spec of declared) {
          seeded[spec.token] = current[spec.token]?.trim()
            ? current[spec.token]
            : initialValue(spec, report.raw, fromProject);
        }
        return seeded;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setStage(null);
    }
    },
    [fromProject],
  );

  /** The estimator path: the same bytes ⬇ Download RFC would produce. */
  const prepareFromEstimator = useCallback(async () => {
    setError(null);
    setStage("workbook");
    setBusy("Filling the RFC calculator from this project…");
    await nextPaint();
    try {
      const template = await fetchRfcTemplate();
      const { bytes, report } = await fillRfcWorkbook(template, project, result, proposal, {
        hardwareAllowance,
      });
      await loadWorkbook({
        bytes,
        label: `${project.setup.clientName || "This project"} — filled from the current estimator settings`,
        fillReport: report,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
      setStage(null);
    }
  }, [project, result, proposal, hardwareAllowance, loadWorkbook]);

  const onFile = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer();
      await loadWorkbook({ bytes: new Uint8Array(buffer), label: file.name });
    },
    [loadWorkbook],
  );

  /**
   * Switching source clears the loaded workbook, so the panels below never
   * describe a file the selector no longer points at.
   */
  const chooseSource = useCallback((next: Source) => {
    setSource(next);
    setWorkbook(null);
    setInspection(null);
    setOutcome(null);
    setError(null);
  }, []);

  /**
   * Pull 1 · Project's details in again, overwriting whatever is in the boxes.
   * Needed because the form is seeded once when the workbook loads, and the
   * intake is often filled in after someone has already opened this tab.
   */
  const refillFromProject = useCallback(() => {
    if (!specs || !inspection) return;
    setValues(() => {
      const seeded: Record<string, string> = {};
      for (const spec of specs) seeded[spec.token] = initialValue(spec, inspection.raw, fromProject);
      return seeded;
    });
  }, [specs, inspection, fromProject]);

  const visibleSpecs = useMemo(() => {
    if (!specs) return [];
    return specs.filter((spec) => {
      if (!spec.requires) return true;
      // `requires: has_history` and friends are detection flags.
      const flags = detection as unknown as Record<string, unknown> | undefined;
      return Boolean(flags?.[spec.requires]);
    });
  }, [specs, detection]);

  const removableSections = useMemo(() => {
    if (!sections) return [];
    const flags = detection as unknown as Record<string, unknown> | undefined;
    return sections.filter(
      (s) => s.removable && !s.parent && s.requires.every((flag) => Boolean(flags?.[flag])),
    );
  }, [sections, detection]);

  const generate = useCallback(
    async (force: boolean) => {
      if (!workbook) return;
      setError(null);
      setOutcome(null);
      setStage("generating");
      setBusy("Generating the proposal…");
      // Get the pending state on screen before the thread goes into WASM.
      await nextPaint();
      try {
        const operator: Record<string, unknown> = {};
        for (const spec of visibleSpecs) {
          const value = coerce(spec, values[spec.token] ?? "");
          if (value !== undefined) operator[spec.token] = value;
        }
        if (disabledSections.size > 0) operator.disabled_sections = [...disabledSections];

        const res = await generateProposal(workbook.bytes, operator, {
          force,
          onProgress: (m) => setBusy(m),
        });
        setOutcome(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
        setStage(null);
      }
    },
    [workbook, visibleSpecs, values, disabledSections],
  );

  const fillWarnings = workbook?.fillReport?.warnings ?? [];

  return (
    <div>
      <Section
        title="1 · Where the numbers come from"
        subtitle="The proposal is built from an RFC / MSRP calculator workbook. Use this project's, or bring your own."
      >
        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={source === "estimator"}
              onChange={() => chooseSource("estimator")}
            />
            <span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                Use the current estimator settings
              </span>
              <span className="block text-zinc-500 dark:text-zinc-400">
                Fills the RFC calculator from this project — the same file ⬇ Download RFC produces — and
                reads the proposal out of that.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={source === "import"}
              onChange={() => chooseSource("import")}
            />
            <span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Import an RFC workbook</span>
              <span className="block text-zinc-500 dark:text-zinc-400">
                Any RFC / MSRP calculator saved from Excel. A workbook with a Historical Data tab also gets
                the site-history sections, which this project&apos;s own export cannot provide.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-4">
          {source === "estimator" ? (
            <button
              type="button"
              onClick={prepareFromEstimator}
              disabled={Boolean(busy)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {workbook ? "Refresh from this project" : "Use this project"}
            </button>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={Boolean(busy)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Choose a workbook…
              </button>
            </>
          )}
          {workbook && (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              {workbook.label}{" "}
              <span className="text-zinc-400">({(workbook.bytes.length / 1024).toFixed(0)} KB)</span>
            </p>
          )}
        </div>

        {busy && stage === "workbook" && (
          <p className="mt-4 flex items-center gap-2 text-sm text-blue-700 dark:text-blue-400">
            <Spinner />
            <span>
              {busy}
              <span className="ml-2 text-zinc-400">
                The proposal generator is Python; the first run downloads it and takes a moment.
              </span>
            </span>
          </p>
        )}

        {error && (
          <pre className="mt-4 whitespace-pre-wrap rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </pre>
        )}

        {fillWarnings.length > 0 && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
            <p className="font-medium text-amber-900 dark:text-amber-300">
              Notes from filling the calculator
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-amber-900 dark:text-amber-200">
              {fillWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {inspection && (
        <>
          <Section title="2 · What the workbook says" subtitle="Read before you send anything.">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {inspection.summary_lines.map((line, i) => {
                // The agent formats these as "Label   value", aligned.
                const match = /^\s*(\S.*?)\s{2,}(.*)$/.exec(line);
                return (
                  <div key={i} className="flex justify-between gap-4 border-b border-zinc-100 pb-1 dark:border-zinc-800">
                    <dt className="text-zinc-500 dark:text-zinc-400">{match ? match[1] : line}</dt>
                    <dd className="font-medium text-zinc-900 dark:text-zinc-100">{match ? match[2] : ""}</dd>
                  </div>
                );
              })}
            </dl>
            {!detection?.has_history && (
              <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                This workbook has no <span className="font-medium">Historical Data</span> tab, so the
                site-history and baseline sections are left out and the rest renumber. That is expected for
                a workbook filled from the estimator — those sections describe metered performance of
                equipment already on site.
              </p>
            )}
            <FindingList findings={inspection.findings} />
          </Section>

          <Section
            title="3 · Proposal details"
            subtitle="Prefilled from 1 · Project where it knows the answer. Blanks are left out of the document rather than guessed."
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="text-zinc-500 dark:text-zinc-400">
                Contact, title, site name and address come from{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">1 · Project</span>.
              </p>
              <button
                type="button"
                onClick={refillFromProject}
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Refill from 1 · Project
              </button>
            </div>
            <Grid cols={2}>
              {visibleSpecs
                .filter((spec) => widgetFor(spec) !== "textarea")
                .map((spec) => {
                  const widget = widgetFor(spec);
                  return (
                    <Field
                      key={spec.token}
                      label={labelFor(spec)}
                      hint={widget === "percent" ? "Per cent, e.g. 3 for 3%" : undefined}
                    >
                      <input
                        className={inputCls}
                        type={widget === "date" ? "date" : widget === "text" ? "text" : "number"}
                        step={widget === "number" || widget === "percent" ? "any" : undefined}
                        value={values[spec.token] ?? ""}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [spec.token]: e.target.value }))
                        }
                      />
                    </Field>
                  );
                })}
            </Grid>
            {visibleSpecs
              .filter((spec) => widgetFor(spec) === "textarea")
              .map((spec) => (
                <div key={spec.token} className="mt-4">
                  <Field label={labelFor(spec)}>
                    <textarea
                      className={`${inputCls} min-h-24`}
                      value={values[spec.token] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [spec.token]: e.target.value }))}
                    />
                  </Field>
                </div>
              ))}
          </Section>

          {removableSections.length > 0 && (
            <Section
              title="4 · Sections to include"
              subtitle="Switch one off and the document renumbers itself, contents page included."
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {removableSections.map((s) => {
                  const off = disabledSections.has(s.key);
                  return (
                    <label key={s.key} className="flex cursor-pointer items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={!off}
                        onChange={() =>
                          setDisabledSections((current) => {
                            const next = new Set(current);
                            if (off) next.delete(s.key);
                            else next.add(s.key);
                            return next;
                          })
                        }
                      />
                      <span>
                        <span className="text-zinc-900 dark:text-zinc-100">{s.listName || s.title}</span>
                        {s.blurb && (
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{s.blurb}</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </Section>
          )}

          <Section
            title="5 · Generate"
            subtitle="Builds the editable Word document and a QA report. Nothing downloads until you ask for it."
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void generate(false)}
                disabled={Boolean(busy)}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {stage === "generating" && <Spinner />}
                {stage === "generating" ? "Generating…" : outcome ? "Generate again" : "Generate proposal"}
              </button>
              {outcome?.qa && (
                <button
                  type="button"
                  onClick={() => setShowQa((v) => !v)}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {showQa ? "Hide QA report" : "Show QA report"}
                </button>
              )}
            </div>

            {/*
              The generator runs on this thread, so while it is working the page
              genuinely cannot respond. Say so, rather than letting it look
              broken -- that is the whole complaint this panel answers. The
              spinner is CSS-driven so it keeps turning regardless.
            */}
            {stage === "generating" && (
              <div className="mt-4 flex items-start gap-3 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
                <Spinner className="mt-0.5 text-blue-700 dark:text-blue-400" />
                <div>
                  <p className="font-medium text-blue-900 dark:text-blue-300">
                    {busy ?? "Generating the proposal…"}
                  </p>
                  <p className="mt-1 text-blue-800 dark:text-blue-400">
                    This takes around ten to twenty seconds, and the page will not respond while it runs.
                    A download button appears here when the document is ready.
                  </p>
                </div>
              </div>
            )}

            {outcome && !outcome.ok && (
              <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
                <p className="font-medium text-red-900 dark:text-red-300">
                  No document was written. {outcome.error}
                </p>
                {outcome.detail && (
                  <pre className="mt-2 whitespace-pre-wrap text-red-800 dark:text-red-300">
                    {outcome.detail}
                  </pre>
                )}
                <FindingList findings={outcome.findings ?? []} />
                <p className="mt-3 text-red-900 dark:text-red-300">
                  These are the checks that stop a proposal going out with figures that do not add up. Fix
                  the workbook if you can — the QA report names the cells.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void generate(true)}
                    disabled={Boolean(busy)}
                    className="rounded-md border border-red-400 px-3 py-1.5 text-sm text-red-900 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
                  >
                    Generate anyway
                  </button>
                  {outcome.docx && (
                    <button
                      type="button"
                      onClick={() => downloadDocx(outcome.docx!, outcome.filename ?? "proposal.docx")}
                      className="rounded-md border border-red-400 px-3 py-1.5 text-sm text-red-900 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
                    >
                      ⬇ Download it anyway
                    </button>
                  )}
                </div>
              </div>
            )}

            {outcome?.ok && outcome.docx && (
              <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950">
                <p className="text-sm font-medium text-emerald-900 dark:text-emerald-300">
                  The proposal is ready.
                </p>
                <p className="mt-0.5 text-sm text-emerald-800 dark:text-emerald-400">
                  {outcome.filename}{" "}
                  <span className="text-emerald-700/70 dark:text-emerald-500">
                    ({(outcome.docx.length / 1024 / 1024).toFixed(2)} MB Word document)
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => downloadDocx(outcome.docx!, outcome.filename ?? "proposal.docx")}
                  className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  ⬇ Download proposal
                </button>
                <FindingList findings={outcome.findings ?? []} />
              </div>
            )}

            {showQa && outcome?.qa && (
              <pre className="slim-scroll mt-4 max-h-96 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                {outcome.qa}
              </pre>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
