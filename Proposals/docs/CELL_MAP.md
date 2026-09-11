# CELL_MAP - every figure in the proposal, and the cell it comes from

Traces every number, table and chart in
`Food4Less_Rip-and-Replace_Proposal-Aug2026_AR.docx` back to its source cell in
**both** workbooks:

* **legacy** = `Historical_RipandReplaceFood4Less_f-00148.xlsx`
  (engine `baseline_vs_projected`) - the workbook that produced the reference
  proposal.
* **v16** = `RFC_MSRP_Calculator_Simple_v16.xlsx`
  (engine `scenario_grid`) - the supported input going forward.

"Ref value" is the figure as printed in the reference proposal. Every cell
address below was read out of the actual files, not inferred.

Sheet abbreviations: **FW** = `Financial Worksheet`, **IS** = `Internal Summary`,
**INP** = `INPUT SHEET`, **UCRC** = `Updated Chargers Revenue Calcul`,
**HD** = `Historical Data`, **10YPC** = `10 Year Projection Comparison`,
**DLL** = `DLL Schedule`, **CF** = `Cashflow`.

> **The addresses collide.** `UCRC` holds a completely different model in each
> workbook at the same addresses. Always resolve the engine first. See `CLAUDE.md`.

---

## 0. Chassis and engine vary independently

The column headings below are **chassis** (row layout), not workbook identity.
The real production input is a **v16 chassis carrying the legacy engine**:
v16 row addresses everywhere, with the legacy `Updated Chargers Revenue Calcul`
sheet plus `Historical Data` and `10 Year Projection Comparison` pasted in.
`inputs/Historical_Showcase_Liquor_Pasadena_2026-08-06.xlsx` is that shape.

So when reading this document: use the **v16** column for every
`Financial Worksheet` / `Internal Summary` / `INPUT SHEET` / `DLL` / `Cashflow`
address, and the **legacy** column for the `Updated Chargers Revenue Calcul`
and `10 Year Projection Comparison` sections, unless the workbook genuinely
carries the scenario grid.

| Sheet | Follows |
|---|---|
| Financial Worksheet, Internal Summary, INPUT SHEET, DLL Schedule, Cashflow | **chassis** |
| Updated Chargers Revenue Calcul, 10 Year Projection Comparison | **engine** |
| Historical Data | neither - identical under both |

## 0b. Row-offset summary (read this before using any FW address)

| Block | legacy chassis | v16 chassis |
|---|---|---|
| ROI rows | B3-B7 (B5 = `Federal ITC (30%)`) | B3-B7 (B5 = `ITC`) |
| Cost block first row | B15 | **B16** |
| Grand Total | **B42** | **B43** |
| Remaining after Discount | **B43** | **B44** |
| Cashflow header row | **3** | **4** |
| Cashflow data rows | **4-14** (11 rows, 10-yr) | **5-15** (blank past horizon) |
| Horizon | fixed 10 | `B9` toggle -> `B10` |
| UCRC `Avg Delivered Power` row | **13** (exists) | absent; rows 13-21 shift up 1 |

---

## Cover page

| Figure | Ref value | legacy | v16 | Token |
|---|---|---|---|---|
| Client contact | Jerome Jenkins | not in workbook | not in workbook | `client_contact_name` |
| Site | Food4Less | not in workbook | `INP!N19` (label `INP!M19`, empty) | `site_name` |
| Address | 3434 Manthey Rd, Stockton, CA 95206 | not in workbook | `INP!N17` (label `INP!M17`, empty) | `site_address` |
| Prepared by | Alexander Luckett | not in workbook | `INP!N18` RSM (label only) | `prepared_by_name` |
| Date | AUGUST 4, 2026 | n/a | n/a | `proposal_date` |

> The cover date is split across three runs (`'AUGUST '`, `'4'`, `', 2026'`).
> Replace at paragraph level. It also disagrees with Section 2 (Aug 3) - a defect
> in the original; one token drives both.

---

## Section 1 - Executive Summary

| Figure | Ref value | legacy | v16 | Token |
|---|---|---|---|---|
| Existing L2 stalls | five | `UCRC!B6` | operator input | `existing_ports_l2` |
| Existing L3 stalls | five | `UCRC!C6` | operator input | `existing_ports_l3` |
| New L3 Gen3 qty / kW | 2 x 120 kW | `INP!I15` / `INP!D15`=`_kW120` | `INP!I8` per `_kW*` row | `dcfc_mix_sentence` |
| New L3 Gen2 qty / kW | 1 x 60 kW | `INP!I16` / `_kW60` | `INP!I8` | `dcfc_mix_sentence` |
| New L2 port count | 10 | `INP!N9` | `INP!N9` | `n_ports_l2` |
| Total project cost | $272,023.03 | `FW!B43` | **`FW!B44`** | `cost_after_discount` |
| Financier | De Lage Landen | n/a (prose) | n/a (prose) | verbatim |

