import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const Core = createRequire(import.meta.url)("../diary-core.js");

const good = {
  primary_emotion: "joy", emotions: [{ id: "joy", intensity: 4 }, { id: "gratitude", intensity: 3 }], mood_score: 9,
  summary: "Happy", empathy: "That sounds lovely.", comfort: "Enjoy it.", gentle_step: "", concern: "none", language: "en",
};
const msg = (obj, extra = {}) => ({ stop_reason: "end_turn", content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }], usage: { input_tokens: 1000, output_tokens: 200 }, ...extra });

test("checkEntry: normal, whitespace, control chars", () => {
  assert.equal(Core.checkEntry("  Had   a good\n day  "), "Had a good day");
  assert.equal(Core.checkEntry("tired\u0000\u0007 today"), "tired today");
  assert.equal(Core.checkEntry("오늘은 조금 힘들었어요"), "오늘은 조금 힘들었어요");
});
test("checkEntry: rejects bad input with status 400", () => {
  for (const bad of ["", "   \n\t ", "12345 !!!", undefined, null, 42, "a".repeat(301)]) {
    assert.throws(() => Core.checkEntry(bad), (e) => e.status === 400 && e.message.length > 5, String(bad).slice(0, 10));
  }
});
test("checkEntry: 300 ok, 301 rejected, emoji counted as one", () => {
  assert.equal(Core.checkEntry("a".repeat(300)).length, 300);
  assert.throws(() => Core.checkEntry("a".repeat(301)));
  assert.doesNotThrow(() => Core.checkEntry("a" + "😀".repeat(299)));
});

test("buildRequestBody shape", () => {
  const b = Core.buildRequestBody("I had a good day");
  assert.equal(b.model, "claude-sonnet-5-5");
  assert.equal(b.temperature, undefined);
  assert.equal(b.thinking, undefined);
  assert.ok(b.max_tokens >= 500 && b.max_tokens <= 2000);
  assert.equal(typeof b.system, "string");
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].role, "user");
  assert.match(b.messages[0].content, /I had a good day/);
  assert.equal(b.output_config.format.type, "json_schema");
  assert.equal(b.output_config.format.schema.additionalProperties, false);
  assert.deepEqual([...b.output_config.format.schema.required].sort(), Object.keys(Core.RESULT_SCHEMA.properties).sort());
});
test("EMOTIONS are the 15 fixed ids", () => {
  assert.equal(Core.EMOTIONS.length, 15);
  assert.ok(Core.EMOTIONS.every((e) => e.id && e.label && e.emoji));
  assert.deepEqual(Core.RESULT_SCHEMA.properties.primary_emotion.enum, Core.EMOTIONS.map((e) => e.id));
});

test("parseResult: valid with cost", () => {
  const r = Core.parseResult(msg(good));
  assert.equal(r.primary_emotion, "joy");
  assert.equal(r.mood_score, 9);
  assert.equal(r.usage.input_tokens, 1000);
  assert.ok(Math.abs(r.usage.cost_usd - (1000 * 2 + 200 * 10) / 1e6) < 1e-12);
});
test("parseResult: refusal, max_tokens, bad JSON, no text", () => {
  assert.throws(() => Core.parseResult(msg(good, { stop_reason: "refusal" })), /not to respond/);
  assert.throws(() => Core.parseResult(msg(good, { stop_reason: "max_tokens" })), /cut off/);
  assert.throws(() => Core.parseResult(msg("not json {")), /could not be read/);
  assert.throws(() => Core.parseResult({ stop_reason: "end_turn", content: [] }), /could not be read/);
  assert.throws(() => Core.parseResult(null), /could not be read/);
});
test("parseResult: unknown emotion, out-of-range numbers, duplicates", () => {
  const r = Core.parseResult(msg({ ...good, primary_emotion: "zzz", mood_score: 99, emotions: [{ id: "weird", intensity: 0 }, { id: "weird", intensity: 9 }, { id: "joy", intensity: 4.6 }, { id: "calm", intensity: 2 }, { id: "love", intensity: 2 }] }));
  assert.equal(r.primary_emotion, "mixed");
  assert.equal(r.mood_score, 10);
  assert.deepEqual(r.emotions.map((e) => e.id), ["mixed", "joy", "calm"]);
  assert.deepEqual(r.emotions.map((e) => e.intensity), [1, 5, 2]);
  assert.equal(Core.parseResult(msg({ ...good, mood_score: -4 })).mood_score, 1);
});
test("parseResult: missing fields get safe fallbacks", () => {
  const r = Core.parseResult(msg({}));
  assert.equal(r.primary_emotion, "mixed");
  assert.equal(r.emotions.length, 1);
  assert.equal(r.mood_score, 5);
  assert.ok(r.summary && r.empathy && r.comfort);
  assert.equal(r.gentle_step, "");
  assert.equal(r.concern, "none");
  assert.equal(r.language, "en");
  assert.equal(Core.parseResult(msg({ ...good, concern: "bogus" })).concern, "none");
  assert.equal(Core.parseResult(msg({ ...good, concern: "urgent" })).concern, "urgent");
});

