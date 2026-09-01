"use client";

import {
  ADA_UNIT_COST,
  GPR_ITEM_NAME,
  INSTALL_METHOD_INFO,
  TERRAIN_INFO,
  adaStallBreakdownByLevel,
  buildQuickProject,
  countChargers,
  defaultQuickInput,
  normalizeQuickInput,
  estimateTimeline,
  timelineTotal,
} from "@/lib/calc/autoplan";
import { effectiveInstallMethod, surfaceRouteFt } from "@/lib/calc/install";
import type { InstallMethod, QuickEstimateInput, Terrain } from "@/lib/calc/types";
import { money, num } from "@/lib/format";
import { newId } from "@/lib/id";
import { useProject } from "./ProjectContext";
import { Field, Pill, Section, inputCls, selectCls } from "./ui";

const SERVICE_TOGGLES: {
  key: keyof Pick<
    QuickEstimateInput,
    | "includeChargerHardware"
    | "includeSitePlanDesign"
    | "includeSldDesign"
    | "includeCpm"
    | "includePermits"
    | "includePrivateScan"
  >;
  label: string;
  hint: string;
}[] = [
  { key: "includeChargerHardware", label: "Charger hardware", hint: "Budgetary allowance per unit — swap in vendor quotes later" },
  { key: "includeSitePlanDesign", label: "Site plan design (AutoCAD)", hint: "Parking layout, ADA stalls, equipment placement" },
  { key: "includeSldDesign", label: "SLD / electrical design", hint: "PE-stamped single-line diagram, load calcs, panel schedule" },
  { key: "includeCpm", label: "Construction PM (CPM)", hint: "Preconstruction + per-day site management hours" },
  { key: "includePermits", label: "Permitting fees", hint: "AHJ plan check (% of valuation), permit issuance, utility application" },
  { key: "includePrivateScan", label: "Private utility scan (GPR)", hint: "Locate unmarked lines along the trench route before digging" },
];

