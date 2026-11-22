// GitHub mode end to end with a fake GitHub (Gist + Actions) and a fake Claude:
// page -> encrypted Gist request -> workflow dispatch -> job -> encrypted
// answer -> page. No network, no API calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { decryptJson, encryptJson } from "../web/fc-crypto.mjs";
import { createGistClient, isRequestId, newRequestId, staleFiles } from "../web/mailbox.mjs";
import { cancelPending, clearPending, forgetSettings, hasSettings, loadSettings, pendingRequest, reflectViaGitHub, resumePending, saveSettings, settingsProblems, REPO, WORKFLOW } from "../web/github-mode.mjs";
import { missingSettings, runRequest } from "../ci/run-request.mjs";

const GIST_ID = "f".repeat(32);
const SETTINGS = { gistId: GIST_ID, gistToken: "ghp_" + "a".repeat(36), runToken: "github_pat_" + "b".repeat(40), passphrase: "correct horse battery" };
const GOOD = { primary_emotion: "joy", emotions: [{ id: "joy", intensity: 4 }], mood_score: 9, summary: "Happy", empathy: "That sounds lovely.", comfort: "Enjoy it.", gentle_step: "", concern: "none", language: "en" };
const MESSAGE = { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(GOOD) }], usage: { input_tokens: 1000, output_tokens: 200 } };

function fakeClaude({ fail } = {}) {
  const calls = [];
  return {
    calls,
    async reflect(body) {
      calls.push(body);
      if (fail) throw fail;
      return MESSAGE;
    },
  };
}

