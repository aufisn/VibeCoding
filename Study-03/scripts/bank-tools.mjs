// Shared helpers for the question-bank scripts (Node only).

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const QUESTIONS_PATH = fileURLToPath(new URL("../data/questions.json", import.meta.url));
export const BACKUP_DIR = fileURLToPath(new URL("../backups/", import.meta.url));

export async function readQuestions(path = QUESTIONS_PATH) {
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * The bank as text, in the file's existing layout: two-space indent, one
 * key per line, the options array on a single line, a blank line between
 * categories. Pure. Keep the bank grouped by category (add-questions.mjs
 * inserts new questions after the last one of their category).
 */
export function formatQuestions(questions) {
  const blocks = questions.map((q) => {
    const lines = Object.entries(q).map(([key, value]) => {
      const v = Array.isArray(value) ? `[${value.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(value);
      return `    ${JSON.stringify(key)}: ${v}`;
    });
    return `  {\n${lines.join(",\n")}\n  }`;
  });
  // A blank line where the category changes, as in the hand-written file.
  const body = blocks
    .map((block, i) => (i > 0 && questions[i].category !== questions[i - 1].category ? `\n${block}` : block))
    .join(",\n");
  return `[\n${body}\n]\n`;
}

/** "20261116-153012" in local time. */
export function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Copy data/questions.json to backups/questions-<timestamp>.json. Returns the path. */
export async function backupQuestions(date = new Date()) {
  await mkdir(BACKUP_DIR, { recursive: true });
  const target = `${BACKUP_DIR}questions-${timestamp(date)}.json`;
  await copyFile(QUESTIONS_PATH, target);
  return target;
}

export async function writeQuestions(questions, path = QUESTIONS_PATH) {
  await writeFile(path, formatQuestions(questions));
}
