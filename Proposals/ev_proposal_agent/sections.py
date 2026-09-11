"""Which sections survive, what number each one gets, and where that number shows.

A proposal is not always all 29 sections. A site with no charging history has
nothing to put in Sections 3, 3A and 3B. A cash purchase has nothing to put in
14, 17 and 17A-17D. Dropping a section means renumbering everything after it,
and the number appears in **three** places that must agree:

    1. the table of contents on page 2
    2. the "Proposal contents" table inside Section 2
    3. the teal badge cell at the head of the section itself

Miss one and the document contradicts itself. So all three are regenerated from
this registry rather than edited by hand.

Continuation sections (3A, 7A, 17B) take their parent's number plus a letter, so
they follow the parent automatically and never consume a number of their own.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable


@dataclass(frozen=True)
class Section:
    """One entry in the proposal. `key` is stable; the printed number is not."""

    key: str
    title: str
    parent: str | None = None      # set on continuations: 3A's parent is 3
    suffix: str = ""               # "A", "B", ... for continuations
    requires: tuple[str, ...] = ()  # context flags that must all be truthy
    subtitle: str = ""             # "Continuation of Section 3"
    in_contents: bool = True       # continuations are not listed separately
    # Sections the operator may switch off in the app. The three that stay on
    # are the ones a proposal is not a proposal without: what is being offered,
    # who it is for, and the terms it is offered under.
    removable: bool = True
    blurb: str = ""                # tooltip text in the app's section list
    # Overrides the title in the app's list. The three financing appendices
    # share one title, so the list showed three identical rows.
    list_name: str = ""

    @property
    def is_continuation(self) -> bool:
        return self.parent is not None


# Order is the reading order of the document. Titles match the template badges
# exactly, because the renumberer finds sections by matching them.
REGISTRY: tuple[Section, ...] = (
    Section("executive_summary", "EXECUTIVE SUMMARY", removable=False,
            blurb="The recommendation, the cost and the payback in one page."),
    Section("overview", "PROPOSAL OVERVIEW AND PROJECT INFORMATION", removable=False,
            blurb="Client, site, address, date and validity."),

    Section("history", "HISTORICAL USAGE AND EXISTING CONDITIONS",
            requires=("has_history",),
            blurb="What the site earned before, from the utilization report."),
    Section("history_actuals", "FULL-HISTORY ACTUALS",
            parent="history", suffix="A", requires=("has_history",),
            subtitle="Continuation of Section {parent}", in_contents=False,
            blurb="The full statistics table behind Section 3."),
    Section("history_baseline", "HISTORICAL OPERATING BASELINE",
            parent="history", suffix="B",
            requires=("has_history", "has_baseline"),
            subtitle="Continuation of Section {parent}", in_contents=False,
            blurb="The old equipment's operating economics, recomputed."),

    Section("methodology", "REVENUE PROJECTION METHODOLOGY",
            blurb="How the revenue forecast is built, layer by layer."),
    Section("assumptions", "KEY MODELING ASSUMPTIONS",
            parent="methodology", suffix="A",
            subtitle="Continuation of Section {parent}", in_contents=False,
            blurb="Rates, hours, downtime and growth used in the model."),

    Section("projection", "{projection_years}-YEAR REVENUE AND ECONOMIC BENEFIT PROJECTION",
            blurb="Year-by-year revenue and total economic benefit."),

    Section("configuration", "PROPOSED CHARGING CONFIGURATION",
            blurb="The chargers being installed and why."),
    Section("equipment_details", "CHARGING EQUIPMENT DETAILS",
            parent="configuration", suffix="A",
            subtitle="Continuation of Section {parent}", in_contents=False,
            blurb="Model, ports, rating and payment per level."),

    Section("roi", "RETURN ON INVESTMENT",
            blurb="Cost breakdown and return over the horizon."),
    Section("cashflow_consolidated", "CONSOLIDATED {projection_years}-YEAR CASHFLOW",
            parent="roi", suffix="A",
            subtitle="Continuation of Section {parent}", in_contents=False,
            blurb="Cumulative cashflow and the break-even year."),
    Section("cashflow_charger", "CHARGER REVENUE CASHFLOW",
            parent="roi", suffix="B",
            subtitle="Continuation of Section {parent}", in_contents=False,
            blurb="Charging revenue on its own, without credits."),

    Section("rip_and_replace", "RIP AND REPLACE SCOPE",
            blurb="Removal, disposal and cutover of the old units."),
    Section("infrastructure", "ELECTRICAL AND CIVIL INFRASTRUCTURE SCOPE",
            blurb="Electrical and civil cost categories."),
    Section("evolv", "EVOLV SOFTWARE AND PAYMENT OPERATIONS",
            blurb="Network platform, payments and reporting."),
    Section("om", "OPERATIONS AND MAINTENANCE",
            blurb="Ongoing operations and maintenance."),
    Section("warranty", "WARRANTY AND SERVICE COVERAGE",
            blurb="Coverage layers and who is responsible for what."),
    Section("carbon", "CARBON CREDITS AND ENVIRONMENTAL VALUE",
            blurb="Environmental credits and the terms they depend on."),

    Section("incentives", "INCENTIVES, TAX BENEFITS AND FINANCING",
            blurb="Grants, tax credits and the capital stack."),

    Section("delivery", "PROJECT DELIVERY PLAN AND SCHEDULE",
            blurb="Milestones and the construction timeline."),
    Section("scope_of_work", "DETAILED SCOPE OF WORK",
            blurb="Detailed work packages."),

    Section("financing", "FINANCING OPTIONS", requires=("has_financing",),
            blurb="The DLL loan schedule."),
    Section("financing_monthly", "MODELED MONTHLY CASHFLOW",
            parent="financing", suffix="A", requires=("has_financing",),
            subtitle="Continuation of Section {parent}", in_contents=False,
            blurb="Monthly cashflow across the financing term."),
    Section("financing_table_1", "{loan_term_months}-MONTH FINANCING CASHFLOW",
            list_name=f"Financing cashflow, months 1 to 25",
            parent="financing", suffix="B", requires=("has_financing",),
            subtitle="Appendix to Section {parent}", in_contents=False,
            blurb="Months 1 to 25."),
    Section("financing_table_2", "{loan_term_months}-MONTH FINANCING CASHFLOW",
            list_name=f"Financing cashflow, months 26 to 50",
            parent="financing", suffix="C", requires=("has_financing",),
            subtitle="Appendix to Section {parent}", in_contents=False,
            blurb="Months 26 to 50."),
    Section("financing_table_3", "{loan_term_months}-MONTH FINANCING CASHFLOW",
            list_name=f"Financing cashflow, months 51 to 60",
            parent="financing", suffix="D", requires=("has_financing",),
            subtitle="Appendix to Section {parent}", in_contents=False,
            blurb="Months 51 to 60."),

    Section("terms", "TERMS, PROPOSAL VALIDITY AND ACCEPTANCE", removable=False,
            blurb="Disclaimers, validity and the acceptance block."),
)

BY_KEY = {s.key: s for s in REGISTRY}


@dataclass
class ResolvedSection:
    """A section that survived, with the number it will actually print."""

    section: Section
    number: str            # "7" or "7A"
    title: str             # with {projection_years} etc. substituted
    subtitle: str

    @property
    def key(self) -> str:
        return self.section.key

    @property
    def in_contents(self) -> bool:
        return self.section.in_contents


@dataclass
class Plan:
    """The full numbering decision for one render."""

    sections: list[ResolvedSection] = field(default_factory=list)
    dropped: list[tuple[Section, str]] = field(default_factory=list)
    # Sections the operator tried to remove that are not removable.
    forced_on: list[Section] = field(default_factory=list)

    @property
    def by_key(self) -> dict[str, ResolvedSection]:
        return {r.key: r for r in self.sections}

    def number_of(self, key: str) -> str | None:
        found = self.by_key.get(key)
        return found.number if found else None

    def is_shown(self, key: str) -> bool:
        return key in self.by_key

    def toc_rows(self) -> list[dict[str, str]]:
        """Page-2 table of contents: every surviving section, continuations
        included, because a reader looking for 17C needs to find it."""
        return [{"number": r.number, "title": _titlecase(r.title), "page": ""}
                for r in self.sections]

    def contents_rows(self) -> list[dict[str, str]]:
        """Section 2's "Proposal contents" grid: top-level sections only."""
        return [{"number": r.number, "title": _titlecase(r.title)}
                for r in self.sections if r.in_contents]

    def contents_pairs(self) -> list[dict[str, str]]:
        """The same list folded into the reference's two-column layout.

        The reference splits 18 sections down the left then continues down the
        right, rather than snaking left-right. Preserved so a suppressed section
        does not reflow the whole grid into a different shape.
        """
        rows = self.contents_rows()
        half = (len(rows) + 1) // 2
        left, right = rows[:half], rows[half:]
        out = []
        for i in range(half):
            entry = {
                "number": left[i]["number"], "title": left[i]["title"],
                "number2": "", "title2": "",
            }
            if i < len(right):
                entry["number2"] = right[i]["number"]
                entry["title2"] = right[i]["title"]
            out.append(entry)
        return out

    def flags(self) -> dict[str, bool]:
        """`show_<key>` for every section, for the template's `{%p if %}` tags."""
        shown = self.by_key
        return {f"show_{s.key}": s.key in shown for s in REGISTRY}


