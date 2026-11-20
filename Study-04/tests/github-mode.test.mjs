// GitHub mode end to end, with a fake GitHub (Gist + Actions) and a fake
// Claude: page → encrypted Gist request → workflow dispatch → job → encrypted
// answer → page. No network, no API calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { decryptJson, encryptJson } from "../public/fc-crypto.js";
import { createGistClient, isRequestId, newRequestId, staleFiles } from "../public/mailbox.js";
import { askGitHub, forgetSettings, loadSettings, pendingRequest, safeStorage, saveSettings, settingsProblems, waitForAnswer } from "../public/remote.js";
import { checkIngredients, checkOptions, recipeText, validIngredients, validRecipes, validSaved } from "../public/options.js";
import { fitSize, preparePhoto } from "../public/photo.js";
import { missingSettings, runRequest } from "../ci/run-request.mjs";
import { checkImage, handleRequest } from "../server/fridgechef.mjs";

const GIST_ID = "f".repeat(32);
const SETTINGS = { gistId: GIST_ID, gistToken: "ghp_" + "a".repeat(36), runToken: "github_pat_" + "b".repeat(40), passphrase: "correct horse battery" };
const IMAGE = { base64: "iVBORw0KGgoAAAANSUhEUg==", mediaType: "image/jpeg" };

const RECIPE = { title: "Omelette", summary: "Quick eggs.", cuisine: "French", difficulty: "Easy", minutes: 10, servings: 2, ingredients: [{ item: "eggs", amount: "4" }], steps: ["Whisk.", "Cook."], extra: [] };

function fakeClaude({ ingredients = [{ name: "eggs", quantity: "4", confidence: "high", category: "dairy & eggs" }, { name: "jar", quantity: "1", confidence: "low", category: "made-up" }], fail } = {}) {
  const calls = [];
  return {
    calls,
    async identifyIngredients(image) {
      calls.push(["identify", image]);
      if (fail) throw fail;
      return { ingredients, notes: "", model: "claude-sonnet-5-5", cost: 0.006 };
    },
    async writeRecipes(list, options) {
      calls.push(["recipes", list, options]);
      if (fail) throw fail;
      return { recipes: [RECIPE, { ...RECIPE, title: "Frittata" }], model: "claude-sonnet-5-5", cost: 0.004 };
    },
  };
}

/**
 * An in-memory GitHub: one Gist (with ETags, 304s and a version list) and the
 * Actions endpoints. `onDispatch(id, run)` plays the job; `beforeGistRead(n)`
 * runs before the n-th full Gist read (to change things mid-wait).
 */
function fakeGitHub({ onDispatch = () => {}, dispatchStatus = 204, beforeGistRead = () => {} } = {}) {
  const files = {};
  const runs = [];
  const seen = [];
  let reads = 0;
  // Like GitHub: the ETag and the version change whenever the content does.
  const version = () => createHash("sha1").update(JSON.stringify(Object.entries(files).sort())).digest("hex").slice(0, 12);
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const entry = { url, method, auth: init.headers?.Authorization, ifNoneMatch: init.headers?.["If-None-Match"] };
    seen.push(entry);
    const json = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.startsWith(`https://api.github.com/gists/${GIST_ID}`)) {
      if (init.headers?.Authorization !== `Bearer ${SETTINGS.gistToken}`) return json(401, {});
      if (url === `https://api.github.com/gists/${GIST_ID}/commits?per_page=1`) return json(200, [{ version: version() }]);
      if (method === "PATCH") {
        for (const [name, v] of Object.entries(JSON.parse(init.body).files)) {
          if (v === null) delete files[name];
          else files[name] = v.content;
        }
        return json(200, {});
      }
      await beforeGistRead(++reads);
      const etag = `"${version()}"`;
      entry.status = entry.ifNoneMatch === etag ? 304 : 200;
      if (entry.status === 304) return json(304, undefined, { etag });
      entry.names = Object.keys(files);
      return json(200, { files: Object.fromEntries(Object.entries(files).map(([n, c]) => [n, { content: c, truncated: false }])) }, { etag });
    }
    if (url.includes("/actions/")) {
      if (init.headers?.Authorization !== `Bearer ${SETTINGS.runToken}`) return json(401, {});
      if (method === "POST" && url.endsWith("/workflows/fridgechef.yml/dispatches")) {
        if (dispatchStatus !== 204) return json(dispatchStatus, {});
        const { ref, inputs } = JSON.parse(init.body);
        assert.equal(ref, "main");
        runs.unshift({ id: runs.length + 1, display_title: `FridgeChef ${inputs.request_id}`, status: "queued", html_url: "https://github.com/aufisn/VibeCoding/actions/runs/1" });
        await onDispatch(inputs.request_id, runs[0]);
        return { ok: true, status: 204, json: async () => ({}) };
      }
      if (url.includes("/workflows/fridgechef.yml/runs")) return json(200, { workflow_runs: runs });
      const one = /\/actions\/runs\/(\d+)$/.exec(url);
      if (one && runs.some((r) => r.id === Number(one[1]))) return json(200, { ...runs.find((r) => r.id === Number(one[1])) });
    }
    return json(404, {});
  };
  return { fetch, files, runs, seen };
}

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const noSleep = async () => {};

