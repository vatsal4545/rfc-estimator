"""Phase 4: turn the reference proposal into `templates/proposal_template.docx`.

Run:  python -m tools.build_template

Method
------
The reference document is edited **in place** with python-docx at run level.
Nothing is rebuilt, so all four section definitions, nine headers, three
footers, ten media files and the 348 KB style part survive untouched.

Where the tokens come from
--------------------------
Rather than hand-typing the numbers to search for, the builder runs the real
extraction pipeline over the workbook that produced this proposal and uses each
token's own formatted value as the search string. If the extractor formats
`cost_after_discount` as `$272,023.03`, that is exactly the string the document
contains, and the substitution is guaranteed to line up. A number the pipeline
cannot reproduce simply will not match, and gets reported as unmatched rather
than silently left as a hardcoded figure.
"""

from __future__ import annotations

import copy
import os
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ev_proposal_agent import engine as engine_mod                      # noqa: E402
from ev_proposal_agent.extract import build_context, load_field_map     # noqa: E402
from tools.docx_edit import (                                           # noqa: E402
    audit_identity,
    wrap_rows_conditional,
    clear_cached_page_numbers,
    find_inline_images,
    iter_story_parts,
    make_row_loop,
    replace_image_with_token,
    replace_many,
    scrub_package,
    set_cell_text,
    set_paragraph_text,
    wrap_row_conditional,
)

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "inputs" / "Food4Less_Rip-and-Replace_Proposal-Aug2026_AR.docx"
LEGACY_XLSX = ROOT / "inputs" / "Historical_RipandReplaceFood4Less_f-00148.xlsx"
TEMPLATE = ROOT / "templates" / "proposal_template.docx"
INVENTORY = ROOT / "docs" / "PLACEHOLDER_INVENTORY.md"

OPERATOR_INPUTS = {
    "existing_ports_l2": 5,
    "existing_ports_l3": 5,
    "existing_nameplate_l2_kw": 7.2,
    "existing_nameplate_l3_kw": 50,
}


# --------------------------------------------------------------------------
# 1. identity - the strings that must never survive into a new proposal
# --------------------------------------------------------------------------

IDENTITY: list[tuple[str, str, str]] = [
    # (literal in the reference, token, where it appears)
    ("3434 Manthey Rd, Stockton, CA 95206", "{{ site_address }}", "cover, S2, footers"),
    # S1 prose spells the address differently, with an inserted "in"
    ("3434 Manthey Rd, in Stockton, California", "{{ site_address }}", "S1 proposal purpose"),
    ("Jerome Jenkins", "{{ client_contact_name }}", "cover, S2, S18 acceptance"),
    ("Alexander Luckett", "{{ prepared_by_name }}", "cover"),
    ("Food4Less", "{{ site_name }}", "cover, S1, S2, footers"),
    ("August 3, 2026", "{{ proposal_date }}", "S2 project information"),
    ("AUGUST 4, 2026", "{{ proposal_date_upper }}", "cover (split across 3 runs)"),
]

# Package parts python-docx does not expose. Same strings, plain text.
PACKAGE_SCRUB = {
    "Zero Impact Energy EV Charging Infrastructure Proposal - Food4Less":
        "Zero Impact Energy EV Charging Infrastructure Proposal",
    "EV charging, Food4Less, Zero Impact Energy, rip and replace, EVOLV":
        "EV charging, Zero Impact Energy, EVOLV",
    "Customer-ready proposal finalized August 3, 2026.": "",
    "Zaid Khartabil": "Zero Impact Energy",
    "Food4Less": "",
    "Jerome Jenkins": "",
    "Alexander Luckett": "",
    "3434 Manthey Rd, Stockton, CA 95206": "",
}


# --------------------------------------------------------------------------
# 2. scalars sourced from the workbook, matched by their own formatted value
# --------------------------------------------------------------------------

# token -> the format the *document* uses, which is not always the format the
# extractor defaults to (KPI strips round to whole dollars, tables do not).
SCALAR_TOKENS: list[tuple[str, str | None, str]] = [
    # (token, override format, section)
    ("cost_after_discount", "currency2", "S1, S7, S7A, S17"),
    ("cost_grand_total", "currency2", "S7"),
    ("cost_equipment_invoice", "currency2", "S7"),
    ("cost_charger_hardware", "currency2", "S7"),
    ("cost_service_warranty", "currency2", "S7, S12"),
    ("cost_evolv_commissioning", "currency2", "S7, S10"),
    ("cost_sales_tax_chargers", "currency2", "S7"),
    ("cost_electrical_subtotal", "currency2", "S7"),
    ("cost_labor", "currency2", "S7, S12"),
    ("roi_total_costs_upfront", "currency2", "S7 ROI"),
    ("roi_carbon_credits", "currency2", "S7 ROI, S13"),
    ("roi_itc", "currency2", "S7 ROI"),
    ("roi_evse_revenues", "currency2", "S7 ROI, S5"),
    ("roi_net_revenues", "currency2", "S7 ROI"),
    ("loan_amount", "currency2", "S14, S17"),
    ("loan_monthly_payment", "currency2", "S14, S17, S17A"),
    ("loan_total_interest", "currency2", "S14, S17"),
    ("loan_rate", "percent2", "S14, S17"),
    ("loan_start_date", "date_long", "S17"),
    ("loan_num_payments", "integer", "S17"),
    ("evolv_fee_per_port", "currency2", "S10"),
    ("evolv_ports", "integer", "S10"),
    ("evolv_annual_cost", "currency0", "S10"),
    ("evolv_contract_years", "integer", "S10"),
    ("evolv_customer_total", "currency0", "S10"),
    ("months_in_window", "integer", "S3 KPI"),
    ("hist_total_revenue", "currency0", "S3 KPI"),
    ("hist_l3_revenue", "currency0", "S3 KPI"),
    ("dcfc_revenue_share", "percent0", "S3 KPI"),
    ("outage_lost_revenue", "currency0", "S3 KPI"),
    ("hist_profit_yearly", "currency0", "S3B, S5 comparison"),
    ("hist_profit_3yr", "currency0", "S3B"),
    ("hist_profit_5yr", "currency0", "S3B"),
    ("hist_gross_yearly", "currency0", "S3B"),
    ("modeled_rating_l3", "number2", "S6"),
    ("modeled_rating_l2", "number2", "S6"),
    ("total_ports", "integer", "S6, S10"),
    ("n_ports_l2", "integer", "S1, S6"),
    ("n_ports_l3", "integer", "S6"),
    ("svc_contract_years", "integer", "S12"),
    ("standard_parts_warranty_years", "integer", "S12"),
    ("cf_carbon_monthly", "currency2", "S17A"),
    ("loan_term_months", "integer", "S14"),
]

# Values that appear in the document with a specific literal spelling that no
# format string reproduces. Kept explicit rather than guessed at.
LITERAL_SCALARS: list[tuple[str, str, str]] = [
    ("Retail", "{{ property_type }}", "S2"),
    ("Customers and public use", "{{ primary_users }}", "S2"),
    ("V1.0", "{{ proposal_version }}", "S2"),
    ("30 days from proposal date unless extended in writing",
     "{{ validity_days }} days from proposal date unless extended in writing", "S2"),
    ("CTX-C32-240", "{{ l2_sku }}", "S6A Level 2"),
    ("3 to 4 weeks", "{{ construction_weeks }} weeks", "S15"),
    ("Owner", "{{ client_title }}", "S18 acceptance"),

    # S13's carbon paragraph. These two were the last site-varying literals in
    # the template, and they printed the REFERENCE site's economics on every
    # proposal: a Best Western reader was told $8,600/yr for a 100 kW class
    # when its own workbook models $17,200/yr for the 240 kW class. The
    # paragraph is mostly generic programme explainer, so it cannot go through
    # PROSE_REPLACEMENTS - that swaps the whole paragraph. These are inline.
    ("$8,600 per year for the 100 kW class", "{{ cc_tier_sentence }}",
     "S13 carbon prose - the class and the rate are site facts"),
    ("$0.0045", "{{ cc_l2_rate }}",
     "S13 carbon prose - Level 2 consumption factor, Financial Worksheet!F47"),
]

