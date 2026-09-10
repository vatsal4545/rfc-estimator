// Vendor the EV proposal agent into public/ so the browser can run it.
//
// The Generate Proposal tab runs the REAL ev_proposal_agent under Pyodide
// rather than a TypeScript port, so its logic cannot drift from the desktop
// app or from the pytest suite that guards it. For the browser to load those
// modules they have to be served as static files, which means a copy under
// public/ — and a copy is exactly the thing that goes stale silently.
//
// So this script owns the copy, and it records a hash of what it copied in
// public/proposal/manifest.json. `proposalAgent.test.ts` recomputes that hash
// from ../Proposals and fails if the two disagree, which turns "someone edited
// the Python and forgot the web app" into a red test rather than a proposal
// with last month's logic in it.
//
//   node scripts/sync-proposal-agent.mjs [--check]
//
// --check verifies without writing, for CI.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: the repo path contains a space, which
// pathname leaves percent-encoded.
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const SOURCE = join(APP, "..", "Proposals");
const DEST = join(APP, "public", "proposal");

/**
 * Modules the browser never imports. gui.py and ui_widgets.py are PySide6 and
 * cannot run here; cli.py is the only thing that imports gui (lazily, inside
 * the `gui` subcommand), and __main__.py only wraps cli. Nothing in the
 * generate pipeline touches any of them — verified by grep, and by the fact
 * that ev_proposal_agent/__init__.py imports only .errors.
 */
const SKIP_MODULES = new Set(["gui.py", "ui_widgets.py", "cli.py", "__main__.py"]);

/**
 * The subtrees this script owns. Only these are wiped and rewritten, so
 * web_entry.py — our own adapter, which sits beside them at /proposal so the
 * whole thing mounts as one directory — survives a re-sync.
 */
const MANAGED = ["ev_proposal_agent", "tools", "config", "templates"];

/** Everything that has to travel, in the layout web_entry.py expects at /proposal. */
function plan() {
  const files = [];

  const pyDir = join(SOURCE, "ev_proposal_agent");
  for (const name of readdirSync(pyDir).sort()) {
    if (!name.endsWith(".py") || SKIP_MODULES.has(name)) continue;
    files.push({ from: join(pyDir, name), to: "ev_proposal_agent/" + name });
  }

  // render.verify_output imports tools.docx_edit for the post-render audit —
  // leftover Jinja tags, #REF!, and the previous-client identity strings. The
  // tools package is part of the pipeline, not just tooling.
  for (const name of ["__init__.py", "docx_edit.py"]) {
    files.push({ from: join(SOURCE, "tools", name), to: "tools/" + name });
  }

  // field_map.yaml is the real spec: the cell map, the operator-input
  // declarations with their defaults and formats, and the per-chassis
  // overrides. The UI reads its operator-input block so the form does not
  // become a second copy of that list.
  files.push({ from: join(SOURCE, "config", "field_map.yaml"), to: "config/field_map.yaml" });

  files.push({ from: join(SOURCE, "templates", "proposal_template.docx"), to: "templates/proposal_template.docx" });
  for (const name of ["charger_level2.png", "charger_level3.png", "cover_default.jpeg"]) {
    files.push({ from: join(SOURCE, "templates", "assets", name), to: "templates/assets/" + name });
  }

  return files;
}

/** One hash over every vendored file's path and bytes, so order cannot hide a change. */
function hashOf(files, read) {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.to);
    digest.update("\0");
    digest.update(read(file));
    digest.update("\0");
  }
  return digest.digest("hex");
}

export function sourceManifest() {
  const files = plan();
  const missing = files.filter((f) => !existsSync(f.from)).map((f) => relative(SOURCE, f.from));
  if (missing.length > 0) {
    throw new Error("../Proposals is missing files this app needs:\n  " + missing.join("\n  "));
  }
  return {
    source: "../Proposals",
    files: files.map((f) => f.to),
    hash: hashOf(files, (f) => readFileSync(f.from)),
  };
}

export function hasSource() {
  return existsSync(join(SOURCE, "ev_proposal_agent"));
}

function main() {
  const check = process.argv.includes("--check");

  if (!hasSource()) {
    // A clone of just this repo has no sibling Proposals directory. That is
    // fine — the vendored copy is checked in and is what actually ships.
    const vendored = join(DEST, "manifest.json");
    if (existsSync(vendored)) {
      console.log("sync-proposal-agent: ../Proposals not present; keeping the vendored copy as-is.");
      return;
    }
    console.error("sync-proposal-agent: no ../Proposals and no vendored copy — the Generate Proposal tab will not work.");
    process.exitCode = check ? 1 : 0;
    return;
  }

  const manifest = sourceManifest();
  const manifestPath = join(DEST, "manifest.json");
  const current = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;

  // The manifest matching the source is not enough: the copy on disk has to
  // match it too. Git's core.autocrlf will happily rewrite the vendored .py
  // files on checkout, which leaves the manifest correct and the files wrong.
  // (.gitattributes marks the tree -text to stop that; this catches the case
  // where it already happened.)
  const onDisk =
    current && current.files.every((rel) => existsSync(join(DEST, rel)))
      ? hashOf(
          current.files.map((rel) => ({ to: rel })),
          (f) => readFileSync(join(DEST, f.to)),
        )
      : null;

  if (current && current.hash === manifest.hash && onDisk === manifest.hash) {
    console.log(`sync-proposal-agent: up to date (${manifest.files.length} files, ${manifest.hash.slice(0, 12)}).`);
    return;
  }

  if (check) {
    console.error(
      "sync-proposal-agent: public/proposal/ is out of date with ../Proposals.\n" +
        `  vendored: ${current ? current.hash.slice(0, 12) : "(absent)"}\n` +
        `  source:   ${manifest.hash.slice(0, 12)}\n` +
        "  Run: node scripts/sync-proposal-agent.mjs",
    );
    process.exitCode = 1;
    return;
  }

  // Replace the managed subtrees wholesale, so a file deleted upstream
  // disappears here too — but leave anything else under public/proposal alone.
  for (const dir of MANAGED) rmSync(join(DEST, dir), { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });
  for (const file of plan()) {
    const dest = join(DEST, file.to);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(file.from));
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const bytes = plan().reduce((n, f) => n + statSync(f.from).size, 0);
  console.log(
    `sync-proposal-agent: vendored ${manifest.files.length} files (${(bytes / 1024 / 1024).toFixed(2)} MB) ` +
      `at ${manifest.hash.slice(0, 12)}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
