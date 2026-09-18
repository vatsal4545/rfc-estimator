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
