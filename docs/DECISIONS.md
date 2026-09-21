# Decision log

Dated decisions about how the estimator hands off to the CEO's process. Newest
first. Each entry says what was decided, who decided it, and what it changed in
the code, so nobody has to rediscover it from the git history.

## 2026-09-17 — The filled intake leaves the Overrides tab alone

**Decision (CEO, via Vatsal).** The EVSE Project Intake the app fills must not
carry the estimator's construction and engineering figures into the intake's
Overrides register. The CEO prices the job from the intake's own derivation;
intake values are treated separately from the estimator's.

**What changed.** `carryEstimatorOverrides` defaults to **false**
(`lib/intake/plan.ts`, `components/intake/HandoffSection.tsx`,
`lib/proposal/types.ts`). By default only two things reach the Overrides tab:
entries typed on the app's own Overrides tab (including rows that came in from
an imported intake), and the Commercial tab's pass-throughs (line-extension
contribution, additional scope). The handoff tab's checkbox sends the
estimator's figures as overrides, with reasons, for anyone who wants that on a
given project. Commit 757ecb7.

**Consequence.** With nothing in Overrides, the CEO's engine prices
construction purely from the intake's distances, quantities and RefData rates.
The estimator's own numbers stay in the app and no longer influence his price.

## 2026-09-14 — Sam's Costs Internal pricing merged, including no construction sales tax

**Decision (Vatsal).** Merge Samuel-J-Mathew/rfc-estimator commit 6c7e0b0 in
full (merge 377917f).

**What changed.** Costs Internal's loading column carries contingency and the
commercial markup compounded, so Final Cost / Total are list price on the app
tab, the Cost Detail export and the RFC/MSRP fill; the Construction PM row is
CEO-basis PM plus design PM hours only; the Internal Summary links to that row.
And: `computeCosts` levies **no construction sales tax** and
`taxConstructionMaterials` defaults **off**, so every project's Total Cost
dropped by that tax.

**Recorded objection.** The RFC V18 workbooks (Boatman, VN Village) compute
"Sales Tax on equipment" as SUM(construction block) × 7.25 % (about $19.4k and
$9.4k respectively); only the newer Hoopa Motel file holds that row at zero.
This supersedes the 2026-09-01 decision that Total Cost keeps taxing loaded
construction.

## 2026-09-14 — Intake 3.6.0 and the Hilton Gaslamp Rev C corrections

- Template 3.6.0 adopted (add-load project type, section I capacity test,
  "Existing — retained" feeder). Commit be179bb.
- The nine 3.6.0 formulas the CEO's release saved one parenthesis short
  (Electrical N160, B211–B214, C211–C213, Construction B66) carry the CEO's own
  corrected text in the app's template copies, taken from his Hilton Rev B
  file. The published template still has the defect.
- Hilton Rev C (H-00082) issued from the app with the CEO's corrections:
  design ambient 30 °C, insulation 90 °C, Level 2 chargers 13–14 upsized to
  6 AWG (chargers 15–16 already pass at 2.2 % on 6 AWG), transformer rating
  out of the amps column (312 A secondary, 112.5 kVA in the name). Left open
  for Jesse: interval data (Existing row 192), gear space (196), utility
  notification (197).
- Round trip hardened so an imported intake's typed rows come back exactly:
  per-run distances and conductors as takeoff edits, the distribution
  schedule verbatim, revision history, rentals at typed rates, and every
  intake-typed construction field pinned sticky through rebuilds. Commit
  57b03ee.

## 2026-09-18 — Custom rental lines and the intake's rental table

**Fact of the template.** The intake's rental table (Construction rows 39–52)
has 14 fixed rows whose names are locked cells: Fencing, Mini x, Dump Truck,
Forklift, Trench Plates, Storage container, Portable restroom, Low boi, Saw
cutter, Jack hammer, Compactor, Generator rental, Dump trailer rental,
Equipment protection. Only quantity, unit cost, days and the include flag are
editable. There is no free row.

**Behaviour.** A rental line added on the Peripherals tab lands on the sheet
only when its name is one of those 14 (matched case-insensitively against the
estimator's item name or the template's label). Any other name stays in the
app; the fill's report names it, and the Peripherals and Construction tabs
show "Not on the intake" beside it, with a picker of the 14 names. Two lines
on one row: the first is written and the report says so.

**Decided (Vatsal, 2026-09-18).** Live with the 14 names for now. If free-text
rental lines are ever needed on the sheet, that is a template change on the
CEO's side — unlock the name cells in Construction!A39:A52, or add blank rows
to the table — after which the app can write any rental name.

## 2026-09-18 — Intake 3.7.0: distribution feeders priced (Electrical block I)

