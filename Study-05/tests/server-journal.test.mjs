// The local server's journal: /api/reflect saving, the /api/journal routes, and the .env settings.
// Fake Claude and a fake Gist only: no network, no paid calls.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import { createServer } from "../server.mjs";
import { journalFromEnv, localizeError, notConfiguredMessage } from "../server-journal.mjs";
import { createGistClient } from "../web/mailbox.mjs";
import { createJournal, JournalError } from "../web/journal.mjs";
import { decryptJson } from "../web/fc-crypto.mjs";
import { createFakeGist, GIST_ID, GIST_TOKEN, GOOD_RESULT, makeEntry } from "./helpers/fake-gist.mjs";

const PASS = "correct horse battery";
const CLOCK = Date.UTC(2026, 10, 22, 9, 30);
const claude = { async reflect() { return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(GOOD_RESULT) }], usage: { input_tokens: 500, output_tokens: 100 } }; } };
const journalOn = (fake) => createJournal({ gist: createGistClient({ token: GIST_TOKEN, gistId: GIST_ID, fetch: fake.fetch }), passphrase: PASS, sleep: async () => {} });

let fake, server, base, clock = CLOCK, unconfigured, ubase;
before(async () => {
  fake = createFakeGist();
  server = createServer({ claude, journal: journalOn(fake), now: () => clock, baseDir: "/nonexistent-dir" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  unconfigured = createServer({ claude, journal: null, journalMissing: ["FC_GIST_TOKEN", "FC_PASSPHRASE"], now: () => clock, baseDir: "/nonexistent-dir" });
  await new Promise((r) => unconfigured.listen(0, "127.0.0.1", r));
  ubase = `http://127.0.0.1:${unconfigured.address().port}`;
});
after(() => { server.close(); unconfigured.close(); });

const J = { "content-type": "application/json", "x-diary": "1" };
const post = (path, body, headers = {}, b = base) => fetch(b + path, { method: "POST", headers: { ...J, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (path, headers, b = base) => fetch(b + path, { headers: headers ?? { "x-diary": "1" } });

test("reflect saves to the journal and returns saved + entryId (the reply is unchanged)", async () => {
  const r = await post("/api/reflect", { text: "Zebra picnic by the lake today" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.primary_emotion, "joy");
  assert.equal(j.saved, true);
  assert.match(j.entryId, /^[0-9a-z]+-[0-9a-f]{8}$/);
  assert.equal(j.entry.id, j.entryId, "the full entry comes back when saved too");
  assert.equal(j.entry.text, "Zebra picnic by the lake today");
  assert.equal("saveError" in j, false);
  const stored = Object.values(fake.files).join("");
  assert.ok(!stored.includes("Zebra") && !stored.includes("lovely"), "only ciphertext in the Gist");
  const data = await decryptJson(fake.files["journal-2026-11.enc"], PASS);
  assert.equal(data.entries[0].id, j.entryId);
  assert.equal(data.entries[0].mode, "local");
  assert.equal(data.entries[0].text, "Zebra picnic by the lake today");
  assert.equal(data.entries[0].createdAt, "2026-11-22T09:30:00.000Z");
});

test("reflect without a configured journal still replies: saved false, a plain reason, and the entry to retry", async () => {
  const r = await post("/api/reflect", { text: "A day without a journal" }, {}, ubase);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.empathy, "That sounds lovely.");
  assert.equal(j.saved, false);
  assert.equal(j.saveError, "Your Journal isn't connected on this computer: add FC_GIST_TOKEN and FC_PASSPHRASE to Study-05/.env, then restart the server.");
  assert.equal(j.entry.id, j.entryId);
  assert.equal(j.entry.text, "A day without a journal");
  const st = await (await get("/api/status", undefined, ubase)).json();
  assert.equal(st.journalConfigured, false);
  assert.deepEqual(st.journalMissing, ["FC_GIST_TOKEN", "FC_PASSPHRASE"]);
  const ok = await (await get("/api/status")).json();
  assert.equal(ok.journalConfigured, true);
  assert.deepEqual(ok.journalMissing, []);
});

test("reflect with an unreachable Gist still replies with saved false, then 'retry' saves the same entry once", async () => {
  fake.failPatch = 500;
  const r = await post("/api/reflect", { text: "The Gist is down today" });
  fake.failPatch = 0;
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.saved, false);
  assert.match(j.saveError, /Could not reach your journal/);
  assert.ok(!j.saveError.includes(GIST_TOKEN) && !j.saveError.includes(PASS));
  const retry = await post("/api/journal/retry", { entry: j.entry });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { saved: true, entryId: j.entryId, duplicate: false });
  assert.deepEqual(await (await post("/api/journal/retry", { entry: j.entry })).json(), { saved: true, entryId: j.entryId, duplicate: true });
});

test("retry validates the entry", async () => {
  for (const body of [{}, { entry: "x" }, { entry: { id: "x" } }, { entry: { ...makeEntry(), createdAt: "never" } }, { entry: { ...makeEntry(), mode: "web" } }]) {
    const r = await post("/api/journal/retry", body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 50));
    assert.match((await r.json()).error, /can't be saved/);
  }
});

test("GET /api/journal, ?month and /months", async () => {
  await post("/api/journal/retry", { entry: makeEntry({ id: "oct-entry-0001", createdAt: "2026-10-05T10:00:00Z" }) });
  const all = await (await get("/api/journal")).json();
  assert.equal(all.configured, true);
  assert.ok(all.entries.length >= 3);
  assert.deepEqual(all.entries.map((e) => e.createdAt), [...all.entries.map((e) => e.createdAt)].sort().reverse());
  assert.ok(all.entries.every((e) => typeof e.hidden === "boolean"));
  assert.ok(all.months.some((m) => m.month === "2026-10") && Array.isArray(all.problems));
  const oct = await (await get("/api/journal?month=2026-10")).json();
  assert.deepEqual(oct.entries.map((e) => e.id), ["oct-entry-0001"]);
  assert.equal((await get("/api/journal?month=2026-13")).status, 400);
  const months = await (await get("/api/journal/months")).json();
  assert.deepEqual(months.months.map((m) => m.month), ["2026-11", "2026-10"]);
  const r = await get("/api/journal");
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("hide and unhide", async () => {
  const h = await post("/api/journal/hide", { id: "oct-entry-0001" });
  assert.deepEqual(await h.json(), { ok: true, changed: true });
  assert.equal((await (await get("/api/journal?month=2026-10")).json()).entries[0].hidden, true);
  assert.deepEqual(await (await post("/api/journal/unhide", { id: "oct-entry-0001" })).json(), { ok: true, changed: true });
  assert.equal((await (await get("/api/journal?month=2026-10")).json()).entries[0].hidden, false);
  const missing = await post("/api/journal/hide", { id: "does-not-exist" });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "notfound");
  assert.equal((await post("/api/journal/hide", { id: 5 })).status, 400);
  assert.equal((await post("/api/journal/hide", {})).status, 400);
  assert.equal((await post("/api/journal/hide", { id: "bad id!" })).status, 400);
});

test("import: counts, no duplicates on a second import, limits", async () => {
  const old = (i) => ({ id: `old${i}`, ts: Date.UTC(2026, 8, i), text: `Old day ${i}`, result: GOOD_RESULT });
  const entries = [old(1), old(2), { id: "broken" }];
  assert.deepEqual(await (await post("/api/journal/import", { entries })).json(), { ok: true, added: 2, skipped: 0, invalid: 1, addedIds: ["old1", "old2"], skippedIds: [], invalidIds: ["broken"], duplicateIds: [], invalidIndexes: [2] });
  assert.deepEqual(await (await post("/api/journal/import", { entries })).json(), { ok: true, added: 0, skipped: 2, invalid: 1, addedIds: [], skippedIds: ["old1", "old2"], invalidIds: ["broken"], duplicateIds: [], invalidIndexes: [2] });
  assert.equal((await post("/api/journal/import", { entries: "nope" })).status, 400);
  assert.equal((await post("/api/journal/import", { entries: new Array(501).fill(old(1)) })).status, 400);
  const big = await post("/api/journal/import", { entries: [old(3)], pad: "x".repeat(1_100_000) }).catch(() => null);
  if (big) assert.equal(big.status, 413);
  const ok = await post("/api/journal/import", { entries: [old(3)], pad: "x".repeat(200_000) });
  assert.equal(ok.status, 200, "a few hundred KB is fine for an import");
});

test("export: md and txt, hidden excluded unless hidden=1, as a download", async () => {
  await post("/api/journal/retry", { entry: makeEntry({ id: "sec-entry-0001", text: "My secret hidden thought", createdAt: "2026-11-23T09:00:00Z" }) });
  await post("/api/journal/hide", { id: "sec-entry-0001" });
  const md = await get("/api/journal/export?format=md&hidden=0");
  assert.equal(md.status, 200);
  assert.match(md.headers.get("content-type"), /^text\/markdown; charset=utf-8/);
  assert.match(md.headers.get("content-disposition"), /^attachment; filename="empathy-journal-2026-11-22\.md"$/);
  assert.equal(md.headers.get("cache-control"), "no-store");
  const mdText = await md.text();
  assert.match(mdText, /^# My Empathy Diary journal/);
  assert.ok(!mdText.includes("secret hidden thought"));
  assert.ok((await (await get("/api/journal/export?format=md&hidden=1")).text()).includes("secret hidden thought"));
  const txt = await get("/api/journal/export?format=txt");
  assert.match(txt.headers.get("content-type"), /^text\/plain/);
  assert.match(txt.headers.get("content-disposition"), /\.txt"$/);
  assert.ok(!(await txt.text()).includes("secret hidden thought"));
  assert.equal((await get("/api/journal/export")).status, 200, "md is the default");
  assert.equal((await get("/api/journal/export?format=pdf")).status, 400);
  assert.equal((await get("/api/journal/export?hidden=yes")).status, 400);
});

test("delete-all needs the exact phrase", async () => {
  const before = Object.keys(fake.files).length;
  for (const confirm of ["", "delete my journal", "DELETE MY JOURNAL ", "DELETE", 7, null, undefined]) {
    const r = await post("/api/journal/delete-all", { confirm });
    assert.equal(r.status, 400, String(confirm));
    assert.equal((await r.json()).code, "confirm");
  }
  assert.equal((await post("/api/journal/delete-all", {})).status, 400);
  assert.equal(Object.keys(fake.files).length, before);
  fake.files["req-keep.enc"] = "other app's file";
  const r = await post("/api/journal/delete-all", { confirm: "DELETE MY JOURNAL" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(j.deleted >= 2);
  assert.deepEqual(Object.keys(fake.files), ["req-keep.enc"]);
  assert.deepEqual((await (await get("/api/journal")).json()).entries, []);
});

test("a wrong passphrase on the server is a 422 with a plain message, and nothing is overwritten", async () => {
  const f2 = createFakeGist();
  await journalOn(f2).append(makeEntry({ id: "mine-entry-0001" }));
  const wrong = createJournal({ gist: createGistClient({ token: GIST_TOKEN, gistId: GIST_ID, fetch: f2.fetch }), passphrase: "a different passphrase", sleep: async () => {} });
  const s = createServer({ claude, journal: wrong, now: () => clock, baseDir: "/nonexistent-dir" });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${s.address().port}`;
  const before = { ...f2.files };
  const r = await get("/api/journal", undefined, b);
  assert.equal(r.status, 422);
  assert.deepEqual(await r.json(), { error: "FC_PASSPHRASE in Study-05/.env can't open your journal (it must match the passphrase used on your phone). Fix it and restart the server.", code: "passphrase" });
  const reflect = await post("/api/reflect", { text: "Still works without saving" }, {}, b);
  const j = await reflect.json();
  assert.equal(reflect.status, 200);
  assert.equal(j.saved, false);
  assert.match(j.saveError, /^FC_PASSPHRASE in Study-05\/\.env/);
  assert.deepEqual(f2.files, before);
  s.close();
});

test("without journal settings every journal route says so plainly (503), after checking the request", async () => {
  for (const [method, path] of [["GET", "/api/journal"], ["GET", "/api/journal/months"], ["GET", "/api/journal/export"], ["POST", "/api/journal/hide"], ["POST", "/api/journal/retry"], ["POST", "/api/journal/import"], ["POST", "/api/journal/delete-all"]]) {
    const r = method === "GET" ? await get(path, undefined, ubase) : await post(path, {}, {}, ubase);
    assert.equal(r.status, 503, path);
    const j = await r.json();
    assert.equal(j.code, "not_configured");
    assert.equal(j.error, "Your Journal isn't connected on this computer: add FC_GIST_TOKEN and FC_PASSPHRASE to Study-05/.env, then restart the server.");
    assert.ok(!j.error.includes(", Add"));
  }
  assert.equal((await post("/api/journal/hide", "{bad", {}, ubase)).status, 400);
});

test("Origin, Host, method, content type and body size are checked on every journal route", async () => {
  const port = new URL(base).port;
  const routes = [["GET", "/api/journal"], ["GET", "/api/journal/months"], ["GET", "/api/journal/export"], ["POST", "/api/journal/hide"], ["POST", "/api/journal/unhide"], ["POST", "/api/journal/retry"], ["POST", "/api/journal/import"], ["POST", "/api/journal/delete-all"]];
  for (const [method, path] of routes) {
    clock += 11 * 60 * 1000; // a fresh rate-limit window for each route
    for (const origin of ["https://evil.example", "null", "https://aufisn.github.io"]) {
      const r = await fetch(base + path, { method, headers: { ...J, origin }, body: method === "POST" ? "{}" : undefined });
      assert.equal(r.status, 403, `${method} ${path} from ${origin}`);
    }
    const allowed = await fetch(base + path, { method, headers: { ...J, origin: `http://127.0.0.1:${port}` }, body: method === "POST" ? "{}" : undefined });
    assert.notEqual(allowed.status, 403);
    assert.equal(allowed.headers.get("access-control-allow-origin"), `http://127.0.0.1:${port}`);
    const wrongMethod = await fetch(base + path, { method: method === "GET" ? "POST" : "GET", headers: J, body: method === "GET" ? "{}" : undefined });
    assert.equal(wrongMethod.status, 405, `${method} ${path}`);
    const raw = await new Promise((resolve) => {
      const s = net.connect(Number(port), "127.0.0.1", () => s.write(`${method} ${path} HTTP/1.1\r\nHost: evil.example\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`));
      let d = ""; s.on("data", (c) => (d += c)); s.on("end", () => resolve(d.split(" ")[1]));
    });
    assert.equal(raw, "421", `Host check on ${path}`);
    if (method === "POST") {
      assert.equal((await post(path, "[1]")).status, 400, `array body ${path}`);
      assert.equal((await post(path, "{nope")).status, 400);
      const ct = await fetch(base + path, { method: "POST", headers: { "content-type": "text/plain", "x-diary": "1" }, body: "x" });
      assert.equal(ct.status, 415);
    }
  }
  clock += 11 * 60 * 1000;
  for (const path of ["/api/journal/hide", "/api/journal/unhide", "/api/journal/delete-all"]) {
    const r = await post(path, { id: "x", confirm: "x", pad: "x".repeat(5000) }).catch(() => null);
    if (r) assert.equal(r.status, 413, path);
  }
  const retry = await post("/api/journal/retry", { entry: makeEntry(), pad: "x".repeat(20_000) }).catch(() => null);
  if (retry) assert.equal(retry.status, 413);
});

test("journal routes have their own rate limit (60 per 10 minutes) that resets", async () => {
  const s = createServer({ claude, journal: journalOn(createFakeGist()), now: () => clock, baseDir: "/nonexistent-dir" });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${s.address().port}`;
  for (let i = 0; i < 60; i++) assert.equal((await get("/api/journal/months", undefined, b)).status, 200, `call ${i}`);
  const blocked = await get("/api/journal/months", undefined, b);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "600");
  const reflect = await post("/api/reflect", { text: "Reflect is not limited by journal calls" }, {}, b);
  assert.equal(reflect.status, 200, "the reflect limit is separate");
  clock += 11 * 60 * 1000;
  assert.equal((await get("/api/journal/months", undefined, b)).status, 200);
  s.close();
});

test("journalFromEnv: not configured, partly configured, bad values, configured - messages never repeat values", () => {
  const none = journalFromEnv({});
  assert.equal(none.journal, null);
  assert.equal(none.problem, "missing FC_GIST_ID, FC_GIST_TOKEN, FC_PASSPHRASE");
  assert.deepEqual(none.missing, ["FC_GIST_ID", "FC_GIST_TOKEN", "FC_PASSPHRASE"]);
  const partial = journalFromEnv({ FC_GIST_ID: GIST_ID });
  assert.equal(partial.journal, null);
  assert.match(partial.problem, /^missing FC_GIST_TOKEN, FC_PASSPHRASE$/);
  const short = journalFromEnv({ FC_GIST_ID: GIST_ID, FC_GIST_TOKEN: GIST_TOKEN, FC_PASSPHRASE: "short" });
  assert.equal(short.journal, null);
  assert.ok(!short.problem.includes("short") || /at least 12/.test(short.problem));
  const badId = journalFromEnv({ FC_GIST_ID: "../etc", FC_GIST_TOKEN: GIST_TOKEN, FC_PASSPHRASE: PASS });
  assert.equal(badId.journal, null);
  assert.ok(!badId.problem.includes(GIST_TOKEN) && !badId.problem.includes(PASS));
  const ok = journalFromEnv({ FC_GIST_ID: ` ${GIST_ID} `, FC_GIST_TOKEN: GIST_TOKEN, FC_PASSPHRASE: PASS }, { fetch: createFakeGist().fetch });
  assert.ok(ok.journal);
  assert.equal(ok.problem, "");
});

test("every journal request needs X-Diary: 1; without it it is 403 and does not use up the rate limit", async () => {
  const s = createServer({ claude, journal: journalOn(createFakeGist()), now: () => clock, baseDir: "/nonexistent-dir" });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${s.address().port}`;
  for (let i = 0; i < 100; i++) assert.equal((await fetch(b + "/api/journal/months")).status, 403);
  const r = await fetch(b + "/api/journal/months");
  assert.match((await r.json()).error, /X-Diary: 1/);
  assert.equal((await fetch(b + "/api/journal/months", { headers: { "x-diary": "yes" } })).status, 403);
  assert.equal((await fetch(b + "/api/journal/hide", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await get("/api/journal/months", { "x-diary": "1" }, b)).status, 200, "the limiter is untouched");
  const pre = await fetch(b + "/api/journal", { method: "OPTIONS" });
  assert.match(pre.headers.get("access-control-allow-headers"), /x-diary/);
  s.close();
});

test("GET /api/journal?latest=n reads only the newest months and lists them all in allMonths", async () => {
  const f = createFakeGist();
  const jn = journalOn(f);
  for (const m of ["2026-07", "2026-08", "2026-09", "2026-10"]) await jn.append(makeEntry({ id: `in-${m}-000001`, createdAt: `${m}-05T10:00:00Z` }));
  const s = createServer({ claude, journal: jn, now: () => clock, baseDir: "/nonexistent-dir" });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${s.address().port}`;
  const dflt = await (await get("/api/journal", undefined, b)).json();
  assert.deepEqual(dflt.months.map((m) => m.month), ["2026-10", "2026-09"]);
  assert.deepEqual(dflt.allMonths.map((m) => m.month), ["2026-10", "2026-09", "2026-08", "2026-07"]);
  assert.deepEqual(dflt.allMonths[0], { month: "2026-10", files: ["journal-2026-10.enc"] });
  assert.equal(dflt.entries.length, 2);
  assert.equal((await (await get("/api/journal?latest=3", undefined, b)).json()).entries.length, 3);
  assert.equal((await (await get("/api/journal?latest=all", undefined, b)).json()).entries.length, 4);
  const one = await (await get("/api/journal?month=2026-08", undefined, b)).json();
  assert.deepEqual(one.entries.map((e) => e.id), ["in-2026-08-000001"]);
  assert.equal(one.allMonths.length, 4);
  for (const bad of ["0", "-1", "x", "1000", "2.5"]) assert.equal((await get(`/api/journal?latest=${bad}`, undefined, b)).status, 400, bad);
  s.close();
});

test("local-mode wording names the .env entry to fix", async () => {
  assert.equal(localizeError(new JournalError("gist", "x", { gistStatus: 401 })).message.slice(0, 40), "FC_GIST_TOKEN in Study-05/.env was refus");
  assert.match(localizeError(new JournalError("gist", "x", { gistStatus: 404 })).message, /FC_GIST_ID in Study-05\/\.env/);
  assert.equal(localizeError(new JournalError("gist", "x", { gistStatus: 500 })).message, "x");
  const f = createFakeGist();
  const s = createServer({ claude, journal: createJournal({ gist: createGistClient({ token: "ghp_" + "b".repeat(36), gistId: GIST_ID, fetch: f.fetch }), passphrase: PASS }), now: () => clock, baseDir: "/nonexistent-dir" });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const r = await get("/api/journal", undefined, `http://127.0.0.1:${s.address().port}`);
  assert.equal(r.status, 502);
  const j = await r.json();
  assert.match(j.error, /^FC_GIST_TOKEN in Study-05\/\.env was refused by GitHub/);
  assert.ok(!j.error.includes("ghp_"));
  s.close();
});

test("notConfiguredMessage is built from the real missing names", () => {
  assert.equal(notConfiguredMessage(["FC_GIST_ID"]), "Your Journal isn't connected on this computer: add FC_GIST_ID to Study-05/.env, then restart the server.");
  assert.match(notConfiguredMessage([], "FC_PASSPHRASE should be at least 12 characters"), /^Your Journal isn't connected on this computer: FC_PASSPHRASE should be at least 12 characters\. Fix it in Study-05\/\.env/);
  assert.match(notConfiguredMessage(), /FC_GIST_ID, FC_GIST_TOKEN and FC_PASSPHRASE/);
});
