"use client";

import { tableWrapCls, theadCls } from "../ui";
import { INSTALL_METHOD_INFO, TERRAIN_INFO, defaultQuickInput, normalizeQuickInput } from "@/lib/calc/autoplan";
import { feederFloorA } from "@/lib/calc/chain";
import type { DistributionFeeder, InstallMethod, Material, QuickEstimateInput, Terrain } from "@/lib/calc/types";
import { DISTRIBUTION_COST_BASES, DISTRIBUTION_PROVIDERS, DISTRIBUTION_TYPES, clearGearQuotePricing, distributionScheduleOf, emptyScheduleRow, estimatedGearTotal, gearPricedAtSchedule, priceGearAtSchedule, scheduledGearTotal, withCatalogPrice } from "@/lib/intake/schedule";
import type { DistributionScheduleRow } from "@/lib/proposal/types";
import { utilityCivilFor } from "@/lib/calc/utilityCivil";
import type { StickyPath } from "@/lib/intake/rebuild";
import { feederOutOfScope, feederScopeNote } from "@/lib/interconnection";
import { defaultIntake } from "@/lib/proposal/defaults";
import { money, num } from "@/lib/format";
import { MaterialRatesSection } from "../MaterialRatesSection";
import { useProject } from "../ProjectContext";
import { InterconnectionSection } from "../IntakeTab";
import { Field, Grid, Pill, Section, inputCls, selectCls } from "../ui";
import { useRebuild } from "./useRebuild";

// 3 · Electrical — the intake's Electrical tab (3.7.0): the sizing basis, the
// charger-run table (one row per unit — DC and Level 2 alike), the service and
// switchgear, the Rule 29 block, the distribution schedule and, since 3.7.0,
// the feeders between the items on it (block I). Inputs are the
// Quick Estimate's; the tables are the engine's sizing, live.

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap";
const thNum = `${th} text-right`;
const td = "px-3 py-1.5 whitespace-nowrap";
const tdNum = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
const wrap = tableWrapCls;
const table = "min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800";

/** A number the estimator derives from the utility's rule: type to pin it, “→ auto” to hand it back. */
function PinnedMoney({ label, hint, path, value, step }: { label: string; hint?: string; path: StickyPath; value: number; step?: string }) {
  const { pin, unpin, pinned } = useRebuild();
  const typed = pinned(path);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input type="number" step={step ?? "any"} className={inputCls} value={value} onChange={(e) => pin(path, Number(e.target.value))} />
        <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${typed ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{typed ? "typed" : "auto"}</span>
        {typed && (
          <button className="whitespace-nowrap text-xs font-medium text-blue-600 hover:underline" onClick={() => unpin(path)}>
            → auto
          </button>
        )}
      </div>
    </Field>
  );
}

