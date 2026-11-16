// Question bank analysis. Pure: no DOM, no I/O, so it runs in the browser
// (a check every time a game starts) and in Node (scripts/analyze-bank.mjs,
// scripts/add-questions.mjs and the /quiz-expand skill).
//
//   analyzeBank(questions)            structure, counts and distribution,
//                                     missing categories, duplicates, gaps
//   checkNewQuestions(bank, drafts)   format, rules and duplicates for
//                                     questions about to be added

import { CATEGORIES, DIFFICULTY_MIX, QUESTIONS_PER_CATEGORY } from "./config.js";
import { checkQuestion, validateQuestions } from "./validate.js";

export const ID_PREFIXES = Object.freeze({
  History: "hist",
  Science: "sci",
  Geography: "geo",
  "Arts & Culture": "art",
});

const LEVELS = Object.keys(DIFFICULTY_MIX); // easy, medium, hard

/** Two questions with this much word overlap (0 to 1) are flagged as similar. */
export const SIMILARITY_THRESHOLD = 0.75;

const STOP_WORDS = new Set(
  "a an the of in on at to for by and or is was were are which what who whom whose when where how did does do its it this that as from with into".split(" ")
);

// Number words and Roman numerals compare as digits: "World War Two" and
// "World War II" are the same question. (Lone "i" and "v" are left alone.)
const NUMBER_WORDS = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
  first: "1st", second: "2nd", third: "3rd",
};

// Combining accent marks (U+0300 to U+036F), built from codes so the source stays plain ASCII.
const ACCENTS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** Lowercase, no accents or punctuation, numbers as digits: "World War Two?" -> "world war 2". */
export function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(ACCENTS, "") // accents, split off by NFKD
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w)
    .join(" ");
}

function keyWords(text) {
  return new Set(normalizeText(text).split(" ").filter((w) => w && !STOP_WORDS.has(w)));
}

/** Word overlap between two questions (Jaccard index of their key words), 0 to 1. */
export function similarity(a, b) {
  const x = keyWords(a);
  const y = keyWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / (x.size + y.size - shared);
}

const correctText = (q) => (Array.isArray(q?.options) ? q.options[q.correctIndex] : undefined);

/**
 * Duplicates among `list`, optionally only pairs involving `onlyIds`.
 * @returns {{ kind: "id" | "question" | "similar" | "answer", ids: string[], detail: string }[]}
 *   id: same id (error); question: same text once normalised (error);
 *   similar: high word overlap (warning); answer: same correct answer in the
 *   same category (a note: may be fine, e.g. two different questions about 1945)
 */
export function findDuplicates(list, { onlyIds = null, threshold = SIMILARITY_THRESHOLD } = {}) {
  const found = [];
  const items = list.filter((q) => q && typeof q === "object");
  const involves = (a, b) => !onlyIds || onlyIds.has(a.id) || onlyIds.has(b.id);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!involves(a, b)) continue;
      const ids = [a.id, b.id];
      if (a.id && a.id === b.id) {
        found.push({ kind: "id", ids, detail: `two questions use the id ${a.id}` });
        continue;
      }
      const na = normalizeText(a.question);
      if (na && na === normalizeText(b.question)) {
        found.push({ kind: "question", ids, detail: `same question: "${a.question}"` });
        continue;
      }
      const score = similarity(a.question, b.question);
      if (score >= threshold) {
        found.push({ kind: "similar", ids, detail: `${Math.round(score * 100)}% of key words shared` });
        continue;
      }
      const ca = correctText(a);
      if (a.category === b.category && ca && normalizeText(ca) === normalizeText(correctText(b))) {
        found.push({ kind: "answer", ids, detail: `same correct answer "${ca}" in ${a.category}` });
      }
    }
  }
  return found;
}

/**
 * Full analysis of the question bank.
 * @param {object[]} questions
 * @param {object} [options]
 * @param {readonly string[]} [options.categories]
 * @param {number} [options.growthTarget] questions wanted per category and
 *   difficulty for full single-difficulty rounds (default 10); used for `gaps`
 * @returns {object} see README "Question bank check"
 */
