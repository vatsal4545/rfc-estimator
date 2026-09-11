"""PyInstaller entry point.

A module-level script rather than `python -m ev_proposal_agent gui`, because
`--onefile` needs a single file to freeze and `-m` invocation does not survive
packaging.
"""

from __future__ import annotations

import sys

from ev_proposal_agent.gui import run

if __name__ == "__main__":
    sys.exit(run())
