"""Sentences that carry numbers, assembled from the context.

No LLM anywhere in the default path. Every sentence below is a template with
conditionals, because the interesting cases are the ones where the wording has
to change rather than a number: no break-even inside the horizon, no ITC, no
Level 2, no DC fast history.

The one place judgement is genuinely required - Section 3's read of the site
history and Section 6's read of the location - is an operator input. It can
optionally be drafted by the Anthropic API, but only with every numeral in the
response checked against the context first.
"""

from __future__ import annotations

import re
from typing import Any


def _plural(n: float, singular: str, plural: str | None = None) -> str:
    return singular if abs(n - 1) < 1e-9 else (plural or singular + "s")


def executive_summary(ctx) -> str:
    """Section 1's opening paragraph."""
    f = ctx.formatted
    years = ctx.raw.get("projection_years", 5)
    parts = [
        f"This proposal replaces the existing charging equipment at "
        f"{f.get('site_name') or 'the site'} with {f.get('dcfc_mix_sentence', 'new')} "
        f"DC fast charging"
    ]
    if ctx.raw.get("has_l2") and ctx.num("n_ports_l2"):
        parts[0] += (
            f" and {f.get('n_ports_l2')} "
            f"{_plural(ctx.num('n_ports_l2'), 'Level 2 port')}"
        )
    parts[0] += "."

    parts.append(
        f"Total project cost is {f.get('cost_after_discount')} after discount, "
        f"against {f.get('roi_evse_revenues')} of modelled charging revenue and "
        f"{f.get('roi_carbon_credits')} of carbon credits over {years} years."
    )
    breakeven = ctx.raw.get("breakeven_year")
    if breakeven:
        parts.append(f"The model reaches break-even in year {breakeven}.")
    else:
        parts.append(
            f"The model does not reach break-even within the {years}-year "
            "window shown."
        )
    if ctx.raw.get("has_financing"):
        parts.append(
            f"Financing is available through De Lage Landen at "
            f"{f.get('loan_rate')} over {f.get('loan_term_months')} months, "
            f"a payment of {f.get('loan_monthly_payment')} per month."
        )
    return " ".join(parts)


def site_history(ctx) -> str:
    """Section 3's factual lead-in. The analyst's read is a separate token."""
    if not ctx.raw.get("has_history"):
        return ""
    f = ctx.formatted
    lines = [
        f"The site has {f.get('months_in_window')} months of recorded charging "
        f"activity, {f.get('history_window_label')}, totalling "
        f"{f.get('hist_total_revenue')} of revenue."
    ]
    if ctx.num("dcfc_revenue_share") > 0:
        lines.append(
            f"DC fast charging accounts for {f.get('dcfc_revenue_share')} of that, "
            f"{f.get('hist_l3_revenue')}."
        )
    else:
        lines.append("All of it came from Level 2 charging; the site has no DC "
                     "fast charging history.")
    if ctx.num("outage_lost_revenue") > 0:
        lines.append(
            f"An outage in {f.get('outage_window_label')} cost an estimated "
            f"{f.get('outage_lost_revenue')} against the surrounding run rate."
        )
    return " ".join(lines)


def investment(ctx) -> str:
    """Section 7's paragraph under 'Initial investment'."""
    f = ctx.formatted
    breakeven = ctx.raw.get("breakeven_year")
    years = ctx.raw.get("projection_years", 5)
    if breakeven:
        tail = (f"we project a break-even point in year {breakeven}, after which "
                "the modelled cashflow stays positive.")
    else:
        tail = (f"the modelled cashflow does not turn positive within {years} "
                "years. Break-even depends on utilisation rising above the "
                "assumptions used here.")
    return (f"With an initial investment of {f.get('cost_after_discount')}, {tail}")


