# ev-proposal-agent

Turns an EV charging financial worksheet (`.xlsx`) into an editable Word
proposal. Windows desktop app; every step also runs headless from the CLI.

```
python -m ev_proposal_agent inspect  inputs/RFC_MSRP_Calculator_Simple_v16.xlsx
python -m ev_proposal_agent generate inputs/RFC_MSRP_Calculator_Simple_v16.xlsx
python -m ev_proposal_agent gui
```

Supported input: any workbook matching one of the three chassis fingerprints.
Reference output: `inputs/Food4Less_Rip-and-Replace_Proposal-Aug2026_AR.docx`.
Legacy-engine specimen: `inputs/Historical_RipandReplaceFood4Less_f-00148.xlsx`.
`v15_no_itc` specimen: `inputs/Historical_Marriott_Bakersfield.xlsx`.

Python 3.12. `pip install -r requirements.txt`.

---

## Chassis and engine are two independent axes

The single most important thing to understand about these workbooks. **Do not
assume the workbook version and the revenue model are the same fact.**

| Axis | Detected from | Values | Decides |
|---|---|---|---|
| **chassis** | `meta.fingerprints` probes on `Financial Worksheet` / `INPUT SHEET` | `v16`, `v15_no_itc`, `legacy_food4less` | row layout of FW / IS / INPUT SHEET / DLL / Cashflow |
| **engine** | `Updated Chargers Revenue Calcul!B3` | `scenario_grid`, `baseline_vs_projected` | how the Updated sheet is read, and whether the 10-year sheet is trustworthy |

The **real production input is a v16 chassis carrying the legacy engine**:

```
Financial Worksheet   v16       cost block B16-B44, cashflow rows 5-15,
                                B9/B10 horizon toggle, B7 = B3+(B4+B6)
Internal Summary      v16       EVOLV at G3, service-plan block F9:I14 present
Financial Worksheet   v16       carbon block D42:J47
Updated Chargers...   legacy    B/C historical, D/E projected, F:H idle fees
Historical Data       present   pasted in from the utilization report
10 Year Projection... present   AND CORRECTLY WIRED, because it points at the
                                legacy Updated addresses, which is what is there
```

`inputs/Historical_Showcase_Liquor_Pasadena_2026-08-06.xlsx` is that shape and is
covered by `tests/test_showcase_production_shape.py`. An earlier design rejected
it outright by asserting the two axes had to agree; that assertion is gone.

Practical rule: **row addresses key off the chassis, Updated-sheet reading keys
off `is_legacy_engine`.** Getting these the wrong way round reads the cost block
one row out, or reads a scenario grid that is not there.

### `is_legacy_chassis` is diagnostic only - the map decides

It used to drive six branches in `extract.py`. It cannot any more, because
`v15_no_itc` takes the **legacy** cost block and cashflow rows and the **v16**
INPUT SHEET and EVOLV block at the same time. A boolean cannot say that.

Every override now lives under `chassis: <name>:` in `field_map.yaml` and is read
through one helper:

```python
_chassis(fm, ctx, "evolv")     # {} means "use the base map"
```

**v16 has no entry there. It IS the base map**, and an entry for it would mean
the base map is wrong. Adding a fourth chassis is a YAML block, not a code
change - which is the whole point of the arrangement.

Two things moved out of code and into that block:

* `horizon: {fixed: 10}` replaces "is this the legacy file" for the projection
  horizon. It no longer gates the `Cashflow!G3` check - that reads the formula.
* `roi.absent: [roi_itc]` says a row **does not exist**, which is not the same
  as reading zero. See defect 5.

## The five things that will silently corrupt a proposal

### 1. The engine collision

Two incompatible revenue models share the sheet name
`Updated Chargers Revenue Calcul` **and the same cell addresses**:

| Cell | Food4Less engine (`baseline_vs_projected`) | v16 engine (`scenario_grid`) |
|---|---|---|
| `B3` | `HISTORICAL ACTUAL (Aug 2023 - Jun 2026)` | `Standard-Low` |
| `B6` | historical L2 stall quantity | Standard-Low L2 stall qty |
| `B19` | historical L2 **net profit per month** | Standard-Low L2 **total profit per year** |
| `G12` | L2 **idle-fee profit per year** | Standard-Low **L3 240 kW charger rating** |
| `C24` | projected annual net profit | (blank) |

Nothing errors when you read the wrong one. You get a charger rating where an
idle fee belonged and an annual figure where a monthly one did. Plausible
numbers, wrong proposal.

**Always probe `Updated!B3` before reading anything.** `engine.py` does this
first and returns `(engine, scenario, projection_years)`.

Corollary: every formula on `10 Year Projection Comparison` is bound to the
legacy addresses (`B11 ='Updated'!B19`, `D11 =Updated!G12/12`,
`C19 =Updated!$C$24*(1+$H$45)^($A19-1)`). That makes it **correct** whenever the
legacy engine is present, which is the normal production case, and silently
**wrong** under the scenario grid. Refuse to read it only when the engine is
`scenario_grid`; derive those figures instead (`derived_ten_year` in the map).

`Financial Worksheet!B19` in the legacy workbook is a live `#ERROR!`
(`='Internal Summary'!#REF!`). It maps to a field marked `emit: false`, so the
"no token starts with `#`" validation must skip non-emitted fields.

### 2. ITC is omitted by default

`Financial Worksheet!B7` is `=B3+(B4+B6)`. ITC (`B5`) is **not** in Net
Revenues. Match that: suppress the "Federal ITC (30%)" row in the Section 7 ROI
table and the ITC stat card whenever `B5 == 0`, which is the expected case.

