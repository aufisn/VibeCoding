import { test } from "node:test";
import assert from "node:assert/strict";

import { tierFor, summarize } from "../js/scoring.js";
import { RANK_TIERS } from "../js/config.js";

test("tierFor at every boundary", () => {
  const expected = {
    0: "Novice",
    11: "Novice",
    12: "Apprentice",
    19: "Apprentice",
    20: "Scholar",
    27: "Scholar",
    28: "Expert",
    35: "Expert",
    36: "Grandmaster",
    40: "Grandmaster",
  };
  for (const [score, name] of Object.entries(expected)) {
    assert.equal(tierFor(Number(score), RANK_TIERS).name, name, `score ${score}`);
  }
});

test("tierFor does not depend on tier order", () => {
  const shuffled = [RANK_TIERS[3], RANK_TIERS[0], RANK_TIERS[4], RANK_TIERS[1], RANK_TIERS[2]];
  assert.equal(tierFor(29, shuffled).name, "Expert");
  assert.equal(tierFor(5, shuffled).name, "Novice");
});

test("summarize counts totals and per-category scores", () => {
  const answers = [
    { category: "History", correct: true },
    { category: "History", correct: true },
    { category: "History", correct: false },
    { category: "Science", correct: true },
    { category: "Science", correct: false },
    { category: "Arts & Culture", correct: true },
    undefined, // unanswered slot
  ];
  assert.deepEqual(summarize(answers), {
    total: 4,
    byCategory: { History: 2, Science: 1, Geography: 0, "Arts & Culture": 1 },
  });
});

test("summarize of no answers is all zeros", () => {
  assert.deepEqual(summarize([]), {
    total: 0,
    byCategory: { History: 0, Science: 0, Geography: 0, "Arts & Culture": 0 },
  });
});
