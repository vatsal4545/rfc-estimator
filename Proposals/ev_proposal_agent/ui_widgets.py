"""Reusable pieces of the desktop app, and the one place its look is defined.

Design read: an internal operator tool, used repeatedly by people who are not
thinking about software while they use it. The job is "drop a file, check what
it found, generate". Dials: VARIANCE 3, MOTION 2, DENSITY 5.

Three decisions drive the window.

**The action bar can never scroll away.** The first version sized the window to
a hardcoded 900px, which is taller than a laptop screen at 125% Windows
scaling, so the Generate button sat below the bottom edge. Everything actionable
now lives in a fixed bar pinned to the bottom of the frame, and the window sizes
itself from the screen it is actually on.

**Progressive disclosure.** Optional settings live behind collapsed panels, each
showing a one-line summary of its own state, so folding something away never
hides that it changed. The default view is a drop zone and a button.

**Hierarchy over decoration.** One accent, the brand teal, on the active step
and the primary action and nothing else. Everything else is type scale, spacing
and a single hairline.
"""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPixmap
from PySide6.QtWidgets import (
    QCheckBox, QFrame, QGraphicsDropShadowEffect, QHBoxLayout, QLabel,
    QPushButton, QScrollArea, QSizePolicy, QVBoxLayout, QWidget,
)

# ---------------------------------------------------------------- tokens

# One accent, locked to the brand teal. Neutrals are a cool slate that sits
# under it without competing.
TEAL = "#0FA9A3"
TEAL_DEEP = "#0B8681"
TEAL_WASH = "#EAF7F6"
TEAL_EDGE = "#B9E4E1"

INK = "#101B22"          # headings
BODY = "#3D4B54"         # body copy
MUTED = "#77868F"        # captions, secondary
FAINT = "#9AA7AE"

CANVAS = "#F4F6F7"       # app background
SURFACE = "#FFFFFF"      # cards
LINE = "#E3E8EA"         # hairlines
LINE_SOFT = "#EFF2F3"
DANGER = "#B23B30"
DANGER_WASH = "#FDF3F2"

# 8px spacing scale, and one radius family: 8 for controls, 12 for cards.
SP = 8
R_CTL = 8
R_CARD = 12

FONT_STACK = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
FONT_DISPLAY = "'Segoe UI Variable Display', 'Segoe UI Semibold', 'Segoe UI', sans-serif"


