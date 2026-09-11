# Source audit — every number, chart and variable phrase

Generated 2026-09-10. Regenerate with:

```
python -m tools.audit_template             # section 1
python -m tools.audit_sources --markdown   # the appendix
```

The question this answers: **can every figure a customer reads be traced to a
cell in the workbook the operator dropped in?** Before this audit the honest
answer was no — not because the figures were mostly wrong, but because nothing
connected them. The chain has four hops:

```
workbook cell  ->  ctx token  ->  template token  ->  rendered position
```

Each hop was tested somewhere. The chain was tested nowhere. Exactly one test
in sixteen files compared a workbook cell to a value on a rendered page, and it
checked a sum rather than a token.

---

## 1. Literals left in the template

`tools/audit_template.py` scans **every** XML part with jinja stripped, so text
boxes, headers and footers are included — `python-docx` sees none of those, and
the differential leak test walked table cells only.

**Nine literals before this audit; seven now, all constants.**

| literal | verdict | why |
|---|---|---|
| `30%` | constant | IRC 48 base ITC rate — federal statute |
| `10%` | constant | IRC 48 domestic-content and energy-community adders |
| `3,500` / `4,500` | constant | LCFS FCI credit explainer — kWh per metric ton |
| `2.5%` | constant | LCFS statewide deficit cap |
| `$20` / `$35` | constant | illustrative California demand-charge band, prose only |
| ~~`$8,600`~~ | **fixed** | was the reference site's carbon tier multiplier |
| ~~`$0.0045`~~ | **fixed** | was the Level 2 consumption factor |

The audit exits non-zero on any literal with no recorded verdict, so a template
rebuild that reintroduces one fails rather than shipping.

No reference-site identity survives anywhere: no site name, address, contact or
date in `document.xml`, any header, any footer, or `docProps`.

## 2. Defects found and fixed

### 2.1 Section 13 quoted the reference site's carbon economics on every proposal

The sentence was frozen literal text, not a token:

> "…with current rates of **$8,600 per year for the 100 kW class**."

`narrative.py` computed the correct sentence for each site and `render.py`
passed it to the template, but `{{ narrative_carbon }}` appeared **nowhere in
the template**, so the value was discarded every run. What each site should
have said, against what actually printed:

| workbook | correct | printed |
|---|---|---|
| Best Western | `$17,200/yr, 240 kW class` | `$8,600 … 100 kW` |
| Marriott | `$4,300/yr, 60 kW class` | `$8,600 … 100 kW` |
| Food4Less *(the reference site)* | `$8,600/yr, **98** kW class` | `$8,600 … **100** kW` |

Two defects stacked: the reference site's figure on every other proposal, and
the wrong class even on its own. A Best Western reader was told their credit
rate was half what the model uses.

**Fix.** `cc_tier_sentence` was already computed and emitted but never placed.
Both carbon paths now publish it — the single-tier chassis did not — and
`LITERAL_SCALARS` places it inline. Not through `PROSE_REPLACEMENTS`, which
swaps a whole paragraph and would have destroyed the generic programme
explainer wrapped around the one site-varying clause.

Verified end to end by rendering all three: Best Western now prints
`$17,200 per year for the 240 kW class`, and Food4Less prints its true 98 kW.

### 2.2 The single-tier carbon path ignored declared formats

`_carbon_single_tier` hardcoded `fmt="number4"` for all five tokens, overriding
the map. `cc_l2_rate` is declared `currency4` because Section 13 prints it as
money, so the legacy chassis alone rendered `0.0045` instead of `$0.0045`.

### 2.3 `projection_years` claimed a cell it does not read

Its source said `Financial Worksheet!B10` on every chassis. On `v15_no_itc`,
`legacy_food4less` and Marriott L2 that cell is **empty** — the horizon comes
from the chassis map's `horizon: {fixed: 10}`. The QA report told an operator
the horizon came from a cell they could open and change. It did not.

Now: `fixed at 10 for the legacy_food4less chassis (no Financial Worksheet!B9 toggle)`.

### 2.4 `engine` and `revenue_scenario` overstated their sources

