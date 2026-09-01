import { describe, expect, it, vi } from "vitest";
import { defaultProject } from "../calc/defaults";
import { createProjectStore, displayName, type StorageLike } from "../projectStore";

function memoryStorage(): StorageLike & { dump: () => Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

describe("project store", () => {
  it("creates, lists, saves and switches projects", () => {
    const store = createProjectStore(memoryStorage());
    const a = store.createProject(defaultProject());
    const b = store.createProject(defaultProject(), "Bartel Hotel");
    expect(store.listProjects().length).toBe(2);

    const body = store.loadProject(a.id)!;
    body.setup.clientName = "Dana Inn";
    store.setActiveId(a.id);
    store.saveProject(a.id, body);

    const metas = store.listProjects();
    // saveProject bumps updatedAt, so a sorts first, and clientName snapshots.
    expect(metas[0].id).toBe(a.id);
    expect(metas[0].clientName).toBe("Dana Inn");
    expect(displayName(metas[0])).toBe("Dana Inn");
    expect(displayName(metas.find((m) => m.id === b.id)!)).toBe("Bartel Hotel");
    expect(store.loadProject(a.id)!.setup.clientName).toBe("Dana Inn");
  });

  it("migrates the legacy single-project key once and keeps mirroring the active body", () => {
    const storage = memoryStorage();
    const legacy = defaultProject();
    legacy.setup.clientName = "Legacy Motel";
    storage.setItem("rfc-estimator:project:v1", JSON.stringify(legacy));

    const store = createProjectStore(storage);
    const boot = store.initStore()!;
    expect(boot.project.setup.clientName).toBe("Legacy Motel");
    expect(store.listProjects().length).toBe(1);

    // Re-init must not duplicate the migrated project.
    expect(createProjectStore(storage).initStore()!.id).toBe(boot.id);
    expect(store.listProjects().length).toBe(1);

    // Saving the active project mirrors to the legacy key (rollback safety).
    boot.project.setup.clientName = "Renamed";
    store.saveProject(boot.id, boot.project);
    expect(JSON.parse(storage.getItem("rfc-estimator:project:v1")!).setup.clientName).toBe("Renamed");
  });

  it("rename, duplicate and delete update the index and active id", () => {
    const store = createProjectStore(memoryStorage());
    const a = store.createProject(defaultProject(), "Site A");
    store.setActiveId(a.id);

    store.renameProject(a.id, "Site A2");
    expect(displayName(store.listProjects()[0])).toBe("Site A2");

    const copy = store.duplicateProject(a.id)!;
    expect(displayName(copy)).toBe("Site A2 (copy)");
    expect(store.loadProject(copy.id)).not.toBeNull();
    expect(store.listProjects().length).toBe(2);

    store.deleteProject(a.id);
    expect(store.listProjects().map((m) => m.id)).toEqual([copy.id]);
    expect(store.loadProject(a.id)).toBeNull();
    expect(store.getActiveId()).toBeNull(); // active was deleted
  });

  it("compacts stored bodies (no shipped catalog copies) and re-expands on load", () => {
    const storage = memoryStorage();
    const store = createProjectStore(storage);
    const project = defaultProject();
    // One edited default + one custom model must survive the round trip.
    project.loadTypes = project.loadTypes.map((lt) =>
      lt.id === "DCFC 200kW" ? { ...lt, feederOcpdA: 400 } : lt,
    );
    project.loadTypes.push({ ...project.loadTypes[0], id: "My Custom 75kW" });
    const meta = store.createProject(project);
    store.setActiveId(meta.id);
    store.saveProject(meta.id, project);

    // Stored body carries only the 2 non-catalog load types, an order of
    // magnitude smaller than the full project (the 5 MB quota then fits
    // ~1000 projects instead of ~100).
    const raw = storage.dump()[`rfc-estimator:project:v1:${meta.id}`];
    expect(JSON.parse(raw).loadTypes.length).toBe(2);
    expect(raw.length).toBeLessThan(JSON.stringify(project).length / 3);

    const loaded = store.loadProject(meta.id)!;
    expect(loaded.loadTypes.length).toBe(project.loadTypes.length);
    expect(loaded.loadTypes.map((l) => l.id)).toEqual(project.loadTypes.map((l) => l.id)); // canonical order kept
    expect(loaded.loadTypes.find((l) => l.id === "DCFC 200kW")!.feederOcpdA).toBe(400);
    expect(loaded.loadTypes.find((l) => l.id === "My Custom 75kW")).toBeDefined();
  });

  it("cloud merge: newer wins per project, tombstones delete everywhere, local-only survives", () => {
    // Fake timers: merge compares updatedAt, so each step needs its own tick
    // (real cross-device edits are seconds apart; the test runs in one ms).
    vi.useFakeTimers();
    const tick = () => vi.advanceTimersByTime(1000);
    // Device A and device B share a workspace.
    const a = createProjectStore(memoryStorage());
    const b = createProjectStore(memoryStorage());
    const pShared = defaultProject();
    pShared.setup.clientName = "Shared Site";
    const sharedMeta = a.createProject(pShared);
    const aOnly = a.createProject(defaultProject(), "A only");

    tick();
    // B receives A's snapshot.
    expect(b.mergeLibrary(a.exportLibrary())).toBe(true);
    expect(b.listProjects().length).toBe(2);

    tick();
    // B edits the shared project (newer updatedAt) and deletes "A only".
    const onB = b.loadProject(sharedMeta.id)!;
    onB.setup.clientName = "Shared Site v2";
    b.setActiveId(sharedMeta.id);
    b.saveProject(sharedMeta.id, onB);
    b.deleteProject(aOnly.id);

    tick();
    // Meanwhile A creates a fresh local-only project.
    const aNew = a.createProject(defaultProject(), "A newest");

    tick();
    // A merges B's snapshot: edit adopted, deletion propagated, local-only kept.
    expect(a.mergeLibrary(b.exportLibrary())).toBe(true);
    const ids = a.listProjects().map((m) => m.id);
    expect(ids).toContain(sharedMeta.id);
    expect(ids).toContain(aNew.id);
    expect(ids).not.toContain(aOnly.id);
    expect(a.loadProject(sharedMeta.id)!.setup.clientName).toBe("Shared Site v2");

    // Re-merging the same snapshot is a no-op; the deleted project must NOT
    // resurrect from an older snapshot either.
    expect(a.mergeLibrary(b.exportLibrary())).toBe(false);
    vi.useRealTimers();
  });

  it("initStore returns null on an empty library and survives corrupt blobs", () => {
    const storage = memoryStorage();
    expect(createProjectStore(storage).initStore()).toBeNull();
    storage.setItem("rfc-estimator:project:v1", "{not json");
    storage.setItem("rfc-estimator:projects:v1", "also not json");
    expect(createProjectStore(storage).initStore()).toBeNull();
  });
});
