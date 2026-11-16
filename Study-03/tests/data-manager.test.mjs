import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LocalDataManager,
  PERIODS,
  STATS_KEY,
  applyGame,
  emptyStats,
  filterByPeriod,
  periodStart,
  rebuildStats,
} from "../js/data-manager.js";
import { RUNS_KEY } from "../js/storage.js";
import { fakeStorage, throwingStorage } from "./helpers.mjs";

// Local-time dates, so the day/week tests pass in any time zone.
// 2026-11-18 is a Wednesday.
const local = (d, h = 12, m = 0) => new Date(2026, 10, d, h, m);
const WEDNESDAY_NOON = local(18);

let seq = 0;
function game({ mode = "full", points = 100, total = 20, at = WEDNESDAY_NOON, subject, nickname } = {}) {
  seq += 1;
  const isCategory = mode === "category";
  const cats = isCategory ? [subject ?? "History"] : ["History", "Science", "Geography", "Arts & Culture"];
  const per = mode === "speed" ? 5 : 10;
  const correctEach = Math.floor(total / cats.length);
  return {
    nickname: nickname ?? `p${seq}`,
    finishedAt: at.toISOString(),
    mode,
    subject: isCategory ? cats[0] : mode === "speed" ? "Speed" : "All",
    points,
    total,
    maxScore: cats.length * per,
    byCategory: Object.fromEntries(cats.map((c) => [c, correctEach])),
    questionsByCategory: Object.fromEntries(cats.map((c) => [c, per])),
    skipped: 1,
    timedOut: 0,
    eliminated: 2,
    bestStreak: 4,
    tier: "Scholar",
  };
}

const manager = (store = fakeStorage(), now = WEDNESDAY_NOON) => new LocalDataManager({ store, now: () => now });

/* ---------- Saving ---------- */

test("saveGame saves the game and updates statistics automatically", () => {
  const store = fakeStorage();
  const dm = manager(store);
  assert.equal(dm.saveGame(game({ points: 300, total: 30 })), true);
  assert.equal(dm.getGames().length, 1);
  const stats = dm.getStats();
  assert.equal(stats.gamesPlayed, 1);
  assert.equal(stats.totalPoints, 300);
  assert.equal(stats.totalCorrect, 30);
  assert.equal(stats.totalQuestions, 40);
  assert.ok(store.getItem(STATS_KEY), "stats are stored, not just computed");
});

test("keeps the latest 100 games, newest first; stats keep counting past 100", () => {
  const dm = manager();
  for (let i = 1; i <= 105; i++) dm.saveGame(game({ points: i, at: new Date(local(1).getTime() + i * 60_000) }));
  const games = dm.getGames();
  assert.equal(games.length, 100);
  assert.equal(games[0].points, 105, "newest first");
  assert.equal(games.at(-1).points, 6, "the 5 oldest were dropped");
  assert.equal(dm.getStats().gamesPlayed, 105, "statistics include the dropped games");
});

/* ---------- Statistics ---------- */

test("statistics track totals, per mode and best values", () => {
  const dm = manager();
  dm.saveGame(game({ mode: "full", points: 400, total: 30 }));
  dm.saveGame(game({ mode: "full", points: 200, total: 20 }));
  dm.saveGame(game({ mode: "speed", points: 150, total: 12 }));
  const s = dm.getStats();
  assert.equal(s.gamesPlayed, 3);
  assert.equal(s.totalPoints, 750);
  assert.equal(s.totalSkipped, 3);
  assert.equal(s.totalHints, 6);
  assert.equal(s.bestStreak, 4);
  assert.deepEqual(s.byMode.full, { games: 2, points: 600, correct: 50, questions: 80, bestPoints: 400 });
  assert.equal(s.byMode.speed.questions, 20);
  assert.equal(s.byMode.category.games, 0);
});

test("category statistics add up across modes", () => {
  const dm = manager();
  dm.saveGame(game({ mode: "full", total: 32 })); // 8 of 10 in each category
  dm.saveGame(game({ mode: "category", subject: "Science", total: 6 })); // 6 of 10
  dm.saveGame(game({ mode: "speed", total: 12 })); // 3 of 5 in each
  const science = dm.getCategoryStats().find((c) => c.category === "Science");
  assert.deepEqual(science, { category: "Science", correct: 17, questions: 25, accuracy: 17 / 25 });
  const history = dm.getCategoryStats().find((c) => c.category === "History");
  assert.equal(history.questions, 15);
  assert.equal(dm.getCategoryStats().length, 4, "every category listed, in play order");
});