def app_stylesheet() -> str:
    """Global sheet. Widget-level styling is the exception, not the rule."""
    return f"""
    QWidget {{
        background: {CANVAS};
        color: {BODY};
        font-family: {FONT_STACK};
        font-size: 13px;
    }}
    QScrollArea {{ border: none; background: transparent; }}
    QScrollArea > QWidget > QWidget {{ background: transparent; }}

    QScrollBar:vertical {{
        background: transparent; width: 10px; margin: 4px 2px 4px 0;
    }}
    QScrollBar::handle:vertical {{
        background: #CDD6DA; border-radius: 5px; min-height: 34px;
    }}
    QScrollBar::handle:vertical:hover {{ background: #B4C0C6; }}
    QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
    QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}

    QLabel[role="display"]  {{ font-family: {FONT_DISPLAY}; font-size: 17px;
                               font-weight: 600; color: {INK}; }}
    QLabel[role="subtitle"] {{ font-size: 12px; color: {MUTED}; }}
    QLabel[role="caption"]  {{ font-size: 11px; color: {MUTED}; }}
    QLabel[role="field"]    {{ font-size: 12px; color: {BODY}; }}
    QLabel[role="danger"]   {{ font-size: 12px; color: {DANGER}; }}

    QLineEdit, QSpinBox, QTextEdit {{
        background: {SURFACE};
        border: 1px solid {LINE};
        border-radius: {R_CTL}px;
        padding: 8px 10px;
        color: {INK};
        selection-background-color: {TEAL};
        selection-color: white;
    }}
    QLineEdit:hover, QSpinBox:hover, QTextEdit:hover {{ border-color: #CFD8DC; }}
    QLineEdit:focus, QSpinBox:focus, QTextEdit:focus {{
        border: 1px solid {TEAL}; background: {SURFACE};
    }}
    QSpinBox::up-button, QSpinBox::down-button {{ width: 16px; border: none; }}

    QPushButton {{
        background: {SURFACE};
        border: 1px solid {LINE};
        border-radius: {R_CTL}px;
        padding: 8px 14px;
        color: {BODY};
        font-size: 12px;
    }}
    QPushButton:hover  {{ border-color: {TEAL}; color: {TEAL_DEEP};
                          background: {TEAL_WASH}; }}
    QPushButton:pressed {{ background: {TEAL_EDGE}; }}
    QPushButton:disabled {{ color: {FAINT}; border-color: {LINE_SOFT};
                            background: {SURFACE}; }}

    QPushButton[role="primary"] {{
        background: {TEAL}; border: 1px solid {TEAL}; color: white;
        font-size: 14px; font-weight: 600; padding: 11px 26px;
        border-radius: {R_CTL}px;
    }}
    QPushButton[role="primary"]:hover {{ background: {TEAL_DEEP};
                                         border-color: {TEAL_DEEP};
                                         color: white; }}
    QPushButton[role="primary"]:pressed {{ background: #096F6B; }}
    QPushButton[role="primary"]:disabled {{ background: #CBD5D8;
                                            border-color: #CBD5D8;
                                            color: #F6F8F9; }}

    QPushButton[role="quiet"] {{
        background: transparent; border: none; color: {MUTED};
        padding: 7px 10px; font-size: 12px;
    }}
    QPushButton[role="quiet"]:hover {{ color: {TEAL_DEEP};
                                       background: {TEAL_WASH}; }}

    /* A real bordered button for the post-generate actions. They used to be
       `quiet`, which is borderless and near-white on the white action bar, so
       they read as three blank gaps. */
    QPushButton[role="secondary"] {{
        background: {SURFACE}; border: 1px solid #C6D1D6; color: {INK};
        border-radius: {R_CTL}px; padding: 10px 16px; font-size: 12px;
        font-weight: 500;
    }}
    QPushButton[role="secondary"]:hover {{ border-color: {TEAL};
                                           color: {TEAL_DEEP};
                                           background: {TEAL_WASH}; }}
    QPushButton[role="secondary"]:pressed {{ background: {TEAL_EDGE}; }}

    QCheckBox {{ spacing: 10px; color: {INK}; font-size: 12px; }}
    QCheckBox::indicator {{
        width: 16px; height: 16px;
        border: 1.5px solid #C3CDD2; border-radius: 4px; background: {SURFACE};
    }}
    QCheckBox::indicator:hover {{ border-color: {TEAL}; }}
    QCheckBox::indicator:checked {{ background: {TEAL}; border-color: {TEAL}; }}
    QCheckBox::indicator:unchecked:disabled {{ background: #EDF1F2;
                                               border-color: {LINE}; }}
    /* A locked section IS included. Without this it inherits the plain
       disabled style, renders empty, and "Always included" reads as if the
       section had been switched off. */
    QCheckBox::indicator:checked:disabled {{ background: {TEAL_EDGE};
                                             border-color: #9DD5D1; }}

    QProgressBar {{
        background: {LINE}; border: none; border-radius: 2px;
        height: 4px; text-align: center; color: transparent;
    }}
    QProgressBar::chunk {{ background: {TEAL}; border-radius: 2px; }}
    """


def elevate(widget: QWidget, *, blur: int = 20, dy: int = 2,
            alpha: int = 22) -> QWidget:
    """A soft tinted shadow. Qt stylesheets have no box-shadow, so this is the
    only way to lift a surface off the canvas."""
    effect = QGraphicsDropShadowEffect(widget)
    effect.setBlurRadius(blur)
    effect.setOffset(0, dy)
    effect.setColor(QColor(16, 27, 34, alpha))
    widget.setGraphicsEffect(effect)
    return widget


def label(text: str, role: str = "") -> QLabel:
    widget = QLabel(text)
    if role:
        widget.setProperty("role", role)
    widget.setWordWrap(True)
    return widget


def hairline() -> QFrame:
    line = QFrame()
    line.setFixedHeight(1)
    line.setStyleSheet(f"background: {LINE_SOFT}; border: none;")
    return line


class Card(QFrame):
    """A white surface on the canvas, used only where grouping is real."""

    def __init__(self, *, padding: int = 16):
        super().__init__()
        self.setObjectName("Card")
        self.setStyleSheet(
            f"#Card {{ background: {SURFACE}; border: 1px solid {LINE};"
            f" border-radius: {R_CARD}px; }}"
        )
        self.layout_ = QVBoxLayout(self)
        self.layout_.setContentsMargins(padding, padding, padding, padding)
        self.layout_.setSpacing(SP + 2)

    def add(self, widget: QWidget) -> None:
        self.layout_.addWidget(widget)

    def add_layout(self, layout) -> None:
        self.layout_.addLayout(layout)


