#!/usr/bin/env node
// Reports from a Quiz Game backup file (Statistics → Download backup).
// Used by the /quiz-stats and /quiz-leaderboard skills. Read-only: the
// backup file is never changed.
//
// Usage:
//   node scripts/backup-report.mjs <backup.json> stats [--json]
//   node scripts/backup-report.mjs <backup.json> leaderboard
//        [--period all|week|day] [--mode full|category|speed]
//        [--difficulty mixed|easy|medium|hard] [--limit 10] [--now ISO-date] [--json]
//   node scripts/backup-report.mjs <backup.json> audit [--json]
//
// The backup is loaded through the game's own code (parseBackup and
// LocalDataManager in js/data-manager.js), so the numbers match the app.
// Exit code: 0; 1 if the file can't be read or isn't a backup;
// 2 if "audit" finds problems.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { LocalDataManager, PERIODS, parseBackup, runDifficulty } from "../js/data-manager.js";
import { runMode } from "../js/storage.js";
import { tierFor } from "../js/scoring.js";
import { DIFFICULTY_CHOICES, MODES, RANK_TIERS, SCORING, TOTAL_QUESTIONS } from "../js/config.js";

const MODE_LIST = [MODES.FULL, MODES.CATEGORY, MODES.SPEED];
const MODE_LABELS = { full: "Full Challenge", category: "By Category", speed: "Speed Quiz" };
const PERIOD_LABELS = { all: "Overall", week: "This week", day: "Today" };

/** A Storage-like object in memory, so the real LocalDataManager can run in Node. */
export function memoryStore() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

/** Load a backup's text into a LocalDataManager. Returns { ok, manager, parsed } or { ok: false, error }. */
export function loadBackup(text, now = () => new Date()) {
  const parsed = parseBackup(text);
  if (!parsed.ok) return parsed;
  const manager = new LocalDataManager({ store: memoryStore(), now });
  manager.restoreBackup(parsed);
  return { ok: true, manager, parsed };
}

/* ---------- Audit: impossible or inconsistent scores ---------- */

/** Most points a run with `correct` right answers can earn under SCORING. */
export function maxPointsFor(correct, rules = SCORING) {
  const best = Math.max(...Object.values(rules.multipliers)) * rules.base + rules.fastBonus + rules.noHintBonus;
  let streak = 0;
  for (let s = 1; s <= correct; s++) {
    if (rules.streakBonuses[s] !== undefined) streak += rules.streakBonuses[s];
    else if (rules.streakRepeatEvery && s > rules.streakRepeatEvery && s % rules.streakRepeatEvery === 0) {
      streak += rules.streakBonuses[rules.streakRepeatEvery] ?? 0;
    }
  }
  return correct * best + streak;
}

/**
 * Problems in saved runs: things the game can't produce, which point to an
 * edited or damaged backup (or a bug). Pure.
 * @returns {{ index: number, nickname: string, finishedAt: string, problem: string }[]}
 */
export function auditRuns(runs, { now = new Date(), rules = SCORING } = {}) {
  const issues = [];
  const seen = new Set();
  runs.forEach((run, index) => {
    const add = (problem) => issues.push({ index, nickname: run.nickname || "Anonymous", finishedAt: run.finishedAt, problem });
    const max = run.maxScore ?? TOTAL_QUESTIONS;

    if (run.total > max) add(`${run.total} correct out of only ${max} questions`);
    if (max > TOTAL_QUESTIONS) add(`${max} questions, but a game has at most ${TOTAL_QUESTIONS}`);

    const catSum = Object.values(run.byCategory ?? {}).reduce((a, b) => a + b, 0);
    if (Object.keys(run.byCategory ?? {}).length && catSum !== run.total) {
      add(`categories add up to ${catSum} correct, but the total says ${run.total}`);
    }
    for (const [c, n] of Object.entries(run.byCategory ?? {})) {
      const asked = run.questionsByCategory?.[c];
      if (asked !== undefined && n > asked) add(`${n} correct in ${c} out of ${asked} asked`);
    }
    for (const [d, v] of Object.entries(run.byDifficulty ?? {})) {
      if (v && v.correct > v.questions) add(`${v.correct} correct ${d} answers out of ${v.questions} asked`);
    }

    if (typeof run.points === "number") {
      const most = maxPointsFor(run.total, rules);
      const least = run.total * rules.base * Math.min(...Object.values(rules.multipliers));
      if (run.points > most) add(`${run.points} points, but ${run.total} correct answers can earn at most ${most}`);
      if (run.points < least) add(`${run.points} points, but ${run.total} correct answers earn at least ${least}`);
      if (run.bonuses) {
        const sum = ["base", "time", "noHint", "streak"].reduce((a, k) => a + (run.bonuses[k] ?? 0), 0);
        if (sum !== run.points) add(`the points breakdown adds up to ${sum}, not ${run.points}`);
      }
    }
    if (typeof run.bestStreak === "number" && run.bestStreak > run.total) {
      add(`best streak ${run.bestStreak} is longer than the ${run.total} correct answers`);
    }
    if (typeof run.tier === "string" && max > 0) {
      const expected = tierFor(run.total, RANK_TIERS, max).name;
      if (run.tier !== expected) add(`rank "${run.tier}" should be "${expected}" for ${run.total} of ${max}`);
    }
    if (Date.parse(run.finishedAt) > now.getTime() + 24 * 3600 * 1000) add("finished in the future");

    const key = `${run.finishedAt}|${run.nickname}|${run.total}`;
    if (seen.has(key)) add("duplicate of another run");
    seen.add(key);
  });
  return issues;
}

