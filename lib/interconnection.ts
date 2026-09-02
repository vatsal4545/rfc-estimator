// Utility interconnection — the intake's Rule 29 block (Electrical rows 48-67)
// and the Best Western model's Utility_Rule29 sheet. Which regime governs the
// connection (PG&E Electric Rule 29, SDG&E Rule 45, a publicly owned
// utility's own line-extension policy, Michigan tariffs), what the utility
// pays for, what the customer bears and where that already sits in the
// price, what is excluded by name until a utility design is issued, and the
// obligations the client takes on.

import type { EstimateResult, Project } from "./calc/types";
import type { CostBuildupResult } from "./proposal/types";
import { UTILITIES } from "./ref/utilities";

export interface InterconnectionInput {
  serviceType: "" | "New service" | "Added load to existing service";
  serviceRoute: "" | "Underground" | "Overhead";
  /** Distance to the utility's point of interconnection (ft) — drives whether distribution work is likely. */
  distanceToPoiFt: number | null;
  /** "Yes — 2026-08-01", "No" … free text with the date. */
  applicationSubmitted: string;
  utilityProjectNumber: string;
  rule15Indicated: "" | "Unknown — design not yet submitted" | "No" | "Yes";
  /** Rule 15 allowance calculated by the utility, once the design is back. */
  rule15Allowance: number | null;
  rule16: "" | "No" | "Yes" | "Unknown";
  itcc: "" | "Only if Rule 15/16 contribution arises" | "Yes" | "No";
  padLocationAgreed: "" | "Yes" | "No";
  proofOfCommitment: "" | "Yes" | "No";
  acceptsOandM: "" | "Yes" | "No";
  acceptsActivation: "" | "Yes" | "No";
  designSubmitted: string;
  designReturned: string;
  /** Who provides the transformer-to-switchgear run (intake Electrical!B119). */
  serviceFeederBy: "" | "Utility — EV infrastructure rule" | "Zero Impact Energy";
  pointOfConnection: string;
}

export function defaultInterconnection(): InterconnectionInput {
  return {
    serviceType: "",
    serviceRoute: "",
    distanceToPoiFt: null,
    applicationSubmitted: "",
    utilityProjectNumber: "",
    rule15Indicated: "",
    rule15Allowance: null,
    rule16: "",
    itcc: "",
    padLocationAgreed: "",
    proofOfCommitment: "",
    acceptsOandM: "",
    acceptsActivation: "",
    designSubmitted: "",
    designReturned: "",
    serviceFeederBy: "",
    pointOfConnection: "",
  };
}

export type Regime = "pge-rule29" | "sce-rule29" | "sdge-rule45" | "ca-iou" | "pou" | "michigan" | "other" | "unknown";

export interface RegimeInfo {
  regime: Regime;
  label: string;
  description: string;
  /** Whether a California IOU EV-infrastructure rule (Rule 29 / Rule 45) governs the extension. */
  evRuleApplies: boolean;
}

/** Which interconnection regime a delivery utility sits in (the intake Project tab's "interconnection regime" line). */
export function interconnectionRegime(utility: string): RegimeInfo {
  const row = UTILITIES.find((u) => u.utility === utility);
  if (!utility) return { regime: "unknown", label: "Pick the delivery utility", description: "The interconnection rules are the serving utility's, not ours — pick it on the Setup or Intake tab.", evRuleApplies: false };
  if (!row) return { regime: "other", label: "Utility not on the roster", description: "Confirm the utility's line-extension and EV service policy before carrying any allowance.", evRuleApplies: false };
  if (row.state === "Michigan") return { regime: "michigan", label: "Michigan — utility-specific tariff", description: "Line extensions follow the utility's MPSC-approved tariff. No Rule 29; obtain the utility's service and extension terms in writing.", evRuleApplies: false };
  if (row.type !== "IOU") return { regime: "pou", label: `${row.type} — own line-extension policy`, description: "A municipal utility, irrigation district or cooperative has its own line-extension policy; the cost split can be completely different. Do not carry a Rule 29 allowance.", evRuleApplies: false };
  if (utility.startsWith("PG&E")) return { regime: "pge-rule29", label: "PG&E Electric Rule 29", description: "PG&E designs, builds and owns the EV service extension from the distribution line to the service delivery point; the customer bears the design fee and its own service equipment.", evRuleApplies: true };
  if (utility.startsWith("SCE")) return { regime: "sce-rule29", label: "SCE Rule 29 (EV infrastructure)", description: "SCE's EV infrastructure rule mirrors PG&E's: the utility builds the service extension; Rule 15/16 contributions and the ITCC apply only where distribution work is triggered.", evRuleApplies: true };
  if (utility.startsWith("SDG&E")) return { regime: "sdge-rule45", label: "SDG&E Rule 45 (EV infrastructure)", description: "SDG&E's EV infrastructure rule: the utility builds and owns the service to the customer's service equipment.", evRuleApplies: true };
  return { regime: "ca-iou", label: "California IOU — EV infrastructure rule", description: "A CPUC-regulated utility with its own EV infrastructure rule; confirm the tariff before carrying an allowance.", evRuleApplies: true };
}