class _ClickableRow(QFrame):
    """A frame that emits `clicked`, so a header can hold a real layout."""

    clicked = Signal()

    def mouseReleaseEvent(self, event) -> None:
        if event.button() == Qt.LeftButton and self.rect().contains(event.pos()):
            self.clicked.emit()
        super().mouseReleaseEvent(event)


class Chevron(QWidget):
    """A disclosure triangle, painted rather than typed.

    U+25BE and U+25B8 are missing from some Segoe UI cuts and rendered as empty
    boxes, which made every panel header look broken.
    """

    def __init__(self, size: int = 10):
        super().__init__()
        self._size = size
        self._open = False
        self.setFixedSize(size + 6, size + 6)
        self.setAttribute(Qt.WA_TranslucentBackground)

    def set_open(self, open_: bool) -> None:
        self._open = open_
        self.update()

    def paintEvent(self, event) -> None:
        from PySide6.QtGui import QPainter, QPolygonF
        from PySide6.QtCore import QPointF

        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor(TEAL if self._open else FAINT))
        w = h = self._size
        x = (self.width() - w) / 2
        y = (self.height() - h) / 2
        if self._open:      # pointing down
            points = [QPointF(x, y + h * 0.28), QPointF(x + w, y + h * 0.28),
                      QPointF(x + w / 2, y + h * 0.78)]
        else:               # pointing right
            points = [QPointF(x + w * 0.28, y), QPointF(x + w * 0.28, y + h),
                      QPointF(x + w * 0.78, y + h / 2)]
        painter.drawPolygon(QPolygonF(points))


class Panel(QFrame):
    """A collapsible section with a one-line summary of what is inside.

    The summary is the point. Collapsed, the operator still sees "4 switched
    off" or "site.jpg", so folding something away never hides that it changed.
    """

    toggled_open = Signal(bool)

    def __init__(self, step: str, title: str, summary: str = "",
                 *, open_: bool = False):
        super().__init__()
        self.setObjectName("Panel")
        self.setStyleSheet(
            f"#Panel {{ background: {SURFACE}; border: 1px solid {LINE};"
            f" border-radius: {R_CARD}px; }}"
        )
        self.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Maximum)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # A clickable frame, not a QPushButton: a button does not grow to fit a
        # child layout, so the title and the summary overlapped.
        self._header = _ClickableRow()
        self._header.setObjectName("PanelHeader")
        self._header.setCursor(Qt.PointingHandCursor)
        self._header.setMinimumHeight(54)
        self._header.setStyleSheet(
            "#PanelHeader { background: transparent; border: none;"
            f" border-top-left-radius: {R_CARD}px;"
            f" border-top-right-radius: {R_CARD}px; }}"
            f"#PanelHeader:hover {{ background: {TEAL_WASH}; }}"
        )
        row = QHBoxLayout(self._header)
        row.setContentsMargins(14, 12, 14, 12)
        row.setSpacing(12)

        self._step = QLabel(step)
        self._step.setFixedSize(22, 22)
        self._step.setAlignment(Qt.AlignCenter)
        self._set_step_active(False)

        column = QVBoxLayout()
        column.setSpacing(1)
        self._title = QLabel(title)
        self._title.setStyleSheet(
            f"color: {INK}; font-size: 13px; font-weight: 600;"
            " background: transparent;"
        )
        self._summary = QLabel(summary)
        self._summary.setStyleSheet(
            f"color: {MUTED}; font-size: 11px; background: transparent;")
        column.addWidget(self._title)
        column.addWidget(self._summary)

        self._chevron = Chevron()

        row.addWidget(self._step, 0, Qt.AlignVCenter)
        row.addLayout(column, 1)
        row.addWidget(self._chevron, 0, Qt.AlignVCenter)
        self._header.clicked.connect(self.toggle)
        outer.addWidget(self._header)

        self._divider = hairline()
        outer.addWidget(self._divider)

        self.body = QWidget()
        self.body.setStyleSheet("background: transparent;")
        self._body_layout = QVBoxLayout(self.body)
        self._body_layout.setContentsMargins(14, 12, 14, 14)
        self._body_layout.setSpacing(SP + 2)
        outer.addWidget(self.body)

        self.set_open(open_)

    def _set_step_active(self, active: bool) -> None:
        if active:
            self._step.setStyleSheet(
                f"background: {TEAL}; color: white; border-radius: 11px;"
                " font-size: 11px; font-weight: 600;")
        else:
            self._step.setStyleSheet(
                f"background: {CANVAS}; color: {MUTED}; border-radius: 11px;"
                f" font-size: 11px; font-weight: 600; border: 1px solid {LINE};")

    def add(self, widget: QWidget) -> None:
        self._body_layout.addWidget(widget)

    def add_layout(self, layout) -> None:
        self._body_layout.addLayout(layout)

    def set_summary(self, text: str) -> None:
        self._summary.setText(text)

    def set_open(self, open_: bool) -> None:
        self._open = open_
        self.body.setVisible(open_)
        self._divider.setVisible(open_)
        self._chevron.set_open(open_)
        self._set_step_active(open_)

    def toggle(self) -> None:
        self.set_open(not self._open)
        self.toggled_open.emit(self._open)


