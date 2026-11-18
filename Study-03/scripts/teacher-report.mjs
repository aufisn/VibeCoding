#!/usr/bin/env node
// Teacher mode: compare many players at a glance from their backup files.
//
// Each player's results live in their own browser, so a teacher collects the
// backup files (Statistics → Download backup) into one folder and runs:
//
//   node scripts/teacher-report.mjs <folder|file...> collect|overview|compare|insights|all [options]
//
// Options:
//   --players "Ana,Ben"   compare/overview/insights only these players
//   --since 2026-11-01    only games finished on or after this date
//   --mode full|category|speed   only games of this mode
//   --threshold 60        accuracy (%) under which a player is flagged for support
//   --inactive 7          days without a game before a player is flagged inactive
//   --include-flagged     keep runs the audit says are impossible (left out by default)
//   --now 2026-11-18      the date "today" means (default: today)
//   --out report.md       also write the Markdown to this file
//   --json                print JSON instead of Markdown
//
// Read-only: backup files are never changed. Backups are loaded through the
// game's own parseBackup(), and audited with auditRuns() from backup-report.mjs.
// Exit code: 0; 1 on bad arguments or when no backup could be read.

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseBackup, questionsByCategory, runDifficulty } from "../js/data-manager.js";
import { runMode } from "../js/storage.js";
import { CATEGORIES, MODES, TOTAL_QUESTIONS } from "../js/config.js";
import { auditRuns } from "./backup-report.mjs";

export const MODE_LIST = [MODES.FULL, MODES.CATEGORY, MODES.SPEED];
export const MODE_LABELS = { full: "Full Challenge", category: "By Category", speed: "Speed Quiz" };
const LEVELS = ["easy", "medium", "hard"];
const DAY = 86_400_000;

const pct = (c, q) => (q > 0 ? Math.round((c / q) * 100) : null);
const fmtPct = (v) => (v === null || v === undefined ? "–" : `${v}%`);
const fmtSigned = (v) => (v === null || v === undefined ? "–" : `${v > 0 ? "+" : ""}${v}`);

/* ---------- Collect ---------- */

/** "  Ana  Lee " and "ana lee" are the same player. Empty names have no key. */
export function normalizeName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Load every backup, audit it and merge the runs. Pure.
 * @param {{ name: string, text: string }[]} sources
 * @returns {{ files: object[], runs: object[], duplicates: number, flagged: object[] }}
 *   `runs` are unique runs, each with `source` (file name) and `player` (key).
 */
export function collectClass(sources, { now = new Date(), includeFlagged = false } = {}) {
  const files = [];
  const runs = [];
  const flagged = [];
  const seen = new Set();
  let duplicates = 0;

  for (const { name, text } of sources) {
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      files.push({ name, ok: false, error: parsed.error });
      continue;
    }
    let raw = parsed.runs.length;
    try {
      raw = JSON.parse(text).runs.length;
    } catch {
      /* parseBackup already accepted it */
    }
    const issues = auditRuns(parsed.runs, { now }).filter((i) => !i.problem.startsWith("duplicate"));
    const bad = new Set(issues.map((i) => i.index));
    const nicknames = new Set();
    let added = 0;

    parsed.runs.forEach((run, index) => {
      const key = normalizeName(run.nickname);
      nicknames.add(run.nickname.trim() || "(no name)");
      if (bad.has(index) && !includeFlagged) return;
      // A run from a shared or re-exported backup can arrive twice.
      const id = [run.finishedAt, key, run.total, run.points ?? "", runMode(run)].join("|");
      if (seen.has(id)) {
        duplicates++;
        return;
      }
      seen.add(id);
      // Unnamed runs can't be matched across devices: keep them per file.
      runs.push({ ...run, source: name, player: key || `(no name) · ${name}` });
      added++;
    });
    for (const i of issues) flagged.push({ file: name, ...i, kept: includeFlagged });
    files.push({
      name,
      ok: true,
      runs: parsed.runs.length,
      unreadable: Math.max(0, raw - parsed.runs.length),
      added,
      nicknames: [...nicknames],
      gamesPlayed: parsed.stats.gamesPlayed,
      issues: issues.length,
    });
  }

  // A named player found in several files: same person on two devices, or two
  // people with one nickname. Worth a look.
  const filesByPlayer = new Map();
  for (const r of runs) {
    if (!filesByPlayer.has(r.player)) filesByPlayer.set(r.player, { name: r.nickname.trim(), files: new Set() });
    filesByPlayer.get(r.player).files.add(r.source);
  }
  const multiFile = [...filesByPlayer]
    .filter(([k, v]) => v.files.size > 1 && !k.startsWith("(no name)"))
    .map(([, v]) => ({ player: v.name, files: [...v.files] }));

  return { files, runs, duplicates, flagged, multiFile };
}

