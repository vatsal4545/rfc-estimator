"""The desktop app: drop a workbook, adjust what you need, generate.

Four rules shape this window.

**The action bar can never scroll away.** It is a fixed-height bar outside the
scroll area, pinned to the bottom of the frame, so the Generate button is on
screen at every window size. The window sizes itself from the screen it is
actually on rather than a hardcoded height, because a fixed 900px is taller
than a laptop display at 125% Windows scaling and pushes the bar off the
bottom edge.

**Show the detection before generating.** Layout, revenue model, horizon,
financing and whether history is present all decide what the document says. A
wrong toggle is cheap to catch here and expensive to catch after the proposal
has been sent.

**Nothing optional is on screen by default.** Details, sections and the cover
photo sit in collapsed panels, each showing a one-line summary of its own
state, so folding never hides a change.

**Never show a traceback.** Every failure the pipeline raises carries an
operator-readable message; anything else is caught and reported with the detail
behind a "Show details" button.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

from PySide6.QtCore import Qt, QThread, QTimer, Signal
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (
    QApplication, QFileDialog, QFormLayout, QFrame, QHBoxLayout, QLabel,
    QLineEdit, QMessageBox, QProgressBar, QPushButton, QScrollArea, QSizePolicy,
    QSpinBox, QTextEdit, QVBoxLayout, QWidget,
)

from . import engine as engine_mod
from .errors import ProposalError
from .extract import build_context, load_field_map
from .paths import output_dir, settings_path
from .sections import REGISTRY
from .ui_widgets import (
    CANVAS, DANGER, DANGER_WASH, FAINT, INK, LINE, LINE_SOFT, MUTED, R_CARD,
    R_CTL, SP, SURFACE, TEAL, TEAL_EDGE, TEAL_WASH, TwoColumnList, Card,
    ImageDropZone, Panel, SectionToggle, app_stylesheet, elevate, hairline,
    label,
)

RECENT_LIMIT = 5

CLIENT_FIELDS: list[tuple[str, str, str, object]] = [
    ("site_name", "Site name", "text", ""),
    ("site_address", "Site address", "text", ""),
    ("client_contact_name", "Client contact", "text", ""),
    ("client_title", "Client title", "text", "Owner"),
    ("prepared_by_name", "Prepared by", "text", ""),
]

PROPOSAL_FIELDS: list[tuple[str, str, str, object]] = [
    ("property_type", "Property type", "text", "Retail"),
    ("primary_users", "Primary users", "text", "Customers and public use"),
    ("proposal_version", "Version", "text", "V1.0"),
    ("validity_days", "Validity (days)", "int", 30),
    ("construction_weeks", "Construction duration", "text", "3 to 4"),
]

SITE_FIELDS: list[tuple[str, str, str, object]] = [
    ("existing_ports_l2", "Existing Level 2 ports", "int", 0),
    ("existing_ports_l3", "Existing Level 3 ports", "int", 0),
    ("existing_nameplate_l2_kw", "Existing L2 nameplate kW", "text", "7.2"),
    ("existing_nameplate_l3_kw", "Existing L3 nameplate kW", "text", "50"),
]

ALL_FIELDS = CLIENT_FIELDS + PROPOSAL_FIELDS + SITE_FIELDS
NARRATIVE_FIELD = ("site_location_narrative",
                   "Location and traffic drivers")


class Worker(QThread):
    """Generation runs off the UI thread so the window stays responsive."""

    progress = Signal(str)
    finished_ok = Signal(str, str, list)
    failed = Signal(str, str)

    def __init__(self, workbook: Path, inputs: dict):
        super().__init__()
        self.workbook, self.inputs = workbook, inputs

    def run(self) -> None:
        from .render import default_output_path, generate

        try:
            fm = load_field_map()
            with engine_mod.load(self.workbook, fm) as lw:
                ctx = build_context(lw, fm, operator_inputs=self.inputs)
                out = default_output_path(ctx)
            generate(self.workbook, output=out, operator_inputs=self.inputs,
                     progress=self.progress.emit)
            qa = out.with_name(out.stem + "_QA.txt")
            warnings = [
                line.strip() for line in qa.read_text(encoding="utf-8").splitlines()
                if line.strip().startswith("WARNING")
            ] if qa.exists() else []
            self.finished_ok.emit(str(out), str(qa), warnings)
        except ProposalError as exc:
            self.failed.emit(exc.message, exc.detail or "")
        except Exception as exc:                       # never show a traceback
            self.failed.emit(
                "Something went wrong that this program did not expect. The "
                "details below will help whoever maintains it.",
                f"{type(exc).__name__}: {exc}\n\n{traceback.format_exc()}",
            )


class WorkbookDropZone(QFrame):
    """The primary target, and the only thing on screen before a file lands."""

    dropped = Signal(str)

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("WorkbookDropZone")
        self.setAcceptDrops(True)
        self.setCursor(Qt.PointingHandCursor)
        self.setMinimumHeight(132)
        self.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Maximum)
        self._idle()

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(5)

        self.headline = QLabel("Drop the financial worksheet here")
        self.headline.setAlignment(Qt.AlignCenter)
        self.headline.setStyleSheet(
            f"color: {INK}; font-size: 15px; font-weight: 600;"
            " background: transparent;")
        self.detail = QLabel("An .xlsx calculator workbook, or click to browse")
        self.detail.setAlignment(Qt.AlignCenter)
        self.detail.setStyleSheet(
            f"color: {MUTED}; font-size: 12px; background: transparent;")

        layout.addStretch()
        layout.addWidget(self.headline)
        layout.addWidget(self.detail)
        layout.addStretch()

    def _idle(self) -> None:
        self.setStyleSheet(
            f"#WorkbookDropZone {{ background: {SURFACE};"
            f" border: 1.5px dashed #C9D3D7; border-radius: {R_CARD}px; }}")

    def _hover(self) -> None:
        self.setStyleSheet(
            f"#WorkbookDropZone {{ background: {TEAL_WASH};"
            f" border: 1.5px solid {TEAL}; border-radius: {R_CARD}px; }}")

    def loaded(self, name: str) -> None:
        self.setStyleSheet(
            f"#WorkbookDropZone {{ background: {SURFACE};"
            f" border: 1px solid {TEAL_EDGE}; border-radius: {R_CARD}px; }}")
        self.headline.setText(name)
        self.detail.setText("Drop another workbook to start over")
        self.setMinimumHeight(78)
        self.setMaximumHeight(78)

    def dragEnterEvent(self, event) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            self._hover()

    def dragLeaveEvent(self, event) -> None:
        self._idle()

    def dropEvent(self, event) -> None:
        for url in event.mimeData().urls():
            if url.toLocalFile().lower().endswith((".xlsx", ".xlsm")):
                self.dropped.emit(url.toLocalFile())
                return
        self._idle()
        self.detail.setText("That is not an Excel workbook")

    def mousePressEvent(self, event) -> None:
        chosen, _ = QFileDialog.getOpenFileName(
            self, "Choose the financial worksheet", "",
            "Excel workbooks (*.xlsx *.xlsm)")
        if chosen:
            self.dropped.emit(chosen)


class MainWindow(QWidget):
    def __init__(self) -> None:
        super().__init__()
        # The build stamp lives in the title bar because that is the one
        # place an operator can read it out to whoever is helping them.
        # Four builds shipped in one afternoon all reporting "0.1.0" is
        # how "it still says permission denied" became unanswerable.
        from .buildinfo import build_label

        self.setWindowTitle(f"EV Proposal Generator  -  {build_label()}")
        self.setStyleSheet(app_stylesheet())
        self._size_to_screen()

        self.workbook: Path | None = None
        self.widgets: dict[str, QWidget] = {}
        self.toggles: list[SectionToggle] = []
        self.worker: Worker | None = None
        self._build()

    def _size_to_screen(self) -> None:
        """Fit the screen this window actually opens on.

        The previous build hardcoded 720x900. On a 1080p laptop at 125% Windows
        scaling the usable height is about 780 logical pixels, so the bottom
        120px of the window - the entire action bar - sat below the edge of the
        display with no way to reach it.
        """
        screen = QGuiApplication.primaryScreen()
        available = screen.availableGeometry() if screen else None
        if available is None:
            self.resize(860, 720)
            self.setMinimumSize(520, 480)
            return
        width = max(520, min(880, int(available.width() * 0.60)))
        height = max(480, min(880, int(available.height() * 0.88)))
        self.resize(width, height)
        # Small enough to stay usable on a half-screen snap.
        self.setMinimumSize(520, 460)
        frame = self.frameGeometry()
        frame.moveCenter(available.center())
        self.move(frame.topLeft())

    # ---------------------------------------------------------------- layout

    def _build(self) -> None:
        shell = QVBoxLayout(self)
        shell.setContentsMargins(0, 0, 0, 0)
        shell.setSpacing(0)

        shell.addWidget(self._build_header())

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        page = QWidget()
        self.page_layout = QVBoxLayout(page)
        self.page_layout.setContentsMargins(20, 18, 20, 18)
        self.page_layout.setSpacing(SP + 2)
        scroll.setWidget(page)
        # The scroll area is the only thing that flexes. Header and action bar
        # keep their height at every window size.
        self._scroll = scroll
        shell.addWidget(scroll, 1)

        self.drop = WorkbookDropZone()
        self.drop.dropped.connect(self.on_workbook)
        self.page_layout.addWidget(self.drop)

        self.detected_card = self._build_detected_card()
        self.detected_card.setVisible(False)
        self.page_layout.addWidget(self.detected_card)

        self.panel_client = self._build_field_panel(
            "1", "Client and site", CLIENT_FIELDS, "Who the proposal is for")
        self.panel_proposal = self._build_field_panel(
            "2", "Proposal details", PROPOSAL_FIELDS + SITE_FIELDS,
            "Version, validity and existing equipment", narrative=True)
        self.panel_sections = self._build_sections_panel("3")
        self.panel_cover = self._build_cover_panel("4")

        for panel in self._panels():
            panel.setVisible(False)
            panel.toggled_open.connect(
                lambda open_, p=panel: self._on_panel_toggled(p, open_))
            self.page_layout.addWidget(panel)

        self.page_layout.addStretch(1)
        shell.addWidget(self._build_action_bar())

    def _on_panel_toggled(self, panel: Panel, open_: bool) -> None:
        """One panel at a time, and bring it into view.

        With four panels open at once the section list sat two screens down and
        reaching it meant scrolling past everything else. Closing the others
        puts whichever one you opened directly under the detection card.
        """
        if not open_:
            return
        for other in self._panels():
            if other is not panel and other._open:
                other.set_open(False)
        # After the others collapse, not before, or the geometry is stale.
        QTimer.singleShot(0, lambda: self._scroll.ensureWidgetVisible(panel, 0, 8))

    def _panels(self) -> list[Panel]:
        return [self.panel_client, self.panel_proposal,
                self.panel_sections, self.panel_cover]

    def _build_header(self) -> QWidget:
        header = QWidget()
        header.setFixedHeight(62)
        header.setStyleSheet(
            f"background: {SURFACE}; border-bottom: 1px solid {LINE};")
        row = QHBoxLayout(header)
        row.setContentsMargins(20, 0, 20, 0)
        row.setSpacing(12)

        mark = QLabel("ZI")
        mark.setFixedSize(30, 30)
        mark.setAlignment(Qt.AlignCenter)
        mark.setStyleSheet(
            f"background: {TEAL}; color: white; border-radius: 8px;"
            " font-size: 12px; font-weight: 700;")

        column = QVBoxLayout()
        column.setSpacing(0)
        title = QLabel("EV Proposal Generator")
        title.setStyleSheet(
            f"color: {INK}; font-size: 15px; font-weight: 600;"
            " background: transparent;")
        subtitle = QLabel("Financial worksheet to an editable Word proposal")
        subtitle.setStyleSheet(
            f"color: {MUTED}; font-size: 11px; background: transparent;")
        column.addWidget(title)
        column.addWidget(subtitle)

        row.addWidget(mark)
        row.addLayout(column, 1)
        return header

    def _build_detected_card(self) -> QWidget:
        card = Card(padding=14)
        card.add(label("What the workbook says", "caption"))
        self.detected_grid = QVBoxLayout()
        self.detected_grid.setSpacing(3)
        card.add_layout(self.detected_grid)

        self.blockers = QLabel("")
        self.blockers.setWordWrap(True)
        self.blockers.setVisible(False)
        self.blockers.setStyleSheet(
            f"background: {DANGER_WASH}; color: {DANGER}; font-size: 12px;"
            f" border: 1px solid #F0D5D2; border-radius: {R_CTL}px;"
            " padding: 10px 12px;")
        card.add(self.blockers)
        return card

    def _build_field_panel(self, step: str, title: str, fields: list,
                           summary: str, *, narrative: bool = False) -> Panel:
        panel = Panel(step, title, summary)
        form = QFormLayout()
        form.setLabelAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        form.setFormAlignment(Qt.AlignTop)
        form.setHorizontalSpacing(14)
        form.setVerticalSpacing(9)
        form.setFieldGrowthPolicy(QFormLayout.AllNonFixedFieldsGrow)

        for token, text, kind, default in fields:
            if kind == "int":
                widget = QSpinBox()
                widget.setMaximum(9999)
                widget.setValue(int(default or 0))
                widget.setMinimumWidth(90)
            else:
                widget = QLineEdit(str(default))
            self.widgets[token] = widget
            caption = label(text, "field")
            caption.setMinimumWidth(150)
            form.addRow(caption, widget)
        panel.add_layout(form)

        if narrative:
            token, text = NARRATIVE_FIELD
            box = QTextEdit()
            box.setFixedHeight(70)
            box.setPlaceholderText(
                "Why this location works. Printed as written in Section 6.")
            self.widgets[token] = box
            panel.add(hairline())
            panel.add(label(text, "field"))
            panel.add(box)
        return panel

    def _build_sections_panel(self, step: str) -> Panel:
        panel = Panel(step, "Sections to include", "All sections")
        panel.add(label(
            "Untick anything this proposal does not need. Numbering, the "
            "contents page and the section badges all update to match. "
            "Hover a section to see what it contains.", "caption"))

        self._sections_list = TwoColumnList()
        panel.add(self._sections_list)

        row = QHBoxLayout()
        row.setSpacing(6)
        select_all = QPushButton("Select all")
        select_all.setProperty("role", "quiet")
        select_all.setCursor(Qt.PointingHandCursor)
        select_all.clicked.connect(lambda: self._set_all_sections(True))
        clear = QPushButton("Clear optional")
        clear.setProperty("role", "quiet")
        clear.setCursor(Qt.PointingHandCursor)
        clear.clicked.connect(lambda: self._set_all_sections(False))
        row.addWidget(select_all)
        row.addWidget(clear)
        row.addStretch()
        panel.add_layout(row)
        return panel

    def _build_cover_panel(self, step: str) -> Panel:
        panel = Panel(step, "Cover photo", "Using the stock photo")
        panel.add(label(
            "A photo of the site for page one. Leave it empty to use the "
            "stock image.", "caption"))
        self.cover_zone = ImageDropZone(placeholder="Drop a cover photo here")
        self.cover_zone.changed.connect(self._on_cover_changed)
        panel.add(self.cover_zone)
        return panel

    def _build_action_bar(self) -> QWidget:
        """Fixed height, outside the scroll area, pinned to the frame bottom."""
        bar = QWidget()
        bar.setObjectName("ActionBar")
        bar.setStyleSheet(
            f"#ActionBar {{ background: {SURFACE};"
            f" border-top: 1px solid {LINE}; }}")
        bar.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Fixed)
        elevate(bar, blur=18, dy=-3, alpha=18)

        outer = QVBoxLayout(bar)
        outer.setContentsMargins(20, 10, 20, 12)
        outer.setSpacing(7)

        self.progress = QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.setVisible(False)
        outer.addWidget(self.progress)

        row = QHBoxLayout()
        row.setSpacing(8)

        status_column = QVBoxLayout()
        status_column.setSpacing(1)
        self.status = QLabel("Drop a workbook to begin")
        self.status.setWordWrap(False)
        self.status.setStyleSheet(
            f"color: {MUTED}; font-size: 12px; background: transparent;")
        self.status.setSizePolicy(QSizePolicy.Ignored, QSizePolicy.Preferred)
        status_column.addWidget(self.status)

        # After a successful run the next thing anyone wants is to READ the
        # proposal, not make another one. So the primary button becomes "Open
        # proposal" and generating again is demoted to a secondary action, which
        # also stops the big teal button reading as "click me again".
        self.open_qa = QPushButton("QA report")
        self.open_folder = QPushButton("Folder")
        self.open_doc = QPushButton("Open proposal")
        for button in (self.open_qa, self.open_folder):
            button.setProperty("role", "secondary")
            button.setCursor(Qt.PointingHandCursor)
            button.setVisible(False)
        for button in (self.open_qa, self.open_folder, self.open_doc):
            button.clicked.connect(
                lambda _checked=False, b=button: self._open_target(b))
        self.open_doc.setProperty("role", "primary")
        self.open_doc.setCursor(Qt.PointingHandCursor)
        self.open_doc.setMinimumWidth(160)
        self.open_doc.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        self.open_doc.setVisible(False)

        self.generate_button = QPushButton("Generate proposal")
        self.generate_button.setProperty("role", "primary")
        self.generate_button.setEnabled(False)
        self.generate_button.setCursor(Qt.PointingHandCursor)
        self.generate_button.setMinimumWidth(190)
        # Never shrinks. The status text next to it is what gives way when the
        # window narrows.
        self.generate_button.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        self.generate_button.clicked.connect(self.on_generate)

        row.addLayout(status_column, 1)
        for button in (self.open_qa, self.open_folder,
                       self.generate_button, self.open_doc):
            row.addWidget(button, 0, Qt.AlignRight)
        outer.addLayout(row)
        return bar

    # ------------------------------------------------------------- behaviour

    def on_workbook(self, path: str) -> None:
        self.workbook = Path(path)
        self._set_generated_state(False)
        self.status.setStyleSheet(
            f"color: {MUTED}; font-size: 12px; background: transparent;")
        self.status.setText("Reading the workbook...")

        try:
            fm = load_field_map()
            with engine_mod.load(self.workbook, fm) as lw:
                detection = lw.detection
                ctx = build_context(lw, fm)
        except ProposalError as exc:
            self._reset_for_failure()
            self._error(exc.message, exc.detail or "")
            return
        except Exception as exc:
            self._reset_for_failure()
            self._error("This file could not be read as a calculator workbook.",
                        f"{type(exc).__name__}: {exc}")
            return

        self.drop.loaded(self.workbook.name)
        self._show_detection(detection, ctx)
        self._prefill(ctx)
        self._populate_sections(ctx)

        for panel in self._panels():
            panel.setVisible(True)
            panel.set_open(False)
        # Open the one panel that always needs a human: the client's name is
        # never fully in the workbook.
        self.panel_client.set_open(True)

        blockers = [f.message for f in ctx.findings.errors]
        self.generate_button.setEnabled(not blockers)
        self.status.setText(
            "Fix the problems above, then drop the workbook again"
            if blockers else "Ready to generate"
        )

    def _reset_for_failure(self) -> None:
        self.generate_button.setEnabled(False)
        self.detected_card.setVisible(False)
        self.status.setText("Drop a workbook to begin")
        for panel in self._panels():
            panel.setVisible(False)

    def _show_detection(self, detection, ctx) -> None:
        while self.detected_grid.count():
            item = self.detected_grid.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        for name, value in detection.summary_pairs():
            holder = QWidget()
            holder.setStyleSheet("background: transparent;")
            row = QHBoxLayout(holder)
            row.setContentsMargins(0, 1, 0, 1)
            row.setSpacing(10)
            key = QLabel(name)
            key.setFixedWidth(132)
            key.setStyleSheet(
                f"color: {MUTED}; font-size: 12px; background: transparent;")
            val = QLabel(value)
            val.setWordWrap(True)
            val.setStyleSheet(
                f"color: {INK}; font-size: 12px; font-weight: 600;"
                " background: transparent;")
            row.addWidget(key, 0, Qt.AlignTop)
            row.addWidget(val, 1)
            self.detected_grid.addWidget(holder)

        errors = [f.message for f in ctx.findings.errors]
        self.blockers.setText("\n\n".join(errors))
        self.blockers.setVisible(bool(errors))
        self.detected_card.setVisible(True)

    def _prefill(self, ctx) -> None:
        recent = self._load_recent()
        last = recent[0] if recent else {}
        for token, _text, kind, default in ALL_FIELDS:
            value = ctx.raw.get(token)
            if value in (None, ""):
                value = last.get(token, default)
            widget = self.widgets[token]
            if isinstance(widget, QSpinBox):
                try:
                    widget.setValue(int(float(value or 0)))
                except (TypeError, ValueError):
                    widget.setValue(0)
            else:
                widget.setText("" if value is None else str(value))
        self.widgets[NARRATIVE_FIELD[0]].setPlainText(
            str(last.get(NARRATIVE_FIELD[0], "") or ""))
        for token in ("site_name", "client_contact_name"):
            self.widgets[token].textChanged.connect(
                lambda _t: self._update_field_summaries())
        self._update_field_summaries()

    def _populate_sections(self, ctx) -> None:
        self._sections_list.clear()
        self.toggles.clear()

        flags = {k: bool(v) for k, v in ctx.raw.items() if k.startswith("has_")}
        reasons = {
            "has_history": "No Historical Data sheet in this workbook",
            "has_baseline": "Needs the existing port counts",
            "has_financing": "No loan amount on the DLL Schedule tab",
        }
        years = str(ctx.raw.get("projection_years", 5))
        months = str(ctx.raw.get("loan_term_months", 60))

        for index, section in enumerate(REGISTRY):
            unmet = [f for f in section.requires if not flags.get(f)]
            available = not unmet
            why = "; ".join(reasons.get(f, f) for f in unmet) if unmet else ""
            title = (section.title
                     .replace("{projection_years}", years)
                     .replace("{loan_term_months}", months))
            display = section.list_name or (
                title.title() if title.isupper() else title)
            toggle = SectionToggle(
                section.key, display,
                section.blurb, removable=section.removable,
                available=available, unavailable_reason=why,
            )
            toggle.changed.connect(self._update_section_summary)
            self.toggles.append(toggle)

        self._sections_list.set_items(list(self.toggles))
        self._update_section_summary()

    def _set_all_sections(self, on: bool) -> None:
        for toggle in self.toggles:
            if toggle.available and toggle.removable:
                toggle.box.setChecked(on)
        self._update_section_summary()

    def _update_section_summary(self) -> None:
        off = [t for t in self.toggles if t.available and not t.enabled]
        unavailable = [t for t in self.toggles if not t.available]
        parts = []
        if off:
            parts.append(f"{len(off)} switched off")
        if unavailable:
            parts.append(f"{len(unavailable)} unavailable")
        self.panel_sections.set_summary(
            ", ".join(parts) if parts else "All sections included")

    def _update_field_summaries(self) -> None:
        site = self.widgets["site_name"].text().strip()
        contact = self.widgets["client_contact_name"].text().strip()
        self.panel_client.set_summary(
            f"{site or 'No site name'}   {contact}" if contact
            else (site or "No site name"))

    def _on_cover_changed(self, path) -> None:
        self.panel_cover.set_summary(
            Path(path).name if path else "Using the stock photo")

    def _collect(self) -> dict:
        values: dict = {}
        for token, _text, kind, _default in ALL_FIELDS:
            widget = self.widgets[token]
            values[token] = (widget.value() if isinstance(widget, QSpinBox)
                             else widget.text().strip())
        values[NARRATIVE_FIELD[0]] = self.widgets[
            NARRATIVE_FIELD[0]].toPlainText().strip()
        values["disabled_sections"] = [
            t.key for t in self.toggles if t.available and not t.enabled
        ]
        if self.cover_zone.path:
            values["cover_photo_path"] = str(self.cover_zone.path)
        return values

    def on_generate(self) -> None:
        if not self.workbook:
            return
        inputs = self._collect()
        self._save_recent(inputs)

        self.generate_button.setEnabled(False)
        self.progress.setVisible(True)
        self._set_generated_state(False)
        self.generate_button.setEnabled(False)
        self.status.setStyleSheet(
            f"color: {MUTED}; font-size: 12px; background: transparent;")
        self.status.setText("Starting...")

        self.worker = Worker(self.workbook, inputs)
        self.worker.progress.connect(self._set_status)
        self.worker.finished_ok.connect(self.on_success)
        self.worker.failed.connect(self.on_failure)
        self.worker.start()

    def _set_status(self, text: str) -> None:
        self.status.setText(text.strip() or "Working...")

    def on_success(self, doc: str, qa: str, warnings: list) -> None:
        self.progress.setVisible(False)
        note = f"Saved  {Path(doc).name}"
        if warnings:
            note += f"      {len(warnings)} warning(s) in the QA report"
        self.status.setText(note)
        self.status.setToolTip(doc)
        self.status.setStyleSheet(
            f"color: {INK}; font-size: 12px; font-weight: 600;"
            " background: transparent;")

        self._reconnect(self.open_doc, doc)
        self._reconnect(self.open_qa, qa)
        self._reconnect(self.open_folder, str(Path(doc).parent))
        self._set_generated_state(True)

    def _set_generated_state(self, done: bool) -> None:
        """Swap which action is primary.

        Before: one teal Generate button. After: Open proposal is teal and
        Generate is demoted, so the loud button is never the one that repeats
        the thing you just did.
        """
        for button in (self.open_qa, self.open_folder, self.open_doc):
            button.setVisible(done)
        self.generate_button.setEnabled(True)
        self.generate_button.setText("Generate again" if done else "Generate proposal")
        self.generate_button.setProperty("role", "secondary" if done else "primary")
        self.generate_button.setMinimumWidth(140 if done else 190)
        # A dynamic property change is not picked up until the widget is
        # re-polished; without this the button keeps its old look.
        self.generate_button.style().unpolish(self.generate_button)
        self.generate_button.style().polish(self.generate_button)

    def on_failure(self, message: str, detail: str) -> None:
        self.progress.setVisible(False)
        self.generate_button.setEnabled(True)
        self.status.setText("Could not generate")
        self._error(message, detail)

    def _reconnect(self, button: QPushButton, target: str) -> None:
        """Point a button at a new file.

        The click handler is connected once at build time and reads the target
        back off the button, so nothing is ever disconnected. Reconnecting each
        run either stacked duplicate handlers or warned on the first
        `disconnect()`, when there was nothing connected yet.
        """
        button.setProperty("target", target)

    def _open_target(self, button: QPushButton) -> None:
        target = button.property("target")
        if target:
            _open(str(target))

    def _error(self, message: str, detail: str) -> None:
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Warning)
        box.setWindowTitle("Cannot generate this proposal")
        box.setText(message)
        if detail:
            box.setDetailedText(detail)
        box.exec()

    # ----------------------------------------------------------- persistence

    def _load_recent(self) -> list[dict]:
        path = settings_path()
        if not path.exists():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except (json.JSONDecodeError, OSError):
            return []          # a corrupt settings file must not block the app

    def _save_recent(self, inputs: dict) -> None:
        recent = [entry for entry in self._load_recent() if entry != inputs]
        recent.insert(0, inputs)
        path = settings_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(recent[:RECENT_LIMIT], indent=2),
                            encoding="utf-8")
        except OSError:
            pass               # remembering is a convenience, not a requirement


def _open(target: str) -> None:
    if sys.platform.startswith("win"):
        os.startfile(target)                             # noqa: S606
    elif sys.platform == "darwin":
        subprocess.run(["open", target], check=False)
    else:
        subprocess.run(["xdg-open", target], check=False)


def run() -> int:
    app = QApplication.instance() or QApplication(sys.argv)
    app.setApplicationName("EV Proposal Generator")
    output_dir().mkdir(parents=True, exist_ok=True)
    window = MainWindow()
    window.show()
    return app.exec()
