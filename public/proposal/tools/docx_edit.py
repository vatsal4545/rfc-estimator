"""Run-level docx surgery helpers.

Everything here edits an existing document in place. Nothing rebuilds it. That
is the whole point: the reference proposal carries four section definitions,
nine headers, three footers, ten media files and a 348 KB style part, and every
one of those survives only if we never re-author the document.
"""

from __future__ import annotations

import copy
import re
import zipfile
from pathlib import Path
from typing import Iterable, Iterator

from docx.document import Document as DocumentType
from docx.oxml.ns import qn
from docx.table import Table, _Cell, _Row
from docx.text.paragraph import Paragraph


# --------------------------------------------------------------------------
# walking
# --------------------------------------------------------------------------


def iter_tables(container) -> Iterator[Table]:
    """Every table, including ones nested inside cells."""
    for table in getattr(container, "tables", []):
        yield table
        for row in table.rows:
            for cell in row.cells:
                yield from iter_tables(cell)


def iter_paragraphs(container) -> Iterator[Paragraph]:
    """Every paragraph, including inside tables at any nesting depth."""
    for paragraph in getattr(container, "paragraphs", []):
        yield paragraph
    for table in getattr(container, "tables", []):
        for row in table.rows:
            for cell in row.cells:
                yield from iter_paragraphs(cell)


def iter_story_parts(doc: DocumentType) -> Iterator[tuple[str, object]]:
    """The body plus every header and footer that genuinely exists in the zip.

    python-docx fabricates header/footer parts on attribute access, so asking a
    section for a header it does not have will silently create one. Checking
    `is_linked_to_previous` first avoids writing parts the original never had.
    """
    yield "document", doc
    for i, section in enumerate(doc.sections):
        for attr in ("header", "footer", "even_page_header", "even_page_footer",
                     "first_page_header", "first_page_footer"):
            part = getattr(section, attr, None)
            if part is None or part.is_linked_to_previous:
                continue
            yield f"section{i}.{attr}", part


# --------------------------------------------------------------------------
# text replacement that survives split runs
# --------------------------------------------------------------------------


def replace_in_paragraph(paragraph: Paragraph, old: str, new: str) -> int:
    """Replace `old` with `new`, even when it spans several runs.

    The cover date is the reason this exists: `AUGUST 4, 2026` is three runs
    (`'AUGUST '`, `'4'`, `', 2026'`), so a per-run replace finds nothing.

    The replacement text lands entirely in the first run the match touches, so
    it inherits that run's formatting. Runs the match consumed are emptied but
    kept, because deleting them can orphan bookmarks and comment anchors.
    """
    runs = paragraph.runs
    if not runs:
        return 0
    full = "".join(r.text for r in runs)
    if old not in full:
        return 0

    # offset of each run within the concatenated text
    spans: list[tuple[int, int]] = []
    pos = 0
    for run in runs:
        spans.append((pos, pos + len(run.text)))
        pos += len(run.text)

    count = 0
    search_from = 0
    while True:
        full = "".join(r.text for r in runs)
        at = full.find(old, search_from)
        if at == -1:
            break
        end = at + len(old)
        # Resume past the text we just inserted. Without this, a replacement
        # that contains its own search string loops forever - which is exactly
        # what "3" -> "{{ n_ports_l3 }}" does.
        search_from = at + len(new)

        spans, pos = [], 0
        for run in runs:
            spans.append((pos, pos + len(run.text)))
            pos += len(run.text)

        touched = [i for i, (s, e) in enumerate(spans) if s < end and e > at]
        if not touched:
            break
        first = touched[0]
        s, e = spans[first]
        prefix = runs[first].text[: at - s]
        last = touched[-1]
        ls, le = spans[last]
        suffix = runs[last].text[end - ls:] if end > ls else ""

        runs[first].text = prefix + new + (suffix if last == first else "")
        for i in touched[1:]:
            runs[i].text = "" if i != last else ""
        if last != first:
            runs[last].text = suffix
        count += 1
    return count


def replace_everywhere(container, old: str, new: str) -> int:
    return replace_many(container, [(old, new)]).get(old, 0)


