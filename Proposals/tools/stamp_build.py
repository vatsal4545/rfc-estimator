"""Write `config/build_info.json` immediately before PyInstaller packages it.

The stamp is a hash of everything that actually ends up inside the exe and
changes its behaviour - the extractor, the field map and the template. A clock
time alone cannot answer "is my fix in this build"; two builds a minute apart
look the same. The stamp differs the moment any input does.
"""

from __future__ import annotations

import hashlib
import json
import sys
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ev_proposal_agent import __version__          # noqa: E402

INPUTS = [
    *sorted((ROOT / "ev_proposal_agent").glob("*.py")),
    ROOT / "config" / "field_map.yaml",
    ROOT / "templates" / "proposal_template.docx",
    ROOT / "run_gui.py",
]


def content_stamp() -> str:
    digest = hashlib.sha256()
    for path in INPUTS:
        if path.exists():
            digest.update(path.name.encode("utf-8"))
            digest.update(path.read_bytes())
    return digest.hexdigest()[:8]


def main() -> int:
    target = ROOT / "config" / "build_info.json"
    payload = {
        "version": __version__,
        "built": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "stamp": content_stamp(),
    }
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"  build {payload['built']}  stamp {payload['stamp']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
