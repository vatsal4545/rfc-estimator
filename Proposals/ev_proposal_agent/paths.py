"""Locate bundled data whether running from source or from a PyInstaller exe.

PyInstaller `--onefile` unpacks bundled data to a temp dir recorded in
`sys._MEIPASS`. Everything that reads `config/` or `templates/` must go through
here, or the packaged .exe will look for files next to itself and find nothing.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _bundle_root() -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    # ev_proposal_agent/paths.py -> repo root
    return Path(__file__).resolve().parent.parent


ROOT = _bundle_root()
CONFIG_DIR = ROOT / "config"
TEMPLATES_DIR = ROOT / "templates"
DOCS_DIR = ROOT / "docs"
INPUTS_DIR = ROOT / "inputs"

FIELD_MAP = CONFIG_DIR / "field_map.yaml"
PROPOSAL_TEMPLATE = TEMPLATES_DIR / "proposal_template.docx"


def documents_dir() -> Path:
    """Where Documents actually is.

    NOT `%USERPROFILE%\\Documents`. This is the same trap the installer already
    hit with the Desktop: on any machine with OneDrive folder backup turned on -
    the Microsoft 365 default - the real Documents is `%OneDrive%\\Documents`,
    and the profile one is either absent or a redirected stub that cannot be
    written to. Guessing it produced a bare "permission denied" the first time
    the app ran on a colleague's machine.

    Windows records the true location in the registry, so ask it. Mirrors
    `installer/install_app.py:desktop_dir()`, which cannot import this module -
    it is a separate frozen tkinter binary.
    """
    try:
        import winreg

        key = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as handle:
            raw, _ = winreg.QueryValueEx(handle, "Personal")
        candidate = Path(os.path.expandvars(raw))
        if candidate.is_dir():
            return candidate
    except (OSError, ImportError):
        pass

    for fallback in (
        Path(os.environ.get("OneDrive", "")) / "Documents",
        Path(os.environ.get("USERPROFILE", "")) / "Documents",
        Path(os.path.expanduser("~")) / "Documents",
    ):
        if str(fallback) != "Documents" and fallback.is_dir():
            return fallback
    return Path(os.path.expanduser("~"))


def is_writable(directory: Path) -> bool:
    """Can we actually create a file in there? Only one way to find out."""
    try:
        directory.mkdir(parents=True, exist_ok=True)
        probe = directory / ".write-probe"
        probe.touch()
        probe.unlink()
        return True
    except OSError:
        return False


def output_dir() -> Path:
    """`<real Documents>\\EV Proposals`, created on demand.

    Falls back to %LOCALAPPDATA% when Documents cannot be written to at all,
    which is what Defender Controlled Folder Access does to an unsigned exe.
    Somewhere the operator can find beats failing outright.
    """
    preferred = documents_dir() / "EV Proposals"
    if is_writable(preferred):
        return preferred
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return Path(base) / "EV Proposal Generator" / "EV Proposals"


def settings_path() -> Path:
    """Where the GUI remembers the last few operator-input sets."""
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return Path(base) / "ZeroImpactEnergy" / "ev-proposal-agent" / "recent.json"
