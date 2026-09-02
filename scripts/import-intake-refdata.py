#!/usr/bin/env python3
"""Generate lib/ref/*.ts from the CEO's "EVSE Project Intake" template.

    python3 scripts/import-intake-refdata.py [path/to/EVSE_Project_Intake_TEMPLATE_x.y.z.xlsx]
    (or: npm run refdata)

Emits the Chargetronix price book (SKUs, per-class service and warranty rates,
equipment architecture), the utility rate library, the delivery-utility roster
and the market benchmarks as TypeScript tables. Each file records the template
version and content hash it came from, so a stale price book is visible. A new
template release is a re-run.

Python + openpyxl rather than ExcelJS because ExcelJS fails to open this
workbook (a comments-reconcile bug in its reader), and openpyxl reads it fine.
The template is produced by a script, so its formula cells carry NO cached
results — the handful of derived price-book cells (distributed-system service
rates) are evaluated here with a tiny arithmetic evaluator.
"""
import datetime
import json
import os
import re
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.path.join(ROOT, "templates", "source", "EVSE_Project_Intake_TEMPLATE_2.9.0.xlsx")
)
OUT = os.path.join(ROOT, "lib", "ref")

wb = openpyxl.load_workbook(SRC, data_only=False)


# ---------------------------------------------------------------------------
# Cell readers
# ---------------------------------------------------------------------------


def raw(ws, ref):
    v = ws[ref].value
    if hasattr(v, "text"):  # ArrayFormula and friends
        return "=" + str(v.text)
    return v


def text(ws, ref):
    v = raw(ws, ref)
    if v is None:
        return ""
    if isinstance(v, str) and v.startswith("="):
        return ""  # uncached formula
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()[:10]
    return str(v).strip()


def eval_formula(ws, formula, depth=0):
    """Evaluates the simple same-sheet formulas the price book uses for derived
    rates — cell refs, + - * / ( ), numbers and percentages, e.g.
    "=C106+(C106*25%)" or "=D107+C107". Anything else raises, so a template
    change can never silently produce a wrong rate."""
    if depth > 20:
        raise ValueError(f"formula recursion too deep: {formula}")
    src = formula.lstrip("=").replace("$", "")
    pos = [0]

    def peek():
        return src[pos[0]] if pos[0] < len(src) else ""

    def skip():
        while peek() == " ":
            pos[0] += 1

    def parse_expr():
        v = parse_term()
        while True:
            skip()
            c = peek()
            if c == "+":
                pos[0] += 1
                v += parse_term()
            elif c == "-":
                pos[0] += 1
                v -= parse_term()
            else:
                return v

    def parse_term():
        v = parse_factor()
        while True:
            skip()
            c = peek()
            if c == "*":
                pos[0] += 1
                v *= parse_factor()
            elif c == "/":
                pos[0] += 1
                v /= parse_factor()
            else:
                return v

    def parse_factor():
        skip()
        c = peek()
        if c == "(":
            pos[0] += 1
            v = parse_expr()
            skip()
            if peek() != ")":
                raise ValueError(f"expected ) in {formula}")
            pos[0] += 1
            return v
        if c == "-":
            pos[0] += 1
            return -parse_factor()
        m = re.match(r"(\d+(?:\.\d+)?)(%?)", src[pos[0] :])
        if m:
            pos[0] += len(m.group(0))
            n = float(m.group(1))
            return n / 100 if m.group(2) else n
        m = re.match(r"([A-Z]{1,3}\d+)", src[pos[0] :])
        if m:
            pos[0] += len(m.group(0))
            return cell_number(ws, m.group(1), depth + 1)
        raise ValueError(f'cannot parse "{src[pos[0]:]}" in {formula}')

    v = parse_expr()
    skip()
    if pos[0] != len(src):
        raise ValueError(f"trailing input in {formula}")
    return v


def cell_number(ws, ref, depth=0):
    v = raw(ws, ref)
    if isinstance(v, str) and v.startswith("="):
        return eval_formula(ws, v, depth)
    if isinstance(v, (int, float)):
        return float(v)
    raise ValueError(f"{ws.title}!{ref} is not numeric: {v!r}")


def num(ws, ref):
    """Numeric value or None; evaluates uncached formulas."""
    v = raw(ws, ref)
    if v is None or v == "":
        return None
    if isinstance(v, str) and v.startswith("="):
        return eval_formula(ws, v)
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace("$", "").replace(",", "").replace("%", ""))
    except ValueError:
        return None


