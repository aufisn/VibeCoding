// LocalDataManager: everything the game keeps in localStorage.
//
//   quiz.runs   the latest 100 finished games, newest first (storage.js)
//   quiz.stats  running statistics, updated after every game: totals, per
//               mode, per category, and each mode's all-time top 10 (so the
//               Overall leaderboard keeps a best score even after it falls
//               out of the latest 100)
//
// Every read and write is guarded: a missing, corrupt, full or blocked store
// never throws, the game keeps working, and statistics are rebuilt from the
// saved games if quiz.stats is missing or unreadable.
//
// The pure helpers (emptyStats, applyGame, rebuildStats, periodStart,
// filterByPeriod) are exported for tests.

import { CATEGORIES, MODES, QUESTIONS_PER_CATEGORY, SPEED_PER_CATEGORY } from "./config.js";
import { MAX_RUNS, RUNS_KEY, loadRuns, runMode, saveRun, topRuns } from "./storage.js";

export const STATS_KEY = "quiz.stats";
export const STATS_VERSION = 1;
export const HALL_OF_FAME_SIZE = 10;

/** Leaderboard periods. */
export const PERIODS = Object.freeze({ ALL: "all", WEEK: "week", DAY: "day" });

const MODE_LIST = [MODES.FULL, MODES.CATEGORY, MODES.SPEED];

/* ---------- Pure helpers ---------- */

/** Statistics before any game. */
export function emptyStats(categories = CATEGORIES) {
  return {
    version: STATS_VERSION,
    gamesPlayed: 0,
    totalCorrect: 0,
    totalQuestions: 0,
    totalPoints: 0,
    totalSkipped: 0,
    totalTimedOut: 0,
    totalHints: 0,
    bestStreak: 0,
    firstPlayedAt: null,
    lastPlayedAt: null,
    byMode: Object.fromEntries(
      MODE_LIST.map((mode) => [mode, { games: 0, points: 0, correct: 0, questions: 0, bestPoints: 0 }])
    ),
    byCategory: Object.fromEntries(categories.map((c) => [c, { correct: 0, questions: 0 }])),
    hallOfFame: Object.fromEntries(MODE_LIST.map((mode) => [mode, []])),
  };
}

/**
 * How many questions of each category a game had. New records store it
 * (`questionsByCategory`); older ones are worked out from the mode.
 */
export function questionsByCategory(record) {
  if (record.questionsByCategory && typeof record.questionsByCategory === "object") {
    return record.questionsByCategory;
  }
  const mode = runMode(record);
  const keys = Object.keys(record.byCategory ?? {});
  const per = mode === MODES.SPEED ? SPEED_PER_CATEGORY : QUESTIONS_PER_CATEGORY;
  return Object.fromEntries(keys.map((c) => [c, per]));
}

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Statistics after one more finished game. Pure: returns a new object.
 * @param {object} stats from emptyStats() or a previous applyGame()
 * @param {object} record a saved run (see README "Saved results")
 */
export function applyGame(stats, record) {
  const next = structuredClone(stats);
  const mode = runMode(record);
  const points = num(record.points);

  next.gamesPlayed += 1;
  next.totalCorrect += num(record.total);
  next.totalQuestions += num(record.maxScore);
  next.totalPoints += points;
  next.totalSkipped += num(record.skipped);
  next.totalTimedOut += num(record.timedOut);
  next.totalHints += num(record.eliminated);
  next.bestStreak = Math.max(next.bestStreak, num(record.bestStreak));
  if (!next.firstPlayedAt || record.finishedAt < next.firstPlayedAt) next.firstPlayedAt = record.finishedAt;
  if (!next.lastPlayedAt || record.finishedAt > next.lastPlayedAt) next.lastPlayedAt = record.finishedAt;

  const m = (next.byMode[mode] ??= { games: 0, points: 0, correct: 0, questions: 0, bestPoints: 0 });
  m.games += 1;
  m.points += points;
  m.correct += num(record.total);
  m.questions += num(record.maxScore);
  m.bestPoints = Math.max(m.bestPoints, points);

  const asked = questionsByCategory(record);
  for (const [category, correct] of Object.entries(record.byCategory ?? {})) {
    const c = (next.byCategory[category] ??= { correct: 0, questions: 0 });
    c.correct += num(correct);
    c.questions += num(asked[category]);
  }

  const fame = next.hallOfFame[mode] ?? [];
  next.hallOfFame[mode] = topRuns([...fame, record], HALL_OF_FAME_SIZE);
  return next;
}

/** Statistics rebuilt from saved games (oldest first, as they were played). */
export function rebuildStats(runs, categories = CATEGORIES) {
  return [...runs].reverse().reduce((stats, run) => applyGame(stats, run), emptyStats(categories));
}

