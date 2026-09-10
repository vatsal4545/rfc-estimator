"""Cell resolution: defined name -> label search -> fixed cell -> raise.

One function, `resolve()`, is the only sanctioned way to read a cell. Going
around it means hardcoding an address that will drift the next time someone
inserts a row.

Why the order matters
---------------------
Defined names survive row insertions; fixed addresses do not. Label search sits
in between: it survives insertions but breaks if someone rewords a label, which
is rarer than inserting a row. The fixed `cell:` is the last resort and exists
mainly so an unlabelled grid cell is still addressable.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from openpyxl.utils import get_column_letter, range_boundaries
from openpyxl.workbook.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet

from .errors import FieldNotFound

# Strings Excel leaves behind that mean "nothing useful here".
_ERROR_PREFIX = "#"


# --------------------------------------------------------------------------
# label normalisation
# --------------------------------------------------------------------------

_WS = re.compile(r"\s+")


def normalise_label(text: Any) -> str:
    """lowercase, collapse whitespace, '&' -> 'and', strip trailing ':' and '.'.

    Real labels in these workbooks carry trailing spaces (``'Carbon Credits '``,
    ``'Chargers '``, ``'ADA '``), a stray colon (``'Client Info:'``) and
    parenthetical suffixes (``'Project Management (@$358/hour)'``). Matching is
    `startswith` against the normalised form so suffixes are tolerated.
    """
    if text is None:
        return ""
    s = str(text)
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("&", " and ")
    s = _WS.sub(" ", s).strip()
    s = s.rstrip(":.").strip()
    return s.lower()


def sanitise_text(text: Any) -> str | None:
    """Strip replacement and control characters from workbook prose.

    `INPUT SHEET!M21` in v16 contains a U+FFFD. Anything read out of the
    client-info block goes through here before it reaches the document.
    """
    if text is None:
        return None
    s = str(text)
    s = s.replace("�", "")
    s = "".join(ch for ch in s if ch == "\n" or unicodedata.category(ch)[0] != "C")
    s = _WS.sub(" ", s).strip()
    return s or None


def is_missing(value: Any) -> bool:
    """`None`, empty string, or an Excel error string all mean missing."""
    if value is None:
        return True
    if isinstance(value, str):
        stripped = value.strip()
        return stripped == "" or stripped.startswith(_ERROR_PREFIX)
    return False


# --------------------------------------------------------------------------
# defined names
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Destination:
    sheet: str
    ref: str          # e.g. "$D$5" or "$A$18:$J$497"


def _destinations(defn) -> list[Destination]:
    out: list[Destination] = []
    try:
        for sheet, ref in defn.destinations:
            if sheet and ref:
                out.append(Destination(sheet, ref))
    except Exception:
        # Formula-valued names (Values_Entered, Payment_Date, the OFFSET pair)
        # have no destinations. That is expected, not an error.
        pass
    return out


def find_defined_name(wb: Workbook, name: str, *, prefer_sheet: str | None = None):
    """Look a defined name up in workbook scope, then in every sheet scope.

    The eight DLL loan names and `Data` are **sheet-scoped** on `DLL Schedule`,
    so `wb.defined_names[name]` raises `KeyError` for them. Only `cumCashCats`
    and `cumCashVals` are workbook-scoped. Searching both scopes is what makes
    the map's `name:` entries work at all.

    `prefer_sheet` is checked before the workbook scope so a sheet-local name
    beats a same-named global one, matching Excel's own resolution.
    """
    if prefer_sheet and prefer_sheet in wb.sheetnames:
        local = getattr(wb[prefer_sheet], "defined_names", {})
        if name in local:
            return local[name]

    if name in wb.defined_names:
        return wb.defined_names[name]

    for ws in wb.worksheets:
        local = getattr(ws, "defined_names", {})
        if name in local:
            return local[name]
    return None


def defined_name_formula(wb: Workbook, name: str, *, prefer_sheet: str | None = None) -> str | None:
    """Raw `attr_text` of a defined name.

    Needed for `cumCashCats` / `cumCashVals`, which are `OFFSET(...)` formulas
    rather than static ranges. openpyxl cannot evaluate them, so the caller
    parses the arguments (see `charts.resolve_offset_name`).
    """
    defn = find_defined_name(wb, name, prefer_sheet=prefer_sheet)
    return getattr(defn, "attr_text", None) if defn else None


# --------------------------------------------------------------------------
# label search
# --------------------------------------------------------------------------


def find_label_row(
    ws: Worksheet,
    label: str,
    *,
    label_col: str = "A",
    max_row: int | None = None,
) -> int | None:
    """First row whose `label_col` cell startswith the normalised `label`.

    Exact matches win over prefix matches, so a search for "Chargers" does not
    latch onto "Charger Hardware" when both are present.
    """
    target = normalise_label(label)
    if not target:
        return None
    limit = max_row or ws.max_row or 1
    prefix_hit: int | None = None

    for row in range(1, limit + 1):
        cell_value = ws[f"{label_col}{row}"].value
        if cell_value is None:
            continue
        got = normalise_label(cell_value)
        if not got:
            continue
        if got == target:
            return row
        if prefix_hit is None and got.startswith(target):
            prefix_hit = row
    return prefix_hit


# --------------------------------------------------------------------------
# the one entry point
# --------------------------------------------------------------------------


def resolve(
    wb: Workbook,
    sheet: str,
    *,
    name: str | None = None,
    label: str | None = None,
    label_col: str = "A",
    value_col: str = "B",
    cell: str | None = None,
    required: bool = True,
    default: Any = None,
) -> Any:
    """Read one value, trying every strategy in order.

    Returns the cached value. Raises `FieldNotFound` when `required` and nothing
    resolved; returns `default` otherwise. A cell that resolves but holds
    `None` / `""` / `#...` counts as not resolved - see `is_missing`.
    """
    if sheet not in wb.sheetnames:
        if required:
            raise FieldNotFound(
                f"The workbook has no sheet named '{sheet}'.",
                detail=f"sheets present: {', '.join(wb.sheetnames)}",
            )
        return default
    ws = wb[sheet]
    tried: list[str] = []

    # 1. defined name
    if name:
        tried.append(f"defined name {name}")
        defn = find_defined_name(wb, name, prefer_sheet=sheet)
        if defn is not None:
            for dest in _destinations(defn):
                target_ws = wb[dest.sheet] if dest.sheet in wb.sheetnames else ws
                value = _read_ref(target_ws, dest.ref)
                if not is_missing(value):
                    return value

    # 2. label search
    if label:
        tried.append(f"label '{label}' in column {label_col}")
        row = find_label_row(ws, label, label_col=label_col)
        if row is not None:
            value = ws[f"{value_col}{row}"].value
            if not is_missing(value):
                return value

    # 3. fixed cell
    if cell:
        tried.append(f"cell {cell}")
        value = ws[cell].value
        if not is_missing(value):
            return value

    # 4. give up
    if required:
        raise FieldNotFound(
            f"Couldn't find the '{label or name or cell}' value on the "
            f"{sheet} tab. Is this a v16 workbook?",
            detail="tried " + "; then ".join(tried) if tried else "no strategy given",
        )
    return default


def _read_ref(ws: Worksheet, ref: str) -> Any:
    """Read a defined name's destination. Single cell -> scalar, range -> None.

    Ranges are handled by `read_range`; `resolve` deals in scalars only.
    """
    ref = ref.replace("$", "")
    if ":" in ref:
        return None
    return ws[ref].value


def read_range(ws: Worksheet, ref: str) -> list[list[Any]]:
    """Values of a rectangular range as a list of rows."""
    min_col, min_row, max_col, max_row = range_boundaries(ref.replace("$", ""))
    return [
        [ws.cell(row=r, column=c).value for c in range(min_col, max_col + 1)]
        for r in range(min_row, max_row + 1)
    ]


def read_row(ws: Worksheet, row: int, cols: list[str]) -> list[Any]:
    """Values from one row across an explicit list of column letters."""
    return [ws[f"{col}{row}"].value for col in cols]


def column_span(first: str, last: str) -> list[str]:
    """Inclusive list of column letters, e.g. `('C', 'H') -> [C, D, E, F, G, H]`."""
    from openpyxl.utils import column_index_from_string

    a = column_index_from_string(first)
    b = column_index_from_string(last)
    step = 1 if b >= a else -1
    return [get_column_letter(i) for i in range(a, b + step, step)]


def sheet_has_cached_values(ws: Worksheet, *, sample_rows: int = 60) -> bool:
    """True if any numeric cached value exists on the sheet.

    openpyxl cannot evaluate formulas; it reads whatever Excel cached at last
    save. A workbook saved with calculation suspended has formulas everywhere
    and values nowhere, and every downstream number would silently be `None`.
    """
    limit = min(ws.max_row or 1, sample_rows)
    width = min(ws.max_column or 1, 30)
    for row in ws.iter_rows(min_row=1, max_row=limit, max_col=width):
        for cell in row:
            if isinstance(cell.value, (int, float)) and not isinstance(cell.value, bool):
                return True
    return False