class ImageDropZone(QFrame):
    """Drop target for the cover photo, showing a live thumbnail once set.

    Showing the image back is the point: a cover photo the operator cannot see
    before generating is one they find out about in the finished document.
    """

    changed = Signal(object)          # Path or None

    def __init__(self, *, placeholder: str, height: int = 112):
        super().__init__()
        self.setObjectName("ImageDropZone")
        self.setAcceptDrops(True)
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedHeight(height)
        self._path: Path | None = None
        self._placeholder = placeholder
        self._idle()

        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 10, 12, 10)
        layout.setSpacing(14)

        self._thumb = QLabel()
        self._thumb.setFixedSize(QSize(124, height - 20))
        self._thumb.setAlignment(Qt.AlignCenter)
        self._thumb_idle()

        column = QVBoxLayout()
        column.setSpacing(2)
        self._headline = QLabel(placeholder)
        self._headline.setStyleSheet(
            f"color: {INK}; font-size: 12px; font-weight: 600;"
            " background: transparent;")
        self._detail = QLabel("PNG or JPG. Drop a file, or click to browse.")
        self._detail.setStyleSheet(
            f"color: {MUTED}; font-size: 11px; background: transparent;")
        self._detail.setWordWrap(True)
        self._clear = QPushButton("Use the stock photo")
        self._clear.setProperty("role", "quiet")
        self._clear.setVisible(False)
        self._clear.setCursor(Qt.PointingHandCursor)
        self._clear.clicked.connect(lambda: self.set_path(None))

        column.addWidget(self._headline)
        column.addWidget(self._detail)
        column.addWidget(self._clear, 0, Qt.AlignLeft)
        column.addStretch()

        layout.addWidget(self._thumb)
        layout.addLayout(column, 1)

    def _thumb_idle(self) -> None:
        self._thumb.setStyleSheet(
            f"background: {CANVAS}; border: 1px solid {LINE};"
            f" border-radius: {R_CTL}px; color: {FAINT}; font-size: 11px;")
        self._thumb.setText("No photo")

    def _idle(self) -> None:
        self.setStyleSheet(
            f"#ImageDropZone {{ background: {SURFACE};"
            f" border: 1.5px dashed {LINE}; border-radius: {R_CARD}px; }}")

    def _hover(self) -> None:
        self.setStyleSheet(
            f"#ImageDropZone {{ background: {TEAL_WASH};"
            f" border: 1.5px solid {TEAL}; border-radius: {R_CARD}px; }}")

    @property
    def path(self) -> Path | None:
        return self._path

    def set_path(self, path: Path | None) -> None:
        self._path = path
        if path is None:
            self._thumb.setPixmap(QPixmap())
            self._thumb_idle()
            self._headline.setText(self._placeholder)
            self._detail.setText("PNG or JPG. Drop a file, or click to browse.")
            self._clear.setVisible(False)
        else:
            pixmap = QPixmap(str(path))
            if pixmap.isNull():
                self._detail.setText("That file could not be read as an image.")
                self._path = None
            else:
                self._thumb.setPixmap(pixmap.scaled(
                    self._thumb.size(), Qt.KeepAspectRatio,
                    Qt.SmoothTransformation))
                self._thumb.setText("")
                self._thumb.setStyleSheet(
                    f"background: {CANVAS}; border: 1px solid {LINE};"
                    f" border-radius: {R_CTL}px;")
                self._headline.setText(path.name)
                self._detail.setText(
                    f"{pixmap.width()} x {pixmap.height()} px, fitted to the "
                    "cover width.")
                self._clear.setVisible(True)
        self._idle()
        self.changed.emit(self._path)

    def dragEnterEvent(self, event) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            self._hover()

    def dragLeaveEvent(self, event) -> None:
        self._idle()

    def dropEvent(self, event) -> None:
        for url in event.mimeData().urls():
            candidate = Path(url.toLocalFile())
            if candidate.suffix.lower() in {".png", ".jpg", ".jpeg", ".bmp", ".webp"}:
                self.set_path(candidate)
                return
        self._idle()
        self._detail.setText("That is not an image file.")

    def mousePressEvent(self, event) -> None:
        from PySide6.QtWidgets import QFileDialog

        chosen, _ = QFileDialog.getOpenFileName(
            self, "Choose a cover photo", "",
            "Images (*.png *.jpg *.jpeg *.bmp *.webp)")
        if chosen:
            self.set_path(Path(chosen))


