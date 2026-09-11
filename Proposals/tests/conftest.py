from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ev_proposal_agent import engine as engine_mod          # noqa: E402
from ev_proposal_agent.extract import build_context, load_field_map  # noqa: E402

V16 = ROOT / "inputs" / "RFC_MSRP_Calculator_Simple_v16.xlsx"
LEGACY = ROOT / "inputs" / "Historical_RipandReplaceFood4Less_f-00148.xlsx"
REFERENCE_DOCX = ROOT / "inputs" / "Food4Less_Rip-and-Replace_Proposal-Aug2026_AR.docx"
SHOWCASE = ROOT / "inputs" / "Historical_Showcase_Liquor_Pasadena_2026-08-06.xlsx"
MARRIOTT = ROOT / "inputs" / "Historical_Marriott_Bakersfield.xlsx"

# Marriott Bakersfield: the `v15_no_itc` chassis. Legacy cost block and cashflow
# rows, v16 INPUT SHEET and EVOLV block, no ITC row on the Financial Worksheet at
# all, and the six-tier carbon grid moved to L4:R9. Its existing port counts come
# off `Updated!B6`/`C6` through `_prefill_existing_equipment` (legacy engine), so
# nothing has to be supplied here - which is itself worth exercising.
MARRIOTT_OPERATOR_INPUTS: dict = {}

# The SAME chassis carrying the OTHER engine. A single-port Level 2 rip-and-
# replace: scenario grid, no Historical Data, no 10 Year Projection Comparison,
# and the carbon grid one row below where the other specimen keeps it. It is the
# file that proved the carbon block has to be found by label, not by address.
MARRIOTT_L2 = ROOT / "inputs" / "Rip_and_Replace_MarriottBakersfield_L2.xlsx"

# A clean v16 chassis on the scenario grid: greenfield (no Historical Data), a
# 5-year horizon from the B9/B10 toggle, an intact DLL Schedule - and the only
# specimen with DUAL-PORT Level 2 hardware (2 x CTX-C80-240-2, 80A, 4 ports).
# It is the file that proved the L2 description was a hardcoded constant.
BEST_WESTERN = ROOT / "inputs" / "BestWestern_Reduction_v16.xlsx"

# Showcase Liquor: the real production shape. A v16 chassis carrying the legacy
# `Updated Chargers Revenue Calcul` sheet, plus `Historical Data` and
# `10 Year Projection Comparison`. Four dual-port Level 2 stations (8 ports) and
# no DC fast history at all.
SHOWCASE_OPERATOR_INPUTS = {
    "existing_ports_l2": 8,
    "existing_ports_l3": 0,
    "existing_nameplate_l2_kw": 7.2,
    "existing_nameplate_l3_kw": 50,
}

# The existing-equipment facts the specimen hardcodes. Section 3B needs them and
# they are in no sheet, so the reference-fidelity run has to supply them.
FOOD4LESS_OPERATOR_INPUTS = {
    "existing_ports_l2": 5,
    "existing_ports_l3": 5,
    "existing_nameplate_l2_kw": 7.2,
    "existing_nameplate_l3_kw": 50,
}


@pytest.fixture(scope="session")
def field_map() -> dict:
    return load_field_map()


@pytest.fixture(scope="session")
def v16_paths() -> Path:
    if not V16.exists():
        pytest.skip(f"missing input: {V16}")
    return V16


@pytest.fixture(scope="session")
def legacy_path() -> Path:
    if not LEGACY.exists():
        pytest.skip(f"missing input: {LEGACY}")
    return LEGACY


@pytest.fixture(scope="session")
def v16_context(field_map, v16_paths):
    with engine_mod.load(v16_paths, field_map) as lw:
        return build_context(lw, field_map)


@pytest.fixture(scope="session")
def legacy_context(field_map, legacy_path):
    with engine_mod.load(legacy_path, field_map) as lw:
        return build_context(lw, field_map, operator_inputs=FOOD4LESS_OPERATOR_INPUTS)


@pytest.fixture(scope="session")
def output_dir() -> Path:
    d = ROOT / "tests" / "output"
    d.mkdir(parents=True, exist_ok=True)
    return d


@pytest.fixture(scope="session")
def showcase_path() -> Path:
    if not SHOWCASE.exists():
        pytest.skip(f"missing input: {SHOWCASE}")
    return SHOWCASE


@pytest.fixture(scope="session")
def showcase_context(field_map, showcase_path):
    with engine_mod.load(showcase_path, field_map) as lw:
        return build_context(lw, field_map, operator_inputs=SHOWCASE_OPERATOR_INPUTS)


@pytest.fixture(scope="session")
def marriott_path() -> Path:
    if not MARRIOTT.exists():
        pytest.skip(f"missing input: {MARRIOTT}")
    return MARRIOTT


@pytest.fixture(scope="session")
def marriott_context(field_map, marriott_path):
    with engine_mod.load(marriott_path, field_map) as lw:
        return build_context(lw, field_map, operator_inputs=MARRIOTT_OPERATOR_INPUTS)


@pytest.fixture(scope="session")
def marriott_l2_path() -> Path:
    if not MARRIOTT_L2.exists():
        pytest.skip(f"missing input: {MARRIOTT_L2}")
    return MARRIOTT_L2


@pytest.fixture(scope="session")
def marriott_l2_context(field_map, marriott_l2_path):
    with engine_mod.load(marriott_l2_path, field_map) as lw:
        return build_context(lw, field_map, operator_inputs={})


@pytest.fixture(scope="session")
def best_western_path() -> Path:
    if not BEST_WESTERN.exists():
        pytest.skip(f"missing input: {BEST_WESTERN}")
    return BEST_WESTERN


@pytest.fixture(scope="session")
def best_western_context(field_map, best_western_path):
    with engine_mod.load(best_western_path, field_map) as lw:
        return build_context(lw, field_map, operator_inputs={})