function fakeGitHub({ onDispatch = () => {}, dispatchStatus = 204 } = {}) {
  const files = {};
  const runs = [];
  const seen = [];
  const version = () => createHash("sha1").update(JSON.stringify(Object.entries(files).sort())).digest("hex").slice(0, 12);
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const entry = { url, method, auth: init.headers?.Authorization, ifNoneMatch: init.headers?.["If-None-Match"] };
    seen.push(entry);
    const json = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.startsWith(`https://api.github.com/gists/${GIST_ID}`)) {
      if (init.headers?.Authorization !== `Bearer ${SETTINGS.gistToken}`) return json(401, {});
      if (url.endsWith("/commits?per_page=1")) return json(200, [{ version: version() }]);
      if (method === "PATCH") {
        for (const [name, v] of Object.entries(JSON.parse(init.body).files)) {
          if (v === null) delete files[name];
          else files[name] = v.content;
        }
        return json(200, {});
      }
      const etag = `"${version()}"`;
      if (entry.ifNoneMatch === etag) return json(304, undefined, { etag });
      return json(200, { files: Object.fromEntries(Object.entries(files).map(([n, c]) => [n, { content: c, truncated: false }])) }, { etag });
    }
    if (url.includes("/actions/")) {
      if (init.headers?.Authorization !== `Bearer ${SETTINGS.runToken}`) return json(401, {});
      if (method === "POST" && url === `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`) {
        if (dispatchStatus !== 204) return json(dispatchStatus, {});
        const { ref, inputs } = JSON.parse(init.body);
        assert.equal(ref, "main");
        runs.unshift({ id: runs.length + 1, display_title: `Empathy Diary ${inputs.request_id}`, status: "queued", html_url: "https://github.com/aufisn/VibeCoding/actions/runs/1" });
        await onDispatch(inputs.request_id, runs[0]);
        return { ok: true, status: 204, json: async () => ({}) };
      }
      if (url.includes(`/workflows/${WORKFLOW}/runs`)) return json(200, { workflow_runs: runs });
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
const throwingStorage = () => ({
  getItem() { throw new DOMException("blocked", "SecurityError"); },
  setItem() { throw new DOMException("full", "QuotaExceededError"); },
  removeItem() { throw new DOMException("blocked", "SecurityError"); },
});
const noSleep = async () => {};
const PENDING = "empathyDiary.pending.v1";

test("encryption round-trips with FridgeChef's envelope and refuses a wrong passphrase", async () => {
  const env = await encryptJson({ hello: "diary", n: [1, 2] }, "pass phrase one");
  const parsed = JSON.parse(env);
  assert.deepEqual(Object.keys(parsed), ["v", "kdf", "iter", "salt", "iv", "ct"]);
  assert.equal(parsed.kdf, "PBKDF2-SHA256");
  assert.equal(parsed.iter, 310000);
  assert.ok(!env.includes("diary"));
  assert.deepEqual(await decryptJson(env, "pass phrase one"), { hello: "diary", n: [1, 2] });
  await assert.rejects(decryptJson(env, "wrong"), /passphrase is wrong/);
  await assert.rejects(decryptJson('{"v":1,"kdf":"PBKDF2-SHA256","iter":1,"salt":"","iv":"","ct":""}', "x"), /isn't an encrypted/);
});

test("mailbox: IDs, stale files and the Gist client's input checks", () => {
  const now = Date.UTC(2026, 10, 20);
  const old = newRequestId(now - 2 * 86_400_000);
  const fresh = newRequestId(now - 60_000);
  assert.deepEqual(staleFiles([`res-${old}.enc`, `req-${old}.enc`, `req-${fresh}.enc`, "README.md", "req-../x.enc", "notes.enc"], now), [`res-${old}.enc`, `req-${old}.enc`]);
  assert.ok(isRequestId(fresh) && !isRequestId("abc") && !isRequestId(`${fresh}/x`));
  assert.throws(() => createGistClient({ token: "t", gistId: "../x" }), /Gist ID/);
});

test("settings: same storage key as FridgeChef, validation, safe storage", () => {
  assert.deepEqual(settingsProblems(SETTINGS), []);
  assert.equal(settingsProblems({ gistId: "x", gistToken: "", runToken: "ghp_x", passphrase: "short" }).length, 4);
  assert.equal(settingsProblems({ ...SETTINGS, runToken: "ghp_" + "b".repeat(40) }).length, 1, "the run token must be fine-grained");
  const storage = memoryStorage();
  assert.equal(hasSettings(storage), false);
  assert.equal(saveSettings({ ...SETTINGS, gistId: ` ${GIST_ID} ` }, storage), true);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem("fridgechef.github.v1"))), ["gistId", "gistToken", "runToken", "passphrase"]);
  assert.deepEqual(loadSettings(storage), SETTINGS);
  assert.equal(hasSettings(storage), true);
  storage.setItem(PENDING, "x");
  forgetSettings(storage);
  assert.equal(storage.m.size, 0);
  // FridgeChef's own saved settings are read as they are.
  storage.setItem("fridgechef.github.v1", "not json");
  assert.equal(loadSettings(storage).passphrase, "");
  // Blocked storage never throws.
  const bad = throwingStorage();
  assert.equal(saveSettings(SETTINGS, bad), false);
  assert.deepEqual(loadSettings(bad), { gistId: "", gistToken: "", runToken: "", passphrase: "" });
  assert.doesNotThrow(() => forgetSettings(bad));
  assert.equal(pendingRequest(bad), null);
});

test("full round trip: entry goes in encrypted, the reflection comes back, everything is cleaned up", async () => {
  const claude = fakeClaude();
  let gh;
  gh = fakeGitHub({
    onDispatch: async (id, run) => {
      run.status = "in_progress";
      assert.ok(!gh.files[`req-${id}.enc`].includes("long day"), "the Gist holds only ciphertext");
      const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
      const r = await runRequest({ id, passphrase: SETTINGS.passphrase, gist, claude, log: () => {} });
      assert.equal(r.ok, true);
      run.status = "completed";
    },
  });
  const storage = memoryStorage();
  const progress = [];
  const result = await reflectViaGitHub({ text: "A long day but a good one", settings: SETTINGS, fetch: gh.fetch, storage, sleep: noSleep, onProgress: (p, s) => progress.push([p, s]) });
  assert.equal(result.primary_emotion, "joy");
  assert.equal(result.empathy, "That sounds lovely.");
  assert.equal(result.usage.input_tokens, 1000);
  assert.match(claude.calls[0].messages[0].content, /A long day but a good one/);
  assert.equal(claude.calls[0].model, "claude-sonnet-5-5");
  assert.deepEqual(Object.keys(gh.files), [], "request and answer are deleted");
  assert.equal(storage.m.size, 0, "nothing pending");
  const phrases = progress.map((p) => p[0]);
  assert.ok(phrases.includes("Sending your words securely…") && phrases.includes("Waiting for GitHub to start…") && phrases.includes("Almost there…"));
  assert.ok(progress.every((p) => Number.isInteger(p[1])));
  for (const s of gh.seen) {
    if (s.url.includes("/gists/")) assert.equal(s.auth, `Bearer ${SETTINGS.gistToken}`);
    if (s.url.includes("/actions/")) assert.equal(s.auth, `Bearer ${SETTINGS.runToken}`);
    assert.ok(!s.url.includes("anthropic"), "the page never calls Anthropic");
  }
});

