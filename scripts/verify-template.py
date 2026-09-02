"""Evaluate RFC-Template.xlsx with the `formulas` package (pip install formulas)
and check the install-method / per-level-ADA / gear-override / breaker-override
behavior end to end. Run after `npm run template`:
    python3 scripts/verify-template.py

Cell map (keep in sync with scripts/make-template.ts anchors, N_CH = 12):
  Intake:  chargers B23:B34, InstallMethod B46, RouteFt B47, TrenchFt B48,
           wire-line defaults 53-64 (I ovr / J used breaker, H = Takeoff line $),
           feeders 65-67, WireTotal H68
  Takeoff: one row per charger, rows 5-28 (D size, E mat, F runs, H one-way ft,
           J wire $), total J29
  Panel:   SG F21 (D21 ovr) price F22, 208V panel F40 (D40 ovr),
           TX F47 (D47 ovr) price F48, primary breaker F50, branch rows 54-65
  ADA:     per-level rows 4-5, site total 6, override row 7, used row 8, cost B10
  Peripherals: bollards B6, signage subtotal D10, concrete yd B14,
           civil subtotal D25, asphalt stall paving D29
  RateCard scalars: col R rows 10+, in scalars[] order (ConcreteRate R23,
           AsphaltRate R25, BollardAtGear R29 — rows SHIFT when scalars[] changes)
"""
import os
import sys

import formulas

PATH = os.path.join(os.path.dirname(__file__), "..", "templates", "RFC-Template.xlsx")

xl = formulas.ExcelModel().loads(PATH).finish()

failures = []


def run(inputs=None, label=""):
    sol = xl.calculate(inputs=inputs or {})
    def get(ref):
        key = f"'[RFC-Template.xlsx]{ref.split('!')[0]}'!{ref.split('!')[1]}"
        v = sol[key].value
        try:
            return v[0][0]
        except Exception:
            return v
    return get


def check(label, actual, expect, tol=0.01):
    try:
        ok = abs(float(actual) - float(expect)) <= tol
    except Exception:
        ok = actual == expect
    print(f"{'PASS' if ok else 'FAIL'} {label}: {actual!r} (expect {expect!r})")
    if not ok:
        failures.append(label)


# ---- default intake: Trenched, 6x DCFC 200 + 5x L2 40A ---------------------
g = run(label="default")
check("TrenchFt default (both legs)", g("INTAKE!B48"), 335)
check("RouteFt", g("INTAKE!B47"), 335)
check("EMT supports line = 0 when Trenched", g("ESTIMATE!B10"), 0)
check("ADA L2 van (5 L2)", g("ADA!C4"), 1)
check("ADA L2 std", g("ADA!D4"), 1)
check("ADA DCFC van (6 DCFC)", g("ADA!C5"), 1)
check("ADA DCFC std", g("ADA!D5"), 1)
check("ADA site total van", g("ADA!C6"), 2)
check("ADA site total std", g("ADA!D6"), 2)
check("ADA site total amb", g("ADA!E6"), 0)
# 2 van * 6500 + 2 std * 4900 + ramp 5200 (flat lot, factor 1)
check("ADA cost", g("ADA!B10"), 2 * 6500 + 2 * 4900 + 5200)
check("Panel SG suggested", g("PANEL!F21"), 2500)
check("Panel 208V suggested", g("PANEL!F40"), 250)
check("TX suggested", g("PANEL!F47"), 112.5)
check("Breaker used = model rating (DCFC 200kW → 350A)", g("INTAKE!J53"), 350)
check("Branch-breaker table reads used breaker", g("PANEL!B54"), 350)

# Peripherals sheet: engine-mirror quantities for the default site
# (6 DCFC + 5 L2, trenched, flat).
check("Bollards = 2/charger + 4 gear + 3 step-down", g("PERIPHERALS!B6"), 29)
check("Signage subtotal (signs+posts+bollards+striping)", g("PERIPHERALS!D10"), 6478.80)
# Pad volumes 6*0.75 + 5*0.35 + 1.75 + 0.5 + 29*0.08 = 10.82 -> 11 yd ordered.
check("Concrete order rounds up to whole yards", g("PERIPHERALS!B14"), 11)
check("No short-load fee at 11 yd", g("PERIPHERALS!D15"), 0)
check("Civil subtotal mirrors engine concreteImprovements", g("PERIPHERALS!D25"), 10458.48)
check("Asphalt stall paving 16 stalls x 162 SF x $5", g("PERIPHERALS!D29"), 12960)
check("Estimate B11 = Peripherals civil", g("ESTIMATE!B11"), 10458.48)
check("Estimate B12 = Peripherals signage", g("ESTIMATE!B12"), 6478.80)
check("Estimate B9 = trench cut + stall paving", g("ESTIMATE!B9"), 335 * 40.81 + 12960)

