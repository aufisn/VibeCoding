// The encrypted journal against a fake Gist (ETag, truncation with raw_url, other writers). No network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createGistClient } from "../web/mailbox.mjs";
import { decryptJson, encryptJson } from "../web/fc-crypto.mjs";
import { createJournal, DELETE_PHRASE, fileName, JournalError, legacyToEntry, monthOf, newEntryId, parseFileName, validateEntry, validateMonthData, validateQuote } from "../web/journal.mjs";
import { createFakeGist, GIST_ID, GIST_TOKEN, GOOD_QUOTE, GOOD_RESULT, makeEntry, offlineFetch } from "./helpers/fake-gist.mjs";

const PASS = "correct horse battery";
const noSleep = async () => {};
const open = (fake, opts = {}) => createJournal({ gist: createGistClient({ token: GIST_TOKEN, gistId: GIST_ID, fetch: fake.fetch }), passphrase: PASS, sleep: noSleep, ...opts });
const journalFiles = (fake) => Object.keys(fake.files).filter((n) => n.startsWith("journal-"));

test("append writes an encrypted month file with no readable diary text, and readAll returns the entry", async () => {
  const fake = createFakeGist();
  const j = open(fake);
  const e = makeEntry({ text: "Zebra picnic by the lake", quote: GOOD_QUOTE });
  assert.deepEqual(await j.append(e), { saved: true, entryId: e.id, duplicate: false });
  assert.deepEqual(journalFiles(fake), ["journal-2026-11.enc"]);
  const stored = fake.files["journal-2026-11.enc"];
  for (const word of ["Zebra", "picnic", "lovely", "Persian", "example.org"]) assert.ok(!stored.includes(word), word);
  assert.deepEqual(Object.keys(JSON.parse(stored)), ["v", "kdf", "iter", "salt", "iv", "ct"]);
  const data = await decryptJson(stored, PASS);
  assert.equal(data.v, 1);
  assert.deepEqual(data.hidden, []);
  const all = await j.readAll();
  assert.equal(all.entries.length, 1);
  assert.equal(all.entries[0].text, "Zebra picnic by the lake");
  assert.equal(all.entries[0].hidden, false);
  assert.equal(all.entries[0].quote.url, "https://example.org/quote");
  assert.deepEqual(all.months, [{ month: "2026-11", files: ["journal-2026-11.enc"], entries: 1 }]);
  assert.deepEqual(all.problems, []);
});

test("append merges by id: a retry never duplicates and does not even write", async () => {
  const fake = createFakeGist();
  const j = open(fake);
  const e = makeEntry();
  await j.append(e);
  const patches = fake.calls.patch;
  assert.deepEqual(await j.append(e), { saved: true, entryId: e.id, duplicate: true });
  assert.equal(fake.calls.patch, patches);
  await j.append(makeEntry({ createdAt: "2026-11-23T08:00:00Z" }));
  assert.equal((await j.readAll()).entries.length, 2);
});

test("entries go to the month of their UTC date, newest first; listMonths and readMonth", async () => {
  const fake = createFakeGist();
  const j = open(fake);
  await j.append(makeEntry({ id: "oct-entry-0001", createdAt: "2026-10-31T23:30:00Z" }));
  await j.append(makeEntry({ id: "nov-entry-0001", createdAt: "2026-11-01T00:30:00Z" }));
  await j.append(makeEntry({ id: "nov-entry-0002", createdAt: "2026-11-02T00:30:00+02:00" })); // = Nov 1 22:30 UTC
  assert.deepEqual(journalFiles(fake).sort(), ["journal-2026-10.enc", "journal-2026-11.enc"]);
  assert.deepEqual(await j.listMonths(), [{ month: "2026-11", files: ["journal-2026-11.enc"] }, { month: "2026-10", files: ["journal-2026-10.enc"] }]);
  assert.deepEqual((await j.readAll()).entries.map((e) => e.id), ["nov-entry-0002", "nov-entry-0001", "oct-entry-0001"]);
  const nov = await j.readMonth("2026-11");
  assert.deepEqual(nov.entries.map((e) => e.id).sort(), ["nov-entry-0001", "nov-entry-0002"]);
  await assert.rejects(j.readMonth("../x"), (e) => e.code === "invalid");
  assert.equal(monthOf("2026-12-31T23:59:59Z"), "2026-12");
});