`B5` is hand-entered. If someone fills it in, `Financial Worksheet!E6` still
adds it to Year 1 of the consolidated cashflow, so Section 7A's final cumulative
exceeds Section 7's Net Revenues by exactly the ITC. **Warn and name both
figures. Adjust neither.**

### 3. The `Cashflow!G3` divisor bug

`Cashflow!G3:G62` ships as `='Financial Worksheet'!$B$4/(5*12)`. The `5` is
hardcoded, and `B4` is the carbon total over the **whole horizon** - it is itself
`$B$10 x` an annual figure. So the monthly rate is `B4 / (B10 * 12)`, which is
**horizon-invariant**: on Best Western it is $5,751.63 whether the view period is
5 or 10. The loan is 60 months either way, so the financing tables should not
move at all when the toggle changes.

`/(5*12)` is therefore right only at a 5-year horizon. At 10 it spreads ten years
of carbon over five and doubles the monthly figure.

**The fix belongs in the workbook**, not here:

```
Cashflow!G3  ='Financial Worksheet'!$B$4/('Financial Worksheet'!$B$10*12)
```

filled down to `G62`. That leaves every 5-year workbook unchanged to the cent -
which is the test that it went in correctly - and is right at any horizon,
including one nobody has added to `B9` yet. Files with no `B9`/`B10` (the legacy
and `v15_no_itc` layouts) need `/(10*12)` instead, or the toggle adding.

**This is not only the toggle.** The guard used to key off
`fixed_horizon is None` - "does this chassis have a B9/B10 toggle" - on the
reasoning that a fixed-10-year file had always printed `/60` and nothing had
regressed. That exempted three workbooks from a check they fail:

| workbook | horizon | sheet says | truth |
|---|---|---|---|
| Food4Less *(the reference)* | 10 fixed | $3,640.99 | $1,820.50 |
| Marriott | 10 fixed | $2,975.83 | $1,487.91 |
| Marriott L2 | 10 fixed | $2.29 | $1.14 |

`_check_carbon_divisor` now parses the divisor out of the formula and compares it
to `projection_years`, on every chassis. A divisor referencing `B10` passes by
construction; a mismatched hardcode is reported in **either** direction, since
`/(10*12)` on a 5-year file understates by half and that is equally wrong. It
reads from the **formulas** workbook - a cached number cannot tell you what
divided it - and stays silent on a literal, an unrecognised shape, or no loan,
because it reports defects it can prove and never guesses.

We still reproduce the reference document exactly, because cached values are what
get read and the reference has the defect baked in. What changed is that the QA
report now names it. Correcting those three sheets flips their 60-month
cumulative net negative - Food4Less **+$56,873 -> -$52,357** - so the delivered
proposals and the repaired workbooks will disagree. That is the operator's call,
not a bug.

### 4. A missing row is read as the row that took its place

`resolve()` tries the **label first, the fixed cell second**. That ordering is
load-bearing everywhere else, and it is a trap for any row a chassis does not
have. On `v15_no_itc` there is no ITC row at all, so the label `ITC` matches
nothing, resolution falls through to `B5` - which on that chassis holds **EVSE
Revenues** - and Section 7 printed a "Federal ITC (30%)" line of **$416,761**.
Nothing raised. No `#`. Just a large, plausible, entirely fictional tax credit.

The fix is to state absence in the map rather than hope a lookup fails:

```yaml
chassis:
  v15_no_itc:
    roi:
      absent: [roi_itc]
      fields_override: {roi_evse_revenues: B5, roi_net_revenues: B6}
```

`absent` short-circuits to `0.0` with a source of `absent on the <chassis>
chassis`, so `has_itc` is False and the existing suppression path does the rest.
`fields_override` additionally **suppresses the label search** for that token:
the label is what drifts between chassis, the address is what was verified.

**Do not "fix" this by reordering `resolve()`.** The cost block and the legacy
ROI both depend on label-before-cell.

### 5. Subtotals foot to the DISCOUNTED total, not the grand total

`Internal Summary!D29` is `=(B28+B13+B8+B3)` - it sums column **B**, the *list*
price. Every cost row on the Financial Worksheet is `Internal Summary!D<n>`,
column **D**, the *customer* price, whose own total is
`D30 = SUM(D3,D8,D13,D28)` = `cost_after_discount`.

So the invariant is:

```
cost_after_discount == equipment + design + electrical + labor
```

not `cost_grand_total`. The two coincide at a 0% discount, which is why rooting
the hierarchy check at the grand total passed on every zero-discount workbook
and failed as a **blocking ERROR** on every discounted one - including the
Food4Less reference file. Section 7 prints both totals; a `discount-applied`
INFO names the gap so nobody tries to add the rows up to the list figure.

---

## Structural differences: v16 vs the legacy workbook

Both are supported (the legacy path exists so the reference-fidelity test can
run), and they are not interchangeable.

