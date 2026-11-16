import { test } from "node:test";
import assert from "node:assert/strict";

import { createGame, SCREENS, cleanNickname } from "../js/state.js";
import { seededRng } from "../js/quiz.js";
import { ALL_SUBJECTS, CATEGORIES } from "../js/config.js";
import { loadBank } from "./helpers.mjs";

const bank = await loadBank();
const FIXED_NOW = new Date("2026-11-15T12:00:00.000Z");

function newGame(seed = 1) {
  return createGame(bank, { rng: seededRng(seed), now: () => FIXED_NOW });
}

/** Answer the current question correctly (or wrongly) and press Next. */
function answerAndNext(game, { correct = true } = {}) {
  const { question } = game.getState();
  const pick = correct ? question.correctIndex : (question.correctIndex + 1) % 4;
  assert.equal(game.answer(pick), true);
  assert.equal(game.next(), true);
}

test("a new game starts on the start screen", () => {
  assert.equal(newGame().getState().screen, SCREENS.START);
});

test("start() builds a 40-question run and shows the first question", () => {
  const game = newGame();
  assert.equal(game.start("  Sam  "), true);
  const s = game.getState();
  assert.equal(s.screen, SCREENS.QUESTION);
  assert.equal(s.nickname, "Sam");
  assert.equal(s.totalQuestions, 40);
  assert.equal(s.category, "History");
  assert.equal(s.positionInCategory, 1);
  assert.equal(s.answeredCount, 0);
});

test("the answer locks after the first selection", () => {
  const game = newGame();
  game.start();
  const { question } = game.getState();
  const wrong = (question.correctIndex + 1) % 4;

  assert.equal(game.answer(wrong), true);
  assert.equal(game.answer(question.correctIndex), false, "second answer is ignored");
  const s = game.getState();
  assert.equal(s.answer.chosenIndex, wrong);
  assert.equal(s.answer.correct, false);
  assert.equal(s.score, 0);
  assert.equal(s.answeredCount, 1);
});

test("invalid option indexes are rejected", () => {
  const game = newGame();
  game.start();
  for (const bad of [-1, 4, 1.5, "0", null]) assert.equal(game.answer(bad), false);
  assert.equal(game.getState().answer, null);
});

test("next() is refused until the question is answered", () => {
  const game = newGame();
  game.start();
  assert.equal(game.next(), false);
  assert.equal(game.getState().index, 0);
});

test("next() advances within a category, then to its summary, then to the next category", () => {
  const game = newGame();
  game.start();
  for (let i = 1; i <= 9; i++) {
    answerAndNext(game);
    assert.equal(game.getState().positionInCategory, i + 1);
    assert.equal(game.getState().screen, SCREENS.QUESTION);
  }
  // 10th History question -> History summary
  answerAndNext(game);
  let s = game.getState();
  assert.equal(s.screen, SCREENS.SUMMARY);
  assert.equal(s.category, "History");
  assert.equal(s.categoryScore, 10);
  assert.equal(s.isLastCategory, false);

  // Continue -> first Science question
  assert.equal(game.next(), true);
  s = game.getState();
  assert.equal(s.screen, SCREENS.QUESTION);
  assert.equal(s.category, "Science");
  assert.equal(s.positionInCategory, 1);
  assert.equal(s.index, 10);
});

test("a full run visits every category in order and the final next goes to results", () => {
  const game = newGame(9);
  game.start("Ana");
  const visited = [];
  let correctCount = 0;

  for (let c = 0; c < CATEGORIES.length; c++) {
    for (let i = 0; i < 10; i++) {
      const correct = (c * 10 + i) % 3 !== 0; // a mix of right and wrong
      if (correct) correctCount++;
      answerAndNext(game, { correct });
    }
    const s = game.getState();
    assert.equal(s.screen, SCREENS.SUMMARY);
    visited.push(s.category);
    assert.equal(s.isLastCategory, c === CATEGORIES.length - 1);
    assert.equal(game.next(), true); // Continue / See results
  }

  assert.deepEqual(visited, [...CATEGORIES]);
  const s = game.getState();
  assert.equal(s.screen, SCREENS.RESULTS);
  assert.equal(s.total, correctCount);
  assert.equal(Object.values(s.byCategory).reduce((a, b) => a + b, 0), correctCount);
  assert.equal(game.next(), false, "nothing after results");
});