def clean(n):
    """Numbers as JSON-friendly values: ints stay ints, floats round to 6 dp."""
    if n is None:
        return None
    if float(n).is_integer():
        return int(n)
    return round(n, 6)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------


def read_meta():
    ws = wb["Version"]
    return {
        "templateVersion": text(ws, "B4"),
        "released": text(ws, "B5"),
        "contentHash": text(ws, "B8"),
        "sourceFile": os.path.basename(SRC),
        "generatedAt": datetime.date.today().isoformat(),
    }


def find_header(ws, prefix, start, end, col="A"):
    for r in range(start, end + 1):
        if text(ws, f"{col}{r}").startswith(prefix):
            return r
    raise ValueError(f"{ws.title}: header {prefix!r} not found in rows {start}-{end}")


def read_price_book():
    ws = wb["PriceBook"]

    role_by_sku = {}
    for r in range(3, 201):
        sku, role = text(ws, f"AD{r}"), text(ws, f"AE{r}")
        if sku and role:
            role_by_sku[sku] = role

    capacity_by_sku = {}
    for col in ["K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U"]:
        capacity = text(ws, f"{col}2")
        if not capacity:
            continue
        for r in range(3, 41):
            sku = text(ws, f"{col}{r}")
            if sku:
                capacity_by_sku[sku] = capacity

    capacities = []
    for r in range(3, 21):
        capacity = text(ws, f"W{r}")
        if not capacity:
            continue
        capacities.append(
            {"capacity": capacity, "ratedKw": clean(num(ws, f"X{r}") or 0), "perPort": clean(num(ws, f"Y{r}") or 0)}
        )
    rated_by_capacity = {c["capacity"]: c["ratedKw"] for c in capacities}

    skus = []
    service_hdr = None
    for r in range(2, 201):
        category, sku = text(ws, f"A{r}"), text(ws, f"B{r}")
        if category.startswith("SERVICE AND WARRANTY"):
            service_hdr = r
            break
        if not category.startswith("_") or not sku:
            continue
        capacity = capacity_by_sku.get(sku, "")
        listed_kw = num(ws, f"E{r}")
        skus.append(
            {
                "sku": sku,
                "category": category,
                "capacity": capacity,
                "description": text(ws, f"C{r}"),
                "msrp": clean(num(ws, f"D{r}") or 0),
                "ratedKw": clean(listed_kw if listed_kw is not None else rated_by_capacity.get(capacity, 0)),
                "connectors": clean(num(ws, f"I{r}") or 0),
                "connectorBasis": text(ws, f"J{r}"),
                "role": role_by_sku.get(sku, "accessory" if category == "_L2_Accessories" else "all_in_one"),
            }
        )
    if service_hdr is None:
        raise ValueError("service rate header not found")

    service_rates = []
    for r in range(service_hdr + 2, service_hdr + 40):
        cls = text(ws, f"A{r}")
        if not cls:
            break
        v = raw(ws, f"C{r}")
        if v is None:
            break
        oow = text(ws, f"F{r}")
        service_rates.append(
            {
                "class": cls,
                "yearlyWarranty": round(cell_number(ws, f"C{r}"), 2),
                "inWarrantyService": round(cell_number(ws, f"D{r}"), 2),
                "warrantyPlusServiceYr3": round(cell_number(ws, f"E{r}"), 2),
                "outOfWarrantyService": "NOT OFFERED" if (oow == "" or oow.upper().startswith("NOT")) else float(oow),
                "includedWarranty": text(ws, f"G{r}"),
            }
        )

    arch_hdr = find_header(ws, "EQUIPMENT ARCHITECTURE", service_hdr, service_hdr + 60)
    architecture = []
    for r in range(arch_hdr + 3, arch_hdr + 40):
        sku = text(ws, f"A{r}")
        if not sku or sku.startswith("MISSING"):
            break
        architecture.append(
            {
                "sku": sku,
                "role": text(ws, f"B{r}"),
                "dcKw": clean(num(ws, f"C{r}") or 0),
                "acKw": clean(num(ws, f"D{r}") or 0),
                "acCircuits": clean(num(ws, f"E{r}") or 0),
                "acFla": clean(num(ws, f"F{r}") or 0),
                "dcOutputs": clean(num(ws, f"G{r}") or 0),
                "maxDualDispensers": clean(num(ws, f"H{r}") or 0),
                "source": text(ws, f"I{r}"),
            }
        )
    return skus, capacities, service_rates, architecture