test("reflectViaGitHub: missing settings and bad text never touch the network", async () => {
  let called = false;
  const fetch = async () => ((called = true), {});
  await assert.rejects(reflectViaGitHub({ text: "hi there", settings: { gistId: "", gistToken: "", runToken: "", passphrase: "" }, fetch, storage: memoryStorage() }), (e) => e.code === "settings" && /isn't set up/.test(e.message));
  await assert.rejects(reflectViaGitHub({ text: "   ", settings: SETTINGS, fetch, storage: memoryStorage() }), /write a line/);
  assert.equal(called, false);
});

test("a failed dispatch removes the uploaded entry and explains the token problem", async () => {
  const gh = fakeGitHub({ dispatchStatus: 403 });
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep }), /run token.*isn't allowed/i);
  assert.deepEqual(Object.keys(gh.files), []);
});

test("Claude errors and entry checks come back as a plain error the page shows", async () => {
  for (const [text, fail, expected] of [
    ["hello there", Object.assign(new Error("Claude is overloaded right now. Please try again shortly."), { status: 502 }), /overloaded/],
    ["12345", null, /words or an emoji/],
    ["x".repeat(301), null, /bit long/],
  ]) {
    let gh;
    gh = fakeGitHub({
      onDispatch: async (id) => {
        const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
        const r = await runRequest({ id, passphrase: SETTINGS.passphrase, gist, claude: fakeClaude({ fail }), log: () => {} });
        assert.equal(r.ok, false);
      },
    });
    await assert.rejects(reflectViaGitHub({ text, settings: SETTINGS, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep }), expected);
  }
});

test("a job that fails without answering is reported with a link to its log", async () => {
  const gh = fakeGitHub({ onDispatch: (_id, run) => Object.assign(run, { status: "completed", conclusion: "failure" }) });
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep }), (err) => {
    assert.match(err.message, /failed without an answer/);
    assert.equal(err.link, "https://github.com/aufisn/VibeCoding/actions/runs/1");
    return true;
  });
});

test("waiting gives up after the timeout and keeps the request to pick up after a reload", async () => {
  const gh = fakeGitHub(); // GitHub is slow: the run stays queued and no answer comes
  const storage = memoryStorage();
  let t = 1_700_000_000_000;
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: gh.fetch, storage, sleep: async (ms) => (t += ms), now: () => t }), /No answer after 6 minutes/);
  const id = storage.getItem(PENDING);
  assert.ok(isRequestId(id), "kept for a reload");
  assert.equal(pendingRequest(storage, t), id);
  assert.equal(pendingRequest(storage, t + 2 * 86_400_000), null, "a day later it is dropped");
  assert.equal(storage.getItem(PENDING), null);
});

test("a cancelled wait stops with an AbortError", async () => {
  const gh = fakeGitHub();
  const ac = new AbortController();
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: gh.fetch, storage: memoryStorage(), signal: ac.signal, sleep: async () => ac.abort() }), (e) => e.name === "AbortError");
});

test("resumePending picks up an answer after a reload, and returns null when nothing is pending", async () => {
  const gh = fakeGitHub();
  const storage = memoryStorage();
  assert.equal(await resumePending({ settings: SETTINGS, fetch: gh.fetch, storage }), null);
  const id = newRequestId();
  gh.runs.push({ id: 1, display_title: `Empathy Diary ${id}`, status: "completed", conclusion: "success" });
  gh.files[`res-${id}.enc`] = await encryptJson({ id, ok: true, result: GOOD }, SETTINGS.passphrase);
  storage.setItem(PENDING, id);
  const result = await resumePending({ settings: SETTINGS, fetch: gh.fetch, storage, sleep: noSleep });
  assert.equal(result.primary_emotion, "joy");
  assert.deepEqual(Object.keys(gh.files), []);
  assert.equal(storage.getItem(PENDING), null);
});