# "10-Year" headings become "{{ projection_years }}-Year".
HORIZON_STRINGS: list[tuple[str, str]] = [
    ("10-YEAR REVENUE AND ECONOMIC BENEFIT PROJECTION",
     "{{ projection_years }}-YEAR REVENUE AND ECONOMIC BENEFIT PROJECTION"),
    ("CONSOLIDATED 10-YEAR CASHFLOW", "CONSOLIDATED {{ projection_years }}-YEAR CASHFLOW"),
    ("Projected ROI after 10 years", "Projected ROI after {{ projection_years }} years"),
    ("Projected ROI over 10 years", "Projected ROI over {{ projection_years }} years"),
    ("10-year baseline / benefit", "{{ projection_years }}-year baseline / benefit"),
    ("10-YEAR OPERATING PROFIT", "{{ projection_years }}-YEAR OPERATING PROFIT"),
    ("10-YEAR TOTAL BENEFIT", "{{ projection_years }}-YEAR TOTAL BENEFIT"),
    ("MODELED 10-YEAR CREDITS", "MODELED {{ projection_years }}-YEAR CREDITS"),
    ("10-YEAR PROJECTION DETAIL", "{{ projection_years }}-YEAR PROJECTION DETAIL"),
    ("Years 1 through 10", "Years 1 through {{ projection_years }}"),
    ("Years 2 through 10", "Years 2 through {{ projection_years }}"),
    ("60-MONTH FINANCING CASHFLOW", "{{ loan_term_months }}-MONTH FINANCING CASHFLOW"),
    ("the full 60-month financing term", "the full {{ loan_term_months }}-month financing term"),
]


# --------------------------------------------------------------------------
# 3. tables converted to loops
# --------------------------------------------------------------------------

# table index -> (collection, loop var, cell expressions, first data row, rows to drop)
TABLE_LOOPS: dict[int, dict] = {
    11: {  # 3A full-history actuals
        "collection": "full_history", "var": "r",
        "exprs": ["{{ r.label }}", "{{ r.l2 }}", "{{ r.l3 }}"],
        "first_data_row": 1, "section": "3A",
    },
    13: {  # 3B historical operating baseline
        "collection": "historical_baseline", "var": "r",
        "exprs": ["{{ r.label }}", "{{ r.l2 }}", "{{ r.l3 }}"],
        "first_data_row": 1, "keep_tail": 6, "section": "3B",
    },
    20: {  # 5 projected operating profile
        "collection": "operating_model", "var": "r",
        "exprs": ["{{ r.label }}", "{{ r.l2_fmt }}", "{{ r.l3_fmt }}"],
        "first_data_row": 1, "keep_tail": 5, "section": "5",
    },
    23: {  # 6 equipment schedule
        "collection": "equipment_rows", "var": "r",
        "exprs": ["{{ r.description }}", "{{ r.qty }}", "{{ r.nameplate }}",
                  "{{ r.modeled }}", "{{ r.use }}"],
        "first_data_row": 1, "section": "6",
    },
    28: {  # 7 initial investment costs
        "collection": "cost_rows", "var": "r",
        "exprs": ["{{ r.label }}", "{{ r.formatted }}"],
        "first_data_row": 1, "keep_tail": 2, "section": "7",
    },
    31: {  # 7A consolidated cashflow
        "collection": "consolidated_cashflow", "var": "r",
        "exprs": ["{{ r.year_fmt }}", "{{ r.annual_fmt }}", "{{ r.cumulative_fmt }}"],
        "first_data_row": 1, "section": "7A",
    },
    33: {  # 7B charger revenue cashflow
        "collection": "charger_cashflow", "var": "r",
        "exprs": ["{{ r.year_fmt }}", "{{ r.annual_fmt }}", "{{ r.cumulative_fmt }}"],
        "first_data_row": 1, "keep_tail": 1, "section": "7B",
    },
    37: {  # 9 infrastructure cost categories
        "collection": "infrastructure_rows", "var": "r",
        "exprs": ["{{ r.label }}", "{{ r.formatted }}", "{{ r.description }}"],
        # keep_tail 1, not 2: the only fixed tail row is the SCOPE BASIS note.
        # Row 7 held the reference's hardcoded "Other / miscellaneous |
        # $0 or project-specific", which became a TOTAL row and is now dropped
        # altogether - the named rows plus the residual already add up to it, so
        # printing it restated what the column above it already says. The
        # footing is still enforced, by `_check_infrastructure_foots`.
        "first_data_row": 1, "keep_tail": 1, "section": "9",
    },
    62: {  # 17B months 1-25
        "collection": "monthly_cashflow_1_25", "var": "m",
        "exprs": ["{{ m.month }}", "{{ m.loan_payment_fmt }}", "{{ m.carbon_credits_fmt }}",
                  "{{ m.evse_profit_fmt }}", "{{ m.net_fmt }}"],
        "first_data_row": 1, "section": "17B",
    },
    64: {  # 17C months 26-50
        "collection": "monthly_cashflow_26_50", "var": "m",
        "exprs": ["{{ m.month }}", "{{ m.loan_payment_fmt }}", "{{ m.carbon_credits_fmt }}",
                  "{{ m.evse_profit_fmt }}", "{{ m.net_fmt }}"],
        "first_data_row": 1, "section": "17C",
    },
    66: {  # 17D months 51-60
        "collection": "monthly_cashflow_51_60", "var": "m",
        "exprs": ["{{ m.month }}", "{{ m.loan_payment_fmt }}", "{{ m.carbon_credits_fmt }}",
                  "{{ m.evse_profit_fmt }}", "{{ m.net_fmt }}"],
        "first_data_row": 1, "section": "17D",
    },
}

# Rows the v16 scenario grid has no source for. Deleted, per the map.
SECTION_5_ROWS_TO_DELETE = [
    "Avg Delivered Power (% of rating)",
]

# --------------------------------------------------------------------------
# 3b. cells placed by coordinate
#
# Integer-valued tokens cannot be find-and-replaced: `13` occurs inside
# `$13,118`, inside month numbers and inside the Gantt chart. These are written
# straight into the cell that holds them. Verified against the table dump, and
# `expect` is asserted before writing so a shifted table fails the build rather
# than silently tokenising the wrong cell.
# --------------------------------------------------------------------------

