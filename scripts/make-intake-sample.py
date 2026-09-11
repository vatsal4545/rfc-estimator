#!/usr/bin/env python3
"""Fill the CEO's EVSE Project Intake template (templates/source) with a
replacement-site scenario and save it as the importer's test fixture:

    python3 scripts/make-intake-sample.py
    → lib/intake/__fixtures__/intake-sample-3.1.0.xlsx

Best Western-shaped: 4 × TP5-360 dual + 2 × CTX-C40 dual on SCE, replacing a
failing 2018 installation with twelve months of metered history, a Rule 29
block, quoted distribution gear, site-works quantities and three overrides.
Every value here is asserted by lib/intake/__tests__/importIntake.test.ts.
"""
import datetime as dt
import os

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "templates", "source", "EVSE_Project_Intake_TEMPLATE_3.1.0.xlsx")
OUT = os.path.join(ROOT, "lib", "intake", "__fixtures__", "intake-sample-3.1.0.xlsx")

wb = openpyxl.load_workbook(SRC)


def put(sheet, cells):
    ws = wb[sheet]
    for ref, value in cells.items():
        ws[ref] = value


put("Version", {"B10": "Rev A", "B11": dt.date(2026, 9, 2), "B12": "Test CPM", "B13": "BW-TEST-001", "B14": "Fixture for the importer test"})

put("Project", {
    "B5": "Best Western Hawthorne", "B6": "Mohammad Noorali", "B7": "General Manager", "B8": "gm@example.com", "B9": "310-555-0100",
    "B12": "Best Western Hawthorne", "B13": "15000 Hawthorn Blvd", "B14": "Hawthorne, CA 90260", "B15": "Los Angeles", "B16": "Hotel",
    "B21": "Public 24/7", "B22": 24, "B23": 365,
    "B26": "SCE — Southern California Edison", "B27": "TOU-GS-2", "B28": 800, "B29": 480, "B30": "Yes",
    "B33": dt.date(2026, 9, 1), "B34": 30, "B35": "Vatsal Patel", "B36": "Account Owner", "B46": "Clean Power Alliance",
})

put("Equipment", {
    "B7": "360 kW DC", "C7": "TP5-360-480-2-300", "I7": 4,
    "B8": "Level 2 AC", "C8": "CTX-C40-240-2", "I8": 2,
    "B27": "Installation of (4) 360 kW dual-port DC fast chargers and (2) dual Level 2 units — 12 charging positions",
})

elec = {"B5": "Cu", "B6": "PVC", "B7": "Asphalt", "B8": 24, "F5": 40}
for i, dist in enumerate([80, 95, 110, 125]):
    r = 12 + i
    elec.update({f"B{r}": 1, f"D{r}": dist, f"I{r}": "300 kcmil", f"J{r}": 2, f"O{r}": '3"'})
for i, dist in enumerate([60, 75]):
    r = 151 + i
    elec.update({f"B{r}": 2, f"C{r}": 1, f"D{r}": 208, f"E{r}": 40, f"H{r}": dist, f"I{r}": "8 AWG"})
elec.update({
    "B30": "Existing MSB", "B31": 40, "B32": 120, "B33": 200, "B34": "No", "B36": 1, "B42": 3200,
    "B51": "Added load to existing service", "B52": "Underground", "B53": 150, "B54": "No", "B56": 3500,
    "B57": "Unknown — design not yet submitted", "B60": "Unknown", "B62": "Yes", "B63": "Yes", "B64": "Yes", "B65": "Yes",
    "B119": "Utility — EV infrastructure rule",
    "A130": "EVSE disconnects", "B130": "EVSE disconnect", "C130": 4, "D130": 480, "E130": 3, "F130": 600, "G130": "MSB",
    "H130": "TP5 cabinets", "I130": "Pad", "J130": "Zero Impact Energy", "K130": "Vendor quote", "L130": 12000,
})
put("Electrical", elec)

put("Construction", {
    "B5": 34, "B6": 2750, "B7": 0.1, "B8": 0.2, "B10": 0.15,
    "B14": 6, "B17": 400, "B19": 2, "B20": 1, "B21": 12, "B25": 1, "B26": 1, "B27": 1,
    "B32": 3, "B33": 3, "B34": 35,
    "B40": 1, "D40": 30, "B41": 1, "D41": 4, "B50": 1, "D50": 10,
    "B72": 0.2,
    "B81": 1, "B82": 1, "B83": 1, "B84": 0, "B85": 1, "D85": 850,
})

