"use client";

import { useRef, useState } from "react";
import { ChargerLibraryTab } from "./ChargerLibraryTab";
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
import { money } from "@/lib/format";

const TABS = [
  { key: "quick", label: "⚡ Quick Estimate" },
  { key: "setup", label: "Setup" },
  { key: "takeoff", label: "Takeoff" },
  { key: "panel", label: "Panel schedule" },
  { key: "chargers", label: "Charger library" },
  { key: "peripherals", label: "Peripherals & Equipment" },
  { key: "financials", label: "Financials" },
  { key: "costsInternal", label: "Costs Internal" },
  { key: "results", label: "Results" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function Toolbar() {
  const { project, setProject, newProject, result } = useProject();
  const fileRef = useRef<HTMLInputElement>(null);
  const [excelBusy, setExcelBusy] = useState(false);

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
        setProject(parsed);
      } catch {
        alert("That file isn't a valid RFC estimator project export.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={exportExcel}
        disabled={excelBusy}
        className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
        title="Download the full estimate as a formula-driven Excel workbook"
      >
        {excelBusy ? "Building…" : "⬇ Excel"}
      </button>
      <button onClick={exportJSON} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
        Export
      </button>
      <button onClick={() => fileRef.current?.click()} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])}
      />
      <button
        onClick={newProject}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        title="Start a fresh project — the current one stays in the sidebar library"
      >
        New project
      </button>
    </div>
  );
}

function TotalBadge() {
  const { result } = useProject();
  return (
    <div className="text-right">
      <div className="text-xs text-zinc-500">Total Cost</div>
      <div className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{money(result.costs.totalCost)}</div>
    </div>
  );
}

function AppShell() {
  const [tab, setTab] = useState<TabKey>("quick");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <ProjectSidebar open={sidebarOpen} />
      <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title={sidebarOpen ? "Hide project list" : "Show project list"}
            >
              ☰
            </button>
            <div>
            <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">RFC Estimator</h1>
            <p className="text-xs text-zinc-500">EV charging infrastructure cost estimating, automated</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <TotalBadge />
            <Toolbar />
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {TABS.map((t) => (
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
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "quick" && <QuickEstimateTab />}
        {tab === "setup" && <SetupTab />}
        {tab === "takeoff" && <TakeoffTab />}
        {tab === "panel" && <PanelScheduleTab />}
        {tab === "chargers" && <ChargerLibraryTab />}
        {tab === "peripherals" && <PeripheralsTab />}
        {tab === "financials" && <FinancialsTab />}
        {tab === "costsInternal" && <CostsInternalTab />}
        {tab === "results" && <ResultsTab />}
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
