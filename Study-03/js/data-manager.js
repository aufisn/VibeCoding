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
// Backups: exportBackup() returns everything as one JSON-ready object (the UI
// downloads it as a file); parseBackup() checks and cleans a file's text, and
// restoreBackup() replaces the saved data with it.
//
// The pure helpers (emptyStats, applyGame, rebuildStats, periodStart,
// filterByPeriod, sanitizeRun, parseBackup) are exported for tests.

import {
  CATEGORIES,
  DIFFICULTY_CHOICES,
  MIXED,
  MODES,
  NICKNAME_MAX,
  QUESTIONS_PER_CATEGORY,
  SPEED_PER_CATEGORY,
} from "./config.js";
import { MAX_RUNS, RUNS_KEY, loadRuns, runMode, saveRun, topRuns } from "./storage.js";

export const STATS_KEY = "quiz.stats";
// v2: hall of fame per mode and difficulty, statistics per difficulty.
// Older stats fail the version check and are rebuilt from the saved games.
export const STATS_VERSION = 2;
export const HALL_OF_FAME_SIZE = 10;

/** Leaderboard periods. */
export const PERIODS = Object.freeze({ ALL: "all", WEEK: "week", DAY: "day" });

const MODE_LIST = [MODES.FULL, MODES.CATEGORY, MODES.SPEED];
const LEVELS = ["easy", "medium", "hard"];

/** The difficulty a saved run was played at; older runs were all "mixed". */
export function runDifficulty(run) {
  return run && DIFFICULTY_CHOICES.includes(run.difficulty) ? run.difficulty : MIXED;
}

/** Hall-of-fame key: one all-time top 10 per mode and difficulty. */
const fameKey = (mode, difficulty) => `${mode}/${difficulty}`;

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
    byDifficulty: Object.fromEntries(LEVELS.map((d) => [d, { correct: 0, questions: 0 }])),
    hallOfFame: {},
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
  // Correct answers can't exceed questions asked (guards against edited backups).
  for (const [category, correct] of Object.entries(record.byCategory ?? {})) {
    const c = (next.byCategory[category] ??= { correct: 0, questions: 0 });
    const questions = num(asked[category]);
    c.correct += Math.min(num(correct), questions);
    c.questions += questions;
  }

  for (const [level, v] of Object.entries(record.byDifficulty ?? {})) {
    if (!LEVELS.includes(level) || !v) continue;
    const d = (next.byDifficulty[level] ??= { correct: 0, questions: 0 });
    d.correct += Math.min(num(v.correct), num(v.questions));
    d.questions += num(v.questions);
  }

  const key = fameKey(mode, runDifficulty(record));
  next.hallOfFame[key] = topRuns([...(next.hallOfFame[key] ?? []), record], HALL_OF_FAME_SIZE);
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
    value.byDifficulty && typeof value.byDifficulty === "object" &&
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

/* ---------- Backups ---------- */

export const BACKUP_APP = "study-03-quiz";
export const BACKUP_FORMAT = 1;
/** Larger files are refused before reading (a full backup is about 100 KB). */
export const BACKUP_MAX_BYTES = 2_000_000;

const str = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);
const count = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined);
const counts = (obj, keys) =>
  obj && typeof obj === "object"
    ? Object.fromEntries(keys.filter((k) => count(obj[k]) !== undefined).map((k) => [k, count(obj[k])]))
    : undefined;

/**
 * A clean copy of a saved run from an untrusted source (a backup file):
 * only known fields, the right types, strings capped. null if unusable.
 */
export function sanitizeRun(run, categories = CATEGORIES) {
  if (!run || typeof run !== "object") return null;
  const t = Date.parse(run.finishedAt);
  if (typeof run.finishedAt !== "string" || Number.isNaN(t) || count(run.total) === undefined) return null;
  const clean = {
    nickname: str(run.nickname, NICKNAME_MAX) ?? "",
    finishedAt: new Date(t).toISOString(),
    mode: MODE_LIST.includes(run.mode) ? run.mode : undefined,
    subject: str(run.subject, 40),
    difficulty: DIFFICULTY_CHOICES.includes(run.difficulty) ? run.difficulty : undefined,
    points: count(run.points),
    total: count(run.total),
    maxScore: count(run.maxScore),
    byCategory: counts(run.byCategory, categories) ?? {},
    questionsByCategory: counts(run.questionsByCategory, categories),
    byDifficulty:
      run.byDifficulty && typeof run.byDifficulty === "object"
        ? Object.fromEntries(
            LEVELS.filter((d) => run.byDifficulty[d]).map((d) => [d, counts(run.byDifficulty[d], ["correct", "questions"])])
          )
        : undefined,
    skipped: count(run.skipped),
    timedOut: count(run.timedOut),
    eliminated: count(run.eliminated),
    bestStreak: count(run.bestStreak),
    bonuses: counts(run.bonuses, ["base", "time", "noHint", "streak"]),
    tier: str(run.tier, 20),
  };
  for (const key of Object.keys(clean)) if (clean[key] === undefined) delete clean[key];
  return clean;
}