function isStats(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.version === STATS_VERSION &&
    typeof value.gamesPlayed === "number" &&
    value.byMode && typeof value.byMode === "object" &&
    value.byCategory && typeof value.byCategory === "object" &&
    value.hallOfFame && typeof value.hallOfFame === "object"
  );
}

/**
 * When a leaderboard period starts, in the player's local time.
 * "day": today at 00:00. "week": this Monday at 00:00. "all": no limit (null).
 * @param {string} period one of PERIODS
 * @param {Date} now
 * @returns {Date | null}
 */
export function periodStart(period, now) {
  if (period === PERIODS.DAY) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (period === PERIODS.WEEK) {
    const sinceMonday = (now.getDay() + 6) % 7; // Monday = 0 ... Sunday = 6
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday);
  }
  return null;
}

/** Runs finished within `period` (up to `now`). */
export function filterByPeriod(runs, period, now) {
  const start = periodStart(period, now);
  if (!start) return runs;
  const from = start.getTime();
  return runs.filter((run) => {
    const t = Date.parse(run.finishedAt);
    return !Number.isNaN(t) && t >= from && t <= now.getTime();
  });
}

const sameRun = (a, b) => a.finishedAt === b.finishedAt && a.total === b.total && a.nickname === b.nickname;

/* ---------- The class ---------- */

export class LocalDataManager {
  /**
   * @param {object} [options]
   * @param {Storage | null} [options.store] defaults to localStorage (inject a fake in tests)
   * @param {() => Date} [options.now]
   * @param {readonly string[]} [options.categories]
   */
  constructor({ store, now = () => new Date(), categories = CATEGORIES } = {}) {
    this.store = store;
    this.now = now;
    this.categories = categories;
    this.maxGames = MAX_RUNS;
  }

  /** The store to use, or null when localStorage is unavailable. */
  #resolve() {
    if (this.store !== undefined) return this.store;
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Save a finished game and update the statistics. Never throws.
   * @returns {boolean} true if the game was saved
   */
  saveGame(record) {
    const store = this.#resolve();
    const saved = saveRun(record, store);
    if (!saved) return false;
    try {
      // Read the previous stats before this game was added, so a rebuild
      // (missing stats) doesn't count it twice.
      const stats = this.#readStats(store) ?? rebuildStats(loadRuns(store).slice(1), this.categories);
      store.setItem(STATS_KEY, JSON.stringify(applyGame(stats, record)));
    } catch {
      /* stats are rebuilt from the games next time */
    }
    return true;
  }

  /** The latest games (at most 100), newest first. */
  getGames() {
    return loadRuns(this.#resolve());
  }

  /** Running statistics (see emptyStats for the shape). Never throws. */
  getStats() {
    const store = this.#resolve();
    return this.#readStats(store) ?? rebuildStats(loadRuns(store), this.categories);
  }

  #readStats(store) {
    try {
      if (!store) return null;
      const raw = store.getItem(STATS_KEY);
      if (raw === null || raw === undefined) return null;
      const parsed = JSON.parse(raw);
      return isStats(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Per-category totals across every game played, in play order.
   * @returns {{ category: string, correct: number, questions: number, accuracy: number | null }[]}
   */
  getCategoryStats() {
    const { byCategory } = this.getStats();
    return this.categories.map((category) => {
      const { correct = 0, questions = 0 } = byCategory[category] ?? {};
      return { category, correct, questions, accuracy: questions > 0 ? correct / questions : null };
    });
  }

  /**
   * Top runs for a mode and period. "all" also includes each mode's
   * all-time top 10 kept in the statistics, so a best score stays on the
   * Overall board after it drops out of the latest 100 games.
   * @param {object} [options]
   * @param {string} [options.period] one of PERIODS
   * @param {string} [options.mode] one of MODES; all modes if omitted
   * @param {number} [options.limit]
   */
  getLeaderboard({ period = PERIODS.ALL, mode, limit = 10 } = {}) {
    try {
      let runs = this.getGames();
      if (period === PERIODS.ALL) {
        const fame = mode ? this.getStats().hallOfFame[mode] ?? [] : Object.values(this.getStats().hallOfFame).flat();
        for (const run of fame) if (!runs.some((r) => sameRun(r, run))) runs = [...runs, run];
      } else {
        runs = filterByPeriod(runs, period, this.now());
      }
      return topRuns(runs, limit, mode);
    } catch {
      return [];
    }
  }

  /** True if any game has been saved. */
  hasGames() {
    return this.getGames().length > 0 || this.getStats().gamesPlayed > 0;
  }

  /** Delete the saved games and statistics (nothing else). Never throws. */
  clear() {
    const store = this.#resolve();
    try {
      if (!store) return false;
      store.removeItem(RUNS_KEY);
      store.removeItem(STATS_KEY);
      return true;
    } catch {
      return false;
    }
  }
}
