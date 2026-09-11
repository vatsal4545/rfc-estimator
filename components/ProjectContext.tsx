"use client";

import { computeEstimate } from "@/lib/calc/engine";
import { computeProposal } from "@/lib/proposal";
import { defaultCommercial } from "@/lib/proposal/defaults";
import type { ProposalResult } from "@/lib/proposal/types";
import { reconcileServiceTerms } from "@/lib/skus";
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
import {
  SESSION_STORAGE,
  apiChangePassword,
  apiLogin,
  apiRegister,
  apiReset,
  apiResetRequest,
  syncOnce,
  type Session,
} from "@/lib/cloudSync";
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

// A brand-new project: the estimator defaults plus the CEO's commercial terms
// (intake 3.1.0). Existing bodies are never given the section automatically —
// the Commercial tab offers it — so their Total Cost and shape stay as saved.
function freshProject(): Project {
  return { ...defaultProject(), commercial: defaultCommercial() };
}

interface Ctx {
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  result: EstimateResult;
  /** Proposal layer (customer price, margin, scope of supply) — null until the project has a commercial section. */
  proposal: ProposalResult | null;
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
  /** Account + cross-device cloud sync (Vercel Blob behind /api/workspace). */
  session: Session | null;
  signIn: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  signOut: () => void;
  changePassword: (current: string, next: string) => Promise<void>;
  resetRequest: (username: string) => Promise<string>;
  resetPassword: (username: string, code: string, newPassword: string) => Promise<void>;
  syncState: SyncState;
  syncNow: () => void;
}

export interface SyncState {
  status: "off" | "syncing" | "synced" | "error";
  at?: number;
  message?: string;
  /** Local edits the cloud has not got yet. Manual sync makes this the only
   *  way to know, so it has to be visible. */
  pending?: boolean;
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
    reconcileServiceTerms(reconcileHardwareCost(withCurrentLoadTypes(body), allowance), allowance);

  const [state, setState] = useState<{ id: string; project: Project }>(() => {
    const allowance = effectiveHardwareAllowance(getCatalog().getOverrides());
    const boot = store.initStore();
    if (boot)
      return {
        id: boot.id,
        project: reconcileServiceTerms(reconcileHardwareCost(withCurrentLoadTypes(boot.project), allowance), allowance),
      };
    const project = freshProject();
    const meta = store.createProject(project, "", { touched: false });
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
  const proposal = useMemo(() => computeProposal(project, result), [project, result]);

  const switchProject = (id: string) => {
    if (id === activeId) return;
    const body = store.loadProject(id);
    if (!body) return;
    store.setActiveId(id);
    setState({ id, project: prepare(body) });
  };

  const newProject = () => {
    const body = freshProject();
    const meta = store.createProject(body, "", { touched: false });
    store.setActiveId(meta.id);
    setState({ id: meta.id, project: body });
    refreshLibrary();
  };

  const deleteProject = (id: string) => {
    // Connected: tombstone so the deletion reaches other devices (the body
    // stays restorable from Recently deleted). Disconnected: local-only —
    // reconnecting restores the project from the cloud workspace.
    store.deleteProject(id, { tombstone: !!session });
    const remaining = store.listProjects();
    if (id === activeId) {
      const next = remaining[0];
      if (next) {
        const body = store.loadProject(next.id);
        store.setActiveId(next.id);
        setState({ id: next.id, project: body ? prepare(body) : freshProject() });
      } else {
        const body = freshProject();
        const meta = store.createProject(body, "", { touched: false });
        store.setActiveId(meta.id);
        setState({ id: meta.id, project: body });
      }
    }
    refreshLibrary();
    markPending();
  };

  const restoreProject = (id: string) => {
    const meta = store.restoreProject(id);
    if (!meta) return;
    refreshLibrary();
    markPending();
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
    setState((s) => ({ ...s, project: reconcileServiceTerms(reconcileHardwareCost(s.project, allowance), allowance) }));
  };

  // ---- Cross-device sync ----------------------------------------------------
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  });
  const [syncState, setSyncState] = useState<SyncState>({ status: "off" });
  const syncBusy = useRef(false);

  const markPending = () => setSyncState((s) => (s.status === "off" ? s : { ...s, pending: true }));

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
          const fresh = freshProject();
          const meta = store.createProject(fresh, "", { touched: false });
          store.setActiveId(meta.id);
          return { id: meta.id, project: fresh };
        });
        refreshLibrary();
      }
      setSyncState({ status: "synced", at: Date.now(), pending: false });
    } catch (err) {
      setSyncState({ status: "error", at: Date.now(), message: (err as Error).message, pending: true });
    } finally {
      syncBusy.current = false;
    }
  };

  const syncNow = () => void runSync(session?.token ?? "");

  const adoptSession = (next: Session) => {
    try {
      localStorage.setItem(SESSION_STORAGE, JSON.stringify(next));
    } catch {
      // storage unavailable — session stays in memory only
    }
    setSession(next);
    void runSync(next.token);
  };

  const signIn = async (username: string, password: string) => adoptSession(await apiLogin(username, password));
  const register = async (username: string, email: string, password: string) =>
    adoptSession(await apiRegister(username, email, password));
  const changePassword = async (current: string, next: string) => {
    if (!session) throw new Error("sign in first");
    await apiChangePassword(session.token, current, next);
  };
  const resetRequest = (username: string) => apiResetRequest(username);
  const resetPassword = async (username: string, code: string, newPassword: string) =>
    adoptSession(await apiReset(username, code, newPassword));

  const signOut = () => {
    try {
      localStorage.removeItem(SESSION_STORAGE);
    } catch {
      // ignore
    }
    setSession(null);
    // Signed out: pending deletion markers must not carry into a future
    // sign-in (an offline delete would wipe the cloud copy).
    store.clearTombstones();
    setSyncState({ status: "off" });
  };

  // One pull when a session appears, so signing in on another device shows the
  // library instead of an empty sidebar. After that, syncing is manual: nothing
  // here talks to the network unless somebody presses Sync now.
  //
  // It used to poll every 30 s and push 4 s after every edit settled, both
  // unconditionally, which cost roughly 2,880 writes a day from an idle open
  // tab and exhausted the blob store's monthly write allowance.
  //
  // (The run goes through setTimeout(0): runSync sets state, which an effect
  // must not do synchronously.)
  useEffect(() => {
    const token = session?.token;
    if (!token) return;
    const boot = setTimeout(() => void runSync(token), 0);
    return () => clearTimeout(boot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  // Local edits mark the workspace dirty. No request: this only lights the
  // "unsynced" indicator so the Sync now button has something to say.
  const firstEditPass = useRef(true);
  useEffect(() => {
    if (firstEditPass.current) {
      firstEditPass.current = false;
      return;
    }
    if (!session?.token) return;
    markPending();
  }, [activeId, project, libraryVersion, catalogOverrides, session?.token]);

  // Kept for the toolbar: clears the CURRENT project back to defaults.
  const resetProject = () => {
    setProject(freshProject());
  };

  return (
    <ProjectCtx.Provider
      value={{
        project,
        setProject,
        result,
        proposal,
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
        session,
        signIn,
        register,
        signOut,
        changePassword,
        resetRequest,
        resetPassword,
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
