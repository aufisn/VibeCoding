import { test } from "node:test";
import assert from "node:assert/strict";

import { findSuperlatives, highlight } from "../scripts/find-superlatives.mjs";
import { loadBank } from "./helpers.mjs";

const q = (id, question, options = ["a", "b", "c", "d"], explanation = "") => ({
  id,
  category: "Geography",
  question,
  options,
  explanation,
});

test("finds superlatives in questions, case-insensitively", () => {
  const found = findSuperlatives([q("geo-01", "Which is the Largest ocean, and the first to be crossed?")]);
  assert.deepEqual(found.map((m) => [m.id, m.field, m.word]), [
    ["geo-01", "question", "largest"],
    ["geo-01", "question", "first"],
  ]);
});

test("matches whole words only", () => {
  const found = findSuperlatives([q("x", "Almost firsthand: the forest's mostly lastingly topical test")]);
  assert.deepEqual(found, []);
});

test("searches options, and explanations only when asked", () => {
  const bank = [q("x", "Which ocean?", ["Pacific, the largest", "b", "c", "d"], "It is the deepest.")];
  assert.deepEqual(findSuperlatives(bank).map((m) => m.field), ["option A"]);
  assert.deepEqual(findSuperlatives(bank, { explanations: true }).map((m) => m.field), ["option A", "explanation"]);
});

test("extra words can be added", () => {
  const found = findSuperlatives([q("x", "Which is the primary colour?")], { extraWords: ["Primary"] });
  assert.deepEqual(found.map((m) => m.word), ["primary"]);
});

test("each word is reported once per field", () => {
  assert.equal(findSuperlatives([q("x", "The most visited and most famous?")]).length, 1);
});

test("highlight wraps matched words in brackets", () => {
  assert.equal(highlight("The Largest and the first", ["largest", "first"]), "The [Largest] and the [first]");
});

test("runs on the real question bank without throwing", async () => {
  const found = findSuperlatives(await loadBank(), { explanations: true });
  for (const m of found) assert.ok(m.id && m.field && m.word && m.text.toLowerCase().includes(m.word));
});
