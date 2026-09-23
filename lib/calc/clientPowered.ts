// Client-powered chargers: units fed from the client's existing panel or board
// instead of our service — two of twenty, say, or every Level 2 unit
// (peripherals.l2ClientPowered). Their load leaves our buses, so the
// switchgear, step-down and sub-panel size on the rest; their branch breakers
// and circuits stay priced.

import { findLoadType } from "./tables";
import type { Category, LoadType, TakeoffRowInput } from "./types";

type Row = Pick<TakeoffRowInput, "clientPowered" | "units" | "synthetic"> & { category?: Category | "" };

/** Whether a charger row is client powered: its own flag, or the all-Level-2 switch. */
export function isClientPowered(row: Row, l2AllClientPowered?: boolean): boolean {
  if (row.synthetic) return false;
  if (row.category !== "L2" && row.category !== "DCFC") return false;
  return !!row.clientPowered || (!!l2AllClientPowered && row.category === "L2");
}

export interface ClientPoweredCounts {
  /** Charger units fed from the client's gear. */
  dc: number;
  l2: number;
  total: number;
  /** Every charger unit on the takeoff, ours and the client's. */
  chargers: number;
}

/** Client-powered charger units on a takeoff (computed rows carry their category; input rows resolve it from the load types). */
export function clientPoweredCounts(rows: (TakeoffRowInput & { category?: Category | "" })[], loadTypes: LoadType[], l2AllClientPowered?: boolean): ClientPoweredCounts {
  let dc = 0;
  let l2 = 0;
  let chargers = 0;
  for (const r of rows) {
    if (r.synthetic) continue;
    const category = r.category ?? findLoadType(loadTypes, r.loadTypeId)?.category ?? "";
    if (category !== "L2" && category !== "DCFC") continue;
    const units = Math.max(1, r.units);
    chargers += units;
    if (!isClientPowered({ ...r, category }, l2AllClientPowered)) continue;
    if (category === "L2") l2 += units;
    else dc += units;
  }
  return { dc, l2, total: dc + l2, chargers };
}

/** "2 of 20 chargers client powered (2 Level 2)" — for the scope sentence, the schedule and the handoff. */
export function clientPoweredPhrase(c: ClientPoweredCounts): string {
  if (c.total === 0) return "";
  const parts = [c.dc ? `${c.dc} DC` : "", c.l2 ? `${c.l2} Level 2` : ""].filter(Boolean).join(" + ");
  return `${c.total} of ${c.chargers} charger${c.chargers === 1 ? "" : "s"} client powered (${parts})`;
}
