"""One-button installer for EV Proposal Generator.

Ships beside the application in the release zip. The operator extracts the zip,
double-clicks this, presses Install, and gets a Start Menu entry and a desktop
shortcut. Nothing else is asked and nothing else is shown.

Written against tkinter rather than PySide6 on purpose: tkinter is in the
standard library, so this packages to about 10 MB instead of another 100, and
the download stays roughly the size of the application itself.

Installs per-user, into `%LOCALAPPDATA%\\Programs`. That needs no administrator
rights, which matters because most of the people receiving this will not have
them, and a UAC prompt is exactly the kind of thing that stops an install.
"""

from __future__ import annotations

import os
import subprocess
import sys
import shutil
import threading
import tkinter as tk
from pathlib import Path
from tkinter import font as tkfont

APP_NAME = "EV Proposal Generator"
EXE_NAME = "EVProposalGenerator.exe"

TEAL = "#0FA9A3"
TEAL_DEEP = "#0B8681"
INK = "#101B22"
BODY = "#3D4B54"
MUTED = "#77868F"
CANVAS = "#F4F6F7"
SURFACE = "#FFFFFF"
DANGER = "#B23B30"


def source_exe() -> Path:
    """The application sitting next to this installer.

    `sys.executable` when frozen, so it works from wherever the zip was
    extracted rather than from the working directory, which Explorer sets to
    something unhelpful when you double-click.
    """
    here = Path(sys.executable).parent if getattr(sys, "frozen", False) \
        else Path(__file__).resolve().parent
    return here / EXE_NAME


def install_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(base) / "Programs" / APP_NAME


def desktop_dir() -> Path | None:
    """Where the desktop actually is.

    Not `%USERPROFILE%\\Desktop`. On any machine with OneDrive folder backup
    turned on - which is the default for Microsoft 365 - the real desktop is
    `%OneDrive%\\Desktop` and the profile one does not exist at all, so
    guessing silently drops the shortcut. Windows records the true location in
    the registry, so ask it.
    """
    try:
        import winreg

        key = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as handle:
            raw, _ = winreg.QueryValueEx(handle, "Desktop")
        candidate = Path(os.path.expandvars(raw))
        if candidate.is_dir():
            return candidate
    except OSError:
        pass

    for fallback in (
        Path(os.environ.get("OneDrive", "")) / "Desktop",
        Path(os.environ.get("USERPROFILE", "")) / "Desktop",
    ):
        if fallback.is_dir():
            return fallback
    return None


def _run_hidden(script: str) -> None:
    """PowerShell with no console window."""
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        startupinfo=startup, capture_output=True, check=False,
    )


def make_shortcut(target: Path, link: Path, description: str) -> None:
    """Create a .lnk through WScript.Shell.

    A COM call via PowerShell rather than pywin32, so the installer keeps to
    the standard library and stays small.
    """
    link.parent.mkdir(parents=True, exist_ok=True)
    _run_hidden(
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut("
        f"'{link}'); $s.TargetPath = '{target}'; "
        f"$s.WorkingDirectory = '{target.parent}'; "
        f"$s.Description = '{description}'; $s.Save()"
    )


def app_is_running() -> bool:
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    result = subprocess.run(
        ["tasklist", "/FI", f"IMAGENAME eq {EXE_NAME}"],
        capture_output=True, text=True, startupinfo=startup, check=False,
    )
    return EXE_NAME.lower() in (result.stdout or "").lower()


def install() -> Path:
    """Copy the app and create both shortcuts. Returns the installed path."""
    source = source_exe()
    if not source.exists():
        raise FileNotFoundError(
            f"{EXE_NAME} is not next to this installer.\n\n"
            "Extract the whole zip to a folder first, then run Install from "
            "there. Windows will not let it work from inside the zip preview."
        )
    if app_is_running():
        raise RuntimeError(
            f"{APP_NAME} is currently open.\n\n"
            "Close it and press Install again."
        )

    target_dir = install_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / EXE_NAME
    shutil.copy2(source, target)

    desktop = desktop_dir()
    if desktop:
        make_shortcut(target, desktop / f"{APP_NAME}.lnk", APP_NAME)

    start_menu = Path(os.environ.get("APPDATA", "")) / (
        "Microsoft/Windows/Start Menu/Programs")
    make_shortcut(target, start_menu / f"{APP_NAME}.lnk", APP_NAME)

    # The Start Menu entry is the one that always works, so a missing desktop
    # is worth saying rather than swallowing.
    if not desktop:
        raise _PartialInstall(target)
    return target


class _PartialInstall(Exception):
    """Installed, but the desktop shortcut could not be placed."""

    def __init__(self, target: Path):
        super().__init__("Installed. Find it in the Start Menu - the desktop "
                         "folder could not be located on this machine.")
        self.target = target


class Installer(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(f"Install {APP_NAME}")
        self.configure(bg=SURFACE)
        self.resizable(False, False)
        self._installed: Path | None = None

        width, height = 420, 250
        x = (self.winfo_screenwidth() - width) // 2
        y = (self.winfo_screenheight() - height) // 3
        self.geometry(f"{width}x{height}+{x}+{y}")

        title_font = tkfont.Font(family="Segoe UI", size=15, weight="bold")
        body_font = tkfont.Font(family="Segoe UI", size=9)
        button_font = tkfont.Font(family="Segoe UI", size=11, weight="bold")

        mark = tk.Label(self, text="ZI", bg=TEAL, fg="white",
                        font=tkfont.Font(family="Segoe UI", size=11, weight="bold"),
                        width=3, height=1)
        mark.pack(pady=(26, 12))

        tk.Label(self, text=APP_NAME, bg=SURFACE, fg=INK,
                 font=title_font).pack()
        self.subtitle = tk.Label(
            self, text="Adds a desktop and Start Menu shortcut.\n"
                       "No administrator rights needed.",
            bg=SURFACE, fg=MUTED, font=body_font, justify="center")
        self.subtitle.pack(pady=(6, 18))

        self.button = tk.Button(
            self, text="Install", command=self.on_install,
            bg=TEAL, fg="white", font=button_font,
            activebackground=TEAL_DEEP, activeforeground="white",
            relief="flat", bd=0, padx=42, pady=10, cursor="hand2",
        )
        self.button.pack()

        self.status = tk.Label(self, text="", bg=SURFACE, fg=MUTED,
                               font=body_font, wraplength=360, justify="center")
        self.status.pack(pady=(14, 0))

    def on_install(self) -> None:
        if self._installed:                    # second press: launch
            subprocess.Popen([str(self._installed)],
                             cwd=str(self._installed.parent))
            self.after(400, self.destroy)
            return

        self.button.config(state="disabled", text="Installing...")
        self.status.config(text="", fg=MUTED)
        self.update_idletasks()
        threading.Thread(target=self._work, daemon=True).start()

    def _work(self) -> None:
        try:
            target = install()
        except _PartialInstall as partial:     # usable, just no desktop icon
            self.after(0, self._done, partial.target, str(partial))
        except Exception as exc:               # shown, never a traceback
            self.after(0, self._failed, str(exc))
        else:
            self.after(0, self._done, target)

    def _done(self, target: Path, note: str = "") -> None:
        self._installed = target
        self.button.config(state="normal", text="Open the app", bg=TEAL)
        self.subtitle.config(
            text=note or "Installed. A shortcut is on your desktop and in the "
                         "Start Menu.")
        self.status.config(text=str(target.parent), fg=MUTED)

    def _failed(self, message: str) -> None:
        self.button.config(state="normal", text="Try again")
        self.status.config(text=message, fg=DANGER)


def main() -> int:
    Installer().mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
