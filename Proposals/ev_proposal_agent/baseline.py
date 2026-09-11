"""Section 3B, recomputed from `Historical Data` alone.

Why recompute instead of read
-----------------------------
Under the legacy engine these values sit in `Updated!B5:C27`. That is exactly
the block whose addresses collide with v16's scenario grid, where `B19` means
"total profit per year" rather than "net profit per month". Reading it is how
you get a plausible wrong Section 3B.

`Historical Data` has no such problem: 109 formulas, zero cross-sheet
references, identical under either engine. Re-deriving the chain from it gives
one Section 3B that is correct in both workbooks.

The chain below is transcribed from the Food4Less workbook and verified to
reproduce its printed Section 3B exactly (15.3% / 43.0% occupancy,
7.06 / 49.00 kW, $269.50 / $12,848.62 per year, $13,118 total, $31,220 gross).

Two inputs are in no sheet: the **existing** equipment's port count and
nameplate kW. They are operator inputs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import Any

from .engine import LoadedWorkbook
from .extract import Context, format_value
from .findings import Findings
from .resolve import find_label_row, is_missing

HD = "Historical Data"
DEFAULT_MAX_HOURS = 12
DEFAULT_UTILITY_RATE = 0.40

_ROWS_RE = re.compile(r"ROWS\(\s*[A-Z]+(\d+)\s*:\s*[A-Z]+(\d+)\s*\)", re.IGNORECASE)
_DATE_RE = re.compile(
    r"DATE\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*-\s*DATE\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------
# the recompute
# --------------------------------------------------------------------------


@dataclass
class LevelBaseline:
    """One level (L2 or L3) of the Section 3B table."""

    level: str
    ports: float
    nameplate_kw: float
    derate: float
    stall_occupancy: float
    stalls_used_per_day: float
    charging_hourly_pct: float
    hours_per_stall_day: float
    charger_rating_kw: float
    avg_delivered_pct: float
    retail_rate: float
    revenue_per_day: float
    revenue_per_30day: float
    kwh_per_day: float
    utility_rate: float
    net_profit_month: float
    profit_per_year: float
    out_of_service_share: float
    max_hours: float

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def recompute_level(
    *,
    level: str,
    ports: float,
    nameplate_kw: float,
    derate: float,
    avg_stalls_used_day: float,
    avg_charging_hours: float,
    avg_delivered_kw: float,
    effective_rate: float,
    unproductive_share: float,
    max_hours: float = DEFAULT_MAX_HOURS,
    utility_rate: float = DEFAULT_UTILITY_RATE,
) -> LevelBaseline:
    """One pass of the Section 3B chain. Excel formulas in the comments.

    L2 reads `Historical Data` column J, L3 reads column K; everything else is
    identical, which is why this takes plain numbers rather than a worksheet.
    """
    # A site can genuinely have had no chargers of one level. Showcase Liquor
    # ran four Level 2 units and no DC fast at all, so its whole Level 3 column
    # is zero. That is a real baseline of nothing, not a bad input, and it must
    # produce a row of zeroes rather than a crash or a division by zero.
    if ports <= 0 or nameplate_kw <= 0 or avg_stalls_used_day <= 0:
        return LevelBaseline(
            level=level, ports=max(ports, 0.0), nameplate_kw=max(nameplate_kw, 0.0),
            derate=derate, stall_occupancy=0.0, stalls_used_per_day=0.0,
            charging_hourly_pct=0.0, hours_per_stall_day=0.0,
            charger_rating_kw=max(nameplate_kw, 0.0) * derate,
            avg_delivered_pct=0.0, retail_rate=effective_rate,
            revenue_per_day=0.0, revenue_per_30day=0.0, kwh_per_day=0.0,
            utility_rate=utility_rate, net_profit_month=0.0, profit_per_year=0.0,
            out_of_service_share=unproductive_share, max_hours=max_hours,
        )

    stall_occupancy = avg_stalls_used_day / ports              # =HD!J12/B6
    stalls_used_per_day = ports * stall_occupancy              # =B6*B8
    charging_hourly_pct = avg_charging_hours / max_hours       # =HD!J13/B7
    hours_per_stall_day = charging_hourly_pct * max_hours      # =B10*B7
    charger_rating_kw = nameplate_kw * derate                  # =7.2*N11 / =50*N11
    avg_delivered_pct = avg_delivered_kw / charger_rating_kw   # =HD!J14/B12
    retail_rate = effective_rate                               # =HD!J11

    # =B14*B12*B13*B9*B11
    revenue_per_day = (
        retail_rate * charger_rating_kw * avg_delivered_pct
        * stalls_used_per_day * hours_per_stall_day
    )
    revenue_per_30day = revenue_per_day * 30                   # =B15*30
    # =B9*B11*B12*B13
    kwh_per_day = stalls_used_per_day * hours_per_stall_day * charger_rating_kw * avg_delivered_pct
    # =B16-(B17*B18*30)
    net_profit_month = revenue_per_30day - (kwh_per_day * utility_rate * 30)
    profit_per_year = net_profit_month * 12                    # =B19*12

    return LevelBaseline(
        level=level,
        ports=ports,
        nameplate_kw=nameplate_kw,
        derate=derate,
        stall_occupancy=stall_occupancy,
        stalls_used_per_day=stalls_used_per_day,
        charging_hourly_pct=charging_hourly_pct,
        hours_per_stall_day=hours_per_stall_day,
        charger_rating_kw=charger_rating_kw,
        avg_delivered_pct=avg_delivered_pct,
        retail_rate=retail_rate,
        revenue_per_day=revenue_per_day,
        revenue_per_30day=revenue_per_30day,
        kwh_per_day=kwh_per_day,
        utility_rate=utility_rate,
        net_profit_month=net_profit_month,
        profit_per_year=profit_per_year,
        out_of_service_share=unproductive_share,
        max_hours=max_hours,
    )


def reconcile(
    l2: LevelBaseline,
    l3: LevelBaseline,
    *,
    days_in_window: float,
    actual_revenue: float,
    findings: Findings | None = None,
    tolerance: float = 0.01,
) -> tuple[float, float]:
    """The check the specimen does at `Updated!B22` vs `C22`.

    Modelled revenue over the window should land within 1% of the revenue the
    utilization report actually recorded. Both are $92,358.23 in the specimen.

    What this does and does not catch
    ---------------------------------
    It is **not** a port-count check, despite looking like one. The chain
    cancels ports out entirely::

        stalls_used_per_day = ports * (J12 / ports)          = J12
        rating * delivered_pct = rating * (J14 / rating)     = J14

    so ``revenue_per_day`` reduces to ``J11 * J14 * J12 * J13``, which is pure
    `Historical Data`. Nameplate kW and the de-rate cancel the same way. Feed in
    a wrong port count and the revenue and profit rows come out identical - only
    the displayed occupancy percentage and the stall counts move.

    What it does catch is an internally inconsistent `Historical Data` sheet:
    someone overtyping one of the hardcoded constants in J12/J13/J14 without
    updating the rest. That is worth knowing about, because every figure in
    Section 3B is downstream of them.

    Port-count errors are caught separately, against the station-count note.
    """
    modelled = (l2.revenue_per_day + l3.revenue_per_day) * days_in_window
    if actual_revenue and findings is not None:
        drift = abs(modelled - actual_revenue) / actual_revenue
        if drift > tolerance:
            findings.warn(
                "baseline-reconciliation",
                f"The recomputed historical baseline implies "
                f"${modelled:,.0f} of revenue over the {days_in_window:,.0f}-day "
                f"window, but the sheet reports ${actual_revenue:,.0f} actually "
                f"collected - a {drift:.1%} difference. The Historical Data tab "
                "is internally inconsistent: the sessions, hours and delivered-"
                "power figures in J12 to J14 no longer agree with the revenue "
                "and kWh totals above them. Section 3B is printed as recomputed, "
                "but check that sheet before sending the proposal.",
                where=f"{HD}!J12:K14",
            )
    return modelled, actual_revenue


# Each level is matched on its own, because the note is not always written with
# both. A site with no DC fast chargers reads "actual site has 4 Level 2 station
# IDs in the report" and never mentions Level 3 at all.
_STATION_NOTE_RE = {
    "l2": re.compile(r"(\d+)\s*Level\s*2\b", re.IGNORECASE),
    "l3": re.compile(r"(\d+)\s*Level\s*3\b", re.IGNORECASE),
}


def check_port_counts(
    ws, ports: dict[str, float], findings: Findings
) -> None:
    """Sanity-check the operator's port counts against the note in `HD!I15`.

    The note reads like "actual site has 6 Level 2 and 5 Level 3 station IDs in
    the report", or just "4 Level 2 station IDs" when the site had no DC fast.

    It counts **stations, not ports**. A dual-connector unit is one station ID
    and two ports, so 4 stations against 8 ports is correct and must not warn.
    Only a count that is not a whole number of ports per station is suspicious:
    Showcase Liquor runs 4 stations / 8 ports (exactly 2 each, fine) while
    Food4Less was driven with 5 ports against 6 noted stations, which cannot be
    right whichever way the units are wired.

    Ports do not move the revenue or profit figures - they cancel out - but they
    do drive the stall-occupancy percentage Section 3B prints, so a wrong count
    produces a plausible-looking but wrong occupancy.
    """
    note = ws["I15"].value
    if not isinstance(note, str):
        return

    noted: dict[str, float] = {}
    for level, pattern in _STATION_NOTE_RE.items():
        match = pattern.search(note)
        if match:
            noted[level] = float(match.group(1))
    if not noted:
        return

    mismatched: list[str] = []
    for level in ("l2", "l3"):
        stations = noted.get(level)
        entered = ports.get(level) or 0
        if not stations or not entered:
            continue
        per_station = entered / stations
        if per_station.is_integer() and 1 <= per_station <= 2:
            continue          # 1 or 2 ports per station is normal hardware
        mismatched.append(
            f"{level.upper()}: {entered:g} ports entered against "
            f"{stations:g} station IDs ({per_station:.2f} ports per station)"
        )

    if mismatched:
        findings.warn(
            "port-count-disagrees-with-sheet",
            "The existing port counts entered do not divide evenly into the "
            "station count recorded on the Historical Data tab "
            f"({'; '.join(mismatched)}). A charger is one station ID with one "
            "or two ports, so this combination is not a normal configuration. "
            "It does not change the revenue or profit figures - they cancel out "
            "of the calculation - but it does change the stall-occupancy "
            "percentage Section 3B prints. Confirm which count is right.",
            where=f"{HD}!I15",
        )


# --------------------------------------------------------------------------
# reading Historical Data
# --------------------------------------------------------------------------


def parse_window(lw: LoadedWorkbook, spec: dict, findings: Findings) -> tuple[int, int]:
    """Which rows of `A4:G43` are the analysis window.

    Read from the *formulas*, not the data. `J4` is `=ROWS(A8:A42)` and `J5` is
    `=DATE(2026,6,30)-DATE(2023,8,1)+1`, so the window is recorded exactly.

    Guessing from the data does not work: the sheet carries 2021-12 and 2022-02
    stubs, a gap through 2023-05, and a trailing partial 2026-07 that still has
    $1,040 of revenue. "The last month with meaningful revenue" picks that
    partial and shifts the whole window by one.
    """
    formula = lw.formulas[HD]["J4"].value
    if isinstance(formula, str):
        match = _ROWS_RE.search(formula)
        if match:
            return int(match.group(1)), int(match.group(2))

    findings.warn(
        "history-window-guessed",
        f"Could not read the analysis window from {HD}!J4 (it holds "
        f"{formula!r}), so the longest run of consecutive months was used "
        "instead. Check the date range printed in Section 3.",
        where=f"{HD}!J4",
    )
    return _guess_window(lw, spec)


def _guess_window(lw: LoadedWorkbook, spec: dict) -> tuple[int, int]:
    """Fallback: longest run of months carrying revenue, honouring the count."""
    ws = lw.values[HD]
    months = int(lw.values[HD]["J4"].value or 0)
    first_data, last_data = 4, 43
    rows = [
        r for r in range(first_data, last_data + 1)
        if not is_missing(ws[f"A{r}"].value)
    ]
    if months and len(rows) >= months:
        # trailing partial excluded: end one row short of the last populated row
        end = rows[-1] - 1
        return end - months + 1, end
    return (rows[0], rows[-1]) if rows else (first_data, last_data)


def _month_label(value: Any) -> str:
    """`Historical Data!A` holds either a date or a `YYYY-MM` string."""
    import datetime as dt

    if isinstance(value, (dt.datetime, dt.date)):
        return value.strftime("%b %Y")
    text = str(value).strip()
    match = re.match(r"^(\d{4})-(\d{1,2})", text)
    if match:
        year, month = int(match.group(1)), int(match.group(2))
        return dt.date(year, month, 1).strftime("%b %Y")
    return text


def extract_history(
    lw: LoadedWorkbook, fm: dict, ctx: Context, operator_inputs: dict
) -> None:
    """Read `Historical Data`, then recompute Section 3B from it."""
    spec = fm["full_history"]
    formats = fm["meta"]["formats"]
    ws = lw.values[HD]
    cols = spec["anchor"]["value_cols"]

    # 3A table: one row per statistic, L2 in J and L3 in K.
    table_rows: list[dict[str, Any]] = []
    for entry in spec["rows"]:
        cell = entry["cell"]
        row_no = int(cell[1:])
        l2_value = ws[f"{cols['l2']}{row_no}"].value
        l3_value = ws[f"{cols['l3']}{row_no}"].value
        token = entry["token"]

        ctx.put(token, l2_value, fmt=entry.get("format"),
                source=f"{HD}!{cols['l2']}{row_no}", formats=formats)
        ctx.put(f"{token}_l3", l3_value, fmt=entry.get("format"),
                source=f"{HD}!{cols['l3']}{row_no}", formats=formats)

        table_rows.append({
            "label": str(ws[f"I{row_no}"].value or entry.get("label", token)).strip(),
            "l2": format_value(l2_value, entry.get("format"), formats),
            "l3": format_value(l3_value, entry.get("format"), formats),
        })
    ctx.tables["full_history"] = table_rows
    ctx.sources["full_history"] = f"{HD}!I4:K31"

    for entry in spec.get("extras", []):
        cell = entry["cell"]
        ctx.put(entry["token"], ws[cell].value, fmt=entry.get("format"),
                source=f"{HD}!{cell}", formats=formats)

    _extract_monthly_series(lw, spec, ctx, formats)
    _run_recompute(lw, fm, ctx, operator_inputs, formats)


def _extract_monthly_series(lw: LoadedWorkbook, spec: dict, ctx: Context, formats: dict) -> None:
    series_spec = spec["monthly_series"]
    ws = lw.values[HD]
    cols = series_spec["columns"]
    start, end = parse_window(lw, series_spec, ctx.findings)

    points: list[dict[str, Any]] = []
    for r in range(start, end + 1):
        month = ws[f"{cols['month']}{r}"].value
        if is_missing(month):
            continue
        points.append({
            "row": r,
            "month": month,
            "label": _month_label(month),
            "l2_rev": float(ws[f"{cols['l2_rev']}{r}"].value or 0),
            "l3_rev": float(ws[f"{cols['l3_rev']}{r}"].value or 0),
            "total_rev": float(ws[f"{cols['total_rev']}{r}"].value or 0),
            "total_kwh": float(ws[f"{cols['total_kwh']}{r}"].value or 0),
        })

    ctx.tables["monthly_series"] = points
    ctx.sources["monthly_series"] = f"{HD}!A{start}:G{end}"

    total = sum(p["total_rev"] for p in points)
    l3_total = sum(p["l3_rev"] for p in points)
    ctx.put("hist_total_revenue", total, fmt="currency0",
            source=f"{HD}!D{start}:D{end} summed", formats=formats)
    ctx.put("hist_l3_revenue", l3_total, fmt="currency0",
            source=f"{HD}!C{start}:C{end} summed", formats=formats)
    ctx.put("dcfc_revenue_share", (l3_total / total) if total else 0.0, fmt="percent0",
            source="hist_l3_revenue / hist_total_revenue", formats=formats)
    if points:
        ctx.put("history_window_label",
                f"{points[0]['label']} to {points[-1]['label']}",
                source=f"{HD}!A{start} to A{end}", formats=formats)

    ctx.put("outage_window_label", _outage_label(points),
            source=f"{HD}!C{start}:C{end}, months detected as an outage run",
            formats=formats)


def _outage_label(points: list[dict]) -> str:
    """Name the months where Level 3 revenue collapsed.

    Detected, not hardcoded: any run more than 80% below the trailing
    three-month mean. On the specimen this finds Jan and Feb 2026 without
    knowing those dates.
    """
    runs = detect_outage_runs(points)
    if not runs:
        return ""
    start, end = runs[0]
    if start == end:
        return points[start]["label"]
    return f"{points[start]['label']} and {points[end]['label']}" if end - start == 1 \
        else f"{points[start]['label']} to {points[end]['label']}"


def detect_outage_runs(points: list[dict], *, drop: float = 0.80, lookback: int = 3
                       ) -> list[tuple[int, int]]:
    """Index ranges where `l3_rev` fell more than `drop` below its trailing mean."""
    flagged: list[int] = []
    for i, point in enumerate(points):
        if i < lookback:
            continue
        window = [p["l3_rev"] for p in points[i - lookback:i]]
        mean = sum(window) / len(window)
        if mean > 0 and point["l3_rev"] < mean * (1 - drop):
            flagged.append(i)

    runs: list[tuple[int, int]] = []
    for i in flagged:
        if runs and i == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], i)
        else:
            runs.append((i, i))
    return runs


def _utility_rates(lw: LoadedWorkbook, spec: dict, ctx: Context,
                   formats: dict) -> dict[str, float]:
    """Per-level EV utility cost per kWh, read off the Updated sheet.

    It looks like a constant and is not: it is hand-entered per workbook, 0.40
    on Food4Less and Showcase Liquor but 0.2584 on Marriott Bakersfield. Assuming
    0.40 there understated Section 3B's annual profit by $5,467 while Section 5
    and the ten-year headline in the same document used the workbook's own
    figure.

    Found by LABEL, because the row is 18 under the legacy engine and 17 under
    the scenario grid. Both put L2 in column B and the first L3 column in C.
    """
    cfg = spec.get("utility_rate")
    if not isinstance(cfg, dict):
        rate = float(cfg) if cfg is not None else DEFAULT_UTILITY_RATE
        return {"l2": rate, "l3": rate}

    default = float(cfg.get("default", DEFAULT_UTILITY_RATE))
    sheet = cfg["sheet"]
    if sheet not in lw.values.sheetnames:
        return {"l2": default, "l3": default}

    ws = lw.values[sheet]
    row = find_label_row(ws, cfg["label"], label_col=cfg.get("label_col", "A"))
    low, high = cfg.get("sane_range", [0.01, 5.0])

    rates: dict[str, float] = {}
    for level, col in cfg["value_cols"].items():
        value = _as_float(ws[f"{col}{row}"].value) if row else None
        if value is None or not (low <= value <= high):
            value = default
            ctx.findings.warn(
                "utility-rate-unreadable",
                f"Could not read the {level.upper()} EV utility rate from "
                f"{sheet}, so Section 3B assumes ${default:.2f}/kWh. Check the "
                f"'{cfg['label']}' row - Section 3B's net profit is revenue "
                "less this rate, so a wrong value moves every figure in it.",
                where=f"{sheet}!{col}{row}" if row else sheet,
            )
        rates[level] = float(value)

    if row:
        # Emitted: Section 3B's totals header prints this rate, so it has to
        # render - and if it ever read as an Excel error the run must stop.
        ctx.put("hist_utility_rate_l2", rates["l2"], fmt="currency2",
                source=f"{sheet}!{cfg['value_cols']['l2']}{row}", formats=formats)
        ctx.put("hist_utility_rate_l3", rates["l3"], fmt="currency2",
                source=f"{sheet}!{cfg['value_cols']['l3']}{row}", formats=formats)
    return rates


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _run_recompute(
    lw: LoadedWorkbook, fm: dict, ctx: Context, operator_inputs: dict, formats: dict
) -> None:
    spec = fm["historical_baseline_recompute"]
    ws = lw.values[HD]
    derate = float(lw.values["INPUT SHEET"]["N11"].value or 1.0)
    max_hours = float(spec["inputs"].get("max_hours", DEFAULT_MAX_HOURS))
    utility_rates = _utility_rates(lw, spec, ctx, formats)

    # What the operator typed wins; otherwise fall back to what the workbook's
    # own historical column already recorded (see _prefill_existing_equipment).
    def existing(token: str, default: float | None = None) -> float:
        if operator_inputs.get(token) not in (None, ""):
            return _operator_number(operator_inputs, token, default)
        from_sheet = ctx.raw.get(token)
        if from_sheet not in (None, ""):
            return _operator_number({token: from_sheet}, token, default)
        return _operator_number({}, token, default)

    ports = {
        "l2": existing("existing_ports_l2"),
        "l3": existing("existing_ports_l3"),
    }
    nameplate = {
        "l2": existing("existing_nameplate_l2_kw", 7.2),
        "l3": existing("existing_nameplate_l3_kw", 50.0),
    }

    # At least one level must have ports. Requiring both would refuse a site
    # that only ever had Level 2 chargers, which is common - Showcase Liquor
    # ran four Level 2 units and no DC fast at all.
    if not ports["l2"] and not ports["l3"]:
        ctx.findings.warn(
            "baseline-ports-missing",
            "Section 3B needs the count of Level 2 and Level 3 ports that were "
            "already on site. Those numbers are in no sheet, so they have to be "
            "entered. Section 3B has been left out of this proposal.",
        )
        ctx.put("has_baseline", False, emit=False)
        return

    # A level with history but no port count is an input error, not an
    # empty level: the sheet recorded revenue for hardware the operator says
    # was not there.
    for level, col in (("l2", "J"), ("l3", "K")):
        recorded = float(ws[f"{col}6"].value or 0)
        if recorded > 0 and not ports[level]:
            ctx.findings.warn(
                "baseline-ports-contradict-history",
                f"The Historical Data tab records ${recorded:,.0f} of "
                f"{level.upper()} revenue, but no existing {level.upper()} "
                "ports were entered, so that level shows as zero throughout "
                "Section 3B. Enter the port count, or confirm the revenue "
                "belongs to the other level.",
                where=f"{HD}!{col}6",
            )

    levels: dict[str, LevelBaseline] = {}
    for key, col in (("l2", "J"), ("l3", "K")):
        levels[key] = recompute_level(
            level=key.upper(),
            ports=ports[key],
            nameplate_kw=nameplate[key],
            derate=derate,
            avg_stalls_used_day=float(ws[f"{col}12"].value or 0),
            avg_charging_hours=float(ws[f"{col}13"].value or 0),
            avg_delivered_kw=float(ws[f"{col}14"].value or 0),
            effective_rate=float(ws[f"{col}11"].value or 0),
            unproductive_share=float(ws[f"{col}26"].value or 0),
            max_hours=max_hours,
            utility_rate=utility_rates[key],
        )

    l2, l3 = levels["l2"], levels["l3"]
    yearly = l2.profit_per_year + l3.profit_per_year
    gross = (l2.revenue_per_30day + l3.revenue_per_30day) * 12

    ctx.put("has_baseline", True, emit=False)
    ctx.put("hist_profit_yearly", yearly, fmt="currency0",
            source="recomputed from Historical Data", formats=formats)
    ctx.put("hist_profit_3yr", yearly * 3, fmt="currency0",
            source="hist_profit_yearly x 3", formats=formats)
    ctx.put("hist_profit_5yr", yearly * 5, fmt="currency0",
            source="hist_profit_yearly x 5", formats=formats)
    ctx.put("hist_gross_yearly", gross, fmt="currency0",
            source="recomputed from Historical Data", formats=formats)
    ctx.put("existing_ports_l2", ports["l2"], fmt="integer",
            source="operator input", formats=formats)
    ctx.put("existing_ports_l3", ports["l3"], fmt="integer",
            source="operator input", formats=formats)

    ctx.raw["_baseline_l2"] = l2
    ctx.raw["_baseline_l3"] = l3
    ctx.tables["historical_baseline"] = _baseline_table(l2, l3, formats)

    reconcile(
        l2, l3,
        days_in_window=float(ws["J5"].value or 0),
        actual_revenue=float(ws["J6"].value or 0) + float(ws["K6"].value or 0),
        findings=ctx.findings,
    )
    check_port_counts(ws, ports, ctx.findings)


def _operator_number(supplied: dict, token: str, default: float | None = None) -> float:
    value = supplied.get(token, default)
    try:
        return float(value) if value not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _baseline_table(l2: LevelBaseline, l3: LevelBaseline, formats: dict) -> list[dict[str, str]]:
    """The Section 3B rows, in the order the reference prints them."""
    rows = [
        ("Chargers", "ports", "integer"),
        ("EV Stall Quantity (Based on # of ports)", "ports", "integer"),
        ("Max hours of operation of parking", "max_hours", "integer"),
        ("Stall Occupancy % (stalls seeing use each day)", "stall_occupancy", "percent1"),
        ("Number of stalls used per day", "stalls_used_per_day", "number2"),
        ("Charging Hourly % per stall per day", "charging_hourly_pct", "percent1"),
        ("Number of hours usage per stall per day", "hours_per_stall_day", "number2"),
        ("Charger Rating (kW, incl. de-rate)", "charger_rating_kw", "number2"),
        ("Avg Delivered Power (% of rating)", "avg_delivered_pct", "percent1"),
        ("Retail Revenue per kWhr", "retail_rate", "currency3"),
        ("Total Revenue per day", "revenue_per_day", "currency2"),
        ("Per 30 day Cycle", "revenue_per_30day", "currency2"),
        ("Total kWhr dispensed per day", "kwh_per_day", "number1"),
        ("EV Utility Rate average per kWhr", "utility_rate", "currency2"),
        ("Net Profit per Month", "net_profit_month", "currency2"),
        ("Total Profit per Year", "profit_per_year", "currency2"),
        ("Estimated share of station time out of service", "out_of_service_share", "percent0"),
    ]
    return [
        {
            "label": label,
            "l2": format_value(getattr(l2, attr), fmt, formats),
            "l3": format_value(getattr(l3, attr), fmt, formats),
        }
        for label, attr, fmt in rows
    ]
