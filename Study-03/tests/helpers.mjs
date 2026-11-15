// Shared test helpers (not a test file: node --test only runs *.test.mjs).

import { readFile } from "node:fs/promises";

export async function loadBank() {
  const url = new URL("../data/questions.json", import.meta.url);
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
