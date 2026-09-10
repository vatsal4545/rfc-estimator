# RFC Estimator

Turnkey cost-estimating app for EV charging (EVCS) projects — the successor to the
RFC_V18 spreadsheets. Describe a site (charger models × counts, terrain, services)
and it derives everything: NEC wire/conduit sizing, panel schedules, switchgear and
transformer selection with catalog pricing, civil and ADA quantities (CBC 11B-812),
design fees, permits, private utility scanning, labor, schedule, and a total.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

Open the **⚡ Quick Estimate** tab, enter chargers (e.g. 6 × DCFC 200kW + 5 × L2
Single 40A), pick the terrain, and click **Build full estimate**. Every derived
number stays editable on the detail tabs (Setup, Takeoff, Panel schedule,
Peripherals, Financials, Results).

## Excel outputs

- **⬇ Excel** (toolbar) — exports the current estimate as a formula-driven
  workbook: Summary, Cost Detail (contingency/tax/labor chain), Takeoff,
  Materials BOM, Panel Schedule, plan-set panel schedules (EV_MAIN 480V +
  EV_SUB 208V in permit-drawing format), Peripherals, Equipment, Assumptions —
  plus, for a priced project, Cost Buildup, Business Model, Utility Rates,
  Revenue, Carbon, Financing, Cashflow and Deal Structure.
- **`npm run template`** — regenerates [templates/RFC-Template.xlsx](templates/RFC-Template.xlsx),
  a standalone intake + estimate workbook that runs entirely on Excel formulas
  (no app needed) and is calibrated against this engine at generation time.

### Every formula cell carries its computed value

A formula cell in .xlsx stores two things: the formula (`<f>`) and its last
computed result (`<v>`). Excel recalculates on open and never misses the
cached value, so a workbook written without one looks perfect to a human —
and reads as blanks and zeroes to openpyxl, pandas, SheetJS and anything
downstream, because those read the cached value and nothing else. Stale
cached values are worse still: the file looks fully populated and the numbers
are from before the inputs existed.

So every workbook this app writes is recalculated before it is handed over
(`lib/recalc/`), and each formula keeps its formula *and* gains its result.
The workbook stays live — change an input in Excel and the model still
responds — and it reads correctly everywhere else. `fullCalcOnLoad` is still
set, but it is belt and braces: it moves Excel and nothing else.

`lib/recalc/` is a small Excel evaluator — parser, value model with Excel's
coercions, ~60 worksheet functions, implicit intersection, shared formulas
and defined names. It is held to Excel itself: the RFC/MSRP template was last
saved by Excel, so `excelOracle.test.ts` recalculates all 8,385 of its
formula cells and requires every one to match the value Excel computed.

Checking an export by hand:

```
npx -y tsx scripts/make-rfc-export.ts out.xlsx
python scripts/verify-cached-values.py out.xlsx
```

## Commercial layer (Commercial tab)

The estimator stops at **Total Cost**. The Commercial tab (`lib/proposal/`) turns
that cost into a **customer price** the way the CEO's EVSE Project Intake 2.9.0
and the Best Western project model do, without touching the engine:

- Markups on materials-class lines and on labour (after contingency), discounts
  off hardware, service and in-house work, permits and utility fees passed
  through at exactly cost, sales tax on construction materials as its own
  toggled row.
- Scope of supply per service line (we provide / by others / not required),
  margin by line and the construction margin build-up (materials, labour, PM).
- The Excel export gains `Cost Buildup` and `Business Model` sheets, live
  formulas like the rest, appended after `Assumptions`.

The section is optional on a project: bodies saved before it existed price
exactly as before until you click **Set up pricing** on the tab. New projects
start with the intake's defaults. `lib/proposal/__tests__` replays the Best
Western workbook (customer price $952,404, gross margin $379,485) to the cent.

### Equipment by SKU (Intake tab, SKU picker)

