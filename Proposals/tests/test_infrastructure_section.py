"""Section 8's electrical breakdown must account for the whole subtotal.

`_infrastructure_rows` was a hardcoded dict of six tokens. `cost_electrical_
subtotal` has FOURTEEN children, so eight were silently dropped and the
"Other / miscellaneous" row printed a literal "$0 or project-specific".

On Best Western that omitted $107,152.52 - 56% of the electrical scope -
including $68,970 of Main Distribution Switchgear and $20,933 of ADA work, in a
table a customer reads as the infrastructure scope.
"""

from __future__ import annotations

import openpyxl
import pytest
from docx import Document

from ev_proposal_agent.render import _infrastructure_rows
from ev_proposal_agent.validate import validate


def _amount(row) -> float:
    return float(row["formatted"].replace("$", "").replace(",", ""))


ALL_FIXTURES = ["best_western_context", "showcase_context", "legacy_context",
                "marriott_context", "marriott_l2_context", "v16_context"]


@pytest.mark.parametrize("fixture_name", ALL_FIXTURES)
def test_rows_always_foot_to_the_electrical_subtotal(request, fixture_name, field_map):
    """The invariant, on every specimen. `other` is a RESIDUAL, so this holds
    even on a chassis carrying a child row the map has never heard of."""
    ctx = request.getfixturevalue(fixture_name)
    rows = _infrastructure_rows(ctx, field_map)
    subtotal = ctx.num("cost_electrical_subtotal")
    if not subtotal:
        assert rows == []          # nothing to break down
        return
    assert sum(_amount(r) for r in rows) == pytest.approx(subtotal, abs=0.02)


@pytest.mark.parametrize("fixture_name", ALL_FIXTURES)
def test_no_electrical_cost_is_dropped(request, fixture_name, field_map):
    """Every child of the subtotal is either its own row or inside `other`.
    Summing the named rows and comparing to the subtotal is what the old code
    failed: it printed a strict subset and called it the scope."""
    ctx = request.getfixturevalue(fixture_name)
    children = field_map["costs"]["hierarchy"]["cost_electrical_subtotal"]
    assert sum(ctx.num(c) for c in children) == pytest.approx(
        ctx.num("cost_electrical_subtotal"), abs=0.02)


def test_switchgear_and_ada_are_their_own_lines(best_western_context, field_map):
    """Both were folded into a $0 misc row. They are $68,970 and $20,933."""
    rows = _infrastructure_rows(best_western_context, field_map)
    labels = [r["label"] for r in rows]
    assert "Main Distribution Switchgear" in labels
    assert "ADA" in labels

    by_label = {r["label"]: _amount(r) for r in rows}
    assert by_label["Main Distribution Switchgear"] == pytest.approx(68970.00, abs=0.01)
    assert by_label["ADA"] == pytest.approx(20933.00, abs=0.01)


def test_other_is_the_residual_not_a_literal(best_western_context, field_map):
    """It printed "$0 or project-specific" on every proposal ever generated."""
    ctx = best_western_context
    rows = _infrastructure_rows(ctx, field_map)
    other = next(r for r in rows if r["label"] == "Other / miscellaneous")
    assert _amount(other) == pytest.approx(17249.52, abs=0.01)
    # asphalt + permits + utility + construction PM + materials + sales tax
    leftovers = ("cost_asphalt", "cost_permits", "cost_utility",
                 "cost_construction_pm", "cost_materials", "cost_sales_tax_equipment")
    assert _amount(other) == pytest.approx(sum(ctx.num(t) for t in leftovers), abs=0.01)


def test_other_row_is_dropped_when_there_is_no_remainder(showcase_context, field_map):
    """A zero residual must not print a $0.00 line."""
    ctx = showcase_context
    rows = _infrastructure_rows(ctx, field_map)
    if ctx.num("cost_electrical_other") == 0:
        assert "Other / miscellaneous" not in [r["label"] for r in rows]


def test_subtotal_matches_the_workbook_cell(best_western_context, best_western_path):
    """The figure the total row prints is Internal Summary!D13 itself."""
    wb = openpyxl.load_workbook(best_western_path, data_only=True)
    d13 = wb["Internal Summary"]["D13"].value
    wb.close()
    assert best_western_context.num("cost_electrical_subtotal") == pytest.approx(d13, abs=0.01)


def test_footing_check_is_wired_into_validate(best_western_context, field_map):
    codes = {f.code for f in validate(best_western_context, field_map)}
    assert "infrastructure-does-not-foot" not in codes
    assert "infrastructure-other-negative" not in codes


# --------------------------------------------------------------------------
# The total row is verified but NOT printed.
# --------------------------------------------------------------------------


def test_no_total_row_is_rendered(best_western_path, tmp_path):
    """The named rows plus the residual already add up to the subtotal, so a
    "Total electrical and civil scope" line restated the column above it. It is
    gone from the document - but `_check_infrastructure_foots` still enforces
    that the rows add up, so removing the line did not remove the guarantee."""
    from ev_proposal_agent.render import generate

    out = tmp_path / "S8.docx"
    generate(best_western_path, output=out, force=True, progress=lambda _m: None,
             operator_inputs={"site_name": "S", "client_contact_name": "C",
                              "prepared_by_name": "P",
                              "site_location_narrative": "N."})

    doc = Document(out)
    blob = "\n".join(c.text for t in doc.tables for r in t.rows for c in r.cells)
    assert "Total electrical and civil scope" not in blob
    assert "Matches Internal Summary" not in blob

    table = next(t for t in doc.tables
                 if "Conductors, conduit" in " ".join(
                     c.text for r in t.rows for c in r.cells))
    labels = [r.cells[0].text.strip() for r in table.rows]
    assert not any(label.lower().startswith("total") for label in labels)

    # ...and the rows a reader can see still foot to the workbook.
    printed = 0.0
    for row in table.rows[1:]:
        cell = row.cells[1].text.strip()
        if cell.startswith("$"):
            printed += float(cell.replace("$", "").replace(",", ""))
    wb = openpyxl.load_workbook(best_western_path, data_only=True)
    d13 = wb["Internal Summary"]["D13"].value
    wb.close()
    assert printed == pytest.approx(d13, abs=0.02)


def test_the_last_row_is_the_scope_basis_note(best_western_context, field_map):
    """`keep_tail` is 1 now. If someone puts it back to 2 the loop stops one row
    short and silently drops whichever category sorts last."""
    rows = _infrastructure_rows(best_western_context, field_map)
    assert rows[-1]["label"] == "Other / miscellaneous"
    assert len(rows) == 9      # 8 named with a value, plus the residual
