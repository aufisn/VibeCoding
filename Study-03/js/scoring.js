// Pure scoring functions. No DOM, no I/O.

import { CATEGORIES, RANK_TIERS } from "./config.js";

/**
 * The highest tier whose `min` is less than or equal to `total`.
 * Tiers may be in any order. Falls back to the lowest tier.
 * @param {number} total
 * @param {readonly {name: string, min: number}[]} [tiers]
 * @returns {{name: string, min: number}}
 */
export function tierFor(total, tiers = RANK_TIERS) {
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  let best = sorted[0];
  for (const tier of sorted) {
    if (tier.min <= total) best = tier;
  }
  return best;
}

/**
 * Count correct answers overall and per category.
 * @param {({category: string, correct: boolean} | undefined)[]} answers
 * @param {readonly string[]} [categories] every category gets a key, even at 0
 * @returns {{ total: number, byCategory: Record<string, number> }}
 */
export function summarize(answers, categories = CATEGORIES) {
  const byCategory = Object.fromEntries(categories.map((c) => [c, 0]));
  let total = 0;
  for (const answer of answers) {
    if (!answer || answer.correct !== true) continue;
    total += 1;
    byCategory[answer.category] = (byCategory[answer.category] ?? 0) + 1;
  }
  return { total, byCategory };
}
