// Game-wide constants shared by the browser app and the Node scripts.

/** Category names. This order is also the play order. */
export const CATEGORIES = Object.freeze([
  "History",
  "Science",
  "Geography",
  "Arts & Culture",
]);

export const QUESTIONS_PER_CATEGORY = 10;

export const TOTAL_QUESTIONS = CATEGORIES.length * QUESTIONS_PER_CATEGORY; // 40

/** Subject choice on the Start screen that plays every category. */
export const ALL_SUBJECTS = "All";

/** Subject choice for the Speed Quiz. */
export const SPEED_SUBJECT = "Speed";

/** Game modes, as saved in each run record. */
export const MODES = Object.freeze({
  FULL: "full", // all 40 questions, category by category
  CATEGORY: "category", // the 10 questions of one category
  SPEED: "speed", // 20 mixed questions against the clock
});

/** Speed Quiz: questions per category (x4 = 20) and seconds per question. */
export const SPEED_PER_CATEGORY = 5;
export const SPEED_SECONDS = 15;

/** ScoreManager rules (see js/score-manager.js). */
export const SCORING = Object.freeze({
  base: 10,
  multipliers: Object.freeze({ easy: 1, medium: 1.5, hard: 2 }),
  fastMs: 10_000, // answers under 10 seconds get the time bonus
  fastBonus: 3,
  noHintBonus: 2, // correct without using Eliminate
  streakBonuses: Object.freeze({ 3: 2, 5: 5, 10: 10 }),
  streakRepeatEvery: 10, // +10 again at 20, 30, 40 in a row
});

/** How many wrong options "Eliminate" may remove from one question. */
export const ELIMINATE_PER_QUESTION = 1;

/** Longest nickname allowed on the start screen (after trimming). */
export const NICKNAME_MAX = 20;

/** Required difficulty mix for each category. */
export const DIFFICULTY_MIX = Object.freeze({ easy: 3, medium: 4, hard: 3 });

/**
 * Difficulty choices on the Start screen. "mixed" plays every difficulty;
 * the others play only questions of that difficulty (fewer questions).
 */
export const DIFFICULTY_CHOICES = Object.freeze(["mixed", "easy", "medium", "hard"]);
export const MIXED = "mixed";

/**
 * Rank tiers by final score. `min` is inclusive, so a score of 12 is
 * "Apprentice". Ordered lowest to highest. The minimums are out of
 * TOTAL_QUESTIONS; shorter runs (one subject) scale them, see tierFor().
 */
export const RANK_TIERS = Object.freeze([
  Object.freeze({ name: "Novice", min: 0 }),
  Object.freeze({ name: "Apprentice", min: 12 }),
  Object.freeze({ name: "Scholar", min: 20 }),
  Object.freeze({ name: "Expert", min: 28 }),
  Object.freeze({ name: "Grandmaster", min: 36 }),
]);