test("the finished-run record is handed out exactly once", () => {
  const game = newGame();
  game.start("Ana");
  while (game.getState().screen !== SCREENS.RESULTS) {
    if (game.getState().screen === SCREENS.QUESTION) answerAndNext(game);
    else game.next();
  }
  const record = game.takeResultToSave();
  // Fixed clock: every answer takes 0 ms, so all get the time bonus.
  // base: 12 easy x10 + 16 medium x15 + 12 hard x20 = 600
  // time: 40 x 3 = 120; no hint: 40 x 2 = 80
  // streak: +2 (3) +5 (5) +10 (10, 20, 30, 40) = 47
  assert.deepEqual(record, {
    nickname: "Ana",
    finishedAt: FIXED_NOW.toISOString(),
    mode: "full",
    subject: "All",
    points: 847,
    total: 40,
    maxScore: 40,
    byCategory: { History: 10, Science: 10, Geography: 10, "Arts & Culture": 10 },
    questionsByCategory: { History: 10, Science: 10, Geography: 10, "Arts & Culture": 10 },
    skipped: 0,
    timedOut: 0,
    eliminated: 0,
    bestStreak: 40,
    bonuses: { base: 600, time: 120, noHint: 80, streak: 47 },
    tier: "Grandmaster",
  });
  assert.equal(game.takeResultToSave(), null, "second call returns null (no double save)");
});

test("exit() mid-run returns to start and leaves nothing to save", () => {
  const game = newGame();
  game.start("Ana");
  answerAndNext(game);
  assert.equal(game.exit(), true);
  const s = game.getState();
  assert.equal(s.screen, SCREENS.START);
  assert.equal(s.answeredCount, 0);
  assert.equal(s.nickname, "Ana", "nickname kept for the next run");
  assert.equal(game.takeResultToSave(), null);
});

test("toStart() after results keeps the nickname and the next run is reshuffled", () => {
  const game = newGame(4);
  game.start("Ana");
  const firstOrder = [];
  while (game.getState().screen !== SCREENS.RESULTS) {
    const s = game.getState();
    if (s.screen === SCREENS.QUESTION) {
      firstOrder.push(s.question.id);
      answerAndNext(game);
    } else game.next();
  }
  game.takeResultToSave();
  assert.equal(game.toStart(), true);
  assert.equal(game.getState().nickname, "Ana");

  assert.equal(game.start(game.getState().nickname), true);
  const secondFirstTen = [];
  for (let i = 0; i < 10; i++) {
    secondFirstTen.push(game.getState().question.id);
    answerAndNext(game);
  }
  assert.notDeepEqual(secondFirstTen, firstOrder.slice(0, 10));
});

test("cleanNickname trims and caps at 20 characters", () => {
  assert.equal(cleanNickname("   "), "");
  assert.equal(cleanNickname(undefined), "");
  assert.equal(cleanNickname("  abcdefghijklmnopqrstuvwxyz "), "abcdefghijklmnopqrst");
});

/* ---------- Subject choice ---------- */

test("each single subject plays its 10 questions and goes straight to results", () => {
  for (const subject of CATEGORIES) {
    const game = newGame(3);
    assert.equal(game.start("Ana", subject), true);
    assert.equal(game.getState().totalQuestions, 10);
    for (let i = 0; i < 10; i++) {
      const s = game.getState();
      assert.equal(s.screen, SCREENS.QUESTION);
      assert.equal(s.category, subject);
      answerAndNext(game, { correct: i < 9 });
    }
    const s = game.getState();
    assert.equal(s.screen, SCREENS.RESULTS, "no category summary for a one-subject run");
    assert.deepEqual(Object.keys(s.byCategory), [subject]);
    const record = game.takeResultToSave();
    assert.equal(record.subject, subject);
    assert.equal(record.total, 9);
    assert.equal(record.maxScore, 10);
    assert.equal(record.tier, "Grandmaster", "9 of 10 ranks like 36 of 40");
  }
});

