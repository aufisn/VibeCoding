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

/**
 * Remove the saved history (only the quiz.runs key). Never throws.
 * @param {Storage} [store]
 * @returns {boolean} true if it was removed
 */
export function clearRuns(store) {
  try {
    const s = resolveStore(store);
    if (!s) return false;
    s.removeItem(RUNS_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * The game mode of a saved run. Runs saved before modes existed have no
 * `mode`: a category subject means "category", anything else "full".
 * @param {object} run
 * @returns {"full" | "category" | "speed"}
 */
export function runMode(run) {
  if (run && (run.mode === "full" || run.mode === "category" || run.mode === "speed")) return run.mode;
  return run && typeof run.subject === "string" && run.subject !== "All" ? "category" : "full";
}

/**
 * The best `n` runs: most points first, then most correct answers, then
 * newest. Runs saved before points existed rank below runs with points.
 * Pure: does not modify `runs`. Unparseable dates sort as oldest.
 * @param {object[]} runs
 * @param {number} [n]
 * @param {string} [mode] only runs of this mode (see runMode); all if omitted
 * @returns {object[]}
 */
export function topRuns(runs, n = 10, mode) {
  if (!Array.isArray(runs)) return [];
  const time = (run) => {
    const t = Date.parse(run.finishedAt);
    return Number.isNaN(t) ? -Infinity : t;
  };
  const points = (run) => (typeof run.points === "number" ? run.points : -Infinity);
  return runs
    .filter(isRunRecord)
    .filter((run) => mode === undefined || runMode(run) === mode)
    .slice()
    .sort((a, b) => points(b) - points(a) || b.total - a.total || time(b) - time(a))
    .slice(0, Math.max(0, n));
}
