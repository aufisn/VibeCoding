// Run state machine. No DOM access: the UI reads getState() and calls the
// transition functions; each returns true if it changed anything.
//
//   start ──start(name, subject)──▶ question ──answer()/eliminate()──▶ …
//     ▲                               │  ▲
//     │              next() / skip()  │  └── more questions in the category
//     │                               ▼
//     ├── exit() from question/summary   summary (end of a category, Full Challenge only)
//     │                               │
//     └── toStart() ◀── results ◀─────┘  last question of the run
//
//   Modes (start's `chosen`): ALL_SUBJECTS = Full Challenge (40),
//   a category name = By Category (10), SPEED_SUBJECT = Speed Quiz (20,
//   SPEED_SECONDS per question; timeOut() ends a question when time is up).
//   Points come from the ScoreManager (score-manager.js); `score` stays the
//   count of correct answers, which sets the rank.
//
//   results ⇄ review       (openReview / closeReview; only with mistakes)
//   start or results ⇄ leaderboard  (openLeaderboard / closeLeaderboard)
//   start or results ⇄ stats        (openStats / closeStats)

import {
  ALL_SUBJECTS,
  CATEGORIES,
  DIFFICULTY_CHOICES,
  DIFFICULTY_MIX,
  MIXED,
  QUESTIONS_PER_CATEGORY,
  ELIMINATE_PER_QUESTION,
  MODES,
  NICKNAME_MAX,
  RANK_TIERS,
  SCORING,
  SPEED_PER_CATEGORY,
  SPEED_SECONDS,
  SPEED_SUBJECT,
} from "./config.js";
import { buildRun, buildSpeedRun } from "./quiz.js";
import { summarize, tierFor } from "./scoring.js";
import { createScoreManager } from "./score-manager.js";

export const SCREENS = Object.freeze({
  START: "start",
  QUESTION: "question",
  SUMMARY: "summary",
  RESULTS: "results",
  REVIEW: "review",
  LEADERBOARD: "leaderboard",
  STATS: "stats",
});

/** Trim and cap a nickname. */
export function cleanNickname(value) {
  return String(value ?? "").trim().slice(0, NICKNAME_MAX);
}

/**
 * @param {object[]} questions validated question bank
 * @param {object} [options]
 * @param {() => number} [options.rng] for shuffling and eliminating (inject a seeded one in tests)
 * @param {() => Date} [options.now] clock for finishedAt and answer times (inject a fake in tests)
 * @param {readonly string[]} [options.categories]
 * @param {readonly {name: string, min: number}[]} [options.tiers]
 * @param {number} [options.eliminatePerQuestion]
 * @param {typeof SCORING} [options.scoring]
 * @param {number} [options.speedSeconds]
 */