export interface BearsRow {
  item: string;
  inPrice: "Yes" | "NO — EXCLUDED" | "Client provides" | "Not carried";
  amount: number | null;
  treatment: string;
}

export interface InterconnectionCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface InterconnectionResult {
  regime: RegimeInfo;
  input: InterconnectionInput;
  utilityPaysFor: string[];
  customerBears: BearsRow[];
  exclusionWording: string;
  obligations: string[];
  checks: InterconnectionCheck[];
}

const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function computeInterconnection(project: Project, estimate: EstimateResult, buildup?: CostBuildupResult): InterconnectionResult {
  const input = { ...defaultInterconnection(), ...project.intake?.interconnection };
  const utility = project.setup.utility;
  const regime = interconnectionRegime(utility);
  const designFee = project.commercial?.utilityInterconnectFee ?? 0;
  const lineExtension = project.commercial?.lineExtensionContribution ?? 0;
  const serviceRun = estimate.rows.filter((r) => r.synthetic && r.loadTypeId.startsWith("SVC")).reduce((s, r) => s + r.rowTotal, 0);
  const switchgear = estimate.costs.lines.find((l) => l.name === "Main Distribution Switchgear")?.finalCost ?? 0;
  const hardware = buildup ? (buildup.rows.find((r) => r.id === "hardware")?.price ?? 0) : project.financial.chargerHardwareCost;
  const serviceRetained = project.existing && project.existing.projectType !== "greenfield" && project.existing.register.service === "RETAIN";
  const feederByUtility = input.serviceFeederBy.startsWith("Utility");

  const utilityPaysFor = regime.evRuleApplies
    ? [
        "Design, engineering and installation of the EV service extension from the distribution line to the service delivery point",
        "Excavation, trenching, backfill and permit fees for that extension",
        "Conduit and substructures",
        "Transformers and protective equipment",
        "Meters and metering equipment",
        "Poles, where the service is overhead",
      ]
    : regime.regime === "pou" || regime.regime === "michigan"
      ? ["Whatever the utility's own line-extension policy allows — obtain it in writing; there is no Rule 29 allowance here"]
      : [];

  const customerBears: BearsRow[] = [
    {
      item: "Utility interconnection design and application fee",
      inPrice: designFee > 0 ? "Yes" : "Not carried",
      amount: designFee,
      treatment: designFee > 0 ? "Named pass-through line. Trues up when the utility issues the design." : "No fee carried — enter it on the Commercial tab when the utility states it.",
    },
    {
      item: "Service entrance conductors and conduit (transformer to switchgear)",
      inPrice: feederByUtility ? "NO — EXCLUDED" : serviceRun > 0 ? "Yes" : "Not carried",
      amount: feederByUtility ? null : serviceRun,
      treatment: feederByUtility ? "The utility provides this run under its EV infrastructure rule — not in our scope." : "In the wires and conduits line (service chain)",
    },
    { item: "Meter socket, main breaker, switchboard", inPrice: switchgear > 0 ? "Yes" : "Not carried", amount: switchgear, treatment: "In the switchgear line" },
    { item: "All EV charging equipment", inPrice: hardware > 0 ? "Yes" : "Not carried", amount: hardware, treatment: "In the hardware line" },
    {
      item: "Rule 15 distribution line extension",
      inPrice: lineExtension > 0 ? "Yes" : "NO — EXCLUDED",
      amount: lineExtension > 0 ? lineExtension : null,
      treatment:
        lineExtension > 0
          ? "Customer contribution above the allowance, carried as a pass-through at cost"
          : "Triggered only if the utility must extend or reinforce distribution. An allowance is then calculated and any excess is a customer contribution. Not knowable until the utility design is issued.",
    },
    { item: "Rule 16 service extension component", inPrice: "NO — EXCLUDED", amount: null, treatment: "Applies to temporary or speculative service. Same trigger and same treatment." },
    { item: "ITCC — income tax component of contribution", inPrice: "NO — EXCLUDED", amount: null, treatment: "State and federal tax gross-up on any customer contribution to utility-owned plant. Only arises if Rule 15/16 money changes hands." },
    { item: "Environmental studies, easements, rights of way", inPrice: "NO — EXCLUDED", amount: null, treatment: "Site specific. None identified at this stage." },
    { item: "Transformer pad space on the premises", inPrice: "Client provides", amount: null, treatment: input.padLocationAgreed === "Yes" ? "Location agreed with the client" : "Space obligation, not a cost line — agree the location with the client" },
  ];

  const ruleName = regime.regime === "sdge-rule45" ? "Electric Rule 45" : "Electric Rule 29";
  const exclusionWording = regime.evRuleApplies
    ? `Utility distribution work under ${utility.split(" — ")[0]} Electric Rules 15 and 16, and any Income Tax Component of Contribution arising from it, are excluded. ${utility.split(" — ")[0]} designs and constructs the EV service extension under ${ruleName}; the customer bears the design fee${lineExtension > 0 ? " and the stated line-extension contribution" : ""}, its own service equipment and the charging equipment. Any customer contribution the utility's design requires will be passed through at cost.`
    : regime.regime === "pou" || regime.regime === "michigan"
      ? `Utility service and line-extension work is governed by ${utility || "the serving utility"}'s own policy and is excluded until the utility states its terms in writing. No Rule 29 allowance is carried.`
      : "Utility service extension terms are excluded until the serving utility is confirmed.";

  const obligations = regime.evRuleApplies
    ? [
        "Activate the charging stations within 30 business days of energization, and in no case later than 180 business days.",
        "Maintain and operate the stations for five years, remedying faults within 90 days.",
        "Provide proof of commitment to purchase — a purchase order, budget approval or grant agreement — with the application.",
        "Service may be discontinued if the stations are not maintained or sit non-functional for a year. No refunds apply to EV service extension work.",
      ]
    : [];

  const checks: InterconnectionCheck[] = [];
  checks.push({ label: "Regime resolved from the delivery utility", ok: regime.regime !== "unknown", detail: regime.label });
  if (!regime.evRuleApplies && designFee > 0)
    checks.push({ label: "No Rule 29 allowance on a non-IOU site", ok: false, detail: `${money(designFee)} interconnection fee carried on a ${regime.label} — confirm the utility actually charges it` });
  if (serviceRetained)
    checks.push({
      label: "Retained service — no new interconnection",
      ok: designFee === 0 && input.serviceType !== "New service",
      detail: designFee === 0 ? "Existing service stays: no application, no design fee" : `The Existing tab retains the service but ${money(designFee)} of interconnection fee is carried`,
    });
  if (regime.evRuleApplies) {
    checks.push({
      label: "Application status recorded",
      ok: input.applicationSubmitted.trim() !== "",
      detail: input.applicationSubmitted.trim() || "not recorded — Rule 29 timelines start at the application",
    });
    checks.push({
      label: "Rule 15/16 exposure stated",
      ok: lineExtension > 0 ? input.rule15Indicated === "Yes" : true,
      detail:
        lineExtension > 0
          ? input.rule15Indicated === "Yes"
            ? `${money(lineExtension)} contribution carried against a returned design`
            : `${money(lineExtension)} carried but Rule 15 is "${input.rule15Indicated || "not stated"}" — carry a contribution only against the utility's design`
          : input.rule15Indicated === "Yes"
            ? "Rule 15 indicated but no contribution carried — enter it on the Commercial tab when the utility states it"
            : "Excluded by name until the utility design is issued",
    });
    checks.push({
      label: "Client accepts the Rule 29 obligations",
      ok: input.acceptsOandM === "Yes" && input.acceptsActivation === "Yes" && input.proofOfCommitment === "Yes",
      detail: `O&M ${input.acceptsOandM || "—"} · 30-day activation ${input.acceptsActivation || "—"} · proof of commitment ${input.proofOfCommitment || "—"}`,
    });
  }
  checks.push({ label: "Transformer pad location agreed", ok: input.padLocationAgreed === "Yes", detail: input.padLocationAgreed || "not yet agreed" });
  if (input.serviceType === "Added load to existing service" && !serviceRetained && project.existing?.projectType !== "greenfield" && project.existing)
    checks.push({ label: "Service type agrees with the Existing register", ok: false, detail: "Added load to the existing service, but the Existing tab does not mark the service RETAIN" });

  return { regime, input, utilityPaysFor, customerBears, exclusionWording, obligations, checks };
}