test("a wrong passphrase on the page stops at once with a plain message", async () => {
  let gh;
  gh = fakeGitHub({
    onDispatch: async (id, run) => {
      gh.files[`res-${id}.enc`] = await encryptJson({ id, ok: true, result: GOOD }, "some other passphrase");
      run.status = "completed";
    },
  });
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep }), /passphrase is wrong/);
});

test("the job refuses bad IDs, missing requests, wrong passphrase and wrong types without leaking", async () => {
  const gh = fakeGitHub();
  const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
  const claude = fakeClaude();
  assert.match((await runRequest({ id: "../etc", passphrase: "x", gist, claude, log: () => {} })).message, /format/);
  assert.match((await runRequest({ id: newRequestId(), passphrase: "x", gist, claude, log: () => {} })).message, /isn't in the Gist/);
  const id = newRequestId();
  gh.files[`req-${id}.enc`] = await encryptJson({ type: "reflect", text: "hello there" }, "another passphrase");
  assert.match((await runRequest({ id, passphrase: SETTINGS.passphrase, gist, claude, log: () => {} })).message, /passphrase is wrong/);
  const id2 = newRequestId();
  gh.files[`req-${id2}.enc`] = await encryptJson({ type: "recognize", image: "x" }, SETTINGS.passphrase);
  assert.match((await runRequest({ id: id2, passphrase: SETTINGS.passphrase, gist, claude, log: () => {} })).message, /Unknown request/);
  assert.equal(claude.calls.length, 0, "Claude isn't called (or paid) for an unreadable or invalid request");
  assert.deepEqual(missingSettings({ REQUEST_ID: "x" }), ["ANTHROPIC_API_KEY", "FC_PASSPHRASE", "FC_GIST_ID", "FC_GIST_TOKEN"]);
  assert.deepEqual(missingSettings({ ANTHROPIC_API_KEY: "a", FC_PASSPHRASE: "b", FC_GIST_ID: "c", FC_GIST_TOKEN: "d", REQUEST_ID: "e" }), []);
});

test("an unexpected error in the job is answered with a generic message, not its details", async () => {
  const gh = fakeGitHub();
  const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
  const id = newRequestId();
  gh.files[`req-${id}.enc`] = await encryptJson({ type: "reflect", text: "hello there" }, SETTINGS.passphrase);
  const r = await runRequest({ id, passphrase: SETTINGS.passphrase, gist, claude: fakeClaude({ fail: new Error("secret sk-ant-abc leaked") }), log: () => {} });
  assert.equal(r.ok, false);
  assert.ok(!r.message.includes("sk-ant"));
  const answer = await decryptJson(gh.files[`res-${id}.enc`], SETTINGS.passphrase);
  assert.deepEqual(answer.error, "Something went wrong in the GitHub job.");
  assert.ok(!(`req-${id}.enc` in gh.files), "the request is deleted");
});

test("the job deletes stale mailbox files (also FridgeChef's) but nothing else", async () => {
  const now = Date.UTC(2026, 10, 20);
  const gh = fakeGitHub();
  const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
  const old = newRequestId(now - 2 * 86_400_000);
  const id = newRequestId(now);
  gh.files[`res-${old}.enc`] = "x";
  gh.files["notes.txt"] = "keep";
  gh.files["req-not-an-id.enc"] = "keep";
  gh.files[`req-${id}.enc`] = await encryptJson({ type: "reflect", text: "hello there" }, SETTINGS.passphrase);
  await runRequest({ id, passphrase: SETTINGS.passphrase, gist, claude: fakeClaude(), now: () => now, log: () => {} });
  assert.deepEqual(Object.keys(gh.files).sort(), ["notes.txt", `res-${id}.enc`, "req-not-an-id.enc"].sort());
});

test("the workflow passes the request ID through env only and keeps secrets in the last step", async () => {
  const yml = await readFile(new URL("../../.github/workflows/empathy-diary.yml", import.meta.url), "utf8");
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /run-name: Empathy Diary \$\{\{ inputs\.request_id \}\}/);
  assert.doesNotMatch(yml, /schedule:/);
  assert.match(yml, /permissions:\s*\n\s*contents: read/);
  assert.match(yml, /timeout-minutes:/);
  assert.match(yml, /sparse-checkout: Study-05/);
  assert.match(yml, /npm ci --omit=dev --ignore-scripts/);
  for (const line of yml.split("\n").filter((l) => /^\s*(-\s*)?run:/.test(l))) assert.doesNotMatch(line, /\$\{\{/, `no expressions in run lines: ${line}`);
  for (const s of ["ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID", "FC_PASSPHRASE", "FC_GIST_ID", "FC_GIST_TOKEN"]) assert.match(yml, new RegExp(`${s}: \\$\\{\\{ secrets\\.${s} \\}\\}`));
  const step = yml.slice(yml.indexOf("- name: Answer the request"));
  assert.equal((yml.match(/secrets\./g) ?? []).length, (step.match(/secrets\./g) ?? []).length, "every secret is in the last step");
  assert.match(step, /node ci\/run-request\.mjs/);
  for (const u of [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])) assert.match(u, /@[0-9a-f]{40}$/, `${u} is pinned to a commit`);
});

test("no browser-side file holds a provider key or calls Anthropic", async () => {
  for (const f of ["../web/github-mode.mjs", "../web/mailbox.mjs", "../web/fc-crypto.mjs"]) {
    const src = await readFile(new URL(f, import.meta.url), "utf8");
    assert.ok(!/api\.anthropic\.com|x-api-key|dangerous-direct|sk-ant-|ANTHROPIC/.test(src), f);
  }
});

/* ---------- cancel, abort, cleanup, limits ---------- */

const reqFiles = (gh) => Object.keys(gh.files).filter((n) => n.startsWith("req-"));
const NOW0 = 1_700_000_000_000;

test("cancelPending forgets the pending ID and deletes the request from the Gist; never throws", async () => {
  const gh = fakeGitHub();
  const storage = memoryStorage();
  let t = NOW0;
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: gh.fetch, storage, sleep: async (ms) => (t += ms), now: () => t }), /No answer after 6 minutes/);
  assert.equal(reqFiles(gh).length, 1, "kept after the timeout so it can be resumed");
  await cancelPending({ settings: SETTINGS, fetch: gh.fetch, storage });
  assert.equal(storage.getItem(PENDING), null);
  assert.deepEqual(reqFiles(gh), []);
  assert.equal(await resumePending({ settings: SETTINGS, fetch: gh.fetch, storage }), null, "not resumed after a reload");
});

