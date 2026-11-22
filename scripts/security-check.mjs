#!/usr/bin/env node
// Security check for the whole VibeCoding repo. It enforces the secret rules in
// CLAUDE.md, so a mistake is caught even if every person and agent misses it.
//
//   node scripts/security-check.mjs           check every tracked and new file
//   node scripts/security-check.mjs --staged  check what is about to be committed
//                                             (run by the git pre-commit hook)
//
// It never prints a secret: it reads the values in each .env and .fc_gist_id
// only to make sure they don't appear anywhere they shouldn't.
// Exit code 1 means "blocked". To bypass in a real emergency, `git commit
// --no-verify`, but tell the user why.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGED = process.argv.includes("--staged");
const SELF = "scripts/security-check.mjs";

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const files = (STAGED ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR") : git("ls-files", "-co", "--exclude-standard"))
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.includes("node_modules/"));

const read = (f) => {
  try {
    return STAGED ? git("show", `:${f}`) : readFileSync(join(ROOT, f), "utf8");
  } catch {
    return null; // deleted or binary
  }
};

/* ---------- The real secret values, so a leak of any of them is caught ---------- */
function secretValues() {
  const values = [];
  const studies = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && /^Study-\d+$/.test(d.name));
  for (const dir of ["", ...studies.map((d) => d.name)]) {
    const env = join(ROOT, dir, ".env");
    if (existsSync(env)) {
      for (const line of readFileSync(env, "utf8").split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*["']?([^"'#\s]+)/.exec(line);
        // Only secret-looking settings (keys, tokens, IDs); model names etc. are public.
        if (m && /KEY|TOKEN|SECRET|PASS|WORKSPACE|GIST/.test(m[1]) && m[2].length >= 12) values.push(m[2]);
      }
    }
    const gist = join(ROOT, dir, ".fc_gist_id");
    if (existsSync(gist)) {
      const id = readFileSync(gist, "utf8").trim();
      if (id.length >= 12) values.push(id);
    }
  }
  return values;
}

/* ---------- Rules ---------- */
const CODE = new Set([".html", ".htm", ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".vue", ".svelte"]);
const PAGE = new Set([".html", ".htm"]);
const problems = [];
const warnings = [];
const add = (list, file, text, why) => {
  const at = text === null ? "" : `:${text}`;
  list.push(`${file}${at}  ${why}`);
};
const lineOf = (content, index) => content.slice(0, index).split("\n").length;

const FAKE = /x{8,}|0{8,}|fake|test|dummy|example|placeholder/i;
const SECRET_SHAPES = [
  [/sk-ant-[A-Za-z0-9_-]{30,}/, "looks like a real Anthropic API key"],
  [/sk-(?:proj-)?[A-Za-z0-9]{40,}/, "looks like a real OpenAI-style API key"],
  [/sk-or-v1-[a-f0-9]{40,}/, "looks like a real OpenRouter key"],
  [/ghp_[A-Za-z0-9]{36}/, "looks like a real GitHub token"],
  [/github_pat_[A-Za-z0-9_]{60,}/, "looks like a real GitHub fine-grained token"],
];

// Code that would put an AI key in (or send it from) the browser.
const BROWSER_KEY_RULES = [
  [/anthropic-dangerous-direct-browser-access/i, "calls the Anthropic API straight from the browser (the key would live in the page)"],
  [/dangerouslyAllowBrowser\s*:\s*true/, "lets an AI SDK run in the browser with a key"],
  [/["']x-api-key["']\s*:/i, "sends an API key header from code that may run in a browser"],
];
const STORAGE_KEY_RULE = /(localStorage|sessionStorage|indexedDB|document\.cookie)[^\n]{0,160}(api[_-]?key|apiKey|anthropic|openai|sk-ant)/i;

const leaked = secretValues();

for (const f of files) {
  if (f === SELF) continue;
  const base = f.split("/").pop();
  if (base === ".env" || /^\.env\.(?!example$)/.test(base) || base === ".fc_gist_id") {
    add(problems, f, null, "secret file must never be committed");
    continue;
  }
  const content = read(f);
  if (content === null || content.includes("\u0000")) continue;

  for (const value of leaked) {
    const i = content.indexOf(value);
    if (i !== -1) add(problems, f, lineOf(content, i), "contains a real secret value from a .env or .fc_gist_id file");
  }
  for (const [re, why] of SECRET_SHAPES) {
    const m = re.exec(content);
    // Obvious placeholders in tests and examples (xxxx, 0000, "fake", "test") are fine.
    if (m && !FAKE.test(m[0])) add(problems, f, lineOf(content, m.index), why);
  }

  const ext = extname(f).toLowerCase();
  const isServer = /(^|\/)(server|ci|scripts)(\/|\.mjs$)|server\.m?js$/.test(f) || f.startsWith("scripts/");
  const isTest = /(^|\/)tests?\//.test(f) || /\.test\.m?js$/.test(f);
  if (CODE.has(ext) && !isServer && !isTest) {
    for (const [re, why] of BROWSER_KEY_RULES) {
      const m = re.exec(content);
      if (m) add(problems, f, lineOf(content, m.index), why);
    }
    const m = STORAGE_KEY_RULE.exec(content);
    if (m) add(problems, f, lineOf(content, m.index), "stores an API key in browser storage");
  }
  if (PAGE.has(ext)) {
    // A password field whose label or attributes (within ~200 characters) talk about an AI API key.
    const re = /type=["']password["']/gi;
    for (let m; (m = re.exec(content)); ) {
      const near = content.slice(Math.max(0, m.index - 200), m.index + 200);
      if (/api[ _-]?key|anthropic|openai|sk-ant/i.test(near)) {
        add(problems, f, lineOf(content, m.index), "asks the user to paste an API key into the page");
        break;
      }
    }
  }

  if (/^\.github\/workflows\/.+\.ya?ml$/.test(f)) {
    content.split("\n").forEach((line, n) => {
      if (/^\s*(-\s*)?run:.*\$\{\{/.test(line)) add(problems, f, n + 1, "uses ${{ }} inside run: (pass it through env: instead)");
      if (/uses:\s*[^@\s]+@(?![0-9a-f]{40}\b)/.test(line) && !/uses:\s*\.\//.test(line)) add(warnings, f, n + 1, "action not pinned to a full commit SHA");
    });
  }

  if (CODE.has(ext) && /\.innerHTML\s*=(?!=)/.test(content)) {
    const i = content.search(/\.innerHTML\s*=(?!=)/);
    add(warnings, f, lineOf(content, i), "innerHTML assignment: make sure no user or AI text reaches it");
  }
}

for (const w of warnings) console.log(`warning  ${w}`);
if (problems.length) {
  console.error(`\nSECURITY CHECK FAILED (${problems.length}):`);
  for (const p of problems) console.error(`  BLOCK  ${p}`);
  console.error("\nSee the security rules in CLAUDE.md. Fix these before committing.");
  process.exit(1);
}
console.log(`Security check passed (${files.length} files${STAGED ? ", staged" : ""}).`);