test("a month over the size limit rolls over to -2, -3 and everything is still read", async () => {
  const fake = createFakeGist();
  const j = open(fake, { maxFileBytes: 2000 });
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const e = makeEntry({ id: `roll-entry-${i}`, createdAt: `2026-11-0${i + 1}T10:00:00Z`, text: "x".repeat(100) + i });
    ids.push(e.id);
    await j.append(e);
  }
  const names = journalFiles(fake).sort();
  assert.ok(names.length >= 3, names.join());
  assert.ok(names.includes("journal-2026-11.enc") && names.includes("journal-2026-11-2.enc"));
  for (const n of names) assert.ok(parseFileName(n), n);
  const all = await j.readAll();
  assert.deepEqual(all.entries.map((e) => e.id).sort(), [...ids].sort());
  assert.equal(all.months.length, 1);
  assert.deepEqual(await j.listMonths(), [{ month: "2026-11", files: names }]);
  // retrying an entry that lives in an older part does not duplicate it
  assert.equal((await j.append(makeEntry({ id: "roll-entry-0", createdAt: "2026-11-01T10:00:00Z" }))).duplicate, true);
  assert.equal(fileName("2026-11", 1), "journal-2026-11.enc");
  assert.equal(fileName("2026-11", 3), "journal-2026-11-3.enc");
});

test("big files come back truncated from the Gist API and are read from raw_url", async () => {
  const fake = createFakeGist({ truncateAbove: 500 });
  const j = open(fake);
  await j.append(makeEntry({ id: "big-entry-0001" }));
  assert.ok(fake.files["journal-2026-11.enc"].length > 500);
  const all = await j.readAll();
  assert.equal(all.entries.length, 1);
  assert.ok(fake.calls.raw > 0, "the full text came from raw_url");
});

test("another writer slips in before our write: we notice, re-read, merge, and lose nothing", async () => {
  const fake = createFakeGist();
  const a = open(fake);
  const b = open(fake);
  await a.append(makeEntry({ id: "base-entry-0001" }));
  let slipped = false;
  fake.onCommits = async (n) => {
    // the version is asked for before the read and again right before the write
    if (!slipped && n % 2 === 0) {
      slipped = true;
      fake.onCommits = null;
      await b.append(makeEntry({ id: "from-phone-0001", createdAt: "2026-11-22T11:00:00Z", mode: "github" }));
    }
  };
  await a.append(makeEntry({ id: "from-laptop-0001", createdAt: "2026-11-22T12:00:00Z" }));
  assert.equal(slipped, true);
  assert.deepEqual((await a.readAll()).entries.map((e) => e.id).sort(), ["base-entry-0001", "from-laptop-0001", "from-phone-0001"]);
});

test("read-back verify: a stale writer overwrites our write, so we retry with jitter and it ends up saved", async () => {
  const fake = createFakeGist();
  const j0 = open(fake);
  await j0.append(makeEntry({ id: "base-entry-0001" }));
  const before = fake.files["journal-2026-11.enc"];
  const sleeps = [];
  const j = open(fake, { sleep: async (ms) => sleeps.push(ms), random: () => 0.5 });
  let clobbers = 1;
  fake.afterPatch = async () => {
    if (clobbers-- > 0) fake.files["journal-2026-11.enc"] = before; // someone wrote the old file back
  };
  assert.equal((await j.append(makeEntry({ id: "new-entry-00001" }))).saved, true);
  assert.deepEqual(sleeps, [1250]);
  assert.deepEqual((await j.readAll()).entries.map((e) => e.id).sort(), ["base-entry-0001", "new-entry-00001"]);
});

test("after 4 failed read-backs the append reports a plain 'conflict' and stops", async () => {
  const fake = createFakeGist();
  const sleeps = [];
  const j = open(fake, { sleep: async (ms) => sleeps.push(ms) });
  fake.afterPatch = async () => {
    for (const n of journalFiles(fake)) delete fake.files[n];
  };
  await assert.rejects(j.append(makeEntry()), (e) => e instanceof JournalError && e.code === "conflict" && e.status === 503 && /Try saving again/.test(e.message));
  assert.equal(fake.calls.patch, 4);
  assert.equal(sleeps.length, 3);
  for (const ms of sleeps) assert.ok(ms >= 500 && ms < 2000);
});