test("encryption round-trips, uses Market Agent's envelope, and refuses a wrong passphrase", async () => {
  const env = await encryptJson({ hello: "fridge", n: [1, 2] }, "pass phrase one");
  const parsed = JSON.parse(env);
  assert.deepEqual(Object.keys(parsed), ["v", "kdf", "iter", "salt", "iv", "ct"]);
  assert.equal(parsed.kdf, "PBKDF2-SHA256");
  assert.equal(parsed.iter, 310000);
  assert.ok(!env.includes("fridge"));
  assert.deepEqual(await decryptJson(env, "pass phrase one"), { hello: "fridge", n: [1, 2] });
  await assert.rejects(decryptJson(env, "wrong"), /passphrase is wrong/);
  await assert.rejects(decryptJson('{"v":1,"kdf":"PBKDF2-SHA256","iter":1,"salt":"","iv":"","ct":""}', "x"), /isn't an encrypted/);
});

test("full GitHub round trip: recognize, then two recipes; everything is cleaned up", async () => {
  const claude = fakeClaude();
  let gh;
  gh = fakeGitHub({
    onDispatch: async (id, run) => {
      run.status = "in_progress";
      const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
      // What the Gist holds while waiting: only ciphertext.
      assert.ok(!gh.files[`req-${id}.enc`].includes(IMAGE.base64));
      const r = await runRequest({ id, passphrase: SETTINGS.passphrase, gist, claude, log: () => {} });
      assert.equal(r.ok, true);
      run.status = "completed";
    },
  });
  const storage = memoryStorage();
  const stages = [];
  const answer = await askGitHub({ settings: SETTINGS, payload: { type: "recognize", image: IMAGE }, fetch: gh.fetch, storage, onStage: (s) => stages.push(s), sleep: noSleep });

  assert.equal(answer.ok, true);
  assert.equal(answer.type, "recognize");
  assert.deepEqual(answer.ingredients.map((i) => [i.name, i.category]), [["eggs", "dairy & eggs"], ["jar", "other"]], "unknown categories become other");
  assert.equal(answer.cost, 0.006);
  assert.deepEqual(claude.calls[0][1], IMAGE, "the job got the exact photo");

  const cooked = await askGitHub({ settings: SETTINGS, payload: { type: "recipes", ingredients: ["eggs", " eggs ", "milk"], options: { cuisine: "French", maxMinutes: 20 } }, fetch: gh.fetch, storage, sleep: noSleep });
  assert.equal(cooked.type, "recipes");
  assert.deepEqual(cooked.recipes.map((r) => r.title), ["Omelette", "Frittata"]);
  assert.deepEqual(claude.calls[1].slice(1), [["eggs", "milk"], { cuisine: "French", difficulty: "Easy", maxMinutes: 20, servings: 2 }]);
  assert.deepEqual(Object.keys(gh.files), [], "requests and answers are all deleted");
  assert.equal(storage.m.size, 0, "nothing pending");
  assert.ok(stages.some((s) => /uploading/i.test(s)) && stages.some((s) => /Decrypting/.test(s)));
  // Each token went only to its own API.
  for (const s of gh.seen) {
    if (s.url.includes("/gists/")) assert.equal(s.auth, `Bearer ${SETTINGS.gistToken}`);
    if (s.url.includes("/actions/")) assert.equal(s.auth, `Bearer ${SETTINGS.runToken}`);
  }
});

test("a failed dispatch removes the uploaded photo and explains the token problem", async () => {
  const gh = fakeGitHub({ dispatchStatus: 403 });
  await assert.rejects(askGitHub({ settings: SETTINGS, payload: { type: "recognize", image: IMAGE }, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep }), /run token.*isn't allowed/i);
  assert.deepEqual(Object.keys(gh.files), []);
});

test("Claude errors come back as an encrypted error answer the page shows", async () => {
  let gh;
  gh = fakeGitHub({
    onDispatch: async (id) => {
      const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
      const fail = Object.assign(new Error("Claude declined this request."), { name: "ClaudeError", status: 200 });
      const r = await runRequest({ id, passphrase: SETTINGS.passphrase, gist, claude: fakeClaude({ fail }), log: () => {} });
      assert.equal(r.ok, false);
    },
  });
  const answer = await askGitHub({ settings: SETTINGS, payload: { type: "recognize", image: IMAGE }, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep });
  assert.equal(answer.ok, false);
  assert.equal(answer.error, "Claude declined this request.");
});

test("a job that fails without answering is reported with a link to its log", async () => {
  const gh = fakeGitHub({ onDispatch: (_id, run) => Object.assign(run, { status: "completed", conclusion: "failure" }) });
  await assert.rejects(askGitHub({ settings: SETTINGS, payload: { type: "recognize", image: IMAGE }, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep }), (err) => {
    assert.match(err.message, /failed without an answer/);
    assert.equal(err.link, "https://github.com/aufisn/VibeCoding/actions/runs/1");
    return true;
  });
});

test("waiting gives up after the timeout, keeping the request to pick up later", async () => {
  const gh = fakeGitHub();
  const storage = memoryStorage();
  let t = 0;
  const id = newRequestId(0);
  gh.runs.push({ id: 1, display_title: `FridgeChef ${id}`, status: "queued" }); // GitHub is slow to start it
  storage.setItem("fridgechef.pending.v1", id);
  await assert.rejects(waitForAnswer({ settings: SETTINGS, id, fetch: gh.fetch, storage, sleep: async (ms) => (t += ms), now: () => t }), /No answer after 6 minutes/);
  assert.equal(storage.getItem("fridgechef.pending.v1"), id, "kept for a reload");
});

test("the job refuses bad IDs, missing requests and a wrong passphrase without leaking", async () => {
  const gh = fakeGitHub();
  const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
  const claude = fakeClaude();
  assert.match((await runRequest({ id: "../etc", passphrase: "x", gist, claude, log: () => {} })).message, /format/);
  assert.match((await runRequest({ id: newRequestId(), passphrase: "x", gist, claude, log: () => {} })).message, /isn't in the Gist/);
  const id = newRequestId();
  gh.files[`req-${id}.enc`] = await encryptJson({ type: "recognize", image: IMAGE }, "another passphrase");
  const r = await runRequest({ id, passphrase: SETTINGS.passphrase, gist, claude, log: () => {} });
  assert.match(r.message, /passphrase is wrong/);
  assert.equal(claude.calls.length, 0, "Claude isn't called (or paid) for an unreadable request");
  assert.deepEqual(missingSettings({ REQUEST_ID: "x" }), ["ANTHROPIC_API_KEY", "FC_PASSPHRASE", "FC_GIST_ID", "FC_GIST_TOKEN"]);
});

test("the job deletes mailbox files older than a day", async () => {
  const now = Date.UTC(2026, 10, 20);
  const old = newRequestId(now - 2 * 86_400_000);
  const fresh = newRequestId(now - 60_000);
  assert.deepEqual(staleFiles([`res-${old}.enc`, `req-${fresh}.enc`, "README.md"], now), [`res-${old}.enc`]);
  assert.ok(isRequestId(fresh) && !isRequestId("abc") && !isRequestId(`${fresh}/x`));
});

test("settings checks, photo sizing and photo checks", async () => {
  assert.deepEqual(settingsProblems(SETTINGS), []);
  assert.equal(settingsProblems({ gistId: "x", gistToken: "", runToken: "ghp_x", passphrase: "short" }).length, 4);
  assert.deepEqual(fitSize(4032, 3024), { width: 1568, height: 1176 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.throws(() => checkImage({ base64: "abc", mediaType: "image/bmp" }), /Unsupported/);
  assert.throws(() => checkImage({ base64: "<script>", mediaType: "image/png" }), /damaged/);
});

test("ingredient lists and recipe options are checked the same way everywhere", async () => {
  assert.deepEqual(checkIngredients(["Eggs", "eggs", { name: " milk\n" }, "", null]), ["Eggs", "milk"]);
  assert.throws(() => checkIngredients([]), /at least one/);
  assert.throws(() => checkIngredients(Array.from({ length: 61 }, (_, i) => `item ${i}`)), /too many/);
  assert.equal(checkIngredients(["x".repeat(500)])[0].length, 60);
  assert.deepEqual(checkOptions({}), { cuisine: "Any", difficulty: "Easy", maxMinutes: 30, servings: 2 });
  assert.throws(() => checkOptions({ cuisine: "Martian" }), /Cuisine/);
  assert.throws(() => checkOptions({ maxMinutes: 500 }), /Max time/);
  assert.throws(() => checkOptions({ servings: 0 }), /Servings/);
  await assert.rejects(handleRequest(fakeClaude(), { type: "delete-everything" }), /Unknown request/);
  await assert.rejects(handleRequest(fakeClaude(), { type: "recipes", ingredients: ["eggs"], options: { difficulty: "Impossible" } }), /Difficulty/);
  const text = recipeText(RECIPE);
  assert.match(text, /^Omelette\n/);
  assert.match(text, /French · Easy · 10 min · serves 2/);
  assert.match(text, /- 4 eggs/);
  assert.match(text, /2\. Cook\./);
});

test("the workflow passes the request ID through env only and keeps secrets out of run lines", async () => {
  const yml = await readFile(new URL("../../.github/workflows/fridgechef.yml", import.meta.url), "utf8");
  assert.match(yml, /workflow_dispatch:/);
  assert.doesNotMatch(yml, /schedule:/, "no schedule: it only runs when you ask");
  assert.match(yml, /permissions:\s*\n\s*contents: read/);
  for (const line of yml.split("\n").filter((l) => /^\s*(-\s*)?run:/.test(l))) assert.doesNotMatch(line, /\$\{\{/, `no expressions in run lines: ${line}`);
  for (const s of ["ANTHROPIC_API_KEY", "FC_PASSPHRASE", "FC_GIST_ID", "FC_GIST_TOKEN"]) assert.match(yml, new RegExp(`${s}: \\$\\{\\{ secrets\\.${s} \\}\\}`));
  // Secrets only in the step that needs them: checkout, setup-node and npm ci never see them.
  const answerStep = yml.slice(yml.indexOf("- name: Answer the request"));
  assert.equal((yml.match(/secrets\./g) ?? []).length, (answerStep.match(/secrets\./g) ?? []).length, "every secret is in the Answer step");
  assert.match(answerStep, /^\s+env:\s*$/m);
  // Actions pinned to full commit SHAs, not movable tags.
  const uses = [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${u} is pinned to a commit`);
});

/* ---------- Waiting: cheap polling, resuming, storage ---------- */

const PENDING = "fridgechef.pending.v1";
const throwingStorage = () => ({
  getItem() {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem() {
    throw new DOMException("full", "QuotaExceededError");
  },
  removeItem() {
    throw new DOMException("blocked", "SecurityError");
  },
});

/** A job that starts at once and answers on the n-th round of the page's polling. */
function slowJob({ answerOnRound = 4, claude = fakeClaude() } = {}) {
  let gh;
  let rounds = 0;
  let pending;
  gh = fakeGitHub({ onDispatch: (id, run) => ((pending = { id, run }), (run.status = "in_progress")) });
  const sleep = async () => {
    if (++rounds === answerOnRound && pending) {
      const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
      await runRequest({ id: pending.id, passphrase: SETTINGS.passphrase, gist, claude, log: () => {} });
      pending.run.status = "completed";
    }
  };
  return { gh, sleep };
}

test("while waiting, the pending photo is never downloaded again: version checks, then one small read", async () => {
  const { gh, sleep } = slowJob({ answerOnRound: 6 });
  const answer = await askGitHub({ settings: SETTINGS, payload: { type: "recognize", image: IMAGE }, fetch: gh.fetch, storage: memoryStorage(), sleep });
  assert.equal(answer.type, "recognize");
  const fullReads = gh.seen.filter((s) => s.method === "GET" && s.status === 200);
  assert.equal(fullReads.length, 2, "the job's own read, and one by the page after the job answered");
  assert.ok(fullReads[0].names.some((n) => n.startsWith("req-")), "the job read the photo");
  assert.ok(!fullReads[1].names.some((n) => n.startsWith("req-")), "the page never downloaded the photo back");
  assert.ok(gh.seen.filter((s) => s.url.endsWith("/commits?per_page=1")).length >= 6, "cheap version checks instead");
  // The run is looked up by its time window once, then by its ID (one small object).
  const listing = gh.seen.filter((s) => s.url.includes("/workflows/fridgechef.yml/runs"));
  assert.equal(listing.length, 1);
  assert.match(decodeURIComponent(listing[0].url), /created=\d{4}-\d\d-\d\dT[\d:.]+Z\.\.\d{4}-/);
  assert.ok(gh.seen.some((s) => s.url.endsWith("/actions/runs/1")));
});

test("Gist reads are conditional: an unchanged Gist answers 304 and the last files are reused", async () => {
  const gh = fakeGitHub();
  const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
  await gist.write({ "req-a.enc": "x".repeat(1000) });
  const first = await gist.files();
  const second = await gist.files();
  assert.deepEqual(second, first);
  const gets = gh.seen.filter((s) => s.method === "GET" && !s.url.includes("/commits"));
  assert.deepEqual(gets.map((g) => [g.ifNoneMatch === undefined, g.status]), [[true, 200], [false, 304]]);
  await gist.write({ "req-a.enc": null });
  assert.deepEqual(await gist.files(), {}, "after our own change it reads fresh");
  assert.equal(gh.seen.at(-1).ifNoneMatch, undefined);
});

test("a run that ended is re-checked a few seconds apart before giving up (a read can be stale)", async () => {
  const id = newRequestId();
  const answerFile = await encryptJson({ id, ok: true, type: "recognize", ingredients: [] }, SETTINGS.passphrase);
  const gh = fakeGitHub({ beforeGistRead: (n) => n === 2 && (gh.files[`res-${id}.enc`] = answerFile) });
  gh.runs.push({ id: 1, display_title: `FridgeChef ${id}`, status: "completed", conclusion: "success" });
  const storage = memoryStorage();
  storage.setItem(PENDING, id);
  const waits = [];
  const answer = await waitForAnswer({ settings: SETTINGS, id, fetch: gh.fetch, storage, resumed: true, sleep: async (ms) => waits.push(ms) });
  assert.equal(answer.ok, true);
  assert.deepEqual(waits, [3000], "one short re-check");
  assert.equal(storage.getItem(PENDING), null);
});

test("resuming: an answer that won't decrypt is dropped, from the Gist and from this device", async () => {
  const id = newRequestId();
  const gh = fakeGitHub();
  gh.files[`res-${id}.enc`] = await encryptJson({ ok: true }, "a different passphrase");
  const storage = memoryStorage();
  storage.setItem(PENDING, id);
  await assert.rejects(waitForAnswer({ settings: SETTINGS, id, fetch: gh.fetch, storage, resumed: true, sleep: noSleep }), /passphrase is wrong/);
  assert.equal(storage.getItem(PENDING), null, "not retried on every visit");
  assert.deepEqual(Object.keys(gh.files), [], "the unreadable answer is deleted");
});

test("resuming: no run and no answer gives up within about 20 s and forgets the request", async () => {
  const id = newRequestId();
  const gh = fakeGitHub();
  const storage = memoryStorage();
  storage.setItem(PENDING, id);
  let t = Date.now();
  const startedAt = t;
  await assert.rejects(waitForAnswer({ settings: SETTINGS, id, fetch: gh.fetch, storage, resumed: true, sleep: async (ms) => (t += ms), now: () => t }), /no job for this request/);
  assert.ok(t - startedAt <= 30_000, `gave up after ${(t - startedAt) / 1000} s`);
  assert.equal(storage.getItem(PENDING), null);
});

test("a pending request older than a day, or with a nonsense ID, is dropped on load", () => {
  const now = Date.UTC(2026, 10, 20);
  const storage = memoryStorage();
  const fresh = newRequestId(now - 60_000);
  storage.setItem(PENDING, fresh);
  assert.equal(pendingRequest(storage, now), fresh);
  storage.setItem(PENDING, newRequestId(now - 2 * 86_400_000));
  assert.equal(pendingRequest(storage, now), null);
  assert.equal(storage.getItem(PENDING), null);
  storage.setItem(PENDING, "../../etc");
  assert.equal(pendingRequest(storage, now), null);
  assert.equal(storage.getItem(PENDING), null);
});

test("a stopped wait ends at once with AbortError and leaves the request alone", async () => {
  const id = newRequestId();
  const gh = fakeGitHub();
  gh.runs.push({ id: 1, display_title: `FridgeChef ${id}`, status: "queued" });
  const storage = memoryStorage();
  storage.setItem(PENDING, id);
  const stop = new AbortController();
  const wait = waitForAnswer({ settings: SETTINGS, id, fetch: gh.fetch, storage, signal: stop.signal }); // real (abortable) sleep
  setTimeout(() => stop.abort(), 20);
  const t0 = Date.now();
  await assert.rejects(wait, (err) => err.name === "AbortError");
  assert.ok(Date.now() - t0 < 1000, "didn't sit out the 6 s sleep");
});

test("blocked or full browser storage never breaks GitHub mode", async () => {
  const blocked = throwingStorage();
  assert.deepEqual(loadSettings(blocked), { gistId: "", gistToken: "", runToken: "", passphrase: "" });
  assert.equal(saveSettings(SETTINGS, blocked), false, "the page can say it couldn't save");
  assert.equal(pendingRequest(blocked), null);
  assert.doesNotThrow(() => forgetSettings(blocked));
  assert.equal(saveSettings(SETTINGS, memoryStorage()), true);
  // Reading window.localStorage itself throws when storage is blocked.
  const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } });
  try {
    assert.equal(safeStorage(), null);
    assert.deepEqual(loadSettings(), { gistId: "", gistToken: "", runToken: "", passphrase: "" });
    assert.equal(saveSettings(SETTINGS), false);
  } finally {
    if (desc) Object.defineProperty(globalThis, "localStorage", desc);
    else delete globalThis.localStorage;
  }
  // A whole request still works; it just can't be picked up after a reload.
  const { gh, sleep } = slowJob({ answerOnRound: 2 });
  const answer = await askGitHub({ settings: SETTINGS, payload: { type: "recognize", image: IMAGE }, fetch: gh.fetch, storage: blocked, sleep });
  assert.equal(answer.type, "recognize");
});

test("saved data from this device is shape-checked on load", () => {
  const good = { name: "eggs", quantity: "4", confidence: "high", category: "dairy & eggs", use: true };
  assert.deepEqual(validIngredients([good, null, 3, { name: 5 }, { name: "  " }, { name: "milk\n", category: "made-up", use: "yes" }]), [good, { name: "milk", quantity: "", confidence: "high", category: "other", use: false }]);
  assert.deepEqual(validIngredients("nope"), []);
  assert.deepEqual(validRecipes([RECIPE, { title: 1 }, null, { ...RECIPE, steps: "x" }]).map((r) => r.title), ["Omelette", "Omelette"]);
  assert.deepEqual(validRecipes([{ ...RECIPE, steps: "x", ingredients: [null, { item: "egg" }], extra: 7 }])[0].steps, []);
  assert.deepEqual(validSaved([{ savedAt: "2026-11-20T00:00:00Z", recipe: RECIPE }, { savedAt: 1, recipe: RECIPE }, { recipe: null }, "x"]).length, 1);
});

test("a big photo is shrunk while it's decoded, not after (with a fallback)", async () => {
  const saved = { Image: globalThis.Image, createImageBitmap: globalThis.createImageBitmap, document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const log = [];
  let bitmapReply;
  globalThis.Image = class {
    naturalWidth = 8000; // a 48 MP photo
    naturalHeight = 6000;
    set src(url) {
      log.push(["img", url]);
      queueMicrotask(() => this.onload());
    }
  };
  globalThis.createImageBitmap = async (_file, opts) => {
    log.push(["bitmap", opts]);
    return bitmapReply(opts);
  };
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage: (p, ...a) => log.push(["draw", p.constructor === globalThis.Image ? "img" : "bitmap", ...a]) }), toBlob: (cb) => cb(new Blob([new Uint8Array(2048)])) }) };
  URL.createObjectURL = () => "blob:photo";
  URL.revokeObjectURL = (u) => log.push(["revoke", u]);
  const file = { type: "image/jpeg" };
  try {
    let closed = 0;
    bitmapReply = (o) => ({ width: o.resizeWidth, height: o.resizeHeight, close: () => closed++ });
    const p = await preparePhoto(file);
    assert.deepEqual([p.width, p.height, p.kb], [1568, 1176, 2]);
    assert.deepEqual(log.find((l) => l[0] === "bitmap")[1], { imageOrientation: "from-image", resizeWidth: 1568, resizeHeight: 1176, resizeQuality: "high" });
    assert.deepEqual(log.find((l) => l[0] === "draw"), ["draw", "bitmap", 0, 0, 1568, 1176]);
    assert.ok(log.some((l) => l[0] === "revoke") && closed === 1, "object URL and bitmap released");

    // A browser that resizes before rotating (sides swapped) or doesn't support resizing: plain <img> path.
    for (const reply of [(o) => ({ width: o.resizeHeight, height: o.resizeWidth, close: () => closed++ }), () => { throw new TypeError("unsupported"); }]) {
      log.length = 0;
      bitmapReply = reply;
      await preparePhoto(file);
      assert.deepEqual(log.find((l) => l[0] === "draw"), ["draw", "img", 0, 0, 1568, 1176]);
      assert.deepEqual(log.at(-1), ["revoke", "blob:photo"], "released after drawing");
    }
  } finally {
    Object.assign(globalThis, { Image: saved.Image, createImageBitmap: saved.createImageBitmap, document: saved.document });
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
  }
});
