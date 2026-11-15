// ScoreManager: points for each answer. Pure (no DOM, no clock): the caller
// passes in how long the answer took and whether a hint was used.
//
//   correct answer = base x difficulty multiplier
//                  + time bonus      (answered in under 10 seconds)
//                  + no-hint bonus   (Eliminate not used on that question)
//                  + streak bonus    (3, 5 and every 10 correct in a row)
//   wrong, skipped or timed out = 0 points, and the streak resets.

import { SCORING } from "./config.js";

/**
 * Bonus for reaching `streak` correct answers in a row: +2 at 3, +5 at 5,
 * and +10 at 10, 20, 30 and so on. 0 for any other streak length.
 * @param {number} streak current streak, including this answer
 * @param {typeof SCORING} [rules]
 */
export function streakBonus(streak, rules = SCORING) {
  if (rules.streakBonuses[streak] !== undefined) return rules.streakBonuses[streak];
  const every = rules.streakRepeatEvery;
  if (every && streak > every && streak % every === 0) return rules.streakBonuses[every] ?? 0;
  return 0;
}

/**
 * Points for one answer, as a breakdown.
 * @param {object} answer
 * @param {"easy" | "medium" | "hard"} answer.difficulty
 * @param {boolean} answer.correct
 * @param {number} [answer.timeMs] time from question shown to answer
 * @param {boolean} [answer.usedHint] Eliminate was used on this question
 * @param {number} [answer.streakBefore] correct answers in a row before this one
 * @param {typeof SCORING} [rules]
 * @returns {{ base: number, time: number, noHint: number, streak: number, total: number, streakAfter: number }}
 */
export function scoreAnswer(
  { difficulty, correct, timeMs = Infinity, usedHint = false, streakBefore = 0 },
  rules = SCORING
) {
  if (!correct) return { base: 0, time: 0, noHint: 0, streak: 0, total: 0, streakAfter: 0 };
  const streakAfter = streakBefore + 1;
  const multiplier = rules.multipliers[difficulty] ?? 1;
  const points = {
    base: Math.round(rules.base * multiplier),
    time: Number.isFinite(timeMs) && timeMs >= 0 && timeMs < rules.fastMs ? rules.fastBonus : 0,
    noHint: usedHint ? 0 : rules.noHintBonus,
    streak: streakBonus(streakAfter, rules),
  };
  return { ...points, total: points.base + points.time + points.noHint + points.streak, streakAfter };
}

/**
 * Keeps the running points, streak and bonus totals for one run.
 * @param {typeof SCORING} [rules]
 */
export function createScoreManager(rules = SCORING) {
  let streak = 0;
  let bestStreak = 0;
  const totals = { base: 0, time: 0, noHint: 0, streak: 0, total: 0 };

  return {
    /** Score one answer, update the run totals, and return the breakdown. */
    record(answer) {
      const result = scoreAnswer({ ...answer, streakBefore: streak }, rules);
      streak = result.streakAfter;
      bestStreak = Math.max(bestStreak, streak);
      for (const key of Object.keys(totals)) totals[key] += result[key];
      return result;
    },
    getState() {
      return { points: totals.total, streak, bestStreak, totals: { ...totals } };
    },
  };
}