export function createGame(
  questions,
  {
    rng = Math.random,
    now = () => new Date(),
    categories = CATEGORIES,
    tiers = RANK_TIERS,
    eliminatePerQuestion = ELIMINATE_PER_QUESTION,
    scoring = SCORING,
    speedSeconds = SPEED_SECONDS,
  } = {}
) {
  let screen = SCREENS.START;
  let nickname = "";
  let subject = ALL_SUBJECTS;
  let mode = MODES.FULL;
  let difficulty = MIXED; // kept between runs, like the nickname
  let playCategories = categories;
  let scores = createScoreManager(scoring);
  let questionShownAt = 0; // ms, from now(), when the current question appeared
  let run = [];
  let index = 0;
  let answers = []; // per question: answer record, or undefined while open
  let eliminated = []; // per question: option indexes removed by eliminate()
  let score = 0;
  let resultToSave = null;
  let leaderboardFrom = SCREENS.START;
  let statsFrom = SCREENS.START;

  function resetRun() {
    run = [];
    index = 0;
    answers = [];
    eliminated = [];
    score = 0;
    resultToSave = null;
    scores = createScoreManager(scoring);
  }

  const clock = () => now().getTime();
  const timeLimitMs = () => (mode === MODES.SPEED ? speedSeconds * 1000 : null);

  /** Call whenever a new question appears: starts its clock. */
  function showQuestion() {
    questionShownAt = clock();
  }

  function elapsedMs() {
    return Math.max(0, clock() - questionShownAt);
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
    const { points, bestStreak, totals } = scores.getState();
    resultToSave = {
      nickname,
      finishedAt: now().toISOString(),
      mode,
      subject,
      difficulty,
      points,
      total,
      maxScore: run.length,
      byCategory,
      questionsByCategory: Object.fromEntries(
        playCategories.map((c) => [c, run.filter((q) => q.category === c).length])
      ),
      byDifficulty: Object.fromEntries(
        ["easy", "medium", "hard"]
          .map((d) => [
            d,
            {
              correct: answers.filter((a) => a && a.difficulty === d && a.correct).length,
              questions: run.filter((q) => q.difficulty === d).length,
            },
          ])
          .filter(([, v]) => v.questions > 0)
      ),
      skipped: answers.filter((a) => a && a.skipped).length,
      timedOut: answers.filter((a) => a && a.timedOut).length,
      eliminated: countEliminations(),
      bestStreak,
      bonuses: { base: totals.base, time: totals.time, noHint: totals.noHint, streak: totals.streak },
      tier: tierFor(total, tiers, run.length).name,
    };
  }

  /**
   * What happened on one question. Option texts are stored (not just
   * indexes) because options are shuffled per run; the review screen needs
   * the words. In memory only: never saved.
   * Also scores it with the ScoreManager.
   * @param {object} question the shuffled question
   * @param {number | null} chosenIndex null when skipped or timed out
   * @param {{ timedOut?: boolean }} [how]
   */
  function record(question, chosenIndex, { timedOut = false } = {}) {
    const noAnswer = chosenIndex === null;
    const correct = chosenIndex === question.correctIndex;
    const timeMs = elapsedMs();
    const points = scores.record({
      difficulty: question.difficulty,
      correct,
      timeMs,
      usedHint: eliminatedAt(index).length > 0,
    });
    return {
      questionId: question.id,
      category: question.category,
      difficulty: question.difficulty,
      question: question.question,
      chosenIndex,
      correctIndex: question.correctIndex,
      chosenText: noAnswer ? null : question.options[chosenIndex],
      correctText: question.options[question.correctIndex],
      explanation: question.explanation,
      correct,
      skipped: noAnswer && !timedOut,
      timedOut,
      timeMs,
      points,
    };
  }

  /** Wrong and skipped answers of the current run, in play order. */
  function mistakes() {
    return answers.filter((a) => a && !a.correct);
  }

  /** Move on from an answered or skipped question. */
  function advanceFromQuestion() {
    if (index === run.length - 1) {
      // Full Challenge shows the last category's summary before results.
      if (mode === MODES.FULL) screen = SCREENS.SUMMARY;
      else finish();
    } else if (mode === MODES.FULL && isLastInCategory(index)) {
      screen = SCREENS.SUMMARY;
    } else {
      index += 1;
      showQuestion();
    }
  }

  /**
   * Begin a new run with a fresh shuffle. Allowed from start or results.
   * @param {string} [name]
   * @param {string} [chosen] ALL_SUBJECTS (Full Challenge), a category name
   *   (By Category) or SPEED_SUBJECT (Speed Quiz)
   * @param {string} [level] one of DIFFICULTY_CHOICES; defaults to the last one used
   */
  function start(name = nickname, chosen = ALL_SUBJECTS, level = difficulty) {
    if (screen !== SCREENS.START && screen !== SCREENS.RESULTS) return false;
    if (chosen !== ALL_SUBJECTS && chosen !== SPEED_SUBJECT && !categories.includes(chosen)) return false;
    if (!DIFFICULTY_CHOICES.includes(level)) return false;
    nickname = cleanNickname(name);
    subject = chosen;
    difficulty = level;
    mode = chosen === ALL_SUBJECTS ? MODES.FULL : chosen === SPEED_SUBJECT ? MODES.SPEED : MODES.CATEGORY;
    playCategories = mode === MODES.CATEGORY ? [chosen] : categories;
    resetRun();
    const pool = poolFor(difficulty);
    run =
      mode === MODES.SPEED
        ? buildSpeedRun(pool, rng, SPEED_PER_CATEGORY, categories)
        : buildRun(pool, rng, playCategories, { mix: difficulty === MIXED ? DIFFICULTY_MIX : null });
    screen = SCREENS.QUESTION;
    showQuestion();
    return true;
  }

  /** The questions a difficulty choice plays from. */
  function poolFor(level) {
    return level === MIXED ? questions : questions.filter((q) => q.difficulty === level);
  }

  /**
   * How many questions a run would have, for the Start screen's cards.
   * @param {string} chosen as for start()
   * @param {string} [level]
   */
  function questionCount(chosen, level = difficulty) {
    const pool = poolFor(level);
    // A round takes at most QUESTIONS_PER_CATEGORY from each category.
    const inCategory = (c) => Math.min(QUESTIONS_PER_CATEGORY, pool.filter((q) => q.category === c).length);
    if (chosen === SPEED_SUBJECT) return categories.reduce((n, c) => n + Math.min(SPEED_PER_CATEGORY, inCategory(c)), 0);
    if (chosen === ALL_SUBJECTS) return categories.reduce((n, c) => n + inCategory(c), 0);
    return inCategory(chosen);
  }

  /** Change the difficulty for the next run (Start screen). */
  function setDifficulty(level) {
    if (!DIFFICULTY_CHOICES.includes(level)) return false;
    difficulty = level;
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
    // An answer that arrives after the Speed Quiz deadline (e.g. the tab was
    // in the background and the countdown didn't fire) counts as timed out.
    if (isOutOfTime()) {
      answers[index] = record(question, null, { timedOut: true });
      return true;
    }
    answers[index] = record(question, optionIndex);
    if (answers[index].correct) score += 1;
    return true;
  }

  function isOutOfTime() {
    const limit = timeLimitMs();
    return limit !== null && elapsedMs() >= limit;
  }

  /**
   * Speed Quiz: end the current question when its time is up. It scores 0,
   * resets the streak, and reveals the answer like a wrong answer. Refused
   * (false) before the deadline, so an early call can't cut a question short.
   */
  function timeOut() {
    if (screen !== SCREENS.QUESTION || answers[index] || !isOutOfTime()) return false;
    answers[index] = record(run[index], null, { timedOut: true });
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
    answers[index] = record(run[index], null);
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
        showQuestion();
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

  /** Results -> review of wrong and skipped questions (if there are any). */
  function openReview() {
    if (screen !== SCREENS.RESULTS || mistakes().length === 0) return false;
    screen = SCREENS.REVIEW;
    return true;
  }

  function closeReview() {
    if (screen !== SCREENS.REVIEW) return false;
    screen = SCREENS.RESULTS;
    return true;
  }

  /** Start or Results -> leaderboard; closeLeaderboard() goes back there. */
  function openLeaderboard() {
    if (screen !== SCREENS.START && screen !== SCREENS.RESULTS) return false;
    leaderboardFrom = screen;
    screen = SCREENS.LEADERBOARD;
    return true;
  }

  function closeLeaderboard() {
    if (screen !== SCREENS.LEADERBOARD) return false;
    screen = leaderboardFrom;
    return true;
  }

  /** Start or Results -> statistics; closeStats() goes back there. */
  function openStats() {
    if (screen !== SCREENS.START && screen !== SCREENS.RESULTS) return false;
    statsFrom = screen;
    screen = SCREENS.STATS;
    return true;
  }

  function closeStats() {
    if (screen !== SCREENS.STATS) return false;
    screen = statsFrom;
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
    const limit = timeLimitMs();
    const scoreState = scores.getState();
    const categoryTotals = Object.fromEntries(
      playCategories.map((c) => [c, run.filter((q) => q.category === c).length])
    );

    return Object.freeze({
      screen,
      nickname,
      subject,
      mode,
      difficulty,
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
      mistakes: Object.freeze(mistakes().map((m) => Object.freeze({ ...m }))),
      leaderboardFrom,
      statsFrom,
      categoryTotals,
      timedOutCount: answers.filter((a) => a && a.timedOut).length,
      // Points (ScoreManager)
      points: scoreState.points,
      streak: scoreState.streak,
      bestStreak: scoreState.bestStreak,
      pointTotals: scoreState.totals,
      // Speed Quiz clock (null in untimed modes)
      timeLimitMs: limit,
      timeLeftMs: limit !== null && open ? Math.max(0, limit - elapsedMs()) : null,
    });
  }

  return {
    start,
    answer,
    eliminate,
    skip,
    timeOut,
    next,
    exit,
    toStart,
    openReview,
    closeReview,
    openLeaderboard,
    closeLeaderboard,
    openStats,
    closeStats,
    setDifficulty,
    questionCount,
    takeResultToSave,
    getState,
  };
}