/* ---------- Statistics report ---------- */

const pct = (c, q) => (q > 0 ? Math.round((c / q) * 100) : null);

/** The statistics plus a few derived insights. Pure (given a loaded manager). */
export function statsReport(manager) {
  const stats = manager.getStats();
  const games = manager.getGames(); // newest first
  const categories = manager.getCategoryStats().map((c) => ({ ...c, accuracy: pct(c.correct, c.questions) }));
  const difficulties = manager.getDifficultyStats().map((d) => ({ ...d, accuracy: pct(d.correct, d.questions) }));

  // Recent form: the latest 5 games against all saved games.
  const acc = (list) => pct(list.reduce((a, r) => a + r.total, 0), list.reduce((a, r) => a + (r.maxScore ?? TOTAL_QUESTIONS), 0));
  const recent = games.slice(0, 5);
  const played = categories.filter((c) => c.questions > 0).sort((a, b) => b.accuracy - a.accuracy);

  // Where the points come from (games saved with a breakdown).
  const withBonuses = games.filter((g) => g.bonuses);
  const bonusTotals = withBonuses.reduce(
    (t, g) => ({ base: t.base + g.bonuses.base, time: t.time + g.bonuses.time, noHint: t.noHint + g.bonuses.noHint, streak: t.streak + g.bonuses.streak }),
    { base: 0, time: 0, noHint: 0, streak: 0 }
  );

  return {
    gamesPlayed: stats.gamesPlayed,
    savedGames: games.length,
    firstPlayedAt: stats.firstPlayedAt,
    lastPlayedAt: stats.lastPlayedAt,
    accuracy: pct(stats.totalCorrect, stats.totalQuestions),
    totalCorrect: stats.totalCorrect,
    totalQuestions: stats.totalQuestions,
    totalPoints: stats.totalPoints,
    averagePoints: stats.gamesPlayed ? Math.round(stats.totalPoints / stats.gamesPlayed) : null,
    bestStreak: stats.bestStreak,
    hintsUsed: stats.totalHints,
    skipped: stats.totalSkipped,
    timedOut: stats.totalTimedOut,
    byMode: MODE_LIST.map((mode) => {
      const m = stats.byMode[mode];
      return { mode: MODE_LABELS[mode], games: m.games, bestPoints: m.bestPoints, averagePoints: m.games ? Math.round(m.points / m.games) : null, accuracy: pct(m.correct, m.questions) };
    }),
    categories,
    difficulties,
    strongest: played[0]?.category ?? null,
    weakest: played.length > 1 ? played.at(-1).category : null,
    recentAccuracy: recent.length ? acc(recent) : null,
    savedAccuracy: games.length ? acc(games) : null,
    pointsFrom: withBonuses.length ? bonusTotals : null,
  };
}

/* ---------- Command line ---------- */