def replace_many(
    container, mapping: Iterable[tuple[str, str]], *, paragraphs=None
) -> dict[str, int]:
    """Apply every replacement in one pass over the paragraphs.

    Order matters within a paragraph: replacements run longest-first, so
    `Stockton` cannot fire before `3434 Manthey Rd, Stockton, CA 95206` and
    leave half a token behind.

    One pass, not one pass per pair. The reference document holds 1782
    paragraphs and the substitution list runs to ~60 entries; re-walking the
    tree per pair turns a two-second build into a five-minute one.
    """
    pairs = sorted(mapping, key=lambda kv: -len(kv[0]))
    if not pairs:
        return {}
    if paragraphs is None:
        paragraphs = list(iter_paragraphs(container))

    counts: dict[str, int] = {}
    for paragraph in paragraphs:
        runs = paragraph.runs
        if not runs:
            continue
        text = "".join(r.text for r in runs)
        if not text:
            continue
        for old, new in pairs:
            # Cheap guard: the expensive run-mapping only runs on a real hit.
            if old not in text:
                continue
            hits = replace_in_paragraph(paragraph, old, new)
            if hits:
                counts[old] = counts.get(old, 0) + hits
                text = "".join(r.text for r in runs)
    return counts


def set_paragraph_text(paragraph: Paragraph, text: str) -> None:
    """Replace a paragraph's whole text, keeping the first run's formatting."""
    runs = paragraph.runs
    if not runs:
        paragraph.add_run(text)
        return
    runs[0].text = text
    for run in runs[1:]:
        run.text = ""


def set_cell_text(cell: _Cell, text: str) -> None:
    """Overwrite a cell, keeping the first paragraph's style and shading."""
    paragraphs = cell.paragraphs
    set_paragraph_text(paragraphs[0], text)
    for extra in paragraphs[1:]:
        set_paragraph_text(extra, "")


# --------------------------------------------------------------------------
# rows
# --------------------------------------------------------------------------


def clone_row(table: Table, row: _Row, *, after: _Row | None = None) -> _Row:
    """Deep-copy a row so the clone keeps its borders, shading and widths."""
    new_tr = copy.deepcopy(row._tr)
    anchor = (after or row)._tr
    anchor.addnext(new_tr)
    return _Row(new_tr, table)


def blank_row(row: _Row) -> None:
    for cell in row.cells:
        set_cell_text(cell, "")


def delete_row(row: _Row) -> None:
    row._tr.getparent().remove(row._tr)


def logical_cells(row: _Row) -> list[_Cell]:
    """The row's cells with horizontal merges collapsed to one entry each.

    `row.cells` returns one entry per *grid column*, so a merged span appears
    twice pointing at the same `<w:tc>`. Writing through that list makes the
    next expression overwrite the previous one: the equipment table has 7 grid
    columns for 5 real columns, and "Modeled rating" landed on top of
    "Nameplate rating", printing the same figure twice.
    """
    seen: set[int] = set()
    out: list[_Cell] = []
    for cell in row.cells:
        key = id(cell._tc)
        if key not in seen:
            seen.add(key)
            out.append(cell)
    return out


def make_row_loop(
    table: Table,
    data_row_index: int,
    *,
    header: str,
    footer: str = "{%tr endfor %}",
    cell_exprs: list[str],
    drop_rows: list[int] | None = None,
) -> None:
    """Turn one representative row into a docxtpl `{%tr for %}` loop.

    Produces the three-row shape docxtpl expects:

        {%tr for row in rows %}
        {{ row.a }} | {{ row.b }}
        {%tr endfor %}

    The tag rows are clones of the data row, so if the loop ever renders zero
    iterations the table still closes cleanly. `drop_rows` removes the other
    sample data rows, which are now redundant.
    """
    for index in sorted(drop_rows or [], reverse=True):
        delete_row(table.rows[index])

    data_row = table.rows[data_row_index]
    targets = logical_cells(data_row)
    if len(cell_exprs) > len(targets):
        raise ValueError(
            f"{len(cell_exprs)} expressions for a row with {len(targets)} real "
            f"columns ({len(data_row.cells)} grid columns). Merges collapse the "
            "grid, so the extra expressions would overwrite earlier ones."
        )
    for cell, expr in zip(targets, cell_exprs):
        set_cell_text(cell, expr)

    open_row = copy.deepcopy(data_row._tr)
    data_row._tr.addprevious(open_row)
    opener = _Row(open_row, table)
    blank_row(opener)
    set_cell_text(opener.cells[0], header)

    closer = clone_row(table, data_row)
    blank_row(closer)
    set_cell_text(closer.cells[0], footer)


