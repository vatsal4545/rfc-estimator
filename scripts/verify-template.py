"""Evaluate RFC-Template.xlsx with the `formulas` package (pip install formulas)
and check the install-method / per-level-ADA / gear-override behavior end to
end. Run after `npm run template`:  python3 scripts/verify-template.py"""
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
check("TrenchFt default (both legs)", g("INTAKE!B42"), 335)
check("RouteFt", g("INTAKE!B41"), 335)
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
check("Panel SG suggested", g("PANEL!F15"), 2500)
check("Panel 208V suggested", g("PANEL!F28"), 250)
check("TX suggested", g("PANEL!F35"), 112.5)
tc = g("ESTIMATE!B41")
print(f"INFO TotalCost (Trenched): {tc}")
if not (isinstance(tc, (int, float)) and tc > 100000):
    failures.append("TotalCost sane")

# ---- Surface EMT ------------------------------------------------------------
g = run({"'[RFC-Template.xlsx]INTAKE'!B40": "Surface EMT"}, "surface")
check("TrenchFt = 0 (Surface EMT)", g("INTAKE!B42"), 0)
check("Trench line $0", g("ESTIMATE!B9"), 0)
check("GPR $0 when nothing digs", g("ESTIMATE!B15"), 0)
check("Spoils $0", g("ESTIMATE!B14"), 0)
emt = g("ESTIMATE!B10")
# racks: ceil(335/10)+1 = 35 -> 35*28 = 980; straps: charger conduit ft
# 6 runs @ (100..137.5 avg) + 5 @ (100..130): D*F rows 47..52 plus service rows.
print(f"INFO EMT supports line: {emt}")
if not (isinstance(emt, (int, float)) and emt > 980):
    failures.append("EMT supports > rack cost alone")
tc_emt = g("ESTIMATE!B41")
print(f"INFO TotalCost (Surface EMT): {tc_emt}")
if not (isinstance(tc_emt, (int, float)) and tc_emt < tc):
    failures.append("Surface EMT cheaper than trenched")

# ---- Hybrid -----------------------------------------------------------------
g = run({"'[RFC-Template.xlsx]INTAKE'!B40": "Hybrid"}, "hybrid")
check("TrenchFt = service legs (Hybrid)", g("INTAKE!B42"), 55)
emt_h = g("ESTIMATE!B10")
print(f"INFO EMT supports line (hybrid): {emt_h}")
if not (isinstance(emt_h, (int, float)) and 0 < emt_h < emt):
    failures.append("Hybrid supports positive but below full-surface")

# ---- Hybrid on a DCFC-only site: no step-down legs to bury -------------------
g = run(
    {
        "'[RFC-Template.xlsx]INTAKE'!B40": "Hybrid",
        "'[RFC-Template.xlsx]INTAKE'!B24": 0,  # zero the L2 line
    },
    "hybrid-dcfc-only",
)
check("Hybrid trench, DCFC-only = utility leg only", g("INTAKE!B42"), 25)

# ---- Gear override cascade ---------------------------------------------------
g = run({"'[RFC-Template.xlsx]PANEL'!D35": 300}, "tx-override")
check("TX override wins", g("PANEL!F35"), 300)
check("TX price re-derives (300 kVA = $10,493)", g("PANEL!F36"), 10493)
# primary FLA of 300 kVA at 480V = 360.84A -> x1.25 = 451 -> next std breaker 500
check("Primary breaker from override", g("PANEL!F38"), 500)

g = run({"'[RFC-Template.xlsx]PANEL'!D15": 3000}, "sg-override")
check("SG override wins", g("PANEL!F15"), 3000)
check("SG price re-derives (3000A = $65,000)", g("PANEL!F16"), 65000)

print()
if failures:
    print(f"FAILURES: {failures}")
    sys.exit(1)
print("ALL TEMPLATE CHECKS PASS")