/** Keep runs that match the filters. Pure. */
export function filterRuns(runs, { since, mode, players } = {}) {
  const from = since ? Date.parse(since) : null;
  const wanted = players?.length ? new Set(players.map(normalizeName)) : null;
  return runs.filter(
    (r) =>
      (from === null || Date.parse(r.finishedAt) >= from) &&
      (!mode || runMode(r) === mode) &&
      (!wanted || wanted.has(r.player) || wanted.has(normalizeName(r.nickname)))
  );
}

/* ---------- Per-player summary ---------- */

const accOf = (list) => pct(list.reduce((a, r) => a + r.total, 0), list.reduce((a, r) => a + (r.maxScore ?? TOTAL_QUESTIONS), 0));

/** One player's numbers, from their runs. Pure. */
export function summarizePlayer(key, runs, now = new Date()) {
  const list = [...runs].sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt)); // oldest first
  const latest = list.at(-1);
  const questions = list.reduce((a, r) => a + (r.maxScore ?? TOTAL_QUESTIONS), 0);
  const correct = list.reduce((a, r) => a + r.total, 0);
  const points = list.reduce((a, r) => a + (r.points ?? 0), 0);
  const sum = (field) => list.reduce((a, r) => a + (r[field] ?? 0), 0);

  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, { correct: 0, questions: 0 }]));
  const byDifficulty = Object.fromEntries(LEVELS.map((d) => [d, { correct: 0, questions: 0 }]));
  for (const r of list) {
    const asked = questionsByCategory(r);
    for (const c of CATEGORIES) {
      byCategory[c].correct += r.byCategory?.[c] ?? 0;
      byCategory[c].questions += asked[c] ?? 0;
    }
    for (const d of LEVELS) {
      byDifficulty[d].correct += r.byDifficulty?.[d]?.correct ?? 0;
      byDifficulty[d].questions += r.byDifficulty?.[d]?.questions ?? 0;
    }
  }
  for (const v of [...Object.values(byCategory), ...Object.values(byDifficulty)]) v.accuracy = pct(v.correct, v.questions);

  const best = Object.fromEntries(
    MODE_LIST.map((m) => {
      const ofMode = list.filter((r) => runMode(r) === m);
      const top = ofMode.reduce((b, r) => ((r.points ?? -1) > (b?.points ?? -1) ? r : b), null);
      return [m, { games: ofMode.length, points: top?.points ?? null, correct: top ? `${top.total}/${top.maxScore ?? TOTAL_QUESTIONS}` : null, tier: top?.tier ?? null }];
    })
  );

  // Trend: the latest games against the earlier ones (needs 4 or more games).
  let trend = null;
  if (list.length >= 4) {
    const n = Math.min(5, Math.floor(list.length / 2));
    const recent = accOf(list.slice(-n));
    const earlier = accOf(list.slice(0, -n));
    trend = { recentGames: n, recent, earlier, change: recent - earlier };
  }

  // Strongest / weakest need a fair sample (5+ questions in the category).
  const ranked = CATEGORIES.filter((c) => byCategory[c].questions >= 5).sort((a, b) => byCategory[b].accuracy - byCategory[a].accuracy);

  return {
    key,
    name: latest.nickname.trim() || key,
    files: [...new Set(list.map((r) => r.source))],
    games: list.length,
    questions,
    correct,
    accuracy: pct(correct, questions),
    points,
    pointsPerQuestion: questions ? Math.round((points / questions) * 10) / 10 : null,
    bestStreak: Math.max(0, ...list.map((r) => r.bestStreak ?? 0)),
    hints: sum("eliminated"),
    skipped: sum("skipped"),
    timedOut: sum("timedOut"),
    best,
    byCategory,
    byDifficulty,
    difficultiesPlayed: [...new Set(list.map(runDifficulty))],
    strongest: ranked.length > 1 ? ranked[0] : null,
    weakest: ranked.length > 1 ? ranked.at(-1) : null,
    latestTier: latest.tier ?? null,
    firstPlayedAt: list[0].finishedAt,
    lastPlayedAt: latest.finishedAt,
    daysSinceLast: Math.max(0, Math.floor((now.getTime() - Date.parse(latest.finishedAt)) / DAY)),
    trend,
  };
}

