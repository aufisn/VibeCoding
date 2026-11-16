// Pure run-building functions. No DOM, no I/O.

import { CATEGORIES, DIFFICULTY_MIX, QUESTIONS_PER_CATEGORY } from "./config.js";

/**
 * Fisher-Yates shuffle. Returns a new array; the input is not modified.
 * @param {readonly T[]} items
 * @param {() => number} rng returns a float in [0, 1), like Math.random
 * @returns {T[]}
 * @template T
 */
export function shuffle(items, rng = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Small seeded PRNG (mulberry32) for deterministic tests and replays.
 * @param {number} seed any 32-bit integer
 * @returns {() => number} float in [0, 1)
 */
export function seededRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Copy of `question` with its options shuffled. The correct answer is
 * tracked by identity: each option is tagged before shuffling, and the new
 * correctIndex is wherever the tagged correct option ended up.
 */
export function shuffleOptions(question, rng = Math.random) {
  const tagged = question.options.map((text, i) => ({
    text,
    isCorrect: i === question.correctIndex,
  }));
  const mixed = shuffle(tagged, rng);
  return {
    ...question,
    options: mixed.map((option) => option.text),
    correctIndex: mixed.findIndex((option) => option.isCorrect),
  };
}

/**
 * Pick one category's questions for a run from a pool that may be larger
 * than a round. With `mix` (a Mixed-difficulty game) it takes that many of
 * each difficulty (3 easy, 4 medium, 3 hard), topping up from the rest if a
 * difficulty runs short; otherwise up to `perCategory` at random.
 * @returns {object[]} in random order
 */
export function pickQuestions(pool, rng = Math.random, { perCategory = QUESTIONS_PER_CATEGORY, mix = null } = {}) {
  if (!mix) return shuffle(pool, rng).slice(0, perCategory);
  const picked = Object.entries(mix).flatMap(([level, n]) =>
    shuffle(pool.filter((q) => q.difficulty === level), rng).slice(0, n)
  );
  const rest = shuffle(pool.filter((q) => !picked.includes(q)), rng);
  return shuffle([...picked, ...rest.slice(0, Math.max(0, perCategory - picked.length))], rng);
}

/**
 * Build one run: every category in play order, `perCategory` questions
 * picked from each (see pickQuestions) in random order, options shuffled.
 * @param {object[]} questions validated question bank (may hold more than one run)
 * @param {() => number} [rng]
 * @param {readonly string[]} [categories] play order
 * @param {{ perCategory?: number, mix?: Record<string, number> | null }} [options]
 *   mix defaults to DIFFICULTY_MIX; pass null for a single-difficulty pool
 * @returns {object[]} new question objects (the bank is not modified)
 */
export function buildRun(
  questions,
  rng = Math.random,
  categories = CATEGORIES,
  { perCategory = QUESTIONS_PER_CATEGORY, mix = DIFFICULTY_MIX } = {}
) {
  return categories.flatMap((category) =>
    pickQuestions(
      questions.filter((q) => q.category === category),
      rng,
      { perCategory, mix }
    ).map((q) => shuffleOptions(q, rng))
  );
}

/**
 * Build a Speed Quiz run: `perCategory` random questions from each category
 * (fewer if the category has fewer, e.g. after a difficulty filter), mixed
 * together in random order, options shuffled.
 * @param {object[]} questions validated question bank
 * @param {() => number} [rng]
 * @param {number} [perCategory]
 * @param {readonly string[]} [categories]
 */
export function buildSpeedRun(questions, rng = Math.random, perCategory = 5, categories = CATEGORIES) {
  const picked = categories.flatMap((category) =>
    shuffle(
      questions.filter((q) => q.category === category),
      rng
    ).slice(0, perCategory)
  );
  return shuffle(picked, rng).map((q) => shuffleOptions(q, rng));
}
