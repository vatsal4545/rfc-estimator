"""Every literal figure left in the template, classified.

`tools/build_template.py` finds each figure in the reference document by its own
formatted value. A figure the extractor cannot reproduce as a string is never
found, so the reference site's number survives - silently, on every chassis, for
every customer. That is how `$272,023 FINANCED AMOUNT` came to print on a site
whose loan was $49,988.

This audit is the counter-check. It reads the template as a zip and scans EVERY
xml part, because `python-docx` sees neither text boxes nor headers and footers,
and `tests/test_no_hardcoded_figures.py` walks `doc.tables` only. A figure
hiding in a floating shape is invisible to both.

Jinja is stripped first, so what remains is what the template prints
unconditionally, on every proposal, whatever workbook produced it.

    python -m tools.audit_template            # report
    python -m tools.audit_template --json     # machine-readable

Exit status is 1 if any unclassified literal is found, so the build can gate on
it.
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "proposal_template.docx"

# Anything that reads as a figure to a customer.
FIGURE = re.compile(
    r"\$[\d,]+(?:\.\d+)?"
    r"|\b\d[\d,]*(?:\.\d+)?%"
    r"|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b"
)
JINJA = re.compile(r"\{\{.*?\}\}|\{%.*?%\}", re.S)
RUN_TEXT = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.S)

# A literal is allowed to stay only if it is the same number for every site on
# earth. Each entry carries the reason, and the reason is what gets reviewed.
ALLOWED: dict[str, str] = {
    "30%": "IRC 48 base ITC rate - federal statute, not a site fact",
    "10%": "IRC 48 domestic-content and energy-community adders - statute",
    "3,500": "LCFS FCI credit explainer - programme constant",
    "4,500": "LCFS FCI credit explainer - programme constant",
    "2.5%": "LCFS credit escalator quoted in the explainer - programme constant",
    "$20": "illustrative grid-parallel demand band, prose only",
    "$35": "illustrative grid-parallel demand band, prose only",
}

# Known site-varying leaks: these MUST become tokens. Listed so the audit names
# them rather than lumping them in with the unclassified.
KNOWN_LEAKS: dict[str, str] = {
    "$8,600": "carbon tier multiplier - Financial Worksheet!F45, varies with the tiers installed",
    "$0.0045": "Level 2 consumption factor - Financial Worksheet!F47",
}


def scan(path: Path = TEMPLATE) -> dict[str, dict]:
    """Every literal figure in every xml part, with where it was found."""
    found: dict[str, dict] = {}
    with zipfile.ZipFile(path) as z:
        for part in sorted(n for n in z.namelist() if n.endswith(".xml")):
            raw = z.read(part).decode("utf-8", "ignore")
            # Join runs before matching: Word splits "$8,600" across three runs
            # often enough that a per-run scan misses half of them.
            text = "".join(RUN_TEXT.findall(raw)) if "<w:t" in raw else raw
            text = JINJA.sub("", text)
            for m in FIGURE.finditer(text):
                lit = m.group(0)
                entry = found.setdefault(lit, {"count": 0, "parts": set(), "contexts": []})
                entry["count"] += 1
                entry["parts"].add(part.split("/")[-1])
                if len(entry["contexts"]) < 2:
                    lo, hi = max(0, m.start() - 55), m.end() + 55
                    entry["contexts"].append(" ".join(text[lo:hi].split()))
    return found


def classify(found: dict[str, dict]) -> tuple[list, list, list]:
    allowed, leaks, unknown = [], [], []
    for lit in sorted(found, key=lambda x: -found[x]["count"]):
        if lit in ALLOWED:
            allowed.append(lit)
        elif lit in KNOWN_LEAKS:
            leaks.append(lit)
        else:
            unknown.append(lit)
    return allowed, leaks, unknown


def main(argv: list[str]) -> int:
    if not TEMPLATE.exists():
        print(f"template not found: {TEMPLATE}", file=sys.stderr)
        return 2
    found = scan()
    allowed, leaks, unknown = classify(found)

    if "--json" in argv:
        print(json.dumps(
            {lit: {"count": v["count"], "parts": sorted(v["parts"]),
                   "verdict": ("allowed" if lit in ALLOWED else
                               "site-varying" if lit in KNOWN_LEAKS else "UNCLASSIFIED"),
                   "reason": ALLOWED.get(lit) or KNOWN_LEAKS.get(lit) or "",
                   "contexts": v["contexts"]}
             for lit, v in found.items()}, indent=1))
        return 1 if unknown else 0

    total = sum(v["count"] for v in found.values())
    print("LITERAL FIGURES IN templates/proposal_template.docx")
    print("all xml parts, jinja stripped - these print on every proposal\n")
    print(f"  {len(found)} distinct, {total} occurrences\n")

    def show(title: str, lits: list[str], why: dict[str, str] | None) -> None:
        if not lits:
            return
        print(f"  {title}")
        for lit in lits:
            v = found[lit]
            print(f"     {lit:<12} x{v['count']:<3} {','.join(sorted(v['parts']))}")
            if why:
                print(f"     {'':<12}     {why[lit]}")
            elif v["contexts"]:
                print(f"     {'':<12}     ...{v['contexts'][0][:78]}...")
        print()

    show("CONSTANT - the same for every site, allowed to stay:", allowed, ALLOWED)
    show("SITE-VARYING - must become a token:", leaks, KNOWN_LEAKS)
    show("UNCLASSIFIED - no verdict recorded, review these:", unknown, None)

    if unknown:
        print(f"  FAIL  {len(unknown)} literal(s) with no verdict.")
        print("        Add to ALLOWED with a reason, or to KNOWN_LEAKS and tokenise it.")
        return 1
    print(f"  OK    every literal accounted for "
          f"({len(allowed)} constant, {len(leaks)} awaiting a token)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
