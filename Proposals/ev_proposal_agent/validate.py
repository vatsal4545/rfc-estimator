"""The gate between a context and a document.

Three levels, and the difference matters:

    ERROR    abort. Write nothing. The proposal would carry a wrong number.
    WARNING  render, but say so. The operator has to decide.
    INFO     a section was suppressed, or an assumption was taken.

Errors are reserved for things that make the output *wrong*, not merely
surprising. A workbook whose grand total does not equal its own subtotals is an
error. A workbook wired to Standard-Medium is a warning, because it is unusual
but internally consistent.
"""

from __future__ import annotations

from typing import Any

from .findings import Findings, Level

CENT = 0.011
DOLLAR = 1.0


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _close(a: Any, b: Any, tol: float) -> bool:
    x, y = _num(a), _num(b)
    return x is not None and y is not None and abs(x - y) <= tol


def validate(ctx, fm: dict, plan=None) -> Findings:
    """Run every check and return the findings.

    Non-mutating: the returned list is seeded with what detection and extraction
    already reported, so the QA report is one list rather than three, but
    `ctx.findings` is left alone. Appending into the context instead would make
    a second `validate()` call duplicate every finding it raised the first time,
    which is exactly what happens when the GUI re-validates after an edit.
    """
    findings = Findings(list(ctx.findings.items))

    _check_cost_hierarchy(ctx, findings)
    _check_discount(ctx, findings)
    _check_infrastructure_foots(ctx, findings)
    _check_cost_vs_loan(ctx, findings)
    _check_cashflow(ctx, findings)
    _check_evse_total(ctx, findings)
    _check_evolv(ctx, findings)
    _check_financing(ctx, findings)
    _check_emitted_tokens(ctx, findings)
    if plan is not None:
        _check_numbering(plan, findings)
    return findings


def _check_cost_hierarchy(ctx, findings: Findings) -> None:
    """The cost stack is a tree, not a list.

    `B16` already contains `B17..B21`, so a flat sum double-counts an entire
    equipment invoice. Each subtotal is checked against its own children.

    The root is `cost_after_discount`, NOT `cost_grand_total` - see the comment
    on `costs.hierarchy` in the map. Every component row is Internal Summary
    column D (customer price); the grand total is column B (list price). They
    only coincide at a 0% discount.
    """
    hierarchy = ctx.raw.get("_cost_hierarchy") or {}
    for parent, children in hierarchy.items():
        expected = sum(ctx.num(child) for child in children)
        actual = ctx.num(parent)
        if not _close(actual, expected, DOLLAR):
            findings.error(
                "cost-subtotal-mismatch",
                f"The '{parent.replace('cost_', '').replace('_', ' ')}' subtotal "
                f"reads {ctx.formatted.get(parent)} but its component rows add "
                f"up to ${expected:,.2f}. The cost table would not foot.",
                where=ctx.sources.get(parent),
            )


def _check_discount(ctx, findings: Findings) -> None:
    """A gap between the two totals is a discount, not an error - but say so.

    `cost_grand_total` is the list total and `cost_after_discount` the customer
    total. Section 7 prints both, and every component row between them is the
    discounted figure, so a reader who does not know a discount was applied will
    try to add the rows up to the wrong number.
    """
    listed = ctx.num("cost_grand_total")
    net = ctx.num("cost_after_discount")
    if listed and net and listed - net > DOLLAR:
        findings.info(
            "discount-applied",
            f"The cost table prints customer pricing after a "
            f"${listed - net:,.2f} discount off the "
            f"{ctx.formatted.get('cost_grand_total')} list total. Both totals "
            "appear in Section 7; the component rows are the discounted ones.",
            where=ctx.sources.get("cost_after_discount"),
        )