test("describeError covers statuses and never shows a key", () => {
  for (const s of [0, 400, 401, 403, 404, 413, 429, 500, 529, 503, 418]) assert.ok(Core.describeError(s, "").length > 10, String(s));
  assert.match(Core.describeError(400, JSON.stringify({ error: { message: "x-api-key must be scoped to a workspace" } }), { server: true }), /workspace ID/);
  assert.match(Core.describeError(401, ""), /key/i);
  assert.match(Core.describeError(429, ""), /busy|rate/i);
  assert.match(Core.describeError(529, ""), /overloaded/i);
  assert.doesNotMatch(Core.describeError(401, "sk-ant-secret123"), /secret123/);
});

test("diary-core.js has no code that sends an API key from a browser", () => {
  const src = readFileSync(new URL("../diary-core.js", import.meta.url), "utf8");
  for (const bad of ["x-api-key", "anthropic-dangerous-direct-browser-access", "api.anthropic.com", "callClaudeDirect", "sk-ant-"]) assert.ok(!src.includes(bad), bad);
  assert.equal(Core.callClaudeDirect, undefined);
});

test("checkEntry keeps ZWNJ/ZWJ, strips ZWSP, BOM and bidi controls", () => {
  assert.equal(Core.checkEntry("می\u200Cخواهم"), "می\u200Cخواهم");
  assert.equal(Core.checkEntry("a\u200Db"), "a\u200Db");
  assert.equal(Core.checkEntry("a\u200Bb\uFEFFc\u202Ed\u2066e"), "a b c d e");
});
test("checkEntry accepts emoji-only, rejects digits/punctuation with the new message", () => {
  assert.equal(Core.checkEntry("😊"), "😊");
  assert.equal(Core.checkEntry("1️⃣"), "1️⃣"); // keycap emoji
  assert.equal(Core.checkEntry("#️⃣"), "#️⃣");
  for (const bad of ["12345", "!!! ???", "1 2 3"]) {
    assert.throws(() => Core.checkEntry(bad), (e) => e.status === 400 && /words or an emoji/.test(e.message));
  }
});
test("describeError server option names .env; ci option names the repository secrets", () => {
  assert.match(Core.describeError(401, "", { server: true }), /ANTHROPIC_API_KEY in Study-05\/\.env/);
  assert.match(Core.describeError(403, "", { server: true }), /\.env/);
  assert.match(Core.describeError(400, JSON.stringify({ error: { message: "needs workspace" } }), { server: true }), /ANTHROPIC_WORKSPACE_ID/);
  assert.match(Core.describeError(401, ""), /API key was not accepted\. Check that it is correct/);
  assert.match(Core.describeError(401, "", { ci: true }), /ANTHROPIC_API_KEY secret/);
  assert.match(Core.describeError(400, JSON.stringify({ error: { message: "needs workspace" } }), { ci: true }), /ANTHROPIC_WORKSPACE_ID secret/);
});
