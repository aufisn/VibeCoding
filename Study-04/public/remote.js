// GitHub mode: how the page gets a recipe when it's opened from GitHub Pages
// (no laptop needed). The page never sees the Anthropic key:
//
//   1. the photo is encrypted here and put in the secret Gist (gist token)
//   2. the page starts the FridgeChef workflow (run token, Actions: write)
//   3. a GitHub computer, which holds the key as a secret, asks Claude and
//      puts the encrypted answer in the Gist
//   4. the page picks it up, decrypts it and deletes it from the Gist
//
// The two tokens, the Gist ID and the passphrase are kept only in this
// browser's storage on this device.

import { decryptJson, encryptJson } from "./fc-crypto.js";
import { createGistClient, GitHubError, isRequestId, MAX_AGE_MS, newRequestId, requestFile, requestTime, resultFile } from "./mailbox.js";

export const REPO = "aufisn/VibeCoding";
export const WORKFLOW = "fridgechef.yml";
export const ACTIONS_PAGE = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;
const STORE_KEY = "fridgechef.github.v1";
const PENDING_KEY = "fridgechef.pending.v1";

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
  return runs.find((r) => r.display_title === `FridgeChef ${id}`) ?? null;
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
 * Sends a request through GitHub and waits for the answer: { type: "recognize", image }
 * or { type: "recipes", ingredients, options }. `onStage(text)` reports progress.
 * Returns the decrypted answer. `signal` (an AbortSignal) stops the wait.
 */
export async function askGitHub({ settings, payload, fetch = globalThis.fetch.bind(globalThis), storage = safeStorage(), onStage = () => {}, sleep, now = () => Date.now(), signal, ...timing }) {
  const gist = createGistClient({ token: settings.gistToken, gistId: settings.gistId, fetch });
  const id = newRequestId(now());

  onStage(payload.type === "recognize" ? "Encrypting and uploading the photo…" : "Encrypting and sending your list…");
  await gist.write({ [requestFile(id)]: await encryptJson({ ...payload, sentAt: new Date(now()).toISOString() }, settings.passphrase) });

  // The Gist's version now, before the job can possibly have changed it.
  const before = await gist.version().catch(() => null);

  onStage("Starting the FridgeChef job on GitHub…");
  const res = await actionsCall(settings, fetch, `/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs: { request_id: id } }) });
  if (!res.ok) {
    await gist.write({ [requestFile(id)]: null }).catch(() => {});
    throw new GitHubError(res.status, "GitHub Actions (run token)");
  }
  safeSet(storage, PENDING_KEY, id); // if this fails we just can't pick it up after a reload
  return waitForAnswer({ settings, id, fetch, storage, onStage, sleep, now, gist, signal, before, ...timing });
}

/**
 * Waits for the answer to request `id` (`resumed: true` after the page was
 * closed mid-wait). Each round asks Actions how the run is doing (one small
 * object) and checks the Gist's version (~1 KB); the Gist itself, which holds
 * the ~0.5 MB encrypted photo until the job answers, is read only once the
 * version has changed. Reads are conditional (ETag), so an unchanged Gist
 * costs a 304 with no body. Before: ~9 MB per photo; now ~0.1 MB.
 */
export async function waitForAnswer({
  settings,
  id,
  fetch = globalThis.fetch.bind(globalThis),
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
  const fail = (message, link, forget = true) => {
    if (forget) safeRemove(storage, PENDING_KEY);
    return Object.assign(new Error(message), { link });
  };
  let run = null;
  let runMissing = false; // GitHub answered and listed no run for this request
  let checksAfterEnd = 0;
  // The Gist's version before the job can have answered: until it changes,
  // there's nothing new to read (and the full read would include the photo).
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
    }
    const noRun = !run && runMissing && now() - started >= noRunMs;
    // With a version to compare, looking costs ~1 KB, so look every round (run
    // states can lag). Without one, look only every 5th round while the job
    // is queued or not listed yet (it can't have answered).
    let readGist = noRun || (resumed && round === 0) || Boolean(before) || (run && !WAITING.has(run.status)) || round % 5 === 4;

    // Cheap check first (a full read anyway every 15th round, in case).
    if (readGist && before && run?.status !== "completed" && !noRun && round % 15 !== 14) {
      readGist = (await gist.version().catch(() => null)) !== before;
    }
    if (readGist) {
      stop();
      const file = (await gist.files())[resultFile(id)];
      if (file) {
        onStage("Decrypting the answer…");
        const text = await gist.text(file);
        let answer;
        try {
          answer = await decryptJson(text, settings.passphrase);
        } catch (err) {
          // Unreadable (wrong passphrase?): waiting again won't help.
          safeRemove(storage, PENDING_KEY);
          await gist.write({ [resultFile(id)]: null }).catch(() => {});
          throw err;
        }
        await gist.write({ [resultFile(id)]: null }).catch(() => {}); // leftovers are cleaned up by the job anyway
        safeRemove(storage, PENDING_KEY);
        return answer;
      }
      if (run?.status === "completed" && ++checksAfterEnd > 2) {
        // Looked three times, a few seconds apart, in case a read was stale.
        throw fail(`The GitHub job ${run.conclusion === "cancelled" ? "was cancelled" : "failed"} without an answer. Its log is in the Actions tab.`, run.html_url ?? ACTIONS_PAGE);
      }
      if (noRun) throw fail("GitHub has no job for this request, and no answer came. Check the Actions tab, then try again.", ACTIONS_PAGE);
    }
    if (now() > until) throw fail("No answer after 6 minutes. GitHub may be slow: reload the page later to pick it up, or check the Actions tab.", ACTIONS_PAGE, false);

    if (!run || WAITING.has(run.status)) onStage("Waiting for a GitHub computer to start (usually 15–40 s)…");
    else if (run.status === "in_progress") onStage("Claude is working on it…");
    await sleep(run?.status === "completed" ? recheckMs : run && !WAITING.has(run.status) ? everyMs : queuedEveryMs);
  }
}
