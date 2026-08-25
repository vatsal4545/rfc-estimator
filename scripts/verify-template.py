"""Evaluate RFC-Template.xlsx with the `formulas` package (pip install formulas)
and check the install-method / per-level-ADA / gear-override / breaker-override
behavior end to end. Run after `npm run template`:
    python3 scripts/verify-template.py

Cell map (keep in sync with scripts/make-template.ts anchors, N_CH = 12):
  Intake: chargers B23:B34, InstallMethod B46, RouteFt B47, TrenchFt B48,
          wire runs 53-64 (I ovr / J used breaker), feeders 65-67
  Panel:  SG F21 (D21 ovr) price F22, 208V panel F40 (D40 ovr),
          TX F47 (D47 ovr) price F48, primary breaker F50, branch rows 54-65
  ADA:    per-level rows 4-5, site total 6, override row 7, used row 8, cost B10
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
tc = g("ESTIMATE!B41")
print(f"INFO TotalCost (Trenched): {tc}")
if not (isinstance(tc, (int, float)) and tc > 100000):
    failures.append("TotalCost sane")

# ---- Surface EMT ------------------------------------------------------------
g = run({"'[RFC-Template.xlsx]INTAKE'!B46": "Surface EMT"}, "surface")
check("TrenchFt = 0 (Surface EMT)", g("INTAKE!B48"), 0)
check("Trench line $0", g("ESTIMATE!B9"), 0)
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
check("SG price re-derives (3000A = $65,000)", g("PANEL!F22"), 65000)

# ---- Per-line breaker override (website Takeoff parity) ----------------------
g = run({"'[RFC-Template.xlsx]INTAKE'!I53": 400}, "breaker-override")
check("Breaker override wins on the line", g("INTAKE!J53"), 400)
check("Branch-breaker table picks up the override", g("PANEL!B54"), 400)

# ---- ADA quantity override (website Peripherals parity) ----------------------
g = run({"'[RFC-Template.xlsx]ADA'!C7": 3}, "ada-override")
check("ADA van override wins", g("ADA!C8"), 3)
check("ADA cost uses overridden count", g("ADA!B10"), 3 * 6500 + 2 * 4900 + 5200)

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
