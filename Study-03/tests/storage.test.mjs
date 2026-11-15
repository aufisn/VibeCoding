import { test } from "node:test";
import assert from "node:assert/strict";

import { saveRun, loadRuns, RUNS_KEY, MAX_RUNS } from "../js/storage.js";
import { fakeStorage, throwingStorage } from "./helpers.mjs";

function sampleRun(n) {
  return {
    nickname: `Player ${n}`,
    finishedAt: new Date(Date.UTC(2026, 10, 15, 0, n)).toISOString(),
    total: n % 41,
    byCategory: { History: 1, Science: 2, Geography: 3, "Arts & Culture": 4 },
    tier: "Novice",
  };
}

test("saveRun and loadRuns round-trip, newest first", () => {
  const store = fakeStorage();
  assert.deepEqual(loadRuns(store), []);
  assert.equal(saveRun(sampleRun(1), store), true);
  assert.equal(saveRun(sampleRun(2), store), true);
  assert.deepEqual(loadRuns(store), [sampleRun(2), sampleRun(1)]);
  assert.ok(store.getItem(RUNS_KEY).startsWith("["), "stored under quiz.runs as JSON");
});

test("history is capped at 100 entries, dropping the oldest", () => {
  const store = fakeStorage();
  for (let n = 1; n <= MAX_RUNS + 5; n++) saveRun(sampleRun(n), store);
  const runs = loadRuns(store);
  assert.equal(runs.length, MAX_RUNS);
  assert.deepEqual(runs[0], sampleRun(MAX_RUNS + 5));
  assert.deepEqual(runs.at(-1), sampleRun(6));
});

test("corrupt JSON returns an empty list, and saving recovers", () => {
  const store = fakeStorage({ [RUNS_KEY]: "{not json" });
  assert.deepEqual(loadRuns(store), []);
  assert.equal(saveRun(sampleRun(1), store), true);
  assert.deepEqual(loadRuns(store), [sampleRun(1)]);
});

test("non-array or malformed entries are ignored", () => {
  assert.deepEqual(loadRuns(fakeStorage({ [RUNS_KEY]: '{"total": 3}' })), []);
  const mixed = JSON.stringify([sampleRun(1), null, "x", { total: "5" }]);
  assert.deepEqual(loadRuns(fakeStorage({ [RUNS_KEY]: mixed })), [sampleRun(1)]);
});

test("a throwing localStorage never throws out of saveRun or loadRuns", () => {
  const store = throwingStorage();
  assert.doesNotThrow(() => loadRuns(store));
  assert.deepEqual(loadRuns(store), []);
  assert.doesNotThrow(() => saveRun(sampleRun(1), store));
  assert.equal(saveRun(sampleRun(1), store), false);
});

test("a full store (setItem throws QuotaExceededError) does not throw", () => {
  const store = fakeStorage();
  store.setItem = () => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  };
  assert.equal(saveRun(sampleRun(1), store), false);
});

test("no store at all gives an empty history", () => {
  assert.deepEqual(loadRuns(null), []);
  assert.equal(saveRun(sampleRun(1), null), false);
});

/* ---------- topRuns and clearRuns ---------- */

import { topRuns, clearRuns } from "../js/storage.js";

const at = (minute) => new Date(Date.UTC(2026, 10, 15, 10, minute)).toISOString();
const run = (total, minute, nickname = `p${minute}`) => ({ nickname, total, finishedAt: at(minute), tier: "Novice" });

test("topRuns sorts by total, highest first", () => {
  const runs = [run(10, 1), run(30, 2), run(20, 3)];
  assert.deepEqual(topRuns(runs).map((r) => r.total), [30, 20, 10]);
});

test("topRuns breaks ties by newest first", () => {
  const runs = [run(25, 1, "old"), run(25, 9, "newest"), run(25, 5, "middle"), run(40, 0, "best")];
  assert.deepEqual(topRuns(runs).map((r) => r.nickname), ["best", "newest", "middle", "old"]);
});

test("topRuns returns at most 10 by default, or n", () => {
  const runs = Array.from({ length: 25 }, (_, i) => run(i, i));
  const top = topRuns(runs);
  assert.equal(top.length, 10);
  assert.deepEqual(top.map((r) => r.total), [24, 23, 22, 21, 20, 19, 18, 17, 16, 15]);
  assert.equal(topRuns(runs, 3).length, 3);
});

test("topRuns with fewer than 10 runs returns them all", () => {
  assert.equal(topRuns([run(5, 1), run(7, 2)]).length, 2);
});

test("topRuns of an empty list or non-list is empty", () => {
  assert.deepEqual(topRuns([]), []);
  assert.deepEqual(topRuns(null), []);
});

test("topRuns does not modify its input and skips malformed entries", () => {
  const runs = [run(1, 1), null, { total: "9" }, run(2, 2)];
  const copy = JSON.stringify(runs);
  assert.deepEqual(topRuns(runs).map((r) => r.total), [2, 1]);
  assert.equal(JSON.stringify(runs), copy);
});

test("clearRuns removes only quiz.runs", () => {
  const store = fakeStorage({ [RUNS_KEY]: "[]", "quiz.theme": "dark" });
  assert.equal(clearRuns(store), true);
  assert.equal(store.getItem(RUNS_KEY), null);
  assert.equal(store.getItem("quiz.theme"), "dark");
});

test("clearRuns never throws on blocked storage", () => {
  assert.equal(clearRuns(throwingStorage()), false);
  assert.equal(clearRuns(null), false);
});
