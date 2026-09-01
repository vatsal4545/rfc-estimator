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
  const { switchProject, deleteProject, renameProject, duplicateProject, projects } = useProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

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
        <button
          className="rounded p-0.5 text-zinc-400 hover:text-red-600"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            const last = projects.length <= 1;
            if (
              confirm(
                `Delete "${displayName(meta)}"? This cannot be undone.${last ? " A fresh blank project will be created." : ""}`,
              )
            ) {
              deleteProject(meta.id);
            }
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function ProjectSidebar({ open }: { open: boolean }) {
  const { projects, activeId, newProject } = useProject();
  if (!open) return null;

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="p-3">
        <button
          onClick={newProject}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New project
        </button>
      </div>
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        Projects ({projects.length})
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {projects.map((m) => (
          <Row key={m.id} meta={m} active={m.id === activeId} />
        ))}
      </div>
      <div className="border-t border-zinc-200 p-3 text-[11px] text-zinc-400 dark:border-zinc-800">
        Saved locally in this browser. Use Export for a shareable file.
      </div>
    </aside>
  );
}
