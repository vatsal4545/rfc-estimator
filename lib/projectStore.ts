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

import { DEFAULT_LOAD_TYPES } from "./calc/tables";
import type { LoadType, Project } from "./calc/types";

// ---------------------------------------------------------------------------
// Body compaction — the built-in charger catalog (~40 KB) used to be copied
// into every stored project, capping a 5 MB localStorage at ~100 projects.
// Stored bodies keep only load types that differ from the shipped catalog
// (user-edited or custom); loadProject() re-expands to the full list in
// canonical order, so callers always see complete projects.
// ---------------------------------------------------------------------------

const DEFAULT_LT_JSON = new Map(DEFAULT_LOAD_TYPES.map((lt) => [lt.id, JSON.stringify(lt)]));

function compactLoadTypes(loadTypes: LoadType[]): LoadType[] {
  return loadTypes.filter((lt) => DEFAULT_LT_JSON.get(lt.id) !== JSON.stringify(lt));
}

function expandLoadTypes(stored: LoadType[]): LoadType[] {
  const byId = new Map(stored.map((lt) => [lt.id, lt]));
  // Catalog order first (stored override wins over the shipped default),
  // then any custom models the catalog doesn't know.
  const expanded: LoadType[] = DEFAULT_LOAD_TYPES.map((lt) => byId.get(lt.id) ?? lt);
  const defaults = new Set(DEFAULT_LOAD_TYPES.map((lt) => lt.id));
  for (const lt of stored) if (!defaults.has(lt.id)) expanded.push(lt);
  return expanded;
}

function serializeBody(project: Project): string {
  return JSON.stringify({ ...project, loadTypes: compactLoadTypes(project.loadTypes) });
}

function reviveBody(raw: string): Project {
  const parsed = JSON.parse(raw) as Project;
  return { ...parsed, loadTypes: expandLoadTypes(parsed.loadTypes ?? []) };
}

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
const TOMBSTONE_KEY = "rfc-estimator:tombstones:v1";
const TRASH_KEY = "rfc-estimator:trash:v1";
const bodyKey = (id: string) => `${LEGACY_KEY}:${id}`;
const MAX_TOMBSTONES = 300;
const MAX_TRASH = 50;
const TRASH_RETENTION_MS = 30 * 24 * 3600 * 1000;

export interface Tombstone {
  id: string;
  deletedAt: number;
}

/** Wire format for cloud sync — bodies stay as their compacted JSON strings. */
export interface CloudProject {
  meta: ProjectMeta;
  body: string;
}
export interface CloudLibraryData {
  projects: CloudProject[];
  tombstones: Tombstone[];
  /** Recently deleted projects, kept restorable for 30 days (synced too). */
  trash?: TrashEntry[];
}