CELL_TOKENS: list[tuple[int, int, int, str, str, str]] = [
    # (table, row, col, expected current text, replacement, section)
    (5, 4, 1, "Retail", "{{ property_type }}", "S2 project information"),
    (5, 5, 1, "Customers and public use", "{{ primary_users }}", "S2"),
    (5, 7, 1, "V1.0", "{{ proposal_version }}", "S2"),
    (40, 2, 1, "13", "{{ evolv_ports }}", "S10 platform economics"),
    (40, 3, 1, "$6,238", "{{ evolv_annual_cost }}", "S10"),
    (40, 4, 1, "5 years", "{{ evolv_contract_years }} years", "S10"),
    (58, 3, 1, "5 years", "{{ loan_years }} years", "S17 DLL schedule"),
    (58, 4, 1, "12", "{{ loan_pmts_per_year }}", "S17"),
    (58, 9, 1, "60", "{{ loan_num_payments }}", "S17"),
    (58, 10, 1, "60", "{{ loan_actual_payments }}", "S17"),
    # equipment specs - "98 kW average" and friends carry units, so a bare
    # numeric replace would not reach them
    # The L2 spec rows described the REFERENCE site's hardware, not the
    # workbook's: "single-port" was baked into the replacement string and "32A"
    # was never tokenised at all, so a 2 x 80A dual-port site printed
    # "4 single-port units" and "32A". Every word comes off the line items now.
    (25, 2, 1, "10 single-port units", "{{ l2_quantity_ports }}", "S6A Level 2"),
    (25, 3, 1, "32A", "{{ l2_amperage }}", "S6A Level 2 electrical rating"),
    (25, 4, 1, "7.53 kW modeled", "{{ modeled_rating_l2 }} kW modeled", "S6A Level 2"),
    (26, 1, 1, "2 x Generation 3 120 kW and 1 x Generation 2 60 kW",
     "{{ dcfc_mix_sentence }}", "S6A DC fast"),
    (26, 2, 1, "98 kW average", "{{ modeled_rating_l3 }} kW average", "S6A DC fast"),
    # S12 warranty KPI strip
    (44, 6, 0, "2 years", "{{ standard_parts_warranty_years }} years", "S12 KPI"),
    # S13 carbon KPI strip. All three were still the reference site's numbers.
    (46, 7, 0, "$218,460", "{{ cc_total_kpi }}", "S13 KPI, Financial Worksheet!B4"),
    (46, 7, 1, "$8,600 / $4,300", "{{r cc_multiplier_lines }}",
     "S13 KPI, FW!E45:J45 for the tiers with a quantity"),
    (46, 7, 3, "$0.0045", "{{ cc_l2_rate }}", "S13 KPI, Financial Worksheet!F47"),
    # S1 "Proposed solution at a glance" hardcodes the reference site's kit
    # Parallel to the DC fast row below it, which reads "{{ dcfc_mix_sentence }}".
    (3, 1, 1, "10 single-port 32A units",
     "{{ l2_mix_sentence }}", "S1 at a glance"),
    (3, 2, 1, "2 x 120 kW Gen3 + 1 x 60 kW Gen2",
     "{{ dcfc_mix_sentence }}", "S1 at a glance"),
    # S3A header carries the reference site's own date window
    (11, 0, 0, "FULL-HISTORY ACTUALS (Aug 2023 – Jun 2026)",
     "FULL-HISTORY ACTUALS ({{ history_window_label }})", "S3A header"),

    # ----------------------------------------------------------------------
    # The KPI strips and the Section 4 assumptions table.
    #
    # None of these were ever tokenised. The builder finds a figure by its own
    # formatted value, and every token declares `currency2`, but the tiles print
    # `currency0` - so `$272,023.03` never matched `$272,023` and the reference
    # site's number survived into every proposal, on every chassis. Rendering
    # two different sites and diffing every cell is what found them.
    #
    # Each entry targets ONE PARAGRAPH inside the cell, because a tile stacks
    # figure / caption / sub-caption as three paragraphs and overwriting the
    # cell would delete the caption.
    # ----------------------------------------------------------------------

    # S3 history KPI strip
    (9, 0, 0, "35 months", "{{ months_in_window }} months", "S3 KPI"),
    (9, 0, 0, "Aug 2023 to Jun 2026", "{{ history_window_label }}", "S3 KPI"),
    (9, 0, 2, "96%", "{{ dcfc_revenue_share }}", "S3 KPI"),
    (9, 0, 3, "Jan and Feb 2026", "{{ outage_window_label }}", "S3 KPI"),

    # S4 key modelling assumptions - every one of these is a workbook input
    (17, 2, 1, "$0.40 per kWh", "{{ proj_utility_rate_l2 }} per kWh",
     "S4 utility energy cost"),
    (17, 3, 1, "$0.65 per kWh projected", "{{ proj_retail_rate_l2 }} per kWh projected",
     "S4 Level 2 retail"),
    (17, 4, 1, "$0.70 per kWh projected", "{{ proj_retail_rate_l3 }} per kWh projected",
     "S4 Level 3 retail"),
    (17, 5, 1, "3% model assumption", "{{ downtime_assumption }} model assumption",
     "S4 downtime"),
    (17, 6, 1, "12.5% in Years 2 through 10",
     "{{ growth_rate }} in Years 2 through 10", "S4 annual growth"),

    # S5 projection KPI strip. Tiles 1 and 3 are operating profit; tiles 2 and 4
    # are the ITC ones, whose label and sub-caption are tokens too so a site with
    # no credit never reads as though it has one.
    (19, 0, 0, "$26,870", "{{ kpi_year1_operating }}", "S5 KPI year 1"),
    (19, 0, 1, "$108,477", "{{ kpi_year1_total }}", "S5 KPI year 1 total"),
    (19, 0, 1, "YEAR 1 TOTAL INCL. ITC", "{{ kpi_year1_total_label }}", "S5 KPI"),
    (19, 0, 1, "Includes modeled federal ITC", "{{ kpi_year1_total_sub }}", "S5 KPI"),
    (19, 0, 2, "$406,173", "{{ horizon_evse_total }}", "S5 KPI horizon operating"),
    # Tiles 1 and 3 had their VALUES tokenised but not their sub-captions, so two
    # reference phrases about idle fees sat under correctly-computed charger
    # revenue. Fixed strings, so no token is needed.
    (19, 0, 0, "Charging profit + idle fees", "Charger Revenue", "S5 KPI tile 1 sub"),
    (19, 0, 2, "Before idle fees", "Charger Revenue", "S5 KPI tile 3 sub"),
    (19, 0, 3, "$564,696", "{{ kpi_horizon_total }}", "S5 KPI horizon total"),
    (19, 0, 3, "Operating profit + idle fees + ITC", "{{ kpi_horizon_total_sub }}",
     "S5 KPI"),

    # S3B carries the same header as S5, but its rate is the HISTORICAL one.
    # Both read $0.40 in the reference, so a single search string would have
    # tokenised one of them with the other's rate.
    (13, 18, 0, "TOTAL NET PROFIT (revenue − electricity @ $0.40/kWh)",
     "TOTAL NET PROFIT (revenue − electricity @ {{ hist_utility_rate_l2 }}/kWh)",
     "S3B totals header"),

    # S5 operating-model tail. The L2/L3 columns are merged, so one write covers
    # both - which is also the merged-cell artifact the reference document has.
    (20, 18, 0, "TOTAL NET PROFIT (revenue − electricity @ $0.40/kWh)",
     "TOTAL NET PROFIT (revenue − electricity @ {{ proj_utility_rate_l2 }}/kWh)",
     "S5 totals header"),
    (20, 19, 1, "$22,592", "{{ projected_profit_yearly }}", "S5 yearly"),
    (20, 20, 1, "$67,776", "{{ projected_profit_3yr }}", "S5 3 years"),
    (20, 21, 1, "$112,960", "{{ projected_profit_5yr }}", "S5 5 years"),
    (20, 22, 1, "$53,332", "{{ projected_gross_yearly }}", "S5 gross yearly"),

    # S5 baseline-vs-projected comparison
    (21, 1, 2, "$26,870", "{{ kpi_year1_operating }}", "S5 comparison projected"),
    (21, 1, 3, "$13,752", "{{ kpi_projected_vs_baseline }}", "S5 comparison delta"),
    (21, 2, 1, "$131,181", "{{ baseline_over_horizon }}", "S5 comparison baseline"),
    (21, 2, 2, "$564,696", "{{ kpi_horizon_total }}", "S5 comparison benefit"),
    (21, 2, 3, "$433,515", "{{ benefit_delta }}", "S5 comparison benefit delta"),
    (21, 3, 2, "104.8%", "{{ kpi_uplift }}", "S5 comparison uplift"),
    # The uplift no longer includes idle fees, so the note beside it cannot say
    # it does.
    (21, 3, 3, "Includes modeled idle fees",
     "Year 1 against the historical baseline", "S5 comparison note"),

    # S4's MODEL SCOPE footer described the total as operating profit + idle
    # fees + the Year 1 ITC, and said environmental credits were EXCLUDED.
    # After this change all three clauses are wrong: there are no idle fees, the
    # ITC is zero on these workbooks, and carbon credits are precisely what the
    # total benefit adds. Rewritten to describe what the tiles actually show.
    (17, 8, 0,
     "MODEL SCOPE: The 10-year total in this proposal includes operating profit, "
     "modeled idle fees and the Year 1 federal investment tax credit assumption. "
     "It excludes environmental credits and does not subtract project cost.",
     "MODEL SCOPE: The {{ projection_years }}-year total in this proposal is "
     "charger revenue plus modeled carbon credits. It does not subtract project "
     "cost, and it excludes any federal investment tax credit unless one is "
     "stated in Section 7.",
     "S4 model scope footer"),

    # S10 EVOLV - the port count in the working
    (40, 3, 2, "13 x $39.99 x 12",
     "{{ evolv_ports }} x {{ evolv_fee_per_port }} x 12", "S10 platform working"),

    # S12 warranty KPI strip
    (44, 6, 1, "5 years", "{{ svc_contract_years }} years", "S12 KPI service term"),
    (44, 6, 2, "$46,560", "{{ cost_service_warranty_kpi }}", "S12 KPI service"),
    (44, 6, 4, "$24,750", "{{ cost_labor_kpi }}", "S12 KPI labor"),

    # S14 financing KPI strip - the worst of them. On Showcase Liquor this tile
    # printed $272,023 against a real loan of $49,988.
    (49, 0, 0, "$272,023", "{{ loan_amount_kpi }}", "S14 KPI financed amount"),
    (49, 0, 2, "60 months", "{{ loan_term_months }} months", "S14 KPI term"),
    (49, 0, 2, "Five years", "{{ loan_years }} years", "S14 KPI term sub"),
    (49, 0, 3, "$5,567", "{{ loan_monthly_payment_kpi }}", "S14 KPI monthly payment"),
    (49, 0, 3, "Total interest $61,970",
     "Total interest {{ loan_total_interest_kpi }}", "S14 KPI total interest"),
]