def _titlecase(upper: str) -> str:
    """Badges are ALL CAPS; the contents tables are sentence case.

    Acronyms and the model name stay upright - "EVOLV Software" not "Evolv
    Software", "Return on Investment" not "Return On Investment".
    """
    keep_upper = {"EVOLV", "EV", "ROI", "O&M", "DC"}
    small = {"and", "on", "of", "to", "the", "for", "in", "a", "an"}
    words = upper.split()
    out: list[str] = []
    for i, word in enumerate(words):
        core = word.strip(",")
        trail = word[len(core):]
        if core in keep_upper or core.startswith("{"):
            out.append(core + trail)
        elif core[0].isdigit():
            # "5-YEAR" -> "5-Year", "60-MONTH" -> "60-Month". The leading digits
            # capitalize() would otherwise leave the rest of the word shouting.
            out.append("-".join(
                p if p.isdigit() else p.capitalize() for p in core.split("-")
            ) + trail)
        elif i > 0 and core.lower() in small:
            out.append(core.lower() + trail)
        else:
            # Capitalise each hyphenated part: "FULL-HISTORY" -> "Full-History",
            # not "Full-history".
            out.append("-".join(p.capitalize() for p in core.split("-")) + trail)
    return " ".join(out)


def build_plan(context_flags: dict, *, substitutions: dict | None = None,
               disabled: Iterable[str] = ()) -> Plan:
    """Decide which sections render and renumber the survivors.

    `context_flags` is the render context: anything named in a section's
    `requires` is looked up there and must be truthy.

    `disabled` is the operator's own choice from the app. It is applied on top
    of the data-driven rules, and it cannot switch off a section marked
    `removable=False` - a proposal without terms or without an executive summary
    is not a proposal, and letting a tick-box produce one is not a feature.
    """
    substitutions = substitutions or {}
    turned_off = set(disabled)
    plan = Plan()
    next_number = 1
    parent_numbers: dict[str, str] = {}

    for section in REGISTRY:
        unmet = [flag for flag in section.requires if not context_flags.get(flag)]
        if unmet:
            plan.dropped.append((section, ", ".join(unmet)))
            continue

        if section.key in turned_off:
            if not section.removable:
                plan.forced_on.append(section)
            else:
                plan.dropped.append((section, "switched off in the app"))
                continue

        # A continuation cannot outlive its parent - 7A with no 7 is nonsense.
        if section.parent and section.parent not in parent_numbers:
            plan.dropped.append((section, f"parent section '{section.parent}' not shown"))
            continue

        if section.is_continuation:
            number = f"{parent_numbers[section.parent]}{section.suffix}"
        else:
            number = str(next_number)
            next_number += 1
            parent_numbers[section.key] = number

        title = _substitute(section.title, substitutions)
        subtitle = _substitute(
            section.subtitle.replace("{parent}", parent_numbers.get(section.parent or "", "")),
            substitutions,
        )
        plan.sections.append(ResolvedSection(section, number, title, subtitle))

    return plan


