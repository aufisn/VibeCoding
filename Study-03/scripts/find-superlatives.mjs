#!/usr/bin/env node
// Find superlative and ranking words ("most", "first", "largest"...) in the
// quiz questions, so each can be checked against guideline 2 in CLAUDE.md
// ("Specify measurement criteria for expressions like 'largest'").
//
// Usage:
//   node scripts/find-superlatives.mjs [options] [path/to/questions.json]
//
// Options:
//   --explanations     also search the explanations (default: questions and options)
//   --words a,b,c      extra words to look for, comma-separated
//   --json             print the matches as JSON instead of a report
//
// Exit code: 0 (matches are information, not errors), 1 if the file can't be read.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Words that rank or compare, grouped for the report. */
export const SUPERLATIVES = Object.freeze({
  ranking: ["most", "least", "first", "last", "only", "earliest", "latest", "best", "worst", "greatest", "main", "top"],
  size: ["largest", "biggest", "smallest", "longest", "shortest", "tallest", "highest", "lowest", "deepest", "widest", "heaviest", "lightest"],
  time: ["oldest", "newest", "youngest"],
  speed: ["fastest", "slowest"],
  distance: ["closest", "nearest", "farthest", "furthest"],
  other: ["hottest", "coldest", "brightest", "richest", "busiest", "densest"],
});

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Find every superlative in the question bank. Pure: no I/O.
 * @param {object[]} questions
 * @param {object} [options]
 * @param {boolean} [options.explanations] also search explanations
 * @param {string[]} [options.extraWords]
 * @returns {{ id: string, category: string, field: string, word: string, text: string }[]}
 *   one entry per word per field, in bank order
 */
export function findSuperlatives(questions, { explanations = false, extraWords = [] } = {}) {
  const words = [...new Set([...Object.values(SUPERLATIVES).flat(), ...extraWords.map((w) => w.toLowerCase())])];
  // Whole words only, so "first" matches but "firsthand" and "almost" don't.
  const pattern = new RegExp(`\\b(${words.map(escape).join("|")})\\b`, "gi");
  const matches = [];

  for (const q of Array.isArray(questions) ? questions : []) {
    const fields = [["question", q.question]];
    (q.options ?? []).forEach((option, i) => fields.push([`option ${"ABCD"[i] ?? i + 1}`, option]));
    if (explanations) fields.push(["explanation", q.explanation]);

    for (const [field, text] of fields) {
      if (typeof text !== "string") continue;
      const found = new Set([...text.matchAll(pattern)].map((m) => m[1].toLowerCase()));
      for (const word of found) matches.push({ id: q.id, category: q.category, field, word, text });
    }
  }
  return matches;
}

/** The text with every matched word wrapped in [brackets]. */
export function highlight(text, words) {
  if (words.length === 0) return text;
  const pattern = new RegExp(`\\b(${words.map(escape).join("|")})\\b`, "gi");
  return text.replace(pattern, "[$1]");
}

/* ---------- Command line ---------- */

async function main(argv) {
  const args = [...argv];
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return false;
    args.splice(i, 1);
    return true;
  };
  const explanations = take("--explanations");
  const asJson = take("--json");
  let extraWords = [];
  const wi = args.indexOf("--words");
  if (wi !== -1) {
    extraWords = (args[wi + 1] ?? "").split(",").map((w) => w.trim()).filter(Boolean);
    args.splice(wi, 2);
  }
  const path = args[0] ?? fileURLToPath(new URL("../data/questions.json", import.meta.url));

  let questions;
  try {
    questions = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    console.error(`✖ Could not read ${path}\n  ${err.message}`);
    process.exit(1);
  }

  const matches = findSuperlatives(questions, { explanations, extraWords });
  if (asJson) {
    console.log(JSON.stringify(matches, null, 2));
    return;
  }

  const searched = explanations ? "questions, options and explanations" : "questions and options";
  console.log(`Searched the ${searched} of ${questions.length} questions in ${path}\n`);
  if (matches.length === 0) {
    console.log("No superlative expressions found.");
    return;
  }

  // Group by question id, then by field, keeping bank order.
  const byId = new Map();
  for (const m of matches) {
    if (!byId.has(m.id)) byId.set(m.id, { category: m.category, fields: new Map() });
    const fields = byId.get(m.id).fields;
    if (!fields.has(m.field)) fields.set(m.field, { text: m.text, words: [] });
    fields.get(m.field).words.push(m.word);
  }

  for (const [id, { category, fields }] of byId) {
    console.log(`${id} (${category})`);
    for (const [field, { text, words }] of fields) {
      console.log(`  ${field.padEnd(11)} ${highlight(text, words)}`);
    }
    console.log();
  }

  const counts = {};
  for (const m of matches) counts[m.word] = (counts[m.word] ?? 0) + 1;
  const summary = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word, n]) => `${word} ×${n}`)
    .join(", ");
  console.log(`${matches.length} match(es) in ${byId.size} question(s): ${summary}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
