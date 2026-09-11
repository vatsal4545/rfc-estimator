"""Package the app and its installer into one zip to send.

Run:  python -m tools.make_release

Produces `release/EVProposalGenerator-Setup.zip` holding three files:

    EVProposalGenerator.exe   the application, fully self-contained
    Install.exe               one button, makes the shortcuts
    README.txt                what to do, and what Windows will say

Both executables carry everything they need. The receiving machine needs no
Python, no Excel add-in and no administrator rights.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
RELEASE = ROOT / "release"
APP_EXE = DIST / "EVProposalGenerator.exe"
INSTALLER_EXE = DIST / "Install.exe"
ZIP_NAME = "EVProposalGenerator-Setup.zip"

README = """EV PROPOSAL GENERATOR
=====================

TO INSTALL
----------
1. Right-click this zip in Explorer and choose "Extract All".
   Do not run anything from inside the zip preview - Windows blocks it.
2. Open the extracted folder and double-click  Install.exe
3. Press Install.

That is the whole thing. A shortcut appears on your desktop and in the Start
Menu. No administrator rights are needed and Python is not required.


IF WINDOWS SHOWS A BLUE "WINDOWS PROTECTED YOUR PC" BOX
-------------------------------------------------------
This is SmartScreen. It appears for any program that has not been
code-signed, which costs money per year and this one has not been.

Click "More info", then "Run anyway".

You can also avoid it entirely: right-click the zip BEFORE extracting,
choose Properties, tick "Unblock" at the bottom, then Apply and extract.


WHERE THINGS GO
---------------
The program      %LOCALAPPDATA%\\Programs\\EV Proposal Generator
Finished proposals   Documents\\EV Proposals

Each proposal is saved with a QA report beside it listing every figure in the
document and the exact spreadsheet cell it came from.


USING IT
--------
Drag a financial worksheet (.xlsx) onto the window. Check the detected
settings, fill in the client details, then press Generate proposal.


TO UNINSTALL
------------
Delete the folder above and the two shortcuts. Nothing is written to the
registry.
"""


def build_installer() -> Path:
    """Freeze the installer. tkinter, so it lands near 10 MB rather than 100."""
    print("Building Install.exe ...")
    result = subprocess.run(
        [sys.executable, "-m", "PyInstaller",
         "--onefile", "--windowed", "--name", "Install",
         "--distpath", str(DIST),
         "--workpath", str(ROOT / "build" / "installer"),
         "--specpath", str(ROOT / "build"),
         "--exclude-module", "PySide6",
         "--exclude-module", "matplotlib",
         "--exclude-module", "numpy",
         "--exclude-module", "openpyxl",
         "--noconfirm",
         str(ROOT / "installer" / "install_app.py")],
        cwd=ROOT, capture_output=True, text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout[-3000:] + result.stderr[-3000:])
        raise SystemExit("PyInstaller failed building the installer")
    return INSTALLER_EXE


def main() -> int:
    if not APP_EXE.exists():
        print(f"error: {APP_EXE} missing. Run .\\build.ps1 first.",
              file=sys.stderr)
        return 2

    build_installer()
    if not INSTALLER_EXE.exists():
        print("error: Install.exe was not produced", file=sys.stderr)
        return 2

    RELEASE.mkdir(exist_ok=True)
    archive = RELEASE / ZIP_NAME
    archive.unlink(missing_ok=True)

    # ZIP_DEFLATED on an already-compressed PyInstaller payload buys little,
    # but it keeps the file a normal zip that Explorer opens without help.
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(APP_EXE, APP_EXE.name)
        z.write(INSTALLER_EXE, INSTALLER_EXE.name)
        z.writestr("README.txt", README)

    size_mb = archive.stat().st_size / (1024 * 1024)
    print()
    print(f"  {archive}")
    print(f"  {size_mb:,.0f} MB, 3 files")
    for name in ("EVProposalGenerator.exe", "Install.exe", "README.txt"):
        print(f"    {name}")
    print()
    print("  Send that one zip. The receiving machine needs nothing installed.")
    print("  Unsigned, so SmartScreen will warn once. README explains it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
