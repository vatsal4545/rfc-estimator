import { effectiveInstallMethod } from "./install";
import type { EquipmentRentalItem, EquipmentResult, Rollups, Setup } from "./types";

// "Temporary fencing" tracks the job's longest run the same way Equipment!D6
// did in CPM_Clean.xlsx (a live formula, not a manual cell) — it is
// recomputed from the current Takeoff every time, ignoring whatever qty was
// last stored, so it can't go stale as runs are added or edited.
export const AUTO_QTY_ITEM = "Temporary fencing";

export function computeEquipment(
  items: EquipmentRentalItem[],
  setup: Setup,
  rollups: Rollups,
): EquipmentResult {
  // Fencing follows the open trench: the whole route on a trench job, just
  // the service section on a hybrid, none on a pure surface-EMT install.
  const method = effectiveInstallMethod(setup);
  const fencedFt =
    method === "trench" ? rollups.longestRunFt : method === "hybrid" ? setup.trenchLengthFt : 0;
  const autoFencingQty = fencedFt > 0 ? fencedFt * 2 + 60 : 0;
  const withTotals = items.map((item) => {
    const qty = item.name === AUTO_QTY_ITEM ? autoFencingQty : item.qty;
    // An excluded line still reports its quantity — the row has to stay
    // readable, and putting it back should cost nothing but a click — but it
    // contributes no money, delivery included.
    const total = item.excluded ? 0 : qty * item.rate * item.durationValue + (qty > 0 ? item.delivery : 0);
    return { ...item, qty, total };
  });
  const subtotal = withTotals.reduce((s, i) => s + i.total, 0);
  return { items: withTotals, subtotal };
}

export function defaultEquipmentItems(conduitType: "PVC" | "EMT", maxRunFt: number): EquipmentRentalItem[] {
  return [
    { name: "Temporary fencing", qty: conduitType === "PVC" ? maxRunFt * 2 + 60 : 0, rate: 2.95, rateBasis: "per ft per week", durationValue: 2, delivery: 800 },
    { name: "Mini excavator", qty: 1, rate: 2110, rateBasis: "per month", durationValue: 1, delivery: 0 },
    { name: "Dump truck", qty: 0, rate: 520, rateBasis: "per day", durationValue: 1, delivery: 0 },
    { name: "Forklift", qty: 1, rate: 563, rateBasis: "per day", durationValue: 2, delivery: 400 },
    { name: "Trench plates", qty: 0, rate: 5.18, rateBasis: "per day", durationValue: 30, delivery: 0 },
    { name: "Scissor lift", qty: 0, rate: 1150, rateBasis: "per month", durationValue: 1, delivery: 150 },
    { name: "Storage container", qty: 1, rate: 185, rateBasis: "per month", durationValue: 1, delivery: 400 },
    { name: "Portable restroom", qty: 1, rate: 267, rateBasis: "per month", durationValue: 1, delivery: 65 },
    { name: "Lowboy transport", qty: 1, rate: 1000, rateBasis: "each way", durationValue: 1, delivery: 0 },
    { name: "Saw cutter", qty: 1, rate: 169, rateBasis: "per day", durationValue: 1, delivery: 0 },
    { name: "Jack hammer", qty: 1, rate: 155, rateBasis: "per day", durationValue: 1, delivery: 0 },
    { name: "Compactor", qty: 1, rate: 175, rateBasis: "per day", durationValue: 1, delivery: 0 },
  ];
}