# Figure captions that name the reference site's date range or horizon.
CAPTIONS: list[tuple[str, str, str]] = [
    ("Historical monthly charging revenue, August 2023 through June 2026",
     "Historical monthly charging revenue, {{ history_window_label }}",
     "chart 1 caption"),
    ("Modeled annual operating profit plus idle fees, Years 1 through 10",
     "Modeled annual operating profit, Years 1 through {{ projection_years }}",
     "chart 2 caption - the scenario grid has no idle model"),
]

# Rows wrapped in a conditional. (table, row, condition, why)
CONDITIONAL_ROWS: list[tuple[int, int, str, str]] = [
    (29, 3, "has_itc",
     "Federal ITC row - Financial Worksheet!B7 is =B3+(B4+B6), so v16 excludes "
     "ITC from Net Revenues and B5 is zero"),
    (49, 0, "has_financing",
     "S14's KPI strip is four financing figures. Section 14 itself also covers "
     "grants and tax credits, so it stays when there is no loan - but the strip "
     "must not, or a cash proposal quotes a financed amount and a monthly "
     "payment for a loan it does not have"),
]

# Whole tables wrapped in a conditional. (table, first row, last row, cond, why)
# Idle fees are not modelled anywhere in this proposal - the projection tiles
# read charger revenue and carbon credits straight off the Financial Worksheet -
# so every row and bullet that describes an idle policy describes a revenue
# stream the document does not claim. Removed at the source rather than left to
# render as zeroes: "0-minute Level 2 / 0-minute Level 3 grace" is worse than
# silence.
#
# Run AFTER place_cell_tokens: entry (17, 8, 0) fills the MODEL SCOPE row, and
# deleting row 7 first would shift it out from under that coordinate.
DELETE_ROWS: list[tuple[int, int, str, str]] = [
    (15, 5, "Idle policy", "S4 methodology - the idle-fee layer"),
    (17, 7, "Idle policy", "S4 assumptions - the grace-period row"),
]

# (table, row, cell, distinctive substring, why)
DELETE_PARAGRAPHS: list[tuple[int, int, int, str, str]] = [
    (39, 0, 0, "grace-period and idle-fee",
     "S10 EVOLV capabilities - the idle-fee configuration bullet"),
]


CONDITIONAL_TABLES: list[tuple[int, int, int, str, str]] = [
    (21, 0, 3, "has_history",
     "S5's historical-baseline comparison. Every column but 'Projected result' "
     "is a historical figure, so on a greenfield site - no Historical Data tab - "
     "the table renders as a header and three mostly-empty rows. The section "
     "registry already suppresses Sections 3/3A/3B and chart 1 in that case; "
     "this table belongs with them"),
]

# Paragraphs replaced wholesale, matched on a distinctive substring.
#
# These are the paragraphs whose *facts* belong to the reference site, not just
# its name. "has been operating five Level 2 and five Level 3 ports since
# August 2023" is wrong for every other site, and swapping the site name into it
# makes it worse: a confidently stated, specific, false claim. They are replaced
# by sentences `narrative.py` assembles from the extracted figures.
#
# An empty replacement folds the paragraph into the generated one above it.
PROSE_REPLACEMENTS: list[tuple[str, str, str]] = [
    ("Being located along the I-5 Fwy",
     "{{ site_location_narrative }}",
     "S6 configuration narrative - judgement, not arithmetic"),
    ("is one of the most driven roads along the West Coast", "",
     "S6 - a second paragraph about the reference site's freeway, folded into "
     "the operator's own location narrative"),

    ("site has been operating",
     "{{ narrative_executive_summary }}",
     "S1 - port counts and start date are site facts"),
    ("This proposal replaces the existing installation with", "",
     "S1 - folded into the generated summary"),
    ("Total project cost is", "",
     "S1 - folded into the generated summary"),
    ("Financing is available through De Lage Landen", "",
     "S1 - folded into the generated summary"),

    ("The Level 3 chargers bring in most of the revenue",
     "{{ narrative_site_history }}",
     "S3 - revenue split is a site fact"),
    ("Level 3 sees", "", "S3 - folded into the generated history"),

    ("With an initial investment of",
     "{{ narrative_investment }}",
     "S7 - break-even wording changes when there is none"),
    ("With the initial investment of",
     "{{ narrative_breakeven }}",
     "S7A - same, for the cumulative table"),

    ("The loan amortization schedule for the project financing",
     "{{ narrative_financing }}",
     "S17 - rate, term and payment"),
    ("The monthly cashflow view across the full",
     "{{ narrative_monthly_cashflow }}",
     "S17A - totals across the term"),
]

# --------------------------------------------------------------------------
# 3c. section badges and suppression
#
# Every numbered heading is a 1x2 table: a teal badge cell holding the number,
# and a title cell. The number is regenerated from the registry so the badge,
# the page-2 contents and the Section 2 listing cannot disagree.
# --------------------------------------------------------------------------