function table(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

async function main(argv) {
  const args = [...argv];
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const value = args[i + 1];
    args.splice(i, 2);
    return value;
  };
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return false;
    args.splice(i, 1);
    return true;
  };
  const asJson = flag("--json");
  const nowArg = opt("--now");
  const period = opt("--period") ?? PERIODS.ALL;
  const mode = opt("--mode");
  const difficulty = opt("--difficulty");
  const limit = Number(opt("--limit") ?? 10);
  const [file, command = "stats"] = args;

  if (!file) {
    console.error("Usage: node scripts/backup-report.mjs <backup.json> stats|leaderboard|audit [options]");
    process.exit(1);
  }
  if (!Object.values(PERIODS).includes(period)) return fail(`--period must be one of: ${Object.values(PERIODS).join(", ")}`);
  if (mode && !MODE_LIST.includes(mode)) return fail(`--mode must be one of: ${MODE_LIST.join(", ")}`);
  if (difficulty && !DIFFICULTY_CHOICES.includes(difficulty)) return fail(`--difficulty must be one of: ${DIFFICULTY_CHOICES.join(", ")}`);
  const now = nowArg ? new Date(nowArg) : new Date();
  if (Number.isNaN(now.getTime())) return fail("--now must be a date, e.g. 2026-11-16");

  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    return fail(`Could not read ${file}\n  ${err.message}`);
  }
  const loaded = loadBackup(text, () => now);
  if (!loaded.ok) return fail(loaded.error);
  const { manager, parsed } = loaded;
  let rawCount = 0;
  try {
    rawCount = JSON.parse(text).runs.length;
  } catch {
    /* parseBackup already accepted it */
  }
  const dropped = rawCount - parsed.runs.length;

  if (command === "stats") {
    const report = statsReport(manager);
    if (asJson) return console.log(JSON.stringify({ ...report, droppedRuns: dropped }, null, 2));
    console.log(`Statistics from ${file}\n`);
    console.log(`Games played: ${report.gamesPlayed} (${report.savedGames} saved individually)`);
    console.log(`Accuracy: ${report.accuracy ?? "–"}% (${report.totalCorrect} of ${report.totalQuestions})`);
    console.log(`Points: ${report.totalPoints} in total, ${report.averagePoints ?? "–"} per game. Best streak: ${report.bestStreak}`);
    console.log(`Hints used: ${report.hintsUsed}. Skipped: ${report.skipped}. Timed out: ${report.timedOut}`);
    if (report.recentAccuracy !== null) console.log(`Recent form: ${report.recentAccuracy}% in the latest ${Math.min(5, report.savedGames)} games, ${report.savedAccuracy}% across saved games`);
    console.log(`\nBy mode\n${table(report.byMode.map((m) => [m.mode, m.games, m.bestPoints || "–", m.averagePoints ?? "–", m.accuracy === null ? "–" : `${m.accuracy}%`]), ["Mode", "Games", "Best", "Avg pts", "Accuracy"])}`);
    console.log(`\nBy category\n${table(report.categories.map((c) => [c.category, `${c.correct}/${c.questions}`, c.accuracy === null ? "not played" : `${c.accuracy}%`]), ["Category", "Correct", "Accuracy"])}`);
    console.log(`\nBy difficulty\n${table(report.difficulties.map((d) => [d.difficulty, `${d.correct}/${d.questions}`, d.accuracy === null ? "not played" : `${d.accuracy}%`]), ["Difficulty", "Correct", "Accuracy"])}`);
    if (report.strongest) console.log(`\nStrongest category: ${report.strongest}${report.weakest ? `. Weakest: ${report.weakest}` : ""}`);
    if (report.pointsFrom) {
      const p = report.pointsFrom;
      const sum = p.base + p.time + p.noHint + p.streak;
      console.log(`Points come from: answers ${pct(p.base, sum)}%, speed ${pct(p.time, sum)}%, no hints ${pct(p.noHint, sum)}%, streaks ${pct(p.streak, sum)}%`);
    }
    if (dropped > 0) console.log(`\n⚠ ${dropped} unreadable run(s) in the file were skipped.`);
    return;
  }

  if (command === "leaderboard") {
    const modes = mode ? [mode] : MODE_LIST;
    const boards = modes.map((m) => ({
      mode: m,
      runs: manager.getLeaderboard({ period, mode: m, difficulty, limit }),
    }));
    if (asJson) return console.log(JSON.stringify({ period, difficulty: difficulty ?? "any", now: now.toISOString(), boards }, null, 2));
    console.log(`Leaderboard from ${file}: ${PERIOD_LABELS[period]}${difficulty ? `, ${difficulty}` : ", every difficulty"} (as of ${now.toISOString().slice(0, 10)})`);
    for (const { mode: m, runs } of boards) {
      console.log(`\n${MODE_LABELS[m]}`);
      if (runs.length === 0) {
        console.log("  (no runs)");
        continue;
      }
      console.log(
        table(
          runs.map((r, i) => [i + 1, r.nickname || "Anonymous", r.points ?? "–", `${r.total}/${r.maxScore ?? TOTAL_QUESTIONS}`, r.tier ?? "", runDifficulty(r), runMode(r) === "category" ? r.subject : "", r.finishedAt.slice(0, 10)]),
          ["#", "Name", "Points", "Correct", "Rank", "Difficulty", "Subject", "Date"]
        )
      );
    }
    return;
  }

  if (command === "audit") {
    const issues = auditRuns(parsed.runs, { now });
    if (asJson) {
      console.log(JSON.stringify({ checked: parsed.runs.length, dropped, issues }, null, 2));
    } else {
      console.log(`Audited ${parsed.runs.length} run(s) in ${file}${dropped ? ` (${dropped} unreadable run(s) skipped)` : ""}\n`);
      if (issues.length === 0) console.log("✔ No problems found: every score is possible under the game's rules.");
      for (const i of issues) console.log(`✖ ${i.nickname}, ${i.finishedAt.slice(0, 16).replace("T", " ")}: ${i.problem}`);
    }
    if (issues.length > 0 || dropped > 0) process.exitCode = 2;
    return;
  }

  fail(`Unknown command "${command}". Use stats, leaderboard or audit.`);
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