test("cancelPending: deleteRequest false keeps the file, errors are swallowed, clearPending is sync", async () => {
  const gh = fakeGitHub();
  const storage = memoryStorage();
  let t = NOW0;
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: gh.fetch, storage, sleep: async (ms) => (t += ms), now: () => t }), /No answer/);
  const id = storage.getItem(PENDING);
  await cancelPending({ deleteRequest: false, settings: SETTINGS, fetch: gh.fetch, storage });
  assert.equal(storage.getItem(PENDING), null);
  assert.equal(reqFiles(gh).length, 1);
  storage.setItem(PENDING, id);
  await cancelPending({ settings: SETTINGS, storage, fetch: async () => { throw new Error("offline"); } }); // must not throw
  assert.equal(storage.getItem(PENDING), null);
  storage.setItem(PENDING, id);
  assert.equal(clearPending(storage), undefined);
  assert.equal(storage.getItem(PENDING), null);
  await cancelPending({ settings: {}, storage: throwingStorage(), fetch: gh.fetch }); // blocked storage, bad settings: still no throw
  await cancelPending({ settings: SETTINGS, storage, fetch: gh.fetch }); // nothing pending
});

test("abort stops all polling at once: no fetch starts after the abort", async () => {
  for (const when of ["during-sleep", "during-fetch"]) {
    const gh = fakeGitHub();
    const ac = new AbortController();
    let after = 0;
    let aborted = false;
    const fetch = async (url, init) => {
      if (aborted) after++;
      const r = await gh.fetch(url, init);
      if (when === "during-fetch" && !aborted && url.includes("/runs") && gh.seen.length > 4) {
        aborted = true;
        ac.abort();
      }
      return r;
    };
    const sleep = async () => {
      if (when === "during-sleep" && !aborted && gh.seen.length > 4) {
        aborted = true;
        ac.abort();
      }
    };
    await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch, storage: memoryStorage(), signal: ac.signal, sleep }), (e) => e.name === "AbortError");
    assert.ok(aborted);
    assert.equal(after, 0, `${when}: fetches after abort`);
  }
  // an already-aborted signal makes no request at all
  const ac = new AbortController();
  ac.abort();
  let calls = 0;
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: async () => { calls++; return {}; }, storage: memoryStorage(), signal: ac.signal }), (e) => e.name === "AbortError");
  assert.equal(calls, 0);
  // resumePending too
  const gh = fakeGitHub();
  const storage = memoryStorage();
  storage.setItem(PENDING, newRequestId());
  const ac2 = new AbortController();
  ac2.abort();
  gh.seen.length = 0;
  await assert.rejects(resumePending({ settings: SETTINGS, fetch: gh.fetch, storage, signal: ac2.signal }), (e) => e.name === "AbortError");
  assert.equal(gh.seen.length, 0);
});