**Fact of the template.** 3.7.0 (released 2026-09-15, content hash
a9ba811854921b2d) appends one block and moves nothing: Electrical rows
239–259, "I · DISTRIBUTION FEEDERS", twelve rows (242–253) of feeder between
the items on the distribution schedule. Blue inputs per row: B FROM, C TO
(both dropdowns over A165:A176), G floor A override, H distance, I sets,
K conductor override (WIRE_SIZE), P conduit override (PVC_SIZE). The sheet
resolves volts / phases / rating from the item fed (a transformer takes the
FROM item's volts, else Project!B29), sizes the conductor from block H's
site table at floor ÷ sets, checks drop at floor ÷ 1.25, and totals material
in B256, which `Pricing!B10` now adds to the wire line. Until now nothing in
the workbook priced the wire between the boxes. The nine formulas the 3.6.0
release saved one parenthesis short are still short in the published 3.7.0;
the app's copies append the missing `)` (XML patch, nothing else touched).

**Behaviour.** The estimator already had the two feeders every mixed-voltage
site has — the chain's switchgear → step-down transformer and transformer →
sub-panel segments. The fill now writes them into block I against the names
block E used (on an imported workbook, the engineer's own transformer and
panel rows), with the estimator's sizing current as the floor in column G (a
transformer's schedule rating is kVA, which the sheet cannot size on) and its
conductor and sets as overrides — the same conductor at the same floor
prices the same on both sides. Typed rows travel the other way: the importer
reads block I, resolves each row against the schedule, and hands them to the
chain as `setup.serviceChain.feeders`, which REPLACE the guessed pair and are
sized the way the sheet sizes them (design current = floor ÷ 1.25, OCPD =
next standard device at or above the floor). The 3 · Electrical section shows
the engine's feeder rows and a small register to type the site's own.

**Material.** The sheet has ONE conductor material (Electrical B6) and reads
every size in block I as that material. The importer now sets the chain's
material from B6. When a project's chain material differs from its site
material (the app's default is an aluminium chain under copper branches), the
fill does not write the estimator's feeder conductor as an override — an
aluminium size would be misread as copper, ampacity and price both wrong —
and the report says the two sides price differently until the service-chain
material is set to match.

**Verified.** 458 tests; Hilton Rev C (3.6.0 file) imports, fills a 3.7.0
with both feeders OK against Jesse's schedule rows, 2,190 formulas recalc
with zero errors, and import → fill → import → fill is stable to the cent.

## 2026-09-18 — Intake 3.7.2 (the CEO's own repair)

**Fact of the template.** 3.7.1 corrected the block I From/To dropdown
validations (stored with a leading "=", which Excel reported as corrupt
content) and renamed the SDG&E EV-HP picker entries to the rate library's
exact names, adding EV-HP Primary. 3.7.2 restored the nine closing brackets
missing since 3.6.0 at the source. Content hash b83387921f8472c2. No row,
label or formula address moved from 3.7.0.

**Behaviour.** The app's template copies are the CEO's file byte for byte —
the local parenthesis repair kept since 3.6.0 is retired, and the oracle test
asserts the published file is clean. Nothing else changed; refdata and the
importer fixture were regenerated. Commit f138479, deployed from the Vercel
CLI (the Git integration left a deployment in "Initializing" all afternoon).

## 2026-09-18 — The website fills what the Yamashiro script filled

**Why.** The Yamashiro project (A-00649) was assembled by a script from the
SLD, the Courtesy Electric gear quote and Vera's concrete quote; the user
wants the same sheet to come out of the website when the form is filled.
Three inputs the script set had no home on the intake tabs.

**Added to the intake tabs.**
- 3 · Electrical: the distribution schedule (block E) is now editable — "Edit
  the schedule" seeds the engine's rows, every column of the sheet is typed
  (type / provider / cost basis use the template's dropdowns), and "Price the
  switchgear line at the quotes" writes the register (switchgear line = the
  vendor-quoted total on the rows we provide; sub-panels / transformers /
  breakers line = 0, they are inside the quotes) so the estimate, the sheet's
  B178 and Overrides row 10 carry one number. "→ catalog pricing" undoes it.
  Trench surface and depth (B8/B9) are typed here too. Choosing the conductor
  material sets the service chain's material as well — one site material.
- 4 · Construction: striping quantity and cost per lot (a contractor's quote
  for striping still to do), and a "Quoted site-works items" list (Vera's
  walls and slab) on the wires and peripherals line.

**Behind it.** `lib/intake/schedule.ts` holds the schedule as data: the
engine's rows moved out of plan.ts (`engineDistributionSchedule`), the typed
rows, `quotedGearTotal` (by-others rows are never our money — and a figure
typed against one still sums into the sheet's B178, so leave such rows
unpriced), `priceGearAtQuotes` / `clearGearQuotePricing`. The fill and block
I's feeder naming read the same rows in both modes.

## 2026-09-18 — The distribution schedule prices itself

**Fact of the template.** `Electrical!B178` (distribution equipment cost) is
`SUM(L165:L176)` — the quoted-cost column and nothing else — and
`Pricing!B9` is B178 × the materials markup. B179 flags a row UNPRICED unless
its cost basis is "By others" or "Priced elsewhere in this workbook". Since
the Overrides tab stopped carrying the estimator's figures by default
(2026-09-17), an app-filled intake had been handing the CEO a gear line of
$0 with every row marked "Priced elsewhere". The sheet's own RefData gear
table is the estimator's OLD ladder (2000 A $60k, 2500 A $58,540, 3000 A
$65k; no 600 A, 3200 A, transformers or panels) — it does not price block E
and does not match the current catalog everywhere.

**Behaviour.**
- The engine's schedule rows carry the estimator's catalog price in column L
  (qty × unit). Cost basis "RefData rate" where the sheet's table has the
  same figure, "Allowance" where it is the estimator's own (Larson-based
  frames, transformers, panels, breakers, EVSE disconnects). Utility
  substructures stay "Priced elsewhere" (they are the Utility line). B178
  now equals the estimator's switchgear + sub-panels lines on every fill.
