// GitHub mode for the empathy diary: how the page gets a reflection when it is
// opened from GitHub Pages (no laptop needed). The page never sees the
// Anthropic key:
//
//   1. your entry is encrypted here and put in the secret Gist (gist token)
//   2. the page starts the empathy-diary workflow (run token, Actions: write)
//   3. a GitHub computer, which holds the key as a secret, asks Claude and
//      puts the encrypted answer in the Gist
//   4. the page picks it up, decrypts it and deletes it from the Gist
//
// The journal (journal-YYYY-MM.enc files in the same Gist, see journal.mjs) is saved by the job
// after Claude answers; the page reads and changes it itself with the functions at the bottom
// (loadJournal, hideEntry, ...). The decrypted journal lives in memory only, never in storage.
//
// The two tokens, the Gist ID and the passphrase are the same device settings
// FridgeChef uses (same origin, same storage key), kept only in this
// browser's storage on this device. "Forget" removes them.

import { decryptJson, encryptJson } from "./fc-crypto.mjs";
import { createJournal, JournalError, renderMarkdown, renderText, validateEntry } from "./journal.mjs";
import { createGistClient, GitHubError, isRequestId, MAX_AGE_MS, newRequestId, requestFile, requestTime, resultFile } from "./mailbox.mjs";

export const REPO = "aufisn/VibeCoding";
export const WORKFLOW = "empathy-diary.yml";
export const ACTIONS_PAGE = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;
const STORE_KEY = "fridgechef.github.v1";
const PENDING_KEY = "empathyDiary.pending.v1";

export const SETTING_FIELDS = ["gistId", "gistToken", "runToken", "passphrase"];

/* ---------- Browser storage, never trusted to work ---------- */
// With storage blocked (some privacy settings), even reading
// window.localStorage throws, and setItem throws when storage is full.
// These helpers turn all of that into "nothing stored" / false.

/** This browser's localStorage, or null when it's blocked. */
export function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
function safeGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeSet(storage, key, value) {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
function safeRemove(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    /* blocked: nothing was stored anyway */
  }
}

const emptySettings = () => Object.fromEntries(SETTING_FIELDS.map((f) => [f, ""]));

export function loadSettings(storage = safeStorage()) {
  try {
    const s = JSON.parse(safeGet(storage, STORE_KEY) ?? "{}") ?? {};
    return Object.fromEntries(SETTING_FIELDS.map((f) => [f, typeof s[f] === "string" ? s[f] : ""]));
  } catch {
    return emptySettings();
  }
}

/** Problems with the settings, as plain sentences ([] when fine). Pure. */
export function settingsProblems(s) {
  const p = [];
  if (!/^[0-9a-f]{20,40}$/i.test(s.gistId)) p.push("Gist ID: the 32 letters and numbers at the end of the Gist's web address.");
  if (!/^(ghp_|github_pat_)[A-Za-z0-9_]{20,}$/.test(s.gistToken)) p.push("Gist token: a classic token with the gist scope (starts with ghp_).");
  if (!/^github_pat_[A-Za-z0-9_]{20,}$/.test(s.runToken)) p.push("Run token: a fine-grained token for aufisn/VibeCoding with Actions: Read and write (starts with github_pat_).");
  if ((s.passphrase ?? "").length < 12) p.push("Passphrase: the same one you saved as FC_PASSPHRASE, at least 12 characters.");
  return p;
}

/** Saves the settings on this device. Returns false when the browser won't store them. */
export function saveSettings(s, storage = safeStorage()) {
  return safeSet(storage, STORE_KEY, JSON.stringify(Object.fromEntries(SETTING_FIELDS.map((f) => [f, String(s[f] ?? "").trim()]))));
}

export function forgetSettings(storage = safeStorage()) {
  safeRemove(storage, STORE_KEY);
  safeRemove(storage, PENDING_KEY);
}

/** Forgets the waiting request on this device (sync; the Gist file is left to cancelPending or the job's 24 h cleanup). */
export function clearPending(storage = safeStorage()) {
  safeRemove(storage, PENDING_KEY);
}

/**
 * The page calls this when the user presses Cancel, and before Forget.
 * Removes the pending ID and, best effort, deletes req-<id>.enc from the Gist.
 * Never throws; resolves to nothing.
 */
