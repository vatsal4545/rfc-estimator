"use client";

import { computeEstimate } from "@/lib/calc/engine";
import { defaultProject } from "@/lib/calc/defaults";
import { DEFAULT_LOAD_TYPES } from "@/lib/calc/tables";
import type { EstimateResult, LoadType, Project } from "@/lib/calc/types";
import {
  browserCatalogStore,
  effectiveHardwareAllowance,
  reconcileHardwareCost,
  type CatalogOverrides,
  type CatalogStore,
} from "@/lib/catalog";
import { SYNC_KEY_STORAGE, syncOnce } from "@/lib/cloudSync";
import {
  browserProjectStore,
  projectClientName,
  type ProjectMeta,
  type ProjectStore,
  type TrashEntry,
} from "@/lib/projectStore";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

// Lazy module singletons: this file is only evaluated client-side (page.tsx
// dynamic-imports the app with ssr: false), and the stores touch
// localStorage only when their methods run.
let _store: ProjectStore | undefined;
const getStore = () => (_store ??= browserProjectStore());
let _catalog: CatalogStore | undefined;
const getCatalog = () => (_catalog ??= browserCatalogStore());

// Saved projects keep their own charger library (including edits), but
// built-in models added in newer app versions are merged in so they don't
// silently vanish from the dropdowns.
function withCurrentLoadTypes(project: Project): Project {
  const have = new Set(project.loadTypes.map((l) => l.id));
  const missing = DEFAULT_LOAD_TYPES.filter((l) => !have.has(l.id));
  if (missing.length > 0) return { ...project, loadTypes: [...project.loadTypes, ...missing] };
  return project;
}

interface Ctx {
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  result: EstimateResult;
  loadTypes: LoadType[];
  resetProject: () => void;
  /** Project library (sidebar): every saved project, most recent first. */
  projects: ProjectMeta[];
  activeId: string;
  switchProject: (id: string) => void;
  newProject: () => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  duplicateProject: (id: string) => void;
  /** Add a project body (JSON import / share link) as a new library entry and open it. */
  importProject: (body: Project, name?: string) => void;
  /** Global charger-price catalog (Charger pricing tab): defaults + overrides. */
  hardwareAllowance: Record<string, number>;
  catalogOverrides: CatalogOverrides;
  setCatalogPrice: (modelId: string, price: number | undefined) => void;
  /** Recently deleted projects (restorable for 30 days, synced). */
  trash: TrashEntry[];
  restoreProject: (id: string) => void;
  /** Cross-device cloud sync (Vercel Blob behind /api/workspace). */
  syncKey: string;
  setSyncKey: (key: string) => void;
  syncState: SyncState;
  syncNow: () => void;
}

export interface SyncState {
  status: "off" | "syncing" | "synced" | "error";
  at?: number;
  message?: string;
}

const ProjectCtx = createContext<Ctx | null>(null);

