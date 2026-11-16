#!/usr/bin/env node
// Add new questions to data/questions.json, safely.
//
// Usage: node scripts/add-questions.mjs <drafts.json> [--dry-run] [--json]
//
// <drafts.json> is an array of questions in the bank's format, without ids
// (they are assigned: next free hist-NN, sci-NN...). Steps:
//   1. check every draft: format and rules (js/validate.js), sourceHint
//      present, "verified" not true, no duplicate of an existing question or
//      another draft (js/bank-analysis.js)
//   2. if anything fails: report and stop. Nothing is written.
//   3. otherwise (unless --dry-run): back up data/questions.json to backups/,
//      write the bank with the new questions (verified: false), and re-check it
//   4. print a report of what was added
// Exit code: 0 added (or dry run passed); 1 can't read; 2 rejected.

import { readFile } from "node:fs/promises";
import { analyzeBank, checkNewQuestions, summarizeAnalysis } from "../js/bank-analysis.js";
import { backupQuestions, readQuestions, writeQuestions } from "./bank-tools.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const asJson = args.includes("--json");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: node scripts/add-questions.mjs <drafts.json> [--dry-run] [--json]");
  process.exit(1);
}

let bank, drafts;
try {
  bank = await readQuestions();
  drafts = JSON.parse(await readFile(file, "utf8"));
} catch (err) {
  console.error(`✖ Could not read the files\n  ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(drafts)) {
  console.error("✖ The drafts file must contain an array of questions.");
  process.exit(1);
}

const check = checkNewQuestions(bank, drafts);
let backup = null;
let after = null;
if (check.ok && !dryRun) {
  backup = await backupQuestions();
  // Insert each new question after the last one of its category, keeping the file grouped.
  const updated = [...bank];
  for (const q of check.questions) {
    const last = updated.map((x) => x.category).lastIndexOf(q.category);
    updated.splice(last === -1 ? updated.length : last + 1, 0, q);
  }
  await writeQuestions(updated);
  after = analyzeBank(await readQuestions());
}

if (asJson) {
  console.log(JSON.stringify({ ok: check.ok, dryRun, backup, results: check.results, bankErrors: check.bankErrors, after }, null, 2));
} else {
  console.log(`${dryRun ? "Dry run: checked" : "Checked"} ${drafts.length} draft question(s)\n`);
  for (const r of check.results) {
    const mark = r.errors.length ? "✖" : r.cautions.length ? "⚠" : "✔";
    console.log(`${mark} ${r.id}: ${r.question ?? "(no question)"}`);
    for (const e of r.errors) console.log(`    error: ${e}`);
    for (const c of r.cautions) console.log(`    look at: ${c}`);
  }
  for (const e of check.bankErrors) console.log(`✖ bank: ${e}`);
  if (!check.ok) console.log("\nNothing was added. Fix the errors above and run again.");
  else if (dryRun) console.log(`\nAll ${check.questions.length} pass. Run again without --dry-run to add them.`);
  else {
    console.log(`\n✔ Added ${check.questions.length} question(s), all "verified": false.`);
    console.log(`  Backup of the previous bank: ${backup}`);
    console.log(`  Bank now: ${summarizeAnalysis(after)}`);
  }
}
process.exitCode = check.ok ? 0 : 2;