def wrap_row_conditional(table: Table, row_index: int, condition: str) -> None:
    """Wrap one table row in `{%tr if ... %}` / `{%tr endif %}`.

    Used for the Federal ITC row, which must vanish when `Financial
    Worksheet!B5` is zero - the expected case in v16. The tag rows are clones of
    the row they guard, so the table's borders still line up when the row drops.
    """
    row = table.rows[row_index]

    open_tr = copy.deepcopy(row._tr)
    row._tr.addprevious(open_tr)
    opener = _Row(open_tr, table)
    blank_row(opener)
    set_cell_text(opener.cells[0], "{%tr if " + condition + " %}")

    closer = clone_row(table, row)
    blank_row(closer)
    set_cell_text(closer.cells[0], "{%tr endif %}")


def wrap_rows_conditional(table: Table, first: int, last: int, condition: str) -> None:
    """Wrap a RANGE of rows, header included, in `{%tr if ... %}` / `{%tr endif %}`.

    Wrapping each row separately would work but insert two tag rows per row. A
    whole table that only makes sense sometimes - Section 5's historical-baseline
    comparison, which has nothing to compare against on a greenfield site - wants
    one opener and one closer around the lot.
    """
    open_tr = copy.deepcopy(table.rows[first]._tr)
    table.rows[first]._tr.addprevious(open_tr)
    opener = _Row(open_tr, table)
    blank_row(opener)
    set_cell_text(opener.cells[0], "{%tr if " + condition + " %}")

    closer = clone_row(table, table.rows[last + 1])   # +1 for the opener above
    blank_row(closer)
    set_cell_text(closer.cells[0], "{%tr endif %}")


# --------------------------------------------------------------------------
# images
# --------------------------------------------------------------------------


def find_inline_images(doc: DocumentType) -> list[tuple[Paragraph, object, str, int, int]]:
    """Every inline drawing, with its media target and display size in EMU."""
    out = []
    rels = doc.part.rels
    for paragraph in iter_paragraphs(doc):
        for drawing in paragraph._p.iter(qn("w:drawing")):
            blip = next(drawing.iter(qn("a:blip")), None)
            extent = next(drawing.iter(qn("wp:extent")), None)
            if blip is None:
                continue
            rid = blip.get(qn("r:embed"))
            target = rels[rid].target_ref if rid in rels else "?"
            cx = int(extent.get("cx")) if extent is not None else 0
            cy = int(extent.get("cy")) if extent is not None else 0
            out.append((paragraph, drawing, target, cx, cy))
    return out


def extract_media(path: Path, targets: dict[str, Path]) -> dict[str, Path]:
    """Pull named images out of a .docx so they can be re-inserted as content.

    Used for the two product photos. They ship inside the reference document as
    floating anchors; lifting them out lets the renderer place them inline and
    conditionally instead.
    """
    written: dict[str, Path] = {}
    with zipfile.ZipFile(path) as z:
        for member, destination in targets.items():
            name = member if member.startswith("word/") else f"word/{member}"
            if name not in z.namelist():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(z.read(name))
            written[member] = destination
    return written


def remove_floating_drawings(paragraph: Paragraph) -> list[str]:
    """Delete every anchored (floating) drawing from a paragraph.

    A `wp:anchor` with `wrapNone` and `positionV relativeFrom="page"` is pinned
    to an absolute spot on whichever page it lands on, and text flows straight
    underneath it. That is fine in a fixed document and wrong in a generated
    one: change the number of rows in a table above it and the image lands on
    the body copy. Returns the media targets removed.
    """
    removed: list[str] = []
    for drawing in list(paragraph._p.iter(qn("w:drawing"))):
        if drawing.find(qn("wp:anchor")) is None:
            continue
        blip = next(drawing.iter(qn("a:blip")), None)
        if blip is not None:
            removed.append(blip.get(qn("r:embed")) or "?")
        run = drawing.getparent()
        run.remove(drawing)
        if not len(run):
            run.getparent().remove(run)
    return removed


def replace_image_with_token(paragraph: Paragraph, drawing, token: str) -> None:
    """Swap an inline image for a docxtpl `InlineImage` placeholder.

    The drawing's run is emptied rather than removed so the paragraph keeps its
    alignment and spacing, which is what centres the chart on the page.
    """
    run = drawing.getparent()
    while run is not None and run.tag != qn("w:r"):
        run = run.getparent()
    if run is None:
        return
    run.remove(drawing)
    for child in list(run):
        if child.tag == qn("w:t"):
            run.remove(child)
    text_el = run.makeelement(qn("w:t"), {})
    text_el.text = token
    run.append(text_el)


