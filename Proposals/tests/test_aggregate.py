"""Phase 3: seven scenario columns collapsed into the two the proposal prints."""

from __future__ import annotations

import pytest

from ev_proposal_agent import engine as engine_mod
from ev_proposal_agent.aggregate import (
    AGG_BY_CHARGERS,
    AGG_BY_KWH,
    AGG_BY_PORTS,
    AGG_SUM,
    Column,
    apply_rule,
    build_operating_model,
    l3_heading,
)
from ev_proposal_agent.extract import build_context

from .fixtures import expected_three_tier, make_three_tier_workbook


# --------------------------------------------------------------------------
# the real single-tier sample
# --------------------------------------------------------------------------


def test_aggregate_matches_the_scenario_totals_cell(field_map, v16_paths):
    """The check that proves the aggregation is right: the summed
    profit_per_year must equal `Updated!J24`, which the Financial Worksheet is
    itself wired to. If these disagree, Section 5 contradicts Section 7B."""
    with engine_mod.load(v16_paths, field_map) as lw:
        ctx = build_context(lw, field_map)
        model = build_operating_model(lw, field_map, ctx)
        j24 = lw.values["Updated Chargers Revenue Calcul"]["J24"].value

    row = next(r for r in model.rows if r["token"] == "profit_per_year")
    total = row["l3"] + (row["l2"] or 0)
    assert total == pytest.approx(float(j24), abs=1.0)
    assert total == pytest.approx(6350.40, abs=1.0)


def test_single_tier_heading(v16_context):
    assert v16_context.raw["l3_column_heading"] == "Level 3 (60 kW)"


def test_l2_column_dropped_when_no_l2_chargers(field_map, v16_paths):
    with engine_mod.load(v16_paths, field_map) as lw:
        ctx = build_context(lw, field_map)
        model = build_operating_model(lw, field_map, ctx)
    assert model.has_l2 is False
    assert all(r["l2"] is None and r["l2_fmt"] == "" for r in model.rows)


# --------------------------------------------------------------------------
# the three-tier fixture - where the weighting rules actually bite
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def three_tier_context(field_map, v16_paths, tmp_path_factory):
    dest = tmp_path_factory.mktemp("three-tier") / "three_tier_v16.xlsx"
    make_three_tier_workbook(v16_paths, dest)
    with engine_mod.load(dest, field_map) as lw:
        ctx = build_context(lw, field_map)
        model = build_operating_model(lw, field_map, ctx)
    return ctx, model


def test_three_tiers_are_detected_as_active(three_tier_context):
    _, model = three_tier_context
    # 60 kW (C), 120 kW (D) and 180 kW (F) have chargers; 160/240/360 do not.
    assert model.active_tiers == ["C", "D", "F"]


def test_three_tier_heading_lists_the_mix(three_tier_context):
    _, model = three_tier_context
    assert model.l3_heading == "Level 3 (1 x 60 kW + 2 x 120 kW + 3 x 180 kW)"


def test_l2_column_kept_when_l2_chargers_present(three_tier_context):
    _, model = three_tier_context
    assert model.has_l2 is True
    chargers = next(r for r in model.rows if r["token"] == "chargers")
    assert chargers["l2"] == 8


@pytest.mark.parametrize(
    "token",
    ["chargers", "stall_qty", "charger_rating_kw", "stall_occupancy",
     "retail_rate", "profit_per_year", "kwh_per_day", "max_hours", "utility_rate"],
)
def test_three_tier_aggregates(three_tier_context, token):
    _, model = three_tier_context
    expected = expected_three_tier()
    row = next(r for r in model.rows if r["token"] == token)
    assert row["l3"] == pytest.approx(expected[token], rel=1e-9)


def test_rating_is_charger_weighted_not_a_plain_mean(three_tier_context):
    """The failure this guards against: averaging over all six tiers, or over
    the active three unweighted, both put capacity in the proposal that is not
    in the quote."""
    _, model = three_tier_context
    expected = expected_three_tier()
    rating = next(r for r in model.rows if r["token"] == "charger_rating_kw")["l3"]

    assert rating == pytest.approx(expected["charger_rating_kw"], rel=1e-9)
    assert rating != pytest.approx(expected["naive_rating_all_tiers"], rel=1e-3)
    assert rating != pytest.approx(expected["naive_rating_active_unweighted"], rel=1e-3)


def test_inactive_tiers_contribute_nothing(three_tier_context):
    """160, 240 and 360 kW carry ratings and rates but no chargers."""
    _, model = three_tier_context
    rating = next(r for r in model.rows if r["token"] == "charger_rating_kw")["l3"]
    assert rating < 176.4, "an inactive 360 kW tier must not lift the fleet rating"


