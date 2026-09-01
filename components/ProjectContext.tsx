"use client";

import { computeEstimate } from "@/lib/calc/engine";
import { defaultProject } from "@/lib/calc/defaults";
import { DEFAULT_LOAD_TYPES } from "@/lib/calc/tables";
import type { EstimateResult, LoadType, Project } from "@/lib/calc/types";
import { browserProjectStore, projectClientName, type ProjectMeta, type ProjectStore } from "@/lib/projectStore";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

// Lazy module singleton: this file is only evaluated client-side (page.tsx
// dynamic-imports the app with ssr: false), and the store touches
// localStorage only when its methods run.
let _store: ProjectStore | undefined;
const getStore = () => (_store ??= browserProjectStore());

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
}

const ProjectCtx = createContext<Ctx | null>(null);

// This provider is only ever mounted client-side (see app/page.tsx's
// dynamic import with ssr: false), so it's safe to read localStorage
// directly in the initializer instead of loading it in an effect.
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const store = getStore();

  const [state, setState] = useState<{ id: string; project: Project }>(() => {
    const boot = store.initStore();
    if (boot) return { id: boot.id, project: withCurrentLoadTypes(boot.project) };
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
    setState({ id, project: withCurrentLoadTypes(body) });
  };

  const newProject = () => {
    const body = defaultProject();
    const meta = store.createProject(body);
    store.setActiveId(meta.id);
    setState({ id: meta.id, project: body });
    refreshLibrary();
  };

  const deleteProject = (id: string) => {
    store.deleteProject(id);
    const remaining = store.listProjects();
    if (id === activeId) {
      const next = remaining[0];
      if (next) {
        const body = store.loadProject(next.id);
        store.setActiveId(next.id);
        setState({ id: next.id, project: body ? withCurrentLoadTypes(body) : defaultProject() });
      } else {
        const body = defaultProject();
        const meta = store.createProject(body);
        store.setActiveId(meta.id);
        setState({ id: meta.id, project: body });
      }
    }
    refreshLibrary();
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
        setState({ id: meta.id, project: withCurrentLoadTypes(body) });
      }
    }
    refreshLibrary();
  };

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
