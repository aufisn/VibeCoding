// Pure run-building functions. No DOM, no I/O.

import { CATEGORIES } from "./config.js";

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
 * Build one run: every category in play order, questions shuffled within
 * each category, options shuffled within each question.
 * @param {object[]} questions validated question bank
 * @param {() => number} [rng]
 * @param {readonly string[]} [categories] play order
 * @returns {object[]} new question objects (the bank is not modified)
 */
export function buildRun(questions, rng = Math.random, categories = CATEGORIES) {
  return categories.flatMap((category) =>
    shuffle(
      questions.filter((q) => q.category === category),
      rng
    ).map((q) => shuffleOptions(q, rng))
  );
}
