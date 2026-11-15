import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRun, shuffle, shuffleOptions, seededRng } from "../js/quiz.js";
import { CATEGORIES } from "../js/config.js";
import { loadBank } from "./helpers.mjs";

const bank = await loadBank();
const byId = new Map(bank.map((q) => [q.id, q]));
const correctText = (q) => q.options[q.correctIndex];

test("buildRun always returns 40 questions", () => {
  for (let seed = 1; seed <= 20; seed++) {
    assert.equal(buildRun(bank, seededRng(seed)).length, 40);
  }
  assert.equal(buildRun(bank).length, 40); // default Math.random
});

test("buildRun gives 10 per category, in play order", () => {
  const run = buildRun(bank, seededRng(7));
  CATEGORIES.forEach((category, c) => {
    const block = run.slice(c * 10, c * 10 + 10);
    assert.ok(block.every((q) => q.category === category), `block ${c} should all be ${category}`);
  });
  assert.equal(new Set(run.map((q) => q.id)).size, 40, "no question repeated or dropped");
});

test("every question in a run has 4 options", () => {
  for (const q of buildRun(bank, seededRng(3))) {
    assert.equal(q.options.length, 4, q.id);
    assert.deepEqual([...q.options].sort(), [...byId.get(q.id).options].sort(), `${q.id} keeps the same option texts`);
  }
});

test("the correct option text is unchanged after shuffling", () => {
  for (let seed = 1; seed <= 50; seed++) {
    for (const q of buildRun(bank, seededRng(seed))) {
      assert.equal(correctText(q), correctText(byId.get(q.id)), `${q.id} with seed ${seed}`);
    }
  }
});

test("correctIndex follows the correct option, not the original position", () => {
  // Original correctIndex is 0; across seeds the correct option must move
  // away from position 0 and correctIndex must follow it there.
  const q = { id: "t", category: "History", options: ["W", "X", "Y", "Z"], correctIndex: 0 };
  let moved = false;
  for (let seed = 1; seed <= 20; seed++) {
    const s = shuffleOptions(q, seededRng(seed));
    assert.equal(s.options[s.correctIndex], "W");
    if (s.correctIndex !== 0) moved = true;
  }
  assert.ok(moved, "the correct option should move to other positions for some seeds");
});

test("buildRun does not modify the question bank", () => {
  const before = JSON.stringify(bank);
  buildRun(bank, seededRng(11));
  assert.equal(JSON.stringify(bank), before);
});

test("buildRun is deterministic with a seeded rng", () => {
  const a = buildRun(bank, seededRng(42));
  const b = buildRun(bank, seededRng(42));
  assert.deepEqual(a, b);
});

test("two different seeds give different question and option orders", () => {
  const a = buildRun(bank, seededRng(1));
  const b = buildRun(bank, seededRng(2));
  assert.notDeepEqual(a.map((q) => q.id), b.map((q) => q.id), "question order differs");
  assert.notDeepEqual(a.map((q) => q.options), b.map((q) => q.options), "option order differs");
});

test("shuffle keeps every item and does not modify its input", () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffle(input, seededRng(5));
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...out].sort((x, y) => x - y), input);
});

test("seededRng returns floats in [0, 1)", () => {
  const rng = seededRng(99);
  for (let i = 0; i < 1000; i++) {
    const x = rng();
    assert.ok(x >= 0 && x < 1);
  }
});
