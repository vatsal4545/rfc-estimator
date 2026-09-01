"use client";

import { displayName, type ProjectMeta } from "@/lib/projectStore";
import { useState } from "react";
import { useProject } from "./ProjectContext";

function relativeTime(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function Row({ meta, active }: { meta: ProjectMeta; active: boolean }) {
  const { switchProject, deleteProject, renameProject, duplicateProject } = useProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Inline two-click delete — native confirm() dialogs get suppressed by the
  // browser after "prevent additional dialogs", silently breaking delete.
  const [confirming, setConfirming] = useState(false);

  const commitRename = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== displayName(meta)) renameProject(meta.id, draft);
  };

  return (
    <div
      className={`group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
        active
          ? "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
      onClick={() => !editing && switchProject(meta.id)}
      title={displayName(meta)}
    >
      {editing ? (
        <input
          autoFocus
          className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-0.5 text-sm dark:bg-zinc-900"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{displayName(meta)}</div>
          <div className="text-[11px] text-zinc-400">{relativeTime(meta.updatedAt)}</div>
        </div>
      )}
      <div className="hidden shrink-0 gap-0.5 group-hover:flex">
        <button
          className="rounded p-0.5 text-zinc-400 hover:text-blue-600"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation();
            setDraft(displayName(meta));
            setEditing(true);
          }}
        >
          ✎
        </button>
        <button
          className="rounded p-0.5 text-zinc-400 hover:text-blue-600"
          title="Duplicate"
          onClick={(e) => {
            e.stopPropagation();
            duplicateProject(meta.id);
          }}
        >
          ⧉
        </button>
        {confirming ? (
          <button
            className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white hover:bg-red-700"
            title="Click again to permanently delete"
            onClick={(e) => {
              e.stopPropagation();
              deleteProject(meta.id);
            }}
            onMouseLeave={() => setConfirming(false)}
          >
            Delete?
          </button>
        ) : (
          <button
            className="rounded p-0.5 text-zinc-400 hover:text-red-600"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
              setTimeout(() => setConfirming(false), 4000);
            }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// Keep the DOM light with big libraries — the search box narrows the rest.
const MAX_VISIBLE_ROWS = 100;

export function ProjectSidebar({ open }: { open: boolean }) {
  const { projects, activeId, newProject } = useProject();
  const [query, setQuery] = useState("");
  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = q ? projects.filter((m) => displayName(m).toLowerCase().includes(q)) : projects;
  const visible = filtered.slice(0, MAX_VISIBLE_ROWS);
  const hidden = filtered.length - visible.length;

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="space-y-2 p-3">
        <button
          onClick={newProject}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New project
        </button>
        <input
          type="search"
          placeholder="Search projects…"
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        {q ? `${filtered.length} of ${projects.length} projects` : `Projects (${projects.length})`}
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {visible.map((m) => (
          <Row key={m.id} meta={m} active={m.id === activeId} />
        ))}
        {hidden > 0 && (
          <div className="px-2 py-2 text-[11px] text-zinc-400">
            …and {hidden} more — type in the search box to narrow down.
          </div>
        )}
        {filtered.length === 0 && (
          <div className="px-2 py-2 text-[11px] text-zinc-400">No project matches “{query}”.</div>
        )}
      </div>
      <TrashSection />
      <SyncPanel />
    </aside>
  );
}

function TrashSection() {
  const { trash, restoreProject } = useProject();
  const [open, setOpen] = useState(false);
  if (trash.length === 0) return null;

  return (
    <div className="border-t border-zinc-200 px-2 py-2 dark:border-zinc-800">
      <button
        className="w-full px-1 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-600"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾" : "▸"} Recently deleted ({trash.length})
      </button>
      {open && (
        <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
          {trash.map((t) => (
            <div key={t.meta.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-zinc-500">
              <span className="min-w-0 flex-1 truncate" title={displayName(t.meta)}>
                {displayName(t.meta)}
              </span>
              <span className="shrink-0 text-[10px] text-zinc-400">{relativeTime(t.deletedAt)}</span>
              <button
                className="shrink-0 font-medium text-blue-600 hover:underline"
                onClick={() => restoreProject(t.meta.id)}
                title="Restore this project (also restores it on synced devices)"
              >
                restore
              </button>
            </div>
          ))}
          <div className="px-1.5 pt-1 text-[10px] text-zinc-400">Kept for 30 days, then purged.</div>
        </div>
      )}
    </div>
  );
}

function SyncPanel() {
  const { syncKey, setSyncKey, syncState, syncNow } = useProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const statusLine = () => {
    switch (syncState.status) {
      case "syncing":
        return <span className="text-blue-500">Syncing…</span>;
      case "synced":
        return <span className="text-green-600">✓ Synced {syncState.at ? relativeTime(syncState.at) : ""}</span>;
      case "error":
        return (
          <span className="text-red-500" title={syncState.message}>
            Sync error — retrying
          </span>
        );
      default:
        return null;
    }
  };

  if (editing || !syncKey) {
    return (
      <div className="space-y-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        {!editing ? (
          <>
            <div className="text-[11px] text-zinc-400">
              Local only — projects live in this browser. Turn on sync to see them on your phone too.
            </div>
            <button
              className="w-full rounded-md border border-blue-600 px-2 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
              onClick={() => {
                setDraft("");
                setEditing(true);
              }}
            >
              ☁ Turn on cloud sync
            </button>
          </>
        ) : (
          <>
            <div className="text-[11px] text-zinc-400">
              Pick a sync passphrase (6+ characters) and enter the SAME one on every device — it is the key to
              your library, so make it unguessable and treat it like a password.
            </div>
            <input
              autoFocus
              type="password"
              placeholder="Sync passphrase"
              className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim().length >= 6) {
                  setSyncKey(draft);
                  setEditing(false);
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="flex gap-2">
              <button
                disabled={draft.trim().length < 6}
                className="flex-1 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                onClick={() => {
                  setSyncKey(draft);
                  setEditing(false);
                }}
              >
                Connect
              </button>
              <button
                className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 border-t border-zinc-200 p-3 text-[11px] dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span>☁ Cloud sync</span>
        {statusLine()}
      </div>
      <div className="flex gap-2">
        <button className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={syncNow}>
          Sync now
        </button>
        <button
          className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          title="Disconnect this device (projects stay local; cloud copy is kept)"
          onClick={() => setSyncKey("")}
        >
          Disconnect
        </button>
      </div>
      <div className="text-zinc-400">Same passphrase on your phone = same projects, refreshed every 30 s.</div>
    </div>
  );
}
