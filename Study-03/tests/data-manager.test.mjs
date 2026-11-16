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