export async function cancelPending({ deleteRequest = true, settings, fetch = globalThis.fetch?.bind(globalThis), storage = safeStorage() } = {}) {
  try {
    const id = safeGet(storage, PENDING_KEY);
    safeRemove(storage, PENDING_KEY);
    if (!deleteRequest || !isRequestId(id)) return;
    await deleteRequestFile({ settings: settings ?? loadSettings(storage), fetch, id });
  } catch {
    /* best effort: leftovers are removed by the job within a day */
  }
}

/** Best effort: removes req-<id>.enc from the Gist. Never throws. */
async function deleteRequestFile({ settings, fetch, id, gist }) {
  try {
    gist ??= createGistClient({ token: settings.gistToken, gistId: settings.gistId, fetch });
    await gist.write({ [requestFile(id)]: null });
  } catch {
    /* ignore */
  }
}

/** A fetch that never starts a request once the signal has aborted. */
function guardFetch(fetch, signal) {
  return (...args) => (signal?.aborted ? Promise.reject(abortError()) : fetch(...args));
}

/**
 * The request still waiting from an earlier visit, or null. One older than a
 * day (the job deletes its files by then) or with a nonsense time is dropped.
 */
export function pendingRequest(storage = safeStorage(), now = Date.now()) {
  const id = safeGet(storage, PENDING_KEY);
  if (id === null) return null;
  const age = isRequestId(id) ? now - requestTime(id) : NaN;
  if (age >= -10 * 60_000 && age <= MAX_AGE_MS) return id;
  safeRemove(storage, PENDING_KEY);
  return null;
}

function actionsCall(settings, fetch, path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/actions${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${settings.runToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  }).catch(() => {
    throw new GitHubError(0, "GitHub Actions");
  });
}

/**
 * The workflow run for this request, or null while GitHub hasn't listed it.
 * Only runs created around the request's time are listed (a few, not the
 * last 20 of every kind, ~8 KB each), so an older request is found too.
 */
async function findRun(settings, fetch, id) {
  const t = requestTime(id);
  const created = `${new Date(t - 5 * 60_000).toISOString()}..${new Date(t + 15 * 60_000).toISOString()}`;
  const res = await actionsCall(settings, fetch, `/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=20&created=${encodeURIComponent(created)}`);
  if (!res.ok) throw new GitHubError(res.status, "GitHub Actions");
  const { workflow_runs: runs = [] } = await res.json();
  return runs.find((r) => r.display_title === `Empathy Diary ${id}`) ?? null;
}

/** The latest state of a run we already found (one small object). */
async function getRun(settings, fetch, runId) {
  const res = await actionsCall(settings, fetch, `/runs/${encodeURIComponent(runId)}`);
  if (!res.ok) throw new GitHubError(res.status, "GitHub Actions");
  return res.json();
}

const WAITING = new Set(["queued", "waiting", "pending", "requested"]);
const abortError = () => Object.assign(new Error("Stopped waiting."), { name: "AbortError" });

/**
 * Sends a request through GitHub and waits for the answer: { type: "reflect", text }. `onStage(text)` reports progress.
 * Returns the decrypted answer. `signal` (an AbortSignal) stops the wait.
 */