def _check_infrastructure_foots(ctx, findings: Findings) -> None:
    """Section 8's rows must add up to the electrical subtotal.

    True by construction while "Other / miscellaneous" is the residual, so this
    is a guard against someone later "simplifying" it into a sum of the known
    leftovers. That is exactly the shape the old code had, and it quietly
    dropped $107,152.52 - 56% of the electrical scope - on Best Western,
    including $68,970 of switchgear and $20,933 of ADA work.
    """
    subtotal = ctx.num("cost_electrical_subtotal")
    other = _as_float(ctx.get("cost_electrical_other"))
    if not subtotal or other is None:
        return

    named = [
        "cost_wires_conduits", "cost_switchgear", "cost_subpanels",
        "cost_striping_bollards", "cost_concrete", "cost_ada",
        "cost_dump_waste", "cost_construction_equip",
    ]
    printed = sum(ctx.num(t) for t in named) + other
    if not _close(printed, subtotal, DOLLAR):
        findings.error(
            "infrastructure-does-not-foot",
            f"Section 8's rows add up to ${printed:,.2f} but the electrical "
            f"subtotal is {ctx.formatted.get('cost_electrical_subtotal')} "
            "(Internal Summary!D13). The infrastructure breakdown would not "
            "foot, so part of the electrical scope is missing from the table.",
            where=ctx.sources.get("cost_electrical_subtotal"),
        )

    if other < -0.005:
        findings.warn(
            "infrastructure-other-negative",
            f"Section 8's 'Other / miscellaneous' residual is negative "
            f"(${other:,.2f}), which means the named rows already exceed the "
            f"{ctx.formatted.get('cost_electrical_subtotal')} electrical "
            "subtotal. Check that no row is double-counted in the cost stack.",
            where=ctx.sources.get("cost_electrical_other"),
        )


def _check_cost_vs_loan(ctx, findings: Findings) -> None:
    upfront = abs(ctx.num("roi_total_costs_upfront"))
    after_discount = ctx.num("cost_after_discount")
    if not _close(upfront, after_discount, CENT):
        findings.error(
            "cost-upfront-mismatch",
            f"Total Costs Upfront ({ctx.formatted.get('roi_total_costs_upfront')}) "
            f"does not match the Remaining Balance after Discount "
            f"({ctx.formatted.get('cost_after_discount')}). Section 7's ROI table "
            "would contradict its cost table.",
            where=ctx.sources.get("roi_total_costs_upfront"),
        )
    if ctx.raw.get("has_financing"):
        loan = ctx.num("loan_amount")
        if not _close(loan, after_discount, CENT):
            findings.warn(
                "loan-differs-from-project-cost",
                f"The financed amount ({ctx.formatted.get('loan_amount')}) is not "
                f"the project cost ({ctx.formatted.get('cost_after_discount')}). "
                "That is valid if the client is contributing capital, but the "
                "proposal does not explain the difference.",
                where=ctx.sources.get("loan_amount"),
            )


def _check_cashflow(ctx, findings: Findings) -> None:
    rows = ctx.tables.get("consolidated_cashflow") or []
    if not rows:
        findings.error("cashflow-empty",
                       "The consolidated cashflow table is empty. Section 7A "
                       "would print no rows.")
        return

    years = int(ctx.raw.get("projection_years") or 0)
    if years and len(rows) != years + 1:
        findings.error(
            "cashflow-wrong-length",
            f"The cashflow table has {len(rows)} rows but the workbook is set "
            f"to a {years}-year projection, which needs {years + 1} "
            "(year 0 plus each year).",
            where=ctx.sources.get("consolidated_cashflow"),
        )

    if not _close(rows[0].get("cumulative"), -ctx.num("cost_after_discount"), DOLLAR):
        findings.error(
            "cashflow-bad-start",
            "Year 0 of the cashflow is not the negative of the project cost, so "
            "the break-even year cannot be trusted.",
            where=ctx.sources.get("consolidated_cashflow"),
        )

    for previous, current in zip(rows, rows[1:]):
        running = _num(previous.get("cumulative"))
        annual = _num(current.get("annual"))
        cumulative = _num(current.get("cumulative"))
        if running is None or annual is None or cumulative is None:
            continue
        if abs((running + annual) - cumulative) > DOLLAR:
            findings.error(
                "cashflow-not-cumulative",
                f"Year {current.get('year')} cumulative "
                f"({current.get('cumulative_fmt')}) is not the prior cumulative "
                f"plus this year's cashflow. The table does not add up.",
                where=ctx.sources.get("consolidated_cashflow"),
            )
            break


