// Run state machine. No DOM access: the UI reads getState() and calls the
// transition functions; each returns true if it changed anything.
//
//   start ──start()──▶ question ──answer()──▶ (answered) ──next()──┐
//     ▲                   ▲                                         │
//     │                   └────── next() (more in category) ◀───────┤
//     │                                                             ▼
//     ├──── exit() from question/summary            summary (end of category)
//     │                                                             │
//     └──── toStart() from results ◀── results ◀── next() (last category)

import { CATEGORIES, RANK_TIERS, NICKNAME_MAX } from "./config.js";
import { buildRun } from "./quiz.js";
import { summarize, tierFor } from "./scoring.js";

export const SCREENS = Object.freeze({
  START: "start",
  QUESTION: "question",
  SUMMARY: "summary",
  RESULTS: "results",
});

/** Trim and cap a nickname. */
export function cleanNickname(value) {
  return String(value ?? "").trim().slice(0, NICKNAME_MAX);
}

/**
 * @param {object[]} questions validated question bank
 * @param {object} [options]
 * @param {() => number} [options.rng] for shuffling (inject a seeded one in tests)
 * @param {() => Date} [options.now] clock for finishedAt
 * @param {readonly string[]} [options.categories]
 * @param {readonly {name: string, min: number}[]} [options.tiers]
 */
export function createGame(
  questions,
  { rng = Math.random, now = () => new Date(), categories = CATEGORIES, tiers = RANK_TIERS } = {}
) {
  let screen = SCREENS.START;
  let nickname = "";
  let run = [];
  let index = 0;
  let answers = [];
  let score = 0;
  let resultToSave = null;

  function resetRun() {
    run = [];
    index = 0;
    answers = [];
    score = 0;
    resultToSave = null;
  }

  function isLastInCategory(i) {
    return i === run.length - 1 || run[i + 1].category !== run[i].category;
  }

  /** Begin a new run with a fresh shuffle. Allowed from start or results. */
  function start(name = nickname) {
    if (screen !== SCREENS.START && screen !== SCREENS.RESULTS) return false;
    nickname = cleanNickname(name);
    resetRun();
    run = buildRun(questions, rng, categories);
    screen = SCREENS.QUESTION;
    return true;
  }

  /** Record the answer to the current question. Only the first call counts. */
  function answer(optionIndex) {
    if (screen !== SCREENS.QUESTION || answers[index]) return false;
    const question = run[index];
    if (
      !Number.isInteger(optionIndex) ||
      optionIndex < 0 ||
      optionIndex >= question.options.length
    ) {
      return false;
    }
    const correct = optionIndex === question.correctIndex;
    answers[index] = {
      questionId: question.id,
      category: question.category,
      chosenIndex: optionIndex,
      correctIndex: question.correctIndex,
      correct,
    };
    if (correct) score += 1;
    return true;
  }

  /** Advance: next question, category summary, next category, or results. */
  function next() {
    if (screen === SCREENS.QUESTION) {
      if (!answers[index]) return false; // must answer first
      if (isLastInCategory(index)) screen = SCREENS.SUMMARY;
      else index += 1;
      return true;
    }
    if (screen === SCREENS.SUMMARY) {
      if (index === run.length - 1) {
        screen = SCREENS.RESULTS;
        const { total, byCategory } = summarize(answers, categories);
        resultToSave = {
          nickname,
          finishedAt: now().toISOString(),
          total,
          byCategory,
          tier: tierFor(total, tiers).name,
        };
      } else {
        index += 1;
        screen = SCREENS.QUESTION;
      }
      return true;
    }
    return false;
  }

  /** Abandon the current run (nothing is saved) and go back to Start. */
  function exit() {
    if (screen !== SCREENS.QUESTION && screen !== SCREENS.SUMMARY) return false;
    resetRun();
    screen = SCREENS.START;
    return true;
  }

  /** From Results back to Start, keeping the nickname for the next run. */
  function toStart() {
    if (screen !== SCREENS.RESULTS) return false;
    resetRun();
    screen = SCREENS.START;
    return true;
  }

  /**
   * The finished-run record, returned once per run and null after that,
   * so re-rendering Results can never save twice.
   */
  function takeResultToSave() {
    const result = resultToSave;
    resultToSave = null;
    return result;
  }

  /** Read-only snapshot for rendering. */
  function getState() {
    const question = run[index] ?? null;
    const category = question ? question.category : null;
    const inCategory = run.filter((q) => q.category === category);
    const firstOfCategory = run.findIndex((q) => q.category === category);
    const categoryAnswers = answers.filter((a) => a && a.category === category);
    const { total, byCategory } = summarize(answers, categories);

    return Object.freeze({
      screen,
      nickname,
      totalQuestions: run.length,
      index,
      question,
      answer: answers[index] ?? null,
      answeredCount: answers.filter(Boolean).length,
      score,
      category,
      categoryIndex: categories.indexOf(category),
      categoryCount: categories.length,
      positionInCategory: index - firstOfCategory + 1,
      categorySize: inCategory.length,
      categoryScore: categoryAnswers.filter((a) => a.correct).length,
      isLastCategory: run.length > 0 && category === run[run.length - 1].category,
      total,
      byCategory,
      tier: tierFor(total, tiers),
    });
  }

  return { start, answer, next, exit, toStart, takeResultToSave, getState };
}
