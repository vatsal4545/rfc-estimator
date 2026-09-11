// Smoke-test the vendored proposal agent through Pyodide, from Node.
//
// Mounts public/proposal/ exactly as the browser runtime does -- driven by the
// same manifest.json -- then exercises web_entry.inspect() and
// web_entry.generate(). This is the check that the vendored copy plus the
// adapter actually produce a document, and it runs headless so it can sit in
// CI without a browser.
//
//   node scripts/proposal-smoke.mjs [workbook.xlsx] [--out dir]

import { loadPyodide } from "pyodide";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const VENDOR = join(APP, "public", "proposal");

/** Text files are mounted as text; anything else as bytes. */
const TEXT = /\.(py|yaml|yml|json|txt|md)$/i;

export async function bootProposalRuntime({ log = () => {} } = {}) {
  log("booting python");
  const py = await loadPyodide();

  log("loading packages");
  await py.loadPackage(["micropip", "lxml", "matplotlib", "pyyaml", "pillow"]);
  const micropip = py.pyimport("micropip");
  // Pinned to Proposals/requirements.txt, so the browser runs the versions the
  // pytest suite runs.
  await micropip.install(["openpyxl==3.1.5", "python-docx==1.2.0", "docxtpl==0.20.1"]);

  log("mounting the agent");
  const manifest = JSON.parse(readFileSync(join(VENDOR, "manifest.json"), "utf8"));
  const made = new Set();
  const mkdirp = (path) => {
    let acc = "";
    for (const part of path.split("/").filter(Boolean)) {
      acc += "/" + part;
      if (made.has(acc)) continue;
      try {
        py.FS.mkdir(acc);
      } catch {
        /* already there */
      }
      made.add(acc);
    }
  };

  // web_entry.py is ours and is not in the vendored manifest.
  for (const rel of [...manifest.files, "web_entry.py"]) {
    const dest = "/proposal/" + rel;
    mkdirp(dirname(dest));
    const data = readFileSync(join(VENDOR, rel));
    py.FS.writeFile(dest, TEXT.test(rel) ? data.toString("utf8") : new Uint8Array(data));
  }
  mkdirp("/work");

  log("importing the agent");
  const entry = await py.runPythonAsync(`
import sys
sys.path.insert(0, "/proposal")
import web_entry
web_entry
`);

  return { py, entry, manifest };
}

/** Call a web_entry function that takes workbook bytes and returns JSON. */
function callJson(py, entry, fn, workbook, ...rest) {
  const buf = py.toPy(new Uint8Array(workbook));
  try {
    const raw = entry[fn](buf, ...rest);
    return JSON.parse(raw);
  } finally {
    buf.destroy();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : join(APP, "..", "smoke-out");
  const workbookPath =
    args.find((a) => a.endsWith(".xlsx")) ??
    join(APP, "Proposals", "templates", "assets", "project-rfc-msrp-calculator.xlsx");

  if (!existsSync(join(VENDOR, "manifest.json"))) {
    throw new Error("public/proposal is not vendored yet — run node scripts/sync-proposal-agent.mjs");
  }

  const started = Date.now();
  const { py, entry } = await bootProposalRuntime({ log: (m) => console.log("  " + m) });
  console.log(`  ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const workbook = readFileSync(workbookPath);
  console.log(`\nworkbook: ${workbookPath} (${(workbook.length / 1024).toFixed(0)} KB)`);

  console.log("\n--- inspect ---");
  const report = callJson(py, entry, "inspect", workbook);
  if (!report.ok) {
    console.log(JSON.stringify(report, null, 2).slice(0, 2000));
    throw new Error("inspect failed");
  }
  for (const line of report.summary_lines) console.log("  " + line);
  console.log(`  tokens: ${Object.keys(report.formatted).length}, sources: ${Object.keys(report.sources).length}`);
  const byLevel = {};
  for (const f of report.findings) byLevel[f.level] = (byLevel[f.level] ?? 0) + 1;
  console.log(`  findings: ${JSON.stringify(byLevel)}`);

  console.log("\n--- field map operator inputs ---");
  const inputs = JSON.parse(entry.field_map_operator_inputs());
  console.log(`  ${Object.keys(inputs).length} declared fields`);

  console.log("\n--- section registry ---");
  const sections = JSON.parse(entry.section_registry());
  console.log(`  ${sections.length} sections, ${sections.filter((s) => s.removable).length} removable`);

  console.log("\n--- generate ---");
  const operator = {
    site_name: "Hoopa Motel",
    site_address: "100 Main St, Hoopa, CA 95546",
    client_contact_name: "A. Example",
    prepared_by_name: "Zero Impact Energy",
  };
  const gen = callJson(py, entry, "generate", workbook, JSON.stringify(operator), false);
  console.log(`  ok: ${gen.ok}`);
  if (gen.error) console.log(`  error: ${gen.error}`);
  if (gen.trace) console.log(gen.trace);
  if (gen.findings?.length) for (const f of gen.findings) console.log(`  ${f.level}: ${f.message}`);

  mkdirSync(outDir, { recursive: true });
  if (gen.qa) {
    writeFileSync(join(outDir, "proposal_QA.txt"), gen.qa);
    console.log(`  QA report: ${gen.qa.length} chars -> ${join(outDir, "proposal_QA.txt")}`);
  }
  if (gen.docx) {
    const bytes = Buffer.from(gen.docx, "base64");
    writeFileSync(join(outDir, gen.filename ?? "proposal.docx"), bytes);
    console.log(`  document: ${bytes.length} bytes -> ${join(outDir, gen.filename ?? "proposal.docx")}`);
  }
  if (!gen.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("SMOKE FAILED:", err);
    process.exit(1);
  });
}
