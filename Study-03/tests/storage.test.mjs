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
