// Conduit installation method: underground trench (the CPM_Clean baseline),
// surface-mounted EMT (parking garages — the ceiling-rack install in the
// shop's site photos), or a hybrid (chargers in EMT inside the structure,
// trench only for the utility/switchgear service section outside).
//
// Surface EMT support model, per NEC 358.30:
//   (A) EMT must be securely fastened at least every 10 ft, and within 3 ft
//       of every outlet box, junction box, cabinet or termination.
// Multi-run banks share strut trapeze racks (channel + threaded rod), one
// rack every 10 ft along the common route; each conduit lands on every rack
// with its own strut strap. Runs along a wall use one-hole/two-hole straps
// anchored to the structure at the same 10-ft rhythm.

import type { InstallMethod, Setup } from "./types";

export interface InstallMethodInfo {
  label: string;
  blurb: string;
  /** Trenching required: "full" (whole route), "service" (switchgear section only), "none". */
  trench: "full" | "service" | "none";
}

export const INSTALL_METHOD_INFO: Record<InstallMethod, InstallMethodInfo> = {
  trench: {
    label: "Trenched (underground)",
    blurb: "Open-cut trench, PVC conduit, backfill and asphalt patch — outdoor lots.",
    trench: "full",
  },
  surface: {
    label: "Surface EMT (garage)",
    blurb: "EMT on strut trapeze racks every 10 ft (NEC 358.30) — no digging. Parking structures.",
    trench: "none",
  },
  hybrid: {
    label: "Hybrid (EMT + service trench)",
    blurb: "Chargers in surface EMT inside the garage; trench only the utility → switchgear section.",
    trench: "service",
  },
};

/**
 * Projects saved before the install-method option carry only the conduit
 * toggle: EMT implied a no-dig install, PVC implied the trenched baseline.
 */
export function effectiveInstallMethod(setup: Setup): InstallMethod {
  return setup.installMethod ?? (setup.conduitType === "EMT" ? "surface" : "trench");
}

// ---------------------------------------------------------------------------
// Surface-support material rates (2025-26 US mid-range contractor pricing,
// see the EMT research notes in the repo docs; all editable downstream).
// ---------------------------------------------------------------------------

export const EMT_SUPPORT_RATES = {
  /**
   * One field-built trapeze rack: ~2 ft of 12-ga galvanized strut (Unistrut
   * P1000 / B-Line B22 class, $25-40 per 10-ft stick), 2 × 3/8" threaded rod
   * drops ($1.2-2/ft), 4 channel nuts + hardware, 2 wedge anchors ($0.49) or
   * beam clamps ($3.6-6). Researched field-built total $18-30; NECA labor
   * ≈ 0.9 h each is carried in the labor-day model, not here.
   */
  trapezeMaterial: 28,
  /**
   * Strut conduit clamp per pipe per rack (Superstrut Z703 class: 3/4" $2.38,
   * 1-1/2" $5.92, 2" $6.78 retail; ~half wholesale) — blended across the L2
   * (3/4"-1") and DCFC (2"-3") mix.
   */
  strutStrapEach: 3.25,
  /**
   * EMT coupling per 10-ft stick, blended across trade sizes (set-screw 1/2"
   * $0.54 → 2" $5-9). Open-air decks are damp/wet locations — NEC 358.42
   * wants listed raintight compression there (~2-3× set-screw): use the
   * hardware line's unit-cost override for those sites.
   */
  couplingEach: 3.5,
  /** Rack spacing along the route (NEC 358.30(A) maximum; crews commonly hang at 8 ft o.c.). */
  supportSpacingFt: 10,
} as const;

/**
 * Surface-EMT production, route-ft per crew-day: NECA labor units run 5-11
 * h/100 ft per conduit (3/4"-3") plus ~0.9 h per trapeze; a multi-run rack at
 * garage-ceiling height nets ≈ 100 route-ft per crew-day — vs the 40 ft/day
 * open-cut trench baseline the labor model uses for underground work.
 */
export const SURFACE_FT_PER_CREW_DAY = 100;

/** Trapeze racks along the common route: one every 10 ft plus the end rack (358.30 also wants one within 3 ft of each termination). */
export function trapezeCount(routeFt: number): number {
  if (routeFt <= 0) return 0;
  return Math.ceil(routeFt / EMT_SUPPORT_RATES.supportSpacingFt) + 1;
}

/** One strap per conduit per rack ≈ one per 10 conduit-ft across the whole bank. */
export function strutStrapCount(totalConduitFt: number): number {
  if (totalConduitFt <= 0) return 0;
  return Math.ceil(totalConduitFt / EMT_SUPPORT_RATES.supportSpacingFt);
}

/**
 * The ceiling/wall route the conduit rack follows. Explicit surveyed length
 * wins; otherwise the longest run on the takeoff approximates the trunk.
 */
export function surfaceRouteFt(setup: Setup, longestRunFt: number): number {
  if (setup.surfaceRouteFt && setup.surfaceRouteFt > 0) return setup.surfaceRouteFt;
  return longestRunFt;
}
