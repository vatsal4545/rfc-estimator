"use client";

import { COSTS_INTERNAL_LABELS } from "@/lib/costsInternalSheet";
import { money, num } from "@/lib/format";
import { useProject } from "./ProjectContext";

// "Costs Internal" — the RFC_V18 presentation of the estimate, rendered to
// match the workbook sheet (Hoopa D-00025 layout): dark-blue banner, light-
// blue category column, Quantity | Individual Cost | Contingency | Final
// Cost | Total, gray subtotal bands, the ZERO IMPACT BUILDERS COSTS labor
// block and the small Labor box. Read-only: it re-slices the same numbers
// the engine computed — edit inputs on Financials / Peripherals.

const BANNER = "#326698";
const CATEGORY = "#9AD3E6";
const BAND = "#D9D9D9";

const cell = "border border-zinc-300 px-2 py-1 text-center whitespace-nowrap";
const labelCell = "border border-zinc-300 px-2 py-1 text-left font-bold";

function pct0(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function CostsInternalTab() {
  const { project, result } = useProject();
  const fin = project.financial;
  const c = result.costs;

  const contingency = fin.contingencyPct;
  const laborContingency = (fin.applyContingencyToLabor ?? true) ? fin.contingencyPct : 0;
  const days = fin.laborBusinessDays;
  const rate = fin.laborDailyRate;
  // Construction PM row: all design costs except the AHJ plan check.
  const constructionPm = fin.autoCadDesignCost + fin.electricalEngDesignCost + fin.pmHours * fin.pmHourlyRate;
  const laborLoaded = rate * (1 + laborContingency) * days;

  const headers = ["Quantity", "Individual Cost", "Contingency", "Final Cost", "Total"];

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 text-xs text-zinc-500">
        Mirrors the RFC_V18 “Costs Internal” sheet (and the Excel export’s tab of the same name). Read-only — the
        numbers come from the same engine results; change contingency, labor or line items on the Financials and
        Peripherals tabs.
      </div>
      <div className="inline-block rounded-sm bg-white p-6 text-sm text-black shadow" style={{ fontFamily: "Calibri, ui-sans-serif, sans-serif" }}>
        <div className="flex flex-wrap items-start gap-8">
          <div>
            {/* Main block — B2:G15 */}
            <table className="border-collapse" style={{ borderLeft: `2px solid #000`, borderRight: `2px solid #000` }}>
              <thead>
                <tr style={{ backgroundColor: BANNER }} className="font-bold text-white">
                  <th className="border border-zinc-300 px-2 py-1 text-left" style={{ minWidth: 340 }}>
                    Electrical Supply &amp; Construction Management Costs
                  </th>
                  {headers.map((h) => (
                    <th key={h} className={cell} style={{ minWidth: h === "Quantity" ? 70 : 110 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.lines.map((line, i) => (
                  <tr key={COSTS_INTERNAL_LABELS[i]}>
                    <td className={labelCell} style={{ backgroundColor: CATEGORY }}>
                      {COSTS_INTERNAL_LABELS[i]}
                    </td>
                    <td className={cell}>1</td>
                    <td className={cell}>{money(line.base)}</td>
                    <td className={cell}>{pct0(contingency)}</td>
                    <td className={cell}>{money(line.finalCost)}</td>
                    <td className={cell}>{money(line.finalCost)}</td>
                  </tr>
                ))}
                {/* Construction PM: shown here, summed on the Design invoice — not in the subtotal. */}
                <tr>
                  <td className={labelCell} style={{ backgroundColor: CATEGORY }}>Construction PM</td>
                  <td className={cell}>1</td>
                  <td className={cell}>{money(constructionPm)}</td>
                  <td className={cell}>0%</td>
                  <td className={cell}>{money(constructionPm)}</td>
                  <td className={cell}>{money(constructionPm)}</td>
                </tr>
                <tr style={{ backgroundColor: BAND }} className="font-bold">
                  <td className="border border-zinc-300 px-2 py-1" colSpan={5} />
                  <td className={cell}>{money(c.electricalSupplyConstructionTotal)}</td>
                </tr>
              </tbody>
            </table>

            {/* ZERO IMPACT block — B17:G20 */}
            <table className="mt-4 border-collapse" style={{ border: `2px solid #000` }}>
              <tbody>
                <tr>
                  <td className="border-2 border-black px-2 py-1 text-center font-bold" colSpan={6} style={{ minWidth: 340 + 70 + 4 * 110 }}>
                    ZERO IMPACT BUILDERS COSTS
                  </td>
                </tr>
                <tr>
                  <td className={labelCell} style={{ backgroundColor: CATEGORY, minWidth: 340 }}>Labor</td>
                  <td className={cell} style={{ minWidth: 70 }}>{num(days)}</td>
                  <td className={cell} style={{ minWidth: 110 }}>{money(rate)}</td>
                  <td className={cell} style={{ minWidth: 110 }}>{pct0(laborContingency)}</td>
                  <td className={cell} style={{ minWidth: 110 }}>{money(rate * (1 + laborContingency))}</td>
                  <td className={cell} style={{ minWidth: 110 }}>{money(laborLoaded)}</td>
                </tr>
                <tr style={{ backgroundColor: BAND }} className="font-bold">
                  <td className="border border-zinc-300 px-2 py-1" colSpan={5} />
                  <td className={cell}>{money(laborLoaded)}</td>
                </tr>
                <tr>
                  <td className="border border-zinc-300 px-2 py-1 text-right font-bold" colSpan={5}>
                    Total
                  </td>
                  <td className={`${cell} font-bold text-white`} style={{ backgroundColor: BANNER }}>
                    {money(c.electricalSupplyConstructionTotal + laborLoaded)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Labor box — J3:K7 */}
          <table className="border-collapse" style={{ border: `2px solid #000` }}>
            <tbody>
              <tr style={{ backgroundColor: BANNER }} className="font-bold text-white">
                <td className={cell} style={{ minWidth: 170 }}>Labor</td>
                <td className={cell} style={{ minWidth: 110 }} />
              </tr>
              <tr>
                <td className="border border-zinc-300 px-2 py-1 text-left">Daily Cost</td>
                <td className="border border-zinc-300 px-2 py-1 text-right">{money(rate)}</td>
              </tr>
              <tr>
                <td className="border border-zinc-300 px-2 py-1 text-left">Total Business Days</td>
                <td className={cell}>{num(days)}</td>
              </tr>
              <tr>
                <td className="border border-zinc-300 px-2 py-1 text-left">Total Months</td>
                <td className={cell}>{num(days / 30, 2)}</td>
              </tr>
              <tr>
                <td className="border border-zinc-300 px-2 py-1 text-left">Total Labor</td>
                <td className="border border-zinc-300 px-2 py-1 text-right">{money(days * rate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