Table #3 "Proposed solution at a glance" is prose keyed to the equipment
schedule; only the qty/rating cells above are numeric.

---

## Section 2 - Proposal Overview and Project Information

Table #5 is entirely operator input in both engines. v16 exposes prefill cells
that ship **empty** (labels in `INP!M17:M21`, values expected in `N17:N21`).

| Field | Ref value | v16 prefill | Token |
|---|---|---|---|
| Client contact | Jerome Jenkins | - | `client_contact_name` |
| Site | Food4Less | `INP!N19` (`Client Info`) | `site_name` |
| Address | 3434 Manthey Rd, Stockton, CA 95206 | `INP!N17` | `site_address` |
| Property type | Retail | - | `property_type` |
| Primary users | Customers and public use | - | `primary_users` |
| Proposal date | August 3, 2026 | - | `proposal_date` |
| Proposal version | V1.0 | - | `proposal_version` |
| Validity | 30 days | - | `validity_days` |
| Utility | (not printed) | `INP!N20` | `utility_name` |
| Scope of work | (not printed) | `INP!N21` | `scope_of_work` |

`job_number` is parsed from `client_info` with `^([A-Za-z]-?\d+)\s+(.*)$`;
group 2 is `site_name` when the pattern matches.

Table #7 "Proposal contents" is regenerated from the section registry, not the
workbook.

---

## Section 3 - Historical Usage and Existing Conditions

Sourced entirely from `HD`, which is **self-contained** (109 formulas, zero
cross-sheet references) and reads identically under either engine. Absent from
v16 unless the operator pastes it in; when absent, Sections 3 / 3A / 3B and
chart 1 are suppressed.

### KPI strip (table #9)

| Tile | Ref value | HD cell | Token |
|---|---|---|---|
| HISTORY REVIEWED | 35 months | `HD!J4` (`=ROWS(A8:A42)`) | `months_in_window` |
| ... sub | Aug 2023 to Jun 2026 | derived from `HD!J4`/`J5` formulas | `history_window_label` |
| HISTORICAL REVENUE | $92,358 | `HD!J6 + HD!K6` | `hist_total_revenue` |
| DC FAST REVENUE SHARE | 96% | `HD!K6 / (HD!J6+HD!K6)` | `dcfc_revenue_share` |
| ... sub | $88,883 of total | `HD!K6` | `hist_l3_revenue` |
| ESTIMATED OUTAGE LOSS | $6,953 | `HD!K29` (`=C36+C39-C37-C38`) | `outage_lost_revenue` |

> `HD!D44` ($93,453.35) sums **all 40 rows** including the 2021-12 / 2022-02
> stubs and the 2026-07 partial. The window total used everywhere downstream is
> $92,358.23 from rows 8-42. Never print `D44`.

### Site-history prose (body idx 30-31)

| Figure | Ref value | HD cell |
|---|---|---|
| L3 sessions per day | 5.43 | `HD!K17` |
| L2 sessions per day | 1.16 | `HD!J17` |
| Avg kWh per L3 session | 21.99 | `HD!K18` |
| Avg L3 charge time | 38.34 min | `HD!K21` |

### Chart 1 - historical monthly revenue (`media/image3.png`, 6.65 x 2.66 in)

`HD!A4:G43`; header row 3. Series: `D` total, `C` L3, `B` L2.
Window = rows **8-42** parsed from the `HD!J4` / `J5` formulas.
Outage shading is detected (`l3_rev` >80% below the trailing 3-month mean), which
catches rows 37-38 (2026-01 $38.80, 2026-02 $121.18) without hardcoding dates.

---

## Section 3A - Full-History Actuals (table #11, 20 rows)

Straight read of the `HD` statistics block. Column I = label, J = Level 2,
K = Level 3. Identical in both engines.

