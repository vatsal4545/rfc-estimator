"use client";

import { INTAKE_TEMPLATE } from "@/lib/intake/cells";
import { money, pct } from "@/lib/format";
import { defaultCommercial, defaultServiceTerms } from "@/lib/proposal/defaults";
import {
  SCOPE_LABELS,
  type BuildupGroup,
  type CommercialInput,
  type MarginAssumptions,
  type ScopeLine,
  type ScopeStatus,
  type ServiceTerms,
} from "@/lib/proposal/types";
import { computeEquipmentSchedule, reconcileServiceTerms } from "@/lib/skus";
import { useProject } from "./ProjectContext";
import { Field, Grid, Section, inputCls, selectCls, tableWrapCls, theadCls } from "./ui";

// Commercial — the CEO's price layer (EVSE Project Intake terms and the
// Best Western Business_Model), computed from the estimator's cost result.
// Total Cost never changes here: this tab turns it into a customer price and
// shows the margin that price carries.

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500";
const thNum = `${th} text-right`;
const td = "px-3 py-1.5";
const tdNum = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
const tableCls = "min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800";
const wrapCls = tableWrapCls;
const subtotalCls = "bg-zinc-50 font-medium dark:bg-zinc-900";

const GROUPS: { key: BuildupGroup; label: string }[] = [
  { key: "equipment", label: "Equipment purchase invoice" },
  { key: "design", label: "Design and engineering" },
  { key: "construction", label: "Construction — all-inclusive" },
  { key: "passThrough", label: "Utility and third-party pass-through" },
  { key: "additional", label: "Additional scope" },
];

const STATUS_LABEL: Record<ScopeStatus, string> = { we: "We provide", others: "By others", none: "Not required" };

function PctField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" step="0.01" className={inputCls} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

