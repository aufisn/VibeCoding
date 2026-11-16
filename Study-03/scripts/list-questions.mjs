#!/usr/bin/env node
// Print quiz questions with their correct answers, for fact-checking
// (used by the /quiz-check skill).
//
// Usage:
//   node scripts/list-questions.mjs [filter] [--json] [--unverified]
//
//   filter        a category ("History", "Arts & Culture"), an id ("geo-03"),
//                 or an id prefix ("sci"); all questions if omitted
//   --unverified  only questions whose "verified" isn't true
//   --json        machine-readable output
//
// Exit code: 0, or 1 if the file can't be read or nothing matches.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Questions matching `filter` (category name, id or id prefix; case-insensitive).
 * Pure.
 */
export function selectQuestions(questions, filter, { unverified = false } = {}) {
  const f = (filter ?? "").trim().toLowerCase();
  return (Array.isArray(questions) ? questions : []).filter((q) => {
    if (unverified && q.verified === true) return false;
    if (!f) return true;
    return (
      String(q.category).toLowerCase() === f ||
      String(q.id).toLowerCase() === f ||
      String(q.id).toLowerCase().startsWith(`${f}-`)
    );
  });
}

/** A compact view of one question for checking. */
export function toCheckItem(q) {
  return {
    id: q.id,
    category: q.category,
    difficulty: q.difficulty,
    question: q.question,
    answer: q.options?.[q.correctIndex],
    otherOptions: (q.options ?? []).filter((_, i) => i !== q.correctIndex),
    explanation: q.explanation,
    sourceHint: q.sourceHint,
    verified: q.verified === true,
  };
}

async function main(argv) {
  const args = [...argv];
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return false;
    args.splice(i, 1);
    return true;
  };
  const asJson = flag("--json");
  const unverified = flag("--unverified");
  const filter = args.join(" ");
  const path = fileURLToPath(new URL("../data/questions.json", import.meta.url));

  let questions;
  try {
    questions = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    console.error(`✖ Could not read data/questions.json\n  ${err.message}`);
    process.exit(1);
  }

  const items = selectQuestions(questions, filter, { unverified }).map(toCheckItem);
  if (items.length === 0) {
    console.error(`✖ No questions match "${filter}". Use a category (e.g. History), an id (geo-03) or a prefix (sci).`);
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  for (const q of items) {
    console.log(`${q.id} (${q.category}, ${q.difficulty})${q.verified ? " [verified]" : ""}`);
    console.log(`  Q: ${q.question}`);
    console.log(`  A: ${q.answer}`);
    console.log(`  Other options: ${q.otherOptions.join(" | ")}`);
    console.log(`  Explanation: ${q.explanation}`);
    console.log(`  Source hint: ${q.sourceHint}\n`);
  }
  console.log(`${items.length} question(s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