def read_rate_library():
    ws = wb["RateLibrary"]
    rows = []
    for r in range(5, 201):
        utility = text(ws, f"A{r}")
        if not utility:
            break
        rows.append(
            {
                "utility": utility,
                "schedule": text(ws, f"B{r}"),
                "fromKw": clean(num(ws, f"C{r}") or 0),
                "toKw": clean(num(ws, f"D{r}") or 0),
                "voltage": text(ws, f"E{r}"),
                "peakPerKwh": clean(num(ws, f"F{r}") or 0),
                "offPeakPerKwh": clean(num(ws, f"G{r}") or 0),
                "superOffPeakPerKwh": clean(num(ws, f"H{r}") or 0),
                "demandPerKwMonth": clean(num(ws, f"I{r}") or 0),
                "blockKw": clean(num(ws, f"J{r}") or 0),
                "blockPerMonth": clean(num(ws, f"K{r}") or 0),
                "overagePerKw": clean(num(ws, f"L{r}") or 0),
                "customerPerMonth": clean(num(ws, f"M{r}") or 0),
                "seasons": text(ws, f"N{r}"),
                "touPeriods": text(ws, f"O{r}"),
                "status": text(ws, f"P{r}"),
                "effective": text(ws, f"Q{r}"),
                "source": text(ws, f"R{r}"),
            }
        )
    return rows


def read_utilities():
    ws = wb["Utilities"]
    utilities = []
    for r in range(5, 201):
        utility = text(ws, f"J{r}")
        if not utility:
            break
        utilities.append(
            {
                "utility": utility,
                "type": text(ws, f"K{r}"),
                "territory": text(ws, f"L{r}"),
                "evRateStatus": text(ws, f"M{r}"),
                "state": text(ws, f"N{r}"),
            }
        )
    picker = []
    for r in range(5, 61):
        s = text(ws, f"H{r}")
        if not s:
            break
        picker.append(s)
    return utilities, picker


def read_refdata():
    ws = wb["RefData"]
    bm = find_header(ws, "MARKET BENCHMARKS", 100, 250)
    benchmarks = []
    for r in range(bm + 3, bm + 40):
        state = text(ws, f"A{r}")
        if not state:
            break
        benchmarks.append(
            {
                "state": state,
                "portUtilisation": clean(num(ws, f"B{r}")),
                "priceToDriverPerKwh": clean(num(ws, f"C{r}")),
            }
        )
    source = text(ws, f"A{bm + 1}")
    gear_hdr = find_header(ws, "480V SWITCHGEAR", 5, 60)
    gear = []
    for r in range(gear_hdr + 2, gear_hdr + 60):
        item, size, cost = text(ws, f"A{r}"), text(ws, f"B{r}"), num(ws, f"C{r}")
        if not item or cost is None:
            break
        gear.append({"item": item, "size": size, "cost": clean(cost)})
    return benchmarks, source, gear


# ---------------------------------------------------------------------------
# Emit
# ---------------------------------------------------------------------------


def header(meta, what):
    return (
        "// GENERATED by scripts/import-intake-refdata.py — do not edit by hand.\n"
        f"// {what}\n"
        f"// Source: {meta['sourceFile']} (EVSE Project Intake template {meta['templateVersion']},\n"
        f"// released {meta['released']}, content hash {meta['contentHash']}). Generated {meta['generatedAt']}.\n"
        "// Re-run `npm run refdata` when the CEO releases a new template.\n\n"
    )


def rows(items):
    return "\n".join("  " + json.dumps(it, ensure_ascii=False) + "," for it in items)


def write(name, body):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)


