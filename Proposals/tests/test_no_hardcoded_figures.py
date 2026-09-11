"""Every number in a proposal must come from that proposal's workbook.

The template is built by finding each figure in the reference document by its
own formatted value. Any figure the extractor cannot reproduce as a string is
simply never found, and the reference site's number survives into the template -
silently, on every chassis, for every customer.

That is how `$272,023 FINANCED AMOUNT` came to print on a site whose loan was
$49,988, and how a `35 months / Aug 2023 to Jun 2026` history tile came to sit
two inches above a paragraph correctly saying 44 months.

The test is a differential: render two workbooks that share no figures, and
assert no rendered cell holds the same number in both. It needs no list of known
literals, so it catches the next one too.
"""

from __future__ import annotations

import re

import pytest
from docx import Document

from ev_proposal_agent.render import generate

from .conftest import SHOWCASE_OPERATOR_INPUTS

# Anything that reads as a figure: money, percentages, month counts, Mmm YYYY.
FIGURE = re.compile(
    r"\$[\d,]+(?:\.\d+)?"
    r"|\b\d[\d,]*(?:\.\d+)?%"
    r"|\b\d{1,3} months\b"
    r"|\b[A-Z][a-z]{2} \d{4}\b"
)

# Figures that are genuinely the same on both sites, each verified by reading
# the two workbooks. A real shared input, not a leftover.
LEGITIMATELY_SHARED = {
    "$0.0045",      # FW L2 consumption factor - the same rate in both workbooks
    "$39.99",       # EVOLV per-port monthly fee - a list price, not a site fact
    "$4,300",       # the 60 kW carbon multiplier; both sites buy that class
    "8.39%",        # the DLL interest rate quoted to both
    "12.5%",        # the growth rate hardcoded in the workbook's own I7:I15
    "3%",           # modelled new-equipment downtime, an operator default
    "60 months",    # both loans are five-year
    "$0.650",       # projected L2 retail price, the same input in both
    "Jul 2026",     # both utilization reports were pulled to the same month, so
                    # both history windows end there. The cells are
                    # {{ history_window_label }}; the START months differ.
}

# The template's own justified constants - statute and programme figures that
# are the same number for every site on earth. Imported rather than restated so
# the two lists cannot drift: a literal removed from one must be removed from
# both, and a new one has to be justified in exactly one place.
#
# Note what is NOT here any more: $8,600 and $0.0045 used to sit in Section
# 13's carbon paragraph as frozen reference-site figures. They are tokens now,
# so if either reappears this test fails, which is the point.
from tools.audit_template import ALLOWED as TEMPLATE_CONSTANTS  # noqa: E402

LEGITIMATELY_SHARED |= set(TEMPLATE_CONSTANTS)


def _render(path, tmp, name, extra=None):
    out = tmp / f"{name}.docx"
    # force=True: Marriott's Cashflow!G3 carries the carbon-divisor defect, a
    # real ERROR in that workbook. This test compares two RENDERED documents for
    # leaked reference figures, so it needs the document regardless.
    generate(path, output=out, force=True, progress=lambda _m: None,
             operator_inputs={"site_name": "Site", "client_contact_name": "Contact",
                              "prepared_by_name": "Preparer",
                              "site_location_narrative": "Narrative.",
                              **(extra or {})})
    return out


def _cells(path) -> dict[str, str]:
    """Every addressable piece of text in the document, not just table cells.

    This walked `doc.tables` only, and that blind spot is not theoretical: it
    is why Section 13's carbon paragraph quoted the REFERENCE site's credit
    rate on every proposal for as long as it did. A body paragraph is exactly
    where a leak hides from a table-cell differ.
    """
    doc = Document(path)
    out: dict[str, str] = {}
    for i, table in enumerate(doc.tables):
        for j, row in enumerate(table.rows):
            for k, cell in enumerate(row.cells):
                out[f"T{i}.{j}.{k}"] = cell.text
    for i, para in enumerate(doc.paragraphs):
        if para.text.strip():
            out[f"P{i}"] = para.text
    for si, section in enumerate(doc.sections):
        for part, label in ((section.header, "H"), (section.footer, "F")):
            for i, para in enumerate(part.paragraphs):
                if para.text.strip():
                    out[f"{label}{si}.{i}"] = para.text
    return out


@pytest.fixture(scope="module")
def two_sites(marriott_path, showcase_path, tmp_path_factory):
    tmp = tmp_path_factory.mktemp("nohardcode")
    return (_render(marriott_path, tmp, "marriott"),
            _render(showcase_path, tmp, "showcase", SHOWCASE_OPERATOR_INPUTS))


def test_no_cell_repeats_a_figure_across_two_different_sites(two_sites):
    marriott, showcase = two_sites
    a, b = _cells(marriott), _cells(showcase)

    leaks: list[str] = []
    for key, text_a in a.items():
        text_b = b.get(key)
        if text_b is None:
            continue
        shared = (set(FIGURE.findall(text_a)) & set(FIGURE.findall(text_b))
                  ) - LEGITIMATELY_SHARED
        if shared:
            label = " / ".join(x for x in text_a.split("\n") if x.strip())
            leaks.append(f"{key} {sorted(shared)} in {label[:80]!r}")

    assert not leaks, (
        "These cells print the same figure for two different sites, so at least "
        "one of them is not reading from its own workbook:\n  "
        + "\n  ".join(leaks)
    )


def test_the_reference_sites_own_figures_are_gone(two_sites):
    """A named list of the literals that were actually found baked in, so a
    future template rebuild that drops a token fails loudly here.

    Asserted against Marriott only. Showcase Liquor genuinely shares three of
    these with the reference site - 35 months of history, a $0.40 utility rate,
    and $13,752 as its Year 4 cashflow - so it cannot distinguish a leftover from
    a coincidence. Marriott differs on every one.
    """
    marriott, _showcase = two_sites
    stale = ["$26,870", "$108,477", "$406,173", "$564,696", "$433,515",
             "$131,181", "$13,752", "104.8%", "$22,592", "$67,776", "$112,960",
             "$53,332", "$46,560", "$24,750", "$272,023", "$5,567", "$61,970",
             "$92,358", "$88,883", "$6,953", "35 months", "Aug 2023 to Jun 2026",
             "Jan and Feb 2026", "$0.40 per kWh", "$0.70 per kWh", "13 x"]
    blob = "\n".join(_cells(marriott).values())
    found = [s for s in stale if s in blob]
    assert not found, f"the proposal still prints the reference site's {found}"
