"use client";

import { HARDWARE_ALLOWANCE } from "@/lib/calc/autoplan";
import { DEFAULT_LOAD_TYPES } from "@/lib/calc/tables";
import { money } from "@/lib/format";
import { useProject } from "./ProjectContext";
import { Section, inputCls } from "./ui";

// One page for what every charger model COSTS — global, not per-project:
// change a price here and every auto-priced project picks it up (open
// projects instantly, others the moment they're opened). Electrical specs
// stay on the per-project Charger library tab.
export function ChargerPricingTab() {
  const { catalogOverrides, setCatalogPrice, project } = useProject();
  const overrides = catalogOverrides.hardwareAllowance;
  const models = DEFAULT_LOAD_TYPES.filter((lt) => lt.category !== "Feeder");
  const overrideCount = Object.keys(overrides).length;
  const manualProject = project.financial.chargerHardwareCostIsAuto === false;

  return (
    <div>
      <Section
        title="Charger pricing — global catalog"
        subtitle="These $/unit prices apply to EVERY project in your library (this browser). Leave a price blank to use the shipped default. Projects where you hand-typed a hardware cost on the Financials tab keep their manual number."
      >
        {manualProject && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Heads up: the OPEN project has a hand-typed hardware cost, so catalog prices don&apos;t move its
            estimate — switch it back to auto on the Financials tab to follow the catalog.
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Default $/unit</th>
                <th className="px-3 py-2 text-right">Your price $/unit</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {models.map((lt) => {
                const dflt = HARDWARE_ALLOWANCE[lt.id] ?? 0;
                const ovr = overrides[lt.id];
                return (
                  <tr key={lt.id} className={ovr !== undefined ? "bg-amber-50/60 dark:bg-amber-950/20" : undefined}>
                    <td className="px-3 py-2 font-medium">{lt.id}</td>
                    <td className="px-3 py-2 text-zinc-500">{lt.category}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{money(dflt)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        className={`${inputCls} w-32 text-right`}
                        placeholder={String(dflt)}
                        value={ovr ?? ""}
                        onChange={(e) =>
                          setCatalogPrice(lt.id, e.target.value === "" ? undefined : Number(e.target.value))
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      {ovr !== undefined && (
                        <button
                          className="text-xs font-medium text-blue-600 hover:underline"
                          onClick={() => setCatalogPrice(lt.id, undefined)}
                          title="Back to the shipped default"
                        >
                          reset
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          {overrideCount > 0
            ? `${overrideCount} price${overrideCount === 1 ? "" : "s"} overridden (highlighted). `
            : "No overrides yet — all models at shipped defaults. "}
          Prices are budgetary allowances — swap in vendor quotes when you have them.
        </p>
      </Section>
    </div>
  );
}