// This provider is only ever mounted client-side (see app/page.tsx's
// dynamic import with ssr: false), so it's safe to read localStorage
// directly in the initializer instead of loading it in an effect.
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const store = getStore();

  const [catalogOverrides, setCatalogOverrides] = useState<CatalogOverrides>(() => getCatalog().getOverrides());
  const hardwareAllowance = useMemo(() => effectiveHardwareAllowance(catalogOverrides), [catalogOverrides]);

  // Merge current load types + re-derive the hardware line from the price
  // catalog — applied to every project body coming out of the store.
  const prepare = (body: Project, allowance: Record<string, number> = hardwareAllowance): Project =>
    reconcileHardwareCost(withCurrentLoadTypes(body), allowance);

  const [state, setState] = useState<{ id: string; project: Project }>(() => {
    const allowance = effectiveHardwareAllowance(getCatalog().getOverrides());
    const boot = store.initStore();
    if (boot) return { id: boot.id, project: reconcileHardwareCost(withCurrentLoadTypes(boot.project), allowance) };
    const project = defaultProject();
    const meta = store.createProject(project);
    store.setActiveId(meta.id);
    return { id: meta.id, project };
  });
  // Bumped by library mutations (rename/delete/duplicate/new) so the derived
  // list below re-reads the index; ordinary edits re-derive via [project].
  const [libraryVersion, setLibraryVersion] = useState(0);
  const refreshLibrary = () => setLibraryVersion((v) => v + 1);

  const { id: activeId, project } = state;

  useEffect(() => {
    try {
      store.saveProject(activeId, project);
    } catch {
      // Storage quota exceeded — keep the app running; the user still has Export.
      console.error("Failed to save project to localStorage (quota?)");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, project]);

  // Derived sidebar list. The save effect lands after render, so the active
  // row's clientName is overlaid from live state to avoid a one-edit lag.
  const projects: ProjectMeta[] = useMemo(
    () =>
      store
        .listProjects()
        .map((m) => (m.id === activeId ? { ...m, clientName: projectClientName(project) } : m)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, project, libraryVersion],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trash: TrashEntry[] = useMemo(() => store.listTrash(), [libraryVersion]);

  const setProject: React.Dispatch<React.SetStateAction<Project>> = (action) => {
    setState((s) => ({
      ...s,
      project: typeof action === "function" ? (action as (p: Project) => Project)(s.project) : action,
    }));
  };

  const result = useMemo(() => computeEstimate(project), [project]);

  const switchProject = (id: string) => {
    if (id === activeId) return;
    const body = store.loadProject(id);
    if (!body) return;
    store.setActiveId(id);
    setState({ id, project: prepare(body) });
  };

  const newProject = () => {
    const body = defaultProject();
    const meta = store.createProject(body);
    store.setActiveId(meta.id);
    setState({ id: meta.id, project: body });
    refreshLibrary();
  };

  const deleteProject = (id: string) => {
    // Connected: tombstone so the deletion reaches other devices (the body
    // stays restorable from Recently deleted). Disconnected: local-only —
    // reconnecting restores the project from the cloud workspace.
    store.deleteProject(id, { tombstone: !!syncKey });
    const remaining = store.listProjects();
    if (id === activeId) {
      const next = remaining[0];
      if (next) {
        const body = store.loadProject(next.id);
        store.setActiveId(next.id);
        setState({ id: next.id, project: body ? prepare(body) : defaultProject() });
      } else {
        const body = defaultProject();
        const meta = store.createProject(body);
        store.setActiveId(meta.id);
        setState({ id: meta.id, project: body });
      }
    }
    refreshLibrary();
    if (syncKey) scheduleSync();
  };

  const restoreProject = (id: string) => {
    const meta = store.restoreProject(id);
    if (!meta) return;
    refreshLibrary();
    if (syncKey) scheduleSync();
  };

  const renameProject = (id: string, name: string) => {
    store.renameProject(id, name);
    refreshLibrary();
  };

  const duplicateProject = (id: string) => {
    const meta = store.duplicateProject(id);
    if (meta) {
      const body = store.loadProject(meta.id);
      if (body) {
        store.setActiveId(meta.id);
        setState({ id: meta.id, project: prepare(body) });
      }
    }
    refreshLibrary();
  };

  const importProject = (body: Project, name = "") => {
    const project = prepare(body);
    const meta = store.createProject(project, name);
    store.setActiveId(meta.id);
    setState({ id: meta.id, project });
    refreshLibrary();
  };

  const setCatalogPrice = (modelId: string, price: number | undefined) => {
    const next = getCatalog().setPrice(modelId, price);
    setCatalogOverrides(next);
    // Reflect the new price into the open project right away; every other
    // auto-priced project reconciles the moment it is opened.
    const allowance = effectiveHardwareAllowance(next);
    setState((s) => ({ ...s, project: reconcileHardwareCost(s.project, allowance) }));
  };

  // ---- Cross-device sync ----------------------------------------------------
  const [syncKey, setSyncKeyState] = useState<string>(() => {
    try {
      return localStorage.getItem(SYNC_KEY_STORAGE) ?? "";
    } catch {
      return "";
    }
  });
  const [syncState, setSyncState] = useState<SyncState>({ status: "off" });
  const syncBusy = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleSync = () => {
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void runSync(syncKey), 4_000);
  };

  const runSync = async (key: string) => {
    if (!key || syncBusy.current) return;
    syncBusy.current = true;
    setSyncState((s) => ({ ...s, status: "syncing" }));
    try {
      const { changedLocally } = await syncOnce(key, store, getCatalog());
      if (changedLocally) {
        // Remote edits landed: refresh the sidebar, the catalog, and the open
        // project (falling back when another device deleted it).
        setCatalogOverrides(getCatalog().getOverrides());
        setState((s) => {
          const body = store.loadProject(s.id);
          if (body) return { ...s, project: prepare(body) };
          const next = store.listProjects()[0];
          const nextBody = next ? store.loadProject(next.id) : null;
          if (next && nextBody) {
            store.setActiveId(next.id);
            return { id: next.id, project: prepare(nextBody) };
          }
          const fresh = defaultProject();
          const meta = store.createProject(fresh);
          store.setActiveId(meta.id);
          return { id: meta.id, project: fresh };
        });
        refreshLibrary();
      }
      setSyncState({ status: "synced", at: Date.now() });
    } catch (err) {
      setSyncState({ status: "error", at: Date.now(), message: (err as Error).message });
    } finally {
      syncBusy.current = false;
    }
  };

  const syncNow = () => void runSync(syncKey);

  const setSyncKey = (key: string) => {
    const trimmed = key.trim();
    try {
      if (trimmed) localStorage.setItem(SYNC_KEY_STORAGE, trimmed);
      else localStorage.removeItem(SYNC_KEY_STORAGE);
    } catch {
      // storage unavailable — key stays session-only
    }
    setSyncKeyState(trimmed);
    if (trimmed) {
      void runSync(trimmed);
    } else {
      // Signed out: pending deletion markers must not carry into a future
      // reconnect (an offline delete would wipe the cloud copy).
      store.clearTombstones();
      setSyncState({ status: "off" });
    }
  };

  // Boot sync + a 30 s poll so edits from other devices show up on their own.
  // (The first run goes through setTimeout(0): runSync sets state, which an
  // effect must not do synchronously.)
  useEffect(() => {
    if (!syncKey) return;
    const boot = setTimeout(() => void runSync(syncKey), 0);
    const iv = setInterval(() => void runSync(syncKey), 30_000);
    return () => {
      clearTimeout(boot);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  // Push local edits shortly after they settle (piggybacks on the save effect).
  useEffect(() => {
    if (!syncKey) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void runSync(syncKey), 4_000);
    return () => clearTimeout(syncTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, project, libraryVersion, catalogOverrides, syncKey]);

  // Kept for the toolbar: clears the CURRENT project back to defaults.
  const resetProject = () => {
    setProject(defaultProject());
  };

  return (
    <ProjectCtx.Provider
      value={{
        project,
        setProject,
        result,
        loadTypes: project.loadTypes,
        resetProject,
        projects,
        activeId,
        switchProject,
        newProject,
        deleteProject,
        renameProject,
        duplicateProject,
        importProject,
        hardwareAllowance,
        catalogOverrides,
        setCatalogPrice,
        trash,
        restoreProject,
        syncKey,
        setSyncKey,
        syncState,
        syncNow,
      }}
    >
      {children}
    </ProjectCtx.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error("useProject must be used inside ProjectProvider");
  return ctx;
}