test("categories never played have no accuracy", () => {
  const dm = manager();
  dm.saveGame(game({ mode: "category", subject: "History", total: 5 }));
  const geo = dm.getCategoryStats().find((c) => c.category === "Geography");
  assert.deepEqual(geo, { category: "Geography", correct: 0, questions: 0, accuracy: null });
});

test("old records without questionsByCategory are counted from their mode", () => {
  const old = { nickname: "", finishedAt: local(1).toISOString(), subject: "Science", total: 7, maxScore: 10, byCategory: { Science: 7 } };
  const s = applyGame(emptyStats(), old);
  assert.deepEqual(s.byCategory.Science, { correct: 7, questions: 10 });
  assert.equal(s.byMode.category.games, 1);
});

test("missing or corrupt stats are rebuilt from the saved games", () => {
  const store = fakeStorage();
  const dm = manager(store);
  dm.saveGame(game({ points: 100 }));
  dm.saveGame(game({ points: 50 }));
  store.setItem(STATS_KEY, "{broken");
  assert.equal(dm.getStats().totalPoints, 150);
  store.removeItem(STATS_KEY);
  dm.saveGame(game({ points: 25 }));
  assert.equal(dm.getStats().totalPoints, 175, "no game counted twice when rebuilding on save");
  assert.equal(dm.getStats().gamesPlayed, 3);
});

test("rebuildStats matches applying games one by one", () => {
  const runs = [game({ points: 3 }), game({ points: 2 }), game({ points: 1 })]; // newest first, as stored
  const oneByOne = [...runs].reverse().reduce(applyGame, emptyStats());
  assert.deepEqual(rebuildStats(runs), oneByOne);
});

/* ---------- Periods ---------- */

test("periodStart: today at midnight, this Monday at midnight, or none", () => {
  assert.deepEqual(periodStart(PERIODS.DAY, WEDNESDAY_NOON), local(18, 0));
  assert.deepEqual(periodStart(PERIODS.WEEK, WEDNESDAY_NOON), local(16, 0), "Monday 16 Nov");
  assert.deepEqual(periodStart(PERIODS.WEEK, local(22, 23)), local(16, 0), "Sunday is still the same week");
  assert.deepEqual(periodStart(PERIODS.WEEK, local(16, 0, 5)), local(16, 0), "Monday itself");
  assert.equal(periodStart(PERIODS.ALL, WEDNESDAY_NOON), null);
});

test("filterByPeriod keeps runs from the period only", () => {
  const runs = [
    game({ at: local(18, 9) }), // today
    game({ at: local(17, 23, 59) }), // yesterday, this week
    game({ at: local(15, 12) }), // last Sunday: last week
  ];
  assert.equal(filterByPeriod(runs, PERIODS.DAY, WEDNESDAY_NOON).length, 1);
  assert.equal(filterByPeriod(runs, PERIODS.WEEK, WEDNESDAY_NOON).length, 2);
  assert.equal(filterByPeriod(runs, PERIODS.ALL, WEDNESDAY_NOON).length, 3);
});

/* ---------- Leaderboards ---------- */

test("overall, weekly and daily leaderboards, top 10 by points", () => {
  const dm = manager();
  dm.saveGame(game({ points: 900, at: local(2) })); // weeks ago
  dm.saveGame(game({ points: 500, at: local(17) })); // this week
  for (let i = 0; i < 12; i++) dm.saveGame(game({ points: 100 + i, at: local(18, 8, i) })); // today
  const overall = dm.getLeaderboard({ period: PERIODS.ALL, mode: "full" });
  const weekly = dm.getLeaderboard({ period: PERIODS.WEEK, mode: "full" });
  const daily = dm.getLeaderboard({ period: PERIODS.DAY, mode: "full" });
  assert.equal(overall.length, 10);
  assert.deepEqual(overall.slice(0, 3).map((r) => r.points), [900, 500, 111]);
  assert.deepEqual(weekly.slice(0, 2).map((r) => r.points), [500, 111]);
  assert.equal(daily.length, 10);
  assert.equal(daily[0].points, 111);
  assert.ok(daily.every((r) => r.points < 500));
});

test("leaderboards are per mode", () => {
  const dm = manager();
  dm.saveGame(game({ mode: "speed", points: 999 }));
  dm.saveGame(game({ mode: "full", points: 10 }));
  assert.deepEqual(dm.getLeaderboard({ mode: "full" }).map((r) => r.points), [10]);
  assert.deepEqual(dm.getLeaderboard({ mode: "speed" }).map((r) => r.points), [999]);
});

