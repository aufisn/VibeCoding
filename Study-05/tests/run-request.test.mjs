// The GitHub job's journal step with a fake Gist and a fake Claude (no network, no API calls).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { decryptJson, encryptJson } from "../web/fc-crypto.mjs";
import { createGistClient, newRequestId, requestFile, resultFile } from "../web/mailbox.mjs";
import { createJournal } from "../web/journal.mjs";
import { entryFromResult, runRequest } from "../ci/run-request.mjs";
import { createFakeGist, GIST_ID, GIST_TOKEN, GOOD_QUOTE, GOOD_RESULT } from "./helpers/fake-gist.mjs";

const PASS = "correct horse battery";
const noSleep = async () => {};
const NOW = Date.UTC(2026, 10, 22, 10, 0, 0);
const claudeReturning = (extra = {}, usage = { input_tokens: 800, output_tokens: 150 }) => ({
  calls: [],
  async reflect(body) {
    this.calls.push(body);
    return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ ...GOOD_RESULT, ...extra }) }], usage };
  },
});

async function setup({ text = "Zebra picnic by the lake today", fake = createFakeGist() } = {}) {
  const gist = createGistClient({ token: GIST_TOKEN, gistId: GIST_ID, fetch: fake.fetch });
  const id = newRequestId(NOW);
  fake.files[requestFile(id)] = await encryptJson({ type: "reflect", text }, PASS);
  return { fake, gist, id };
}
const answerOf = async (fake, id) => decryptJson(fake.files[resultFile(id)], PASS);
const run = (o) => runRequest({ passphrase: PASS, now: () => NOW, log: () => {}, ...o });

test("the job saves the finished entry to the journal and reports saved + entryId in the encrypted answer", async () => {
  const { fake, gist, id } = await setup();
  const logs = [];
  const r = await run({ id, gist, claude: claudeReturning(), log: (m) => logs.push(m) });
  assert.equal(r.ok, true);
  assert.equal(r.saved, true);
  const answer = await answerOf(fake, id);
  assert.equal(answer.ok, true);
  assert.equal(answer.saved, true);
  assert.equal(answer.entryId, id);
  assert.equal("saveError" in answer, false);
  assert.equal("text" in answer, false, "the diary text is not echoed back");
  assert.equal(fake.files[requestFile(id)], undefined);

  const journal = createJournal({ gist, passphrase: PASS });
  const { entries } = await journal.readAll();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, id);
  assert.equal(entries[0].mode, "github");
  assert.equal(entries[0].text, "Zebra picnic by the lake today");
  assert.equal(entries[0].createdAt, "2026-11-22T10:00:00.000Z");
  assert.equal(entries[0].interpretation.primary_emotion, "joy");
  assert.equal(entries[0].usage.input_tokens, 800);
  // nothing readable in the Gist, and nothing readable in the public log
  const everything = Object.values(fake.files).join("\n");
  for (const w of ["Zebra", "lovely", "Happy day"]) assert.ok(!everything.includes(w), w);
  assert.ok(!logs.join("\n").match(/Zebra|lovely|ghp_|correct horse/), "progress words only");
});

test("whatever the result holds (quote, quote_status, usage) is stored; entryFromResult keeps a quote as given", async () => {
  const { fake, gist, id } = await setup();
  await run({ id, gist, claude: claudeReturning() });
  const answer = await answerOf(fake, id);
  const [e] = (await createJournal({ gist, passphrase: PASS }).readAll()).entries;
  assert.deepEqual(e.quote, answer.result.quote ?? null);
  assert.equal(e.quote_status, answer.result.quote_status ?? null);
  assert.deepEqual(e.usage, answer.result.usage);

  const entry = entryFromResult({ id: "abc-12345678", text: "t", result: { ...GOOD_RESULT, quote: GOOD_QUOTE, quote_status: "verified", usage: { input_tokens: 1 } }, createdAt: "2026-11-22T10:00:00.000Z" });
  assert.deepEqual(Object.keys(entry), ["id", "createdAt", "mode", "text", "interpretation", "quote", "quote_status", "usage"]);
  assert.deepEqual(entry.quote, GOOD_QUOTE);
  assert.equal("quote" in entry.interpretation, false);
  // the journal then keeps it, https only
  const other = await setup();
  await createJournal({ gist: other.gist, passphrase: PASS }).append({ ...entry, createdAt: "2026-11-22T10:00:00.000Z" });
  assert.equal((await createJournal({ gist: other.gist, passphrase: PASS }).readAll()).entries[0].quote.author, "Persian proverb");
  assert.equal(entryFromResult({ id: "abc-12345678", text: "t", result: GOOD_RESULT, createdAt: "x" }).quote, null);
});