/** A clean copy of statistics from a backup, or null to rebuild instead. */
function sanitizeStats(stats, categories) {
  if (!isStats(stats)) return null;
  const clean = emptyStats(categories);
  for (const key of ["gamesPlayed", "totalCorrect", "totalQuestions", "totalPoints", "totalSkipped", "totalTimedOut", "totalHints", "bestStreak"]) {
    clean[key] = count(stats[key]) ?? 0;
  }
  for (const key of ["firstPlayedAt", "lastPlayedAt"]) {
    const t = Date.parse(stats[key]);
    clean[key] = Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  for (const mode of MODE_LIST) {
    clean.byMode[mode] = { ...clean.byMode[mode], ...counts(stats.byMode[mode], ["games", "points", "correct", "questions", "bestPoints"]) };
  }
  for (const c of categories) clean.byCategory[c] = { ...clean.byCategory[c], ...counts(stats.byCategory[c], ["correct", "questions"]) };
  for (const d of LEVELS) clean.byDifficulty[d] = { ...clean.byDifficulty[d], ...counts(stats.byDifficulty[d], ["correct", "questions"]) };
  for (const mode of MODE_LIST) {
    for (const level of DIFFICULTY_CHOICES) {
      const list = stats.hallOfFame[fameKey(mode, level)];
      if (!Array.isArray(list)) continue;
      const runs = list.map((r) => sanitizeRun(r, categories)).filter(Boolean);
      if (runs.length) clean.hallOfFame[fameKey(mode, level)] = topRuns(runs, HALL_OF_FAME_SIZE);
    }
  }
  return clean;
}

/**
 * Check and clean the text of a backup file. Pure.
 * @param {string} text
 * @returns {{ ok: true, runs: object[], stats: object } | { ok: false, error: string }}
 */
export function parseBackup(text, categories = CATEGORIES) {
  if (typeof text !== "string" || text.length > BACKUP_MAX_BYTES) {
    return { ok: false, error: "That file is too large to be a Quiz Game backup." };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't a Quiz Game backup (it isn't valid JSON)." };
  }
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.runs)) {
    return { ok: false, error: "That file isn't a Quiz Game backup." };
  }
  if (data.format !== BACKUP_FORMAT) {
    return { ok: false, error: "This backup was made by a different version of the game and can't be read." };
  }
  const runs = data.runs
    .map((r) => sanitizeRun(r, categories))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .slice(0, MAX_RUNS);
  let stats = sanitizeStats(data.stats, categories);
  // Statistics count at least every saved game; if not, they don't belong together.
  if (!stats || stats.gamesPlayed < runs.length) stats = rebuildStats(runs, categories);
  return { ok: true, runs, stats };
}

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
  getLeaderboard({ period = PERIODS.ALL, mode, difficulty, limit = 10 } = {}) {
    try {
      let runs = this.getGames();
      if (period === PERIODS.ALL) {
        const fame = Object.entries(this.getStats().hallOfFame)
          .filter(([key]) => (!mode || key.startsWith(`${mode}/`)) && (!difficulty || key.endsWith(`/${difficulty}`)))
          .flatMap(([, list]) => list);
        for (const run of fame) if (!runs.some((r) => sameRun(r, run))) runs = [...runs, run];
      } else {
        runs = filterByPeriod(runs, period, this.now());
      }
      if (difficulty) runs = runs.filter((r) => runDifficulty(r) === difficulty);
      return topRuns(runs, limit, mode);
    } catch {
      return [];
    }
  }

  /**
   * Accuracy per difficulty across every game (games saved before
   * difficulty tracking aren't included).
   * @returns {{ difficulty: string, correct: number, questions: number, accuracy: number | null }[]}
   */
  getDifficultyStats() {
    const { byDifficulty = {} } = this.getStats();
    return LEVELS.map((difficulty) => {
      const { correct = 0, questions = 0 } = byDifficulty[difficulty] ?? {};
      return { difficulty, correct, questions, accuracy: questions > 0 ? correct / questions : null };
    });
  }

  /** Everything saved, as one object ready for JSON.stringify (a backup file). */
  exportBackup() {
    return {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      exportedAt: this.now().toISOString(),
      runs: this.getGames(),
      stats: this.getStats(),
    };
  }

  /**
   * Replace the saved games and statistics with a parsed backup
   * (from parseBackup). Never throws.
   * @returns {boolean} true if it was written
   */
  restoreBackup({ runs, stats }) {
    const store = this.#resolve();
    try {
      if (!store) return false;
      store.setItem(RUNS_KEY, JSON.stringify(runs));
      try {
        store.setItem(STATS_KEY, JSON.stringify(stats));
      } catch {
        store.removeItem(STATS_KEY); // never leave old stats next to new games; rebuilt on read
      }
      return true;
    } catch {
      return false;
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
