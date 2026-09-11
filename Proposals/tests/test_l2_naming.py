"""The Level 2 hardware description comes off the line items, not a constant.

Level 3 always read correctly because `dcfc_mix_sentence` is built from charger
QUANTITIES and real ratings. Level 2 had no equivalent - the display string was
`f"{n_ports_l2} single-port 32A units"` - so on Best Western, which installs
2 x CTX-C80-240-2 ("80A Dual Commercial L2 Charger") across 4 ports, the
proposal said "4 single-port 32A units": the port count where the unit count
belonged, and the reference site's form factor and amperage hardcoded over it.

Every specimen below pins a different way that string could go wrong.
"""

from __future__ import annotations

import pytest

from ev_proposal_agent.validate import validate


def _codes(findings) -> set[str]:
    return {f.code for f in findings}


# --------------------------------------------------------------------------
# Dual-port hardware - the case that was wrong three ways at once
# --------------------------------------------------------------------------


def test_dual_port_l2_is_described_from_the_line_item(best_western_context):
    ctx = best_western_context
    assert ctx.raw["l2_mix_sentence"] == "2 x 80A Dual Commercial L2 Charger"
    assert ctx.raw["l2_quantity_ports"] == "2 units / 4 ports"
    assert ctx.raw["l2_amperage"] == "80A"
    assert ctx.raw["l2_sku"] == "CTX-C80-240-2"


def test_units_and_ports_are_not_the_same_number(best_western_context):
    """The whole defect in one assertion: 2 chargers, 4 ports. The old string
    used the port count and called them units."""
    ctx = best_western_context
    assert ctx.num("n_chargers_l2") == 2      # INPUT SHEET!N8
    assert ctx.num("n_ports_l2") == 4         # INPUT SHEET!N9
    assert "4 units" not in ctx.raw["l2_quantity_ports"]


def test_the_parenthetical_is_left_for_the_mounting_row(best_western_context):
    """The description ends "(18' Cable with Modem)" - cable and modem detail
    that Section 6A's mounting row already covers."""
    assert "Cable with Modem" not in best_western_context.raw["l2_mix_sentence"]


def test_no_hardcoded_form_factor_or_amperage(best_western_context):
    for token in ("l2_mix_sentence", "l2_quantity_ports", "l2_amperage"):
        value = best_western_context.raw[token]
        assert "single-port" not in value, token
        assert "32A" not in value, token


# --------------------------------------------------------------------------
# The other specimens
# --------------------------------------------------------------------------


def test_single_port_l2_still_reads_as_it_did(showcase_context):
    """The reference form factor must keep working - it just isn't assumed."""
    ctx = showcase_context
    assert ctx.raw["l2_mix_sentence"] == "1 x 32A Single Commercial L2 Charger"
    assert ctx.raw["l2_quantity_ports"] == "1 unit / 1 port"
    assert ctx.raw["l2_amperage"] == "32A"


def test_repeated_line_items_are_grouped(legacy_context):
    """Food4Less lists the SAME charger on two rows, qty 8 and qty 2. It has to
    read "10 x ...", not "8 x ... and 2 x ..."."""
    ctx = legacy_context
    assert ctx.raw["l2_mix_sentence"] == "10 x 32A Single Commercial L2 Charger"
    assert ctx.raw["l2_quantity_ports"] == "10 units / 10 ports"


def test_a_site_with_no_level_2_says_none(v16_context):
    """The v16 reference workbook installs no Level 2 at all."""
    ctx = v16_context
    assert ctx.raw["l2_mix_sentence"] == "none"
    assert ctx.raw["has_l2"] is False
    # No amperage may be invented for hardware that is not in the quote.
    assert ctx.raw["l2_amperage"] == ""


def test_amperage_falls_back_to_the_sku(marriott_context):
    """Marriott's L2 is a CTX-C32-240-1; whichever route wins, it is 32A."""
    assert marriott_context.raw["l2_amperage"] == "32A"


# --------------------------------------------------------------------------
# The contradiction guard
# --------------------------------------------------------------------------


def test_dual_charger_modelled_with_one_port_is_flagged(marriott_l2_context):
    """A 40A DUAL charger with N8=1 and N9=1 is one port per dual unit. Every
    Section 5 revenue figure is driven by the port count, so if these really are
    dual-port units the projection is understated by half. Named, not corrected."""
    ctx = marriott_l2_context
    assert ctx.raw["l2_mix_sentence"] == "1 x 40A Dual Commercial L2 Charger"
    assert "l2-ports-contradict-hardware" in _codes(ctx.findings)


@pytest.mark.parametrize("fixture_name", ["best_western_context", "showcase_context",
                                          "legacy_context", "marriott_context"])
def test_consistent_hardware_does_not_warn(request, fixture_name):
    ctx = request.getfixturevalue(fixture_name)
    assert "l2-ports-contradict-hardware" not in _codes(ctx.findings)


# --------------------------------------------------------------------------
# The workbook this was found on, end to end
# --------------------------------------------------------------------------


def test_best_western_section_5_totals_come_from_the_updated_sheet(best_western_context):
    """The operator's other report: Section 5 printed $22,592 / $67,776 /
    $112,960 - Food4Less literals baked into the template - where Updated!J24:J26
    hold these."""
    ctx = best_western_context
    assert ctx.num("projected_profit_yearly") == pytest.approx(104654.59, abs=0.01)
    assert ctx.num("projected_profit_3yr") == pytest.approx(313963.78, abs=0.01)
    assert ctx.num("projected_profit_5yr") == pytest.approx(523272.96, abs=0.01)


def test_best_western_has_no_error_findings(best_western_context, field_map):
    errors = [f for f in validate(best_western_context, field_map) if f.level == "ERROR"]
    assert errors == [], [f"{f.code}: {f.message}" for f in errors]


def test_best_western_never_breaks_even(best_western_context):
    """Not a bug - the project's own numbers. Costs $1,132,124 against EVSE
    $671,491 plus carbon $345,098. The proposal must say so rather than invent a
    break-even year."""
    ctx = best_western_context
    assert ctx.num("roi_net_revenues") < 0
    assert "no-breakeven" in _codes(ctx.findings)