Each Quick Estimate charger line can carry a **price-book SKU** (Chargetronix
TP5 / CTX / HPC, Buy America, V2G, Nexus power cabinets). The SKU sets the
model the engine sizes with and prices the line at the book's list price;
**dispensers and accessories** are extra lines with no circuit of their own.
With the Commercial tab's *price-book* service basis, **extended warranty,
service and EVOLV network fees** derive from the book's service classes
(yearly warranty beyond the included years, in-warranty service every contract
year, $39.99 per port per month) and stay editable on Financials. The
**Intake** tab holds the CEO intake's Project fields: contact, property type,
access hours, delivery utility from the 74-utility roster, rate schedule from
the rate library, existing service, proposal date and validity. All of it
lands on the export's Intake sheet, with an equipment schedule block.
`lib/skus.ts` is the SKU layer; power cabinets size their AC feeders as
DCFC-category units (dispenser DC runs are not in the takeoff yet).

### Business model (Business model tab)

Downstream of the customer price, `lib/proposal/model.ts` runs the model the
CEO builds from the intake (the Best Western workbook's Utility_Rates,
Revenue, Carbon, Financing, Cashflow and Business_Model sheets):

- **Utilisation → energy**: DC and Level 2 positions from the equipment
  schedule, stall occupancy × charging hours (Intake tab hours/days) ×
  de-rated, tapered power; a 50 / 75 / 100 % ramp then 6 % growth.
- **Utility tariff**: the rate-library row for the Setup utility + Intake
  schedule (or manual rates from a bill), a time-of-use mix, and a demand
  subscription that **ramps with projected concurrency** (peak-to-average
  factor, safety margin, block size) — plus customer and demand charges, the
  saving against a full-nameplate subscription and the overage exposure it
  creates. Library rows carry their verification STATUS; anything not
  VERIFIED is flagged on the tab.
- **Revenue**: gross at the retail $/kWh less the utility bill, card fees and,
  after the service contract, warranty + service at the year-3 class rates
  and the network fee. Market cross-check against the state benchmark.
- **Carbon**: FCI capacity credit on DC nameplate, net of the aggregator,
  capped at 1.5× net capex year by year; L2 consumption credits.
- **Financing, cashflow, return**: PMT / amortisation, year-0 outlay, NPV,
  IRR, break-even year, and the cash position period by period during the
  loan term.
- **Deal structure**: our share of the carbon credit and of charging revenue
  against extra discounts and a capital contribution — both sides' NPV, IRR,
  payback, our return multiple, the break-even carbon share, and guard rails.

Every input is optional on a saved commercial section (defaults fill in), the
engine's Total Cost is untouched, and `lib/proposal/__tests__/model.test.ts`
replays the Best Western workbook — NPV $865,720, IRR 24.42 %, monthly
payment $19,489.58, break-even year 4 — to the cent. The export adds the six
matching sheets with live formulas (`lib/exportModel.ts`).

### Intake import, replacement sites, Rule 29 and the override register

