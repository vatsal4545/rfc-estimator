"""QA findings, shared by engine / extract / baseline / validate.

Kept in its own module so `engine.py` can raise findings without importing
`validate.py`, which imports `engine`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Level(str, Enum):
    ERROR = "ERROR"      # abort, write nothing
    WARNING = "WARNING"  # render and collect
    INFO = "INFO"        # note it in the QA report

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


@dataclass
class Finding:
    level: Level
    code: str
    message: str
    where: str | None = None      # "Financial Worksheet!B5", "Cashflow!G3"

    def render(self) -> str:
        loc = f" [{self.where}]" if self.where else ""
        return f"{self.level.value:<7} {self.code}{loc}: {self.message}"


@dataclass
class Findings:
    items: list[Finding] = field(default_factory=list)

    def add(self, level: Level, code: str, message: str, where: str | None = None) -> Finding:
        finding = Finding(level, code, message, where)
        self.items.append(finding)
        return finding

    def error(self, code: str, message: str, where: str | None = None) -> Finding:
        return self.add(Level.ERROR, code, message, where)

    def warn(self, code: str, message: str, where: str | None = None) -> Finding:
        return self.add(Level.WARNING, code, message, where)

    def info(self, code: str, message: str, where: str | None = None) -> Finding:
        return self.add(Level.INFO, code, message, where)

    def of(self, level: Level) -> list[Finding]:
        return [f for f in self.items if f.level is level]

    @property
    def errors(self) -> list[Finding]:
        return self.of(Level.ERROR)

    @property
    def warnings(self) -> list[Finding]:
        return self.of(Level.WARNING)

    def has_errors(self) -> bool:
        return bool(self.errors)

    def extend(self, other: "Findings") -> None:
        self.items.extend(other.items)

    def __iter__(self):
        return iter(self.items)

    def __len__(self) -> int:
        return len(self.items)

    def render(self) -> str:
        if not self.items:
            return "No findings."
        order = {Level.ERROR: 0, Level.WARNING: 1, Level.INFO: 2}
        ranked = sorted(self.items, key=lambda f: order[f.level])
        return "\n".join(f.render() for f in ranked)
