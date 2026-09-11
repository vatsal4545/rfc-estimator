# Proposal template v2 — the Hawthorne document

Design spec. Written 2026-09-10.

Source document: `templates/assets/Best_Western_Hawthorne_EV_Charging_Proposal_Rev2_Aug_2026 (1).pdf`
Structural reference workbook: `templates/assets/project-rfc-msrp-calculator.xlsx`

---

## Goal

Support a second, substantially different proposal document alongside the
existing one, driven from the newer RFC model, with **no figure from the
Hawthorne site surviving into the template**.

The new document is 43 pages, 24 sections in five parts plus a four-part
appendix, and carries **852 numeric figures** against the current template's
101 tokens. It opens by promising that *"every figure is computed from the
project model that accompanies this document — none is typed by hand"*. The
template has to be able to keep that promise.

## Non-goals

* Replacing the existing template. Both coexist; see *Template selection*.
* Reproducing the PDF's visual design pixel-for-pixel. The tokenisation source
  is a `.docx` export, and its layout is what we preserve.
* §22's depreciation table. Deferred — see *Deferred*.

---

## What changed in the workbook

The new RFC is the **same `v16` chassis**: cost block `B16:B44`, cashflow rows
5–15, `B9`/`B10` horizon toggle, `Internal Summary` columns B (list) and D
(customer). The existing row map applies unchanged.

What is new is a rewritten `Updated Chargers Revenue Calcul`:

| rows | content |
|---|---|
| 4–21 | the original single-year view, retained |
| **33–61** | app-aligned inputs — taper, ramp, TOU shares, demand, concurrency, growth |
| **64–91** | scenario roll-up, six columns: Standard/Fleet × Low/Med/High |
| **93–186** | six ten-year projections — kWh, peak demand kW, subscribed kW |
| **188–195** | headline block, "the figures the app's Revenue tab shows" |
| **201–213** | resolved utility tariff |
| **215–252** | rate library — 37 California schedules |

Cell `A197` records that it is *"Synced with `lib/proposal/model.ts`
(computeUsage / computeTariff / computeRevenue) on 2026-09-09"*. **The Excel is
a generated mirror of a TypeScript model, not the model itself.** A change to
that library invalidates cell addresses here; the fingerprint probe below is
what makes that failure loud rather than silent.

`A199` carries two known defects the sheet's author left deliberately: row 12
hard-codes 30/60/80/90/120/180 kW per port and ignores `INPUT SHEET!O10:T10`,
and `B8:H8` are literal 20% where every other column reads row 20. **Read row 20
and row 21, never row 8.**

---

## Architecture

### Detection — a third engine, not a fourth chassis

`Updated!B3` still reads `Standard-Low`, so today's probe misclassifies this
workbook as the existing `scenario_grid` engine and would read the wrong rows.
The new probe:

```yaml
meta:
  engines:
    app_model_v21:
      probe: {sheet: "Updated Chargers Revenue Calcul", cell: A33,
              startswith: "APP-ALIGNED INPUTS"}
```

Chassis stays `v16`. This follows the standing rule that chassis and engine are
independent axes: getting them the wrong way round reads the cost block one row
out or reads a scenario grid that is not there.

### Template selection

| engine | template |
|---|---|
| `app_model_v21` | `templates/proposal_template_v2.docx` |
| anything else | `templates/proposal_template.docx` (unchanged) |

Keyed on **model capability, not site history**. A pre-v2.1 RFC physically
cannot fill the new template — 395 of its figures have no cell to come from — so
"does this workbook have `Historical Data`" is the wrong question.

### Components

| module | responsibility |
|---|---|
| `ev_proposal_agent/extract_v2.py` | reads the app-aligned block, scenario roll-up, ten-year tables, headline block, rate library |
| `ev_proposal_agent/finance.py` | **pure functions, no workbook access**: NPV, IRR, break-even year, peak cash at risk, cash-positive month, return on cash at risk, NEC service sizing |
| `ev_proposal_agent/scenarios.py` | re-runs the model three times against the stress factors |
| `config/market_data.yaml` | Paren reference data, with `source:` and `as_of:` |
| `config/model_policy.yaml` | stress factors, aggregator share, tax constants |
| `tools/build_template_v2.py` | tokenises the `.docx` export, same find-literal method as today |

`finance.py` holds no workbook knowledge on purpose. NPV, IRR and peak cash are
the figures a customer's treasurer is most likely to challenge, and pure
functions can be tested against hand-computed values rather than against our own
extractor — which would otherwise be marking its own homework.

---

## Where every number comes from

### From the RFC directly

