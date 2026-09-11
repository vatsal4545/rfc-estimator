"""What the charts actually plot, checked against the workbook.

Charts were the largest hole in the suite. The existing tests assert that three
PNGs exist and are bigger than 5 KB, and nothing else. A chart plotting the
reference site's numbers, or plotting the right shape from the wrong column,
passed every one of them.

They are also outside the differential leak test: `test_no_hardcoded_figures`
walks `doc.tables`, so every dollar figure rasterised into a PNG - the per-point
annotations, the outage span, the chart title - is invisible to it. A picture is
the one place a wrong number cannot be found by searching the document.

`charts.chart_series()` returns exactly what gets drawn, and `render_all` draws
from it, so these assertions cannot drift from the page.
"""

from __future__ import annotations

import pytest
from openpyxl import load_workbook

from ev_proposal_agent import engine as engine_mod
from ev_proposal_agent.charts import chart_series
from ev_proposal_agent.extract import build_context

from .conftest import (BEST_WESTERN, LEGACY, MARRIOTT, SHOWCASE)

BASE_INPUTS = {"site_name": "Site", "client_contact_name": "Contact",
               "prepared_by_name": "Preparer", "site_location_narrative": "N.",
               "existing_ports_l2": 5, "existing_ports_l3": 2}

SPECIMENS = [
    pytest.param(BEST_WESTERN, id="v16"),
    pytest.param(SHOWCASE, id="v16-legacy-engine"),
    pytest.param(MARRIOTT, id="v15_no_itc"),
    pytest.param(LEGACY, id="legacy_food4less"),
]


def _series(path, field_map):
    with engine_mod.load(path, field_map) as lw:
        ctx = build_context(lw, field_map, operator_inputs=dict(BASE_INPUTS))
        return chart_series(lw, ctx), ctx


@pytest.mark.parametrize("path", SPECIMENS)
def test_annual_profit_chart_plots_the_workbooks_own_cashflow(path, field_map):
    """Chart 2's points are `Financial Worksheet!I5:I15`, read independently."""
    series, _ctx = _series(path, field_map)
    s = series.get("chart_annual_operating_profit")
    if not s:
        pytest.skip("no charger cashflow on this specimen")

    wb = load_workbook(path, data_only=True)
    try:
        ws = wb["Financial Worksheet"]
        # Find the header row rather than assuming it: v16 puts "Year" at H4,
        # the legacy chassis at H3.
        header = next(r for r in range(1, 12) if ws[f"H{r}"].value == "Year")
        by_year = {}
        for r in range(header + 1, header + 14):
            y = ws[f"H{r}"].value
            if y is None:
                break
            by_year[int(y)] = ws[f"I{r}"].value
    finally:
        wb.close()

    wrong = []
    for row in s["rows"]:
        year = int(row["year"])
        cell = by_year.get(year)
        plotted = float(row["annual"] or 0)
        if cell is None:
            wrong.append(f"year {year} is plotted but has no row on the sheet")
        elif abs(plotted - float(cell or 0)) > 0.005:
            wrong.append(f"year {year}: chart plots {plotted}, sheet holds {cell}")
    assert not wrong, "chart 2 does not plot this workbook:\n  " + "\n  ".join(wrong)
    assert s["rows"], "chart 2 would render an empty axes"


@pytest.mark.parametrize("path", SPECIMENS)
def test_annual_profit_chart_agrees_with_its_own_caption(path, field_map):
    """The caption promises "Years 1 through {{ projection_years }}".

    `annual_operating_profit` took a `years` argument and never used it, so the
    chart plotted whatever rows the table held while the caption beneath it
    named the detected horizon.
    """
    series, _ctx = _series(path, field_map)
    s = series.get("chart_annual_operating_profit")
    if not s:
        pytest.skip("no charger cashflow on this specimen")
    plotted = len(s["rows"])
    assert plotted == s["years"], (
        f"the caption says Years 1 through {s['years']}, but the chart plots "
        f"{plotted} years"
    )


@pytest.mark.parametrize("path", SPECIMENS)
def test_cumulative_chart_agrees_with_the_table_beside_it(path, field_map):
    """Chart 3 and the Section 7A table are read through DIFFERENT mechanisms.

    The chart prefers the `cumCashCats` / `cumCashVals` OFFSET defined names;
    the table reads `consolidated_cashflow`. `validate.py` checks the table and
    nothing checks the chart, so stale defined names would put a different
    picture next to the numbers with no finding raised.
    """
    series, ctx = _series(path, field_map)
    s = series.get("chart_cumulative_cashflow")
    if not s:
        pytest.skip("no cumulative cashflow on this specimen")
    rows = ctx.tables.get("consolidated_cashflow") or []
    if not rows:
        pytest.skip("no consolidated cashflow table")

    table = {int(r["year"]): float(r["cumulative"] or 0) for r in rows}
    wrong = []
    for cat, val in zip(s["cats"], s["vals"]):
        year = int(cat)
        if year not in table:
            wrong.append(f"year {year} is on the chart but not in the table")
        elif abs(float(val or 0) - table[year]) > 0.02:
            wrong.append(f"year {year}: chart {val}, table {table[year]}")
    assert not wrong, (
        "chart 3 and the Section 7A table disagree:\n  " + "\n  ".join(wrong))


@pytest.mark.parametrize("path", SPECIMENS)
def test_cumulative_chart_title_matches_its_bar_count(path, field_map):
    """The title horizon and the bar count are two separate reads of `B10`.

    `resolve_offset_name` reads it at charts.py:192 with its own `or 5`, and
    the title takes `projection_years` from detection. A divergence prints
    "5 Year Cumulative Cashflow" over eleven bars.
    """
    series, _ctx = _series(path, field_map)
    s = series.get("chart_cumulative_cashflow")
    if not s:
        pytest.skip("no cumulative cashflow on this specimen")
    # Year 0 is the investment outflow, so bars = horizon + 1.
    assert len(s["cats"]) == s["years"] + 1, (
        f"the title says {s['years']} years but the chart draws "
        f"{len(s['cats'])} bars (expected {s['years'] + 1} including year 0)"
    )


def test_two_different_sites_plot_different_numbers(field_map):
    """A chart carrying reference-site data would pass every other test here."""
    a, _ = _series(BEST_WESTERN, field_map)
    b, _ = _series(MARRIOTT, field_map)
    for key in ("chart_annual_operating_profit", "chart_cumulative_cashflow"):
        if key in a and key in b:
            va = a[key].get("vals") or [r["annual"] for r in a[key]["rows"]]
            vb = b[key].get("vals") or [r["annual"] for r in b[key]["rows"]]
            assert va != vb, f"{key} plots identical data for two different sites"
