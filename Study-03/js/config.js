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

/** Required difficulty mix for each category. */
export const DIFFICULTY_MIX = Object.freeze({ easy: 3, medium: 4, hard: 3 });

/**
 * Rank tiers by final score. `min` is inclusive, so a score of 12 is
 * "Apprentice". Ordered lowest to highest. Max score is TOTAL_QUESTIONS.
 */
export const RANK_TIERS = Object.freeze([
  Object.freeze({ name: "Novice", min: 0 }),
  Object.freeze({ name: "Apprentice", min: 12 }),
  Object.freeze({ name: "Scholar", min: 20 }),
  Object.freeze({ name: "Expert", min: 28 }),
  Object.freeze({ name: "Grandmaster", min: 36 }),
]);
