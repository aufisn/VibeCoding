#!/usr/bin/env node
// Turns a teacher report (reports/teacher-*.md, written by /teacher-mode) into
// CSV files for a spreadsheet: one CSV per table, plus one for the bullet lists
// (insights and the teacher's summary). Used by the /teacher-csv command.
//
// Usage:
//   node scripts/report-to-csv.mjs <report.md> [--out <folder>] [--json] [--force]
//
// Default output folder: next to the report, named after it with "-csv"
// (reports/teacher-2026-11-18.md → reports/teacher-2026-11-18-csv/).
// Files are UTF-8 with a byte order mark, so Excel shows ✔, → and accents
// correctly. The report itself is never changed.
// Only teacher reports (title "# Teacher report") unless --force.
// Exit code: 0; 1 if the report can't be read, isn't a teacher report, or holds no tables.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BOM = "﻿";

/** Split a Markdown table row into cells, honouring escaped pipes (\|). */
export function splitRow(line) {
  const cells = [];
  let cell = "";
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (body[i] === "|") {
      cells.push(cell);
      cell = "";
    } else cell += body[i];
  }
  cells.push(cell);
  return cells.map(cleanCell);
}

/** Plain text from a Markdown cell: no bold, code ticks or escape backslashes. */
export function cleanCell(text) {
  return String(text)
    .trim()
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\([*_|\\])/g, "$1");
}

const isSeparator = (line) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line);

/** "Side-by-side comparison" → "side-by-side-comparison". */
export function slug(text) {
  return cleanCell(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Every table and bullet list in the report, in order, with the headings above
 * it. Pure.
 * @returns {{ title: string|null, tables: { section, subsection, headers, rows }[], lists: { section, subsection, item }[] }}
 */
export function parseReport(markdown) {
  const lines = markdown.split(/\r?\n/);
  let title = null;
  let section = "";
  let subsection = "";
  const tables = [];
  const lists = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = /^#\s+(.*)/.exec(line))) title = cleanCell(m[1]);
    else if ((m = /^##\s+(.*)/.exec(line))) {
      section = cleanCell(m[1]);
      subsection = "";
    } else if ((m = /^###\s+(.*)/.exec(line))) subsection = cleanCell(m[1]);
    else if (line.trim().startsWith("|") && isSeparator(lines[i + 1] ?? "")) {
      const headers = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      i--;
      tables.push({ section, subsection, headers, rows });
    } else if ((m = /^\s*[-*]\s+(.*)/.exec(line))) {
      lists.push({ section, subsection, item: cleanCell(m[1]) });
    }
  }
  return { title, tables, lists };
}

/**
 * One CSV field: quoted when it holds a comma, quote or line break (RFC 4180).
 * Text a spreadsheet would run as a formula (=, @, a tab, or + / - that isn't a
 * plain number) gets a leading apostrophe: nicknames come from players.
 */
export function csvField(value) {
  let s = String(value ?? "");
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-]\d+(\.\d+)?%?$/.test(s))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows (arrays) to CSV text with CRLF line ends, as spreadsheets expect. */
export function toCsv(rows) {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/**
 * The CSV files for a parsed report: { name, rows }[]. Names are numbered so
 * they sort in report order. Pure.
 */
export function reportFiles(parsed) {
  const files = [];
  const used = new Set();
  parsed.tables.forEach((t, i) => {
    let base = slug(t.subsection ? `${t.section} ${t.subsection}` : t.section) || "table";
    while (used.has(base)) base += "-2";
    used.add(base);
    // Short rows (a trailing empty cell) are padded so every row has every column.
    const rows = t.rows.map((r) => [...r, ...Array(Math.max(0, t.headers.length - r.length)).fill("")]);
    files.push({ name: `${String(i + 1).padStart(2, "0")}-${base}.csv`, section: t.section, subsection: t.subsection, rows: [t.headers, ...rows] });
  });
  if (parsed.lists.length) {
    files.push({
      name: `${String(files.length + 1).padStart(2, "0")}-lists.csv`,
      section: "Lists",
      subsection: "",
      rows: [["Section", "Heading", "Item"], ...parsed.lists.map((l) => [l.section, l.subsection, l.item])],
    });
  }
  return files;
}

async function main(argv) {
  const args = [...argv];
  const take = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    return args.splice(i, 2)[1];
  };
  const asJson = args.includes("--json");
  if (asJson) args.splice(args.indexOf("--json"), 1);
  const outArg = take("--out");
  const force = args.includes("--force");
  if (force) args.splice(args.indexOf("--force"), 1);
  const [file] = args;
  if (!file) return fail("Usage: node scripts/report-to-csv.mjs <report.md> [--out <folder>] [--json]");

  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    return fail(`Could not read ${file}\n  ${err.message}`);
  }
  const parsed = parseReport(text);
  if (parsed.title !== "Teacher report" && !force) {
    return fail(`${file} isn't a teacher report (its title should be "# Teacher report"). Make one with /teacher-mode, or add --force to convert any Markdown tables.`);
  }
  if (!parsed.tables.length) return fail(`${file} has no tables.`);

  const outDir = outArg ?? join(dirname(file), `${basename(file).replace(/\.md$/i, "")}-csv`);
  const files = reportFiles(parsed);
  await mkdir(outDir, { recursive: true });
  for (const f of files) await writeFile(join(outDir, f.name), BOM + toCsv(f.rows));

  if (asJson) {
    return console.log(JSON.stringify({ report: file, title: parsed.title, outDir, files: files.map((f) => ({ name: f.name, section: f.section, subsection: f.subsection, columns: f.rows[0].length, rows: f.rows.length - 1 })) }, null, 2));
  }
  console.log(`CSV files from ${file} in ${outDir}/\n`);
  for (const f of files) console.log(`✔ ${f.name}  (${f.rows.length - 1} rows × ${f.rows[0].length} columns)  ${[f.section, f.subsection].filter(Boolean).join(" › ")}`);
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
