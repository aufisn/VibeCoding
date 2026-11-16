#!/usr/bin/env node
// Back up data/questions.json to backups/questions-<timestamp>.json.
// Usage: node scripts/backup-questions.mjs

import { backupQuestions } from "./bank-tools.mjs";

try {
  const path = await backupQuestions();
  console.log(`✔ Backed up the question bank to ${path}`);
} catch (err) {
  console.error(`✖ Backup failed\n  ${err.message}`);
  process.exit(1);
}