def main():
    meta = read_meta()
    skus, capacities, service_rates, architecture = read_price_book()
    rates = read_rate_library()
    utilities, picker = read_utilities()
    benchmarks, bm_source, gear = read_refdata()
    os.makedirs(OUT, exist_ok=True)

    meta_ts = "export const REFDATA_META = " + json.dumps(meta, indent=2) + " as const;\n"

    write(
        "priceBook.ts",
        header(meta, "Chargetronix price book: SKUs, per-class service and warranty rates, equipment architecture.")
        + meta_ts
        + f'''
export type SkuRole = "all_in_one" | "power_cabinet" | "dispenser" | "level_2" | "accessory";

export interface PriceBookSku {{
  sku: string;
  /** Raw price-book category, e.g. "_kW240", "_L2", "_Buy_America". */
  category: string;
  /** Capacity picker label the SKU sits under, e.g. "240 kW DC", "Level 2 AC". */
  capacity: string;
  description: string;
  /** Manufacturer list price, before the Commercial-tab discount. */
  msrp: number;
  /** Rated kW (DC output for chargers; 7.2 for Level 2; 0 for accessories). */
  ratedKw: number;
  /** Charging connectors — 0 for power cabinets (their dispensers carry them) and accessories. */
  connectors: number;
  connectorBasis: string;
  role: SkuRole;
}}

export const PRICE_BOOK: PriceBookSku[] = [
{rows(skus)}
];

export interface CapacityRow {{
  capacity: string;
  ratedKw: number;
  perPort: number;
}}

export const CAPACITIES: CapacityRow[] = [
{rows(capacities)}
];

/** Per cabinet per year. Service is sold only against a warranty in force. */
export interface ServiceRate {{
  class: string;
  yearlyWarranty: number;
  inWarrantyService: number;
  /** Yearly warranty + in-warranty service — the rate from year 3 on. */
  warrantyPlusServiceYr3: number;
  outOfWarrantyService: number | "NOT OFFERED";
  includedWarranty: string;
}}

export const SERVICE_RATES: ServiceRate[] = [
{rows(service_rates)}
];

/** What each distributed-system SKU is — from the Chargetronix Nexus spec sheets. */
export interface ArchitectureRow {{
  sku: string;
  role: string;
  dcKw: number;
  acKw: number;
  acCircuits: number;
  acFla: number;
  dcOutputs: number;
  maxDualDispensers: number;
  source: string;
}}

export const ARCHITECTURE: ArchitectureRow[] = [
{rows(architecture)}
];

export function findSku(sku: string): PriceBookSku | undefined {{
  return PRICE_BOOK.find((s) => s.sku === sku);
}}
''',
    )

    write(
        "rateLibrary.ts",
        header(meta, "Commercial EV and fallback utility rate schedules with a verification STATUS per row.")
        + f'''
export interface RateSchedule {{
  utility: string;
  schedule: string;
  fromKw: number;
  toKw: number;
  voltage: string;
  peakPerKwh: number;
  offPeakPerKwh: number;
  superOffPeakPerKwh: number;
  demandPerKwMonth: number;
  /** Subscription block size (kW); 0 when the schedule sells no blocks. */
  blockKw: number;
  blockPerMonth: number;
  overagePerKw: number;
  customerPerMonth: number;
  seasons: string;
  touPeriods: string;
  /** VERIFIED / PARTIAL / NOT PUBLISHED / PLACEHOLDER … — read before pricing anything. */
  status: string;
  effective: string;
  source: string;
}}

export const RATE_LIBRARY: RateSchedule[] = [
{rows(rates)}
];
''',
    )

    write(
        "utilities.ts",
        header(meta, "Delivery utilities that set their own retail tariff (California and Michigan), plus the rate-schedule picker.")
        + f'''
export interface UtilityRow {{
  utility: string;
  /** IOU / POU / Co-op … */
  type: string;
  territory: string;
  evRateStatus: string;
  state: string;
}}

export const UTILITIES: UtilityRow[] = [
{rows(utilities)}
];

/** Rate schedules the intake's Revenue tab offers. */
export const RATE_SCHEDULE_PICKER: string[] = {json.dumps(picker, ensure_ascii=False)};
''',
    )

    write(
        "benchmarks.ts",
        header(meta, "Market benchmarks (DC fast charging by state) and the intake's 480V gear price table.")
        + f'''
export const BENCHMARK_SOURCE = {json.dumps(bm_source, ensure_ascii=False)};

export interface MarketBenchmark {{
  state: string;
  /** Time-based port utilisation — share of the day a port delivers energy. */
  portUtilisation: number | null;
  priceToDriverPerKwh: number | null;
}}

export const MARKET_BENCHMARKS: MarketBenchmark[] = [
{rows(benchmarks)}
];

/** The intake's 480V switchgear and breaker cost table — same source as the estimator's GEAR_CATALOG. */
export const INTAKE_GEAR_480V: {{ item: string; size: string; cost: number }}[] = [
{rows(gear)}
];
''',
    )

    print(
        f"refdata from {meta['sourceFile']} (template {meta['templateVersion']}, hash {meta['contentHash']}): "
        f"{len(skus)} SKUs, {len(service_rates)} service classes, {len(architecture)} architecture rows, "
        f"{len(rates)} rate schedules, {len(utilities)} utilities, {len(benchmarks)} benchmarks, {len(gear)} gear prices"
    )


if __name__ == "__main__":
    main()