| Row label | Ref L2 / L3 | Cell |
|---|---|---|
| Months in window | 35 | `HD!J4` |
| Days in window | 1065 | `HD!J5` |
| Total revenue | $3,474.82 / $88,883.41 | `HD!J6` / `K6` |
| Total kWh | 6,693.9 / 127,182.3 | `HD!J7` / `K7` |
| Avg revenue per month | $99.28 / $2,539.53 | `HD!J8` / `K8` |
| Avg kWh per month | 191.3 / 3,633.8 | `HD!J9` / `K9` |
| Avg kWh per day | 6.29 / 119.42 | `HD!J10` / `K10` |
| Effective retail rate | $0.519 / $0.699 | `HD!J11` / `K11` |
| Avg stalls used per day | 0.766 / 2.152 | `HD!J12` / `K12` |
| Avg charging hours per active stall | 3.157 / 1.612 | `HD!J13` / `K13` |
| Avg delivered power (kW) | 2.60 / 34.42 | `HD!J14` / `K14` |
| Total sessions | 1234 / 5782 | `HD!J16` / `K16` |
| Sessions per day | 1.16 / 5.43 | `HD!J17` / `K17` |
| Avg kWh per session | 5.42 / 21.99 | `HD!J18` / `K18` |
| Median kWh per session | 0.97 / 18.88 | `HD!J19` / `K19` |
| Sessions delivering <1 kWh | 50.3% / 25.5% | `HD!J20` / `K20` |
| Avg charging time per session | 125.22 / 38.34 | `HD!J21` / `K21` |
| Avg stalls in service per day | 1.91 / 3.43 | `HD!J30` / `K30` |
| Stall occupancy among in-service | 24.4% / 57.7% | `HD!J31` / `K31` |

Not printed but available: `HD!K22` SOC start/end, `K23`/`K24` L3 busy shares,
`K25` idle fees collected, `J26`/`K26` unproductive share, `J27`/`K27` dead
stations, `J28` zero-session days.

> `HD!J12`, `J13`, `K12`, `K13`, `J16`, `K16`, `J19`, `K19`, `J20`, `K20`,
> `J26`, `K26`, `J28`, `K28`, `J30`, `K30`, `J31`, `K31` are **hardcoded
> constants** pasted from the utilization report, not derivable from `A:G`.

---

## Section 3B - Historical Operating Baseline (table #13, 24 rows)

**Recomputed in Python. Never read off a sheet.** Under the legacy engine these
sit in `UCRC!B5:C27` - exactly the block that collides with v16's scenario grid.
`baseline.py` re-derives them from `HD` alone, so both engines print an identical
Section 3B.

Two values are in no sheet and become operator inputs: the **existing**
equipment's port count and nameplate kW (the specimen hardcodes 5/5 ports and
7.2/50 kW).

| Row | Ref L2 / L3 | Recompute | legacy cell (for audit only) |
|---|---|---|---|
| Chargers | 5 / 5 | operator input | `UCRC!B5` / `C5` |
| EV Stall Quantity | 5 / 5 | operator input | `UCRC!B6` / `C6` |
| Max hours of operation | 12 / 12 | constant 12 | `UCRC!B7` / `C7` |
| Stall Occupancy % | 15.3% / 43.0% | `HD.J12 / ports` | `UCRC!B8` / `C8` |
| Stalls used per day | 0.77 / 2.15 | `ports * occupancy` | `UCRC!B9` / `C9` |
| Charging Hourly % | 26.3% / 13.4% | `HD.J13 / 12` | `UCRC!B10` / `C10` |
| Hours per stall per day | 3.16 / 1.61 | `hourly_pct * 12` | `UCRC!B11` / `C11` |
| Charger Rating (kW) | 7.06 / 49.00 | `nameplate * INP!N11` | `UCRC!B12` / `C12` |
| Avg Delivered Power (% of rating) | 36.8% / 70.3% | `HD.J14 / rating` | `UCRC!B13` / `C13` |
| Retail Revenue per kWh | $0.519 / $0.699 | `HD.J11` | `UCRC!B14` / `C14` |
| Total Revenue per day | $3.26 / $83.46 | `rate * rating * delivered% * stalls_used * hours` | `UCRC!B15` / `C15` |
| Per 30 day Cycle | $97.88 / $2,503.76 | `revenue_per_day * 30` | `UCRC!B16` / `C16` |
| Total kWh dispensed per day | 6.3 / 119.4 | `stalls_used * hours * rating * delivered%` | `UCRC!B17` / `C17` |
| EV Utility Rate | $0.40 / $0.40 | constant 0.40 | `UCRC!B18` / `C18` |
| Net Profit per Month | $22.46 / $1,070.72 | `rev_30day - kwh_day * 0.40 * 30` | `UCRC!B19` / `C19` |
| Total Profit per Year | $269.50 / $12,848.62 | `net_profit_month * 12` | `UCRC!B20` / `C20` |
| Out of service share | 58% / 28% | `HD.J26` / `K26` | `UCRC!B21` / `C21` |
| **Yearly** | **$13,118** | `L2.profit_yr + L3.profit_yr` | `UCRC!B24` |
| 3 Years | $39,354 | `yearly * 3` | `UCRC!B25` |
| 5 Years | $65,591 | `yearly * 5` | `UCRC!B26` |
| **Gross Revenue (Yearly)** | **$31,220** | `(L2.rev_30 + L3.rev_30) * 12` | `UCRC!B27` |

