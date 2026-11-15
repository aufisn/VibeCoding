// Pure validation for the question bank. No DOM, no I/O: runs in the
// browser and in Node alike.

import {
  CATEGORIES,
  QUESTIONS_PER_CATEGORY,
  TOTAL_QUESTIONS,
  DIFFICULTY_MIX,
} from "./config.js";

export const MAX_QUESTION_WORDS = 25;
export const MAX_OPTION_WORDS = 8;
const OPTION_COUNT = 4;
const BANNED_OPTIONS = ["all of the above", "none of the above"];

/** Number of whitespace-separated words in a string. */
export function wordCount(text) {
  const trimmed = String(text).trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** Readable label for a question in messages, e.g. `geo-03` or `#7`. */
function label(q, index) {
  return q && isNonEmptyString(q.id) ? q.id : `#${index + 1}`;
}

/** Errors for a single question object (bank-level checks live elsewhere). */
function checkQuestion(q, index) {
  const errors = [];
  const name = label(q, index);

  if (q === null || typeof q !== "object" || Array.isArray(q)) {
    return [`${name}: entry is not an object`];
  }

  if (!isNonEmptyString(q.id)) errors.push(`${name}: missing id`);

  if (!CATEGORIES.includes(q.category)) {
    errors.push(`${name}: category "${q.category}" is not one of ${CATEGORIES.join(", ")}`);
  }

  if (!Object.hasOwn(DIFFICULTY_MIX, q.difficulty)) {
    errors.push(`${name}: difficulty "${q.difficulty}" must be easy, medium or hard`);
  }

  if (!isNonEmptyString(q.question)) {
    errors.push(`${name}: missing question`);
  } else if (wordCount(q.question) > MAX_QUESTION_WORDS) {
    errors.push(
      `${name}: question has ${wordCount(q.question)} words (max ${MAX_QUESTION_WORDS})`
    );
  }

  if (!isNonEmptyString(q.explanation)) errors.push(`${name}: missing explanation`);

  errors.push(...checkOptions(q.options, name));

  if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) {
    errors.push(`${name}: correctIndex must be an integer 0-3 (got ${JSON.stringify(q.correctIndex)})`);
  }

  return errors;
}

function checkOptions(options, name) {
  if (!Array.isArray(options) || options.length !== OPTION_COUNT) {
    const got = Array.isArray(options) ? options.length : typeof options;
    return [`${name}: options must be exactly ${OPTION_COUNT} strings (got ${got})`];
  }

  const errors = [];
  const seen = new Set();
  options.forEach((opt, i) => {
    if (!isNonEmptyString(opt)) {
      errors.push(`${name}: option ${i + 1} is empty or not a string`);
      return;
    }
    const normal = opt.trim().toLowerCase();
    if (seen.has(normal)) errors.push(`${name}: option "${opt}" is duplicated`);
    seen.add(normal);
    if (wordCount(opt) > MAX_OPTION_WORDS) {
      errors.push(`${name}: option "${opt}" has ${wordCount(opt)} words (max ${MAX_OPTION_WORDS})`);
    }
    if (BANNED_OPTIONS.includes(normal)) {
      errors.push(`${name}: option "${opt}" is not allowed`);
    }
  });
  return errors;
}

/**
 * Validate the whole question bank.
 * @param {unknown} list parsed contents of data/questions.json
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateQuestions(list) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(list)) {
    return { errors: ["Question data is not an array"], warnings };
  }

  if (list.length !== TOTAL_QUESTIONS) {
    errors.push(`Expected ${TOTAL_QUESTIONS} questions in total, found ${list.length}`);
  }

  // Per-question checks, duplicate ids and unverified warnings.
  const ids = new Set();
  list.forEach((q, i) => {
    errors.push(...checkQuestion(q, i));
    if (q && isNonEmptyString(q.id)) {
      if (ids.has(q.id)) errors.push(`${q.id}: duplicate id`);
      ids.add(q.id);
    }
    if (!q || q.verified !== true) warnings.push(`${label(q, i)}: not verified`);
  });

  // Per-category count and difficulty mix.
  for (const category of CATEGORIES) {
    const inCategory = list.filter((q) => q && q.category === category);
    if (inCategory.length !== QUESTIONS_PER_CATEGORY) {
      errors.push(
        `${category}: has ${inCategory.length} questions (need exactly ${QUESTIONS_PER_CATEGORY})`
      );
    }
    for (const [level, needed] of Object.entries(DIFFICULTY_MIX)) {
      const found = inCategory.filter((q) => q.difficulty === level).length;
      if (found !== needed) {
        errors.push(`${category}: has ${found} ${level} questions (need exactly ${needed})`);
      }
    }
  }

  return { errors, warnings };
}