Cost lines and totals (`Internal Summary` B/D), loan terms and the 60-row
amortization schedule (`DLL Schedule`), equipment schedule (`CTX Price Book`,
`INPUT SHEET`), EVOLV per-port pricing, connected load and de-rated ratings,
client and site identity (`INPUT SHEET`), carbon (`FW!E42` and the `D43:J45`
tier block), and the entire revenue model — taper, ramp, TOU shares, growth,
card processing, demand inputs, and the six ten-year projections.

Verified: the PDF's LCFS rate is `FW!E42 = 71.6667`, and the 360 kW tier
multiplier `FW!J45 = $25,800.012` × 4 cabinets = **$103,200.05**, exactly the
gross credit the PDF prints. The PDF states the rate per kW; the RFC states it
per tier. Same arithmetic.

### Computed by the app from RFC data

NPV, IRR, break-even year, peak cash at risk, cash-positive month, return on
cash at risk, NEC service sizing (design current → 125% continuous factor →
next standard frame), Appendix C's consolidated cashflow, and the environmental
impact figures.

Computed from inputs is not hardcoded. This is the same posture as the existing
Section 3B recompute and the Section 8 residual.

### From config, overridable per workbook

Policy constants, identical across proposals:

| constant | value | feeds |
|---|---|---|
| stress: utilisation factor | ×0.70 | §4 downside |
| stress: electricity factor | ×1.25 | §4 downside |
| stress: growth factor | ×0.50 | §4 downside |
| stress: LCFS factor | ×0.85 | §4 downside |
| stress: downside retail price | $0.600 | §4 downside |
| stress: downside demand charge | $5.00/kW-mo | §4 downside |
| stress: upside utilisation | half the state average | §4 upside |
| stress: upside growth | 8% | §4 upside |
| LCFS aggregator share | 5% | §14 net credit |
| market reference data | Paren Q2 2026 | §11, §12, §23 |

The first four were verified against the PDF's own prose — *"lands 30% below"*,
*"costs 25% more"*, *"growth halves"*, *"falls 15%"* — so they are the document's
stated rules, not our invention. The remaining four are round absolutes with no
derivation available.

**Resolution order is RFC cell → config default → warn.** This is the pattern
`utility_rate` already uses. The QA report names the source of every figure, so
a config default is visible rather than assumed.

---

## Decisions taken

### Rule 29 — one combined line

The PDF shows two lines, `Utility application and contract fees $4,489.10` and
`Utility interconnection — Rule 29 design fee $3,500.00`, both inside the grand
total. The RFC has a single `Utility` row (`Internal Summary` r23).

The app **must not** invent the $3,500. A cost line the RFC's Grand Total does
not contain breaks the footing to `Internal Summary!D30` — the invariant
`_check_infrastructure_foots` exists to protect.

So §7 prints **one line, read verbatim from the RFC's `Utility` cell**, labelled
*"Utility application and interconnection"*. Anything unaccounted for is absorbed
by the residual row, exactly as Section 8 does today, so the table foots by
construction.

Consequences to carry into the template:

* §7's `CLARIFICATION ON THE INTERCONNECTION LINE` callout must not name
  $3,500. Reword to the combined figure, keeping the true-up language.
* §18's *"What the customer bears"* table shows the combined line with the note
  *"includes the SCE Rule 29 design and application allowance"*.
* §18's closing paragraph and §24's *Basis of pricing* both name $3,500. Both
  become the combined token.

### Scenarios — computed, three cases

The RFC's six columns are **demand profiles** (Standard/Fleet × Low/Med/High),
not stress cases. They cannot produce the PDF's Downside/Base/Upside.

The base case is entirely in the RFC, including the utilisation figure:

```
DC port utilisation 5.0%  =  Updated!B20 x B21  =  0.20 x 0.25
```

`scenarios.py` applies the stress factors above and re-runs the model three
times. Each column's charging profit, carbon, net return, NPV, IRR, break-even
and peak cash are then computed by `finance.py`. **49 figures from 8 constants
plus the RFC base.**

The base column must equal the main model exactly. That is a test, not a hope.

### Market data — config

Paren Q2 2026 state statistics are identical on every proposal, so they belong
in `config/market_data.yaml` with a `source:` and an `as_of:` date rather than
in each workbook. Staleness then shows up in one place.

---

## Defects in the source PDF — do not reproduce

**§14 states the wrong qualifying capacity.** The table reads
`Qualifying capacity 1,468.8 kW`, but the arithmetic uses 1,440 kW:

```
1,440.0 x $71.6667 = $103,200.05   <- the figure printed
1,468.8 x $71.6667 = $105,264.00   <- what the stated capacity gives
```

