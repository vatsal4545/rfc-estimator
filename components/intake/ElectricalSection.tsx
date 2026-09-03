"use client";

import { INSTALL_METHOD_INFO, TERRAIN_INFO, defaultQuickInput, normalizeQuickInput } from "@/lib/calc/autoplan";
import type { InstallMethod, Material, QuickEstimateInput, Terrain } from "@/lib/calc/types";
import { utilityCivilFor } from "@/lib/calc/utilityCivil";
import type { StickyPath } from "@/lib/intake/rebuild";
import { money, num } from "@/lib/format";
import { MaterialRatesSection } from "../MaterialRatesSection";
import { useProject } from "../ProjectContext";
import { InterconnectionSection } from "../IntakeTab";
import { Field, Grid, Pill, Section, inputCls, selectCls } from "../ui";
import { useRebuild } from "./useRebuild";

// 3 · Electrical — the intake's Electrical tab: materials and routing, the AC
// run per unit, the service and switchgear, the Rule 29 block, the Level 2
// circuits and the distribution schedule. Inputs are the Quick Estimate's;
// the tables are the engine's sizing, live.

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 whitespace-nowrap";
const thNum = `${th} text-right`;
const td = "px-3 py-1.5 whitespace-nowrap";
const tdNum = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
const wrap = "overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800";
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
  const { project, result } = useProject();
  const { rebuild } = useRebuild();
  const input: QuickEstimateInput = project.quick ? normalizeQuickInput(project.quick, project.setup) : defaultQuickInput();
  const s = project.setup;
  const chain = s.serviceChain;
  const feederByUtility = (project.intake?.interconnection?.serviceFeederBy ?? "").startsWith("Utility");

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

  const dcRows = result.rows.filter((r) => !r.synthetic && r.category === "DCFC");
  const l2Rows = result.rows.filter((r) => !r.synthetic && r.category === "L2");
  const svc = result.rows.filter((r) => r.synthetic);
  const bus480 = result.panel.bus480;
  const bus208 = result.panel.bus208;
  const lineNo = (loadTypeId: string) => {
    const i = input.lines.filter((l) => l.count > 0).findIndex((l) => l.loadTypeId === loadTypeId);
    return i < 0 ? "—" : String(i + 1);
  };
  const cabinets = input.lines.some((l) => l.count > 0 && l.loadTypeId.startsWith("Power cabinet"));
  const civil = utilityCivilFor(s.utility, result.rollups, feederByUtility);

  return (
    <div>
      <Section title="3 · Electrical — materials and routing" subtitle="Conductor material, how the conduit gets there, the ground it crosses, and the run distances. Everything below re-sizes as these change.">
        <Grid cols={4}>
          <Field label="Feeder conductor material" hint="Cu or Al — the branch runs to the chargers">
            <select className={selectCls} value={s.feederMaterial} onChange={(e) => setSetup({ feederMaterial: e.target.value as Material })}>
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

      <Section title="AC runs — one per AC-connected unit" subtitle="The engine's sizing per unit: design current, breaker, conductor, parallel sets, conduit and the voltage-drop verdict. These fill the intake's Electrical rows 12–23.">
        {dcRows.length === 0 ? (
          <div className="text-sm text-zinc-500">No DC units yet — add charger lines on 2 · Equipment.</div>
        ) : (
          <div className={wrap}>
            <table className={table}>
              <thead className="bg-zinc-50 dark:bg-zinc-900">
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
          <Field label="Transformer to switchgear (ft)" hint={feederByUtility ? "The utility provides this run under its EV infrastructure rule — out of our scope (0)" : "Customer-side feeder, our scope"}>
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
              <thead className="bg-zinc-50 dark:bg-zinc-900">
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
        <Section title="Level 2 circuits" subtitle="One circuit per run, at the unit's distance. These fill the intake's Electrical rows 151–166.">
          <div className={wrap}>
            <table className={table}>
              <thead className="bg-zinc-50 dark:bg-zinc-900">
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

      <Section title="Distribution equipment schedule" subtitle="What the panel schedule calls for. Priced on the switchgear line; the intake receives it as documented, never priced twice.">
        {result.panel.suggestedGear.filter((g) => g.qty > 0).length === 0 ? (
          <div className="text-sm text-zinc-500">No gear yet.</div>
        ) : (
          <div className={wrap}>
            <table className={table}>
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className={th}>Item</th>
                  <th className={th}>Size</th>
                  <th className={th}>Voltage</th>
                  <th className={thNum}>Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {result.panel.suggestedGear
                  .filter((g) => g.qty > 0)
                  .map((g, i) => (
                    <tr key={`${g.item}-${i}`}>
                      <td className={td}>{g.item}</td>
                      <td className={td}>{g.size}</td>
                      <td className={td}>{g.voltage}</td>
                      <td className={tdNum}>{num(g.qty)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {cabinets && <div className="mt-3 text-xs text-amber-800 dark:text-amber-300">Distributed system: the cabinets&apos; AC feeders are sized here; the cabinet-to-dispenser DC runs are not in the takeoff yet and stay blank on the intake (rows 174–205).</div>}
      </Section>
    </div>
  );
}
