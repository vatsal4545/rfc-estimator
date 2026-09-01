import { describe, expect, it } from "vitest";
import { defaultProject } from "../calc/defaults";
import { decodeSharedProject, encodeProjectForShare, SHARE_HASH_PREFIX } from "../shareLink";

describe("share link codec", () => {
  it("round-trips a project through gzip + base64url", async () => {
    const project = defaultProject();
    project.setup.clientName = "Bartel Hotel";
    project.peripherals.bollardsQty = 29;

    const data = await encodeProjectForShare(project);
    // URL-safe alphabet only, and compact enough for a URL fragment.
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(data.length).toBeLessThan(30000);

    const decoded = await decodeSharedProject(`${SHARE_HASH_PREFIX}${data}`);
    expect(decoded).toEqual(project);
  });

  it("returns null for non-share hashes and throws on corrupt data", async () => {
    expect(await decodeSharedProject("#something-else")).toBeNull();
    expect(await decodeSharedProject("")).toBeNull();
    await expect(decodeSharedProject(`${SHARE_HASH_PREFIX}not-real-data`)).rejects.toThrow();
  });
});
