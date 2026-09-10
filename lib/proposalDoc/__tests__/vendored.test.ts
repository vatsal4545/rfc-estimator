// The vendored proposal agent is the real thing, and still the current thing.
//
// The Generate Proposal tab runs the actual ev_proposal_agent under Pyodide
// rather than a TypeScript port, which is what makes "the logic is unchanged"
// a fact rather than a claim. The cost is a copy under public/, and a copy is
// exactly what goes stale without anyone noticing: someone fixes a rate in
// ../Proposals, the pytest suite there stays green, and the web app keeps
// shipping last month's arithmetic.
//
// So this asserts the copy is complete, is what the browser will actually
// load, and — when the sibling checkout is present — is identical to it.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// lib/proposalDoc/__tests__ -> the app root.
const APP = join(__dirname, "..", "..", "..");
const VENDOR = join(APP, "public", "proposal");
const SOURCE = join(APP, "..", "Proposals");
const MANIFEST = join(VENDOR, "manifest.json");

interface Manifest {
  source: string;
  files: string[];
  hash: string;
}

const manifest: Manifest | null = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest)
  : null;

/** The same digest sync-proposal-agent.mjs computes: path then bytes, in order. */
function hashOf(files: string[], read: (rel: string) => Buffer): string {
  const digest = createHash("sha256");
  for (const rel of files) {
    digest.update(rel);
    digest.update("\0");
    digest.update(read(rel));
    digest.update("\0");
  }
  return digest.digest("hex");
}

describe("the vendored proposal agent", () => {
  it("is vendored at all", () => {
    expect(
      manifest,
      "public/proposal/manifest.json is missing — run `npm run proposal:sync`",
    ).not.toBeNull();
  });

  it("carries every file the pipeline needs", () => {
    const files = manifest!.files;
    // The modules render.generate actually reaches, plus the two the browser
    // would fail on last: tools.docx_edit (imported inside verify_output, so a
    // missing copy only shows up after a document has been rendered) and the
    // field map, which is the spec rather than an asset.
    for (const needed of [
      "ev_proposal_agent/__init__.py",
      "ev_proposal_agent/engine.py",
      "ev_proposal_agent/extract.py",
      "ev_proposal_agent/aggregate.py",
      "ev_proposal_agent/baseline.py",
      "ev_proposal_agent/narrative.py",
      "ev_proposal_agent/sections.py",
      "ev_proposal_agent/validate.py",
      "ev_proposal_agent/charts.py",
      "ev_proposal_agent/render.py",
      "ev_proposal_agent/resolve.py",
      "ev_proposal_agent/paths.py",
      "ev_proposal_agent/errors.py",
      "ev_proposal_agent/findings.py",
      "tools/docx_edit.py",
      "config/field_map.yaml",
      "templates/proposal_template.docx",
      "templates/assets/cover_default.jpeg",
    ]) {
      expect(files, `${needed} is not vendored`).toContain(needed);
    }
  });

  it("does not vendor the desktop GUI", () => {
    // PySide6 cannot run under WASM, and nothing in the generate pipeline
    // imports these — cli.py is the only importer of gui, and it is lazy.
    for (const excluded of [
      "ev_proposal_agent/gui.py",
      "ev_proposal_agent/ui_widgets.py",
      "ev_proposal_agent/cli.py",
    ]) {
      expect(manifest!.files).not.toContain(excluded);
    }
  });

  it("every listed file is actually on disk", () => {
    const absent = manifest!.files.filter((rel) => !existsSync(join(VENDOR, rel)));
    expect(absent).toEqual([]);
  });

  it("no listed file is empty, bar the package markers", () => {
    // tools/__init__.py is a legitimately empty package marker; everything
    // else being zero-length would mean a truncated copy.
    const empty = manifest!.files.filter(
      (rel) => !rel.endsWith("__init__.py") && readFileSync(join(VENDOR, rel)).length === 0,
    );
    expect(empty).toEqual([]);
  });

  it("the files on disk are the ones the manifest hash was taken over", () => {
    // Catches a hand-edit of the vendored copy, which would make the browser
    // run something no pytest suite has ever seen.
    const actual = hashOf(manifest!.files, (rel) => readFileSync(join(VENDOR, rel)));
    expect(actual, "public/proposal/ has been edited by hand — re-run `npm run proposal:sync`").toBe(
      manifest!.hash,
    );
  });

  it("ships the web adapter, which the manifest deliberately does not cover", () => {
    // web_entry.py is ours, not vendored, so it is versioned normally and is
    // outside the hash. It still has to be there for the runtime to import.
    expect(existsSync(join(VENDOR, "web_entry.py"))).toBe(true);
  });

  // Only meaningful in the full working copy. CI clones this app alone, where
  // the vendored tree IS the source of truth and there is nothing to compare.
  const hasSource = existsSync(join(SOURCE, "ev_proposal_agent"));
  it.runIf(hasSource)("is identical to ../Proposals", () => {
    const actual = hashOf(manifest!.files, (rel) => {
      // The vendored layout flattens ev_proposal_agent/, tools/, config/ and
      // templates/ from the source root, so the relative paths line up 1:1.
      return readFileSync(join(SOURCE, rel));
    });
    expect(
      actual,
      "../Proposals has changed since the last sync — run `npm run proposal:sync` and re-run the pytest suite there",
    ).toBe(manifest!.hash);
  });
});
