// Run the EV proposal agent in the browser.
//
// The Generate Proposal tab does not reimplement the proposal generator; it
// runs the real Python package under Pyodide. That is what makes "the logic is
// unchanged" a fact: the modules loaded here are the same files the pytest
// suite in Proposals/ exercises, vendored byte-for-byte into public/proposal
// by scripts/sync-proposal-agent.mjs and checked by lib/proposalDoc/__tests__.
//
// Everything is lazy and cached. Nothing here loads until the tab asks for it,
// so the rest of the app pays nothing for it, and the interpreter is reused
// across generations — the boot is the expensive part, not the document.

/**
 * Pinned, and pinned to match the `pyodide` devDependency so the browser runs
 * what `npm run proposal:smoke` runs in Node. `versions.test.ts` asserts the
 * two agree.
 */
export const PYODIDE_VERSION = "314.0.6";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/**
 * Packages Pyodide ships as builds of its own. pillow is not imported by the
 * agent directly, but matplotlib's Agg backend wants it for the PNG writes.
 */
const PYODIDE_PACKAGES = ["micropip", "lxml", "matplotlib", "pyyaml", "pillow"];

/** Pure-Python wheels, pinned to Proposals/requirements.txt. */
const WHEELS = ["openpyxl==3.1.5", "python-docx==1.2.0", "docxtpl==0.20.1"];

/** Mounted as text rather than bytes; everything else is binary. */
const TEXT_FILE = /\.(py|yaml|yml|json|txt|md)$/i;

export interface Detection {
  chassis: string;
  engine: string;
  scenario: string | null;
  projection_years: number;
  has_history: boolean;
  has_financing: boolean;
}

export interface Finding {
  level: string;
  code: string;
  message: string;
  where?: string | null;
}

export interface InspectResult {
  ok: true;
  detection: Detection;
  summary_lines: string[];
  /** Values as the agent read them — what the form's prefills come from. */
  raw: Record<string, unknown>;
  /** Values as the document would print them. */
  formatted: Record<string, string>;
  /** token -> source cell, the audit trail. */
  sources: Record<string, string>;
  findings: Finding[];
  has_errors: boolean;
}

export interface InspectFailure {
  ok: false;
  kind?: string;
  error: string;
  detail?: string | null;
  findings?: Finding[];
  trace?: string;
}

export interface GenerateResult {
  ok: boolean;
  /** Present whenever a document was written; absent when generation was refused. */
  docx?: Uint8Array;
  filename?: string;
  /** Written even when generation is refused — that is the point of it. */
  qa?: string;
  error?: string;
  detail?: string | null;
  kind?: string;
  findings?: Finding[];
  trace?: string;
}

/**
 * One declared operator input, straight out of field_map.yaml's
 * `operator_inputs` list. The widget is not declared — the desktop GUI infers
 * it from the default and the format, and so does the tab (see widgetFor).
 */
export interface OperatorInputSpec {
  token: string;
  /** Question text. Absent for the self-evident ones, which fall back to the token. */
  prompt?: string;
  default?: string | number;
  /** A format name from field_map's `formats` block, e.g. "percent0". */
  format?: string;
  /** Dotted path into the extract's own prefills, for reference. */
  prefill?: string;
  /** A detection flag that must be true for the field to apply at all. */
  requires?: string;
}

export interface SectionSpec {
  key: string;
  title: string;
  listName: string;
  parent: string | null;
  suffix: string;
  removable: boolean;
  requires: string[];
  blurb: string;
}

export type Progress = (message: string) => void;

interface Runtime {
  py: Pyodide;
  entry: PyEntry;
}

/** The handful of web_entry functions we call, as they appear through Pyodide. */
interface PyEntry {
  inspect: (workbook: unknown) => string;
  generate: (workbook: unknown, inputsJson: string, force: boolean) => string;
  field_map_operator_inputs: () => string;
  section_registry: () => string;
}

interface Pyodide {
  loadPackage: (names: string[]) => Promise<unknown>;
  pyimport: (name: string) => { install: (specs: string[]) => Promise<unknown> };
  runPythonAsync: (code: string) => Promise<unknown>;
  toPy: (value: unknown) => { destroy: () => void };
  FS: {
    mkdir: (path: string) => void;
    writeFile: (path: string, data: string | Uint8Array) => void;
  };
}

let booting: Promise<Runtime> | null = null;

function basePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}

/**
 * Boot the interpreter and mount the agent. Safe to call repeatedly: the first
 * call does the work and every later one waits on the same promise.
 *
 * A failed boot clears the cache, so a user who was offline can retry rather
 * than being stuck with a rejected promise for the rest of the session.
 */
export function loadProposalRuntime(onProgress: Progress = () => {}): Promise<Runtime> {
  if (!booting) {
    booting = boot(onProgress).catch((err) => {
      booting = null;
      throw err;
    });
  }
  return booting;
}

