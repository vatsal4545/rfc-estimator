"use client";

import { computeEstimate } from "@/lib/calc/engine";
import { defaultProject } from "@/lib/calc/defaults";
import { DEFAULT_LOAD_TYPES } from "@/lib/calc/tables";
import type { EstimateResult, LoadType, Project } from "@/lib/calc/types";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "rfc-estimator:project:v1";

function loadInitialProject(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored: Project = JSON.parse(raw);
      // Saved projects keep their own charger library (including edits), but
      // built-in models added in newer app versions are merged in so they
      // don't silently vanish from the dropdowns.
      const have = new Set(stored.loadTypes.map((l) => l.id));
      const missing = DEFAULT_LOAD_TYPES.filter((l) => !have.has(l.id));
      if (missing.length > 0) stored.loadTypes = [...stored.loadTypes, ...missing];
      return stored;
    }
  } catch {
    // ignore corrupt storage
  }
  return defaultProject();
}

interface Ctx {
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  result: EstimateResult;
  loadTypes: LoadType[];
  resetProject: () => void;
}

const ProjectCtx = createContext<Ctx | null>(null);

// This provider is only ever mounted client-side (see app/page.tsx's
// dynamic import with ssr: false), so it's safe to read localStorage
// directly in the initializer instead of loading it in an effect.
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [project, setProject] = useState<Project>(loadInitialProject);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  const result = useMemo(() => computeEstimate(project), [project]);

  const resetProject = () => {
    setProject(defaultProject());
  };

  return (
    <ProjectCtx.Provider value={{ project, setProject, result, loadTypes: project.loadTypes, resetProject }}>
      {children}
    </ProjectCtx.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error("useProject must be used inside ProjectProvider");
  return ctx;
}
