"""Headless entry point. Every step the GUI performs must also run from here.

Subcommands import their heavy dependencies lazily so `--help` stays fast and
keeps working while later phases are still being built.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .errors import ProposalError


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ev-proposal-agent",
        description=(
            "Turn an EV charging financial worksheet (.xlsx) into an editable "
            "Word proposal."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "The workbook must carry cached values. If openpyxl reports none, "
            "open the file in Excel, press Ctrl+Alt+F9, save and retry."
        ),
    )
    from .buildinfo import build_label

    parser.add_argument("--version", action="version",
                        version=f"%(prog)s {build_label()}")
    sub = parser.add_subparsers(dest="command", metavar="<command>")

    p_inspect = sub.add_parser(
        "inspect",
        help="Detect engine, scenario and horizon, then dump every extracted token.",
    )
    p_inspect.add_argument("workbook", type=Path, help="Path to the .xlsx worksheet")
    p_inspect.add_argument(
        "--json", action="store_true", help="Emit JSON instead of a readable table"
    )
    p_inspect.set_defaults(func=_cmd_inspect)

    p_gen = sub.add_parser("generate", help="Render a proposal .docx and its QA report.")
    p_gen.add_argument("workbook", type=Path, help="Path to the .xlsx worksheet")
    p_gen.add_argument(
        "-o", "--output", type=Path, default=None, help="Output .docx path"
    )
    p_gen.add_argument(
        "--inputs",
        type=Path,
        default=None,
        help="JSON file of operator inputs (client contact, existing ports, etc.)",
    )
    p_gen.add_argument(
        "--force",
        action="store_true",
        help="Render even when ERROR-level validations trip. Use only to debug.",
    )
    p_gen.set_defaults(func=_cmd_generate)

    p_charts = sub.add_parser("charts", help="Render the three chart PNGs only.")
    p_charts.add_argument("workbook", type=Path)
    p_charts.add_argument("-o", "--outdir", type=Path, default=Path("tests/output"))
    p_charts.set_defaults(func=_cmd_charts)

    p_gui = sub.add_parser("gui", help="Launch the desktop app.")
    p_gui.set_defaults(func=_cmd_gui)

    return parser


def _cmd_inspect(args: argparse.Namespace) -> int:
    from .extract import inspect_workbook

    return inspect_workbook(args.workbook, as_json=args.json)


def _cmd_generate(args: argparse.Namespace) -> int:
    from .render import generate

    return generate(
        args.workbook,
        output=args.output,
        operator_inputs_path=args.inputs,
        force=args.force,
    )


def _cmd_charts(args: argparse.Namespace) -> int:
    from .charts import render_all_from_workbook

    paths = render_all_from_workbook(args.workbook, args.outdir)
    for name, path in paths.items():
        print(f"{name}: {path}")
    return 0


def _cmd_gui(args: argparse.Namespace) -> int:
    from .gui import run

    return run()


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    try:
        return args.func(args) or 0
    except ProposalError as exc:
        print(f"error: {exc.message}", file=sys.stderr)
        if exc.detail:
            print(f"       {exc.detail}", file=sys.stderr)
        return 2
    except FileNotFoundError as exc:
        print(f"error: file not found: {exc.filename}", file=sys.stderr)
        return 2


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
