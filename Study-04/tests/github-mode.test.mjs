// GitHub mode end to end, with a fake GitHub (Gist + Actions) and a fake
// Claude: page → encrypted Gist request → workflow dispatch → job → encrypted
// answer → page. No network, no API calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { decryptJson, encryptJson } from "../public/fc-crypto.js";
import { createGistClient, isRequestId, newRequestId, staleFiles } from "../public/mailbox.js";
import { askGitHub, settingsProblems, waitForAnswer } from "../public/remote.js";
import { parseRecipe } from "../public/recipe.js";
import { fitSize } from "../public/photo.js";
import { missingSettings, runRequest } from "../ci/run-request.mjs";
import { analyzeFridge, checkImage } from "../server/fridgechef.mjs";

const GIST_ID = "f".repeat(32);
const SETTINGS = { gistId: GIST_ID, gistToken: "ghp_" + "a".repeat(36), runToken: "github_pat_" + "b".repeat(40), passphrase: "correct horse battery" };
const IMAGE = { base64: "iVBORw0KGgoAAAANSUhEUg==", mediaType: "image/jpeg" };

function fakeClaude({ ingredients = [{ name: "eggs", quantity: "4", confidence: "high" }, { name: "jar", quantity: "1", confidence: "low" }], fail } = {}) {
  const calls = [];
  return {
    calls,
    async identifyIngredients(image) {
      calls.push(["identify", image]);
      if (fail) throw fail;
      return { ingredients, notes: "", model: "claude-sonnet-5-5", cost: 0.006 };
    },
    async writeRecipe(list) {
      calls.push(["recipe", list]);
      return { text: "Omelette\nIngredients:\n- 4 eggs\nSteps:\n1. Whisk.\nTime: 5 minutes", cost: 0.004 };
    },
  };
}