test("hide and unhide: the flag is stored in the file, survives reload, and there is no way to delete one entry", async () => {
  const fake = createFakeGist();
  const j = open(fake);
  await j.append(makeEntry({ id: "keep-entry-0001" }));
  await j.append(makeEntry({ id: "hide-entry-0001", createdAt: "2026-11-23T10:00:00Z" }));
  assert.deepEqual(await j.hide("hide-entry-0001"), { changed: true });
  assert.deepEqual(await j.hide("hide-entry-0001"), { changed: false });
  assert.deepEqual((await decryptJson(fake.files["journal-2026-11.enc"], PASS)).hidden, ["hide-entry-0001"]);
  const other = open(fake); // "the other device"
  const all = await other.readAll();
  assert.equal(all.entries.length, 2, "hidden entries are still read, flagged");
  assert.equal(all.entries.find((e) => e.id === "hide-entry-0001").hidden, true);
  assert.deepEqual(await other.unhide("hide-entry-0001"), { changed: true });
  assert.equal((await j.readAll()).entries.every((e) => !e.hidden), true);
  await assert.rejects(j.hide("nope-nope-nope"), (e) => e.code === "notfound");
  await assert.rejects(j.hide("bad id!"), (e) => e.code === "invalid");
  for (const name of Object.keys(j)) assert.ok(!/delete|remove/i.test(name) || name === "deleteAll", name);
});

test("deleteAll needs the exact phrase, removes only journal files, and the old phrase variants fail", async () => {
  const fake = createFakeGist({ files: { "req-abc.enc": "keep", "recipes.enc": "keep", "README.md": "keep" } });
  const j = open(fake);
  await j.append(makeEntry({ id: "a-entry-000001" }));
  await j.append(makeEntry({ id: "b-entry-000001", createdAt: "2026-10-01T00:00:00Z" }));
  const patches = fake.calls.patch;
  for (const bad of ["", "delete my journal", "DELETE MY JOURNAL ", " DELETE MY JOURNAL", "DELETE", undefined, null, 5]) {
    await assert.rejects(j.deleteAll(bad), (e) => e.code === "confirm", String(bad));
  }
  assert.equal(fake.calls.patch, patches, "a wrong phrase never writes");
  assert.equal(journalFiles(fake).length, 2);
  assert.deepEqual(await j.deleteAll(DELETE_PHRASE), { deleted: 2 });
  assert.deepEqual(Object.keys(fake.files).sort(), ["README.md", "recipes.enc", "req-abc.enc"]);
  assert.deepEqual((await j.readAll()).entries, []);
  assert.deepEqual(await j.deleteAll(DELETE_PHRASE), { deleted: 0 });
});

test("importLegacy: stable ids, no duplicates on a second import, bad entries counted", async () => {
  const fake = createFakeGist();
  const j = open(fake);
  const old = (i, ts) => ({ id: `old${i}`, ts, text: `Old day ${i}`, result: { ...GOOD_RESULT, usage: { input_tokens: 5, output_tokens: 5, cost_usd: 0.001 } } });
  const list = [old(1, Date.UTC(2026, 9, 3)), old(2, Date.UTC(2026, 10, 4)), old(3, Date.UTC(2026, 10, 5)), { id: "bad", ts: "x" }, "junk", old(1, Date.UTC(2026, 9, 3))];
  assert.deepEqual(await j.importLegacy(list), { added: 3, skipped: 1, invalid: 2, addedIds: ["old1", "old2", "old3"], skippedIds: ["old1"], invalidIds: ["bad"], duplicateIds: ["old1"], invalidIndexes: [3, 4] });
  assert.deepEqual(journalFiles(fake).sort(), ["journal-2026-10.enc", "journal-2026-11.enc"]);
  const all = await j.readAll();
  assert.deepEqual(all.entries.map((e) => e.id).sort(), ["legacy-old1", "legacy-old2", "legacy-old3"]);
  assert.equal(all.entries[0].mode, "local");
  assert.equal(all.entries[0].usage.cost_usd, 0.001);
  assert.deepEqual(await j.importLegacy(list), { added: 0, skipped: 4, invalid: 2, addedIds: [], skippedIds: ["old1", "old2", "old3"], invalidIds: ["bad"], duplicateIds: ["old1"], invalidIndexes: [3, 4] });
  assert.equal((await j.readAll()).entries.length, 3);
  await assert.rejects(j.importLegacy("nope"), (e) => e.code === "invalid");
  await assert.rejects(j.importLegacy(new Array(501).fill(old(9, 1))), (e) => e.code === "invalid");
  assert.equal(legacyToEntry(old(1, Date.UTC(2026, 10, 1))).id, "legacy-old1");
  assert.match(legacyToEntry({ ...old(1, Date.UTC(2026, 10, 1)), id: "../a b" }).id, /^legacy-\.\._a_b-[0-9a-f]{6}$/);
});