/** Players with fewer questions than this are ranked after the others: too little to compare fairly. */
export const MIN_QUESTIONS = 20;

/**
 * Every player's summary: players with enough data first, then by accuracy,
 * more games, name. Pure.
 */
export function summarizeClass(runs, now = new Date()) {
  const groups = new Map();
  for (const r of runs) {
    if (!groups.has(r.player)) groups.set(r.player, []);
    groups.get(r.player).push(r);
  }
  return [...groups]
    .map(([key, list]) => summarizePlayer(key, list, now))
    .sort((a, b) => Number(b.questions >= MIN_QUESTIONS) - Number(a.questions >= MIN_QUESTIONS) || (b.accuracy ?? -1) - (a.accuracy ?? -1) || b.games - a.games || a.name.localeCompare(b.name));
}

/* ---------- Compare ---------- */

/** Side-by-side rows (one per measure) with the leader of each. Pure. */
export function comparePlayers(players) {
  const row = (label, values, { higherIsBetter = true, format = String } = {}) => {
    const nums = values.filter((v) => typeof v === "number");
    const top = nums.length > 1 ? (higherIsBetter ? Math.max(...nums) : Math.min(...nums)) : null;
    const leaders = top === null ? [] : players.filter((_, i) => values[i] === top).map((p) => p.name);
    return { label, values: values.map((v) => (v === null || v === undefined ? "–" : format(v))), leaders: leaders.length === players.length ? [] : leaders };
  };
  return {
    players: players.map((p) => p.name),
    general: [
      row("Games", players.map((p) => p.games)),
      row("Accuracy", players.map((p) => p.accuracy), { format: fmtPct }),
      row("Points per question", players.map((p) => p.pointsPerQuestion)),
      row("Best streak", players.map((p) => p.bestStreak)),
      row("Trend (recent vs earlier)", players.map((p) => p.trend?.change ?? null), { format: (v) => `${fmtSigned(v)} pts` }),
      row("Hints per game", players.map((p) => Math.round((p.hints / p.games) * 10) / 10), { higherIsBetter: false }),
    ],
    categories: CATEGORIES.map((c) => row(c, players.map((p) => p.byCategory[c].accuracy), { format: fmtPct })),
    difficulties: LEVELS.map((d) => row(d[0].toUpperCase() + d.slice(1), players.map((p) => p.byDifficulty[d].accuracy), { format: fmtPct })),
    bestByMode: MODE_LIST.map((m) => row(`Best ${MODE_LABELS[m]}`, players.map((p) => p.best[m].points), { format: (v) => `${v} pts` })),
  };
}

/* ---------- Insights ---------- */

