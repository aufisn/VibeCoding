#!/usr/bin/env node
// Analyse data/questions.json: structure, counts and distribution, missing
// categories, duplicates, and growth gaps. The same analysis the game runs
// every time a game starts (js/bank-analysis.js).
//
// Usage: node scripts/analyze-bank.mjs [--json] [--target 10]
//   --target N   questions wanted per category and difficulty, for the gaps list
// Exit code: 0; 1 if the file can't be read; 2 if there are problems (errors).

import { analyzeBank, summarizeAnalysis } from "../js/bank-analysis.js";
import { readQuestions } from "./bank-tools.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const ti = args.indexOf("--target");
const growthTarget = ti === -1 ? undefined : Number(args[ti + 1]);

let questions;
try {
  questions = await readQuestions();
} catch (err) {
  console.error(`✖ Could not read data/questions.json\n  ${err.message}`);
  process.exit(1);
}
const a = analyzeBank(questions, growthTarget ? { growthTarget } : {});

if (asJson) {
  console.log(JSON.stringify(a, null, 2));
} else {
  console.log(`Question bank: ${summarizeAnalysis(a)}\n`);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad("Category", 16)}${pad("Total", 7)}${pad("Easy", 6)}${pad("Medium", 8)}${pad("Hard", 6)}${pad("Verified", 10)}Full rounds`);
  for (const c of a.perCategory) {
    console.log(`${pad(c.category, 16)}${pad(c.total, 7)}${pad(c.easy, 6)}${pad(c.medium, 8)}${pad(c.hard, 6)}${pad(`${c.verified}/${c.total}`, 10)}${c.fullRounds}`);
  }
  const section = (title, lines) => lines.length && console.log(`\n${title}:\n${lines.map((l) => `  - ${l}`).join("\n")}`);
  section("Missing categories", a.missingCategories);
  section("Short of a full round", a.shortCategories.map((c) => `${c.category}: ${JSON.stringify(c.missing)}`));
  section("Unknown categories", a.unknownCategories.map((c) => `${c.category}: ${c.ids.join(", ")}`));
  section("Problems", a.errors);
  section("To look at", a.cautions);
  section("Notes", a.notes);
  const want = a.gaps[0]?.want;
  if (a.gaps.length) {
    console.log(`\nGaps to ${want} per difficulty (for full Easy/Medium/Hard rounds):`);
    for (const c of a.perCategory) {
      const g = a.gaps.filter((x) => x.category === c.category).map((x) => `${x.want - x.have} ${x.difficulty}`);
      if (g.length) console.log(`  - ${c.category}: ${g.join(", ")}`);
    }
  }
  console.log(`\n${a.unverifiedCount} of ${a.total} questions not yet verified.`);
}
if (a.status === "error") process.exitCode = 2;