def _substitute(text: str, values: dict) -> str:
    for key, value in values.items():
        text = text.replace("{" + key + "}", str(value))
    return text


def describe(plan: Plan) -> list[str]:
    """Lines for the QA report."""
    lines = [f"{len(plan.sections)} sections rendered:"]
    for resolved in plan.sections:
        lines.append(f"  {resolved.number:<4} {resolved.title}")
    if plan.dropped:
        lines.append("")
        lines.append(f"{len(plan.dropped)} sections suppressed:")
        for section, why in plan.dropped:
            lines.append(f"  {section.title}  ({why})")
    return lines


def numbering_is_consistent(plan: Plan) -> list[str]:
    """Problems with the numbering itself. Empty list means it is sound."""
    problems: list[str] = []
    numbers = [r.number for r in plan.sections if not r.section.is_continuation]
    expected = [str(i) for i in range(1, len(numbers) + 1)]
    if numbers != expected:
        problems.append(f"top-level numbering is not 1..N: {numbers}")

    seen: set[str] = set()
    for resolved in plan.sections:
        if resolved.number in seen:
            problems.append(f"duplicate section number {resolved.number}")
        seen.add(resolved.number)

    for resolved in plan.sections:
        if resolved.section.is_continuation:
            parent = plan.number_of(resolved.section.parent)
            if parent is None or not resolved.number.startswith(parent):
                problems.append(
                    f"continuation {resolved.number} does not follow its parent {parent}"
                )
    return problems