test("an all-time best stays on the Overall board after leaving the latest 100", () => {
  const dm = manager();
  dm.saveGame(game({ points: 5000, nickname: "Champion", at: local(1, 8) }));
  for (let i = 0; i < 100; i++) dm.saveGame(game({ points: i, at: new Date(local(2).getTime() + i * 60_000) }));
  assert.ok(!dm.getGames().some((r) => r.nickname === "Champion"), "dropped from the latest 100");
  assert.equal(dm.getLeaderboard({ mode: "full" })[0].nickname, "Champion");
  assert.equal(dm.getLeaderboard({ mode: "full" }).length, 10, "no duplicates");
});

/* ---------- Robustness ---------- */

test("blocked storage never throws: empty results everywhere", () => {
  const dm = manager(throwingStorage());
  assert.equal(dm.saveGame(game()), false);
  assert.deepEqual(dm.getGames(), []);
  assert.equal(dm.getStats().gamesPlayed, 0);
  assert.deepEqual(dm.getLeaderboard(), []);
  assert.equal(dm.hasGames(), false);
  assert.equal(dm.clear(), false);
  assert.equal(manager(null).getStats().gamesPlayed, 0);
});

test("a full store keeps the game playable", () => {
  const store = fakeStorage();
  store.setItem = () => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  };
  assert.equal(manager(store).saveGame(game()), false);
});

test("clear removes games and statistics only", () => {
  const store = fakeStorage({ "quiz.theme": "dark" });
  const dm = manager(store);
  dm.saveGame(game());
  assert.equal(dm.hasGames(), true);
  assert.equal(dm.clear(), true);
  assert.equal(store.getItem(RUNS_KEY), null);
  assert.equal(store.getItem(STATS_KEY), null);
  assert.equal(store.getItem("quiz.theme"), "dark");
  assert.equal(dm.hasGames(), false);
});

/* ---------- Difficulty ---------- */

import { parseBackup, sanitizeRun, BACKUP_APP, BACKUP_FORMAT } from "../js/data-manager.js";

test("leaderboards can be filtered by difficulty; old runs count as mixed", () => {
  const dm = manager();
  dm.saveGame({ ...game({ points: 300 }), difficulty: "hard" });
  dm.saveGame({ ...game({ points: 200 }), difficulty: "easy" });
  const old = game({ points: 100 });
  delete old.difficulty;
  dm.saveGame(old);
  assert.deepEqual(dm.getLeaderboard({ mode: "full", difficulty: "hard" }).map((r) => r.points), [300]);
  assert.deepEqual(dm.getLeaderboard({ mode: "full", difficulty: "mixed" }).map((r) => r.points), [100]);
  assert.deepEqual(dm.getLeaderboard({ mode: "full" }).map((r) => r.points), [300, 200, 100]);
  assert.deepEqual(dm.getLeaderboard({ period: PERIODS.DAY, mode: "full", difficulty: "easy" }).map((r) => r.points), [200]);
});

test("statistics track accuracy per difficulty", () => {
  const dm = manager();
  dm.saveGame({ ...game(), byDifficulty: { easy: { correct: 10, questions: 12 }, hard: { correct: 3, questions: 12 } } });
  dm.saveGame({ ...game(), byDifficulty: { easy: { correct: 2, questions: 3 } } });
  const levels = dm.getDifficultyStats();
  assert.deepEqual(levels.map((d) => [d.difficulty, d.correct, d.questions]), [
    ["easy", 12, 15],
    ["medium", 0, 0],
    ["hard", 3, 12],
  ]);
  assert.equal(levels[1].accuracy, null);
});

test("stats saved by an older version are rebuilt automatically", () => {
  const store = fakeStorage();
  const dm = manager(store);
  dm.saveGame(game({ points: 70 }));
  const v1 = { ...JSON.parse(store.getItem(STATS_KEY)), version: 1 };
  store.setItem(STATS_KEY, JSON.stringify(v1));
  assert.equal(dm.getStats().version, 2);
  assert.equal(dm.getStats().totalPoints, 70);
});

/* ---------- Backup and restore ---------- */

test("backup round trip: export, parse, restore on another device", () => {
  const phone = manager();
  phone.saveGame(game({ points: 400, nickname: "Kim" }));
  phone.saveGame({ ...game({ points: 250, mode: "speed" }), difficulty: "easy" });
  const text = JSON.stringify(phone.exportBackup());

  const parsed = parseBackup(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.runs.length, 2);

  const laptop = manager(fakeStorage({ "quiz.theme": "dark" }));
  laptop.saveGame(game({ points: 5 })); // replaced by the restore
  assert.equal(laptop.restoreBackup(parsed), true);
  assert.deepEqual(laptop.getGames().map((r) => r.points).sort((a, b) => a - b), [250, 400], "the laptop's own game is gone");
  assert.equal(laptop.getStats().gamesPlayed, 2);
  assert.equal(laptop.getStats().totalPoints, 650);
  assert.deepEqual(laptop.getLeaderboard({ mode: "full" }).map((r) => r.nickname), ["Kim"]);
  assert.deepEqual(laptop.getLeaderboard({ mode: "speed", difficulty: "easy" }).map((r) => r.points), [250]);
});