test("All plays 40 questions; an unknown subject is refused", () => {
  const game = newGame();
  assert.equal(game.start("Ana", "Cooking"), false);
  assert.equal(game.getState().screen, SCREENS.START);
  assert.equal(game.start("Ana", ALL_SUBJECTS), true);
  assert.equal(game.getState().totalQuestions, 40);
  assert.equal(game.getState().subject, ALL_SUBJECTS);
});

/* ---------- Eliminate ---------- */

test("eliminate removes one wrong option, once per question", () => {
  const game = newGame(5);
  game.start("Ana", "Science");
  let s = game.getState();
  assert.equal(s.canEliminate, true);
  assert.equal(game.eliminate(), true);
  s = game.getState();
  assert.equal(s.eliminated.length, 1);
  assert.notEqual(s.eliminated[0], s.question.correctIndex, "never the correct option");
  assert.equal(s.canEliminate, false);
  assert.equal(game.eliminate(), false, "second press on the same question is refused");
  assert.equal(game.answer(s.eliminated[0]), false, "an eliminated option can't be chosen");

  answerAndNext(game);
  s = game.getState();
  assert.deepEqual(s.eliminated, [], "the next question starts with all 4 options");
  assert.equal(s.canEliminate, true);
  assert.equal(s.eliminationsUsed, 1);
});

test("eliminate is refused after answering, and never removes the correct option", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const game = newGame(seed);
    game.start("", "History");
    const { question } = game.getState();
    game.eliminate();
    assert.notEqual(game.getState().eliminated[0], question.correctIndex);
  }
  const game = newGame();
  game.start();
  game.answer(game.getState().question.correctIndex);
  assert.equal(game.eliminate(), false);
});

test("with a larger allowance, eliminate stops when one wrong option is left", () => {
  const game = createGame(bank, { rng: seededRng(2), eliminatePerQuestion: 3 });
  game.start();
  assert.equal(game.eliminate(), true);
  assert.equal(game.eliminate(), true);
  assert.equal(game.eliminate(), false);
  const s = game.getState();
  assert.equal(s.eliminated.length, 2);
  assert.ok(!s.eliminated.includes(s.question.correctIndex));
});

/* ---------- Skip ---------- */

test("skip scores 0, moves to the next question and is recorded", () => {
  const game = newGame();
  game.start("Ana", "Geography");
  const first = game.getState().question.id;
  assert.equal(game.skip(), true);
  const s = game.getState();
  assert.equal(s.index, 1);
  assert.notEqual(s.question.id, first);
  assert.equal(s.score, 0);
  assert.equal(s.skippedCount, 1);
  assert.equal(s.answeredCount, 1, "skipped counts as done for progress");
});

test("skip is refused after answering", () => {
  const game = newGame();
  game.start();
  game.answer(0);
  assert.equal(game.skip(), false);
  assert.equal(game.getState().index, 0);
});

test("skipping the last question of a category reaches its summary; skips are saved", () => {
  const game = newGame();
  game.start("Ana");
  for (let i = 0; i < 9; i++) answerAndNext(game);
  game.skip();
  let s = game.getState();
  assert.equal(s.screen, SCREENS.SUMMARY);
  assert.equal(s.categoryScore, 9);
  assert.equal(s.categorySkipped, 1);
  while (game.getState().screen !== SCREENS.RESULTS) {
    if (game.getState().screen === SCREENS.QUESTION) game.skip();
    else game.next();
  }
  const record = game.takeResultToSave();
  assert.equal(record.total, 9);
  assert.equal(record.skipped, 31);
  assert.equal(record.tier, "Novice");
});

