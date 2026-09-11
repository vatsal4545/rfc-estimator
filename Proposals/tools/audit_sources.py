"""Every token that reaches a proposal, and where its value came from.

The template prints ~100 placeholders. `field_map.yaml` declares 179 tokens.
`ctx.sources` records provenance for whatever `extract.py` chose to record. All
three disagreed, and nothing reconciled them - so a figure on page 9 could not
be traced to a cell without reading the extractor.

This walks every specimen, builds a real context, and reports:

  * emitted tokens with NO recorded source - a number nobody can trace
  * template placeholders with no value in the payload - prints blank
  * payload keys the template never references - computed and discarded, the
    defect that left Section 13 quoting the reference site's carbon rate

    python -m tools.audit_sources              # summary across all specimens
    python -m tools.audit_sources --full       # the per-token table
    python -m tools.audit_sources --markdown   # docs/SOURCE_AUDIT.md section 2

Exit status is 1 if any emitted token lacks a source.
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "templates" / "proposal_template.docx"

# One per chassis and engine combination, so a chassis-specific hole shows up.
SPECIMENS: list[tuple[str, str, dict]] = [
    ("BestWestern_Reduction_v16.xlsx", "v16 / scenario grid", {}),
    ("RFC_MSRP_Calculator_Simple_v16.xlsx", "v16 / master", {}),
    ("Historical_Showcase_Liquor_Pasadena_2026-08-06.xlsx", "v16 / legacy engine",
     {"existing_ports_l2": 8, "existing_ports_l3": 2}),
    ("Historical_Marriott_Bakersfield.xlsx", "v15_no_itc", {}),
    ("Rip_and_Replace_MarriottBakersfield_L2.xlsx", "v16 / L2 only", {}),
    ("Historical_RipandReplaceFood4Less_f-00148.xlsx", "legacy_food4less",
     {"existing_ports_l2": 5, "existing_ports_l3": 2,
      "existing_nameplate_l2_kw": 7.2, "existing_nameplate_l3_kw": 60}),
]

# Values supplied by the operator in the app, not by the workbook. They have no
# cell by definition; naming them here keeps them out of the failure list.
OPERATOR_TOKENS = {
    "site_name", "client_contact_name", "prepared_by_name", "site_location_narrative",
    "client_title", "client_company", "site_address", "prepared_by_title",
    "cover_photo", "cover_photo_path", "disabled_sections", "photo_level2",
    "photo_level3", "existing_ports_l2", "existing_ports_l3",
    "existing_nameplate_l2_kw", "existing_nameplate_l3_kw",
}

CELL = re.compile(r"^[^!]+![A-Z]{1,3}\d+")


def template_tokens() -> set[str]:
    with zipfile.ZipFile(TEMPLATE) as z:
        text = "".join(
            "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>",
                               z.read(n).decode("utf-8", "ignore"), re.S))
            for n in z.namelist()
            if n.endswith(".xml") and ("document" in n or "header" in n or "footer" in n)
        )
    return set(re.findall(r"\{\{r?\s*([a-zA-Z_][a-zA-Z0-9_]*)", text))


def contexts():
    from ev_proposal_agent import engine as engine_mod
    from ev_proposal_agent.extract import load_field_map, build_context
    fm = load_field_map()
    for name, label, inputs in SPECIMENS:
        path = ROOT / "inputs" / name
        if not path.exists():
            continue
        base = {"site_name": "Site", "client_contact_name": "Contact",
                "prepared_by_name": "Preparer", "site_location_narrative": "Narrative."}
        with engine_mod.load(path, fm) as lw:
            yield label, build_context(lw, fm, operator_inputs={**base, **inputs})


def main(argv: list[str]) -> int:
    tmpl = template_tokens()
    unsourced: dict[str, set[str]] = {}
    rows: dict[str, tuple[str, str]] = {}
    seen_payload: set[str] = set()

    print("TOKEN PROVENANCE ACROSS EVERY CHASSIS AND ENGINE\n")
    print("  %-22s %6s %8s %9s" % ("specimen", "emit", "sourced", "no source"))
    for label, ctx in contexts():
        emitted = sorted(ctx.emitted)
        seen_payload |= set(ctx.raw)
        missing = [t for t in emitted
                   if t not in ctx.sources and t not in OPERATOR_TOKENS]
        for t in emitted:
            src = ctx.sources.get(t)
            if src and t not in rows:
                rows[t] = (src, str(ctx.formatted.get(t, ""))[:34])
        for t in missing:
            unsourced.setdefault(t, set()).add(label)
        print("  %-22s %6d %8d %9d" % (label, len(emitted), len(emitted) - len(missing),
                                       len(missing)))

    print("\n  %d distinct tokens carry a recorded source." % len(rows))
    cellish = sum(1 for s, _ in rows.values() if CELL.match(s))
    print("  %d of those name a workbook cell or range; %d are stated derivations."
          % (cellish, len(rows) - cellish))

    if unsourced:
        print("\n  EMITTED WITH NO SOURCE - a printed value nobody can trace:")
        for t in sorted(unsourced):
            print("     %-34s %s" % (t, ", ".join(sorted(unsourced[t]))))

    # narrative_* are added by narrative.build_all() at render time, not by
    # extract, so they are absent from ctx.raw and are not ghosts. Single
    # letters are artefacts of parsing the `{{r tag }}` RichText syntax.
    ghosts = sorted(t for t in tmpl
                    if t not in seen_payload and t not in OPERATOR_TOKENS
                    and len(t) > 1 and not t.startswith(("section_number", "chart_", "narrative_")))
    if ghosts:
        print("\n  TEMPLATE PLACEHOLDER WITH NO VALUE ANYWHERE (renders blank):")
        for t in ghosts:
            print("     %s" % t)

    orphans = sorted(t for t in rows if t not in tmpl)
    print("\n  %d sourced tokens are never referenced by the template" % len(orphans))
    print("  (QA-report only, or computed and discarded - the Section 13 defect).")

    if "--full" in argv or "--markdown" in argv:
        md = "--markdown" in argv
        print("\n" + ("| token | source | example |\n|---|---|---|" if md
                      else "  %-34s %-46s %s" % ("TOKEN", "SOURCE", "EXAMPLE")))
        for t in sorted(rows):
            src, ex = rows[t]
            print(("| `%s` | `%s` | %s |" % (t, src, ex)) if md
                  else "  %-34s %-46s %s" % (t, src[:46], ex))

    if unsourced:
        print("\n  FAIL  %d token(s) print without provenance." % len(unsourced))
        return 1
    print("\n  OK    every emitted token has a source.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