test("export: Markdown and text, hidden excluded unless asked", async () => {
  const fake = createFakeGist();
  const j = open(fake, { now: () => Date.UTC(2026, 10, 30) });
  await j.append(makeEntry({ id: "shown-entry-001", text: "Line one\nLine two", quote: { ...GOOD_QUOTE, translation: "Das geht vorbei." } }));
  await j.append(makeEntry({ id: "secret-entry-01", text: "My hidden thought", createdAt: "2026-12-01T09:00:00Z" }));
  await j.hide("secret-entry-01");
  const md = await j.exportMarkdown();
  assert.match(md, /^# My Empathy Diary journal\n\nExported 2026-11-30 - 1 entry\n\nTimes are UTC\. Entries are listed oldest first\.\n/);
  assert.match(md, /> Line one\n> Line two/);
  assert.match(md, /> This too shall pass\./);
  assert.match(md, /Persian proverb, Folk saying: <https:\/\/example\.org\/quote>/);
  assert.match(md, /Translation \(by Claude, not the author's words\): Das geht vorbei\./);
  assert.ok(!md.includes("hidden thought"));
  const mdAll = await j.exportMarkdown({ includeHidden: true });
  assert.ok(mdAll.includes("My hidden thought") && mdAll.includes("(hidden)") && mdAll.indexOf("## 2026-11") < mdAll.indexOf("## 2026-12"));
  const txt = await j.exportText();
  assert.ok(txt.includes("Line one") && !txt.includes("hidden thought") && !txt.includes("# "));
  assert.ok((await j.exportText({ includeHidden: true })).includes("hidden thought"));
});

test("a wrong passphrase reads nothing and never writes, not even to a new month", async () => {
  const fake = createFakeGist();
  await open(fake).append(makeEntry({ id: "mine-entry-0001" }));
  const wrong = createJournal({ gist: createGistClient({ token: GIST_TOKEN, gistId: GIST_ID, fetch: fake.fetch }), passphrase: "totally wrong pass", sleep: noSleep });
  const before = { ...fake.files };
  const patches = fake.calls.patch;
  await assert.rejects(wrong.readAll(), (e) => e.code === "passphrase" && e.message === "That passphrase can't open your journal. Check Settings.");
  assert.equal((await wrong.listMonths()).length, 1, "listing months needs no passphrase");
  await assert.rejects(wrong.append(makeEntry({ id: "new-month-0001", createdAt: "2027-01-05T00:00:00Z" })), (e) => e.code === "passphrase");
  await assert.rejects(wrong.hide("mine-entry-0001"), (e) => e.code === "passphrase");
  await assert.rejects(wrong.importLegacy([]), () => true).catch(() => {});
  assert.equal(fake.calls.patch, patches);
  assert.deepEqual(fake.files, before);
  assert.throws(() => createJournal({ gist: {}, passphrase: "" }), (e) => e.code === "passphrase");
});

test("a damaged month is reported, other months still load, and the damaged file is never overwritten", async () => {
  const fake = createFakeGist();
  const j = open(fake);
  await j.append(makeEntry({ id: "good-entry-0001", createdAt: "2026-10-05T00:00:00Z" }));
  await j.append(makeEntry({ id: "nov-entry-0001", createdAt: "2026-11-05T00:00:00Z" }));
  fake.files["journal-2026-11.enc"] = "this is not an envelope";
  fake.files["journal-2026-12.enc"] = await encryptJson({ v: 2, entries: [] }, PASS);
  fake.files["journal-2027-01.enc"] = await encryptJson({ nope: true }, PASS);
  const all = await j.readAll();
  assert.deepEqual(all.entries.map((e) => e.id), ["good-entry-0001"]);
  assert.deepEqual(all.problems.map((p) => [p.file, p.kind]).sort(), [["journal-2026-11.enc", "damaged"], ["journal-2026-12.enc", "version"], ["journal-2027-01.enc", "damaged"]]);
  assert.match(all.problems[0].message, /could not be read \(journal-2026-11\.enc\)/);
  assert.equal(all.problems[1].message, "This month was saved by a newer version of the app; update the page to open it.");
  assert.doesNotMatch(all.problems[1].message, /could not be read/);
  const keep = { ...fake.files };
  await assert.rejects(j.append(makeEntry({ id: "more-nov-00001", createdAt: "2026-11-07T00:00:00Z" })), (e) => e.code === "damaged" && e.file === "journal-2026-11.enc");
  assert.deepEqual(fake.files, keep);
  // a healthy month still takes entries
  await j.append(makeEntry({ id: "oct-two-000001", createdAt: "2026-10-06T00:00:00Z" }));
  assert.equal((await j.readMonth("2026-10")).entries.length, 2);
});

test("broken entries inside a file are ignored on read, but kept in the file when it is rewritten", async () => {
  const fake = createFakeGist();
  const good = makeEntry({ id: "good-entry-0001" });
  const future = { ...makeEntry({ id: "future-entry-01" }), mode: "telepathy", extra: "from a newer app" };
  fake.files["journal-2026-11.enc"] = await encryptJson({ v: 1, entries: [good, future, { id: 1 }, "x", null, { ...good, id: "bad id" }, good], hidden: ["good-entry-0001", 5, "bad id"] }, PASS);
  const j = open(fake);
  const all = await j.readAll();
  assert.deepEqual(all.entries.map((e) => e.id), ["good-entry-0001"]);
  assert.equal(all.entries[0].hidden, true);
  await j.append(makeEntry({ id: "added-entry-001" }));
  const data = await decryptJson(fake.files["journal-2026-11.enc"], PASS);
  assert.ok(data.entries.some((e) => e.id === "future-entry-01" && e.extra === "from a newer app"));
  assert.equal(data.entries.length, 6);
});

test("validation: entries, quotes (null or the allowed shape, https only, length caps)", () => {
  const ok = makeEntry();
  assert.ok(validateEntry(ok));
  assert.equal(validateEntry({ ...ok, quote: null }).quote, null);
  assert.equal(validateEntry({ ...ok, quote: undefined }).quote, null);
  assert.deepEqual(validateEntry({ ...ok, quote: GOOD_QUOTE }).quote, { ...GOOD_QUOTE, url: "https://example.org/quote" });
  for (const url of ["http://example.org/x", "javascript:alert(1)", "data:text/html,x", "https://user:pw@example.org/", "//example.org", "", null, 5]) assert.equal(validateQuote({ ...GOOD_QUOTE, url }), null, String(url));
  assert.equal(validateQuote({ ...GOOD_QUOTE, text: "" }), null);
  assert.equal(validateQuote({ ...GOOD_QUOTE, author: undefined }), null);
  assert.equal(validateQuote({ ...GOOD_QUOTE, text: "q".repeat(5000) }).text.length, 600);
  assert.equal(validateQuote({ ...GOOD_QUOTE, translation: "t".repeat(5000) }).translation.length, 800);
  assert.equal(validateEntry({ ...ok, quote: { text: "x", author: "y", url: "http://bad" } }).quote, null, "a bad quote is dropped, the entry stays");
  for (const bad of [null, [], "x", {}, { ...ok, id: "short" }, { ...ok, id: "a/b/c/d/e" }, { ...ok, createdAt: "yesterday" }, { ...ok, createdAt: "1999-01-01" }, { ...ok, mode: "cloud" }, { ...ok, text: "  " }, { ...ok, text: "a".repeat(2001) }, { ...ok, text: 5 }, { ...ok, interpretation: null }, { ...ok, interpretation: { ...GOOD_RESULT, primary_emotion: "" } }]) {
    assert.equal(validateEntry(bad), null, JSON.stringify(bad)?.slice(0, 60));
  }
  const e = validateEntry({ ...ok, interpretation: { ...GOOD_RESULT, mood_score: 99, concern: "weird", language: "not a lang!", empathy: "e".repeat(5000), emotions: [{ id: "joy", intensity: 99 }, { id: "", intensity: 1 }, "x"] }, usage: { input_tokens: 5, evil: "x", Bad_Key: 1, cost_usd: -1 }, stray: 1 });
  assert.equal(e.interpretation.mood_score, 10);
  assert.equal(e.interpretation.concern, "none");
  assert.equal(e.interpretation.language, "en");
  assert.equal(e.interpretation.empathy.length, 1600);
  assert.deepEqual(e.interpretation.emotions, [{ id: "joy", intensity: 5 }]);
  assert.deepEqual(e.usage, { input_tokens: 5 });
  assert.equal("stray" in e, false);
  assert.deepEqual(validateMonthData(null), { error: "damaged" });
  assert.deepEqual(validateMonthData({ v: 3, entries: [] }), { error: "version" });
  assert.equal(parseFileName("journal-2026-13.enc"), null);
  assert.equal(parseFileName("journal-2026-11-1.enc"), null);
  assert.equal(parseFileName("../journal-2026-11.enc"), null);
  assert.deepEqual(parseFileName("journal-2026-11-12.enc"), { month: "2026-11", part: 12 });
});

test("Gist trouble: a refused token fails at once with a plain message, a GitHub 500 is retried, offline is explained, no secrets leak", async () => {
  const fake = createFakeGist();
  fake.failPatch = 403;
  const j = open(fake);
  await assert.rejects(j.append(makeEntry()), (e) => {
    assert.equal(e.code, "gist");
    assert.equal(e.status, 502);
    assert.match(e.message, /Could not reach your journal \(The Gist says the token isn't allowed/);
    assert.ok(!e.message.includes(GIST_TOKEN) && !e.message.includes(PASS));
    return true;
  });
  assert.equal(fake.calls.patch, 1);

  fake.failPatch = 500;
  const sleeps = [];
  await assert.rejects(open(fake, { sleep: async (ms) => sleeps.push(ms) }).append(makeEntry()), (e) => e.code === "gist");
  assert.equal(fake.calls.patch, 1 + 4);
  assert.equal(sleeps.length, 3);

  const off = createJournal({ gist: createGistClient({ token: GIST_TOKEN, gistId: GIST_ID, fetch: offlineFetch }), passphrase: PASS, sleep: noSleep });
  await assert.rejects(off.readAll(), (e) => e.code === "gist" && /request failed \(no connection\)/.test(e.message));
  fake.failPatch = 0;
  fake.failGet = 404;
  await assert.rejects(open(fake).readAll(), (e) => e.code === "gist" && /couldn't find it/.test(e.message));
});

test("a Gist with more files than GitHub lists refuses to write (it might hide a journal month)", async () => {
  const fake = createFakeGist();
  fake.listTruncated = true;
  const j = open(fake);
  const all = await j.readAll();
  assert.equal(all.problems[0].kind, "list");
  await assert.rejects(j.append(makeEntry()), (e) => e.code === "gist" && /too many files/.test(e.message));
  assert.equal(fake.calls.patch, 0);
});

test("importLegacy is lenient: nothing usable is lost, only entries without an id or text are invalid", async () => {
  const fake = createFakeGist();
  const j = open(fake, { now: () => Date.UTC(2026, 10, 22, 12) });
  const res = { ...GOOD_RESULT, primary_emotion: "melancholy", emotions: [{ id: "weird", intensity: 9 }, { id: "joy" }] };
  const list = [
    { id: "a1", ts: Date.UTC(2026, 9, 3), text: "ms number", result: res },
    { id: "a2", ts: "2026-09-04T08:00:00Z", text: "iso string", result: GOOD_RESULT },
    { id: "a3", ts: Math.floor(Date.UTC(2026, 8, 5) / 1000), text: "seconds", result: GOOD_RESULT },
    { id: "a4", text: "no time", result: GOOD_RESULT },
    { id: "a5", ts: "garbage", text: "bad time", result: GOOD_RESULT },
    { id: 777, ts: Date.UTC(2026, 9, 6), text: "numeric id", result: GOOD_RESULT },
    { id: "a b/c", ts: Date.UTC(2026, 9, 7), text: "odd id", result: GOOD_RESULT },
    { id: "a_b_c", ts: Date.UTC(2026, 9, 7), text: "its look-alike", result: GOOD_RESULT },
    { id: "a6", ts: Date.UTC(2026, 9, 8), text: "no result at all" },
    { id: "x".repeat(200), ts: Date.UTC(2026, 9, 9), text: "long id", result: GOOD_RESULT },
    { ts: Date.UTC(2026, 9, 3), text: "no id", result: GOOD_RESULT },
    { id: "", text: "empty id" },
    { id: "b1", ts: Date.UTC(2026, 9, 3), text: "   ", result: GOOD_RESULT },
    null,
  ];
  const r = await j.importLegacy(list);
  assert.equal(r.added, 10);
  assert.equal(r.invalid, 4);
  assert.deepEqual(r.invalidIndexes, [10, 11, 12, 13]);
  assert.deepEqual(r.invalidIds, ["b1"]);
  assert.deepEqual(r.addedIds, ["a1", "a2", "a3", "a4", "a5", 777, "a b/c", "a_b_c", "a6", "x".repeat(200)]);
  const all = await j.readAll();
  const by = (t) => all.entries.find((e) => e.text === t);
  assert.equal(by("ms number").interpretation.primary_emotion, "mixed");
  assert.deepEqual(by("ms number").interpretation.emotions, [{ id: "mixed", intensity: 5 }, { id: "joy", intensity: 3 }]);
  assert.equal(by("iso string").createdAt, "2026-09-04T08:00:00.000Z");
  assert.equal(by("seconds").createdAt, "2026-09-05T00:00:00.000Z");
  for (const t of ["no time", "bad time"]) {
    assert.equal(by(t).createdAt, "2026-11-22T12:00:00.000Z");
    assert.equal(by(t).importedAt, true);
  }
  assert.equal(by("ms number").importedAt, undefined);
  assert.equal(by("no result at all").interpretation.primary_emotion, "mixed");
  assert.equal(all.entries.length, 10, "odd ids that look alike stay separate");
  const again = await j.importLegacy(list);
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 10);
  assert.equal(again.skippedIds.length, 10);
  assert.equal(by("no time") && (await j.readAll()).entries.length, 10, "a second import adds nothing, even for entries with no time");
});

test("speed: with 37 months, append and hide decrypt at most 2 files, and reads load only what is asked", async () => {
  const fake = createFakeGist();
  const counting = (g) => ({ ...g, files: () => g.files(), version: () => g.version(), write: (c) => g.write(c), text: (f) => (decrypts.n++, g.text(f)), get listTruncated() { return g.listTruncated; } });
  const decrypts = { n: 0 };
  const client = createGistClient({ token: GIST_TOKEN, gistId: GIST_ID, fetch: fake.fetch });
  const j = createJournal({ gist: counting(client), passphrase: PASS, sleep: noSleep });
  for (let i = 0; i < 37; i++) {
    const month = new Date(Date.UTC(2023, i, 1)).toISOString().slice(0, 7);
    fake.files[`journal-${month}.enc`] = await encryptJson({ v: 1, entries: [makeEntry({ id: `seed-${month}-000001`, createdAt: `${month}-10T10:00:00Z` })], hidden: [] }, PASS);
  }
  assert.equal(Object.keys(fake.files).length, 37);

  decrypts.n = 0;
  await j.append(makeEntry({ id: "newest-entry-001", createdAt: "2026-02-01T10:00:00Z" }));
  assert.ok(decrypts.n <= 2, `append decrypted ${decrypts.n} files`);

  decrypts.n = 0;
  await j.append(makeEntry({ id: "brand-new-month1", createdAt: "2026-06-01T10:00:00Z" }));
  assert.ok(decrypts.n <= 3, `a new month also checks the passphrase on one file (${decrypts.n})`);

  decrypts.n = 0;
  assert.deepEqual(await j.hide("newest-entry-001", { month: "2026-02" }), { changed: true });
  assert.ok(decrypts.n <= 2, `hide with a month hint decrypted ${decrypts.n} files`);
  decrypts.n = 0;
  assert.deepEqual(await j.hide("seed-2026-01-000001"), { changed: true });
  assert.ok(decrypts.n <= 4, `hide found it in the newest months (${decrypts.n})`);
  decrypts.n = 0;
  const id = newEntryId(Date.UTC(2026, 1, 2));
  await j.append(makeEntry({ id, createdAt: "2026-02-02T10:00:00Z" }));
  decrypts.n = 0;
  await j.hide(id);
  assert.ok(decrypts.n <= 2, `hide guessed the month from a time-based id (${decrypts.n})`);
  decrypts.n = 0;
  assert.deepEqual(await j.unhide(id), { changed: true });
  assert.ok(decrypts.n <= 2);

  decrypts.n = 0;
  const latest = await j.readLatest();
  assert.equal(decrypts.n, 2);
  assert.deepEqual(latest.months.map((m) => m.month), ["2026-06", "2026-02"]);
  assert.equal(latest.allMonths.length, 39);
  assert.equal(latest.allMonths[0].month, "2026-06");
  decrypts.n = 0;
  await j.listMonths();
  assert.equal(decrypts.n, 0, "listing months decrypts nothing");
  decrypts.n = 0;
  assert.equal((await j.readMonth("2024-03")).entries.length, 1);
  assert.equal(decrypts.n, 1);
  decrypts.n = 0;
  assert.equal((await j.readAll()).entries.length, 40);
  assert.ok(decrypts.n >= 38, "export still reads everything");
  await assert.rejects(j.hide("nope-entry-000001"), (e) => e.code === "notfound");
});

test("a newer-format file says so, distinct from a damaged one, and blocks appends to that month", async () => {
  const fake = createFakeGist();
  fake.files["journal-2026-12.enc"] = await encryptJson({ v: 2, entries: [] }, PASS);
  const j = open(fake);
  const all = await j.readLatest();
  assert.deepEqual(all.problems.map((p) => p.kind), ["version"]);
  assert.equal(all.problems[0].message, "This month was saved by a newer version of the app; update the page to open it.");
  const before = { ...fake.files };
  await assert.rejects(j.append(makeEntry({ id: "dec-entry-00001", createdAt: "2026-12-02T00:00:00Z" })), (e) => e.code === "version" && /newer version/.test(e.message));
  assert.deepEqual(fake.files, before);
});

test("Markdown export: URLs are wrapped in <...> with ) ] < > percent-encoded; times are UTC; oldest first", async () => {
  const fake = createFakeGist();
  const j = open(fake, { now: () => Date.UTC(2026, 10, 30) });
  const url = "https://example.org/a_(b)[c]?q=<x>&z=1";
  await j.append(makeEntry({ id: "later-entry-001", text: "Later", createdAt: "2026-11-25T23:30:00Z", quote: { ...GOOD_QUOTE, url } }));
  await j.append(makeEntry({ id: "earlier-entry-1", text: "Earlier", createdAt: "2026-11-02T01:00:00Z" }));
  const md = await j.exportMarkdown();
  assert.match(md, /Times are UTC\. Entries are listed oldest first\./);
  assert.ok(md.indexOf("Earlier") < md.indexOf("Later"));
  assert.ok(md.includes("### 2026-11-25 23:30 UTC"));
  const line = md.split("\n").find((l) => l.includes("example.org"));
  assert.match(line, /<https:\/\/example\.org\/a_%28b%29%5Bc%5D\?q=%3Cx%3E&z=1>$/);
  assert.doesNotMatch(line.slice(line.indexOf("<https")), /[()[\]]|<[^h]/);
  assert.ok((await j.exportText()).includes("Times are UTC."));
});

test("readLatest(n) and readMonth return months, allMonths and problems; hide/unhide only touch the entry's month files", async () => {
  const fake = createFakeGist();
  const j = open(fake);
  await j.append(makeEntry({ id: "oct-entry-00001", createdAt: "2026-10-05T10:00:00Z" }));
  await j.append(makeEntry({ id: "nov-entry-00001", createdAt: "2026-11-05T10:00:00Z" }));
  await j.append(makeEntry({ id: "dec-entry-00001", createdAt: "2026-12-05T10:00:00Z" }));
  const one = await j.readLatest(1);
  assert.deepEqual(one.entries.map((e) => e.id), ["dec-entry-00001"]);
  assert.deepEqual(one.allMonths.map((m) => m.month), ["2026-12", "2026-11", "2026-10"]);
  assert.equal((await j.readLatest()).entries.length, 2);
  fake.patches.length = 0;
  await j.hide("oct-entry-00001");
  assert.deepEqual(fake.patches, [["journal-2026-10.enc"]]);
  assert.equal((await j.readMonth("2026-10")).entries[0].hidden, true);
  assert.equal((await j.readLatest()).entries.every((e) => !e.hidden), true);
  await j.unhide("oct-entry-00001");
  assert.equal((await j.readMonth("2026-10")).entries[0].hidden, false);
});
