import { test } from "node:test";
import assert from "node:assert/strict";

import { auditRuns, loadBackup, maxPointsFor, statsReport } from "../scripts/backup-report.mjs";
import { selectQuestions, toCheckItem } from "../scripts/list-questions.mjs";
import { LocalDataManager } from "../js/data-manager.js";
import { createGame, SCREENS } from "../js/state.js";
import { seededRng } from "../js/quiz.js";
import { SPEED_SUBJECT } from "../js/config.js";
import { fakeStorage, loadFixedBank } from "./helpers.mjs";

// Fixed 40-question copy: these tests expect its exact counts and ids.
const bank = await loadFixedBank();

/**
 * Play real games through the game engine (seeded, fake clock) and save them
 * like the app does, then export a backup. Every run in it is genuine.
 */
function playedBackup() {
  let t = Date.UTC(2026, 10, 2, 9);
  const clock = { now: () => new Date(t) };
  const dm = new LocalDataManager({ store: fakeStorage(), now: clock.now });
  const plans = [
    ["Kim", "All", "mixed", 0.8],
    ["Sam", "History", "mixed", 0.5],
    ["Kim", SPEED_SUBJECT, "mixed", 0.9],
    ["Ana", "All", "hard", 0.6],
    ["Kim", "Science", "easy", 1],
  ];
  plans.forEach(([name, subject, level, skill], g) => {
    const rng = seededRng(100 + g);
    const game = createGame(bank, { rng: seededRng(g + 1), now: clock.now });
    game.start(name, subject, level);
    while (game.getState().screen !== SCREENS.RESULTS) {
      const s = game.getState();
      if (s.screen === SCREENS.QUESTION) {
        if (rng() < 0.2) game.eliminate();
        t += rng() < 0.5 ? 4_000 : 12_000;
        const right = rng() < skill;
        game.answer(right ? s.question.correctIndex : game.getState().eliminated.length ? [0, 1, 2, 3].find((i) => i !== s.question.correctIndex && !game.getState().eliminated.includes(i)) : (s.question.correctIndex + 1) % 4);
        game.next();
      } else game.next();
    }
    dm.saveGame(game.takeResultToSave());
    t += 86_400_000; // next day
  });
  return { text: JSON.stringify(dm.exportBackup()), now: new Date(t) };
}

/* ---------- list-questions ---------- */

test("selectQuestions filters by category, id or id prefix", () => {
  assert.equal(selectQuestions(bank, "History").length, 10);
  assert.equal(selectQuestions(bank, "arts & culture").length, 10);
  assert.deepEqual(selectQuestions(bank, "geo-03").map((q) => q.id), ["geo-03"]);
  assert.equal(selectQuestions(bank, "sci").length, 10);
  assert.equal(selectQuestions(bank, "").length, 40);
  assert.equal(selectQuestions(bank, "nope").length, 0);
});

test("selectQuestions --unverified skips verified questions", () => {
  const qs = [{ id: "a-01", category: "X", verified: true }, { id: "a-02", category: "X", verified: false }];
  assert.deepEqual(selectQuestions(qs, "", { unverified: true }).map((q) => q.id), ["a-02"]);
});

test("toCheckItem shows the correct answer text", () => {
  const q = bank.find((x) => x.id === "geo-01");
  const item = toCheckItem(q);
  assert.equal(item.answer, q.options[q.correctIndex]);
  assert.equal(item.otherOptions.length, 3);
  assert.ok(!item.otherOptions.includes(item.answer));
});

/* ---------- audit ---------- */

test("maxPointsFor matches the game's real maximum", () => {
  assert.equal(maxPointsFor(0), 0);
  assert.equal(maxPointsFor(40) >= 847, true, "a perfect Full Challenge scores 847");
  assert.equal(maxPointsFor(3), 3 * 25 + 2);
});

test("genuine games pass the audit", () => {
  const { text, now } = playedBackup();
  const loaded = loadBackup(text, () => now);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.parsed.runs.length, 5);
  assert.deepEqual(auditRuns(loaded.parsed.runs, { now }), []);
});

test("edited scores are flagged", () => {
  const { text, now } = playedBackup();
  const { parsed } = loadBackup(text, () => now);
  const [a, b, c, d] = parsed.runs.map((r) => structuredClone(r));
  a.total = a.maxScore + 5; // more correct than questions
  b.points = 99_999; // impossible points
  c.tier = c.tier === "Novice" ? "Grandmaster" : "Novice"; // wrong rank
  d.finishedAt = new Date(now.getTime() + 7 * 86_400_000).toISOString(); // future
  const dup = structuredClone(parsed.runs[4]);
  const issues = auditRuns([a, b, c, d, parsed.runs[4], dup], { now });
  const text2 = issues.map((i) => i.problem).join("\n");
  assert.match(text2, /correct out of only/);
  assert.match(text2, /can earn at most/);
  assert.match(text2, /should be/);
  assert.match(text2, /future/);
  assert.match(text2, /duplicate/);
});

/* ---------- stats report ---------- */

test("statsReport matches the game's statistics", () => {
  const { text, now } = playedBackup();
  const { manager } = loadBackup(text, () => now);
  const report = statsReport(manager);
  const stats = manager.getStats();
  assert.equal(report.gamesPlayed, 5);
  assert.equal(report.totalPoints, stats.totalPoints);
  assert.equal(report.categories.length, 4);
  assert.equal(report.byMode.find((m) => m.mode === "Speed Quiz").games, 1);
  assert.ok(report.strongest);
  const p = report.pointsFrom;
  assert.equal(p.base + p.time + p.noHint + p.streak, report.totalPoints);
});

test("loadBackup refuses files that aren't backups", () => {
  assert.equal(loadBackup("{}").ok, false);
  assert.equal(loadBackup("nope").ok, false);
});