test("the export includes app, format, date, games and statistics", () => {
  const dm = manager();
  dm.saveGame(game());
  const backup = dm.exportBackup();
  assert.equal(backup.app, BACKUP_APP);
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.exportedAt, WEDNESDAY_NOON.toISOString());
  assert.equal(backup.runs.length, 1);
  assert.equal(backup.stats.gamesPlayed, 1);
});

test("parseBackup rejects files that aren't backups", () => {
  assert.equal(parseBackup("not json").ok, false);
  assert.equal(parseBackup("{}").ok, false);
  assert.equal(parseBackup(JSON.stringify({ app: "other", format: 1, runs: [] })).ok, false);
  assert.match(parseBackup(JSON.stringify({ app: BACKUP_APP, format: 99, runs: [] })).error, /different version/);
  assert.equal(parseBackup("x".repeat(2_000_001)).ok, false);
  assert.equal(parseBackup(null).ok, false);
});

test("parseBackup cleans untrusted data", () => {
  const runs = [
    { ...game({ points: 10 }), nickname: "A".repeat(500), extra: "<script>", subject: "S".repeat(100) },
    { total: 5 }, // no date: dropped
    { finishedAt: "not a date", total: 1 }, // bad date: dropped
    { finishedAt: new Date().toISOString(), total: -3 }, // negative: dropped
    "junk",
  ];
  const parsed = parseBackup(JSON.stringify({ app: BACKUP_APP, format: BACKUP_FORMAT, runs, stats: { version: 2, nonsense: true } }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.runs.length, 1);
  const [r] = parsed.runs;
  assert.equal(r.nickname.length, 20);
  assert.equal(r.subject.length, 40);
  assert.equal("extra" in r, false);
  assert.equal(parsed.stats.gamesPlayed, 1, "invalid stats are rebuilt from the games");
});

test("parseBackup keeps at most 100 games, newest first, and rebuilds stats that don't match", () => {
  const runs = Array.from({ length: 120 }, (_, i) => game({ points: i, at: new Date(local(1).getTime() + i * 60_000) }));
  const fakeStats = { ...emptyStats(), version: 2, gamesPlayed: 3 }; // fewer than the games: inconsistent
  const parsed = parseBackup(JSON.stringify({ app: BACKUP_APP, format: BACKUP_FORMAT, runs, stats: fakeStats }));
  assert.equal(parsed.runs.length, 100);
  assert.equal(parsed.runs[0].points, 119);
  assert.equal(parsed.stats.gamesPlayed, 100);
});

test("valid statistics in a backup are kept (they may count more than 100 games)", () => {
  const dm = manager();
  for (let i = 0; i < 105; i++) dm.saveGame(game({ points: 1, at: new Date(local(1).getTime() + i * 60_000) }));
  const parsed = parseBackup(JSON.stringify(dm.exportBackup()));
  assert.equal(parsed.runs.length, 100);
  assert.equal(parsed.stats.gamesPlayed, 105);
  assert.equal(parsed.stats.totalPoints, 105);
});

test("sanitizeRun keeps known fields with the right types", () => {
  const clean = sanitizeRun({ ...game(), points: "999", difficulty: "insane", mode: "weird" });
  assert.equal("points" in clean, false, "a string is not a number");
  assert.equal("difficulty" in clean, false);
  assert.equal("mode" in clean, false);
  assert.equal(sanitizeRun(null), null);
});

test("restore on blocked storage fails without throwing", () => {
  const parsed = parseBackup(JSON.stringify({ app: BACKUP_APP, format: BACKUP_FORMAT, runs: [game()] }));
  assert.equal(manager(throwingStorage()).restoreBackup(parsed), false);
});

test("category and difficulty statistics never count more correct than asked", () => {
  const bad = { ...game({ mode: "speed" }), byCategory: { History: 9 }, questionsByCategory: { History: 5 }, byDifficulty: { easy: { correct: 9, questions: 3 } } };
  const s = applyGame(emptyStats(), bad);
  assert.deepEqual(s.byCategory.History, { correct: 5, questions: 5 });
  assert.deepEqual(s.byDifficulty.easy, { correct: 3, questions: 3 });
});