| | legacy_food4less | v15_no_itc | v16 |
|---|---|---|---|
| Cost block | Grand Total `B42`, Remaining `B43` | **same as legacy** | **+1 row**: `B43` / `B44` |
| Cashflow tables | header row 3, data 4-14 | **same as legacy** | header row 4, data **5-15** |
| ROI `A5` | `Federal ITC (30%)`, non-zero | **`EVSE Revenues` - no ITC row at all**; Net at `B6` | `ITC`, zero |
| Carbon block | single tier, `I43:K46` | **six tier at `L4:R9`** | six tier at `D42:J47` |
| `INPUT SHEET!O7` | `Level 3 (DCFC)` | `L3 Type 1 (DCFC)` | `L3 Type 1 (DCFC)` |
| EVOLV on `Internal Summary` | `G4`/`H4`/`I4`, years `G5` | **`G3`/`H3`/`I3`, years `G4`** | `G3`/`H3`/`I3`, years `G4` |
| Service-plan block `F9:I14` | absent | absent | present |
| `Updated` rows | has row 13 `Avg Delivered Power`, pushing 13-21 down | same as legacy | no such row |
| `Updated` layout | cols B/C hist, D/E proj, F:H idle | same as legacy | 3 scenario blocks of 7 tier cols, B:V |
| Horizon | fixed 10 | fixed 10 | `B9` toggle -> `B10` |
| `Historical Data` | present | present | **absent unless the operator pastes it in** |

`v15_no_itc` is why the override mechanism is per-chassis and per-section rather
than one `legacy` flag: read that column down and it switches sides four times.
Specimen: `inputs/Historical_Marriott_Bakersfield.xlsx`, covered by
`tests/test_v15_no_itc_chassis.py`.

### `Cashflow!G3` is keyed to the horizon toggle, not the chassis and not the engine

The doubling defect **is** the B9/B10 toggle, which only the v16 chassis has. A
chassis that declares `horizon: {fixed: 10}` has no toggle: `B4` has always held
the 10-year figure, and `G3` spreading it over the 60-month loan is exactly what
the reference proposal prints. Firing the guard there would block generation over
a non-defect - on the acceptance-test file and on Marriott alike.

## Sheets that may be absent

`Historical Data` is **optional**. Read it when present; when absent set
`has_history = False` and the section registry suppresses Sections 3, 3A, 3B,
the Section 5 baseline-comparison table and chart 1, then renumbers. This is
what makes greenfield sites work. Do not add it to `required_sheets`.

`Historical Data` is fully self-contained (109 formulas, zero cross-sheet
references), so it ports into v16 cleanly and reads identically under either
engine. Sections 3 and 3A are safe as-is.

**Section 3B is recomputed in Python, never read off a sheet.** Under the legacy
engine those values sit in `Updated!B5:C27`, which is exactly the block that
collides. `baseline.py` re-derives them from `Historical Data` alone, so both
engines produce an identical Section 3B. The chain is verified to reproduce the
reference proposal exactly: occupancy 15.3% / 43.0%, rating 7.06 / 49.00, profit
per year $269.50 / $12,848.62, total yearly $13,118, gross yearly $31,220.

### The Section 3B utility rate looks like a constant and is not

`net_profit_month = revenue - (kwh_per_day * utility_rate * 30)`. That rate was
hardcoded at `$0.40/kWh` because both known workbooks used 0.40. It is
**hand-entered per workbook** in `Updated!B18` / `C18`, and Marriott Bakersfield
uses **0.2584**. At 0.40 that file's Section 3B reported $10,979.55/yr while
Section 5 and the ten-year headline in the same document said $16,446.75 - a
proposal disagreeing with itself by $5,467.

Read it **by label**, not by row: the row is 18 under the legacy engine and 17
under the scenario grid (legacy has the extra `Avg Delivered Power` row 13), but
both put L2 in column B and the first L3 column in C. Falls back to 0.40 with a
warning, so the two reference workbooks are byte-identical.

### Section 3B profit is invariant to the operator's port and nameplate inputs

Counter-intuitive, and it changes what those inputs are for. The chain cancels
them out:

```
stalls_used_per_day    = ports * (J12 / ports)      = J12
rating * delivered_pct = rating * (J14 / rating)    = J14
revenue_per_day        = J11 * J14 * J12 * J13      <- pure Historical Data
```

So a wrong port count or nameplate rating produces **identical** revenue, profit
and gross figures. What it does change is the displayed stall counts, the
occupancy percentage and the charger rating - which look authoritative and are
wrong. Consequences:

* The `Updated!B22` vs `C22` reconciliation is an algebraic identity and can
  never catch a bad port count. It catches an internally inconsistent
  `Historical Data` sheet (someone overtyping the hardcoded constants in
  J12:K14 without updating the totals above), which is still worth having.
* Port counts are validated against the station-count note in `Historical
  Data!I15` instead. On the specimen this fires: the note says 6 Level 2
  stations, the calculator was driven with 5, and that choice is what produces
  the 15.3% occupancy the reference prints rather than 12.8%. Surfaced as a
  warning, not corrected.

## Reading conventions

* **Cached values only.** openpyxl cannot evaluate formulas; it reads whatever
  Excel cached at last save. If `Financial Worksheet` has no cached numerics,
  raise `WorkbookNotCalculated` and tell the operator to press Ctrl+Alt+F9.
* **Two loads.** Scenario detection parses the *formula* of
  `Financial Worksheet!I6`, so a second `load_workbook(data_only=False)` is
  required.
* **Defined names may be sheet-scoped.** The eight DLL loan names and `Data`
  live on `wb['DLL Schedule'].defined_names`, not `wb.defined_names`. Only
  `cumCashCats` / `cumCashVals` are workbook-scoped. `resolve()` tries both.
* **`cumCashCats` / `cumCashVals` are `OFFSET(...)` formulas**, not static
  ranges. openpyxl cannot evaluate them; parse the arguments and resolve against
  `Financial Worksheet!B10`.
