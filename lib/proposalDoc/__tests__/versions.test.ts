// The browser and the Node smoke test must run the same Pyodide.
//
// The runtime pins a CDN version; `npm run proposal:smoke` uses the `pyodide`
// devDependency. If those drift, the headless check stops telling us anything
// about what users actually get.

import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { PYODIDE_VERSION } from "../runtime";

const require = createRequire(import.meta.url);

describe("the pinned Pyodide version", () => {
  it("matches the installed pyodide package", () => {
    const installed = (require("pyodide/package.json") as { version: string }).version;
    expect(
      PYODIDE_VERSION,
      "lib/proposalDoc/runtime.ts pins a different Pyodide than the devDependency the smoke test runs",
    ).toBe(installed);
  });
});
