"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BusinessModelTab } from "./BusinessModelTab";
import dynamic from "next/dynamic";
import { ChargerLibraryTab } from "./ChargerLibraryTab";
import { ChargerPricingTab } from "./ChargerPricingTab";
import { CommercialTab } from "./CommercialTab";
import { ExistingTab } from "./ExistingTab";
import { OverridesTab } from "./OverridesTab";
import { IntakeTab, ProjectSections } from "./IntakeTab";
import { CostsInternalTab } from "./CostsInternalTab";
import { FinancialsTab } from "./FinancialsTab";
import { PanelScheduleTab } from "./PanelScheduleTab";
import { PeripheralsTab } from "./PeripheralsTab";
import { ProjectProvider, useProject } from "./ProjectContext";
import { ProjectSidebar } from "./ProjectSidebar";
import { QuickEstimateTab } from "./QuickEstimateTab";
import { ResultsTab } from "./ResultsTab";
import { SetupTab } from "./SetupTab";
import { TakeoffTab } from "./TakeoffTab";
import { downloadSeg, ghostBtn } from "./ui";
import { ConstructionSection } from "./intake/ConstructionSection";
import { ElectricalSection } from "./intake/ElectricalSection";
import { EquipmentSection } from "./intake/EquipmentSection";
import { HandoffSection } from "./intake/HandoffSection";
import { CarbonIntakeTab, CommercialIntakeTab, DealIntakeTab, RevenueIntakeTab } from "./intake/ModelTabs";
import { money } from "@/lib/format";
import { INTAKE_TEMPLATE } from "@/lib/intake/cells";
import { intakeCompleteness } from "@/lib/intake/handoff";

// Two ways through one project. The Intake workflow mirrors the CEO's EVSE
// Project Intake tab for tab, in its order and vocabulary, and ends with the
// business model and the handoff; the Estimator workflow is the engineering
// detail. Both edit the same project — nothing is duplicated.
type Mode = "intake" | "estimator";
const MODE_STORAGE = "rfc-estimator:ui:mode:v1";

/**
 * Loaded on demand. The tab boots a Python runtime to generate the document,
 * so keeping it out of the main chunk means no other tab pays for it.
 */
const GenerateProposalTab = dynamic(() => import("./GenerateProposalTab"), {
  ssr: false,
  loading: () => <p className="text-sm text-zinc-500">Loading the proposal generator…</p>,
});

const INTAKE_TABS = [
  { key: "project", label: "1 · Project", section: "project" },
  { key: "existing", label: "Existing", section: "existing" },
  { key: "equipment", label: "2 · Equipment", section: "equipment" },
  { key: "electrical", label: "3 · Electrical", section: "electrical" },
  { key: "construction", label: "4 · Construction", section: "construction" },
  { key: "commercial", label: "5 · Commercial", section: "commercial" },
  { key: "revenue", label: "6 · Revenue", section: "revenue" },
  { key: "carbon", label: "7 · Carbon", section: "carbon" },
  { key: "deal", label: "8 · Deal structure", section: "deal" },
  { key: "overrides", label: "9 · Overrides", section: "overrides" },
  { key: "model", label: "📈 Business model", section: "" },
  { key: "proposal", label: "📄 Generate proposal", section: "" },
  { key: "handoff", label: "Version & handoff", section: "" },
] as const;
type IntakeTabKey = (typeof INTAKE_TABS)[number]["key"];

const ESTIMATOR_TABS = [
  { key: "quick", label: "⚡ Quick Estimate" },
  { key: "intake", label: "Intake" },
  { key: "existing", label: "Existing site" },
  { key: "setup", label: "Setup" },
  { key: "takeoff", label: "Takeoff" },
  { key: "panel", label: "Panel schedule" },
  { key: "chargers", label: "Charger library" },
  { key: "pricing", label: "💲 Charger pricing" },
  { key: "peripherals", label: "Peripherals & Equipment" },
  { key: "financials", label: "Financials" },
  { key: "costsInternal", label: "Costs Internal" },
  { key: "results", label: "Results" },
  { key: "commercial", label: "Commercial" },
  { key: "model", label: "📈 Business model" },
  { key: "overrides", label: "Overrides" },
] as const;
type TabKey = (typeof ESTIMATOR_TABS)[number]["key"];

/**
 * The actions you reach for occasionally. Keeping Export, Import and New
 * project as permanent buttons put seven controls in the header, which pushed
 * the row to two lines and made the totals compete with file management.
 */
