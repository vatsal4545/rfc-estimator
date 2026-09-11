// Client side of cross-device sync: pull the account's workspace, fold it
// into the local stores (newer-updatedAt wins per project, tombstones delete
// everywhere, newer catalog wins), then push the merged snapshot back up.
// localStorage stays the fast source of truth for the UI; the cloud workspace
// is how signing in on another device (phone!) gets the same library.

import type { CatalogOverrides, CatalogStore } from "./catalog";
import type { CloudLibraryData, ProjectStore } from "./projectStore";

export const SESSION_STORAGE = "rfc-estimator:session:v1";

export interface Session {
  token: string;
  username: string;
}

export interface CloudLibrary extends CloudLibraryData {
  version: 1;
  exportedAt: number;
  catalog?: CatalogOverrides;
}

export interface SyncOutcome {
  /** Anything local changed (UI should reload from the stores). */
  changedLocally: boolean;
  /** Whether this round trip actually wrote anything. */
  pushed: boolean;
}

// ---- auth calls ---------------------------------------------------------------

async function authCall(body: Record<string, string>, token?: string): Promise<Record<string, string>> {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as Record<string, string> | null;
  if (!res.ok) throw new Error(json?.error ?? `request failed (${res.status})`);
  return json ?? {};
}

export async function apiRegister(username: string, email: string, password: string): Promise<Session> {
  const r = await authCall({ action: "register", username, email, password });
  return { token: r.token, username: r.username };
}

export async function apiLogin(username: string, password: string): Promise<Session> {
  const r = await authCall({ action: "login", username, password });
  return { token: r.token, username: r.username };
}

export async function apiChangePassword(token: string, current: string, next: string): Promise<void> {
  await authCall({ action: "change-password", current, next }, token);
}

export async function apiResetRequest(username: string): Promise<string> {
  return (await authCall({ action: "reset-request", username })).message ?? "";
}

export async function apiReset(username: string, code: string, newPassword: string): Promise<Session> {
  const r = await authCall({ action: "reset", username, code, newPassword });
  return { token: r.token, username: r.username };
}

// ---- workspace sync -------------------------------------------------------------

async function pull(token: string): Promise<CloudLibrary | null> {
  const res = await fetch("/api/workspace", { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `sync pull failed (${res.status})`);
  return (await res.json()) as CloudLibrary | null;
}

async function push(token: string, lib: CloudLibrary): Promise<void> {
  const res = await fetch("/api/workspace", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(lib),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `sync push failed (${res.status})`);
}

/**
 * Content identity of a library, for deciding whether a write is worth making.
 * exportedAt is excluded on purpose: it is stamped Date.now() on every call, so
 * including it would make every snapshot look different from every other one.
 * Keys are sorted so a change in property order cannot masquerade as an edit.
 */
function contentKey(lib: CloudLibrary): string {
  return JSON.stringify(
    { ...lib, exportedAt: undefined },
    (_k, val) =>
      val && typeof val === "object" && !Array.isArray(val)
        ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
        : val,
  );
}

/**
 * One full round trip: pull -> merge into local -> push the union, but only if
 * the union differs from what the server already holds.
 *
 * The push used to be unconditional. With a poll running while any signed-in
 * tab is open that is a write every cycle whether or not anything changed —
 * ~2,880 writes a day from a tab nobody is touching, which exhausted the blob
 * store's monthly write allowance and got it suspended. An idle tab now costs
 * one read per poll and no writes at all.
 */
export async function syncOnce(token: string, store: ProjectStore, catalog: CatalogStore): Promise<SyncOutcome> {
  const remote = await pull(token);
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
  // No remote at all means a new workspace, which always needs its first write.
  const pushed = !remote || contentKey(merged) !== contentKey(remote);
  if (pushed) await push(token, merged);
  return { changedLocally, pushed };
}
