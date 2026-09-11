"""Generate a proposal and account for every figure printed in it.

The audit tools check the template and the context. This checks the DOCUMENT -
the thing a customer actually reads. It renders a real proposal, pulls every
figure out of every paragraph, table cell, header and footer, and tries to
account for each one by matching it to a token whose recorded source names a
workbook cell.

Anything it cannot account for is printed. That list is the answer to "does
every number in this proposal come from the RFC?", and it is a list rather than
a yes/no because some figures are legitimately constants and a human has to say
which.

    python -m tools.verify_proposal inputs/BestWestern_Reduction_v16.xlsx
    python -m tools.verify_proposal <workbook> --show-accounted
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FIGURE = re.compile(
    r"\(?\$[\d,]+(?:\.\d+)?\)?"
    r"|\b\d[\d,]*(?:\.\d+)?%"
    r"|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b"
)
CELL = re.compile(r"^[^!]+![A-Z]{1,3}\d+")


def _doc_figures(path: Path) -> dict[str, list[str]]:
    """Every figure in the rendered document, with where it appears."""
    from docx import Document
    doc = Document(path)
    out: dict[str, list[str]] = {}

    def add(text: str, where: str) -> None:
        for fig in FIGURE.findall(text):
            out.setdefault(fig.strip("()"), []).append(where)

    for i, p in enumerate(doc.paragraphs):
        if p.text.strip():
            add(p.text, f"para {i}")
    for t, table in enumerate(doc.tables):
        for r, row in enumerate(table.rows):
            for c, cell in enumerate(row.cells):
                add(cell.text, f"table {t} r{r}c{c}")
    for s, section in enumerate(doc.sections):
        for part, label in ((section.header, "header"), (section.footer, "footer")):
            for p in part.paragraphs:
                add(p.text, f"{label} {s}")
    return out


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    workbook = Path(argv[0])
    if not workbook.is_absolute():
        workbook = ROOT / workbook
    show_all = "--show-accounted" in argv

    from ev_proposal_agent import engine as engine_mod
    from ev_proposal_agent.charts import chart_series
    from ev_proposal_agent.extract import build_context, load_field_map
    from ev_proposal_agent.render import generate

    fm = load_field_map()
    operator = {"site_name": "Verification Site", "client_contact_name": "Contact",
                "prepared_by_name": "Preparer", "site_location_narrative": "Narrative.",
                "existing_ports_l2": 5, "existing_ports_l3": 2}

    with engine_mod.load(workbook, fm) as lw:
        ctx = build_context(lw, fm, operator_inputs=dict(operator))
        series = chart_series(lw, ctx)

    out = Path(tempfile.mkdtemp(prefix="verify-")) / "proposal.docx"
    generate(workbook, output=out, force=True, progress=lambda _m: None,
             operator_inputs=dict(operator))

    # Every string any token formatted to, mapped back to its source.
    by_text: dict[str, list[tuple[str, str]]] = {}
    for token, formatted in ctx.formatted.items():
        if not isinstance(formatted, str) or not formatted.strip():
            continue
        src = ctx.sources.get(token, "")
        for fig in FIGURE.findall(formatted):
            by_text.setdefault(fig.strip("()"), []).append((token, src))
    # Loop tables print figures that never pass through ctx.formatted.
    for name, rows in ctx.tables.items():
        src = ctx.sources.get(name, name)
        for row in rows if isinstance(rows, list) else []:
            for value in (row or {}).values():
                if isinstance(value, str):
                    for fig in FIGURE.findall(value):
                        by_text.setdefault(fig.strip("()"), []).append((f"{name}[]", src))

    # The template's justified constants - statute and programme figures that
    # are the same for every site. Imported, not restated, so this tool and the
    # template audit cannot disagree about what is allowed to be a literal.
    from tools.audit_template import ALLOWED as TEMPLATE_CONSTANTS

    figures = _doc_figures(out)
    accounted, constants, unaccounted = {}, {}, {}
    for fig, wheres in figures.items():
        hits = by_text.get(fig)
        if hits:
            accounted[fig] = (hits[0], len(wheres))
        elif fig in TEMPLATE_CONSTANTS:
            constants[fig] = (TEMPLATE_CONSTANTS[fig], len(wheres))
        else:
            unaccounted[fig] = wheres

    print(f"PROPOSAL FIGURE AUDIT - {workbook.name}")
    print(f"chassis {ctx.detection.chassis} / engine {ctx.detection.engine} "
          f"/ horizon {ctx.raw.get('projection_years')}\n")
    print(f"  {len(figures)} distinct figures printed in the document")
    print(f"  {len(accounted)} traced to a workbook-backed token")
    print(f"  {len(constants)} justified constants (statute / programme)")
    if constants:
        for fig, (why, n) in sorted(constants.items()):
            print(f"     {fig:<10} x{n:<3} {why}")
    print(f"  {len(unaccounted)} UNACCOUNTED\n")

    if series:
        print("  CHARTS - plotted series and their provenance:")
        for key, s in series.items():
            n = len(s.get("rows") or s.get("cats") or s.get("points") or [])
            print(f"     {key:<34} {n:>3} points   {s['source']}")
        print()

    if show_all:
        print("  TRACED:")
        for fig in sorted(accounted, key=lambda f: -accounted[f][1]):
            (token, src), n = accounted[fig]
            kind = "cell" if CELL.match(src) else "derived"
            print(f"     {fig:<16} x{n:<3} {token:<30} [{kind}] {src[:44]}")
        print()

    if unaccounted:
        print("  NOT TRACED TO A TOKEN - each needs a verdict:")
        for fig in sorted(unaccounted, key=lambda f: -len(unaccounted[f])):
            wheres = unaccounted[fig]
            print(f"     {fig:<16} x{len(wheres):<3} {', '.join(wheres[:3])}")
        return 1

    print("  OK    every figure in the document traces to a token.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