* **Labels drift.** Trailing spaces (`'Carbon Credits '`, `'Net Revenues '`,
  `'Chargers '`, `'ADA '`) and suffixes (`'Project Management (@$358/hour)'`)
  are common. Normalise: lowercase, collapse whitespace, `&` -> `and`, strip
  trailing `:` and `.`, then `startswith`.
* **Empty is missing.** `None`, `""` and any `#`-prefixed string mean missing.
  Never default a required field.
* **`INPUT SHEET!N17:N21` are empty in v16.** Only the labels in column M exist.
  Client info is an operator input; treat the workbook values as a prefill.
* **`INPUT SHEET!M21` contains a mojibake replacement character.** Sanitise text
  read from the client-info block.

## Level 2 hardware is named from the line items, never assumed

Level 3 always read correctly because `dcfc_mix_sentence` is built from charger
**quantities** and real ratings. Level 2 had no equivalent: the display string was

```python
f"{n_ports_l2} single-port 32A units"     # every word of this was wrong
```

Three defects in one expression. `n_ports_l2` is `INPUT SHEET!N9`, a **port**
count, printed with the noun "unit"; and `single-port` and `32A` were the
reference site's hardware, hardcoded. On a site installing 2 x `CTX-C80-240-2`
("80A Dual Commercial L2 Charger") across 4 ports it printed **"4 single-port 32A
units"** - a plausible sentence with nothing right in it.

`n_chargers_l2` (`N8`, the unit count) was already extracted and went nowhere,
and the line item's own `description` was already read and never used. Both are
used now, by `_publish_l2_equipment`:

| token | Best Western | from |
|---|---|---|
| `l2_mix_sentence` | `2 x 80A Dual Commercial L2 Charger` | `_L2` line items, grouped by description |
| `l2_quantity_ports` | `2 units / 4 ports` | `N8` and `N9` |
| `l2_amperage` | `80A` | the description, else the SKU |

Three things that matter:

* **Group before counting.** Food4Less lists the same charger on two rows (qty 8
  and qty 2) and must read `10 x ...`, not `8 x ... and 2 x ...`.
* **Trim at the first `(`.** The description ends "(18' Cable with Modem)", detail
  Section 6A's mounting row already covers.
* **Never default the amperage.** Printing the wrong current rating on a charger
  spec sheet is the whole defect. Blank is honest; `32A` is not.

A dual-port charger modelled with one port raises
`l2-ports-contradict-hardware`, because every Section 5 revenue figure is driven
by the port count and `N9` would be understating it by half. Named, not
corrected - the port count is the operator's. Fires today on
`Rip_and_Replace_MarriottBakersfield_L2.xlsx`.

## Section 8 must account for the WHOLE electrical subtotal

`cost_electrical_subtotal` has **fourteen** children. `_infrastructure_rows` used
to be a hardcoded dict of **six**, and the "Other / miscellaneous" row printed a
literal `$0 or project-specific`. So Section 8 showed a strict subset of the
scope and called it the infrastructure breakdown. On Best Western it printed
$84,486.52 of a $191,639.04 scope - hiding **$107,152.52, 56% of the electrical
cost**, including $68,970 of Main Distribution Switchgear and $20,933 of ADA
work, in a table a customer reads as the scope of works.

The row set now lives in `infrastructure:` in the map, and the misc row is a
**residual**:

```
other = cost_electrical_subtotal - sum(named rows)
```

Residual, not a sum of the known leftovers. That is the whole point: the table
foots to `Internal Summary!D13` **by construction**, including on a chassis that
grows a child row this map has never heard of. `_check_infrastructure_foots`
guards against someone later "simplifying" it back into a sum - which is exactly
the shape that dropped the $107k.

The fixed tail row that held the hardcoded misc figure is **deleted**
(`keep_tail: 1` on table 37 - the only tail row left is the SCOPE BASIS note).
It briefly became a printed total, which just restated the column above it. The
footing is still enforced, by `_check_infrastructure_foots`; it is simply not
printed. Putting `keep_tail` back to 2 makes the loop stop one row short and
silently drops whichever category sorts last, so there is a test on it.

## The cost stack is hierarchical

Do not sum the emitted rows to check the grand total; it double-counts.

```
B16 Equipment Purchase Invoice  = B17 + B18 + B19 + B21
B22 Design Invoice              = B23 + B24 + B25 + B26
B27 Electrical Supply etc.      = B28 .. B41
B43 Grand Total                 = B16 + B22 + B27 + B42(Labor)
```

Confirmed against `Internal Summary!D29 = B3 + B8 + B13 + B28`.

Also: `B18` "Parts Warranty" is `Internal Summary!D5` (customer price, after
discount) while `B20` "5 Year Service Agreement" is `Internal Summary!B5` (list
price). Identical at 0% discount, divergent otherwise. **Print B18**; warn when
they differ.

## The monthly history window

`full_history.monthly_series` must not take every row. The specimen carries
2021-12 and 2022-02 stubs and a trailing partial month. "Last month with
meaningful revenue" is wrong: 2026-07 has $1,040 and picking it shifts the whole
window by one.

Read the window from the *formulas*: `Historical Data!J4` is `=ROWS(A8:A42)` and
`J5` is `=DATE(2026,6,30)-DATE(2023,8,1)+1`. Parse those for the exact row range.
`Historical Data!B44:G44` sums all 40 rows including the stubs, so `D44` is
$93,453.35 while the window total used everywhere downstream is $92,358.23.

## Layout

