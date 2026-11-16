// Shared test helpers (not a test file: node --test only runs *.test.mjs).

import { readFile } from "node:fs/promises";

/** The real question bank, data/questions.json. Its size changes as questions are added. */
export async function loadBank() {
  const url = new URL("../data/questions.json", import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

/**
 * A fixed copy of the original 40-question bank (10 per category, 3/4/3).
 * Use it in tests whose expectations depend on exact counts or ids, so they
 * don't break when /quiz-expand adds questions to the real bank.
 */
export async function loadFixedBank() {
  const url = new URL("./fixtures/questions-40.json", import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

/** Minimal in-memory Storage (getItem/setItem/removeItem/clear). */
export function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
    get length() {
      return data.size;
    },
  };
}

/** A Storage whose every method throws, like a blocked localStorage. */
export function throwingStorage() {
  const boom = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom };
}
