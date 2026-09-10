"""ev_proposal_agent - turn an EV financial worksheet into a Word proposal.

Read `CLAUDE.md` at the repo root before changing extraction behaviour. The
short version:

* Two incompatible revenue engines share the sheet name
  `Updated Chargers Revenue Calcul` AND the same cell addresses. Detect the
  engine from `Updated!B3` before reading anything. Assuming is how you ship a
  proposal full of plausible wrong numbers.
* ITC is omitted by default, matching `Financial Worksheet!B7 = B3+(B4+B6)`.
* `Cashflow!G3` hardcodes a `(5*12)` divisor, so 10-year mode with a live loan
  doubles monthly carbon revenue. Generation is blocked in that combination.
"""

from __future__ import annotations

__version__ = "0.1.0"

from .errors import (  # noqa: F401
    FieldNotFound,
    FingerprintMismatch,
    ProposalError,
    TemplateMismatch,
    UnknownEngine,
    ValidationFailed,
    WorkbookNotCalculated,
)

__all__ = [
    "__version__",
    "ProposalError",
    "FingerprintMismatch",
    "UnknownEngine",
    "FieldNotFound",
    "WorkbookNotCalculated",
    "ValidationFailed",
    "TemplateMismatch",
]