1,468.8 kW is total connected load *including* the four Level 2 positions. FCI
credits are DC-only, so 1,440 kW is the correct basis and the **label** is wrong.
The Executive Summary states it correctly. The token must be DC nameplate, and a
test asserts the printed capacity times the rate equals the printed credit.

**§24 contradicts the cover.** The cover reads `Revision 2.0`; §24 reads *"This
is revision 1.0, the first issue of this proposal for this site."* Same class as
the existing template's August 4 / August 3 defect. One token, used in both
places.

---

## Testing

Four layers. The first two need no maintenance and catch defects nobody has
thought of yet.

1. **Blocklist.** `tests/fixtures/hawthorne_figures.json` holds **522 distinct
   figures and identity strings** extracted from the PDF — every currency amount,
   percentage, thousands-separated number, decimal, plus the site name, address,
   contact names, SKUs and the proposal date. Render a *different* workbook;
   assert none appears. Regenerated by `tools/extract_pdf_figures.py` so a
   revised source PDF refreshes the list rather than needing hand-editing.

2. **Differential.** Render two unrelated workbooks; assert no rendered cell
   holds the same figure in both. Needs no list, so it catches the next leak too.
   This is the shape of the test that caught `$22,592 / $67,776 / $112,960`.

3. **Reconciliation.** Every rendered figure equals its workbook cell to the
   cent, against the Hawthorne-filled workbook as fixture.

4. **Footing.** §7 sums to turnkey cost; Appendix C's final cumulative equals net
   return; Appendix B's column totals equal its rows; the scenario base column
   equals the main model; §14's capacity × rate equals the credit.

Plus regression tests for the two source defects, and a test that no `kpi_*`
caption promises a term its value does not contain — the defect class already
hit twice on the current template.

---

## Deferred

**§22's depreciation table, 19 figures.** The 5-year / 15-year split
($692,823.46 / $101,343.58) cannot be derived. Every subset of §7's cost lines
up to size six was searched; none sums to the 15-year bucket. Pro-rata
allocation of labour, design and PM gives $94,503, not $101,344.

The depreciable basis itself **is** derivable and reconciles exactly:

```
turnkey                  Internal Summary!D30    $952,404.35
less service + warranty  Internal Summary!D5    -$129,444.51
less EVOLV               Internal Summary!D6     -$28,792.80
= depreciable basis                              $794,167.04    EXACT
```

So only the split rule is missing. §22's other rows — §30C, Charge Ready, Rule
29, LCFS, §48E, grants — still render. Nothing else in the document depends on
the depreciation figures; the PDF states they are excluded from every return
figure and isolated on their own tab.

---

## Phasing

The `.docx` blocker splits this cleanly, and everything in phase 1 is testable
without it.

**Phase 1 — the model.** Engine detection, `extract_v2.py`, `finance.py`,
`scenarios.py`, both config files, and test layers 3 and 4 run against the
workbook directly via `inspect`. No template needed. This is the half that
carries the arithmetic risk.

**Phase 2 — the document.** `tools/build_template_v2.py`, template selection,
section registry, charts, and test layers 1 and 2. Starts when the `.docx`
export arrives.

Each phase gets its own implementation plan.

## Blocked on

1. **The Hawthorne proposal as `.docx`.** The PDF was produced by ReportLab
   (`producer: ReportLab PDF Library`, plain Helvetica), never by Word, so there
   is nothing for `build_template.py`'s find-literal method to work on. A `.docx`
   export preserves the layout and makes the no-number-survives test work exactly
   as it does today.

2. **The Hawthorne-*filled* workbook.** The supplied
   `project-rfc-msrp-calculator.xlsx` is the blank template — every quantity is
   `0`. It defines the structure perfectly but cannot verify reproduction.
   Layer 3 of the test plan needs the filled file.

---

## Assumptions

* The `.docx` export will carry the same section order and content as the PDF.
  If it differs, the section registry follows the `.docx`.
* `lib/proposal/model.ts` remains the upstream source of the `Updated` sheet
  layout. The `A33` fingerprint probe detects a regenerated sheet whose rows have
  moved; it does not repair one.
* Stress factors apply to a v2.1 workbook of any site. If a site needs its own
  factors, the RFC-cell override path already covers it.

## Verification

```bash
pytest tests/ -q                       # 355 passing before this change
python -m tools.build_template_v2      # every CELL_TOKEN must match
python -m ev_proposal_agent generate <hawthorne-filled.xlsx>
.\build.ps1                            # templates/ and config/ ship inside the exe
```

The existing template, its 355 tests and every current workbook must be
untouched by this work. That is the first thing to check, not the last.