test("failed runs delete the encrypted request from the Gist", async () => {
  // job failed without an answer
  let gh = fakeGitHub({ onDispatch: (_id, run) => Object.assign(run, { status: "completed", conclusion: "failure" }) });
  let storage = memoryStorage();
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: gh.fetch, storage, sleep: noSleep }), /failed without an answer/);
  assert.deepEqual(reqFiles(gh), []);
  assert.equal(storage.getItem(PENDING), null);
  // dispatch failed
  gh = fakeGitHub({ dispatchStatus: 403 });
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep }), /run token/);
  assert.deepEqual(reqFiles(gh), []);
  // GitHub lists no run at all
  gh = fakeGitHub();
  gh.runs.length = 0;
  let t = NOW0;
  const orig = gh.fetch;
  const noRuns = async (url, init) => (init?.method === "POST" && url.includes("/dispatches") ? { ok: true, status: 204, json: async () => ({}) } : orig(url, init));
  storage = memoryStorage();
  await assert.rejects(reflectViaGitHub({ text: "hello there", settings: SETTINGS, fetch: noRuns, storage, sleep: async (ms) => (t += ms), now: () => t }), /no job for this request/);
  assert.deepEqual(reqFiles(gh), []);
});

test("the page refuses entries over the diary's 300 characters before touching the network", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return {}; };
  await assert.rejects(reflectViaGitHub({ text: "x".repeat(301), settings: SETTINGS, fetch, storage: memoryStorage() }), /bit long.*300 characters or fewer/);
  assert.equal(calls, 0);
  globalThis.DiaryCore = { MAX_CHARS: 50 };
  try {
    await assert.rejects(reflectViaGitHub({ text: "x".repeat(51), settings: SETTINGS, fetch, storage: memoryStorage() }), /50 characters or fewer/);
  } finally {
    delete globalThis.DiaryCore;
  }
  assert.equal(calls, 0);
});

test("workflow: one run per request ID at a time, and a re-dispatched, already answered ID never calls Claude", async () => {
  const wf = await readFile(new URL("../../.github/workflows/empathy-diary.yml", import.meta.url), "utf8");
  assert.match(wf, /concurrency:\s*\n\s+group: empathy-diary-\$\{\{ inputs\.request_id \}\}\s*\n\s+cancel-in-progress: false/);
  const gh = fakeGitHub();
  const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
  const claude = fakeClaude();
  const id = newRequestId();
  gh.files[`req-${id}.enc`] = await encryptJson({ type: "reflect", text: "hello there" }, SETTINGS.passphrase);
  assert.equal((await runRequest({ id, passphrase: SETTINGS.passphrase, gist, claude, log: () => {} })).ok, true);
  assert.equal(claude.calls.length, 1);
  assert.equal(reqFiles(gh).length, 0, "request removed when answered");
  const again = await runRequest({ id, passphrase: SETTINGS.passphrase, gist, claude, log: () => {} });
  assert.equal(again.ok, false);
  assert.match(again.message, /isn't in the Gist/);
  assert.equal(claude.calls.length, 1, "no second Claude call");
});
