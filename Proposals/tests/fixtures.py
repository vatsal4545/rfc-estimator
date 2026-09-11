"""Synthetic workbooks for cases the two real files do not cover.

The v16 sample has exactly one active tier and no Level 2, so it exercises none
of the weighting rules. A three-tier mix with live Level 2 is where sum,
weighted_by_ports, weighted_by_chargers and weighted_by_kwh actually differ from
each other, and where a naive mean would silently invent capacity.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import openpyxl

UCRC = "Updated Chargers Revenue Calcul"

# row -> (label, per-column value). Column order is L2, 60, 120, 160, 180, 240, 360.
# Three tiers are live: 2 x 120 kW, 1 x 60 kW, 3 x 180 kW. Level 2 has 8 ports.
THREE_TIER = {
    #             L2      60kW    120kW   160kW   180kW   240kW   360kW
    5:  ("Chargers ",                     [8,     1,      2,      0,      3,      0,      0]),
    6:  ("EV Stall Quantity (Based on # of ports)",
                                          [8,     1,      4,      0,      3,      0,      0]),
    7:  ("Max hours of operation of parking",
                                          [12,    12,     12,     12,     12,     12,     12]),
    8:  ("Assumed Stall Occupancy %",     [0.20,  0.30,   0.50,   0.20,   0.40,   0.20,   0.20]),
    9:  ("Number of stalls used per day", [1.6,   0.3,    2.0,    0,      1.2,    0,      0]),
    10: ("Assumed Charging Hourly % per stall per day",
                                          [0.50,  0.50,   0.50,   0.50,   0.50,   0.50,   0.50]),
    11: ("Number of hours usage per stall per day",
                                          [6,     6,      6,      6,      6,      6,      6]),
    12: ("Actual Charger Rating",         [7.056, 58.8,   117.6,  156.8,  176.4,  235.2,  352.8]),
    13: ("Retail Revenue per kWHr",       [0.55,  0.65,   0.70,   0.65,   0.75,   0.65,   0.65]),
    14: ("Total Revenue per day",         [37.25, 68.83,  588.0,  0,      476.28, 0,      0]),
    15: ("Per 30 day Cycle",              [1117.5, 2064.9, 17640.0, 0,     14288.4, 0,     0]),
    16: ("Total kWhr dispensed per day",  [67.7,  105.8,  840.0,  0,      635.0,  0,      0]),
    17: ("EV Utility Rate average per kWHr",
                                          [0.40,  0.40,   0.40,   0.40,   0.40,   0.40,   0.40]),
    18: ("Net Profit per Month",          [304.5, 795.3,  7560.0, 0,      6668.4, 0,      0]),
    19: ("Total Profit per Year",         [3654.0, 9543.6, 90720.0, 0,     80020.8, 0,     0]),
}

LOW_COLS = ["B", "C", "D", "E", "F", "G", "H"]


def make_three_tier_workbook(source: Path, dest: Path) -> Path:
    """Copy the real v16 file and overwrite the Standard-Low block.

    Built from the real workbook rather than from scratch so the fingerprint,
    defined names, DLL schedule and Cashflow sheet stay intact - the fixture
    tests aggregation, not workbook construction.
    """
    shutil.copyfile(source, dest)
    wb = openpyxl.load_workbook(dest, data_only=True)
    ws = wb[UCRC]

    for row, (label, values) in THREE_TIER.items():
        ws[f"A{row}"] = label
        for col, value in zip(LOW_COLS, values):
            ws[f"{col}{row}"] = value

    # Standard-Low totals column, rows 24-26.
    yearly = sum(THREE_TIER[19][1])
    ws["J24"] = yearly
    ws["J25"] = yearly * 3
    ws["J26"] = yearly * 5

    # Keep the INPUT SHEET summary consistent with the tier mix, so the
    # equipment-derived rating can be cross-checked against the aggregate.
    inp = wb["INPUT SHEET"]
    chargers = THREE_TIER[5][1]
    ports = THREE_TIER[6][1]
    ratings = [7.2, 60, 120, 160, 180, 240, 360]
    for col, qty, port, rating in zip(["N", "O", "P", "Q", "R", "S", "T"],
                                      chargers, ports, ratings):
        inp[f"{col}8"] = qty
        inp[f"{col}9"] = port
        inp[f"{col}10"] = rating
        inp[f"{col}11"] = 0.98

    wb.save(dest)
    wb.close()
    return dest


def expected_three_tier() -> dict[str, float]:
    """Hand-computed aggregates for the fixture above.

    Active tiers are 60 kW (1 charger, 1 port), 120 kW (2 chargers, 4 ports)
    and 180 kW (3 chargers, 3 ports).
    """
    chargers = {"60": 1, "120": 2, "180": 3}
    ports = {"60": 1, "120": 4, "180": 3}
    kwh = {"60": 105.8, "120": 840.0, "180": 635.0}
    rating = {"60": 58.8, "120": 117.6, "180": 176.4}
    occupancy = {"60": 0.30, "120": 0.50, "180": 0.40}
    rate = {"60": 0.65, "120": 0.70, "180": 0.75}

    total_chargers = sum(chargers.values())      # 6
    total_ports = sum(ports.values())            # 8
    total_kwh = sum(kwh.values())                # 1580.8

    return {
        "chargers": float(total_chargers),
        "stall_qty": float(total_ports),
        # charger-weighted, NOT a plain mean of the three ratings
        "charger_rating_kw": sum(chargers[k] * rating[k] for k in chargers) / total_chargers,
        "stall_occupancy": sum(ports[k] * occupancy[k] for k in ports) / total_ports,
        "retail_rate": sum(kwh[k] * rate[k] for k in kwh) / total_kwh,
        "profit_per_year": 9543.6 + 90720.0 + 80020.8,
        "kwh_per_day": total_kwh,
        "max_hours": 12.0,
        "utility_rate": 0.40,
        # what a naive unweighted mean over ALL SIX tiers would wrongly give
        "naive_rating_all_tiers": sum([58.8, 117.6, 156.8, 176.4, 235.2, 352.8]) / 6,
        "naive_rating_active_unweighted": (58.8 + 117.6 + 176.4) / 3,
    }
