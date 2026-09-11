# Build EVProposalGenerator.exe
#
#   .\build.ps1              full build
#   .\build.ps1 -SkipTests   skip pytest (use only to iterate on packaging)
#
# The template is a build artifact, not a checked-in binary, so it is rebuilt
# from the reference proposal every time. That way the template and the
# extractor cannot drift apart between releases.

param(
    [switch]$SkipTests,
    [switch]$SkipTemplate
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Step($message) {
    Write-Host ""
    Write-Host "=== $message ===" -ForegroundColor Cyan
}

# python, pip and PyInstaller all write progress to stderr. With
# $ErrorActionPreference = "Stop", PowerShell turns any native stderr output
# into a terminating NativeCommandError even when the exit code is 0, so every
# external call is run with the preference relaxed and judged on $LASTEXITCODE.
function Invoke-Native {
    param([string]$What, [scriptblock]$Command)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Command
        if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)." }
    } finally {
        $ErrorActionPreference = $previous
    }
}

Step "Checking Python"
Invoke-Native "python --version" { python --version }

Step "Installing dependencies"
Invoke-Native "pip install" { python -m pip install --quiet -r requirements.txt }

if (-not $SkipTemplate) {
    Step "Building the proposal template"
    Invoke-Native "Template build (see the identity audit above)" {
        python -m tools.build_template
    }

    # The template is a build artifact. A rebuild that reintroduces a
    # reference-site figure - which is how $22,592 / $67,776 / $112,960 once
    # reached a customer - must stop the build here rather than ship.
    Step "Auditing the template for hardcoded figures"
    Invoke-Native "Template literal audit - an unjustified literal blocks the build" {
        python -m tools.audit_template
    }
}

if (-not $SkipTests) {
    Step "Running tests"
    Invoke-Native "Tests - not packaging a broken build" {
        python -m pytest tests/ -q
    }

    # Provenance: a printed value nobody can trace back to a cell is the
    # precondition for every wrong-figure defect this project has had.
    Step "Auditing token provenance"
    Invoke-Native "Source audit - every emitted token must name its origin" {
        python -m tools.audit_sources
    }
}

Step "Cleaning previous build"
# Windows holds an exclusive lock on a running .exe, so a build started while
# the app is open fails on the delete rather than on anything meaningful.
$running = Get-Process -Name "EVProposalGenerator" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "  closing $($running.Count) running instance(s)..." -ForegroundColor Yellow
    $running | Stop-Process -Force
    Start-Sleep -Milliseconds 700
}
# Clear the CONTENTS, not the folder. An Explorer window sitting in dist\ holds
# a handle on the directory itself, and PyInstaller is happy to write into an
# existing empty one, so removing the folder buys nothing and fails often.
foreach ($dir in @("build", "dist")) {
    if (Test-Path $dir) {
        try {
            Get-ChildItem $dir -Force -Recurse |
                Sort-Object FullName -Descending |
                Remove-Item -Force -Recurse -ErrorAction Stop
        } catch {
            throw "Could not clear '$dir': $($_.Exception.Message). Close " +
                  "EVProposalGenerator.exe and any Explorer window showing it."
        }
    } else {
        New-Item -ItemType Directory $dir | Out-Null
    }
}

Step "Stamping the build"
# Must run BEFORE PyInstaller, which packages config/ into the exe. The
# stamp is how anyone answers "is my fix in the binary I am running".
Invoke-Native "Build stamp" { python -m tools.stamp_build }

Step "Packaging with PyInstaller"
# --add-data uses ';' as the separator on Windows.
# matplotlib's data files (fonts, matplotlibrc) are not detected automatically
# and the charts fail at runtime without them.
Invoke-Native "PyInstaller" { python -m PyInstaller `
    --onefile `
    --windowed `
    --name EVProposalGenerator `
    --add-data "config;config" `
    --add-data "templates;templates" `
    --collect-data matplotlib `
    --collect-submodules matplotlib.backends `
    --hidden-import "PySide6.QtSvg" `
    --exclude-module tkinter `
    --exclude-module pytest `
    --noconfirm `
    run_gui.py }

Step "Packaging the release zip"
Invoke-Native "Release packaging" { python -m tools.make_release }

$exe = Join-Path $PSScriptRoot "dist\EVProposalGenerator.exe"
if (-not (Test-Path $exe)) { throw "Expected $exe but it was not produced." }

$size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Step "Done"
Write-Host "  $exe  ($size MB)" -ForegroundColor Green
Write-Host ""
Write-Host "  Test it on a machine WITHOUT Python installed before shipping." -ForegroundColor Yellow
Write-Host "  Output goes to %USERPROFILE%\Documents\EV Proposals" -ForegroundColor Yellow
Write-Host ""
Write-Host "  To hand it to someone, send:" -ForegroundColor Cyan
Write-Host "    release\EVProposalGenerator-Setup.zip" -ForegroundColor Cyan