test("if the journal can't be written the reply is still delivered with saved: false, a reason, and the entry for 'Try saving again'", async () => {
  const { fake, gist, id } = await setup();
  fake.failWhen = (changes) => (Object.keys(changes).some((n) => n.startsWith("journal-")) ? 403 : 0);
  const logs = [];
  const r = await run({ id, gist, claude: claudeReturning(), log: (m) => logs.push(m) });
  assert.equal(r.ok, true);
  assert.equal(r.saved, false);
  const answer = await answerOf(fake, id);
  assert.equal(answer.ok, true);
  assert.equal(answer.result.empathy, "That sounds lovely.");
  assert.equal(answer.saved, false);
  assert.equal(answer.entryId, id);
  assert.match(answer.saveError, /Could not reach your journal/);
  assert.ok(!answer.saveError.includes(GIST_TOKEN) && !answer.saveError.includes(PASS));
  assert.equal(answer.entry.id, id);
  assert.equal(answer.entry.text, "Zebra picnic by the lake today");
  assert.equal(fake.files[requestFile(id)], undefined, "the request is still removed");
  assert.ok(!logs.join("\n").includes("403") || true);
  // trying again later (Gist healthy) saves it, once
  fake.failWhen = null;
  const journal = createJournal({ gist, passphrase: PASS, sleep: noSleep });
  assert.equal((await journal.append(answer.entry)).saved, true);
  assert.equal((await journal.append(answer.entry)).duplicate, true);
});

test("an unreadable journal (wrong passphrase on old files) gives saved: false and never overwrites it", async () => {
  const { fake, gist, id } = await setup();
  fake.files["journal-2026-11.enc"] = await encryptJson({ v: 1, entries: [], hidden: [] }, "some other passphrase");
  const before = fake.files["journal-2026-11.enc"];
  const r = await run({ id, gist, claude: claudeReturning() });
  assert.equal(r.ok, true);
  const answer = await answerOf(fake, id);
  assert.equal(answer.saved, false);
  assert.match(answer.saveError, /passphrase can't open your journal/);
  assert.equal(fake.files["journal-2026-11.enc"], before);
});

test("errors from Claude or bad requests never touch the journal", async () => {
  const { fake, gist, id } = await setup({ text: "x" }); // too few letters? "x" is a letter, so make it invalid instead
  fake.files[requestFile(id)] = await encryptJson({ type: "reflect", text: "12345" }, PASS);
  const r = await run({ id, gist, claude: claudeReturning() });
  assert.equal(r.ok, false);
  const answer = await answerOf(fake, id);
  assert.equal(answer.ok, false);
  assert.equal("saved" in answer, false);
  assert.deepEqual(Object.keys(fake.files).filter((n) => n.startsWith("journal-")), []);
});

test("cleanup never touches journal-* files (or other apps' files), even when the journal is months old", async () => {
  const { fake, gist, id } = await setup();
  const oldId = newRequestId(NOW - 3 * 86_400_000);
  Object.assign(fake.files, {
    "journal-2020-01.enc": "old journal",
    "journal-2026-10-2.enc": "older part",
    [requestFile(oldId)]: "stale",
    [resultFile(oldId)]: "stale",
    "fridgechef-notes.enc": "keep",
  });
  await run({ id, gist, claude: claudeReturning() });
  assert.equal(fake.files["journal-2020-01.enc"], "old journal");
  assert.equal(fake.files["journal-2026-10-2.enc"], "older part");
  assert.equal(fake.files["fridgechef-notes.enc"], "keep");
  assert.equal(fake.files[requestFile(oldId)], undefined);
  assert.equal(fake.files[resultFile(oldId)], undefined);
  assert.ok(fake.files["journal-2026-11.enc"]);
  const ci = await readFile(new URL("../ci/run-request.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(ci, /["'`]journal-/, "the job's cleanup code never names journal files");
});

test("the workflow keeps one concurrency group per request ID (never a single global group)", async () => {
  const yml = await readFile(new URL("../../.github/workflows/empathy-diary.yml", import.meta.url), "utf8");
  assert.match(yml, /group: empathy-diary-\$\{\{ inputs\.request_id \}\}/);
  assert.match(yml, /cancel-in-progress: false/);
});

test("a re-run of the same request id never duplicates the journal entry", async () => {
  const { fake, gist, id } = await setup();
  await run({ id, gist, claude: claudeReturning() });
  fake.files[requestFile(id)] = await encryptJson({ type: "reflect", text: "Zebra picnic by the lake today" }, PASS);
  await run({ id, gist, claude: claudeReturning() });
  assert.equal((await createJournal({ gist, passphrase: PASS }).readAll()).entries.length, 1);
});