export function QuickEstimateTab() {
  const { project, setProject, hardwareAllowance } = useProject();
  // The quick intake is edited straight on the project (auto-saved on every
  // keystroke like the other tabs), NOT in local component state — a local
  // draft evaporated on tab switches / accidental closes, and a stale draft
  // could overwrite the client name on the next Build.
  const input: QuickEstimateInput = project.quick
    ? normalizeQuickInput(project.quick, project.setup)
    : defaultQuickInput();

  const chargerModels = project.loadTypes.filter((lt) => lt.category !== "Feeder");
  const totalChargers = input.lines.reduce((s, l) => s + Math.max(0, l.count), 0);
  const built = (project.quick?.lines.length ?? 0) > 0 && project.takeoff.length > 0;

  function set<K extends keyof QuickEstimateInput>(key: K, value: QuickEstimateInput[K]) {
    setProject((p) => ({
      ...p,
      quick: {
        ...(p.quick ? normalizeQuickInput(p.quick, p.setup) : defaultQuickInput()),
        [key]: value,
      },
    }));
  }

  function setSetup<K extends keyof typeof project.setup>(key: K, value: (typeof project.setup)[K]) {
    setProject((p) => ({ ...p, setup: { ...p.setup, [key]: value } }));
  }

  /** Client / site address live in both the quick intake and setup — keep
   * them in lockstep so nothing depends on when Build last ran. */
  function setIdentity(patch: { clientName?: string; siteAddress?: string }) {
    setProject((p) => ({
      ...p,
      setup: { ...p.setup, ...patch },
      quick: { ...(p.quick ? normalizeQuickInput(p.quick, p.setup) : defaultQuickInput()), ...patch },
    }));
  }

  function build() {
    setProject((p) =>
      buildQuickProject(
        p.quick ? normalizeQuickInput(p.quick, p.setup) : defaultQuickInput(),
        p,
        newId("qs"),
        hardwareAllowance,
      ),
    );
  }

  return (
    <div>
      <Section
        title="Describe the project"
        subtitle="Chargers, site conditions, and which services to include — wire sizes, gear, trenching, design fees, permits, scanning, labor and schedule all calculate automatically. Every derived number stays editable on the detail tabs."
      >
        {/* 1 — chargers */}
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">1 · Chargers</div>
        {input.lines.map((line, idx) => (
          <div key={idx} className="mb-2 flex items-center gap-2">
            <select
              className={selectCls}
              value={line.loadTypeId}
              onChange={(e) =>
                set("lines", input.lines.map((l, i) => (i === idx ? { ...l, loadTypeId: e.target.value } : l)))
              }
            >
              {chargerModels.map((lt) => (
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
                set("lines", input.lines.map((l, i) => (i === idx ? { ...l, count: Number(e.target.value) } : l)))
              }
            />
            {input.includeChargerHardware && (
              <span className="text-xs text-zinc-400">
                hardware allowance {money(hardwareAllowance[line.loadTypeId] ?? 0)}/unit
              </span>
            )}
            <button
              onClick={() => set("lines", input.lines.filter((_, i) => i !== idx))}
              className="text-zinc-400 hover:text-red-600"
              title="Remove line"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => set("lines", [...input.lines, { loadTypeId: chargerModels[0]?.id ?? "", count: 1 }])}
          className="mb-3 text-sm font-medium text-blue-600 hover:underline"
        >
          + Add charger model
        </button>

        <AdaCodeCard input={input} />


        {/* 2 — site. The identity fields live HERE only (they used to be
            duplicated on the Setup tab): client + address write both the
            quick intake and setup, so exports and the sidebar label follow
            immediately without waiting for a Build. */}
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">2 · Site</div>
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Client">
            <input className={inputCls} value={input.clientName} onChange={(e) => setIdentity({ clientName: e.target.value })} />
          </Field>
          <Field label="Site address">
            <input className={inputCls} value={input.siteAddress} onChange={(e) => setIdentity({ siteAddress: e.target.value })} />
          </Field>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Utility" hint="SDG&E, PG&E, SCE…">
            <input className={inputCls} value={project.setup.utility} onChange={(e) => setSetup("utility", e.target.value)} />
          </Field>
          <Field label="CPM (prepared by)">
            <input className={inputCls} value={project.setup.cpm} onChange={(e) => setSetup("cpm", e.target.value)} />
          </Field>
          <Field label="CRA">
            <input className={inputCls} value={project.setup.cra} onChange={(e) => setSetup("cra", e.target.value)} />
          </Field>
        </div>
        <div className="mb-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Distance to nearest L3 / DCFC (ft)" hint="One-way, power source → first DCFC">
            <input type="number" className={inputCls} value={input.firstRunFtDcfc} onChange={(e) => set("firstRunFtDcfc", Number(e.target.value))} />
          </Field>
          <Field label="Distance to nearest L2 (ft)" hint="One-way, power source → first L2">
            <input type="number" className={inputCls} value={input.firstRunFtL2} onChange={(e) => set("firstRunFtL2", Number(e.target.value))} />
          </Field>
          <Field label="Spacing per extra charger (ft)" hint="Added per extra charger of the same level">
            <input type="number" className={inputCls} value={input.stepFt} onChange={(e) => set("stepFt", Number(e.target.value))} />
          </Field>
        </div>
        <div className="mb-5">
          <div className="mb-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">Installation method</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(Object.keys(INSTALL_METHOD_INFO) as InstallMethod[]).map((m) => {
              const info = INSTALL_METHOD_INFO[m];
              const active = (input.installMethod ?? "trench") === m;
              return (
                <button
                  key={m}
                  onClick={() => set("installMethod", m)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40"
                      : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"
                  }`}
                >
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{info.label}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">{info.blurb}</div>
                  <div className="mt-1 text-xs font-medium text-blue-700 dark:text-blue-400">
                    {info.trench === "full"
                      ? "digs the whole route"
                      : info.trench === "service"
                        ? "digs only the service section"
                        : "no digging — strut racks every 10 ft"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="mb-5">
          <div className="mb-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">Terrain</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            {(Object.keys(TERRAIN_INFO) as Terrain[]).map((t) => {
              const info = TERRAIN_INFO[t];
              const active = input.terrain === t;
              return (
                <button
                  key={t}
                  onClick={() => set("terrain", t)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40"
                      : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"
                  }`}
                >
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{info.label}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">{info.blurb}</div>
                  <div className="mt-1 text-xs font-medium text-blue-700 dark:text-blue-400">
                    trenching ×{info.trenchFactor} · labor ×{info.laborFactor}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3 — services */}
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">3 · Included services</div>
        <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_TOGGLES.map((svc) => (
            <label
              key={svc.key}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:border-zinc-400 dark:border-zinc-700"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={input[svc.key]}
                onChange={(e) => set(svc.key, e.target.checked)}
              />
              <span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{svc.label}</span>
                <span className="block text-xs text-zinc-500">{svc.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={build}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            ⚡ Build full estimate
          </button>
          <span className="text-xs text-zinc-500">
            {totalChargers} charger{totalChargers === 1 ? "" : "s"} · rebuilding replaces the current takeoff and derived
            costs (export first to keep a version)
          </span>
        </div>
      </Section>

      {built && <BuildSummary />}
    </div>
  );
}

/**
 * Live CBC 11B-812 accessible-stall requirement for the counts currently
 * typed into the intake — shown before building, because accessible stalls
 * (regrade to 2%, aisles, signage, ramp) are real money the city will require.
 */
function AdaCodeCard({ input }: { input: QuickEstimateInput }) {
  const { project } = useProject();
  const counts = countChargers(input, project.loadTypes);
  // CBC 11B-228.3.2: each charging level is its own "facility" — the
  // 11B-228.3.2.1 table runs separately for L2 and DCFC, then sums.
  const byLevel = adaStallBreakdownByLevel(counts.nL2, counts.nDCFC);
  const ada = byLevel.combined;
  if (ada.total === 0) return null;
  const regrade = TERRAIN_INFO[input.terrain].adaRegradeFactor;
  const estCost =
    (ada.van * ADA_UNIT_COST.van +
      ada.standard * ADA_UNIT_COST.standard +
      ada.ambulatory * ADA_UNIT_COST.ambulatory) *
      regrade +
    ADA_UNIT_COST.ramp;
  const fmt = (b: typeof ada) =>
    [
      `${b.van} van`,
      b.standard > 0 ? `${b.standard} standard` : "",
      b.ambulatory > 0 ? `${b.ambulatory} ambulatory` : "",
    ]
      .filter(Boolean)
      .join(" + ");
  const mixed = counts.nL2 > 0 && counts.nDCFC > 0;
  return (
    <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      <span className="font-semibold text-amber-900 dark:text-amber-200">
        Accessibility code (CBC 11B-228.3 / 11B-812):
      </span>{" "}
      <span className="text-amber-900 dark:text-amber-100">
        {mixed ? (
          <>
            each charging level counts as its own facility — L2 ({counts.nL2}): {fmt(byLevel.l2)}; DCFC (
            {counts.nDCFC}): {fmt(byLevel.dcfc)}. Site total {fmt(ada)} accessible EVCS stall
            {ada.total === 1 ? "" : "s"}
          </>
        ) : (
          <>
            {counts.nChargers} charger{counts.nChargers === 1 ? "" : "s"} require {fmt(ada)} EVCS stall
            {ada.total === 1 ? "" : "s"}
          </>
        )}{" "}
        — budgeted ≈ {money(estCost)} incl. ramp
        {regrade > 1 && ` and ${TERRAIN_INFO[input.terrain].label.toLowerCase()} regrading to the 2% slope limit`}
        . Added to the estimate automatically.
      </span>
    </div>
  );
}

function BuildSummary() {
  const { project, result } = useProject();
  const { costs, rollups, peripherals, panel, qa } = result;
  const f = project.financial;
  const per = project.peripherals;
  const allOk = qa.every((q) => q.ok);

  const gpr = (per.customItems ?? []).find((c) => c.name === GPR_ITEM_NAME);
  const permitsTotal = f.planCheckPermitFee + per.permitFeeTotal + per.utilityAppFee;
  const timeline = estimateTimeline(project, result);
  const total = timelineTotal(timeline);
  const months = (d: number) => (d / 21).toFixed(1);

  return (
    <>
      <div className="mb-6 rounded-lg border border-zinc-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm dark:border-zinc-800 dark:from-zinc-900 dark:to-zinc-950">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-medium text-zinc-500">Estimated total cost</div>
            <div className="mt-1 text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {money(costs.totalCost)}
            </div>
          </div>
          <Pill ok={allOk}>{allOk ? "QA: all checks pass" : "QA: needs review"}</Pill>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          <SummaryChip label="Construction" value={money(costs.electricalSupplyConstructionTotal)} />
          <SummaryChip label="Labor" value={money(costs.labor)} />
          <SummaryChip label="Sales tax" value={money(costs.salesTaxOnConstruction + costs.equipmentPurchaseTax)} />
          <SummaryChip label="Charger hardware" value={money(costs.equipmentPurchaseInvoice)} />
          <SummaryChip label="Design & PM" value={money(costs.designInvoice)} />
        </div>
      </div>

      <Section
        title="What the estimate assumed"
        subtitle="Each of these landed in an editable field on the detail tabs — adjust there without losing the rest."
      >
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Assumption label="Chargers" value={`${num(rollups.nDCFC)} DCFC + ${num(rollups.nL2)} L2`} detail={`${num(rollups.nCircuits)} circuits`} />
          <Assumption label="Main switchgear" value={panel.bus480 ? `${panel.bus480.suggestedBusA}A @ 480V` : "208V service"} detail={panel.transformer ? `+ ${panel.transformer.suggestedKva} kVA step-down` : undefined} />
          <Assumption
            label="Install method"
            value={INSTALL_METHOD_INFO[effectiveInstallMethod(project.setup)].label}
            detail={
              effectiveInstallMethod(project.setup) === "trench"
                ? `${num(project.setup.trenchLengthFt)} ft trench · ${money(peripherals.asphaltTrenching)}`
                : `${num(surfaceRouteFt(project.setup, result.rollups.longestRunFt))} ft EMT route · ${num(
                    result.peripherals.lines.hardware.find((h) => h.name.startsWith("Strut trapeze"))?.qty ?? 0,
                  )} strut racks @ 10 ft (NEC 358.30)`
            }
          />
          <Assumption
            label="Trenching"
            value={project.setup.trenchLengthFt > 0 ? `${num(project.setup.trenchLengthFt)} ft × ${project.setup.trenchCostMultiplier ?? 1}` : "none"}
            detail={
              project.setup.trenchLengthFt > 0
                ? `${TERRAIN_INFO[project.setup.terrain ?? "flat"].label} · ${money(peripherals.asphaltTrenching)}`
                : "surface EMT — no digging"
            }
          />
          <Assumption label="Construction labor" value={`${num(f.laborBusinessDays)} business days`} detail={`${money(costs.labor)} crew cost`} />
          <Assumption label="Site plan design" value={money(f.autoCadDesignCost)} detail="AutoCAD layout, ADA, equipment placement" />
          <Assumption label="SLD / electrical design" value={money(f.electricalEngDesignCost)} detail="PE-stamped single-line & load calcs" />
          <Assumption label="Construction PM (CPM)" value={`${num(f.pmHours)} h · ${money(f.pmHours * f.pmHourlyRate)}`} detail={`at ${money(f.pmHourlyRate)}/h`} />
          <Assumption label="Permits & utility fees" value={money(permitsTotal)} detail={`plan check ${money(f.planCheckPermitFee)} · issuance ${money(per.permitFeeTotal)} · utility ${money(per.utilityAppFee)}`} />
          <Assumption label="Private utility scan" value={gpr ? `${num(gpr.qty)} day${gpr.qty === 1 ? "" : "s"} · ${money(gpr.qty * gpr.unitCost)}` : "not included"} detail={gpr ? "GPR along the trench route" : undefined} />
          <Assumption
            label="Accessible EVCS (ADA)"
            value={
              per.adaVanQty !== undefined || per.adaStdQty !== undefined || per.adaAmbQty !== undefined
                ? `${num(per.adaVanQty ?? 0)} van + ${num(per.adaStdQty ?? 0)} std + ${num(per.adaAmbQty ?? 0)} amb`
                : `${num(per.adaQtyOverride ?? 0)} stalls`
            }
            detail={`CBC 11B-812 table · ${money(peripherals.adaAllowance)} incl. ramp`}
          />
          <Assumption label="Spoils / dump" value={money(per.dumpWasteCost)} detail="terrain-scaled haul-off allowance" />
          <Assumption label="Charger hardware" value={money(f.chargerHardwareCost)} detail={f.chargerHardwareCost > 0 ? `+ ${money(f.evolvCommissioningCost)} commissioning` : "excluded"} />
        </div>
      </Section>

      {timeline.length > 0 && (
        <Section
          title="Estimated schedule"
          subtitle={`≈ ${total.lowDays}–${total.highDays} business days end-to-end (~${months(total.lowDays)}–${months(total.highDays)} months). Utility work runs in parallel but often decides the real finish date.`}
        >
          <ul className="space-y-1.5">
            {timeline.map((ph) => (
              <li key={ph.name} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                <span>
                  {ph.name}
                  {ph.parallel && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">parallel</span>}
                  {ph.note && <span className="block text-xs text-zinc-400">{ph.note}</span>}
                </span>
                <span className="whitespace-nowrap font-medium">
                  {ph.lowDays}–{ph.highDays} days
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}

function Assumption({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-medium text-zinc-900 dark:text-zinc-100">{value}</div>
      {detail && <div className="text-xs text-zinc-400">{detail}</div>}
    </div>
  );
}