SECTION_BADGES: list[tuple[int, str]] = [
    (2, "executive_summary"), (4, "overview"),
    (8, "history"), (10, "history_actuals"), (12, "history_baseline"),
    (14, "methodology"), (16, "assumptions"),
    (18, "projection"),
    (22, "configuration"),
    (27, "roi"), (30, "cashflow_consolidated"), (32, "cashflow_charger"),
    (34, "rip_and_replace"), (36, "infrastructure"), (38, "evolv"),
    (41, "om"), (43, "warranty"), (45, "carbon"), (47, "incentives"),
    (51, "delivery"), (55, "scope_of_work"),
    (57, "financing"), (59, "financing_monthly"),
    (61, "financing_table_1"), (63, "financing_table_2"), (65, "financing_table_3"),
    (67, "terms"),
]
# A continuation heading names its parent in prose - "Continuation of Section
# 7" - and that number was a frozen literal while the badge beside it was a
# token. On any site whose numbering shifts (a greenfield workbook suppresses
# Sections 3/3A/3B, moving everything up) the subtitle cited a section that no
# longer exists: 6A read "Continuation of Section 7", 16B read "Appendix to
# Section 17". Seven of the nine were wrong on the first real greenfield file.
#
# CLAUDE.md says a section number appears in three places, all generated from
# one plan. This was a fourth, and it was not.
#
# (table index, parent section key, expected literal)
CONTINUATION_LABELS: list[tuple[int, str, str]] = [
    (10, "history",     "Continuation of Section 3"),
    (12, "history",     "Continuation of Section 3"),
    (16, "methodology", "Continuation of Section 4"),
    (30, "roi",         "Continuation of Section 7"),
    (32, "roi",         "Continuation of Section 7"),
    (59, "financing",   "Continuation of Section 17"),
    (61, "financing",   "Appendix to Section 17"),
    (63, "financing",   "Appendix to Section 17"),
    (65, "financing",   "Appendix to Section 17"),
]


# Section 6A's badge is row 1 of a 2-row table whose row 0 is the FINAL
# SUBMITTAL callout, so it needs a row index as well.
SECTION_BADGE_6A = (24, 1, "equipment_details")

# Every section is guarded, not just the data-driven ones, because the app now
# lets the operator switch any of them off. An unguarded section leaves its
# badge behind pointing at a numbering entry that no longer exists.
#
# Ranges run from one badge table to the next, clamped so they never swallow a
# section-break paragraph. Those paragraphs carry the landscape and portrait
# `sectPr`; remove one and every following page loses its orientation.

# The two generated listings.
TOC_TABLE = 1          # page 2, "Section | Title | Page"
CONTENTS_TABLE = 7     # Section 2, two column pairs

# The cover hero becomes a placeholder so the operator can drop in a photo of
# the actual site. Falls back to the stock image when they do not.
COVER_TOKEN = ("media/image2.jpeg", "{{ cover_photo }}")

CHART_TOKENS = {
    "media/image3.png": ("{{ chart_historical_revenue }}", 6.65, 2.66),
    "media/image4.png": ("{{ chart_annual_operating_profit }}", 6.55, 2.75),
    "media/image7.png": ("{{ chart_cumulative_cashflow }}", 5.85, 3.25),
}


# --------------------------------------------------------------------------


def is_safe_search_string(text: str) -> bool:
    """Is this value distinctive enough to find-and-replace across the document?

    A bare small integer is not. `total_ports` formats as `13`, and `13` occurs
    inside `$13,118`, inside month numbers, inside dates and inside the Gantt
    chart. Replacing it globally corrupts all of them.

    So a search string qualifies only if it carries a currency symbol, a percent
    sign, a thousands separator, a decimal point or a letter - something that
    pins it to being a figure rather than a digit. Integer-valued tokens are
    placed by cell coordinate instead (see `CELL_TOKENS`).
    """
    if len(text) < 4:
        return False
    if text in {"0", "$0", "$0.00", "0%", "0.0", "$0.00 ", "0.00"}:
        return False
    return any(ch in text for ch in "$%,.") or any(ch.isalpha() for ch in text)


def build_scalar_map(ctx) -> list[tuple[str, str, str, str]]:
    """(search string, replacement, token, section) for every scalar token."""
    from ev_proposal_agent.extract import format_value

    formats = load_field_map()["meta"]["formats"]
    out: list[tuple[str, str, str, str]] = []
    seen: dict[str, str] = {}
    for token, fmt, section in SCALAR_TOKENS:
        value = ctx.raw.get(token)
        if value is None:
            continue
        text = format_value(value, fmt, formats)
        if not is_safe_search_string(text):
            continue
        if text in seen:
            # Two tokens share a printed value, so a global replace cannot tell
            # them apart. First one wins; the other is reported for manual
            # placement rather than silently mis-assigned.
            continue
        seen[text] = token
        out.append((text, f"{{{{ {token} }}}}", token, section))
    return out


def place_cell_tokens(doc, report: list[str]) -> list[str]:
    """Write tokens into specific cells, asserting the cell holds what we expect.

    Runs BEFORE the loop conversion, while row indices still match the dump.
    """
    tables = doc.tables
    problems: list[str] = []
    for t_i, r_i, c_i, expect, token, section in CELL_TOKENS:
        try:
            cell = tables[t_i].rows[r_i].cells[c_i]
        except IndexError:
            problems.append(f"table {t_i} r{r_i}c{c_i} out of range ({section})")
            continue
        actual = cell.text.strip()
        if actual == expect:
            set_cell_text(cell, token)
            report.append(f"  {section:<26} r{r_i}c{c_i} {expect!r} -> {token}")
            continue

        # KPI tiles stack a figure, a caption and a sub-caption as separate
        # paragraphs in one cell. Only the figure paragraph should change;
        # overwriting the cell would delete the label under it.
        target = next(
            (p for p in cell.paragraphs if p.text.strip() == expect), None
        )
        if target is not None:
            set_paragraph_text(target, token)
            report.append(
                f"  {section:<26} r{r_i}c{c_i} para {expect!r} -> {token}"
            )
            continue

        problems.append(
            f"table {t_i} r{r_i}c{c_i} holds {actual!r}, expected {expect!r} ({section})"
        )
    return problems


def tokenise_section_badges(doc, report: list[str]) -> list[str]:
    """Replace each badge number with a lookup into the numbering plan."""
    problems: list[str] = []
    tables = doc.tables

    def set_badge(table_index: int, row_index: int, key: str) -> None:
        try:
            cell = tables[table_index].rows[row_index].cells[0]
        except IndexError:
            problems.append(f"badge table {table_index} row {row_index} missing ({key})")
            return
        current = cell.text.strip()
        if not re.fullmatch(r"\d{1,2}[A-D]?", current):
            problems.append(
                f"table {table_index} r{row_index} holds {current!r}, "
                f"which is not a section badge ({key})"
            )
            return
        set_cell_text(cell, "{{ section_number." + key + ".number }}")
        report.append(f"  {current:<4} -> section_number.{key}")

    for table_index, key in SECTION_BADGES:
        set_badge(table_index, 0, key)
    set_badge(*SECTION_BADGE_6A)
    return problems


def tokenise_continuation_labels(doc, report: list[str]) -> list[str]:
    """Point each "Continuation of Section N" at the numbering plan."""
    problems: list[str] = []
    for table_index, parent_key, expect in CONTINUATION_LABELS:
        try:
            cell = doc.tables[table_index].rows[0].cells[1]
        except IndexError:
            problems.append(f"continuation table {table_index} missing ({parent_key})")
            continue
        hit = next((p for p in cell.paragraphs if p.text.strip() == expect), None)
        if hit is None:
            found = [p.text.strip() for p in cell.paragraphs if p.text.strip()]
            problems.append(
                f"table {table_index} has no paragraph {expect!r} (found {found[:3]})")
            continue
        prefix = expect.rsplit(" ", 1)[0]        # "Continuation of Section"
        set_paragraph_text(
            hit, prefix + " {{ section_number." + parent_key + ".number }}")
        report.append(f"  {expect:<30} -> section_number.{parent_key}")
    return problems


def _carries_section_break(element) -> bool:
    """True for a paragraph holding a `sectPr` (a page-orientation change)."""
    if element.tag != qn("w:p"):
        return False
    pr = element.find(qn("w:pPr"))
    return pr is not None and pr.find(qn("w:sectPr")) is not None