export function analyzeBank(questions, { categories = CATEGORIES, growthTarget = QUESTIONS_PER_CATEGORY } = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const { errors: validationErrors, warnings } = validateQuestions(questions);

  const perCategory = categories.map((category) => {
    const qs = list.filter((q) => q?.category === category);
    const counts = Object.fromEntries(LEVELS.map((l) => [l, qs.filter((q) => q.difficulty === l).length]));
    return {
      category,
      total: qs.length,
      ...counts,
      verified: qs.filter((q) => q.verified === true).length,
      // How many different full Mixed rounds (3/4/3) the category can supply without repeating a question.
      fullRounds: Math.min(...LEVELS.map((l) => Math.floor(counts[l] / DIFFICULTY_MIX[l]))),
    };
  });

  const missingCategories = perCategory.filter((c) => c.total === 0).map((c) => c.category);
  const shortCategories = perCategory
    .filter((c) => c.total > 0 && (c.total < QUESTIONS_PER_CATEGORY || LEVELS.some((l) => c[l] < DIFFICULTY_MIX[l])))
    .map((c) => ({
      category: c.category,
      missing: Object.fromEntries(LEVELS.filter((l) => c[l] < DIFFICULTY_MIX[l]).map((l) => [l, DIFFICULTY_MIX[l] - c[l]])),
    }));

  const unknown = new Map();
  for (const q of list) {
    if (q && !categories.includes(q.category)) unknown.set(q.category, [...(unknown.get(q.category) ?? []), q.id]);
  }
  const unknownCategories = [...unknown].map(([category, ids]) => ({ category: String(category), ids }));

  const idIssues = list
    .filter((q) => q && ID_PREFIXES[q.category] && !new RegExp(`^${ID_PREFIXES[q.category]}-\\d{2,}$`).test(String(q.id)))
    .map((q) => `${q.id}: id should look like ${ID_PREFIXES[q.category]}-NN for ${q.category}`);

  const duplicates = findDuplicates(list);

  // Growth suggestions: how many more of each difficulty to reach the target.
  const gaps = perCategory.flatMap((c) =>
    LEVELS.filter((l) => c[l] < growthTarget).map((l) => ({ category: c.category, difficulty: l, have: c[l], want: growthTarget }))
  );

  const errors = [
    ...validationErrors,
    ...duplicates.filter((d) => d.kind === "question").map((d) => `${d.ids.join(" and ")}: ${d.detail}`),
  ];
  const cautions = [
    ...duplicates.filter((d) => d.kind === "similar").map((d) => `${d.ids.join(" and ")} look alike (${d.detail})`),
    ...idIssues,
  ];
  const notes = duplicates.filter((d) => d.kind === "answer").map((d) => `${d.ids.join(" and ")}: ${d.detail}`);

  return {
    status: errors.length ? "error" : cautions.length ? "warning" : "ok",
    total: list.length,
    verified: list.filter((q) => q?.verified === true).length,
    categoryCount: perCategory.filter((c) => c.total > 0).length,
    perCategory,
    missingCategories,
    shortCategories,
    unknownCategories,
    duplicates,
    gaps,
    errors,
    cautions,
    notes,
    unverifiedCount: warnings.length,
  };
}

/** A one-line summary of an analysis, for the Start screen and logs. */
export function summarizeAnalysis(a) {
  const base = `${a.total} questions in ${a.categoryCount} ${a.categoryCount === 1 ? "category" : "categories"}`;
  if (a.status === "error") return `${base}: ${a.errors.length} problem${a.errors.length === 1 ? "" : "s"} found`;
  if (a.status === "warning") return `${base}: ${a.cautions.length} thing${a.cautions.length === 1 ? "" : "s"} to look at`;
  return `${base}: all checks passed`;
}

/** The next free id for a category, e.g. "hist-11". */
export function nextId(questions, category) {
  const prefix = ID_PREFIXES[category];
  if (!prefix) return null;
  const used = questions
    .map((q) => String(q?.id ?? "").match(new RegExp(`^${prefix}-(\\d+)$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  return `${prefix}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, "0")}`;
}

/** The bank's field order (id first), so added questions look like the others. */
const FIELD_ORDER = ["id", "category", "difficulty", "question", "options", "correctIndex", "explanation", "sourceHint", "verified"];
function inFieldOrder(q) {
  const out = {};
  for (const key of FIELD_ORDER) if (key in q) out[key] = q[key];
  for (const key of Object.keys(q)) if (!(key in out)) out[key] = q[key];
  return out;
}

/**
 * Check questions before adding them to the bank: each must pass the
 * per-question rules, must not duplicate an existing question or another
 * draft, and the bank must still be valid with them added. Ids are assigned
 * here (next free id per category) when a draft has none.
 * @param {object[]} bank the current questions
 * @param {object[]} drafts questions to add
 * @returns {{ ok: boolean, questions: object[], results: { id: string, errors: string[], cautions: string[] }[], bankErrors: string[] }}
 */
export function checkNewQuestions(bank, drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  const working = [...bank];
  const questions = [];
  const results = [];

  list.forEach((draft, i) => {
    const q = { ...draft };
    if (q && typeof q === "object" && !q.id && ID_PREFIXES[q.category]) q.id = nextId(working, q.category);
    if (q && typeof q === "object") {
      if (q.verified !== false) q.verified = false; // new questions are never pre-verified
      q.sourceHint ??= "";
    }
    const errors = checkQuestion(q, i).map((e) => e.replace(/^[^:]+: /, ""));
    if (typeof q.sourceHint !== "string" || q.sourceHint.trim() === "") errors.push("missing sourceHint (where to verify it)");
    if (draft?.verified === true) errors.push('"verified" must be false: only the user marks questions verified');

    const dups = findDuplicates([...working, q], { onlyIds: new Set([q.id]) });
    for (const d of dups) {
      const other = d.ids.find((x) => x !== q.id) ?? q.id;
      if (d.kind === "id" || d.kind === "question") errors.push(`duplicate of ${other}: ${d.detail}`);
    }
    const cautions = dups
      .filter((d) => d.kind === "similar" || d.kind === "answer")
      .map((d) => `${d.kind === "similar" ? "similar to" : "same answer as"} ${d.ids.find((x) => x !== q.id)} (${d.detail})`);

    results.push({ id: q.id ?? `#${i + 1}`, question: q.question, errors, cautions });
    if (errors.length === 0) {
      const ordered = inFieldOrder(q);
      working.push(ordered);
      questions.push(ordered);
    }
  });

  const bankErrors = validateQuestions(working).errors;
  const ok = list.length > 0 && results.every((r) => r.errors.length === 0) && bankErrors.length === 0;
  return { ok, questions, results, bankErrors };
}
