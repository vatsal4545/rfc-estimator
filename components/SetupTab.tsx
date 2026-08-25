"use client";

import { INSTALL_METHOD_INFO, effectiveInstallMethod } from "@/lib/calc/install";
import type { InstallMethod } from "@/lib/calc/types";
import { useProject } from "./ProjectContext";
import { Field, Grid, Section, inputCls, selectCls } from "./ui";

export function SetupTab() {
  const { project, setProject, result } = useProject();
  const s = project.setup;

  function update<K extends keyof typeof s>(key: K, value: (typeof s)[K]) {
    setProject((p) => ({ ...p, setup: { ...p.setup, [key]: value } }));
  }

  return (
    <div>
      <Section title="Project information">
        <Grid cols={3}>
          <Field label="Client">
            <input className={inputCls} value={s.clientName} onChange={(e) => update("clientName", e.target.value)} />
          </Field>
          <Field label="Site address">
            <input className={inputCls} value={s.siteAddress} onChange={(e) => update("siteAddress", e.target.value)} />
          </Field>
          <Field label="Utility">
            <input className={inputCls} value={s.utility} onChange={(e) => update("utility", e.target.value)} />
          </Field>
          <Field label="CPM">
            <input className={inputCls} value={s.cpm} onChange={(e) => update("cpm", e.target.value)} />
          </Field>
          <Field label="CRA">
            <input className={inputCls} value={s.cra} onChange={(e) => update("cra", e.target.value)} />
          </Field>
          <Field label="Price list source">
            <input className={inputCls} value={s.priceListSource} onChange={(e) => update("priceListSource", e.target.value)} />
          </Field>
          <Field label="Price list date">
            <input type="date" className={inputCls} value={s.priceListDate} onChange={(e) => update("priceListDate", e.target.value)} />
          </Field>
        </Grid>
        <div className="mt-4">
          <Field label="Scope of work">
            <textarea
              className={inputCls}
              rows={2}
              value={s.scopeOfWork}
              onChange={(e) => update("scopeOfWork", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Design toggles"
        subtitle="Every calculation on the Takeoff tab reads these. Changing a toggle re-sizes every run live."
      >
        <Grid cols={3}>
          <Field label="Feeder conductor material">
            <select className={selectCls} value={s.feederMaterial} onChange={(e) => update("feederMaterial", e.target.value as "Cu" | "Al")}>
              <option value="Cu">Copper</option>
              <option value="Al">Aluminium</option>
            </select>
          </Field>
          <Field label="Grounding conductor material">
            <select className={selectCls} value={s.groundingMaterial} onChange={(e) => update("groundingMaterial", e.target.value as "Cu" | "Al")}>
              <option value="Cu">Copper</option>
              <option value="Al">Aluminium</option>
            </select>
          </Field>
          <Field
            label="Install method"
            hint={INSTALL_METHOD_INFO[effectiveInstallMethod(s)].blurb}
          >
            <select
              className={selectCls}
              value={effectiveInstallMethod(s)}
              onChange={(e) => {
                const m = e.target.value as InstallMethod;
                // Re-derive the dig footage for the new method so the hint
                // and the priced trench agree: full route when trenched,
                // just the existing service legs on a hybrid, none for
                // surface EMT. Still editable below.
                const chain = s.serviceChain;
                const mixed = result.rollups.nDCFC > 0 && result.rollups.nL2 > 0;
                const serviceFt =
                  (chain?.utilityToSwitchgearFt ?? 25) +
                  (mixed
                    ? (chain?.switchgearToTransformerFt ?? 15) + (chain?.transformerToSubpanelFt ?? 15)
                    : 0);
                setProject((p) => ({
                  ...p,
                  setup: {
                    ...p.setup,
                    installMethod: m,
                    conduitType: m === "trench" ? "PVC" : "EMT",
                    trenchLengthFt:
                      m === "surface" ? 0 : m === "hybrid" ? serviceFt : result.rollups.longestRunFt,
                  },
                }));
              }}
            >
              {(Object.keys(INSTALL_METHOD_INFO) as InstallMethod[]).map((m) => (
                <option key={m} value={m}>
                  {INSTALL_METHOD_INFO[m].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Conduit type">
            <select className={selectCls} value={s.conduitType} onChange={(e) => update("conduitType", e.target.value as "PVC" | "EMT")}>
              <option value="PVC">PVC</option>
              <option value="EMT">EMT</option>
            </select>
          </Field>
          <Field label="Continuous load factor" hint="NEC 210.19/215.2 — 125% for continuous loads">
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={s.continuousLoadFactor}
              onChange={(e) => update("continuousLoadFactor", Number(e.target.value))}
            />
          </Field>
          <Field label="Max voltage drop (feeder)" hint="Fraction of nominal voltage, e.g. 0.03 = 3%">
            <input
              type="number"
              step="0.001"
              className={inputCls}
              value={s.maxVoltageDropFraction}
              onChange={(e) => update("maxVoltageDropFraction", Number(e.target.value))}
            />
          </Field>
          <Field label="Power factor">
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={s.powerFactor}
              onChange={(e) => update("powerFactor", Number(e.target.value))}
            />
          </Field>
          <Field label="Extra wire upsize steps" hint="0 = size to computed minimum">
            <input
              type="number"
              className={inputCls}
              value={s.wireUpsizeSteps}
              onChange={(e) => update("wireUpsizeSteps", Number(e.target.value))}
            />
          </Field>
          <Field label="Extra conduit upsize steps">
            <input
              type="number"
              className={inputCls}
              value={s.conduitUpsizeSteps}
              onChange={(e) => update("conduitUpsizeSteps", Number(e.target.value))}
            />
          </Field>
          <Field label="Data / comms cable $/ft">
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={s.dataRatePerFt}
              onChange={(e) => update("dataRatePerFt", Number(e.target.value))}
            />
          </Field>
          <Field label="Data / comms conduit trade size">
            <input className={inputCls} value={s.dataConduitTradeSize} onChange={(e) => update("dataConduitTradeSize", e.target.value)} />
          </Field>
          <Field
            label="Trench length (ft)"
            hint={
              effectiveInstallMethod(s) === "surface"
                ? "Surface EMT install — nothing gets dug (this field is ignored)"
                : effectiveInstallMethod(s) === "hybrid"
                  ? "Hybrid — only the utility → switchgear service section digs"
                  : `Suggested: longest run on Takeoff = ${result.rollups.longestRunFt} ft`
            }
          >
            <input
              type="number"
              className={inputCls}
              value={s.trenchLengthFt}
              onChange={(e) => update("trenchLengthFt", Number(e.target.value))}
            />
          </Field>
          {effectiveInstallMethod(s) !== "trench" && (
            <Field
              label="Surface EMT route (ft)"
              hint={`Ceiling/wall rack length — drives strut trapezes every 10 ft (NEC 358.30). 0 = auto from longest run (${result.rollups.longestRunFt} ft)`}
            >
              <input
                type="number"
                className={inputCls}
                value={s.surfaceRouteFt ?? 0}
                onChange={(e) => update("surfaceRouteFt", Number(e.target.value))}
              />
            </Field>
          )}
          <Field
            label="Trenching difficulty multiplier"
            hint="1 = flat lot baseline ($40.81/ft). Sloped ~1.2, hilly ~1.5, rocky ~2.5 — set by the Quick Estimate terrain picker"
          >
            <input
              type="number"
              step="0.05"
              className={inputCls}
              value={s.trenchCostMultiplier ?? 1}
              onChange={(e) => update("trenchCostMultiplier", Number(e.target.value))}
            />
          </Field>
        </Grid>
      </Section>
    </div>
  );
}
