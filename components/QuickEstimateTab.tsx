"use client";

import {
  ADA_UNIT_COST,
  GPR_ITEM_NAME,
  INSTALL_METHOD_INFO,
  TERRAIN_INFO,
  adaStallBreakdownByLevel,
  countChargers,
  defaultQuickInput,
  normalizeQuickInput,
  estimateTimeline,
  timelineTotal,
} from "@/lib/calc/autoplan";
import { effectiveInstallMethod, surfaceRouteFt } from "@/lib/calc/install";
import type { InstallMethod, QuickEstimateInput, Terrain } from "@/lib/calc/types";
import { money, num, pct } from "@/lib/format";
import { findSku } from "@/lib/ref/priceBook";
import { rebuildProject } from "@/lib/intake/rebuild";
import { CHARGER_SKUS, EXTRA_SKUS, computeEquipmentSchedule, loadTypeIdForSku } from "@/lib/skus";
import { useProject } from "./ProjectContext";
import { useRebuild } from "./intake/useRebuild";
import { Field, Pill, Section, inputCls, selectCls, tableWrapCls, theadCls } from "./ui";

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
  { key: "includeChargerHardware", label: "Charger hardware", hint: "Price-book list per SKU (catalog allowance for generic models); warranty, service and EVOLV follow the Commercial tab's terms" },
  { key: "includeSitePlanDesign", label: "Site plan design (AutoCAD)", hint: "Parking layout, ADA stalls, equipment placement" },
  { key: "includeSldDesign", label: "SLD / electrical design", hint: "PE-stamped single-line diagram, load calcs, panel schedule" },
  { key: "includeCpm", label: "Construction PM (CPM)", hint: "15% of loaded construction labor — the CEO basis" },
  { key: "includePermits", label: "Permitting fees", hint: "AHJ plan check (% of valuation), permit issuance, utility application" },
  { key: "includePrivateScan", label: "Private utility scan (GPR)", hint: "Locate unmarked lines along the trench route before digging" },
];

// Price-book SKUs grouped the way the intake's capacity picker groups them.
const CHARGER_SKU_GROUPS: { capacity: string; skus: typeof CHARGER_SKUS }[] = [];
for (const s of CHARGER_SKUS) {
  const cap = s.capacity || "Other";
  const g = CHARGER_SKU_GROUPS.find((x) => x.capacity === cap);
  if (g) g.skus.push(s);
  else CHARGER_SKU_GROUPS.push({ capacity: cap, skus: [s] });
}
const shortDesc = (d: string) => (d.length > 56 ? `${d.slice(0, 54).trimEnd()}…` : d);

