"""Collapse the seven-column scenario block into the two columns S5 prints.

v16's `Updated Chargers Revenue Calcul` holds three scenario blocks of seven
columns each - one Level 2 column plus six DC-fast tiers (60 / 120 / 160 / 180 /
240 / 360 kW). The proposal prints two columns: Level 2, and one combined
Level 3. Getting from seven to two is not a sum: an occupancy percentage summed
across three tiers is nonsense, and a charger rating averaged over tiers nobody
is installing invents capacity.

So each row carries its own rule:

    sum                   counts, revenue, kWh, profit
    weighted_by_ports     occupancy, hours per stall
    weighted_by_chargers  charger rating
    weighted_by_kwh       retail rate
    first_active          flat assumptions (operating window, utility rate)

A tier is active only when row 5 (Chargers) is greater than zero. Inactive tiers
still carry ratings and rates, so including them is exactly how you end up with
a fleet rating for hardware that is not in the quote.

The legacy engine needs none of this: its two projected columns are already
D (Level 2) and E (Level 3).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .engine import UCRC, LoadedWorkbook
from .extract import Context, format_value
from .findings import Findings

AGG_SUM = "sum"
AGG_BY_PORTS = "weighted_by_ports"
AGG_BY_CHARGERS = "weighted_by_chargers"
AGG_BY_KWH = "weighted_by_kwh"
AGG_FIRST = "first_active"

ROW_CHARGERS = 5
ROW_PORTS = 6
ROW_KWH_PER_DAY = 16


@dataclass
class Column:
    """One tier column of the scenario block."""

    letter: str
    label: str
    values: dict[int, float]      # sheet row -> cached value

    @property
    def chargers(self) -> float:
        return self.values.get(ROW_CHARGERS, 0.0)

    @property
    def ports(self) -> float:
        return self.values.get(ROW_PORTS, 0.0)

    @property
    def kwh_per_day(self) -> float:
        return self.values.get(ROW_KWH_PER_DAY, 0.0)

    @property
    def active(self) -> bool:
        return self.chargers > 0


def _num(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return float(value)


def read_columns(lw: LoadedWorkbook, letters: list[str], rows: list[int],
                 labels: dict[str, str] | None = None) -> list[Column]:
    ws = lw.values[UCRC]
    labels = labels or {}
    return [
        Column(
            letter=letter,
            label=labels.get(letter, letter),
            values={row: _num(ws[f"{letter}{row}"].value) for row in rows},
        )
        for letter in letters
    ]


def _weighted(columns: list[Column], row: int, weight) -> float:
    """Weighted mean, falling back to a plain mean when every weight is zero.

    The fallback matters: a tier block can be active by charger count while the
    weighting quantity (kWh, say) has not been computed yet, and returning 0
    there would silently zero out a retail rate.
    """
    pairs = [(weight(c), c.values.get(row, 0.0)) for c in columns]
    total = sum(w for w, _ in pairs)
    if total > 0:
        return sum(w * v for w, v in pairs) / total
    values = [v for _, v in pairs]
    return sum(values) / len(values) if values else 0.0


def apply_rule(columns: list[Column], row: int, rule: str) -> float:
    """Combine one row across a set of columns."""
    if not columns:
        return 0.0
    if rule == AGG_SUM:
        return sum(c.values.get(row, 0.0) for c in columns)
    if rule == AGG_BY_PORTS:
        return _weighted(columns, row, lambda c: c.ports)
    if rule == AGG_BY_CHARGERS:
        return _weighted(columns, row, lambda c: c.chargers)
    if rule == AGG_BY_KWH:
        return _weighted(columns, row, lambda c: c.kwh_per_day)
    if rule == AGG_FIRST:
        return columns[0].values.get(row, 0.0)
    raise ValueError(f"unknown aggregation rule {rule!r}")


def l3_heading(tiers: list[Column], tier_kw: dict[str, float]) -> str:
    """`Level 3 (60 kW)` for one unit, `Level 3 (2 x 120 kW + 1 x 60 kW)` for a mix."""
    if not tiers:
        return "Level 3"
    parts = [(int(c.chargers), tier_kw.get(c.letter, 0.0)) for c in tiers]
    if len(parts) == 1 and parts[0][0] <= 1:
        return f"Level 3 ({parts[0][1]:g} kW)"
    return "Level 3 (" + " + ".join(f"{qty} x {kw:g} kW" for qty, kw in parts) + ")"


# --------------------------------------------------------------------------


@dataclass
class OperatingModel:
    """The Section 5 table, already collapsed to what gets printed."""

    rows: list[dict[str, Any]]
    l2_heading: str
    l3_heading: str
    has_l2: bool
    active_tiers: list[str]
    totals: dict[str, float]

    def as_table(self) -> list[dict[str, Any]]:
        return self.rows


def aggregate_scenario(
    lw: LoadedWorkbook,
    fm: dict,
    ctx: Context,
    *,
    scenario: str | None = None,
) -> OperatingModel:
    """Build the Section 5 operating profile for the wired scenario."""
    formats = fm["meta"]["formats"]
    controls = fm["document_controls"]["scenario"]
    spec = fm["operating_model"]["scenario_grid"]
    scenario = scenario or ctx.raw.get("revenue_scenario") or "Standard-Low"

    column_set = controls["column_sets"].get(scenario)
    if column_set is None:
        raise ValueError(f"no column set defined for scenario {scenario!r}")

    row_specs = spec["rows"]
    rows_needed = sorted({r["row"] for r in row_specs} | {ROW_CHARGERS, ROW_PORTS,
                                                          ROW_KWH_PER_DAY})
    tier_kw_list = controls["l3_tier_kw"]
    tier_kw = dict(zip(column_set["l3"], tier_kw_list))

    l2_col = read_columns(lw, [column_set["l2"]], rows_needed, {column_set["l2"]: "Level 2"})[0]
    l3_cols = read_columns(lw, column_set["l3"], rows_needed,
                           {c: f"{tier_kw[c]:g} kW" for c in column_set["l3"]})

    # A tier with zero chargers is not being installed. Averaging its rating in
    # would put capacity in the proposal that is not in the quote.
    active = [c for c in l3_cols if c.active]
    inactive_with_data = [c for c in l3_cols if not c.active and c.kwh_per_day]
    if inactive_with_data:
        ctx.findings.info(
            "inactive-tiers-skipped",
            "Scenario columns "
            + ", ".join(f"{c.letter} ({c.label})" for c in inactive_with_data)
            + " carry rates but no chargers, so they were left out of the "
              "Level 3 aggregate.",
            where=UCRC,
        )

    has_l2 = l2_col.chargers > 0
    rows: list[dict[str, Any]] = []
    for entry in row_specs:
        row_no = entry["row"]
        rule = entry["agg"]
        l2_value = l2_col.values.get(row_no, 0.0) if has_l2 else None
        l3_value = apply_rule(active, row_no, rule)
        rows.append({
            "token": entry["token"],
            "label": entry["label"],
            "row": row_no,
            "agg": rule,
            "l2": l2_value,
            "l3": l3_value,
            "l2_fmt": format_value(l2_value, entry.get("format"), formats) if has_l2 else "",
            "l3_fmt": format_value(l3_value, entry.get("format"), formats),
        })

    totals = _read_totals(lw, spec, controls, scenario)
    heading = l3_heading(active, tier_kw)

    model = OperatingModel(
        rows=rows,
        l2_heading="Level 2",
        l3_heading=heading,
        has_l2=has_l2,
        active_tiers=[c.letter for c in active],
        totals=totals,
    )
    _publish(model, ctx, fm, formats)
    return model


def _read_totals(lw: LoadedWorkbook, spec: dict, controls: dict, scenario: str
                 ) -> dict[str, float]:
    """Rows 24-26 of the scenario's totals column.

    Standard-High's totals column is `Q`, which is also the first L3 tier column
    of the High block. They do not collide because tier data lives on rows 5-21
    and totals on 24-26 - but never resolve one by scanning the other's rows.
    """
    ws = lw.values[UCRC]
    col = spec["totals"]["scenario_cols"][scenario]
    return {
        name: _num(ws[f"{col}{row}"].value)
        for name, row in spec["totals"]["rows"].items()
    }


def _publish(model: OperatingModel, ctx: Context, fm: dict, formats: dict) -> None:
    """Write the aggregate into the render context."""
    ctx.tables["operating_model"] = model.rows
    ctx.sources["operating_model"] = f"{UCRC} rows 5-19, {ctx.raw.get('revenue_scenario')}"
    ctx.put("l3_column_heading", model.l3_heading, formats=formats)
    ctx.put("has_l2", model.has_l2, emit=False)

    for name, value in model.totals.items():
        ctx.put(f"projected_{name}", value, fmt="currency0",
                source=f"{UCRC} totals row", formats=formats)

    # The scenario grid's totals block has Yearly / 3 Years / 5 Years and no
    # gross-revenue row, so Section 5's last line had nothing to render and came
    # out blank. It is one multiplication away from a row that IS there:
    # 'Per 30 day Cycle' x 12, both levels. Derived rather than left empty.
    if "gross_yearly" not in model.totals:
        per_30 = next((r for r in model.rows if r["token"] == "revenue_per_30day"), None)
        if per_30 is not None:
            gross = (_num(per_30["l2"]) + _num(per_30["l3"])) * 12
            ctx.put("projected_gross_yearly", gross, fmt="currency0",
                    source=f"{UCRC}!row {per_30['row']} (per 30 days) x 12",
                    formats=formats)

    by_token = {r["token"]: r for r in model.rows}
    for token in ("chargers", "stall_qty", "charger_rating_kw", "profit_per_year",
                  "net_profit_month", "retail_rate", "utility_rate", "max_hours",
                  "stall_occupancy", "kwh_per_day"):
        row = by_token.get(token)
        if row is None:
            continue
        ctx.put(f"proj_{token}_l3", row["l3"], source=f"{UCRC}!row {row['row']}",
                formats=formats)
        ctx.formatted[f"proj_{token}_l3"] = row["l3_fmt"]
        if model.has_l2:
            ctx.put(f"proj_{token}_l2", row["l2"], source=f"{UCRC}!row {row['row']}",
                    formats=formats)
            ctx.formatted[f"proj_{token}_l2"] = row["l2_fmt"]

    if not model.has_l2:
        ctx.findings.info(
            "l2-column-suppressed",
            "The scenario has no Level 2 chargers, so the Level 2 column is "
            "dropped from Section 5 and the Level 2 carbon-credit sentence is "
            "left out.",
            where=f"{UCRC}!row {ROW_CHARGERS}",
        )


# --------------------------------------------------------------------------
# legacy
# --------------------------------------------------------------------------


def legacy_operating_model(lw: LoadedWorkbook, fm: dict, ctx: Context) -> OperatingModel:
    """Legacy needs no aggregation - D and E are already the printed columns."""
    formats = fm["meta"]["formats"]
    spec = fm["operating_model"]["baseline_vs_projected"]
    cols = spec["columns"]
    totals_rows = spec["totals_rows"]
    ws = lw.values[UCRC]

    # Legacy carries an extra row 13, 'Avg Delivered Power', so rows 13-21 all
    # sit one lower than their v16 equivalents.
    labels_and_rows = [
        ("chargers", "Chargers", 5, "integer"),
        ("stall_qty", "EV Stall Quantity (Based on # of ports)", 6, "integer"),
        ("max_hours", "Max hours of operation of parking", 7, "integer"),
        ("stall_occupancy", "Stall Occupancy % (stalls seeing use each day)", 8, "percent1"),
        ("stalls_used_per_day", "Number of stalls used per day", 9, "number2"),
        ("charging_hourly_pct", "Charging Hourly % per stall per day", 10, "percent1"),
        ("hours_per_stall_day", "Number of hours usage per stall per day", 11, "number2"),
        ("charger_rating_kw", "Charger Rating (kW, incl. de-rate)", 12, "number2"),
        ("avg_delivered_pct", "Avg Delivered Power (% of rating)", 13, "percent1"),
        ("retail_rate", "Retail Revenue per kWHr", 14, "currency3"),
        ("revenue_per_day", "Total Revenue per day", 15, "currency2"),
        ("revenue_per_30day", "Per 30 day Cycle", 16, "currency2"),
        ("kwh_per_day", "Total kWhr dispensed per day", 17, "number1"),
        ("utility_rate", "EV Utility Rate average per kWHr", 18, "currency2"),
        ("net_profit_month", "Net Profit per Month", 19, "currency2"),
        ("profit_per_year", "Total Profit per Year", 20, "currency2"),
        ("out_of_service_share", "Estimated share of station time out of service", 21, "percent0"),
    ]

    rows: list[dict[str, Any]] = []
    for token, label, row_no, fmt in labels_and_rows:
        l2_value = _num(ws[f"{cols['proj_l2']}{row_no}"].value)
        l3_value = _num(ws[f"{cols['proj_l3']}{row_no}"].value)
        rows.append({
            "token": token, "label": label, "row": row_no, "agg": "direct",
            "l2": l2_value, "l3": l3_value,
            "l2_fmt": format_value(l2_value, fmt, formats),
            "l3_fmt": format_value(l3_value, fmt, formats),
        })

    # Legacy totals sit in column C (Projected), not in the D/E data columns
    # this sheet's rows are read from. Reading them from `proj_l3` looks right
    # and is not.
    totals: dict[str, float] = {}
    for name, row in totals_rows.items():
        if name == "header":
            continue
        totals[name] = _num(ws[f"C{row}"].value)

    has_l2 = rows[0]["l2"] > 0
    model = OperatingModel(
        rows=rows,
        l2_heading="Level 2",
        l3_heading="Level 3 (Fast)",
        has_l2=has_l2,
        active_tiers=[],
        totals=totals,
    )
    _publish(model, ctx, fm, formats)
    _publish_idle_fees(lw, ctx, formats)
    return model


def _publish_idle_fees(lw: LoadedWorkbook, ctx: Context, formats: dict) -> None:
    """`Updated!G12` / `H12` - idle-fee profit per year, L2 and L3.

    Only the baseline-vs-projected model has an idle-fee block at all; the
    scenario grid keeps a charger rating at G12, which is the collision this
    program exists to avoid, so `build_operating_model` publishes zero there.

    Nothing in the PROPOSAL spends this. Section 5's KPI strip used to add it to
    tile 1, which meant one caption described two different quantities depending
    on which engine the workbook carried; the tiles now read charger revenue and
    carbon credits straight off the Financial Worksheet, and Section 4's
    idle-policy rows have been removed outright.

    It stays published because it is a real figure sitting in the workbook and
    the QA report exists to show what is in the workbook. Dropping it would hide
    an input, not remove a claim.

    The grace-period cells (`G6`/`H6`) are NOT published any more: their only
    consumer was the Section 4 row, and a token computed for nobody is how
    Section 13 came to print the reference site's carbon rate for months.
    """
    ws = lw.values[UCRC]
    total = _num(ws["G12"].value) + _num(ws["H12"].value)
    ctx.put("idle_fee_annual", total, fmt="currency0",
            source=f"{UCRC}!G12 + H12", formats=formats)


def build_operating_model(lw: LoadedWorkbook, fm: dict, ctx: Context) -> OperatingModel:
    if ctx.detection.is_legacy_engine:
        return legacy_operating_model(lw, fm, ctx)
    model = aggregate_scenario(lw, fm, ctx)
    # No idle-fee block under the scenario grid - G12 holds a charger rating
    # there, which is the collision this program exists to avoid. Published as
    # zero rather than left absent so the QA report says so explicitly.
    formats = fm["meta"]["formats"]
    ctx.put("idle_fee_annual", 0.0, fmt="currency0",
            source="the scenario grid has no idle-fee model", formats=formats)
    return model