**Reconciliation** (the check the specimen does at `UCRC!B22` vs `C22`):
`(L2.rev_day + L3.rev_day) * HD!J5` should land within 1% of `HD!J6 + HD!K6`.
Both are $92,358.23 in the specimen. A miss usually means the port count is wrong.

> The reference table has a merged-cell artifact: the TOTAL NET PROFIT block
> collapses the Level 2 and Level 3 columns into one value. Do not reproduce.

---

## Section 4 / 4A - Methodology and Assumptions

Table #15 is static prose. Table #17 pulls seven values:

| Assumption | Ref value | legacy | v16 |
|---|---|---|---|
| Site operating window | 12 hours/day | `UCRC!B7` | `UCRC!B7` |
| Utility energy cost | $0.40 per kWh | `UCRC!B18` | **`UCRC!B17`** |
| Level 2 retail price | $0.65 per kWh | `UCRC!D14` | `UCRC!B13` |
| Level 3 retail price | $0.70 per kWh | `UCRC!E14` | `UCRC!C13` |
| New-equipment downtime | 3% | `UCRC!D21` / `E21` | no source - operator input |
| Annual growth | 12.5% | `10YPC!H45` | literal `1.125` in `FW!I7:I15` |
| Idle policy grace | 60 min L2 / 30 min L3 | `UCRC!G6` / `H6` | **no idle model - drop** |

### Chart 2 - annual operating profit (`media/image4.png`, 6.55 x 2.75 in)

Legacy: `FW!H4:I14` (years 1-10). v16: `FW!H5:I15`, years 1..`B10`.
The axis label drops "plus idle fees" under v16 - there is no idle model.

---

## Section 5 - Revenue and Economic Benefit Projection

### KPI strip (table #19)

| Tile | Ref value | legacy | v16 |
|---|---|---|---|
| YEAR 1 OPERATING PROFIT | $26,870 | `UCRC!E24` (incl. idle) | `FW!I6` = `year1_charger_profit` |
| YEAR 1 TOTAL INCL. ITC | $108,477 | `10YPC!E19` | `FW!E6` (ITC = 0, so equals `FW!I6 + B4/B10`) |
| 10-YEAR OPERATING PROFIT | $406,173 | `FW!B6` | `FW!B6` = `roi_evse_revenues` |
| 10-YEAR TOTAL BENEFIT | $564,696 | `10YPC!E5` = `F28` | `roi_evse_revenues + roi_carbon_credits` |

> Under v16 the ITC tile is suppressed (`FW!B5 == 0`) and the horizon label
> becomes `{projection_years}-YEAR`.

### Operating profile (table #20, 23 rows)

Legacy: `UCRC` columns **D** (projected L2) and **E** (projected L3), rows 5-21,
totals rows 24-27.

v16: `aggregate.py` collapses the seven-column Standard-Low block
(`UCRC!B:H`, L2 = B, L3 tiers = C..H) into two printed columns. A tier is active
only when row 5 > 0. Row map for v16 (note the missing `Avg Delivered Power` row):

| Row label | v16 row | agg rule |
|---|---|---|
| Chargers | 5 | sum |
| EV Stall Quantity | 6 | sum |
| Max hours of operation | 7 | first_active |
| Assumed Stall Occupancy % | 8 | weighted_by_ports |
| Number of stalls used per day | 9 | sum |
| Assumed Charging Hourly % | 10 | weighted_by_ports |
| Hours usage per stall per day | 11 | weighted_by_ports |
| Actual Charger Rating | 12 | weighted_by_chargers |
| Retail Revenue per kWh | 13 | weighted_by_kwh |
| Total Revenue per day | 14 | sum |
| Per 30 day Cycle | 15 | sum |
| Total kWh dispensed per day | 16 | sum |
| EV Utility Rate | 17 | first_active |
| Net Profit per Month | 18 | sum |
| Total Profit per Year | 19 | sum |
| Yearly / 3 Years / 5 Years | 24 / 25 / 26 | scenario totals column |

