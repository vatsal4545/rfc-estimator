import { describe, expect, it } from "vitest";
import { isAutoLocation, locationForLoadType } from "../quickstart";

const LOAD_TYPE_IDS = ["DCFC 200kW", "L2 Dual 40A", "L2 Single 40A"];

// Changing a row's charger used to leave the location behind, so a row reading
// "DCFC 200kW #1" could be carrying an L2 unit. The name follows the load type
// now — but only while the name is still ours to change.
describe("a location that follows the load type", () => {
  it("numbers past the rows already on that load type", () => {
    const rows = [
      { id: "a", loadTypeId: "DCFC 200kW", location: "DCFC 200kW #1" },
      { id: "b", loadTypeId: "DCFC 200kW", location: "DCFC 200kW #2" },
      { id: "c", loadTypeId: "L2 Dual 40A", location: "L2 Dual 40A #1" },
    ];
    expect(locationForLoadType(rows, "c", "DCFC 200kW")).toBe("DCFC 200kW #3");
  });

  it("does not count the row being changed", () => {
    const rows = [{ id: "a", loadTypeId: "L2 Dual 40A", location: "L2 Dual 40A #1" }];
    expect(locationForLoadType(rows, "a", "DCFC 200kW")).toBe("DCFC 200kW #1");
  });
});

describe("telling our generated names from the user's", () => {
  it("claims the names the app itself writes", () => {
    expect(isAutoLocation("DCFC 200kW #1", LOAD_TYPE_IDS)).toBe(true);
    expect(isAutoLocation("L2 Dual 40A #12", LOAD_TYPE_IDS)).toBe(true);
    expect(isAutoLocation("Run 3", LOAD_TYPE_IDS)).toBe(true);
    expect(isAutoLocation("  Run 3  ", LOAD_TYPE_IDS)).toBe(true);
  });

  it("leaves anything a person typed alone", () => {
    expect(isAutoLocation("North lot, by the pylon", LOAD_TYPE_IDS)).toBe(false);
    expect(isAutoLocation("Pylon #3", LOAD_TYPE_IDS)).toBe(false);
    expect(isAutoLocation("", LOAD_TYPE_IDS)).toBe(false);
    expect(isAutoLocation("DCFC 200kW", LOAD_TYPE_IDS)).toBe(false);
  });

  it("is not confused by regex characters in a custom load type id", () => {
    expect(isAutoLocation("ABB (480V) #2", ["ABB (480V)"])).toBe(true);
    expect(isAutoLocation("ABBx480Vx #2", ["ABB (480V)"])).toBe(false);
  });
});
