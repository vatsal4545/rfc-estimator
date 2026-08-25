"use client";

import { money, num, pct } from "@/lib/format";
import { useProject } from "./ProjectContext";
import { Pill, Section } from "./ui";

export function ResultsTab() {
  const { result } = useProject();
  const { materials, costs, qa } = result;
  const allOk = qa.every((q) => q.ok);

  const wireLines = materials.wireLines.filter((l) => l.cuFt > 0 || l.alFt > 0);
  const conduitLines = materials.conduitLines.filter((l) => l.totalFt > 0);

  return (
    <div>
      <div className="mb-6 rounded-lg border border-zinc-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm dark:border-zinc-800 dark:from-zinc-900 dark:to-zinc-950">
        <div className="text-sm font-medium text-zinc-500">Total Cost</div>
        <div className="mt-1 text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{money(costs.totalCost)}</div>
        <div className="mt-2 text-sm text-zinc-500">
          Electrical supply & construction {money(costs.electricalSupplyConstructionTotal)} · Labor{" "}
          {money(costs.labor)} · Sales tax {money(costs.salesTaxOnConstruction)} · Equipment purchase{" "}
          {money(costs.equipmentPurchaseInvoice + costs.equipmentPurchaseTax)} · Design {money(costs.designInvoice)}
        </div>
      </div>

      <Section title="QA checks" subtitle="All six must read OK before the estimate goes out.">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {qa.map((c) => (
            <li key={c.label} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
              <span>{c.label}</span>
              <Pill ok={c.ok}>{c.detail}</Pill>
            </li>
          ))}
        </ul>
        {!allOk && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
            Resolve the flagged items above before quoting this estimate.
          </p>
        )}
      </Section>

      <Section title="Electrical supply & construction management costs">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              <th className="py-1.5">Line</th>
              <th className="py-1.5 text-right">Base</th>
              <th className="py-1.5 text-right">Contingency</th>
              <th className="py-1.5 text-right">Final</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {costs.lines.map((l) => (
              <tr key={l.name}>
                <td className="py-1.5">{l.name}</td>
                <td className="py-1.5 text-right">{money(l.base)}</td>
                <td className="py-1.5 text-right text-zinc-500">{money(l.contingency)}</td>
                <td className="py-1.5 text-right font-medium">{money(l.finalCost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-800">
              <td className="py-2" colSpan={3}>
                Electrical supply & construction total
              </td>
              <td className="py-2 text-right">{money(costs.electricalSupplyConstructionTotal)}</td>
            </tr>
            <tr>
              <td className="py-1 text-zinc-500" colSpan={3}>
                Sales tax on construction ({pct(0.0725)})
              </td>
              <td className="py-1 text-right text-zinc-500">{money(costs.salesTaxOnConstruction)}</td>
            </tr>
            <tr>
              <td className="py-1 text-zinc-500" colSpan={3}>
                Labor
              </td>
              <td className="py-1 text-right text-zinc-500">{money(costs.labor)}</td>
            </tr>
          </tfoot>
        </table>
      </Section>

      <Section title="Equipment Purchase Invoice & Design Invoice">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-xs font-medium uppercase text-zinc-500">Equipment Purchase Invoice</div>
            <div className="mt-1 text-xl font-semibold">{money(costs.equipmentPurchaseInvoice + costs.equipmentPurchaseTax)}</div>
            <div className="text-xs text-zinc-500">includes sales tax on charger hardware, {money(costs.equipmentPurchaseTax)}</div>
          </div>
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-xs font-medium uppercase text-zinc-500">Design Invoice</div>
            <div className="mt-1 text-xl font-semibold">{money(costs.designInvoice)}</div>
          </div>
        </div>
      </Section>

      <Section title="Bill of materials — conductors" subtitle="Auto-rolled from the Takeoff table. Ready to send to the vendor.">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              <th className="py-1.5">Size</th>
              <th className="py-1.5 text-right">Cu ft</th>
              <th className="py-1.5 text-right">Cu cost</th>
              <th className="py-1.5 text-right">Al ft</th>
              <th className="py-1.5 text-right">Al cost</th>
              <th className="py-1.5">Flag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {wireLines.map((l) => (
              <tr key={l.size}>
                <td className="py-1.5">{l.size}</td>
                <td className="py-1.5 text-right">{num(l.cuFt)}</td>
                <td className="py-1.5 text-right">{money(l.cuCost)}</td>
                <td className="py-1.5 text-right">{num(l.alFt)}</td>
                <td className="py-1.5 text-right">{money(l.alCost)}</td>
                <td className="py-1.5 text-red-600">{l.flag}</td>
              </tr>
            ))}
            {wireLines.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-zinc-400">
                  No conductors yet — add runs on the Takeoff tab.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-6" />
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              <th className="py-1.5">Conduit trade size</th>
              <th className="py-1.5 text-right">Feeder ft</th>
              <th className="py-1.5 text-right">Data ft</th>
              <th className="py-1.5 text-right">Total ft</th>
              <th className="py-1.5 text-right">Cost</th>
              <th className="py-1.5">Flag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {conduitLines.map((l) => (
              <tr key={`${l.tradeSize}-${l.conduitType}`}>
                <td className="py-1.5">
                  {l.tradeSize} <span className="text-zinc-400">{l.conduitType}</span>
                </td>
                <td className="py-1.5 text-right">{num(l.feederFt)}</td>
                <td className="py-1.5 text-right">{num(l.dataFt)}</td>
                <td className="py-1.5 text-right">{num(l.totalFt)}</td>
                <td className="py-1.5 text-right">{money(l.cost)}</td>
                <td className="py-1.5 text-red-600">{l.flag}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm font-semibold dark:bg-zinc-900">
          <span>Materials grand total</span>
          <span>{money(materials.grandTotal)}</span>
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          Cross-check vs. Takeoff row totals: {money(materials.crossCheck)} (must be $0.00)
        </div>
      </Section>
    </div>
  );
}
