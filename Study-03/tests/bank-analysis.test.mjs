import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  analyzeBank,
  checkNewQuestions,
  findDuplicates,
  nextId,
  normalizeText,
  similarity,
  summarizeAnalysis,
} from "../js/bank-analysis.js";
import { buildRun, buildSpeedRun, pickQuestions, seededRng } from "../js/quiz.js";
import { createGame } from "../js/state.js";
import { CATEGORIES, SPEED_SUBJECT } from "../js/config.js";
import { formatQuestions } from "../scripts/bank-tools.mjs";
import { loadBank, loadFixedBank } from "./helpers.mjs";

// Fixed 40-question copy: these tests expect its exact counts and ids.
const bank = await loadFixedBank();

/** A new, valid draft question (no id). */
const draft = (over = {}) => ({
  category: "Geography",
  difficulty: "medium",
  question: "Which river flows through Budapest, the capital of Hungary?",
  options: ["Vistula", "Danube", "Elbe", "Rhine"],
  correctIndex: 1,
  explanation: "Budapest straddles the Danube.",
  sourceHint: "Encyclopaedia Britannica: Budapest",
  verified: false,
  ...over,
});

/** The bank plus `n` extra questions per category and difficulty (synthetic). */
function biggerBank(n = 2) {
  const extra = [];
  for (const category of CATEGORIES) {
    for (const difficulty of ["easy", "medium", "hard"]) {
      for (let i = 0; i < n; i++) {
        extra.push({ ...draft({ category, difficulty }), id: `x-${category}-${difficulty}-${i}`, question: `Extra ${category} ${difficulty} question ${i} about topic ${i * 7 + difficulty.length}?` });
      }
    }
  }
  return [...bank, ...extra];
}

/* ---------- Analysis ---------- */

test("the real bank, whatever its size, passes every check with no duplicates", async () => {
  const real = await loadBank();
  const a = analyzeBank(real);
  assert.equal(a.status, "ok", [...a.errors, ...a.cautions].join("\n"));
  assert.ok(a.total >= 40);
  assert.deepEqual(a.missingCategories, []);
  assert.deepEqual(a.shortCategories, []);
  assert.ok(real.every((q) => q.verified === false || q.verified === true));
});

test("the real bank: 40 questions, 4 categories, 3/4/3 each, no problems", () => {
  const a = analyzeBank(bank);
  assert.equal(a.status, "ok");
  assert.equal(a.total, 40);
  assert.equal(a.categoryCount, 4);
  for (const c of a.perCategory) {
    assert.deepEqual([c.total, c.easy, c.medium, c.hard, c.fullRounds], [10, 3, 4, 3, 1], c.category);
  }
  assert.deepEqual(a.missingCategories, []);
  assert.deepEqual(a.duplicates.filter((d) => d.kind !== "answer"), []);
  assert.equal(summarizeAnalysis(a), "40 questions in 4 categories: all checks passed");
});

test("missing and short categories are found", () => {
  const noArts = bank.filter((q) => q.category !== "Arts & Culture");
  const a = analyzeBank(noArts);
  assert.equal(a.status, "error");
  assert.deepEqual(a.missingCategories, ["Arts & Culture"]);

  const shortHistory = bank.filter((q) => q.id !== "hist-01"); // hist-01 is easy
  const b = analyzeBank(shortHistory);
  assert.deepEqual(b.shortCategories, [{ category: "History", missing: { easy: 1 } }]);
});

test("unknown categories and odd ids are reported", () => {
  const list = structuredClone(bank);
  list.push({ ...draft({ category: "Sport" }), id: "spo-01" });
  list[0].id = "history-1";
  const a = analyzeBank(list);
  assert.deepEqual(a.unknownCategories, [{ category: "Sport", ids: ["spo-01"] }]);
  assert.ok(a.cautions.some((c) => c.includes("history-1")));
});

test("gaps show what's needed for full single-difficulty rounds", () => {
  const a = analyzeBank(bank, { growthTarget: 5 });
  assert.deepEqual(
    a.gaps.filter((g) => g.category === "Science").map((g) => [g.difficulty, g.want - g.have]),
    [["easy", 2], ["medium", 1], ["hard", 2]]
  );
});

/* ---------- Duplicates ---------- */

test("normalizeText and similarity", () => {
  assert.equal(normalizeText("  Who painted the Mona Lisa? "), "who painted the mona lisa");
  assert.equal(normalizeText("Café, Pelé!"), "cafe pele");
  assert.equal(normalizeText("World War II"), normalizeText("world war two"));
  assert.equal(normalizeText("Who was the first person?"), "who was the 1st person");
  assert.equal(similarity("Who painted the Mona Lisa?", "Who painted the Mona Lisa?"), 1);
  assert.ok(similarity("Which artist painted the Mona Lisa?", "Who painted the famous Mona Lisa?") >= 0.6);
  assert.ok(similarity("Which planet is largest?", "Who wrote Hamlet?") < 0.2);
});

test("findDuplicates: same id, same wording, similar wording, same answer", () => {
  const a = draft({ id: "geo-90" });
  const kinds = (list) => findDuplicates(list).map((d) => d.kind);
  assert.deepEqual(kinds([a, { ...a }]), ["id"]);
  assert.deepEqual(kinds([a, { ...a, id: "geo-91", question: "which river flows through BUDAPEST, the capital of Hungary" }]), ["question"]);
  assert.deepEqual(kinds([a, { ...a, id: "geo-91", question: "Which river flows through Budapest, Hungary's capital city?" }]), ["similar"]);
  assert.deepEqual(kinds([a, { ...a, id: "geo-91", question: "Which European river ends at the Black Sea?" }]), ["answer"]);
});