```
ev_proposal_agent/
  resolve.py     defined-name / label / cell resolution
  engine.py      engine + scenario + horizon detection
  extract.py     workbook -> context
  baseline.py    Section 3B recompute from Historical Data
  aggregate.py   scenario grid -> L2 / L3 columns
  sections.py    section registry, suppression, renumbering
  validate.py    error / warning / info findings
  charts.py      three PNGs
  render.py      docxtpl render + post-render scrub
  narrative.py   templated sentences, optional analyst commentary
  gui.py         PySide6 drop-zone app
  cli.py         headless entry point
config/field_map.yaml            base map = v16; `chassis:` holds the overrides
templates/proposal_template.docx
docs/CELL_MAP.md                 every proposal figure -> sheet + cell
docs/PLACEHOLDER_INVENTORY.md    every token -> section + source
```

## Template notes

The reference document is 236 body blocks, 69 top-level tables, 1.4 MB of
`document.xml`, 4 section definitions, 9 headers, 3 footers, 10 media files.

* **Every numbered section heading is a 1x2 table**, not a paragraph: a teal
  (`08B3AD`) badge cell holding the number, and a title cell. Renumbering writes
  into table cells.
* **The cover date is split across three runs** (`'AUGUST '`, `'4'`, `', 2026'`).
  Replace at paragraph level, not run level.
* **All three footers carry the site identity** (`Food4Less | 3434 Manthey Rd,
  Stockton, CA 95206`). Scrub `footer1/2/3.xml`, plus `docProps/core.xml` and
  `docProps/app.xml`.
* Charts are `image3` (6.65 x 2.66 in), `image4` (6.55 x 2.75 in) and `image7`
  (5.85 x 3.25 in). Leave `image1/2/5/6/8/9/10` (logos and product photos) alone.
* Nine empty `ZIE H2` spacer paragraphs at body indices 72-80 exist only to push
  the anchored Section 6 product photos down the page. Deleting them reflows the
  section.

## Known defects in the reference proposal - do not reproduce

* Cover says **August 4, 2026**; Section 2 says **August 3, 2026**. One token.
* The footer page number is a literal `1` cached beside the `PAGE` field.
* Section **3B**'s "TOTAL NET PROFIT" block has a merged-cell artifact collapsing
  the Level 2 and Level 3 columns into one value. (The brief attributes this to
  Section 5; it is 3B.)

## Every printed figure is bound to a cell - and tested

**Superseded section.** This used to list 17 reference-site figures still baked
into the template. Sixteen were tokenised; the seventeenth (`$8,600`) and one
more (`$0.0045`) were found and fixed by the source audit on 2026-09-10. See
`docs/SOURCE_AUDIT.md` for the full findings.

What remains in the template is **seven literals, every one a constant**: the
IRC 48 rates (`30%`, `10%`), the LCFS explainer figures (`3,500`, `4,500`,
`2.5%`) and an illustrative demand band (`$20`, `$35`).
`tools/audit_template.py` scans every XML part - text boxes, headers and
footers included, which `python-docx` cannot see - and **exits non-zero on any
literal with no recorded verdict**, so a rebuild cannot quietly add one.

### The defect that outlived the others, and why

Section 13's carbon sentence was frozen reference prose:

> "...with current rates of **$8,600 per year for the 100 kW class**."

`narrative_carbon` computed the right sentence every run and
`{{ narrative_carbon }}` was **never placed in the template**, so it was
discarded. Best Western printed $8,600 for a 100 kW class when its own workbook
models **$17,200 for the 240 kW class**; the reference site itself printed
100 kW against its true **98 kW**.

It survived because `tests/test_no_hardcoded_figures.py` walked `doc.tables`
only. A body paragraph is exactly where a leak hides from a table-cell differ.
That test now walks paragraphs, headers and footers too.

Two lessons worth keeping:

* **A computed-and-discarded payload key raises no finding.** `render.py`
  computes missing values as `declared - payload` and never checks the inverse,
  so a token the template forgot is silent. `narrative_roi` is still in that
  state - harmless, because no frozen ROI figures exist, but the same shape.
* **`build_template.py` reports failures without failing.** A missed `expect`
  prints a `!` line and the build still exits 0. Its docstring claims otherwise.

### The four hops, and the one that was never tested

```
workbook cell  ->  ctx token  ->  template token  ->  rendered position
```

Every hop had a test; the chain had none. The dominant pattern is structurally
blind to a wrong cell:

```python
assert ctx.num("cost_grand_total") == pytest.approx(43235.97)
```

That literal came from running the extractor. A token reading a
plausible-but-wrong cell has its wrong value recorded as expected - which is how
the fictional `$416,761` ITC line survived.

`tests/test_source_binding.py` closes it. Every emitted token carries a
`source=` (225 of them; 156 name a cell, 69 state a derivation), every
single-cell token is compared against that cell **read independently**, and
**mutating a cell must move exactly the tokens claiming it** - the only
construct that catches a wrong cell in general. It was validated by sabotage:
mis-wiring `cost_labor` to a neighbouring row makes the suite fail.

`ctx.put()` used to take `source=` optionally and 18 of 82 call sites omitted
it. Do not add a `put()` without one.

### Charts are data, not decoration

`charts.chart_series()` returns exactly what is plotted and `render_all` draws
from it, so `tests/test_chart_data.py` asserts against the same values the
customer sees. Charts sit outside every string-based guard - a figure
rasterised into a PNG cannot be found by searching the document - so this is
the only thing standing between a wrong column and a picture of it.

## Idle fees are not in the proposal, and are still in the workbook