- A typed row prices itself from the catalog by type, rating and volts
  (`catalogPriceFor`): Switchboard → main switchgear frame, Service
  disconnect → main breaker (208 V: disconnect), Panelboard/Subpanel →
  sub-panel, Transformer → its kVA, EVSE disconnect → the disconnect ladder,
  a breaker → its frame. Meter cabinets and tap boxes have no catalog price.
  Choosing "Vendor quote" stops the auto-fill and the vendor's figure is typed.
- "Price the switchgear line at the schedule" = Σ L on the rows we provide,
  with a row nobody priced carried at the catalog (the sheet says UNPRICED
  until it is typed). Sub-panels line → 0.
- Importer: a schedule with costs prices the gear line in place of the
  engine's catalog (never the engine's gear plus the quotes, which is what
  the old "(quoted) custom items" did). The register's own switchgear row
  wins when the engineer typed one; a schedule that merely repeats the
  engine's catalog adds nothing.

**Wire quotes.** The sheet prices conductor at RefData's locked $/ft; a wire
quote can only reach the estimator (per-project $/ft on 3 · Electrical) and,
opt-in, Overrides row 9. Yamashiro's rates set from Courtesy S1809768.

## 2026-09-18 — Castro (I-271744) Rev B, and two importer rules

- An intake the app filled before block E carried prices comes home with
  six rows "Priced elsewhere" and no cost. The importer now recognises that
  (every row unpriced, every item one the engine generates) and drops the
  schedule so the engine's priced rows take over on the next fill.
- The importer sets the utility on the project BEFORE the Quick build, so
  the utility's substructure rule applies (PG&E/SCE build the service under
  their EV rule; a POU has the customer pour the pad). Castro had come home
  with a $5,000 pad it never had.
- Price Book v1.1 (7) (chargers, accessories, warranties, service plans)
  matches the app's price book on all 87 SKUs; it carries no switchgear,
  panels, transformers or breakers, so gear stays on the estimator's catalog.
- Castro Rev B: design ambient 30 °C typed (the sheet priced the wire line
  at $0 without it), schedule priced from the catalog.

## 2026-09-21 — Intake 3.8.0: thirty charger runs, rentals carry their rate unit

The CEO released 3.8.0 (2026-09-20, hash 3a564d9eb659391e). Two changes
reach the app:

- **Electrical block B holds thirty charger runs (rows 18–47), not sixty.**
  Every block below it on that tab sits thirty rows higher: service block
  110–130, distribution schedule 135–146 (total B148), Rule 29 block
  155–172, block I feeders 212–223 (material B226). No other tab moved.
  `lib/intake/cells.ts` is remapped; the importer reads a 3.3.0–3.7.x file
  through `ELECTRICAL_LEGACY_SHIFT` (+30 from row 48) so Hilton, Yamashiro
  and Castro revisions still come home, and warns when such a file carries
  runs on rows 48–77 that the thirty-row table cannot hold. Filling still
  refuses anything but 3.8.0.
- **Rentals have a "Rate per" column (F: day / week / month)** and the
  duration is in that unit; the sheet prices qty × rate × duration
  regardless. The fill now writes the estimator's rate and duration as they
  are with F saying the unit (fencing per ft per week stays weekly, a
  monthly container stays monthly) — no more ÷7 into per-day rows. The
  importer follows F on a 3.8.0 file and keeps the per-day reading for
  older files.

Also in 3.8.0, on the sheet only: block B prices nothing on a row with no
charger; when every run is marked as sharing a trench the longest run owns
it; the Revenue subscription verdict stands down on a demand-charge
schedule; presentation tidy-ups. Refdata regenerated (37 rate schedules —
EV-HP Primary joined at 3.7.1). 468 tests.

## 2026-09-21 — The intake always carries a design ambient

CEO: "without design ambient on these sheets in the electrical section it
won't work." True — every charger-run verdict on the sheet reads SET THE
DESIGN AMBIENT, the auto conductor column is blank and the wire line prices
at $0 until Electrical!B10 holds a number, and the fill used to leave it
blank unless someone typed it. Now the fill always writes B10 (and B126 for
a service feeder we provide): the site figure typed on 3 · Electrical, else
`DESIGN_AMBIENT_DEFAULT_C` = 30 °C — the NEC 310.16 table ambient, which is
exactly the (uncorrected) basis the estimator sizes on, so the sheet and the
estimator pick the same wire. A defaulted value is flagged in the handoff
report so the ASHRAE 2% design dry-bulb or duct-bank temperature gets typed
when it is hotter; the sheet then sizes some runs up, as it should.
