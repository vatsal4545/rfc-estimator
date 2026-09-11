"""The per-chassis override namespace itself.

These protect the mechanism rather than any one workbook: that `chassis:` and
`meta.fingerprints` stay in step, that no two fingerprints can claim the same
file, and that the dead keys the refactor removed do not creep back.
"""

from __future__ import annotations

import openpyxl
import pytest

from ev_proposal_agent.engine import _probe_failure

from .conftest import LEGACY, MARRIOTT, SHOWCASE, V16

SPECIMENS = [
    (V16, "v16"),
    (SHOWCASE, "v16"),
    (LEGACY, "legacy_food4less"),
    (MARRIOTT, "v15_no_itc"),
]


def test_every_chassis_entry_has_a_fingerprint(field_map):
    """An override block for a chassis nothing can detect is unreachable code."""
    assert set(field_map["chassis"]) <= set(field_map["meta"]["fingerprints"])


def test_v16_has_no_override_entry(field_map):
    """v16 IS the base map. An entry for it would mean the base map is wrong."""
    assert "v16" not in field_map["chassis"]


@pytest.mark.parametrize("path,expected", SPECIMENS, ids=lambda v: getattr(v, "name", v))
def test_exactly_one_fingerprint_matches_each_specimen(path, expected, field_map):
    """Detection is all-or-nothing per chassis with no tie-break, so two
    fingerprints matching the same file would silently resolve on YAML order."""
    if not path.exists():
        pytest.skip(f"missing input: {path}")
    wb = openpyxl.load_workbook(path, data_only=True)
    try:
        matched = [
            name
            for name, spec in field_map["meta"]["fingerprints"].items()
            if not [r for p in spec.get("probes", []) if (r := _probe_failure(wb, p))]
        ]
    finally:
        wb.close()
    assert matched == [expected], f"{path.name} matched {matched}"


def test_the_dead_legacy_keys_are_gone(field_map):
    """`legacy:` moved under `chassis:`; `validations_disabled` and
    `costs.row_offset` were never read by anything."""
    assert "legacy" not in field_map
    legacy = field_map["chassis"]["legacy_food4less"]
    assert "validations_disabled" not in legacy
    assert "row_offset" not in legacy["costs"]


def test_cost_hierarchy_is_rooted_at_the_discounted_total(field_map):
    """Every component row is Internal Summary column D (customer price), whose
    total is D30. cost_grand_total is D29, which sums column B (list price)."""
    hierarchy = field_map["costs"]["hierarchy"]
    assert "cost_after_discount" in hierarchy
    assert "cost_grand_total" not in hierarchy


def test_v15_carbon_is_anchored_not_addressed(field_map):
    """The block moves between specimens - L4:R9 on one, L5:R10 on the other -
    so it must be found by its own label, never by a fixed address."""
    carbon = field_map["chassis"]["v15_no_itc"]["carbon"]
    assert carbon["style"] == "six_tier"
    assert "fields_override" not in carbon

    anchor = carbon["anchor"]
    assert anchor["label"] == "CC Rate ($/kW/yr)"
    assert anchor["label_col"] == "L"
    assert anchor["offsets"] == {
        "cc_rate_per_kw":     {"row": 0, "col": "M"},
        "cc_tier_ratings":    {"row": 1, "cols": ["M", "R"]},
        "cc_tier_qty":        {"row": 2, "cols": ["M", "R"]},
        "cc_tier_mult":       {"row": 3, "cols": ["M", "R"]},
        "cc_l2_kwh_month":    {"row": 5, "col": "M"},
        "cc_l2_rate":         {"row": 5, "col": "N"},
        "cc_l2_credit_month": {"row": 5, "col": "O"},
    }


def test_v15_requires_neither_optional_sheet(field_map):
    """One v15 specimen is a greenfield site with no Historical Data and no
    10 Year Projection Comparison. Requiring either rejects it outright."""
    required = field_map["meta"]["fingerprints"]["v15_no_itc"]["required_sheets"]
    assert "Historical Data" not in required
    assert "10 Year Projection Comparison" not in required


def test_v15_declares_where_its_scenario_pointer_lives(field_map):
    """Its charger-cashflow block is a row above v16's, so the cell that points
    at the wired scenario is I5. Reading I6 there finds `=I5*1.125` - no
    reference to the Updated tab - and falls back to Standard-Low silently."""
    assert field_map["chassis"]["v15_no_itc"]["scenario_pointer"]["cell"] == "I5"


def test_legacy_carbon_is_the_single_tier_style(field_map):
    """Its tier quantities are hardcoded inside the B4 formula, not in a grid."""
    assert field_map["chassis"]["legacy_food4less"]["carbon"]["style"] == "single_tier"


def test_v15_declares_no_evolv_override(field_map):
    """It has the v16 EVOLV block. An override here would read evolv_ports out
    of G4, the '# of years' cell, and quote 5 ports for a 14-port site."""
    assert "evolv" not in field_map["chassis"]["v15_no_itc"]


def test_both_toggleless_chassis_declare_a_fixed_horizon(field_map):
    """The carbon-doubling guard keys off this, not off a chassis name: the
    defect IS the B9/B10 toggle, so a chassis without one cannot have it."""
    for name in ("legacy_food4less", "v15_no_itc"):
        assert field_map["chassis"][name]["horizon"]["fixed"] == 10


def test_utility_rate_is_a_sheet_lookup_not_a_constant(field_map):
    """It looks like a constant and is not - 0.40 on two workbooks, 0.2584 on
    the third."""
    cfg = field_map["historical_baseline_recompute"]["utility_rate"]
    assert cfg["sheet"] == "Updated Chargers Revenue Calcul"
    assert cfg["value_cols"] == {"l2": "B", "l3": "C"}
    assert cfg["default"] == 0.40
    # Found by label, because the row is 18 under the legacy engine and 17 under
    # the scenario grid.
    assert "label" in cfg and "row" not in cfg