export async function askGitHub({ settings, payload, fetch: rawFetch = globalThis.fetch.bind(globalThis), storage = safeStorage(), onStage = () => {}, sleep, now = () => Date.now(), signal, ...timing }) {
  const fetch = guardFetch(rawFetch, signal);
  const gist = createGistClient({ token: settings.gistToken, gistId: settings.gistId, fetch });
  const id = newRequestId(now());
  if (signal?.aborted) throw abortError();

  onStage("Sending your words securely…");
  const encrypted = await encryptJson({ ...payload, sentAt: new Date(now()).toISOString() }, settings.passphrase);
  if (signal?.aborted) throw abortError();
  await gist.write({ [requestFile(id)]: encrypted });
  if (signal?.aborted) {
    await deleteRequestFile({ settings, fetch: rawFetch, id });
    throw abortError();
  }

  // The Gist's version now, before the job can possibly have changed it.
  const before = await gist.version().catch(() => null);
  if (signal?.aborted) {
    await deleteRequestFile({ settings, fetch: rawFetch, id });
    throw abortError();
  }

  onStage("Waiting for GitHub to start…");
  let res;
  try {
    res = await actionsCall(settings, fetch, `/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs: { request_id: id } }) });
  } catch (err) {
    await deleteRequestFile({ settings, fetch: rawFetch, id, gist: createGistClient({ token: settings.gistToken, gistId: settings.gistId, fetch: rawFetch }) });
    throw err;
  }
  if (!res.ok) {
    await deleteRequestFile({ settings, fetch: rawFetch, id });
    throw new GitHubError(res.status, "GitHub Actions (run token)");
  }
  safeSet(storage, PENDING_KEY, id); // if this fails we just can't pick it up after a reload
  return waitForAnswer({ settings, id, fetch: rawFetch, storage, onStage, sleep, now, gist, signal, before, ...timing });
}

/**
 * Waits for the answer to request `id` (`resumed: true` after the page was
 * closed mid-wait). Each round asks Actions how the run is doing (one small
 * object) and checks the Gist's version (~1 KB); the Gist itself, which may hold
 * a pending request until the job answers, is read only once the
 * version has changed. Reads are conditional (ETag), so an unchanged Gist
 * costs a 304 with no body.
 */
export async function waitForAnswer({
  settings,
  id,
  fetch: rawFetch = globalThis.fetch.bind(globalThis),
  storage = safeStorage(),
  onStage = () => {},
  sleep,
  now = () => Date.now(),
  gist,
  signal,
  before, // the Gist's version just before the job was started (askGitHub knows it)
  resumed = false,
  timeoutMs = 6 * 60_000,
  everyMs = 4000, // while the job runs
  queuedEveryMs = 6000, // while it waits for a computer (it can't answer yet)
  recheckMs = 3000, // after the run ended without an answer in sight
  noRunMs = resumed ? 20_000 : 2 * 60_000, // give up when GitHub lists no run for this long
}) {
  const fetch = guardFetch(rawFetch, signal);
  gist ??= createGistClient({ token: settings.gistToken, gistId: settings.gistId, fetch });
  // Sleeps end early when the wait is stopped.
  sleep ??= (ms) =>
    new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done, { once: true });
    });
  const started = now();
  const until = started + timeoutMs;
  const stop = () => {
    if (signal?.aborted) throw abortError();
  };
  // A run that can't produce an answer: forget it and, best effort, delete the
  // encrypted request so it doesn't sit in the Gist. A timeout (forget = false)
  // keeps both so the page can resume; cancelPending cleans them up.
  const fail = async (message, link, forget = true) => {
    if (forget) {
      safeRemove(storage, PENDING_KEY);
      await deleteRequestFile({ settings, fetch: rawFetch, id });
    }
    return Object.assign(new Error(message), { link });
  };
  let run = null;
  let runMissing = false; // GitHub answered and listed no run for this request
  let checksAfterEnd = 0;
  // The Gist's version before the job can have answered: until it changes,
  // there's nothing new to read (and the full read would include the request).
  if (before === undefined) before = resumed ? null : await gist.version().catch(() => null);
  for (let round = 0; ; round++) {
    stop();
    if (run?.status !== "completed") {
      try {
        const latest = run?.id ? await getRun(settings, fetch, run.id).catch(() => findRun(settings, fetch, id)) : await findRun(settings, fetch, id);
        run = latest ?? run;
        runMissing = !run;
      } catch {
        /* Actions unreachable or refused: keep going on the Gist alone */
      }
      stop();
    }
    const noRun = !run && runMissing && now() - started >= noRunMs;
    // With a version to compare, looking costs ~1 KB, so look every round (run
    // states can lag). Without one, look only every 5th round while the job
    // is queued or not listed yet (it can't have answered).
    let readGist = noRun || (resumed && round === 0) || Boolean(before) || (run && !WAITING.has(run.status)) || round % 5 === 4;

    // Cheap check first (a full read anyway every 15th round, in case).
    if (readGist && before && run?.status !== "completed" && !noRun && round % 15 !== 14) {
      readGist = (await gist.version().catch(() => null)) !== before;
      stop();
    }
    if (readGist) {
      stop();
      const file = (await gist.files())[resultFile(id)];
      stop();
      if (file) {
        onStage("Almost there…");
        const text = await gist.text(file);
        stop();
        let answer;
        try {
          answer = await decryptJson(text, settings.passphrase);
        } catch (err) {
          // Unreadable (wrong passphrase?): waiting again won't help.
          safeRemove(storage, PENDING_KEY);
          await gist.write({ [resultFile(id)]: null, [requestFile(id)]: null }).catch(() => {});
          throw err;
        }
        await gist.write({ [resultFile(id)]: null }).catch(() => {}); // leftovers are cleaned up by the job anyway
        safeRemove(storage, PENDING_KEY);
        return answer;
      }
      if (run?.status === "completed" && ++checksAfterEnd > 2) {
        // Looked three times, a few seconds apart, in case a read was stale.
        throw await fail(`The GitHub job ${run.conclusion === "cancelled" ? "was cancelled" : "failed"} without an answer. Its log is in the Actions tab.`, run.html_url ?? ACTIONS_PAGE);
      }
      if (noRun) throw await fail("GitHub has no job for this request, and no answer came. Check the Actions tab, then try again.", ACTIONS_PAGE);
    }
    if (now() > until) throw await fail("No answer after 6 minutes. GitHub may be slow: reload the page later to pick it up, or check the Actions tab.", ACTIONS_PAGE, false);

    if (!run || WAITING.has(run.status)) onStage("Waiting for GitHub to start…");
    else if (run.status === "in_progress") onStage("Claude is reading…");
    await sleep(run?.status === "completed" ? recheckMs : run && !WAITING.has(run.status) ? everyMs : queuedEveryMs);
  }
}

/* ---------- What the page calls ---------- */

export const hasSettings = (storage = safeStorage()) => settingsProblems(loadSettings(storage)).length === 0;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The decrypted answer envelope → the same result object as /api/reflect, or an Error. */
function unwrap(answer) {
  if (isObject(answer) && answer.ok === false) throw new Error(typeof answer.error === "string" && answer.error ? answer.error : "The GitHub job could not answer. Try again.");
  const r = isObject(answer) && answer.ok === true ? answer.result : null;
  if (!isObject(r) || typeof r.primary_emotion !== "string" || !Array.isArray(r.emotions) || typeof r.empathy !== "string") throw new Error("The answer from GitHub could not be read. Try again.");
  const saveError = typeof answer.saveError === "string" ? answer.saveError.slice(0, 300) : "";
  // The full entry (with the text) comes back whether or not it was saved, so the page never has to keep the text itself.
  const entry = validateEntry(answer.entry);
  return {
    ...r,
    saved: answer.saved === true,
    entryId: typeof answer.entryId === "string" ? answer.entryId.slice(0, 64) : entry?.id ?? null,
    entry,
    ...(answer.saved === true ? {} : { saveError: saveError || "Your entry was not saved to your journal." }),
  };
}

/** Wraps `onProgress(phrase, elapsedSeconds)`; a throwing callback never breaks the wait. */
function progressReporter(onProgress, now) {
  const t0 = now();
  return (phrase) => {
    try {
      onProgress?.(phrase, Math.max(0, Math.round((now() - t0) / 1000)));
    } catch {
      /* the page's callback is its own business */
    }
  };
}

function needSettings(settings) {
  const problems = settingsProblems(settings);
  if (problems.length) throw Object.assign(new Error(`GitHub mode isn't set up on this device yet. ${problems[0]}`), { code: "settings" });
}

/**
 * Sends one diary entry through GitHub and resolves to the reflection (the same
 * object /api/reflect returns). Throws an Error with a plain `.message`
 * (`.link` may point at the Actions log). `onProgress(phrase, seconds)` gets
 * short phrases; `signal` stops the wait. Everything else is for tests.
 */
export async function reflectViaGitHub({ text, onProgress, signal, settings = loadSettings(), fetch = globalThis.fetch.bind(globalThis), storage = safeStorage(), now = () => Date.now(), ...rest }) {
  needSettings(settings);
  if (typeof text !== "string" || !text.trim()) throw new Error("Please write a line about your day.");
  const max = Number.isInteger(globalThis.DiaryCore?.MAX_CHARS) ? globalThis.DiaryCore.MAX_CHARS : 300;
  if (Array.from(text).length > max) throw new Error(`That is a bit long. Please keep it to ${max} characters or fewer.`);
  const answer = await askGitHub({ settings, payload: { type: "reflect", text }, fetch, storage, now, signal, onStage: progressReporter(onProgress, now), ...rest });
  return unwrap(answer);
}

/**
 * Picks up a request left waiting by an earlier visit (see pendingRequest).
 * Resolves to the reflection, or null when nothing is pending.
 */
export async function resumePending({ onProgress, signal, settings = loadSettings(), fetch = globalThis.fetch.bind(globalThis), storage = safeStorage(), now = () => Date.now(), ...rest } = {}) {
  const id = pendingRequest(storage, now());
  if (!id) return null;
  needSettings(settings);
  const answer = await waitForAnswer({ settings, id, fetch, storage, now, signal, resumed: true, onStage: progressReporter(onProgress, now), ...rest });
  return unwrap(answer);
}

/* ---------- The journal, read and changed by the page itself ---------- */
// Everything below uses the device settings (Gist ID, Gist token, passphrase). The decrypted
// journal is returned to the caller and kept nowhere else: nothing is written to browser storage.

/** Problems that stop journal access (the run token isn't needed: it only starts workflows). */
export function journalSettingsProblems(s) {
  const all = settingsProblems({ ...s, runToken: "github_pat_" + "x".repeat(20) });
  return all;
}

function openJournal(settings, fetch, options = {}) {
  const problems = journalSettingsProblems(settings);
  if (problems.length) throw Object.assign(new JournalError("not_configured", `Your journal isn't set up on this device yet. ${problems[0]}`), { code: "settings" });
  return createJournal({ gist: createGistClient({ token: settings.gistToken, gistId: settings.gistId, fetch }), passphrase: settings.passphrase, ...options });
}

const journalArgs = ({ settings = loadSettings(), fetch = globalThis.fetch?.bind(globalThis), ...options } = {}) => openJournal(settings, fetch, options);

/**
 * Reads and decrypts the newest months only (default 2).
 * `latest`: how many months (default 2), or "all" for every month (slow; export does this itself).
 * Resolves { entries (newest first, each with `hidden`), months (the loaded ones), allMonths: [{ month, files }], problems }.
 * Throws a plain Error (code "passphrase", "gist", "settings", "not_configured"). In memory only.
 */
export async function loadJournal({ latest = 2, ...opts } = {}) {
  const journal = journalArgs(opts);
  return latest === "all" ? journal.readAll() : journal.readLatest(latest);
}

/** One more month ("YYYY-MM"), same shape as loadJournal. */
export const loadMonth = async (month, opts) => journalArgs(opts).readMonth(month);

/** Splits the optional `month` hint (the month the entry was loaded from) off the options. */
const withHint = ({ month, ...opts } = {}) => [opts, { month }];

/** Hides an entry (it stays in the journal). Resolves { changed }. `opts.month` ("YYYY-MM") speeds it up. */
export const hideEntry = async (id, opts) => {
  const [rest, hint] = withHint(opts);
  return journalArgs(rest).hide(id, hint);
};

/** Brings a hidden entry back. Resolves { changed }. */
export const unhideEntry = async (id, opts) => {
  const [rest, hint] = withHint(opts);
  return journalArgs(rest).unhide(id, hint);
};

/** Deletes the WHOLE journal; `phrase` must be exactly "DELETE MY JOURNAL". Resolves { deleted }. */
export const deleteJournal = async (phrase, opts) => journalArgs(opts).deleteAll(phrase);

/**
 * Moves the old browser history ([{ id, ts, text, result }]) into the journal. Resolves
 * { added, skipped, invalid, addedIds, skippedIds, invalidIds, duplicateIds, invalidIndexes }
 * (the id lists hold the original ids as sent; remove from the old history only addedIds and skippedIds).
 */
export const importLegacy = async (entries, opts) => journalArgs(opts).importLegacy(entries);

/**
 * The journal as text for a download. format: "md" (default) or "txt".
 * Resolves { text, filename, mime, count }. Hidden entries only with includeHidden.
 */
export async function exportJournal(format = "md", { includeHidden = false, now = () => Date.now(), ...opts } = {}) {
  if (format !== "md" && format !== "txt") throw new JournalError("invalid", 'The format should be "md" or "txt".');
  const { entries } = await journalArgs(opts).readAll();
  const exportedAt = new Date(now());
  const render = format === "md" ? renderMarkdown : renderText;
  return {
    text: render(entries, { includeHidden, exportedAt }),
    filename: `empathy-journal-${exportedAt.toISOString().slice(0, 10)}.${format}`,
    mime: format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8",
    count: entries.filter((e) => includeHidden || !e.hidden).length,
  };
}

/**
 * "Try saving again": saves an entry the job couldn't save (the `entry` from the answer).
 * Never throws: resolves { saved: true, entryId } or { saved: false, entryId, error }.
 */
export async function retrySave(entry, opts) {
  try {
    const r = await journalArgs(opts).append(entry);
    return { saved: true, entryId: r.entryId };
  } catch (err) {
    return { saved: false, entryId: typeof entry?.id === "string" ? entry.id : null, error: err instanceof JournalError ? err.message : "The journal could not be saved." };
  }
}