Both named a bare cell. Neither holds its token's value: the scenario is parsed
from `I6`'s **formula**, and the engine name is a verdict reached by probing
`B3`'s text. Both now say `detected from …`, so a reader opening the cell is
not surprised by what they find.

### 2.5 `narrative_roi` — dead, not dangerous

Also computed and never placed. No frozen ROI figures exist in the template, so
nothing wrong printed. Recorded because `render.py` computes missing values as
`declared − payload` and never checks the inverse, so a discarded payload key
raises no finding at all. That is the hole 2.1 fell through.

## 3. Provenance

`ctx.put()` took `source=` **optionally**; 18 of 82 call sites omitted it, ten
of which rendered. All now carry one, verified across every chassis and engine:

| specimen | emitted | sourced | unsourced |
|---|---|---|---|
| v16 / scenario grid | 155 | 155 | 0 |
| v16 / master | 145 | 145 | 0 |
| v16 / legacy engine | 223 | 223 | 0 |
| v15_no_itc | 218 | 218 | 0 |
| v16 / L2 only | 150 | 150 | 0 |
| legacy_food4less | 219 | 219 | 0 |

**225 distinct tokens carry a source. 156 name a workbook cell or range; 69 are
stated derivations** such as `charger year 1 + roi_carbon_credits / projection_years`.
Between 44% and 56% of emitted tokens on each specimen are bound to a single
cell and are now compared against it directly.

## 4. Charts

All three plot workbook data with correct provenance — no reference figure was
ever baked into `charts.py`:

| chart | series | source |
|---|---|---|
| Historical revenue | monthly total / L3 / L2 | `Historical Data!A:G`, window parsed from the `J4`/`J5` formulas |
| Annual operating profit | year, annual | `Financial Worksheet!H5:J15` |
| Cumulative cashflow | year, cumulative | `cumCashCats`/`cumCashVals`, falling back to `consolidated_cashflow` |

They were nonetheless the largest hole in the suite: the only tests asserted a
PNG exists and exceeds 5 KB. A chart plotting the right shape from the wrong
column passed all of them. Charts are also outside the differential leak test —
every dollar figure rasterised into a PNG is invisible to a string search, so a
picture is the one place a wrong number cannot be found by reading the document.

`charts.chart_series()` now returns exactly what is drawn, and `render_all`
draws from it, so a test cannot drift from the page. Newly guarded, all passing:

- every plotted point equals `Financial Worksheet!I{row}`, read independently
- the bar count equals the horizon in the chart's own title — two separate
  reads of `B10`, each with its own `or 5` fallback
- chart 3 agrees with the Section 7A table beside it, which is read through a
  **different mechanism**; `validate.py` checks the table only
- the row count matches the caption's "Years 1 through N"
- two different sites plot different data

## 5. Test coverage added

| file | what it guarantees |
|---|---|
| `tests/test_source_binding.py` | every emitted token has a source; every single-cell token equals that cell, read independently; **mutating a cell moves exactly the tokens claiming it** |
| `tests/test_chart_data.py` | plotted series equal the workbook; charts agree with their captions and with the table beside them |
| `tests/test_prose_variability.py` | no KPI caption names idle fees or an absent ITC; L2 amperage is never invented; the carbon sentence carries this workbook's own class |
| `tests/test_no_hardcoded_figures.py` | now walks **paragraphs, headers and footers**, not just table cells — the blind spot 2.1 hid in |

The mutation test is the only construct that catches a wrong-cell read in
general. Every other test compares a token to a value originally obtained by
running the extractor, so a token wired to the wrong cell is recorded as
correct — which is how a fictional `$416,761` ITC line survived until a person
noticed it.

It was validated by sabotage: `cost_labor`'s source was deliberately changed to
a neighbouring row and the suite failed, then the change was reverted. A test
that has never been seen to fail proves nothing.

The template-constant list is **imported** by the differential test from
`tools/audit_template.py` rather than restated, so the two cannot drift apart.

## 6. Known limits

- **Derived tokens are not cell-checkable.** 69 of 225 are sums, ratios and
  captions. They are covered by arithmetic-identity tests, not by binding.
