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
  assert.deepEqual(record, {
    nickname: "Ana",
    finishedAt: FIXED_NOW.toISOString(),
    subject: "All",
    total: 40,
    maxScore: 40,
    byCategory: { History: 10, Science: 10, Geography: 10, "Arts & Culture": 10 },
    skipped: 0,
    eliminated: 0,
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