/* ---------- Mistake tracking (review screen) ---------- */

test("wrong answers are recorded with the text of the chosen and correct options", () => {
  const game = newGame(6);
  game.start("Ana", "History");
  const { question } = game.getState();
  const wrong = (question.correctIndex + 1) % 4;
  game.answer(wrong);
  game.next();

  const [m] = game.getState().mistakes;
  assert.equal(m.questionId, question.id);
  assert.equal(m.question, question.question);
  assert.equal(m.chosenText, question.options[wrong]);
  assert.equal(m.correctText, question.options[question.correctIndex]);
  assert.equal(m.explanation, question.explanation);
  assert.equal(m.category, "History");
  assert.equal(m.skipped, false);
  assert.equal(game.getState().mistakes.length, 1);
});

test("a perfect run records no mistakes and openReview is refused", () => {
  const game = newGame();
  game.start("Ana");
  while (game.getState().screen !== SCREENS.RESULTS) {
    if (game.getState().screen === SCREENS.QUESTION) answerAndNext(game);
    else game.next();
  }
  assert.deepEqual(game.getState().mistakes, []);
  assert.equal(game.openReview(), false);
});

test("the recorded correct text matches the bank, whatever the shuffle", () => {
  const byId = new Map(bank.map((q) => [q.id, q]));
  for (let seed = 1; seed <= 10; seed++) {
    const game = newGame(seed);
    game.start("", "Science");
    while (game.getState().screen === SCREENS.QUESTION) answerAndNext(game, { correct: false });
    const { mistakes } = game.getState();
    assert.equal(mistakes.length, 10);
    for (const m of mistakes) {
      const original = byId.get(m.questionId);
      assert.equal(m.correctText, original.options[original.correctIndex], `${m.questionId} seed ${seed}`);
      assert.notEqual(m.chosenText, m.correctText);
    }
  }
});

test("skipped questions appear in the review as skipped, with no chosen text", () => {
  const game = newGame();
  game.start("", "Geography");
  game.skip();
  const [m] = game.getState().mistakes;
  assert.equal(m.skipped, true);
  assert.equal(m.chosenText, null);
});

test("review opens from results and goes back; mistakes are not in the saved record", () => {
  const game = newGame();
  game.start("Ana", "Arts & Culture");
  while (game.getState().screen === SCREENS.QUESTION) answerAndNext(game, { correct: false });
  const record = game.takeResultToSave();
  assert.equal("mistakes" in record, false, "review data stays in memory only");
  assert.equal(game.openReview(), true);
  assert.equal(game.getState().screen, SCREENS.REVIEW);
  assert.equal(game.closeReview(), true);
  assert.equal(game.getState().screen, SCREENS.RESULTS);
});

test("the leaderboard returns to wherever it was opened from", () => {
  const game = newGame();
  assert.equal(game.openLeaderboard(), true);
  assert.equal(game.getState().screen, SCREENS.LEADERBOARD);
  assert.equal(game.closeLeaderboard(), true);
  assert.equal(game.getState().screen, SCREENS.START);

  game.start("", "History");
  assert.equal(game.openLeaderboard(), false, "not from a question");
  while (game.getState().screen === SCREENS.QUESTION) answerAndNext(game);
  assert.equal(game.openLeaderboard(), true);
  game.closeLeaderboard();
  assert.equal(game.getState().screen, SCREENS.RESULTS);
});

/* ---------- Points, timing and Speed Quiz ---------- */

import { SPEED_SUBJECT } from "../js/config.js";

/** A clock the test moves by hand. */
function fakeClock(start = Date.UTC(2026, 10, 15, 12)) {
  let t = start;
  return { now: () => new Date(t), advance: (ms) => (t += ms) };
}