class SectionToggle(QWidget):
    """One section: a checkbox and a name, on a single line.

    The first version stacked the name over a description, which made each row
    48px tall. Inside a 250px box that showed two sections at a time out of 28,
    so choosing what to include meant scrolling a list you could never see. The
    description moved to the tooltip and the rows are now single-line, which
    fits the whole registry on screen in two columns.
    """

    changed = Signal()

    def __init__(self, key: str, title: str, blurb: str, *,
                 removable: bool, available: bool, unavailable_reason: str = ""):
        super().__init__()
        self.key = key
        self.removable = removable
        self.available = available
        self.setStyleSheet("background: transparent;")
        self.setFixedHeight(26)

        row = QHBoxLayout(self)
        row.setContentsMargins(4, 0, 4, 0)
        row.setSpacing(8)

        self.box = QCheckBox()
        self.box.setChecked(available)
        self.box.setEnabled(available and removable)
        if available and removable:
            self.box.setCursor(Qt.PointingHandCursor)
        self.box.stateChanged.connect(lambda _s: self.changed.emit())

        self._name = QLabel(title)
        self._name.setStyleSheet(
            f"color: {INK if available else FAINT}; font-size: 12px;"
            " background: transparent;")

        # A lock glyph would need a font that has one. A short word does not.
        self._tag = QLabel("" if available else "unavailable")
        self._tag.setStyleSheet(
            f"color: {FAINT}; font-size: 10px; background: transparent;")

        tip = unavailable_reason if not available else blurb
        if not removable and available:
            tip = f"{blurb}\n\nAlways included; this one cannot be removed."
        for widget in (self, self._name, self.box):
            widget.setToolTip(tip)

        row.addWidget(self.box, 0)
        row.addWidget(self._name, 1)
        row.addWidget(self._tag, 0)

    @property
    def enabled(self) -> bool:
        return self.box.isChecked()


class TwoColumnList(QWidget):
    """Fills column-major across two columns and grows to its natural height.

    Nesting a scroll area inside the page put the operator in two scroll
    contexts at once, which is what made this feel like a lot of scrolling for
    very little list. The page scrolls; the action bar sits outside it and stays
    put, so there is no reason to bound this.
    """

    def __init__(self) -> None:
        super().__init__()
        self.setStyleSheet("background: transparent;")
        from PySide6.QtWidgets import QGridLayout

        self._grid = QGridLayout(self)
        self._grid.setContentsMargins(0, 2, 0, 2)
        self._grid.setHorizontalSpacing(22)
        self._grid.setVerticalSpacing(1)
        self._grid.setColumnStretch(0, 1)
        self._grid.setColumnStretch(1, 1)
        self._widgets: list[QWidget] = []

    def clear(self) -> None:
        while self._grid.count():
            item = self._grid.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self._widgets.clear()

    def set_items(self, widgets: list[QWidget]) -> None:
        self.clear()
        self._widgets = widgets
        rows = (len(widgets) + 1) // 2
        for index, widget in enumerate(widgets):
            # Column-major, so reading down the left column then down the right
            # preserves the order the sections appear in the document.
            column, row = divmod(index, rows)
            self._grid.addWidget(widget, row, column)

    def count(self) -> int:
        return len(self._widgets)


class BoundedList(QScrollArea):
    """A list that scrolls inside itself rather than stretching the page.

    The section list is 28 rows and roughly 1,100px tall. Left to grow it pushes
    everything below it off the bottom of the window, which is how the Generate
    button disappeared in the first place.
    """

    def __init__(self, *, max_height: int = 260):
        super().__init__()
        self.setWidgetResizable(True)
        self.setMaximumHeight(max_height)
        self.setFrameShape(QFrame.NoFrame)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setStyleSheet(
            f"QScrollArea {{ background: {CANVAS}; border: 1px solid {LINE_SOFT};"
            f" border-radius: {R_CTL}px; }}")
        self._inner = QWidget()
        self._inner.setStyleSheet("background: transparent;")
        self.body = QVBoxLayout(self._inner)
        self.body.setContentsMargins(10, 6, 10, 6)
        self.body.setSpacing(0)
        self.setWidget(self._inner)
