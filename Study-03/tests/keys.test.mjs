import { test } from "node:test";
import assert from "node:assert/strict";

import { mapKey } from "../js/keys.js";

const open = { screen: "question", answered: false };
const locked = { screen: "question", answered: true };

test("A to D and 1 to 4 select options before the answer is locked", () => {
  ["a", "b", "c", "d"].forEach((key, index) => {
    assert.deepEqual(mapKey(key, open), { type: "select", index });
    assert.deepEqual(mapKey(key.toUpperCase(), open), { type: "select", index });
  });
  ["1", "2", "3", "4"].forEach((key, index) => assert.deepEqual(mapKey(key, open), { type: "select", index }));
});

test("Enter and Space go to the next question once the answer is locked", () => {
  assert.deepEqual(mapKey("Enter", locked), { type: "next" });
  assert.deepEqual(mapKey(" ", locked), { type: "next" });
});

test("Enter and Space do nothing before the answer is locked", () => {
  // A focused option button handles them itself (one click, no double handling).
  assert.equal(mapKey("Enter", open), null);
  assert.equal(mapKey(" ", open), null);
});

test("option keys are ignored once the answer is locked", () => {
  for (const key of ["a", "D", "1", "4"]) assert.equal(mapKey(key, locked), null);
});

test("everything is ignored while a dialog is open", () => {
  assert.equal(mapKey("a", { ...open, dialogOpen: true }), null);
  assert.equal(mapKey("Enter", { ...locked, dialogOpen: true }), null);
});

test("ignored in a text field, with modifier keys, or off the question screen", () => {
  assert.equal(mapKey("a", { ...open, inTextField: true }), null);
  assert.equal(mapKey("a", { ...open, modifier: true }), null);
  assert.equal(mapKey("a", { screen: "start", answered: false }), null);
  assert.equal(mapKey("Enter", { screen: "summary", answered: true }), null);
});

test("Enter on another control (Exit, Skip, theme switch) is left to that control", () => {
  assert.equal(mapKey("Enter", { ...locked, onOtherControl: true }), null);
});

test("other keys, out-of-range options and eliminated options are ignored", () => {
  for (const key of ["e", "5", "0", "Escape", "Tab", "ArrowDown"]) assert.equal(mapKey(key, open), null);
  assert.equal(mapKey("d", { ...open, optionCount: 3 }), null);
  assert.equal(mapKey("b", { ...open, eliminated: [1] }), null);
  assert.deepEqual(mapKey("c", { ...open, eliminated: [1] }), { type: "select", index: 2 });
  assert.equal(mapKey(undefined, open), null);
  assert.equal(mapKey("a", undefined), null);
});