export function QuickEstimateTab() {
  const { project, setProject, hardwareAllowance, result } = useProject();
  const { auto, rebuild } = useRebuild();
  const schedule = computeEquipmentSchedule(project, hardwareAllowance);
  // The quick intake is edited straight on the project (auto-saved on every
  // keystroke like the other tabs), NOT in local component state — a local
  // draft evaporated on tab switches / accidental closes, and a stale draft
  // could overwrite the client name on the next Build.
  const input: QuickEstimateInput = project.quick
    ? normalizeQuickInput(project.quick, project.setup)
    : defaultQuickInput();

  const chargerModels = project.loadTypes.filter((lt) => lt.category !== "Feeder");
  const totalChargers = input.lines.reduce((s, l) => s + Math.max(0, l.count), 0);
  const built = project.takeoff.length > 0;

  // Every input here rebuilds the estimate as it changes (takeoff, gear, civil,
  // labour, fees); hand-pinned fields and hand-edited takeoff rows survive.
  // A takeoff typed row by row on the Takeoff tab is left alone until the
  // explicit build button below is used.
  function set<K extends keyof QuickEstimateInput>(key: K, value: QuickEstimateInput[K]) {
    rebuild((p) => ({
      ...p,
      quick: {
        ...(p.quick ? normalizeQuickInput(p.quick, p.setup) : defaultQuickInput()),
        [key]: value,
      },
    }));
  }

  function setSetup<K extends keyof typeof project.setup>(key: K, value: (typeof project.setup)[K]) {
    // The utility decides which substructures we furnish — rebuild on that one; CPM / CRA are labels.
    if (key === "utility") rebuild((p) => ({ ...p, setup: { ...p.setup, [key]: value } }));
    else setProject((p) => ({ ...p, setup: { ...p.setup, [key]: value } }));
  }

  /** Pick a price-book SKU for a line: the model follows the SKU; clearing it keeps the model as a generic line. */
  function setLineSku(idx: number, skuId: string) {
    set(
      "lines",
      input.lines.map((l, i) => {
        if (i !== idx) return l;
        if (!skuId) return { loadTypeId: l.loadTypeId, count: l.count };
        const s = findSku(skuId);
        const mapped = s ? loadTypeIdForSku(s) : null;
        return { ...l, sku: skuId, loadTypeId: mapped ?? l.loadTypeId };
      }),
    );
  }
  function setExtra(idx: number, patch: Partial<{ sku: string; count: number }>) {
    set("extras", (input.extras ?? []).map((x, i) => (i === idx ? { ...x, ...patch } : x)));
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
    // The engine sizes and prices from the load types, the SKU layer overlays
    // price-book list prices and the warranty / service / EVOLV lines, and any
    // field pinned by hand on the intake tabs (lib/intake/rebuild) is restored.
    setProject((p) => rebuildProject(p, hardwareAllowance));
  }

  return (
    <div>
      <Section
        title="Describe the project"
        subtitle="Chargers, site conditions, and which services to include — wire sizes, gear, trenching, design fees, permits, scanning, labor and schedule all calculate automatically. Every derived number stays editable on the detail tabs."
      >
        {/* 1 — chargers */}
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">1 · Chargers</div>
        {input.lines.map((line, idx) => {
          const sku = line.sku ? findSku(line.sku) : undefined;
          return (
            <div key={idx} className="mb-2 flex flex-wrap items-center gap-2">
              <select
                className={`${selectCls} max-w-xs`}
                value={line.sku ?? ""}
                title="Price-book SKU — sets the model and prices the line at the book's list price"
                onChange={(e) => setLineSku(idx, e.target.value)}
              >
                <option value="">Generic model (catalog allowance)</option>
                {CHARGER_SKU_GROUPS.map((g) => (
                  <optgroup key={g.capacity} label={g.capacity}>
                    {g.skus.map((s) => (
                      <option key={s.sku} value={s.sku}>
                        {s.sku} — {shortDesc(s.description)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <select
                className={selectCls}
                value={line.loadTypeId}
                disabled={!!sku}
                title={sku ? "Model derived from the SKU" : "Charger model the engine sizes with"}
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
                  {sku
                    ? `list ${money(sku.msrp)}/unit · price book`
                    : `hardware allowance ${money(hardwareAllowance[line.loadTypeId] ?? 0)}/unit`}
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
          );
        })}
        <button
          onClick={() => set("lines", [...input.lines, { loadTypeId: chargerModels[0]?.id ?? "", count: 1 }])}
          className="mb-3 text-sm font-medium text-blue-600 hover:underline"
        >
          + Add charger model
        </button>

        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Dispensers &amp; accessories <span className="font-normal normal-case">— price-book items without a circuit of their own</span>
        </div>
        {(input.extras ?? []).map((x, idx) => {
          const s = findSku(x.sku);
          return (
            <div key={idx} className="mb-2 flex flex-wrap items-center gap-2">
              <select className={`${selectCls} max-w-md`} value={x.sku} onChange={(e) => setExtra(idx, { sku: e.target.value })}>
                {EXTRA_SKUS.map((e) => (
                  <option key={e.sku} value={e.sku}>
                    {e.sku} — {shortDesc(e.description)}
                  </option>
                ))}
              </select>
              <span className="text-sm text-zinc-500">×</span>
              <input
                type="number"
                min={1}
                className={`${inputCls} w-20`}
                value={x.count}
                onChange={(e) => setExtra(idx, { count: Number(e.target.value) })}
              />
              <span className="text-xs text-zinc-400">
                {s ? `list ${money(s.msrp)}/unit${s.role === "dispenser" ? " · 2 ports" : ""}` : "not in the price book"}
              </span>
              <button
                onClick={() => set("extras", (input.extras ?? []).filter((_, i) => i !== idx))}
                className="text-zinc-400 hover:text-red-600"
                title="Remove line"
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          onClick={() => set("extras", [...(input.extras ?? []), { sku: EXTRA_SKUS[0]?.sku ?? "", count: 1 }])}
          className="mb-3 text-sm font-medium text-blue-600 hover:underline"
        >
          + Add dispenser / accessory
        </button>
        {schedule.warnings.length > 0 && (
          <ul className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {schedule.warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        )}

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

        {auto ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900 dark:bg-green-950/30 dark:text-green-100">
            <span>
              Live — {totalChargers} charger{totalChargers === 1 ? "" : "s"} · the estimate rebuilds as you type · Total Cost {money(result.costs.totalCost)}
            </span>
            <button onClick={build} className="text-xs font-medium text-green-800 underline hover:no-underline dark:text-green-200" title="Regenerate from these inputs now (nothing to catch up on unless a field was pinned)">
              rebuild now
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={build} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              ⚡ Build from these inputs
            </button>
            <span className="text-xs text-zinc-500">
              This project&apos;s takeoff was typed row by row on the Takeoff tab, so it is not regenerated automatically. Building replaces it with rows generated from the chargers above (rows marked manual stay).
            </span>
          </div>
        )}
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
  const { project, result, hardwareAllowance } = useProject();
  const { costs, rollups, peripherals, panel, qa } = result;
  const schedule = computeEquipmentSchedule(project, hardwareAllowance);
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
          <Assumption label="Construction PM (CPM)" value={`${pct(f.pmPctOfLabor ?? 0)} of loaded labor · ${money(costs.constructionPm)}`} detail="CEO basis — intake 2.9.0 Construction tab" />
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
          <Assumption
            label="Charger hardware"
            value={money(f.chargerHardwareCost)}
            detail={
              f.chargerHardwareCost > 0
                ? f.serviceTermsAuto
                  ? `+ warranty ${money(f.chargerWarrantyCost)} · service ${money(f.fiveYearServiceCost)} · EVOLV ${money(f.evolvCommissioningCost)} — price book, ${schedule.terms.contractYears}-yr contract`
                  : `+ ${money(f.evolvCommissioningCost)} commissioning`
                : "excluded"
            }
          />
        </div>
      </Section>

      {schedule.lines.length > 0 && (
        <Section
          title="Equipment schedule"
          subtitle={`Price book ${schedule.terms.basis === "price-book" ? "terms" : "list prices"}: ${schedule.terms.contractYears}-year contract · EVOLV $${schedule.terms.evolvPerPortMonth.toFixed(2)}/port/month · warranty beyond the included years plus in-warranty service every contract year. Terms live on the Commercial tab.`}
        >
          <div className={tableWrapCls}>
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className={theadCls}>
                <tr>
                  {["Item", "Qty", "List $/unit", "List total", "Ports", "Service class", "Ext. warranty", "Service", "EVOLV"].map((h, i) => (
                    <th key={h} className={`px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 ${i > 0 ? "text-right" : "text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {schedule.lines.map((l, i) => (
                  <tr key={`${l.sku ?? l.loadTypeId}-${i}`} title={l.warnings.join(" · ")}>
                    <td className="max-w-md px-3 py-1.5">
                      <div className="truncate">{l.description}</div>
                      <div className="text-xs text-zinc-400">{l.priceBasis}{l.loadTypeId && l.sku ? ` · sized as ${l.loadTypeId}` : ""}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{num(l.count)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(l.unitList)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(l.listTotal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{num(l.ports)}</td>
                    <td className="px-3 py-1.5 text-right text-xs text-zinc-500">{l.serviceClass ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(l.warrantyTotal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(l.serviceTotal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(l.evolvTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-zinc-50 font-medium dark:bg-zinc-900">
                <tr>
                  <td className="px-3 py-1.5">Total</td>
                  <td />
                  <td />
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(schedule.hardwareList)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{num(schedule.ports)}</td>
                  <td />
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(schedule.warrantyTotal)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(schedule.serviceTotal)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(schedule.evolvTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {schedule.warnings.length > 0 && (
            <ul className="mt-3 text-xs text-amber-800 dark:text-amber-300">
              {schedule.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          )}
        </Section>
      )}

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