def _check_evse_total(ctx, findings: Findings) -> None:
    rows = ctx.tables.get("charger_cashflow") or []
    total = sum(ctx_num for r in rows
                if (ctx_num := _num(r.get("annual"))) is not None
                and (_num(r.get("year")) or 0) >= 1)
    if rows and not _close(total, ctx.num("roi_evse_revenues"), DOLLAR):
        findings.error(
            "evse-total-mismatch",
            f"EVSE Revenues ({ctx.formatted.get('roi_evse_revenues')}) does not "
            f"equal the sum of the yearly charger cashflow (${total:,.2f}). "
            "Section 7 and Section 7B would disagree.",
            where=ctx.sources.get("roi_evse_revenues"),
        )


def _check_evolv(ctx, findings: Findings) -> None:
    ports = ctx.num("evolv_ports")
    total_ports = ctx.num("total_ports")
    if ports and total_ports and abs(ports - total_ports) > 0.5:
        findings.error(
            "evolv-port-mismatch",
            f"The EVOLV platform is priced for {ports:g} ports but the equipment "
            f"schedule installs {total_ports:g}. One of the two is wrong and the "
            "proposal would quote software for the wrong site.",
            where=ctx.sources.get("evolv_ports"),
        )
    expected = ports * ctx.num("evolv_fee_per_port") * 12
    if ports and not _close(ctx.num("evolv_annual_cost"), expected, 0.05):
        findings.warn(
            "evolv-annual-mismatch",
            f"The EVOLV annual cost ({ctx.formatted.get('evolv_annual_cost')}) is "
            f"not ports x fee x 12 (${expected:,.2f}).",
            where=ctx.sources.get("evolv_annual_cost"),
        )


def _check_financing(ctx, findings: Findings) -> None:
    if not ctx.raw.get("has_financing"):
        return
    payment = ctx.num("loan_monthly_payment")
    count = ctx.num("loan_num_payments")
    total = ctx.num("cf_total_loan_payments")
    if payment and count and total and abs(payment * count - total) > DOLLAR:
        findings.warn(
            "loan-payment-total-mismatch",
            f"{count:g} payments of {ctx.formatted.get('loan_monthly_payment')} "
            f"is ${payment * count:,.2f}, but the Cashflow tab totals "
            f"{ctx.formatted.get('cf_total_loan_payments')}.",
            where=ctx.sources.get("cf_total_loan_payments"),
        )

    _check_amortization_agrees_with_summary(ctx, findings)


def _check_amortization_agrees_with_summary(ctx, findings: Findings) -> None:
    """The schedule and the summary block must describe the SAME loan.

    `DLL Schedule` has two halves that are computed independently: the D5:D10
    summary inputs, and the amortization table from row 18 down. Nothing in the
    workbook forces them to agree, and on a real specimen (Marriott Bakersfield)
    they did not:

        summary     $253,716.82 at $5,191.95/month     (= Financial Worksheet!B43)
        schedule    $345,247.91 at $7,065.00/month     (= the LIST total)

    On the same file the table is also shifted one column left against its own
    headers, so `Int` reads the ending-balance column and `Total_Interest` came
    out as $10,904,157.52 on a $253k loan - which the proposal then printed in
    Section 17's prose, in a document a customer signs.

    Both symptoms are caught by the same two questions: does the schedule start
    at the loan amount, and is the total interest a believable fraction of it.
    Named, not corrected - the workbook is the customer's record, and a schedule
    built on the wrong principal is not something a reader can be talked out of.
    """
    rows = ctx.tables.get("amortization") or []
    amount = ctx.num("loan_amount")
    if not rows or not amount:
        return

    opening = _as_float(rows[0].get("begin"))
    if opening is not None and not _close(opening, amount, DOLLAR):
        findings.error(
            "amortization-principal-mismatch",
            f"The DLL amortization schedule's first beginning balance reads "
            f"${opening:,.2f}, but the loan summary finances "
            f"{ctx.formatted.get('loan_amount')}. Either the schedule was built "
            "on a different principal, or the table is sitting one column off its "
            "headers so this figure is not the balance at all. Section 17's "
            "payment table and its prose would contradict each other. Rebuild the "
            "schedule from the summary inputs, then retry.",
            where="DLL Schedule!C18 vs D5",
        )

    # Interest cannot plausibly exceed the principal over a 5-year term at these
    # rates. This is the shifted-column symptom: `Int` lands on a balance column
    # and the SUMIF adds up balances instead of interest.
    interest = ctx.num("loan_total_interest")
    if interest and interest > amount:
        findings.error(
            "loan-interest-implausible",
            f"Total interest reads {ctx.formatted.get('loan_total_interest')} on a "
            f"{ctx.formatted.get('loan_amount')} loan - more than the principal, "
            "which cannot be right over this term. The usual cause is the "
            "amortization table sitting one column off its headers, so the "
            "Total_Interest name sums ending balances rather than interest. Check "
            "that DLL Schedule row 18 starts with payment number 1 in column A.",
            where=ctx.sources.get("loan_total_interest"),
        )


