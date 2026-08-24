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
  EV_SUB 208V in permit-drawing format), Peripherals, Equipment, Assumptions.
- **`npm run template`** — regenerates [templates/RFC-Template.xlsx](templates/RFC-Template.xlsx),
  a standalone intake + estimate workbook that runs entirely on Excel formulas
  (no app needed) and is calibrated against this engine at generation time.

## Commands

| Command            | What it does                                      |
| ------------------ | ------------------------------------------------- |
| `npm run dev`      | Dev server                                        |
| `npm test`         | Vitest suite (incl. real-workbook replay tests)   |
| `npm run build`    | Production build (`STATIC_EXPORT=1` → static site)|
| `npm run template` | Regenerate the standalone Excel template          |
| `npx tsx scripts/replay.ts` | Replay the source RFC_V18 workbooks      |

## Engine layout

- `lib/calc/` — the estimating engine: `sizing.ts` (NEC 310.16 ampacity +
  voltage drop), `panel.ts` (buses, transformer, gear suggestion), `chain.ts`
  (service chain), `autoplan.ts` (Quick Estimate expansion: terrain factors,
  ADA per CBC 11B-812, soft-cost rate card), `tables.ts` (wire/conduit/gear
  price tables).
- `lib/exportExcel.ts` — the Excel export.
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

- Prices (Rexel wire list, gear catalog, hardware allowances, soft-cost rate
  card) are dated snapshots — verify before quoting.
- Projects are stored in localStorage per browser. Use Export/Import (JSON) to
  move or back up a project.