/** What a teacher should act on. Pure. */
export function classInsights(players, { threshold = 60, inactiveDays = 7 } = {}) {
  const pooled = (pick, keys) =>
    keys
      .map((k) => {
        const correct = players.reduce((a, p) => a + pick(p)[k].correct, 0);
        const questions = players.reduce((a, p) => a + pick(p)[k].questions, 0);
        const values = players.map((p) => pick(p)[k].accuracy).filter((v) => v !== null);
        return {
          name: k,
          correct,
          questions,
          accuracy: pct(correct, questions),
          spread: values.length > 1 ? Math.max(...values) - Math.min(...values) : null,
        };
      })
      .filter((x) => x.questions > 0);

  const categories = pooled((p) => p.byCategory, CATEGORIES).sort((a, b) => a.accuracy - b.accuracy);
  const difficulties = pooled((p) => p.byDifficulty, LEVELS).map((d) => ({ ...d, name: d.name[0].toUpperCase() + d.name.slice(1) }));
  const enough = (p) => p.questions >= MIN_QUESTIONS;

  return {
    players: players.length,
    games: players.reduce((a, p) => a + p.games, 0),
    classAccuracy: pct(players.reduce((a, p) => a + p.correct, 0), players.reduce((a, p) => a + p.questions, 0)),
    categories, // weakest first: the topic to revisit
    difficulties,
    widestGap: [...categories].filter((c) => c.spread !== null).sort((a, b) => b.spread - a.spread)[0] ?? null,
    needSupport: players
      .filter((p) => enough(p) && (p.accuracy < threshold || (p.trend && p.trend.change <= -10)))
      .map((p) => ({
        name: p.name,
        accuracy: p.accuracy,
        trend: p.trend?.change ?? null,
        weakest: p.weakest,
        reason:
          p.accuracy < threshold
            ? `accuracy ${p.accuracy}% is under ${threshold}%${p.trend?.change >= 10 ? `, but improving fast (${fmtSigned(p.trend.change)} points)` : ""}`
            : `down ${-p.trend.change} points recently (${p.trend.earlier}% → ${p.trend.recent}%)`,
      })),
    mostImproved: players
      .filter((p) => p.trend && p.trend.change >= 10)
      .sort((a, b) => b.trend.change - a.trend.change)
      .map((p) => ({ name: p.name, from: p.trend.earlier, to: p.trend.recent, change: p.trend.change })),
    topPerformers: players.filter((p) => enough(p) && p.accuracy >= threshold).slice(0, 3).map((p) => ({ name: p.name, accuracy: p.accuracy, games: p.games })),
    inactive: players.filter((p) => p.daysSinceLast >= inactiveDays).map((p) => ({ name: p.name, days: p.daysSinceLast })),
    notEnoughData: players.filter((p) => !enough(p)).map((p) => ({ name: p.name, questions: p.questions })),
    habits: players.flatMap((p) => {
      const out = [];
      const perQ = (n) => n / p.questions;
      if (perQ(p.hints) > 0.3) out.push({ name: p.name, habit: `uses Eliminate on ${Math.round(perQ(p.hints) * 100)}% of questions` });
      if (perQ(p.skipped) > 0.15) out.push({ name: p.name, habit: `skips ${Math.round(perQ(p.skipped) * 100)}% of questions` });
      if (p.timedOut >= 5) out.push({ name: p.name, habit: `ran out of time ${p.timedOut} times in Speed Quiz` });
      return out;
    }),
  };
}

/* ---------- Markdown ---------- */