function OverflowMenu({ children }: { children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={ghostBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 min-w-44 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export const menuItem =
  "block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800";

function Toolbar() {
  const { project, newProject, importProject, result, proposal, hardwareAllowance } = useProject();
  const fileRef = useRef<HTMLInputElement>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [rfcBusy, setRfcBusy] = useState(false);
  const [shared, setShared] = useState(false);

  async function shareLink() {
    const { buildShareUrl } = await import("@/lib/shareLink");
    const url = await buildShareUrl(project);
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2500);
    } catch {
      prompt("Copy the share link (opens this project as an editable copy):", url);
    }
  }

  async function exportExcel() {
    setExcelBusy(true);
    try {
      // exceljs is ~1MB — load it only when someone actually exports.
      const { downloadEstimateExcel } = await import("@/lib/exportExcel");
      await downloadEstimateExcel(project, result);
    } finally {
      setExcelBusy(false);
    }
  }

  async function exportIntake() {
    setIntakeBusy(true);
    try {
      // The zip patcher loads only when someone actually exports.
      const { downloadIntake } = await import("@/lib/intake/fillIntake");
      await downloadIntake(project, result, proposal);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setIntakeBusy(false);
    }
  }

  async function exportRfc() {
    setRfcBusy(true);
    try {
      // The zip patcher loads only when someone actually exports.
      const { downloadRfc } = await import("@/lib/rfc/fillRfc");
      const report = await downloadRfc(project, result, proposal, { hardwareAllowance });
      // Price or scope divergences the workbook cannot resolve itself — the
      // file still downloads, but nobody should read it without seeing these.
      if (report.warnings.length > 0 || report.refused.length > 0) {
        alert(
          ["The RFC calculator downloaded, with notes:", ...report.warnings, ...report.refused.map((r) => `Not written — ${r}`)].join("\n\n• "),
        );
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setRfcBusy(false);
    }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const name = project.setup.clientName || "project";
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-rfc-estimate.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(file: File) {
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text);
        // Lands as a NEW library entry — importing must not clobber the open project.
        importProject(parsed);
      } catch {
        alert("That file isn't a valid RFC estimator project export.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {/* One control, three destinations — the question is which file, not
          whether to export, so these share a fill instead of competing. */}
      <div className="flex items-center divide-x divide-emerald-900/40 overflow-hidden rounded-md">
        <button
          onClick={exportExcel}
          disabled={excelBusy}
          className={downloadSeg}
          title="Download the full estimate as a formula-driven Excel workbook"
        >
          {excelBusy ? "Building…" : "⬇ Excel"}
        </button>
        <button
          onClick={exportIntake}
          disabled={intakeBusy}
          className={downloadSeg}
          title={`Download the CEO's EVSE Project Intake ${INTAKE_TEMPLATE.version} filled from this project — the estimator's figures in its override register`}
        >
          {intakeBusy ? "Filling…" : `Intake ${INTAKE_TEMPLATE.version}`}
        </button>
        <button
          onClick={exportRfc}
          disabled={rfcBusy}
          className={downloadSeg}
          title="Download the RFC / MSRP calculator workbook filled from this project — the equipment line items, the Revenue tab's inputs and the Costs Internal table"
        >
          {rfcBusy ? "Filling…" : "RFC"}
        </button>
      </div>
      <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
      <button
        onClick={shareLink}
        className={ghostBtn}
        title="Copy a link that opens this project (as an editable copy) for anyone you send it to"
      >
        {shared ? "✓ Link copied" : "Share"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])}
      />
      <OverflowMenu>
        {(close) => (
          <>
            <button className={menuItem} onClick={() => { close(); exportJSON(); }}>
              Export project (.json)
            </button>
            <button className={menuItem} onClick={() => { close(); fileRef.current?.click(); }}>
              Import project…
            </button>
            <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
            <button
              className={menuItem}
              onClick={() => { close(); newProject(); }}
              title="Start a fresh project — the current one stays in the sidebar library"
            >
              New project
            </button>
          </>
        )}
      </OverflowMenu>
    </div>
  );
}

function TotalBadge() {
  const { result, proposal } = useProject();
  return (
    <div className="flex items-center gap-6 text-right">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-zinc-500">Total cost</div>
        <div className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{money(result.costs.totalCost)}</div>
      </div>
      {proposal && (
        <div title="Customer price from the Commercial tab — markups, discounts and pass-through fees on top of Total Cost">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Customer price</div>
          <div className="text-xl font-semibold tabular-nums text-blue-700 dark:text-blue-300">{money(proposal.costBuildup.customerPrice)}</div>
        </div>
      )}
    </div>
  );
}

function readMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_STORAGE);
    return v === "estimator" ? "estimator" : "intake";
  } catch {
    return "intake";
  }
}