def breakeven_paragraph(ctx) -> str:
    """Section 7A."""
    f = ctx.formatted
    breakeven = ctx.raw.get("breakeven_year")
    years = ctx.raw.get("projection_years", 5)
    opening = (f"With the initial investment of {f.get('cost_after_discount')}, "
               f"the table below tracks cumulative cashflow across "
               f"{years} years.")
    if breakeven:
        return (f"{opening} Cumulative cashflow first turns positive in year "
                f"{breakeven}, ending the period at {f.get('final_cumulative')}.")
    return (f"{opening} Cumulative cashflow remains negative throughout, ending "
            f"the period at {f.get('final_cumulative')}.")


def roi_summary(ctx) -> str:
    """Section 7's ROI note. The ITC sentence disappears when B5 is zero."""
    f = ctx.formatted
    years = ctx.raw.get("projection_years", 5)
    text = (f"Over {years} years the model shows {f.get('roi_evse_revenues')} of "
            f"charging revenue and {f.get('roi_carbon_credits')} of carbon "
            f"credits against {f.get('cost_after_discount')} of upfront cost, "
            f"for net revenues of {f.get('roi_net_revenues')}.")
    if ctx.raw.get("has_itc"):
        text += (
            f" A federal investment tax credit of {f.get('roi_itc')} is shown "
            "separately and is not included in the net revenues figure."
        )
    return text


def _tier_amount(tier: dict[str, Any]) -> str:
    """The pre-formatted multiplier when the extractor supplied one, else the
    raw value formatted here. Legacy workbooks carry no `mult_fmt`."""
    preformatted = tier.get("mult_fmt")
    if preformatted:
        return str(preformatted)
    return f"${float(tier.get('mult') or 0):,.0f}"


def carbon_paragraph(ctx) -> str:
    """Section 13. Names the tiers actually installed, not "the 100 kW class"."""
    f = ctx.formatted
    years = ctx.raw.get("projection_years", 5)
    tiers = ctx.raw.get("_carbon_tiers") or []
    if tiers:
        named = " and ".join(
            f"{_tier_amount(t)} per year for the {t.get('kw', 0):g} kW class"
            for t in tiers
        )
        lead = f"Credits are modelled at {named}."
    else:
        lead = "Credits are modelled per installed charger class."

    text = (f"{lead} Over {years} years that comes to "
            f"{f.get('cc_total')} in total.")
    if ctx.raw.get("has_l2") and ctx.num("cc_l2_credit_month") > 0:
        text += (" Level 2 consumption credits are calculated separately from "
                 "metered energy and are included in that figure.")
    return text


def financing_paragraph(ctx) -> str:
    """Section 17."""
    if not ctx.raw.get("has_financing"):
        return ""
    f = ctx.formatted
    return (
        f"The amortization schedule finances {f.get('loan_amount')} at "
        f"{f.get('loan_rate')} over {f.get('loan_years')} years, "
        f"{f.get('loan_num_payments')} monthly payments of "
        f"{f.get('loan_monthly_payment')} beginning "
        f"{f.get('loan_first_pmt_date')}. Total interest over the term is "
        f"{f.get('loan_total_interest')}."
    )


def monthly_cashflow_paragraph(ctx) -> str:
    """Section 17A."""
    if not ctx.raw.get("has_financing"):
        return ""
    f = ctx.formatted
    return (
        f"Across the {f.get('loan_term_months')}-month term the model shows "
        f"{f.get('cf_total_evse_profit')} of charging profit and "
        f"{f.get('cf_total_carbon')} of carbon credits against "
        f"{f.get('cf_total_loan_payments')} of loan payments, a net of "
        f"{f.get('cf_net_total')}. Monthly net cashflow starts at "
        f"{f.get('cf_net_first')} and reaches {f.get('cf_net_last')} by the "
        "final month as the modelled revenue escalates."
    )


def build_all(ctx) -> dict[str, str]:
    """Every generated sentence, keyed by the token the template uses."""
    return {
        "narrative_executive_summary": executive_summary(ctx),
        "narrative_site_history": site_history(ctx),
        "narrative_investment": investment(ctx),
        "narrative_breakeven": breakeven_paragraph(ctx),
        "narrative_roi": roi_summary(ctx),
        "narrative_carbon": carbon_paragraph(ctx),
        "narrative_financing": financing_paragraph(ctx),
        "narrative_monthly_cashflow": monthly_cashflow_paragraph(ctx),
    }