export function mdTable(headers, rows) {
  const esc = (v) => String(v).replace(/\|/g, "\\|");
  return [`| ${headers.map(esc).join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");
}

export function renderCollect(c) {
  const out = ["## Collected backups", ""];
  out.push(
    mdTable(
      ["File", "Status", "Runs", "Used", "Players in file", "Flagged"],
      c.files.map((f) => (f.ok ? [f.name, "✔ read", f.runs + (f.unreadable ? ` (+${f.unreadable} unreadable)` : ""), f.added, f.nicknames.join(", "), f.issues || "–"] : [f.name, `✖ ${f.error}`, "–", "–", "–", "–"]))
    )
  );
  const players = new Set(c.runs.map((r) => r.player));
  out.push("", `**${c.runs.length} unique games from ${players.size} player(s)** in ${c.files.filter((f) => f.ok).length} of ${c.files.length} file(s). Duplicates skipped: ${c.duplicates}.`);
  if (c.files.some((f) => f.ok && f.nicknames.length > 1)) out.push("", "ℹ Some files hold several nicknames: a shared device. Each nickname is treated as its own player.");
  for (const m of c.multiFile) out.push("", `ℹ "${m.player}" appears in ${m.files.join(" and ")}: one player on two devices, or two players with the same nickname. They are merged; ask if they shouldn't be.`);
  if (c.runs.some((r) => r.player.startsWith("(no name)"))) out.push("", "ℹ Games without a nickname are grouped per file, since they can't be matched across devices.");
  if (c.flagged.length) {
    out.push("", `### Impossible scores (${c.flagged[0].kept ? "kept" : "left out"})`, "");
    out.push(mdTable(["File", "Player", "Finished", "Problem"], c.flagged.map((i) => [i.file, i.nickname, i.finishedAt.slice(0, 16).replace("T", " "), i.problem])));
  }
  return out.join("\n");
}

export function renderOverview(players) {
  const rows = players.map((p, i) => [
    p.questions >= MIN_QUESTIONS ? i + 1 : "–",
    p.questions >= MIN_QUESTIONS ? p.name : `${p.name} *`,
    p.games,
    `${fmtPct(p.accuracy)} (${p.correct}/${p.questions})`,
    p.best.full.points ?? "–",
    p.best.speed.points ?? "–",
    p.bestStreak,
    p.latestTier ?? "–",
    p.strongest ?? "–",
    p.weakest ?? "–",
    p.trend ? fmtSigned(p.trend.change) : "–",
    p.lastPlayedAt.slice(0, 10),
  ]);
  return [
    "## Class overview",
    "",
    "Ranked by accuracy (correct answers out of questions asked), which compares fairly across modes and run lengths.",
    "",
    mdTable(["#", "Player", "Games", "Accuracy", "Best Full", "Best Speed", "Streak", "Latest rank", "Strongest", "Weakest", "Trend", "Last played"], rows),
    ...(players.some((p) => p.questions < MIN_QUESTIONS) ? ["", `\\* Fewer than ${MIN_QUESTIONS} questions answered: not ranked yet.`] : []),
    "",
    "Trend: accuracy in the latest games minus the earlier ones, in percentage points (needs 4+ games).",
  ].join("\n");
}

export function renderCompare(cmp) {
  const section = (title, rows) => [`### ${title}`, "", mdTable(["Measure", ...cmp.players, "Leader"], rows.map((r) => [r.label, ...r.values, r.leaders.join(", ") || "–"]))].join("\n");
  return [
    "## Side-by-side comparison",
    "",
    section("General", cmp.general),
    "",
    section("Accuracy by category", cmp.categories),
    "",
    section("Accuracy by difficulty", cmp.difficulties),
    "",
    section("Best scores by mode", cmp.bestByMode),
  ].join("\n");
}

export function renderInsights(ins, { threshold, inactiveDays }) {
  const out = ["## Insights", "", `${ins.players} players, ${ins.games} games, class accuracy ${fmtPct(ins.classAccuracy)}.`, ""];
  out.push("### Class accuracy by category (weakest first)", "", mdTable(["Category", "Correct", "Accuracy", "Gap between players"], ins.categories.map((c) => [c.name, `${c.correct}/${c.questions}`, fmtPct(c.accuracy), c.spread === null ? "–" : `${c.spread} pts`])));
  out.push("", "### Class accuracy by difficulty", "", mdTable(["Difficulty", "Correct", "Accuracy"], ins.difficulties.map((d) => [d.name, `${d.correct}/${d.questions}`, fmtPct(d.accuracy)])));
  const list = (title, items, fmt) => out.push("", `### ${title}`, "", ...(items.length ? items.map((x) => `- ${fmt(x)}`) : ["- None"]));
  list(`Needs support (under ${threshold}% or falling)`, ins.needSupport, (x) => `**${x.name}**: ${x.reason}${x.weakest ? `; weakest in ${x.weakest}` : ""}`);
  list("Most improved", ins.mostImproved, (x) => `**${x.name}**: ${x.from}% → ${x.to}% (${fmtSigned(x.change)} points)`);
  list("Top performers", ins.topPerformers, (x) => `**${x.name}**: ${x.accuracy}% over ${x.games} games`);
  list(`Inactive (${inactiveDays}+ days)`, ins.inactive, (x) => `**${x.name}**: last game ${x.days} days ago`);
  list(`Not enough data yet (under ${MIN_QUESTIONS} questions)`, ins.notEnoughData, (x) => `**${x.name}**: ${x.questions} questions answered`);
  list("Habits worth a word", ins.habits, (x) => `**${x.name}** ${x.habit}`);
  if (ins.categories.length) {
    const weakest = ins.categories[0];
    out.push("", `**Suggested focus:** revisit **${weakest.name}** (class accuracy ${weakest.accuracy}%).${ins.widestGap && ins.widestGap.spread >= 30 ? ` Players differ most in **${ins.widestGap.name}** (${ins.widestGap.spread} points apart): pairing stronger and weaker players there may help.` : ""}`);
  }
  return out.join("\n");
}

/* ---------- Command line ---------- */

async function readSources(paths) {
  const sources = [];
  for (const p of paths) {
    const info = await stat(p);
    const files = info.isDirectory() ? (await readdir(p)).filter((f) => f.endsWith(".json")).sort().map((f) => join(p, f)) : [p];
    for (const f of files) sources.push({ name: basename(f), text: await readFile(f, "utf8") });
  }
  return sources;
}

async function main(argv) {
  const args = [...argv];
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return false;
    args.splice(i, 1);
    return true;
  };
  const COMMANDS = ["collect", "overview", "compare", "insights", "all"];
  const asJson = flag("--json");
  const includeFlagged = flag("--include-flagged");
  const players = opt("--players")?.split(",").map((s) => s.trim()).filter(Boolean);
  const since = opt("--since");
  const mode = opt("--mode");
  const threshold = Number(opt("--threshold") ?? 60);
  const inactiveDays = Number(opt("--inactive") ?? 7);
  const nowArg = opt("--now");
  const outFile = opt("--out");
  const command = COMMANDS.includes(args.at(-1)) ? args.pop() : "all";
  const paths = args.length ? args : ["class"];

  if (mode && !MODE_LIST.includes(mode)) return fail(`--mode must be one of: ${MODE_LIST.join(", ")}`);
  if (since && Number.isNaN(Date.parse(since))) return fail("--since must be a date, e.g. 2026-11-01");
  if (!(threshold >= 0 && threshold <= 100) || !(inactiveDays >= 0)) return fail("--threshold must be 0–100 and --inactive 0 or more");
  const now = nowArg ? new Date(nowArg) : new Date();
  if (Number.isNaN(now.getTime())) return fail("--now must be a date, e.g. 2026-11-18");

  let sources;
  try {
    sources = await readSources(paths);
  } catch (err) {
    return fail(`Could not read ${paths.join(", ")}\n  ${err.message}\n  Put the players' backup files (quiz-backup-*.json) in a folder, e.g. class/`);
  }
  if (!sources.length) return fail(`No .json backup files in ${paths.join(", ")}`);

  const collected = collectClass(sources, { now, includeFlagged });
  if (!collected.files.some((f) => f.ok)) {
    console.error(renderCollect(collected));
    return fail("None of the files is a Quiz Game backup.");
  }
  const runs = filterRuns(collected.runs, { since, mode, players });
  const summaries = summarizeClass(runs, now);
  if (players?.length) {
    const found = new Set(summaries.flatMap((p) => [p.key, normalizeName(p.name)]));
    const missing = players.filter((n) => !found.has(normalizeName(n)));
    if (missing.length) console.error(`⚠ No games for: ${missing.join(", ")}`);
  }

  const filters = [since && `since ${since}`, mode && MODE_LABELS[mode], players?.length && `players: ${players.join(", ")}`].filter(Boolean);
  const header = `# Teacher report\n\nFrom ${paths.join(", ")}, as of ${now.toISOString().slice(0, 10)}${filters.length ? ` (${filters.join("; ")})` : ""}.`;
  const opts = { threshold, inactiveDays };
  const parts = {
    collect: () => renderCollect(collected),
    overview: () => renderOverview(summaries),
    compare: () => (summaries.length > 1 ? renderCompare(comparePlayers(summaries)) : "## Side-by-side comparison\n\nNeeds at least two players."),
    insights: () => renderInsights(classInsights(summaries, opts), opts),
  };

  if (asJson) {
    const data = {
      now: now.toISOString(),
      filters: { since: since ?? null, mode: mode ?? null, players: players ?? null },
      collect: { files: collected.files, uniqueRuns: collected.runs.length, duplicates: collected.duplicates, flagged: collected.flagged, multiFile: collected.multiFile },
      players: summaries,
      compare: summaries.length > 1 ? comparePlayers(summaries) : null,
      insights: classInsights(summaries, opts),
    };
    const pick = command === "all" ? data : { now: data.now, filters: data.filters, [command === "overview" ? "players" : command]: command === "overview" ? summaries : data[command] };
    return console.log(JSON.stringify(pick, null, 2));
  }

  const body = command === "all" ? [header, parts.collect(), parts.overview(), parts.compare(), parts.insights()] : [header, parts[command]()];
  if (summaries.length === 0 && command !== "collect") body.push("\nNo games match these filters.");
  const markdown = body.join("\n\n") + "\n";
  console.log(markdown);
  if (outFile) {
    await writeFile(outFile, markdown);
    console.error(`✔ Wrote ${outFile}`);
  }
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