def test_three_tier_profit_matches_the_totals_cell(three_tier_context):
    _, model = three_tier_context
    row = next(r for r in model.rows if r["token"] == "profit_per_year")
    assert row["l3"] + row["l2"] == pytest.approx(model.totals["profit_yearly"], abs=1.0)


# --------------------------------------------------------------------------
# the rules in isolation
# --------------------------------------------------------------------------


def _col(letter, chargers, ports, kwh, value, row=99):
    return Column(letter=letter, label=letter,
                  values={5: chargers, 6: ports, 16: kwh, row: value})


def test_rules_differ_from_each_other():
    """Same three columns, four rules, four different answers. If any two of
    these ever coincide the fixture has stopped testing anything."""
    cols = [
        _col("C", chargers=1, ports=1, kwh=100, value=10),
        _col("D", chargers=2, ports=4, kwh=500, value=20),
        _col("F", chargers=3, ports=3, kwh=900, value=30),
    ]
    results = {
        AGG_SUM: apply_rule(cols, 99, AGG_SUM),
        AGG_BY_CHARGERS: apply_rule(cols, 99, AGG_BY_CHARGERS),
        AGG_BY_PORTS: apply_rule(cols, 99, AGG_BY_PORTS),
        AGG_BY_KWH: apply_rule(cols, 99, AGG_BY_KWH),
    }
    assert results[AGG_SUM] == 60
    assert results[AGG_BY_CHARGERS] == pytest.approx((1*10 + 2*20 + 3*30) / 6)      # 23.33
    assert results[AGG_BY_PORTS] == pytest.approx((1*10 + 4*20 + 3*30) / 8)         # 22.50
    assert results[AGG_BY_KWH] == pytest.approx((100*10 + 500*20 + 900*30) / 1500)  # 25.33
    assert len(set(round(v, 6) for v in results.values())) == 4


def test_weighted_rule_falls_back_to_a_plain_mean_on_zero_weights():
    """A tier can be charger-active before its kWh figure is computed.
    Returning 0 there would silently zero out a retail rate."""
    cols = [_col("C", chargers=1, ports=0, kwh=0, value=10),
            _col("D", chargers=1, ports=0, kwh=0, value=20)]
    assert apply_rule(cols, 99, AGG_BY_PORTS) == pytest.approx(15.0)


def test_empty_column_set_is_zero_not_a_crash():
    assert apply_rule([], 99, AGG_SUM) == 0.0
    assert apply_rule([], 99, AGG_BY_CHARGERS) == 0.0


def test_unknown_rule_is_rejected():
    with pytest.raises(ValueError, match="unknown aggregation rule"):
        apply_rule([_col("C", 1, 1, 1, 1)], 99, "average_ish")


@pytest.mark.parametrize(
    "tiers, expected",
    [
        ([("C", 1, 60)], "Level 3 (60 kW)"),
        ([("C", 2, 120)], "Level 3 (2 x 120 kW)"),
        ([("C", 2, 120), ("D", 1, 60)], "Level 3 (2 x 120 kW + 1 x 60 kW)"),
        ([], "Level 3"),
    ],
)
def test_l3_heading_shapes(tiers, expected):
    cols = [Column(letter=l, label=l, values={5: q, 6: q}) for l, q, _ in tiers]
    kw = {l: k for l, _, k in tiers}
    assert l3_heading(cols, kw) == expected


# --------------------------------------------------------------------------
# legacy
# --------------------------------------------------------------------------


def test_legacy_uses_the_projected_columns_directly(field_map, legacy_path):
    """No aggregation needed: legacy D and E are already the printed columns.
    It also carries an extra row 13 that v16 does not have."""
    from .conftest import FOOD4LESS_OPERATOR_INPUTS

    with engine_mod.load(legacy_path, field_map) as lw:
        ctx = build_context(lw, field_map, operator_inputs=FOOD4LESS_OPERATOR_INPUTS)
        model = build_operating_model(lw, field_map, ctx)

    tokens = [r["token"] for r in model.rows]
    assert "avg_delivered_pct" in tokens, "legacy row 13 has no v16 equivalent"
    assert model.has_l2 is True

    by_token = {r["token"]: r for r in model.rows}
    # the projected column of the reference proposal's Section 5
    assert by_token["chargers"]["l2"] == 10
    assert by_token["chargers"]["l3"] == 3
    assert by_token["charger_rating_kw"]["l3"] == pytest.approx(98.0, abs=0.01)
    assert by_token["profit_per_year"]["l3"] == pytest.approx(20670.03677, abs=0.01)
    assert by_token["profit_per_year"]["l2"] == pytest.approx(1922.03483, abs=0.01)
