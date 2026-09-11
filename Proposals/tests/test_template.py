"""Phase 4: the blank template is genuinely blank, and still a valid document."""

from __future__ import annotations

import re
import zipfile
from pathlib import Path

import pytest
from docx import Document

from tools.docx_edit import IDENTITY_PATTERNS, audit_identity

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "templates" / "proposal_template.docx"
SOURCE = ROOT / "inputs" / "Food4Less_Rip-and-Replace_Proposal-Aug2026_AR.docx"

pytestmark = pytest.mark.skipif(
    not TEMPLATE.exists(),
    reason="run `python -m tools.build_template` first",
)


@pytest.fixture(scope="module")
def template() -> Document:
    return Document(TEMPLATE)


# --------------------------------------------------------------------------
# the point of the whole exercise
# --------------------------------------------------------------------------


def test_no_client_identity_anywhere_in_the_package():
    """Including headers, footers and docProps - the three places a
    "blank" template usually smuggles the previous client's name."""
    leftover = audit_identity(TEMPLATE)
    assert leftover == {}, f"client identity survives in: {leftover}"


@pytest.mark.parametrize("needle", IDENTITY_PATTERNS)
def test_identity_string_absent(needle):
    with zipfile.ZipFile(TEMPLATE) as z:
        for name in z.namelist():
            try:
                text = z.read(name).decode("utf-8")
            except UnicodeDecodeError:
                continue
            assert needle not in text, f"{needle!r} found in {name}"


def test_footers_are_tokenised_in_all_three_parts():
    """All three footer parts carry the site identity, and all three are used."""
    with zipfile.ZipFile(TEMPLATE) as z:
        footers = [n for n in z.namelist() if re.match(r"word/footer\d+\.xml", n)]
        assert len(footers) == 3
        for name in footers:
            text = z.read(name).decode("utf-8")
            assert "{{ site_name }}" in text
            assert "{{ site_address }}" in text


def test_cached_page_number_is_cleared():
    """The reference reads "Page 1" on all 31 pages because a stale field
    result was saved beside the PAGE field."""
    with zipfile.ZipFile(TEMPLATE) as z:
        text = z.read("word/footer1.xml").decode("utf-8")
    runs = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", text)
    assert "Page " in runs
    assert "1" not in runs, "the cached page number should be blank so Word recomputes"


# --------------------------------------------------------------------------
# nothing was lost
# --------------------------------------------------------------------------


def test_document_structure_survived_the_edit():
    """Editing in place, not rebuilding, is what keeps all of this."""
    src, tpl = Document(SOURCE), Document(TEMPLATE)
    assert len(tpl.sections) == len(src.sections) == 4
    assert len(tpl.tables) == len(src.tables) == 69


def test_all_media_and_header_footer_parts_kept():
    def parts(path):
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
        return (
            sorted(n for n in names if n.startswith("word/media/")),
            sorted(n for n in names if re.match(r"word/(header|footer)\d+\.xml", n)),
        )

    src_media, src_hf = parts(SOURCE)
    tpl_media, tpl_hf = parts(TEMPLATE)
    assert tpl_media == src_media, "product photos and logos must survive"
    assert tpl_hf == src_hf


def test_styles_part_survived():
    with zipfile.ZipFile(TEMPLATE) as z:
        assert len(z.read("word/styles.xml")) > 300_000


def test_verbatim_prose_kept(template):
    """Explanatory narrative is reusable and must not be tokenised away."""
    body = "\n".join(p.text for p in template.paragraphs)
    for phrase in [
        "There are two main types of Carbon Credits",
        "Grid-parallel operation is the configuration",
        "This proposal is provided for evaluation, budgeting",
        "De Lage Landen",
        "Operations and maintenance is the ongoing process",
    ]:
        assert phrase in body, f"lost verbatim prose: {phrase!r}"


# --------------------------------------------------------------------------
# tokens and loops
# --------------------------------------------------------------------------


def test_docxtpl_can_parse_it():
    from docxtpl import DocxTemplate

    variables = DocxTemplate(TEMPLATE).get_undeclared_template_variables()
    assert len(variables) > 50


@pytest.mark.parametrize(
    "token",
    ["site_name", "site_address", "client_contact_name", "prepared_by_name",
     "proposal_date", "proposal_date_upper", "projection_years",
     "cost_after_discount", "cost_grand_total", "roi_net_revenues",
     "loan_monthly_payment", "site_location_narrative",
     "chart_historical_revenue", "chart_annual_operating_profit",
     "chart_cumulative_cashflow"],
)
def test_expected_token_present(token):
    from docxtpl import DocxTemplate

    assert token in DocxTemplate(TEMPLATE).get_undeclared_template_variables()


