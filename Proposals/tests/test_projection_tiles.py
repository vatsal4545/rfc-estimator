"""Section 4's projection tiles: charger revenue and carbon, nothing else.

The four tiles used to describe themselves in terms of idle fees. Tile 1 was
computed as `year1_charger_profit + idle_fee_annual`, which is 0 under the
scenario grid but real under the legacy engine - so one caption described two
different quantities depending on which workbook it was. Tile 4's caption
claimed idle fees for a value that never had an idle term at all.

Every tile now reads charger revenue and carbon credits off the Financial
Worksheet, and every caption says what its own value contains.
"""

from __future__ import annotations

import openpyxl
import pytest

ALL = ["best_western_context", "showcase_context", "marriott_context",
       "marriott_l2_context", "legacy_context", "v16_context"]
WITH_IDLE = ["marriott_context", "legacy_context"]      # legacy engine


@pytest.mark.parametrize("fixture_name", WITH_IDLE)
def test_tile_1_excludes_idle_fees(request, fixture_name):
    """On a legacy-engine file `idle_fee_annual` is non-zero, so this assertion
    cannot pass vacuously - which is the whole point of parametrising over the
    files that actually have idle fees."""
    ctx = request.getfixturevalue(fixture_name)
    idle = ctx.num("idle_fee_annual")
    assert idle > 0, "fixture has no idle fees, so this proves nothing"

    charger = ctx.num("year1_charger_profit")
    assert ctx.num("kpi_year1_operating") == pytest.approx(charger, abs=0.51)
    assert ctx.num("kpi_year1_operating") != pytest.approx(charger + idle, abs=0.51)


@pytest.mark.parametrize("fixture_name", ALL)
def test_tile_1_is_year_one_charger_revenue(request, fixture_name):
    """Straight off the Financial Worksheet's charger cashflow, at whichever row
    year 1 sits on for that chassis - row 6 on v16, row 5 on legacy/v15."""
    ctx = request.getfixturevalue(fixture_name)
    rows = ctx.tables["charger_cashflow"]
    year_one = next((r for r in rows if r["year"] == 1), None)
    if year_one is None:
        pytest.skip("no year 1 row")
    assert ctx.num("kpi_year1_operating") == pytest.approx(year_one["annual"], abs=0.51)


@pytest.mark.parametrize("fixture_name", ALL)
def test_tile_3_is_the_horizon_evse_total(request, fixture_name):
    """`Financial Worksheet!B6`, EVSE Revenues, `=SUM(I6:I15)`."""
    ctx = request.getfixturevalue(fixture_name)
    assert ctx.num("horizon_evse_total") == pytest.approx(
        ctx.num("roi_evse_revenues"), abs=0.51)


@pytest.mark.parametrize("fixture_name", ALL)
def test_tile_4_is_evse_plus_carbon_plus_any_itc(request, fixture_name):
    ctx = request.getfixturevalue(fixture_name)
    expected = (ctx.num("roi_evse_revenues") + ctx.num("roi_carbon_credits")
                + ctx.num("roi_itc"))
    assert ctx.num("kpi_horizon_total") == pytest.approx(expected, abs=0.51)


@pytest.mark.parametrize("fixture_name", ALL)
def test_every_tile_value_matches_its_own_caption(request, fixture_name):
    """The bug this function was fixed for was a caption promising a term the
    value did not contain. Assert the arithmetic the captions describe."""
    ctx = request.getfixturevalue(fixture_name)
    years = ctx.num("projection_years") or 5
    carbon_per_year = ctx.num("roi_carbon_credits") / years

    expected_year1_total = (ctx.num("year1_charger_profit") + carbon_per_year
                            + ctx.num("roi_itc"))
    assert ctx.num("kpi_year1_total") == pytest.approx(expected_year1_total, abs=0.51)

    # The two branches must differ ONLY by the ITC term.
    if ctx.num("roi_itc"):
        assert "ITC" in ctx.raw["kpi_year1_total_sub"]
        assert "ITC" in ctx.raw["kpi_horizon_total_sub"]
    else:
        assert "ITC" not in ctx.raw["kpi_year1_total_sub"]
        assert "ITC" not in ctx.raw["kpi_horizon_total_sub"]


@pytest.mark.parametrize("fixture_name", ALL)
def test_no_caption_mentions_idle(request, fixture_name):
    ctx = request.getfixturevalue(fixture_name)
    for token in ("kpi_year1_total_sub", "kpi_year1_total_label",
                  "kpi_horizon_total_sub"):
        assert "idle" not in str(ctx.raw.get(token, "")).lower(), token


def test_tile_2_equals_the_sheets_own_year_one_cashflow(best_western_context,
                                                        best_western_path):
    """`FW!E6` is `I6 + B5 + (B4/$B$10)`. With the ITC at zero that is exactly
    charger revenue plus one year of carbon, so it is the cross-check that this
    arithmetic is the same thing the workbook computes."""
    ctx = best_western_context
    assert ctx.num("roi_itc") == 0
    wb = openpyxl.load_workbook(best_western_path, data_only=True)
    e6 = wb["Financial Worksheet"]["E6"].value
    wb.close()
    assert ctx.num("kpi_year1_total") == pytest.approx(e6, abs=0.51)


def test_the_uplift_token_was_renamed(best_western_context, marriott_context):
    """`kpi_uplift_incl_idle` no longer describes what it computes."""
    for ctx in (best_western_context, marriott_context):
        assert "kpi_uplift_incl_idle" not in ctx.raw
    assert "kpi_uplift" in marriott_context.raw       # history present


def test_the_dead_idle_flag_is_gone(best_western_context, marriott_context):
    """`has_idle_fees` had no consumer: no template guard, no test, no narrative."""
    for ctx in (best_western_context, marriott_context):
        assert "has_idle_fees" not in ctx.raw


def test_idle_fee_annual_is_still_reported(marriott_context):
    """It is a real workbook figure and belongs in the QA report - it just does
    not feed any printed tile any more."""
    ctx = marriott_context
    assert ctx.num("idle_fee_annual") > 0
    assert "G12" in ctx.sources["idle_fee_annual"]
