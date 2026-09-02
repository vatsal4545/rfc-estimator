"use client";

import type { Project } from "@/lib/calc/types";
import { canRebuild, clearSticky, isSticky, rebuildProject, setSticky, type StickyPath } from "@/lib/intake/rebuild";
import { useProject } from "../ProjectContext";

/**
 * The intake tabs edit one field at a time and the estimate follows: every
 * change to the equipment or the electrical inputs regenerates the takeoff,
 * gear, civil quantities, labour days, fees and rentals from the Quick
 * Estimate inputs — except the fields someone pinned by hand (project.sticky).
 * A takeoff built by hand on the estimator tabs is never regenerated.
 */
export function useRebuild() {
  const { project, setProject, hardwareAllowance } = useProject();
  const auto = canRebuild(project);
  const rebuild = (mutate: (p: Project) => Project) =>
    setProject((p) => {
      const next = mutate(p);
      return canRebuild(next) ? rebuildProject(next, hardwareAllowance) : next;
    });
  /** Type a value into a rebuild-derived field: it lands and stays through rebuilds. */
  const pin = (path: StickyPath, value: unknown) => setProject((p) => setSticky(p, path, value));
  /** Hand a pinned field back to the engine. */
  const unpin = (path: StickyPath) =>
    setProject((p) => {
      const cleared = clearSticky(p, path);
      return canRebuild(cleared) ? rebuildProject(cleared, hardwareAllowance) : cleared;
    });
  const pinned = (path: StickyPath) => isSticky(project, path);
  return { auto, rebuild, pin, unpin, pinned };
}