@pytest.mark.parametrize(
    "collection",
    ["cost_rows", "consolidated_cashflow", "charger_cashflow", "full_history",
     "historical_baseline", "operating_model", "equipment_rows",
     "infrastructure_rows", "monthly_cashflow_1_25", "monthly_cashflow_26_50",
     "monthly_cashflow_51_60"],
)
def test_loop_collections_are_wired(collection):
    with zipfile.ZipFile(TEMPLATE) as z:
        text = z.read("word/document.xml").decode("utf-8")
    flat = re.sub(r"<[^>]+>", "", text)
    assert f"for r in {collection}" in flat or f"for m in {collection}" in flat


def test_loops_are_balanced():
    with zipfile.ZipFile(TEMPLATE) as z:
        flat = re.sub(r"<[^>]+>", "", z.read("word/document.xml").decode("utf-8"))
    assert flat.count("{%tr for ") == flat.count("{%tr endfor %}")
    assert flat.count("{%tr if ") == flat.count("{%tr endif %}")


def test_itc_row_is_conditional():
    """v16 sets Financial Worksheet!B5 to zero, so the Federal ITC row and its
    stat card must disappear rather than print $0.00."""
    with zipfile.ZipFile(TEMPLATE) as z:
        flat = re.sub(r"<[^>]+>", "", z.read("word/document.xml").decode("utf-8"))
    assert "{%tr if has_itc %}" in flat


def test_charts_became_placeholders(template):
    """The three matplotlib figures are tokens; product photos and logos stay."""
    from tools.docx_edit import find_inline_images

    remaining = {t for _p, _d, t, _w, _h in find_inline_images(template)}
    assert "media/image3.png" not in remaining
    assert "media/image4.png" not in remaining
    assert "media/image7.png" not in remaining
    # The two product photos are no longer in the body at all. They shipped as
    # page-anchored drawings pinned 4.66in down the page with `wrapNone`, which
    # only worked because the reference equipment table was exactly six rows.
    # They are now extracted to templates/assets and re-inserted inline at
    # render time, conditional on the level actually being installed.
    assert "media/image5.png" not in remaining
    assert "media/image6.png" not in remaining
    assert (ROOT / "templates" / "assets" / "charger_level2.png").exists()
    assert (ROOT / "templates" / "assets" / "charger_level3.png").exists()


def test_no_page_anchored_drawings_in_the_flowing_body():
    """A floating drawing cannot reflow, so it lands on the body copy whenever a
    table above it changes length.

    The cover (body[0]) is exempt and stays anchored: it is a fixed one-page
    layout with nothing above it that can grow, which is the one place a page
    anchor is the right tool.
    """
    from docx.oxml.ns import qn

    doc = Document(TEMPLATE)
    flowing = list(doc.element.body)[1:]
    anchors = sum(len(list(el.iter(qn("wp:anchor")))) for el in flowing)
    assert anchors == 0, f"{anchors} page-anchored drawing(s) in the flowing body"



def test_unsourced_section_5_row_deleted(template):
    """'Avg Delivered Power (% of rating)' has no scenario-grid equivalent."""
    labels = [
        row.cells[0].text.strip()
        for table in template.tables
        for row in table.rows
    ]
    assert "Avg Delivered Power (% of rating)" not in labels


def test_horizon_headings_are_parameterised(template):
    body = "\n".join(p.text for p in template.paragraphs)
    tables = "\n".join(c.text for t in template.tables for r in t.rows for c in r.cells)
    everything = body + tables
    assert "{{ projection_years }}-YEAR" in everything or \
           "{{ projection_years }} years" in everything
    assert "Projected ROI after 10 years" not in everything


def test_placeholder_inventory_exists_and_lists_tokens():
    inventory = ROOT / "docs" / "PLACEHOLDER_INVENTORY.md"
    assert inventory.exists()
    text = inventory.read_text(encoding="utf-8")
    for token in ["site_name", "cost_after_discount", "cost_rows", "has_itc"]:
        assert token in text


def test_a_failed_build_leaves_the_existing_template_intact(monkeypatch):
    """The builder must publish atomically.

    It used to copy the reference document over `templates/proposal_template.docx`
    and edit in place, so a crash between passes left a half-tokenised template
    on disk - raw `10-YEAR` literals, no section guards - and the next
    `generate` used it without complaint. That happened for real: an
    `UnboundLocalError` between the badge pass and the loop pass produced a
    template whose greenfield output was silently wrong.
    """
    import hashlib

    import tools.build_template as bt

    before = hashlib.sha256(bt.TEMPLATE.read_bytes()).hexdigest()

    def boom(doc, report):
        raise RuntimeError("simulated crash between passes")

    monkeypatch.setattr(bt, "tokenise_section_badges", boom)
    with pytest.raises(RuntimeError):
        bt.main()

    after = hashlib.sha256(bt.TEMPLATE.read_bytes()).hexdigest()
    assert before == after, (
        "a failed template build modified the published template")

    for stray in bt.TEMPLATE.parent.glob("*.building.docx"):
        stray.unlink()
