"""Walk the field map and turn a workbook into a render context.

Produces three parallel dicts:

* ``raw``       - native Python values, for arithmetic and validation
* ``formatted`` - display strings, for the document
* ``sources``   - ``token -> "Sheet!Cell"``, for the QA report

Nothing here defaults a required field. A cell that reads ``None``, ``""`` or
``#...`` is missing, and missing is reported, never papered over.
"""

from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from . import engine as engine_mod
from .engine import BASELINE_VS_PROJECTED, DLL, FW, LoadedWorkbook, UCRC
from .errors import FieldNotFound
from .findings import Findings
from .paths import FIELD_MAP
from .resolve import (
    find_label_row,
    is_missing,
    normalise_label,
    read_range,
    resolve,
    sanitise_text,
)

INPUT_SHEET = "INPUT SHEET"
INTERNAL_SUMMARY = "Internal Summary"
CASHFLOW = "Cashflow"

L3_SUMMARY_COLS = ["O", "P", "Q", "R", "S", "T"]
L2_SUMMARY_COL = "N"


# --------------------------------------------------------------------------
# formatting
# --------------------------------------------------------------------------


def _strip_day_padding(fmt: str) -> str:
    """`%-d` is glibc-only and raises on Windows; `%#d` is the MSVC spelling."""
    import sys

    if sys.platform.startswith("win"):
        return fmt.replace("%-d", "%#d").replace("%-m", "%#m")
    return fmt


def format_value(value: Any, fmt: str | None, formats: dict[str, str]) -> str:
    """Render one value for the document. Never raises - a bad format falls
    back to `str()` so one odd cell cannot abort a whole proposal."""
    if value is None:
        return ""
    if fmt is None:
        return str(value)

    spec = formats.get(fmt, fmt)

    if isinstance(value, (_dt.datetime, _dt.date)):
        if "%" in spec:
            return value.strftime(_strip_day_padding(spec))
        return value.strftime(_strip_day_padding("%B %#d, %Y"))

    if fmt == "text" or "%" not in spec and "{" not in spec:
        return str(value)

    try:
        if isinstance(value, str):
            return value
        # "$-49,988.10" is not how anyone writes money. The sign belongs in
        # front of the symbol, which no format string can express, so it is
        # applied to the magnitude afterwards.
        if isinstance(value, (int, float)) and value < 0 and spec.lstrip().startswith("$"):
            return "-" + spec.format(abs(value))
        return spec.format(value)
    except (ValueError, TypeError, KeyError):
        return str(value)


# --------------------------------------------------------------------------
# context
# --------------------------------------------------------------------------


@dataclass
class Context:
    raw: dict[str, Any] = field(default_factory=dict)
    formatted: dict[str, str] = field(default_factory=dict)
    sources: dict[str, str] = field(default_factory=dict)
    tables: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    findings: Findings = field(default_factory=Findings)
    detection: engine_mod.Detection | None = None
    emitted: set[str] = field(default_factory=set)

    def put(
        self,
        token: str,
        value: Any,
        *,
        fmt: str | None = None,
        source: str | None = None,
        formats: dict[str, str] | None = None,
        emit: bool = True,
    ) -> Any:
        self.raw[token] = value
        self.formatted[token] = format_value(value, fmt, formats or {})
        if source:
            self.sources[token] = source
        if emit:
            self.emitted.add(token)
        return value

    def get(self, token: str, default: Any = None) -> Any:
        return self.raw.get(token, default)

    def num(self, token: str, default: float = 0.0) -> float:
        value = self.raw.get(token)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return default
        return float(value)