Do not reintroduce them. The document models no idle-fee revenue, so anything
describing an idle policy describes a stream it does not claim.

Removed in three stages, the last of which was 2026-09-10:

* the projection tiles' **arithmetic** (tile 1 was `year1_charger_profit +
  idle_fee_annual`, which meant one caption described two different quantities
  depending on the engine)
* their **captions** ("Charging profit + idle fees", "Before idle fees",
  "Operating profit + idle fees + Carbon Credit")
* Section 4's methodology layer and assumptions row, and Section 10's EVOLV
  capability bullet - `DELETE_ROWS` / `DELETE_PARAGRAPHS` in
  `tools/build_template.py`

Deleting methodology layer 5 renumbers 6 and 7; `renumber_leading_ordinals`
does it by scanning the `N. ` prefix, so adding or removing another layer needs
no edit. `tests/test_prose_variability.py` asserts no rendered proposal on any
chassis contains `idle`, `grace-period` or `overstay`, and that the layer
numbering has no gap.

**`idle_fee_annual` is still extracted** from `Updated!G12 + H12` and still
appears in the QA report. It is a real figure sitting in the workbook, and the
QA report exists to show what is in the workbook; dropping it would hide an
input rather than remove a claim. The grace-period cells `G6`/`H6` are **not**
published any more - their only consumer was the row that went, and a token
computed for nobody is exactly how Section 13 came to print the reference
site's carbon rate for months.

## Backlog - mention, do not build

* Fix `Cashflow!G3`'s hardcoded `(5*12)` at source, then relax the guard.
* Rewire or delete `10 Year Projection Comparison`; it is a loaded gun in every
  workbook.
* Batch mode: a folder of workbooks in, a folder of proposals out.
* PDF export via Word COM.
* Keep the fingerprint block so a future v17 can be detected and given its own
  `chassis:` entry. Adding one is now YAML, not code.
* Make `tools/build_template.py` exit non-zero on a missed `expect`, rather
  than printing a `!` line into a generated markdown file and continuing.
* Place or delete `narrative_roi`; it is computed every run and discarded.

## Running it

```bash
python -m ev_proposal_agent inspect  <workbook.xlsx>        # detect + dump every token
python -m ev_proposal_agent generate <workbook.xlsx>        # proposal + QA report
python -m ev_proposal_agent charts   <workbook.xlsx>        # the three PNGs only
python -m ev_proposal_agent gui                             # desktop app
python -m tools.build_template                              # rebuild the template
pytest tests/ -q
.\build.ps1                                                 # template + tests + .exe
```

The template is a **build artifact**, regenerated from the reference proposal by
`tools/build_template.py`. Do not hand-edit `templates/proposal_template.docx`;
the next build overwrites it. Change the builder instead.

## Pipeline order

`detect -> extract -> plan sections -> validate -> charts -> render -> verify`

Validation runs **before** anything is written. An ERROR means no file appears
at all, because a proposal with a wrong number in it is worse than no proposal:
it gets sent. The QA report is still written so the operator can see why.

## Section numbering

`sections.py` owns the registry. A section's number appears in three places -
the page-2 contents, the Section 2 grid, and the teal badge - and all three are
generated from one plan, so they cannot disagree. Continuations (3A, 7A, 17B)
take their parent's number and never consume one of their own.

Suppressible today: Sections 3 / 3A / 3B (need `Historical Data`, and 3B also
needs the operator's port counts) and 14 / 17 / 17A-17D (need a loan).

The `{%p if %}` ranges in the template stop short of the section-break
paragraphs at body index 210 and 225. Those carry the landscape and portrait
`sectPr`; delete one and every following page loses its orientation.

## Things that bit, and the guards that came out of them

* **`autoescape` is off by default in docxtpl.** A bare `&` goes into the XML
  unescaped and is silently dropped, so "EVOLV & Commissioning" renders as
  "EVOLV  Commissioning". `render()` passes `autoescape=True`.
* **`"$-49,988.10"` is not how anyone writes money.** No format string can put
  the sign before the symbol, so `format_value` applies it to the magnitude.
* **A replacement containing its own search string loops forever.** `"3"` ->
  `"{{ n_ports_l3 }}"` never terminates. `replace_in_paragraph` resumes past
  what it inserted, and bare integers are never used as search strings at all -
  `13` occurs inside `$13,118`, inside month numbers and inside the Gantt chart.
* **`validate()` must not append to `ctx.findings`.** The GUI re-validates after
  every edit, and a mutating validator duplicates every finding each time.
* **`get_undeclared_template_variables()` lists variables inside `{%p if %}`
  blocks that will never render.** Treating a missing one as fatal blocks every
  proposal for a site with no history. Missing values are blanked and warned.

## The desktop app

`gui.py` is the window; `ui_widgets.py` holds the reusable pieces and is the one
place its look is defined. Design read: an internal operator tool used
repeatedly by people not thinking about software while they use it. Dials
VARIANCE 3 / MOTION 2 / DENSITY 5.

**Progressive disclosure.** Everything optional lives behind a collapsed
`Panel`, each showing a one-line summary of its own state ("4 switched off",
"Using the stock photo"), so folding something away never hides that it changed.
The default view is a drop zone and a button.

**One accent.** The brand teal, on the active step and the primary action and
nothing else. Everything else is type scale and spacing.

### Operator customisation

* **Cover photo.** `ImageDropZone` takes a drag-and-drop image and shows a
  thumbnail back, because a cover photo you cannot see before generating is one
  you discover in the PDF. Falls back to `templates/assets/cover_default.jpeg`,
  which is the reference cover lifted out at build time. Sized by width only:
  fixing both dimensions stretches anything that is not 4:3.
* **Section toggles.** One row per registry entry with a one-line description.
  `Section.removable = False` on the executive summary, the overview and the
  terms: a proposal without those is not a proposal, and a tick-box should not
  be able to produce one. Attempting it raises a warning and keeps the section.

Both arrive through `operator_inputs` as `cover_photo_path` and
`disabled_sections`. They steer the build rather than appearing in it, so
`extract.CONTROL_INPUTS` carries them into the context unformatted.

**Every section carries a `{%p if show_<key> %}` guard**, not just the
data-driven ones. An unguarded section leaves its badge behind pointing at a
numbering entry that no longer exists, which is a hard Jinja error at render
time. The guard ranges are clamped so they never swallow a section-break
paragraph; removing one loses the page orientation for everything after it.

### Existing port counts are read, not typed

Section 3B needs the count of ports **already on site**, which is not the count
being installed. Both live in the workbook and are easy to confuse:

```
Updated!B6 / C6        EXISTING stall counts        <- what 3B needs
Internal Summary!G3    =INPUT SHEET!N8+SUM(O8:T8)   NEW charger count, for
                                                    EVOLV per-port pricing
