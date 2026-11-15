// Run state machine. No DOM access: the UI reads getState() and calls the
// transition functions; each returns true if it changed anything.
//
//   start ──start(name, subject)──▶ question ──answer()/eliminate()──▶ …
//     ▲                               │  ▲
//     │              next() / skip()  │  └── more questions in the category
//     │                               ▼
//     ├── exit() from question/summary   summary (end of a category, "All" only)
//     │                               │
//     └── toStart() ◀── results ◀─────┘  last category (or a one-subject run)

import {
  ALL_SUBJECTS,
  CATEGORIES,
  ELIMINATE_PER_QUESTION,
  RANK_TIERS,
  NICKNAME_MAX,
} from "./config.js";
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
 * @param {() => number} [options.rng] for shuffling and eliminating (inject a seeded one in tests)
 * @param {() => Date} [options.now] clock for finishedAt
 * @param {readonly string[]} [options.categories]
 * @param {readonly {name: string, min: number}[]} [options.tiers]
 * @param {number} [options.eliminatePerQuestion]
 */
export function createGame(
  questions,
  {
    rng = Math.random,
    now = () => new Date(),
    categories = CATEGORIES,
    tiers = RANK_TIERS,
    eliminatePerQuestion = ELIMINATE_PER_QUESTION,
  } = {}
) {
  let screen = SCREENS.START;
  let nickname = "";
  let subject = ALL_SUBJECTS;
  let playCategories = categories;
  let run = [];
  let index = 0;
  let answers = []; // per question: answer record, or undefined while open
  let eliminated = []; // per question: option indexes removed by eliminate()
  let score = 0;
  let resultToSave = null;

  function resetRun() {
    run = [];
    index = 0;
    answers = [];
    eliminated = [];
    score = 0;
    resultToSave = null;
  }

  function isLastInCategory(i) {
    return i === run.length - 1 || run[i + 1].category !== run[i].category;
  }

  function eliminatedAt(i) {
    return eliminated[i] ?? [];
  }

  function countEliminations() {
    return eliminated.reduce((sum, list) => sum + (list ? list.length : 0), 0);
  }

  function finish() {
    screen = SCREENS.RESULTS;
    const { total, byCategory } = summarize(answers, playCategories);
    resultToSave = {
      nickname,
      finishedAt: now().toISOString(),
      subject,
      total,
      maxScore: run.length,
      byCategory,
      skipped: answers.filter((a) => a && a.skipped).length,
      eliminated: countEliminations(),
      tier: tierFor(total, tiers, run.length).name,
    };
  }

  /** Move on from an answered or skipped question. */
  function advanceFromQuestion() {
    if (!isLastInCategory(index)) index += 1;
    else if (playCategories.length === 1) finish(); // one subject: no summary
    else screen = SCREENS.SUMMARY;
  }

  /**
   * Begin a new run with a fresh shuffle. Allowed from start or results.
   * @param {string} [name]
   * @param {string} [chosen] a category name, or ALL_SUBJECTS
   */
  function start(name = nickname, chosen = ALL_SUBJECTS) {
    if (screen !== SCREENS.START && screen !== SCREENS.RESULTS) return false;
    if (chosen !== ALL_SUBJECTS && !categories.includes(chosen)) return false;
    nickname = cleanNickname(name);
    subject = chosen;
    playCategories = chosen === ALL_SUBJECTS ? categories : [chosen];
    resetRun();
    run = buildRun(questions, rng, playCategories);
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
      optionIndex >= question.options.length ||
      eliminatedAt(index).includes(optionIndex)
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
      skipped: false,
    };
    if (correct) score += 1;
    return true;
  }

  /**
   * Remove one wrong option from the current question, chosen at random.
   * At most `eliminatePerQuestion` per question, and at least one wrong
   * option always stays. Only before answering.
   */
  function eliminate() {
    if (screen !== SCREENS.QUESTION || answers[index]) return false;
    const gone = eliminatedAt(index);
    if (gone.length >= eliminatePerQuestion) return false;
    const question = run[index];
    const candidates = question.options
      .map((_, i) => i)
      .filter((i) => i !== question.correctIndex && !gone.includes(i));
    if (candidates.length <= 1) return false;
    const pick = candidates[Math.floor(rng() * candidates.length)];
    eliminated[index] = [...gone, pick];
    return true;
  }

  /** Skip the current question: it scores 0 and play moves straight on. */
  function skip() {
    if (screen !== SCREENS.QUESTION || answers[index]) return false;
    const question = run[index];
    answers[index] = {
      questionId: question.id,
      category: question.category,
      chosenIndex: null,
      correctIndex: question.correctIndex,
      correct: false,
      skipped: true,
    };
    advanceFromQuestion();
    return true;
  }

  /** Advance: next question, category summary, next category, or results. */
  function next() {
    if (screen === SCREENS.QUESTION) {
      if (!answers[index]) return false; // must answer (or skip) first
      advanceFromQuestion();
      return true;
    }
    if (screen === SCREENS.SUMMARY) {
      if (index === run.length - 1) finish();
      else {
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
    const { total, byCategory } = summarize(answers, playCategories);
    const gone = eliminatedAt(index);
    const open = screen === SCREENS.QUESTION && !answers[index];
    const wrongLeft = question ? question.options.length - 1 - gone.length : 0;

    return Object.freeze({
      screen,
      nickname,
      subject,
      playCategories,
      totalQuestions: run.length,
      maxScore: run.length,
      index,
      question,
      answer: answers[index] ?? null,
      answeredCount: answers.filter(Boolean).length, // answered or skipped
      skippedCount: answers.filter((a) => a && a.skipped).length,
      eliminationsUsed: countEliminations(),
      eliminated: Object.freeze([...gone]),
      eliminationsLeft: Math.max(0, eliminatePerQuestion - gone.length),
      canEliminate: open && gone.length < eliminatePerQuestion && wrongLeft > 1,
      canSkip: open,
      score,
      category,
      categoryIndex: playCategories.indexOf(category),
      categoryCount: playCategories.length,
      positionInCategory: index - firstOfCategory + 1,
      categorySize: inCategory.length,
      categoryScore: categoryAnswers.filter((a) => a.correct).length,
      categorySkipped: categoryAnswers.filter((a) => a.skipped).length,
      isLastCategory: run.length > 0 && category === run[run.length - 1].category,
      total,
      byCategory,
      tier: tierFor(total, tiers, run.length || undefined),
    });
  }

  return { start, answer, eliminate, skip, next, exit, toStart, takeResultToSave, getState };
}