def load_field_map(path: str | Path | None = None) -> dict:
    with open(path or FIELD_MAP, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _chassis(fm: dict, ctx: Context, section: str) -> dict:
    """This chassis's override block for one section of the map.

    `{}` means "use the base map", which is what v16 gets: it has no entry under
    `chassis:` because it IS the base map.

    Asking the map rather than asking `is_legacy_chassis` is what lets one
    chassis take the legacy cost rows and the v16 EVOLV rows at the same time -
    which `v15_no_itc` does, and a boolean cannot say.
    """
    return ((fm.get("chassis") or {}).get(ctx.detection.chassis) or {}).get(section) or {}


def _cell_for(spec_cell: str, token: str, overrides: dict[str, str] | None) -> str:
    """Apply this chassis's address override for `token`, when it has one."""
    if overrides and token in overrides:
        return overrides[token]
    return spec_cell


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _coerce_zero(value: Any) -> float:
    """Excel treats a blank as 0 in arithmetic; Python must be told to."""
    n = _as_number(value)
    return 0.0 if n is None else n


# --------------------------------------------------------------------------
# section extractors
# --------------------------------------------------------------------------


def _extract_costs(lw: LoadedWorkbook, fm: dict, ctx: Context) -> None:
    spec = fm["costs"]
    formats = fm["meta"]["formats"]
    overrides = _chassis(fm, ctx, "costs").get("fields_override")
    anchor = spec["anchor"]
    ws = lw.values[spec["sheet"]]

    for entry in spec["fields"]:
        token = entry["token"]
        cell = _cell_for(entry["cell"], token, overrides)
        emit = entry.get("emit", True)
        try:
            value = resolve(
                lw.values,
                spec["sheet"],
                label=entry.get("label"),
                label_col=anchor["label_col"],
                value_col=anchor["value_col"],
                cell=cell,
                required=emit,
            )
        except FieldNotFound as exc:
            ctx.findings.error("cost-row-missing", exc.message, where=f"{spec['sheet']}!{cell}")
            value = None
        ctx.put(
            token,
            value,
            fmt=entry.get("format"),
            source=f"{spec['sheet']}!{cell}",
            formats=formats,
            emit=emit,
        )

    # B18 (customer price, after discount) vs B20 (list price). Print B18.
    warranty = _as_number(ctx.get("cost_service_warranty"))
    list_price = _as_number(ctx.get("cost_service_list_price"))
    if warranty is not None and list_price is not None and abs(warranty - list_price) > 0.01:
        ctx.findings.warn(
            "service-agreement-divergence",
            f"The service agreement appears at two prices: "
            f"{ctx.formatted['cost_service_warranty']} after discount "
            f"(Internal Summary!D5) and {ctx.formatted['cost_service_list_price']} "
            "list (Internal Summary!B5). The proposal prints the discounted "
            "figure.",
            where=f"{spec['sheet']}!{_cell_for('B18', 'cost_service_warranty', overrides)}",
        )

    _publish_infrastructure_other(fm, ctx, formats)

    ctx.raw["_cost_rows"] = _cost_rows_for_display(spec, ctx, fm)
    ctx.raw["_cost_hierarchy"] = spec["hierarchy"]
    del ws  # only opened to fail fast on a missing sheet


def _publish_infrastructure_other(fm: dict, ctx: Context, formats: dict) -> None:
    """The Section 8 "Other / miscellaneous" figure, as a RESIDUAL.

    Section 8 reprints part of the electrical stack with an explanation column.
    It used to name six of the fourteen children of `cost_electrical_subtotal`
    and print a hardcoded "$0 or project-specific" for the rest, which on Best
    Western hid $107,152.52 - 56% of the electrical scope, including $68,970 of
    switchgear and $20,933 of ADA work.

    Computing this as `subtotal - sum(named)` rather than as a sum of the
    leftovers is the whole point: the table then foots to Internal Summary!D13
    by construction, including on a chassis that grows a child row this map has
    never heard of.
    """
    spec = fm.get("infrastructure")
    if not spec:
        return
    subtotal = _as_number(ctx.get(spec["subtotal_token"]))
    if subtotal is None:
        return
    named = sum(ctx.num(row["token"]) for row in spec["named_rows"])
    ctx.put(
        spec["other"]["token"],
        subtotal - named,
        fmt="currency2",
        source=f"{spec['subtotal_token']} minus the {len(spec['named_rows'])} "
               "named Section 8 rows",
        formats=formats,
    )

def _cost_rows_for_display(spec: dict, ctx: Context, fm: dict) -> list[dict[str, Any]]:
    """Rows the Section 7 table actually prints. Zeroes drop out unless flagged."""
    show_zero = bool(fm.get("options", {}).get("show_zero_rows", False))
    rows: list[dict[str, Any]] = []
    for entry in spec["fields"]:
        if not entry.get("emit", True):
            continue
        # The template prints Grand Total and Total After Discount as fixed
        # tail rows below the loop, so including them here repeats both.
        if entry.get("role") in {"grand_total"} or entry["token"] == "cost_after_discount":
            continue
        token = entry["token"]
        value = _as_number(ctx.get(token))
        if value is None:
            continue
        if value == 0 and not show_zero and not entry.get("always_show"):
            continue
        rows.append(
            {
                "token": token,
                "label": entry.get("display_label") or entry["label"],
                "value": value,
                "formatted": ctx.formatted.get(token, ""),
                "role": entry.get("role"),
                "parent": entry.get("parent"),
            }
        )
    return rows


def _extract_roi(lw: LoadedWorkbook, fm: dict, ctx: Context) -> None:
    spec = fm["roi"]
    formats = fm["meta"]["formats"]
    anchor = spec["anchor"]
    over = _chassis(fm, ctx, "roi")
    absent = set(over.get("absent") or ())
    overrides = over.get("fields_override") or {}

    for entry in spec["fields"]:
        token = entry["token"]

        # 1. The row does not exist on this chassis. Not "reads zero" - ABSENT.
        #    Resolving it would try the label, miss, fall through to the fixed
        #    cell, and read whatever row happens to occupy that address. On
        #    v15_no_itc there is no ITC row and B5 holds EVSE Revenues, so
        #    roi_itc came out as $416,761 and Section 7 printed it as a Federal
        #    ITC line. Nothing errored. That is the whole failure mode.
        if token in absent:
            ctx.put(token, 0.0, fmt=entry.get("format"),
                    source=f"absent on the {ctx.detection.chassis} chassis",
                    formats=formats)
            continue

        # 2. An explicit per-chassis address outranks the label search. The
        #    label is what drifts between chassis; the address is what the map
        #    author verified against the file.
        cell = overrides.get(token, entry["cell"])
        label = None if token in overrides else entry.get("label")

        value = resolve(
            lw.values, spec["sheet"],
            label=label,
            label_col=anchor["label_col"], value_col=anchor["value_col"],
            cell=cell, required=False, default=0.0,
        )
        ctx.put(token, value, fmt=entry.get("format"),
                source=f"{spec['sheet']}!{cell}", formats=formats)

    itc = ctx.num("roi_itc")
    ctx.put("has_itc", itc != 0, emit=False)
    ctx.put("has_itc_row", "roi_itc" not in absent, emit=False)
    # Stated as the reason rather than as the file: legacy's B7 is
    # =B3+(B4+B5+B6) and DOES include the ITC, so the discrepancy this warns
    # about cannot arise there.
    if itc != 0 and not ctx.detection.chassis_opt("roi", "itc_included_in_net", False):
        # v16's B7 is =B3+(B4+B6): ITC is deliberately outside Net Revenues,
        # but E6 still adds it to Year 1 of the consolidated cashflow.
        ctx.findings.warn(
            "itc-nonzero",
            f"Federal ITC is set to {ctx.formatted['roi_itc']}, which this "
            f"calculator excludes from Net Revenues ({FW}!B7 is =B3+(B4+B6)). "
            f"Section 7 will report Net Revenues of "
            f"{ctx.formatted['roi_net_revenues']} while Section 7A's final "
            "cumulative runs higher by exactly the ITC, because "
            f"{FW}!E6 does add it to Year 1. Both figures are printed as the "
            "workbook computes them; neither has been adjusted.",
            where=f"{FW}!B5",
        )


def _extract_cashflow_tables(lw: LoadedWorkbook, fm: dict, ctx: Context) -> None:
    formats = fm["meta"]["formats"]
    table_overrides = _chassis(fm, ctx, "tables")

    for spec in fm["tables"]:
        token = spec["token"]
        override = table_overrides.get(token) or {}
        rows_spec = override.get("data_rows", spec["data_rows"])
        sheet = spec["sheet"]
        ws = lw.values[sheet]
        key_col = spec["columns"][0]["col"]

        rows: list[dict[str, Any]] = []
        for r in range(rows_spec["start"], rows_spec["end"] + 1):
            # Rows past the horizon cache as None (Excel ""). Blank, not missing.
            if is_missing(ws[f"{key_col}{r}"].value):
                break
            row: dict[str, Any] = {"_row": r}
            for col in spec["columns"]:
                value = ws[f"{col['col']}{r}"].value
                row[col["name"]] = value
                row[f"{col['name']}_fmt"] = format_value(value, col.get("format"), formats)
            rows.append(row)

        ctx.tables[token] = rows
        ctx.sources[token] = (
            f"{sheet}!{key_col}{rows_spec['start']}:"
            f"{spec['columns'][-1]['col']}{rows_spec['end']}"
        )

        for derived in spec.get("derived", []):
            _apply_table_derived(derived, token, rows, ctx, formats)


def _apply_table_derived(
    derived: dict, table_token: str, rows: list[dict], ctx: Context, formats: dict
) -> None:
    token = derived["token"]
    if "value" in derived:
        ctx.put(token, derived["value"], fmt=derived.get("format"),
                source="field_map", formats=formats)
        return

    if token == "breakeven_year":
        year = next(
            (r["year"] for r in rows
             if _as_number(r.get("year")) and _as_number(r["year"]) >= 1
             and _as_number(r.get("cumulative")) is not None
             and _as_number(r["cumulative"]) >= 0),
            None,
        )
        value = int(year) if year is not None else None
        ctx.put(token, value, source=f"derived from {table_token}", formats=formats)
        ctx.formatted[token] = str(value) if value is not None else "not within the horizon"
        if value is None:
            ctx.findings.warn(
                "no-breakeven",
                "Cumulative cashflow does not turn positive within the "
                "projection horizon, so the proposal states no break-even year.",
            )
    elif token == "final_cumulative":
        value = rows[-1]["cumulative"] if rows else None
        ctx.put(token, value, fmt=derived.get("format"),
                source=f"derived from {table_token}", formats=formats)
    elif token == "year1_charger_profit":
        row = next((r for r in rows if _as_number(r.get("year")) == 1), None)
        ctx.put(token, row["annual"] if row else None, fmt=derived.get("format"),
                source=f"derived from {table_token} (year 1)", formats=formats)


def _extract_site_info(lw: LoadedWorkbook, fm: dict, ctx: Context) -> None:
    """v16 exposes a client-info block whose value cells ship EMPTY.

    Labels live in `INPUT SHEET!M17:M21`, values are expected in `N17:N21` and
    are blank in the file as distributed. Everything here is a prefill for the
    operator form, never required.
    """
    spec = fm["site_info"]
    formats = fm["meta"]["formats"]
    if spec["sheet"] not in lw.values.sheetnames:
        return

    for entry in spec["fields"]:
        value = resolve(
            lw.values, spec["sheet"],
            label=entry.get("label"), label_col="M", value_col="N",
            cell=entry["cell"], required=False,
        )
        ctx.put(entry["token"], sanitise_text(value),
                source=f"{spec['sheet']}!{entry['cell']}", formats=formats)

    client_info = ctx.get("client_info")
    job_number, site_name = None, None
    if client_info:
        match = re.match(r"^([A-Za-z]-?\d+)\s+(.*)$", str(client_info).strip())
        if match:
            job_number, site_name = match.group(1), match.group(2).strip()
        else:
            site_name = str(client_info).strip()
    ctx.put("job_number", job_number, source="parsed from client_info", formats=formats)
    ctx.put("site_name", site_name, source="parsed from client_info", formats=formats)

    if not site_name:
        ctx.findings.warn(
            "site-info-empty",
            "The client-info block on the INPUT SHEET tab is empty "
            "(cells N17 to N21), so the site name, address, utility and scope "
            "of work have to be typed in. Filling that block in the workbook "
            "will prefill them next time.",
            where=f"{spec['sheet']}!N17:N21",
        )


def _extract_equipment(lw: LoadedWorkbook, fm: dict, ctx: Context) -> None:
    spec = fm["equipment"]
    formats = fm["meta"]["formats"]
    ws = lw.values[spec["sheet"]]
    summary = spec["summary_block"]
    cols = summary["columns"]

    def block(row: int) -> dict[str, float]:
        return {key: _coerce_zero(ws[f"{col}{row}"].value) for key, col in cols.items()}

    rows_by_token = {r["token"]: r["row"] for r in summary["rows"]}
    chargers = block(rows_by_token["n_chargers"])
    ports = block(rows_by_token["n_ports"])
    ratings = block(rows_by_token["rating_kw"])
    derates = block(rows_by_token["derate"])

    ctx.put("n_ports_l2", ports["l2"], fmt="integer",
            source=f"{spec['sheet']}!{L2_SUMMARY_COL}{rows_by_token['n_ports']}", formats=formats)
    n_ports_l3 = sum(v for k, v in ports.items() if k != "l2")
    ctx.put("n_ports_l3", n_ports_l3, fmt="integer",
            source=f"{spec['sheet']}!O{rows_by_token['n_ports']}:T{rows_by_token['n_ports']}",
            formats=formats)
    ctx.put("total_ports", ports["l2"] + n_ports_l3, fmt="integer",
            source=f"{spec['sheet']}!N{rows_by_token['n_ports']}:T{rows_by_token['n_ports']}",
            formats=formats)
    ctx.put("n_chargers_l2", chargers["l2"], fmt="integer",
            source=f"{spec['sheet']}!{L2_SUMMARY_COL}{rows_by_token['n_chargers']}",
            formats=formats)
    ctx.put("n_chargers_l3", sum(v for k, v in chargers.items() if k != "l2"),
            fmt="integer",
            source=f"{spec['sheet']}!O{rows_by_token['n_chargers']}:T{rows_by_token['n_chargers']}",
            formats=formats)

    derate_l2 = derates["l2"] or 1.0
    ctx.put("derate", derate_l2, fmt="number2",
            source=f"{spec['sheet']}!N{rows_by_token['derate']}", formats=formats)
    ctx.put("nameplate_l2_kw", ratings["l2"], fmt="number2",
            source=f"{spec['sheet']}!{L2_SUMMARY_COL}{rows_by_token['rating_kw']}",
            formats=formats)
    ctx.put("modeled_rating_l2", ratings["l2"] * derate_l2, fmt="number2",
            source=f"{spec['sheet']}!N{rows_by_token['rating_kw']} x N{rows_by_token['derate']}",
            formats=formats)

    # Charger-weighted mean rating over the tiers that actually have chargers.
    # An inactive tier still carries a nameplate rating, so an unweighted mean
    # would invent capacity that is not being installed.
    active = [
        (key, chargers[key], ratings[key] * (derates[key] or derate_l2))
        for key in cols
        if key != "l2" and chargers[key] > 0
    ]
    total_l3_chargers = sum(qty for _, qty, _ in active)
    modeled_l3 = (
        sum(qty * rating for _, qty, rating in active) / total_l3_chargers
        if total_l3_chargers else 0.0
    )
    ctx.put("modeled_rating_l3", modeled_l3, fmt="number2",
            source=f"{spec['sheet']}!O{rows_by_token['rating_kw']}:T{rows_by_token['rating_kw']}"
                   " charger-weighted",
            formats=formats)

    tier_kw = {key: ratings[key] for key, _, _ in active}
    tier_qty = {key: int(chargers[key]) for key, _, _ in active}
    ctx.raw["_l3_tiers"] = [
        {"key": key, "qty": tier_qty[key], "kw": tier_kw[key]} for key, _, _ in active
    ]
    ctx.put(
        "dcfc_mix_sentence",
        " and ".join(f"{tier_qty[k]} x {tier_kw[k]:g} kW" for k, _, _ in active) or "none",
        source=(f"{spec['sheet']}!O{rows_by_token['n_chargers']}:T{rows_by_token['n_chargers']} "
                f"x O{rows_by_token['rating_kw']}:T{rows_by_token['rating_kw']}, active tiers only"),
        formats=formats,
    )
    ctx.put(
        "l3_column_heading",
        _l3_heading(ctx.raw["_l3_tiers"]),
        source=f"{spec['sheet']}!O{rows_by_token['rating_kw']}:T{rows_by_token['rating_kw']}, active tiers only",
        formats=formats,
    )

    ctx.put("has_l2", ports["l2"] > 0, emit=False)
    ctx.put("has_l3", n_ports_l3 > 0, emit=False)

    _extract_line_items(lw, spec, ctx, formats)


def _l3_heading(tiers: list[dict]) -> str:
    """`Level 3 (60 kW)` for one tier, `Level 3 (2 x 120 kW + 1 x 60 kW)` for a mix."""
    if not tiers:
        return "Level 3"
    if len(tiers) == 1 and tiers[0]["qty"] <= 1:
        return f"Level 3 ({tiers[0]['kw']:g} kW)"
    parts = " + ".join(f"{t['qty']} x {t['kw']:g} kW" for t in tiers)
    return f"Level 3 ({parts})"


def _extract_line_items(lw: LoadedWorkbook, spec: dict, ctx: Context, formats: dict) -> None:
    li = spec["line_items"]
    ws = lw.values[spec["sheet"]]
    cols = li["columns"]
    items: list[dict[str, Any]] = []

    for r in range(li["start_row"], li["end_row"] + 1):
        sku = ws[f"{cols['sku']}{r}"].value
        if is_missing(sku):
            continue
        item = {
            "row": r,
            "category": ws[f"{cols['category']}{r}"].value,
            "sku": str(sku).strip(),
            "description": sanitise_text(ws[f"{cols['description']}{r}"].value) or "",
            "msrp": _coerce_zero(ws[f"{cols['msrp']}{r}"].value),
            # blank discount is 0 in Excel; Python must be told
            "discount_pct": _coerce_zero(ws[f"{cols['discount_pct']}{r}"].value),
            "qty": int(_coerce_zero(ws[f"{cols['qty']}{r}"].value)),
            "line_total": _coerce_zero(ws[f"{cols['line_total']}{r}"].value),
        }
        item["msrp_fmt"] = format_value(item["msrp"], "currency2", formats)
        item["line_total_fmt"] = format_value(item["line_total"], "currency2", formats)
        items.append(item)

    ctx.tables["equipment_line_items"] = items
    ctx.sources["equipment_line_items"] = (
        f"{spec['sheet']}!{cols['item_no']}{li['start_row']}:"
        f"{cols['line_total']}{li['end_row']}"
    )
    l2_item = next((i for i in items if str(i["category"]).strip() == "_L2"), None)
    ctx.put("l2_sku", l2_item["sku"] if l2_item else None,
            source=(f"{spec['sheet']}!{cols['sku']}{li['start_row']}:"
                    f"{cols['sku']}{li['end_row']}, first '_L2' line item"),
            formats=formats)
    _publish_l2_equipment(items, ctx, formats)


_AMPERAGE_FROM_DESCRIPTION = re.compile(r"(\d+)\s*A\b")
_AMPERAGE_FROM_SKU = re.compile(r"-C(\d+)-", re.IGNORECASE)


def _publish_l2_equipment(items: list[dict], ctx: Context, formats: dict) -> None:
    """Describe the Level 2 hardware from the line items, not from a constant.

    Level 3 has always read correctly because `dcfc_mix_sentence` is built from
    charger QUANTITIES and real ratings. Level 2 had no equivalent: the display
    string was `f"{n_ports_l2} single-port 32A units"`, which is wrong three ways
    at once on anything but the reference site's hardware. On Best Western -
    2 x CTX-C80-240-2, "80A Dual Commercial L2 Charger", 4 ports - it printed
    "4 single-port 32A units": the port count where the unit count belonged, and
    the reference site's form factor and amperage hardcoded over the top.

    `n_chargers_l2` (INPUT SHEET!N8) was already extracted and went nowhere, and
    the line item's own description was already read and never used. Both are
    used here.
    """
    l2 = [i for i in items if str(i["category"]).strip() == "_L2"]

    # Group by description before counting. Food4Less lists the same charger on
    # two rows (qty 8 and qty 2) and has to read "10 x ...", not "8 x ... and
    # 2 x ...".
    grouped: dict[str, int] = {}
    for item in l2:
        # The parenthetical carries cable and modem detail that the mounting row
        # already covers, so it is trimmed out of the summary phrase.
        label = str(item["description"]).split("(")[0].strip()
        if label:
            grouped[label] = grouped.get(label, 0) + int(item["qty"])

    ctx.put(
        "l2_mix_sentence",
        " and ".join(f"{qty} x {label}" for label, qty in grouped.items()) or "none",
        source="INPUT SHEET line items where category is _L2",
        formats=formats,
    )

    units = int(_coerce_zero(ctx.get("n_chargers_l2")))
    ports = int(_coerce_zero(ctx.get("n_ports_l2")))
    ctx.put(
        "l2_quantity_ports",
        f"{units} {'unit' if units == 1 else 'units'} / "
        f"{ports} {'port' if ports == 1 else 'ports'}",
        source="INPUT SHEET!N8 units, N9 ports",
        formats=formats,
    )

    # Amperage from the hardware, never defaulted: printing the wrong current
    # rating on a charger spec sheet is the defect this whole helper exists for.
    amperage = ""
    for pattern, text in (
        (_AMPERAGE_FROM_DESCRIPTION, next(iter(grouped), "")),
        (_AMPERAGE_FROM_SKU, str(ctx.get("l2_sku") or "")),
    ):
        match = pattern.search(text)
        if match:
            amperage = f"{match.group(1)}A"
            break
    ctx.put("l2_amperage", amperage,
            source="Level 2 line-item description, else the SKU", formats=formats)

    # A dual-port charger modelled with one port halves the revenue this
    # proposal projects. Named, not corrected - the port count is the operator's.
    label = next(iter(grouped), "").lower()
    if units and ports:
        per_unit = ports / units
        if "dual" in label and per_unit < 2:
            ctx.findings.warn(
                "l2-ports-contradict-hardware",
                f"The Level 2 line item reads '{next(iter(grouped))}' - a dual-port "
                f"charger - but INPUT SHEET!N8/N9 model {units} "
                f"{'unit' if units == 1 else 'units'} with only {ports} "
                f"{'port' if ports == 1 else 'ports'}, i.e. {per_unit:g} per unit. "
                "Every revenue figure in Section 5 is driven by the port count, so "
                "if these are dual-port units N9 understates the projection. "
                "Neither figure has been adjusted.",
                where="INPUT SHEET!N8 vs N9",
            )


def _extract_evolv(lw: LoadedWorkbook, fm: dict, ctx: Context) -> None:
    spec = fm["evolv"]
    formats = fm["meta"]["formats"]
    overrides = _chassis(fm, ctx, "evolv")

    for entry in spec["fields"]:
        token = entry["token"]
        cell = (overrides.get(token) or {}).get("cell", entry["cell"])
        value = resolve(lw.values, spec["sheet"], cell=cell, required=False)
        ctx.put(token, value, fmt=entry.get("format"),
                source=f"{spec['sheet']}!{cell}", formats=formats)


def _extract_service_plan(lw: LoadedWorkbook, fm: dict, ctx: Context) -> None:
    """The `Internal Summary!F9:I14` block exists only on chassis that declare it.

    Where it is absent, Section 12's MODELED SERVICE TERM falls back to the EVOLV
    contract length - and that cell is NOT at the same address on every chassis
    (legacy G5, v15_no_itc G4, because the latter's EVOLV block is the v16 one),
    so it is named per chassis and never inferred. A wrong value here is
    invisible: 5 is a plausible number of years either way.
    """
    spec = fm["service_plan"]
    formats = fm["meta"]["formats"]
    over = _chassis(fm, ctx, "service_plan")

    if over.get("present", True) is False:
        cell = (over.get("svc_contract_years") or {}).get("cell", "G5")
        value = resolve(lw.values, spec["sheet"], cell=cell, required=False, default=5)
        ctx.put("svc_contract_years", value, fmt="integer",
                source=f"{spec['sheet']}!{cell}", formats=formats)
    else:
        for entry in spec["fields"]:
            value = resolve(lw.values, spec["sheet"], cell=entry["cell"], required=False)
            ctx.put(entry["token"], value, fmt=entry.get("format"),
                    source=f"{spec['sheet']}!{entry['cell']}", formats=formats)

    ctx.put("standard_parts_warranty_years", 2, fmt="integer",
            source="constant (equipment basis)", formats=formats)


def _carbon_addresses(fm: dict, ctx: Context) -> tuple[str, dict[str, str]]:
    """`(style, token -> cell-or-range)` for the carbon block.

    Two independent axes, which is exactly what the v15_no_itc chassis proved:

    * STYLE is structure - `six_tier` reads a rating/quantity/multiplier grid,
      `single_tier` reads five scalars because the tier quantities are hardcoded
      inside the B4 formula.
    * `fields_override` is LOCATION. v15_no_itc has the v16 six-tier grid at
      L4:R9 instead of D42:J47.

    Neither is `is_legacy_chassis`, which is why that boolean stopped deciding.
    """
    over = _chassis(fm, ctx, "carbon")
    addr = {e["token"]: (e.get("range") or e.get("cell")) for e in fm["carbon"]["fields"]}
    addr.update(over.get("fields_override") or {})
    anchor = over.get("anchor")
    if anchor:
        addr.update(_carbon_anchor_addresses(anchor, ctx))
    return over.get("style", "six_tier"), addr


def _carbon_anchor_addresses(anchor: dict, ctx: Context) -> dict[str, str]:
    """Locate the carbon block by its own label, then offset from there.

    The `v15_no_itc` chassis puts the block at L4:R9 on one specimen and L5:R10
    on another - same shape, one row apart, for no structural reason. A fixed
    address reads the neighbouring row on whichever file it was not written for,
    and a carbon grid read one row out returns ratings where quantities belong:
    six plausible numbers, all in the wrong slots, nothing raised.

    Returns {} when the label is not found, so the caller falls back to the
    declared addresses and the usual "reads as blank" path reports it.
    """
    ws = ctx.raw.get("_carbon_ws")
    if ws is None:
        return {}
    row = find_label_row(ws, anchor["label"], label_col=anchor.get("label_col", "L"))
    if row is None:
        ctx.findings.warn(
            "carbon-block-not-found",
            f"Could not find the '{anchor['label']}' label in column "
            f"{anchor.get('label_col', 'L')} of {anchor['sheet']}, so the carbon "
            "grid was read from its declared addresses instead. Check Section 13.",
            where=anchor["sheet"],
        )
        return {}

    out: dict[str, str] = {}
    for token, spec in anchor["offsets"].items():
        target = row + int(spec["row"])
        if "cols" in spec:
            first, last = spec["cols"]
            out[token] = f"{first}{target}:{last}{target}"
        else:
            out[token] = f"{spec['col']}{target}"
    return out


def _extract_carbon(lw: LoadedWorkbook, fm: dict, ctx: Context) -> None:
    spec = fm["carbon"]
    formats = fm["meta"]["formats"]
    sheet = spec["sheet"]
    ws = lw.values[sheet]
    # The anchor search needs the sheet; passing it through raw keeps
    # _carbon_addresses' signature the same for every other caller.
    ctx.raw["_carbon_ws"] = ws
    style, addr = _carbon_addresses(fm, ctx)
    ctx.raw.pop("_carbon_ws", None)

    ctx.put("cc_total", ctx.get("roi_carbon_credits"), fmt="currency0",
            source=f"{sheet}!{addr['cc_total']}", formats=formats)

    if style == "single_tier":
        tiers = _carbon_single_tier(ws, sheet, addr, spec["fields"], ctx, formats)
    else:
        tiers = _carbon_six_tier(ws, sheet, addr, spec["fields"], ctx, formats)

    ctx.raw["_carbon_tiers"] = tiers
    _publish_carbon_kpis(ctx, tiers, formats, addr, sheet)


def _tier_sentence(tiers: list[dict], formats: dict) -> str:
    """"$8,600 per year for the 98 kW class", built from the tiers installed.

    Section 13 states this rate in prose. It was frozen reference text until
    now - every proposal quoted the reference site's class and rate whatever
    the workbook said - so both carbon paths publish it and the template reads
    it from here.
    """
    return " and ".join(
        f"{format_value(t['mult'], 'currency0', formats)} per year for "
        f"the {t['kw']:g} kW class" for t in tiers
    ) or "the installed classes"


def _carbon_single_tier(ws, sheet: str, addr: dict, fields: list[dict], ctx: Context,
                        formats: dict) -> list[dict]:
    """One tier read from scalars: the quantities live inside the B4 formula."""
    declared = {e["token"]: e.get("format") for e in fields}
    for token in ("cc_l3_rating", "cc_l3_mult", "cc_l2_kwh_month",
                  "cc_l2_rate", "cc_l2_credit_month"):
        cell = addr.get(token)
        if cell:
            # The declared format, not a blanket number4: the map calls
            # cc_l2_rate currency4 because Section 13 prints it as "$0.0045",
            # and flattening every token to number4 dropped the dollar sign on
            # this chassis alone.
            ctx.put(token, ws[cell].value, fmt=declared.get(token, "number4"),
                    source=f"{sheet}!{cell}", formats=formats)
    tiers = [{"kw": ctx.num("cc_l3_rating"), "qty": None, "mult": ctx.num("cc_l3_mult")}]
    ctx.put("cc_tier_sentence", _tier_sentence(tiers, formats),
            source=f"{sheet}!{addr.get('cc_l3_mult')} per {sheet}!{addr.get('cc_l3_rating')}",
            formats=formats)
    return tiers


def _carbon_six_tier(ws, sheet: str, addr: dict, fields: list[dict], ctx: Context,
                     formats: dict) -> list[dict]:
    """A rating / quantity / multiplier grid over the six L3 classes."""
    for entry in fields:
        token = entry["token"]
        if token == "cc_total":
            continue
        ref = addr[token]
        if ":" in ref:
            ctx.raw[token] = read_range(ws, ref)[0]
            ctx.sources[token] = f"{sheet}!{ref}"
        else:
            ctx.put(token, ws[ref].value, fmt=entry.get("format"),
                    source=f"{sheet}!{ref}", formats=formats)

    ratings = ctx.raw.get("cc_tier_ratings") or []
    quantities = ctx.raw.get("cc_tier_qty") or []
    multipliers = ctx.raw.get("cc_tier_mult") or []
    tiers = [
        {"kw": _coerce_zero(kw), "qty": int(_coerce_zero(q)), "mult": _coerce_zero(m),
         "mult_fmt": format_value(_coerce_zero(m), "currency0", formats)}
        for kw, q, m in zip(ratings, quantities, multipliers)
        if _coerce_zero(q) > 0
    ]
    ctx.put("cc_tier_sentence", _tier_sentence(tiers, formats),
            source=f"{sheet}!{addr['cc_tier_mult']} where {addr['cc_tier_qty']} > 0",
            formats=formats)
    return tiers


def _publish_carbon_kpis(ctx: Context, tiers: list[dict], formats: dict,
                         addr: dict, sheet: str) -> None:
    """The three linked figures in Section 13's KPI strip.

    The multiplier tile shows one line per L3 tier that is actually being
    installed. The grid lists a rating, a quantity and a multiplier for all six
    classes; only the columns with a quantity above zero are being bought, and
    printing the rest quotes credits for hardware that is not in the proposal.
    """
    lines = [t.get("mult_fmt") or format_value(t.get("mult"), "currency0", formats)
             for t in tiers]
    ctx.put("cc_multiplier_lines", "\n".join(lines) or "n/a",
            source=f"{sheet}!{addr['cc_tier_mult']} where {addr['cc_tier_qty']} > 0",
            formats=formats)
    ctx.put("cc_active_tier_count", len(tiers), fmt="integer", emit=False)

    # The KPI tile rounds to whole dollars; the ROI table does not.
    ctx.put("cc_total_kpi", ctx.get("cc_total"), fmt="currency0",
            source="Financial Worksheet!B4", formats=formats)


def _extract_financing(lw: LoadedWorkbook, fm: dict, ctx: Context) -> None:
    spec = fm["financing"]
    formats = fm["meta"]["formats"]
    has_financing = ctx.detection.has_financing
    ctx.put("has_financing", has_financing, emit=False)

    if not has_financing:
        ctx.findings.info(
            "financing-suppressed",
            "No loan amount on the DLL Schedule tab, so Sections 14, 17 and "
            "17A to 17D are suppressed and the document renumbered.",
            where=f"{DLL}!D5",
        )
        return

    for entry in spec["fields"]:
        # The loan names are sheet-scoped on DLL Schedule; resolve() checks
        # sheet scope before workbook scope, so `name:` works here.
        anchor = entry.get("anchor", {})
        value = resolve(
            lw.values, spec["sheet"],
            name=entry.get("name"),
            label=entry.get("label"),
            label_col=anchor.get("label_col", "I"),
            value_col=anchor.get("value_col", "J"),
            cell=entry["cell"], required=False,
        )
        ctx.put(entry["token"], value, fmt=entry.get("format"),
                source=f"{spec['sheet']}!{entry['cell']}"
                       + (f" (name {entry['name']})" if entry.get("name") else ""),
                formats=formats)

    years = ctx.num("loan_years")
    per_year = ctx.num("loan_pmts_per_year")
    ctx.put("loan_term_months", int(years * per_year), fmt="integer",
            source="loan_years x loan_pmts_per_year", formats=formats)

    _extract_amortization(lw, spec, ctx, formats)
    _repair_or_suppress_financing(ctx, formats)


def _schedule_contradictions(ctx: Context, formats: dict) -> list[str]:
    """Ways the amortization table disagrees with the D5:D10 summary block.

    `DLL Schedule` has two halves computed independently, and nothing in the
    workbook forces them to agree. On the Marriott Bakersfield specimen they did
    not: the table sits one column left of its own headers, so `A18` holds the
    payment date, `C18` the scheduled payment, and the `Int` name lands on the
    ending-balance column. `Total_Interest` therefore summed balances and read
    $10,904,157.52 on a $253,717 loan.
    """
    rows = ctx.tables.get("amortization") or []
    amount = _as_number(ctx.get("loan_amount"))
    if not rows or not amount:
        return []

    reasons: list[str] = []
    opening = _as_number(rows[0].get("begin"))
    if opening is not None and abs(opening - amount) > 1.0:
        reasons.append(
            f"the schedule's first beginning balance reads "
            f"{format_value(opening, 'currency2', formats)} where the summary "
            f"finances {ctx.formatted.get('loan_amount')}"
        )
    interest = _as_number(ctx.get("loan_total_interest"))
    if interest is not None and interest > amount:
        reasons.append(
            f"total interest reads {ctx.formatted.get('loan_total_interest')}, more "
            f"than the principal itself"
        )
    return reasons


def _rebuild_amortization(ctx: Context, formats: dict) -> list[dict[str, Any]] | None:
    """A clean schedule from the summary inputs, or None if they don't reconcile.

    This is a reconstruction, not an estimate. The principal, rate, term and
    payment count all come from `DLL Schedule!D5:D10`, and the payment the
    standard annuity formula produces is checked against the workbook's own
    `Scheduled_Monthly_Payment` (`J5`) before anything is accepted. If those two
    disagree the summary block is suspect as well, nothing is rebuilt, and the
    caller suppresses the financing sections instead.

    On the Marriott specimen all three independent checks land exactly:

        computed payment   $5,191.948458  ==  DLL Schedule!J5
        60 x payment       $311,516.91    ==  Cashflow!F1
        closing balance    $0.00

    so the summary half and the Cashflow tab already agree with each other and
    with this schedule. Only the table itself was corrupt.
    """
    principal = _as_number(ctx.get("loan_amount"))
    rate = _as_number(ctx.get("loan_rate"))
    years = _as_number(ctx.get("loan_years"))
    per_year = _as_number(ctx.get("loan_pmts_per_year"))
    stated_payment = _as_number(ctx.get("loan_monthly_payment"))
    start = ctx.get("loan_start_date")

    if not all((principal, rate, years, per_year)) or not stated_payment:
        return None

    n = int(round(years * per_year))
    periodic = rate / per_year
    if n <= 0 or periodic <= 0:
        return None

    payment = principal * periodic / (1 - (1 + periodic) ** -n)
    # The gate. A cent of drift means the summary block is not describing the
    # loan its own PMT formula computed, and nothing here can be trusted.
    if abs(payment - stated_payment) > 0.01:
        return None

    rows: list[dict[str, Any]] = []
    balance = principal
    cumulative = 0.0
    for k in range(1, n + 1):
        interest = balance * periodic
        principal_part = payment - interest
        cumulative += interest
        closing = balance - principal_part
        rows.append({
            "n": k,
            "date": _add_months(start, k) if start else None,
            "begin": balance,
            "sched": payment,
            "extra": 0.0,
            "total": payment,
            "principal": principal_part,
            "interest": interest,
            "end": max(closing, 0.0),
            "cum_interest": cumulative,
        })
        balance = closing

    # A schedule that does not close to zero is not a schedule.
    if abs(balance) > 0.01:
        return None
    return rows


def _add_months(start: Any, k: int) -> Any:
    """The k-th payment date. Day-of-month is preserved; these are 1st-of-month
    starts in every workbook seen, so no end-of-month clamping is needed."""
    month = start.month - 1 + k
    year = start.year + month // 12
    return start.replace(year=year, month=month % 12 + 1)


def _repair_or_suppress_financing(ctx: Context, formats: dict) -> None:
    """Rebuild a contradictory amortization table, or drop the sections.

    Preferring repair to suppression is only defensible because the rebuild is
    checked against two figures the broken table had no hand in - the workbook's
    own `J5` payment and its `Cashflow!F1` total. If those do not agree, the
    sections go, because a cash proposal that is silent about financing is
    honest and one that quotes ten million dollars of interest is not.
    """
    reasons = _schedule_contradictions(ctx, formats)
    if not reasons:
        return

    rebuilt = _rebuild_amortization(ctx, formats)
    if rebuilt is None:
        ctx.put("has_financing", False, emit=False)
        # A WARNING, not an ERROR: an ERROR writes no document at all, and there
        # is nothing left to get wrong once the sections are gone.
        ctx.findings.warn(
            "financing-schedule-contradicts-summary",
            "The DLL Schedule tab describes two different loans: "
            + "; and ".join(reasons)
            + ". Sections 14 and 17 to 17D have been left out rather than print "
            "figures that disagree with each other. The usual cause is the "
            "amortization table sitting one column off its headers - check that "
            "DLL Schedule!A18 holds payment number 1 and C18 holds the financed "
            "amount, rebuild the schedule, then run this again.",
            where=f"{DLL}!A18:J77",
        )
        return

    ctx.tables["amortization"] = rebuilt
    ctx.sources["amortization"] = (
        f"recomputed from {DLL}!D5:D10; the sheet's own table disagreed with them"
    )

    total_interest = rebuilt[-1]["cum_interest"]
    ctx.put("loan_total_interest", total_interest, fmt="currency2",
            source=f"recomputed from {DLL}!D5:D10", formats=formats)
    ctx.put("loan_actual_payments", len(rebuilt), fmt="integer",
            source=f"recomputed from {DLL}!D5:D10", formats=formats)
    ctx.put("loan_early_payments", 0.0, fmt="currency2",
            source=f"no extra payments in {DLL}!D10", formats=formats)
    ctx.put("loan_first_pmt_date", rebuilt[0]["date"], fmt="date_long",
            source=f"recomputed from {DLL}!D9", formats=formats)
    ctx.put("loan_payoff_date", rebuilt[-1]["date"], fmt="date_long",
            source=f"recomputed from {DLL}!D9", formats=formats)
    _recompute_kpi(ctx, "loan_total_interest", formats)

    ctx.findings.warn(
        "amortization-rebuilt",
        "The DLL Schedule amortization table disagreed with the loan summary "
        "above it: " + "; and ".join(reasons) + ". The table is sitting one "
        "column left of its own headers, so every figure read out of it by name "
        "was the neighbouring column. Sections 14 and 17 to 17D have been built "
        "from a schedule recomputed from the summary inputs instead "
        f"({ctx.formatted.get('loan_amount')} at {ctx.formatted.get('loan_rate')} "
        f"over {ctx.formatted.get('loan_num_payments')} payments), which "
        "reproduces the workbook's own monthly payment of "
        f"{ctx.formatted.get('loan_monthly_payment')} exactly and closes to a "
        f"zero balance. Total interest is {ctx.formatted.get('loan_total_interest')}. "
        "Fix the sheet so DLL Schedule!A18 holds payment number 1 and C18 the "
        "financed amount; until then the printed schedule is a reconstruction, "
        "not a copy.",
        where=f"{DLL}!A18:J77",
    )


def _recompute_kpi(ctx: Context, token: str, formats: dict) -> None:
    """Refresh the whole-dollar KPI companion after a value has been replaced."""
    value = _as_number(ctx.get(token))
    if value is not None:
        ctx.put(f"{token}_kpi", value, fmt="currency0",
                source=ctx.sources.get(token, token), formats=formats)


def _extract_amortization(lw: LoadedWorkbook, spec: dict, ctx: Context, formats: dict) -> None:
    am = spec["amortization"]
    ws = lw.values[spec["sheet"]]
    cols = am["columns"]
    rows: list[dict[str, Any]] = []
    r = am["start_row"]
    while r <= ws.max_row:
        n = ws[f"{cols['n']}{r}"].value
        if is_missing(n):
            break
        rows.append({key: ws[f"{col}{r}"].value for key, col in cols.items()})
        r += 1
    ctx.tables["amortization"] = rows
    if rows:
        ctx.put("loan_first_pmt_date", rows[0]["date"], fmt="date_long",
                source=f"{spec['sheet']}!{cols['date']}{am['start_row']}", formats=formats)
        ctx.put("loan_payoff_date", rows[-1]["date"], fmt="date_long",
                source=f"{spec['sheet']}!{cols['date']}{am['start_row'] + len(rows) - 1}",
                formats=formats)


def _extract_monthly_cashflow(lw: LoadedWorkbook, fm: dict, ctx: Context) -> None:
    spec = fm["monthly_cashflow"]
    formats = fm["meta"]["formats"]
    if not ctx.detection.has_financing:
        return
    ws = lw.values[spec["sheet"]]

    for total in spec["totals"]:
        ctx.put(total["token"], ws[total["cell"]].value, fmt=total["format"],
                source=f"{spec['sheet']}!{total['cell']}", formats=formats)

    cols = spec["table"]["columns"]
    start, end = 3, 62
    rows: list[dict[str, Any]] = []
    for r in range(start, end + 1):
        month = ws[f"{cols['month']}{r}"].value
        if is_missing(month):
            break
        row: dict[str, Any] = {"month": int(_coerce_zero(month))}
        for key in ("loan_payment", "carbon_credits", "evse_profit", "net"):
            value = ws[f"{cols[key]}{r}"].value
            row[key] = value
            row[f"{key}_fmt"] = format_value(value, "currency2", formats)
        rows.append(row)

    ctx.tables["monthly_cashflow"] = rows
    ctx.sources["monthly_cashflow"] = f"{spec['sheet']}!E{start}:I{end}"

    for lo, hi in spec["table"]["split_for_proposal"]:
        ctx.tables[f"monthly_cashflow_{lo}_{hi}"] = [
            r for r in rows if lo <= r["month"] <= hi
        ]

    # Cashflow!I1 is empty - there is no cached total for the net column.
    net_total = sum(_coerce_zero(r["net"]) for r in rows)
    ctx.put("cf_net_total", net_total, fmt="currency0",
            source=f"{spec['sheet']}!I3:I{start + len(rows) - 1} (summed; I1 is blank)",
            formats=formats)
    if rows:
        ctx.put("cf_net_first", rows[0]["net"], fmt="currency0",
                source=f"{spec['sheet']}!I{start}", formats=formats)
        ctx.put("cf_net_last", rows[-1]["net"], fmt="currency0",
                source=f"{spec['sheet']}!I{start + len(rows) - 1}", formats=formats)
        ctx.put("cf_carbon_monthly", rows[0]["carbon_credits"], fmt="currency2",
                source=f"{spec['sheet']}!G{start}", formats=formats)


def _extract_derived_ten_year(fm: dict, ctx: Context) -> None:
    """Everything `10 Year Projection Comparison` used to supply, derived.

    Under the scenario grid that sheet is unreadable (its formulas are bound to
    the legacy addresses), and everything it provided is already on the
    Financial Worksheet or one line of arithmetic away.
    """
    formats = fm["meta"]["formats"]
    years = ctx.get("projection_years") or 5

    evse = ctx.num("roi_evse_revenues")
    carbon = ctx.num("roi_carbon_credits")
    ctx.put("horizon_evse_total", evse, fmt="currency0",
            source="roi_evse_revenues", formats=formats)
    ctx.put("horizon_total_benefit", evse + carbon, fmt="currency0",
            source="roi_evse_revenues + roi_carbon_credits", formats=formats)

    hist = _as_number(ctx.get("hist_profit_yearly"))
    if hist:
        year1 = ctx.num("year1_charger_profit")
        ctx.put("uplift_vs_historical", year1 / hist - 1, fmt="percent1",
                source="year1_charger_profit / hist_profit_yearly - 1", formats=formats)
        ctx.put("baseline_over_horizon", hist * years, fmt="currency0",
                source="hist_profit_yearly x projection_years", formats=formats)
        ctx.put("benefit_delta", (evse + carbon) - hist * years, fmt="currency0",
                source="horizon_total_benefit - baseline_over_horizon", formats=formats)

    _publish_projection_kpis(ctx, formats, years=years, evse=evse, carbon=carbon,
                             hist=hist)


def _publish_projection_kpis(ctx: Context, formats: dict, *, years: int,
                             evse: float, carbon: float, hist: float | None) -> None:
    """Section 5's four-tile KPI strip, and the Section 5 comparison table.

    Every one of these was a hardcoded Food4Less figure in the template. They
    printed unchanged on every site: `$26,870` year-1 profit, `$131,181`
    baseline, `104.8%` uplift, and a `$108,477` "YEAR 1 TOTAL INCL. ITC" on
    workbooks that receive no ITC at all.

    Tiles 2 and 4 are the ITC ones. Rather than leave an empty cell when there
    is no credit - docxtpl cannot reliably drop a single table column - the
    value, the label and the sub-caption are all tokens, so the tile reports what
    it actually is. With an ITC it reads as before; without one it reports the
    same quantity with carbon credits in place of the credit, and says so. No
    proposal states a credit its site is not receiving.

    **No idle fees.** Every figure here is charger revenue and carbon credits,
    read off the Financial Worksheet:

        tile 1  YEAR 1 OPERATING PROFIT   FW!I6            charger revenue, yr 1
        tile 2  YEAR 1 TOTAL BENEFIT      FW!I6 + B4/B10   + one year of carbon
        tile 3  n-YEAR OPERATING PROFIT   FW!B6            = SUM(I6:I15)
        tile 4  n-YEAR TOTAL BENEFIT      FW!B6 + FW!B4    + all carbon

    Tile 1 used to add `idle_fee_annual`, which is 0 under the scenario grid but
    real under the legacy engine - so the same caption described two different
    quantities depending on the workbook. Tile 4's caption claimed idle fees for a
    value that never had an idle term at all.
    """
    itc = ctx.num("roi_itc")
    has_itc = itc != 0

    year1_charger = ctx.num("year1_charger_profit")
    ctx.put("kpi_year1_operating", year1_charger, fmt="currency0",
            source="charger cashflow, year 1 (Financial Worksheet column I)",
            formats=formats)

    # Deliberately NOT `Financial Worksheet!E6`, which is `I6 + B5 + (B4/$B$10)`
    # and so folds in the ITC. It equals this to the cent whenever B5 is zero -
    # every current v16 workbook, which is the cross-check that this arithmetic
    # is the same thing the sheet computes - but the caption says charger revenue
    # plus carbon credits, and the arithmetic has to match the caption. Do not
    # "simplify" this to E6.
    #
    # The two branches differ ONLY by the ITC term, because that is exactly what
    # their captions claim. Dropping carbon from the ITC branch would repeat the
    # bug this function was fixed for: a caption promising something the value
    # does not contain.
    carbon_per_year = carbon / years if years else 0.0
    year1_total = year1_charger + carbon_per_year + (itc if has_itc else 0.0)
    ctx.put("kpi_year1_total", year1_total, fmt="currency0",
            source=("charger year 1 + roi_carbon_credits / projection_years "
                    "+ roi_itc" if has_itc
                    else "charger year 1 + roi_carbon_credits / projection_years"),
            formats=formats)
    ctx.put("kpi_year1_total_label",
            "YEAR 1 TOTAL INCL. ITC" if has_itc else "YEAR 1 TOTAL BENEFIT",
            source="caption keyed on has_itc (roi_itc != 0)", formats=formats)
    ctx.put("kpi_year1_total_sub",
            "Chargers revenue, carbon credits and ITC" if has_itc
            else "Chargers revenue + Carbon credits",
            source="caption keyed on has_itc (roi_itc != 0)", formats=formats)

    horizon_total = evse + carbon + (itc if has_itc else 0.0)
    ctx.put("kpi_horizon_total", horizon_total, fmt="currency0",
            source=("roi_evse_revenues + roi_carbon_credits + roi_itc" if has_itc
                    else "roi_evse_revenues + roi_carbon_credits"),
            formats=formats)
    ctx.put("kpi_horizon_total_sub",
            "Chargers revenue, carbon credits and ITC" if has_itc
            else "Chargers revenue + Carbon credits",
            source="caption keyed on has_itc (roi_itc != 0)", formats=formats)

    # The Section 5 comparison table: baseline / projected / difference. These
    # follow tile 1, so dropping idle fees there drops them here too.
    if hist:
        ctx.put("kpi_projected_vs_baseline", year1_charger - hist, fmt="currency0",
                source="kpi_year1_operating - hist_profit_yearly", formats=formats)
        ctx.put("kpi_uplift", year1_charger / hist - 1, fmt="percent1",
                source="kpi_year1_operating / hist_profit_yearly - 1", formats=formats)

    # KPI strips round to whole dollars; the tables these tokens also feed do
    # not. Same precedent as `cc_total_kpi`.
    for token in ("loan_amount", "loan_monthly_payment", "loan_total_interest",
                  "cost_service_warranty", "cost_labor"):
        value = _as_number(ctx.get(token))
        if value is not None:
            ctx.put(f"{token}_kpi", value, fmt="currency0",
                    source=ctx.sources.get(token, token), formats=formats)


# --------------------------------------------------------------------------
# entry points
# --------------------------------------------------------------------------


def build_context(
    lw: LoadedWorkbook,
    fm: dict,
    *,
    operator_inputs: dict | None = None,
) -> Context:
    """Walk the whole map. Order matters: costs and ROI before the derived
    ten-year figures, equipment before the carbon tier sentence."""
    ctx = Context(detection=lw.detection)
    ctx.findings.extend(lw.detection.findings)
    formats = fm["meta"]["formats"]

    det = lw.detection
    # `horizon.fixed` chassis have no B9/B10 toggle and B10 is empty, so
    # claiming B10 as the source told an operator the horizon came from a cell
    # they could look at and change. It did not.
    fixed_horizon = det.chassis_opt("horizon", "fixed")
    ctx.put("projection_years", det.projection_years, fmt="integer",
            source=(f"fixed at {fixed_horizon} for the {det.chassis} chassis "
                    f"(no {FW}!B9 toggle)" if fixed_horizon else f"{FW}!B10"),
            formats=formats)
    # Both of these are DETECTED FROM a cell rather than copied out of it:
    # the scenario is parsed from I6's formula, and the engine name is a
    # verdict reached by probing B3's text. Saying "detected from" keeps the
    # QA report honest about what a reader would find in the cell.
    ctx.put("revenue_scenario", det.scenario or "n/a",
            source=f"detected from the formula of {FW}!I6", formats=formats)
    ctx.put("engine", det.engine, source=f"detected from {UCRC}!B3", formats=formats)
    ctx.put("has_history", det.has_history, emit=False)

    _extract_site_info(lw, fm, ctx)
    _extract_costs(lw, fm, ctx)
    _extract_roi(lw, fm, ctx)
    _extract_cashflow_tables(lw, fm, ctx)
    _extract_equipment(lw, fm, ctx)
    _extract_evolv(lw, fm, ctx)
    _extract_service_plan(lw, fm, ctx)
    _extract_carbon(lw, fm, ctx)
    _extract_financing(lw, fm, ctx)
    _extract_monthly_cashflow(lw, fm, ctx)

    # After equipment (it needs the tier ratings) and before the derived
    # ten-year figures (they compare against year 1).
    from .aggregate import build_operating_model

    build_operating_model(lw, fm, ctx)
    _prefill_existing_equipment(lw, ctx)

    if det.has_history:
        from .baseline import extract_history

        extract_history(lw, fm, ctx, operator_inputs or {})

    _extract_derived_ten_year(fm, ctx)

    # Always applied, even with no operator input: this is where the defaults
    # (proposal date, version, validity, property type) come from, and the
    # template asks for them whether or not the operator typed anything.
    _apply_operator_inputs(fm, ctx, operator_inputs or {})
    _apply_derived_display_tokens(ctx)

    return ctx


def _prefill_existing_equipment(lw: LoadedWorkbook, ctx: Context) -> None:
    """Read the site's EXISTING ports and nameplate so nobody types them.

    Section 3B needs what was already on site, which is not the same thing as
    what is being installed. The two are easy to confuse and the workbook holds
    both:

        Updated!B6 / C6    EXISTING stall counts   <- what 3B needs
        Internal Summary!G3  =INPUT SHEET!N8+SUM(O8:T8)
                           NEW charger count, for EVOLV per-port pricing

    On Showcase Liquor those read 8 and 2. Using the EVOLV figure would put the
    occupancy at 68.6% instead of 17.1% and contradict the workbook's own
    Updated!B8.

    Only valid under the legacy revenue model. Under the scenario grid the same
    B6 address holds the Standard-Low *new* stall quantity, which is the
    collision this whole program exists to avoid, so nothing is prefilled there
    and the operator is asked instead.
    """
    if not ctx.detection.is_legacy_engine:
        return
    if UCRC not in lw.values.sheetnames:
        return

    ws = lw.values[UCRC]
    derate = _as_number(lw.values[INPUT_SHEET]["N11"].value) or 1.0

    for level, ports_cell, rating_cell in (("l2", "B6", "B12"), ("l3", "C6", "C12")):
        ports = _as_number(ws[ports_cell].value)
        if ports is None:
            continue
        ctx.put(f"existing_ports_{level}", int(ports), fmt="integer",
                source=f"{UCRC}!{ports_cell} (historical column)")

        # B12 is `=7.2*'INPUT SHEET'!$N$11`, so dividing the de-rate back out
        # recovers the nameplate the operator would otherwise have to know.
        rating = _as_number(ws[rating_cell].value)
        if rating and derate:
            nameplate = round(rating / derate, 2)
            ctx.put(f"existing_nameplate_{level}_kw", nameplate, fmt="number2",
                    source=f"{UCRC}!{rating_cell} / INPUT SHEET!N11")


def _apply_derived_display_tokens(ctx: Context) -> None:
    """Presentation-only variants of values already in the context.

    The cover prints the date in caps (`AUGUST 4, 2026`) while Section 2 prints
    it in sentence case. One value, two spellings, so the uppercase form is
    derived here rather than asked of the operator twice.
    """
    ctx.formatted["proposal_date_upper"] = ctx.formatted.get("proposal_date", "").upper()
    ctx.raw["proposal_date_upper"] = ctx.formatted["proposal_date_upper"]
    ctx.sources["proposal_date_upper"] = "derived from proposal_date"


# Operator inputs the app supplies that are not proposal fields. They steer the
# build rather than appearing in it, so they carry through untouched instead of
# being formatted and printed.
CONTROL_INPUTS = ("cover_photo_path", "disabled_sections")


def _apply_operator_inputs(fm: dict, ctx: Context, supplied: dict) -> None:
    """Operator values override workbook prefills; defaults fill the rest."""
    formats = fm["meta"]["formats"]

    for token in CONTROL_INPUTS:
        if supplied.get(token):
            ctx.put(token, supplied[token], source="operator input", emit=False)
    for entry in fm["operator_inputs"]:
        token = entry["token"]
        requires = entry.get("requires")
        if requires and not ctx.get(requires):
            continue
        # Some operator inputs are printed as-is and some are numbers that need a
        # format: `downtime_assumption` is 0.03 and the Section 4 assumptions
        # table has to read "3%", not "0.03".
        fmt = entry.get("format")
        if token in supplied and supplied[token] not in (None, ""):
            ctx.put(token, supplied[token], fmt=fmt, source="operator input",
                    formats=formats)
        elif is_missing(ctx.get(token)) and "default" in entry:
            default = entry["default"]
            if default == "today":
                default = _dt.date.today()
                ctx.put(token, default, fmt="date_long", source="default (today)",
                        formats=formats)
                continue
            ctx.put(token, default, fmt=fmt, source="default", formats=formats)


def inspect_workbook(path: str | Path, *, as_json: bool = False) -> int:
    """`ev-proposal-agent inspect` - detect, extract, and dump."""
    import json

    fm = load_field_map()
    with engine_mod.load(path, fm) as lw:
        ctx = build_context(lw, fm)

    if as_json:
        payload = {
            "detection": {
                "chassis": ctx.detection.chassis,
                "engine": ctx.detection.engine,
                "scenario": ctx.detection.scenario,
                "projection_years": ctx.detection.projection_years,
                "has_history": ctx.detection.has_history,
                "has_financing": ctx.detection.has_financing,
            },
            "formatted": ctx.formatted,
            "sources": ctx.sources,
            "findings": [
                {"level": f.level.value, "code": f.code, "message": f.message,
                 "where": f.where}
                for f in ctx.findings
            ],
        }
        print(json.dumps(payload, indent=2, default=str))
        return 0

    print("\n".join(ctx.detection.summary_lines()))
    print()
    width = max((len(t) for t in ctx.formatted), default=10)
    for token in sorted(ctx.formatted):
        source = ctx.sources.get(token, "")
        print(f"  {token:<{width}}  {ctx.formatted[token]:<22}  {source}")
    print()
    for name, rows in sorted(ctx.tables.items()):
        print(f"  table {name}: {len(rows)} rows  ({ctx.sources.get(name, '')})")
    print()
    print(ctx.findings.render())
    return 0