test("points: fast vs slow answers, and hints cost the no-hint bonus", () => {
  const clock = fakeClock();
  const game = createGame(bank, { rng: seededRng(8), now: clock.now });
  game.start("", "History");

  clock.advance(4_000);
  const q1 = game.getState().question;
  game.answer(q1.correctIndex);
  const p1 = game.getState().answer.points;
  assert.equal(p1.time, 3, "under 10 s");
  assert.equal(p1.noHint, 2);
  game.next();

  clock.advance(12_000);
  game.eliminate();
  const q2 = game.getState().question;
  game.answer(q2.correctIndex);
  const p2 = game.getState().answer.points;
  assert.equal(p2.time, 0, "over 10 s");
  assert.equal(p2.noHint, 0, "used Eliminate");
  assert.equal(game.getState().points, p1.total + p2.total);
  assert.equal(game.getState().streak, 2);
});

test("the answer clock restarts on every question", () => {
  const clock = fakeClock();
  const game = createGame(bank, { rng: seededRng(8), now: clock.now });
  game.start("", "Science");
  clock.advance(30_000); // slow on the first question
  game.skip();
  clock.advance(2_000); // quick on the second
  game.answer(game.getState().question.correctIndex);
  assert.equal(game.getState().answer.timeMs, 2_000);
  assert.equal(game.getState().answer.points.time, 3);
});

test("skipping resets the streak", () => {
  const game = newGame();
  game.start("", "Geography");
  answerAndNext(game);
  answerAndNext(game);
  assert.equal(game.getState().streak, 2);
  game.skip();
  assert.equal(game.getState().streak, 0);
});

test("Speed Quiz: 20 mixed questions, no category summaries", () => {
  const game = newGame(3);
  assert.equal(game.start("Ana", SPEED_SUBJECT), true);
  const s = game.getState();
  assert.equal(s.mode, "speed");
  assert.equal(s.totalQuestions, 20);
  assert.equal(s.timeLimitMs, 15_000);
  for (let i = 0; i < 20; i++) {
    assert.equal(game.getState().screen, SCREENS.QUESTION, `question ${i + 1}`);
    answerAndNext(game);
  }
  assert.equal(game.getState().screen, SCREENS.RESULTS);
  const record = game.takeResultToSave();
  assert.equal(record.mode, "speed");
  assert.equal(record.maxScore, 20);
  assert.equal(record.total, 20);
  assert.deepEqual(Object.values(record.byCategory), [5, 5, 5, 5]);
});

test("Speed Quiz: timeOut() is refused before 15 s and works after", () => {
  const clock = fakeClock();
  const game = createGame(bank, { rng: seededRng(4), now: clock.now });
  game.start("", SPEED_SUBJECT);
  clock.advance(14_999);
  assert.equal(game.timeOut(), false, "not yet");
  assert.equal(game.getState().timeLeftMs, 1);
  clock.advance(1);
  assert.equal(game.timeOut(), true);
  const s = game.getState();
  assert.equal(s.answer.timedOut, true);
  assert.equal(s.answer.correct, false);
  assert.equal(s.answer.points.total, 0);
  assert.equal(s.timeLeftMs, null, "no clock once answered");
  assert.equal(s.mistakes[0].timedOut, true);
  assert.equal(game.answer(s.question.correctIndex), false, "locked after time-out");
  assert.equal(game.next(), true);
});

test("Speed Quiz: a late answer (after the deadline) counts as timed out", () => {
  const clock = fakeClock();
  const game = createGame(bank, { rng: seededRng(4), now: clock.now });
  game.start("", SPEED_SUBJECT);
  clock.advance(20_000);
  assert.equal(game.answer(game.getState().question.correctIndex), true);
  assert.equal(game.getState().answer.timedOut, true);
  assert.equal(game.getState().score, 0);
});

test("untimed modes have no time limit and no timeOut", () => {
  const clock = fakeClock();
  const game = createGame(bank, { rng: seededRng(4), now: clock.now });
  game.start("", "History");
  clock.advance(60_000);
  assert.equal(game.getState().timeLimitMs, null);
  assert.equal(game.timeOut(), false);
  assert.equal(game.answer(game.getState().question.correctIndex), true);
  assert.equal(game.getState().answer.correct, true);
});
