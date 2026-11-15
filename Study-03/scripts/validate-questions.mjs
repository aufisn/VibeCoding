#!/usr/bin/env node
// Validate data/questions.json against the rules in js/validate.js.
// Usage: node scripts/validate-questions.mjs [path/to/questions.json]
// Exit code: 1 if there are errors (or the file can't be read/parsed), 0 otherwise.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateQuestions } from "../js/validate.js";

const defaultPath = fileURLToPath(new URL("../data/questions.json", import.meta.url));
const path = process.argv[2] ?? defaultPath;

let list;
try {
  list = JSON.parse(await readFile(path, "utf8"));
} catch (err) {
  console.error(`✖ Could not read ${path}\n  ${err.message}`);
  process.exit(1);
}

const { errors, warnings } = validateQuestions(list);

console.log(`Checked ${Array.isArray(list) ? list.length : 0} questions in ${path}\n`);

if (errors.length > 0) {
  console.log(`✖ ${errors.length} error(s):`);
  for (const e of errors) console.log(`  - ${e}`);
  console.log();
}

if (warnings.length > 0) {
  console.log(`⚠ ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
  console.log();
}

console.log(`Summary: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