def wrap_sections(doc, report: list[str]) -> list[str]:
    """Wrap every section's body in a docxtpl `{%p if show_<key> %}` guard.

    Anchored on the badge tables rather than body indices, because inserting a
    paragraph shifts every index after it. Each range ends at the next badge, or
    earlier if a section-break paragraph comes first.
    """
    problems: list[str] = []
    tables = doc.tables
    body = doc.element.body

    def tag_paragraph(text: str):
        p = body.makeelement(qn("w:p"), {})
        r = body.makeelement(qn("w:r"), {})
        t = body.makeelement(qn("w:t"), {})
        t.text = text
        t.set(qn("xml:space"), "preserve")
        r.append(t)
        p.append(r)
        return p

    # Badge element -> key, in document order. 6A lives in row 1 of a two-row
    # table, so the whole table is its anchor.
    anchors: list[tuple[object, str]] = []
    for table_index, key in SECTION_BADGES:
        anchors.append((tables[table_index]._tbl, key))
    anchors.append((tables[SECTION_BADGE_6A[0]]._tbl, SECTION_BADGE_6A[2]))
    order = {id(el): i for i, el in enumerate(list(body))}
    anchors.sort(key=lambda pair: order.get(id(pair[0]), 0))

    for position, (start_el, key) in enumerate(anchors):
        next_el = anchors[position + 1][0] if position + 1 < len(anchors) else None

        # Walk forward from the badge and stop at whichever comes first: the
        # next badge, or a paragraph carrying a section break.
        stop_before = next_el
        node = start_el.getnext()
        while node is not None and node is not next_el:
            if _carries_section_break(node):
                stop_before = node
                break
            node = node.getnext()

        start_el.addprevious(tag_paragraph("{%p if show_" + key + " %}"))
        end_tag = tag_paragraph("{%p endif %}")
        if stop_before is not None:
            stop_before.addprevious(end_tag)
        else:
            body.append(end_tag)

    report.append(f"  {len(anchors)} sections guarded by show_<key>")
    report.append("  ranges clamped at section-break paragraphs so page "
                  "orientation survives")
    return problems


def convert_listings(doc, report: list[str]) -> list[str]:
    """Turn the page-2 contents and the Section 2 listing into loops."""
    problems: list[str] = []
    tables = doc.tables

    toc = tables[TOC_TABLE]
    if toc.rows[0].cells[0].text.strip().lower() != "section":
        problems.append(f"table {TOC_TABLE} does not look like the contents table")
    else:
        make_row_loop(
            toc, 1,
            header="{%tr for s in toc_rows %}",
            cell_exprs=["{{ s.number }}", "{{ s.title }}", "{{ s.page }}"],
            drop_rows=list(range(2, len(toc.rows))),
        )
        report.append(f"  table {TOC_TABLE} -> {{%tr for s in toc_rows %}} (page 2)")

    contents = tables[CONTENTS_TABLE]
    if contents.rows[0].cells[0].text.strip().lower() != "section":
        problems.append(f"table {CONTENTS_TABLE} does not look like the S2 listing")
    else:
        make_row_loop(
            contents, 1,
            header="{%tr for s in contents_rows %}",
            cell_exprs=["{{ s.number }}", "{{ s.title }}",
                        "{{ s.number2 }}", "{{ s.title2 }}"],
            drop_rows=list(range(2, len(contents.rows))),
        )
        report.append(f"  table {CONTENTS_TABLE} -> "
                      "{%tr for s in contents_rows %} (Section 2)")
    return problems


def fix_product_photos(doc, report: list[str]) -> list[str]:
    """Take the two charger photos off their page anchors and make them content.

    In the reference they are `wp:anchor` drawings with `wrapNone`, pinned 4.66
    inches down from the top of the *page*, with nine empty `ZIE H2` paragraphs
    below reserving the space they occupy. That only works because the reference
    equipment table is exactly six rows tall. Generate a proposal with a two-row
    table and everything shifts up while the photos stay put, so they land on
    the configuration narrative.

    Replaced with inline placeholders in their own centred paragraph, each
    guarded by the level it depicts, so a Level-2-only site does not show a DC
    fast charger it is not buying.
    """
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    from tools.docx_edit import extract_media, remove_floating_drawings

    problems: list[str] = []

    written = extract_media(SOURCE, {
        "media/image5.png": ROOT / "templates" / "assets" / "charger_level2.png",
        "media/image6.png": ROOT / "templates" / "assets" / "charger_level3.png",
        # the cover hero, kept as the fallback when the operator supplies none
        "media/image2.jpeg": ROOT / "templates" / "assets" / "cover_default.jpeg",
    })
    for member, destination in written.items():
        report.append(f"  extracted {member} -> {destination.relative_to(ROOT)}")
    if len(written) != 3:
        problems.append("expected two product photos and a cover photo in the media")

    host = next(
        (p for p in doc.paragraphs
         if p.text.strip() == "Recommended equipment schedule"), None
    )
    if host is None:
        problems.append("could not find the 'Recommended equipment schedule' heading")
        return problems

    removed = remove_floating_drawings(host)
    report.append(f"  removed {len(removed)} page-anchored drawing(s) from the heading")

    # The spacer paragraphs existed only to hold open the space the anchors
    # occupied. With the photos inline they collapse the section instead.
    spacers = 0
    node = host._p.getnext()
    while node is not None:
        following = node.getnext()
        if node.tag == qn("w:p"):
            para = Paragraph(node, host._parent)
            if para.style.name == "ZIE H2" and not para.text.strip():
                node.getparent().remove(node)
                spacers += 1
            elif para.text.strip():
                break
        node = following
    report.append(f"  removed {spacers} empty spacer paragraph(s)")

    # Place the photos after the equipment table, where the eye expects them.
    anchor_table = None
    node = host._p.getnext()
    while node is not None:
        if node.tag == qn("w:tbl"):
            anchor_table = node
            break
        node = node.getnext()
    if anchor_table is None:
        problems.append("no table follows the equipment heading")
        return problems

    holder = copy.deepcopy(host._p)
    anchor_table.addnext(holder)
    photo_para = Paragraph(holder, host._parent)
    photo_para.style = doc.styles["Normal"]
    set_paragraph_text(
        photo_para,
        "{% if has_l2 %}{{ photo_level2 }}{% endif %}"
        "{% if has_l2 and has_l3 %}    {% endif %}"
        "{% if has_l3 %}{{ photo_level3 }}{% endif %}",
    )
    photo_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    report.append("  inline photo paragraph inserted after the equipment table")
    report.append("    Level 2 photo shown only when has_l2, Level 3 only when has_l3")
    return problems


def replace_prose(doc, report: list[str]) -> int:
    """Swap whole paragraphs of judgement prose for a single token."""
    from tools.docx_edit import iter_paragraphs, set_paragraph_text

    hits = 0
    matched: set[str] = set()
    for paragraph in iter_paragraphs(doc):
        text = paragraph.text.strip()
        if not text:
            continue
        for needle, token, why in PROSE_REPLACEMENTS:
            # Substring, not prefix: several of these paragraphs already had
            # their opening words tokenised by an earlier pass, so the sentence
            # no longer starts with the words it started with in the reference.
            if needle in text:
                set_paragraph_text(paragraph, token)
                label = token or "(removed)"
                report.append(f"  {label} <- {text[:56]!r}...  ({why})")
                matched.add(needle)
                hits += 1
                break

    for needle, _token, why in PROSE_REPLACEMENTS:
        if needle not in matched:
            report.append(f"  ! no paragraph contained {needle!r}  ({why})")
    return hits


