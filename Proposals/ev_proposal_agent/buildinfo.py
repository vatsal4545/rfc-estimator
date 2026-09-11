"""Which build is this, actually.

Four different .exe files shipped in one afternoon, every one of them reporting
`__version__ = "0.1.0"`, and the operator had no way to tell whether the app in
front of them contained the fix that had just been made. Every question then
becomes unanswerable: "it still says permission denied" could mean the fix did
not work, or that the old binary is still installed, and nothing on screen
distinguishes those.

So the build stamps itself. `build.ps1` writes `config/build_info.json` just
before PyInstaller packages `config/`, so the stamp travels inside the exe.
Running from source there is no such file, and that is reported honestly as a
dev build rather than guessed at.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from . import __version__
from .paths import CONFIG_DIR

BUILD_INFO = CONFIG_DIR / "build_info.json"


def build_info() -> dict:
    """`{version, built, stamp, frozen}`. Never raises - it is a label."""
    data: dict = {}
    try:
        if BUILD_INFO.exists():
            data = json.loads(BUILD_INFO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}

    return {
        "version": data.get("version") or __version__,
        "built": data.get("built") or "not packaged",
        "stamp": data.get("stamp") or "dev",
        "frozen": bool(getattr(sys, "frozen", False)),
    }


def build_label() -> str:
    """One short line for a title bar or a report header.

    Includes the content stamp, not just the timestamp: two builds a minute
    apart look identical by clock but differ by stamp, and the stamp is what
    answers "is my fix in this one".
    """
    info = build_info()
    if info["stamp"] == "dev":
        return f"v{info['version']} (running from source)"
    return f"v{info['version']} - build {info['built']} [{info['stamp']}]"