export function ElectricalSection() {
  const { project, result, setProject } = useProject();
  const { rebuild } = useRebuild();
  const input: QuickEstimateInput = project.quick ? normalizeQuickInput(project.quick, project.setup) : defaultQuickInput();
  const s = project.setup;
  const chain = s.serviceChain;
  const feederByUtility = feederOutOfScope(project.intake?.interconnection?.serviceFeederBy);

  const setQuick = (patch: Partial<QuickEstimateInput>) =>
    rebuild((p) => ({ ...p, quick: { ...(p.quick ? normalizeQuickInput(p.quick, p.setup) : defaultQuickInput()), ...patch } }));
  const setSetup = (patch: Partial<typeof s>) => rebuild((p) => ({ ...p, setup: { ...p.setup, ...patch } }));
  const setChainDistance = (ft: number) =>
    setSetup({
      serviceChain: {
        ...(chain ?? { enabled: true, material: "Al", utilityToSwitchgearFt: 25, switchgearToTransformerFt: 15, transformerToSubpanelFt: 15 }),
        utilityToSwitchgearFt: ft,
      },
    });
  const setFrame = (v: string) => setSetup({ gearOverrides: { ...s.gearOverrides, switchgear480A: v === "" ? undefined : Number(v) } });
  const setIntake = (patch: Partial<NonNullable<typeof project.intake>>) => rebuild((p) => ({ ...p, intake: { ...(p.intake ?? defaultIntake()), ...patch } }));
  const setAmbient = (v: string) =>
    rebuild((p) => ({ ...p, intake: { ...(p.intake ?? defaultIntake()), designAmbientC: v === "" ? null : Number(v) } }));

  const dcRows = result.rows.filter((r) => !r.synthetic && r.category === "DCFC");
  const l2Rows = result.rows.filter((r) => !r.synthetic && r.category === "L2");
  const svc = result.rows.filter((r) => r.synthetic && !r.loadTypeId.startsWith("FDR"));
  // Block I — the feeders between the items on the schedule: the engine's rows (auto pair or typed) and the typed register behind them.
  const feederRows = result.rows.filter((r) => r.synthetic && r.loadTypeId.startsWith("FDR"));
  const typedFeeders: DistributionFeeder[] = chain?.feeders ?? [];
  const scheduleItems: { name: string; type: string; volts: number | null; phases: number | null; ratingA: number | null }[] = project.intake?.distributionSchedule?.length
    ? project.intake.distributionSchedule.map((r) => ({ name: r.item, type: r.type, volts: r.volts, phases: r.phases, ratingA: r.ratingA }))
    : result.panel.suggestedGear
        .filter((g) => g.qty > 0)
        .map((g) => ({ name: `${g.item} ${g.size}`.trim(), type: g.item, volts: Number(String(g.voltage).replace(/[^\d.]/g, "")) || null, phases: 3, ratingA: /a$/i.test(g.size.trim()) ? Number(g.size.replace(/[^\d.]/g, "")) || null : null }));
  const setFeeders = (feeders: DistributionFeeder[]) =>
    setSetup({
      serviceChain: {
        ...(chain ?? { enabled: true, material: s.feederMaterial, utilityToSwitchgearFt: 25, switchgearToTransformerFt: 15, transformerToSubpanelFt: 15 }),
        ...(feeders.length ? { feeders } : { feeders: undefined }),
      },
    });
  /** Volts, phases and the floor of a feeder come from the item it feeds — a transformer takes the FROM item's volts, else the service voltage. */
  const resolveFeeder = (f: DistributionFeeder): DistributionFeeder => {
    const to = scheduleItems.find((x) => x.name.trim().toLowerCase() === f.to.trim().toLowerCase());
    const from = scheduleItems.find((x) => x.name.trim().toLowerCase() === f.from.trim().toLowerCase());
    const serviceVolts = project.intake?.existingServiceVoltage ?? 480;
    const voltage = (/^transformer$/i.test(to?.type ?? "") ? (from?.volts ?? serviceVolts) : to?.volts) ?? serviceVolts;
    return { ...f, voltage, phases: to?.phases === 1 ? 1 : 3, ...(to?.ratingA ? { ratingA: to.ratingA } : { ratingA: undefined }) };
  };
  const setFeeder = (i: number, patch: Partial<DistributionFeeder>) => setFeeders(typedFeeders.map((f, k) => (k === i ? resolveFeeder({ ...f, ...patch }) : f)));
  const addFeeder = () => setFeeders([...typedFeeders, resolveFeeder({ from: scheduleItems[0]?.name ?? "", to: scheduleItems[1]?.name ?? "", distanceFt: 0, voltage: 480, phases: 3 })]);
  const removeFeeder = (i: number) => setFeeders(typedFeeders.filter((_, k) => k !== i));
  const optNum = (v: string) => (v === "" ? undefined : Number(v));
  // Block E as data: the engine's rows, or the typed schedule with its vendor quotes.
  const schedule = distributionScheduleOf(project, result);
  const setSchedule = (rows: DistributionScheduleRow[]) => setProject((p) => ({ ...p, intake: { ...(p.intake ?? defaultIntake()), distributionSchedule: rows.length ? rows : undefined } }));
  // A row's price follows the catalog as its type, rating, volts or quantity change — until a vendor quote is chosen, which is then typed by hand.
  const setRow = (i: number, patch: Partial<DistributionScheduleRow>) =>
    setSchedule(schedule.rows.map((r, k) => (k === i ? ("quotedCost" in patch ? { ...r, ...patch } : withCatalogPrice({ ...r, ...patch })) : r)));
  const editSchedule = () => setSchedule(schedule.rows.map((r) => ({ ...r })));
  const quotedTotal = scheduledGearTotal(schedule.rows);
  const estimated = estimatedGearTotal(schedule.rows);
  const gearAtQuotes = gearPricedAtSchedule(project);
  const engineGearTotal = result.costs.lines.filter((l) => l.name === "Main Distribution Switchgear" || l.name === "Electrical Sub-Panels, Transformers, Breakers").reduce((t, l) => t + l.base, 0);
  const bus480 = result.panel.bus480;
  const bus208 = result.panel.bus208;
  const lineNo = (loadTypeId: string) => {
    const i = input.lines.filter((l) => l.count > 0).findIndex((l) => l.loadTypeId === loadTypeId);
    return i < 0 ? "—" : String(i + 1);
  };
  const cabinets = input.lines.some((l) => l.count > 0 && l.loadTypeId.startsWith("Power cabinet"));
  const civil = utilityCivilFor(s.utility, result.rollups, feederByUtility, project.intake?.interconnection?.serviceType === "Added load to existing service");

  return (
    <div>
      <Section title="3 · Electrical — materials and routing" subtitle="Conductor material, how the conduit gets there, the ground it crosses, and the run distances. Everything below re-sizes as these change.">
        <Grid cols={4}>
          <Field label="Feeder conductor material" hint="Cu or Al — the branch runs to the chargers">
            <select
              className={selectCls}
              value={s.feederMaterial}
              onChange={(e) => {
                // The intake has ONE conductor material (Electrical B6) and prices the feeders in it too — the chain follows.
                const material = e.target.value as Material;
                setSetup({ feederMaterial: material, serviceChain: { ...(chain ?? { enabled: true, utilityToSwitchgearFt: 25, switchgearToTransformerFt: 15, transformerToSubpanelFt: 15 }), material } });
              }}
            >
              <option value="Cu">Cu</option>
              <option value="Al">Al</option>
            </select>
          </Field>
          <Field label="Distance to nearest DC unit (ft)" hint="One-way, power source → first cabinet / all-in-one">
            <input type="number" className={inputCls} value={input.firstRunFtDcfc} onChange={(e) => setQuick({ firstRunFtDcfc: Number(e.target.value) })} />
          </Field>
          <Field label="Distance to nearest Level 2 (ft)" hint="One-way, power source → first L2 unit">
            <input type="number" className={inputCls} value={input.firstRunFtL2} onChange={(e) => setQuick({ firstRunFtL2: Number(e.target.value) })} />
          </Field>
          <Field label="Spacing per extra unit (ft)" hint="Added per further unit of the same level">
            <input type="number" className={inputCls} value={input.stepFt} onChange={(e) => setQuick({ stepFt: Number(e.target.value) })} />
          </Field>
          <Field label="Design ambient (°C)" hint="Site data for the intake's Electrical!B10 — ASHRAE 2% design dry-bulb, or the duct-bank temperature for buried runs. Every charger-run verdict on the intake waits for it; the estimator sizes without it.">
            <input type="number" className={inputCls} value={project.intake?.designAmbientC ?? ""} placeholder="e.g. 40" onChange={(e) => setAmbient(e.target.value)} />
          </Field>
          <Field label="Trench surface" hint="Intake B8 — what the trench cuts through">
            <select className={selectCls} value={project.intake?.trenchSurface ?? ""} onChange={(e) => setIntake({ trenchSurface: e.target.value || undefined })}>
              <option value="">Mixed (template default)</option>
              {["Asphalt", "Concrete", "Landscape", "Mixed"].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Trench depth (in)" hint="Intake B9 — blank = the template's 24 in">
            <input type="number" className={inputCls} placeholder="24" value={project.intake?.trenchDepthIn ?? ""} onChange={(e) => setIntake({ trenchDepthIn: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
        </Grid>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">Conduit type and installation method</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(Object.keys(INSTALL_METHOD_INFO) as InstallMethod[]).map((m) => {
                const info = INSTALL_METHOD_INFO[m];
                const active = (input.installMethod ?? "trench") === m;
                return (
                  <button key={m} onClick={() => setQuick({ installMethod: m })} className={`rounded-lg border p-3 text-left transition-colors ${active ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40" : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"}`}>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{info.label}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">{m === "trench" ? "PVC in open-cut trench" : m === "surface" ? "EMT on strut, no digging" : "EMT to the chargers, trench for the service section"}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">Trench surface / terrain</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(TERRAIN_INFO) as Terrain[]).map((t) => {
                const info = TERRAIN_INFO[t];
                const active = input.terrain === t;
                return (
                  <button key={t} onClick={() => setQuick({ terrain: t })} className={`rounded-lg border p-3 text-left transition-colors ${active ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40" : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"}`}>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{info.label}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">trench ×{info.trenchFactor}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-3 text-xs text-zinc-500">
          {s.trenchLengthFt > 0 ? `${num(s.trenchLengthFt)} ft of trench · ` : "no digging · "}
          {num(result.rollups.totalConductorFt)} ft conductor · {num(result.rollups.totalConduitFt)} ft conduit · longest run {num(result.rollups.longestRunFt)} ft
        </div>
      </Section>

      <Section title="AC runs — one per AC-connected unit" subtitle="The engine's sizing per unit: design current, breaker, conductor, parallel sets, conduit and the voltage-drop verdict. These fill the intake's charger-run table (Electrical rows 18–77, one row per unit, DC and Level 2 in Equipment order) — distance, sets, and the conductor and conduit as overrides beside the sheet's own sizing.">
        {dcRows.length === 0 ? (
          <div className="text-sm text-zinc-500">No DC units yet — add charger lines on 2 · Equipment.</div>
        ) : (
          <div className={wrap}>
            <table className={table}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Unit</th>
                  <th className={th}>Equip. line</th>
                  <th className={thNum}>Distance (ft)</th>
                  <th className={thNum}>Design A</th>
                  <th className={thNum}>OCPD A</th>
                  <th className={th}>Conductor</th>
                  <th className={thNum}>Sets</th>
                  <th className={th}>Conduit</th>
                  <th className={th}>Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {dcRows.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.location}</td>
                    <td className={`${td} text-zinc-500`}>{lineNo(r.loadTypeId)}</td>
                    <td className={tdNum}>{num(r.oneWayDistFt)}</td>
                    <td className={tdNum}>{num(r.designAmps, 0)}</td>
                    <td className={tdNum}>{num(r.ocpdA)}</td>
                    <td className={td}>{r.selectedWire} {r.material}</td>
                    <td className={tdNum}>{num(r.resolvedRunsPerUnit)}</td>
                    <td className={td}>{r.conduitSize}</td>
                    <td className={td}>
                      <Pill ok={!r.flag || r.flag === "OK"}>{r.flag || "OK"}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <MaterialRatesSection compact />

      <Section title="Service and switchgear" subtitle="Where the site connects, the customer-side feeder, and the frame being priced. The Rule 29 block below records the utility's side.">
        <Grid cols={4}>
          <Field label="Transformer to switchgear (ft)" hint={feederOutOfScope(project.intake?.interconnection?.serviceFeederBy) ? `${feederScopeNote(project.intake?.interconnection?.serviceFeederBy)} (0)` : feederScopeNote(project.intake?.interconnection?.serviceFeederBy)}>
            <input type="number" className={inputCls} value={chain?.utilityToSwitchgearFt ?? 25} disabled={feederByUtility} onChange={(e) => setChainDistance(Number(e.target.value))} />
          </Field>
          <Field label="Switchgear size being priced (A)" hint={bus480 ? `Code minimum ${num(bus480.autoBusA)} A at 125% of ${num(bus480.connectedAmps, 0)} A connected — blank = auto` : bus208 ? `208 V service · code minimum ${num(bus208.autoBusA)} A` : "no load yet"}>
            <input type="number" className={inputCls} placeholder={bus480 ? String(bus480.autoBusA) : "auto"} value={s.gearOverrides?.switchgear480A ?? ""} onChange={(e) => setFrame(e.target.value)} />
          </Field>
          <Field label="Connected load" hint="AC input at nameplate">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm tabular-nums dark:border-zinc-800 dark:bg-zinc-900">
              {bus480 ? `${num(bus480.connectedAmps, 0)} A · demand ${num(bus480.demandAmps, 0)} A` : bus208 ? `${num(bus208.connectedAmps, 0)} A at 208 V` : "—"}
            </div>
          </Field>
          <Field label="Step-down transformer" hint="Only on a mixed 480/208 V site">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm tabular-nums dark:border-zinc-800 dark:bg-zinc-900">
              {result.panel.transformer ? `${num(result.panel.transformer.suggestedKva)} kVA` : "none"}
            </div>
          </Field>
        </Grid>
        <div className="mt-3 text-xs text-zinc-500">Load management and multi-board lineups are not modelled: the service is sized at full nameplate on one board. Say so in the notes if the design differs.</div>
        {svc.length > 0 && (
          <div className={`${wrap} mt-4`}>
            <table className={table}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Service run</th>
                  <th className={thNum}>Distance (ft)</th>
                  <th className={th}>Conductor</th>
                  <th className={thNum}>Sets</th>
                  <th className={th}>Conduit</th>
                  <th className={thNum}>Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {svc.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.loadTypeId.replace(/^SVC /, "")}</td>
                    <td className={tdNum}>{num(r.oneWayDistFt)}</td>
                    <td className={td}>{r.selectedWire} {r.material}</td>
                    <td className={tdNum}>{num(r.resolvedRunsPerUnit)}</td>
                    <td className={td}>{r.conduitSize}</td>
                    <td className={tdNum}>{money(r.rowTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Utility substructures we install"
        subtitle={`${civil.label}. ${civil.basis} Source: ${civil.source}. Installed budgets pending the utility's design — type over a value to pin it.`}
      >
        <Grid cols={4}>
          <PinnedMoney label="Transformer pad ($)" hint="Three-phase precast pad on base rock, grounded" path="peripherals.transformerPadCost" value={project.peripherals.transformerPadCost} />
          <PinnedMoney label="Cable well ($)" hint="Under the pad (SMUD) or the secondary handhole (SDG&E)" path="peripherals.cableWellCost" value={project.peripherals.cableWellCost} />
          <PinnedMoney label="Pull boxes (ea)" hint="Utility pull boxes on the primary / secondary route" path="peripherals.pullBoxQty" value={project.peripherals.pullBoxQty} step="1" />
          <PinnedMoney label="Pull box unit cost ($)" hint="Traffic-rated precast, installed" path="peripherals.pullBoxUnitCost" value={project.peripherals.pullBoxUnitCost} />
          <PinnedMoney label="Christy box at the point of connection (ea)" hint="Concrete box with traffic lid" path="peripherals.serviceBoxQty" value={project.peripherals.serviceBoxQty ?? 0} step="1" />
          <PinnedMoney label="Christy box unit cost ($)" hint="Installed — the shop's $600" path="peripherals.serviceBoxUnitCost" value={project.peripherals.serviceBoxUnitCost ?? 600} />
          <Field label="Utility line, before uplift" hint="application fee + pad + well + pull boxes + sand + vaults → intake override row 14">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm tabular-nums dark:border-zinc-800 dark:bg-zinc-900">{money(result.costs.lines.find((l) => l.name === "Utility")?.base ?? 0)}</div>
          </Field>
        </Grid>
      </Section>

      <InterconnectionSection />

      {l2Rows.length > 0 && (
        <Section title="Level 2 circuits" subtitle="One circuit per run, at the unit's distance. On the intake a dual pedestal is one charger-run row with two sets (Electrical rows 18–77).">
          <div className={wrap}>
            <table className={table}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Unit</th>
                  <th className={th}>Equip. line</th>
                  <th className={thNum}>Volts</th>
                  <th className={thNum}>Amps per circuit</th>
                  <th className={thNum}>Circuits</th>
                  <th className={thNum}>Breaker (A)</th>
                  <th className={thNum}>Distance (ft)</th>
                  <th className={th}>Conductor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {l2Rows.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.location}</td>
                    <td className={`${td} text-zinc-500`}>{lineNo(r.loadTypeId)}</td>
                    <td className={tdNum}>{num(r.volts)}</td>
                    <td className={tdNum}>{num(r.designAmps, 1)}</td>
                    <td className={tdNum}>{num(r.resolvedRunsPerUnit * Math.max(1, r.units))}</td>
                    <td className={tdNum}>{num(r.ocpdA)}</td>
                    <td className={tdNum}>{num(r.oneWayDistFt)}</td>
                    <td className={td}>{r.selectedWire} {r.material}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section
        title="Distribution equipment schedule"
        subtitle="Intake Electrical block E (rows 165–176). The engine lists its own gear with the estimator's catalog price in the cost column — the sheet's gear total is the sum of that column, nothing else. Edit the schedule to describe the real lineup: a typed row prices itself from the catalog by type and rating; pick “Vendor quote” to type the vendor's figure instead. Then price the switchgear line at the schedule so the estimate and the sheet agree."
      >
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${schedule.typed ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{schedule.typed ? "typed" : "auto"}</span>
          {!schedule.typed && (
            <button className="font-medium text-blue-600 hover:underline" onClick={editSchedule}>
              Edit the schedule
            </button>
          )}
          {schedule.typed && (
            <>
              <button className="font-medium text-blue-600 hover:underline" onClick={() => setSchedule([...schedule.rows, emptyScheduleRow()])}>
                + Add a row
              </button>
              <button className="font-medium text-blue-600 hover:underline" onClick={() => setSchedule([])}>
                → engine&apos;s schedule
              </button>
            </>
          )}
        </div>
        {schedule.rows.length === 0 ? (
          <div className="text-sm text-zinc-500">No gear yet.</div>
        ) : (
          <div className={wrap}>
            <table className={table}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Item</th>
                  <th className={th}>Type</th>
                  <th className={thNum}>Qty</th>
                  <th className={thNum}>Volts</th>
                  <th className={thNum}>Ph</th>
                  <th className={thNum}>Rating (A)</th>
                  <th className={th}>Fed from</th>
                  <th className={th}>Feeds</th>
                  <th className={th}>Location</th>
                  <th className={th}>Who provides</th>
                  <th className={th}>Cost basis</th>
                  <th className={thNum}>Quoted ($)</th>
                  {schedule.typed && <th className={th} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {schedule.rows.map((r, i) =>
                  schedule.typed ? (
                    <tr key={i}>
                      <td className={td}>
                        <input className={`${inputCls} min-w-[16rem]`} value={r.item} onChange={(e) => setRow(i, { item: e.target.value })} />
                      </td>
                      <td className={td}>
                        <select className={selectCls} value={r.type} onChange={(e) => setRow(i, { type: e.target.value })}>
                          {DISTRIBUTION_TYPES.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={`${inputCls} w-16`} value={r.qty ?? ""} onChange={(e) => setRow(i, { qty: e.target.value === "" ? null : Number(e.target.value) })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={`${inputCls} w-20`} value={r.volts ?? ""} onChange={(e) => setRow(i, { volts: e.target.value === "" ? null : Number(e.target.value) })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={`${inputCls} w-14`} value={r.phases ?? ""} onChange={(e) => setRow(i, { phases: e.target.value === "" ? null : Number(e.target.value) })} />
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={`${inputCls} w-20`} value={r.ratingA ?? ""} onChange={(e) => setRow(i, { ratingA: e.target.value === "" ? null : Number(e.target.value) })} />
                      </td>
                      <td className={td}>
                        <input className={`${inputCls} min-w-[10rem]`} list="distribution-feeder-items" value={r.fedFrom} onChange={(e) => setRow(i, { fedFrom: e.target.value })} />
                      </td>
                      <td className={td}>
                        <input className={`${inputCls} min-w-[10rem]`} value={r.feeds} onChange={(e) => setRow(i, { feeds: e.target.value })} />
                      </td>
                      <td className={td}>
                        <input className={`${inputCls} w-28`} value={r.location} onChange={(e) => setRow(i, { location: e.target.value })} />
                      </td>
                      <td className={td}>
                        <select className={selectCls} value={r.whoProvides} onChange={(e) => setRow(i, { whoProvides: e.target.value })}>
                          {DISTRIBUTION_PROVIDERS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={td}>
                        <select className={selectCls} value={r.costBasis} onChange={(e) => setRow(i, { costBasis: e.target.value })}>
                          {DISTRIBUTION_COST_BASES.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={tdNum}>
                        <input type="number" className={`${inputCls} w-24`} value={r.quotedCost ?? ""} onChange={(e) => setRow(i, { quotedCost: e.target.value === "" ? null : Number(e.target.value) })} />
                      </td>
                      <td className={td}>
                        <button type="button" className="text-xs text-zinc-500 hover:text-red-600" title="Remove this row" onClick={() => setSchedule(schedule.rows.filter((_, k) => k !== i))}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={i}>
                      <td className={td}>{r.item}</td>
                      <td className={td}>{r.type}</td>
                      <td className={tdNum}>{r.qty ?? ""}</td>
                      <td className={tdNum}>{r.volts ?? ""}</td>
                      <td className={tdNum}>{r.phases ?? ""}</td>
                      <td className={tdNum}>{r.ratingA ?? ""}</td>
                      <td className={td}>{r.fedFrom}</td>
                      <td className={td}>{r.feeds}</td>
                      <td className={td}>{r.location}</td>
                      <td className={td}>{r.whoProvides}</td>
                      <td className={td}>{r.costBasis}</td>
                      <td className={tdNum}>{r.quotedCost === null ? "—" : money(r.quotedCost)}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
        {!schedule.typed && schedule.rows.length > 0 && (
          <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            Priced on the sheet at <span className="font-medium tabular-nums">{money(quotedTotal)}</span> — the estimator&apos;s switchgear and sub-panels lines, {money(engineGearTotal)}, from the same catalog.
            {Math.abs(quotedTotal - engineGearTotal) > 0.5 && <span className="ml-1 text-amber-800 dark:text-amber-300">The two differ — a gear line override is in force on the Overrides tab.</span>}
          </div>
        )}
        {schedule.typed && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span>
              Schedule total on the rows we provide: <span className="font-medium tabular-nums">{money(quotedTotal)}</span>
              {estimated.filled.length > 0 && <span className="ml-1 text-amber-800 dark:text-amber-300">+ {estimated.filled.length} unpriced row(s) the estimate carries at the catalog ({money(estimated.total)} in all) — the sheet will read UNPRICED until they are typed</span>}
            </span>
            {gearAtQuotes ? (
              <>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">switchgear line priced at the schedule</span>
                {Math.abs(estimated.total - (project.overrides ?? []).find((o) => o.key.endsWith("Main Distribution Switchgear"))!.value) > 0.005 && (
                  <button className="font-medium text-blue-600 hover:underline" onClick={() => setProject((p) => priceGearAtSchedule(p, schedule.rows))}>
                    re-apply {money(estimated.total)}
                  </button>
                )}
                <button className="font-medium text-blue-600 hover:underline" onClick={() => setProject((p) => clearGearQuotePricing(p))}>
                  → catalog pricing
                </button>
              </>
            ) : (
              <button className="rounded-md border border-zinc-200 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" disabled={estimated.total <= 0} onClick={() => setProject((p) => priceGearAtSchedule(p, schedule.rows))}>
                Price the switchgear line at the schedule ({money(estimated.total)})
              </button>
            )}
            <span className="text-xs text-zinc-500">Writes the register: switchgear line = the schedule&apos;s total, sub-panels / transformers / breakers line = 0 (they are on the schedule). The sheet&apos;s B178 carries the same total.</span>
          </div>
        )}
        {cabinets && <div className="mt-3 text-xs text-amber-800 dark:text-amber-300">Distributed system: the cabinets&apos; AC feeders are sized here; the cabinet-to-dispenser DC runs are not in the takeoff yet and stay blank on the intake (rows 174–205).</div>}
      </Section>

      <Section
        title="Distribution feeders — between the items on the schedule"
        subtitle="The wire between the boxes (intake 3.7.0 Electrical block I, rows 242–253), priced into the wire line on both sides. Nothing typed = the engine's switchgear → transformer → sub-panel pair. Type the site's own feeders to replace it: the floor is the rating of the item fed unless you type one, the engine sizes at floor ÷ 1.25 the way the sheet does, and the sheet reads the conductor and sets as overrides."
      >
        {feederRows.length === 0 && typedFeeders.length === 0 ? (
          <div className="text-sm text-zinc-500">No feeders to price: a single-voltage site with no step-down transformer has none between the boxes. Add one below if the schedule has a panel or remote disconnect fed by its own run.</div>
        ) : (
          <div className={wrap}>
            <table className={table}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Feeder</th>
                  <th className={thNum}>Distance (ft)</th>
                  <th className={thNum}>Floor (A)</th>
                  <th className={th}>Conductor</th>
                  <th className={thNum}>Sets</th>
                  <th className={th}>Conduit</th>
                  <th className={thNum}>Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {feederRows.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{r.location}</td>
                    <td className={tdNum}>{num(r.oneWayDistFt)}</td>
                    <td className={tdNum}>{num(Math.ceil(r.designAmps * s.continuousLoadFactor))}</td>
                    <td className={td}>
                      {r.selectedWire} {r.material}
                    </td>
                    <td className={tdNum}>{num(r.resolvedRunsPerUnit)}</td>
                    <td className={td}>{r.conduitSize}</td>
                    <td className={tdNum}>{money(r.rowTotal)}</td>
                  </tr>
                ))}
                {typedFeeders.map((f, i) =>
                  feederRows.some((r) => r.location === `${f.from.trim() || "?"} → ${f.to.trim() || "?"}`) ? null : (
                    <tr key={`unsized-${i}`} className="text-amber-800 dark:text-amber-300">
                      <td className={td}>
                        {f.from || "?"} → {f.to || "?"}
                      </td>
                      <td className={tdNum}>{num(f.distanceFt)}</td>
                      <td className={tdNum}>{feederFloorA(f) > 0 ? num(feederFloorA(f)) : "—"}</td>
                      <td className={td} colSpan={4}>
                        {feederFloorA(f) <= 0 ? "no floor — the item fed is not on the schedule with a rating; type a floor" : f.distanceFt <= 0 ? "no distance — not priced" : "not sized"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
        {chain && feederRows.length > 0 && chain.material !== s.feederMaterial && (
          <div className="mt-3 text-xs text-amber-800 dark:text-amber-300">
            The sheet prices block I in the site material ({s.feederMaterial}); the estimator&apos;s feeder segments are {chain.material}, so the fill leaves their conductors to the sheet. Set the service-chain material on the Setup tab to {s.feederMaterial} for the two to price alike.
          </div>
        )}
        <datalist id="distribution-feeder-items">
          {scheduleItems.map((x) => (
            <option key={x.name} value={x.name} />
          ))}
        </datalist>
        <div className="mt-4 space-y-3">
          {typedFeeders.map((f, i) => (
            <Grid cols={3} key={i}>
              <Field label="From" hint="item or board it runs from">
                <input className={inputCls} list="distribution-feeder-items" value={f.from} onChange={(e) => setFeeder(i, { from: e.target.value })} />
              </Field>
              <Field label="To" hint={f.ratingA ? `${num(f.ratingA)} A · ${num(f.voltage)} V — sets the floor` : "item on the schedule it feeds"}>
                <input className={inputCls} list="distribution-feeder-items" value={f.to} onChange={(e) => setFeeder(i, { to: e.target.value })} />
              </Field>
              <Field label="Distance (ft)">
                <input type="number" className={inputCls} value={f.distanceFt || ""} onChange={(e) => setFeeder(i, { distanceFt: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Floor (A)" hint="blank = the item's rating">
                <input type="number" className={inputCls} placeholder={f.ratingA ? String(f.ratingA) : "type one"} value={f.floorA ?? ""} onChange={(e) => setFeeder(i, { floorA: optNum(e.target.value) })} />
              </Field>
              <Field label="Sets" hint="blank = engine chooses">
                <input type="number" className={inputCls} placeholder="auto" value={f.sets ?? ""} onChange={(e) => setFeeder(i, { sets: optNum(e.target.value) })} />
              </Field>
              <Field label="Conductor override" hint='e.g. "250 kcmil", "2/0 AWG"'>
                <div className="flex gap-2">
                  <input className={inputCls} placeholder="auto" value={f.conductorOverride ?? ""} onChange={(e) => setFeeder(i, { conductorOverride: e.target.value || undefined })} />
                  <button type="button" className="shrink-0 rounded-md border border-zinc-200 px-2 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => removeFeeder(i)} title="Remove this feeder">
                    ✕
                  </button>
                </div>
              </Field>
            </Grid>
          ))}
          <button type="button" className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={addFeeder}>
            + Add a feeder
          </button>
          {typedFeeders.length > 0 && <div className="text-xs text-zinc-500">Typed feeders replace the engine&apos;s guessed pair. Remove every row to go back to it.</div>}
        </div>
      </Section>
    </div>
  );
}