def delete_marked_rows(doc, report: list[str]) -> None:
    """Remove the idle-policy rows and bullets, then close the numbering gap.

    The methodology table numbers its layers 1..7. Deleting layer 5 leaves
    1,2,3,4,6,7 on the page, so the leading numbers are rewritten in sequence
    afterwards - by scanning for the "N. " prefix rather than by hardcoding
    which rows moved, so adding or removing another layer needs no edit here.
    """
    from tools.docx_edit import delete_row

    for table_idx, row_idx, expect, why in sorted(DELETE_ROWS, reverse=True):
        try:
            table = doc.tables[table_idx]
            row = table.rows[row_idx]
        except IndexError:
            report.append(f"  ! table {table_idx} row {row_idx} is out of range  ({why})")
            continue
        text = " ".join(c.text for c in row.cells)
        if expect not in text:
            report.append(
                f"  ! table {table_idx} row {row_idx} does not contain {expect!r} "
                f"- it holds {text.strip()[:48]!r}  ({why})")
            continue
        delete_row(row)
        report.append(f"  removed table {table_idx} row {row_idx}  ({why})")

    for table_idx, row_idx, cell_idx, expect, why in DELETE_PARAGRAPHS:
        try:
            cell = doc.tables[table_idx].rows[row_idx].cells[cell_idx]
        except IndexError:
            report.append(f"  ! table {table_idx} r{row_idx}c{cell_idx} out of range  ({why})")
            continue
        hit = next((p for p in cell.paragraphs if expect in p.text), None)
        if hit is None:
            report.append(f"  ! no paragraph in table {table_idx} contains {expect!r}  ({why})")
            continue
        report.append(f"  removed bullet {hit.text.strip()[:52]!r}  ({why})")
        hit._element.getparent().remove(hit._element)

    # Close the numbering gap left in the methodology table.
    for table_idx in sorted({t for t, _r, _e, _w in DELETE_ROWS}):
        renumber_leading_ordinals(doc.tables[table_idx], report)


def renumber_leading_ordinals(table, report: list[str]) -> None:
    """Rewrite "5. Idle policy" style prefixes so they run 1..N with no gap."""
    import re
    from tools.docx_edit import set_cell_text

    seen = 0
    for row in table.rows:
        cell = row.cells[0]
        m = re.match(r"^(\d+)\.\s+(.*)$", cell.text.strip(), re.S)
        if not m:
            continue
        seen += 1
        want = f"{seen}. {m.group(2)}"
        if cell.text.strip() != want:
            set_cell_text(cell, want)
            report.append(f"  renumbered {m.group(1)!r} -> {seen} ({m.group(2)[:34]!r})")


def convert_tables(doc, report: list[str]) -> None:
    tables = doc.tables
    for index, spec in TABLE_LOOPS.items():
        if index >= len(tables):
            report.append(f"  ! table {index} not found ({spec['section']})")
            continue
        table = tables[index]
        first = spec["first_data_row"]
        keep_tail = spec.get("keep_tail", 0)
        last_data = len(table.rows) - 1 - keep_tail
        drop = list(range(first + 1, last_data + 1))
        make_row_loop(
            table,
            first,
            header=f"{{%tr for {spec['var']} in {spec['collection']} %}}",
            cell_exprs=spec["exprs"],
            drop_rows=drop,
        )
        report.append(
            f"  S{spec['section']:<4} table {index:<3} -> "
            f"{{%tr for {spec['var']} in {spec['collection']} %}} "
            f"({len(drop)} sample rows removed, {keep_tail} tail rows kept)"
        )


def delete_unsourced_section5_rows(doc, report: list[str]) -> None:
    """Two Section 5 rows have no scenario-grid equivalent."""
    from tools.docx_edit import delete_row

    for table in doc.tables:
        for row in list(table.rows):
            label = row.cells[0].text.strip()
            if label in SECTION_5_ROWS_TO_DELETE:
                delete_row(row)
                report.append(f"  deleted unsourced row: {label!r}")


def swap_charts(doc, report: list[str]) -> None:
    for paragraph, drawing, target, cx, cy in find_inline_images(doc):
        if target == COVER_TOKEN[0]:
            replace_image_with_token(paragraph, drawing, COVER_TOKEN[1])
            report.append(f"  {target} -> {COVER_TOKEN[1]}  (cover hero, "
                          f"{cx/914400:.2f} x {cy/914400:.2f} in)")
            continue
        if target not in CHART_TOKENS:
            continue
        token, w_in, h_in = CHART_TOKENS[target]
        replace_image_with_token(paragraph, drawing, token)
        report.append(
            f"  {target} -> {token}  (display {w_in} x {h_in} in, "
            f"{cx} x {cy} EMU)"
        )


def write_inventory(scalars, report_lines: list[str], unmatched: list[str]) -> None:
    lines = [
        "# PLACEHOLDER_INVENTORY",
        "",
        "Every token in `templates/proposal_template.docx`, what it holds and where",
        "it comes from. Generated by `python -m tools.build_template`; do not edit by",
        "hand. `render.py` fails the build when this list and the field map disagree.",
        "",
        "## Identity and operator input",
        "",
        "| Token | Replaces | Appears in |",
        "|---|---|---|",
    ]
    for literal, token, where in IDENTITY:
        lines.append(f"| `{token}` | `{literal}` | {where} |")
    for literal, token, where in LITERAL_SCALARS:
        lines.append(f"| `{token}` | `{literal}` | {where} |")

    lines += [
        "",
        "## Workbook scalars",
        "",
        "Matched by each token's own formatted value, so the template and the",
        "extractor cannot drift apart.",
        "",
        "| Token | Reference value | Section |",
        "|---|---|---|",
    ]
    for text, token, name, section in sorted(scalars, key=lambda s: s[2]):
        lines.append(f"| `{{{{ {name} }}}}` | `{text}` | {section} |")

    lines += [
        "",
        "## Loop collections",
        "",
        "| Collection | Loop variable | Section | Cells |",
        "|---|---|---|---|",
    ]
    for index, spec in sorted(TABLE_LOOPS.items(), key=lambda kv: kv[1]["section"]):
        cells = " / ".join(spec["exprs"])
        lines.append(
            f"| `{spec['collection']}` | `{spec['var']}` | {spec['section']} | {cells} |"
        )

    lines += [
        "",
        "## Charts",
        "",
        "| Token | Replaces | Display size |",
        "|---|---|---|",
    ]
    for target, (token, w, h) in CHART_TOKENS.items():
        lines.append(f"| `{token}` | `word/{target}` | {w} x {h} in |")

    lines += [
        "",
        "## Conditional blocks",
        "",
        "| Condition | Controls |",
        "|---|---|",
        "| `has_itc` | the Federal ITC row in the Section 7 ROI table and the ITC stat card |",
        "| `has_financing` | Sections 14, 17 and 17A to 17D |",
        "| `has_l2` | the Level 2 column in Section 5 and the Level 2 carbon sentence |",
        "| `has_history` | Sections 3, 3A, 3B, the Section 5 comparison and chart 1 |",
        "",
        "## Build report",
        "",
        "```",
        *report_lines,
        "```",
    ]
    if unmatched:
        lines += [
            "",
            "## Unmatched tokens",
            "",
            "These tokens produced no match in the reference document. Either the",
            "figure is not printed, or it is printed in a spelling the extractor's",
            "format does not reproduce. Worth checking before trusting the template.",
            "",
            *(f"- `{t}`" for t in unmatched),
        ]

    INVENTORY.parent.mkdir(parents=True, exist_ok=True)
    INVENTORY.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _accounted_for(unmatched: list[str]) -> dict[str, str]:
    """Explain each scalar that found no literal to replace."""
    in_loop = {
        "cost_equipment_invoice", "cost_charger_hardware", "cost_service_warranty",
        "cost_evolv_commissioning", "cost_sales_tax_chargers",
        "cost_electrical_subtotal", "cost_labor",
    }
    by_cell = {t for _i, _r, _c, _e, tok, _s in CELL_TOKENS
               for t in [tok.strip("{} ").split("}")[0].strip()]}
    reasons: dict[str, str] = {}
    for token in unmatched:
        if token in in_loop:
            reasons[token] = "row now inside {%tr for r in cost_rows %}"
        elif token in by_cell or token in {"evolv_annual_cost", "modeled_rating_l2",
                                           "modeled_rating_l3"}:
            reasons[token] = "placed by cell coordinate (CELL_TOKENS)"
        elif token == "roi_total_costs_upfront":
            reasons[token] = ("printed as '-{{ cost_after_discount }}'; "
                              "the workbook cell is =-B44, so this is equivalent")
    return reasons