put("Commercial", {
    "B5": 0.07, "B6": 0.07, "B7": 0, "B8": 0.07, "B9": 0.0725, "B12": 5, "B13": 2, "B14": 39.99,
    "B19": "Yes", "B20": "De Lage Landen", "B21": 0.0839, "B22": 5, "B23": 12, "B24": 0, "B25": dt.date(2026, 10, 1), "B28": 10, "B29": 0.0839,
})

put("Revenue", {
    "B5": 0.65, "B8": 0.03, "B9": "No", "B13": 0.2, "B14": 0.25, "B15": 0.98, "B16": 0.7, "B19": 0.5, "B20": 0.75, "B21": 1, "B22": 0.06,
    "B36": "TOU-EV-9", "B37": "Secondary", "B38": 0.3, "B39": 0.55, "B40": 0.15, "B45": "California",
    "B51": "Ramped to projected demand", "B52": 4, "B53": 0.2, "B54": "Yes",
    "B59": "Historical actuals — replacement site",
    "B82": "SCE TOU-EV rate fact sheet, July 2025", "B83": "No", "B84": "VP · 2026-09-01",
    "B91": 0.28, "B92": 701.42, "B93": 0,
})

put("Carbon", {
    "B5": "Yes", "B6": "Yes", "B7": "No", "B8": "Registered aggregator LLC", "B9": 0.05, "B10": 71.6667, "B11": 10,
    "B17": 0.0045, "B21": 1.5, "B22": 0, "B25": "No", "B26": "Fast Charge California", "B27": "Does not qualify",
})

put("Deal_Structure", {
    "B9": "Carbon share test", "B10": 0.5, "B11": 0.1, "B12": "Net charging profit", "B13": 10,
    "B16": 0.05, "B17": 0, "B18": 0, "B19": 100000, "B22": 0, "B23": 2, "B24": 150000,
    "B30": "We provide", "B31": "We provide", "B32": "We provide", "B33": "We provide", "B34": "By others", "B35": "We provide", "B36": "We provide",
    "B41": "Whole project",
})

ex = {"B5": "Rip and replace — reuse infrastructure", "B6": 7, "B7": "End of life and unreliable", "B8": "Client"}
for r, d in zip(range(13, 25), ["RETAIN", "RETAIN", "REPLACE", "RETAIN", "RETAIN", "REPLACE", "REPLACE", "REPLACE", "PARTIAL", "RETAIN", "REPLACE", "REPLACE"]):
    ex[f"B{r}"] = d
ex.update({"A33": "ABB Terra 54", "B33": 50, "C33": 2, "D33": "CCS1 / CHAdeMO", "E33": 2, "F33": 2018, "G33": "Working",
           "A34": "ChargePoint Express 250", "B34": 62.5, "C34": 1, "D34": "CCS1", "E34": 2, "F34": 2019, "G34": "Failed"})
ex.update({"B50": 800, "B51": 480, "B52": 200, "B53": 800, "B54": "250 KCMIL Cu", "B55": 120, "B56": "2-1/2 in PVC", "B57": "TOU-GS-2", "B58": "No"})
KWH = [9800, 10200, 9900, 11500, 12000, 11800, 12500, 13100, 12800, 13400, 13900, 14100]
PORTS = [4, 4, 3, 3, 3, 4, 3, 3, 3, 4, 4, 4]
months = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]
for i, (m, k, p) in enumerate(zip(months, KWH, PORTS)):
    r = 67 + i
    ex.update({f"A{r}": m, f"B{r}": k, f"C{r}": round(k * 0.55, 2), f"D{r}": round(k / 32), f"E{r}": round(k * 0.28, 2), f"F{r}": p})
ex["G69"] = "Two units down all month"
ex.update({"B131": "No", "C131": "Yes", "D131": 0.55, "B132": "Yes", "C132": "Yes", "D132": 0.40,
           "B133": "Yes", "C133": "No", "D133": 0.03, "B134": "No", "C134": "Yes", "D134": 0.02})
ex.update({"B174": 4, "B175": 4, "B176": 8, "B177": 4, "B178": 2, "B179": "Yes", "B180": "No", "B181": "No", "B182": 5})
put("Existing", ex)

put("Overrides", {"B10": 150000, "D10": "Vendor quote for the switchboard", "B19": 3200, "D19": "Engineer's single line",
                  "B22": 1400, "D22": "Traffic study, Aug 2026", "B26": 0.62, "D26": "Pricing committee"})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
wb.save(OUT)
print("wrote", OUT, os.path.getsize(OUT), "bytes")
