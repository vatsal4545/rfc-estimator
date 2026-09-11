"""`Cashflow!G3`'s divisor, judged rather than assumed.

`Financial Worksheet!B4` is the carbon total over the WHOLE horizon - it is
itself `B10 x` an annual figure - so the monthly rate is `B4 / (B10 * 12)` and
is horizon-invariant. The loan is 60 months whatever the view period, so the
financing tables should not move at all when the toggle changes.

The shipped calculator writes `/(5*12)`, right only at a 5-year horizon. At 10
years it spreads ten years of carbon over five and doubles the monthly figure.

The guard used to key off "does this chassis have a B9/B10 toggle", which
exempted the two toggleless chassis from a check they fail. It now reads the
formula, on every chassis.
"""

from __future__ import annotations

from ev_proposal_agent.engine import CASHFLOW, _check_carbon_divisor
from ev_proposal_agent.findings import Findings

CORRECT = "='Financial Worksheet'!$B$4/('Financial Worksheet'!$B$10*12)"
SHIPPED = "='Financial Worksheet'!$B$4/(5*12)"
TEN = "='Financial Worksheet'!$B$4/(10*12)"


class _Cell:
    def __init__(self, value):
        self.value = value


class _Sheet:
    def __init__(self, value):
        self._value = value

    def __getitem__(self, _key):
        return _Cell(self._value)


class _Book:
    """Minimal stand-in for the formulas workbook: one cell, one value."""

    def __init__(self, value, present=True):
        self._value = value
        self.sheetnames = [CASHFLOW] if present else []

    def __getitem__(self, _key):
        return _Sheet(self._value)


def _fires(formula, years, *, financing=True, present=True) -> bool:
    findings = Findings()
    _check_carbon_divisor(_Book(formula, present), findings, years, financing)
    return "cashflow-carbon-doubled" in {f.code for f in findings}


def test_shipped_formula_is_fine_at_five_years():
    """The overwhelming majority of workbooks. Must stay silent."""
    assert _fires(SHIPPED, 5) is False


def test_shipped_formula_is_reported_at_ten_years():
    """The operator's case: flip B9 to '10 Year' and B4 doubles under a /60."""
    assert _fires(SHIPPED, 10) is True


def test_corrected_formula_passes_at_every_horizon():
    """This is what unblocks the operator once they fix the sheet. A divisor that
    references B10 is right by construction - including for a horizon nobody has
    added to B9 yet."""
    assert _fires(CORRECT, 5) is False
    assert _fires(CORRECT, 10) is False
    assert _fires(CORRECT, 7) is False


def test_a_matching_hardcode_is_accepted():
    """The older files have no B10, so `/(10*12)` is the honest fix there."""
    assert _fires(TEN, 10) is False


def test_a_mismatched_hardcode_is_caught_either_way():
    """Not just 5-under-10. A file hardcoded to 10 on a 5-year horizon would
    UNDERSTATE the monthly carbon, and that is equally wrong."""
    assert _fires(TEN, 5) is True


def test_no_loan_means_no_monthly_tables_to_be_wrong():
    """Sections 16/16A-D are suppressed without financing, so there is nothing
    for a bad divisor to corrupt."""
    assert _fires(SHIPPED, 10, financing=False) is False


def test_silent_when_there_is_nothing_to_judge():
    """A literal, an empty cell, an unrecognised shape, or no Cashflow tab at
    all. The guard reports defects it can prove, and never guesses."""
    assert _fires(5751.63, 10) is False            # a pasted-in number
    assert _fires(None, 10) is False               # empty
    assert _fires("=SUM(Q1:Q9)", 10) is False      # some other formula
    assert _fires(SHIPPED, 10, present=False) is False


def test_the_message_names_the_cell_the_factor_and_the_fix():
    findings = Findings()
    _check_carbon_divisor(_Book(SHIPPED), findings, 10, True)
    message = next(iter(findings)).message
    assert "Cashflow!G3:G62" in message
    assert "(5*12)" in message                     # what it found
    assert "10-year" in message                    # what it expected
    assert "2x" in message                         # how wrong
    assert "$B$10*12" in message                   # what to type instead
    assert "unchanged to the cent" in message      # and that 5-year is safe


def test_every_specimen_agrees_with_its_own_divisor(field_map):
    """The real files, read through the real loader. The three fixed-10 workbooks
    carry the defect and now say so; every 5-year file is clean."""
    from ev_proposal_agent import engine as engine_mod

    from .conftest import (BEST_WESTERN, LEGACY, MARRIOTT, MARRIOTT_L2,
                           SHOWCASE, V16)

    expected = {
        V16: False, BEST_WESTERN: False, SHOWCASE: False,   # 5-year, /(5*12)
        LEGACY: True, MARRIOTT: True, MARRIOTT_L2: True,    # 10-year, /(5*12)
    }
    for path, should_fire in expected.items():
        if not path.exists():
            continue
        with engine_mod.load(path, field_map) as lw:
            fired = "cashflow-carbon-doubled" in {
                f.code for f in lw.detection.findings}
        assert fired is should_fire, f"{path.name}: expected fire={should_fire}"