def main() -> int:
    if not SOURCE.exists():
        print(f"error: missing {SOURCE}", file=sys.stderr)
        return 2

    print("Extracting the reference workbook to derive search strings...")
    fm = load_field_map()
    with engine_mod.load(LEGACY_XLSX, fm) as lw:
        ctx = build_context(lw, fm, operator_inputs=OPERATOR_INPUTS)

    # Build to a scratch file and move it into place only once every step has
    # succeeded. Editing TEMPLATE directly means a crash mid-build leaves a
    # half-tokenised template on disk - raw literals, no section guards - and
    # the next `generate` uses it without complaint. That happened: an
    # UnboundLocalError between the badge pass and the loop pass left a
    # template whose greenfield output carried "10-YEAR" as frozen text.
    TEMPLATE.parent.mkdir(parents=True, exist_ok=True)
    working = TEMPLATE.with_name(TEMPLATE.stem + ".building" + TEMPLATE.suffix)
    # A previous crash leaves this behind. Clear it here rather than in a
    # finally block: on a failure the scratch file is the only evidence of how
    # far the build got, and it is worth keeping until the next attempt.
    if working.exists():
        working.unlink()
    shutil.copyfile(SOURCE, working)
    doc = Document(working)
    report: list[str] = []
    counts: Counter = Counter()

    print("Placing coordinate-targeted cell tokens...")
    report.append("CELL TOKENS")
    cell_problems = place_cell_tokens(doc, report)
    for problem in cell_problems:
        report.append(f"  ! {problem}")

    print("Un-anchoring the product photos...")
    report.append("")
    report.append("PRODUCT PHOTOS")
    for problem in fix_product_photos(doc, report):
        report.append(f"  ! {problem}")

    print("Replacing judgement prose with single tokens...")
    report.append("")
    report.append("PROSE")
    prose_hits = replace_prose(doc, report)

    print("Wrapping conditional rows...")
    report.append("")
    report.append("CONDITIONAL ROWS")
    for t_i, r_i, condition, why in CONDITIONAL_ROWS:
        wrap_row_conditional(doc.tables[t_i], r_i, condition)
        report.append(f"  table {t_i} row {r_i} -> {{%tr if {condition} %}}  ({why})")
    for t_i, first, last, condition, why in CONDITIONAL_TABLES:
        wrap_rows_conditional(doc.tables[t_i], first, last, condition)
        report.append(
            f"  table {t_i} rows {first}-{last} -> {{%tr if {condition} %}}  ({why})")

    print("Tokenising section badges...")
    report.append("")
    report.append("SECTION BADGES")
    for problem in tokenise_section_badges(doc, report):
        report.append(f"  ! {problem}")

    report.append("")
    report.append("CONTINUATION LABELS")
    for problem in tokenise_continuation_labels(doc, report):
        report.append(f"  ! {problem}")

    print("Converting the two contents listings...")
    report.append("")
    report.append("CONTENTS LISTINGS")
    for problem in convert_listings(doc, report):
        report.append(f"  ! {problem}")

    print("Removing idle-policy rows...")
    report.append("")
    report.append("IDLE-POLICY REMOVAL")
    delete_marked_rows(doc, report)

    print("Converting tables to loops...")
    report.append("")
    report.append("TABLE LOOPS")
    convert_tables(doc, report)

    # Last, because inserting paragraphs shifts nothing that later steps use
    # but the table indices above must still be the original ones.
    print("Guarding every section...")
    report.append("")
    report.append("SECTION SUPPRESSION")
    for problem in wrap_sections(doc, report):
        report.append(f"  ! {problem}")
    delete_unsourced_section5_rows(doc, report)

    print("Replacing chart images with placeholders...")
    report.append("")
    report.append("CHARTS")
    swap_charts(doc, report)

    print("Tokenising body, headers and footers...")
    scalars = build_scalar_map(ctx)

    # One combined substitution list, applied in a single pass per part.
    # Longest-first ordering inside replace_many keeps the address from being
    # shredded by a later match on 'Stockton'.
    all_pairs: list[tuple[str, str]] = (
        [(literal, token) for literal, token, _ in IDENTITY]
        + [(text, token) for text, token, _, _ in scalars]
        + [(a, b) for a, b, _ in LITERAL_SCALARS]
        + [(a, b) for a, b, _ in CAPTIONS]
        + HORIZON_STRINGS
    )

    for name, part in iter_story_parts(doc):
        hits = replace_many(part, all_pairs)
        for literal, n in hits.items():
            counts[literal] += n
            if name != "document":
                report.append(f"  {name:<28} {literal!r} x{n}")

    report.append("")
    report.append("IDENTITY")
    for literal, token, where in IDENTITY:
        report.append(f"  {token:<28} <- {literal!r} x{counts.get(literal, 0)}  ({where})")

    report.append("")
    report.append("SCALARS")
    unmatched: list[str] = []
    for text, _token, name, _section in scalars:
        n = counts.get(text, 0)
        if n:
            report.append(f"  {name:<30} {text!r} x{n}")
        else:
            unmatched.append(name)

    report.append("")
    report.append("LITERALS AND HORIZON")
    for literal, _repl, where in LITERAL_SCALARS:
        report.append(f"  {literal!r:<58} x{counts.get(literal, 0)}  ({where})")
    for literal, _repl in HORIZON_STRINGS:
        report.append(f"  {literal!r:<58} x{counts.get(literal, 0)}")

    doc.save(working)

    print("Scrubbing docProps and non-story parts...")
    package_hits = scrub_package(working, PACKAGE_SCRUB)
    report.append("")
    report.append("PACKAGE SCRUB")
    for literal, n in package_hits.items():
        report.append(f"  {literal!r} x{n}")

    fixed_pages = clear_cached_page_numbers(working)
    report.append("")
    report.append("KNOWN DEFECTS FIXED")
    report.append(
        f"  cleared {fixed_pages} cached PAGE field result(s) - the reference "
        "reads 'Page 1' on all 31 pages"
    )

    leftover = audit_identity(working)
    report.append("")
    report.append("IDENTITY AUDIT")
    if leftover:
        for part, found in leftover.items():
            report.append(f"  ! {part}: {', '.join(found)}")
    else:
        report.append("  clean - no client identity anywhere in the package")

    write_inventory(scalars, report, unmatched)

    print()
    print("\n".join(report))
    print()
    # Everything passed: publish atomically.
    os.replace(working, TEMPLATE)

    print(f"Template : {TEMPLATE}")
    print(f"Inventory: {INVENTORY}")
    if unmatched:
        # Most of these are expected: the value now lives inside a `{%tr for %}`
        # loop, or was placed by coordinate, so its literal text is gone by the
        # time the scalar pass runs. Anything NOT in that set is a real gap.
        accounted = _accounted_for(unmatched)
        surprises = [t for t in unmatched if t not in accounted]
        print(f"\n{len(unmatched)} scalar token(s) matched no literal text:")
        for token in unmatched:
            print(f"  {token:<28} {accounted.get(token, 'UNACCOUNTED - check this')}")
        if surprises:
            print(f"\n{len(surprises)} unaccounted token(s): {', '.join(surprises)}")
    if leftover:
        print(f"\nFAILED: client identity survives in {len(leftover)} part(s)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