export interface TrashEntry {
  meta: ProjectMeta;
  body: string;
  deletedAt: number;
}

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
      return raw ? reviveBody(raw) : null;
    } catch {
      return null;
    }
  };

  const saveProject = (id: string, project: Project): void => {
    const body = serializeBody(project);
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
    storage.setItem(bodyKey(meta.id), serializeBody(project));
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

  const readTombstones = (): Tombstone[] => {
    try {
      const parsed = JSON.parse(storage.getItem(TOMBSTONE_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const writeTombstones = (t: Tombstone[]) =>
    storage.setItem(TOMBSTONE_KEY, JSON.stringify(t.sort((a, b) => b.deletedAt - a.deletedAt).slice(0, MAX_TOMBSTONES)));

  const readTrash = (): TrashEntry[] => {
    try {
      const parsed = JSON.parse(storage.getItem(TRASH_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const writeTrash = (t: TrashEntry[]) => {
    const cutoff = Date.now() - TRASH_RETENTION_MS;
    storage.setItem(
      TRASH_KEY,
      JSON.stringify(
        t.filter((e) => e.deletedAt > cutoff).sort((a, b) => b.deletedAt - a.deletedAt).slice(0, MAX_TRASH),
      ),
    );
  };

  /**
   * Delete a project. The body moves to the trash (restorable for 30 days).
   * `tombstone: false` (used while cloud sync is DISCONNECTED) keeps the
   * deletion local-only: reconnecting restores the project from the cloud
   * instead of propagating an offline deletion into the shared workspace.
   */
  const deleteProject = (id: string, opts?: { tombstone?: boolean }): void => {
    const body = storage.getItem(bodyKey(id));
    const meta = readIndex().find((m) => m.id === id);
    if (body && meta) writeTrash([{ meta, body, deletedAt: Date.now() }, ...readTrash().filter((t) => t.meta.id !== id)]);
    storage.removeItem(bodyKey(id));
    writeIndex(readIndex().filter((m) => m.id !== id));
    if (storage.getItem(ACTIVE_KEY) === id) storage.removeItem(ACTIVE_KEY);
    if (opts?.tombstone !== false) {
      // Tombstone so cloud sync propagates the deletion instead of resurrecting.
      writeTombstones([...readTombstones().filter((t) => t.id !== id), { id, deletedAt: Date.now() }]);
    }
  };

  /** Trash entries for projects that are not alive (newest first). */
  const listTrash = (): TrashEntry[] => {
    const alive = new Set(readIndex().map((m) => m.id));
    return readTrash().filter((t) => !alive.has(t.meta.id));
  };

  /**
   * Bring a deleted project back. Its updatedAt is stamped NOW, which beats
   * every existing tombstone in the merge rule — so the restore propagates to
   * all synced devices instead of being re-deleted.
   */
  const restoreProject = (id: string): ProjectMeta | null => {
    const entry = readTrash().find((t) => t.meta.id === id);
    if (!entry) return null;
    const meta: ProjectMeta = { ...entry.meta, updatedAt: Date.now() };
    storage.setItem(bodyKey(id), entry.body);
    writeIndex([...readIndex().filter((m) => m.id !== id), meta]);
    writeTrash(readTrash().filter((t) => t.meta.id !== id));
    writeTombstones(readTombstones().filter((t) => t.id !== id));
    return meta;
  };

  /** Disconnecting from cloud sync: pending deletions become local-only. */
  const clearTombstones = (): void => storage.removeItem(TOMBSTONE_KEY);

  /** Snapshot for cloud sync (bodies already compacted). */
  const exportLibrary = (): CloudLibraryData => ({
    projects: readIndex().flatMap((meta) => {
      const body = storage.getItem(bodyKey(meta.id));
      return body ? [{ meta, body }] : [];
    }),
    tombstones: readTombstones(),
    trash: readTrash(),
  });

  /**
   * Fold a remote snapshot in: per project the newer updatedAt wins; a
   * tombstone at least as new as a project's last update deletes it on every
   * device. Local-only projects survive (the following push uploads them).
   * Returns true when anything local changed.
   */
  const mergeLibrary = (remote: CloudLibraryData): boolean => {
    let changed = false;
    const tombs = new Map(readTombstones().map((t) => [t.id, t]));
    for (const t of remote.tombstones ?? []) {
      const mine = tombs.get(t.id);
      if (!mine || t.deletedAt > mine.deletedAt) tombs.set(t.id, t);
    }

    const metas = readIndex();
    const byId = new Map(metas.map((m) => [m.id, m]));
    for (const p of remote.projects ?? []) {
      const tomb = tombs.get(p.meta.id);
      if (tomb && tomb.deletedAt >= p.meta.updatedAt) continue;
      const mine = byId.get(p.meta.id);
      if (!mine || p.meta.updatedAt > mine.updatedAt) {
        storage.setItem(bodyKey(p.meta.id), p.body);
        byId.set(p.meta.id, p.meta);
        changed = true;
      }
    }
    for (const [id, meta] of [...byId]) {
      const tomb = tombs.get(id);
      if (tomb && tomb.deletedAt >= meta.updatedAt) {
        storage.removeItem(bodyKey(id));
        byId.delete(id);
        if (storage.getItem(ACTIVE_KEY) === id) storage.removeItem(ACTIVE_KEY);
        changed = true;
      }
    }
    writeIndex([...byId.values()]);
    writeTombstones([...tombs.values()]);

    // Trash union (newest deletedAt wins), minus anything alive again.
    const trash = new Map(readTrash().map((t) => [t.meta.id, t]));
    for (const t of remote.trash ?? []) {
      const mine = trash.get(t.meta.id);
      if (!mine || t.deletedAt > mine.deletedAt) {
        trash.set(t.meta.id, t);
        changed = true;
      }
    }
    for (const id of [...trash.keys()]) if (byId.has(id)) trash.delete(id);
    writeTrash([...trash.values()]);
    return changed;
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
    exportLibrary,
    mergeLibrary,
    listTrash,
    restoreProject,
    clearTombstones,
  };
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

/** The browser-bound store. Only touch this from client components. */
export function browserProjectStore(): ProjectStore {
  return createProjectStore(globalThis.localStorage);
}