- **Detection-time tokens escape mutation.** `projection_years`,
  `revenue_scenario`, `engine`, `has_history` and `has_financing` resolve inside
  `engine.load()`, before any context exists, so changing the cell afterwards
  cannot reach them. Their binding is covered by the equality test instead.
- **`docs/CELL_MAP.md` is hand-maintained and stale** (7 August). It predates
  the infrastructure residual rework and the `_kpi` token family. Treat it as
  authoritative for cell addresses, not for which token prints where.
- **`tools/build_template.py` reports failures but does not fail.** A missed
  `expect` prints a `!` line into the build report and the build still exits 0.
  `audit_template.py` is the backstop, but the builder itself should gate.

---

## Appendix — every sourced token

| token | source | example |
|---|---|---|
| `all_l3_busy_share` | `Historical Data!K23` | n/a |
| `any_l3_busy_share` | `Historical Data!K24` | n/a |
| `avg_charge_minutes` | `Historical Data!J21` | 123.94 |
| `avg_charge_minutes_l3` | `Historical Data!K21` | 0.00 |
| `avg_charging_hours` | `Historical Data!J13` | 2.896 |
| `avg_charging_hours_l3` | `Historical Data!K13` | 0.000 |
| `avg_delivered_kw` | `Historical Data!J14` | 4.81 |
| `avg_delivered_kw_l3` | `Historical Data!K14` | 0.00 |
| `avg_kwh_day` | `Historical Data!J10` | 19.09 |
| `avg_kwh_day_l3` | `Historical Data!K10` | 0.00 |
| `avg_kwh_month` | `Historical Data!J9` | 581.0 |
| `avg_kwh_month_l3` | `Historical Data!K9` | 0.0 |
| `avg_kwh_session` | `Historical Data!J18` | 9.93 |
| `avg_kwh_session_l3` | `Historical Data!K18` | 0.00 |
| `avg_revenue_month` | `Historical Data!J8` | $297.85 |
| `avg_revenue_month_l3` | `Historical Data!K8` | $0.00 |
| `avg_stalls_in_service` | `Historical Data!J30` | 6.44 |
| `avg_stalls_in_service_l3` | `Historical Data!K30` | 0.00 |
| `avg_stalls_used_day` | `Historical Data!J12` | 1.371 |
| `avg_stalls_used_day_l3` | `Historical Data!K12` | 0.000 |
| `baseline_over_horizon` | `hist_profit_yearly x projection_years` | $3,872 |
| `benefit_delta` | `horizon_total_benefit - baseline_over_horizon` | $60,226 |
| `breakeven_year` | `derived from consolidated_cashflow` | not within the horizon |
| `cc_l2_credit_month` | `Financial Worksheet!G47` | $4.57 |
| `cc_l2_kwh_month` | `Financial Worksheet!E47` | 1,016.1 |
| `cc_l2_rate` | `Financial Worksheet!F47` | $0.0045 |
| `cc_l3_mult` | `Financial Worksheet!J43` | 8,600.0000 |
| `cc_l3_rating` | `Financial Worksheet!I43` | 98.0000 |
| `cc_multiplier_lines` | `Financial Worksheet!E45:J45 where E44:J44 > 0` | $17,200 |
| `cc_rate_per_kw` | `Financial Worksheet!E42` | 71.6667 |
| `cc_tier_sentence` | `Financial Worksheet!E45:J45 where E44:J44 > 0` | $17,200 per year for the 240 kW cl |
| `cc_total` | `Financial Worksheet!B4` | $345,098 |
| `cc_total_kpi` | `Financial Worksheet!B4` | $345,098 |
| `cf_carbon_monthly` | `Cashflow!G3` | $5,751.63 |
| `cf_net_first` | `Cashflow!I3` | -$8,694 |
| `cf_net_last` | `Cashflow!I62` | -$3,446 |
| `cf_net_total` | `Cashflow!I3:I62 (summed; I1 is blank)` | -$373,448 |
| `cf_total_carbon` | `Cashflow!G1` | $345,097.51 |
| `cf_total_evse_profit` | `Cashflow!H1` | $671,491.05 |
| `cf_total_loan_payments` | `Cashflow!F1` | $1,390,037.01 |
| `client_contact_name` | `operator input` | Contact |
| `client_info` | `INPUT SHEET!N19` |  |
| `client_title` | `default` | Owner |
| `construction_weeks` | `default` | 3 to 4 |
| `cost_ada` | `Financial Worksheet!B34` | $20,933.00 |
| `cost_after_discount` | `Financial Worksheet!B44` | $1,132,124.02 |
| `cost_asphalt` | `Financial Worksheet!B32` | $10,340.42 |
| `cost_autocad` | `Financial Worksheet!B23` | $0.00 |
| `cost_charger_hardware` | `Financial Worksheet!B17` | $325,654.00 |
| `cost_concrete` | `Financial Worksheet!B33` | $9,584.46 |
| `cost_construction_equip` | `Financial Worksheet!B38` | $14,840.20 |
| `cost_construction_pm` | `Financial Worksheet!B39` | $0.00 |
| `cost_design_invoice` | `Financial Worksheet!B22` | $0.00 |
| `cost_dump_waste` | `Financial Worksheet!B35` | $3,630.00 |
| `cost_ee_design` | `Financial Worksheet!B24` | $0.00 |
| `cost_electrical_other` | `cost_electrical_subtotal minus the 8 named Section 8 rows` | $17,249.52 |
| `cost_electrical_subtotal` | `Financial Worksheet!B27` | $191,639.04 |
| `cost_equipment_invoice` | `Financial Worksheet!B16` | $536,234.97 |
| `cost_evolv_commissioning` | `Financial Worksheet!B19` | $19,195.20 |
| `cost_grand_total` | `Financial Worksheet!B43` | $1,132,124.02 |
| `cost_labor` | `Financial Worksheet!B42` | $404,250.00 |
| `cost_labor_kpi` | `Financial Worksheet!B42` | $404,250 |
| `cost_materials` | `Financial Worksheet!B40` | $0.00 |
| `cost_permits` | `Financial Worksheet!B36` | $2,420.00 |
| `cost_plan_check_permit` | `Financial Worksheet!B26` | $0.00 |
| `cost_project_mgmt` | `Financial Worksheet!B25` | $0.00 |
| `cost_sales_tax_chargers` | `Financial Worksheet!B21` | $23,609.91 |
| `cost_sales_tax_equipment` | `Financial Worksheet!B41` | $0.00 |
| `cost_service_warranty` | `Financial Worksheet!B18` | $167,775.86 |
| `cost_service_warranty_kpi` | `Financial Worksheet!B18` | $167,776 |
| `cost_striping_bollards` | `Financial Worksheet!B31` | $3,115.02 |
| `cost_subpanels` | `Financial Worksheet!B30` | $13,878.70 |
| `cost_switchgear` | `Financial Worksheet!B29` | $68,970.00 |
| `cost_utility` | `Financial Worksheet!B37` | $4,489.10 |
| `cost_wires_conduits` | `Financial Worksheet!B28` | $39,438.14 |
| `days_in_window` | `Historical Data!J5` | 1,065 |
| `days_in_window_l3` | `Historical Data!K5` |  |
| `dcfc_mix_sentence` | `INPUT SHEET!O8:T8 x O10:T10, active tiers only` | 4 x 240 kW |
| `dcfc_revenue_share` | `hist_l3_revenue / hist_total_revenue` | 0% |
| `dead_stations_l2` | `Historical Data!J27` | 1 of 4 (40201, ~1 yr) |
| `dead_stations_l3` | `Historical Data!K27` | n/a |
| `derate` | `INPUT SHEET!N11` | 0.98 |
| `downtime_assumption` | `default` | 3% |
| `effective_rate` | `Historical Data!J11` | $0.513 |
| `effective_rate_l3` | `Historical Data!K11` | $0.000 |
| `engine` | `detected from Updated Chargers Revenue Calcul!B3` | scenario_grid |
| `evolv_annual_cost` | `Internal Summary!I3` | $3,839 |
| `evolv_contract_years` | `Internal Summary!G4` | 5 |
| `evolv_customer_total` | `Internal Summary!D6` | $19,195 |
| `evolv_fee_per_port` | `Internal Summary!H3` | $39.99 |
| `evolv_ports` | `Internal Summary!G3` | 8 |
| `existing_nameplate_l2_kw` | `Updated Chargers Revenue Calcul!B12 / INPUT SHEET!N11` | 7.2 |
| `existing_nameplate_l3_kw` | `Updated Chargers Revenue Calcul!C12 / INPUT SHEET!N11` | 50.0 |
| `existing_ports_l2` | `operator input` | 8 |
| `existing_ports_l3` | `operator input` | 2 |
| `failed_session_share` | `Historical Data!J20` | 25.5% |
| `failed_session_share_l3` | `Historical Data!K20` | 0.0% |
| `final_cumulative` | `derived from consolidated_cashflow` | -$115,535 |
| `growth_rate` | `field_map` | 12.5% |
| `hist_gross_yearly` | `recomputed from Historical Data` | $3,524 |
| `hist_l3_revenue` | `Historical Data!C4:C38 summed` | $0 |
| `hist_profit_3yr` | `hist_profit_yearly x 3` | $2,323 |
| `hist_profit_5yr` | `hist_profit_yearly x 5` | $3,872 |
| `hist_profit_yearly` | `recomputed from Historical Data` | $774 |
| `hist_total_revenue` | `Historical Data!D4:D38 summed` | $10,425 |
| `hist_utility_rate_l2` | `Updated Chargers Revenue Calcul!B18` | $0.40 |
| `hist_utility_rate_l3` | `Updated Chargers Revenue Calcul!C18` | $0.40 |
| `history_window_label` | `Historical Data!A4 to A38` | Sep 2023 to Jul 2026 |
| `horizon_evse_total` | `roi_evse_revenues` | $671,491 |
| `horizon_total_benefit` | `roi_evse_revenues + roi_carbon_credits` | $1,016,589 |
| `idle_fee_annual` | `the scenario grid has no idle-fee model` | $0 |
| `idle_fees_collected` | `Historical Data!K25` | $0 |
| `idle_grace_l2_min` | `the scenario grid has no idle-fee model` | 0 |
| `idle_grace_l3_min` | `the scenario grid has no idle-fee model` | 0 |
| `job_number` | `parsed from client_info` |  |
| `kpi_horizon_total` | `roi_evse_revenues + roi_carbon_credits` | $1,016,589 |
| `kpi_horizon_total_sub` | `caption keyed on has_itc (roi_itc != 0)` | Chargers revenue + Carbon credits |
| `kpi_projected_vs_baseline` | `kpi_year1_operating - hist_profit_yearly` | $5,861 |
| `kpi_uplift` | `kpi_year1_operating / hist_profit_yearly - 1` | 756.9% |
| `kpi_year1_operating` | `charger cashflow, year 1 (Financial Worksheet column I)` | $104,655 |
| `kpi_year1_total` | `charger year 1 + roi_carbon_credits / projection_years` | $173,674 |
| `kpi_year1_total_label` | `caption keyed on has_itc (roi_itc != 0)` | YEAR 1 TOTAL BENEFIT |
| `kpi_year1_total_sub` | `caption keyed on has_itc (roi_itc != 0)` | Chargers revenue + Carbon credits |
| `l2_amperage` | `Level 2 line-item description, else the SKU` | 80A |
| `l2_mix_sentence` | `INPUT SHEET line items where category is _L2` | 2 x 80A Dual Commercial L2 Charger |
| `l2_quantity_ports` | `INPUT SHEET!N8 units, N9 ports` | 2 units / 4 ports |
| `l2_sku` | `INPUT SHEET!E8:E37, first '_L2' line item` | CTX-C80-240-2 |
| `l3_column_heading` | `INPUT SHEET!O10:T10, active tiers only` | Level 3 (4 x 240 kW) |
| `loan_actual_payments` | `DLL Schedule!J7` | 60 |
| `loan_amount` | `DLL Schedule!D5 (name Loan_Amount)` | $1,132,124.02 |
| `loan_amount_kpi` | `DLL Schedule!D5 (name Loan_Amount)` | $1,132,124 |
| `loan_early_payments` | `DLL Schedule!J8` | $0.00 |
| `loan_extra_pmts` | `DLL Schedule!D10 (name Scheduled_Extra_Payments)` | $0.00 |
| `loan_first_pmt_date` | `DLL Schedule!B18` | September 1, 2026 |
| `loan_monthly_payment` | `DLL Schedule!J5 (name Scheduled_Monthly_Payment)` | $23,167.28 |
| `loan_monthly_payment_kpi` | `DLL Schedule!J5 (name Scheduled_Monthly_Payment)` | $23,167 |
| `loan_num_payments` | `DLL Schedule!J6` | 60 |
| `loan_payoff_date` | `DLL Schedule!B77` | August 1, 2031 |
| `loan_pmts_per_year` | `DLL Schedule!D8 (name Num_Pmt_Per_Year)` | 12 |
| `loan_rate` | `DLL Schedule!D6 (name Interest_Rate)` | 8.39% |
| `loan_start_date` | `DLL Schedule!D9 (name Loan_Start)` | August 1, 2026 |
| `loan_term_months` | `loan_years x loan_pmts_per_year` | 60 |
| `loan_total_interest` | `DLL Schedule!J9 (name Total_Interest)` | $257,913.00 |
| `loan_total_interest_kpi` | `DLL Schedule!J9 (name Total_Interest)` | $257,913 |
| `loan_years` | `DLL Schedule!D7 (name Loan_Years)` | 5 |
| `median_kwh_session` | `Historical Data!J19` | 7.38 |
| `median_kwh_session_l3` | `Historical Data!K19` | 0.00 |
| `modeled_rating_l2` | `INPUT SHEET!N10 x N11` | 7.06 |
| `modeled_rating_l3` | `INPUT SHEET!O10:T10 charger-weighted` | 235.20 |
| `months_in_window` | `Historical Data!J4` | 35 |
| `months_in_window_l3` | `Historical Data!K4` |  |
| `n_chargers_l2` | `INPUT SHEET!N8` | 2 |
| `n_chargers_l3` | `INPUT SHEET!O8:T8` | 4 |
| `n_ports_l2` | `INPUT SHEET!N9` | 4 |
| `n_ports_l3` | `INPUT SHEET!O9:T9` | 4 |
| `nameplate_l2_kw` | `INPUT SHEET!N10` | 7.20 |
| `occupancy_in_service` | `Historical Data!J31` | 21.3% |
| `occupancy_in_service_l3` | `Historical Data!K31` | 0.0% |
| `outage_lost_revenue` | `Historical Data!K29` | $0 |
| `outage_window_label` | `Historical Data!C4:C38, months detected as an outage run` |  |
| `prepared_by_name` | `operator input` | Preparer |
| `primary_users` | `default` | Customers and public use |
| `proj_charger_rating_kw_l2` | `Updated Chargers Revenue Calcul!row 12` | 7.06 |
| `proj_charger_rating_kw_l3` | `Updated Chargers Revenue Calcul!row 12` | 235.20 |
| `proj_chargers_l2` | `Updated Chargers Revenue Calcul!row 5` | 2 |
| `proj_chargers_l3` | `Updated Chargers Revenue Calcul!row 5` | 4 |
| `proj_kwh_per_day_l2` | `Updated Chargers Revenue Calcul!row 16` | 33.9 |
| `proj_kwh_per_day_l3` | `Updated Chargers Revenue Calcul!row 16` | 1,129.0 |
| `proj_max_hours_l2` | `Updated Chargers Revenue Calcul!row 7` | 12 |
| `proj_max_hours_l3` | `Updated Chargers Revenue Calcul!row 7` | 12 |
| `proj_net_profit_month_l2` | `Updated Chargers Revenue Calcul!row 18` | $254.02 |
| `proj_net_profit_month_l3` | `Updated Chargers Revenue Calcul!row 18` | $8,467.20 |
| `proj_profit_per_year_l2` | `Updated Chargers Revenue Calcul!row 19` | $3,048.19 |
| `proj_profit_per_year_l3` | `Updated Chargers Revenue Calcul!row 19` | $101,606.40 |
| `proj_retail_rate_l2` | `Updated Chargers Revenue Calcul!row 13` | $0.650 |
| `proj_retail_rate_l3` | `Updated Chargers Revenue Calcul!row 13` | $0.650 |
| `proj_stall_occupancy_l2` | `Updated Chargers Revenue Calcul!row 8` | 20.0% |
| `proj_stall_occupancy_l3` | `Updated Chargers Revenue Calcul!row 8` | 20.0% |
| `proj_stall_qty_l2` | `Updated Chargers Revenue Calcul!row 6` | 4 |
| `proj_stall_qty_l3` | `Updated Chargers Revenue Calcul!row 6` | 4 |
| `proj_utility_rate_l2` | `Updated Chargers Revenue Calcul!row 17` | $0.40 |
| `proj_utility_rate_l3` | `Updated Chargers Revenue Calcul!row 17` | $0.40 |
| `projected_gross_yearly` | `Updated Chargers Revenue Calcul!row 15 (per 30 days) x 12` | $272,102 |
| `projected_profit_3yr` | `Updated Chargers Revenue Calcul totals row` | $313,964 |
| `projected_profit_5yr` | `Updated Chargers Revenue Calcul totals row` | $523,273 |
| `projected_profit_yearly` | `Updated Chargers Revenue Calcul totals row` | $104,655 |
| `projection_years` | `Financial Worksheet!B10` | 5 |
| `property_type` | `default` | Retail |
| `proposal_date` | `default (today)` | September 10, 2026 |
| `proposal_version` | `default` | V1.0 |
| `revenue_scenario` | `detected from the formula of Financial Worksheet!I6` | Standard-Low |
| `roi_carbon_credits` | `Financial Worksheet!B4` | $345,097.51 |
| `roi_evse_revenues` | `Financial Worksheet!B6` | $671,491.05 |
| `roi_itc` | `Financial Worksheet!B5` | $0.00 |
| `roi_net_revenues` | `Financial Worksheet!B7` | -$115,535.46 |
| `roi_total_costs_upfront` | `Financial Worksheet!B3` | -$1,132,124.02 |
| `rsm_name` | `INPUT SHEET!N18` |  |
| `scope_of_work` | `INPUT SHEET!N21` |  |
| `sessions_per_day` | `Historical Data!J17` | 1.92 |
| `sessions_per_day_l3` | `Historical Data!K17` | 0.00 |
| `site_address` | `INPUT SHEET!N17` |  |
| `site_location_narrative` | `operator input` | Narrative. |
| `site_name` | `operator input` | Site |
| `soc_start_end_l3` | `Historical Data!K22` | n/a |
| `standard_parts_warranty_years` | `constant (equipment basis)` | 2 |
| `svc_contract_years` | `Internal Summary!G13` | 5 |
| `svc_extended_cost` | `Internal Summary!H12` | $38,221.80 |
| `svc_extended_years` | `Internal Summary!G12` | 3 |
| `svc_inwarranty_cost` | `Internal Summary!H11` | $26,555.24 |
| `svc_inwarranty_years` | `Internal Summary!G11` | 2 |
| `svc_total` | `Internal Summary!I14` | $167,776 |
| `total_kwh` | `Historical Data!J7` | 20,335.3 |
| `total_kwh_l3` | `Historical Data!K7` | 0.0 |
| `total_ports` | `INPUT SHEET!N9:T9` | 8 |
| `total_revenue` | `Historical Data!J6` | $10,424.86 |
| `total_revenue_l3` | `Historical Data!K6` | $0.00 |
| `total_sessions` | `Historical Data!J16` | 2,047 |
| `total_sessions_l3` | `Historical Data!K16` | 0 |
| `unproductive_share` | `Historical Data!J26` | 20% |
| `unproductive_share_l3` | `Historical Data!K26` | 0% |
| `uplift_vs_historical` | `year1_charger_profit / hist_profit_yearly - 1` | 756.9% |
| `utility_name` | `INPUT SHEET!N20` |  |
| `validity_days` | `default` | 30 |
| `year1_charger_profit` | `derived from charger_cashflow (year 1)` | $104,655 |
| `zero_session_days_l2` | `Historical Data!J28` | 308 |
