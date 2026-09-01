// Client side of cross-device sync: pull the workspace blob, fold it into
// the local stores (newer-updatedAt wins per project, tombstones delete
// everywhere, newer catalog wins), then push the merged snapshot back up.
// localStorage stays the fast source of truth for the UI; the cloud blob is
// how the same passphrase on another device (phone!) gets the same library.

import type { CatalogOverrides, CatalogStore } from "./catalog";
import type { CloudLibraryData, ProjectStore } from "./projectStore";

export const SYNC_KEY_STORAGE = "rfc-estimator:syncKey";

export interface CloudLibrary extends CloudLibraryData {
  version: 1;
  exportedAt: number;
  catalog?: CatalogOverrides;
}

export interface SyncOutcome {
  /** Anything local changed (UI should reload from the stores). */
  changedLocally: boolean;
}

async function pull(key: string): Promise<CloudLibrary | null> {
  const res = await fetch("/api/workspace", { headers: { "x-workspace-key": key } });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `sync pull failed (${res.status})`);
  return (await res.json()) as CloudLibrary | null;
}

async function push(key: string, lib: CloudLibrary): Promise<void> {
  const res = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "x-workspace-key": key, "content-type": "application/json" },
    body: JSON.stringify(lib),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `sync push failed (${res.status})`);
}

/** One full round trip: pull -> merge into local -> push the union. */
export async function syncOnce(key: string, store: ProjectStore, catalog: CatalogStore): Promise<SyncOutcome> {
  const remote = await pull(key);
  let changedLocally = false;
  if (remote) {
    changedLocally = store.mergeLibrary(remote);
    if (catalog.mergeCatalog(remote.catalog).changed) changedLocally = true;
  }
  const merged: CloudLibrary = {
    version: 1,
    exportedAt: Date.now(),
    ...store.exportLibrary(),
    catalog: catalog.getOverrides(),
  };
  await push(key, merged);
  return { changedLocally };
}