# Takeoff sheet: one row per charger, distance ladder per level.
check("Takeoff row 1 = first DCFC at first-run ft", g("TAKEOFF!H5"), 100)
check("Takeoff row 2 steps by StepFt", g("TAKEOFF!H6"), 115)
check("Takeoff DCFC #6 at 100+15*5", g("TAKEOFF!H10"), 175)
check("Takeoff first L2 restarts its own ladder", g("TAKEOFF!H11"), 100)
check("Takeoff L2 #5 at 160 ft", g("TAKEOFF!H15"), 160)
check("Takeoff row 12 inactive (11 chargers)", g("TAKEOFF!H16"), 0)
check("Takeoff row label", g("TAKEOFF!B5"), "DCFC 200kW #1")
tk_total = g("TAKEOFF!J29")
line1 = sum(g(f"TAKEOFF!J{r}") for r in range(5, 11))
check("Intake line-1 Wire $ reads its Takeoff rows", g("INTAKE!H53"), line1)
feeders = sum(g(f"INTAKE!H{r}") for r in range(65, 68))
check("WireTotal = Takeoff total + feeders", g("INTAKE!H68"), tk_total + feeders)
tc = g("ESTIMATE!B41")
print(f"INFO TotalCost (Trenched): {tc}")
if not (isinstance(tc, (int, float)) and tc > 100000):
    failures.append("TotalCost sane")
j5_base = g("TAKEOFF!J5")

# ---- Costs Internal rows tie to the app engine (default site) -----------------
# App-engine golden values for 6x DCFC200 + 5x L2-40, trenched, flat (from
# computeEstimate → costs.lines). Wires (D3) and Equipment (D13) are budgetary
# allowances (calibrated), so they get a tolerance; every other row must tie
# to the cent — the user compares these sheets side by side.
check("CI Bollards+Signage = app", g("COSTS INTERNAL!D6"), 6478.80)
check("CI Asphalt+Paving = app", g("COSTS INTERNAL!D7"), 26631.35)
check("CI Concrete Improvements = app", g("COSTS INTERNAL!D8"), 10458.48)
check("CI ADA = app", g("COSTS INTERNAL!D9"), 28000)
check("CI Dump/Waste = app", g("COSTS INTERNAL!D10"), 1675)
check("CI Permits = app", g("COSTS INTERNAL!D11"), 860)
check("CI Utility = app 7500 (GPR lives in the Wires row)", g("COSTS INTERNAL!D12"), 7500)
check("CI Wires row = B7+B10+B15 (incl. GPR + site data box)",
      g("COSTS INTERNAL!D3"), g("ESTIMATE!B7") + g("ESTIMATE!B10") + g("ESTIMATE!B15"))
check("CI Wires ~ app 39901 (calibrated allowance, ±2%)", g("COSTS INTERNAL!D3"), 39901, tol=39901 * 0.02)
check("CI Equipment ~ app 13209 (calibrated, ±2%)", g("COSTS INTERNAL!D13"), 13209, tol=13209 * 0.02)

# ---- Editable civil rates flow through (RateCard yellow scalars) --------------
g = run({"'[RFC-Template.xlsx]RATECARD'!R23": 193.54}, "concrete-rate-edit")
check("Concrete $/yd edit reprices the pour (11 yd x 193.54)", g("PERIPHERALS!D14"), 11 * 193.54)
g = run({"'[RFC-Template.xlsx]RATECARD'!R25": 8}, "asphalt-rate-edit")
check("Asphalt $/SF edit reprices stall paving", g("PERIPHERALS!D29"), 2592 * 8)
g = run({"'[RFC-Template.xlsx]RATECARD'!R29": 5}, "gear-bollards-edit")
check("Switchgear bollards 4 -> 5 bumps the count", g("PERIPHERALS!B6"), 30)

