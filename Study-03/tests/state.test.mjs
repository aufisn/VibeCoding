import { test } from "node:test";
import assert from "node:assert/strict";

import { createGame, SCREENS, cleanNickname } from "../js/state.js";
import { seededRng } from "../js/quiz.js";
import { CATEGORIES } from "../js/config.js";
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
    total: 40,
    byCategory: { History: 10, Science: 10, Geography: 10, "Arts & Culture": 10 },
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
