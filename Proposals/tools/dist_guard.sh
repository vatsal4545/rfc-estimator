#!/usr/bin/env bash
# Keeps dist/EVProposalGenerator.exe honest about being out of date.
#
# The .exe bundles config/ and templates/ INSIDE itself, so editing the source
# tree does nothing for the app the operator actually runs. Not theoretical: a
# proposal was shipped from a 13-day-old exe whose baked-in template still
# carried the reference site's figures.
#
#   mark   PostToolUse(Write|Edit) - flag dist as stale if a build input changed
#   check  Stop                    - say so, every turn, until it is rebuilt
#
# No auto-rebuild, on purpose. PyInstaller clears dist/ before it starts and
# takes ~4 minutes, so an automatic build leaves NO exe for most of that window,
# and build.ps1 force-kills a running instance. A stale exe beats a missing one;
# an unmissable warning beats both.
#
# Two portability notes, both learned the hard way:
#   * jq is NOT installed here, so sed does the JSON extraction.
#   * the warning text must contain no backslash. It is emitted inside a JSON
#     string, where ".\build.ps1" decodes as ".<backspace>uild.ps1".
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STALE="$ROOT/.claude/.dist-stale"
EXE="$ROOT/dist/EVProposalGenerator.exe"

# Everything baked into the frozen app. tests/ and docs/ are deliberately
# absent - they do not ship inside the exe.
is_build_input() {
  case "$1" in
    */ev_proposal_agent/*.py)  return 0 ;;
    */config/field_map.yaml)   return 0 ;;
    */templates/*)             return 0 ;;
    */tools/build_template.py) return 0 ;;
    */run_gui.py)              return 0 ;;
    */requirements.txt)        return 0 ;;
    */EVProposalGenerator.spec) return 0 ;;
    *) return 1 ;;
  esac
}

case "${1:-}" in
  mark)
    path="$(cat | sed -n 's/.*"\(file_path\|filePath\)"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\2/p' | head -1)"
    [ -n "$path" ] || exit 0
    # Backslashes -> forward slashes, then squeeze the // that JSON escaping
    # leaves behind, so the globs above see one canonical separator.
    path="$(printf '%s' "$path" | tr '\134' '/' | tr -s '/')"
    if is_build_input "$path"; then
      mkdir -p "$ROOT/.claude"
      printf '%s\n' "$path" >> "$STALE"
    fi
    ;;
  check)
    [ -f "$STALE" ] || exit 0
    if [ -f "$EXE" ] && [ "$EXE" -nt "$STALE" ]; then
      rm -f "$STALE"; exit 0          # rebuilt since we flagged it
    fi
    files="$(sed 's|.*/||' "$STALE" | sort -u)"
    count="$(printf '%s\n' "$files" | grep -c .)"
    names="$(printf '%s\n' "$files" | head -4 | tr '\n' ' ')"
    printf '{"systemMessage":"dist/EVProposalGenerator.exe is STALE: %s build input(s) changed since it was packaged (%s). The exe bundles config/ and templates/ inside itself, so the app keeps using the OLD template and the OLD field map until you run build.ps1 in the project root."}\n' \
      "$count" "$names"
    ;;
  *) exit 0 ;;
esac
exit 0
