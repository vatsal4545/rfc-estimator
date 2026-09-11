"""Run the EV proposal agent from the browser.

This is the only Python written for the web app, and it deliberately contains
no proposal logic. Everything it does is environment plumbing:

* Point `ev_proposal_agent.paths` at the Pyodide virtual filesystem. The
  desktop app resolves the template and the output directory through the
  Windows registry and `%APPDATA%`, neither of which exists here.
* Take the workbook as bytes rather than a path on disk.
* Hand the finished `.docx` and `_QA.txt` back as bytes rather than leaving
  them in `Documents\\EV Proposals`.

`generate()` calls `render.generate` unchanged, so the whole documented
pipeline runs exactly as it does on the desktop: detect chassis and engine,
extract, plan and renumber sections, validate, render the charts, render the
document with docxtpl, audit the finished file, write the QA report. In
particular the refusal behaviour is preserved -- a validation ERROR means no
document is written, and the QA report is produced anyway.

Notably there is NO winreg shim here. `paths.documents_dir()` imports winreg
lazily inside a try/except and we replace `output_dir()` outright, so it is
never reached -- and installing a dummy module would be actively harmful,
because stdlib `mimetypes` probes for winreg by name and would then try to
read a registry that is not there.
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

ROOT = Path("/proposal")
WORK = Path("/work")

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import ev_proposal_agent.paths as _paths  # noqa: E402

_paths.ROOT = ROOT
_paths.CONFIG_DIR = ROOT / "config"
_paths.TEMPLATES_DIR = ROOT / "templates"
_paths.DOCS_DIR = ROOT / "docs"
_paths.INPUTS_DIR = WORK
_paths.FIELD_MAP = ROOT / "config" / "field_map.yaml"
_paths.PROPOSAL_TEMPLATE = ROOT / "templates" / "proposal_template.docx"
_paths.output_dir = lambda: WORK / "out"
# The desktop app remembers the last few operator-input sets in %APPDATA%. The
# browser keeps that in localStorage instead, so point this somewhere harmless.
_paths.settings_path = lambda: WORK / "recent.json"

from ev_proposal_agent import render  # noqa: E402
from ev_proposal_agent.errors import ProposalError  # noqa: E402


def _fresh(path: Path) -> Path:
    """An empty directory. Charts and QA reports must not carry over a run."""
    import shutil

    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_workbook(workbook: bytes, name: str = "input.xlsx") -> Path:
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / name
    path.write_bytes(bytes(workbook))
    return path


def _findings(objs) -> list[dict]:
    """Findings as plain dicts, for the UI. Same shape inspect --json emits."""
    out = []
    for f in objs or []:
        level = getattr(f, "level", None)
        out.append(
            {
                "level": getattr(level, "value", None) or getattr(level, "name", str(level)),
                "code": getattr(f, "code", ""),
                "message": getattr(f, "message", str(f)),
                "where": getattr(f, "where", None),
            }
        )
    return out


def inspect(workbook: bytes) -> str:
    """What the workbook says, before any operator input.

    Mirrors what the desktop GUI does on drop (gui.on_workbook): a full
    detect-and-extract with no operator inputs, used to fill the "what the
    workbook says" card, prefill the form, and decide which sections are
    available.

    `extract.inspect_workbook` cannot be reused directly -- it prints and
    returns an exit code -- so this repeats its three lines and returns the
    same payload its `--json` mode builds. No extraction logic of its own.
    """
    from ev_proposal_agent import engine as engine_mod
    from ev_proposal_agent import extract

    path = _write_workbook(workbook)
    try:
        field_map = extract.load_field_map()
        with engine_mod.load(str(path), field_map) as loaded:
            ctx = extract.build_context(loaded, field_map)
        detection = ctx.detection
        return json.dumps(
            {
                "ok": True,
                "detection": {
                    "chassis": detection.chassis,
                    "engine": detection.engine,
                    "scenario": detection.scenario,
                    "projection_years": detection.projection_years,
                    "has_history": detection.has_history,
                    "has_financing": detection.has_financing,
                },
                "summary_lines": list(detection.summary_lines()),
                # raw feeds the form's prefills; formatted is what the document
                # would print; sources is the audit trail the QA report shows.
                "raw": {k: v for k, v in ctx.raw.items()},
                "formatted": ctx.formatted,
                "sources": ctx.sources,
                "findings": _findings(ctx.findings),
                "has_errors": any(
                    (f.get("level") or "").upper() == "ERROR" for f in _findings(ctx.findings)
                ),
            },
            default=str,
        )
    except ProposalError as exc:
        return json.dumps(
            {
                "ok": False,
                "kind": type(exc).__name__,
                "error": getattr(exc, "message", str(exc)),
                "detail": getattr(exc, "detail", None),
                "findings": _findings(getattr(exc, "findings", None)),
            },
            default=str,
        )
    except Exception as exc:  # noqa: BLE001 - the UI must never see a traceback
        return json.dumps(
            {"ok": False, "error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()[-2000:]}
        )


def generate(workbook: bytes, operator_inputs_json: str = "{}", force: bool = False) -> str:
    """Generate the proposal. Returns JSON; the .docx is base64 in `docx`.

    Base64 rather than a memoryview because this crosses into JavaScript and a
    view into the WASM heap does not survive the trip.
    """
    import base64

    operator_inputs = json.loads(operator_inputs_json or "{}")
    path = _write_workbook(workbook)
    out_dir = _fresh(WORK / "out")
    out_path = out_dir / "proposal.docx"

    result: dict = {"ok": False}
    try:
        # Returns a shell exit code and raises ProposalError on abort; the
        # document itself lands at out_path.
        render.generate(
            str(path),
            output=str(out_path),
            operator_inputs=operator_inputs,
            force=force,
        )
        result["ok"] = True
    except ProposalError as exc:
        result["error"] = getattr(exc, "message", str(exc))
        result["detail"] = getattr(exc, "detail", None)
        result["kind"] = type(exc).__name__
        result["findings"] = _findings(getattr(exc, "findings", None))
    except Exception as exc:  # noqa: BLE001
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["trace"] = traceback.format_exc()[-2000:]

    # The QA report is written even when generation is refused -- that is the
    # point of it -- so always look for it.
    for candidate in out_dir.glob("*_QA.txt"):
        result["qa"] = candidate.read_text(encoding="utf-8", errors="replace")
        break

    if out_path.exists():
        result["docx"] = base64.b64encode(out_path.read_bytes()).decode("ascii")
        result["filename"] = _suggested_name(operator_inputs)

    return json.dumps(result, default=str)


def _suggested_name(operator_inputs: dict) -> str:
    """The desktop app's filename, minus its Documents directory.

    `render.default_output_path` builds `{site}_{job}_{date}.docx` and applies
    `safe_filename`; reuse both rather than reinventing the naming.
    """
    from datetime import date

    site = str(operator_inputs.get("site_name") or "").strip()
    parts = [p for p in (site, str(operator_inputs.get("job_number") or "").strip(), date.today().isoformat()) if p]
    stem = render.safe_filename("_".join(parts)) if parts else "proposal"
    return f"{stem}.docx"


def field_map_operator_inputs() -> str:
    """The operator-input declarations, straight from field_map.yaml.

    The form is built from this rather than from a hand-written copy in
    TypeScript, so adding a field to the YAML shows up in the UI without a
    code change on this side.
    """
    from ev_proposal_agent import extract

    field_map = extract.load_field_map()
    return json.dumps(field_map.get("operator_inputs", {}), default=str)


def section_registry() -> str:
    """Sections the user may switch off, with their titles."""
    from ev_proposal_agent import sections

    out = []
    for spec in sections.REGISTRY:
        out.append(
            {
                "key": getattr(spec, "key", None),
                "title": getattr(spec, "title", None),
                "parent": getattr(spec, "parent", None),
                "suffix": getattr(spec, "suffix", ""),
                "removable": bool(getattr(spec, "removable", True)),
                "requires": list(getattr(spec, "requires", []) or []),
                "blurb": getattr(spec, "blurb", ""),
                # list_name overrides the title in the picker: the three
                # financing appendices otherwise show as identical rows.
                "listName": getattr(spec, "list_name", "") or getattr(spec, "title", ""),
            }
        )
    return json.dumps(out, default=str)
