// Project library — a tiny synchronous "database" over localStorage that
// holds every saved RFC project, powering the Claude-style project sidebar.
//
// Layout (all JSON, all under one prefix so they're easy to spot in DevTools):
//   rfc-estimator:projects:v1        -> ProjectMeta[]   (the index)
//   rfc-estimator:project:v1:<id>    -> Project         (one body per project)
//   rfc-estimator:activeProject:v1   -> string          (id of the open one)
//
// The pre-library app stored a single project at rfc-estimator:project:v1;
// initStore() migrates it into the index once (and keeps mirroring the ACTIVE
// project to that legacy key so an older deployed build still opens something
// sensible after a rollback).
//
// localStorage is synchronous and plenty fast for this shape of data: a
// project body is ~50 KB, reads happen once per switch, writes once per edit.
// If the library ever outgrows the ~5 MB quota, saveProject surfaces the
// QuotaExceededError to the caller instead of silently dropping the save.

import type { Project } from "./calc/types";

export interface ProjectMeta {
  id: string;
  /** User-chosen name; empty string means "auto" — display clientName instead. */
  name: string;
  /** Snapshot of setup.clientName so the sidebar can label rows without loading bodies. */
  clientName: string;
  createdAt: number;
  updatedAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const INDEX_KEY = "rfc-estimator:projects:v1";
const ACTIVE_KEY = "rfc-estimator:activeProject:v1";
const LEGACY_KEY = "rfc-estimator:project:v1";
const bodyKey = (id: string) => `${LEGACY_KEY}:${id}`;

export function displayName(meta: ProjectMeta): string {
  return meta.name || meta.clientName || "Untitled project";
}

/** Sidebar label source: the Setup client name, falling back to the Quick
 * Estimate client field (typed before the first Build copies it to Setup). */
export function projectClientName(project: Project): string {
  return project.setup.clientName || project.quick?.clientName || "";
}

let counter = 0;
function newProjectId(): string {
  counter += 1;
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${counter}`;
}

export function createProjectStore(storage: StorageLike) {
  const readIndex = (): ProjectMeta[] => {
    try {
      const raw = storage.getItem(INDEX_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (metas: ProjectMeta[]) => storage.setItem(INDEX_KEY, JSON.stringify(metas));

  const listProjects = (): ProjectMeta[] => readIndex().sort((a, b) => b.updatedAt - a.updatedAt);

  const loadProject = (id: string): Project | null => {
    try {
      const raw = storage.getItem(bodyKey(id));
      return raw ? (JSON.parse(raw) as Project) : null;
    } catch {
      return null;
    }
  };

  const saveProject = (id: string, project: Project): void => {
    const body = JSON.stringify(project);
    storage.setItem(bodyKey(id), body);
    const metas = readIndex();
    const meta = metas.find((m) => m.id === id);
    if (meta) {
      meta.updatedAt = Date.now();
      meta.clientName = projectClientName(project);
      writeIndex(metas);
    }
    // Mirror the active body to the legacy single-project key (rollback safety).
    if (storage.getItem(ACTIVE_KEY) === id) storage.setItem(LEGACY_KEY, body);
  };

  const createProject = (project: Project, name = ""): ProjectMeta => {
    const now = Date.now();
    const meta: ProjectMeta = {
      id: newProjectId(),
      name,
      clientName: projectClientName(project),
      createdAt: now,
      updatedAt: now,
    };
    storage.setItem(bodyKey(meta.id), JSON.stringify(project));
    writeIndex([...readIndex(), meta]);
    return meta;
  };

  const renameProject = (id: string, name: string): void => {
    const metas = readIndex();
    const meta = metas.find((m) => m.id === id);
    if (!meta) return;
    meta.name = name.trim();
    meta.updatedAt = Date.now();
    writeIndex(metas);
  };

  const deleteProject = (id: string): void => {
    storage.removeItem(bodyKey(id));
    writeIndex(readIndex().filter((m) => m.id !== id));
    if (storage.getItem(ACTIVE_KEY) === id) storage.removeItem(ACTIVE_KEY);
  };

  const duplicateProject = (id: string): ProjectMeta | null => {
    const body = loadProject(id);
    const src = readIndex().find((m) => m.id === id);
    if (!body || !src) return null;
    return createProject(body, `${displayName(src)} (copy)`);
  };

  const getActiveId = (): string | null => storage.getItem(ACTIVE_KEY);
  const setActiveId = (id: string): void => storage.setItem(ACTIVE_KEY, id);

  /**
   * One-time boot: migrate the legacy single project into the index if the
   * library is empty, then return the active {id, project} pair (falling back
   * to the most recently updated project, or null when the library is empty —
   * the caller creates a default project in that case).
   */
  const initStore = (): { id: string; project: Project } | null => {
    let metas = readIndex();
    if (metas.length === 0) {
      try {
        const legacy = storage.getItem(LEGACY_KEY);
        if (legacy) {
          const project = JSON.parse(legacy) as Project;
          const meta = createProject(project);
          setActiveId(meta.id);
          metas = readIndex();
        }
      } catch {
        // corrupt legacy blob — start fresh
      }
    }
    if (metas.length === 0) return null;
    const activeId = getActiveId();
    const active = metas.find((m) => m.id === activeId) ?? [...metas].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const project = loadProject(active.id);
    if (!project) return null;
    setActiveId(active.id);
    return { id: active.id, project };
  };

  return {
    listProjects,
    loadProject,
    saveProject,
    createProject,
    renameProject,
    deleteProject,
    duplicateProject,
    getActiveId,
    setActiveId,
    initStore,
  };
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

/** The browser-bound store. Only touch this from client components. */
export function browserProjectStore(): ProjectStore {
  return createProjectStore(globalThis.localStorage);
}
