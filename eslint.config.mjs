import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The EV proposal generator is a Python project that happens to live in
    // this repo, and public/proposal is its vendored mirror — neither is ours
    // to lint, and the mirror must stay byte-for-byte identical.
    "Proposals/**",
    "public/proposal/**",
  ]),
]);

export default eslintConfig;
