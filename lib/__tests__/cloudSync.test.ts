import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogStore } from "../catalog";
import { syncOnce } from "../cloudSync";
import type { CloudLibraryData, ProjectStore } from "../projectStore";

// A signed-in tab polls, and every poll used to pull AND push — unconditionally,
// whether or not anything had changed. At one push every 30 seconds that is
// ~2,880 writes a day from a tab nobody is touching, which is what exhausted the
// blob store's monthly write allowance and suspended it.

const LIBRARY: CloudLibraryData = {
  projects: [{ id: "p1", name: "Best Western", updatedAt: 1000, body: "x" } as never],
  tombstones: [],
};

function fakes(remoteChanges = false) {
  const store = {
    exportLibrary: () => structuredClone(LIBRARY),
    mergeLibrary: () => remoteChanges,
  } as unknown as ProjectStore;
  const catalog = {
    getOverrides: () => ({}),
    mergeCatalog: () => ({ catalog: {}, changed: false }),
  } as unknown as CatalogStore;
  return { store, catalog };
}

let calls: { method: string; body?: string }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, body: init?.body as string | undefined });
    if (method === "GET") {
      // The server already holds exactly what this device would send.
      return new Response(JSON.stringify({ version: 1, exportedAt: 500, ...LIBRARY, catalog: {} }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("syncOnce only writes when there is something to write", () => {
  it("does not push when the merged library already matches the server", async () => {
    const { store, catalog } = fakes();
    const out = await syncOnce("tok", store, catalog);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    expect(out.pushed).toBe(false);
  });

  it("ignores exportedAt, which changes on every call and means nothing", async () => {
    // The remote copy was stamped at 500 and this one will be stamped now; that
    // difference alone must not buy a write.
    const { store, catalog } = fakes();
    await syncOnce("tok", store, catalog);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("pushes when the local library genuinely differs", async () => {
    const store = {
      exportLibrary: () => ({ projects: [{ id: "p1", name: "Renamed", updatedAt: 2000, body: "y" } as never], tombstones: [] }),
      mergeLibrary: () => false,
    } as unknown as ProjectStore;
    const { catalog } = fakes();
    const out = await syncOnce("tok", store, catalog);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(out.pushed).toBe(true);
  });

  it("pushes on a brand-new workspace, where the server holds nothing", async () => {
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method });
      if (method === "GET") return new Response("null", { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { store, catalog } = fakes();
    const out = await syncOnce("tok", store, catalog);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(out.pushed).toBe(true);
  });

  it("still reports remote edits that landed locally", async () => {
    const { store, catalog } = fakes(true);
    const out = await syncOnce("tok", store, catalog);
    expect(out.changedLocally).toBe(true);
  });
});