def _as_float(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _check_emitted_tokens(ctx, findings: Findings) -> None:
    """No printed token may be empty or an Excel error.

    Scoped to *emitted* tokens on purpose: `cost_service_list_price` maps to
    `Financial Worksheet!B20`, which is a live `#REF!` in both real workbooks.
    It is never printed, so it must not block the run.
    """
    bad: list[str] = []
    for token in sorted(ctx.emitted):
        value = ctx.raw.get(token)
        if value is None:
            continue                    # optional prefills are allowed to be blank
        if isinstance(value, str) and value.strip().startswith("#"):
            bad.append(f"{token} = {value} ({ctx.sources.get(token, 'unknown cell')})")
    if bad:
        findings.error(
            "token-is-excel-error",
            "These figures read as Excel errors and would print as errors in the "
            "document: " + "; ".join(bad) + ". Open the workbook and fix the "
            "broken formulas.",
        )


def _check_numbering(plan, findings: Findings) -> None:
    from .sections import numbering_is_consistent

    for problem in numbering_is_consistent(plan):
        findings.error("section-numbering", problem)
    for section, why in plan.dropped:
        findings.info("section-suppressed",
                      f"Section '{section.title}' left out ({why}); the "
                      "remaining sections were renumbered.")


# --------------------------------------------------------------------------
# QA report
# --------------------------------------------------------------------------


def qa_report(ctx, findings: Findings, plan=None, *, output_path=None,
              charts: dict | None = None) -> str:
    """The `_QA.txt` written beside every proposal.

    Every token, its value and the cell it came from, so a figure in the Word
    document can be traced back to the workbook without re-running anything.
    """
    from .sections import describe

    det = ctx.detection
    lines: list[str] = [
        "EV PROPOSAL - QA REPORT",
        "=" * 72,
        "",
    ]
    if output_path:
        lines += [f"Document   {output_path}", ""]

    from .buildinfo import build_label

    lines += [f"Generated by  {build_label()}", ""]
    lines += ["DETECTED", "-" * 72]
    lines += [f"  {line}" for line in det.summary_lines()]
    lines += [""]

    if plan is not None:
        lines += ["SECTIONS", "-" * 72]
        lines += [f"  {line}" for line in describe(plan)]
        lines += [""]

    if charts:
        lines += ["CHARTS", "-" * 72]
        lines += [f"  {name:<34} {path}" for name, path in sorted(charts.items())]
        lines += [""]

    errors, warnings = findings.errors, findings.warnings
    infos = findings.of(Level.INFO)
    lines += [
        "FINDINGS",
        "-" * 72,
        f"  {len(errors)} error(s), {len(warnings)} warning(s), {len(infos)} note(s)",
        "",
    ]
    if findings.items:
        for finding in list(errors) + list(warnings) + list(infos):
            where = f" [{finding.where}]" if finding.where else ""
            lines.append(f"  {finding.level.value}{where}")
            lines += [f"      {chunk}" for chunk in _wrap(finding.message, 66)]
            lines.append("")
    else:
        lines += ["  none", ""]

    lines += ["VALUES", "-" * 72,
              f"  {'token':<32} {'value':<26} source", "  " + "-" * 70]
    for token in sorted(ctx.formatted):
        value = str(ctx.formatted[token])
        if len(value) > 25:
            value = value[:22] + "..."
        lines.append(f"  {token:<32} {value:<26} {ctx.sources.get(token, '')}")
    lines += [""]

    lines += ["TABLES", "-" * 72]
    for name, rows in sorted(ctx.tables.items()):
        lines.append(f"  {name:<32} {len(rows):>4} rows   "
                     f"{ctx.sources.get(name, '')}")
    lines += [""]

    return "\n".join(lines)


def _wrap(text: str, width: int) -> list[str]:
    import textwrap

    return textwrap.wrap(text, width=width) or [""]
