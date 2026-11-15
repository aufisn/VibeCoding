// Finished-run history in localStorage. Every read and write is guarded:
// a missing, corrupt or blocked store gives an empty history and never
// throws, so play always continues.

export const RUNS_KEY = "quiz.runs";
export const MAX_RUNS = 100;

/** The store to use: the injected one, else window.localStorage, else null. */
function resolveStore(store) {
  if (store !== undefined) return store;
  try {
    // Merely reading `localStorage` throws in some blocked-storage modes.
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRunRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.total === "number" &&
    typeof value.finishedAt === "string"
  );
}

/**
 * Saved runs, newest first. Never throws.
 * @param {Storage} [store] defaults to localStorage (inject a fake in tests)
 * @returns {object[]}
 */
export function loadRuns(store) {
  try {
    const s = resolveStore(store);
    if (!s) return [];
    const raw = s.getItem(RUNS_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRunRecord) : [];
  } catch {
    return [];
  }
}

/**
 * Add `run` to the front of the history, keeping at most MAX_RUNS. Never throws.
 * @param {object} run { nickname, finishedAt, total, byCategory, tier }
 * @param {Storage} [store]
 * @returns {boolean} true if it was written
 */
export function saveRun(run, store) {
  try {
    const s = resolveStore(store);
    if (!s) return false;
    const runs = [run, ...loadRuns(s)].slice(0, MAX_RUNS);
    s.setItem(RUNS_KEY, JSON.stringify(runs));
    return true;
  } catch {
    return false;
  }
}