Scenario totals columns: Standard-Low `J`, Standard-Medium `P`,
Standard-High `Q`. (`Q` is also the High block's first L3 tier column; the
totals live on rows 24-26, the tier data on rows 5-21, so they do not clash -
but never resolve one by scanning the other's rows.)

**Two reference rows have no v16 source and are deleted from the template:**
*Avg Delivered Power (% of rating)* (the grid's rating is already nameplate x
derate) and *Estimated share of station time out of service* (reference used 3%;
optionally an operator input).

### Comparison to historical baseline (table #21)

| Cell | Ref value | legacy | v16 |
|---|---|---|---|
| Annual operating profit - historical | $13,118 | `UCRC!B24` | `hist_profit_yearly` (recompute) |
| Annual operating profit - projected | $26,870 | `UCRC!E24` | `year1_charger_profit` |
| Horizon baseline | $131,181 | `10YPC!B29` | `hist_profit_yearly * projection_years` |
| Horizon benefit | $564,696 | `10YPC!F28` | `roi_evse_revenues + roi_carbon_credits` |
| Operating uplift | 104.8% | `10YPC!E15` | `year1_charger_profit / hist_profit_yearly - 1` |

Suppressed entirely when `has_history` is false.

---

## Section 6 / 6A - Proposed Charging Configuration

### Equipment schedule (table #23)

Line items: legacy `INP!C8:K16`; v16 `INP!C8:K37`, stop when col C is blank.
Columns: `C` item no, `D` category, `E` SKU, `F` description, `G` MSRP,
`H` discount, `I` qty, `J` MSRP total, `K` line total. Totals `J38` / `K38`.

> `INP!H` (discount) is blank in both files while `K` computes `J-(H*J)`.
> Excel treats blank as 0; Python must coerce `None -> 0`.

| Figure | Ref value | legacy | v16 |
|---|---|---|---|
| L2 qty | 10 | `INP!N9` | `INP!N9` |
| L2 nameplate | 7.68 kW | `INP!N10` | `INP!N10` (7.2) |
| L2 modeled rating | 7.53 kW | `INP!N10 * N11` | `INP!N10 * N11` |
| De-rate factor | 0.98 | `INP!N11` | `INP!N11` |
| L3 fleet modeled rating | 98 kW | `INP!O10 * N11` | charger-weighted mean over active tiers |
| L3 tier ratings | 120 / 60 | `INP!D15`/`D16` categories | `INP!O10:T10` |
| L3 tier quantities | 2 / 1 | `INP!I15` / `I16` | `INP!O8:T8` |

Legacy `INP!O10` is `=(I15*120+I16*60)/O8` - a blended average. v16 keeps the six
tiers separate in `O10:T10` and the blend happens in `aggregate.py`.

Section 6's location paragraph (body idx 83) is judgement, not arithmetic;
it becomes one token, `site_location_narrative`.

Tables #25 / #26 print `l2_sku` (`CTX-C32-240`, from the first `_L2` line item)
and `dcfc_mix_sentence` (`2 x 120 kW and 1 x 60 kW`).

---

## Section 7 - Return on Investment

### Initial investment costs (table #28)

| Row | Ref value | legacy | v16 | Source of source |
|---|---|---|---|---|
| Equipment Purchase Invoice | $225,731.62 | `FW!B15` | **`FW!B16`** | `IS!D3` |
| Charger Hardware | $144,971.75 | `FW!B16` | **`FW!B17`** | `IS!D4` |
| 5 Year Service Agreement & Warranty | $46,560.09 | `FW!B17` | **`FW!B18`** | `IS!D5` |
| EVOLV & Commissioning Subtotal | $21,834.54 | `FW!B18` | **`FW!B19`** | `IS!D6` |
| (5 Year Service Agreement, list price) | not printed | `FW!B19` = **`#ERROR!`** | **`FW!B20`** | `IS!B5` |
| Sales Tax on Chargers | $12,365.24 | `FW!B20` | **`FW!B21`** | `IS!D7` |
| Design Invoice | $0 | `FW!B21` | **`FW!B22`** | `IS!D8` |
| AutoCad Design Services | $0 | `FW!B22` | **`FW!B23`** | `IS!D9` |
| Electrical Engineering Design | $0 | `FW!B23` | **`FW!B24`** | `IS!D10` |
| Project Management | $0 | `FW!B24` | **`FW!B25`** | `IS!D11` |
| Plan Check and Permit Fees | $0 | `FW!B25` | **`FW!B26`** | `IS!D12` |
| Electrical Supply & Constr. Mgmt | $21,541.41 | `FW!B26` | **`FW!B27`** | `IS!D13` |
| Wires, Conduits and Peripherals | $3,575.67 | `FW!B27` | **`FW!B28`** | `IS!D14` |
| Main Distribution Switchgear | $0.00 | `FW!B28` | **`FW!B29`** | `IS!D15` |
| Sub-Panels, Transformers, Breakers | $2,178.00 | `FW!B29` | **`FW!B30`** | `IS!D16` |
| Striping, Bollards, Signage | $2,895.17 | `FW!B30` | **`FW!B31`** | `IS!D17` |
| Asphalt and Paving | $0 | `FW!B31` | **`FW!B32`** | `IS!D18` |
| Concrete Improvements | $2,841.10 | `FW!B32` | **`FW!B33`** | `IS!D19` |
| ADA | $0 | `FW!B33` | **`FW!B34`** | `IS!D20` |
| Dump / Waste | $2,420.00 | `FW!B34` | **`FW!B35`** | `IS!D21` |
| Permits | $0 | `FW!B35` | **`FW!B36`** | `IS!D22` |
| Utility | $0 | `FW!B36` | **`FW!B37`** | `IS!D23` |
| Construction Equipment | $7,631.47 | `FW!B37` | **`FW!B38`** | `IS!D24` |
| Construction PM | $0 | `FW!B38` | **`FW!B39`** | `IS!D25` |
| Materials | $0 | `FW!B39` | **`FW!B40`** | `IS!D26` |
| Sales Tax on equipment | $0 | `FW!B40` | **`FW!B41`** | `IS!D27` |
| Labor | $24,750.00 | `FW!B41` | **`FW!B42`** | `IS!D28` |
| **Grand Total** | $315,180.43 | `FW!B42` | **`FW!B43`** | `IS!D29` |
| **Total After Discount** | $272,023.03 | `FW!B43` | **`FW!B44`** | `IS!D30` |

Zero rows are suppressed except Main Distribution Switchgear, which the reference
prints at $0.00 (config flag `show_zero_rows`, default false).

**The stack is hierarchical - do not sum the printed rows to check the total:**

```
Equipment Purchase Invoice = Charger Hardware + Parts Warranty
                             + EVOLV Subtotal + Sales Tax on Chargers
Design Invoice             = AutoCad + EE Design + PM + Plan Check
Electrical Supply etc.     = Wires .. Sales Tax on equipment
Grand Total                = Equipment + Design + Electrical + Labor
```

**`FW!B18` vs `FW!B20` (v16).** B18 "Parts Warranty" is `IS!D5`, the customer
price after discount. B20 "5 Year Service Agreement" is `IS!B5`, the list price.
Identical at 0% discount, divergent otherwise. **Print B18**; warn when they
differ. In legacy, B19 is a live `#ERROR!` (`='Internal Summary'!#REF!`) and is
never emitted.

### Projected ROI (table #29)

| Row | Ref value | legacy | v16 |
|---|---|---|---|
| Total Costs Upfront | -$272,023.03 | `FW!B3` (`=-B43`) | `FW!B3` (`=-B44`) |
| Carbon Credits | $218,459.66 | `FW!B4` | `FW!B4` |
| Federal ITC (30%) | $81,606.91 | `FW!B5` (`=ABS(B3)*0.3`) | `FW!B5` (literal **0**) |
| EVSE Revenues | $406,173.10 | `FW!B6` (`=SUM(I5:I14)`) | `FW!B6` (`=SUM(I6:I15)`) |
| Net Revenues | $434,216.64 | `FW!B7` (`=B3+(B4+B5+B6)`) | `FW!B7` (**`=B3+(B4+B6)`**) |

**v16 excludes ITC from Net Revenues by design.** Suppress the ITC row and stat
card when `B5 == 0`. If someone hand-enters `B5`, `FW!E6` still adds it to Year 1
of the consolidated cashflow, so Section 7A's final cumulative exceeds Net
Revenues by exactly that amount - warn and name both figures, adjust neither.

Investment prose (body idx 98): `$272,023.03` = `cost_after_discount`,
`year 4` = `breakeven_year`.

---

## Section 7A - Consolidated Cashflow (table #31)

| | legacy | v16 |
|---|---|---|
| Header row | `FW!D3:F3` | `FW!D4:F4` |
| Data rows | `FW!D4:F14` | `FW!D5:F15` |
| Year 0 annual | `E4` = `-B43` | `E5` = `-B44` |
| Year 1 annual | `E5` = `I5+B5+(B4/10)` | `E6` = `I6+B5+(B4/B10)` |
| Years 2+ annual | `E6..E14` = `In+(B4/10)` | `E7..E15` = `In+(B4/B10)` |
| Cumulative | `F` rolling | `F` rolling |

`breakeven_year` = first row where cumulative >= 0. Reference: **year 4**
(`F8` = $5,736). v16 sample: **year 4** (`F9` = $4,537.74).

Rows past the horizon cache as `None` (Excel `""`). Treat as blank, not missing.

> Legacy defect reproduced faithfully: `FW!E9` uses `(B4/5)` where every other
> year uses `(B4/10)`, giving Year 5 a double carbon slug ($79,880 vs ~$58,000).
> Because the pipeline reads cached values, this comes out identical to the
> reference with no special handling.

### Chart 3 - cumulative cashflow (`media/image7.png`, 5.85 x 3.25 in)

v16: defined names `cumCashCats` / `cumCashVals`, which are **`OFFSET` formulas**
openpyxl cannot evaluate:

```
cumCashCats = OFFSET('Financial Worksheet'!$D$5,0,0,'Financial Worksheet'!$B$10+1,1)
cumCashVals = OFFSET('Financial Worksheet'!$F$5,0,0,'Financial Worksheet'!$B$10+1,1)
```

Parse the arguments and resolve against `FW!B10` -> `D5:D{5+B10}` / `F5:F{5+B10}`.
**Legacy has neither name**; read `FW!D4:D14` / `FW!F4:F14` directly.
Title: `"{projection_years} Year Cumulative Cashflow"` (v16 also caches it at `FW!L1`).

---

## Section 7B - Charger Revenue Cashflow (table #33)

| | legacy | v16 |
|---|---|---|
| Data rows | `FW!H4:J14` | `FW!H5:J15` |
| Year 0 | `I4` = `-B43` | `I5` = `-B44` |
| Year 1 | `I5` = `UCRC!C24` | **`I6` = `UCRC!J24`** (the scenario link) |
| Years 2+ | `In` = `I(n-1)*1.125` | `In` = `I6*1.125` chain |

`FW!I6` is where the scenario is detected: parse its **formula** with
`data_only=False`. `J24` -> Standard-Low, `P24` -> Standard-Medium,
`Q24` -> Standard-High. v16 ships wired to `J24`.

`year1_charger_profit` = `I5` (legacy) / `I6` (v16) = **$6,350.40** in the v16 sample.

---

## Section 9 - Electrical and Civil Infrastructure (table #37)

Same rows as the Section 7 cost table, rounded to whole dollars: Wires `$3,576`,
Sub-panels `$2,178`, Striping `$2,895`, Concrete `$2,841`, Dump/waste `$2,420`,
Construction equipment `$7,631`. Legacy `FW!B27,B29,B30,B32,B34,B37`;
v16 `FW!B28,B30,B31,B33,B35,B38`.

---

## Section 10 - EVOLV (table #40)

| Item | Ref value | legacy | v16 |
|---|---|---|---|
| Network fee per port per month | $39.99 | `IS!H4` | **`IS!H3`** |
| Ports | 13 | `IS!G4` (`=INP!N9+INP!O9`) | **`IS!G3`** (`=INP!N8+SUM(INP!O8:T8)`) |
| Annual platform cost | $6,238 | `IS!I4` (`=H4*G4*12`) | **`IS!I3`** |
| Contract duration | 5 years | `IS!G5` | **`IS!G4`** |
| Modeled customer total | $21,835 | `IS!I6` (`=G5*I4`) -> `IS!D6` | `IS!I5` -> **`IS!D6`** |

The EVOLV block shifts up one row in v16. Validation: `total_ports == evolv_ports`
and `evolv_annual_cost == evolv_ports * evolv_fee_per_port * 12`.

---

## Section 12 - Warranty and Service (table #44 KPI row)

| Tile | Ref value | legacy | v16 |
|---|---|---|---|
| STANDARD PARTS WARRANTY | 2 years | constant | `IS!G11` (`=MIN(G13,2)`) |
| MODELED SERVICE TERM | 5 years | `IS!G5` | **`IS!G13`** (`Length Of Contract`) |
| SERVICE / WARRANTY ALLOWANCE | $46,560 | `FW!B17` | **`FW!B18`** |
| LABOR ALLOWANCE | $24,750 | `FW!B41` | **`FW!B42`** |

> v16 adds a service-plan block at `IS!F9:I14` that **does not exist in the
> legacy workbook** (`IS!F8:I16` is empty there): `G11`/`H11` in-warranty plan,
> `G12`/`H12` extended, `G13` contract length, `I14` total (`$10,270.32`, which
> feeds `IS!B5`). Under the legacy path, derive the 2-year figure as a constant.

---

## Section 13 - Carbon Credits (table #46 KPI row)

| Tile | Ref value | legacy | v16 |
|---|---|---|---|
| MODELED 10-YEAR CREDITS | $218,460 | `FW!B4` | `FW!B4` |
| LEVEL 3 MULTIPLIERS | $8,600 / $4,300 | `FW!J43` and the literal `4300` inside `FW!B4` | `FW!E45:J45` (`= rating * FW!E42`) |
| LEVEL 2 FACTOR | $0.0045 | `FW!J46` | **`FW!F47`** |

Formulas differ materially:

```
legacy  FW!B4 = (10*2*8600) + (10*1*4300) + (K46 * UCRC!D6 * 10 * 12)
                  ^tier qty and rate are hardcoded in the formula

v16     FW!B4 = (B10 * SUMPRODUCT(E44:J44, E45:J45))
                + (G47 * UCRC!B6 * B10 * 12)
```

v16 carbon block: `E42` rate $/kW/yr (71.6667), `E43:J43` tier ratings
(`= INP!O10:T10`), `E44:J44` tier quantities (`= INP!O8:T8`),
`E45:J45` multipliers (`= rating * $E$42`), `E47` L2 kWh/month
(`= UCRC!B16*30`), `F47` L2 rate (0.0045), `G47` L2 credit/month (`=E47*F47`).

Note `E43`/`E44` start at `INP!O`, so the L2 column is deliberately excluded from
the SUMPRODUCT; L2 is handled by the separate `G47` term.
Section 13's paragraph quotes "$8,600 per year for the 100 kW class" - replace
with the active (`qty > 0`) rating/multiplier pairs. Suppress the L2 consumption
sentence when `l2_ports == 0`.

---

## Section 14 / 17 - Financing (tables #49, #58)

All from `DLL Schedule`. Defined names are **sheet-scoped** - look them up on
`wb['DLL Schedule'].defined_names`, not `wb.defined_names`. Addresses are
identical in both workbooks.

| Field | Ref value | Cell | Defined name |
|---|---|---|---|
| Loan amount | $272,023.03 | `DLL!D5` | `Loan_Amount` |
| Annual interest rate | 8.39% | `DLL!D6` | `Interest_Rate` |
| Loan period | 5 years | `DLL!D7` | `Loan_Years` |
| Payments per year | 12 | `DLL!D8` | `Num_Pmt_Per_Year` |
| Start date | August 1, 2026 | `DLL!D9` | `Loan_Start` |
| Optional extra payments | None | `DLL!D10` | `Scheduled_Extra_Payments` |
| Scheduled payment | $5,566.56 | `DLL!J5` | `Scheduled_Monthly_Payment` |
| Scheduled number of payments | 60 | `DLL!J6` | - |
| Actual number of payments | 60 | `DLL!J7` | - |
| Total early payments | None | `DLL!J8` | - |
| Total interest | $61,970.48 | `DLL!J9` | `Total_Interest` |

Amortization table: header row **16**, data from row **18**, name `Data`
(`$A$18:$J$497`). Columns `A` pmt no, `B` date, `C` beginning, `D` scheduled,
`E` extra, `F` total, `G` principal, `H` interest, `I` ending, `J` cumulative
interest.

`DLL!D5` is `='Financial Worksheet'!B43` (legacy) / `B44` (v16).
When `loan_amount == 0` the DLL cells return `""`; suppress Sections 17,
17A-17D and the Section 14 financing cards.

v16 sample: payment **$884.76**, total interest **$9,849.73**.

---

## Sections 17A-17D - Monthly Cashflow (tables #62, #64, #66)

`Cashflow` sheet, same addresses in both workbooks.

| Field | Cell |
|---|---|
| Total loan payments | `CF!F1` (`=SUM(F3:F62)`) |
| Total carbon credits | `CF!G1` |
| Total EVSE profit | `CF!H1` |
| Table | `CF!E3:I62` - `E` month, `F` loan payment, `G` carbon, `H` EVSE profit, `I` net |

Split for the proposal: months 1-25, 26-50, 51-60.
`CF!I1` is empty - there is no cached total for the net column; sum it in Python.

Row formulas: `F3 = DLL!J5` then `F4 = F3` chained;
`H3 = (UCRC!<scenario totals>/12) * 1.125^INT((E3-1)/12)`;
`I3 = (G3+H3)-F3`.

> **`CF!G3:G62` is `='Financial Worksheet'!$B$4/(5*12)`. The 5 is hardcoded.**
> At the 10-Year setting `B4` doubles while the divisor does not, so monthly
> carbon revenue doubles and these tables overstate income by 2x.
> **Block generation** when `projection_years == 10` and `loan_amount > 0`,
> naming the cell. Do not silently correct it.

---

## Footers (all three parts)

`CONFIDENTIAL` / `{site_name} | {site_address}` / `Page {PAGE}`.
`footer1.xml`, `footer2.xml` and `footer3.xml` are byte-identical in content and
all three must be tokenized. Also scrub `docProps/core.xml`
(`dc:title`, `cp:keywords`, `dc:description`, `cp:lastModifiedBy`) and
`docProps/app.xml` (`vt:lpstr`).

> The reference footer carries a literal `1` cached beside the `PAGE` field, so
> every page reads "Page 1". Do not reproduce.

---

## Figures with no workbook source (operator input)

`client_contact_name`, `client_title`, `prepared_by_name`, `property_type`,
`primary_users`, `proposal_date`, `proposal_version`, `validity_days`,
`site_location_narrative`, `construction_weeks`, and - required for Section 3B -
`existing_ports_l2`, `existing_ports_l3`, `existing_nameplate_l2_kw` (7.2),
`existing_nameplate_l3_kw` (50).

Under v16, `site_name`, `site_address`, `utility_name` and `scope_of_work`
prefill from `INP!N17:N21` when the operator has filled that block in; the cells
ship empty.