```

On Showcase Liquor those read **8** and **2**. Using the EVOLV figure puts the
occupancy at 68.6% instead of 17.1% and contradicts the workbook's own
`Updated!B8`.

`extract._prefill_existing_equipment` reads `Updated!B6`/`C6`, and recovers the
nameplate from `B12`/`C12` by dividing the de-rate back out (`B12` is
`=7.2*'INPUT SHEET'!$N$11`). It runs **only under the legacy revenue model** -
under the scenario grid that same `B6` holds the Standard-Low *new* stall
quantity, which is the collision this program exists to avoid. An explicit
operator value always wins over the prefill.

### Section 13 carbon KPI strip

All three tiles are read from the workbook:

| Tile | Source |
|---|---|
| MODELED n-YEAR CREDITS | `Financial Worksheet!B4` |
| LEVEL 3 MULTIPLIERS | `FW!E45:J45`, one line per tier whose `E44:J44` quantity is above zero |
| LEVEL 2 FACTOR | `FW!F47` |

`FW!D43:J45` lists a rating, quantity and multiplier for all six L3 classes.
Only the columns with a quantity are being installed; printing the rest quotes
credits for hardware that is not in the proposal.

Two traps in that multiplier tile, both invisible with a single tier:

* **A newline inside `<w:t>` is a space in Word, not a line break.** Stacking
  multipliers needs `<w:br/>`, which `RichText` emits.
* **`{{ tag }}` nests RichText runs inside the existing `<w:t>`,** which is
  invalid and renders as an empty cell. The tag must be `{{r tag }}` so docxtpl
  replaces the whole run. That also discards the run's formatting, so
  `render._kpi_richtext` re-applies the tile's teal 16pt bold to every run, and
  always returns a RichText so the one-tier and many-tier paths cannot diverge.

### The action bar has two states

Before a run the only action is a teal **Generate proposal**. After a successful
run the primary becomes **Open proposal**, the QA report and folder appear as
bordered secondary buttons, and generating is demoted to a secondary **Generate
again**. The loud button is never the one that repeats what you just did.

Two things that made the first version look broken:

* The result buttons used `role="quiet"`, which is borderless with muted text on
  a white bar, so all three read as blank gaps. They are `role="secondary"` now,
  with a real border.
* A dynamic property change (`role` primary -> secondary) is not picked up until
  the widget is re-polished. Without `style().unpolish()/polish()` the button
  keeps its old appearance while reporting the new role.

Result buttons connect once at build time and read their target back off a
`target` property. Reconnecting per run either stacked duplicate handlers or
warned on the first `disconnect()`, when nothing was connected yet.

## The .exe is the only thing the operator runs - and it bundles its own config

`dist/EVProposalGenerator.exe` embeds `config/` and `templates/` **inside
itself** (`--add-data` in `build.ps1`). Editing the source tree changes nothing
for the app. This has already cost a customer-facing document: a proposal was
generated from a 13-day-old exe whose baked-in template still carried the
reference site's `$22,592 / $67,776 / $112,960` in Section 5, long after the
source had been fixed.

So: **every change to a build input means the exe is stale until `.\build.ps1`
runs.** Build inputs are `ev_proposal_agent/*.py`, `config/field_map.yaml`,
`templates/*`, `tools/build_template.py`, `run_gui.py`, `requirements.txt` and
the `.spec`. `tests/` and `docs/` are not - they do not ship inside the exe.

`tools/dist_guard.sh` enforces it, wired up in `.claude/settings.json`:

| mode | hook | what it does |
|---|---|---|
| `mark` | `PostToolUse` on `Write\|Edit` | appends the path to `.claude/.dist-stale` if it is a build input |
| `check` | `Stop` | warns every turn until the exe is newer than the sentinel, then self-clears |

It deliberately does **not** auto-rebuild. PyInstaller clears `dist/` before it
starts and takes about four minutes, so an automatic build leaves *no* exe for
most of that window, and `build.ps1` force-kills a running instance - it would
shoot the app out from under the operator mid-proposal. A stale exe beats a
missing one; an unmissable warning beats both.

Two portability traps in that script, both found by testing rather than reading:

* **`jq` is not installed on this machine.** The hook examples everywhere use it.
  `sed` does the JSON extraction instead.
* **The warning text must contain no backslash.** It is emitted inside a JSON
  string, where `.\build.ps1` decodes as `.<backspace>uild.ps1` - the message
  literally printed `.uild.ps1` until the backslash came out.

To verify what a built exe actually contains, read it rather than trusting the
build log - `PyInstaller.archive.readers.CArchiveReader` will extract
`config/field_map.yaml` and `templates/proposal_template.docx` straight out of
the binary.

## Shipping it to another machine

```
.\build.ps1                       template + tests + exe + release zip
python -m tools.make_release      just the zip, if the exe is already built
```

`release/EVProposalGenerator-Setup.zip` (112 MB) holds three files:

| | |
|---|---|
| `EVProposalGenerator.exe` | the app, 103 MB, fully self-contained |
| `Install.exe` | 10 MB, one button, makes the shortcuts |
| `README.txt` | what to do, and what SmartScreen will say |

The receiving machine needs no Python, no Excel add-in and no administrator
rights. Installs per-user into `%LOCALAPPDATA%\Programs`, so there is no UAC
prompt - a prompt is the kind of thing that stops an install.

The installer is **tkinter**, not PySide6. tkinter is in the standard library,
so it freezes to 10 MB rather than another 100 and the download stays roughly
the size of the app itself.

### Every build says which build it is

Four `.exe` files shipped in one afternoon, all reporting `__version__ =
"0.1.0"`, none of it shown anywhere in the app. So "it still says permission
denied" was unanswerable: it could mean the fix did not work, or that the old
binary was still installed, and nothing on screen told those apart. That is a
worse problem than any single bug, because it makes every bug unfalsifiable.

`build.ps1` runs `tools/stamp_build.py` **before** PyInstaller, writing
`config/build_info.json` so the stamp travels inside the exe. It shows up in
three places: the window title, `--version`, and the QA report header.

```
EV Proposal Generator  -  v0.1.0 - build 2026-08-20 15:56 [28806b95]
```

The stamp is a hash of **what actually ships and changes behaviour** -
`ev_proposal_agent/*.py`, `config/field_map.yaml`,
`templates/proposal_template.docx`, `run_gui.py`. A clock time alone cannot
answer "is my fix in this build"; two builds a minute apart look identical. The
stamp differs the moment any input does. Running from source there is no stamp
file and the label says `(running from source)` rather than inventing one.

**First question for any report from another machine: read me the title bar.**

### "Permission denied" has two completely different causes

Both used to surface as that bare phrase, and they need opposite fixes. The
question to ask first is **when** it happened.

| when | what failed | error |
|---|---|---|
| on **drop**, before anything is written | reading the `.xlsx` | `WorkbookNotReadable` |
| on **generate** | writing the `.docx` / QA report | `OutputNotWritable` |

**Reading.** `_open_both()` tries the file in place, and on any `OSError` copies
it to temp and reads the copy. That is not a fallback for its own sake: Windows
normally permits a COPY of a file Excel holds open even when opening it in place
is refused, so the commonest cause - the workbook is open in Excel - fixes itself
instead of sending the operator away to close it. If the copy fails too,
`WorkbookNotReadable.diagnose()` inspects the actual file and names the cause:
a `~$name.xlsx` lock file beside it (open in Excel), the OFFLINE /
RECALL_ON_DATA_ACCESS attribute (OneDrive "online-only", nothing local), a
`Content.Outlook` / `INetCache` ancestor (dragged out of an email or a zip), a
directory, or a file that has simply gone. Several clues can be true at once and
all get reported.

Do **not** widen the email/zip test to "is it under `%TEMP%`" - that mislabels
anything a user happens to keep there, which is why it names the specific
folders Outlook and the zip viewer use.

### Where the output goes is a third instance of the same trap

`output_dir()` was `%USERPROFILE%\Documents\EV Proposals`. On the first
machine it shipped to, that produced a bare **"permission denied"**.

It is the Desktop bug again. With OneDrive folder backup on - the Microsoft 365
default - the real Documents is `%OneDrive%\Documents` and the profile one is
absent or a redirected stub. `paths.documents_dir()` now reads `Personal` from
`HKCU\...\Explorer\User Shell Folders`, exactly as
`installer/install_app.py:desktop_dir()` does for the shortcut. The two cannot
share code - the installer is a separate frozen tkinter binary - so they are
deliberate mirrors, and a change to one belongs in the other.

`output_dir()` also probes the folder and falls back to `%LOCALAPPDATA%`, because
**Defender Controlled Folder Access** treats Documents as protected and blocks an
unsigned exe from it silently - no prompt, no obvious log.

Every write is wrapped in `OutputNotWritable`, which names the three real causes
in frequency order: the last proposal still open in Word (by far the commonest),
OneDrive mid-sync, and Controlled Folder Access - with the click path to allow
the app through. A bare `PermissionError` tells the operator none of that.

### Two things that bit

* **The desktop is not `%USERPROFILE%\Desktop`.** With OneDrive folder backup
  on, which is the Microsoft 365 default, the real desktop is
  `%OneDrive%\Desktop` and the profile one does not exist, so the shortcut was
  silently dropped. `desktop_dir()` reads the true path from
  `HKCU\...\Explorer\User Shell Folders`. When it still cannot find one, the
  install completes and says so rather than pretending.
* **Nothing is code-signed**, so SmartScreen shows "Windows protected your PC"
  on first run. A certificate is an annual cost. The README explains "More
  info" then "Run anyway", and the quieter route: right-click the zip before
  extracting, Properties, tick Unblock.