/** The intake tab bar, with a completeness dot per section. */
function IntakeTabBar({ tab, setTab }: { tab: IntakeTabKey; setTab: (k: IntakeTabKey) => void }) {
  const { project, result, proposal } = useProject();
  const status = useMemo(() => intakeCompleteness(project, result, proposal), [project, result, proposal]);
  const dot = (section: string) => {
    const st = status.find((x) => x.key === section)?.state;
    if (!st) return null;
    const cls = st === "done" ? "bg-green-500" : st === "partial" ? "bg-amber-400" : "bg-zinc-300 dark:bg-zinc-600";
    return <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${cls}`} />;
  };
  return (
    <nav className="slim-scroll mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-6 pb-2">
      {INTAKE_TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === t.key ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {t.section && dot(t.section)}
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function AppShell() {
  const [mode, setModeState] = useState<Mode>(readMode);
  const [tab, setTab] = useState<TabKey>("quick");
  const [intakeTab, setIntakeTab] = useState<IntakeTabKey>("project");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { importProject } = useProject();
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_STORAGE, m);
    } catch {
      // storage unavailable — the choice lasts the session
    }
  };

  // Opening a share link (#p=...) imports that project into this browser's
  // library as an editable copy. The hash is cleared synchronously before the
  // async decode so StrictMode's doubled effect can't import twice.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#p=")) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    import("@/lib/shareLink").then(async ({ decodeSharedProject }) => {
      try {
        const body = await decodeSharedProject(hash);
        if (body) importProject(body);
      } catch {
        alert("This share link is damaged or from an incompatible app version.");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modeBtn = (m: Mode, label: string, title: string) => (
    <button
      onClick={() => setMode(m)}
      title={title}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${mode === m ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <ProjectSidebar open={sidebarOpen} />
      <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title={sidebarOpen ? "Hide project list" : "Show project list"}
            >
              ☰
            </button>
            <h1
              className="whitespace-nowrap text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
              title={mode === "intake" ? `EVSE Project Intake ${INTAKE_TEMPLATE.version} — filled from the estimate, business model automated` : "EV charging infrastructure cost estimating, automated"}
            >
              RFC Estimator
            </h1>
            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700" role="tablist" aria-label="Workflow">
              {modeBtn("intake", "Intake", "The CEO's intake, tab for tab — fill it here and the estimate and business model follow")}
              {modeBtn("estimator", "Estimator", "The engineering detail: takeoff, panel schedule, materials, peripherals, costs")}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
            <TotalBadge />
            <Toolbar />
          </div>
        </div>
        {mode === "intake" ? (
          <IntakeTabBar tab={intakeTab} setTab={setIntakeTab} />
        ) : (
          <nav className="slim-scroll mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-6 pb-2">
            {ESTIMATOR_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "bg-blue-600 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        {mode === "intake" ? (
          <>
            {intakeTab === "project" && <ProjectSections />}
            {intakeTab === "existing" && <ExistingTab />}
            {intakeTab === "equipment" && <EquipmentSection />}
            {intakeTab === "electrical" && <ElectricalSection />}
            {intakeTab === "construction" && <ConstructionSection />}
            {intakeTab === "commercial" && <CommercialIntakeTab />}
            {intakeTab === "revenue" && <RevenueIntakeTab />}
            {intakeTab === "carbon" && <CarbonIntakeTab />}
            {intakeTab === "deal" && <DealIntakeTab />}
            {intakeTab === "overrides" && <OverridesTab />}
            {intakeTab === "model" && <BusinessModelTab />}
            {intakeTab === "proposal" && <GenerateProposalTab />}
            {intakeTab === "handoff" && <HandoffSection />}
          </>
        ) : (
          <>
            {tab === "quick" && <QuickEstimateTab />}
            {tab === "intake" && <IntakeTab />}
            {tab === "existing" && <ExistingTab />}
            {tab === "setup" && <SetupTab />}
            {tab === "takeoff" && <TakeoffTab />}
            {tab === "panel" && <PanelScheduleTab />}
            {tab === "chargers" && <ChargerLibraryTab />}
            {tab === "pricing" && <ChargerPricingTab />}
            {tab === "peripherals" && <PeripheralsTab />}
            {tab === "financials" && <FinancialsTab />}
            {tab === "costsInternal" && <CostsInternalTab />}
            {tab === "results" && <ResultsTab />}
            {tab === "commercial" && <CommercialTab />}
            {tab === "model" && <BusinessModelTab />}
            {tab === "overrides" && <OverridesTab />}
          </>
        )}
      </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ProjectProvider>
      <AppShell />
    </ProjectProvider>
  );
}