# --------------------------------------------------------------------------
# package-level scrub
# --------------------------------------------------------------------------


def clear_cached_page_numbers(path: Path) -> int:
    """Blank the stale cached result sitting beside each `PAGE` field.

    A `PAGE` field in Word is three parts: a begin marker, the instruction, and
    the last value Word computed, stored as ordinary text. The reference
    proposal was saved with `1` cached, so every one of its 31 pages reads
    "Page 1". Word only recomputes on print preview or F9, so the literal has to
    go. Clearing the text and leaving the field intact makes Word fill it in
    correctly on open.
    """
    path = Path(path)
    pattern = re.compile(
        r'(<w:fldChar[^>]*w:fldCharType="separate"[^>]*/>)(.*?)'
        r'(<w:fldChar[^>]*w:fldCharType="end"[^>]*/>)',
        re.DOTALL,
    )
    fixed = 0

    with zipfile.ZipFile(path) as zin:
        items = {n: zin.read(n) for n in zin.namelist()}
        infos = {i.filename: i for i in zin.infolist()}

    for name in list(items):
        if not re.search(r"(footer|header)\d+\.xml$", name):
            continue
        text = items[name].decode("utf-8")

        def blank(match: re.Match) -> str:
            nonlocal fixed
            middle = match.group(2)
            cleaned = re.sub(r"(<w:t[^>]*>)[^<]*(</w:t>)", r"\1\2", middle)
            if cleaned != middle:
                fixed += 1
            return match.group(1) + cleaned + match.group(3)

        new_text = pattern.sub(blank, text)
        if new_text != text:
            items[name] = new_text.encode("utf-8")

    if fixed:
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
            for name, data in items.items():
                zout.writestr(infos[name], data)
    return fixed


def scrub_package(path: Path, mapping: dict[str, str]) -> dict[str, int]:
    """Rewrite docProps and any part python-docx does not expose.

    `docProps/core.xml` carries the client name in the title, keywords and
    description; `app.xml` repeats it in the heading list. Neither is visible in
    Word, and both survive a document-level scrub, which is exactly how a
    "blank" template ships with the previous client's name inside it.
    """
    path = Path(path)
    counts: dict[str, int] = {}
    with zipfile.ZipFile(path) as zin:
        items = {name: zin.read(name) for name in zin.namelist()}
        infos = {i.filename: i for i in zin.infolist()}

    targets = [n for n in items if n.startswith("docProps/") or n.endswith(".xml")]
    for name in targets:
        try:
            text = items[name].decode("utf-8")
        except UnicodeDecodeError:
            continue
        original = text
        for old, new in sorted(mapping.items(), key=lambda kv: -len(kv[0])):
            if old in text:
                counts[old] = counts.get(old, 0) + text.count(old)
                text = text.replace(old, new)
        if text != original:
            items[name] = text.encode("utf-8")

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in items.items():
            info = infos[name]
            zout.writestr(info, data)
    return counts


IDENTITY_PATTERNS = [
    "Food4Less", "Jerome", "Jenkins", "Manthey", "Stockton", "95206",
    "Alexander Luckett", "Zaid Khartabil",
]


def audit_identity(path: Path, patterns: list[str] | None = None) -> dict[str, list[str]]:
    """Which parts still mention the previous client. Empty dict means clean."""
    patterns = patterns or IDENTITY_PATTERNS
    hits: dict[str, list[str]] = {}
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            try:
                text = z.read(name).decode("utf-8")
            except (UnicodeDecodeError, KeyError):
                continue
            found = [p for p in patterns if p in text]
            if found:
                hits[name] = found
    return hits


def find_leftover_tokens(path: Path) -> dict[str, list[str]]:
    """Template tags or Excel errors that survived a render."""
    bad = re.compile(r"(\{\{|\{%|#REF!|#VALUE!|#ERROR!|#DIV/0!)")
    hits: dict[str, list[str]] = {}
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not (name.endswith(".xml") and (
                    "document" in name or "header" in name or "footer" in name)):
                continue
            try:
                text = z.read(name).decode("utf-8")
            except UnicodeDecodeError:
                continue
            found = sorted(set(m.group(0) for m in bad.finditer(text)))
            if found:
                hits[name] = found
    return hits
