#!/usr/bin/env node
// Writes examples/class/: sample backup files from a pretend class, for trying
// the teacher-mode commands (/teacher-mode and friends) without real players.
// Every game is played through the real game engine (seeded, fake clock), so
// all scores are genuine, except one deliberately edited run in dev.json that
// the audit should catch.
//
// Usage: node scripts/make-sample-class.mjs [outDir]   (default examples/class)

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { LocalDataManager } from "../js/data-manager.js";
import { createGame, SCREENS } from "../js/state.js";
import { seededRng } from "../js/quiz.js";
import { ALL_SUBJECTS, SPEED_SUBJECT } from "../js/config.js";
import { memoryStore } from "./backup-report.mjs";

const START = Date.UTC(2026, 10, 2); // Monday 2 November 2026, 00:00 UTC
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Play one game. `skill(category)` is the chance of a right answer.
 * Returns the saved record.
 */
export function playGame(bank, dm, clock, { name, subject, level = "mixed", skill, seed, elimRate = 0.1, skipRate = 0, slowRate = 0 }) {
  const rng = seededRng(seed * 7 + 3);
  const game = createGame(bank, { rng: seededRng(seed), now: clock.now });
  game.start(name, subject, level);
  while (game.getState().screen !== SCREENS.RESULTS) {
    const s = game.getState();
    if (s.screen !== SCREENS.QUESTION) {
      game.next();
      continue;
    }
    if (rng() < skipRate) {
      clock.t += 3_000;
      game.skip();
      continue;
    }
    if (subject === SPEED_SUBJECT && rng() < slowRate) {
      clock.t += 16_000;
      game.timeOut();
      game.next();
      continue;
    }
    if (rng() < elimRate) game.eliminate();
    clock.t += rng() < 0.5 ? 5_000 : 12_000;
    const q = s.question;
    const right = rng() < skill(q.category);
    const gone = game.getState().eliminated;
    const wrong = [0, 1, 2, 3].find((i) => i !== q.correctIndex && !gone.includes(i));
    game.answer(right ? q.correctIndex : wrong);
    game.next();
  }
  const record = game.takeResultToSave();
  dm.saveGame(record);
  return record;
}

/** A device: one LocalDataManager with its own clock. */
function device() {
  const clock = { t: START };
  clock.now = () => new Date(clock.t);
  return { clock, dm: new LocalDataManager({ store: memoryStore(), now: clock.now }) };
}

const flat = (p) => () => p;
const by = (map, other) => (c) => map[c] ?? other;
const at = (clock, day, hour = 9) => (clock.t = START + day * DAY + hour * HOUR);

/** The pretend class. Returns { fileName: backupObject }. */
export function makeClass(bank) {
  const files = {};
  let seed = 1;
  const plan = (dev, games) => {
    for (const g of games) {
      at(dev.clock, g.day, g.hour ?? 9);
      playGame(bank, dev.dm, dev.clock, { seed: seed++, ...g });
    }
  };

  // Ana: strong everywhere, best at Science.
  const ana = device();
  const anaSkill = by({ Science: 0.95 }, 0.82);
  plan(ana, [
    { day: 0, name: "Ana", subject: ALL_SUBJECTS, skill: anaSkill },
    { day: 2, name: "Ana", subject: SPEED_SUBJECT, skill: anaSkill },
    { day: 4, name: "Ana", subject: "History", level: "hard", skill: anaSkill },
    { day: 7, name: "Ana", subject: ALL_SUBJECTS, skill: anaSkill },
    { day: 9, name: "Ana", subject: SPEED_SUBJECT, skill: anaSkill },
    { day: 14, name: "Ana", subject: ALL_SUBJECTS, level: "hard", skill: anaSkill },
  ]);
  files["ana.json"] = ana.dm.exportBackup();

  // Ben: plays at school and at home, and improves a lot. The school backup
  // was handed in twice (week 1 and week 2), so week 1's games are duplicates.
  const benSchool = device();
  const benHome = device();
  const benSkill = (k) => flat(0.35 + k * 0.08);
  plan(benSchool, [
    { day: 0, name: "Ben", subject: ALL_SUBJECTS, skill: benSkill(0), skipRate: 0.1 },
    { day: 1, name: "Ben", subject: "Geography", skill: benSkill(1), skipRate: 0.1 },
    { day: 3, name: "Ben", subject: SPEED_SUBJECT, skill: benSkill(1), slowRate: 0.25 },
  ]);
  files["ben-school-week1.json"] = benSchool.dm.exportBackup();
  plan(benHome, [
    { day: 5, hour: 18, name: "ben", subject: "History", skill: benSkill(3) },
    { day: 6, hour: 18, name: "ben", subject: "Science", skill: benSkill(4) },
  ]);
  files["ben-home.json"] = benHome.dm.exportBackup();
  plan(benSchool, [
    { day: 8, name: "Ben", subject: ALL_SUBJECTS, skill: benSkill(5) },
    { day: 11, name: "Ben", subject: SPEED_SUBJECT, skill: benSkill(5), slowRate: 0.1 },
    { day: 15, name: "Ben", subject: ALL_SUBJECTS, skill: benSkill(6) },
  ]);
  files["ben-school-week2.json"] = benSchool.dm.exportBackup();

  // Chloe: good, except Geography; leans on Eliminate.
  const chloe = device();
  const chloeSkill = by({ Geography: 0.3 }, 0.72);
  plan(chloe, [1, 3, 6, 10, 13, 16].map((day, i) => ({ day, name: "Chloe", subject: [ALL_SUBJECTS, "Geography", SPEED_SUBJECT][i % 3], skill: chloeSkill, elimRate: 0.6 })));
  files["chloe.json"] = chloe.dm.exportBackup();

  // Dev: started well, slipping, and hasn't played for 10 days. One run in
  // the file was edited by hand (impossible points); the audit should catch it.
  const dev = device();
  plan(dev, [0, 1, 2, 4, 6, 8].map((day, i) => ({ day, name: "Dev", subject: i % 2 ? SPEED_SUBJECT : ALL_SUBJECTS, skill: flat(0.8 - i * 0.08) })));
  const devBackup = dev.dm.exportBackup();
  devBackup.runs[0].points = 9_999;
  files["dev.json"] = devBackup;

  // A shared library computer: Eli (only 1 short game), Fay, and a game
  // nobody put a name on.
  const lib = device();
  plan(lib, [
    { day: 3, name: "Eli", subject: "Arts & Culture", skill: flat(0.7) },
    { day: 5, name: "Fay", subject: ALL_SUBJECTS, skill: by({ "Arts & Culture": 0.85 }, 0.55) },
    { day: 9, name: "Fay", subject: "History", skill: flat(0.5) },
    { day: 12, name: "Fay", subject: ALL_SUBJECTS, skill: by({ "Arts & Culture": 0.85 }, 0.5) },
    { day: 12, hour: 14, name: "", subject: "Science", skill: flat(0.6) },
    { day: 16, name: "Fay", subject: SPEED_SUBJECT, skill: flat(0.45) },
  ]);
  files["library-pc.json"] = lib.dm.exportBackup();

  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { readFile } = await import("node:fs/promises");
  const outDir = process.argv[2] ?? "examples/class";
  const bank = JSON.parse(await readFile(new URL("../tests/fixtures/questions-40.json", import.meta.url), "utf8"));
  await mkdir(outDir, { recursive: true });
  for (const [name, data] of Object.entries(makeClass(bank))) {
    await writeFile(join(outDir, name), JSON.stringify(data, null, 2) + "\n");
    console.log(`✔ ${join(outDir, name)} (${data.runs.length} games)`);
  }
}
