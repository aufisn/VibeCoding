---
name: quiz-stats
description: Manage Study-03 quiz game statistics. Analyses a game backup file (Statistics → Download backup) and reports games, accuracy, points, streaks, per mode, category and difficulty, trends and practice tips; or guides changes to how statistics are tracked in the code (LocalDataManager, saved records, Statistics screen). Use when asked about quiz statistics, a backup file's stats, or changing what statistics the game keeps.
argument-hint: "[path/to/quiz-backup.json | sample | change: what to change]"
allowed-tools: Bash(node scripts/backup-report.mjs:*), Bash(node --test:*), Read
---

# quiz-stats

Statistics live only in each player's browser (localStorage), so this skill works on either a **backup file** or the **code**.

Work from the Study-03 folder. Arguments: `$ARGUMENTS`

## A. Analyse a backup file

Use this when the arguments are a path to a `.json` backup, or `sample` (meaning `examples/sample-backup.json`, made from simulated games).

1. Run both, using the script's output as the source of truth:

   ```sh
   node scripts/backup-report.mjs <file> stats --json
   node scripts/backup-report.mjs <file> audit
   ```

   The script loads the file through the game's own code (`parseBackup`, `LocalDataManager`), so the numbers match what the game shows. It never changes the file.

2. Report, in this order:
   - **Overview**: games played, first and last game dates, accuracy, total and average points, best streak, hints, skips, time-outs.
   - **By mode**, **by category** and **by difficulty** as tables.
   - **Insights** (only what the numbers support): strongest and weakest category, recent form against the saved-games average, where points come from (answers, speed, no hints, streaks), and 2 or 3 concrete practice tips, e.g. "Play By Category: Science on Medium; Science is 18 points below your average."
   - **Data quality**: if the audit found problems or skipped unreadable runs, list them and say the numbers above may be off.

3. Don't print nicknames beyond what's needed, and don't send the file's contents anywhere.

## B. Change how statistics work (code)

Use this when the arguments start with `change` or describe a code change ("also track average answer time"). Plan first, then make the change.

Where things live:
- `js/state.js`, `finish()`: the record saved for each game. New per-game data starts here.
- `js/data-manager.js`: `emptyStats()`, `applyGame()` (running totals), `STATS_VERSION`, `getStats()`, `getCategoryStats()`, `getDifficultyStats()`, and the backup code `sanitizeRun()` / `sanitizeStats()`.
- `js/ui.js`, `renderStats()`: the Statistics screen. `css/style.css`: its styles.
- Tests: `tests/data-manager.test.mjs`, `tests/state.test.mjs`, `tests/backup-report.test.mjs`. Report script: `scripts/backup-report.mjs`.

Checklist (do every item that applies):
- [ ] Keep logic pure and DOM-free; storage access never throws.
- [ ] New field in the saved record → add it to `sanitizeRun()` too, or restores will drop it.
- [ ] Changed the stats shape → bump `STATS_VERSION` (old stats rebuild automatically) and update `sanitizeStats()` and `emptyStats()`.
- [ ] Old records lack the new field: handle `undefined` (see how `questionsByCategory` falls back).
- [ ] Tests for the new numbers, including old records and a backup round trip.
- [ ] Screen text built with `textContent`; colours from CSS variables (re-check contrast in light and dark).
- [ ] Update `scripts/backup-report.mjs` if the report should show it.
- [ ] Bump `CACHE_VERSION` in `sw.js`; update `README.md` ("Saved results") and `CLAUDE.md` if structure changed.
- [ ] Run `node --test`, then check the Statistics screen in the browser.

If there are no arguments, briefly explain A and B and ask which the user wants (and for A, the path to their backup file).
