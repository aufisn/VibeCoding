import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classInsights,
  collectClass,
  comparePlayers,
  filterRuns,
  mdTable,
  normalizeName,
  renderCollect,
  renderCompare,
  renderInsights,
  renderOverview,
  summarizeClass,
} from "../scripts/teacher-report.mjs";
import { makeClass } from "../scripts/make-sample-class.mjs";
import { auditRuns } from "../scripts/backup-report.mjs";
import { loadFixedBank } from "./helpers.mjs";

const bank = await loadFixedBank();
const now = new Date("2026-11-18T12:00:00Z");
const files = makeClass(bank);
const sources = Object.entries(files).map(([name, data]) => ({ name, text: JSON.stringify(data) }));
const collected = collectClass(sources, { now });
const players = summarizeClass(collected.runs, now);
const byName = (n) => players.find((p) => p.name.toLowerCase() === n.toLowerCase());

test("normalizeName ignores case and extra spaces", () => {
  assert.equal(normalizeName("  Ana   Lee "), "ana lee");
  assert.equal(normalizeName(undefined), "");
});

test("sample class games are genuine, except the one edited run", () => {
  for (const [name, data] of Object.entries(files)) {
    const issues = auditRuns(data.runs, { now });
    if (name === "dev.json") assert.ok(issues.length > 0 && issues.every((i) => i.index === 0));
    else assert.deepEqual(issues, [], name);
  }
});

test("collectClass merges files, skips duplicates and leaves out impossible runs", () => {
  assert.equal(collected.files.length, 7);
  assert.ok(collected.files.every((f) => f.ok));
  assert.equal(collected.duplicates, 3, "week 1's three games are also in week 2's backup");
  assert.ok(collected.flagged.length > 0 && collected.flagged.every((f) => f.file === "dev.json" && !f.kept));
  assert.equal(byName("Dev").games, 5);
  // "Ben" and "ben" on two devices are one player, found in several files.
  assert.equal(byName("Ben").games, 8);
  assert.deepEqual(collected.multiFile.map((m) => m.player.toLowerCase()), ["ben"]);
  // The unnamed game stays separate, tagged with its file.
  assert.ok(players.some((p) => p.key === "(no name) · library-pc.json"));
});

test("includeFlagged keeps the edited run", () => {
  const all = collectClass(sources, { now, includeFlagged: true });
  assert.equal(all.runs.length, collected.runs.length + 1);
  assert.ok(all.flagged.every((f) => f.kept));
});

test("unreadable files are reported, not fatal", () => {
  const c = collectClass([...sources, { name: "notes.json", text: "{}" }, { name: "broken.json", text: "nope" }], { now });
  assert.equal(c.files.filter((f) => !f.ok).length, 2);
  assert.equal(c.runs.length, collected.runs.length);
  assert.match(renderCollect(c), /✖ That file isn't a Quiz Game backup/);
});

test("player summaries add up", () => {
  for (const p of players) {
    const cats = Object.values(p.byCategory);
    assert.equal(cats.reduce((a, c) => a + c.correct, 0), p.correct, p.name);
    assert.equal(cats.reduce((a, c) => a + c.questions, 0), p.questions, p.name);
    assert.ok(p.accuracy >= 0 && p.accuracy <= 100);
  }
  assert.equal(byName("Ana").strongest, "Science");
  assert.equal(byName("Chloe").weakest, "Geography");
  assert.ok(byName("Ben").trend.change >= 10, "Ben improves");
  assert.ok(byName("Dev").trend.change <= -10, "Dev slips");
  assert.equal(byName("Eli").trend, null, "one game is too few for a trend");
});

test("players with too little data rank last", () => {
  const firstSmall = players.findIndex((p) => p.questions < 20);
  assert.ok(firstSmall > 0);
  assert.ok(players.slice(firstSmall).every((p) => p.questions < 20));
  const ranked = players.slice(0, firstSmall).map((p) => p.accuracy);
  assert.deepEqual(ranked, [...ranked].sort((a, b) => b - a));
  assert.equal(players[0].name, "Ana");
});

test("filterRuns by player, mode and date", () => {
  const two = summarizeClass(filterRuns(collected.runs, { players: ["ana", " CHLOE "] }), now);
  assert.deepEqual(two.map((p) => p.name).sort(), ["Ana", "Chloe"]);
  const speed = filterRuns(collected.runs, { mode: "speed" });
  assert.ok(speed.length > 0 && speed.every((r) => r.mode === "speed"));
  const late = filterRuns(collected.runs, { since: "2026-11-12" });
  assert.ok(late.every((r) => r.finishedAt >= "2026-11-12"));
});

test("comparePlayers names the leader of each row", () => {
  const two = summarizeClass(filterRuns(collected.runs, { players: ["Ana", "Chloe"] }), now);
  const cmp = comparePlayers(two);
  assert.deepEqual(cmp.players, ["Ana", "Chloe"]);
  const geo = cmp.categories.find((r) => r.label === "Geography");
  assert.deepEqual(geo.leaders, ["Ana"]);
  const hints = cmp.general.find((r) => r.label === "Hints per game");
  assert.deepEqual(hints.leaders, ["Ana"], "fewer hints leads");
});

test("classInsights finds who needs help, who improved and what to revisit", () => {
  const ins = classInsights(players, { threshold: 60, inactiveDays: 7 });
  const support = ins.needSupport.map((x) => x.name);
  assert.ok(support.includes("Chloe") && support.includes("Dev"));
  assert.ok(!support.includes("Ana"));
  assert.equal(ins.mostImproved[0].name, "Ben");
  assert.ok(ins.inactive.some((x) => x.name === "Dev") && ins.inactive.some((x) => x.name === "Eli"));
  assert.ok(ins.notEnoughData.some((x) => x.name === "Eli"));
  assert.ok(ins.habits.some((h) => h.name === "Chloe" && /Eliminate/.test(h.habit)));
  assert.equal(ins.categories[0].name, "Geography", "the class's weakest topic comes first");
  assert.equal(ins.topPerformers[0].name, "Ana");
});

test("Markdown renders without breaking tables", () => {
  assert.equal(mdTable(["a"], [["x|y"]]).split("\n")[2], "| x\\|y |");
  const md = [renderOverview(players), renderCompare(comparePlayers(players)), renderInsights(classInsights(players), { threshold: 60, inactiveDays: 7 })].join("\n");
  assert.match(md, /## Class overview/);
  assert.match(md, /Suggested focus:.*Geography/);
  assert.doesNotMatch(md, /undefined|NaN/);
});