- **Import a completed intake** (Intake tab): a filled EVSE Project Intake 2.x
  workbook becomes a new project — chargers and run distances, labour, D&E
  units, site-works quantities and rentals, pass-through fees, commercial and
  financing terms, revenue / tariff / carbon / deal assumptions, the existing
  installation, the Rule 29 block and the override register — with a report
  of what was mapped, skipped and needs a look. The estimator's own rates stay
  in force; the intake's unit costs do not travel. `lib/intake/xlsx.ts` is a
  small jszip-based cell reader (ExcelJS cannot open the CEO's template);
  `scripts/make-intake-sample.py` fills the template into the test fixture.
- **Existing site** tab (`lib/existing.ts`): project type, the retain /
  replace register, existing units, infrastructure, up to 36 months of
  metered history, connector coverage, the four capture-factor uplifts and
  the projected baseline, and the removal scope. Removal lines price into the
  Dump / Waste line; with the revenue basis set to historical actuals (twelve
  months minimum) the business model starts at the site's run rate and ramps
  the uplift in instead of using the greenfield build-up.
- **Utility interconnection** (Intake tab, `lib/interconnection.ts`): the
  regime resolved from the delivery utility (PG&E / SCE Rule 29, SDG&E Rule
  45, publicly owned utilities' own policies, Michigan), what the customer
  bears and where it already sits in the price, the exclusion wording for the
  proposal, the client's obligations, and checks (no Rule 29 allowance on a
  POU, retained service needs no application, a line-extension contribution
  wants a returned design). A Rules 15/16 contribution is its own
  pass-through row on the Cost Buildup.
- **Overrides** tab (`lib/overrides.ts`): the register. Cost-line bases, the
  site-works total and D&E replace the engine's figures inside Total Cost;
  crew days, the switchgear frame, the hardware cost and the retail price
  write through to their fields; kWh/day, the carbon credit, the loan
  payment, the delivered cost and the fixed utility cost force the business
  model. Every entry carries a reason and a source, and the export lists them.

### Intake workflow — the CEO's intake, filled from the estimate

The client does not fill the intake; we do. The app therefore has two ways
through one project (the switch sits in the header, the choice is remembered
per browser):

- **Intake** — the CEO's EVSE Project Intake 2.9.0 tab for tab, in its order
  and vocabulary: 1 · Project, Existing, 2 · Equipment, 3 · Electrical,
  4 · Construction, 5 · Commercial, 6 · Revenue, 7 · Carbon, 8 · Deal
  structure, 9 · Overrides, then the **Business model** output and **Version
  & handoff**. Every tab is a view onto the same project the estimator tabs
  edit — nothing is duplicated. Equipment is a capacity-then-SKU picker like
  the sheet's; equipment and electrical edits **rebuild the estimate live**
  (`lib/intake/rebuild.ts`). Fields the engine derives (crew days, site-works
  quantities, fees, rentals, D&E) show as *auto*; typing one pins it on
  `project.sticky` so rebuilds leave it alone, “→ auto” hands it back. The
  intake tab bar carries a completeness dot per section.
- **Estimator** — the engineering detail, unchanged: Quick Estimate, Setup,
  Takeoff, Panel schedule, Peripherals, Financials, Costs Internal, Results…

**⬇ Intake 2.9.0** (toolbar and the handoff tab) writes the project into a copy
of the blank template shipped in `public/intake/` — values only, through a
small jszip cell patcher (`lib/intake/xlsxWrite.ts`, the twin of the reader),
so the template's formulas, live checks, dropdowns, comments and defined
names survive and every green check recalculates on open. The cell map is
`lib/intake/cells.ts`; the plan (which cell gets which value) is
`lib/intake/plan.ts`; `fillIntake.ts` refuses a template whose version or
content hash the map was not written for. The estimator's construction and
engineering figures (cost-line bases before contingency and markup, D&E, the
frame, the branch breaker) land in the intake's **Overrides register** with
their reasons (`lib/intake/handoff.ts`), so the CEO's engine prices the job on
the estimator's numbers while the intake's own derivation stays visible beside
them. The handoff tab previews exactly those rows, lists the blue cells left
for a human (trench depth, DC dispenser runs, drawing-set counts…), and shows
how complete each section is. `lib/intake/__tests__/fillIntake.test.ts` fills
a Best Western-shaped project, re-imports the result and ties the carried
figures to the cent.

### Live estimate, durable hand edits, editable material prices

- **No Build step.** The Quick Estimate tab and the intake tabs rebuild the
  estimate as inputs change (`lib/intake/rebuild.ts`). A takeoff typed row by
  row on the Takeoff tab is never regenerated by those edits; the explicit
  “Build from these inputs” button is the only way to replace it
  (`canRebuild`).
- **Takeoff edits survive rebuilds.** Generated rows carry a `genKey`
  ("<load type> #n"); a cell edited on the Takeoff tab is recorded on
  `project.takeoffEdits` under that key and re-applied by every rebuild
  (`applyTakeoffEdits` in `lib/calc/quickstart.ts`). Removed rows stay
  removed, rows added by hand (`manual`) ride along, “edited → auto” hands a
  row back to the engine.
- **Conductor and conduit $/ft are editable per project** (Peripherals tab,
  and 3 · Electrical in the intake workflow): `setup.materialRates` overlays
  the shipped Rexel tables (`wireTableFor` / `conduitTableFor` in
  `lib/calc/tables.ts`); sizing never changes, only prices. Lump-sum quotes
  for a whole cost line still go on the Overrides tab.

### CEO-basis defaults (Sept 2026)

Three estimator defaults follow the CEO's intake rather than the RFC_V18
workbooks: crew day rate **$2,750** fully burdened (was $2,250), construction PM
as **15% of loaded labour** (was hours derived from 5% of valuation; PM hours
stay a manual field), and charger hardware at the **CEO price book's TP5 / CTX
list prices** (`HARDWARE_ALLOWANCE`, with `HARDWARE_ALLOWANCE_BASIS` naming the
SKU or interpolation behind each number). The reference tables in `lib/ref/`
(price book, service rates, utility rate library, utility roster, market
benchmarks) are generated from the template with `npm run refdata`.

## Commands

| Command            | What it does                                      |
| ------------------ | ------------------------------------------------- |
| `npm run dev`      | Dev server                                        |
| `npm test`         | Vitest suite (incl. real-workbook replay tests)   |
| `npm run build`    | Production build (`STATIC_EXPORT=1` → static site)|
| `npm run template` | Regenerate the standalone Excel template          |
| `npm run refdata`  | Regenerate `lib/ref/` from the CEO intake template (`templates/source/`) |
| `npx tsx scripts/replay.ts` | Replay the source RFC_V18 workbooks      |
| `npx tsx scripts/make-rfc-export.ts out.xlsx` | Write a filled RFC/MSRP calculator for inspection |
| `python scripts/verify-cached-values.py out.xlsx` | Check every formula cell carries a value that agrees with its inputs |

## Engine layout

- `lib/calc/` — the estimating engine: `sizing.ts` (NEC 310.16 ampacity +
  voltage drop), `panel.ts` (buses, transformer, gear suggestion), `chain.ts`
  (service chain), `autoplan.ts` (Quick Estimate expansion: terrain factors,
  ADA per CBC 11B-812, soft-cost rate card), `tables.ts` (wire/conduit/gear
  price tables).
- `lib/exportExcel.ts` — the Excel export; `lib/exportProposal.ts` adds the
  Cost Buildup and Business Model sheets, `lib/exportModel.ts` the Utility
  Rates, Revenue, Carbon, Financing, Cashflow and Deal Structure sheets.
- `lib/proposal/` — the commercial layer: `costBuildup.ts` (cost → list →
  customer price), `margin.ts` (scope of supply, margin by line, construction
  margin build-up), `model.ts` (tariff, revenue, carbon, financing, cashflow,
  deal structure), `finance.ts` (PMT / NPV / IRR with Excel's conventions),
  `defaults.ts` (intake 2.9.0 terms). Reads the engine's result, never
  modifies it.
- `lib/ref/` — generated reference data from the CEO's intake template
  (`scripts/import-intake-refdata.py`).
- `lib/skus.ts` — SKU → load type mapping, equipment schedule, warranty /
  service / EVOLV derivation from the price book's service classes, site
  capacity for the business model.
- `lib/intake/` — the intake importer (`xlsx.ts` reader, `importIntake.ts`
  mapping, a filled 2.9.0 fixture under `__fixtures__/`); `lib/existing.ts`,
  `lib/interconnection.ts`, `lib/overrides.ts` — the replacement-site scope,
  the Rule 29 block and the override register.
- `lib/recalc/` — the formula engine that gives every exported formula cell
  its computed value: `parse.ts` (tokenizer + parser), `values.ts` (Excel's
  value model and coercions), `functions.ts` (the worksheet functions),
  `evaluate.ts` (evaluation, implicit intersection, cycles), `grid.ts`
  (workbook → cells), `verify.ts` (audit a finished file).
- `scripts/make-template.ts` — the standalone template generator.

Tests replay two real projects (VN Village L-11101, Boatman I-271839) and must
tie to the source workbooks **to the penny** — run them before trusting any
engine change.

## Hosting

The app is fully client-side (projects live in the browser's localStorage), so
it deploys anywhere static files do:

- **Vercel** (easiest): import the GitHub repo at vercel.com/new — zero config.
- **GitHub Pages**: enable *Settings → Pages → Source: GitHub Actions*; the
  included [deploy-pages workflow](.github/workflows/deploy-pages.yml) publishes
  on every push to `main`. (Free plans require the repo to be public.)

CI ([ci.yml](.github/workflows/ci.yml)) runs typecheck, tests, and a build on
every push and pull request.

## Caveats

- Prices (Rexel wire list, gear catalog, CEO price-book hardware list prices,
  soft-cost rate card) are dated snapshots — verify before quoting. The
  margin view's cost-basis percentages are the Best Western model's
  assumptions until real costs replace them.
- Projects are stored in localStorage per browser. Use Export/Import (JSON) to
  move or back up a project.
