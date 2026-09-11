// Write a filled RFC / MSRP calculator to disk, for checking an export
// outside the test suite:
//
//   npx -y tsx scripts/make-rfc-export.ts out.xlsx
//   python scripts/verify-cached-values.py out.xlsx
//   python -m ev_proposal_agent inspect out.xlsx
//
// The project is the same fixture the RFC tests use — real equipment, so the
// workbook has numbers in it to check.

import { readFileSync, writeFileSync } from "node:fs";
import { computeEstimate } from "../lib/calc/engine";
import { computeProposal } from "../lib/proposal";
import { fillRfcWorkbook } from "../lib/rfc/fillRfc";
import { RFC_TEMPLATE_PATH, rfcProject } from "../lib/rfc/__tests__/rfcProject";

async function main() {
  const out = process.argv[2] ?? "rfc-export.xlsx";
  const project = rfcProject();
  const result = computeEstimate(project);
  const proposal = computeProposal(project, result);
  const { bytes, report } = await fillRfcWorkbook(readFileSync(RFC_TEMPLATE_PATH), project, result, proposal);
  writeFileSync(out, bytes);

  console.log(`wrote ${out}`);
  console.log(`  ${report.filled} input cells written`);
  console.log(`  ${report.recalc?.evaluated ?? 0} formula cells given their computed value`);
  for (const r of report.refused) console.log(`  refused: ${r}`);
  for (const e of report.recalc?.errors ?? []) console.log(`  error: ${e.sheet}!${e.ref} = ${e.code}`);
  for (const w of report.warnings) console.log(`  ! ${w}`);
}

void main();
