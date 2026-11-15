import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreAnswer, streakBonus, createScoreManager } from "../js/score-manager.js";
import { SCORING } from "../js/config.js";

const right = (difficulty, extra = {}) => ({ difficulty, correct: true, timeMs: 20_000, usedHint: true, ...extra });

test("difficulty multiplier: easy 10, medium 15, hard 20 (slow, with a hint, no streak)", () => {
  assert.equal(scoreAnswer(right("easy")).total, 10);
  assert.equal(scoreAnswer(right("medium")).total, 15);
  assert.equal(scoreAnswer(right("hard")).total, 20);
});

test("time bonus: +3 only for answers under 10 seconds", () => {
  assert.equal(scoreAnswer(right("easy", { timeMs: 9_999 })).time, 3);
  assert.equal(scoreAnswer(right("easy", { timeMs: 0 })).time, 3);
  assert.equal(scoreAnswer(right("easy", { timeMs: 10_000 })).time, 0, "exactly 10 s is not under 10 s");
  assert.equal(scoreAnswer(right("easy", { timeMs: undefined })).time, 0, "unknown time gets no bonus");
});

test("no-hint bonus: +2 when Eliminate wasn't used", () => {
  assert.equal(scoreAnswer(right("easy", { usedHint: false })).noHint, 2);
  assert.equal(scoreAnswer(right("easy", { usedHint: true })).noHint, 0);
});

test("all bonuses together on a fast, hint-free hard answer", () => {
  const p = scoreAnswer({ difficulty: "hard", correct: true, timeMs: 4_000, usedHint: false, streakBefore: 2 });
  assert.deepEqual(p, { base: 20, time: 3, noHint: 2, streak: 2, total: 27, streakAfter: 3 });
});

test("wrong answers score 0 and reset the streak, whatever the bonuses", () => {
  const p = scoreAnswer({ difficulty: "hard", correct: false, timeMs: 1_000, usedHint: false, streakBefore: 9 });
  assert.deepEqual(p, { base: 0, time: 0, noHint: 0, streak: 0, total: 0, streakAfter: 0 });
});

test("streak bonus: +2 at 3, +5 at 5, +10 at 10 and every 10 after", () => {
  const expected = { 1: 0, 2: 0, 3: 2, 4: 0, 5: 5, 6: 0, 9: 0, 10: 10, 11: 0, 15: 0, 20: 10, 30: 10, 40: 10 };
  for (const [streak, bonus] of Object.entries(expected)) assert.equal(streakBonus(Number(streak)), bonus, `streak ${streak}`);
});

test("createScoreManager tracks points, streak and best streak", () => {
  const sm = createScoreManager();
  const outcome = [true, true, true, false, true, true, true, true, true]; // 3, reset, 5
  for (const correct of outcome) sm.record({ difficulty: "easy", correct, timeMs: 20_000, usedHint: true });
  const s = sm.getState();
  assert.equal(s.streak, 5);
  assert.equal(s.bestStreak, 5);
  // 8 correct x 10 base, +2 (first streak of 3), +2 and +5 (second run reaches 3 and 5)
  assert.equal(s.totals.base, 80);
  assert.equal(s.totals.streak, 9);
  assert.equal(s.points, 89);
});

test("ten in a row with every bonus", () => {
  const sm = createScoreManager();
  for (let i = 0; i < 10; i++) sm.record({ difficulty: "medium", correct: true, timeMs: 1_000, usedHint: false });
  // 10 x (15 + 3 + 2) = 200, plus streak 2 + 5 + 10 = 17
  assert.equal(sm.getState().points, 217);
});

test("rules can be swapped (e.g. for tuning)", () => {
  const rules = { ...SCORING, base: 100 };
  assert.equal(scoreAnswer(right("hard"), rules).base, 200);
});
