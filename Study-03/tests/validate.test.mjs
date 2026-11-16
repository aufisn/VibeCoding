import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { validateQuestions, wordCount } from "../js/validate.js";
import { CATEGORIES, RANK_TIERS } from "../js/config.js";

const PREFIX = {
  History: "hist",
  Science: "sci",
  Geography: "geo",
  "Arts & Culture": "art",
};
const DIFFICULTIES = ["easy", "easy", "easy", "medium", "medium", "medium", "medium", "hard", "hard", "hard"];

/** A synthetic, fully valid bank of 40 questions (independent of the real data). */
function makeValidSet({ verified = true } = {}) {
  return CATEGORIES.flatMap((category) =>
    DIFFICULTIES.map((difficulty, i) => ({
      id: `${PREFIX[category]}-${String(i + 1).padStart(2, "0")}`,
      category,
      difficulty,
      question: `Sample ${category} question number ${i + 1}?`,
      options: ["Alpha", "Bravo", "Charlie", "Delta"],
      correctIndex: i % 4,
      explanation: "Because it is a sample.",
      sourceHint: "Test fixture",
      verified,
    }))
  );
}

/** Assert that some error message contains `fragment`. */
function assertHasError(result, fragment) {
  assert.ok(
    result.errors.some((e) => e.includes(fragment)),
    `expected an error containing "${fragment}", got:\n${result.errors.join("\n")}`
  );
}

test("a valid set passes with no errors or warnings", () => {
  const result = validateQuestions(makeValidSet());
  assert.deepEqual(result, { errors: [], warnings: [] });
});

test("unverified questions produce one warning each, not errors", () => {
  const result = validateQuestions(makeValidSet({ verified: false }));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 40);
  assert.ok(result.warnings[0].includes("hist-01"));
});

test("non-array input is an error", () => {
  assertHasError(validateQuestions({ questions: [] }), "not an array");
});

test("wrong total count is an error", () => {
  const list = makeValidSet().slice(0, 39);
  const result = validateQuestions(list);
  assertHasError(result, "Expected at least 40 questions");
  assertHasError(result, "Arts & Culture: has 9 questions");
});

test("duplicate id is an error", () => {
  const list = makeValidSet();
  list[5].id = list[4].id;
  assertHasError(validateQuestions(list), `${list[4].id}: duplicate id`);
});

test("wrong option count is an error", () => {
  const list = makeValidSet();
  list[0].options = ["One", "Two", "Three"];
  assertHasError(validateQuestions(list), "hist-01: options must be exactly 4");
});

test("empty and duplicate options are errors", () => {
  const list = makeValidSet();
  list[0].options = ["One", "", "Three", "Four"];
  list[1].options = ["One", "one", "Three", "Four"];
  const result = validateQuestions(list);
  assertHasError(result, "hist-01: option 2 is empty");
  assertHasError(result, "hist-02: option \"one\" is duplicated");
});

test("bad correctIndex is an error", () => {
  for (const bad of [4, -1, 1.5, "2", null, undefined]) {
    const list = makeValidSet();
    list[0].correctIndex = bad;
    assertHasError(validateQuestions(list), "hist-01: correctIndex must be an integer 0-3");
  }
});

test("too few of a difficulty is an error; extra is fine", () => {
  const list = makeValidSet();
  list[0].difficulty = "medium"; // History now has 2 easy, 5 medium
  const result = validateQuestions(list);
  assertHasError(result, "History: has 2 easy questions (need at least 3)");
  assert.ok(!result.errors.some((e) => e.includes("medium")), "5 medium is more than enough");
});

test("a larger bank is valid (games pick from it)", () => {
  const list = makeValidSet();
  list.push({ ...list[0], id: "hist-11", question: "An extra history question?" });
  assert.deepEqual(validateQuestions(list), { errors: [], warnings: [] });
});

test("invalid difficulty value is an error", () => {
  const list = makeValidSet();
  list[0].difficulty = "expert";
  assertHasError(validateQuestions(list), "hist-01: difficulty \"expert\"");
});

test("unknown category is an error", () => {
  const list = makeValidSet();
  list[0].category = "Sport";
  assertHasError(validateQuestions(list), "hist-01: category \"Sport\"");
});

test("missing question or explanation is an error", () => {
  const list = makeValidSet();
  delete list[0].question;
  list[1].explanation = "   ";
  const result = validateQuestions(list);
  assertHasError(result, "hist-01: missing question");
  assertHasError(result, "hist-02: missing explanation");
});

test("question over 25 words and option over 8 words are errors", () => {
  const list = makeValidSet();
  list[0].question = Array(26).fill("word").join(" ") + "?";
  list[1].options = ["one two three four five six seven eight nine", "B", "C", "D"];
  const result = validateQuestions(list);
  assertHasError(result, "hist-01: question has 26 words");
  assertHasError(result, "hist-02: option \"one two");
});

test("'all/none of the above' options are errors (case-insensitive)", () => {
  const list = makeValidSet();
  list[0].options = ["A", "B", "C", "All Of The Above"];
  list[1].options = ["A", "B", "C", "NONE of the above"];
  const result = validateQuestions(list);
  assertHasError(result, "hist-01: option \"All Of The Above\" is not allowed");
  assertHasError(result, "hist-02: option \"NONE of the above\" is not allowed");
});

test("wordCount handles extra whitespace", () => {
  assert.equal(wordCount("  two   words "), 2);
  assert.equal(wordCount(""), 0);
});

test("RANK_TIERS match the spec", () => {
  assert.deepEqual(
    RANK_TIERS.map((t) => [t.name, t.min]),
    [["Novice", 0], ["Apprentice", 12], ["Scholar", 20], ["Expert", 28], ["Grandmaster", 36]]
  );
});

test("the real data/questions.json has no errors", async () => {
  const url = new URL("../data/questions.json", import.meta.url);
  const list = JSON.parse(await readFile(url, "utf8"));
  const result = validateQuestions(list);
  assert.deepEqual(result.errors, []);
});
