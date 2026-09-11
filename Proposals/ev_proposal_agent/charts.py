"""The three figures, rendered to PNG at the sizes the template reserves.

Matched to the reference: light horizontal gridlines only, currency y-axis,
150 dpi, DejaVu Sans. Sizes come from the display width recorded when each
image was pulled out of the reference document, so they come back the same size.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")           # no display on a build server or in the .exe

import matplotlib.pyplot as plt                       # noqa: E402
from matplotlib.ticker import FuncFormatter, MaxNLocator  # noqa: E402

from .engine import FW, LoadedWorkbook                # noqa: E402
from .resolve import defined_name_formula             # noqa: E402

INK = "#12355B"
ACCENT = "#1CA3EC"
MUTED = "#8C98A4"
FILL = "#E3F2F8"
BAR = "#C0504D"
GRID = "#D8DEE4"
OUTAGE = "#F2C4C1"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 9,
    "axes.edgecolor": GRID,
    "axes.labelcolor": "#333333",
    "text.color": "#333333",
    "xtick.color": "#555555",
    "ytick.color": "#555555",
})


def _currency(value, _pos=None) -> str:
    if abs(value) >= 1000:
        return f"${value / 1000:,.0f}k"
    return f"${value:,.0f}"


def _style(ax) -> None:
    """Horizontal gridlines only, no box. Matches the reference figures."""
    ax.set_axisbelow(True)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.xaxis.grid(False)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.yaxis.set_major_formatter(FuncFormatter(_currency))


def _save(fig, path: Path, dpi: int = 150) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(path, dpi=dpi, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return path


# --------------------------------------------------------------------------
# 1. historical monthly revenue
# --------------------------------------------------------------------------


def historical_revenue(points: list[dict], out: Path, *,
                       outage_runs: list[tuple[int, int]] | None = None) -> Path:
    """Monthly total / Level 3 / Level 2 revenue over the analysis window.

    Outage periods are shaded from `outage_runs`, which `baseline.py` detects by
    comparing each month against its trailing three-month mean. Nothing about
    the dates is hardcoded, so a site whose outage was in a different month is
    still shaded correctly.
    """
    fig, ax = plt.subplots(figsize=(13, 5))
    labels = [p["label"] for p in points]
    x = range(len(points))

    for run_start, run_end in (outage_runs or []):
        ax.axvspan(run_start - 0.4, run_end + 0.4, color=OUTAGE, alpha=0.55, zorder=0)
        mid = (run_start + run_end) / 2
        top = max((p["total_rev"] for p in points), default=1)
        span = (labels[run_start] if run_start == run_end
                else f"{labels[run_start]} to {labels[run_end]}")
        ax.annotate(f"Outage\n{span}", xy=(mid, top * 0.92), ha="center",
                    fontsize=8, color="#8C3A34")

    has_l2 = any(p["l2_rev"] for p in points)
    has_l3 = any(p["l3_rev"] for p in points)
    # Split by level only when there are two levels to split. On a site that
    # only ever had Level 2, the level line lies exactly under the total and
    # the legend claims a breakdown the chart does not show.
    ax.plot(x, [p["total_rev"] for p in points], color=INK, linewidth=2.2,
            label="Total revenue" if (has_l2 and has_l3) else
                  ("Level 2 revenue" if has_l2 else "Level 3 revenue"),
            zorder=3)
    if has_l2 and has_l3:
        ax.plot(x, [p["l3_rev"] for p in points], color=ACCENT, linewidth=1.6,
                label="Level 3 revenue", zorder=2)
        ax.plot(x, [p["l2_rev"] for p in points], color=MUTED, linewidth=1.4,
                label="Level 2 revenue", zorder=2)

    step = max(1, len(points) // 18)
    ax.set_xticks(list(x)[::step])
    ax.set_xticklabels(labels[::step], rotation=45, ha="right", fontsize=8)
    ax.set_ylabel("Monthly revenue ($)")
    ax.set_ylim(bottom=0)
    ax.legend(frameon=False, loc="upper left", fontsize=8)
    _style(ax)
    return _save(fig, out)


# --------------------------------------------------------------------------
# 2. annual operating profit
# --------------------------------------------------------------------------


def annual_operating_profit(rows: list[dict], out: Path, *, years: int) -> Path:
    """Modelled operating profit, years 1..N.

    The reference axis said "plus idle fees". Under the scenario grid there is
    no idle model at all, so the label would be claiming a revenue stream the
    figures do not contain.
    """
    data = [r for r in rows if r.get("year") and r["year"] >= 1]
    fig, ax = plt.subplots(figsize=(13, 5.5))
    xs = [int(r["year"]) for r in data]
    ys = [float(r["annual"] or 0) for r in data]

    ax.fill_between(xs, ys, color=FILL, zorder=1)
    ax.plot(xs, ys, color=INK, linewidth=2.2, marker="o", markersize=5, zorder=3)
    for x, y in zip(xs, ys):
        ax.annotate(_currency(y), xy=(x, y), xytext=(0, 8),
                    textcoords="offset points", ha="center", fontsize=8, color=INK)

    ax.set_xlabel("Year")
    ax.set_ylabel("Annual operating profit ($)")
    ax.set_xticks(xs)
    ax.xaxis.set_major_locator(MaxNLocator(integer=True))
    ax.set_ylim(bottom=0, top=max(ys) * 1.18 if ys else 1)
    _style(ax)
    return _save(fig, out)


# --------------------------------------------------------------------------
# 3. cumulative cashflow
# --------------------------------------------------------------------------


_OFFSET_RE = re.compile(
    r"OFFSET\(\s*'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,",
    re.IGNORECASE,
)


def resolve_offset_name(lw: LoadedWorkbook, name: str) -> list[Any] | None:
    """Read a defined name that is an `OFFSET(...)` formula, not a static range.

    `cumCashCats` and `cumCashVals` are:

        OFFSET('Financial Worksheet'!$D$5, 0, 0, 'Financial Worksheet'!$B$10+1, 1)

    openpyxl cannot evaluate that - it hands back the formula text. So the
    anchor and offsets are parsed out and the height is resolved against `B10`,
    which is what makes the range horizon-aware in the first place.
    """
    formula = defined_name_formula(lw.values, name) or defined_name_formula(
        lw.formulas, name
    )
    if not formula:
        return None
    match = _OFFSET_RE.search(formula)
    if not match:
        return None

    sheet, col, row, row_off, col_off = match.groups()
    if sheet not in lw.values.sheetnames:
        return None
    ws = lw.values[sheet]

    from openpyxl.utils import column_index_from_string, get_column_letter

    start_row = int(row) + int(row_off)
    start_col = column_index_from_string(col) + int(col_off)
    height = int(lw.values[FW]["B10"].value or 5) + 1

    letter = get_column_letter(start_col)
    return [ws[f"{letter}{start_row + i}"].value for i in range(height)]


def cumulative_cashflow(years: list, values: list, out: Path, *,
                        projection_years: int) -> Path:
    """Bars for cumulative project cashflow, negative until break-even."""
    fig, ax = plt.subplots(figsize=(9, 5))
    xs = [int(y) for y in years]
    ys = [float(v or 0) for v in values]

    ax.bar(xs, ys, color=BAR, width=0.62, zorder=2)
    ax.axhline(0, color="#7A8590", linewidth=1.0, zorder=3)
    for x, y in zip(xs, ys):
        offset = 8 if y >= 0 else -14
        ax.annotate(_currency(y), xy=(x, y), xytext=(0, offset),
                    textcoords="offset points", ha="center", fontsize=8)

    ax.set_title(f"{projection_years} Year Cumulative Cashflow",
                 fontsize=11, color=INK, pad=12)
    ax.set_xlabel("Year")
    ax.set_ylabel("Cumulative $")
    ax.set_xticks(xs)
    _style(ax)
    return _save(fig, out)


# --------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------


def chart_series(lw: LoadedWorkbook, ctx) -> dict[str, dict]:
    """Exactly the data every chart plots, with where each series came from.

    A chart is the one place a wrong number reaches a customer as a picture,
    where no string search can find it: the differential leak test reads table
    cells, so every dollar figure rasterised into a PNG is outside it. This
    function exists so the plotted series can be asserted against the workbook
    without parsing pixels, and `render_all` draws from it - the test cannot
    drift away from what is actually on the page.
    """
    from .baseline import detect_outage_runs

    years = int(ctx.raw.get("projection_years") or 5)
    out: dict[str, dict] = {}

    points = ctx.tables.get("monthly_series") or []
    if points:
        out["chart_historical_revenue"] = {
            "points": points,
            "outage_runs": detect_outage_runs(points),
            "source": ctx.sources.get("monthly_series", "Historical Data"),
        }

    charger = ctx.tables.get("charger_cashflow") or []
    if charger:
        # `year >= 1` mirrors the plot; the caption beneath it promises
        # "Years 1 through {{ projection_years }}", so the row count and the
        # horizon have to agree and a test asserts they do.
        out["chart_annual_operating_profit"] = {
            "rows": [r for r in charger if (r.get("year") or 0) >= 1],
            "years": years,
            "source": ctx.sources.get("charger_cashflow", "Financial Worksheet!H5:J15"),
        }

    cats = resolve_offset_name(lw, "cumCashCats")
    vals = resolve_offset_name(lw, "cumCashVals")
    via = "cumCashCats / cumCashVals (OFFSET defined names)"
    if not cats or not vals:
        # The legacy chassis has neither defined name. The consolidated cashflow
        # table holds the same two columns.
        rows = ctx.tables.get("consolidated_cashflow") or []
        cats = [r["year"] for r in rows]
        vals = [r["cumulative"] for r in rows]
        via = ctx.sources.get("consolidated_cashflow", "consolidated_cashflow table")
    pairs = [(c, v) for c, v in zip(cats, vals)
             if c is not None and v is not None and not isinstance(c, str)]
    if pairs:
        out["chart_cumulative_cashflow"] = {
            "cats": [c for c, _ in pairs],
            "vals": [v for _, v in pairs],
            "years": years,
            "source": via,
        }
    return out


def render_all(lw: LoadedWorkbook, ctx, outdir: Path) -> dict[str, Path]:
    """Render every chart the context has data for. Missing data skips a chart
    rather than emitting an empty one - the section is suppressed anyway."""
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    made: dict[str, Path] = {}
    series = chart_series(lw, ctx)

    s = series.get("chart_historical_revenue")
    if s:
        made["chart_historical_revenue"] = historical_revenue(
            s["points"], outdir / "chart_historical_revenue.png",
            outage_runs=s["outage_runs"],
        )

    s = series.get("chart_annual_operating_profit")
    # An all-year-0 table used to pass the guard and draw an empty axes.
    if s and s["rows"]:
        made["chart_annual_operating_profit"] = annual_operating_profit(
            s["rows"], outdir / "chart_annual_operating_profit.png", years=s["years"]
        )

    s = series.get("chart_cumulative_cashflow")
    if s:
        made["chart_cumulative_cashflow"] = cumulative_cashflow(
            s["cats"], s["vals"],
            outdir / "chart_cumulative_cashflow.png", projection_years=s["years"],
        )
    return made


def render_all_from_workbook(path: str | Path, outdir: Path) -> dict[str, Path]:
    """`ev-proposal-agent charts <workbook>`."""
    from . import engine as engine_mod
    from .extract import build_context, load_field_map

    fm = load_field_map()
    with engine_mod.load(path, fm) as lw:
        ctx = build_context(lw, fm, operator_inputs={
            "existing_ports_l2": 1, "existing_ports_l3": 1,
        })
        return render_all(lw, ctx, Path(outdir))
