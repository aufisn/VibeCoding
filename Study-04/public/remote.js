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
import { createGistClient, GitHubError, isRequestId, newRequestId, requestFile, resultFile } from "./mailbox.js";

export const REPO = "aufisn/VibeCoding";
export const WORKFLOW = "fridgechef.yml";
export const ACTIONS_PAGE = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;
const STORE_KEY = "fridgechef.github.v1";
const PENDING_KEY = "fridgechef.pending.v1";

export const SETTING_FIELDS = ["gistId", "gistToken", "runToken", "passphrase"];

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const s = JSON.parse(storage.getItem(STORE_KEY) ?? "{}");
    return Object.fromEntries(SETTING_FIELDS.map((f) => [f, typeof s[f] === "string" ? s[f] : ""]));
  } catch {
    return Object.fromEntries(SETTING_FIELDS.map((f) => [f, ""]));
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

export function saveSettings(s, storage = globalThis.localStorage) {
  storage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(SETTING_FIELDS.map((f) => [f, String(s[f] ?? "").trim()]))));
}

export function forgetSettings(storage = globalThis.localStorage) {
  storage.removeItem(STORE_KEY);
  storage.removeItem(PENDING_KEY);
}

export const pendingRequest = (storage = globalThis.localStorage) => {
  const id = storage.getItem(PENDING_KEY);
  return isRequestId(id) ? id : null;
};

function actionsCall(settings, fetch, path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/actions${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${settings.runToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  }).catch(() => {
    throw new GitHubError(0, "GitHub Actions");
  });
}

/** The workflow run for this request, or null while GitHub hasn't listed it yet. */
async function findRun(settings, fetch, id) {
  const res = await actionsCall(settings, fetch, `/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=20`);
  if (!res.ok) throw new GitHubError(res.status, "GitHub Actions");
  const { workflow_runs: runs = [] } = await res.json();
  return runs.find((r) => r.display_title === `FridgeChef ${id}`) ?? null;
}

/**
 * Sends a request through GitHub and waits for the answer: { type: "recognize", image }
 * or { type: "recipes", ingredients, options }. `onStage(text)` reports progress.
 * Returns the decrypted answer.
 */
export async function askGitHub({ settings, payload, fetch = globalThis.fetch.bind(globalThis), storage = globalThis.localStorage, onStage = () => {}, sleep, now = () => Date.now() }) {
  const gist = createGistClient({ token: settings.gistToken, gistId: settings.gistId, fetch });
  const id = newRequestId(now());

  onStage(payload.type === "recognize" ? "Encrypting and uploading the photo…" : "Encrypting and sending your list…");
  await gist.write({ [requestFile(id)]: await encryptJson({ ...payload, sentAt: new Date(now()).toISOString() }, settings.passphrase) });

  onStage("Starting the FridgeChef job on GitHub…");
  const res = await actionsCall(settings, fetch, `/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs: { request_id: id } }) });
  if (!res.ok) {
    await gist.write({ [requestFile(id)]: null }).catch(() => {});
    throw new GitHubError(res.status, "GitHub Actions (run token)");
  }
  storage.setItem(PENDING_KEY, id);
  return waitForAnswer({ settings, id, fetch, storage, onStage, sleep, now, gist });
}

/** Waits for the answer to request `id` (also used after the page was closed mid-wait). */
export async function waitForAnswer({ settings, id, fetch = globalThis.fetch.bind(globalThis), storage = globalThis.localStorage, onStage = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), gist, timeoutMs = 6 * 60_000, everyMs = 4000 }) {
  gist ??= createGistClient({ token: settings.gistToken, gistId: settings.gistId, fetch });
  const until = now() + timeoutMs;
  let run = null;
  for (let round = 0; ; round++) {
    const files = await gist.files();
    const file = files[resultFile(id)];
    if (file) {
      onStage("Decrypting the answer…");
      const answer = await decryptJson(await gist.text(file), settings.passphrase);
      await gist.write({ [resultFile(id)]: null }).catch(() => {}); // leftovers are cleaned up by the job anyway
      storage.removeItem(PENDING_KEY);
      return answer;
    }
    if (run?.status === "completed") {
      storage.removeItem(PENDING_KEY);
      throw Object.assign(new Error(`The GitHub job ${run.conclusion === "cancelled" ? "was cancelled" : "failed"} without an answer. Its log is in the Actions tab.`), { link: run.html_url ?? ACTIONS_PAGE });
    }
    if (now() > until) throw Object.assign(new Error("No answer after 6 minutes. GitHub may be slow: reload the page later to pick it up, or check the Actions tab."), { link: ACTIONS_PAGE });
    if (round % 2 === 0) {
      run = (await findRun(settings, fetch, id).catch(() => null)) ?? run;
      if (!run || run.status === "queued" || run.status === "waiting" || run.status === "pending") onStage("Waiting for a GitHub computer to start (usually 15–40 s)…");
      else if (run.status === "in_progress") onStage("Claude is working on it…");
    }
    await sleep(everyMs);
  }
}