/** Has the runtime already been booted? Lets the UI skip the "this will take a moment" copy. */
export function proposalRuntimeReady(): boolean {
  return booting !== null;
}

async function boot(onProgress: Progress): Promise<Runtime> {
  onProgress("Loading the Python runtime…");
  // webpackIgnore so the bundler leaves the CDN URL alone; Pyodide resolves
  // its own .wasm and wheels relative to indexURL.
  const { loadPyodide } = (await import(/* webpackIgnore: true */ `${PYODIDE_CDN}pyodide.mjs`)) as {
    loadPyodide: (opts: { indexURL: string }) => Promise<Pyodide>;
  };
  const py = await loadPyodide({ indexURL: PYODIDE_CDN });

  onProgress("Loading Excel, Word and charting libraries…");
  await py.loadPackage(PYODIDE_PACKAGES);
  const micropip = py.pyimport("micropip");
  await micropip.install(WHEELS);

  onProgress("Loading the proposal generator…");
  const base = basePath();
  const manifestRes = await fetch(`${base}/proposal/manifest.json`);
  if (!manifestRes.ok) {
    throw new Error(
      `Could not load the proposal generator (${manifestRes.status}). ` +
        "If this is a fresh checkout, run `npm run proposal:sync`.",
    );
  }
  const manifest = (await manifestRes.json()) as { files: string[] };

  const made = new Set<string>();
  const mkdirp = (path: string) => {
    let acc = "";
    for (const part of path.split("/").filter(Boolean)) {
      acc += "/" + part;
      if (made.has(acc)) continue;
      try {
        py.FS.mkdir(acc);
      } catch {
        // Already there. Emscripten's FS throws rather than returning a code.
      }
      made.add(acc);
    }
  };

  // web_entry.py is ours and sits beside the vendored tree, so it is not in
  // the manifest (whose hash tracks Proposals/) but does have to be mounted.
  const files = [...manifest.files, "web_entry.py"];
  const fetched = await Promise.all(
    files.map(async (rel) => {
      const res = await fetch(`${base}/proposal/${rel}`);
      if (!res.ok) throw new Error(`Could not load ${rel} (${res.status}).`);
      return { rel, buffer: await res.arrayBuffer() };
    }),
  );

  for (const { rel, buffer } of fetched) {
    const dest = `/proposal/${rel}`;
    mkdirp(dest.slice(0, dest.lastIndexOf("/")));
    const bytes = new Uint8Array(buffer);
    py.FS.writeFile(dest, TEXT_FILE.test(rel) ? new TextDecoder().decode(bytes) : bytes);
  }
  mkdirp("/work");

  onProgress("Starting the proposal generator…");
  const entry = (await py.runPythonAsync(`
import sys
if "/proposal" not in sys.path:
    sys.path.insert(0, "/proposal")
import web_entry
web_entry
`)) as PyEntry;

  return { py, entry };
}

/**
 * Pass workbook bytes into Python and parse the JSON that comes back.
 *
 * The PyProxy for the byte buffer is destroyed explicitly: it is a view into
 * the WASM heap, and Pyodide will not collect it for us.
 */
function withWorkbook<T>(py: Pyodide, workbook: Uint8Array, call: (buf: unknown) => string): T {
  const buf = py.toPy(workbook);
  try {
    return JSON.parse(call(buf)) as T;
  } finally {
    buf.destroy();
  }
}

export async function inspectWorkbook(
  workbook: Uint8Array,
  onProgress?: Progress,
): Promise<InspectResult | InspectFailure> {
  const { py, entry } = await loadProposalRuntime(onProgress);
  return withWorkbook<InspectResult | InspectFailure>(py, workbook, (buf) => entry.inspect(buf));
}

export async function generateProposal(
  workbook: Uint8Array,
  operatorInputs: Record<string, unknown>,
  opts: { force?: boolean; onProgress?: Progress } = {},
): Promise<GenerateResult> {
  const { py, entry } = await loadProposalRuntime(opts.onProgress);
  const raw = withWorkbook<GenerateResult & { docx?: string }>(py, workbook, (buf) =>
    entry.generate(buf, JSON.stringify(operatorInputs), Boolean(opts.force)),
  );
  // The document crosses as base64: a view into the WASM heap does not survive
  // the trip, and the JSON boundary is already there for the findings.
  const { docx, ...rest } = raw;
  return { ...rest, docx: docx ? base64ToBytes(docx) : undefined };
}

export async function operatorInputSpec(): Promise<OperatorInputSpec[]> {
  const { entry } = await loadProposalRuntime();
  return JSON.parse(entry.field_map_operator_inputs()) as OperatorInputSpec[];
}

export async function sectionRegistry(): Promise<SectionSpec[]> {
  const { entry } = await loadProposalRuntime();
  return JSON.parse(entry.section_registry()) as SectionSpec[];
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Hand the finished document to the user, the way the other exports do. */
export function downloadDocx(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