export function CommercialTab() {
  const { project, setProject, result, proposal, hardwareAllowance } = useProject();
  const c = project.commercial;

  if (!c || !proposal) {
    return (
      <Section
        title="Commercial — customer price, margin, scope of supply"
        subtitle="This project was saved before the price layer existed. Its Total Cost is unchanged; add the CEO's commercial terms to price it."
      >
        <button
          onClick={() => setProject((p) => ({ ...p, commercial: defaultCommercial() }))}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Set up pricing with the intake {INTAKE_TEMPLATE.version} defaults
        </button>
        <p className="mt-3 text-xs text-zinc-500">
          20% markup on materials and labour · 7% off hardware, service and in-house work · permits and utility fees passed
          through at cost · full scope with Zero Impact Energy. Every value stays editable here afterwards.
        </p>
      </Section>
    );
  }

  const { costBuildup: b, margin: m } = proposal;
  const costs = result.costs;

  function update<K extends keyof CommercialInput>(key: K, value: CommercialInput[K]) {
    setProject((p) => ({ ...p, commercial: { ...(p.commercial ?? defaultCommercial()), [key]: value } }));
  }
  function updateMargin<K extends keyof MarginAssumptions>(key: K, value: MarginAssumptions[K]) {
    setProject((p) => {
      const cur = p.commercial ?? defaultCommercial();
      return { ...p, commercial: { ...cur, margin: { ...cur.margin, [key]: value } } };
    });
  }
  function setScope(line: ScopeLine, status: ScopeStatus) {
    update("scope", { ...c!.scope, [line]: status });
  }
  function togglePassThrough(name: string, on: boolean) {
    const next = on ? [...new Set([...c!.passThroughLines, name])] : c!.passThroughLines.filter((n) => n !== name);
    update("passThroughLines", next);
  }
  const terms = c.serviceTerms ?? defaultServiceTerms();
  const schedule = computeEquipmentSchedule(project, hardwareAllowance);
  function setTerms(patch: Partial<ServiceTerms>) {
    setProject((p) => {
      const cur = p.commercial ?? defaultCommercial();
      const next = { ...p, commercial: { ...cur, serviceTerms: { ...(cur.serviceTerms ?? defaultServiceTerms()), ...patch } } };
      return reconcileServiceTerms(next, hardwareAllowance);
    });
  }

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium uppercase text-zinc-500">Total Cost (estimator)</div>
          <div className="mt-1 text-2xl font-bold">{money(costs.totalCost)}</div>
          <div className="mt-1 text-xs text-zinc-500">unchanged — the engine&apos;s number</div>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/30">
          <div className="text-xs font-medium uppercase text-zinc-500">Customer price</div>
          <div className="mt-1 text-2xl font-bold text-blue-800 dark:text-blue-200">{money(b.customerPrice)}</div>
          <div className="mt-1 text-xs text-zinc-500">
            list {money(b.listTotal)} · discount {money(b.discountToCustomer)}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium uppercase text-zinc-500">Our contract value</div>
          <div className="mt-1 text-2xl font-bold">{money(m.contractValue)}</div>
          <div className="mt-1 text-xs text-zinc-500">
            {m.thirdPartyTotal > 0 ? `+ ${money(m.thirdPartyTotal)} by others → client project ${money(m.clientProjectCost)}` : m.scopeCheck}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-medium uppercase text-zinc-500">Gross margin</div>
          <div className="mt-1 text-2xl font-bold">{money(m.grossMargin)}</div>
          <div className="mt-1 text-xs text-zinc-500">
            {m.marginRate !== null ? `${pct(m.marginRate)} of contract` : "—"}
            {m.largestMarginLine ? ` · largest: ${m.largestMarginLine.label.split(" — ")[0]} (${pct(m.largestMarginLine.share)})` : ""}
          </div>
        </div>
      </div>

      <Section
        title="Markups and discounts"
        subtitle={`Intake ${INTAKE_TEMPLATE.version} house terms. Markups turn cost into price on materials and labour; discounts come off list (hardware, service, EVOLV) or off in-house work (labour, construction PM, design). Enter whole percents: 7 = 7%.`}
      >
        <Grid cols={3}>
          <PctField label="Markup on materials" hint="Switchgear, conductor, conduit, site works, rentals — after contingency" value={c.markupMaterialsPct} onChange={(v) => update("markupMaterialsPct", v)} />
          <PctField label="Markup on labour" hint="Labour and construction PM — after contingency" value={c.markupLaborPct} onChange={(v) => update("markupLaborPct", v)} />
          <PctField label="Hardware discount" hint="Off the price-book list; tax is computed on the discounted price" value={c.discountHardwarePct} onChange={(v) => update("discountHardwarePct", v)} />
          <PctField label="Service and warranty discount" value={c.discountServicePct} onChange={(v) => update("discountServicePct", v)} />
          <PctField label="EVOLV and commissioning discount" value={c.discountEvolvPct} onChange={(v) => update("discountEvolvPct", v)} />
          <PctField label="In-house services discount" hint="ONLY labour, construction PM, design and engineering — never materials or rentals" value={c.discountInHousePct} onChange={(v) => update("discountInHousePct", v)} />
        </Grid>
      </Section>

      <Section
        title="Service and network terms"
        subtitle="Price-book basis: extended warranty is the class's yearly warranty for every contract year beyond the included ones, service is the in-warranty service rate every contract year, EVOLV bills per port per month. Auto-applied to the Financials tab while its lines are on auto; rebuild after switching to the estimator's allowances."
      >
        <Grid cols={4}>
          <Field label="Basis">
            <select className={selectCls} value={terms.basis} onChange={(e) => setTerms({ basis: e.target.value as ServiceTerms["basis"] })}>
              <option value="price-book">Price book service classes (CEO)</option>
              <option value="allowance">Estimator commissioning allowances</option>
            </select>
          </Field>
          <Field label="Contract length (years)" hint={`Intake ${INTAKE_TEMPLATE.version}: 5`}>
            <input type="number" min={0} className={inputCls} value={terms.contractYears} onChange={(e) => setTerms({ contractYears: Number(e.target.value) })} />
          </Field>
          <Field label="EVOLV network $/port/month" hint={`Intake ${INTAKE_TEMPLATE.version}: $39.99`}>
            <input type="number" step="0.01" className={inputCls} value={terms.evolvPerPortMonth} onChange={(e) => setTerms({ evolvPerPortMonth: Number(e.target.value) })} />
          </Field>
          <Field label="Included warranty years (override)" hint="Blank = the class's own: DC 2 years, AC 1 year">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={terms.includedWarrantyYears ?? ""}
              onChange={(e) => setTerms({ includedWarrantyYears: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </Field>
        </Grid>
        <div className="mt-3 text-xs text-zinc-500">
          Schedule: {schedule.ports} ports · list {money(schedule.hardwareList)} · extended warranty {money(schedule.warrantyTotal)} · service{" "}
          {money(schedule.serviceTotal)} · EVOLV {money(schedule.evolvTotal)}
          {project.financial.serviceTermsAuto ? " — applied to the Financials tab (auto)." : " — the Financials tab holds manual values."}
        </div>
      </Section>

      <Section
        title="Tax, pass-through fees and extra lines"
        subtitle="Pass-through fees are charges levied by someone else — billed at exactly what they cost, no contingency, markup or discount."
      >
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" className="h-4 w-4" checked={c.taxConstructionMaterials} onChange={(e) => update("taxConstructionMaterials", e.target.checked)} />
          Charge sales tax on construction materials at their marked-up price (its own row; California taxes materials). Off
          reproduces the Best Western model, which taxed the discounted hardware only.
        </label>
        <div className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">Estimator lines billed as pass-through</div>
        <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {costs.lines.map((line) => (
            <label key={line.name} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" className="h-4 w-4" checked={c.passThroughLines.includes(line.name)} onChange={(e) => togglePassThrough(line.name, e.target.checked)} />
              {line.name}
            </label>
          ))}
        </div>
        <Grid cols={3}>
          <div className="mt-4">
            <Field label="Utility interconnection design / application fee ($)" hint="Rule 29 design fee where the serving utility charges one. Pass-through.">
              <input type="number" className={inputCls} value={c.utilityInterconnectFee} onChange={(e) => update("utilityInterconnectFee", Number(e.target.value))} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Additional or unforeseen scope ($)" hint="Anything the standard build does not cover. Pass-through.">
              <input type="number" className={inputCls} value={c.additionalScope} onChange={(e) => update("additionalScope", Number(e.target.value))} />
            </Field>
          </div>
        </Grid>
      </Section>

      <Section
        title="Cost build-up — list price, discount, customer price"
        subtitle="Every estimator line with its uplift class. Cost is what the estimator carries (contingency-loaded where it loads it); List adds the markup or is the price-book MSRP; Price is after discounts."
      >
        <div className={wrapCls}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Line</th>
                <th className={th}>Class</th>
                <th className={thNum}>Estimator cost</th>
                <th className={thNum}>List</th>
                <th className={thNum}>Discount</th>
                <th className={thNum}>Customer price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {GROUPS.map((g) => {
                const rows = b.rows.filter((r) => r.group === g.key);
                if (rows.length === 0) return null;
                const sub = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
                return (
                  <FragmentRows key={g.key}>
                    <tr className="bg-zinc-100/70 dark:bg-zinc-800/60">
                      <td className={`${td} text-xs font-semibold uppercase tracking-wide text-zinc-500`} colSpan={6}>
                        {g.label}
                      </td>
                    </tr>
                    {rows.map((r) => (
                      <tr key={r.id} title={r.note}>
                        <td className={td}>{r.label}</td>
                        <td className={`${td} text-xs text-zinc-500`}>{r.uplift === "passThrough" ? "pass-through" : r.uplift === "inHouse" ? "in-house" : r.uplift}</td>
                        <td className={tdNum}>{money(r.cost)}</td>
                        <td className={tdNum}>{money(r.list)}</td>
                        <td className={`${tdNum} text-zinc-500`}>{r.discountPct ? pct(r.discountPct) : "—"}</td>
                        <td className={`${tdNum} font-medium`}>{money(r.price)}</td>
                      </tr>
                    ))}
                    <tr className={subtotalCls}>
                      <td className={td} colSpan={2}>
                        {g.label} subtotal
                      </td>
                      <td className={tdNum}>{money(sub((r) => r.cost))}</td>
                      <td className={tdNum}>{money(sub((r) => r.list))}</td>
                      <td className={tdNum} />
                      <td className={tdNum}>{money(sub((r) => r.price))}</td>
                    </tr>
                  </FragmentRows>
                );
              })}
            </tbody>
            <tfoot className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <td className={td} colSpan={3}>
                  Grand total (list)
                </td>
                <td className={`${tdNum} font-medium`}>{money(b.listTotal)}</td>
                <td className={tdNum} />
                <td className={tdNum} />
              </tr>
              <tr>
                <td className={td} colSpan={5}>
                  Discount to customer
                </td>
                <td className={`${tdNum} text-zinc-500`}>−{money(b.discountToCustomer)}</td>
              </tr>
              <tr className="text-base font-semibold">
                <td className={td} colSpan={5}>
                  CUSTOMER PRICE / FINANCED AMOUNT
                </td>
                <td className={tdNum}>{money(b.customerPrice)}</td>
              </tr>
              <tr className="text-xs text-zinc-500">
                <td className={td} colSpan={5}>
                  Estimator Total Cost, for the side-by-side (contingency-loaded, RFC_V18 tax convention)
                </td>
                <td className={tdNum}>{money(b.estimatorTotalCost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section
        title="Scope of supply and margin by line"
        subtitle="Switch a line to “By others” and it leaves our contract value but stays in the client's project cost; “Not required” drops it from both. Sales tax follows the hardware line."
      >
        <div className={wrapCls}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Service line</th>
                <th className={th}>Who provides</th>
                <th className={thNum}>Our price</th>
                <th className={thNum}>Our cost</th>
                <th className={thNum}>Margin</th>
                <th className={thNum}>Margin %</th>
                <th className={thNum}>To the client</th>
                <th className={th}>Cost basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {m.rows.map((r) => (
                <tr key={r.line} className={r.status !== "we" ? "text-zinc-400" : undefined}>
                  <td className={td}>{SCOPE_LABELS[r.line]}</td>
                  <td className={td}>
                    {r.line === "salesTax" ? (
                      <span className="text-xs text-zinc-500">follows hardware · {STATUS_LABEL[r.status]}</span>
                    ) : (
                      <select className={`${selectCls} py-1`} value={r.status} onChange={(e) => setScope(r.line, e.target.value as ScopeStatus)}>
                        {(["we", "others", "none"] as ScopeStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className={tdNum}>{money(r.price)}</td>
                  <td className={tdNum}>{money(r.cost)}</td>
                  <td className={`${tdNum} font-medium`}>{money(r.margin)}</td>
                  <td className={tdNum}>{r.marginPct !== null ? pct(r.marginPct) : "—"}</td>
                  <td className={tdNum}>{money(r.toClient)}</td>
                  <td className={`${td} text-xs text-zinc-500`}>{r.basis}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-zinc-50 font-medium dark:bg-zinc-900">
              <tr>
                <td className={td} colSpan={2}>
                  OUR CONTRACT VALUE
                </td>
                <td className={tdNum}>{money(m.contractValue)}</td>
                <td className={tdNum}>{money(m.ourCost)}</td>
                <td className={tdNum}>{money(m.grossMargin)}</td>
                <td className={tdNum}>{m.marginRate !== null ? pct(m.marginRate) : "—"}</td>
                <td className={tdNum}>{money(m.clientProjectCost)}</td>
                <td className={`${td} text-xs font-normal text-zinc-500`}>{m.scopeCheck}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section
        title="Cost basis behind the margin"
        subtitle="The Business_Model assumptions. Each is a stand-in until the real cost is known — replace them as quotes arrive. Enter decimals."
      >
        <Grid cols={4}>
          <Field label="Our hardware cost, total ($)" hint="Dealer price × units. Leave blank to use the share of list below.">
            <input
              type="number"
              className={inputCls}
              value={c.margin.hardwareCostTotal ?? ""}
              placeholder={money(b.rows.find((r) => r.id === "hardware")!.list * c.margin.hardwarePctOfList)}
              onChange={(e) => updateMargin("hardwareCostTotal", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Field>
          <PctField label="Hardware cost, share of list" hint="BW: $118,107 on $401,654 list ≈ 0.294" value={c.margin.hardwarePctOfList} onChange={(v) => updateMargin("hardwarePctOfList", v)} />
          <PctField label="Service cost, share of price" hint="BW assumption 0.55" value={c.margin.servicePctOfPrice} onChange={(v) => updateMargin("servicePctOfPrice", v)} />
          <PctField label="EVOLV cost, share of price" hint="Platform fees paid through — BW 0.45" value={c.margin.evolvPctOfPrice} onChange={(v) => updateMargin("evolvPctOfPrice", v)} />
          <PctField label="Design cost, share of price" hint="In-house hours at cost — BW 0.60" value={c.margin.designPctOfPrice} onChange={(v) => updateMargin("designPctOfPrice", v)} />
          <PctField label="Interconnection cost, share of price" hint="BW 0.70" value={c.margin.interconnectPctOfPrice} onChange={(v) => updateMargin("interconnectPctOfPrice", v)} />
          <PctField label="Contingency expected to be spent" hint="Unspent contingency falls to margin — BW 0.50" value={c.margin.contingencySpendShare} onChange={(v) => updateMargin("contingencySpendShare", v)} />
          <PctField label="PM fee internal cost" hint="The rest of the construction PM fee is margin — BW 0.30" value={c.margin.pmInternalCostPct} onChange={(v) => updateMargin("pmInternalCostPct", v)} />
        </Grid>
      </Section>

      <Section
        title="Construction margin build-up"
        subtitle="Construction is three different things with three different margins: materials carry the materials markup, labour carries contingency and the labour markup, and PM is a fee. Contingency is a reserve — what is not spent falls through to margin."
      >
        <div className={wrapCls}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Component</th>
                <th className={thNum}>Price</th>
                <th className={thNum}>Base cost</th>
                <th className={thNum}>Contingency</th>
                <th className={thNum}>Expected cost</th>
                <th className={thNum}>Margin</th>
                <th className={thNum}>Margin %</th>
                <th className={th}>Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {m.construction.rows.map((r) => (
                <tr key={r.component}>
                  <td className={td}>{r.component}</td>
                  <td className={tdNum}>{money(r.price)}</td>
                  <td className={tdNum}>{money(r.baseCost)}</td>
                  <td className={tdNum}>{money(r.contingency)}</td>
                  <td className={tdNum}>{money(r.expectedCost)}</td>
                  <td className={`${tdNum} font-medium`}>{money(r.margin)}</td>
                  <td className={tdNum}>{r.marginPct !== null ? pct(r.marginPct) : "—"}</td>
                  <td className={`${td} text-xs text-zinc-500`}>{r.note}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-zinc-50 font-medium dark:bg-zinc-900">
              <tr>
                <td className={td}>{m.construction.total.component}</td>
                <td className={tdNum}>{money(m.construction.total.price)}</td>
                <td className={tdNum}>{money(m.construction.total.baseCost)}</td>
                <td className={tdNum}>{money(m.construction.total.contingency)}</td>
                <td className={tdNum}>{money(m.construction.total.expectedCost)}</td>
                <td className={tdNum}>{money(m.construction.total.margin)}</td>
                <td className={tdNum}>{m.construction.total.marginPct !== null ? pct(m.construction.total.marginPct) : "—"}</td>
                <td className={`${td} text-xs font-normal text-zinc-500`}>
                  clean contingency {money(m.construction.ifContingencyClean)} · fully spent {money(m.construction.ifContingencySpent)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>
    </div>
  );
}

/** Table-row fragment (a keyed wrapper so groups can render header + rows + subtotal). */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
