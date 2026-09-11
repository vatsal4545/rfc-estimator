import { describe, expect, it } from "vitest";
import { defaultProject } from "../defaults";
import { AUTO_QTY_ITEM, computeEquipment } from "../equipment";
import type { EquipmentRentalItem, Rollups, Setup } from "../types";

const setup: Setup = { ...defaultProject().setup, installMethod: "trench" };
const rollups = { longestRunFt: 200 } as Rollups;

const item = (over: Partial<EquipmentRentalItem> = {}): EquipmentRentalItem => ({
  name: "Mini excavator",
  qty: 1,
  rate: 2110,
  rateBasis: "per month",
  durationValue: 1,
  delivery: 300,
  ...over,
});

// Zeroing a quantity is not the same as saying "we are not renting this". It
// loses the number you had, and it cannot touch the fencing line at all, whose
// quantity is computed from the trench.
describe("excluding an equipment line", () => {
  it("prices an included line normally", () => {
    const r = computeEquipment([item()], setup, rollups);
    expect(r.items[0].total).toBe(2110 + 300);
    expect(r.subtotal).toBe(2410);
  });

  it("drops an excluded line from the subtotal", () => {
    const r = computeEquipment([item({ excluded: true })], setup, rollups);
    expect(r.items[0].total).toBe(0);
    expect(r.subtotal).toBe(0);
  });

  it("keeps the excluded line's quantity and rate so it can come back", () => {
    const r = computeEquipment([item({ excluded: true })], setup, rollups);
    expect(r.items[0].qty).toBe(1);
    expect(r.items[0].rate).toBe(2110);
  });

  it("excludes the auto-quantity fencing line, which no quantity can zero", () => {
    const fencing = item({ name: AUTO_QTY_ITEM, qty: 0, rate: 2.95, durationValue: 2, delivery: 800 });
    const on = computeEquipment([fencing], setup, rollups);
    expect(on.items[0].qty).toBe(200 * 2 + 60); // computed from the trench, not the stored qty
    expect(on.subtotal).toBeGreaterThan(0);

    const off = computeEquipment([{ ...fencing, excluded: true }], setup, rollups);
    expect(off.items[0].qty).toBe(460); // still reported, so the row still reads sensibly
    expect(off.subtotal).toBe(0);
  });
});
