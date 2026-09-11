import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Vitest defaults to 5s a test. Much of this suite opens a workbook and
    // recalculates it -- the Excel oracle alone evaluates 8,385 formula cells --
    // and the slowest tests sit around 1.5s on an idle machine. That is close
    // enough to the default that a busy CI runner, or a dev server competing
    // for the CPU, tips one over and fails a suite that is not actually broken.
    testTimeout: 20_000,
  },
});