# ---- Surface EMT ------------------------------------------------------------
g = run({"'[RFC-Template.xlsx]INTAKE'!B46": "Surface EMT"}, "surface")
check("TrenchFt = 0 (Surface EMT)", g("INTAKE!B48"), 0)
check("Trench line $0", g("ESTIMATE!B9"), 0)
check("No concrete pour on surface EMT", g("PERIPHERALS!B14"), 0)
check("No stall paving on surface EMT", g("PERIPHERALS!D29"), 0)
check("GPR $0 when nothing digs", g("ESTIMATE!B15"), 0)
check("Spoils $0", g("ESTIMATE!B14"), 0)
emt = g("ESTIMATE!B10")
print(f"INFO EMT supports line: {emt}")
if not (isinstance(emt, (int, float)) and emt > 980):
    failures.append("EMT supports > rack cost alone")
tc_emt = g("ESTIMATE!B41")
print(f"INFO TotalCost (Surface EMT): {tc_emt}")
if not (isinstance(tc_emt, (int, float)) and tc_emt < tc):
    failures.append("Surface EMT cheaper than trenched")

# ---- Hybrid -----------------------------------------------------------------
g = run({"'[RFC-Template.xlsx]INTAKE'!B46": "Hybrid"}, "hybrid")
check("TrenchFt = service legs (Hybrid)", g("INTAKE!B48"), 55)
emt_h = g("ESTIMATE!B10")
print(f"INFO EMT supports line (hybrid): {emt_h}")
if not (isinstance(emt_h, (int, float)) and 0 < emt_h < emt):
    failures.append("Hybrid supports positive but below full-surface")

# ---- Hybrid on a DCFC-only site: no step-down legs to bury -------------------
g = run(
    {
        "'[RFC-Template.xlsx]INTAKE'!B46": "Hybrid",
        "'[RFC-Template.xlsx]INTAKE'!B24": 0,  # zero the L2 line
    },
    "hybrid-dcfc-only",
)
check("Hybrid trench, DCFC-only = utility leg only", g("INTAKE!B48"), 25)

# ---- Gear override cascade ---------------------------------------------------
g = run({"'[RFC-Template.xlsx]PANEL'!D47": 300}, "tx-override")
check("TX override wins", g("PANEL!F47"), 300)
check("TX price re-derives (300 kVA = $10,493)", g("PANEL!F48"), 10493)
# primary FLA of 300 kVA at 480V = 360.84A -> x1.25 = 451 -> next std breaker 500
check("Primary breaker from override", g("PANEL!F50"), 500)

g = run({"'[RFC-Template.xlsx]PANEL'!D21": 3000}, "sg-override")
check("SG override wins", g("PANEL!F21"), 3000)
check("SG price re-derives (3000A = $58,842)", g("PANEL!F22"), 58842)

# ---- Per-line breaker override (website Takeoff parity) ----------------------
g = run({"'[RFC-Template.xlsx]INTAKE'!I53": 400}, "breaker-override")
check("Breaker override wins on the line", g("INTAKE!J53"), 400)
check("Branch-breaker table picks up the override", g("PANEL!B54"), 400)

# ---- ADA quantity override (website Peripherals parity) ----------------------
g = run({"'[RFC-Template.xlsx]ADA'!C7": 3}, "ada-override")
check("ADA van override wins", g("ADA!C8"), 3)
check("ADA cost uses overridden count", g("ADA!B10"), 3 * 6500 + 2 * 4900 + 5200)

# ---- Per-charger wire length / size edits reprice live (website parity) ------
g = run({"'[RFC-Template.xlsx]TAKEOFF'!H5": 300}, "takeoff-ft-override")
check("Tripling one charger's ft triples its wire $", g("TAKEOFF!J5"), 3 * j5_base)
tc_ft = g("ESTIMATE!B41")
if not (isinstance(tc_ft, (int, float)) and tc_ft > tc):
    failures.append("Takeoff ft override raises TotalCost")
print(f"INFO TotalCost after 300 ft on charger #1: {tc_ft} (was {tc})")

g = run({"'[RFC-Template.xlsx]TAKEOFF'!D5": "600 kcmil"}, "takeoff-size-override")
check("Per-charger wire-size change repriced at $16.57/ft Cu", g("TAKEOFF!I5"), 16.57382)

# ---- 12-line charger capacity ------------------------------------------------
g = run(
    {
        "'[RFC-Template.xlsx]INTAKE'!A25": "L2 Dual 40A",
        "'[RFC-Template.xlsx]INTAKE'!B25": 2,
    },
    "extra-line",
)
check("Third charger line counts (NTotal 11 → 13)", g("INTAKE!B36"), 13)
check("L2 count includes new line", g("INTAKE!B38"), 7)

print()
if failures:
    print(f"FAILURES: {failures}")
    sys.exit(1)
print("ALL TEMPLATE CHECKS PASS")
