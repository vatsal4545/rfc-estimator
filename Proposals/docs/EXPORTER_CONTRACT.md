# Brief for the RFC exporter: write cached values, not just formulas

Hand this to whoever maintains the program that exports the RFC workbooks.

---

## The problem

The exported `.xlsx` files contain formulas but **no cached results**. Excel
recalculates on open so a human never notices, but every other consumer reads
the file as-is — and reads zeros.

Concretely, from `project-rfc-msrp-calculator (2).xlsx`:

```
INPUT SHEET!E8 = "TP5-120-480-1"   (typed in)
INPUT SHEET!I8 = 6                 (typed in)
INPUT SHEET!G8 = =IF($E8="","",IFERROR(INDEX('CTX Price Book'!$F:$F,
                    MATCH($E8,'CTX Price Book'!$C:$C,0)),""))
                                   <- cached value: NOTHING
INPUT SHEET!K8 = =IF(OR($G8="",$I8=""),"",J8-(H8*J8))
                                   <- cached value: NOTHING
```

That propagates all the way down:

```
K8 blank -> Internal Summary!D30 = 0 -> Financial Worksheet!B44 = 0
         -> DLL Schedule!D5 (Loan_Amount) = 0
         -> the consuming app suppresses every financing section
```

A second, subtler variant: cells that were calculated *before* the equipment
was entered keep their old answers rather than being blank. On the same file:

| cell | formula | inputs | cached | correct |
|---|---|---|---|---|
| `Internal Summary!D9` | `=(B9)-((B9)*C9)` | B9=4400, C9=7% | **0** | 4,092.00 |
| `Internal Summary!D10` | `=(B10)-((B10)*C10)` | B10=11400, C10=7% | **0** | 10,602.00 |
| `Internal Summary!D25` | `=(B25)-((B25)*C25)` | B25=12705, C25=-11.6% | **0** | 14,178.78 |

This is worse than a blank, because the file looks fully populated. The
consuming app now refuses such workbooks rather than producing a $0 proposal,
so **exports currently fail outright**.

## What to change

**Write each formula cell's computed value alongside its formula.**

You already have every number — the model computed them before writing the
workbook. This is purely about persisting them.

In the OOXML sheet part, a formula cell must carry both `<f>` and `<v>`:

```xml
<!-- what you write now -->
<c r="K8"><f>IF(OR($G8="",$I8=""),"",J8-(H8*J8))</f></c>

<!-- what it needs to be -->
<c r="K8" t="n"><f>IF(OR($G8="",$I8=""),"",J8-(H8*J8))</f><v>301320</v></c>
```

`t` is the cell type: `n` numeric (default, may be omitted), `str` for a
formula returning a string, `b` boolean, `e` error. A string result goes in
`<v>` directly for `t="str"` — it is not a shared-string index.

### If you use SheetJS (`xlsx`)

Set `v` and `t` next to `f`. SheetJS writes `<v>` when `v` is present:

```js
ws["K8"] = { t: "n", f: 'IF(OR($G8="",$I8=""),"",J8-(H8*J8))', v: 301320 };
ws["F8"] = { t: "str", f: "...", v: "120kW DCFC All In One Charger - 200 Amps..." };
```

A cell with only `{ f }` and no `v` is the current bug.

### If you use openpyxl

**openpyxl cannot hold a formula and its value at once** — one workbook object
carries one or the other. Two options:

1. Write **values only**, no formulas. The consuming app never evaluates
   formulas anyway; it reads cached values. This is the simplest correct fix if
   the file does not need to be editable in Excel afterwards.
2. Write formulas, then post-process the XML to inject `<v>` elements. More
   work, keeps the file live in Excel.

### If you use ExcelJS or similar

Most libraries expose this as a `result` field on a formula cell:

```js
worksheet.getCell("K8").value = { formula: 'J8-(H8*J8)', result: 301320 };
```

Omitting `result` is the bug.

## Minimum contract — the cells the consuming app actually reads

If writing values for *every* formula is impractical, these are the cells that
must carry one. Ranges are inclusive. This list is generated from the app's own
provenance registry across three chassis, so it is what the app genuinely
touches, not a guess.

### `Financial Worksheet` — 44

```
B3  B4  B5  B6  B7  B10  B16  B17  B18  B19  B20  B21  B22  B23  B24
B25  B26  B27  B28  B29  B30  B31  B32  B33  B34  B35  B36  B37  B38
B39  B40  B41  B42  B43  B44  E42  E47  F47  G47
D5:F15   E43:J43   E44:J44   E45:J45   H5:J15
```

### `Historical Data` — 53 *(only when the site has history)*

```
A4  J4:J31  K4:K31   A4:G38   C4:C38   D4:D38   I4:K31
```

### `INPUT SHEET` — 15

```
N8  N9  N10  N11  N17  N18  N19  N20  N21
C8:K37   E8:E37   N9:T9   O8:T8   O9:T9   O10:T10
```

### `DLL Schedule` — 13

```
D5  D6  D7  D8  D9  D10   J5  J6  J7  J8  J9   B18  B77
```

### `Cashflow` — 8

```
F1  G1  G3  H1  I3  I62   E3:I62   I3:I62
```

### `Internal Summary` — 11

```
D6  G3  G4  G11  G12  G13  H3  H11  H12  I3  I14
```

### `Updated Chargers Revenue Calcul` — 5 *(plus `B3`, read as text)*

```
B3  B12  B18  C12  C18  G12
```

**Caveat on the minimum list.** `Financial Worksheet!B16:B44` are references to
`Internal Summary!D3:D28`, which are themselves formulas (`D = B - (B*C)`). So
computing the minimum list still means evaluating the sheets behind it. Writing
values for every formula cell is simpler and less fragile than tracking this
dependency graph.

## How to verify a fixed export

Two checks, both cheap:

**1. No formula cell is missing its value.**

```python
import openpyxl
vals = openpyxl.load_workbook(path, data_only=True)
forms = openpyxl.load_workbook(path, data_only=False)
missing = []
for ws in forms.worksheets:
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("="):
                if vals[ws.title][c.coordinate].value is None:
                    missing.append(f"{ws.title}!{c.coordinate}")
print(len(missing), "formula cells with no cached value")
```

**2. The consuming app's own staleness check passes.** It verifies identities
the workbook must satisfy — `Internal Summary!D = B - (B x C)`, and "a SKU with
a quantity must have a line total". Run:

```
python -m ev_proposal_agent inspect <workbook.xlsx>
```

A stale file is refused with the specific cells named, e.g.:

```
INPUT SHEET!E8 is 'TP5-120-480-1' x 6 but K8 (line total) has never been computed
```

A correct file loads and reports `Financing  <amount>` rather than
`Financing  none`.

## What NOT to do

**Do not rely on `fullCalcOnLoad="1"`.** The current exports set it, and it
does work — in Excel. It does nothing for any programmatic reader, and it is
not a signal of anything: openpyxl stamps it on every save, so its presence
says nothing about whether a file is calculated.

**Do not strip the formulas to "fix" the file** unless the workbook genuinely
does not need to stay live in Excel. Values alone are readable but the
recipient loses the ability to change an input and see the model respond, which
is most of why the workbook exists.