/* ---------- Adding questions ---------- */

test("checkNewQuestions accepts good drafts and assigns ids", () => {
  const r = checkNewQuestions(bank, [draft(), draft({ category: "History", difficulty: "hard", question: "Which empire built Machu Picchu in the 15th century?", options: ["Inca", "Aztec", "Maya", "Olmec"], correctIndex: 0, explanation: "The Inca built it.", sourceHint: "UNESCO: Machu Picchu" })]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.questions.map((q) => q.id), ["geo-11", "hist-11"]);
  assert.ok(r.questions.every((q) => q.verified === false));
  assert.deepEqual(Object.keys(r.questions[0]), Object.keys(bank[0]), "same field order as the bank");
});

test("checkNewQuestions rejects duplicates of the bank and of each other", () => {
  const existing = bank.find((q) => q.id === "geo-01");
  const copy = draft({ question: existing.question.toUpperCase() });
  const r = checkNewQuestions(bank, [copy, draft(), draft()]);
  assert.equal(r.ok, false);
  assert.match(r.results[0].errors.join(), /duplicate of geo-01/);
  assert.deepEqual(r.results[1].errors, [], "the first copy of a new question is fine");
  assert.match(r.results[2].errors.join(), /duplicate of geo-11/, "the second copy is a duplicate");
});

test("checkNewQuestions enforces the format and the rules", () => {
  const r = checkNewQuestions(bank, [
    draft({ options: ["A", "B", "C"] }),
    draft({ question: "Word ".repeat(30) + "?" }),
    draft({ options: ["Vistula", "Danube", "Elbe", "None of the above"] }),
    draft({ sourceHint: "" }),
    draft({ verified: true, question: "Which sea lies between Italy and the Balkans?", options: ["Adriatic", "Baltic", "Caspian", "Aral"], correctIndex: 0 }),
    draft({ category: "Sport" }),
  ]);
  assert.equal(r.ok, false);
  const errs = r.results.map((x) => x.errors.join(" | "));
  assert.match(errs[0], /exactly 4/);
  assert.match(errs[1], /words/);
  assert.match(errs[2], /not allowed/);
  assert.match(errs[3], /sourceHint/);
  assert.match(errs[4], /verified/);
  assert.match(errs[5], /category/);
});

test("nextId continues each category's numbering", () => {
  assert.equal(nextId(bank, "History"), "hist-11");
  assert.equal(nextId(bank, "Arts & Culture"), "art-11");
  assert.equal(nextId([], "Science"), "sci-01");
  assert.equal(nextId(bank, "Sport"), null);
});

/* ---------- A larger bank in play ---------- */

test("with a larger bank, a Full Challenge still has 40 questions in a 3/4/3 mix", () => {
  const big = biggerBank(3);
  for (let seed = 1; seed <= 10; seed++) {
    const run = buildRun(big, seededRng(seed));
    assert.equal(run.length, 40);
    for (const category of CATEGORIES) {
      const qs = run.filter((q) => q.category === category);
      assert.deepEqual(["easy", "medium", "hard"].map((d) => qs.filter((q) => q.difficulty === d).length), [3, 4, 3]);
    }
    assert.equal(new Set(run.map((q) => q.id)).size, 40, "no repeats");
  }
});

test("different games draw different questions from a larger bank", () => {
  const big = biggerBank(3);
  const ids = (seed) => new Set(buildRun(big, seededRng(seed)).map((q) => q.id));
  const a = ids(1);
  const b = ids(2);
  assert.ok([...a].some((id) => !b.has(id)));
});

test("single-difficulty rounds grow with the bank, up to 10 per category", () => {
  const game = createGame(biggerBank(3), { rng: seededRng(1) });
  assert.equal(game.questionCount("History", "easy"), 6);
  assert.equal(game.questionCount("All", "medium"), 28);
  assert.equal(game.questionCount(SPEED_SUBJECT, "easy"), 20);
  const huge = createGame(biggerBank(12), { rng: seededRng(1) });
  assert.equal(huge.questionCount("History", "hard"), 10, "capped at a round");
  assert.equal(huge.questionCount("All", "mixed"), 40);
  huge.start("", "All", "hard");
  assert.equal(huge.getState().totalQuestions, 40);
});

test("pickQuestions tops up if a difficulty runs short", () => {
  const pool = [...Array(8)].map((_, i) => ({ id: `e${i}`, difficulty: "easy" })).concat([{ id: "h", difficulty: "hard" }]);
  assert.equal(pickQuestions(pool, seededRng(1), { mix: { easy: 3, medium: 4, hard: 3 } }).length, 9);
});

test("buildSpeedRun still takes 5 per category from a larger bank", () => {
  const run = buildSpeedRun(biggerBank(3), seededRng(1));
  assert.equal(run.length, 20);
});

/* ---------- File layout ---------- */

test("formatQuestions reproduces data/questions.json exactly", async () => {
  const text = await readFile(new URL("../data/questions.json", import.meta.url), "utf8");
  assert.equal(formatQuestions(JSON.parse(text)), text);
});