/** An in-memory GitHub: one Gist and the Actions endpoints. `onDispatch(id)` plays the job. */
function fakeGitHub({ onDispatch = () => {}, dispatchStatus = 204 } = {}) {
  const files = {};
  const runs = [];
  const seen = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    seen.push({ url, method, auth: init.headers?.Authorization });
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url === `https://api.github.com/gists/${GIST_ID}`) {
      if (init.headers?.Authorization !== `Bearer ${SETTINGS.gistToken}`) return json(401, {});
      if (method === "PATCH") {
        for (const [name, v] of Object.entries(JSON.parse(init.body).files)) {
          if (v === null) delete files[name];
          else files[name] = v.content;
        }
        return json(200, {});
      }
      return json(200, { files: Object.fromEntries(Object.entries(files).map(([n, c]) => [n, { content: c, truncated: false }])) });
    }
    if (url.includes("/actions/")) {
      if (init.headers?.Authorization !== `Bearer ${SETTINGS.runToken}`) return json(401, {});
      if (method === "POST" && url.endsWith("/workflows/fridgechef.yml/dispatches")) {
        if (dispatchStatus !== 204) return json(dispatchStatus, {});
        const { ref, inputs } = JSON.parse(init.body);
        assert.equal(ref, "main");
        runs.unshift({ display_title: `FridgeChef ${inputs.request_id}`, status: "queued", html_url: "https://github.com/aufisn/VibeCoding/actions/runs/1" });
        await onDispatch(inputs.request_id, runs[0]);
        return { ok: true, status: 204, json: async () => ({}) };
      }
      if (url.includes("/workflows/fridgechef.yml/runs")) return json(200, { workflow_runs: runs });
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

test("full GitHub round trip: the page sends, the job answers, the page shows and cleans up", async () => {
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
  const answer = await askGitHub({ settings: SETTINGS, image: IMAGE, fetch: gh.fetch, storage, onStage: (s) => stages.push(s), sleep: noSleep });

  assert.equal(answer.ok, true);
  assert.deepEqual(answer.ingredients.map((i) => i.name), ["eggs", "jar"]);
  assert.match(answer.recipe, /^Omelette/);
  assert.equal(answer.cost, 0.01);
  assert.deepEqual(claude.calls[0][1], IMAGE, "the job got the exact photo");
  assert.deepEqual(claude.calls[1][1], ["eggs"], "low-confidence finds stay out of the recipe");
  assert.deepEqual(Object.keys(gh.files), [], "request and answer are both deleted");
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
  await assert.rejects(askGitHub({ settings: SETTINGS, image: IMAGE, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep }), /run token.*isn't allowed/i);
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
  const answer = await askGitHub({ settings: SETTINGS, image: IMAGE, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep });
  assert.equal(answer.ok, false);
  assert.equal(answer.error, "Claude declined this request.");
});

test("a job that fails without answering is reported with a link to its log", async () => {
  const gh = fakeGitHub({ onDispatch: (_id, run) => Object.assign(run, { status: "completed", conclusion: "failure" }) });
  await assert.rejects(askGitHub({ settings: SETTINGS, image: IMAGE, fetch: gh.fetch, storage: memoryStorage(), sleep: noSleep }), (err) => {
    assert.match(err.message, /failed without an answer/);
    assert.equal(err.link, "https://github.com/aufisn/VibeCoding/actions/runs/1");
    return true;
  });
});

test("waiting gives up after the timeout, keeping the request to pick up later", async () => {
  const gh = fakeGitHub();
  const storage = memoryStorage();
  let t = 0;
  await assert.rejects(waitForAnswer({ settings: SETTINGS, id: newRequestId(0), fetch: gh.fetch, storage, sleep: async () => (t += 5000), now: () => t }), /No answer after 6 minutes/);
});

test("the job refuses bad IDs, missing requests and a wrong passphrase without leaking", async () => {
  const gh = fakeGitHub();
  const gist = createGistClient({ token: SETTINGS.gistToken, gistId: GIST_ID, fetch: gh.fetch });
  const claude = fakeClaude();
  assert.match((await runRequest({ id: "../etc", passphrase: "x", gist, claude, log: () => {} })).message, /format/);
  assert.match((await runRequest({ id: newRequestId(), passphrase: "x", gist, claude, log: () => {} })).message, /isn't in the Gist/);
  const id = newRequestId();
  gh.files[`req-${id}.enc`] = await encryptJson({ image: IMAGE }, "another passphrase");
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

test("settings checks, recipe parsing, photo sizing and photo checks", async () => {
  assert.deepEqual(settingsProblems(SETTINGS), []);
  assert.equal(settingsProblems({ gistId: "x", gistToken: "", runToken: "ghp_x", passphrase: "short" }).length, 4);

  const blocks = parseRecipe("**Spinach Omelet**\n\nIngredients:\n- 3 eggs\n- **1 cup** spinach\nSteps:\n1. Whisk.\n2) Cook.\nTime: 12 minutes");
  assert.deepEqual(blocks, [
    { type: "title", text: "Spinach Omelet" },
    { type: "heading", text: "Ingredients" },
    { type: "bullets", items: ["3 eggs", "1 cup spinach"] },
    { type: "heading", text: "Steps" },
    { type: "steps", items: ["Whisk.", "Cook."] },
    { type: "para", text: "Time: 12 minutes" },
  ]);

  assert.deepEqual(fitSize(4032, 3024), { width: 1568, height: 1176 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });

  assert.throws(() => checkImage({ base64: "abc", mediaType: "image/bmp" }), /Unsupported/);
  assert.throws(() => checkImage({ base64: "<script>", mediaType: "image/png" }), /damaged/);
  const none = await analyzeFridge(fakeClaude({ ingredients: [{ name: "?", quantity: "", confidence: "low" }] }), IMAGE);
  assert.equal(none.recipe, "", "no recipe from guesses alone");
});

test("the workflow passes the request ID through env only and keeps secrets out of run lines", async () => {
  const yml = await readFile(new URL("../../.github/workflows/fridgechef.yml", import.meta.url), "utf8");
  assert.match(yml, /workflow_dispatch:/);
  assert.doesNotMatch(yml, /schedule:/, "no schedule: it only runs when you ask");
  assert.match(yml, /permissions:\s*\n\s*contents: read/);
  for (const line of yml.split("\n").filter((l) => /^\s*(-\s*)?run:/.test(l))) assert.doesNotMatch(line, /\$\{\{/, `no expressions in run lines: ${line}`);
  for (const s of ["ANTHROPIC_API_KEY", "FC_PASSPHRASE", "FC_GIST_ID", "FC_GIST_TOKEN"]) assert.match(yml, new RegExp(`${s}: \\$\\{\\{ secrets\\.${s} \\}\\}`));
});