# --------------------------------------------------------------------------
# optional assisted commentary
# --------------------------------------------------------------------------


_NUMERAL_RE = re.compile(r"\d[\d,]*\.?\d*")


def numerals_in(text: str) -> set[str]:
    """Every number in a string, normalised so `$13,118` matches `13118`."""
    return {m.group(0).replace(",", "").rstrip(".") for m in _NUMERAL_RE.finditer(text)}


def verify_numerals(draft: str, ctx) -> list[str]:
    """Numbers in `draft` that do not appear anywhere in the context.

    A model asked to write two sentences about a site will happily invent a
    percentage. Every numeral it produces is checked against the extracted
    figures, and a draft that fails is rejected rather than edited - a
    hand-corrected hallucination is still a number nobody sourced.
    """
    known: set[str] = set()
    for value in ctx.raw.values():
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            known.add(f"{value:.0f}")
            known.add(f"{value:.1f}")
            known.add(f"{value:.2f}")
            known.add(str(int(value)) if float(value).is_integer() else f"{value}")
    for text in ctx.formatted.values():
        known |= numerals_in(str(text))
    for rows in ctx.tables.values():
        for row in rows:
            for value in row.values():
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    known.add(f"{value:.0f}")
                    known.add(f"{value:.2f}")
                elif isinstance(value, str):
                    known |= numerals_in(value)

    # Years and small counts are ordinary prose, not claims about the site.
    allowed = {str(y) for y in range(1990, 2101)} | {str(n) for n in range(0, 13)}
    return sorted(n for n in numerals_in(draft) if n not in known and n not in allowed)


def draft_commentary(ctx, *, prompt: str, style_sample: str = "",
                     model: str = "claude-sonnet-4-5") -> tuple[str, list[str]]:
    """Optional `assisted` mode. Returns `(draft, unverified_numerals)`.

    The caller must reject the draft when the second element is non-empty. The
    default config never calls this; `manual` mode shows the operator a text box
    prefilled with the key findings instead.
    """
    try:
        import anthropic
    except ImportError:  # pragma: no cover - optional dependency
        raise RuntimeError(
            "Assisted commentary needs the `anthropic` package. Install it, or "
            "leave commentary_mode set to 'manual'."
        )

    metrics = {k: v for k, v in ctx.formatted.items() if v}
    client = anthropic.Anthropic()
    message = client.messages.create(
        model=model,
        max_tokens=400,
        system=(
            "You write short, factual paragraphs for EV charging proposals. "
            "Use only the figures given. Never invent a number. Two to four "
            "sentences. Plain declarative prose, no marketing language."
            + (f"\n\nMatch this style:\n{style_sample}" if style_sample else "")
        ),
        messages=[{"role": "user", "content": f"{prompt}\n\nFigures:\n{metrics}"}],
    )
    draft = "".join(block.text for block in message.content if block.type == "text")
    return draft.strip(), verify_numerals(draft, ctx)


def manual_prefill(ctx) -> str:
    """What the `manual` text box starts with: the facts, unstyled."""
    if not ctx.raw.get("has_history"):
        return ""
    f = ctx.formatted
    bullets = [
        f"- {f.get('months_in_window')} months reviewed, {f.get('history_window_label')}",
        f"- {f.get('hist_total_revenue')} total revenue, "
        f"{f.get('dcfc_revenue_share')} from DC fast",
        f"- {f.get('sessions_per_day')} sessions per day, "
        f"{f.get('avg_kwh_session')} kWh average",
        f"- {f.get('unproductive_share')} of station time out of service",
    ]
    if ctx.num("outage_lost_revenue") > 0:
        bullets.append(f"- outage in {f.get('outage_window_label')} cost "
                       f"{f.get('outage_lost_revenue')}")
    return "\n".join(bullets)
